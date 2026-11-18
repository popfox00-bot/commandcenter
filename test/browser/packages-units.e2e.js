// Packages (an Updates tab): a tracking number added, its carrier told from it, its live status through
// your Worker (a stand-in here) as a progress bar and its updates; without the Worker, its carrier's page.
// Units: lengths and temperatures, and currency by the day's rates (a stand-in), kept for offline use.
// The home screen's Updates card: each line opens its tab; today's games each open that game.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
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

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS' };

test('Packages: a number added (carrier found from it), its live status through the Worker: the bar, where it is, its updates; kept after a reload', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const asked = [];
  await context.route('https://worker.example/api/track', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    asked.push({ auth: r.request().headers().authorization, body: JSON.parse(r.request().postData()) });
    return r.fulfill({ headers: CORS, json: { packages: [{ number: '1Z999AA10123456784', status: 'OutForDelivery', sub: '', eta: '2026-11-19T20:00:00Z', events: [{ time: '2026-11-18T13:05:00Z', text: 'Out for delivery', place: 'Lakewood, CO' }, { time: '2026-11-17T22:00:00Z', text: 'Arrived at facility', place: 'Denver, CO' }] }] } });
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}`);
  await page.evaluate(() => { localStorage.setItem('cc.workerUrl', 'https://worker.example'); localStorage.setItem('cc.apiToken', 'tok-123456789012345678901234'); });
  // Not in the home screen's card: only a tab of the Updates page.
  await page.waitForSelector('.updates-card');
  assert.doesNotMatch(await page.textContent('.updates-card'), /Packages/);
  await page.goto(`${origin}${BASE}#/updates/packages`);
  await page.waitForSelector('.pk-add');
  assert.equal(await page.textContent('.upd-hub-tabs [aria-selected=true]'), '📦 Packages');
  await page.fill('.pk-num', '1z999 aa1 0123456784');
  await page.waitForSelector('text=Looks like UPS');
  await page.fill('.pk-name', 'Running shoes');
  await page.getByRole('button', { name: 'Track it' }).click();
  await page.waitForSelector('.pk-card >> text=Out for delivery');
  assert.deepEqual(asked[0].body, { numbers: [{ number: '1Z999AA10123456784', carrier: 'ups' }] });
  assert.equal(asked[0].auth, 'Bearer tok-123456789012345678901234');
  const card = page.locator('.pk-card');
  assert.match(await card.textContent(), /Running shoes[\s\S]*UPS · 1Z999AA10123456784/);
  assert.equal(await card.locator('.pk-step.on').count(), 3, 'label, in transit, out for delivery lit');
  assert.match(await card.locator('.pk-last').textContent(), /Out for delivery · .*Lakewood, CO/);
  assert.equal(await card.locator('a.btn').getAttribute('href'), 'https://www.ups.com/track?tracknum=1Z999AA10123456784');
  await page.reload();
  await page.waitForSelector('.pk-card >> text=Out for delivery');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Packages without the Worker: kept on the phone, with a button to its carrier\'s own tracking page', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/updates/packages`);
  await page.waitForSelector('.pk-add');
  await page.fill('.pk-num', '9400100000000000000000');
  await page.getByRole('button', { name: 'Track it' }).click();
  await page.waitForSelector('.pk-card');
  assert.match(await page.textContent('.pk'), /Live status needs your Worker/);
  assert.equal(await page.locator('.pk-card a.btn').getAttribute('href'), 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Units: lengths and temperatures, ⇅ swaps, every other unit listed; currency by the day\'s rates, kept for offline', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('https://api.frankfurter.app/**', (r) => r.fulfill({ headers: CORS, json: { base: 'USD', date: '2026-11-18', rates: { EUR: 0.9, GBP: 0.8, JPY: 150 } } }));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}`);
  await page.click('.app-tile >> text=Units');
  await page.waitForSelector('.un-big');
  assert.equal(await page.textContent('#title'), 'Units');
  await page.fill('.un-amount', '10');
  assert.match(await page.textContent('.un-big'), /^3\.048 meters$/);
  await page.getByRole('button', { name: 'Swap From and To' }).click();
  assert.match(await page.textContent('.un-big'), /^32\.8084 feet$/);
  assert.match(await page.textContent('.un-all'), /Inches\s*393\.701/);
  await page.getByRole('tab', { name: 'Temperature' }).click();
  await page.fill('.un-amount', '212');
  assert.match(await page.textContent('.un-big'), /^100 celsius$/);
  await page.getByRole('tab', { name: 'Currency' }).click();
  await page.fill('.un-amount', '100');
  await page.waitForFunction(() => /90\.00 EUR/.test(document.querySelector('.un-big')?.textContent ?? ''));
  assert.match(await page.textContent('.un-note'), /2026-11-18/);
  // Offline (the rate sources unreachable, the kept rates a day old): the kept rates used.
  await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('cc.units.rates')); r.at = 0; localStorage.setItem('cc.units.rates', JSON.stringify(r)); });
  await context.unroute('https://api.frankfurter.app/**');
  await context.route('https://api.frankfurter.app/**', (r) => r.abort());
  await context.route('https://open.er-api.com/**', (r) => r.abort());
  await page.goto(`${origin}${BASE}#/`); await page.click('.app-tile >> text=Units');
  await page.waitForFunction(() => /Offline: using the rates of 2026-11-18/.test(document.querySelector('.un-note')?.textContent ?? ''));
  assert.match(await page.textContent('.un-big'), /90\.00 EUR/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Home: each line of the Updates card opens its tab; a game today opens that game (its day, picked out)', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('https://site.api.espn.com/**', (r) => r.fulfill({ status: 503, headers: CORS, body: 'off' }));
  await context.route('https://api.weather.gov/**', (r) => r.fulfill({ status: 503, headers: CORS, body: 'off' }));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}`);
  await page.evaluate(() => {
    const now = Date.now(); const today = new Date(); today.setHours(19, 0, 0, 0); const at = (h) => { const d = new Date(today); d.setHours(h); return d.toISOString(); };
    localStorage.setItem('cc.updates.sports', JSON.stringify({
      'nba:den': { at: now, team: { id: '7', abbr: 'DEN', name: 'Denver Nuggets' }, games: [{ id: 'g1', date: at(19), state: 'pre', home: { id: '7', abbr: 'DEN' }, away: { id: '1', abbr: 'UTA' }, tv: 'ALT' }] },
      'nhl:col': { at: now, team: { id: '17', abbr: 'COL', name: 'Colorado Avalanche' }, games: [{ id: 'g2', date: at(17), state: 'pre', home: { id: '17', abbr: 'COL' }, away: { id: '5', abbr: 'DAL' } }] },
    }));
  });
  await page.reload();
  await page.waitForSelector('.upd-game-line');
  // Today's games, a line each, by start time.
  assert.deepEqual(await page.$$eval('.upd-game-line .upd-game-teams', (n) => n.map((x) => x.textContent)), ['DAL @ COL', 'UTA @ DEN']);
  assert.match(await page.textContent('.upd-prev-label'), /2 games today/);
  // The Weather line opens the Weather tab.
  await page.click('.upd-prev[href="#/updates/weather"]');
  await page.waitForFunction(() => location.hash === '#/updates/weather');
  await page.waitForSelector('.upd-hub-tabs [aria-selected=true] >> text=Weather');
  // A game opens Sports on it.
  await page.goto(`${origin}${BASE}#/`);
  await page.click('.upd-game-line >> text=UTA @ DEN');
  await page.waitForFunction(() => location.hash === '#/updates/sports/g1');
  await page.waitForSelector('.upd-game.upd-focus[data-game="g1"]');
  assert.equal(await page.textContent('.cal-views [aria-selected=true]'), 'Day');
  assert.deepEqual(errors, []);
  await context.close();
});
