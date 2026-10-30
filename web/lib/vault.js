// Saved Files encryption: files are encrypted on the phone before they go to Google Drive, so Drive,
// the Apps Script and the spreadsheet log only ever see scrambled data under scrambled names.
//
// Keys: one random data key (AES-256-GCM) encrypts the files. It is kept in Drive only wrapped
// (encrypted) twice: with a key made from your password (PBKDF2-SHA-256, 600,000 rounds) and with a
// key made from your recovery key (160 random bits, shown once). Unlocking with either gives the data
// key, which is then kept in memory only, for this session: a reload or closing the app forgets it.
// Changing the password re-wraps the data key; the files stay as they are.
//
// A file in Drive is named "ccv.<encrypted name, type and size>" and holds:
//   "CCV1" | header length (4 bytes) | header JSON (the wrapped data key and salts, so one file and
//   the password or recovery key are enough to open it anywhere) | IV (12) | AES-GCM(meta + bytes).
// Nothing here is a secret: without the password or recovery key it can't be opened.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder(); const dec = new TextDecoder();
export const ITERATIONS = 600_000;
export const HEADER_FILE = 'command-center-vault.json';
const MAGIC = enc.encode('CCV1');

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ---------- the recovery key: 20 random bytes as 32 letters and digits, in groups of four ----------

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to mix up
export function newRecoveryKey() {
  const bytes = rand(20); let bits = 0; let v = 0; let out = '';
  for (const b of bytes) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >> (bits - 5)) & 31]; bits -= 5; } }
  return out.match(/.{4}/g).join('-');
}
/** A recovery key as typed: case, spaces and dashes don't matter. Null if it can't be one. */
export function cleanRecoveryKey(s) {
  const t = String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1');
  return t.length === 32 && [...t].every((c) => B32.includes(c)) ? t : null;
}

// ---------- keys ----------

async function kek(secret, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function wrap(raw, secret, iterations) {
  const salt = rand(16); const iv = rand(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, await kek(secret, salt, iterations), raw));
  return { salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function unwrap(w, secret, iterations) {
  const raw = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, await kek(secret, unb64(w.salt), iterations), unb64(w.ct));
  return new Uint8Array(raw);
}
const useKey = (raw) => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

/**
 * A new vault for `password`: { header (to keep in Drive), key (the data key, for this session),
 * recoveryKey (to show once) }.
 */
export async function createVault(password, { iterations = ITERATIONS } = {}) {
  const raw = rand(32); const recoveryKey = newRecoveryKey();
  const header = { v: 1, kdf: 'PBKDF2-SHA256', iterations, password: await wrap(raw, password, iterations), recovery: await wrap(raw, cleanRecoveryKey(recoveryKey), iterations), created: Date.now() };
  return { header, key: await useKey(raw), recoveryKey };
}

/** The data key from the password or the recovery key; throws "Wrong password" otherwise. */
export async function unlock(header, secret) {
  const tries = [[header.password, secret]];
  const rk = cleanRecoveryKey(secret);
  if (rk) tries.push([header.recovery, rk]);
  for (const [w, s] of tries) {
    try { return await useKey(await unwrap(w, s, header.iterations)); } catch { /* try the next */ }
  }
  throw new Error('Wrong password or recovery key.');
}

/** The header with a new password (unlocked with the current password or the recovery key). */
export async function changePassword(header, secret, newPassword) {
  const raw = await rawKey(header, secret);
  return { ...header, password: await wrap(raw, newPassword, header.iterations), changed: Date.now() };
}

/** The header with a new recovery key (the old one stops working for it): { header, recoveryKey }. */
export async function newRecovery(header, secret) {
  const raw = await rawKey(header, secret); const recoveryKey = newRecoveryKey();
  return { header: { ...header, recovery: await wrap(raw, cleanRecoveryKey(recoveryKey), header.iterations), changed: Date.now() }, recoveryKey };
}

async function rawKey(header, secret) {
  try { return await unwrap(header.password, secret, header.iterations); } catch { /* recovery key? */ }
  const rk = cleanRecoveryKey(secret);
  if (rk) { try { return await unwrap(header.recovery, rk, header.iterations); } catch { /* wrong */ } }
  throw new Error('Wrong password or recovery key.');
}

// ---------- files ----------

const NAME_PREFIX = 'ccv.';
const NAME_MAX = 196;
export const isEncryptedName = (name) => String(name).startsWith(NAME_PREFIX);

/** An encrypted file for Drive: { name: "ccv.…", blob }. */
export async function encryptFile(key, header, file) {
  const meta = { n: file.name, t: file.type || 'application/octet-stream', s: file.size, at: Date.now() };
  // The Drive name holds the name, type and size, encrypted, in at most NAME_MAX characters (the
  // Saved Files script keeps 200): a long name is shortened there; the full one is in the file.
  const nameIv = rand(12);
  let short = { n: meta.n, t: meta.t, s: meta.s }; let nameCt;
  for (;;) {
    nameCt = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nameIv }, key, enc.encode(JSON.stringify(short))));
    if (NAME_PREFIX.length + Math.ceil(((12 + nameCt.length) * 4) / 3) <= NAME_MAX || short.n.length <= 1) break;
    const over = NAME_PREFIX.length + Math.ceil(((12 + nameCt.length) * 4) / 3) - NAME_MAX;
    short = { ...short, n: `${[...short.n].slice(0, Math.max(1, [...short.n].length - Math.ceil(over * 0.75) - 2)).join('')}…` };
    if (short.t.length > 40) short = { ...short, t: '' };
  }
  const metaBytes = enc.encode(JSON.stringify(meta));
  const body = new Uint8Array(4 + metaBytes.length + file.size);
  new DataView(body.buffer).setUint32(0, metaBytes.length); body.set(metaBytes, 4); body.set(new Uint8Array(await file.arrayBuffer()), 4 + metaBytes.length);
  const iv = rand(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, body));
  const head = enc.encode(JSON.stringify({ v: 1, iterations: header.iterations, password: header.password, recovery: header.recovery }));
  const lens = new Uint8Array(4); new DataView(lens.buffer).setUint32(0, head.length);
  const name = `${NAME_PREFIX}${b64url(new Uint8Array([...nameIv, ...nameCt]))}`;
  return { name, blob: new Blob([MAGIC, lens, head, iv, ct], { type: 'application/octet-stream' }) };
}

/** The real name, type and size from a Drive name: { name, type, size, at }, or null (another key). */
export async function decryptName(key, driveName) {
  if (!isEncryptedName(driveName)) return null;
  try {
    const bytes = unb64url(driveName.slice(NAME_PREFIX.length));
    const m = JSON.parse(dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12))));
    return { name: m.n, type: m.t || 'application/octet-stream', size: m.s };
  } catch { return null; }
}

function parse(bytes) {
  if (bytes.length < 24 || dec.decode(bytes.subarray(0, 4)) !== 'CCV1') throw new Error('Not a Saved Files encrypted file.');
  const hl = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0);
  const header = JSON.parse(dec.decode(bytes.subarray(8, 8 + hl)));
  return { header, iv: bytes.subarray(8 + hl, 20 + hl), ct: bytes.subarray(20 + hl) };
}
async function open(key, iv, ct) {
  let body;
  try { body = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)); } catch { throw new Error('This file couldn\'t be opened with that key (or it was changed).'); }
  const ml = new DataView(body.buffer, body.byteOffset, 4).getUint32(0);
  const meta = JSON.parse(dec.decode(body.subarray(4, 4 + ml)));
  return new File([body.subarray(4 + ml)], meta.n, { type: meta.t, lastModified: meta.at });
}

/** The original file from an encrypted one, with the session's data key. */
export async function decryptFile(key, blob) {
  const { iv, ct } = parse(new Uint8Array(await blob.arrayBuffer()));
  return open(key, iv, ct);
}

/** The original file from an encrypted one with just the password or recovery key (any browser). */
export async function openWithSecret(blob, secret) {
  const { header, iv, ct } = parse(new Uint8Array(await blob.arrayBuffer()));
  return open(await unlock(header, secret), iv, ct);
}

// ---------- this session ----------

let session = null; // { key, header }: in memory only
export const unlocked = () => session;
export const setSession = (s) => { session = s; };
export const lock = () => { session = null; };

/** How strong a password looks, roughly: 'weak' | 'ok' | 'strong', with a hint. */
export function strength(pw) {
  const s = String(pw ?? '');
  const words = s.trim().split(/[\s-]+/).filter((w) => w.length >= 3).length;
  if (s.length < 12) return { level: 'weak', hint: 'At least 12 characters. A few random words is best (like "maple river candle orbit").' };
  if (s.length >= 20 || words >= 4) return { level: 'strong', hint: 'Strong.' };
  return { level: 'ok', hint: 'OK. Longer is stronger: four or more random words.' };
}
