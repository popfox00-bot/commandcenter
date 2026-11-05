// The shared shapes and masks (web/lib/geometry.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inPolygon, segmentDistance, edgeDistance, fillPolygon, convexHull, scalePolygon, softenMask, boxBlur } from '../web/lib/geometry.js';

const square = [[10, 10], [30, 10], [30, 30], [10, 30]];

test('polygons: inside, distances, filled, hull, grown', () => {
  assert.ok(inPolygon(square, 20, 20)); assert.ok(!inPolygon(square, 5, 20));
  assert.equal(segmentDistance(0, 5, [0, 0], [10, 0]), 5); assert.equal(segmentDistance(15, 0, [0, 0], [10, 0]), 5);
  assert.equal(edgeDistance(square, 20, 20), 10);
  const m = fillPolygon(square, 0, 0, 40, 40);
  assert.equal(m.reduce((t, v) => t + v, 0), 400); assert.equal(m[20 * 40 + 20], 1); assert.equal(m[5 * 40 + 5], 0);
  // Offset box: the same shape, moved.
  const m2 = fillPolygon(square, 10, 10, 20, 20); assert.equal(m2.reduce((t, v) => t + v, 0), 400);
  const hull = convexHull([...square, [20, 20], [15, 25]]);
  assert.equal(hull.length, 4); for (const p of square) assert.ok(hull.some((q) => q[0] === p[0] && q[1] === p[1]));
  assert.deepEqual(scalePolygon(square, 2), [[0, 0], [40, 0], [40, 40], [0, 40]]);
});

test('masks: softened into a ramp (as much in as before), blurred only over what\'s set', () => {
  const w = 40; const h = 1; const m = Float32Array.from({ length: w }, (_, x) => (x < 20 ? 1 : 0));
  const s = softenMask(m, w, h, 3);
  assert.ok(s[10] > 0.99 && s[30] < 0.01 && s[19] > 0.4 && s[19] < 0.8 && s[20] > 0.2 && s[20] < 0.6);
  assert.equal(softenMask(m, w, h, 0), m);
  // Blur over the set pixels only: a set run of 10s next to unset 0s stays 10.
  const v = Float32Array.from({ length: w }, (_, x) => (x < 20 ? 10 : 0)); const ok = Uint8Array.from({ length: w }, (_, x) => (x < 20 ? 1 : 0));
  const b = boxBlur(v, ok, w, h, 2);
  assert.equal(b[19], 10); assert.equal(b[30], 0);
});
