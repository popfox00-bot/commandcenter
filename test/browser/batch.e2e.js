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
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
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
  assert.match(await page.textContent('.bt-more'), /#022157 or #0B1014/i, 'both boundary colors are on');
  assert.equal(await page.getAttribute('#bt-autoCrop', 'aria-pressed'), 'true', 'Auto-Crop is on by default');

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

  assert.deepEqual(external, [], 'photos never leave the phone: no request outside the app');
  assert.deepEqual(errors, []);
  await context.close();
});

test('single photo: Auto-Crop in the Crop panel, then export at the cropped size', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(`${origin}${BASE}#/tools/editor`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  await page.setInputFiles('#ed-file', { name: 'shot.png', mimeType: 'image/png', buffer: await barred(page, { color: '#022157', top: 70, bottom: 30 }) });
  await page.waitForSelector('.ed-canvas');
  await page.getByRole('tab', { name: 'Crop' }).click();
  await page.getByRole('button', { name: /Auto-Crop bars/ }).click();
  await page.waitForFunction(() => /Cropped top 70 px, bottom 30 px/.test(document.querySelector('.ed-autocrop-note')?.textContent ?? ''));
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => /300×400/.test(document.querySelector('.ed-dialog .muted')?.textContent ?? ''));
  assert.deepEqual(external, [], 'photos never leave the phone: no request outside the app');
  assert.deepEqual(errors, []);
  await context.close();
});

test('bulk: the same edit (Mono filter, rotate, square) goes to every selected photo; a skipped photo is left out', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(`${origin}${BASE}#/tools/editor`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  await page.evaluate(() => { localStorage.removeItem('cc.editor.prefs'); });
  const files = [];
  for (const n of ['a.png', 'b.png', 'c.png']) files.push({ name: n, mimeType: 'image/png', buffer: await barred(page, {}) });
  await page.setInputFiles('#ed-file', files);
  await page.waitForSelector('.bt-tile');
  await page.locator('.bt-check').nth(1).click(); // skip b.png
  // Minimal by default: two big buttons; everything else is under "More edits".
  assert.equal(await page.getByRole('button', { name: 'Mono', exact: true }).isVisible(), false, 'detailed edits are tucked away');
  await page.click('#bt-autoCrop'); // turn Auto-Crop off
  assert.equal(await page.getAttribute('#bt-autoCrop', 'aria-pressed'), 'false');
  await page.click('.bt-more > summary');
  await page.click('.bt-section > summary >> text=Filter');
  await page.getByRole('button', { name: 'Mono', exact: true }).click();
  assert.match(await page.textContent('.bt-section:has-text("Filter") > summary'), /Mono/, 'the drop-down shows what is set');
  await page.click('.bt-section > summary >> text=Rotate & shape');
  await page.getByRole('button', { name: /Rotate/ }).click();
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  assert.equal(await page.isVisible('.bt-section:has-text("Filter") >> text=Mono'), true, 'open drop-downs stay open while editing');
  await page.evaluate(() => { window.__shared = null; navigator.canShare = () => true; navigator.share = async (d) => { window.__shared = await Promise.all(d.files.map(async (f) => { const b = await createImageBitmap(f); const c = new OffscreenCanvas(b.width, b.height); const x = c.getContext('2d'); x.drawImage(b, 0, 0); const p = x.getImageData(Math.floor(b.width / 2), Math.floor(b.height / 2), 1, 1).data; return { name: f.name, w: b.width, h: b.height, gray: Math.abs(p[0] - p[1]) < 4 && Math.abs(p[1] - p[2]) < 4 }; })); }; });
  await page.getByRole('button', { name: 'Apply to 2 photos' }).click();
  await page.waitForSelector('.bt-result:nth-child(2)', { timeout: 60000 });
  await page.getByRole('button', { name: 'Save to Files' }).click();
  await page.waitForFunction(() => window.__shared);
  const shared = await page.evaluate(() => window.__shared);
  assert.deepEqual(shared.map((f) => [f.name, f.w, f.h, f.gray]), [['a-edited.png', 300, 300, true], ['c-edited.png', 300, 300, true]]);
  assert.deepEqual(external, [], 'photos never leave the phone: no request outside the app');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Auto-Crop cuts at the clean bar line even when the picture itself has dark areas (JPEG, real renderer)', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/tools/editor`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  const make = (spec) => page.evaluate(async (spec) => {
    const c = new OffscreenCanvas(400, 700); const x = c.getContext('2d');
    if (spec === 'shaded') {
      const g = x.createLinearGradient(0, 0, 400, 0); g.addColorStop(0, '#0a2a66'); g.addColorStop(1, '#011a48');
      x.fillStyle = g; x.fillRect(0, 0, 400, 700);                             // shaded, slightly off-hex navy bars
      x.fillStyle = '#fff'; x.font = '22px sans-serif'; x.fillText('Saturday, 9:41 AM', 20, 60);
      const p = x.createLinearGradient(0, 100, 0, 600); p.addColorStop(0, '#d8c3a5'); p.addColorStop(1, '#5d4037');
      x.fillStyle = p; x.fillRect(0, 100, 400, 500);                           // the picture
    } else if (spec === 'night') {
      x.fillStyle = '#000'; x.fillRect(0, 0, 400, 700);                       // letterbox bars
      const g = x.createLinearGradient(0, 120, 0, 580); g.addColorStop(0, '#141a2a'); g.addColorStop(0.45, '#2b3550'); g.addColorStop(1, '#c08040');
      x.fillStyle = g; x.fillRect(0, 120, 400, 460);                           // dark sky at the top of the photo
      for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(255,255,240,${(i % 5) / 6})`; x.fillRect((i * 67) % 400, 125 + ((i * 41) % 120), 2, 2); } // stars
    } else {
      x.fillStyle = '#022157'; x.fillRect(0, 0, 400, 90);                      // navy header with a title
      x.fillStyle = '#fff'; x.font = 'bold 30px sans-serif'; x.fillText('Gallery', 20, 58);
      x.fillStyle = '#9cc5a1'; x.fillRect(0, 90, 400, 610);                    // picture
      x.fillStyle = '#0B1014'; x.fillRect(0, 230, 330, 40);                    // a dark road across most of it
      x.fillStyle = '#e07a5f'; x.fillRect(60, 400, 120, 120);
    }
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer()));
  }, spec);
  await page.setInputFiles('#ed-file', [
    { name: 'night.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await make('night')) },
    { name: 'gallery.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await make('gallery')) },
    { name: 'shaded.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await make('shaded')) },
  ]);
  await page.waitForSelector('.bt-tile');
  await page.getByRole('button', { name: 'Apply to 3 photos' }).click();
  await page.waitForSelector('.bt-result:nth-child(3)', { timeout: 60000 });
  const rows = await page.$$eval('.bt-result-text', (els) => els.map((e) => e.textContent));
  const dims = rows.map((t) => /(\d+)×(\d+)/.exec(t).slice(1).map(Number));
  // Night: bars 120 rows top and bottom -> 460 tall (±2 for JPEG edges), not cut into the dark sky.
  assert.ok(Math.abs(dims[0][1] - 460) <= 2, `night photo height ${dims[0][1]} (${rows[0]})`);
  // Gallery: only the 90-row header goes -> 610 tall; the dark road is part of the picture.
  assert.ok(Math.abs(dims[1][1] - 610) <= 2, `gallery height ${dims[1][1]} (${rows[1]})`);
  // Shaded, off-hex navy with text on it: cut at both lines -> 500 tall.
  assert.ok(Math.abs(dims[2][1] - 500) <= 2, `shaded height ${dims[2][1]} (${rows[2]})`);
  assert.deepEqual(errors, []);
  await context.close();
});
