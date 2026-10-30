// Files → Saved Files: the files in your own Google Drive folder (through the Apps Script in your
// "Saved Files" spreadsheet). Save files from the phone into it, open them (photos into the editor,
// PDFs to write on), save them back to the phone, or delete them. Needs a connection; the rest of
// Files works offline. Connected once in Settings → Saved Files (the script's URL and access key).
// With encryption on (Settings), files are encrypted on the phone first and unlocked once per session.
// Folders (with a version 3 script): open them, make, rename and delete them, move files between them
// (and, version 4, folders into folders). File icons are colour-coded by kind.

import { el, fill } from '../../lib/dom.js';
import { getConfig, savedFiles, secureFiles, knownHeader, isKitFile, KIT_FOLDER, fileKind, size } from '../../lib/saved-files.js';
import { unlocked, lock } from '../../lib/vault.js';
import { unlockForm } from '../../lib/vault-ui.js';
import { shareFiles, canShareFiles, downloadBlob } from '../../lib/files.js';

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

  // Connecting (the script's URL and access key) is done in Settings → Saved Files.
  function notConnected() {
    root.replaceChildren(el('div', { class: 'card sv-setup' },
      el('h2', { text: '☁️ Saved Files' }),
      el('p', { class: 'small', text: 'Keep files in your own Google Drive folder. Connect it once in Settings → Saved Files, with the web app URL and access key of the script in your Saved Files spreadsheet.' }),
      el('a', { class: 'btn primary', href: '#/settings', text: 'Open Settings' })));
  }

  async function show(note = '') {
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
    let n = 0;
    const ok = await act(`Saving ${picked.length === 1 ? `"${picked[0].name}"` : `${picked.length} files`}…`, async () => {
      for (const f of picked) { await api.upload(f, 'Files', where()); n++; }
    });
    await reload();
    render(ok ? `Saved ${n} file${n === 1 ? '' : 's'} to ${here ? `"${path.at(-1)?.name}"` : 'your Drive'}.` : '');
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
    const list = files.length ? el('ul', { class: 'sv-list' }, ...files.map((f) => el('li', { class: `card sv-item${f.locked ? ' sv-locked' : ''}` },
      icon(f),
      el('span', { class: 'sv-meta' }, el('strong', { class: 'sv-name', text: f.name }),
        el('span', { class: 'muted small', text: [f.locked ? '' : size(f.size), new Date(f.updated).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }), f.encrypted && !f.locked ? '🔒 encrypted' : isKit(f) ? 'decryption kit' : vault ? 'not encrypted' : ''].filter(Boolean).join(' · ') })),
      f.locked ? null : el('span', { class: 'row wrap sv-actions' },
        el('button', { class: 'btn small-btn', text: 'Open', disabled: !!busy, onclick: () => open(f, view) }),
        vault && unlockedNow && !f.encrypted && !isKit(f) ? el('button', { class: 'btn small-btn', text: '🔒 Encrypt', 'aria-label': `Encrypt ${f.name}`, disabled: !!busy, onclick: () => encrypt([f]) }) : null,
        f.type?.startsWith('image/') && onEdit ? el('button', { class: 'btn small-btn', text: 'Edit', disabled: !!busy, onclick: () => open(f, onEdit) }) : null,
        f.type === 'application/pdf' && onWrite ? el('button', { class: 'btn small-btn', text: 'Write on it', disabled: !!busy, onclick: () => open(f, onWrite) }) : null,
        el('button', { class: 'btn small-btn ghost', text: 'Save to phone', disabled: !!busy, onclick: () => open(f, toPhone) }),
        folders ? el('button', { class: 'btn small-btn ghost', text: 'Move', 'aria-label': `Move ${f.name}`, disabled: !!busy, onclick: () => move(f) }) : null,
        el('button', { class: 'btn small-btn ghost bad-text', text: 'Delete', 'aria-label': `Delete ${f.name}`, disabled: !!busy, onclick: async () => {
          if (!confirm(`Delete "${f.name}" from your Drive? (It goes to Drive's trash for 30 days.)`)) return;
          if (await act(`Deleting "${f.name}"…`, () => api.remove(f.id))) { files = files.filter((x) => x.id !== f.id); render(`Deleted "${f.name}".`); }
        } }))))) : folderList || note === 'Loading…' ? null : el('p', { class: 'muted small', text: here ? 'This folder is empty.' : 'No files saved yet.' });
    fill(root,
      el('div', { class: 'row space' },
        el('h2', { class: 'sv-h', text: '☁️ Saved Files' }),
        el('div', { class: 'row' },
          vault && unlockedNow ? el('button', { class: 'btn small-btn ghost', text: '🔒 Lock', onclick: () => { lock(); show(); } }) : null,
          el('button', { class: 'btn small-btn ghost', text: '⟳', 'aria-label': 'Refresh', disabled: !!busy, onclick: () => show() }),
          el('a', { class: 'btn small-btn ghost', href: '#/settings', text: 'Settings' }))),
      vault && !unlockedNow ? unlockForm(() => show('Unlocked until the app is closed or reloaded.')) : null,
      crumbs,
      vault && !unlockedNow ? null : el('label', { class: `btn primary block${busy ? ' disabled' : ''}`, for: 'sv-file', text: `+ Save files ${here ? 'here' : 'to Drive'}${vault ? ' (encrypted)' : ''}` }), picker,
      folders ? el('button', { class: 'btn small-btn', text: '+ New folder', disabled: !!busy, onclick: newFolder }) : null,
      plain.length > 1 ? el('button', { class: 'btn small-btn', text: `🔒 Encrypt all ${plain.length} files not encrypted yet`, disabled: !!busy, onclick: () => encrypt(plain) }) : null,
      busy || note ? el('p', { class: 'small muted', 'aria-live': 'polite', text: busy || note }) : null,
      error ? el('p', { class: 'small bad-text', role: 'alert', text: error }) : null,
      folderList,
      list,
      el('p', { class: 'muted small', text: 'In your Google Drive, in the folder of your Saved Files spreadsheet. Each save is logged in the spreadsheet.' }),
      vault && folders ? el('p', { class: 'muted small', text: 'Folder names are kept as they are in Drive (not encrypted), so Drive can sort them; the files in them stay encrypted, names and all.' }) : null,
      folders ? null : el('p', { class: 'muted small', text: 'Folders: update the Saved Files script to version 3 (see Settings → Saved Files).' }));
  }

  show();
  return { show: () => { if (getConfig() && !busy) show(); } };
}
