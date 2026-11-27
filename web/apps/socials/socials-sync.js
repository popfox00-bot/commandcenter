// Socials between devices: a copy of everything (accounts, posts, photos) in a "Socials" folder of your own
// Google Drive (your Saved Files folder, through your Saved Files script), encrypted on the phone with your
// Socials password before it goes, so Drive only ever has scrambled data. Another phone signed in to the
// same Saved Files opens it with the same password and the two are merged (mergeStates): each account and
// post as last changed on either, deletions kept.
//
// In the folder:
//   socials-key.json        the key that encrypts it all, itself encrypted twice: with your password and
//                           with a recovery key shown once (vault.js, as Saved Files' own encryption).
//   socials-data.ccs        the accounts and posts (no photos), encrypted.
//   socials-m-<id>.ccs      each photo and video, encrypted, uploaded once (it never changes; a new one has a
//                           new id). A video over MAX_MEDIA stays on the phone it was posted from (Saved
//                           Files takes 25 MB a file at most); the others show it can't be played there.
// Each .ccs file is "CCS1" | IV (12 bytes) | AES-256-GCM(the content).

import { createVault, unlock, changePassword, cleanRecoveryKey, ITERATIONS } from '../../lib/vault.js';
import { mergeStates, normalize } from './socials-core.js';

export const FOLDER = 'Socials';
export const KEY_FILE = 'socials-key.json';
export const DATA_FILE = 'socials-data.ccs';
const mediaName = (id) => `socials-m-${id}.ccs`;
const MAGIC = new TextEncoder().encode('CCS1');
export const MAX_MEDIA = 24 * 1024 * 1024;

/** The password doesn't open the copy in Drive (it was made with another one). */
export class WrongPassword extends Error { constructor() { super('That isn\'t the password of the Socials copy in your Drive.'); this.name = 'WrongPassword'; } }

async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(4 + 12 + ct.length); out.set(MAGIC, 0); out.set(iv, 4); out.set(ct, 16);
  return out;
}
async function open(key, bytes) {
  const b = new Uint8Array(bytes);
  if (b.length < 16 || MAGIC.some((v, i) => b[i] !== v)) throw new Error('Not a Socials file.');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(4, 16) }, key, b.subarray(16)));
}

/** The Socials folder's files in Drive: { byName: Map(name → { id, name }) }, empty when there's no folder yet. */
async function listFolder(api) {
  const folders = await api.folders();
  const f = folders.find((x) => x.path === FOLDER || (x.name === FOLDER && !String(x.path ?? '').includes('/')));
  const files = f ? (await api.browse(f.id)).files : [];
  return new Map(files.map((x) => [x.name, x]));
}

const upload = (api, name, bytes, type = 'application/octet-stream') => api.upload(new File([bytes], name, { type }), 'Socials', FOLDER);
const download = async (api, id) => new Uint8Array(await (await api.download(id)).arrayBuffer());

/**
 * Whether there's a Socials copy in Drive already (another phone made it): its key file's contents, or null.
 */
export async function remoteHeader(api) {
  const files = await listFolder(api); const k = files.get(KEY_FILE);
  return k ? JSON.parse(new TextDecoder().decode(await download(api, k.id))) : null;
}

/** Whether `secret` (the password, or the recovery key) opens the copy in Drive with `header`. */
export async function opens(header, secret) { try { await unlock(header, secret); return true; } catch { return false; } }

/** The copy in Drive given a new password (opened with the current one or the recovery key). */
export async function changeRemotePassword(api, secret, newPassword) {
  const header = await remoteHeader(api); if (!header) return false;
  let h; try { h = await changePassword(header, secret, newPassword); } catch { throw new WrongPassword(); }
  await upload(api, KEY_FILE, new TextEncoder().encode(JSON.stringify(h)), 'application/json');
  return true;
}

export const isRecoveryKey = (s) => !!cleanRecoveryKey(s);

/**
 * One sync: what's in Drive merged with `local` (the state on this phone, photos as Blobs), the photos this
 * phone lacks fetched, those Drive lacks sent, and the merged copy sent back. Resolves to { state (merged,
 * with Blobs), recoveryKey (only when the copy in Drive was made just now: show it once), sent, fetched }.
 * Throws WrongPassword when the copy in Drive has another password; other errors when Drive can't be reached.
 */
export async function syncSocials(api, local, password, { iterations = ITERATIONS, onProgress = null } = {}) {
  let files = await listFolder(api);
  // The key: Drive's, opened with the password; or a new one, made now.
  let key; let recoveryKey = null;
  const kf = files.get(KEY_FILE);
  if (kf) {
    const header = JSON.parse(new TextDecoder().decode(await download(api, kf.id)));
    try { key = await unlock(header, password); } catch { throw new WrongPassword(); }
  } else {
    const v = await createVault(password, { iterations });
    key = v.key; recoveryKey = v.recoveryKey;
    await upload(api, KEY_FILE, new TextEncoder().encode(JSON.stringify(v.header)), 'application/json');
    files = await listFolder(api);
  }
  // What's in Drive, merged with this phone's.
  let remote = null;
  const df = files.get(DATA_FILE);
  if (df) remote = JSON.parse(new TextDecoder().decode(await open(key, await download(api, df.id))));
  const blobs = new Map();
  for (const a of local.accounts) if (a.avatar && a.avatarId) blobs.set(a.avatarId, a.avatar);
  for (const p of local.posts) for (const o of [p, ...(p.more ?? [])]) { if (o.image && o.imageId) blobs.set(o.imageId, o.image); if (o.video && o.videoId) blobs.set(o.videoId, o.video); }
  const state = remote ? mergeStates(local, normalize({ ...remote, me: local.me })) : normalize(local);
  // (Every photo it uses: here already, or fetched from Drive.)
  const needs = [...state.accounts.map((a) => [a, 'avatar', 'avatarId']), ...state.posts.map((p) => [p, 'image', 'imageId']), ...state.posts.map((p) => [p, 'video', 'videoId']), ...state.posts.flatMap((p) => (p.more ?? []).flatMap((m) => [[m, 'image', 'imageId'], [m, 'video', 'videoId']]))].filter(([o, , idk]) => o[idk]);
  let fetched = 0; let sent = 0;
  await pool(needs, 4, async ([o, k, idk]) => {
    const id = o[idk];
    if (blobs.has(id)) { o[k] = blobs.get(id); return; }
    const f = files.get(mediaName(id));
    if (!f) { o[k] = null; return; } // (Not sent yet by the phone that has it: it comes next time.)
    const bytes = await open(key, await download(api, f.id));
    const type = k === 'video' ? videoType(bytes) : bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
    o[k] = new Blob([bytes], { type }); blobs.set(id, o[k]); fetched++;
  });
  // (Each photo Drive doesn't have yet, sent once.)
  const uniq = new Map(); for (const [o, k, idk] of needs) if (o[k] && o[k].size <= MAX_MEDIA && !files.has(mediaName(o[idk]))) uniq.set(o[idk], o[k]);
  // (How far along: each file sent, then the accounts and posts themselves.)
  const total = uniq.size + 1; const tell = () => { try { onProgress?.({ done: sent, total }); } catch { /* the caller's */ } };
  tell();
  await pool([...uniq], 3, async ([id, blob]) => { await upload(api, mediaName(id), await seal(key, new Uint8Array(await blob.arrayBuffer()))); sent++; tell(); });
  // The merged copy, without the photos themselves, back to Drive.
  const wire = { v: 1, at: Date.now(), gone: state.gone, accounts: state.accounts.map(({ avatar, ...a }) => a), posts: state.posts.map(({ image, video, ...p }) => ({ ...p, more: (p.more ?? []).map(({ image: i2, video: v2, ...m }) => m) })), messages: state.messages, groups: state.groups ?? [], reads: state.reads };
  await upload(api, DATA_FILE, await seal(key, new TextEncoder().encode(JSON.stringify(wire))));
  try { onProgress?.({ done: total, total }); } catch { /* the caller's */ }
  // (Which photos and videos Drive has now: what's still to send, until the next sync, is the rest.)
  const driveMedia = [...files.keys()].filter((n) => n.startsWith('socials-m-')).map((n) => n.slice(10, -4)).concat([...uniq.keys()]);
  return { state, recoveryKey, sent, fetched, driveMedia };
}

/**
 * How many files are waiting to go to Drive: each photo or video on this phone that Drive doesn't have yet
 * (`driveMedia`: the ids it had at the last sync; a video too big for it never goes, so isn't counted), and
 * the accounts-and-posts file when anything changed since (`dirty`).
 */
export function pendingFiles(state, driveMedia, dirty) {
  const have = new Set(driveMedia ?? []); const ids = new Set();
  for (const a of state.accounts) if (a.avatar && a.avatarId && !have.has(a.avatarId)) ids.add(a.avatarId);
  for (const p of state.posts) for (const o of [p, ...(p.more ?? [])]) {
    if (o.image && o.imageId && !have.has(o.imageId)) ids.add(o.imageId);
    if (o.video && o.videoId && o.video.size <= MAX_MEDIA && !have.has(o.videoId)) ids.add(o.videoId);
  }
  return ids.size + (dirty ? 1 : 0);
}

/** A video's type from its first bytes: MP4/MOV ('ftyp', QuickTime's 'qt  ' brand) or WebM. */
function videoType(b) {
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
  return brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
}

/** fn over items, at most n at a time. */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}
