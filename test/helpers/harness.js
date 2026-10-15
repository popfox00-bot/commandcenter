// Shared test helpers: an in-memory store, a recording notifier, and config built from objects.
process.emitWarning = ((orig) => (w, ...r) => (String(w).includes('SQLite') ? undefined : orig.call(process, w, ...r)))(process.emitWarning);

import { z } from 'zod';
import { createLocalStore } from '../../src/store/local-store.js';
import { createConsoleNotifier } from '../../src/core/notify.js';
import { validateConfig } from '../../src/core/config.js';
import { createLogger, silentSink } from '../../src/core/logger.js';

export const memoryStore = () => createLocalStore(':memory:');
export const recordingNotifier = () => createConsoleNotifier({ out: () => {} });
export const quietLog = () => createLogger({ sink: silentSink, level: 'debug' });
export const noSleep = async () => {};

export function fakeJob(overrides = {}) {
  return {
    id: 'fake',
    name: 'Fake job',
    description: 'test job',
    schedule: '0 * * * *',
    configSchema: z.object({ terms: z.array(z.string()).default([]) }).strict(),
    run: async () => [],
    ...overrides,
  };
}

export function configFor(jobs, rawJobs = {}, extra = {}) {
  const registry = new Map(jobs.map((j) => [j.id, j]));
  const raw = {
    version: 1,
    politeness: { minDelayMs: 0, maxDelayMs: 0, perHostIntervalMs: 0, cacheTtlSec: 0 },
    defaults: { retries: 2, retryBaseMs: 1, timeoutMs: 5000 },
    jobs: Object.fromEntries(jobs.map((j) => [j.id, { settings: {}, ...(rawJobs[j.id] ?? {}) }])),
    ...extra,
  };
  return { registry, config: validateConfig(raw, registry, 'test-config') };
}
