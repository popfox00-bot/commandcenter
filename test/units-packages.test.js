// Units (web/apps/units/units-core.js), Packages (web/apps/packages/packages-core.js and the Worker's
// worker/src/track.js) and Suggest Improvements' Drive file (web/lib/suggestions.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, convertMoney, show, parseRates } from '../web/apps/units/units-core.js';
import { detectCarrier, clean, trackUrl, statusOf } from '../web/apps/packages/packages-core.js';
import { checkNumbers, parseTrackInfo, track, TrackError } from '../worker/src/track.js';
import { toMarkdown } from '../web/lib/suggestions.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e * Math.max(1, Math.abs(b)), `${a} ≈ ${b}`);

test('units: lengths, weights, volumes and the rest by their factors; temperature by its formulas', () => {
  near(convert('length', 1, 'mi', 'km'), 1.609344);
  near(convert('length', 12, 'in', 'ft'), 1);
  near(convert('weight', 1, 'kg', 'lb'), 2.20462262);
  near(convert('volume', 1, 'gal', 'cup'), 16);
  near(convert('temperature', 212, 'F', 'C'), 100);
  near(convert('temperature', 0, 'C', 'K'), 273.15);
  near(convert('temperature', -40, 'C', 'F'), -40);
  near(convert('speed', 60, 'mph', 'kph'), 96.56064);
  near(convert('data', 1, 'GiB', 'MB'), 1073.741824);
  assert.ok(Number.isNaN(convert('length', 1, 'mi', 'kg')), 'not the same kind');
  assert.ok(Number.isNaN(convert('length', 'x', 'mi', 'km')));
  assert.equal(show(1609.344), (1609.34).toLocaleString());
  assert.equal(show(NaN), '—');
});

test('units: currency by the day\'s rates (from either source), 2 decimals (yen none)', () => {
  const r = parseRates({ base: 'USD', date: '2026-11-18', rates: { EUR: 0.9, JPY: 150, GBP: 0.8, bad: 1, XXX: -1 } });
  assert.deepEqual(r, { base: 'USD', date: '2026-11-18', rates: { EUR: 0.9, JPY: 150, GBP: 0.8, USD: 1 } });
  near(convertMoney(10, 'USD', 'EUR', r.rates), 9);
  near(convertMoney(9, 'EUR', 'GBP', r.rates), 8);
  assert.equal(show(1500, 'JPY'), (1500).toLocaleString(undefined, { maximumFractionDigits: 0 }));
  assert.equal(parseRates({ base_code: 'USD', time_last_update_utc: 'Tue', rates: { EUR: 0.9 } }).rates.EUR, 0.9);
  assert.equal(parseRates({}), null);
  assert.ok(Number.isNaN(convertMoney(1, 'USD', 'ZZZ', r.rates)));
});

test('packages: the carrier from the number\'s shape; its tracking page; a service\'s status as a step', () => {
  assert.equal(detectCarrier('1Z999AA10123456784'), 'ups');
  assert.equal(detectCarrier('9400 1000 0000 0000 0000 00'), 'usps');
  assert.equal(detectCarrier('EA123456789US'), 'usps');
  assert.equal(detectCarrier('123456789012'), 'fedex');
  assert.equal(detectCarrier('1234567890'), 'dhl');
  assert.equal(detectCarrier('TBA123456789012'), 'amazon');
  assert.equal(detectCarrier('hello'), '');
  assert.equal(clean(' 1z99-9aa '), '1Z999AA');
  assert.equal(trackUrl('ups', '1Z999AA10123456784'), 'https://www.ups.com/track?tracknum=1Z999AA10123456784');
  assert.match(trackUrl('other', 'ABC123'), /google\.com\/search\?q=track%20ABC123/);
  assert.deepEqual(statusOf('Delivered'), { step: 3, text: 'Delivered', problem: false });
  assert.equal(statusOf('OutForDelivery').step, 2);
  assert.equal(statusOf('InTransit').step, 1);
  assert.equal(statusOf('Exception').problem, true);
  assert.equal(statusOf('').step, -1);
});

test('packages, the Worker: numbers checked; 17TRACK\'s answer cut down (newest update first); no key, a clear error', async () => {
  assert.deepEqual(checkNumbers([{ number: '1z 999-aa1', carrier: 'ups' }]), [{ number: '1Z999AA1', carrier: 'ups' }]);
  assert.throws(() => checkNumbers([]), TrackError);
  assert.throws(() => checkNumbers([{ number: '<script>' }]), TrackError);
  const answer = { code: 0, data: { accepted: [{ number: '1Z1', track_info: { latest_status: { status: 'InTransit', sub_status: 'InTransit_Other' }, time_metrics: { estimated_delivery_date: { from: '2026-11-20', to: '2026-11-21' } }, tracking: { providers: [{ events: [{ time_iso: '2026-11-17T08:00:00Z', description: 'Picked up', location: 'Denver, CO' }, { time_iso: '2026-11-18T09:00:00Z', description: 'Departed facility', location: 'Kansas City, MO' }] }] } } }], rejected: [{ number: 'X9', error: { message: 'invalid number' } }] } };
  const out = parseTrackInfo(answer);
  assert.deepEqual(out[0], { number: '1Z1', status: 'InTransit', sub: 'InTransit_Other', eta: '2026-11-21', events: [{ time: '2026-11-18T09:00:00Z', text: 'Departed facility', place: 'Kansas City, MO' }, { time: '2026-11-17T08:00:00Z', text: 'Picked up', place: 'Denver, CO' }] });
  assert.equal(out[1].error, 'invalid number');
  await assert.rejects(track([{ number: '1Z1', carrier: 'ups' }], ''), /isn't set up/);
  // With a key: registered, then read; the key sent as 17TRACK's header, never anywhere else.
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, key: init.headers['17token'], body: JSON.parse(init.body) }); return { ok: true, json: async () => answer }; };
  const got = await track([{ number: '1Z1', carrier: 'ups' }], 'k3y', fake);
  assert.deepEqual(calls.map((c) => c.url.split('/').pop()), ['register', 'gettrackinfo']);
  assert.deepEqual(calls[0].body, [{ number: '1Z1', carrier: 100002 }]);
  assert.ok(calls.every((c) => c.key === 'k3y'));
  assert.equal(got[0].status, 'InTransit');
});

test('suggestions: the Drive file lists each with its date and id, a line each (newlines kept as " / ")', () => {
  const md = toMarkdown([{ id: 's1', text: 'Dark mode\nfor Draw', at: Date.UTC(2026, 10, 18, 12) }], new Date(Date.UTC(2026, 10, 18, 13)));
  assert.match(md, /^# Command Center: suggested improvements/);
  assert.match(md, /- \[ \] 2026-11-18 \(s1\): Dark mode \/ for Draw/);
  assert.match(toMarkdown([], new Date()), /\(none\)/);
});

test('the Vault has no secret tap sequence any more (it\'s opened from Files\' settings → Admin)', async () => {
  const lock = await import('../web/lib/hidden-lock.js');
  assert.equal(lock.sequenceWatcher, undefined); assert.equal(lock.SEQUENCE, undefined);
  assert.equal(typeof lock.tryPassword, 'function');
});
