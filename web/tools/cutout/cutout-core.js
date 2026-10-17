// Cutout math, independent of the DOM: smoothing traced outlines, softening mask edges, and
// finding the visible bounds of a cutout.

/** Chaikin corner cutting on a closed polygon: rounds a jittery finger trace. */
export function smoothClosed(points, iterations = 2) {
  let pts = points;
  for (let k = 0; k < iterations; k++) {
    if (pts.length < 3) return pts;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i]; const [x1, y1] = pts[(i + 1) % pts.length];
      out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    pts = out;
  }
  return pts;
}

/** Absolute area of a polygon (any units). */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i]; const [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a / 2);
}

/** Drop points closer than `minDist` to the previous kept point. */
export function thin(points, minDist) {
  const out = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= minDist) out.push(p);
  }
  return out;
}

/** Box-blur the alpha channel of RGBA data in place (3 passes ≈ Gaussian). Softens cut edges. */
export function featherAlpha(data, w, h, radius) {
  const r = Math.round(radius);
  if (r < 1) return data;
  const a = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = data[i * 4 + 3];
  const tmp = new Float32Array(w * h);
  const pass = (src, dst, horizontal) => {
    const len = horizontal ? w : h; const lines = horizontal ? h : w;
    for (let l = 0; l < lines; l++) {
      let sum = 0;
      const at = (i) => src[horizontal ? l * w + Math.min(len - 1, Math.max(0, i)) : Math.min(len - 1, Math.max(0, i)) * w + l];
      for (let i = -r; i <= r; i++) sum += at(i);
      for (let i = 0; i < len; i++) {
        dst[horizontal ? l * w + i : i * w + l] = sum / (2 * r + 1);
        sum += at(i + r + 1) - at(i - r);
      }
    }
  };
  for (let k = 0; k < 3; k++) { pass(a, tmp, true); pass(tmp, a, false); }
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = Math.round(a[i]);
  return data;
}

/** Bounding box of pixels with alpha > threshold, padded; null if nothing is visible. */
export function alphaBounds(data, w, h, threshold = 8, pad = 2) {
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
