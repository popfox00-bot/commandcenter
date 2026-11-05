// FaceMask's fitting, where the Character goes: placed by its features for a realistic face (realPlacement;
// bestPlacement by all its landmarks at once), the moving-least-squares bend (mlsMap), and mirrored to look
// the same way as the face it goes on (mirrorFace, mirrorPixels, shouldFlip). Pure.

import { alignOnFace, similarityFit } from '../../lib/face-core.js';

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
    // (The mesh is used only as a shape, point by point: just mirrored.)
    ...(face.mesh ? { mesh: face.mesh.map(([u, v, z]) => [1 - u, v, z]) } : {}),
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
  // Turned by its eye line onto that face's (not by a nose or mouth, which a turned head shows off-center).
  const eyeLine = (P) => { const m = (lo, hi) => { let x = 0; let y = 0; for (let i = lo; i <= hi; i++) { x += P(i)[0]; y += P(i)[1]; } return [x / (hi - lo + 1), y / (hi - lo + 1)]; }; const l = m(36, 41); const r = m(42, 47); return Math.atan2(r[1] - l[1], r[0] - l[0]); };
  // And by the line down its middle (the bridge of its nose to its chin: the long axis of its oval), so it
  // lines up with that face's oval as well as its eyes; the two averaged.
  const midLine = (P) => Math.atan2(P(8)[1] - P(27)[1], P(8)[0] - P(27)[0]);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const rEye = wrap(eyeLine(T) - eyeLine(C)); const rMid = wrap(midLine(T) - midLine(C));
  const rot = Math.atan2(0.5 * Math.sin(rEye) + 0.5 * Math.sin(rMid), 0.5 * Math.cos(rEye) + 0.5 * Math.cos(rMid));
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
  if (jawC > 0) k = Math.min(k, (1.15 * jawT) / (sx * jawC));
  // Only a little bigger than its features alone make it (a face too big for its head is the first thing
  // anyone sees), and its eyes never much farther apart than that face's: smaller if they would be.
  k = Math.max(1, Math.min(1.08, k));
  const eyeT = Math.hypot(tFrame(mid(T, 42, 47))[0] - tFrame(mid(T, 36, 41))[0], tFrame(mid(T, 42, 47))[1] - tFrame(mid(T, 36, 41))[1]);
  const eyeC = Math.hypot(frame(mid(C, 42, 47))[0] - frame(mid(C, 36, 41))[0], frame(mid(C, 42, 47))[1] - frame(mid(C, 36, 41))[1]);
  if (eyeC > 0) k = Math.max(0.9, Math.min(k, (1.04 * eyeT) / eyeC));
  // Lined up across the face by its eyes, and down it by its eyes, mouth and chin together, the eyes the most
  // (when its size was held back, the difference is shared, not all left at the eyes where the old ones would
  // show; a turned head's chin isn't under its eyes the way a face seen straight on has it: lining up by the
  // chin across would pull the whole face sideways).
  const mouthT = tFrame(mid(T, 48, 59)); const mouthC = frame(mid(C, 48, 59));
  const anchT = (2 * eyesT[1] + mouthT[1] + chinT[1]) / 4; const anchC = (2 * eyesC[1] + mouthC[1] + chinC[1]) / 4;
  const down = (q) => anchT + k * (q[1] - anchC);
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
