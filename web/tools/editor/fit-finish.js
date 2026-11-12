// @ts-check
// Two finishing touches on a fitted face (after its color, light and texture are matched):
// - keepForehead: above the brows, the photo's own forehead shows through more and more toward the
//   hairline (its texture, shading and stray hairs), so the new face sits in that head rather than a
//   big blank forehead of its own being pasted over it.
// - evenBlotches: color patches on the new face's skin that differ from the skin around them (a
//   sunburned nose, flushed cheeks, a red blotch the recolor turned purple) softened toward it, its
//   brightness kept, so freckles and marks still show as marks, not smudges. Eyes, brows and lips
//   are left as they are. Pure (in place on the patch).

import { fillPolygon, softenMask, convexHull, scalePolygon } from '../../lib/geometry.js';

/** @typedef {import('./fit-types.js').Patch} Patch @typedef {import('./fit-types.js').Face} Face */

/**
 * @param {Patch} patch @param {Uint8ClampedArray} photo @param {number} W @param {number} H
 * @param {Face} face @param {number[][]|null} outline @param {number} strength 0..1 (the blend)
 */
export function keepForehead(patch, photo, W, H, face, outline, strength = 0.7) {
  const { x0, y0, pw, ph, rgba } = patch;
  if (!outline || face.pts?.length !== 68 || strength <= 0) return patch;
  const P = face.pts.map(([u, v]) => [u * W, v * H]);
  const brow = [(P[19][0] + P[24][0]) / 2, (P[19][1] + P[24][1]) / 2];
  const len = Math.hypot(brow[0] - P[8][0], brow[1] - P[8][1]); if (len < 4) return patch;
  const up = [(brow[0] - P[8][0]) / len, (brow[1] - P[8][1]) / len];
  // How high its forehead goes (to the hairline, along the face).
  const top = Math.max(0, ...outline.map(([x, y]) => (x - brow[0]) * up[0] + (y - brow[1]) * up[1]));
  if (top < len * 0.12) return patch;
  const most = Math.min(0.8, 0.85 * Math.min(1, strength / 0.7));
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const k = y * pw + x; if (!rgba[k * 4 + 3]) continue;
    const X = x0 + x; const Y = y0 + y; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const t = ((X - brow[0]) * up[0] + (Y - brow[1]) * up[1]) / top;
    // From a little above the brows (theirs kept) up to the hairline, eased.
    const r = Math.min(1, Math.max(0, (t - 0.22) / 0.7)); if (r <= 0) continue;
    const w = most * r * r * (3 - 2 * r);
    const o = (Y * W + X) * 4;
    for (let c = 0; c < 3; c++) rgba[k * 4 + c] = rgba[k * 4 + c] * (1 - w) + photo[o + c] * w;
  }
  return patch;
}

/**
 * @param {Patch} patch @param {Uint8ClampedArray} photo @param {number} W @param {number} H
 * @param {Face} face @param {number[][]|null} outline @param {number} strength 0..1 (the blend)
 */
export function evenBlotches(patch, photo, W, H, face, outline, strength = 0.7) {
  const { x0, y0, pw, ph, rgba, charPts } = patch;
  if (!outline || face.pts?.length !== 68 || strength <= 0 || pw < 16 || ph < 16) return patch;
  const N = pw * ph;
  const faceW = Math.hypot((face.pts[16][0] - face.pts[0][0]) * W, (face.pts[16][1] - face.pts[0][1]) * H);
  // Its skin: the face, without its eyes, brows and lips (the nose kept: a red nose is the commonest blotch).
  const mask = fillPolygon(scalePolygon(outline, 0.94), x0, y0, pw, ph);
  for (const pts of [face.pts.map(([u, v]) => [u * W, v * H]), charPts].filter(Boolean)) {
    for (const [a, b, g] of [[17, 21, 1.45], [22, 26, 1.45], [36, 41, 1.35], [42, 47, 1.35], [48, 59, 1.2]]) {
      const m = fillPolygon(scalePolygon(convexHull(pts.slice(a, b + 1)), g), x0, y0, pw, ph);
      for (let i = 0; i < N; i++) if (m[i]) mask[i] = 0;
    }
  }
  for (let k = 0; k < N; k++) if (!rgba[k * 4 + 3]) mask[k] = 0;
  // Color apart from brightness (Cb, Cr): the new face's, and the photo's own skin tone there (its
  // middle value over the same skin), what a patch of it that's gone off-tone is brought back toward.
  const cb = new Float32Array(N); const cr = new Float32Array(N); const yy = new Float32Array(N);
  const refB = []; const refR = [];
  for (let k = 0; k < N; k++) {
    const r = rgba[k * 4]; const g = rgba[k * 4 + 1]; const b = rgba[k * 4 + 2];
    yy[k] = 0.299 * r + 0.587 * g + 0.114 * b; cb[k] = b - yy[k]; cr[k] = r - yy[k];
    if (!mask[k] || (k % 3)) continue;
    const X = x0 + (k % pw); const Y = y0 + Math.floor(k / pw); if (X >= W || Y >= H) continue;
    const o = (Y * W + X) * 4; const py = 0.299 * photo[o] + 0.587 * photo[o + 1] + 0.114 * photo[o + 2];
    if (face.skin && !face.skin.isSkin(photo[o], photo[o + 1], photo[o + 2])) continue;
    refB.push(photo[o + 2] - py); refR.push(photo[o] - py);
  }
  if (refB.length < 50) return patch;
  const median = (v) => { v.sort((p, q) => p - q); return v[v.length >> 1]; };
  const tb = median(refB); const tr = median(refR);
  // And the new face's own skin tone (its middle value): a patch is judged by how far it is off from it,
  // and brought toward the photo's.
  const ownB = []; const ownR = [];
  for (let k = 0; k < N; k += 3) if (mask[k]) { ownB.push(cb[k]); ownR.push(cr[k]); }
  const ob = median(ownB); const or = median(ownR);
  const edge = softenMask(mask, pw, ph, Math.max(1, Math.round(faceW * 0.03)));
  const amt = 0.8 * Math.min(1, strength / 0.7);
  for (let k = 0; k < N; k++) {
    if (!mask[k] || edge[k] < 0.02) continue;
    const db = cb[k] - ob; const dr = cr[k] - or;
    const m = Math.hypot(db, dr);
    // A small difference (a freckle's tint, natural variation) stays; a big one (a blotch) mostly goes.
    const f = amt * edge[k] * Math.min(1, Math.max(0, (m - 4) / 10));
    if (f <= 0) continue;
    // Toward the skin's own tone where it's off, then that tone nudged to the photo's.
    const nb = cb[k] - f * db + f * 0.3 * (tb - ob); const nr = cr[k] - f * dr + f * 0.3 * (tr - or); const Yv = yy[k];
    const r = Yv + nr; const b = Yv + nb; const g = (Yv - 0.299 * r - 0.114 * b) / 0.587;
    rgba[k * 4] = Math.max(0, Math.min(255, r)); rgba[k * 4 + 1] = Math.max(0, Math.min(255, g)); rgba[k * 4 + 2] = Math.max(0, Math.min(255, b));
  }
  return patch;
}
