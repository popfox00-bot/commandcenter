// Fashion's picture, put together (the preview, and the same at full size when saved): the piece's layer
// (one piece; or a top's body and sleeves each fitted to its own, or each shoe to its foot), moved and
// turned by hand, finished (light, form, what's kept in front), over the base, with what was worn there
// taken off where the piece doesn't cover it (Replace).

import { renderPiece, mergeLayers, finishLayer, lightGains, formMap, armsInFront, boxOf, traceTransfer, foldMap, rowSpans, upperParts, bareArm, isZone } from '../../tools/fashion/fashion-core.js';
import { softenMask } from '../../lib/geometry.js';
import { rgbToLab } from '../../lib/color-match.js';
import { cleanUp } from '../../tools/editor/cleanup.js';

/**
 * What's worn there and what of it the hair hides (long hair over a shirt): the garment goes on under the
 * hair, and the hair is laid back over it (what's kept in front). The target with that added, once.
 */
function underHair(S) {
  const { base, target } = S; const p = base.people;
  if (!p) return target;
  if (target.under?.of === target) return target.under;
  const { w } = base; const b = target.box; const m = Uint8Array.from(target.mask);
  for (let y = b.y0; y < b.y1; y++) {
    let l = -1; let r = -1; for (let x = b.x0; x < b.x1; x++) if (target.mask[y * w + x]) { if (l < 0) l = x; r = x; }
    // (Hair, however faint, and what's faintly clothes there: the old garment between the strands.)
    for (let x = l + 1; x < r; x++) { const i = y * w + x; if (!m[i] && (p.hair[i] >= 30 || p.clothes[i] >= 40)) m[i] = 1; }
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
  // (And a pixel past its outline: the old garment's soft rim is covered too, no outline of it left.)
  const g = Uint8Array.from(m); const H = base.h;
  for (let y = Math.max(1, b.y0 - 1); y < Math.min(H - 1, b.y1 + 1); y++) for (let x = Math.max(1, b.x0 - 1); x < Math.min(w - 1, b.x1 + 1); x++) { const i = y * w + x; if (!m[i] && (m[i - 1] || m[i + 1] || m[i - w] || m[i + w]) && p.face[i] < 128 && p.hair[i] < 128) g[i] = 1; }
  const gb = { x0: Math.max(0, b.x0 - 1), y0: Math.max(0, b.y0 - 1), x1: Math.min(w, b.x1 + 1), y1: Math.min(H, b.y1 + 1) };
  // (Its edges smoothed over many rows for laying the design in: an arm cutting into its side doesn't make
  // the design jump from row to row.)
  const under = { ...target, mask: g, box: gb, spans: rowSpans(g, w, gb, Math.max(14, Math.round((gb.y1 - gb.y0) / 14))), of: target, under: null, soft: null, neckSkin };
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
    const neckPatch = !zone && base.layout && q.some((k) => y0 + ((k / pw) | 0) < base.layout.chin + base.layout.fh * 0.35);
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
        const sorted = [...lum].sort((a2, b2) => a2 - b2); const mid = sorted[sorted.length >> 1] || 1;
        let seed = 9;
        qq.forEach((k, j) => {
          seed = (seed * 1103515245 + 12345) >>> 0; const g = ((seed / 4294967296) - 0.5) * 4;
          const sh = Math.max(0.7, Math.min(1.25, lum[j] / mid));
          for (let c = 0; c < 3; c++) layer.rgba[k * 4 + c] = tone[c] * sh + g;
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
    let seed = 5;
    for (let k = 0; k < n; k++) {
      if (!layer.bare[k] || !layer.rgba[k * 4 + 3] || isBare(k) || (k / pw) > lowest) continue;
      seed = (seed * 1103515245 + 12345) >>> 0; const g = ((seed / 4294967296) - 0.5) * 4;
      for (let c = 0; c < 3; c++) layer.rgba[k * 4 + c] = tone[c] + g;
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
  if (!differs && !bothBare) return null;
  const under = underHair(S);
  const pm = piece.solid ?? piece.sel; const tex = piece.draw ?? piece.rgba; const sk = pieceSkin(piece);
  const layers = [];
  // The torso.
  // (The torso: what's worn there less the arms; by the pose when it was found, else by columns.)
  const minus = (m, arms) => { const o = Uint8Array.from(m); for (let i = 0; i < o.length; i++) if (arms[i]) o[i] = 0; return o; };
  // (Their whole torso, its bare skin too (a tank top's shoulders), not only what's worn on it: skin and
  // cloth are told apart below, patch by patch.)
  const withTorso = (m, part) => { const o = Uint8Array.from(m); if (part) for (let i = 0; i < o.length; i++) if (part.mask[i]) o[i] = 1; return o; };
  const tAll = withTorso(under.mask, bp.torso); const pAll = withTorso(pm, pp.torso);
  // (Both bare-armed: only the base's bare arms are theirs to keep; anything else of the zone is torso.)
  const tArms = !differs && bp.byPose ? (() => { const o = new Uint8Array(w * h); for (const k of ['left', 'right']) if (bp[k] && bare(bp[k])) for (let i = 0; i < o.length; i++) if (bp[k].mask[i]) o[i] = 1; return o; })() : bp.arms;
  const tT = bp.byPose ? cut(minus(tAll, tArms), w, h, -1, w + 1) : cut(tAll, w, h, bp.t0, bp.t1);
  const pT = pp.byPose ? cut(minus(pAll, pp.arms), piece.w, piece.h, -1, piece.w + 1) : cut(pAll, piece.w, piece.h, pp.t0, pp.t1);
  if (tT && pT) {
    const open = tT.box.y1 >= h - 2 || pT.box.y1 >= piece.h - 2;
    const L = traceTransfer(tex, pT.mask, piece.w, piece.h, pT.box, tT, w, h, { s: place.s, open, adj: tune, skin: sk, rebuilt: piece.rebuilt ?? null });
    // (The piece's bare skin painted where the base was clothed only when an arm changes, a tank top onto a
    // jacket: both bare-armed, the base's own neckline and skin stay.)
    // (Nor, in a zone, the piece's own skin painted on: theirs and the base's both bare, the base keeps theirs.)
    neckline(L, base, w, differs, false); softEdge(L, tT, w, h); layers.push(L);
  }
  // The arms.
  const tone = skinTone(base);
  for (const side of ['left', 'right']) {
    const b = bp[side]; const p = pp[side]; if (!b || !p) continue;
    const pCl = cut(p.mask, piece.w, piece.h, -1, piece.w + 1);
    if (p.covered) {
      // A sleeve: into the base's sleeve, or over their bare arm in its shape.
      const pc = Uint8Array.from(pCl.mask); for (let i = 0; i < pc.length; i++) if (piece.people.clothes[i] < 100) pc[i] = 0;
      const pb = boxOf(pc, piece.w, piece.h); if (!pb) continue;
      const tB = cut(b.mask, w, h, -1, w + 1);
      const L = traceTransfer(tex, pc, piece.w, piece.h, pb, tB, w, h, { s: place.s, open: false, adj: tune });
      softEdge(L, tB, w, h); layers.push(L);
    } else if (b.covered && tone) {
      // A bare arm where the base's sleeve was.
      const sl = Uint8Array.from(b.mask); for (let i = 0; i < sl.length; i++) if (base.people.clothes[i] < 100) sl[i] = 0;
      const sb = boxOf(sl, w, h); if (!sb) continue;
      layers.push(bareArm({ mask: sl, box: sb }, w, h, tone, base.people));
    }
  }
  if (!layers.length) return null;
  // (The torso over the arms: drawn last.)
  return mergeLayers([...layers.slice(1), layers[0]]);
}

/** Whether a part is clearly covered (true: mostly clothes), clearly bare (false), or neither (null: a short sleeve). */
const clearly = (part) => (part.clothFrac > 0.7 ? true : part.clothFrac < 0.3 ? false : null);

/** The base person's skin color (their bare skin's median, else their face's), once. */
function skinTone(base) {
  if (base.tone !== undefined) return base.tone;
  const p = base.people; const pick = (map) => { const v = [[], [], []]; for (let i = 0; i < map.length; i += 3) if (map[i] >= 200) for (let c = 0; c < 3; c++) v[c].push(base.rgba[i * 4 + c]); return v[0].length > 60 ? v.map((a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; }) : null; };
  base.tone = pick(p.body) ?? pick(p.face);
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
    if (isZone(kind) && kind !== 'lower' && base.layout && piece.layout && base.people && piece.people) {
      const z = zoneLayer(S); if (z) return z;
    }
    const open = target.box.y1 >= h - 2 || piece.box.y1 >= piece.h - 2;
    const under = underHair(S);
    const layer = traceTransfer(piece.draw ?? piece.rgba, piece.solid ?? piece.sel, piece.w, piece.h, piece.box, under, w, h, { s: place.s, open, adj: tune, skin: pieceSkin(piece), rebuilt: piece.rebuilt ?? null });
    neckline(layer, base, w);
    softEdge(layer, under, w, h);
    return layer;
  }
  const fit = tune.fit / 100;
  const fitting = mode !== 'add' && target && fit > 0;
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
  return { x0, y0, pw: dst.width, ph: dst.height, rgba: c2.getImageData(0, 0, dst.width, dst.height).data };
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
  if (trace) {
    // The folds and shadows of what was worn there, on the design laid into it.
    if (cache.formKey !== `fold${key}` || cache.formBase !== base || cache.formTarget !== S.target) {
      const fh = base.layout?.fh ?? h / 7;
      cache.form = foldMap(base.rgba, w, clothesOf(S), fbox, Math.max(1, Math.round(fh / 45)), Math.max(6, Math.round(fh / 3.5)));
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
        for (let i = 0; i < m.length; i++) { const v = a[i] <= 140 ? 0 : a[i] >= 205 ? 255 : Math.round(((a[i] - 140) / 65) * 255); if (v > m[i]) m[i] = v; }
      }
      cache.front = tune.front || arms ? m : null; cache.frontKey = fkey; cache.frontBase = base;
    }
    front = cache.front;
  }
  const gains = lightGains(piece.rgba, piece.people?.face ?? null, base.rgba, ppl?.face ?? null);
  const done = finishLayer(layer, w, { gains, light: tune.light / 100, form: cache.form, fbox, formAmt: trace ? tune.form / 100 : tune.form / 100, front, soft: trace ? 0 : tune.soft, depth: tune.depth ? Math.max(2, Math.round((base.layout?.fh ?? h / 7) / 14)) : 0, round: trace ? tune.form / 300 : tune.form / 100 });
  // (As sharp and as grainy as the photo it's in: a crisp piece in a soft photo looks pasted on.)
  if (trace && S.target && ppl) matchGrain(layer, base, clothesOf(S));
  // (A soft shadow on it where hair or an arm lies over it.)
  if (front && kind !== 'shoes' && kind !== 'hat') contactShadow(layer, w, h, front, Math.max(2, Math.round((base.layout?.fh ?? h / 7) / 16)));
  return done;
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
    if (layer) { const lx = x - layer.x0; const ly = y - layer.y0; if (lx >= 0 && ly >= 0 && lx < layer.pw && ly < layer.ph && layer.rgba[(ly * layer.pw + lx) * 4 + 3] >= 128) continue; }
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
  // (Only from bare skin or the background: not the face (a neckline filled from it shows an eye), the hair,
  // or other clothes.)
  if (people) for (let i = 0; i < w * h; i++) if (Math.max(people.face[i], people.hair[i], people.clothes[i], people.others[i]) >= 110) avoid[i] = 1;
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
  const bm = [0, 0, 0]; let nb = 0; let ta = 0; let tb = 0;
  const lm = [0, 0, 0]; let nl = 0;
  for (let y = 0; y < layer.ph; y++) for (let x = 0; x < layer.pw; x++) {
    const i = (layer.y0 + y) * w + layer.x0 + x; if (!cl[i]) continue;
    for (let c = 0; c < 3; c++) bm[c] += base.rgba[i * 4 + c];
    const q = rgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]); ta += q[1]; tb += q[2]; nb++;
    const o = (y * layer.pw + x) * 4; if (layer.rgba[o + 3] >= 250) { for (let c = 0; c < 3; c++) lm[c] += layer.rgba[o + c]; nl++; }
  }
  if (nb < 50 || nl < 50) return null;
  ta /= nb; tb /= nb;
  const gain = [0, 1, 2].map((c) => (lm[c] / nl) / Math.max(8, bm[c] / nb));
  // Around it, about half a face's width.
  const g = Math.round(base.layout.fw * 0.6); const B = target.box;
  const x0 = Math.max(0, B.x0 - g); const y0 = Math.max(0, B.y0 - g); const x1 = Math.min(w, B.x1 + g); const y1 = Math.min(h, B.y1 + g);
  const pw = x1 - x0; const ph = y1 - y0; const wgt = new Float32Array(pw * ph); let any = 0;
  const covered = (X, Y) => { const lx = X - layer.x0; const ly = Y - layer.y0; return lx >= 0 && ly >= 0 && lx < layer.pw && ly < layer.ph && layer.rgba[(ly * layer.pw + lx) * 4 + 3] >= 128; };
  // (Of their hue: near its color, or its hue at any lightness (its shade); and nearer it than their skin,
  // on them (a strap too thin for the person finder to call clothes), never the leaves behind them.)
  const tone = skinTone(base); const sk = tone ? rgbToLab(tone[0], tone[1], tone[2]) : null;
  const tc = Math.hypot(ta, tb); const th0 = Math.atan2(tb, ta);
  for (let Y = y0; Y < y1; Y++) for (let X = x0; X < x1; X++) {
    const i = Y * w + X;
    if (p.face[i] >= 128 || Math.max(p.clothes[i], p.body[i], p.others[i], p.hair[i]) < 40 || covered(X, Y)) continue;
    const q = rgbToLab(base.rgba[i * 4], base.rgba[i * 4 + 1], base.rgba[i * 4 + 2]);
    const d = Math.hypot(q[1] - ta, q[2] - tb); const qc = Math.hypot(q[1], q[2]);
    let hd = Math.abs(Math.atan2(q[2], q[1]) - th0); if (hd > Math.PI) hd = 2 * Math.PI - hd; hd *= 180 / Math.PI;
    let v = d < 22 ? Math.min(1, (22 - d) / 10) : 0;
    if (tc >= 8 && qc >= 8) v = Math.max(v, hd < 20 ? 1 : hd < 35 ? (35 - hd) / 15 : 0);
    if (!v) continue;
    if (sk) {
      // (Nearer the garment's hue than their skin's, by its angle where both have color; else by distance.)
      let hs = Math.abs(Math.atan2(q[2], q[1]) - Math.atan2(sk[2], sk[1])); if (hs > Math.PI) hs = 2 * Math.PI - hs; hs *= 180 / Math.PI;
      if (qc >= 8 && tc >= 8 ? hs <= hd : Math.hypot(q[1] - sk[1], q[2] - sk[2]) < d) continue;
    }
    if (p.clothes[i] < 90) v *= 0.9;
    wgt[(Y - y0) * pw + X - x0] = v; any++;
  }
  return any ? { x0, y0, pw, ph, wgt, gain } : null;
}

/** The leftovers (above) recolored on `out` (w wide) from `src` (the base's pixels, the same size). In place. */
export function recolor(out, w, rest, src) {
  if (!rest) return;
  for (let y = 0; y < rest.ph; y++) for (let x = 0; x < rest.pw; x++) {
    const v = rest.wgt[y * rest.pw + x]; if (!v) continue;
    const i = ((rest.y0 + y) * w + rest.x0 + x) * 4;
    for (let c = 0; c < 3; c++) out[i + c] = out[i + c] * (1 - v) + Math.min(255, src[i + c] * rest.gain[c]) * v;
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
  const pieceStraps = ptop - pb.y0 > (piece.layout?.fh ?? fh) * 0.25 && pn > 20;
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
