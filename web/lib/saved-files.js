// Saved Files: files kept in your own Google Drive folder, through the Apps Script web app in your
// "Saved Files" spreadsheet (apps-script/saved-files.gs). Its URL and access key are entered on the
// phone and kept only here (localStorage), never in the app's code. Requests go as text/plain JSON
// so the browser sends them straight (no CORS preflight, which Apps Script can't answer).

import { HEADER_FILE, isEncryptedName, encryptFile, decryptName, decryptFile, unlocked } from './vault.js';

const CONFIG_KEY = 'cc.savedFiles';
export const MAX_BYTES = 25 * 1024 * 1024;

export function getConfig(storage = globalThis.localStorage) {
  try { const c = JSON.parse(storage.getItem(CONFIG_KEY)); return c?.url && c?.key ? c : null; } catch { return null; }
}
export function setConfig(c, storage = globalThis.localStorage) {
  try { if (c) storage.setItem(CONFIG_KEY, JSON.stringify({ url: c.url, key: c.key })); else storage.removeItem(CONFIG_KEY); } catch { /* private mode */ }
}

/** An Apps Script web app URL ("https://script.google.com/macros/s/…/exec"), tidied; null if it isn't one. */
export function checkUrl(url) {
  try {
    const u = new URL(String(url).trim());
    if (u.protocol !== 'https:' || !/^(script\.google\.com|script\.googleusercontent\.com)$/.test(u.hostname) || !/\/exec$/.test(u.pathname)) return null;
    return `${u.origin}${u.pathname}`;
  } catch { return null; }
}

export async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64, type = 'application/octet-stream') {
  const s = atob(b64); const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** A client for one web app: { ping, info, list, browse, folders, upload, download, remove, mkdir, rename, rmdir, move }. */
export function savedFiles({ url, key }, { fetch: f = globalThis.fetch } = {}) {
  async function call(action, body = {}) {
    let res;
    try {
      res = await f(url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key, action, ...body }), redirect: 'follow', cache: 'no-store', credentials: 'omit' });
    } catch { throw new Error(navigator.onLine === false ? 'You\'re offline. Saved Files need a connection.' : 'Couldn\'t reach your Saved Files script.'); }
    if (!res.ok) throw new Error(`Your Saved Files script answered ${res.status}. Is it deployed as a web app for "Anyone"?`);
    let out;
    try { out = await res.json(); } catch { throw new Error('That URL didn\'t answer like the Saved Files script. Check it ends in /exec.'); }
    if (!out?.ok) throw new Error(out?.error || 'The Saved Files script refused.');
    return out;
  }
  return {
    ping: async () => (await call('ping')).folder,
    /** { folder, version } (version 1: a script from before folders). */
    info: async () => { const r = await call('ping'); return { folder: r.folder, version: r.version ?? 1 }; },
    list: async () => (await call('list')).files ?? [],
    /**
     * One folder ('' : the main one): { files, folders, path: [{ id, name }] }. folders is null with a
     * script from before folders (version 3), which only knows the main folder.
     */
    async browse(folder = '') {
      const r = await call('list', folder ? { folder } : {});
      return { files: r.files ?? [], folders: r.folders ?? null, path: r.path ?? [] };
    },
    /** Every folder: [{ id, name, path: 'A/B' }]. */
    folders: async () => (await call('folders')).folders ?? [],
    /** folder: a folder name in the main folder (made if needed; same names replaced), or { id } of any folder. */
    async upload(file, from = '', folder = '') {
      if (file.size > MAX_BYTES) throw new Error(`"${file.name}" is too big for Saved Files (25 MB at most).`);
      const where = folder?.id ? { folderId: folder.id } : folder ? { folder } : {};
      return (await call('upload', { name: file.name, type: file.type || 'application/octet-stream', data: await toBase64(file), from, ...where })).file;
    },
    async download(id) {
      const out = await call('download', { id });
      return new File([fromBase64(out.data, out.type)], out.name, { type: out.type });
    },
    remove: async (id) => { await call('delete', { id }); },
    mkdir: async (name, parent = '') => (await call('mkdir', { name, parent })).folder,
    rename: async (id, name) => (await call('rename', { id, name })).folder,
    rmdir: async (id) => { await call('rmdir', { id }); },
    /** Move a file into a folder ('' : the main folder). */
    move: async (id, to = '') => (await call('move', { id, to })).file,
  };
}

/** The configured client, or null when Saved Files isn't set up on this phone. */
export const connected = () => { const c = getConfig(); return c ? savedFiles(c) : null; };

/** "1.2 MB" */
export function size(n) {
  if (!(n >= 0)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

// ---------- encryption (web/lib/vault.js) ----------


const HEADER_KEY = 'cc.vault.header';
/** The vault header known on this phone (nothing secret in it), or null when encryption is off. */
export function knownHeader(storage = globalThis.localStorage) { try { return JSON.parse(storage.getItem(HEADER_KEY)) ?? null; } catch { return null; } }
export function rememberHeader(h, storage = globalThis.localStorage) { try { if (h) storage.setItem(HEADER_KEY, JSON.stringify(h)); else storage.removeItem(HEADER_KEY); } catch { /* private mode */ } }

// ---------- the decryption kit ----------

export const KIT_FOLDER = 'Decryption';
export const KIT_FILES = ['decrypt.html', 'decrypt.py', 'FORMAT.md'];
const KIT_PREFIX = 'Decryption - ';
/** Whether a file in the main folder is part of the kit (saved there by a script from before folders). */
export const isKitFile = (name) => String(name).startsWith(KIT_PREFIX);

/**
 * Save the decryption kit (web/decryption/: decrypt.html, decrypt.py, FORMAT.md) to Drive, as plain
 * files (they hold no keys): into a "Decryption" folder, or, with a script from before folders, into
 * the main folder as "Decryption - …". Returns { where, files }.
 */
export async function saveDecryptionKit(api, { fetch: f = globalThis.fetch, base = new URL('../decryption/', import.meta.url) } = {}) {
  const { version } = await api.info();
  const folders = version >= 2;
  const types = { html: 'text/html', py: 'text/x-python', md: 'text/markdown' };
  const saved = [];
  for (const name of KIT_FILES) {
    const res = await f(new URL(name, base), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Couldn't read ${name} from the app.`);
    const file = new File([await res.blob()], folders ? name : `${KIT_PREFIX}${name}`, { type: types[name.split('.').pop()] });
    saved.push(await api.upload(file, 'Settings', folders ? KIT_FOLDER : ''));
  }
  return { where: folders ? `the "${KIT_FOLDER}" folder` : 'the Saved Files folder (as "Decryption - …"; update the script for a folder)', files: saved };
}

export class LockedError extends Error { constructor() { super('Saved Files are encrypted: unlock them first (Files → Saved Files, or Settings).'); this.name = 'LockedError'; } }

/**
 * Saved Files with encryption: uploads are encrypted when a vault is set up (and must be unlocked),
 * listed names are decrypted with this session's key, downloads decrypted. The vault file itself is
 * kept out of the list. With no vault, files go as they are.
 */
export function secureFiles(api) {
  async function findHeader(raw) {
    const f = raw.find((x) => x.name === HEADER_FILE);
    if (!f) { if (knownHeader() && !raw.some((x) => isEncryptedName(x.name))) rememberHeader(null); return null; }
    if (!knownHeader() || knownHeader().headerId !== f.id) {
      const h = JSON.parse(await (await api.download(f.id)).text());
      rememberHeader({ ...h, headerId: f.id });
    }
    return f;
  }
  async function names(raw) {
    const s = unlocked();
    const out = [];
    for (const f of raw) {
      if (f.name === HEADER_FILE) continue;
      if (!isEncryptedName(f.name)) { out.push({ ...f, encrypted: false }); continue; }
      const meta = s ? await decryptName(s.key, f.name) : null;
      out.push(meta ? { ...f, name: meta.name, type: meta.type, size: meta.size, encrypted: true } : { ...f, name: s ? 'Encrypted with another key' : '🔒 Locked file', type: '', encrypted: true, locked: true });
    }
    return out;
  }
  return {
    ping: api.ping,
    info: api.info,
    remove: api.remove,
    folders: api.folders,
    mkdir: api.mkdir,
    rename: api.rename,
    rmdir: api.rmdir,
    move: api.move,
    /** The main folder's files, newest first, names decrypted: [{ id, name, type, size, updated, encrypted, locked }]. */
    async list() {
      const raw = await api.list();
      await findHeader(raw);
      return names(raw);
    },
    /** One folder ('' : the main one), file names decrypted: { files, folders, path }. Folder names are as they are in Drive. */
    async browse(folder = '') {
      const r = await api.browse(folder);
      if (!folder) await findHeader(r.files); // the vault file is in the main folder
      return { ...r, files: await names(r.files) };
    },
    /** folder: as in savedFiles().upload. */
    async upload(file, from = '', folder = '') {
      const header = knownHeader();
      if (!header) return api.upload(file, from, folder);
      const s = unlocked();
      if (!s) throw new LockedError();
      const { name, blob } = await encryptFile(s.key, s.header ?? header, file);
      return api.upload(new File([blob], name, { type: 'application/octet-stream' }), from, folder);
    },
    async download(id) {
      const file = await api.download(id);
      if (!isEncryptedName(file.name)) return file;
      const s = unlocked();
      if (!s) throw new LockedError();
      return decryptFile(s.key, file);
    },
    /** Save the vault header to Drive (replacing the old one). */
    async saveHeader(header) {
      const raw = await api.list();
      const old = raw.filter((x) => x.name === HEADER_FILE);
      const { headerId, ...clean } = header;
      const f = await api.upload(new File([JSON.stringify(clean)], HEADER_FILE, { type: 'application/json' }), 'Settings');
      for (const o of old) await api.remove(o.id).catch(() => {});
      rememberHeader({ ...clean, headerId: f.id });
      return f;
    },
    /** Encrypt a file that's in Drive as it is: a new encrypted copy (in the same folder, folder: { id }), then the plain one to the trash. */
    async encryptExisting(f, folder = '') {
      const plain = await api.download(f.id);
      const out = await this.upload(plain, 'Encrypt', folder);
      await api.remove(f.id);
      return out;
    },
    /** Make sure the vault header is known (look in Drive). */
    refresh: async () => { await findHeader(await api.list()); return knownHeader(); },
  };
}

/** The configured client with encryption, or null when Saved Files isn't set up on this phone. */
export const connectedSecure = () => { const c = connected(); return c ? secureFiles(c) : null; };
