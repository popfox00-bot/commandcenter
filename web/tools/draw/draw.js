// Draw: a blank canvas to sketch and design on. Pen (with Apple Pencil pressure), marker,
// highlighter and eraser; lines, arrows, boxes and circles; text; colors, sizes and opacity; plain,
// dotted, grid or lined paper. Two fingers pinch to zoom and move the page. Drawings are saved on
// this phone (My drawings) and saved out as PNG to Photos, or to Saved Files (your Google Drive,
// through the Files app's Saved Files) when that's set up. Nothing else leaves the phone.

import { el } from '../../lib/dom.js';
import { idb } from '../../lib/idb.js';
import { canvasToBlob } from '../../lib/image.js';
import { shareFiles, canShareFiles, downloadBlob } from '../../lib/files.js';
import { connectedSecure as savedFiles } from '../../lib/saved-files.js';
import { PAGES, PAPERS, TOOLS, COLORS, newDrawing, addPoint, drawPaper, drawItem, drawInk, createHistory, isShapeTool, normalizeDrawing } from './draw-core.js';

const LIST_KEY = 'draw.list';            // [{ id, name, updated, w, h }]
const DOC_KEY = (id) => `draw.doc.${id}`;
const THUMB_KEY = (id) => `draw.thumb.${id}`;
const PREFS_KEY = 'draw.prefs';
const THUMB = 240;
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function mount(host) {
  host.replaceChildren();
  const root = el('div', { class: 'dr' });
  host.append(root);
  const urls = new Set();
  let cleanup = null;

  // ---------- My drawings ----------

  async function showList() {
    cleanup?.(); cleanup = null;
    const list = (await idb.get(LIST_KEY)) ?? [];
    const grid = el('div', { class: 'dr-grid' });
    const page = el('div', { class: 'chips' }); const paper = el('div', { class: 'chips' });
    let pick = { page: 'portrait', paper: 'plain' };
    const drawChoices = () => {
      page.replaceChildren(...PAGES.map((p) => el('button', { class: `chip${pick.page === p.id ? ' active' : ''}`, text: p.label, onclick: () => { pick = { ...pick, page: p.id }; drawChoices(); } })));
      paper.replaceChildren(...PAPERS.map((p) => el('button', { class: `chip${pick.paper === p.id ? ' active' : ''}`, text: p.label, onclick: () => { pick = { ...pick, paper: p.id }; drawChoices(); } })));
    };
    drawChoices();
    for (const item of [...list].sort((a, b) => b.updated - a.updated)) {
      const img = el('img', { class: 'dr-thumb', alt: '' });
      idb.get(THUMB_KEY(item.id)).then((blob) => { if (blob) { const u = URL.createObjectURL(blob); urls.add(u); img.src = u; } });
      grid.append(el('button', { class: 'dr-card', onclick: () => openDrawing(item.id) },
        img, el('span', { class: 'small dr-card-name', text: item.name }),
        el('span', { class: 'muted small', text: new Date(item.updated).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })));
    }
    root.replaceChildren(
      el('section', { class: 'card dr-new' },
        el('h2', { text: 'New drawing' }),
        el('strong', { class: 'small', text: 'Page' }), page,
        el('strong', { class: 'small', text: 'Paper' }), paper,
        el('button', { class: 'btn primary block', text: '+ New drawing', onclick: () => create(pick) })),
      el('h3', { text: list.length ? 'My drawings' : 'No drawings yet' }),
      grid,
      el('p', { class: 'muted small', text: 'Drawings are saved on this phone only. Save one to Photos or Files from inside it.' }));
  }

  async function create({ page, paper }) {
    const d = newDrawing({ id: uid(), name: `Drawing ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`, page, paper });
    await saveDoc(d);
    openEditor(d);
  }

  async function openDrawing(id) {
    const d = normalizeDrawing(await idb.get(DOC_KEY(id)));
    if (!d) { alert('This drawing could not be opened.'); return; }
    openEditor(d);
  }

  async function saveDoc(d, thumbCanvas = null) {
    d.updated = Date.now();
    await idb.set(DOC_KEY(d.id), d);
    const list = ((await idb.get(LIST_KEY)) ?? []).filter((x) => x.id !== d.id);
    list.push({ id: d.id, name: d.name, updated: d.updated, w: d.w, h: d.h });
    await idb.set(LIST_KEY, list);
    if (thumbCanvas) await idb.set(THUMB_KEY(d.id), await canvasToBlob(thumbCanvas, 'image/png'));
  }

  async function removeDoc(id) {
    await idb.set(LIST_KEY, ((await idb.get(LIST_KEY)) ?? []).filter((x) => x.id !== id));
    await idb.del(DOC_KEY(id)); await idb.del(THUMB_KEY(id));
  }

  // ---------- the canvas ----------

  function openEditor(doc) {
    cleanup?.();
    const prefs = { tool: 'pen', color: '#111111', size: 8, opacity: 1, fill: false, ...safeJson(localStorage.getItem(PREFS_KEY)) };
    const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } };
    const history = createHistory(doc.items);
    // Page-sized layers: paper, ink (everything drawn), and a scratch layer for see-through items.
    const paper = pageCanvas(doc); drawPaper(paper.getContext('2d'), doc);
    const ink = pageCanvas(doc); const inkCtx = ink.getContext('2d');
    const scratch = pageCanvas(doc).getContext('2d');
    const render = () => { doc.items = history.items; drawInk(inkCtx, doc, scratch); };
    render();

    const screen = el('canvas', { class: 'dr-canvas', 'aria-label': 'Drawing canvas' });
    const stage = el('div', { class: 'dr-stage' }, screen);
    const view = { k: 1, x: 0, y: 0 }; // page → screen (CSS px): screen = page * k + (x, y)
    let live = null; // the item being drawn
    let saveTimer = 0;
    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveDoc(doc, thumbnail()), 600);
    };
    const thumbnail = () => {
      const k = THUMB / Math.max(doc.w, doc.h);
      const t = document.createElement('canvas'); t.width = Math.round(doc.w * k); t.height = Math.round(doc.h * k);
      const c = t.getContext('2d'); c.imageSmoothingQuality = 'high'; c.scale(k, k); c.drawImage(paper, 0, 0); c.drawImage(ink, 0, 0);
      return t;
    };
    const commit = (item) => { history.push([...history.items, item]); render(); draw(); updateUndo(); scheduleSave(); };

    // Fit the page into the stage.
    const fit = () => {
      // The page and all the controls fit on the screen without scrolling (the controls take ~330 px).
      const w = stage.clientWidth || 360; const h = Math.max(240, Math.min(window.innerHeight - 330, 900));
      stage.style.height = `${h}px`;
      view.k = Math.min(w / doc.w, h / doc.h) * 0.96;
      view.x = (w - doc.w * view.k) / 2; view.y = (h - doc.h * view.k) / 2;
      draw();
    };
    function draw() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = stage.clientWidth || 360; const h = stage.clientHeight || 480;
      if (screen.width !== Math.round(w * dpr) || screen.height !== Math.round(h * dpr)) { screen.width = Math.round(w * dpr); screen.height = Math.round(h * dpr); screen.style.width = `${w}px`; screen.style.height = `${h}px`; }
      const c = screen.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, screen.width, screen.height);
      c.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
      c.imageSmoothingQuality = 'high';
      c.shadowColor = 'rgba(0,0,0,0.18)'; c.shadowBlur = 12 / view.k; c.fillStyle = doc.background; c.fillRect(0, 0, doc.w, doc.h); c.shadowColor = 'transparent';
      c.drawImage(paper, 0, 0);
      if (live && live.tool === 'eraser') {
        // Show the eraser live: ink with the stroke so far taken out.
        scratch.save(); scratch.setTransform(1, 0, 0, 1, 0, 0); scratch.clearRect(0, 0, doc.w, doc.h); scratch.drawImage(ink, 0, 0); drawItem(scratch, live); scratch.restore();
        c.drawImage(scratch.canvas, 0, 0);
      } else {
        c.drawImage(ink, 0, 0);
        if (live) drawItem(c, live);
      }
    }

    // ---------- pointer input: one pointer draws, two pinch-zoom ----------
    const pointers = new Map();
    let pinch = null;
    const toPage = (e) => { const r = screen.getBoundingClientRect(); return [(e.clientX - r.left - view.x) / view.k, (e.clientY - r.top - view.y) / view.k]; };
    const pressure = (e) => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5);
    screen.addEventListener('pointerdown', (e) => {
      screen.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        live = null; // a second finger: it's a pinch, not a stroke
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, view: { ...view } };
        draw();
        return;
      }
      if (pointers.size > 2) return;
      const [x, y] = toPage(e);
      if (prefs.tool === 'text') { addText(x, y); return; }
      const base = { color: prefs.color, size: prefs.size, opacity: prefs.tool === 'highlighter' ? Math.min(prefs.opacity, 0.4) : prefs.opacity };
      if (isShapeTool(prefs.tool)) live = { t: 'shape', kind: prefs.tool, x1: x, y1: y, x2: x, y2: y, fill: prefs.fill && (prefs.tool === 'rect' || prefs.tool === 'ellipse'), ...base };
      else { live = { t: 'stroke', tool: prefs.tool, pts: [], ...base, size: prefs.tool === 'eraser' ? prefs.size * 3 : prefs.tool === 'highlighter' ? prefs.size * 3 : prefs.size }; addPoint(live.pts, x, y, pressure(e)); }
      draw();
    });
    screen.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const cx = (a[0] + b[0]) / 2; const cy = (a[1] + b[1]) / 2;
        const r = screen.getBoundingClientRect();
        const k = Math.max(0.1, Math.min(8, pinch.view.k * (d / pinch.d)));
        // Keep the page point under the fingers' first midpoint under their current midpoint.
        const px = (pinch.cx - r.left - pinch.view.x) / pinch.view.k; const py = (pinch.cy - r.top - pinch.view.y) / pinch.view.k;
        view.k = k; view.x = cx - r.left - px * k; view.y = cy - r.top - py * k;
        draw();
        return;
      }
      if (!live) return;
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events) {
        const [x, y] = toPage(ev);
        if (live.t === 'shape') { live.x2 = x; live.y2 = y; } else addPoint(live.pts, x, y, pressure(ev), 1.5 / view.k);
      }
      draw();
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; return; }
      if (!live) return;
      const item = live; live = null;
      if (item.t === 'shape' && Math.hypot(item.x2 - item.x1, item.y2 - item.y1) < 4 / view.k) { draw(); return; }
      commit(item);
    };
    screen.addEventListener('pointerup', end);
    screen.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); live = null; pinch = null; draw(); });

    function addText(x, y) {
      const input = el('textarea', { rows: '3', placeholder: 'Type here', 'aria-label': 'Text' });
      const dlg = el('dialog', { class: 'ed-dialog' }, el('div', { class: 'sheet' },
        el('h2', { text: 'Add text' }), input,
        el('div', { class: 'row end' },
          el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => dlg.close() }),
          el('button', { class: 'btn primary', text: 'Add', onclick: () => {
            const text = input.value.trim();
            dlg.close();
            if (text) commit({ t: 'text', x, y, text, color: prefs.color, size: Math.max(24, prefs.size * 6), opacity: prefs.opacity });
          } }))));
      dlg.addEventListener('close', () => dlg.remove());
      document.body.append(dlg);
      dlg.showModal();
      input.focus();
    }

    // ---------- toolbars ----------
    const undoBtn = el('button', { class: 'icon-btn', 'aria-label': 'Undo', text: '↶', onclick: () => { if (history.undo()) { render(); draw(); updateUndo(); scheduleSave(); } } });
    const redoBtn = el('button', { class: 'icon-btn', 'aria-label': 'Redo', text: '↷', onclick: () => { if (history.redo()) { render(); draw(); updateUndo(); scheduleSave(); } } });
    const updateUndo = () => { undoBtn.disabled = !history.canUndo; redoBtn.disabled = !history.canRedo; };
    const name = el('input', { class: 'dr-name', value: doc.name, 'aria-label': 'Drawing name' });
    name.addEventListener('change', () => { doc.name = name.value.trim() || 'Untitled'; scheduleSave(); });
    const tools = el('div', { class: 'chips dr-tools', role: 'toolbar', 'aria-label': 'Tools' });
    const colors = el('div', { class: 'swatches dr-colors' });
    const options = el('div', { class: 'dr-options' });
    const drawTools = () => {
      tools.replaceChildren(...TOOLS.map((t) => el('button', { class: `chip${prefs.tool === t.id ? ' active' : ''}`, 'aria-pressed': String(prefs.tool === t.id), text: `${t.icon} ${t.label}`, onclick: () => { prefs.tool = t.id; savePrefs(); drawTools(); } })));
      const custom = el('input', { type: 'color', value: prefs.color, class: 'swatch-custom', 'aria-label': 'Custom color' });
      custom.addEventListener('input', () => { prefs.color = custom.value; savePrefs(); });
      colors.replaceChildren(...COLORS.map((c) => el('button', { class: `swatch${prefs.color === c ? ' active' : ''}`, style: { background: c }, 'aria-label': `Color ${c}`, onclick: () => { prefs.color = c; savePrefs(); drawTools(); } })), custom);
      const size = el('input', { type: 'range', min: '1', max: '60', value: String(prefs.size), 'aria-label': 'Size' });
      size.addEventListener('input', () => { prefs.size = Number(size.value); savePrefs(); });
      const opacity = el('input', { type: 'range', min: '10', max: '100', value: String(Math.round(prefs.opacity * 100)), 'aria-label': 'Opacity' });
      opacity.addEventListener('input', () => { prefs.opacity = Number(opacity.value) / 100; savePrefs(); });
      options.replaceChildren(...[
        el('label', { class: 'field' }, el('span', { text: 'Size' }), size),
        el('label', { class: 'field' }, el('span', { text: 'Opacity' }), opacity),
        prefs.tool === 'rect' || prefs.tool === 'ellipse'
          ? el('button', { class: `chip${prefs.fill ? ' active' : ''}`, text: prefs.fill ? '■ Filled' : '□ Outline', onclick: () => { prefs.fill = !prefs.fill; savePrefs(); drawTools(); } })
          : null,
      ].filter(Boolean));
    };
    drawTools(); updateUndo();

    async function pngFile() {
      const out = pageCanvas(doc); const c = out.getContext('2d');
      c.drawImage(paper, 0, 0); c.drawImage(ink, 0, 0);
      const blob = await canvasToBlob(out, 'image/png');
      return new File([blob], `${(doc.name || 'drawing').replace(/[\\/:*?"<>|]+/g, '-')}.png`, { type: 'image/png' });
    }
    async function exportPng() {
      const file = await pngFile();
      if (canShareFiles([file])) { try { await shareFiles([file], doc.name); } catch { /* cancelled */ } } else downloadBlob(file, file.name);
    }
    const saveNote = el('p', { class: 'small', 'aria-live': 'polite' });
    async function saveToFiles() {
      const api = savedFiles();
      if (!api) {
        if (confirm('Saved Files isn\'t connected on this phone yet. Connect it now in Settings?')) { clearTimeout(saveTimer); await saveDoc(doc, thumbnail()); location.hash = '#/settings'; }
        return;
      }
      saveNote.className = 'small muted'; saveNote.textContent = 'Saving to Saved Files…';
      try {
        const f = await api.upload(await pngFile(), 'Draw');
        saveNote.className = 'small ok-text'; saveNote.textContent = `Saved "${f.name}" to Saved Files.`;
      } catch (err) { saveNote.className = 'small bad-text'; saveNote.textContent = err.message; }
    }
    async function more() {
      const dlg = el('dialog', { class: 'ed-dialog' }, el('div', { class: 'sheet' },
        el('h2', { text: doc.name }),
        el('button', { class: 'btn block', text: 'Duplicate', onclick: async () => { dlg.close(); const copy = { ...structuredClone(doc), id: uid(), name: `${doc.name} copy` }; await saveDoc(copy, thumbnail()); openEditor(copy); } }),
        el('button', { class: 'btn block', text: 'Clear page', onclick: () => { dlg.close(); if (history.items.length && confirm('Clear the whole page? (Undo brings it back.)')) { history.push([]); render(); draw(); updateUndo(); scheduleSave(); } } }),
        el('button', { class: 'btn block bad-text', text: 'Delete drawing', onclick: async () => { dlg.close(); if (confirm(`Delete "${doc.name}"?`)) { clearTimeout(saveTimer); await removeDoc(doc.id); showList(); } } }),
        el('button', { class: 'btn ghost block', text: 'Close', onclick: () => dlg.close() })));
      dlg.addEventListener('close', () => dlg.remove());
      document.body.append(dlg);
      dlg.showModal();
    }

    root.replaceChildren(
      el('div', { class: 'row space dr-top' },
        el('button', { class: 'btn small-btn ghost', text: '‹ Drawings', onclick: async () => { clearTimeout(saveTimer); await saveDoc(doc, thumbnail()); showList(); } }),
        name,
        el('div', { class: 'row' }, undoBtn, redoBtn)),
      stage, tools, colors, options,
      el('div', { class: 'row wrap dr-actions' },
        el('button', { class: 'btn primary', text: 'Save image', onclick: exportPng }),
        el('button', { class: 'btn', text: '☁️ Save to Files', onclick: saveToFiles }),
        el('button', { class: 'btn small-btn ghost', text: 'Fit page', onclick: fit }),
        el('button', { class: 'btn small-btn ghost', text: '⋯ More', onclick: more })),
      saveNote,
      el('p', { class: 'muted small', text: 'One finger draws (Apple Pencil pressure works with the pen); two fingers zoom and move the page. Saved on this phone as you go.' }));
    requestAnimationFrame(() => { window.scrollTo(0, 0); fit(); });
    const onResize = () => fit();
    window.addEventListener('resize', onResize);
    const flush = () => { if (document.visibilityState === 'hidden') { clearTimeout(saveTimer); saveDoc(doc, thumbnail()); } };
    document.addEventListener('visibilitychange', flush);
    cleanup = () => {
      clearTimeout(saveTimer); saveDoc(doc, thumbnail());
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', flush);
    };
  }

  showList();
  return () => { cleanup?.(); for (const u of urls) URL.revokeObjectURL(u); };
}

function pageCanvas(d) { const c = document.createElement('canvas'); c.width = d.w; c.height = d.h; return c; }
function safeJson(s) { try { return JSON.parse(s) ?? {}; } catch { return {}; } }
