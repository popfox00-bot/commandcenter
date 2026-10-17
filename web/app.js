// Command Center PWA shell: home screen of apps (Tools, Updates, Jobs), hash routing, service worker updates.
// No build step; every module is plain ES modules served from this folder.

import { $, el, store } from './lib/dom.js';
import { TOOLS, REDIRECTS } from './tools/index.js';
import { APPS } from './apps/index.js';
import { setJobsActive } from './jobs.js';

const views = { home: $('#view-home'), tools: $('#view-tools'), tool: $('#view-tool'), app: $('#view-app'), jobs: $('#view-jobs') };
let mountedTool = null;
let mountedApp = null;

function renderHome() {
  $('#app-grid').replaceChildren(...APPS.map((a) => el('a', { class: 'app-tile', href: a.href },
    el('span', { class: `app-icon tint-${a.tint}`, 'aria-hidden': 'true', text: a.icon }),
    el('span', { class: 'app-name', text: a.name }),
    el('span', { class: 'app-note muted', text: a.note }))));
}

function renderToolsHub() {
  const list = $('#tool-list');
  list.replaceChildren(...TOOLS.map((t) => el(t.soon ? 'div' : 'a', {
    class: `tool-card${t.soon ? ' soon' : ''}`,
    href: t.soon ? null : `#/tools/${t.id}`,
    'aria-disabled': t.soon ? 'true' : null,
  },
  el('span', { class: 'tool-icon', 'aria-hidden': 'true', text: t.icon }),
  el('span', { class: 'tool-text' }, el('strong', { text: t.name }), el('span', { class: 'muted small', text: t.description })),
  t.soon ? el('span', { class: 'pill idle', text: 'soon' }) : el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }))));
}

async function route() {
  if (REDIRECTS[location.hash]) { location.replace(REDIRECTS[location.hash]); return; }
  const [, section = '', sub] = (location.hash || '#/').split('/');
  const app = APPS.find((a) => a.id === section && a.load);
  const view = section === 'jobs' ? 'jobs' : section === 'tools' ? (sub ? 'tool' : 'tools') : app ? 'app' : 'home';
  for (const [name, node] of Object.entries(views)) node.hidden = name !== view;
  $('#title').textContent = { home: 'Command Center', tools: 'Tools', tool: 'Tools', jobs: 'Jobs', app: app?.name }[view];
  $('#jobs-actions').hidden = view !== 'jobs';
  setJobsActive(view === 'jobs');

  if (mountedTool && (view !== 'tool' || mountedTool.id !== sub)) {
    mountedTool.unmount?.();
    mountedTool = null;
  }
  if (mountedApp && (view !== 'app' || mountedApp.id !== app.id)) {
    mountedApp.unmount?.();
    mountedApp = null;
  }
  if (view === 'tool' && !mountedTool) {
    const tool = TOOLS.find((t) => t.id === sub && !t.soon);
    if (!tool) { location.replace('#/tools'); return; }
    mountedTool = await mountInto($('#tool-host'), tool, tool.id);
  }
  if (view === 'app' && !mountedApp) mountedApp = await mountInto($('#app-host'), app, app.id);
  if (view !== 'tool' && view !== 'app') document.title = view === 'home' ? 'Command Center' : `${$('#title').textContent} · Command Center`;
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
renderToolsHub();
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
