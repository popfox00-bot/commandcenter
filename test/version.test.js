// The version shown on the home screen and its history (web/version.js): newest first, each with a date
// and what changed, the current one the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, HISTORY } from '../web/version.js';

test('version: the history runs newest first, the current version is its first, each with a date and notes', () => {
  assert.equal(VERSION, HISTORY[0].v);
  const num = (v) => v.split('.').map(Number);
  for (let i = 1; i < HISTORY.length; i++) {
    const [a, b] = [num(HISTORY[i - 1].v), num(HISTORY[i].v)];
    assert.ok(a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]), `${HISTORY[i - 1].v} after ${HISTORY[i].v}`);
    assert.ok(HISTORY[i - 1].date >= HISTORY[i].date, `dates in order at ${HISTORY[i].v}`);
  }
  for (const h of HISTORY) { assert.match(h.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(h.notes.length > 5); }
  assert.equal(new Set(HISTORY.map((h) => h.v)).size, HISTORY.length, 'no version twice');
});
