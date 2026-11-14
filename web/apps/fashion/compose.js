// Fashion's picture, put together (the preview, and the same at full size when saved): the piece's layer
// (one piece; or a top's body and sleeves each fitted to its own, or each shoe to its foot), moved and
// turned by hand, finished (light, form, what's kept in front), over the base, with what was worn there
// taken off where the piece doesn't cover it (Replace).

import { renderPiece, mergeLayers, finishLayer, lightGains, formMap, armsInFront, boxOf, traceTransfer, foldMap, rowSpans } from '../../tools/fashion/fashion-core.js';
import { softenMask } from '../../lib/geometry.js';
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
  // (And a pixel past its outline: the old garment's soft rim is covered too, no outline of it left.)
  const g = Uint8Array.from(m); const H = base.h;
  for (let y = Math.max(1, b.y0 - 1); y < Math.min(H - 1, b.y1 + 1); y++) for (let x = Math.max(1, b.x0 - 1); x < Math.min(w - 1, b.x1 + 1); x++) { const i = y * w + x; if (!m[i] && (m[i - 1] || m[i + 1] || m[i - w] || m[i + w]) && p.face[i] < 128 && p.hair[i] < 128) g[i] = 1; }
  const gb = { x0: Math.max(0, b.x0 - 1), y0: Math.max(0, b.y0 - 1), x1: Math.min(w, b.x1 + 1), y1: Math.min(H, b.y1 + 1) };
  // (Its edges smoothed over many rows for laying the design in: an arm cutting into its side doesn't make
  // the design jump from row to row.)
  const under = { ...target, mask: g, box: gb, spans: rowSpans(g, w, gb, Math.max(14, Math.round((gb.y1 - gb.y0) / 14))), of: target, under: null, soft: null };
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
 * person's own face (its median, within a few shades), once.
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
    if (!s2 && below && tone && p.hair[i] < 128) {
      const d = Math.abs(px[i * 4] - tone[0]) + Math.abs(px[i * 4 + 1] - tone[1]) + Math.abs(px[i * 4 + 2] - tone[2]);
      if (d < 70) s2 = 255;
    }
    m[i] = s2;
  }
  piece.skinMap = m;
  return m;
}

/** Whether the scene lays the design into the outline of what's worn (Replace, on a garment found or traced). */
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
    const open = target.box.y1 >= h - 2 || piece.box.y1 >= piece.h - 2;
    const under = underHair(S);
    const layer = traceTransfer(piece.draw ?? piece.rgba, piece.solid ?? piece.sel, piece.w, piece.h, piece.box, under, w, h, { s: place.s, open, adj: tune, skin: pieceSkin(piece), rebuilt: piece.rebuilt ?? null });
    // Where the base shows its own bare skin (a neckline, the neck), only cloth seen in the piece's photo
    // covers it; the piece's skin, a gap in it, or what was rebuilt under its hair lets the base's skin show.
    // (Where the base is clothed there, the cloth carries on: skin made up from nothing looks painted on.)
    // Decided for the neckline as a whole, not pixel by pixel (an island of cloth in it looks cut out): when
    // most of the base's bare skin there meets the piece's own cloth, the piece's higher neckline covers
    // it; otherwise the base keeps its neckline.
    if (layer.skin && base.people) {
      let bare = 0; let cloth = 0;
      const isBare = (i) => base.people.body[i] >= 128 || base.people.face[i] >= 128;
      for (let y = 0; y < layer.ph; y++) for (let x = 0; x < layer.pw; x++) {
        const k = y * layer.pw + x; if (!layer.rgba[k * 4 + 3]) continue;
        if (isBare((layer.y0 + y) * w + layer.x0 + x)) { bare++; if (!layer.skin[k]) cloth++; }
      }
      const cover = bare > 0 && cloth / bare > 0.6;
      for (let y = 0; y < layer.ph; y++) for (let x = 0; x < layer.pw; x++) {
        const k = y * layer.pw + x; const i = (layer.y0 + y) * w + layer.x0 + x;
        if (!isBare(i)) continue;
        if (!cover || base.people.face[i] >= 128) layer.rgba[k * 4 + 3] = 0;
      }
    }
    // Its edge: the outline's own, softened a pixel.
    if (under.soft?.length !== w * h) under.soft = softenMask(under.mask, w, h, 1);
    for (let y = 0; y < layer.ph; y++) for (let x = 0; x < layer.pw; x++) { const o = (y * layer.pw + x) * 4; if (layer.rgba[o + 3]) layer.rgba[o + 3] = Math.round(255 * Math.min(1, under.soft[(layer.y0 + y) * w + layer.x0 + x] * 1.15)); }
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
        const whole = ['top', 'bottom', 'upper', 'lower', 'outfit'].includes(kind);
        const tb = whole ? { x0: 0, x1: w } : S.target?.parts?.sleeves?.torso?.box ?? S.target?.box ?? base.layout.person;
        const inset = whole ? 0 : (tb.x1 - tb.x0) * 0.04;
        const a = armsInFront(ppl, base.layout, tb.x0 + inset, tb.x1 - inset, 1.1);
        for (let i = 0; i < m.length; i++) { const v = a[i] <= 140 ? 0 : a[i] >= 205 ? 255 : Math.round(((a[i] - 140) / 65) * 255); if (v > m[i]) m[i] = v; }
      }
      cache.front = tune.front || arms ? m : null; cache.frontKey = fkey; cache.frontBase = base;
    }
    front = cache.front;
  }
  const gains = lightGains(piece.rgba, piece.people?.face ?? null, base.rgba, ppl?.face ?? null);
  return finishLayer(layer, w, { gains, light: tune.light / 100, form: cache.form, fbox, formAmt: trace ? tune.form / 100 : tune.form / 100, front, soft: trace ? 0 : tune.soft, depth: tune.depth ? Math.max(2, Math.round((base.layout?.fh ?? h / 7) / 14)) : 0, round: trace ? tune.form / 300 : tune.form / 100 });
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
    if (!on || (front && front[y * w + x] >= 128) || (people && (people.body[y * w + x] >= 128 || people.face[y * w + x] >= 128))) continue;
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
