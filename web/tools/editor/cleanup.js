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
function membrane(diff, free, bw, bh) {
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
 * smoothly across the fill. In place, on `img` (the picture with the fill in it).
 */
function evenEdges(orig, img, w, h, mask, box) {
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
      if (mask[Y * w + X]) { si[0] += img[o]; si[1] += img[o + 1]; si[2] += img[o + 2]; ni++; } else { so[0] += orig[o]; so[1] += orig[o + 1]; so[2] += orig[o + 2]; no++; }
    }
    if (no && ni) for (let c = 0; c < 3; c++) diff[k * 3 + c] = so[c] / no - si[c] / ni;
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
