// Saved Files encryption, on screen: unlocking for this session, turning encryption on (with the
// recovery key shown once), changing the password, a new recovery key, and opening a downloaded
// encrypted file with the password or recovery key in any browser. See web/lib/vault.js.

import { el } from './dom.js';
import { createVault, unlock, changePassword, newRecovery, openWithSecret, unlocked, setSession, lock, strength } from './vault.js';
import { knownHeader, connectedSecure, connected, saveDecryptionKit } from './saved-files.js';
import { shareFiles, canShareFiles, downloadBlob } from './files.js';

/** A password box with Unlock; onUnlocked() once this session holds the key. */
export function unlockForm(onUnlocked, { label = 'Saved Files are encrypted. Enter your password (or recovery key) to open them on this phone until the app is closed or reloaded.' } = {}) {
  const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password or recovery key', 'aria-label': 'Saved Files password' });
  const status = el('p', { class: 'small', 'aria-live': 'polite' });
  const form = el('form', { class: 'card vault-unlock' },
    el('strong', { text: '🔒 Locked' }), el('p', { class: 'small muted', text: label }),
    pw, status, el('button', { class: 'btn primary', text: 'Unlock' }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const header = knownHeader();
    if (!header || !pw.value) return;
    status.className = 'small muted'; status.textContent = 'Unlocking…';
    try {
      setSession({ key: await unlock(header, pw.value), header });
      pw.value = '';
      onUnlocked();
    } catch (err) { status.className = 'small bad-text'; status.textContent = err.message; }
  });
  return form;
}

/** A dialog that shows a new recovery key once, and only closes when you say you've kept it. */
function showRecovery(recoveryKey, intro) {
  return new Promise((resolve) => {
    const saved = el('input', { type: 'checkbox', id: 'vault-saved' });
    const done = el('button', { class: 'btn primary', text: 'Done', disabled: true, onclick: () => dlg.close() });
    saved.addEventListener('change', () => { done.disabled = !saved.checked; });
    const copy = el('button', { class: 'btn', text: 'Copy', onclick: async () => { try { await navigator.clipboard.writeText(recoveryKey); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select it and copy'; } } });
    const dlg = el('dialog', { class: 'ed-dialog' }, el('div', { class: 'sheet vault-recovery' },
      el('h2', { text: 'Your recovery key' }),
      el('p', { class: 'small', text: intro }),
      el('code', { class: 'vault-key', text: recoveryKey }),
      el('div', { class: 'row' }, copy),
      el('p', { class: 'small', text: 'Keep it somewhere safe and private: a password manager, or written down at home. It opens all your Saved Files even if you forget your password. Without the password and this key, the files can\'t be opened by anyone, including you.' }),
      el('label', { class: 'cal-check', for: 'vault-saved' }, saved, 'I\'ve saved my recovery key'),
      el('div', { class: 'row end' }, done)));
    dlg.addEventListener('cancel', (e) => { if (!saved.checked) e.preventDefault(); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

const pwPair = (labelA = 'New password', labelB = 'The same again') => {
  const a = el('input', { type: 'password', autocomplete: 'new-password', placeholder: labelA, 'aria-label': labelA });
  const b = el('input', { type: 'password', autocomplete: 'new-password', placeholder: labelB, 'aria-label': labelB });
  const hint = el('p', { class: 'small muted', 'aria-live': 'polite', text: strength('').hint });
  a.addEventListener('input', () => { const s = strength(a.value); hint.textContent = s.hint; hint.className = `small ${s.level === 'weak' ? 'warn-text' : s.level === 'strong' ? 'ok-text' : 'muted'}`; });
  return { a, b, hint, check: () => (strength(a.value).level === 'weak' ? 'Choose a longer password (12 characters or more; a few random words is best).' : a.value !== b.value ? 'The two passwords aren\'t the same.' : '') };
};

/** Settings → Saved Files → Encryption. */
export function encryptionSettings() {
  const box = el('div', { class: 'vault-settings' });
  function render(message = '', bad = false) {
    const header = knownHeader(); const api = connectedSecure();
    const status = el('p', { class: `small${bad ? ' bad-text' : ''}`, 'aria-live': 'polite', text: message });
    if (!api) { box.replaceChildren(); return; }
    if (!header) {
      const { a, b, hint, check } = pwPair('Choose a password', 'The same again');
      const form = el('form', { class: 'sv-form' },
        el('p', { class: 'small muted', text: 'Encrypt files on this phone before they go to Drive: Google, the script and the spreadsheet only see scrambled data and names. You enter the password once each time you open the app.' }),
        a, b, hint, status,
        el('button', { class: 'btn primary', text: '🔒 Turn on encryption' }));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const problem = check(); if (problem) { render(problem, true); return; }
        status.className = 'small muted'; status.textContent = 'Making your keys…';
        try {
          await api.refresh();
          if (knownHeader()) { render('Encryption was already turned on (from another device): unlock with that password.', true); return; }
          const { header: h, key, recoveryKey } = await createVault(a.value);
          await api.saveHeader(h);
          setSession({ key, header: h });
          await showRecovery(recoveryKey, 'Encryption is on. New files you save are encrypted on this phone first. This is your recovery key, shown only now:');
          let kit = '';
          try { kit = ` The decryption kit (to open files without this app) is in ${(await saveDecryptionKit(connected())).where}.`; } catch (err) { kit = ` (The decryption kit couldn't be saved to Drive: ${err.message} Use "Save decryption kit" below.)`; }
          render(`Encryption is on, and unlocked until the app is closed or reloaded.${kit}`);
        } catch (err) { render(err.message, true); }
      });
      box.replaceChildren(el('h3', { text: '🔒 Encryption' }), form);
      return;
    }
    const s = unlocked();
    const kids = [el('h3', { text: '🔒 Encryption: on' }),
      el('p', { class: 'small', text: s ? '🔓 Unlocked on this phone until the app is closed or reloaded.' : '🔒 Locked.' })];
    if (!s) kids.push(unlockForm(() => render('Unlocked.'), { label: 'Enter your password (or recovery key) to use Saved Files until the app is closed or reloaded.' }));
    else kids.push(el('button', { class: 'btn small-btn', text: 'Lock now', onclick: () => { lock(); render('Locked.'); } }));
    // Change the password.
    const cur = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Current password or recovery key', 'aria-label': 'Current password or recovery key' });
    const { a, b, hint, check } = pwPair();
    const change = el('form', { class: 'sv-form' }, cur, a, b, hint, el('button', { class: 'btn', text: 'Change password' }));
    change.addEventListener('submit', async (e) => {
      e.preventDefault();
      const problem = check(); if (problem) { render(problem, true); return; }
      try { const h = await changePassword(knownHeader(), cur.value, a.value); await api.saveHeader(h); setSession({ key: await unlock(h, a.value), header: h }); render('Password changed. Your files are the same; use the new password from now on.'); } catch (err) { render(err.message, true); }
    });
    // A new recovery key.
    const cur2 = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Your password', 'aria-label': 'Password for a new recovery key' });
    const rec = el('form', { class: 'sv-form' }, cur2, el('button', { class: 'btn', text: 'Make a new recovery key' }));
    rec.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const { header: h, recoveryKey } = await newRecovery(knownHeader(), cur2.value); await api.saveHeader(h); await showRecovery(recoveryKey, 'Your new recovery key (the old one no longer unlocks Saved Files here, though it still opens files saved before today on their own):'); render('New recovery key made.'); } catch (err) { render(err.message, true); }
    });
    const kitBtn = el('button', { class: 'btn small-btn', text: '💾 Save decryption kit to Drive', onclick: async () => {
      kitBtn.disabled = true;
      try { render(`Decryption kit saved in ${(await saveDecryptionKit(connected())).where}: decrypt.html (any browser), decrypt.py (Python) and FORMAT.md (how the files work).`); } catch (err) { render(err.message, true); }
    } });
    kids.push(status,
      el('p', { class: 'small muted', text: 'Decryption kit: a page, a Python script and a description of the format, to open your files without this app (with the password or recovery key). Saved to a "Decryption" folder in Drive when you turn encryption on.' }),
      kitBtn,
      el('details', { class: 'small' }, el('summary', { text: 'Change password' }), change),
      el('details', { class: 'small' }, el('summary', { text: 'New recovery key' }), rec));
    box.replaceChildren(...kids);
  }
  render();
  return box;
}

/** Open a downloaded encrypted file (from Drive) with the password or recovery key: works in any browser. */
export function openAnywhere() {
  const file = el('input', { type: 'file', 'aria-label': 'Encrypted file' });
  const pw = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Password or recovery key', 'aria-label': 'Password or recovery key for the file' });
  const status = el('p', { class: 'small', 'aria-live': 'polite' });
  const result = el('div', { class: 'row wrap' });
  const form = el('form', { class: 'sv-form' },
    el('p', { class: 'small muted', text: 'Downloaded a "ccv." file from Drive? Open it here with your password or recovery key: on any device, in any browser, nothing uploaded.' }),
    file, pw, status, el('button', { class: 'btn', text: 'Open file' }), result);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    result.replaceChildren();
    if (!file.files[0] || !pw.value) { status.className = 'small bad-text'; status.textContent = 'Pick the file and enter the password or recovery key.'; return; }
    status.className = 'small muted'; status.textContent = 'Opening…';
    try {
      const out = await openWithSecret(file.files[0], pw.value);
      status.className = 'small ok-text'; status.textContent = `Opened "${out.name}".`;
      result.append(el('button', { type: 'button', class: 'btn primary', text: canShareFiles([out]) ? 'Share or save' : 'Save', onclick: () => { if (canShareFiles([out])) shareFiles([out], out.name).catch(() => {}); else downloadBlob(out, out.name); } }));
    } catch (err) { status.className = 'small bad-text'; status.textContent = err.message; }
  });
  return el('details', { class: 'small' }, el('summary', { text: 'Open an encrypted file' }), form);
}
