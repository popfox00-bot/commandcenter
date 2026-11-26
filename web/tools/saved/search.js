// Saved Files → 🔎 Search: every file you've seen in Saved Files (each folder's list is noted as it's opened, or
// all at once with "Look through every folder"), found by name, kind (photos, videos, documents…), person (the
// character matches) and date, with their small pictures: it works offline. Opening a file needs the connection.
// The list is kept on this phone; with Saved Files' encryption on, it's kept encrypted with the same key (so
// it's searchable once Saved Files is unlocked, offline too), as the names in Drive are.

import { idb } from '../../lib/idb.js';
import { el, fill } from '../../lib/dom.js';
import { fileKind, knownHeader, size } from '../../lib/saved-files.js';
import { unlocked } from '../../lib/vault.js';
import { listMatches, thumbsOf } from './scanner.js';

const INDEX = 'cc.saved.index';
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The files noted: [{ id, name, type, size, updated, folder, path }], or null while it's encrypted and locked. */
export async function loadIndex() {
  const v = await idb.get(INDEX); if (!v) return [];
  if (!v.enc) return Array.isArray(v.files) ? v.files : [];
  const s = unlocked(); if (!s) return null;
  try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(v.iv) }, s.key, unb64(v.ct)))).files ?? []; } catch { return []; }
}
async function keepIndex(files) {
  if (knownHeader()) {
    const s = unlocked(); if (!s) return false; // (encrypted: only noted while it's unlocked)
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, s.key, new TextEncoder().encode(JSON.stringify({ files })));
    await idb.set(INDEX, { enc: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) }); return true;
  }
  await idb.set(INDEX, { v: 1, files }); return true;
}
/** A folder's files noted (its old list replaced): `folder` its id ('' the main one), `path` its name. */
export async function noteFolder(folder, path, files) {
  const all = await loadIndex(); if (all === null) return false;
  const keep = all.filter((f) => f.folder !== folder);
  for (const f of files) if (!f.folder && !f.locked && f.id && f.name) keep.push({ id: f.id, name: f.name, type: f.type ?? '', size: f.size ?? 0, updated: f.updated ?? 0, folder, path });
  return keepIndex(keep);
}
/** A file gone (deleted or moved): off the list. */
export async function forgetFile(id) { const all = await loadIndex(); if (all) await keepIndex(all.filter((f) => f.id !== id)); }

export const KIND_CHIPS = [['', 'All'], ['image', '🖼️ Photos'], ['video', '🎞️ Videos'], ['docs', '📄 Documents'], ['other', '📦 Other']];
const DOCS = new Set(['pdf', 'doc', 'sheet', 'slides', 'text']);
export const WHEN = [['', 'Any time'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['older', 'Older']];

/**
 * The files that fit: `q` (words in the name, any order), `kind` (KIND_CHIPS), `person` (a handle: the files
 * matched to it, `matches`), `when` (WHEN). Newest first.
 */
export function searchFiles(files, { q = '', kind = '', person = '', when = '', matches = [], now = Date.now() } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const ofPerson = person ? new Set(matches.filter((m) => m.handle === person).map((m) => m.fileId)) : null;
  const since = { week: now - 7 * 864e5, month: now - 30 * 864e5, year: now - 365 * 864e5 }[when];
  return files.filter((f) => {
    const name = f.name.toLowerCase().replace(/[_\-.]+/g, ' ');
    if (words.some((w) => !name.includes(w) && !String(f.path ?? '').toLowerCase().includes(w))) return false;
    const k = fileKind(f.name, f.type).kind;
    if (kind === 'docs' ? !DOCS.has(k) : kind === 'other' ? (k === 'image' || k === 'video' || DOCS.has(k)) : kind && k !== kind) return false;
    if (ofPerson && !ofPerson.has(f.id)) return false;
    if (since && !(f.updated >= since)) return false;
    if (when === 'older' && !(f.updated < now - 365 * 864e5)) return false;
    return true;
  }).sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
}

/**
 * The Search view in `root`: `onBack()`; `onOpen(f)` (the file, online); `onFolder(id)` (go to its folder);
 * `indexAll(onProgress)` looks through every folder (online). Returns { draw }.
 */
export function searchView(root, { onBack, onOpen, onFolder, indexAll }) {
  let q = ''; let kind = ''; let person = ''; let when = ''; const urls = [];
  const input = el('input', { type: 'search', class: 'so-input sv-search-in', placeholder: 'Search by name…', 'aria-label': 'Search Saved Files', autocomplete: 'off' });
  const chips = el('div', { class: 'row wrap sv-people', role: 'group', 'aria-label': 'Kind' });
  const who = el('select', { class: 'so-input sv-search-sel', 'aria-label': 'Person' });
  const date = el('select', { class: 'so-input sv-search-sel', 'aria-label': 'Date' }, WHEN.map(([v, t]) => el('option', { value: v, text: t })));
  const note = el('p', { class: 'small muted', 'aria-live': 'polite' }); const list = el('ul', { class: 'sv-list sv-results' });
  const all = el('button', { type: 'button', class: 'btn small-btn ghost', text: '⟳ Look through every folder' });
  let files = []; let matches = [];
  all.addEventListener('click', async () => { all.disabled = true; try { await indexAll((t) => { note.textContent = t; }); } catch (e) { note.textContent = e.message; } all.disabled = false; draw(); });
  input.addEventListener('input', () => { q = input.value; paint(); });
  who.addEventListener('change', () => { person = who.value; paint(); }); date.addEventListener('change', () => { when = date.value; paint(); });
  async function row(f) {
    const k = fileKind(f.name, f.type); const [pic] = await thumbsOf(f.id).catch(() => []);
    const tile = pic ? el('span', { class: 'sv-icon sv-thumb', 'aria-hidden': 'true' }, el('img', { src: (urls.push(URL.createObjectURL(pic)), urls.at(-1)), alt: '' })) : el('span', { class: `sv-icon sv-k-${k.kind}`, 'aria-hidden': 'true' }, el('span', { text: k.emoji }));
    const ppl = [...new Set(matches.filter((m) => m.fileId === f.id).map((m) => m.handle))].sort();
    return el('li', { class: 'card sv-item' }, tile,
      el('span', { class: 'sv-meta' }, el('strong', { class: 'sv-name', text: f.name }),
        ppl.length ? el('span', { class: 'small sv-match', text: `👤 ${ppl.map((h) => `@${h}`).join(', ')}` }) : null,
        el('span', { class: 'muted small', text: [`📁 ${f.path || 'Saved Files'}`, size(f.size), f.updated ? new Date(f.updated).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : ''].filter(Boolean).join(' · ') })),
      el('span', { class: 'row wrap sv-actions' },
        el('button', { type: 'button', class: 'btn small-btn', text: 'Open', 'aria-label': `Open ${f.name}`, onclick: () => onOpen(f) }),
        el('button', { type: 'button', class: 'btn small-btn ghost', text: 'Folder', 'aria-label': `Go to the folder of ${f.name}`, onclick: () => onFolder(f.folder) })));
  }
  let seq = 0;
  async function paint() {
    const my = ++seq; for (const u of urls.splice(0)) URL.revokeObjectURL(u);
    fill(chips, KIND_CHIPS.map(([v, t]) => el('button', { type: 'button', class: `btn small-btn sv-chip${kind === v ? ' on' : ''}`, 'aria-pressed': String(kind === v), text: t, onclick: () => { kind = v; paint(); } })));
    const found = searchFiles(files, { q, kind, person, when, matches });
    const rows = await Promise.all(found.slice(0, 100).map(row)); if (my !== seq) return;
    note.textContent = `${found.length} of ${files.length} file${files.length === 1 ? '' : 's'}${found.length > 100 ? ' (the newest 100 shown)' : ''}.`;
    fill(list, rows.length ? rows : el('li', { class: 'muted small', text: files.length ? 'Nothing fits.' : 'Nothing noted yet: open your folders, or Look through every folder.' }));
  }
  async function draw() {
    const idx = await loadIndex(); matches = await listMatches();
    const ppl = [...new Set(matches.map((m) => m.handle))].sort();
    fill(who, el('option', { value: '', text: 'Anyone' }), ppl.map((h) => el('option', { value: h, text: `👤 @${h}` }))); who.value = ppl.includes(person) ? person : ''; person = who.value;
    if (idx === null) { files = []; fill(list); note.textContent = 'Saved Files are encrypted: unlock them (‹ All files) to search.'; return; }
    files = idx; paint();
  }
  fill(root, el('div', { class: 'row space' }, el('h2', { class: 'sv-h', text: '🔎 Search' }), el('button', { type: 'button', class: 'btn small-btn ghost', text: '‹ All files', onclick: onBack })),
    input, chips, el('div', { class: 'row wrap' }, who, date, all), note, list);
  draw(); input.focus();
  return { draw };
}
