// Updates app + jobs: Weather Service / Open-Meteo / ESPN parsing, the alert rules, and both jobs run
// end to end through the real runner against a fake network shaped like the real APIs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../web/apps/updates/weather-core.js';
import * as S from '../web/apps/updates/sports-core.js';
import { runJob } from '../src/core/runner.js';
import weatherJob from '../src/jobs/weather-alerts.js';
import sportsJob from '../src/jobs/sports.js';
import { configFor, memoryStore, recordingNotifier, quietLog, noSleep } from './helpers/harness.js';

import { NOW, TZ, iso, pointJson, alertsJson, hourlyJson, gridJson, airJson, DEN, KC, ev, scheduleJson } from './fixtures/updates.js';

// ---------- weather ----------

test('weather: Weather Service and Open-Meteo responses are read correctly', () => {
  assert.deepEqual(W.parseZip({ 'post code': '80214', places: [{ 'place name': 'Lakewood', 'state abbreviation': 'CO', latitude: '39.7436', longitude: '-105.0617' }] }), { zip: '80214', lat: 39.7436, lon: -105.0617, name: 'Lakewood, CO' });
  assert.equal(W.parsePoint(pointJson).city, 'Lakewood, CO');
  const alerts = W.parseAlerts(alertsJson);
  assert.deepEqual(alerts.map((a) => a.event), ['Winter Storm Warning', 'Special Weather Statement'], 'no cancellations or tests');
  assert.equal(alerts[0].key, 'urn:oid:2.49.0.1.840.0.aaa', 'updates keep the original alert\'s key');
  assert.equal(alerts[0].headline, 'WINTER STORM WARNING IN EFFECT FROM 6 PM SATURDAY TO NOON SUNDAY');
  assert.equal(W.windMph('15 to 25 mph'), 25);
  assert.equal(W.windMph('40 km/h'), 25);
  assert.equal(W.durationHours('P1DT6H'), 30);
  const gusts = W.parseGusts(gridJson);
  assert.equal(gusts.length, 3 + 2 + 1 + 30);
  assert.equal(gusts[3].mph, 50);
  const air = W.parseAirQuality(airJson);
  assert.equal(air.now.aqi, 62);
  assert.equal(air.hourly[25].ozone, 155);
  assert.equal(W.parsePeriods(hourlyJson)[2].windMph, 25);
  assert.equal(W.weatherEmoji('Chance Snow Showers'), '🌨️');
  assert.equal(W.weatherEmoji('Clear', false), '🌙');
});

test('weather rules: alerts, freeze, wind tiers, air quality; stable keys', () => {
  const c = W.assess({
    alerts: W.parseAlerts(alertsJson), hourly: W.parsePeriods(hourlyJson), gusts: W.parseGusts(gridJson), air: W.parseAirQuality(airJson),
    now: NOW, timeZone: TZ, lat: 39.7436, lon: -105.0617,
  });
  const byKind = Object.fromEntries(c.map((x) => [x.key, x]));
  assert.ok(byKind['nws:urn:oid:2.49.0.1.840.0.aaa'], 'Moderate warning included');
  assert.ok(!c.some((x) => x.title === 'Special Weather Statement'), 'Minor excluded by default');
  const freeze = c.find((x) => x.kind === 'freeze');
  assert.equal(freeze.key, 'freeze:2026-10-18');
  assert.match(freeze.title, /^Hard freeze: low 24°F tonight$/);
  assert.match(freeze.detail, /from tonight 10:00 PM to tomorrow 9:00 AM/);
  const winds = c.filter((x) => x.kind === 'wind').map((x) => [x.key, x.title]);
  assert.deepEqual(winds, [
    ['wind:2026-10-18:damaging', 'Damaging wind: gusts to 62 mph tomorrow'],
    ['wind:2026-10-17', 'Strong wind: gusts to 50 mph tonight'],
  ]);
  const aqi = c.find((x) => x.kind === 'aqi');
  assert.equal(aqi.key, 'aqi:2026-10-18:3');
  assert.match(aqi.title, /Air quality tomorrow: Unhealthy \(AQI 155\)/);
  assert.match(aqi.detail, /ozone/);
  assert.equal(c[0].level, 'danger', 'most serious first');

  // Same forecast in January: no freeze push (every night freezes), but bitter cold still alerts.
  const jan = Date.parse('2026-01-15T20:00:00Z');
  const cold = W.assess({ hourly: [{ start: new Date(jan + 8 * 3.6e6).toISOString(), end: new Date(jan + 9 * 3.6e6).toISOString(), tempF: 5 }, { start: new Date(jan + 9 * 3.6e6).toISOString(), end: new Date(jan + 10 * 3.6e6).toISOString(), tempF: 20 }], now: jan, timeZone: TZ });
  assert.deepEqual(cold.map((x) => x.kind), ['cold']);
  assert.match(cold[0].title, /Bitter cold: 5°F tonight/);
  assert.deepEqual(W.assess({ hourly: [{ start: new Date(jan + 8 * 3.6e6).toISOString(), end: new Date(jan + 9 * 3.6e6).toISOString(), tempF: 20 }], now: jan, timeZone: TZ }), []);
  assert.equal(W.aqiLevel(42), 0);
  assert.equal(W.aqiLevel(101), 2);
});

// ---------- sports ----------

test('sports: schedule parsing, results, lines and what to show', () => {
  const games = S.parseSchedule(scheduleJson);
  assert.deepEqual(games.map((g) => g.id), ['300', '401', '402', '403'], 'sorted by date');
  assert.equal(S.result(games[1], 'den'), 'W 24–17');
  assert.equal(S.result(games[0], '7'), 'L 20–31');
  assert.equal(S.gameLine(games[1], 'den', NOW, TZ), 'W 24–17 vs Raiders');
  assert.equal(S.gameLine(games[2], 'den', NOW, TZ), 'Today 4:30 PM vs Chiefs · CBS · DEN -3.5');
  const live = { ...games[2], state: 'in', detail: '3rd 5:12', home: { ...games[2].home, score: '17' }, away: { ...games[2].away, score: '14' } };
  assert.equal(S.gameLine(live, 'den', NOW, TZ), 'LIVE · 3rd 5:12 · DEN 17–14 KC');
  const pick = S.pickGames(games, NOW);
  assert.equal(pick.next.id, '402'); assert.equal(pick.last.id, '401'); assert.equal(pick.live, null);
  // Scoreboard-style events carry the score as a plain string.
  const sb = S.parseGame({ id: '9', date: iso(0), competitions: [{ competitors: [{ homeAway: 'home', team: DEN, score: '3' }, { homeAway: 'away', team: KC, score: '0' }], status: { type: { state: 'in', shortDetail: '1st 2:00' } } }] });
  assert.equal(sb.home.score, '3');
  const t = S.parseTeam({ team: { ...DEN, alternateColor: '002244', record: { items: [{ type: 'total', summary: '5-2' }] }, standingSummary: '1st in AFC West', nextEvent: [] } });
  assert.deepEqual([t.record, t.standing, t.color], ['5-2', '1st in AFC West', '#fb4f14']);
  assert.deepEqual(S.parseTeamList({ sports: [{ leagues: [{ teams: [{ team: KC }, { team: DEN }] }] }] }).map((x) => x.abbr), ['DEN', 'KC']);
});

test('sports events: recent finals and game-day reminders only', () => {
  const games = S.parseSchedule(scheduleJson);
  const ev2 = S.sportsEvents({ league: 'nfl', team: 'den', teamName: 'Broncos', games, now: NOW, timeZone: TZ });
  assert.deepEqual(ev2.map((e) => [e.key, e.title]), [
    ['final:nfl:401', 'Broncos: W 24–17 vs Las Vegas Raiders'],
    ['gameday:nfl:402', 'Game day: Broncos vs Kansas City Chiefs'],
  ]);
  assert.match(ev2[1].detail, /^Today 4:30 PM · TV: CBS · Line: DEN -3\.5, O\/U 44\.5 · Empower Field/);
  assert.deepEqual(S.sportsEvents({ league: 'nfl', team: 'den', games, now: NOW, timeZone: TZ, gameDay: false }).map((e) => e.kind), ['final']);
});

// ---------- the jobs, through the real runner ----------

function fakeNet(routes) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    const u = String(url);
    if (u.endsWith('/robots.txt')) return new Response('', { status: 404 });
    const hit = Object.entries(routes).find(([k]) => u.startsWith(k));
    if (!hit) return new Response('not found', { status: 404 });
    return Response.json(hit[1]);
  };
  return { fetchFn, calls };
}
const opts = (o) => ({ log: quietLog(), sleepFn: noSleep, closeBrowserAfter: false, ...o });

test('weather-alerts job: pushes each condition once, with the Weather Service User-Agent', async () => {
  const { fetchFn, calls } = fakeNet({
    'https://api.weather.gov/points/': pointJson,
    'https://api.weather.gov/alerts/active': alertsJson,
    'https://api.weather.gov/gridpoints/BOU/58,61/forecast/hourly': hourlyJson,
    'https://api.weather.gov/gridpoints/BOU/58,61': gridJson,
    'https://air-quality-api.open-meteo.com/': airJson,
  });
  const { config } = configFor([weatherJob], { 'weather-alerts': { notify: { silentFirstRun: false } } });
  const store = memoryStore(); const notifier = recordingNotifier();
  const r1 = await runJob(opts({ job: weatherJob, config, store, notifier, now: new Date(NOW), fetchFn }));
  assert.equal(r1.status, 'success', r1.error);
  assert.deepEqual(r1.newItems.map((i) => i.fields.kind).sort(), ['aqi', 'freeze', 'nws', 'wind', 'wind']);
  const storm = notifier.sent.find((n) => /Winter Storm/.test(n.title));
  assert.equal(storm.title, '⚠️ Winter Storm Warning');
  assert.match(storm.message, /WINTER STORM WARNING IN EFFECT[\s\S]*Until /);
  assert.equal(notifier.sent.find((n) => /Damaging/.test(n.title)).priority, 'high');
  assert.ok(calls.filter((c) => c.url.includes('api.weather.gov') && !c.url.endsWith('robots.txt')).every((c) => /^CommandCenter\/1\.0 \(github\.com\/popfox00-bot\/commandcenter\)$/.test(c.headers['user-agent'])));

  const sentBefore = notifier.sent.length;
  const r2 = await runJob(opts({ job: weatherJob, config, store, notifier, now: new Date(NOW + 20 * 60_000), fetchFn }));
  assert.equal(r2.newItems.length, 0, 'same conditions 20 minutes later: nothing new');
  assert.equal(notifier.sent.length, sentBefore);
});

test('weather-alerts job: a broken alerts feed fails loudly; missing gusts/air quality only warn', async () => {
  const bad = fakeNet({ 'https://api.weather.gov/points/': pointJson, 'https://api.weather.gov/alerts/active': { nope: true }, 'https://api.weather.gov/gridpoints/BOU/58,61/forecast/hourly': hourlyJson });
  const { config } = configFor([weatherJob], { 'weather-alerts': { retries: 0 } });
  const r = await runJob(opts({ job: weatherJob, config, store: memoryStore(), notifier: recordingNotifier(), now: new Date(NOW), fetchFn: bad.fetchFn }));
  assert.equal(r.status, 'failed');
  assert.match(r.error, /features/);

  const partial = fakeNet({ 'https://api.weather.gov/points/': pointJson, 'https://api.weather.gov/alerts/active': alertsJson, 'https://api.weather.gov/gridpoints/BOU/58,61/forecast/hourly': hourlyJson });
  const r2 = await runJob(opts({ job: weatherJob, config, store: memoryStore(), notifier: recordingNotifier(), now: new Date(NOW), fetchFn: partial.fetchFn }));
  assert.equal(r2.status, 'success', r2.error);
  assert.deepEqual(r2.items.map((i) => i.fields.kind).sort(), ['freeze', 'nws']);
});

test('sports job: finals and game-day pushes, quiet overnight, one failing team doesn\'t sink the rest', async () => {
  const { fetchFn } = fakeNet({ 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/den/schedule': scheduleJson });
  const teams = [{ league: 'nfl', team: 'den', name: 'Broncos' }, { league: 'nba', team: 'den', name: 'Nuggets' }];
  const { config } = configFor([sportsJob], { sports: { retries: 0, notify: { silentFirstRun: false }, settings: { teams } } }, { timezone: TZ });
  const notifier = recordingNotifier();
  const r = await runJob(opts({ job: sportsJob, config, store: memoryStore(), notifier, now: new Date(NOW), fetchFn }));
  assert.equal(r.status, 'success', r.error);
  assert.deepEqual(notifier.sent.map((n) => n.title), ['🏈 Broncos: W 24–17 vs Las Vegas Raiders', '🏈 Game day: Broncos vs Kansas City Chiefs']);
  assert.match(notifier.sent[1].message, /TV: CBS/);
  assert.equal(notifier.sent[1].url, 'https://www.espn.com/nfl/game/_/gameId/402');

  // 3 AM Denver: no game-day reminder (the final still counts).
  const night = Date.parse('2026-10-17T09:00:00Z');
  const n2 = recordingNotifier();
  const sched2 = { events: [ev('500', new Date(night + 5 * 3.6e6).toISOString(), 'pre', DEN, KC, null, null)] };
  const r2 = await runJob(opts({ job: sportsJob, config, store: memoryStore(), notifier: n2, now: new Date(night), fetchFn: fakeNet({ 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/den/schedule': sched2 }).fetchFn }));
  assert.equal(r2.status, 'success');
  assert.deepEqual(r2.items.map((i) => i.title), []);

  // Every team failing is a failed run.
  const r3 = await runJob(opts({ job: sportsJob, config, store: memoryStore(), notifier: recordingNotifier(), now: new Date(NOW), fetchFn: fakeNet({}).fetchFn }));
  assert.equal(r3.status, 'failed');
});
