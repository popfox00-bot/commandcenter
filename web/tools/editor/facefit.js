// FaceMask → 🎭 Insert Character, fitted: a Character that has a face of its own is bent onto the
// face in the photo, not just laid on it. Starting from the eyes, about thirty of its landmarks (jaw
// and chin, brows, nose, eye corners, mouth) are pulled onto the face's own (moving least squares, so
// it bends smoothly and stays itself away from the face); then it's trimmed, softly, to that head's
// outline (so a different hairline, ears or neck don't stick out); and its colors are blended into
// the photo seamlessly: at its edge it takes on what's next to it there (above, below, each side, each
// differently), eased smoothly inward. Pure: RGBA in, patch pixels out.

import { faceOutline, faceContour, alignOnFace, similarityFit, faceFrom } from '../../lib/face-core.js';
import { membrane } from './cleanup.js';
import { turnFace, closeMouth, mouthOpen } from './face3d.js';
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

/** The inner features (nose, eyes, mouth): where a face is and which way it's turned, whatever its jaw. */
const INNER = [27, 28, 29, 30, 31, 33, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 51, 54, 57];
const median = (xs) => { const a = [...xs].sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : 0; };
/** How high a face's forehead is (its hairline above its brows, along the face) for its brow-to-chin length: [forehead, brow-to-chin]. */
function foreheadOf(pts, w, h, outline) {
  const P = (i) => [pts[i][0] * w, pts[i][1] * h];
  const brow = [(P(19)[0] + P(24)[0]) / 2, (P(19)[1] + P(24)[1]) / 2]; const chin = P(8);
  const low = Math.hypot(brow[0] - chin[0], brow[1] - chin[1]); if (low < 1) return null;
  const up = [(brow[0] - chin[0]) / low, (brow[1] - chin[1]) / low];
  // The middle of the forehead (above brows 24 to 19), not the temples (where hair often comes lower).
  const lifts = outline ? outline.slice(19, 25).map(([x, y]) => (x - brow[0]) * up[0] + (y - brow[1]) * up[1]) : [];
  const cut = (outline?.clipped?.slice(2, 8).filter(Boolean).length ?? 0) >= 3; // its top cut off (by a cut-out's edge): taller than that
  // Its tallest there: what shows of a forehead is up to where its hairline is highest (hair falling over part of it doesn't make it a low one).
  return [lifts.length ? Math.max(0, ...lifts) : 0.42 * low, low, cut];
}

/**
 * Where the Character goes, for a realistic face rather than one pinned to every point of the face
 * it replaces: placed and turned by its inner features (eyes most, then mouth and nose) on that
 * face's, so it sits where that face is and looks where it looks, its own face kept symmetric; then
 * sized so the new face has a natural forehead within that face's own height (hairline to chin): its
 * forehead mostly its own, a little toward a usual one (about 0.45 of the brow-to-chin length); lined up
 * across by the eyes and down by the chin. Turned by the eye line, and narrowed across (`squash`) for a
 * face turned away (both only a little, and neither when it was turned in 3D already: `turned`). Only ever bigger (up to 1.3×), and never much wider than that face's jaw. `outline`: that
 * face's (targetOutline); `own`: the Character's own, in its pixels. { x, y, width, rot }.
 */
export function realPlacement(charFace, cw, ch, face, W, H, { outline = null, own = null, turned = false } = {}) {
  if (charFace.pts?.length !== 68 || face.pts?.length !== 68) return bestPlacement(charFace, cw, ch, face, W, H);
  const C = (i) => [charFace.pts[i][0] * cw, charFace.pts[i][1] * ch]; const T = (i) => [face.pts[i][0] * W, face.pts[i][1] * H];
  // Turned by its eye line onto that face's (not twisted by a nose or mouth that a turned head shows off-center).
  const eyeLine = (P) => { const m = (lo, hi) => { let x = 0; let y = 0; for (let i = lo; i <= hi; i++) { x += P(i)[0]; y += P(i)[1]; } return [x / (hi - lo + 1), y / (hi - lo + 1)]; }; const l = m(36, 41); const r = m(42, 47); return Math.atan2(r[1] - l[1], r[0] - l[0]); };
  let rot = eyeLine(T) - eyeLine(C); rot = Math.atan2(Math.sin(rot), Math.cos(rot));
  // Then sized and placed by its inner features in that face's own frame: as tall as they are there, and
  // as wide, so a face turned away (narrower across) gets a Character narrowed to match (0.75× to 1.1×).
  const co = Math.cos(rot); const si = Math.sin(rot);
  const wts = INNER.map((i) => (i >= 36 && i <= 47 ? 3 : i >= 48 ? 2 : 1)); const sw = wts.reduce((t, v) => t + v, 0);
  const tF = INNER.map((i) => { const [x, y] = T(i); return [x * co + y * si, -x * si + y * co]; }); const cP = INNER.map(C);
  const mean = (pts, k) => pts.reduce((t, p, j) => t + p[k] * wts[j], 0) / sw;
  const mt = [mean(tF, 0), mean(tF, 1)]; const mc = [mean(cP, 0), mean(cP, 1)];
  const axis = (k) => { let num = 0; let den = 0; cP.forEach((p, j) => { num += wts[j] * (p[k] - mc[k]) * (tF[j][k] - mt[k]); den += wts[j] * (p[k] - mc[k]) ** 2; }); return den > 0 ? num / den : NaN; };
  const sy = axis(1); const sxRaw = axis(0);
  if (!(sy > 0) || !(sxRaw > 0)) return bestPlacement(charFace, cw, ch, face, W, H);
  // (Already turned in 3D to that face's pose: not narrowed again. Otherwise only a little: a small
  // difference in where the landmarks were found mustn't squeeze a face.)
  const squash = turned ? 1 : Math.max(0.9, Math.min(1.05, sxRaw / sy)); const sx = sy * squash;
  // In that face's own frame (across, down): a Character point as placed by its features, and a point of that face.
  const frame = ([x, y]) => [mt[0] + (x - mc[0]) * sx, mt[1] + (y - mc[1]) * sy];
  const tFrame = ([x, y]) => [x * co + y * si, -x * si + y * co];
  const mid = (P, lo, hi) => { let x = 0; let y = 0; for (let i = lo; i <= hi; i++) { x += P(i)[0]; y += P(i)[1]; } return [x / (hi - lo + 1), y / (hi - lo + 1)]; };
  const eyesT = tFrame([(mid(T, 36, 41)[0] + mid(T, 42, 47)[0]) / 2, (mid(T, 36, 41)[1] + mid(T, 42, 47)[1]) / 2]);
  const eyesC = frame([(mid(C, 36, 41)[0] + mid(C, 42, 47)[0]) / 2, (mid(C, 36, 41)[1] + mid(C, 42, 47)[1]) / 2]);
  const chinT = tFrame(T(8)); const chinC = frame(C(8));
  // Sized so its eyes-to-chin length is that face's (a turned or longer face: bigger), or bigger still for
  // a natural forehead; only ever bigger than its features alone make it, up to 1.3×, never much wider than that jaw.
  let k = chinC[1] - eyesC[1] > 1 ? (chinT[1] - eyesT[1]) / (chinC[1] - eyesC[1]) : 1;
  const tf = outline ? foreheadOf(face.pts, W, H, outline) : null; const cf = foreheadOf(charFace.pts, cw, ch, own);
  if (tf && cf) {
    // (Its own forehead cut off by the edge of its cut-out: at least that tall, so no taller than the face's own.)
    const rC = cf[2] ? Math.max(cf[0] / cf[1], tf[0] / tf[1]) : cf[0] / cf[1];
    // Its own, nudged toward a usual one only if that's taller (so the same face put back stays as it was).
    const rT = Math.max(rC, Math.max(0.3, Math.min(0.5, 0.8 * rC + 0.2 * 0.45)));
    k = Math.max(k, (tf[0] + tf[1]) / (1 + rT) / (sy * cf[1]));
  }
  const jawT = Math.hypot(T(16)[0] - T(0)[0], T(16)[1] - T(0)[1]); const jawC = Math.hypot(C(16)[0] - C(0)[0], C(16)[1] - C(0)[1]);
  if (jawC > 0) k = Math.min(k, (1.25 * jawT) / (sx * jawC));
  k = Math.max(1, Math.min(1.3, k));
  // Lined up across the face by its eyes, and down it by its chin (a turned head's chin isn't under its eyes the
  // way a face seen straight on has it: lining up by the chin across would pull the whole face sideways).
  const down = (q) => chinT[1] + k * (q[1] - chinC[1]);
  // Its nose, mouth and chin slanted along under its eyes to where that face has them (a turned head's
  // middle line leans): fitted to them, gently (at most a fifth of the way across for each step down).
  let num = 0; let den = 0;
  for (const i of [30, 33, 51, 57, 62, 66, 8]) {
    const q = frame(C(i)); const t = tFrame(T(i)); const dv = down(q) - eyesT[1];
    num += dv * (t[0] - (eyesT[0] + k * (q[0] - eyesC[0])));
    den += dv * dv;
  }
  const shear = turned || !(den > 0) ? 0 : Math.max(-0.1, Math.min(0.1, num / den));
  const g = (q) => { const v = down(q); return [eyesT[0] + k * (q[0] - eyesC[0]) + shear * (v - eyesT[1]), v]; };
  const pic = (p2) => { const [u, v] = g(frame(p2)); return [u * co - v * si, u * si + v * co]; };
  // The whole of it as one map, Character pixels → picture pixels: [a, b, c, d, e, f] for (x, y) → (a x + b y + c, d x + e y + f).
  const o = pic([0, 0]); const ax = pic([1, 0]); const ay = pic([0, 1]);
  const affine = [ax[0] - o[0], ay[0] - o[0], o[0], ax[1] - o[1], ay[1] - o[1], o[1]];
  const [x, y] = pic([cw / 2, ch / 2]);
  return { x, y, width: sy * k * cw, rot, squash, shear, affine };
}

/**
 * Whether a face's mouth (in the photo, RGBA W×H) is shut: its lips' landmarks close together, and
 * between them nothing that isn't lip (no teeth, no dark open mouth): the inside of the mouth colored like
 * the lips around it.
 */
export function mouthShut(photo, W, H, face) {
  const P = face.pts.map(([u, v]) => [u * W, v * H]);
  if (mouthOpen(P) > 0.14) return false;
  const lab = (x, y) => { const X = Math.round(x); const Y = Math.round(y); if (X < 0 || Y < 0 || X >= W || Y >= H) return null; const o = (Y * W + X) * 4; return rgbToLab(photo[o], photo[o + 1], photo[o + 2]); };
  // The lips' own color: on them, just above and below where they meet.
  const lips = [];
  for (const [u, l, ou, ol] of [[61, 67, 50, 58], [62, 66, 51, 57], [63, 65, 52, 56]]) for (const [a, b] of [[u, ou], [l, ol]]) { const q = lab((P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2); if (q) lips.push(q); }
  if (lips.length < 3) return mouthOpen(P) < 0.05;
  const L = lips.reduce((t, c) => t + c[0], 0) / lips.length; const A = lips.reduce((t, c) => t + c[1], 0) / lips.length;
  // Between the lips (inside 60–67, a little roomier): any teeth (much lighter than the lips, and less red)?
  const inner = grow(P.slice(60, 68), 1.3);
  const xs = inner.map((p) => p[0]); const ys = inner.map((p) => p[1]);
  const bx = Math.floor(Math.min(...xs)); const by = Math.floor(Math.min(...ys));
  const bw = Math.max(1, Math.ceil(Math.max(...xs)) - bx); const bh = Math.max(1, Math.ceil(Math.max(...ys)) - by);
  const m = fillPolygon(inner, bx, by, bw, bh);
  let n = 0; let teeth = 0; let dark = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    if (!m[y * bw + x]) continue; const c = lab(bx + x + 0.5, by + y + 0.5); if (!c) continue; n++;
    if (c[0] > L + 12 && c[1] < A - 6) teeth++;
    if (c[0] < L - 35) dark++;
  }
  if (!n) return mouthOpen(P) < 0.05;
  return teeth / n < 0.08 && !(mouthOpen(P) > 0.09 && dark / n > 0.4);
}

/** The Character made ready for `face`: its mouth closed if that face's is (closeMouth), turned in 3D to its pose (turnFace); worked out once per picture and face. */
const turnCache = new WeakMap();
export function turnedFor(img, cw, ch, charFace, face, W, H, photo = null) {
  let m = turnCache.get(img); if (!m) { m = new WeakMap(); turnCache.set(img, m); }
  const hit = m.get(face); if (hit && hit.charFace === charFace && hit.W === W && hit.H === H) return hit.t;
  // Its mouth closed first when that face's is closed (an open smile pasted on a closed mouth gives the
  // game away); left as it is when that face shows its teeth or an open mouth.
  let src = { rgba: img, w: cw, h: ch, face: charFace }; let changed = false;
  if (charFace.pts?.length === 68 && face.pts?.length === 68 && photo && mouthShut(photo, W, H, face)) {
    const pts = charFace.pts.map(([u, v]) => [u * cw, v * ch]);
    const c = closeMouth(img, cw, ch, pts, 0);
    if (c) {
      const xs = c.pts.map((p) => p[0]); const ys = c.pts.map((p) => p[1]);
      src = { rgba: c.rgba, w: cw, h: ch, face: faceFrom({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }, c.pts, cw, ch, charFace.score ?? 1) };
      changed = true;
    }
  }
  const t = turnFace(src.rgba, src.w, src.h, src.face, face, W, H) ?? (changed ? src : null);
  m.set(face, { charFace, W, H, t });
  return t;
}

/** The Character's own outline (targetOutline on its own pixels), worked out once per picture. */
const ownCache = new WeakMap();
export function ownOutline(img, cw, ch, charFace) {
  const key = ownCache.get(img); if (key?.face === charFace) return key.poly;
  const poly = charFace.pts?.length === 68 ? targetOutline(img, cw, ch, charFace) ?? faceContour(charFace, cw, ch, { forehead: 0.55 }) : null;
  ownCache.set(img, { face: charFace, poly });
  return poly;
}

/** The convex hull of points (monotone chain), in order around. */
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (const q of p.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** A polygon grown by `k` around its middle. */
const grow = (poly, k) => {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length; const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
};

/** How much of each of the Character's pixels is its own face (0..1): inside its jaw and its own hairline, a soft edge just inside. */
function ownMask(img, cw, ch, charFace) {
  const poly = ownOutline(img, cw, ch, charFace);
  if (!poly) return null;
  // Roomier along the jaw (the face it goes on trims there), not past its own hairline (no hair of its own).
  const g = grow(poly, 1.05); const roomy = poly.map((p, i) => (i <= 16 && !poly.snapped?.[i] ? g[i] : p));
  const hh = Math.max(...roomy.map((p) => p[1])) - Math.min(...roomy.map((p) => p[1]));
  const m = soften(fillPolygon(roomy, 0, 0, cw, ch), cw, ch, Math.max(1, Math.round(hh * 0.05)));
  for (let i = 0; i < m.length; i++) m[i] = Math.max(0, Math.min(1, (m[i] - 0.5) * 2.2));
  // Its own features (eyes, brows, nose, mouth, with room around them) always kept, whatever its outline
  // search found (a shadow or a highlight on a cheek isn't the edge of its face).
  const feat = grow(hull(charFace.pts.slice(17).map(([u, v]) => [u * cw, v * ch])), 1.25);
  const f = soften(fillPolygon(feat, 0, 0, cw, ch), cw, ch, Math.max(1, Math.round(hh * 0.03)));
  for (let i = 0; i < m.length; i++) m[i] = Math.max(m[i], Math.min(1, f[i] * 1.6));
  // Its forehead fades out gently toward its own hairline (over a fifth of its brow-to-chin length), so
  // it melts into the forehead of the face it goes on rather than ending in a line across it.
  const P = (i) => [charFace.pts[i][0] * cw, charFace.pts[i][1] * ch];
  const brow = [(P(19)[0] + P(24)[0]) / 2, (P(19)[1] + P(24)[1]) / 2]; const chin = P(8);
  const low = Math.hypot(brow[0] - chin[0], brow[1] - chin[1]);
  if (low > 4) {
    const up = [(brow[0] - chin[0]) / low, (brow[1] - chin[1]) / low]; const across = [-up[1], up[0]];
    // The hairline as lift above the brows, by place across the face (the forehead points, in order).
    const line = poly.slice(17).map(([x, y]) => [(x - brow[0]) * across[0] + (y - brow[1]) * across[1], (x - brow[0]) * up[0] + (y - brow[1]) * up[1]]).sort((a, b) => a[0] - b[0]);
    const hairAt = (t) => { if (t <= line[0][0]) return line[0][1]; for (let j = 1; j < line.length; j++) if (t <= line[j][0]) { const f = (t - line[j - 1][0]) / (line[j][0] - line[j - 1][0] || 1); return line[j - 1][1] + f * (line[j][1] - line[j - 1][1]); } return line[line.length - 1][1]; };
    const fade = 0.2 * low;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = y * cw + x; if (!m[i]) continue;
      const lift = (x - brow[0]) * up[0] + (y - brow[1]) * up[1]; if (lift <= 0) continue;
      const t = Math.max(0, Math.min(1, (hairAt((x - brow[0]) * across[0] + (y - brow[1]) * across[1]) - lift) / fade));
      m[i] *= t * t * (3 - 2 * t);
    }
  }
  return m;
}

/**
 * The Character (RGBA cw×ch, with its own face `charFace`) fitted onto `face` in a W×H picture:
 * placed by its eyes first (alignOnFace), then bent so its landmarks meet the face's, and (with
 * `trim`) faded out softly beyond that head's outline. Returns the patch { x0, y0, pw, ph, rgba } in
 * the picture's pixels (alpha = coverage), or null when it's off the picture.
 */
export function fitPatch(img, cw, ch, charFace, face, W, H, { trim = true, outline = null, bend = 0.35, own = true, real = true, turn = real, photo = null } = {}) {
  // Turned in 3D first (face3d.js) to the pose of the face it goes on, when they're posed differently.
  let turned = false;
  if (turn) { const t = turnedFor(img, cw, ch, charFace, face, W, H, photo); if (t) { ({ rgba: img, w: cw, h: ch, face: charFace } = t); turned = true; } }
  // Realistic (the default): placed by its inner features and sized for a natural face (realPlacement),
  // and bent only along its jaw (toward that face's), its eyes, nose and mouth left as they are.
  const usePts = charFace.pts?.length === 68 && face.pts?.length === 68;
  const real2 = real && usePts;
  const base = real2 ? realPlacement(charFace, cw, ch, face, W, H, { outline, own: ownOutline(img, cw, ch, charFace), turned }) : bestPlacement(charFace, cw, ch, face, W, H);
  // Where the Character's edges go when just placed by the eyes: anchors that keep it steady far from the face.
  const anchorsSrc = [[0, 0], [cw / 2, 0], [cw, 0], [cw, ch / 2], [cw, ch], [cw / 2, ch], [0, ch], [0, ch / 2]];
  // (squash: narrowed across, for a face turned away.)
  const k = base.width / cw; const co = Math.cos(base.rot); const si = Math.sin(base.rot);
  // (Realistic placement gives its whole map, `affine`: narrowed and slanted for a turned head.)
  const A = base.affine ?? (() => { const kx = k * (base.squash ?? 1); return [kx * co, -k * si, base.x - (cw / 2) * kx * co + (ch / 2) * k * si, kx * si, k * co, base.y - (cw / 2) * kx * si - (ch / 2) * k * co]; })();
  const det = A[0] * A[4] - A[1] * A[3];
  const place = ([x, y]) => [A[0] * x + A[1] * y + A[2], A[3] * x + A[4] * y + A[5]];
  // (Realistic: each jaw point pulled toward that face's only a little way, never far: a turned head's
  // near-side jaw would otherwise squeeze its cheek and eye against its pinned features.)
  const jawW = usePts ? Math.hypot((face.pts[16][0] - face.pts[0][0]) * W, (face.pts[16][1] - face.pts[0][1]) * H) : 0;
  const near = (p, q, r) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); return d <= r ? q : [p[0] + ((q[0] - p[0]) * r) / d, p[1] + ((q[1] - p[1]) * r) / d]; };
  const tgt = real2 ? CONTROL.map((i) => { const own2 = place([charFace.pts[i][0] * cw, charFace.pts[i][1] * ch]); return i <= 16 ? near(own2, [face.pts[i][0] * W, face.pts[i][1] * H], 0.06 * jawW) : own2; })
    : usePts ? CONTROL.map((i) => [face.pts[i][0] * W, face.pts[i][1] * H]) : [face.eyes[0], face.eyes[1], face.mouth].map(([u, v]) => [u * W, v * H]);
  const src = usePts ? CONTROL.map((i) => [charFace.pts[i][0] * cw, charFace.pts[i][1] * ch]) : [charFace.eyes[0], charFace.eyes[1], charFace.mouth].map(([u, v]) => [u * cw, v * ch]);
  // Picture point → Character point (the inverse direction, for sampling): mostly the plain placement
  // (its face kept as it is: eyes, nose and mouth in their own proportions), bent only by `bend` of
  // the way toward meeting the face's landmarks (so its outline follows the new face's jaw).
  const mls = mlsMap([...tgt, ...anchorsSrc.map(place)], [...src, ...anchorsSrc]);
  const unplace = (x, y) => { const dx = x - A[2]; const dy = y - A[5]; return [(A[4] * dx - A[1] * dy) / det, (-A[3] * dx + A[0] * dy) / det]; };
  const map = (x, y) => { const r = unplace(x, y); if (bend <= 0) return r; const q = mls(x, y); return [r[0] + bend * (q[0] - r[0]), r[1] + bend * (q[1] - r[1])]; };
  const cs = [[0, 0], [cw, 0], [cw, ch], [0, ch]].map(place);
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
  // Over that face's own features (eyes, brows, nose, mouth, with room around them), all of it where its
  // own outline has even a little of its face (its soft edge): on a turned head they can land there, and
  // they mustn't show through. (Not where it's none of its face at all: its hair or background.)
  const over = keep && face.pts?.length === 68 ? soften(fillPolygon(grow(hull(face.pts.slice(17).map(([u, v]) => [u * W, v * H])), 1.18), x0, y0, pw, ph), pw, ph, 3) : null;
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
      let a = 0; const col = [0, 0, 0]; const ov = over ? over[y * pw + x] : 0;
      for (const [X, Y, wt] of [[ua, va, (1 - fu) * (1 - fv)], [ua + 1, va, fu * (1 - fv)], [ua, va + 1, (1 - fu) * fv], [ua + 1, va + 1, fu * fv]]) {
        if (X < 0 || Y < 0 || X >= cw || Y >= ch || !wt) continue;
        const o = (Y * cw + X) * 4; const kk = keep ? keep[Y * cw + X] : 1; const al = img[o + 3] * wt * (kk + (1 - kk) * ov * Math.min(1, kk / 0.25)); a += al;
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
    // Never thin over that face's own features (its eyes, brows, nose and mouth, with room around them):
    // on a turned head they come close to its outline, and they'd show through the soft edge.
    if (face.pts?.length === 68) {
      const feat = grow(hull(face.pts.slice(17).map(([u, v]) => [u * W, v * H])), 1.18);
      // (Inside the outline, just: never out past that face's edge onto what's around it.)
      const inside = fillPolygon(grow(roomy, 1.03), x0, y0, pw, ph);
      const f = soften(fillPolygon(feat, x0, y0, pw, ph), pw, ph, Math.max(1, Math.round(r / 2)));
      for (let i = 0; i < m.length; i++) if (inside[i]) m[i] = Math.max(m[i], 0.5 + f[i] / 2);
    }
    for (let i = 0; i < pw * ph; i++) rgba[i * 4 + 3] *= Math.max(0, Math.min(1, (m[i] - 0.5) * 2.2));
  }
  // (Where its landmarks went, for relight: as placed, before the light bend.)
  const charPts = charFace.pts?.length === 68 ? charFace.pts.map(([u, v]) => place([u * cw, v * ch])) : null;
  return { x0, y0, pw, ph, rgba, charPts };
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
    // (Brighter counts for less than darker: a highlight is still skin; hair is darker.)
    const dE = (c, q) => Math.hypot((c[0] - q[0]) * (c[0] > q[0] ? 0.3 : 0.7), c[1] - q[1], c[2] - q[2]);
    let first = ref0 ? ref0.slice() : null; // never drifting far from the skin it started on (a soft edge into hair)
    for (let d = from; d <= to + 1e-6; d += step) {
      const c = lab(px + vx * d, py + vy * d); let b;
      if (!c) b = true;
      else if (n < 3) { b = model.off(c[0], c[1], c[2]) > 4.5; if (!b) { ref = ref ? ref.map((v, k) => (v * n + c[k]) / (n + 1)) : c.slice(); n++; if (n === 3) first = ref.slice(); } }
      else { b = dE(c, ref) > TOL || dE(c, first) > 1.6 * TOL; if (!b) ref = ref.map((v, k) => v * 0.85 + c[k] * 0.15); }
      bad.push(!c ? 2 : b ? 1 : 0); // (2: the edge of the picture or of a cut-out, not hair)
      // The edge: the start of the first window in which nearly all of it is off the skin.
      if (bad.length >= win) {
        const s0 = bad.length - win; let cnt = 0; for (let k = s0; k < bad.length; k++) cnt += bad[k] ? 1 : 0;
        if (cnt >= Math.ceil(win * 0.6)) { let k = s0; while (!bad[k]) k++; edgeAlong.clear = bad[k] === 2; return from + k * step; }
      }
    }
    edgeAlong.clear = false;
    return null;
  }
  // Up from each brow point (26 back to 17) to the hairline, each compared with the forehead's own skin
  // (just above the inner brows: nearly always skin), so hair at the temples is found from the start.
  const lo = 0.08 * len; const hi = 0.75 * len; const usual = 0.42 * len;
  const mid = [(P(21)[0] + P(22)[0]) / 2, (P(21)[1] + P(22)[1]) / 2]; const fs = [];
  for (const t of [0.04, 0.07, 0.1]) for (const sx of [-0.06, 0, 0.06]) { const c = lab(mid[0] + up[0] * t * len - up[1] * sx * len, mid[1] + up[1] * t * len + up[0] * sx * len); if (c && model.off(c[0], c[1], c[2]) < 4.5) fs.push(c); }
  let forehead = fs.length ? [0, 1, 2].map((k) => fs.reduce((t, c) => t + c[k], 0) / fs.length) : null;
  if (!forehead) forehead = model.mean;
  const lifts = []; const clipped = [];
  for (let i = 26; i >= 17; i--) { const [bx, by] = P(i); lifts.push(edgeAlong(bx, by, up[0], up[1], lo, hi, forehead) ?? usual); clipped.push(edgeAlong.clear); }
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
  poly.clipped = clipped; // forehead points stopped by the picture's (or cut-out's) edge, not hair: the forehead is at least that tall
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
 * The Character relit like the face it goes on: the smooth light and shade across that face's skin (its
 * eyes, brows, nose and mouth left out, filled in from around them) and the same across the
 * Character's, and the Character's shade swapped for that face's, `strength` of the way (0..1): lit
 * from the same side, as bright where that face is bright and as shaded where it's shaded, its own
 * detail kept. In place on the patch.
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
  const R = Math.max(2, Math.round(faceW * 0.09));
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  /** The smooth shade over the face's skin (from `at(k)`, a pixel's lightness, or null where it isn't skin). */
  const shade = (at) => {
    const v = new Float32Array(pw * ph * 3); const free = new Uint8Array(pw * ph); const fixed = new Uint8Array(pw * ph);
    let sum = 0; let n = 0;
    for (let k = 0; k < pw * ph; k++) { const l = inFace[k] && !feat[k] ? at(k) : null; if (l == null) { free[k] = 1; continue; } fixed[k] = 1; v[k * 3] = l; sum += l; n++; }
    if (n < 50) return null;
    const mean = sum / n; for (let k = 0; k < pw * ph; k++) if (free[k]) v[k * 3] = mean;
    smoothField(v, free, fixed, pw, ph);
    const f = new Float32Array(pw * ph); for (let k = 0; k < pw * ph; k++) f[k] = v[k * 3];
    return soften(f, pw, ph, R);
  };
  // (Their shade from their skin only: not hair or shadow at the edge of the face.)
  const skin = skinModel(photo, W, H, face);
  const theirs = shade((k) => { const X = x0 + (k % pw); const Y = y0 + Math.floor(k / pw); if (X >= W || Y >= H) return null; const o = (Y * W + X) * 4; if (skin && !skin.isSkin(photo[o], photo[o + 1], photo[o + 2])) return null; return lum(photo[o], photo[o + 1], photo[o + 2]); });
  const mine = shade((k) => (rgba[k * 4 + 3] > 200 ? lum(rgba[k * 4], rgba[k * 4 + 1], rgba[k * 4 + 2]) : null));
  if (!theirs || !mine) return patch;
  // Their shade over its own, evened out over the face (the overall color is recolor's), within reason.
  let sr = 0; let n = 0;
  for (let k = 0; k < pw * ph; k++) if (inFace[k] && rgba[k * 4 + 3] > 200) { sr += theirs[k] / Math.max(1, mine[k]); n++; }
  if (!n) return patch;
  const avg = sr / n;
  for (let k = 0; k < pw * ph; k++) {
    if (!rgba[k * 4 + 3]) continue;
    const r = Math.max(0.75, Math.min(1.3, theirs[k] / Math.max(1, mine[k]) / avg));
    const g = 1 + strength * (r - 1);
    for (let c = 0; c < 3; c++) rgba[k * 4 + c] = Math.min(255, rgba[k * 4 + c] * g);
  }
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
