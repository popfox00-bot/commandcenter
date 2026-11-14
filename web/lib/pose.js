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
      { baseOptions: { modelAssetPath: `${base}pose_landmarker_lite.task`, delegate: 'CPU' }, runningMode: 'IMAGE', numPoses: 1, minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4 },
    );
  })());
  landmarker.catch(() => { landmarker = null; });
  return landmarker;
}

/**
 * The pose of the person in `img` (a canvas or an image), in its pixels: { shoulders: [a, b], elbows,
 * wrists, hips } (each [x, y, seen 0..1], the two in the order of the picture, left to right of it, so
 * [0] is the arm on the picture's left), or null when there's no one.
 */
export async function detectPose(img) {
  const lm = await poseLandmarker();
  const W = img.width; const H = img.height;
  const res = lm.detect(img);
  const pts = res.landmarks?.[0]; if (!pts) return null;
  const P = (i) => [pts[i].x * W, pts[i].y * H, pts[i].visibility ?? 1];
  // (MediaPipe's 11/13/15/23: the person's left shoulder, elbow, wrist, hip; 12/14/16/24 their right.)
  const L = { s: P(11), e: P(13), w: P(15), h: P(23) }; const R = { s: P(12), e: P(14), w: P(16), h: P(24) };
  const [a, b] = L.s[0] <= R.s[0] ? [L, R] : [R, L];
  return { shoulders: [a.s, b.s], elbows: [a.e, b.e], wrists: [a.w, b.w], hips: [a.h, b.h] };
}
