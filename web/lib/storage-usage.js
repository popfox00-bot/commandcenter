// Settings → Storage: what the app keeps on this phone and how much room it takes, grouped by what it is
// (your notes and drawings, Characters, Fashion's pieces, work in progress, caches), each with its size;
// what can safely go has a Clear button (asked first). Your own work (notes, drawings, the calendar) can
// only be deleted from its own app.

import { el } from './dom.js';
import { idb } from './idb.js';
import { connected } from './saved-files.js';

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
  ['Socials (accounts, posts, photos, videos)', (k) => k === 'cc.socials' || k.startsWith('cc.socials.m.'), false],
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

/** A bar: `part` of `whole`, its label, colored as it fills (green, then amber, red near the limit). */
function bar(part, whole, label, { segments = null } = {}) {
  const k = whole > 0 ? Math.min(1, part / whole) : 0; const pct = Math.round(k * 1000) / 10;
  const level = k >= 0.9 ? 'full' : k >= 0.7 ? 'high' : 'ok';
  const track = el('div', { class: `st-bar st-bar-${level}`, role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)), 'aria-valuetext': `${human(part)} of ${human(whole)} (${pct}%)` });
  if (segments && whole > 0) {
    // (What makes it up, each its own shade: the biggest first.)
    for (const [i, sg] of segments.entries()) if (sg.bytes > 0) track.append(el('span', { class: `st-bar-fill st-seg-${i % 6}`, title: `${sg.name}: ${human(sg.bytes)}`, style: { width: `${Math.max(0.4, (sg.bytes / whole) * 100)}%` } }));
  } else track.append(el('span', { class: 'st-bar-fill', style: { width: `${Math.max(k > 0 ? 0.6 : 0, pct)}%` } }));
  return el('div', { class: 'st-bar-wrap' }, el('div', { class: 'st-bar-head' }, el('strong', { text: label }), el('span', { class: 'small muted', text: whole > 0 ? `${human(part)} of ${human(whole)} · ${pct < 0.1 && part > 0 ? '<0.1' : pct}%` : human(part) })), track);
}

/** The app's own limits, as they are now (what each part takes at most). */
export const APP_LIMITS = [
  ['Saved Files (Google Drive)', '25 MB a file'],
  ['Socials', 'videos up to 300 MB (up to 24 MB sync to Drive); up to 10 photos or videos a post; photos kept at up to 1440 px'],
  ['Socials, Recently deleted', 'kept 7 days'],
  ['WorldAtlas Tutorials', 'designs up to 64 × 64 × 64 blocks; photos kept at up to 1600 px'],
  ['Fashion, Photo Editor', 'photos worked on at up to 16 megapixels'],
];

/** The Settings card. */
export function storageSettings() {
  const body = el('div', { class: 'st-storage' }, el('p', { class: 'small muted', text: 'Working it out…' }));
  const drive = el('div', { class: 'st-storage-drive' });
  async function drawDrive() {
    const api = connected();
    if (!api) { drive.replaceChildren(el('p', { class: 'small muted', text: 'Saved Files (your Google Drive) isn\'t set up on this device: set it up below to see its space here.' })); return; }
    drive.replaceChildren(el('p', { class: 'small muted', text: 'Asking your Drive…' }));
    try {
      const q = await api.quota();
      drive.replaceChildren(q.limit > 0 ? bar(q.used, q.limit, 'Google Drive (Saved Files)') : el('div', { class: 'st-bar-wrap' }, el('div', { class: 'st-bar-head' }, el('strong', { text: 'Google Drive (Saved Files)' }), el('span', { class: 'small muted', text: `${human(q.used)} used · no limit` }))),
        el('p', { class: 'small muted', text: 'Your whole Drive: Saved Files, Socials\' copy and everything else in it (Gmail and Google Photos share it too).' }));
    } catch (e) {
      drive.replaceChildren(el('p', { class: 'small muted', text: /Unknown action/i.test(e.message) ? 'To see your Drive\'s space here, update the Saved Files script to version 5 (Settings → Saved Files → Updating the script).' : navigator.onLine === false ? 'You\'re offline: your Drive\'s space shows when you\'re back online.' : `Couldn't ask your Drive: ${e.message}` }));
    }
  }
  async function draw() {
    const rows = await usage();
    let est = null; try { est = await navigator.storage?.estimate?.(); } catch { est = null; }
    let persisted = null; try { persisted = await navigator.storage?.persisted?.(); } catch { persisted = null; }
    const mine = rows.reduce((a, r) => a + r.bytes, 0);
    // (The rest of what the browser counts for the app: its offline files, the models it runs on the phone.)
    const offline = est?.usage ? Math.max(0, est.usage - mine) : null;
    const used = Math.max(est?.usage ?? 0, mine);
    const segs = [...rows.map((r) => ({ name: r.name, bytes: r.bytes })), ...(offline ? [{ name: 'App files for offline use', bytes: offline }] : [])].sort((a, b) => b.bytes - a.bytes);
    body.replaceChildren(
      est?.quota ? bar(used, est.quota, 'On this device', { segments: segs }) : el('p', { class: 'small muted', text: `${human(used)} kept on this device (this browser doesn't say its limit).` }),
      est?.quota ? el('p', { class: 'small muted', text: `The most this browser lets the app keep here is ${human(est.quota)} (it depends on the phone's free space).` }) : null,
      // (Kept for good: so the phone doesn't clear it when it's low on space.)
      persisted != null ? el('p', { class: 'small' }, persisted ? '🛡️ Protected: the phone won\'t clear this app\'s data to free space.' : el('span', {}, 'The phone may clear this app\'s data when it\'s low on space. ', el('button', { type: 'button', class: 'btn small', text: 'Protect it', onclick: async () => { let ok = false; try { ok = await navigator.storage.persist(); } catch { ok = false; } if (!ok) alert('The browser didn\'t allow it. On iPhone, adding the app to the Home Screen and using it often keeps its data.'); draw(); } }))) : null,
      el('ul', { class: 'st-storage-list' },
        ...segs.map((sg, i) => { const r = rows.find((x) => x.name === sg.name); return el('li', { class: 'st-storage-row' },
          el('span', { class: 'st-storage-name' }, el('span', { class: `st-dot st-seg-${i % 6}`, 'aria-hidden': 'true' }), sg.name),
          el('span', { class: 'small muted st-storage-size', text: human(sg.bytes) }),
          r?.clear ? el('button', { type: 'button', class: 'btn small', text: 'Clear', 'aria-label': `Clear ${r.name}`, onclick: async () => { if (!confirm(`Clear ${r.name}? ${r.what}`)) return; await clearGroup(r); draw(); } }) : el('span', {})); })),
      el('h3', { class: 'st-storage-h', text: 'Online' }), drive,
      el('h3', { class: 'st-storage-h', text: 'Limits in the app' }),
      el('ul', { class: 'st-limits' }, APP_LIMITS.map(([what, lim]) => el('li', {}, el('strong', { text: `${what}: ` }), lim))));
    drawDrive();
  }
  draw();
  return el('section', { class: 'card' },
    el('h2', { text: 'Storage' }),
    el('p', { class: 'small muted', text: 'What the app keeps on this device and online, against the most each allows.' }),
    body);
}
