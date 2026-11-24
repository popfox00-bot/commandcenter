// Clock, Units' time zones and the Calculator: the parts that aren't the screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPlaces, partsIn, offsetMin, instantOf, diffLabel, dayLabel, hm12, DEFAULT_CLOCKS } from '../web/lib/places.js';
import { newCalc, press, screen, evaluate } from '../web/apps/calculator/calc-core.js';

test('time zones: places by name, offsets with daylight saving, a time in one place in another', () => {
  assert.deepEqual(DEFAULT_CLOCKS.map((c) => c.name), ['Colorado', 'California', 'New York', 'Hawaii', 'London', 'Germany', 'Romania']);
  assert.equal(searchPlaces('colo')[0].zone, 'America/Denver');
  assert.equal(searchPlaces('romania')[0].zone, 'Europe/Bucharest');
  assert.ok(searchPlaces('lisbon').some((p) => p.zone === 'Europe/Lisbon'), 'a zone by its own name');
  const winter = Date.UTC(2026, 0, 15, 12); const summer = Date.UTC(2026, 6, 15, 12);
  assert.equal(offsetMin('America/Denver', winter), -420); assert.equal(offsetMin('America/Denver', summer), -360);
  assert.equal(offsetMin('Pacific/Honolulu', summer), -600);
  // 3:00 PM in Colorado on Nov 24, 2026 is 10:00 PM in London and midnight (the next day) in Romania.
  const t = instantOf('America/Denver', 2026, 11, 24, 15, 0);
  assert.equal(hm12(partsIn('Europe/London', t)), '10:00 PM');
  const ro = partsIn('Europe/Bucharest', t); assert.equal(hm12(ro), '12:00 AM'); assert.equal(ro.d, 25);
  assert.equal(dayLabel('Europe/Bucharest', 'America/Denver', t), 'Tomorrow');
  assert.equal(diffLabel(offsetMin('Europe/London', t) - offsetMin('America/Denver', t)), '+7h');
  assert.equal(diffLabel(330), '+5h 30m'); assert.equal(diffLabel(-60), '−1h'); assert.equal(diffLabel(0), 'same time');
});

test('calculator: precedence, decimals, %, ±, repeat =, C then AC, errors', () => {
  const run = (keys) => { let s = newCalc(); for (const k of keys) s = press(s, k); return screen(s); };
  assert.equal(run(['2', '+', '3', '×', '4', '=']).main, '14');
  assert.equal(run(['0', '.', '1', '+', '0', '.', '2', '=']).main, '0.3');
  assert.equal(run(['5', '0', '+', '1', '0', '%', '=']).main, '55');
  assert.equal(run(['2', '0', '0', '×', '5', '%', '=']).main, '10');
  assert.equal(run(['8', '÷', '0', '=']).main, 'Error');
  assert.equal(run(['2', '+', '3', '=', '=']).main, '8');
  assert.equal(run(['1', '2', '3', '4', '5', '6', '7']).main, '1,234,567');
  assert.equal(run(['5', '±']).main, '-5');
  assert.equal(run(['9', '+', '+', '×', '2', '=']).main, '18', 'a second operator replaces the first');
  assert.equal(run(['7', '+', '3']).expr, '7 +');
  assert.equal(run(['7', 'C']).clear, 'AC'); assert.equal(run(['7']).clear, 'C');
  assert.equal(evaluate([10, '−', 4, '÷', 2]), 8);
});

test('clock: stopwatch and timer text', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
  const { swText, timerText } = await import('../web/apps/clock/clock.js');
  assert.equal(swText(62340), '01:02.34'); assert.equal(swText(3723000), '1:02:03.00');
  assert.equal(timerText(245), '4:05'); assert.equal(timerText(3723), '1:02:03'); assert.equal(timerText(-3), '0:00');
});
