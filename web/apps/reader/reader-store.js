// Reader's library on this phone: files in folders, every one encrypted (AES-256-GCM, a random 12-byte IV each) with
// Reader's own 256-bit key, compressed first where that makes it smaller; the list of files and folders (names, sizes,
// where each is) encrypted too, so nothing on the phone shows what's in it.
//
// The key is kept three ways: wrapped by a key of this device that the browser won't hand out (non-extractable, kept in
// IndexedDB), so with the Vault open it opens by itself; and, as Saved Files' are (lib/vault.js, decryption/FORMAT.md),
// wrapped by Reader's password and by a recovery key (PBKDF2-SHA256, 600,000 rounds), for packages opened on another
// device and for a new phone. Packages made from the library (reader-core.js lock) carry those two wraps, so its
// password or recovery key opens them anywhere, with decrypt.html too.

import { idb } from '../../lib/idb.js';
import { createVaultRaw, unlockRaw, keyFromRaw } from '../../lib/vault.js';

const KEYREC = 'cc.reader.key'; const DEVKEY = 'cc.reader.dev'; const INDEX = 'cc.reader.index'; const FILE = 'cc.reader.f.';
const subtle = globalThis.crypto.subtle;
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const enc = new TextEncoder(); const dec = new TextDecoder();

let session = null; // { key (CryptoKey), header }: while the app's open

/** Whether Reader has been set up on this phone (its key made). */
export const isSetUp = async () => !!(await idb.get(KEYREC));
/** The key in use now ({ key, header }), or null. */
export const current = () => session;

/**
 * Reader set up: a new key, wrapped by `password` and a new recovery key (shown once: returned) and by a new key of
 * this device. Opens it.
 */
export async function setUp(password) {
  if (String(password).length < 8) throw new Error('Use a password of at least 8 characters.');
  const { header, raw, recoveryKey } = await createVaultRaw(password);
  const dev = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = rand(12); const wrapped = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, dev, raw));
  await idb.set(DEVKEY, dev); await idb.set(KEYREC, { v: 1, header, dev: { iv, ct: wrapped } });
  session = { key: await keyFromRaw(raw), header }; raw.fill(0);
  if (!(await idb.get(INDEX))) await saveIndex({ folders: [], files: [] });
  return recoveryKey;
}
/** Opened by this device's own key (with the Vault open: no password). True, or false when it can't be (a new phone). */
export async function openHere() {
  if (session) return true;
  const rec = await idb.get(KEYREC); const dev = await idb.get(DEVKEY); if (!rec || !dev) return false;
  try { const raw = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: rec.dev.iv }, dev, rec.dev.ct)); session = { key: await keyFromRaw(raw), header: rec.header }; raw.fill(0); return true; } catch { return false; }
}
/** Opened by Reader's password or recovery key (and this device's key made again, so next time it opens by itself). */
export async function openWith(secret) {
  const rec = await idb.get(KEYREC); if (!rec) throw new Error('Reader isn\'t set up on this phone.');
  const raw = await unlockRaw(rec.header, secret);
  const dev = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = rand(12); const wrapped = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, dev, raw));
  await idb.set(DEVKEY, dev); await idb.set(KEYREC, { ...rec, dev: { iv, ct: wrapped } });
  session = { key: await keyFromRaw(raw), header: rec.header }; raw.fill(0);
}
/** Closed: the key forgotten until it's opened again. */
export const close = () => { session = null; };

const need = () => { if (!session) throw new Error('Reader is locked.'); return session.key; };
async function seal(bytes) { const iv = rand(12); return { iv, ct: new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, need(), bytes)) }; }
async function unseal(rec) { try { return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, need(), rec.ct)); } catch { throw new Error('This file couldn\'t be opened (it was changed, or made with another key).'); } }
const deflate = async (b) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
const inflate = async (b) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());

/** The library's list: { folders: [{ id, name, parent }], files: [{ id, name, type, size, stored, folder, at, z }] }. */
export async function loadIndex() {
  const rec = await idb.get(INDEX); if (!rec) return { folders: [], files: [] };
  return JSON.parse(dec.decode(await unseal(rec)));
}
async function saveIndex(ix) { await idb.set(INDEX, await seal(enc.encode(JSON.stringify(ix)))); }

/** A folder made (in `parent`, null for the top): its id. A name used there already is reused (or, `unique`, numbered). */
export async function newFolder(name, parent = null, ix0 = null, { unique = false } = {}) {
  const ix = ix0 ?? await loadIndex(); let n = String(name ?? '').trim().slice(0, 80) || 'New folder';
  const taken = (x) => ix.folders.some((f) => f.parent === parent && f.name.toLowerCase() === x.toLowerCase());
  // (`unique`: a new one beside one of that name, "Trip (2)"; else that one's used.)
  if (unique) { const b = n; for (let i = 2; taken(n); i++) n = `${b} (${i})`; }
  const had = ix.folders.find((f) => f.parent === parent && f.name.toLowerCase() === n.toLowerCase()); if (had) return had.id;
  const f = { id: newId(), name: n, parent, at: Date.now() }; ix.folders.push(f);
  if (!ix0) await saveIndex(ix);
  return f.id;
}
/** The folder for a path ("Trips/Beach") under `parent`, made as needed. */
async function folderFor(ix, path, parent) {
  let at = parent; for (const part of path.split('/').filter(Boolean)) at = await newFolder(part, at, ix);
  return at;
}

/**
 * Files added to `folder` (null for the top): each compressed where that helps, encrypted and kept. A name with a path
 * ("Trips/Beach/a.jpg", from a ZIP or a folder picked) goes into those folders, made as needed. `onProgress(done, total)`.
 * Resolves to the files added (their index entries).
 */
export async function addFiles(files, folder = null, { onProgress = () => {} } = {}) {
  const ix = await loadIndex(); const added = [];
  for (const [i, f] of files.entries()) {
    const full = String(f.webkitRelativePath || f.name).replace(/\\/g, '/'); const parts = full.split('/'); const name = parts.pop() || 'file';
    const where = parts.length ? await folderFor(ix, parts.join('/'), folder) : folder;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let body = bytes; let z = false;
    if (typeof CompressionStream !== 'undefined' && bytes.length > 256) { const d = await deflate(bytes); if (d.length < bytes.length * 0.95) { body = d; z = true; } }
    const id = newId(); const rec = await seal(body);
    await idb.set(FILE + id, rec);
    const e = { id, name: name.slice(0, 200), type: f.type || '', size: bytes.length, stored: rec.ct.length + 12, folder: where, at: Date.now(), z };
    ix.files.push(e); added.push(e); onProgress(i + 1, files.length);
  }
  await saveIndex(ix);
  return added;
}
/** A file of the library, opened (decrypted, uncompressed) as a File. */
export async function readFile(entry) {
  const rec = await idb.get(FILE + entry.id); if (!rec) throw new Error('That file is missing.');
  let b = await unseal(rec); if (entry.z) b = await inflate(b);
  return new File([b], entry.name, { type: entry.type || '', lastModified: entry.at });
}
/** Files moved to `folder`. */
export async function moveFiles(ids, folder) {
  const ix = await loadIndex(); const set = new Set(ids);
  for (const f of ix.files) if (set.has(f.id)) f.folder = folder;
  await saveIndex(ix);
}
/** Files deleted (their encrypted bytes too). */
export async function deleteFiles(ids) {
  const ix = await loadIndex(); const set = new Set(ids);
  for (const id of set) await idb.del(FILE + id);
  ix.files = ix.files.filter((f) => !set.has(f.id)); await saveIndex(ix);
}
/** Every folder inside `id` (and it), deepest last. */
export const foldersIn = (ix, id) => { const out = [id]; for (let i = 0; i < out.length; i++) for (const f of ix.folders) if (f.parent === out[i]) out.push(f.id); return out; };
/** A folder deleted, with everything in it. */
export async function deleteFolder(id) {
  const ix = await loadIndex(); const gone = new Set(foldersIn(ix, id));
  const files = ix.files.filter((f) => gone.has(f.folder)); for (const f of files) await idb.del(FILE + f.id);
  ix.files = ix.files.filter((f) => !gone.has(f.folder)); ix.folders = ix.folders.filter((f) => !gone.has(f.id)); await saveIndex(ix);
}
/** A folder renamed. */
export async function renameFolder(id, name) { const ix = await loadIndex(); const f = ix.folders.find((x) => x.id === id); if (f) { f.name = String(name).trim().slice(0, 80) || f.name; await saveIndex(ix); } }

/**
 * How much is in a folder (null: the whole library), everything in its folders too: { files, folders, size (bytes, as
 * the files are), stored (bytes kept on the phone, compressed and encrypted) }.
 */
export function stats(ix, folder = null) {
  const inside = folder == null ? null : new Set(foldersIn(ix, folder));
  const files = ix.files.filter((f) => !inside || inside.has(f.folder));
  return { files: files.length, folders: folder == null ? ix.folders.length : inside.size - 1, size: files.reduce((n, f) => n + f.size, 0), stored: files.reduce((n, f) => n + f.stored, 0) };
}
/** A folder's path from the top: [{ id, name }]. */
export function pathOf(ix, id) { const out = []; let f = ix.folders.find((x) => x.id === id); while (f) { out.unshift({ id: f.id, name: f.name }); f = ix.folders.find((x) => x.id === f.parent); } return out; }
/** Files with their path inside `folder` ("Beach/a.jpg"), for a package: [{ entry, path }]. */
export function filesUnder(ix, folder) {
  const inside = folder == null ? null : new Set(foldersIn(ix, folder));
  const rel = (fid) => pathOf(ix, fid).slice(folder == null ? 0 : pathOf(ix, folder).length).map((p) => p.name).join('/');
  return ix.files.filter((f) => !inside || inside.has(f.folder)).map((e) => ({ entry: e, path: [rel(e.folder), e.name].filter(Boolean).join('/') }));
}
/** Everything deleted from this phone (the key too): for starting over. */
export async function wipe() {
  for (const k of (await idb.keys()).map(String).filter((x) => x.startsWith('cc.reader.'))) await idb.del(k);
  session = null;
}
