// FaceMask's fitted Insert Character (web/tools/editor/facefit.js): the moving-least-squares bend,
// the fit onto a face's landmarks (jaw too, not just the eyes), the trim to the head, and the seamless
// blend that matches each side of the Character to what's next to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mlsMap, fitPatch, blendIn, recolor, targetOutline, bestPlacement, CONTROL, mirrorFace, mirrorPixels, faceYaw, shouldFlip } from '../web/tools/editor/facefit.js';
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
  const p = fitPatch(img, cw, ch, own, face, W, H, { trim: true, bend: 1 });
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

test('kept as it is: with the usual light bend its features keep their own proportions (placed by them, not reshaped)', () => {
  const cw = 120; const ch = 120;
  const img = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) img.set([x * 2, y * 2, 0, 255], (y * cw + x) * 4);
  const cPts = landmarks(60, 55, 0.9);
  const own = faceAt(cPts, cw, ch);
  const W = 400; const H = 300;
  const tPts = landmarks(200, 150, 1.4, 1.2); // a much wider jaw
  const face = faceAt(tPts, W, H);
  const rigid = fitPatch(img, cw, ch, own, face, W, H, { trim: false, bend: 0 });
  const light = fitPatch(img, cw, ch, own, face, W, H, { trim: false });
  const read = (p, [x, y]) => { const o = ((Math.round(y) - p.y0) * p.pw + Math.round(x) - p.x0) * 4; return [p.rgba[o] / 2, p.rgba[o + 1] / 2]; };
  // Rigid: the Character's eye spacing scaled evenly; its eyes and mouth keep their relative places.
  const b = bestPlacement(own, cw, ch, face, W, H); const k = b.width / cw;
  const eyeL = read(rigid, tPts[36]); const eyeR = read(rigid, tPts[45]);
  assert.ok(Math.abs(Math.hypot(eyeR[0] - eyeL[0], eyeR[1] - eyeL[1]) * k - Math.hypot(tPts[45][0] - tPts[36][0], tPts[45][1] - tPts[36][1])) < 8, 'eye spacing as the face has it, by an even scale');
  // The light bend moves the jaw a little toward the new one, the middle of the face hardly at all.
  const midR = read(rigid, tPts[30]); const midL = read(light, tPts[30]);
  const jawR = read(rigid, tPts[4]); const jawL = read(light, tPts[4]);
  assert.ok(Math.hypot(midR[0] - midL[0], midR[1] - midL[1]) < 2, 'the nose: kept');
  assert.ok(Math.hypot(jawR[0] - jawL[0], jawR[1] - jawL[1]) > Math.hypot(midR[0] - midL[0], midR[1] - midL[1]), 'the jaw: bent a little');
});

test('the face\'s outline in the photo: the jaw, then up to where the hair starts (found in the photo)', () => {
  const W = 400; const H = 300;
  const pts = landmarks(200, 150, 1.4);
  const face = faceAt(pts, W, H);
  // Skin from y 70 down; hair above it (the hairline 38 px above the brows at y 108).
  const photo = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) photo.set(y < 70 ? [60, 40, 25, 255] : [225, 180, 150, 255], (y * W + x) * 4);
  const out = targetOutline(photo, W, H, face);
  assert.equal(out.length, 17 + 10);
  const top = out.slice(17);
  for (const [, y] of top) assert.ok(y > 66 && y < 78, `the hairline at y ${y.toFixed(1)} (hair from 70)`);
  // No hair to find: a forehead's usual height above the brows.
  const bald = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) bald.set([225, 180, 150, 255], i * 4);
  const tops = targetOutline(bald, W, H, face).slice(17).map((p) => p[1]);
  assert.ok(Math.min(...tops) > 40 && Math.max(...tops) < 108, `a usual forehead: ${tops.map(Math.round)}`);
});

test('recolored to the face it\'s on (the same way all over, its own shading kept); blended only at the border', () => {
  const W = 200; const H = 200;
  const photo = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) photo.set([200, 150, 120, 255], i * 4);
  const outline = [[40, 40], [160, 40], [160, 160], [40, 160]];
  const pw = 120; const ph = 120;
  const make = () => { const r = new Uint8ClampedArray(pw * ph * 4); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) r.set([120 + (x > 60 ? 40 : 0), 110, 140, 255], (y * pw + x) * 4); return r; };
  const rgba = make();
  recolor({ x0: 40, y0: 40, pw, ph, rgba }, photo, W, H, outline, 1);
  const L = [...rgba.subarray((60 * pw + 20) * 4, (60 * pw + 20) * 4 + 3)]; const R = [...rgba.subarray((60 * pw + 100) * 4, (60 * pw + 100) * 4 + 3)];
  assert.ok(L[0] > 150 && L[2] < 140, `warmed toward the face's skin: ${L}`);
  assert.ok(R[0] > L[0] + 10, 'its own light/dark difference kept');
  // Border only: deep inside, unchanged; at the edge, moved.
  const flat = new Uint8ClampedArray(pw * ph * 4); for (let i = 0; i < pw * ph; i++) flat.set([100, 100, 100, 255], i * 4);
  const patch = { x0: 40, y0: 40, pw, ph, rgba: flat };
  blendIn(patch, photo, W, H, 1, { soft: 0, band: 12 });
  const mid = [...flat.subarray((60 * pw + 60) * 4, (60 * pw + 60) * 4 + 3)]; const edge = [...flat.subarray((60 * pw + 1) * 4, (60 * pw + 1) * 4 + 3)];
  assert.deepEqual(mid, [100, 100, 100], 'the middle exactly as it was');
  assert.ok(edge[0] > 150, `the border blended: ${edge}`);
});

test('flipped: a face mirrored left to right (each landmark in its mirror\'s place), so it looks the other way', () => {
  const W = 200; const H = 200;
  // Looking to one side: the nose tip pushed toward one ear.
  const pts = landmarks(100, 100, 1); for (const i of [27, 28, 29, 30, 31, 32, 33, 34, 35]) pts[i][0] += 14;
  const face = faceAt(pts, W, H);
  const m = mirrorFace(face);
  assert.ok(faceYaw(face, W, H) > 0.1 && Math.abs(faceYaw(m, W, H) + faceYaw(face, W, H)) < 1e-9, 'it looks the other way, as far');
  assert.ok(Math.abs(m.pts[0][0] - (1 - face.pts[16][0])) < 1e-12 && Math.abs(m.pts[36][0] - (1 - face.pts[45][0])) < 1e-12, 'its left jaw and eye are the old right ones, mirrored');
  assert.ok(m.pts[36][0] < m.pts[45][0] && m.eyes[0][0] < m.eyes[1][0], 'its eyes in the usual order');
  const back = mirrorFace(m);
  assert.ok(back.pts.every((p, i) => Math.hypot(p[0] - face.pts[i][0], p[1] - face.pts[i][1]) < 1e-12), 'flipped twice: as it was');
  // A Character looking the other way from the face is flipped; one looking the same way (or straight on) isn't.
  assert.equal(shouldFlip(m, W, H, face, W, H), true);
  assert.equal(shouldFlip(face, W, H, face, W, H), false);
  assert.equal(shouldFlip(faceAt(landmarks(100, 100, 1), W, H), W, H, face, W, H), false);
  const px = mirrorPixels({ rgba: Uint8ClampedArray.from([1, 2, 3, 4, 5, 6, 7, 8]), w: 2, h: 1 });
  assert.deepEqual([...px.rgba], [5, 6, 7, 8, 1, 2, 3, 4]);
});

test('blended both ways: the face it goes on, where the Character doesn\'t reach (up to the hairline), takes on its colors too, easing out', () => {
  const W = 200; const H = 200;
  // The photo: pale skin (with hair outside the face's outline); the Character, darker, covering only the lower part of the face.
  const photo = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) photo.set([230, 200, 190, 255], i * 4);
  const outline = [[40, 30], [160, 30], [160, 170], [40, 170]];
  const pw = 200; const ph = 200;
  const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 90; y < 170; y++) for (let x = 40; x < 160; x++) rgba.set([150, 110, 90, 255], (y * pw + x) * 4);
  blendIn({ x0: 0, y0: 0, pw, ph, rgba }, photo, W, H, 1, { soft: 0, band: 10, region: outline, spread: 60 });
  const px = (x, y) => [...rgba.subarray((y * pw + x) * 4, (y * pw + x) * 4 + 4)];
  const just = px(100, 86); const edge = px(100, 91); const top = px(100, 40); const away = px(5, 5);
  assert.ok(just[3] === 255 && just[0] < 215, `the old forehead just above it toned toward it: ${just}`);
  assert.ok(Math.abs(just[0] - edge[0]) < 25, `they meet with no step: ${just} / ${edge}`);
  assert.ok(top[0] > just[0], `easing back to the photo further up: ${top}`);
  assert.equal(away[3], 0, 'outside the face, the photo left alone');
  assert.ok(px(100, 140)[0] < 170, 'its middle still its own');
});
