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

/**
 * Smart edges: trims the background left inside a hand trace, conservatively. Only a band just
 * inside the traced outline is looked at (`band` px, 7% of the picture by default: a finger traces
 * loosely; the middle is never touched, so an object of
 * many colors, like a fruit basket, stays whole), and nothing outside the trace is ever added.
 * Starting from the outline and working inward, a pixel is cut when it looks like the background
 * just outside the trace there (close in color to it) and clearly unlike the object further in, and
 * only while it stays connected to the outside through other cut pixels; a strong edge stops it.
 * When a pass cuts all the way through the band (a very loose trace), another pass starts from the
 * new outline (up to `rounds`). When more than `maxShare` of the traced area would go, something is
 * off (the object is too much like its background to tell apart), and nothing is cut.
 * rgba: the picture (w×h); inside: 1 for pixels in the trace. Returns { keep: Uint8Array (1 = keep),
 * removed: count, share }.
 */
export function smartEdge(rgba, w, h, inside, { rounds = 3, maxShare = 0.8, ...opts } = {}) {
  let area = 0; for (let p = 0; p < w * h; p++) area += inside[p];
  let cur = inside; let removed = 0;
  let still = false;
  for (let r = 0; r < rounds; r++) {
    const pass = edgePass(rgba, w, h, cur, opts);
    still = pass.deep;
    if (!pass.removed) break;
    cur = pass.keep; removed += pass.removed;
    if (!pass.deep) break; // the cut stopped short of the band's inner edge: it found the object
  }
  const share = area ? removed / area : 0;
  // Still cutting after every pass, or most of the trace gone: the object can't be told from its
  // background here, so the trace stays as drawn.
  if (still || share > maxShare) return { keep: Uint8Array.from(inside), removed: 0, share: 0, tooMuch: true };
  return { keep: cur === inside ? Uint8Array.from(inside) : cur, removed, share };
}

/** One pass of smartEdge: the band just inside the current outline. `deep`: the cut reached the band's inner edge somewhere. */
function edgePass(rgba, w, h, inside, { band = Math.max(6, Math.round(Math.max(w, h) * 0.07)), match = 28, margin = 1.6, edge = 90 } = {}) {
  const n = w * h;
  const keep = Uint8Array.from(inside);
  // Colors softened a little (3×3 mean), so grain and JPEG noise don't decide.
  const col = new Float32Array(n * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0; let g = 0; let b = 0; let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx; const Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const i = (Y * w + X) * 4; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; k++;
    }
    const o = (y * w + x) * 3; col[o] = r / k; col[o + 1] = g / k; col[o + 2] = b / k;
  }
  // Perceptual-ish color distance ("redmean").
  const dist = (p, q) => {
    const a = p * 3; const b = q * 3;
    const rm = (col[a] + col[b]) / 2; const dr = col[a] - col[b]; const dg = col[a + 1] - col[b + 1]; const db = col[a + 2] - col[b + 2];
    return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / 3;
  };
  const N8 = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
  const okStep = (p, q) => Math.abs((p % w) - (q % w)) <= 1;
  // Breadth-first from `seeds` over pixels where `pass` holds: each pixel's distance and nearest seed.
  const spread = (seeds, pass, limit) => {
    const d = new Int32Array(n).fill(-1); const src = new Int32Array(n).fill(-1);
    let q = new Int32Array(n); let qn = 0;
    for (const s of seeds) { d[s] = 0; src[s] = s; q[qn++] = s; }
    for (let head = 0; head < qn; head++) {
      const p = q[head]; if (d[p] >= limit) continue;
      for (const o of N8) {
        const t = p + o; if (t < 0 || t >= n || !okStep(p, t) || d[t] >= 0 || !pass(t)) continue;
        d[t] = d[p] + 1; src[t] = src[p]; q[qn++] = t;
      }
    }
    q = null;
    return { d, src };
  };
  const onEdge = (p) => { const x = p % w; const y = (p / w) | 0; return x === 0 || y === 0 || x === w - 1 || y === h - 1; };
  // The background just outside the trace (a thin ring), and how deep each traced pixel is.
  const ring = []; const rim = [];
  let area = 0;
  for (let p = 0; p < n; p++) {
    if (inside[p]) { area++; if (onEdge(p) || N8.some((o) => okStep(p, p + o) && !inside[p + o])) rim.push(p); continue; }
    if (N8.some((o) => { const t = p + o; return t >= 0 && t < n && okStep(p, t) && inside[t]; })) ring.push(p);
  }
  if (!area || !ring.length) return { keep, removed: 0, deep: false };
  const depth = spread(rim, (t) => inside[t] === 1, band + 2).d;
  const near = (p) => depth[p] >= 0 && depth[p] <= band;
  // For each pixel in the band: the nearest background just outside, and the nearest part of the
  // object deeper in than the band (when the object is that big).
  const bgRef = spread(ring, (t) => inside[t] === 1 && near(t), band + 2).src;
  // How much of the outside, all the way round the trace, has each color (16 levels per channel).
  const bin = (p) => ((col[p * 3] >> 4) << 8) | ((col[p * 3 + 1] >> 4) << 4) | (col[p * 3 + 2] >> 4);
  const ringCount = new Map(); for (const p of ring) { const b = bin(p); ringCount.set(b, (ringCount.get(b) ?? 0) + 1); }
  const rep = new Map(); for (const p of ring) if (!rep.has(bin(p))) rep.set(bin(p), p);
  const dominantCache = new Map();
  /** Whether the color of p covers at least half of the outside of the trace (the background proper). */
  const dominant = (p) => {
    const b = bin(p);
    if (dominantCache.has(b)) return dominantCache.get(b);
    let k = 0; for (const [rb, c] of ringCount) if (dist(p, rep.get(rb)) < match) k += c;
    const v = k >= ring.length * 0.5; dominantCache.set(b, v); return v;
  };
  const core = []; for (let p = 0; p < n; p++) if (inside[p] && depth[p] === -1) core.push(p);
  const fgRef = core.length ? spread(core, (t) => inside[t] === 1, n).src : null;
  // How different a pixel is from its neighbours: a strong edge is a border to stop at.
  const grad = (p) => { let m = 0; for (const o of [1, -1, w, -w]) { const t = p + o; if (t >= 0 && t < n && okStep(p, t)) m = Math.max(m, dist(p, t)); } return m; };
  const looksLikeBackground = (p) => {
    if (!near(p) || bgRef[p] < 0) return false;
    const db = dist(p, bgRef[p]);
    if (db > match) return false;
    // Clearly unlike what's further in: background.
    if (fgRef && fgRef[p] >= 0 && dist(bgRef[p], fgRef[p]) >= match * 1.5 && dist(p, fgRef[p]) >= db * margin) return true;
    // Like both the outside and what's further in: either a loose trace over plain background, or the
    // trace running through the object (so "outside" there is the object). Only the background's own
    // color, the one all round the outside of the trace, is cut.
    return dominant(p);
  };
  // Cut from the outline inward, only through background-like pixels.
  const cut = new Uint8Array(n); const q = [];
  for (const p of rim) if (looksLikeBackground(p) && grad(p) < edge) { cut[p] = 1; q.push(p); }
  for (let head = 0; head < q.length; head++) {
    const p = q[head];
    for (const o of N8) {
      const t = p + o; if (t < 0 || t >= n || !okStep(p, t) || cut[t] || !inside[t]) continue;
      if (dist(p, t) > edge * 0.6 || !looksLikeBackground(t)) continue;
      cut[t] = 1; q.push(t);
    }
  }
  // Tidy: a cut pixel mostly surrounded by kept ones is kept (no ragged bites into the object).
  for (let pass = 0; pass < 2; pass++) {
    for (let p = 0; p < n; p++) {
      if (!cut[p]) continue;
      let kept = 0; for (const o of N8) { const t = p + o; if (t >= 0 && t < n && okStep(p, t) && inside[t] && !cut[t]) kept++; }
      if (kept >= 5) cut[p] = 0;
    }
  }
  let removed = 0; let deep = false;
  for (let p = 0; p < n; p++) if (cut[p]) { removed++; keep[p] = 0; if (depth[p] >= band - 1) deep = true; }
  return { keep, removed, deep };
}

/**
 * Patch fix: works out the outline again inside one circle (center cx, cy, radius r, in pixels of
 * `rgba`, w×h), where the current cut (`mask`: 1 = kept) has it wrong. Each pixel in the circle goes
 * with what it looks more like: the object just around the circle (kept pixels from r to 2.5r out,
 * well inside the cut) or the background just around it (the cut-away pixels there); ties keep
 * what's there. Then
 * smoothed (no specks), and only object parts connected to the object outside the circle stay.
 * Returns { x0, y0, bw, bh, bits } (the circle's box, 1 = keep) and how many pixels changed, or
 * null when there's nothing to go by (no object or no background around the circle).
 */
export function patchMask(rgba, w, h, mask, cx, cy, r) {
  const x0 = Math.max(0, Math.floor(cx - r)); const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(w, Math.ceil(cx + r + 1)); const y1 = Math.min(h, Math.ceil(cy + r + 1));
  const bw = x1 - x0; const bh = y1 - y0;
  if (bw < 2 || bh < 2) return null;
  const at = (x, y) => (y * w + x) * 4;
  // Color samples around the circle (from r to 2.5r), as 16-level bins with counts: the object from
  // well inside the cut (leftover background still clinging to its edge doesn't count as object), the
  // background from what's cut away.
  const obj = new Map(); const bg = new Map(); let no = 0; let nb = 0;
  const R2 = Math.ceil(2.5 * r); const deep = Math.max(2, Math.round(r / 2));
  const wx0 = Math.max(0, Math.floor(cx - R2 - deep)); const wy0 = Math.max(0, Math.floor(cy - R2 - deep));
  const wx1 = Math.min(w, Math.ceil(cx + R2 + deep + 1)); const wy1 = Math.min(h, Math.ceil(cy + R2 + deep + 1));
  const ww = wx1 - wx0; const wh = wy1 - wy0;
  // How far each kept pixel in the window is from the cut's edge (in steps, up to `deep`).
  const depth = new Int16Array(ww * wh).fill(-1); let dq = [];
  for (let y = wy0; y < wy1; y++) for (let x = wx0; x < wx1; x++) {
    const j = (y - wy0) * ww + (x - wx0);
    if (!mask[y * w + x]) continue;
    const edgeHere = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx; const Y = y + dy; return X >= 0 && Y >= 0 && X < w && Y < h && !mask[Y * w + X]; });
    if (edgeHere) { depth[j] = 0; dq.push(j); }
  }
  for (let head = 0; head < dq.length; head++) {
    const j = dq[head]; if (depth[j] >= deep) continue; const x = j % ww;
    for (const o of [-1, 1, -ww, ww]) { const t = j + o; if (t < 0 || t >= ww * wh || Math.abs((t % ww) - x) > 1 || depth[t] !== -1) continue; const X = wx0 + (t % ww); const Y = wy0 + Math.floor(t / ww); if (!mask[Y * w + X]) continue; depth[t] = depth[j] + 1; dq.push(t); }
  }
  dq = null;
  for (let y = Math.max(0, Math.floor(cy - R2)); y < Math.min(h, Math.ceil(cy + R2 + 1)); y++) {
    for (let x = Math.max(0, Math.floor(cx - R2)); x < Math.min(w, Math.ceil(cx + R2 + 1)); x++) {
      const d = Math.hypot(x - cx, y - cy); if (d <= r || d > 2.5 * r) continue;
      const i = at(x, y); const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
      const kept = mask[y * w + x];
      const dj = depth[(y - wy0) * ww + (x - wx0)];
      if (kept && dj !== -1 && dj < deep) continue; // near the cut's edge: could be either
      const m = kept ? obj : bg; m.set(key, (m.get(key) ?? 0) + 1);
      if (kept) no++; else nb++;
    }
  }
  if (no < 20 || nb < 20) return null;
  // The colors that make up each side (bins with at least 0.5% of its samples), as RGB.
  const centers = (m, total) => [...m].filter(([, c]) => c >= total * 0.005).map(([k]) => [((k >> 8) << 4) + 8, (((k >> 4) & 15) << 4) + 8, ((k & 15) << 4) + 8]);
  const co = centers(obj, no); const cb = centers(bg, nb);
  const near = (list, rr, g, b) => { let best = Infinity; for (const [R, G, B] of list) { const rm = (rr + R) / 2; const d = (2 + rm / 256) * (rr - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - rm) / 256) * (b - B) ** 2; if (d < best) best = d; } return best; };
  const bits = new Uint8Array(bw * bh); const inC = new Uint8Array(bw * bh);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const j = (y - y0) * bw + (x - x0);
    if (Math.hypot(x - cx, y - cy) > r) { bits[j] = mask[y * w + x]; continue; }
    inC[j] = 1;
    // Each pixel by its 3×3 neighbourhood's mean color (grain doesn't decide).
    let R = 0; let G = 0; let B = 0; let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx; const Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const i = at(X, Y); R += rgba[i]; G += rgba[i + 1]; B += rgba[i + 2]; k++; }
    const dO = near(co, R / k, G / k, B / k); const dB = near(cb, R / k, G / k, B / k);
    bits[j] = dO < dB * 0.8 ? 1 : dB < dO * 0.8 ? 0 : mask[y * w + x];
  }
  // Smooth: a pixel goes with most of its neighbours (twice).
  for (let pass = 0; pass < 2; pass++) {
    const prev = Uint8Array.from(bits);
    for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
      const j = y * bw + x; if (!inC[j]) continue;
      let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += prev[j + dy * bw + dx];
      bits[j] = s >= 5 ? 1 : 0;
    }
  }
  // Only object parts that reach the object outside the circle stay (no islands of look-alike color).
  const seen = new Uint8Array(bw * bh); const q = [];
  for (let j = 0; j < bw * bh; j++) if (!inC[j] && bits[j]) { seen[j] = 1; q.push(j); }
  for (let head = 0; head < q.length; head++) {
    const j = q[head]; const x = j % bw;
    for (const o of [-1, 1, -bw, bw]) { const t = j + o; if (t < 0 || t >= bw * bh || Math.abs((t % bw) - x) > 1 || seen[t] || !bits[t]) continue; seen[t] = 1; q.push(t); }
  }
  let changed = 0;
  for (let j = 0; j < bw * bh; j++) {
    if (!inC[j]) continue;
    if (bits[j] && !seen[j]) bits[j] = 0;
    const was = mask[(y0 + Math.floor(j / bw)) * w + x0 + (j % bw)];
    if (bits[j] !== was) changed++;
  }
  return { x0, y0, bw, bh, bits, changed };
}
