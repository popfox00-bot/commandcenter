// Auto-Enhance: slight but meaningful adjustments, worked out for each photo from its own pixels.
// It measures the photo (brightness percentiles, clipping, haze, color cast, saturation, fine detail)
// and solves for settings with an exact copy of the renderer's color math (simulate), so every value
// is checked against what it will actually do: e.g. exposure is solved so the photo's middle tone
// lands part of the way to a pleasant brightness, without clipping more highlights than before.
// Everything is capped small: the photo keeps its own character (a night shot stays a night shot).

/** Tunable targets and caps, in one place. Brightness values are 0..1 (display gamma). */
export const ENHANCE = Object.freeze({
  midTarget: 0.47,     // a darker photo's middle tone is lifted toward this...
  midPull: 0.5,        // ...half of the way (a bright photo is never darkened for it)
  maxExposure: 0.5,    // ±0.5 is about ±¾ of a stop
  clipSlack: 0.004,    // exposure may newly clip at most this much of the photo
  blown: 0.03,         // only when this much of a photo is blown out is its exposure brought down a little
  backdrop: 0.4,       // a photo with this much of one even tone (a studio backdrop, a wall) isn't hazy
  hiStart: 0.93,       // highlights above this brightness...
  hiShare: 0.02,       // ...covering at least 2% of the photo get recovered (highlights down)
  loEnd: 0.08,         // shadows below this brightness...
  loShare: 0.06,       // ...covering at least 6% of the photo get lifted
  hazeFloor: 0.08,     // a darkest 1% brighter than this (as shot) is haze: the black point goes back to ~0.03
  spreadTarget: 0.72,  // the 5–95% brightness spread aimed for (contrast), only when flatter than...
  spreadFlat: 0.64,    // ...this
  castMin: 0.025,      // a color cast in the gray areas smaller than this is left alone...
  castFix: 0.45,       // ...a bigger one is corrected by 45% (keep a golden hour golden)
  vibranceLow: 0.3,    // vibrance for a muted photo, down to...
  vibranceHigh: 0.06,  // ...this for an already colorful one
  sharpness: 0.12,     // a little sharpening for every photo...
  sharpnessSoft: 0.2,  // ...more for a soft one
  definition: 0.07,    // local contrast, more (0.14) for a flat-looking one
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = (v) => Math.round(clamp(v, -1, 1) * 100) / 100 + 0; // +0: no -0
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * One color (r, g, b in 0..1) through the renderer's color pass with adjustments `a` (no filter):
 * the same math as the shader in renderer.js, in the same order.
 */
export function simulate(r, g, b, a) {
  const e = 2 ** ((a.exposure ?? 0) * 1.5);
  let c = [r, g, b].map((v) => Math.max(v, 0) ** 2.2 * e).map((v) => Math.max(v, 0) ** (1 / 2.2));
  const brilliance = a.brilliance ?? 0;
  const sh = (a.shadows ?? 0) + brilliance * 0.6; const hi = (a.highlights ?? 0) - brilliance * 0.45;
  const tone = (amount, weight) => { c = c.map((v) => v + amount * weight * (amount > 0 ? 1 - v : v)); };
  tone(hi * 0.6, smoothstep(0.45, 1, luma(...c)));
  tone(sh * 0.6, 1 - smoothstep(0, 0.55, luma(...c)));
  const p = 2 ** (-(a.brightness ?? 0) * 0.8);
  c = c.map((v) => Math.max(v, 0) ** p);
  const k = (a.contrast ?? 0) - brilliance * 0.12;
  c = c.map((v) => (v - 0.5) * (1 + k * (k > 0 ? 1 : 0.8)) + 0.5);
  const bp = a.blackPoint ?? 0;
  if (bp > 0) { const t = bp * 0.18; c = c.map((v) => (v - t) / (1 - t)); } else { const t = -bp * 0.18; c = c.map((v) => v * (1 - t) + t); }
  let l = luma(...c);
  c = c.map((v) => l + (v - l) * (1 + (a.saturation ?? 0)));
  const sat = Math.max(...c) - Math.min(...c);
  l = luma(...c);
  c = c.map((v) => l + (v - l) * (1 + (a.vibrance ?? 0) * (1 - clamp(sat, 0, 1)) * 1.2));
  const warmth = a.warmth ?? 0; const tint = a.tint ?? 0;
  c[0] += warmth * 0.08 + tint * 0.03; c[2] += -warmth * 0.08 + tint * 0.03; c[1] -= tint * 0.08;
  return c.map((v) => clamp(v, 0, 1));
}

/** Up to `max` pixels of an RGBA buffer, evenly spread, as 0..1 triples. */
function samplePixels(rgba, max = 5000) {
  const n = rgba.length / 4;
  const step = Math.max(1, Math.floor(n / max));
  const out = [];
  for (let i = 0; i < n; i += step) out.push([rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255]);
  return out;
}

/** Brightness percentiles and shares of the samples after adjustments `a`. */
function measure(samples, a) {
  const L = samples.map(([r, g, b]) => luma(...simulate(r, g, b, a))).sort((x, y) => x - y);
  const pct = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
  const share = (f) => L.filter(f).length / L.length;
  return { p01: pct(0.01), p05: pct(0.05), p50: pct(0.5), p95: pct(0.95), clip: share((v) => v >= 0.995) };
}

/** Fine detail of a w×h RGBA image: mean difference of each pixel from its 3×3 neighbourhood (0..1). */
function localContrast(rgba, w, h) {
  if (!w || !h || w < 3 || h < 3) return null;
  const L = (x, y) => { const i = (y * w + x) * 4; return luma(rgba[i], rgba[i + 1], rgba[i + 2]) / 255; };
  let s = 0; let n = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m += L(x + dx, y + dy);
      s += Math.abs(L(x, y) - m / 9); n++;
    }
  }
  return s / n;
}

/**
 * Auto-Enhance settings for a photo, from a small rendering of it without adjustments (RGBA, w×h).
 * Returns every adjustment it manages (so running it again replaces, never stacks), rounded to 0.01.
 */
export function autoAdjust(rgba, w = 0, h = 0) {
  const samples = samplePixels(rgba);
  if (!samples.length) return {};
  const cfg = ENHANCE;
  const a = { exposure: 0, brilliance: 0, highlights: 0, shadows: 0, contrast: 0, brightness: 0, blackPoint: 0, saturation: 0, vibrance: 0, warmth: 0, tint: 0, sharpness: 0, definition: 0, noise: 0, vignette: 0 };
  const base = measure(samples, a);
  const L0 = samples.map(([r, g, b]) => luma(r, g, b));
  const shareOf = (f) => L0.filter(f).length / L0.length;

  // Highlights and shadows: recover bright areas, open up dark ones, in proportion to how much there is.
  const hiMass = shareOf((v) => v >= cfg.hiStart);
  if (hiMass >= cfg.hiShare) a.highlights = -clamp(0.1 + hiMass * 1.2, 0.1, 0.4);
  const loMass = shareOf((v) => v <= cfg.loEnd);
  if (loMass >= cfg.loShare) a.shadows = clamp(0.08 + loMass * 0.7, 0.08, 0.35);

  // A big even area (a studio backdrop, a wall, the sky on a clear day) is the photo's setting: its
  // lack of contrast isn't haze.
  const bins = new Uint32Array(51); // 2%-wide brightness bins: a backdrop is far more even than haze
  for (const v of L0) bins[Math.min(50, Math.floor(v * 50))]++;
  const backdrop = Math.max(...bins) / L0.length >= cfg.backdrop;

  // Haze: when even the darkest 1% of the photo as shot isn't dark, set the black point back (slightly).
  if (base.p01 > cfg.hazeFloor && !backdrop) a.blackPoint = clamp((base.p01 - 0.03) / 0.97 / 0.18, 0, 0.3);

  // Contrast: a flat photo gets some punch, toward the target spread. The renderer's contrast pivots
  // at mid-gray, so it's kept to what doesn't shift the photo's middle tone much.
  let m = measure(samples, a);
  const spread = m.p95 - m.p05;
  if (spread < cfg.spreadFlat && base.p50 > 0.3 && base.p50 < 0.7 && !backdrop) {
    let cl = 0; let ch = 0.2;
    for (let i = 0; i < 12; i++) {
      const mid = (cl + ch) / 2; const t = measure(samples, { ...a, contrast: mid });
      if (t.p95 - t.p05 < Math.min(cfg.spreadTarget, spread * 1.35) && Math.abs(t.p50 - m.p50) < 0.04) cl = mid; else ch = mid;
    }
    a.contrast = cl;
  }

  // Exposure (last of the tones, so it accounts for the rest): a darker photo's middle tone part of
  // the way to the target, without newly clipping more than a sliver (white text or a light that was
  // already white doesn't count). A bright photo keeps its brightness: only a badly blown-out one is
  // brought down a little (highlights recovery does the rest).
  const goal = Math.max(base.p50, base.p50 + (cfg.midTarget - base.p50) * cfg.midPull);
  const at = (e) => measure(samples, { ...a, exposure: e });
  const newlyClipped = (e) => {
    let n = 0; let k = 0;
    for (let i = 0; i < samples.length; i++) { if (L0[i] >= 0.93) continue; k++; if (luma(...simulate(...samples[i], { ...a, exposure: e })) >= 0.995) n++; }
    return k ? n / k : 0;
  };
  let e = 0;
  if (goal > base.p50) {
    let lo = 0; let hi = cfg.maxExposure;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (at(mid).p50 < goal) lo = mid; else hi = mid; }
    e = (lo + hi) / 2;
    for (let i = 0; i < 10 && e > 0 && newlyClipped(e) > cfg.clipSlack; i++) e *= 0.7;
  } else if (base.clip >= cfg.blown) e = -Math.min(0.15, base.clip * 2);
  a.exposure = e;
  // A dark photo that exposure alone can't lift far enough (capped): a gentle midtone lift on top,
  // which never clips.
  if (goal > base.p50 && at(e).p50 < goal - 0.01) {
    let bl = 0; let bh = 0.25;
    for (let i = 0; i < 12; i++) { const mid = (bl + bh) / 2; if (measure(samples, { ...a, brightness: mid }).p50 < goal) bl = mid; else bh = mid; }
    a.brightness = bl;
  }

  // Color: a muted photo gets more vibrance (which spares skin and already-strong colors).
  const satMean = samples.reduce((s, [r, g, b]) => s + Math.max(r, g, b) - Math.min(r, g, b), 0) / samples.length;
  a.vibrance = clamp(cfg.vibranceLow - satMean * 1.1, cfg.vibranceHigh, cfg.vibranceLow);

  // White balance: a cast in the gray midtones (gray world, each pixel weighted by how gray it is),
  // corrected partly. Solved through the renderer's math, since contrast and vibrance (applied before
  // it) also strengthen a cast.
  const grayness = ([r, g, b]) => { const l = luma(r, g, b); return l > 0.15 && l < 0.9 ? Math.max(0, 1 - (Math.max(r, g, b) - Math.min(r, g, b)) / 0.16) : 0; };
  const neutral = samples.map((c) => [c, grayness(c)]).filter(([, wgt]) => wgt > 0);
  const weight = neutral.reduce((s, [, wgt]) => s + wgt, 0);
  if (weight >= samples.length * 0.02) {
    const castOf = (adj) => {
      let rb = 0; let gm = 0;
      for (const [[r, g, b], wgt] of neutral) { const c = simulate(r, g, b, adj); rb += (c[0] - c[2]) * wgt; gm += (c[1] - (c[0] + c[2]) / 2) * wgt; }
      return [rb / weight, gm / weight]; // warm (+) or cool (-); green (+) or magenta (-)
    };
    const [rb0, gm0] = castOf({});
    // Bisection on one setting so the cast (index idx) lands on target; `rising` if it grows with the setting.
    const solve = (key, idx, target, lo, hi, rising) => {
      for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; const v = castOf({ ...a, [key]: mid })[idx]; if ((v > target) === rising) hi = mid; else lo = mid; }
      return (lo + hi) / 2;
    };
    // Warmth raises r-b; tint lowers g-(r+b)/2. Aim at what's left after correcting the cast partly.
    if (Math.abs(rb0) >= cfg.castMin) a.warmth = solve('warmth', 0, rb0 * (1 - cfg.castFix), -0.5, 0.5, true);
    if (Math.abs(gm0) >= cfg.castMin) a.tint = solve('tint', 1, gm0 * (1 - cfg.castFix), -0.4, 0.4, false);
  }

  // Detail: a little sharpening and definition, a little more for a soft or flat-looking photo; a dark
  // photo being brightened gets light noise reduction instead of extra sharpening.
  const lc = localContrast(rgba, w, h);
  const soft = lc != null && lc < 0.02;
  const lifting = a.exposure > 0.15 && base.p50 < 0.3;
  a.noise = lifting ? clamp((0.3 - base.p50) * 0.8, 0.05, 0.2) : 0;
  a.sharpness = lifting ? cfg.sharpness / 2 : soft ? cfg.sharpnessSoft : cfg.sharpness;
  a.definition = soft ? cfg.definition * 2 : cfg.definition;

  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, r2(v)]));
}
