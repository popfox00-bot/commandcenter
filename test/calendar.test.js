// Calendar: the day/week/month date math (web/lib/calendar.js), personal events with repeats
// (web/apps/calendar/calendar-core.js), and the local college football teams for a ZIP's place
// (web/apps/updates/college-sites.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, parseDay, addDays, addMonths, startOfWeek, viewDays, step, title, byDay } from '../web/lib/calendar.js';
import { newEvent, normalizeEvent, occursOn, occurrences, clock, when } from '../web/apps/calendar/calendar-core.js';
import { nearbyColleges, miles, COLLEGE_SITES, normName } from '../web/apps/updates/college-sites.js';
import { redirect } from '../web/apps/index.js';

test('day keys: local dates, adding days and months, the week\'s Sunday', () => {
  assert.equal(dayKey(new Date(2026, 9, 30, 23, 59)), '2026-10-30');
  assert.equal(dayKey(parseDay('2026-03-08')), '2026-03-08');
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(addDays('2026-03-07', 2), '2026-03-09', 'across a daylight-saving change');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28', 'the 31st becomes the last day of a shorter month');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(startOfWeek('2026-10-30'), '2026-10-25', 'Friday → the Sunday before');
  assert.equal(startOfWeek('2026-10-25'), '2026-10-25');
  assert.equal(startOfWeek('2026-10-30', 1), '2026-10-26', 'weeks starting Monday');
});

test('views: a day, a week from Sunday, a month in whole weeks; stepping and titles', () => {
  assert.deepEqual(viewDays('day', '2026-10-30').days, ['2026-10-30']);
  const week = viewDays('week', '2026-10-30');
  assert.deepEqual([week.days.length, week.from, week.to], [7, '2026-10-25', '2026-11-01']);
  const oct = viewDays('month', '2026-10-30');
  assert.equal(oct.from, '2026-09-27'); assert.equal(oct.to, '2026-11-01'); assert.equal(oct.days.length, 35);
  assert.equal(viewDays('month', '2026-08-10').days.length, 42, 'August 2026 spans six weeks');
  assert.equal(viewDays('month', '2026-02-10').days.length, 28, 'February 2026 is exactly four weeks');
  assert.equal(step('week', '2026-10-30', 1), '2026-11-06');
  assert.equal(step('month', '2026-10-30', -1), '2026-09-30');
  assert.equal(step('day', '2026-12-31', 1), '2027-01-01');
  assert.equal(title('week', '2026-10-30'), 'Oct 25 – 31, 2026');
  assert.equal(title('week', '2026-11-01'), 'Nov 1 – 7, 2026');
  assert.equal(title('week', '2026-12-30'), 'Dec 27 – Jan 2, 2027');
  assert.equal(title('month', '2026-10-30'), 'October 2026');
  const m = byDay([{ d: 'a' }, { d: 'b' }, { d: 'a' }], (x) => x.d);
  assert.deepEqual([...m.keys()], ['a', 'b']); assert.equal(m.get('a').length, 2);
});

test('events: checked and tidied; repeats fall on the right days; each day in time order', () => {
  assert.equal(normalizeEvent({ title: '  ', date: '2026-10-30' }), null, 'a title is needed');
  assert.equal(normalizeEvent({ title: 'x', date: '10/30/2026' }), null, 'and a date');
  const e = normalizeEvent({ id: 1, title: ' Dentist ', date: '2026-10-30', start: '14:30', end: '14:00', color: 'nope', repeat: 'hourly' });
  assert.deepEqual([e.title, e.allDay, e.start, e.end, e.color, e.repeat], ['Dentist', false, '14:30', '', '#0a84ff', 'none'], 'an end before the start is dropped');
  assert.equal(normalizeEvent({ title: 'x', date: '2026-10-30', start: '' }).allDay, true, 'no start time: all day');

  const weekly = normalizeEvent({ title: 'Trash day', date: '2026-10-28', allDay: true, repeat: 'weekly', until: '2026-11-18' });
  assert.equal(occursOn(weekly, '2026-11-04'), true);
  assert.equal(occursOn(weekly, '2026-11-05'), false);
  assert.equal(occursOn(weekly, '2026-11-25'), false, 'not after "until"');
  assert.equal(occursOn(weekly, '2026-10-21'), false, 'not before it starts');
  const monthly = normalizeEvent({ title: 'Rent', date: '2026-01-31', allDay: true, repeat: 'monthly' });
  assert.equal(occursOn(monthly, '2026-03-31'), true);
  assert.equal(occursOn(monthly, '2026-02-28'), false, 'a 31st repeats only in months that have one');
  const yearly = normalizeEvent({ title: 'Birthday', date: '2020-11-02', allDay: true, repeat: 'yearly' });
  assert.equal(occursOn(yearly, '2026-11-02'), true);

  const lunch = normalizeEvent({ id: 'l', title: 'Lunch', date: '2026-11-04', start: '12:00', end: '13:00' });
  const call = normalizeEvent({ id: 'c', title: 'Call', date: '2026-11-04', start: '09:15' });
  const occ = occurrences([lunch, weekly, call], '2026-11-04', '2026-11-05');
  assert.deepEqual(occ.map((o) => o.event.title), ['Trash day', 'Call', 'Lunch'], 'all-day first, then by start time');
  assert.equal(occurrences([weekly], '2026-10-25', '2026-11-22').length, 4);

  assert.equal(clock('09:30'), '9:30 AM'); assert.equal(clock('00:00'), '12 AM'); assert.equal(clock('13:00'), '1 PM');
  assert.equal(when(lunch), '12 PM – 1 PM'); assert.equal(when(weekly), 'All day');
  const fresh = newEvent({ id: 'n', date: '2026-10-30', now: new Date(2026, 9, 30, 14, 20) });
  assert.deepEqual([fresh.start, fresh.end], ['15:00', '16:00'], 'a new event today starts at the next hour');
});

test('local college football: FBS teams near a ZIP\'s place, nearest first; the nearest few when none is close', () => {
  const espn = ['Colorado Buffaloes', 'Colorado State Rams', 'Air Force Falcons', 'Wyoming Cowboys', 'Alabama Crimson Tide', 'San José State Spartans', 'Hawai\'i Rainbow Warriors', 'Some FCS Team']
    .map((name, i) => ({ id: String(i + 1), abbr: '', name }));
  const lakewood = { lat: 39.7436, lon: -105.0617 };
  const near = nearbyColleges(espn, lakewood);
  assert.deepEqual(near.map((t) => t.name), ['Colorado Buffaloes', 'Air Force Falcons', 'Colorado State Rams', 'Wyoming Cowboys']);
  assert.ok(near[0].miles >= 15 && near[0].miles <= 25, `Boulder is ~20 miles from Lakewood: ${near[0].miles}`);
  const nowhere = nearbyColleges(espn, { lat: 45.0, lon: -110.0 });
  assert.equal(nowhere.length, 2, 'none within 150 miles: the two nearest');
  const known = new Set([...COLLEGE_SITES.values()].map((v) => v.name)).size;
  assert.equal(known, 136, `FBS teams known: ${known}`);
  assert.equal(normName('San José State Spartans'), normName('San Jose State Spartans'));
  assert.ok(Math.abs(miles({ lat: 39.74, lon: -104.99 }, { lat: 40.71, lon: -74.01 }) - 1630) < 15, 'Denver to New York');
});

test('old Tools links go to the new apps', () => {
  assert.equal(redirect('#/tools'), '#/');
  assert.equal(redirect('#/tools/editor'), '#/files');
  assert.equal(redirect('#/tools/editor/pdf'), '#/files/pdf');
  assert.equal(redirect('#/tools/convert'), '#/files/convert');
  assert.equal(redirect('#/tools/draw'), '#/draw');
  assert.equal(redirect('#/tools/qr'), '#/qr');
  assert.equal(redirect('#/files'), null);
});
