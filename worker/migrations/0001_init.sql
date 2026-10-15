-- Command Center schema. Shared by the Cloudflare Worker (D1) and the local store (node:sqlite).

CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  schedule     TEXT,
  timezone     TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  meta_json    TEXT NOT NULL DEFAULT '{}',
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL,
  trigger      TEXT NOT NULL,           -- schedule | manual | local
  status       TEXT NOT NULL,           -- running | success | failed
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  duration_ms  INTEGER,
  attempts     INTEGER,
  seed         TEXT,
  inputs_json  TEXT NOT NULL DEFAULT '{}',
  item_count   INTEGER,
  new_count    INTEGER,
  counts_json  TEXT NOT NULL DEFAULT '{}',
  error        TEXT,
  error_kind   TEXT,
  log_json     TEXT NOT NULL DEFAULT '[]',
  source       TEXT                     -- e.g. github run URL or "local"
);
CREATE INDEX IF NOT EXISTS runs_job_started ON runs (job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS items (
  job_id         TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'match',
  key            TEXT NOT NULL,
  title          TEXT NOT NULL,
  url            TEXT,
  fields_json    TEXT NOT NULL DEFAULT '{}',
  timestamp      TEXT NOT NULL,
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  first_run_id   TEXT NOT NULL,
  last_run_id    TEXT NOT NULL,
  PRIMARY KEY (job_id, type, key)
);
CREATE INDEX IF NOT EXISTS items_recent ON items (job_id, type, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS items_last_run ON items (job_id, last_run_id);

-- "Run now" requests, for a cooldown so repeated taps can't burn Actions minutes.
CREATE TABLE IF NOT EXISTS dispatches (
  job_id        TEXT NOT NULL,
  requested_at  TEXT NOT NULL,
  status        INTEGER,
  PRIMARY KEY (job_id, requested_at)
);

-- Small key/value state for the Worker (e.g. last watchdog alert time).
CREATE TABLE IF NOT EXISTS worker_state (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
