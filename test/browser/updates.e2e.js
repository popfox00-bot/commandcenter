// Browser test for the Updates app: home screen -> Updates, Weather and Sports tabs with the Weather
// Service, Open-Meteo and ESPN mocked (shapes from test/fixtures/updates.js), at a fixed time.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { NOW, pointJson, alertsJson, hourlyJson, dailyJson, gridJson, airJson, scheduleJson, DEN } from '../fixtures/updates.js';

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
  await context.route(/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[^/]+\/[^/]+\/teams\/[^/]+$/, json({ team: { ...DEN, alternateColor: '002244', record: { items: [{ type: 'total', summary: '5-2' }] }, standingSummary: '1st in AFC West' } }));
  await context.route(/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[^/]+\/[^/]+\/teams$/, json({ sports: [{ leagues: [{ teams: [{ team: DEN }, { team: { id: '9', abbreviation: 'GB', displayName: 'Green Bay Packers', color: '204e32' } }] }] }] }));
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
