// Files → Download: where downloads are kept on the phone (IndexedDB): each download's record (its
// link, name, progress, where its fingerprint got to) and its file in pieces of a few MB, stored
// as they arrive, so a big video never has to fit in memory and a download can carry on after the
// app is closed. Joined back into one file (backed by storage, not memory) to save. When storage
// isn't available (a private window), it all stays in memory instead, for this visit only.

const DB = 'cc-downloads';
let dbp = null;
/** @type {{ jobs: Map<string, any>, pieces: Map<string, Blob> } | null} */
let mem = null;

function db() {
  dbp ??= new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => { req.result.createObjectStore('jobs', { keyPath: 'id' }); req.result.createObjectStore('pieces'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => { mem = { jobs: new Map(), pieces: new Map() }; return null; });
  return dbp;
}

function tx(stores, mode, fn) {
  return db().then((d) => {
    if (!d) return fn(null);
    return new Promise((resolve, reject) => {
      const t = d.transaction(stores, mode); let out;
      Promise.resolve(fn(t)).then((v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('Storage refused (full?)'));
    });
  });
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const key = (id, i) => `${id}:${String(i).padStart(6, '0')}`;

export const store = {
  /** Every download's record, newest first. */
  async jobs() {
    const all = await tx(['jobs'], 'readonly', (t) => (t ? req(t.objectStore('jobs').getAll()) : [...mem.jobs.values()]));
    return all.sort((a, b) => b.created - a.created);
  },
  async putJob(job) { await tx(['jobs'], 'readwrite', (t) => { if (t) t.objectStore('jobs').put(job); else mem.jobs.set(job.id, structuredClone(job)); }); },
  /** A piece of a download's file and its record (with where it's got to), together: both or neither. */
  async putPiece(job, i, blob) {
    await tx(['jobs', 'pieces'], 'readwrite', (t) => {
      if (!t) { mem.pieces.set(key(job.id, i), blob); mem.jobs.set(job.id, structuredClone(job)); return; }
      t.objectStore('pieces').put(blob, key(job.id, i)); t.objectStore('jobs').put(job);
    });
  },
  /** The download's file: its pieces joined. */
  async file(job, name, type) {
    const parts = await tx(['pieces'], 'readonly', (t) => {
      if (!t) return Array.from({ length: job.pieces }, (_, i) => mem.pieces.get(key(job.id, i)));
      return req(t.objectStore('pieces').getAll(IDBKeyRange.bound(key(job.id, 0), key(job.id, 999999))));
    });
    if (parts.length !== job.pieces || parts.some((p) => !p)) throw new Error('Part of the file is missing from storage.');
    return new File(parts, name, { type });
  },
  /** Its pieces dropped (to start over), or the whole download (record too). */
  async clear(id, { record = false } = {}) {
    await tx(['jobs', 'pieces'], 'readwrite', (t) => {
      if (!t) { for (const k of [...mem.pieces.keys()]) if (k.startsWith(`${id}:`)) mem.pieces.delete(k); if (record) mem.jobs.delete(id); return; }
      t.objectStore('pieces').delete(IDBKeyRange.bound(key(id, 0), key(id, 999999)));
      if (record) t.objectStore('jobs').delete(id);
    });
  },
  /** Whether downloads only last this visit (no storage). */
  async memoryOnly() { await db(); return !!mem; },
};

/** Room left on the phone for the app (bytes), or Infinity when it doesn't say. */
export async function roomLeft() {
  try { const e = await navigator.storage?.estimate?.(); if (e?.quota) return Math.max(0, e.quota - (e.usage ?? 0)); } catch { /* unknown */ }
  return Infinity;
}

/** Asks once for storage the browser won't clear on its own when space runs low. */
export async function keepStorage() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* fine */ }
}
