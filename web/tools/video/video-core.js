// Video Editor's pure parts (no DOM, no workers: tested in Node): 2D → 3D side-by-side output sizes and names, and
// the image maths of turning one picture and its depth into two eyes: scene-cut detection, depth normalized and
// smoothed over time (reset at a cut), depth edges refined, each eye drawn by moving pixels by their depth (nearer
// over farther), the holes this opens behind foreground edges filled from the background, and the eyes laid out
// side by side, squeezed side by side, or top and bottom. Also the anaglyph and depth views of the preview.

// ---- Layouts and names ------------------------------------------------------------------------------------------

/**
 * The filename endings that Quest players (Skybox VR, DeoVR, Meta's own) read to know a file's 3D layout. One place
 * to change them.
 */
export const VR_SUFFIXES = { sbs: '_SBS_LR', half: '_3dh', tb: '_TB' };

/** The layouts: id, name, what it is. */
export const LAYOUTS = [
  { id: 'sbs', name: 'Full SBS', note: 'Left and right eye side by side, each at full size (twice as wide).' },
  { id: 'half', name: 'Half SBS', note: 'Side by side in the source\'s width, each eye squeezed to half width.' },
  { id: 'tb', name: 'Top-Bottom', note: 'Left eye above the right, each at full size (twice as tall).' },
];

/** The per-eye size caps offered (the longer side of each eye, in pixels; 0: the source's own size). */
export const EYE_CAPS = [[1080, '1080'], [1440, '1440'], [1920, '1920'], [0, 'Source']];

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Each eye's size for a source of `w` × `h` and a cap on its longer side (`cap`, 0 for none): { w, h }, both even. */
export function eyeSize(w, h, cap = 0) {
  const k = cap > 0 ? Math.min(1, cap / Math.max(w, h)) : 1;
  return { w: even(w * k), h: even(h * k) };
}

/**
 * The output frame for a layout and an eye size: { w, h, eyeW, eyeH } where eyeW × eyeH is the size each eye is drawn
 * at in the frame (half SBS: half the width).
 */
export function frameSize(layout, eye) {
  if (layout === 'half') { const w = even(eye.w); return { w, h: eye.h, eyeW: w / 2, eyeH: eye.h }; }
  if (layout === 'tb') return { w: eye.w, h: eye.h * 2, eyeW: eye.w, eyeH: eye.h };
  return { w: eye.w * 2, h: eye.h, eyeW: eye.w, eyeH: eye.h };
}

/** A 3D file's name: the source's, without its extension, with the layout's ending, as .mp4. */
export function vrName(name, layout, suffixes = VR_SUFFIXES) {
  const base = String(name || 'video').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[\\/:*?"<>|]+/g, '_') || 'video';
  return `${base}${suffixes[layout] ?? suffixes.sbs}.mp4`;
}

// ---- Pixels ------------------------------------------------------------------------------------------------------

/** An RGBA image resized (bilinear; box-averaged when shrinking a lot): a new Uint8ClampedArray `w` × `h`. */
export function resizeRGBA(src, W, H, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = W / w; const sy = H / h;
  if (sx >= 2 || sy >= 2) { // (box average: no shimmer when shrinking a lot)
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * sy); const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * sx); const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
        let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
        for (let yy = y0; yy < y1 && yy < H; yy++) for (let xx = x0; xx < x1 && xx < W; xx++) { const i = (yy * W + xx) * 4; r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++; }
        const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
      }
    }
    return out;
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(H - 1, (y + 0.5) * sy - 0.5)); const y0 = Math.floor(fy); const y1 = Math.min(H - 1, y0 + 1); const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(W - 1, (x + 0.5) * sx - 0.5)); const x0 = Math.floor(fx); const x1 = Math.min(W - 1, x0 + 1); const tx = fx - x0;
      const a = (y0 * W + x0) * 4; const b = (y0 * W + x1) * 4; const c = (y1 * W + x0) * 4; const d = (y1 * W + x1) * 4; const o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = (src[a + k] * (1 - tx) + src[b + k] * tx) * (1 - ty) + (src[c + k] * (1 - tx) + src[d + k] * tx) * ty;
    }
  }
  return out;
}

/** A single-channel map resized (bilinear): a new Float32Array `w` × `h`. */
export function resizeMap(src, W, H, w, h) {
  const out = new Float32Array(w * h); const sx = W / w; const sy = H / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(H - 1, (y + 0.5) * sy - 0.5)); const y0 = Math.floor(fy); const y1 = Math.min(H - 1, y0 + 1); const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(W - 1, (x + 0.5) * sx - 0.5)); const x0 = Math.floor(fx); const x1 = Math.min(W - 1, x0 + 1); const tx = fx - x0;
      out[y * w + x] = (src[y0 * W + x0] * (1 - tx) + src[y0 * W + x1] * tx) * (1 - ty) + (src[y1 * W + x0] * (1 - tx) + src[y1 * W + x1] * tx) * ty;
    }
  }
  return out;
}

// ---- Scene cuts --------------------------------------------------------------------------------------------------

/** A frame's small grey thumbnail (32 × 18), for telling scene cuts: a Float32Array of 0–1. */
export function thumbOf(rgba, W, H, tw = 32, th = 18) {
  const out = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const x0 = Math.floor((x * W) / tw); const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * W) / tw)); const y0 = Math.floor((y * H) / th); const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * H) / th));
    let s = 0; let n = 0;
    for (let yy = y0; yy < y1; yy += Math.max(1, (y1 - y0) >> 2)) for (let xx = x0; xx < x1; xx += Math.max(1, (x1 - x0) >> 2)) { const i = (yy * W + xx) * 4; s += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]; n++; }
    out[y * tw + x] = s / n / 255;
  }
  return out;
}

/**
 * Whether two frames' thumbnails are a scene cut apart: both the picture (the mean difference) and its tones (a
 * histogram's difference) changed a lot. A camera move changes the first; a cut changes both.
 */
export function isSceneCut(a, b, threshold = 0.18) {
  if (!a || !b || a.length !== b.length) return true;
  let diff = 0; for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]); diff /= a.length;
  const bins = 16; const ha = new Float32Array(bins); const hb = new Float32Array(bins);
  for (let i = 0; i < a.length; i++) { ha[Math.min(bins - 1, (a[i] * bins) | 0)]++; hb[Math.min(bins - 1, (b[i] * bins) | 0)]++; }
  let hist = 0; for (let i = 0; i < bins; i++) hist += Math.abs(ha[i] - hb[i]); hist /= 2 * a.length;
  return diff > threshold || (diff > threshold * 0.6 && hist > 0.35);
}

// ---- Depth -------------------------------------------------------------------------------------------------------

/**
 * A model's relative depth (bigger: nearer, as Depth Anything gives it) made 0 (far) to 1 (near), by its 2nd and 98th
 * percentiles (not its extremes: a few odd pixels don't change it), those bounds themselves eased over time
 * (`state.lo`, `state.hi`; `ease` 0–1, 1: none) so a scene's depth doesn't jump from frame to frame. `reset`: a new
 * scene (the bounds start afresh). Returns a new Float32Array.
 */
export function normalizeDepth(raw, state, { reset = false, ease = 0.25 } = {}) {
  const n = raw.length; const step = Math.max(1, Math.floor(n / 4096)); const sample = [];
  for (let i = 0; i < n; i += step) if (Number.isFinite(raw[i])) sample.push(raw[i]);
  sample.sort((x, y) => x - y);
  const lo = sample[Math.floor(sample.length * 0.02)] ?? 0; const hi = sample[Math.floor(sample.length * 0.98)] ?? 1;
  if (reset || state.lo == null) { state.lo = lo; state.hi = hi; } else { state.lo += (lo - state.lo) * ease; state.hi += (hi - state.hi) * ease; }
  const span = Math.max(1e-6, state.hi - state.lo); const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = (raw[i] - state.lo) / span; out[i] = v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0; }
  return out;
}

/**
 * Depth smoothed over time: each pixel eased toward the new frame's (`smoothing` 0–1: 0 none, 1 the most), but where
 * it changed a lot (something really moved) the new depth is trusted more, so moving things don't leave a trail.
 * Small changes (the model's flicker) are smoothed away. `prev` null: the new depth as it is. Returns a new array.
 */
export function smoothDepth(prev, cur, smoothing = 0.6) {
  if (!prev || prev.length !== cur.length || smoothing <= 0) return Float32Array.from(cur);
  const a = 1 - Math.min(0.95, smoothing * 0.92); const out = new Float32Array(cur.length);
  for (let i = 0; i < cur.length; i++) { const d = cur[i] - prev[i]; const k = a + (1 - a) * Math.min(1, Math.abs(d) / 0.18); out[i] = prev[i] + d * k; }
  return out;
}

/**
 * Depth edges made clean for drawing eyes: nearer depth grown a little over its edge (a max filter of `radius`), so a
 * foreground object's edge pixels move with it rather than tearing off it, then softened (a box blur of `radius`) so
 * steps don't make jagged seams. Returns a new array.
 */
export function refineDepth(d, w, h, radius = 2) {
  if (radius < 1) return Float32Array.from(d);
  const r = Math.round(radius); const tmp = new Float32Array(w * h); const out = new Float32Array(w * h);
  // (Grow: horizontal then vertical max.)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { const v = d[y * w + xx]; if (v > m) m = v; } } tmp[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { const v = tmp[yy * w + x]; if (v > m) m = v; } } out[y * w + x] = m; }
  // (Soften: horizontal then vertical box.)
  for (let y = 0; y < h; y++) { let s = 0; let n = 0; for (let k = -r; k <= r; k++) { const xx = Math.min(w - 1, Math.max(0, k)); s += out[y * w + xx]; n++; } for (let x = 0; x < w; x++) { tmp[y * w + x] = s / n; const add = Math.min(w - 1, x + r + 1); const sub = Math.max(0, x - r); s += out[y * w + add] - out[y * w + sub]; } }
  for (let x = 0; x < w; x++) { let s = 0; let n = 0; for (let k = -r; k <= r; k++) { const yy = Math.min(h - 1, Math.max(0, k)); s += tmp[yy * w + x]; n++; } for (let y = 0; y < h; y++) { out[y * w + x] = s / n; const add = Math.min(h - 1, y + r + 1); const sub = Math.max(0, y - r); s += tmp[add * w + x] - tmp[sub * w + x]; } }
  return out;
}

// ---- Eyes --------------------------------------------------------------------------------------------------------

/**
 * One eye drawn from a picture and its depth (both `W` × `H`; depth 0 far … 1 near): each pixel moved sideways by its
 * depth's distance from the screen plane (`convergence`, 0–1) times `maxShift` pixels, to the right for the left eye
 * (`side` +1) and to the left for the right eye (`side` −1), so what's nearer than the screen pops out and what's
 * farther sits behind it. Nearer pixels win where two land on one spot; small gaps on a surface are closed; the holes
 * behind foreground edges are filled from the background side (mirrored from it, so its texture carries on, not a
 * smear), then softened. Writes into `out` (RGBA, `W` × `H`).
 */
export function renderEye(src, depth, W, H, maxShift, convergence, side, out) {
  const z = new Float32Array(W); const got = new Uint8Array(W); const half = maxShift / 2;
  for (let y = 0; y < H; y++) {
    z.fill(-1); got.fill(0); const row = y * W;
    let prevT = -1e9; let prevD = 0;
    for (let x = 0; x < W; x++) {
      const d = depth[row + x]; const t = x + side * half * (d - convergence); const xi = Math.round(t);
      // (A gap of a pixel or two between neighbours on one surface: closed with this pixel.)
      const from = xi - prevT > 1 && xi - prevT <= 3 && Math.abs(d - prevD) < 0.04 ? Math.round(prevT) + 1 : xi;
      for (let tx = from; tx <= xi; tx++) {
        if (tx < 0 || tx >= W || d <= z[tx]) continue;
        z[tx] = d; got[tx] = 1; const o = (row + tx) * 4; const s = (row + x) * 4;
        out[o] = src[s]; out[o + 1] = src[s + 1]; out[o + 2] = src[s + 2]; out[o + 3] = 255;
      }
      prevT = xi; prevD = d;
    }
    // (Holes: filled from whichever side is farther (the background being revealed), mirrored into the hole.)
    for (let x = 0; x < W; x++) {
      if (got[x]) continue;
      let e = x; while (e < W && !got[e]) e++;
      const L = x - 1; const R = e; // the filled pixels either side
      const useR = L < 0 || (R < W && z[R] < z[L]);
      for (let k = x; k < e; k++) {
        let s = useR ? R + (R - k) : L - (k - L); // (mirrored from the background side)
        if (s < 0 || s >= W || !got[s] || (useR ? z[s] > z[R] + 0.05 : z[s] > z[L] + 0.05)) s = useR ? R : L; // (not into the foreground)
        if (s < 0 || s >= W) s = useR ? (L >= 0 ? L : 0) : (R < W ? R : W - 1);
        const o = (row + k) * 4; const i = (row + s) * 4; out[o] = out[i]; out[o + 1] = out[i + 1]; out[o + 2] = out[i + 2]; out[o + 3] = 255;
      }
      // (Softened: the filled run blended with its neighbours.)
      if (e - x >= 2) for (let k = x; k < e; k++) {
        const a = (row + Math.max(0, k - 1)) * 4; const b = (row + Math.min(W - 1, k + 1)) * 4; const o = (row + k) * 4;
        for (let c = 0; c < 3; c++) out[o + c] = (out[a + c] + out[o + c] * 2 + out[b + c]) / 4;
      }
      for (let k = x; k < e; k++) got[k] = 2; // (filled: not a hole again)
      x = e - 1;
    }
  }
  return out;
}

/** The two eyes into one frame of a layout (`frameSize`'s), the right eye first when `swap`. Returns RGBA `fw` × `fh`. */
export function composeFrame(layout, left, right, eyeW, eyeH, swap = false) {
  const [a, b] = swap ? [right, left] : [left, right];
  const fw = layout === 'tb' ? eyeW : eyeW * 2; const fh = layout === 'tb' ? eyeH * 2 : eyeH;
  const out = new Uint8ClampedArray(fw * fh * 4);
  for (let y = 0; y < eyeH; y++) {
    const rowA = a.subarray(y * eyeW * 4, (y + 1) * eyeW * 4); const rowB = b.subarray(y * eyeW * 4, (y + 1) * eyeW * 4);
    if (layout === 'tb') { out.set(rowA, y * fw * 4); out.set(rowB, (y + eyeH) * fw * 4); } else { out.set(rowA, y * fw * 4); out.set(rowB, y * fw * 4 + eyeW * 4); }
  }
  return out;
}

/** A red-cyan anaglyph of two eyes (for glasses; also shows the depth effect at a glance). */
export function anaglyph(left, right) {
  const out = new Uint8ClampedArray(left.length);
  for (let i = 0; i < left.length; i += 4) { out[i] = 0.299 * left[i] + 0.587 * left[i + 1] + 0.114 * left[i + 2]; out[i + 1] = right[i + 1]; out[i + 2] = right[i + 2]; out[i + 3] = 255; }
  return out;
}

/** Depth as a picture (near: warm and bright; far: dark blue). */
export function depthImage(d) {
  const out = new Uint8ClampedArray(d.length * 4);
  for (let i = 0; i < d.length; i++) { const v = d[i]; out[i * 4] = 255 * Math.min(1, v * 1.6); out[i * 4 + 1] = 255 * Math.max(0, Math.min(1, (v - 0.25) * 1.6)); out[i * 4 + 2] = 255 * (1 - v) * 0.7 + 40; out[i * 4 + 3] = 255; }
  return out;
}

/** The pixels' shift for a strength (percent of the eye's width, as Quest players are comfortable with: 0–6). */
export const shiftFor = (strength, eyeW) => (Math.max(0, Math.min(8, strength)) / 100) * eyeW;

/** A stand-in depth (tests, and when no model can run): nearer toward the bottom, brighter things nearer. */
export function fallbackDepth(rgba, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const l = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255; out[y * w + x] = 0.55 * (y / h) + 0.45 * l; }
  return out;
}
