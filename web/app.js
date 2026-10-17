// Command Center PWA shell: tab bar (Tools / Jobs), hash routing, service worker updates.
// No build step; every module is plain ES modules served from this folder.

import { $, el, store } from './lib/dom.js';
import { TOOLS } from './tools/index.js';
import { setJobsActive } from './jobs.js';

const views = { tools: $('#view-tools'), jobs: $('#view-jobs'), tool: $('#view-tool') };
let mountedTool = null;

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
  const hash = location.hash || (store.get('cc.lastTab') === 'jobs' ? '#/jobs' : '#/tools');
  const [, section, toolId] = hash.split('/');
  const view = section === 'jobs' ? 'jobs' : toolId ? 'tool' : 'tools';
  for (const [name, node] of Object.entries(views)) node.hidden = name !== view;
  for (const tab of document.querySelectorAll('.tabbar a')) tab.setAttribute('aria-current', tab.dataset.tab === (view === 'jobs' ? 'jobs' : 'tools') ? 'page' : 'false');
  $('#jobs-actions').hidden = view !== 'jobs';
  if (view !== 'tool') store.set('cc.lastTab', view === 'jobs' ? 'jobs' : 'tools');
  setJobsActive(view === 'jobs');

  if (mountedTool && (view !== 'tool' || mountedTool.id !== toolId)) {
    mountedTool.unmount?.();
    mountedTool = null;
  }
  if (view === 'tool' && !mountedTool) {
    const tool = TOOLS.find((t) => t.id === toolId && !t.soon);
    if (!tool) { location.replace('#/tools'); return; }
    const host = $('#tool-host');
    host.replaceChildren(el('p', { class: 'muted center', text: 'Loading…' }));
    document.title = `${tool.name} · Command Center`;
    try {
      const mod = await tool.load();
      host.replaceChildren();
      mountedTool = { id: tool.id, unmount: mod.mount(host) };
      mountedTool.unmount = typeof mountedTool.unmount === 'function' ? mountedTool.unmount : null;
    } catch (err) {
      host.replaceChildren(el('p', { class: 'bad-text', text: `Could not load ${tool.name}: ${err.message}` }));
    }
  }
  if (view !== 'tool') document.title = 'Command Center';
  window.scrollTo(0, 0);
}

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
