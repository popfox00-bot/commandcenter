// Bulk edits in the Photo editor, offline: three photos with the same name (as iPhone picks often
// have), each with different bars (navy #022157, near-black #0B1014, none). Auto-Crop finds each
// photo's own bars; each result is its own file with a unique name, handed to the share sheet
// (Save to Photos / Files). Also Auto-Crop in the single-photo editor.
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
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => { await browser?.close(); server?.close(); });

/** A 300×500 "screenshot": bars of `color` (top/bottom rows) around a busy picture. */
async function barred(page, { color, top, bottom, type = 'image/png' }) {
  return Buffer.from(await page.evaluate(async ({ color, top, bottom, type }) => {
    const c = new OffscreenCanvas(300, 500); const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 300, 500); g.addColorStop(0, '#f4a261'); g.addColorStop(0.5, '#2a9d8f'); g.addColorStop(1, '#e9c46a');
    x.fillStyle = g; x.fillRect(0, 0, 300, 500);
    for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${i * 37} 70% 60%)`; x.fillRect((i * 53) % 280, 60 + ((i * 97) % 380), 30, 20); }
    if (color) {
      x.fillStyle = color;
      if (top) x.fillRect(0, 0, 300, top);
      if (bottom) x.fillRect(0, 500 - bottom, 300, bottom);
      // A logo on the top bar, like a real header.
      if (top > 30) { x.fillStyle = '#ffffff'; x.font = 'bold 18px sans-serif'; x.fillText('LOGO', 12, Math.min(top - 8, 28)); }
    }
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type, quality: 0.92 })).arrayBuffer()));
  }, { color, top, bottom, type }));
}

test('bulk Auto-Crop, offline: each photo cropped at its own bars, saved as separate uniquely named files', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Load once so the service worker caches the app, then go offline.
  await page.goto(`${origin}${BASE}#/tools/editor`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const files = [
    { name: 'image.png', mimeType: 'image/png', buffer: await barred(page, { color: '#022157', top: 40, bottom: 60 }) },
    { name: 'image.jpg', mimeType: 'image/jpeg', buffer: await barred(page, { color: '#0B1014', top: 100, bottom: 20, type: 'image/jpeg' }) },
    { name: 'image.png', mimeType: 'image/png', buffer: await barred(page, {}) },
  ];
  await context.setOffline(true);
  await page.goto(`${origin}${BASE}#/tools/editor`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  await page.setInputFiles('#ed-file', files);
  await page.waitForSelector('.bt-grid .bt-tile');
  assert.match(await page.textContent('.bt-top'), /3 photos · 3 selected/);
  await page.waitForFunction(() => /Cropped top 40 px, bottom 60 px/.test(document.querySelector('.bt-preview-note')?.textContent ?? ''));
  assert.match(await page.textContent('.bt-recipe'), /#022157[\s\S]*#0B1014/i, 'both boundary colors are on');

  // Like an iPhone: a share sheet is available (mocked to capture what would be saved).
  await page.evaluate(() => {
    window.__shared = null;
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      window.__shared = await Promise.all(data.files.map(async (f) => { const b = await createImageBitmap(f); return { name: f.name, type: f.type, w: b.width, h: b.height }; }));
    };
  });
  await page.getByRole('button', { name: 'Apply to 3 photos' }).click();
  await page.waitForSelector('.bt-result-list .bt-result:nth-child(3)', { timeout: 60000 });
  const list = await page.$$eval('.bt-result-text', (els) => els.map((e) => e.textContent));
  assert.match(list[0], /^image-edited\.png300×400.*Cropped top 40 px, bottom 60 px/);
  assert.match(list[1], /^image-edited\.jpg300×38\d.*Cropped top 10\d px, bottom 2\d px/, 'JPEG edges may blur a pixel or two');
  assert.match(list[2], /^image-edited-2\.png300×500.*No bars found/);

  // Save to Photos: all three files go to the share sheet at once, each its own file.
  assert.equal(await page.getByRole('button', { name: 'Save to Files' }).count(), 1);
  await page.getByRole('button', { name: 'Save to Photos' }).click();
  await page.waitForFunction(() => window.__shared);
  const shared = await page.evaluate(() => window.__shared);
  assert.deepEqual(shared.map((f) => f.name), ['image-edited.png', 'image-edited.jpg', 'image-edited-2.png']);
  assert.deepEqual(shared.map((f) => [f.w, f.h <= 382 && f.h >= 378 ? 380 : f.h]), [[300, 400], [300, 380], [300, 500]]);
  assert.deepEqual(shared.map((f) => f.type), ['image/png', 'image/jpeg', 'image/png'], 'same file type as each photo');

  assert.deepEqual(errors, []);
  await context.close();
});

test('single photo: Auto-Crop in the Crop panel, then export at the cropped size', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/tools/editor`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  await page.setInputFiles('#ed-file', { name: 'shot.png', mimeType: 'image/png', buffer: await barred(page, { color: '#022157', top: 70, bottom: 30 }) });
  await page.waitForSelector('.ed-canvas');
  await page.getByRole('tab', { name: 'Crop' }).click();
  await page.getByRole('button', { name: /Auto-Crop bars/ }).click();
  await page.waitForFunction(() => /Cropped top 70 px, bottom 30 px/.test(document.querySelector('.ed-autocrop-note')?.textContent ?? ''));
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => /300×400/.test(document.querySelector('.ed-dialog .muted')?.textContent ?? ''));
  assert.deepEqual(errors, []);
  await context.close();
});

test('bulk: the same edit (Mono filter, rotate, square) goes to every selected photo; a skipped photo is left out', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/tools/editor`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  await page.evaluate(() => { localStorage.removeItem('cc.editor.prefs'); });
  const files = [];
  for (const n of ['a.png', 'b.png', 'c.png']) files.push({ name: n, mimeType: 'image/png', buffer: await barred(page, {}) });
  await page.setInputFiles('#ed-file', files);
  await page.waitForSelector('.bt-tile');
  await page.locator('.bt-check').nth(1).click(); // skip b.png
  await page.locator('#bt-autoCrop').uncheck();
  await page.getByRole('button', { name: 'Mono', exact: true }).click();
  await page.getByRole('button', { name: /Rotate/ }).click();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  await page.evaluate(() => { window.__shared = null; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared = await Promise.all(d.files.map(async (f) => { const b = await createImageBitmap(f); const c = new OffscreenCanvas(b.width, b.height); const x = c.getContext('2d'); x.drawImage(b, 0, 0); const p = x.getImageData(Math.floor(b.width / 2), Math.floor(b.height / 2), 1, 1).data; return { name: f.name, w: b.width, h: b.height, gray: Math.abs(p[0] - p[1]) < 4 && Math.abs(p[1] - p[2]) < 4 }; })); }; });
  await page.getByRole('button', { name: 'Apply to 2 photos' }).click();
  await page.waitForSelector('.bt-result:nth-child(2)', { timeout: 60000 });
  await page.getByRole('button', { name: 'Save to Files' }).click();
  await page.waitForFunction(() => window.__shared);
  const shared = await page.evaluate(() => window.__shared);
  assert.deepEqual(shared.map((f) => [f.name, f.w, f.h, f.gray]), [['a-edited.png', 300, 300, true], ['c-edited.png', 300, 300, true]]);
  assert.deepEqual(errors, []);
  await context.close();
});
