// Socials read aloud: messages, comments and captions played as speech, each account in a voice of its own,
// all on the phone and offline. Two kinds of voice:
// - This phone's own (the browser's speech, `speechSynthesis`): nothing to download; on an iPhone, its voices
//   (more, and better ones, in Settings → Accessibility → Spoken Content → Voices). Only voices that speak on
//   the device are offered: a computer's browser can list online voices that send the text away; those aren't.
// - Natural voices (socials-tts-worker.js): a small speech model at full quality (32-bit: the 8-bit one sounded
//   metallic and was no faster; the 16-bit one went silent on some voices), downloaded once (~330 MB), 28 English
//   voices (American and British, women and men) that sound far more like people.
// Each account: its Speaking voice (Edit profile; or one of its own, picked from its handle) and speed; when the
// natural voices are off or not ready, an account set to one speaks in this phone's voice.

import { store } from '../../lib/dom.js';
import { personaFor } from './socials-style.js';

export const TTS_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const TTS_SIZE = '330 MB';
export const TTS_FILE = /\/onnx\/model\.onnx/; // (the model file this version uses; the older 8-bit one is let go)
const ON_KEY = 'cc.socials.voices'; // natural voices on ('on')
export const naturalOn = () => store.get(ON_KEY) === 'on';
export const setNaturalOn = (on) => store.set(ON_KEY, on ? 'on' : 'off');

/**
 * The natural voices, each described by a few words: [{ id, name, accent, gender, tags, best? }]. The model's
 * own 28 (the better ones first in each group), then blends of two (their styles mixed: a voice of its own, no
 * more to download).
 */
const ACCENT = { US: 'American', UK: 'British', mix: 'transatlantic' };
export const NATURAL = [
  ['af_heart', 'Heart', 'US', 'F', 'warm expressive friendly', 1], ['af_bella', 'Bella', 'US', 'F', 'bright energetic upbeat', 1], ['af_nicole', 'Nicole', 'US', 'F', 'soft breathy intimate', 1], ['af_sarah', 'Sarah', 'US', 'F', 'mature calm composed'], ['af_kore', 'Kore', 'US', 'F', 'clear even confident'], ['af_aoede', 'Aoede', 'US', 'F', 'smooth melodic gentle'], ['af_nova', 'Nova', 'US', 'F', 'crisp newsy polished'], ['af_alloy', 'Alloy', 'US', 'F', 'neutral steady plain'], ['af_sky', 'Sky', 'US', 'F', 'light youthful airy'], ['af_jessica', 'Jessica', 'US', 'F', 'casual chatty relaxed'], ['af_river', 'River', 'US', 'F', 'mellow laid-back soft'],
  ['am_michael', 'Michael', 'US', 'M', 'deep warm narrator', 1], ['am_fenrir', 'Fenrir', 'US', 'M', 'bold strong gravelly', 1], ['am_puck', 'Puck', 'US', 'M', 'playful lively cheeky', 1], ['am_echo', 'Echo', 'US', 'M', 'calm even soft-spoken'], ['am_eric', 'Eric', 'US', 'M', 'plain steady everyday'], ['am_liam', 'Liam', 'US', 'M', 'young casual friendly'], ['am_onyx', 'Onyx', 'US', 'M', 'deep low resonant'], ['am_adam', 'Adam', 'US', 'M', 'flat robotic dry'], ['am_santa', 'Santa', 'US', 'M', 'jolly booming novelty'],
  ['bf_emma', 'Emma', 'UK', 'F', 'polished warm elegant', 1], ['bf_isabella', 'Isabella', 'UK', 'F', 'refined gentle smooth'], ['bf_alice', 'Alice', 'UK', 'F', 'bright crisp precise'], ['bf_lily', 'Lily', 'UK', 'F', 'soft young sweet'],
  ['bm_george', 'George', 'UK', 'M', 'classic deep narrator', 1], ['bm_fable', 'Fable', 'UK', 'M', 'storyteller expressive warm'], ['bm_lewis', 'Lewis', 'UK', 'M', 'relaxed mellow low'], ['bm_daniel', 'Daniel', 'UK', 'M', 'formal measured calm'],
  // (Blends: two voices' styles mixed.)
  ['af_heart+bf_emma', 'Harbor', 'mix', 'F', 'warm polished soft', 1], ['af_bella+af_nicole', 'Velvet', 'US', 'F', 'breathy smooth sultry', 1], ['af_sarah+bf_isabella', 'Grace', 'mix', 'F', 'mature refined calm'], ['af_sky+bf_lily', 'Pip', 'mix', 'F', 'youthful light sweet'], ['af_kore*0.6+af_nova*0.4', 'Quinn', 'US', 'F', 'clear crisp confident'], ['af_aoede+af_river', 'Willow', 'US', 'F', 'dreamy soft melodic'],
  ['am_michael+bm_george', 'Atlas', 'mix', 'M', 'deep steady narrator', 1], ['am_fenrir+am_onyx', 'Granite', 'US', 'M', 'gravelly very-deep bold', 1], ['am_puck+am_liam', 'Rio', 'US', 'M', 'youthful playful upbeat'], ['bm_fable+bm_lewis', 'Bard', 'UK', 'M', 'storyteller mellow warm'], ['am_echo+bm_daniel', 'Sage', 'mix', 'M', 'calm measured gentle'],
  ['af_heart+am_michael', 'Rowan', 'US', 'N', 'androgynous warm soft', 1], ['bf_emma+bm_george', 'Ash', 'UK', 'N', 'androgynous polished calm'], ['af_nicole*0.6+am_echo*0.4', 'Haze', 'US', 'N', 'whispery hushed androgynous'], ['af_bella*0.5+am_puck*0.5', 'Spark', 'US', 'N', 'energetic playful androgynous'],
].map(([id, name, accent, gender, words, best]) => ({ id, name, accent, gender, best: !!best, blend: id.includes('+'), tags: [...words.split(' '), ACCENT[accent], gender === 'F' ? 'woman' : gender === 'M' ? 'man' : 'neutral', ...(id.includes('+') ? ['blend'] : [])] }));
export const naturalById = (id) => NATURAL.find((v) => v.id === id) ?? null;
/** The model's own voices (the files the blends are made from). */
export const BASE_VOICES = NATURAL.filter((v) => !v.blend).map((v) => v.id);

// (This phone's voices, described: the ones phones and computers commonly have, by name; others by their
// language and region.)
const KNOWN = {
  samantha: 'clear friendly woman', alex: 'natural warm man', ava: 'natural warm woman', allison: 'bright friendly woman', susan: 'calm clear woman', tom: 'steady plain man', zoe: 'warm youthful woman', evan: 'calm natural man', nathan: 'young casual man', joelle: 'soft young woman', noelle: 'bright young woman', aaron: 'calm man', nicky: 'young friendly woman',
  daniel: 'polished deep man', kate: 'warm polished woman', serena: 'refined calm woman', oliver: 'young polished man', arthur: 'deep classic man', martha: 'mature warm woman', stephanie: 'bright polished woman', jamie: 'casual man',
  karen: 'bright friendly woman', lee: 'relaxed man', moira: 'soft lilting woman', tessa: 'clear warm woman', rishi: 'clear friendly man', veena: 'soft clear woman', fiona: 'lilting warm woman', catherine: 'calm woman', gordon: 'deep man', isha: 'clear woman', sangeeta: 'soft woman',
  fred: 'retro robotic man', ralph: 'deep retro man', kathy: 'retro plain woman', junior: 'retro young boy', albert: 'novelty croaky old', bahh: 'novelty bleating funny', bells: 'novelty musical chiming', boing: 'novelty bouncy funny', bubbles: 'novelty gurgling underwater', cellos: 'novelty musical singing', 'good news': 'novelty cheerful singing', 'bad news': 'novelty gloomy singing', jester: 'novelty silly playful', organ: 'novelty musical eerie', superstar: 'novelty singing showy', trinoids: 'novelty alien robotic', whisper: 'novelty whispered hushed', wobble: 'novelty wobbly funny', zarvox: 'novelty robotic alien', grandma: 'elderly warm woman', grandpa: 'elderly warm man', rocko: 'casual man', sandy: 'bright woman', shelley: 'calm woman', eddy: 'plain man', reed: 'calm man', flo: 'friendly woman',
  'google us english': 'clear plain woman', 'google uk english female': 'clear polished woman', 'google uk english male': 'clear polished man', 'microsoft zira': 'clear plain woman', 'microsoft david': 'plain steady man', 'microsoft mark': 'plain man', 'microsoft hazel': 'polished woman', 'microsoft george': 'polished man', 'microsoft aria': 'natural warm woman', 'microsoft guy': 'natural warm man', 'microsoft jenny': 'natural friendly woman',
};
const REGION = { US: 'American', GB: 'British', AU: 'Australian', IE: 'Irish', IN: 'Indian', ZA: 'South African', NZ: 'New Zealand', CA: 'Canadian', SG: 'Singaporean', SC: 'Scottish' };
let langNames = null;
/** A phone voice's tags, from its name (when it's a known one) and its language. */
export function phoneTags(v) {
  const name = String(v?.name ?? '').toLowerCase().replace(/\s*\((enhanced|premium|compact)\)/g, '').replace(/\s+(online|natural).*$/, '').trim();
  const key = Object.keys(KNOWN).sort((a, b) => b.length - a.length).find((k) => name === k || name.startsWith(`${k} `) || name.startsWith(`${k} -`));
  const tags = key ? KNOWN[key].split(' ') : [];
  const [lang, region] = String(v?.lang ?? '').replace('_', '-').split('-');
  if (/^en$/i.test(lang)) { const r = REGION[(region ?? '').toUpperCase()]; if (r) tags.push(r); }
  else if (lang) { try { langNames ??= new Intl.DisplayNames(['en'], { type: 'language' }); tags.push(langNames.of(lang)); } catch { tags.push(lang); } }
  if (/\((enhanced|premium)\)/i.test(v?.name ?? '')) tags.push(/premium/i.test(v.name) ? 'premium' : 'enhanced');
  return [...new Set(tags)];
}

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
  const [r0, p00] = STYLE[personaFor(a)] ?? STYLE.classic; const rate = r0 * (Number(a?.speech?.speed) || 1);
  const p0 = p00 * (Number(a?.speech?.pitch) || 1); // (its own pitch on top: deeper or higher)
  const want = String(a?.speech?.voice ?? '');
  const shift = Number(a?.speech?.pitch) || 1; // (a natural voice: only its own pitch setting moves it)
  if (want.startsWith('n:') && naturalReady && naturalById(want.slice(2))) return { kind: 'natural', voice: want.slice(2), rate, pitch: p0, shift };
  if (want.startsWith('p:') && voices.some((v) => v.id === want.slice(2))) return { kind: 'phone', voice: want.slice(2), rate, pitch: p0 };
  if (naturalReady && naturalOn()) return { kind: 'natural', voice: GOOD[hash(a?.handle) % GOOD.length], rate, pitch: p0, shift };
  // (Its own: the best-sounding of this phone's English voices: premium, then enhanced, then the natural-sounding
  // ones phones have; never the novelty or old robotic ones.)
  const en = voices.filter((v) => /^en/i.test(v.lang) && !phoneTags(v).some((t) => t === 'novelty' || t === 'retro'));
  const rank = (v) => (/\(premium\)/i.test(v.name) ? 3 : /\(enhanced\)/i.test(v.name) ? 2 : /^(samantha|ava|alex|allison|susan|zoe|evan|nathan|joelle|noelle|tom|karen|daniel|kate|serena|moira|tessa|rishi|google|microsoft (aria|guy|jenny))/i.test(v.name) ? 1 : 0);
  const top = Math.max(-1, ...en.map(rank)); const best = en.filter((v) => rank(v) >= Math.max(top - 1, Math.min(top, 1))); // (the top two levels: some variety between accounts)
  const pool = best.length ? best : en.length ? en : voices;
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
    const m = await caches.open('transformers-cache'); const hasModel = (await m.keys()).some((r) => r.url.includes(TTS_MODEL) && TTS_FILE.test(r.url));
    const v = await caches.open('kokoro-voices'); const have = new Set((await v.keys()).map((r) => r.url.split('/').pop()));
    return hasModel && BASE_VOICES.every((x) => have.has(`${x}.bin`));
  } catch { return false; }
}
/** The natural voices loaded (downloaded the first time): `onProgress(0..1)`. */
export function naturalLoad(onProgress = () => {}) {
  if (ready) return Promise.resolve();
  const files = new Map(); let voices = 0;
  loadP ??= Promise.all([naturalDownloaded(), gpuDevice()]).then(([have, device]) => ask({ type: 'load', options: { download: !have, voices: BASE_VOICES, device } }, (p) => {
    if (p.status === 'voice') voices = p.loaded / p.total;
    else if (p.file) files.set(p.file, { loaded: p.status === 'done' ? (p.total || files.get(p.file)?.total || 0) : p.loaded, total: p.total || files.get(p.file)?.total || 0 });
    let l = 0; let t = 0; for (const f of files.values()) { l += f.loaded; t += f.total; }
    onProgress(Math.min(1, (t ? l / t : 0) * 0.86 + voices * 0.14));
  })).then((r) => { ready = true; runsOn = r?.device ?? 'wasm'; }, (e) => { loadP = null; throw e; });
  return loadP;
}
export const naturalReady = () => ready;
let runsOn = '';
/** 'webgpu' when this phone's graphics chip can run the voices (much faster), else 'wasm'. */
async function gpuDevice() {
  try { const a = await globalThis.navigator?.gpu?.requestAdapter(); return a && !a.isFallbackAdapter && !a.info?.isFallbackAdapter ? 'webgpu' : 'wasm'; } catch { return 'wasm'; } // (not a software stand-in: slower than the processor)
}

// ---- Lines made already (kept a while, so a 🔊 tapped again, or a reply made while "typing", plays at once).
const made = new Map(); const MADE_MAX = 80;
const madeKey = (voice, speed, t) => `${voice}|${speed.toFixed(3)}|${t}`;
function remember(k, v) { made.delete(k); made.set(k, v); while (made.size > MADE_MAX) made.delete(made.keys().next().value); }
/** One piece of speech, from what's made already or made now (and kept). */
function makePiece(voice, speed, t) {
  const k = madeKey(voice, speed, t); const have = made.get(k);
  if (have) { remember(k, have); return Promise.resolve(have); }
  const p = ask({ type: 'speak', text: t, voice, speed }).then((out) => { const v = { audio: out.audio, rate: out.rate }; if (out.device) runsOn = out.device; remember(k, v); return v; }, (e) => { made.delete(k); throw e; });
  remember(k, p); return p;
}
const speedFor = (sp) => Math.max(0.55, Math.min(1.6, sp.rate / (sp.shift ?? 1)));
/**
 * `text` made ready ahead (in the background) in account `a`'s natural voice, so it plays at once when it's said: a
 * reply while its account is "typing", the newest message when a chat opens. Nothing when the natural voices aren't on.
 */
export function prepare(text, a) {
  if (!ready || !naturalOn()) return;
  const words = sayable(text); if (!words) return;
  const sp = speakerFor(a, { naturalReady: true }); if (sp.kind !== 'natural') return;
  for (const t of pieces(words)) makePiece(sp.voice, speedFor(sp), t).catch(() => {});
}

// ---- Samples: each natural voice saying one line, made ahead and kept with the app (voices/), so trying voices out
// plays at once, even before the voices are downloaded.
export const SAMPLE_LINE = 'Hi! This is how I sound.';
export const sampleUrl = (id) => new URL(`./voices/${String(id).replace(/[^a-z0-9]+/gi, '-')}.m4a`, import.meta.url).href;
/** The natural voices taken off the phone (and turned off). */
export async function naturalRemove() {
  try { worker?.terminate(); } catch { /* gone */ }
  worker = null; ready = false; loadP = null; pending.clear(); setNaturalOn(false);
  try { await caches.delete('kokoro-voices'); } catch { /* none */ }
  try { const c = await caches.open('transformers-cache'); for (const r of await c.keys()) if (r.url.includes(TTS_MODEL)) await c.delete(r); } catch { /* none */ }
}

// ---- Playing.
let ctx = null; let playing = null; let token = 0; let synthPrimed = false;
// (Whether the <audio> player was heard moving last time (null: not known yet), and how the last line was played.)
let elWorks = null; let lastRoute = '';
/** Why the last try couldn't be heard ('' when it was): shown to you, not kept. */
export let lastProblem = '';
const audioCtx = () => (ctx ??= new (globalThis.AudioContext || globalThis.webkitAudioContext)());
/**
 * Sound let out, at a tap (call it first thing in the tap, before anything waits): an iPhone only lets a page
 * start sound in the moment of a tap, so the audio is woken (and a silent moment played) and the phone's speech
 * started (silently) now, for what's said a few seconds later, when it's ready. Also plays with the silent
 * switch on (iOS 17's audio session: as video does).
 */
// (The player the natural voices play through: an ordinary <audio> element, the most dependable way to play sound on
// an iPhone. Unlocked at a tap by playing a moment of silence on it; after that it can play what's made later.)
let player = null; let playerUnlocked = false; let unlockP = null;
let silence = ''; // (a tenth of a second of silence, as a blob: the page's rules allow blob: sound, not data:)
function audioEl() {
  if (player || typeof document === 'undefined') return player;
  player = document.createElement('audio'); player.setAttribute('playsinline', ''); player.setAttribute('webkit-playsinline', ''); player.preload = 'auto';
  player.hidden = true; document.body.append(player);
  return player;
}
/** Float samples as a WAV file (16-bit, mono): what the <audio> player plays. */
export function wavOf(samples, rate) {
  const n = samples.length; const b = new DataView(new ArrayBuffer(44 + n * 2)); const str = (o, t) => { for (let i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, rate, true); b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, samples[i] || 0)); b.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true); }
  return new Blob([b.buffer], { type: 'audio/wav' });
}
/** What the sound can do here, for 🔊 Test: a line of facts. */
export function audioReport() {
  const ua = globalThis.navigator?.userAgent ?? ''; const ios = /iPhone|iPad/.test(ua) ? (ua.match(/OS (\d+)_(\d+)/) ?? []).slice(1).join('.') : '';
  const standalone = globalThis.navigator?.standalone || globalThis.matchMedia?.('(display-mode: standalone)').matches;
  return [ios ? `iOS ${ios}` : 'not iOS', standalone ? 'home-screen app' : 'browser tab', `player ${playerUnlocked ? 'unlocked' : 'locked'}`, `audio ${ctx?.state ?? 'not started'}`, `speech ${globalThis.speechSynthesis ? `${phoneVoices().length} voices` : 'none'}`, `natural ${ready ? `loaded (${runsOn === 'webgpu' ? 'graphics chip' : 'processor'})` : 'not loaded'}`, lastRoute ? `last played by ${lastRoute}` : null].filter(Boolean).join(' · ');
}

export function primeAudio() {
  try { if (globalThis.navigator?.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older iOS */ }
  try { const a = audioEl(); if (a && (!playerUnlocked || a.paused)) { silence ||= URL.createObjectURL(wavOf(new Float32Array(2400), 24000)); a.src = silence; const pr = a.play(); unlockP = pr?.then?.(() => { playerUnlocked = true; }, () => {}) ?? null; if (!pr) playerUnlocked = true; } } catch { /* no <audio> */ }
  try {
    const c = audioCtx(); if (c.state !== 'running') c.resume?.();
    const b = c.createBuffer(1, 1, 22050); const src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.start(0);
  } catch { /* no Web Audio */ }
  try { const sy = globalThis.speechSynthesis; if (sy && !synthPrimed) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; sy.speak(u); synthPrimed = true; } } catch { /* none */ }
}
const within = (p, ms, v) => Promise.race([p, new Promise((ok) => setTimeout(() => ok(v), ms))]);
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
export async function speak(text, a, { onStart = () => {}, natural = false, sample = '' } = {}) {
  stopSpeaking(); const my = token; lastProblem = '';
  const words = sayable(text); if (!words) return { kind: 'none' };
  // (`natural`: a natural voice tried out, even with them off. `sample`: its line made ahead (SAMPLE_LINE), played
  // as it is, at once, with or without the voices downloaded.)
  const sp = speakerFor(a, { naturalReady: !!sample || (ready && (naturalOn() || natural)) });
  if (sp.kind === 'natural') {
    try {
      // (Piece by piece: the next made while this one plays. Through the <audio> player when it's unlocked (an
      // iPhone's dependable way), else Web Audio.)
      const a = audioEl(); if (a && !playerUnlocked && unlockP) await within(unlockP, 800); const useEl = !!a && playerUnlocked;
      const parts = sample ? [words] : pieces(words); const shift = sp.shift ?? 1;
      // (Pitch: made at speed ÷ pitch, played back that much faster or slower: higher or deeper, at its own pace.)
      const make = sample ? () => fetch(sample).then((r) => { if (!r.ok) throw new Error('its sample is missing'); return r.arrayBuffer(); }).then((b) => audioCtx().decodeAudioData(b)).then((buf) => ({ audio: buf.getChannelData(0), rate: buf.sampleRate }))
        : (t) => makePiece(sp.voice, speedFor(sp), t);
      let next = make(parts[0]); let started = false;
      for (let i = 0; i < parts.length; i++) {
        // (Never left waiting on a voice that isn't coming: a phone short of memory can stall the model.)
        const out = await within(next, 60000, null); if (my !== token) return { kind: 'natural' };
        if (!out) throw new Error('making the voice took too long');
        if (i + 1 < parts.length) next = make(parts[i + 1]);
        const secs = out.audio.length / out.rate;
        { let peak = 0; for (let k = 0; k < out.audio.length; k += 7) { const x = Math.abs(out.audio[k]); if (x > peak) peak = x; } if (!(peak > 1e-3)) throw new Error('the voice came out silent'); }
        // (Through the <audio> player; if it says it's playing but its clock doesn't move (silent: seen on iPhones),
        // through Web Audio instead, for this and the rest.)
        let viaEl = useEl && elWorks !== false;
        if (viaEl) {
          const url = URL.createObjectURL(wavOf(out.audio, out.rate));
          try {
            a.src = url; a.preservesPitch = false; a.mozPreservesPitch = false; a.webkitPreservesPitch = false; a.playbackRate = shift; playing = { stop: () => { a.pause(); } };
            const ended = new Promise((ok) => { a.onended = () => ok('ended'); a.onerror = () => ok('error'); });
            await a.play();
            const moving = await within(new Promise((ok) => { const t0 = performance.now(); const tick = () => { if (a.currentTime > 0.05 || a.ended) ok(true); else if (performance.now() - t0 > 1500) ok(false); else setTimeout(tick, 60); }; tick(); }), 1600, false);
            if (my !== token) return { kind: 'natural' };
            if (!moving) { a.pause(); elWorks = false; viaEl = false; lastRoute = 'web audio (the player stayed silent)'; } else {
              elWorks = true; lastRoute = 'audio player';
              if (!started) { started = true; onStart(); }
              await within(ended, (secs / shift) * 1000 + 1500);
            }
          } finally { URL.revokeObjectURL(url); }
        }
        if (!viaEl) {
          const c = audioCtx(); if (c.state !== 'running') await within(c.resume().catch(() => {}), 1500);
          if (c.state !== 'running') throw new Error('the phone didn\'t let the sound start (tap 🔊 again)');
          if (!useEl) lastRoute = 'web audio';
          const buf = c.createBuffer(1, out.audio.length, out.rate); buf.copyToChannel(out.audio, 0);
          const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = shift; src.connect(c.destination); playing = src;
          if (!started) { started = true; onStart(); }
          src.start();
          // (Its end, or its length and a moment more: never left waiting if the end isn't heard of.)
          await within(new Promise((ok) => { src.onended = ok; }), (secs / shift) * 1000 + 1500);
        }
        if (my !== token) return { kind: 'natural' };
      }
      return { kind: 'natural' };
    } catch (e) { if (my !== token) return { kind: 'natural' }; lastProblem = `Natural voice: ${e.message}. This phone's voice instead.`; /* this phone's voice instead */ }
  }
  const synth = globalThis.speechSynthesis; if (!synth) return { kind: 'none' };
  const u = new SpeechSynthesisUtterance(words);
  const v = phoneVoices(synth).find((x) => x.id === (sp.kind === 'phone' ? sp.voice : '')) ?? phoneVoices(synth).find((x) => /^en/i.test(x.lang));
  if (v) { u.voice = v.v; u.lang = v.lang; }
  u.rate = Math.max(0.5, Math.min(2, sp.rate)); u.pitch = Math.max(0.5, Math.min(2, sp.pitch));
  let started = false; u.onstart = () => { started = true; onStart(); };
  const err = await within(new Promise((ok) => { u.onend = () => ok(''); u.onerror = (e) => ok(e?.error || 'error'); synth.speak(u); }), Math.max(4000, words.length * 120), 'timeout');
  if (err && err !== 'interrupted' && err !== 'canceled' && !(err === 'timeout' && started)) { lastRoute = 'phone voice (didn\'t start)'; lastProblem = `${lastProblem ? `${lastProblem} ` : ''}This phone's voice didn't play (${err}).`; return { kind: 'none' }; }
  lastRoute = started ? 'phone voice' : 'phone voice (never said it started)';
  return { kind: 'phone' };
}
