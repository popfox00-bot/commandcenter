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

// ---------- fixes: patch, wand, brush ----------
// Each fix returns the pixels it changes, { idx: Uint32Array, val: Uint8Array } (val 1 = keep), so
// fixes replay in order over whatever cut is under them (applyChanges), and undo is just dropping one.

/** The photo softened (3×3 mean), as RGB floats: fixes compare these, so grain doesn't decide. */
export function softColors(rgba, w, h) {
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0; let g = 0; let b = 0; let k = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const Y = y + dy; if (Y < 0 || Y >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx; if (X < 0 || X >= w) continue;
        const i = (Y * w + X) * 4; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; k++;
      }
    }
    const o = (y * w + x) * 3; out[o] = r / k; out[o + 1] = g / k; out[o + 2] = b / k;
  }
  return out;
}

export function applyChanges(mask, ch) { for (let k = 0; k < ch.idx.length; k++) mask[ch.idx[k]] = ch.val[k]; return mask; }

/** Steps (4-neighbour, up to `cap`) from each pixel to the nearest pixel of the other side of the cut. */
export function edgeDistance(mask, w, h, cap = 32) {
  const d = new Uint8Array(w * h).fill(cap);
  const q = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; const m = mask[i];
    if ((x > 0 && mask[i - 1] !== m) || (x < w - 1 && mask[i + 1] !== m) || (y > 0 && mask[i - w] !== m) || (y < h - 1 && mask[i + w] !== m)) { d[i] = 0; q.push(i); }
  }
  for (let head = 0; head < q.length; head++) {
    const i = q[head]; const nd = d[i] + 1; if (nd >= cap) continue;
    const x = i % w; const m = mask[i];
    for (const t of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (t < 0 || t >= w * h || mask[t] !== m || d[t] <= nd) continue;
      d[t] = nd; q.push(t);
    }
  }
  return d;
}

// Color histograms: 16 levels a channel, each color spread over its 8 nearest bins (no hard steps).
const BINS = 16;
function addColor(hist, r, g, b, wt) {
  const fr = Math.min(BINS - 1.001, Math.max(0, r / 16 - 0.5)); const fg = Math.min(BINS - 1.001, Math.max(0, g / 16 - 0.5)); const fb = Math.min(BINS - 1.001, Math.max(0, b / 16 - 0.5));
  const r0 = Math.floor(fr); const g0 = Math.floor(fg); const b0 = Math.floor(fb);
  const tr = fr - r0; const tg = fg - g0; const tb = fb - b0;
  for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) for (let e = 0; e < 2; e++) {
    hist[((r0 + a) * BINS + (g0 + c)) * BINS + (b0 + e)] += wt * (a ? tr : 1 - tr) * (c ? tg : 1 - tg) * (e ? tb : 1 - tb);
  }
}
function lookup(hist, r, g, b) {
  const fr = Math.min(BINS - 1.001, Math.max(0, r / 16 - 0.5)); const fg = Math.min(BINS - 1.001, Math.max(0, g / 16 - 0.5)); const fb = Math.min(BINS - 1.001, Math.max(0, b / 16 - 0.5));
  const r0 = Math.floor(fr); const g0 = Math.floor(fg); const b0 = Math.floor(fb);
  const tr = fr - r0; const tg = fg - g0; const tb = fb - b0; let s = 0;
  for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) for (let e = 0; e < 2; e++) {
    s += hist[((r0 + a) * BINS + (g0 + c)) * BINS + (b0 + e)] * (a ? tr : 1 - tr) * (c ? tg : 1 - tg) * (e ? tb : 1 - tb);
  }
  return s;
}

/**
 * What the object and the background look like, from the cut as it is: the object from kept pixels
 * a few steps in from the edge (leftover background clinging to the edge doesn't count), the
 * background from cut pixels a step or two out. Over the box x0..x1, y0..y1 (the whole photo by
 * default). { obj, bg, no, nb } (histograms and how many samples).
 */
export function colorModel(soft, w, h, mask, dist, { x0 = 0, y0 = 0, x1 = w, y1 = h, deep = 3 } = {}) {
  const obj = new Float32Array(BINS ** 3); const bg = new Float32Array(BINS ** 3); let no = 0; let nb = 0;
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
    const i = y * w + x; const o = i * 3;
    if (mask[i]) { if (dist[i] >= deep) { addColor(obj, soft[o], soft[o + 1], soft[o + 2], 1); no++; } }
    else if (dist[i] >= 2) { addColor(bg, soft[o], soft[o + 1], soft[o + 2], 1); nb++; }
  }
  return { obj, bg, no, nb };
}

/**
 * Patch fix: inside one circle (cx, cy, radius r, in pixels of the work copy), the cut is worked out
 * again. Each pixel weighs how much its color is like the object against the background (from
 * around the circle, and from the whole photo: `global`, colorModel of the whole cut), and the
 * neighbours it looks like pull it their way, so the edge settles on the line where the colors change.
 * dir: 'auto' (in or out), 'cut' (only takes away: for background left in) or 'keep' (only brings
 * back: for parts cut off). Kept parts must reach the object outside the circle (no islands). The
 * changes, or null when there's nothing to go by (no object or no background around).
 */
export function refineSpot(soft, w, h, mask, cx, cy, r, { dir = 'auto', global = null, dist = null } = {}) {
  r = Math.max(2, r);
  const x0 = Math.max(0, Math.floor(cx - r)); const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(w, Math.ceil(cx + r + 1)); const y1 = Math.min(h, Math.ceil(cy + r + 1));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  dist = dist ?? edgeDistance(mask, w, h);
  const R3 = Math.ceil(3 * r);
  const local = colorModel(soft, w, h, mask, dist, { x0: Math.floor(cx - R3), y0: Math.floor(cy - R3), x1: Math.ceil(cx + R3 + 1), y1: Math.ceil(cy + R3 + 1), deep: Math.min(24, Math.max(3, Math.round(r * 0.8))) });
  // Nothing of one side nearby: patching here would only guess.
  if (local.no < 15 || (local.nb < 15 && dir !== 'keep') || (dir === 'keep' && local.nb < 15 && !global)) return null;
  const g = global && global.no > 50 && global.nb > 50 ? global : null;
  const p = (m, n, gm, gn, r_, g_, b_) => {
    const loc = n ? lookup(m, r_, g_, b_) / n : 0;
    return g ? 0.65 * loc + 0.35 * lookup(gm, r_, g_, b_) / gn : loc;
  };
  const eps = 2e-5;
  const list = []; const pos = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (Math.hypot(x - cx, y - cy) <= r) { pos.set(y * w + x, list.length); list.push(y * w + x); }
  if (!list.length) return null;
  // How much each pixel looks like background rather than object (log-odds, clamped).
  const L = new Float32Array(list.length);
  list.forEach((i, k) => {
    const o = i * 3; const R = soft[o]; const G = soft[o + 1]; const B = soft[o + 2];
    const pb = p(local.bg, local.nb, g?.bg, g?.nb, R, G, B); const po = p(local.obj, local.no, g?.obj, g?.no, R, G, B);
    L[k] = Math.max(-4, Math.min(4, Math.log((pb + eps) / (po + eps))));
  });
  // Settle labels: the colors' pull, a cost for changing what's there (more when the direction is
  // left to the patch), and neighbours that look alike wanting the same side.
  const stay = dir === 'auto' ? 0.6 : 0.2; const lambda = 1.1; const sig2 = 2 * 14 * 14;
  // Start from what the colors say (with the cost of changing), then let neighbours settle it.
  const lab = Uint8Array.from(list, (i, k) => {
    const was = mask[i];
    if ((dir === 'cut' && !was) || (dir === 'keep' && was)) return was;
    return L[k] + (was ? 0 : stay) < -L[k] + (was ? stay : 0) ? 1 : 0;
  });
  const labelOf = (t) => { const k = pos.get(t); return k === undefined ? mask[t] : lab[k]; };
  for (let sweep = 0; sweep < 6; sweep++) {
    let moved = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k]; const was = mask[i];
      if ((dir === 'cut' && !was) || (dir === 'keep' && was)) continue;
      const x = i % w; let e1 = L[k] + (was ? 0 : stay); let e0 = -L[k] + (was ? stay : 0);
      const o = i * 3;
      for (const t of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (t < 0 || t >= w * h) continue;
        const q = t * 3; const dd = (soft[o] - soft[q]) ** 2 + (soft[o + 1] - soft[q + 1]) ** 2 + (soft[o + 2] - soft[q + 2]) ** 2;
        const wt = lambda * Math.exp(-dd / sig2);
        if (labelOf(t)) e0 += wt; else e1 += wt;
      }
      const nl = e1 < e0 ? 1 : 0;
      if (nl !== lab[k]) { lab[k] = nl; moved++; }
    }
    if (!moved) break;
  }
  // Kept parts in the circle must reach the object outside it.
  const seen = new Uint8Array(list.length); const q = [];
  const isKept = (t) => labelOf(t) === 1;
  for (let k = 0; k < list.length; k++) {
    if (!lab[k]) continue; const i = list[k]; const x = i % w;
    for (const t of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (t >= 0 && t < w * h && !pos.has(t) && mask[t]) { seen[k] = 1; q.push(k); break; }
  }
  for (let head = 0; head < q.length; head++) {
    const i = list[q[head]]; const x = i % w;
    for (const t of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      const k = pos.get(t); if (k === undefined || seen[k] || !lab[k] || !isKept(t)) continue;
      seen[k] = 1; q.push(k);
    }
  }
  const idx = []; const val = [];
  for (let k = 0; k < list.length; k++) {
    let v = lab[k] && seen[k] ? 1 : 0;
    if (dir === 'keep' && mask[list[k]]) v = 1;
    if (v !== mask[list[k]]) { idx.push(list[k]); val.push(v); }
  }
  return { idx: Uint32Array.from(idx), val: Uint8Array.from(val) };
}

/**
 * Magic wand: from the pixel tapped (x, y), everything joined to it that looks like it changes side:
 * a kept leftover (the sky under a handle, a patch of grass) is cut away, a part cut off by mistake
 * is brought back. Like it: within `tol` of a color right at the tap, reached without crossing a
 * sharp change of color (an edge). It spreads only through pixels on the same side as the one tapped,
 * and when bringing back, only inside `within` (the traces as drawn) when given. The changes, or null.
 */
export function wand(soft, w, h, mask, x, y, tol = 30, { within = null, maxShare = 0.35 } = {}) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const start = y * w + x; const side = mask[start];
  if (!side && within && !within[start]) return null;
  // The colors right at the tap (3×3, same side).
  const samples = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const X = x + dx; const Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h || mask[Y * w + X] !== side) continue;
    const o = (Y * w + X) * 3; samples.push([soft[o], soft[o + 1], soft[o + 2]]);
  }
  const t2 = tol * tol; const step2 = (tol * 0.6) ** 2;
  const dist2 = (o, r, g, b) => (soft[o] - r) ** 2 + (soft[o + 1] - g) ** 2 + (soft[o + 2] - b) ** 2;
  const near = (o) => samples.some(([r, g, b]) => dist2(o, r, g, b) <= t2);
  const seen = new Uint8Array(w * h); const q = [start]; seen[start] = 1;
  const limit = Math.max(50, Math.round(w * h * maxShare));
  for (let head = 0; head < q.length; head++) {
    if (q.length > limit) return null; // ran into much of the photo: too loose to mean anything
    const i = q[head]; const X = i % w; const oi = i * 3;
    for (const t of [X > 0 ? i - 1 : -1, X < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (t < 0 || t >= w * h || seen[t] || mask[t] !== side || (!side && within && !within[t])) continue;
      const o = t * 3;
      if (!near(o) || dist2(o, soft[oi], soft[oi + 1], soft[oi + 2]) > step2) continue;
      seen[t] = 1; q.push(t);
    }
  }
  // Fill pinholes: pixels it skipped with 3 or 4 of their neighbours in the region.
  const region = q.slice();
  for (const i of q) {
    const X = i % w;
    for (const t of [X > 0 ? i - 1 : -1, X < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (t < 0 || t >= w * h || seen[t] || mask[t] !== side) continue;
      const tx = t % w; let n = 0;
      for (const u of [tx > 0 ? t - 1 : -1, tx < w - 1 ? t + 1 : -1, t - w, t + w]) if (u >= 0 && u < w * h && seen[u] === 1) n++;
      if (n >= 3) { seen[t] = 2; region.push(t); }
    }
  }
  const idx = Uint32Array.from(region); return { idx, val: new Uint8Array(idx.length).fill(side ? 0 : 1), cut: !!side };
}

/** Brush: a stroke (points in work pixels, radius r) painted kept (keep) or cut. The changes. */
export function brush(w, h, mask, points, r, keep) {
  const hit = new Set();
  const dab = (cx, cy) => {
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, Math.ceil(cy + r + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, Math.ceil(cx + r + 1)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) hit.add(y * w + x);
    }
  };
  points.forEach(([x, y], k) => {
    if (!k) { dab(x, y); return; }
    const [px, py] = points[k - 1]; const steps = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / Math.max(1, r / 3)));
    for (let s = 1; s <= steps; s++) dab(px + ((x - px) * s) / steps, py + ((y - py) * s) / steps);
  });
  const v = keep ? 1 : 0; const idx = [...hit].filter((i) => mask[i] !== v);
  return { idx: Uint32Array.from(idx), val: new Uint8Array(idx.length).fill(v) };
}
