// Settings: pick an app-wide background color. It shows at once on every screen (home, Files, an
// app), the text stays readable, it is still there after a reload (before the app's scripts run), a
// custom color works, and Reset goes back to the phone's light/dark default. Nothing leaves the phone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

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

const colors = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); const cs = getComputedStyle(n); return { bg: getComputedStyle(document.body).backgroundColor, text: cs.color }; }, sel);

test('a background color picked in Settings is used everywhere, readable, and kept', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const page = await context.newPage();
  const errors = []; const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !/^(blob|data):/.test(r.url())) external.push(r.url()); });
  await page.goto(`${origin}${BASE}`);
  assert.equal((await colors(page, '.app-name')).bg, 'rgb(246, 247, 249)', 'the default light background');

  await page.click('.app-tile >> text=Settings');
  await page.waitForSelector('.st h2');
  await page.click('[aria-label="Background Midnight"]');
  assert.equal(await page.getAttribute('[aria-label="Background Midnight"]', 'aria-pressed'), 'true');
  assert.equal((await colors(page, '.st h2')).bg, 'rgb(11, 16, 32)');
  assert.equal((await colors(page, '.st h2')).text, 'rgb(232, 234, 238)', 'light text on the dark background');
  assert.equal(await page.getAttribute('meta[name="theme-color"]', 'content'), '#0b1020');

  // Every screen, and still there after a reload.
  await page.goto(`${origin}${BASE}#/files`);
  await page.waitForSelector('.studio-tabs');
  assert.equal((await colors(page, '.studio-tabs')).bg, 'rgb(11, 16, 32)');
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.goto(`${origin}${BASE}`);
  await page.waitForSelector('.app-tile');
  assert.equal((await colors(page, '.app-name')).bg, 'rgb(11, 16, 32)');
  assert.equal((await colors(page, '.app-name')).text, 'rgb(232, 234, 238)');

  // A light custom color: dark text.
  await page.goto(`${origin}${BASE}#/settings`);
  await page.waitForSelector('.st-color');
  await page.fill('.st-color', '#f4ecdc');
  assert.equal((await colors(page, '.st h2')).bg, 'rgb(244, 236, 220)');
  assert.equal((await colors(page, '.st h2')).text, 'rgb(20, 23, 28)');
  await page.waitForSelector('text=Background: Sand');

  // Reset: back to the default.
  await page.getByRole('button', { name: 'Reset to default', exact: true }).click();
  assert.equal((await colors(page, '.st h2')).bg, 'rgb(246, 247, 249)');
  await page.reload();
  await page.waitForSelector('.st-color');
  assert.equal(await page.evaluate(() => localStorage.getItem('cc.theme.v1')), null);
  assert.equal(await page.getAttribute('[aria-label="Background System"]', 'aria-pressed'), 'true');

  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings → Edit Home Screen: move apps up and down; the home screen follows; reset', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}`);
  const home = () => page.$$eval('.app-name', (els) => els.map((e) => e.textContent));
  await page.waitForSelector('.app-tile');
  assert.deepEqual(await home(), ['Calendar', 'Updates', 'Notes', 'Files', 'Draw', 'QR', 'Games', 'Settings']);
  await page.click('.app-tile >> text=Settings');
  await page.waitForSelector('.st-home');
  assert.equal(await page.isDisabled('[aria-label="Move Calendar up"]'), true);
  await page.click('[aria-label="Move QR up"]');
  await page.click('[aria-label="Move QR up"]');
  await page.click('[aria-label="Move Calendar down"]');
  assert.deepEqual(await page.$$eval('.st-home-name', (els) => els.map((e) => e.textContent)), ['Updates', 'Calendar', 'Notes', 'QR', 'Files', 'Draw', 'Games', 'Settings']);
  await page.click('#view-app .back');
  await page.waitForSelector('#view-home:not([hidden])');
  assert.deepEqual(await home(), ['Updates', 'Calendar', 'Notes', 'QR', 'Files', 'Draw', 'Games', 'Settings']);
  await page.reload();
  await page.waitForSelector('.app-tile');
  assert.deepEqual((await home()).slice(0, 4), ['Updates', 'Calendar', 'Notes', 'QR'], 'kept after a reload');
  await page.click('.app-tile >> text=Settings');
  await page.getByRole('button', { name: 'Reset to default order' }).click();
  await page.click('#view-app .back');
  await page.waitForSelector('#view-home:not([hidden])');
  assert.deepEqual(await home(), ['Calendar', 'Updates', 'Notes', 'Files', 'Draw', 'QR', 'Games', 'Settings']);
  assert.deepEqual(errors, []);
  await context.close();
});
