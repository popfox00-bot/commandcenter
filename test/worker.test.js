import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { D1Shim } from '../src/store/d1-shim.js';
import worker, { scheduled } from '../worker/src/index.js';
import { createRemoteStore } from '../src/store/remote-store.js';
import { runJob } from '../src/core/runner.js';
import govdeals from '../src/jobs/govdeals/index.js';
import { configFor, recordingNotifier, quietLog, noSleep } from './helpers/harness.js';

const API = 'a'.repeat(32);
const INGEST = 'ingest-secret-0123456789';
let env;
let ghCalls;
const realFetch = globalThis.fetch;

beforeEach(() => {
  env = {
    DB: new D1Shim(':memory:').migrate(),
    CC_API_TOKEN: API, CC_INGEST_SECRET: INGEST, GH_DISPATCH_TOKEN: 'ghp_test', GH_OWNER: 'o', GH_REPO: 'r',
    ALLOWED_ORIGINS: 'https://popfox00-bot.github.io', NTFY_TOPIC: 'topic-test-123',
  };
  ghCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    ghCalls.push({ url: String(url), method: init.method ?? 'GET', body: init.body, headers: init.headers });
    if (String(url).endsWith('/dispatches')) return new Response(null, { status: 204 });
    if (String(url).includes('/actions/workflows/cc-scheduled.yml') && !String(url).endsWith('/enable')) return Response.json({ state: 'disabled_inactivity' });
    if (String(url).endsWith('/enable')) return new Response(null, { status: 204 });
    if (String(url).startsWith('https://ntfy.sh')) return new Response('{}', { status: 200 });
    return new Response('not mocked', { status: 599 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const call = (path, { method = 'GET', token = API, body, origin } = {}) => worker.fetch(new Request(`https://w.test${path}`, {
  method,
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}), env);

const remote = () => createRemoteStore({ baseUrl: 'https://w.test', secret: INGEST, retries: 0, fetchFn: (url, init) => worker.fetch(new Request(url, init), env) });

test('API requires the bearer token', async () => {
  assert.equal((await call('/api/health', { token: null })).status, 200);
  assert.equal((await call('/api/jobs', { token: null })).status, 401);
  assert.equal((await call('/api/jobs', { token: 'b'.repeat(32) })).status, 401);
  assert.equal((await call('/api/jobs')).status, 200);
});

test('CORS headers only for allowed origins', async () => {
  const ok = await call('/api/jobs', { origin: 'https://popfox00-bot.github.io' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://popfox00-bot.github.io');
  const bad = await call('/api/jobs', { origin: 'https://evil.example' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('ingest rejects unsigned, wrongly signed, and UI-token requests', async () => {
  const unsigned = await worker.fetch(new Request('https://w.test/ingest/jobs', { method: 'POST', body: '{}' }), env);
  assert.equal(unsigned.status, 401);
  const withBearer = await call('/ingest/jobs', { method: 'POST', body: { jobs: [] } });
  assert.equal(withBearer.status, 401, 'the PWA token cannot write');
  const wrong = createRemoteStore({ baseUrl: 'https://w.test', secret: 'wrong-secret-xxxxxxxx', retries: 0, fetchFn: (u, i) => worker.fetch(new Request(u, i), env) });
  await assert.rejects(wrong.getJobStates(), /HTTP 401/);
});

test('runner write-back through the Worker: dedupe, run log, and read API for the PWA', async () => {
  const { registry, config } = configFor([govdeals], { govdeals: { notify: { silentFirstRun: false }, settings: { searches: [{ keywords: 'forklift', maxBid: 5000 }] } } });
  const store = remote();
  const { jobsMetadata } = await import('../src/core/runner.js');
  await store.syncJobs(jobsMetadata(registry, config), new Date().toISOString());
  const html = readFileSync(resolve(import.meta.dirname, 'fixtures/govdeals/search-results.html'), 'utf8');
  const NOW = new Date('2026-10-15T12:00:00Z');
  const run = (now) => runJob({ job: govdeals, config, store, notifier: recordingNotifier(), now, fixture: () => html, log: quietLog(), sleepFn: noSleep, closeBrowserAfter: false, source: 'https://github.com/o/r/actions/runs/1' });

  const r1 = await run(NOW);
  assert.equal(r1.status, 'success', r1.error);
  assert.ok(r1.newItems.length > 0);
  const r2 = await run(new Date('2026-10-15T13:00:00Z'));
  assert.equal(r2.newItems.length, 0, 'dedupe state lives in D1');

  const jobs = await (await call('/api/jobs')).json();
  const gd = jobs.jobs.find((j) => j.id === 'govdeals');
  assert.equal(gd.lastRun.status, 'success');
  assert.equal(gd.meta.ui.sortBy, 'endTime');

  const current = await (await call('/api/jobs/govdeals/items?view=current&type=match')).json();
  assert.equal(current.items.length, r1.items.filter((i) => i.type === 'match').length);
  const runs = await (await call('/api/jobs/govdeals/runs')).json();
  assert.equal(runs.runs.length, 2);
  const detail = await (await call(`/api/runs/${runs.runs[0].id}`)).json();
  assert.ok(detail.run.log.some((e) => e.msg === 'run finish'));
  assert.equal(detail.run.source, 'https://github.com/o/r/actions/runs/1');
});

test('items cannot be written to a run that is not active', async () => {
  const store = remote();
  await store.syncJobs([{ id: 'heartbeat', name: 'H', enabled: true, schedule: '7 7 * * *' }], new Date().toISOString());
  await assert.rejects(store.upsertItems({ jobId: 'heartbeat', runId: 'nonexistent-run', now: new Date().toISOString(), items: [] }), /409/);
});

test('Run now dispatches the workflow with least-privilege inputs, with a cooldown', async () => {
  await remote().syncJobs([{ id: 'govdeals', name: 'G', enabled: true, schedule: '17 */3 * * *' }], new Date().toISOString());
  const res = await call('/api/jobs/govdeals/run', { method: 'POST' });
  assert.equal(res.status, 202);
  const gh = ghCalls.find((c) => c.url.endsWith('/dispatches'));
  assert.equal(gh.url, 'https://api.github.com/repos/o/r/actions/workflows/cc-dispatch.yml/dispatches');
  assert.deepEqual(JSON.parse(gh.body), { ref: 'main', inputs: { job_id: 'govdeals' } });
  assert.equal((await call('/api/jobs/govdeals/run', { method: 'POST' })).status, 429);
  assert.equal((await call('/api/jobs/nope/run', { method: 'POST' })).status, 404);
  assert.equal((await call('/api/jobs/govdeals/run', { method: 'POST', token: null })).status, 401);
});

test('cron: stale runs fail, overdue jobs alert once, and the workflow is re-enabled', async () => {
  const store = remote();
  await store.syncJobs([{ id: 'heartbeat', name: 'Heartbeat', enabled: true, schedule: '7 7 * * *', timezone: 'UTC' }], '2026-10-01T00:00:00Z');
  await store.startRun({ id: 'old-run-0001', jobId: 'heartbeat', trigger: 'schedule', startedAt: '2026-10-10T07:07:00Z' });
  const report = await scheduled(env, new Date('2026-10-15T20:00:00Z'));
  assert.equal(report.stale, 1);
  assert.deepEqual(report.overdue, ['heartbeat']);
  assert.equal(report.reenabled, true);
  assert.equal(report.alerted, true);
  const ntfy = ghCalls.filter((c) => c.url.startsWith('https://ntfy.sh'));
  assert.equal(ntfy.length, 1);
  assert.match(JSON.parse(ntfy[0].body).message, /No run for heartbeat/);
  const again = await scheduled(env, new Date('2026-10-15T22:00:00Z'));
  assert.equal(again.alerted, false, 'alert throttled to once per 12h');
});
