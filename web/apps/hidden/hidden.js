// The hidden page: reached only from a sequence of taps on the Photo Editor's switches, and behind its own
// password (web/lib/hidden-lock.js): set the first time, asked for after that. For now it says "Welcome!".

import { el } from '../../lib/dom.js';
import { hasPassword, isOpen, setPassword, tryPassword, waitLeft, lock } from '../../lib/hidden-lock.js';

export function mount(host) {
  const box = el('div', { class: 'hid' });
  host.append(box);

  function welcome() {
    box.replaceChildren(el('section', { class: 'card hid-card' },
      el('h2', { class: 'hid-welcome', text: 'Welcome!' }),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', text: '🔒 Lock', onclick: () => { lock(); ask(); location.hash = '#/'; } }))));
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
    box.replaceChildren(form);
    pw.focus();
  }

  if (isOpen()) welcome(); else ask();
  // (Come back to while still mounted, once locked: asked again, never the page as it was left.)
  const recheck = () => { if (!isOpen() && !box.querySelector('.hid-pw')) ask(); };
  window.addEventListener('hashchange', recheck);
  return () => window.removeEventListener('hashchange', recheck);
}
