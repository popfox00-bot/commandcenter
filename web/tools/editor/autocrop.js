// Auto-Crop: find the post's media in a phone screenshot of a feed (Instagram/Threads style) and crop
// to just that rectangle, dropping the app around it: status bar and banners, the account header,
// carousel dots, the action bar and caption, a floating tab bar, and the next post peeking in.
//
// Deterministic, no ML:
//  1. Analyse a copy about 400 px wide; refine every edge on the full-size pixels (±8 px).
//  2. Estimate the app's chrome color from the screen margins (mode of quantized colors).
//  3. Rows that are mostly chrome color are chrome (flat bars, or text and icons on chrome); the rest
//     are content. Classification is by distance from the chrome color, never by flatness, so a flat
//     gray photo is still content.
//  4. The media is the largest run of content rows (small gaps merged, short runs rejected), then
//     the content columns within it (inset cards).
//  5. Each edge snaps to the strongest color step near it on the full-size image.
//  6. When the media's own background is the chrome color (white photo in light mode), the edges are
//     invisible: fall back to the account header above and the action icons below.
// findMedia() is pure (RGBA pixels in, box out); detectAutoCrop() runs it on the editor's renderer so
// rotation, flips and straightening are taken into account.

import { FULL_CROP } from './geometry.js';
import { defaultState } from './state.js';

/** Every tunable threshold, in one place. Shares are of the image's width or height unless noted. */
export const AUTO_CROP_DEFAULTS = Object.freeze({
  colors: ['#022157', '#0B1014'], // hint colors: they count as chrome too when they're in the margins
  analysisWidth: 400,     // detection runs on a copy this wide (px); edges are refined at full size
  refine: 8,              // full-size px searched on each side of a coarse edge when snapping
  marginTop: 0.04,        // chrome color is sampled from the top 4% of rows...
  marginBottom: 0.08,     // ...the bottom 8%...
  marginSide: 0.02,       // ...and the left/right 2% of columns
  quant: 16,              // color bin size (per channel) for the mode of the margin colors
  chromeMinShare: 0.15,   // the chrome color must fill at least 15% of the top or the bottom margin
  paletteNear: 48,        // other margin colors this close to the chrome color are chrome too (shading)...
  paletteShare: 0.08,     // ...when they fill at least 8% of the top+bottom margins
  hintShare: 0.05,        // a hint color is chrome when it fills at least 5% of the top+bottom margins
  chromeDistMin: 10,      // a pixel is chrome color within this distance (RGB), plus 3× the margin noise...
  chromeDistMax: 32,      // ...up to this (lossy screenshots)
  chromeRow: 0.5,         // a row is chrome when at least half its pixels are chrome color (text/icons are sparse)
  dominantDelta: 12,      // row statistic: share of pixels within this distance of the row's dominant color
  mergeGap: 0.01,         // content runs separated by less than 1% of the height merge (thin lines in media)
  minRun: 0.15,           // runs shorter than 15% of the height are not media (banners, buttons)
  colChrome: 0.5,         // within the media band, a column is chrome when half its pixels are
  edgeMin: 12,            // color step (RGB distance) that counts as an edge when scoring straightness
  sure: 0.6,              // below this confidence the crop is offered for checking, not applied
  uiInkMin: 0.003,        // UI rows (text and icons on chrome) have more than 0.3% non-chrome pixels...
  uiInkMax: 0.5,          // ...and at most half
  blankGap: 0.03,         // empty chrome gaps this tall both above and below a doubtful box mean the media's
                          // background matches the chrome: the header/action anchors are used instead
  anchorConfidence: 0.55, // confidence of the header/action fallback (its edges can't be seen, so: check it)
  tabZone: 0.82,          // a floating tab bar is only looked for below 82% of the height
});

export function hexToRgb(hex) {
  const h = String(hex).replace('#', '').trim();
  const f = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(f)) throw new Error(`Not a color: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
}

/** Share of pixels in each row within `tolerance` of any of the colors (list of [r,g,b]). */
export function rowCoverage(rgba, w, h, rgbs, tolerance) {
  const out = new Float32Array(h);
  const t2 = tolerance * tolerance;
  const list = Array.isArray(rgbs[0]) ? rgbs : [rgbs];
  for (let y = 0; y < h; y++) {
    let hit = 0;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      for (const [R, G, B] of list) {
        const dr = rgba[i] - R; const dg = rgba[i + 1] - G; const db = rgba[i + 2] - B;
        if (dr * dr + dg * dg + db * db <= t2) { hit++; break; }
      }
    }
    out[y] = hit / w;
  }
  return out;
}

/** Hint colors from options: `colors` (list) or a single `color`. */
export const barColors = (o) => (o.color ? [o.color] : o.colors?.length ? o.colors : AUTO_CROP_DEFAULTS.colors);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- 1. analysis copy ----------

/** Area-average downscale to `aw` px wide (or the image itself when it's narrower). */
export function downscale(rgba, w, h, aw) {
  if (w <= aw) return { px: rgba, w, h };
  const ah = Math.max(1, Math.round((h * aw) / w));
  const xs = new Int32Array(aw + 1); const ys = new Int32Array(ah + 1);
  for (let i = 0; i <= aw; i++) xs[i] = Math.floor((i * w) / aw);
  for (let i = 0; i <= ah; i++) ys[i] = Math.floor((i * h) / ah);
  const out = new Uint8ClampedArray(aw * ah * 4);
  const acc = new Float64Array(aw * 3);
  for (let Y = 0; Y < ah; Y++) {
    acc.fill(0);
    for (let y = ys[Y]; y < ys[Y + 1]; y++) {
      let i = y * w * 4;
      for (let X = 0; X < aw; X++) {
        let r = 0; let g = 0; let b = 0;
        for (let x = xs[X]; x < xs[X + 1]; x++, i += 4) { r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; }
        acc[X * 3] += r; acc[X * 3 + 1] += g; acc[X * 3 + 2] += b;
      }
    }
    const ny = ys[Y + 1] - ys[Y];
    for (let X = 0, o = Y * aw * 4; X < aw; X++, o += 4) {
      const n = ny * (xs[X + 1] - xs[X]);
      out[o] = Math.round(acc[X * 3] / n); out[o + 1] = Math.round(acc[X * 3 + 1] / n); out[o + 2] = Math.round(acc[X * 3 + 2] / n); out[o + 3] = 255;
    }
  }
  return { px: out, w: aw, h: ah };
}

// ---------- 2. chrome color ----------

/**
 * The app's chrome color(s), from the margins: the mode of quantized colors in the top 4%, bottom 8%
 * and side 2%, as long as it fills at least `chromeMinShare` of the top or bottom margin. Returns
 * { palette: [[r,g,b]...], dist } (dist: how close a pixel must be to count as chrome), or null.
 */
export function estimateChrome(A, cfg = AUTO_CROP_DEFAULTS, hints = []) {
  const { px, w, h } = A;
  const q = cfg.quant;
  const top = Math.max(1, Math.round(h * cfg.marginTop));
  const bot = Math.max(1, Math.round(h * cfg.marginBottom));
  const side = Math.max(1, Math.round(w * cfg.marginSide));
  const bins = new Map();
  const add = (i, region) => {
    const r = px[i]; const g = px[i + 1]; const b = px[i + 2];
    const key = (Math.floor(r / q) * 4096) + (Math.floor(g / q) * 64) + Math.floor(b / q);
    let s = bins.get(key);
    if (!s) { s = { key, n: 0, t: 0, b: 0, r: 0, g: 0, bl: 0, rr: 0, gg: 0, bb: 0 }; bins.set(key, s); }
    s.n++; if (region === 1) s.t++; else if (region === 2) s.b++;
    s.r += r; s.g += g; s.bl += b; s.rr += r * r; s.gg += g * g; s.bb += b * b;
  };
  for (let y = 0; y < top; y++) for (let x = 0; x < w; x++) add((y * w + x) * 4, 1);
  for (let y = h - bot; y < h; y++) for (let x = 0; x < w; x++) add((y * w + x) * 4, 2);
  for (let y = top; y < h - bot; y++) for (let x = 0; x < side; x++) { add((y * w + x) * 4, 3); add((y * w + (w - 1 - x)) * 4, 3); }
  const nT = top * w; const nB = bot * w;
  // Most frequent first; ties broken by the bin key so the result never depends on iteration order.
  const ranked = [...bins.values()].sort((a, b) => b.n - a.n || a.key - b.key);
  const primary = ranked.find((s) => s.t / nT >= cfg.chromeMinShare || s.b / nB >= cfg.chromeMinShare);
  if (!primary) return null;
  const mean = (s) => [s.r / s.n, s.g / s.n, s.bl / s.n];
  const c = mean(primary);
  const noise = Math.sqrt(Math.max(0, primary.rr / primary.n - c[0] ** 2) + Math.max(0, primary.gg / primary.n - c[1] ** 2) + Math.max(0, primary.bb / primary.n - c[2] ** 2));
  const dist = clamp(Math.round(cfg.chromeDistMin + 3 * noise), cfg.chromeDistMin, cfg.chromeDistMax);
  const palette = [c];
  const near = (a, b2, d) => (a[0] - b2[0]) ** 2 + (a[1] - b2[1]) ** 2 + (a[2] - b2[2]) ** 2 <= d * d;
  for (const s of ranked) {
    if (s === primary || (s.t + s.b) / (nT + nB) < cfg.paletteShare) continue;
    const m = mean(s);
    if (near(m, c, cfg.paletteNear)) palette.push(m);
  }
  for (const hex of hints) {
    const rgb = hexToRgb(hex);
    if (palette.some((p) => near(p, rgb, dist))) continue;
    let n = 0;
    for (const s of ranked) if (near(mean(s), rgb, dist)) n += s.t + s.b;
    if (n / (nT + nB) >= cfg.hintShare) palette.push(rgb);
  }
  return { palette, dist };
}

/** 1 for each pixel of the analysis copy that is chrome color, computed once. */
export function chromeMask(A, chrome) {
  const { px, w, h } = A;
  const mask = new Uint8Array(w * h);
  const pal = Float64Array.from(chrome.palette.flat());
  const d2 = chrome.dist * chrome.dist;
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const r = px[i]; const g = px[i + 1]; const b = px[i + 2];
    for (let k = 0; k < pal.length; k += 3) {
      const dr = r - pal[k]; const dg = g - pal[k + 1]; const db = b - pal[k + 2];
      if (dr * dr + dg * dg + db * db <= d2) { mask[p] = 1; break; }
    }
  }
  return mask;
}

// ---------- 3. rows ----------

/**
 * Per-row statistics across the full width: mean color, variance (sum over channels), the share of
 * pixels within `dominantDelta` of the row's dominant (median) color, and the share that is chrome.
 */
export function rowStats(A, mask, cfg = AUTO_CROP_DEFAULTS) {
  const { px, w, h } = A;
  const mean = new Float32Array(h * 3); const variance = new Float32Array(h);
  const dominant = new Float32Array(h); const chromeShare = new Float32Array(h);
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const d2 = cfg.dominantDelta * cfg.dominantDelta;
  for (let y = 0; y < h; y++) {
    let r = 0; let g = 0; let b = 0; let rr = 0; let gg = 0; let bb = 0; let ch = 0;
    for (const hc of hist) hc.fill(0);
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
      r += px[i]; g += px[i + 1]; b += px[i + 2];
      rr += px[i] * px[i]; gg += px[i + 1] * px[i + 1]; bb += px[i + 2] * px[i + 2];
      hist[0][px[i]]++; hist[1][px[i + 1]]++; hist[2][px[i + 2]]++;
    }
    mean[y * 3] = r / w; mean[y * 3 + 1] = g / w; mean[y * 3 + 2] = b / w;
    variance[y] = (rr / w - (r / w) ** 2) + (gg / w - (g / w) ** 2) + (bb / w - (b / w) ** 2);
    const dom = hist.map((hc) => { for (let v = 0, n = 0; v < 256; v++) { n += hc[v]; if (n * 2 >= w) return v; } return 255; });
    let near = 0;
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4) if ((px[i] - dom[0]) ** 2 + (px[i + 1] - dom[1]) ** 2 + (px[i + 2] - dom[2]) ** 2 <= d2) near++;
    dominant[y] = near / w;
    if (mask) for (let x = 0, p = y * w; x < w; x++, p++) ch += mask[p];
    chromeShare[y] = ch / w;
  }
  return { mean, variance, dominant, chromeShare };
}

/** 1 = content row, 0 = chrome row: by distance from the chrome color, not by flatness. */
export function classifyRows(stats, cfg = AUTO_CROP_DEFAULTS) {
  return Uint8Array.from(stats.chromeShare, (s) => (s < cfg.chromeRow ? 1 : 0));
}

/**
 * Runs of 1s in `flags`, merging runs separated by fewer than `gap` 0s, keeping runs of at least
 * `minLen`. Longest first (ties: the earlier one). Each run: { start, end } with end exclusive.
 */
export function contentRuns(flags, gap, minLen) {
  const raw = [];
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    let j = i;
    while (j < flags.length && flags[j]) j++;
    raw.push({ start: i, end: j });
    i = j;
  }
  const merged = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < gap) last.end = r.end;
    else merged.push({ ...r });
  }
  return merged.filter((r) => r.end - r.start >= minLen).sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
}

// ---------- 4. the media band, a floating tab bar, the columns ----------

/** Median color of row y over columns [x0, x1). */
function medianColor(px, w, y, x0, x1) {
  const n = x1 - x0;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const hc = new Uint32Array(256);
    for (let x = x0, i = (y * w + x0) * 4 + c; x < x1; x++, i += 4) hc[px[i]]++;
    for (let v = 0, k = 0; v < 256; v++) { k += hc[v]; if (k * 2 >= n) { out[c] = v; break; } }
  }
  return out;
}

function shareNear(px, w, y, x0, x1, c, d) {
  let n = 0;
  for (let x = x0, i = (y * w + x0) * 4; x < x1; x++, i += 4) if ((px[i] - c[0]) ** 2 + (px[i + 1] - c[1]) ** 2 + (px[i + 2] - c[2]) ** 2 <= d * d) n++;
  return n / Math.max(1, x1 - x0);
}

/**
 * A floating tab bar over the bottom of the media: a band of rows whose middle is one (blurred,
 * translucent) color with a few icons, that stops short of both screen edges. The media ends above it.
 */
function trimFloatingBar(A, run, cfg) {
  const { px, w, h } = A;
  if (run.end < h * 0.9) return run;
  const edge = Math.max(1, Math.ceil(w * 0.03));
  const pill = (y) => {
    const c = medianColor(px, w, y, Math.floor(w * 0.25), Math.ceil(w * 0.75));
    return shareNear(px, w, y, Math.floor(w * 0.2), Math.ceil(w * 0.8), c, 20) >= 0.6
      && shareNear(px, w, y, 0, edge, c, 20) < 0.3 && shareNear(px, w, y, w - edge, w, c, 20) < 0.3;
  };
  const span = Math.max(2, Math.ceil(h * 0.015));
  for (let y = Math.max(run.start, Math.floor(h * cfg.tabZone)); y < run.end; y++) {
    if (!pill(y)) continue;
    let n = 0;
    for (let k = 0; k < span && y + k < h; k++) if (pill(y + k)) n++;
    if (n / span >= 0.7 && y - run.start >= h * cfg.minRun) return { start: run.start, end: y };
  }
  return run;
}

/** Content columns within the band: { start, end } (full width when the media is full-bleed). */
function contentColumns(A, mask, run, cfg) {
  const { w } = A;
  const rows = run.end - run.start;
  const flags = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    let ch = 0;
    for (let y = run.start, p = run.start * w + x; y < run.end; y++, p += w) ch += mask[p];
    flags[x] = ch / rows < cfg.colChrome ? 1 : 0;
  }
  const best = contentRuns(flags, Math.max(1, w * cfg.mergeGap), Math.max(1, w * cfg.minRun))[0];
  return best ?? { start: 0, end: w };
}

// ---------- 5. edges at full size ----------

/**
 * Snap a horizontal edge (between rows y-1 and y) near `coarse` to the strongest row-to-row color
 * step within ±refine px, over columns [x0, x1). Returns { at, straight }: `straight` is the share of
 * columns that step by more than `edgeMin` across it (1 = a clean line across the whole media).
 */
function snapRows(sample, W, H, x0, x1, coarse, cfg) {
  if (coarse <= 0 || coarse >= H) return { at: clamp(coarse, 0, H), straight: null };
  const R = cfg.refine;
  const lo = clamp(coarse - R, 1, H - 1); const hi = clamp(coarse + R, 1, H - 1);
  const r0 = Math.max(0, lo - 4); const r1 = Math.min(H, hi + 4);
  const n = x1 - x0;
  const px = sample(x0, r0, n, r1 - r0);
  const at = (y, x) => ((y - r0) * n + x) * 4;
  let best = lo; let bestG = -1;
  for (let y = lo; y <= hi; y++) {
    let g = 0;
    for (let x = 0; x < n; x++) { const a = at(y, x); const b = at(y - 1, x); g += Math.abs(px[a] - px[b]) + Math.abs(px[a + 1] - px[b + 1]) + Math.abs(px[a + 2] - px[b + 2]); }
    if (g > bestG) { bestG = g; best = y; }
  }
  return { at: best, straight: straightness(px, n, r1 - r0, best - r0, cfg.edgeMin, true) };
}

/** Same for a vertical edge (between columns x-1 and x), over rows [y0, y1). */
function snapCols(sample, W, H, y0, y1, coarse, cfg) {
  if (coarse <= 0 || coarse >= W) return { at: clamp(coarse, 0, W), straight: null };
  const R = cfg.refine;
  const lo = clamp(coarse - R, 1, W - 1); const hi = clamp(coarse + R, 1, W - 1);
  const c0 = Math.max(0, lo - 4); const c1 = Math.min(W, hi + 4);
  const n = c1 - c0; const rows = y1 - y0;
  const px = sample(c0, y0, n, rows);
  const step = Math.max(1, Math.floor(rows / 400));
  let best = lo; let bestG = -1;
  for (let x = lo; x <= hi; x++) {
    let g = 0;
    for (let y = 0; y < rows; y += step) { const a = (y * n + x - c0) * 4; const b = a - 4; g += Math.abs(px[a] - px[b]) + Math.abs(px[a + 1] - px[b + 1]) + Math.abs(px[a + 2] - px[b + 2]); }
    if (g > bestG) { bestG = g; best = x; }
  }
  return { at: best, straight: straightness(px, n, rows, best - c0, cfg.edgeMin, false) };
}

/** Share of lines across the edge at `k` where the color 3 px before differs from 2 px after by > edgeMin. */
function straightness(px, n, rows, k, edgeMin, horizontal) {
  const len = horizontal ? n : rows; const span = horizontal ? rows : n;
  const before = clamp(k - 3, 0, span - 1); const after = clamp(k + 2, 0, span - 1);
  if (before === after) return 0;
  let hit = 0;
  for (let t = 0; t < len; t++) {
    const a = (horizontal ? before * n + t : t * n + before) * 4;
    const b = (horizontal ? after * n + t : t * n + after) * 4;
    if ((px[a] - px[b]) ** 2 + (px[a + 1] - px[b + 1]) ** 2 + (px[a + 2] - px[b + 2]) ** 2 > edgeMin * edgeMin) hit++;
  }
  return hit / len;
}

// ---------- 6. header / action-bar anchors ----------

/**
 * UI bands: runs of rows with sparse non-chrome "ink" (text, icons, avatars on chrome). Each band's
 * ink is split into blobs (separated by > 0.5% of the width). A header has a round avatar at the left
 * followed by text; an action bar has three or more icon-sized, roughly square blobs starting at the left.
 */
export function findAnchors(A, mask, stats, cfg = AUTO_CROP_DEFAULTS) {
  const { w, h } = A;
  const ui = (y) => { const ink = 1 - stats.chromeShare[y]; return ink > cfg.uiInkMin && ink <= cfg.uiInkMax; };
  const bands = [];
  for (let y = 0; y < h; y++) {
    if (!ui(y)) continue;
    let e = y + 1;
    while (e < h && (ui(e) || (e + 1 < h && ui(e + 1)))) e++;
    bands.push({ top: y, bottom: e });
    y = e;
  }
  const gap = Math.max(2, Math.round(w * 0.005));
  const out = [];
  for (const band of bands) {
    const lo = new Int32Array(w).fill(-1); const hi = new Int32Array(w).fill(-1); const cnt = new Int32Array(w);
    for (let y = band.top; y < band.bottom; y++) {
      for (let x = 0, p = y * w; x < w; x++, p++) {
        if (mask[p]) continue;
        if (lo[x] < 0) lo[x] = y;
        hi[x] = y; cnt[x]++;
      }
    }
    const blobs = [];
    for (let x = 0; x < w; x++) {
      if (lo[x] < 0) continue;
      const last = blobs[blobs.length - 1];
      if (last && x - last.x1 <= gap) { last.x1 = x + 1; last.y0 = Math.min(last.y0, lo[x]); last.y1 = Math.max(last.y1, hi[x] + 1); last.ink += cnt[x]; } else blobs.push({ x0: x, x1: x + 1, y0: lo[x], y1: hi[x] + 1, ink: cnt[x] });
    }
    if (!blobs.length) continue;
    const bw = (b) => b.x1 - b.x0; const bh = (b) => b.y1 - b.y0;
    // Action bar first: three or more icon-sized, roughly square blobs of similar size, from the left.
    const icons = blobs.filter((b) => bh(b) >= h * 0.01 && bw(b) / bh(b) >= 0.6 && bw(b) / bh(b) <= 1.6);
    if (icons.length >= 3 && icons[0].x0 <= w * 0.12) {
      const sizes = icons.map(bh).sort((p, q) => p - q);
      const med = sizes[Math.floor(sizes.length / 2)];
      const similar = icons.filter((b) => Math.abs(bh(b) - med) <= med * 0.4);
      if (similar.length >= 3) { out.push({ type: 'action', top: Math.min(...similar.map((b) => b.y0)), bottom: Math.max(...similar.map((b) => b.y1)), size: med }); continue; }
    }
    // Header: a round avatar at the left (a circle fills ~79% of its box), then the name.
    const a = blobs[0];
    const fill = a.ink / (bw(a) * bh(a));
    const round = a.x0 <= w * 0.12 && bh(a) >= h * 0.012 && bw(a) / bh(a) >= 0.7 && bw(a) / bh(a) <= 1.4 && fill >= 0.45 && fill <= 0.9;
    if (round && blobs.length >= 2 && blobs[1].x0 - a.x1 <= w * 0.2) out.push({ type: 'header', top: a.y0, bottom: a.y1, size: bh(a) });
  }
  // The first header that has an action bar below it, far enough apart to hold the media.
  for (const hd of out.filter((b) => b.type === 'header')) {
    const act = out.find((b) => b.type === 'action' && b.top - hd.bottom >= h * cfg.minRun);
    if (act) return { header: hd, action: act };
  }
  return null;
}

/** Rows of chrome with no ink directly above `y` (dir -1) or from `y` down (dir +1). */
function blankRun(stats, y, dir, cfg) {
  let n = 0;
  for (let k = dir < 0 ? y - 1 : y; k >= 0 && k < stats.chromeShare.length; k += dir) {
    if (1 - stats.chromeShare[k] > cfg.uiInkMin) break;
    n++;
  }
  return n;
}

// ---------- the detector ----------

const NONE = (W, H) => ({ x: 0, y: 0, width: W, height: H, confidence: 0, method: 'none' });

/**
 * Find the media box. `A` is the analysis copy ({ px, w, h }, about 400 px wide) of a W×H image;
 * `sample(x, y, w, h)` returns full-size RGBA pixels of that rectangle (for edge refinement).
 * Returns { x, y, width, height, confidence (0-1), method: 'chrome-contrast' | 'ui-anchor-fallback' | 'none' }.
 */
export function detectMedia(A, sample, W, H, opts = {}) {
  const cfg = { ...AUTO_CROP_DEFAULTS, ...opts };
  const chrome = estimateChrome(A, cfg, opts.color || opts.colors ? barColors(opts) : cfg.colors);
  if (!chrome) return NONE(W, H);
  const mask = chromeMask(A, chrome);
  const stats = rowStats(A, mask, cfg);
  const sx = W / A.w; const sy = H / A.h;
  const candidates = [];

  // Strategy 1: chrome contrast.
  let run = contentRuns(classifyRows(stats, cfg), Math.max(1, A.h * cfg.mergeGap), Math.max(1, A.h * cfg.minRun))[0];
  const anchors = findAnchors(A, mask, stats, cfg);
  if (run) {
    run = trimFloatingBar(A, run, cfg);
    const cols = contentColumns(A, mask, run, cfg);
    const inset = cols.start > 0 || cols.end < A.w;
    const x0 = Math.round(cols.start * sx); const x1 = Math.round(cols.end * sx);
    const top = snapRows(sample, W, H, x0, x1, Math.round(run.start * sy), cfg);
    const bottom = snapRows(sample, W, H, x0, x1, Math.round(run.end * sy), cfg);
    let left = { at: x0, straight: null }; let right = { at: x1, straight: null };
    if (inset) { left = snapCols(sample, W, H, top.at, bottom.at, x0, cfg); right = snapCols(sample, W, H, top.at, bottom.at, x1, cfg); }
    const edgeScore = (e) => (e.straight == null ? 0.6 : clamp((e.straight - 0.35) / 0.5, 0, 1));
    const edges = [top, bottom, ...(inset ? [left, right] : [])].map(edgeScore);
    const k = Math.max(1, Math.round(A.h * 0.01));
    const sep = (from, to) => { if (from < 0 || to > A.h || from >= to) return 1; let s = 0; for (let y = from; y < to; y++) s += stats.chromeShare[y]; return s / (to - from); };
    const separation = (sep(run.start - k, run.start) + sep(run.end, run.end + k)) / 2;
    let purity = 0;
    for (let y = run.start; y < run.end; y++) purity += stats.chromeShare[y] < cfg.chromeRow ? 1 : 0;
    purity /= run.end - run.start;
    let confidence = 0.6 * (edges.reduce((s, e) => s + e, 0) / edges.length) + 0.25 * separation + 0.15 * purity;
    // A box with edges that aren't clean full-width lines (or an inset one) and a wide empty chrome gap
    // between it and the header or the action bar: the media's own background is chrome-colored and
    // only an object inside it was found. (A real post's media or card sits right under its header.)
    if (anchors && (inset || !edges.every((e) => e >= 0.9)) && blankRun(stats, run.start, -1, cfg) >= A.h * cfg.blankGap && blankRun(stats, run.end, 1, cfg) >= A.h * cfg.blankGap) confidence *= 0.5;
    // App chrome always ends at a visible line; a box whose every edge is a gradual fade is just a
    // photo with a smooth sky or backdrop, not a screenshot.
    const seen = [top, bottom, ...(inset ? [left, right] : [])].filter((e) => e.straight != null);
    const noLine = seen.length > 0 && seen.every((e) => edgeScore(e) < 0.2);
    if (!noLine && bottom.at - top.at > 0 && right.at - left.at > 0) {
      candidates.push({ x: left.at, y: top.at, width: right.at - left.at, height: bottom.at - top.at, confidence, method: 'chrome-contrast' });
    }
  }

  // Strategy 2: between the account header and the action icons.
  if (anchors) {
    const y0 = Math.round((anchors.header.bottom + Math.round(anchors.header.size * 0.3)) * sy);
    const y1 = Math.round((anchors.action.top - Math.round(anchors.action.size * 0.3)) * sy);
    if (y1 > y0) candidates.push({ x: 0, y: y0, width: W, height: y1 - y0, confidence: cfg.anchorConfidence, method: 'ui-anchor-fallback' });
  }

  if (!candidates.length) return NONE(W, H);
  const best = candidates.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  return { ...best, confidence: Math.round(clamp(best.confidence, 0, 1) * 1000) / 1000 };
}

/** findMedia on plain RGBA pixels (w×h, top row first): downscales, then refines on these pixels. */
export function findMedia(rgba, w, h, opts = {}) {
  const cfg = { ...AUTO_CROP_DEFAULTS, ...opts };
  const A = downscale(rgba, w, h, cfg.analysisWidth);
  const sample = (x, y, sw, sh) => {
    const out = new Uint8ClampedArray(sw * sh * 4);
    for (let r = 0; r < sh; r++) out.set(rgba.subarray(((y + r) * w + x) * 4, ((y + r) * w + x + sw) * 4), r * sw * 4);
    return out;
  };
  return detectMedia(A, sample, w, h, opts);
}

/**
 * Compatibility: the media's rows as { top, bottom, foundTop, foundBottom } (keep rows top..bottom-1),
 * plus the full box fields.
 */
export function findBars(rgba, w, h, opts = {}) {
  const m = findMedia(rgba, w, h, opts);
  const found = m.method !== 'none';
  return { top: m.y, bottom: m.y + m.height, foundTop: found && m.y > 0, foundBottom: found && m.y + m.height < h, ...m };
}

/** The crop rectangle (frame coordinates) for bars found in an h-row rendering of the frame. */
export function cropForBars(bars, h, current = FULL_CROP) {
  if (!bars.foundTop && !bars.foundBottom) return null;
  return { x: current.x, w: current.w, y: bars.top / h, h: Math.max(1, bars.bottom - bars.top) / h };
}

/** Words for what Auto-Crop did to one photo (W×H frame). */
export function describeBars(m, W, H) {
  if (!m || m.method === 'none') return 'No app screen found: left uncropped';
  const pct = `${Math.round(m.confidence * 100)}% sure`;
  const sides = [];
  if (m.y > 0) sides.push(`top ${m.y} px`);
  if (H - m.y - m.height > 0) sides.push(`bottom ${H - m.y - m.height} px`);
  if (m.x > 0 || W - m.x - m.width > 0) sides.push(`sides ${m.x} / ${W - m.x - m.width} px`);
  if (m.confidence < AUTO_CROP_DEFAULTS.sure) return `Not sure where the post is (${pct}): check the crop`;
  return `Cropped to the post: ${sides.join(', ')} (${pct})`;
}

/**
 * Detect the media on the photo loaded in `renderer`, with the geometry of `state` (rotation, flips,
 * straighten). The analysis copy is rendered small; edges are refined on full-size strips rendered
 * just around them. Returns { crop, box, confidence, method, sure, note, bars }: crop (frame
 * coordinates) is null when nothing was found; `sure` is false when it should be checked by hand.
 */
export function detectAutoCrop(renderer, state, opts = {}) {
  const cfg = { ...AUTO_CROP_DEFAULTS, ...opts };
  const frame = { ...defaultState(), rotate: state.rotate, flipH: state.flipH, flipV: state.flipV, straighten: state.straighten, crop: { ...FULL_CROP } };
  const W = state.rotate % 2 ? renderer.srcH : renderer.srcW;
  const H = state.rotate % 2 ? renderer.srcW : renderer.srcH;
  const aw = Math.min(W, cfg.analysisWidth);
  const ah = Math.max(1, Math.round((H * aw) / W));
  renderer.render(frame, aw, ah);
  const A = { px: renderer.readPixels(), w: aw, h: ah };
  const sample = (x, y, w, h) => {
    renderer.render({ ...frame, crop: { x: x / W, y: y / H, w: w / W, h: h / H } }, w, h);
    return renderer.readPixels();
  };
  const box = detectMedia(A, sample, W, H, opts);
  const found = box.method !== 'none' && (box.width < W || box.height < H);
  const crop = found ? { x: box.x / W, y: box.y / H, w: box.width / W, h: box.height / H } : null;
  const bars = { top: box.y, bottom: box.y + box.height, foundTop: found && box.y > 0, foundBottom: found && box.y + box.height < H };
  return { crop, box, confidence: box.confidence, method: box.method, sure: found && box.confidence >= cfg.sure, note: found ? describeBars(box, W, H) : describeBars(null), bars };
}
