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
import { strokeMask, strokeShape, cleanUp, cloneFrom, sampleShade } from './cleanup.js';
import { reverseFillTool } from './reverse-fill-ui.js';
import { levelTurn } from '../../lib/face-core.js';
import { openExpandDialog } from './expand-ui.js';
import { placedPatch } from './place.js';
import { buildFitted } from './fit-pipeline.js';
import { fitClient } from './fit-client.js';
import { blendIn, keepOwnFace, targetOutline, realPlacement, ownOutline, mirrorFace, mirrorPixels, shouldFlip } from './facefit.js';
import { listCharacters, getCharacterBlob, addCharacter } from '../../lib/characters.js';
import { maskLayer, faceContour } from '../../lib/face-core.js';
import { zoomable } from '../../lib/zoom.js';
import { drawLoupe } from '../../lib/loupe.js';

const PREVIEW_MAX = 2048;
const THUMB_MAX = 200;
const SAVE_KEY = 'editor.session';
const PREFS_KEY = 'cc.editor.prefs';
// FaceMask ('face') is the FM app's (the same editor mounted with `fm`: only the face tools), not one here.
const MODES = [['adjust', 'Adjust'], ['filters', 'Filters'], ['crop', 'Crop'], ['markup', 'Markup'], ['cleanup', 'Clean Up']];
// The FM app's own: its face tools, and Reverse Fill (only there).
const FM_MODES = [['face', '🎭 Faces'], ['rfill', '🎨 Reverse Fill']];
const TOOLS = [
  ['pen', '✎', 'Pen'], ['highlighter', '▬', 'Highlighter'], ['line', '╱', 'Line'], ['arrow', '➚', 'Arrow'],
  ['rect', '▭', 'Box'], ['ellipse', '◯', 'Oval'], ['text', 'T', 'Text'], ['eraser', '⌫', 'Eraser'],
];

/**
 * mount(host, { file, fm }) — `file` opens that photo right away (e.g. sent from the converter). `fm`:
 * the FM app (FaceMask): only the face tools, with a photo of its own (kept apart from Files').
 */
export function mount(host, { file: initialFile, fm: faceApp = false } = {}) {
  const sessionKey = faceApp ? 'fm.session' : SAVE_KEY;
  const prefs = { tool: 'pen', color: '#ff3b30', size: 0.008, cleanSize: 22, exportType: 'image/jpeg', exportQuality: 0.92, exportMax: 0, autoCropColors: [...AUTO_CROP_DEFAULTS.colors], ...store.json(PREFS_KEY, {}) };
  delete prefs.autoCropColor;
  const savePrefs = () => store.set(PREFS_KEY, JSON.stringify(prefs));

  let file = null;            // original File/Blob
  let fileName = 'photo.jpg';
  let source = null;          // preview source canvas
  let renderer = null;
  let history = null;
  let mode = faceApp ? 'face' : 'adjust';
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
  // Generative Expand: the photo (file, name, edits) from before the last expand, to go back to.
  let beforeExpand = null; let pendingBefore = null;
  // ➕ Character: the image being placed (see startPlacing), and the pointers moving or pinching it.
  let placing = null; const placePointers = new Map(); let placeGesture = null;
  let aimCopy = null; // Copy From Area: the spot being aimed at (overlay px), picked when the finger lifts
  // A fitted Character's fine-tuning by hand (on top of the fit): size, turn, nudge (photo px), edge softness.
  const newTune = () => ({ scale: 1, rot: 0, dx: 0, dy: 0, soft: 50 });
  const cleanups = [];
  // 🎨 Reverse Fill (FM's second tab): its own tool (reverse-fill-ui.js), given what it needs of the photo.
  const rfTool = reverseFillTool({
    source: () => source, pixels: () => sourcePixels(), state: () => history.state, commit: (next) => commit(next), makePatch,
    overlayToSource: (x, y) => overlayToSource(x, y), sourceToOverlayMatrix: () => sourceToOverlayMatrix(), slider: (o) => slider(o),
    renderPanel: () => renderPanel(), schedule: () => schedule(),
  });

  const state = () => history.state;

  // ---------- screens ----------

  function showStart(saved) {
    const input = el('input', { type: 'file', accept: 'image/*,.heic,.heif', multiple: !faceApp, class: 'visually-hidden', id: 'ed-file' });
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
        el('button', { class: 'btn ghost', text: 'Discard', onclick: () => { idb.del(sessionKey); showStart(null); } }))) : null;
    host.replaceChildren(...[
      resume,
      faceApp ? el('div', { class: 'drop' },
        el('button', { class: 'btn primary block', text: '⚡ Quick Swap faces', onclick: () => quickSwap() }),
        el('p', { class: 'muted small center', text: 'Two photos: the one to change, then the one with the face to put on it. The face is cut out, fitted and blended for you, ready to save.' })) : null,
      el('div', { class: `drop${faceApp ? ' qs-start' : ''}` },
        el('label', { class: `btn ${faceApp ? '' : 'primary '}block`, for: 'ed-file', text: faceApp ? 'Choose a photo' : 'Choose photos' }),
        el('p', { class: 'muted small center', text: faceApp ? 'Find its faces, cut one out to keep as a Character, or put a Character on a face (fitted, recolored and blended). Nothing leaves this phone.' : 'Pick one photo to edit it, or many to edit them all at once (Auto-Crop, filters, light and color, size). Your originals are never changed, and nothing leaves this phone.' })),
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
      rfTool.stop(); lastClean = null; copyFrom = null; pixelsCache = null;
      beforeExpand = pendingBefore; pendingBefore = null; placing = null; fm = { faces: null, sel: 0, note: '', busy: false };
      bitmap.close?.();
      file = blob;
      fileName = name;
      history = createHistory(restored ?? defaultState());
      if (startMode) mode = startMode;
      if (faceOnly) mode = 'face';
      buildEditor();
      if (!restored) persist(true);
    } catch (err) {
      host.replaceChildren(el('p', { class: 'bad-text', text: err.message }), el('button', { class: 'btn', text: 'Back', onclick: () => showStart(null) }));
    }
  }

  // ---------- editor layout ----------

  let zoomCtl = null; // zoom within the photo (see buildEditor)
  let quick = null;   // the one-tap fixes under the photo
  // The FM app: the photo with only the face tools (mode 'face'), no editing tabs or one-tap fixes.
  const faceOnly = faceApp;
  let glCanvas; let overlay; let stage; let panel; let undoBtn; let redoBtn; let modeBar; let thumbs = null;

  function buildEditor() {
    glCanvas = el('canvas', { class: 'ed-canvas', 'aria-label': 'Photo preview' });
    overlay = el('canvas', { class: 'ed-overlay' });
    const zoomLayer = el('div', { class: 'ed-zoom' }, glCanvas, overlay);
    stage = el('div', { class: 'ed-stage' }, zoomLayer);
    // Two fingers zoom within the photo (one keeps drawing); pinching a Character being placed sizes it instead.
    zoomCtl = zoomable(stage, zoomLayer, {
      onChange: () => schedule(),
      enabled: () => !(mode === 'face' && placing),
      onGesture: () => {
        cleanStroke = null; draft = null; aimCopy = null;
        if (drag?.kind === 'crop') history.replace(drag.before);
        drag = null; schedule();
      },
    });
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
    quick = el('div', { class: 'ed-quick' },
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
    // FaceMask on its own: just its tools (faces, Reverse Fill), none of the editing ones.
    if (quick) quick.hidden = faceOnly;
    modeBar.replaceChildren(...(faceOnly ? FM_MODES : MODES).map(([id, label]) => el('button', {
      class: `seg${mode === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(mode === id), text: label,
      onclick: () => {
        if (placing && id !== 'face') return;
        mode = id; drag = null; draft = null; cleanStroke = null;
        if (mode === 'rfill') rfTool.start(); else rfTool.stop();
        copyMode = false; copyFrom = null; cleanNote = '';
        renderModes(); renderPanel(); schedule();
      },
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
    const write = () => idb.set(sessionKey, { name: fileName, blob: file, state: state(), savedAt: Date.now() });
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
    // Zoomed in: drawn at that much more detail (up to the photo's own), so it stays sharp.
    const zf = zoomCtl?.view.z ?? 1;
    const px = fitSize(cssW * dpr * zf, cssH * dpr * zf, Math.min(PREVIEW_MAX, renderer.maxTexture));
    for (const c of [glCanvas, overlay]) { c.style.width = `${cssW}px`; c.style.height = `${cssH}px`; }
    stage.style.height = `${cssH}px`;
    renderer.render(vs, px.width, px.height);

    if (overlay.width !== px.width || overlay.height !== px.height) { overlay.width = px.width; overlay.height = px.height; }
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const view = viewTransform({ crop: vs.crop, W, H, tw: overlay.width, th: overlay.height });
    if (!comparing) drawMarkup(ctx, draft ? [...vs.markup, draft] : vs.markup, view);
    if (mode === 'crop' && !comparing) drawCropUi(ctx, state().crop, overlay.width, overlay.height, dpr);
    if ((mode === 'cleanup' || mode === 'rfill') && !comparing) drawCleanUi(ctx, dpr);
    if (mode === 'face' && !comparing) { if (placing) drawPlacing(ctx, dpr); else drawFaceMarks(ctx, dpr); }
  }

  /** The Clean Up stroke being drawn (a soft glowing trail), the Copy From spot, Reverse Fill's trace and what it'll remove. */
  function drawCleanUi(ctx, dpr) {
    if (rfTool.on) rfTool.draw(ctx, dpr);
    // The magnifier: what's under the finger, just above it, while a stroke or a spot is being aimed.
    const under = cleanStroke?.pts.at(-1) ?? aimCopy;

    if (cleanStroke && !cleanStroke.aim) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = cleanStroke.brush ? (cleanStroke.brush === 'add' ? 'rgba(255,45,149,0.5)' : 'rgba(10,132,255,0.45)') : cleanStroke.thin ? '#ff2d95' : copyMode ? 'rgba(48,209,88,0.45)' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = cleanStroke.thin ? 2.5 * dpr : cleanStroke.r * 2;
      ctx.beginPath();
      cleanStroke.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (cleanStroke.pts.length === 1) ctx.lineTo(cleanStroke.pts[0][0] + 0.1, cleanStroke.pts[0][1]);
      ctx.stroke();
      ctx.restore();
    }
    if (under) {
      const k = overlay.width / (overlay.getBoundingClientRect().width || overlay.width);
      const lp = drawLoupe(ctx, glCanvas, under[0], under[1], { k, ring: cleanStroke && !cleanStroke.thin ? cleanStroke.r : 0, color: copyMode ? '#30d158' : '#ffd60a', zoom: cleanStroke?.aim ? 4 : 2.6 });
      // Picking a color: the color it'll pick (the shade right under the crosshair), shown beside it.
      if (cleanStroke?.aim) {
        const [sx, sy] = overlayToSource(under[0], under[1]);
        if (sx >= 0 && sy >= 0 && sx < source.width && sy < source.height) {
          const c = sampleShade(sourcePixels(), source.width, source.height, sx, sy, Math.max(2, Math.round(Math.max(source.width, source.height) / 500)));
          const r = 13 * k; const px = lp.cx + lp.R * 0.72; const py = lp.cy + lp.R * 0.72;
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fillStyle = `rgb(${c.join(',')})`; ctx.fill();
          ctx.lineWidth = 2.5 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
          ctx.restore();
        }
      }
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
      if (mode === 'face') { e.preventDefault(); if (placing) placeDown(e); else pickFaceAt(e); return; }
      if (mode === 'cleanup' || mode === 'rfill') {
        e.preventDefault();
        if (cleaning || rfTool.busy) return;
        const r = overlay.getBoundingClientRect(); const k = overlay.width / r.width;
        const pt = [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
        if (copyMode && !copyFrom) { aimCopy = pt; overlay.setPointerCapture(e.pointerId); schedule(); return; }
        // (Reverse Fill in FM, picking: no trail, just the magnifier showing what's under the finger.)
        cleanStroke = rfTool.on ? rfTool.strokeAt(pt, k) : { pts: [pt], r: prefs.cleanSize * k };
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
      if (placeGesture || placing?.stroke) { placeMove(e); return; }
      if (aimCopy) { const r = overlay.getBoundingClientRect(); const k = overlay.width / r.width; aimCopy = [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; schedule(); return; }
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
    const end = (e) => {
      if (placePointers.size || placeGesture || placing?.stroke) { placeUp(e); return; }
      if (aimCopy) { const pt = aimCopy; aimCopy = null; if (e?.type === 'pointerup') pickCopyFrom(pt); else schedule(); return; }
      if (cleanStroke) { const st = cleanStroke; cleanStroke = null; if (rfTool.on) rfTool.stroke(st); else runCleanUp(st); return; }
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
  /** Source pixels → overlay pixels, as a canvas transform [a, b, c, d, e, f] (for drawing on the overlay in source pixels). */
  function sourceToOverlayMatrix() {
    const M = outputToSource(viewState(), source.width, source.height);
    const det = M[0] * M[4] - M[1] * M[3]; if (!det) return null;
    const at = (x, y) => { const su = x / source.width - M[2]; const sv = y / source.height - M[5]; return [((M[4] * su - M[1] * sv) / det) * overlay.width, ((-M[3] * su + M[0] * sv) / det) * overlay.height]; };
    const o = at(0, 0); const ax = at(1, 0); const ay = at(0, 1);
    return [ax[0] - o[0], ax[1] - o[1], ay[0] - o[0], ay[1] - o[1], o[0], o[1]];
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
    else if (mode === 'rfill') panel.replaceChildren(...rfTool.panel());
    else if (mode === 'face') panel.replaceChildren(...facePanel());
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
    return [
      ratios,
      el('div', { class: 'ed-row ed-autocrop' },
        el('button', { class: 'btn small-btn primary', text: '✂️ Auto-Crop', onclick: (e) => runAutoCrop(e.currentTarget, autoNote) }),
        autoNote),
      barColorsPicker(prefs.autoCropColors, () => savePrefs()),
      // A new shape for the photo, the space filled from the photo.
      el('div', { class: 'ed-row ed-expand-row' },
        el('button', { class: 'btn small-btn', text: '🪄 Generative Expand', onclick: (e) => startExpand(e.currentTarget) }),
        beforeExpand ? el('button', { class: 'btn small-btn ghost', text: '↩ Before expanding', onclick: backFromExpand }) : null),
      el('div', { class: 'ed-row' },
        el('button', { class: 'btn small-btn', text: '⟳ Rotate', onclick: () => commit(rotateClockwise(state())) }),
        el('button', { class: 'btn small-btn', text: '⇋ Flip', onclick: () => commit(flipHorizontal(state())) }),
        el('button', { class: 'btn small-btn ghost', text: 'Reset', onclick: () => commit({ ...state(), rotate: 0, flipH: false, flipV: false, straighten: 0, crop: { ...FULL_CROP }, ratio: 'free', markup: state().markup }) })),
      el('strong', { class: 'small', text: 'Straighten' }),
      straighten,
    ];
  }

  /** 🪄 Generative Expand: the photo with its edits, into the dialog; the result opens as a new photo. */
  async function startExpand(btn) {
    btn.disabled = true;
    try {
      const { canvas } = await renderEdited(file, state(), { maxEdge: 2048 });
      openExpandDialog({
        photo: canvas, ratio: prefs.expandRatio, place: prefs.expandPlace,
        onUse: async ({ blob, ratio, place }) => {
          prefs.expandRatio = ratio; prefs.expandPlace = place; savePrefs();
          pendingBefore = beforeExpand ?? { blob: file, name: fileName, state: state() };
          await openFile(blob, renameExt(fileName.replace(/-expanded(?=\.[^.]+$)/, ''), 'jpg', '-expanded'), null, 'crop');
        },
      });
    } catch (err) { window.alert(`Couldn't get the photo ready to expand: ${err.message}`); }
    finally { btn.disabled = false; }
  }
  /** Back to the photo (and its edits) from before expanding. */
  async function backFromExpand() {
    const b = beforeExpand; if (!b) return;
    if (!isDefault(state()) && !window.confirm('Go back to the photo before expanding? Edits made since are dropped.')) return;
    await openFile(b.blob, b.name, b.state, 'crop');
    persist(true);
  }

  /**
   * 🙂 Level this face: the photo turned so `face` is upright, eyes level and above the mouth (rotate
   * and straighten; the crop starts over).
   */
  function levelFace(face) {
    const W = source.width; const H = source.height;
    // Where a source point shows for an edit state (the inverse of the renderer's mapping).
    const map = (st, [u, v]) => {
      const M = outputToSource(st, W, H); const det = M[0] * M[4] - M[1] * M[3];
      const su = u - M[2]; const sv = v - M[5];
      const o = orientedSize(W, H, st.rotate);
      return [((M[4] * su - M[1] * sv) / det) * o.W, ((-M[3] * su + M[0] * sv) / det) * o.H];
    };
    const turn = levelTurn(face, state(), map);
    if (!turn) { fm.note = 'Couldn\'t work out how to level that face.'; renderPanel(); return; }
    fm.note = 'Leveled: eyes level, above the mouth. Undo to go back.';
    commit({ ...state(), rotate: turn.rotate, straighten: turn.straighten, crop: { ...FULL_CROP }, ratio: 'free' });
  }

  // ---------- FaceMask: find faces; cut one out as a Character, or put a Character on one ----------

  /** The faces found (biggest first, null before looking), the one picked, a note, and whether it's busy. */
  let fm = { faces: null, sel: 0, note: '', busy: false };
  async function identifyFaces() {
    fm.busy = true; fm.note = 'Looking for faces…'; renderPanel();
    try {
      const { detectFaces } = await import('../../lib/face.js');
      fm.faces = (await detectFaces(applyPatches(source, state().patches ?? []))).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
      fm.sel = 0;
      const n = fm.faces.length;
      fm.note = !n ? 'No face found in this photo. You can still insert a Character and place it by hand.'
        : n === 1 ? 'Found 1 face.' : `Found ${n} faces. Tap a number on the photo (or below) to pick one.`;
    } catch (err) { fm.note = `Couldn't look for faces: ${err.message}`; }
    finally { fm.busy = false; renderPanel(); schedule(); }
  }
  /** A tap on the photo in FaceMask: picks the face tapped (its box or its number). */
  function pickFaceAt(e) {
    if (!fm.faces?.length) return;
    const [x, y] = srcPoint(e); const W = source.width; const H = source.height;
    const i = fm.faces.findIndex((f) => x >= f.box.x * W && x <= (f.box.x + f.box.w) * W && y >= f.box.y * H - 20 && y <= (f.box.y + f.box.h) * H);
    if (i >= 0 && i !== fm.sel) { fm.sel = i; fm.note = `Face ${i + 1} picked.`; renderPanel(); schedule(); }
  }
  /** The faces outlined on the photo, each numbered (the picked one in blue). */
  function drawFaceMarks(ctx, dpr) {
    if (!fm.faces?.length) return;
    const T = sourceToOverlayMatrix(); if (!T) return;
    const k = Math.hypot(T[0], T[1]) || 1; const W = source.width; const H = source.height;
    ctx.save(); ctx.setTransform(...T);
    fm.faces.forEach((f, i) => {
      const on = i === fm.sel;
      ctx.lineWidth = ((on ? 3 : 2) * dpr) / k; ctx.setLineDash(on ? [] : [(6 * dpr) / k, (4 * dpr) / k]);
      ctx.strokeStyle = on ? '#0a84ff' : 'rgba(255,255,255,0.9)';
      // The face's own outline (what's cut out), or its box when its landmarks don't make one.
      const c = faceContour(f, W, H);
      if (c) { ctx.beginPath(); c.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke(); }
      else ctx.strokeRect(f.box.x * W, f.box.y * H, f.box.w * W, f.box.h * H);
    });
    ctx.restore();
    if (fm.faces.length > 1) drawBadges(ctx, dpr, fm.faces, fm.sel);
  }
  /** A number on each face (at the top of its box), `sel` highlighted. */
  function drawBadges(ctx, dpr, faces, sel) {
    const T = sourceToOverlayMatrix(); if (!T) return;
    const k = Math.hypot(T[0], T[1]) || 1; const W = source.width; const H = source.height;
    ctx.save(); ctx.setTransform(...T);
    const r = (13 * dpr) / k;
    faces.forEach((f, i) => {
      const x = (f.box.x + f.box.w / 2) * W; const y = f.box.y * H;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = i === sel ? '#0a84ff' : 'rgba(0,0,0,0.6)'; ctx.fill();
      ctx.lineWidth = (2 * dpr) / k; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `700 ${(14 * dpr) / k}px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y + 0.5 / k);
    });
    ctx.restore();
  }
  /** ✂️ Cut out & save as Character: the picked face cut out (smart edges), named, kept. */
  async function saveFaceCharacter() {
    const face = fm.faces?.[fm.sel]; if (!face) return;
    fm.busy = true; fm.note = 'Cutting out the face…'; renderPanel();
    try {
      const { cutOutFace } = await import('./facemask.js');
      const cut = cutOutFace(applyPatches(source, state().patches ?? []), face);
      if (!cut) { fm.note = 'Nothing was left to cut out there.'; return; }
      const blob = await encodeCanvas(cut, 'image/png');
      const name = await nameCharacter(blob, `Face ${(await listCharacters()).length + 1}`);
      if (name == null) { fm.note = ''; return; }
      await addCharacter(blob, { name, width: cut.width, height: cut.height, face: cut.face });
      fm.note = `Saved "${name}" as a Character. 🎭 Insert Character puts it on a face (here or in another photo); fine-tune its edge in Cutout if you like.`;
    } catch (err) { fm.note = `Couldn't cut it out: ${err.message}`; }
    finally { fm.busy = false; renderPanel(); }
  }
  /** The face as cut out, and a name for it: the name, or null when cancelled. */
  function nameCharacter(blob, suggested) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const input = el('input', { type: 'text', value: suggested, 'aria-label': 'Character name', maxlength: '80' });
      const dlg = el('dialog', { class: 'ed-dialog fm-save' }, el('form', { method: 'dialog', class: 'sheet' },
        el('h2', { text: '✂️ Save as Character' }),
        el('span', { class: 'checker big' }, el('img', { src: url, alt: 'The face, cut out' })),
        el('label', { class: 'field' }, el('span', { text: 'Name' }), input),
        el('div', { class: 'row end' }, el('button', { class: 'btn ghost', value: 'cancel', text: 'Cancel' }), el('button', { class: 'btn primary', value: 'save', text: 'Save' }))));
      dlg.addEventListener('close', () => { URL.revokeObjectURL(url); dlg.remove(); resolve(dlg.returnValue === 'save' ? (input.value.trim() || suggested) : null); });
      document.body.append(dlg);
      dlg.showModal();
      input.select();
    });
  }

  function facePanel() {
    if (placing) return placingPanel();
    const n = fm.faces?.length ?? 0; const looked = fm.faces !== null;
    return [
      el('p', { class: 'small muted', text: 'Find the faces, then cut one out to keep as a Character, or put one of your Characters on a face.' }),
      el('div', { class: 'fm-actions' },
        el('button', { class: 'btn', text: '⚡ Quick Swap', disabled: fm.busy, onclick: () => quickSwap(true) }),
        fm.quickCut ? el('button', { class: 'btn', text: '✂️ Keep that face as a Character', disabled: fm.busy, onclick: keepQuickFace }) : null),
      el('div', { class: 'fm-actions' },
        el('button', { class: `btn${looked ? '' : ' primary'}`, text: looked ? '🙂 Find faces again' : '🙂 Identify faces', disabled: fm.busy, onclick: identifyFaces })),
      n > 1 ? el('div', { class: 'chips', role: 'group', 'aria-label': 'Which face' },
        ...fm.faces.map((_, i) => el('button', { class: `chip${fm.sel === i ? ' active' : ''}`, 'aria-pressed': String(fm.sel === i), text: `Face ${i + 1}`, onclick: () => { fm.sel = i; renderPanel(); schedule(); } }))) : null,
      looked ? el('div', { class: 'fm-actions' },
        n ? el('button', { class: 'btn primary', text: '✂️ Cut out & save as Character', disabled: fm.busy, onclick: saveFaceCharacter }) : null,
        el('button', { class: 'btn primary', text: '🎭 Insert Character', disabled: fm.busy, onclick: (e) => startPlacing(e.currentTarget) }),
        n ? el('button', { class: 'btn', text: '🙂 Level this face', disabled: fm.busy, onclick: () => levelFace(fm.faces[fm.sel]) }) : null) : null,
      fm.note ? el('p', { class: 'small', 'aria-live': 'polite', text: fm.note }) : null,
    ].filter(Boolean);
  }

  // ---------- ⚡ Quick Swap ----------

  /**
   * The two photos for a Quick Swap: the one to change (`here`: this photo, unless another is picked)
   * and the one with the face to put on it. { base (a file, or null for this photo), face } or null.
   */
  function pickSwapPhotos(here) {
    return new Promise((resolve) => {
      const chosen = { base: null, face: null };
      const slot = (key, n, label, hint) => {
        const input = el('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: `qs-${key}` });
        const thumb = el('span', { class: 'qs-thumb', 'aria-hidden': 'true' });
        const name = el('span', { class: 'small muted', text: key === 'base' && here ? 'This photo' : hint });
        const pick = el('label', { class: 'btn small-btn', for: `qs-${key}`, text: key === 'base' && here ? 'Change' : 'Choose' });
        input.addEventListener('change', () => {
          const f = input.files[0]; input.value = ''; if (!f) return;
          chosen[key] = f; name.textContent = f.name || 'Photo chosen'; pick.textContent = 'Change';
          const url = URL.createObjectURL(f); thumb.replaceChildren(el('img', { src: url, alt: '' })); thumb.querySelector('img').onload = () => URL.revokeObjectURL(url);
          ready();
        });
        return el('div', { class: 'qs-slot' }, thumb,
          el('div', { class: 'qs-text' }, el('strong', { text: `${n}. ${label}` }), name), pick, input);
      };
      const go = el('button', { class: 'btn primary', value: 'go', text: '⚡ Swap', disabled: true });
      const ready = () => { go.disabled = !((chosen.base || here) && chosen.face); };
      const dlg = el('dialog', { class: 'ed-dialog qs-pick' }, el('form', { method: 'dialog', class: 'sheet' },
        el('h2', { text: '⚡ Quick Swap' }),
        el('p', { class: 'small muted', text: 'The face in the second photo goes on the face in the first (the biggest one, if there are several): cut out, fitted, recolored and blended, then placed. Undo takes it back.' }),
        slot('base', 1, 'The photo to change', 'Choose the photo whose face is replaced'),
        slot('face', 2, 'The face to put on it', 'Choose a photo of the new face'),
        el('div', { class: 'row end' }, el('button', { class: 'btn ghost', value: 'cancel', text: 'Cancel' }), go)));
      dlg.addEventListener('close', () => { dlg.remove(); resolve(dlg.returnValue === 'go' ? chosen : null); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  /**
   * ⚡ Quick Swap: two photos in, a finished swap out. The first opens (in FaceMask); the biggest face
   * in the second is cut out (with its landmarks); it's fitted onto the biggest face in the first,
   * recolored and blended, and placed as one undo step, ready to save with Done. `here`: offer this
   * photo as the first.
   */
  async function quickSwap(here = false) {
    const picked = await pickSwapPhotos(here && !!(history && file));
    if (!picked) return;
    if (picked.base) {
      if (history && file && !isDefault(state()) && !window.confirm('Open the new photo? Edits to the current one will be discarded.')) return;
      teardown();
      await openFile(picked.base, picked.base.name || 'photo.jpg');
      if (!history || !source) return;
    }
    fm.busy = true; fm.quickCut = null; fm.note = '⚡ Finding the faces…'; renderPanel();
    try {
      const { detectFaces } = await import('../../lib/face.js');
      const { cutOutFace } = await import('./facemask.js');
      const biggest = (faces) => faces.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
      // The face to put on: the biggest one in the second photo, cut out with its landmarks.
      const bm = await decodeImage(picked.face, await sniffType(picked.face));
      const fit = fitSize(bm.width, bm.height, PREVIEW_MAX);
      const other = drawToCanvas(bm, fit.width, fit.height, null); bm.close?.();
      const theirs = biggest(await detectFaces(other))[0];
      if (!theirs) { fm.note = 'No face found in the second photo. Try one where the face is clear and facing the camera.'; return; }
      fm.note = '⚡ Cutting out the face…'; renderPanel();
      const cut = cutOutFace(other, theirs);
      if (!cut?.face) { fm.note = 'Couldn\'t cut the face out of the second photo.'; return; }
      // The face it goes on: the biggest one here.
      fm.faces = biggest(await detectFaces(applyPatches(source, state().patches ?? []))); fm.sel = 0;
      if (!fm.faces.length) { fm.note = 'No face found in the first photo.'; return; }
      fm.note = '⚡ Fitting and blending…'; renderPanel();
      const W = source.width; const H = source.height;
      const full = pixelsOf(cut, 1024); const small = pixelsOf(cut, 420);
      placing = { name: 'the new face', full, small, aspect: full.w / full.h, x: W / 2, y: H / 2, width: W * 0.35, rot: 0, blend: 70, fit: false, trim: true, faceObj: null, preview: null, faces: fm.faces, face: -1, shown: null, charFace: cut.face, flip: false, userFlip: false, mirror: {}, tune: newTune(), paint: [], brush: null, brushSize: 22 };
      renderShown();
      await findFaces(); await withParts();
      await placeOnFace(true, 0);
      await upscaleIfSmall();
      if (!placing?.fit) { placing = null; fm.note = 'Couldn\'t line the faces up. Try 🎭 Insert Character to place it by hand.'; return; }
      const flipped = placing.flip;
      await finishPlacing();
      fm.quickCut = cut;
      fm.note = `⚡ Swapped${flipped ? ' (flipped to look the same way)' : ''}. Tap Done to save or share it; Undo takes it back.`;
    } catch (err) { placing = null; fm.note = `Quick Swap didn't work: ${err.message}`; }
    finally { fm.busy = false; renderPanel(); schedule(); }
  }
  /** The face a Quick Swap used, kept as a Character (to use again). */
  async function keepQuickFace() {
    const cut = fm.quickCut; if (!cut) return;
    try {
      const blob = await encodeCanvas(cut, 'image/png');
      const name = await nameCharacter(blob, `Face ${(await listCharacters()).length + 1}`);
      if (name == null) return;
      await addCharacter(blob, { name, width: cut.width, height: cut.height, face: cut.face });
      fm.quickCut = null; fm.note = `Saved "${name}" as a Character.`;
    } catch (err) { fm.note = `Couldn't save it: ${err.message}`; }
    renderPanel();
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

  // ---------- ➕ Character ----------

  let placeNote = '';
  /** Pick one of the Characters (or any image); { blob, name } or null. */
  function pickCharacter() {
    return new Promise(async (resolve) => {
      const list = await listCharacters();
      let picked = null;
      const input = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'ed-char-file' });
      const grid = el('div', { class: 'char-grid' });
      const dlg = el('dialog', { class: 'ed-dialog ed-char-pick' }, el('form', { method: 'dialog', class: 'sheet' },
        el('h2', { text: '➕ Add a Character' }),
        el('p', { class: 'small muted', text: 'It goes on the face if there is one (or the middle): drag it, pinch or use the sliders to size and turn it, and match its color to the photo.' }),
        list.length ? grid : el('p', { class: 'muted small', text: 'No Characters yet: make one in Cutout (🙂 Cut out face, then Save as Character), or use any image.' }),
        el('div', { class: 'row end' }, el('label', { class: 'btn ghost', for: 'ed-char-file', text: 'Use another image…' }), el('button', { class: 'btn ghost', value: 'cancel', text: 'Cancel' })), input));
      const urls = [];
      grid.replaceChildren(...await Promise.all(list.map(async (c) => {
        const blob = await getCharacterBlob(c.id); if (!blob) return null;
        const u = URL.createObjectURL(blob); urls.push(u);
        return el('button', { type: 'button', class: 'char-card', 'aria-label': c.name, onclick: () => { picked = { blob, name: c.name, face: c.face ?? null }; dlg.close(); } },
          el('span', { class: 'checker' }, el('img', { src: u, alt: '' })), el('span', { class: 'small', text: c.name }));
      })).then((x) => x.filter(Boolean)));
      input.addEventListener('change', () => { const f = input.files[0]; if (f) { picked = { blob: f, name: f.name.replace(/\.[^.]+$/, '') }; dlg.close(); } });
      dlg.addEventListener('close', () => { dlg.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); resolve(picked); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  /** The image's pixels at most `max` across: { rgba, w, h }. */
  function pixelsOf(img, max) {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * k)); const h = Math.max(1, Math.round(img.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h);
    return { rgba: x.getImageData(0, 0, w, h).data, w, h };
  }

  /** ➕ Character: choose one, and it's placed on the biggest face (or the middle) to adjust. */
  async function startPlacing(btn) {
    btn.disabled = true;
    try {
      const pick = await pickCharacter(); if (!pick) return;
      const bitmap = await decodeImage(pick.blob, await sniffType(pick.blob));
      const full = pixelsOf(bitmap, 1024); const small = pixelsOf(bitmap, 420);
      bitmap.close?.();
      const W = source.width; const H = source.height;
      placing = { name: pick.name, full, small, aspect: full.w / full.h, x: W / 2, y: H / 2, width: W * 0.35, rot: 0, blend: 70, fit: false, trim: true, faceObj: null, preview: null, faces: fm.faces, face: -1, shown: null, charFace: pick.face ?? undefined, flip: false, userFlip: false, mirror: {}, tune: newTune(), paint: [], brush: null, brushSize: 22 };
      renderShown();
      placeNote = 'Lining it up…'; renderPanel(); schedule();
      await findFaces(); await withParts();
      await placeOnFace(true, fm.faces?.length ? fm.sel : 'next');
      if (await upscaleIfSmall()) { refreshPreview(); renderPanel(); }
    } catch (err) { placeNote = `Couldn't add it: ${err.message}`; placing = null; renderPanel(); }
    finally { btn.disabled = false; }
  }

  /**
   * The face-part maps (lib/face-parts.js: what's hair, what's face skin), in FM: the Character's own,
   * to keep only its face (not its hair, its background, a flower behind an ear); and the photo's, to
   * keep that face's hair in front of it (hairInFront, when it's built). Without them (not available
   * here), as before.
   */
  async function withParts() {
    const p = placing; if (!faceApp || !p || p.partsDone) return;
    p.partsDone = true;
    try {
      const { segmentParts } = await import('../../lib/face-parts.js');
      const c = document.createElement('canvas'); c.width = p.full.w; c.height = p.full.h;
      c.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(p.full.rgba), c.width, c.height), 0, 0);
      const own = await segmentParts(c);
      if (own && placing === p) { p.full = keepOwnFace(p.full, own, p.charFace); p.small = keepOwnFace(p.small, own, p.charFace); p.mirror = {}; renderShown(); }
      const photo = await segmentParts(applyPatches(source, state().patches ?? []), 1024);
      if (photo && placing === p) p.parts = photo;
    } catch { /* without them */ }
  }

  /**
   * A Character whose face is much smaller than the one it goes on (it would be blown up half again or
   * more): made twice as big first, its detail drawn in (lib/upscale.js: a compact super-resolution
   * network, on the phone), so it isn't put on blurry; then lined up again. Whether it was.
   */
  async function upscaleIfSmall() {
    const p = placing;
    if (!faceApp || !p?.fit || !p.charFace?.box || !p.faceObj || p.upscaled) return false;
    const need = (p.faceObj.box.w * source.width) / (p.charFace.box.w * p.full.w);
    if (!(need > 1.5) || p.full.w * p.full.h > 1_200_000) return false;
    const was = placeNote;
    try {
      placeNote = 'Sharpening the new face (it\'s small)…'; renderPanel();
      // (Only its face, with room around it, by the network: the rest of it is trimmed off anyway.)
      const { upscaleRegion } = await import('../../lib/upscale.js');
      const fb = p.charFace.box; const m = 0.2;
      const up = await upscaleRegion(p.full, { x: fb.x - fb.w * m, y: fb.y - fb.h * m, w: fb.w * (1 + 2 * m), h: fb.h * (1 + 2 * m) });
      if (placing !== p || !up) return false;
      p.full = up; p.mirror = {}; p.upscaled = true;
      Object.assign(p, layoutOn(p.faceObj));
      placeNote = `${was} Its face was small, so it was made twice as big first, its detail drawn in.`;
      return true;
    } catch { placeNote = was; return false; } // (as it was: fitted without)
  }

  /** 🙂 On a face: the Character over the next face found (sized and turned to it). */
  /**
   * The faces in the photo (biggest first), and the Character's own face if it has one (a face cut out
   * in Cutout), found once per placing.
   */
  async function findFaces() {
    const { detectFaces } = await import('../../lib/face.js');
    if (!placing.faces) { placing.faces = (await detectFaces(applyPatches(source, state().patches ?? []))).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h); fm.faces = placing.faces; }
    if (!placing.faces.length || placing.charFace !== undefined) return;
    const c = document.createElement('canvas'); c.width = placing.full.w; c.height = placing.full.h;
    c.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(placing.full.rgba), c.width, c.height), 0, 0);
    placing.charFace = await ownFace(detectFaces, c);
  }
  /**
   * The face in a Character's image (one saved before its face was kept with it, or any picture of a
   * face): looked for with room around it on a plain background (a face cropped tight to its edges
   * is hard to find), then put back in the image's own terms. null when there's none.
   */
  async function ownFace(detectFaces, img) {
    const w = img.width; const h = img.height; const m = Math.round(Math.max(w, h) * 0.45);
    const pad = document.createElement('canvas'); pad.width = w + 2 * m; pad.height = h + 2 * m;
    const px = pad.getContext('2d'); px.fillStyle = '#808080'; px.fillRect(0, 0, pad.width, pad.height); px.drawImage(img, m, m);
    try {
      const found = (await detectFaces(pad, { minScore: 0.4 })).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
      if (!found) return null;
      const { faceInCrop } = await import('./facemask.js');
      return faceInCrop(found, pad.width, pad.height, { x: m, y: m, width: w, height: h });
    } catch { return null; }
  }
  /**
   * Where the Character goes on face `f`: with a face of its own, its eyes on the face's eyes and its
   * mouth on the mouth (sized and turned by them); otherwise covering the face, turned with it.
   */
  function layoutOn(f) {
    const W = source.width; const H = source.height;
    // Flipped when it looks the other way from that face (and flipped again by hand with ⇋ Flip).
    if (placing.charFace) {
      const flip = shouldFlip(placing.charFace, placing.full.w, placing.full.h, f, W, H) !== placing.userFlip;
      // Placed for a realistic face on it (by its features, sized for a natural forehead), as it's painted.
      const at = { ...placing, flip }; const cf = charOf(at); const img = pixelsAt(at, 'full');
      f.outline ??= targetOutline(sourcePixels(), W, H, f);
      return { ...realPlacement(cf, img.w, img.h, f, W, H, { outline: f.outline, own: ownOutline(img.rgba, img.w, img.h, cf) }), flip };
    }
    const flip = placing.userFlip;
    // No face of its own found: a face-only Character as wide as the face itself (jaw to jaw), a mask
    // a little wider; centered and turned with the face.
    const m = maskLayer(f, placing.aspect, W / H, 1.35);
    const c = faceContour(f, W, H);
    if (c && f.pts) {
      const jaw = Math.hypot((f.pts[16][0] - f.pts[0][0]) * W, (f.pts[16][1] - f.pts[0][1]) * H);
      return { x: m.x * W, y: m.y * H, width: Math.min(m.scale * W, jaw * 1.08), rot: m.rot, flip };
    }
    return { x: m.x * W, y: m.y * H, width: m.scale * W, rot: m.rot, flip };
  }
  /** The Character's pixels ('full' or 'small') and its face, as placed at `at`: flipped left to right when it is. */
  function pixelsAt(at, size) {
    if (!at.flip) return at[size];
    return (at.mirror[size] ??= mirrorPixels(at[size]));
  }
  function charOf(at) {
    if (!at.flip || !at.charFace) return at.charFace;
    return (at.mirror.face ??= mirrorFace(at.charFace));
  }
  /** ⇋ Flip: the Character mirrored (to look the other way); fitted again if it was fitted. */
  function flipPlacing() {
    const p = placing; if (!p) return;
    p.userFlip = !p.userFlip; p.flip = !p.flip;
    if (p.fit && p.faceObj) Object.assign(p, layoutOn(p.faceObj));
    placeNote = p.flip ? 'Flipped: it looks the other way.' : 'Not flipped: as it was saved.';
    p.preview = null; renderShown(); refreshPreview(); renderPanel(); schedule();
  }
  /** 🙂 On a face: the Character over face `which` (an index; 'next' for the next one). */
  async function placeOnFace(first = false, which = 'next') {
    if (!placing) return;
    try {
      await findFaces();
      if (!placing?.faces.length) { placeNote = first ? 'No face found: placed in the middle. Drag it where it goes.' : 'No face found in this photo.'; return; }
      const n = placing.faces.length;
      placing.face = which === 'next' ? (placing.face + 1) % n : Math.max(0, Math.min(n - 1, which));
      fm.sel = placing.face;
      Object.assign(placing, layoutOn(placing.faces[placing.face]), { faceObj: placing.faces[placing.face], fit: !!placing.charFace, tune: newTune(), paint: [] });
      const how = placing.charFace ? 'fitted to the face: eyes, jaw, brows, nose and mouth lined up' : 'sized to the face';
      const turned = placing.flip && !placing.userFlip ? ' Flipped to look the same way as the face (⇋ Flip turns it back).' : '';
      placeNote = (n > 1 ? `On face ${placing.face + 1} of ${n} (${how}). Tap a number to pick another face.` : `On the face (${how}). Drag, pinch or use the sliders to adjust.`) + turned;
      renderShown();
    } catch (err) { placeNote = `Couldn't look for faces: ${err.message}`; }
    finally { refreshPreview(); renderPanel(); schedule(); }
  }
  /** The numbered badges on the faces (source px): where to tap to pick one. */
  const faceBadges = () => (placing?.faces ?? []).map((f, i) => ({ i, x: (f.box.x + f.box.w / 2) * source.width, y: f.box.y * source.height }));

  /** The Character as it is (shown while it's being moved). */
  function renderShown() {
    const small = pixelsAt(placing, 'small');
    const c = placing.shown ?? document.createElement('canvas'); c.width = small.w; c.height = small.h;
    c.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(small.rgba), small.w, small.h), 0, 0);
    placing.shown = c;
  }
  /**
   * The Character as it will be painted, at `at` (a placing, or one per face): fitted onto its face
   * (bent to its landmarks and trimmed to its head) when it's fitted, else as placed; then blended into
   * the photo around it, each side to what's next to it.
   */
  async function buildPatch(at, size) {
    const W = source.width; const H = source.height;
    const photo = sourcePixels();
    const img = pixelsAt(at, size);
    if (at.fit && at.charFace && at.faceObj) {
      // (The face in the photo, where it ends: its jaw and its hairline, found once per face.)
      at.faceObj.outline ??= targetOutline(photo, W, H, at.faceObj);
      const opts = { trim: at.trim, blend: at.blend, tune: at.tune, paint: at.paint, turn3d: !!at.turn3d, mouth: !!at.mouth };
      // Off the page's thread (fit-worker.js), so the screen doesn't freeze; here if that can't be.
      try { return await fitOffThread(photo, W, H, img, charOf(at), at.faceObj, at.parts, opts); } catch { /* here */ }
      return buildFitted(photo, W, H, img, charOf(at), at.faceObj, { ...opts, parts: at.parts });
    }
    const patch = placedPatch(img.rgba, img.w, img.h, at, W, H);
    if (patch) blendIn(patch, photo, W, H, at.blend / 100);
    return patch;
  }

  // The worker for that (fit-client.js), one per photo opened.
  let fits = null;
  function fitOffThread(photo, W, H, img, charFace, face, parts, opts) {
    if (!fits) { fits = fitClient(); cleanups.push(() => { fits?.close(); fits = null; }); }
    return fits.build(photo, W, H, img, charFace, face, parts, opts);
  }
  /** The preview of that (from the smaller copy), worked out after each change, not while moving. */
  let previewTimer = 0; let previewSeq = 0;
  function refreshPreview() {
    if (!placing) return;
    placing.preview = null;
    clearTimeout(previewTimer);
    const seq = ++previewSeq;
    previewTimer = setTimeout(async () => {
      if (!placing) return;
      const p = placing;
      let patch = null; try { patch = await buildPatch(p, 'small'); } catch { patch = null; }
      // (Only the newest: a change made while it was worked out starts another.)
      if (seq !== previewSeq || placing !== p) return;
      if (!patch) { schedule(); return; }
      const c = document.createElement('canvas'); c.width = patch.pw; c.height = patch.ph;
      c.getContext('2d').putImageData(new ImageData(patch.rgba, patch.pw, patch.ph), 0, 0);
      placing.preview = { x0: patch.x0, y0: patch.y0, canvas: c };
      schedule();
    }, 30);
  }

  function drawPlacing(ctx, dpr) {
    const T = sourceToOverlayMatrix(); if (!T || !placing.shown) return;
    const k = Math.hypot(T[0], T[1]) || 1;
    ctx.save();
    ctx.setTransform(...T);
    // As it will be painted (fitted and blended), or, while it's being moved, as it is.
    const pv = !placeGesture && placing.preview;
    if (pv) { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(pv.canvas, pv.x0, pv.y0); }
    ctx.save();
    ctx.translate(placing.x, placing.y); ctx.rotate(placing.rot);
    const w = placing.width; const h = w / placing.aspect;
    if (!pv) ctx.drawImage(placing.shown, -w / 2, -h / 2, w, h);
    ctx.lineWidth = (1.5 * dpr) / k; ctx.setLineDash([(6 * dpr) / k, (4 * dpr) / k]); ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.restore();
    // The brush stroke being drawn (green: more; red: less).
    if (placing.stroke) {
      const st = placing.stroke;
      ctx.save(); ctx.setTransform(...T);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = st.r * 2; ctx.strokeStyle = st.add ? 'rgba(48,209,88,0.45)' : 'rgba(255,69,58,0.45)';
      ctx.beginPath(); st.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (st.pts.length === 1) ctx.lineTo(st.pts[0][0] + 0.1, st.pts[0][1]);
      ctx.stroke(); ctx.restore();
    }
    // With more than one face: a number on each (the one it's on highlighted), to tap to move it there.
    if ((placing.faces?.length ?? 0) > 1) drawBadges(ctx, dpr, placing.faces, placing.face);
  }

  const srcPoint = (e) => { const r = overlay.getBoundingClientRect(); const k = overlay.width / r.width; return overlayToSource((e.clientX - r.left) * k, (e.clientY - r.top) * k); };
  function placeDown(e) {
    // A tap on a face's number: the Character moves to that face.
    if (!placePointers.size && (placing.faces?.length ?? 0) > 1) {
      const p = srcPoint(e); const T = sourceToOverlayMatrix(); const k = T ? Math.hypot(T[0], T[1]) : 1;
      const r = overlay.width / (overlay.getBoundingClientRect().width || overlay.width); // overlay px per screen px
      const hit = faceBadges().find((b) => Math.hypot(b.x - p[0], b.y - p[1]) * k <= 22 * r);
      if (hit) { placeOnFace(false, hit.i); return; }
    }
    // 🖌 / 🧽 brushing: a stroke of more (or less) of the new face, not a move.
    if (placing.brush && placing.fit) {
      if (placing.stroke) return;
      overlay.setPointerCapture(e.pointerId);
      const T = sourceToOverlayMatrix(); const kT = T ? Math.hypot(T[0], T[1]) : 1;
      const r = (placing.brushSize * (overlay.width / (overlay.getBoundingClientRect().width || overlay.width))) / kT;
      placing.stroke = { id: e.pointerId, pts: [srcPoint(e)], r, add: placing.brush === 'add' };
      schedule(); return;
    }
    overlay.setPointerCapture(e.pointerId);
    placePointers.set(e.pointerId, srcPoint(e));
    if (placing.fit && !placing.tuneFrom) placing.tuneFrom = { x: placing.x, y: placing.y, width: placing.width, rot: placing.rot };
    const pts = [...placePointers.values()];
    // Fitted: moving or pinching it fine-tunes the fit (it stays fitted); otherwise placed as you put it.
    if (pts.length >= 2) {
      const [p, q] = pts;
      placeGesture = { kind: 'pinch', d: Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, ang: Math.atan2(q[1] - p[1], q[0] - p[0]), mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], width: placing.width, rot: placing.rot, x: placing.x, y: placing.y };
    } else placeGesture = { kind: 'move', start: pts[0], x: placing.x, y: placing.y };
  }
  function placeMove(e) {
    if (placing.stroke?.id === e.pointerId) { const p = srcPoint(e); const l = placing.stroke.pts.at(-1); if (Math.hypot(p[0] - l[0], p[1] - l[1]) > placing.stroke.r * 0.25) { placing.stroke.pts.push(p); schedule(); } return; }
    if (!placePointers.has(e.pointerId)) return;
    placePointers.set(e.pointerId, srcPoint(e));
    const pts = [...placePointers.values()]; const g = placeGesture;
    if (g.kind === 'move') { placing.x = g.x + pts[0][0] - g.start[0]; placing.y = g.y + pts[0][1] - g.start[1]; }
    else if (pts.length >= 2) {
      const [p, q] = pts;
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]); const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      placing.width = Math.max(8, g.width * (d / g.d)); placing.rot = g.rot + Math.atan2(q[1] - p[1], q[0] - p[0]) - g.ang;
      placing.x = g.x + mid[0] - g.mid[0]; placing.y = g.y + mid[1] - g.mid[1];
    }
    schedule();
  }
  function placeUp(e) {
    if (placing.stroke) {
      const st = placing.stroke; placing.stroke = null;
      if (e?.type === 'pointerup') { placing.paint.push({ pts: st.pts, r: st.r, add: st.add }); placeNote = st.add ? 'More of the new face there.' : 'Less of the new face there: the photo shows.'; }
      refreshPreview(); renderPanel(); schedule(); return;
    }
    placePointers.delete(e?.pointerId);
    const g = placeGesture;
    if (placePointers.size === 1 && g?.kind === 'pinch') { const [p] = placePointers.values(); placeGesture = { kind: 'move', start: p, x: placing.x, y: placing.y }; return; }
    if (placePointers.size) return;
    placeGesture = null;
    // (Fitted: what the gesture did, as fine-tuning on top of the fit.)
    if (placing.fit && placing.tuneFrom) {
      const f = placing.tuneFrom; const t = placing.tune; placing.tuneFrom = null;
      t.dx += placing.x - f.x; t.dy += placing.y - f.y; t.scale *= placing.width / f.width; t.rot += placing.rot - f.rot;
      placeNote = 'Fine-tuned by hand, still fitted to the face (↺ Reset fine-tuning puts it back).';
    }
    refreshPreview(); renderPanel(); schedule();
  }

  function placingPanel() {
    const p = placing; const W = source.width;
    let live = 0;
    const later = (fn) => { clearTimeout(live); live = setTimeout(fn, 120); };
    const unfit = () => { if (p.fit) { p.fit = false; placeNote = 'Placed by hand (not fitted). 🧬 Fit to face lines it up again.'; } };
    const size = slider({ min: 2, max: 160, value: Math.round((p.width / W) * 100), label: 'Character size', onInput: (v) => { unfit(); p.preview = null; p.width = Math.max(4, (v / 100) * W); schedule(); }, onChange: () => { refreshPreview(); renderPanel(); } });
    const turn = slider({ min: -180, max: 180, value: Math.round((p.rot * 180) / Math.PI), label: 'Character turn', onInput: (v) => { unfit(); p.preview = null; p.rot = (v * Math.PI) / 180; schedule(); }, onChange: () => { refreshPreview(); renderPanel(); } });
    const blend = slider({ min: 0, max: 100, value: p.blend, label: 'Blend into the photo', onInput: (v) => { p.blend = v; later(refreshPreview); }, onChange: () => {} });
    const canFit = !!(p.charFace && p.faces?.length);
    return [
      el('div', { class: 'ed-row' }, el('strong', { class: 'small', text: `🎭 ${p.name}` }), el('span', { class: 'muted small', 'aria-live': 'polite', text: placeNote })),
      (p.faces?.length ?? 0) > 1 ? el('div', { class: 'chips', role: 'group', 'aria-label': 'Which face' },
        ...p.faces.map((_, i) => el('button', { class: `chip${p.face === i ? ' active' : ''}`, 'aria-pressed': String(p.face === i), text: `Face ${i + 1}`, onclick: () => placeOnFace(false, i) })),
        el('button', { class: 'chip', text: '🙂 On every face', onclick: () => finishPlacing(true) })) : null,
      el('div', { class: 'chips' },
        canFit ? el('button', { class: `chip${p.fit ? ' active' : ''}`, 'aria-pressed': String(p.fit), text: '🧬 Fit to face', onclick: () => placeOnFace(false, Math.max(0, p.face)) }) : null,
        canFit && p.fit ? el('button', { class: `chip${p.trim ? ' active' : ''}`, 'aria-pressed': String(p.trim), text: '✂️ Trim to head', onclick: () => { p.trim = !p.trim; refreshPreview(); renderPanel(); } }) : null,
        // (Off unless asked for: each can look forced. Its own mouth and its own pose, as it is.)
        canFit && p.fit ? el('button', { class: `chip${p.mouth ? ' active' : ''}`, 'aria-pressed': String(!!p.mouth), text: '👄 Match the mouth', onclick: () => { p.mouth = !p.mouth; placeNote = p.mouth ? 'Its mouth closed (or opened) to match the face it\'s on.' : 'Its own mouth, as it is.'; refreshPreview(); renderPanel(); } }) : null,
        canFit && p.fit ? el('button', { class: `chip${p.turn3d ? ' active' : ''}`, 'aria-pressed': String(!!p.turn3d), text: '🧊 Turn to its pose', onclick: () => { p.turn3d = !p.turn3d; placeNote = p.turn3d ? 'Turned in 3D to the pose of the face it\'s on.' : 'As it faces in its own picture.'; refreshPreview(); renderPanel(); } }) : null,
        canFit && p.fit ? el('button', { class: `chip${p.looks ? ' active' : ''}`, 'aria-pressed': String(!!p.looks), text: '🔀 Compare looks', onclick: () => { if (p.looks) { p.looks = null; renderPanel(); } else compareLooks(); } }) : null,
        !canFit ? el('button', { class: 'chip', text: '🙂 On a face', onclick: () => placeOnFace() }) : null,
        el('button', { class: `chip${p.flip ? ' active' : ''}`, 'aria-pressed': String(p.flip), text: '⇋ Flip', onclick: flipPlacing }),
        el('button', { class: 'chip', text: '⊙ Middle', onclick: () => { unfit(); p.x = source.width / 2; p.y = source.height / 2; refreshPreview(); renderPanel(); schedule(); } })),
      p.looks ? el('div', { class: 'fm-looks', role: 'group', 'aria-label': 'Looks to choose from' },
        ...p.looks.map((l) => el('button', {
          type: 'button', class: `fm-look${!!p.mouth === l.mouth && !!p.turn3d === l.turn3d ? ' active' : ''}`, 'aria-label': l.label, 'aria-pressed': String(!!p.mouth === l.mouth && !!p.turn3d === l.turn3d),
          onclick: () => { p.mouth = l.mouth; p.turn3d = l.turn3d; placeNote = `${l.label}.`; refreshPreview(); renderPanel(); },
        }, l.canvas ?? el('span', { class: 'fm-look-wait muted small', text: '…' }), el('span', { class: 'small', text: l.label })))) : null,
      el('div', { class: 'ed-row' }, el('strong', { class: 'small', text: '🎨 Blend into the photo' }), el('span', { class: 'muted small', text: 'each side to what\'s next to it' })), blend,
      ...(p.fit ? tunePanel(p) : [el('div', { class: 'ed-row' }, el('strong', { class: 'small', text: 'Size' })), size,
        el('div', { class: 'ed-row' }, el('strong', { class: 'small', text: 'Turn' })), turn]),
      el('div', { class: 'row end' },
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => { placing = null; placeNote = ''; fm.note = ''; renderPanel(); schedule(); } }),
        el('button', { class: 'btn primary', text: '✓ Place', onclick: () => finishPlacing() })),
    ];
  }

  /**
   * 🔀 Compare looks: the fitted Character on the face four ways, side by side (as it is; its mouth
   * matched to that face's; turned to that face's pose; both), each a close-up of the face, to tap the
   * one that looks right. Worked out one after another, each shown as it's ready.
   */
  async function compareLooks() {
    const p = placing; if (!p?.fit || !p.faceObj) return;
    const looks = [
      { label: 'As it is', mouth: false, turn3d: false },
      { label: 'Mouth matched', mouth: true, turn3d: false },
      { label: 'Turned to its pose', mouth: false, turn3d: true },
      { label: 'Both', mouth: true, turn3d: true },
    ];
    p.looks = looks; renderPanel();
    // The close-up: the face and a little around it, from the photo as it is now.
    const W = source.width; const H = source.height; const fb = p.faceObj.box;
    const cx = (fb.x + fb.w / 2) * W; const cy = (fb.y + fb.h / 2) * H; const side = Math.max(fb.w * W, fb.h * H) * 1.45;
    const bx = Math.max(0, Math.round(cx - side / 2)); const by = Math.max(0, Math.round(cy - side / 2));
    const bw = Math.min(W - bx, Math.round(side)); const bh = Math.min(H - by, Math.round(side));
    const photo = applyPatches(source, state().patches ?? []);
    for (const l of looks) {
      let patch = null;
      try { patch = await buildPatch({ ...p, mouth: l.mouth, turn3d: l.turn3d }, 'small'); } catch { patch = null; }
      if (placing !== p || p.looks !== looks) return;
      const size = 132; const k = size / Math.max(bw, bh);
      const c = el('canvas', { class: 'fm-look-img' }); c.width = Math.round(bw * k); c.height = Math.round(bh * k);
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
      x.drawImage(photo, bx, by, bw, bh, 0, 0, c.width, c.height);
      if (patch) {
        const pc = document.createElement('canvas'); pc.width = patch.pw; pc.height = patch.ph;
        pc.getContext('2d').putImageData(new ImageData(patch.rgba, patch.pw, patch.ph), 0, 0);
        x.drawImage(pc, (patch.x0 - bx) * k, (patch.y0 - by) * k, patch.pw * k, patch.ph * k);
      }
      l.canvas = c; renderPanel();
    }
  }

  /**
   * Fine-tune (a fitted Character): small changes on top of the fit, which stays: its size, where it is
   * across and up/down (a share of the face's width), its turn, and how soft its edge is. Dragging and
   * pinching it do the same.
   */
  function tunePanel(p) {
    const t = p.tune; const fw = (p.faceObj?.box.w ?? 0.3) * source.width;
    // (Shown as it is, moved with the change, while the slider moves; worked out again after.)
    const show = () => {
      if (!p.tuneShown) p.tuneShown = { x: p.x - t.dx, y: p.y - t.dy, width: p.width / t.scale, rot: p.rot - t.rot };
      const b = p.tuneShown; p.x = b.x + t.dx; p.y = b.y + t.dy; p.width = b.width * t.scale; p.rot = b.rot + t.rot; p.preview = null; schedule();
    };
    const done = () => { p.tuneShown = null; refreshPreview(); renderPanel(); };
    const row = (label, el2) => [el('div', { class: 'ed-row' }, el('strong', { class: 'small', text: label })), el2];
    return [
      el('div', { class: 'ed-row' }, el('strong', { class: 'small', text: '🎚 Fine-tune' }), el('span', { class: 'muted small', text: 'still fitted to the face' }),
        el('button', { class: 'linkish small', text: '↺ Reset fine-tuning', onclick: () => { const b = { x: p.x - t.dx, y: p.y - t.dy, width: p.width / t.scale, rot: p.rot - t.rot }; Object.assign(p, b); p.tune = newTune(); refreshPreview(); renderPanel(); schedule(); } })),
      ...row('Size', slider({ min: -20, max: 20, value: Math.round((t.scale - 1) * 100), label: 'Fine-tune size', onInput: (v) => { t.scale = 1 + v / 100; show(); }, onChange: done })),
      ...row('Across', slider({ min: -15, max: 15, value: Math.round((t.dx / fw) * 100), label: 'Fine-tune across', onInput: (v) => { t.dx = (v / 100) * fw; show(); }, onChange: done })),
      ...row('Up / down', slider({ min: -15, max: 15, value: Math.round((t.dy / fw) * 100), label: 'Fine-tune up or down', onInput: (v) => { t.dy = (v / 100) * fw; show(); }, onChange: done })),
      ...row('Turn', slider({ min: -20, max: 20, value: Math.round((t.rot * 180) / Math.PI), label: 'Fine-tune turn', onInput: (v) => { t.rot = (v * Math.PI) / 180; show(); }, onChange: done })),
      ...row('Edge softness', slider({ min: 0, max: 100, value: t.soft, label: 'Edge softness', onInput: (v) => { t.soft = v; }, onChange: done })),
      // Paint more or less of it in by hand.
      el('div', { class: 'chips' },
        el('button', { class: `chip${p.brush === 'add' ? ' active' : ''}`, 'aria-pressed': String(p.brush === 'add'), text: '🖌 More of it', onclick: () => { p.brush = p.brush === 'add' ? null : 'add'; placeNote = p.brush ? 'Brush over where more of the new face should show.' : ''; renderPanel(); } }),
        el('button', { class: `chip${p.brush === 'less' ? ' active' : ''}`, 'aria-pressed': String(p.brush === 'less'), text: '🧽 Less of it', onclick: () => { p.brush = p.brush === 'less' ? null : 'less'; placeNote = p.brush ? 'Brush over where the photo should show instead.' : ''; renderPanel(); } }),
        p.paint.length ? el('button', { class: 'chip', text: '↶ Last stroke', onclick: () => { p.paint.pop(); refreshPreview(); renderPanel(); } }) : null,
        p.paint.length ? el('button', { class: 'chip', text: 'Clear brushing', onclick: () => { p.paint = []; refreshPreview(); renderPanel(); } }) : null),
      p.brush ? row('Brush size', slider({ min: 6, max: 80, value: p.brushSize, label: 'Face brush size', onInput: (v) => { p.brushSize = v; }, onChange: () => {} })) : null,
    ].flat().filter(Boolean);
  }

  /**
   * ✓ Place: the Character painted onto the photo (full detail, color matched), one undo step. `all`:
   * one on every face found, each lined up to its face (and matched to what's behind it there).
   */
  async function finishPlacing(all = false) {
    const p = placing; if (!p || p.placing) return;
    p.placing = true; placeNote = 'Placing it…'; renderPanel();
    const W = source.width; const H = source.height;
    const spots = all && p.faces?.length ? p.faces.map((f) => ({ ...p, ...layoutOn(f), faceObj: f, fit: !!p.charFace })) : [p];
    const patches = [];
    for (const at of spots) {
      let patch = null; try { patch = await buildPatch(at, 'full'); } catch { patch = null; }
      if (placing !== p) return;
      if (patch) patches.push(makePatch(patch, W, H));
    }
    placing = null;
    if (!patches.length) { placeNote = fm.note = 'It was off the photo: nothing placed.'; renderPanel(); schedule(); return; }
    placeNote = patches.length > 1 ? `Placed ${p.name} on ${patches.length} faces. Undo takes them back.` : `Placed ${p.name}. Undo takes it back.`;
    fm.note = placeNote;
    const s = state();
    commit({ ...s, patches: [...(s.patches ?? []), ...patches] });
  }

  // ---------- close / export ----------

  function closePhoto() {
    if (!isDefault(state()) && !window.confirm('Close this photo? Your edits will be discarded.')) return;
    idb.del(sessionKey);
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
  else idb.get(sessionKey).then((saved) => showStart(saved?.blob ? saved : null));

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
