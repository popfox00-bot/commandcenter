// Command Center PWA shell: home screen of apps, hash routing, service worker updates.
// No build step; every module is plain ES modules served from this folder.

import { $, el, store } from './lib/dom.js';
import { APPS, redirect } from './apps/index.js';
import { setJobsActive } from './jobs.js';

const views = { home: $('#view-home'), app: $('#view-app'), jobs: $('#view-jobs') };
let mountedApp = null;

function renderHome() {
  $('#app-grid').replaceChildren(...APPS.map((a) => el('a', { class: 'app-tile', href: a.href },
    el('span', { class: `app-icon tint-${a.tint}`, 'aria-hidden': 'true', text: a.icon }),
    el('span', { class: 'app-name', text: a.name }),
    el('span', { class: 'app-note muted', text: a.note }))));
}

async function route() {
  const moved = redirect(location.hash);
  if (moved) { location.replace(moved); return; }
  const [, section = ''] = (location.hash || '#/').split('/');
  const app = APPS.find((a) => a.id === section && a.load);
  const view = section === 'jobs' ? 'jobs' : app ? 'app' : 'home';
  for (const [name, node] of Object.entries(views)) node.hidden = name !== view;
  $('#title').textContent = { home: 'Command Center', jobs: 'Jobs', app: app?.name }[view];
  $('#jobs-actions').hidden = view !== 'jobs';
  setJobsActive(view === 'jobs');

  if (mountedApp && (view !== 'app' || mountedApp.id !== app.id)) {
    mountedApp.unmount?.();
    mountedApp = null;
  }
  if (view === 'app' && !mountedApp) mountedApp = await mountInto($('#app-host'), app, app.id);
  if (view !== 'app') document.title = view === 'home' ? 'Command Center' : `${$('#title').textContent} · Command Center`;
  window.scrollTo(0, 0);
}

/** Load a tool/app module and mount it; returns { id, unmount } (unmount may be null). */
async function mountInto(host, entry, id) {
  host.replaceChildren(el('p', { class: 'muted center', text: 'Loading…' }));
  document.title = `${entry.name} · Command Center`;
  try {
    const mod = await entry.load();
    host.replaceChildren();
    const unmount = mod.mount(host);
    return { id, unmount: typeof unmount === 'function' ? unmount : null };
  } catch (err) {
    host.replaceChildren(el('p', { class: 'bad-text', text: `Could not load ${entry.name}: ${err.message}` }));
    return { id, unmount: null };
  }
}

renderHome();
window.addEventListener('hashchange', route);
route();

// Service worker: offline support and updates. A new version installs in the background and then
// waits. If it is ready before the user has touched anything (i.e. right after opening the app), it
// is applied at once; otherwise a "tap to reload" bar appears, so nobody loses work mid-task.
if ('serviceWorker' in navigator) {
  let interacted = false;
  let reloading = false;
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { interacted = true; }, { once: true, capture: true });

  const apply = (worker) => { reloading = true; worker.postMessage('skip-waiting'); };
  const offer = (reg) => {
    const waiting = reg.waiting;
    if (!waiting || !navigator.serviceWorker.controller) return; // first install: nothing to replace
    if (!interacted) { apply(waiting); return; }
    const bar = $('#update');
    bar.hidden = false;
    bar.onclick = () => apply(waiting);
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });

  navigator.serviceWorker.register('sw.js').then((reg) => {
    offer(reg); // an update may already be waiting from an earlier visit
    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      next?.addEventListener('statechange', () => { if (next.state === 'installed') offer(reg); });
    });
    // Home-screen apps stay alive in the background for days: check again whenever they return.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}
