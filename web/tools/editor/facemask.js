// Photo Editor → FaceMask: a face cut out of the photo in one go, to keep as a Character: just the
// face itself, along its own outline from its landmarks (the jaw from ear to ear and a forehead line
// just above the brows: no hair, ears or background), its edge softened a little, cropped to it.
// When the landmarks don't make a face shape, the head's oval brought in by smart edges instead.

import { faceOutline, faceContour } from '../../lib/face-core.js';
import { smartEdge, featherAlpha, alphaBounds } from '../cutout/cutout-core.js';
import { toLab } from './cleanup.js';

const WORK = 720; // the edge is worked out at this size (long side), then used on the full picture

/** The face `face` (from detectFaces) cut out of `img` (a canvas): a canvas with a transparent background, or null. */
export function cutOutFace(img, face, { feather = 2 } = {}) {
  const W = img.width; const H = img.height;
  const k = Math.min(1, WORK / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)); const h = Math.max(1, Math.round(H * k));
  const work = document.createElement('canvas'); work.width = w; work.height = h;
  const wx = work.getContext('2d', { willReadFrequently: true }); wx.drawImage(img, 0, 0, w, h);
  const rgba = wx.getImageData(0, 0, w, h).data;
  // The face's own outline (or, failing that, the oval around the head), as a mask.
  const contour = faceContour(face, w, h);
  const oval = document.createElement('canvas'); oval.width = w; oval.height = h;
  const ox = oval.getContext('2d', { willReadFrequently: true });
  ox.fillStyle = '#000'; ox.beginPath();
  (contour ?? faceOutline(face, w, h).map(([u, v]) => [u * w, v * h])).forEach(([x, y], i) => (i ? ox.lineTo(x, y) : ox.moveTo(x, y)));
  ox.closePath(); ox.fill();
  const od = ox.getImageData(0, 0, w, h).data;
  const inside = Uint8Array.from({ length: w * h }, (_, i) => (od[i * 4 + 3] > 127 ? 1 : 0));
  // The outline already follows the face; the oval is brought in to the head's own edge.
  let keep = inside;
  if (!contour) { const r = smartEdge(rgba, w, h, inside); keep = r.tooMuch ? inside : r.keep; } else keep = noFringe(rgba, w, h, inside, face);
  feather = Math.max(feather, Math.round(face.box.h * h * 0.02));
  const mask = ox.createImageData(w, h);
  for (let i = 0; i < w * h; i++) if (keep[i]) mask.data[i * 4 + 3] = 255;
  featherAlpha(mask.data, w, h, feather);
  ox.clearRect(0, 0, w, h); ox.putImageData(mask, 0, 0);
  // The full picture through the mask (scaled up smoothly), cropped to what's left.
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const cx = out.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  cx.globalCompositeOperation = 'destination-in';
  cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
  cx.drawImage(oval, 0, 0, W, H);
  const b = alphaBounds(cx.getImageData(0, 0, W, H).data, W, H);
  if (!b) return null;
  const crop = document.createElement('canvas'); crop.width = b.width; crop.height = b.height;
  crop.getContext('2d').drawImage(out, b.x, b.y, b.width, b.height, 0, 0, b.width, b.height);
  crop.face = faceInCrop(face, W, H, b);
  return crop;
}

/**
 * The face's points (eyes, mouth, nose, box, all 68 landmarks) moved into the cut's own picture, a
 * crop of a W×H one at (x, y, width × height): kept with the Character, so it's fitted onto faces by
 * its real features (not found again on a tight crop, where finding faces is unreliable).
 */
export function faceInCrop(face, W, H, { x, y, width, height }) {
  const m = ([u, v]) => [(u * W - x) / width, (v * H - y) / height];
  return {
    eyes: face.eyes.map(m), mouth: m(face.mouth), nose: m(face.nose), angle: face.angle, score: face.score,
    box: { x: (face.box.x * W - x) / width, y: (face.box.y * H - y) / height, w: (face.box.w * W) / width, h: (face.box.h * H) / height },
    size: face.size, pts: face.pts?.map(m),
  };
}

/**
 * The forehead without a fringe: above the brows, what isn't skin-colored (hair coming down over the
 * forehead) is left out. The skin is judged from the face's own cheeks and nose (between the eyes and
 * the mouth); anything above the brow line much further from it than the skin itself varies goes.
 */
function noFringe(rgba, w, h, inside, face) {
  const P = (i) => [face.pts[i][0] * w, face.pts[i][1] * h];
  const brow = [(P(19)[0] + P(24)[0]) / 2, (P(19)[1] + P(24)[1]) / 2]; const chin = P(8);
  const up = [brow[0] - chin[0], brow[1] - chin[1]]; const len = Math.hypot(...up) || 1;
  const u = [up[0] / len, up[1] / len];
  const along = (x, y) => (x - brow[0]) * u[0] + (y - brow[1]) * u[1]; // > 0: above the brows
  // The skin: inside the face, between the eyes and the mouth.
  const eyeY = along(...P(27)); const mouthY = along(...P(51));
  const labs = [];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const i = y * w + x; if (!inside[i]) continue;
    const a = along(x, y); if (a > eyeY || a < mouthY) continue;
    labs.push(toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]));
  }
  if (labs.length < 20) return inside;
  const mean = [0, 1, 2].map((c) => labs.reduce((s, l) => s + l[c], 0) / labs.length);
  const sd = Math.sqrt(labs.reduce((s, l) => s + (l[0] - mean[0]) ** 2 * 0.5 + (l[1] - mean[1]) ** 2 + (l[2] - mean[2]) ** 2, 0) / labs.length);
  const limit = Math.max(16, sd * 2.5);
  const out = Uint8Array.from(inside);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!inside[i] || along(x, y) <= 0) continue;
    const l = toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    if (Math.sqrt((l[0] - mean[0]) ** 2 * 0.5 + (l[1] - mean[1]) ** 2 + (l[2] - mean[2]) ** 2) > limit) out[i] = 0;
  }
  return out;
}
