// @ts-check
// How good a face swap is, in numbers (for tuning FM, not shown in the app): the face found again in the
// result compared with the face it went on (lined up?) and with the Character's own (kept its shape?), and
// the edge of what was put in (a seam?). Each 0 is perfect, bigger is worse. Pure.

/** @typedef {number[][]} Pts 68 landmarks [x, y], pixels */

const mid = (P, a, b) => { let x = 0; let y = 0; for (let i = a; i <= b; i++) { x += P[i][0]; y += P[i][1]; } return [x / (b - a + 1), y / (b - a + 1)]; };
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
/** The distance between the eyes' middles: the face's own scale. @param {Pts} P */
export const eyeSpan = (P) => dist(mid(P, 36, 41), mid(P, 42, 47));

/**
 * Lined up: how far the result's landmarks are from the base face's (eyes, brows, nose, mouth, jaw), on
 * average, as a share of the base's eye span. ~0.05 is close; 0.15 or more, visibly off.
 * @param {Pts} base @param {Pts} result
 */
export function alignment(base, result) {
  const s = eyeSpan(base) || 1; let t = 0;
  for (let i = 0; i < 68; i++) t += dist(base[i], result[i]);
  return t / 68 / s;
}

/** A face's proportions, each a length over its eye span: what makes it look like itself. @param {Pts} P */
export function proportions(P) {
  const s = eyeSpan(P) || 1; const eyes = [mid(P, 36, 41), mid(P, 42, 47)]; const eyeMid = [(eyes[0][0] + eyes[1][0]) / 2, (eyes[0][1] + eyes[1][1]) / 2];
  return {
    'eye width': (dist(P[36], P[39]) + dist(P[42], P[45])) / 2 / s,
    'nose length': dist(P[27], P[33]) / s,
    'nose width': dist(P[31], P[35]) / s,
    'mouth width': dist(P[48], P[54]) / s,
    'lips height': dist(P[51], P[57]) / s,
    'eyes to mouth': dist(eyeMid, mid(P, 48, 59)) / s,
    'brows to eyes': (dist(mid(P, 17, 21), eyes[0]) + dist(mid(P, 22, 26), eyes[1])) / 2 / s,
  };
}

/**
 * Kept its shape: how much each of the Character's proportions changed in the result, on average (as a
 * share), and each one's change. ~0.05 is itself; 0.15 or more, a different (distorted) face.
 * @param {Pts} character @param {Pts} result
 */
export function distortion(character, result) {
  const a = proportions(character); const b = proportions(result);
  /** @type {Record<string, number>} */
  const each = {}; let t = 0; let n = 0;
  for (const k of Object.keys(a)) { const d = Math.abs(b[k] - a[k]) / (a[k] || 1); each[k] = d; t += d; n++; }
  return { mean: t / n, each };
}

/**
 * A seam: where the result stops being the photo it started as (the edge of what was put in), how much
 * busier it is there than that photo was in the same places (its brightness changing pixel to pixel), so
 * the photo's own edges (a jaw against the background, hair) don't count. ~0: no seam to see; 0.5: half
 * again as busy along the edge as the photo was.
 * @param {ArrayLike<number>} result RGBA W×H @param {ArrayLike<number>} before RGBA W×H (the photo before)
 * @param {number} W @param {number} H
 */
export function seam(result, before, W, H) {
  const lum = (a, i) => 0.299 * a[i * 4] + 0.587 * a[i * 4 + 1] + 0.114 * a[i * 4 + 2];
  // What changed (more than a little), softened into a ramp: its edge is where it's neither all nor none.
  const changed = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) changed[i] = Math.abs(lum(result, i) - lum(before, i)) > 6 ? 1 : 0;
  const soft = softenBox(changed, W, H, 3);
  let r = 0; let b = 0; let n = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; const s = soft[i]; if (s < 0.25 || s > 0.75) continue;
    const g = (a) => Math.abs(lum(a, i + 1) - lum(a, i - 1)) + Math.abs(lum(a, i + W) - lum(a, i - W));
    r += g(result); b += g(before); n++;
  }
  if (n < 50) return 0;
  // (Averages along it; the photo's own floored at a little, so flat skin doesn't make any change look huge.)
  return Math.max(0, r / n / Math.max(2, b / n) - 1);
}

/** A mask blurred by a box of radius r (rows, then columns). */
function softenBox(m, w, h, r) {
  const a = new Float32Array(m.length); const out = new Float32Array(m.length);
  for (let y = 0; y < h; y++) { let s = 0; let c = 0; for (let x = -r; x < w + r; x++) { if (x + r < w && x + r >= 0) { s += m[y * w + x + r]; c++; } if (x - r - 1 >= 0) { s -= m[y * w + x - r - 1]; c--; } if (x >= 0 && x < w) a[y * w + x] = s / Math.max(1, c); } }
  for (let x = 0; x < w; x++) { let s = 0; let c = 0; for (let y = -r; y < h + r; y++) { if (y + r < h && y + r >= 0) { s += a[(y + r) * w + x]; c++; } if (y - r - 1 >= 0) { s -= a[(y - r - 1) * w + x]; c--; } if (y >= 0 && y < h) out[y * w + x] = s / Math.max(1, c); } }
  return out;
}

/**
 * All three, for a result: { alignment, distortion, seam, each } (each the distortion's own parts).
 * @param {{ base: Pts, character: Pts, result: Pts, rgba: ArrayLike<number>, before: ArrayLike<number>, W: number, H: number }} s
 */
export function scoreSwap({ base, character, result, rgba, before, W, H }) {
  const d = distortion(character, result);
  return { alignment: alignment(base, result), distortion: d.mean, seam: seam(rgba, before, W, H), each: d.each };
}
