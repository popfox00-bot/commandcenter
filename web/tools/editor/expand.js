// Generative Expand: a photo made a new shape (another aspect ratio) by adding canvas beside it, the
// photo kept as it is at one side (or in the middle), and the new space filled from the photo's own
// detail: rebuilt coarse to fine from patches of the picture (complete(): multi-scale patch matching,
// see retouch.js), so the sky, wall, grass or texture at its edge runs on into the new space. Big
// pictures are filled at a working size and then brought up to full size, the detail refined there.
// Pure: RGBA in, RGBA out (no DOM), so it runs in a worker too.

import { complete } from './retouch.js';

/** Where the photo sits in the new shape: 'start' (left / top), 'center', or 'end' (right / bottom). */
export const PLACES = ['start', 'center', 'end'];

/**
 * The new canvas for a w×h photo made `ratio` (w/h) wide, the photo at its own size inside it:
 * { W, H, ox, oy, axis } (axis 'x' when it grows sideways, 'y' when it grows up or down), or null when
 * it's that shape already.
 */
export function expandLayout(w, h, ratio, place = 'center') {
  if (!(ratio > 0) || !w || !h) return null;
  const at = (free) => (place === 'start' ? 0 : place === 'end' ? free : Math.round(free / 2));
  if (ratio > w / h) {
    const W = Math.round(h * ratio); if (W - w < 2) return null;
    return { W, H: h, ox: at(W - w), oy: 0, axis: 'x' };
  }
  const H = Math.round(w / ratio); if (H - h < 2) return null;
  return { W: w, H, ox: 0, oy: at(H - h), axis: 'y' };
}

/** The photo on the new canvas, the new space black (the preview before it's filled). */
export function placeOn(rgba, w, h, { W, H, ox, oy }) {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  for (let y = 0; y < h; y++) out.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), ((y + oy) * W + ox) * 4);
  return out;
}

/** A w×h RGBA picture scaled to tw×th (area average down, bilinear up). */
export function resample(src, w, h, tw, th) {
  const out = new Uint8ClampedArray(tw * th * 4);
  if (tw <= w && th <= h) {
    const fx = w / tw; const fy = h / th;
    for (let y = 0; y < th; y++) {
      const y0 = Math.floor(y * fy); const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
      for (let x = 0; x < tw; x++) {
        const x0 = Math.floor(x * fx); const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
        const s = [0, 0, 0, 0]; let n = 0;
        for (let Y = y0; Y < y1; Y++) for (let X = x0; X < x1; X++) { const o = (Y * w + X) * 4; s[0] += src[o]; s[1] += src[o + 1]; s[2] += src[o + 2]; s[3] += src[o + 3]; n++; }
        const o = (y * tw + x) * 4; out[o] = s[0] / n; out[o + 1] = s[1] / n; out[o + 2] = s[2] / n; out[o + 3] = s[3] / n;
      }
    }
    return out;
  }
  for (let y = 0; y < th; y++) {
    const sy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / th - 0.5)); const y0 = Math.floor(sy); const y1 = Math.min(h - 1, y0 + 1); const ty = sy - y0;
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / tw - 0.5)); const x0 = Math.floor(sx); const x1 = Math.min(w - 1, x0 + 1); const tx = sx - x0;
      const a = (y0 * w + x0) * 4; const b = (y0 * w + x1) * 4; const c = (y1 * w + x0) * 4; const d = (y1 * w + x1) * 4; const o = (y * tw + x) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = (src[a + k] * (1 - tx) + src[b + k] * tx) * (1 - ty) + (src[c + k] * (1 - tx) + src[d + k] * tx) * ty;
    }
  }
  return out;
}

/** A w×h RGBA picture turned: flipped left↔right, or transposed (x↔y). */
function flipX(src, w, h) {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(src.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (y * w + (w - 1 - x)) * 4);
  return out;
}
function transpose(src, w, h) {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(src.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (x * h + y) * 4);
  return out;
}

/**
 * A first guess for `extra` new columns to the right of a w×h photo: the photo carried on from the
 * strip of it whose edge best continues the seam (its last columns match, a small shift up or down
 * allowed, so a horizon or a wall's edge lines up), a piece at a time, each piece picked to continue
 * the one before; where nothing in the photo carries the edge on better than the edge itself (a smooth
 * sky), the edge drawn on, marked with alpha 0 (the rest 255). Returns RGBA (w + extra)×h.
 */
export function quiltRight(src, w, h, extra) {
  const W = w + extra;
  const out = new Uint8ClampedArray(W * h * 4);
  for (let y = 0; y < h; y++) out.set(src.subarray(y * w * 4, (y + 1) * w * 4), y * W * 4);
  const m = Math.max(3, Math.min(12, Math.round(w * 0.04)));
  const maxShift = Math.round(h * 0.08);
  let e = w;
  while (e < W) {
    const left = W - e;
    // Pieces of about a sixth of the photo at most, so no big part of it repeats whole.
    const want = Math.max(2, Math.min(left, Math.round(w / 6)));
    let best = null;
    for (let c = m; c <= w - Math.min(want, w - m - 1) && c < w; c++) {
      if (c > e - m - 2 && c < e + 2) continue;
      for (let dy = -maxShift; dy <= maxShift; dy += 1) {
        let d = 0; let n = 0;
        for (let j = 1; j <= m; j++) {
          for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y += 2) {
            const a = (y * W + e - j) * 4; const b = ((y + dy) * w + c - j) * 4;
            const r = out[a] - src[b]; const g = out[a + 1] - src[b + 1]; const bl = out[a + 2] - src[b + 2];
            d += r * r + g * g + bl * bl; n++;
          }
        }
        // A shift costs a little (straight on is best when it's as good), and so does a short piece.
        const cost = d / Math.max(1, n) * (1 + Math.abs(dy) / (maxShift + 1) * 0.15) * (1 + 0.3 * Math.max(0, 1 - (w - c) / want));
        if (!best || cost < best.cost) best = { c, dy, cost };
      }
    }
    // Or the edge itself drawn on (a smooth sky, a plain wall: nothing in the photo carries it on better
    // than more of the same). It counts double, so a texture is copied rather than smeared.
    let smear = 0; let ns = 0; const edge = new Float32Array(h * 3);
    for (let y = 0; y < h; y++) for (let j = 1; j <= Math.min(3, m); j++) { const a = (y * W + e - j) * 4; for (let k = 0; k < 3; k++) edge[y * 3 + k] += out[a + k] / Math.min(3, m); }
    for (let j = 1; j <= m; j++) for (let y = 0; y < h; y += 2) { const a = (y * W + e - j) * 4; for (let k = 0; k < 3; k++) smear += (out[a + k] - edge[y * 3 + k]) ** 2; ns++; }
    if (!best || 2 * smear / Math.max(1, ns) <= best.cost) {
      for (let x = e; x < W; x++) for (let y = 0; y < h; y++) { const o = (y * W + x) * 4; out[o] = edge[y * 3]; out[o + 1] = edge[y * 3 + 1]; out[o + 2] = edge[y * 3 + 2]; out[o + 3] = 0; }
      break;
    }
    const len = Math.max(1, Math.min(left, w - best.c, want));
    for (let j = 0; j < len; j++) {
      for (let y = 0; y < h; y++) {
        const sy = Math.min(h - 1, Math.max(0, y + best.dy));
        const o = (y * W + e + j) * 4; const q = (sy * w + best.c + j) * 4;
        out[o] = src[q]; out[o + 1] = src[q + 1]; out[o + 2] = src[q + 2]; out[o + 3] = 255;
      }
    }
    e += len;
  }
  return out;
}

/** The first guess for the whole new canvas: each side of the photo carried on outward from its seam. */
export function quiltGuess(src, w, h, { W, H, ox, oy, axis }) {
  // Work as if growing to the right: flip or transpose into place, and back.
  let img = src; let iw = w; let ih = h;
  if (axis === 'y') { img = transpose(src, w, h); [iw, ih] = [h, w]; }
  const before = axis === 'x' ? ox : oy; const after = (axis === 'x' ? W - w : H - h) - before;
  if (after > 0) { img = quiltRight(img, iw, ih, after); iw += after; }
  if (before > 0) { img = flipX(quiltRight(flipX(img, iw, ih), iw, ih, before), iw + before, ih); iw += before; }
  return axis === 'y' ? transpose(img, iw, ih) : img;
}

/**
 * A box blur of an RGBA picture's color (radius r, twice over: close to a Gaussian), of only the pixels
 * `use(i)` says (each blurred value the mean of those near it). Floats out.
 */
function blurRgb(src, w, h, r, use) {
  const ones = Float32Array.from({ length: w * h * 3 }, (_, k) => (use((k / 3) | 0) ? 1 : 0));
  let a = Float32Array.from({ length: w * h * 3 }, (_, k) => (ones[k] ? src[((k / 3) | 0) * 4 + (k % 3)] : 0));
  let wts = ones;
  const pass = (inp, horizontal) => {
    const out = new Float32Array(inp.length);
    const [n, m] = horizontal ? [w, h] : [h, w];
    for (let j = 0; j < m; j++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0; let cnt = 0;
        const at = (i) => (horizontal ? (j * w + i) * 3 + c : (i * w + j) * 3 + c);
        for (let i = 0; i < Math.min(n, r + 1); i++) { acc += inp[at(i)]; cnt++; }
        for (let i = 0; i < n; i++) {
          out[at(i)] = acc / cnt;
          if (i + r + 1 < n) { acc += inp[at(i + r + 1)]; cnt++; }
          if (i - r >= 0) { acc -= inp[at(i - r)]; cnt--; }
        }
      }
    }
    return out;
  };
  for (let k = 0; k < 2; k++) { a = pass(pass(a, true), false); wts = pass(pass(wts, true), false); }
  for (let k = 0; k < a.length; k++) a[k] = wts[k] > 1e-6 ? a[k] / wts[k] : 0;
  return a;
}

/**
 * Where the first guess drew the photo's edge on (a smooth sky: alpha 0 in `guess`), the fill keeps
 * the guess's light and color and takes only its fine detail from the patches: patches can only copy
 * what's in the photo, so a sky darkening toward the edge would otherwise step back lighter. In place
 * on `img`, over the new space (`known(x, y)` false).
 */
const DETAIL = 4;
export function keepSmoothLight(img, guess, w, h, known) {
  const r = Math.max(3, Math.round(Math.max(w, h) * 0.06));
  const hole = (i) => !known(i % w, (i / w) | 0);
  const bi = blurRgb(img, w, h, r, hole); const bg = blurRgb(guess, w, h, r, hole);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (known(x, y)) continue;
    const i = y * w + x; const wt = 1 - guess[i * 4 + 3] / 255;
    if (wt <= 0) continue;
    // The guess's light, plus the patches' fine detail (a smooth sky has little: kept to a little, so
    // no band or line comes along with it).
    for (let c = 0; c < 3; c++) {
      const v = img[i * 4 + c]; const detail = Math.max(-DETAIL, Math.min(DETAIL, v - bi[i * 3 + c]));
      img[i * 4 + c] = v + wt * (bg[i * 3 + c] + detail - v);
    }
  }
  return img;
}

/**
 * The photo (`rgba`, w×h) expanded to `layout` (from expandLayout), the new space filled from the
 * photo. The photo's own pixels are kept exactly. `work`: the size (longest side) the layout is worked
 * out at; above it, the fill is brought up to full size and its detail refined there (`refine`).
 * onProgress(0–1) between steps. Returns RGBA W×H.
 */
export function expandFill(rgba, w, h, layout, { work = 480, refine = 1200, onProgress = () => {} } = {}) {
  const { W, H, ox, oy } = layout;
  const full = placeOn(rgba, w, h, layout);
  const inPhoto = (x, y) => x >= ox && y >= oy && x < ox + w && y < oy + h;
  const holeBox = (WW, HH, k) => {
    // The new space's box at scale k (the whole canvas but the photo's span along the growing side).
    if (layout.axis === 'x') {
      const a = Math.floor(ox * k); const b = Math.ceil((ox + w) * k);
      return ox > 0 && ox + w < W ? { x0: 0, y0: 0, x1: WW, y1: HH } : ox > 0 ? { x0: 0, y0: 0, x1: Math.min(WW, a + 1), y1: HH } : { x0: Math.max(0, b - 1), y0: 0, x1: WW, y1: HH };
    }
    const a = Math.floor(oy * k); const b = Math.ceil((oy + h) * k);
    return oy > 0 && oy + h < H ? { x0: 0, y0: 0, x1: WW, y1: HH } : oy > 0 ? { x0: 0, y0: 0, x1: WW, y1: Math.min(HH, a + 1) } : { x0: 0, y0: Math.max(0, b - 1), x1: WW, y1: HH };
  };
  const fill = (img, WW, HH, unknown, k, init, opts) => {
    const b = holeBox(WW, HH, k);
    const R = Math.max(4, Math.ceil(Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2));
    return complete(img, WW, HH, unknown, b.x0, b.y0, b.x1, b.y1, R, init, opts);
  };

  // 1. The layout, at a small working size: the new space rebuilt coarse to fine from the photo.
  const k = Math.min(1, work / Math.max(W, H));
  const sw = Math.max(16, Math.round(W * k)); const sh = Math.max(16, Math.round(H * k));
  const kx = sw / W; const ky = sh / H;
  // A small pixel is the photo's only when all of it is (the edge gets rebuilt, so no dark rim).
  const sx0 = Math.ceil(ox * kx); const sy0 = Math.ceil(oy * ky); const sx1 = Math.floor((ox + w) * kx); const sy1 = Math.floor((oy + h) * ky);
  const smallKnown = (x, y) => x >= sx0 && y >= sy0 && x < sx1 && y < sy1;
  // The photo at the working size, carried on outward as a first guess, then the new space rebuilt
  // from it coarse to fine (the guess sets where things go; the patches make it look like the photo).
  const pw = Math.max(8, Math.round(w * kx)); const ph = Math.max(8, Math.round(h * ky));
  const lay = { W: sw, H: sh, ox: Math.min(sw - pw, Math.round(ox * kx)), oy: Math.min(sh - ph, Math.round(oy * ky)), axis: layout.axis };
  if (lay.axis === 'x') lay.H = ph; else lay.W = pw;
  const guess = quiltGuess(resample(rgba, w, h, pw, ph), pw, ph, lay);
  let img = resample(full, W, H, sw, sh);
  const guessS = resample(guess, lay.W, lay.H, sw, sh);
  img = fill(img, sw, sh, (x, y) => !smallKnown(x, y), kx, guessS, { maxLevels: 4, iters: 3, minHole: 2, minSize: 16 });
  keepSmoothLight(img, guessS, sw, sh, smallKnown);
  onProgress(0.4);
  if (k === 1) { for (let i = 3; i < img.length; i += 4) img[i] = 255; onProgress(1); return img; }

  // 2. Up to the size it's refined at (at most `refine` across), then each pixel of the new space taken
  // from the best-matching patch of the photo there (the detail at that size, not a blur of the small one).
  const k2 = Math.min(1, refine / Math.max(W, H));
  let cw = Math.round(W * k2); let ch = Math.round(H * k2); let cur = img; let curW = sw; let curH = sh;
  // In steps of about twice the size, each refined, so the detail builds up level by level.
  const sizes = [];
  for (let s = 2; ; s *= 2) { const tw = Math.round(sw * s); if (tw >= cw) break; sizes.push([tw, Math.round(sh * s)]); }
  if (cw > sw) sizes.push([cw, ch]);
  sizes.forEach(([tw, th], n) => {
    const fx = tw / W; const fy = th / H;
    const x0 = Math.ceil(ox * fx); const y0 = Math.ceil(oy * fy); const x1 = Math.floor((ox + w) * fx); const y1 = Math.floor((oy + h) * fy);
    const known = (x, y) => x >= x0 && y >= y0 && x < x1 && y < y1;
    const base = tw === W && th === H ? full : resample(full, W, H, tw, th);
    const init = resample(cur, curW, curH, tw, th);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) if (known(x, y)) { const o = (y * tw + x) * 4; init[o] = base[o]; init[o + 1] = base[o + 1]; init[o + 2] = base[o + 2]; }
    cur = fill(base, tw, th, (x, y) => !known(x, y), fx, init, { maxLevels: 2, iters: 1, minHole: 1, minSize: 16 });
    keepSmoothLight(cur, resample(guessS, sw, sh, tw, th), tw, th, known);
    curW = tw; curH = th;
    onProgress(0.4 + (0.5 * (n + 1)) / sizes.length);
  });
  [cw, ch] = [curW, curH];
  if (cw === W && ch === H) { for (let i = 3; i < cur.length; i += 4) cur[i] = 255; onProgress(1); return cur; }
  // 3. Bigger still: the fill brought up smoothly; the photo itself stays exact.
  const up = resample(cur, cw, ch, W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inPhoto(x, y)) { const o = (y * W + x) * 4; up[o] = full[o]; up[o + 1] = full[o + 1]; up[o + 2] = full[o + 2]; up[o + 3] = 255; }
  onProgress(1);
  return up;
}
