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

test('previousFire agrees with a brute-force minute scan (several zones and crons)', () => {
  const crons = ['17 6-21/3 * * *', '7 7 * * *', '*/20 * * * 1-5', '0 0 1 * *', '30 2 * * 0'];
  const zones = ['UTC', 'America/Chicago', 'Asia/Kolkata', 'Australia/Adelaide'];
  const nows = ['2026-03-08T08:13:00Z', '2026-11-01T06:59:00Z', '2026-07-15T23:45:00Z'];
  for (const c of crons) for (const z of zones) for (const n of nows) {
    const cron = parseCron(c);
    const now = new Date(n);
    let brute = null;
    for (let i = 0; i <= 3 * 24 * 60 && !brute; i++) {
      const d = new Date(Math.floor(now.getTime() / 60000) * 60000 - i * 60000);
      if (cronMatches(cron, d, z)) brute = d;
    }
    const fast = previousFire(cron, now, z, 3 * 24 * 60);
    assert.equal(fast?.toISOString() ?? null, brute?.toISOString() ?? null, `${c} ${z} ${n}`);
  }
});

test('previousFire is cheap enough for a Worker cron', () => {
  const t = performance.now();
  for (let i = 0; i < 10; i++) previousFire(parseCron('0 0 1 1 *'), new Date('2026-10-15T12:00:00Z'), 'America/Chicago');
  assert.ok((performance.now() - t) / 10 < 10, 'one 8-day lookback under 10 ms');
});
