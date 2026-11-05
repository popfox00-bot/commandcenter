// @ts-check
// FaceMask's fitting, color and light: the Character recolored to that face's skin (recolor), relit with its
// light and tone (relight), and shaded by that face's shape (faceNormals, shadeByShape). Pure; in place on a patch.

import { colorStats, matchColors } from '../../lib/color-match.js';
import { boxBlur, convexHull as hull, fillPolygon, scalePolygon as grow, softenMask as soften } from '../../lib/geometry.js';
import { membrane } from './cleanup.js';
import { skinModel } from './fit-skin.js';
import { triangulate } from './face3d.js';

/**
 * The Character recolored to the face it's on: inside that face's outline, its colors moved toward
 * the photo face's skin (their average and spread, in Lab), as far as `strength` says, the same way
 * all over it, so its own shading and detail (the face as it is) stay. In place on the patch.
 */
export function recolor(patch, photo, W, H, outline, strength = 0.8, face = null) {
  if (strength <= 0 || !outline) return patch;
  const { x0, y0, pw, ph, rgba } = patch;
  const inFace = fillPolygon(outline, x0, y0, pw, ph);
  // What it's matched to: that face's skin, and its neck's (just under the jaw, where it's skin), so the
  // face and the body around it agree.
  /** @type {ArrayLike<number>} */
  let ref = inFace;
  if (face?.pts?.length === 68) {
    const P = face.pts.map(([u, v]) => [u * W, v * H]); const fh = Math.hypot(P[8][0] - P[27][0], P[8][1] - P[27][1]);
    const down = [(P[8][0] - P[27][0]) / (fh || 1), (P[8][1] - P[27][1]) / (fh || 1)];
    const neck = [...P.slice(5, 12), ...P.slice(5, 12).reverse().map(([x, y]) => [x + down[0] * fh * 0.45, y + down[1] * fh * 0.45])];
    const nm = fillPolygon(neck, x0, y0, pw, ph); const skin = skinModel(photo, W, H, face);
    ref = Uint8Array.from(inFace, (v, i) => {
      if (v) return 1; if (!nm[i] || !skin) return 0;
      const X = x0 + (i % pw); const Y = y0 + Math.floor(i / pw); if (X >= W || Y >= H) return 0; const o = (Y * W + X) * 4;
      return skin.isSkin(photo[o], photo[o + 1], photo[o + 2]) ? 1 : 0;
    });
  }
  const photoCrop = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const X = x0 + x; const Y = y0 + y; if (X >= W || Y >= H) continue;
    const o = (Y * W + X) * 4; const q = (y * pw + x) * 4;
    photoCrop[q] = photo[o]; photoCrop[q + 1] = photo[o + 1]; photoCrop[q + 2] = photo[o + 2]; photoCrop[q + 3] = 255;
  }
  const target = colorStats(photoCrop, pw, ph, (i) => ref[i] > 0, 2);
  const own = colorStats(rgba, pw, ph, (i) => inFace[i] > 0 && rgba[i * 4 + 3] > 200, 2);
  if (!target || !own) return patch;
  const out = matchColors(rgba, pw, ph, target, strength, own);
  for (let i = 0; i < pw * ph; i++) if (rgba[i * 4 + 3]) { rgba[i * 4] = out[i * 4]; rgba[i * 4 + 1] = out[i * 4 + 1]; rgba[i * 4 + 2] = out[i * 4 + 2]; }
  return patch;
}

/**
 * The Character relit and toned like the face it goes on: the smooth light and color across that face's
 * skin (its eyes, brows, nose and mouth left out, filled in from around them) and the same across the
 * Character's, and the Character's swapped for that face's, each color on its own, `strength` of the way
 * (0..1): lit from the same side, and the middle of its face the same skin tone as that face (a flushed
 * cheek or a shadow of its own evened out), its own detail kept. In place on the patch.
 */
export function relight(patch, photo, W, H, face, outline, strength = 0.8) {
  const { x0, y0, pw, ph, rgba, charPts } = patch;
  if (!outline || face.pts?.length !== 68 || strength <= 0) return patch;
  const inFace = fillPolygon(outline, x0, y0, pw, ph);
  // The features (each with room around it), its and that face's: left out of the shading.
  const feat = new Uint8Array(pw * ph);
  const groups = [[17, 21], [22, 26], [36, 41], [42, 47], [27, 35], [48, 59]];
  for (const pts of [face.pts.map(([u, v]) => [u * W, v * H]), charPts].filter(Boolean)) {
    for (const [a, b] of groups) {
      const m = fillPolygon(grow(hull(pts.slice(a, b + 1)), a === 27 ? 1.5 : 1.7), x0, y0, pw, ph);
      for (let i = 0; i < m.length; i++) if (m[i]) feat[i] = 1;
    }
  }
  const faceW = Math.hypot((face.pts[16][0] - face.pts[0][0]) * W, (face.pts[16][1] - face.pts[0][1]) * H);
  // Worked out on a coarse grid (it's smooth anyway), then spread back smoothly: quick.
  const G = Math.max(2, Math.round(faceW / 80)); const gw = Math.ceil(pw / G); const gh = Math.ceil(ph / G);
  const R = Math.max(1, Math.round((faceW * 0.09) / G));
  /** The smooth color over the face's skin (each channel), from `at(k)` ([r, g, b], or null where it isn't skin). */
  const shade = (at) => {
    const sum = new Float32Array(gw * gh * 3); const cnt = new Float32Array(gw * gh);
    for (let k = 0; k < pw * ph; k++) {
      if (!inFace[k] || feat[k]) continue; const c = at(k); if (!c) continue;
      const q = Math.floor(Math.floor(k / pw) / G) * gw + Math.floor((k % pw) / G); cnt[q]++;
      sum[q * 3] += c[0]; sum[q * 3 + 1] += c[1]; sum[q * 3 + 2] += c[2];
    }
    let n = 0; const mean = [0, 0, 0];
    for (let q = 0; q < gw * gh; q++) if (cnt[q] >= Math.max(1, G * G * 0.3)) { n++; for (let j = 0; j < 3; j++) { sum[q * 3 + j] /= cnt[q]; mean[j] += sum[q * 3 + j]; } } else cnt[q] = 0;
    if (n < 12) return null;
    const free = new Uint8Array(gw * gh); const fixed = new Uint8Array(gw * gh);
    for (let q = 0; q < gw * gh; q++) { if (cnt[q]) fixed[q] = 1; else { free[q] = 1; for (let j = 0; j < 3; j++) sum[q * 3 + j] = mean[j] / n; } }
    membrane(sum, free, gw, gh);
    return [0, 1, 2].map((j) => soften(Float32Array.from({ length: gw * gh }, (_, q) => sum[q * 3 + j]), gw, gh, R));
  };
  const skin = skinModel(photo, W, H, face);
  // (Theirs from their skin only: not hair or shadow at the edge of the face.)
  const theirs = shade((k) => { const X = x0 + (k % pw); const Y = y0 + Math.floor(k / pw); if (X >= W || Y >= H) return null; const o = (Y * W + X) * 4; if (skin && !skin.isSkin(photo[o], photo[o + 1], photo[o + 2])) return null; return [photo[o], photo[o + 1], photo[o + 2]]; });
  const mine = shade((k) => (rgba[k * 4 + 3] > 200 ? [rgba[k * 4], rgba[k * 4 + 1], rgba[k * 4 + 2]] : null));
  if (!theirs || !mine) return patch;
  // Their light and tone over its own, each channel, evened out over the face (the overall color is
  // recolor's), within reason: a flushed or shadowed patch of its own takes on that face's skin there.
  const at = (f, x, y) => { const gx = Math.min(gw - 1, Math.max(0, (x + 0.5) / G - 0.5)); const gy = Math.min(gh - 1, Math.max(0, (y + 0.5) / G - 0.5)); const i0 = Math.min(gw - 2, Math.floor(gx)); const j0 = Math.min(gh - 2, Math.floor(gy)); const tx = gw > 1 ? gx - i0 : 0; const ty = gh > 1 ? gy - j0 : 0; const A = j0 * gw + Math.max(0, i0); const B = gw > 1 ? A + 1 : A; const Cc = gh > 1 ? A + gw : A; const Dd = gw > 1 ? Cc + 1 : Cc; return (f[A] * (1 - tx) + f[B] * tx) * (1 - ty) + (f[Cc] * (1 - tx) + f[Dd] * tx) * ty; };
  const avg = [0, 0, 0]; let n = 0;
  for (let q = 0; q < gw * gh; q++) { const k = Math.min(pw * ph - 1, Math.floor(q / gw) * G * pw + (q % gw) * G); if (!inFace[k]) continue; n++; for (let j = 0; j < 3; j++) avg[j] += theirs[j][q] / Math.max(1, mine[j][q]); }
  if (!n) return patch;
  for (let j = 0; j < 3; j++) avg[j] /= n;
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const k = y * pw + x; if (!rgba[k * 4 + 3]) continue;
    for (let j = 0; j < 3; j++) {
      const r = Math.max(0.72, Math.min(1.35, at(theirs[j], x, y) / Math.max(1, at(mine[j], x, y)) / avg[j]));
      rgba[k * 4 + j] = Math.min(255, rgba[k * 4 + j] * (1 + strength * (r - 1)));
    }
  }
  return patch;
}

/**
 * The face's surface, which way it faces at each pixel, from its dense mesh (`mesh`: 478 points, x and y
 * 0..1 of the W×H photo, z into the picture in units of x): its points joined into triangles, each point
 * facing the average of its triangles (toward the camera), smoothly in between; over the box (x0, y0,
 * pw × ph). Float32Array of [nx, ny, nz] per pixel (0,0,0 off the face), or null.
 */
export function faceNormals(mesh, W, H, x0, y0, pw, ph) {
  if (mesh?.length !== 478) return null;
  const P = mesh.map(([u, v, z]) => [u * W, v * H, z * W]);
  const tris = triangulate(P.map((p) => [p[0], p[1]]));
  // (No triangle across the open mouth or the eyes' long thin gaps: only ones of a sensible size.)
  const span = Math.max(...P.map((p) => p[0])) - Math.min(...P.map((p) => p[0]));
  const keep = tris.filter(([a, b, c]) => Math.max(Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]), Math.hypot(P[b][0] - P[c][0], P[b][1] - P[c][1]), Math.hypot(P[c][0] - P[a][0], P[c][1] - P[a][1])) < span * 0.12);
  const vn = P.map(() => [0, 0, 0]);
  for (const [a, b, c] of keep) {
    const u = [P[b][0] - P[a][0], P[b][1] - P[a][1], P[b][2] - P[a][2]]; const v = [P[c][0] - P[a][0], P[c][1] - P[a][1], P[c][2] - P[a][2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (n[2] > 0) n = n.map((t) => -t); // toward the camera (z is into the picture)
    for (const i of [a, b, c]) for (let j = 0; j < 3; j++) vn[i][j] += n[j];
  }
  for (const n of vn) { const l = Math.hypot(...n) || 1; for (let j = 0; j < 3; j++) n[j] /= l; }
  const out = new Float32Array(pw * ph * 3);
  for (const [a, b, c] of keep) {
    const [ax, ay] = P[a]; const [bx, by] = P[b]; const [cx, cy] = P[c];
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay); if (Math.abs(det) < 1e-6) continue;
    const mx0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - x0)); const mx1 = Math.min(pw - 1, Math.ceil(Math.max(ax, bx, cx) - x0));
    const my0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - y0)); const my1 = Math.min(ph - 1, Math.ceil(Math.max(ay, by, cy) - y0));
    for (let y = my0; y <= my1; y++) for (let x = mx0; x <= mx1; x++) {
      const px = x0 + x + 0.5; const py = y0 + y + 0.5;
      const l1 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / det; const l2 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / det; const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const k = (y * pw + x) * 3; let n0 = 0; let n1 = 0; let n2 = 0;
      for (const [w, i] of [[l1, a], [l2, b], [l3, c]]) { n0 += w * vn[i][0]; n1 += w * vn[i][1]; n2 += w * vn[i][2]; }
      const l = Math.hypot(n0, n1, n2) || 1; out[k] = n0 / l; out[k + 1] = n1 / l; out[k + 2] = n2 / l;
    }
  }
  return out;
}

/**
 * Lit as that face is lit, by its shape (`photo`, RGBA W×H; `face.mesh`, its dense mesh): how bright its
 * skin is, fitted as an even light plus one from a direction (brightness = a + b·n, n which way the
 * surface faces there), and the same fitted to the Character as it now is on it; then the Character
 * shaded by the difference, so the side of its nose, its cheeks and its brow catch the light (and the
 * shadow) where that face's do. Its overall tone left as it is (that's recolor's). `strength` 0..1.
 * In place; returns the patch (with `light`: the two fits).
 */
export function shadeByShape(patch, photo, W, H, face, outline, strength = 0.8) {
  const { x0, y0, pw, ph, rgba, charPts } = patch;
  if (!outline || face.pts?.length !== 68 || strength <= 0) return patch;
  const nrm = faceNormals(face.mesh, W, H, x0, y0, pw, ph); if (!nrm) return patch;
  const N = pw * ph;
  const skin = fillPolygon(grow(outline, 0.95), x0, y0, pw, ph);
  for (const pts of [face.pts.map(([u, v]) => [u * W, v * H]), charPts].filter(Boolean)) {
    for (const [a, b] of [[17, 21], [22, 26], [36, 41], [42, 47], [48, 59]]) { const m = fillPolygon(grow(hull(pts.slice(a, b + 1)), 1.6), x0, y0, pw, ph); for (let i = 0; i < N; i++) if (m[i]) skin[i] = 0; }
  }
  const model = face.skin ?? skinModel(photo, W, H, face);
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  /** a + b·n fitted to the brightness `at(k)` over the skin (least squares, every other pixel). */
  const fit = (at) => {
    const A = Array.from({ length: 4 }, () => new Float64Array(4)); const B = new Float64Array(4); let n = 0;
    for (let k = 0; k < N; k += 2) {
      if (!skin[k] || (!nrm[k * 3] && !nrm[k * 3 + 1] && !nrm[k * 3 + 2])) continue;
      const L = at(k); if (L == null) continue;
      const f = [1, nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]]; n++;
      for (let i = 0; i < 4; i++) { B[i] += f[i] * L; for (let j = 0; j < 4; j++) A[i][j] += f[i] * f[j]; }
    }
    if (n < 300) return null;
    for (let i = 0; i < 4; i++) A[i][i] += 1e-3 * n; // (a touch of steadiness)
    // Solve (Gauss).
    const M = A.map((r, i) => [...r, B[i]]);
    for (let c = 0; c < 4; c++) {
      let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-9) return null;
      for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let j = c; j < 5; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map((r, i) => r[4] / r[i]);
  };
  const theirs = fit((k) => { const X = x0 + (k % pw); const Y = y0 + Math.floor(k / pw); if (X >= W || Y >= H) return null; const o = (Y * W + X) * 4; if (model && !model.isSkin(photo[o], photo[o + 1], photo[o + 2])) return null; return lum(photo[o], photo[o + 1], photo[o + 2]); });
  const mine = fit((k) => (rgba[k * 4 + 3] > 200 ? lum(rgba[k * 4], rgba[k * 4 + 1], rgba[k * 4 + 2]) : null));
  if (!theirs || !mine || theirs[0] <= 1 || mine[0] <= 1) return patch;
  patch.light = { theirs, mine };
  // Each light relative to its own even light (the overall tone isn't this step's).
  const shade = (c, k) => (c[0] + c[1] * nrm[k * 3] + c[2] * nrm[k * 3 + 1] + c[3] * nrm[k * 3 + 2]) / c[0];
  // How much lighter or darker each pixel is to be, within a little (a strong change looks painted on),
  // then smoothed wide (so the mesh's triangles and its gaps never show as edges), eased in from the
  // mesh's edge.
  const faceW = Math.hypot(...[0, 1].map((j) => (face.pts[16][j] - face.pts[0][j]) * (j ? H : W)));
  const on = new Uint8Array(N); const ratio = new Float32Array(N).fill(1);
  for (let k = 0; k < N; k++) {
    if (!(nrm[k * 3] || nrm[k * 3 + 1] || nrm[k * 3 + 2])) continue;
    on[k] = 1; ratio[k] = Math.max(0.88, Math.min(1.12, shade(theirs, k) / Math.max(0.2, shade(mine, k))));
  }
  const smooth = boxBlur(boxBlur(ratio, on, pw, ph, Math.max(2, Math.round(faceW * 0.05))), on, pw, ph, Math.max(2, Math.round(faceW * 0.05)));
  const ease = soften(Float32Array.from(on), pw, ph, Math.max(2, Math.round(faceW * 0.06)));
  for (let k = 0; k < N; k++) {
    if (!rgba[k * 4 + 3] || ease[k] < 0.01) continue;
    const f = 1 + strength * ease[k] * (smooth[k] - 1);
    for (let j = 0; j < 3; j++) rgba[k * 4 + j] = Math.min(255, rgba[k * 4 + j] * f);
  }
  return patch;
}
