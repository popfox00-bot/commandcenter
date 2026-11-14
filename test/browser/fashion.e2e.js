// Browser test for Fashion (Magic, `npm run test:web`): a drawn figure in a blue shirt (the base) and a
// striped tee on white (the piece). The person finder (vendor/mediapipe) is turned off, so everything is
// done by tapping: the tee's two colors picked (one piece, stripe against stripe), the base's shirt tapped
// as what it goes on; 🔁 Replace covers the shirt with the tee fitted to its shape, ➕ Add puts it on as
// it is, sized by the shirt's chest (smaller, more of the shirt shows).
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
  // (By hand: under More edits.)
  await page.locator('summary', { hasText: 'More edits' }).click();
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
  // (Sized to the shirt's chest, so little of it may show; smaller, more does.)
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

// A stand-in for the person finder (vendor/mediapipe can't see a drawn figure): the figure's colors read as
// face (skin, top of the picture), body (skin below), shoes (black), clothes (anything else not background).
const FAKE_PARTS = `
export async function segmentPeople(img) {
  const w = img.width, h = img.height; const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, w, h).data;
  const n = w * h; const out = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; const y = Math.floor(i / w);
    const skin = r > 180 && g > 130 && g < 190 && b > 100 && b < 160 && r - b > 50;
    const bg = Math.max(r, g, b) - Math.min(r, g, b) < 40 && r > 170;
    if (skin) (y < h * 0.3 ? out.face : out.body)[i] = 255; else if (r < 30 && g < 30 && b < 30) out.others[i] = 255; else if (!bg) out.clothes[i] = 255;
  }
  return out;
}
export async function segmentParts() { return null; }`;

test('Fashion with the person found: ✨ Find it, 📏 guides, a long-sleeved jacket onto a short-sleeved shirt (sleeves keep their length, the hand across stays in front), undo, kept between visits', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/lib/face-parts.js', (route) => route.fulfill({ body: FAKE_PARTS, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/fashion`);
  await page.waitForSelector('#fa-base', { state: 'attached' });
  const imgs = await page.evaluate(async () => {
    const mk = async (w, h, draw) => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); draw(x); return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())); };
    const SKIN = '#e0a888';
    const figure = (x, shirt, sleeves) => {
      x.fillStyle = '#ece6da'; x.fillRect(0, 0, 600, 900);
      x.fillStyle = SKIN; x.beginPath(); x.ellipse(300, 140, 55, 70, 0, 0, 7); x.fill(); x.fillRect(280, 200, 40, 40);
      x.fillRect(150, 250, 34, 260); x.fillRect(416, 250, 34, 260);
      x.fillStyle = shirt; x.fillRect(205, 235, 190, 285);
      if (sleeves) { x.fillRect(146, 240, 60, sleeves); x.fillRect(394, 240, 60, sleeves); }
      x.fillStyle = '#4a4744'; x.fillRect(210, 520, 85, 300); x.fillRect(305, 520, 85, 300);
      x.fillStyle = '#111'; x.fillRect(200, 820, 100, 30); x.fillRect(300, 820, 100, 30);
    };
    const base = await mk(600, 900, (x) => { figure(x, '#2f55b5', 70); x.fillStyle = SKIN; x.fillRect(220, 400, 150, 34); });
    const piece = await mk(600, 900, (x) => { figure(x, '#2c8a4a', 250); });
    return { base, piece };
  });
  await page.setInputFiles('#fa-base', { name: 'base.png', mimeType: 'image/png', buffer: Buffer.from(imgs.base) });
  await page.waitForSelector('img[alt="1 · Base"]');
  await page.setInputFiles('#fa-piece', { name: 'piece.png', mimeType: 'image/png', buffer: Buffer.from(imgs.piece) });
  await page.waitForSelector('img[alt="2 · Piece"]');
  await page.getByRole('button', { name: 'Next: pick the piece' }).click();
  await page.getByRole('button', { name: '🧥 Jacket' }).click();
  await page.waitForSelector('text=/Found ✨/');
  const pixel = (x, y) => page.evaluate(async ([X, Y]) => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Array.from(document.querySelector('.fa-canvas').getContext('2d').getImageData(X, Y, 1, 1).data.slice(0, 3));
  }, [x, y]);
  const pink = ([r, g, b]) => r > 150 && b > 90 && g < 130;
  // The jacket and its sleeves found, not the pants.
  for (const [x, y] of [[300, 300], [175, 450], [425, 450]]) assert.ok(pink(await pixel(x, y)), `jacket at ${x},${y}`);
  assert.ok(!pink(await pixel(250, 700)), 'not the pants');
  // 📏 Guides: chin, waist and ankle lines drawn (the waist where the jacket meets the pants).
  await page.getByRole('button', { name: '📏 Guides' }).click();
  const yellowAt = async (y) => { for (let d = -3; d <= 3; d++) { const [r, g, b] = await pixel(300, y + d); if (r > 220 && g > 190 && b < 60) return true; } return false; };
  assert.ok(await yellowAt(520), 'the waist line at the jacket\'s bottom');
  await page.getByRole('button', { name: 'Next: put it on' }).click();
  await page.waitForTimeout(500);
  const green = ([r, g, b]) => g > r + 30 && g > b + 20;
  const skin = ([r, g, b]) => r > 180 && g > 130 && b > 100 && r - b > 50;
  // 🔁 Replace: the long sleeves keep their length over the bare arms; the hand across the shirt stays in front.
  for (const [x, y] of [[300, 300], [170, 450], [430, 450], [170, 270]]) assert.ok(green(await pixel(x, y)), `jacket on at ${x},${y}: ${await pixel(x, y)}`);
  assert.ok(skin(await pixel(300, 417)), `the hand in front: ${await pixel(300, 417)}`);
  await page.locator('summary', { hasText: 'More edits' }).click();
  await page.getByRole('checkbox', { name: /hands and arms/ }).uncheck();
  await page.waitForTimeout(300);
  assert.ok(green(await pixel(300, 417)), 'covered without it');
  // Undo brings the hand back; redo hides it again.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(300);
  assert.ok(skin(await pixel(300, 417)), 'undone');
  await page.getByRole('button', { name: 'Redo' }).click();
  await page.waitForTimeout(300);
  assert.ok(green(await pixel(300, 417)), 'redone');
  // Two fingers on it (✋ Move): pinched apart, it grows; turned, it turns.
  await page.getByRole('button', { name: '✋ Move' }).click();
  await page.evaluate(async () => {
    const c = document.querySelector('.fa-canvas'); const r = c.getBoundingClientRect();
    const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true, pointerType: 'touch' }));
    ev('pointerdown', 11, 100, 200); ev('pointerdown', 12, 200, 200);
    for (let k = 1; k <= 5; k++) { ev('pointermove', 12, 200 + k * 10, 200 + k * 6); await new Promise((q) => setTimeout(q, 20)); }
    ev('pointerup', 12, 250, 230); ev('pointerup', 11, 100, 200);
  });
  await page.waitForTimeout(300);
  const size = Number(await page.getByRole('slider', { name: 'Size' }).inputValue()); const turn = Number(await page.getByRole('slider', { name: 'Turn' }).inputValue());
  assert.ok(size > 140 && turn > 10, `pinched: size ${size}, turn ${turn}`);
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await page.getByRole('slider', { name: 'Size' }).inputValue(), '100');
  // Kept on the phone: back again, it offers to continue, and continues as it was.
  await page.waitForTimeout(900);
  await page.reload();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForSelector('.fa-canvas');
  await page.waitForTimeout(800);
  assert.ok(green(await pixel(170, 450)) && green(await pixel(300, 417)), 'continued');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Fashion: saving Replace from photos bigger than the working size (a phone\'s) works, at full size', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/lib/face-parts.js', (route) => route.fulfill({ body: FAKE_PARTS, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/fashion`);
  await page.waitForSelector('#fa-base', { state: 'attached' });
  // The same drawn figures, 2.4 times as big (1440 × 2160): over the working size, as a phone's photos are.
  const imgs = await page.evaluate(async () => {
    const K = 2.4;
    const mk = async (draw) => { const c = new OffscreenCanvas(600 * K, 900 * K); const x = c.getContext('2d'); x.scale(K, K); draw(x); return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())); };
    const SKIN = '#e0a888';
    const figure = (x, shirt) => {
      x.fillStyle = '#ece6da'; x.fillRect(0, 0, 600, 900);
      x.fillStyle = SKIN; x.beginPath(); x.ellipse(300, 140, 55, 70, 0, 0, 7); x.fill(); x.fillRect(280, 200, 40, 40);
      x.fillRect(150, 250, 34, 260); x.fillRect(416, 250, 34, 260);
      x.fillStyle = shirt; x.fillRect(205, 235, 190, 285); x.fillRect(146, 240, 60, 70); x.fillRect(394, 240, 60, 70);
      x.fillStyle = '#4a4744'; x.fillRect(210, 520, 85, 300); x.fillRect(305, 520, 85, 300);
    };
    return { base: await mk((x) => figure(x, '#2f55b5')), piece: await mk((x) => figure(x, '#2c8a4a')) };
  });
  await page.setInputFiles('#fa-base', { name: 'base.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(imgs.base) });
  await page.waitForSelector('img[alt="1 · Base"]');
  await page.setInputFiles('#fa-piece', { name: 'piece.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(imgs.piece) });
  await page.waitForSelector('img[alt="2 · Piece"]');
  await page.getByRole('button', { name: 'Next: pick the piece' }).click();
  await page.waitForSelector('text=/Found ✨/');
  await page.getByRole('button', { name: 'Next: put it on' }).click();
  await page.waitForSelector('text=/Laid into the top/');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '💾 Save' }).click();
  const d = await dl;
  assert.match(d.suggestedFilename(), /^fashion-.*\.jpg$/);
  await page.waitForSelector('text=/Saved \\(1440 × 2160\\)/');
  assert.deepEqual(errors, []);
  await context.close();
});
