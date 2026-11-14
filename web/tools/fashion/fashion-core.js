// @ts-check
// Fashion's workings (pure: no page, no canvas; tested on their own). A person's layout from the
// segmentation maps (their face, chin, waist, ankles), where each kind of piece is worn (a top from the
// chin to the waist, a hat on the head, shoes at the feet), the garment of that kind found there, the
// piece fitted onto the body (placed by the face, as big as the person; and with Fit, its rows bent onto
// the shape of what's worn there), its light matched to the photo, the photo's folds and shadows carried
// onto it (form), and the hair and face kept in front.

import { rgbToLab } from '../../lib/color-match.js';
import { boxBlur } from '../../lib/geometry.js';
import { membrane } from '../editor/cleanup.js';

/** The kinds of pieces: [id, icon, name]. */
export const KINDS = [
  ['top', '👕', 'Top'], ['jacket', '🧥', 'Jacket'], ['bottom', '👖', 'Pants · shorts'], ['dress', '👗', 'Dress'],
  ['hat', '🧢', 'Hat'], ['shoes', '👟', 'Shoes'], ['other', '✨', 'Other'],
];
/**
 * Body zones: all of a part of the body at once, its clothes and its skin (a shirt with the vest over it
 * and the necklace on it, and the bare arms, shoulders or legs): [id, icon, name].
 */
export const ZONES = [['upper', '🧍', 'Upper body'], ['lower', '🦵', 'Lower body'], ['outfit', '🧍‍♀️', 'Whole outfit']];
/** Whether a kind is a body zone. */
export const isZone = (kind) => ZONES.some((z) => z[0] === kind);

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
  // (Cut off: the person reaches the bottom edge and there's little of them below the chin, an upper body
  // only; a long dress touching the bottom edge isn't that.)
  const open = !L.split && P.y1 >= h - 3 && P.y1 - chin < fh * 4.5;
  const F = L.face ?? { x0: (P.x0 + P.x1) / 2 - fw / 2, y0: chin - fh, x1: (P.x0 + P.x1) / 2 + fw / 2, y1: chin };
  const z = {
    top: { x0: P.x0, y0: chin - fh * 0.1, x1: P.x1, y1: open ? h : waist + fh * 0.25 * cut },
    jacket: { x0: P.x0, y0: chin - fh * 0.15, x1: P.x1, y1: open ? h : waist + fh * (L.split ? 0.05 : 0.7) },
    bottom: { x0: P.x0, y0: waist - fh * 0.15 * cut, x1: P.x1, y1: ankle + fh * 0.2 },
    // (A dress: to its hem, a gown's to the feet; only clothes are taken, so not the legs or shoes.)
    dress: { x0: P.x0, y0: chin - fh * 0.1, x1: P.x1, y1: open ? h : Math.max(waist + fh * 1.5, Math.min(P.y1, ankle + fh * 0.3)) },
    hat: { x0: F.x0 - fw * 0.35, y0: F.y0 - fh * 1.0, x1: F.x1 + fw * 0.35, y1: F.y0 + fh * 0.35 },
    shoes: { x0: P.x0, y0: ankle - fh * 0.35, x1: P.x1, y1: P.y1 + fh * 0.1 },
    // Body zones: from the chin to the waist (the shoulders and neck in it), the waist to the ankles, the chin down.
    upper: { x0: P.x0, y0: chin, x1: P.x1, y1: open ? h : waist + fh * 0.15 * cut },
    lower: { x0: P.x0, y0: waist - fh * 0.1 * cut, x1: P.x1, y1: P.y1 },
    outfit: { x0: P.x0, y0: chin, x1: P.x1, y1: P.y1 },
  }[kind] ?? P;
  return { x0: Math.max(0, Math.floor(z.x0)), y0: Math.max(0, Math.floor(z.y0)), x1: Math.min(w, Math.ceil(z.x1)), y1: Math.min(h, Math.ceil(z.y1)) };
}

/**
 * The garment of that kind a person is wearing (`p` and `L` at the picture's size): what's clothes (or,
 * for a hat or shoes, clothes or other things worn) where that kind is worn, its main parts kept, holes
 * in it closed. { mask, box } or null when there's little there.
 * @param {People} p @param {Layout} L
 */
export function kindRegion(kind, p, L, pose = null) {
  const { w, h } = p; const z = kindZone(kind, L, w, h);
  if (isZone(kind)) return zoneRegion(kind, p, L, z, pose);
  const m = new Uint8Array(w * h);
  for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) {
    const i = y * w + x;
    // (A body zone: all of the body there, its clothes and its bare skin (arms, shoulders, legs), all but the face and hair.)
    const worn = isZone(kind) ? Math.max(p.others[i], p.clothes[i], p.body[i]) >= 128 && p.face[i] < 128 && p.hair[i] < 128
      : kind === 'hat' ? Math.max(p.others[i], p.clothes[i]) >= 128 && p.face[i] < 128
      : kind === 'shoes' ? p.others[i] >= 128
        : kind === 'other' ? Math.max(p.others[i], p.clothes[i]) >= 128
          : p.clothes[i] >= 128;
    if (worn) m[i] = 1;
  }
  // (Thin slivers taken off first: the soft edge of an arm or the background read as clothes.)
  openMask(m, w, h, z, Math.max(1, Math.round(L.fh / 60)));
  // (Shoes not told apart from the rest: what's at the very bottom of the person.)
  if (kind === 'shoes' && !m.some(Boolean)) for (let y = Math.max(z.y0, Math.floor(L.ankle)); y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) { const i = y * w + x; if (Math.max(p.clothes[i], p.body[i]) >= 128) m[i] = 1; }
  // (A zone's arm can be parted from its body by the hair over the shoulder: smaller parts kept.)
  const kept = mainParts(m, w, h, z, isZone(kind) ? 0.05 : 0.15);
  if (!kept) return null;
  // (Thin cracks closed first, a fold's shadow the finder wasn't sure was cloth: one reaching its edge
  // isn't a hole, and would show what was worn through the new piece as specks.)
  if (!['shoes', 'hat'].includes(kind)) closeMask(kept.mask, w, h, kept.box, Math.max(1, Math.round(L.fh / 30)));
  fillHoles(kept.mask, w, h, kept.box, 0.3);
  // (A zone's holes filled only with what's on the person: not the background seen through the loop of
  // an arm with its hand on a hip.)
  if (isZone(kind)) for (let i = 0; i < w * h; i++) if (kept.mask[i] && Math.max(p.body[i], p.clothes[i], p.others[i], p.hair[i]) < 64) kept.mask[i] = 0;
  if (kept.count < w * h * 0.003) return null;
  return { mask: kept.mask, box: kept.box };
}

/**
 * A body zone's outline: all of the person in it, whatever they're wearing there, as one clean outline:
 * their clothes, their bare skin, and the hair lying over them (on the shoulders, down the chest: within
 * the body's own width, row by row, and out to their shoulders where the pose found them, hair hiding a
 * shoulder's edge), never the face, nor the background beside them or seen through the loop of an arm.
 * Its edge smoothed. { mask, box } or null.
 * @param {People} p @param {Layout} L @param {Box} z @param {any} pose
 */
function zoneRegion(kind, p, L, z, pose) {
  const { w, h } = p; const m = new Uint8Array(w * h);
  // The waist by the body, not by where the clothes change color (a satin dress's shading isn't a waist):
  // with the hips found, about a third of the way from them up to the shoulders; else by the person's
  // proportions (a quarter of the way from the chin to the ankles), or the face's size, the lower.
  const seen0 = (q) => q && q[2] >= 0.3;
  const P = L.person ?? { x0: 0, y0: 0, x1: w, y1: h };
  const cutOff = P.y1 >= h - 3 && P.y1 - L.chin < L.fh * 4.5;
  if (!cutOff && kind !== 'outfit') {
    let waist;
    if (pose && seen0(pose.hips[0]) && seen0(pose.hips[1]) && seen0(pose.shoulders[0]) && seen0(pose.shoulders[1])) {
      const hy = (pose.hips[0][1] + pose.hips[1][1]) / 2; const sy = (pose.shoulders[0][1] + pose.shoulders[1][1]) / 2;
      waist = hy > sy ? hy - (hy - sy) * 0.3 : null;
    }
    waist ??= Math.max(L.chin + L.fh * 2.6, L.chin + (L.ankle - L.chin) * 0.29);
    waist = Math.round(Math.min(h, waist));
    z = kind === 'upper' ? { ...z, y1: Math.max(z.y0 + 1, waist) } : { ...z, y0: Math.min(z.y1 - 1, waist) };
  }
  // (Shoes are a piece of their own: not part of the lower body or the outfit.)
  const feet = kind === 'upper' ? Infinity : L.ankle - L.fh * 0.4;
  const on = (i, y) => Math.max(p.body[i], p.clothes[i], p.others[i]) >= 128 && p.face[i] < 128 && !(y > feet && p.others[i] >= 128 && p.others[i] >= p.clothes[i]);
  for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) { const i = y * w + x; if (on(i, y) && p.hair[i] < 128) m[i] = 1; }
  openMask(m, w, h, z, Math.max(1, Math.round(L.fh / 60)));
  // Each row's ends (of what isn't hair); near the shoulders, the widest a little way below too (a shoulder
  // hidden by hair is seen lower down, as the arm), and the shoulders the pose found.
  const zh = z.y1 - z.y0; const ends = new Int32Array(zh * 2).fill(-1);
  for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) if (m[y * w + x]) { const k = (y - z.y0) * 2; if (ends[k] < 0) ends[k] = x; ends[k + 1] = x; }
  const seen = (q) => q && q[2] >= 0.3;
  const sh = pose && seen(pose.shoulders[0]) && seen(pose.shoulders[1]) ? pose.shoulders : null;
  const swd = sh ? Math.abs(sh[1][0] - sh[0][0]) : 0; const shY = sh ? (sh[0][1] + sh[1][1]) / 2 : L.chin + L.fh * 0.5;
  const reach = Math.round(L.fh * 0.6);
  for (let y = z.y0; y < z.y1; y++) {
    let l = ends[(y - z.y0) * 2]; let r = ends[(y - z.y0) * 2 + 1];
    // (Above the shoulders, only the neck itself: not the hair either side of it.)
    // (Tapered: the width found lower down drawn in a pixel for each row up, so a shoulder rounds toward
    // the neck instead of a square corner.)
    if (y >= shY - L.fh * 0.1 && y < shY + L.fh * 0.8) for (let yy = y; yy < Math.min(z.y1, y + reach); yy++) { const a = ends[(yy - z.y0) * 2]; if (a >= 0) { const d = yy - y; l = l < 0 ? a + d : Math.min(l, a + d); r = Math.max(r, ends[(yy - z.y0) * 2 + 1] - d); } }
    if (sh && y >= shY - L.fh * 0.15 && y < shY + L.fh * 0.8) for (const [k2, q] of sh.entries()) {
      // (Only a shoulder on this person: a pose's shoulder can land on the one beside them.)
      const X = Math.round(q[0]); const Y = Math.round(q[1]); if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const qi = Y * w + X; if (Math.max(p.body[qi], p.clothes[qi], p.hair[qi], p.others[qi]) < 128) continue;
      const d = Math.max(0, Math.round(shY - y));
      if (k2 === 0) { const e = Math.round(q[0] - swd * 0.06) + d; l = l < 0 ? e : Math.min(l, e); } else r = Math.max(r, Math.round(q[0] + swd * 0.06) - d);
    }
    if (l < 0) continue;
    // (Hair, or anything of the person, between the ends: theirs.)
    for (let x = Math.max(z.x0, l); x <= Math.min(z.x1 - 1, r); x++) { const i = y * w + x; if (!m[i] && p.face[i] < 128 && Math.max(p.hair[i], p.body[i], p.clothes[i], p.others[i]) >= 128) m[i] = 1; }
  }
  // Smoothed: small notches closed, specks off; one body (and what's joined to it), its holes closed.
  const r1 = Math.max(1, Math.round(L.fh / 22));
  closeMask(m, w, h, z, r1);
  openMask(m, w, h, z, Math.max(1, Math.round(L.fh / 40)));
  const kept = mainParts(m, w, h, z, 0.05);
  if (!kept) return null;
  fillHoles(kept.mask, w, h, kept.box, 0.3);
  // (Never the background: what closing bridged between an arm and the side, the loop of an arm.)
  for (let i = 0; i < w * h; i++) if (kept.mask[i] && (Math.max(p.body[i], p.clothes[i], p.others[i], p.hair[i]) < 64 || ((i / w) > feet && p.others[i] >= 128 && p.others[i] >= p.clothes[i]))) kept.mask[i] = 0;
  let n = 0; for (let i = 0; i < w * h; i++) n += kept.mask[i];
  if (n < w * h * 0.003) return null;
  const b = boxOf(kept.mask, w, h);
  return b && { mask: kept.mask, box: b };
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
  if (kind === 'bottom' || kind === 'lower') return [box.y0 + bh * 0.04, box.y0 + bh * 0.18];
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
export function garmentPlace(kind, pm, pw, pb, pL, tm, tw, tb, tL, mode = 'replace', { ph = Infinity, th = Infinity } = {}) {
  const [py0, py1] = bandRows(kind, pb, pL); const [ty0, ty1] = bandRows(kind, tb, tL);
  const pbw = bandWidth(pm, pw, pb, py0, py1); const tbw = bandWidth(tm, tw, tb, ty0, ty1);
  const byWidth = pbw && tbw ? tbw.w / pbw.w : null;
  // (A face counts only when it's whole: not cut off by the photo's edge, and face-shaped. A photo zoomed in
  // on the shirt cuts off part of the face, which then looks smaller than it is.)
  const whole = (L, W, H) => !!L?.face && L.face.x0 > 2 && L.face.y0 > 2 && L.face.x1 < W - 2 && L.face.y1 < H - 2 && L.fh / L.fw > 1 && L.fh / L.fw < 1.9;
  const byFace = whole(pL, pw, ph) && whole(tL, tw, th) ? (tL.fw + tL.fh) / (pL.fw + pL.fh) : null;
  // When the two agree, between them; when they don't, the garments' own widths.
  let s = byWidth && byFace ? (Math.abs(Math.log(byWidth / byFace)) < 0.22 ? Math.sqrt(byWidth * byFace) : byWidth) : byWidth ?? byFace;
  if (!s) return null;
  if (mode === 'overlay') s *= 1.04;
  const pcx = pbw?.cx ?? (pb.x0 + pb.x1) / 2; const tcx = tbw?.cx ?? (tb.x0 + tb.x1) / 2;
  // (At the same height under the chin when both chins are seen; otherwise its top at the top of what it goes on.)
  const chinSeen = (L, H) => !!L?.face && L.face.y1 < H - 2;
  const y0 = chinSeen(pL, ph) && chinSeen(tL, th) && kind !== 'bottom' && kind !== 'lower' ? tL.chin + (pb.y0 - pL.chin) * s : tb.y0 - (mode === 'overlay' ? (tb.y1 - tb.y0) * 0.01 : 0);
  return { x0: tcx - (pcx - pb.x0) * s, y0, s };
}

/**
 * The piece's design laid into the outline of what's worn on the base (Replace): the new garment takes
 * exactly the shape the base's own garment has on this body, in this pose, and the piece supplies what it
 * looks like. Each row of the outline, from its left edge to its right, takes the matching row of the
 * piece, from its left edge to its right (rows matched top to bottom; when either photo cuts the garment
 * off, row for row at the piece's scale `s`); where the piece has a gap inside a row (its neckline, the
 * space by an arm) the cloth on either side carries across it. `tex`: the piece's pixels (pw × ph), `pm` its
 * mask, `pb` its box; `target`: { mask, box, spans }. `adj`: { scale, wide, long, dx, dy } to move or size
 * the design within the outline; `skin`: the piece's photo's bare-skin map (0..255), to mark where it shows
 * skin; `rebuilt`: what was rebuilt of it (under its hair). A layer { x0, y0, pw, ph, rgba, skin } whose alpha is
 * the outline's (`skin`: 1 where it isn't cloth seen in the piece's photo: its skin, a gap, what was rebuilt;
 * `bare`: 1 where it's the piece's bare skin itself).
 */
export function traceTransfer(tex, pm, pw, ph, pb, target, w, h, { s = 1, open = false, adj = null, skin = null, rebuilt = null } = {}) {
  const T = target.box; const tw = T.x1 - T.x0; const th = T.y1 - T.y0;
  const pbh = pb.y1 - pb.y0; const pbw = pb.x1 - pb.x0;
  const pspans = rowSpans(pm, pw, pb, Math.max(4, Math.round(pbh / 16)));
  // The piece filled across its gaps once: each row, between its ends, the cloth on either side of a gap
  // carried across it (blended); where it's skin (with `skin`, a neckline) marked as skin.
  const fill = new Float32Array(pbw * pbh * 3); const isSkin = new Uint8Array(pbw * pbh); const isBare = new Uint8Array(pbw * pbh); const isNeck = new Uint8Array(pbw * pbh); const has = new Uint8Array(pbh);
  for (let ry = 0; ry < pbh; ry++) {
    const Y = pb.y0 + ry; if (pspans[ry * 2] < 0) continue;
    const l0 = Math.max(pb.x0, Math.floor(pspans[ry * 2])); const r0 = Math.min(pb.x1 - 1, Math.ceil(pspans[ry * 2 + 1]) - 1);
    let last = -1;
    for (let x = l0; x <= r0 + 1; x++) {
      // (The piece's skin, a neckline, isn't cloth: it's bridged like a gap, and marked.)
      const k = (ry * pbw);
      const bare = x <= r0 && skin && skin[Y * pw + x] >= 128;
      // ("Weak": not cloth seen in the photo, which mustn't cover the base's own bare skin: the piece's skin,
      // what was rebuilt under its hair, and what's bridged across its gaps.)
      if (x <= r0 && (bare || (rebuilt && rebuilt[Y * pw + x]) || !pm[Y * pw + x])) isSkin[k + x - pb.x0] = 1;
      if (bare && pm[Y * pw + x]) isBare[k + x - pb.x0] = 1;
      // (The piece's own skin there, inside its outline or not: its neckline.)
      if (bare) isNeck[k + x - pb.x0] = 1;
      const on = x <= r0 && pm[Y * pw + x] && !bare;
      if (x <= r0 && !on) continue;
      // Fill the gap between `last` and x.
      if (x <= r0) for (let c = 0; c < 3; c++) fill[(k + x - pb.x0) * 3 + c] = tex[(Y * pw + x) * 4 + c];
      const a = last >= 0 ? last : x <= r0 ? x : -1; const b2 = x <= r0 ? x : last;
      if (a >= 0 && b2 >= 0 && (last >= 0 ? last + 1 : l0) < (x <= r0 ? x : r0 + 1)) {
        // (The cloth's color a few pixels in from the gap's edges, averaged: its very edge is blended with
        // what's beyond it, a neck's skin.)
        const inner = (x0, dir) => { const m = [0, 0, 0]; let n = 0; for (let d = 2; d <= 6; d++) { const X = x0 + dir * d; if (X < pb.x0 || X >= pb.x1 || !pm[Y * pw + X] || (skin && skin[Y * pw + X] >= 128)) break; for (let c = 0; c < 3; c++) m[c] += tex[(Y * pw + X) * 4 + c]; n++; } if (!n) for (let c = 0; c < 3; c++) m[c] = tex[(Y * pw + x0) * 4 + c]; else for (let c = 0; c < 3; c++) m[c] /= n; return m; };
        const ca = inner(a, -1); const cb = inner(b2, 1);
        for (let g = (last >= 0 ? last + 1 : l0); g < (x <= r0 ? x : r0 + 1); g++) {
          const t = b2 === a ? 0 : (g - a) / (b2 - a);
          for (let c = 0; c < 3; c++) fill[(k + g - pb.x0) * 3 + c] = ca[c] * (1 - t) + cb[c] * t;
        }
      }
      if (x <= r0) last = x;
    }
    has[ry] = 1;
  }
  // Its skin and gaps (a neckline, the space by an arm) filled smoothly in both directions from its clean
  // cloth (a few pixels away, past a collar's edge that's half skin), with a little grain: a hole filled
  // row by row from its very edges comes out striped.
  {
    const weak = new Uint8Array(pbw * pbh); let nw = 0;
    for (let ry = 0; ry < pbh; ry++) {
      if (!has[ry]) continue;
      const l0 = Math.max(pb.x0, Math.floor(pspans[ry * 2])); const r0 = Math.min(pb.x1 - 1, Math.ceil(pspans[ry * 2 + 1]) - 1);
      for (let x = l0; x <= r0; x++) { const Y = pb.y0 + ry; if (!pm[Y * pw + x] || (skin && skin[Y * pw + x] >= 128)) { weak[ry * pbw + x - pb.x0] = 1; nw++; } }
    }
    if (nw) {
      const R = Math.max(2, Math.round(Math.max(pbw, pbh) / 120));
      const near = new Uint8Array(pbw * pbh);
      for (let y = 0; y < pbh; y++) for (let x = 0; x < pbw; x++) {
        if (!weak[y * pbw + x]) continue;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const X = x + dx; const Y = y + dy; if (X >= 0 && Y >= 0 && X < pbw && Y < pbh) near[Y * pbw + X] = 1; }
      }
      // (Worked on with a 2-pixel frame around it, held at its edge's colors: the smoothing doesn't reach a
      // grid's outermost pixels.)
      // (What's outside the piece's rows (beside a strap, above it) held at the nearest of its own colors in
      // that row, or the nearest row with any: never at nothing, black, which a neckline would fade to.)
      const F = 2; const fw = pbw + 2 * F; const fh = pbh + 2 * F;
      const val = new Float32Array(fw * fh * 3); const free = new Uint8Array(fw * fh);
      const rowNear = new Int32Array(pbh).fill(-1);
      for (let y = 0; y < pbh; y++) { if (has[y]) { rowNear[y] = y; continue; } for (let d = 1; d < pbh; d++) { if (y - d >= 0 && has[y - d]) { rowNear[y] = y - d; break; } if (y + d < pbh && has[y + d]) { rowNear[y] = y + d; break; } } }
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const sx = Math.max(0, Math.min(pbw - 1, x - F)); const sy = Math.max(0, Math.min(pbh - 1, y - F)); const k = sy * pbw + sx; const o = y * fw + x;
        const ry2 = rowNear[sy];
        if (ry2 >= 0) {
          const l1 = Math.max(0, Math.floor(pspans[ry2 * 2]) - pb.x0); const r1 = Math.min(pbw - 1, Math.ceil(pspans[ry2 * 2 + 1]) - 1 - pb.x0);
          const k2 = ry2 * pbw + Math.max(l1, Math.min(r1, sx));
          for (let c = 0; c < 3; c++) val[o * 3 + c] = fill[k2 * 3 + c];
        } else for (let c = 0; c < 3; c++) val[o * 3 + c] = fill[k * 3 + c];
        const inside = x >= F && y >= F && x < pbw + F && y < pbh + F;
        free[o] = inside && (near[k] || !has[sy]) ? 1 : 0;
      }
      membrane(val, free, fw, fh);
      let seed = 11;
      for (let y = 0; y < pbh; y++) for (let x = 0; x < pbw; x++) {
        const k = y * pbw + x; if (!near[k]) continue;
        seed = (seed * 1103515245 + 12345) >>> 0; const g = ((seed / 4294967296) - 0.5) * 5;
        const o = (y + F) * fw + x + F;
        for (let c = 0; c < 3; c++) fill[k * 3 + c] = val[o * 3 + c] + g;
      }
    }
  }
  const tspans = target.spans;
  const A = adj ?? { scale: 100, wide: 100, long: 100, dx: 0, dy: 0 };
  const zx = (A.scale / 100) * (A.wide / 100); const zy = (A.scale / 100) * (A.long / 100);
  const nearRow = (ry) => {
    ry = Math.max(0, Math.min(pbh - 1, ry));
    if (!has[ry]) { let k = -1; for (let d = 1; d < pbh && k < 0; d++) for (const t of [ry - d, ry + d]) if (t >= 0 && t < pbh && has[t]) { k = t; break; } ry = k; }
    return ry;
  };
  // (Where a row of the outline falls between two of the piece's: both, blended. A piece stretched taller
  // otherwise repeats its rows, streaks across it.)
  const rowAt = (y) => { const v = (y - T.y0 - A.dy) / zy; return Math.max(0, Math.min(pbh - 1, (open ? v / s : (v / th) * pbh) - 0.5)); };
  const rowOf = (y) => nearRow(Math.round(rowAt(y)));
  const rgba = new Uint8ClampedArray(tw * th * 4); const skinOut = skin ? new Uint8Array(tw * th) : null; const bareOut = skin ? new Uint8Array(tw * th) : null; const neckOut = skin ? new Uint8Array(tw * th) : null;
  for (let y = T.y0; y < T.y1; y++) {
    const ky = y - T.y0; if (tspans[ky * 2] < 0) continue;
    const tl = tspans[ky * 2]; const tr = tspans[ky * 2 + 1];
    const ry = rowOf(y); if (ry < 0) continue;
    const fr = rowAt(y); const ra = nearRow(Math.floor(fr)); const rb = nearRow(Math.floor(fr) + 1);
    const tv = ra >= 0 && rb >= 0 && ra !== rb ? Math.max(0, Math.min(1, fr - Math.floor(fr))) : 0;
    const pl = pspans[ry * 2]; const pr = pspans[ry * 2 + 1];
    // (The color at u across the piece's row r: its two nearest pixels, blended.)
    const sample = (r, u, c) => {
      const l = pspans[r * 2]; const rr = pspans[r * 2 + 1];
      const fx = Math.max(l, Math.min(rr - 1, l + u * (rr - l) - 0.5)) - pb.x0;
      const xa = Math.max(0, Math.min(pbw - 1, Math.floor(fx))); const xb = Math.min(pbw - 1, xa + 1); const t = Math.max(0, Math.min(1, fx - xa));
      return fill[(r * pbw + xa) * 3 + c] * (1 - t) + fill[(r * pbw + xb) * 3 + c] * t;
    };
    for (let x = Math.max(T.x0, Math.floor(tl)); x < Math.min(T.x1, Math.ceil(tr)); x++) {
      if (!target.mask[y * w + x]) continue;
      const u = 0.5 + ((x + 0.5 - tl) / Math.max(1, tr - tl) - 0.5 - A.dx / tw) / zx;
      const fx = Math.max(pl, Math.min(pr - 1, pl + u * (pr - pl) - 0.5)) - pb.x0;
      const xa = Math.max(0, Math.min(pbw - 1, Math.floor(fx)));
      const o = (ky * tw + x - T.x0) * 4; const k = ry * pbw;
      if (tv > 0) for (let c = 0; c < 3; c++) rgba[o + c] = sample(ra, u, c) * (1 - tv) + sample(rb, u, c) * tv;
      else for (let c = 0; c < 3; c++) rgba[o + c] = sample(ry, u, c);
      rgba[o + 3] = 255;
      if (skinOut && isSkin[k + xa]) skinOut[ky * tw + x - T.x0] = 1;
      if (bareOut && isBare[k + xa]) bareOut[ky * tw + x - T.x0] = 1;
      if (neckOut && isNeck[k + xa]) neckOut[ky * tw + x - T.x0] = 1;
    }
  }
  return { x0: T.x0, y0: T.y0, pw: tw, ph: th, rgba, skin: skinOut, bare: bareOut, neck: neckOut };
}

/**
 * The folds and shadows of what's worn on the base (where it's darker or lighter than around it, in its
 * shape), for the design laid into it: the garment's light at each pixel over its light a little farther
 * around (both within the garment only), toned down where the garment is so dark that its light is mostly
 * noise, 0.84 to 1.12. Box-sized.
 */
export function foldMap(rgba, w, mask, box, fine, coarse) {
  const bw = box.x1 - box.x0; const bh = box.y1 - box.y0;
  const L = new Float32Array(bw * bh); const ok = new Uint8Array(bw * bh); let sum = 0; let n = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const j = (box.y0 + y) * w + box.x0 + x; const i = j * 4;
    L[y * bw + x] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    if (mask[j]) { ok[y * bw + x] = 1; sum += L[y * bw + x]; n++; }
  }
  const mean = n ? sum / n : 128;
  // (A dark garment's folds are only a few levels deep: measured against a floor, so its noise isn't folds.)
  const floor = Math.max(18, 60 - mean * 0.3);
  const a = boxBlur(L, ok, bw, bh, fine); const b = boxBlur(L, ok, bw, bh, coarse);
  const out = new Float32Array(bw * bh).fill(1);
  for (let k = 0; k < bw * bh; k++) if (ok[k]) out[k] = Math.max(0.84, Math.min(1.12, (a[k] + floor) / (b[k] + floor)));
  return out;
}

/**
 * A person's upper body in parts (`p`, `L` at the photo's size; a zone's rows): the torso (a little over
 * two face-widths either side of the face's middle, the chest) and each arm beside it, each with whether
 * it's covered (mostly clothes: a sleeve) or bare (mostly skin: a tank top's arm). The outline is the body
 * and what's on it, not the face or hair. { torso, left, right } (each { mask, box, n, covered } or null).
 * @param {People} p @param {Layout} L
 */
export function upperParts(p, L, w, h, kind = 'upper', pose = null) {
  const z = kindZone(kind, L, w, h);
  const sil = new Uint8Array(w * h);
  for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) {
    const i = y * w + x;
    if (Math.max(p.body[i], p.clothes[i], p.others[i]) >= 128 && p.face[i] < 128 && p.hair[i] < 128) sil[i] = 1;
  }
  openMask(sil, w, h, z, Math.max(1, Math.round(L.fh / 60)));
  let total = 0; for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) total += sil[y * w + x];
  const fc = L.face ? (L.face.x0 + L.face.x1) / 2 : (z.x0 + z.x1) / 2;
  const t0 = fc - 1.2 * L.fw; const t1 = fc + 1.2 * L.fw;
  // Which part each pixel is: by the pose (each arm the outline along its shoulder, elbow and wrist,
  // closer to that line than to the spine), else by columns (the chest's, from the face's width).
  const seen = (q) => q && q[2] >= 0.3;
  const usePose = pose && seen(pose.shoulders[0]) && seen(pose.shoulders[1]);
  let which = null; // 0 torso, 1 left arm, 2 right arm (by the picture)
  if (usePose) {
    const segDist = (x, y, a, b) => { const dx = b[0] - a[0]; const dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); };
    const sw = Math.hypot(pose.shoulders[1][0] - pose.shoulders[0][0], pose.shoulders[1][1] - pose.shoulders[0][1]);
    const ms = [(pose.shoulders[0][0] + pose.shoulders[1][0]) / 2, (pose.shoulders[0][1] + pose.shoulders[1][1]) / 2];
    const mh = seen(pose.hips[0]) && seen(pose.hips[1]) ? [(pose.hips[0][0] + pose.hips[1][0]) / 2, (pose.hips[0][1] + pose.hips[1][1]) / 2] : [ms[0], ms[1] + sw * 1.6];
    const arm = (k) => {
      const s2 = pose.shoulders[k]; const e = seen(pose.elbows[k]) ? pose.elbows[k] : [s2[0] + (k ? 1 : -1) * sw * 0.1, s2[1] + sw * 0.9];
      const wr = seen(pose.wrists[k]) ? pose.wrists[k] : [e[0], e[1] + sw * 0.8];
      // (Past the wrist a little: the hand.)
      const hand = [wr[0] + (wr[0] - e[0]) * 0.25, wr[1] + (wr[1] - e[1]) * 0.25];
      return [s2, e, wr, hand];
    };
    // (An arm whose elbow the pose can't see is behind something (the person beside them): not made up.)
    const arms = [seen(pose.elbows[0]) ? arm(0) : null, seen(pose.elbows[1]) ? arm(1) : null]; const reach = sw * 0.21;
    // (What's at a point: skin 1, clothes 2, nothing 0.)
    const matAt = (x, y) => { const X = Math.round(x); const Y = Math.round(y); if (X < 0 || Y < 0 || X >= w || Y >= h) return 0; const i = Y * w + X; return p.body[i] >= 128 ? 1 : Math.max(p.clothes[i], p.others[i]) >= 128 ? 2 : 0; };
    const nearest = (x, y, a, b) => { const dx = b[0] - a[0]; const dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))); return [a[0] + t * dx, a[1] + t * dy]; };
    // (Along the upper arm, how far from the shoulder: the first eighth of it is the shoulder's, the body's.)
    const along = (x, y, a, b) => { const dx = b[0] - a[0]; const dy = b[1] - a[1]; return ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1); };
    which = new Uint8Array(w * h);
    for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) {
      const i = y * w + x; if (!sil[i]) continue;
      const spine = segDist(x, y, ms, mh);
      let best = 0; let bd = Infinity;
      let shoulder = false; let on = null;
      for (let k = 0; k < 2; k++) {
        const A = arms[k]; if (!A) continue;
        const ds = [segDist(x, y, A[0], A[1]), segDist(x, y, A[1], A[2]), segDist(x, y, A[2], A[3])];
        const j = ds.indexOf(Math.min(...ds));
        if (ds[j] < bd) { bd = ds[j]; best = k + 1; shoulder = j === 0 && along(x, y, A[0], A[1]) < 0.12; on = nearest(x, y, A[j], A[j + 1]); }
      }
      // (The same stuff as the arm itself there: a bare arm doesn't take in the shirt's side beside it.)
      const mArm = on ? matAt(on[0], on[1]) : 0; const mHere = matAt(x, y);
      const same = !mArm || !mHere || mArm === mHere;
      which[i] = bd < reach && bd < spine * 0.9 && !shoulder && same ? best : 0;
    }
  }
  const armArea = [0, 0];
  if (which && pose) {
    const sw2 = Math.hypot(pose.shoulders[1][0] - pose.shoulders[0][0], pose.shoulders[1][1] - pose.shoulders[0][1]);
    for (let k = 0; k < 2; k++) { if (!seen(pose.elbows[k])) continue; const s2 = pose.shoulders[k]; const e = pose.elbows[k]; const wr = seen(pose.wrists[k]) ? pose.wrists[k] : e; armArea[k] = (Math.hypot(e[0] - s2[0], e[1] - s2[1]) + Math.hypot(wr[0] - e[0], wr[1] - e[1])) * sw2 * 0.22; }
  }
  const part = (id, keep) => {
    const m = new Uint8Array(w * h); let n = 0; let cl = 0;
    for (let y = z.y0; y < z.y1; y++) for (let x = z.x0; x < z.x1; x++) { const i = y * w + x; if (sil[i] && (which ? which[i] === id : keep(x))) { m[i] = 1; n++; if (p.clothes[i] >= 128) cl++; } }
    // (Too little to be an arm or a torso: under 2% of the outline; or, by the pose, under a third of what an
    // arm that long would cover: a sliver of the side beside an arm hidden behind someone.)
    if (n < total * 0.02) return null;
    if (which && id && armArea[id - 1] && n < armArea[id - 1] * 0.3) return null;
    const k = mainParts(m, w, h, boxOf(m, w, h), 0.3);
    return k && { mask: k.mask, box: k.box, n: k.count, covered: cl / n > 0.45, clothFrac: cl / n };
  };
  const left = part(1, (x) => x < t0); const right = part(2, (x) => x >= t1);
  // What's arm (either), to take out of the torso.
  const arms = new Uint8Array(w * h); for (const a of [left, right]) if (a) for (let i = 0; i < arms.length; i++) if (a.mask[i]) arms[i] = 1;
  return { torso: part(0, (x) => x >= t0 && x < t1), left, right, arms, t0, t1, byPose: !!which };
}

/**
 * A bare arm where a sleeve was (a tank top put on someone in a jacket): within the sleeve's outline, each
 * row an arm as wide as the base's own bare arm below the sleeve (or, not seen, 62% of the sleeve), set
 * in its middle, in the base person's skin color (`tone`), lit as an arm is round. The rest of the
 * sleeve isn't drawn (what was behind it is filled in). A layer over the sleeve's box.
 */
export function bareArm(sleeve, w, h, tone, people) {
  const b = sleeve.box; const bw = b.x1 - b.x0; const bh = b.y1 - b.y0;
  // The arm's own width: its bare skin just below the sleeve, if it's seen there.
  let armW = 0; const ws = [];
  for (let y = b.y1; y < Math.min(h, b.y1 + bh * 0.4); y++) {
    let l = -1; let r = -1; for (let x = Math.max(0, b.x0 - 4); x < Math.min(w, b.x1 + 4); x++) if (people.body[y * w + x] >= 128) { if (l < 0) l = x; r = x; }
    if (l >= 0) ws.push(r - l + 1);
  }
  if (ws.length >= 3) { ws.sort((a, c) => a - c); armW = ws[ws.length >> 1]; }
  const rgba = new Uint8ClampedArray(bw * bh * 4); let seed = 3;
  for (let y = b.y0; y < b.y1; y++) {
    let l = -1; let r = -1; for (let x = b.x0; x < b.x1; x++) if (sleeve.mask[y * w + x]) { if (l < 0) l = x; r = x + 1; }
    if (l < 0) continue;
    const sw = r - l; const aw = Math.min(sw, armW > 3 ? armW : sw * 0.62); const c = (l + r) / 2;
    for (let x = Math.max(b.x0, Math.floor(c - aw / 2)); x < Math.min(b.x1, Math.ceil(c + aw / 2)); x++) {
      const u = (x + 0.5 - (c - aw / 2)) / aw; const shade = 0.82 + 0.18 * Math.sqrt(Math.max(0, Math.sin(Math.PI * u)));
      seed = (seed * 1103515245 + 12345) >>> 0; const g = ((seed / 4294967296) - 0.5) * 4;
      const edge = Math.min(1, (x + 1 - (c - aw / 2)), (c + aw / 2) - x);
      const o = ((y - b.y0) * bw + x - b.x0) * 4;
      for (let k = 0; k < 3; k++) rgba[o + k] = tone[k] * shade + g;
      rgba[o + 3] = Math.round(255 * Math.max(0, Math.min(1, edge)));
    }
  }
  return { x0: b.x0, y0: b.y0, pw: bw, ph: bh, rgba };
}

/**
 * A photo of several people told apart (`p` at the picture's size, `rgba` its pixels, `poses` from
 * detectPoses or []): one person for each face found. Each grows out from their face (and, where a pose
 * is clearly theirs, its nose in that face, along their skeleton) over everyone's pixels, the nearest by
 * a path that costs more where the color changes: so two people side by side part where one's dress meets
 * the other's, not halfway between them. Each person's maps keep only their pixels (and only those joined
 * to the bulk of them). [{ p, box, face, n }] left to right; one entry, the maps as they are, for one
 * person or none.
 * `T` (for tuning): { res: the size it's worked out at, edge / steep: what a change of color costs,
 * step / mean: how far a patch of one color reaches }.
 * @param {People} p @param {ArrayLike<number>} rgba @param {any[]} [poses] @param {any} [T] @returns {{ p: People, box: Box|null, face: Box|null, n: number }[]}
 */
export function splitPeople(p, rgba, poses = [], T = {}) {
  const { w, h } = p; const { res = 400, edge = 5, steep = 6, step = 7, mean = 16 } = T;
  const one = [{ p, box: null, face: null, n: 0 }];
  // Worked out at most `res` (400) px across.
  const k = Math.min(1, res / Math.max(w, h)); const W = Math.max(1, Math.round(w * k)); const H = Math.max(1, Math.round(h * k));
  const at = (X, Y) => Math.min(h - 1, Math.floor((Y + 0.5) / k)) * w + Math.min(w - 1, Math.floor((X + 0.5) / k));
  const any = new Uint8Array(W * H); const face = new Uint8Array(W * H); const lab = new Float32Array(W * H * 3);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const i = at(X, Y); const j = Y * W + X;
    any[j] = Math.max(p.body[i], p.clothes[i], p.face[i], p.hair[i], p.others[i]) >= 96 ? 1 : 0;
    face[j] = p.face[i] >= 128 ? 1 : 0;
    const c = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]); lab[j * 3] = c[0]; lab[j * 3 + 1] = c[1]; lab[j * 3 + 2] = c[2];
  }
  // The faces: each joined patch of face skin, the small ones (a hand, an ear apart) left out.
  const lab0 = new Int32Array(W * H); const faces = [];
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!face[s0] || lab0[s0]) continue;
    const q = [s0]; lab0[s0] = faces.length + 1; let x0 = W; let y0 = H; let x1 = 0; let y1 = 0;
    for (let t = 0; t < q.length; t++) {
      const i = q[t]; const X = i % W; const Y = (i / W) | 0;
      if (X < x0) x0 = X; if (X >= x1) x1 = X + 1; if (Y < y0) y0 = Y; if (Y >= y1) y1 = Y + 1;
      for (const n of [X > 0 ? i - 1 : -1, X < W - 1 ? i + 1 : -1, Y > 0 ? i - W : -1, Y < H - 1 ? i + W : -1]) if (n >= 0 && face[n] && !lab0[n]) { lab0[n] = faces.length + 1; q.push(n); }
    }
    faces.push({ id: faces.length + 1, px: q, n: q.length, box: { x0, y0, x1, y1 } });
  }
  const big = Math.max(0, ...faces.map((f) => f.n));
  const people = faces.filter((f) => f.n >= big * 0.2 && f.n >= 12).sort((a, b) => (a.box.x0 + a.box.x1) - (b.box.x0 + b.box.x1));
  if (people.length < 2) return one;
  // The seeds: each face, and the skeleton of the pose whose nose is in it (one pose to a face at most).
  const N = people.length; const dist = new Float64Array(W * H).fill(Infinity); const own = new Int8Array(W * H).fill(-1);
  const heap = []; // [d, j]
  const push = (d, j) => { heap.push([d, j]); let c = heap.length - 1; while (c > 0) { const pa = (c - 1) >> 1; if (heap[pa][0] <= d) break; [heap[pa], heap[c]] = [heap[c], heap[pa]]; c = pa; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1; const r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  const seed = (j, who) => { if (own[j] === -2) return; if (own[j] >= 0 && own[j] !== who) { own[j] = -2; dist[j] = 0; return; } own[j] = who; dist[j] = 0; };
  const used = new Set();
  people.forEach((f, who) => {
    for (const j of f.px) seed(j, who);
    const B = f.box; const fw = B.x1 - B.x0; const fh = B.y1 - B.y0;
    // (Of the poses whose nose is in this face, the one nearest its middle: two can be found on one person.)
    const cx0 = (B.x0 + B.x1) / 2; const cy0 = (B.y0 + B.y1) / 2;
    const pose = (poses ?? []).filter((q, n) => !used.has(n) && q.nose[2] >= 0.3 && q.nose[0] * k >= B.x0 - fw * 0.15 && q.nose[0] * k <= B.x1 + fw * 0.15 && q.nose[1] * k >= B.y0 - fh * 0.15 && q.nose[1] * k <= B.y1 + fh * 0.15)
      .sort((a, b) => Math.hypot(a.nose[0] * k - cx0, a.nose[1] * k - cy0) - Math.hypot(b.nose[0] * k - cx0, b.nose[1] * k - cy0))[0];
    if (pose) used.add(poses.indexOf(pose));
    // (Their own color: what's straight below their face at the chest. A pose's line over a color far from
    // it has crossed onto the person beside them there, and seeds nothing.)
    const ref = (() => { const cx = Math.round((B.x0 + B.x1) / 2); const v = [[], [], []]; for (let Y = Math.round(B.y1 + fh * 1.2); Y < Math.min(H, B.y1 + fh * 2.5); Y++) { const j = Y * W + cx; if (any[j]) for (let c = 0; c < 3; c++) v[c].push(lab[j * 3 + c]); } return v[0].length >= 3 ? v.map((a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; }) : null; })();
    const mineColor = (j) => !ref || Math.hypot((lab[j * 3] - ref[0]) * 0.5, lab[j * 3 + 1] - ref[1], lab[j * 3 + 2] - ref[2]) < 24;
    const line = (a, b) => {
      if (!a || !b || a[2] < 0.5 || b[2] < 0.5) return;
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * k) + 1;
      for (let t = 0; t <= n; t++) { const X = Math.round((a[0] + ((b[0] - a[0]) * t) / n) * k); const Y = Math.round((a[1] + ((b[1] - a[1]) * t) / n) * k); if (X >= 0 && Y >= 0 && X < W && Y < H && any[Y * W + X] && mineColor(Y * W + X)) seed(Y * W + X, who); }
    };
    if (pose) {
      // (The spine and the middle of the hips only: a pose's shoulders and far ends can land on the person
      // beside them.)
      const m = (a, b, t = 0.5) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.min(a[2], b[2])];
      const ms = m(pose.shoulders[0], pose.shoulders[1]); const mh = m(pose.hips[0], pose.hips[1]);
      line(ms, mh);
      line(m(pose.hips[0], pose.hips[1], 0.3), m(pose.hips[0], pose.hips[1], 0.7));
      // (And each shoulder that's nearer their own face than anyone else's: theirs, not the next person's.)
      const fc = (g) => [((g.box.x0 + g.box.x1) / 2) / k, ((g.box.y0 + g.box.y1) / 2) / k];
      const mine = fc(f);
      for (const sh of pose.shoulders) {
        const dm = Math.hypot(sh[0] - mine[0], sh[1] - mine[1]);
        if (people.every((g) => g === f || Math.hypot(sh[0] - fc(g)[0], sh[1] - fc(g)[1]) > dm)) line(ms, m(ms, sh, 0.7));
      }
      // (On down the legs, or what's over them: as far again below the hips.)
      line(mh, [mh[0] + (mh[0] - ms[0]) * 0.3, mh[1] + (mh[1] - ms[1]) * 1.3, mh[2]]);
    }
    // (And straight down from their face, from the chin, while it's on someone: about as far as a body goes
    // without a pose of theirs, their chest with one.)
    {
      const cx = Math.round((B.x0 + B.x1) / 2); let off = 0;
      for (let Y = B.y1; Y < Math.min(H, B.y1 + fh * (pose ? 2.5 : 6.5)); Y++) { const j = Y * W + cx; if (!any[j]) { if (++off > fh * 0.3) break; continue; } off = 0; seed(j, who); }
    }
  });
  for (let j = 0; j < W * H; j++) { if (own[j] === -2) { own[j] = -1; dist[j] = Infinity; } else if (own[j] >= 0) push(0, j); }
  // Grown out over everyone, each step costing more for a change of color.
  while (heap.length) {
    const [d, i] = pop(); if (d > dist[i]) continue;
    const X = i % W; const Y = (i / W) | 0;
    for (const n of [X > 0 ? i - 1 : -1, X < W - 1 ? i + 1 : -1, Y > 0 ? i - W : -1, Y < H - 1 ? i + W : -1]) {
      if (n < 0 || !any[n]) continue;
      const de = Math.hypot(lab[i * 3] - lab[n * 3], lab[i * 3 + 1] - lab[n * 3 + 1], lab[i * 3 + 2] - lab[n * 3 + 2]);
      const nd = d + 1 + (de > edge ? (de - edge) * steep : 0);
      if (nd < dist[n]) { dist[n] = nd; own[n] = own[i]; push(nd, n); }
    }
  }
  // Then each patch of one color (a dress, a sleeve, its light side or its shade: grown while it stays near
  // its own average color) goes all to whoever has the most of it: a dress isn't parted down its middle.
  const isSeed = new Uint8Array(W * H); for (let j = 0; j < W * H; j++) if (dist[j] === 0) isSeed[j] = 1;
  // (Each person's colors, by hue more than lightness: satin's light side and its shade are one color.)
  const binOf = (L, A, B) => { const a = Math.max(0, Math.min(15, Math.floor((A + 64) / 8))); const b = Math.max(0, Math.min(15, Math.floor((B + 64) / 8))); const l = Math.max(0, Math.min(3, Math.floor(L / 25))); return (l * 16 + a) * 16 + b; };
  const bin = (j) => binOf(lab[j * 3], lab[j * 3 + 1], lab[j * 3 + 2]);
  const hist = Array.from({ length: N }, () => new Int32Array(4 * 16 * 16)); const tot = new Int32Array(N);
  for (let j = 0; j < W * H; j++) if (own[j] >= 0) { hist[own[j]][bin(j)]++; tot[own[j]]++; }
  // (How much of a person's colors are near this one: the bins around it.)
  const near = (c, b0, minus) => {
    const l0 = (b0 / 256) | 0; const a0 = ((b0 / 16) | 0) % 16; const bb = b0 % 16; let n = 0;
    for (let l = Math.max(0, l0 - 1); l <= Math.min(3, l0 + 1); l++) for (let a = Math.max(0, a0 - 1); a <= Math.min(15, a0 + 1); a++) for (let b = Math.max(0, bb - 1); b <= Math.min(15, bb + 1); b++) { const q = (l * 16 + a) * 16 + b; n += hist[c][q] - (minus.get(q) ?? 0); }
    return n / Math.max(1, tot[c]);
  };
  const reg = new Int32Array(W * H);
  for (let s0 = 0, id = 0; s0 < W * H; s0++) {
    if (!any[s0] || reg[s0]) continue;
    id++; const q = [s0]; reg[s0] = id; const sum = [lab[s0 * 3], lab[s0 * 3 + 1], lab[s0 * 3 + 2]];
    for (let t = 0; t < q.length; t++) {
      const i = q[t]; const X = i % W; const Y = (i / W) | 0;
      for (const n of [X > 0 ? i - 1 : -1, X < W - 1 ? i + 1 : -1, Y > 0 ? i - W : -1, Y < H - 1 ? i + W : -1]) {
        if (n < 0 || !any[n] || reg[n]) continue;
        const st = Math.hypot(lab[i * 3] - lab[n * 3], lab[i * 3 + 1] - lab[n * 3 + 1], lab[i * 3 + 2] - lab[n * 3 + 2]);
        const c = q.length; const mn = Math.hypot(sum[0] / c - lab[n * 3], sum[1] / c - lab[n * 3 + 1], sum[2] / c - lab[n * 3 + 2]);
        if (st > step || mn > mean) continue;
        reg[n] = id; q.push(n); sum[0] += lab[n * 3]; sum[1] += lab[n * 3 + 1]; sum[2] += lab[n * 3 + 2];
      }
    }
    if (q.length < 30) continue;
    // (A patch with two people's seeds in it, each a fair share, two people's skin where they touch: left
    // parted as it was grown, by the nearest.)
    const sc0 = new Array(N).fill(0); for (const i of q) if (isSeed[i] && own[i] >= 0) sc0[own[i]]++;
    const ranked = [...sc0].sort((a, b) => b - a);
    if (ranked[1] >= 4 && ranked[1] >= ranked[0] * 0.25) continue;
    const votes = new Array(N).fill(0); for (const i of q) if (own[i] >= 0) votes[own[i]]++;
    let top = votes.indexOf(Math.max(...votes));
    // (Held by two people: the one whose own colors, elsewhere, are most like it. A person's pose can be
    // off, and their share of a dress beside theirs with it.)
    // (Who holds it, and who's next to it.)
    const next = new Set(votes.map((v, c) => (v >= q.length * 0.1 ? c : -1)).filter((c) => c >= 0));
    for (const i of q) {
      const X = i % W; const Y = (i / W) | 0;
      for (const n of [X > 0 ? i - 1 : -1, X < W - 1 ? i + 1 : -1, Y > 0 ? i - W : -1, Y < H - 1 ? i + W : -1]) if (n >= 0 && reg[n] !== id && own[n] >= 0) next.add(own[n]);
    }
    const rivals = [...next];
    if (rivals.length > 1) {
      // (The patch's own average color, binned.)
      const m3 = [0, 0, 0]; for (const i of q) { m3[0] += lab[i * 3]; m3[1] += lab[i * 3 + 1]; m3[2] += lab[i * 3 + 2]; }
      const meanBin = binOf(m3[0] / q.length, m3[1] / q.length, m3[2] / q.length);
      let best = -1;
      for (const c of rivals) {
        const minus = new Map(); for (const i of q) if (own[i] === c) { const b = bin(i); minus.set(b, (minus.get(b) ?? 0) + 1); }
        const af = near(c, meanBin, minus); const sc = af * af * (0.25 + votes[c] / q.length);
        if (sc > best) { best = sc; top = c; }
      }
    }
    for (const i of q) if (!isSeed[i]) own[i] = top;
  }
  // At the picture's own size: each pixel the person of the cells around it; where they differ (where two
  // people meet), whoever's color nearby it's nearest, pixel by pixel (no steps of the coarser grid along
  // the edge); its soft rim, the person of the nearest cell.
  const lbl = new Int8Array(w * h).fill(-1);
  const localMean = (X, Y, c) => { const m3 = [0, 0, 0]; let n = 0; for (let yy = Math.max(0, Y - 2); yy <= Math.min(H - 1, Y + 2); yy++) for (let xx = Math.max(0, X - 2); xx <= Math.min(W - 1, X + 2); xx++) { const j = yy * W + xx; if (own[j] === c) { m3[0] += lab[j * 3]; m3[1] += lab[j * 3 + 1]; m3[2] += lab[j * 3 + 2]; n++; } } return n ? m3.map((v) => v / n) : null; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (Math.max(p.body[i], p.clothes[i], p.face[i], p.hair[i], p.others[i]) === 0) continue;
    const fx = Math.max(0, Math.min(W - 1, (x + 0.5) * k - 0.5)); const fy = Math.max(0, Math.min(H - 1, (y + 0.5) * k - 0.5));
    const X0 = Math.floor(fx); const Y0 = Math.floor(fy); const X1 = Math.min(W - 1, X0 + 1); const Y1 = Math.min(H - 1, Y0 + 1);
    const cand = new Set(); for (const j of [Y0 * W + X0, Y0 * W + X1, Y1 * W + X0, Y1 * W + X1]) if (own[j] >= 0) cand.add(own[j]);
    if (cand.size === 1) { lbl[i] = [...cand][0]; continue; }
    const Xn = Math.round(fx); const Yn = Math.round(fy);
    if (!cand.size) {
      // (The soft rim outside everyone's cells: the nearest cell's person, a cell or two away.)
      let best = -1; let bd = 9;
      for (let yy = Math.max(0, Yn - 2); yy <= Math.min(H - 1, Yn + 2); yy++) for (let xx = Math.max(0, Xn - 2); xx <= Math.min(W - 1, Xn + 2); xx++) { const j = yy * W + xx; const d = (xx - fx) ** 2 + (yy - fy) ** 2; if (own[j] >= 0 && d < bd) { bd = d; best = own[j]; } }
      lbl[i] = best; continue;
    }
    const q = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    let best = -1; let bd = Infinity;
    for (const c of cand) { const mm = localMean(Xn, Yn, c); if (!mm) continue; const d = (q[0] - mm[0]) ** 2 * 0.5 + (q[1] - mm[1]) ** 2 + (q[2] - mm[2]) ** 2; if (d < bd) { bd = d; best = c; } }
    lbl[i] = best;
  }
  return people.map((f, who) => {
    const m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (lbl[i] === who) m[i] = 1;
    const kept = mainParts(m, w, h, { x0: 0, y0: 0, x1: w, y1: h }, 0.2);
    /** @type {any} */ const q = { w, h };
    for (const c of ['face', 'hair', 'body', 'clothes', 'others']) { const a = new Uint8Array(w * h); if (kept) for (let i = 0; i < w * h; i++) if (kept.mask[i]) a[i] = p[c][i]; q[c] = a; }
    const fb = { x0: Math.floor(f.box.x0 / k), y0: Math.floor(f.box.y0 / k), x1: Math.ceil(f.box.x1 / k), y1: Math.ceil(f.box.y1 / k) };
    return { p: q, box: kept?.box ?? null, face: fb, n: kept?.count ?? 0 };
  });
}
