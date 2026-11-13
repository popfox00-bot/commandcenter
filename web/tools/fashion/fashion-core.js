// @ts-check
// Fashion's workings (pure: no page, no canvas; tested on their own). A person's layout from the
// segmentation maps (their face, chin, waist, ankles), where each kind of piece is worn (a top from the
// chin to the waist, a hat on the head, shoes at the feet), the garment of that kind found there, the
// piece fitted onto the body (placed by the face, as big as the person; and with Fit, its rows bent onto
// the shape of what's worn there), its light matched to the photo, the photo's folds and shadows carried
// onto it (form), and the hair and face kept in front.

import { rgbToLab } from '../../lib/color-match.js';
import { boxBlur } from '../../lib/geometry.js';

/** The kinds of pieces: [id, icon, name]. */
export const KINDS = [
  ['top', '👕', 'Top'], ['jacket', '🧥', 'Jacket'], ['bottom', '👖', 'Pants · shorts'], ['dress', '👗', 'Dress'],
  ['hat', '🧢', 'Hat'], ['shoes', '👟', 'Shoes'], ['other', '✨', 'Other'],
];

/** @typedef {{ x0: number, y0: number, x1: number, y1: number }} Box */
/** @typedef {{ w: number, h: number, face: Uint8Array, hair: Uint8Array, body: Uint8Array, clothes: Uint8Array, others: Uint8Array }} People */
/** @typedef {{ face: Box|null, person: Box|null, fw: number, fh: number, chin: number, waist: number, ankle: number, split: boolean }} Layout */

/** The box of a mask's set pixels (at least `thr`), or null. @param {ArrayLike<number>} m @returns {Box|null} */
export function boxOf(m, w, h, thr = 1) {
  let x0 = w; let y0 = h; let x1 = 0; let y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x] >= thr) { if (x < x0) x0 = x; if (x >= x1) x1 = x + 1; if (y < y0) y0 = y; y1 = y + 1; }
  return x1 > x0 ? { x0, y0, x1, y1 } : null;
}

/** A map (mw × mh, 0..255) sampled up (or down) to w × h, smoothly. @returns {Uint8Array} */
export function resample(map, mw, mh, w, h) {
  if (mw === w && mh === h) return Uint8Array.from(map);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(mh - 1, ((y + 0.5) * mh) / h - 0.5)); const y0 = Math.floor(fy); const y1 = Math.min(mh - 1, y0 + 1); const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(mw - 1, ((x + 0.5) * mw) / w - 0.5)); const x0 = Math.floor(fx); const x1 = Math.min(mw - 1, x0 + 1); const tx = fx - x0;
      const a = map[y0 * mw + x0] * (1 - tx) + map[y0 * mw + x1] * tx; const b = map[y1 * mw + x0] * (1 - tx) + map[y1 * mw + x1] * tx;
      out[y * w + x] = Math.round(a * (1 - ty) + b * ty);
    }
  }
  return out;
}

/** All the maps of `p` brought to w × h. @param {People} p @returns {People} */
export function peopleAt(p, w, h) {
  /** @type {any} */ const out = { w, h };
  for (const k of ['face', 'hair', 'body', 'clothes', 'others']) out[k] = resample(p[k], p.w, p.h, w, h);
  return out;
}

/**
 * Where a person is in the picture (`p` at the picture's size; `rgba` its pixels, for the waist): their
 * face, the whole of them, and the rows of their chin, waist and ankles (worked out from the face's size
 * where there's nothing better: a waist about 2.6 faces below the chin, refined to where the color of
 * the clothes changes from a top's to a bottom's). Null when no person is found.
 * @param {People} p @param {Uint8ClampedArray|null} rgba @returns {Layout|null}
 */
export function bodyLayout(p, rgba = null) {
  const { w, h } = p;
  const any = new Uint8Array(w * h);
  // (Shoes and what's worn or carried count too: they're `others`.)
  for (let i = 0; i < w * h; i++) any[i] = Math.max(p.body[i], p.clothes[i], p.face[i], p.hair[i], p.others[i]);
  const person = boxOf(any, w, h, 128);
  if (!person) return null;
  const face = boxOf(p.face, w, h, 128);
  // Without a face (from the neck down): the person's height is about 6.5 faces.
  const fh = face ? face.y1 - face.y0 : (person.y1 - person.y0) / 6.5;
  const fw = face ? face.x1 - face.x0 : fh * 0.8;
  const chin = face ? face.y1 : person.y0;
  const ankle = Math.max(chin + fh * 2, person.y1 - fh * 0.55);
  const guess = Math.min(chin + fh * 2.6, (chin + ankle) / 2);
  const waist = rgba ? splitWaist(rgba, p, chin, fh, guess, ankle) : guess;
  // (`split`: the waist is where the clothes change color, so a top ends and a bottom starts right there.)
  return { face, person, fw, fh, chin, waist, ankle, split: waist !== guess };
}

/** The waist refined: the row where the clothes' color turns from the top's to the bottom's, if it does. */
function splitWaist(rgba, p, chin, fh, waist, ankle) {
  const { w, h } = p;
  const rowLab = (y) => {
    y = Math.round(y); if (y < 0 || y >= h) return null;
    const m = [0, 0, 0]; let n = 0;
    for (let x = 0; x < w; x += 2) {
      const i = y * w + x; if (p.clothes[i] < 128) continue;
      const c = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]); m[0] += c[0]; m[1] += c[1]; m[2] += c[2]; n++;
    }
    return n >= 4 ? m.map((v) => v / n) : null;
  };
  const avg = (ya, yb) => { const m = [0, 0, 0]; let n = 0; for (let y = ya; y < yb; y++) { const c = rowLab(y); if (c) { m[0] += c[0]; m[1] += c[1]; m[2] += c[2]; n++; } } return n ? m.map((v) => v / n) : null; };
  const top = avg(chin + fh * 0.6, chin + fh * 1.3);
  const bot = avg(Math.min(ankle - fh, waist + fh * 0.8), Math.min(ankle - fh * 0.5, waist + fh * 1.5));
  const d = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 * 0.6 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  if (!top || !bot || d(top, bot) < 12) return waist;
  let run = 0;
  for (let y = Math.round(chin + fh * 1.3); y < Math.min(ankle - fh * 0.5, chin + fh * 4); y++) {
    const c = rowLab(y); if (!c) { run = 0; continue; }
    if (d(c, bot) < d(c, top)) { if (++run >= 3) return y - 2; } else run = 0;
  }
  return waist;
}

/** Where a kind of piece is worn on a person (`L`), within w × h. @param {Layout} L @returns {Box} */
export function kindZone(kind, L, w, h) {
  const P = L.person ?? { x0: 0, y0: 0, x1: w, y1: h }; const { fh, fw, chin, waist, ankle } = L; const cut = L.split ? 0 : 1;
  // (A photo cut off at the chest or the waist: with no color change found, a top runs to its bottom edge.)
  const open = !L.split && P.y1 >= h - 3;
  const F = L.face ?? { x0: (P.x0 + P.x1) / 2 - fw / 2, y0: chin - fh, x1: (P.x0 + P.x1) / 2 + fw / 2, y1: chin };
  const z = {
    top: { x0: P.x0, y0: chin - fh * 0.1, x1: P.x1, y1: open ? h : waist + fh * 0.25 * cut },
    jacket: { x0: P.x0, y0: chin - fh * 0.15, x1: P.x1, y1: open ? h : waist + fh * (L.split ? 0.05 : 0.7) },
    bottom: { x0: P.x0, y0: waist - fh * 0.15 * cut, x1: P.x1, y1: ankle + fh * 0.2 },
    dress: { x0: P.x0, y0: chin - fh * 0.1, x1: P.x1, y1: open ? h : Math.min(ankle, waist + fh * 3) },
    hat: { x0: F.x0 - fw * 0.35, y0: F.y0 - fh * 1.0, x1: F.x1 + fw * 0.35, y1: F.y0 + fh * 0.35 },
    shoes: { x0: P.x0, y0: ankle - fh * 0.35, x1: P.x1, y1: P.y1 + fh * 0.1 },
  }[kind] ?? P;
  return { x0: Math.max(0, Math.floor(z.x0)), y0: Math.max(0, Math.floor(z.y0)), x1: Math.min(w, Math.ceil(z.x1)), y1: Math.min(h, Math.ceil(z.y1)) };
}

/**
 * The garment of that kind a person is wearing (`p` and `L` at the picture's size): what's clothes (or,
 * for a hat or shoes, clothes or other things worn) where that kind is worn, its main parts kept, holes
 * in it closed. { mask, box } or null when there's little there.
 * @param {People} p @param {Layout} L
 */
export function kindRegion(kind, p, L) {
  const { w, h } = p; const z = kindZone(kind, L, w, h);
  const m = new Uint8Array(w * h);
  for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) {
    const i = y * w + x;
    const worn = kind === 'hat' ? Math.max(p.others[i], p.clothes[i]) >= 128 && p.face[i] < 128
      : kind === 'shoes' ? p.others[i] >= 128
        : kind === 'other' ? Math.max(p.others[i], p.clothes[i]) >= 128
          : p.clothes[i] >= 128;
    if (worn) m[i] = 1;
  }
  // (Thin slivers taken off first: the soft edge of an arm or the background read as clothes.)
  openMask(m, w, h, z, Math.max(1, Math.round(L.fh / 60)));
  // (Shoes not told apart from the rest: what's at the very bottom of the person.)
  if (kind === 'shoes' && !m.some(Boolean)) for (let y = Math.max(z.y0, Math.floor(L.ankle)); y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) { const i = y * w + x; if (Math.max(p.clothes[i], p.body[i]) >= 128) m[i] = 1; }
  const kept = mainParts(m, w, h, z, 0.15);
  if (!kept) return null;
  fillHoles(kept.mask, w, h, kept.box, 0.3);
  if (kept.count < w * h * 0.003) return null;
  return { mask: kept.mask, box: kept.box };
}

/** The joined parts of a mask (within `box`) at least `frac` the size of the biggest. { mask, box, count } or null. */
export function mainParts(m, w, h, box, frac = 0.15) {
  const lab = new Int32Array(w * h); const parts = [];
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const s = y * w + x; if (!m[s] || lab[s]) continue;
    const id = parts.length + 1; const q = [s]; lab[s] = id;
    for (let k = 0; k < q.length; k++) {
      const i = q[k]; const X = i % w; const Y = (i / w) | 0;
      for (const t of [X > box.x0 ? i - 1 : -1, X < box.x1 - 1 ? i + 1 : -1, Y > box.y0 ? i - w : -1, Y < box.y1 - 1 ? i + w : -1]) if (t >= 0 && m[t] && !lab[t]) { lab[t] = id; q.push(t); }
    }
    parts.push(q.length);
  }
  if (!parts.length) return null;
  const big = Math.max(...parts); const keep = new Set(parts.map((n, i) => (n >= big * frac ? i + 1 : 0)).filter(Boolean));
  const mask = new Uint8Array(w * h); let count = 0;
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) { const i = y * w + x; if (keep.has(lab[i])) { mask[i] = 1; count++; } }
  const b = boxOf(mask, w, h);
  return b ? { mask, box: b, count } : null;
}

/** Holes in a mask (within `box`) closed: each part not set that doesn't reach the box's edge, if under `frac` of the set pixels. In place. */
export function fillHoles(m, w, h, box, frac = 0.3) {
  const bw = box.x1 - box.x0; const bh = box.y1 - box.y0; let set = 0;
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) set += m[y * w + x] ? 1 : 0;
  const seen = new Uint8Array(bw * bh); const limit = set * frac;
  for (let k0 = 0; k0 < bw * bh; k0++) {
    const i0 = (box.y0 + ((k0 / bw) | 0)) * w + box.x0 + (k0 % bw);
    if (seen[k0] || m[i0]) continue;
    const comp = [k0]; seen[k0] = 1; let open = false;
    for (let c = 0; c < comp.length; c++) {
      const k = comp[c]; const x = k % bw; const y = (k / bw) | 0;
      if (x === 0 || y === 0 || x === bw - 1 || y === bh - 1) open = true;
      for (const t of [x > 0 ? k - 1 : -1, x < bw - 1 ? k + 1 : -1, y > 0 ? k - bw : -1, y < bh - 1 ? k + bw : -1]) {
        if (t < 0 || seen[t]) continue;
        if (m[(box.y0 + ((t / bw) | 0)) * w + box.x0 + (t % bw)]) continue;
        seen[t] = 1; comp.push(t);
      }
    }
    if (!open && comp.length <= limit) for (const k of comp) m[(box.y0 + ((k / bw) | 0)) * w + box.x0 + (k % bw)] = 1;
  }
}

/**
 * Each row's span of a mask within its box: [left, right + 1] per row (−1, −1 when empty), each end
 * smoothed over a few rows (no jagged edges from a stray pixel). @returns {Float32Array} 2 per row
 */
export function rowSpans(m, w, box, smooth = 2) {
  const bh = box.y1 - box.y0; const raw = new Float32Array(bh * 2).fill(-1);
  for (let y = 0; y < bh; y++) {
    let l = -1; let r = -1;
    for (let x = box.x0; x < box.x1; x++) if (m[(box.y0 + y) * w + x]) { if (l < 0) l = x; r = x + 1; }
    raw[y * 2] = l; raw[y * 2 + 1] = r;
  }
  const out = Float32Array.from(raw);
  for (let y = 0; y < bh; y++) {
    if (raw[y * 2] < 0) continue;
    let sl = 0; let sr = 0; let n = 0;
    for (let d = -smooth; d <= smooth; d++) { const t = y + d; if (t < 0 || t >= bh || raw[t * 2] < 0) continue; sl += raw[t * 2]; sr += raw[t * 2 + 1]; n++; }
    out[y * 2] = sl / n; out[y * 2 + 1] = sr / n;
  }
  return out;
}

/**
 * Where the piece goes with nothing to fit it to (rigid): its box's top-left in the photo and its scale.
 * Both photos have a person: as big as that person is (by their faces), at the same place on the body.
 * Otherwise into where that kind is worn (`zone`), as wide as it (a hat or shoes at its bottom).
 * @param {Box} sbox the piece's box in its photo @param {Layout|null} from the piece photo's person
 * @param {Layout|null} to the base's person @param {Box|null} zone @returns {{ x0: number, y0: number, s: number }}
 */
export function rigidPlace(kind, sbox, from, to, zone, w, h) {
  const sbw = sbox.x1 - sbox.x0; const sbh = sbox.y1 - sbox.y0;
  if (from?.face && to?.face) {
    const s = (to.fw + to.fh) / (from.fw + from.fh);
    const fcx = (from.face.x0 + from.face.x1) / 2; const tcx = (to.face.x0 + to.face.x1) / 2;
    return { x0: tcx + (sbox.x0 - fcx) * s, y0: to.chin + (sbox.y0 - from.chin) * s, s };
  }
  if (zone) {
    const zw = zone.x1 - zone.x0; const zh = zone.y1 - zone.y0;
    const s = Math.min(zw / sbw, (kind === 'hat' || kind === 'shoes' ? 1.6 : 1.15) * zh / sbh);
    const x0 = (zone.x0 + zone.x1) / 2 - (sbw * s) / 2;
    const y0 = kind === 'hat' || kind === 'shoes' ? zone.y1 - sbh * s : zone.y0;
    return { x0, y0, s };
  }
  const s = Math.min((w * 0.6) / sbw, (h * 0.6) / sbh);
  return { x0: (w - sbw * s) / 2, y0: (h - sbh * s) / 2, s };
}

/**
 * The piece put on the photo: `src` (its photo's pixels, sw wide) where `alpha` (0..1, over its photo)
 * says, from its box `sbox`, placed rigidly by `place` and, with a `region` ({ box, spans } in the photo:
 * the garment it's fitted to) and `fit` (0..1), its height and each row's width bent that far onto the
 * region's (its rows stretched from the piece's own left and right to the region's). With `flip`, the
 * piece mirrored left to right (one shoe made the other). The layer's pixels over its box:
 * { x0, y0, pw, ph, rgba } (alpha in rgba), or null.
 * @param {Uint8ClampedArray} src @param {Float32Array} alpha @param {Box} sbox
 * @param {{ x0: number, y0: number, s: number }} place @param {{ box: Box, spans: Float32Array, openBottom?: boolean }|null} region
 */
export function renderPiece(src, alpha, sw, sh, sbox, place, region, fit, w, h, flip = false) {
  const sbw = sbox.x1 - sbox.x0; const sbh = sbox.y1 - sbox.y0;
  // (Its rows' ends smoothed over a few rows: each row stretched alike, no streaks across it.)
  const sspans = rowSpans(alpha, sw, sbox, Math.max(2, Math.round((sbox.y1 - sbox.y0) / 60)));
  const P = { x0: place.x0, y0: place.y0, x1: place.x0 + sbw * place.s, y1: place.y0 + sbh * place.s };
  const f = region ? Math.max(0, Math.min(1, fit)) : 0;
  const R = region?.box;
  // (What it's fitted to running off the bottom of the photo: its top fitted, its length its own.)
  const Y0 = R ? P.y0 + (R.y0 - P.y0) * f : P.y0;
  const Y1 = R && !region.openBottom ? P.y1 + (R.y1 - P.y1) * f : R ? Y0 + (P.y1 - P.y0) : P.y1;
  if (!(Y1 - Y0 > 1)) return null;
  const rows = [];
  let x0 = Infinity; let x1 = -Infinity;
  for (let y = Math.max(0, Math.floor(Y0)); y < Math.min(h, Math.ceil(Y1)); y++) {
    const v = (y + 0.5 - Y0) / (Y1 - Y0); const sy = sbox.y0 + v * sbh - 0.5;
    let sr = Math.max(0, Math.min(sbh - 1, Math.round(sy - sbox.y0)));
    // (A row of the piece with nothing in it: the nearest one with something, a couple of rows off at most.)
    if (sspans[sr * 2] < 0) { let k = -1; for (let d = 1; d <= 2 && k < 0; d++) for (const t of [sr - d, sr + d]) if (t >= 0 && t < sbh && sspans[t * 2] >= 0) { k = t; break; } if (k < 0) continue; sr = k; }
    const sl = sspans[sr * 2]; const sx1 = sspans[sr * 2 + 1];
    let tl = P.x0 + ((flip ? sbox.x1 - sx1 : sl - sbox.x0)) * place.s; let tr = P.x0 + ((flip ? sbox.x1 - sl : sx1 - sbox.x0)) * place.s;
    if (R && f > 0) {
      // (Eased in over the first rows of what it's fitted to, and out past its last: no line where it starts.)
      const ry = y - R.y0; const rh = R.y1 - R.y0; const ease = Math.max(3, rh * 0.08);
      const ryc = Math.max(0, Math.min(rh - 1, ry));
      if (region.spans[ryc * 2] >= 0) {
        const k = f * Math.max(0, Math.min(1, (ry + ease) / ease, (rh + ease - ry) / ease));
        tl += (region.spans[ryc * 2] - tl) * k; tr += (region.spans[ryc * 2 + 1] - tr) * k;
      }
    }
    if (!(tr - tl > 0.5)) continue;
    rows.push({ y, sy, sl, sx1, tl, tr });
    x0 = Math.min(x0, Math.floor(tl)); x1 = Math.max(x1, Math.ceil(tr));
  }
  if (!rows.length) return null;
  x0 = Math.max(0, x0); x1 = Math.min(w, x1);
  const oy = rows[0].y; const pw = x1 - x0; const ph = rows.at(-1).y - oy + 1;
  if (pw <= 0) return null;
  const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (const { y, sy, sl, sx1, tl, tr } of rows) {
    const yy = Math.max(0, Math.min(sh - 1.001, sy)); const ya = Math.floor(yy); const ty = yy - ya; const yb = Math.min(sh - 1, ya + 1);
    for (let x = Math.max(x0, Math.floor(tl)); x < Math.min(x1, Math.ceil(tr)); x++) {
      const u = flip ? (tr - x - 0.5) / (tr - tl) : (x + 0.5 - tl) / (tr - tl);
      const xx = Math.max(0, Math.min(sw - 1.001, sl + u * (sx1 - sl) - 0.5)); const xa = Math.floor(xx); const tx = xx - xa; const xb = Math.min(sw - 1, xa + 1);
      const wts = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty]; const idx = [ya * sw + xa, ya * sw + xb, yb * sw + xa, yb * sw + xb];
      let a = 0; for (let k = 0; k < 4; k++) a += alpha[idx[k]] * wts[k];
      // Edge coverage across the row's ends (no hard step where the rows were cut).
      a *= Math.min(1, x + 1 - tl, tr - x);
      if (a <= 0.004) continue;
      const o = ((y - oy) * pw + x - x0) * 4;
      for (let c = 0; c < 3; c++) {
        // Colors weighted by alpha (an edge pixel's color isn't pulled toward what's outside the piece).
        let s = 0; let ws = 0; for (let k = 0; k < 4; k++) { const wa = wts[k] * alpha[idx[k]]; s += src[idx[k] * 4 + c] * wa; ws += wa; }
        rgba[o + c] = ws > 0 ? s / ws : src[idx[0] * 4 + c];
      }
      rgba[o + 3] = Math.round(255 * Math.min(1, a));
    }
  }
  return { x0, y0: oy, pw, ph, rgba };
}

/**
 * The light of the piece's photo turned into the base's, from each photo's whites (the average of its
 * brightest 4%, past what's blown out: a wall, a highlight; what the light itself looks like there, whoever
 * is in it; two people's skin isn't the same color, so faces won't do): brightness 0.85 to 1.2, and a slight
 * color cast (each channel within 4% of that). So a white shirt stays white, lit as the base is.
 * (`pRef`, `bRef`: unused, kept for callers.) @returns {number[]} [r, g, b] gains
 */
export function lightGains(piece, pRef, base, bRef) {
  const whites = (px) => {
    const n = px.length / 4; const lum = new Float32Array(Math.ceil(n / 3)); let k = 0;
    for (let i = 0; i < n; i += 3) lum[k++] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    const sorted = Float32Array.from(lum.subarray(0, k)).sort();
    const lo = sorted[Math.floor(k * 0.96)]; const hi = Math.min(250, sorted[Math.floor(k * 0.995)]);
    const m = [0, 0, 0]; let c = 0;
    for (let i = 0, j = 0; i < n; i += 3, j++) { const L = lum[j]; if (L < lo || L > Math.max(hi, lo + 1)) continue; m[0] += px[i * 4]; m[1] += px[i * 4 + 1]; m[2] += px[i * 4 + 2]; c++; }
    return c ? m.map((v) => v / c) : [200, 200, 200];
  };
  const a = whites(piece); const b = whites(base);
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] + 4;
  const g = Math.max(0.85, Math.min(1.2, lum(b) / lum(a)));
  return [0, 1, 2].map((c) => g * Math.max(0.96, Math.min(1.04, ((b[c] + 4) / lum(b)) / ((a[c] + 4) / lum(a)))));
}

/**
 * The photo's form over a box: the broad light and shade of the body there (where it turns from the
 * light, the shadow under an arm, a deep fold) over its average, 0.72 to 1.22; the print, texture and
 * small edges of what's worn there smoothed away (`fine` px), and, with `ok` (a mask over the photo),
 * only the body counted (its edge against the background doesn't darken the piece). Multiplied into a
 * piece put there, it takes on the shape of the body without anything of what's beneath showing through.
 * @returns {Float32Array} box-sized
 */
export function formMap(rgba, w, box, fine = 4, coarse = 24, ok = null) {
  const bw = box.x1 - box.x0; const bh = box.y1 - box.y0;
  const L = new Float32Array(bw * bh); const okb = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const j = (box.y0 + y) * w + box.x0 + x; const i = j * 4;
    L[y * bw + x] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2] + 10;
    okb[y * bw + x] = !ok || ok[j] ? 1 : 0;
  }
  const a = boxBlur(L, okb, bw, bh, fine); const b = boxBlur(L, okb, bw, bh, coarse);
  const out = new Float32Array(bw * bh);
  for (let k = 0; k < bw * bh; k++) out[k] = okb[k] ? Math.max(0.72, Math.min(1.22, a[k] / b[k])) : 1;
  return out;
}

/**
 * The layer finished on the photo (in place on `layer`): its light matched (`gains` to the power `light`,
 * 0..1), the photo's form under it multiplied in (`form`: a formMap over `fbox`, to the power `formAmt`),
 * kept behind what's in front of it (`front`: 0..255 over the photo, e.g. hair and face), its edge
 * softened by `soft` px.
 */
export function finishLayer(layer, w, { gains = null, light = 0, form = null, fbox = null, formAmt = 0, front = null, soft = 0, depth = 0, round = 0 } = {}) {
  const { x0, y0, pw, ph, rgba } = layer;
  const g = gains ? gains.map((v) => v ** light) : [1, 1, 1];
  const fbw = fbox ? fbox.x1 - fbox.x0 : 0;
  if (soft >= 1) {
    const a = new Float32Array(pw * ph); for (let k = 0; k < pw * ph; k++) a[k] = rgba[k * 4 + 3];
    const r = Math.round(soft); const ok = new Uint8Array(pw * ph).fill(1);
    const b = boxBlur(a, ok, pw, ph, r);
    // Softened inward only (it doesn't grow past the piece's own edge).
    for (let k = 0; k < pw * ph; k++) rgba[k * 4 + 3] = Math.min(a[k], Math.max(0, 2 * b[k] - a[k] * 0.999));
  }
  // Depth (`depth` px): a soft shade just inside its edge, as cloth turns away from the light there.
  let near = null;
  if (depth >= 1) { const a = new Float32Array(pw * ph); for (let k = 0; k < pw * ph; k++) a[k] = rgba[k * 4 + 3] / 255; near = boxBlur(a, new Uint8Array(pw * ph).fill(1), pw, ph, Math.round(depth)); }
  // Roundness (`round`, 0..1): cloth wraps around a body or an arm, so each stretch of it across a row is
  // lit most in its middle and turns darker toward its sides (a cylinder's shading).
  let roundness = null;
  if (round > 0) {
    roundness = new Float32Array(pw * ph).fill(1);
    for (let y = 0; y < ph; y++) {
      let x = 0;
      while (x < pw) {
        while (x < pw && rgba[(y * pw + x) * 4 + 3] < 128) x++;
        const a = x; while (x < pw && rgba[(y * pw + x) * 4 + 3] >= 128) x++;
        const len = x - a; if (len < 6) continue;
        for (let i = a; i < x; i++) roundness[y * pw + i] = 1 - round * 0.14 * (1 - Math.sqrt(Math.sin((Math.PI * (i - a + 0.5)) / len)));
      }
    }
  }
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const o = (y * pw + x) * 4; if (!rgba[o + 3]) continue;
    const X = x0 + x; const Y = y0 + y;
    let s = near ? 1 - 0.1 * Math.max(0, 1 - near[y * pw + x]) : 1;
    if (roundness) s *= roundness[y * pw + x];
    if (form && fbox && formAmt > 0 && X >= fbox.x0 && X < fbox.x1 && Y >= fbox.y0 && Y < fbox.y1) s *= form[(Y - fbox.y0) * fbw + X - fbox.x0] ** formAmt;
    for (let c = 0; c < 3; c++) rgba[o + c] = rgba[o + c] * g[c] * s;
    if (front) rgba[o + 3] = Math.round(rgba[o + 3] * (1 - front[Y * w + X] / 255));
  }
  return layer;
}

/** The layer laid over the photo's pixels (in place on `rgba`, w wide). */
export function composite(rgba, w, h, layer) {
  const { x0, y0, pw, ph } = layer; const L = layer.rgba;
  for (let y = 0; y < ph; y++) {
    const Y = y0 + y; if (Y < 0 || Y >= h) continue;
    for (let x = 0; x < pw; x++) {
      const X = x0 + x; if (X < 0 || X >= w) continue;
      const o = (y * pw + x) * 4; const a = L[o + 3] / 255; if (!a) continue;
      const i = (Y * w + X) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = rgba[i + c] * (1 - a) + L[o + c] * a;
    }
  }
}

/** The part of a mask within columns [c0, c1) (or the whole of it), as { mask, box, count } or null. */
function partOf(m, w, h, box, keep) {
  const mask = new Uint8Array(w * h); let count = 0;
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) { const i = y * w + x; if (m[i] && keep(x, y)) { mask[i] = 1; count++; } }
  const b = count ? boxOf(mask, w, h) : null;
  return b ? { mask, box: b, count } : null;
}

/**
 * A top's body and its sleeves (the arms of a jacket, of a shirt): the body is the columns its narrower
 * lower rows span (below where the sleeves end), the sleeves what reaches past those on either side. { torso, left, right } (each { mask, box, count }; a side null when
 * there's little sleeve there), so each can be fitted to its own: a long sleeve onto an arm, the body onto
 * the body.
 */
export function splitSleeves(m, w, h, box) {
  const bh = box.y1 - box.y0;
  // Each lower row's extent (its leftmost to rightmost pixel: a zip or a gap down the middle doesn't split it).
  const ls = []; const rs = [];
  for (let y = Math.round(box.y0 + bh * 0.5); y < box.y1; y++) {
    let l = -1; let r = -1;
    for (let x = box.x0; x < box.x1; x++) if (m[y * w + x]) { if (l < 0) l = x; r = x; }
    if (l >= 0) { ls.push(l); rs.push(r + 1); }
  }
  const all = partOf(m, w, h, box, () => true);
  if (ls.length < 3 || !all) return { torso: all, left: null, right: null };
  // The body's columns: from its narrower rows (a fifth of the way up the widths): where the sleeves have
  // ended, or hang apart from it. (Sleeves touching it all the way down make the wider rows.)
  const order = ls.map((l, i) => i).sort((a, b) => (rs[a] - ls[a]) - (rs[b] - ls[b]));
  const pick = order.slice(0, Math.max(1, Math.ceil(order.length * 0.2)));
  const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
  // (With a little slack: a body that flares toward its hem isn't a sleeve.)
  const slack = Math.max(2, Math.round((box.x1 - box.x0) * 0.03));
  const t0 = med(pick.map((i) => ls[i])) - slack; const t1 = med(pick.map((i) => rs[i])) + slack;
  // Each side's sleeve: its biggest joined part (not a sliver of the body's edge lower down).
  const side = (keep) => { const p = partOf(m, w, h, box, keep); if (!p) return null; const k = mainParts(p.mask, w, h, p.box, 1); return k && { mask: k.mask, box: k.box, count: k.count }; };
  const left = side((x) => x < t0); const right = side((x) => x >= t1);
  const big = (p) => p && p.count >= all.count * 0.03 && p.box.y1 - p.box.y0 >= bh * 0.15;
  const L = big(left) ? left : null; const R = big(right) ? right : null;
  const torso = partOf(m, w, h, box, (x, y) => !(L && L.mask[y * w + x]) && !(R && R.mask[y * w + x]));
  return { torso: torso ?? all, left: L, right: R };
}

/** A pair (shoes, earrings): its two biggest parts, left first, or one (or none) if that's all there is. */
export function splitPair(m, w, h, box) {
  const lab = new Int32Array(w * h); const parts = [];
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const s0 = y * w + x; if (!m[s0] || lab[s0]) continue;
    const id = parts.length + 1; const q = [s0]; lab[s0] = id;
    for (let k = 0; k < q.length; k++) {
      const i = q[k]; const X = i % w; const Y = (i / w) | 0;
      for (const t of [X > box.x0 ? i - 1 : -1, X < box.x1 - 1 ? i + 1 : -1, Y > box.y0 ? i - w : -1, Y < box.y1 - 1 ? i + w : -1]) if (t >= 0 && m[t] && !lab[t]) { lab[t] = id; q.push(t); }
    }
    parts.push({ id, n: q.length });
  }
  parts.sort((a, b) => b.n - a.n);
  const keep = parts.slice(0, 2).filter((p, i) => i === 0 || p.n >= parts[0].n * 0.3);
  return keep.map((p) => partOf(lab, w, h, box, (x, y) => lab[y * w + x] === p.id)).filter(Boolean).sort((a, b) => a.box.x0 - b.box.x0);
}

/**
 * Hands and arms that are in front of the body (crossed, on the hips, holding something): the photo's
 * bare skin (not the face) below the chest and within the body's columns [c0, c1). 0..255 over w × h.
 * @param {People} p @param {Layout} L
 */
export function armsInFront(p, L, c0, c1, from = 1.1) {
  const { w, h } = p; const out = new Uint8Array(w * h);
  // (From just below the neckline (`from` faces below the chin): higher up, bare skin is the neckline, which
  // a top covers.)
  const y0 = Math.max(0, Math.round(L.chin + L.fh * from));
  for (let y = y0; y < h; y++) for (let x = Math.max(0, Math.round(c0)); x < Math.min(w, Math.round(c1)); x++) {
    const i = y * w + x; if (p.face[i] < 128) out[i] = p.body[i];
  }
  return out;
}

/** A layout at k times the size. @param {Layout} L @returns {Layout} */
export function scaleLayout(L, k) {
  const sb = (b) => b && { x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k };
  return { ...L, face: sb(L.face), person: sb(L.person), fw: L.fw * k, fh: L.fh * k, chin: L.chin * k, waist: L.waist * k, ankle: L.ankle * k };
}

/** Layers ({ x0, y0, pw, ph, rgba }) laid into one, later over earlier. */
export function mergeLayers(layers) {
  const ls = layers.filter(Boolean); if (ls.length < 2) return ls[0] ?? null;
  const x0 = Math.min(...ls.map((l) => l.x0)); const y0 = Math.min(...ls.map((l) => l.y0));
  const x1 = Math.max(...ls.map((l) => l.x0 + l.pw)); const y1 = Math.max(...ls.map((l) => l.y0 + l.ph));
  const pw = x1 - x0; const ph = y1 - y0; const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (const l of ls) for (let y = 0; y < l.ph; y++) for (let x = 0; x < l.pw; x++) {
    const o = (y * l.pw + x) * 4; const a = l.rgba[o + 3] / 255; if (!a) continue;
    const t = ((l.y0 - y0 + y) * pw + l.x0 - x0 + x) * 4; const b = rgba[t + 3] / 255; const ao = a + b * (1 - a);
    for (let c = 0; c < 3; c++) rgba[t + c] = (l.rgba[o + c] * a + rgba[t + c] * b * (1 - a)) / ao;
    rgba[t + 3] = Math.round(ao * 255);
  }
  return { x0, y0, pw, ph, rgba };
}

/**
 * A mask (within `box`) with what's thinner than 2r + 1 px taken off (an opening: shrunk by r, then grown
 * back by r, square). In place.
 */
export function openMask(m, w, h, box, r) {
  if (r < 1) return;
  const bw = box.x1 - box.x0; const bh = box.y1 - box.y0; if (bw <= 0 || bh <= 0) return;
  const pass = (src, op, horiz) => {
    const out = new Uint8Array(bw * bh);
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      let v = op === 'min' ? 1 : 0;
      for (let d = -r; d <= r; d++) {
        const ii = horiz ? i + d : i; const jj = horiz ? j : j + d;
        const s0 = ii < 0 || jj < 0 || ii >= bw || jj >= bh ? 0 : src[jj * bw + ii];
        if (op === 'min' ? !s0 : s0) { v = op === 'min' ? 0 : 1; break; }
      }
      out[j * bw + i] = v;
    }
    return out;
  };
  let a = new Uint8Array(bw * bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) a[j * bw + i] = m[(box.y0 + j) * w + box.x0 + i] ? 1 : 0;
  a = pass(pass(a, 'min', true), 'min', false);
  a = pass(pass(a, 'max', true), 'max', false);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) m[(box.y0 + j) * w + box.x0 + i] = a[j * bw + i];
}

/** A mask (within `box`) with gaps narrower than 2r + 1 px closed (grown by r, then shrunk back). In place. */
export function closeMask(m, w, h, box, r) {
  if (r < 1) return;
  const b = { x0: Math.max(0, box.x0 - r), y0: Math.max(0, box.y0 - r), x1: Math.min(w, box.x1 + r), y1: Math.min(h, box.y1 + r) };
  const bw = b.x1 - b.x0; const bh = b.y1 - b.y0;
  const pass = (src, grow, horiz) => {
    const out = new Uint8Array(bw * bh);
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      let v = grow ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const ii = horiz ? i + d : i; const jj = horiz ? j : j + d;
        const s0 = ii < 0 || jj < 0 || ii >= bw || jj >= bh ? (grow ? 0 : 1) : src[jj * bw + ii];
        if (grow ? s0 : !s0) { v = grow ? 1 : 0; break; }
      }
      out[j * bw + i] = v;
    }
    return out;
  };
  let a = new Uint8Array(bw * bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) a[j * bw + i] = m[(b.y0 + j) * w + b.x0 + i] ? 1 : 0;
  a = pass(pass(a, true, true), true, false);
  a = pass(pass(a, false, true), false, false);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) if (a[j * bw + i]) m[(b.y0 + j) * w + b.x0 + i] = 1;
}

/**
 * A piece made solid: cloth isn't see-through, so the specks and small gaps a color pick leaves (its
 * texture, a fold's shadow, its print) are closed, and holes inside it filled (up to half its size; the
 * space between an arm and the body reaches its edge, so it stays). A new mask.
 */
export function solidify(sel, w, h, box) {
  const m = Uint8Array.from(sel);
  const size = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  closeMask(m, w, h, box, Math.max(1, Math.round(size / 80)));
  const b = boxOf(m, w, h) ?? box;
  fillHoles(m, w, h, b, 0.5);
  return m;
}

/**
 * The outline of the person's body where a kind of piece is worn (`p`, `L` at the photo's size): body and
 * clothes (and, for shoes, what's on the feet), not the face or hair, its slivers taken off and its holes
 * closed. What a piece is fitted to when nothing's worn there to fit it to, and what sets its size.
 * { mask, box } or null.
 * @param {People} p @param {Layout} L
 */
export function bodyRegion(kind, p, L) {
  const { w, h } = p; const z = kindZone(kind, L, w, h);
  const m = new Uint8Array(w * h);
  for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) {
    const i = y * w + x;
    const on = kind === 'hat' ? Math.max(p.hair[i], p.face[i], p.others[i]) >= 128
      : kind === 'shoes' ? Math.max(p.others[i], p.body[i], p.clothes[i]) >= 128
        : Math.max(p.body[i], p.clothes[i]) >= 128 && p.face[i] < 128 && p.hair[i] < 128;
    if (on) m[i] = 1;
  }
  openMask(m, w, h, z, Math.max(1, Math.round(L.fh / 40)));
  const k = mainParts(m, w, h, z, 0.15);
  if (!k) return null;
  fillHoles(k.mask, w, h, k.box, 0.3);
  return { mask: k.mask, box: k.box };
}

/**
 * Where the piece goes, by the body: as wide as what it goes on (its body to the body, not counting
 * sleeves: a top's body as wide as the torso it goes on, Overlay a little wider), standing at its top (a
 * top at the shoulders, a bottom at the waist), centered on it; a hat as wide as the head, sitting on it.
 * `pb` / `pt`: the piece's box and its body's (a top's, without sleeves); `tb` / `tt`: the same of what it
 * goes on. { x0, y0, s }.
 */
export function bodyPlace(kind, pb, pt, tb, tt, mode = 'replace') {
  const wide = mode === 'overlay' ? 1.05 : 1;
  const W = (b) => b.x1 - b.x0;
  if (kind === 'hat') {
    const s = (W(tb) * 1.12) / W(pb);
    return { x0: (tb.x0 + tb.x1) / 2 - (W(pb) * s) / 2, y0: tb.y0 + (tb.y1 - tb.y0) * 0.38 - (pb.y1 - pb.y0) * s, s };
  }
  const s = (W(tt) * wide) / W(pt);
  const cx = (tt.x0 + tt.x1) / 2;
  return { x0: cx - ((pt.x0 + pt.x1) / 2 - pb.x0) * s, y0: tt.y0 - (pt.y0 - pb.y0) * s - (wide - 1) * (tt.y1 - tt.y0) * 0.1, s };
}

/**
 * A garment's width across a band of rows (its median extent, row by row: leftmost to rightmost pixel) and
 * the middle of it: across the chest for a top, the hips for a bottom. { w, cx } or null.
 */
export function bandWidth(m, w, box, y0, y1) {
  const ws = []; const cs = [];
  for (let y = Math.max(box.y0, Math.round(y0)); y < Math.min(box.y1, Math.round(y1)); y++) {
    let l = -1; let r = -1;
    for (let x = box.x0; x < box.x1; x++) if (m[y * w + x]) { if (l < 0) l = x; r = x + 1; }
    if (l >= 0) { ws.push(r - l); cs.push((l + r) / 2); }
  }
  if (ws.length < 3) return null;
  const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
  return { w: med(ws), cx: med(cs) };
}

/** The rows a kind's width is read across: the chest (just below the shoulders) for a top, the hips for a bottom. */
export function bandRows(kind, box, L) {
  const bh = box.y1 - box.y0;
  if (kind === 'bottom') return [box.y0 + bh * 0.04, box.y0 + bh * 0.18];
  if (L?.face) return [Math.max(box.y0, L.chin + L.fh * 0.45), Math.max(box.y0 + 3, L.chin + L.fh * 0.85)];
  return [box.y0 + bh * 0.1, box.y0 + bh * 0.25];
}

/**
 * Where a garment goes on the body, and how big: as wide across the chest (or hips) as what it goes on,
 * checked against the two people's faces (the same body, at the size each photo shows it): when the
 * widths and the faces agree, between the two; when they don't (an arm hiding a shirt's side), the faces.
 * Centered on it; with both faces, at the same height under the chin; otherwise at its top.
 * `pm` / `tm`: the piece's and the target's masks (pw, tw wide), `pb` / `tb` their boxes, `pL` / `tL` the
 * two people's layouts. { x0, y0, s } or null.
 */
export function garmentPlace(kind, pm, pw, pb, pL, tm, tw, tb, tL, mode = 'replace') {
  const [py0, py1] = bandRows(kind, pb, pL); const [ty0, ty1] = bandRows(kind, tb, tL);
  const pbw = bandWidth(pm, pw, pb, py0, py1); const tbw = bandWidth(tm, tw, tb, ty0, ty1);
  const byWidth = pbw && tbw ? tbw.w / pbw.w : null;
  const byFace = pL?.face && tL?.face ? (tL.fw + tL.fh) / (pL.fw + pL.fh) : null;
  let s = byWidth && byFace ? (Math.abs(Math.log(byWidth / byFace)) < 0.22 ? Math.sqrt(byWidth * byFace) : byFace) : byWidth ?? byFace;
  if (!s) return null;
  if (mode === 'overlay') s *= 1.04;
  const pcx = pbw?.cx ?? (pb.x0 + pb.x1) / 2; const tcx = tbw?.cx ?? (tb.x0 + tb.x1) / 2;
  const y0 = pL?.face && tL?.face && kind !== 'bottom' ? tL.chin + (pb.y0 - pL.chin) * s : tb.y0 - (mode === 'overlay' ? (tb.y1 - tb.y0) * 0.01 : 0);
  return { x0: tcx - (pcx - pb.x0) * s, y0, s };
}
