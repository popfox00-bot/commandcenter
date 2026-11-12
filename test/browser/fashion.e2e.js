// Browser test for Fashion (Magic, `npm run test:web`): a drawn figure in a blue shirt (the base) and a
// striped tee on white (the piece). The person finder (vendor/mediapipe) is turned off, so everything is
// done by tapping: the tee's two colors picked (one piece, stripe against stripe), the base's shirt tapped
// as what it goes on; 🔁 Replace covers the shirt with the tee fitted to its shape, ➕ Add puts it on as
// it is (the shirt's sleeves showing past it).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.wasm': 'application/wasm', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
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

test('Fashion: pick a striped tee by tapping its colors, tap the shirt it replaces; Replace fits it to the shirt, Add puts it on as it is', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/vendor/mediapipe/**', (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/magic`);
  await page.click('.app-tile[href="#/fashion"]');
  await page.waitForSelector('#fa-base', { state: 'attached' });
  const imgs = await page.evaluate(async () => {
    const mk = async (w, h, draw) => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); draw(x); return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())); };
    const base = await mk(600, 800, (x) => {
      x.fillStyle = '#e4dccd'; x.fillRect(0, 0, 600, 800);
      x.fillStyle = '#d9a98a'; x.beginPath(); x.ellipse(300, 150, 55, 70, 0, 0, 7); x.fill(); x.fillRect(280, 210, 40, 30);
      x.beginPath(); x.moveTo(200, 240); x.lineTo(400, 240); x.lineTo(470, 300); x.lineTo(440, 330); x.lineTo(405, 300); x.lineTo(400, 490); x.lineTo(200, 490); x.lineTo(195, 300); x.lineTo(160, 330); x.lineTo(130, 300); x.closePath();
      x.fillStyle = '#2f55b5'; x.fill();
      x.fillStyle = '#33302e'; x.fillRect(210, 490, 85, 270); x.fillRect(305, 490, 85, 270);
    });
    const piece = await mk(500, 500, (x) => {
      x.fillStyle = '#fafafa'; x.fillRect(0, 0, 500, 500);
      x.beginPath(); x.moveTo(170, 60); x.lineTo(330, 60); x.lineTo(440, 120); x.lineTo(400, 190); x.lineTo(360, 165); x.lineTo(360, 450); x.lineTo(140, 450); x.lineTo(140, 165); x.lineTo(100, 190); x.lineTo(60, 120); x.closePath(); x.clip();
      x.fillStyle = '#e03a3a'; x.fillRect(0, 0, 500, 500); x.fillStyle = '#f4d23c'; for (let y = 70; y < 460; y += 44) x.fillRect(0, y, 500, 18);
    });
    return { base, piece };
  });
  await page.setInputFiles('#fa-base', { name: 'base.png', mimeType: 'image/png', buffer: Buffer.from(imgs.base) });
  await page.waitForSelector('img[alt="1 · Base"]');
  await page.setInputFiles('#fa-piece', { name: 'piece.png', mimeType: 'image/png', buffer: Buffer.from(imgs.piece) });
  await page.waitForSelector('img[alt="2 · Piece"]');
  await page.getByRole('button', { name: 'Next: pick the piece' }).click();
  await page.waitForSelector('.fa-canvas');
  const tap = async (fx, fy) => { const b = await page.locator('.fa-canvas').boundingBox(); await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy); await page.waitForTimeout(120); };
  const pixel = (x, y) => page.evaluate(async ([X, Y]) => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Array.from(document.querySelector('.fa-canvas').getContext('2d').getImageData(X, Y, 1, 1).data.slice(0, 3));
  }, [x, y]);
  const pink = ([r, g, b]) => r > 180 && g < 140 && b > 70;
  // The red, then the yellow: the whole tee is one piece (pink), the white around it isn't.
  await tap(250 / 500, 140 / 500); await tap(250 / 500, 205 / 500);
  for (const [x, y] of [[250, 140], [250, 425], [80, 125], [300, 80]]) assert.ok(pink(await pixel(x, y)), `tee at ${x},${y}`);
  assert.ok(!pink(await pixel(30, 30)) && !pink(await pixel(470, 400)), 'not the white');
  await page.getByRole('button', { name: 'Next: put it on' }).click();
  // 🔁 Replace (the default): tap the shirt it goes on.
  await page.getByRole('button', { name: '👆 Tap what it goes on' }).click();
  await tap(300 / 600, 380 / 800);
  await page.getByRole('button', { name: '✋ Move' }).click();
  const blue = ([r, g, b]) => b > 140 && r < 90;
  const tee = ([r, g, b]) => r > 120 && b < 110;
  for (const [x, y] of [[300, 300], [300, 470], [215, 260], [385, 260], [450, 305]]) {
    const p = await pixel(x, y);
    assert.ok(tee(p), `Replace: the tee over the shirt at ${x},${y} (${p})`);
  }
  // The face and the pants stay as they were.
  assert.ok(!tee(await pixel(300, 150)) || (await pixel(300, 150))[1] > 140, 'face');
  assert.deepEqual(await pixel(250, 600), [51, 48, 46]);
  // ➕ Add: the tee as it is (not bent onto the shirt): the shirt's sleeve tips show past it.
  await page.getByRole('tab', { name: '➕ Add' }).click();
  let shown = 0;
  for (const [x, y] of [[140, 300], [460, 300], [150, 315], [450, 315], [205, 480], [395, 480]]) if (blue(await pixel(x, y))) shown++;
  assert.ok(shown >= 1, 'some of the shirt shows past it');
  // Size slider: smaller → more of the shirt shows.
  await page.getByRole('slider', { name: 'Size' }).fill('60');
  let more = 0;
  for (const [x, y] of [[140, 300], [460, 300], [150, 315], [450, 315], [205, 480], [395, 480], [210, 300], [390, 300]]) if (blue(await pixel(x, y))) more++;
  assert.ok(more > shown, `smaller: ${shown} → ${more}`);
  // Save works (a download here: no share sheet).
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '💾 Save' }).click();
  assert.match((await dl).suggestedFilename(), /^fashion-\d{4}-\d{2}-\d{2}\.jpg$/);
  assert.deepEqual(errors, []);
  await context.close();
});
