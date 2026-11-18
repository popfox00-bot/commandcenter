// "Update to Latest Version" (Settings, and the version history on the home screen): checks for a new
// version now and, if there is one, installs it and reloads; nothing kept on the phone is lost.

import { VERSION } from '../version.js';

/** Check now; `say(text)` is told how it goes. Resolves when it's done (or reloading). */
export async function updateToLatest(say) {
  say('Checking for a new version…');
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (!reg) { say('Reloading…'); location.reload(); return; }
    const apply = (worker) => {
      say('Updating…');
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      worker.postMessage('skip-waiting');
      // (If it doesn't take over within a few seconds, reload anyway.)
      setTimeout(() => location.reload(), 4000);
    };
    await reg.update();
    if (reg.waiting) { apply(reg.waiting); return; }
    if (reg.installing) {
      say('Downloading the new version…');
      const next = reg.installing;
      next.addEventListener('statechange', () => { if (next.state === 'installed' && reg.waiting) apply(reg.waiting); });
      return;
    }
    say(`You're on the latest version (v${VERSION}).`);
  } catch (e) {
    say(navigator.onLine === false ? 'No connection: connect to the internet and try again.' : `Couldn't check for a new version: ${e.message}`);
  }
}
