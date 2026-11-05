// Browser test for faces (`npm run test:web`): the FM app (FaceMask): finding, leveling, cutting out
// and inserting faces, Quick Swap. The face library (vendor/face) is stood in for by a fake that
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

test('faces: FM is an app of its own (the Photo Editor has no face tools); 🙂 Identify faces, 🙂 Level this face; Collage still matches a layer\'s colors', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/vendor/mediapipe/**', (route) => route.abort());
  await context.route('**/vendor/face/face-api.esm.js', (route) => route.fulfill({ body: FAKE, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // FM on the home screen.
  await page.goto(`${origin}${BASE}#/`);
  await page.waitForSelector('.app-tile[href="#/fm"]');
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(400, 300); const x = c.getContext('2d');
    x.fillStyle = '#c9a07a'; x.fillRect(0, 0, 400, 300);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  // The Photo Editor in Files: its own tabs and the standard editing tools, nothing for faces.
  await page.goto(`${origin}${BASE}#/files`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  assert.equal(await page.getByRole('button', { name: '⚡ Quick Swap faces' }).count(), 0);
  await page.setInputFiles('#ed-file', { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  assert.deepEqual(await page.$$eval('.studio-sub [role=tab]', (els) => els.map((e) => e.textContent)), ['✏️ Edit', '🧩 Collage', '✂️ Cutout']);
  assert.deepEqual(await page.$$eval('.ed-modes [role=tab]', (els) => els.map((e) => e.textContent)), ['Adjust', 'Filters', 'Crop', 'Markup', 'Clean Up']);
  assert.equal(await page.isVisible('text=✨ Auto-Enhance'), true);
  assert.equal(await page.getByRole('button', { name: /Identify faces|Insert Character|Level/ }).count(), 0);
  // An old link to the FaceMask tab opens FM.
  await page.goto(`${origin}${BASE}#/files/facemask`);
  await page.waitForFunction(() => location.hash === '#/fm');
  await page.waitForSelector('#ed-file', { state: 'attached' });
  // FM: its own start (Quick Swap first), then only the face tools on the photo.
  await page.getByRole('button', { name: '⚡ Quick Swap faces' }).waitFor();
  await page.setInputFiles('#ed-file', { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
  await page.waitForSelector('.ed-modes', { state: 'hidden' });
  await page.waitForSelector('text=✨ Auto-Enhance', { state: 'hidden' });
  await page.getByRole('button', { name: '🙂 Identify faces' }).click();
  await page.waitForSelector('.ed-panel >> text=Found 1 face.');
  await page.getByRole('button', { name: '🙂 Level this face' }).click();
  await page.waitForSelector('text=Leveled: eyes level');
  // Straightened by the tilt (20.6°), not turned a quarter: as kept in FM's own session.
  const kept = () => page.evaluate(async (base) => { const { idb } = await import(`${base}lib/idb.js`); return (await idb.get('fm.session'))?.state; }, BASE);
  const until = async (ok) => { for (let i = 0; i < 50; i++) { const v = await kept(); if (v && ok(v)) return v; await page.waitForTimeout(100); } return kept(); };
  const st = await until((v) => Math.abs(v.straighten) > 1);
  assert.ok(Math.abs(Math.abs(st.straighten) - 20.6) < 0.6 && !st.rotate, `straightened ${st.straighten}°, turned ${st.rotate}`);
  // Undo takes it back.
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.ok(Math.abs((await until((v) => Math.abs(v.straighten) < 0.01)).straighten) < 0.01, 'undone');
  // Files' photo is its own (FM's didn't replace it).
  const files = await page.evaluate(async (base) => { const { idb } = await import(`${base}lib/idb.js`); return (await idb.get('editor.session'))?.name; }, BASE);
  assert.equal(files, 'portrait.png');

  // Collage (Free / Superimpose): no face swap there now; a layer still matches the colors behind it.
  await page.goto(`${origin}${BASE}#/files/collage`);
  await page.waitForSelector('.cl-canvas');
  await page.getByRole('tab', { name: 'Free / Superimpose' }).click();
  await page.getByRole('button', { name: 'Background photo' }).click();
  await page.setInputFiles('#cl-file', { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole('button', { name: '🎭 Face swap' }).count(), 0);
  const mask = await page.evaluate(async () => {
    const c = new OffscreenCanvas(100, 120); const x = c.getContext('2d');
    x.fillStyle = '#ffcc00'; x.beginPath(); x.ellipse(50, 60, 48, 58, 0, 0, Math.PI * 2); x.fill();
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.getByRole('button', { name: '+ Photo' }).click();
  await page.setInputFiles('#cl-file', { name: 'mask.png', mimeType: 'image/png', buffer: Buffer.from(mask) });
  await page.waitForTimeout(300);
  const at = (u, v) => page.$eval('.cl-canvas', (c, [uu, vv]) => [...c.getContext('2d').getImageData(Math.round(uu * c.width), Math.round(vv * c.height), 1, 1).data], [u, v]);
  const onLayer = await at(0.5, 0.5); const away = await at(0.04, 0.96);
  assert.ok(onLayer[0] > 230 && onLayer[1] > 180 && onLayer[2] < 80, `the layer: ${onLayer}`);
  assert.ok(Math.abs(away[0] - 201) < 12 && Math.abs(away[2] - 122) < 12, `the photo elsewhere: ${away}`);
  // 🎨 Match color on the layer: its yellow moves toward the photo's tan behind it.
  await page.locator('.cl-canvas').click({ position: await page.$eval('.cl-canvas', (c) => ({ x: c.clientWidth * 0.5, y: c.clientHeight * 0.5 })) });
  await page.waitForSelector('input[aria-label^="🎨 Match color"]');
  await page.$eval('input[aria-label^="🎨 Match color"]', (r) => { r.value = '100'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  const matched = await at(0.5, 0.5);
  assert.ok(matched[2] > onLayer[2] + 25 && matched[1] < onLayer[1], `matched toward the photo: ${matched} (was ${onLayer})`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('faces: FM → ➕ Character goes on the face and matches the colors behind it; ✂️ a face saved as a Character; Characters saved as a folder and installed again', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, acceptDownloads: true });
  await context.route('**/vendor/mediapipe/**', (route) => route.abort());
  await context.route('**/vendor/face/face-api.esm.js', (route) => route.fulfill({ body: FAKE, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/fm`);
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

  // All the Characters saved as a folder (a ZIP) from Cutout's list, then installed again.
  await page.goto(`${origin}${BASE}#/files/cutout`);
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
    // Where the picture's content is (a Character is looked for padded with plain gray): the face's
    // points are in terms of that, as a real detector's would be.
    let bx = 0; let by = 0; let bw = cv.width; let bh = cv.height;
    if (set === CHAR) {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let x0 = cv.width; let y0 = cv.height; let x1 = -1; let y1 = -1;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) { const o = (y * cv.width + x) * 4; if (Math.abs(d[o] - 128) + Math.abs(d[o + 1] - 128) + Math.abs(d[o + 2] - 128) > 30) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      // (The test Character's oval: 84 × 108 px from (18, 8) of its 120 px image.)
      if (x1 > x0) { const k = (x1 - x0 + 1) / 84; bx = x0 - 18 * k; by = y0 - 8 * k; bw = 120 * k; bh = 120 * k; }
    }
    return set.map((F) => {
      const p = ([u, v]) => ({ x: bx + u * bw, y: by + v * bh });
      const pts = Array.from({ length: 68 }, () => p(F.mouth));
      for (let i = 36; i < 42; i++) pts[i] = p(F.a);
      for (let i = 42; i < 48; i++) pts[i] = p(F.b);
      return { detection: { score: 0.9, box: { x: bx + F.box[0] * bw, y: by + F.box[1] * bh, width: F.box[2] * bw, height: F.box[3] * bh } }, landmarks: { positions: pts } };
    });
  } };
}`;

test('faces: ➕ Character lined up by its own eyes and mouth; with two faces, pick one (tap its number) or put it on every face; the magnifier shows under the finger', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/vendor/mediapipe/**', (route) => route.abort());
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

  // FM: 🎭 Insert Character: on the bigger face, its red eyes on that face's eyes.
  await page.goto(`${origin}${BASE}#/fm`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  await page.setInputFiles('#ed-file', { name: 'two.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('.ed-canvas');
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

  // Cutout (in Files): a patch is aimed with the magnifier and applied when the finger lifts.
  await page.goto(`${origin}${BASE}#/files`);
  await page.getByRole('button', { name: 'Continue' }).click(); // (Files' own photo, kept)
  await page.waitForSelector('.ed-canvas');
  await page.getByRole('tab', { name: '✂️ Cutout' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: '✂️ Trace a cutout' }).click();
  await page.waitForSelector('.co-canvas');
  { // A rough trace around the middle of the photo.
    const r = await page.$eval('.co-canvas', (e) => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
    const pts = Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * 2 * Math.PI; return [r[0] + r[2] * (0.5 + 0.3 * Math.cos(a)), r[1] + r[3] * (0.5 + 0.3 * Math.sin(a))]; });
    await page.mouse.move(...pts[0]); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 2 }); await page.mouse.move(...pts[0], { steps: 2 }); await page.mouse.up();
    await page.waitForTimeout(300);
  }
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

test('faces: ✂️ Cut out & save keeps the face with a generous border (its detail kept); Identify draws its outline; inserted back, it\'s trimmed at the hairline and lands where it came from', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/vendor/mediapipe/**', (route) => route.abort());
  await context.route('**/vendor/face/face-api.esm.js', (route) => route.fulfill({ body: FAKE3, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/fm`);
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
    return { skin, hair, green, w: bmp.width, h: bmp.height, face: c.face };
  }, BASE);
  assert.ok(got.skin > 5000, `the face: ${JSON.stringify(got)}`);
  // A generous border: some of the hairline and the edges around the face kept (trimmed when it's used).
  assert.ok(got.hair > 200, `its hairline kept: ${JSON.stringify(got)}`);
  assert.ok(got.w > 150 && got.h > 160, `bigger than the face itself: ${got.w}×${got.h}`);
  assert.ok(got.face?.pts?.length === 68, 'its face (all 68 points) kept with it');

  // 🎭 Insert Character: that face back onto the same face. Sized and placed by its own features, it
  // lands right where it came from: the photo, after it's placed (not blended), all but unchanged.
  const shot = () => page.$eval('.ed-canvas', (c) => { const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); return Array.from(x.getImageData(0, 0, c.width, c.height).data); });
  const before = await shot();
  await page.getByRole('button', { name: '🎭 Insert Character' }).click();
  await page.locator('dialog[open].ed-char-pick .char-card').first().click();
  await page.waitForSelector('.ed-panel >> text=fitted to the face');
  await page.$eval('input[aria-label="Blend into the photo"]', (r) => { r.value = '0'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(250);
  // Its size: about the face's own (the cut was ~150 px wide of a 400 px photo), not a much bigger one.
  const size = Number(await page.$eval('input[aria-label="Character size"]', (r) => r.value));
  assert.ok(size >= 35 && size <= 55, `sized to the face (with its border): ${size}% of the photo's width`);
  // Looking the same way as the face: not flipped. ⇋ Flip mirrors it (still fitted), and back again.
  const flip = page.getByRole('button', { name: '⇋ Flip' });
  assert.equal(await flip.getAttribute('aria-pressed'), 'false');
  await flip.click();
  await page.waitForSelector('.ed-panel >> text=Flipped: it looks the other way.');
  assert.equal(await page.getByRole('button', { name: '⇋ Flip' }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '⇋ Flip' }).click();
  await page.waitForSelector('.ed-panel >> text=Not flipped');
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '✓ Place' }).click();
  await page.waitForSelector('text=/Placed .+\\. Undo/');
  await page.waitForTimeout(250);
  const after = await shot();
  let off = 0; let n = 0;
  for (let i = 0; i < before.length; i += 16) { n++; if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 60) off++; }
  assert.ok(off / n < 0.01, `lands where it came from: ${(100 * off / n).toFixed(2)}% of the photo changed`);
  assert.deepEqual(errors, []);
  await context.close();
});

test('faces: ⚡ Quick Swap: two photos (the one to change, then the face), and the face is cut out, fitted and placed, ready to save; kept as a Character if wanted', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.route('**/vendor/mediapipe/**', (route) => route.abort());
  await context.route('**/vendor/face/face-api.esm.js', (route) => route.fulfill({ body: FAKE3, headers: { 'content-type': 'text/javascript' } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/fm`);
  await page.waitForSelector('#ed-file', { state: 'attached' });
  // Two drawn faces in the same place (the fake finds a face there in any 4:3 picture): the base has
  // no eyes drawn; the other has dark eyes where its landmarks put them.
  const make = (eyes) => page.evaluate(async (eyes) => {
    const c = new OffscreenCanvas(400, 300); const x = c.getContext('2d');
    x.fillStyle = 'rgb(40,140,60)'; x.fillRect(0, 0, 400, 300);
    x.fillStyle = 'rgb(90,50,20)'; x.beginPath(); x.ellipse(200, 120, 90, 95, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgb(225,180,150)'; x.beginPath(); x.ellipse(200, 160, 70, 80, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgb(90,50,20)'; x.fillRect(120, 60, 160, 45);
    if (eyes) { x.fillStyle = 'rgb(20,15,15)'; for (const ex of [172, 228]) { x.beginPath(); x.arc(ex, 129, 7, 0, Math.PI * 2); x.fill(); } }
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }, eyes);
  const base = await make(false); const face = await make(true);
  // From the start screen: ⚡ Quick Swap faces, then the two photos.
  await page.getByRole('button', { name: '⚡ Quick Swap faces' }).click();
  await page.waitForSelector('dialog[open].qs-pick');
  const swap = page.locator('dialog[open].qs-pick').getByRole('button', { name: '⚡ Swap' });
  assert.equal(await swap.isDisabled(), true, 'nothing to swap until both are chosen');
  await page.setInputFiles('#qs-base', { name: 'base.png', mimeType: 'image/png', buffer: Buffer.from(base) });
  assert.equal(await swap.isDisabled(), true);
  await page.setInputFiles('#qs-face', { name: 'face.png', mimeType: 'image/png', buffer: Buffer.from(face) });
  await swap.click();
  await page.waitForFunction(() => location.hash === '#/fm');
  await page.waitForSelector('.ed-panel >> text=/⚡ Swapped/');
  await page.waitForTimeout(250);
  // The new face's eyes are on the base face now, and the background around it is as it was.
  const read = () => page.$eval('.ed-canvas', (c) => {
    const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0);
    const at = (u, v) => [...x.getImageData(Math.round(u * c.width), Math.round(v * c.height), 1, 1).data].slice(0, 3);
    return { eye: at(172 / 400, 129 / 300), cheek: at(200 / 400, 190 / 300), corner: at(10 / 400, 290 / 300) };
  });
  const after = await read();
  assert.ok(after.eye[0] < 120, `its eye on the face: ${after.eye}`);
  assert.ok(after.cheek[0] > 170, `still skin around it: ${after.cheek}`);
  assert.ok(Math.abs(after.corner[0] - 40) < 12 && Math.abs(after.corner[1] - 140) < 12, `the background left alone: ${after.corner}`);
  // One undo step takes it back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(250);
  assert.ok((await read()).eye[0] > 170, 'undone: no eye there');
  await page.getByRole('button', { name: 'Redo' }).click();
  // The face it used, kept as a Character.
  await page.getByRole('button', { name: '✂️ Keep that face as a Character' }).click();
  await page.locator('dialog[open].fm-save').getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('.ed-panel >> text=/Saved ".+" as a Character/');
  // From the panel, ⚡ Quick Swap offers this photo as the first.
  await page.getByRole('button', { name: '⚡ Quick Swap', exact: true }).click();
  await page.waitForSelector('dialog[open].qs-pick >> text=This photo');
  await page.locator('dialog[open].qs-pick').getByRole('button', { name: 'Cancel' }).click();
  // Ready to save: Done opens the export sheet.
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForSelector('dialog[open]');
  assert.deepEqual(errors, []);
  await context.close();
});

test('faces: the face mesh (vendor/mediapipe) loads on the page, under its CSP, and finds no face in a blank picture', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|mediapipe/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`${origin}${BASE}#/fm`);
  const out = await page.evaluate(async () => {
    const { detectMesh } = await import('./lib/face-mesh.js');
    const c = document.createElement('canvas'); c.width = 320; c.height = 240;
    const x = c.getContext('2d'); x.fillStyle = '#8ab'; x.fillRect(0, 0, 320, 240);
    const faces = await detectMesh(c);
    return { n: faces.length };
  });
  assert.equal(out.n, 0);
  assert.deepEqual(errors, []);
  await context.close();
});
