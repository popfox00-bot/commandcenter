// Files → Saved Files: the files in your own Google Drive folder (through the Apps Script in your
// "Saved Files" spreadsheet). Save files from the phone into it, open them (photos into the editor,
// PDFs to write on), save them back to the phone, or delete them. Needs a connection; the rest of
// Files works offline. Connected once in Settings → Saved Files (the script's URL and access key).
// With encryption on (Settings), files are encrypted on the phone first and unlocked once per session.
// Folders (with a version 3 script): open them, make, rename and delete them, move files between them
// (and, version 4, folders into folders). File icons are colour-coded by kind (or the file's own small picture,
// once it's been scanned or starred). 🔎 finds your Socials accounts in photos and videos (scanner.js; files
// saved from the phone are scanned as they're saved); the ones you confirm are marked 👤 and can be filtered by.

import { el, fill, about } from '../../lib/dom.js';
import { getConfig, savedFiles, secureFiles, knownHeader, isKitFile, KIT_FOLDER, fileKind, size } from '../../lib/saved-files.js';
import { unlocked, lock } from '../../lib/vault.js';
import { unlockForm } from '../../lib/vault-ui.js';
import { shareFiles, canShareFiles, downloadBlob } from '../../lib/files.js';
import { listFavs, addFav, removeFav, favoritesView } from './favorites.js';
import { openScanner, openMatches, scannable, listMatches, thumbsOf, autoScan } from './scanner.js';

/** A colour-coded tile: the kind's colour and emoji, with the extension under it. */
function icon(f) {
  if (f.folder) return el('span', { class: 'sv-icon sv-k-folder', 'aria-hidden': 'true' }, el('span', { text: '📁' }));
  if (f.locked) return el('span', { class: 'sv-icon sv-k-locked', 'aria-hidden': 'true' }, el('span', { text: '🔒' }));
  const k = fileKind(f.name, f.type);
  return el('span', { class: `sv-icon sv-k-${k.kind}`, 'aria-hidden': 'true', title: k.kind },
    el('span', { text: k.emoji }), k.label ? el('small', { class: 'sv-ext', text: k.label }) : null);
}

export function mount(host, { onEdit = null, onWrite = null } = {}) {
  const root = el('div', { class: 'sv' });
  host.append(root);
  let api = null; let files = []; let busy = '';
  // The folder shown ('' : the main one), the path down to it, and its folders (null: the script has no folders).
  let here = ''; let path = []; let folders = [];
  const where = () => (here ? { id: here } : '');
  // (Starred files: their ids, for the ☆ on each; the Favorites view when it's open.)
  let favIds = new Set(); let inFavs = false;
  listFavs().then((l) => { favIds = new Set(l.map((x) => x.id)); if (!inFavs && api) render(); });
  // (Character matches: who's in which file (👤 on its row), the person filtered by ('' : everyone), and a
  // scan of files just saved, to review.)
  let matches = []; let person = ''; let scanned = null;
  const refreshMatches = () => listMatches().then((l) => { matches = l; for (const [k, v] of thumbUrls) if (!v) thumbUrls.delete(k); if (!inFavs && api && !busy) render(); });
  const whoIn = (id) => [...new Set(matches.filter((m) => m.fileId === id).map((m) => m.handle))].sort(); // (several people in a file: each)
  // (Files' own small pictures, made when scanned (or starred): shown in place of the kind's tile.)
  const thumbUrls = new Map();
  refreshMatches();
  async function thumbInto(tile, f) {
    let u = thumbUrls.get(f.id);
    if (u === undefined) { const [b] = await thumbsOf(f.id).catch(() => []); u = b ? URL.createObjectURL(b) : null; thumbUrls.set(f.id, u); }
    if (u && tile.isConnected) tile.replaceWith(el('span', { class: 'sv-icon sv-thumb', 'aria-hidden': 'true' }, el('img', { src: u, alt: '' })));
  }

  // Connecting (the script's URL and access key) is done in Settings → Saved Files.
  function notConnected() {
    root.replaceChildren(el('div', { class: 'card sv-setup' },
      el('h2', { text: '☁️ Saved Files' }),
      el('p', { class: 'small', text: 'Keep files in your own Google Drive folder. Connect it once in Settings → Saved Files, with the web app URL and access key of the script in your Saved Files spreadsheet.' }),
      el('a', { class: 'btn primary', href: '#/settings/saved', text: 'Open Settings' })));
  }

  async function show(note = '') {
    if (inFavs) return;
    const cfg = getConfig();
    if (!cfg) { notConnected(); return; }
    api = secureFiles(savedFiles(cfg));
    render(note || 'Loading…');
    try { await load(); render(note); } catch (err) {
      if (here && /No such folder/.test(err.message)) { here = ''; path = []; show('That folder is gone (deleted in Drive?).'); return; }
      render('', err.message);
    }
  }
  async function load() { ({ files, folders, path } = await api.browse(here)); }
  const reload = () => load().catch(() => {});
  function go(id) { here = id; files = []; folders = []; path = []; show(); }

  async function act(label, fn) {
    busy = label; render();
    try { await fn(); } catch (err) { busy = ''; render('', err.message); return false; }
    busy = ''; return true;
  }

  async function upload(list) {
    const picked = [...list];
    if (!picked.length) return;
    let n = 0; const saved = []; const local = new Map();
    const ok = await act(`Saving ${picked.length === 1 ? `"${picked[0].name}"` : `${picked.length} files`}…`, async () => {
      for (const f of picked) {
        const out = await api.upload(f, 'Files', where()); n++;
        if (out?.id) { saved.push({ id: out.id, name: f.name, type: f.type, size: f.size }); local.set(out.id, f); }
      }
    });
    await reload();
    const done = ok ? `Saved ${n} file${n === 1 ? '' : 's'} to ${here ? `"${path.at(-1)?.name}"` : 'your Drive'}.` : '';
    render(done);
    if (saved.some(scannable)) scanSaved(saved, local, done);
  }
  // (Files just saved: scanned for your Socials accounts from the picked files themselves, then a note to review.)
  async function scanSaved(saved, local, note = '') {
    scanned = { busy: true, n: saved.filter(scannable).length }; render(note);
    let r = []; try { r = await autoScan(saved, local); } catch { r = []; }
    for (const f of saved) thumbUrls.delete(f.id);
    if (r.locked) scanned = { locked: true, files: r.files };
    else { const hits = r.filter((x) => x.hits.length); scanned = hits.length ? { results: r, hits: hits.length } : null; }
    if (!inFavs && !busy) render(note);
  }
  function scanNote() {
    if (!scanned) return null;
    if (scanned.busy) return el('p', { class: 'small muted sv-scan-note', role: 'status', text: `🔎 Looking for your Socials accounts in the ${scanned.n === 1 ? 'new file' : `${scanned.n} new files`}…` });
    const close = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Dismiss', text: '✕', onclick: () => { scanned = null; render(); } });
    if (scanned.locked) {
      const files = scanned.files;
      return el('div', { class: 'card sv-scan-note', role: 'status' }, el('span', { class: 'small', text: `🔎 The new photos and videos weren't scanned: Socials is locked.` }),
        el('button', { type: 'button', class: 'btn small-btn primary', text: 'Scan them', onclick: () => { scanned = null; render(); openScanner(files, { download: (id) => api.download(id), onChange: refreshMatches }); } }), close);
    }
    const { results } = scanned;
    return el('div', { class: 'card sv-scan-note', role: 'status' }, el('span', { class: 'small', text: `🔎 ${scanned.hits === 1 ? 'A new file' : `${scanned.hits} new files`} might show your Socials accounts.` }),
      el('button', { type: 'button', class: 'btn small-btn primary', text: 'Review', onclick: () => { scanned = null; render(); openScanner(results.map((x) => x.f), { download: (id) => api.download(id), results, onChange: refreshMatches }); } }), close);
  }

  async function open(f, then) {
    let file = null;
    if (!await act(`Opening "${f.name}"…`, async () => { file = await api.download(f.id); })) return;
    render();
    then(file);
  }
  const toPhone = (file) => { if (canShareFiles([file])) shareFiles([file], file.name).catch(() => {}); else downloadBlob(file, file.name); };
  function view(file) {
    const u = URL.createObjectURL(file);
    const body = file.type.startsWith('image/') ? el('img', { class: 'sv-view-img', src: u, alt: file.name })
      : file.type === 'application/pdf' || file.type.startsWith('text/') ? el('iframe', { class: 'sv-view-doc', src: u, title: file.name })
        : el('p', { class: 'muted', text: 'This kind of file can\'t be shown here. Save it to the phone to open it.' });
    const dlg = el('dialog', { class: 'ed-dialog sv-viewer' }, el('div', { class: 'sheet' },
      el('h2', { text: file.name }), body,
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn', text: 'Save to phone', onclick: () => toPhone(file) }),
        el('button', { class: 'btn ghost', text: 'Close', onclick: () => dlg.close() }))));
    dlg.addEventListener('close', () => { dlg.remove(); URL.revokeObjectURL(u); });
    document.body.append(dlg);
    dlg.showModal();
  }

  // (☆: a file starred, its card made from it (it's downloaded once for that); ★: taken off.)
  async function toggleFav(f) {
    if (favIds.has(f.id)) { const l = await removeFav(f.id); favIds = new Set(l.map((x) => x.id)); render(`"${f.name}" taken off your favorites.`); return; }
    let file = null;
    if (!await act(`Adding "${f.name}" to your favorites…`, async () => { file = await api.download(f.id); })) return;
    busy = `Adding "${f.name}" to your favorites…`; render();
    try { const l = await addFav(f, file); favIds = new Set(l.map((x) => x.id)); busy = ''; render(`★ "${f.name}" is in your favorites.`); } catch (err) { busy = ''; render('', err.message); }
  }
  function openFavs() {
    inFavs = true;
    favoritesView(root, {
      onBack: () => { inFavs = false; listFavs().then((l) => { favIds = new Set(l.map((x) => x.id)); show(); }); },
      onOpen: async (fav) => { const cfg = getConfig(); if (!cfg) return; api ??= secureFiles(savedFiles(cfg)); try { view(await api.download(fav.id)); } catch (err) { alert(`Couldn't open it: ${err.message}`); } },
    });
  }

  async function encrypt(list) {
    let n = 0;
    const ok = await act(`Encrypting ${list.length === 1 ? `"${list[0].name}"` : `${list.length} files`}…`, async () => { for (const f of list) { await api.encryptExisting(f, where()); n++; } });
    await reload();
    render(ok ? `Encrypted ${n} file${n === 1 ? '' : 's'} (the plain copies are in Drive's trash for 30 days).` : '');
  }

  async function newFolder() {
    const name = prompt(here ? `New folder in "${path.at(-1)?.name}":` : 'New folder:')?.trim();
    if (!name) return;
    let made = null;
    if (!await act(`Making "${name}"…`, async () => { made = await api.mkdir(name, here); })) return;
    await reload();
    render(`Folder "${made.name}" is ready.`);
  }
  async function renameFolder(d) {
    const name = prompt(`Rename "${d.name}" to:`, d.name)?.trim();
    if (!name || name === d.name) return;
    if (!await act(`Renaming "${d.name}"…`, () => api.rename(d.id, name))) return;
    await reload();
    render(`Renamed to "${name}".`);
  }
  async function deleteFolder(d) {
    if (!confirm(`Delete the folder "${d.name}" and everything in it from your Drive? (It goes to Drive's trash for 30 days.)`)) return;
    if (!await act(`Deleting "${d.name}"…`, () => api.rmdir(d.id))) return;
    folders = folders.filter((x) => x.id !== d.id);
    render(`Deleted the folder "${d.name}".`);
  }
  // Where to move something: a dialog of every folder (less those it can't go to); resolves to
  // { id, path } or null.
  function pickFolder(title, all, skip) {
    return new Promise((resolve) => {
      let picked = null;
      const to = [{ id: '', path: '☁️ Saved Files (main folder)' }, ...all].filter((d) => !skip(d));
      const dlg = el('dialog', { class: 'ed-dialog sv-move' }, el('div', { class: 'sheet' },
        el('h2', { text: title }),
        to.length ? el('ul', { class: 'sv-list' }, ...to.map((d) => el('li', {}, el('button', { class: 'btn block sv-dest', text: d.id ? `📁 ${d.path}` : d.path, onclick: () => { picked = d; dlg.close(); } })))) : el('p', { class: 'muted small', text: 'No other folders yet: make one with "+ New folder".' }),
        el('div', { class: 'row end' }, el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => dlg.close() }))));
      dlg.addEventListener('close', () => { dlg.remove(); resolve(picked); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }
  async function allFolders() {
    let all = null;
    if (!await act('Loading folders…', async () => { all = await api.folders(); })) return null;
    render();
    return all;
  }
  const whereTo = (d) => (d.id ? `"${d.path}"` : 'the main folder');
  // Move a file into another folder.
  async function move(f) {
    const all = await allFolders(); if (!all) return;
    const d = await pickFolder(`Move "${f.name}" to`, all, (x) => x.id === here);
    if (!d) return;
    if (!await act(`Moving "${f.name}"…`, () => api.move(f.id, d.id))) return;
    files = files.filter((x) => x.id !== f.id);
    render(`Moved "${f.name}" to ${whereTo(d)}.`);
  }
  // Move a folder (and everything in it) into another one: not into itself or a folder inside it.
  async function moveFolder(folder) {
    const all = await allFolders(); if (!all) return;
    const own = all.find((x) => x.id === folder.id)?.path ?? folder.name;
    const d = await pickFolder(`Move the folder "${folder.name}" to`, all, (x) => x.id === here || x.id === folder.id || x.path?.startsWith(`${own}/`));
    if (!d) return;
    const ok = await act(`Moving "${folder.name}"…`, async () => {
      try { await api.moveFolder(folder.id, d.id); } catch (err) {
        throw /Unknown action/.test(err.message) ? new Error('Moving folders needs the newer Saved Files script (version 4): paste the new apps-script/saved-files.gs and deploy a new version (Settings → Saved Files).') : err;
      }
    });
    if (!ok) return;
    folders = folders.filter((x) => x.id !== folder.id);
    render(`Moved the folder "${folder.name}" to ${whereTo(d)}.`);
  }

  function render(note = '', error = '') {
    const picker = el('input', { type: 'file', multiple: true, hidden: true, id: 'sv-file' });
    picker.addEventListener('change', () => { upload(picker.files); picker.value = ''; });
    const vault = knownHeader(); const unlockedNow = !!unlocked();
    const kitHere = path.length === 1 && path[0].name === KIT_FOLDER; // the decryption kit: plain on purpose
    const isKit = (f) => kitHere || isKitFile(f.name);
    const plain = vault && unlockedNow ? files.filter((f) => !f.encrypted && !isKit(f)) : [];
    const crumbs = here || path.length ? el('nav', { class: 'row wrap sv-crumbs', 'aria-label': 'Folder' },
      el('button', { class: 'btn small-btn ghost', text: '☁️ Saved Files', disabled: !!busy, onclick: () => go('') }),
      ...path.flatMap((p, i) => [el('span', { class: 'muted', 'aria-hidden': 'true', text: '›' }),
        i === path.length - 1 ? el('strong', { 'aria-current': 'page', text: `📁 ${p.name}` }) : el('button', { class: 'btn small-btn ghost', text: p.name, disabled: !!busy, onclick: () => go(p.id) })])) : null;
    const folderList = folders?.length ? el('ul', { class: 'sv-list' }, ...folders.map((d) => el('li', { class: 'card sv-item sv-folder' },
      icon({ folder: true }),
      el('button', { class: 'sv-open', 'aria-label': `Open folder ${d.name}`, disabled: !!busy, onclick: () => go(d.id) }, el('strong', { class: 'sv-name', text: d.name })),
      el('span', { class: 'row wrap sv-actions' },
        el('button', { class: 'btn small-btn', text: 'Open', disabled: !!busy, onclick: () => go(d.id) }),
        el('button', { class: 'btn small-btn ghost', text: 'Rename', 'aria-label': `Rename folder ${d.name}`, disabled: !!busy, onclick: () => renameFolder(d) }),
        el('button', { class: 'btn small-btn ghost', text: 'Move', 'aria-label': `Move folder ${d.name}`, disabled: !!busy, onclick: () => moveFolder(d) }),
        el('button', { class: 'btn small-btn ghost bad-text', text: 'Delete', 'aria-label': `Delete folder ${d.name}`, disabled: !!busy, onclick: () => deleteFolder(d) }))))) : null;
    // (By person: the handles matched to files here; a chip each to show only theirs.)
    const people = [...new Set(matches.filter((m) => files.some((f) => f.id === m.fileId)).map((m) => m.handle))].sort();
    if (person && !people.includes(person)) person = '';
    const chips = people.length ? el('div', { class: 'row wrap sv-people', role: 'group', 'aria-label': 'Show files of' },
      ['', ...people].map((h) => el('button', { type: 'button', class: `btn small-btn sv-chip${person === h ? ' on' : ''}`, 'aria-pressed': String(person === h), text: h ? `👤 @${h}` : 'Everyone', onclick: () => { person = h; render(); } }))) : null;
    const shown = person ? files.filter((f) => whoIn(f.id).includes(person)) : files;
    const tileOf = (f) => { const t = icon(f); if (!f.folder && !f.locked && scannable(f)) thumbInto(t, f); return t; };
    const list = shown.length ? el('ul', { class: 'sv-list' }, ...shown.map((f) => el('li', { class: `card sv-item${f.locked ? ' sv-locked' : ''}` },
      tileOf(f),
      el('span', { class: 'sv-meta' }, el('strong', { class: 'sv-name', text: f.name }),
        whoIn(f.id).length ? el('span', { class: 'small sv-match', text: `👤 ${whoIn(f.id).map((h) => `@${h}`).join(', ')}` }) : null,
        el('span', { class: 'muted small', text: [f.locked ? '' : size(f.size), new Date(f.updated).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }), f.encrypted && !f.locked ? '🔒 encrypted' : isKit(f) ? 'decryption kit' : vault ? 'not encrypted' : ''].filter(Boolean).join(' · ') })),
      f.locked ? null : el('span', { class: 'row wrap sv-actions' },
        el('button', { class: 'btn small-btn', text: 'Open', disabled: !!busy, onclick: () => open(f, view) }),
        el('button', { class: `btn small-btn${favIds.has(f.id) ? ' sv-fav-on' : ''}`, text: favIds.has(f.id) ? '★' : '☆', 'aria-label': favIds.has(f.id) ? `Unfavorite ${f.name}` : `Favorite ${f.name}`, 'aria-pressed': String(favIds.has(f.id)), disabled: !!busy, onclick: () => toggleFav(f) }),
        vault && unlockedNow && !f.encrypted && !isKit(f) ? el('button', { class: 'btn small-btn', text: '🔒 Encrypt', 'aria-label': `Encrypt ${f.name}`, disabled: !!busy, onclick: () => encrypt([f]) }) : null,
        f.type?.startsWith('image/') && onEdit ? el('button', { class: 'btn small-btn', text: 'Edit', disabled: !!busy, onclick: () => open(f, onEdit) }) : null,
        f.type === 'application/pdf' && onWrite ? el('button', { class: 'btn small-btn', text: 'Write on it', disabled: !!busy, onclick: () => open(f, onWrite) }) : null,
        el('button', { class: 'btn small-btn ghost', text: 'Save to phone', disabled: !!busy, onclick: () => open(f, toPhone) }),
        folders ? el('button', { class: 'btn small-btn ghost', text: 'Move', 'aria-label': `Move ${f.name}`, disabled: !!busy, onclick: () => move(f) }) : null,
        el('button', { class: 'btn small-btn ghost bad-text', text: 'Delete', 'aria-label': `Delete ${f.name}`, disabled: !!busy, onclick: async () => {
          if (!confirm(`Delete "${f.name}" from your Drive? (It goes to Drive's trash for 30 days.)`)) return;
          if (await act(`Deleting "${f.name}"…`, () => api.remove(f.id))) { files = files.filter((x) => x.id !== f.id); render(`Deleted "${f.name}".`); }
        } }))))) : person ? el('p', { class: 'muted small', text: `No files of @${person} here.` }) : folderList || note === 'Loading…' ? null : el('p', { class: 'muted small', text: here ? 'This folder is empty.' : 'No files saved yet.' });
    fill(root,
      el('div', { class: 'row space' },
        el('h2', { class: 'sv-h', text: '☁️ Saved Files' }),
        el('div', { class: 'row' },
          vault && unlockedNow ? el('button', { class: 'btn small-btn ghost', text: '🔒 Lock', onclick: () => { lock(); show(); } }) : null,
          el('button', { class: 'btn small-btn ghost', text: '⟳', 'aria-label': 'Refresh', disabled: !!busy, onclick: () => show() }),
          el('a', { class: 'btn small-btn ghost', href: '#/settings/saved', text: 'Settings' }))),
      vault && !unlockedNow ? unlockForm(() => show('Unlocked until the app is closed or reloaded.')) : null,
      el('button', { type: 'button', class: 'btn block sv-favs-btn', text: `★ Favorites${favIds.size ? ` (${favIds.size})` : ''}`, onclick: openFavs }),
      el('div', { class: 'row wrap sv-tools' },
        el('button', { type: 'button', class: 'btn small-btn', text: '🔎 Scan for characters', disabled: !!busy || !files.some(scannable), onclick: () => openScanner(files, { download: (id) => api.download(id), onChange: refreshMatches, onClose: refreshMatches }) }),
        el('button', { type: 'button', class: 'btn small-btn ghost', text: '⚙ Character matches', onclick: () => openMatches().then(refreshMatches) })),
      scanNote(),
      crumbs,
      vault && !unlockedNow ? null : el('label', { class: `btn primary block${busy ? ' disabled' : ''}`, for: 'sv-file', text: `+ Save files ${here ? 'here' : 'to Drive'}${vault ? ' (encrypted)' : ''}` }), picker,
      folders ? el('button', { class: 'btn small-btn', text: '+ New folder', disabled: !!busy, onclick: newFolder }) : null,
      plain.length > 1 ? el('button', { class: 'btn small-btn', text: `🔒 Encrypt all ${plain.length} files not encrypted yet`, disabled: !!busy, onclick: () => encrypt(plain) }) : null,
      busy || note ? el('p', { class: 'small muted', 'aria-live': 'polite', text: busy || note }) : null,
      error ? el('p', { class: 'small bad-text', role: 'alert', text: error }) : null,
      folderList,
      chips,
      list,
      about('In your Google Drive, in the folder of your Saved Files spreadsheet. Each save is logged in the spreadsheet.'),
      vault && folders ? about('Folder names are kept as they are in Drive (not encrypted), so Drive can sort them; the files in them stay encrypted, names and all.') : null,
      folders ? null : el('p', { class: 'muted small', text: 'Folders: update the Saved Files script to version 3 (see Settings → Saved Files).' }));
  }

  show();
  return { show: () => { if (getConfig() && !busy && !inFavs) show(); } };
}
