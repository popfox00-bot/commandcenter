// Notes app: notes (text or checklists, with photos and voice memos) and a grocery list that sorts itself by store
// section with an icon per food type. "My items" remembers what you buy, including a photo of the
// exact brand, so whoever shops gets the right one. Everything stays on the phone (IndexedDB).
// Routes: #/notes (notes), #/notes/grocery.

import { el } from '../../lib/dom.js';
import { idb } from '../../lib/idb.js';
import { sniffType, decodeImage, fitSize, drawToCanvas, canvasToBlob } from '../../lib/image.js';
import { shareFiles, canShareFiles } from '../../lib/files.js';
import { CATEGORIES, CATEGORY, categorize, itemIcon, makeItem, findInCatalog, suggest, groupItems, listToText, sortNotes, notePreview, normalizeName } from './notes-core.js';

const NOTES_KEY = 'notes.v1';
const GROCERY_KEY = 'grocery.v1';
const photoKey = (id) => `notes.photo.${id}`;
const memoKey = (id) => `notes.memo.${id}`;

// ---------- voice memos ----------

/** A type of audio this browser can record: AAC on iPhone, Opus elsewhere. */
const memoType = () => ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => globalThis.MediaRecorder?.isTypeSupported?.(t)) ?? '';
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Record from the microphone until stop() is called: { stop: () => Promise<{ blob, seconds }>, cancel }.
 * Throws when there's no microphone or it isn't allowed.
 */
async function startRecording(onTick) {
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error('Recording isn\'t available in this browser.');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { throw new Error('Allow the microphone for this app to record a memo.'); }
  const type = memoType();
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = []; const t0 = Date.now();
  rec.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
  const timer = setInterval(() => onTick?.((Date.now() - t0) / 1000), 250);
  rec.start(1000);
  const end = () => { clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); };
  return {
    stop: () => new Promise((resolve) => {
      rec.addEventListener('stop', () => { end(); resolve({ blob: new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }), seconds: (Date.now() - t0) / 1000 }); }, { once: true });
      rec.stop();
    }),
    cancel: () => { try { rec.stop(); } catch { /* stopped */ } end(); },
  };
}
const uid = () => crypto.randomUUID();

// ---------- photos ----------

/** Store a photo (downscaled JPEG + thumbnail). Returns its id. */
async function savePhoto(file) {
  const bitmap = await decodeImage(file, await sniffType(file));
  const big = fitSize(bitmap.width, bitmap.height, 1600);
  const small = fitSize(bitmap.width, bitmap.height, 360);
  const full = await canvasToBlob(drawToCanvas(bitmap, big.width, big.height, '#ffffff'), 'image/jpeg', 0.85);
  const thumb = await canvasToBlob(drawToCanvas(bitmap, small.width, small.height, '#ffffff'), 'image/jpeg', 0.8);
  bitmap.close?.();
  const id = uid();
  await idb.set(photoKey(id), { full, thumb, at: Date.now() });
  return id;
}

export function mount(host) {
  const urls = new Map(); // `${id}:${size}` -> object URL
  const photoUrl = async (id, size = 'thumb') => {
    const k = `${id}:${size}`;
    if (urls.has(k)) return urls.get(k);
    const rec = await idb.get(photoKey(id));
    if (!rec?.[size]) return null;
    const u = URL.createObjectURL(rec[size]);
    urls.set(k, u);
    return u;
  };
  /** An <img> that fills in once the photo is read from storage. */
  const photoImg = (id, cls, size = 'thumb') => {
    const img = el('img', { class: cls, alt: '' });
    photoUrl(id, size).then((u) => { if (u) img.src = u; else img.remove(); });
    return img;
  };
  function viewPhoto(id, caption = '') {
    const dlg = el('dialog', { class: 'nt-viewer' },
      el('div', { class: 'nt-viewer-body' }, photoImg(id, 'nt-viewer-img', 'full'), caption ? el('p', { text: caption }) : null,
        el('button', { class: 'btn', text: 'Close', onclick: () => dlg.close() })));
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
    dlg.showModal();
  }
  /** Camera / library buttons; calls onFile(file). Inputs get unique ids so labels work. */
  function photoButtons(onFile, { camera = '📷 Take photo', library = 'Choose photo' } = {}) {
    const mk = (capture) => {
      const id = `nt-in-${uid().slice(0, 8)}`;
      const input = el('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id, ...(capture ? { capture: 'environment' } : {}) });
      input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; if (f) onFile(f); });
      return [el('label', { class: `btn small-btn${capture ? ' primary' : ''}`, for: id, text: capture ? camera : library }), input];
    };
    return el('div', { class: 'row wrap nt-photo-btns' }, ...mk(true), ...mk(false));
  }

  const seg = el('div', { class: 'segmented nt-tabs', role: 'tablist' });
  const panes = { notes: el('section', { class: 'nt-pane' }), grocery: el('section', { class: 'nt-pane' }) };
  host.append(seg, ...Object.values(panes));
  const current = () => (location.hash.split('/')[2] === 'grocery' ? 'grocery' : 'notes');
  function show() {
    const id = current();
    seg.replaceChildren(...[['notes', '📝 Notes'], ['grocery', '🛒 Grocery']].map(([k, label]) => el('a', {
      class: `seg${k === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(k === id), text: label, href: k === 'notes' ? '#/notes' : '#/notes/grocery',
    })));
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== id;
    (id === 'notes' ? notes : grocery).render();
  }

  // =====================================================================
  // Grocery
  // =====================================================================

  const grocery = (() => {
    const pane = panes.grocery;
    let data = { items: [], catalog: [] };
    let loaded = false;
    let view = 'list'; // list | catalog
    let typed = '';
    const save = () => idb.set(GROCERY_KEY, data);
    const load = async () => { if (!loaded) { data = { items: [], catalog: [], ...((await idb.get(GROCERY_KEY)) ?? {}) }; loaded = true; } };
    const catalogOf = (item) => (item.catalogId ? data.catalog.find((c) => c.id === item.catalogId) : null);

    function add(text) {
      const t = text.trim();
      if (!t) return;
      const item = makeItem(t, data.catalog);
      const dup = data.items.find((i) => !i.done && normalizeName(i.name) === normalizeName(item.name));
      if (dup) { if (item.qty) dup.qty = item.qty; } else data.items.push(item);
      typed = '';
      save(); render(true);
    }
    function addFromCatalog(c) {
      if (!data.items.some((i) => !i.done && i.catalogId === c.id)) data.items.push({ id: uid(), name: c.name, qty: '', done: false, category: c.category, catalogId: c.id, added: Date.now() });
      typed = '';
      save(); render(true);
    }
    function toggle(item) {
      item.done = !item.done;
      item.doneAt = item.done ? Date.now() : null;
      save(); render();
    }
    function clearCart() {
      const done = data.items.filter((i) => i.done);
      for (const i of done) {
        let c = catalogOf(i) ?? findInCatalog(data.catalog, i.name);
        if (!c) { c = { id: uid(), name: i.name, category: i.category, brand: '', note: '', photoId: null, timesBought: 0 }; data.catalog.push(c); }
        c.timesBought = (c.timesBought ?? 0) + 1;
        c.lastBought = Date.now();
      }
      data.items = data.items.filter((i) => !i.done);
      save(); render();
    }
    async function shareList() {
      const text = listToText(data.items, data.catalog);
      try {
        if (navigator.share) { await navigator.share({ title: 'Grocery list', text }); return; }
      } catch (err) { if (err?.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(text); alert('List copied. Paste it into a message.'); } catch { alert(text); }
    }

    // ---------- item / catalog editor ----------

    function editItem(item, { catalogOnly = false } = {}) {
      // When editing a list item, brand + photo live on its "My items" entry so they're remembered.
      let entry = catalogOnly ? item : catalogOf(item) ?? findInCatalog(data.catalog, item.name);
      const draft = {
        name: item.name, qty: catalogOnly ? '' : item.qty ?? '', note: catalogOnly ? '' : item.note ?? '',
        category: item.category, brand: entry?.brand ?? '', photoId: entry?.photoId ?? null, remember: !!entry || catalogOnly,
      };
      const photoBox = el('div', { class: 'nt-edit-photo' });
      const drawPhoto = () => photoBox.replaceChildren(...[
        draft.photoId ? el('button', { class: 'nt-photo-big', onclick: () => viewPhoto(draft.photoId, draft.brand || draft.name) }, photoImg(draft.photoId, '', 'full')) : el('p', { class: 'muted small', text: 'Add a photo of the exact product (brand, size, label) so it\'s easy to find on the shelf.' }),
        photoButtons(async (f) => { draft.photoId = await savePhoto(f); draft.remember = true; rememberBox.checked = true; drawPhoto(); }, draft.photoId ? { camera: '📷 Retake', library: 'Choose another' } : undefined),
        draft.photoId ? el('button', { class: 'btn small-btn ghost', text: 'Remove photo', onclick: () => { draft.photoId = null; drawPhoto(); } }) : null,
      ].filter(Boolean));
      const field = (label, key, attrs = {}) => {
        const input = el('input', { value: draft[key] ?? '', ...attrs });
        input.addEventListener('input', () => { draft[key] = input.value; });
        return el('label', {}, label, input);
      };
      const cat = el('select', { 'aria-label': 'Store section' }, ...CATEGORIES.map((c) => el('option', { value: c.id, text: `${c.icon} ${c.name}`, selected: c.id === draft.category })));
      cat.addEventListener('change', () => { draft.category = cat.value; });
      const rememberBox = el('input', { type: 'checkbox', class: 'qr-check-input', id: 'nt-remember', checked: draft.remember });
      rememberBox.addEventListener('change', () => { draft.remember = rememberBox.checked; });

      const dlg = el('dialog', { class: 'ed-dialog' }, el('form', { method: 'dialog', class: 'sheet nt-edit' },
        el('h2', { text: catalogOnly ? 'My item' : 'Edit item' }),
        field('Item', 'name', { required: true, autocapitalize: 'sentences' }),
        catalogOnly ? null : field('Quantity', 'qty', { placeholder: 'e.g. 2, 1 lb, 3 cans' }),
        field('Brand / exact product', 'brand', { placeholder: 'e.g. Tillamook Medium Cheddar 2 lb' }),
        catalogOnly ? null : field('Note for this trip', 'note', { placeholder: 'e.g. if on sale' }),
        el('label', { class: 'field' }, el('span', { text: 'Store section' }), cat),
        el('h3', { text: 'Photo' }), photoBox,
        catalogOnly ? null : el('label', { class: 'qr-checkbox', for: 'nt-remember' }, rememberBox, ' Remember in My items (brand and photo come back next time)'),
        el('div', { class: 'row space' },
          el('button', { type: 'button', class: 'btn ghost bad-text', text: 'Delete', onclick: () => dlg.close('delete') }),
          el('div', { class: 'row' }, el('button', { value: 'cancel', class: 'btn ghost', formnovalidate: true, text: 'Cancel' }), el('button', { value: 'save', class: 'btn primary', text: 'Save' })))));
      drawPhoto();
      dlg.addEventListener('close', () => {
        const how = dlg.returnValue;
        dlg.remove();
        if (how === 'delete') {
          if (catalogOnly) {
            if (!confirm(`Remove "${item.name}" from My items?`)) return;
            data.catalog = data.catalog.filter((c) => c !== item);
            for (const i of data.items) if (i.catalogId === item.id) i.catalogId = null;
            if (item.photoId) idb.del(photoKey(item.photoId));
          } else data.items = data.items.filter((i) => i !== item);
          save(); render(); return;
        }
        if (how !== 'save' || !draft.name.trim()) return;
        const name = draft.name.trim();
        if (catalogOnly) {
          if (item.photoId && item.photoId !== draft.photoId) idb.del(photoKey(item.photoId));
          Object.assign(item, { name, brand: draft.brand.trim(), category: draft.category, photoId: draft.photoId });
        } else {
          Object.assign(item, { name, qty: draft.qty.trim(), note: draft.note.trim(), category: draft.category });
          if (draft.remember) {
            if (!entry) { entry = { id: uid(), name, category: draft.category, brand: '', note: '', photoId: null, timesBought: 0 }; data.catalog.push(entry); }
            if (entry.photoId && entry.photoId !== draft.photoId) idb.del(photoKey(entry.photoId));
            Object.assign(entry, { name, brand: draft.brand.trim(), category: draft.category, photoId: draft.photoId });
            item.catalogId = entry.id;
          }
        }
        save(); render();
      });
      document.body.append(dlg);
      dlg.showModal();
    }

    // ---------- views ----------

    function itemRow(item) {
      const c = catalogOf(item);
      return el('li', { class: `nt-item${item.done ? ' done' : ''}` },
        el('button', { class: 'nt-check', role: 'checkbox', 'aria-checked': String(item.done), 'aria-label': `${item.done ? 'Uncheck' : 'Check'} ${item.name}`, onclick: () => toggle(item) }, item.done ? '✓' : ''),
        el('button', { class: 'nt-item-body', onclick: () => editItem(item) },
          el('span', { class: 'nt-item-icon', 'aria-hidden': 'true', text: itemIcon(item.name, item.category) }),
          el('span', { class: 'nt-item-text' },
            el('strong', { text: `${item.qty ? `${item.qty} ` : ''}${item.name}` }),
            c?.brand || item.note ? el('span', { class: 'muted small', text: [c?.brand, item.note].filter(Boolean).join(' · ') }) : null)),
        c?.photoId ? el('button', { class: 'nt-thumb-btn', 'aria-label': `Photo of ${item.name}`, onclick: () => viewPhoto(c.photoId, c.brand || c.name) }, photoImg(c.photoId, 'nt-thumb')) : null);
    }

    function addBar(focus) {
      const input = el('input', { class: 'nt-add-input', placeholder: 'Add item, e.g. 2 lb ground beef', value: typed, autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done', 'aria-label': 'Add item' });
      const sugg = el('div', { class: 'chips nt-sugg' });
      const drawSugg = () => {
        const list = typed.trim() ? suggest(data.catalog, typed) : [...data.catalog].sort((a, b) => (b.timesBought ?? 0) - (a.timesBought ?? 0)).slice(0, 10);
        const guess = typed.trim() ? CATEGORY[categorize(typed)] : null;
        sugg.replaceChildren(...[
          guess && !list.length ? el('span', { class: 'muted small', text: `${itemIcon(typed, guess.id)} goes in ${guess.name}` }) : null,
          ...list.filter((c) => !data.items.some((i) => !i.done && i.catalogId === c.id)).map((c) => el('button', { class: 'chip nt-sugg-chip', onclick: () => addFromCatalog(c) },
            c.photoId ? photoImg(c.photoId, 'nt-chip-thumb') : el('span', { 'aria-hidden': 'true', text: itemIcon(c.name, c.category) }), ` ${c.name}`)),
        ].filter(Boolean));
      };
      input.addEventListener('input', () => { typed = input.value; drawSugg(); });
      const form = el('form', { class: 'nt-add' }, input, el('button', { class: 'btn primary', text: 'Add' }));
      form.addEventListener('submit', (e) => { e.preventDefault(); add(input.value); });
      drawSugg();
      if (focus) requestAnimationFrame(() => pane.querySelector('.nt-add-input')?.focus());
      return el('div', {}, form, sugg);
    }

    function renderList(focus) {
      const { groups, done } = groupItems(data.items);
      const open = data.items.length - done.length;
      const kids = [
        el('div', { class: 'row space nt-head' },
          el('strong', { text: open ? `${open} to get` : 'All done' }),
          el('div', { class: 'row' },
            el('button', { class: 'btn small-btn ghost', text: 'My items', onclick: () => { view = 'catalog'; render(); } }),
            el('button', { class: 'btn small-btn ghost', text: 'Share', onclick: shareList }))),
        addBar(focus),
      ];
      if (!data.items.length) kids.push(el('p', { class: 'muted small', text: 'Type what you need. Items sort themselves by store section, and anything you\'ve bought before shows up as a one-tap suggestion with its photo.' }));
      for (const g of groups) {
        kids.push(el('h3', { class: 'nt-section' }, `${g.category.icon} ${g.category.name}`, el('span', { class: 'muted', text: ` ${g.items.length}` })), el('ul', { class: 'nt-items' }, ...g.items.map(itemRow)));
      }
      if (done.length) {
        kids.push(el('div', { class: 'row space nt-section' }, el('h3', { text: `🛒 In the cart (${done.length})` }), el('button', { class: 'btn small-btn', text: 'Clear cart', onclick: clearCart })),
          el('ul', { class: 'nt-items' }, ...done.map(itemRow)));
      }
      pane.replaceChildren(...kids);
    }

    function renderCatalog() {
      const list = [...data.catalog].sort((a, b) => (CATEGORY[a.category]?.order ?? 99) - (CATEGORY[b.category]?.order ?? 99) || a.name.localeCompare(b.name));
      const addNew = () => {
        const c = { id: uid(), name: '', category: 'other', brand: '', note: '', photoId: null, timesBought: 0 };
        const name = prompt('Item name');
        if (!name?.trim()) return;
        c.name = name.trim(); c.category = categorize(name);
        data.catalog.push(c); save(); editItem(c, { catalogOnly: true });
      };
      pane.replaceChildren(
        el('div', { class: 'row space nt-head' },
          el('button', { class: 'btn small-btn ghost', text: '‹ List', onclick: () => { view = 'list'; render(); } }),
          el('button', { class: 'btn small-btn primary', text: '+ New', onclick: addNew })),
        el('p', { class: 'muted small', text: 'Things you buy, with the brand and a photo of the exact product. Items you check off and clear land here automatically. Tap + to add one to the list.' }),
        list.length ? el('ul', { class: 'nt-items nt-catalog' }, ...list.map((c) => el('li', { class: 'nt-item' },
          c.photoId ? el('button', { class: 'nt-thumb-btn', onclick: () => viewPhoto(c.photoId, c.brand || c.name) }, photoImg(c.photoId, 'nt-thumb')) : el('span', { class: 'nt-item-icon nt-big-icon', 'aria-hidden': 'true', text: itemIcon(c.name, c.category) }),
          el('button', { class: 'nt-item-body', onclick: () => editItem(c, { catalogOnly: true }) },
            el('span', { class: 'nt-item-text' }, el('strong', { text: c.name }), el('span', { class: 'muted small', text: [c.brand, c.timesBought ? `bought ${c.timesBought}×` : ''].filter(Boolean).join(' · ') || (CATEGORY[c.category] ?? CATEGORY.other).name }))),
          el('button', { class: 'btn small-btn', 'aria-label': `Add ${c.name} to the list`, text: data.items.some((i) => !i.done && i.catalogId === c.id) ? '✓' : '+', onclick: () => { addFromCatalog(c); view = 'catalog'; render(); } })))) : el('p', { class: 'muted small', text: 'Nothing saved yet.' }));
    }

    async function render(focus = false) {
      await load();
      if (view === 'catalog') renderCatalog(); else renderList(focus);
    }
    return { render };
  })();

  // =====================================================================
  // Notes
  // =====================================================================

  const notes = (() => {
    const pane = panes.notes;
    let list = [];
    let loaded = false;
    let query = '';
    let open = null; // note being edited
    let saveTimer = 0;
    const load = async () => { if (!loaded) { list = (await idb.get(NOTES_KEY))?.notes ?? []; loaded = true; } };
    const saveNow = () => idb.set(NOTES_KEY, { notes: list });
    const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); };

    function renderList() {
      const search = el('input', { type: 'search', placeholder: 'Search notes', value: query, 'aria-label': 'Search notes', class: 'nt-search' });
      const grid = el('div', { class: 'nt-grid' });
      const draw = () => {
        const shown = sortNotes(list, query);
        grid.replaceChildren(...(shown.length ? shown.map((n) => el('button', { class: `nt-card${n.pinned ? ' pinned' : ''}`, onclick: () => { open = n; render(); } },
          n.photos?.length ? photoImg(n.photos[0], 'nt-card-img') : null,
          el('strong', { text: `${n.pinned ? '📌 ' : ''}${n.title || (n.checklist ? 'Checklist' : 'Note')}` }),
          el('span', { class: 'small muted nt-card-text', text: notePreview(n) || (n.memos?.length ? 'Voice memo' : '') }),
          n.memos?.length ? el('span', { class: 'small nt-card-memos', text: `🎙 ${n.memos.length} · ${clock(n.memos.reduce((t, m) => t + (m.seconds || 0), 0))}` }) : null,
          el('span', { class: 'small muted', text: new Date(n.updated).toLocaleDateString([], { month: 'short', day: 'numeric' }) }))) : [el('p', { class: 'muted small', text: query ? 'No notes match.' : 'No notes yet. Tap New note.' })]));
      };
      search.addEventListener('input', () => { query = search.value; draw(); });
      draw();
      pane.replaceChildren(
        el('div', { class: 'row nt-head' }, search,
          el('button', { class: 'btn primary', text: '+ Note', onclick: () => newNote(false) }),
          el('button', { class: 'btn', text: '☑ List', 'aria-label': 'New checklist', onclick: () => newNote(true) }),
          el('button', { class: 'btn', text: '🎙 Memo', 'aria-label': 'New voice memo', onclick: () => newNote(false, { record: true }) })),
        grid);
    }

    function newNote(checklist, { record = false } = {}) {
      const n = { id: uid(), title: '', body: '', checklist: checklist ? [{ id: uid(), text: '', done: false }] : null, photos: [], memos: [], pinned: false, created: Date.now(), updated: Date.now() };
      list.push(n);
      open = n;
      saveNow();
      startMemo = record;
      render(!record);
    }
    let startMemo = false;   // a new note opened to record a memo right away
    let recording = null;    // { note, rec } while recording

    function closeNote() {
      const n = open;
      recording?.rec.cancel(); recording = null;
      open = null;
      // Throw away untouched empty notes.
      if (n && !n.title.trim() && !n.body.trim() && !(n.checklist ?? []).some((c) => c.text.trim()) && !n.photos.length && !n.memos?.length) list = list.filter((x) => x !== n);
      saveNow();
      render();
    }

    function renderEditor(focus) {
      const n = open;
      const touch = () => { n.updated = Date.now(); saveSoon(); };
      const title = el('input', { class: 'nt-title', placeholder: 'Title', value: n.title, autocapitalize: 'sentences', 'aria-label': 'Title' });
      title.addEventListener('input', () => { n.title = title.value; touch(); });
      const body = el('textarea', { class: 'ed-textarea nt-body', placeholder: n.checklist ? 'Notes (optional)' : 'Write something…', 'aria-label': 'Note text' });
      body.value = n.body;
      const grow = () => { body.style.height = 'auto'; body.style.height = `${Math.max(140, body.scrollHeight + 4)}px`; };
      body.addEventListener('input', () => { n.body = body.value; touch(); grow(); });

      const checklistBox = el('ul', { class: 'nt-checklist' });
      const drawChecklist = (focusId) => {
        if (!n.checklist) { checklistBox.replaceChildren(); return; }
        const rows = [...n.checklist.filter((c) => !c.done), ...n.checklist.filter((c) => c.done)];
        checklistBox.replaceChildren(...rows.map((c) => {
          const input = el('input', { value: c.text, class: c.done ? 'done' : '', 'aria-label': 'Checklist item', enterkeyhint: 'next' });
          input.addEventListener('input', () => { c.text = input.value; touch(); });
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); const next = { id: uid(), text: '', done: false }; n.checklist.splice(n.checklist.indexOf(c) + 1, 0, next); touch(); drawChecklist(next.id); }
            if (e.key === 'Backspace' && !input.value && n.checklist.length > 1) { e.preventDefault(); n.checklist = n.checklist.filter((x) => x !== c); touch(); drawChecklist(); }
          });
          if (c.id === focusId) requestAnimationFrame(() => input.focus());
          return el('li', { class: c.done ? 'done' : '' },
            el('button', { class: 'nt-check', role: 'checkbox', 'aria-checked': String(c.done), 'aria-label': c.done ? 'Uncheck' : 'Check', onclick: () => { c.done = !c.done; touch(); drawChecklist(); } }, c.done ? '✓' : ''),
            input,
            el('button', { class: 'btn small-btn ghost', 'aria-label': 'Remove item', text: '✕', onclick: () => { n.checklist = n.checklist.filter((x) => x !== c); touch(); drawChecklist(); } }));
        }), el('li', {}, el('button', { class: 'btn small-btn ghost', text: '+ Add item', onclick: () => { const c = { id: uid(), text: '', done: false }; n.checklist.push(c); touch(); drawChecklist(c.id); } })));
      };

      const photos = el('div', { class: 'nt-photos' });
      const drawPhotos = () => photos.replaceChildren(
        ...n.photos.map((pid) => el('div', { class: 'nt-photo' },
          el('button', { class: 'nt-photo-open', 'aria-label': 'Open photo', onclick: () => viewPhoto(pid) }, photoImg(pid, '')),
          el('button', { class: 'nt-photo-x', 'aria-label': 'Remove photo', text: '✕', onclick: () => { if (!confirm('Remove this photo?')) return; n.photos = n.photos.filter((x) => x !== pid); idb.del(photoKey(pid)); touch(); drawPhotos(); } }))),
        photoButtons(async (f) => { n.photos.push(await savePhoto(f)); touch(); drawPhotos(); }));

      // Voice memos: record, play back, delete. Kept on this phone (IndexedDB).
      n.memos ??= [];
      const memos = el('div', { class: 'nt-memos' });
      const memoUrls = [];
      const drawMemos = async () => {
        memoUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
        const rows = [];
        for (const [k, m] of n.memos.entries()) {
          const rec = await idb.get(memoKey(m.id));
          const u = rec?.blob ? URL.createObjectURL(rec.blob) : null; if (u) memoUrls.push(u);
          rows.push(el('div', { class: 'card nt-memo' },
            el('div', { class: 'row space' },
              el('strong', { class: 'small', text: `🎙 Memo ${k + 1} · ${clock(m.seconds || 0)}` }),
              el('span', { class: 'small muted', text: new Date(m.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }),
              el('button', { class: 'btn small-btn ghost bad-text', 'aria-label': `Delete memo ${k + 1}`, text: '✕', onclick: () => { if (!confirm('Delete this voice memo?')) return; n.memos = n.memos.filter((x) => x !== m); idb.del(memoKey(m.id)); touch(); drawMemos(); } })),
            u ? el('audio', { controls: true, preload: 'metadata', src: u, class: 'nt-audio' }) : el('p', { class: 'small bad-text', text: 'This memo couldn\'t be found.' })));
        }
        const live = recording?.note === n;
        const timer = el('span', { class: 'nt-rec-time', text: live ? clock(recording.seconds ?? 0) : '' });
        const btn = el('button', { class: `btn${live ? ' nt-recording' : ''}`, 'aria-pressed': String(live), text: live ? '■ Stop' : '● Record a memo', onclick: () => (recording?.note === n ? stopMemo() : recordMemo()) });
        memos.replaceChildren(...rows, el('div', { class: 'row' }, btn, timer));
        if (live) recording.timerEl = timer;
      };
      const recordMemo = async () => {
        if (recording) return;
        try {
          const holder = { note: n, seconds: 0, timerEl: null };
          recording = holder;
          holder.rec = await startRecording((sec) => { holder.seconds = sec; if (holder.timerEl) holder.timerEl.textContent = `● ${clock(sec)}`; });
          drawMemos();
        } catch (err) { recording = null; alert(err.message); drawMemos(); }
      };
      const stopMemo = async () => {
        const holder = recording; if (!holder?.rec) return;
        recording = null;
        const { blob, seconds } = await holder.rec.stop();
        if (blob.size) {
          const m = { id: uid(), at: Date.now(), seconds, type: blob.type };
          await idb.set(memoKey(m.id), { blob, at: m.at });
          holder.note.memos.push(m);
          holder.note.updated = Date.now(); saveNow();
        }
        if (open === holder.note) drawMemos();
      };

      const toggleChecklist = () => {
        if (n.checklist) {
          // Checklist -> text: items become lines.
          const lines = n.checklist.filter((c) => c.text.trim()).map((c) => `${c.done ? '✓ ' : ''}${c.text}`);
          n.body = [n.body, ...lines].filter(Boolean).join('\n');
          n.checklist = null;
        } else {
          // Text -> checklist: each line becomes an item.
          const lines = n.body.split('\n').map((l) => l.trim()).filter(Boolean);
          n.checklist = (lines.length ? lines : ['']).map((t) => ({ id: uid(), text: t.replace(/^[-•*✓]\s*/, ''), done: t.startsWith('✓') }));
          n.body = '';
        }
        touch(); render();
      };
      const share = async () => {
        const text = [n.title, n.checklist ? n.checklist.map((c) => `${c.done ? '☑' : '☐'} ${c.text}`).join('\n') : '', n.body].filter(Boolean).join('\n\n');
        const files = [];
        for (const pid of n.photos) { const rec = await idb.get(photoKey(pid)); if (rec?.full) files.push(new File([rec.full], `photo-${files.length + 1}.jpg`, { type: 'image/jpeg' })); }
        for (const [k, m] of (n.memos ?? []).entries()) { const rec = await idb.get(memoKey(m.id)); if (rec?.blob) files.push(new File([rec.blob], `memo-${k + 1}.${/mp4|aac/.test(rec.blob.type) ? 'm4a' : 'webm'}`, { type: rec.blob.type })); }
        try {
          if (files.length && canShareFiles(files)) { await shareFiles(files, n.title || 'Note'); return; }
          if (navigator.share) { await navigator.share({ title: n.title || 'Note', text }); return; }
          await navigator.clipboard.writeText(text); alert('Copied.');
        } catch (err) { if (err?.name !== 'AbortError') alert(text); }
      };

      pane.replaceChildren(
        el('div', { class: 'row space nt-head' },
          el('button', { class: 'btn small-btn ghost', text: '‹ Notes', onclick: closeNote }),
          el('div', { class: 'row' },
            el('button', { class: `btn small-btn${n.pinned ? ' primary' : ' ghost'}`, text: n.pinned ? '📌 Pinned' : '📌 Pin', onclick: () => { n.pinned = !n.pinned; touch(); render(); } }),
            el('button', { class: 'btn small-btn ghost', text: n.checklist ? '¶ Text' : '☑ Checklist', onclick: toggleChecklist }),
            el('button', { class: 'btn small-btn ghost', text: 'Share', onclick: share }))),
        title, checklistBox, body, el('h3', { text: 'Photos' }), photos, el('h3', { text: 'Voice memos' }), memos,
        el('div', { class: 'row space' },
          el('span', { class: 'muted small', text: `Edited ${new Date(n.updated).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · saved on this phone` }),
          el('button', { class: 'btn small-btn ghost bad-text', text: 'Delete', onclick: () => {
            if (!confirm('Delete this note?')) return;
            for (const pid of n.photos) idb.del(photoKey(pid));
            for (const m of n.memos ?? []) idb.del(memoKey(m.id));
            recording?.rec?.cancel(); recording = null;
            list = list.filter((x) => x !== n); open = null; saveNow(); render();
          } })));
      drawChecklist(focus && n.checklist ? n.checklist[0]?.id : null);
      drawPhotos();
      drawMemos();
      if (startMemo) { startMemo = false; recordMemo(); }
      requestAnimationFrame(grow);
      if (focus && !n.checklist) requestAnimationFrame(() => title.focus());
    }

    async function render(focus = false) {
      await load();
      if (open) renderEditor(focus); else renderList();
    }
    return { render, flush: () => { clearTimeout(saveTimer); if (loaded) saveNow(); } };
  })();

  const onHash = () => { if (location.hash.startsWith('#/notes')) show(); };
  const onHide = () => { if (document.visibilityState === 'hidden') notes.flush(); };
  window.addEventListener('hashchange', onHash);
  document.addEventListener('visibilitychange', onHide);
  show();
  return () => {
    notes.flush();
    window.removeEventListener('hashchange', onHash);
    document.removeEventListener('visibilitychange', onHide);
    for (const u of urls.values()) URL.revokeObjectURL(u);
  };
}
