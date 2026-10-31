// Browser tests for the PWA tools (`npm run test:web`). Needs Playwright's Chromium:
//   npx playwright install chromium   (or set PLAYWRIGHT_CHROMIUM_EXECUTABLE)
// Serves web/ under /commandcenter/web/, the same sub-path GitHub Pages uses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createPdf } from '../../web/lib/pdf-writer.js';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE_PATH = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };

let server; let browser; let origin; let files;

before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.startsWith(BASE_PATH)) { res.writeHead(404).end(); return; }
    const rel = path.slice(BASE_PATH.length) || 'index.html';
    try {
      const body = await readFile(join(WEB, rel.endsWith('/') ? rel + 'index.html' : rel));
      res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });

  const dir = await mkdtemp(join(tmpdir(), 'cc-e2e-'));
  const jpeg = new Uint8Array(await readFile(resolve(import.meta.dirname, '../fixtures/web/tiny.jpg')));
  const pdf = createPdf([{ width: 64, height: 48, image: { kind: 'jpeg', bytes: jpeg } }, { width: 64, height: 48, image: { kind: 'jpeg', bytes: jpeg } }]);
  await writeFile(join(dir, 'two-pages.pdf'), pdf);
  files = [resolve(import.meta.dirname, '../fixtures/web/tiny.jpg'), join(WEB, 'icons/icon-512.png'), join(dir, 'two-pages.pdf')];
});

after(async () => { await browser?.close(); server?.close(); });

async function openApp(context, hash = '') {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${origin}${BASE_PATH}${hash}`);
  return { page, errors };
}

async function convertTo(page, label) {
  await page.getByRole('radio', { name: label, exact: true }).click();
  await page.getByRole('button', { name: /^Convert/ }).click();
  await page.waitForSelector('.results:not([hidden]) h3');
  return page.$$eval('.result strong', (els) => els.map((e) => e.textContent));
}

test('home screen of apps: Files, Draw and QR are apps of their own, Jobs is in Settings; old Tools links still work; no setup needed', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errors } = await openApp(context);
  await page.waitForSelector('.app-tile');
  assert.deepEqual(await page.$$eval('.app-name', (els) => els.map((e) => e.textContent)), ['Calendar', 'Updates', 'Notes', 'Files', 'Draw', 'QR', 'Rap', 'Games', 'Settings']);
  assert.equal(await page.textContent('#title'), 'Command Center');
  await page.click('.app-tile >> text=Files');
  await page.waitForSelector('.studio-tabs');
  assert.equal(await page.textContent('#title'), 'Files');
  assert.deepEqual(await page.$$eval('.studio-tabs [role=tab]', (els) => els.map((e) => e.textContent)), ['Photo Editor', 'PDF', 'Scan', 'Convert', 'Saved Files']);
  assert.deepEqual(await page.$$eval('.studio-sub [role=tab]', (els) => els.map((e) => e.textContent)), ['✏️ Edit', '🧩 Collage', '✂️ Cutout']);
  await page.click('#view-app .back');
  await page.waitForSelector('#view-home:not([hidden])');
  await page.click('.app-tile >> text=QR');
  await page.waitForSelector('#view-app:not([hidden]) >> text=QR & Barcode');
  assert.equal(await page.textContent('#title'), 'QR');
  await page.click('#view-app .back');
  // Jobs lives in Settings now, and goes back there.
  await page.click('.app-tile >> text=Settings');
  await page.click('.st-link >> text=Jobs');
  await page.waitForSelector('#view-jobs:not([hidden])');
  assert.equal(await page.isVisible('#jobs-actions'), true);
  await page.click('#view-jobs .back');
  await page.waitForFunction(() => location.hash === '#/settings');
  await page.click('#view-app .back');
  await page.click('.app-tile >> text=Draw');
  await page.waitForSelector('text=New drawing');
  assert.equal(await page.isVisible('#settings[open]'), false);
  assert.equal(await page.isVisible('#jobs-actions'), false, 'jobs buttons hidden in apps');
  assert.equal(await page.isVisible('#update'), false, 'no update prompt on a first visit');
  // Bookmarks from before: Tools goes home, its tools to their own apps.
  for (const [from, to] of [['#/tools', '#/'], ['#/tools/editor/pdf', '#/files/pdf'], ['#/tools/draw', '#/draw'], ['#/tools/qr', '#/qr']]) {
    await page.goto(`${origin}${BASE_PATH}${from}`);
    await page.waitForFunction((t) => location.hash === t, to);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('converter: images and PDFs to JPEG, PNG, WebP and one combined PDF', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errors } = await openApp(context, '#/tools/convert');
  await page.setInputFiles('#cv-files', files);
  await page.waitForSelector('.file-list li:nth-child(3)');
  assert.deepEqual(await page.$$eval('.file .badge', (els) => els.map((e) => e.textContent)), ['JPEG', 'PNG', 'PDF']);

  assert.deepEqual(await convertTo(page, 'JPEG'), ['tiny.jpg', 'icon-512.jpg', 'two-pages-p1.jpg', 'two-pages-p2.jpg']);
  assert.deepEqual(await convertTo(page, 'PNG'), ['tiny.png', 'icon-512.png', 'two-pages-p1.png', 'two-pages-p2.png']);
  assert.deepEqual(await convertTo(page, 'WebP'), ['tiny.webp', 'icon-512.webp', 'two-pages-p1.webp', 'two-pages-p2.webp']);
  const pdf = await convertTo(page, 'PDF');
  assert.deepEqual(pdf, ['tiny-and-2-more.pdf']);
  assert.match(await page.textContent('.result .muted'), /4 pages/);
  assert.doesNotMatch(await page.textContent('.results'), /null|undefined/);
  await page.waitForSelector('button:has-text("Download all")', { state: 'detached' }).catch(() => {});
  assert.deepEqual(errors, []);
  await context.close();
});

test('converter: max size and output types are applied', async () => {
  const context = await browser.newContext();
  const { page } = await openApp(context, '#/tools/convert');
  await page.setInputFiles('#cv-files', [files[1]]); // 512x512 PNG
  await page.getByRole('radio', { name: 'JPEG', exact: true }).click();
  await page.selectOption('.field select', '1080');
  await page.getByRole('button', { name: /^Convert/ }).click();
  await page.waitForSelector('.result');
  assert.match(await page.textContent('.result .muted'), /512×512/, 'never upscales');
  const type = await page.$eval('.result img', async (img) => (await (await fetch(img.src)).blob()).type);
  assert.equal(type, 'image/jpeg');
  await context.close();
});

test('WebP encoder (WebAssembly, used on Safari) produces a real WebP', async () => {
  const context = await browser.newContext();
  const { page } = await openApp(context, '#/tools');
  const header = await page.evaluate(async () => {
    const { encodeWebp } = await import('./lib/webp.js');
    const c = new OffscreenCanvas(8, 8);
    const x = c.getContext('2d'); x.fillStyle = 'red'; x.fillRect(0, 0, 8, 8);
    const out = await encodeWebp(x.getImageData(0, 0, 8, 8), 80);
    return String.fromCharCode(...out.slice(0, 4)) + String.fromCharCode(...out.slice(8, 12));
  });
  assert.equal(header, 'RIFFWEBP');
  await context.close();
});

test('works offline after the first visit', async () => {
  const context = await browser.newContext();
  const { page } = await openApp(context, '#/tools');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto(`${origin}${BASE_PATH}#/tools/convert`);
  await page.setInputFiles('#cv-files', files);
  const names = await convertTo(page, 'PNG');
  assert.equal(names.length, 4, 'images and PDFs convert with no network');
  await context.close();
});

test('Files app: old converter link redirects, and Edit sends a converted image to the photo editor', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errors } = await openApp(context, '#/tools/convert');
  await page.waitForFunction(() => location.hash === '#/files/convert');
  await page.setInputFiles('#cv-files', [files[1]]);
  await convertTo(page, 'PNG');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.waitForFunction(() => location.hash === '#/files');
  await page.waitForSelector('.ed-canvas');
  assert.equal(await page.getAttribute('[role=tab][aria-selected=true]', 'href'), '#/files');
  // Switching back keeps the conversion results (tabs stay alive).
  await page.getByRole('tab', { name: 'Convert' }).click();
  await page.waitForSelector('.result');
  assert.deepEqual(errors, []);
  await context.close();
});
