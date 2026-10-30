import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothClosed, polygonArea, thin, featherAlpha, alphaBounds } from '../web/tools/cutout/cutout-core.js';

test('smoothing a traced square keeps it closed and about the same size', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const s = smoothClosed(sq, 2);
  assert.equal(s.length, 16);
  const a = polygonArea(s);
  assert.ok(a > 70 && a < 100, `area ${a}`);
});

test('thinning drops jitter points', () => {
  assert.deepEqual(thin([[0, 0], [0.5, 0], [2, 0], [2.2, 0], [5, 0]], 1.5), [[0, 0], [2, 0], [5, 0]]);
});

test('feathering softens the edge but keeps the inside opaque and the far outside clear', () => {
  const w = 40; const h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) data[(y * w + x) * 4 + 3] = 255;
  featherAlpha(data, w, h, 3);
  const a = (x, y) => data[(y * w + x) * 4 + 3];
  assert.ok(a(20, 20) > 250, 'center opaque');
  assert.ok(a(2, 2) === 0, 'far outside clear');
  assert.ok(a(10, 20) > 60 && a(10, 20) < 200, `edge is soft (${a(10, 20)})`);
});

test('bounds of the visible part, padded and clamped', () => {
  const w = 50; const h = 30;
  const data = new Uint8ClampedArray(w * h * 4);
  data[(5 * w + 7) * 4 + 3] = 255; data[(20 * w + 40) * 4 + 3] = 255;
  assert.deepEqual(alphaBounds(data, w, h), { x: 5, y: 3, width: 38, height: 20 });
  assert.equal(alphaBounds(new Uint8ClampedArray(16), 2, 2), null);
});

// ---------- smart edges ----------
import { smartEdge } from '../web/tools/cutout/cutout-core.js';

const noise = (x, y, k) => ((((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 1000) / 1000;
function scene(w, h, paint) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = paint(x, y); const i = (y * w + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
  return px;
}
const circle = (w, h, cx, cy, r) => Uint8Array.from({ length: w * h }, (_, i) => (Math.hypot((i % w) - cx, Math.floor(i / w) - cy) <= r ? 1 : 0));
const count = (m, f = () => true) => { let n = 0; for (let i = 0; i < m.length; i++) if (m[i] && f(i)) n++; return n; };

test('smart edges: a loose trace around a red ball on a blue wall comes in to the ball', () => {
  const w = 400; const h = 400;
  const px = scene(w, h, (x, y) => (Math.hypot(x - 200, y - 200) <= 100 ? [200 + 20 * noise(x, y, 1), 40, 30] : [120, 170 + 20 * noise(x, y, 2), 220]));
  const trace = circle(w, h, 205, 195, 128); // a loose, slightly off-center finger trace
  const { keep, share } = smartEdge(px, w, h, trace);
  const ball = (i) => Math.hypot((i % w) - 200, Math.floor(i / w) - 200) <= 100;
  const ballArea = count(trace, ball);
  assert.ok(count(keep, ball) / ballArea > 0.99, 'the whole ball is kept');
  const wall = count(trace, (i) => !ball(i));
  assert.ok(count(keep, (i) => !ball(i)) / wall < 0.1, `most of the wall inside the trace is cut (${count(keep, (i) => !ball(i))} of ${wall} left)`);
  assert.ok(share > 0.2 && share < 0.45);
  assert.equal(count(keep, (i) => !trace[i]), 0, 'nothing outside the trace');
});

test('smart edges: a fruit basket keeps every fruit (many colors), and only the wall around it goes', () => {
  const w = 400; const h = 400;
  const fruits = [[150, 140, 38, [220, 30, 40]], [210, 130, 40, [250, 210, 40]], [265, 150, 36, [90, 180, 60]], [190, 175, 30, [245, 140, 30]], [240, 190, 28, [130, 40, 120]]];
  const inFruit = (x, y) => fruits.find(([cx, cy, r]) => Math.hypot(x - cx, y - cy) <= r);
  const inBasket = (x, y) => x >= 110 && x < 300 && y >= 180 && y < 300;
  const px = scene(w, h, (x, y) => { const f = inFruit(x, y); if (f) return f[3]; if (inBasket(x, y)) return (x + y) % 14 < 7 ? [150, 100, 50] : [120, 80, 40]; return [235 + 10 * noise(x, y, 3), 232, 225]; });
  // A loose hand trace around the whole thing.
  const trace = Uint8Array.from({ length: w * h }, (_, i) => { const x = i % w; const y = Math.floor(i / w); return ((x - 205) / 125) ** 2 + ((y - 200) / 125) ** 2 <= 1 ? 1 : 0; });
  const { keep } = smartEdge(px, w, h, trace);
  const object = (i) => { const x = i % w; const y = Math.floor(i / w); return !!inFruit(x, y) || inBasket(x, y); };
  const obj = count(trace, object);
  assert.ok(count(keep, object) / obj > 0.995, `fruit and basket kept (${count(keep, object)} of ${obj})`);
  for (const [cx, cy] of fruits) assert.equal(keep[cy * w + cx], 1, `fruit at ${cx},${cy}`);
  const wall = count(trace, (i) => !object(i));
  assert.ok(count(keep, (i) => !object(i)) / wall < 0.35, 'much of the wall inside the trace is cut');
});

test('smart edges are careful: an object like its background, or a trace drawn inside the object, loses nothing', () => {
  const w = 300; const h = 300;
  // Beige on beige: too close to tell; the trace stays as drawn.
  const same = scene(w, h, (x, y) => (Math.hypot(x - 150, y - 150) <= 70 ? [210, 195, 170] : [214, 199, 174]));
  const t1 = circle(w, h, 150, 150, 95);
  assert.equal(count(smartEdge(same, w, h, t1).keep), count(t1));
  // A big gray box with the trace inside it: the outside of the trace is the object too.
  const box = scene(w, h, (x, y) => (x > 30 && x < 270 && y > 30 && y < 270 ? [90 + 10 * noise(x, y, 4), 90, 95] : [250, 250, 250]));
  const t2 = circle(w, h, 150, 150, 90);
  assert.equal(count(smartEdge(box, w, h, t2).keep), count(t2), 'nothing cut out of the object');
});

test('smart edges for a part left out: a loose trace around the sky under a basket\'s handle leaves out the sky, not the handle', () => {
  const w = 400; const h = 400;
  // A brown handle (a thick arch) with blue sky under it.
  const handle = (x, y) => { const d = Math.hypot(x - 200, y - 220); return d >= 100 && d <= 122 && y <= 220; };
  const px = scene(w, h, (x, y) => (handle(x, y) ? [130 + 20 * noise(x, y, 5), 85, 40] : [140, 190 + 15 * noise(x, y, 6), 240]));
  // The hole traced loosely: it runs over the inner part of the handle.
  const hole = Uint8Array.from({ length: w * h }, (_, i) => { const x = i % w; const y = Math.floor(i / w); return Math.hypot(x - 200, y - 220) <= 110 && y <= 222 ? 1 : 0; });
  const { keep } = smartEdge(px, w, h, hole);
  // In a hole, "keep" is what really goes: the sky. Handle pixels the trace ran over stay out of it.
  const handleInHole = count(hole, (i) => handle(i % w, Math.floor(i / w)));
  assert.ok(handleInHole > 500, 'the trace does run over the handle');
  assert.ok(count(keep, (i) => handle(i % w, Math.floor(i / w))) / handleInHole < 0.15, 'so (nearly all) the handle is kept in the cutout');
  const sky = count(hole, (i) => !handle(i % w, Math.floor(i / w)));
  assert.ok(count(keep, (i) => !handle(i % w, Math.floor(i / w))) / sky > 0.97, 'and the sky goes');
});

// ---------- patch fix ----------
import { patchMask } from '../web/tools/cutout/cutout-core.js';

test('patch fix: inside the circle tapped, the outline moves to the object\'s edge (out where it cut the object, in where it kept background)', () => {
  const w = 300; const h = 300;
  const ball = (x, y) => Math.hypot(x - 150, y - 150) <= 80;
  const px = scene(w, h, (x, y) => (ball(x, y) ? [210, 50 + 20 * noise(x, y, 7), 40] : [80, 160, 90 + 20 * noise(x, y, 8)]));
  // A cut that's mostly right but has a bite out of the ball on the right, and keeps a lump of
  // background on the left.
  const mask = Uint8Array.from({ length: w * h }, (_, i) => { const x = i % w; const y = Math.floor(i / w); return (ball(x, y) && Math.hypot(x - 230, y - 150) > 25) || Math.hypot(x - 62, y - 150) <= 22 ? 1 : 0; });
  const apply = (m, p) => { const out = Uint8Array.from(m); for (let j = 0; j < p.bw * p.bh; j++) out[(p.y0 + Math.floor(j / p.bw)) * w + p.x0 + (j % p.bw)] = p.bits[j]; return out; };
  const right = patchMask(px, w, h, mask, 228, 150, 32);
  assert.ok(right.changed > 300);
  let m = apply(mask, right);
  const wrong = (mm, cx, cy, r) => { let n = 0; for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) <= r && mm[y * w + x] !== (ball(x, y) ? 1 : 0)) n++; return n; };
  assert.ok(wrong(m, 228, 150, 30) < 20, `the bite is filled back in (${wrong(m, 228, 150, 30)} wrong)`);
  m = apply(m, patchMask(px, w, h, m, 62, 150, 32));
  assert.ok(wrong(m, 62, 150, 30) < 20, `the lump of background goes (${wrong(m, 62, 150, 30)} wrong)`);
  assert.equal(wrong(m, 150, 150, 40), 0, 'the rest untouched');
  assert.equal(patchMask(px, w, h, new Uint8Array(w * h), 150, 150, 30), null, 'nothing to go by: no object around');
});
