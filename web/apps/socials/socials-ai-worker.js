// Socials' on-device language model, in a worker of its own (the page stays smooth while it thinks): a small
// chat model (Qwen2.5 1.5B Instruct, 4-bit, ~1.2 GB) run on the phone's GPU (WebGPU) by Transformers.js
// (vendor/transformers). Downloaded from Hugging Face once, then kept by the browser: it works offline after.
// Messages: { id, type: 'load' } → progress…, ready | error; { id, type: 'generate', messages, options } →
// done { text } | error.

import { guardedFetch, fenceWorker } from './socials-ai-guard.js';

// (The network fenced in before anything else loads: the app's own files; Hugging Face's files for this model
// only while it's being downloaded; nothing else, ever (socials-ai-guard.js).)
let remote = false; let model = 'onnx-community/Qwen2.5-1.5B-Instruct';
const fence = { origin: self.location.origin, model: () => model, remote: () => remote };
self.fetch = guardedFetch(self.fetch.bind(self), fence);
fenceWorker(self, fence);
// (Loaded once the fence is up; the messages listened for straight away, below.)
const tfP = import('../../vendor/transformers/transformers.min.js').then((tf) => {
  tf.env.allowLocalModels = false;
  tf.env.useBrowserCache = true;
  tf.env.backends.onnx.wasm.wasmPaths = new URL('../../vendor/transformers/', import.meta.url).href;
  tf.env.backends.onnx.wasm.numThreads = 1;
  return tf;
});

export const MODEL = 'onnx-community/Qwen2.5-1.5B-Instruct';

let gen = null; let loading = null;
async function load(id, o = {}) {
  // (Downloading only when asked to (the model not on the phone yet); otherwise everything from the phone.)
  remote = !!o.download; model = o.model ?? MODEL;
  // (`o`: another model, number type or device, for testing on a machine without WebGPU.)
  const tf = await tfP;
  loading ??= tf.pipeline('text-generation', o.model ?? MODEL, { dtype: o.dtype ?? 'q4f16', device: o.device ?? 'webgpu', progress_callback: (p) => { if (p.status === 'progress' || p.status === 'done') postMessage({ id, type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0, status: p.status }); } });
  try { gen = await loading; } catch (e) { loading = null; remote = false; throw e; }
  remote = false; // (Downloaded: nothing remote from here on.)
  return gen;
}

self.onmessage = async (e) => {
  const { id, type } = e.data ?? {};
  try {
    if (type === 'load') { await load(id, e.data.options ?? {}); postMessage({ id, type: 'ready' }); return; }
    if (type === 'generate') {
      const g = gen ?? await load(id);
      const out = await g(e.data.messages, { max_new_tokens: 48, do_sample: true, temperature: 0.75, top_p: 0.88, repetition_penalty: 1.1, ...(e.data.options ?? {}) });
      postMessage({ id, type: 'done', text: String(out?.[0]?.generated_text?.at(-1)?.content ?? '') });
    }
  } catch (err) { postMessage({ id, type: 'error', error: String(err?.message ?? err) }); }
};
