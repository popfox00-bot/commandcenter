// Socials read aloud: messages, comments and captions played as speech, each account in a voice of its own,
// all on the phone and offline. Two kinds of voice:
// - This phone's own (the browser's speech, `speechSynthesis`): nothing to download; on an iPhone, its voices
//   (more, and better ones, in Settings → Accessibility → Spoken Content → Voices). Only voices that speak on
//   the device are offered: a computer's browser can list online voices that send the text away; those aren't.
// - Natural voices (socials-tts-worker.js): a small speech model, downloaded once (~105 MB), about 28 English
//   voices (American and British, women and men) that sound far more like people.
// Each account: its Speaking voice (Edit profile; or one of its own, picked from its handle) and speed; when the
// natural voices are off or not ready, an account set to one speaks in this phone's voice.

import { store } from '../../lib/dom.js';
import { personaFor } from './socials-style.js';

export const TTS_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const TTS_SIZE = '105 MB';
const ON_KEY = 'cc.socials.voices'; // natural voices on ('on')
export const naturalOn = () => store.get(ON_KEY) === 'on';
export const setNaturalOn = (on) => store.set(ON_KEY, on ? 'on' : 'off');

/** The natural voices (the better ones first in each group): [{ id, name, accent, gender }]. */
export const NATURAL = [
  ['af_heart', 'Heart', 'US', 'F'], ['af_bella', 'Bella', 'US', 'F'], ['af_nicole', 'Nicole', 'US', 'F'], ['af_sarah', 'Sarah', 'US', 'F'], ['af_kore', 'Kore', 'US', 'F'], ['af_aoede', 'Aoede', 'US', 'F'], ['af_nova', 'Nova', 'US', 'F'], ['af_alloy', 'Alloy', 'US', 'F'], ['af_sky', 'Sky', 'US', 'F'], ['af_jessica', 'Jessica', 'US', 'F'], ['af_river', 'River', 'US', 'F'],
  ['am_michael', 'Michael', 'US', 'M'], ['am_fenrir', 'Fenrir', 'US', 'M'], ['am_puck', 'Puck', 'US', 'M'], ['am_echo', 'Echo', 'US', 'M'], ['am_eric', 'Eric', 'US', 'M'], ['am_liam', 'Liam', 'US', 'M'], ['am_onyx', 'Onyx', 'US', 'M'], ['am_adam', 'Adam', 'US', 'M'], ['am_santa', 'Santa', 'US', 'M'],
  ['bf_emma', 'Emma', 'UK', 'F'], ['bf_isabella', 'Isabella', 'UK', 'F'], ['bf_alice', 'Alice', 'UK', 'F'], ['bf_lily', 'Lily', 'UK', 'F'],
  ['bm_george', 'George', 'UK', 'M'], ['bm_fable', 'Fable', 'UK', 'M'], ['bm_lewis', 'Lewis', 'UK', 'M'], ['bm_daniel', 'Daniel', 'UK', 'M'],
].map(([id, name, accent, gender]) => ({ id, name, accent, gender }));
const GOOD = ['af_heart', 'af_bella', 'af_nicole', 'am_michael', 'am_fenrir', 'am_puck', 'bf_emma', 'bm_george', 'af_sarah', 'af_kore', 'bm_fable', 'bf_isabella'];

const hash = (s) => { let h = 2166136261; for (const ch of String(s ?? '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** This phone's voices that speak on the device (English first): [{ id (voiceURI), name, lang }]. */
export function phoneVoices(synth = globalThis.speechSynthesis) {
  const vs = (synth?.getVoices?.() ?? []).filter((v) => v.localService !== false);
  const en = (v) => (/^en/i.test(v.lang) ? 0 : 1);
  return vs.sort((a, b) => en(a) - en(b) || String(a.lang).localeCompare(String(b.lang)) || a.name.localeCompare(b.name)).map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, v }));
}
/** This phone's voices once it has listed them (some browsers list them a moment after the page opens). */
export function phoneVoicesReady(synth = globalThis.speechSynthesis, wait = 1500) {
  if (!synth) return Promise.resolve([]);
  const now = phoneVoices(synth); if (now.length) return Promise.resolve(now);
  return new Promise((ok) => { const t = setTimeout(() => ok(phoneVoices(synth)), wait); synth.addEventListener?.('voiceschanged', () => { clearTimeout(t); ok(phoneVoices(synth)); }, { once: true }); });
}

// (Speed and pitch from the account's voice (hype: quicker and brighter; chill: slower and lower), its own
// speed setting on top.)
const STYLE = { hype: [1.12, 1.15], chill: [0.92, 0.9], warm: [1, 1.06], witty: [1.05, 1], classic: [1, 1] };

/**
 * How an account speaks: { kind: 'natural' | 'phone', voice (an id), rate, pitch }. Its chosen voice
 * (`a.speech.voice`: 'n:<id>' or 'p:<voiceURI>'), else one of its own from its handle (a natural one when they're
 * on and `naturalReady`; else this phone's English ones).
 */
export function speakerFor(a, { naturalReady = false, voices = phoneVoices() } = {}) {
  const [r0, p0] = STYLE[personaFor(a)] ?? STYLE.classic; const rate = r0 * (Number(a?.speech?.speed) || 1);
  const want = String(a?.speech?.voice ?? '');
  if (want.startsWith('n:') && naturalReady && NATURAL.some((v) => v.id === want.slice(2))) return { kind: 'natural', voice: want.slice(2), rate, pitch: p0 };
  if (want.startsWith('p:') && voices.some((v) => v.id === want.slice(2))) return { kind: 'phone', voice: want.slice(2), rate, pitch: p0 };
  if (naturalReady && naturalOn()) return { kind: 'natural', voice: GOOD[hash(a?.handle) % GOOD.length], rate, pitch: p0 };
  const en = voices.filter((v) => /^en/i.test(v.lang)); const pool = en.length ? en : voices;
  return { kind: 'phone', voice: pool.length ? pool[hash(a?.handle) % pool.length].id : '', rate, pitch: p0 };
}

/** Text cut into pieces to say one after another (sentences; a long one at its commas): the first starts sooner. */
export function pieces(text, max = 140) {
  const out = [];
  for (const s of String(text).split(/(?<=[.!?…])\s+/)) {
    if (s.length <= max) { if (s.trim()) out.push(s.trim()); continue; }
    let cur = ''; for (const part of s.split(/(?<=[,;:])\s+/)) { if (cur && (cur + part).length > max) { out.push(cur.trim()); cur = ''; } cur += `${part} `; }
    if (cur.trim()) out.push(cur.trim());
  }
  // (Short ones joined to the one before: fewer pauses.)
  const joined = out.reduce((acc, p) => { if (acc.length && acc[acc.length - 1].length + p.length < 30) acc[acc.length - 1] += ` ${p}`; else acc.push(p); return acc; }, []);
  // (The first kept short (its first clause), so the voice starts sooner; the rest is made while it plays.)
  const m = joined[0]?.length > 60 ? /^(.{6,60}?[,;:—])\s+(.+)$/.exec(joined[0]) : null;
  return m ? [m[1], m[2], ...joined.slice(1)] : joined;
}

/** Text made ready to say: no emojis, hashtags read as words, @handles as names, links left out. */
export function sayable(text) {
  return String(text ?? '').replace(/https?:\/\/\S+/g, '').replace(/#([\p{L}\p{N}_]+)/gu, (m, w) => w.replace(/_/g, ' ')).replace(/@([\w.]+)/g, (m, h) => h.replace(/[._]+/g, ' '))
    .replace(/[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}]/gu, '').replace(/([!?.])\1+/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

// ---- The natural voices' worker.
let worker = null; let seq = 0; const pending = new Map(); let ready = false; let loadP = null;
function w() {
  if (worker) return worker;
  worker = new Worker(new URL('./socials-tts-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { const p = pending.get(e.data?.id); if (!p) return; if (e.data.type === 'progress') p.progress?.(e.data); else { pending.delete(e.data.id); if (e.data.type === 'error') p.reject(new Error(e.data.error)); else p.resolve(e.data); } };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'The voices stopped.')); pending.clear(); worker = null; ready = false; loadP = null; };
  return worker;
}
const ask = (msg, progress, transfer = []) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject, progress }); w().postMessage({ id, ...msg }, transfer); });

/** Whether the natural voices are on the phone (the model and every voice). */
export async function naturalDownloaded() {
  try {
    const m = await caches.open('transformers-cache'); const hasModel = (await m.keys()).some((r) => r.url.includes(TTS_MODEL) && /model_quantized\.onnx/.test(r.url));
    const v = await caches.open('kokoro-voices'); const have = new Set((await v.keys()).map((r) => r.url.split('/').pop()));
    return hasModel && NATURAL.every((x) => have.has(`${x.id}.bin`));
  } catch { return false; }
}
/** The natural voices loaded (downloaded the first time): `onProgress(0..1)`. */
export function naturalLoad(onProgress = () => {}) {
  if (ready) return Promise.resolve();
  const files = new Map(); let voices = 0;
  loadP ??= naturalDownloaded().then((have) => ask({ type: 'load', options: { download: !have, voices: NATURAL.map((v) => v.id) } }, (p) => {
    if (p.status === 'voice') voices = p.loaded / p.total;
    else if (p.file) files.set(p.file, { loaded: p.status === 'done' ? (p.total || files.get(p.file)?.total || 0) : p.loaded, total: p.total || files.get(p.file)?.total || 0 });
    let l = 0; let t = 0; for (const f of files.values()) { l += f.loaded; t += f.total; }
    onProgress(Math.min(1, (t ? l / t : 0) * 0.86 + voices * 0.14));
  })).then(() => { ready = true; }, (e) => { loadP = null; throw e; });
  return loadP;
}
export const naturalReady = () => ready;
/** The natural voices taken off the phone (and turned off). */
export async function naturalRemove() {
  try { worker?.terminate(); } catch { /* gone */ }
  worker = null; ready = false; loadP = null; pending.clear(); setNaturalOn(false);
  try { await caches.delete('kokoro-voices'); } catch { /* none */ }
  try { const c = await caches.open('transformers-cache'); for (const r of await c.keys()) if (r.url.includes(TTS_MODEL)) await c.delete(r); } catch { /* none */ }
}

// ---- Playing.
let ctx = null; let playing = null; let token = 0;
/** Whatever's being said, stopped. */
export function stopSpeaking() {
  token++;
  try { globalThis.speechSynthesis?.cancel(); } catch { /* none */ }
  try { playing?.stop(); } catch { /* ended */ }
  playing = null;
}
/** Whether anything can be said here (this phone's voices, or the natural ones loaded). */
export const canSpeak = () => !!globalThis.speechSynthesis || ready;

/**
 * `text` said as account `a` (its voice, speed and pitch), what was being said stopped first. Resolves when
 * it's done (or stopped): { kind } how it was said, or { kind: 'none' } if it couldn't be.
 */
export async function speak(text, a, { onStart = () => {} } = {}) {
  stopSpeaking(); const my = token;
  const words = sayable(text); if (!words) return { kind: 'none' };
  const sp = speakerFor(a, { naturalReady: ready && naturalOn() });
  if (sp.kind === 'natural') {
    try {
      // (Piece by piece: the next made while this one plays.)
      ctx ??= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      const parts = pieces(words); const make = (t) => ask({ type: 'speak', text: t, voice: sp.voice, speed: Math.max(0.7, Math.min(1.4, sp.rate)) });
      let next = make(parts[0]); let started = false;
      for (let i = 0; i < parts.length; i++) {
        const out = await next; if (my !== token) return { kind: 'natural' };
        if (i + 1 < parts.length) next = make(parts[i + 1]);
        const buf = ctx.createBuffer(1, out.audio.length, out.rate); buf.copyToChannel(out.audio, 0);
        const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); playing = src;
        if (!started) { started = true; onStart(); }
        src.start();
        await new Promise((ok) => { src.onended = ok; });
        if (my !== token) return { kind: 'natural' };
      }
      return { kind: 'natural' };
    } catch { if (my !== token) return { kind: 'natural' }; /* this phone's voice instead */ }
  }
  const synth = globalThis.speechSynthesis; if (!synth) return { kind: 'none' };
  const u = new SpeechSynthesisUtterance(words);
  const v = phoneVoices(synth).find((x) => x.id === (sp.kind === 'phone' ? sp.voice : '')) ?? phoneVoices(synth).find((x) => /^en/i.test(x.lang));
  if (v) { u.voice = v.v; u.lang = v.lang; }
  u.rate = Math.max(0.5, Math.min(2, sp.rate)); u.pitch = Math.max(0.5, Math.min(2, sp.pitch));
  onStart();
  await new Promise((ok) => { u.onend = ok; u.onerror = ok; synth.speak(u); });
  return { kind: 'phone' };
}
