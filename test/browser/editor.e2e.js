// Browser tests for the Photo Editor (`npm run test:web`): real WebGL rendering checked by pixels.
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

/** A 200x100 test photo: left half red, right half blue, made in the page. */
async function openEditor() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${origin}${BASE}#/tools/editor`);
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
  await page.waitForTimeout(150);
  const [r, g, b] = await pixel(page, 0.25, 0.5);
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
