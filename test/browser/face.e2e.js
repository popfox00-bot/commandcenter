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

test('faces: FaceMask → 🙂 Identify faces, 🙂 Level this face turns the photo so it is upright; 🎭 Face swap in Collage covers it with a mask', async () => {
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
  // The face tools are in a place of their own: a FaceMask tab beside Edit, Collage and Cutout. The
  // editor's own tabs (and Crop, Markup) no longer have them.
  assert.deepEqual(await page.$$eval('.studio-sub [role=tab]', (els) => els.map((e) => e.textContent)), ['✏️ Edit', '🧩 Collage', '✂️ Cutout', '🙂 FaceMask']);
  assert.deepEqual(await page.$$eval('.ed-modes [role=tab]', (els) => els.map((e) => e.textContent)), ['Adjust', 'Filters', 'Crop', 'Markup', 'Clean Up']);
  await page.getByRole('tab', { name: 'Crop' }).click();
  assert.equal(await page.getByRole('button', { name: '🙂 Level face' }).count(), 0);
  await page.getByRole('tab', { name: '🙂 FaceMask' }).click();
  await page.waitForFunction(() => location.hash === '#/files/facemask');
  // All by itself: the same photo, only the face tools (no editing tabs or one-tap fixes).
  assert.equal(await page.isVisible('.ed-modes'), false);
  assert.equal(await page.isVisible('text=✨ Auto-Enhance'), false);
  await page.getByRole('button', { name: '🙂 Identify faces' }).click();
  await page.waitForSelector('.ed-panel >> text=Found 1 face.');
  await page.getByRole('button', { name: '🙂 Level this face' }).click();
  await page.waitForSelector('text=Leveled: eyes level');
  // Straightened by the tilt (20.6°), not turned a quarter (seen in Edit → Crop).
  await page.getByRole('tab', { name: '✏️ Edit' }).click();
  await page.waitForSelector('.ed-modes');
  await page.getByRole('tab', { name: 'Crop' }).click();
  const straighten = Number(await page.textContent('.ed-slider output'));
  assert.ok(Math.abs(Math.abs(straighten) - 20.6) < 0.6, `straightened ${straighten}°`);
  // Undo takes it back.
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(Number(await page.textContent('.ed-slider output')), 0);

  // Face swap in Collage (Free / Superimpose): the photo as the background, a mask on the face.
  await page.getByRole('tab', { name: '🧩 Collage' }).click();
  await page.waitForSelector('.cl-canvas');
  await page.getByRole('tab', { name: 'Free / Superimpose' }).click();
  await page.getByRole('button', { name: 'Background photo' }).click();
  await page.setInputFiles('#cl-file', { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.getByRole('button', { name: '🎭 Face swap' }).click();
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
    await page.getByRole('button', { name: '🎭 Insert Character' }).click();
    await page.locator('dialog[open].ed-char-pick').getByRole('button', { name: 'Green mask' }).click();
    await page.waitForSelector('.ed-panel >> text=On the face');
  };
  await page.getByRole('tab', { name: '🙂 FaceMask' }).click();
  await page.getByRole('button', { name: '🙂 Identify faces' }).click();
  await page.waitForSelector('.ed-panel >> text=Found 1 face.');
  // ✂️ Cut out & save as Character: the face, cut out and named, kept with the others.
  await page.getByRole('button', { name: '✂️ Cut out & save as Character' }).click();
  const save = page.locator('dialog[open].fm-save');
  await save.waitFor();
  await save.getByRole('textbox', { name: 'Character name' }).fill('My face');
  await save.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('text=Saved "My face" as a Character');
  const kept = await page.evaluate(async (base) => { const m = await import(`${base}lib/characters.js`); return (await m.listCharacters()).map((c) => [c.name, c.width > 0 && c.height > 0]); }, BASE);
  assert.deepEqual(kept[0], ['My face', true]);
  await page.evaluate(async (base) => { const m = await import(`${base}lib/characters.js`); const c = (await m.listCharacters()).find((x) => x.name === 'My face'); await m.removeCharacter(c.id); }, BASE);
  await place();
  await page.$eval('input[aria-label="Blend into the photo"]', (r) => { r.value = '0'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(250);
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
  // Undo, and again blended into the photo: warmer, nearer the photo around it.
  await page.getByRole('button', { name: 'Undo' }).click();
  await place();
  await page.$eval('input[aria-label="Blend into the photo"]', (r) => { r.value = '80'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(250);
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
  await page.waitForSelector('h3:text-is("Your Characters")');
  await page.getByRole('button', { name: '⬇ Save all…' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('dialog[open]').getByRole('button', { name: '⬇ As a folder (.zip)' }).click()]);
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

// Two faces in a 400×300 photo (the left one bigger), and one in a square Character (its eyes at
// 35% and 65% across, 40% down).
const FAKE2 = `
const PHOTO = [
  { a: [0.25, 0.45], b: [0.35, 0.45], mouth: [0.30, 0.62], box: [0.18, 0.32, 0.24, 0.42] },
  { a: [0.65, 0.42], b: [0.75, 0.38], mouth: [0.72, 0.58], box: [0.60, 0.28, 0.20, 0.36] },
];
const CHAR = [{ a: [0.35, 0.4], b: [0.65, 0.4], mouth: [0.5, 0.72], box: [0.15, 0.1, 0.7, 0.8] }];
export const tf = { setBackend: async () => true, ready: async () => {} };
export const nets = { tinyFaceDetector: { loadFromUri: async () => {} }, faceLandmark68Net: { loadFromUri: async () => {} } };
export class TinyFaceDetectorOptions { constructor(o) { this.o = o; } }
export function detectAllFaces(cv) {
  return { withFaceLandmarks: async () => {
    const r = cv.width / cv.height;
    const set = Math.abs(r - 4 / 3) < 0.02 ? PHOTO : Math.abs(r - 1) < 0.02 ? CHAR : [];
    return set.map((F) => {
      const p = ([u, v]) => ({ x: u * cv.width, y: v * cv.height });
      const pts = Array.from({ length: 68 }, () => p(F.mouth));
      for (let i = 36; i < 42; i++) pts[i] = p(F.a);
      for (let i = 42; i < 48; i++) pts[i] = p(F.b);
      return { detection: { score: 0.9, box: { x: F.box[0] * cv.width, y: F.box[1] * cv.height, width: F.box[2] * cv.width, height: F.box[3] * cv.height } }, landmarks: { positions: pts } };
    });
  } };
}`;

test('faces: ➕ Character lined up by its own eyes and mouth; with two faces, pick one (tap its number) or put it on every face; the magnifier shows under the finger', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/vendor/face/face-api.esm.js', (route) => route.fulfill({ body: FAKE2, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/files`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  // The Character: a face cut out, tan, with red eyes where its own face's eyes are.
  await page.evaluate(async (base) => {
    const c = new OffscreenCanvas(120, 120); const x = c.getContext('2d');
    x.fillStyle = 'rgb(230,190,150)'; x.beginPath(); x.ellipse(60, 62, 42, 54, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgb(255,0,0)'; for (const ex of [42, 78]) { x.beginPath(); x.arc(ex, 48, 6, 0, Math.PI * 2); x.fill(); }
    const m = await import(`${base}lib/characters.js`);
    await m.addCharacter(await c.convertToBlob({ type: 'image/png' }), { name: 'Me', width: 120, height: 120 });
  }, BASE);
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(400, 300); const x = c.getContext('2d');
    x.fillStyle = 'rgb(40,90,160)'; x.fillRect(0, 0, 400, 300);
    x.fillStyle = '#fff'; x.fillRect(196, 146, 8, 8);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.setInputFiles('#ed-file', { name: 'two.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  const pixel = (sel, u, v) => page.$eval(sel, (c, [uu, vv]) => { const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); return [...x.getImageData(Math.round(uu * (c.width - 1)), Math.round(vv * (c.height - 1)), 1, 1).data]; }, [u, v]);
  const red = (p) => p[0] > 200 && p[1] < 70 && p[2] < 70;

  // Clean Up: holding a finger down shows the magnifier above it (its yellow crosshair); lifting cleans up.
  await page.getByRole('tab', { name: 'Clean Up' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const ov = await page.$eval('.ed-overlay', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, e.width / r.width]; });
  const sx = ov[0] + ov[2] * 0.5; const sy = ov[1] + ov[3] * 0.85;
  await page.mouse.move(sx, sy); await page.mouse.down();
  // Its center is 34 + 58 px above the finger; the crosshair arm 6 px right of it (drawn on the next frame).
  const armAt = [(ov[2] * 0.5 + 6) * ov[4], (ov[3] * 0.85 - 92) * ov[4]];
  const readArm = () => page.$eval('.ed-overlay', (c, [x, y]) => [...c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data], armAt);
  let arm = await readArm();
  for (let k = 0; k < 30 && !(arm[0] > 200 && arm[2] < 80); k++) { await page.waitForTimeout(100); arm = await readArm(); }
  assert.ok(arm[0] > 200 && arm[1] > 170 && arm[2] < 80 && arm[3] > 200, `the magnifier's crosshair above the finger: ${arm}`);
  assert.equal(await page.isVisible('text=Spot cleaned up'), false, 'nothing done while the finger is down');
  await page.mouse.up();
  await page.waitForSelector('text=Spot cleaned up');

  // 🎭 Insert Character: on the bigger face, its red eyes on that face's eyes.
  await page.getByRole('tab', { name: '🙂 FaceMask' }).click();
  await page.getByRole('button', { name: '🙂 Identify faces' }).click();
  await page.waitForSelector('.ed-panel >> text=Found 2 faces');
  const place = async () => {
    await page.getByRole('button', { name: '🎭 Insert Character' }).click();
    await page.locator('dialog[open].ed-char-pick').getByRole('button', { name: 'Me' }).click();
    await page.waitForSelector('.ed-panel >> text=fitted to the face');
  await page.$eval('input[aria-label="Blend into the photo"]', (r) => { r.value = '0'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(250);
  };
  await place();
  assert.match(await page.textContent('.ed-panel'), /On face 1 of 2/);
  assert.equal(await page.locator('.ed-panel').getByRole('button', { name: 'Face 2' }).count(), 1);
  await page.getByRole('button', { name: '✓ Place' }).click();
  await page.waitForSelector('text=Placed Me.');
  await page.waitForTimeout(200);
  for (const [u, v] of [[0.25, 0.45], [0.35, 0.45]]) assert.ok(red(await pixel('.ed-canvas', u, v)), `its eye on face 1's eye at ${u},${v}: ${await pixel('.ed-canvas', u, v)}`);
  assert.ok(!red(await pixel('.ed-canvas', 0.65, 0.42)), 'not on face 2');

  // Again: tap face 2's number to move it there; then put it on every face.
  await page.getByRole('button', { name: 'Undo' }).click();
  await place();
  const badge = await page.$eval('.ed-overlay', (e) => { const r = e.getBoundingClientRect(); return [r.x + 0.70 * r.width, r.y + 0.28 * r.height]; });
  await page.mouse.click(...badge);
  await page.waitForSelector('.ed-panel >> text=On face 2 of 2');
  await page.getByRole('button', { name: '🙂 On every face' }).click();
  await page.waitForSelector('text=Placed Me on 2 faces.');
  await page.waitForTimeout(200);
  for (const [u, v] of [[0.25, 0.45], [0.35, 0.45], [0.65, 0.42], [0.75, 0.38]]) assert.ok(red(await pixel('.ed-canvas', u, v)), `an eye on an eye at ${u},${v}: ${await pixel('.ed-canvas', u, v)}`);

  // Cutout: a patch is aimed with the magnifier and applied when the finger lifts.
  await page.getByRole('tab', { name: '✂️ Cutout' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: '✂️ Trace a cutout' }).click();
  await page.waitForSelector('.co-canvas');
  await page.getByRole('button', { name: '🙂 Cut out face' }).click();
  await page.waitForSelector('text=Traced the face');
  await page.getByRole('radio', { name: '🩹 Patch fix' }).click();
  const co = await page.$eval('.co-canvas', (e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, e.width / r.width]; });
  const px = co[0] + co[2] * 0.3; const py = co[1] + co[3] * 0.85;
  await page.mouse.move(px, py); await page.mouse.down(); await page.mouse.move(px + 20, py, { steps: 4 });
  await page.waitForTimeout(100);
  const coArm = await page.$eval('.co-canvas', (c, [x, y]) => [...c.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data], [(co[2] * 0.3 + 20 + 6) * co[4], (co[3] * 0.85 - 92) * co[4]]);
  assert.ok(coArm[0] > 200 && coArm[1] > 170 && coArm[2] < 80, `the magnifier above the finger in Cutout: ${coArm}`);
  const done = /^(Cut away|Brought back|Nothing to)/;
  assert.equal(await page.$$eval('.ed-panel p', (ps, re) => ps.some((p) => new RegExp(re).test(p.textContent)), done.source), false, 'nothing applied while the finger is down');
  await page.mouse.up();
  await page.waitForFunction((re) => [...document.querySelectorAll('.ed-panel p')].some((p) => new RegExp(re).test(p.textContent)), done.source);
  assert.deepEqual(errors, []);
  await context.close();
});

// One face with all 68 landmarks (a plain template), in a 400×300 photo: skin from the brows to the chin,
// brown hair above the forehead, a green background.
const FAKE3 = `
function landmarks(cx, cy, s) {
  const p = [];
  for (let i = 0; i <= 16; i++) { const a = Math.PI * (i / 16); p.push([cx - Math.cos(a) * 48 * s, cy + Math.sin(a) * 50 * s - 5 * s]); }
  for (let i = 0; i < 5; i++) p.push([cx - 38 * s + i * 7 * s, cy - 30 * s]);
  for (let i = 0; i < 5; i++) p.push([cx + 10 * s + i * 7 * s, cy - 30 * s]);
  for (let i = 0; i < 4; i++) p.push([cx, cy - 20 * s + i * 7 * s]);
  for (let i = 0; i < 5; i++) p.push([cx - 10 * s + i * 5 * s, cy + 10 * s]);
  const eye = (ex) => [[ex - 9 * s, cy - 15 * s], [ex - 4 * s, cy - 18 * s], [ex + 4 * s, cy - 18 * s], [ex + 9 * s, cy - 15 * s], [ex + 4 * s, cy - 12 * s], [ex - 4 * s, cy - 12 * s]];
  p.push(...eye(cx - 20 * s), ...eye(cx + 20 * s));
  for (let i = 0; i < 20; i++) { const a = (i / 20) * 2 * Math.PI; p.push([cx + Math.cos(a) * 15 * s, cy + 25 * s + Math.sin(a) * 6 * s]); }
  return p;
}
export const tf = { setBackend: async () => true, ready: async () => {} };
export const nets = { tinyFaceDetector: { loadFromUri: async () => {} }, faceLandmark68Net: { loadFromUri: async () => {} } };
export class TinyFaceDetectorOptions { constructor(o) { this.o = o; } }
export function detectAllFaces(cv) {
  return { withFaceLandmarks: async () => {
    if (Math.abs(cv.width / cv.height - 4 / 3) > 0.02) return [];
    const k = cv.width / 400;
    const pts = landmarks(200 * k, 150 * k, 1.4 * k).map(([x, y]) => ({ x, y }));
    return [{ detection: { score: 0.95, box: { x: 130 * k, y: 90 * k, width: 140 * k, height: 140 * k } }, landmarks: { positions: pts } }];
  } };
}`;

test('faces: ✂️ Cut out & save takes just the face along its own outline (no hair above the forehead, no background); Identify draws that outline', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/vendor/face/face-api.esm.js', (route) => route.fulfill({ body: FAKE3, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/files`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(400, 300); const x = c.getContext('2d');
    x.fillStyle = 'rgb(40,140,60)'; x.fillRect(0, 0, 400, 300); // background
    x.fillStyle = 'rgb(90,50,20)'; x.beginPath(); x.ellipse(200, 120, 90, 95, 0, 0, Math.PI * 2); x.fill(); // hair
    x.fillStyle = 'rgb(225,180,150)'; x.beginPath(); x.ellipse(200, 160, 70, 80, 0, 0, Math.PI * 2); x.fill(); // the face
    x.fillStyle = 'rgb(90,50,20)'; x.fillRect(120, 60, 160, 45); // hair down to just above the brows (y 108)
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.setInputFiles('#ed-file', { name: 'person.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  await page.getByRole('tab', { name: '🙂 FaceMask' }).click();
  await page.getByRole('button', { name: '🙂 Identify faces' }).click();
  await page.waitForSelector('.ed-panel >> text=Found 1 face.');
  await page.waitForTimeout(150);
  // The outline drawn follows the jaw: at the chin (y 213) it's there, at the box's bottom corner (y 230) it isn't.
  const drawn = (u, v) => page.$eval('.ed-overlay', (c, [uu, vv]) => c.getContext('2d').getImageData(Math.round(uu * c.width), Math.round(vv * c.height), 1, 1).data[3], [u, v]);
  assert.equal(await drawn(130 / 400, 228 / 300), 0, 'no box corner');
  await page.getByRole('button', { name: '✂️ Cut out & save as Character' }).click();
  const save = page.locator('dialog[open].fm-save');
  await save.waitFor();
  await save.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('text=/Saved ".+" as a Character/');
  // The Character saved: skin, and none of the hair or the green background.
  const got = await page.evaluate(async (base) => {
    const m = await import(`${base}lib/characters.js`);
    const [c] = await m.listCharacters();
    const bmp = await createImageBitmap(await m.getCharacterBlob(c.id));
    const cv = new OffscreenCanvas(bmp.width, bmp.height); const x = cv.getContext('2d'); x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
    let skin = 0; let hair = 0; let green = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
      if (r > 200 && g > 160) skin++; else if (r < 120 && g < 80) hair++; else if (g > r) green++;
    }
    return { skin, hair, green, w: bmp.width, h: bmp.height };
  }, BASE);
  assert.ok(got.skin > 5000, `the face: ${JSON.stringify(got)}`);
  assert.ok(got.hair < got.skin * 0.01 && got.green < got.skin * 0.01, `no hair, no background: ${JSON.stringify(got)}`);
  assert.deepEqual(errors, []);
  await context.close();
});
