// Overlay icons: the round buttons apps draw on top of a post's media (Instagram's mute and "tagged
// people" buttons: a dark translucent disc with a white symbol), and the carousel counter pill in the
// top right ("11/13": a dark translucent rounded pill with white text). Auto-Crop finds them in the
// media's corners and fills each one in from the background just around it.
//
// The fill is a retouch patch kept in the edit state (`state.patches`), in source-image coordinates,
// so the original is never changed: patches are painted onto the source before every other edit
// (preview, export, bulk), and undo removes them. A patch is { x, y, w, h } (0..1 of the source),
// its pixel size { pw, ph } and RGBA pixels as base64 (`data`; transparent outside the disc).
// Detection and filling are pure (RGBA in, circles and pixels out); applyPatches() needs a canvas.

export const ICON_DEFAULTS = Object.freeze({
  rMin: 0.015,     // icon radius, as a share of the image width: from 1.5%...
  rMax: 0.06,      // ...to 6% (Instagram's are ~3.6% on a phone screenshot)
  zone: 0.3,       // icons are looked for in each corner of the media, this share of the width square
  edge: 20,        // the disc is at least this much darker (luminance) than just outside it...
  ring: 0.8,       // ...all the way around: on at least 80% of the circle
  flat: 14,        // the disc itself is flat: 80% of its rim within this luminance of the rim's median
  glyphMin: 0.04,  // the white symbol fills 4%...
  glyphMax: 0.6,   // ...to 60% of the disc's middle
  margin: 0.08,    // the fill covers the disc plus this share of its radius (soft edge), at least 2 px
  pillMin: 0.025,  // counter pill height, as a share of the image width: from 2.5%...
  pillMax: 0.1,    // ...to 10% (Instagram's is ~6% on a phone screenshot)
  pillEdge: 12,    // the pill is see-through, so it's only this much darker than just outside it
  faint: 5,        // from the symbol out, the disc only needs to be this much darker than around it
});

const lum = (p, i) => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];

/** Luminance of an RGBA image, area-averaged down by an integer factor f. */
function lumMap(rgba, w, h, f) {
  const lw = Math.floor(w / f); const lh = Math.floor(h / f);
  const out = new Float32Array(lw * lh);
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += lum(rgba, ((y * f + dy) * w + x * f + dx) * 4);
      out[y * lw + x] = s / (f * f);
    }
  }
  return { L: out, w: lw, h: lh };
}

const ANGLES = (n) => Array.from({ length: n }, (_, i) => [Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n)]);
const A8 = ANGLES(8); const A16 = ANGLES(16); const A32 = ANGLES(32); const A64 = ANGLES(64);

/**
 * Overlay-icon circles in an RGBA image (w×h). `rMin`/`rMax` are radii in pixels. Returns
 * [{ cx, cy, r }] in pixels, strongest first. A circle must be a flat disc clearly darker than its
 * surroundings all the way around, with a white symbol in its middle.
 */
export function findIcons(rgba, w, h, { rMin, rMax, ...opts }) {
  const cfg = { ...ICON_DEFAULTS, ...opts };
  const f = Math.max(1, Math.floor(rMax / 12)); // coarse search scale (small buttons: the symbol-first path)
  const M = lumMap(rgba, w, h, f);
  const at = (x, y) => { const xi = Math.round(x); const yi = Math.round(y); return xi < 0 || yi < 0 || xi >= M.w || yi >= M.h ? -1 : M.L[yi * M.w + xi]; };
  const r0 = Math.max(3, Math.floor(rMin / f)); const r1 = Math.max(r0, Math.ceil(rMax / f));
  // Quick pre-check on 8 directions: darker inside than outside on at least 6.
  const quick = (cx, cy, r) => {
    let pass = 0;
    for (let i = 0; i < 8; i++) {
      const [ux, uy] = A8[i];
      if (at(cx + (r + 1.5) * ux, cy + (r + 1.5) * uy) - at(cx + (r - 1.5) * ux, cy + (r - 1.5) * uy) >= cfg.edge) pass++;
      else if (i - pass >= 2) return false;
    }
    return pass >= 6;
  };
  const ringTest = (cx, cy, r, dirs) => {
    let pass = 0; const inner = [];
    for (const [ux, uy] of dirs) {
      const a = at(cx + (r - 1.5) * ux, cy + (r - 1.5) * uy); const b = at(cx + (r + 1.5) * ux, cy + (r + 1.5) * uy);
      if (a < 0 || b < 0) return null;
      if (b - a >= cfg.edge) pass++;
      inner.push(a);
    }
    // Flat: most of the rim within `flat` of its median (a symbol touching the rim is fine).
    inner.sort((p, q) => p - q);
    const med = inner[inner.length >> 1];
    const flat = inner.filter((v) => Math.abs(v - med) <= cfg.flat).length / inner.length;
    return { share: pass / dirs.length, flat };
  };
  const found = [];
  for (let cy = r0; cy < M.h - r0; cy++) {
    for (let cx = r0; cx < M.w - r0; cx++) {
      for (let r = r0; r <= r1; r++) {
        if (cx - r - 2 < 0 || cy - r - 2 < 0 || cx + r + 2 >= M.w || cy + r + 2 >= M.h) break;
        if (!quick(cx, cy, r)) continue;
        const t = ringTest(cx, cy, r, A32);
        if (t && t.share >= cfg.ring && t.flat >= cfg.ring) found.push({ cx: cx * f, cy: cy * f, r: r * f, score: t.share + t.flat });
      }
    }
  }
  // Strongest first, grouped by spot; refine up to three per spot on the full image, check the
  // symbol, and drop overlaps.
  found.sort((a, b) => b.score - a.score || a.cy - b.cy || a.cx - b.cx);
  const spots = [];
  for (const c of found) {
    const spot = spots.find((g) => Math.hypot(g[0].cx - c.cx, g[0].cy - c.cy) < Math.max(g[0].r, c.r));
    if (!spot) spots.push([c]); else if (spot.length < 3) spot.push(c);
  }
  const out = [];
  // Symbol first: the white sound or person symbol always stands out, even where the gray disc
  // around it barely does (a dark or busy background). Then a faint, even disc around it is enough.
  for (const c of symbolCircles(rgba, w, h, rMin, rMax, cfg)) if (!out.some((o) => Math.hypot(o.cx - c.cx, o.cy - c.cy) < o.r + c.r)) out.push(c);
  for (const spot of spots) {
    for (const c of spot) {
      if (out.some((o) => Math.hypot(o.cx - c.cx, o.cy - c.cy) < o.r + c.r)) break;
      const fine = refine(rgba, w, h, c);
      if (fine && hasSymbol(rgba, w, h, fine, cfg) && !out.some((o) => Math.hypot(o.cx - fine.cx, o.cy - fine.cy) < o.r + fine.r)) { out.push(fine); break; }
    }
  }
  return out;
}

/**
 * Circles found from their symbol: clusters of white, neutral pixels (the symbol's parts: a head and
 * shoulders, a speaker and a slash) of a plausible size; around each, the radius at which the ring
 * just inside is darker than just outside on most of the circle (radially averaged, so a faint step
 * on a noisy background still shows), with an even disc between the symbol and the ring.
 */
function symbolCircles(rgba, w, h, rMin, rMax, cfg) {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lum(rgba, i * 4);
  const white = (i) => L[i] >= 200 && Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) - Math.min(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) <= 40;
  const seen = new Uint8Array(w * h); const parts = [];
  const cap = Math.ceil((rMax * 2) ** 2);
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !white(i)) continue;
    let x0 = w; let x1 = 0; let y0 = h; let y1 = 0; let n = 0; const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const j = stack.pop(); const x = j % w; const y = (j - x) / w; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !seen[j - 1] && white(j - 1)) { seen[j - 1] = 1; stack.push(j - 1); }
      if (x < w - 1 && !seen[j + 1] && white(j + 1)) { seen[j + 1] = 1; stack.push(j + 1); }
      if (y > 0 && !seen[j - w] && white(j - w)) { seen[j - w] = 1; stack.push(j - w); }
      if (y < h - 1 && !seen[j + w] && white(j + w)) { seen[j + w] = 1; stack.push(j + w); }
    }
    if (n >= 4 && n <= cap && x1 - x0 < rMax * 1.6 && y1 - y0 < rMax * 1.6) parts.push({ x0, x1: x1 + 1, y0, y1: y1 + 1 });
  }
  // Group the parts of one symbol (close together), then try a circle around each group.
  const groups = [];
  for (const p of parts) {
    const g = groups.find((q) => p.x0 <= q.x1 + rMin && p.x1 >= q.x0 - rMin && p.y0 <= q.y1 + rMin && p.y1 >= q.y0 - rMin);
    if (g) { g.x0 = Math.min(g.x0, p.x0); g.x1 = Math.max(g.x1, p.x1); g.y0 = Math.min(g.y0, p.y0); g.y1 = Math.max(g.y1, p.y1); } else groups.push({ ...p });
  }
  const at = (x, y) => { const xi = Math.round(x); const yi = Math.round(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : L[yi * w + xi]; };
  const out = [];
  for (const g of groups) {
    const size = Math.max(g.x1 - g.x0, g.y1 - g.y0);
    if (size < rMin * 0.6) continue;
    // The symbol is about 0.8–1.4 of the radius across.
    const rLo = Math.max(rMin, Math.floor(size / 1.5)); const rHi = Math.min(rMax, Math.ceil(size / 0.7));
    // Score a circle: the share of directions where the ring just inside is darker than just
    // outside (each side averaged over 3 px), plus an even disc between the symbol and the edge.
    const ring = (cx, cy, r, dirs) => {
      let pass = 0; let sum = 0;
      for (const [ux, uy] of dirs) {
        let a = 0; let b = 0;
        for (let k = 1; k <= 3; k++) {
          const ai = at(cx + (r - k) * ux, cy + (r - k) * uy); const bi = at(cx + (r + k) * ux, cy + (r + k) * uy);
          if (ai < 0 || bi < 0) return null;
          a += ai; b += bi;
        }
        const d = (b - a) / 3;
        if (d >= cfg.faint) pass++;
        sum += d;
      }
      return { share: pass / dirs.length, mean: sum / dirs.length };
    };
    const even = (cx, cy, r) => {
      const rim = A64.map(([ux, uy]) => at(cx + r * 0.85 * ux, cy + r * 0.85 * uy)).sort((p, q) => p - q);
      const med = rim[32];
      return rim.filter((v) => Math.abs(v - med) <= Math.max(cfg.flat, med * 0.25)).length / 64 >= 0.75;
    };
    // Coarse: centers on a 2 px grid, every other radius, 16 directions. Then fine around the best.
    const gx = (g.x0 + g.x1) / 2; const gy = (g.y0 + g.y1) / 2;
    let coarse = null;
    for (let oy = -2; oy <= 2; oy += 2) {
      for (let ox = -2; ox <= 2; ox += 2) {
        for (let r = rLo; r <= rHi; r += 2) {
          const t = ring(gx + ox, gy + oy, r, A16);
          if (t && t.share >= 0.7 && (!coarse || t.share + t.mean / 100 > coarse.score)) coarse = { cx: gx + ox, cy: gy + oy, r, score: t.share + t.mean / 100 };
        }
      }
    }
    if (!coarse) continue;
    let best = null;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        for (let r = Math.max(rLo, coarse.r - 2); r <= Math.min(rHi, coarse.r + 2); r++) {
          const cx = coarse.cx + ox; const cy = coarse.cy + oy;
          const t = ring(cx, cy, r, A64);
          if (!t || t.share < 0.75 || !even(cx, cy, r)) continue;
          const score = t.share + t.mean / 100;
          if (!best || score > best.score) best = { cx, cy, r, score };
        }
      }
    }
    if (best) out.push({ cx: Math.round(best.cx * 10) / 10, cy: Math.round(best.cy * 10) / 10, r: best.r });
  }
  return out;
}

/** Fit the circle on full-size pixels: the strongest dark→light step along 64 rays, twice. */
function refine(rgba, w, h, c) {
  let { cx, cy, r } = c;
  for (let pass = 0; pass < 2; pass++) {
    const pts = [];
    for (const [ux, uy] of A64) {
      let best = 0; let bestD = -1;
      for (let d = Math.floor(r * 0.7); d <= Math.ceil(r * 1.3); d++) {
        const x0 = Math.round(cx + (d - 1) * ux); const y0 = Math.round(cy + (d - 1) * uy);
        const x1 = Math.round(cx + (d + 1) * ux); const y1 = Math.round(cy + (d + 1) * uy);
        if (x0 < 0 || y0 < 0 || x1 < 0 || y1 < 0 || x0 >= w || x1 >= w || y0 >= h || y1 >= h) break;
        const g = lum(rgba, (y1 * w + x1) * 4) - lum(rgba, (y0 * w + x0) * 4);
        if (g > best) { best = g; bestD = d; }
      }
      if (bestD > 0) pts.push([cx + bestD * ux, cy + bestD * uy, bestD]);
    }
    if (pts.length < 48) return null;
    const ds = pts.map((p) => p[2]).sort((a, b) => a - b);
    const med = ds[Math.floor(ds.length / 2)];
    const good = pts.filter((p) => Math.abs(p[2] - med) <= Math.max(2, med * 0.12));
    if (good.length < 48) return null; // not round
    cx = good.reduce((s, p) => s + p[0], 0) / good.length;
    cy = good.reduce((s, p) => s + p[1], 0) / good.length;
    r = med;
  }
  return { cx: Math.round(cx * 10) / 10, cy: Math.round(cy * 10) / 10, r };
}

/** A white symbol in the middle of a flat dark disc. */
function hasSymbol(rgba, w, h, { cx, cy, r }, cfg) {
  const rim = []; const mid = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d >= 0.75 && d <= 0.9) rim.push(lum(rgba, (y * w + x) * 4));
      else if (d <= 0.6) mid.push(lum(rgba, (y * w + x) * 4));
    }
  }
  rim.sort((a, b) => a - b);
  const disc = rim[Math.floor(rim.length / 2)];
  if (rim.filter((v) => Math.abs(v - disc) <= 25).length / rim.length < 0.8) return false;
  const bright = mid.filter((v) => v >= 170 && v - disc >= 80).length / mid.length;
  return bright >= cfg.glyphMin && bright <= cfg.glyphMax;
}

/** Fill a disc (center cx, cy, radius R, in pixels of `rgba`): a pill of zero length, see fillPill. */
export function fillDisc(rgba, w, h, cx, cy, R) {
  return fillPill(rgba, w, h, cx, cx, cy, R);
}

/**
 * Fill a pill (stadium: the points within R of the segment x1..x2 on row cy, in pixels of `rgba`)
 * from the pixels around it, so the background continues through as if it was never there:
 *  1. a smooth membrane fill: each pixel the average of its neighbours, with the pixels just outside
 *     held fixed (Laplace relaxation, started from a blend of the boundary in 8 directions);
 *  2. the background's own grain on top: the fine detail of a spot just outside, mirrored in.
 * Returns the patch pixels { x0, y0, pw, ph, rgba }: alpha 255 inside (1 px soft edge), 0 outside.
 */
export function fillPill(rgba, w, h, x1, x2, cy, R) {
  const x0 = Math.max(0, Math.floor(x1 - R - 1)); const y0 = Math.max(0, Math.floor(cy - R - 1));
  const xe = Math.min(w, Math.ceil(x2 + R + 2)); const ye = Math.min(h, Math.ceil(cy + R + 2));
  const pw = xe - x0; const ph = ye - y0;
  const near = (x) => Math.min(x2, Math.max(x1, x)); // nearest point of the segment (on row cy)
  const dist2 = (x, y) => { const dx = x - near(x); const dy = y - cy; return dx * dx + dy * dy; };
  const in2 = (R + 1) * (R + 1);
  const inside = (x, y) => dist2(x, y) < in2;
  const clampI = (x, y) => (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 4;
  // Working buffer over the patch area plus a 1 px frame of original pixels (the fixed boundary).
  const bw = pw + 2; const bh = ph + 2;
  const buf = new Float32Array(bw * bh * 3);
  const free = new Uint8Array(bw * bh);
  const B = R + 2; const B2 = B * B;
  const DX = new Float64Array(8); const DY = new Float64Array(8);
  for (let i = 0; i < 8; i++) { DX[i] = Math.cos((Math.PI * i) / 4); DY[i] = Math.sin((Math.PI * i) / 4); }
  const span = 2 * B + (x2 - x1);
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const x = x0 - 1 + i; const y = y0 - 1 + j; const k = (j * bw + i) * 3;
      if (!inside(x, y)) { const o = clampI(x, y); buf[k] = rgba[o]; buf[k + 1] = rgba[o + 1]; buf[k + 2] = rgba[o + 2]; continue; }
      free[j * bw + i] = 1;
      // Start: the boundary in 8 directions, weighted by 1/distance². The grown pill is convex, so
      // along a ray "outside" starts once: binary search for it.
      let sw = 0; let r = 0; let g = 0; let b = 0;
      for (let di = 0; di < 8; di++) {
        const ux = DX[di]; const uy = DY[di];
        let lo = 0; let hi = span;
        for (let it = 0; it < 8; it++) { // to within span/256: under a pixel
          const mid = (lo + hi) / 2; const px = x + mid * ux; const py = y + mid * uy;
          const qx = px < x1 ? x1 : px > x2 ? x2 : px;
          if ((px - qx) * (px - qx) + (py - cy) * (py - cy) < B2) lo = mid; else hi = mid;
        }
        const t = Math.max(1, hi);
        const o = clampI(x + t * ux, y + t * uy);
        const wgt = 1 / (t * t);
        r += rgba[o] * wgt; g += rgba[o + 1] * wgt; b += rgba[o + 2] * wgt; sw += wgt;
      }
      buf[k] = r / sw; buf[k + 1] = g / sw; buf[k + 2] = b / sw;
    }
  }
  // Relax: Gauss-Seidel, a fixed number of sweeps (deterministic).
  for (let it = 0; it < 80; it++) {
    for (let j = 1; j < bh - 1; j++) {
      for (let i = 1; i < bw - 1; i++) {
        if (!free[j * bw + i]) continue;
        const k = (j * bw + i) * 3; const l = k - 3; const rr = k + 3; const u = k - bw * 3; const d = k + bw * 3;
        for (let c = 0; c < 3; c++) buf[k + c] = (buf[l + c] + buf[rr + c] + buf[u + c] + buf[d + c]) / 4;
      }
    }
  }
  // Grain: the fine detail (pixel minus its 3×3 mean, capped so edges never come through) of a spot
  // in a thin band just outside, mirrored across the nearest edge.
  const band = Math.max(3, Math.min(8, Math.round(R / 4)));
  const detail = (x, y, c) => {
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1 || inside(x, y)) return 0;
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += rgba[((y + dy) * w + x + dx) * 4 + c];
    return Math.max(-8, Math.min(8, rgba[(y * w + x) * 4 + c] - s / 9));
  };
  const out = new Uint8ClampedArray(pw * ph * 4);
  for (let y = y0; y < ye; y++) {
    for (let x = x0; x < xe; x++) {
      const qx = near(x); const d = Math.sqrt((x - qx) * (x - qx) + (y - cy) * (y - cy));
      const alpha = Math.max(0, Math.min(1, R + 0.5 - d));
      if (alpha <= 0) continue;
      const k = ((y - y0 + 1) * bw + (x - x0 + 1)) * 3; const o = ((y - y0) * pw + (x - x0)) * 4;
      const ux = d > 0 ? (x - qx) / d : 0; const uy = d > 0 ? (y - cy) / d : 1;
      const out2 = B + ((B - d) % band);
      const mx = Math.round(qx + ux * out2); const my = Math.round(cy + uy * out2);
      for (let c = 0; c < 3; c++) out[o + c] = buf[k + c] + detail(mx, my, c);
      out[o + 3] = Math.round(alpha * 255);
    }
  }
  return { x0, y0, pw, ph, rgba: out };
}

/**
 * Counter pills ("11/13") in an RGBA image (w×h): white text on a flat, dark, see-through pill with
 * round ends. `hMin`/`hMax` are pill heights in pixels. Returns [{ x1, x2, cy, rho }] (the pill is the
 * points within rho of the segment x1..x2 on row cy). Found from the text outwards: the text's line,
 * then the pill around it in four directions, then the whole rounded outline must hold.
 */
export function findPills(rgba, w, h, { hMin, hMax, ...opts }) {
  const cfg = { ...ICON_DEFAULTS, ...opts };
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lum(rgba, i * 4);
  const bright = (i) => L[i] >= 150; // small text is anti-aliased: its strokes don't all reach white
  // Bright blobs (4-connected), then lines of them: the text.
  const seen = new Uint8Array(w * h); const blobs = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !bright(i)) continue;
    let x0 = w; let x1 = 0; let y0 = h; let y1 = 0; let n = 0; const stack = [i]; seen[i] = 1;
    while (stack.length && n < 4000) {
      const j = stack.pop(); const x = j % w; const y = (j - x) / w; n++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) if (k >= 0 && !seen[k] && bright(k)) { seen[k] = 1; stack.push(k); }
    }
    if (n < 4000 && y1 - y0 + 1 <= hMax * 0.7) blobs.push({ x0, x1: x1 + 1, y0, y1: y1 + 1 });
  }
  blobs.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  const lines = [];
  for (const b of blobs) {
    const line = lines.find((l) => Math.min(l.y1, b.y1) - Math.max(l.y0, b.y0) >= 0.5 * Math.min(l.y1 - l.y0, b.y1 - b.y0) && b.x0 - l.x1 <= Math.max(l.y1 - l.y0, b.y1 - b.y0));
    if (line) { line.x1 = Math.max(line.x1, b.x1); line.y0 = Math.min(line.y0, b.y0); line.y1 = Math.max(line.y1, b.y1); } else lines.push({ ...b });
  }
  const out = [];
  for (const t of lines) {
    const th = t.y1 - t.y0;
    if (th < hMin * 0.25 || th > hMax * 0.7) continue;
    // The pill's own color: the median of the gaps between the letters.
    const gaps = [];
    for (let y = t.y0; y < t.y1; y++) for (let x = t.x0; x < t.x1; x++) if (!bright(y * w + x) && L[y * w + x] < 150) gaps.push(L[y * w + x]);
    if (gaps.length < 8) continue;
    gaps.sort((a, b) => a - b);
    const P = gaps[gaps.length >> 1];
    // Walk out from the text until the background starts: 3 pixels in a row clearly lighter than the
    // pill (and not text), so the soft edge of a letter isn't taken for the pill's edge.
    const walk = (x, y, dx, dy, max) => {
      let run = 0;
      for (let k = 1; k <= max; k++) {
        const xx = x + dx * k; const yy = y + dy * k;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) return -1; // ran off the zone: not a closed pill
        const v = L[yy * w + xx];
        run = v - P >= cfg.pillEdge && Math.abs(v - L[(yy - dy) * w + xx - dx]) <= 20 ? run + 1 : 0;
        if (run === 3) return k - 2;
      }
      return -1;
    };
    const cyT = Math.round((t.y0 + t.y1) / 2); const cxT = Math.round((t.x0 + t.x1) / 2);
    const median = (vals) => { const v = vals.filter((k) => k > 0).sort((a, b) => a - b); return v.length >= 2 ? v[v.length >> 1] : -1; };
    const rowsY = [cyT - (th >> 2), cyT, cyT + (th >> 2)]; const colsX = [cxT - (th >> 1), cxT, cxT + (th >> 1)];
    const l = median(rowsY.map((y) => walk(t.x0, y, -1, 0, 3 * th))); const r = median(rowsY.map((y) => walk(t.x1 - 1, y, 1, 0, 3 * th)));
    const u = median(colsX.map((x) => walk(x, t.y0, 0, -1, 2 * th))); const d = median(colsX.map((x) => walk(x, t.y1 - 1, 0, 1, 2 * th)));
    if (l < 0 || r < 0 || u < 0 || d < 0) continue;
    const xL = t.x0 - l + 1; const xR = t.x1 - 1 + r; const yT = t.y0 - u + 1; const yB = t.y1 - 1 + d;
    const H = yB - yT; const rho = H / 2; const cy = (yT + yB) / 2;
    if (H < hMin || H > hMax || H < th * 1.3 || H > th * 4 || xR - xL < H * 1.1) continue;
    const x1 = xL + rho; const x2 = xR - rho;
    if (pillOutline(L, w, h, x1, x2, cy, rho, P, cfg)) out.push({ x1: Math.round(x1 * 10) / 10, x2: Math.round(x2 * 10) / 10, cy: Math.round(cy * 10) / 10, rho: Math.round(rho * 10) / 10 });
  }
  return out;
}

/** The rounded outline holds all the way around: pill-colored just inside, lighter just outside. */
function pillOutline(L, w, h, x1, x2, cy, rho, P, cfg) {
  const pts = [];
  for (let i = 0; i < 24; i++) { const a = Math.PI / 2 + (Math.PI * i) / 23; pts.push([x1, cy, Math.cos(a), Math.sin(a)]); pts.push([x2, cy, -Math.cos(a), Math.sin(a)]); }
  for (let i = 1; i < 12; i++) { const x = x1 + ((x2 - x1) * i) / 12; pts.push([x, cy, 0, -1]); pts.push([x, cy, 0, 1]); }
  let pass = 0; let flat = 0;
  for (const [ox, oy, ux, uy] of pts) {
    const at = (d) => { const x = Math.round(ox + ux * d); const y = Math.round(oy + uy * d); return x < 0 || y < 0 || x >= w || y >= h ? -1 : L[y * w + x]; };
    const a = at(rho - 3); const b = at(rho + 3);
    if (a < 0 || b < 0) return false;
    if (b - a >= cfg.pillEdge) pass++;
    if (Math.abs(a - P) <= cfg.flat) flat++;
  }
  return pass / pts.length >= cfg.ring && flat / pts.length >= cfg.ring;
}

/** The fill margin around an icon of radius r (its soft, anti-aliased edge). */
export const fillRadius = (r, cfg = ICON_DEFAULTS) => r + Math.max(2, Math.round(r * cfg.margin));

// ---------- patches ----------

const toBase64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (b64) => Uint8ClampedArray.from(atob(b64), (c) => c.charCodeAt(0));

/** A patch for the state, from fillDisc output in an image of W×H pixels. */
export function makePatch(fill, W, H) {
  return { x: fill.x0 / W, y: fill.y0 / H, w: fill.pw / W, h: fill.ph / H, pw: fill.pw, ph: fill.ph, data: toBase64(fill.rgba) };
}

export function patchPixels(p) { return fromBase64(p.data); }

/** The image (canvas/bitmap) with `patches` painted on, as a new canvas; the image itself if none. */
export function applyPatches(image, patches) {
  if (!patches?.length) return image;
  const W = image.width; const H = image.height;
  const canvas = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: W, height: H }) : new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  for (const p of patches) {
    const tile = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: p.pw, height: p.ph }) : new OffscreenCanvas(p.pw, p.ph);
    tile.getContext('2d').putImageData(new ImageData(patchPixels(p), p.pw, p.ph), 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tile, p.x * W, p.y * H, p.w * W, p.h * H);
  }
  return canvas;
}

/** Set a renderer's source to `base` with `patches` painted on (remembering the unpatched base). */
export function setPatchedSource(r, base, patches) {
  r.setSource(applyPatches(base, patches), base);
}

/**
 * Find overlay icons in the corners of `box` (the media, in pixels of a W×H frame) and the counter
 * pill in its top-right corner, and fill them in.
 * `sample(x, y, w, h)` returns full-size RGBA pixels of that rectangle. Returns patches.
 */
export function removeIcons(sample, W, H, box, opts = {}) {
  const cfg = { ...ICON_DEFAULTS, ...opts };
  const rMin = Math.max(6, Math.round(W * cfg.rMin)); const rMax = Math.max(rMin, Math.round(W * cfg.rMax));
  const z = Math.min(Math.round(W * cfg.zone), Math.floor(box.height / 2), Math.floor(box.width / 2));
  if (z < rMin * 3) return [];
  const zones = [[box.x, box.y], [box.x + box.width - z, box.y], [box.x, box.y + box.height - z], [box.x + box.width - z, box.y + box.height - z]];
  const patches = [];
  // The carousel counter pill, in the top-right corner.
  const [px0, py0] = zones[1];
  const tr = sample(px0, py0, z, z);
  for (const p of findPills(tr, z, z, { ...cfg, hMin: Math.round(W * cfg.pillMin), hMax: Math.round(W * cfg.pillMax) })) {
    const R = fillRadius(p.rho, cfg);
    const m = Math.ceil(2 * R) + 8;
    const gx = Math.max(0, Math.round(px0 + p.x1) - m); const gy = Math.max(0, Math.round(py0 + p.cy) - m);
    const gw = Math.min(W, Math.round(px0 + p.x2) + m) - gx; const gh = Math.min(H, Math.round(py0 + p.cy) + m) - gy;
    const fill = fillPill(sample(gx, gy, gw, gh), gw, gh, px0 + p.x1 - gx, px0 + p.x2 - gx, py0 + p.cy - gy, R);
    patches.push(makePatch({ ...fill, x0: fill.x0 + gx, y0: fill.y0 + gy }, W, H));
  }
  for (const [zx, zy] of zones) {
    const px = sample(zx, zy, z, z);
    for (const c of findIcons(px, z, z, { ...cfg, rMin, rMax })) {
      const R = fillRadius(c.r, cfg);
      // Fill from the pixels around the icon, sampled with room for the boundary and the mirrored grain.
      const m = Math.ceil(2 * R) + 8;
      const gx = Math.max(0, Math.round(zx + c.cx) - m); const gy = Math.max(0, Math.round(zy + c.cy) - m);
      const gw = Math.min(W, Math.round(zx + c.cx) + m) - gx; const gh = Math.min(H, Math.round(zy + c.cy) + m) - gy;
      const around = sample(gx, gy, gw, gh);
      const fill = fillDisc(around, gw, gh, zx + c.cx - gx, zy + c.cy - gy, R);
      patches.push(makePatch({ ...fill, x0: fill.x0 + gx, y0: fill.y0 + gy }, W, H));
    }
  }
  return patches;
}
