// A Character fitted onto a face in a photo, all of it (see facefit.js for each step): placed by its
// features and turned to that face's pose, trimmed to its outline, recolored and relit to its skin, its
// texture matched, blended in both ways, and that face's hair kept in front. Pure, so it can run off the
// page's thread (fit-worker.js) as well as on it.

import { fitPatch, blendIn, recolor, relight, keepSkinTexture, matchTexture, hairInFront, targetOutline, skinModel } from './facefit.js';

/**
 * The patch ({ x0, y0, pw, ph, rgba }, or null) for Character `img` ({ rgba, w, h }, its face `charFace`)
 * on `face` of `photo` (RGBA W×H). `face.outline` and `face.skin` are worked out (and kept on it) if it
 * hasn't them. opts: { trim, blend (0–100), tune, paint, parts }.
 */
export function buildFitted(photo, W, H, img, charFace, face, { trim = true, blend = 70, tune = null, paint = null, parts = null } = {}) {
  face.outline ??= targetOutline(photo, W, H, face);
  face.skin ??= skinModel(photo, W, H, face);
  const outline = face.outline; const s = blend / 100;
  const patch = fitPatch(img.rgba, img.w, img.h, charFace, face, W, H, { trim, outline: trim ? outline : null, bend: 0.35, photo, tune, paint });
  if (!patch) return null;
  if (outline) { recolor(patch, photo, W, H, outline, s, face); relight(patch, photo, W, H, face, outline, s); keepSkinTexture(patch, photo, W, H, face, outline, s); matchTexture(patch, photo, W, H, face, outline, s); }
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
