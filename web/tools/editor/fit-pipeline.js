// @ts-check
// A Character fitted onto a face in a photo, all of it (see facefit.js for each step): placed by its
// features and turned to that face's pose, trimmed to its outline, recolored and relit to its skin, its
// texture matched, blended in both ways, and that face's hair kept in front. Pure, so it can run off the
// page's thread (fit-worker.js) as well as on it.

import { fitPatch, blendIn, recolor, relight, shadeByShape, keepSkinTexture, matchTexture, hairInFront, targetOutline, skinModel } from './facefit.js';
import { cleanUp } from './cleanup.js';
import { inPolygon, convexHull, scalePolygon } from '../../lib/geometry.js';

/**
 * Nothing of the old face left showing: where the face it goes on has its own eyes, brows and mouth (with
 * room around them) and the Character doesn't fully cover them (at its soft edge, on a turned head: the
 * corner of the old mouth beside the new one), they're filled in first with that face's skin around them
 * (as Clean Up fills, from the photo), under the Character. Not where it was brushed "less" (the photo is
 * to show there). In place on the patch.
 */
function hideOldFeatures(patch, photo, W, H, face, paint) {
  if (face.pts?.length !== 68) return;
  const { x0, y0, pw, ph, rgba } = patch;
  const P = face.pts.map(([u, v]) => [u * W, v * H]);
  const regions = [scalePolygon(convexHull(P.slice(48, 60)), 1.3), scalePolygon(convexHull(P.slice(36, 42)), 1.6), scalePolygon(convexHull(P.slice(42, 48)), 1.6), scalePolygon(convexHull(P.slice(17, 22)), 1.35), scalePolygon(convexHull(P.slice(22, 27)), 1.35)];
  const less = (paint ?? []).filter((st) => !st.add);
  const brushedLess = (x, y) => less.some((st) => st.pts.some((q) => Math.hypot(q[0] - x, q[1] - y) <= st.r));
  const hole = new Uint8Array(W * H); let bx0 = W; let by0 = H; let bx1 = 0; let by1 = 0; let any = false;
  for (const poly of regions) {
    const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
    const rx0 = Math.max(0, Math.floor(Math.min(...xs))); const rx1 = Math.min(W, Math.ceil(Math.max(...xs)));
    const ry0 = Math.max(0, Math.floor(Math.min(...ys))); const ry1 = Math.min(H, Math.ceil(Math.max(...ys)));
    // Only where some of it shows (not where the Character covers it all: nothing to do).
    let n = 0; let shows = 0; const px = [];
    for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
      if (!inPolygon(poly, x + 0.5, y + 0.5)) continue; n++; px.push(y * W + x);
      const X = x - x0; const Y = y - y0; const a = X >= 0 && Y >= 0 && X < pw && Y < ph ? rgba[(Y * pw + X) * 4 + 3] : 0;
      if (a < 235) shows++;
    }
    if (!n || shows < Math.max(6, n * 0.03)) continue;
    for (const i of px) { const x = i % W; const y = (i / W) | 0; if (brushedLess(x, y)) continue; hole[i] = 1; any = true; if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (x >= bx1) bx1 = x + 1; if (y >= by1) by1 = y + 1; }
  }
  if (!any) return;
  const fill = cleanUp(photo, W, H, hole, { x0: bx0, y0: by0, x1: bx1, y1: by1 });
  if (!fill) return;
  // Under the Character: its own pixels over the fill, as much as it covers there.
  for (let y = 0; y < fill.ph; y++) for (let x = 0; x < fill.pw; x++) {
    const fo = (y * fill.pw + x) * 4; const fa = fill.rgba[fo + 3]; if (!fa) continue;
    const X = fill.x0 + x - x0; const Y = fill.y0 + y - y0; if (X < 0 || Y < 0 || X >= pw || Y >= ph) continue;
    const o = (Y * pw + X) * 4; const a = rgba[o + 3] / 255; const f = fa / 255;
    // (Where the patch shows the photo itself, its pixels are the photo's: the fill takes their place.)
    for (let c = 0; c < 3; c++) rgba[o + c] = a * rgba[o + c] + (1 - a) * fill.rgba[fo + c];
    rgba[o + 3] = Math.round(255 * (a + (1 - a) * f));
  }
}

/**
 * The patch ({ x0, y0, pw, ph, rgba }, or null) for Character `img` ({ rgba, w, h }, its face `charFace`)
 * on `face` of `photo` (RGBA W×H). `face.outline` and `face.skin` are worked out (and kept on it) if it
 * hasn't them. opts: { trim, blend (0–100), tune, paint, parts, turn3d, mouth } (turned in 3D to its pose,
 * its mouth closed or opened to match: both off unless asked for, as each can look forced).
 * @param {Uint8ClampedArray} photo @param {number} W @param {number} H
 * @param {import('./fit-types.js').Pixels} img @param {import('./fit-types.js').Face} charFace
 * @param {import('./fit-types.js').Face} face @param {import('./fit-types.js').FitOptions} [opts]
 * @returns {import('./fit-types.js').Patch | null}
 */
export function buildFitted(photo, W, H, img, charFace, face, { trim = true, blend = 70, tune = null, paint = null, parts = null, turn3d = false, mouth = false } = {}) {
  face.outline ??= targetOutline(photo, W, H, face);
  face.skin ??= skinModel(photo, W, H, face);
  const outline = face.outline; const s = blend / 100;
  const patch = fitPatch(img.rgba, img.w, img.h, charFace, face, W, H, { trim, outline: trim ? outline : null, bend: 0.35, photo, tune, paint, turn3d, mouth });
  if (!patch) return null;
  if (outline) { recolor(patch, photo, W, H, outline, s, face); relight(patch, photo, W, H, face, outline, s); shadeByShape(patch, photo, W, H, face, outline, s); keepSkinTexture(patch, photo, W, H, face, outline, s); matchTexture(patch, photo, W, H, face, outline, s); }
  // Nothing of the old face's eyes, brows or mouth left showing past the new one (before the blend,
  // which brings the photo's own pixels in around it).
  hideOldFeatures(patch, photo, W, H, face, paint);
  // Blended both ways at the border: the Character toward the photo's skin there, and what's left of that
  // face (up to its hairline, out to its jaw) toward the Character, meeting halfway; the difference at its
  // edge carried smoothly across all of it (as a gradient-domain blend does: its own detail kept, that
  // face's light and color taken on), not just a band at the border.
  const faceW = face.box.w * W;
  blendIn(patch, photo, W, H, s, { soft: Math.max(2, Math.round(faceW * 0.015)), band: 0, region: outline, spread: outline ? Math.max(8, Math.round(faceW * 0.6)) : 0, skin: face.skin });
  // That face's hair (bangs, a strand across it) kept in front.
  if (parts) hairInFront(patch, parts, W, H);
  return patch;
}
