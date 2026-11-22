// Fashion's picture, put together (the preview, and the same at full size when saved): the piece's layer
// (one piece; or a top's body and sleeves each fitted to its own, or each shoe to its foot), moved and
// turned by hand, finished (light, form, what's kept in front), over the base, with what was worn there
// taken off where the piece doesn't cover it (Replace).

import { renderPiece, mergeLayers, finishLayer, lightGains, formMap, armsInFront, boxOf, traceTransfer, foldMap, rowSpans, upperParts, bareArm, isZone, matteBand, skinTexture, fillHoles, findPrints, kindZone } from '../../tools/fashion/fashion-core.js';
import { boxBlur } from '../../lib/geometry.js';
import { softenMask } from '../../lib/geometry.js';
import { rgbToLab, labToRgb } from '../../lib/color-match.js';
import { cleanUp, membrane } from '../../tools/editor/cleanup.js';
import { engineFor, engineLayer } from './engine.js';

/**
 * What's worn there and what of it the hair hides (long hair over a shirt): the garment goes on under the
 * hair, and the hair is laid back over it (what's kept in front). The target with that added, once.
 */
/**
 * Where someone in front hides part of what's worn (a group photo: the next person's arm across their side):
 * row by row, the garment's two sides measured from the body's middle (from the pose: the line from between
 * the shoulders to between the hips); where one side is clearly shorter and right past its edge is someone
 * else, it's taken to go on behind them as far as the other side reaches (never past what's someone else
 * there, and not beyond the photo). A mask of those pixels (to lay in and keep them in front of), or null.
 */
function behindOthers(S, m) {
  const { base, target } = S; const A = base.allPeople; const p = base.people; const q = base.pose;
  if (!p || !q) return null;
  const seen = (v) => v && v[2] >= 0.3;
  if (!seen(q.shoulders[0]) || !seen(q.shoulders[1])) return null;
  const { w, h } = base; const b = target.box;
  const ms = [(q.shoulders[0][0] + q.shoulders[1][0]) / 2, (q.shoulders[0][1] + q.shoulders[1][1]) / 2];
  const mh = seen(q.hips[0]) && seen(q.hips[1]) ? [(q.hips[0][0] + q.hips[1][0]) / 2, (q.hips[0][1] + q.hips[1][1]) / 2] : [ms[0], ms[1] + Math.abs(q.shoulders[1][0] - q.shoulders[0][0]) * 1.6];
  const cxAt = (y) => ms[0] + ((mh[0] - ms[0]) * (y - ms[1])) / Math.max(1, mh[1] - ms[1]);
  // (Half the body's width there, from the pose: about half the shoulders' at the top, the hips' lower down.)
  const shHalf = Math.abs(q.shoulders[1][0] - q.shoulders[0][0]) / 2;
  const hipHalf = seen(q.hips[0]) && seen(q.hips[1]) ? Math.abs(q.hips[1][0] - q.hips[0][0]) / 2 * 1.35 : shHalf * 0.85;
  const halfAt = (y) => { const t = Math.max(0, Math.min(1, (y - ms[1]) / Math.max(1, mh[1] - ms[1]))); return shHalf * 1.05 * (1 - t) + hipHalf * t; };
  const other = (i) => !!A && A !== p && Math.max(A.body[i], A.clothes[i], A.hair[i], A.face[i], A.others[i]) >= 128 && Math.max(p.body[i], p.clothes[i], p.hair[i], p.face[i], p.others[i]) < 128;
  const occ = new Uint8Array(w * h); let n = 0;
  // (Where a side runs off the photo: where its edge would be, past the photo's own edge, row by row.)
  const reach = new Float32Array((b.y1 - b.y0) * 2).fill(NaN);
  for (let y = b.y0; y < b.y1; y++) {
    let l = -1; let r = -1; for (let x = b.x0; x < b.x1; x++) if (m[y * w + x]) { if (l < 0) l = x; r = x; }
    if (l < 0) continue;
    const cx = cxAt(y); const hl = cx - l; const hr = r - cx;
    const cutL = l <= 1; const cutR = r >= w - 2;
    // (What's past each side: someone else (in front of it), right there.)
    const blocked = (side, edge) => { let x = edge + side; let t = 0; let k = 0; while (k < 6 && x >= 0 && x < w) { if (other(y * w + x)) t++; k++; x += side; } return k > 0 && t >= Math.min(k, 3); };
    const occL = !cutL && blocked(-1, l); const occR = !cutR && blocked(1, r);
    // (Each side's true reach: what's seen of it, unless it's hidden or cut off; then the other side's, if
    // that one's whole, or the body's half-width.)
    const full = halfAt(y);
    const trueL = occL || cutL ? Math.max(hl, !(occR || cutR) ? hr : full) : hl;
    const trueR = occR || cutR ? Math.max(hr, !(occL || cutL) ? hl : full) : hr;
    for (const [side, edge, seenHalf, want, isOcc] of [[-1, l, hl, trueL, occL], [1, r, hr, trueR, occR]]) {
      if (!isOcc || want < seenHalf * 1.05) continue;
      const goal = Math.round(cx + side * want);
      let x = edge + side; let gap = 0;
      while (side < 0 ? x >= Math.max(0, goal) : x <= Math.min(w - 1, goal)) {
        const i = y * w + x;
        if (other(i)) gap = 0; else if (++gap > 2) break;
        if (!m[i]) { occ[i] = 1; n++; }
        x += side;
      }
    }
    if (cutL && trueL > hl + 1) reach[(y - b.y0) * 2] = cx - trueL;
    if (cutR && trueR > hr + 1) reach[(y - b.y0) * 2 + 1] = cx + trueR;
  }
  const anyReach = reach.some((v) => !Number.isNaN(v));
  return n > 20 || anyReach ? { occ: n > 20 ? occ : null, reach: anyReach ? reach : null, y0: b.y0 } : null;
}

function underHair(S) {
  const { base, target } = S; const p = base.people;
  if (!p) return target;
  if (target.under?.of === target) return target.under;
  const { w } = base; const b = target.box; const m = Uint8Array.from(target.mask);
  for (let y = b.y0; y < b.y1; y++) {
    let l = -1; let r = -1; for (let x = b.x0; x < b.x1; x++) if (target.mask[y * w + x]) { if (l < 0) l = x; r = x; }
    // (Hair, however faint, and what's faintly clothes there: the old garment between the strands.)
    for (let x = l + 1; x < r; x++) { const i = y * w + x; if (!m[i] && (p.hair[i] >= 30 || p.clothes[i] >= 40)) m[i] = 2; }
  }
  // (Only what's joined to the garment: a thin chain on the bare chest above it isn't part of it.)
  {
    const st = []; for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) { const i = y * w + x; if (m[i] === 2 && ((x > 0 && m[i - 1] === 1) || (x < w - 1 && m[i + 1] === 1) || m[i - w] === 1 || m[i + w] === 1)) { m[i] = 1; st.push(i); } }
    for (let a = 0; a < st.length; a++) { const i = st[a]; for (const t of [i - 1, i + 1, i - w, i + w]) if (t >= 0 && t < m.length && m[t] === 2) { m[t] = 1; st.push(t); } }
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (m[y * w + x] === 2) m[y * w + x] = 0;
  }
  // (Its neckline: the bare skin between its sides, row by row, down to the chest; the piece decides, pixel
  // by pixel, what of it it covers (see neckline).)
  // (Only the skin joined to the neck: a hand across the chest isn't neckline.)
  let neckSkin = null;
  if (S.base.layout && ['top', 'dress'].includes(S.kind)) {
    const L = S.base.layout; const yEnd = Math.min(b.y1, Math.round(L.chin + L.fh * 1.3)); const H0 = S.base.h;
    const cand = new Uint8Array(w * H0);
    for (let y = Math.max(b.y0, Math.round(L.chin + L.fh * 0.15)); y < yEnd; y++) {
      let l = -1; let r = -1; for (let x = b.x0; x < b.x1; x++) if (target.mask[y * w + x]) { if (l < 0) l = x; r = x; }
      for (let x = l + 1; x < r; x++) { const i = y * w + x; if (!m[i] && p.body[i] >= 128 && p.face[i] < 128) cand[i] = 1; }
    }
    // (Grown from the neck down: the skin just under the chin, then what touches it.)
    neckSkin = new Uint8Array(w * H0); const st = [];
    for (let y = Math.max(0, Math.round(L.chin)); y < Math.min(H0, Math.round(L.chin + L.fh * 0.45)); y++) for (let x = b.x0; x < b.x1; x++) { const i = y * w + x; if (cand[i] || (p.body[i] >= 128 && p.face[i] < 128)) { if (cand[i]) neckSkin[i] = 1; st.push(i); } }
    const seen = new Uint8Array(w * H0); for (const i of st) seen[i] = 1;
    for (let a = 0; a < st.length; a++) { const i = st[a]; for (const t of [i - 1, i + 1, i - w, i + w]) if (t >= 0 && t < w * H0 && !seen[t] && cand[t]) { seen[t] = 1; neckSkin[t] = 1; st.push(t); } }
    for (let i = 0; i < w * H0; i++) if (neckSkin[i]) m[i] = 1;
  }
  // (What of it someone in front hides (the arm of the person beside them, across their side): the garment
  // goes on behind them, as wide as its other side, mirrored about the body's middle. It's laid in there at
  // its full width, so it isn't squeezed into what's seen; and they stay in front of it (`occ`).)
  const hidden = behindOthers(S, m); const occ = hidden?.occ ?? null;
  // (And a pixel past its outline: the old garment's soft rim is covered too, no outline of it left.)
  const g = Uint8Array.from(m); const H = base.h;
  for (let y = Math.max(1, b.y0 - 1); y < Math.min(H - 1, b.y1 + 1); y++) for (let x = Math.max(1, b.x0 - 1); x < Math.min(w - 1, b.x1 + 1); x++) { const i = y * w + x; if (!m[i] && (m[i - 1] || m[i + 1] || m[i - w] || m[i + w]) && p.face[i] < 128 && p.hair[i] < 128) g[i] = 1; }
  const gb = { x0: Math.max(0, b.x0 - 1), y0: Math.max(0, b.y0 - 1), x1: Math.min(w, b.x1 + 1), y1: Math.min(H, b.y1 + 1) };
  // (Its edges smoothed over many rows for laying the design in: an arm cutting into its side doesn't make
  // the design jump from row to row.)
  if (occ) for (let i = 0; i < g.length; i++) if (occ[i]) g[i] = 1;
  const gb2 = occ ? (boxOf(g, w, H) ?? gb) : gb;
  const spans = rowSpans(g, w, gb2, Math.max(14, Math.round((gb2.y1 - gb2.y0) / 14)));
  // (A side running off the photo: laid in as if it went on past the edge, as far as the body does, so the
  // design keeps its place on the body (a number on the chest stays in the chest's middle).)
  if (hidden?.reach) {
    const R = hidden.reach; const rows = R.length / 2; const raw = new Float32Array(R.length);
    // (Smoothed over a few rows: the edges of the guess don't jump.)
    for (let k = 0; k < rows; k++) for (const s2 of [0, 1]) { let sm = 0; let c = 0; for (let d = -6; d <= 6; d++) { const v = R[(k + d) * 2 + s2]; if (k + d >= 0 && k + d < rows && !Number.isNaN(v)) { sm += v; c++; } } raw[k * 2 + s2] = c && !Number.isNaN(R[k * 2 + s2]) ? sm / c : NaN; }
    for (let k = 0; k < rows; k++) {
      const y = hidden.y0 + k; const ky = y - gb2.y0; if (ky < 0 || ky >= gb2.y1 - gb2.y0 || spans[ky * 2] < 0) continue;
      if (!Number.isNaN(raw[k * 2])) spans[ky * 2] = Math.min(spans[ky * 2], raw[k * 2]);
      if (!Number.isNaN(raw[k * 2 + 1])) spans[ky * 2 + 1] = Math.max(spans[ky * 2 + 1], raw[k * 2 + 1]);
    }
  }
  const under = { ...target, mask: g, box: gb2, spans, of: target, under: null, soft: null, neckSkin, occ };
  target.under = under;
  return under;
}

/** What of the outline is the base's clothes (not its skin, a neckline): where its folds are read from. */
function clothesOf(S) {
  const u = underHair(S); const p = S.base.people;
  if (!p) return u.mask;
  if (u.clothesOnly) return u.clothesOnly;
  const m = new Uint8Array(u.mask.length); for (let i = 0; i < m.length; i++) m[i] = u.mask[i] && p.body[i] < 128 && p.face[i] < 128 ? 1 : 0;
  u.clothesOnly = m;
  return m;
}

/**
 * The piece's photo's bare skin, its neck included (the person finder may count the neck as face, or be
 * unsure of a neckline's skin): what it says is skin (fairly sure), or below the chin, the color of that
 * person's own face (its median, within a few shades) where it isn't said to be clothes (a white shirt's shadow
 * can be a pale person's skin color), once.
 */
function pieceSkin(piece) {
  const p = piece.people; if (!p) return null;
  if (piece.skinMap?.length === p.body.length) return piece.skinMap;
  const n = p.body.length; const W = piece.w; const chin = piece.layout ? piece.layout.chin : 0; const px = piece.rgba;
  const v = [[], [], []]; for (let i = 0; i < n; i += 2) if (p.face[i] >= 200) for (let c = 0; c < 3; c++) v[c].push(px[i * 4 + c]);
  const tone = v[0].length > 40 ? v.map((a2) => { a2.sort((x, y) => x - y); return a2[a2.length >> 1]; }) : null;
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const below = i / W > chin - 2;
    let s2 = Math.max(p.body[i] >= 90 ? 255 : 0, below && p.face[i] >= 90 ? 255 : 0);
    if (!s2 && below && tone && p.hair[i] < 128 && p.clothes[i] < 128) {
      const d = Math.abs(px[i * 4] - tone[0]) + Math.abs(px[i * 4 + 1] - tone[1]) + Math.abs(px[i * 4 + 2] - tone[2]);
      if (d < 70) s2 = 255;
    }
    m[i] = s2;
  }
  piece.skinMap = m;
  return m;
}

/**
 * Where the base shows its own bare skin (a neckline, the neck), only cloth seen in the piece's photo covers
 * it; the piece's skin, a gap in it, or what was rebuilt under its hair lets the base's skin show. (Where
 * the base is clothed there, the cloth carries on: skin made up from nothing looks painted on.) Decided for
 * each patch of it (the neck and neckline, a bare shoulder) as a whole, not pixel by pixel (an island of
 * cloth in it looks cut out): when most of a patch meets the piece's own cloth, the piece covers it (a
 * higher neckline, a jacket's shoulders); otherwise the base keeps its skin there. In place on the layer.
 */
function neckline(layer, base, w, zone = false, paint = true) {
  if (!layer.skin || !base.people) return;
  const { pw, ph, x0, y0 } = layer; const n = pw * ph;
  const isBare = (k) => { const i = (y0 + ((k / pw) | 0)) * w + x0 + (k % pw); return base.people.body[i] >= 128 || base.people.face[i] >= 128; };
  // Each patch of the base's bare skin in it (the neck and neckline, a bare shoulder) decided on its own.
  const lab = new Int32Array(n); let id = 0;
  for (let k0 = 0; k0 < n; k0++) {
    if (lab[k0] || !layer.rgba[k0 * 4 + 3] || !isBare(k0)) continue;
    id++; const q = [k0]; lab[k0] = id; let cloth = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const k = q[qi]; if (!layer.skin[k]) cloth++;
      const x = k % pw; const y = (k / pw) | 0;
      for (const t of [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, y > 0 ? k - pw : -1, y < ph - 1 ? k + pw : -1]) if (t >= 0 && !lab[t] && layer.rgba[t * 4 + 3] && isBare(t)) { lab[t] = id; q.push(t); }
    }
    // (The neckline's patch, the one reaching up to the neck: the piece's own neckline, pixel by pixel,
    // smoothed; any other patch, a bare shoulder, decided whole.)
    const neckPatch = base.layout && q.some((k) => y0 + ((k / pw) | 0) < base.layout.chin + base.layout.fh * 0.35);
    if (neckPatch) {
      const keep = new Uint8Array(q.length);
      const inQ = new Map(q.map((k, j) => [k, j]));
      q.forEach((k, j) => { keep[j] = layer.skin[k] ? 0 : 1; });
      // (A majority of the 5×5 around each: no ragged edge, no lone specks.)
      const sm = q.map((k, j) => { let a = 0; let n = 0; const x = k % pw; const y = (k / pw) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const jj = inQ.get((y + dy) * pw + x + dx); if (jj !== undefined && x + dx >= 0 && x + dx < pw) { a += keep[jj]; n++; } } return a * 2 > n; });
      // (Skin only where it's joined to the neck: a speck of it inside the cloth stays cloth.)
      const open = new Uint8Array(q.length); const st = [];
      q.forEach((k, j) => { if (!sm[j] && y0 + ((k / pw) | 0) < base.layout.chin + base.layout.fh * 0.35) { open[j] = 1; st.push(j); } });
      for (let a = 0; a < st.length; a++) { const k = q[st[a]]; const x = k % pw; const y = (k / pw) | 0; for (const t of [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, y > 0 ? k - pw : -1, y < ph - 1 ? k + pw : -1]) { const jj = t >= 0 ? inQ.get(t) : undefined; if (jj !== undefined && !sm[jj] && !open[jj]) { open[jj] = 1; st.push(jj); } } }
      // (And not a sliver of it: a skin pixel with few others around it stays cloth.)
      const thick = q.map((k, j) => { if (!open[j]) return false; let a = 0; const x = k % pw; const y = (k / pw) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const jj = x + dx >= 0 && x + dx < pw ? inQ.get((y + dy) * pw + x + dx) : undefined; if (jj !== undefined && open[jj]) a++; } return a >= 9; });
      q.forEach((k, j) => { const i = (y0 + ((k / pw) | 0)) * w + x0 + (k % pw); if (thick[j] || base.people.face[i] >= 128) layer.rgba[k * 4 + 3] = 0; });
      continue;
    }
    // (A speck of skin inside the old garment, too small to be a neckline or a shoulder: covered.)
    const cover = cloth / q.length > 0.6 || (base.layout && q.length < (base.layout.fh * 0.25) ** 2);
    for (const k of q) { const i = (y0 + ((k / pw) | 0)) * w + x0 + (k % pw); if (!cover || base.people.face[i] >= 128) layer.rgba[k * 4 + 3] = 0; }
  }
  // A lower neckline than the base's: where the piece shows its skin and the base was clothed, near the
  // neckline and joined to the base's own skin there, the base person's skin, shaded as the light on what
  // they wore there.
  if (paint && !zone && layer.neck && base.layout) {
    const tone = skinTone(base);
    if (tone) {
      const lowest = base.layout.chin + base.layout.fh * 1.3 - y0;
      const hairAt = (k) => base.people.hair[(y0 + ((k / pw) | 0)) * w + x0 + (k % pw)] >= 60;
      const want = new Uint8Array(n); for (let k = 0; k < n; k++) if (layer.neck[k] && layer.rgba[k * 4 + 3] && !isBare(k) && !hairAt(k) && (k / pw) < lowest) want[k] = 1;
      // (Grown from the base's own skin next to it: what isn't joined to it stays cloth.)
      const reach = new Uint8Array(n); const qq = [];
      for (let k = 0; k < n; k++) if (want[k]) { const x = k % pw; const y = (k / pw) | 0; for (const t of [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, y > 0 ? k - pw : -1, y < ph - 1 ? k + pw : -1]) if (t >= 0 && !want[t] && isBare(t)) { reach[k] = 1; qq.push(k); break; } }
      for (let a = 0; a < qq.length; a++) { const k = qq[a]; const x = k % pw; const y = (k / pw) | 0; for (const t of [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, y > 0 ? k - pw : -1, y < ph - 1 ? k + pw : -1]) if (t >= 0 && want[t] && !reach[t]) { reach[t] = 1; qq.push(t); } }
      if (qq.length > (base.layout.fh * 0.3) ** 2) {
        const lum = []; for (const k of qq) { const i = (y0 + ((k / pw) | 0)) * w + x0 + (k % pw); lum.push(base.rgba[i * 4] + base.rgba[i * 4 + 1] + base.rgba[i * 4 + 2]); }
        const sorted = [...lum].sort((a2, b2) => a2 - b2); const mid = sorted[sorted.length >> 1] || 1; const sd = skinDetailOf(base);
        let seed = 9;
        qq.forEach((k, j) => {
          seed = (seed * 1103515245 + 12345) >>> 0; const g = ((seed / 4294967296) - 0.5) * 4;
          const sh = Math.max(0.7, Math.min(1.25, lum[j] / mid));
          const dt = sd ? sd(x0 + (k % pw), y0 + ((k / pw) | 0)) : null;
          for (let c = 0; c < 3; c++) layer.rgba[k * 4 + c] = tone[c] * sh + (dt ? dt[c] * sh : g);
        });
      }
    }
  }
  // A body zone: where the piece shows its bare skin (a tank top's shoulders) and the base was clothed
  // there, the base person's skin (their color, lit round by the folds of the light on them later).
  // (Only at the shoulders and chest, what a neckline or a tank top shows: lower down, the piece's skin is
  // an arm or a hand across it, and the cloth carries on under it.)
  if (zone && layer.bare) {
    const tone = skinTone(base); if (!tone) return;
    const lowest = base.layout ? base.layout.chin + base.layout.fh * 1.4 - y0 : ph;
    const sdz = skinDetailOf(base);
    let seed = 5;
    for (let k = 0; k < n; k++) {
      if (!layer.bare[k] || !layer.rgba[k * 4 + 3] || isBare(k) || (k / pw) > lowest) continue;
      seed = (seed * 1103515245 + 12345) >>> 0; const g = ((seed / 4294967296) - 0.5) * 4;
      const dt = sdz ? sdz(x0 + (k % pw), y0 + ((k / pw) | 0)) : null;
      for (let c = 0; c < 3; c++) layer.rgba[k * 4 + c] = tone[c] + (dt ? dt[c] : g);
    }
  }
}

/** The layer's edge: the outline's own, softened a pixel. In place. */
function softEdge(layer, outline, w, h) {
  if (outline.soft?.length !== w * h) outline.soft = softenMask(outline.mask, w, h, 1);
  for (let y = 0; y < layer.ph; y++) for (let x = 0; x < layer.pw; x++) { const o = (y * layer.pw + x) * 4; if (layer.rgba[o + 3]) layer.rgba[o + 3] = Math.round(255 * Math.min(1, outline.soft[(layer.y0 + y) * w + layer.x0 + x] * 1.15)); }
}

/** A mask's part within [c0, c1) columns, as an outline { mask, box, spans } (or null). */
function cut(m, w, h, c0, c1, extra = null) {
  const o = new Uint8Array(w * h); let n = 0;
  for (let i = 0; i < m.length; i++) { const x = i % w; if ((m[i] || (extra && extra[i])) && x >= c0 && x < c1) { o[i] = 1; n++; } }
  if (!n) return null;
  const b = boxOf(o, w, h);
  return b && { mask: o, box: b, spans: rowSpans(o, w, b, Math.max(8, Math.round((b.y1 - b.y0) / 14))) };
}

/**
 * A body zone from one person onto another, part by part. The torso: the piece's design laid into the
 * base's (its neckline decided as above). Each arm, as each is covered (a sleeve) or bare:
 * sleeve onto sleeve — the piece's sleeve laid into the base's; sleeve onto a bare arm — the piece's
 * sleeve laid over the base's arm, in the arm's shape; a bare arm onto a sleeve — the base's sleeve
 * taken off: a bare arm in their skin tone, lit round, the rest of the sleeve filled from what's beside
 * it; bare onto bare — the base's own arm. One layer.
 */
function zoneLayer(S) {
  const { base, piece, target, place, tune, kind } = S; const { w, h } = base;
  const key = `${kind}`;
  if (base.parts?.key !== key || base.parts.of !== base.layout || base.parts.pose !== base.pose) base.parts = { key, of: base.layout, pose: base.pose, v: upperParts(base.people, base.layout, w, h, kind, base.pose ?? null) };
  if (piece.zparts?.key !== key || piece.zparts.of !== piece.layout || piece.zparts.pose !== piece.pose) piece.zparts = { key, of: piece.layout, pose: piece.pose, v: upperParts(piece.people, piece.layout, piece.w, piece.h, kind, piece.pose ?? null) };
  const bp = base.parts.v; const pp = piece.zparts.v;
  if (!bp.torso || !pp.torso) return null;
  // Part by part when an arm differs clearly (in a sleeve on one, bare on the other: a tank top and a
  // jacket), or both are bare-armed; alike in sleeves (two tees), the zone is laid in whole.
  const differs = ['left', 'right'].some((k) => bp[k] && pp[k] && clearly(bp[k]) !== null && clearly(pp[k]) !== null && clearly(bp[k]) !== clearly(pp[k]));
  // (Or both bare-armed: torso onto torso, each keeping their own arms; laid in whole, one's arm would be
  // squeezed into the other's side.)
  const bare = (q) => !q || clearly(q) === false;
  // (The piece bare-armed, and the base too where both have an arm; a base "arm" with no arm of the piece's
  // beside it, covered, is taken as their torso's side: the person beside can hide the real one.)
  const bothBare = bare(pp.left) && bare(pp.right) && (pp.left || pp.right) && ['left', 'right'].every((k) => !(bp[k] && pp[k]) || bare(bp[k]));
  // (Or both people's poses known, arms and all: matched body to body, part by part (each sleeve bent onto its
  // own arm), whatever their sleeves: laid in whole, a turned or posed piece's sleeves and body would land
  // wherever the outline puts them.)
  const poseMatch = !bothBare && !!bp.byPose && !!pieceArms(S) && ['left', 'right'].some((k) => !!base.pose?.elbows?.[k === 'left' ? 0 : 1]);
  if (!differs && !bothBare && !poseMatch) return null;
  const under = underHair(S);
  // Both bare-armed (a tank top onto someone in a tank top): only the clothes change. The piece's clothes
  // laid into the base's, and every bit of the base person's own skin (their arms, shoulders, an arm cut
  // off by the photo's edge) left exactly as it is.
  if (bothBare && !differs && !poseMatch) {
    const tC = new Uint8Array(w * h); for (let i = 0; i < tC.length; i++) if ((under.mask[i] && base.people.clothes[i] >= 110 && base.people.body[i] < 160) || under.occ?.[i]) tC[i] = 1;
    const pC = new Uint8Array(piece.w * piece.h); const pm0 = piece.solid ?? piece.sel; for (let i = 0; i < pC.length; i++) if (pm0[i] && (piece.people.clothes[i] >= 110 || piece.rebuilt?.[i]) && piece.people.body[i] < 160) pC[i] = 1;
    let tCb = boxOf(tC, w, h); let pCb = boxOf(pC, piece.w, piece.h);
    if (!tCb || !pCb) return null;
    // (Holes inside the clothes, prints the finder didn't call clothes (a white number, yellow lettering):
    // part of them.)
    fillHoles(tC, w, h, tCb, 0.3); fillHoles(pC, piece.w, piece.h, pCb, 0.3);
    tCb = boxOf(tC, w, h); pCb = boxOf(pC, piece.w, piece.h);
    let tO = { mask: tC, box: tCb, spans: rowSpans(tC, w, tCb, Math.max(8, Math.round((tCb.y1 - tCb.y0) / 14))) };
    if (erasing(S)) { const z = garmentZone(S); if (z) { tO = withZone(tO, z, w, h); tCb = tO.box; } }
    // (A side running off the photo: as far past its edge as the whole outline's goes.)
    for (let y = tCb.y0; y < tCb.y1; y++) {
      const ky = y - tCb.y0; const ku = y - under.box.y0; if (tO.spans[ky * 2 + 1] < 0 || ku < 0 || ku >= under.box.y1 - under.box.y0 || under.spans[ku * 2 + 1] < 0) continue;
      if (under.spans[ku * 2] < 0.5 && tO.spans[ky * 2] <= 2) tO.spans[ky * 2] = Math.min(tO.spans[ky * 2], under.spans[ku * 2]);
      if (under.spans[ku * 2 + 1] > w - 0.5 && tO.spans[ky * 2 + 1] >= w - 2) tO.spans[ky * 2 + 1] = Math.max(tO.spans[ky * 2 + 1], under.spans[ku * 2 + 1]);
    }
    const open = tCb.y1 >= h - 2 || pCb.y1 >= piece.h - 2;
    const L = traceTransfer(piece.draw ?? piece.rgba, pC, piece.w, piece.h, pCb, tO, w, h, { s: place.s, open, adj: tune, skin: pieceSkin(piece), rebuilt: piece.rebuilt ?? null, rows: poseRows(S), centers: frontCenters(S) });
    neckline(L, base, w, false, false); softEdge(L, tO, w, h);
    return L;
  }
  const pm = piece.solid ?? piece.sel; const tex = piece.draw ?? piece.rgba; const sk = pieceSkin(piece);
  const layers = [];
  // The torso.
  // (The torso: what's worn there less the arms; by the pose when it was found, else by columns.)
  const minus = (m, arms) => { const o = Uint8Array.from(m); for (let i = 0; i < o.length; i++) if (arms[i]) o[i] = 0; return o; };
  // (Their whole torso, its bare skin too (a tank top's shoulders), not only what's worn on it: skin and
  // cloth are told apart below, patch by patch.)
  const withTorso = (m, part) => { const o = Uint8Array.from(m); if (part) for (let i = 0; i < o.length; i++) if (part.mask[i]) o[i] = 1; return o; };
  // (Each zone's own bottom edge, column by column (its waist, tilted with the hips, as raised or lowered
  // by hand): the torso the arms were told from goes down to its own idea of the waist, not past this.)
  const clip = (m, ref, W, H, box) => {
    if (S.kind !== 'upper') return m;
    const o = Uint8Array.from(m); const low = new Int32Array(W).fill(-1);
    for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) if (ref[y * W + x]) low[x] = y;
    for (let x = 0; x < W; x++) for (let y = (low[x] < 0 ? 0 : low[x] + 1); y < H; y++) o[y * W + x] = 0;
    return o;
  };
  const tAll = clip(withTorso(under.mask, bp.torso), target.mask, w, h, target.box); const pAll = clip(withTorso(pm, pp.torso), pm, piece.w, piece.h, piece.box);
  // (Both bare-armed: only the base's bare arms are theirs to keep; anything else of the zone is torso.)
  const tArms = !differs && !poseMatch && bp.byPose ? (() => { const o = new Uint8Array(w * h); for (const k of ['left', 'right']) if (bp[k] && bare(bp[k])) for (let i = 0; i < o.length; i++) if (bp[k].mask[i]) o[i] = 1; return o; })() : bp.arms;
  // (Matched body to body: the body laid onto the torso and the shoulders' caps too (its shoulders onto
  // theirs); the sleeves go on the arms below them.)
  const capArms = poseMatch ? (() => { const o = Uint8Array.from(tArms); const q = base.pose; const sp = Math.hypot(q.shoulders[1][0] - q.shoulders[0][0], q.shoulders[1][1] - q.shoulders[0][1]); const R = sp * 0.22; for (const S0 of q.shoulders) for (let y = Math.max(0, Math.floor(S0[1] - R)); y < Math.min(h, S0[1] + R); y++) for (let x = Math.max(0, Math.floor(S0[0] - R)); x < Math.min(w, S0[0] + R); x++) if (Math.hypot(x - S0[0], y - S0[1]) < R) o[y * w + x] = 0; return o; })() : tArms;
  const tT = bp.byPose ? cut(minus(tAll, capArms), w, h, -1, w + 1) : cut(tAll, w, h, bp.t0, bp.t1);
  // (The piece's arms by its pose, when both people's are known: whatever of its selection lies along each
  // arm, outside the torso. Its torso is the rest: nothing of a sleeve laid onto the base's shoulder.)
  const pArms = pieceArms(S);
  const pArmAll = pArms && (() => { const o = new Uint8Array(piece.w * piece.h); for (const a of pArms) if (a) for (let i = 0; i < o.length; i++) if (a[i]) o[i] = 1; return o; })();
  const pT = pArmAll ? cut(minus(pAll, pArmAll), piece.w, piece.h, -1, piece.w + 1) : pp.byPose ? cut(minus(pAll, pp.arms), piece.w, piece.h, -1, piece.w + 1) : cut(pAll, piece.w, piece.h, pp.t0, pp.t1);
  if (tT && pT) {
    // (Only the piece's cloth (not their hair or skin over it, a hand at their neck), cut at its real hem; and
    // the base's zone carried down to where what they wear there really ends.)
    const pc = Uint8Array.from(pT.mask); for (let i = 0; i < pc.length; i++) if (pc[i] && piece.people.clothes[i] < 110 && !piece.rebuilt?.[i]) pc[i] = 0;
    const pcb = boxOf(pc, piece.w, piece.h);
    const pH = pcb && hemCut(pc, pcb, piece.draw ?? piece.rgba, piece.w, piece.h);
    const pMask = pH?.mask ?? (pcb ? pc : pT.mask); const pBox = pH?.box ?? pcb ?? pT.box;
    let tD = base.layout.waistShift ? { ...tT, spans: tT.spans ?? rowSpans(tT.mask, w, tT.box, Math.max(8, Math.round((tT.box.y1 - tT.box.y0) / 14))) } : downToHem(S, tT);
    // (Taking off first: all of the garment worn there, wherever it shows, less their bare arms.)
    if (erasing(S)) { const z = garmentZone(S); if (z) { const zm = Uint8Array.from(z.mask); for (let i = 0; i < zm.length; i++) if (tArms?.[i] && base.people.clothes[i] < 100) zm[i] = 0; tD = withZone(tD, { ...z, mask: zm }, w, h); } }
    const centers = frontCenters(S); const rigid = centers && rigidZone(S);
    const open = tD.box.y1 >= h - 2 || pBox.y1 >= piece.h - 2;
    // (Both people's shoulders and hips known: the piece's body mapped onto theirs, frame to frame (body to
    // body, a turned one unturned), else laid in row by row.)
    // (Mapped body to body when either person is turned, or the piece is one person of a group (the person
    // beside them over its edges): laid in row by row, those come out in strips.)
    const L = (poseMatch && (rigid?.own || (piece.persons?.length ?? 0) > 1) && bodyWarp(S, tD)) || traceTransfer(tex, pMask, piece.w, piece.h, pBox, tD, w, h, { s: place.s, open, adj: tune, skin: sk, rebuilt: piece.rebuilt ?? null, rows: poseRows(S), centers, rigid });
    // (The piece's bare skin painted where the base was clothed only when an arm changes, a tank top onto a
    // jacket: both bare-armed, the base's own neckline and skin stay.)
    // (Nor, in a zone, the piece's own skin painted on: theirs and the base's both bare, the base keeps theirs.)
    neckline(L, base, w, differs, false);
    // (Under the chin, where the piece shows no cloth of its own (its open collar): their neck, as taken off,
    // not the cloth beside it carried across.)
    if (erasing(S) && L.skin && base.layout) {
      // (Faded out over a band, not cut at a row: no line across where the piece's own cloth begins.)
      // (All of the piece's own skin there (the model's neck, a necklace on it) gone, not faded: what shows is
      // their neck as made; the piece's cloth begins at its own collar's edge, feathered below.)
      const yTo = base.layout.chin + base.layout.fh * 0.95;
      // (Only the piece's own bare skin there (its open neck): what was rebuilt under its hair, and its shoulders,
      // stay.)
      const Fc = base.layout.face ? (base.layout.face.x0 + base.layout.face.x1) / 2 : L.x0 + L.pw / 2; const nw = base.layout.fw * 0.75;
      for (let y = 0; y < L.ph && L.y0 + y < yTo; y++) for (let x = 0; x < L.pw; x++) { const k2 = y * L.pw + x; if (L.bare?.[k2] || L.neck?.[k2]) L.rgba[k2 * 4 + 3] = 0; }
      // (And a thin line of something on that skin the finder called cloth (a necklace's chain): no cloth only a
      // few pixels tall with nothing of the piece above or below it there.)
      { const thin = Math.max(3, Math.round(base.layout.fh * 0.035)); const yEnd = Math.min(L.ph, Math.ceil(yTo - L.y0));
        for (let x = 0; x < L.pw; x++) { if (Math.abs(L.x0 + x - Fc) >= nw) continue; let y = 0; while (y < yEnd) { while (y < yEnd && L.rgba[(y * L.pw + x) * 4 + 3] === 0) y++; const a0 = y; while (y < L.ph && L.rgba[(y * L.pw + x) * 4 + 3] > 0) y++; if (a0 < yEnd && y - a0 <= thin && y < L.ph) for (let t = a0; t < y; t++) L.rgba[(t * L.pw + x) * 4 + 3] = 0; } } }
      featherOnSkin(L, S);
    }
    softEdge(L, tD, w, h); layers.push(L);
  }
  // The arms.
  const tone = skinTone(base);
  // (By both people's poses: each arm of the piece that has its cloth on it (a sleeve), bent onto the base's
  // arm on that side, bone to bone, whether or not the person finder told that arm apart.)
  const done2 = [false, false];
  if (pArms) for (const k of [0, 1]) {
    const a = pArms[k]; if (!a) continue;
    const pc = new Uint8Array(piece.w * piece.h); let n = 0;
    for (let i = 0; i < pc.length; i++) if (a[i] && (piece.people.clothes[i] >= 100 || piece.rebuilt?.[i])) { pc[i] = 1; n++; }
    const pb = n > 40 ? boxOf(pc, piece.w, piece.h) : null; if (!pb) continue;
    const bent = sleeveAlongArm(S, k, pc, pb);
    if (bent) { layers.push(bent); done2[k] = true; }
  }
  for (const side of ['left', 'right']) {
    if (done2[side === 'left' ? 0 : 1]) continue;
    const b = bp[side]; const p = pp[side]; if (!b || !p) continue;
    const pCl = cut(p.mask, piece.w, piece.h, -1, piece.w + 1);
    if (p.covered) {
      // A sleeve: into the base's sleeve, or over their bare arm in its shape.
      const pc = Uint8Array.from(pCl.mask); for (let i = 0; i < pc.length; i++) if (piece.people.clothes[i] < 100) pc[i] = 0;
      const pb = boxOf(pc, piece.w, piece.h); if (!pb) continue;
      // (Bent along both people's arms, shoulder to elbow to wrist: a sleeve on a raised arm laid onto an arm
      // held down keeps its own shape, turned with the arm, not pressed row by row into its outline.)
      const bent = sleeveAlongArm(S, side === 'left' ? 0 : 1, pc, pb);
      if (bent) { layers.push(bent); continue; }
      const tB = cut(b.mask, w, h, -1, w + 1);
      const L = traceTransfer(tex, pc, piece.w, piece.h, pb, tB, w, h, { s: place.s, open: false, adj: tune });
      softEdge(L, tB, w, h); layers.push(L);
    } else if (b.covered && tone) {
      // A bare arm where the base's sleeve was.
      const sl = Uint8Array.from(b.mask); for (let i = 0; i < sl.length; i++) if (base.people.clothes[i] < 100) sl[i] = 0;
      const sb = boxOf(sl, w, h); if (!sb) continue;
      layers.push(bareArm({ mask: sl, box: sb }, w, h, tone, base.people, skinDetailOf(base)));
    }
  }
  if (!layers.length) return null;
  // (The torso over the arms: drawn last.)
  return mergeLayers([...layers.slice(1), layers[0]]);
}


/**
 * The piece's two arms by its pose (picture left, right): each the pixels of its selection along that arm
 * (within a third of the shoulders' span of its shoulder → elbow → wrist, and a little past the wrist) that
 * aren't inside its torso (between its shoulders and hips). [mask | null, mask | null], or null without both
 * people's poses. Kept on the piece.
 */
export function pieceArms(S) {
  const { piece, base } = S; const q = piece.pose; const seen = (v) => v && v[2] >= 0.3;
  if (!q || !base.pose || !seen(q.shoulders?.[0]) || !seen(q.shoulders?.[1])) return null;
  const pm = piece.solid ?? piece.sel; if (!pm) return null;
  if (piece.armsOf?.m === pm && piece.armsOf.q === q) return piece.armsOf.v;
  const W = piece.w; const H = piece.h; const b = piece.box;
  const sw = Math.hypot(q.shoulders[1][0] - q.shoulders[0][0], q.shoulders[1][1] - q.shoulders[0][1]);
  const reach = sw * 0.34;
  const hips = seen(q.hips?.[0]) && seen(q.hips?.[1]) ? q.hips : [[q.shoulders[0][0], q.shoulders[0][1] + sw * 1.6], [q.shoulders[1][0], q.shoulders[1][1] + sw * 1.6]];
  // (Inside the torso: the quadrilateral shoulder, shoulder, hip, hip, its sides pulled in a little.)
  const quad = [q.shoulders[0], q.shoulders[1], hips[1], hips[0]].map((v) => [v[0], v[1]]);
  const cx = quad.reduce((a, v) => a + v[0], 0) / 4; const cy = quad.reduce((a, v) => a + v[1], 0) / 4;
  const shrunk = quad.map(([x, y]) => [cx + (x - cx) * 0.92, cy + (y - cy) * 0.98]);
  const inside = (x, y) => { let c = false; for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = shrunk[i]; const [xj, yj] = shrunk[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const segD = (x, y, a, c) => { const dx = c[0] - a[0]; const dy = c[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); };
  const v = [0, 1].map((k) => {
    if (!seen(q.elbows?.[k])) return null;
    const s0 = q.shoulders[k]; const e = q.elbows[k];
    const wr = seen(q.wrists?.[k]) ? q.wrists[k] : [e[0] + (e[0] - s0[0]) * 0.9, e[1] + (e[1] - s0[1]) * 0.9];
    const past = [wr[0] + (wr[0] - e[0]) * 0.25, wr[1] + (wr[1] - e[1]) * 0.25];
    const m = new Uint8Array(W * H); let n = 0;
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
      const i = y * W + x; if (!pm[i] || inside(x, y)) continue;
      const d = Math.min(segD(x, y, s0, e), segD(x, y, e, wr), segD(x, y, wr, past));
      // (Nearer this arm than the other.)
      const ok = d < reach; if (!ok) continue;
      m[i] = 1; n++;
    }
    return n > 40 ? m : null;
  });
  // (A pixel both arms reach goes to the nearer.)
  if (v[0] && v[1]) for (let i = 0; i < W * H; i++) if (v[0][i] && v[1][i]) { const x = i % W; const y = (i / W) | 0; const d = (k) => Math.min(segD(x, y, q.shoulders[k], q.elbows[k]), seen(q.wrists?.[k]) ? segD(x, y, q.elbows[k], q.wrists[k]) : 1e9); if (d(0) <= d(1)) v[1][i] = 0; else v[0][i] = 0; }
  piece.armsOf = { m: pm, q, v };
  return v;
}

/**
 * The piece's body laid onto the base person's, frame to frame: each person's torso is the four-sided shape
 * between their shoulders and hips (from their pose; hips not seen: the shoulders' line dropped by a torso's
 * length from the face), and each pixel of the base's outline `t` is placed in theirs by where it falls in
 * that shape (and past it, carried on), then taken from the same place in the piece's. So a piece photographed
 * turned (a three-quarter view) goes onto someone facing the camera unturned, its middle on their middle, its
 * sides on their sides, its zip, buttons and pockets in proportion. Where it lands off the piece's cloth (its
 * edge, hair over it), the cloth's color carried smoothly in; where it lands on the piece's own skin at the
 * top (its open neck), nothing (what's under it shows). A layer, or null without both people's frames.
 */
function bodyWarp(S, t) {
  const { base, piece } = S; const { w, h } = base;
  const seen = (v) => v && v[2] >= 0.3;
  const frame = (q, L) => {
    if (!q || !seen(q.shoulders?.[0]) || !seen(q.shoulders?.[1]) || !L) return null;
    const A = q.shoulders[0]; const B = q.shoulders[1];
    let D = seen(q.hips?.[0]) ? q.hips[0] : null; let C = seen(q.hips?.[1]) ? q.hips[1] : null;
    if (!D || !C) { const drop = L.fh * 2.4; D = [A[0], A[1] + drop]; C = [B[0], B[1] + drop]; }
    return [A, B, C, D].map((v) => [v[0], v[1]]);
  };
  const fb = frame(base.pose, base.layout); const fp = frame(piece.pose, piece.layout);
  if (!fb || !fp) return null;
  const at = (Q, u, v) => [(1 - v) * ((1 - u) * Q[0][0] + u * Q[1][0]) + v * ((1 - u) * Q[3][0] + u * Q[2][0]), (1 - v) * ((1 - u) * Q[0][1] + u * Q[1][1]) + v * ((1 - u) * Q[3][1] + u * Q[2][1])];
  // (Where a point falls in a four-sided shape: Newton's method from its middle.)
  const inv = (Q, x, y, g) => {
    let u = g?.[0] ?? 0.5; let v = g?.[1] ?? 0.5;
    for (let it = 0; it < 8; it++) {
      const [px, py] = at(Q, u, v); const ex = px - x; const ey = py - y;
      const du = [(1 - v) * (Q[1][0] - Q[0][0]) + v * (Q[2][0] - Q[3][0]), (1 - v) * (Q[1][1] - Q[0][1]) + v * (Q[2][1] - Q[3][1])];
      const dv = [(1 - u) * (Q[3][0] - Q[0][0]) + u * (Q[2][0] - Q[1][0]), (1 - u) * (Q[3][1] - Q[0][1]) + u * (Q[2][1] - Q[1][1])];
      const det = du[0] * dv[1] - du[1] * dv[0]; if (Math.abs(det) < 1e-6) break;
      const su = (ex * dv[1] - ey * dv[0]) / det; const sv = (du[0] * ey - du[1] * ex) / det;
      u -= su; v -= sv; if (Math.abs(su) + Math.abs(sv) < 1e-4) break;
    }
    return [u, v];
  };
  // The piece's cloth as a texture with its gaps filled: its own pixels where it's cloth (not skin, hair or
  // what's not it), the rest of its box carried smoothly in from them.
  const pm = piece.solid ?? piece.sel; const pp = piece.people; const tex = piece.draw ?? piece.rgba; const PW = piece.w; const PH = piece.h;
  const pb = piece.box; const m = Math.round((pb.x1 - pb.x0) * 0.25);
  const X0 = Math.max(0, pb.x0 - m); const Y0 = Math.max(0, pb.y0 - m); const X1 = Math.min(PW, pb.x1 + m); const Y1 = Math.min(PH, pb.y1 + m);
  const bw = X1 - X0; const bh = Y1 - Y0;
  if (!piece.warpTex || piece.warpTex.of !== pm) {
    const val = new Float32Array(bw * bh * 3); const free = new Uint8Array(bw * bh); const skin = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const k = y * bw + x; const i = (Y0 + y) * PW + X0 + x;
      // (Not anyone's hair or skin over it: in a group, the person beside them leaning in.)
      const AP = piece.allPeople ?? pp;
      const cloth = pm[i] && pp.body[i] < 128 && pp.face[i] < 128 && pp.hair[i] < 100 && AP.hair[i] < 100 && AP.face[i] < 128 && AP.body[i] < 160;
      if (cloth || piece.rebuilt?.[i]) { const d = piece.draw ?? piece.rgba; for (let c = 0; c < 3; c++) val[k * 3 + c] = d[i * 4 + c]; } else free[k] = 1;
      if (pp.body[i] >= 128 || pp.face[i] >= 128) skin[k] = 1;
    }
    // (Below its waist, only the cloth that goes on from above it in that column (a jacket's sides, down to its
    // hem); not a belt or the jeans under a short top, which the selection can reach.)
    const wy = piece.layout?.waist;
    if (wy && wy - (piece.layout.fh ?? 60) * 0.57 > Y0 && wy < Y1) {
      // (From a little above the waist found (a belt sits on it), against the column's cloth higher up, on the
      // top itself.)
      const fhp = piece.layout.fh ?? 60; const ry = Math.round(wy - fhp * 0.3 - Y0); const ref0 = Math.round(wy - fhp * 0.45 - Y0); const band = Math.max(3, Math.round(fhp * 0.12));
      for (let x = 0; x < bw; x++) {
        // (The column's cloth there, its color.)
        const ref = [0, 0, 0]; let rn = 0;
        for (let y = Math.max(0, ref0 - band); y < ref0; y++) { const k = y * bw + x; if (!free[k]) { const q = rgbToLab(val[k * 3], val[k * 3 + 1], val[k * 3 + 2]); ref[0] += q[0]; ref[1] += q[1]; ref[2] += q[2]; rn++; } }
        const has = rn >= Math.max(2, band * 0.4); if (has) for (let c = 0; c < 3; c++) ref[c] /= rn;
        for (let y = ry; y < bh; y++) {
          const k = y * bw + x; if (free[k]) continue;
          const q = rgbToLab(val[k * 3], val[k * 3 + 1], val[k * 3 + 2]);
          if (!has || Math.hypot((q[0] - ref[0]) * 0.6, q[1] - ref[1], q[2] - ref[2]) > 22) { free[k] = 1; skin[k] = 0; }
        }
      }
    }
    membrane(val, free, bw, bh);
    // (How far each pixel is from the piece's cloth: past a few pixels, it's not the piece (its jeans, the
    // background), and nothing of it is laid there.)
    const far = new Float32Array(bw * bh); for (let k = 0; k < bw * bh; k++) far[k] = free[k] ? 1e9 : 0; chamfer(far, bw, bh);
    piece.warpTex = { of: pm, val, free, skin, far };
  }
  const { val, free, skin, far } = piece.warpTex; const near = Math.max(3, (piece.layout?.fh ?? 60) * 0.06);
  const sample = (x, y) => {
    const fx = Math.max(0, Math.min(bw - 1.001, x - X0 - 0.5)); const fy = Math.max(0, Math.min(bh - 1.001, y - Y0 - 0.5));
    const x0 = Math.floor(fx); const y0 = Math.floor(fy); const tx = fx - x0; const ty = fy - y0; const o = [0, 0, 0];
    for (const [dx, dy, wt] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) { const k = (y0 + dy) * bw + x0 + dx; for (let c = 0; c < 3; c++) o[c] += val[k * 3 + c] * wt; }
    return o;
  };
  const T = t.box; const tw = T.x1 - T.x0; const th = T.y1 - T.y0; const rgba = new Uint8ClampedArray(tw * th * 4);
  const skinOut = new Uint8Array(tw * th); let n = 0;
  for (let y = T.y0; y < T.y1; y++) {
    let g = null;
    for (let x = T.x0; x < T.x1; x++) {
      if (!t.mask[y * w + x]) continue;
      g = inv(fb, x + 0.5, y + 0.5, g);
      const [sx, sy] = at(fp, g[0], g[1]);
      const k = (y - T.y0) * tw + x - T.x0; const o = k * 4;
      const kx = Math.round(sx - X0 - 0.5); const ky = Math.round(sy - Y0 - 0.5);
      const kk = kx >= 0 && ky >= 0 && kx < bw && ky < bh ? ky * bw + kx : -1;
      // (On the piece's own skin (its open neck, a bare midriff under a short top) or off the piece: left open,
      // what's under it (their skin, as taken off) shows.)
      // (By the shoulders' line its cloth is carried a little further (the shoulder above its seam).)
      const lim = g[1] < 0.15 ? near * 4 : near;
      let s2x = sx; let s2y = sy;
      // (Its own skin there (its neckline): open, as it is.)
      if (kk >= 0 && skin[kk] && free[kk]) { skinOut[k] = 1; continue; }
      if (kk < 0 || far[kk] > lim) {
        // (Hidden there in its photo (hair over that shoulder, the person beside): the same place on its other
        // side, mirrored, if its cloth is seen there.)
        const [mx, my] = at(fp, 1 - g[0], g[1]); const mkx = Math.round(mx - X0 - 0.5); const mky = Math.round(my - Y0 - 0.5);
        const mk = mkx >= 0 && mky >= 0 && mkx < bw && mky < bh ? mky * bw + mkx : -1;
        if (mk < 0 || (skin[mk] && free[mk]) || far[mk] > lim) { skinOut[k] = 1; continue; }
        s2x = mx; s2y = my;
      }
      const c3 = sample(s2x, s2y); rgba[o] = c3[0]; rgba[o + 1] = c3[1]; rgba[o + 2] = c3[2]; rgba[o + 3] = 255; n++;
    }
  }
  if (n < 50) return null;
  return { x0: T.x0, y0: T.y0, pw: tw, ph: th, rgba, skin: skinOut };
}

/** The shoulders' ratio of the two people (base over piece), for a zone laid in at one scale, or null. */
export function rigidZone(S) {
  const seen = (v) => v && v[2] >= 0.3; const qa = S.base.pose; const qb = S.piece.pose; const a = qa?.shoulders; const b = qb?.shoulders;
  if (!seen(a?.[0]) || !seen(a?.[1]) || !seen(b?.[0]) || !seen(b?.[1])) return null;
  const bd = Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]); const pd = Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]);
  if (bd <= 4 || pd <= 4) return null;
  // (The size from several measures, their middle one: the shoulders' span, the face's height, the shoulders
  // to the hips. One person turned (a three-quarter view) has their shoulders' span foreshortened; one
  // measure alone would make the piece far too big or small.)
  const r = [bd / pd];
  const La = S.base.layout; const Lb = S.piece.layout;
  if (La?.fh && Lb?.fh) r.push(La.fh / Lb.fh);
  const mid = (q) => [(q.shoulders[0][0] + q.shoulders[1][0]) / 2, (q.shoulders[0][1] + q.shoulders[1][1]) / 2];
  const hipMid = (q) => (seen(q.hips?.[0]) && seen(q.hips?.[1]) ? [(q.hips[0][0] + q.hips[1][0]) / 2, (q.hips[0][1] + q.hips[1][1]) / 2] : null);
  const ha = hipMid(qa); const hb = hipMid(qb);
  if (ha && hb) { const ma = mid(qa); const mb = mid(qb); const ta = Math.hypot(ha[0] - ma[0], ha[1] - ma[1]); const tb = Math.hypot(hb[0] - mb[0], hb[1] - mb[1]); if (ta > 4 && tb > 4) r.push(ta / tb); }
  r.sort((x, y) => x - y);
  const s2 = r.length === 2 ? Math.sqrt(r[0] * r[1]) : r[r.length >> 1];
  // (Turned: their nose well to one side of their shoulders' middle. Its middle is then its cloth's own, not
  // the shoulders'.)
  const turned = (q, d) => !!q.nose && seen(q.nose) && Math.abs(q.nose[0] - mid(q)[0]) > d * 0.25;
  return { s: s2, own: turned(qb, pd) || turned(qa, bd) };
}

/**
 * A mask (`m`, in `b`, over `tex`) cut at its real hem: the last row with a fair share of its own color (the
 * median of its upper two thirds, in Lab). { mask, box }, or null when nothing is cut.
 */
function hemCut(m, b, tex, w, h) {
  const lab = (i) => rgbToLab(tex[i * 4], tex[i * 4 + 1], tex[i * 4 + 2]);
  const L = []; const A = []; const B2 = [];
  for (let y = b.y0; y < b.y0 + (b.y1 - b.y0) * 0.67; y += 3) for (let x = b.x0; x < b.x1; x += 3) { const i = y * w + x; if (!m[i]) continue; const q = lab(i); L.push(q[0]); A.push(q[1]); B2.push(q[2]); }
  if (L.length < 50) return null;
  const med = (v) => { v.sort((p, q) => p - q); return v[v.length >> 1]; };
  const c = [med(L), med(A), med(B2)];
  const rows = [];
  for (let y = b.y0; y < b.y1; y++) { let k = 0; for (let x = b.x0; x < b.x1; x += 2) { const i = y * w + x; if (!m[i]) continue; const q = lab(i); if (Math.hypot((q[0] - c[0]) * 0.5, q[1] - c[1], q[2] - c[2]) < 22) k++; } rows.push(k); }
  const usual = [...rows].sort((p, q) => p - q)[Math.floor(rows.length * 0.6)] || 1;
  let hem = b.y1;
  for (let y = b.y1 - 1; y > b.y0 + (b.y1 - b.y0) * 0.4; y--) if (rows[y - b.y0] >= usual * 0.3) { hem = y + 1; break; }
  if (hem >= b.y1 - 2) return null;
  const out = Uint8Array.from(m); for (let y = hem; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) out[y * w + x] = 0;
  const box = boxOf(out, w, h); return box ? { mask: out, box } : null;
}

/**
 * A body zone's torso (`t`: { mask, box }) carried on down past its waist line to where what's worn there
 * really ends (a long top on someone sitting): row by row, the base's clothes of that garment's own color
 * (its median, in Lab) joined to the row above, while they're most of the row (a print below, the stripes of
 * the pants, stops it). A { mask, box, spans } outline.
 */
function downToHem(S, t) {
  const { base } = S; const { w, h } = base; const p = base.people; const b = t.box;
  const lab = (i) => rgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]);
  const L = []; const A = []; const B2 = [];
  for (let y = b.y0; y < b.y1; y += 2) for (let x = b.x0; x < b.x1; x += 2) { const i = y * w + x; if (!t.mask[i] || p.clothes[i] < 128) continue; const q = lab(i); L.push(q[0]); A.push(q[1]); B2.push(q[2]); }
  const done = () => ({ mask: t.mask, box: b, spans: t.spans ?? rowSpans(t.mask, w, b, Math.max(8, Math.round((b.y1 - b.y0) / 14))) });
  if (L.length < 50) return done();
  const med = (v) => { v.sort((q1, q2) => q1 - q2); return v[v.length >> 1]; };
  const c = [med(L), med(A), med(B2)];
  const like = (i) => { const q = lab(i); return (c[0] < 30 && q[0] < c[0] ? true : Math.abs(q[0] - c[0]) < 14) && Math.hypot(q[1] - c[1], q[2] - c[2]) < 14; };
  const m = Uint8Array.from(t.mask); let prev = new Uint8Array(w); let any = false;
  // (Its lowest pixel in each column, within a few rows of the bottom: where it goes on from.)
  // (Started a little above its bottom: the waist line's own ragged edge is filled in too.)
  const y00 = Math.max(b.y0 + 1, b.y1 - 10);
  for (let x = b.x0; x < b.x1; x++) for (let y = y00 - 1; y >= Math.max(b.y0, y00 - 8); y--) if (t.mask[y * w + x]) { prev[x] = 1; break; }
  let y1 = b.y1; const fh = base.layout?.fh ?? h / 7; let nRef = 0;
  for (let y = y00; y < Math.min(h, b.y1 + fh * 2.5); y++) {
    // (Its pixels joined to the row above; on while they stay about as many as in its first row past the
    // waist line: the stripes of the pants below, only part of them its color, stop it.)
    const cur = new Uint8Array(w); let n = 0;
    for (let x = b.x0; x < b.x1; x++) { const i = y * w + x; if (Math.max(p.clothes[i], p.others[i]) >= 110 && p.body[i] < 160 && p.face[i] < 128 && like(i) && (prev[x] || prev[x - 1] || prev[x + 1])) { cur[x] = 1; n++; } }
    // (And along the row from those, through its color: its part under a lock of hair above, not joined
    // to the row above, is the same garment.)
    const ok2 = (x) => { const i = y * w + x; return Math.max(p.clothes[i], p.others[i]) >= 110 && p.body[i] < 160 && p.face[i] < 128 && like(i); };
    for (let x = b.x0 + 1; x < b.x1; x++) if (!cur[x] && cur[x - 1] && ok2(x)) { cur[x] = 1; n++; }
    for (let x = b.x1 - 2; x >= b.x0; x--) if (!cur[x] && cur[x + 1] && ok2(x)) { cur[x] = 1; n++; }
    if (!nRef && y >= b.y1) nRef = n;
    if (y >= b.y1 && (n < 4 || n < nRef * 0.5)) break;
    for (let x = b.x0; x < b.x1; x++) if (cur[x] || m[y * w + x]) { m[y * w + x] = 1; cur[x] = 1; }
    prev = cur; y1 = Math.max(y1, y + 1); any = true;
  }
  if (!any) return done();
  const box = { ...b, y1 };
  return { mask: m, box, spans: rowSpans(m, w, box, Math.max(8, Math.round((box.y1 - box.y0) / 14))) };
}

/**
 * The piece's sleeve (`pc` in `pb`) laid onto the base's arm on picture side `k` (0 left, 1 right), bent along
 * both people's arms (shoulder → elbow → wrist). The sleeve is first straightened into a strip: each row a
 * step along the piece's arm, each column a place across the sleeve there (from one of its edges to the
 * other), its holes (a fold, something over it) filled from the cloth beside them; as long as the sleeve is
 * on the piece (a rolled sleeve ends where it ends). Then wrapped onto the base's arm across its own width at
 * each step (measured from their outline, a little more for loose cloth): one continuous sleeve in the shape
 * of their arm, its texture the piece's. A layer, or null without both arms' poses.
 */
function sleeveAlongArm(S, k, pc, pb) {
  const { base, piece } = S; const { w, h } = base;
  const seen = (v) => v && v[2] >= 0.3;
  const bones = (q) => {
    if (!q || !seen(q.shoulders?.[k]) || !seen(q.elbows?.[k])) return null;
    const s0 = q.shoulders[k]; const e = q.elbows[k];
    const wr = seen(q.wrists?.[k]) ? q.wrists[k] : [e[0] + (e[0] - s0[0]) * 0.9, e[1] + (e[1] - s0[1]) * 0.9];
    return [s0, e, wr];
  };
  const pB = bones(piece.pose); const bB = bones(base.pose); const rz = rigidZone(S);
  if (!pB || !bB || !rz) return null;
  // (Where a point is along an arm: u from 0 at the shoulder to 1 at the elbow and 2 at the wrist, and d its
  // signed distance to one side; and back.)
  const frame = (B) => {
    const segs = [[B[0], B[1]], [B[1], B[2]]].map(([a, c]) => { const dx = c[0] - a[0]; const dy = c[1] - a[1]; const L = Math.hypot(dx, dy) || 1; return { a, dx: dx / L, dy: dy / L, L }; });
    const at = (x, y) => {
      let best = null;
      segs.forEach((g, i) => { const t = (x - g.a[0]) * g.dx + (y - g.a[1]) * g.dy; const tc = Math.max(i === 0 ? -0.3 * g.L : 0, Math.min(i === 1 ? 1.2 * g.L : g.L, t)); const px = g.a[0] + g.dx * tc; const py = g.a[1] + g.dy * tc; const dist = Math.hypot(x - px, y - py); if (!best || dist < best.dist) best = { dist, u: i + tc / g.L, d: (x - g.a[0]) * -g.dy + (y - g.a[1]) * g.dx }; });
      return best;
    };
    const point = (u, d) => { const i = Math.max(0, Math.min(1, Math.floor(u))); const g = segs[i]; const t = (u - i) * g.L; return [g.a[0] + g.dx * t - g.dy * d, g.a[1] + g.dy * t + g.dx * d]; };
    return { at, point, segs };
  };
  const PF = frame(pB); const BF = frame(bB);
  const tex = piece.draw ?? piece.rgba; const PW = piece.w;
  // 1. The piece's sleeve, step by step along its arm: how far to either side it reaches at each.
  const NU = 96; const UMAX = 2.2; const du = UMAX / NU;
  const lo = new Float32Array(NU).fill(Infinity); const hi = new Float32Array(NU).fill(-Infinity); const cnt = new Int32Array(NU);
  for (let y = pb.y0; y < pb.y1; y++) for (let x = pb.x0; x < pb.x1; x++) {
    if (!pc[y * PW + x]) continue;
    const f = PF.at(x + 0.5, y + 0.5); if (!f || f.u < 0 || f.u >= UMAX) continue;
    const b = Math.floor(f.u / du); cnt[b]++; if (f.d < lo[b]) lo[b] = f.d; if (f.d > hi[b]) hi[b] = f.d;
  }
  let maxW = 0; for (let b = 0; b < NU; b++) if (cnt[b] >= 3) maxW = Math.max(maxW, hi[b] - lo[b]);
  if (maxW < 4) return null;
  // (Where it ends: the first step from the shoulder on where it's under 40% of its widest, past its first
  // fifth (a shoulder seam narrows it).)
  let first = -1; for (let b = 0; b < NU; b++) if (cnt[b] >= 3 && hi[b] - lo[b] >= maxW * 0.4) { first = b; break; }
  if (first < 0) return null;
  let end = first; for (let b = first; b < NU; b++) { if (cnt[b] >= 3 && hi[b] - lo[b] >= maxW * 0.4) end = b; else if (b - end > NU * 0.06) break; }
  const uEnd = (end + 1) * du;
  // (Its edges smoothed along it, and filled where a step had none.)
  const smooth = (v) => { const o = Float32Array.from(v); for (let b = first; b <= end; b++) { let s2 = 0; let n = 0; for (let d = -3; d <= 3; d++) { const t = b + d; if (t >= first && t <= end && Number.isFinite(v[t])) { s2 += v[t]; n++; } } o[b] = n ? s2 / n : NaN; } return o; };
  const L0 = smooth(lo); const H0 = smooth(hi);
  for (let b = first; b <= end; b++) if (!Number.isFinite(L0[b]) || !Number.isFinite(H0[b])) { let c2 = b; while (c2 > first && !Number.isFinite(L0[c2])) c2--; L0[b] = L0[c2]; H0[b] = H0[c2]; }
  // 2. The strip: NU steps along × NV across, each the piece's color there (where its sleeve is), the rest
  // filled from the nearest cloth along its row, then from the rows beside it.
  const NV = 48; const strip = new Float32Array(NU * NV * 3); const got = new Uint8Array(NU * NV);
  for (let b = first; b <= end; b++) for (let j = 0; j < NV; j++) {
    const d = L0[b] + ((j + 0.5) / NV) * (H0[b] - L0[b]);
    const [sx, sy] = PF.point((b + 0.5) * du, d); const X = Math.round(sx); const Y = Math.round(sy);
    // (Within the sleeve's own edges at that step, its pixels as they are: its folds and texture, not only
    // what the person finder was sure was cloth.)
    if (X < 0 || Y < 0 || X >= PW || Y >= piece.h || !(piece.solid ?? piece.sel)[Y * PW + X] || piece.people.face[Y * PW + X] >= 128 || piece.people.hair[Y * PW + X] >= 160) continue;
    const o = (b * NV + j) * 3; const t = (Y * PW + X) * 4; strip[o] = tex[t]; strip[o + 1] = tex[t + 1]; strip[o + 2] = tex[t + 2]; got[b * NV + j] = 1;
  }
  for (let b = first; b <= end; b++) {
    for (let j = 0; j < NV; j++) {
      if (got[b * NV + j]) continue;
      for (let d = 1; d < NV; d++) { const t = [j - d, j + d].find((q) => q >= 0 && q < NV && got[b * NV + q] === 1); if (t !== undefined) { for (let c2 = 0; c2 < 3; c2++) strip[(b * NV + j) * 3 + c2] = strip[(b * NV + t) * 3 + c2]; got[b * NV + j] = 2; break; } }
    }
  }
  for (let b = first; b <= end; b++) if (!got[b * NV]) { let t = -1; for (let d = 1; d < NU && t < 0; d++) for (const q of [b - d, b + d]) if (q >= first && q <= end && got[q * NV]) { t = q; break; } if (t >= 0) { strip.copyWithin(b * NV * 3, t * NV * 3, (t + 1) * NV * 3); got.fill(2, b * NV, (b + 1) * NV); } }
  // 3. The base's arm: how wide it is to either side of its bones at each step (from their outline).
  const bsh = base.pose.shoulders; const armHalf = Math.hypot(bsh[1][0] - bsh[0][0], bsh[1][1] - bsh[0][1]) * 0.15;
  const onBody = (x, y) => { const X = Math.round(x); const Y = Math.round(y); if (X < 0 || Y < 0 || X >= w || Y >= h) return false; const i = Y * w + X; return base.people.face[i] < 128 && Math.max(base.people.body[i], base.people.clothes[i], base.people.hair[i]) >= 100; };
  // (Hair beside the arm counts as arm here: the sleeve goes on under it, and the hair is kept in front.)
  const wl = new Float32Array(NU); const wr = new Float32Array(NU);
  for (let b = first; b <= end; b++) {
    const u = (b + 0.5) * du;
    const reach = (sign) => { let t = 0; for (; t < armHalf * 1.8; t += 1) { const [x, y] = BF.point(u, sign * t); if (!onBody(x, y)) break; } return t; };
    wl[b] = reach(-1); wr[b] = reach(1);
  }
  const clampW = (v) => { const o = smooth(v); for (let b = first; b <= end; b++) o[b] = Math.max(armHalf * 0.55, Math.min(armHalf * 1.35, Number.isFinite(o[b]) ? o[b] : armHalf)); return o; };
  const WL = clampW(wl); const WR = clampW(wr);
  // (Turned to match: the piece's arm and the base's may run opposite ways around.)
  const side = (B, q) => { const mid = (q.shoulders[0][0] + q.shoulders[1][0]) / 2; return Math.sign((B[0][0] - mid) || 1); };
  const flip = side(pB, piece.pose) * side(bB, base.pose) * Math.sign((pB[1][1] - pB[0][1]) || 1) * Math.sign((bB[1][1] - bB[0][1]) || 1) < 0;
  // 4. Wrapped on: each pixel near the base's arm, within its width (a little more: loose cloth) up to where
  // the sleeve ends, colored from the strip, its edge a pixel soft.
  const ext = armHalf * 1.6;
  const xs = bB.map((q) => q[0]); const ys = bB.map((q) => q[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - ext)); const x1 = Math.min(w, Math.ceil(Math.max(...xs) + ext));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - ext)); const y1 = Math.min(h, Math.ceil(Math.max(...ys) + ext));
  const pw = x1 - x0; const ph = y1 - y0; if (pw < 2 || ph < 2) return null;
  const rgba = new Uint8ClampedArray(pw * ph * 4); let drawn = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * w + x; if (base.people.face[i] >= 128) continue;
    const f = BF.at(x + 0.5, y + 0.5); if (!f || f.u < 0 || f.u >= uEnd) continue;
    const bi = Math.min(end, Math.max(first, Math.floor(f.u / du)));
    const l = WL[bi] * 1.08; const r = WR[bi] * 1.08;
    if (f.d < -l - 1 || f.d > r + 1) continue;
    let v = (f.d + l) / (l + r); if (flip) v = 1 - v;
    const fj = Math.max(0, Math.min(NV - 1.001, v * NV - 0.5)); const j0 = Math.floor(fj); const tj = fj - j0;
    const o = ((y - y0) * pw + x - x0) * 4; const s0 = (bi * NV + j0) * 3; const s1 = (bi * NV + Math.min(NV - 1, j0 + 1)) * 3;
    for (let c2 = 0; c2 < 3; c2++) rgba[o + c2] = strip[s0 + c2] * (1 - tj) + strip[s1 + c2] * tj;
    const edge = Math.max(0, Math.min(1, Math.min(f.d + l + 1, r + 1 - f.d)));
    // (And a soft end at the cuff.)
    const cuff = Math.max(0, Math.min(1, (uEnd - f.u) / (du * 1.5)));
    rgba[o + 3] = Math.round(255 * edge * cuff); if (rgba[o + 3]) drawn++;
  }
  return drawn > 30 ? { x0, y0, pw, ph, rgba } : null;
}

/**
 * Rows of the base matched to rows of the piece by the two people's poses (their shoulders, their waist
 * a third of the way up from the hips): for laying a zone or a garment in, so its shoulders sit on the
 * shoulders and its waist on the waist, whatever each person's proportions or how far they lean. Null
 * without both poses.
 */
function poseRows(S) {
  const { base, piece } = S; const a = base.pose; const b = piece.pose;
  const seen = (q) => q && q[2] >= 0.3;
  const ok = (q) => q && seen(q.shoulders[0]) && seen(q.shoulders[1]);
  if (!ok(a) || !ok(b)) return null;
  const sy = (q) => (q.shoulders[0][1] + q.shoulders[1][1]) / 2;
  const out = [[sy(a), sy(b)]];
  const hips = (q) => seen(q.hips[0]) && seen(q.hips[1]);
  if (hips(a) && hips(b)) { const wy = (q) => { const hy = (q.hips[0][1] + q.hips[1][1]) / 2; return hy - (hy - sy(q)) * 0.3; }; out.push([wy(a), wy(b)]); }
  return out;
}

/** Whether a part is clearly covered (true: mostly clothes), clearly bare (false), or neither (null: a short sleeve). */
const clearly = (part) => (part.clothFrac > 0.7 ? true : part.clothFrac < 0.3 ? false : null);

/** The base person's own skin texture (skinTexture), once. */
function skinDetailOf(base) {
  if (base.skinDetail !== undefined) return base.skinDetail;
  base.skinDetail = base.people ? skinTexture(base.rgba, base.w, base.h, base.people, base.layout?.fh ?? 60, base.pose ?? null) : null;
  return base.skinDetail;
}

/**
 * When none of their skin will do for a texture: the photo's own fine grain, as much as their face's skin has
 * (its pixels less their neighbours'), so made skin isn't smoother than the picture. (x, y) → [d, d, d].
 */
function grainOf(base) {
  if (base.grain !== undefined) return base.grain;
  const { w, h, rgba } = base; const p = base.people; const vals = []; const L = (j) => 0.299 * rgba[j * 4] + 0.587 * rgba[j * 4 + 1] + 0.114 * rgba[j * 4 + 2];
  if (p) for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) { const i = y * w + x; if (p.face[i] < 220 || p.face[i - 1] < 220 || p.face[i + 1] < 220 || p.face[i - w] < 220 || p.face[i + w] < 220 || p.hair[i] > 40) continue; vals.push(L(i) - (L(i - 1) + L(i + 1) + L(i - w) + L(i + w)) / 4); }
  if (vals.length < 100) return (base.grain = null);
  vals.sort((a, c) => a - c); const q = vals.slice(Math.floor(vals.length * 0.1), Math.ceil(vals.length * 0.9));
  const a = Math.min(6, Math.sqrt(q.reduce((s2, v) => s2 + v * v, 0) / q.length) * 1.1);
  const hash = (x, y) => { let t = (x * 374761393 + y * 668265263) | 0; t = Math.imul(t ^ (t >>> 13), 1274126177); return (((t ^ (t >>> 16)) >>> 0) / 4294967296) - 0.5; };
  base.grain = (x, y) => { const X = Math.round(x); const Y = Math.round(y); const d = a * 2 * (hash(X, Y) * 0.6 + (hash(X >> 1, Y >> 1) + hash((X + 1) >> 1, Y >> 1)) * 0.35); return [d, d * 0.97, d * 0.92]; };
  return base.grain;
}

/** The base person's skin color (their bare skin's median, else their face's), once. */
function skinTone(base) {
  if (base.tone !== undefined) return base.tone;
  const p = base.people; const { w } = base; const fh = base.layout?.fh ?? base.h / 7;
  // (Not their hands: a hand is darker and redder than a chest. Near a wrist from the pose.)
  const wr = (base.pose?.wrists ?? []).filter((v) => v && v[2] >= 0.2);
  const pick = (ok) => { const v = [[], [], []]; for (let i = 0; i < p.body.length; i += 3) if (ok(i)) for (let c = 0; c < 3; c++) v[c].push(base.rgba[i * 4 + c]); return v[0].length > 60 ? v.map((a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; }) : null; };
  const offHand = (i) => { const x = i % w; const y = (i / w) | 0; return !wr.some((v) => Math.hypot(x - v[0], y - v[1]) < fh * 0.9); };
  // (Else their face's clear skin where it's lit (a chest faces the light as a cheek does): no eyes, mouth or
  // shade under the jaw.)
  const face = () => { const t = pick((i) => p.face[i] >= 220 && p.hair[i] < 40); if (!t) return null; const L = (i) => 0.299 * base.rgba[i * 4] + 0.587 * base.rgba[i * 4 + 1] + 0.114 * base.rgba[i * 4 + 2]; const m = 0.299 * t[0] + 0.587 * t[1] + 0.114 * t[2]; return pick((i) => p.face[i] >= 220 && p.hair[i] < 40 && L(i) >= m - 5 && L(i) < m + 30) ?? t; };
  // (Checked against the face, which the finder is surest of: what it calls body skin that's far from the
  // face's color (an orange lock of hair, a warm wall) isn't their skin.)
  const fc = face(); const bd = pick((i) => p.body[i] >= 200 && offHand(i));
  const near = (t) => { if (!fc || !t) return !!t; const a = rgbToLab(t[0], t[1], t[2]); const b = rgbToLab(fc[0], fc[1], fc[2]); return Math.abs(a[0] - b[0]) < 9 && Math.hypot(a[1] - b[1], a[2] - b[2]) < 10; };
  base.tone = (near(bd) ? bd : null) ?? fc ?? pick((i) => p.body[i] >= 200);
  return base.tone;
}

/** Whether the scene lays the design/** Whether the scene lays the design into the outline of what's worn (Replace, on a garment found or traced). */
// (Not a jacket: its own shape, its long sleeves over bare arms, is what it is; nor a hat or shoes, fitted
// as they are.)
export const isTrace = (S) => S.mode === 'replace' && !!S.target && !S.target.body && !['shoes', 'hat', 'jacket'].includes(S.kind);

/** Spans widened by `k` of the box's width on each side (Overlay: over what's worn, a little bigger). */
function widen(spans, box, k) {
  const d = (box.x1 - box.x0) * k; const out = Float32Array.from(spans);
  for (let i = 0; i < out.length; i += 2) if (out[i] >= 0) { out[i] -= d; out[i + 1] += d; }
  return out;
}
const tall = (b, k = 0.6) => b.y1 - b.y0 >= k * (b.x1 - b.x0);

/**
 * The piece's layer over the base (before it's finished). `S`: { base, piece, target, place, tune, kind,
 * mode }. A top with sleeves, fitted: its body onto the body worn there, each sleeve onto that side's
 * sleeve (when it's as long; otherwise kept on its shoulder, its own length). Shoes: each on its own foot
 * (one shoe photographed: mirrored for the other foot), fitted to that foot's shoe.
 */
export function buildLayer(S) {
  const { base, piece, target, place, tune, kind, mode } = S;
  const { w, h } = base;
  if (!place || !piece?.alpha) return null;
  // Replace: the piece's design laid into the outline of what's worn there (its shape, on this body, in this
  // pose); moved or sized by hand, the design moves within it.
  if (isTrace(S)) {
    // A body zone between two people: part by part (the torso, each arm), as each is covered or bare.
    // (Laid into the outline as it is; then moved, sized and turned by hand as a whole, the same as in
    // Overlay: what it no longer covers of the old garment is taken off.)
    const still = { ...S, tune: { ...tune, scale: 100, wide: 100, long: 100, rot: 0, dx: 0, dy: 0 } };
    // (Taken off first, both people's bodies found: the piece put on as one smooth whole (engine.js). The ways
    // below are for when that can't be done.)
    if (erasing(still) && engineFor(still)) { const E = engineLayer(still); if (E) return transformLayer(E, tune, w, h); }
    if (isZone(kind) && kind !== 'lower' && base.layout && piece.layout && base.people && piece.people) {
      const z = zoneLayer(still); if (z) return transformLayer(z, tune, w, h);
    }
    const hm = toHem(piece, S.kind);
    const open = target.box.y1 >= h - 2 || (hm?.box ?? piece.box).y1 >= piece.h - 2;
    const under = erasing(S) ? withZone(underHair(S), garmentZone(S), w, h) : underHair(S);
    const centers = frontCenters(S);
    const layer = traceTransfer(piece.draw ?? piece.rgba, hm?.mask ?? piece.solid ?? piece.sel, piece.w, piece.h, hm?.box ?? piece.box, under, w, h, { rigid: centers ? (rigidOf(S) ?? (erasing(S) ? rigidZone(S) : null)) : null, s: place.s, open, adj: still.tune, skin: pieceSkin(piece), rebuilt: piece.rebuilt ?? null, rows: poseRows(S), centers });
    neckline(layer, base, w);
    softEdge(layer, under, w, h);
    return transformLayer(layer, tune, w, h);
  }
  const fit = tune.fit / 100;
  const fitting = target && fit > 0;
  const open = !!target && target.box.y1 >= h - 2;
  const regionOf = (t) => t && (mode === 'overlay' ? { box: t.box, spans: widen(t.spans, t.box, 0.04), openBottom: open } : { ...t, openBottom: open });
  const at = (b) => ({ x0: place.x0 + (b.x0 - piece.box.x0) * place.s, y0: place.y0 + (b.y0 - piece.box.y0) * place.s, s: place.s });
  const R = (alpha, box, pl, region, flip = false) => renderPiece(piece.draw ?? piece.rgba, alpha, piece.w, piece.h, box, pl, region, region ? fit : 0, w, h, flip);
  const pp = piece.parts; const tp = target?.parts;
  let layers;
  if (fitting && pp?.sleeves && (pp.sleeves.left || pp.sleeves.right)) {
    const ps = pp.sleeves; const ts = tp?.sleeves;
    const torso = R(ps.torso.alpha, ps.torso.box, at(ps.torso.box), regionOf(ts?.torso ?? target));
    layers = [torso];
    if (torso) for (const side of ['left', 'right']) {
      const p = ps[side]; if (!p) continue;
      const t = ts?.[side];
      // Fitted to that side's sleeve when it's as long (within a quarter); a long sleeve over a short one
      // (or a bare arm) keeps its length, on its shoulder.
      if (t && tall(t.box) && tall(p.box) && t.box.y1 - t.box.y0 >= 0.75 * (p.box.y1 - p.box.y0) * place.s) { layers.push(R(p.alpha, p.box, at(p.box), regionOf(t))); continue; }
      // (No sleeve to fit it to there: on its shoulder, as big as the body is now.)
      const tb = ps.torso.box; const sx = torso.pw / (tb.x1 - tb.x0); const sy = torso.ph / (tb.y1 - tb.y0); const s = (sx + sy) / 2;
      const x0 = side === 'left' ? torso.x0 - (tb.x0 - p.box.x0) * s : torso.x0 + torso.pw + (p.box.x0 - tb.x1) * s;
      layers.unshift(R(p.alpha, p.box, { x0, y0: torso.y0 + (p.box.y0 - tb.y0) * sy, s }, null));
    }
  } else if (kind === 'shoes' && pp?.pair?.length && tp?.pair?.length === 2) {
    // Each shoe on its own foot: as wide as that foot's shoe, standing where it stands (and fitted to it).
    layers = tp.pair.map((t, i) => {
      const p = pp.pair[Math.min(i, pp.pair.length - 1)];
      const s = (t.box.x1 - t.box.x0) / (p.box.x1 - p.box.x0);
      const pl = { x0: t.box.x0, y0: t.box.y1 - (p.box.y1 - p.box.y0) * s, s };
      return R(p.alpha, p.box, pl, fitting ? regionOf(t) : null, pp.pair.length === 1 && i === 0);
    });
  } else layers = [R(piece.alpha, piece.box, place, fitting ? regionOf(target) : null)];
  const layer = mergeLayers(layers);
  return layer && transformLayer(layer, tune, w, h);
}

/**
 * A top or a dress picked with something of another color caught below its hem (a strip of the pants under a
 * shirt): cut at its real hem, the last row with a fair share of its own cloth's color (its median, in
 * Lab), so the rows below it aren't laid in as the shirt. { mask, box } over the piece, or null when nothing
 * is cut. Kept on the piece.
 */
function toHem(piece, kind) {
  if (!['top', 'dress'].includes(kind)) return null;
  const m = piece.solid ?? piece.sel; const b = piece.box; if (!m || !b) return null;
  if (piece.hemOf === m) return piece.hem;
  piece.hemOf = m; piece.hem = null;
  const { w } = piece; const tex = piece.draw ?? piece.rgba;
  const lab = (i) => rgbToLab(tex[i * 4], tex[i * 4 + 1], tex[i * 4 + 2]);
  // (Its cloth's color: the median of its upper two thirds.)
  const L = []; const A = []; const B2 = [];
  for (let y = b.y0; y < b.y0 + (b.y1 - b.y0) * 0.67; y += 3) for (let x = b.x0; x < b.x1; x += 3) { const i = y * w + x; if (!m[i]) continue; const q = lab(i); L.push(q[0]); A.push(q[1]); B2.push(q[2]); }
  if (L.length < 50) return null;
  const med = (v) => { v.sort((p, q) => p - q); return v[v.length >> 1]; };
  const c = [med(L), med(A), med(B2)];
  const rowsCloth = []; const rowsAll = [];
  for (let y = b.y0; y < b.y1; y++) {
    let n = 0; let k = 0;
    for (let x = b.x0; x < b.x1; x += 2) { const i = y * w + x; if (!m[i]) continue; n++; const q = lab(i); if (Math.hypot((q[0] - c[0]) * 0.5, q[1] - c[1], q[2] - c[2]) < 22) k++; }
    rowsAll.push(n); rowsCloth.push(k);
  }
  const usual = [...rowsCloth].sort((p, q) => p - q)[Math.floor(rowsCloth.length * 0.6)] || 1;
  let hem = b.y1;
  for (let y = b.y1 - 1; y > b.y0 + (b.y1 - b.y0) * 0.4; y--) { if (rowsCloth[y - b.y0] >= usual * 0.3) { hem = y + 1; break; } }
  if (hem >= b.y1 - 2) return null;
  const out = Uint8Array.from(m); for (let y = hem; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) out[y * w + x] = 0;
  const box = boxOf(out, w, piece.h); if (!box) return null;
  piece.hem = { mask: out, box };
  return piece.hem;
}

/**
 * Whether a top's piece is laid in at one scale rather than stretched row by row to what's seen of the
 * garment worn there: when most of that is hidden (long hair over it: what's seen is far narrower than the
 * shoulders) or a sleeved piece goes onto a sleeveless top (each row from sleeve to sleeve would be squeezed
 * into it). By both people's poses: { s } (the shoulders' ratio), or null.
 */
function rigidOf(S) {
  const { base, piece, target } = S;
  if (!['top', 'dress'].includes(S.kind) || !piece.pose || !base.pose || !piece.box) return null;
  const seen = (v) => v && v[2] >= 0.3;
  const ps = piece.pose.shoulders; const bs = base.pose.shoulders;
  if (!seen(ps?.[0]) || !seen(ps?.[1]) || !seen(bs?.[0]) || !seen(bs?.[1])) return null;
  const pm = piece.solid ?? piece.sel; if (!pm) return null;
  // (Each one's usual width over the middle of its height, against its shoulders' span.)
  const width = (m, W, b) => { const v = []; for (let y = Math.round(b.y0 + (b.y1 - b.y0) * 0.3); y < b.y0 + (b.y1 - b.y0) * 0.7; y++) { let l = -1; let r = -1; for (let x = b.x0; x < b.x1; x++) if (m[y * W + x]) { if (l < 0) l = x; r = x; } if (l >= 0) v.push(r - l + 1); } v.sort((a, c) => a - c); return v.length ? v[v.length >> 1] : 0; };
  const bd = Math.hypot(bs[1][0] - bs[0][0], bs[1][1] - bs[0][1]); const pd = Math.hypot(ps[1][0] - ps[0][0], ps[1][1] - ps[0][1]);
  if (bd < 4 || pd < 4) return null;
  const tw = width(target.mask, base.w, target.box);
  const hidden = tw < bd * 0.75;
  const sleevedOnBare = tw <= bd * 1.3 && width(pm, piece.w, piece.box) >= pd * 1.3;
  return hidden || sleevedOnBare ? { s: bd / pd } : null;
}

/**
 * Whether Replace works by taking off first (a top, a dress, an upper body zone, on a person found): the
 * whole garment worn there found (garmentZone) and erased to their bare skin (eraseGarment), then the piece
 * laid on that with its own color and texture, lit as the photo is, not tinted by what was there before.
 */
export function erasing(S) {
  return S.mode === 'replace' && !!S.target && !S.target.body && !!S.base?.people && !!S.base.layout && ['top', 'dress', 'upper'].includes(S.kind);
}

/**
 * All of the garment worn in the base's zone (a top's, an upper body's: from the chin to where the garment
 * really ends), joined or not: every bit of clothing there is that garment (its sides seen past a lock of
 * hair, a strip by the armhole, between strands of hair); plus what the person finder took for skin or
 * left unsure but is the garment's own color and nothing like their skin. Its prints and buttons (holes in
 * it) are part of it. { mask, box, spans }, kept on the target.
 */
export function garmentZone(S) {
  const { base, target, kind } = S; const { w, h } = base; const p = base.people; const L = base.layout;
  if (target.zoneOf?.base === base && target.zoneOf.kind === kind && target.zoneOf.layout === L) return target.zoneOf.z;
  // (A waist line moved by hand: an upper body ends there, not carried on down to the garment's hem.)
  const byHand = kind === 'upper' && !!L.waistShift;
  const lab = (i) => rgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]);
  // The garment's own color: the median of what was found of it.
  const A0 = []; const A1 = []; const A2 = []; const tb = target.box;
  for (let y = tb.y0; y < tb.y1; y += 2) for (let x = tb.x0; x < tb.x1; x += 2) { const i = y * w + x; if (!target.mask[i] || p.clothes[i] < 128) continue; const q = lab(i); A0.push(q[0]); A1.push(q[1]); A2.push(q[2]); }
  const med = (v) => { v.sort((a, b) => a - b); return v[v.length >> 1]; };
  const c = A0.length > 30 ? [med(A0), med(A1), med(A2)] : null;
  const tone = skinTone(base); const sk = tone ? rgbToLab(tone[0], tone[1], tone[2]) : null;
  const dark = c && c[0] < 30;
  // (Its main colors, not only the median: a white top under a red stole is white and red, and the red is
  // the garment too where it peeks out under their hair.)
  const pal = [];
  if (c) {
    const bins = new Map();
    for (let k = 0; k < A0.length; k++) { const key = `${Math.round(A0[k] / 12)},${Math.round(A1[k] / 10)},${Math.round(A2[k] / 10)}`; const e = bins.get(key) ?? [0, 0, 0, 0]; e[0]++; e[1] += A0[k]; e[2] += A1[k]; e[3] += A2[k]; bins.set(key, e); }
    for (const e of bins.values()) if (e[0] >= A0.length * 0.06) pal.push([e[1] / e[0], e[2] / e[0], e[3] / e[0]]);
  }
  const near = (q, g) => { const dk = g[0] < 30; const dL = dk && q[0] < g[0] ? 0 : Math.max(0, Math.abs(q[0] - g[0]) - (dk ? 14 : 6)); return Math.hypot(dL * 0.7, q[1] - g[1], q[2] - g[2]); };
  const like = (q) => !!c && (near(q, c) < 16 || pal.some((g) => near(q, g) < 16));
  // (Their hair's own color, to tell a lock of hair from the garment showing through its tips.)
  let hairC = null;
  { const H0 = []; const H1 = []; const H2 = []; const F = L.face;
    if (F) for (let y = Math.max(0, Math.floor(F.y0)); y < Math.min(h, Math.floor(L.chin + L.fh * 0.3)); y += 2) for (let x = Math.max(0, Math.floor(F.x0 - L.fw * 0.6)); x < Math.min(w, Math.ceil(F.x1 + L.fw * 0.6)); x += 2) { const i = y * w + x; if (p.hair[i] < 220) continue; const q = lab(i); H0.push(q[0]); H1.push(q[1]); H2.push(q[2]); }
    if (H0.length > 40) hairC = [med(H0), med(H1), med(H2)]; }
  // (A colorful part of the garment (a red stole) by its hue, which stays the same in the shade of a lock of
  // hair over it, unlike its lightness; and not their hair's hue.)
  const hue = (q) => Math.atan2(q[2], q[1]); const chroma = (q) => Math.hypot(q[1], q[2]);
  const angle = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
  const vivid = pal.filter((g) => chroma(g) > 22);
  const garmentHue = (q) => chroma(q) > 14 && vivid.some((g) => angle(hue(q), hue(g)) < 0.26) && (!hairC || chroma(hairC) < 6 || angle(hue(q), hue(hairC)) > 0.45) && !skinish(q);
  const skinish = (q) => sk && q[0] > 30 && Math.hypot((q[0] - sk[0]) * 0.5, q[1] - sk[1], q[2] - sk[2]) < 18;
  // Down to where it really ends (a long top on someone sitting: past the waist line).
  const ext = byHand ? { mask: target.mask, box: tb } : downToHem(S, { mask: target.mask, box: tb });
  const Z = kindZone(kind === 'dress' ? 'dress' : 'upper', L, w, h);
  // (An upper body: from a little above the chin line, where a high collar rises beside the jaw.)
  const y0 = Math.max(0, Math.min(Z.y0, tb.y0, kind === 'upper' ? Math.floor(L.chin - L.fh * 0.3) : h)); const y1 = Math.min(h, Math.max(ext.box.y1, kind === 'upper' ? tb.y1 : tb.y1));
  const x0 = Math.min(Z.x0, tb.x0); const x1 = Math.max(Z.x1, tb.x1);
  const A = base.allPeople && base.allPeople !== p ? base.allPeople : null;
  const Fc = L.face ? (L.face.x0 + L.face.x1) / 2 : (tb.x0 + tb.x1) / 2;
  // (Below the chin and within the neck's width: the shadow beside the jaw, behind an earring, isn't a collar.)
  const neck = (x, y) => y >= L.chin && y < L.chin + L.fh * 0.7 && Math.abs(x - Fc) < L.fw * 0.42;
  const m = new Uint8Array(w * h); const seen = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * w + x;
    if (p.face[i] >= 128) continue;
    // (Above the chin line: only what's surely clothes, or a dark garment's own near-black collar beside the
    // neck, never their jaw or its shadow.)
    if (kind === 'upper' && y < L.chin) {
      if (p.clothes[i] >= 128 && p.face[i] < 100) { m[i] = 1; continue; }
      if (dark && Math.abs(x - Fc) < L.fw * 0.6 && p.hair[i] < 160) { const q0 = lab(i); if (q0[0] < 12 && Math.hypot(q0[1], q0[2]) < 8) { m[i] = 1; seen[i] = 1; } }
      continue;
    }
    // (Someone else's, not theirs.)
    if (A && Math.max(A.body[i], A.clothes[i]) >= 128 && Math.max(p.body[i], p.clothes[i], p.hair[i]) < 60) continue;
    if (ext.mask[i] && (p.clothes[i] >= 100 || kind !== 'upper')) { m[i] = 1; continue; }
    // (An upper body: a dark garment's collar in the shadow under the chin, near black and colorless, which the
    // finder takes for hair (their hair is lighter than that, and has a color). A top found by itself has it.)
    if (dark && kind === 'upper' && p.hair[i] >= 40 && neck(x, y)) { const q0 = lab(i); if (q0[0] < 8 && Math.hypot(q0[1], q0[2]) < 6) { m[i] = 1; seen[i] = 1; continue; } }
    if (p.hair[i] >= 200) continue;
    const q = lab(i);
    if (p.hair[i] >= 40) { if (like(q) && !skinish(q)) { m[i] = 1; seen[i] = 1; } continue; }
    if (p.clothes[i] >= 100) { if (!skinish(q)) m[i] = 1; continue; }
    // (Read as skin, or unsure, but the garment's own color and far from their skin: the garment.)
    if (Math.max(p.body[i], p.others[i]) >= 100 && like(q) && !skinish(q) && (!sk || Math.hypot(q[0] - sk[0], q[1] - sk[1], q[2] - sk[2]) > 30)) m[i] = 1;
  }
  let personOn = null;
  // (Only on them: the person, all of them joined from their face (skin, clothes, hair). A patch of the same
  // color off on its own beside them, in the background, isn't theirs to take off.)
  {
    const on = new Uint8Array(w * h); const F = L.face; const st = [];
    const any = (i) => Math.max(p.body[i], p.clothes[i], p.hair[i], p.face[i]) >= 100;
    if (F) for (let y = Math.max(0, Math.floor(F.y0)); y < Math.min(h, Math.ceil(F.y1)); y++) for (let x = Math.max(0, Math.floor(F.x0)); x < Math.min(w, Math.ceil(F.x1)); x++) { const i = y * w + x; if (any(i)) { on[i] = 1; st.push(i); } }
    for (let a = 0; a < st.length; a++) { const i = st[a]; const x = i % w; for (const t of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) if (t >= 0 && t < w * h && !on[t] && (any(t) || m[t])) { on[t] = 1; st.push(t); } }
    if (st.length > 100) { for (let i = 0; i < m.length; i++) if (m[i] && !on[i]) m[i] = 0; personOn = on; }
  }
  // (Specks of a few pixels off on their own aren't it; holes in it, its prints and buttons, are.)
  const box0 = boxOf(m, w, h); if (!box0) return null;
  const area = (box0.x1 - box0.x0) * (box0.y1 - box0.y0); const minPart = Math.max(12, Math.round(area * 0.0005));
  const lab2 = new Int32Array(w * h); let id = 0;
  for (let y = box0.y0; y < box0.y1; y++) for (let x = box0.x0; x < box0.x1; x++) {
    const i0 = y * w + x; if (!m[i0] || lab2[i0]) continue;
    id++; const st = [i0]; lab2[i0] = id; const part = [i0];
    while (st.length) { const i = st.pop(); for (const t of [i - 1, i + 1, i - w, i + w]) if (t >= 0 && t < w * h && m[t] && !lab2[t]) { lab2[t] = id; st.push(t); part.push(t); } }
    // (And joined or not, on them: its main part, or touching their skin, hair or face; a patch of the same
    // color off on its own beside them (something in the background) isn't theirs to take off.)
    const touches = () => { if (part.length >= area * 0.05) return true; for (const i of part) { for (const t of [i - 2, i + 2, i - 2 * w, i + 2 * w, i - 1, i + 1, i - w, i + w]) if (t >= 0 && t < w * h && !m[t] && Math.max(p.body[t], p.hair[t], p.face[t]) >= 128) return true; } return false; };
    if (part.length < minPart || !touches()) for (const i of part) m[i] = 0;
  }
  // (Its rim: the garment's own color right beside what's found of it, where the finder is unsure what it is
  // (the top edge of a black collar under the jaw, half face, half hair): grown a few pixels into it, never
  // into what's surely their face, hair or skin. Else a thin dark line of it is left along its edge.)
  {
    // (Just under their jaw: their face or skin a few pixels above in that column, the gap between it and the
    // collar; not a dark shadow further off, behind an earring or under their hair.)
    const gap = Math.max(4, Math.round(L.fh * 0.08));
    const underJaw = (x, y) => { for (let d = 1; d <= gap; d++) { const Y = y - d; if (Y < 0) break; const j = Y * w + x; if (Math.max(p.face[j], p.body[j]) >= 128) return true; } return false; };
    const steps = Math.max(3, Math.round(L.fh / 18)); const unsure = (i) => Math.max(p.face[i], p.hair[i], p.body[i]) < 128;
    for (let s2 = 0; s2 < steps; s2++) {
      const add = [];
      for (let y = Math.max(1, y0 - steps); y < Math.min(h - 1, y1 + steps); y++) for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
        const i = y * w + x; if (m[i] || !(m[i - 1] || m[i + 1] || m[i - w] || m[i + w]) || p.face[i] >= 128) continue;
        const q = lab(i);
        // (By the neck, a dark garment's pure black, which the finder can call hair: their hair has some color
        // and light, never quite that.)
        const black = dark && q[0] < 6 && Math.hypot(q[1], q[2]) < 5 && Math.abs(x - Fc) < L.fw * 0.5 && y >= L.chin - L.fh * 0.12 && y < L.chin + L.fh * 0.8 && underJaw(x, y);
        if (black || (unsure(i) && like(q))) add.push(i);
      }
      if (!add.length) break;
      for (const i of add) { m[i] = 1; seen[i] = 1; }
    }
  }
  let box1 = boxOf(m, w, h); if (!box1) return null;
  // (And on down from what's found of it to where it really ends: the zone's own bottom, its waist line,
  // isn't where a long top stops.)
  if (!byHand) { const more = downToHem(S, { mask: m, box: box1 }); if (more.mask !== m) { for (let i = 0; i < m.length; i++) if (more.mask[i]) m[i] = 1; box1 = boxOf(m, w, h); } }
  fillHoles(m, w, h, box1, 0.05);
  const box = boxOf(m, w, h);
  // (`seen`: where it was found between strands of hair, by its own color.)
  const z = { mask: m, box, spans: rowSpans(m, w, box, Math.max(14, Math.round((box.y1 - box.y0) / 14))), seen, on: personOn, vivid: pal.filter((g) => Math.hypot(g[1], g[2]) > 20) };
  target.zoneOf = { base, kind, layout: L, z };
  return z;
}

/**
 * Under strands of hair over the garment taken off (Replace): the new piece's own color there, not their bare
 * skin, so a strand the finder is unsure of blends over the new top as it did over the old one. On `out`
 * (w wide, laid before the layer), where the layer (`layer`, finished: its alpha lowered by what's in front)
 * has the piece but lets something show through. In place.
 */
export function underStrands(out, w, layer, z, people) {
  if (!layer || !z) return;
  for (let y = 0; y < layer.ph; y++) for (let x = 0; x < layer.pw; x++) {
    const o = (y * layer.pw + x) * 4; const a = layer.rgba[o + 3]; if (a >= 250) continue;
    const X = layer.x0 + x; const Y = layer.y0 + y; if (X < 0 || Y < 0 || X >= w || Y * w + X >= z.mask.length) continue;
    const i = Y * w + X; if (!z.mask[i] || people.hair[i] < 25 || people.face[i] >= 128) continue;
    // (Only where the layer reaches: its color there, before what's in front lowered it.)
    if (!layer.rgba[o] && !layer.rgba[o + 1] && !layer.rgba[o + 2]) continue;
    out[i * 4] = layer.rgba[o]; out[i * 4 + 1] = layer.rgba[o + 1]; out[i * 4 + 2] = layer.rgba[o + 2];
  }
}

/**
 * The piece's edges lying on the skin made where the garment was taken off (a short top's hem over a bare
 * midriff, a jacket's open front beside it): a soft shadow just next to them on that skin, as cloth casts on
 * skin, so the skin sits under the piece instead of looking cut out flat. On `out` (w×h, after the made skin
 * `patch` and before the `layer` is laid), only on made skin, only where the layer doesn't cover it. In place.
 */
export function shadeUnder(out, w, h, layer, patch, fh) {
  if (!layer || !patch) return;
  const D = Math.max(2, Math.round(fh * 0.14));
  const x0 = Math.max(0, layer.x0 - D); const y0 = Math.max(0, layer.y0 - D); const x1 = Math.min(w, layer.x0 + layer.pw + D); const y1 = Math.min(h, layer.y0 + layer.ph + D);
  const bw = x1 - x0; const bh = y1 - y0; if (bw <= 0 || bh <= 0) return;
  const la = (X, Y) => { const x = X - layer.x0; const y = Y - layer.y0; return x < 0 || y < 0 || x >= layer.pw || y >= layer.ph ? 0 : layer.rgba[(y * layer.pw + x) * 4 + 3]; };
  const pa = (X, Y) => { const x = X - patch.x0; const y = Y - patch.y0; return x < 0 || y < 0 || x >= patch.pw || y >= patch.ph ? 0 : patch.rgba[(y * patch.pw + x) * 4 + 3]; };
  const d = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) d[y * bw + x] = la(x0 + x, y0 + y) >= 200 ? 0 : 1e9;
  chamfer(d, bw, bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x; if (d[k] === 0 || d[k] >= D) continue;
    const X = x0 + x; const Y = y0 + y; if (pa(X, Y) < 128 || la(X, Y) >= 128) continue;
    const t = 1 - d[k] / D; const f = 1 - 0.38 * t * t;
    const i = (Y * w + X) * 4; out[i] *= f; out[i + 1] *= f; out[i + 2] *= f;
  }
}

/** An outline (`u`: { mask, box, spans, ... }) with the garment zone's pixels added (its other fields kept). */
function withZone(u, z, w, h) {
  if (!z) return u;
  if (u.zoned?.z === z) return u.zoned.out;
  // (And only what's on the person: nothing of the same color off on its own beside them.)
  const m = Uint8Array.from(u.mask); for (let i = 0; i < m.length; i++) { if (z.mask[i]) m[i] = 1; else if (m[i] && z.on && !z.on[i]) m[i] = 0; }
  const box = boxOf(m, w, h) ?? u.box;
  const out = { ...u, mask: m, box, spans: rowSpans(m, w, box, Math.max(14, Math.round((box.y1 - box.y0) / 14))) };
  u.zoned = { z, out };
  return out;
}

/**
 * The garment worn there erased (Replace): each of its pixels made their bare skin. First a made-up skin, in
 * their own skin's color and fine texture, lit as their skin is around it (the broad light on them, a little
 * darker toward the body's sides, the shadow under the chin). Then, wherever it borders their real skin (the
 * neck above an open collar, a shoulder, an arm), it's carried smoothly into that skin: the difference
 * between their real skin there (smoothed) and the made-up one spread across it as a membrane, all of it at
 * the border and less going in, fading to none where it borders something else (hair, the background). So
 * it meets their skin with no seam, in its color and light. A patch over the zone, laid on the picture before
 * the piece, or null without their skin to go by.
 */
/** Distances in place: 0 where `d` is 0, else to the nearest such pixel (two chamfer passes). */
function chamfer(d, W, H) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y * W + x; let v = d[k]; if (x > 0) v = Math.min(v, d[k - 1] + 1); if (y > 0) v = Math.min(v, d[k - W] + 1); if (x > 0 && y > 0) v = Math.min(v, d[k - W - 1] + 1.414); if (x < W - 1 && y > 0) v = Math.min(v, d[k - W + 1] + 1.414); d[k] = v; }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const k = y * W + x; let v = d[k]; if (x < W - 1) v = Math.min(v, d[k + 1] + 1); if (y < H - 1) v = Math.min(v, d[k + W] + 1); if (x < W - 1 && y < H - 1) v = Math.min(v, d[k + W + 1] + 1.414); if (x > 0 && y < H - 1) v = Math.min(v, d[k + W - 1] + 1.414); d[k] = v; }
  return d;
}

export function eraseGarment(S, z) {
  if (!z) return null;
  if (z.erased === undefined) { z.erased = makeSkin(S, z); try { z.erased = cleanHairTips(S, z, z.erased); } catch { /* as it was */ } }
  return z.erased;
}

/**
 * The tips of their hair over where the garment was, cleaned of its color: a lock lying over a red stole
 * is a mix of hair and red at its ends (and in its shade), which stays when the stole is taken off. There,
 * near the garment and only in hair, the garment's colorful part is taken out of each pixel's color (its
 * lightness kept), leaving their hair's own color as it is just beyond. Merged into `patch` (made bigger to
 * reach them); `patch` as it was when there's nothing to clean.
 */
function cleanHairTips(S, z, patch) {
  const { base, kind } = S; const { w, h } = base; const p = base.people; const L = base.layout;
  if (kind !== 'upper' && kind !== 'top' && kind !== 'dress') return patch;
  if (!z.vivid?.length || !L) return patch;
  const D = Math.max(4, Math.round(L.fh * 0.3));
  const b = z.box; const x0 = Math.max(0, b.x0 - D); const y0 = Math.max(0, Math.min(b.y0, Math.floor(L.chin)) - D); const x1 = Math.min(w, b.x1 + D); const y1 = Math.min(h, b.y1 + D);
  const bw = x1 - x0; const bh = y1 - y0; if (bw <= 0 || bh <= 0) return patch;
  // (How far each pixel is from the garment.)
  const d = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) d[y * bw + x] = z.mask[(y0 + y) * w + x0 + x] ? 0 : 1e9;
  chamfer(d, bw, bh);
  // (Their hair's color just beyond the tips (D to 2.5 D out), carried to each tip: a box average.)
  const lab = new Float32Array(bw * bh * 3);
  const SA = new Float64Array((bw + 1) * (bh + 1)); const SB = new Float64Array((bw + 1) * (bh + 1)); const SN = new Float64Array((bw + 1) * (bh + 1));
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x; const i = (y0 + y) * w + x0 + x;
    const q = rgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]); lab[k * 3] = q[0]; lab[k * 3 + 1] = q[1]; lab[k * 3 + 2] = q[2];
    const far = p.hair[i] >= 180 && d[k] > D * 0.8 && d[k] < D * 2.5 && p.face[i] < 100;
    const o = (y + 1) * (bw + 1) + x + 1;
    SA[o] = SA[o - 1] + SA[o - bw - 1] - SA[o - bw - 2] + (far ? q[1] : 0);
    SB[o] = SB[o - 1] + SB[o - bw - 1] - SB[o - bw - 2] + (far ? q[2] : 0);
    SN[o] = SN[o - 1] + SN[o - bw - 1] - SN[o - bw - 2] + (far ? 1 : 0);
  }
  const R = Math.round(D * 1.5);
  const boxSum = (S2, xa, ya, xb, yb) => S2[yb * (bw + 1) + xb] - S2[ya * (bw + 1) + xb] - S2[yb * (bw + 1) + xa] + S2[ya * (bw + 1) + xa];
  const out = new Uint8ClampedArray(bw * bh * 4); let n = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x; const i = (y0 + y) * w + x0 + x;
    if (d[k] === 0 || d[k] > D || p.hair[i] < 40 || p.face[i] >= 100 || y0 + y < L.chin) continue;
    const xa = Math.max(0, x - R); const xb = Math.min(bw, x + R + 1); const ya = Math.max(0, y - R); const yb = Math.min(bh, y + R + 1);
    const cnt = boxSum(SN, xa, ya, xb, yb); if (cnt < 12) continue;
    const ha = boxSum(SA, xa, ya, xb, yb) / cnt; const hb = boxSum(SB, xa, ya, xb, yb) / cnt;
    const qa = lab[k * 3 + 1]; const qb = lab[k * 3 + 2];
    // (How much of the garment's colorful part is in it: along the line from their hair's color to it.)
    let best = 0; let ga = 0; let gb = 0;
    for (const g of z.vivid) {
      const va = g[1] - ha; const vb = g[2] - hb; const vv = va * va + vb * vb; if (vv < 100) continue;
      const t = ((qa - ha) * va + (qb - hb) * vb) / vv;
      const perp = Math.abs((qa - ha) * vb - (qb - hb) * va) / Math.sqrt(vv);
      if (t > best && perp < 18) { best = Math.min(1, t); ga = va; gb = vb; }
    }
    if (best < 0.12) continue;
    // (Its garment part taken out, then half way to their hair's color there, so what's left of the mix
    // isn't another tint.)
    const na = (qa - best * ga + ha) / 2; const nb = (qb - best * gb + hb) / 2;
    const rgb = labToRgb(lab[k * 3], na, nb);
    const o = k * 4; out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2];
    // (Fully at the tips, less toward the far end, so it meets the hair beyond without an edge.)
    out[o + 3] = Math.round(255 * Math.min(1, 1.25 - d[k] / D) * Math.min(1, best * 3));
    n++;
  }
  if (!n) return patch;
  // (Merged: the cleaned tips under the made skin, which is laid over them where it reaches.)
  const X0 = Math.min(x0, patch?.x0 ?? x0); const Y0 = Math.min(y0, patch?.y0 ?? y0);
  const X1 = Math.max(x1, patch ? patch.x0 + patch.pw : x1); const Y1 = Math.max(y1, patch ? patch.y0 + patch.ph : y1);
  const pw = X1 - X0; const ph = Y1 - Y0; const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const s2 = (y * bw + x) * 4; if (!out[s2 + 3]) continue; const t = ((y0 + y - Y0) * pw + x0 + x - X0) * 4; rgba.set(out.subarray(s2, s2 + 4), t); }
  if (patch) for (let y = 0; y < patch.ph; y++) for (let x = 0; x < patch.pw; x++) {
    const s2 = (y * patch.pw + x) * 4; const a = patch.rgba[s2 + 3] / 255; if (!a) continue;
    const t = ((patch.y0 + y - Y0) * pw + patch.x0 + x - X0) * 4; const b0 = rgba[t + 3] / 255;
    const ao = a + b0 * (1 - a);
    for (let c = 0; c < 3; c++) rgba[t + c] = (patch.rgba[s2 + c] * a + rgba[t + c] * b0 * (1 - a)) / Math.max(1e-6, ao);
    rgba[t + 3] = Math.round(ao * 255);
  }
  return { ...patch, x0: X0, y0: Y0, pw, ph, rgba };
}

function makeSkin(S, z) {
  const { base } = S; const { w, h } = base; const p = base.people;
  if (!z) return null;
  const tone = skinTone(base); if (!tone) return null;
  const fh = base.layout?.fh ?? h / 7; const R = Math.max(8, Math.round(fh * 1.2));
  const b = z.box; const X0 = Math.max(0, b.x0 - R); const Y0 = Math.max(0, b.y0 - R); const X1 = Math.min(w, b.x1 + R); const Y1 = Math.min(h, b.y1 + R);
  const bw = X1 - X0; const bh = Y1 - Y0;
  const realSkin = (i) => p.body[i] >= 160 && p.face[i] < 100 && p.hair[i] < 60 && !z.mask[i];
  // (The light on their skin around it, read broadly.)
  const lum = new Float32Array(bw * bh); const ok = new Uint8Array(bw * bh); const vals = [];
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = (Y0 + y) * w + X0 + x;
    if (realSkin(i) && p.body[i] >= 200) { const v = 0.299 * base.rgba[i * 4] + 0.587 * base.rgba[i * 4 + 1] + 0.114 * base.rgba[i * 4 + 2]; lum[y * bw + x] = v; ok[y * bw + x] = 1; vals.push(v); }
  }
  vals.sort((a, c) => a - c); const mid = vals.length > 30 ? vals[vals.length >> 1] : null;
  // (Three passes of a third the size: smooth, not a box's square steps.)
  const R3 = Math.max(3, Math.round(R / 1.7)); const all1 = new Uint8Array(bw * bh).fill(1);
  const field = mid ? (() => { const f = boxBlur(lum, ok, bw, bh, R3); const c = boxBlur(Float32Array.from(ok), all1, bw, bh, R3); const fc = new Float32Array(bw * bh); for (let k = 0; k < bw * bh; k++) fc[k] = f[k] * c[k]; const f2 = boxBlur(boxBlur(fc, all1, bw, bh, R3), all1, bw, bh, R3); const c2 = boxBlur(boxBlur(c, all1, bw, bh, R3), all1, bw, bh, R3); for (let k = 0; k < bw * bh; k++) f2[k] = c2[k] > 1e-4 ? f2[k] / c2[k] : mid; return f2; })() : null;
  const cover = mid ? boxBlur(boxBlur(boxBlur(Float32Array.from(ok), all1, bw, bh, R3), all1, bw, bh, R3), all1, bw, bh, R3) : null;
  const L0 = base.layout;
  // The neck: a column from under the chin down to the shoulders, its middle under the chin's lowest point
  // leaning to the shoulders' middle, a third of a face wide at the jaw and flaring toward the shoulders.
  // Above the shoulders, what's made is the neck (lit round, as a cylinder is), and beside it a soft shadow
  // (what's behind it under their hair), not a flat slab of skin from one side to the other.
  let neck = null;
  {
    const q = base.pose; const seenP = (v) => v && v[2] >= 0.3;
    if (L0?.face && q && seenP(q.shoulders?.[0]) && seenP(q.shoulders?.[1])) {
      // (The chin's lowest point: the lowest rows of the face, their middle.)
      let cy = -1; for (let y = Math.min(h - 1, Math.round(L0.face.y1 + L0.fh * 0.2)); y > L0.face.y0; y--) { let any = false; for (let x = Math.max(0, Math.floor(L0.face.x0)); x < Math.min(w, Math.ceil(L0.face.x1)); x++) if (p.face[y * w + x] >= 128) { any = true; break; } if (any) { cy = y; break; } }
      let sx = 0; let sn = 0; if (cy > 0) for (let y = Math.max(0, cy - Math.round(L0.fh * 0.06)); y <= cy; y++) for (let x = Math.max(0, Math.floor(L0.face.x0)); x < Math.min(w, Math.ceil(L0.face.x1)); x++) if (p.face[y * w + x] >= 128) { sx += x; sn++; }
      if (sn) {
        const cx0 = sx / sn; const sy = (q.shoulders[0][1] + q.shoulders[1][1]) / 2; const smx = (q.shoulders[0][0] + q.shoulders[1][0]) / 2;
        const y1 = Math.max(cy + L0.fh * 0.35, sy);
        neck = {
          y0: cy, y1,
          at: (y) => { const t = Math.max(0, Math.min(1, (y - cy) / Math.max(1, y1 - cy))); return { c: cx0 + (smx - cx0) * t * 0.7, hw: L0.fw * (0.3 + 0.22 * t * t) }; },
        };
      }
    }
  }
  const soft = Math.max(2, Math.round(fh / 22));
  // (The neck's two sides as smooth lines: on each row, its model's side, or just inside where their hair
  // comes in if that's nearer, smoothed down the neck. The skin ends on that line and what's behind the neck
  // (the dark under their hair) is past it, so the ragged edge of the hair lies on dark, as it did on the
  // old collar, not on skin: one continuous line of neck beside the hair.)
  if (neck) {
    const n0 = Math.floor(neck.y0); const nr = Math.max(1, Math.ceil(neck.y1) - n0);
    const L1 = new Float32Array(nr); const R1 = new Float32Array(nr);
    const margin = soft * 1.5;
    for (let r = 0; r < nr; r++) {
      const y = n0 + r; const { c, hw } = neck.at(y); let l = c - hw; let rr = c + hw;
      if (y >= 0 && y < h) {
        const cx = Math.round(c);
        for (let x = cx; x >= Math.max(0, Math.floor(c - hw)); x--) { const j = y * w + x; if (!z.mask[j] && p.hair[j] >= 100) { l = Math.max(l, x + margin); break; } }
        for (let x = cx; x <= Math.min(w - 1, Math.ceil(c + hw)); x++) { const j = y * w + x; if (!z.mask[j] && p.hair[j] >= 100) { rr = Math.min(rr, x - margin); break; } }
      }
      // (Never narrower than half the model's: a lock of hair across the neck lies over it.)
      if (rr - l < hw) { const m2 = (l + rr) / 2; l = m2 - hw / 2; rr = m2 + hw / 2; }
      L1[r] = l; R1[r] = rr;
    }
    // (Where some of their real neck shows above it (between the jaw and the collar): the made neck starts
    // exactly as wide as that, its sides going on from the real neck's, and eases into the model further
    // down; so the neckline is one continuous line where skin meets skin, never a step or a ledge of skin
    // past the real neck into what's beside it.)
    {
      const realSk = (j) => !z.mask[j] && p.face[j] < 128 && p.hair[j] < 90 && Math.max(p.body[j], p.face[j]) >= 60 && p.body[j] + p.face[j] > p.hair[j] + p.clothes[j];
      const cx0 = Math.round(neck.at(neck.y0).c); let ytop = -1;
      for (let y = Math.max(0, n0); y < Math.min(h, n0 + nr); y++) if (z.mask[y * w + cx0]) { ytop = y; break; }
      if (ytop > 0) {
        const ls = []; const rs = [];
        for (let y = Math.max(0, ytop - Math.round(fh * 0.12)); y < ytop; y++) {
          if (!realSk(y * w + cx0)) continue;
          let l = cx0; while (l > 0 && realSk(y * w + l - 1)) l--;
          let r = cx0; while (r < w - 1 && realSk(y * w + r + 1)) r++;
          ls.push(l); rs.push(r + 1);
        }
        if (ls.length >= 2) {
          ls.sort((a2, b2) => a2 - b2); rs.sort((a2, b2) => a2 - b2);
          const lE = ls[ls.length >> 1]; const rE = rs[rs.length >> 1]; const ease = Math.max(4, fh * 0.45);
          neck.real = true;
          for (let r = 0; r < nr; r++) {
            const y = n0 + r; if (y < ytop) { L1[r] = lE; R1[r] = rE; continue; }
            const t = Math.min(1, (y - ytop) / ease); const k = t * t * (3 - 2 * t);
            L1[r] = lE + (L1[r] - lE) * k; R1[r] = rE + (R1[r] - rE) * k;
          }
        }
      }
    }
    // (Smoothed down the neck: a run of rows a fifth of a face's height, twice.)
    const sm = (v) => { const R = Math.max(2, Math.round(fh * 0.1)); let o = v; for (let pass = 0; pass < 2; pass++) { const q = new Float32Array(nr); for (let r = 0; r < nr; r++) { let s2 = 0; let n2 = 0; for (let d = -R; d <= R; d++) { const t = r + d; if (t >= 0 && t < nr) { s2 += o[t]; n2++; } } q[r] = s2 / n2; } o = q; } return o; };
    const LS = sm(L1); const RS = sm(R1); const at0 = neck.at;
    neck.at = (y) => { const r = Math.max(0, Math.min(nr - 1, Math.round(y - n0))); const l = LS[r]; const rr = RS[r]; const m0 = at0(y); return { c: (l + rr) / 2, hw: Math.max(4, (rr - l) / 2), c0: m0.c, hw0: m0.hw }; };
  }
  // (Shade where it meets hair or a deep shadow beside it (not their skin): skin is darker in the hollow
  // under a lock of hair or against the dark behind it, so it sits in the picture, not on it.)
  const occ = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x; const i = (Y0 + y) * w + X0 + x;
    if (z.mask[i]) { occ[k] = 1e9; continue; }
    const v = 0.299 * base.rgba[i * 4] + 0.587 * base.rgba[i * 4 + 1] + 0.114 * base.rgba[i * 4 + 2];
    occ[k] = (p.hair[i] >= 128 || (mid && v < mid * 0.35)) && p.face[i] < 128 ? 0 : 1e9;
  }
  chamfer(occ, bw, bh);
  const aoR = Math.max(4, fh * 0.09);
  // (The shadow beside the neck fades out over its last fifth, into the shoulders.)
  const y1Fade = (y) => { if (!neck) return 0; const t = Math.max(0, Math.min(1, (neck.y1 - y) / ((neck.y1 - neck.y0) * 0.45))); return t * t * (3 - 2 * t); };
  // The made-up skin's smooth color at any pixel of the box (its light; no texture yet).
  // (Round as a body is: darker toward its outline (where it turns away from the light), from how far each
  // pixel is inside their whole figure, smoothed so the outline's ragged steps don't show.)
  const fw0 = L0?.fw ?? fh * 0.75;
  const fig = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const i = (Y0 + y) * w + X0 + x; fig[y * bw + x] = z.mask[i] || Math.max(p.body[i], p.clothes[i], p.face[i]) >= 128 || p.hair[i] >= 128 ? 1e9 : 0; }
  chamfer(fig, bw, bh);
  // (Each limb by its own width: how far in a pixel is over how far in the middle of that part of them is (the
  // most of it nearby), so an arm is round as an arm is (lit down its middle, darker toward its sides), not
  // flat because it's narrower than a body.)
  const R0 = Math.max(4, Math.round(fw0 * 0.5)); const capF = new Float32Array(bw * bh);
  for (let k = 0; k < bw * bh; k++) capF[k] = Math.min(fig[k], R0 * 2);
  const mx1 = new Float32Array(bw * bh); const mx2 = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let m = 0; for (let d = -R0; d <= R0; d += 2) { const xx = x + d; if (xx >= 0 && xx < bw) { const v = capF[y * bw + xx]; if (v > m) m = v; } } mx1[y * bw + x] = m; }
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let m = 0; for (let d = -R0; d <= R0; d += 2) { const yy = y + d; if (yy >= 0 && yy < bh) { const v = mx1[yy * bw + x]; if (v > m) m = v; } } mx2[y * bw + x] = m; }
  let rnd = new Float32Array(bw * bh);
  for (let k = 0; k < bw * bh; k++) { const t = Math.min(1, capF[k] / Math.max(2, Math.min(mx2[k], fw0 * 0.55))); rnd[k] = 1 - 0.17 * (1 - Math.sqrt(Math.max(0, Math.sin((Math.PI / 2) * t)))); }
  // (An arm by the pose: across it from its bone line out, a lit cylinder, as bright as the cosine of how far
  // it has turned from the light, darker steadily toward each side, also the side against the body, which
  // the figure's outline doesn't show. Its radius: from its line to its outer edge, where it meets what's
  // behind them.)
  {
    const q = base.pose; const seenP = (v) => v && v[2] >= 0.3;
    const sw = q && seenP(q.shoulders?.[0]) && seenP(q.shoulders?.[1]) ? Math.hypot(q.shoulders[1][0] - q.shoulders[0][0], q.shoulders[1][1] - q.shoulders[0][1]) : fw0 * 2;
    const segs = [];
    for (const k of [0, 1]) {
      if (!q || !seenP(q.shoulders?.[k]) || !seenP(q.elbows?.[k])) continue;
      segs.push([q.shoulders[k], q.elbows[k]]); if (seenP(q.wrists?.[k])) segs.push([q.elbows[k], q.wrists[k]]);
    }
    const inFig = (X, Y) => X >= 0 && Y >= 0 && X < w && Y < h && (z.mask[Y * w + X] || Math.max(p.body[Y * w + X], p.clothes[Y * w + X]) >= 128);
    for (const [A, B] of segs) {
      const dx = B[0] - A[0]; const dy = B[1] - A[1]; const len = Math.hypot(dx, dy); if (len < 4) continue;
      const nx = -dy / len; const ny = dx / len;
      // (Its radius: the shorter run out from its middle to the figure's edge, one side or the other.)
      const run = (sg) => { let r = 0; const mx = A[0] + dx * 0.6; const my = A[1] + dy * 0.6; while (r < sw * 0.3 && inFig(Math.round(mx + nx * r * sg), Math.round(my + ny * r * sg))) r++; return r; };
      const r = Math.max(sw * 0.06, Math.min(sw * 0.16, Math.min(run(1), run(-1))));
      const xa = Math.max(X0, Math.floor(Math.min(A[0], B[0]) - r * 1.4)); const xb = Math.min(X0 + bw, Math.ceil(Math.max(A[0], B[0]) + r * 1.4));
      const ya = Math.max(Y0, Math.floor(Math.min(A[1], B[1]) - r * 1.4)); const yb = Math.min(Y0 + bh, Math.ceil(Math.max(A[1], B[1]) + r * 1.4));
      for (let Y = ya; Y < yb; Y++) for (let X = xa; X < xb; X++) {
        const t = ((X - A[0]) * dx + (Y - A[1]) * dy) / (len * len); if (t < 0 || t > 1.08) continue;
        const d = Math.abs((X - A[0]) * nx + (Y - A[1]) * ny); if (d > r * 1.35) continue;
        const k = (Y - Y0) * bw + X - X0; const u = Math.min(1, d / r);
        const cyl = 0.64 + 0.36 * Math.sqrt(Math.max(0, 1 - u * u));
        // (All of it within the arm, fading out just past it; and not where the shoulder joins the chest.)
        const wgt = Math.min(1, Math.max(0, (r * 1.35 - d) / (r * 0.35))) * Math.min(1, t / 0.15);
        rnd[k] = Math.min(rnd[k], rnd[k] * (1 - wgt) + cyl * wgt);
      }
    }
  }
  { const rr = Math.max(2, Math.round(fh * 0.06)); rnd = boxBlur(boxBlur(boxBlur(rnd, all1, bw, bh, rr), all1, bw, bh, rr), all1, bw, bh, rr); }
  // (The light's side: which half of their face is brighter, carried gently across the body.)
  let lit = 0; let lcx = (b.x0 + b.x1) / 2;
  if (L0?.face) {
    const f = L0.face; lcx = (f.x0 + f.x1) / 2; let sl = 0; let nl = 0; let sr = 0; let nr2 = 0;
    for (let y = Math.max(0, Math.round(f.y0)); y < Math.min(h, Math.round(f.y1)); y += 2) for (let x = Math.max(0, Math.round(f.x0)); x < Math.min(w, Math.round(f.x1)); x += 2) { const i = y * w + x; if (p.face[i] < 200 || p.hair[i] > 40) continue; const v = 0.299 * base.rgba[i * 4] + 0.587 * base.rgba[i * 4 + 1] + 0.114 * base.rgba[i * 4 + 2]; if (x < lcx) { sl += v; nl++; } else { sr += v; nr2++; } }
    if (nl > 30 && nr2 > 30) lit = Math.max(-0.12, Math.min(0.12, ((sr / nr2) - (sl / nl)) / ((sr / nr2) + (sl / nl))));
  }
  // (The collarbones and the hollow at the throat: below the neck, from its foot out to each shoulder, a soft
  // ridge of light with the shade under it, as a chest shows them; only where skin is made, away from theirs.)
  let bones = null;
  {
    const q = base.pose; const seenP = (v) => v && v[2] >= 0.3;
    if (q && seenP(q.shoulders?.[0]) && seenP(q.shoulders?.[1])) {
      const [s0, s1] = q.shoulders; const sw = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
      const N = [(s0[0] + s1[0]) / 2, (s0[1] + s1[1]) / 2 + sw * 0.07];
      const ends = [s0, s1].map((v) => [v[0] + (N[0] - v[0]) * 0.18, v[1] - sw * 0.01]);
      bones = { N, ends, sw };
    }
  }
  const boneShade = (x, y) => {
    if (!bones) return 1; const { N, ends, sw } = bones; let f = 1;
    const th = sw * 0.035;
    for (const E of ends) {
      const dx = E[0] - N[0]; const dy = E[1] - N[1]; const L2 = dx * dx + dy * dy || 1;
      const t = ((x - N[0]) * dx + (y - N[1]) * dy) / L2; if (t < -0.05 || t > 1.05) continue;
      const tc = Math.max(0, Math.min(1, t)); const px = N[0] + dx * tc; const py = N[1] + dy * tc;
      // (Below the line is positive: the shade under the bone.)
      const sgn = Math.sign((x - N[0]) * dy - (y - N[1]) * dx) * Math.sign(dx || 1) * -1;
      const dd = Math.hypot(x - px, y - py) * (sgn || 1);
      const along = Math.sin(Math.PI * Math.max(0, Math.min(1, (t - 0.06) / 0.9)));
      const ridge = Math.exp(-((dd + th * 0.2) ** 2) / (2 * (th * 0.7) ** 2)); const under = Math.exp(-((dd - th * 1.6) ** 2) / (2 * (th * 1.1) ** 2));
      f *= 1 + along * (0.045 * ridge - 0.06 * under);
    }
    const rN = Math.hypot(x - N[0], (y - N[1]) * 1.3); f *= 1 - 0.07 * Math.exp(-(rN * rN) / (2 * (sw * 0.045) ** 2));
    return f;
  };
  // (Its shading in two parts: the broad light and rounding of the zone (`made`), which their real skin it
  // touches has too, and the shapes only made skin has (the chin's shadow, the neck's roundness, shade by hair:
  // `extra`), which come in only away from their skin, so where it meets their skin it's exactly that skin.)
  let extraOn = true;
  const made = (x, y) => {
    const k = (y - Y0) * bw + x - X0;
    let sh = 1;
    if (field) sh = 1 + (Math.max(0.78, Math.min(1.15, field[k] / mid)) - 1) * Math.min(1, cover[k] / 0.2);
    sh *= rnd[k] * (1 + lit * Math.max(-1, Math.min(1, (x - lcx) / (fw0 * 1.6))));
    let ex = boneShade(x + 0.5, y + 0.5);
    { const ko = (y - Y0) * bw + x - X0; const dd = occ[ko]; if (dd < aoR) { const t = 1 - dd / aoR; ex *= 1 - 0.14 * t * t; } }
    // (On the neck: round, its middle lit, darker toward its sides.)
    // (Faded out into the shoulders as the shadow beside it is: no step where the neck ends.)
    if (neck && y >= neck.y0 && y < neck.y1) { const { c, hw } = neck.at(y); const u = Math.min(1, Math.abs(x + 0.5 - c) / hw); ex *= 1 - 0.1 * y1Fade(y) * (1 - Math.sqrt(Math.max(0, Math.cos((Math.PI / 2) * u)))); }
    // (Under the chin: in its shadow, darkest just below the jaw, lighter going down the neck.)
    // (Not when some of their real neck shows above it: that has the chin's real shadow already, carried
    // down from it; a second, made one under it would be a dark band below the old collar's line.)
    if (L0 && !neck?.real && y >= L0.chin && y < L0.chin + L0.fh * 0.45) ex *= 0.86 + 0.14 * Math.min(1, (y - L0.chin) / (L0.fh * 0.45));
    if (!extraOn) return sh;
    const kd = (y - Y0) * bw + x - X0; const away = ds ? Math.min(1, ds[kd] / (fh * 0.22)) : 1;
    return sh * (1 - (1 - ex) * away * away * (3 - 2 * away));
  };
  // Their real skin, smoothed (its color and light, not its pores), where it is, over a few pixels only (the
  // shade just under the jaw isn't averaged away).
  const rs = Math.max(1, Math.round(fh / 120));
  const sk = new Uint8Array(bw * bh); const ch = [0, 1, 2].map(() => new Float32Array(bw * bh));
  // (The underside of the jaw counts here too, though the finder calls it face: it's the skin the neck meets.)
  // (And skin-colored: a white top's lit rim, which the finder can call skin, would tint the made skin white.)
  const toneLab = rgbToLab(tone[0], tone[1], tone[2]);
  const skinColored = (i) => { const q = rgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]); return Math.hypot((q[0] - toneLab[0]) * 0.35, q[1] - toneLab[1], q[2] - toneLab[2]) < 24; };
  const touchSkin = (i) => !z.mask[i] && p.hair[i] < 90 && Math.max(p.body[i], p.face[i]) >= 60 && p.body[i] + p.face[i] > p.hair[i] + p.clothes[i] && skinColored(i);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const i = (Y0 + y) * w + X0 + x; const k = y * bw + x; if (touchSkin(i)) { sk[k] = 1; for (let c = 0; c < 3; c++) ch[c][k] = base.rgba[i * 4 + c]; } }
  const smooth = ch.map((v) => boxBlur(v, sk, bw, bh, rs));
  // The difference (real less made-up) fixed on their skin, nothing on anything else that isn't the zone, and
  // spread smoothly over the zone.
  // (Only their skin is held: anything else (hair, the background, unsure pixels between) is left free too,
  // so the skin's color reaches the zone across a thin unsure line; how far from their skin a pixel is then
  // fades it out.)
  // (How far each pixel is from the zone: skin near it is what it touches.)
  const dz = new Float32Array(bw * bh); for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) dz[y * bw + x] = z.mask[(Y0 + y) * w + X0 + x] ? 0 : 1e9;
  chamfer(dz, bw, bh);
  // (Its rim: a few pixels of their skin right outside it, much darker than their skin is (the collar's
  // shadow on the jaw, where the garment met it): made again from what's on either side of it, so no dark
  // line is left along the edge.)
  // (And its edge's own pixels, half garment and half skin (a white collar's light top edge against the
  // jaw): any pixel right outside it nearer the garment's color than their skin a little further out is, and
  // unlike that skin, is made again too, so no thin line of the old collar is left along the neck.)
  const rimR = Math.max(3, Math.round(fh / 40)); const rim = new Uint8Array(bw * bh); let nRim = 0;
  const gC = (() => { const v = [[], [], []]; for (let y = b.y0; y < b.y1; y += 3) for (let x = b.x0; x < b.x1; x += 3) { const i = y * w + x; if (z.mask[i]) for (let c = 0; c < 3; c++) v[c].push(base.rgba[i * 4 + c]); } return v[0].length > 20 ? v.map((a2) => { a2.sort((q, r2) => q - r2); return a2[a2.length >> 1]; }) : null; })();
  let ref = null;
  if (gC) {
    const band = new Uint8Array(bw * bh); const ch3 = [0, 1, 2].map(() => new Float32Array(bw * bh));
    for (let k = 0; k < bw * bh; k++) if (sk[k] && dz[k] > rimR && dz[k] <= rimR * 4) { band[k] = 1; const i = (Y0 + ((k / bw) | 0)) * w + X0 + (k % bw); for (let c = 0; c < 3; c++) ch3[c][k] = base.rgba[i * 4 + c]; }
    ref = ch3.map((v) => boxBlur(v, band, bw, bh, rimR * 3));
    const cover = boxBlur(Float32Array.from(band), new Uint8Array(bw * bh).fill(1), bw, bh, rimR * 3);
    for (let k = 0; k < bw * bh; k++) if (cover[k] < 0.02) ref[0][k] = -1;
  }
  const dist3 = (a2, b2) => Math.hypot(a2[0] - b2[0], a2[1] - b2[1], a2[2] - b2[2]);
  if (mid) for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x; const i = (Y0 + y) * w + X0 + x; if (z.mask[i] || dz[k] > rimR || p.hair[i] >= 160) continue;
    const px = [base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]];
    const v = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
    if (v < mid * 0.6 && p.face[i] < 200) { rim[k] = 1; nRim++; continue; }
    // (Only by a garment lighter than their skin: by a dark one, a half-collar pixel and a deep shadow on the
    // jaw look alike, and the shadow is theirs; dark edges are the rule above.)
    if (ref && ref[0][k] >= 0) { const r3 = [ref[0][k], ref[1][k], ref[2][k]]; const lum3 = (q) => 0.299 * q[0] + 0.587 * q[1] + 0.114 * q[2]; if (lum3(gC) > lum3(r3) + 10 && dist3(px, r3) > 10 && dist3(px, gC) < dist3(r3, gC) - 6) { rim[k] = 1; nRim++; } }
  }
  // (How far each pixel is from their skin: the carried color fades out over a third of a face's height.)
  const ds = new Float32Array(bw * bh); for (let k = 0; k < bw * bh; k++) ds[k] = sk[k] && !rim[k] ? 0 : 1e9;
  chamfer(ds, bw, bh);
  // (Measured against the made skin's broad light only: its own shapes come in away from their skin.)
  extraOn = false;
  const diff = new Float32Array(bw * bh * 3); const free = new Uint8Array(bw * bh); let touches = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x; const X = X0 + x; const Y = Y0 + y; const i = Y * w + X;
    if (z.mask[i] || !sk[k] || rim[k]) { free[k] = 1; diff[k * 3] = diff[k * 3 + 1] = diff[k * 3 + 2] = 1; continue; }
    const sh = made(X, Y);
    // (As a ratio, channel by channel: their skin's warmth kept, not washed out. At the border it's exactly
    // theirs, however deep its shade; only a little way in (`fade`) it's the made skin's own light, so one deep
    // shadow (under the jaw) doesn't darken all of it.)
    for (let c = 0; c < 3; c++) diff[k * 3 + c] = Math.max(0.3, Math.min(1.4, smooth[c][k] / Math.max(8, tone[c] * sh)));
    // (Counted where it touches the zone.)
    if (dz[k] <= 4) touches++;
  }
  if (touches > 4) membrane(diff, free, bw, bh);
  // (What's around it that isn't their skin (the dark behind their neck, their hair), carried smoothly into
  // it: beside the neck, that's what shows, so it meets what's beside it with no edge.)
  let around = null;
  if (neck) {
    around = new Float32Array(bw * bh * 3); const fr2 = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const k = y * bw + x; const i = (Y0 + y) * w + X0 + x;
      if (z.mask[i] || sk[k] || rim[k]) { fr2[k] = 1; continue; }
      // (Not the garment's colorful part left under the tips of their hair (a red stole): what's around is
      // their hair and what's behind it, without that.)
      if (z.vivid?.length) { const q = rgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]); if (Math.hypot(q[1], q[2]) > 14 && z.vivid.some((g) => Math.hypot(q[1] - g[1], q[2] - g[2]) < 28)) { fr2[k] = 1; continue; } }
      for (let c = 0; c < 3; c++) around[k * 3 + c] = base.rgba[i * 4 + c];
    }
    membrane(around, fr2, bw, bh);
  }
  // (Their skin's own light carried only a little way in (the shade under a jaw belongs to the jaw); past
  // that, the made skin's own light, which is theirs lit as their skin is lit.)
  const fade = fh * 0.16;
  extraOn = true;
  const sd = skinDetailOf(base) ?? grainOf(base);
  const hwr = (base.pose?.wrists ?? []).filter((v) => v && v[2] >= 0.2); const handAt = (x, y) => hwr.some((v) => Math.hypot(x - v[0], y - v[1]) < fh * 0.8);
  const ob = { x0: Math.max(0, b.x0 - rimR), y0: Math.max(0, b.y0 - rimR), x1: Math.min(w, b.x1 + rimR), y1: Math.min(h, b.y1 + rimR) };
  const pw = ob.x1 - ob.x0; const ph = ob.y1 - ob.y0; const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (let y = ob.y0; y < ob.y1; y++) for (let x = ob.x0; x < ob.x1; x++) {
    const i = y * w + x; const kk = (y - Y0) * bw + x - X0;
    // (And just past it over their real skin, faintly: made and real skin meet over a few pixels, not on a line.)
    const ring = !z.mask[i] && !rim[kk] && sk[kk] && dz[kk] <= rimR && p.face[i] < 200;
    if (!z.mask[i] && !rim[kk] && !ring) continue;
    const k = (y - Y0) * bw + x - X0; const sh = made(x, y);
    const dt = sd ? sd(x, y) : null;
    const o = ((y - ob.y0) * pw + x - ob.x0) * 4;
    // (The skin it meets carried in two parts: its light only a little way (a shadow under the jaw belongs
    // to the jaw), its color much further, so the made skin stays the same warmth as the real skin beside it
    // (no greyer band below the old collar), lit as the made skin is.)
    let qL = 1; const qC = [1, 1, 1];
    if (touches > 4) {
      const d0 = diff[k * 3]; const d1 = diff[k * 3 + 1]; const d2 = diff[k * 3 + 2];
      const tl = 0.299 * tone[0] + 0.587 * tone[1] + 0.114 * tone[2];
      const dl = (0.299 * tone[0] * d0 + 0.587 * tone[1] * d1 + 0.114 * tone[2] * d2) / Math.max(1, tl);
      const sm2 = (t) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
      const fL = 1 - sm2(ds[k] / fade); const fC = 1 - sm2(ds[k] / (fade * 3.5));
      qL = 1 + (dl - 1) * fL;
      for (let c = 0; c < 3; c++) qC[c] = 1 + ([d0, d1, d2][c] / Math.max(0.05, dl) - 1) * fC;
    }
    for (let c = 0; c < 3; c++) {
      const q = qL * qC[c];
      rgba[o + c] = tone[c] * sh * q + (dt ? dt[c] * sh : 0);
    }
    // (The rim softly, its outer pixels less: no new edge of its own.)
    // (Beside the neck, above the shoulders: shadow, what's behind it, deepening away from its edge.)
    if (neck && y >= neck.y0 && y < neck.y1) {
      const { c, hw } = neck.at(y); const out2 = Math.abs(x + 0.5 - c) - hw;
      // (Only just beside it, where its shadow and what's behind it show: fading out going away from it, so
      // the shoulders out past it are skin, not what's behind them.)
      if (out2 > -soft * 2 && around) { const t0 = Math.max(0, Math.min(1, (out2 + soft * 2) / (4 * soft))); const u0 = Math.max(0, Math.min(1, (out2 - hw * 0.45) / (hw * 0.6))); const t = t0 * t0 * (3 - 2 * t0) * (1 - u0 * u0 * (3 - 2 * u0)); const fall = y1Fade(y); for (let c2 = 0; c2 < 3; c2++) rgba[o + c2] = rgba[o + c2] * (1 - t * fall) + around[kk * 3 + c2] * t * fall; }
    }
    // (Its outer edge against what's behind them soft, a pixel or two, as the photo's own edges are.)
    if (z.mask[i] && fig[k] <= 2) {
      // (Blended with what's just outside them, not see-through: under it is the old garment's edge.)
      let sr = 0; let sg = 0; let sb = 0; let sn = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = x + dx; const Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const kk2 = (Y - Y0) * bw + X - X0; if (kk2 < 0 || kk2 >= bw * bh || fig[kk2] > 0) continue; const j = (Y * w + X) * 4; sr += base.rgba[j]; sg += base.rgba[j + 1]; sb += base.rgba[j + 2]; sn++; }
      if (sn) { const t = fig[k] <= 1 ? 0.4 : 0.15; rgba[o] = rgba[o] * (1 - t) + (sr / sn) * t; rgba[o + 1] = rgba[o + 1] * (1 - t) + (sg / sn) * t; rgba[o + 2] = rgba[o + 2] * (1 - t) + (sb / sn) * t; }
    }
    rgba[o + 3] = z.mask[i] ? 255 : ring ? Math.round(255 * 0.55 * Math.max(0, 1 - dz[kk] / (rimR + 1))) : Math.round(255 * Math.min(1, 1.3 - dz[kk] / (rimR + 1)));
    // (Their own hand there (over where the garment was) is left as it is: it's in front, not taken off.)
    if (handAt(x, y) && p.body[i] >= 160 && p.face[i] < 100 && p.clothes[i] < 100) rgba[o + 3] = 0;
  }
  return { x0: ob.x0, y0: ob.y0, pw, ph, rgba };
}

/**
 * Taken off first: the layer's edge where it lies on the skin made there (its open collar against the neck)
 * faded in over a few pixels (as soft as the photo's own edges of cloth on skin), not cut: in place.
 */
function featherOnSkin(L, S) {
  const z = garmentZone(S); if (!z) return;
  const { w } = S.base; const R = Math.max(2, Math.round((S.base.layout?.fh ?? 60) / 40));
  const { pw, ph } = L; const d = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const k = y * pw + x; const X = L.x0 + x; const Y = L.y0 + y; d[k] = L.rgba[k * 4 + 3] < 128 && X >= 0 && Y >= 0 && X < w && z.mask[Y * w + X] ? 0 : 1e9; }
  chamfer(d, pw, ph);
  for (let k = 0; k < pw * ph; k++) if (d[k] > 0 && d[k] <= R) { const t = d[k] / (R + 1); L.rgba[k * 4 + 3] = Math.round(L.rgba[k * 4 + 3] * t * t * (3 - 2 * t)); }
}

/** The layer moved, sized, stretched and turned by hand (about its middle). */
export function transformLayer(layer, t, w, h) {
  if (t.scale === 100 && t.wide === 100 && t.long === 100 && !t.rot && !t.dx && !t.dy) return layer;
  const src = document.createElement('canvas'); src.width = layer.pw; src.height = layer.ph;
  src.getContext('2d').putImageData(new ImageData(layer.rgba, layer.pw, layer.ph), 0, 0);
  const sx = (t.scale / 100) * (t.wide / 100); const sy = (t.scale / 100) * (t.long / 100); const r = (t.rot * Math.PI) / 180;
  const cx = layer.x0 + layer.pw / 2; const cy = layer.y0 + layer.ph / 2;
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const x = ((u * layer.pw) / 2) * sx; const y = ((v * layer.ph) / 2) * sy; return [cx + t.dx + x * Math.cos(r) - y * Math.sin(r), cy + t.dy + x * Math.sin(r) + y * Math.cos(r)]; });
  const x0 = Math.max(0, Math.floor(Math.min(...cs.map((c) => c[0])))); const y0 = Math.max(0, Math.floor(Math.min(...cs.map((c) => c[1]))));
  const x1 = Math.min(w, Math.ceil(Math.max(...cs.map((c) => c[0])))); const y1 = Math.min(h, Math.ceil(Math.max(...cs.map((c) => c[1]))));
  if (x1 <= x0 || y1 <= y0) return null;
  const dst = document.createElement('canvas'); dst.width = x1 - x0; dst.height = y1 - y0;
  const c2 = dst.getContext('2d');
  c2.translate(cx + t.dx - x0, cy + t.dy - y0); c2.rotate(r); c2.scale(sx, sy); c2.drawImage(src, -layer.pw / 2, -layer.ph / 2);
  const out = { x0, y0, pw: dst.width, ph: dst.height, rgba: c2.getImageData(0, 0, dst.width, dst.height).data };
  return out;
}

/**
 * The layer finished on the base: light matched by faces, the base's form under it, hair and face (and
 * hands and arms in front of the body) kept in front, its edge softened. `cache`: kept between frames.
 */
export function finish(layer, S, cache) {
  const { base, piece, tune, kind } = S; const { w, h } = base;
  const fbox = { x0: layer.x0, y0: layer.y0, x1: layer.x0 + layer.pw, y1: layer.y0 + layer.ph };
  const key = `${fbox.x0},${fbox.y0},${fbox.x1},${fbox.y1}`;
  const trace = isTrace(S);
  // (Taken off first: the piece keeps its own folds and texture; the light and shade on their bare skin under
  // it (a sleeve over a lit arm) and the photo's broad light are what it takes.)
  if (trace) {
    // The folds and shadows of what was worn there, on the design laid into it.
    if (cache.formKey !== `fold${key}` || cache.formBase !== base || cache.formTarget !== S.target) {
      const fh = base.layout?.fh ?? h / 7;
      cache.form = erasing(S) ? new Float32Array((fbox.x1 - fbox.x0) * (fbox.y1 - fbox.y0)).fill(1) : foldMap(base.rgba, w, clothesOf(S), fbox, Math.max(1, Math.round(fh / 45)), Math.max(6, Math.round(fh / 3.5)));
      // (Where it goes over their bare skin (a sleeve onto a bare arm, a higher neckline): the light and shade
      // on the body there, the arm's roundness, the shadow where it turns from the light.)
      if (base.people) {
        const p = base.people; const T = underHair(S); const sk = new Uint8Array(w * h);
        for (let y = fbox.y0; y < fbox.y1; y++) for (let x = fbox.x0; x < fbox.x1; x++) { const i = y * w + x; if (T.mask[i] && p.body[i] >= 128 && p.face[i] < 100 && p.clothes[i] < 128) sk[i] = 1; }
        const sf = foldMap(base.rgba, w, sk, fbox, Math.max(1, Math.round(fh / 30)), Math.max(6, Math.round(fh / 4)));
        for (let k = 0; k < sf.length; k++) cache.form[k] *= sf[k];
      }
      cache.formKey = `fold${key}`; cache.formBase = base; cache.formTarget = S.target;
    }
  } else if (cache.formKey !== key || cache.formBase !== base) {
    const fh = base.layout?.fh ?? h / 7;
    // (The body's broad light and shade only: nothing of the print or edges beneath shows through.)
    // The base's light across the body only (brighter on the side the light comes from), read very broadly:
    // nothing of what's worn there (its print, its edges) shows through. (The piece's own roundness is
    // worked out from its shape: finishLayer's `round`.)
    cache.form = formMap(base.rgba, w, fbox, Math.max(6, Math.round(fh * 0.7)), Math.max(20, Math.round(fh * 2.2)), base.sil ?? null);
    for (let k = 0; k < cache.form.length; k++) cache.form[k] = Math.max(0.94, Math.min(1.06, cache.form[k]));
    cache.formKey = key; cache.formBase = base;
  }
  let front = null;
  const ppl = base.people;
  if (ppl && kind !== 'shoes') {
    const arms = tune.arms && base.layout && ['top', 'jacket', 'dress', 'bottom', 'upper', 'lower', 'outfit'].includes(kind);
    const fkey = `${tune.front}|${arms}|${kind}|${S.target?.box?.x0},${S.target?.box?.x1}`;
    if (cache.frontKey !== fkey || cache.frontBase !== base) {
      const m = new Uint8Array(w * h);
      // (Only where the person finder is sure (a soft step from 55% to 80%): a faint guess of hair over the
      // chest would otherwise leave the piece half see-through there.)
      const sure = (v) => (v <= 140 ? 0 : v >= 205 ? 255 : Math.round(((v - 140) / 65) * 255));
      if (tune.front) for (let i = 0; i < m.length; i++) m[i] = sure(kind === 'hat' ? ppl.face[i] : Math.max(ppl.face[i], ppl.hair[i]));
      if (arms) {
        // (A top fitted as one, a tee: the arms hanging at its sides stay in front of it too, below where its
        // sleeves end. A jacket's or a dress's sleeves cover the arms: only hands across the body.)
        // (A body zone's arms are its own: only hands across the body stay in front.)
        const whole = ['top', 'bottom', 'lower'].includes(kind);
        const tb = whole ? { x0: 0, x1: w } : (isZone(kind) && base.parts?.v?.torso?.box) || S.target?.parts?.sleeves?.torso?.box || S.target?.box || base.layout.person;
        const inset = whole ? 0 : (tb.x1 - tb.x0) * 0.04;
        const a = armsInFront(ppl, base.layout, tb.x0 + inset, tb.x1 - inset, 1.1);
        // (Not the neckline's skin: that's what the piece covers or not, not a hand in front.)
        const ns = trace && S.target ? underHair(S).neckSkin : null;
        if (ns) for (let i = 0; i < a.length; i++) if (ns[i]) a[i] = 0;
        // (Nor what's the old garment's own color where the finder said skin: a black top's side, past a lock
        // of hair, read as an arm, would keep the old top in front of the new one. Closer to the garment's
        // color than to their skin's, and far from their skin: the garment.)
        if (trace && S.target) {
          const tone = skinTone(base); const cl = clothesOf(S); const gm = [0, 0, 0]; let gn = 0; const tb2 = S.target.box;
          for (let y = tb2.y0; y < tb2.y1; y += 2) for (let x = tb2.x0; x < tb2.x1; x += 2) { const i = y * w + x; if (!cl[i]) continue; const q = rgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]); gm[0] += q[0]; gm[1] += q[1]; gm[2] += q[2]; gn++; }
          if (tone && gn > 50) {
            for (let c = 0; c < 3; c++) gm[c] /= gn;
            const sl = rgbToLab(tone[0], tone[1], tone[2]);
            const dist = (q, r) => Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2]);
            if (dist(sl, gm) > 30) for (let i = 0; i < a.length; i++) {
              if (a[i] <= 140) continue;
              const q = rgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]);
              if (dist(q, sl) > 25 && dist(q, gm) < dist(q, sl) * 0.5) a[i] = 0;
            }
          }
        }
        for (let i = 0; i < m.length; i++) { const v = a[i] <= 140 ? 0 : a[i] >= 205 ? 255 : Math.round(((a[i] - 140) / 65) * 255); if (v > m[i]) m[i] = v; }
      }
      // (A body zone: their own skin lying across what they wore, below the neck, a hand or a forearm across
      // their front, stays in front: between the clothes' edges in that row (or a little either side of it).)
      if (arms && isZone(kind) && S.target && base.layout) {
        const T = S.target; const L = base.layout; const yFrom = Math.round(L.chin + L.fh * 0.6); const HR = Math.round(L.fh * 0.3);
        const ends = new Int32Array((T.box.y1 - T.box.y0) * 2).fill(-1);
        for (let y = T.box.y0; y < T.box.y1; y++) for (let x = T.box.x0; x < T.box.x1; x++) { const i = y * w + x; if (T.mask[i] && ppl.clothes[i] >= 128) { const k = (y - T.box.y0) * 2; if (ends[k] < 0) ends[k] = x; ends[k + 1] = x; } }
        for (let y = Math.max(T.box.y0, yFrom); y < T.box.y1; y++) {
          let l = -1; let r = -1;
          for (let yy = Math.max(T.box.y0, y - HR); yy < Math.min(T.box.y1, y + HR); yy++) { const k = (yy - T.box.y0) * 2; if (ends[k] >= 0) { l = l < 0 ? ends[k] : Math.min(l, ends[k]); r = Math.max(r, ends[k + 1]); } }
          if (l < 0) continue;
          for (let x = l; x <= r; x++) { const i = y * w + x; if (ppl.body[i] >= 160 && ppl.face[i] < 100) m[i] = 255; }
        }
      }
      // (Fine strands of hair over it, where the finder is unsure: each pixel's share of hair from its color,
      // between the hair's beside it and what's under it, so strands stay over the new piece, crisp.)
      if (tune.front && kind !== 'hat' && S.target) {
        const hm = new Uint8Array(w * h); let any = 0; const T = S.target.box;
        for (let y = Math.max(0, T.y0 - 40); y < Math.min(h, T.y1); y++) for (let x = Math.max(0, T.x0 - 40); x < Math.min(w, T.x1 + 40); x++) { const i = y * w + x; if (ppl.hair[i] >= 120 && ppl.face[i] < 120) { hm[i] = 1; any++; } }
        if (any > 30) {
          const hb = boxOf(hm, w, h);
          const mb = hb && matteBand(base.rgba, w, h, hm, hb, Math.max(2, Math.round((base.layout?.fh ?? h / 7) / 30)), Math.max(4, Math.round((base.layout?.fh ?? h / 7) / 14)));
          if (mb) for (let y = 0; y < mb.ph; y++) for (let x = 0; x < mb.pw; x++) {
            const a = mb.alpha[y * mb.pw + x]; if (a <= 0) continue;
            const i = (mb.y0 + y) * w + mb.x0 + x; if (ppl.face[i] >= 120) continue;
            const v = Math.round(255 * Math.min(1, a * 1.1)); if (v > m[i]) m[i] = v;
          }
        }
      }
      // (Strands further out, too thin for the finder to be sure of: on what it goes on, near hair, the pixels
      // of the hair's own color rather than the clothes': each's share of hair, from its color between the two.)
      if (tune.front && kind !== 'hat' && S.target) {
        const H = []; for (let i = 0; i < w * h; i += 3) if (ppl.hair[i] >= 220) H.push(i);
        if (H.length > 40) {
          const hc = [0, 1, 2].map((c) => { const v = H.map((i) => base.rgba[i * 4 + c]).sort((a, b) => a - b); return v[v.length >> 1]; });
          const T = underHair(S); const B2 = T.box; const fh2 = base.layout?.fh ?? h / 7;
          const worn = new Uint8Array(w * h); for (let y = B2.y0; y < B2.y1; y++) for (let x = B2.x0; x < B2.x1; x++) { const i = y * w + x; if (T.mask[i] && ppl.clothes[i] >= 128 && ppl.hair[i] < 30) worn[i] = 1; }
          const bw2 = B2.x1 - B2.x0; const bh2 = B2.y1 - B2.y0;
          const sub = (c) => { const v = new Float32Array(bw2 * bh2); const ok = new Uint8Array(bw2 * bh2); for (let y = 0; y < bh2; y++) for (let x = 0; x < bw2; x++) { const i = (B2.y0 + y) * w + B2.x0 + x; v[y * bw2 + x] = base.rgba[i * 4 + c]; ok[y * bw2 + x] = worn[i]; } return boxBlur(v, ok, bw2, bh2, Math.max(4, Math.round(fh2 / 10))); };
          const G = [sub(0), sub(1), sub(2)];
          for (let y = B2.y0; y < B2.y1; y++) for (let x = B2.x0; x < B2.x1; x++) {
            const i = y * w + x; if (!T.mask[i] || ppl.hair[i] < 25 || ppl.face[i] >= 120 || m[i] >= 250) continue;
            const k = (y - B2.y0) * bw2 + x - B2.x0; const g = [G[0][k], G[1][k], G[2][k]];
            const d = [hc[0] - g[0], hc[1] - g[1], hc[2] - g[2]]; const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]; if (L2 < 30 * 30) continue;
            const a = ((base.rgba[i * 4] - g[0]) * d[0] + (base.rgba[i * 4 + 1] - g[1]) * d[1] + (base.rgba[i * 4 + 2] - g[2]) * d[2]) / L2;
            const v = Math.round(255 * Math.max(0, Math.min(1, (a - 0.15) / 0.7))); if (v > m[i]) m[i] = v;
          }
        }
      }
      cache.front = tune.front || arms ? m : null; cache.frontKey = fkey; cache.frontBase = base;
    }
    front = cache.front;
    // (Taken off first, an upper body with sleeves: an arm the piece's sleeve goes on is inside it, not in
    // front of it; only a hand across their front (within the torso) stays in front.)
    if (front && erasing(S) && isZone(kind) && base.parts?.v?.torso?.box) {
      const tb = base.parts.v.torso.box; const f2 = Uint8Array.from(front);
      for (let y = 0; y < layer.ph; y++) for (let x = 0; x < layer.pw; x++) {
        const X = layer.x0 + x; const Y = layer.y0 + y; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        if (X >= tb.x0 && X < tb.x1) continue;
        const i = Y * w + X; if (layer.rgba[(y * layer.pw + x) * 4 + 3] >= 128 && ppl.hair[i] < 160 && ppl.face[i] < 128) f2[i] = 0;
      }
      front = f2;
    }
    // (And whoever's in front of what it covers (the next person's arm): they stay in front of it.)
    const oc = trace && S.target ? underHair(S).occ : null;
    if (oc) { if (cache.frontOcc?.of !== front || cache.frontOcc.occ !== oc) { const f2 = front ? Uint8Array.from(front) : new Uint8Array(w * h); for (let i = 0; i < f2.length; i++) if (oc[i]) f2[i] = 255; cache.frontOcc = { of: front, occ: oc, f: f2 }; } front = cache.frontOcc.f; }
  }
  // (Taken off first: where the garment was seen between strands of hair (by its own color, the finder
  // unsure of hair there), the piece covers it; strands of hair's own color stay in front. Else their bare
  // skin, made where the garment was, would show through between the strands.)
  if (front && erasing(S)) {
    const z = garmentZone(S);
    if (z) {
      if (cache.zfront?.of !== front || cache.zfront.z !== z) {
        const f2 = Uint8Array.from(front); const b = z.box;
        for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) { const i = y * w + x; if (z.seen[i] && ppl.face[i] < 128) f2[i] = 0; }
        cache.zfront = { of: front, z, f: f2 };
      }
      front = cache.zfront.f;
    }
  }
  const gains = lightGains(piece.rgba, piece.people?.face ?? null, base.rgba, ppl?.face ?? null);
  const done = finishLayer(layer, w, { gains, light: tune.light / 100, form: cache.form, fbox, formAmt: trace ? tune.form / 100 : tune.form / 100, front, soft: trace ? 0 : tune.soft, depth: tune.depth ? Math.max(2, Math.round((base.layout?.fh ?? h / 7) / 14)) : 0, round: trace ? tune.form / 300 : tune.form / 100 });
  // (Its edge as the old garment's was, pixel by pixel: no halo of the old color, no blur.)
  let L2 = done;
  if (trace && S.target && ppl && !S.target.body && !erasing(S)) { const m = replaceEdge(layer, S, front); if (m) { L2 = m; Object.assign(layer, m); } }
  // (As sharp and as grainy as the photo it's in: a crisp piece in a soft photo looks pasted on.)
  if (trace && S.target && ppl) matchGrain(layer, base, clothesOf(S));
  // (An upper body's hem over what's below it: a soft shadow under it, cloth over cloth, not a cut.)
  if (trace && S.kind === 'upper' && ppl) { const m = hemShadow(layer, S); if (m) { L2 = m; Object.assign(layer, m); } }
  // (The new piece's own edges casting a faint shadow on the skin just under them: a sleeve's hem on the arm,
  // a strap on the shoulder, a neckline on the chest.)
  if (ppl && kind !== 'shoes' && kind !== 'hat') { const m = skinShadow(layer, S, front); if (m) { L2 = m; Object.assign(layer, m); } }
  // (A soft shadow on it where hair or an arm lies over it.)
  if (front && kind !== 'shoes' && kind !== 'hat') contactShadow(layer, w, h, front, Math.max(2, Math.round((base.layout?.fh ?? h / 7) / 16)));
  return L2;
}

/**
 * What was worn there that the piece doesn't cover (Replace): the target (and a couple of pixels past
 * it) where the finished layer is less than half there, and that isn't kept in front (`front`: a hand
 * across it shows as it is). { mask, box, count } or null.
 */
export function uncovered(target, layer, w, h, front = null, people = null) {
  const m = new Uint8Array(w * h); const b = target.box; let count = 0;
  for (let y = Math.max(0, b.y0 - 2); y < Math.min(h, b.y1 + 2); y++) for (let x = Math.max(0, b.x0 - 2); x < Math.min(w, b.x1 + 2); x++) {
    let on = 0; for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx; const Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && target.mask[Y * w + X]) { on = 1; break; } }
    // (The base's own bare skin isn't taken off: only what was worn.)
    // (Nor their hair, however faint: it stays in front of what's put on.)
    if (!on || (front && front[y * w + x] >= 128) || (people && (people.body[y * w + x] >= 128 || people.face[y * w + x] >= 128 || people.hair[y * w + x] >= 90))) continue;
    if (layer) { const lx = x - layer.x0; const ly = y - layer.y0; if (lx >= 0 && ly >= 0 && lx < layer.pw && ly < layer.ph && (layer.rgba[(ly * layer.pw + lx) * 4 + 3] >= 128 || layer.matted?.[ly * layer.pw + lx])) continue; }
    m[y * w + x] = 1; count++;
  }
  const box = count ? boxOf(m, w, h) : null;
  return box ? { mask: m, box, count } : null;
}

/**
 * Those pixels filled from what's around them (the background, the skin beside them), never from what was
 * worn there (the target, grown a little), nor (with `people`) the face, hair or other clothes. A patch, or null.
 */
export function fillUncovered(rgba, w, h, unc, target, people = null) {
  const avoid = new Uint8Array(w * h); const b = target.box;
  // (From bare skin, the background, or their other clothes (the pants a top's hem was over): not the face
  // (a neckline filled from it shows an eye), the hair, nor anything of the garment's own color.)
  let lab0 = null;
  { const m = [0, 0, 0]; let n = 0; for (let y = b.y0; y < b.y1; y += 2) for (let x = b.x0; x < b.x1; x += 2) { const i = y * w + x; if (!target.mask[i]) continue; const q = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]); m[0] += q[0]; m[1] += q[1]; m[2] += q[2]; n++; } if (n) lab0 = m.map((v) => v / n); }
  const likeIt = (i) => { if (!lab0) return true; const q = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]); return Math.hypot((q[0] - lab0[0]) * 0.5, q[1] - lab0[1], q[2] - lab0[2]) < 25; };
  if (people) for (let i = 0; i < w * h; i++) if (Math.max(people.face[i], people.hair[i], people.others[i]) >= 110 || (people.clothes[i] >= 110 && likeIt(i))) avoid[i] = 1;
  for (let y = Math.max(0, b.y0 - 3); y < Math.min(h, b.y1 + 3); y++) for (let x = Math.max(0, b.x0 - 3); x < Math.min(w, b.x1 + 3); x++) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const X = x + dx; const Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && target.mask[Y * w + X]) { avoid[y * w + x] = 1; dy = 4; break; } }
  }
  return cleanUp(rgba, w, h, unc.mask, unc.box, { avoid });
}

/** A patch ({ x0, y0, pw, ph, rgba }) laid on pixels (in place), or a layer: the same. */
export function lay(out, w, h, p) {
  for (let y = 0; y < p.ph; y++) {
    const Y = p.y0 + y; if (Y < 0 || Y >= h) continue;
    for (let x = 0; x < p.pw; x++) {
      const X = p.x0 + x; if (X < 0 || X >= w) continue;
      const o = (y * p.pw + x) * 4; const a = p.rgba[o + 3] / 255; if (!a) continue;
      const i = (Y * w + X) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = out[i + c] * (1 - a) + p.rgba[o + c] * a;
    }
  }
}

/**
 * What's left of the garment taken off that the piece doesn't cover (Replace): its thin straps (too thin
 * for the person finder, read as skin or hair), a sliver at its edge, a tie hanging from it: what's on the
 * person there of that garment's own hue (by its color, not its lightness), not covered by the piece. They're the same garment, so they take the
 * piece's color: { x0, y0, pw, ph, wgt (0..1, how much), gain ([r, g, b]: the piece's color over the old
 * garment's) } at the base's size, or null.
 */
export function leftovers(S, layer) {
  const { base, target } = S; const p = base.people;
  // (A garment's: a body zone takes all that's there.)
  if (!isTrace(S) || !layer || !p || !base.layout || isZone(S.kind)) return null;
  const { w, h } = base; const cl = clothesOf(S);
  // The old garment's color (its mean, and its hue) and the piece's where it was laid.
  const bm = [0, 0, 0]; let nb = 0; let ta = 0; let tb = 0; let tL = 0;
  const lm = [0, 0, 0]; let nl = 0;
  for (let y = 0; y < layer.ph; y++) for (let x = 0; x < layer.pw; x++) {
    const i = (layer.y0 + y) * w + layer.x0 + x; if (!cl[i]) continue;
    for (let c = 0; c < 3; c++) bm[c] += base.rgba[i * 4 + c];
    const q = rgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]); ta += q[1]; tb += q[2]; tL += q[0]; nb++;
    const o = (y * layer.pw + x) * 4; if (layer.rgba[o + 3] >= 250) { for (let c = 0; c < 3; c++) lm[c] += layer.rgba[o + c]; nl++; }
  }
  if (nb < 50 || nl < 50) return null;
  ta /= nb; tb /= nb; tL /= nb;
  // (Without a hue: grey, white, black; or so dark (a black top in warm light) that its hue is mostly noise.)
  const hueless = Math.hypot(ta, tb) < 8 || (tL < 30 && Math.hypot(ta, tb) < 16);
  const tcOf = () => (hueless ? 0 : Math.hypot(ta, tb));
  const gain = [0, 1, 2].map((c) => (lm[c] / nl) / Math.max(8, bm[c] / nb));
  // Around it, about half a face's width.
  // (Above it and beside it: its straps, a sliver at its side. Not below its hem: what's there is another
  // garment (the shorts under a jersey), however alike in color.)
  // (Further for a garment without a hue: a black top's side seen past a lock of hair, cut off from the rest
  // by it, is still that top.)
  const g = Math.round(base.layout.fw * (tcOf() < 8 ? 1.1 : 0.6)); const B = target.box;
  const x0 = Math.max(0, B.x0 - g); const y0 = Math.max(0, B.y0 - Math.round(base.layout.fw * 0.6)); const x1 = Math.min(w, B.x1 + g); const y1 = Math.min(h, B.y1);
  const pw = x1 - x0; const ph = y1 - y0; const wgt = new Float32Array(pw * ph); let any = 0;
  // (Hair over it: never recolored (it stays as it is, in front), but what's on either side of a lock is
  // joined across it.)
  const pass = new Uint8Array(pw * ph);
  const covered = (X, Y) => { const lx = X - layer.x0; const ly = Y - layer.y0; return lx >= 0 && ly >= 0 && lx < layer.pw && ly < layer.ph && (layer.rgba[(ly * layer.pw + lx) * 4 + 3] >= 128 || !!layer.matted?.[ly * layer.pw + lx]); };
  // (Of their hue: near its color, or its hue at any lightness (its shade); and nearer it than their skin,
  // on them (a strap too thin for the person finder to call clothes), never the leaves behind them.)
  const tone = skinTone(base); const sk = tone ? rgbToLab(tone[0], tone[1], tone[2]) : null;
  const tc = Math.hypot(ta, tb); const th0 = Math.atan2(tb, ta);
  // (Each column's own bottom of the garment: a hem that curves (a waistband dipping in the middle) has
  // the shorts below it in the columns where it's higher.)
  const colBot = new Int32Array(pw).fill(-1);
  for (let X = Math.max(x0, B.x0); X < Math.min(x1, B.x1); X++) for (let Y = B.y1 - 1; Y >= B.y0; Y--) if (target.mask[Y * w + X]) { colBot[X - x0] = Y; break; }
  for (let Y = y0; Y < y1; Y++) for (let X = x0; X < x1; X++) {
    const i = Y * w + X;
    if (colBot[X - x0] >= 0 && Y > colBot[X - x0]) continue;
    if (p.face[i] >= 128 || Math.max(p.clothes[i], p.body[i], p.others[i], p.hair[i]) < 40 || covered(X, Y)) continue;
    const q = rgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]);
    const d = Math.hypot(q[1] - ta, q[2] - tb); const qc = Math.hypot(q[1], q[2]);
    // (Hair: dark brown hair is near a black top's lightness, and multiplied up to the piece's color it
    // would come out pink. Between its strands, where the finder is less sure, the garment's own color
    // (as light as it, and as colorless for a garment without a hue) is the garment seen there.)
    if (p.hair[i] >= 40) {
      const seen = p.hair[i] < 200 && (tL < 30 && q[0] < tL ? q[0] > tL - 14 : Math.abs(q[0] - tL) < 10) && (!hueless ? d < 10 : qc < tc + 4);
      if (!seen) { pass[(Y - y0) * pw + X - x0] = 1; continue; }
    }
    let hd = Math.abs(Math.atan2(q[2], q[1]) - th0); if (hd > Math.PI) hd = 2 * Math.PI - hd; hd *= 180 / Math.PI;
    let v = d < 22 ? Math.min(1, (22 - d) / 10) : 0;
    // (A garment without a hue (white, grey, black): by its lightness too. A tattoo's ink isn't a white jersey.)
    // (Where the finder says skin, nearly its lightness: a white strap is as light as the jersey; the light on
    // someone's skin isn't.)
    // (Darker than a dark garment is its own shade, a fold or its shadow side: skin is never that dark.)
    const dL = tL < 30 && q[0] < tL ? 0 : Math.abs(q[0] - tL);
    // (Where the finder says skin, nearly its lightness; a dark garment's sunlit side a little more: skin is
    // far lighter.)
    if (hueless && (dL > (p.body[i] >= 128 ? (tL < 30 ? 18 : 12) : 35) || qc > tc + 6)) v = 0;
    if (!hueless && qc >= 8) v = Math.max(v, hd < 20 ? 1 : hd < 35 ? (35 - hd) / 15 : 0);
    if (!v) continue;
    if (sk) {
      // (Nearer the garment's hue than their skin's, by its angle where both have color; else by distance.)
      let hs = Math.abs(Math.atan2(q[2], q[1]) - Math.atan2(sk[2], sk[1])); if (hs > Math.PI) hs = 2 * Math.PI - hs; hs *= 180 / Math.PI;
      if (qc >= 8 && !hueless ? hs <= hd : Math.hypot(q[1] - sk[1], q[2] - sk[2]) < d) continue;
    }
    if (p.clothes[i] < 90) v *= 0.9;
    wgt[(Y - y0) * pw + X - x0] = v; any++;
  }
  if (!any) return null;
  // (Only what's joined to the garment: a strap from it, a sliver along it. A patch off on its own (a mark on
  // an arm) isn't part of it.)
  // (Reached across a lock of hair: only beside the garment or below its top, never above it (the shadow
  // between the hair and the neck isn't a strap).)
  const colTop = new Int32Array(pw).fill(-1);
  for (let X = Math.max(x0, B.x0); X < Math.min(x1, B.x1); X++) for (let Y = B.y0; Y < B.y1; Y++) if (target.mask[Y * w + X]) { colTop[X - x0] = Y; break; }
  let topAll = B.y1; for (let x = 0; x < pw; x++) if (colTop[x] >= 0) topAll = Math.min(topAll, colTop[x]);
  // (Not above the garment's highest row; and as light as the garment itself, not the deep shadow between
  // the hair and the neck, which isn't a strap.)
  const below = (x, y) => {
    if (y0 + y < topAll) return false;
    const i = ((y0 + y) * w + x0 + x) * 4; const q = rgbToLab(base.rgba[i], base.rgba[i + 1], base.rgba[i + 2]);
    return (q[0] > tL - 10 && q[0] < tL + (tL < 30 ? 18 : 10)) || !!pass[y * pw + x];
  };
  const via = new Uint8Array(pw * ph);
  const keep = new Uint8Array(pw * ph); const st = [];
  const inT = (X, Y) => X >= 0 && Y >= 0 && X < w && Y < h && (!!target.mask[Y * w + X] || covered(X, Y));
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const k = y * pw + x; if (!wgt[k] && !pass[k]) continue; if (pass[k] && !below(x, y)) continue; const X = x0 + x; const Y = y0 + y; if (inT(X - 1, Y) || inT(X + 1, Y) || inT(X, Y - 1) || inT(X, Y + 1)) { keep[k] = 1; via[k] = pass[k]; st.push(k); } }
  for (let a = 0; a < st.length; a++) {
    const k = st[a]; const x = k % pw; const y = (k / pw) | 0;
    for (const t of [x > 0 ? k - 1 : -1, x < pw - 1 ? k + 1 : -1, y > 0 ? k - pw : -1, y < ph - 1 ? k + pw : -1]) {
      if (t < 0 || keep[t] || !(wgt[t] || pass[t])) continue;
      const v2 = via[k] || pass[t] ? 1 : 0;
      if (v2 && !below(t % pw, (t / pw) | 0)) continue;
      keep[t] = 1; via[t] = v2; st.push(t);
    }
  }
  for (let k = 0; k < pw * ph; k++) if (!keep[k]) wgt[k] = 0;
  // (No speckle of the old color left among what's recolored: a pixel near the garment's lightness, mostly
  // surrounded by recolored ones (four passes over its 5 × 5), is recolored as much as they are; not what's
  // surely hair.)
  for (let pass2 = 0; pass2 < 4; pass2++) {
    const prev = Float32Array.from(wgt);
    for (let y = 2; y < ph - 2; y++) for (let x = 2; x < pw - 2; x++) {
      const k = y * pw + x; if (prev[k] > 0) continue;
      let sum = 0; let on = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const v = prev[k + dy * pw + dx]; sum += v; if (v > 0) on++; }
      if (on < 13) continue;
      const X = x0 + x; const Y = y0 + y; const i = Y * w + X;
      if (p.hair[i] >= 200 || p.face[i] >= 128 || covered(X, Y) || (colBot[x] >= 0 && Y > colBot[x])) continue;
      const q = rgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]);
      if ((tL < 30 && q[0] < tL ? 0 : Math.abs(q[0] - tL)) > 25 || (hueless ? Math.hypot(q[1], q[2]) > Math.hypot(ta, tb) + 8 : Math.hypot(q[1] - ta, q[2] - tb) > 22)) continue;
      wgt[k] = sum / on;
    }
  }
  let kept = 0; for (let k = 0; k < pw * ph; k++) if (wgt[k]) kept++;
  // (A garment without a hue (black, white, grey): recolored by its lightness only, the piece's own color
  // shaded as the old garment was there: a black top's faint warm cast, multiplied up, would tint it pink.)
  const mono = tcOf() < 8 ? { color: lm.map((v) => v / nl), lum: Math.max(8, (0.299 * bm[0] + 0.587 * bm[1] + 0.114 * bm[2]) / nb) } : null;
  return kept ? { x0, y0, pw, ph, wgt, gain, mono } : null;
}

/** The leftovers (above) recolored on `out` (w wide) from `src` (the base's pixels, the same size). In place. */
export function recolor(out, w, rest, src) {
  if (!rest) return;
  for (let y = 0; y < rest.ph; y++) for (let x = 0; x < rest.pw; x++) {
    const v = rest.wgt[y * rest.pw + x]; if (!v) continue;
    const i = ((rest.y0 + y) * w + rest.x0 + x) * 4;
    if (rest.mono) {
      const sh = Math.max(0.68, Math.min(1.25, (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2] + 4) / (rest.mono.lum + 4)));
      for (let c = 0; c < 3; c++) out[i + c] = out[i + c] * (1 - v) + Math.min(255, rest.mono.color[c] * sh) * v;
    } else for (let c = 0; c < 3; c++) out[i + c] = out[i + c] * (1 - v) + Math.min(255, src[i + c] * rest.gain[c]) * v;
  }
}

/** A garment's bodice line: the first row from its top as wide as half its usual width (what's above it: straps). */
function bodiceTop(m, w, box) {
  const widths = []; for (let y = box.y0; y < box.y1; y++) { let n = 0; for (let x = box.x0; x < box.x1; x++) n += m[y * w + x] ? 1 : 0; widths.push(n); }
  const mid = widths.slice(Math.floor(widths.length * 0.2), Math.floor(widths.length * 0.6)).sort((a, b) => a - b);
  const usual = mid[mid.length >> 1] ?? 0;
  const k = widths.findIndex((n) => n >= usual * 0.5);
  return box.y0 + Math.max(0, k);
}

/**
 * Straps (Replace, a top or a dress): the piece's and the base's, matched. Both have them: the base's take
 * the piece's color (`rest`, the leftovers). The piece is strapless and the base had straps: the base's are
 * taken off, filled from the skin around them. The piece has straps and the base's shoulders were bare:
 * straps drawn from the top of what it's laid into over the shoulders (where the pose found them), as wide
 * as the piece's and its color, shaded by the skin they lie on. A layer to lay over the picture (or null);
 * `rest`'s weights are cleared where straps were taken off.
 */
export function straps(S, layer, rest) {
  const { base, piece, target, place } = S;
  if (!isTrace(S) || !layer || !target || !['top', 'dress'].includes(S.kind) || !base.layout) return null;
  const { w, h } = base; const fh = base.layout.fh;
  // The piece's straps: what of it is above its bodice line.
  const pm = piece.solid ?? piece.sel; const pb = piece.box; if (!pm || !pb) return null;
  const ptop = bodiceTop(pm, piece.w, pb);
  let pn = 0; const pc = [[], [], []]; const tex = piece.draw ?? piece.rgba;
  for (let y = pb.y0; y < ptop; y++) for (let x = pb.x0; x < pb.x1; x++) { const i = y * piece.w + x; if (pm[i]) { pn++; for (let c = 0; c < 3; c++) pc[c].push(tex[i * 4 + c]); } }
  // (Straps are two narrow bands, one over each shoulder: not a collar, which runs across its middle, nor
  // anything wide. Each row above the bodice: at least two separate runs, together well under its width.)
  let strapRows = 0; let rowsAbove = 0;
  for (let y = pb.y0; y < ptop; y++) {
    let runs = 0; let on = 0; let prev = 0;
    for (let x = pb.x0; x < pb.x1; x++) { const v = pm[y * piece.w + x] ? 1 : 0; if (v && !prev) runs++; on += v; prev = v; }
    if (!on) continue; rowsAbove++;
    if (runs >= 2 && on < (pb.x1 - pb.x0) * 0.35) strapRows++;
  }
  const pieceStraps = ptop - pb.y0 > (piece.layout?.fh ?? fh) * 0.25 && pn > 20 && rowsAbove > 0 && strapRows >= rowsAbove * 0.6;
  const color = pieceStraps ? pc.map((a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; }) : null;
  const strapW = pieceStraps ? Math.max(2, Math.round((pn / (ptop - pb.y0) / 2) * place.s)) : 0;
  // The base's: the leftovers above its bodice line.
  const ttop = bodiceTop(target.mask, w, target.box);
  let bn = 0; const above = [];
  if (rest) for (let y = rest.y0; y < Math.min(rest.y0 + rest.ph, ttop + 2); y++) for (let x = rest.x0; x < rest.x0 + rest.pw; x++) { const k = (y - rest.y0) * rest.pw + x - rest.x0; if (rest.wgt[k] > 0.3) { bn++; above.push(k); } }
  const baseStraps = bn > fh * 0.6;
  if (pieceStraps && baseStraps) return null; // (recolored with the rest)
  if (!pieceStraps && baseStraps) {
    // Taken off: filled from the skin around them.
    const m = new Uint8Array(w * h);
    for (const k of above) { const x = rest.x0 + (k % rest.pw); const y = rest.y0 + ((k / rest.pw) | 0); m[y * w + x] = 1; rest.wgt[k] = 0; }
    const b = boxOf(m, w, h); if (!b) return null;
    return cleanUp(base.rgba, w, h, m, b);
  }
  if (pieceStraps && !baseStraps && base.pose && base.people) {
    // Drawn: from the top of the new piece, a quarter in from each side, up over each shoulder.
    const q = base.pose; const seen = (v) => v && v[2] >= 0.3;
    if (!seen(q.shoulders[0]) || !seen(q.shoulders[1])) return null;
    const row = (y) => { let l = -1; let r = -1; for (let x = target.box.x0; x < target.box.x1; x++) if (target.mask[y * w + x]) { if (l < 0) l = x; r = x; } return [l, r]; };
    const [l0, r0] = row(Math.min(h - 1, ttop + 1)); if (l0 < 0) return null;
    const neck = (q.shoulders[0][0] + q.shoulders[1][0]) / 2;
    const ends = [[l0 + (r0 - l0) * 0.22, q.shoulders[0][0] + (neck - q.shoulders[0][0]) * 0.18], [r0 - (r0 - l0) * 0.22, q.shoulders[1][0] - (q.shoulders[1][0] - neck) * 0.18]];
    const x0 = Math.max(0, Math.floor(Math.min(l0, q.shoulders[0][0]) - strapW * 2)); const x1 = Math.min(w, Math.ceil(Math.max(r0, q.shoulders[1][0]) + strapW * 2));
    const y0 = Math.max(0, Math.floor(Math.min(q.shoulders[0][1], q.shoulders[1][1]) - fh * 0.5)); const y1 = Math.min(h, ttop + 2);
    if (x1 <= x0 || y1 <= y0) return null;
    const pw = x1 - x0; const ph = y1 - y0; const rgba = new Uint8ClampedArray(pw * ph * 4);
    const tone = skinTone(base); const toneL = tone ? (tone[0] + tone[1] + tone[2]) / 3 : 160;
    for (const [bx, sx] of ends) {
      // (Up to the top of the shoulder there: the first of the person from above, in that column.)
      const X = Math.round(sx); let top = y0; while (top < y1 && Math.max(base.people.body[top * w + X] ?? 0, base.people.clothes[top * w + X] ?? 0) < 128) top++;
      const ax = bx; const ay = ttop + 1; const bxp = sx; const byp = Math.max(y0, top + 1);
      const segD = (x, y) => { const dx = bxp - ax; const dy = byp - ay; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(x - ax - t * dx, y - ay - t * dy); };
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const d = segD(x, y); const a = Math.max(0, Math.min(1, strapW / 2 + 0.5 - d)); if (!a) continue;
        const i = y * w + x; if (Math.max(base.people.face[i], base.people.hair[i]) >= 160) continue;
        // (Shaded as the skin under it is: lighter or darker than their usual skin.)
        const sh = Math.max(0.6, Math.min(1.25, ((base.rgba[i * 4] + base.rgba[i * 4 + 1] + base.rgba[i * 4 + 2]) / 3) / toneL));
        const o = ((y - y0) * pw + x - x0) * 4;
        for (let c = 0; c < 3; c++) rgba[o + c] = Math.min(255, color[c] * sh);
        rgba[o + 3] = Math.max(rgba[o + 3], Math.round(a * 255));
      }
    }
    return { x0, y0, pw, ph, rgba };
  }
  return null;
}

/** How much fine detail (the mean step from a pixel to its neighbours' average) the pixels of `on` have. */
function fineDetail(rgba, w, on, box) {
  let sum = 0; let n = 0;
  for (let y = Math.max(1, box.y0); y < box.y1 - 1; y++) for (let x = Math.max(1, box.x0); x < box.x1 - 1; x++) {
    if (!on(x, y)) continue;
    const i = (y * w + x) * 4; let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(rgba[i + c] - (rgba[i + c - 4] + rgba[i + c + 4] + rgba[i + c - w * 4] + rgba[i + c + w * 4]) / 4);
    sum += d / 3; n++;
  }
  return n > 200 ? sum / n : null;
}

/**
 * The finished layer made as sharp and as grainy as the photo it's laid into (in place): its fine detail
 * measured against that of what was worn there in the base; sharper, it's softened toward a blur of itself;
 * cleaner, the photo's grain is added (the difference, as fine noise).
 */
function matchGrain(layer, base, worn) {
  const { pw, ph, x0, y0 } = layer; const W = base.w;
  const lb = { x0: 0, y0: 0, x1: pw, y1: ph };
  const mine = fineDetail(layer.rgba, pw, (x, y) => layer.rgba[(y * pw + x) * 4 + 3] === 255 && layer.rgba[((y - 1) * pw + x) * 4 + 3] === 255 && layer.rgba[((y + 1) * pw + x) * 4 + 3] === 255 && layer.rgba[(y * pw + x - 1) * 4 + 3] === 255 && layer.rgba[(y * pw + x + 1) * 4 + 3] === 255, lb);
  const theirs = fineDetail(base.rgba, W, (x, y) => worn[y * W + x] && worn[(y - 1) * W + x] && worn[(y + 1) * W + x] && worn[y * W + x - 1] && worn[y * W + x + 1], { x0, y0, x1: x0 + pw, y1: y0 + ph });
  if (mine == null || theirs == null) return;
  if (mine > theirs * 1.2) {
    // Softened: blended with its 3×3 average, as far as brings its detail down to the photo's.
    const t = Math.min(0.85, 1 - theirs / mine);
    const src = Uint8ClampedArray.from(layer.rgba);
    for (let y = 1; y < ph - 1; y++) for (let x = 1; x < pw - 1; x++) {
      const o = (y * pw + x) * 4; if (!src[o + 3]) continue;
      for (let c = 0; c < 3; c++) {
        let s2 = 0; let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = ((y + dy) * pw + x + dx) * 4; if (src[q + 3]) { s2 += src[q + c]; n++; } }
        layer.rgba[o + c] = src[o + c] * (1 - t) + (s2 / n) * t;
      }
    }
  } else if (mine < theirs * 0.8) {
    // Grain: fine noise, the same in each channel (as a photo's mostly is), as much as it lacks.
    const amp = (theirs - mine) * 1.6; let seed = 13;
    for (let k = 0; k < pw * ph; k++) {
      if (!layer.rgba[k * 4 + 3]) continue;
      seed = (seed * 1103515245 + 12345) >>> 0; const g = ((seed / 4294967296) - 0.5) * 2 * amp;
      for (let c = 0; c < 3; c++) layer.rgba[k * 4 + c] += g;
    }
  }
}

/**
 * What's in front of the piece (`front`, 0..255 over the base: hair, an arm) casting a soft shadow on it:
 * each of its pixels within `r` of something sure in front, and not itself under it, a little darker the
 * nearer (at most 16%), faded out by `r`. In place.
 */
function contactShadow(layer, w, h, front, r) {
  const { pw, ph, x0, y0 } = layer;
  // (Distance to the nearest of what's in front, by two passes (a chamfer), over the layer's box.)
  const INF = 1e9; const d = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const X = x0 + x; const Y = y0 + y; d[y * pw + x] = X >= 0 && Y >= 0 && X < w && Y < h && front[Y * w + X] >= 160 ? 0 : INF; }
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const k = y * pw + x; let v = d[k]; if (x > 0) v = Math.min(v, d[k - 1] + 1); if (y > 0) v = Math.min(v, d[k - pw] + 1); if (x > 0 && y > 0) v = Math.min(v, d[k - pw - 1] + 1.414); if (x < pw - 1 && y > 0) v = Math.min(v, d[k - pw + 1] + 1.414); d[k] = v; }
  for (let y = ph - 1; y >= 0; y--) for (let x = pw - 1; x >= 0; x--) { const k = y * pw + x; let v = d[k]; if (x < pw - 1) v = Math.min(v, d[k + 1] + 1); if (y < ph - 1) v = Math.min(v, d[k + pw] + 1); if (x < pw - 1 && y < ph - 1) v = Math.min(v, d[k + pw + 1] + 1.414); if (x > 0 && y < ph - 1) v = Math.min(v, d[k + pw - 1] + 1.414); d[k] = v; }
  for (let k = 0; k < pw * ph; k++) {
    const o = k * 4; if (!layer.rgba[o + 3] || d[k] === 0 || d[k] >= r) continue;
    const t = 1 - d[k] / r; const f = 1 - 0.16 * t * t;
    layer.rgba[o] *= f; layer.rgba[o + 1] *= f; layer.rgba[o + 2] *= f;
  }
}

/**
 * Replace's edge as the photo has it: around the outline of what was worn, each pixel's share of the old
 * garment (from its color between the old garment's nearby and what's beside it: matteBand) is what the
 * new piece takes over, and only that share: out = photo + share × (new − old). The edge keeps the photo's
 * own sharpness or softness (a crisp hem, a fold against an arm, hair), with no rim of the old color and
 * nothing blurred. What's in front (`front`: hair, hands) stays in front. A layer grown to take in the
 * band just outside the outline (with `matted`: the pixels decided here), or null.
 */
function replaceEdge(layer, S, front) {
  const { base, target } = S; const { w, h } = base;
  const fh = base.layout?.fh ?? h / 7;
  const B = Math.max(2, Math.round(fh / 30)); const R = Math.max(5, Math.round(fh / 10));
  // (Only where what was worn meets what's beside it: in a body zone, the arms' and hands' own edges, skin
  // against the background, are theirs and stay as they are. What the finder was unsure of inside the
  // outline (a dark number by an arm) is worn too: it isn't an edge.)
  const p = base.people; const worn = new Uint8Array(w * h);
  for (let y = target.box.y0; y < target.box.y1; y++) for (let x = target.box.x0; x < target.box.x1; x++) { const i = y * w + x; if (target.mask[i] && p.body[i] < 128 && p.face[i] < 128 && p.hair[i] < 128) worn[i] = 1; }
  const mb = matteBand(base.rgba, w, h, worn, target.box, B, R);
  // The layer grown over the band.
  const x0 = Math.min(layer.x0, mb.x0); const y0 = Math.min(layer.y0, mb.y0);
  const x1 = Math.max(layer.x0 + layer.pw, mb.x0 + mb.pw); const y1 = Math.max(layer.y0 + layer.ph, mb.y0 + mb.ph);
  const pw = x1 - x0; const ph = y1 - y0; const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < layer.ph; y++) rgba.set(layer.rgba.subarray(y * layer.pw * 4, (y + 1) * layer.pw * 4), ((y + layer.y0 - y0) * pw + layer.x0 - x0) * 4);
  // (The new piece's color near each band pixel, where it isn't there itself: its local mean.)
  const ok = new Uint8Array(pw * ph); for (let k = 0; k < pw * ph; k++) ok[k] = rgba[k * 4 + 3] >= 250 ? 1 : 0;
  const near = [0, 1, 2].map((c) => { const v = new Float32Array(pw * ph); for (let k = 0; k < pw * ph; k++) v[k] = rgba[k * 4 + c]; return boxBlur(v, ok, pw, ph, R); });
  const anyNear = boxBlur(Float32Array.from(ok), new Uint8Array(pw * ph).fill(1), pw, ph, R);
  const matted = new Uint8Array(pw * ph); let n = 0;
  const A = base.allPeople ?? p;
  const nearSkin = (X, Y) => { for (let dy = -B - 1; dy <= B + 1; dy++) for (let dx = -B - 1; dx <= B + 1; dx++) { const XX = X + dx; const YY = Y + dy; if (XX >= 0 && YY >= 0 && XX < w && YY < h && A.body[YY * w + XX] >= 128 && !worn[YY * w + XX]) return true; } return false; };
  for (let y = 0; y < mb.ph; y++) for (let x = 0; x < mb.pw; x++) {
    const mk = y * mb.pw + x; const a = mb.alpha[mk]; if (a < 0) continue;
    const X = mb.x0 + x; const Y = mb.y0 + y; const k = (Y - y0) * pw + X - x0; const i = Y * w + X;
    if (anyNear[k] < 0.02) continue;
    // (Outside it, their other clothes (the shorts below a top's hem, maybe of one white with it): the line
    // between the two is the hem found, not a soft edge; nothing of the new color spills onto them.)
    if (!worn[i] && p.clothes[i] >= 128 && p.body[i] < 128 && !target.mask[i]) continue;
    const fr = front ? front[i] / 255 : 0;
    // (Inside, against someone's skin (an arm in front, their own arm): the outline is the person finder's,
    // not a soft edge to judge by color; a dark print beside the arm looks more like the arm than the cloth.)
    const bySkin = worn[i] && rgba[k * 4 + 3] >= 250 && nearSkin(X, Y);
    // (Nearly all old garment, inside: the new piece as it is. A part of it: that part swapped.)
    if ((a >= 0.92 || bySkin) && rgba[k * 4 + 3] >= 250) { rgba[k * 4 + 3] = Math.round(255 * (1 - fr)); matted[k] = 1; n++; continue; }
    for (let c = 0; c < 3; c++) {
      const N = rgba[k * 4 + 3] >= 250 ? rgba[k * 4 + c] : near[c][k];
      rgba[k * 4 + c] = N + base.rgba[i * 4 + c] - mb.F[mk * 3 + c];
    }
    rgba[k * 4 + 3] = Math.round(255 * a * (1 - fr)); matted[k] = 1; n++;
  }
  return n ? { x0, y0, pw, ph, rgba, matted } : null;
}

/**
 * The new top's hem over what's worn below it (an upper body laid in): just below its bottom edge, on the
 * person's clothes there, a soft shadow fading in a few pixels, the way a hem sits on the skirt or pants
 * under it: the join reads as cloth over cloth, not a cut. The layer grown to take it in, or null.
 */
function hemShadow(layer, S) {
  const { base } = S; const { w, h } = base; const p = base.people;
  const r = Math.max(3, Math.round((base.layout?.fh ?? h / 7) / 14));
  const { pw, ph, x0, y0 } = layer;
  const H2 = Math.min(h - y0, ph + r); const rgba = new Uint8ClampedArray(pw * H2 * 4); rgba.set(layer.rgba);
  const matted = layer.matted ? new Uint8Array(pw * H2) : null; if (matted) matted.set(layer.matted);
  let n = 0;
  for (let x = 0; x < pw; x++) {
    // (The column's hem: its lowest pixel of the piece, if it's at the bottom of the zone.)
    let yb = -1; for (let y = ph - 1; y >= 0; y--) if (rgba[(y * pw + x) * 4 + 3] >= 200) { yb = y; break; }
    if (yb < 0 || yb < ph - r * 3) continue;
    for (let d = 1; d <= r; d++) {
      const y = yb + d; if (y >= H2) break;
      const o = (y * pw + x) * 4; if (rgba[o + 3] >= 200) break;
      const i = (y0 + y) * w + x0 + x; if (Math.max(p.clothes[i], p.others[i]) < 110) continue;
      const a = Math.round(70 * (1 - (d - 1) / r) ** 2);
      if (a > rgba[o + 3]) { rgba[o] = 0; rgba[o + 1] = 0; rgba[o + 2] = 0; rgba[o + 3] = a; if (matted) matted[y * pw + x] = 1; n++; }
    }
  }
  return n ? { x0, y0, pw, ph: H2, rgba, matted: matted ?? layer.matted } : null;
}

/**
 * The new piece's edges casting a soft shadow on the person's skin right under them (light comes mostly from
 * above: most below an edge, a little beside it): a sleeve's hem on the arm, a strap on the shoulder, a
 * neckline on the chest. Not on what's in front of it (`front`: hair, a hand), nor on the face. The layer
 * grown a few pixels to take it in, or null.
 */
function skinShadow(layer, S, front) {
  const { base } = S; const { w, h } = base; const p = base.people;
  const r = Math.max(2, Math.round((base.layout?.fh ?? h / 7) / 22));
  const x0 = Math.max(0, layer.x0 - r); const y0 = Math.max(0, layer.y0 - r);
  const x1 = Math.min(w, layer.x0 + layer.pw + r); const y1 = Math.min(h, layer.y0 + layer.ph + r);
  const pw = x1 - x0; const ph = y1 - y0; const rgba = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < layer.ph; y++) rgba.set(layer.rgba.subarray(y * layer.pw * 4, (y + 1) * layer.pw * 4), ((y + layer.y0 - y0) * pw + layer.x0 - x0) * 4);
  const matted = new Uint8Array(pw * ph);
  if (layer.matted) for (let y = 0; y < layer.ph; y++) for (let x = 0; x < layer.pw; x++) matted[(y + layer.y0 - y0) * pw + x + layer.x0 - x0] = layer.matted[y * layer.pw + x];
  const solid = (x, y) => x >= 0 && y >= 0 && x < pw && y < ph && rgba[(y * pw + x) * 4 + 3] >= 200;
  let n = 0;
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const o = (y * pw + x) * 4; if (rgba[o + 3] >= 60) continue;
    const i = (y0 + y) * w + x0 + x;
    if (p.body[i] < 128 || p.face[i] >= 100 || p.hair[i] >= 100 || (front && front[i] >= 128)) continue;
    // (How near an edge of the piece is: above it, fully; beside it, a third as much.)
    let s2 = 0;
    for (let d = 1; d <= r && !s2; d++) { if (solid(x, y - d) || solid(x - 1, y - d) || solid(x + 1, y - d)) s2 = (1 - (d - 1) / r) ** 2; }
    if (!s2) for (let d = 1; d <= r && !s2; d++) { if (solid(x - d, y) || solid(x + d, y)) s2 = 0.35 * (1 - (d - 1) / r) ** 2; }
    if (!s2) continue;
    const a = Math.round(60 * s2);
    if (a > rgba[o + 3]) {
      // (Over what's already there at the layer's own soft edge: darkened, not replaced.)
      if (rgba[o + 3] > 0) { const k = 1 - a / 255; rgba[o] *= k; rgba[o + 1] *= k; rgba[o + 2] *= k; rgba[o + 3] = Math.max(rgba[o + 3], a); }
      else { rgba[o] = 0; rgba[o + 1] = 0; rgba[o + 2] = 0; rgba[o + 3] = a; }
      matted[y * pw + x] = 1; n++;
    }
  }
  return n ? { x0, y0, pw, ph, rgba, matted } : null;
}

/**
 * Where a garment's prints sit (a number, lettering: findPrints on it), the middle of them all, weighted by
 * size: { x, y } in the photo, or null. What it's printed on tells where the front of the body is.
 */
function printCenter(rgba, w, mask, box) {
  if (!mask || !box) return null;
  const bw = box.x1 - box.x0; const bh = box.y1 - box.y0; if (bw < 20 || bh < 20) return null;
  const fill = new Float32Array(bw * bh * 3); const has = new Uint8Array(bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const i = (box.y0 + y) * w + box.x0 + x; for (let c = 0; c < 3; c++) fill[(y * bw + x) * 3 + c] = rgba[i * 4 + c]; if (mask[i]) has[y] = 1; }
  // (Holes in it count as it: a print the person finder didn't call clothes.)
  const m2 = Uint8Array.from(mask); fillHoles(m2, w, Math.ceil(mask.length / w), box, 0.3);
  const pr = findPrints(fill, rgba, m2, w, box, has, new Uint8Array(bw * bh), null);
  if (!pr) return null;
  let sx = 0; let sy = 0; let sw = 0;
  for (const b of pr.blocks) { const a = (b.x1 - b.x0) * (b.y1 - b.y0); sx += ((b.x0 + b.x1) / 2) * a; sy += ((b.y0 + b.y1) / 2) * a; sw += a; }
  return sw ? { x: box.x0 + sx / sw, y: box.y0 + sy / sw } : null;
}

/**
 * The body's front middle, row by row, on the base and on the piece (for traceTransfer's `centers`): the
 * line from between the shoulders to between the hips, moved over to where the garment's prints say the
 * front is (a body turned a little has the middle of its chest off the shoulders' middle). Null without both
 * poses.
 */
function frontCenters(S) {
  const { base, piece, target } = S; const seen = (v) => v && v[2] >= 0.3;
  const line = (q) => { if (!q || !seen(q.shoulders[0]) || !seen(q.shoulders[1])) return null; const ms = [(q.shoulders[0][0] + q.shoulders[1][0]) / 2, (q.shoulders[0][1] + q.shoulders[1][1]) / 2]; const mh = seen(q.hips[0]) && seen(q.hips[1]) ? [(q.hips[0][0] + q.hips[1][0]) / 2, (q.hips[0][1] + q.hips[1][1]) / 2] : [ms[0], ms[1] + 100]; return (y) => ms[0] + ((mh[0] - ms[0]) * (y - ms[1])) / Math.max(1, mh[1] - ms[1]); };
  const lt = line(base.pose); const lp = line(piece.pose);
  if (!lt || !lp) return null;
  if (target.printsAt === undefined) target.printsAt = printCenter(base.rgba, base.w, target.mask, target.box);
  if (piece.printsAt === undefined || piece.printsOf !== piece.solid) { piece.printsAt = printCenter(piece.draw ?? piece.rgba, piece.w, piece.solid ?? piece.sel, piece.box); piece.printsOf = piece.solid; }
  // (Moved by the prints only when both have them: else the shoulders' middle on both.)
  const dt = target.printsAt && piece.printsAt ? target.printsAt.x - lt(target.printsAt.y) : 0;
  const dp = target.printsAt && piece.printsAt ? piece.printsAt.x - lp(piece.printsAt.y) : 0;
  return { t: (y) => lt(y) + dt, p: (y) => lp(y) + dp };
}
