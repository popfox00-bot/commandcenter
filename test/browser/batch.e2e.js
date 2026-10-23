// Bulk edits and Auto-Crop in the Photo editor, offline, on the real (WebGL) renderer: feed
// screenshots (status bar, "Try Muse" banner, account header, media, carousel dots, action bar,
// caption, floating tab bar, next post) are cropped to just the post's media; each result is its own
// file with a unique name, handed to the share sheet (Save to Photos / Files). A crop Auto-Crop isn't
// sure of is not applied: it opens with the crop handles on it. Also the real reference screenshot.
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

/**
 * A 393×852 feed screenshot (an iPhone screenshot at 1/3 size). Media at rows 148..639, full width.
 * theme: 'dark' (#0d1117), 'navy' (#022157) or 'light' (white). media: 'slab' (flat gray, a graded
 * coin slab in the middle), 'photo' (colorful), 'white' (white background with an object).
 */
async function feedShot(page, { theme = 'dark', media = 'photo', type = 'image/png' } = {}) {
  return Buffer.from(await page.evaluate(async ({ theme, media, type }) => {
    const c = new OffscreenCanvas(393, 852); const x = c.getContext('2d');
    const chrome = { dark: '#0d1117', navy: '#022157', light: '#ffffff' }[theme];
    const ink = theme === 'light' ? '#141414' : '#ebebeb';
    const rr = (l, t, w, h, r, fill) => { x.fillStyle = fill; x.beginPath(); x.roundRect(l, t, w, h, r); x.fill(); };
    const dot = (cx, cy, r, fill) => { x.fillStyle = fill; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); };
    x.fillStyle = chrome; x.fillRect(0, 0, 393, 852);
    x.fillStyle = ink; x.font = 'bold 15px sans-serif'; x.fillText('3:15', 40, 24); x.fillRect(320, 14, 50, 10); // status bar
    rr(33, 37, 328, 34, 10, '#4f5be6'); x.fillStyle = '#fff'; x.fillText('Try Muse', 165, 59);                  // banner
    dot(27, 123, 16, '#c8aa5a'); x.fillStyle = ink; x.font = '15px sans-serif'; x.fillText('pcgscoin', 53, 129); // header
    for (const y of [117, 122, 127]) x.fillRect(360, y, 20, 2);
    if (media === 'slab') {
      x.fillStyle = '#c4c4c4'; x.fillRect(0, 148, 393, 491);
      rr(110, 250, 173, 230, 12, '#f2f2f2'); x.fillStyle = '#6b8fd6'; x.fillRect(122, 262, 149, 48); dot(196, 400, 50, '#3a9a3a');
    } else if (media === 'white') {
      x.fillStyle = '#ffffff'; x.fillRect(0, 148, 393, 491); rr(70, 250, 253, 290, 8, '#2878c8');
    } else {
      const g = x.createLinearGradient(0, 148, 393, 639); g.addColorStop(0, '#f4a261'); g.addColorStop(0.5, '#2a9d8f'); g.addColorStop(1, '#e9c46a');
      x.fillStyle = g; x.fillRect(0, 148, 393, 491);
      for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${i * 37} 70% 60%)`; x.fillRect((i * 53) % 360, 160 + ((i * 97) % 450), 30, 20); }
    }
    for (const cx of [190, 200, 210]) dot(cx, 655, 3, cx === 190 ? '#5865f2' : '#5a5a5a');                    // dots
    for (const l of [13, 83, 133, 183]) { rr(l, 673, 19, 19, 5, ink); x.fillStyle = ink; x.font = '13px sans-serif'; x.fillText('227', l + 24, 687); }
    rr(367, 673, 16, 19, 2, ink);                                                                                 // action bar
    x.fillStyle = ink; x.fillText('pcgscoin Obey your thirst — for silver… more', 12, 722);
    x.fillStyle = '#828282'; x.fillText('2 days ago', 12, 744);
    dot(27, 790, 13, '#4670dc'); x.fillStyle = ink; x.fillText('muse', 50, 795);                                // next post
    x.fillStyle = '#f2f2f2'; x.fillRect(10, 817, 250, 35);
    rr(50, 777, 293, 47, 23, '#24262e'); for (const l of [70, 127, 184, 241, 298]) rr(l, 791, 19, 19, 4, '#dcdcdc'); // tab bar
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type, quality: 0.9 })).arrayBuffer()));
  }, { theme, media, type }));
}

test('bulk Auto-Crop, offline: each screenshot cropped to its own post media, saved as separate uniquely named files', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  // Load once so the service worker caches the app, then go offline.
  await page.goto(`${origin}${BASE}#/tools/editor`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const files = [
    { name: 'image.png', mimeType: 'image/png', buffer: await feedShot(page, { theme: 'dark', media: 'slab' }) },
    { name: 'image.jpg', mimeType: 'image/jpeg', buffer: await feedShot(page, { theme: 'navy', media: 'photo', type: 'image/jpeg' }) },
    { name: 'image.png', mimeType: 'image/png', buffer: await barred(page, {}) },
    { name: 'light.png', mimeType: 'image/png', buffer: await feedShot(page, { theme: 'light', media: 'white' }) },
  ];
  await context.setOffline(true);
  await page.goto(`${origin}${BASE}#/tools/editor`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  await page.setInputFiles('#ed-file', files);
  await page.waitForSelector('.bt-grid .bt-tile');
  assert.match(await page.textContent('.bt-top'), /4 photos · 4 selected/);
  await page.waitForFunction(() => /Cropped to the post: top 148 px, bottom 213 px/.test(document.querySelector('.bt-preview-note')?.textContent ?? ''));
  assert.match(await page.textContent('.bt-more'), /#022157 or #0B1014/i, 'the app color hints are listed');
  assert.equal(await page.getAttribute('#bt-autoCrop', 'aria-pressed'), 'true', 'Auto-Crop is on by default');

  // Like an iPhone: a share sheet is available (mocked to capture what would be saved).
  await page.evaluate(() => {
    window.__shared = null;
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      window.__shared = await Promise.all(data.files.map(async (f) => { const b = await createImageBitmap(f); return { name: f.name, type: f.type, w: b.width, h: b.height }; }));
    };
  });
  await page.getByRole('button', { name: 'Apply to 4 photos' }).click();
  await page.waitForSelector('.bt-result-list .bt-result:nth-child(4)', { timeout: 60000 });
  const list = await page.$$eval('.bt-result-text', (els) => els.map((e) => e.textContent));
  assert.match(list[0], /^image-edited\.png393×491.*Cropped to the post: top 148 px, bottom 213 px \(\d+% sure\)/);
  assert.match(list[1], /^image-edited\.jpg393×(489|49\d).*Cropped to the post/, 'JPEG edges may blur a pixel or two');
  assert.match(list[2], /^image-edited-2\.png300×500.*No app screen found/);
  assert.match(list[3], /^light-edited\.png393×852.*Not sure where the post is \(\d+% sure\): check the crop/, 'not sure: left uncropped');
  assert.equal(await page.locator('.bt-result').nth(3).getByRole('button', { name: /Check crop/ }).count(), 1);
  assert.equal(await page.locator('.bt-result').nth(0).getByRole('button', { name: /Check crop/ }).count(), 0);

  // Save to Photos: all four files go to the share sheet at once, each its own file.
  assert.equal(await page.getByRole('button', { name: 'Save to Files' }).count(), 1);
  await page.getByRole('button', { name: 'Save to Photos' }).click();
  await page.waitForFunction(() => window.__shared);
  const shared = await page.evaluate(() => window.__shared);
  assert.deepEqual(shared.map((f) => f.name), ['image-edited.png', 'image-edited.jpg', 'image-edited-2.png', 'light-edited.png']);
  assert.deepEqual(shared.map((f) => f.type), ['image/png', 'image/jpeg', 'image/png', 'image/png'], 'same file type as each photo');

  // "Check crop" opens the photo with the crop handles on the suggested crop: between the header and the action bar.
  await page.locator('.bt-result').nth(3).getByRole('button', { name: /Check crop/ }).click();
  await page.waitForSelector('.ed-canvas');
  assert.equal(await page.getAttribute('[role=tab]:has-text("Crop")', 'aria-selected'), 'true', 'opens in Crop, handles showing');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => /393×\d+/.test(document.querySelector('.ed-dialog .muted')?.textContent ?? ''));
  const h = Number(/393×(\d+)/.exec(await page.textContent('.ed-dialog .muted'))[1]);
  assert.ok(h >= 470 && h <= 535, `suggested crop height ${h}: the media (491) without the header or the action bar`);

  assert.deepEqual(external, [], 'photos never leave the phone: no request outside the app');
  assert.deepEqual(errors, []);
  await context.close();
});

test('single photo: Auto-Crop applies a sure crop; an unsure one shows the crop handles instead', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(`${origin}${BASE}#/tools/editor`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  await page.setInputFiles('#ed-file', { name: 'shot.png', mimeType: 'image/png', buffer: await feedShot(page, { theme: 'dark', media: 'slab' }) });
  await page.waitForSelector('.ed-canvas');
  await page.locator('.ed-quick').getByRole('button', { name: /Auto-Crop/ }).click();
  await page.waitForFunction(() => /Cropped to the post: top 148 px, bottom 213 px/.test(document.querySelector('.ed-quick-note')?.textContent ?? ''));
  assert.equal(await page.getAttribute('[role=tab]:has-text("Adjust")', 'aria-selected'), 'true', 'sure: applied, no handles needed');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => /393×491/.test(document.querySelector('.ed-dialog .muted')?.textContent ?? ''));
  await page.locator('dialog[open]').getByRole('button', { name: 'Close' }).click();

  // Light mode, white photo: the edges can't be seen. The best guess gets the crop handles.
  const light = await feedShot(page, { theme: 'light', media: 'white' });
  const context2 = await browser.newContext({ viewport: { width: 390, height: 844 } }); // fresh: no edit in progress to resume
  const page2 = await context2.newPage();
  page2.on('pageerror', (e) => errors.push(e.message));
  await page2.goto(`${origin}${BASE}#/tools/editor`);
  await page2.waitForSelector('#ed-file', { state: 'attached' });
  await page2.setInputFiles('#ed-file', { name: 'light.png', mimeType: 'image/png', buffer: light });
  await page2.waitForSelector('.ed-canvas');
  await page2.locator('.ed-quick').getByRole('button', { name: /Auto-Crop/ }).click();
  await page2.waitForFunction(() => /Not sure where the post is.*drag the handles/.test(document.querySelector('.ed-quick-note')?.textContent ?? ''));
  assert.equal(await page2.getAttribute('[role=tab]:has-text("Crop")', 'aria-selected'), 'true', 'not sure: the crop handles are showing');
  assert.deepEqual(external, [], 'photos never leave the phone: no request outside the app');
  assert.deepEqual(errors, []);
  await context.close();
  await context2.close();
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

test('reference screenshot (dark feed, flat gray coin slab) through the real renderer: just the media', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/tools/editor`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  const ref = await readFile(resolve(import.meta.dirname, '../fixtures/feed_dark_gray_media_723.png'));
  await page.setInputFiles('#ed-file', [
    { name: 'ref.png', mimeType: 'image/png', buffer: ref },
    { name: 'navy.jpg', mimeType: 'image/jpeg', buffer: await feedShot(page, { theme: 'navy', media: 'slab', type: 'image/jpeg' }) },
  ]);
  await page.waitForSelector('.bt-tile');
  await page.getByRole('button', { name: 'Apply to 2 photos' }).click();
  await page.waitForSelector('.bt-result:nth-child(2)', { timeout: 60000 });
  const rows = await page.$$eval('.bt-result-text', (els) => els.map((e) => e.textContent));
  const dims = rows.map((t) => /(\d+)×(\d+)/.exec(t).slice(1).map(Number));
  // Media rows 273..1177 of 1568 (445..1918 at 1179×2556): no header, banner or carousel dots.
  assert.equal(dims[0][0], 723);
  assert.ok(Math.abs(dims[0][1] - 904) <= 3, `reference height ${dims[0][1]} (${rows[0]})`);
  assert.match(rows[0], /Cropped to the post: top 27\d px/);
  assert.ok(Math.abs(dims[1][1] - 491) <= 2, `navy JPEG height ${dims[1][1]} (${rows[1]})`);
  assert.deepEqual(errors, []);
  await context.close();
});
