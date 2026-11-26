// Socials on the phone: how it's kept in IndexedDB.
//
// The accounts, posts and messages are kept under one key ('cc.socials') with no photos or videos in them;
// each photo and video is kept on its own ('cc.socials.m.<its id>'), as its bytes (an ArrayBuffer and its
// type), written once. Not as a Blob: Safari on iPhone can lose a Blob kept in IndexedDB (it reads back, but
// its data can't be opened any more after the app is closed and opened again). Bytes are kept as they are.
//
// What was kept the older way (Blobs inside the one key) is moved over the first time it's opened: each
// Blob that still reads is kept as bytes; one that doesn't is left without its file (its id kept), so the
// copy in Drive, if there is one, brings it back at the next sync, and until then the post says so.
//
// Encrypted: all of it (the state and each photo and video) with AES-256-GCM under a random data key; that
// key is kept wrapped by the Socials password (PBKDF2-SHA-256, many rounds), so nothing on the phone can be
// read without it. Unlocked once a session (the password, or Face ID where it gives the password back): the
// key is then held for this tab only (session storage), for Socials and the parts of the app that use it (the
// Saved Files scanner). What was kept before, unencrypted, is encrypted in place the first time it's unlocked.

import { idb } from '../../lib/idb.js';
import { normalize } from './socials-core.js';

export const KEY = 'cc.socials';
const MEDIA = 'cc.socials.m.';
const KEYREC = 'cc.socials.key';
const SESSION = 'cc.socials.dk';
const ROUNDS = 210_000;

const b64 = (u8) => { let s2 = ''; const b = new Uint8Array(u8); for (let i = 0; i < b.length; i += 8192) s2 += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s2); };
const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
let dk = null; // (the data key, a CryptoKey, while unlocked)

async function kek(password, salt, rounds = ROUNDS) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const importDk = (raw) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
async function holdDk(key) { dk = key; try { sessionStorage.setItem(SESSION, b64(await crypto.subtle.exportKey('raw', key))); } catch { /* private mode */ } }

/** Whether Socials' data is encrypted on this phone yet (its key made). */
export const dataEncrypted = async () => !!(await idb.get(KEYREC));
/** The data key, if it's unlocked in this tab: a CryptoKey, or null. */
export async function dataKey() {
  if (dk) return dk;
  try { const s2 = sessionStorage.getItem(SESSION); if (s2) { dk = await importDk(unb64(s2)); return dk; } } catch { /* none */ }
  return null;
}
/** Locked again: the key forgotten in this tab. */
export function lockData() { dk = null; try { sessionStorage.removeItem(SESSION); } catch { /* private mode */ } }

/** Data encrypted with the key: { enc: 1, iv, ct } (ct an ArrayBuffer). */
async function seal(key, bytes) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { enc: 1, iv: b64(iv), ct: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes) }; }
async function open(key, rec) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, rec.ct); }

/**
 * The data unlocked with the Socials password: true, or false if it's the wrong one. The first time (no key
 * yet): a key made and wrapped by it, and anything kept unencrypted encrypted in place.
 */
export async function unlockData(password) {
  const rec = await idb.get(KEYREC);
  if (rec) {
    try { const k = await kek(password, unb64(rec.salt), rec.rounds); const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, k, unb64(rec.wrapped)); await holdDk(await importDk(raw)); return true; } catch { return false; }
  }
  const raw = crypto.getRandomValues(new Uint8Array(32)); const key = await importDk(raw);
  await wrapWith(password, raw);
  await holdDk(key);
  await encryptInPlace(key);
  return true;
}
async function wrapWith(password, raw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await kek(password, salt), raw);
  await idb.set(KEYREC, { v: 1, salt: b64(salt), rounds: ROUNDS, iv: b64(iv), wrapped: b64(wrapped) });
}
/**
 * Starting over on this phone with a new password (after the recovery key opened the copy in Drive: what's kept
 * here was locked by the old one, which is forgotten): this phone's copy let go, a new key; the next sync brings
 * everything back from Drive.
 */
export async function resetData(password) {
  for (const k2 of (await idb.keys()).map(String).filter((x) => x === KEY || x === KEYREC || x.startsWith(MEDIA))) await idb.del(k2);
  keptIds = null; lockData();
  return unlockData(password);
}
/** The data key wrapped by a new password (the password changed): the data itself stays as it is. */
export async function rewrapData(password) {
  const key = await dataKey(); if (!key) throw new Error("Socials' data is locked.");
  await wrapWith(password, new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}
/** What's kept unencrypted (from before), encrypted with the key. */
async function encryptInPlace(key) {
  // (The state itself: encrypted the next time it's loaded and saved, once anything kept the oldest way (Blobs in
  // it) has been moved over (loadState).)
  for (const k2 of (await idb.keys()).map(String).filter((x) => x.startsWith(MEDIA))) {
    const r = await idb.get(k2); if (r?.buf && !r.enc) await idb.set(k2, { type: r.type || '', ...(await seal(key, r.buf)) });
  }
}
/** The state as kept: decrypted (with the key) or as it was (from before). */
async function readKept(key) {
  const raw = await idb.get(KEY);
  if (raw?.enc) { if (!key) throw new Error('Socials is locked.'); return JSON.parse(new TextDecoder().decode(await open(key, raw))); }
  return raw;
}
/** A photo or video's bytes as kept: { type, buf } (decrypted), or null. */
async function readMedia(key, id) {
  const r = await idb.get(MEDIA + id); if (!r) return null;
  if (r.enc) { if (!key) return null; try { return { type: r.type, buf: await open(key, r) }; } catch { return null; } }
  return r.buf ? r : null;
}

/** Every photo and video the state refers to: [item, field, idField]. */
const slots = (state) => [
  ...state.accounts.map((a) => [a, 'avatar', 'avatarId']),
  ...state.posts.flatMap((p) => [[p, 'image', 'imageId'], [p, 'video', 'videoId'], ...(p.more ?? []).flatMap((m) => [[m, 'image', 'imageId'], [m, 'video', 'videoId']])]),
];

/** A Blob's bytes, or null when they can't be read (lost). */
async function bytesOf(b) {
  try { return await b.arrayBuffer(); } catch { return null; }
}

/** The ids whose bytes are kept already (so each is written once). */
let keptIds = null;
async function kept() {
  if (!keptIds) keptIds = new Set((await idb.keys()).map(String).filter((k) => k.startsWith(MEDIA)).map((k) => k.slice(MEDIA.length)));
  return keptIds;
}

/**
 * The state from the phone, photos and videos as Blobs made from their kept bytes (fresh ones, in memory).
 * { state, lost: number of photos or videos whose files couldn't be read }.
 */
export async function loadState() {
  const key = await dataKey(); if (!key && await dataEncrypted()) throw new Error('Socials is locked.');
  const raw = await readKept(key);
  const state = normalize(raw);
  const have = await kept(); let lost = 0; let moved = false;
  for (const [o, k, idk] of slots(state)) {
    const id = o[idk]; if (!id) continue;
    if (o[k] instanceof Blob) {
      // (Kept the older way: moved over, if it still reads.)
      const buf = await bytesOf(o[k]); moved = true;
      if (buf && buf.byteLength) { const type = o[k].type || (k === 'video' ? 'video/mp4' : 'image/jpeg'); await idb.set(MEDIA + id, key ? { type, ...(await seal(key, buf)) } : { type, buf }); have.add(id); o[k] = new Blob([buf], { type }); } else { o[k] = null; lost++; }
      continue;
    }
    const rec = have.has(id) ? await readMedia(key, id) : null;
    if (rec?.buf) o[k] = new Blob([rec.buf], { type: rec.type || '' }); else { o[k] = null; lost++; }
  }
  // (Moved over, or kept unencrypted from before: written again, encrypted.)
  if (moved || (key && raw && !raw.enc)) await saveState(state);
  return { state, lost };
}

let queue = Promise.resolve();
/**
 * Keep the state on the phone: the accounts, posts and messages under one key, and each photo or video not
 * kept yet as its bytes. One save after another, in order. Resolves when it's written.
 */
export function saveState(state) {
  const run = async () => {
    // (Never written unencrypted once Socials has its key; locked, nothing written at all.)
    const key = await dataKey(); if (!key && await dataEncrypted()) throw new Error('Socials is locked: nothing saved.');
    const have = await kept();
    for (const [o, k, idk] of slots(state)) {
      const id = o[idk]; if (!id || !o[k] || have.has(id)) continue;
      const buf = await bytesOf(o[k]); if (!buf) continue;
      await idb.set(MEDIA + id, key ? { type: o[k].type || '', ...(await seal(key, buf)) } : { type: o[k].type || '', buf }); have.add(id);
    }
    const strip = (x, ...ks) => { const c = { ...x }; for (const k of ks) delete c[k]; return c; };
    const plain = { ...state, accounts: state.accounts.map((a) => strip(a, 'avatar')), posts: state.posts.map((p) => ({ ...strip(p, 'image', 'video'), more: (p.more ?? []).map((m) => strip(m, 'image', 'video')) })) };
    await idb.set(KEY, key ? await seal(key, new TextEncoder().encode(JSON.stringify(plain))) : plain);
    // (Files nothing refers to any more (a deleted post's): let go.)
    const used = new Set(slots(state).map(([o, , idk]) => o[idk]).filter(Boolean));
    for (const id of [...have]) if (!used.has(id)) { await idb.del(MEDIA + id); have.delete(id); }
  };
  queue = queue.then(run, run);
  return queue;
}
