// The run lifecycle. Jobs implement only run(ctx) -> items; everything else is here:
// retries with backoff, timeouts, item validation, expected-count checks, dedupe + persistence,
// notifications (new items, failures, parse breaks), exporters, and the run log.

import { randomUUID } from 'node:crypto';
import { createLogger } from './logger.js';
import { createRng } from './rng.js';
import { withRetry, withTimeout } from './retry.js';
import { normalizeItems } from './items.js';
import { createContext } from './context.js';
import { ExpectationError, errorKind, CCError } from './errors.js';
import { planNewItemNotifications, failureNotification } from './notify.js';
import { runExporters } from '../exporters/index.js';
import { redact, redactString } from './redact.js';
import { closeBrowser } from './browser.js';

export function makeRunId(now, jobId) {
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${jobId}-${randomUUID().slice(0, 8)}`;
}

/**
 * Execute one job end to end. Never throws for job failures: returns a result object with
 * status "success" | "failed". Store/notifier errors on the failure path are logged, not rethrown.
 */
export async function runJob({ job, config, store, notifier, trigger = 'local', now = new Date(), fixture, source, log: parentLog, fetchFn, cacheDir, sleepFn, exporters = true, closeBrowserAfter = true }) {
  const jobCfg = config.jobs[job.id];
  const runId = makeRunId(now, job.id);
  const seed = runId;
  const rng = createRng(seed);
  const log = (parentLog ?? createLogger()).child({ job: job.id, run: runId });
  const started = Date.now();
  const startedAt = now.toISOString();
  const inputs = redact({ settings: jobCfg.settings, schedule: jobCfg.schedule, minItems: jobCfg.minItems, timeoutMs: jobCfg.timeoutMs, retries: jobCfg.retries, trigger, fixture: !!fixture, configOrigin: config.origin, node: process.version });

  log.info('run start', { trigger, seed, inputs });
  const states = await store.getJobStates().catch((err) => { log.warn('could not read job state', { error: err.message }); return {}; });
  const firstRun = !states[job.id]?.lastSuccessAt;
  await store.startRun({ id: runId, jobId: job.id, trigger, startedAt, seed, inputs, source });

  let items = [];
  let attempts = 0;
  try {
    const out = await withRetry(async (attempt) => {
      attempts = attempt;
      const alog = log.child({ attempt });
      const raw = await withTimeout(
        (signal) => job.run(createContext({ job, jobCfg, config, runId, attempt, now, rng, signal, log: alog, fixture, fetchFn, cacheDir })),
        jobCfg.timeoutMs,
        `${job.id} run`,
      );
      const normalized = normalizeItems(raw, { now, jobId: job.id });
      if (normalized.length < jobCfg.minItems) {
        throw new ExpectationError(`${job.id} returned ${normalized.length} item(s); config expects at least ${jobCfg.minItems}`);
      }
      return normalized;
    }, {
      // Fixture runs are deterministic: retrying cannot change the outcome.
      retries: fixture ? 0 : jobCfg.retries,
      baseMs: jobCfg.retryBaseMs,
      rng,
      sleepFn,
      onRetry: (err, attempt, delay) => log.warn('attempt failed, retrying', { attempt, delayMs: delay, kind: errorKind(err), error: err.message }),
    });
    items = out.value;

    const { newItems } = await store.upsertItems({ jobId: job.id, runId, now: startedAt, items });
    const byType = {};
    for (const it of items) byType[it.type] = (byType[it.type] ?? 0) + 1;
    const newByType = {};
    for (const it of newItems) newByType[it.type] = (newByType[it.type] ?? 0) + 1;
    log.info('items', { total: items.length, new: newItems.length, byType, newByType, newKeys: newItems.slice(0, 50).map((i) => `${i.type}:${i.key}`) });

    const counts = { items: items.length, new: newItems.length, byType, newByType, notifications: 0 };
    const notifications = planNewItemNotifications({ job, items: newItems, notifyCfg: jobCfg.notify, firstRun });
    let notifyError = null;
    for (const n of notifications) {
      try { await notifier.send(n); counts.notifications += 1; } catch (err) { notifyError ??= err; log.error('notification failed', { error: err.message }); }
    }
    if (exporters && newItems.length && jobCfg.exporters.length) {
      counts.exported = await runExporters({ exporters: jobCfg.exporters, job, items: newItems, log });
    }

    const durationMs = Date.now() - started;
    const status = notifyError ? 'failed' : 'success';
    const error = notifyError ? `Items saved but ${notifications.length - counts.notifications} notification(s) failed: ${notifyError.message}` : null;
    log.info('run finish', { status, durationMs, attempts, counts });
    await store.finishRun(runId, { status, finishedAt: new Date(started + durationMs).toISOString(), durationMs, attempts, itemCount: items.length, newCount: newItems.length, counts, error, errorKind: notifyError ? 'notify' : null, log: log.entries() });
    return { runId, status, attempts, durationMs, items, newItems, counts, firstRun, error };
  } catch (err) {
    const kind = errorKind(err);
    const message = redactString(err instanceof CCError || err?.message ? err.message : String(err));
    const durationMs = Date.now() - started;
    log.error('run failed', { kind, error: message, attempts, stack: err instanceof CCError ? undefined : err?.stack?.split('\n').slice(0, 6).join('\n') });
    if (jobCfg.notify.onFailure) {
      await notifier.send(failureNotification({ job, error: message, errorKind: kind, attempts, runUrl: source?.startsWith('http') ? source : undefined }))
        .catch((e) => log.error('failure notification failed', { error: e.message }));
    }
    await store.finishRun(runId, { status: 'failed', finishedAt: new Date(started + durationMs).toISOString(), durationMs, attempts, itemCount: null, newCount: null, counts: {}, error: message, errorKind: kind, log: log.entries() })
      .catch((e) => log.error('could not record failed run', { error: e.message }));
    return { runId, status: 'failed', attempts, durationMs, items: [], newItems: [], counts: {}, firstRun, error: message, errorKind: kind };
  } finally {
    if (closeBrowserAfter) await closeBrowser();
  }
}

/** Jobs metadata as stored by the Worker/local store (what the PWA lists). */
export function jobsMetadata(registry, config) {
  return [...registry.values()].map((mod) => {
    const cfg = config.jobs[mod.id];
    return {
      id: mod.id,
      name: mod.name,
      description: mod.description,
      schedule: cfg?.schedule ?? mod.schedule,
      timezone: config.timezone,
      enabled: !!cfg?.enabled,
      meta: { ui: mod.ui ?? null, configured: !!cfg },
    };
  });
}
