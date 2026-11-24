// Storage (Productivity): all of the app's storage in one place, with pie charts.
// - On this device: everything the app keeps (your notes, drawings, Socials, Characters…, its files for
//   offline use, the browser's own share), as a pie and a list (each with its items, the largest first, and
//   Clear where it can safely go), against the most this browser allows; the small-settings store against its
//   own ~5 MB; whether the phone may clear it.
// - Google Drive: the whole Drive's space, and Saved Files' folder in it counted (your files, Socials' copy,
//   the encryption keys and kit), as a pie.
// - What limits uploads to Drive, and what encryption does to storage, explained with the numbers.
// Sizes over 1,000 MB are shown in GB.

import { el } from '../../lib/dom.js';
import { usage, clearGroup, bar, human, APP_LIMITS } from '../../lib/storage-usage.js';
import { connected } from '../../lib/saved-files.js';
import { slices, pct, tallyDrive, itemName, VAULT_OVERHEAD, SOCIALS_OVERHEAD, DRIVE_FILE_MAX } from './storage-core.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v)); for (const c of kids) if (c) n.append(c); return n; };
const COLORS = 8;
/** localStorage's own limit in most browsers (per site). */
const LS_LIMIT = 5 * 1024 * 1024;

/** A donut chart of `parts` ([{ name, bytes }]), its total in the middle, with a legend. */
function pie(parts, { title, centerLabel = 'in all', min } = {}) {
  const sl = slices(parts, min != null ? { min } : undefined);
  const total = sl.reduce((a, s) => a + s.bytes, 0);
  const R = 70; const C = 2 * Math.PI * R;
  const chart = svg('svg', { viewBox: '0 0 200 200', class: 'stg-pie', role: 'img', 'aria-label': `${title}: ${sl.map((s) => `${s.name} ${human(s.bytes)} (${pct(s.share)})`).join(', ')}` });
  chart.append(svg('circle', { cx: 100, cy: 100, r: R, class: 'stg-pie-track' }));
  sl.forEach((s, i) => {
    // (Too thin to draw (a sliver under a pixel or two): in the legend only.)
    const len = s.share * C - (sl.length > 1 ? 1.2 : 0); if (len < 1.5) return;
    chart.append(svg('circle', { cx: 100, cy: 100, r: R, class: `stg-pie-slice stg-c${i % COLORS}`, 'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -s.start * C, transform: 'rotate(-90 100 100)' }, svg('title', {}, document.createTextNode(`${s.name}: ${human(s.bytes)} (${pct(s.share)})`))));
  });
  chart.append(svg('text', { x: 100, y: 98, class: 'stg-pie-total', 'text-anchor': 'middle' }, document.createTextNode(human(total))));
  chart.append(svg('text', { x: 100, y: 120, class: 'stg-pie-sub', 'text-anchor': 'middle' }, document.createTextNode(centerLabel)));
  const legend = el('ul', { class: 'stg-legend' }, sl.map((s, i) => el('li', {},
    el('span', { class: `stg-dot stg-bg${i % COLORS}`, 'aria-hidden': 'true' }),
    el('span', { class: 'stg-legend-name', text: s.name, title: s.others ? s.others.join(', ') : undefined }),
    el('span', { class: 'stg-legend-size', text: `${human(s.bytes)} · ${pct(s.share)}` }))));
  return el('div', { class: 'stg-pie-wrap' }, chart, legend);
}

/** The size of the app's files kept for offline use (its caches), or null where it can't be read. */
async function offlineFiles() {
  if (!globalThis.caches) return null;
  try {
    let n = 0;
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      for (const req of await c.keys()) {
        const res = await c.match(req); if (!res) continue;
        const len = Number(res.headers.get('content-length'));
        n += Number.isFinite(len) && len > 0 ? len : (await res.clone().blob()).size;
      }
    }
    return n;
  } catch { return null; }
}

export function mount(host) {
  const device = el('section', { class: 'card stg-card' }, el('h2', { text: '📱 On this device' }), el('p', { class: 'small muted', text: 'Working it out…' }));
  const drive = el('section', { class: 'card stg-card' }, el('h2', { text: '☁️ Google Drive' }), el('p', { class: 'small muted', text: 'Asking your Drive…' }));
  let alive = true;

  async function drawDevice() {
    const rows = await usage();
    const [est, persisted, offline] = await Promise.all([
      navigator.storage?.estimate?.().catch(() => null) ?? null,
      navigator.storage?.persisted?.().catch(() => null) ?? null,
      offlineFiles(),
    ]);
    if (!alive) return;
    const mine = rows.reduce((a, r) => a + r.bytes, 0);
    const counted = mine + (offline ?? 0);
    // (What the browser counts beyond what's read here: its own bookkeeping, the models run on the phone.)
    const rest = est?.usage ? Math.max(0, est.usage - counted) : 0;
    const used = Math.max(est?.usage ?? 0, counted);
    const parts = [...rows.map((r) => ({ name: r.name, bytes: r.bytes })), ...(offline ? [{ name: 'App files for offline use', bytes: offline }] : []), ...(rest > 1024 ? [{ name: 'Browser\'s own (indexes, models run on the phone)', bytes: rest }] : [])];
    const lsBytes = rows.flatMap((r) => r.keys).filter((k) => k.where === 'ls').reduce((a, k) => a + k.bytes, 0);
    const list = el('ul', { class: 'stg-list' }, [...rows].sort((a, b) => b.bytes - a.bytes).map((r) => {
      const top = [...r.keys].sort((a, b) => b.bytes - a.bytes).slice(0, 8);
      return el('li', { class: 'stg-row' },
        el('details', {},
          el('summary', {}, el('span', { class: 'stg-row-name', text: r.name }), el('span', { class: 'stg-row-size', text: `${human(r.bytes)} · ${r.keys.length} item${r.keys.length === 1 ? '' : 's'}` })),
          el('ul', { class: 'stg-items' }, top.map((k) => el('li', {}, el('span', { text: itemName(k.key) }), el('span', { class: 'stg-row-size', text: human(k.bytes) })))),
          r.keys.length > top.length ? el('p', { class: 'small muted', text: `…and ${r.keys.length - top.length} more.` }) : null,
          r.clear ? el('button', { type: 'button', class: 'btn small', text: `Clear ${r.name}`, onclick: async () => { if (!confirm(`Clear ${r.name}? ${r.what}`)) return; await clearGroup(r); drawDevice(); } }) : el('p', { class: 'small muted', text: 'Your own work: deleted only from its own app.' })));
    }));
    device.replaceChildren(
      el('h2', { text: '📱 On this device' }),
      pie(parts, { title: 'On this device', centerLabel: 'on this device' }),
      est?.quota ? bar(used, est.quota, 'Used of what this browser allows') : el('p', { class: 'small muted', text: `${human(used)} kept on this device (this browser doesn't say its limit).` }),
      est?.quota ? el('p', { class: 'small muted', text: `The most this browser lets the app keep is ${human(est.quota)}: it depends on the phone's free space, and grows as the phone has more free.` }) : null,
      bar(lsBytes, LS_LIMIT, 'Small settings store (about 5 MB at most)'),
      el('p', { class: 'small muted', text: 'Settings, lists and small things are kept apart, in a store most browsers limit to about 5 MB; photos, videos and drawings go in the big one above.' }),
      persisted != null ? el('p', { class: 'small' }, persisted ? '🛡️ Protected: the phone won\'t clear the app\'s data to free space.' : el('span', {}, '⚠️ The phone may clear the app\'s data when it\'s low on space. ', el('button', { type: 'button', class: 'btn small', text: 'Protect it', onclick: async () => { let ok = false; try { ok = await navigator.storage.persist(); } catch { ok = false; } if (!ok) alert('The browser didn\'t allow it. On iPhone, adding the app to the Home Screen and using it often keeps its data.'); drawDevice(); } }))) : null,
      el('h3', { class: 'stg-h', text: 'What\'s in it' }),
      el('p', { class: 'small muted', text: 'Tap one for its largest items.' }),
      list);
  }

  async function drawDrive() {
    const api = connected();
    if (!api) { drive.replaceChildren(el('h2', { text: '☁️ Google Drive' }), el('p', { class: 'small muted', text: 'Saved Files (your Google Drive) isn\'t set up on this device, so there\'s nothing in Drive to show. Once it is, its space shows here.' })); return; }
    let q = null; let qErr = null;
    try { q = await api.quota(); } catch (e) { qErr = e; }
    if (!alive) return;
    const head = [el('h2', { text: '☁️ Google Drive' })];
    if (q) head.push(q.limit > 0 ? bar(q.used, q.limit, 'Your whole Drive') : el('p', { class: 'small', text: `${human(q.used)} used · no limit` }), el('p', { class: 'small muted', text: 'Your whole Drive\'s space is shared with Gmail and Google Photos (15 GB free; more with Google One).' }));
    else head.push(el('p', { class: 'small muted', text: /Unknown action/i.test(qErr?.message ?? '') ? 'To see your Drive\'s space, update the Saved Files script to version 5 (Settings → Saved Files → Updating the script).' : navigator.onLine === false ? 'You\'re offline: your Drive shows when you\'re back online.' : `Couldn't ask your Drive: ${qErr?.message}` }));
    const counting = el('p', { class: 'small muted', 'aria-live': 'polite', text: 'Counting Saved Files\' folder…' });
    drive.replaceChildren(...head, counting);
    // (Saved Files' folder, folder by folder: what each part takes.)
    try {
      let folders = [{ id: '', path: '' }];
      try { folders = folders.concat((await api.folders()).map((f) => ({ id: f.id, path: f.path }))); } catch { /* a script from before folders: the main folder only */ }
      const got = [];
      for (const [i, f] of folders.entries()) {
        if (!alive) return;
        counting.textContent = `Counting Saved Files' folder… (${i + 1} of ${folders.length} folders)`;
        got.push({ path: f.path, files: (await api.browse(f.id)).files });
      }
      const t = tallyDrive(got);
      const mineDrive = t.files.bytes + t.socials.bytes + t.keys.bytes;
      const parts = [{ name: `Saved Files: your files (${t.files.n})`, bytes: t.files.bytes }, { name: `Socials' copy (${t.socials.n} files)`, bytes: t.socials.bytes }, { name: `Encryption keys and kit (${t.keys.n})`, bytes: t.keys.bytes }];
      if (q) parts.push({ name: 'The rest of your Drive (Gmail, Photos, other files)', bytes: Math.max(0, q.used - mineDrive) });
      const overhead = t.encrypted * VAULT_OVERHEAD + t.socialsEncrypted * SOCIALS_OVERHEAD;
      counting.replaceWith(
        el('h3', { class: 'stg-h', text: 'What\'s in it' }),
        pie(parts, { title: 'Google Drive', centerLabel: q ? 'used in Drive' : 'in Saved Files', min: 0 }),
        el('p', { class: 'small muted', text: `The app's own part: ${human(mineDrive)} in ${t.files.n + t.socials.n + t.keys.n} files. Encryption adds ${human(overhead)} of that (${t.encrypted} encrypted Saved Files, ${t.socialsEncrypted} Socials files).` }),
        el('button', { type: 'button', class: 'btn small', text: 'Count again', onclick: () => drawDrive() }));
    } catch (e) {
      counting.textContent = navigator.onLine === false ? 'You\'re offline: Saved Files\' folder is counted when you\'re back online.' : `Couldn't count Saved Files' folder: ${e.message}`;
    }
  }

  const limits = el('section', { class: 'card stg-card' },
    el('h2', { text: '⬆️ Uploading to Google Drive: the limits' }),
    el('ul', { class: 'stg-explain' },
      el('li', {}, el('strong', { text: `${human(DRIVE_FILE_MAX)} a file in Saved Files. ` }), 'The app has no server: each file goes from the phone to your own Saved Files script (an Apps Script web app in your Google account), which puts it in Drive. A file has to travel as text (base64), which makes it a third bigger, and Google takes requests to a script up to about 50 MB, which it also has to hold in memory to turn back into the file. So 25 MB (about 33 MB on the way) is kept as the most, safely under that. Downloads come back the same way, with the same limit.'),
      el('li', {}, el('strong', { text: 'Socials: photos and videos up to 24 MB are copied to Drive. ' }), 'The same limit, with room for its encryption. A video over 24 MB (up to 300 MB can be posted) stays on the phone it was posted from: it plays there, and your other devices show it\'s there only.'),
      el('li', {}, el('strong', { text: 'One file at a time, each within 6 minutes. ' }), 'Google stops any one run of a script after 6 minutes, so uploads go one after another; a slow connection is what limits them, not Drive.'),
      el('li', {}, el('strong', { text: 'Your Drive\'s space. ' }), 'Everything counts against your Google account\'s storage (15 GB free, shared with Gmail and Google Photos). When it\'s full, uploads fail until you free some or get more space.'),
      el('li', {}, el('strong', { text: 'Google\'s daily limits. ' }), 'Google limits how much an account can upload to Drive a day (750 GB) and how long scripts can run a day; the app comes nowhere near either in normal use.'),
      el('li', {}, el('strong', { text: 'Offline. ' }), 'Nothing can upload without a connection: Socials keeps what\'s new on the phone and copies it when you\'re back online; Saved Files needs a connection to open.')));

  const crypt = el('section', { class: 'card stg-card' },
    el('h2', { text: '🔐 How encryption affects storage' }),
    el('ul', { class: 'stg-explain' },
      el('li', {}, el('strong', { text: 'In Drive, almost nothing. ' }), `Each encrypted Saved File is the same size as the file plus about ${VAULT_OVERHEAD} bytes (0.4 KB): its header (the wrapped keys, so the file can be opened anywhere with the password or recovery key), the encrypted name, type and size, and a check that it hasn't been changed. A 5 MB photo takes 5 MB and 0.4 KB. Socials' files add just ${SOCIALS_OVERHEAD} bytes each.`),
      el('li', {}, el('strong', { text: 'It can\'t be compressed, but nothing is lost. ' }), 'Encrypted data looks random, so it can\'t be squeezed smaller. Drive doesn\'t compress files anyway, and photos, videos and PDFs are already compressed, so they take the same room encrypted or not.'),
      el('li', {}, el('strong', { text: 'A few small extra files. ' }), 'The keys file (a few KB) and the Decryption kit (a page, a Python script and a description of the format, about 15 KB together) are kept in Drive so your files can always be opened, even without this app.'),
      el('li', {}, el('strong', { text: 'On the way: a third more, not kept. ' }), 'Sending a file to your script as text adds a third to what goes over the connection (and counts toward the 25 MB limit), but Drive keeps it as the file itself.'),
      el('li', {}, el('strong', { text: 'On this device: no difference. ' }), 'Encryption is for what goes to Drive. On the phone the app keeps things as they are (Socials\' photos and videos too: its password locks the app, and its copy in Drive is what\'s encrypted), so encryption takes no room here.'),
      el('li', {}, el('strong', { text: 'Speed, not space. ' }), 'Encrypting and decrypting happens on the phone, quickly for photos; the password\'s 600,000-round check takes a moment once when you unlock, then it\'s remembered until the app is closed.')));

  const appLimits = el('section', { class: 'card stg-card' },
    el('h2', { text: '📏 Limits in the app' }),
    el('ul', { class: 'stg-explain' }, APP_LIMITS.map(([what, lim]) => el('li', {}, el('strong', { text: `${what}: ` }), lim))));

  host.append(el('div', { class: 'stg' }, device, drive, limits, crypt, appLimits));
  drawDevice();
  drawDrive();
  return () => { alive = false; };
}
