// A face behind bangs (web/tools/editor/fit-bangs.js): found by its skin when its eyes are hidden; the bangs
// over it found by the color of its own hair (joined to it, not a dark brow); the face's colors worked out
// without them; the Character kept behind them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facesFromParts, bangsMap, debang } from '../web/tools/editor/fit-bangs.js';
import { hairInFront } from '../web/tools/editor/fit-parts.js';

/**
 * A drawn head 200×240: dark brown hair all round and as bangs down to y 120 (over its eyes), skin below
 * (an oval 100 wide, chin at y 190), a dark brow-like mark at y 112 inside the skin's oval is under the
 * bangs. The face-part maps say hair only for the hair outside the face and the top of the bangs (as the
 * segmenter does: unsure of bangs low on the face), face skin for the skin.
 */
function head() {
  const W = 200; const H = 240; const rgba = new Uint8ClampedArray(W * H * 4); const hair = new Uint8Array(W * H); const face = new Uint8Array(W * H);
  const cx = 100; const cy = 130; const a = 50; const b = 66; // the face oval: 100 wide, from y 64 to 196
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; const inOval = ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2 <= 1;
    const inHead = ((x - cx) / 72) ** 2 + ((y - 115) / 95) ** 2 <= 1;
    let c = [40, 90, 60]; // background: green
    if (inHead) { c = [70 + (x * 7) % 9, 45, 30]; hair[i] = 230; } // dark brown hair
    if (inOval && y >= 121) { c = [225, 185, 160]; hair[i] = 0; face[i] = 240; } // skin below the bangs
    else if (inOval) { c = [72 + (y * 5) % 7, 46, 31]; hair[i] = y < 95 ? 200 : 40; } // bangs: the maps sure of only their top
    rgba.set([...c, 255], i * 4);
  }
  return { W, H, rgba, parts: { w: W, h: H, hair, face } };
}

test('a face whose eyes are under bangs: found by its skin, a face\'s 68 points laid on it, its chin at its chin', () => {
  const { W, H, parts } = head();
  const faces = facesFromParts(parts);
  assert.equal(faces.length, 1);
  const f = faces[0];
  assert.ok(f.estimated && f.pts.length === 68);
  const chin = f.pts[8][1] * H; const jawW = (f.pts[16][0] - f.pts[0][0]) * W;
  assert.ok(Math.abs(chin - 196) <= 4, `its chin at the skin's lowest: ${chin.toFixed(0)}`);
  assert.ok(Math.abs(jawW - 100) <= 14, `as wide as its cheeks: ${jawW.toFixed(0)}`);
  const eyeY = ((f.eyes[0][1] + f.eyes[1][1]) / 2) * H;
  assert.ok(eyeY > 95 && eyeY < 130, `its eyes where a face has them (under the bangs): ${eyeY.toFixed(0)}`);
  // No skin, no face.
  assert.equal(facesFromParts({ ...parts, face: new Uint8Array(W * H) }).length, 0);
});

test('the bangs over it found by its own hair\'s color (where the maps aren\'t sure); its colors worked out from its skin; the Character behind them', () => {
  const { W, H, rgba, parts } = head();
  const f = facesFromParts(parts)[0];
  const bangs = bangsMap(rgba, W, H, f, parts);
  assert.ok(bangs, 'found');
  assert.ok(bangs[110 * W + 100] > 150, `low on the forehead, where the maps say hardly any hair: ${bangs[110 * W + 100]}`);
  assert.ok(bangs[160 * W + 100] === 0, 'the skin isn\'t bangs');
  // Filled in from the skin: no hair color left over the face for its colors to be taken from.
  const clean = debang(rgba, W, H, bangs, f);
  const o = (110 * W + 100) * 4;
  assert.ok(clean[o] > 180 && clean[o + 1] > 140, `the forehead the skin's color: ${[...clean.slice(o, o + 3)]}`);
  // The Character (a patch over the face) behind them: see-through under the bangs, not under the skin.
  const patch = { x0: 50, y0: 64, pw: 100, ph: 132, rgba: new Uint8ClampedArray(100 * 132 * 4).fill(255) };
  hairInFront(patch, { ...parts, hair: new Uint8Array(W * H) }, W, H, bangs);
  assert.ok(patch.rgba[((110 - 64) * 100 + 50) * 4 + 3] < 80, 'behind the bangs');
  assert.equal(patch.rgba[((160 - 64) * 100 + 50) * 4 + 3], 255, 'over the skin');
});
