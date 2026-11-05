// Clean Up: remove anything from a photo (a person in the back, a sign, a speck, an overlay icon)
// by tapping it, brushing over it, or drawing around it, and the spot is rebuilt from the picture
// around it so it blends in (complete(): multi-scale patch matching, see retouch.js). Copy From Area:
// pick a spot elsewhere in the photo and the area is covered with a copy of it, one to one, its edge
// colors blended into the new surroundings (seamless cloning), for when the automatic fill looks
// smudged. Pure: RGBA in, patch pixels out ({ x0, y0, pw, ph, rgba }, alpha = coverage).

import { complete } from './retouch.js';

/** Total length of a polyline. */
function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** Twice the signed area of a polygon. */
function area2(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a;
}

/**
 * What a stroke means (points in pixels, brush radius r): 'tap' (barely moved: a dot of the brush),
 * 'lasso' (it comes back near where it started and goes around something: everything inside it), or
 * 'brush' (a line painted along the way).
 */
export function strokeShape(points, r) {
  const L = pathLength(points);
  if (L < r) return 'tap';
  const [x0, y0] = points[0]; const [x1, y1] = points.at(-1);
  const gap = Math.hypot(x1 - x0, y1 - y0);
  const enclosed = Math.abs(area2(points)) / 2;
  // Closed: the ends meet (within a few brush widths, or a quarter of the way round) and it goes
  // around more than a dot of the brush.
  if (points.length >= 4 && L > 3 * r && gap < Math.max(3 * r, L * 0.25) && enclosed > Math.PI * r * r) return 'lasso';
  return 'brush';
}

/**
 * The mask (1 = clean up) of a stroke over a w×h picture: a dot, a painted line, or a drawn shape and
 * its inside (with the line itself, so the edge of the thing goes too). { mask, shape, box }.
 */
export function strokeMask(points, r, w, h) {
  const shape = strokeShape(points, r);
  const mask = new Uint8Array(w * h);
  let bx0 = w; let by0 = h; let bx1 = 0; let by1 = 0;
  const mark = (x, y) => { mask[y * w + x] = 1; if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (x >= bx1) bx1 = x + 1; if (y >= by1) by1 = y + 1; };
  const dab = (cx, cy) => {
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, Math.ceil(cy + r + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, Math.ceil(cx + r + 1)); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) mark(x, y);
    }
  };
  const pts = shape === 'tap' ? [points[0]] : points;
  pts.forEach(([x, y], k) => {
    if (!k) { dab(x, y); return; }
    const [px, py] = pts[k - 1]; const steps = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / Math.max(1, r / 3)));
    for (let s = 1; s <= steps; s++) dab(px + ((x - px) * s) / steps, py + ((y - py) * s) / steps);
  });
  if (shape === 'lasso') {
    // Inside the shape (even-odd, row by row).
    const ys = pts.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(h, Math.ceil(Math.max(...ys)) + 1); y++) {
      const cy = y + 0.5; const xs = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
        if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) * (xj - xi)) / (yj - yi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < Math.min(w, Math.floor(xs[k + 1] - 0.5) + 1); x++) mark(x, y);
    }
  }
  return { mask, shape, box: bx1 > bx0 ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : null };
}

/** The mask grown by `n` pixels (4-neighbour steps), within the box grown the same. */
function grow(mask, w, h, box, n) {
  const out = Uint8Array.from(mask);
  const b = { x0: Math.max(0, box.x0 - n), y0: Math.max(0, box.y0 - n), x1: Math.min(w, box.x1 + n), y1: Math.min(h, box.y1 + n) };
  for (let s = 0; s < n; s++) {
    const prev = Uint8Array.from(out);
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
      const i = y * w + x; if (prev[i]) continue;
      if ((x > 0 && prev[i - 1]) || (x < w - 1 && prev[i + 1]) || (y > 0 && prev[i - w]) || (y < h - 1 && prev[i + w])) out[i] = 1;
    }
  }
  return { mask: out, box: b };
}

/** The patch pixels of `img` (full w×h RGBA) over the mask's box, with a 1 px soft edge. */
function patchOf(img, mask, w, h, box) {
  const x0 = Math.max(0, box.x0 - 1); const y0 = Math.max(0, box.y0 - 1);
  const pw = Math.min(w, box.x1 + 1) - x0; const ph = Math.min(h, box.y1 + 1) - y0;
  const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const X = x0 + x; const Y = y0 + y; const i = Y * w + X;
    let a;
    if (mask[i]) a = 255;
    else {
      // Just outside: half covered when next to the area (no hard step at the edge).
      let n = 0; for (const t of [X > 0 ? i - 1 : -1, X < w - 1 ? i + 1 : -1, i - w, i + w]) if (t >= 0 && t < w * h && mask[t]) n++;
      a = n ? 110 : 0;
    }
    if (!a) continue;
    const o = (y * pw + x) * 4; const s = i * 4;
    rgba[o] = img[s]; rgba[o + 1] = img[s + 1]; rgba[o + 2] = img[s + 2]; rgba[o + 3] = a;
  }
  return { x0, y0, pw, ph, rgba };
}

/**
 * A membrane: `diff` (3 floats a pixel, bw×bh) is fixed where `free` is 0 and spread smoothly over the
 * free pixels (over-relaxed Gauss-Seidel, a coarse pass first so big areas settle quickly).
 */
export function membrane(diff, free, bw, bh) {
  const relax = (buf, fr, W, H, sweeps) => {
    for (let it = 0; it < sweeps; it++) {
      for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
        const k = j * W + i; if (!fr[k]) continue;
        for (let c = 0; c < 3; c++) {
          const avg = (buf[(k - 1) * 3 + c] + buf[(k + 1) * 3 + c] + buf[(k - W) * 3 + c] + buf[(k + W) * 3 + c]) / 4;
          buf[k * 3 + c] += 1.85 * (avg - buf[k * 3 + c]);
        }
      }
    }
  };
  if (bw > 24 && bh > 24) {
    const cw = Math.ceil(bw / 4) + 1; const ch = Math.ceil(bh / 4) + 1;
    const cbuf = new Float32Array(cw * ch * 3); const cfree = new Uint8Array(cw * ch); const cnt = new Float32Array(cw * ch);
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      const k = j * bw + i; if (free[k]) continue;
      const c2 = Math.floor(j / 4) * cw + Math.floor(i / 4); cnt[c2]++;
      for (let c = 0; c < 3; c++) cbuf[c2 * 3 + c] += diff[k * 3 + c];
    }
    for (let k = 0; k < cw * ch; k++) { if (cnt[k]) for (let c = 0; c < 3; c++) cbuf[k * 3 + c] /= cnt[k]; else cfree[k] = 1; }
    relax(cbuf, cfree, cw, ch, 120);
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      const k = j * bw + i; if (!free[k]) continue;
      const c2 = Math.floor(j / 4) * cw + Math.floor(i / 4);
      for (let c = 0; c < 3; c++) diff[k * 3 + c] = cbuf[c2 * 3 + c];
    }
  }
  relax(diff, free, bw, bh, 160);
  return diff;
}

/**
 * Evens out the light and color where a fill meets the picture: along the area's edge, how the
 * surroundings differ from the fill on average (over a few pixels, so texture doesn't count), spread
 * smoothly across the fill. In place, on `img` (the picture with the fill in it). With `allow`, only
 * those pixels count as the surroundings (where the area meets something else, it isn't matched to it).
 */
function evenEdges(orig, img, w, h, mask, box, allow = null) {
  const b = { x0: Math.max(0, box.x0 - 1), y0: Math.max(0, box.y0 - 1), x1: Math.min(w, box.x1 + 1), y1: Math.min(h, box.y1 + 1) };
  const bw = b.x1 - b.x0; const bh = b.y1 - b.y0; const k3 = 3;
  const free = new Uint8Array(bw * bh); const diff = new Float32Array(bw * bh * 3);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const x = b.x0 + i; const y = b.y0 + j; const k = j * bw + i;
    if (!mask[y * w + x]) continue;
    const edge = (x > 0 && !mask[y * w + x - 1]) || (x < w - 1 && !mask[y * w + x + 1]) || (y > 0 && !mask[(y - 1) * w + x]) || (y < h - 1 && !mask[(y + 1) * w + x]);
    if (!edge) { free[k] = 1; continue; }
    // Mean of the picture just outside, and of the fill just inside, within a few pixels.
    const so = [0, 0, 0]; const si = [0, 0, 0]; let no = 0; let ni = 0;
    for (let dy = -k3; dy <= k3; dy++) for (let dx = -k3; dx <= k3; dx++) {
      const X = x + dx; const Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const o = (Y * w + X) * 4;
      if (mask[Y * w + X]) { si[0] += img[o]; si[1] += img[o + 1]; si[2] += img[o + 2]; ni++; } else if (!allow || allow[Y * w + X]) { so[0] += orig[o]; so[1] += orig[o + 1]; so[2] += orig[o + 2]; no++; }
    }
    if (no && ni) for (let c = 0; c < 3; c++) diff[k * 3 + c] = so[c] / no - si[c] / ni;
    else free[k] = 1; // nothing to match here: it follows its neighbours
  }
  membrane(diff, free, bw, bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const x = b.x0 + i; const y = b.y0 + j; if (!mask[y * w + x]) continue;
    const o = (y * w + x) * 4; const k = j * bw + i;
    for (let c = 0; c < 3; c++) img[o + c] = img[o + c] + diff[k * 3 + c];
  }
}

/**
 * Clean up the masked area of `rgba` (w×h): rebuilt from the picture around it, coarse to fine (from
 * a tiny version of the area up: the layout first, then the texture), carried through so lines and
 * patterns run on, then its light and color evened out with the surroundings at the edge. The area is
 * grown by a couple of pixels first, so the soft rim of what's removed (its shadow, its anti-aliased
 * edge) goes too. Returns patch pixels, or null for an empty mask.
 */
export function cleanUp(rgba, w, h, mask, box) {
  if (!box) return null;
  const g = grow(mask, w, h, box, 2);
  const R = Math.max(4, Math.ceil(Math.max(g.box.x1 - g.box.x0, g.box.y1 - g.box.y0) / 2));
  const done = complete(rgba, w, h, (x, y) => g.mask[y * w + x] === 1, g.box.x0, g.box.y0, g.box.x1, g.box.y1, R, null, { maxLevels: 6, minHole: 3, minSize: 24 });
  evenEdges(rgba, done, w, h, g.mask, g.box);
  return patchOf(done, g.mask, w, h, g.box);
}

/**
 * Copy From Area: the masked area covered with the picture at an offset (dx, dy) from it, pixel for
 * pixel, then blended in at its edge: the differences in color along the edge are spread smoothly
 * (a membrane, as in seamless cloning) and eased out toward the middle, so it meets the surroundings
 * with no seam while the copy itself, texture, color and detail, stays as it was. Returns patch pixels, or null when the copy
 * would come from outside the picture.
 */
export function cloneFrom(rgba, w, h, mask, box, dx, dy) {
  if (!box) return null;
  dx = Math.round(dx); dy = Math.round(dy);
  const g = grow(mask, w, h, box, 1);
  const b = g.box; const m = g.mask;
  const bw = b.x1 - b.x0 + 2; const bh = b.y1 - b.y0 + 2; // one pixel of frame all round
  const at = (x, y) => (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
  // Most of the copy must come from inside the picture.
  let outside = 0; let n = 0;
  for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (m[y * w + x]) { n++; const X = x + dx; const Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) outside++; }
  if (!n || outside > n * 0.2) return null;
  // The membrane: 0 inside to start, the edge difference (picture − copy) on the frame around it.
  const free = new Uint8Array(bw * bh); const diff = new Float32Array(bw * bh * 3);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const x = b.x0 - 1 + i; const y = b.y0 - 1 + j; const k = j * bw + i;
    const inside = x >= 0 && y >= 0 && x < w && y < h && m[y * w + x];
    if (inside) { free[k] = 1; continue; }
    const p = at(x, y); const q = at(x + dx, y + dy);
    for (let c = 0; c < 3; c++) diff[k * 3 + c] = rgba[p + c] - rgba[q + c];
  }
  membrane(diff, free, bw, bh);
  // The blend is full at the edge and fades out within a few pixels (a sixth of the area across), so
  // the copy meets its surroundings with no seam but stays itself, one to one, inside.
  const depth = new Float32Array(bw * bh).fill(Infinity); const q0 = [];
  for (let k = 0; k < bw * bh; k++) if (!free[k]) { depth[k] = 0; q0.push(k); }
  for (let head = 0; head < q0.length; head++) {
    const k = q0[head]; const i = k % bw;
    for (const t of [i > 0 ? k - 1 : -1, i < bw - 1 ? k + 1 : -1, k - bw, k + bw]) {
      if (t < 0 || t >= bw * bh || depth[t] <= depth[k] + 1) continue;
      depth[t] = depth[k] + 1; q0.push(t);
    }
  }
  const fade = Math.max(3, Math.min(bw, bh) / 6);
  const out = Uint8ClampedArray.from(rgba);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const k = j * bw + i; if (!free[k]) continue;
    const x = b.x0 - 1 + i; const y = b.y0 - 1 + j; const o = (y * w + x) * 4; const q = at(x + dx, y + dy);
    const wt = Math.max(0, 1 - (depth[k] - 1) / fade);
    for (let c = 0; c < 3; c++) out[o + c] = rgba[q + c] + wt * diff[k * 3 + c];
  }
  return patchOf(out, m, w, h, b);
}

// ---------- Reverse Fill ----------

/** sRGB (0–255) → CIE Lab, for color distances that look right. */
export function toLab(r, g, b) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r); const G = lin(g); const B = lin(b);
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047); const fy = f(0.2126 * R + 0.7152 * G + 0.0722 * B); const fz = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** The color at (x, y): the median of a small square around it (a speck or the grain doesn't count). */
export function sampleShade(rgba, w, h, x, y, rad = 2) {
  const ch = [[], [], []];
  for (let Y = Math.max(0, Math.round(y) - rad); Y <= Math.min(h - 1, Math.round(y) + rad); Y++) {
    for (let X = Math.max(0, Math.round(x) - rad); X <= Math.min(w - 1, Math.round(x) + rad); X++) for (let c = 0; c < 3; c++) ch[c].push(rgba[(Y * w + X) * 4 + c]);
  }
  return ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1] ?? 0);
}

/**
 * Reverse Fill's area: inside the traced `region` (a mask over w×h, with its box), the pixels whose
 * color is near one of the picked `shades` ([r, g, b]s): within `tol` (ΔE, CIE Lab), or within half as
 * much again where they touch those (the same color in shadow, an anti-aliased edge), with the small
 * bits in between that the shades close around (the label's print, its lettering), and a pixel of rim
 * (`edge` pixels of it: a soft-edged thing's blur into what's around it).
 * { mask, box, count } (box null when nothing matched).
 */
export function shadeMask(rgba, w, h, region, box, shades, tol = 18, { edge = 0 } = {}) {
  const mask = new Uint8Array(w * h);
  if (!box || !shades.length) return { mask, box: null, count: 0 };
  const labs = shades.map(([r, g, b]) => toLab(r, g, b));
  const bw = box.x1 - box.x0; const bh = box.y1 - box.y0;
  const near = new Float32Array(bw * bh).fill(Infinity);
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const i = y * w + x; if (!region[i]) continue;
    const [L, A, B] = toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    let d = Infinity;
    for (const s of labs) { const e = (L - s[0]) ** 2 * 0.6 + (A - s[1]) ** 2 + (B - s[2]) ** 2; if (e < d) d = e; }
    near[(y - box.y0) * bw + x - box.x0] = Math.sqrt(d);
  }
  // Sure matches, then the looser ones joined to them.
  const q = [];
  for (let k = 0; k < bw * bh; k++) if (near[k] <= tol) { mask[(box.y0 + ((k / bw) | 0)) * w + box.x0 + (k % bw)] = 1; q.push(k); }
  for (let head = 0; head < q.length; head++) {
    const k = q[head]; const i = k % bw; const j = (k / bw) | 0;
    for (const t of [i > 0 ? k - 1 : -1, i < bw - 1 ? k + 1 : -1, j > 0 ? k - bw : -1, j < bh - 1 ? k + bw : -1]) {
      if (t < 0) continue;
      const m = (box.y0 + ((t / bw) | 0)) * w + box.x0 + (t % bw);
      if (mask[m] || near[t] > tol * 1.5) continue;
      mask[m] = 1; q.push(t);
    }
  }
  let count = q.length;
  if (!count) return { mask, box: null, count: 0 };
  // What the matches close around (and the trace's edge doesn't reach): taken too, unless it's big.
  const seen = new Uint8Array(bw * bh); const limit = Math.max(64, count * 0.25);
  for (let k0 = 0; k0 < bw * bh; k0++) {
    const m0 = (box.y0 + ((k0 / bw) | 0)) * w + box.x0 + (k0 % bw);
    if (seen[k0] || mask[m0] || !region[m0]) continue;
    const comp = [k0]; seen[k0] = 1; let open = false;
    for (let head = 0; head < comp.length; head++) {
      const k = comp[head]; const i = k % bw; const j = (k / bw) | 0;
      if (i === 0 || j === 0 || i === bw - 1 || j === bh - 1) open = true;
      for (const t of [i > 0 ? k - 1 : -1, i < bw - 1 ? k + 1 : -1, j > 0 ? k - bw : -1, j < bh - 1 ? k + bw : -1]) {
        if (t < 0 || seen[t]) continue;
        const m = (box.y0 + ((t / bw) | 0)) * w + box.x0 + (t % bw);
        if (mask[m]) continue;
        if (!region[m]) { open = true; continue; }
        seen[t] = 1; comp.push(t);
      }
    }
    if (!open && comp.length <= limit) for (const k of comp) { mask[(box.y0 + ((k / bw) | 0)) * w + box.x0 + (k % bw)] = 1; count++; }
  }
  // A pixel of rim, inside the trace (with `edge`: that many, for a soft edge where it blends into what's around it).
  if (edge > 1) {
    for (let s2 = 1; s2 < edge; s2++) {
      const prev = Uint8Array.from(mask);
      for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
        const i = y * w + x;
        if (!prev[i] && region[i] && ((x > 0 && prev[i - 1]) || (x < w - 1 && prev[i + 1]) || (y > 0 && prev[i - w]) || (y < h - 1 && prev[i + w]))) { mask[i] = 1; count++; }
      }
    }
  }
  const out = Uint8Array.from(mask);
  let x0 = w; let y0 = h; let x1 = 0; let y1 = 0;
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const i = y * w + x;
    if (!mask[i] && region[i] && ((x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) || (y > 0 && mask[i - w]) || (y < h - 1 && mask[i + w]))) { out[i] = 1; count++; }
    if (out[i]) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x >= x1) x1 = x + 1; if (y >= y1) y1 = y + 1; }
  }
  return { mask: out, box: { x0, y0, x1, y1 }, count };
}

/**
 * Reverse Fill's automatic trace, from colors picked on the photo: what's joined to the picked spots
 * (`seeds`, [x, y] pixels) and near the picked `shades` ([r, g, b]s; within `tol`, ΔE, or half as much
 * again, or of the same hue however light or dark where it shades smoothly on from them: in shadow, in the light), the whole of it as one area however it winds (a label, a logo, a stain), then a loop around it
 * with room for the surface it's on (a sixth of its size, at least 8 px, at most 60): the trace Reverse
 * Fill takes the shades out of and fills from. { mask, box, sel, share } (`sel`: how many pixels were
 * selected; `share`: of the whole photo), or null when nothing at the spots matches.
 */
export function autoTrace(rgba, w, h, seeds, shades, tol = 18) {
  if (!seeds.length || !shades.length) return null;
  const labs = shades.map(([r, g, b]) => toLab(r, g, b));
  const near = (i) => { const [L, A, B] = toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]); let d = Infinity; for (const c of labs) { const e = (L - c[0]) ** 2 * 0.6 + (A - c[1]) ** 2 + (B - c[2]) ** 2; if (e < d) d = e; } return Math.sqrt(d); };
  // (Its hue within `tol`, and its lightness within 2.5 × `tol`: a shadow on it, not something dark beside it.)
  const hueNear = (i) => { const [L, A, B] = toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]); let d = Infinity; for (const c of labs) { if (Math.abs(L - c[0]) > tol * 2.5) continue; const e = (A - c[1]) ** 2 + (B - c[2]) ** 2; if (e < d) d = e; } return Math.sqrt(d); };
  const sel = new Uint8Array(w * h); const seen = new Uint8Array(w * h); const q = [];
  const step = (i, j) => { const a = toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]); const b = toLab(rgba[j * 4], rgba[j * 4 + 1], rgba[j * 4 + 2]); return Math.sqrt((a[0] - b[0]) ** 2 * 0.6 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2); };
  for (const [sx, sy] of seeds) {
    const x = Math.round(sx); const y = Math.round(sy); if (x < 0 || y < 0 || x >= w || y >= h) continue;
    // The spot itself, or the nearest matching pixel within a few of it (a tap just beside a thin line).
    let best = -1; let bd = Infinity;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = x + dx; const Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const i = Y * w + X; const d = near(i); if (d <= tol * 1.5 && d + Math.hypot(dx, dy) < bd) { bd = d + Math.hypot(dx, dy); best = i; } }
    if (best >= 0 && !seen[best]) { seen[best] = 1; sel[best] = 1; q.push(best); }
  }
  if (!q.length) return null;
  let x0 = w; let y0 = h; let x1 = 0; let y1 = 0;
  for (let head = 0; head < q.length; head++) {
    const i = q[head]; const X = i % w; const Y = (i / w) | 0;
    if (X < x0) x0 = X; if (Y < y0) y0 = Y; if (X >= x1) x1 = X + 1; if (Y >= y1) y1 = Y + 1;
    for (const t of [X > 0 ? i - 1 : -1, X < w - 1 ? i + 1 : -1, Y > 0 ? i - w : -1, Y < h - 1 ? i + w : -1]) {
      if (t < 0 || sel[t]) continue;
      // Near a picked shade; or of its hue however light or dark, smoothly on from the pixel it's reached
      // from (the same thing in shadow, or catching the light: a step that small isn't an edge).
      if (near(t) > tol * 1.5 && (hueNear(t) > tol || step(i, t) > 6)) continue;
      sel[t] = 1; q.push(t);
    }
  }
  // The loop around it: everything within `pad` of what was selected (by a distance spread out from it).
  const size = Math.max(x1 - x0, y1 - y0);
  const pad = Math.round(Math.max(8, Math.min(60, size / 6)));
  const box = { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(w, x1 + pad), y1: Math.min(h, y1 + pad) };
  const bw = box.x1 - box.x0; const bh = box.y1 - box.y0;
  const dist = new Float32Array(bw * bh).fill(Infinity);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (sel[(box.y0 + y) * w + box.x0 + x]) dist[y * bw + x] = 0;
  // Two passes of a chamfer distance (3-4: close to round).
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x; let d = dist[k];
    if (x > 0) d = Math.min(d, dist[k - 1] + 1); if (y > 0) d = Math.min(d, dist[k - bw] + 1);
    if (x > 0 && y > 0) d = Math.min(d, dist[k - bw - 1] + 1.4142); if (x < bw - 1 && y > 0) d = Math.min(d, dist[k - bw + 1] + 1.4142);
    dist[k] = d;
  }
  for (let y = bh - 1; y >= 0; y--) for (let x = bw - 1; x >= 0; x--) {
    const k = y * bw + x; let d = dist[k];
    if (x < bw - 1) d = Math.min(d, dist[k + 1] + 1); if (y < bh - 1) d = Math.min(d, dist[k + bw] + 1);
    if (x < bw - 1 && y < bh - 1) d = Math.min(d, dist[k + bw + 1] + 1.4142); if (x > 0 && y < bh - 1) d = Math.min(d, dist[k + bw - 1] + 1.4142);
    dist[k] = d;
  }
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (dist[y * bw + x] <= pad) mask[(box.y0 + y) * w + box.x0 + x] = 1;
  return { mask, box, sel: q.length, share: q.length / (w * h), pad };
}

/** Whether `allow` has room for a few whole 7×7 patches (and a couple of hundred pixels) near the box. */
function roomIn(allow, w, h, box, pad) {
  const x0 = Math.max(3, box.x0 - pad); const y0 = Math.max(3, box.y0 - pad); const x1 = Math.min(w - 3, box.x1 + pad); const y1 = Math.min(h - 3, box.y1 + pad);
  let n = 0; let patches = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += allow[y * w + x];
  if (n < 200) return false;
  for (let y = y0; y < y1 && patches < 4; y += 2) for (let x = x0; x < x1 && patches < 4; x += 2) {
    if (!allow[y * w + x]) continue;
    let ok = true;
    for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3; dx++) if (!allow[(y + dy) * w + x + dx]) { ok = false; break; }
    if (ok) patches++;
  }
  return patches >= 4;
}

/** Whether (x, y) of the mask is on its edge (within 2 px of a pixel outside it). */
function rimOf(mask, w, h, x, y) {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const X = x + dx; const Y = y + dy;
    if (X >= 0 && Y >= 0 && X < w && Y < h && !mask[Y * w + X]) return true;
  }
  return false;
}

/**
 * The surface the removed area sits on, of what's left inside the trace (the can, not the wall a rough
 * trace takes in beside it): with `from` (shades the user tapped on it), the pixels near those
 * colors; otherwise the left-over pixels split into patches of like color, and those bordering the
 * removed area the most (and any of the same color) kept. A mask over w×h.
 */
export function surfaceOf(rgba, w, h, region, hole, from = null) {
  const left = new Uint8Array(w * h);
  let x0 = w; let y0 = h; let x1 = 0; let y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!region[i] || hole[i]) continue;
    left[i] = 1; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x >= x1) x1 = x + 1; if (y >= y1) y1 = y + 1;
  }
  if (x1 <= x0) return left;
  const lab = new Float32Array(w * h * 3);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; if (left[i]) lab.set(toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]), i * 3); }
  const dE = (i, c) => Math.sqrt((lab[i * 3] - c[0]) ** 2 * 0.6 + (lab[i * 3 + 1] - c[1]) ** 2 + (lab[i * 3 + 2] - c[2]) ** 2);
  const out = new Uint8Array(w * h);
  if (from?.length) {
    const cs = from.map(([r, g, b]) => toLab(r, g, b));
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; if (left[i] && cs.some((c) => dE(i, c) <= 22)) { out[i] = 1; n++; } }
    return n >= 200 ? out : left;
  }
  // Patches of like color (neighbours within a small step of each other).
  const seg = new Int32Array(w * h).fill(-1); const segs = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const s0 = y * w + x; if (!left[s0] || seg[s0] >= 0) continue;
    const id = segs.length; const px = [s0]; seg[s0] = id; const sum = [0, 0, 0]; let touch = 0;
    for (let head = 0; head < px.length; head++) {
      const i = px[head]; const X = i % w; const Y = (i / w) | 0;
      for (let c = 0; c < 3; c++) sum[c] += lab[i * 3 + c];
      let edge = false;
      for (const t of [X > 0 ? i - 1 : -1, X < w - 1 ? i + 1 : -1, Y > 0 ? i - w : -1, Y < h - 1 ? i + w : -1]) {
        if (t < 0) continue;
        if (hole[t]) { edge = true; continue; }
        if (!left[t] || seg[t] >= 0) continue;
        if (dE(t, [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]]) > 12) continue;
        seg[t] = id; px.push(t);
      }
      if (edge) touch++;
    }
    segs.push({ px, touch, mean: sum.map((v) => v / px.length) });
  }
  const top = Math.max(...segs.map((s) => s.touch));
  if (!top) return left;
  const lead = segs.filter((s) => s.touch === top)[0];
  let n = 0;
  for (const s of segs) {
    const like = Math.sqrt((s.mean[0] - lead.mean[0]) ** 2 * 0.6 + (s.mean[1] - lead.mean[1]) ** 2 + (s.mean[2] - lead.mean[2]) ** 2) < 14;
    if (s.touch > top * 0.6 || (like && s.touch > 0)) for (const i of s.px) { out[i] = 1; n++; }
  }
  return n >= 200 ? out : left;
}

/**
 * The filled area (`mask` over w×h, its box) given the grain of the surface it's filled from (`allow`,
 * around it) where it's smoother (a fill drawn from a coarse level can be): the surface's fine texture
 * (each pixel less the 3×3 around it), measured, and what's missing added as a seeded grain, alike in
 * each channel. In place on `img`.
 */
function matchGrain(img, w, h, mask, box, allow) {
  const pad = Math.max(8, Math.round(Math.max(box.x1 - box.x0, box.y1 - box.y0) / 3));
  const x0 = Math.max(1, box.x0 - pad); const y0 = Math.max(1, box.y0 - pad); const x1 = Math.min(w - 1, box.x1 + pad); const y1 = Math.min(h - 1, box.y1 + pad);
  const lum = (i) => 0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2];
  const fine = (x, y) => { const i = y * w + x; let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += lum(i + dy * w + dx); return Math.abs(lum(i) - s / 9); };
  const all3 = (m, x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!m[(y + dy) * w + x + dx]) return false; return true; };
  const tm = (d) => { if (d.length < 50) return NaN; d.sort((a, b) => a - b); const n = Math.floor(d.length * 0.97); let t = 0; for (let i = 0; i < n; i++) t += d[i]; return (1.25 * t) / n; };
  const sd = []; const fd = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (allow[y * w + x] && !mask[y * w + x] && all3(allow, x, y)) sd.push(fine(x, y));
    else if (mask[y * w + x] && all3(mask, x, y)) fd.push(fine(x, y));
  }
  const gs = tm(sd); const gf = tm(fd);
  if (!(gs > 0) || !(gf >= 0) || gf >= gs * 0.85) return;
  const noise = Math.sqrt(gs * gs - gf * gf);
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const i = y * w + x; if (!mask[i]) continue;
    let q = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77); q = Math.imul(q ^ (q >>> 15), 0x2c1b3c6d);
    const u1 = (((q >>> 0) % 65535) + 1) / 65536; q = Math.imul(q ^ (q >>> 13), 0x297a2d39); const u2 = (q >>> 0) / 4294967296;
    const n = noise * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    for (let c = 0; c < 3; c++) img[i * 4 + c] = Math.max(0, Math.min(255, img[i * 4 + c] + n));
  }
}

/**
 * Reverse Fill: the matched area (`mask`, `box`) removed and filled from what's left of the traced
 * `region` around it (the surface the label was on: the can, not what's behind the can), coarse to
 * fine, its light and color evened out with that surface. When too little of the surface is left to
 * copy from, from the picture around it as Clean Up does. Returns patch pixels, or null.
 */
export function reverseFill(rgba, w, h, mask, box, region, { from = null } = {}) {
  if (!box) return null;
  const g = grow(mask, w, h, box, 1);
  // The surface: what's left in the trace; when that's too thin to copy from (a loop drawn tight),
  // looked for a little farther out, still only the patches that border the area most.
  let rbox = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (region[y * w + x]) { if (!rbox) rbox = { x0: x, y0: y, x1: x + 1, y1: y + 1 }; else { rbox.x0 = Math.min(rbox.x0, x); rbox.x1 = Math.max(rbox.x1, x + 1); rbox.y1 = y + 1; } }
  if (!rbox) return null;
  let allow = null; let wide = false;
  for (const pad of [0, 6, 12, 24]) {
    const reg = pad ? grow(region, w, h, rbox, pad).mask : region;
    allow = surfaceOf(rgba, w, h, reg, g.mask, from);
    if (roomIn(allow, w, h, g.box, pad + 16)) { wide = pad > 0; break; }
    allow = null;
  }
  if (!allow) { const p = cleanUp(rgba, w, h, mask, box); return p && { ...p, wide: true }; }
  // The rim taken around the area stops where it reaches something else in the trace (the wall beside
  // the can): a rim pixel that looks like that stays as it is.
  for (let y = g.box.y0; y < g.box.y1; y++) for (let x = g.box.x0; x < g.box.x1; x++) {
    const i = y * w + x; if (!g.mask[i] || (mask[i] && !rimOf(mask, w, h, x, y))) continue;
    const c = toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const X = x + dx; const Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const j = Y * w + X; if (!region[j] || g.mask[j] || allow[j]) continue;
      const o = toLab(rgba[j * 4], rgba[j * 4 + 1], rgba[j * 4 + 2]);
      if (Math.sqrt((c[0] - o[0]) ** 2 * 0.6 + (c[1] - o[1]) ** 2 + (c[2] - o[2]) ** 2) < 20) { g.mask[i] = 0; dy = 3; break; }
    }
  }
  const R = Math.max(4, Math.ceil(Math.max(g.box.x1 - g.box.x0, g.box.y1 - g.box.y0) / 2));
  const done = complete(rgba, w, h, (x, y) => g.mask[y * w + x] === 1, g.box.x0, g.box.y0, g.box.x1, g.box.y1, R, null, { maxLevels: 6, minHole: 3, minSize: 24, forbid: (x, y) => !allow[y * w + x] });
  evenEdges(rgba, done, w, h, g.mask, g.box, allow);
  matchGrain(done, w, h, g.mask, g.box, allow);
  const p = patchOf(done, g.mask, w, h, g.box);
  return wide ? { ...p, wider: true } : p;
}
