#!/usr/bin/env node
// Command Center CLI. Runs jobs locally (no cloud services needed) or in GitHub Actions.
//   node src/cli.js validate
//   node src/cli.js list
//   node src/cli.js run <jobId> [--dry-run] [--fixture saved-page.html] [--store local|remote|memory] [--notify]
//   node src/cli.js due [--json]
//   node src/cli.js scheduled
//   node src/cli.js capture <url> --out file.html [--wait "css selector"]
//   node src/cli.js items <jobId> [--view current] | runs <jobId> | run-log <runId>

// node:sqlite prints an ExperimentalWarning on Node 22; keep CLI output clean.
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : emitWarning.call(process, w, ...rest));

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const envFile = resolve(import.meta.dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { loadRegistry } = await import('./core/registry.js');
const { loadConfig } = await import('./core/config.js');
const { runJob, jobsMetadata } = await import('./core/runner.js');
const { isDue } = await import('./core/schedule.js');
const { createLogger } = await import('./core/logger.js');
const { registerSecretsFromEnv } = await import('./core/redact.js');
const { notifierFromEnv } = await import('./core/notify.js');
const { ConfigError } = await import('./core/errors.js');

registerSecretsFromEnv();

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    store: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    fixture: { type: 'string' },
    notify: { type: 'boolean', default: false },
    trigger: { type: 'string' },
    json: { type: 'boolean', default: false },
    config: { type: 'string' },
    out: { type: 'string' },
    wait: { type: 'string' },
    view: { type: 'string' },
    type: { type: 'string' },
    limit: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const [command, arg] = positionals;
const log = createLogger();

async function makeStore() {
  const kind = opts['dry-run'] ? 'memory' : (opts.store || process.env.CC_STORE || 'local');
  if (kind === 'remote') return (await import('./store/remote-store.js')).createRemoteStore();
  const { createLocalStore } = await import('./store/local-store.js');
  if (kind === 'memory') return createLocalStore(':memory:');
  if (kind === 'local') return createLocalStore();
  throw new ConfigError(`Unknown --store "${kind}" (local | remote | memory)`);
}

function makeNotifier() {
  const wantNtfy = !opts['dry-run'] && (opts.notify || process.env.CC_NOTIFY === 'ntfy');
  if (wantNtfy && !process.env.NTFY_TOPIC) throw new ConfigError('Notifications requested but NTFY_TOPIC is not set');
  return notifierFromEnv({ log, forceConsole: !wantNtfy });
}

function runSource() {
  const { GITHUB_SERVER_URL: s, GITHUB_REPOSITORY: r, GITHUB_RUN_ID: id } = process.env;
  return s && r && id ? `${s}/${r}/actions/runs/${id}` : 'local';
}

async function setup() {
  const registry = await loadRegistry();
  const config = loadConfig(registry, { path: opts.config });
  return { registry, config };
}

function print(value) {
  process.stdout.write((typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '\n');
}

async function dueJobs(registry, config, store, now) {
  const states = await store.getJobStates();
  const out = [];
  for (const [id, jobCfg] of Object.entries(config.jobs)) {
    if (!jobCfg.enabled) continue;
    const { due, fire } = isDue({ cron: jobCfg.schedule, now, lastRunAt: states[id]?.lastRunAt, timeZone: config.timezone });
    out.push({ id, due, needsBrowser: !!registry.get(id).needsBrowser, lastFire: fire?.toISOString() ?? null, lastRunAt: states[id]?.lastRunAt ?? null, schedule: jobCfg.schedule });
  }
  return out;
}

const HELP = `Usage: node src/cli.js <command> [options]

Commands
  validate                 Validate config/jobs.yaml against every job's schema
  list                     List jobs, schedules and due status
  run <jobId>              Run one job now
  due                      Show which enabled jobs are due (--json: [{id, needsBrowser}])
  scheduled                Run every due job (used by the scheduled workflow)
  notify-test              Send a test push to NTFY_TOPIC
  capture <url>            Render a page in Chromium and save its HTML (--out, --wait)
  items <jobId>            Show stored items (--view recent|current, --type, --limit)
  runs <jobId>             Show recent runs
  run-log <runId>          Show one run with its full log

Options
  --store local|remote|memory   Where state lives (default: local SQLite at .cc/local.db)
  --dry-run                     In-memory store, console notifications, nothing persisted
  --fixture <file.html>         Serve this saved HTML instead of fetching (no network)
  --notify                      Send real ntfy notifications (needs NTFY_TOPIC)
  --trigger local|manual|schedule
  --config <file>               Use another config file`;

async function main() {
  if (opts.help || !command) { print(HELP); return 0; }

  if (command === 'validate') {
    const { registry, config } = await setup();
    print(`✔ ${config.origin} is valid`);
    for (const mod of registry.values()) {
      const c = config.jobs[mod.id];
      print(`  ${mod.id.padEnd(20)} ${c ? (c.enabled ? 'enabled ' : 'disabled') : 'not configured'}  ${c?.schedule ?? mod.schedule}  (${config.timezone})`);
    }
    return 0;
  }

  if (command === 'notify-test') {
    if (!process.env.NTFY_TOPIC) throw new ConfigError('NTFY_TOPIC is not set (put it in .env or the environment)');
    await notifierFromEnv({ log }).send({ title: '✅ Command Center test', message: 'If you can read this on your phone, notifications work.', priority: 'default', tags: ['white_check_mark'] });
    print('✔ Test notification sent. Check the ntfy app.');
    return 0;
  }

  if (command === 'capture') {
    if (!arg) throw new ConfigError('capture needs a URL');
    const { config } = await setup();
    const { createContext } = await import('./core/context.js');
    const { createRng } = await import('./core/rng.js');
    const { closeBrowser } = await import('./core/browser.js');
    const ctx = createContext({ job: { id: 'capture' }, jobCfg: { settings: {} }, config, runId: 'capture', attempt: 1, now: new Date(), rng: createRng('capture'), log });
    try {
      const { html } = await ctx.page(arg, { render: true, waitForSelector: opts.wait, cache: false });
      const out = resolve(opts.out || 'capture.html');
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, html);
      print(`Saved ${html.length} bytes to ${out}`);
    } finally { await closeBrowser(); }
    return 0;
  }

  const { registry, config } = await setup();
  const store = await makeStore();
  try {
    const now = new Date();
    if (['list', 'due', 'run', 'scheduled'].includes(command)) await store.syncJobs(jobsMetadata(registry, config), now.toISOString());

    if (command === 'list' || command === 'due') {
      const rows = await dueJobs(registry, config, store, now);
      if (opts.json) { print(command === 'due' ? rows.filter((r) => r.due).map(({ id, needsBrowser }) => ({ id, needsBrowser })) : rows); return 0; }
      for (const r of rows) print(`${r.due ? '● due ' : '○ wait'}  ${r.id.padEnd(20)} ${r.schedule.padEnd(16)} last run: ${r.lastRunAt ?? 'never'}`);
      return 0;
    }

    if (command === 'run') {
      const job = registry.get(arg);
      if (!job) throw new ConfigError(`Unknown job "${arg}". Known: ${[...registry.keys()].join(', ')}`);
      if (!config.jobs[job.id]) throw new ConfigError(`Job "${job.id}" has no entry under jobs: in ${config.origin}`);
      const fixture = opts.fixture ? (() => { const html = readFileSync(resolve(opts.fixture), 'utf8'); return () => html; })() : undefined;
      const trigger = opts.trigger || (process.env.GITHUB_ACTIONS ? 'manual' : 'local');
      const result = await runJob({ job, config, store, notifier: makeNotifier(), trigger, now, fixture, source: runSource(), log });
      summarize(job, result);
      return result.status === 'success' ? 0 : 1;
    }

    if (command === 'scheduled') {
      const due = (await dueJobs(registry, config, store, now)).filter((r) => r.due);
      if (!due.length) { print('No jobs due.'); return 0; }
      const notifier = makeNotifier();
      let failed = 0;
      for (const { id } of due) {
        const result = await runJob({ job: registry.get(id), config, store, notifier, trigger: opts.trigger || 'schedule', now: new Date(), source: runSource(), log });
        summarize(registry.get(id), result);
        if (result.status !== 'success') failed += 1;
      }
      return failed ? 1 : 0;
    }

    if (command === 'items') { print(await store.listItems(arg, { view: opts.view, type: opts.type, limit: opts.limit })); return 0; }
    if (command === 'runs') { print(await store.listRuns(arg, { limit: opts.limit })); return 0; }
    if (command === 'run-log') { print(await store.getRun(arg)); return 0; }

    throw new ConfigError(`Unknown command "${command}". Try --help.`);
  } finally {
    store.close?.();
  }
}

function summarize(job, r) {
  if (opts.json) { print({ job: job.id, ...r }); return; }
  const mark = r.status === 'success' ? '✔' : '✖';
  print(`\n${mark} ${job.id} ${r.status} in ${r.durationMs} ms (attempts: ${r.attempts}) — ${r.items.length} items, ${r.newItems.length} new${r.firstRun ? ' (first run)' : ''}`);
  if (r.error) print(`  error [${r.errorKind}]: ${r.error}`);
  for (const it of r.newItems.slice(0, 20)) print(`  + [${it.type}] ${it.title}${it.url ? `  ${it.url}` : ''}`);
  if (r.newItems.length > 20) print(`  … ${r.newItems.length - 20} more`);
}

try {
  process.exitCode = await main();
} catch (err) {
  const { redactString } = await import('./core/redact.js');
  process.stderr.write(`\n✖ ${err.name === 'ConfigError' ? 'Config error' : 'Error'}: ${redactString(err.message)}\n`);
  if (err.name !== 'ConfigError' && process.env.CC_DEBUG) process.stderr.write(err.stack + '\n');
  process.exitCode = 2;
}
