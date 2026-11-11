// "Files" app: a page of its own apps (Photo Editor, Convert, PDF, Scan), each opened from it. Photo
// Editor has Edit, Collage and Cutout; Scan has Documents and QR codes (scan, make, app codes).
// Routes: #/files (its page of apps) and #/files/<tab> (photo, collage, cutout, convert, pdf, scan,
// qr). A file handed over from Saved Files (in Magic) opens in the Photo Editor or PDF.
// Going from a photo being edited to Collage puts it in a frame; to Cutout asks what to do with it.
// Each tab is mounted the first time it is opened and then kept alive while hidden, so switching
// tabs never loses a conversion in progress or an open photo.

import { el } from '../../lib/dom.js';
import { handoff } from '../../lib/handoff.js';
import { FILES_APPS } from '../../apps/index.js';
import { renderHub } from '../../apps/hub.js';

const TABS = [
  { id: 'photo', label: 'Photo', load: () => import('../editor/editor.js') },
  { id: 'collage', label: 'Collage', load: () => import('../collage/collage.js') },
  { id: 'cutout', label: 'Cutout', load: () => import('../cutout/cutout.js') },
  { id: 'pdf', label: 'PDF', load: () => import('../pdfwrite/pdfwrite.js') },
  { id: 'scan', label: 'Scan', load: () => import('../scan/scan.js') },
  { id: 'qr', label: 'QR codes', load: () => import('../qr/qr.js') },
  { id: 'convert', label: 'Convert', load: () => import('../convert/convert.js') },
];
const hashFor = (id) => `#/files/${id}`;
// The switches inside an app of Files: Photo Editor's three, Scan's two.
const PHOTO = [['photo', '✏️ Edit'], ['collage', '🧩 Collage'], ['cutout', '✂️ Cutout']];
const SCAN = [['scan', '📄 Documents'], ['qr', '▦ QR codes']];
/** The pane a tab shows (its own). */
const paneOf = (id) => TABS.find((t) => t.id === id)?.pane ?? id;
const inPhoto = (id) => PHOTO.some(([p]) => p === id);
const switchesOf = (id) => (inPhoto(id) ? PHOTO : SCAN.some(([p]) => p === id) ? SCAN : null);

export function mount(host) {
  const panes = new Map(); // id -> { node, api }
  const hub = el('div', { class: 'studio-hub' });
  renderHub(hub, FILES_APPS.map((a) => ({ ...a, href: hashFor(a.id) })));
  const sub = el('div', { class: 'segmented studio-sub', role: 'tablist' });
  const body = el('div', { class: 'studio-body' });
  host.append(hub, sub, body);
  let shown = null;    // the tab on screen
  const handed = {};   // the editor photo (its key) last handed to Collage / Cutout

  const current = () => {
    const sub = location.hash.split('/')[2];
    return TABS.some((t) => t.id === sub) ? sub : 'hub';
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
    // Its page of apps.
    hub.hidden = id !== 'hub'; body.hidden = id === 'hub';
    if (id === 'hub') { sub.hidden = true; return; }
    const from = shown; shown = id;
    const sw = switchesOf(id);
    sub.hidden = !sw;
    sub.setAttribute('aria-label', inPhoto(id) ? 'Photo Editor' : 'Scan');
    sub.replaceChildren(...(sw ?? []).map(([t, label]) => el('a', {
      class: `seg${t === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(t === id), text: label, href: hashFor(t),
    })));
    const pid = paneOf(id);
    // A file handed over from Saved Files opens here.
    const given = handoff.take(pid);
    if (given && !panes.has(pid)) { await ensure(pid, { ...optsFor(pid), file: given }); } else if (given) { const p = await panes.get(pid).ready; p.api?.openFile?.(given, given.name); }
    const pane = await ensure(pid, optsFor(pid));
    await pane.ready;
    for (const [k, p] of panes) p.node.hidden = k !== pid;
    pane.api?.show?.();
    if (paneOf(from) === 'photo' && (id === 'collage' || id === 'cutout')) handOff(id, pane);
  }

  const optsFor = (id) => ({
    convert: { onEdit: sendToPhoto, onWrite: sendToPdf },
    scan: { onWrite: sendToPdf },
    cutout: { onPlace: (f) => sendTo('collage', f) },
    collage: { onEdit: sendToPhoto },
  }[id] ?? {});

  /**
   * From a photo being edited: Collage puts it in a frame (hold and drag it to another, or pick a
   * layout with more frames); Cutout asks whether to trace a cutout of it or put a Character on it.
   * Each photo (with its edits) is handed over once.
   */
  async function handOff(id, pane) {
    const editor = panes.get('photo')?.api;
    const key = editor?.photoKey?.();
    if (!key || handed[id] === key) return;
    handed[id] = key;
    const photo = await editor.currentPhoto();
    if (!photo) return;
    if (id === 'collage') { await pane.api?.placeInGrid?.(photo); return; }
    const dlg = el('dialog', { class: 'ed-dialog studio-handoff' }, el('form', { method: 'dialog', class: 'sheet' },
      el('h2', { text: 'Cutout with this photo' }),
      el('p', { class: 'muted small', text: 'Cut something out of the photo you were editing, or put one of your Characters on it.' }),
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn primary', value: 'trace', text: '✂️ Trace a cutout' }),
        el('button', { class: 'btn', value: 'character', text: '🧸 Add a Character' }),
        el('button', { class: 'btn ghost', value: 'cancel', text: 'Not now' }))));
    dlg.addEventListener('close', async () => {
      dlg.remove();
      if (dlg.returnValue === 'trace') pane.api?.openFile?.(photo, photo.name);
      else if (dlg.returnValue === 'character') {
        const collage = await ensure('collage', optsFor('collage'));
        await collage.ready;
        location.hash = hashFor('collage');
        // Not handed to Collage again on the way: this photo is the background already.
        handed.collage = key;
        await collage.api?.characterOn?.(photo);
      } else delete handed.cutout; // ask again next time
    });
    document.body.append(dlg);
    dlg.showModal();
  }

  // Converter -> photo editor / PDF hand-offs.
  async function sendTo(id, file) {
    if (panes.has(id)) {
      const p = await panes.get(id).ready;
      if (p.api?.openFile?.(file, file.name) === false) return;
    } else {
      await ensure(id, { ...optsFor(id), file });
    }
    location.hash = hashFor(id);
  }
  const sendToPhoto = (file) => sendTo('photo', file);
  const sendToPdf = (file) => sendTo('pdf', file);

  const onHash = () => { if (/^#\/files(\/|$)/.test(location.hash)) show(current()); };
  window.addEventListener('hashchange', onHash);
  show(current());

  return () => {
    window.removeEventListener('hashchange', onHash);
    for (const p of panes.values()) { if (typeof p.api === 'function') p.api(); }
  };
}
