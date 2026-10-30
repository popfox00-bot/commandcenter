// Draw, in the browser and offline: Home → Draw, a new square page, a red pen stroke, a filled blue
// box, the eraser through part of the stroke, undo/redo, text; back to My drawings (with a thumbnail),
// a reload, the drawing opens again, and "Save image" hands a PNG to the share sheet whose pixels show
// what was drawn. Nothing leaves the phone.
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

/** Screen position of a page point (the page is fitted and centered in the canvas, 96%). */
async function at(page, px, py, size = 2048) {
  const r = await page.locator('.dr-canvas').boundingBox();
  const k = Math.min(r.width / size, r.height / size) * 0.96;
  return [r.x + (r.width - size * k) / 2 + px * k, r.y + (r.height - size * k) / 2 + py * k];
}
async function stroke(page, points) {
  const [x0, y0] = await at(page, ...points[0]);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (const p of points.slice(1)) { const [x, y] = await at(page, ...p); await page.mouse.move(x, y, { steps: 8 }); }
  await page.mouse.up();
}

test('draw on a blank page, erase, undo, add text; it is saved, reopens, and saves out as a PNG', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !/^(blob|data):/.test(r.url())) external.push(r.url()); });
  // Cache the app, then go offline.
  await page.goto(`${origin}${BASE}`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);

  await page.click('.app-tile >> text=Draw');
  await page.waitForSelector('text=New drawing');
  await page.click('.dr-new .chip >> text=Square');
  await page.click('.dr-new .chip >> text=Grid');
  await page.getByRole('button', { name: '+ New drawing' }).click();
  await page.waitForSelector('.dr-canvas');

  // A thick red pen stroke across the middle.
  await page.click('.dr-tools .chip >> text=Pen');
  await page.click('[aria-label="Color #ff3b30"]');
  await page.fill('[aria-label="Size"]', '40');
  await stroke(page, [[300, 1024], [1000, 1024], [1748, 1024]]);
  // A filled blue box at the top.
  await page.click('.dr-tools .chip >> text=Box');
  await page.click('[aria-label="Color #0a84ff"]');
  await page.getByRole('button', { name: '□ Outline' }).click();
  await stroke(page, [[400, 300], [800, 600]]);
  // The eraser through the stroke's right part.
  await page.click('.dr-tools .chip >> text=Eraser');
  await stroke(page, [[1500, 900], [1500, 1150]]);
  // Undo the eraser, redo it.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Redo' }).click();
  // Text.
  await page.click('.dr-tools .chip >> text=Text');
  const [tx, ty] = await at(page, 300, 1600);
  await page.mouse.click(tx, ty);
  await page.fill('dialog textarea', 'Hello');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.fill('.dr-name', 'My sketch'); await page.press('.dr-name', 'Enter');

  // Back to My drawings: listed with a thumbnail.
  await page.getByRole('button', { name: '‹ Drawings' }).click();
  await page.waitForSelector('.dr-card >> text=My sketch');
  await page.waitForSelector('.dr-card img[src^="blob:"]');

  // Survives a reload; opens again; Save image gives a PNG with the drawing in it.
  await page.reload();
  await page.waitForSelector('.dr-card >> text=My sketch');
  await page.click('.dr-card >> text=My sketch');
  await page.waitForSelector('.dr-canvas');
  await page.evaluate(() => {
    window.__shared = null; navigator.canShare = () => true;
    navigator.share = async (d) => {
      const f = d.files[0]; const b = await createImageBitmap(f); const c = new OffscreenCanvas(b.width, b.height); const x = c.getContext('2d'); x.drawImage(b, 0, 0);
      const px = (u, v) => [...x.getImageData(u, v, 1, 1).data.slice(0, 3)];
      window.__shared = { name: f.name, type: f.type, w: b.width, h: b.height, stroke: px(700, 1024), erased: px(1500, 1024), box: px(600, 450), paper: px(1100, 1700) };
    };
  });
  await page.getByRole('button', { name: 'Save image' }).click();
  await page.waitForFunction(() => window.__shared);
  const s = await page.evaluate(() => window.__shared);
  assert.equal(s.name, 'My sketch.png'); assert.equal(s.type, 'image/png');
  assert.deepEqual([s.w, s.h], [2048, 2048]);
  const near = (c, want, tol = 40) => c.every((v, i) => Math.abs(v - want[i]) <= tol);
  assert.ok(near(s.stroke, [255, 59, 48]), `red stroke: ${s.stroke}`);
  assert.ok(near(s.box, [10, 132, 255]), `blue box: ${s.box}`);
  assert.ok(s.erased.every((v) => v > 200), `erased back to the paper: ${s.erased}`);
  assert.ok(s.paper.every((v) => v > 200), `white paper: ${s.paper}`);

  assert.deepEqual(external, [], 'drawings never leave the phone');
  assert.deepEqual(errors, []);
  await context.close();
});
