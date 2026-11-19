// Browser test for Fashion (Magic, `npm run test:web`): a drawn figure in a blue shirt (the base) and a
// striped tee on white (the piece). The person finder (vendor/mediapipe) is turned off, so everything is
// done by tapping: the tee's two colors picked (one piece, stripe against stripe), the base's shirt tapped
// as what it goes on; 🔁 Replace covers the shirt with the tee fitted to its shape, 🧥 Overlay with Fit to
// body at 0 puts it on as
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
  // (Its apps are in the hidden area: opened here as if it's been unlocked in this tab.)
  const plain = browser.newContext.bind(browser);
  browser.newContext = async (o) => { const c = await plain(o); await c.addInitScript(() => { try { sessionStorage.setItem('cc.hidden.open', '1'); } catch { /* private mode */ } }); return c; };
});
after(async () => { await browser?.close(); server?.close(); });

test('Fashion: pick a striped tee by tapping its colors, tap the shirt it replaces; Replace fits it to the shirt and drags as a whole; Overlay unfitted puts it on as it is', async () => {
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
  // Dragged in Replace, the whole tee moves (not only its pattern inside the shirt's outline): the old shirt
  // is taken off where it no longer covers it.
  assert.equal(await page.getByRole('tab', { name: '➕ Add' }).count(), 0, 'no Add: Overlay does it');
  await page.locator('.fa-canvas').scrollIntoViewIfNeeded();
  const cb = await page.locator('.fa-canvas').boundingBox(); const cwid = await page.evaluate(() => document.querySelector('.fa-canvas').width);
  const toPage = (x, y) => [cb.x + (x / cwid) * cb.width, cb.y + (y / cwid) * cb.width];
  await page.mouse.move(...toPage(300, 380)); await page.mouse.down(); await page.mouse.move(...toPage(380, 380), { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(400);
  assert.ok(tee(await pixel(470, 380)), `moved right with the finger: ${await pixel(470, 380)}`);
  assert.ok(!tee(await pixel(215, 380)), `and off the left of the shirt: ${await pixel(215, 380)}`);
  const more = async () => { if (!(await page.locator('details.fa-more').evaluate((d) => d.open))) await page.locator('summary', { hasText: 'More edits' }).click(); };
  await more();
  await page.getByRole('button', { name: '↺ Reset' }).click();
  // 🧥 Overlay, not fitted (Fit to body at 0): the tee as it is (not bent onto the shirt): the shirt's sleeve tips show past it.
  await page.getByRole('tab', { name: '🧥 Overlay' }).click();
  await more();
  await page.getByRole('slider', { name: 'Fit to body' }).fill('0');
  let shown = 0;
  for (const [x, y] of [[140, 300], [460, 300], [150, 315], [450, 315], [205, 480], [395, 480]]) if (blue(await pixel(x, y))) shown++;
  // (Sized to the shirt's chest, so little of it may show; smaller, more does.)
  // Size slider: smaller → more of the shirt shows.
  await page.getByRole('slider', { name: 'Size' }).fill('60');
  let bigger = 0;
  for (const [x, y] of [[140, 300], [460, 300], [150, 315], [450, 315], [205, 480], [395, 480], [210, 300], [390, 300]]) if (blue(await pixel(x, y))) bigger++;
  assert.ok(bigger > shown, `smaller: ${shown} → ${bigger}`);
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

// A stand-in for the pose finder: two people side by side, at fixed places in the picture (fractions of it).
const FAKE_POSES = `
const one = (cx, W, H) => { const P = (x, y) => [x * W, y * H, 1]; return { nose: P(cx, 0.14), shoulders: [P(cx - 0.09, 0.26), P(cx + 0.09, 0.26)], elbows: [P(cx - 0.11, 0.4), P(cx + 0.11, 0.4)], wrists: [P(cx - 0.11, 0.52), P(cx + 0.11, 0.52)], hips: [P(cx - 0.06, 0.55), P(cx + 0.06, 0.55)], knees: [P(cx - 0.05, 0.75), P(cx + 0.05, 0.75)], ankles: [P(cx - 0.05, 0.93), P(cx + 0.05, 0.93)] }; };
export async function detectPoses(img) { return [one(0.3, img.width, img.height), one(0.7, img.width, img.height)]; }
export async function detectPose(img) { return (await detectPoses(img))[0]; }`;

test('Fashion in a group photo: choose whose clothes (a face, or a tap on them) and who to dress; only that person\'s dress is taken and replaced', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/lib/face-parts.js', (route) => route.fulfill({ body: FAKE_PARTS, headers: { 'content-type': 'text/javascript' } }));
  await context.route('**/lib/pose.js', (route) => route.fulfill({ body: FAKE_POSES, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/fashion`);
  await page.waitForSelector('#fa-base', { state: 'attached' });
  // Two people, their dresses touching: a red one (left) and a green one (right).
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(600, 900); const x = c.getContext('2d'); const SKIN = '#e0a888';
    x.fillStyle = '#ece6da'; x.fillRect(0, 0, 600, 900);
    for (const [cx, dress] of [[180, '#b8323c'], [420, '#3c9a46']]) {
      x.fillStyle = SKIN; x.beginPath(); x.ellipse(cx, 125, 45, 58, 0, 0, 7); x.fill(); x.fillRect(cx - 16, 180, 32, 50);
      x.fillStyle = dress; x.fillRect(cx - 120, 225, 240, 600);
      x.fillStyle = '#111'; x.fillRect(cx - 60, 825, 50, 25); x.fillRect(cx + 10, 825, 50, 25);
    }
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  const file = { name: 'group.png', mimeType: 'image/png', buffer: Buffer.from(png) };
  await page.setInputFiles('#fa-base', file); await page.waitForSelector('img[alt="1 · Base"]');
  await page.setInputFiles('#fa-piece', file); await page.waitForSelector('img[alt="2 · Piece"]');
  await page.getByRole('button', { name: 'Next: pick the piece' }).click();
  // Two people found: a face to tap for each.
  await page.waitForSelector('.fa-who-item');
  assert.equal(await page.locator('.fa-who-item').count(), 2);
  const pixel = (x, y) => page.evaluate(async ([X, Y]) => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Array.from(document.querySelector('.fa-canvas').getContext('2d').getImageData(X, Y, 1, 1).data.slice(0, 3));
  }, [x, y]);
  const pink = ([r, g, b]) => r > 150 && b > 90 && g < 130;
  // Whose clothes: the person on the right (their face). Their green dress is picked, not the red one beside it.
  await page.getByRole('button', { name: 'Person 2', exact: true }).click();
  await page.getByRole('button', { name: '👗 Dress' }).click();
  await page.waitForSelector('text=/Found ✨/');
  assert.ok(pink(await pixel(420, 500)), `the green dress picked: ${await pixel(420, 500)}`);
  assert.ok(pink(await pixel(330, 600)), 'to its left edge');
  assert.ok(!pink(await pixel(250, 600)), `not the red dress next to it: ${await pixel(250, 600)}`);
  assert.ok(!pink(await pixel(290, 400)), 'not even where they touch');
  // 🧍 Part of them: brushed over the edge of the red dress, that part is made person 2's (found with theirs).
  await page.getByRole('button', { name: '🧍 Part of them' }).click();
  await page.locator('.fa-canvas').scrollIntoViewIfNeeded();
  const box = await page.locator('.fa-canvas').boundingBox(); const cw = await page.evaluate(() => document.querySelector('.fa-canvas').width);
  const at = (x, y) => [box.x + (x / cw) * box.width, box.y + (y / cw) * box.width];
  await page.mouse.move(...at(270, 450)); await page.mouse.down(); await page.mouse.move(...at(270, 520), { steps: 5 }); await page.mouse.up();
  await page.getByRole('button', { name: '👗 Dress' }).click();
  await page.waitForTimeout(300);
  assert.ok(pink(await pixel(270, 480)), `the brushed part is theirs now: ${await pixel(270, 480)}`);
  assert.ok(!pink(await pixel(200, 480)), 'the rest of the red dress isn\'t');
  // A tap on the other person chooses them instead.
  await page.getByRole('button', { name: '👆 Tap its color' }).click();
  await page.locator('.fa-canvas').scrollIntoViewIfNeeded();
  await page.locator('.fa-canvas').click({ position: await page.evaluate(() => { const c = document.querySelector('.fa-canvas'); const r = c.getBoundingClientRect(); return { x: (180 / c.width) * r.width, y: (500 / c.height) * r.height }; }) });
  await page.waitForSelector('.fa-who-item.active >> text=1');
  // Back to the green dress, then dress person 1 in it.
  await page.getByRole('button', { name: 'Person 2', exact: true }).click();
  await page.getByRole('button', { name: '👗 Dress' }).click();
  await page.getByRole('button', { name: 'Next: put it on' }).click();
  await page.waitForSelector('.fa-who-item');
  await page.getByRole('button', { name: 'Person 1', exact: true }).click();
  await page.waitForTimeout(800);
  const green = ([r, g, b]) => g > r + 30 && g > b + 10;
  const red = ([r, g, b]) => r > g + 60 && r > b + 50;
  // 🔁 Replace: person 1's red dress is now green; person 2's own dress is as it was; no red left on person 1.
  for (const [x, y] of [[180, 300], [120, 600], [240, 750]]) assert.ok(green(await pixel(x, y)), `person 1 in green at ${x},${y}: ${await pixel(x, y)}`);
  assert.ok(green(await pixel(420, 500)), 'person 2 untouched');
  assert.ok(!red(await pixel(180, 500)), 'no red left');
  assert.deepEqual(errors, []);
  await context.close();
});

// One person, at fixed places in the picture: shoulders at (215, 245) and (385, 245) of a 600×900 figure.
const FAKE_POSE_ONE = `
export async function detectPoses(img) { const k = img.width / 600; const P = (x, y) => [x * k, y * k, 1]; return [{ nose: P(300, 150), shoulders: [P(215, 245), P(385, 245)], elbows: [P(167, 380), P(433, 380)], wrists: [P(167, 500), P(433, 500)], hips: [P(250, 520), P(350, 520)], knees: [P(250, 680), P(350, 680)], ankles: [P(250, 820), P(350, 820)] }]; }
export async function detectPose(img) { return (await detectPoses(img))[0]; }
export async function detectPoseOf() { return null; }`;

test('Fashion: a top with straps onto a strapless one: straps drawn over the bare shoulders; ⭐ kept, and used again after a reload', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/lib/face-parts.js', (route) => route.fulfill({ body: FAKE_PARTS, headers: { 'content-type': 'text/javascript' } }));
  await context.route('**/lib/pose.js', (route) => route.fulfill({ body: FAKE_POSE_ONE, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/fashion`);
  await page.waitForSelector('#fa-base', { state: 'attached' });
  const imgs = await page.evaluate(async () => {
    const mk = async (draw) => { const c = new OffscreenCanvas(600, 900); const x = c.getContext('2d'); draw(x); return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())); };
    const SKIN = '#e0a888';
    const figure = (x, top, straps) => {
      x.fillStyle = '#ece6da'; x.fillRect(0, 0, 600, 900);
      x.fillStyle = SKIN; x.beginPath(); x.ellipse(300, 140, 55, 70, 0, 0, 7); x.fill();
      x.fillRect(280, 200, 40, 45); x.fillRect(205, 238, 190, 70); x.fillRect(150, 250, 34, 260); x.fillRect(416, 250, 34, 260); x.fillRect(184, 245, 30, 40); x.fillRect(386, 245, 30, 40);
      x.fillStyle = top; x.fillRect(205, 300, 190, 220);
      if (straps) { x.fillRect(235, 238, 20, 64); x.fillRect(345, 238, 20, 64); }
      x.fillStyle = '#4a4744'; x.fillRect(210, 520, 85, 300); x.fillRect(305, 520, 85, 300);
      x.fillStyle = '#111'; x.fillRect(200, 820, 100, 30); x.fillRect(300, 820, 100, 30);
    };
    return { base: await mk((x) => figure(x, '#b8323c', false)), piece: await mk((x) => figure(x, '#2c5fb0', true)) };
  });
  await page.setInputFiles('#fa-base', { name: 'base.png', mimeType: 'image/png', buffer: Buffer.from(imgs.base) }); await page.waitForSelector('img[alt="1 · Base"]');
  await page.setInputFiles('#fa-piece', { name: 'piece.png', mimeType: 'image/png', buffer: Buffer.from(imgs.piece) }); await page.waitForSelector('img[alt="2 · Piece"]');
  await page.getByRole('button', { name: 'Next: pick the piece' }).click();
  await page.getByRole('button', { name: '👕 Top' }).first().click();
  await page.waitForSelector('text=/Found ✨|The top/');
  await page.getByRole('button', { name: '⭐ Keep this piece' }).click();
  await page.waitForSelector('text=/Kept on this phone/');
  await page.getByRole('button', { name: 'Next: put it on' }).click();
  await page.waitForTimeout(800);
  const pixel = (x, y) => page.evaluate(async ([X, Y]) => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Array.from(document.querySelector('.fa-canvas').getContext('2d').getImageData(X, Y, 1, 1).data.slice(0, 3));
  }, [x, y]);
  const blue = ([r, g, b]) => b > r + 40 && b > g + 20;
  assert.ok(blue(await pixel(300, 400)), `the top is on: ${await pixel(300, 400)}`);
  // A strap from the top's edge (a quarter in) up over the left shoulder, where the base was bare.
  assert.ok(blue(await pixel(240, 275)), `a strap drawn over the bare shoulder: ${await pixel(240, 275)}`);
  assert.ok(!blue(await pixel(300, 270)), 'not across the chest between them');
  // Kept: after a reload, among your pieces, and used as the piece again.
  await page.reload(); await page.waitForSelector('#fa-base', { state: 'attached' });
  const discard = page.getByRole('button', { name: 'Discard' }); if (await discard.count()) await discard.click();
  await page.getByRole('button', { name: /^Use Top/ }).click();
  await page.waitForSelector('img[alt="2 · Piece"]');
  await page.getByText(/^Top · .*: ready\./).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test('Photo Editor → Clean Up → 👤 Remove a person: a tap on one of two people takes them out (the background filled in), the other stays', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/lib/face-parts.js', (route) => route.fulfill({ body: FAKE_PARTS, headers: { 'content-type': 'text/javascript' } }));
  await context.route('**/lib/pose.js', (route) => route.fulfill({ body: FAKE_POSES, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/files/photo`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(600, 900); const x = c.getContext('2d'); const SKIN = '#e0a888';
    x.fillStyle = '#ece6da'; x.fillRect(0, 0, 600, 900);
    for (const [cx, dress] of [[180, '#b8323c'], [420, '#3c9a46']]) {
      x.fillStyle = SKIN; x.beginPath(); x.ellipse(cx, 125, 45, 58, 0, 0, 7); x.fill(); x.fillRect(cx - 16, 180, 32, 50);
      x.fillStyle = dress; x.fillRect(cx - 90, 225, 180, 560);
    }
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.setInputFiles('#ed-file', { name: 'two.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.getByRole('tab', { name: 'Clean Up' }).click();
  await page.getByRole('button', { name: '👤 Remove a person' }).click();
  const pixel = (fx, fy) => page.$eval('.ed-canvas', (c, [u, v]) => { const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); return [...x.getImageData(Math.round(u * c.width), Math.round(v * c.height), 1, 1).data].slice(0, 3); }, [fx, fy]);
  await page.evaluate(() => window.scrollTo(0, 0));
  const b = await page.$eval('.ed-overlay', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  await page.mouse.click(b[0] + (180 / 600) * b[2], b[1] + (500 / 900) * b[3]);
  await page.waitForSelector('text=/taken out and filled in/', { timeout: 60000 });
  await page.waitForTimeout(200);
  const bg = ([r, g, bl]) => Math.abs(r - 236) < 24 && Math.abs(g - 230) < 24 && Math.abs(bl - 218) < 30;
  for (const [x, y] of [[180, 500], [180, 125], [120, 700]]) assert.ok(bg(await pixel(x / 600, y / 900)), `person 1 gone at ${x},${y}: ${await pixel(x / 600, y / 900)}`);
  const green = await pixel(420 / 600, 500 / 900); assert.ok(green[1] > green[0] + 40, `person 2 stays: ${green}`);
  await page.getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(200);
  const red = await pixel(180 / 600, 500 / 900); assert.ok(red[0] > red[1] + 60, `undone: ${red}`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Fashion: an upper body zone onto someone with a hand across their front: their hand stays in front; the waist line moves the zone; the check before saving points at what still shows', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/lib/face-parts.js', (route) => route.fulfill({ body: FAKE_PARTS, headers: { 'content-type': 'text/javascript' } }));
  await context.route('**/lib/pose.js', (route) => route.fulfill({ body: FAKE_POSE_ONE, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/fashion`);
  await page.waitForSelector('#fa-base', { state: 'attached' });
  const imgs = await page.evaluate(async () => {
    const mk = async (draw) => { const c = new OffscreenCanvas(600, 900); const x = c.getContext('2d'); draw(x); return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())); };
    const SKIN = '#e0a888';
    const figure = (x, top, hand) => {
      x.fillStyle = '#ece6da'; x.fillRect(0, 0, 600, 900);
      x.fillStyle = SKIN; x.beginPath(); x.ellipse(300, 140, 55, 70, 0, 0, 7); x.fill(); x.fillRect(280, 200, 40, 45); x.fillRect(150, 250, 34, 260); x.fillRect(416, 250, 34, 260);
      x.fillStyle = top; x.fillRect(205, 238, 190, 290);
      x.fillStyle = '#4a4744'; x.fillRect(205, 528, 190, 292);
      if (hand) { x.fillStyle = SKIN; x.fillRect(184, 420, 150, 32); x.fillStyle = top; x.beginPath(); x.arc(470, 470, 14, 0, 7); x.fill(); }
      x.fillStyle = '#111'; x.fillRect(200, 820, 100, 30); x.fillRect(300, 820, 100, 30);
    };
    // The base: a red top, their hand across it, and a stray red patch beside them the zone won't take.
    return { base: await mk((x) => figure(x, '#b8323c', true)), piece: await mk((x) => figure(x, '#2c5fb0', false)) };
  });
  await page.setInputFiles('#fa-base', { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(imgs.base) }); await page.waitForSelector('img[alt="1 · Base"]');
  await page.setInputFiles('#fa-piece', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(imgs.piece) }); await page.waitForSelector('img[alt="2 · Piece"]');
  await page.getByRole('button', { name: 'Next: pick the piece' }).click();
  await page.getByRole('button', { name: '🧍 Upper body' }).last().click();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('slider', { name: 'Waist line' }).count(), 1, 'a waist line for the zone');
  await page.getByRole('button', { name: 'Next: put it on' }).click();
  await page.waitForTimeout(900);
  const pixel = (x, y) => page.evaluate(async ([X, Y]) => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Array.from(document.querySelector('.fa-canvas').getContext('2d').getImageData(X, Y, 1, 1).data.slice(0, 3));
  }, [x, y]);
  const blue = ([r, g, b]) => b > r + 40;
  const skin = ([r, g, b]) => r > 180 && g > 130 && b > 100 && r - b > 50;
  assert.ok(blue(await pixel(300, 330)), `the zone is on: ${await pixel(300, 330)}`);
  assert.ok(skin(await pixel(260, 436)), `their own hand stays in front: ${await pixel(260, 436)}`);
  // The waist line raised: the zone ends higher (the bottom of the old top shows again under it).
  const before = await pixel(370, 470);
  const slider = page.getByRole('slider', { name: 'Waist line' });
  await slider.fill('-40'); await slider.dispatchEvent('change');
  await page.waitForTimeout(600);
  const after = await pixel(370, 470);
  assert.ok(blue(before) && !blue(after), `raised: ${before} → ${after}`);
  await slider.fill('0'); await slider.dispatchEvent('change'); await page.waitForTimeout(400);
  // Save: the check points at the stray bit of the old top first; Show me marks it and picks the brush.
  await page.getByRole('button', { name: '💾 Save' }).click();
  const dlg = page.locator('dialog[open].fa-check');
  await dlg.waitFor();
  assert.match(await dlg.textContent(), /still shows/);
  await dlg.getByRole('button', { name: 'Show me' }).first().click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.chip.active', { hasText: 'Brush in' }).count(), 1, 'the brush that fixes it');
  // And Save anyway saves.
  await page.getByRole('button', { name: '💾 Save' }).click();
  await dlg.waitFor();
  const dl = page.waitForEvent('download');
  await dlg.getByRole('button', { name: 'Save anyway' }).click();
  assert.match((await dl).suggestedFilename(), /^fashion-/);
  assert.deepEqual(errors, []);
  await context.close();
});

// A finder with hair, and as soft as the real one (its maps blurred): thin strands come out unsure.
const FAKE_PARTS_HAIR = `
export async function segmentPeople(img) {
  const w = img.width, h = img.height; const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, w, h).data;
  const n = w * h; const out = { w, h, face: new Uint8Array(n), hair: new Uint8Array(n), body: new Uint8Array(n), clothes: new Uint8Array(n), others: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; const y = Math.floor(i / w);
    const skin = r > 180 && g > 130 && g < 190 && b > 100 && b < 160 && r - b > 50;
    const hair = r < 110 && r > 40 && g < 80 && b < 60 && r > b + 15;
    const bg = Math.max(r, g, b) - Math.min(r, g, b) < 40 && r > 170;
    if (skin) (y < h * 0.3 ? out.face : out.body)[i] = 255; else if (hair) out.hair[i] = 255; else if (r < 30 && g < 30 && b < 30) out.others[i] = 255; else if (!bg) out.clothes[i] = 255;
  }
  const sm = (m) => { const o = new Uint8Array(n); for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) { let s = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += m[(y + dy) * w + x + dx]; o[y * w + x] = s / 25; } return o; };
  for (const k of ['face', 'hair', 'body', 'clothes', 'others']) out[k] = sm(out[k]);
  return out;
}
export async function segmentParts() { return null; }`;

test('Fashion: an upper body with long sleeves onto someone bare-armed with long hair: thin strands stay over it, crisp; the sleeves take the arm\'s light; no haze of the piece\'s background', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/lib/face-parts.js', (route) => route.fulfill({ body: FAKE_PARTS_HAIR, headers: { 'content-type': 'text/javascript' } }));
  await context.route('**/lib/pose.js', (route) => route.fulfill({ body: FAKE_POSE_ONE, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/fashion`);
  await page.waitForSelector('#fa-base', { state: 'attached' });
  const imgs = await page.evaluate(async () => {
  const mk = async (draw) => { const c = new OffscreenCanvas(600, 900); const x = c.getContext('2d'); draw(x); return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())); };
  const SKIN = '#e0a888';
  const body = (x) => { x.fillStyle = '#ece6da'; x.fillRect(0, 0, 600, 900); x.fillStyle = SKIN; x.beginPath(); x.ellipse(300, 140, 55, 70, 0, 0, 7); x.fill(); x.fillRect(280, 200, 40, 45); x.fillRect(200, 236, 200, 30); x.fillRect(150, 250, 40, 260); x.fillRect(410, 250, 40, 260);
    // (Light from the left: the arms lit on their left, shaded on their right.)
    for (const ax of [150, 410]) for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(80,40,20,${(i / 40) * 0.28})`; x.fillRect(ax + i, 250, 1, 260); }
    x.fillStyle = '#4a4744'; x.fillRect(205, 528, 190, 292); x.fillStyle = '#111'; x.fillRect(200, 820, 100, 30); x.fillRect(300, 820, 100, 30); };
  const base = await mk((x) => { body(x); x.fillStyle = '#b8323c'; x.fillRect(215, 262, 170, 266); x.fillRect(240, 236, 18, 30); x.fillRect(342, 236, 18, 30);
    // Long hair over the shoulders, its ends in thin strands over the top.
    x.fillStyle = '#5a3420'; x.fillRect(235, 90, 40, 210); x.fillRect(325, 90, 40, 210);
    x.strokeStyle = '#5a3420'; x.lineWidth = 2; for (let k = 0; k < 6; k++) { x.beginPath(); x.moveTo(240 + k * 6, 300); x.quadraticCurveTo(238 + k * 7, 340, 246 + k * 6, 380); x.stroke(); x.beginPath(); x.moveTo(330 + k * 6, 300); x.quadraticCurveTo(334 + k * 6, 340, 330 + k * 7, 380); x.stroke(); } });
  const piece = await mk((x) => { body(x); x.fillStyle = '#2c5fb0'; x.fillRect(205, 238, 190, 290); x.fillRect(146, 246, 50, 250); x.fillRect(404, 246, 50, 250); });
  return { base, piece };
  });
  await page.setInputFiles('#fa-base', { name: 'b.png', mimeType: 'image/png', buffer: Buffer.from(imgs.base) }); await page.waitForSelector('img[alt="1 · Base"]');
  await page.setInputFiles('#fa-piece', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(imgs.piece) }); await page.waitForSelector('img[alt="2 · Piece"]');
  await page.getByRole('button', { name: 'Next: pick the piece' }).click();
  await page.getByRole('button', { name: '🧍 Upper body' }).last().click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Next: put it on' }).click(); await page.waitForTimeout(1500);
  const px = await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.querySelector('.fa-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const W = c.width;
    const at = (x, y) => [d[(y * W + x) * 4], d[(y * W + x) * 4 + 1], d[(y * W + x) * 4 + 2]];
    // (A strand's darkest pixel along a row across where the strands fall.)
    let strand = 255; for (let x = 236; x < 280; x++) strand = Math.min(strand, at(x, 340)[2] + at(x, 340)[0]);
    return { strand, armL: at(156, 400), armR: at(186, 400), side: at(220, 420), mid: at(300, 420) };
  });
  assert.ok(px.strand < 200, `a strand stays over the new top: ${px.strand}`);
  assert.ok(px.armL[2] > px.armR[2] + 6, `the sleeve lit as the arm under it (left lit, right shaded): ${px.armL} / ${px.armR}`);
  assert.ok(px.side[2] > px.side[0] + 60 && Math.abs(px.side[2] - px.mid[2]) < 40, `the torso's side is the new top, not a haze: ${px.side} vs ${px.mid}`);
  assert.deepEqual(errors, []);
  await context.close();
});
