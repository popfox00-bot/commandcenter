// A person's pose, on the phone (vendor/mediapipe: MediaPipe's Pose Landmarker (lite), run by
// WebAssembly; offline once cached): where their shoulders, elbows, wrists and hips are. For Fashion: an
// arm told from the body it's beside (a sleeve against a jacket's side), whatever the arms are doing.
// Loaded the first time it's asked for.

import { trackLoad } from './diag.js';

let landmarker = null;
function poseLandmarker() {
  landmarker ??= trackLoad('Body pose (MediaPipe)', (async () => {
    const base = new URL('../vendor/mediapipe/', import.meta.url).href;
    // (By its URL: the vendored bundle isn't ours to type-check.)
    const { PoseLandmarker } = await import(new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href);
    return PoseLandmarker.createFromOptions(
      { wasmLoaderPath: `${base}wasm/vision_wasm_internal.js`, wasmBinaryPath: `${base}wasm/vision_wasm_internal.wasm` },
      { baseOptions: { modelAssetPath: `${base}pose_landmarker_lite.task`, delegate: 'CPU' }, runningMode: 'IMAGE', numPoses: 8, minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4 },
    );
  })());
  landmarker.catch(() => { landmarker = null; });
  return landmarker;
}

/**
 * The pose of each person in `img` (a canvas or an image), in its pixels, left to right of the picture:
 * [{ shoulders: [a, b], elbows, wrists, hips, knees, ankles, nose }] (each [x, y, seen 0..1]; the two of a
 * pair in the order of the picture, so [0] is on the picture's left). [] when there's no one.
 */
export async function detectPoses(img) {
  const lm = await poseLandmarker();
  const W = img.width; const H = img.height;
  const res = lm.detect(img);
  const out = (res.landmarks ?? []).map((pts) => {
    const P = (i) => [pts[i].x * W, pts[i].y * H, pts[i].visibility ?? 1];
    // (MediaPipe's odd points are the person's left, the even their right: 11/12 shoulders, 13/14 elbows,
    // 15/16 wrists, 23/24 hips, 25/26 knees, 27/28 ankles; 0 the nose.)
    const L = { s: P(11), e: P(13), w: P(15), h: P(23), k: P(25), a: P(27) }; const R = { s: P(12), e: P(14), w: P(16), h: P(24), k: P(26), a: P(28) };
    const [a, b] = L.s[0] <= R.s[0] ? [L, R] : [R, L];
    return { shoulders: [a.s, b.s], elbows: [a.e, b.e], wrists: [a.w, b.w], hips: [a.h, b.h], knees: [a.k, b.k], ankles: [a.a, b.a], nose: P(0) };
  });
  return out.sort((p, q) => (p.shoulders[0][0] + p.shoulders[1][0]) - (q.shoulders[0][0] + q.shoulders[1][0]));
}

/** The pose of the one person in `img` (the biggest, by shoulder width), or null. */
export async function detectPose(img) {
  const all = await detectPoses(img);
  if (!all.length) return null;
  const sw = (p) => Math.abs(p.shoulders[1][0] - p.shoulders[0][0]);
  return all.reduce((a, b) => (sw(b) > sw(a) ? b : a));
}

/**
 * The pose of the one person whose face is `face` ({ x0, y0, x1, y1 } in `img`'s pixels), found on a crop
 * around them alone (their face's width about four times over, from above their head to the bottom): in a
 * group, the pose finder can put one person's shoulder on the next; alone in the picture it can't. In
 * `img`'s pixels, or null.
 */
export async function detectPoseOf(img, face) {
  const fw = face.x1 - face.x0; const fh = face.y1 - face.y0; const cx = (face.x0 + face.x1) / 2;
  const x0 = Math.max(0, Math.floor(cx - fw * 2.2)); const x1 = Math.min(img.width, Math.ceil(cx + fw * 2.2));
  const y0 = Math.max(0, Math.floor(face.y0 - fh * 0.6)); const y1 = img.height;
  if (x1 - x0 < 16 || y1 - y0 < 16) return null;
  const c = document.createElement('canvas'); c.width = x1 - x0; c.height = y1 - y0;
  c.getContext('2d').drawImage(img, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  const all = await detectPoses(c);
  const fx = cx - x0; const fy = (face.y0 + face.y1) / 2 - y0;
  // (Only a pose whose nose is in their face: a little past it at most.)
  const near = all.filter((q) => Math.abs(q.nose[0] - fx) < fw * 0.65 && Math.abs(q.nose[1] - fy) < fh * 0.65).sort((a, b) => Math.hypot(a.nose[0] - fx, a.nose[1] - fy) - Math.hypot(b.nose[0] - fx, b.nose[1] - fy))[0];
  if (!near) return null;
  const mv = (pt) => [pt[0] + x0, pt[1] + y0, pt[2]];
  return Object.fromEntries(Object.entries(near).map(([k, v]) => [k, Array.isArray(v[0]) ? v.map(mv) : mv(v)]));
}
