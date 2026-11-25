// What's in a photo, read on the phone for Socials' comments and captions (offline once cached; nothing
// sent anywhere): what it shows (MediaPipe's image classifier, EfficientNet-Lite0: ImageNet's 1,000 kinds of
// thing, from a dog's breed to a pizza or a mountain), how many faces (the app's face finder), its light and
// colours (a sunset's warm sky, night, blue water, green, snow), and from the file's EXIF when and where it
// was taken (the nearest known place). Each part on its own: one that can't run is left out.

import { trackLoad } from '../../lib/diag.js';
import { readExif, readVideoMeta } from '../../lib/exif.js';
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

/** Labels, faces and tones read from several frames made one: what's seen most and most surely (pure). */
export function mergeScenes(list) {
  const got = list.filter(Boolean); if (!got.length) return {};
  const out = {}; const n = got.length;
  const lab = new Map();
  for (const s of got) for (const [name, k] of s.labels ?? []) { const was = lab.get(name) ?? { max: 0, count: 0 }; lab.set(name, { max: Math.max(was.max, k), count: was.count + 1 }); }
  // (Seen in more of them: surer. Seen once among many: less so.)
  const labels = [...lab].map(([name, { max, count }]) => [name, Math.round(max * (0.6 + (0.4 * count) / n) * 100) / 100]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (labels.length) out.labels = labels;
  const faces = got.map((s) => s.faces).filter(Number.isFinite); if (faces.length) out.faces = Math.max(...faces);
  const tones = got.map((s) => s.tone).filter(Boolean); const top = tones.sort((a, b) => tones.filter((x) => x === b).length - tones.filter((x) => x === a).length)[0];
  if (top && tones.filter((x) => x === top).length * 2 >= n) out.tone = top;
  return out;
}

/**
 * What a video shows, from several of its frames (`frames`: Blobs; read one by one) and its file's own record
 * of when and where (`file`): as readPhoto.
 */
export async function readVideo(frames, { file = null } = {}) {
  const parts = [];
  for (const f of frames) { try { parts.push(await readPhoto(f)); } catch { /* that frame */ } }
  const out = mergeScenes(parts);
  if (file) {
    try {
      const size = file.size ?? 0; const head = await file.slice(0, 512 * 1024).arrayBuffer(); const tail = size > 512 * 1024 ? await file.slice(Math.max(512 * 1024, size - 512 * 1024)).arrayBuffer() : null;
      const x = readVideoMeta(head, tail);
      if (x.hour != null) out.hour = x.hour; if (x.taken) out.taken = x.taken; const pl = nearestPlace(x.lat, x.lon); if (pl) out.place = pl;
    } catch { /* no record */ }
  }
  return out;
}
