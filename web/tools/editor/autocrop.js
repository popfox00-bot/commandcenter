// Auto-Crop: find solid bars of the boundary colors (default navy #022157 and near-black #0B1014; a
// row matches if it is either) in the upper and lower part of a photo and keep only what's between
// them. Each photo gets its own boundaries.
// findBars() is pure (RGBA pixels in, rows out); detectAutoCrop() renders the photo's frame with the
// editor's renderer so rotation, flips and straightening are taken into account.

import { FULL_CROP } from './geometry.js';
import { defaultState } from './state.js';

export const AUTO_CROP_DEFAULTS = Object.freeze({
  colors: ['#022157', '#0B1014'],
  tolerance: 40,   // max RGB distance from the color (JPEG compression shifts colors a little)
  coverage: 0.6,   // share of a row that must be the color to count as bar (logos/text on a bar are OK)
  region: 0.45,    // bars are looked for in the top and bottom 45% of the photo
  edge: 0.3,       // rows next to a bar with this share of the color are its blurred edge
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

/**
 * Find the bars. Returns { top, bottom, foundTop, foundBottom }: keep rows top..bottom-1.
 * Top: the lowest bar row in the upper region (anything above it goes, too). Bottom: the highest bar
 * row in the lower region. Rows next to a bar that are partly the color (blurred edge) go with it.
 */
export function findBars(rgba, w, h, opts = {}) {
  const o = { ...AUTO_CROP_DEFAULTS, ...opts };
  if (opts.color) delete o.colors;
  const cov = rowCoverage(rgba, w, h, barColors(o).map(hexToRgb), o.tolerance);
  const limit = Math.floor(h * o.region);
  let top = 0; let bottom = h; let foundTop = false; let foundBottom = false;
  for (let y = limit - 1; y >= 0; y--) {
    if (cov[y] >= o.coverage) { top = y + 1; foundTop = true; break; }
  }
  if (foundTop) while (top < limit && cov[top] >= o.edge) top++;
  for (let y = h - limit; y < h; y++) {
    if (cov[y] >= o.coverage) { bottom = y; foundBottom = true; break; }
  }
  if (foundBottom) while (bottom > h - limit && cov[bottom - 1] >= o.edge) bottom--;
  return { top, bottom, foundTop, foundBottom };
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
