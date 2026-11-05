// Swap scoring (web/tools/editor/swap-score.js): lined up, kept its shape, no seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignment, distortion, seam, eyeSpan } from '../web/tools/editor/swap-score.js';

/** 68 landmarks of a plain face at (cx, cy), scale s; `mouth` widens the mouth, `nose` lengthens the nose. */
function face(cx, cy, s, { mouth = 1, nose = 1 } = {}) {
  const p = [];
  for (let i = 0; i <= 16; i++) { const a = Math.PI * (i / 16); p.push([cx - Math.cos(a) * 48 * s, cy + Math.sin(a) * 50 * s - 5 * s]); }
  for (let i = 0; i < 5; i++) p.push([cx - 38 * s + i * 7 * s, cy - 30 * s]);
  for (let i = 0; i < 5; i++) p.push([cx + 10 * s + i * 7 * s, cy - 30 * s]);
  for (let i = 0; i < 4; i++) p.push([cx, cy - 20 * s + i * 7 * s * nose]);
  for (let i = 0; i < 5; i++) p.push([cx - 10 * s + i * 5 * s, cy - 20 * s + 21 * s * nose + 9 * s]);
  const eye = (ex) => [[ex - 9 * s, cy - 15 * s], [ex - 4 * s, cy - 18 * s], [ex + 4 * s, cy - 18 * s], [ex + 9 * s, cy - 15 * s], [ex + 4 * s, cy - 12 * s], [ex - 4 * s, cy - 12 * s]];
  p.push(...eye(cx - 20 * s), ...eye(cx + 20 * s));
  for (let i = 0; i < 20; i++) { const a = (i / 20) * 2 * Math.PI; p.push([cx + Math.cos(a) * 15 * s * mouth, cy + 25 * s + Math.sin(a) * 6 * s]); }
  // (48 and 54 the mouth's corners: as iBUG has them.)
  p[48] = [cx - 15 * s * mouth, cy + 25 * s]; p[54] = [cx + 15 * s * mouth, cy + 25 * s];
  return p;
}

test('lined up: none when it is the same face, more the farther it is off (as a share of the eye span)', () => {
  const a = face(100, 100, 1);
  assert.equal(alignment(a, a), 0);
  const moved = a.map(([x, y]) => [x + 4, y]);
  assert.ok(Math.abs(alignment(a, moved) - 4 / eyeSpan(a)) < 1e-9);
});

test('kept its shape: the same face bigger or moved is itself; a wider mouth or a longer nose is not', () => {
  const c = face(100, 100, 1);
  assert.ok(distortion(c, face(300, 200, 1.7)).mean < 1e-9, 'scaled and moved: the same proportions');
  const wide = distortion(c, face(100, 100, 1, { mouth: 1.3 }));
  assert.ok(wide.each['mouth width'] > 0.25 && wide.mean > 0.03, JSON.stringify(wide));
  const longNose = distortion(c, face(100, 100, 1, { nose: 1.3 }));
  assert.ok(longNose.each['nose length'] > 0.2, JSON.stringify(longNose));
});

test('a seam: a patch with a hard edge scores high; the same patch eased in, low', () => {
  const W = 120; const H = 120; const before = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) before.set([150, 150, 150, 255], i * 4);
  const put = (ease) => {
    const out = Uint8ClampedArray.from(before);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - 60, y - 60); const a = ease ? Math.max(0, Math.min(1, (35 - d) / 15)) : d < 30 ? 1 : 0;
      const v = 150 + 40 * a; out.set([v, v, v, 255], (y * W + x) * 4);
    }
    return out;
  };
  const hard = seam(put(false), before, W, H); const eased = seam(put(true), before, W, H);
  assert.ok(hard > eased * 3 && hard > 2, `hard ${hard}, eased ${eased}`);
  assert.equal(seam(before, before, W, H), 0);
});
