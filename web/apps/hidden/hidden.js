// The hidden page: reached only from a sequence of taps on the Photo Editor's switches, and behind its own
// password (web/lib/hidden-lock.js): set the first time, asked for after that. It says "Welcome!" and holds
// its apps: Magic (Downloads, FM, Reverse Fill, Fashion) and Saved Files, opened only once it's unlocked.

import { el } from '../../lib/dom.js';
import { childrenOf } from '../index.js';
import { renderHub } from '../hub.js';
import { hasPassword, isOpen, setPassword, tryPassword, waitLeft, lock, openWithPasskey } from '../../lib/hidden-lock.js';
import { passkeysSupported, deviceCanPasskey, hasPasskey, createPasskey, usePasskey, removePasskey } from '../../lib/passkey.js';

export function mount(host) {
  const box = el('div', { class: 'hid' });
  host.append(box);

  function welcome() {
    // (Opened on the way to one of its apps: on to it.)
    let next = null; try { next = sessionStorage.getItem('cc.hidden.next'); sessionStorage.removeItem('cc.hidden.next'); } catch { next = null; }
    if (next && next !== '#/hidden') { location.replace(next); return; }
    const apps = el('div', { class: 'hid-apps' });
    renderHub(apps, childrenOf('hidden'));
    box.replaceChildren(el('section', { class: 'card hid-card' },
      el('h2', { class: 'hid-welcome', text: 'Welcome!' }),
      apps,
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', text: '🔒 Lock', onclick: () => { lock(); ask(); location.hash = '#/'; } })),
      faceIdSetting()));
  }

  // (Face ID (a passkey) to open it, as well as the password: set up or turned off here, once it's open.)
  function faceIdSetting() {
    const box = el('div', { class: 'hid-faceid' });
    const drawIt = async () => {
      if (!passkeysSupported()) { box.replaceChildren(); return; }
      const on = hasPasskey('hidden'); const note = el('p', { class: 'small muted', 'aria-live': 'polite' });
      box.replaceChildren(el('p', { class: 'small' }, el('strong', { text: 'Face ID ' }), on ? 'is on: it opens this area as well as your password.' : 'can open this area as well as your password (a passkey, kept in your phone\'s passwords).'),
        el('button', { type: 'button', class: 'btn', text: on ? 'Turn off Face ID' : 'Set up Face ID', onclick: async () => {
          if (on) { removePasskey('hidden'); drawIt(); return; }
          try { await createPasskey('hidden', 'Hidden area'); drawIt(); } catch (e) { note.textContent = e?.name === 'NotAllowedError' ? 'Cancelled.' : e.message; }
        } }), note);
      if (!on && !(await deviceCanPasskey())) note.textContent = 'This device may not have Face ID or a fingerprint for passkeys.';
    };
    drawIt(); return box;
  }

  function ask() {
    const first = !hasPassword();
    const pw = el('input', { type: 'password', class: 'hid-pw', autocomplete: first ? 'new-password' : 'current-password', 'aria-label': first ? 'New password' : 'Password' });
    const again = first ? el('input', { type: 'password', class: 'hid-pw', autocomplete: 'new-password', 'aria-label': 'The same again' }) : null;
    const note = el('p', { class: 'small muted', 'aria-live': 'polite', text: first ? 'Set a password for this area. It\'s kept only on this phone, as a hash.' : '' });
    const go = el('button', { type: 'submit', class: 'btn primary block', text: first ? 'Set password' : 'Open' });
    const form = el('form', { class: 'card hid-card', onsubmit: async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        if (first) {
          if (pw.value !== again.value) { note.textContent = 'The two don\'t match.'; return; }
          await setPassword(pw.value); welcome(); return;
        }
        const wait = waitLeft(); if (wait) { note.textContent = `Too many tries: wait ${wait} s.`; return; }
        if (await tryPassword(pw.value)) { welcome(); return; }
        pw.value = ''; const w = waitLeft();
        note.textContent = w ? `Too many tries: wait ${w} s.` : 'That isn\'t it.';
        form.classList.remove('hid-shake'); void form.offsetWidth; form.classList.add('hid-shake');
      } catch (err) { note.textContent = err.message; } finally { go.disabled = false; pw.focus(); }
    } },
      el('h2', { text: first ? 'Set a password' : 'Password' }),
      pw, again, note, go);
    // (Face ID, when it's set up: as well as the password.)
    if (!first && hasPasskey('hidden')) {
      form.append(el('button', { type: 'button', class: 'btn block hid-faceid-btn', text: '🔓 Use Face ID', onclick: async () => {
        const r = await usePasskey('hidden');
        if (r.ok) { openWithPasskey(); welcome(); } else note.textContent = r.reason;
      } }));
    }
    box.replaceChildren(form);
    pw.focus();
  }

  if (isOpen()) welcome(); else ask();
  // (Come back to while still mounted, once locked: asked again, never the page as it was left.)
  const recheck = () => { if (!isOpen() && !box.querySelector('.hid-pw')) ask(); };
  window.addEventListener('hashchange', recheck);
  return () => window.removeEventListener('hashchange', recheck);
}
