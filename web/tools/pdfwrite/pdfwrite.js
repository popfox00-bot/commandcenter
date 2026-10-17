// Write on PDF: type text (fill in forms), sign/draw, check and cross marks, boxes, highlight and
// white-out. Pages are shown with pdf.js; saving writes into the original PDF with pdf-lib, so the
// existing content is not rasterized. Everything stays on this device.
import { el, store } from '../../lib/dom.js';
import { idb } from '../../lib/idb.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes, renameExt } from '../../lib/files.js';
import { openPdf, closePdf } from '../../lib/pdf-reader.js';
import { createHistory } from '../editor/state.js';
import { drawPage, hitTest, applyToPdf, displaySize, moveItem, FONT_STACK } from './annotate.js';
import { KINDS, loadSignature, drawSignature, signItem } from './signature.js';

const SAVE_KEY = 'pdfwrite.session';
const PREFS_KEY = 'cc.pdfwrite.prefs';
const COLORS = ['#111111', '#0a3fd1', '#d70015'];
const TOOLS = [
  ['scroll', '✋', 'Scroll'], ['text', 'T', 'Text'], ['signature', '✒️', 'Signature'], ['initials', '✒', 'Initials'], ['ink', '✍', 'Draw'], ['check', '✓', 'Check'],
  ['cross', '✗', 'Cross'], ['box', '▭', 'Box'], ['highlight', '▮', 'Highlight'], ['whiteout', '⬜', 'White-out'], ['eraser', '⌫', 'Eraser'],
];
const DRAWING = new Set(['ink', 'box', 'highlight', 'whiteout']);

let pdfLibPromise;
const loadPdfLib = () => (pdfLibPromise ??= import('../../vendor/pdf-lib/pdf-lib.esm.min.js'));

/** mount(host, { file }) — `file` opens that PDF right away (e.g. from the converter). */
export function mount(host, { file: initialFile } = {}) {
  const prefs = { tool: 'text', color: '#111111', textSize: 12, inkWidth: 1.6, markSize: 14, signHeight: 34, initialsHeight: 22, ...store.json(PREFS_KEY, {}) };
  const savePrefs = () => store.set(PREFS_KEY, JSON.stringify(prefs));

  let file = null; let fileName = 'document.pdf'; let bytes = null;
  let doc = null; let pages = []; // [{ info, node, base, overlay, rendered }]
  let history = null; let saveTimer = 0; let observer = null;
  let drag = null; let draft = null;
  let toolbar; let undoBtn; let redoBtn; let pagesBox; let scroller; let zoomLabel;
  let zoom = 1; let pinch = null; let zoomTimer = 0;
  const touches = new Map(); // pointerId -> {x, y} for two-finger zoom
  const ZOOMS = [1, 1.5, 2, 3, 4];
  const items = () => history.state;

  // ---------- open ----------

  function showStart(saved) {
    const input = el('input', { type: 'file', accept: 'application/pdf,.pdf', class: 'visually-hidden', id: 'pw-file' });
    input.addEventListener('change', () => { if (input.files[0]) open(input.files[0]); input.value = ''; });
    host.replaceChildren(...[
      saved ? el('section', { class: 'card resume' },
        el('strong', { text: `Continue with ${saved.name}?` }),
        el('span', { class: 'muted small', text: `Saved on this phone ${new Date(saved.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` }),
        el('div', { class: 'row' },
          el('button', { class: 'btn primary', text: 'Continue', onclick: () => open(saved.blob, saved.name, saved.items) }),
          el('button', { class: 'btn ghost', text: 'Discard', onclick: () => { idb.del(SAVE_KEY); showStart(null); } }))) : null,
      el('div', { class: 'drop' },
        el('label', { class: 'btn primary block', for: 'pw-file', text: 'Choose a PDF' }),
        el('p', { class: 'muted small center', text: 'Fill in forms, sign, check boxes, highlight or white-out. The original pages stay sharp and their text stays selectable.' })),
      input,
    ].filter(Boolean));
  }

  async function open(blob, name = blob.name || 'document.pdf', restored = null) {
    host.replaceChildren(el('p', { class: 'muted center', text: 'Opening…' }));
    try {
      bytes = new Uint8Array(await blob.arrayBuffer());
      if (doc) await closePdf(doc);
      doc = await openPdf(new Blob([bytes]));
      file = blob; fileName = name;
      history = createHistory(Array.isArray(restored) ? restored : []);
      await build();
      if (!restored) persist(true);
      // Check early whether the file can be saved (pdf-lib refuses protected PDFs).
      loadPdfLib().then((lib) => lib.PDFDocument.load(bytes, { updateMetadata: false })).catch((err) => {
        if (/encrypt/i.test(err.message)) banner('This PDF is password-protected: you can draw on it here, but it can\'t be saved. Remove the password first.');
      });
    } catch (err) {
      host.replaceChildren(el('p', { class: 'bad-text', text: err.message }), el('button', { class: 'btn', text: 'Back', onclick: () => showStart(null) }));
    }
  }

  function banner(text) {
    host.querySelector('.pw-banner')?.remove();
    toolbar.after(el('p', { class: 'pw-banner bad-text small', text }));
  }

  // ---------- layout ----------

  async function build() {
    undoBtn = el('button', { class: 'icon-btn', 'aria-label': 'Undo', text: '↶', onclick: () => { if (history.undo()) changed(); } });
    redoBtn = el('button', { class: 'icon-btn', 'aria-label': 'Redo', text: '↷', onclick: () => { if (history.redo()) changed(); } });
    toolbar = el('div', { class: 'pw-toolbar' });
    pagesBox = el('div', { class: 'pw-pages' });
    scroller = el('div', { class: 'pw-scroll' }, pagesBox);
    bindZoom();
    host.replaceChildren(
      el('div', { class: 'ed-top' },
        el('button', { class: 'icon-btn', 'aria-label': 'Close PDF', text: '✕', onclick: closeDoc }),
        el('div', { class: 'ed-top-mid' }, undoBtn, redoBtn),
        el('button', { class: 'btn primary small-btn', text: 'Done', onclick: openExport })),
      el('p', { class: 'muted small pw-name', text: `${fileName} · ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}` }),
      toolbar, scroller);
    zoom = 1;
    applyZoom(1);
    renderToolbar();

    pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const [x0, y0, x1, y1] = page.view;
      const info = { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rotate: page.rotate };
      const base = el('canvas', { class: 'pw-base' });
      const overlay = el('canvas', { class: 'pw-overlay' });
      const node = el('div', { class: 'pw-page', 'data-page': String(n - 1) }, base, overlay, el('span', { class: 'pw-num small', text: String(n) }));
      node.style.aspectRatio = `${vp.width} / ${vp.height}`;
      pagesBox.append(node);
      pages.push({ index: n - 1, info, node, base, overlay, rendered: 0 });
      bindPointer(pages[n - 1]);
    }
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) renderPage(pages[Number(e.target.dataset.page)]);
    }, { rootMargin: '800px 0px' });
    for (const p of pages) observer.observe(p.node);
    updateTouch();
    changed(false);
  }

  function renderToolbar() {
    const sizeControl = () => {
      if (prefs.tool === 'text') return sizeSelect('Text size', prefs.textSize, [8, 9, 10, 11, 12, 14, 16, 18, 24, 32], 'pt', (v) => { prefs.textSize = v; });
      if (prefs.tool === 'ink') return sizeSelect('Pen', prefs.inkWidth, [0.8, 1.2, 1.6, 2.4, 3.5], 'pt', (v) => { prefs.inkWidth = v; });
      if (prefs.tool === 'check' || prefs.tool === 'cross') return sizeSelect('Mark size', prefs.markSize, [8, 10, 12, 14, 18, 24], 'pt', (v) => { prefs.markSize = v; });
      if (prefs.tool === 'signature') return sizeSelect('Signature height', prefs.signHeight, [20, 26, 34, 44, 56], 'pt', (v) => { prefs.signHeight = v; });
      if (prefs.tool === 'initials') return sizeSelect('Initials height', prefs.initialsHeight, [14, 18, 22, 28, 36], 'pt', (v) => { prefs.initialsHeight = v; });
      return null;
    };
    const signing = prefs.tool === 'signature' || prefs.tool === 'initials';
    const saved = signing ? loadSignature(prefs.tool) : null;
    const hint = {
      scroll: 'Scroll mode: swipe to move through the pages.', text: 'Tap to type. Tap text to edit it, or drag it to move it.',
      ink: 'Draw with your finger.', check: 'Tap to place a check mark.', cross: 'Tap to place a cross.',
      box: 'Drag to draw a box.', highlight: 'Drag over text to highlight it.', whiteout: 'Drag to cover something with white.',
      eraser: 'Tap anything you added to remove it.',
      signature: saved ? 'Tap where your signature goes. Drag a placed signature to move it.' : 'Tap "Draw signature" once; it is saved on this phone.',
      initials: saved ? 'Tap where your initials go. Drag placed initials to move them.' : 'Tap "Draw initials" once; it is saved on this phone.',
    }[prefs.tool];
    toolbar.replaceChildren(...[
      el('div', { class: 'chips' }, ...TOOLS.map(([id, icon, label]) => el('button', {
        class: `chip${prefs.tool === id ? ' active' : ''}`, text: `${icon} ${label}`,
        onclick: () => { prefs.tool = id; savePrefs(); renderToolbar(); updateTouch(); },
      }))),
      ['text', 'ink', 'check', 'cross', 'box', 'signature', 'initials'].includes(prefs.tool) ? el('div', { class: 'ed-row' },
        el('div', { class: 'swatches' }, ...COLORS.map((c) => el('button', {
          class: `swatch${prefs.color === c ? ' active' : ''}`, style: { background: c }, 'aria-label': `Color ${c}`,
          onclick: () => { prefs.color = c; savePrefs(); renderToolbar(); },
        }))), sizeControl()) : null,
      signing ? el('button', {
        class: `btn small-btn${saved ? ' ghost' : ' primary'}`, text: saved ? `Redraw ${KINDS[prefs.tool].label.toLowerCase()}` : `Draw ${KINDS[prefs.tool].label.toLowerCase()}`,
        onclick: () => drawSignature(prefs.tool).then(() => renderToolbar()),
      }) : null,
      el('div', { class: 'ed-row' },
        el('p', { class: 'muted small pw-hint', text: hint }),
        el('div', { class: 'pw-zoom' },
          el('button', { class: 'icon-btn small-btn', 'aria-label': 'Zoom out', text: '−', onclick: () => stepZoom(-1) }),
          zoomLabel = el('button', { class: 'linkish small', 'aria-label': 'Fit width', text: `${Math.round(zoom * 100)}%`, onclick: () => setZoom(1) }),
          el('button', { class: 'icon-btn small-btn', 'aria-label': 'Zoom in', text: '+', onclick: () => stepZoom(1) }))),
    ].filter(Boolean));
  }

  function sizeSelect(label, value, options, unit, set) {
    const s = el('select', { 'aria-label': label }, ...options.map((o) => el('option', { value: String(o), text: `${o} ${unit}`, selected: o === value })));
    s.addEventListener('change', () => { set(Number(s.value)); savePrefs(); });
    return s;
  }

  /** Drawing tools capture touches; Scroll lets the finger scroll the page. */
  function updateTouch() {
    for (const p of pages) p.overlay.classList.toggle('capture', prefs.tool !== 'scroll');
  }

  async function renderPage(p) {
    const cssW = p.node.clientWidth;
    if (!cssW) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (p.rendered === cssW) return;
    p.rendered = cssW;
    try {
      const page = await doc.getPage(p.index + 1);
      const vp1 = page.getViewport({ scale: 1 });
      // Sharp at the current zoom, but within iOS canvas limits (4096 px wide, 16.7 MP).
      let scale = Math.min(cssW * dpr, 4096) / vp1.width;
      scale = Math.min(scale, Math.sqrt(16e6 / (vp1.width * vp1.height)));
      const vp = page.getViewport({ scale });
      const c = p.base;
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: '#ffffff' }).promise;
      p.overlay.width = c.width; p.overlay.height = c.height;
      drawOverlay(p);
    } catch { p.rendered = 0; }
  }

  // ---------- zoom ----------

  function applyZoom(z, focus) {
    const old = { w: pagesBox.offsetWidth, h: pagesBox.offsetHeight };
    const top = pagesBox.getBoundingClientRect().top + window.scrollY;
    // Keep the content under the fingers (or the screen center) where it is.
    const fx = focus ? (scroller.scrollLeft + focus.x - scroller.getBoundingClientRect().left) / (old.w || 1) : null;
    const fy = focus ? (window.scrollY + focus.y - top) / (old.h || 1) : null;
    zoom = z;
    pagesBox.style.width = `${z * 100}%`;
    if (focus && old.w) {
      scroller.scrollLeft = fx * pagesBox.offsetWidth - (focus.x - scroller.getBoundingClientRect().left);
      window.scrollTo(window.scrollX, top + fy * pagesBox.offsetHeight - focus.y);
    }
    if (zoomLabel) zoomLabel.textContent = `${Math.round(z * 100)}%`;
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(rerenderVisible, 220);
  }

  function setZoom(z, focus) { applyZoom(Math.min(4, Math.max(1, z)), focus); }

  function stepZoom(dir) {
    const next = dir > 0 ? ZOOMS.find((z) => z > zoom + 0.01) ?? 4 : [...ZOOMS].reverse().find((z) => z < zoom - 0.01) ?? 1;
    setZoom(next, { x: innerWidth / 2, y: innerHeight / 2 });
  }

  function rerenderVisible() {
    for (const p of pages) {
      const r = p.node.getBoundingClientRect();
      if (r.bottom > -innerHeight * 2 && r.top < innerHeight * 3) renderPage(p);
    }
  }

  /** Two fingers anywhere on the pages zoom, in every mode (a second finger cancels a stroke). */
  function bindZoom() {
    const dist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const mid = () => { const [a, b] = [...touches.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    scroller.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        if (drag?.kind === 'move') history.replace(drag.before);
        drag = null; draft = null;
        for (const p of pages) if (p.rendered) drawOverlay(p);
        pinch = { d0: dist(), z0: zoom };
      }
    }, true);
    scroller.addEventListener('pointermove', (e) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) setZoom(pinch.z0 * (dist() / pinch.d0), mid());
    }, true);
    const up = (e) => {
      touches.delete(e.pointerId);
      if (touches.size < 2 && pinch) pinch = touches.size ? { ended: true } : null;
      if (!touches.size) pinch = null;
    };
    scroller.addEventListener('pointerup', up, true);
    scroller.addEventListener('pointercancel', up, true);
    // Trackpad pinch on a computer arrives as ctrl+wheel.
    scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(zoom * Math.exp(-e.deltaY / 200), { x: e.clientX, y: e.clientY });
    }, { passive: false });
  }

  function drawOverlay(p) {
    const ctx = p.overlay.getContext('2d');
    ctx.clearRect(0, 0, p.overlay.width, p.overlay.height);
    const list = items().filter((it) => it.page === p.index);
    if (draft && draft.page === p.index) list.push(draft);
    drawPage(ctx, list, p.info, p.overlay.width, p.overlay.height);
  }

  function changed(save = true) {
    undoBtn.disabled = !history.canUndo;
    redoBtn.disabled = !history.canRedo;
    for (const p of pages) if (p.rendered) drawOverlay(p);
    if (save) persist();
  }

  function commit(next) { if (history.push(next)) changed(); }

  function persist(now = false) {
    clearTimeout(saveTimer);
    const write = () => idb.set(SAVE_KEY, { name: fileName, blob: file, items: items(), savedAt: Date.now() });
    if (now) write(); else saveTimer = setTimeout(write, 400);
  }

  // ---------- pointer ----------

  function bindPointer(p) {
    const pos = (e) => {
      const r = p.overlay.getBoundingClientRect();
      return { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height, r };
    };
    const tolPt = (r) => (14 * displaySize(p.info).w) / r.width; // ~14 css px in points

    p.overlay.addEventListener('pointerdown', (e) => {
      if (pinch) return; // second finger of a zoom gesture
      const tool = prefs.tool;
      if (tool === 'scroll') return;
      const q = pos(e);
      const list = items();
      if (tool === 'eraser') {
        drag = { kind: 'tap', start: q, action: () => {
          const i = hitTest(items(), p.index, q.u, q.v, p.info, tolPt(q.r));
          if (i >= 0) commit(items().filter((_, j) => j !== i));
        } };
        p.overlay.setPointerCapture(e.pointerId);
        return;
      }
      if (tool === 'signature' || tool === 'initials') {
        const i = hitTest(list, p.index, q.u, q.v, p.info, tolPt(q.r));
        if (i >= 0 && list[i].type === 'sign') {
          drag = { kind: 'move', i, start: q, orig: list[i], moved: false, before: list };
        } else {
          drag = { kind: 'tap', start: q, action: () => {
            const place = (sig) => { if (sig) commit([...items(), signItem(sig, p.index, p.info, q.u, q.v, tool === 'initials' ? prefs.initialsHeight : prefs.signHeight, prefs.color)]); };
            const sig = loadSignature(tool);
            if (sig) place(sig); else drawSignature(tool).then((s2) => { renderToolbar(); place(s2); });
          } };
        }
      } else if (tool === 'text') {
        const i = hitTest(list, p.index, q.u, q.v, p.info, tolPt(q.r));
        if (i >= 0 && list[i].type === 'text') {
          drag = { kind: 'move', i, start: q, orig: list[i], moved: false, before: list };
        } else {
          drag = { kind: 'tap', start: q, action: () => askText({ page: p.index, type: 'text', u: q.u, v: q.v - (prefs.textSize * 0.5) / displaySize(p.info).h, text: '', size: prefs.textSize, color: prefs.color }, -1) };
        }
      } else if (tool === 'check' || tool === 'cross') {
        const { w, h } = displaySize(p.info);
        drag = { kind: 'tap', start: q, action: () => commit([...items(), { page: p.index, type: tool, u: q.u - prefs.markSize / 2 / w, v: q.v - prefs.markSize / 2 / h, size: prefs.markSize, color: prefs.color }]) };
      } else if (tool === 'ink') {
        draft = { page: p.index, type: 'ink', points: [[q.u, q.v]], width: prefs.inkWidth, color: prefs.color };
        drag = { kind: 'draw' };
      } else if (DRAWING.has(tool)) {
        draft = { page: p.index, type: tool, u1: q.u, v1: q.v, u2: q.u, v2: q.v, color: prefs.color, width: 1.5 };
        drag = { kind: 'draw' };
      }
      p.overlay.setPointerCapture(e.pointerId);
      e.preventDefault();
      drawOverlay(p);
    });
    p.overlay.addEventListener('pointermove', (e) => {
      if (!drag || pinch) return;
      const q = pos(e);
      if (drag.kind === 'tap') {
        if (Math.hypot((q.u - drag.start.u) * q.r.width, (q.v - drag.start.v) * q.r.height) > 10) drag.cancelled = true;
      } else if (drag.kind === 'move') {
        const du = q.u - drag.start.u; const dv = q.v - drag.start.v;
        if (Math.hypot(du * q.r.width, dv * q.r.height) > 4) drag.moved = true;
        if (!drag.moved) return;
        const next = items().map((it, j) => (j === drag.i ? moveItem(drag.orig, du, dv) : it));
        history.replace(next);
        drawOverlay(p);
      } else if (draft) {
        if (draft.points) {
          const [lu, lv] = draft.points[draft.points.length - 1];
          if (Math.hypot((q.u - lu) * q.r.width, (q.v - lv) * q.r.height) > 1.5) draft.points.push([q.u, q.v]);
        } else { draft.u2 = q.u; draft.v2 = q.v; }
        drawOverlay(p);
      }
    });
    const end = () => {
      if (!drag) return;
      if (drag.kind === 'tap') {
        if (!drag.cancelled && !pinch) drag.action();
      } else if (drag.kind === 'move') {
        const next = items();
        history.replace(drag.before);
        if (drag.moved) commit(next);
        else if (drag.orig.type === 'text') askText(drag.before[drag.i], drag.i);
      } else if (draft) {
        const it = draft;
        draft = null;
        const tiny = !it.points && Math.hypot(it.u2 - it.u1, it.v2 - it.v1) < 0.004;
        if (!tiny) commit([...items(), it]); else drawOverlay(p);
      }
      drag = null;
    };
    p.overlay.addEventListener('pointerup', end);
    p.overlay.addEventListener('pointercancel', end);
  }

  /** Add (index -1) or edit a text item. Empty text deletes it. */
  function askText(item, index) {
    const area = el('textarea', { rows: '3', class: 'ed-textarea', placeholder: 'Type here' });
    area.value = item.text;
    area.style.fontFamily = FONT_STACK;
    const dlg = el('dialog', { class: 'ed-dialog' }, el('form', { method: 'dialog', class: 'sheet' },
      el('h2', { text: index < 0 ? 'Add text' : 'Edit text' }), area,
      el('div', { class: 'row end' },
        index >= 0 ? el('button', { class: 'btn ghost', value: 'delete', text: 'Delete' }) : null,
        el('button', { class: 'btn ghost', value: 'cancel', text: 'Cancel' }),
        el('button', { class: 'btn primary', value: 'ok', text: index < 0 ? 'Add' : 'Save' }))));
    dlg.addEventListener('close', () => {
      const text = area.value.replace(/\s+$/, '');
      const list = items();
      if (dlg.returnValue === 'delete' || (dlg.returnValue === 'ok' && !text && index >= 0)) commit(list.filter((_, j) => j !== index));
      else if (dlg.returnValue === 'ok' && text) {
        const next = { ...item, text };
        commit(index < 0 ? [...list, next] : list.map((it, j) => (j === index ? next : it)));
      }
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
    area.focus();
  }

  // ---------- close / save ----------

  function closeDoc() {
    if (items().length && !window.confirm('Close this PDF? What you added will be discarded.')) return;
    idb.del(SAVE_KEY);
    teardown();
    showStart(null);
  }

  function openExport() {
    const status = el('p', { class: 'muted small', text: 'Preparing…' });
    const shareBtn = el('button', { class: 'btn primary', text: 'Share', disabled: true });
    const saveBtn = el('button', { class: 'btn', text: 'Save', disabled: true });
    const dlg = el('dialog', { class: 'ed-dialog' }, el('div', { class: 'sheet' },
      el('h2', { text: 'Save PDF' }), status,
      el('div', { class: 'row end' }, el('button', { class: 'btn ghost', text: 'Close', onclick: () => dlg.close() }), saveBtn, shareBtn)));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    loadPdfLib()
      .then((lib) => applyToPdf(lib, bytes, items()))
      .then(({ bytes: out, replacedChars }) => {
        const name = renameExt(fileName, 'pdf', '-signed');
        const blob = new Blob([out], { type: 'application/pdf' });
        const f = new File([blob], name, { type: 'application/pdf' });
        status.textContent = `${name} · ${formatBytes(blob.size)}${replacedChars ? ` · ${replacedChars} character(s) the PDF font can't show were replaced with "?"` : ''}`;
        saveBtn.disabled = false;
        saveBtn.onclick = () => downloadBlob(blob, name);
        shareBtn.hidden = !canShareFiles([f]);
        shareBtn.disabled = false;
        shareBtn.onclick = () => shareFiles([f], name).catch((e) => { status.textContent = e.message; });
      })
      .catch((err) => {
        status.textContent = /encrypt/i.test(err.message)
          ? 'This PDF is password-protected and can\'t be saved with changes. Remove the password, then try again.'
          : `Could not save: ${err.message}`;
        status.className = 'bad-text small';
      });
  }

  function teardown() {
    clearTimeout(saveTimer);
    observer?.disconnect(); observer = null;
    if (doc) { closePdf(doc); doc = null; }
    pages = [];
  }

  const onResize = () => { for (const p of pages) if (p.rendered) renderPage(p); };
  window.addEventListener('resize', onResize);

  if (initialFile) open(initialFile);
  else idb.get(SAVE_KEY).then((saved) => showStart(saved?.blob ? saved : null));

  const unmount = () => {
    if (history && file) persist(true);
    window.removeEventListener('resize', onResize);
    teardown();
  };
  unmount.openFile = (blob, name) => {
    if (history && items().length && !window.confirm('Open the new PDF? What you added to the current one will be discarded.')) return false;
    teardown();
    open(blob, name);
    return true;
  };
  /** Pages measure 0 wide while the tab is hidden; re-render the visible ones when it is shown. */
  unmount.show = () => { for (const p of pages) if (p.node.getBoundingClientRect().top < innerHeight * 2) renderPage(p); };
  return unmount;
}
