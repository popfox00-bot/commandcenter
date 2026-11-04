// FaceMask's fitted Insert Character (web/tools/editor/facefit.js): the moving-least-squares bend,
// the fit onto a face's landmarks (jaw too, not just the eyes), the trim to the head, and the seamless
// blend that matches each side of the Character to what's next to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mlsMap, fitPatch, blendIn, shadeMatch, bestPlacement, CONTROL } from '../web/tools/editor/facefit.js';
import { faceFrom, faceContour } from '../web/lib/face-core.js';

/** 68 landmarks (iBUG layout) for a face centred at (cx, cy), `s` its scale, `chin` how far its jaw reaches out. */
function landmarks(cx, cy, s, chin = 1) {
  const p = [];
  for (let i = 0; i <= 16; i++) { const a = Math.PI * (i / 16); p.push([cx - Math.cos(a) * 48 * s * chin, cy + Math.sin(a) * 50 * s * chin - 5 * s]); } // jaw 0-16
  for (let i = 0; i < 5; i++) p.push([cx - 38 * s + i * 7 * s, cy - 30 * s]); // brow 17-21
  for (let i = 0; i < 5; i++) p.push([cx + 10 * s + i * 7 * s, cy - 30 * s]); // brow 22-26
  for (let i = 0; i < 4; i++) p.push([cx, cy - 20 * s + i * 7 * s]); // nose bridge 27-30
  for (let i = 0; i < 5; i++) p.push([cx - 10 * s + i * 5 * s, cy + 10 * s]); // nostrils 31-35
  const eye = (ex) => [[ex - 9 * s, cy - 15 * s], [ex - 4 * s, cy - 18 * s], [ex + 4 * s, cy - 18 * s], [ex + 9 * s, cy - 15 * s], [ex + 4 * s, cy - 12 * s], [ex - 4 * s, cy - 12 * s]];
  p.push(...eye(cx - 20 * s), ...eye(cx + 20 * s)); // eyes 36-47
  for (let i = 0; i < 20; i++) { const a = (i / 20) * 2 * Math.PI; p.push([cx + Math.cos(a) * 15 * s, cy + 25 * s + Math.sin(a) * 6 * s]); } // mouth 48-67
  return p;
}
const faceAt = (pts, w, h) => faceFrom({ x: Math.min(...pts.map((q) => q[0])), y: Math.min(...pts.map((q) => q[1])) - 20, width: Math.max(...pts.map((q) => q[0])) - Math.min(...pts.map((q) => q[0])), height: Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1])) + 20 }, pts, w, h);

test('the bend: control points land exactly; a plain scale-and-turn stays one everywhere', () => {
  const from = [[10, 10], [90, 15], [50, 80], [20, 60]];
  const m = mlsMap(from, from);
  assert.deepEqual(m(33, 44).map((v) => Math.round(v * 1e6) / 1e6), [33, 44]);
  // ×2, turned 90°: (x, y) → (-2y, 2x) + (100, 0).
  const to = from.map(([x, y]) => [100 - 2 * y, 2 * x]);
  const m2 = mlsMap(from, to);
  for (const [x, y] of [[10, 10], [50, 80], [40, 40], [70, 20]]) {
    const [u, v] = m2(x, y);
    assert.ok(Math.abs(u - (100 - 2 * y)) < 1e-6 && Math.abs(v - 2 * x) < 1e-6, `${x},${y} → ${u},${v}`);
  }
});

test('fitted onto a face: its eyes on the eyes and its jaw on the jaw (a wider chin), trimmed to the head', () => {
  // The Character: 120×120, each pixel's color telling where it is (red = x × 2, green = y × 2).
  const cw = 120; const ch = 120;
  const img = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) img.set([x * 2, y * 2, 0, 255], (y * cw + x) * 4);
  const cPts = landmarks(60, 55, 0.9);
  const own = faceAt(cPts, cw, ch);
  // The face in a 400×300 photo: bigger, and its jaw wider than the Character's.
  const W = 400; const H = 300;
  const tPts = landmarks(200, 150, 1.4, 1.12);
  const face = faceAt(tPts, W, H);
  const p = fitPatch(img, cw, ch, own, face, W, H, { trim: true });
  const at = ([x, y]) => { const o = ((Math.round(y) - p.y0) * p.pw + Math.round(x) - p.x0) * 4; return [p.rgba[o] / 2, p.rgba[o + 1] / 2, p.rgba[o + 3]]; };
  // Each control point of the face shows the matching point of the Character (within a couple of px).
  // (The jaw is the face's own outline, so it's on the soft edge of the trim; the rest well inside.)
  for (const i of [36, 45, 48, 54, 30, 4, 8, 12]) {
    const [u, v, a] = at(tPts[i]);
    const jaw = i <= 16;
    assert.ok(a > (jaw ? 40 : 200) && Math.hypot(u - cPts[i][0], v - cPts[i][1]) < 2.5, `landmark ${i}: shows ${u.toFixed(1)},${v.toFixed(1)} of the Character (alpha ${a}), its ${cPts[i].map((n) => n.toFixed(1))}`);
  }
  // Beyond the face's own outline (below the chin, out past the cheek, the hair above the forehead): trimmed away.
  for (const q of [[tPts[8][0], tPts[8][1] + 14], [tPts[0][0] - 14, tPts[0][1]], [200, tPts[19][1] - 40]]) assert.ok(at(q)[2] < 10, `trimmed at ${q.map(Math.round)}: alpha ${at(q)[2]}`);
  assert.equal(at([p.x0 + 1, p.y0 + 1])[2], 0);
  assert.ok(at([200, 150])[2] > 240);
  // Placed by all its landmarks before the bend: about the right size for the whole face.
  const b = bestPlacement(own, cw, ch, face, W, H);
  assert.ok(b.width / cw > 1.4 && b.width / cw < 1.75, `sized to the face: ×${(b.width / cw).toFixed(2)}`);
  assert.ok(CONTROL.length > 20, 'more than the eyes: jaw, brows, nose and mouth too');
});

test('blended in: each side of it takes on what\'s next to it there (not one tint for all), its detail kept', () => {
  // A photo blue at the top fading to red at the bottom; a flat gray patch in the middle of it.
  const W = 60; const H = 60;
  const photo = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) photo.set([(y / (H - 1)) * 220, 30, (1 - y / (H - 1)) * 220, 255], (y * W + x) * 4);
  const pw = 20; const ph = 20;
  const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (let i = 0; i < pw * ph; i++) rgba.set([128, 128, 128, 255], i * 4);
  rgba.set([200, 200, 200, 255], (10 * pw + 10) * 4); // a speck of its own detail
  const patch = { x0: 20, y0: 20, pw, ph, rgba };
  blendIn(patch, photo, W, H, 1, { soft: 0 });
  const px = (x, y) => [...rgba.subarray((y * pw + x) * 4, (y * pw + x) * 4 + 3)];
  const top = px(10, 0); const bottom = px(10, ph - 1);
  const ph0 = [...photo.subarray((19 * W + 30) * 4, (19 * W + 30) * 4 + 3)]; const ph1 = [...photo.subarray((40 * W + 30) * 4, (40 * W + 30) * 4 + 3)];
  assert.ok(Math.abs(top[2] - ph0[2]) < 20 && Math.abs(top[0] - ph0[0]) < 20, `the top meets the blue above it: ${top} vs ${ph0}`);
  assert.ok(Math.abs(bottom[0] - ph1[0]) < 20 && Math.abs(bottom[2] - ph1[2]) < 20, `the bottom meets the red below it: ${bottom} vs ${ph1}`);
  assert.ok(top[2] - bottom[2] > 80, 'top and bottom adjusted differently');
  const speck = px(10, 10); const round = px(12, 10);
  assert.ok(speck[0] - round[0] > 50, 'its own detail stays');
  // Strength 0: as it was (but for a soft edge).
  const flat = { x0: 20, y0: 20, pw, ph, rgba: new Uint8ClampedArray(pw * ph * 4).fill(128) };
  blendIn(flat, photo, W, H, 0, { soft: 0 });
  assert.ok([...flat.rgba].every((v) => v === 128));
});

test('blended with a soft edge: every color moves toward the photo around it (the softened rim doesn\'t count as dark)', () => {
  const W = 200; const H = 200; const photo = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) photo.set([201, 160, 122, 255], i * 4);
  const pw = 90; const ph = 100; const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) if (((x - 45) / 42) ** 2 + ((y - 50) / 48) ** 2 <= 1) rgba.set([30, 200, 40, 255], (y * pw + x) * 4);
  blendIn({ x0: 50, y0: 50, pw, ph, rgba }, photo, W, H, 0.8, { soft: 2 });
  for (const [x, y] of [[45, 50], [45, 8], [6, 50]]) {
    const [r, g, b] = rgba.subarray((y * pw + x) * 4, (y * pw + x) * 4 + 3);
    assert.ok(r > 80 && g < 195 && b > 60, `toward the tan around it at ${x},${y}: ${r},${g},${b}`);
  }
  // The softened rim keeps the color of the edge it came from (no dark ring).
  let dark = 0; for (let i = 0; i < pw * ph; i++) if (rgba[i * 4 + 3] > 20 && rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2] < 150) dark++;
  assert.equal(dark, 0);
});

test('the face\'s own outline: jaw from ear to ear and a forehead line just above the brows (no hair); null for a sliver', () => {
  const W = 400; const H = 300;
  const pts = landmarks(200, 150, 1.4);
  const face = faceAt(pts, W, H);
  const c = faceContour(face, W, H);
  assert.equal(c.length, 17 + 10);
  const inside = ([x, y]) => { let k = false; for (let i = 0, j = c.length - 1; i < c.length; j = i++) { const [xi, yi] = c[i]; const [xj, yj] = c[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) k = !k; } return k; };
  for (const i of [30, 36, 45, 48, 54]) assert.ok(inside(pts[i]), `landmark ${i} inside`);
  const browY = (pts[19][1] + pts[24][1]) / 2;
  assert.ok(inside([200, browY - 8]), 'some forehead');
  assert.ok(!inside([200, browY - 60]), 'not the hair above it');
  assert.ok(!inside([pts[0][0] - 10, pts[0][1]]), 'not past the cheek (the ear)');
  // A detection whose points are all in one place: no outline (callers use the head's oval).
  const flat = faceFrom({ x: 100, y: 100, width: 100, height: 100 }, Array.from({ length: 68 }, () => [150, 150]), W, H);
  assert.equal(faceContour(flat, W, H), null);
});

test('the light across the face: the photo face\'s shading (lit from the left) carried onto the Character\'s face, its detail kept', () => {
  const W = 400; const H = 300;
  const pts = landmarks(200, 150, 1.4);
  const face = faceAt(pts, W, H);
  // The photo: the face lit from the left (bright) to the right (dark).
  const photo = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = 230 - ((x - 120) / 160) * 150; photo.set([v, v * 0.8, v * 0.7, 255], (y * W + x) * 4); }
  // The Character's face: evenly lit, with a dark mark.
  const x0 = 110; const y0 = 60; const pw = 180; const ph = 200;
  const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (let i = 0; i < pw * ph; i++) rgba.set([150, 120, 100, 255], i * 4);
  for (let y = 98; y < 102; y++) for (let x = 88; x < 92; x++) rgba.set([40, 30, 20, 255], (y * pw + x) * 4);
  shadeMatch({ x0, y0, pw, ph, rgba }, photo, W, H, face, 1);
  const px = (x, y) => [...rgba.subarray(((y - y0) * pw + x - x0) * 4, ((y - y0) * pw + x - x0) * 4 + 3)];
  const left = px(160, 150); const right = px(240, 150);
  assert.ok(left[0] - right[0] > 40, `lit from the left like the photo: ${left} vs ${right}`);
  assert.ok(px(200, 160)[0] < px(206, 160)[0] - 40, 'its own dark mark stays');
  // Strength 0: unchanged.
  const same = new Uint8ClampedArray(pw * ph * 4).fill(100);
  shadeMatch({ x0, y0, pw, ph, rgba: same }, photo, W, H, face, 0);
  assert.ok([...same].every((v) => v === 100));
});
