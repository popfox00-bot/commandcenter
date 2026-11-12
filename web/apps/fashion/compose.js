// Fashion's picture, put together (the preview, and the same at full size when saved): the piece's layer
// (one piece; or a top's body and sleeves each fitted to its own, or each shoe to its foot), moved and
// turned by hand, finished (light, form, what's kept in front), over the base, with what was worn there
// taken off where the piece doesn't cover it (Replace).

import { renderPiece, mergeLayers, finishLayer, lightGains, formMap, armsInFront, boxOf } from '../../tools/fashion/fashion-core.js';
import { cleanUp } from '../../tools/editor/cleanup.js';

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
  const fit = tune.fit / 100;
  const fitting = mode !== 'add' && target && fit > 0;
  const regionOf = (t) => t && (mode === 'overlay' ? { box: t.box, spans: widen(t.spans, t.box, 0.04) } : t);
  const at = (b) => ({ x0: place.x0 + (b.x0 - piece.box.x0) * place.s, y0: place.y0 + (b.y0 - piece.box.y0) * place.s, s: place.s });
  const R = (alpha, box, pl, region, flip = false) => renderPiece(piece.rgba, alpha, piece.w, piece.h, box, pl, region, region ? fit : 0, w, h, flip);
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
  if (cache.formKey !== key || cache.formBase !== base) {
    const fh = base.layout?.fh ?? h / 7;
    cache.form = formMap(base.rgba, w, fbox, Math.max(1, Math.round(fh / 40)), Math.max(4, Math.round(fh / 3)));
    cache.formKey = key; cache.formBase = base;
  }
  let front = null;
  const ppl = base.people;
  if (ppl && kind !== 'shoes') {
    const arms = tune.arms && base.layout && ['top', 'jacket', 'dress', 'bottom'].includes(kind);
    const fkey = `${tune.front}|${arms}|${kind}|${S.target?.box?.x0},${S.target?.box?.x1}`;
    if (cache.frontKey !== fkey || cache.frontBase !== base) {
      const m = new Uint8Array(w * h);
      if (tune.front) for (let i = 0; i < m.length; i++) m[i] = kind === 'hat' ? ppl.face[i] : Math.max(ppl.face[i], ppl.hair[i]);
      if (arms) {
        const tb = S.target?.parts?.sleeves?.torso?.box ?? S.target?.box ?? base.layout.person;
        const inset = (tb.x1 - tb.x0) * 0.04;
        const a = armsInFront(ppl, base.layout, tb.x0 + inset, tb.x1 - inset);
        for (let i = 0; i < m.length; i++) if (a[i] > m[i]) m[i] = a[i];
      }
      cache.front = tune.front || arms ? m : null; cache.frontKey = fkey; cache.frontBase = base;
    }
    front = cache.front;
  }
  const gains = lightGains(piece.rgba, piece.people?.face ?? null, base.rgba, ppl?.face ?? null);
  return finishLayer(layer, w, { gains, light: tune.light / 100, form: cache.form, fbox, formAmt: tune.form / 100, front, soft: tune.soft });
}

/**
 * What was worn there that the piece doesn't cover (Replace): the target (and a couple of pixels past
 * it) where the finished layer is less than half there, and that isn't kept in front (`front`: a hand
 * across it shows as it is). { mask, box, count } or null.
 */
export function uncovered(target, layer, w, h, front = null) {
  const m = new Uint8Array(w * h); const b = target.box; let count = 0;
  for (let y = Math.max(0, b.y0 - 2); y < Math.min(h, b.y1 + 2); y++) for (let x = Math.max(0, b.x0 - 2); x < Math.min(w, b.x1 + 2); x++) {
    let on = 0; for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx; const Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && target.mask[Y * w + X]) { on = 1; break; } }
    if (!on || (front && front[y * w + x] >= 128)) continue;
    if (layer) { const lx = x - layer.x0; const ly = y - layer.y0; if (lx >= 0 && ly >= 0 && lx < layer.pw && ly < layer.ph && layer.rgba[(ly * layer.pw + lx) * 4 + 3] >= 128) continue; }
    m[y * w + x] = 1; count++;
  }
  const box = count ? boxOf(m, w, h) : null;
  return box ? { mask: m, box, count } : null;
}

/**
 * Those pixels filled from what's around them (the background, the skin beside them), never from what was
 * worn there (`avoid`: the target, grown a little). A patch, or null.
 */
export function fillUncovered(rgba, w, h, unc, target) {
  const avoid = new Uint8Array(w * h); const b = target.box;
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
