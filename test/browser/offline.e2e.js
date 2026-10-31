// Offline (`npm run test:web`): after the first visit, with no connection at all, every app and tool
// opens and works from the phone's cache (the service worker): Calendar, Notes and the grocery list,
// Files (photo editor with Clean Up, Collage, Cutout, PDF, Scan, Convert), Draw, QR, Rap (its word
// list too), Games and Settings. Only what's online by nature (Updates' weather and sports, Saved Files'
// Drive) needs a connection, and they say so instead of breaking.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.txt': 'text/plain', '.json': 'application/json' };
let server; let browser; let origin;

before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = path.startsWith(BASE) ? path.slice(BASE.length) || 'index.html' : null;
    try { res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(await readFile(join(WEB, rel))); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

test('offline: every app and tool works with no connection after the first visit', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; const missing = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A file of the app that couldn't be had offline: not in the cache.
  page.on('requestfailed', (r) => { if (r.url().startsWith(origin)) missing.push(r.url()); });
  page.on('response', (r) => { if (r.url().startsWith(origin) && r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${origin}${BASE}`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  // The cache filled, no connection from here on.
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.app-tile');
  const go = async (hash, selector) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForSelector(selector, { state: 'attached' }); };

  await go('#/calendar', '.cal');
  await go('#/notes', '.nt-pane');
  await go('#/notes/grocery', '.nt-pane');

  // Files: the photo editor with a photo, and Clean Up.
  await go('#/files', '#ed-file');
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(200, 100); const x = c.getContext('2d');
    x.fillStyle = 'rgb(200,40,40)'; x.fillRect(0, 0, 200, 100); x.fillStyle = '#fff'; x.fillRect(95, 45, 8, 8);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.setInputFiles('#ed-file', { name: 'offline.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  await page.getByRole('tab', { name: 'Clean Up' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const b = await page.$eval('.ed-overlay', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  await page.mouse.click(b[0] + b[2] * 0.495, b[1] + b[3] * 0.49);
  await page.waitForSelector('text=Spot cleaned up');
  await go('#/files/collage', '.cl-canvas');
  await go('#/files/cutout', '.studio-pane');
  if (await page.isVisible('dialog[open]')) await page.locator('dialog[open]').getByRole('button', { name: 'Not now' }).click();
  await page.waitForSelector('#co-file', { state: 'attached' });
  await go('#/files/pdf', '#pw-file');
  await go('#/files/scan', '#sc-camera');
  await go('#/files/convert', '#cv-files');
  await go('#/files/saved', 'text=Connect it once in Settings');

  await go('#/draw', 'text=+ New drawing');
  await page.getByRole('button', { name: '+ New drawing' }).click();
  await page.waitForSelector('.dr-canvas');
  await go('#/qr', '.qr-pane');

  // Rap: its word list comes from the cache too.
  await go('#/rap', '.rap-current');
  await page.click('.rap-current');
  await page.keyboard.type('up all night ');
  await page.waitForFunction(() => document.querySelector('.rap-bank-word')?.value === 'night');
  assert.match(await page.textContent('.rap-bank-list'), /light/);

  await go('#/settings', '.st-home');

  // Updates is online by nature: it opens and says it can't reach the services, without breaking.
  await go('#/updates', '.view, .upd, main');

  // Games: its own page, from the cache.
  await page.goto(`${origin}${BASE}apps/games/fox/index.html`);
  await page.waitForSelector('.game-tile, .tab-btn');

  assert.deepEqual(missing, [], 'every file of the app is in the offline cache');
  assert.deepEqual(errors, []);
  await context.close();
});
