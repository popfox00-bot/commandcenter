// @ts-check
// FaceMask's fitting, where each face's skin is and ends: that face's skin as a test (skinModel), its outline
// in the photo, jaw to hairline (targetOutline), and the Character's own face in its picture (ownOutline,
// ownMask). Pure.

import { convexHull as hull, fillPolygon, scalePolygon as grow, softenMask as soften } from '../../lib/geometry.js';
import { faceContour } from '../../lib/face-core.js';
import { rgbToLab } from '../../lib/color-match.js';

/** The Character's own outline (targetOutline on its own pixels), worked out once per picture. */
const ownCache = new WeakMap();
export function ownOutline(img, cw, ch, charFace) {
  const key = ownCache.get(img); if (key?.face === charFace) return key.poly;
  const poly = charFace.pts?.length === 68 ? targetOutline(img, cw, ch, charFace) ?? faceContour(charFace, cw, ch, { forehead: 0.55 }) : null;
  ownCache.set(img, { face: charFace, poly });
  return poly;
}

/** How much of each of the Character's pixels is its own face (0..1): inside its jaw and its own hairline, a soft edge just inside. */
export function ownMask(img, cw, ch, charFace) {
  const poly = ownOutline(img, cw, ch, charFace);
  if (!poly) return null;
  // Its jaw and cheeks drawn in a little (0.93), with a wide soft edge: its own jawline (its shading)
  // never lands inside the face it goes on as a second one; that face's own jaw and cheeks show there.
  const g = grow(poly, 0.93); const roomy = poly.map((p, i) => (i <= 16 ? g[i] : p));
  const hh = Math.max(...roomy.map((p) => p[1])) - Math.min(...roomy.map((p) => p[1]));
  const m = soften(fillPolygon(roomy, 0, 0, cw, ch), cw, ch, Math.max(1, Math.round(hh * 0.08)));
  for (let i = 0; i < m.length; i++) m[i] = Math.max(0, Math.min(1, (m[i] - 0.5) * 2.2));
  // Its own features (eyes, brows, nose, mouth, with room around them) always kept, whatever its outline
  // search found (a shadow or a highlight on a cheek isn't the edge of its face).
  const feat = grow(hull(charFace.pts.slice(17).map(([u, v]) => [u * cw, v * ch])), 1.25);
  // (Its edge as soft as the jaw's, so it never shows as a line.)
  const f = soften(fillPolygon(feat, 0, 0, cw, ch), cw, ch, Math.max(1, Math.round(hh * 0.07)));
  for (let i = 0; i < m.length; i++) m[i] = Math.max(m[i], Math.min(1, f[i] * 1.6));
  // Its forehead fades out gently toward its own hairline (over a fifth of its brow-to-chin length), so
  // it melts into the forehead of the face it goes on rather than ending in a line across it.
  const P = (i) => [charFace.pts[i][0] * cw, charFace.pts[i][1] * ch];
  const brow = [(P(19)[0] + P(24)[0]) / 2, (P(19)[1] + P(24)[1]) / 2]; const chin = P(8);
  const low = Math.hypot(brow[0] - chin[0], brow[1] - chin[1]);
  if (low > 4) {
    const up = [(brow[0] - chin[0]) / low, (brow[1] - chin[1]) / low]; const across = [-up[1], up[0]];
    // The hairline as lift above the brows, by place across the face (the forehead points, in order).
    const line = poly.slice(17).map(([x, y]) => [(x - brow[0]) * across[0] + (y - brow[1]) * across[1], (x - brow[0]) * up[0] + (y - brow[1]) * up[1]]).sort((a, b) => a[0] - b[0]);
    const hairAt = (t) => { if (t <= line[0][0]) return line[0][1]; for (let j = 1; j < line.length; j++) if (t <= line[j][0]) { const f = (t - line[j - 1][0]) / (line[j][0] - line[j - 1][0] || 1); return line[j - 1][1] + f * (line[j][1] - line[j - 1][1]); } return line[line.length - 1][1]; };
    const fade = 0.2 * low;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = y * cw + x; if (!m[i]) continue;
      const lift = (x - brow[0]) * up[0] + (y - brow[1]) * up[1]; if (lift <= 0) continue;
      const t = Math.max(0, Math.min(1, (hairAt((x - brow[0]) * across[0] + (y - brow[1]) * across[1]) - lift) / fade));
      m[i] *= t * t * (3 - 2 * t);
    }
  }
  return m;
}

/**
 * The face's own skin, as a test: its colors (Lab) measured between the eyes and the mouth (the
 * cheeks and nose), each channel with its own spread, so a color is judged by how far it is from that
 * skin in each (lightness, redness, yellowness). Lightness counts for less than hue, brighter least (a
 * highlight or a shadow is still skin; hair, even blond, is darker and of a different hue). null without the landmarks.
 * `.off(L, a, b)`: how far, in spreads (3 or more: not this skin).
 */
export function skinModel(photo, W, H, face) {
  const pts = face.pts;
  if (!pts || pts.length !== 68) return null;
  const P = (i) => [pts[i][0] * W, pts[i][1] * H];
  const at = (x, y) => { const X = Math.round(x); const Y = Math.round(y); if (X < 0 || Y < 0 || X >= W || Y >= H) return null; const o = (Y * W + X) * 4; return photo[o + 3] < 128 ? null : rgbToLab(photo[o], photo[o + 1], photo[o + 2]); };
  let skin = [];
  const a = P(29); const b = P(33); const l = P(2); const r = P(14);
  for (let t = 0; t <= 1; t += 0.1) for (let s2 = 0.2; s2 <= 0.8; s2 += 0.05) {
    const c = at(l[0] + (r[0] - l[0]) * s2, a[1] + (b[1] - a[1]) * t + (l[1] + (r[1] - l[1]) * s2 - (l[1] + r[1]) / 2)); if (c) skin.push(c);
  }
  if (skin.length < 10) return null;
  const stats = (xs) => { const m = [0, 1, 2].map((k) => xs.reduce((t, c) => t + c[k], 0) / xs.length); return [m, [0, 1, 2].map((k) => Math.sqrt(xs.reduce((t, c) => t + (c[k] - m[k]) ** 2, 0) / xs.length))]; };
  let [mean, sd] = stats(skin);
  // Without what isn't skin there (a nostril, a freckle's shadow): the far ones left out once.
  const trimmed = skin.filter((c) => [0, 1, 2].every((k) => Math.abs(c[k] - mean[k]) <= 2.5 * sd[k] + 1e-6));
  if (trimmed.length >= 10) { skin = trimmed; [mean, sd] = stats(skin); }
  sd = [Math.max(7, sd[0]), Math.max(2.5, sd[1]), Math.max(3, sd[2])];
  const off = (L, A, B) => { let dl = (L - mean[0]) / sd[0]; dl *= dl > 0 ? 0.5 : 0.7; return Math.hypot(dl, (A - mean[1]) / sd[1], (B - mean[2]) / sd[2]); };
  return { mean, sd, off, isSkin: (rr, gg, bb) => { const c = rgbToLab(rr, gg, bb); return off(c[0], c[1], c[2]) < 3; } };
}

/**
 * Where the face in the photo ends: its own clean outline, the jaw from ear to ear (0–16), then up
 * across the forehead to the hairline, found in the photo itself: from the brows up, column by column,
 * the first place the skin gives way to hair (judged by skinModel). The jaw too is brought in where
 * the face's skin ends before it (hair over a cheek or temple, the far side of a turned face, a
 * flower by the ear): from the nose out to each jaw point, the first stretch that isn't that skin.
 * Where there's no hair to find (a bald head, a high forehead), a forehead's usual height. In the
 * picture's pixels, or null without the landmarks. `.snapped[i]`: whether jaw point i was brought in.
 */
export function targetOutline(photo, W, H, face) {
  const pts = face.pts;
  if (!pts || pts.length !== 68) return null;
  const P = (i) => [pts[i][0] * W, pts[i][1] * H];
  const brow = [(P(19)[0] + P(24)[0]) / 2, (P(19)[1] + P(24)[1]) / 2]; const chin = P(8);
  const ux = brow[0] - chin[0]; const uy = brow[1] - chin[1]; const len = Math.hypot(ux, uy);
  if (len < 6) return null;
  const up = [ux / len, uy / len];
  const model = skinModel(photo, W, H, face);
  if (!model) return null;
  const step = Math.max(1, len / 90); const r = Math.max(1, Math.round(step / 2));
  // A point's color (Lab, averaged over a few pixels so a single strand or freckle counts for less);
  // null past the picture's edge or on a clear or partly clear pixel (the edge of a cut-out face).
  const lab = (x, y) => {
    const X = Math.round(x); const Y = Math.round(y); if (X < 0 || Y < 0 || X >= W || Y >= H) return null;
    let rr = 0; let gg = 0; let bb = 0; let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = Math.min(W - 1, Math.max(0, X + dx)); const yy = Math.min(H - 1, Math.max(0, Y + dy)); const o = (yy * W + xx) * 4;
      if (photo[o + 3] < 250) return null; // (its soft edge too: it carries what was around the face)
      rr += photo[o]; gg += photo[o + 1]; bb += photo[o + 2]; n++;
    }
    return rgbToLab(rr / n, gg / n, bb / n);
  };
  // Out along a line from (px, py), from `from` to `to`: where the skin ends. Each point is compared with
  // the skin just before it on the same line (so shading and a redder cheek or a paler forehead are
  // still skin), and the edge is where most of the next stretch differs: hair, a flower, the background.
  const win = Math.max(4, Math.round((0.05 * len) / step));
  const TOL = 13;
  // (Whether the last edge found was the picture's own edge, or a cut-out's, rather than hair.)
  let edgeClear = false;
  function edgeAlong(px, py, vx, vy, from, to, ref0 = null) {
    let ref = ref0 ? ref0.slice() : null; let n = ref0 ? 3 : 0; const bad = [];
    // (Brighter counts for less than darker: a highlight is still skin; hair is darker.)
    const dE = (c, q) => Math.hypot((c[0] - q[0]) * (c[0] > q[0] ? 0.3 : 0.7), c[1] - q[1], c[2] - q[2]);
    let first = ref0 ? ref0.slice() : null; // never drifting far from the skin it started on (a soft edge into hair)
    for (let d = from; d <= to + 1e-6; d += step) {
      const c = lab(px + vx * d, py + vy * d); let b;
      if (!c) b = true;
      else if (n < 3) { b = model.off(c[0], c[1], c[2]) > 4.5; if (!b) { ref = ref ? ref.map((v, k) => (v * n + c[k]) / (n + 1)) : c.slice(); n++; if (n === 3) first = ref.slice(); } }
      else { b = dE(c, ref) > TOL || dE(c, first) > 1.6 * TOL; if (!b) ref = ref.map((v, k) => v * 0.85 + c[k] * 0.15); }
      bad.push(!c ? 2 : b ? 1 : 0); // (2: the edge of the picture or of a cut-out, not hair)
      // The edge: the start of the first window in which nearly all of it is off the skin.
      if (bad.length >= win) {
        const s0 = bad.length - win; let cnt = 0; for (let k = s0; k < bad.length; k++) cnt += bad[k] ? 1 : 0;
        if (cnt >= Math.ceil(win * 0.6)) { let k = s0; while (!bad[k]) k++; edgeClear = bad[k] === 2; return from + k * step; }
      }
    }
    edgeClear = false;
    return null;
  }
  // Up from each brow point (26 back to 17) to the hairline, each compared with the forehead's own skin
  // (just above the inner brows: nearly always skin), so hair at the temples is found from the start.
  const lo = 0.08 * len; const hi = 0.75 * len; const usual = 0.42 * len;
  const mid = [(P(21)[0] + P(22)[0]) / 2, (P(21)[1] + P(22)[1]) / 2]; const fs = [];
  for (const t of [0.04, 0.07, 0.1]) for (const sx of [-0.06, 0, 0.06]) { const c = lab(mid[0] + up[0] * t * len - up[1] * sx * len, mid[1] + up[1] * t * len + up[0] * sx * len); if (c && model.off(c[0], c[1], c[2]) < 4.5) fs.push(c); }
  let forehead = fs.length ? [0, 1, 2].map((k) => fs.reduce((t, c) => t + c[k], 0) / fs.length) : null;
  if (!forehead) forehead = model.mean;
  const lifts = []; const clipped = [];
  for (let i = 26; i >= 17; i--) { const [bx, by] = P(i); lifts.push(edgeAlong(bx, by, up[0], up[1], lo, hi, forehead) ?? usual); clipped.push(edgeClear); }
  // Smoothed along the forehead (one stray strand doesn't dent it).
  const smooth = lifts.map((v, k) => { const w = lifts.slice(Math.max(0, k - 1), k + 2); return w.reduce((s3, x) => s3 + x, 0) / w.length; });
  // The jaw: out from the nose tip toward each jaw point (starting past the eyes, brows, nose and
  // mouth on the way), the start of the first stretch off the skin long enough not to be a freckle.
  const nose = P(30);
  const features = []; for (let i = 17; i < 68; i++) if (i < 27 || i > 30) features.push(P(i));
  /** @type {any} */
  const poly = []; const snapped = [];
  for (let i = 0; i <= 16; i++) {
    const [jx, jy] = P(i); const dist = Math.hypot(jx - nose[0], jy - nose[1]);
    const vx = (jx - nose[0]) / dist; const vy = (jy - nose[1]) / dist;
    let from = 0.55 * dist;
    for (const [fx, fy] of features) {
      const along = (fx - nose[0]) * vx + (fy - nose[1]) * vy; const across = Math.abs((fx - nose[0]) * vy - (fy - nose[1]) * vx);
      if (across < 0.1 * len && along < dist) from = Math.max(from, along + 0.04 * len);
    }
    from = Math.min(from, 0.82 * dist);
    const hit = edgeAlong(nose[0], nose[1], vx, vy, from, dist);
    if (hit !== null) { const t = hit / dist; poly.push([nose[0] + (jx - nose[0]) * t, nose[1] + (jy - nose[1]) * t]); snapped.push(true); } else { poly.push([jx, jy]); snapped.push(false); }
  }
  for (let k = 0, i = 26; i >= 17; i--, k++) { const [bx, by] = P(i); poly.push([bx + up[0] * smooth[k], by + up[1] * smooth[k]]); }
  poly.snapped = snapped;
  poly.clipped = clipped; // forehead points stopped by the picture's (or cut-out's) edge, not hair: the forehead is at least that tall
  return poly;
}
