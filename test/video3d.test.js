// Video Editor's 2D → 3D engine (web/tools/video/video-core.js): sizes and names for each layout, scene cuts,
// depth steadying, the eyes drawn from depth (near things shifted the right way, holes filled from the background),
// frames composed per layout; and the Edit tab's centered crops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VR_SUFFIXES, LAYOUTS, eyeSize, frameSize, vrName, resizeRGBA, resizeMap, thumbOf, isSceneCut, normalizeDepth,
  smoothDepth, refineDepth, renderEye, composeFrame, anaglyph, depthImage, shiftFor, fallbackDepth,
} from '../web/tools/video/video-core.js';

const solid = (w, h, [r, g, b]) => { const a = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < a.length; i += 4) { a[i] = r; a[i + 1] = g; a[i + 2] = b; a[i + 3] = 255; } return a; };

test('the filename endings live in one place, one per layout', () => {
  assert.deepEqual(VR_SUFFIXES, { sbs: '_SBS_LR', half: '_3dh', tb: '_TB' });
  assert.deepEqual(LAYOUTS.map((l) => l.id), ['sbs', 'half', 'tb']);
  assert.equal(vrName('Holiday clip.MOV', 'sbs'), 'Holiday clip_SBS_LR.mp4');
  assert.equal(vrName('a.mp4', 'half'), 'a_3dh.mp4');
  assert.equal(vrName('a.b.webm', 'tb'), 'a.b_TB.mp4');
  assert.equal(vrName('', 'tb'), 'video_TB.mp4');
  assert.equal(vrName('x.mp4', 'sbs', { sbs: '_LR' }), 'x_LR.mp4');
});

test('each eye is capped on its longer side, even-sized, never bigger than the source', () => {
  assert.deepEqual(eyeSize(1920, 1080, 1080), { w: 1080, h: 608 });
  assert.deepEqual(eyeSize(1280, 720, 1920), { w: 1280, h: 720 });
  assert.deepEqual(eyeSize(1080, 1920, 1440), { w: 810, h: 1440 });
  assert.deepEqual(eyeSize(1281, 721, 0), { w: 1282, h: 722 });
});

test('frame sizes: full SBS is twice as wide, half SBS keeps the width, top-bottom is twice as tall', () => {
  const eye = { w: 1280, h: 720 };
  assert.deepEqual(frameSize('sbs', eye), { w: 2560, h: 720, eyeW: 1280, eyeH: 720 });
  assert.deepEqual(frameSize('half', eye), { w: 1280, h: 720, eyeW: 640, eyeH: 720 });
  assert.deepEqual(frameSize('tb', eye), { w: 1280, h: 1440, eyeW: 1280, eyeH: 720 });
});

test('resizing keeps a flat color flat and the right size', () => {
  const big = solid(40, 20, [10, 200, 30]);
  const small = resizeRGBA(big, 40, 20, 10, 5); assert.equal(small.length, 10 * 5 * 4); assert.deepEqual([...small.subarray(0, 4)], [10, 200, 30, 255]);
  const up = resizeRGBA(small, 10, 5, 23, 11); assert.equal(up.length, 23 * 11 * 4); assert.deepEqual([...up.subarray(up.length - 4)], [10, 200, 30, 255]);
  const m = resizeMap(new Float32Array(16).fill(0.25), 4, 4, 9, 7); assert.equal(m.length, 63); assert.ok(m.every((v) => Math.abs(v - 0.25) < 1e-6));
});

test('scene cuts: a different picture is a cut, a small change is not', () => {
  const a = thumbOf(solid(64, 36, [30, 30, 30]), 64, 36);
  const a2 = thumbOf(solid(64, 36, [36, 34, 32]), 64, 36);
  const b = thumbOf(solid(64, 36, [230, 220, 210]), 64, 36);
  assert.equal(isSceneCut(a, a2), false);
  assert.equal(isSceneCut(a, b), true);
});

test('depth is normalized to 0–1 and steadied over time, but big changes come through', () => {
  const raw = Float32Array.from({ length: 100 }, (_, i) => 5 + i * 0.1);
  const st = {}; const n = normalizeDepth(raw, st, { reset: true });
  assert.ok(Math.min(...n) >= 0 && Math.max(...n) <= 1); assert.ok(n[99] > n[0]);
  const prev = new Float32Array(4).fill(0.5);
  const small = smoothDepth(prev, Float32Array.from([0.52, 0.52, 0.52, 0.52]), 0.9);
  assert.ok(small[0] < 0.51, 'a small wobble is mostly smoothed away');
  const big = smoothDepth(prev, Float32Array.from([1, 1, 1, 1]), 0.9);
  assert.ok(big[0] > 0.95, 'a real move comes straight through');
  assert.deepEqual([...smoothDepth(null, Float32Array.from([0.3]), 0.9)].map((v) => +v.toFixed(3)), [0.3]);
});

test('depth edges are grown outward from near things before warping (so edges tear less)', () => {
  const w = 9; const h = 1; const d = new Float32Array(w); d[4] = 1;
  const r = refineDepth(d, w, h, 1);
  assert.ok(r[3] > 0 && r[5] > 0, 'neighbours of a near pixel come forward');
  assert.ok(r[0] < 0.01);
});

test('the eyes: near things move apart the pop-out way, far things stay, holes are filled from the background', () => {
  const W = 40; const H = 2; const src = solid(W, H, [0, 0, 255]); const depth = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 16; x < 24; x++) { const i = y * W + x; depth[i] = 1; src.set([255, 0, 0, 255], i * 4); }
  const left = renderEye(src, depth, W, H, 8, 0, 1, new Uint8ClampedArray(W * H * 4));
  const right = renderEye(src, depth, W, H, 8, 0, -1, new Uint8ClampedArray(W * H * 4));
  const redXs = (img) => { const xs = []; for (let x = 0; x < W; x++) if (img[x * 4] > 200 && img[x * 4 + 2] < 50) xs.push(x); return xs; };
  // (Depth 1, screen plane 0: shifted by half of 8 px: right in the left eye, left in the right eye.)
  assert.deepEqual(redXs(left), [20, 21, 22, 23, 24, 25, 26, 27]);
  assert.deepEqual(redXs(right), [12, 13, 14, 15, 16, 17, 18, 19]);
  // Every pixel is filled (no black holes), and the holes uncovered take the background's blue.
  for (const img of [left, right]) for (let i = 0; i < W * H; i++) assert.equal(img[i * 4 + 3], 255);
  for (let x = 16; x < 19; x++) assert.ok(left[x * 4 + 2] > 200, `left eye x=${x} is background`);
  // At the screen plane nothing moves.
  const flat = renderEye(src, depth, W, H, 8, 1, 1, new Uint8ClampedArray(W * H * 4));
  assert.deepEqual(redXs(flat), [16, 17, 18, 19, 20, 21, 22, 23]);
});

test('frames composed per layout, eyes swapped on request', () => {
  const L = solid(4, 2, [255, 0, 0]); const R = solid(4, 2, [0, 255, 0]);
  const sbs = composeFrame('sbs', L, R, 4, 2); assert.equal(sbs.length, 8 * 2 * 4);
  assert.equal(sbs[0], 255); assert.equal(sbs[4 * 4 + 1], 255);
  const sw = composeFrame('sbs', L, R, 4, 2, true); assert.equal(sw[1], 255); assert.equal(sw[4 * 4], 255);
  const tb = composeFrame('tb', L, R, 4, 2); assert.equal(tb.length, 4 * 4 * 4);
  assert.equal(tb[0], 255); assert.equal(tb[2 * 4 * 4 + 1], 255);
  const half = composeFrame('half', solid(2, 2, [255, 0, 0]), solid(2, 2, [0, 255, 0]), 2, 2); assert.equal(half.length, 4 * 2 * 4);
});

test('preview helpers and strength', () => {
  const a = anaglyph(solid(1, 1, [100, 0, 0]), solid(1, 1, [0, 50, 60])); assert.deepEqual([...a], [30, 50, 60, 255]);
  assert.equal(depthImage(Float32Array.from([0, 1])).length, 8);
  assert.equal(shiftFor(3, 1000), 30); assert.equal(shiftFor(20, 1000), 80); assert.equal(shiftFor(-1, 1000), 0);
  const d = fallbackDepth(solid(8, 8, [120, 120, 120]), 8, 8); assert.equal(d.length, 64); assert.ok(d.every((v) => Number.isFinite(v)));
});

test('Edit: centered crops of each shape, even-sized', async () => {
  // (video-edit.js imports the DOM helpers, which only touch the DOM when used.)
  const { cropFor } = await import('../web/tools/video/video-edit.js');
  assert.equal(cropFor(1920, 1080, ''), null);
  assert.deepEqual(cropFor(1920, 1080, '1:1'), { left: 420, top: 0, width: 1080, height: 1080 });
  assert.deepEqual(cropFor(1920, 1080, '9:16'), { left: 656, top: 0, width: 608, height: 1080 });
  assert.deepEqual(cropFor(1080, 1920, '16:9'), { left: 0, top: 656, width: 1080, height: 608 });
});
