// FaceMask's fitting, texture: that face's own skin texture kept (keepSkinTexture), and the Character's
// sharpness and grain matched to the photo's (matchTexture). Pure; in place on a patch.

import { boxBlur, convexHull as hull, fillPolygon, scalePolygon as grow, softenMask as soften } from '../../lib/geometry.js';
import { skinModel } from './fit-skin.js';

/**
 * Its strongest edges (the top tenth by how much the brightness `lum` changes over 7 pixels, over `mask`
 * where `ok` is all there, pw × ph): their pixel indices.
 */
function edgesOf(lum, ok, mask, pw, ph) {
  const g3 = []; const ks = [];
  for (let y = 3; y < ph - 3; y++) for (let x = 3; x < pw - 3; x++) {
    const k = y * pw + x; if (!mask[k] || !ok[k] || !ok[k - 3] || !ok[k + 3] || !ok[k - 3 * pw] || !ok[k + 3 * pw]) continue;
    g3.push(Math.hypot(lum[k + 3] - lum[k - 3], lum[k + 3 * pw] - lum[k - 3 * pw])); ks.push(k);
  }
  if (ks.length < 400) return null;
  const cut = Float32Array.from(g3).sort()[Math.floor(g3.length * 0.9)];
  if (!(cut > 6)) return null; // (nothing much to see: no edge to tell by)
  return ks.filter((_, i) => g3[i] >= cut);
}
/**
 * How sharply those edges are drawn in `lum` (pw wide): the steepest change across 3 pixels around each
 * against its change across 7 (a crisp edge is all in a pixel or two: ~3; a soft one spread out: toward 1).
 */
function sharpAt(lum, edges, pw) {
  let a = 0; let b = 0;
  for (const k of edges) {
    let g1 = 0;
    for (const q of [k - 1, k, k + 1, k - pw, k + pw]) g1 = Math.max(g1, Math.hypot(lum[q + 1] - lum[q - 1], lum[q + pw] - lum[q - pw]));
    a += g1 / 2; b += Math.hypot(lum[k + 3] - lum[k - 3], lum[k + 3 * pw] - lum[k - 3 * pw]) / 6;
  }
  return b > 0 ? a / b : NaN;
}
/** Its grain: how much each pixel of `lum` differs from the 3×3 around it, over the skin `skin` (the strongest 3% left out). */
function grainOf(lum, ok, skin, pw, ph) {
  const b1 = boxBlur(lum, ok, pw, ph, 1); const d = [];
  for (let y = 1; y < ph - 1; y += 1) for (let x = 1 + (y & 1); x < pw - 1; x += 2) { const k = y * pw + x; if (skin[k] && ok[k] && ok[k - 1] && ok[k + 1] && ok[k - pw] && ok[k + pw]) d.push(Math.abs(lum[k] - b1[k])); }
  if (d.length < 200) return NaN;
  const s = Float32Array.from(d).sort(); const n = Math.floor(s.length * 0.97); let t = 0; for (let i = 0; i < n; i++) t += s[i];
  return (1.25 * t) / n;
}

/**
 * That face's own skin texture kept (`photo`, RGBA W×H): over the skin (inside its outline, the features
 * of both faces left out, where the photo is skin), the Character's own fine detail (each pixel less the
 * few around it) partly swapped for the photo's there, its pores and grain where they are, so the new face
 * is on that face's skin rather than airbrushed or pasted. `strength` 0..1 (half of it at most, so the
 * Character's own freckles and marks still show). In place; returns the patch.
 */
export function keepSkinTexture(patch, photo, W, H, face, outline, strength = 0.8) {
  const { x0, y0, pw, ph, rgba, charPts } = patch;
  if (!outline || face.pts?.length !== 68 || strength <= 0 || pw < 16 || ph < 16) return patch;
  const N = pw * ph;
  const faceW = Math.hypot((face.pts[16][0] - face.pts[0][0]) * W, (face.pts[16][1] - face.pts[0][1]) * H);
  const r = Math.max(1, Math.round(faceW / 140));
  const mask = fillPolygon(grow(outline, 0.94), x0, y0, pw, ph);
  for (const pts of [face.pts.map(([u, v]) => [u * W, v * H]), charPts].filter(Boolean)) {
    for (const [a, b] of [[17, 21], [22, 26], [36, 41], [42, 47], [27, 35], [48, 59]]) { const m = fillPolygon(grow(hull(pts.slice(a, b + 1)), a === 27 ? 1.5 : 1.8), x0, y0, pw, ph); for (let i = 0; i < N; i++) if (m[i]) mask[i] = 0; }
  }
  const model = face.skin ?? skinModel(photo, W, H, face);
  const lb = new Float32Array(N); const okB = new Uint8Array(N); const okAll = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    okAll[k] = rgba[k * 4 + 3] ? 1 : 0;
    const X = x0 + (k % pw); const Y = y0 + Math.floor(k / pw); if (X >= W || Y >= H) { mask[k] = 0; continue; }
    const o = (Y * W + X) * 4; lb[k] = 0.299 * photo[o] + 0.587 * photo[o + 1] + 0.114 * photo[o + 2]; okB[k] = 1;
    if (model && !model.isSkin(photo[o], photo[o + 1], photo[o + 2])) mask[k] = 0;
  }
  // How much, easing in from the edges of that skin (so no line where it starts).
  const amt = soften(mask, pw, ph, r * 4);
  const bb = boxBlur(lb, okB, pw, ph, r);
  const blur = [0, 1, 2].map((j) => boxBlur(Float32Array.from({ length: N }, (_, k) => rgba[k * 4 + j]), okAll, pw, ph, r));
  const a0 = 0.5 * strength;
  for (let k = 0; k < N; k++) {
    if (!okAll[k] || amt[k] < 0.01) continue;
    const a = a0 * Math.min(1, amt[k] * 1.5);
    const theirs = Math.max(-14, Math.min(14, lb[k] - bb[k]));
    for (let j = 0; j < 3; j++) { const v = rgba[k * 4 + j]; rgba[k * 4 + j] = Math.max(0, Math.min(255, v - a * (v - blur[j][k]) + a * theirs)); }
  }
  return patch;
}

/**
 * The patch's fine texture matched to that face's (`photo`, RGBA W×H), `strength` of the way (0..1):
 * how sharply it's drawn, by its strongest edges and theirs (eyes, brows, lips: a Character crisper than
 * the photo softened to it; one softer, from a smaller or blurrier picture, sharpened, within reason),
 * then the photo's grain added over its skin where it has less, so it isn't the one smooth or crisp thing
 * in the picture. In place; returns the patch (with `texture`: what was measured and done).
 */
export function matchTexture(patch, photo, W, H, face, outline, strength = 0.8) {
  const { x0, y0, pw, ph, rgba, charPts } = patch;
  if (!outline || face.pts?.length !== 68 || strength <= 0 || pw < 16 || ph < 16) return patch;
  const N = pw * ph;
  const inFace = fillPolygon(outline, x0, y0, pw, ph);
  const lumOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  // That face, where the patch covers it (in the photo); and the patch, where it's solid.
  const lb = new Float32Array(N); const okB = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const X = x0 + (k % pw); const Y = y0 + Math.floor(k / pw); if (X >= W || Y >= H || X < 0 || Y < 0) continue;
    const o = (Y * W + X) * 4; lb[k] = lumOf(photo[o], photo[o + 1], photo[o + 2]); okB[k] = 1;
  }
  const okC = new Uint8Array(N); const okAll = new Uint8Array(N); const lc = new Float32Array(N);
  for (let k = 0; k < N; k++) { okC[k] = rgba[k * 4 + 3] > 200 ? 1 : 0; okAll[k] = rgba[k * 4 + 3] ? 1 : 0; lc[k] = lumOf(rgba[k * 4], rgba[k * 4 + 1], rgba[k * 4 + 2]); }
  const eB = edgesOf(lb, okB, inFace, pw, ph); const eC = edgesOf(lc, okC, inFace, pw, ph);
  const sharpB = eB ? sharpAt(lb, eB, pw) : NaN; const sharpC = eC ? sharpAt(lc, eC, pw) : NaN;
  // How much of its detail (each pixel less the 5×5 around it) to take away (−) or add (+), by how much
  // softer or crisper its edges are than the photo's (alike within a tenth: left as it is); within reason
  // (sharpening more brings out its own blockiness, softening more smears it).
  const q = sharpB > 0 && sharpC > 0 ? sharpC / sharpB : 1;
  const best = q < 0.9 ? Math.min(1, 3 * (1 / q - 1)) : q > 1.1 ? -Math.min(0.8, 1.5 * (q - 1)) : 0;
  const amt = strength * best;
  // Then grain where its skin still has less than the photo's.
  const skin = Uint8Array.from(inFace, (v) => (v ? 1 : 0));
  for (const pts of [face.pts.map(([u, v]) => [u * W, v * H]), charPts].filter(Boolean)) {
    for (const [a, b] of [[17, 21], [22, 26], [36, 41], [42, 47], [27, 35], [48, 59]]) { const m = fillPolygon(grow(hull(pts.slice(a, b + 1)), a === 27 ? 1.5 : 1.7), x0, y0, pw, ph); for (let i = 0; i < N; i++) if (m[i]) skin[i] = 0; }
  }
  const model = face.skin ?? skinModel(photo, W, H, face);
  const skB = Uint8Array.from(skin, (s, k) => { if (!s || !okB[k]) return 0; if (!model) return 1; const o = ((y0 + Math.floor(k / pw)) * W + x0 + (k % pw)) * 4; return model.isSkin(photo[o], photo[o + 1], photo[o + 2]) ? 1 : 0; });
  const grainB = grainOf(lb, okB, skB, pw, ph);
  const grainC = grainOf(lc, okC, skin, pw, ph) * Math.max(0.2, 1 + amt);
  const want = grainC + strength * (grainB - grainC);
  const noise = grainB > grainC ? Math.sqrt(Math.max(0, want * want - grainC * grainC)) : 0;
  patch.texture = { sharp: [sharpB, sharpC], grain: [grainB, grainC], amount: amt, noise };
  if (Math.abs(amt) < 0.01 && noise < 0.3) return patch;
  const blur = [0, 1, 2].map((j) => boxBlur(Float32Array.from({ length: N }, (_, k) => rgba[k * 4 + j]), okAll, pw, ph, 2));
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const k = y * pw + x; if (!okAll[k]) continue;
    // A seeded grain (the same picture gives the same result), alike in each channel (as a sensor's mostly is).
    let g = 0;
    if (noise > 0) { let h = Math.imul(x0 + x, 0x9e3779b1) ^ Math.imul(y0 + y, 0x85ebca77); h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); const u1 = (((h >>> 0) % 65535) + 1) / 65536; h = Math.imul(h ^ (h >>> 13), 0x297a2d39); const u2 = (h >>> 0) / 4294967296; g = noise * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); }
    for (let j = 0; j < 3; j++) { const v = rgba[k * 4 + j]; rgba[k * 4 + j] = Math.max(0, Math.min(255, v + amt * (v - blur[j][k]) + g)); }
  }
  return patch;
}
