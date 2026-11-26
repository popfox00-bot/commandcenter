// Saved Files → ★ Favorites: the files you starred, as cards in two columns: each its picture (a photo; a
// video's frame, with a row of stills from through it under it; any other file its kind), a title of your own
// (its name to start) and, if you like, a description. Drag a card's ⠿ (or ← → on it) to put your favorites
// first: they fill the columns from the top. About four to six cards on a phone's screen; scroll for the rest.
// Kept on this phone (the list, titles, order and the pictures made from each file), so they show offline too;
// opening the file itself needs the connection. Pure storage below, the view after.

import { idb } from '../../lib/idb.js';
import { el, fill } from '../../lib/dom.js';
import { fileKind } from '../../lib/saved-files.js';

const LIST = 'cc.saved.favs';
const THUMB = (id) => `cc.saved.fav.t.${id}`;

/** A file's name as a title to start with: no extension, separators as spaces. */
export const titleOf = (name) => String(name ?? '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').trim() || 'Untitled';

/** The favorites, in order: [{ id, name, type, kind, title, desc, at }]. */
export async function listFavs() { const v = await idb.get(LIST); return Array.isArray(v) ? v : []; }
const keep = (list) => idb.set(LIST, list);

/** `list` with the one at `from` moved to `to` (a copy). */
export function moveFav(list, from, to) { const out = [...list]; const [x] = out.splice(from, 1); out.splice(Math.max(0, Math.min(out.length, to)), 0, x); return out; }

/** A picture made small (at most `edge` across), as JPEG bytes. */
async function small(blob, edge) {
  const bmp = await createImageBitmap(blob); const k = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  const b = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.82));
  return { buf: await b.arrayBuffer(), type: 'image/jpeg' };
}

/** The pictures for a file's card: a photo's own; a video's frames (the first the big one); none for others. */
export async function picturesOf(file) {
  const kind = /^image\//.test(file.type) ? 'photo' : /^video\//.test(file.type) || /\.(mov|mp4|m4v|webm)$/i.test(file.name) ? 'video' : 'file';
  if (kind === 'photo') { try { return { kind, pics: [await small(file, 640)] }; } catch { return { kind, pics: [] }; } }
  if (kind === 'video') {
    try {
      const { videoFrames } = await import('../../apps/socials/socials-editor.js');
      const frames = await videoFrames(file, { n: 5, edge: 640 });
      return { kind, pics: await Promise.all(frames.map((f, i) => small(f, i ? 240 : 640))) };
    } catch { return { kind, pics: [] }; }
  }
  return { kind, pics: [] };
}

/** A file starred: its card made (its pictures kept). `f`: the listing ({ id, name, type }); `file`: its bytes. */
export async function addFav(f, file) {
  const list = await listFavs(); if (list.some((x) => x.id === f.id)) return list;
  const { kind, pics } = await picturesOf(file);
  await idb.set(THUMB(f.id), pics);
  const next = [{ id: f.id, name: f.name, type: f.type ?? file.type ?? '', kind, title: titleOf(f.name), desc: '', at: Date.now() }, ...list];
  await keep(next); return next;
}
export async function removeFav(id) { const next = (await listFavs()).filter((x) => x.id !== id); await keep(next); await idb.del(THUMB(id)); return next; }
export async function updateFav(id, changes) {
  const next = (await listFavs()).map((x) => (x.id === id ? { ...x, ...(changes.title != null ? { title: String(changes.title).slice(0, 80) } : {}), ...(changes.desc != null ? { desc: String(changes.desc).slice(0, 300) } : {}) } : x));
  await keep(next); return next;
}
export async function reorderFavs(from, to) { const next = moveFav(await listFavs(), from, to); await keep(next); return next; }
/** A favorite's pictures, as Blobs (the big one first). */
export async function picsOf(id) { const v = await idb.get(THUMB(id)); return Array.isArray(v) ? v.map((p) => new Blob([p.buf], { type: p.type })) : []; }

/**
 * The Favorites view in `root`: `onBack()`; `onOpen(fav)` opens the file itself (it needs the connection).
 * Returns { draw }.
 */
export function favoritesView(root, { onBack, onOpen }) {
  let list = []; const urls = [];
  const url = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const grid = el('div', { class: 'fv-grid', role: 'list', 'aria-label': 'Favorites' });
  const note = el('p', { class: 'small muted', 'aria-live': 'polite' });

  async function card(f, i) {
    const pics = await picsOf(f.id); const k = fileKind(f.name, f.type);
    const handle = el('button', { type: 'button', class: 'fv-handle', 'aria-label': `Move ${f.title} (drag, or ← →)`, 'aria-roledescription': 'drag handle', text: '⠿' });
    const pic = pics[0] ? el('img', { class: 'fv-pic', src: url(pics[0]), alt: '' }) : el('span', { class: `fv-pic fv-nopic sv-k-${k.kind}`, 'aria-hidden': 'true', text: k.emoji });
    const stills = f.kind === 'video' && pics.length > 1 ? el('div', { class: 'fv-stills', 'aria-hidden': 'true' }, pics.slice(1, 5).map((b) => el('img', { src: url(b), alt: '' }))) : null;
    return el('div', { class: 'fv-card', role: 'listitem', 'data-i': String(i), 'data-id': f.id },
      el('button', { type: 'button', class: 'fv-open', 'aria-label': `${f.title}${f.kind === 'video' ? ' (video)' : ''}: details`, onclick: () => details(f, pics) },
        el('span', { class: 'fv-picbox' }, pic, f.kind === 'video' ? el('span', { class: 'fv-play', 'aria-hidden': 'true', text: '▶︎' }) : null),
        stills,
        el('strong', { class: 'fv-title', text: f.title }),
        f.desc ? el('span', { class: 'fv-desc', text: f.desc }) : null),
      handle);
  }

  async function draw(msg = '') {
    list = await listFavs(); for (const u of urls.splice(0)) URL.revokeObjectURL(u);
    note.textContent = msg || (list.length ? `${list.length} favorite${list.length === 1 ? '' : 's'}. Drag ⠿ to reorder: the first ones show at the top.` : '');
    fill(grid, list.length ? await Promise.all(list.map(card)) : el('p', { class: 'muted fv-empty', text: 'No favorites yet. Star a file (☆) in Saved Files to put it here.' }));
  }

  // (Reordering: a card's ⠿ dragged over the others (it takes the place of the one under the finger), or ← →.)
  let drag = null;
  grid.addEventListener('pointerdown', (e) => {
    const h = e.target.closest?.('.fv-handle'); if (!h) return;
    const c = h.closest('.fv-card'); e.preventDefault(); h.setPointerCapture(e.pointerId);
    drag = { c, from: Number(c.dataset.i), id: e.pointerId }; c.classList.add('dragging');
  });
  grid.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.fv-card');
    if (!under || under === drag.c || !grid.contains(under)) return;
    const cards = [...grid.children]; const a = cards.indexOf(drag.c); const b = cards.indexOf(under);
    grid.insertBefore(drag.c, a < b ? under.nextSibling : under);
  });
  const end = async (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { c, from } = drag; drag = null; c.classList.remove('dragging');
    const to = [...grid.children].indexOf(c);
    if (to !== from && to >= 0) { await reorderFavs(from, to); await draw('Order kept.'); }
  };
  grid.addEventListener('pointerup', end); grid.addEventListener('pointercancel', end);
  grid.addEventListener('keydown', async (e) => {
    const h = e.target.closest?.('.fv-handle'); if (!h) return;
    const step = { ArrowLeft: -1, ArrowUp: -2, ArrowRight: 1, ArrowDown: 2 }[e.key]; if (!step) return;
    e.preventDefault(); const from = Number(h.closest('.fv-card').dataset.i); const to = Math.max(0, Math.min(list.length - 1, from + step));
    if (to === from) return;
    await reorderFavs(from, to); await draw('Order kept.');
    grid.querySelector(`.fv-card[data-i="${to}"] .fv-handle`)?.focus();
  });

  // (A card's details: its title and description to change, the file to open, or off the favorites.)
  function details(f, pics) {
    const title = el('input', { type: 'text', class: 'fv-in', value: f.title, maxlength: '80', 'aria-label': 'Title' });
    const desc = el('textarea', { class: 'fv-in', rows: '3', maxlength: '300', placeholder: 'A description (optional)', 'aria-label': 'Description' }); desc.value = f.desc;
    const dlg = el('dialog', { class: 'ed-dialog fv-details', 'aria-label': `${f.title}: details` }, el('div', { class: 'sheet' },
      pics[0] ? el('img', { class: 'fv-big', src: url(pics[0]), alt: '' }) : null,
      f.kind === 'video' && pics.length > 1 ? el('div', { class: 'fv-stills fv-stills-big' }, pics.slice(1).map((b) => el('img', { src: url(b), alt: '' }))) : null,
      el('label', { class: 'fv-label' }, 'Title', title), el('label', { class: 'fv-label' }, 'Description', desc),
      el('p', { class: 'small muted', text: f.name }),
      el('div', { class: 'row wrap' },
        el('button', { type: 'button', class: 'btn primary', text: 'Save', onclick: async () => { await updateFav(f.id, { title: title.value.trim() || titleOf(f.name), desc: desc.value.trim() }); dlg.close(); draw('Saved.'); } }),
        el('button', { type: 'button', class: 'btn', text: 'Open the file', onclick: () => { dlg.close(); onOpen(f); } }),
        el('button', { type: 'button', class: 'btn ghost bad-text', text: '☆ Unfavorite', onclick: async () => { await removeFav(f.id); dlg.close(); draw(`"${f.title}" taken off your favorites.`); } }),
        el('button', { type: 'button', class: 'btn ghost', text: 'Close', onclick: () => dlg.close() }))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  fill(root, el('div', { class: 'row space' }, el('h2', { class: 'sv-h', text: '★ Favorites' }), el('button', { type: 'button', class: 'btn small-btn ghost', text: '‹ All files', onclick: onBack })), note, grid);
  draw();
  return { draw };
}
