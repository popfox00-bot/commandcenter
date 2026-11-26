// Who's in a photo: each face found and described (face-api's face recognition, 128 numbers a face, on the
// phone: vendor/face), compared with the accounts' profile photos. A face close enough to one is that account
// (so a new post can make them collaborators by itself). The descriptions of profile photos are kept with
// their accounts (made once a photo). Nothing leaves the phone.

import { trackLoad } from '../../lib/diag.js';

let apiP = null;
function faceApi() {
  apiP ??= trackLoad('Face recognition (face-api)', (async () => {
    // (By its URL: the vendored bundle isn't ours to type-check.)
    const api = await import(new URL('../../vendor/face/face-api.esm.js', import.meta.url).href);
    const base = new URL('../../vendor/face/model/', import.meta.url).href;
    if (!api.tf.getBackend()) { try { await api.tf.setBackend('webgl'); } catch { await api.tf.setBackend('cpu'); } }
    await api.tf.ready();
    if (!api.nets.tinyFaceDetector.isLoaded) await api.nets.tinyFaceDetector.loadFromUri(base);
    if (!api.nets.faceLandmark68Net.isLoaded) await api.nets.faceLandmark68Net.loadFromUri(base);
    if (!api.nets.faceRecognitionNet.isLoaded) await api.nets.faceRecognitionNet.loadFromUri(base);
    return api;
  })());
  apiP.catch(() => { apiP = null; });
  return apiP;
}

/** A Blob (a photo) on a canvas at most `max` px across. */
async function canvasOf(blob, max = 720) {
  const bmp = await createImageBitmap(blob); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.(); return c;
}

/** The faces in a photo, each described: [{ box: [x, y, w, h] (0..1), size (0..1 of its width), d: number[128] }]. */
export async function facesIn(blob, { max = 720, minScore = 0.45 } = {}) {
  const api = await faceApi(); const c = await canvasOf(blob, max);
  const found = await api.detectAllFaces(c, new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: minScore })).withFaceLandmarks().withFaceDescriptors();
  return found.map((f) => { const b = f.detection.box; return { box: [b.x / c.width, b.y / c.height, b.width / c.width, b.height / c.height], size: b.width / c.width, d: Array.from(f.descriptor, (v) => Math.round(v * 10000) / 10000) }; });
}

/** A profile photo's face description (its biggest face), or null with none found. */
export async function faceOfAvatar(blob) {
  const faces = await facesIn(blob, { max: 480, minScore: 0.4 });
  return faces.length ? faces.reduce((a, b) => (b.size > a.size ? b : a)).d : null;
}

/** How far apart two face descriptions are (face-api's measure: under ~0.5, the same person). */
export function faceDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s);
}

/**
 * The accounts in a photo: for each face its closest account (by `known`: [{ id, d }]) if close enough
 * (`limit`), each account once, the closest first: [{ id, distance }].
 */
export function matchFaces(faces, known, limit = 0.5) {
  const hits = new Map();
  for (const f of faces ?? []) {
    let best = null; for (const k of known ?? []) { const dist = faceDistance(f.d, k.d); if (dist < limit && (!best || dist < best.distance)) best = { id: k.id, distance: dist }; }
    if (best && (!hits.has(best.id) || hits.get(best.id).distance > best.distance)) hits.set(best.id, best);
  }
  return [...hits.values()].sort((a, b) => a.distance - b.distance);
}
