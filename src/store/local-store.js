// Local store: a SQLite file (default .cc/local.db) with the same schema and SQL as the Worker's D1.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { D1Shim } from './d1-shim.js';
import * as sql from '../../shared/sql-store.js';

export const DEFAULT_LOCAL_DB = resolve(import.meta.dirname, '../../.cc/local.db');

export function createLocalStore(path = process.env.CC_LOCAL_DB || DEFAULT_LOCAL_DB) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new D1Shim(path).migrate();
  return {
    kind: 'local',
    db,
    syncJobs: (jobs, now) => sql.syncJobs(db, jobs, now),
    getJobStates: () => sql.getJobStates(db),
    startRun: (run) => sql.startRun(db, run),
    upsertItems: (args) => sql.upsertItems(db, args),
    finishRun: (id, r) => sql.finishRun(db, id, r),
    listJobs: () => sql.listJobs(db),
    listItems: (jobId, opts) => sql.listItems(db, jobId, opts),
    listRuns: (jobId, opts) => sql.listRuns(db, jobId, opts),
    getRun: (id) => sql.getRun(db, id),
    close: () => db.close(),
  };
}
