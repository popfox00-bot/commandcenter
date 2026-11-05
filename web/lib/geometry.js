// @ts-check
// Shapes and masks, shared by the photo tools (face fitting, Clean Up, Reverse Fill, Cutout): polygons
// (inside, filled, grown, hull, distance to an edge) and masks over a box of pixels (softened, blurred
// where they're set). Pure, no DOM: runs on the page and in workers alike.

/** @typedef {number[]} Point [x, y] (pixels) */
/** @typedef {Point[]} Polygon */

/** Whether (x, y) is inside the polygon (even-odd). @param {Polygon} poly */
export function inPolygon(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Distance from (x, y) to the segment a–b.
 * @param {number} x @param {number} y @param {Point} a @param {Point} b
 */
export function segmentDistance(x, y, a, b) {
  const [ax, ay] = a; const [bx, by] = b;
  const dx = bx - ax; const dy = by - ay; const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/** Distance from (x, y) to the polygon's edge (closed). @param {Polygon} poly */
export function edgeDistance(poly, x, y) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segmentDistance(x, y, poly[j], poly[i]));
  return d;
}

/**
 * The polygon (pixels) filled into a mask over the box (x0, y0, pw × ph): 1 inside (a pixel is in when
 * its middle is). @param {Polygon} poly @returns {Float32Array}
 */
export function fillPolygon(poly, x0, y0, pw, ph) {
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

/** The convex hull of points (monotone chain), in order around. @param {Point[]} pts @returns {Polygon} */
export function convexHull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (const q of p.reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** The polygon grown by `k` about the average of its points (1: as it is). @param {Polygon} poly @returns {Polygon} */
export function scalePolygon(poly, k) {
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length; const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

/**
 * A mask (w × h, 0..1) blurred by radius `r` (a box, twice over: close to a Gaussian), its edges made a
 * soft ramp. The same mask when r < 1. @param {ArrayLike<number>} m @returns {Float32Array}
 */
export function softenMask(m, w, h, r) {
  if (r < 1) return Float32Array.from(m);
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
  let a = /** @type {Float32Array} */ (m);
  for (let k = 0; k < 2; k++) a = pass(pass(a, true), false);
  return a;
}

/**
 * A box blur (radius r) of `v` (pw × ph) over where `ok` is set only: each pixel the mean of what's set
 * around it (where nothing is, `v` as it is). @param {ArrayLike<number>} v @param {ArrayLike<number>} ok
 * @returns {Float32Array}
 */
export function boxBlur(v, ok, pw, ph, r) {
  const pass = (src, wt, horiz) => {
    const out = new Float32Array(src.length); const ow = new Float32Array(src.length); const [n, lines] = horiz ? [pw, ph] : [ph, pw];
    for (let l = 0; l < lines; l++) {
      const at = (i) => (horiz ? l * pw + i : i * pw + l);
      let s = 0; let c = 0;
      for (let i = 0; i < Math.min(n, r + 1); i++) { s += src[at(i)]; c += wt[at(i)]; }
      for (let i = 0; i < n; i++) {
        out[at(i)] = s; ow[at(i)] = c;
        if (i + r + 1 < n) { s += src[at(i + r + 1)]; c += wt[at(i + r + 1)]; }
        if (i - r >= 0) { s -= src[at(i - r)]; c -= wt[at(i - r)]; }
      }
    }
    return [out, ow];
  };
  const w0 = new Float32Array(v.length); const v0 = new Float32Array(v.length);
  for (let k = 0; k < v.length; k++) if (ok[k]) { w0[k] = 1; v0[k] = v[k]; }
  const [h1, hw] = pass(v0, w0, true); const [s2, sw] = pass(h1, hw, false);
  for (let k = 0; k < v.length; k++) s2[k] = sw[k] > 0 ? s2[k] / sw[k] : v[k];
  return s2;
}
