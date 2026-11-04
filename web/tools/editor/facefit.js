// FaceMask → 🎭 Insert Character, fitted: a Character that has a face of its own is bent onto the
// face in the photo, not just laid on it. Starting from the eyes, about thirty of its landmarks (jaw
// and chin, brows, nose, eye corners, mouth) are pulled onto the face's own (moving least squares, so
// it bends smoothly and stays itself away from the face); then it's trimmed, softly, to that head's
// outline (so a different hairline, ears or neck don't stick out); and its colors are blended into
// the photo seamlessly: at its edge it takes on what's next to it there (above, below, each side, each
// differently), eased smoothly inward. Pure: RGBA in, patch pixels out.

import { faceOutline, faceContour, alignOnFace, similarityFit } from '../../lib/face-core.js';
import { placedCorners } from './place.js';
import { membrane } from './cleanup.js';
import { featherAlpha } from '../cutout/cutout-core.js';
import { rgbToLab, colorStats, matchColors } from '../../lib/color-match.js';

/** The landmarks pulled into line (of the 68): jaw and chin, brows, nose, eye corners, mouth. */
export const CONTROL = [0, 2, 4, 6, 8, 10, 12, 14, 16, 17, 19, 21, 22, 24, 26, 27, 30, 31, 35, 36, 39, 42, 45, 48, 51, 54, 57];

/** Each of the 68 landmarks' mirror image (left ↔ right): jaw, brows, nose, eyes, mouth. */
const MIRROR = (() => {
  const m = Array.from({ length: 68 }, (_, i) => i);
  const pair = (a, b) => { m[a] = b; m[b] = a; };
  for (let i = 0; i < 8; i++) pair(i, 16 - i);
  for (let i = 0; i < 5; i++) pair(17 + i, 26 - i);
  for (const [a, b] of [[31, 35], [32, 34], [36, 45], [37, 44], [38, 43], [39, 42], [40, 47], [41, 46], [48, 54], [49, 53], [50, 52], [55, 59], [56, 58], [60, 64], [61, 63], [65, 67]]) pair(a, b);
  return m;
})();

/** A face (0..1 points) as it is in the picture flipped left to right: each landmark in its mirror's place. */
export function mirrorFace(face) {
  const m = ([u, v]) => [1 - u, v];
  const { outline, ...f } = face; // eslint-disable-line no-unused-vars
  return {
    ...f, eyes: [m(face.eyes[1]), m(face.eyes[0])], mouth: m(face.mouth), nose: m(face.nose), angle: -face.angle,
    box: { ...face.box, x: 1 - face.box.x - face.box.w }, pts: face.pts?.map((_, i) => m(face.pts[MIRROR[i]])),
  };
}

/** Pixels ({ rgba, w, h }) flipped left to right. */
export function mirrorPixels({ rgba, w, h }) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = (y * w + x) * 4; const b = (y * w + (w - 1 - x)) * 4;
    out[b] = rgba[a]; out[b + 1] = rgba[a + 1]; out[b + 2] = rgba[a + 2]; out[b + 3] = rgba[a + 3];
  }
  return { rgba: out, w, h };
}

/**
 * Which way a face looks: where its nose tip sits between its ears (along the jaw from one side to the
 * other), from -0.5 to 0.5; 0 straight on. 0 without the landmarks.
 */
export function faceYaw(face, W, H) {
  const p = face.pts; if (p?.length !== 68) return 0;
  const ux = (p[16][0] - p[0][0]) * W; const uy = (p[16][1] - p[0][1]) * H; const L = ux * ux + uy * uy;
  if (L < 1e-6) return 0;
  const dx = (p[30][0] - (p[0][0] + p[16][0]) / 2) * W; const dy = (p[30][1] - (p[0][1] + p[16][1]) / 2) * H;
  return (dx * ux + dy * uy) / L;
}

/** Whether the Character should be flipped to look the same way as the face it goes on (it looks clearly the other way). */
export function shouldFlip(charFace, cw, ch, face, W, H) {
  const a = faceYaw(charFace, cw, ch); const b = faceYaw(face, W, H);
  return Math.abs(a - b) - Math.abs(a + b) > 0.08;
}

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
 * Where the Character goes before it's bent: sized and turned to the face by all its landmarks at
 * once (jaw, brows, nose, eyes, mouth: a least-squares fit, the eyes counting most), so its size suits
 * the face as a whole, not just the eyes' spacing. By the eyes alone when the landmarks aren't there.
 * { x, y, width, rot } in the picture's pixels.
 */
export function bestPlacement(charFace, cw, ch, face, W, H) {
  if (charFace.pts?.length !== 68 || face.pts?.length !== 68) return alignOnFace(charFace, cw, ch, face, W, H);
  const from = CONTROL.map((i) => [charFace.pts[i][0] * cw, charFace.pts[i][1] * ch]);
  const to = CONTROL.map((i) => [face.pts[i][0] * W, face.pts[i][1] * H]);
  const weights = CONTROL.map((i) => (i >= 36 && i <= 45 ? 3 : 1));
  const m = similarityFit(from, to, weights);
  if (!(m.s > 0) || !Number.isFinite(m.s)) return alignOnFace(charFace, cw, ch, face, W, H);
  const c = Math.cos(m.rot) * m.s; const s = Math.sin(m.rot) * m.s;
  return { x: c * (cw / 2) - s * (ch / 2) + m.tx, y: s * (cw / 2) + c * (ch / 2) + m.ty, width: m.s * cw, rot: m.rot };
}

/** A polygon grown by `k` around its middle. */
const grow = (poly, k) => {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length; const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
};

/** How much of each of the Character's pixels is its own face (0..1): inside its jaw and its own hairline, a soft edge just inside. */
function ownMask(img, cw, ch, charFace) {
  const poly = targetOutline(img, cw, ch, charFace) ?? faceContour(charFace, cw, ch, { forehead: 0.55 });
  if (!poly) return null;
  // Roomier along the jaw (the face it goes on trims there), not past its own hairline (no hair of its own).
  const g = grow(poly, 1.05); const roomy = poly.map((p, i) => (i <= 16 && !poly.snapped?.[i] ? g[i] : p));
  const hh = Math.max(...roomy.map((p) => p[1])) - Math.min(...roomy.map((p) => p[1]));
  const m = soften(fillPolygon(roomy, 0, 0, cw, ch), cw, ch, Math.max(1, Math.round(hh * 0.05)));
  for (let i = 0; i < m.length; i++) m[i] = Math.max(0, Math.min(1, (m[i] - 0.5) * 2.2));
  return m;
}

/**
 * The Character (RGBA cw×ch, with its own face `charFace`) fitted onto `face` in a W×H picture:
 * placed by its eyes first (alignOnFace), then bent so its landmarks meet the face's, and (with
 * `trim`) faded out softly beyond that head's outline. Returns the patch { x0, y0, pw, ph, rgba } in
 * the picture's pixels (alpha = coverage), or null when it's off the picture.
 */
export function fitPatch(img, cw, ch, charFace, face, W, H, { trim = true, outline = null, bend = 0.35, own = true } = {}) {
  const base = bestPlacement(charFace, cw, ch, face, W, H);
  // Where the Character's edges go when just placed by the eyes: anchors that keep it steady far from the face.
  const anchorsSrc = [[0, 0], [cw / 2, 0], [cw, 0], [cw, ch / 2], [cw, ch], [cw / 2, ch], [0, ch], [0, ch / 2]];
  const k = base.width / cw; const co = Math.cos(base.rot); const si = Math.sin(base.rot);
  const place = ([x, y]) => { const dx = (x - cw / 2) * k; const dy = (y - ch / 2) * k; return [base.x + dx * co - dy * si, base.y + dx * si + dy * co]; };
  const usePts = charFace.pts?.length === 68 && face.pts?.length === 68;
  const tgt = usePts ? CONTROL.map((i) => [face.pts[i][0] * W, face.pts[i][1] * H]) : [face.eyes[0], face.eyes[1], face.mouth].map(([u, v]) => [u * W, v * H]);
  const src = usePts ? CONTROL.map((i) => [charFace.pts[i][0] * cw, charFace.pts[i][1] * ch]) : [charFace.eyes[0], charFace.eyes[1], charFace.mouth].map(([u, v]) => [u * cw, v * ch]);
  // Picture point → Character point (the inverse direction, for sampling): mostly the plain placement
  // (its face kept as it is: eyes, nose and mouth in their own proportions), bent only by `bend` of
  // the way toward meeting the face's landmarks (so its outline follows the new face's jaw).
  const mls = mlsMap([...tgt, ...anchorsSrc.map(place)], [...src, ...anchorsSrc]);
  const unplace = (x, y) => { const dx = x - base.x; const dy = y - base.y; return [(dx * co + dy * si) / k + cw / 2, (-dx * si + dy * co) / k + ch / 2]; };
  const map = (x, y) => { const r = unplace(x, y); if (bend <= 0) return r; const q = mls(x, y); return [r[0] + bend * (q[0] - r[0]), r[1] + bend * (q[1] - r[1])]; };
  const cs = placedCorners(base, cw / ch);
  const pad = base.width * 0.06;
  // Room for the whole face it goes on too (its outline and a little past it), so the blend can reach
  // the parts of it the Character doesn't cover.
  const pts = outline ? [...cs, ...outline] : cs;
  const ow = outline ? Math.max(...outline.map((p) => p[0])) - Math.min(...outline.map((p) => p[0])) : 0;
  const pad2 = Math.max(pad, ow * 0.4);
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])) - pad2)); const x1 = Math.min(W, Math.ceil(Math.max(...pts.map((p) => p[0])) + pad2));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])) - pad2)); const y1 = Math.min(H, Math.ceil(Math.max(...pts.map((p) => p[1])) + pad2));
  if (x1 <= x0 || y1 <= y0) return null;
  const pw = x1 - x0; const ph = y1 - y0;
  // The map on a coarse grid (every 4 px), smoothly in between: quick, and it bends gently anyway.
  const G = 4; const gw = Math.ceil(pw / G) + 1; const gh = Math.ceil(ph / G) + 1;
  const grid = new Float32Array(gw * gh * 2);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const q = map(x0 + i * G + 0.5, y0 + j * G + 0.5); grid[(j * gw + i) * 2] = q[0]; grid[(j * gw + i) * 2 + 1] = q[1]; }
  // Only the Character's own face (its jaw and up to its own hairline), not the border of hair or
  // background kept around it: that never lands inside the face it goes on.
  const keep = own && charFace.pts?.length === 68 ? ownMask(img, cw, ch, charFace) : null;
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
        const o = (Y * cw + X) * 4; const al = img[o + 3] * wt * (keep ? keep[Y * cw + X] : 1); a += al;
        col[0] += img[o] * al; col[1] += img[o + 1] * al; col[2] += img[o + 2] * al;
      }
      if (a < 0.5) continue;
      const o = (y * pw + x) * 4;
      rgba[o] = col[0] / a; rgba[o + 1] = col[1] / a; rgba[o + 2] = col[2] / a; rgba[o + 3] = a;
    }
  }
  if (trim) {
    // The face's own outline in the photo (jaw and forehead; or the head's oval when its landmarks
    // don't make one), a touch roomier, its edge a soft ramp: nothing of the Character beyond it.
    const contour = outline ?? faceContour(face, W, H);
    const out = contour ?? faceOutline(face, W, H, 64).map(([u, v]) => [u * W, v * H]);
    const roomy = grow(out, outline ? 1 : contour ? 1.03 : 1.12);
    const headH = Math.max(...out.map((p) => p[1])) - Math.min(...out.map((p) => p[1]));
    // The soft edge kept inside the outline (it fades to nothing at it, not past it onto what's around).
    // A wide one, so it fades into the face rather than ending at a line.
    const r = Math.max(2, Math.round(headH * 0.055));
    const m = soften(fillPolygon(roomy, x0, y0, pw, ph), pw, ph, r);
    for (let i = 0; i < pw * ph; i++) rgba[i * 4 + 3] *= Math.max(0, Math.min(1, (m[i] - 0.5) * 2.2));
  }
  return { x0, y0, pw, ph, rgba };
}

/**
 * The face's own skin, as a test: its colors (Lab) measured between the eyes and the mouth (the
 * cheeks and nose), each channel with its own spread, so a color is judged by how far it is from that
 * skin in each (lightness, redness, yellowness). Lightness counts for less than hue, brighter least (a
 * highlight or a shadow is still skin; hair, even blond, is darker and of a different hue). null without the landmarks.
 * `.off(L, a, b)`: how far, in spreads (3 or more: not this skin).
 */
export function skinModel(photo, W, H, face) {
  const pts = face.pts;
  if (!pts || pts.length !== 68) return null;
  const P = (i) => [pts[i][0] * W, pts[i][1] * H];
  const at = (x, y) => { const X = Math.round(x); const Y = Math.round(y); if (X < 0 || Y < 0 || X >= W || Y >= H) return null; const o = (Y * W + X) * 4; return photo[o + 3] < 128 ? null : rgbToLab(photo[o], photo[o + 1], photo[o + 2]); };
  let skin = [];
  const a = P(29); const b = P(33); const l = P(2); const r = P(14);
  for (let t = 0; t <= 1; t += 0.1) for (let s2 = 0.2; s2 <= 0.8; s2 += 0.05) {
    const c = at(l[0] + (r[0] - l[0]) * s2, a[1] + (b[1] - a[1]) * t + (l[1] + (r[1] - l[1]) * s2 - (l[1] + r[1]) / 2)); if (c) skin.push(c);
  }
  if (skin.length < 10) return null;
  const stats = (xs) => { const m = [0, 1, 2].map((k) => xs.reduce((t, c) => t + c[k], 0) / xs.length); return [m, [0, 1, 2].map((k) => Math.sqrt(xs.reduce((t, c) => t + (c[k] - m[k]) ** 2, 0) / xs.length))]; };
  let [mean, sd] = stats(skin);
  // Without what isn't skin there (a nostril, a freckle's shadow): the far ones left out once.
  const trimmed = skin.filter((c) => [0, 1, 2].every((k) => Math.abs(c[k] - mean[k]) <= 2.5 * sd[k] + 1e-6));
  if (trimmed.length >= 10) { skin = trimmed; [mean, sd] = stats(skin); }
  sd = [Math.max(7, sd[0]), Math.max(2.5, sd[1]), Math.max(3, sd[2])];
  const off = (L, A, B) => { let dl = (L - mean[0]) / sd[0]; dl *= dl > 0 ? 0.5 : 0.7; return Math.hypot(dl, (A - mean[1]) / sd[1], (B - mean[2]) / sd[2]); };
  return { mean, sd, off, isSkin: (rr, gg, bb) => { const c = rgbToLab(rr, gg, bb); return off(c[0], c[1], c[2]) < 3; } };
}

/**
 * Where the face in the photo ends: its own clean outline, the jaw from ear to ear (0–16), then up
 * across the forehead to the hairline, found in the photo itself: from the brows up, column by column,
 * the first place the skin gives way to hair (judged by skinModel). The jaw too is brought in where
 * the face's skin ends before it (hair over a cheek or temple, the far side of a turned face, a
 * flower by the ear): from the nose out to each jaw point, the first stretch that isn't that skin.
 * Where there's no hair to find (a bald head, a high forehead), a forehead's usual height. In the
 * picture's pixels, or null without the landmarks. `.snapped[i]`: whether jaw point i was brought in.
 */
export function targetOutline(photo, W, H, face) {
  const pts = face.pts;
  if (!pts || pts.length !== 68) return null;
  const P = (i) => [pts[i][0] * W, pts[i][1] * H];
  const brow = [(P(19)[0] + P(24)[0]) / 2, (P(19)[1] + P(24)[1]) / 2]; const chin = P(8);
  const ux = brow[0] - chin[0]; const uy = brow[1] - chin[1]; const len = Math.hypot(ux, uy);
  if (len < 6) return null;
  const up = [ux / len, uy / len];
  const model = skinModel(photo, W, H, face);
  if (!model) return null;
  const step = Math.max(1, len / 90); const r = Math.max(1, Math.round(step / 2));
  // A point's color (Lab, averaged over a few pixels so a single strand or freckle counts for less);
  // null past the picture's edge or on a clear or partly clear pixel (the edge of a cut-out face).
  const lab = (x, y) => {
    const X = Math.round(x); const Y = Math.round(y); if (X < 0 || Y < 0 || X >= W || Y >= H) return null;
    let rr = 0; let gg = 0; let bb = 0; let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = Math.min(W - 1, Math.max(0, X + dx)); const yy = Math.min(H - 1, Math.max(0, Y + dy)); const o = (yy * W + xx) * 4;
      if (photo[o + 3] < 250) return null; // (its soft edge too: it carries what was around the face)
      rr += photo[o]; gg += photo[o + 1]; bb += photo[o + 2]; n++;
    }
    return rgbToLab(rr / n, gg / n, bb / n);
  };
  // Out along a line from (px, py), from `from` to `to`: where the skin ends. Each point is compared with
  // the skin just before it on the same line (so shading and a redder cheek or a paler forehead are
  // still skin), and the edge is where most of the next stretch differs: hair, a flower, the background.
  const win = Math.max(4, Math.round((0.05 * len) / step));
  const TOL = 13;
  function edgeAlong(px, py, vx, vy, from, to, ref0 = null) {
    let ref = ref0 ? ref0.slice() : null; let n = ref0 ? 3 : 0; const bad = [];
    const dE = (c, q) => Math.hypot((c[0] - q[0]) * 0.7, c[1] - q[1], c[2] - q[2]);
    let first = ref0 ? ref0.slice() : null; // never drifting far from the skin it started on (a soft edge into hair)
    for (let d = from; d <= to + 1e-6; d += step) {
      const c = lab(px + vx * d, py + vy * d); let b;
      if (!c) b = true;
      else if (n < 3) { b = model.off(c[0], c[1], c[2]) > 4.5; if (!b) { ref = ref ? ref.map((v, k) => (v * n + c[k]) / (n + 1)) : c.slice(); n++; if (n === 3) first = ref.slice(); } }
      else { b = dE(c, ref) > TOL || dE(c, first) > 1.6 * TOL; if (!b) ref = ref.map((v, k) => v * 0.85 + c[k] * 0.15); }
      bad.push(b);
      // The edge: the start of the first window in which nearly all of it is off the skin.
      if (bad.length >= win) {
        const s0 = bad.length - win; let cnt = 0; for (let k = s0; k < bad.length; k++) cnt += bad[k];
        if (cnt >= Math.ceil(win * 0.6)) { let k = s0; while (!bad[k]) k++; return from + k * step; }
      }
    }
    return null;
  }
  // Up from each brow point (26 back to 17) to the hairline, each compared with the forehead's own skin
  // (just above the inner brows: nearly always skin), so hair at the temples is found from the start.
  const lo = 0.08 * len; const hi = 0.75 * len; const usual = 0.42 * len;
  const mid = [(P(21)[0] + P(22)[0]) / 2, (P(21)[1] + P(22)[1]) / 2]; const fs = [];
  for (const t of [0.04, 0.07, 0.1]) for (const sx of [-0.06, 0, 0.06]) { const c = lab(mid[0] + up[0] * t * len - up[1] * sx * len, mid[1] + up[1] * t * len + up[0] * sx * len); if (c && model.off(c[0], c[1], c[2]) < 4.5) fs.push(c); }
  let forehead = fs.length ? [0, 1, 2].map((k) => fs.reduce((t, c) => t + c[k], 0) / fs.length) : null;
  if (!forehead) forehead = model.mean;
  const lifts = [];
  for (let i = 26; i >= 17; i--) { const [bx, by] = P(i); lifts.push(edgeAlong(bx, by, up[0], up[1], lo, hi, forehead) ?? usual); }
  // Smoothed along the forehead (one stray strand doesn't dent it).
  const smooth = lifts.map((v, k) => { const w = lifts.slice(Math.max(0, k - 1), k + 2); return w.reduce((s3, x) => s3 + x, 0) / w.length; });
  // The jaw: out from the nose tip toward each jaw point (starting past the eyes, brows, nose and
  // mouth on the way), the start of the first stretch off the skin long enough not to be a freckle.
  const nose = P(30);
  const features = []; for (let i = 17; i < 68; i++) if (i < 27 || i > 30) features.push(P(i));
  const poly = []; const snapped = [];
  for (let i = 0; i <= 16; i++) {
    const [jx, jy] = P(i); const dist = Math.hypot(jx - nose[0], jy - nose[1]);
    const vx = (jx - nose[0]) / dist; const vy = (jy - nose[1]) / dist;
    let from = 0.55 * dist;
    for (const [fx, fy] of features) {
      const along = (fx - nose[0]) * vx + (fy - nose[1]) * vy; const across = Math.abs((fx - nose[0]) * vy - (fy - nose[1]) * vx);
      if (across < 0.1 * len && along < dist) from = Math.max(from, along + 0.04 * len);
    }
    from = Math.min(from, 0.82 * dist);
    const hit = edgeAlong(nose[0], nose[1], vx, vy, from, dist);
    if (hit !== null) { const t = hit / dist; poly.push([nose[0] + (jx - nose[0]) * t, nose[1] + (jy - nose[1]) * t]); snapped.push(true); } else { poly.push([jx, jy]); snapped.push(false); }
  }
  for (let k = 0, i = 26; i >= 17; i--, k++) { const [bx, by] = P(i); poly.push([bx + up[0] * smooth[k], by + up[1] * smooth[k]]); }
  poly.snapped = snapped;
  return poly;
}

/**
 * The Character recolored to the face it's on: inside that face's outline, its colors moved toward
 * the photo face's skin (their average and spread, in Lab), as far as `strength` says, the same way
 * all over it, so its own shading and detail (the face as it is) stay. In place on the patch.
 */
export function recolor(patch, photo, W, H, outline, strength = 0.8) {
  if (strength <= 0 || !outline) return patch;
  const { x0, y0, pw, ph, rgba } = patch;
  const inFace = fillPolygon(outline, x0, y0, pw, ph);
  const photoCrop = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const X = x0 + x; const Y = y0 + y; if (X >= W || Y >= H) continue;
    const o = (Y * W + X) * 4; const q = (y * pw + x) * 4;
    photoCrop[q] = photo[o]; photoCrop[q + 1] = photo[o + 1]; photoCrop[q + 2] = photo[o + 2]; photoCrop[q + 3] = 255;
  }
  const target = colorStats(photoCrop, pw, ph, (i) => inFace[i] > 0, 2);
  const own = colorStats(rgba, pw, ph, (i) => inFace[i] > 0 && rgba[i * 4 + 3] > 200, 2);
  if (!target || !own) return patch;
  const out = matchColors(rgba, pw, ph, target, strength, own);
  for (let i = 0; i < pw * ph; i++) if (rgba[i * 4 + 3]) { rgba[i * 4] = out[i * 4]; rgba[i * 4 + 1] = out[i * 4 + 1]; rgba[i * 4 + 2] = out[i * 4 + 2]; }
  return patch;
}

/**
 * The patch's colors blended into the photo (`photo`, RGBA W×H) seamlessly, by `strength` (0–1): at
 * its edge, how the photo just outside differs from the patch just inside (averaged over a few pixels,
 * so texture doesn't count; above, below and each side each its own), spread smoothly across it, so
 * it meets every side of what's around it with no seam while keeping its own detail. Its edge is
 * softened by a couple of pixels too. In place; returns the patch.
 */
export function blendIn(patch, photo, W, H, strength = 0.8, { soft = 2, band = 0, region = null, spread = 0, skin = null } = {}) {
  const { x0, y0, pw, ph, rgba } = patch;
  // Colors first (on its edge as it is), then the soft edge: the rim pixels softening adds have no
  // color of their own, so its own edge colors are carried out to them first.
  if (strength > 0) {
    const reg = region ? fillPolygon(region, x0, y0, pw, ph) : null;
    // With `spread`: the blend goes both ways. The photo's own skin around it (inside that face and
    // just past it: the forehead up to the hairline, the cheeks it doesn't reach) takes on its colors
    // too, easing back to the photo as it is further out, so there's no patch of the old face left
    // standing out; the two meet halfway.
    const zone = region && spread > 0 ? skinZone(rgba, x0, y0, pw, ph, photo, W, H, reg, spread, skin) : null;
    blendColors(rgba, x0, y0, pw, ph, photo, W, H, strength, band, reg, zone, spread);
  }
  if (soft) { bleed(rgba, pw, ph, soft * 3 + 2); featherAlpha(rgba, pw, ph, soft); }
  return patch;
}

/**
 * Where the blend reaches past the Character: the face's own outline, and beyond it any skin of that
 * face (a color like its skin inside the outline: a forehead above where its hairline was found, a
 * temple, the side of a cheek), reached from the Character without crossing anything else, as far as
 * 1.5 × `spread`. 1 there.
 */
function skinZone(rgba, x0, y0, pw, ph, photo, W, H, inside, spread, model = null) {
  const zone = new Uint8Array(pw * ph);
  // Skin: by the face's own skin model (skinModel); without one, a color like the skin inside the outline.
  let isSkin = model?.isSkin;
  if (!isSkin) {
    const sum = [0, 0, 0]; const sq = [0, 0, 0]; let n = 0;
    for (let k = 0; k < pw * ph; k++) {
      if (!inside[k]) continue;
      const X = x0 + (k % pw); const Y = y0 + Math.floor(k / pw); if (X >= W || Y >= H) continue;
      const o = (Y * W + X) * 4; const c = rgbToLab(photo[o], photo[o + 1], photo[o + 2]); n++;
      for (let j = 0; j < 3; j++) { sum[j] += c[j]; sq[j] += c[j] * c[j]; }
    }
    if (!n) { for (let k = 0; k < pw * ph; k++) zone[k] = inside[k]; return zone; }
    const mean = sum.map((v) => v / n); const sd = sq.map((v, j) => Math.max(j ? 2.5 : 7, Math.sqrt(Math.max(0, v / n - mean[j] ** 2))));
    isSkin = (r, g, b) => { const c = rgbToLab(r, g, b); let dl = (c[0] - mean[0]) / sd[0]; if (dl > 0) dl *= 0.5; return Math.hypot(dl, (c[1] - mean[1]) / sd[1], (c[2] - mean[2]) / sd[2]) < 3; };
  }
  const skin = (k) => { const X = x0 + (k % pw); const Y = y0 + Math.floor(k / pw); if (X >= W || Y >= H) return false; const o = (Y * W + X) * 4; return isSkin(photo[o], photo[o + 1], photo[o + 2]); };
  const depth = new Float32Array(pw * ph).fill(Infinity); const q = [];
  // From where it's mostly solid (as blendColors counts it), so its faint outer edge is in the zone too.
  for (let k = 0; k < pw * ph; k++) if (rgba[k * 4 + 3] > 128) { depth[k] = 0; q.push(k); }
  const far = 1.5 * spread;
  for (let h = 0; h < q.length; h++) {
    const k = q[h]; const x = k % pw;
    for (const t of [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, k - pw, k + pw]) {
      if (t < 0 || t >= pw * ph || depth[t] <= depth[k] + 1 || depth[k] + 1 > far) continue;
      if (!inside[t] && !skin(t)) continue;
      depth[t] = depth[k] + 1; zone[t] = 1; q.push(t);
    }
  }
  return zone;
}

/**
 * membrane() for a big area: the difference is smooth anyway, so it's worked out on a coarser grid
 * (each cell: the measured edge in it if any, else free if any of it is, else held at nothing) and
 * spread back smoothly; the measured edge itself kept exactly. In place on `diff`.
 */
function smoothField(diff, free, fixed, pw, ph) {
  const f = Math.ceil(Math.sqrt((pw * ph) / 120000));
  if (f <= 1) return membrane(diff, free, pw, ph);
  const cw = Math.ceil(pw / f); const ch = Math.ceil(ph / f);
  const cd = new Float32Array(cw * ch * 3); const cn = new Float32Array(cw * ch); const cfree = new Uint8Array(cw * ch);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const k = y * pw + x; const c = Math.floor(y / f) * cw + Math.floor(x / f);
    if (fixed[k]) { cn[c]++; for (let j = 0; j < 3; j++) cd[c * 3 + j] += diff[k * 3 + j]; } else if (free[k]) cfree[c] = 1;
  }
  for (let c = 0; c < cw * ch; c++) if (cn[c]) { cfree[c] = 0; for (let j = 0; j < 3; j++) cd[c * 3 + j] /= cn[c]; }
  membrane(cd, cfree, cw, ch);
  for (let y = 0; y < ph; y++) {
    const gy = Math.min(ch - 1, Math.max(0, (y + 0.5) / f - 0.5)); const j0 = Math.min(ch - 2, Math.floor(gy)); const ty = ch > 1 ? gy - j0 : 0;
    for (let x = 0; x < pw; x++) {
      const k = y * pw + x; if (!free[k]) continue;
      const gx = Math.min(cw - 1, Math.max(0, (x + 0.5) / f - 0.5)); const i0 = Math.min(cw - 2, Math.floor(gx)); const tx = cw > 1 ? gx - i0 : 0;
      const a = (j0 * cw + Math.max(0, i0)) * 3; const b = a + (cw > 1 ? 3 : 0); const c = a + (ch > 1 ? cw * 3 : 0); const d = c + (cw > 1 ? 3 : 0);
      for (let j = 0; j < 3; j++) diff[k * 3 + j] = (cd[a + j] * (1 - tx) + cd[b + j] * tx) * (1 - ty) + (cd[c + j] * (1 - tx) + cd[d + j] * tx) * ty;
    }
  }
  return diff;
}

/** The colors of the pixels it covers carried out into the clear pixels around it, `rings` deep (alpha left as it is). */
function bleed(rgba, pw, ph, rings) {
  const has = Uint8Array.from({ length: pw * ph }, (_, i) => (rgba[i * 4 + 3] > 24 ? 1 : 0));
  const seen = Uint8Array.from(has);
  const near = (k) => { const x = k % pw; return [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, k >= pw ? k - pw : -1, k + pw < pw * ph ? k + pw : -1]; };
  // Ring by ring, only the clear pixels next to covered ones (not the whole patch each time).
  let front = [];
  for (let k = 0; k < pw * ph; k++) if (!has[k] && near(k).some((t) => t >= 0 && has[t])) { front.push(k); seen[k] = 1; }
  for (let r = 0; r < rings && front.length; r++) {
    const cols = front.map((k) => {
      const sum = [0, 0, 0]; let n = 0;
      for (const t of near(k)) if (t >= 0 && has[t]) { sum[0] += rgba[t * 4]; sum[1] += rgba[t * 4 + 1]; sum[2] += rgba[t * 4 + 2]; n++; }
      return n ? sum.map((v) => v / n) : null;
    });
    const next = [];
    front.forEach((k, j) => {
      if (!cols[j]) return;
      rgba[k * 4] = cols[j][0]; rgba[k * 4 + 1] = cols[j][1]; rgba[k * 4 + 2] = cols[j][2]; has[k] = 1;
    });
    for (const k of front) if (has[k]) for (const t of near(k)) if (t >= 0 && !seen[t]) { seen[t] = 1; next.push(t); }
    front = next;
  }
}

function blendColors(rgba, x0, y0, pw, ph, photo, W, H, strength, band = 0, region = null, zone = null, spread = 0) {
  // Where it counts as the Character: with a zone, only where it's mostly solid (its faint outer edge
  // is laid over the photo instead, so the edge it's matched along is a clean one).
  const ON = zone ? 128 : 24;
  const on = (x, y) => x >= 0 && y >= 0 && x < pw && y < ph && rgba[(y * pw + x) * 4 + 3] > ON;
  const free = new Uint8Array(pw * ph); const diff = new Float32Array(pw * ph * 3);
  // What its edge is matched to: the photo just outside it; or, with a `region` (the face it replaces),
  // that face's own skin under and around its edge (never the hair or background past the outline).
  const R = region ? 5 : 3;
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    if (!on(x, y)) continue;
    const k = y * pw + x;
    const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
    if (!edge) { free[k] = 1; continue; }
    const out = [0, 0, 0]; const inn = [0, 0, 0]; let no = 0; let ni = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const X = x + dx; const Y = y + dy; const PX = x0 + X; const PY = y0 + Y;
      if (PX < 0 || PY < 0 || PX >= W || PY >= H) continue;
      const mine = on(X, Y);
      if (mine) { const o = (Y * pw + X) * 4; inn[0] += rgba[o]; inn[1] += rgba[o + 1]; inn[2] += rgba[o + 2]; ni++; }
      const ref = region ? X >= 0 && Y >= 0 && X < pw && Y < ph && region[Y * pw + X] > 0 : !mine;
      if (ref) { const o = (PY * W + PX) * 4; out[0] += photo[o]; out[1] += photo[o + 1]; out[2] += photo[o + 2]; no++; }
    }
    if (no && ni) for (let c = 0; c < 3; c++) diff[k * 3 + c] = out[c] / no - inn[c] / ni;
    else free[k] = 1;
  }
  // Past its edge, inside the zone: the difference carried out too (to nothing at the zone's edge).
  const fixed = Uint8Array.from(free, (v, k) => (!v && rgba[k * 4 + 3] > ON ? 1 : 0)); // its edge, where the difference was measured
  if (zone) for (let k = 0; k < pw * ph; k++) if (zone[k] && rgba[k * 4 + 3] <= ON) free[k] = 1;
  smoothField(diff, free, fixed, pw, ph);
  // With a `band`: the blend only near the border, eased out to nothing `band` pixels in (inside it,
  // the Character exactly as it is, recolored).
  let depth = null;
  if (band > 0) {
    depth = new Float32Array(pw * ph).fill(Infinity); const q = [];
    for (let k = 0; k < pw * ph; k++) if (rgba[k * 4 + 3] > ON && !free[k]) { depth[k] = 0; q.push(k); }
    for (let h2 = 0; h2 < q.length; h2++) {
      const k = q[h2]; const x = k % pw;
      for (const t of [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, k - pw, k + pw]) {
        if (t < 0 || t >= pw * ph || !free[t] || rgba[t * 4 + 3] <= ON || depth[t] <= depth[k] + 1) continue;
        depth[t] = depth[k] + 1; q.push(t);
      }
    }
  }
  const share = zone ? 0.5 : 0; // how much of the difference the photo takes on (the rest, the Character)
  for (let i = 0; i < pw * ph; i++) {
    if (!rgba[i * 4 + 3]) continue;
    const k = depth ? Math.max(0, 1 - depth[i] / band) ** 2 : 1;
    if (!k) continue;
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] += strength * (1 - share) * k * diff[i * 3 + c];
  }
  if (!zone) return;
  // The photo around it, in the zone: its own pixels shifted toward the Character's colors (eased out
  // over `spread` from its edge), the Character's soft edge laid over them; all of it now in the patch.
  const out = new Float32Array(pw * ph).fill(Infinity); const q = [];
  for (let k = 0; k < pw * ph; k++) if (rgba[k * 4 + 3] > ON) { out[k] = 0; q.push(k); }
  for (let h2 = 0; h2 < q.length; h2++) {
    const k = q[h2]; const x = k % pw;
    for (const t of [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, k - pw, k + pw]) {
      if (t < 0 || t >= pw * ph || !zone[t] || out[t] <= out[k] + 1) continue;
      out[t] = out[k] + 1; q.push(t);
    }
  }
  for (let i = 0; i < pw * ph; i++) {
    if (!zone[i] || !Number.isFinite(out[i])) continue;
    const X = x0 + (i % pw); const Y = y0 + Math.floor(i / pw); if (X >= W || Y >= H) continue;
    const f = Math.max(0, Math.min(1, (1.5 * spread - out[i]) / (0.5 * spread)));
    const a = rgba[i * 4 + 3] / 255; const o = (Y * W + X) * 4;
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = a * rgba[i * 4 + c] + (1 - a) * (photo[o + c] - strength * share * f * diff[i * 3 + c]);
    rgba[i * 4 + 3] = 255;
  }
}
