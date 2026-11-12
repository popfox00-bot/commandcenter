// FM's finishing touches: the photo's own forehead toward the hairline, color blotches evened out
// (brightness kept), and when a mouth is closed to match by itself (parted lips on a shut mouth, not
// a wide smile, never opened).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepForehead, evenBlotches } from '../web/tools/editor/fit-finish.js';
import { mouthOpenness, mouthWidth, mouthsDiffer } from '../web/tools/editor/fit-place.js';

/** 68 landmarks of a plain upright face in a 200×200 picture (as fractions). */
function facePts({ gap = 0, mouthW = 50 } = {}) {
  const P = Array.from({ length: 68 }, () => [100, 100]);
  for (let i = 0; i <= 16; i++) { const a = Math.PI * (i / 16); P[i] = [100 - 60 * Math.cos(a), 110 + 60 * Math.sin(a)]; } // jaw, 0..16, chin 8 at the bottom
  for (let i = 17; i <= 21; i++) P[i] = [55 + (i - 17) * 8, 70]; for (let i = 22; i <= 26; i++) P[i] = [113 + (i - 22) * 8, 70];
  for (let i = 36; i <= 41; i++) P[i] = [62 + (i - 36) * 5, 82]; for (let i = 42; i <= 47; i++) P[i] = [113 + (i - 42) * 5, 82];
  for (let i = 27; i <= 35; i++) P[i] = [100, 85 + (i - 27) * 4];
  P[48] = [100 - mouthW / 2, 140]; P[54] = [100 + mouthW / 2, 140];
  for (let i = 49; i <= 59; i++) if (i !== 54) P[i] = [100 + ((i - 51.5) * mouthW) / 12, i < 54 ? 136 : 144];
  for (const [a, b] of [[61, 67], [62, 66], [63, 65]]) { P[a] = [100, 140 - gap / 2]; P[b] = [100, 140 + gap / 2]; }
  P[60] = [100 - mouthW / 2 + 2, 140]; P[64] = [100 + mouthW / 2 - 2, 140];
  return P.map(([x, y]) => [x / 200, y / 200]);
}

test('mouths: openness and width; closed to match by itself only for parted lips on a shut mouth', () => {
  assert.equal(mouthOpenness(facePts(), 200, 200), 0);
  assert.ok(mouthOpenness(facePts({ gap: 9 }), 200, 200) > 0.15);
  assert.ok(mouthWidth(facePts({ mouthW: 40 }), 200, 200) < 0.9);
  assert.ok(mouthWidth(facePts({ mouthW: 62 }), 200, 200) > 1);
  assert.equal(mouthsDiffer(facePts({ gap: 9, mouthW: 40 }), 200, 200, facePts(), 200, 200), true, 'parted lips onto a shut mouth');
  assert.equal(mouthsDiffer(facePts({ gap: 9, mouthW: 62 }), 200, 200, facePts(), 200, 200), false, 'a wide smile: kept');
  assert.equal(mouthsDiffer(facePts(), 200, 200, facePts({ gap: 9 }), 200, 200), false, 'never opened by itself');
  assert.equal(mouthsDiffer(facePts({ gap: 9, mouthW: 40 }), 200, 200, facePts({ gap: 8 }), 200, 200), false, 'both open');
});

/** A patch covering the whole 200×200 picture, filled with one color. */
const patchOf = (rgb) => ({ x0: 0, y0: 0, pw: 200, ph: 200, rgba: Uint8ClampedArray.from({ length: 200 * 200 * 4 }, (_, i) => (i % 4 === 3 ? 255 : rgb[i % 4])), charPts: null });
const photoOf = (rgb) => Uint8ClampedArray.from({ length: 200 * 200 * 4 }, (_, i) => (i % 4 === 3 ? 255 : rgb[i % 4]));
const px = (p, x, y) => [...p.rgba.subarray((y * 200 + x) * 4, (y * 200 + x) * 4 + 3)];

test('forehead: the photo shows through toward the hairline, not at the brows or below', () => {
  const pts = facePts(); const face = { pts, box: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } };
  // Outline: jaw, then up to a hairline 30 px above the brows.
  const outline = [...pts.slice(0, 17).map(([u, v]) => [u * 200, v * 200]), [160, 40], [100, 38], [40, 40]];
  const p = patchOf([200, 150, 130]);
  keepForehead(p, photoOf([90, 60, 50]), 200, 200, face, outline, 0.7);
  const near = px(p, 100, 41); const brow = px(p, 100, 72); const cheek = px(p, 70, 120);
  assert.ok(near[0] < 130, `near the hairline mostly the photo's (${near})`);
  assert.deepEqual(brow, [200, 150, 130], 'at the brows: its own');
  assert.deepEqual(cheek, [200, 150, 130], 'below: its own');
});

test('blotches: a patch off the skin\'s tone brought back toward it, brightness kept; even skin left alone', () => {
  const pts = facePts(); const face = { pts, box: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, skin: null };
  const outline = [...pts.slice(0, 17).map(([u, v]) => [u * 200, v * 200]), [160, 40], [100, 38], [40, 40]];
  const p = patchOf([200, 160, 140]);
  // A purple blotch on the cheek.
  for (let y = 100; y < 125; y++) for (let x = 60; x < 85; x++) { const o = (y * 200 + x) * 4; p.rgba[o] = 190; p.rgba[o + 1] = 140; p.rgba[o + 2] = 175; }
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const before = px(p, 72, 112); const plain = px(p, 120, 115);
  evenBlotches(p, photoOf([200, 160, 140]), 200, 200, face, outline, 0.7);
  const after = px(p, 72, 112);
  const off = (c) => Math.hypot((c[2] - lum(c)) - (140 - lum([200, 160, 140])), (c[0] - lum(c)) - (200 - lum([200, 160, 140])));
  assert.ok(off(after) < off(before) * 0.5, `the blotch's color mostly gone (${before} → ${after})`);
  assert.ok(Math.abs(lum(after) - lum(before)) < 3, 'its brightness kept');
  assert.deepEqual(px(p, 120, 115), plain, 'even skin unchanged');
});
