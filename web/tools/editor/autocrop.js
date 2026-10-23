// Auto-Crop: find solid bars of the boundary colors (default navy #022157 and near-black #0B1014; a
// bar may be either) at the top and bottom of a photo, and cut at the clean straight line where each
// bar ends, keeping all of the middle. Each photo gets its own boundaries.
// findBars() is pure (RGBA pixels in, rows out); detectAutoCrop() renders the photo's frame with the
// editor's renderer so rotation, flips and straightening are taken into account.

import { FULL_CROP } from './geometry.js';
import { defaultState } from './state.js';

export const AUTO_CROP_DEFAULTS = Object.freeze({
  colors: ['#022157', '#0B1014'],
  tolerance: 44,   // how far a bar's color may be from a boundary color (compression, color profiles)
  edge: 22,        // color step across the line, per pixel column
  line: 0.4,       // the line runs straight across at least this share of the width
  start: 0.3,      // a bar must begin within the outer 30% of the photo (status bar etc. above it go too)
  region: 0.48,    // ...and its line can't be past 48% (the middle always stays)
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

/** Bar colors from options: `colors` (list) or a single `color`. */
export const barColors = (o) => (o.color ? [o.color] : o.colors?.length ? o.colors : AUTO_CROP_DEFAULTS.colors);

const near = (c, d, tol) => (c[0] - d[0]) ** 2 + (c[1] - d[1]) ** 2 + (c[2] - d[2]) ** 2 <= tol * tol;

/** Per-channel median color of a row (robust to text or a logo on a bar). */
function rowMedian(rgba, w, y) {
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const hist = new Uint32Array(256);
    for (let x = 0, i = y * w * 4 + c; x < w; x++, i += 4) hist[rgba[i]]++;
    for (let v = 0, n = 0; v < 256; v++) { n += hist[v]; if (n * 2 >= w) { out[c] = v; break; } }
  }
  return out;
}

/** Share of a row within `tol` of a color. */
function share(rgba, w, y, [R, G, B], tol) {
  const t2 = tol * tol;
  let n = 0;
  for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
    const dr = rgba[i] - R; const dg = rgba[i + 1] - G; const db = rgba[i + 2] - B;
    if (dr * dr + dg * dg + db * db <= t2) n++;
  }
  return n / w;
}

/** Share of pixel columns whose color steps by more than `edge` from row a to row b. */
function stepShare(rgba, w, a, b, edge) {
  const e2 = edge * edge;
  let n = 0;
  for (let x = 0, i = a * w * 4, j = b * w * 4; x < w; x++, i += 4, j += 4) {
    const dr = rgba[i] - rgba[j]; const dg = rgba[i + 1] - rgba[j + 1]; const db = rgba[i + 2] - rgba[j + 2];
    if (dr * dr + dg * dg + db * db > e2) n++;
  }
  return n / w;
}

/**
 * One side's bar, scanning inward from the edge (`dir` +1 from the top, -1 from the bottom).
 * Returns the first row of the picture on that side (counted from that edge), or null.
 *  1. The bar begins at the first row (within the outer `start` share) whose median color is a
 *     boundary color. Anything outside it (a light status bar) goes too.
 *  2. The cut is the first clean straight line after that: a row where the color steps across most
 *     of the width, with bar color on the outside and something clearly different on the inside.
 *     Text or a logo on the bar doesn't count (the bar continues past it), nor does a thin separator.
 *  3. No line, no crop: dark picture content that fades out or has a ragged edge is left alone.
 */
function scanSide(rgba, w, h, targets, o, dir) {
  const row = (k) => (dir > 0 ? k : h - 1 - k); // k = distance from the edge
  const limit = Math.min(h - 4, Math.floor(h * o.region));
  const med = new Map();
  const median = (k) => { if (!med.has(k)) med.set(k, rowMedian(rgba, w, row(k))); return med.get(k); };
  const isBar = (k) => targets.some((t) => near(median(k), t, o.tolerance));
  let s = -1;
  for (let k = 0; k < Math.floor(h * o.start); k++) if (isBar(k)) { s = k; break; }
  if (s < 0) return null;
  let barRows = 0;
  for (let k = s + 1; k <= limit; k++) {
    if (isBar(k - 1)) barRows++;
    // The step across the line, from the row before it, or over a 1-2 row blurred edge.
    const step = Math.max(stepShare(rgba, w, row(k - 1), row(k), o.edge), stepShare(rgba, w, row(Math.max(s, k - 2)), row(k + 1), o.edge));
    if (step < o.line) continue;
    // Outside the line: bar (most rows since the bar began, and right before it).
    const last = isBar(k - 1) ? k - 1 : isBar(Math.max(s, k - 2)) ? Math.max(s, k - 2) : -1;
    if (barRows < 0.7 * (k - s) || last < 0) continue;
    // Inside: clearly not the bar's color for the next few rows (so not text, a logo or a separator).
    const bar = median(last);
    if ([1, 2, 3].filter((j) => !near(median(k + j), bar, o.edge)).length < 2) continue;
    if (textured(rgba, w, s, k, row)) return null;
    // The exact row, where the eye sees the line: the first row that, in most columns, looks more like
    // the picture just inside than like the bar (a soft edge splits at its middle).
    const inside = row(Math.min(limit + 3, k + 3));
    for (let r = Math.max(s + 1, k - 3); r <= k + 2; r++) if (pictureShare(rgba, w, row(r), bar, inside, o.edge) > 0.5) return r;
    return k;
  }
  return null;
}

/** Of the columns where the bar and the picture differ, the share where row y is closer to the picture. */
function pictureShare(rgba, w, y, [R, G, B], inside, edge) {
  let n = 0; let m = 0;
  for (let x = 0, i = y * w * 4, j = inside * w * 4; x < w; x++, i += 4, j += 4) {
    const toBar = (rgba[i] - R) ** 2 + (rgba[i + 1] - G) ** 2 + (rgba[i + 2] - B) ** 2;
    const toPic = (rgba[i] - rgba[j]) ** 2 + (rgba[i + 1] - rgba[j + 1]) ** 2 + (rgba[i + 2] - rgba[j + 2]) ** 2;
    const apart = (rgba[j] - R) ** 2 + (rgba[j + 1] - G) ** 2 + (rgba[j + 2] - B) ** 2;
    if (apart <= edge * edge) continue;
    m++; if (toPic < toBar) n++;
  }
  return m ? n / m : 0;
}

/** A bar is flat color (maybe with text on it); heavy texture all over means it's picture, not a bar. */
function textured(rgba, w, s, k, row) {
  const flat = [];
  for (let r = s; r < k; r += Math.max(1, Math.floor((k - s) / 12))) flat.push(share(rgba, w, row(r), rowMedian(rgba, w, row(r)), 16));
  flat.sort((a, b) => a - b);
  return flat[Math.floor(flat.length / 2)] < 0.6;
}

/**
 * Find the bars. Returns { top, bottom, foundTop, foundBottom }: keep rows top..bottom-1.
 * Each side is scanned from its edge inward to the first clean line, so all of the middle stays.
 */
export function findBars(rgba, w, h, opts = {}) {
  const o = { ...AUTO_CROP_DEFAULTS, ...opts };
  const targets = barColors(opts.color ? { color: opts.color } : o).map(hexToRgb);
  const t = scanSide(rgba, w, h, targets, o, 1);
  const b = scanSide(rgba, w, h, targets, o, -1);
  return { top: t ?? 0, bottom: b == null ? h : h - b, foundTop: t != null, foundBottom: b != null };
}

/** The crop rectangle (frame coordinates) for bars found in an h-row rendering of the frame. */
export function cropForBars(bars, h, current = FULL_CROP) {
  if (!bars.foundTop && !bars.foundBottom) return null;
  return { x: current.x, w: current.w, y: bars.top / h, h: Math.max(1, bars.bottom - bars.top) / h };
}

/** Words for what Auto-Crop did to one photo. */
export function describeBars(bars, frameH, h) {
  if (!bars.foundTop && !bars.foundBottom) return 'No bars found: left uncropped';
  const k = frameH / h;
  const parts = [];
  if (bars.foundTop) parts.push(`top ${Math.round(bars.top * k)} px`);
  if (bars.foundBottom) parts.push(`bottom ${Math.round((h - bars.bottom) * k)} px`);
  return `Cropped ${parts.join(', ')}`;
}

/**
 * Detect bars on the photo loaded in `renderer` (its source at full or near-full resolution), with the
 * geometry of `state` (rotation, flips, straighten). Returns { crop, bars, note } with crop = null when
 * nothing was found. Renders a narrow, full-height copy: rows keep full precision, width doesn't matter.
 */
export function detectAutoCrop(renderer, state, opts = {}) {
  const frame = { ...defaultState(), rotate: state.rotate, flipH: state.flipH, flipV: state.flipV, straighten: state.straighten, crop: { ...FULL_CROP } };
  const W = state.rotate % 2 ? renderer.srcH : renderer.srcW;
  const H = state.rotate % 2 ? renderer.srcW : renderer.srcH;
  const w = Math.min(W, 480);
  const h = Math.min(H, renderer.maxTexture);
  renderer.render(frame, w, h);
  const bars = findBars(renderer.readPixels(), w, h, opts);
  return { crop: cropForBars(bars, h, state.crop), bars, note: describeBars(bars, H, h) };
}
