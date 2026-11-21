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

import { idb } from '../../lib/idb.js';
import { normalize } from './socials-core.js';

export const KEY = 'cc.socials';
const MEDIA = 'cc.socials.m.';

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
  const raw = await idb.get(KEY);
  const state = normalize(raw);
  const have = await kept(); let lost = 0; let moved = false;
  for (const [o, k, idk] of slots(state)) {
    const id = o[idk]; if (!id) continue;
    if (o[k] instanceof Blob) {
      // (Kept the older way: moved over, if it still reads.)
      const buf = await bytesOf(o[k]); moved = true;
      if (buf && buf.byteLength) { const type = o[k].type || (k === 'video' ? 'video/mp4' : 'image/jpeg'); await idb.set(MEDIA + id, { type, buf }); have.add(id); o[k] = new Blob([buf], { type }); } else { o[k] = null; lost++; }
      continue;
    }
    const rec = have.has(id) ? await idb.get(MEDIA + id) : null;
    if (rec?.buf) o[k] = new Blob([rec.buf], { type: rec.type || '' }); else { o[k] = null; lost++; }
  }
  if (moved) await saveState(state);
  return { state, lost };
}

let queue = Promise.resolve();
/**
 * Keep the state on the phone: the accounts, posts and messages under one key, and each photo or video not
 * kept yet as its bytes. One save after another, in order. Resolves when it's written.
 */
export function saveState(state) {
  const run = async () => {
    const have = await kept();
    for (const [o, k, idk] of slots(state)) {
      const id = o[idk]; if (!id || !o[k] || have.has(id)) continue;
      const buf = await bytesOf(o[k]); if (!buf) continue;
      await idb.set(MEDIA + id, { type: o[k].type || '', buf }); have.add(id);
    }
    const strip = (x, ...ks) => { const c = { ...x }; for (const k of ks) delete c[k]; return c; };
    await idb.set(KEY, { ...state, accounts: state.accounts.map((a) => strip(a, 'avatar')), posts: state.posts.map((p) => ({ ...strip(p, 'image', 'video'), more: (p.more ?? []).map((m) => strip(m, 'image', 'video')) })) });
    // (Files nothing refers to any more (a deleted post's): let go.)
    const used = new Set(slots(state).map(([o, , idk]) => o[idk]).filter(Boolean));
    for (const id of [...have]) if (!used.has(id)) { await idb.del(MEDIA + id); have.delete(id); }
  };
  queue = queue.then(run, run);
  return queue;
}
