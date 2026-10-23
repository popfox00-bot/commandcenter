// Overlay icons: the round buttons apps draw on top of a post's media (Instagram's mute and "tagged
// people" buttons: a dark translucent disc with a white symbol). Auto-Crop finds them in the media's
// corners and fills each one in from the background just around it.
//
// The fill is a retouch patch kept in the edit state (`state.patches`), in source-image coordinates,
// so the original is never changed: patches are painted onto the source before every other edit
// (preview, export, bulk), and undo removes them. A patch is { x, y, w, h } (0..1 of the source),
// its pixel size { pw, ph } and RGBA pixels as base64 (`data`; transparent outside the disc).
// Detection and filling are pure (RGBA in, circles and pixels out); applyPatches() needs a canvas.

export const ICON_DEFAULTS = Object.freeze({
  rMin: 0.02,      // icon radius, as a share of the image width: from 2%...
  rMax: 0.06,      // ...to 6% (Instagram's are ~3.6% on a phone screenshot)
  zone: 0.3,       // icons are looked for in each corner of the media, this share of the width square
  edge: 20,        // the disc is at least this much darker (luminance) than just outside it...
  ring: 0.8,       // ...all the way around: on at least 80% of the circle
  flat: 14,        // the disc itself is flat: 80% of its rim within this luminance of the rim's median
  glyphMin: 0.04,  // the white symbol fills 4%...
  glyphMax: 0.6,   // ...to 60% of the disc's middle
  margin: 0.08,    // the fill covers the disc plus this share of its radius (soft edge), at least 2 px
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
const A8 = ANGLES(8); const A32 = ANGLES(32); const A64 = ANGLES(64);

/**
 * Overlay-icon circles in an RGBA image (w×h). `rMin`/`rMax` are radii in pixels. Returns
 * [{ cx, cy, r }] in pixels, strongest first. A circle must be a flat disc clearly darker than its
 * surroundings all the way around, with a white symbol in its middle.
 */
export function findIcons(rgba, w, h, { rMin, rMax, ...opts }) {
  const cfg = { ...ICON_DEFAULTS, ...opts };
  const f = Math.max(1, Math.floor(rMin / 6));
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
  for (const spot of spots) {
    for (const c of spot) {
      if (out.some((o) => Math.hypot(o.cx - c.cx, o.cy - c.cy) < o.r + c.r)) break;
      const fine = refine(rgba, w, h, c);
      if (fine && hasSymbol(rgba, w, h, fine, cfg) && !out.some((o) => Math.hypot(o.cx - fine.cx, o.cy - fine.cy) < o.r + fine.r)) { out.push(fine); break; }
    }
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

/**
 * Fill a disc (center cx, cy, radius R, in pixels of `rgba`) from the pixels around it, so the
 * background continues through as if the icon was never there:
 *  1. a smooth membrane fill: each pixel the average of its neighbours, with the pixels just outside
 *     the disc held fixed (Laplace relaxation, started from a blend of the boundary in 16 directions);
 *  2. the background's own grain on top: the fine detail of the mirror-image spot just outside.
 * Returns the patch pixels { x0, y0, pw, ph, rgba }: alpha 255 inside the disc (1 px soft edge), 0 outside.
 */
export function fillDisc(rgba, w, h, cx, cy, R) {
  const x0 = Math.max(0, Math.floor(cx - R - 1)); const y0 = Math.max(0, Math.floor(cy - R - 1));
  const x1 = Math.min(w, Math.ceil(cx + R + 2)); const y1 = Math.min(h, Math.ceil(cy + R + 2));
  const pw = x1 - x0; const ph = y1 - y0;
  const inside = (x, y) => Math.hypot(x - cx, y - cy) < R + 1;
  const clampI = (x, y) => (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 4;
  // Working buffer over the patch area plus a 1 px frame of original pixels (the fixed boundary).
  const bw = pw + 2; const bh = ph + 2;
  const buf = new Float32Array(bw * bh * 3);
  const free = new Uint8Array(bw * bh);
  const B = R + 2;
  const dirs = Array.from({ length: 16 }, (_, i) => [Math.cos((Math.PI * i) / 8), Math.sin((Math.PI * i) / 8)]);
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const x = x0 - 1 + i; const y = y0 - 1 + j; const k = (j * bw + i) * 3;
      if (!inside(x, y)) { const o = clampI(x, y); buf[k] = rgba[o]; buf[k + 1] = rgba[o + 1]; buf[k + 2] = rgba[o + 2]; continue; }
      free[j * bw + i] = 1;
      // Start: the boundary in 16 directions, weighted by 1/distance².
      let sw = 0; let r = 0; let g = 0; let b = 0;
      for (const [ux, uy] of dirs) {
        // Distance along the ray to the boundary circle of radius B.
        const px = x - cx; const py = y - cy;
        const t = -(px * ux + py * uy) + Math.sqrt(Math.max(0, (px * ux + py * uy) ** 2 - (px * px + py * py - B * B)));
        const o = clampI(x + t * ux, y + t * uy);
        const wgt = 1 / Math.max(1, t * t);
        r += rgba[o] * wgt; g += rgba[o + 1] * wgt; b += rgba[o + 2] * wgt; sw += wgt;
      }
      buf[k] = r / sw; buf[k + 1] = g / sw; buf[k + 2] = b / sw;
    }
  }
  // Relax: Gauss-Seidel, a fixed number of sweeps (deterministic).
  for (let it = 0; it < 120; it++) {
    for (let j = 1; j < bh - 1; j++) {
      for (let i = 1; i < bw - 1; i++) {
        if (!free[j * bw + i]) continue;
        const k = (j * bw + i) * 3; const l = k - 3; const rr = k + 3; const u = k - bw * 3; const d = k + bw * 3;
        for (let c = 0; c < 3; c++) buf[k + c] = (buf[l + c] + buf[rr + c] + buf[u + c] + buf[d + c]) / 4;
      }
    }
  }
  // Grain: the detail (pixel minus its 3×3 mean) of the spot mirrored across the disc's edge.
  const detail = (x, y, c) => {
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1 || inside(x, y)) return 0;
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += rgba[((y + dy) * w + x + dx) * 4 + c];
    return rgba[(y * w + x) * 4 + c] - s / 9;
  };
  const out = new Uint8ClampedArray(pw * ph * 4);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const alpha = Math.max(0, Math.min(1, R + 0.5 - d));
      if (alpha <= 0) continue;
      const k = ((y - y0 + 1) * bw + (x - x0 + 1)) * 3; const o = ((y - y0) * pw + (x - x0)) * 4;
      const m = d > 0 ? (2 * B - d) / d : 0;
      const mx = Math.round(cx + (x - cx) * m); const my = Math.round(cy + (y - cy) * m);
      for (let c = 0; c < 3; c++) out[o + c] = buf[k + c] + (d > 0 ? detail(mx, my, c) : 0);
      out[o + 3] = Math.round(alpha * 255);
    }
  }
  return { x0, y0, pw, ph, rgba: out };
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
 * Find overlay icons in the corners of `box` (the media, in pixels of a W×H frame) and fill them in.
 * `sample(x, y, w, h)` returns full-size RGBA pixels of that rectangle. Returns patches.
 */
export function removeIcons(sample, W, H, box, opts = {}) {
  const cfg = { ...ICON_DEFAULTS, ...opts };
  const rMin = Math.max(6, Math.round(W * cfg.rMin)); const rMax = Math.max(rMin, Math.round(W * cfg.rMax));
  const z = Math.min(Math.round(W * cfg.zone), Math.floor(box.height / 2), Math.floor(box.width / 2));
  if (z < rMin * 3) return [];
  const zones = [[box.x, box.y], [box.x + box.width - z, box.y], [box.x, box.y + box.height - z], [box.x + box.width - z, box.y + box.height - z]];
  const patches = [];
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
