// A backup of what's kept only on this phone and isn't anywhere else: Saved Files' favorites (their titles,
// order and pictures), files' small pictures and character matches, the background pictures, the dock, and
// Socials' and the Sports front's settings, the scanner's unknown people and its "not them" answers. Encrypted on the phone with a backup password of your own
// (PBKDF2-SHA-256 → AES-256-GCM) into one file, `cc-extras-YYYY-MM-DD.ccx`, put in Saved Files' "Backups"
// folder or saved to the phone; restored from either, with the same password. (Socials itself, the Vault's
// files and Saved Files' own files are kept in your Drive already, encrypted, so they aren't in it.)

import { idb } from './idb.js';
import { el } from './dom.js';
import { getConfig, savedFiles } from './saved-files.js';
import { downloadBlob } from './files.js';

export const FOLDER = 'Backups';
const ROUNDS = 310_000;
const IDB_KEYS = [/^cc\.saved\.favs$/, /^cc\.saved\.fav\.t\./, /^cc\.saved\.thumb\./, /^cc\.saved\.matches$/, /^cc\.saved\.(strangers|rejects)$/, /^cc\.bg\./];
const LS_KEYS = ['cc.dock', 'cc.dock.mode', 'cc.socials.level', 'cc.socials.ai', 'cc.socials.faces', 'cc.socials.autoreply', 'cc.socials.autocomment', 'cc.socials.sports.prefs', 'cc.socials.sports.likes'];
export const isBackupName = (n) => /^cc-extras-\d{4}-\d{2}-\d{2}.*\.ccx$/.test(String(n ?? ''));

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// (Stored values hold bytes (pictures): as base64 in the JSON, and back.)
const out = (v) => (v instanceof ArrayBuffer ? { $b: b64(new Uint8Array(v)) } : ArrayBuffer.isView(v) ? { $b: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) } : Array.isArray(v) ? v.map(out) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, out(x)])) : v);
const back = (v) => (Array.isArray(v) ? v.map(back) : v && typeof v === 'object' ? (typeof v.$b === 'string' && Object.keys(v).length === 1 ? unb64(v.$b).buffer : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, back(x)]))) : v);

/** What's backed up, gathered: { v, at, idb: { key: value }, ls: { key: text } }. */
export async function gather() {
  const data = { v: 1, at: Date.now(), idb: {}, ls: {} };
  for (const k of await idb.keys()) if (typeof k === 'string' && IDB_KEYS.some((r) => r.test(k))) { const v = await idb.get(k); if (v !== undefined) data.idb[k] = out(v); }
  for (const k of LS_KEYS) { try { const v = localStorage.getItem(k); if (v != null) data.ls[k] = v; } catch { /* private mode */ } }
  return data;
}
/** How many things a backup holds. */
export const countOf = (data) => Object.keys(data?.idb ?? {}).length + Object.keys(data?.ls ?? {}).length;

async function keyOf(password, salt, rounds) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** `data` encrypted with `password`: the backup file (a Blob). */
export async function seal(data, password, { rounds = ROUNDS } = {}) {
  if (String(password).length < 6) throw new Error('Use a backup password of at least 6 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyOf(password, salt, rounds), new TextEncoder().encode(JSON.stringify(data)));
  return new Blob([JSON.stringify({ ccx: 1, kdf: 'PBKDF2-SHA256', rounds, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) })], { type: 'application/octet-stream' });
}
// ---- Weekly, by itself: with it on, a backup is put in Saved Files' Backups folder once a week, when the app
// is opened online, and only the newest KEEP kept there. The key made from your backup password (as a backup
// needs) is kept on this phone, unusable outside the app (a non-extractable key in its own storage), so it can
// back up without asking; restoring still asks for the password.
const AUTO = 'cc.xb.auto'; const WEEK = 7 * 864e5; export const KEEP = 4;
/** The weekly backup's settings: { on, last, salt, rounds } (no key shown), or null if never set up. */
export async function autoState() { const v = await idb.get(AUTO); return v?.key ? { on: !!v.on, last: v.last ?? 0, at: v.at ?? 0 } : null; }
/** Weekly backups turned on with `password` (its key made and kept), or off (its key let go). */
export async function setAuto(on, password = '') {
  if (!on) { await idb.del(AUTO); return null; }
  if (String(password).length < 6) throw new Error('Use a backup password of at least 6 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await idb.set(AUTO, { on: true, key: await keyOf(password, salt, ROUNDS), salt: b64(salt), rounds: ROUNDS, last: 0, at: Date.now() });
  return autoState();
}
async function sealWith(data, key, salt, rounds) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return new Blob([JSON.stringify({ ccx: 1, kdf: 'PBKDF2-SHA256', rounds, salt, iv: b64(iv), ct: b64(new Uint8Array(ct)) })], { type: 'application/octet-stream' });
}
/**
 * The weekly backup, if it's due (on, a week since the last, Saved Files connected, online): made, uploaded,
 * and the older ones past the newest KEEP removed. `force`: now, due or not. Resolves to what it did:
 * { done, name, removed } or { skipped: why }.
 */
export async function autoBackup({ force = false, now = Date.now() } = {}) {
  const v = await idb.get(AUTO); if (!v?.on || !v.key) return { skipped: 'off' };
  if (!force && now - (v.last ?? 0) < WEEK) return { skipped: 'not due' };
  const cfg = getConfig(); if (!cfg) return { skipped: 'no Saved Files' };
  if (globalThis.navigator?.onLine === false) return { skipped: 'offline' };
  const api = savedFiles(cfg); const name = fileName(new Date(now));
  await api.upload(new File([await sealWith(await gather(), v.key, v.salt, v.rounds)], name, { type: 'application/octet-stream' }), 'Backup', FOLDER);
  await idb.set(AUTO, { ...v, last: now });
  // (Only the newest few kept in Drive (to Drive's trash, as any deleted file).)
  let removed = 0;
  try {
    const d = (await api.folders()).find((f) => f.path === FOLDER || f.name === FOLDER);
    if (d) { const { files } = await api.browse(d.id); const old = files.filter((f) => isBackupName(f.name)).sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0)).slice(KEEP); for (const f of old) { await api.remove(f.id); removed++; } }
  } catch { /* next time */ }
  return { done: true, name, removed };
}

/** A backup file opened with `password`: its data. Throws if it's not one, or the password is wrong. */
export async function open(blob, password) {
  let h; try { h = JSON.parse(await blob.text()); } catch { h = null; }
  if (h?.ccx !== 1) throw new Error('That isn\'t a Command Center extras backup.');
  let plain; try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(h.iv) }, await keyOf(password, unb64(h.salt), h.rounds), unb64(h.ct)); } catch { throw new Error('That password doesn\'t open this backup.'); }
  return JSON.parse(new TextDecoder().decode(plain));
}
/** A backup's data put back on this phone (what's in it replaces what's here; the rest stays). Returns how many. */
export async function restore(data) {
  let n = 0;
  for (const [k, v] of Object.entries(data?.idb ?? {})) if (IDB_KEYS.some((r) => r.test(k))) { await idb.set(k, back(v)); n++; }
  for (const [k, v] of Object.entries(data?.ls ?? {})) if (LS_KEYS.includes(k) && typeof v === 'string') { try { localStorage.setItem(k, v); n++; } catch { /* private mode */ } }
  return n;
}
export const fileName = (at = new Date()) => `cc-extras-${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}.ccx`;

/** The newest backup in Saved Files' Backups folder ({ id, name } or null). */
export async function newestInDrive(api) {
  const d = (await api.folders()).find((f) => f.path === FOLDER || f.name === FOLDER); if (!d) return null;
  const { files } = await api.browse(d.id);
  return files.filter((f) => isBackupName(f.name)).sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))[0] ?? null;
}

/** The settings card: back up (to Saved Files, or to the phone) and restore (from Saved Files' newest, or a file). */
export function extrasBackupSettings() {
  const pw = el('input', { type: 'password', class: 'xb-pw', autocomplete: 'new-password', 'aria-label': 'Backup password', placeholder: 'Backup password' });
  const status = el('p', { class: 'small', 'aria-live': 'polite' });
  const say = (t, bad = false) => { status.textContent = t; status.classList.toggle('bad-text', bad); };
  const busy = (on) => { for (const b of box.querySelectorAll('button, input')) b.disabled = on; };
  const run = (fn) => async () => { if (!pw.value) { say('Enter the backup password first.', true); pw.focus(); return; } busy(true); try { await fn(); } catch (e) { say(e.message, true); } busy(false); };
  const apiOf = () => { const cfg = getConfig(); if (!cfg) throw new Error('Connect Saved Files first (above).'); return savedFiles(cfg); };
  const toDrive = el('button', { type: 'button', class: 'btn primary', text: 'Back up to Saved Files', onclick: run(async () => {
    say('Encrypting…'); const data = await gather(); const blob = await seal(data, pw.value); say('Uploading…');
    await apiOf().upload(new File([blob], fileName(), { type: 'application/octet-stream' }), 'Backup', FOLDER);
    say(`Backed up ${countOf(data)} things to Saved Files → ${FOLDER} → ${fileName()} (encrypted).`);
  }) });
  const toPhone = el('button', { type: 'button', class: 'btn', text: 'Save to this phone', onclick: run(async () => {
    const data = await gather(); downloadBlob(await seal(data, pw.value), fileName()); say(`Saved ${fileName()} (${countOf(data)} things, encrypted).`);
  }) });
  const done = (n) => say(`Restored ${n} things. Reopen the app to see them all.`);
  const fromDrive = el('button', { type: 'button', class: 'btn', text: 'Restore the newest from Saved Files', onclick: run(async () => {
    const api = apiOf(); say('Looking in Saved Files…'); const f = await newestInDrive(api);
    if (!f) { say(`No backups in Saved Files → ${FOLDER} yet.`, true); return; }
    const data = await open(await api.download(f.id), pw.value);
    if (!confirm(`Restore ${f.name} (${countOf(data)} things)? What's in it replaces what's on this phone.`)) { say(''); return; }
    done(await restore(data));
  }) });
  const file = el('input', { type: 'file', accept: '.ccx,application/octet-stream', class: 'xb-file', 'aria-label': 'Backup file to restore' });
  file.addEventListener('change', run(async () => {
    const f = file.files?.[0]; file.value = ''; if (!f) return;
    const data = await open(f, pw.value);
    if (!confirm(`Restore ${f.name} (${countOf(data)} things)? What's in it replaces what's on this phone.`)) return;
    done(await restore(data));
  }));
  // (Weekly, by itself.)
  const weekly = el('input', { type: 'checkbox', 'aria-label': 'Back up every week by itself' });
  const weeklyNote = el('span', { class: 'small muted' });
  const paintWeekly = async () => { const st = await autoState(); weekly.checked = !!st?.on; weeklyNote.textContent = st?.on ? (st.last ? ` Last: ${new Date(st.last).toLocaleDateString([], { month: 'short', day: 'numeric' })}. The newest ${KEEP} are kept.` : ' The first one goes once the app is next opened online.') : ' Uses the backup password above, once.'; };
  weekly.addEventListener('change', async () => {
    try {
      if (weekly.checked) { if (!pw.value) { weekly.checked = false; say('Enter the backup password first, then turn this on.', true); pw.focus(); return; } await setAuto(true, pw.value); const r = await autoBackup({ force: true }); say(r.done ? `Weekly backups on. Backed up now: ${r.name}.` : 'Weekly backups on.'); }
      else { await setAuto(false); say('Weekly backups off.'); }
    } catch (e) { weekly.checked = false; say(e.message, true); }
    paintWeekly();
  });
  paintWeekly();
  const box = el('details', { class: 'small xb' }, el('summary', { text: 'Back up the extras kept on this phone' }),
    el('p', { class: 'small muted', text: 'Favorites (titles, order, pictures), files\' small pictures and character matches, background pictures, the dock, and Socials\' and Sports\' settings: kept only on this phone otherwise. Encrypted here with a backup password of your own (it can\'t be recovered: keep it safe).' }),
    pw, el('div', { class: 'row wrap' }, toDrive, toPhone),
    el('label', { class: 'xb-weekly' }, weekly, el('span', {}, el('strong', { text: ' Every week, by itself' }), weeklyNote)),
    el('div', { class: 'row wrap' }, fromDrive, el('label', { class: 'btn' }, 'Restore from a file…', file)),
    status);
  return box;
}
