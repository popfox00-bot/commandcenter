// Reader (in the Vault): your private files, in folders, encrypted on this phone, opened by themselves while the
// Vault is open (reader-store.js). Add files (each compressed and encrypted), look at them (photos, videos, sound,
// PDFs, text), organize them in folders; 📤 Export packs a folder or what's picked into one compressed, locked file
// (.ccv: Reader's password or recovery key opens it anywhere, decrypt.html too) to save to a drive; 📥 Import opens
// one (or a ZIP, or any files) from a drive back in. The figures at the top: how many files, how big, how many folders.
import { el, fill } from '../../lib/dom.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes } from '../../lib/files.js';
import { strength } from '../../lib/vault.js';
import * as R from './reader-store.js';
import { pack, lock, open as openPackage, kindOf, baseName, LOCKED_EXT } from './reader-core.js';

const ICON = { image: '🖼', video: '🎬', audio: '🎵', pdf: '📄', text: '📝', zip: '🗜', locked: '🔒', other: '📦' };
const day = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

export function mount(host) {
  const root = el('div', { class: 'rd' }); host.append(root);
  let ix = { folders: [], files: [] }; let here = null; let picking = null; // (null, or a Set of ids picked)
  const urls = new Set(); const url = (b) => { const u = URL.createObjectURL(b); urls.add(u); return u; };
  const status = el('p', { class: 'small rd-status', role: 'status' });
  const say = (t, bad = false) => { status.textContent = t; status.classList.toggle('bad-text', bad); };

  start();
  async function start() {
    if (!(await R.isSetUp())) return setupScreen();
    if (await R.openHere()) { ix = await R.loadIndex(); return draw(); }
    unlockScreen();
  }

  // ---- First time: Reader's password, and its recovery key shown once.
  function setupScreen() {
    const pw = el('input', { type: 'password', class: 'so-input', autocomplete: 'new-password', 'aria-label': 'Reader password', placeholder: 'A password (8 characters or more)' });
    const pw2 = el('input', { type: 'password', class: 'so-input', autocomplete: 'new-password', 'aria-label': 'Reader password again', placeholder: 'The same again' });
    const meter = el('p', { class: 'small muted' }); const err = el('p', { class: 'bad-text small', role: 'alert' });
    pw.addEventListener('input', () => { const s = strength(pw.value); meter.textContent = pw.value ? `${s.level === 'strong' ? '💪 Strong' : s.level === 'ok' ? '👍 OK' : '⚠️ Weak'}: ${s.hint}` : ''; });
    const go = el('button', { type: 'button', class: 'btn primary block', text: 'Set up Reader', onclick: async () => {
      err.textContent = ''; if (pw.value !== pw2.value) { err.textContent = 'The passwords don\'t match.'; return; }
      go.disabled = true; go.textContent = 'Making your key…';
      try { const rk = await R.setUp(pw.value); recoveryScreen(rk); } catch (e) { err.textContent = e.message; go.disabled = false; go.textContent = 'Set up Reader'; }
    } });
    fill(root, el('div', { class: 'card rd-card' }, el('h2', { text: '🔐 Reader' }),
      el('p', { text: 'Your private files, encrypted on this phone, in folders. It opens by itself while the Vault is open.' }),
      el('p', { class: 'small muted', text: 'Choose Reader\'s own password: it opens your files on another device, and the packages you save to a drive. Nobody can reset it, so keep it (and the recovery key next) safe.' }),
      pw, pw2, meter, err, go));
  }
  function recoveryScreen(rk) {
    fill(root, el('div', { class: 'card rd-card' }, el('h2', { text: '🔑 Your recovery key' }),
      el('p', { text: 'If you forget Reader\'s password, this opens your files and packages instead. Write it down or keep it somewhere safe: it\'s shown only now.' }),
      el('p', { class: 'rd-rk', text: rk }),
      el('button', { type: 'button', class: 'btn primary block', text: 'I\'ve saved it', onclick: async () => { ix = await R.loadIndex(); draw(); } })));
  }
  function unlockScreen() {
    const pw = el('input', { type: 'password', class: 'so-input', autocomplete: 'current-password', 'aria-label': 'Reader password or recovery key', placeholder: 'Reader\'s password or recovery key' });
    const err = el('p', { class: 'bad-text small', role: 'alert' });
    const go = el('button', { type: 'button', class: 'btn primary block', text: 'Open', onclick: async () => { go.disabled = true; try { await R.openWith(pw.value); ix = await R.loadIndex(); draw(); } catch (e) { err.textContent = e.message; go.disabled = false; } } });
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
    fill(root, el('div', { class: 'card rd-card' }, el('h2', { text: '🔐 Reader' }), el('p', { text: 'This phone needs Reader\'s password once (after that it opens by itself with the Vault).' }), pw, err, go));
  }

  // ---- The library.
  function draw(note = '') {
    const all = R.stats(ix); const st = here ? R.stats(ix, here) : all;
    const folders = ix.folders.filter((f) => f.parent === here).sort((a, b) => a.name.localeCompare(b.name));
    const files = ix.files.filter((f) => f.folder === here).sort((a, b) => a.name.localeCompare(b.name));
    const crumbs = [{ id: null, name: 'Reader' }, ...R.pathOf(ix, here)];
    const add = el('input', { type: 'file', multiple: true, class: 'visually-hidden', id: 'rd-add' });
    add.addEventListener('change', () => { const f = [...add.files]; add.value = ''; if (f.length) addFiles(f); });
    const imp = el('input', { type: 'file', multiple: true, class: 'visually-hidden', id: 'rd-import', accept: `${LOCKED_EXT},.zip,application/zip,*/*` });
    imp.addEventListener('change', () => { const f = [...imp.files]; imp.value = ''; if (f.length) importFiles(f); });
    const pickedN = picking?.size ?? 0;
    fill(root,
      el('div', { class: 'rd-top' }, el('h2', { text: '🔐 Reader' }), el('button', { type: 'button', class: 'btn small ghost', text: '🔒 Lock', onclick: () => { R.close(); here = null; unlockScreen(); } })),
      el('div', { class: 'rd-stats', role: 'group', 'aria-label': 'What\'s in Reader' },
        el('div', {}, el('strong', { text: String(st.files) }), el('span', { text: st.files === 1 ? 'file' : 'files' })),
        el('div', {}, el('strong', { text: formatBytes(st.size) }), el('span', { text: 'in all' })),
        el('div', {}, el('strong', { text: String(st.folders) }), el('span', { text: st.folders === 1 ? 'folder' : 'folders' }))),
      el('p', { class: 'small muted rd-stored', text: `${here ? `This folder: ${st.files} of ${all.files} files. ` : ''}Kept on this phone: ${formatBytes(st.stored)}, compressed and encrypted${st.size ? ` (${Math.round((1 - st.stored / Math.max(1, st.size)) * 100)}% smaller)` : ''}.` }),
      el('nav', { class: 'rd-crumbs', 'aria-label': 'Folders' }, crumbs.flatMap((c, i) => [i ? el('span', { class: 'muted', text: ' › ' }) : null, i === crumbs.length - 1 ? el('strong', { text: c.name }) : el('button', { type: 'button', class: 'so-link', text: c.name, onclick: () => { here = c.id; picking = null; draw(); } })])),
      el('div', { class: 'rd-actions' },
        el('label', { class: 'btn primary', for: 'rd-add', text: '＋ Add files' }), add,
        el('button', { type: 'button', class: 'btn', text: '📁 New folder', onclick: () => { const n = prompt('Folder name'); if (n?.trim()) R.newFolder(n.trim(), here).then(async () => { ix = await R.loadIndex(); draw(); }); } }),
        el('label', { class: 'btn', for: 'rd-import', text: '📥 Import' }), imp,
        el('button', { type: 'button', class: 'btn', text: '📤 Export', disabled: !st.files, onclick: () => exportDialog(here, null) }),
        el('button', { type: 'button', class: `btn ghost${picking ? ' on' : ''}`, text: picking ? 'Done' : 'Select', disabled: !files.length && !picking, onclick: () => { picking = picking ? null : new Set(); draw(); } })),
      picking ? el('div', { class: 'rd-pickbar', role: 'toolbar', 'aria-label': 'Files picked' }, el('span', { text: `${pickedN} picked` }),
        el('button', { type: 'button', class: 'btn small', text: 'Move to…', disabled: !pickedN, onclick: () => moveDialog([...picking]) }),
        el('button', { type: 'button', class: 'btn small', text: '📤 Export', disabled: !pickedN, onclick: () => exportDialog(here, [...picking]) }),
        el('button', { type: 'button', class: 'btn small danger', text: 'Delete', disabled: !pickedN, onclick: async () => { if (!confirm(`Delete ${pickedN} file${pickedN === 1 ? '' : 's'} from Reader? This can't be undone.`)) return; await R.deleteFiles([...picking]); picking = new Set(); ix = await R.loadIndex(); draw(`Deleted ${pickedN}.`); } })) : null,
      status,
      el('ul', { class: 'rd-list' },
        folders.map((f) => { const s = R.stats(ix, f.id); return el('li', { class: 'rd-row rd-folder' },
          el('button', { type: 'button', class: 'rd-open', onclick: () => { here = f.id; picking = null; draw(); }, 'aria-label': `Folder ${f.name}, ${s.files} files` }, el('span', { class: 'rd-ic', text: '📁' }), el('span', { class: 'rd-name' }, el('strong', { text: f.name }), el('span', { class: 'small muted', text: `${s.files} file${s.files === 1 ? '' : 's'} · ${formatBytes(s.size)}${s.folders ? ` · ${s.folders} folder${s.folders === 1 ? '' : 's'}` : ''}` }))),
          el('button', { type: 'button', class: 'icon-btn small-btn', 'aria-label': `Rename ${f.name}`, text: '✎', onclick: async () => { const n = prompt('Folder name', f.name); if (n?.trim()) { await R.renameFolder(f.id, n); ix = await R.loadIndex(); draw(); } } }),
          el('button', { type: 'button', class: 'icon-btn small-btn', 'aria-label': `Delete ${f.name}`, text: '🗑', onclick: async () => { if (!confirm(`Delete "${f.name}" and the ${s.files} file${s.files === 1 ? '' : 's'} in it? This can't be undone.`)) return; await R.deleteFolder(f.id); ix = await R.loadIndex(); draw(); } })); }),
        files.map((f, i) => el('li', { class: `rd-row${picking?.has(f.id) ? ' on' : ''}` },
          picking ? el('input', { type: 'checkbox', checked: picking.has(f.id), 'aria-label': `Pick ${f.name}`, onchange: (e) => { if (e.target.checked) picking.add(f.id); else picking.delete(f.id); draw(); } }) : null,
          el('button', { type: 'button', class: 'rd-open', 'aria-label': `Open ${f.name}`, onclick: () => (picking ? (picking.has(f.id) ? picking.delete(f.id) : picking.add(f.id), draw()) : viewer(files, i)) },
            el('span', { class: 'rd-ic', text: ICON[kindOf(f.name, f.type)] }), el('span', { class: 'rd-name' }, el('strong', { text: f.name }), el('span', { class: 'small muted', text: `${formatBytes(f.size)} · ${day(f.at)}` }))))),
        !folders.length && !files.length ? el('li', { class: 'rd-empty muted', text: here ? 'This folder is empty.' : 'Nothing here yet: ＋ Add files, or 📥 Import a package from a drive.' }) : null));
    if (note) say(note);
  }

  async function addFiles(list) {
    say(`Encrypting ${list.length} file${list.length === 1 ? '' : 's'}…`);
    try { await R.addFiles(list, here, { onProgress: (d, t) => say(`Encrypting… ${d} of ${t}`) }); ix = await R.loadIndex(); draw(`Added ${list.length} file${list.length === 1 ? '' : 's'}, encrypted.`); } catch (e) { say(e.message, true); }
  }

  /** What to unlock a package with, asked (null when canceled). */
  const askSecret = (name) => new Promise((ok) => {
    const pw = el('input', { type: 'password', class: 'so-input', 'aria-label': 'Package password or recovery key', placeholder: 'Its password or recovery key' });
    const dlg = el('dialog', { class: 'ed-dialog', 'aria-label': 'Unlock package' }, el('div', { class: 'sheet' }, el('h2', { text: '🔒 Locked package' }), el('p', { class: 'small', text: `"${name}" was locked with another password. Enter it (or its recovery key).` }), pw,
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary', text: 'Unlock', onclick: () => { const v = pw.value; dlg.close(); ok(v); } }), el('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onclick: () => { dlg.close(); ok(null); } }))));
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') dlg.querySelector('.btn.primary').click(); });
    dlg.addEventListener('close', () => { dlg.remove(); ok(null); }); document.body.append(dlg); dlg.showModal(); pw.focus();
  });

  // ---- 📥 Import: packages (opened by Reader's own key with no question, else their password), ZIPs, any files.
  async function importFiles(list) {
    let n = 0;
    for (const f of list) {
      say(`Opening ${f.name}…`);
      try {
        let r; let secret = '';
        for (;;) { try { r = await openPackage(f, { secret, session: R.current() }); break; } catch (e) { if (!e.needsSecret && !/Wrong password/.test(e.message)) throw e; if (secret) say('That password didn\'t open it.', true); secret = await askSecret(f.name); if (secret == null) { r = null; break; } } }
        if (!r) continue;
        // (A package or ZIP of several: into a folder of its name.)
        let into = here; if (r.files.length > 1) { into = await R.newFolder(baseName(r.inner ?? f.name), here, null, { unique: true }); }
        await R.addFiles(r.files, into, { onProgress: (d, t) => say(`Adding ${f.name}… ${d} of ${t}`) }); n += r.files.length;
      } catch (e) { say(`${f.name}: ${e.message}`, true); return; }
    }
    ix = await R.loadIndex(); draw(n ? `Imported ${n} file${n === 1 ? '' : 's'}, encrypted.` : 'Nothing imported.');
  }

  // ---- 📤 Export: one compressed, locked package, saved to a drive (or shared, or downloaded).
  function exportDialog(folder, ids) {
    const items = R.filesUnder(ix, folder).filter((x) => !ids || ids.includes(x.entry.id));
    const name = el('input', { type: 'text', class: 'so-input', 'aria-label': 'Package name', value: ids ? `${R.pathOf(ix, folder).at(-1)?.name ?? 'Reader'} (${items.length})` : (R.pathOf(ix, folder).at(-1)?.name ?? 'Reader') });
    const mode = el('select', { class: 'so-input', 'aria-label': 'Lock it with' }, el('option', { value: 'reader', text: 'Reader\'s password (and recovery key)' }), el('option', { value: 'other', text: 'A different password' }), el('option', { value: 'none', text: 'Not locked (just compressed, .zip)' }));
    const other = el('input', { type: 'password', class: 'so-input', 'aria-label': 'Package password', placeholder: 'Its password (6 or more)', hidden: true });
    mode.addEventListener('change', () => { other.hidden = mode.value !== 'other'; });
    const out = el('div', { class: 'rd-export-out' }); const note = el('p', { class: 'small', role: 'status' });
    const make = el('button', { type: 'button', class: 'btn primary block', text: `Make the package (${items.length} file${items.length === 1 ? '' : 's'})`, onclick: async () => {
      make.disabled = true; fill(out);
      try {
        const files = []; for (const [i, x] of items.entries()) { note.textContent = `Reading ${i + 1} of ${items.length}…`; const f = await R.readFile(x.entry); files.push(new File([f], x.path, { type: f.type })); }
        note.textContent = 'Compressing…'; const z = await pack(files, name.value);
        let file = z.file; let rk = null;
        if (mode.value !== 'none') { note.textContent = 'Locking…'; const l = await lock(z.file, mode.value === 'reader' ? { session: R.current() } : { password: other.value }); file = l.file; rk = l.recoveryKey; }
        note.textContent = `${file.name}: ${formatBytes(file.size)} (from ${formatBytes(z.before)}).`;
        fill(out, ...saveButtons(file), rk ? el('p', { class: 'small' }, 'Its recovery key (if its password is forgotten): ', el('code', { text: rk })) : null,
          el('p', { class: 'small muted', text: mode.value === 'none' ? 'Not encrypted: anyone with the file can open it.' : 'Opens in Reader (📥 Import) or in decrypt.html on any computer, with its password or recovery key.' }));
      } catch (e) { note.textContent = e.message; }
      make.disabled = false;
    } });
    const dlg = el('dialog', { class: 'ed-dialog vp-dialog', 'aria-label': 'Export' }, el('div', { class: 'sheet' },
      el('div', { class: 'row space' }, el('h2', { text: '📤 Export' }), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '✕', onclick: () => dlg.close() })),
      el('p', { class: 'small muted', text: `${items.length} file${items.length === 1 ? '' : 's'}, ${formatBytes(items.reduce((n, x) => n + x.entry.size, 0))}, packed into one compressed file, folders kept.` }),
      el('label', { class: 'field' }, el('span', { text: 'Name' }), name), el('label', { class: 'field' }, el('span', { text: 'Lock it with' }), mode), other,
      make, note, out));
    dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal();
  }
  /** Ways to save a file: straight to a drive or folder where the browser can, Share (iPhone: Save to Files → the drive), Download. */
  function saveButtons(file) {
    const out = [];
    if (globalThis.showSaveFilePicker) out.push(el('button', { type: 'button', class: 'btn primary', text: '💾 Save to a drive…', onclick: async () => { try { const h = await showSaveFilePicker({ suggestedName: file.name }); const w = await h.createWritable(); await w.write(file); await w.close(); say(`Saved ${file.name}.`); } catch (e) { if (e?.name !== 'AbortError') say(e.message, true); } } }));
    if (canShareFiles([file])) out.push(el('button', { type: 'button', class: `btn${out.length ? '' : ' primary'}`, text: 'Share / Save to Files', onclick: () => shareFiles([file], file.name).catch(() => {}) }));
    out.push(el('button', { type: 'button', class: 'btn ghost', text: 'Download', onclick: () => downloadBlob(file, file.name) }));
    return [el('div', { class: 'row wrap' }, ...out), canShareFiles([file]) && !globalThis.showSaveFilePicker ? el('p', { class: 'small muted', text: 'To put it on a drive plugged into an iPhone: Share → Save to Files → pick the drive.' }) : null];
  }

  function moveDialog(ids) {
    const opts = [{ id: null, name: 'Reader (top)' }, ...ix.folders.map((f) => ({ id: f.id, name: R.pathOf(ix, f.id).map((p) => p.name).join(' › ') }))].sort((a, b) => (a.id == null ? -1 : b.id == null ? 1 : a.name.localeCompare(b.name)));
    const dlg = el('dialog', { class: 'ed-dialog vp-dialog', 'aria-label': 'Move to' }, el('div', { class: 'sheet' },
      el('div', { class: 'row space' }, el('h2', { text: `Move ${ids.length} to…` }), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '✕', onclick: () => dlg.close() })),
      el('div', { class: 'rd-movelist' }, opts.map((o) => el('button', { type: 'button', class: 'btn block ghost', text: `📁 ${o.name}`, onclick: async () => { await R.moveFiles(ids, o.id); dlg.close(); picking = new Set(); ix = await R.loadIndex(); draw(`Moved ${ids.length} to ${o.name}.`); } })))));
    dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal();
  }

  // ---- Looking at a file: decrypted in memory only; ‹ › for the folder's others.
  function viewer(files, i0) {
    let i = i0; const body = el('div', { class: 'rd-view-body' }); const title = el('strong', { class: 'rd-view-title' }); const info = el('span', { class: 'small muted' });
    const bar = el('div', { class: 'rd-view-acts row wrap' });
    const dlg = el('dialog', { class: 'rd-viewer', 'aria-label': 'File' }, el('div', { class: 'rd-view-top' },
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '✕', onclick: () => dlg.close() }), el('div', { class: 'rd-view-head' }, title, info),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous', text: '‹', onclick: () => { i = (i - 1 + files.length) % files.length; show(); } }),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next', text: '›', onclick: () => { i = (i + 1) % files.length; show(); } })), body, bar);
    let shown = [];
    const show = async () => {
      for (const u of shown) URL.revokeObjectURL(u); shown = [];
      const e = files[i]; title.textContent = e.name; info.textContent = `${formatBytes(e.size)} · ${day(e.at)} · ${i + 1} of ${files.length}`; fill(body, el('p', { class: 'muted', text: 'Opening…' })); fill(bar);
      try {
        const f = await R.readFile(e); if (files[i] !== e) return; const k = kindOf(e.name, f.type); const u = URL.createObjectURL(f); shown.push(u);
        if (k === 'image') fill(body, el('img', { src: u, alt: e.name }));
        else if (k === 'video') fill(body, el('video', { src: u, controls: true, playsinline: true }));
        else if (k === 'audio') fill(body, el('audio', { src: u, controls: true }));
        else if (k === 'text') fill(body, el('pre', { class: 'rd-text', text: (await f.slice(0, 400000).text()) + (f.size > 400000 ? '\n…' : '') }));
        else if (k === 'pdf') { fill(body, el('p', { class: 'muted', text: 'Opening the PDF…' })); const P = await import('../../lib/pdf-reader.js'); const doc = await P.openPdf(f); const pages = []; for (let n = 1; n <= Math.min(doc.numPages, 20); n++) pages.push(await P.renderPage(doc, n, { dpi: 110, maxEdge: 1400 })); P.closePdf(doc); if (files[i] === e) fill(body, el('div', { class: 'rd-pdf' }, pages, doc.numPages > 20 ? el('p', { class: 'muted small', text: `The first 20 of ${doc.numPages} pages: save it to see the rest.` }) : null)); }
        else fill(body, el('p', { class: 'muted', text: 'No preview for this kind of file: save it to open it in another app.' }));
        fill(bar, canShareFiles([f]) ? el('button', { type: 'button', class: 'btn', text: 'Share', onclick: () => shareFiles([f], f.name).catch(() => {}) }) : null, el('button', { type: 'button', class: 'btn ghost', text: 'Save', onclick: () => downloadBlob(f, f.name) }),
          el('button', { type: 'button', class: 'btn ghost danger', text: 'Delete', onclick: async () => { if (!confirm(`Delete "${e.name}" from Reader?`)) return; await R.deleteFiles([e.id]); dlg.close(); ix = await R.loadIndex(); draw(`Deleted "${e.name}".`); } }));
      } catch (err) { fill(body, el('p', { class: 'bad-text', text: err.message })); }
    };
    dlg.addEventListener('close', () => { for (const u of shown) URL.revokeObjectURL(u); dlg.remove(); });
    dlg.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { i = (i - 1 + files.length) % files.length; show(); } else if (e.key === 'ArrowRight') { i = (i + 1) % files.length; show(); } });
    document.body.append(dlg); dlg.showModal(); show();
  }

  return () => { for (const u of urls) URL.revokeObjectURL(u); };
}
