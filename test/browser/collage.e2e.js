// Browser tests for Cutout (+ Characters) and Collage (grid and superimpose).
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

/** Make a PNG in the page: solid background, optional colored circle in the middle. */
function makePng(page, { w = 400, h = 300, bg = '#888888', circle = null } = {}) {
  return page.evaluate(async ({ w, h, bg, circle }) => {
    const c = new OffscreenCanvas(w, h); const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    if (circle) { x.fillStyle = circle; x.beginPath(); x.arc(w / 2, h / 2, Math.min(w, h) * 0.25, 0, Math.PI * 2); x.fill(); }
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }, { w, h, bg, circle }).then((a) => Buffer.from(a));
}

/** Pixel of a downloaded image file, decoded in the page. */
async function pixelOf(page, buffer, type, fx, fy) {
  return page.evaluate(async ({ bytes, type, fx, fy }) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type }));
    const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(Math.floor(fx * (bmp.width - 1)), Math.floor(fy * (bmp.height - 1)), 1, 1).data;
    return { rgba: [d[0], d[1], d[2], d[3]], w: bmp.width, h: bmp.height };
  }, { bytes: [...buffer], type, fx, fy });
}

async function canvasBox(page, sel) {
  return page.$eval(sel, (c) => { c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
}

test('cutout: trace around an object, save it as a Character, place it on a photo, export', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept('Red ball'));
  await page.goto(`${origin}${BASE}#/files/cutout`);
  await page.waitForSelector('#co-file', { state: 'attached' });
  await page.setInputFiles('#co-file', { name: 'ball.png', mimeType: 'image/png', buffer: await makePng(page, { circle: '#e02020' }) });
  await page.waitForSelector('.co-canvas');
  const b = await canvasBox(page, '.co-canvas');
  // Trace a circle slightly larger than the ball (radius 0.25 of 300px = 75px -> trace 90px).
  const cx = b.x + b.w / 2; const cy = b.y + b.h / 2; const r = (90 / 300) * b.h;
  await page.mouse.move(cx + r, cy); await page.mouse.down();
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 24) await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a));
  await page.mouse.up();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForSelector('text=transparent background');
  await page.getByRole('button', { name: 'Save as Character' }).click();
  await page.waitForSelector('text=Saved as Character "Red ball"');

  // The saved Character: transparent corners, solid red middle.
  const px = await page.evaluate(async () => {
    const get = (k) => new Promise((res) => { const q = indexedDB.open('command-center'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get(k); g.onsuccess = () => res(g.result); }; });
    const [c] = await get('characters.index');
    const bmp = await createImageBitmap(await get(`characters.blob.${c.id}`));
    const cv = new OffscreenCanvas(bmp.width, bmp.height); const x = cv.getContext('2d'); x.drawImage(bmp, 0, 0);
    const at = (fx, fy) => [...x.getImageData(Math.floor(fx * (bmp.width - 1)), Math.floor(fy * (bmp.height - 1)), 1, 1).data];
    return { name: c.name, corner: at(0, 0), middle: at(0.5, 0.5), w: bmp.width };
  });
  assert.equal(px.name, 'Red ball');
  assert.ok(px.corner[3] < 30, `corner transparent ${px.corner}`);
  assert.ok(px.middle[0] > 200 && px.middle[3] === 255, `middle red ${px.middle}`);
  assert.ok(px.w < 400, 'cropped to the object');

  await page.getByRole('button', { name: 'Place on a photo' }).click();
  await page.waitForFunction(() => location.hash === '#/files/collage');
  await page.waitForSelector('.cl-canvas');
  // Add a blue background photo.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Background photo' }).click();
  await (await chooser).setFiles({ name: 'sky.png', mimeType: 'image/png', buffer: await makePng(page, { w: 600, h: 400, bg: '#2050e0' }) });
  await page.waitForFunction(() => document.querySelector('.cl-canvas')?.width > 0);
  await page.waitForTimeout(200);
  // Drag the ball (selected, centered) toward the top-left.
  const c = await canvasBox(page, '.cl-canvas');
  await page.mouse.move(c.x + c.w / 2, c.y + c.h / 2); await page.mouse.down();
  await page.mouse.move(c.x + c.w * 0.3, c.y + c.h * 0.35, { steps: 6 }); await page.mouse.up();

  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => /^Collage \d{4}-/.test(document.querySelector('.ed-dialog .muted')?.textContent ?? ''));
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const buf = await readFile(await (await dl).path());
  const moved = await pixelOf(page, buf, 'image/jpeg', 0.3, 0.35);
  const corner = await pixelOf(page, buf, 'image/jpeg', 0.95, 0.95);
  assert.ok(Math.abs(moved.w / moved.h - 1.5) < 0.01, 'shape follows the background photo');
  assert.ok(moved.rgba[0] > 180 && moved.rgba[2] < 100, `ball where we dragged it ${moved.rgba}`);
  assert.ok(corner.rgba[2] > 180 && corner.rgba[0] < 80, `background photo elsewhere ${corner.rgba}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('collage grid: two photos side by side with spacing on a white background', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(`${origin}${BASE}#/files/collage`);
  await page.waitForSelector('.cl-canvas');
  await page.getByRole('button', { name: '2 side by side' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photos' }).click();
  await (await chooser).setFiles([
    { name: 'red.png', mimeType: 'image/png', buffer: await makePng(page, { bg: '#e02020' }) },
    { name: 'blue.png', mimeType: 'image/png', buffer: await makePng(page, { bg: '#2050e0' }) },
  ]);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => /^Collage \d{4}-/.test(document.querySelector('.ed-dialog .muted')?.textContent ?? ''));
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const buf = await readFile(await (await dl).path());
  const left = await pixelOf(page, buf, 'image/jpeg', 0.25, 0.5);
  const right = await pixelOf(page, buf, 'image/jpeg', 0.75, 0.5);
  const gap = await pixelOf(page, buf, 'image/jpeg', 0.5, 0.5);
  assert.equal(left.w, left.h, 'square by default');
  assert.ok(left.rgba[0] > 180 && left.rgba[2] < 90, `left red ${left.rgba}`);
  assert.ok(right.rgba[2] > 180 && right.rgba[0] < 90, `right blue ${right.rgba}`);
  assert.ok(gap.rgba.slice(0, 3).every((v) => v > 230), `white gap ${gap.rgba}`);
  await context.close();
});

test('cutout: smart edges bring a loose trace in to the object; a trace added inside leaves a part out; tap a trace to remove it; undo and redo; patch fix', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/files/cutout`);
  await page.waitForSelector('#co-file', { state: 'attached' });
  await page.setInputFiles('#co-file', { name: 'ball.png', mimeType: 'image/png', buffer: await makePng(page, { circle: '#e02020' }) });
  await page.waitForSelector('.co-canvas');
  const b = await canvasBox(page, '.co-canvas');
  const cx = b.x + b.w / 2; const cy = b.y + b.h / 2; const k = b.h / 300; // the ball: radius 75 of 300
  const traceCircle = async (r) => {
    await page.mouse.move(cx + r, cy); await page.mouse.down();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 24) await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a));
    await page.mouse.up();
  };
  const resultWidth = async () => {
    await page.getByRole('button', { name: 'Done' }).click();
    await page.waitForSelector('.checker.big img');
    const w = await page.$eval('.checker.big img', (img) => new Promise((res) => { if (img.complete) res(img.naturalWidth); else img.onload = () => res(img.naturalWidth); }));
    await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click();
    return w;
  };
  // A loose trace, well outside the ball: smart edges (on by default) trim it in to the ball.
  await traceCircle(115 * k);
  assert.equal(await page.getAttribute('.co-smart .chip', 'aria-pressed'), 'true');
  assert.match(await page.textContent('.co-smart'), /Trimmed \d+% of the traced area/);
  const smart = await resultWidth();
  // (the ball is 150 px across and the trace 230; the soft edge adds about 10 px each side)
  assert.ok(smart >= 150 && smart <= 180, `cut to the ball: ${smart} px wide`);

  // A trace added inside: the middle of the ball is left out.
  await page.getByRole('radio', { name: '➕ Add to trace' }).click();
  await traceCircle(25 * k);
  await page.getByRole('button', { name: 'Preview cutout' }).click();
  const centre = await page.$eval('.co-canvas', (c) => [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data]);
  assert.ok(!(centre[0] > 200 && centre[1] < 60), `the middle is left out (checkerboard shows): ${centre}`);
  await page.getByRole('button', { name: 'Show photo' }).click();

  // Remove trace: tap the small trace's line, it's gone; undo brings it back, redo removes it again.
  await page.getByRole('radio', { name: '🗑 Remove trace' }).click();
  const b2 = await canvasBox(page, '.co-canvas');
  await page.mouse.click(b2.x + b2.w / 2 + 25 * k, b2.y + b2.h / 2);
  const middle = async () => { await page.getByRole('button', { name: 'Preview cutout' }).click(); const p = await page.$eval('.co-canvas', (c) => [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data]); await page.getByRole('button', { name: 'Show photo' }).click(); return p[0] > 200 && p[1] < 60; };
  assert.equal(await middle(), true, 'the middle is back');
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await middle(), false, 'undo: the trace inside is back, the middle left out again');
  await page.getByRole('button', { name: 'Redo' }).click();
  assert.equal(await middle(), true);

  // Patch fix.
  await page.getByRole('radio', { name: '🩹 Patch fix' }).click();
  assert.equal(await page.isVisible('[aria-label="Patch size"]'), true);
  const b3 = await canvasBox(page, '.co-canvas');
  await page.mouse.click(b3.x + b3.w / 2 + 75 * k, b3.y + b3.h / 2);
  // Tapped on the ball's edge, where the cut is already right: it stays right.
  const patched = await resultWidth();
  assert.ok(patched >= 150 && patched <= 180, `still cut to the ball: ${patched} px wide`);

  // Brush (cut away): paint across the middle, it's left out. Wand (keep): tap it, the ball's red comes back.
  await page.getByRole('radio', { name: '🖌 Brush' }).click();
  assert.equal(await page.getAttribute('.co-dir .seg.active', 'aria-checked'), 'true');
  assert.match(await page.textContent('.co-dir .seg.active'), /Cut away/);
  const b4 = await canvasBox(page, '.co-canvas');
  await page.mouse.move(b4.x + b4.w / 2 - 30 * k, b4.y + b4.h / 2); await page.mouse.down();
  for (let d = -30; d <= 30; d += 5) await page.mouse.move(b4.x + b4.w / 2 + d * k, b4.y + b4.h / 2);
  assert.equal(await page.isVisible('.co-canvas'), true);
  await page.mouse.up();
  await page.waitForSelector('text=/Cut away [\\d,]+ pixels/');
  assert.equal(await middle(), false, 'brushed out');
  await page.getByRole('radio', { name: '🪄 Wand' }).click();
  await page.locator('.co-dir').getByRole('radio', { name: '↩︎ Keep' }).click();
  const b5 = await canvasBox(page, '.co-canvas');
  await page.mouse.click(b5.x + b5.w / 2, b5.y + b5.h / 2);
  await page.waitForSelector('text=/Brought back [\\d,]+ pixels/');
  assert.equal(await middle(), true, 'the wand brought it back');
  // Remove trace: tap the wand's dot, the fix is gone (the middle is out again); undo.
  await page.getByRole('radio', { name: '🗑 Remove trace' }).click();
  await page.mouse.click(b5.x + b5.w / 2, b5.y + b5.h / 2);
  assert.equal(await middle(), false, 'the wand fix removed');
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await middle(), true);
  // The patch fix's directions.
  await page.getByRole('radio', { name: '🩹 Patch fix' }).click();
  assert.deepEqual(await page.$$eval('.co-dir .seg', (els) => els.map((e) => e.textContent)), ['Auto', '✂️ Cut away', '↩︎ Keep']);

  // Smart edges off: the cut follows the trace as drawn.
  await page.click('.co-smart .chip');
  assert.match(await page.textContent('.co-smart'), /Off: the cut follows your trace exactly/);
  assert.ok(await resultWidth() > 200, 'as traced');
  assert.deepEqual(errors, []);
  await context.close();
});
