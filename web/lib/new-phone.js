// Settings → Saved Files → 📲 Set up this phone from your Drive: on a new phone (once Saved Files is connected
// with its URL and key), everything that's kept in your Drive brought back in one go, with your password:
// Saved Files' encryption unlocked, Socials joined (the same password set here; its posts come down when it's
// opened), the newest backup of the extras restored (favorites, matches, backgrounds, the Dock, settings), and
// the Vault given the same password (if you like). Each part says how it went; a part whose password is
// another asks for that one. Nothing is sent anywhere but your own Drive.

import { el, fill } from './dom.js';
import { getConfig, savedFiles, connectedSecure, knownHeader } from './saved-files.js';
import { unlock, unlocked, setSession } from './vault.js';

const STEPS = [
  { id: 'files', name: '🔒 Saved Files encryption' },
  { id: 'socials', name: '📸 Socials' },
  { id: 'extras', name: '★ Extras (favorites, matches, backgrounds, Dock, settings)' },
  { id: 'vault', name: '🔐 Vault' },
];

/**
 * One part brought back with `password`: { state: 'done' | 'wrong' | 'none' | 'skip', text }. 'wrong': that
 * password doesn't open it (another may); 'none': nothing of it in Drive; 'skip': already here.
 */
export async function restoreStep(id, password, { vault = true } = {}) {
  const cfg = getConfig(); if (!cfg) return { state: 'wrong', text: 'Connect Saved Files first (above).' };
  if (id === 'files') {
    const sec = connectedSecure(); await sec?.refresh?.().catch(() => {});
    const header = knownHeader(); if (!header) return { state: 'none', text: 'Not encrypted: nothing to unlock.' };
    if (unlocked()) return { state: 'skip', text: 'Unlocked already.' };
    try { setSession({ key: await unlock(header, password), header }); return { state: 'done', text: 'Unlocked (until the app is closed).' }; } catch { return { state: 'wrong', text: 'That password doesn\'t unlock your Saved Files.' }; }
  }
  if (id === 'socials') {
    const { makeLock } = await import('./hidden-lock.js'); const lock = makeLock('cc.socials.lock', 'cc.socials.open');
    if (lock.hasPassword()) return { state: 'skip', text: 'Already set up on this phone.' };
    const { remoteHeader, opens } = await import('../apps/socials/socials-sync.js');
    const header = await remoteHeader(savedFiles(cfg)).catch(() => null); if (!header) return { state: 'none', text: 'No Socials in your Drive.' };
    if (!(await opens(header, password))) return { state: 'wrong', text: 'That password doesn\'t open your Socials.' };
    const S = await import('../apps/socials/socials-store.js');
    await lock.setPassword(password); if (!(await S.unlockData(password))) await S.resetData(password);
    return { state: 'done', text: 'Joined: open Socials and its accounts and posts come down from your Drive.' };
  }
  if (id === 'extras') {
    const X = await import('./extras-backup.js'); const api = savedFiles(cfg);
    const f = await X.newestInDrive(api).catch(() => null); if (!f) return { state: 'none', text: 'No backup of the extras in your Drive.' };
    let data; try { data = await X.open(await api.download(f.id), password); } catch (e) { return /password/.test(e.message) ? { state: 'wrong', text: 'That password doesn\'t open the backup.' } : { state: 'wrong', text: e.message }; }
    return { state: 'done', text: `Restored ${await X.restore(data)} things from ${f.name}.` };
  }
  if (id === 'vault') {
    const H = await import('./hidden-lock.js');
    if (H.hasPassword()) return { state: 'skip', text: 'Has its password on this phone already.' };
    if (!vault) return { state: 'skip', text: 'Left for you to set (Files ⚙ → Admin).' };
    try { await H.setPassword(password); return { state: 'done', text: 'Its password set: the same one (its files are in Saved Files).' }; } catch (e) { return { state: 'wrong', text: e.message }; }
  }
  return { state: 'none', text: '' };
}

/** The card: one password, Set up this phone, each part's result (another password for any that needs it). */
export function newPhoneCard() {
  const pw = el('input', { type: 'password', class: 'xb-pw', autocomplete: 'current-password', 'aria-label': 'Your password', placeholder: 'Your password' });
  const vault = el('input', { type: 'checkbox', checked: true });
  const list = el('ul', { class: 'np-steps', 'aria-live': 'polite' });
  const go = el('button', { type: 'button', class: 'btn primary', text: '📲 Set up this phone' });
  const row = (s, r) => {
    const li = el('li', { class: `np-step np-${r?.state ?? 'wait'}` }, el('span', { class: 'np-mark', 'aria-hidden': 'true', text: !r ? '…' : r.state === 'done' ? '✓' : r.state === 'wrong' ? '✕' : r.state === 'skip' ? '✓' : '–' }),
      el('span', { class: 'np-text' }, el('strong', { text: s.name }), el('span', { class: 'small muted', text: r?.text ?? 'Waiting…' })));
    if (r?.state === 'wrong') {
      const other = el('input', { type: 'password', class: 'xb-pw', 'aria-label': `Password for ${s.name}`, placeholder: 'Its own password' });
      const again = el('button', { type: 'button', class: 'btn small-btn', text: 'Try', onclick: async () => { again.disabled = true; li.replaceWith(row(s, await restoreStep(s.id, other.value, { vault: vault.checked }))); } });
      li.append(el('span', { class: 'row np-again' }, other, again));
    }
    return li;
  };
  go.addEventListener('click', async () => {
    if (!pw.value) { pw.focus(); return; }
    go.disabled = true; fill(list, STEPS.map((s) => row(s, null)));
    for (const [i, s] of STEPS.entries()) { let r; try { r = await restoreStep(s.id, pw.value, { vault: vault.checked }); } catch (e) { r = { state: 'wrong', text: e.message }; } list.children[i].replaceWith(row(s, r)); }
    go.disabled = false;
  });
  return el('details', { class: 'small xb np' }, el('summary', { text: '📲 Setting up a new phone? Bring everything back from your Drive' }),
    el('p', { class: 'small muted', text: 'Once Saved Files is connected (above), your password unlocks Saved Files\' encryption, joins Socials, restores the newest backup of the extras and gives the Vault the same password. A part with a different password asks for it.' }),
    pw, el('label', { class: 'small' }, vault, ' Use it for the Vault on this phone too'), go, list);
}
