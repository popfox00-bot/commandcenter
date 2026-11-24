// Storage (Productivity): the pure parts. A pie chart's slices, Saved Files' folder in Drive sorted into
// what it holds, and plain names for what's kept on the phone.

/** The extra bytes Saved Files' encryption adds to each file (its header with the wrapped keys, the IV, the
 * encrypted name, type and size inside, the check tag): about 430 bytes, whatever the file's size. */
export const VAULT_OVERHEAD = 430;
/** The same for each of Socials' files in Drive ("CCS1", the IV and the check tag). */
export const SOCIALS_OVERHEAD = 32;
/** What sending a file to Drive as text (base64, as the Saved Files script takes it) adds on the way: a third. */
export const BASE64_FACTOR = 4 / 3;
/** Saved Files' largest file, and why: Apps Script takes requests up to about 50 MB. */
export const DRIVE_FILE_MAX = 25 * 1024 * 1024;

/**
 * A pie's slices from parts [{ name, bytes }] (the biggest first; slices under `min` of the whole put
 * together as "Other"): [{ name, bytes, share, start, end }] with start/end as fractions of the circle.
 */
export function slices(parts, { min = 0.015 } = {}) {
  const live = parts.filter((p) => p.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const total = live.reduce((a, p) => a + p.bytes, 0); if (!total) return [];
  const big = live.filter((p) => p.bytes / total >= min); const small = live.filter((p) => p.bytes / total < min);
  const list = small.length > 1 ? [...big, { name: 'Other', bytes: small.reduce((a, p) => a + p.bytes, 0), others: small.map((p) => p.name) }] : live;
  let at = 0;
  return list.map((p) => { const share = p.bytes / total; const out = { ...p, share, start: at, end: at + share }; at += share; return out; });
}

/** A share as people read it: "42%", "0.4%", "<0.1%". */
export function pct(share) {
  const v = share * 100;
  if (v > 0 && v < 0.1) return '<0.1%';
  if (v >= 99.5 && v < 100) return `${v.toFixed(1)}%`;
  return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)}%`;
}

export const KEY_FILES = new Set(['command-center-vault.json', 'socials-key.json']);
/** Which part of Saved Files' Drive folder a file is: 'socials' | 'keys' | 'files'. */
export function driveKind(file, path = '') {
  const top = String(path).split('/')[0];
  if (KEY_FILES.has(file.name) || top === 'Decryption' || /^Decryption - /.test(file.name)) return 'keys';
  if (top === 'Socials') return 'socials';
  return 'files';
}

/**
 * Saved Files' folder in Drive, counted: { files: { bytes, n }, socials: { bytes, n }, keys: { bytes, n },
 * encrypted: n (files encrypted on the phone) } from [{ path, files }] (each folder's files).
 */
export function tallyDrive(folders) {
  const out = { files: { bytes: 0, n: 0 }, socials: { bytes: 0, n: 0 }, keys: { bytes: 0, n: 0 }, encrypted: 0, socialsEncrypted: 0 };
  for (const { path, files } of folders) for (const f of files ?? []) {
    const k = driveKind(f, path); out[k].bytes += Number(f.size) || 0; out[k].n++;
    if (/^ccv\./.test(f.name)) out.encrypted++;
    if (/\.ccs$/.test(f.name)) out.socialsEncrypted++;
  }
  return out;
}

/** A plain name for something kept on the phone, from its key. */
export function itemName(key) {
  const k = String(key);
  if (k.startsWith('cc.socials.m.')) return 'Socials photo or video';
  if (k === 'cc.socials') return 'Socials accounts, posts and messages';
  if (k.startsWith('draw.')) return `Drawing (${k.slice(5)})`;
  if (k.startsWith('notes.')) return `Notes: ${k.slice(6)}`;
  if (k.startsWith('grocery.')) return 'Grocery list';
  if (k.startsWith('calendar.')) return `Calendar: ${k.slice(9)}`;
  if (k.startsWith('characters.')) return `Character (${k.slice(11)})`;
  if (k.startsWith('fashion.piece')) return 'Fashion piece';
  if (/\.session$/.test(k)) return `Unsaved work: ${k.replace(/\.session$/, '')}`;
  return k;
}
