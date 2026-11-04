// FaceMask → 🎭 Insert Character, fitted: a Character that has a face of its own is bent onto the
// face in the photo, not just laid on it. Starting from the eyes, about thirty of its landmarks (jaw
// and chin, brows, nose, eye corners, mouth) are pulled onto the face's own (moving least squares, so
// it bends smoothly and stays itself away from the face); then it's trimmed, softly, to that head's
// outline (so a different hairline, ears or neck don't stick out); and its colors are blended into
// the photo seamlessly: at its edge it takes on what's next to it there (above, below, each side, each
// differently), eased smoothly inward. Pure: RGBA in, patch pixels out.

import { faceOutline, alignOnFace } from '../../lib/face-core.js';
import { placedCorners } from './place.js';
import { membrane } from './cleanup.js';
import { featherAlpha } from '../cutout/cutout-core.js';

/** The landmarks pulled into line (of the 68): jaw and chin, brows, nose, eye corners, mouth. */
export const CONTROL = [0, 2, 4, 6, 8, 10, 12, 14, 16, 17, 19, 21, 22, 24, 26, 27, 30, 31, 35, 36, 39, 42, 45, 48, 51, 54, 57];

/**
 * The moving-least-squares similarity map (Schaefer et al.) that takes each point `from[i]` exactly to
 * `to[i]` and everything in between smoothly (each point's own best scale-and-turn, weighted by how
 * near the control points are): (x, y) → [x', y'].
 */
export function mlsMap(from, to) {
  const n = from.length;
  return (x, y) => {
    let sw = 0; let px = 0; let py = 0; let qx = 0; let qy = 0;
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const d2 = (from[i][0] - x) ** 2 + (from[i][1] - y) ** 2;
      if (d2 < 1e-9) return [to[i][0], to[i][1]];
      w[i] = 1 / d2; sw += w[i];
      px += w[i] * from[i][0]; py += w[i] * from[i][1]; qx += w[i] * to[i][0]; qy += w[i] * to[i][1];
    }
    px /= sw; py /= sw; qx /= sw; qy /= sw;
    let mu = 0; let c = 0; let s = 0;
    for (let i = 0; i < n; i++) {
      const ax = from[i][0] - px; const ay = from[i][1] - py; const bx = to[i][0] - qx; const by = to[i][1] - qy;
      mu += w[i] * (ax * ax + ay * ay); c += w[i] * (ax * bx + ay * by); s += w[i] * (ax * by - ay * bx);
    }
    if (mu < 1e-12) return [qx + x - px, qy + y - py];
    c /= mu; s /= mu;
    const dx = x - px; const dy = y - py;
    return [qx + c * dx - s * dy, qy + s * dx + c * dy];
  };
}

/** A polygon (pixels) filled into a mask over the box (x0, y0, pw × ph): 1 inside. */
function fillPolygon(poly, x0, y0, pw, ph) {
  const m = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    const cy = y0 + y + 0.5; const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - x0 - 0.5)); x < Math.min(pw, Math.floor(xs[k + 1] - x0 - 0.5) + 1); x++) m[y * pw + x] = 1;
  }
  return m;
}
/** A mask blurred (box, twice over) by radius r: its edge made a soft ramp. */
function soften(m, w, h, r) {
  if (r < 1) return m;
  const pass = (src, horiz) => {
    const out = new Float32Array(src.length); const [n, lines] = horiz ? [w, h] : [h, w];
    for (let l = 0; l < lines; l++) {
      const at = (i) => (horiz ? l * w + i : i * w + l);
      let acc = 0; let cnt = 0;
      for (let i = 0; i < Math.min(n, r + 1); i++) { acc += src[at(i)]; cnt++; }
      for (let i = 0; i < n; i++) {
        out[at(i)] = acc / cnt;
        if (i + r + 1 < n) { acc += src[at(i + r + 1)]; cnt++; }
        if (i - r >= 0) { acc -= src[at(i - r)]; cnt--; }
      }
    }
    return out;
  };
  let a = m;
  for (let k = 0; k < 2; k++) a = pass(pass(a, true), false);
  return a;
}

/**
 * The Character (RGBA cw×ch, with its own face `charFace`) fitted onto `face` in a W×H picture:
 * placed by its eyes first (alignOnFace), then bent so its landmarks meet the face's, and (with
 * `trim`) faded out softly beyond that head's outline. Returns the patch { x0, y0, pw, ph, rgba } in
 * the picture's pixels (alpha = coverage), or null when it's off the picture.
 */
export function fitPatch(img, cw, ch, charFace, face, W, H, { trim = true } = {}) {
  const base = alignOnFace(charFace, cw, ch, face, W, H);
  // Where the Character's edges go when just placed by the eyes: anchors that keep it steady far from the face.
  const anchorsSrc = [[0, 0], [cw / 2, 0], [cw, 0], [cw, ch / 2], [cw, ch], [cw / 2, ch], [0, ch], [0, ch / 2]];
  const k = base.width / cw; const co = Math.cos(base.rot); const si = Math.sin(base.rot);
  const place = ([x, y]) => { const dx = (x - cw / 2) * k; const dy = (y - ch / 2) * k; return [base.x + dx * co - dy * si, base.y + dx * si + dy * co]; };
  const usePts = charFace.pts?.length === 68 && face.pts?.length === 68;
  const tgt = usePts ? CONTROL.map((i) => [face.pts[i][0] * W, face.pts[i][1] * H]) : [face.eyes[0], face.eyes[1], face.mouth].map(([u, v]) => [u * W, v * H]);
  const src = usePts ? CONTROL.map((i) => [charFace.pts[i][0] * cw, charFace.pts[i][1] * ch]) : [charFace.eyes[0], charFace.eyes[1], charFace.mouth].map(([u, v]) => [u * cw, v * ch]);
  // Picture point → Character point (the inverse direction, for sampling).
  const map = mlsMap([...tgt, ...anchorsSrc.map(place)], [...src, ...anchorsSrc]);
  const cs = placedCorners(base, cw / ch);
  const pad = base.width * 0.06;
  const x0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p[0])) - pad)); const x1 = Math.min(W, Math.ceil(Math.max(...cs.map((p) => p[0])) + pad));
  const y0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p[1])) - pad)); const y1 = Math.min(H, Math.ceil(Math.max(...cs.map((p) => p[1])) + pad));
  if (x1 <= x0 || y1 <= y0) return null;
  const pw = x1 - x0; const ph = y1 - y0;
  // The map on a coarse grid (every 4 px), smoothly in between: quick, and it bends gently anyway.
  const G = 4; const gw = Math.ceil(pw / G) + 1; const gh = Math.ceil(ph / G) + 1;
  const grid = new Float32Array(gw * gh * 2);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const q = map(x0 + i * G + 0.5, y0 + j * G + 0.5); grid[(j * gw + i) * 2] = q[0]; grid[(j * gw + i) * 2 + 1] = q[1]; }
  const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++) {
    const gy = y / G; const j0 = Math.min(gh - 2, Math.floor(gy)); const ty = gy - j0;
    for (let x = 0; x < pw; x++) {
      const gx = x / G; const i0 = Math.min(gw - 2, Math.floor(gx)); const tx = gx - i0;
      const g = (ii, jj, c) => grid[((j0 + jj) * gw + i0 + ii) * 2 + c];
      const u = (g(0, 0, 0) * (1 - tx) + g(1, 0, 0) * tx) * (1 - ty) + (g(0, 1, 0) * (1 - tx) + g(1, 1, 0) * tx) * ty - 0.5;
      const v = (g(0, 0, 1) * (1 - tx) + g(1, 0, 1) * tx) * (1 - ty) + (g(0, 1, 1) * (1 - tx) + g(1, 1, 1) * tx) * ty - 0.5;
      if (u < -1 || v < -1 || u > cw || v > ch) continue;
      const ua = Math.floor(u); const va = Math.floor(v); const fu = u - ua; const fv = v - va;
      let a = 0; const col = [0, 0, 0];
      for (const [X, Y, wt] of [[ua, va, (1 - fu) * (1 - fv)], [ua + 1, va, fu * (1 - fv)], [ua, va + 1, (1 - fu) * fv], [ua + 1, va + 1, fu * fv]]) {
        if (X < 0 || Y < 0 || X >= cw || Y >= ch || !wt) continue;
        const o = (Y * cw + X) * 4; const al = img[o + 3] * wt; a += al;
        col[0] += img[o] * al; col[1] += img[o + 1] * al; col[2] += img[o + 2] * al;
      }
      if (a < 0.5) continue;
      const o = (y * pw + x) * 4;
      rgba[o] = col[0] / a; rgba[o + 1] = col[1] / a; rgba[o + 2] = col[2] / a; rgba[o + 3] = a;
    }
  }
  if (trim) {
    // The head's outline in the photo, a little roomier (hair and ears count), its edge a soft ramp.
    const out = faceOutline(face, W, H, 64).map(([u, v]) => [u * W, v * H]);
    const cx = out.reduce((s, p) => s + p[0], 0) / out.length; const cy = out.reduce((s, p) => s + p[1], 0) / out.length;
    const roomy = out.map(([x, y]) => [cx + (x - cx) * 1.12, cy + (y - cy) * 1.12]);
    const headH = Math.max(...out.map((p) => p[1])) - Math.min(...out.map((p) => p[1]));
    const m = soften(fillPolygon(roomy, x0, y0, pw, ph), pw, ph, Math.max(2, Math.round(headH * 0.04)));
    for (let i = 0; i < pw * ph; i++) rgba[i * 4 + 3] *= Math.min(1, m[i] * 1.15);
  }
  return { x0, y0, pw, ph, rgba };
}

/**
 * The patch's colors blended into the photo (`photo`, RGBA W×H) seamlessly, by `strength` (0–1): at
 * its edge, how the photo just outside differs from the patch just inside (averaged over a few pixels,
 * so texture doesn't count; above, below and each side each its own), spread smoothly across it, so
 * it meets every side of what's around it with no seam while keeping its own detail. Its edge is
 * softened by a couple of pixels too. In place; returns the patch.
 */
export function blendIn(patch, photo, W, H, strength = 0.8, { soft = 2 } = {}) {
  const { x0, y0, pw, ph, rgba } = patch;
  // Colors first (on its edge as it is), then the soft edge: the rim pixels softening adds have no
  // color of their own, so its own edge colors are carried out to them first.
  if (strength > 0) blendColors(rgba, x0, y0, pw, ph, photo, W, H, strength);
  if (soft) { bleed(rgba, pw, ph, soft * 3 + 2); featherAlpha(rgba, pw, ph, soft); }
  return patch;
}

/** The colors of the pixels it covers carried out into the clear pixels around it, `rings` deep (alpha left as it is). */
function bleed(rgba, pw, ph, rings) {
  let has = Uint8Array.from({ length: pw * ph }, (_, i) => (rgba[i * 4 + 3] > 24 ? 1 : 0));
  for (let r = 0; r < rings; r++) {
    const next = Uint8Array.from(has);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = y * pw + x; if (has[i]) continue;
      const sum = [0, 0, 0]; let n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx; const Y = y + dy; if (X < 0 || Y < 0 || X >= pw || Y >= ph || !has[Y * pw + X]) continue;
        const o = (Y * pw + X) * 4; sum[0] += rgba[o]; sum[1] += rgba[o + 1]; sum[2] += rgba[o + 2]; n++;
      }
      if (n) { rgba[i * 4] = sum[0] / n; rgba[i * 4 + 1] = sum[1] / n; rgba[i * 4 + 2] = sum[2] / n; next[i] = 1; }
    }
    has = next;
  }
}

function blendColors(rgba, x0, y0, pw, ph, photo, W, H, strength) {
  const on = (x, y) => x >= 0 && y >= 0 && x < pw && y < ph && rgba[(y * pw + x) * 4 + 3] > 24;
  const free = new Uint8Array(pw * ph); const diff = new Float32Array(pw * ph * 3);
  const R = 3;
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    if (!on(x, y)) continue;
    const k = y * pw + x;
    const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
    if (!edge) { free[k] = 1; continue; }
    const out = [0, 0, 0]; const inn = [0, 0, 0]; let no = 0; let ni = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const X = x + dx; const Y = y + dy; const PX = x0 + X; const PY = y0 + Y;
      if (PX < 0 || PY < 0 || PX >= W || PY >= H) continue;
      if (on(X, Y)) { const o = (Y * pw + X) * 4; inn[0] += rgba[o]; inn[1] += rgba[o + 1]; inn[2] += rgba[o + 2]; ni++; } else { const o = (PY * W + PX) * 4; out[0] += photo[o]; out[1] += photo[o + 1]; out[2] += photo[o + 2]; no++; }
    }
    if (no && ni) for (let c = 0; c < 3; c++) diff[k * 3 + c] = out[c] / no - inn[c] / ni;
    else free[k] = 1;
  }
  membrane(diff, free, pw, ph);
  for (let i = 0; i < pw * ph; i++) {
    if (!rgba[i * 4 + 3]) continue;
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] += strength * diff[i * 3 + c];
  }
}
