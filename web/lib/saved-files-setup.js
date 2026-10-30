// The Saved Files connection, shown in Settings: the web app URL and access key of the Apps Script in
// your Saved Files spreadsheet (apps-script/saved-files.gs), checked before they're kept (on this
// phone only), and Disconnect; encryption (web/lib/vault-ui.js); opening an encrypted file anywhere.

import { el } from './dom.js';
import { getConfig, setConfig, checkUrl, savedFiles, connectedSecure } from './saved-files.js';
import { encryptionSettings, openAnywhere } from './vault-ui.js';

export function savedFilesSettings() {
  const box = el('section', { class: 'card sv-setup', id: 'saved-files' });

  function render(message = '', bad = false) {
    const cfg = getConfig();
    const url = el('input', { type: 'url', inputmode: 'url', autocomplete: 'off', placeholder: 'https://script.google.com/macros/s/…/exec', value: cfg?.url ?? '', 'aria-label': 'Web app URL' });
    const key = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Access key from setup', value: cfg?.key ?? '', 'aria-label': 'Access key' });
    const status = el('p', { class: `small${bad ? ' bad-text' : ''}`, 'aria-live': 'polite', text: message || (cfg ? `Connected (${new URL(cfg.url).pathname.split('/')[3]?.slice(0, 8) ?? ''}…).` : 'Not connected.') });
    const form = el('form', { class: 'sv-form' },
      el('label', { class: 'field' }, 'Web app URL', url),
      el('label', { class: 'field' }, 'Access key', key),
      status,
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn primary', text: cfg ? 'Save and check' : 'Connect' }),
        cfg ? el('button', { type: 'button', class: 'btn ghost', text: 'Disconnect this phone', onclick: () => { if (confirm('Forget the Saved Files URL and key on this phone? (Your files stay in Drive.)')) { setConfig(null); render('Disconnected. Your files are still in Drive.'); } } }) : null));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = checkUrl(url.value);
      if (!u) { render('That isn\'t an Apps Script web app URL (it starts with https://script.google.com/ and ends in /exec).', true); return; }
      if (!key.value.trim()) { render('Paste the access key too.', true); return; }
      status.textContent = 'Checking…'; status.className = 'small muted';
      try {
        const folder = await savedFiles({ url: u, key: key.value.trim() }).ping();
        setConfig({ url: u, key: key.value.trim() });
        await connectedSecure().refresh().catch(() => {}); // is encryption already on (another device)?
        render(`Connected to "${folder}". Files → Saved Files is ready.`);
      } catch (err) { status.textContent = err.message; status.className = 'small bad-text'; }
    });
    box.replaceChildren(
      el('h2', { text: '☁️ Saved Files (Google Drive)' }),
      el('p', { class: 'small muted', text: 'Files → Saved Files keeps files in your own Google Drive folder, through a small script in your Saved Files spreadsheet. The URL and key stay on this phone only.' }),
      cfg ? null : el('details', { class: 'small' }, el('summary', { text: 'How to set it up (once)' }),
        el('ol', { class: 'sv-steps' },
          el('li', { text: 'Open the spreadsheet → Extensions → Apps Script. Paste in apps-script/saved-files.gs from the app\'s repository and save.' }),
          el('li', { text: 'Run "setup" once and allow access. Copy the access key it shows in the log.' }),
          el('li', { text: 'Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. Copy the web app URL.' }),
          el('li', { text: 'Paste both here.' }))),
      form,
      cfg ? encryptionSettings() : null,
      openAnywhere());
  }
  render();
  return box;
}
