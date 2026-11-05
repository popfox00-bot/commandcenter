// @ts-check
// Making a small picture twice as big with its detail drawn in, not just smoothed (vendor/esrgan: ESRGAN
// Slim ×2, a compact super-resolution network, under 1 MB), on the phone, offline, by the TensorFlow.js
// that comes with face-api (vendor/face). For a Character whose face is much smaller than the one it goes
// on, so it isn't blown up blurry. Loaded the first time it's asked for.

import { trackLoad } from './diag.js';

let modelPromise = null;
function model() {
  modelPromise ??= trackLoad('Upscaler (ESRGAN Slim)', (async () => {
    // (By its URL: the vendored bundle isn't ours to type-check.)
    const api = await import(new URL('../vendor/face/face-api.esm.js', import.meta.url).href);
    const { tf } = api;
    if (!tf.getBackend()) { try { await tf.setBackend('webgl'); } catch { await tf.setBackend('cpu'); } }
    await tf.ready();
    const m = await tf.loadLayersModel(new URL('../vendor/esrgan/x2/model.json', import.meta.url).href);
    return { tf, m };
  })());
  modelPromise.catch(() => { modelPromise = null; });
  return modelPromise;
}

/**
 * `img` ({ rgba, w, h }) twice as big: its color by the network, a tile at a time (with a margin each
 * side, so the tiles meet without seams), its transparency smoothly scaled. { rgba, w: 2w, h: 2h }.
 */
export async function upscale2x(img, { tile = 96, margin = 8 } = {}) {
  const { tf, m } = await model();
  const { w, h, rgba } = img; const W = w * 2; const H = h * 2;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let ty = 0; ty < h; ty += tile) for (let tx = 0; tx < w; tx += tile) {
    // The tile with its margin (inside the picture).
    const x0 = Math.max(0, tx - margin); const y0 = Math.max(0, ty - margin);
    const x1 = Math.min(w, tx + tile + margin); const y1 = Math.min(h, ty + tile + margin);
    const tw = x1 - x0; const th = y1 - y0;
    const inp = new Float32Array(tw * th * 3);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const o = ((y0 + y) * w + x0 + x) * 4; const k = (y * tw + x) * 3;
      inp[k] = rgba[o]; inp[k + 1] = rgba[o + 1]; inp[k + 2] = rgba[o + 2];
    }
    const t = tf.tidy(() => m.predict(tf.tensor4d(inp, [1, th, tw, 3])));
    const res = await t.data(); t.dispose();
    // Only its middle (the tile itself) kept.
    const sx = (tx - x0) * 2; const sy = (ty - y0) * 2; const cw = Math.min(tile, w - tx) * 2; const ch = Math.min(tile, h - ty) * 2;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const k = ((sy + y) * tw * 2 + sx + x) * 3; const o = ((ty * 2 + y) * W + tx * 2 + x) * 4;
      out[o] = res[k]; out[o + 1] = res[k + 1]; out[o + 2] = res[k + 2];
    }
  }
  // Its transparency: smoothly (bilinear), as it was.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = Math.min(w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)); const v = Math.min(h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
    const i0 = Math.floor(u); const j0 = Math.floor(v); const i1 = Math.min(w - 1, i0 + 1); const j1 = Math.min(h - 1, j0 + 1); const fu = u - i0; const fv = v - j0;
    const a = (i, j) => rgba[(j * w + i) * 4 + 3];
    out[(y * W + x) * 4 + 3] = (a(i0, j0) * (1 - fu) + a(i1, j0) * fu) * (1 - fv) + (a(i0, j1) * (1 - fu) + a(i1, j1) * fu) * fv;
  }
  return { rgba: out, w: W, h: H };
}

/**
 * `img` twice as big, only the part in `box` ({ x, y, w, h }, 0..1 of it: the face) by the network (so
 * it's quick), the rest smoothly scaled, the two eased together over a few pixels. { rgba, w: 2w, h: 2h }.
 */
export async function upscaleRegion(img, box, { feather = 10 } = {}) {
  const { w, h, rgba } = img;
  const x0 = Math.max(0, Math.floor(box.x * w)); const y0 = Math.max(0, Math.floor(box.y * h));
  const x1 = Math.min(w, Math.ceil((box.x + box.w) * w)); const y1 = Math.min(h, Math.ceil((box.y + box.h) * h));
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  const cw = x1 - x0; const ch = y1 - y0; const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) crop.set(rgba.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x1) * 4), y * cw * 4);
  const up = await upscale2x({ rgba: crop, w: cw, h: ch });
  // All of it, smoothly (bilinear); then the face over it.
  const W = w * 2; const H = h * 2; const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = Math.min(w - 1, Math.max(0, (x + 0.5) / 2 - 0.5)); const v = Math.min(h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
    const i0 = Math.floor(u); const j0 = Math.floor(v); const i1 = Math.min(w - 1, i0 + 1); const j1 = Math.min(h - 1, j0 + 1); const fu = u - i0; const fv = v - j0;
    for (let c = 0; c < 4; c++) {
      const a = (i, j) => rgba[(j * w + i) * 4 + c];
      out[(y * W + x) * 4 + c] = (a(i0, j0) * (1 - fu) + a(i1, j0) * fu) * (1 - fv) + (a(i0, j1) * (1 - fu) + a(i1, j1) * fu) * fv;
    }
  }
  const UW = cw * 2; const UH = ch * 2;
  // Only the network's detail (each pixel less the few around it) is added to the smooth enlargement: its
  // colors and light can drift a little from the picture's, which would show as a lighter or darker box.
  const blur = (j) => {
    const v = Float32Array.from({ length: UW * UH }, (_, i) => up.rgba[i * 4 + j]); const t = new Float32Array(v.length); const r = 2;
    for (let y = 0; y < UH; y++) for (let x = 0; x < UW; x++) { let s = 0; let n = 0; for (let d = -r; d <= r; d++) { const X = x + d; if (X >= 0 && X < UW) { s += v[y * UW + X]; n++; } } t[y * UW + x] = s / n; }
    for (let x = 0; x < UW; x++) for (let y = 0; y < UH; y++) { let s = 0; let n = 0; for (let d = -r; d <= r; d++) { const Y = y + d; if (Y >= 0 && Y < UH) { s += t[Y * UW + x]; n++; } } v[y * UW + x] = s / n; }
    return v;
  };
  const smooth = [0, 1, 2].map(blur);
  for (let y = 0; y < UH; y++) for (let x = 0; x < UW; x++) {
    // Eased in from its edge (not where its edge is the picture's own).
    const d = Math.min(x0 ? x : Infinity, y0 ? y : Infinity, x1 < w ? UW - 1 - x : Infinity, y1 < h ? UH - 1 - y : Infinity);
    const f = Math.min(1, d / feather); if (f <= 0) continue;
    const o = ((y0 * 2 + y) * W + x0 * 2 + x) * 4; const k = y * UW + x;
    for (let c = 0; c < 3; c++) out[o + c] = out[o + c] + f * (up.rgba[k * 4 + c] - smooth[c][k]);
  }
  return { rgba: out, w: W, h: H };
}
