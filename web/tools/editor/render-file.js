// Render a photo file with an edit state at full resolution, on this device: used by the editor's
// export and by bulk edits. Optional per-photo steps run on the full-size image first:
// Auto-Crop (find color bars) and auto-enhance (from the photo's own histogram).

import { sniffType, decodeImage, fitSize, drawToCanvas } from '../../lib/image.js';
import { Renderer } from './renderer.js';
import { defaultState, autoAdjust } from './state.js';
import { orientedSize, outputPixelSize, cropForRatio } from './geometry.js';
import { viewTransform, drawMarkup } from './markup.js';
import { detectAutoCrop } from './autocrop.js';

/**
 * renderEdited(file, state, { maxEdge, autoCrop: {color,...} | null, autoEnhance, ratio })
 * -> { canvas, state, notes: [string] }  (`state` is the one actually used, e.g. with the found crop)
 * `ratio` (w/h) crops to that shape, centered inside the (auto-)cropped area.
 */
export async function renderEdited(file, state, { maxEdge = 0, autoCrop = null, autoEnhance = false, ratio = null } = {}) {
  const bitmap = await decodeImage(file, await sniffType(file));
  const canvas = document.createElement('canvas');
  const r = new Renderer(canvas);
  const notes = [];
  try {
    const srcFit = fitSize(bitmap.width, bitmap.height, r.maxTexture);
    r.setSource(srcFit.scale < 1 ? drawToCanvas(bitmap, srcFit.width, srcFit.height, null) : bitmap);
    const prepared = prepareState(r, state, { autoCrop, autoEnhance, ratio });
    const s = prepared.state;
    notes.push(...prepared.notes);
    const full = outputPixelSize(s, r.srcW, r.srcH);
    let out = fitSize(full.width, full.height, Math.min(maxEdge || Infinity, r.maxTexture));
    r.render(s, out.width, out.height);
    // Browsers may give a smaller drawing buffer than asked for on huge canvases.
    const { drawingBufferWidth: dbw, drawingBufferHeight: dbh } = r.gl;
    if (dbw < out.width || dbh < out.height) {
      const k = Math.min(dbw / out.width, dbh / out.height);
      out = { width: Math.floor(out.width * k), height: Math.floor(out.height * k) };
      r.render(s, out.width, out.height);
    }
    const final = document.createElement('canvas');
    final.width = out.width; final.height = out.height;
    const ctx = final.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const { W, H } = orientedSize(r.srcW, r.srcH, s.rotate);
    drawMarkup(ctx, s.markup, viewTransform({ crop: s.crop, W, H, tw: out.width, th: out.height }));
    return { canvas: final, state: s, notes };
  } finally {
    bitmap.close?.();
    r.destroy();
  }
}

/**
 * The per-photo steps, run on the photo loaded in renderer `r`: Auto-Crop finds this photo's bars,
 * `ratio` (w/h) then crops to that shape centered in what's left, and auto-enhance reads this photo's
 * histogram. Returns { state, notes }.
 */
export function prepareState(r, state, { autoCrop = null, autoEnhance = false, ratio = null } = {}) {
  const notes = [];
  let s = state;
  if (autoCrop) {
    const found = detectAutoCrop(r, s, autoCrop);
    if (found.crop) s = { ...s, crop: found.crop };
    notes.push(found.note);
  }
  if (ratio) {
    const { W, H } = orientedSize(r.srcW, r.srcH, s.rotate);
    const inner = cropForRatio(ratio, s.crop.w * W, s.crop.h * H);
    s = { ...s, crop: { x: s.crop.x + inner.x * s.crop.w, y: s.crop.y + inner.y * s.crop.h, w: inner.w * s.crop.w, h: inner.h * s.crop.h } };
  }
  if (autoEnhance) {
    const out = outputPixelSize(s, r.srcW, r.srcH);
    const w = Math.min(160, out.width);
    r.render({ ...s, adjust: defaultState().adjust, filter: 'original' }, w, Math.max(1, Math.round(out.height * (w / out.width))));
    s = { ...s, adjust: { ...s.adjust, ...autoAdjust(r.readPixels()) } };
    notes.push('Auto-enhanced');
  }
  return { state: s, notes };
}

/** Load a file into a renderer at full resolution (for Auto-Crop in the open editor). */
export async function loadFullRenderer(file) {
  const bitmap = await decodeImage(file, await sniffType(file));
  const r = new Renderer(document.createElement('canvas'));
  const srcFit = fitSize(bitmap.width, bitmap.height, r.maxTexture);
  r.setSource(srcFit.scale < 1 ? drawToCanvas(bitmap, srcFit.width, srcFit.height, null) : bitmap);
  bitmap.close?.();
  return r;
}
