// @ts-check
// What's what around a face, pixel by pixel, on the phone (vendor/mediapipe: MediaPipe's multiclass
// selfie segmenter, run by WebAssembly; offline once cached): how sure it is each pixel is hair, and
// face skin. For FM: the Character's own face only (not its hair, the background, a flower behind an
// ear), and the hair of the face it goes on kept in front of it (bangs, a strand across the forehead).
// Loaded the first time it's asked for.

import { trackLoad } from './diag.js';

let segmenter = null;
function imageSegmenter() {
  segmenter ??= trackLoad('Face-part maps (MediaPipe)', (async () => {
    const base = new URL('../vendor/mediapipe/', import.meta.url).href;
    // (By its URL: the vendored bundle isn't ours to type-check.)
    const { ImageSegmenter } = await import(new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href);
    return ImageSegmenter.createFromOptions(
      { wasmLoaderPath: `${base}wasm/vision_wasm_internal.js`, wasmBinaryPath: `${base}wasm/vision_wasm_internal.wasm` },
      { baseOptions: { modelAssetPath: `${base}selfie_multiclass_256x256.tflite`, delegate: 'CPU' }, runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true },
    );
  })());
  segmenter.catch(() => { segmenter = null; });
  return segmenter;
}

/** Its classes, in the model's order (its model card). */
const CLASSES = ['background', 'hair', 'body', 'face', 'clothes', 'others'];

/**
 * The parts of `img` (a canvas or an image), worked out at most `max` px across: { w, h, hair, face }
 * (`hair`, `face`: 0..255 how sure, w×h, over the whole picture at that size).
 */
export async function segmentParts(img, max = 768) {
  const s = await imageSegmenter();
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)); const h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  const res = s.segment(c);
  try {
    const masks = res.confidenceMasks ?? [];
    const take = (name) => {
      const m = masks[CLASSES.indexOf(name)]; if (!m) return null;
      const f = m.getAsFloat32Array(); const out = new Uint8Array(w * h);
      // (The mask is the picture's size; if not, sampled to it.)
      const mw = m.width; const mh = m.height;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.round(255 * f[Math.min(mh - 1, Math.floor((y * mh) / h)) * mw + Math.min(mw - 1, Math.floor((x * mw) / w))]);
      return out;
    };
    const hair = take('hair'); const face = take('face');
    if (!hair || !face) return null;
    return { w, h, hair, face };
  } finally { res.close?.(); }
}
