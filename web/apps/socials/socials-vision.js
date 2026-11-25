// What's in a photo, read on the phone for Socials' comments and captions (offline once cached; nothing
// sent anywhere): what it shows (MediaPipe's image classifier, EfficientNet-Lite0: ImageNet's 1,000 kinds of
// thing, from a dog's breed to a pizza or a mountain), how many faces (the app's face finder), its light and
// colours (a sunset's warm sky, night, blue water, green, snow), and from the file's EXIF when and where it
// was taken (the nearest known place). Each part on its own: one that can't run is left out.

import { trackLoad } from '../../lib/diag.js';
import { readExif } from '../../lib/exif.js';
import { nearestPlace } from '../../lib/places.js';
import { toneFromPixels } from './socials-predict.js';

let classifier = null;
function imageClassifier() {
  classifier ??= trackLoad('Photo reader (MediaPipe)', (async () => {
    const base = new URL('../../vendor/mediapipe/', import.meta.url).href;
    // (By its URL: the vendored bundle isn't ours to type-check.)
    const { ImageClassifier } = await import(new URL('../../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href);
    return ImageClassifier.createFromOptions(
      { wasmLoaderPath: `${base}wasm/vision_wasm_internal.js`, wasmBinaryPath: `${base}wasm/vision_wasm_internal.wasm` },
      { baseOptions: { modelAssetPath: `${base}efficientnet_lite0_int8.tflite`, delegate: 'CPU' }, runningMode: 'IMAGE', maxResults: 5, scoreThreshold: 0.06 },
    );
  })());
  classifier.catch(() => { classifier = null; });
  return classifier;
}

/** A Blob (a photo) drawn on a canvas at most `max` px across. */
async function canvasOf(blob, max = 640) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  return c;
}

/**
 * What a photo shows: { labels: [[name, score]] (best first), faces, tone, place, hour, taken }, each only when
 * known. `image`: the photo (or a video's still); `file`: the file as picked (for its EXIF), when there is one.
 */
export async function readPhoto(image, { file = null } = {}) {
  const out = {};
  if (file && /jpe?g/i.test(file.type || file.name || '')) {
    try { const x = readExif(await file.slice(0, 256 * 1024).arrayBuffer()); if (x.hour != null) out.hour = x.hour; if (x.taken) out.taken = x.taken; const pl = nearestPlace(x.lat, x.lon); if (pl) out.place = pl; } catch { /* no EXIF */ }
  }
  let c;
  try { c = await canvasOf(image); } catch { return out; }
  try { const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const t = toneFromPixels(px, c.width, c.height); if (t) out.tone = t; } catch { /* tainted */ }
  try {
    const res = (await imageClassifier()).classify(c);
    const cats = res.classifications?.[0]?.categories ?? [];
    out.labels = cats.map((k) => [String(k.categoryName || k.displayName || '').toLowerCase(), Math.round(k.score * 100) / 100]).filter(([n]) => n);
  } catch { /* the classifier couldn't run */ }
  try { const { detectFaces } = await import('../../lib/face.js'); out.faces = (await detectFaces(c)).length; } catch { /* no face finder */ }
  return out;
}
