// Socials' fast natural voices, in a worker of their own: Piper (VITS), one small model with many speakers
// (LibriTTS-R medium, ~78 MB, CC BY 4.0), run by ONNX Runtime Web (vendor/ort, with the WebAssembly in
// vendor/transformers) on the processor: about twenty times quicker than the full voices (socials-tts-worker.js), so
// it keeps up on a phone. Words become sounds by eSpeak NG (vendor/kokoro/phonemizer.js), each sound one of the
// model's ids. Downloaded from Hugging Face once and kept by the browser; the network is fenced in as the other
// voices' is (socials-ai-guard.js): the text it speaks never leaves the phone.
// Messages: { id, type: 'load', options: { download } } → progress…, ready | error;
// { id, type: 'speak', text, speaker, speed } → done { audio (Float32Array), rate } | error.

import { guardedFetch, fenceWorker } from './socials-ai-guard.js';

export const FAST_REPO = 'rhasspy/piper-voices';
const DIR = 'en/en_US/libritts_r/medium/en_US-libritts_r-medium';
const URL_OF = (ext) => `https://huggingface.co/${FAST_REPO}/resolve/main/${DIR}${ext}`;
export const FAST_CACHE = 'piper-voices';
let remote = false;
const fence = { origin: self.location.origin, model: () => FAST_REPO, remote: () => remote };
self.fetch = guardedFetch(self.fetch.bind(self), fence);
fenceWorker(self, fence);

let ort = null; let session = null; let config = null; let phonemize = null; let loading = null;

/** A file of the model: from the browser's cache, else downloaded (when allowed) and kept. `onBytes(n, total)`. */
async function file(ext, onBytes) {
  const cache = await caches.open(FAST_CACHE); const url = URL_OF(ext);
  const have = await cache.match(url); if (have) return have.arrayBuffer();
  if (!remote) throw new Error('The fast voices aren\'t downloaded.');
  const res = await fetch(url); if (!res.ok || !res.body) throw new Error(`Couldn't download the fast voices (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0; const parts = []; let n = 0;
  for (const reader = res.body.getReader(); ;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; onBytes?.(n, total); }
  const blob = new Blob(parts); parts.length = 0;
  await cache.put(url, new Response(blob, { headers: { 'content-type': 'application/octet-stream' } }));
  return blob.arrayBuffer();
}

async function load(id, o = {}) {
  remote = !!o.download;
  loading ??= (async () => {
    ort = await import('../../vendor/ort/ort.webgpu.min.mjs');
    ort.env.wasm.wasmPaths = new URL('../../vendor/transformers/', import.meta.url).href;
    ort.env.wasm.numThreads = 1;
    ({ phonemize } = await import('../../vendor/kokoro/phonemizer.js'));
    config = JSON.parse(new TextDecoder().decode(await file('.onnx.json')));
    const model = await file('.onnx', (n, total) => postMessage({ id, type: 'progress', file: 'model.onnx', loaded: n, total, status: 'progress' }));
    session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
  })();
  try { await loading; } catch (e) { loading = null; throw e; } finally { remote = false; }
}

/** Text as the model's sound ids: each clause turned into sounds, its punctuation kept (the pauses), ^ … $ around. */
async function idsOf(text) {
  const map = config.phoneme_id_map; const out = [...map['^'], ...map._];
  const add = (s) => { for (const ch of s) if (map[ch]) out.push(...map[ch], ...map._); };
  for (const [, words, punct] of String(text).matchAll(/([^,.!?;:]+)([,.!?;:]*)/g)) {
    if (words.trim()) add((await phonemize(words, 'en-us')).join(' '));
    if (punct) add(punct[0]);
    add(' ');
  }
  out.push(...map.$);
  return out;
}

async function speak(text, speaker, speed = 1) {
  if (!session) await load(0, {});
  const ids = await idsOf(String(text).slice(0, 600));
  const inf = config.inference ?? {};
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    // (noise, length (1 ÷ speed: slower is longer), noise in timing)
    scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / Math.max(0.5, Math.min(2, speed)), inf.noise_w ?? 0.8]), [3]),
  };
  if (session.inputNames.includes('sid')) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(speaker | 0)]), [1]);
  const r = await session.run(feeds);
  const audio = Float32Array.from(r.output.data);
  if (!audio.length || Number.isNaN(audio[0])) throw new Error('No sound came out.');
  return { audio, rate: config.audio?.sample_rate ?? 22050 };
}

let chain = Promise.resolve();
self.onmessage = (e) => { chain = chain.then(() => handle(e)).catch(() => {}); };
async function handle(e) {
  const { id, type } = e.data ?? {};
  try {
    if (type === 'load') { await load(id, e.data.options ?? {}); postMessage({ id, type: 'ready', device: 'wasm' }); return; }
    if (type === 'speak') { const r = await speak(e.data.text, e.data.speaker, e.data.speed ?? 1); postMessage({ id, type: 'done', audio: r.audio, rate: r.rate, device: 'wasm' }, [r.audio.buffer]); }
  } catch (err) { postMessage({ id, type: 'error', error: String(err?.message ?? err) }); }
}
