// @ts-check
// FaceMask's fitting, a face behind bangs. The face finders look for eyes: a face whose eyes and brows are
// under bangs isn't found. Its shape is worked out instead from what's seen of it, its skin (the cheeks,
// nose, mouth and chin, by the face-part maps: faceFromParts), a generic face fitted to that. Then the bangs
// over it: inside the face's shape, what's the color of that person's own hair just around it (and isn't
// their skin), joined to their hair, or what the maps say is hair (bangsMap). The Character goes on behind
// them, and its color and light are taken from the face's skin only, never from the hair over it (debang:
// the photo with the bangs filled in from the skin around them, for working out the colors). Pure.

import { TEMPLATE } from './face3d.js';
import { faceFrom } from '../../lib/face-core.js';
import { rgbToLab } from '../../lib/color-match.js';
import { fillPolygon } from '../../lib/geometry.js';
import { membrane } from './cleanup.js';
import { skinModel } from './fit-skin.js';

/**
 * The faces seen by their skin alone (`parts`: face-parts.js maps of the photo), for when the face finders
 * found none (bangs over the eyes, a face turned away a little): each patch of face skin big enough to be a
 * face, a generic face's 68 points laid on it (as wide as its cheeks, its chin at its lowest skin), as faces
 * are (face-core.js faceFrom, 0..1 of the picture), `estimated: true`. Biggest first.
 * @param {{ w: number, h: number, hair: Uint8Array, face: Uint8Array }} parts
 */
export function facesFromParts(parts) {
  const { w, h, face, hair } = parts; const n = w * h;
  const lab = new Int32Array(n); const comps = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (lab[s0] || face[s0] < 128) continue;
    const id = comps.length + 1; const st = [s0]; lab[s0] = id;
    for (let a = 0; a < st.length; a++) {
      const i = st[a]; const x = i % w; const y = (i / w) | 0;
      for (const t of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (t >= 0 && !lab[t] && face[t] >= 128) { lab[t] = id; st.push(t); }
    }
    comps.push(st);
  }
  const big = Math.max(0, ...comps.map((c) => c.length));
  const out = [];
  for (const px of comps) {
    if (px.length < Math.max(60, big * 0.15, n * 0.0015)) continue;
    // Its rows: each one's ends.
    let y0 = h; let y1 = 0; for (const i of px) { const y = (i / w) | 0; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const rows = y1 - y0 + 1; const L = new Int32Array(rows).fill(w); const R = new Int32Array(rows).fill(-1);
    for (const i of px) { const x = i % w; const k = ((i / w) | 0) - y0; if (x < L[k]) L[k] = x; if (x > R[k]) R[k] = x; }
    const widths = []; for (let k = 0; k < rows; k++) if (R[k] >= L[k]) widths.push(R[k] - L[k] + 1);
    if (widths.length < 4) continue;
    // (As wide as its cheeks: the width most of its rows reach, not a stray row.)
    const sorted = [...widths].sort((a, b) => a - b); const wj = sorted[Math.floor(sorted.length * 0.85)];
    let cx = 0; let nc = 0; for (let k = 0; k < rows; k++) if (R[k] >= L[k] && R[k] - L[k] + 1 >= wj * 0.8) { cx += (L[k] + R[k]) / 2; nc++; }
    cx = nc ? cx / nc : (L[0] + R[0]) / 2;
    // (Its chin: its lowest rows of any width, not the tip of a strand of skin.)
    let chin = y1; for (let k = rows - 1; k >= 0; k--) if (R[k] - L[k] + 1 >= wj * 0.3) { chin = y0 + k; break; }
    const s = wj / 2; const oy = chin - 1.25 * s;
    // (A face, not a hand or an arm: as tall as a face for its width, with hair above or beside it.)
    if (chin - y0 < s * 0.8) continue;
    let hairNear = 0; const top = Math.max(0, Math.round(oy - 1.3 * s));
    for (let y = top; y < Math.round(oy + 0.3 * s); y += 2) for (let x = Math.max(0, Math.round(cx - 1.2 * s)); x < Math.min(w, Math.round(cx + 1.2 * s)); x += 2) if (hair[y * w + x] >= 128) hairNear++;
    if (!hairNear) continue;
    const pts = TEMPLATE.map(([x, y]) => [cx + x * s, oy + y * s]);
    const box = { x: cx - s, y: oy - 0.95 * s, width: 2 * s, height: chin - (oy - 0.95 * s) };
    out.push({ ...faceFrom(box, pts, w, h, 0.5), estimated: true });
  }
  return out.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
}

/** The face's whole shape (its jaw, then up over its forehead to where a hairline would be), in pixels. */
export function faceShape(face, W, H) {
  const P = face.pts.map(([u, v]) => [u * W, v * H]);
  const jaw = P.slice(0, 17);
  const eyeMid = [(P[39][0] + P[42][0]) / 2, (P[39][1] + P[42][1]) / 2];
  const half = Math.hypot(P[16][0] - P[0][0], P[16][1] - P[0][1]) / 2;
  // ("Up": from the chin to between the eyes.)
  const ux = (eyeMid[0] - P[8][0]); const uy = (eyeMid[1] - P[8][1]); const ul = Math.hypot(ux, uy) || 1;
  const up = [ux / ul, uy / ul]; const across = [-up[1], up[0]];
  const c = [(P[0][0] + P[16][0]) / 2, (P[0][1] + P[16][1]) / 2];
  const arc = [];
  for (let i = 1; i < 16; i++) { const t = Math.PI * (i / 16); const a = -Math.cos(t); const b = Math.sin(t); arc.push([c[0] - across[0] * a * half + up[0] * b * half * 1.05, c[1] - across[1] * a * half + up[1] * b * half * 1.05]); }
  return [...jaw, ...arc.reverse()];
}

/**
 * The bangs over `face` in `photo` (RGBA W×H): 0..255 how sure, W×H, or null when there are none.
 * Inside the face's shape: what the maps say is hair (`parts`), and, above the nose's tip, what's the color
 * of their own hair (what the maps are sure is hair, just around the face) and not their skin, joined to
 * their hair. Softened a little at its edge.
 * @param {Uint8ClampedArray} photo @param {number} W @param {number} H
 * @param {any} face @param {{ w: number, h: number, hair: Uint8Array, face: Uint8Array } | null} parts
 */
export function bangsMap(photo, W, H, face, parts) {
  if (!parts || face?.pts?.length !== 68) return null;
  const shape = faceShape(face, W, H);
  const xs = shape.map((p) => p[0]); const ys = shape.map((p) => p[1]);
  const fw = Math.max(...xs) - Math.min(...xs);
  const bx0 = Math.max(0, Math.floor(Math.min(...xs) - fw * 0.6)); const bx1 = Math.min(W, Math.ceil(Math.max(...xs) + fw * 0.6));
  const by0 = Math.max(0, Math.floor(Math.min(...ys) - fw * 0.6)); const by1 = Math.min(H, Math.ceil(Math.max(...ys)));
  const bw = bx1 - bx0; const bh = by1 - by0; if (bw < 4 || bh < 4) return null;
  const inFace = fillPolygon(shape, bx0, by0, bw, bh);
  const hairAt = (X, Y) => parts.hair[Math.min(parts.h - 1, Math.floor((Y * parts.h) / H)) * parts.w + Math.min(parts.w - 1, Math.floor((X * parts.w) / W))];
  const L = (X, Y) => { const o = (Y * W + X) * 4; return rgbToLab(photo[o], photo[o + 1], photo[o + 2]); };
  // Their hair's color: what the maps are sure is hair, around the face (not in it).
  const hs = [[], [], []];
  for (let y = by0; y < by1; y += 2) for (let x = bx0; x < bx1; x += 2) if (!inFace[(y - by0) * bw + x - bx0] && hairAt(x, y) >= 200) { const c = L(x, y); for (let k = 0; k < 3; k++) hs[k].push(c[k]); }
  const skin = skinModel(photo, W, H, face);
  const hairColor = hs[0].length >= 30 ? hs.map((a) => { a.sort((p, q) => p - q); const m = a[a.length >> 1]; const mad = a.map((v) => Math.abs(v - m)).sort((p, q) => p - q)[a.length >> 1]; return [m, Math.max(3, mad * 1.5)]; }) : null;
  const noseY = face.pts[30][1] * H;
  const m = new Uint8Array(bw * bh); let any = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x; const X = bx0 + x; const Y = by0 + y;
    const hm = hairAt(X, Y);
    if (inFace[k] && hm >= 128) { m[k] = Math.min(255, hm); any++; continue; }
    // (Their hair's color, not their skin's: above the nose, or outside the face (where it hangs from).)
    if (!hairColor || (inFace[k] && Y > noseY)) continue;
    const c = L(X, Y);
    const dh = Math.hypot((c[0] - hairColor[0][0]) / hairColor[0][1], (c[1] - hairColor[1][0]) / hairColor[1][1], (c[2] - hairColor[2][0]) / hairColor[2][1]);
    const ds = skin ? skin.off(c[0], c[1], c[2]) : 9;
    if (dh < 2.2 && ds > 2.5) { m[k] = inFace[k] ? 200 : 1; if (inFace[k]) any++; }
  }
  if (!any) return null;
  // Only what's joined to their hair (bangs hang from it): a dark brow or an eye inside the face isn't bangs.
  const keep = new Uint8Array(bw * bh); const st = [];
  for (let k = 0; k < bw * bh; k++) { const X = bx0 + (k % bw); const Y = by0 + ((k / bw) | 0); if (m[k] && (hairAt(X, Y) >= 128 || !inFace[k])) { keep[k] = 1; st.push(k); } }
  for (let a = 0; a < st.length; a++) { const k = st[a]; const x = k % bw; const y = (k / bw) | 0; for (const t of [x > 0 ? k - 1 : -1, x < bw - 1 ? k + 1 : -1, y > 0 ? k - bw : -1, y < bh - 1 ? k + bw : -1]) if (t >= 0 && m[t] && !keep[t]) { keep[t] = 1; st.push(t); } }
  const out = new Uint8Array(W * H); let n = 0;
  for (let k = 0; k < bw * bh; k++) if (keep[k] && inFace[k] && m[k] > 1) { out[(by0 + ((k / bw) | 0)) * W + bx0 + (k % bw)] = m[k]; n++; }
  // (Too little to be bangs: a strand the maps already keep in front.)
  if (n < fw * fw * 0.01) return null;
  // (Its edge softened a pixel or two: hair's edge isn't a cut.)
  const r = Math.max(1, Math.round(fw / 120)); const soft = new Uint8Array(W * H);
  for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
    let s = 0; let c = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx; const Y = y + dy; if (X >= 0 && Y >= 0 && X < W && Y < H) { s += out[Y * W + X]; c++; } }
    soft[y * W + x] = Math.max(out[y * W + x], Math.round(s / c));
  }
  return soft;
}

/**
 * `photo` with the bangs (`bangs`, from bangsMap) filled in from the skin around them, smoothly: what the
 * colors and the light of the face are worked out from, so the hair over it isn't taken for its skin. A copy.
 */
export function debang(photo, W, H, bangs, face = null) {
  const out = Uint8ClampedArray.from(photo);
  let x0 = W; let y0 = H; let x1 = 0; let y1 = 0;
  for (let i = 0; i < W * H; i++) if (bangs[i] >= 40) { const x = i % W; const y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) return out;
  const pad = 3; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const bw = x1 - x0 + 1; const bh = y1 - y0 + 1;
  const val = new Float32Array(bw * bh * 3); const free = new Uint8Array(bw * bh);
  // (Filled from their skin only: what isn't skin around the bangs (more hair, the background) held at the
  // skin's own color, so no hair color seeps in.)
  const skin = face ? skinModel(photo, W, H, face) : null;
  const isSkin = (i) => !skin || skin.isSkin(photo[i * 4], photo[i * 4 + 1], photo[i * 4 + 2]);
  const mean = [0, 0, 0]; let ns = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const i = (y0 + y) * W + x0 + x; if (bangs[i] < 40 && skin && isSkin(i)) { for (let c = 0; c < 3; c++) mean[c] += photo[i * 4 + c]; ns++; } }
  if (!ns && skin && face) { const P = face.pts; for (const j of [29, 30, 31, 35, 2, 14]) { const X = Math.round(P[j][0] * W); const Y = Math.round(P[j][1] * H); if (X >= 0 && Y >= 0 && X < W && Y < H) { const i = Y * W + X; for (let c = 0; c < 3; c++) mean[c] += photo[i * 4 + c]; ns++; } } }
  for (let c = 0; c < 3; c++) mean[c] = ns ? mean[c] / ns : 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = (y0 + y) * W + x0 + x; const k = y * bw + x;
    const hold = ns && bangs[i] < 40 && !isSkin(i);
    for (let c = 0; c < 3; c++) val[k * 3 + c] = hold ? mean[c] : photo[i * 4 + c];
    if (bangs[i] >= 40 && x > 0 && y > 0 && x < bw - 1 && y < bh - 1) free[k] = 1;
  }
  membrane(val, free, bw, bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x; if (!free[k]) continue; const i = (y0 + y) * W + x0 + x;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(val[k * 3 + c]);
  }
  return out;
}
