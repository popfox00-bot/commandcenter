// Files → Saved Files: the files in your own Google Drive folder (through the Apps Script in your
// "Saved Files" spreadsheet). Save files from the phone into it, open them (photos into the editor,
// PDFs to write on), save them back to the phone, or delete them. Needs a connection; the rest of
// Files works offline. Connected once in Settings → Saved Files (the script's URL and access key).
// With encryption on (Settings), files are encrypted on the phone first and unlocked once per session.

import { el } from '../../lib/dom.js';
import { getConfig, savedFiles, secureFiles, knownHeader, size } from '../../lib/saved-files.js';
import { unlocked, lock } from '../../lib/vault.js';
import { unlockForm } from '../../lib/vault-ui.js';
import { shareFiles, canShareFiles, downloadBlob } from '../../lib/files.js';

const icon = (type) => (type?.startsWith('image/') ? '🖼️' : type === 'application/pdf' ? '📄' : type?.startsWith('video/') ? '🎞️' : type?.startsWith('audio/') ? '🎵' : type?.startsWith('text/') ? '📝' : '📦');

export function mount(host, { onEdit = null, onWrite = null } = {}) {
  const root = el('div', { class: 'sv' });
  host.append(root);
  let api = null; let files = []; let busy = '';

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
    try { files = await api.list(); render(note); } catch (err) { render('', err.message); }
  }

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
      for (const f of picked) { await api.upload(f, 'Files'); n++; }
    });
    files = await api.list().catch(() => files);
    render(ok ? `Saved ${n} file${n === 1 ? '' : 's'} to your Drive.` : '');
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
    const ok = await act(`Encrypting ${list.length === 1 ? `"${list[0].name}"` : `${list.length} files`}…`, async () => { for (const f of list) { await api.encryptExisting(f); n++; } });
    files = await api.list().catch(() => files);
    render(ok ? `Encrypted ${n} file${n === 1 ? '' : 's'} (the plain copies are in Drive's trash for 30 days).` : '');
  }

  function render(note = '', error = '') {
    const picker = el('input', { type: 'file', multiple: true, hidden: true, id: 'sv-file' });
    picker.addEventListener('change', () => { upload(picker.files); picker.value = ''; });
    const vault = knownHeader(); const unlockedNow = !!unlocked();
    const plain = vault && unlockedNow ? files.filter((f) => !f.encrypted) : [];
    const list = files.length ? el('ul', { class: 'sv-list' }, ...files.map((f) => el('li', { class: `card sv-item${f.locked ? ' sv-locked' : ''}` },
      el('span', { class: 'sv-icon', 'aria-hidden': 'true', text: f.locked ? '🔒' : icon(f.type) }),
      el('span', { class: 'sv-meta' }, el('strong', { class: 'sv-name', text: f.name }),
        el('span', { class: 'muted small', text: [f.locked ? '' : size(f.size), new Date(f.updated).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }), f.encrypted && !f.locked ? '🔒 encrypted' : vault ? 'not encrypted' : ''].filter(Boolean).join(' · ') })),
      f.locked ? null : el('span', { class: 'row wrap sv-actions' },
        el('button', { class: 'btn small-btn', text: 'Open', disabled: !!busy, onclick: () => open(f, view) }),
        vault && unlockedNow && !f.encrypted ? el('button', { class: 'btn small-btn', text: '🔒 Encrypt', 'aria-label': `Encrypt ${f.name}`, disabled: !!busy, onclick: () => encrypt([f]) }) : null,
        f.type?.startsWith('image/') && onEdit ? el('button', { class: 'btn small-btn', text: 'Edit', disabled: !!busy, onclick: () => open(f, onEdit) }) : null,
        f.type === 'application/pdf' && onWrite ? el('button', { class: 'btn small-btn', text: 'Write on it', disabled: !!busy, onclick: () => open(f, onWrite) }) : null,
        el('button', { class: 'btn small-btn ghost', text: 'Save to phone', disabled: !!busy, onclick: () => open(f, toPhone) }),
        el('button', { class: 'btn small-btn ghost bad-text', text: 'Delete', 'aria-label': `Delete ${f.name}`, disabled: !!busy, onclick: async () => {
          if (!confirm(`Delete "${f.name}" from your Drive? (It goes to Drive's trash for 30 days.)`)) return;
          if (await act(`Deleting "${f.name}"…`, () => api.remove(f.id))) { files = files.filter((x) => x.id !== f.id); render(`Deleted "${f.name}".`); }
        } }))))) : el('p', { class: 'muted small', text: note === 'Loading…' ? '' : 'No files saved yet.' });
    root.replaceChildren(
      el('div', { class: 'row space' },
        el('h2', { class: 'sv-h', text: '☁️ Saved Files' }),
        el('div', { class: 'row' },
          vault && unlockedNow ? el('button', { class: 'btn small-btn ghost', text: '🔒 Lock', onclick: () => { lock(); show(); } }) : null,
          el('button', { class: 'btn small-btn ghost', text: '⟳', 'aria-label': 'Refresh', disabled: !!busy, onclick: () => show() }),
          el('a', { class: 'btn small-btn ghost', href: '#/settings', text: 'Settings' }))),
      vault && !unlockedNow ? unlockForm(() => show('Unlocked until the app is closed or reloaded.')) : null,
      vault && !unlockedNow ? null : el('label', { class: `btn primary block${busy ? ' disabled' : ''}`, for: 'sv-file', text: vault ? '+ Save files to Drive (encrypted)' : '+ Save files to Drive' }), picker,
      plain.length > 1 ? el('button', { class: 'btn small-btn', text: `🔒 Encrypt all ${plain.length} files not encrypted yet`, disabled: !!busy, onclick: () => encrypt(plain) }) : null,
      busy || note ? el('p', { class: 'small muted', 'aria-live': 'polite', text: busy || note }) : null,
      error ? el('p', { class: 'small bad-text', role: 'alert', text: error }) : null,
      list,
      el('p', { class: 'muted small', text: 'In your Google Drive, in the folder of your Saved Files spreadsheet. Each save is logged in the spreadsheet.' }));
  }

  show();
  return { show: () => { if (getConfig() && !busy) show(); } };
}
