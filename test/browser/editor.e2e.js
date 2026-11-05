// Browser tests for the Photo Editor (`npm run test:web`): real WebGL rendering checked by pixels.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
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

/** A 200x100 test photo: left half red, right half blue, made in the page. */
async function openEditor() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${origin}${BASE}#/files`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(200, 100);
    const x = c.getContext('2d');
    x.fillStyle = 'rgb(200,40,40)'; x.fillRect(0, 0, 100, 100);
    x.fillStyle = 'rgb(40,40,200)'; x.fillRect(100, 0, 100, 100);
    const b = await c.convertToBlob({ type: 'image/png' });
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.setInputFiles('#ed-file', { name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  await page.waitForTimeout(200);
  return { context, page, errors };
}

/** Pixel [r,g,b] at fractional position of the preview canvas. */
function pixel(page, fx, fy) {
  return page.evaluate(([fx2, fy2]) => {
    const c = document.querySelector('.ed-canvas');
    const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
    const x = t.getContext('2d'); x.drawImage(c, 0, 0);
    const d = x.getImageData(Math.floor(fx2 * (c.width - 1)), Math.floor(fy2 * (c.height - 1)), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [fx, fy]);
}
const size = (page) => page.evaluate(() => { const c = document.querySelector('.ed-canvas'); return [c.width, c.height]; });

async function setSlider(page, value) {
  await page.$eval('.ed-slider input', (r, v) => {
    r.value = String(v);
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForTimeout(120);
}

test('opens a photo and renders it unchanged by default', async () => {
  const { context, page, errors } = await openEditor();
  const [w, h] = await size(page);
  assert.ok(Math.abs(w / h - 2) < 0.03, `aspect ${w}x${h}`);
  const left = await pixel(page, 0.25, 0.5);
  const right = await pixel(page, 0.75, 0.5);
  assert.ok(left[0] > 180 && left[2] < 70, `left red ${left}`);
  assert.ok(right[2] > 180 && right[0] < 70, `right blue ${right}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('exposure brightens, undo restores, Mono filter removes color', async () => {
  const { context, page } = await openEditor();
  const base = await pixel(page, 0.25, 0.5);
  await setSlider(page, 80); // exposure is the default adjustment
  const bright = await pixel(page, 0.25, 0.5);
  assert.ok(bright[1] > base[1] + 15, `brighter ${base} -> ${bright}`);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(120);
  assert.deepEqual(await pixel(page, 0.25, 0.5), base);
  await page.getByRole('button', { name: 'Redo' }).click();
  await page.getByRole('tab', { name: 'Filters' }).click();
  await page.getByRole('button', { name: 'Mono', exact: true }).click();
  // Drawn on the next frame: wait for it (a busy machine can take a while), then check.
  let r; let g; let b;
  for (let k = 0; k < 40; k++) { [r, g, b] = await pixel(page, 0.25, 0.5); if (Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2) break; await page.waitForTimeout(100); }
  assert.ok(Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2, `gray ${r},${g},${b}`);
  await context.close();
});

test('crop to square, rotate and flip change the output geometry', async () => {
  const { context, page } = await openEditor();
  await page.getByRole('tab', { name: 'Crop' }).click();
  await page.getByRole('button', { name: 'Square' }).click();
  await page.getByRole('button', { name: '⟳ Rotate' }).click();
  await page.getByRole('tab', { name: 'Adjust' }).click(); // leave crop mode to see the cropped result
  await page.waitForTimeout(150);
  const [w, h] = await size(page);
  assert.ok(Math.abs(w - h) <= 2, `square ${w}x${h}`);
  // Centered square of a red|blue image: after rotating 90° clockwise, red is on top.
  const top = await pixel(page, 0.5, 0.2);
  const bottom = await pixel(page, 0.5, 0.8);
  assert.ok(top[0] > 150 && bottom[2] > 150, `top ${top} bottom ${bottom}`);
  await page.getByRole('tab', { name: 'Crop' }).click();
  await page.getByRole('button', { name: '⇋ Flip' }).click();
  await page.getByRole('tab', { name: 'Adjust' }).click();
  await page.waitForTimeout(150);
  assert.ok((await pixel(page, 0.5, 0.2))[0] > 150, 'horizontal flip keeps red on top');
  await context.close();
});

test('markup: draw a box, erase it, export a JPEG with the edits', async () => {
  const { context, page } = await openEditor();
  await page.getByRole('tab', { name: 'Markup' }).click();
  await page.getByRole('button', { name: /Box/ }).click();
  const box = await page.$eval('.ed-overlay', (o) => { const r = o.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.mouse.move(box.x + box.w * 0.1, box.y + box.h * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.4, box.y + box.h * 0.8, { steps: 5 });
  await page.mouse.up();
  const count = () => page.evaluate(async () => (await new Promise((r) => { const q = indexedDB.open('command-center'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('editor.session'); g.onsuccess = () => r(g.result); }; }))?.state.markup.length);
  await page.waitForTimeout(600); // autosave debounce
  assert.equal(await count(), 1, 'box saved in the autosave');
  await page.getByRole('button', { name: /Eraser/ }).click();
  await page.mouse.click(box.x + box.w * 0.1, box.y + box.h * 0.5);
  await page.waitForTimeout(600);
  assert.equal(await count(), 0, 'eraser removed it');
  await page.getByRole('button', { name: 'Undo' }).click();

  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => /test-edited\.jpg · 200×100/.test(document.querySelector('.ed-dialog .muted')?.textContent ?? ''));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const file = await download;
  assert.equal(file.suggestedFilename(), 'test-edited.jpg');
  await context.close();
});

test('an edit in progress survives closing the app', async () => {
  const { context, page } = await openEditor();
  await setSlider(page, 60);
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('text=Continue editing test.png?');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('.ed-canvas');
  await page.waitForTimeout(150);
  assert.match(await page.$eval('.ed-slider output', (o) => o.textContent), /^60$/);
  await context.close();
});

test('clean up: tap a speck away, copy from another area over a spot; then Collage and Cutout take the photo', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/files`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  // A red half and a blue half, with a white speck on the red.
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(200, 100);
    const x = c.getContext('2d');
    x.fillStyle = 'rgb(200,40,40)'; x.fillRect(0, 0, 100, 100);
    x.fillStyle = 'rgb(40,40,200)'; x.fillRect(100, 0, 100, 100);
    x.fillStyle = '#fff'; x.fillRect(45, 45, 8, 8);
    const b = await c.convertToBlob({ type: 'image/png' });
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.setInputFiles('#ed-file', { name: 'speck.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  assert.deepEqual(await page.$$eval('.ed-modes [role=tab]', (els) => els.map((e) => e.textContent)), ['Adjust', 'Filters', 'Crop', 'Markup', 'Clean Up']);
  await page.getByRole('tab', { name: 'Clean Up' }).click();
  await page.waitForSelector('text=draw a circle around it');
  const white = await pixel(page, 0.245, 0.49);
  assert.ok(white[0] > 230 && white[2] > 230, `the speck: ${white}`);
  const tap = async (fx, fy) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const b = await page.$eval('.ed-overlay', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    await page.mouse.click(b[0] + fx * b[2], b[1] + fy * b[3]);
  };
  await tap(0.245, 0.49);
  await page.waitForSelector('text=Spot cleaned up');
  await page.waitForTimeout(150);
  const after = await pixel(page, 0.245, 0.49);
  assert.ok(after[0] > 150 && after[1] < 90 && after[2] < 90, `the speck is gone: red again (${after})`);
  // Copy From Area: pick a spot on the blue, then tap the red: it gets the blue.
  await page.getByRole('button', { name: '📋 Copy From Area' }).click();
  await page.waitForSelector('text=Tap the spot to copy from');
  await tap(0.75, 0.5);
  await page.waitForSelector('text=Now tap, brush or circle the area to cover');
  await tap(0.2, 0.3);
  await page.waitForSelector('text=Copied in and blended');
  await page.waitForTimeout(150);
  const copied = await pixel(page, 0.2, 0.3);
  assert.ok(copied[2] > copied[0], `a copy of the blue, blended toward the red around it (${copied})`);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(150);
  const undone = await pixel(page, 0.2, 0.3);
  assert.ok(undone[0] > 150 && undone[2] < 90, `undo: red again (${undone})`);

  // Collage: the photo goes into a frame.
  await page.getByRole('tab', { name: '🧩 Collage' }).click();
  await page.waitForSelector('.cl-canvas');
  await page.waitForSelector('.ed-panel >> text=Replace');
  // Cutout: asked what to do with it; tracing opens it in Cutout.
  await page.getByRole('tab', { name: '✏️ Edit' }).click();
  await page.getByRole('tab', { name: '✂️ Cutout' }).click();
  await page.waitForSelector('dialog[open] >> text=Cutout with this photo');
  await page.locator('dialog[open]').getByRole('button', { name: '✂️ Trace a cutout' }).click();
  await page.waitForSelector('.co-canvas');
  // Back and forth with no new edits: not asked again.
  await page.getByRole('tab', { name: '✏️ Edit' }).click();
  await page.getByRole('tab', { name: '✂️ Cutout' }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible('dialog[open]'), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('clean up → 🎨 Reverse Fill: pick the label\'s shades, trace roughly around it; it\'s removed and filled with the can, not the wall', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/files`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  // A green wall; a blue can (x 70–130) with a white label (y 40–70), red bands on it, black print.
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(200, 120);
    const x = c.getContext('2d');
    x.fillStyle = 'rgb(80,130,70)'; x.fillRect(0, 0, 200, 120);
    x.fillStyle = 'rgb(40,70,190)'; x.fillRect(70, 0, 60, 120);
    x.fillStyle = 'rgb(240,240,236)'; x.fillRect(70, 40, 60, 30);
    x.fillStyle = 'rgb(210,30,35)'; x.fillRect(70, 40, 60, 6); x.fillRect(70, 64, 60, 6);
    x.fillStyle = 'rgb(20,20,20)'; x.fillRect(85, 50, 4, 10); x.fillRect(100, 52, 14, 3);
    const b = await c.convertToBlob({ type: 'image/png' });
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.setInputFiles('#ed-file', { name: 'can.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  await page.getByRole('tab', { name: 'Clean Up' }).click();
  await page.getByRole('button', { name: '🎨 Reverse Fill' }).click();
  await page.waitForSelector('text=Tap the colors to remove');
  const box = async () => { await page.evaluate(() => window.scrollTo(0, 0)); return page.$eval('.ed-overlay', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }); };
  const at = (b, fx, fy) => [b[0] + fx * b[2], b[1] + fy * b[3]];
  // Two shades: the white and the red.
  let b = await box();
  await page.mouse.click(...at(b, 0.6, 0.47));
  await page.mouse.click(...at(b, 0.6, 0.355));
  assert.equal(await page.locator('.ed-shade').count(), 2);
  // A rough loop around the label, wider than the can (onto the wall).
  b = await box();
  const loop = [[0.3, 0.27], [0.7, 0.27], [0.7, 0.63], [0.3, 0.63], [0.3, 0.29]];
  await page.mouse.move(...at(b, ...loop[0])); await page.mouse.down();
  for (let i = 1; i < loop.length; i++) await page.mouse.move(...at(b, ...loop[i]), { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector('text=/Pink shows what goes: \\d+% of the traced area/');
  // The print is caught too (closed around by the shades); the wall isn't.
  await page.getByRole('button', { name: '✨ Remove & fill' }).click();
  await page.waitForSelector('text=Removed and filled from the surface around it');
  await page.waitForTimeout(200);
  for (const [fx, fy] of [[0.5, 0.47], [0.44, 0.45], [0.6, 0.355], [0.53, 0.44], [0.37, 0.56], [0.63, 0.4]]) {
    const p = await pixel(page, fx, fy);
    assert.ok(p[2] > 150 && p[0] < 90 && p[1] < 110, `blue can at ${fx},${fy} (${p})`);
  }
  for (const [fx, fy] of [[0.32, 0.47], [0.68, 0.5]]) {
    const p = await pixel(page, fx, fy);
    assert.ok(p[1] > 110 && p[2] < 100, `the wall beside it stays (${p})`);
  }
  // Undo brings the label back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(150);
  const back = await pixel(page, 0.6, 0.47);
  assert.ok(back[0] > 220 && back[2] > 220, `undo: the label again (${back})`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('crop → 🪄 Generative Expand: a new shape, the photo to one side, the black space filled from it; use it, and back', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const workers = [];
  page.on('worker', (w) => workers.push(w.url()));
  await page.goto(`${origin}${BASE}#/files`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  // A 240×160 landscape: sky on top, grass below the middle.
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(240, 160);
    const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, 90); sky.addColorStop(0, 'rgb(80,140,230)'); sky.addColorStop(1, 'rgb(170,210,235)');
    x.fillStyle = sky; x.fillRect(0, 0, 240, 90);
    x.fillStyle = 'rgb(60,130,50)'; x.fillRect(0, 90, 240, 70);
    for (let i = 0; i < 400; i++) { x.fillStyle = i % 2 ? 'rgb(80,150,60)' : 'rgb(45,110,40)'; x.fillRect((i * 37) % 240, 90 + ((i * 53) % 70), 3, 2); }
    const b = await c.convertToBlob({ type: 'image/png' });
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.setInputFiles('#ed-file', { name: 'field.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  await page.getByRole('tab', { name: 'Crop' }).click();
  await page.getByRole('button', { name: '🪄 Generative Expand' }).click();
  const dlg = page.locator('dialog[open].ed-expand');
  await dlg.waitFor();
  // 16:9: wider, the photo on the left, black on the right in the preview.
  await dlg.getByRole('button', { name: '16:9', exact: true }).click();
  await dlg.getByRole('button', { name: '◀ Left' }).click();
  assert.match(await dlg.locator('p[aria-live]').textContent(), /16:9: \d+ px of new space on the right/);
  const black = await dlg.locator('canvas').evaluate((c) => { const d = c.getContext('2d').getImageData(c.width - 3, c.height >> 1, 1, 1).data; return [d[0], d[1], d[2], c.width / c.height]; });
  assert.deepEqual(black.slice(0, 3), [0, 0, 0], 'the space to fill shows black');
  assert.ok(Math.abs(black[3] - 16 / 9) < 0.03);
  // Tall instead: 9:16 has Top / Middle / Bottom; the photo at the top.
  await dlg.getByRole('button', { name: '9:16', exact: true }).click();
  await dlg.getByRole('button', { name: '▲ Top' }).click();
  assert.match(await dlg.locator('p[aria-live]').textContent(), /9:16: \d+ px of new space below/);
  assert.equal(await dlg.getByRole('button', { name: '4:3', exact: true }).isDisabled(), false);
  assert.equal(await dlg.getByRole('button', { name: '3:2', exact: true }).isDisabled(), true, 'the shape it is already');
  await dlg.getByRole('button', { name: '✨ Expand' }).click();
  await dlg.locator('text=/Expanded to 9:16/').waitFor({ timeout: 60000 });
  assert.ok(workers.some((u) => u.endsWith('/expand-worker.js')), 'filled in a worker');
  // The preview: no black left; grass carried on down below the photo.
  const filled = await dlg.locator('canvas').evaluate((c) => {
    const x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data; let black = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 40) black++;
    const p = x.getImageData(c.width >> 1, c.height - 4, 1, 1).data;
    return { black, bottom: [p[0], p[1], p[2]], ratio: c.width / c.height };
  });
  assert.equal(filled.black, 0);
  assert.ok(filled.bottom[1] > filled.bottom[2] + 30, `grass at the bottom (${filled.bottom})`);
  assert.ok(Math.abs(filled.ratio - 9 / 16) < 0.02);
  await dlg.getByRole('button', { name: '✓ Use it' }).click();
  // The expanded picture is the photo now: 9:16, its top the photo's sky.
  await page.waitForFunction(() => { const c = document.querySelector('.ed-canvas'); return c && Math.abs(c.width / c.height - 9 / 16) < 0.02; });
  await page.waitForTimeout(200);
  const top = await pixel(page, 0.5, 0.05);
  assert.ok(top[2] > 200 && top[2] > top[1], `the photo's sky at the top (${top})`);
  const low = await pixel(page, 0.5, 0.92);
  assert.ok(low[1] > low[2] + 30, `filled with grass at the bottom (${low})`);
  // And back to the photo from before.
  await page.getByRole('button', { name: '↩ Before expanding' }).click();
  await page.waitForFunction(() => { const c = document.querySelector('.ed-canvas'); return c && Math.abs(c.width / c.height - 1.5) < 0.02; });
  assert.equal(await page.isVisible('text=↩ Before expanding'), false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('zoom within the photo: two fingers zoom (no stroke drawn), one finger then works on the zoomed photo; ⤢ Fit; Cutout too', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/files`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  // Red with a small white speck at (70, 30) of 200×100.
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(200, 100); const x = c.getContext('2d');
    x.fillStyle = 'rgb(200,40,40)'; x.fillRect(0, 0, 200, 100);
    x.fillStyle = '#fff'; x.fillRect(68, 28, 4, 4);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.setInputFiles('#ed-file', { name: 'speck.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  await page.getByRole('tab', { name: 'Markup' }).click();
  /** A two-finger pinch on `sel`: fingers start `d0` apart around (fx, fy) of it and end `d1` apart. */
  const pinch = (sel, fx, fy, d0, d1) => page.$eval(sel, (target, [fx2, fy2, a, b]) => {
    const r = target.getBoundingClientRect(); const cx = r.left + fx2 * r.width; const cy = r.top + fy2 * r.height;
    const ev = (type, id, x) => target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: cy, bubbles: true, cancelable: true }));
    ev('pointerdown', 1, cx - a / 2); ev('pointerdown', 2, cx + a / 2);
    for (let k = 1; k <= 8; k++) { const d = a + ((b - a) * k) / 8; ev('pointermove', 1, cx - d / 2); ev('pointermove', 2, cx + d / 2); }
    ev('pointerup', 1, cx - b / 2); ev('pointerup', 2, cx + b / 2);
  }, [fx, fy, d0, d1]);
  const before = await page.$eval('.ed-canvas', (c) => c.width);
  await pinch('.ed-overlay', 0.35, 0.3, 40, 160);
  await page.waitForFunction((w) => document.querySelector('.ed-canvas').width > w * 2, before);
  const zoom = await page.$eval('.ed-zoom', (e) => e.style.transform);
  const z = Number(/scale\(([\d.]+)\)/.exec(zoom)?.[1]);
  assert.ok(z > 3, `zoomed in (${zoom})`);
  assert.equal(await page.isVisible('text=⤢ Fit'), true);
  assert.equal(await page.isVisible('text=Remove all markup'), false, 'the pinch drew nothing');
  // The speck under the fingers is still there, now big: Clean Up taps it on the zoomed photo.
  await page.getByRole('tab', { name: 'Clean Up' }).click();
  const spot = await page.$eval('.ed-canvas', (c) => { const r = c.getBoundingClientRect(); return [r.left + 0.35 * r.width, r.top + 0.3 * r.height, r.width]; });
  assert.ok(spot[2] > 1000, 'the photo shows big');
  const shownWhite = await page.$eval('.ed-canvas', (c) => { const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); return [...x.getImageData(Math.round(0.35 * c.width), Math.round(0.3 * c.height), 1, 1).data]; });
  assert.ok(shownWhite[1] > 200, `the speck: ${shownWhite}`);
  await page.mouse.click(spot[0], spot[1]);
  await page.waitForSelector('text=Spot cleaned up');
  await page.waitForTimeout(150);
  const after = await page.$eval('.ed-canvas', (c) => { const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); return [...x.getImageData(Math.round(0.35 * c.width), Math.round(0.3 * c.height), 1, 1).data]; });
  assert.ok(after[0] > 150 && after[1] < 90, `the speck is gone where it was tapped: ${after}`);
  // ⤢ Fit: back to the whole photo. Ctrl + scroll zooms on a computer.
  await page.getByRole('button', { name: 'Fit photo' }).click();
  assert.equal(await page.$eval('.ed-zoom', (e) => e.style.transform), '');
  const b = await page.$eval('.ed-overlay', (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(...b);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -200); await page.keyboard.up('Control');
  assert.match(await page.$eval('.ed-zoom', (e) => e.style.transform), /scale\((?!1\))/);

  // Cutout: the same pinch zooms there, and leaves no trace.
  await page.getByRole('tab', { name: '✂️ Cutout' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: '✂️ Trace a cutout' }).click();
  await page.waitForSelector('.co-canvas');
  await pinch('.co-canvas', 0.5, 0.5, 40, 120);
  assert.ok(Number(/scale\(([\d.]+)\)/.exec(await page.$eval('.co-zoom', (e) => e.style.transform))?.[1]) > 2);
  assert.equal(await page.isDisabled('text=Preview cutout'), true, 'no trace from the pinch');
  assert.deepEqual(errors, []);
  await context.close();
});

test('phones: a thin scroll bar on the right scrolls the page past the photo (which a swipe would trace on); not on a computer', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/files`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(300, 400); const x = c.getContext('2d');
    x.fillStyle = 'rgb(200,40,40)'; x.fillRect(0, 0, 300, 400);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.setInputFiles('#ed-file', { name: 'tall.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  await page.getByRole('tab', { name: 'Clean Up' }).click();
  await page.waitForSelector('.scroll-rail:not([hidden])');
  // Nothing wider than the phone: the editor's tabs on one line, the page not scrolling sideways.
  assert.deepEqual(await page.evaluate(() => [document.documentElement.scrollWidth <= innerWidth, new Set([...document.querySelectorAll('.ed-modes .seg')].map((t) => Math.round(t.getBoundingClientRect().top))).size]), [true, 1]);
  assert.equal(await page.$eval('.ed-modes', (e) => e.scrollWidth <= e.clientWidth + 1), true, 'all the tabs fit');
  const rail = await page.$eval('.scroll-rail', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.width, r.height, innerWidth]; });
  assert.ok(rail[0] + rail[1] === rail[3] && rail[1] <= 24, `a thin strip at the right edge: ${rail}`);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(100);
  // The photo stops short of the bar: nothing of it under the bar.
  const stageRight = await page.$eval('.ed-stage', (e) => e.getBoundingClientRect().right);
  assert.ok(stageRight <= rail[0] + 0.5, `the photo (to ${stageRight}) ends before the bar (at ${rail[0]})`);
  // A tap on the bar: no jump.
  const x = rail[0] + rail[1] / 2;
  await page.mouse.click(x, rail[2] - 10);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => scrollY), 0, 'a tap does not jump');
  // A slide down the bar: the page glides down, about as far as the finger (at most 2.5×).
  await page.mouse.move(x, 20); await page.mouse.down();
  const seen = [];
  for (let k = 1; k <= 10; k++) { await page.mouse.move(x, 20 + k * 12); seen.push(await page.evaluate(() => scrollY)); }
  await page.mouse.up();
  await page.waitForFunction(() => { const y = scrollY; return new Promise((r) => requestAnimationFrame(() => r(scrollY === y))); });
  const y = await page.evaluate(() => [scrollY, document.documentElement.scrollHeight - innerHeight]);
  assert.ok(y[0] > 60 && y[0] <= 120 * 2.5 + 2, `glided down by ${y[0]} for a 120 px slide`);
  for (let k = 1; k < seen.length; k++) assert.ok(seen[k] >= seen[k - 1], 'never back and forth');
  assert.ok(Math.max(...seen.slice(1).map((v, k) => v - seen[k])) < 120, `smooth steps: ${seen}`);
  assert.equal(await page.isVisible('text=Spot cleaned up'), false, 'and nothing was cleaned up on the photo');
  assert.deepEqual(errors, []);
  await context.close();
  // A computer (a mouse, its own scroll bar): no rail.
  const desk = await browser.newContext({ viewport: { width: 1000, height: 600 } });
  const p2 = await desk.newPage();
  await p2.goto(`${origin}${BASE}#/files`);
  await p2.waitForSelector('#ed-file', { state: 'attached' });
  await p2.setInputFiles('#ed-file', { name: 'tall.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await p2.waitForSelector('.ed-canvas');
  await p2.waitForTimeout(150);
  assert.equal(await p2.isVisible('.scroll-rail'), false);
  await desk.close();
});
