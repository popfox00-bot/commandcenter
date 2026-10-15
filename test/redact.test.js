import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactUrl, registerSecret, clearRegisteredSecrets, redactString } from '../src/core/redact.js';
import { createLogger } from '../src/core/logger.js';

test('sensitive query params and userinfo are masked', () => {
  assert.equal(redactUrl('https://u:p@x.com/a?q=fork&token=abc123&api_key=zz'), 'https://REDACTED@x.com/a?q=fork&token=[REDACTED]&api_key=[REDACTED]');
  assert.equal(redactUrl('https://x.com/?zipCode=12345&code=999'), 'https://x.com/?zipCode=12345&code=[REDACTED]');
});

test('registered secret values are masked anywhere', () => {
  registerSecret('super-secret-topic-123');
  assert.equal(redactString('posting to super-secret-topic-123 now'), 'posting to [REDACTED] now');
  clearRegisteredSecrets();
});

test('deep redaction masks sensitive keys but keeps structure', () => {
  const out = redact({ headers: { Authorization: 'Bearer x', accept: 'json' }, nested: [{ password: 'p', name: 'n' }], url: 'https://a.b/?sig=1' });
  assert.deepEqual(out, { headers: { Authorization: '[REDACTED]', accept: 'json' }, nested: [{ password: '[REDACTED]', name: 'n' }], url: 'https://a.b/?sig=[REDACTED]' });
});

test('logger redacts before printing and buffering', () => {
  registerSecret('ingest-secret-value');
  const printed = [];
  const log = createLogger({ sink: (e) => printed.push(JSON.stringify(e)) });
  log.info('calling https://w.dev/x?token=t0k3n', { secret: 'ingest-secret-value', note: 'uses ingest-secret-value' });
  const all = printed.join('') + JSON.stringify(log.entries());
  assert.ok(!all.includes('t0k3n'));
  assert.ok(!all.includes('ingest-secret-value'));
  clearRegisteredSecrets();
});
