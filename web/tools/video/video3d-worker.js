// Video Editor's 2D → 3D worker: each frame's depth from an AI model (Depth Anything V2 Small, Apache-2.0, ~26 MB;
// run on the phone by Transformers.js: WebGPU when there is one, else WebAssembly), steadied over time (eased, reset
// at scene cuts), its edges refined, and the two eyes drawn from it (video-core.js), laid out side by side or top and
// bottom. The model is downloaded from Hugging Face once, then kept by the browser; the network is fenced in as Socials'
// AI workers' is (its own files once, then nothing remote): the video never leaves the phone.
// Messages: { id, type: 'load', options: { download, device, test } } → progress…, ready | error;
// { id, type: 'reset' }; { id, type: 'frame', rgba, W, H, params } → done { frame, fw, fh, cut, ms };
// { id, type: 'preview', rgba, W, H, params } → done { left, right, depth, eyeW, eyeH, dw, dh, ms }.

import { guardedFetch, fenceWorker } from '../../apps/socials/socials-ai-guard.js';
import * as V from './video-core.js';

export const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';
let remote = false;
const fence = { origin: self.location.origin, model: () => DEPTH_MODEL, remote: () => remote };
self.fetch = guardedFetch(self.fetch.bind(self), fence);
fenceWorker(self, fence);
let tfP = null;
const tf = () => (tfP ??= import('../../vendor/transformers/transformers.min.js').then((t) => {
  t.env.allowLocalModels = false; t.env.useBrowserCache = true;
  t.env.backends.onnx.wasm.wasmPaths = new URL('../../vendor/transformers/', import.meta.url).href;
  t.env.backends.onnx.wasm.numThreads = 1;
  return t;
}));

let pipe = null; let loading = null; let test = false;
async function load(id, o = {}) {
  test = !!o.test; if (test) return null;
  remote = !!o.download;
  const t = await tf();
  const gpu = o.device === 'webgpu';
  loading ??= t.pipeline('depth-estimation', DEPTH_MODEL, { dtype: gpu ? 'fp16' : 'q8', device: gpu ? 'webgpu' : 'wasm', progress_callback: (p) => { if (p.status === 'progress' || p.status === 'done') postMessage({ id, type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0, status: p.status }); } });
  try { pipe = await loading; } catch (e) { loading = null; remote = false; throw e; }
  remote = false;
  return pipe;
}

/** Depth of a small picture (`w` × `h` RGBA): the model's (0 far … 1 near after normalizing), at `detail` px. */
async function depthOf(rgba, w, h, detail) {
  if (test || !pipe) return V.fallbackDepth(rgba, w, h);
  const t = await tf();
  const ip = pipe.processor.image_processor; ip.size = { height: detail, width: detail }; ip.keep_aspect_ratio = true; ip.ensure_multiple_of = 14;
  const r = await pipe(new t.RawImage(rgba, w, h, 4));
  const d = r.predicted_depth; const [dh, dw] = d.dims.slice(-2);
  const data = d.data instanceof Float32Array ? d.data : Float32Array.from(d.data);
  return dw === w && dh === h ? data : V.resizeMap(data, dw, dh, w, h);
}

// (The steadying over time: the last frame's thumbnail and depth, and the depth range.)
let st = { thumb: null, depth: null, norm: {}, n: 0 };
const fresh = () => { st = { thumb: null, depth: null, norm: {}, n: 0 }; };

/** One frame: its depth (from the model, or the last one between, every `stride` frames), steadied, then its eyes. */
async function frame(rgba, W, H, p, keep = true) {
  const t0 = Date.now();
  // The size depth is worked out at: about `detail` px on the short side, never more than the picture.
  const k = Math.min(1, (p.detail ?? 350) / Math.min(W, H)); const dw = Math.max(16, Math.round(W * k)); const dh = Math.max(16, Math.round(H * k));
  const small = V.resizeRGBA(rgba, W, H, dw, dh);
  const thumb = V.thumbOf(small, dw, dh);
  const cut = keep && st.thumb ? V.isSceneCut(st.thumb, thumb) : false;
  if (cut) fresh();
  let depth;
  if (!keep || !st.depth || st.n % Math.max(1, p.stride ?? 1) === 0 || cut) {
    const raw = await depthOf(small, dw, dh, p.detail ?? 350);
    const norm = V.normalizeDepth(raw, keep ? st.norm : {}, { reset: !keep || !st.depth });
    depth = keep ? V.smoothDepth(st.depth, norm, p.smoothing ?? 0.6) : norm;
  } else depth = st.depth;
  if (keep) { st.depth = depth; st.thumb = thumb; st.n++; }
  const refined = V.refineDepth(depth, dw, dh, Math.max(1, Math.round(dw / 200)));
  // The eyes, at the size each is drawn in the frame (half SBS: half width).
  const f = V.frameSize(p.layout, { w: W, h: H }); const ew = f.eyeW; const eh = f.eyeH;
  const pic = ew === W && eh === H ? rgba : V.resizeRGBA(rgba, W, H, ew, eh);
  const big = V.resizeMap(refined, dw, dh, ew, eh);
  const shift = V.shiftFor(p.strength ?? 3, ew); const c = p.convergence ?? 0.5;
  const left = V.renderEye(pic, big, ew, eh, shift, c, 1, new Uint8ClampedArray(ew * eh * 4));
  const right = V.renderEye(pic, big, ew, eh, shift, c, -1, new Uint8ClampedArray(ew * eh * 4));
  return { left, right, depth: refined, dw, dh, ew, eh, cut, ms: Date.now() - t0 };
}

self.onmessage = async (e) => {
  const { id, type } = e.data ?? {};
  try {
    if (type === 'load') { await load(id, e.data.options ?? {}); postMessage({ id, type: 'ready', test }); return; }
    if (type === 'reset') { fresh(); postMessage({ id, type: 'done' }); return; }
    if (type === 'frame' || type === 'preview') {
      const { W, H, params: p } = e.data; const rgba = new Uint8ClampedArray(e.data.rgba);
      const r = await frame(rgba, W, H, p, type === 'frame');
      if (type === 'frame') {
        const out = V.composeFrame(p.layout, r.left, r.right, r.ew, r.eh, !!p.swap);
        const fw = p.layout === 'tb' ? r.ew : r.ew * 2; const fh = p.layout === 'tb' ? r.eh * 2 : r.eh;
        postMessage({ id, type: 'done', frame: out.buffer, fw, fh, cut: r.cut, ms: r.ms }, [out.buffer]);
      } else {
        const [L, R] = p.swap ? [r.right, r.left] : [r.left, r.right];
        const depth = V.depthImage(r.depth);
        postMessage({ id, type: 'done', left: L.buffer, right: R.buffer, depth: depth.buffer, eyeW: r.ew, eyeH: r.eh, dw: r.dw, dh: r.dh, ms: r.ms }, [L.buffer, R.buffer, depth.buffer]);
      }
    }
  } catch (err) { postMessage({ id, type: 'error', error: String(err?.message ?? err) }); }
};
