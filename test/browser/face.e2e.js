// Browser test for faces (`npm run test:web`): Photo Editor → Crop → 🙂 Level face, and 🎭 Face swap
// into Collage with a mask image. The face library (vendor/face) is stood in for by a fake that
// "finds" one tilted face at known points, so no photo of a real person is needed (the geometry
// itself is covered in test/face.test.js; the real library in a manual check).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { readZip } from '../../web/lib/zip.js';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.wasm': 'application/wasm', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
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

// One face in a 400×300 photo, its eyes rising to the right (tilted 20.6° counter-clockwise).
const FAKE = `
const FACE = { a: [0.40, 0.45], b: [0.60, 0.35], mouth: [0.5615, 0.6187], nose: [0.52, 0.5] };
export const tf = { setBackend: async () => true, ready: async () => {} };
export const nets = { tinyFaceDetector: { loadFromUri: async () => {} }, faceLandmark68Net: { loadFromUri: async () => {} } };
export class TinyFaceDetectorOptions { constructor(o) { this.o = o; } }
export function detectAllFaces(cv) {
  return { withFaceLandmarks: async () => {
    // Only the upright try (the photo's own shape) "finds" it.
    if (Math.abs(cv.width / cv.height - 4 / 3) > 0.02) return [];
    const p = ([u, v]) => ({ x: u * cv.width, y: v * cv.height });
    const pts = Array.from({ length: 68 }, () => p(FACE.nose));
    for (let i = 36; i < 42; i++) pts[i] = p(FACE.a);
    for (let i = 42; i < 48; i++) pts[i] = p(FACE.b);
    for (let i = 48; i < 68; i++) pts[i] = p(FACE.mouth);
    return [{ detection: { score: 0.9, box: { x: 0.3 * cv.width, y: 0.2 * cv.height, width: 0.4 * cv.width, height: 0.55 * cv.height } }, landmarks: { positions: pts } }];
  } };
}`;

test('faces: 🙂 Level face turns the photo so the face is upright; 🎭 Face swap covers it with a mask in Collage', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/vendor/face/face-api.esm.js', (route) => route.fulfill({ body: FAKE, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/files`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(400, 300); const x = c.getContext('2d');
    x.fillStyle = '#c9a07a'; x.fillRect(0, 0, 400, 300);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.setInputFiles('#ed-file', { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  await page.getByRole('tab', { name: 'Crop' }).click();
  await page.getByRole('button', { name: '🙂 Level face' }).click();
  await page.waitForSelector('text=Leveled the face');
  // Straightened by the tilt (20.6°), not turned a quarter.
  const straighten = Number(await page.textContent('.ed-slider output'));
  assert.ok(Math.abs(Math.abs(straighten) - 20.6) < 0.6, `straightened ${straighten}°`);
  // Undo takes it back.
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(Number(await page.textContent('.ed-slider output')), 0);

  // Face swap: to Collage (Free / Superimpose), the photo as the background, a mask on the face.
  await page.getByRole('button', { name: '🎭 Face swap' }).click();
  await page.waitForFunction(() => location.hash === '#/files/collage');
  await page.waitForSelector('dialog[open] >> text=Face swap');
  const mask = await page.evaluate(async () => {
    const c = new OffscreenCanvas(100, 120); const x = c.getContext('2d');
    x.fillStyle = '#ffcc00'; x.beginPath(); x.ellipse(50, 60, 48, 58, 0, 0, Math.PI * 2); x.fill();
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.setInputFiles('#cl-mask-file', { name: 'mask.png', mimeType: 'image/png', buffer: Buffer.from(mask) });
  await page.waitForSelector('text=Covered 1 face');
  // The mask sits on the face: yellow where the face is, the photo's color well away from it.
  const at = (u, v) => page.$eval('.cl-canvas', (c, [uu, vv]) => [...c.getContext('2d').getImageData(Math.round(uu * c.width), Math.round(vv * c.height), 1, 1).data], [u, v]);
  const onFace = await at(0.5, 0.48); const away = await at(0.08, 0.92);
  assert.ok(onFace[0] > 230 && onFace[1] > 180 && onFace[2] < 80, `mask on the face: ${onFace}`);
  assert.ok(Math.abs(away[0] - 201) < 12 && Math.abs(away[2] - 122) < 12, `the photo elsewhere: ${away}`);
  // 🎨 Match color on the mask layer: its yellow moves toward the photo's tan behind it.
  await page.locator('.cl-canvas').click({ position: await page.$eval('.cl-canvas', (c) => ({ x: c.clientWidth * 0.5, y: c.clientHeight * 0.48 })) });
  await page.waitForSelector('input[aria-label^="🎨 Match color"]');
  await page.$eval('input[aria-label^="🎨 Match color"]', (r) => { r.value = '100'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  const matched = await at(0.5, 0.48);
  assert.ok(matched[2] > onFace[2] + 25 && matched[1] < onFace[1], `matched toward the photo: ${matched} (was ${onFace})`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('faces: ➕ Character in the editor goes on the face and matches the colors behind it; 🙂 Cut out face; Characters saved as a folder and installed again', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, acceptDownloads: true });
  await context.route('**/vendor/face/face-api.esm.js', (route) => route.fulfill({ body: FAKE, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/files`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  // A Character: a bright green oval.
  await page.evaluate(async (base) => {
    const c = new OffscreenCanvas(100, 120); const x = c.getContext('2d');
    x.fillStyle = 'rgb(30,200,40)'; x.beginPath(); x.ellipse(50, 60, 48, 58, 0, 0, Math.PI * 2); x.fill();
    const m = await import(`${base}lib/characters.js`);
    await m.addCharacter(await c.convertToBlob({ type: 'image/png' }), { name: 'Green mask', width: 100, height: 120 });
  }, BASE);
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(400, 300); const x = c.getContext('2d');
    x.fillStyle = '#c9a07a'; x.fillRect(0, 0, 400, 300);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.setInputFiles('#ed-file', { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  // Press and hold on the photo: no "save image" menu.
  assert.equal(await page.$eval('.ed-stage', (e) => !e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))), true, 'the long-press menu is held back');
  assert.equal(await page.$eval('.ed-stage', (e) => getComputedStyle(e).userSelect), 'none');

  const pixel = (sel, u, v) => page.$eval(sel, (c, [uu, vv]) => { const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); return [...x.getImageData(Math.round(uu * (c.width - 1)), Math.round(vv * (c.height - 1)), 1, 1).data]; }, [u, v]);
  const place = async () => {
    await page.getByRole('button', { name: '➕ Character' }).click();
    await page.locator('dialog[open].ed-char-pick').getByRole('button', { name: 'Green mask' }).click();
    await page.waitForSelector('.ed-panel >> text=On the face');
  };
  await page.getByRole('tab', { name: 'Markup' }).click();
  await place();
  // Shown on the face while it's being placed.
  const shown = await pixel('.ed-overlay', 0.52, 0.48);
  assert.ok(shown[1] > 150 && shown[0] < 100, `on the face while placing: ${shown}`);
  await page.getByRole('button', { name: '✓ Place' }).click();
  await page.waitForSelector('text=Placed Green mask');
  await page.waitForTimeout(200);
  const plain = await pixel('.ed-canvas', 0.52, 0.48);
  assert.ok(plain[1] > 150 && plain[0] < 100, `placed on the face, as it is: ${plain}`);
  const corner = await pixel('.ed-canvas', 0.05, 0.05);
  assert.ok(Math.abs(corner[0] - 201) < 10, `the photo elsewhere: ${corner}`);
  // Undo, and again with 🎨 Match color: warmer, nearer the photo behind it.
  await page.getByRole('button', { name: 'Undo' }).click();
  await place();
  await page.$eval('input[aria-label="Match color"]', (r) => { r.value = '80'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.getByRole('button', { name: '✓ Place' }).click();
  await page.waitForSelector('text=Placed Green mask');
  await page.waitForTimeout(200);
  const matched = await pixel('.ed-canvas', 0.52, 0.48);
  assert.ok(matched[0] > plain[0] + 60 && matched[1] < plain[1] - 20, `matched to the warm photo: ${matched} (was ${plain})`);

  // Cutout: 🙂 Cut out face traces around the head.
  await page.getByRole('tab', { name: '✂️ Cutout' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: '✂️ Trace a cutout' }).click();
  await page.waitForSelector('.co-canvas');
  await page.getByRole('button', { name: '🙂 Cut out face' }).click();
  await page.waitForSelector('text=Traced the face');
  assert.equal(await page.isVisible('text=Show photo'), true, 'showing the cutout');
  assert.equal(await page.$eval('.co-stage', (e) => !e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))), true);

  // All the Characters saved as a folder (a ZIP), then installed again.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Close photo' }).click();
  await page.waitForSelector('text=Your Characters');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '⬇ Save all (folder .zip)' }).click()]);
  assert.equal(download.suggestedFilename(), 'Characters.zip');
  const path = await download.path();
  const files = await readZip(new Uint8Array(await (await import('node:fs/promises')).readFile(path)));
  assert.deepEqual(files.map((f) => f.name), ['Characters/Green mask.png', 'Characters/characters.json']);
  await page.evaluate(async (base) => { const m = await import(`${base}lib/characters.js`); for (const c of await m.listCharacters()) await m.removeCharacter(c.id); }, BASE);
  // A fresh start screen (as on another phone): no Characters.
  await page.reload();
  await page.getByRole('tab', { name: '✂️ Cutout' }).click();
  await page.waitForSelector('text=None yet');
  await page.setInputFiles('#co-chars-in', path);
  await page.waitForSelector('text=Installed 1 Character');
  await page.waitForSelector('.char-card[aria-label="Green mask"]');
  // Installed twice: not doubled.
  await page.setInputFiles('#co-chars-in', path);
  await page.waitForSelector('text=That Character is here already.');
  assert.equal(await page.locator('.char-card').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});
