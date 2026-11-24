// Clock (world clock, timer, stopwatch), Units' Time Zone converter and the Calculator (Productivity).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server; let browser; let origin;

before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.startsWith(BASE)) { res.writeHead(404).end(); return; }
    const rel = path.slice(BASE.length) || 'index.html';
    try { res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(await readFile(join(WEB, rel))); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
});
after(async () => { await browser?.close(); server?.close(); });


test('Clock: Colorado big, the others in two columns; + Add New; Edit to remove; a timer counts down; the stopwatch runs', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'America/Denver' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/clock`);
  await page.locator('.ck-big').waitFor();
  assert.equal(await page.locator('.ck-big .ck-name').textContent(), 'Colorado');
  assert.deepEqual(await page.locator('.ck-grid .ck-name').allTextContents(), ['California', 'New York', 'Hawaii', 'London', 'Germany', 'Romania']);
  const grid = await page.locator('.ck-grid').evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
  assert.equal(grid, 2, 'two columns');
  assert.match(await page.locator('.ck-grid .ck-card').filter({ hasText: 'California' }).textContent(), /Today, −1h/);
  // + Add New: Tokyo.
  await page.getByRole('button', { name: '+ Add New' }).click();
  await page.getByLabel('Search places').fill('tokyo');
  await page.locator('.ck-result', { hasText: 'Tokyo' }).first().click();
  assert.equal(await page.locator('.ck-grid .ck-name').last().textContent(), 'Tokyo');
  // Edit: remove Hawaii; change Romania (tap its name) to Paris.
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Remove Hawaii' }).click();
  await page.getByRole('button', { name: 'Change Romania' }).click();
  await page.getByLabel('Search places').fill('paris'); await page.locator('.ck-result', { hasText: 'Paris' }).first().click();
  await page.getByRole('button', { name: 'Done' }).click();
  assert.deepEqual(await page.locator('.ck-grid .ck-name').allTextContents(), ['California', 'New York', 'London', 'Germany', 'Paris', 'Tokyo']);
  await page.reload(); await page.locator('.ck-big').waitFor();
  assert.equal(await page.locator('.ck-grid .ck-name').count(), 6, 'kept after a reload');
  // Timer: 1 min, counting down.
  await page.getByRole('tab', { name: /Timer/ }).click();
  await page.getByRole('button', { name: '1 min' }).click();
  await page.waitForTimeout(1300);
  assert.match(await page.locator('.ck-left').textContent(), /^0:5\d$/);
  await page.getByRole('button', { name: 'Cancel' }).click();
  // Stopwatch.
  await page.getByRole('tab', { name: /Stopwatch/ }).click();
  await page.getByRole('button', { name: 'Start' }).click(); await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Lap' }).click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Stop' }).click();
  const t = await page.locator('.ck-sw-time').textContent(); assert.match(t, /^00:0\d\.\d\d$/); assert.notEqual(t, '00:00.00');
  assert.equal(await page.locator('.ck-lap').count(), 2);
  assert.deepEqual(errors, []); await ctx.close();
});

test('Units: Time Zone converts a time between places; Calculator: precedence and percent', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'America/Denver' });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/units`);
  await page.getByRole('tab', { name: 'Time Zone' }).click();
  await page.getByLabel('Time to convert').fill('15:00'); await page.getByLabel('Date', { exact: true }).fill('2026-11-24');
  await page.getByLabel('From place').fill('Colorado'); await page.getByLabel('To place').fill('Romania');
  assert.match(await page.locator('.un-tz .un-result').textContent(), /12:00 AM in Romania.*the next day.*\+9h/);
  await page.getByRole('button', { name: 'Swap the places' }).click();
  assert.match(await page.locator('.un-tz .un-result').textContent(), /6:00 AM in Colorado/);
  await page.goto(`${origin}${BASE}index.html#/calculator`);
  for (const k of ['2', 'Add', '3', 'Multiply', '4', 'Equals']) await page.getByRole('button', { name: k, exact: true }).click();
  assert.equal(await page.locator('.calc-main').textContent(), '14');
  await page.keyboard.type('50+10%'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('.calc-main').textContent(), '55');
  assert.deepEqual(errors, []); await ctx.close();
});
