// Socials' AI replies: an on-device language model (socials-ai-worker.js) writes the reply when the Owner
// messages one of their accounts, from the whole conversation, in that account's voice and at the chosen level
// (Tame … Adult). Turned on in Sync and password: a one-time download (~1.2 GB) from Hugging Face, then it
// works offline. It needs WebGPU (iPhone with iOS 26 or later, current Chrome/Edge): without it, or while it
// loads, or when what it writes doesn't hold up (too long, off topic, sounding like an assistant), the reply
// comes from the built-in engine (socials-chat.js) as before. Nothing you write, nor anything written back, ever
// leaves the phone: the worker's network is fenced in (socials-ai-guard.js): the model's own files, downloaded
// once, and then nothing remote at all.

import { store } from '../../lib/dom.js';
import { cleanWords } from './socials-style.js';

export const AI_MODEL = 'onnx-community/Qwen2.5-1.5B-Instruct';
export const AI_SIZE = '1.2 GB';
const KEY = 'cc.socials.ai';

/** Whether AI replies are turned on (they still need the model downloaded and WebGPU). */
export const aiOn = () => store.get(KEY) === 'on';
export const setAiOn = (on) => store.set(KEY, on ? 'on' : 'off');

/** Whether this device can run it: { ok, why }. */
export async function aiSupport() {
  try {
    if (!globalThis.navigator?.gpu) return { ok: false, why: 'This browser has no WebGPU (on iPhone it comes with iOS 26).' };
    const ad = await navigator.gpu.requestAdapter();
    if (!ad) return { ok: false, why: 'No graphics adapter for WebGPU on this device.' };
    if (!ad.features?.has?.('shader-f16')) return { ok: false, why: 'This device\'s GPU can\'t run the model (no 16-bit shaders).' };
    return { ok: true, why: '' };
  } catch (e) { return { ok: false, why: `WebGPU isn't working here (${e.message}).` }; }
}

/** Whether the model is downloaded (kept by the browser). */
export async function aiDownloaded() {
  try { const c = await caches.open('transformers-cache'); return (await c.keys()).some((r) => r.url.includes(AI_MODEL) && /model_q4f16\.onnx/.test(r.url)); } catch { return false; }
}

let worker = null; let seq = 0; const pending = new Map(); let ready = false; let loadP = null;
function w() {
  if (worker) return worker;
  worker = new Worker(new URL('./socials-ai-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { const p = pending.get(e.data?.id); if (!p) return; if (e.data.type === 'progress') p.progress?.(e.data); else { pending.delete(e.data.id); if (e.data.type === 'error') p.reject(new Error(e.data.error)); else p.resolve(e.data); } };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'The AI worker stopped.')); pending.clear(); worker = null; ready = false; loadP = null; };
  return worker;
}
const ask = (msg, progress) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject, progress }); w().postMessage({ id, ...msg }); });

/**
 * The model loaded (downloaded the first time): `onProgress(0..1, bytesLoaded, bytesTotal)`. Resolves when
 * it's ready.
 */
export function aiLoad(onProgress = () => {}, options = {}) {
  if (ready) return Promise.resolve();
  const files = new Map();
  // (Downloading allowed only when it isn't on the phone yet; the worker refuses anything remote otherwise.)
  loadP ??= aiDownloaded().then((have) => ask({ type: 'load', options: { ...options, download: options.download ?? !have } }, (p) => {
    if (!p.file) return; files.set(p.file, { loaded: p.status === 'done' ? (p.total || files.get(p.file)?.total || 0) : p.loaded, total: p.total || files.get(p.file)?.total || 0 });
    let l = 0; let t = 0; for (const f of files.values()) { l += f.loaded; t += f.total; }
    onProgress(t ? Math.min(1, l / t) : 0, l, t);
  })).then(() => { ready = true; }, (e) => { loadP = null; throw e; });
  return loadP;
}
export const aiReady = () => ready;

/** The model and its engine taken off the phone (and turned off). */
export async function aiRemove() {
  try { worker?.terminate(); } catch { /* gone */ }
  worker = null; ready = false; loadP = null; pending.clear(); setAiOn(false);
  try { await caches.delete('transformers-cache'); } catch { /* none */ }
  try { for (const k of await caches.keys()) if (k.startsWith('ai-lib-')) await caches.delete(k); } catch { /* none */ }
}

const PERSONA_TEXT = {
  hype: 'high energy and excitable, big reactions, caps and emojis',
  chill: 'laid-back and dry, short and lowercase, few emojis',
  warm: 'sweet and affectionate, supportive, uses hearts',
  witty: 'playful and funny, teasing one-liners',
  classic: 'friendly and natural',
};
const LEVEL_TEXT = [
  'Keep it clean: never swear.',
  'Mild words like damn or hell are okay now and then; nothing stronger.',
  'You swear casually and freely (fuck, shit, damn), like close friends do.',
  'Adult, uncensored banter between adults: swear freely; crude jokes and flirty innuendo are fine. Never write explicit sexual descriptions.',
];
const SHOTS = [
  { role: 'user', content: 'just finished my first marathon' }, { role: 'assistant', content: 'wait you ran a whole marathon?? legend. are your legs dead' },
  { role: 'user', content: 'my landlord raised the rent again' }, { role: 'assistant', content: 'ugh again?? thats so annoying. are you gonna fight it' },
];
const BAD = /\b(as an ai|ai language|assist(ant|ance)?|help you|let me know if|feel free|i understand|how can i|what can i do|i'm here (for|to)|happy to help|glad to help|any tips|some tips|advice|recommend(ation)?s?|<\/?think>|user|assistant)\b/i;
const words = (s) => (String(s ?? '').toLowerCase().match(/[a-z']{3,}/g) ?? []).filter((w) => !/^(the|and|you|but|for|not|are|was|how|can|get|got|did|has|had|its|our|out|too|yes|yeah|omg|lol|that|this|with|have|just|what|your|they|them|then|from|been|were|will|would|about|really|there|their|when|like|it's|i'm|you're|thats|so)$/.test(w));

/** The model's text checked and tidied: one message, the right length, on topic, a friend's not an assistant's; else null. */
export function checkReply(text, { said = '', draft = '', level = 0, name = '' } = {}) {
  let t = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().split(/\n+/)[0].trim();
  t = t.replace(new RegExp(`^(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|me|reply)\\s*:\\s*`, 'i'), '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
  const n = t.split(/\s+/).filter(Boolean).length;
  if (n < 2 || n > 32 || BAD.test(t)) return null;
  // (About what was said: a word of theirs or of the reply it was to mean.)
  const k = new Set([...words(said), ...words(draft)]);
  if (k.size && !words(t).some((x) => k.has(x)) && n > 6) return null;
  return cleanWords(t, level);
}

/**
 * A reply written by the model, or null (not ready, too slow, or it didn't hold up): `history` [{ mine, text,
 * post? }] oldest first; `them`: the account's handle; `me`: the Owner's; `persona`, `style` (socials-style),
 * `level` (0–3); `draft`: the built-in engine's reply, what it should roughly mean.
 */
export async function aiReply({ history, them, me, persona = 'classic', style = null, level = 0, draft = '', timeout = 15000 }) {
  if (!ready) return null;
  const styleText = style ? `${style.lower ? 'You text in all lowercase. ' : ''}${style.emoji < 0.25 ? 'Hardly any emojis. ' : style.emoji >= 1.5 ? 'Lots of emojis. ' : ''}${style.short ? 'Keep it very short. ' : ''}${style.slang?.length ? `You both say things like ${style.slang.slice(0, 3).join(', ')}. ` : ''}` : '';
  const system = `You are ${them}, texting your close friend ${me} on a private social app. Your vibe: ${PERSONA_TEXT[persona] ?? PERSONA_TEXT.classic}. ${styleText}${LEVEL_TEXT[level] ?? LEVEL_TEXT[0]}
Write the next text in this chat: ONE short message (6-25 words). Respond to exactly what ${me} just said, in your own words, and add your own thought, a detail, or a quick question. Casual texting only. You are a friend, never an assistant: no advice, no offers of help, never mention being an AI.${draft ? `\nYour reply should mean roughly: "${draft.replace(/\n/g, ' ')}" (say it your own way).` : ''}`;
  const turns = (history ?? []).slice(-12).map((m) => ({ role: m.mine ? 'user' : 'assistant', content: m.text || (m.post ? `[shared a post${m.post.caption ? `: "${m.post.caption.slice(0, 120)}"` : ''}]` : '') })).filter((m) => m.content);
  // (Two in a row from the same side: one turn.)
  const merged = []; for (const t of turns) { const last = merged[merged.length - 1]; if (last && last.role === t.role) last.content += `\n${t.content}`; else merged.push({ ...t }); }
  if (!merged.length || merged[merged.length - 1].role !== 'user') return null;
  const said = merged[merged.length - 1].content;
  try {
    const out = await Promise.race([ask({ type: 'generate', messages: [{ role: 'system', content: system }, ...SHOTS, ...merged] }), new Promise((_, bad) => setTimeout(() => bad(new Error('slow')), timeout))]);
    return checkReply(out.text, { said, draft, level, name: them });
  } catch { return null; }
}

// ---- Comments and captions, written by the model from what the photo shows (describeScene) and its caption,
// each checked (one short line, on the post, a friend's not an assistant's) and given the engine's own as a
// guide; anything that doesn't hold up is left to the engine's.

const CBAD = /\b(as an ai|assist(ant|ance)?|help you|let me know|feel free|i understand|how can i|image|picture shows|the photo shows|description|caption:|comment:|user|assistant|hashtag)\b/i;
/** A comment or caption from the model checked and tidied, or null. `about`: words it should touch on. */
export function checkLine(text, { about = '', level = 0, min = 2, max = 22, name = '' } = {}) {
  let t = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/[*_`]+/g, '').trim().split(/\n+/)[0].trim();
  t = t.replace(/(\s+#[\p{L}\p{N}_]+)+[^\p{L}\p{N}#]{0,8}$/u, (m) => m.replace(/#[\p{L}\p{N}_]+/gu, '')).trim(); // (hashtags at the end: let go)
  t = t.replace(/^([^\p{L}\p{N}"'“]*)["'“]+/u, '$1').replace(/["'”]+([^\p{L}\p{N}"'”]*)$/u, '$1').trim(); // (quotes round it, emoji outside them)
  t = t.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').replace(new RegExp(`^(${(name || 'x').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|comment|caption|me)\\s*:\\s*`, 'i'), '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
  const n = t.split(/\s+/).filter(Boolean).length;
  if (n < min || n > max || CBAD.test(t) || /#\w/.test(t) || /\b(background|feels like|skyline|sounds (delicious|amazing|epic|great|fun|good))\b/i.test(t) || /[\u3000-\u9fff\uac00-\ud7af\u0400-\u04ff]/.test(t)) return null;
  // (A title (Most Words Capitalized), not a line someone would write.)
  const ws = t.match(/\p{L}[\p{L}']*/gu) ?? []; if (ws.length >= 4 && ws.filter((w) => /^\p{Lu}/u.test(w)).length / ws.length > 0.6 && t !== t.toUpperCase()) return null;
  const k = new Set(words(about)); if (k.size && n > 5 && !words(t).some((x) => k.has(x))) return null;
  return cleanWords(t, level);
}
const race = (p, ms) => Promise.race([p, new Promise((_, bad) => setTimeout(() => bad(new Error('slow')), ms))]);

/**
 * Comments on a post by the model, one per commenter (`as`: [{ handle, persona }]), or the engine's (`drafts`,
 * one each) where the model's don't hold up: always as many as `as`. `scene`: describeScene's; `caption`, `by`
 * (the poster's handle), `level` (0–3), `avoid` (comments already there).
 */
export async function aiComments({ as, drafts, scene = '', caption = '', by = '', level = 0, avoid = [], timeout = 12000 }) {
  const out = [...drafts];
  if (!ready || !as?.length) return out;
  const seen = new Set(avoid.map((a) => String(a).toLowerCase()));
  const deadline = Date.now() + timeout * Math.min(as.length, 3);
  for (const [i, who] of as.entries()) {
    const left = deadline - Date.now(); if (left < 1500) break;
    const system = `You are ${who.handle}, a close friend of ${by}, commenting on their post on a private social app. Your vibe: ${PERSONA_TEXT[who.persona] ?? PERSONA_TEXT.classic}. ${LEVEL_TEXT[level] ?? LEVEL_TEXT[0]}
Write ONE short comment (4-16 words) about something specific in the post, like a friend would: a reaction, a compliment, a tease or a quick question. No hashtags. Never describe the photo like a caption; never mention being an AI.`;
    const user = `${by}'s post. ${scene ? `What's in it: ${scene}.` : ''}${caption ? ` Their caption: "${caption.slice(0, 200)}".` : ''}${seen.size ? ` Already said (don't repeat): ${[...seen].slice(-4).map((x) => `"${x}"`).join(', ')}.` : ''}${drafts[i] ? ` Something like "${drafts[i]}" but in your own words.` : ''}`;
    try {
      const r = await race(ask({ type: 'generate', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], options: { max_new_tokens: 40, temperature: 0.85 } }), left);
      const t = checkLine(r.text, { about: `${scene} ${caption} ${drafts[i] ?? ''}`, level, name: who.handle });
      if (t && !seen.has(t.toLowerCase())) { out[i] = t; seen.add(t.toLowerCase()); }
    } catch { break; }
  }
  return out;
}

const CAP_SHOTS = [
  { role: 'user', content: 'What\'s in my photo: one person; with coffee; wearing beige cardigan; in the morning.' }, { role: 'assistant', content: 'cardigan weather and a latte, that\'s the whole plan ☕' },
  { role: 'user', content: 'What\'s in my photo: 3 people; feels like: friends, beach; background: sand, water.' }, { role: 'assistant', content: 'salty hair, sandy feet, best people 🌊' },
];
/** A caption by the model from what the photo shows (`scene`), as `handle` in its `persona`'s voice, or null: the engine's (`draft`) as a guide. */
export async function aiCaption({ scene = '', draft = '', level = 0, avoid = [], handle = '', persona = 'classic', timeout = 12000 }) {
  if (!ready || !scene) return null;
  const system = `You are ${handle || 'someone'}, writing the caption for your own photo on a private social app, in first person, like a real post: short, specific to what's in it, in your own voice (${PERSONA_TEXT[persona] ?? PERSONA_TEXT.classic}), an emoji is fine. ${LEVEL_TEXT[Math.min(level, 1)]} No hashtags. ONE line, 3-14 words. Never describe the photo literally; never mention being an AI.`;
  const user = `What's in my photo: ${scene}.${draft ? ` An idea: "${draft.replace(/\s#\S+/g, '')}" (write your own, more specific).` : ''}${avoid.length ? ` Not these: ${avoid.slice(-3).map((a) => `"${a}"`).join(', ')}.` : ''}`;
  try {
    const r = await race(ask({ type: 'generate', messages: [{ role: 'system', content: system }, ...CAP_SHOTS, { role: 'user', content: user }], options: { max_new_tokens: 36, temperature: 0.8 } }), timeout);
    const t = checkLine(r.text, { about: `${scene} ${draft}`, level: Math.min(level, 1), min: 2, max: 16 });
    return t && !avoid.some((a) => String(a).toLowerCase().startsWith(t.toLowerCase())) ? t : null;
  } catch { return null; }
}
