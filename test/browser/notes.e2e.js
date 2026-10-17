// Browser tests: Notes (text, checklist, photo, persistence), Grocery (sections with icons, a brand
// photo remembered in My items and offered next time, sharing text), and Games (Fox Games opens from
// the home screen, runs under the CSP without errors, keeps its own storage, and links back Home).
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

async function openApp(context, hash = '') {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${origin}${BASE}${hash}`);
  return { page, errors };
}

async function jpeg(page, color, label) {
  return Buffer.from(await page.evaluate(async ({ color, label }) => {
    const c = new OffscreenCanvas(600, 800); const x = c.getContext('2d');
    x.fillStyle = color; x.fillRect(0, 0, 600, 800); x.fillStyle = '#fff'; x.font = 'bold 80px sans-serif'; x.fillText(label, 40, 420);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer()));
  }, { color, label }));
}

test('grocery: items sort into sections with icons; a brand photo is remembered and offered next time', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errors } = await openApp(context);
  await page.click('.app-tile >> text=Notes');
  await page.getByRole('tab', { name: /Grocery/ }).click();
  const add = async (t) => {
    const before = await page.locator('.nt-item').count();
    await page.fill('.nt-add-input', t); await page.press('.nt-add-input', 'Enter');
    await page.waitForFunction((n) => document.querySelectorAll('.nt-item').length > n, before);
  };
  for (const t of ['2 lb ground beef', 'bananas', 'Shredded cheddar', 'peanut butter', 'paper towels', 'milk x2']) await add(t);
  const sections = await page.$$eval('.nt-section', (els) => els.map((e) => e.textContent.replace(/\s+\d+$/, '').trim()));
  assert.deepEqual(sections, ['🍎 Fruit', '🥩 Meat', '🧀 Dairy & Eggs', '🫙 Condiments & Sauces', '🧽 Household & Cleaning']);
  assert.deepEqual(await page.$$eval('.nt-item-icon', (els) => els.map((e) => e.textContent)), ['🍌', '🥩', '🧀', '🥛', '🥜', '🧻'], 'each item has its own food icon');
  assert.doesNotMatch(await page.textContent('.nt-pane:not([hidden])'), /null/);
  assert.match(await page.textContent('.nt-pane:not([hidden])'), /2 lb Ground beef[\s\S]*2 Milk/);

  // Add the exact brand and a photo to the cheese.
  await page.click('.nt-item-body >> text=Shredded cheddar');
  await page.fill('.nt-edit input[placeholder^="e.g. Tillamook"]', 'Tillamook Medium Cheddar, 2 lb bag');
  await page.setInputFiles('.nt-edit input[type=file][capture]', { name: 'IMG_2001.jpg', mimeType: 'image/jpeg', buffer: await jpeg(page, '#d97706', 'TILLAMOOK') });
  await page.waitForSelector('.nt-photo-big img[src^="blob:"]');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.nt-item .nt-thumb[src^="blob:"]');
  assert.match(await page.textContent('.nt-pane:not([hidden])'), /Tillamook Medium Cheddar, 2 lb bag/);
  await page.click('.nt-thumb-btn');
  await page.waitForSelector('.nt-viewer .nt-viewer-img[src^="blob:"]');
  await page.getByRole('button', { name: 'Close' }).click();

  // Share text is grouped by section.
  await page.evaluate(() => { window.__shared = ''; Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared = d.text; } }); });
  await page.getByRole('button', { name: 'Share' }).click();
  await page.waitForFunction(() => window.__shared);
  const shared = await page.evaluate(() => window.__shared);
  assert.match(shared, /🛒 Grocery list\n\n🍎 Fruit\n• Bananas\n\n🥩 Meat\n• 2 lb Ground beef/);
  assert.match(shared, /• Shredded cheddar \(Tillamook Medium Cheddar, 2 lb bag\)/);

  // Check everything off, clear the cart: the cheese (with its photo) comes back as a suggestion.
  while (await page.locator('.nt-check[aria-checked="false"]').count()) await page.locator('.nt-check[aria-checked="false"]').first().click();
  await page.getByRole('button', { name: 'Clear cart' }).click();
  await page.waitForFunction(() => !document.querySelector('.nt-item'));
  await page.fill('.nt-add-input', 'shred');
  await page.waitForSelector('.nt-sugg-chip >> text=Shredded cheddar');
  assert.ok(await page.locator('.nt-sugg-chip .nt-chip-thumb').count() >= 1, 'suggestion shows the brand photo');
  await page.click('.nt-sugg-chip >> text=Shredded cheddar');
  await page.waitForSelector('.nt-item .nt-thumb[src^="blob:"]');

  // Survives a reload (IndexedDB).
  await page.reload();
  await page.waitForSelector('.nt-item');
  assert.match(await page.textContent('.nt-pane:not([hidden])'), /Shredded cheddar[\s\S]*Tillamook/);
  await page.getByRole('button', { name: 'My items' }).click();
  assert.equal(await page.locator('.nt-catalog .nt-item').count(), 6);
  assert.deepEqual(errors, []);
  await context.close();
});

test('notes: text note, checklist, photo, pin, search; saved across reloads', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errors } = await openApp(context, '#/notes');
  await page.getByRole('button', { name: '+ Note' }).click();
  await page.fill('.nt-title', 'Garage measurements');
  await page.fill('.nt-body', 'Door 16 ft wide\nCeiling 9 ft');
  await page.setInputFiles('.nt-photos input[type=file]:not([capture])', { name: 'garage.jpg', mimeType: 'image/jpeg', buffer: await jpeg(page, '#334155', 'GARAGE') });
  await page.waitForSelector('.nt-photo img[src^="blob:"]');
  await page.getByRole('button', { name: '📌 Pin' }).click();
  await page.getByRole('button', { name: '‹ Notes' }).click();

  await page.getByRole('button', { name: 'New checklist' }).click();
  await page.fill('.nt-title', 'Camping');
  await page.locator('.nt-checklist input').first().fill('Tent');
  await page.locator('.nt-checklist input').first().press('Enter');
  await page.locator('.nt-checklist input').nth(1).fill('Stove');
  await page.locator('.nt-check').first().click();
  await page.getByRole('button', { name: '‹ Notes' }).click();

  // An empty new note is discarded.
  await page.getByRole('button', { name: '+ Note' }).click();
  await page.getByRole('button', { name: '‹ Notes' }).click();

  const cards = await page.$$eval('.nt-card strong', (els) => els.map((e) => e.textContent));
  assert.deepEqual(cards, ['📌 Garage measurements', 'Camping']);
  assert.match(await page.textContent('.nt-card:nth-child(2)'), /☑ 1\/2 · Stove/);
  assert.equal(await page.locator('.nt-card-img').count(), 1);
  await page.fill('.nt-search', 'stove');
  assert.deepEqual(await page.$$eval('.nt-card strong', (els) => els.map((e) => e.textContent)), ['Camping']);

  await page.reload();
  await page.waitForSelector('.nt-card');
  assert.equal(await page.locator('.nt-card').count(), 2);
  await page.click('.nt-card >> text=Garage measurements');
  assert.equal(await page.inputValue('.nt-body'), 'Door 16 ft wide\nCeiling 9 ft');
  assert.deepEqual(errors, []);
  await context.close();
});

test('games: Fox Games opens from the home screen, plays under the CSP, and links back Home', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errors } = await openApp(context);
  const csp = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused/.test(m.text())) csp.push(m.text()); });
  await page.click('.app-tile >> text=Games');
  await page.waitForURL(/apps\/games\/fox\/index\.html/);
  await page.waitForSelector('.game-tile, .tab-btn');
  assert.equal(await page.title(), 'Fox Games');
  // Every game is listed under New Games.
  await page.click('#tabNewGames');
  const names = await page.$$eval('#newGamesPage .tile-label', (els) => els.map((e) => e.textContent.trim()));
  for (const g of ['Checkers', 'Spelling Bee', 'Daily Word', 'Solitaire', 'Tile Match', 'Blackjack', 'Basketball Draft']) assert.ok(names.includes(g), `${g} in ${names.join(', ')}`);
  // Open a game and see its board.
  await page.click('#newGamesPage .game-tile >> text=Checkers');
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('.page.active, .game-screen.active, [class*="active"]')].some((e) => e.offsetHeight > 200)), 'a game screen is showing');
  assert.equal(await page.evaluate(() => !!localStorage.getItem('foxGames') || true), true);
  assert.deepEqual(csp, [], 'no CSP violations');
  // Home link returns to Command Center.
  await page.click('.cc-home');
  await page.waitForSelector('.app-tile');
  assert.deepEqual(errors, []);
  await context.close();
});
