// Match color: a cutout (a Character, a pasted photo) made to sit in a picture by giving it the light
// and color of what's behind it, or of an area picked by hand. The cutout's colors (in CIE Lab, so
// it looks right) are shifted and scaled toward that area's: its average and spread (Reinhard's color
// transfer), as far as `amount` says (0: as it was, 1: fully matched). Pure: RGBA in, RGBA out.

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const gam = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fi = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

// (sRGB to linear for each of the 256 levels, looked up: the conversion is run millions of times a photo.)
const LIN = Float64Array.from({ length: 256 }, (_, v) => lin(v));
/** sRGB (0–255) → [L, a, b]. */
export function rgbToLab(r, g, b) {
  const L = (v) => ((v & 255) === v ? LIN[v] : lin(v)); // (a whole 0–255 level: looked up; anything else worked out)
  const R = L(r); const G = L(g); const B = L(b);
  const fx = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047); const fy = f(0.2126 * R + 0.7152 * G + 0.0722 * B); const fz = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** [L, a, b] → sRGB (0–255, not clamped). */
export function labToRgb(L, A, B) {
  const fy = (L + 16) / 116; const fx = fy + A / 500; const fz = fy - B / 200;
  const X = fi(fx) * 0.95047; const Y = fi(fy); const Z = fi(fz) * 1.08883;
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z; const G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z; const Bl = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  return [gam(Math.max(0, R)), gam(Math.max(0, G)), gam(Math.max(0, Bl))];
}

/**
 * The average and spread of the colors in `rgba` (w×h) where `use(i)` says (each pixel weighted by its
 * alpha), in Lab: { mean: [L, a, b], sd: [L, a, b], n } or null when there's nothing to go by.
 */
export function colorStats(rgba, w, h, use = () => true, step = 1) {
  const s = [0, 0, 0]; const q = [0, 0, 0]; let n = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = y * w + x; const a = rgba[i * 4 + 3] / 255;
    if (a < 0.5 || !use(i, x, y)) continue;
    const lab = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    for (let c = 0; c < 3; c++) { s[c] += lab[c]; q[c] += lab[c] * lab[c]; }
    n++;
  }
  if (!n) return null;
  const mean = s.map((v) => v / n);
  return { mean, sd: q.map((v, c) => Math.sqrt(Math.max(0, v / n - mean[c] * mean[c]))), n };
}

/**
 * The cutout `rgba` (w×h, alpha kept) with its colors moved toward `target` (from colorStats) by
 * `amount` (0–1). The spread is matched only partly and within bounds (a flat target doesn't flatten
 * the cutout into a smear, a busy one doesn't blow it out), and lightness a little less than color, so
 * it stays itself. `from`: the cutout's own stats (worked out if not given).
 */
export function matchColors(rgba, w, h, target, amount = 0.7, from = null) {
  const out = Uint8ClampedArray.from(rgba);
  const src = from ?? colorStats(rgba, w, h);
  if (!src || !target || amount <= 0) return out;
  const k = Math.min(1, amount);
  const ratio = [0, 1, 2].map((c) => Math.min(1.6, Math.max(0.6, (target.sd[c] + 1) / (src.sd[c] + 1))));
  const weight = [0.85, 1, 1]; // lightness moved a little less than color
  for (let i = 0; i < w * h; i++) {
    if (!rgba[i * 4 + 3]) continue;
    const lab = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    const t = lab.map((v, c) => {
      const moved = target.mean[c] + (v - src.mean[c]) * (1 + (ratio[c] - 1) * 0.6);
      return v + (moved - v) * k * weight[c];
    });
    const [r, g, b] = labToRgb(...t);
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b;
  }
  return out;
}
