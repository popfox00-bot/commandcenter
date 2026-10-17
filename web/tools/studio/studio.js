// "Editor" app: the Photo Editor and the File Converter as two tabs of one app.
// Routes: #/tools/editor (photo, default) and #/tools/editor/convert.
// Each tab is mounted the first time it is opened and then kept alive while hidden, so switching
// tabs never loses a conversion in progress or an open photo.

import { el } from '../../lib/dom.js';

const TABS = [
  { id: 'photo', label: 'Photo', load: () => import('../editor/editor.js') },
  { id: 'convert', label: 'Convert', load: () => import('../convert/convert.js') },
];

export function mount(host) {
  const panes = new Map(); // id -> { node, api }
  const bar = el('div', { class: 'segmented studio-tabs', role: 'tablist', 'aria-label': 'Editor' });
  const body = el('div', { class: 'studio-body' });
  host.append(el('h2', { class: 'tool-title', text: 'Editor' }), bar, body);

  const current = () => (location.hash.split('/')[3] === 'convert' ? 'convert' : 'photo');

  async function ensure(id, opts) {
    if (panes.has(id)) return panes.get(id);
    const node = el('section', { class: 'studio-pane' });
    body.append(node);
    const pane = { node, api: null, ready: null };
    panes.set(id, pane);
    pane.ready = TABS.find((t) => t.id === id).load().then((mod) => { pane.api = mod.mount(node, opts); return pane; });
    return pane.ready;
  }

  async function show(id) {
    bar.replaceChildren(...TABS.map((t) => el('a', {
      class: `seg${t.id === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(t.id === id), text: t.label,
      href: t.id === 'photo' ? '#/tools/editor' : '#/tools/editor/convert',
    })));
    const pane = await ensure(id, id === 'convert' ? { onEdit: sendToPhoto } : {});
    await pane.ready;
    for (const [pid, p] of panes) p.node.hidden = pid !== id;
    pane.api?.show?.();
  }

  // Converter -> photo editor hand-off.
  async function sendToPhoto(file) {
    if (panes.has('photo')) {
      const p = await panes.get('photo').ready;
      if (p.api?.openFile?.(file, file.name) === false) return;
    } else {
      await ensure('photo', { file });
    }
    location.hash = '#/tools/editor';
  }

  const onHash = () => { if (location.hash.startsWith('#/tools/editor')) show(current()); };
  window.addEventListener('hashchange', onHash);
  show(current());

  return () => {
    window.removeEventListener('hashchange', onHash);
    for (const p of panes.values()) { if (typeof p.api === 'function') p.api(); }
  };
}
