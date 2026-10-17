// Tiny IndexedDB key-value store (one object store). Used to autosave work in progress, since iOS
// can close a home-screen app in the background at any time. Every call fails soft: storage can be
// unavailable (private mode, quota), and the app must keep working without it.

const DB = 'command-center';
const STORE = 'kv';
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const idb = {
  get: (key) => run('readonly', (s) => s.get(key)).catch(() => undefined),
  set: (key, value) => run('readwrite', (s) => s.put(value, key)).catch(() => false),
  del: (key) => run('readwrite', (s) => s.delete(key)).catch(() => false),
};
