// Auto-Crop: find solid bars of the boundary colors (default navy #022157 and near-black #0B1014; a
// row matches if it is either) in the upper and lower part of a photo and keep only what's between
// them. Each photo gets its own boundaries.
// findBars() is pure (RGBA pixels in, rows out); detectAutoCrop() renders the photo's frame with the
// editor's renderer so rotation, flips and straightening are taken into account.

import { FULL_CROP } from './geometry.js';
import { defaultState } from './state.js';

export const AUTO_CROP_DEFAULTS = Object.freeze({
  colors: ['#022157', '#0B1014'],
  tolerance: 32,   // how far a bar's measured color may be from a boundary color (compression, screenshots)
  flat: 16,        // a bar row is flat: most pixels within this distance of the row's own color
  band: 18,        // following a bar inward: pixels within this distance of the bar's measured color
  start: 0.25,     // a bar must begin within the outer 25% of the photo (status bar etc. above it go too)
  region: 0.48,    // ...and can't reach past 48% (the middle always stays)
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

/** Mean color of a row's pixels within `tol` of any target, and how many matched. */
function rowMatch(rgba, w, y, targets, tol) {
  const t2 = tol * tol;
  let n = 0; let r = 0; let g = 0; let b = 0;
  for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
    for (const [R, G, B] of targets) {
      const dr = rgba[i] - R; const dg = rgba[i + 1] - G; const db = rgba[i + 2] - B;
      if (dr * dr + dg * dg + db * db <= t2) { n++; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; break; }
    }
  }
  return { share: n / w, color: n ? [r / n, g / n, b / n] : null };
}

/** Share of a row within `tol` of one color. */
function share(rgba, w, y, [R, G, B], tol) {
  const t2 = tol * tol;
  let n = 0;
  for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
    const dr = rgba[i] - R; const dg = rgba[i + 1] - G; const db = rgba[i + 2] - B;
    if (dr * dr + dg * dg + db * db <= t2) n++;
  }
  return n / w;
}

/**
 * One side's bar, scanning inward from the edge (`dir` +1 from the top, -1 from the bottom).
 * Returns the first row of the picture on that side (counted from that edge), or null.
 *  1. The bar starts with a row that is solid (>= 90%), flat (one color, not texture) and close to a
 *     boundary color, within the outer `start` share of the photo. Rows outside it go too.
 *  2. Its color is measured, and rows are followed inward while they are that exact color
 *     (>= 55%, so a logo or text on the bar is fine). A thin separator line between two bar parts
 *     is bridged; anything else ends the bar: that's the clean line.
 *  3. Up to two rows of blurred edge go with it, never more, so the crop can't creep into the picture.
 */
function scanSide(rgba, w, h, targets, o, dir) {
  const row = (k) => (dir > 0 ? k : h - 1 - k); // k = distance from the edge
  const startLimit = Math.floor(h * o.start);
  const limit = Math.floor(h * o.region);
  let k0 = -1; let samples = [];
  for (let k = 0; k < startLimit; k++) {
    const m = rowMatch(rgba, w, row(k), targets, o.tolerance);
    if (m.share >= 0.9 && share(rgba, w, row(k), m.color, o.flat) >= 0.85) { k0 = k; break; }
  }
  if (k0 < 0) return null;
  // Measure the bar's own color over its first few solid rows.
  for (let k = k0; k < Math.min(limit, k0 + 8); k++) {
    const m = rowMatch(rgba, w, row(k), targets, o.tolerance);
    if (m.share < 0.9) break;
    samples.push(m.color);
  }
  const color = [0, 1, 2].map((c) => samples.reduce((sum, s) => sum + s[c], 0) / samples.length);
  const gap = Math.max(2, Math.round(h * 0.004));
  let k = k0;
  while (k < limit) {
    if (share(rgba, w, row(k), color, o.band) >= 0.55) { k++; continue; }
    // A thin line inside the bar (e.g. a 1px separator), then solid bar again: keep going.
    let resume = -1;
    for (let j = 1; j <= gap && k + j < limit; j++) if (share(rgba, w, row(k + j), color, o.band) >= 0.9) { resume = k + j; break; }
    if (resume < 0) break;
    k = resume;
  }
  // Blurred edge (anti-aliasing, compression): at most two rows.
  for (let e = 0; e < 2 && k < limit && share(rgba, w, row(k), color, o.band * 1.6) >= 0.25; e++) k++;
  return k;
}

/**
 * Find the bars. Returns { top, bottom, foundTop, foundBottom }: keep rows top..bottom-1.
 * Each side is scanned from its edge inward, so the outermost clean line is used and all of the
 * middle stays; dark parts of the picture itself don't count (they aren't flat bars starting at the edge).
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
