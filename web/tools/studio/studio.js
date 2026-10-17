// "Editor" app: one app, several tools as tabs (photo, PDF, scan, convert, ...).
// Routes: #/tools/editor (photo, default) and #/tools/editor/<tab>.
// Each tab is mounted the first time it is opened and then kept alive while hidden, so switching
// tabs never loses a conversion in progress or an open photo.

import { el } from '../../lib/dom.js';

const TABS = [
  { id: 'photo', label: 'Photo', load: () => import('../editor/editor.js') },
  { id: 'collage', label: 'Collage', load: () => import('../collage/collage.js') },
  { id: 'cutout', label: 'Cutout', load: () => import('../cutout/cutout.js') },
  { id: 'pdf', label: 'PDF', load: () => import('../pdfwrite/pdfwrite.js') },
  { id: 'scan', label: 'Scan', load: () => import('../scan/scan.js') },
  { id: 'convert', label: 'Convert', load: () => import('../convert/convert.js') },
];
const hashFor = (id) => (id === 'photo' ? '#/tools/editor' : `#/tools/editor/${id}`);

export function mount(host) {
  const panes = new Map(); // id -> { node, api }
  const bar = el('div', { class: 'chips studio-tabs', role: 'tablist', 'aria-label': 'Editor' });
  const body = el('div', { class: 'studio-body' });
  host.append(el('h2', { class: 'tool-title', text: 'Editor' }), bar, body);

  const current = () => {
    const sub = location.hash.split('/')[3];
    return TABS.some((t) => t.id === sub) ? sub : 'photo';
  };

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
      class: `chip${t.id === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(t.id === id), text: t.label,
      href: hashFor(t.id),
    })));
    const opts = {
      convert: { onEdit: sendToPhoto, onWrite: sendToPdf },
      scan: { onWrite: sendToPdf },
      cutout: { onPlace: (f) => sendTo('collage', f) },
      collage: { onEdit: sendToPhoto },
    }[id] ?? {};
    const pane = await ensure(id, opts);
    await pane.ready;
    for (const [pid, p] of panes) p.node.hidden = pid !== id;
    pane.api?.show?.();
  }

  // Converter -> photo editor / PDF hand-offs.
  async function sendTo(id, file) {
    if (panes.has(id)) {
      const p = await panes.get(id).ready;
      if (p.api?.openFile?.(file, file.name) === false) return;
    } else {
      await ensure(id, { file });
    }
    location.hash = hashFor(id);
  }
  const sendToPhoto = (file) => sendTo('photo', file);
  const sendToPdf = (file) => sendTo('pdf', file);

  const onHash = () => { if (location.hash.startsWith('#/tools/editor')) show(current()); };
  window.addEventListener('hashchange', onHash);
  show(current());

  return () => {
    window.removeEventListener('hashchange', onHash);
    for (const p of panes.values()) { if (typeof p.api === 'function') p.api(); }
  };
}
