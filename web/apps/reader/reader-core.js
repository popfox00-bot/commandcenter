// Reader's work (no page, so it can be tested): files packed into one ZIP (each compressed where that helps), locked
// with a password into the same encrypted file Saved Files makes (CCV1: AES-256-GCM, the key wrapped by the password
// and by a recovery key, PBKDF2-SHA256: decryption/FORMAT.md), so decrypt.html or decrypt.py opens it anywhere, with
// no app; and opened again: decrypted, unzipped, each file ready to look at or save. All in memory, on this device.

import { createVault, encryptFile, openWithSecret, decryptFile } from '../../lib/vault.js';
import { zipCompressed, readZip } from '../../lib/zip.js';

/** The ending a locked package has. */
export const LOCKED_EXT = '.ccv';
/** A safe file name (no path characters), with no ending; `fallback` when nothing's left. */
export const baseName = (name, fallback = 'files') => String(name ?? '').replace(/\.[a-z0-9]{1,6}$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || fallback;

/** What a file is, for its icon and preview: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'zip' | 'locked' | 'other'. */
export function kindOf(name, type = '') {
  const n = String(name).toLowerCase(); const t = String(type).toLowerCase();
  if (n.endsWith(LOCKED_EXT) || /^ccv\./.test(n)) return 'locked';
  if (/\.zip$/.test(n) || t === 'application/zip') return 'zip';
  if (t.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|svg)$/.test(n)) return 'image';
  if (t.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/.test(n)) return 'video';
  if (t.startsWith('audio/') || /\.(mp3|m4a|aac|wav|ogg|flac)$/.test(n)) return 'audio';
  if (t === 'application/pdf' || /\.pdf$/.test(n)) return 'pdf';
  if (t.startsWith('text/') || /\.(txt|md|csv|json|log|html?|xml|js|css|ya?ml)$/.test(n)) return 'text';
  return 'other';
}
/** A type for a name (for files out of a ZIP, which keeps no types). */
export function typeOf(name) {
  const ext = String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html', xml: 'text/xml', zip: 'application/zip' }[ext] ?? 'application/octet-stream';
}

/** Whether bytes are a ZIP (they start "PK\x03\x04", or are an empty one). */
export const isZipBytes = (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);
/** Whether bytes are a locked file (they start "CCV1"). */
export const isLockedBytes = (b) => b.length >= 4 && b[0] === 0x43 && b[1] === 0x43 && b[2] === 0x56 && b[3] === 0x31;

/**
 * Files packed as one ZIP, each compressed where that makes it smaller: `files` (File/Blob with names), `name` (the
 * package's). Resolves to { file (application/zip), before, after } (bytes).
 */
export async function pack(files, name, { onProgress = () => {} } = {}) {
  const items = [];
  for (const f of files) items.push({ name: f.webkitRelativePath || f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  const zip = await zipCompressed(items, { onProgress });
  const before = items.reduce((n, x) => n + x.bytes.length, 0);
  return { file: new File([zip], `${baseName(name)}.zip`, { type: 'application/zip' }), before, after: zip.length };
}

/**
 * A file locked: with a new `password` (its own key, wrapped by the password and a new recovery key: shown once), or
 * with `session` ({ key, header }: Saved Files' own, so its password and recovery key open it too). Resolves to
 * { file (name + LOCKED_EXT), recoveryKey (or null with `session`) }.
 */
export async function lock(file, { password = '', session = null } = {}) {
  let key; let header; let recoveryKey = null;
  if (session) ({ key, header } = session);
  else { if (String(password).length < 6) throw new Error('Use a password of at least 6 characters.'); ({ key, header, recoveryKey } = await createVault(password)); }
  const { blob } = await encryptFile(key, header, file);
  return { file: new File([blob], `${baseName(file.name)}${LOCKED_EXT}`, { type: 'application/octet-stream' }), recoveryKey };
}

/**
 * What's in a file, opened: a locked one unlocked (with `secret`: its password or recovery key; or `session`'s key),
 * a ZIP unpacked, anything else as it is. Resolves to { files: [File], from: 'locked' | 'zip' | 'file', inner? (the
 * locked file's own name) }. Throws { needsSecret: true } for a locked one without a secret or key that opens it.
 */
export async function open(file, { secret = '', session = null } = {}) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (isLockedBytes(head)) {
    let inner = null;
    if (session) { try { inner = await decryptFile(session.key, file); } catch { inner = null; } }
    if (!inner) {
      if (!secret) throw Object.assign(new Error('This file is locked: enter its password or recovery key.'), { needsSecret: true });
      inner = await openWithSecret(file, secret); // (throws "Wrong password or recovery key.")
    }
    const ih = new Uint8Array(await inner.slice(0, 4).arrayBuffer());
    if (isZipBytes(ih)) return { files: await unzip(inner), from: 'locked', inner: inner.name };
    return { files: [inner], from: 'locked', inner: inner.name };
  }
  if (isZipBytes(head)) return { files: await unzip(file), from: 'zip' };
  return { files: [file], from: 'file' };
}
/** The files in a ZIP, each a File with a type from its name. */
export async function unzip(file) {
  return (await readZip(file)).map((x) => new File([x.bytes], x.name, { type: typeOf(x.name) }));
}
