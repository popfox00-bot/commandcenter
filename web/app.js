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

// Service worker: offline support. When a new version is installed, offer a reload instead of
// reloading under the user (they may be mid-conversion).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      next?.addEventListener('statechange', () => {
        if (next.state === 'installed' && navigator.serviceWorker.controller) {
          const b = $('#update');
          b.hidden = false;
          b.onclick = () => { next.postMessage('skip-waiting'); };
        }
      });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && !$('#update').hidden) { reloaded = true; location.reload(); } });
}
