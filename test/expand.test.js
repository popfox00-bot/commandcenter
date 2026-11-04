// Generative Expand (web/tools/editor/expand.js): the new shape and where the photo sits in it, the
// photo kept exactly, and the new space filled from it so a horizon carries on, a darkening sky keeps
// going, and nothing is left black.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandLayout, placeOn, expandFill, quiltGuess, resample } from '../web/tools/editor/expand.js';

const noise = (x, y, k) => ((((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 1000) / 1000;
/** A landscape: a sky darkening upward, a sun, rolling grassy hills. Returns { px, horizon(x) }. */
function landscape(w, h) {
  const horizon = (x) => h * 0.55 + Math.sin((x / w) * 6) * h * 0.06;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c;
    if (y < horizon(x)) { const t = y / horizon(x); c = [90 + 80 * t, 150 + 60 * t, 235 - 10 * t]; if (Math.hypot(x - w * 0.3, y - h * 0.2) < h * 0.08) c = [255, 240, 200]; } else { const g = noise(x >> 1, y >> 1, 1); c = [50 + 40 * g, 110 + 50 * g, 40 + 20 * g]; }
    px.set([...c, 255], (y * w + x) * 4);
  }
  return { px, horizon };
}
const isGrass = (a, o) => a[o + 1] > a[o + 2] + 20;
/** The first grass row in column x. */
const horizonAt = (a, W, H, x) => { for (let y = 0; y < H; y++) if (isGrass(a, (y * W + x) * 4)) return y; return H; };

test('the new shape: wider or taller, the photo at its own size on the side picked', () => {
  assert.deepEqual(expandLayout(400, 300, 16 / 9, 'start'), { W: 533, H: 300, ox: 0, oy: 0, axis: 'x' });
  assert.deepEqual(expandLayout(400, 300, 16 / 9, 'end'), { W: 533, H: 300, ox: 133, oy: 0, axis: 'x' });
  assert.deepEqual(expandLayout(400, 300, 16 / 9, 'center'), { W: 533, H: 300, ox: 67, oy: 0, axis: 'x' });
  assert.deepEqual(expandLayout(400, 300, 9 / 16, 'start'), { W: 400, H: 711, ox: 0, oy: 0, axis: 'y' });
  assert.deepEqual(expandLayout(400, 300, 9 / 16, 'end'), { W: 400, H: 711, ox: 0, oy: 411, axis: 'y' });
  assert.equal(expandLayout(400, 300, 4 / 3), null, 'already that shape');
  assert.equal(expandLayout(400, 300, 0), null);
  // The preview: the photo where it goes, the rest black.
  const p = placeOn(new Uint8ClampedArray(4 * 4 * 4).fill(200), 4, 4, { W: 6, H: 4, ox: 2, oy: 0 });
  assert.deepEqual([...p.subarray(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...p.subarray(8, 12)], [200, 200, 200, 200]);
});

test('sideways: the photo kept exactly, the hills carried on past the seam (no step), nothing black', () => {
  const w = 200; const h = 150;
  const { px } = landscape(w, h);
  const L = expandLayout(w, h, 16 / 9, 'start');
  const out = expandFill(px, w, h, L);
  for (let y = 0; y < h; y += 7) for (let x = 0; x < w; x += 7) for (let c = 0; c < 3; c++) assert.equal(out[(y * L.W + x) * 4 + c], px[(y * w + x) * 4 + c]);
  let dark = 0;
  for (let y = 0; y < L.H; y++) for (let x = w; x < L.W; x++) { const o = (y * L.W + x) * 4; if (out[o] + out[o + 1] + out[o + 2] < 90) dark++; }
  assert.equal(dark, 0, 'no black left');
  // The horizon at the seam carries straight on, and the fill below it is grass, above it sky.
  const meanH = (x0, x1) => { let s = 0; for (let x = x0; x < x1; x++) s += horizonAt(out, L.W, L.H, x); return s / (x1 - x0); };
  const before = meanH(w - 6, w); const after = meanH(w, w + 6);
  assert.ok(Math.abs(after - before) <= 3, `no step at the seam: ${after.toFixed(1)} vs ${before.toFixed(1)}`);
  // And it keeps going: farther out, the hills are still about where they were (not jumped to the top or bottom).
  assert.ok(Math.abs(meanH(L.W - 10, L.W) - before) < h * 0.2);
  assert.ok(isGrass(out, ((h - 5) * L.W + L.W - 5) * 4) && !isGrass(out, (10 * L.W + L.W - 5) * 4));
});

test('upward: a sky that darkens toward the top keeps going (no lighter band, no seam); the photo kept', () => {
  const w = 120; const h = 90;
  const { px } = landscape(w, h);
  const L = expandLayout(w, h, 3 / 4, 'end'); // the photo at the bottom, new sky above
  assert.equal(L.axis, 'y');
  const out = expandFill(px, w, h, L);
  for (let x = 0; x < w; x += 5) for (let c = 0; c < 3; c++) assert.equal(out[((L.oy + 3) * w + x) * 4 + c], px[(3 * w + x) * 4 + c]);
  const rowMean = (img, y) => { let s = 0; for (let x = 0; x < w; x++) s += img[(y * w + x) * 4]; return s / w; };
  // Just above the seam matches the photo's top row (within a little); far up is no lighter.
  const top = rowMean(px, 0);
  assert.ok(Math.abs(rowMean(out, L.oy - 2) - top) < 8, `seam: ${rowMean(out, L.oy - 2)} vs ${top}`);
  assert.ok(rowMean(out, 2) <= top + 6, `the top of the new sky (${rowMean(out, 2)}) no lighter than the photo's (${top})`);
  // No sun copied into the new sky (it's plain sky up there).
  let sun = 0; for (let y = 0; y < L.oy; y++) for (let x = 0; x < w; x++) if (out[(y * w + x) * 4] > 230 && out[(y * w + x) * 4 + 2] < 215) sun++;
  assert.ok(sun < 20, `${sun} sun pixels in the new sky`);
});

test('a big photo is filled at a working size, then refined up; centered, both sides filled', () => {
  const w = 600; const h = 450;
  const { px } = landscape(w, h);
  const L = expandLayout(w, h, 2, 'center');
  const steps = [];
  const out = expandFill(px, w, h, L, { onProgress: (p) => steps.push(p) });
  assert.equal(out.length, L.W * L.H * 4);
  assert.ok(steps.length >= 2 && steps.at(-1) === 1, 'progress reported');
  for (const x of [5, L.W - 5]) { assert.ok(isGrass(out, ((L.H - 10) * L.W + x) * 4), `grass at the bottom, x ${x}`); assert.ok(!isGrass(out, (20 * L.W + x) * 4), `sky at the top, x ${x}`); }
  for (let y = 0; y < h; y += 11) for (let x = 0; x < w; x += 13) assert.equal(out[(y * L.W + x + L.ox) * 4 + 1], px[(y * w + x) * 4 + 1]);
});

test('the first guess: the photo carried on from its seam; resampling keeps flat color flat', () => {
  const w = 60; const h = 40;
  const { px } = landscape(w, h);
  const L = expandLayout(w, h, 2, 'start');
  const g = quiltGuess(px, w, h, L);
  assert.equal(g.length, L.W * L.H * 4);
  const atSeam = horizonAt(g, L.W, L.H, w - 1);
  assert.ok(Math.abs(horizonAt(g, L.W, L.H, w + 1) - atSeam) <= 2);
  const flat = new Uint8ClampedArray(10 * 10 * 4).fill(120);
  assert.ok([...resample(flat, 10, 10, 23, 7)].every((v) => v === 120));
  assert.ok([...resample(flat, 10, 10, 3, 4)].every((v) => v === 120));
});
