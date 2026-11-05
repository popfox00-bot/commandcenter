// FaceMask's fitting, by the face-part maps (lib/face-parts.js: what's hair, what's face skin): the Character's
// own face only (keepOwnFace), and that face's hair kept in front of it (hairInFront). Pure.

import { convexHull as hull, fillPolygon, scalePolygon as grow, softenMask as soften } from '../../lib/geometry.js';

/** How sure `parts` (face-parts.js: { w, h, hair, face }) is of `key` at (u, v), 0..1 of the picture: 0..1, smoothly between its pixels. */
function partAt(parts, key, u, v) {
  const x = Math.min(parts.w - 1, Math.max(0, u * parts.w - 0.5)); const y = Math.min(parts.h - 1, Math.max(0, v * parts.h - 0.5));
  const i0 = Math.floor(x); const j0 = Math.floor(y); const i1 = Math.min(parts.w - 1, i0 + 1); const j1 = Math.min(parts.h - 1, j0 + 1); const fx = x - i0; const fy = y - j0;
  const m = parts[key]; const at = (i, j) => m[j * parts.w + i];
  return ((at(i0, j0) * (1 - fx) + at(i1, j0) * fx) * (1 - fy) + (at(i0, j1) * (1 - fx) + at(i1, j1) * fx) * fy) / 255;
}

/**
 * A Character's own face only, by its face-part map (`parts`, of the same picture): what's face skin, and
 * its eyes, brows, nose and mouth (by its landmarks, with room: the map can miss a dark eye or open
 * mouth), kept; its hair, the background and anything else in its border (a flower behind an ear) made
 * see-through, with a soft edge. A copy ({ rgba, w, h }).
 */
export function keepOwnFace(img, parts, charFace = null) {
  const { rgba, w, h } = img; const out = Uint8ClampedArray.from(rgba);
  const feat = charFace?.pts?.length === 68 ? fillPolygon(grow(hull(charFace.pts.slice(17).map(([u, v]) => [u * w, v * h])), 1.08), 0, 0, w, h) : null;
  const keep = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x; const f = partAt(parts, 'face', (x + 0.5) / w, (y + 0.5) / h);
    keep[k] = Math.max(feat?.[k] ?? 0, Math.max(0, Math.min(1, (f - 0.2) / 0.5)));
  }
  const soft = soften(keep, w, h, Math.max(1, Math.round(Math.max(w, h) / 300)));
  for (let k = 0; k < w * h; k++) out[k * 4 + 3] = Math.round(out[k * 4 + 3] * Math.min(1, soft[k] * 1.15));
  return { rgba: out, w, h };
}

/**
 * The hair of the face it goes on kept in front of the Character (bangs, a strand across the forehead or
 * cheek), by that photo's face-part map (`parts`, of the W×H photo): the patch see-through there, as sure
 * as the map is. In place; returns the patch.
 */
export function hairInFront(patch, parts, W, H) {
  const { x0, y0, pw, ph, rgba } = patch;
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const k = y * pw + x; if (!rgba[k * 4 + 3]) continue;
    const hair = partAt(parts, 'hair', (x0 + x + 0.5) / W, (y0 + y + 0.5) / H);
    if (hair > 0.25) rgba[k * 4 + 3] = Math.round(rgba[k * 4 + 3] * Math.max(0, 1 - (hair - 0.25) / 0.45));
  }
  return patch;
}
