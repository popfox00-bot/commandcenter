// Photo Editor → FaceMask: a face cut out of the photo in one go, to keep as a Character. The head is
// traced with an oval from the face's eyes and mouth (faceOutline), brought in to the head's own
// edge by Cutout's smart edges, softened a little at the edge, and cropped to it.

import { faceOutline } from '../../lib/face-core.js';
import { smartEdge, featherAlpha, alphaBounds } from '../cutout/cutout-core.js';

const WORK = 720; // the edge is worked out at this size (long side), then used on the full picture

/** The face `face` (from detectFaces) cut out of `img` (a canvas): a canvas with a transparent background, or null. */
export function cutOutFace(img, face, { feather = 2 } = {}) {
  const W = img.width; const H = img.height;
  const k = Math.min(1, WORK / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)); const h = Math.max(1, Math.round(H * k));
  const work = document.createElement('canvas'); work.width = w; work.height = h;
  const wx = work.getContext('2d', { willReadFrequently: true }); wx.drawImage(img, 0, 0, w, h);
  const rgba = wx.getImageData(0, 0, w, h).data;
  // The oval around the head, as a mask.
  const oval = document.createElement('canvas'); oval.width = w; oval.height = h;
  const ox = oval.getContext('2d', { willReadFrequently: true });
  ox.fillStyle = '#000'; ox.beginPath();
  faceOutline(face, w, h).forEach(([u, v], i) => (i ? ox.lineTo(u * w, v * h) : ox.moveTo(u * w, v * h)));
  ox.closePath(); ox.fill();
  const od = ox.getImageData(0, 0, w, h).data;
  const inside = Uint8Array.from({ length: w * h }, (_, i) => (od[i * 4 + 3] > 127 ? 1 : 0));
  // In to the head's own edge (kept as traced when the head can't be told from what's behind it).
  const r = smartEdge(rgba, w, h, inside);
  const keep = r.tooMuch ? inside : r.keep;
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
  return crop;
}
