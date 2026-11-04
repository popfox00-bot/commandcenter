// Photo Editor → FaceMask: a face cut out of the photo in one go, to keep as a Character, with a
// generous border so none of its detail is lost: its own outline from its landmarks (the jaw from ear
// to ear, the forehead up toward the hairline) widened all round, its edge softened, cropped to it.
// It's trimmed to fit when it's put on another face (along that face's own jaw and hairline). When the
// landmarks don't make a face shape, the head's oval brought in by smart edges instead.

import { faceOutline, faceContour } from '../../lib/face-core.js';
import { smartEdge, featherAlpha, alphaBounds } from '../cutout/cutout-core.js';

const WORK = 720; // the edge is worked out at this size (long side), then used on the full picture

/** The face `face` (from detectFaces) cut out of `img` (a canvas): a canvas with a transparent background, or null. */
export function cutOutFace(img, face, { feather = 2, margin = 0.15 } = {}) {
  const W = img.width; const H = img.height;
  const k = Math.min(1, WORK / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)); const h = Math.max(1, Math.round(H * k));
  const work = document.createElement('canvas'); work.width = w; work.height = h;
  const wx = work.getContext('2d', { willReadFrequently: true }); wx.drawImage(img, 0, 0, w, h);
  const rgba = wx.getImageData(0, 0, w, h).data;
  // The face's own outline (or, failing that, the oval around the head), as a mask.
  // The face's outline raised well up the forehead, then widened by `margin` around its middle.
  const raw = faceContour(face, w, h, { forehead: 0.55 });
  let contour = null;
  if (raw) {
    const cx = raw.reduce((t, p) => t + p[0], 0) / raw.length; const cy = raw.reduce((t, p) => t + p[1], 0) / raw.length;
    contour = raw.map(([x, y]) => [cx + (x - cx) * (1 + margin), cy + (y - cy) * (1 + margin)]);
  }
  const oval = document.createElement('canvas'); oval.width = w; oval.height = h;
  const ox = oval.getContext('2d', { willReadFrequently: true });
  ox.fillStyle = '#000'; ox.beginPath();
  (contour ?? faceOutline(face, w, h).map(([u, v]) => [u * w, v * h])).forEach(([x, y], i) => (i ? ox.lineTo(x, y) : ox.moveTo(x, y)));
  ox.closePath(); ox.fill();
  const od = ox.getImageData(0, 0, w, h).data;
  const inside = Uint8Array.from({ length: w * h }, (_, i) => (od[i * 4 + 3] > 127 ? 1 : 0));
  // The outline already follows the face; the oval is brought in to the head's own edge.
  let keep = inside;
  if (!contour) { const r = smartEdge(rgba, w, h, inside); keep = r.tooMuch ? inside : r.keep; }
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

