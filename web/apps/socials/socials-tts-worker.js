// Socials' natural voices, in a worker of their own: a small speech model (Kokoro 82M, full 32-bit quality, ~310 MB, with its
// English voices, ~15 MB) run on the phone by Transformers.js (on its graphics chip with WebGPU where there is one, several
// times faster; else WebAssembly, and back to it if the graphics chip fails), its words turned
// into sounds by eSpeak NG (vendor/kokoro). Downloaded from Hugging Face once, then kept by the browser: it
// works offline after, and the text it speaks never leaves the phone (the network fenced in as the AI replies'
// worker's is: socials-ai-guard.js).
// Messages: { id, type: 'load', options: { download, voices, device } } → progress…, ready { device } | error;
// { id, type: 'speak', text, voice, speed } → done { audio (Float32Array), rate, device } | error.

import { guardedFetch, fenceWorker } from './socials-ai-guard.js';

export const TTS_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let remote = false;
const fence = { origin: self.location.origin, model: () => TTS_MODEL, remote: () => remote };
self.fetch = guardedFetch(self.fetch.bind(self), fence);
fenceWorker(self, fence);
const libP = Promise.all([import('../../vendor/kokoro/kokoro.js'), import('../../vendor/transformers/transformers.min.js')]).then(([k, tf]) => {
  tf.env.allowLocalModels = false; tf.env.useBrowserCache = true;
  tf.env.backends.onnx.wasm.wasmPaths = new URL('../../vendor/transformers/', import.meta.url).href;
  tf.env.backends.onnx.wasm.numThreads = 1;
  return k;
});

let tts = null; let loading = null; let device = 'wasm';
async function load(id, o = {}) {
  remote = !!o.download;
  // (The graphics chip (WebGPU) when the phone has one: several times faster; else the processor (WebAssembly).)
  if (!tts && !loading) device = o.device === 'webgpu' ? 'webgpu' : 'wasm';
  const { KokoroTTS } = await libP;
  loading ??= KokoroTTS.from_pretrained(TTS_MODEL, { dtype: o.dtype ?? 'fp32', device, progress_callback: (p) => { if (p.status === 'progress' || p.status === 'done') postMessage({ id, type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0, status: p.status }); } });
  try {
    try { tts = await loading; } catch (e) {
      if (device !== 'webgpu') throw e;
      // (The graphics chip wouldn't take it: the processor instead.)
      device = 'wasm'; loading = null; const { KokoroTTS: K } = await libP;
      loading = K.from_pretrained(TTS_MODEL, { dtype: o.dtype ?? 'fp32', device, progress_callback: () => {} }); tts = await loading;
    }
    // (The voices, each a small file: all of them now, while downloading is allowed, kept where the library looks.)
    if (o.download) {
      const cache = await caches.open('kokoro-voices');
      for (const [i, v] of (o.voices ?? []).entries()) {
        const url = `https://huggingface.co/${TTS_MODEL}/resolve/main/voices/${v}.bin`;
        if (await cache.match(url)) continue;
        const res = await fetch(url); if (!res.ok) throw new Error(`Couldn't get the voice ${v}.`);
        await cache.put(url, new Response(await res.arrayBuffer(), { headers: { 'content-type': 'application/octet-stream' } }));
        postMessage({ id, type: 'progress', file: `voices/${v}.bin`, loaded: i + 1, total: o.voices.length, status: 'voice' });
      }
    }
  } catch (e) { loading = null; remote = false; throw e; }
  remote = false; // (Downloaded: nothing remote from here on.)
  // (The older 8-bit model, from before: let go.)
  try { const c = await caches.open('transformers-cache'); for (const r of await c.keys()) if (r.url.includes(TTS_MODEL) && /model_(quantized|fp16)\.onnx/.test(r.url)) await c.delete(r); } catch { /* none */ }
  return tts;
}

// (One at a time: the model runs one piece of speech after another.)
let chain = Promise.resolve();
self.onmessage = (e) => { chain = chain.then(() => handle(e)).catch(() => {}); };
async function handle(e) {
  const { id, type } = e.data ?? {};
  try {
    if (type === 'load') { await load(id, e.data.options ?? {}); postMessage({ id, type: 'ready', device }); return; }
    if (type === 'speak') {
      const say = async () => {
        const t = tts ?? await load(id);
        const out = await t.generate(String(e.data.text ?? '').slice(0, 600), { voice: e.data.voice, speed: e.data.speed ?? 1 });
        const audio = out.audio instanceof Float32Array ? out.audio : new Float32Array(out.audio);
        if (!audio.length || Number.isNaN(audio[0]) || Number.isNaN(audio[audio.length >> 1])) throw new Error('No sound came out.'); // (this phone's voice instead)
        return { audio, rate: out.sampling_rate };
      };
      let r;
      try { r = await say(); } catch (err) {
        if (device !== 'webgpu') throw err;
        // (The graphics chip got it wrong: the processor from now on, and this line again.)
        device = 'wasm'; tts = null; loading = null; await load(id, {}); r = await say();
      }
      postMessage({ id, type: 'done', audio: r.audio, rate: r.rate, device }, [r.audio.buffer]);
    }
  } catch (err) { postMessage({ id, type: 'error', error: String(err?.message ?? err) }); }
}
