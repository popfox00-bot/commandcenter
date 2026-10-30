// Browser test for the Updates app: home screen -> Updates, Weather and Sports tabs with the Weather
// Service, Open-Meteo and ESPN mocked (shapes from test/fixtures/updates.js), at a fixed time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { NOW, iso, ev, pointJson, alertsJson, hourlyJson, dailyJson, gridJson, airJson, scheduleJson, DEN } from '../fixtures/updates.js';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
let server; let browser; let origin;

before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = path.startsWith(BASE) ? path.slice(BASE.length) || 'index.html' : null;
    try { res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(await readFile(join(WEB, rel))); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
});
after(async () => { await browser?.close(); server?.close(); });

async function mockApis(context, extra = {}) {
  const seen = [];
  const json = (body) => (route) => { seen.push(route.request().url()); return route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } }); };
  await context.route('https://api.weather.gov/points/**', json(pointJson));
  await context.route('https://api.weather.gov/alerts/active**', json(alertsJson));
  await context.route('https://api.weather.gov/gridpoints/BOU/58,61/forecast/hourly', json(hourlyJson));
  await context.route('https://api.weather.gov/gridpoints/BOU/58,61/forecast', json(dailyJson));
  await context.route('https://api.weather.gov/gridpoints/BOU/58,61', json(gridJson));
  await context.route('https://air-quality-api.open-meteo.com/**', json(airJson));
  await context.route('https://api.zippopotam.us/us/80401', json({ 'post code': '80401', places: [{ 'place name': 'Golden', 'state abbreviation': 'CO', latitude: '39.73', longitude: '-105.21' }] }));
  await context.route('https://site.api.espn.com/apis/site/v2/sports/*/*/teams/*/schedule', json(scheduleJson));
  await context.route('https://site.api.espn.com/apis/v2/sports/football/nfl/standings', json({ children: [{ name: 'AFC', standings: { entries: [{ team: DEN }] } }, { name: 'NFC', children: [{ standings: { entries: [{ team: { id: '9', abbreviation: 'GB', displayName: 'Green Bay Packers' } }] } }] }] }));
  for (const [pattern, body] of Object.entries(extra)) await context.route(pattern, json(body));
  return seen;
}

async function openApp(context, hash = '') {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(NOW);
  await page.goto(`${origin}${BASE}${hash}`);
  return { page, errors };
}

test('Updates → Weather: alerts, heads-ups (freeze, wind, air quality), hourly and 7-day; ZIP change', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Denver' });
  const seen = await mockApis(context);
  const { page, errors } = await openApp(context);
  await page.click('.app-tile >> text=Updates');
  await page.waitForSelector('.upd-now');
  assert.equal(await page.textContent('#title'), 'Updates');
  assert.match(await page.textContent('.upd-loc strong'), /Lakewood, CO · 80214/);
  assert.match(await page.textContent('.upd-now'), /45°[\s\S]*Mostly Cloudy[\s\S]*Air quality 62 · Moderate/);
  const text = await page.textContent('.upd-pane:not([hidden])');
  assert.match(text, /Weather Service alerts \(1\)/);
  assert.match(text, /Winter Storm Warning/);
  assert.match(text, /Hard freeze: low 24°F tonight/);
  assert.match(text, /Damaging wind: gusts to 62 mph tomorrow/);
  assert.match(text, /Air quality tomorrow: Unhealthy \(AQI 155\)/);
  assert.match(text, /Not set up yet/);
  assert.equal(await page.locator('.upd-hour').count(), 24);
  // Alert details open on tap.
  await page.click('.upd-alert summary >> text=Winter Storm Warning');
  assert.match(await page.textContent('details.upd-alert[open]'), /What to do: If you must travel/);
  assert.ok(seen.some((u) => u.includes('/alerts/active?point=39.7436,-105.0617')));

  // Change ZIP: looks it up, then asks the Weather Service for the new point.
  await page.getByRole('button', { name: 'Change' }).click();
  await page.fill('.upd-zip input', '80401');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => /Golden, CO · 80401/.test(document.querySelector('.upd-loc strong')?.textContent ?? ''));
  await page.waitForFunction(() => document.querySelector('.upd-now'));
  assert.ok(seen.some((u) => u.includes('/points/39.7300,-105.2100')));
  assert.deepEqual(errors, []);
  await context.close();
});

test('Updates → Sports: Denver teams by default with next game, line, last result; add and remove teams', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Denver' });
  await mockApis(context);
  const { page, errors } = await openApp(context, '#/updates/sports');
  await page.waitForSelector('.upd-team');
  await page.waitForFunction(() => !document.querySelector('.upd-pane:not([hidden])')?.textContent.includes('Loading…'));
  assert.equal(await page.locator('.upd-team').count(), 4);
  const first = await page.textContent('.upd-team');
  assert.match(first, /Denver Broncos/);
  assert.match(first, /5-2 · 1st in AFC West/);
  assert.match(first, /Next: Today 4:30 PM vs Chiefs · CBS · DEN -3\.5/);
  assert.match(first, /Last: W 24–17 vs Raiders/);

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'NFL', exact: true }).click();
  await page.getByRole('button', { name: 'Green Bay Packers' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.upd-team').length === 5);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('cc.updates.teams'))).at(-1), { league: 'nfl', team: '9', name: 'Green Bay Packers' });
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Remove' }).first().click();
  assert.equal(await page.locator('.upd-team').count(), 4);

  // Tabs switch by link; Weather still works from the Sports tab.
  await page.getByRole('tab', { name: /Weather/ }).click();
  await page.waitForSelector('.upd-now');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Updates → Sports: a calendar of the games, week by default with today highlighted; day and month views; local college football from the ZIP', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Denver' });
  await mockApis(context);
  // ESPN's college football teams; each FBS team near Lakewood gets its own schedule.
  const college = (id, abbr, name, short, color) => ({ id, abbreviation: abbr, displayName: name, shortDisplayName: short, color });
  const CU = college('38', 'COLO', 'Colorado Buffaloes', 'Colorado', 'cfb87c');
  const UTAH = college('254', 'UTAH', 'Utah Utes', 'Utah', 'cc0000');
  const CFB = [CU, college('2005', 'AF', 'Air Force Falcons', 'Air Force', '003087'), college('36', 'CSU', 'Colorado State Rams', 'Colorado St', '1e4d2b'), college('2751', 'WYO', 'Wyoming Cowboys', 'Wyoming', '492f24'), college('333', 'ALA', 'Alabama Crimson Tide', 'Alabama', '9e1b32')];
  await context.route('https://site.api.espn.com/apis/v2/sports/football/college-football/standings', (r) => r.fulfill({ json: { children: [{ name: 'Big 12', standings: { entries: CFB.slice(0, 1).concat(CFB.slice(4)).map((team) => ({ team })) } }, { name: 'Mountain West', standings: { entries: CFB.slice(1, 4).map((team) => ({ team })) } }] }, headers: { 'access-control-allow-origin': '*' } }));
  await context.route('https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/*/schedule', (r) => {
    const id = r.request().url().split('/teams/')[1].split('/')[0];
    const t = CFB.find((x) => x.id === id);
    const events = id === '38' ? [ev('cfb1', iso(4), 'pre', CU, UTAH, null, null)] : [];
    return r.fulfill({ json: { team: { ...t, recordSummary: '6-1' }, events }, headers: { 'access-control-allow-origin': '*' } });
  });
  const { page, errors } = await openApp(context, '#/updates/sports');
  await page.waitForSelector('.cal');
  await page.waitForFunction(() => /Utah/.test(document.querySelector('.cal-today')?.textContent ?? ''));

  // Week view by default, the week of Saturday Oct 17; today stands out.
  assert.equal(await page.textContent('.cal-views [aria-selected=true]'), 'Week');
  assert.equal(await page.textContent('.cal-title'), 'Oct 11 – 17, 2026');
  assert.equal(await page.locator('.cal-day').count(), 7);
  const today = await page.textContent('.cal-day.cal-today');
  assert.match(today, /Sat\s*17\s*Today/);
  assert.match(today, /4:30 PM[\s\S]*vs Chiefs/, 'the Broncos game');
  assert.match(today, /6:00 PM[\s\S]*vs Utah[\s\S]*local/, 'and the local college game');
  assert.equal((today.match(/vs Chiefs/g) ?? []).length, 1, 'a game shows once');
  assert.match(await page.textContent('.cal-day:has-text("Fri") '), /W 24–17[\s\S]*vs Raiders/, 'yesterday\'s result');
  // Next week.
  await page.getByRole('button', { name: 'Next' }).click();
  assert.equal(await page.textContent('.cal-title'), 'Oct 18 – 24, 2026');
  assert.match(await page.textContent('.cal-list'), /@ Raiders/);
  assert.equal(await page.locator('.cal-today').count(), 0);
  await page.getByRole('button', { name: 'Today' }).click();
  assert.equal(await page.textContent('.cal-title'), 'Oct 11 – 17, 2026');

  // Month: today's cell highlighted; a day opens in Day view with the details.
  await page.getByRole('tab', { name: 'Month' }).click();
  assert.equal(await page.textContent('.cal-title'), 'October 2026');
  assert.equal(await page.locator('.cal-cell').count(), 35);
  assert.match(await page.getAttribute('.cal-cell.cal-today', 'aria-label'), /Saturday, October 17, today, 2 items/);
  assert.ok(await page.locator('.cal-chip').count() >= 4);
  await page.click('.cal-cell.cal-today');
  assert.equal(await page.textContent('.cal-views [aria-selected=true]'), 'Day');
  const day = await page.textContent('.cal-list');
  assert.match(day, /Line: DEN -3\.5, O\/U 44\.5/);
  assert.match(day, /Empower Field at Mile High/);
  // The view picked is remembered.
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('cc.updates.sportsView'))).view, 'day');

  // Local college football: FBS teams near the Weather ZIP (Lakewood), nearest first; Alabama isn't local.
  const local = await page.$$eval('.upd-local', (els) => els.map((e) => e.querySelector('strong').textContent));
  assert.deepEqual(local, ['Colorado Buffaloes', 'Air Force Falcons', 'Colorado State Rams', 'Wyoming Cowboys']);
  assert.match(await page.textContent('.upd-local'), /College football · 6-1 · 2\d mi away/);
  assert.match(await page.textContent('.upd-pane:not([hidden])'), /within 150 miles of Lakewood, CO \(80214\)/);
  // Turned off: gone from the list and the calendar.
  await page.click('.upd-local-head .chip');
  await page.waitForFunction(() => !document.querySelector('.upd-local'));
  assert.doesNotMatch(await page.textContent('.cal-list'), /Utah/);
  assert.deepEqual(errors, []);
  await context.close();
});
