import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from '../shared/hmac.js';

test('valid signatures verify; tampering and stale timestamps fail', async () => {
  const now = Date.now();
  const parts = { method: 'POST', path: '/ingest/items', timestamp: String(now), body: '{"a":1}' };
  const signature = await sign('s3cret-value', parts);
  assert.equal((await verify('s3cret-value', { ...parts, signature, now })).ok, true);
  assert.equal((await verify('other-secret', { ...parts, signature, now })).ok, false);
  assert.equal((await verify('s3cret-value', { ...parts, body: '{"a":2}', signature, now })).ok, false);
  assert.equal((await verify('s3cret-value', { ...parts, path: '/ingest/jobs', signature, now })).ok, false);
  assert.equal((await verify('s3cret-value', { ...parts, signature, now: now + 10 * 60_000 })).reason, 'timestamp outside allowed window');
});
