// Photo Editor UI. Everything runs on this device; the original photo is never modified.
import { el, store } from '../../lib/dom.js';
import { idb } from '../../lib/idb.js';
import { sniffType, decodeImage, fitSize, drawToCanvas, encodeCanvas } from '../../lib/image.js';
import { renderEdited, loadFullRenderer } from './render-file.js';
import { AUTO_CROP_DEFAULTS, detectAutoCrop } from './autocrop.js';
import { mountBatch, barColorsPicker } from './batch.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes, renameExt } from '../../lib/files.js';
import { Renderer } from './renderer.js';
import { ADJUSTMENTS, FILTERS, RATIOS, defaultState, normalizeState, createHistory, autoAdjust, isDefault } from './state.js';
import { FULL_CROP, orientedSize, outputPixelSize, outputToSource, apply, cropForRatio, dragCrop, rotateClockwise, flipHorizontal } from './geometry.js';
import { COLORS, viewTransform, drawMarkup, hitTest } from './markup.js';
import { applyPatches, makePatch } from './retouch.js';
import { strokeMask, cleanUp, cloneFrom } from './cleanup.js';
import { levelTurn, mainFace } from '../../lib/face-core.js';

const PREVIEW_MAX = 2048;
const THUMB_MAX = 200;
const SAVE_KEY = 'editor.session';
const PREFS_KEY = 'cc.editor.prefs';
const MODES = [['adjust', 'Adjust'], ['filters', 'Filters'], ['crop', 'Crop'], ['markup', 'Markup'], ['cleanup', 'Clean Up']];
const TOOLS = [
  ['pen', '✎', 'Pen'], ['highlighter', '▬', 'Highlighter'], ['line', '╱', 'Line'], ['arrow', '➚', 'Arrow'],
  ['rect', '▭', 'Box'], ['ellipse', '◯', 'Oval'], ['text', 'T', 'Text'], ['eraser', '⌫', 'Eraser'],
];

/** mount(host, { file }) — `file` opens that photo right away (e.g. sent from the converter). */
export function mount(host, { file: initialFile, onFaceSwap = null } = {}) {
  const prefs = { tool: 'pen', color: '#ff3b30', size: 0.008, cleanSize: 22, exportType: 'image/jpeg', exportQuality: 0.92, exportMax: 0, autoCropColors: [...AUTO_CROP_DEFAULTS.colors], ...store.json(PREFS_KEY, {}) };
  delete prefs.autoCropColor;
  const savePrefs = () => store.set(PREFS_KEY, JSON.stringify(prefs));

  let file = null;            // original File/Blob
  let fileName = 'photo.jpg';
  let source = null;          // preview source canvas
  let renderer = null;
  let history = null;
  let mode = 'adjust';
  let activeAdjust = 'exposure';
  let comparing = false;
  let raf = 0;
  let shownPatches = null;    // the retouch patches painted on the renderer's source
  let saveTimer = 0;
  let edits = 0;              // counts changes (with the photo opened), so a hand-off can tell if it's new
  let drag = null;            // active pointer interaction
  let draft = null;           // markup item being drawn
  // Clean Up: the stroke being drawn (overlay pixels), Copy From Area (on, and the spot to copy from in
  // source pixels), the last clean-up (to redo it as a copy), and a note for the panel.
  let cleanStroke = null; let copyMode = false; let copyFrom = null; let lastClean = null; let cleanNote = ''; let cleaning = false;
  const cleanups = [];

  const state = () => history.state;

  // ---------- screens ----------

  function showStart(saved) {
    const input = el('input', { type: 'file', accept: 'image/*,.heic,.heif', multiple: true, class: 'visually-hidden', id: 'ed-file' });
    input.addEventListener('change', () => {
      const files = [...input.files];
      input.value = '';
      if (files.length === 1) openFile(files[0]);
      else if (files.length > 1) openBatch(files);
    });
    const resume = saved ? el('section', { class: 'card resume' },
      el('strong', { text: `Continue editing ${saved.name}?` }),
      el('span', { class: 'muted small', text: `Saved on this phone ${new Date(saved.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` }),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', text: 'Continue', onclick: () => openFile(saved.blob, saved.name, normalizeState(saved.state)) }),
        el('button', { class: 'btn ghost', text: 'Discard', onclick: () => { idb.del(SAVE_KEY); showStart(null); } }))) : null;
    host.replaceChildren(...[
      resume,
      el('div', { class: 'drop' },
        el('label', { class: 'btn primary block', for: 'ed-file', text: 'Choose photos' }),
        el('p', { class: 'muted small center', text: 'Pick one photo to edit it, or many to edit them all at once (Auto-Crop, filters, light and color, size). Your originals are never changed, and nothing leaves this phone.' })),
      input,
    ].filter(Boolean));
  }

  /** Several photos: the bulk editor. "Edit one" opens a single photo in the full editor. */
  function openBatch(files) {
    teardown();
    const stop = mountBatch(host, files, {
      prefs, savePrefs,
      onExit: () => { stop(); showStart(null); },
      // `check`: a state whose crop Auto-Crop wasn't sure of: open with the crop handles on it.
      onEditOne: (f, check = null) => { stop(); openFile(f, f.name, check, check ? 'crop' : null); },
    });
    cleanups.push(stop);
  }

  async function openFile(blob, name = blob.name || 'photo.jpg', restored = null, startMode = null) {
    host.replaceChildren(el('p', { class: 'muted center', text: 'Opening…' }));
    try {
      const type = await sniffType(blob);
      const bitmap = await decodeImage(blob, type);
      const fit = fitSize(bitmap.width, bitmap.height, PREVIEW_MAX);
      source = drawToCanvas(bitmap, fit.width, fit.height, null);
      bitmap.close?.();
      file = blob;
      fileName = name;
      history = createHistory(restored ?? defaultState());
      if (startMode) mode = startMode;
      buildEditor();
      if (!restored) persist(true);
    } catch (err) {
      host.replaceChildren(el('p', { class: 'bad-text', text: err.message }), el('button', { class: 'btn', text: 'Back', onclick: () => showStart(null) }));
    }
  }

  // ---------- editor layout ----------

  let glCanvas; let overlay; let stage; let panel; let undoBtn; let redoBtn; let modeBar; let thumbs = null;

  function buildEditor() {
    glCanvas = el('canvas', { class: 'ed-canvas', 'aria-label': 'Photo preview' });
    overlay = el('canvas', { class: 'ed-overlay' });
    stage = el('div', { class: 'ed-stage' }, glCanvas, overlay);
    try {
      renderer?.destroy();
      renderer = new Renderer(glCanvas);
      renderer.setSource(source);
      shownPatches = null;
    } catch (err) {
      host.replaceChildren(el('p', { class: 'bad-text', text: err.message }));
      return;
    }
    undoBtn = el('button', { class: 'icon-btn', 'aria-label': 'Undo', text: '↶', onclick: () => { if (history.undo()) changed(); } });
    redoBtn = el('button', { class: 'icon-btn', 'aria-label': 'Redo', text: '↷', onclick: () => { if (history.redo()) changed(); } });
    const compare = el('button', { class: 'icon-btn', 'aria-label': 'Hold to compare with the original', title: 'Hold to compare', text: '◑' });
    const startCompare = (e) => { e.preventDefault(); comparing = true; schedule(); };
    const endCompare = () => { comparing = false; schedule(); };
    compare.addEventListener('pointerdown', startCompare);
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) compare.addEventListener(ev, endCompare);

    const top = el('div', { class: 'ed-top' },
      el('button', { class: 'icon-btn', 'aria-label': 'Close photo', text: '✕', onclick: closePhoto }),
      el('div', { class: 'ed-top-mid' }, undoBtn, redoBtn, compare),
      el('button', { class: 'btn primary small-btn', text: 'Done', onclick: openExport }));
    panel = el('div', { class: 'ed-panel' });
    modeBar = el('div', { class: 'segmented ed-modes', role: 'tablist' });
    // The two one-tap fixes up front; Adjust/Filters/Crop/Markup below are for precise edits.
    const quickNote = el('p', { class: 'small muted ed-quick-note' });
    const quick = el('div', { class: 'ed-quick' },
      el('button', { class: 'btn', text: '✨ Auto-Enhance', onclick: () => { autoEnhance(); quickNote.textContent = 'Light & color tuned. Fine-tune in Adjust.'; } }),
      el('button', { class: 'btn', text: '✂️ Auto-Crop', onclick: (e) => runAutoCrop(e.currentTarget, quickNote) }),
      quickNote);
    host.replaceChildren(top, stage, quick, modeBar, panel);
    bindPointer();
    renderModes();
    renderPanel();
    const onResize = () => schedule();
    window.addEventListener('resize', onResize);
    cleanups.push(() => window.removeEventListener('resize', onResize));
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      if (e.target.closest?.('input, textarea, dialog')) return;
      e.preventDefault();
      if (e.shiftKey ? history.redo() : history.undo()) changed();
    };
    document.addEventListener('keydown', onKey);
    cleanups.push(() => document.removeEventListener('keydown', onKey));
    changed(false);
  }

  function renderModes() {
    modeBar.replaceChildren(...MODES.map(([id, label]) => el('button', {
      class: `seg${mode === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(mode === id), text: label,
      onclick: () => { mode = id; drag = null; draft = null; cleanStroke = null; renderModes(); renderPanel(); schedule(); },
    })));
  }

  /** Call after the state changed. push=false when the history already holds it (undo/redo). */
  function changed(save = true) {
    edits += 1;
    undoBtn.disabled = !history.canUndo;
    redoBtn.disabled = !history.canRedo;
    renderPanel();
    schedule();
    if (save) persist();
  }

  function commit(next) { if (history.push(next)) changed(); }
  function live(next) { history.replace(next); schedule(); }

  function persist(now = false) {
    clearTimeout(saveTimer);
    const write = () => idb.set(SAVE_KEY, { name: fileName, blob: file, state: state(), savedAt: Date.now() });
    if (now) write(); else saveTimer = setTimeout(write, 400);
  }

  // ---------- rendering ----------

  function frameSize() { return orientedSize(source.width, source.height, state().rotate); }

  /** The state actually drawn: crop mode shows the whole frame; compare shows the original. */
  function viewState() {
    if (comparing) return defaultState();
    if (mode === 'crop') return { ...state(), crop: FULL_CROP };
    return state();
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  function draw() {
    if (!renderer) return;
    const vs = viewState();
    // Retouch patches are painted on the source (compare shows the original without them).
    const patches = vs.patches ?? [];
    if (patches !== shownPatches) { shownPatches = patches; renderer.setSource(applyPatches(source, patches), source); }
    const { W, H } = orientedSize(source.width, source.height, vs.rotate);
    const out = outputPixelSize(vs, source.width, source.height);
    const maxCssW = stage.clientWidth || 360;
    const maxCssH = Math.min(window.innerHeight * 0.56, 620);
    const scale = Math.min(maxCssW / out.width, maxCssH / out.height);
    const cssW = Math.max(1, Math.floor(out.width * scale));
    const cssH = Math.max(1, Math.floor(out.height * scale));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = fitSize(cssW * dpr, cssH * dpr, Math.min(PREVIEW_MAX, renderer.maxTexture));
    for (const c of [glCanvas, overlay]) { c.style.width = `${cssW}px`; c.style.height = `${cssH}px`; }
    stage.style.height = `${cssH}px`;
    renderer.render(vs, px.width, px.height);

    if (overlay.width !== px.width || overlay.height !== px.height) { overlay.width = px.width; overlay.height = px.height; }
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const view = viewTransform({ crop: vs.crop, W, H, tw: overlay.width, th: overlay.height });
    if (!comparing) drawMarkup(ctx, draft ? [...vs.markup, draft] : vs.markup, view);
    if (mode === 'crop' && !comparing) drawCropUi(ctx, state().crop, overlay.width, overlay.height, dpr);
    if (mode === 'cleanup' && !comparing) drawCleanUi(ctx, dpr);
  }

  /** The Clean Up stroke being drawn (a soft glowing trail), and the Copy From spot. */
  function drawCleanUi(ctx, dpr) {
    if (cleanStroke) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = copyMode ? 'rgba(48,209,88,0.45)' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = cleanStroke.r * 2;
      ctx.beginPath();
      cleanStroke.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (cleanStroke.pts.length === 1) ctx.lineTo(cleanStroke.pts[0][0] + 0.1, cleanStroke.pts[0][1]);
      ctx.stroke();
      ctx.restore();
    }
    if (copyMode && copyFrom) {
      const p = sourceToOverlay(copyFrom.x, copyFrom.y);
      if (p) {
        const R = 14 * dpr;
        ctx.save();
        ctx.lineWidth = 2.5 * dpr; ctx.strokeStyle = '#30d158';
        ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, Math.PI * 2);
        ctx.moveTo(p[0] - R * 1.6, p[1]); ctx.lineTo(p[0] + R * 1.6, p[1]); ctx.moveTo(p[0], p[1] - R * 1.6); ctx.lineTo(p[0], p[1] + R * 1.6);
        ctx.stroke(); ctx.restore();
      }
    }
  }

  function drawCropUi(ctx, c, w, h, dpr) {
    const x = c.x * w; const y = c.y * h; const cw = c.w * w; const ch = c.h * h;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(x, y, cw, ch);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect(x, y, cw, ch);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    for (const f of [1 / 3, 2 / 3]) { ctx.moveTo(x + cw * f, y); ctx.lineTo(x + cw * f, y + ch); ctx.moveTo(x, y + ch * f); ctx.lineTo(x + cw, y + ch * f); }
    ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4 * dpr;
    const L = Math.min(22 * dpr, cw / 3, ch / 3);
    ctx.beginPath();
    for (const [px, py, sx, sy] of [[x, y, 1, 1], [x + cw, y, -1, 1], [x, y + ch, 1, -1], [x + cw, y + ch, -1, -1]]) {
      ctx.moveTo(px + sx * L, py); ctx.lineTo(px, py); ctx.lineTo(px, py + sy * L);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---------- pointer interaction (crop + markup) ----------

  function pointerFrame(e) {
    const r = overlay.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    const crop = mode === 'crop' ? FULL_CROP : state().crop;
    return { u, v, x: crop.x + u * crop.w, y: crop.y + v * crop.h, rect: r };
  }

  function cropHandle(p) {
    const c = state().crop;
    const tol = 28 / p.rect.width; // ~28 css px
    const tolY = 28 / p.rect.height;
    const nearL = Math.abs(p.u - c.x) < tol; const nearR = Math.abs(p.u - (c.x + c.w)) < tol;
    const nearT = Math.abs(p.v - c.y) < tolY; const nearB = Math.abs(p.v - (c.y + c.h)) < tolY;
    const inX = p.u > c.x - tol && p.u < c.x + c.w + tol; const inY = p.v > c.y - tolY && p.v < c.y + c.h + tolY;
    let h = '';
    if (nearT && inX) h += 'n'; else if (nearB && inX) h += 's';
    if (nearL && inY) h += 'w'; else if (nearR && inY) h += 'e';
    if (h) return h;
    if (p.u > c.x && p.u < c.x + c.w && p.v > c.y && p.v < c.y + c.h) return 'move';
    return null;
  }

  function ratioValue(s = state()) {
    const r = RATIOS.find((x) => x.id === s.ratio)?.ratio;
    if (r === 'original') { const { W, H } = frameSize(); return W / H; }
    return r ?? null;
  }

  function bindPointer() {
    overlay.addEventListener('pointerdown', (e) => {
      if (mode === 'cleanup') {
        e.preventDefault();
        if (cleaning) return;
        const r = overlay.getBoundingClientRect(); const k = overlay.width / r.width;
        const pt = [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
        if (copyMode && !copyFrom) { pickCopyFrom(pt); return; }
        cleanStroke = { pts: [pt], r: prefs.cleanSize * k };
        overlay.setPointerCapture(e.pointerId);
        schedule();
        return;
      }
      if (mode !== 'crop' && mode !== 'markup') return;
      const p = pointerFrame(e);
      if (mode === 'crop') {
        const handle = cropHandle(p);
        if (!handle) return;
        drag = { kind: 'crop', handle, start: { ...state().crop }, u: p.u, v: p.v, before: state() };
      } else {
        const tool = prefs.tool;
        const s = state();
        if (tool === 'eraser') {
          const { W, H } = frameSize();
          const tol = (18 * s.crop.w * W) / p.rect.width; // 18 css px expressed in frame pixels
          const i = hitTest(s.markup, p.x, p.y, W, H, tol);
          if (i >= 0) commit({ ...s, markup: s.markup.filter((_, j) => j !== i) });
          return;
        }
        if (tool === 'text') { askText(p.x, p.y); return; }
        const base = { color: prefs.color, width: tool === 'highlighter' ? prefs.size * 3 : prefs.size };
        draft = tool === 'pen' || tool === 'highlighter'
          ? { type: tool, points: [[p.x, p.y]], ...base }
          : { type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, ...base };
        drag = { kind: 'markup' };
      }
      overlay.setPointerCapture(e.pointerId);
      e.preventDefault();
      schedule();
    });
    overlay.addEventListener('pointermove', (e) => {
      if (cleanStroke) {
        const r = overlay.getBoundingClientRect(); const k = overlay.width / r.width;
        const pt = [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; const last = cleanStroke.pts.at(-1);
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 2 * k) { cleanStroke.pts.push(pt); schedule(); }
        return;
      }
      if (!drag) return;
      const p = pointerFrame(e);
      if (drag.kind === 'crop') {
        const { W, H } = frameSize();
        live({ ...state(), crop: dragCrop(drag.start, drag.handle, p.u - drag.u, p.v - drag.v, ratioValue(), W, H) });
      } else if (draft) {
        if (draft.points) {
          const last = draft.points[draft.points.length - 1];
          const c = state().crop;
          const cssDist = Math.hypot(((p.x - last[0]) / c.w) * p.rect.width, ((p.y - last[1]) / c.h) * p.rect.height);
          if (cssDist > 2) draft.points.push([p.x, p.y]);
        } else { draft.x2 = p.x; draft.y2 = p.y; }
        schedule();
      }
    });
    const end = () => {
      if (cleanStroke) { const st = cleanStroke; cleanStroke = null; runCleanUp(st); return; }
      if (!drag) return;
      if (drag.kind === 'crop') {
        const next = state();
        history.replace(drag.before);
        commit(next);
      } else if (draft) {
        const item = draft;
        draft = null;
        const tiny = !item.points && Math.hypot(item.x2 - item.x1, item.y2 - item.y1) < 0.005;
        if (!tiny) commit({ ...state(), markup: [...state().markup, item] }); else schedule();
      }
      drag = null;
    };
    overlay.addEventListener('pointerup', end);
    overlay.addEventListener('pointercancel', end);
  }

  // ---------- Clean Up ----------

  /** Overlay pixels → source pixels (through crop, straighten, flips and turns). */
  function overlayToSource(x, y) {
    const M = outputToSource(viewState(), source.width, source.height);
    const [su, sv] = apply(M, x / overlay.width, y / overlay.height);
    return [su * source.width, sv * source.height];
  }
  /** Source pixels → overlay pixels (for the Copy From marker); null when it's out of view. */
  function sourceToOverlay(x, y) {
    const M = outputToSource(viewState(), source.width, source.height);
    const det = M[0] * M[4] - M[1] * M[3]; if (!det) return null;
    const su = x / source.width - M[2]; const sv = y / source.height - M[5];
    const u = (M[4] * su - M[1] * sv) / det; const v = (-M[3] * su + M[0] * sv) / det;
    return u < -0.05 || v < -0.05 || u > 1.05 || v > 1.05 ? null : [u * overlay.width, v * overlay.height];
  }
  /** The source with the clean-ups so far painted on, as RGBA (what the next one works from). */
  let pixelsCache = null;
  function sourcePixels() {
    const patches = state().patches ?? [];
    if (pixelsCache?.patches === patches) return pixelsCache.rgba;
    const c = applyPatches(source, patches);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    pixelsCache = { patches, rgba: ctx.getImageData(0, 0, source.width, source.height).data };
    return pixelsCache.rgba;
  }

  function pickCopyFrom(pt) {
    const [x, y] = overlayToSource(...pt);
    copyFrom = { x, y };
    cleanNote = 'Now tap, brush or circle the area to cover with it.';
    renderPanel(); schedule();
  }

  function runCleanUp(st) {
    const w = source.width; const h = source.height;
    const pts = st.pts.map(([x, y]) => overlayToSource(x, y));
    // The brush size in source pixels: how far one brush radius across the overlay reaches in the source.
    const [ax, ay] = overlayToSource(st.pts[0][0], st.pts[0][1]); const [bx, by] = overlayToSource(st.pts[0][0] + st.r, st.pts[0][1]);
    const r = Math.max(2, Math.hypot(bx - ax, by - ay));
    const { mask, shape, box } = strokeMask(pts, r, w, h);
    if (!box) { schedule(); return; }
    cleaning = true; cleanNote = copyMode ? 'Copying…' : 'Cleaning up…'; renderPanel(); schedule();
    // Let the note show before the work (it takes a moment on big areas).
    setTimeout(() => {
      try {
        const rgba = sourcePixels();
        let p;
        if (copyMode) {
          const cx = (box.x0 + box.x1) / 2; const cy = (box.y0 + box.y1) / 2;
          p = cloneFrom(rgba, w, h, mask, box, copyFrom.x - cx, copyFrom.y - cy);
          if (!p) { cleanNote = 'That copy would come from outside the photo: pick a spot farther in.'; return; }
        } else p = cleanUp(rgba, w, h, mask, box);
        if (!p) { cleanNote = ''; return; }
        const s = state();
        lastClean = { mask, box, before: s.patches ?? [] };
        cleanNote = copyMode ? 'Copied in and blended. Undo takes it back.' : `${{ tap: 'Spot', brush: 'Brushed area', lasso: 'Circled area' }[shape]} cleaned up. Looks smudged? Try 📋 Copy From Area.`;
        commit({ ...s, patches: [...(s.patches ?? []), makePatch(p, w, h)] });
      } finally { cleaning = false; renderPanel(); schedule(); }
    }, 30);
  }

  /** Redo the last clean-up as a copy from the chosen spot. */
  function copyOverLast() {
    if (!lastClean || !copyFrom) return;
    const w = source.width; const h = source.height; const { mask, box, before } = lastClean;
    const s = state();
    // Work from the picture as it was before that clean-up.
    const c = applyPatches(source, before);
    const rgba = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const cx = (box.x0 + box.x1) / 2; const cy = (box.y0 + box.y1) / 2;
    const p = cloneFrom(rgba, w, h, mask, box, copyFrom.x - cx, copyFrom.y - cy);
    if (!p) { cleanNote = 'That copy would come from outside the photo: pick a spot farther in.'; renderPanel(); return; }
    cleanNote = 'The last clean-up is now a copy of that spot, blended in.';
    commit({ ...s, patches: [...before, makePatch(p, w, h)] });
  }

  function askText(x, y) {
    const area = el('textarea', { rows: '3', placeholder: 'Type your text', class: 'ed-textarea' });
    const boxed = el('input', { type: 'checkbox' });
    const dlg = el('dialog', { class: 'ed-dialog' },
      el('form', { method: 'dialog', class: 'sheet' },
        el('h2', { text: 'Add text' }), area,
        el('label', { class: 'check' }, boxed, el('span', { text: 'Background box' })),
        el('div', { class: 'row end' },
          el('button', { class: 'btn ghost', value: 'cancel', text: 'Cancel' }),
          el('button', { class: 'btn primary', value: 'add', text: 'Add' }))));
    dlg.addEventListener('close', () => {
      const text = area.value.trim();
      if (dlg.returnValue === 'add' && text) {
        commit({ ...state(), markup: [...state().markup, { type: 'text', x, y, text, color: prefs.color, size: Math.max(0.03, prefs.size * 6), box: boxed.checked }] });
      }
      dlg.remove();
    });
    document.body.append(dlg);
    dlg.showModal();
    area.focus();
  }

  // ---------- panels ----------

  function slider({ min, max, step = 1, value, onInput, onChange, label }) {
    const out = el('output', { text: String(Math.round(value)) });
    const r = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
    r.addEventListener('input', () => { out.textContent = String(Math.round(Number(r.value) * 10) / 10); onInput(Number(r.value)); });
    r.addEventListener('change', () => onChange(Number(r.value)));
    r.addEventListener('dblclick', () => { r.value = '0'; out.textContent = '0'; onInput(0); onChange(0); });
    return el('div', { class: 'range-row ed-slider' }, r, out);
  }

  function renderPanel() {
    // Live slider movement only redraws the canvas; panels re-render when a change is committed.
    if (mode === 'adjust') panel.replaceChildren(...adjustPanel());
    else if (mode === 'filters') panel.replaceChildren(...filtersPanel());
    else if (mode === 'crop') panel.replaceChildren(...cropPanel());
    else if (mode === 'cleanup') panel.replaceChildren(...cleanupPanel());
    else panel.replaceChildren(...markupPanel());
    // A mouse wheel scrolls the chip rows sideways (on a phone they're swiped).
    for (const row of panel.querySelectorAll('.chips')) row.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
      e.preventDefault(); row.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  function cleanupPanel() {
    const size = slider({
      min: 6, max: 80, value: prefs.cleanSize, label: 'Brush size',
      onInput: (v) => { prefs.cleanSize = v; }, onChange: () => savePrefs(),
    });
    const copy = el('button', {
      class: `chip${copyMode ? ' active' : ''}`, 'aria-pressed': String(copyMode), text: '📋 Copy From Area',
      onclick: () => { copyMode = !copyMode; copyFrom = null; cleanNote = copyMode ? 'Tap the spot to copy from.' : ''; renderPanel(); schedule(); },
    });
    const hint = copyMode
      ? (copyFrom ? 'Tap, brush or circle the area to cover: it gets a copy of the spot you picked, blended in.' : 'Tap the spot to copy from: a clean piece of what should be there (sand, sky, wall).')
      : 'Tap a spot, brush over something, or draw a circle around it: it\'s removed and filled in from the picture around it.';
    return [
      el('div', { class: 'chips' }, copy,
        copyMode && copyFrom ? el('button', { class: 'chip', text: '↺ Pick another spot', onclick: () => { copyFrom = null; cleanNote = 'Tap the spot to copy from.'; renderPanel(); schedule(); } }) : null,
        copyMode && copyFrom && lastClean ? el('button', { class: 'chip', text: '↻ Use on the last clean-up', onclick: copyOverLast }) : null),
      el('p', { class: 'small muted ed-clean-hint', text: hint }),
      cleanNote ? el('p', { class: `small ${cleaning ? 'muted' : 'ok-text'}`, 'aria-live': 'polite', text: cleanNote }) : null,
      el('div', { class: 'ed-row' }, el('strong', { class: 'small', text: 'Brush size' }), el('span', { class: 'muted small', text: 'A tap cleans a spot this size.' })),
      size,
    ].filter(Boolean);
  }

  function adjustPanel() {
    const s = state();
    const def = ADJUSTMENTS.find((a) => a.id === activeAdjust);
    const min = def.min === 0 ? 0 : -100;
    const chips = el('div', { class: 'chips' },
      el('button', { class: 'chip', text: '✨ Auto', onclick: autoEnhance }),
      ...ADJUSTMENTS.map((a) => el('button', {
        class: `chip${a.id === activeAdjust ? ' active' : ''}${s.adjust[a.id] ? ' changed' : ''}`,
        text: `${a.icon} ${a.label}`,
        onclick: () => { activeAdjust = a.id; renderPanel(); },
        ondblclick: () => commit({ ...state(), adjust: { ...state().adjust, [a.id]: 0 } }),
      })));
    const before = { value: null };
    const sl = slider({
      min, max: 100, value: Math.round(s.adjust[activeAdjust] * 100), label: def.label,
      onInput: (v) => { before.value ??= state(); live({ ...state(), adjust: { ...state().adjust, [activeAdjust]: v / 100 } }); },
      onChange: () => { const next = state(); if (before.value) history.replace(before.value); before.value = null; commit(next); },
    });
    return [chips, el('div', { class: 'ed-row' }, el('strong', { class: 'small', text: def.label }), el('button', { class: 'linkish small', text: 'Reset all', onclick: () => commit({ ...state(), adjust: defaultState().adjust }) })), sl];
  }

  function autoEnhance() {
    // Render a small version without adjustments and work out this photo's settings from it.
    const base = { ...state(), adjust: defaultState().adjust, filter: 'original' };
    const w = 320; const h = Math.max(1, Math.round(320 * glCanvas.height / glCanvas.width));
    renderer.render(base, w, h);
    const auto = autoAdjust(renderer.readPixels(), w, h);
    commit({ ...state(), adjust: { ...state().adjust, ...auto } });
  }

  function filtersPanel() {
    const s = state();
    const strip = el('div', { class: 'chips filters' }, ...FILTERS.map((f) => {
      const c = el('canvas', { class: 'filter-thumb', width: '72', height: '72' });
      return el('button', {
        class: `filter${s.filter === f.id ? ' active' : ''}`, 'aria-label': f.label,
        onclick: () => commit({ ...state(), filter: f.id, filterIntensity: state().filter === f.id ? state().filterIntensity : 1 }),
      }, c, el('span', { class: 'small', text: f.label }));
    }));
    queueMicrotask(() => paintThumbs(strip));
    const parts = [strip];
    if (s.filter !== 'original') {
      const before = { value: null };
      parts.push(slider({
        min: 0, max: 100, value: Math.round(s.filterIntensity * 100), label: 'Filter intensity',
        onInput: (v) => { before.value ??= state(); live({ ...state(), filterIntensity: v / 100 }); },
        onChange: () => { const next = state(); if (before.value) history.replace(before.value); before.value = null; commit(next); },
      }));
    }
    return parts;
  }

  function paintThumbs(strip) {
    try {
      if (!thumbs) {
        const tc = document.createElement('canvas');
        const fit = fitSize(source.width, source.height, THUMB_MAX);
        thumbs = new Renderer(tc);
        thumbs.setSource(drawToCanvas(source, fit.width, fit.height, null));
      }
      const s = state();
      const canvases = strip.querySelectorAll('canvas');
      FILTERS.forEach((f, i) => {
        const st = { ...s, filter: f.id, filterIntensity: 1 };
        const out = outputPixelSize(st, thumbs.srcW, thumbs.srcH);
        thumbs.render({ ...st, crop: centerSquare(st, out) }, 72, 72);
        canvases[i]?.getContext('2d').drawImage(thumbs.canvas, 0, 0);
      });
    } catch { /* thumbnails are optional */ }
  }

  function centerSquare(st, out) {
    // Square crop from the middle of the current crop, for filter thumbnails.
    const c = st.crop;
    if (out.width > out.height) { const w = c.w * (out.height / out.width); return { x: c.x + (c.w - w) / 2, y: c.y, w, h: c.h }; }
    const h = c.h * (out.width / out.height);
    return { x: c.x, y: c.y + (c.h - h) / 2, w: c.w, h };
  }

  function cropPanel() {
    const s = state();
    const { W, H } = frameSize();
    const ratios = el('div', { class: 'chips' }, ...RATIOS.map((r) => el('button', {
      class: `chip${s.ratio === r.id ? ' active' : ''}`, text: r.label,
      onclick: () => {
        const value = r.ratio === 'original' ? W / H : r.ratio;
        commit({ ...state(), ratio: r.id, crop: value ? cropForRatio(value, W, H) : state().crop });
      },
    })));
    const before = { value: null };
    const straighten = slider({
      min: -45, max: 45, step: 0.5, value: s.straighten, label: 'Straighten',
      onInput: (v) => { before.value ??= state(); live({ ...state(), straighten: v }); },
      onChange: () => { const next = state(); if (before.value) history.replace(before.value); before.value = null; commit(next); },
    });
    const autoNote = el('span', { class: 'muted small ed-autocrop-note', text: autoCropNote });
    const faceNote = el('span', { class: 'muted small', 'aria-live': 'polite', text: faceNoteText });
    return [
      ratios,
      el('div', { class: 'ed-row ed-autocrop' },
        el('button', { class: 'btn small-btn primary', text: '✂️ Auto-Crop', onclick: (e) => runAutoCrop(e.currentTarget, autoNote) }),
        autoNote),
      barColorsPicker(prefs.autoCropColors, () => savePrefs()),
      // Faces: level one (eyes level, above the mouth), or swap faces for a Character or a mask.
      el('div', { class: 'ed-row ed-face' },
        el('button', { class: 'btn small-btn', text: '🙂 Level face', onclick: (e) => levelFace(e.currentTarget, faceNote) }),
        onFaceSwap ? el('button', { class: 'btn small-btn', text: '🎭 Face swap', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const f = await unmount.currentPhoto(); if (f) onFaceSwap(f); } finally { b.disabled = false; } } }) : null,
        faceNote),
      el('div', { class: 'ed-row' },
        el('button', { class: 'btn small-btn', text: '⟳ Rotate', onclick: () => commit(rotateClockwise(state())) }),
        el('button', { class: 'btn small-btn', text: '⇋ Flip', onclick: () => commit(flipHorizontal(state())) }),
        el('button', { class: 'btn small-btn ghost', text: 'Reset', onclick: () => commit({ ...state(), rotate: 0, flipH: false, flipV: false, straighten: 0, crop: { ...FULL_CROP }, ratio: 'free', markup: state().markup }) })),
      el('strong', { class: 'small', text: 'Straighten' }),
      straighten,
    ];
  }

  let faceNoteText = '';
  /**
   * 🙂 Level face: finds the faces (on the phone) and turns the photo so the biggest one is upright:
   * eyes level, above the mouth (rotate and straighten; the crop starts over).
   */
  async function levelFace(btn, note) {
    btn.disabled = true; note.textContent = faceNoteText = 'Looking for faces…';
    try {
      const { detectFaces } = await import('../../lib/face.js');
      const faces = await detectFaces(applyPatches(source, state().patches ?? []));
      const face = mainFace(faces);
      if (!face) { faceNoteText = 'No face found in this photo.'; return; }
      const W = source.width; const H = source.height;
      // Where a source point shows for an edit state (the inverse of the renderer's mapping).
      const map = (st, [u, v]) => {
        const M = outputToSource(st, W, H); const det = M[0] * M[4] - M[1] * M[3];
        const su = u - M[2]; const sv = v - M[5];
        const o = orientedSize(W, H, st.rotate);
        return [((M[4] * su - M[1] * sv) / det) * o.W, ((-M[3] * su + M[0] * sv) / det) * o.H];
      };
      const turn = levelTurn(face, state(), map);
      if (!turn) { faceNoteText = 'Couldn\'t work out how to level that face.'; return; }
      commit({ ...state(), rotate: turn.rotate, straighten: turn.straighten, crop: { ...FULL_CROP }, ratio: 'free' });
      faceNoteText = `Leveled ${faces.length > 1 ? `the biggest of ${faces.length} faces` : 'the face'}: eyes level, above the mouth. Undo to go back.`;
    } catch (err) { faceNoteText = `Couldn't look for faces: ${err.message}`; }
    finally { btn.disabled = false; note.textContent = faceNoteText; renderPanel(); }
  }

  let autoCropNote = 'Crops a screenshot of a post to just its photo or video.';
  async function runAutoCrop(btn, note) {
    btn.disabled = true;
    note.textContent = 'Looking for the post…';
    let r;
    try {
      // Full resolution, so no sliver of the bar is left at export.
      r = await loadFullRenderer(file);
      const found = detectAutoCrop(r, state(), { colors: [...prefs.autoCropColors] });
      autoCropNote = found.sure ? found.note : found.crop ? `${found.note}: drag the handles, then switch back` : found.note;
      note.textContent = autoCropNote;
      // Overlay icons filled in (or none any more): part of the same undo step as the crop.
      const next = { ...state(), patches: found.patches };
      if (found.crop && !found.sure) {
        // Not sure: show the crop handles on the best guess instead of just applying it.
        mode = 'crop'; drag = null; draft = null;
        commit({ ...next, crop: found.crop, ratio: 'free' });
        renderModes(); renderPanel(); schedule();
      } else if (found.crop) commit({ ...next, crop: found.crop, ratio: 'free' });
      else { commit(next); renderPanel(); }
    } catch (err) {
      autoCropNote = `Auto-Crop failed: ${err.message}`;
      note.textContent = autoCropNote;
      renderPanel();
    } finally { r?.destroy(); btn.disabled = false; }
  }

  function markupPanel() {
    const tools = el('div', { class: 'chips' }, ...TOOLS.map(([id, icon, label]) => el('button', {
      class: `chip${prefs.tool === id ? ' active' : ''}`, text: `${icon} ${label}`,
      onclick: () => { prefs.tool = id; savePrefs(); renderPanel(); },
    })));
    const custom = el('input', { type: 'color', value: prefs.color, 'aria-label': 'Custom color', class: 'swatch-custom' });
    custom.addEventListener('input', () => { prefs.color = custom.value; savePrefs(); });
    custom.addEventListener('change', () => renderPanel());
    const colors = el('div', { class: 'swatches' }, ...COLORS.map((c) => el('button', {
      class: `swatch${prefs.color === c ? ' active' : ''}`, style: { background: c }, 'aria-label': `Color ${c}`,
      onclick: () => { prefs.color = c; savePrefs(); renderPanel(); },
    })), custom);
    const size = slider({
      min: 2, max: 40, value: Math.round(prefs.size * 1000), label: 'Size',
      onInput: (v) => { prefs.size = v / 1000; }, onChange: () => savePrefs(),
    });
    const hint = prefs.tool === 'eraser' ? 'Tap a drawing to remove it.' : prefs.tool === 'text' ? 'Tap the photo where the text should go.' : 'Draw on the photo.';
    return [tools, colors, el('div', { class: 'ed-row' }, el('strong', { class: 'small', text: 'Size' }), el('span', { class: 'muted small', text: hint })), size,
      state().markup.length ? el('button', { class: 'linkish small', text: 'Remove all markup', onclick: () => commit({ ...state(), markup: [] }) }) : null].filter(Boolean);
  }

  // ---------- close / export ----------

  function closePhoto() {
    if (!isDefault(state()) && !window.confirm('Close this photo? Your edits will be discarded.')) return;
    idb.del(SAVE_KEY);
    teardown();
    showStart(null);
  }

  async function renderFull() {
    // Full resolution from the original; the preview used a downscaled copy.
    return (await renderEdited(file, state(), { maxEdge: prefs.exportMax })).canvas;
  }

  function openExport() {
    const status = el('p', { class: 'muted small', text: 'Preparing…' });
    const shareBtn = el('button', { class: 'btn primary', text: 'Share', disabled: true });
    const saveBtn = el('button', { class: 'btn', text: 'Save', disabled: true });
    const types = [['image/jpeg', 'JPEG'], ['image/png', 'PNG'], ['image/webp', 'WebP']];
    const seg = el('div', { class: 'segmented' });
    const sizeSel = el('select', {}, ...[[0, 'Full size'], [4096, '4096 px'], [2048, '2048 px'], [1080, '1080 px']].map(([v, l]) => el('option', { value: String(v), text: l, selected: Number(v) === prefs.exportMax })));
    const quality = el('input', { type: 'range', min: '50', max: '100', value: String(Math.round(prefs.exportQuality * 100)) });
    const qualityRow = el('label', { class: 'field' }, el('span', { text: 'Quality' }), quality);
    let full = null; let blob = null; let token = 0;

    const dlg = el('dialog', { class: 'ed-dialog' }, el('div', { class: 'sheet' },
      el('h2', { text: 'Save your photo' }), seg,
      el('label', { class: 'field' }, el('span', { text: 'Size' }), sizeSel), qualityRow, status,
      el('div', { class: 'row end' }, el('button', { class: 'btn ghost', text: 'Close', onclick: () => dlg.close() }), saveBtn, shareBtn)));

    const renderSeg = () => seg.replaceChildren(...types.map(([t, l]) => el('button', {
      class: `seg${prefs.exportType === t ? ' active' : ''}`, text: l,
      onclick: () => { prefs.exportType = t; savePrefs(); renderSeg(); encode(); },
    })));

    async function encode() {
      const my = ++token;
      shareBtn.disabled = saveBtn.disabled = true;
      qualityRow.hidden = prefs.exportType === 'image/png';
      status.textContent = 'Preparing…';
      try {
        full ??= await renderFull();
        const b = await encodeCanvas(full, prefs.exportType, prefs.exportQuality);
        if (my !== token) return;
        blob = b;
        const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[prefs.exportType];
        const name = renameExt(fileName, ext, '-edited');
        const f = new File([blob], name, { type: blob.type });
        status.textContent = `${name} · ${full.width}×${full.height} · ${formatBytes(blob.size)}`;
        saveBtn.disabled = false;
        saveBtn.onclick = () => downloadBlob(blob, name);
        shareBtn.hidden = !canShareFiles([f]);
        shareBtn.disabled = false;
        shareBtn.onclick = () => shareFiles([f], name).catch((e) => { status.textContent = e.message; });
      } catch (err) {
        if (my === token) status.textContent = `Could not export: ${err.message}`;
      }
    }

    sizeSel.addEventListener('change', () => { prefs.exportMax = Number(sizeSel.value); savePrefs(); full = null; encode(); });
    quality.addEventListener('change', () => { prefs.exportQuality = Number(quality.value) / 100; savePrefs(); encode(); });
    dlg.addEventListener('close', () => { token += 1; dlg.remove(); });
    document.body.append(dlg);
    renderSeg();
    dlg.showModal();
    encode();
  }

  function teardown() {
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(saveTimer);
    for (const fn of cleanups.splice(0)) fn();
    renderer?.destroy(); renderer = null;
    thumbs?.destroy(); thumbs = null;
  }

  // ---------- start ----------
  if (initialFile) openFile(initialFile);
  else idb.get(SAVE_KEY).then((saved) => showStart(saved?.blob ? saved : null));

  const unmount = () => {
    if (history && file) persist(true);
    teardown();
  };
  /** Open another photo; asks first if the current one has edits. */
  unmount.openFile = (blob, name) => {
    if (history && file && !isDefault(state()) && !window.confirm('Open the new photo? Edits to the current one will be discarded.')) return false;
    teardown();
    openFile(blob, name);
    return true;
  };
  /**
   * The photo being edited, with its edits (up to 2048 px), as a JPEG file for Collage or Cutout; null
   * when no photo is open. `key` changes whenever the photo or its edits do.
   */
  unmount.currentPhoto = async () => {
    if (!history || !file || !renderer) return null;
    const { canvas } = await renderEdited(file, state(), { maxEdge: 2048 });
    const blob = await encodeCanvas(canvas, 'image/jpeg', 0.92);
    return new File([blob], renameExt(fileName, 'jpg', '-edited'), { type: 'image/jpeg' });
  };
  unmount.photoKey = () => (history && file && renderer ? `${fileName}#${edits}` : null);
  /** Redraw after the panel becomes visible again (sizes are 0 while hidden). */
  unmount.show = () => { if (renderer) schedule(); };
  return unmount;
}
