// Storage operations over a D1-compatible database handle:
//   db.prepare(sql).bind(...args).all() / .first() / .run(),  db.batch([stmts])
// Used by the Worker (real D1) and by the local CLI store (node:sqlite via d1-shim.js),
// so dedupe and persistence behave identically in the cloud and locally.

const MAX_LOG_JSON = 60_000;
const MAX_ITEMS_PER_UPSERT = 500;

const json = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };

export async function syncJobs(db, jobs, now) {
  if (!jobs.length) return;
  await db.batch(jobs.map((j) => db.prepare(
    `INSERT INTO jobs (id, name, description, schedule, timezone, enabled, meta_json, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description,
       schedule = excluded.schedule, timezone = excluded.timezone, enabled = excluded.enabled,
       meta_json = excluded.meta_json, updated_at = excluded.updated_at`,
  ).bind(j.id, j.name, j.description ?? '', j.schedule ?? null, j.timezone ?? null, j.enabled ? 1 : 0, JSON.stringify(j.meta ?? {}), now)));
}

/** Per job: last run start (any trigger/status), last success, last status. Used for due-ness. */
export async function getJobStates(db) {
  const { results } = await db.prepare(
    `SELECT j.id AS job_id,
       (SELECT started_at FROM runs r WHERE r.job_id = j.id ORDER BY started_at DESC LIMIT 1) AS last_run_at,
       (SELECT status FROM runs r WHERE r.job_id = j.id ORDER BY started_at DESC LIMIT 1) AS last_status,
       (SELECT started_at FROM runs r WHERE r.job_id = j.id AND status = 'success' ORDER BY started_at DESC LIMIT 1) AS last_success_at
     FROM jobs j`,
  ).all();
  const out = {};
  for (const r of results) out[r.job_id] = { lastRunAt: r.last_run_at, lastStatus: r.last_status, lastSuccessAt: r.last_success_at };
  return out;
}

export async function startRun(db, run) {
  await db.prepare(
    `INSERT INTO runs (id, job_id, trigger, status, started_at, seed, inputs_json, source)
     VALUES (?1, ?2, ?3, 'running', ?4, ?5, ?6, ?7)`,
  ).bind(run.id, run.jobId, run.trigger, run.startedAt, run.seed ?? null, JSON.stringify(run.inputs ?? {}), run.source ?? null).run();
}

/**
 * Upsert items and report which ones are new for this job. "New" means the (job, type, key) row
 * was created by this run. Existing rows get fresh title/url/fields (e.g. a changed bid) and last_seen.
 */
export async function upsertItems(db, { jobId, runId, now, items }) {
  if (items.length > MAX_ITEMS_PER_UPSERT) throw new Error(`Too many items in one upsert (${items.length} > ${MAX_ITEMS_PER_UPSERT})`);
  if (!items.length) return { newItems: [] };
  const results = await db.batch(items.map((it) => db.prepare(
    `INSERT INTO items (job_id, type, key, title, url, fields_json, timestamp, first_seen_at, last_seen_at, first_run_id, last_run_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?9)
     ON CONFLICT (job_id, type, key) DO UPDATE SET title = excluded.title, url = excluded.url,
       fields_json = excluded.fields_json, timestamp = excluded.timestamp,
       last_seen_at = excluded.last_seen_at, last_run_id = excluded.last_run_id
     RETURNING type, key, first_run_id`,
  ).bind(jobId, it.type, it.key, it.title, it.url ?? null, JSON.stringify(it.fields ?? {}), it.timestamp, now, runId)));
  const newKeys = new Set();
  for (const r of results) {
    const row = r.results?.[0];
    if (row && row.first_run_id === runId) newKeys.add(`${row.type}\u0000${row.key}`);
  }
  return { newItems: items.filter((it) => newKeys.has(`${it.type}\u0000${it.key}`)) };
}

export async function finishRun(db, runId, r) {
  let log = JSON.stringify(r.log ?? []);
  if (log.length > MAX_LOG_JSON) log = JSON.stringify([...(r.log ?? []).slice(0, 50), { level: 'warn', msg: 'log truncated for storage' }, ...(r.log ?? []).slice(-50)]);
  await db.prepare(
    `UPDATE runs SET status = ?2, finished_at = ?3, duration_ms = ?4, attempts = ?5, item_count = ?6,
       new_count = ?7, counts_json = ?8, error = ?9, error_kind = ?10, log_json = ?11
     WHERE id = ?1`,
  ).bind(runId, r.status, r.finishedAt, r.durationMs, r.attempts ?? null, r.itemCount ?? null, r.newCount ?? null,
    JSON.stringify(r.counts ?? {}), r.error ?? null, r.errorKind ?? null, log).run();
}

// ---- read side (PWA) ----

export async function listJobs(db) {
  const { results } = await db.prepare(
    `SELECT j.*, r.id AS run_id, r.status AS run_status, r.trigger AS run_trigger, r.started_at AS run_started_at,
       r.finished_at AS run_finished_at, r.duration_ms AS run_duration_ms, r.item_count AS run_item_count,
       r.new_count AS run_new_count, r.error AS run_error, r.error_kind AS run_error_kind,
       (SELECT started_at FROM runs s WHERE s.job_id = j.id AND s.status = 'success' ORDER BY started_at DESC LIMIT 1) AS last_success_at
     FROM jobs j
     LEFT JOIN runs r ON r.id = (SELECT id FROM runs x WHERE x.job_id = j.id ORDER BY started_at DESC LIMIT 1)
     ORDER BY j.name`,
  ).all();
  return results.map((r) => ({
    id: r.id, name: r.name, description: r.description, schedule: r.schedule, timezone: r.timezone,
    enabled: !!r.enabled, meta: json(r.meta_json, {}), updatedAt: r.updated_at, lastSuccessAt: r.last_success_at,
    lastRun: r.run_id ? {
      id: r.run_id, status: r.run_status, trigger: r.run_trigger, startedAt: r.run_started_at, finishedAt: r.run_finished_at,
      durationMs: r.run_duration_ms, itemCount: r.run_item_count, newCount: r.run_new_count, error: r.run_error, errorKind: r.run_error_kind,
    } : null,
  }));
}

function mapItem(r) {
  return { type: r.type, key: r.key, title: r.title, url: r.url, fields: json(r.fields_json, {}), timestamp: r.timestamp, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at };
}

/**
 * view "recent": newest first by first_seen.
 * view "current": items present in the job's latest successful run (e.g. listings still
 * matching a search), so the PWA can show what is currently tracked.
 */
export async function listItems(db, jobId, { type, view = 'recent', limit = 50 } = {}) {
  limit = Math.max(1, Math.min(200, Number(limit) || 50));
  if (view === 'current') {
    const last = await db.prepare(`SELECT id FROM runs WHERE job_id = ?1 AND status = 'success' ORDER BY started_at DESC LIMIT 1`).bind(jobId).first();
    if (!last) return [];
    const { results } = await db.prepare(
      `SELECT * FROM items WHERE job_id = ?1 AND last_run_id = ?2 AND (?3 IS NULL OR type = ?3) ORDER BY first_seen_at DESC LIMIT ?4`,
    ).bind(jobId, last.id, type ?? null, limit).all();
    return results.map(mapItem);
  }
  const { results } = await db.prepare(
    `SELECT * FROM items WHERE job_id = ?1 AND (?2 IS NULL OR type = ?2) ORDER BY first_seen_at DESC, key LIMIT ?3`,
  ).bind(jobId, type ?? null, limit).all();
  return results.map(mapItem);
}

function mapRun(r, withLog) {
  return {
    id: r.id, jobId: r.job_id, trigger: r.trigger, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at,
    durationMs: r.duration_ms, attempts: r.attempts, seed: r.seed, inputs: json(r.inputs_json, {}), itemCount: r.item_count,
    newCount: r.new_count, counts: json(r.counts_json, {}), error: r.error, errorKind: r.error_kind, source: r.source,
    ...(withLog ? { log: json(r.log_json, []) } : {}),
  };
}

export async function listRuns(db, jobId, { limit = 20 } = {}) {
  limit = Math.max(1, Math.min(100, Number(limit) || 20));
  const { results } = await db.prepare(
    `SELECT id, job_id, trigger, status, started_at, finished_at, duration_ms, attempts, seed, inputs_json, item_count,
       new_count, counts_json, error, error_kind, source FROM runs WHERE job_id = ?1 ORDER BY started_at DESC LIMIT ?2`,
  ).bind(jobId, limit).all();
  return results.map((r) => mapRun(r, false));
}

export async function getRun(db, runId) {
  const r = await db.prepare(`SELECT * FROM runs WHERE id = ?1`).bind(runId).first();
  return r ? mapRun(r, true) : null;
}

/** Retention: drop old runs, and items not seen for a while. Keeps D1 storage and row reads small. */
export async function prune(db, { now, runDays = 60, itemDays = 120 }) {
  const runCutoff = new Date(Date.parse(now) - runDays * 86400_000).toISOString();
  const itemCutoff = new Date(Date.parse(now) - itemDays * 86400_000).toISOString();
  const [runs, items] = await db.batch([
    db.prepare(`DELETE FROM runs WHERE started_at < ?1`).bind(runCutoff),
    db.prepare(`DELETE FROM items WHERE last_seen_at < ?1`).bind(itemCutoff),
  ]);
  return { runsDeleted: runs.meta?.changes ?? 0, itemsDeleted: items.meta?.changes ?? 0 };
}

/** Mark runs stuck in "running" (runner died) as failed so they don't block due-ness forever. */
export async function failStaleRuns(db, { now, olderThanMinutes = 90 }) {
  const cutoff = new Date(Date.parse(now) - olderThanMinutes * 60_000).toISOString();
  const r = await db.prepare(
    `UPDATE runs SET status = 'failed', error = 'runner stopped reporting (stale)', error_kind = 'stale', finished_at = ?2
     WHERE status = 'running' AND started_at < ?1`,
  ).bind(cutoff, now).run();
  return r.meta?.changes ?? 0;
}
