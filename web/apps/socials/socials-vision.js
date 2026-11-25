// What's in a photo, read on the phone for Socials' comments and captions (offline once cached; nothing
// sent anywhere): what it shows (MediaPipe's image classifier, EfficientNet-Lite0: ImageNet's 1,000 kinds of
// thing, from a dog's breed to a pizza or a mountain), how many faces (the app's face finder), its light and
// colours (a sunset's warm sky, night, blue water, green, snow), and from the file's EXIF when and where it
// was taken (the nearest known place). Each part on its own: one that can't run is left out.

import { trackLoad } from '../../lib/diag.js';
import { readExif, readVideoMeta } from '../../lib/exif.js';
import { nearestPlace } from '../../lib/places.js';
import { toneFromPixels } from './socials-predict.js';
import { backgroundOf, outfitOf, posesOf, brandIn } from './socials-scene.js';

let classifier = null;
function imageClassifier() {
  classifier ??= trackLoad('Photo reader (MediaPipe)', (async () => {
    const base = new URL('../../vendor/mediapipe/', import.meta.url).href;
    // (By its URL: the vendored bundle isn't ours to type-check.)
    const { ImageClassifier } = await import(new URL('../../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href);
    return ImageClassifier.createFromOptions(
      { wasmLoaderPath: `${base}wasm/vision_wasm_internal.js`, wasmBinaryPath: `${base}wasm/vision_wasm_internal.wasm` },
      { baseOptions: { modelAssetPath: `${base}efficientnet_lite0_int8.tflite`, delegate: 'CPU' }, runningMode: 'IMAGE', maxResults: 8, scoreThreshold: 0.04 },
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

/** Text on clothes, read with Tesseract (vendor/tesseract; loaded the first time), for brand names. */
let ocr = null;
function reader() {
  ocr ??= trackLoad('Text reader (Tesseract)', (async () => {
    const base = new URL('../../vendor/tesseract/', import.meta.url).href;
    const mod = await import(new URL('../../vendor/tesseract/tesseract.esm.min.js', import.meta.url).href);
    const createWorker = mod.createWorker ?? mod.default?.createWorker;
    return createWorker('eng', 1, { workerPath: `${base}worker.min.js`, corePath: `${base}tesseract-core-simd-lstm.js`, langPath: `${base}lang/`, workerBlobURL: false, gzip: true });
  })());
  ocr.catch(() => { ocr = null; });
  return ocr;
}
const within = (p, ms) => Promise.race([p, new Promise((ok) => setTimeout(() => ok(null), ms))]);

/**
 * What a photo shows: { labels: [[name, score]] (best first), faces, people, poses, bg, outfit, brand, tone,
 * place, hour, taken }, each only when known. `image`: the photo (or a video frame); `file`: the file as
 * picked (for its EXIF); `brands`: read text on clothes for brand names (slower: a photo, not each frame).
 */
export async function readPhoto(image, { file = null, brands = true } = {}) {
  const out = {};
  if (file && /jpe?g/i.test(file.type || file.name || '')) {
    try { const x = readExif(await file.slice(0, 256 * 1024).arrayBuffer()); if (x.hour != null) out.hour = x.hour; if (x.taken) out.taken = x.taken; const pl = nearestPlace(x.lat, x.lon); if (pl) out.place = pl; } catch { /* no EXIF */ }
  }
  let c;
  try { c = await canvasOf(image); } catch { return out; }
  let px = null;
  try { px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; const t = toneFromPixels(px, c.width, c.height); if (t) out.tone = t; } catch { /* tainted */ }
  try {
    const res = (await imageClassifier()).classify(c);
    const cats = res.classifications?.[0]?.categories ?? [];
    out.labels = cats.map((k) => [String(k.categoryName || k.displayName || '').toLowerCase(), Math.round(k.score * 100) / 100]).filter(([n]) => n);
  } catch { /* the classifier couldn't run */ }
  try { const { detectFaces } = await import('../../lib/face.js'); out.faces = (await detectFaces(c)).length; } catch { /* no face finder */ }
  // (The people: how many, how they stand.)
  try { const { detectPoses } = await import('../../lib/pose.js'); const poses = await detectPoses(c); out.people = poses.length; const f = posesOf(poses, c.width, c.height); if (f.length) out.poses = f; } catch { /* no pose finder */ }
  // (Them apart from the background: what they wear, and what's behind them.)
  try {
    const { segmentPeople } = await import('../../lib/face-parts.js');
    const m = await segmentPeople(c, 256);
    if (m) {
      const s = document.createElement('canvas'); s.width = m.w; s.height = m.h; s.getContext('2d').drawImage(c, 0, 0, m.w, m.h);
      const sp = s.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, m.w, m.h).data;
      const person = new Uint8Array(m.w * m.h); for (let i = 0; i < person.length; i++) person[i] = Math.max(m.hair[i], m.face[i], m.body[i], m.clothes[i], m.others[i]);
      const bg = backgroundOf(sp, m.w, m.h, person); if (bg.length) out.bg = bg;
      const o = outfitOf(sp, m.w, m.h, m.clothes, m.body);
      if (o && (out.people || out.faces)) {
        out.outfit = { color: o.color, skin: o.skin };
        // (Brand names on what they wear: the clothes cut out, larger, read.)
        if (brands && o.area > 0.04) {
          const [x0, y0, x1, y1] = o.box; const W = c.width; const H = c.height;
          const cw = Math.max(1, Math.round((x1 - x0) * W)); const ch = Math.max(1, Math.round((y1 - y0) * H)); const k = Math.min(3, 900 / Math.max(cw, ch));
          const crop = document.createElement('canvas'); crop.width = Math.round(cw * k); crop.height = Math.round(ch * k);
          crop.getContext('2d').drawImage(c, x0 * W, y0 * H, cw, ch, 0, 0, crop.width, crop.height);
          const w = await within(reader(), 20000);
          const r = w ? await within(w.recognize(crop), 12000) : null;
          const b = brandIn(r?.data?.text ?? ''); if (b) out.brand = b;
        }
      }
    } else if (px) { const bg = backgroundOf(px, c.width, c.height, null); if (bg.length) out.bg = bg; }
  } catch { if (px && !out.bg) { const bg = backgroundOf(px, c.width, c.height, null); if (bg.length) out.bg = bg; } }
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
  const people = got.map((s) => s.people).filter(Number.isFinite); if (people.length) out.people = Math.max(...people);
  // (Poses and backgrounds seen in at least half of them; the outfit and brand from wherever they were.)
  const most = (key) => { const all = got.flatMap((s) => s[key] ?? []); return [...new Set(all)].filter((k) => all.filter((x) => x === k).length * 2 >= n); };
  const poses = most('poses'); if (poses.length) out.poses = poses;
  const bg = most('bg'); if (bg.length) out.bg = bg;
  const outfit = got.map((s) => s.outfit).find(Boolean); if (outfit) out.outfit = outfit;
  const brand = got.map((s) => s.brand).find(Boolean); if (brand) out.brand = brand;
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
  for (const [i, f] of frames.entries()) { try { parts.push(await readPhoto(f, { brands: i === Math.floor(frames.length / 2) })); } catch { /* that frame */ } }
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
