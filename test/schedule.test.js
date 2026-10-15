import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, cronMatches, previousFire, isDue } from '../src/core/schedule.js';

test('parses lists, ranges and steps', () => {
  const c = parseCron('*/15 9-17 * * 1-5');
  assert.deepEqual([...c.minute], [0, 15, 30, 45]);
  assert.deepEqual([...c.hour], [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual([...c.dow], [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseCron('0 0 * * 7').dow], [0]);
  assert.throws(() => parseCron('61 * * * *'));
  assert.throws(() => parseCron('* * *'));
});

test('matches in a time zone', () => {
  const c = parseCron('0 8 * * *');
  // 2026-07-01 13:00 UTC is 08:00 in Chicago (CDT, UTC-5)
  assert.equal(cronMatches(c, new Date('2026-07-01T13:00:00Z'), 'America/Chicago'), true);
  assert.equal(cronMatches(c, new Date('2026-07-01T08:00:00Z'), 'America/Chicago'), false);
  assert.equal(cronMatches(c, new Date('2026-07-01T08:00:00Z'), 'UTC'), true);
});

test('previousFire finds the latest slot', () => {
  const c = parseCron('0 */3 * * *');
  assert.equal(previousFire(c, new Date('2026-07-01T07:42:10Z')).toISOString(), '2026-07-01T06:00:00.000Z');
});

test('due when last run predates the latest fire time', () => {
  const now = new Date('2026-07-01T07:42:00Z');
  assert.equal(isDue({ cron: '0 */3 * * *', now, lastRunAt: null }).due, true);
  assert.equal(isDue({ cron: '0 */3 * * *', now, lastRunAt: '2026-07-01T05:10:00Z' }).due, true);
  assert.equal(isDue({ cron: '0 */3 * * *', now, lastRunAt: '2026-07-01T06:20:00Z' }).due, false);
});
