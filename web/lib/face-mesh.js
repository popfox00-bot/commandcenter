// Finding faces with a dense mesh, on the phone (vendor/mediapipe: MediaPipe's Face Landmarker, run
// by WebAssembly; offline once cached). Each face: its 478 points with their depth (the face's real
// shape), and from them the usual 68 landmarks (iBUG layout) the rest of FaceMask works with, much
// steadier than the 68-point finder's on a soft or turned face. Loaded the first time it's asked for.

import { faceFrom } from './face-core.js';

/** Which of the mesh's 478 points stands for each of the 68 landmarks (jaw, brows, nose, eyes, mouth). */
export const MESH68 = [
  234, 93, 132, 58, 172, 136, 150, 176, 152, 400, 379, 365, 397, 288, 361, 323, 454, // jaw 0–16
  70, 63, 105, 66, 107, 336, 296, 334, 293, 300, // brows 17–26
  168, 197, 5, 4, 75, 97, 2, 326, 305, // nose 27–35
  33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380, // eyes 36–47
  61, 39, 37, 0, 267, 269, 291, 405, 314, 17, 84, 181, // mouth, outside 48–59
  78, 82, 13, 312, 308, 317, 14, 87, // mouth, inside 60–67
];

let landmarker = null;
function faceLandmarker() {
  landmarker ??= (async () => {
    const base = new URL('../vendor/mediapipe/', import.meta.url).href;
    const { FaceLandmarker } = await import('../vendor/mediapipe/vision_bundle.mjs');
    return FaceLandmarker.createFromOptions(
      { wasmLoaderPath: `${base}wasm/vision_wasm_internal.js`, wasmBinaryPath: `${base}wasm/vision_wasm_internal.wasm` },
      { baseOptions: { modelAssetPath: `${base}face_landmarker.task`, delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 6, minFaceDetectionConfidence: 0.4, minFacePresenceConfidence: 0.4 },
    );
  })();
  landmarker.catch(() => { landmarker = null; });
  return landmarker;
}

/**
 * The faces in `img` (a canvas or an image) by the mesh: as face-core's faces (box, eyes, mouth, nose,
 * angle, pts: the 68 landmarks; 0..1 of `img`), each with `mesh` too: its 478 points [x, y, z] (x and
 * y 0..1 of the picture, z its depth, into the picture, in the same units as x). [] when there are none.
 */
export async function detectMesh(img) {
  const lm = await faceLandmarker();
  const W = img.width; const H = img.height;
  const res = lm.detect(img);
  return (res.faceLandmarks ?? []).map((pts) => {
    const px = MESH68.map((i) => [pts[i].x * W, pts[i].y * H]);
    const xs = pts.map((p) => p.x * W); const ys = pts.map((p) => p.y * H);
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    const f = faceFrom(box, px, W, H, 0.95);
    f.mesh = pts.map((p) => [p.x, p.y, p.z]);
    return f;
  });
}
