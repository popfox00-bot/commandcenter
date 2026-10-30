// Files → Saved Files: the files in your own Google Drive folder (through the Apps Script in your
// "Saved Files" spreadsheet). Save files from the phone into it, open them (photos into the editor,
// PDFs to write on), save them back to the phone, or delete them. Needs a connection; the rest of
// Files works offline. Set up once on this phone with the script's URL and access key.

import { el } from '../../lib/dom.js';
import { getConfig, setConfig, checkUrl, savedFiles, size } from '../../lib/saved-files.js';
import { shareFiles, canShareFiles, downloadBlob } from '../../lib/files.js';

const icon = (type) => (type?.startsWith('image/') ? '🖼️' : type === 'application/pdf' ? '📄' : type?.startsWith('video/') ? '🎞️' : type?.startsWith('audio/') ? '🎵' : type?.startsWith('text/') ? '📝' : '📦');

export function mount(host, { onEdit = null, onWrite = null } = {}) {
  const root = el('div', { class: 'sv' });
  host.append(root);
  let api = null; let files = []; let busy = '';

  function setup(message = '') {
    const cfg = getConfig();
    const url = el('input', { type: 'url', inputmode: 'url', autocomplete: 'off', placeholder: 'https://script.google.com/macros/s/…/exec', value: cfg?.url ?? '', 'aria-label': 'Web app URL' });
    const key = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Access key from setup', value: cfg?.key ?? '', 'aria-label': 'Access key' });
    const status = el('p', { class: 'small', 'aria-live': 'polite', text: message });
    const form = el('form', { class: 'card sv-setup' },
      el('h2', { text: 'Connect Saved Files' }),
      el('p', { class: 'small', text: 'Saved Files keeps files in your own Google Drive folder, through a small script in your Saved Files spreadsheet. One-time setup:' }),
      el('ol', { class: 'small sv-steps' },
        el('li', { text: 'Open the spreadsheet → Extensions → Apps Script. Paste in the script from the app\'s repository (apps-script/saved-files.gs) and save.' }),
        el('li', { text: 'Run "setup" once and allow access. Copy the access key it shows in the log.' }),
        el('li', { text: 'Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. Copy the web app URL.' }),
        el('li', { text: 'Paste both here.' })),
      el('label', { class: 'field' }, 'Web app URL', url),
      el('label', { class: 'field' }, 'Access key', key),
      status,
      el('div', { class: 'row' }, el('button', { class: 'btn primary', text: 'Connect' }),
        cfg ? el('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onclick: () => show() }) : null),
      el('p', { class: 'muted small', text: 'The URL and key stay on this phone only. Your files stay private in your Drive.' }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = checkUrl(url.value);
      if (!u) { status.textContent = 'That isn\'t an Apps Script web app URL (it starts with https://script.google.com/ and ends in /exec).'; status.className = 'small bad-text'; return; }
      if (!key.value.trim()) { status.textContent = 'Paste the access key too.'; status.className = 'small bad-text'; return; }
      status.textContent = 'Checking…'; status.className = 'small muted';
      try {
        const folder = await savedFiles({ url: u, key: key.value.trim() }).ping();
        setConfig({ url: u, key: key.value.trim() });
        show(`Connected to "${folder}".`);
      } catch (err) { status.textContent = err.message; status.className = 'small bad-text'; }
    });
    root.replaceChildren(form);
  }

  async function show(note = '') {
    const cfg = getConfig();
    if (!cfg) { setup(); return; }
    api = savedFiles(cfg);
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

  function render(note = '', error = '') {
    const picker = el('input', { type: 'file', multiple: true, hidden: true, id: 'sv-file' });
    picker.addEventListener('change', () => { upload(picker.files); picker.value = ''; });
    const list = files.length ? el('ul', { class: 'sv-list' }, ...files.map((f) => el('li', { class: 'card sv-item' },
      el('span', { class: 'sv-icon', 'aria-hidden': 'true', text: icon(f.type) }),
      el('span', { class: 'sv-meta' }, el('strong', { class: 'sv-name', text: f.name }),
        el('span', { class: 'muted small', text: [size(f.size), new Date(f.updated).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })].filter(Boolean).join(' · ') })),
      el('span', { class: 'row wrap sv-actions' },
        el('button', { class: 'btn small-btn', text: 'Open', disabled: !!busy, onclick: () => open(f, view) }),
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
          el('button', { class: 'btn small-btn ghost', text: '⟳', 'aria-label': 'Refresh', disabled: !!busy, onclick: () => show() }),
          el('button', { class: 'btn small-btn ghost', text: 'Settings', onclick: () => setup() }))),
      el('label', { class: `btn primary block${busy ? ' disabled' : ''}`, for: 'sv-file', text: '+ Save files to Drive' }), picker,
      busy || note ? el('p', { class: 'small muted', 'aria-live': 'polite', text: busy || note }) : null,
      error ? el('p', { class: 'small bad-text', role: 'alert', text: error }) : null,
      list,
      el('p', { class: 'muted small', text: 'In your Google Drive, in the folder of your Saved Files spreadsheet. Each save is logged in the spreadsheet.' }),
      el('button', { class: 'btn small-btn ghost', text: 'Disconnect this phone', onclick: () => { if (confirm('Forget the Saved Files URL and key on this phone? (Your files stay in Drive.)')) { setConfig(null); files = []; setup(); } } }));
  }

  show();
  return { show: () => { if (getConfig() && !busy) show(); } };
}
