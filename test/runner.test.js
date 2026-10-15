import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runJob } from '../src/core/runner.js';
import { ParseError } from '../src/core/errors.js';
import { registerSecret, clearRegisteredSecrets } from '../src/core/redact.js';
import { fakeJob, configFor, memoryStore, recordingNotifier, quietLog, noSleep } from './helpers/harness.js';

const item = (key, extra = {}) => ({ key, title: `Item ${key}`, url: `https://example.com/${key}`, fields: { price: 10 }, ...extra });
const opts = (o) => ({ log: quietLog(), sleepFn: noSleep, closeBrowserAfter: false, ...o });

test('dedupe: second run with the same keys reports nothing new', async () => {
  let keys = ['a', 'b'];
  const job = fakeJob({ run: async () => keys.map((k) => item(k)) });
  const { config } = configFor([job], { fake: { notify: { silentFirstRun: false } } });
  const store = memoryStore();
  const notifier = recordingNotifier();

  const r1 = await runJob(opts({ job, config, store, notifier, now: new Date('2026-01-01T00:00:00Z') }));
  assert.equal(r1.status, 'success');
  assert.deepEqual(r1.newItems.map((i) => i.key), ['a', 'b']);
  assert.equal(notifier.sent.length, 2);

  const r2 = await runJob(opts({ job, config, store, notifier, now: new Date('2026-01-01T01:00:00Z') }));
  assert.equal(r2.newItems.length, 0);
  assert.equal(notifier.sent.length, 2, 'no notifications for already-seen keys');

  keys = ['a', 'b', 'c'];
  const r3 = await runJob(opts({ job, config, store, notifier, now: new Date('2026-01-01T02:00:00Z') }));
  assert.deepEqual(r3.newItems.map((i) => i.key), ['c']);
  assert.equal(notifier.sent.at(-1).title, 'Item c');
});

test('same key under different types are separate (e.g. match vs ending_soon)', async () => {
  const job = fakeJob({ run: async () => [item('1'), item('1', { type: 'ending_soon' })] });
  const { config } = configFor([job], { fake: { notify: { silentFirstRun: false } } });
  const r = await runJob(opts({ job, config, store: memoryStore(), notifier: recordingNotifier() }));
  assert.equal(r.newItems.length, 2);
});

test('first run is silent except for one summary', async () => {
  const job = fakeJob({ run: async () => ['a', 'b', 'c'].map((k) => item(k)) });
  const { config } = configFor([job]);
  const notifier = recordingNotifier();
  await runJob(opts({ job, config, store: memoryStore(), notifier }));
  assert.equal(notifier.sent.length, 1);
  assert.match(notifier.sent[0].title, /now tracking 3 items/);
});

test('maxPerRun folds extras into one summary notification', async () => {
  const job = fakeJob({ run: async () => Array.from({ length: 8 }, (_, i) => item(String(i))) });
  const { config } = configFor([job], { fake: { notify: { silentFirstRun: false, maxPerRun: 3 } } });
  const notifier = recordingNotifier();
  await runJob(opts({ job, config, store: memoryStore(), notifier }));
  assert.equal(notifier.sent.length, 4);
  assert.match(notifier.sent[3].title, /5 more new/);
});

test('job-provided formatter is used', async () => {
  const job = fakeJob({ run: async () => [item('x')], formatNotification: (it) => ({ title: `NEW ${it.key}`, message: 'm', priority: 'high' }) });
  const { config } = configFor([job], { fake: { notify: { silentFirstRun: false } } });
  const notifier = recordingNotifier();
  await runJob(opts({ job, config, store: memoryStore(), notifier }));
  assert.equal(notifier.sent[0].title, 'NEW x');
  assert.equal(notifier.sent[0].priority, 'high');
  assert.equal(notifier.sent[0].url, 'https://example.com/x');
});

test('parse errors are retried, then fail loudly with a parse-break notification', async () => {
  let calls = 0;
  const job = fakeJob({ run: async () => { calls += 1; throw new ParseError('selector .card not found'); } });
  const { config } = configFor([job]);
  const store = memoryStore();
  const notifier = recordingNotifier();
  const r = await runJob(opts({ job, config, store, notifier }));
  assert.equal(r.status, 'failed');
  assert.equal(r.errorKind, 'parse');
  assert.equal(calls, 3, '1 attempt + 2 retries');
  assert.equal(notifier.sent.length, 1);
  assert.match(notifier.sent[0].title, /Selector or parse broke/);
  assert.equal(notifier.sent[0].priority, 'high');
  const runs = await store.listRuns('fake');
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[0].attempts, 3);
});

test('a transient failure that recovers succeeds without a failure notification', async () => {
  let calls = 0;
  const job = fakeJob({ run: async () => { calls += 1; if (calls === 1) throw new Error('flaky'); return [item('a')]; } });
  const { config } = configFor([job]);
  const notifier = recordingNotifier();
  const r = await runJob(opts({ job, config, store: memoryStore(), notifier }));
  assert.equal(r.status, 'success');
  assert.equal(r.attempts, 2);
  assert.ok(!notifier.sent.some((n) => n.title.includes('❌')));
});

test('zero items when items are expected is a failure, not a silent pass', async () => {
  const job = fakeJob({ run: async () => [] });
  const { config } = configFor([job], { fake: { minItems: 1, retries: 0 } });
  const notifier = recordingNotifier();
  const r = await runJob(opts({ job, config, store: memoryStore(), notifier }));
  assert.equal(r.status, 'failed');
  assert.equal(r.errorKind, 'expectation');
  assert.match(notifier.sent[0].title, /Fewer results than expected/);
});

test('timeouts fail the run', async () => {
  const job = fakeJob({ run: () => new Promise(() => {}) });
  const { config } = configFor([job], { fake: { timeoutMs: 1000, retries: 0 } });
  const r = await runJob(opts({ job, config, store: memoryStore(), notifier: recordingNotifier() }));
  assert.equal(r.status, 'failed');
  assert.equal(r.errorKind, 'timeout');
});

test('invalid items fail without retry', async () => {
  let calls = 0;
  const job = fakeJob({ run: async () => { calls += 1; return [{ key: 'a' }]; } });
  const { config } = configFor([job]);
  const r = await runJob(opts({ job, config, store: memoryStore(), notifier: recordingNotifier() }));
  assert.equal(r.errorKind, 'item');
  assert.equal(calls, 1);
});

test('notifications can be disabled per job', async () => {
  const job = fakeJob({ run: async () => { throw new ParseError('x'); } });
  const { config } = configFor([job], { fake: { retries: 0, notify: { onFailure: false } } });
  const notifier = recordingNotifier();
  await runJob(opts({ job, config, store: memoryStore(), notifier }));
  assert.equal(notifier.sent.length, 0);
});

test('a failing notifier marks the run failed (items still saved)', async () => {
  const job = fakeJob({ run: async () => [item('a')] });
  const { config } = configFor([job], { fake: { notify: { silentFirstRun: false } } });
  const store = memoryStore();
  const r = await runJob(opts({ job, config, store, notifier: { send: async () => { throw new Error('ntfy down'); } } }));
  assert.equal(r.status, 'failed');
  assert.equal(r.errorKind ?? (await store.listRuns('fake'))[0].errorKind, 'notify');
  assert.equal((await store.listItems('fake')).length, 1);
});

test('every run logs inputs, counts and duration; secrets are redacted in the stored log', async () => {
  registerSecret('my-ntfy-topic-xyz');
  const job = fakeJob({ run: async (ctx) => { ctx.log.info('using my-ntfy-topic-xyz and https://a.b/?token=zzz'); return [item('a')]; } });
  const { config } = configFor([job], { fake: { settings: { terms: ['forklift'] } } });
  const store = memoryStore();
  const r = await runJob(opts({ job, config, store, notifier: recordingNotifier() }));
  const run = await store.getRun(r.runId);
  assert.deepEqual(run.inputs.settings, { terms: ['forklift'] });
  assert.equal(run.itemCount, 1);
  assert.equal(typeof run.durationMs, 'number');
  const logText = JSON.stringify(run.log);
  assert.match(logText, /run start/);
  assert.match(logText, /run finish/);
  assert.ok(!logText.includes('my-ntfy-topic-xyz'));
  assert.ok(!logText.includes('zzz'));
  clearRegisteredSecrets();
});

test('ctx.now is fixed for the run (deterministic)', async () => {
  const seen = [];
  const job = fakeJob({ run: async (ctx) => { seen.push(ctx.now.toISOString()); return [item('a', { timestamp: undefined })]; } });
  const { config } = configFor([job]);
  const now = new Date('2026-03-03T03:03:03Z');
  const r = await runJob(opts({ job, config, store: memoryStore(), notifier: recordingNotifier(), now }));
  assert.equal(seen[0], now.toISOString());
  assert.equal(r.items[0].timestamp, now.toISOString());
});
