// Settings → Storage: what the app keeps on this phone and how much room it takes, grouped by what it is
// (your notes and drawings, Characters, Fashion's pieces, work in progress, caches), each with its size;
// what can safely go has a Clear button (asked first). Your own work (notes, drawings, the calendar) can
// only be deleted from its own app.

import { el } from './dom.js';
import { idb } from './idb.js';

/** What a stored value takes, roughly, in bytes (blobs, typed arrays, strings, and what's inside objects). */
function sizeOf(v, seen = new Set()) {
  if (v == null) return 0;
  if (typeof v === 'string') return v.length * 2;
  if (typeof v === 'number' || typeof v === 'boolean') return 8;
  if (v instanceof Blob) return v.size;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (typeof v !== 'object' || seen.has(v)) return 0;
  seen.add(v);
  let n = 0;
  for (const [k, x] of Object.entries(v)) n += k.length * 2 + sizeOf(x, seen);
  return n;
}

/** Bytes as a phone shows them: "12 KB", "3.4 MB". */
export function human(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * The groups: [name, test on a key, can be cleared?, what clearing does]. The first that matches a key
 * takes it.
 */
const GROUPS = [
  ['Notes, grocery list and voice memos', (k) => /^(notes\.|grocery\.)/.test(k), false],
  ['Drawings', (k) => k.startsWith('draw.'), false],
  ['Calendar', (k) => k.startsWith('calendar.'), false],
  ['Characters (FM)', (k) => k.startsWith('characters.'), true, 'Your saved Characters are deleted from this phone.'],
  ['Fashion: your pieces', (k) => /^fashion\.piece/.test(k), true, 'The pieces you kept in Fashion are deleted from this phone.'],
  ['Work in progress', (k) => /\.session$/.test(k), true, 'Edits you haven\'t saved (Photo Editor, Collage, Scan, PDF, Fashion) are discarded.'],
  ['Weather and sports (cached)', (k) => /^cc\.updates\.(weather|sports)$/.test(k), true, 'Downloaded again the next time you open Weather or Sports.'],
  ['Diagnostics log', (k) => k === 'cc.diag.errors', true, 'The list of problems in Diagnostics is emptied.'],
  ['Settings and small data', () => true, false],
];

/** What's stored, grouped: [{ name, bytes, keys: [{ key, where }], clear, what }]. */
export async function usage() {
  const rows = GROUPS.map(([name, test, clear, what]) => ({ name, test, clear, what, bytes: 0, keys: [] }));
  const put = (key, where, bytes) => { const r = rows.find((g) => g.test(key)); r.bytes += bytes; r.keys.push({ key, where }); };
  for (const key of await idb.keys()) put(String(key), 'idb', sizeOf(await idb.get(key)) + String(key).length * 2);
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); put(k, 'ls', (k.length + (localStorage.getItem(k) ?? '').length) * 2); } } catch { /* private mode */ }
  return rows.filter((r) => r.keys.length);
}

/** Every key of a group deleted. */
async function clearGroup(r) {
  for (const { key, where } of r.keys) {
    if (where === 'idb') await idb.del(key);
    else try { localStorage.removeItem(key); } catch { /* private mode */ }
  }
}

/** The Settings card. */
export function storageSettings() {
  const body = el('div', { class: 'st-storage' }, el('p', { class: 'small muted', text: 'Working it out…' }));
  async function draw() {
    const rows = await usage();
    let est = null; try { est = await navigator.storage?.estimate?.(); } catch { est = null; }
    const mine = rows.reduce((a, r) => a + r.bytes, 0);
    // (The rest of what the browser counts for the app: its offline files, the models it runs on the phone.)
    const offline = est?.usage ? Math.max(0, est.usage - mine) : null;
    body.replaceChildren(
      el('ul', { class: 'st-storage-list' },
        ...rows.map((r) => el('li', { class: 'st-storage-row' },
          el('span', { class: 'st-storage-name', text: r.name }),
          el('span', { class: 'small muted st-storage-size', text: human(r.bytes) }),
          r.clear ? el('button', { type: 'button', class: 'btn small', text: 'Clear', 'aria-label': `Clear ${r.name}`, onclick: async () => { if (!confirm(`Clear ${r.name}? ${r.what}`)) return; await clearGroup(r); draw(); } }) : el('span', {}))),
        offline != null ? el('li', { class: 'st-storage-row' }, el('span', { class: 'st-storage-name', text: 'App files for offline use' }), el('span', { class: 'small muted st-storage-size', text: human(offline) }), el('span', {})) : null),
      el('p', { class: 'small muted', text: est?.quota ? `In all: ${human(Math.max(est.usage ?? 0, mine))} of the ${human(est.quota)} this browser allows the app.` : 'Your notes, drawings and calendar can be deleted from their own apps.' }));
  }
  draw();
  return el('section', { class: 'card' },
    el('h2', { text: 'Storage' }),
    el('p', { class: 'small muted', text: 'What the app keeps on this phone, and how much room it takes. Nothing here is uploaded.' }),
    body);
}
