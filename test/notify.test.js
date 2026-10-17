import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNtfyNotifier, failureNotification, planNewItemNotifications } from '../src/core/notify.js';

test('ntfy notifier posts JSON with topic, click URL, priority and optional auth', async () => {
  const calls = [];
  const n = createNtfyNotifier({ server: 'https://ntfy.example/', topic: 'cc-abc123xyz', token: 'tk_secret', fetchFn: async (url, init) => { calls.push({ url, init }); return new Response('{}'); } });
  await n.send({ title: 'T', message: 'M', url: 'https://example.com/listing/1', priority: 'high', tags: ['x'] });
  assert.equal(calls[0].url, 'https://ntfy.example/');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tk_secret');
  assert.deepEqual(JSON.parse(calls[0].init.body), { topic: 'cc-abc123xyz', title: 'T', message: 'M', priority: 4, tags: ['x'], click: 'https://example.com/listing/1' });
});

test('ntfy HTTP errors surface (so the runner can mark the run failed)', async () => {
  const n = createNtfyNotifier({ topic: 't-123456', fetchFn: async () => new Response('', { status: 429 }) });
  await assert.rejects(n.send({ title: 'x', message: 'y' }), /HTTP 429/);
});

test('messages are trimmed to ntfy limits', async () => {
  let body;
  const n = createNtfyNotifier({ topic: 't-123456', fetchFn: async (_, init) => { body = JSON.parse(init.body); return new Response('{}'); } });
  await n.send({ title: 'x'.repeat(400), message: 'y'.repeat(10_000) });
  assert.equal(body.title.length, 250);
  assert.ok(body.message.length <= 3800);
});

test('failure notifications label the failure kind and are redacted', () => {
  const n = failureNotification({ job: { name: 'Price watcher' }, error: 'GET https://x.com/?token=abc failed', errorKind: 'fetch', attempts: 3 });
  assert.equal(n.title, '❌ Price watcher: Network/HTTP failure');
  assert.ok(!n.message.includes('abc'));
  assert.match(n.message, /Attempts: 3/);
});

test('no notifications when onNew is off or nothing is new', () => {
  const job = { name: 'J' };
  const cfg = { onNew: false, maxPerRun: 5, silentFirstRun: false, priority: 'default' };
  assert.deepEqual(planNewItemNotifications({ job, items: [{ title: 'a' }], notifyCfg: cfg, firstRun: false }), []);
  assert.deepEqual(planNewItemNotifications({ job, items: [], notifyCfg: { ...cfg, onNew: true }, firstRun: false }), []);
});
