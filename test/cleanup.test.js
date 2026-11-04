// Clean Up (web/tools/editor/cleanup.js): what a stroke means (tap, brush, circle around), the area it
// covers, filling it in from the picture around it, and Copy From Area (a copy blended in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strokeShape, strokeMask, cleanUp, cloneFrom, shadeMask, reverseFill, sampleShade, toLab, surfaceOf } from '../web/tools/editor/cleanup.js';

const noise = (x, y, k) => ((((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 1000) / 1000;
function scene(w, h, paint) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([...paint(x, y), 255], (y * w + x) * 4);
  return px;
}
const circle = (cx, cy, r, n = 24) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
const count = (m) => m.reduce((s, v) => s + v, 0);
/** The picture with a patch painted on (as applyPatches does, by its coverage). */
function painted(px, w, p) {
  const out = Uint8ClampedArray.from(px);
  for (let y = 0; y < p.ph; y++) for (let x = 0; x < p.pw; x++) {
    const s = (y * p.pw + x) * 4; const a = p.rgba[s + 3] / 255; if (!a) continue;
    const o = ((p.y0 + y) * w + p.x0 + x) * 4;
    for (let c = 0; c < 3; c++) out[o + c] = out[o + c] * (1 - a) + p.rgba[s + c] * a;
  }
  return out;
}

test('a stroke is a tap, a brushed line, or a circle drawn around something', () => {
  assert.equal(strokeShape([[50, 50]], 10), 'tap');
  assert.equal(strokeShape([[50, 50], [52, 51], [53, 50]], 10), 'tap', 'a wobble is still a tap');
  assert.equal(strokeShape([[10, 50], [60, 50], [110, 52], [160, 50]], 10), 'brush');
  assert.equal(strokeShape(circle(100, 100, 50), 10), 'lasso');
  // Not quite closed, but nearly: still around it.
  assert.equal(strokeShape(circle(100, 100, 50).slice(0, 22), 10), 'lasso');
  // A U shape: the ends are far apart.
  assert.equal(strokeShape([[20, 20], [20, 120], [120, 120], [120, 20]], 8), 'brush');
});

test('the area: a dot, a line as wide as the brush, or everything inside the circle (and its line)', () => {
  const w = 200; const h = 200;
  const dot = strokeMask([[100, 100]], 10, w, h);
  assert.ok(Math.abs(count(dot.mask) - Math.PI * 100) < 40);
  const line = strokeMask([[20, 100], [180, 100]], 5, w, h);
  assert.equal(line.shape, 'brush');
  assert.ok(count(line.mask) > 160 * 9 && count(line.mask) < 172 * 11, `about 10 px wide (${count(line.mask)})`);
  assert.equal(line.mask[50 * w + 100], 0);
  const ring = strokeMask(circle(100, 100, 60), 4, w, h);
  assert.equal(ring.shape, 'lasso');
  assert.equal(ring.mask[100 * w + 100], 1, 'the inside');
  assert.equal(ring.mask[100 * w + 162], 1, 'the line itself');
  assert.equal(ring.mask[100 * w + 170], 0, 'not beyond it');
  assert.deepEqual([ring.box.x0 <= 37, ring.box.x1 >= 163], [true, true]);
});

test('clean up: a red box on a striped, grainy wall is gone, the stripes carried through it', () => {
  const w = 160; const h = 120;
  const wall = (x, y) => (Math.floor(y / 10) % 2 ? [200, 190, 170] : [120, 110, 100]).map((v, c) => v + 20 * noise(x, y, c) - 10);
  const box = (x, y) => x >= 64 && x < 96 && y >= 44 && y < 76;
  const px = scene(w, h, (x, y) => (box(x, y) ? [220, 30, 30] : wall(x, y)));
  const { mask, box: b } = strokeMask(circle(80, 60, 26), 4, w, h);
  const out = painted(px, w, cleanUp(px, w, h, mask, b));
  let red = 0; let off = 0; let n = 0;
  for (let y = 44; y < 76; y++) for (let x = 64; x < 96; x++) {
    const o = (y * w + x) * 4;
    if (out[o] > 180 && out[o + 1] < 80) red++;
    // Each row should look like its stripe: light rows light, dark rows dark.
    const want = Math.floor(y / 10) % 2 ? 190 : 110; const lum = (out[o] + out[o + 1] + out[o + 2]) / 3;
    if (Math.abs(lum - want) > 35) off++;
    n++;
  }
  assert.equal(red, 0, 'no red left');
  assert.ok(off < n * 0.15, `the stripes run through (${off} of ${n} pixels off)`);
  // Outside the area, nothing changes.
  for (const [x, y] of [[10, 10], [150, 110], [40, 60]]) assert.deepEqual([...out.slice((y * w + x) * 4, (y * w + x) * 4 + 3)], [...px.slice((y * w + x) * 4, (y * w + x) * 4 + 3)]);
});

test('copy from area: the area becomes a copy of the spot picked, its edge blended into the light around it', () => {
  const w = 200; const h = 120;
  // A checkered tile pattern on the left half, plain sand on the right, with a lighting gradient
  // across; a black blot on the sand.
  const light = (x) => x * 0.25;
  const px = scene(w, h, (x, y) => {
    if (Math.hypot(x - 150, y - 60) < 15) return [10, 10, 10];
    if (x < 100) return (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? [60 + light(x), 60 + light(x), 60 + light(x)] : [180 + light(x), 180 + light(x), 180 + light(x)];
    return [190 + light(x) * 0.2, 170 + light(x) * 0.2, 130];
  });
  const { mask, box } = strokeMask([[150, 60]], 18, w, h);
  // Copy the sand from 30 px above... (not much of a test of texture, but of the blend: the copy is sand)
  const sand = cloneFrom(px, w, h, mask, box, 0, -38);
  const out = painted(px, w, sand);
  const o = (60 * w + 150) * 4;
  assert.ok(Math.abs(out[o] - px[(20 * w + 150) * 4]) < 6 && out[o + 2] > 110, `the blot is sand now (${[...out.slice(o, o + 3)]})`);
  // Copy the tiles: the pattern comes across one to one (shifted), its brightness eased toward the sand
  // only gradually, so the checks stay as crisp as the original.
  const tiles = cloneFrom(px, w, h, mask, box, -100, 0);
  const t = painted(px, w, tiles);
  const contrast = (img, x0) => { let lo = 255; let hi = 0; for (let x = x0 - 6; x <= x0 + 6; x++) { const v = img[(60 * w + x) * 4]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
  assert.ok(contrast(t, 150) > 80, `the checks are copied, crisp (${contrast(t, 150)})`);
  assert.equal(cloneFrom(px, w, h, mask, box, 120, 0), null, 'a copy from outside the picture: nothing');
});

// A blue can with a white and red label (black print on it) in front of a striped green wall, and a
// white tile on the wall outside the trace.
function canScene(w = 160, h = 160) {
  const can = (x, y) => [30 + 20 * (x - 40) / 80 + noise(x, y, 1) * 14, 60 + noise(x, y, 2) * 14, 170 + 30 * Math.sin(((x - 40) / 80) * Math.PI) + noise(x, y, 3) * 14];
  const paint = (x, y) => {
    if (x < 40 || x >= 120) return x >= 4 && x < 16 && y >= 70 && y < 82 ? [245, 245, 245] : (Math.floor(y / 6) % 2 ? [70, 120, 60] : [95, 140, 80]).map((v, c) => v + noise(x, y, c) * 10);
    if (y >= 60 && y < 100) {
      if ((x >= 60 && x < 64 && y >= 72 && y < 86) || (x >= 90 && x < 98 && y >= 76 && y < 80)) return [20, 20, 20]; // print
      return y < 70 || y >= 92 ? [200 + noise(x, y, 4) * 20, 30, 35] : [238 + noise(x, y, 5) * 12, 238, 232];
    }
    return can(x, y);
  };
  return { px: scene(w, h, paint), can, w, h };
}

test('Reverse Fill: the picked shades inside the trace (and the print they close around) are found, nothing outside it', () => {
  const { px, w, h } = canScene();
  const trace = strokeMask([[30, 50], [130, 50], [130, 110], [30, 110], [30, 52]], 2, w, h);
  assert.equal(trace.shape, 'lasso');
  const white = sampleShade(px, w, h, 80, 80); const red = sampleShade(px, w, h, 80, 64);
  assert.ok(white[0] > 230 && red[0] > 190 && red[1] < 50, 'the shades sampled');
  const m = shadeMask(px, w, h, trace.mask, trace.box, [white, red], 18);
  let label = 0; let labelIn = 0; let other = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const onLabel = x >= 40 && x < 120 && y >= 60 && y < 100;
    if (onLabel) { label++; if (m.mask[y * w + x]) labelIn++; } else if (m.mask[y * w + x] && !(Math.abs(x - 40) <= 1 || Math.abs(x - 119) <= 1 || Math.abs(y - 60) <= 1 || Math.abs(y - 99) <= 1)) other++;
  }
  assert.ok(labelIn / label > 0.99, `the whole label, its print too (${labelIn}/${label})`);
  assert.ok(other < 20, `not the can or the wall (${other} px)`);
  assert.equal(m.mask[76 * w + 10], 0, 'the white tile outside the trace stays');
  assert.equal(shadeMask(px, w, h, trace.mask, trace.box, [], 18).box, null);
});

test('Reverse Fill: the label is filled from the can around it (blue, its shading), not from the wall behind', () => {
  const { px, can, w, h } = canScene();
  const trace = strokeMask([[30, 50], [130, 50], [130, 110], [30, 110], [30, 52]], 2, w, h);
  const m = shadeMask(px, w, h, trace.mask, trace.box, [sampleShade(px, w, h, 80, 80), sampleShade(px, w, h, 80, 64)], 18);
  const p = reverseFill(px, w, h, m.mask, m.box, trace.mask);
  assert.ok(p && !p.wide);
  const out = painted(px, w, p);
  let blue = 0; let n = 0; let err = 0;
  for (let y = 62; y < 98; y++) for (let x = 42; x < 118; x++) {
    const o = (y * w + x) * 4; n++;
    if (out[o + 2] > out[o + 1] + 60 && out[o + 2] > out[o] + 60) blue++;
    const t = can(x, y); err += Math.abs(out[o] - t[0]) + Math.abs(out[o + 1] - t[1]) + Math.abs(out[o + 2] - t[2]);
  }
  assert.ok(blue / n > 0.97, `blue can where the label was (${(100 * blue / n).toFixed(1)}%)`);
  assert.ok(err / n / 3 < 22, `close to the can's own color and shading (mean error ${(err / n / 3).toFixed(1)})`);
  // The wall beside the can, inside the trace, is untouched.
  for (const [x, y] of [[34, 80], [125, 70]]) for (let c = 0; c < 3; c++) assert.equal(out[(y * w + x) * 4 + c], px[(y * w + x) * 4 + c]);
  // Plain Clean Up of the same area may pull the wall in; Reverse Fill doesn't: no green inside.
  let green = 0;
  for (let y = 62; y < 98; y++) for (let x = 42; x < 118; x++) { const o = (y * w + x) * 4; if (out[o + 1] > out[o + 2]) green++; }
  assert.equal(green, 0);
});

test('Reverse Fill: with nothing of the surface left in the trace, it looks just past it for the surface', () => {
  const w = 80; const h = 80;
  const px = scene(w, h, (x, y) => (x >= 20 && x < 60 && y >= 20 && y < 60 ? [240, 240, 240] : [40, 90, 200]));
  const trace = strokeMask([[21, 21], [58, 21], [58, 58], [21, 58], [21, 23]], 1, w, h);
  const m = shadeMask(px, w, h, trace.mask, trace.box, [[240, 240, 240]], 18);
  const p = reverseFill(px, w, h, m.mask, m.box, trace.mask);
  assert.ok(p?.wider && !p.wide, 'filled from the surface just outside the trace');
  const out = painted(px, w, p); const o = (40 * w + 40) * 4;
  assert.ok(out[o + 2] > 150 && out[o] < 100);
  assert.deepEqual(toLab(255, 255, 255).map((v) => Math.round(v) + 0), [100, 0, 0]);
});

test('Reverse Fill: the surface is found by itself (the can, bordering the label most), or is what Fill From picks', () => {
  const { px, w, h } = canScene();
  const trace = strokeMask([[30, 50], [130, 50], [130, 110], [30, 110], [30, 52]], 2, w, h);
  const m = shadeMask(px, w, h, trace.mask, trace.box, [sampleShade(px, w, h, 80, 80), sampleShade(px, w, h, 80, 64)], 18);
  const auto = surfaceOf(px, w, h, trace.mask, m.mask);
  assert.equal(auto[55 * w + 80], 1, 'the can above the label');
  assert.equal(auto[105 * w + 80], 1, 'and below it');
  assert.equal(auto[80 * w + 34], 0, 'not the wall');
  // Fill From the wall's shades: the wall it is.
  const wall = surfaceOf(px, w, h, trace.mask, m.mask, [sampleShade(px, w, h, 34, 61), sampleShade(px, w, h, 34, 67)]);
  assert.equal(wall[80 * w + 34], 1);
  assert.equal(wall[55 * w + 80], 0);
});
