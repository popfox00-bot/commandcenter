import { redact } from './redact.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
export const MAX_LOG_ENTRIES = 300;

/**
 * Structured logger. Every entry is redacted before it is printed or kept.
 * Entries are buffered (capped) so the runner can persist them with the run record.
 * Child loggers add bindings and share the parent's buffer.
 */
export function createLogger({ level = process.env.CC_LOG_LEVEL || 'info', sink = defaultSink, clock = () => new Date() } = {}) {
  const state = { entries: [], dropped: 0, min: LEVELS[level] ?? LEVELS.info, sink, clock };
  return makeLogger(state, {});
}

function makeLogger(state, bindings) {
  const log = (lvl, msg, data) => {
    if (LEVELS[lvl] < state.min) return;
    const entry = redact({ t: state.clock().toISOString(), level: lvl, msg, ...bindings, ...(data === undefined ? {} : { data }) });
    if (state.entries.length < MAX_LOG_ENTRIES) state.entries.push(entry); else state.dropped += 1;
    state.sink(entry);
  };
  return {
    debug: (m, d) => log('debug', m, d),
    info: (m, d) => log('info', m, d),
    warn: (m, d) => log('warn', m, d),
    error: (m, d) => log('error', m, d),
    child: (extra) => makeLogger(state, { ...bindings, ...extra }),
    entries: () => (state.dropped
      ? [...state.entries, { level: 'warn', msg: `${state.dropped} log entries dropped (cap ${MAX_LOG_ENTRIES})` }]
      : [...state.entries]),
  };
}

function defaultSink(entry) {
  // CC_LOG_STDOUT=minimal prints only level/message/ids to stdout (GitHub Actions logs are public
  // on public repos). The full redacted entry is still kept in the run record in D1.
  if (process.env.CC_LOG_STDOUT === 'minimal') {
    const { t, level, msg, job, run } = entry;
    process.stderr.write(`${t} ${level} ${msg}${job ? ` job=${job}` : ''}${run ? ` run=${run}` : ''}\n`);
    return;
  }
  if (process.env.CC_LOG_FORMAT === 'json' || !process.stderr.isTTY) {
    process.stderr.write(JSON.stringify(entry) + '\n');
    return;
  }
  const { t, level, msg, ...rest } = entry;
  const tail = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
  process.stderr.write(`${t.slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${msg}${tail}\n`);
}

/** A sink that discards output; used by tests. */
export const silentSink = () => {};
