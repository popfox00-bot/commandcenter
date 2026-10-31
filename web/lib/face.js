// Finding faces in a photo, on the phone (vendor/face: face-api with TensorFlow.js; its tiny face
// detector and 68-point landmarks). Loaded the first time it's asked for; works offline.
// detectFaces(image) → faces as in face-core.js (box, eyes, mouth, nose, angle; 0..1 of the image).

import { faceFrom, dedupe, unturn } from './face-core.js';

let apiPromise = null;
function faceApi() {
  apiPromise ??= (async () => {
    const api = await import('../vendor/face/face-api.esm.js');
    const base = new URL('../vendor/face/model/', import.meta.url).href;
    try { await api.tf.setBackend('webgl'); } catch { await api.tf.setBackend('cpu'); }
    await api.tf.ready();
    await api.nets.tinyFaceDetector.loadFromUri(base);
    await api.nets.faceLandmark68Net.loadFromUri(base);
    return api;
  })();
  apiPromise.catch(() => { apiPromise = null; });
  return apiPromise;
}

/** A canvas of `img` turned `deg` clockwise (big enough for all of it), at most `max` px across. */
function turned(img, deg, max) {
  const w = img.width; const h = img.height;
  const k = Math.min(1, max / Math.max(w, h));
  const t = (deg * Math.PI) / 180; const c = Math.abs(Math.cos(t)); const s = Math.abs(Math.sin(t));
  const W = Math.round((w * c + h * s) * k); const H = Math.round((w * s + h * c) * k);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2); ctx.rotate(t); ctx.scale(k, k); ctx.drawImage(img, -w / 2, -h / 2);
  return cv;
}

/**
 * The faces in `img` (a canvas or an image), each with its points in 0..1 of `img`: found upright;
 * a tilted one read again with the picture turned its way (its eyes and mouth are placed better
 * when it's upright); a photo on its side or upside down (no face found upright) tried turned.
 */
export async function detectFaces(img, { max = 720, minScore = 0.45 } = {}) {
  const api = await faceApi();
  const opts = new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: minScore });
  /** The faces found with the picture turned `deg`, back in the unturned picture. */
  const pass = async (deg) => {
    const cv = turned(img, deg, max);
    const res = await api.detectAllFaces(cv, opts).withFaceLandmarks();
    const out = [];
    for (const r of res) {
      const pts = r.landmarks.positions.map((p) => [p.x, p.y]);
      const box = r.detection.box;
      let f = faceFrom({ x: box.x, y: box.y, width: box.width, height: box.height }, pts, cv.width, cv.height, r.detection.score);
      // Its eyes and mouth are only placed well when it's fairly upright in this try.
      if (Math.abs(f.angle) > 45) continue;
      f.tilt = Math.abs(f.angle);
      if (deg) {
        const back = (p) => unturn(p, deg, img.width, img.height);
        const corners = [[f.box.x, f.box.y], [f.box.x + f.box.w, f.box.y], [f.box.x, f.box.y + f.box.h], [f.box.x + f.box.w, f.box.y + f.box.h]].map(back);
        const xs = corners.map((p) => p[0]); const ys = corners.map((p) => p[1]);
        const eyes = f.eyes.map(back); const mouth = back(f.mouth);
        const angle = (Math.atan2((eyes[1][1] - eyes[0][1]) * img.height, (eyes[1][0] - eyes[0][0]) * img.width) * 180) / Math.PI;
        f = { ...f, eyes, mouth, nose: back(f.nose), angle, box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) } };
      }
      out.push(f);
    }
    return out;
  };
  const center = (f) => [f.box.x + f.box.w / 2, f.box.y + f.box.h / 2];
  const same = (f, g) => Math.hypot(center(f)[0] - center(g)[0], center(f)[1] - center(g)[1]) < Math.max(f.box.w, f.box.h) * 0.6;
  let faces = dedupe(await pass(0));
  if (!faces.length) {
    // On its side, or upside down: the turn that finds the surest faces.
    let best = [];
    for (const deg of [90, -90, 180]) {
      const got = (await pass(deg)).filter((f) => f.score >= 0.6);
      if (got.length && (!best.length || Math.max(...got.map((f) => f.score)) > Math.max(...best.map((f) => f.score)))) best = got;
    }
    return dedupe(best);
  }
  // Tilted faces: read again turned their way, for better-placed eyes and mouth.
  for (const dir of [-1, 1]) {
    if (!faces.some((f) => f.tilt > 12 && Math.sign(f.angle) === dir)) continue;
    const again = await pass(-35 * dir);
    faces = faces.map((f) => {
      if (f.tilt <= 12 || Math.sign(f.angle) !== dir) return f;
      const g = again.find((x) => same(f, x) && x.tilt < f.tilt);
      return g ? { ...g, score: Math.max(g.score, f.score) } : f;
    });
  }
  return faces;
}
