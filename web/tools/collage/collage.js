// Collage & Superimpose: combine several photos into one.
//   Grid  - a layout of cells; each photo can be panned and zoomed inside its cell.
//   Free  - an optional background photo with photos or Characters on top; move, resize, rotate,
//           fade, flip and reorder each layer (one finger drags, two fingers pinch/rotate, or use
//           the corner handle).
import { el, store } from '../../lib/dom.js';
import { idb } from '../../lib/idb.js';
import { sniffType, decodeImage, fitSize, drawToCanvas, encodeCanvas, MAX_CANVAS_PIXELS } from '../../lib/image.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes } from '../../lib/files.js';
import { listCharacters, getCharacterBlob } from '../../lib/characters.js';
import { createHistory } from '../editor/state.js';
import { LAYOUTS, ASPECTS, cellRects, coverRect, panBy, layerHit, handlePoint, dragHandle, pinchTransform } from './collage-core.js';

const SAVE_KEY = 'collage.session';
const IMAGE_MAX = 2400;
const BACKGROUNDS = ['#ffffff', '#111111', '#f4efe6', '#ffd6e0', '#d6ecff', '#dff5e1', '#fff1c1'];

const defaultState = () => ({
  mode: 'grid', aspect: '1:1', bg: '#ffffff',
  layout: '4', gap: 12, radius: 0, cells: [],
  base: null, layers: [],
});

/** mount(host, { onEdit, file }) — `file` is added as a layer (e.g. a cutout); onEdit sends the result to Photo. */
export function mount(host, { onEdit, file: initialFile } = {}) {
  const images = new Map(); // id -> { blob, bmp (canvas), w, h }
  let history = createHistory(defaultState());
  let selected = null; // grid: cell index; free: layer id
  let saveTimer = 0;
  let canvas; let panel; let undoBtn; let redoBtn;
  let pickTarget = null; // { kind: 'cell', index } | { kind: 'base' } | { kind: 'layer' }
  let swapHint = null;   // while holding a photo to move it to another frame: { from, to, p }
  const st = () => history.state;

  // ---------- images ----------

  async function addImage(blob) {
    const bitmap = await decodeImage(blob, await sniffType(blob));
    const fit = fitSize(bitmap.width, bitmap.height, IMAGE_MAX);
    const bmp = drawToCanvas(bitmap, fit.width, fit.height, null);
    bitmap.close?.();
    const id = crypto.randomUUID();
    images.set(id, { blob, bmp, w: bmp.width, h: bmp.height });
    return id;
  }

  const picker = el('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: 'cl-file' });
  picker.addEventListener('change', async () => {
    const files = [...picker.files];
    picker.value = '';
    if (!files.length || !pickTarget) return;
    try {
      const ids = [];
      for (const f of files) ids.push(await addImage(f));
      placeImages(ids, pickTarget);
    } catch (err) { window.alert(err.message); }
  });

  function placeImages(ids, target) {
    const s = st();
    if (target.kind === 'cell') {
      const cells = [...s.cells];
      let i = target.index;
      for (const id of ids) { // fill this cell, then the next empty ones
        while (i < LAYOUTS[s.layout].cells.length && cells[i]?.src && i !== target.index) i += 1;
        if (i >= LAYOUTS[s.layout].cells.length) break;
        cells[i] = { src: id, zoom: 1, ox: 0, oy: 0 };
        i += 1;
      }
      commit({ ...s, cells });
      selected = target.index;
    } else if (target.kind === 'base') {
      commit({ ...s, base: ids[0], aspect: 'base' });
    } else {
      const layers = [...s.layers];
      ids.forEach((id, k) => {
        const im = images.get(id);
        const layer = { id: crypto.randomUUID(), src: id, x: 0.5 + k * 0.04, y: 0.5 + k * 0.04, scale: Math.min(0.6, 0.6 * (im.w / im.h)), rot: 0, opacity: 1, flip: false };
        layers.push(layer);
        selected = layer.id;
      });
      commit({ ...s, mode: 'free', layers });
    }
  }

  function pick(target, multiple = false) {
    pickTarget = target;
    picker.multiple = multiple;
    picker.click();
  }

  // ---------- state ----------

  function commit(next) { if (history.push(next)) changed(); }
  function live(next) { history.replace(next); draw(); }
  function changed() {
    undoBtn.disabled = !history.canUndo; redoBtn.disabled = !history.canRedo;
    renderPanel(); draw(); persist();
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const used = new Set([st().base, ...st().cells.map((c) => c?.src), ...st().layers.map((l) => l.src)].filter(Boolean));
      idb.set(SAVE_KEY, { state: st(), images: [...used].map((id) => ({ id, blob: images.get(id)?.blob })).filter((x) => x.blob), savedAt: Date.now() });
    }, 400);
  }

  // ---------- geometry ----------

  function canvasAspect() {
    const s = st();
    if (s.aspect === 'base' && s.base && images.has(s.base)) { const b = images.get(s.base); return b.w / b.h; }
    return ASPECTS[s.aspect] ?? 1;
  }

  /** Render the whole collage into ctx at W×H. `ui` adds selection outlines and handles. */
  function render(ctx, W, H, ui = false) {
    const s = st();
    ctx.save();
    ctx.fillStyle = s.bg; ctx.fillRect(0, 0, W, H);
    const k = W / 1000; // gap/radius are in thousandths of the width
    if (s.mode === 'grid') {
      const rects = cellRects(s.layout, W, H, s.gap * k);
      rects.forEach((r, i) => {
        const cell = s.cells[i];
        ctx.save();
        roundRect(ctx, r.x, r.y, r.w, r.h, s.radius * k);
        ctx.clip();
        const im = cell?.src && images.get(cell.src);
        if (im) {
          const d = coverRect(im.w, im.h, r, cell.zoom, cell.ox, cell.oy);
          ctx.drawImage(im.bmp, d.dx, d.dy, d.dw, d.dh);
        } else if (ui) {
          ctx.fillStyle = 'rgba(127,127,127,0.18)'; ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.fillStyle = 'rgba(127,127,127,0.9)'; ctx.font = `${Math.max(14, r.w * 0.12)}px -apple-system, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('+', r.x + r.w / 2, r.y + r.h / 2);
        }
        ctx.restore();
        if (ui && selected === i && !swapHint) { ctx.strokeStyle = '#0a84ff'; ctx.lineWidth = 3 * (W / canvas.clientWidth); ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3); }
        // Moving a photo to another frame: the frame it would go to, outlined.
        if (ui && swapHint && swapHint.to === i) { ctx.save(); ctx.strokeStyle = '#30d158'; ctx.lineWidth = 4 * (W / canvas.clientWidth); ctx.setLineDash([10, 6]); ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4); ctx.restore(); }
      });
    } else {
      if (s.base && images.has(s.base)) {
        const b = images.get(s.base);
        const d = coverRect(b.w, b.h, { x: 0, y: 0, w: W, h: H });
        ctx.drawImage(b.bmp, d.dx, d.dy, d.dw, d.dh);
      }
      for (const l of s.layers) {
        const im = images.get(l.src);
        if (!im) continue;
        const w = l.scale * W; const h = w * (im.h / im.w);
        ctx.save();
        ctx.translate(l.x * W, l.y * H); ctx.rotate(l.rot); if (l.flip) ctx.scale(-1, 1);
        ctx.globalAlpha = l.opacity;
        ctx.drawImage(im.bmp, -w / 2, -h / 2, w, h);
        ctx.restore();
        if (ui && selected === l.id) {
          const px = W / canvas.clientWidth;
          ctx.save();
          ctx.translate(l.x * W, l.y * H); ctx.rotate(l.rot);
          ctx.strokeStyle = '#0a84ff'; ctx.lineWidth = 2 * px; ctx.setLineDash([6 * px, 4 * px]);
          ctx.strokeRect(-w / 2, -h / 2, w, h);
          ctx.restore();
          const [hx, hy] = handlePoint(l, im.w / im.h, W, H);
          ctx.beginPath(); ctx.arc(hx, hy, 12 * px, 0, Math.PI * 2);
          ctx.fillStyle = '#0a84ff'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * px; ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw() {
    if (!canvas?.isConnected) return;
    const a = canvasAspect();
    const maxW = canvas.parentElement.clientWidth || 360;
    const maxH = Math.min(window.innerHeight * 0.55, 620);
    const cssW = Math.floor(Math.min(maxW, maxH * a)); const cssH = Math.floor(cssW / a);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    render(canvas.getContext('2d'), canvas.width, canvas.height, true);
  }

  // ---------- layout ----------

  function build() {
    canvas = el('canvas', { class: 'cl-canvas', 'aria-label': 'Collage' });
    panel = el('div', { class: 'ed-panel' });
    undoBtn = el('button', { class: 'icon-btn', 'aria-label': 'Undo', text: '↶', onclick: () => { if (history.undo()) changed(); } });
    redoBtn = el('button', { class: 'icon-btn', 'aria-label': 'Redo', text: '↷', onclick: () => { if (history.redo()) changed(); } });
    host.replaceChildren(
      el('div', { class: 'ed-top' },
        el('button', { class: 'icon-btn', 'aria-label': 'Start over', text: '✕', onclick: () => { if (window.confirm('Start a new collage? This one will be discarded.')) { history.reset(defaultState()); selected = null; idb.del(SAVE_KEY); changed(); } } }),
        el('div', { class: 'ed-top-mid' }, undoBtn, redoBtn),
        el('button', { class: 'btn primary small-btn', text: 'Done', onclick: openExport })),
      el('div', { class: 'segmented', role: 'tablist' }, ...[['grid', 'Grid'], ['free', 'Free / Superimpose']].map(([id, label]) => el('button', {
        class: `seg cl-mode${st().mode === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(st().mode === id), text: label, 'data-mode': id,
        onclick: () => { selected = null; commit({ ...st(), mode: id, aspect: id === 'free' && st().base ? 'base' : st().aspect === 'base' ? '1:1' : st().aspect }); },
      }))),
      el('div', { class: 'ed-stage cl-stage' }, canvas), panel, picker);
    bindPointer();
    changed();
  }

  function chipRow(items, active, onPick) {
    return el('div', { class: 'chips' }, ...items.map(([id, label]) => el('button', { class: `chip${active === id ? ' active' : ''}`, text: label, onclick: () => onPick(id) })));
  }

  function slider(label, min, max, value, onInput, onChange) {
    const r = el('input', { type: 'range', min: String(min), max: String(max), value: String(value), 'aria-label': label });
    let before = null;
    r.addEventListener('input', () => { before ??= st(); onInput(Number(r.value)); });
    r.addEventListener('change', () => { const next = st(); if (before) history.replace(before); before = null; onChange?.(next); commit(next); });
    return el('label', { class: 'field' }, el('span', { text: label }), el('span', { class: 'range-row' }, r));
  }

  function renderPanel() {
    for (const b of host.querySelectorAll('.cl-mode')) b.classList.toggle('active', b.dataset.mode === st().mode);
    const s = st();
    const common = [
      el('strong', { class: 'small', text: 'Shape' }),
      chipRow([...(s.mode === 'free' && s.base ? [['base', 'Photo']] : []), ...Object.keys(ASPECTS).map((k) => [k, k])], s.aspect, (id) => commit({ ...st(), aspect: id })),
      el('div', { class: 'swatches' }, ...BACKGROUNDS.map((c) => el('button', {
        class: `swatch${s.bg === c ? ' active' : ''}`, style: { background: c }, 'aria-label': `Background ${c}`, onclick: () => commit({ ...st(), bg: c }),
      }))),
    ];
    if (s.mode === 'grid') {
      const cell = selected != null ? s.cells[selected] : null;
      panel.replaceChildren(...[
        chipRow(Object.entries(LAYOUTS).map(([id, l]) => [id, l.label]), s.layout, (id) => { selected = null; commit({ ...st(), layout: id }); }),
        el('div', { class: 'row wrap' },
          el('button', { class: 'btn small-btn primary', text: 'Add photos', onclick: () => pick({ kind: 'cell', index: firstEmpty() }, true) }),
          cell?.src ? el('button', { class: 'btn small-btn', text: 'Replace', onclick: () => pick({ kind: 'cell', index: selected }) }) : null,
          cell?.src ? el('button', { class: 'btn small-btn ghost', text: 'Remove', onclick: () => { const cells = [...st().cells]; cells[selected] = null; commit({ ...st(), cells }); } }) : null),
        cell?.src ? slider('Zoom', 100, 400, Math.round(cell.zoom * 100), (v) => { const cells = [...st().cells]; cells[selected] = { ...cells[selected], zoom: v / 100 }; live({ ...st(), cells }); }) : null,
        el('p', { class: 'muted small', text: cell?.src ? 'Drag the photo to position it in its frame. Hold it, then drag, to move it to another frame.' : 'Tap a frame to add a photo.' }),
        slider('Spacing', 0, 60, s.gap, (v) => live({ ...st(), gap: v })),
        slider('Rounded corners', 0, 80, s.radius, (v) => live({ ...st(), radius: v })),
        ...common,
      ].filter(Boolean));
    } else {
      const layer = s.layers.find((l) => l.id === selected);
      const idx = s.layers.indexOf(layer);
      const upd = (patch, how = commit) => how({ ...st(), layers: st().layers.map((l) => (l.id === selected ? { ...l, ...patch } : l)) });
      panel.replaceChildren(...[
        el('div', { class: 'row wrap' },
          el('button', { class: 'btn small-btn', text: s.base ? 'Change background photo' : 'Background photo', onclick: () => pick({ kind: 'base' }) }),
          s.base ? el('button', { class: 'btn small-btn ghost', text: 'Remove background', onclick: () => commit({ ...st(), base: null, aspect: st().aspect === 'base' ? '1:1' : st().aspect }) }) : null),
        el('div', { class: 'row wrap' },
          el('button', { class: 'btn small-btn primary', text: '+ Photo', onclick: () => pick({ kind: 'layer' }, true) }),
          el('button', { class: 'btn small-btn primary', text: '+ Character', onclick: chooseCharacter }),
          s.base ? el('button', { class: 'btn small-btn', text: '🎭 Face swap', onclick: faceSwap }) : null),
        faceNote ? el('p', { class: 'small muted', 'aria-live': 'polite', text: faceNote }) : null,
        layer ? el('div', { class: 'row wrap' },
          el('button', { class: 'btn small-btn', text: '⇋ Flip', onclick: () => upd({ flip: !layer.flip }) }),
          el('button', { class: 'btn small-btn', text: 'Forward', disabled: idx === s.layers.length - 1, onclick: () => { const L = [...st().layers]; [L[idx], L[idx + 1]] = [L[idx + 1], L[idx]]; commit({ ...st(), layers: L }); } }),
          el('button', { class: 'btn small-btn', text: 'Backward', disabled: idx === 0, onclick: () => { const L = [...st().layers]; [L[idx], L[idx - 1]] = [L[idx - 1], L[idx]]; commit({ ...st(), layers: L }); } }),
          el('button', { class: 'btn small-btn', text: 'Duplicate', onclick: () => { const copy = { ...layer, id: crypto.randomUUID(), x: layer.x + 0.04, y: layer.y + 0.04 }; selected = copy.id; commit({ ...st(), layers: [...st().layers, copy] }); } }),
          el('button', { class: 'btn small-btn ghost', text: 'Delete', onclick: () => { selected = null; commit({ ...st(), layers: st().layers.filter((l) => l.id !== layer.id) }); } })) : null,
        layer ? slider('Opacity', 10, 100, Math.round(layer.opacity * 100), (v) => upd({ opacity: v / 100 }, live)) : null,
        el('p', { class: 'muted small', text: layer
          ? 'Drag to move. Two fingers (or the blue dot) resize and rotate.'
          : s.layers.length ? 'Tap a layer to select it.' : 'Choose a background photo, then add photos or Characters on top.' }),
        ...common,
      ].filter(Boolean));
    }
  }

  function firstEmpty() {
    const n = LAYOUTS[st().layout].cells.length;
    for (let i = 0; i < n; i++) if (!st().cells[i]?.src) return i;
    return 0;
  }

  // ---------- face swap ----------

  let faceNote = '';
  /** What goes on the faces: a Character, or a mask image picked from the phone. Resolves to a blob, or null. */
  async function chooseMask() {
    const list = await listCharacters();
    return new Promise((resolve) => {
      let picked = null;
      const file = el('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: 'cl-mask-file' });
      const dlg = el('dialog', { class: 'ed-dialog' }, el('div', { class: 'sheet' },
        el('h2', { text: 'Face swap' }),
        el('p', { class: 'small muted', text: 'Put one of your Characters (from Cutout) or any mask image on every face found. Move, resize or turn them after.' }),
        list.length ? el('div', { class: 'char-grid' }) : el('p', { class: 'muted small', text: 'No Characters yet: cut a face out in Cutout and save it as a Character, or use a mask image.' }),
        el('label', { class: 'btn block', for: 'cl-mask-file', text: '🖼 A mask image…' }), file,
        el('div', { class: 'row end' }, el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => dlg.close() }))));
      const grid = dlg.querySelector('.char-grid'); const urls = [];
      (async () => {
        for (const c of list) {
          const blob = await getCharacterBlob(c.id); if (!blob) continue;
          const u = URL.createObjectURL(blob); urls.push(u);
          grid.append(el('button', { type: 'button', class: 'char-card', 'aria-label': c.name, onclick: () => { picked = blob; dlg.close(); } }, el('span', { class: 'checker' }, el('img', { src: u, alt: '' })), el('span', { class: 'small', text: c.name })));
        }
      })();
      file.addEventListener('change', () => { picked = file.files[0] ?? null; dlg.close(); });
      dlg.addEventListener('close', () => { dlg.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); resolve(picked); });
      document.body.append(dlg); dlg.showModal();
    });
  }

  /**
   * 🎭 Face swap: the faces in the background photo (found on the phone), each covered by the Character
   * or mask image chosen, as a layer sized, placed and turned to the face (then movable like any layer).
   */
  async function faceSwap() {
    const s = st();
    const base = images.get(s.base);
    if (!base) { alert('Choose a background photo with faces first.'); return; }
    faceNote = 'Looking for faces…'; renderPanel();
    let faces;
    try { const { detectFaces } = await import('../../lib/face.js'); faces = await detectFaces(base.bmp); } catch (err) { faceNote = `Couldn't look for faces: ${err.message}`; renderPanel(); return; }
    if (!faces.length) { faceNote = 'No face found in the background photo.'; renderPanel(); return; }
    faceNote = `${faces.length} face${faces.length === 1 ? '' : 's'} found. Pick what goes on ${faces.length === 1 ? 'it' : 'them'}.`; renderPanel();
    const blob = await chooseMask();
    if (!blob) { faceNote = ''; renderPanel(); return; }
    const id = await addImage(blob); const im = images.get(id);
    const { maskLayer } = await import('../../lib/face-core.js');
    const layers = faces.map((f) => ({ id: crypto.randomUUID(), src: id, ...maskLayer(f, im.w / im.h, base.w / base.h), opacity: 1, flip: false }));
    selected = layers.at(-1).id;
    faceNote = `Covered ${faces.length} face${faces.length === 1 ? '' : 's'}. Drag, pinch or use the blue dot to adjust.`;
    commit({ ...st(), mode: 'free', aspect: 'base', layers: [...st().layers, ...layers] });
  }

  async function chooseCharacter() {
    const list = await listCharacters();
    const dlg = el('dialog', { class: 'ed-dialog' }, el('form', { method: 'dialog', class: 'sheet' },
      el('h2', { text: 'Add a Character' }),
      list.length ? el('div', { class: 'char-grid' }) : el('p', { class: 'muted small', text: 'No Characters yet. Make one in the Cutout tab.' }),
      el('div', { class: 'row end' }, el('button', { class: 'btn ghost', value: 'close', text: 'Close' }))));
    const grid = dlg.querySelector('.char-grid');
    const urls = [];
    for (const c of list) {
      const blob = await getCharacterBlob(c.id);
      if (!blob) continue;
      const u = URL.createObjectURL(blob); urls.push(u);
      grid.append(el('button', { type: 'button', class: 'char-card', 'aria-label': c.name, onclick: async () => {
        dlg.close();
        placeImages([await addImage(blob)], { kind: 'layer' });
      } }, el('span', { class: 'checker' }, el('img', { src: u, alt: '' })), el('span', { class: 'small', text: c.name })));
    }
    dlg.addEventListener('close', () => { dlg.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); });
    document.body.append(dlg);
    dlg.showModal();
  }

  // ---------- touch ----------

  function bindPointer() {
    const pts = new Map();
    let g = null; // gesture
    const at = (e) => { const r = canvas.getBoundingClientRect(); const k = canvas.width / r.width; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; };

    canvas.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, at(e));
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      const s = st(); const W = canvas.width; const H = canvas.height; const p = at(e);
      if (pts.size === 2) {
        // Two fingers: pinch the selected layer (free) or zoom the selected cell (grid).
        const [a, b] = [...pts.values()];
        if (s.mode === 'free' && selected) { const l = s.layers.find((x) => x.id === selected); if (l) g = { kind: 'pinch', a, b, start: l, before: g?.before ?? s }; }
        else if (s.mode === 'grid' && selected != null && s.cells[selected]?.src) g = { kind: 'zoom', a, b, start: s.cells[selected], before: g?.before ?? s };
        return;
      }
      if (s.mode === 'grid') {
        const rects = cellRects(s.layout, W, H, s.gap * (W / 1000));
        const i = rects.findIndex((r) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h);
        if (i < 0) return;
        if (!s.cells[i]?.src) { selected = i; renderPanel(); draw(); g = { kind: 'tapEmpty', index: i, p }; return; }
        selected = i; renderPanel(); draw();
        g = { kind: 'pan', index: i, p, rect: rects[i], start: s.cells[i], before: s, rects };
        // Hold still for a moment, then drag: the photo moves to another frame (swapping with it).
        const hold = g;
        hold.timer = setTimeout(() => {
          if (g !== hold) return;
          live(hold.before);
          g = { kind: 'swap', index: i, p, to: i, rects, before: s };
          swapHint = { from: i, to: i, p };
          canvas.classList.add('cl-holding');
          navigator.vibrate?.(15);
          draw();
        }, 450);
      } else {
        const px = W / canvas.clientWidth;
        const cur = s.layers.find((l) => l.id === selected);
        if (cur) {
          const im = images.get(cur.src);
          const [hx, hy] = handlePoint(cur, im.w / im.h, W, H);
          if (Math.hypot(p[0] - hx, p[1] - hy) < 26 * px) { g = { kind: 'handle', id: cur.id, before: s }; return; }
        }
        const hit = [...s.layers].reverse().find((l) => { const im = images.get(l.src); return im && layerHit(l, im.w / im.h, W, H, p[0], p[1], 6 * px); });
        selected = hit?.id ?? null;
        renderPanel(); draw();
        if (hit) g = { kind: 'move', id: hit.id, p, start: hit, before: s };
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, at(e));
      if (!g) return;
      const s = st(); const W = canvas.width; const H = canvas.height; const p = at(e);
      if (g.kind === 'pan' && g.timer && Math.hypot(p[0] - g.p[0], p[1] - g.p[1]) > 6 * (canvas.width / canvas.clientWidth)) { clearTimeout(g.timer); g.timer = 0; }
      if (g.kind === 'swap') {
        const to = g.rects.findIndex((r) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h);
        g.to = to < 0 ? g.index : to;
        swapHint = { from: g.index, to: g.to, p };
        draw();
        return;
      }
      if (g.kind === 'pan') {
        const im = images.get(g.start.src);
        const o = panBy(im.w, im.h, g.rect, g.start.zoom, g.start.ox, g.start.oy, p[0] - g.p[0], p[1] - g.p[1]);
        const cells = [...s.cells]; cells[g.index] = { ...g.start, ...o };
        live({ ...s, cells });
      } else if (g.kind === 'move') {
        const layers = s.layers.map((l) => (l.id === g.id ? { ...g.start, x: g.start.x + (p[0] - g.p[0]) / W, y: g.start.y + (p[1] - g.p[1]) / H } : l));
        live({ ...s, layers });
      } else if (g.kind === 'handle') {
        const l = s.layers.find((x) => x.id === g.id); const im = images.get(l.src);
        const t = dragHandle(l, im.w / im.h, W, H, p[0], p[1]);
        live({ ...s, layers: s.layers.map((x) => (x.id === g.id ? { ...x, ...t } : x)) });
      } else if ((g.kind === 'pinch' || g.kind === 'zoom') && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const t = pinchTransform(g.a, g.b, a, b);
        if (g.kind === 'pinch') {
          const l = g.start;
          const next = { ...l, scale: Math.max(0.03, l.scale * t.scale), rot: l.rot + t.rot, x: l.x + (t.mid[0] - t.mid0[0]) / W, y: l.y + (t.mid[1] - t.mid0[1]) / H };
          live({ ...s, layers: s.layers.map((x) => (x.id === l.id ? next : x)) });
        } else {
          const cells = [...s.cells]; cells[selected] = { ...g.start, zoom: Math.min(4, Math.max(1, g.start.zoom * t.scale)) };
          live({ ...s, cells });
        }
      }
    });

    const end = (e) => {
      pts.delete(e.pointerId);
      if (!g || pts.size) return;
      clearTimeout(g.timer);
      if (g.kind === 'swap') {
        swapHint = null; canvas.classList.remove('cl-holding');
        if (g.to !== g.index) {
          const cells = [...st().cells]; [cells[g.index], cells[g.to]] = [cells[g.to] ?? null, cells[g.index]];
          selected = g.to;
          commit({ ...st(), cells });
        } else draw();
      } else if (g.kind === 'tapEmpty') pick({ kind: 'cell', index: g.index }, true);
      else if (g.before) { const next = st(); history.replace(g.before); commit(next); }
      g = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // ---------- export ----------

  function exportCanvas(longEdge) {
    const a = canvasAspect();
    let W = a >= 1 ? longEdge : Math.round(longEdge * a);
    let H = a >= 1 ? Math.round(longEdge / a) : longEdge;
    if (W * H > MAX_CANVAS_PIXELS) { const k = Math.sqrt(MAX_CANVAS_PIXELS / (W * H)); W = Math.floor(W * k); H = Math.floor(H * k); }
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    render(c.getContext('2d'), W, H, false);
    return c;
  }

  function openExport() {
    const prefs = { size: 2048, type: 'image/jpeg', ...store.json('cc.collage.export', {}) };
    const status = el('p', { class: 'muted small', text: 'Preparing…' });
    const shareBtn = el('button', { class: 'btn primary', text: 'Share', disabled: true });
    const saveBtn = el('button', { class: 'btn', text: 'Save', disabled: true });
    const editBtn = onEdit ? el('button', { class: 'btn ghost', text: 'Edit in Photo', disabled: true }) : null;
    const sizeSel = el('select', {}, ...[[1080, '1080 px'], [2048, '2048 px'], [3000, '3000 px'], [4096, '4096 px']].map(([v, l]) => el('option', { value: String(v), text: l, selected: v === prefs.size })));
    const typeSel = el('select', {}, ...[['image/jpeg', 'JPEG'], ['image/png', 'PNG']].map(([v, l]) => el('option', { value: v, text: l, selected: v === prefs.type })));
    const dlg = el('dialog', { class: 'ed-dialog' }, el('div', { class: 'sheet' },
      el('h2', { text: 'Save collage' }),
      el('label', { class: 'field' }, el('span', { text: 'Size (long edge)' }), sizeSel),
      el('label', { class: 'field' }, el('span', { text: 'Format' }), typeSel),
      status,
      el('div', { class: 'row wrap end' }, el('button', { class: 'btn ghost', text: 'Close', onclick: () => dlg.close() }), editBtn, saveBtn, shareBtn)));
    const make = async () => {
      shareBtn.disabled = saveBtn.disabled = true; if (editBtn) editBtn.disabled = true;
      store.set('cc.collage.export', JSON.stringify(prefs));
      const c = exportCanvas(prefs.size);
      const blob = await encodeCanvas(c, prefs.type, 0.92);
      const name = `Collage ${new Date().toISOString().slice(0, 10)}.${prefs.type === 'image/png' ? 'png' : 'jpg'}`;
      const f = new File([blob], name, { type: blob.type });
      status.textContent = `${name} · ${c.width}×${c.height} · ${formatBytes(blob.size)}`;
      saveBtn.disabled = false; saveBtn.onclick = () => downloadBlob(blob, name);
      shareBtn.hidden = !canShareFiles([f]); shareBtn.disabled = false; shareBtn.onclick = () => shareFiles([f], name).catch(() => {});
      if (editBtn) { editBtn.disabled = false; editBtn.onclick = () => { dlg.close(); onEdit(f); }; }
    };
    sizeSel.addEventListener('change', () => { prefs.size = Number(sizeSel.value); make(); });
    typeSel.addEventListener('change', () => { prefs.type = typeSel.value; make(); });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    make().catch((err) => { status.textContent = `Could not export: ${err.message}`; });
  }

  // ---------- start ----------

  window.addEventListener('resize', draw);
  build();
  const ready = idb.get(SAVE_KEY).then(async (saved) => {
    if (!saved?.state) return;
    for (const { id, blob } of saved.images ?? []) {
      try {
        const bitmap = await decodeImage(blob, await sniffType(blob));
        const fit = fitSize(bitmap.width, bitmap.height, IMAGE_MAX);
        const bmp = drawToCanvas(bitmap, fit.width, fit.height, null);
        images.set(id, { blob, bmp, w: bmp.width, h: bmp.height });
      } catch { /* skip unreadable */ }
    }
    history.reset({ ...defaultState(), ...saved.state });
    changed();
  });
  const addLayerFile = async (blob) => { await ready; placeImages([await addImage(blob)], { kind: 'layer' }); };
  if (initialFile) addLayerFile(initialFile);

  const unmount = () => { window.removeEventListener('resize', draw); clearTimeout(saveTimer); persist(); };
  unmount.openFile = (blob) => { addLayerFile(blob); return true; };
  /** A photo from the editor: into the first empty frame of the grid (more frames if they're all full). */
  unmount.placeInGrid = async (blob) => {
    await ready;
    const id = await addImage(blob);
    let s = st();
    if (s.mode !== 'grid') s = { ...s, mode: 'grid', aspect: s.aspect === 'base' ? '1:1' : s.aspect };
    const n = LAYOUTS[s.layout].cells.length;
    let i = [...Array(n).keys()].find((k) => !s.cells[k]?.src);
    if (i === undefined) {
      // All frames full: the next layout with more of them, if there is one.
      const bigger = Object.keys(LAYOUTS).find((k) => LAYOUTS[k].cells.length > n);
      if (bigger) { s = { ...s, layout: bigger }; i = n; } else i = n - 1;
    }
    const cells = [...s.cells]; cells[i] = { src: id, zoom: 1, ox: 0, oy: 0 };
    selected = i;
    commit({ ...s, cells });
  };
  /** A photo from the editor as the background in Free / Superimpose, then a face swap on it. */
  unmount.faceSwapOn = async (blob) => {
    await ready;
    const id = await addImage(blob);
    selected = null;
    commit({ ...st(), mode: 'free', base: id, aspect: 'base' });
    await faceSwap();
  };
  /** A photo from the editor as the background in Free / Superimpose, then pick a Character for it. */
  unmount.characterOn = async (blob) => {
    await ready;
    const id = await addImage(blob);
    selected = null;
    commit({ ...st(), mode: 'free', base: id, aspect: 'base' });
    chooseCharacter();
  };
  unmount.show = () => draw();
  return unmount;
}
