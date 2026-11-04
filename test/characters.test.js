// Characters on photos: Match color (web/lib/color-match.js), placing one on a photo
// (web/tools/editor/place.js), a face's head outline for Cutout (web/lib/face-core.js), and all the
// Characters saved as a folder and installed again (web/lib/characters-io.js, web/lib/zip.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rgbToLab, labToRgb, colorStats, matchColors } from '../web/lib/color-match.js';
import { placedPatch, placedBox, placedCorners, onPlaced } from '../web/tools/editor/place.js';
import { faceOutline, faceFrom } from '../web/lib/face-core.js';
import { characterFiles, charactersZip, installCharacters, safeName, MANIFEST } from '../web/lib/characters-io.js';
import { readZip, createZip } from '../web/lib/zip.js';

const solid = (w, h, [r, g, b], a = 255) => { const px = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) px.set([r, g, b, a], i * 4); return px; };

test('Lab there and back; the stats of an area (alpha-weighted)', () => {
  for (const c of [[0, 0, 0], [255, 255, 255], [200, 40, 30], [20, 120, 220], [128, 128, 128]]) {
    const back = labToRgb(...rgbToLab(...c));
    back.forEach((v, i) => assert.ok(Math.abs(v - c[i]) < 1, `${c} → ${back}`));
  }
  const px = solid(4, 4, [200, 40, 30]);
  for (let i = 0; i < 8; i++) px[i * 4 + 3] = 0; // half see-through: not counted
  const s = colorStats(px, 4, 4);
  assert.equal(s.n, 8);
  assert.ok(s.sd.every((v) => v < 1e-3));
  assert.equal(colorStats(solid(2, 2, [0, 0, 0], 0), 2, 2), null);
});

test('Match color: a green cutout moved toward a warm background by the amount; alpha kept', () => {
  const w = 20; const h = 20;
  const cut = solid(w, h, [40, 180, 60]);
  for (let i = 0; i < w * h; i++) cut[i * 4 + 1] -= (i % 7) * 3; // a little texture
  cut[3] = 0;
  const bg = colorStats(solid(10, 10, [200, 150, 110]), 10, 10);
  const none = matchColors(cut, w, h, bg, 0);
  assert.deepEqual([...none], [...cut], 'amount 0: as it was');
  const half = colorStats(matchColors(cut, w, h, bg, 0.5), w, h);
  const full = matchColors(cut, w, h, bg, 1);
  const fs = colorStats(full, w, h); const cs = colorStats(cut, w, h);
  const dist = (a, b) => Math.hypot(a.mean[0] - b.mean[0], a.mean[1] - b.mean[1], a.mean[2] - b.mean[2]);
  assert.ok(dist(fs, bg) < dist(half, bg) && dist(half, bg) < dist(cs, bg), 'closer the more it is matched');
  assert.ok(dist(fs, bg) < 8, `fully matched: near the background's color (${dist(fs, bg).toFixed(1)})`);
  assert.equal(full[3], 0, 'alpha kept');
  // Its own texture is kept (not flattened to one color).
  assert.ok(fs.sd[0] + fs.sd[1] + fs.sd[2] > 0.5);
});

test('placing: the box it covers, hit-testing, and its pixels painted (turned, edges clean)', () => {
  const img = solid(10, 20, [255, 0, 0]); // 1:2
  const place = { x: 50, y: 50, width: 20, rot: 0 };
  assert.deepEqual(placedCorners(place, 0.5).map((p) => p.map(Math.round)), [[40, 30], [60, 30], [60, 70], [40, 70]]);
  assert.ok(onPlaced(place, 0.5, 45, 65) && !onPlaced(place, 0.5, 65, 50));
  const p = placedPatch(img, 10, 20, place, 100, 100);
  assert.deepEqual([p.x0, p.y0, p.pw, p.ph], [40, 30, 20, 40]);
  const at = (x, y) => [...p.rgba.subarray(((y - p.y0) * p.pw + x - p.x0) * 4, ((y - p.y0) * p.pw + x - p.x0) * 4 + 4)];
  assert.deepEqual(at(50, 50), [255, 0, 0, 255]);
  // Turned a quarter: now wide, not tall.
  const q = placedPatch(img, 10, 20, { ...place, rot: Math.PI / 2 }, 100, 100);
  assert.ok(q.pw >= 39 && q.ph <= 21, `${q.pw}×${q.ph}`);
  // Off the picture: nothing; partly off: clipped.
  assert.equal(placedPatch(img, 10, 20, { x: -100, y: -100, width: 20, rot: 0 }, 100, 100), null);
  const edge = placedPatch(img, 10, 20, { x: 2, y: 50, width: 20, rot: 0 }, 100, 100);
  assert.equal(edge.x0, 0);
  assert.deepEqual(placedBox(place, 0.5, 100, 100, 0.5), { x0: 30, y0: 10, x1: 70, y1: 90 });
});

test('a face\'s head outline: around the eyes, mouth and forehead, turned with the face', () => {
  const pts = Array.from({ length: 68 }, () => [200, 150]);
  for (let i = 36; i < 42; i++) pts[i] = [170, 130];
  for (let i = 42; i < 48; i++) pts[i] = [230, 130];
  for (let i = 48; i < 68; i++) pts[i] = [200, 190];
  const face = faceFrom({ x: 150, y: 100, width: 100, height: 110 }, pts, 400, 300);
  const out = faceOutline(face, 400, 300, 40);
  assert.equal(out.length, 40);
  const inside = ([x, y]) => { let c = false; for (let i = 0, j = out.length - 1; i < out.length; j = i++) { const [xi, yi] = out[i]; const [xj, yj] = out[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  for (const p of [[170, 130], [230, 130], [200, 190], [200, 85]]) assert.ok(inside([p[0] / 400, p[1] / 300]), `${p} inside`);
  assert.ok(!inside([20 / 400, 20 / 300]));
  const xs = out.map((p) => p[0] * 400); const ys = out.map((p) => p[1] * 300);
  assert.ok(Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs), 'taller than wide');
});

/** A fake set of Characters (no IndexedDB here). */
function fakeStore(initial = []) {
  const blobs = new Map(); const list = [];
  for (const c of initial) { blobs.set(c.id, c.blob); list.push({ id: c.id, name: c.name, width: c.width, height: c.height, createdAt: 1 }); }
  return {
    list: async () => [...list],
    get: async (id) => blobs.get(id),
    add: async (blob, meta) => { const id = String(Math.random()); blobs.set(id, blob); list.unshift({ id, ...meta }); return { id }; },
    measure: async () => ({ width: 7, height: 9 }),
    names: () => list.map((c) => c.name),
  };
}
const png = (n) => new Blob([new Uint8Array(n).fill(n)], { type: 'image/png' });

test('Characters as a folder: images plus characters.json, names safe and unique; a ZIP with a Characters folder', async () => {
  const s = fakeStore([{ id: 'a', name: 'Cat / Dog', blob: png(10), width: 1, height: 2 }, { id: 'b', name: 'Cat - Dog', blob: png(12), width: 3, height: 4 }, { id: 'c', name: 'Mask', blob: new Blob([new Uint8Array(5)], { type: 'image/webp' }), width: 5, height: 6 }]);
  const { files, count } = await characterFiles(s);
  assert.equal(count, 3);
  assert.deepEqual(files.map((f) => f.name), ['Cat - Dog.png', 'Cat - Dog (2).png', 'Mask.webp', MANIFEST]);
  const manifest = JSON.parse(await files.at(-1).blob.text());
  assert.deepEqual(manifest.characters.map((c) => [c.file, c.name]), [['Cat - Dog.png', 'Cat / Dog'], ['Cat - Dog (2).png', 'Cat - Dog'], ['Mask.webp', 'Mask']]);
  assert.equal(safeName('..a:b*c?'), 'a-b-c-');
  const { blob } = await charactersZip(s);
  const zipped = await readZip(blob);
  assert.deepEqual(zipped.map((z) => z.name), ['Characters/Cat - Dog.png', 'Characters/Cat - Dog (2).png', 'Characters/Mask.webp', `Characters/${MANIFEST}`]);
  assert.equal(zipped[0].bytes.length, 10);
});

test('installing: from the ZIP on another phone (names, sizes, order kept); twice: nothing doubled', async () => {
  const from = fakeStore([{ id: 'a', name: 'Cat / Dog', blob: png(10), width: 1, height: 2 }, { id: 'b', name: 'Mask', blob: png(12), width: 3, height: 4 }]);
  const { blob } = await charactersZip(from);
  const to = fakeStore([{ id: 'x', name: 'Mine', blob: png(3), width: 1, height: 1 }]);
  const zipFile = new File([blob], 'Characters.zip', { type: 'application/zip' });
  const r = await installCharacters([zipFile], to);
  assert.deepEqual([r.added, r.skipped], [2, 0]);
  assert.deepEqual(to.names(), ['Cat / Dog', 'Mask', 'Mine'], 'in the saved order, ahead of what was there');
  assert.deepEqual((await to.list()).slice(0, 2).map((c) => [c.width, c.height]), [[1, 2], [3, 4]]);
  const again = await installCharacters([zipFile], to);
  assert.deepEqual([again.added, again.skipped], [0, 2]);
  // A folder's files (or images picked one by one, no characters.json): named by their files.
  const loose = await installCharacters([new File([png(20)], 'Hat.png', { type: 'image/png' }), new File(['x'], 'notes.txt', { type: 'text/plain' })], to);
  assert.deepEqual([loose.added, loose.names], [1, ['Hat']]);
  assert.equal((await to.list())[0].width, 7, 'measured when there is no characters.json');
  await assert.rejects(installCharacters([new File(['nope'], 'bad.zip', { type: 'application/zip' })], to), /isn't a ZIP/);
  // A ZIP made elsewhere (stored, junk alongside): the images found inside.
  const other = createZip([{ name: 'stuff/__MACOSX/._Hat.png', bytes: new Uint8Array(3) }, { name: 'stuff/Bow.png', bytes: new Uint8Array(40) }]);
  const r2 = await installCharacters([new File([other], 'chars.zip', { type: 'application/zip' })], to);
  assert.deepEqual(r2.names, ['Bow']);
});

test('lining a Character\'s face up on a face: the fit recovers scale and turn; its eyes land on the eyes', async () => {
  const { similarityFit, throughFit, alignOnFace, faceFrom } = await import('../web/lib/face-core.js');
  // A known similarity: ×2.5, turned 30°, shifted.
  const truth = { s: 2.5, rot: Math.PI / 6, tx: 40, ty: -12 };
  const from = [[10, 20], [60, 25], [35, 80]];
  const to = from.map((p) => throughFit(truth, p));
  const m = similarityFit(from, to);
  assert.ok(Math.abs(m.s - 2.5) < 1e-9 && Math.abs(m.rot - Math.PI / 6) < 1e-9 && Math.abs(m.tx - 40) < 1e-6 && Math.abs(m.ty + 12) < 1e-6);
  // A Character (200×240) with its eyes at (70, 100), (130, 100), mouth (100, 170); a face in a 800×600
  // photo, smaller and tilted.
  const face = (eyeA, eyeB, mouth, w, h) => {
    const pts = Array.from({ length: 68 }, () => mouth);
    for (let i = 36; i < 42; i++) pts[i] = eyeA;
    for (let i = 42; i < 48; i++) pts[i] = eyeB;
    for (let i = 48; i < 68; i++) pts[i] = mouth;
    return faceFrom({ x: 0, y: 0, width: 10, height: 10 }, pts, w, h);
  };
  const own = face([70, 100], [130, 100], [100, 170], 200, 240);
  const target = face([400, 300], [436, 279], [432, 345], 800, 600);
  const a = alignOnFace(own, 200, 240, target, 800, 600);
  // Where the Character's eyes go, placed like that.
  const at = ([px, py]) => { const c = Math.cos(a.rot); const s = Math.sin(a.rot); const k = a.width / 200; const dx = (px - 100) * k; const dy = (py - 120) * k; return [a.x + dx * c - dy * s, a.y + dx * s + dy * c]; };
  const eyeA = at([70, 100]); const eyeB = at([130, 100]);
  assert.ok(Math.hypot(eyeA[0] - 400, eyeA[1] - 300) < 4 && Math.hypot(eyeB[0] - 436, eyeB[1] - 279) < 4, `eyes on the eyes: ${eyeA.map(Math.round)} ${eyeB.map(Math.round)}`);
  assert.ok(Math.abs(a.rot - Math.atan2(-21, 36)) < 0.05, 'turned with the face');
  assert.ok(a.width > 100 && a.width < 160, `sized to the face (${a.width.toFixed(0)} px wide)`);
});
