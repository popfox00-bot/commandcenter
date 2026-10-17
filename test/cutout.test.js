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
