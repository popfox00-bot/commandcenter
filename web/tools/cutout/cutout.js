// Cutout: trace around an object with a finger to cut it out of a photo. Save it as a transparent
// PNG, keep it as a "Character" for later, or place it onto another photo (Collage tab).
import { el } from '../../lib/dom.js';
import { sniffType, decodeImage, fitSize, drawToCanvas, canvasToBlob } from '../../lib/image.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes, renameExt } from '../../lib/files.js';
import { listCharacters, addCharacter, getCharacterBlob, renameCharacter, removeCharacter } from '../../lib/characters.js';
import { smoothClosed, polygonArea, thin, featherAlpha, alphaBounds } from './cutout-core.js';

const WORK_MAX = 2400; // cut resolution (long edge)

/** mount(host, { onPlace, file }) — onPlace(file) puts a cutout on a photo in the Collage tab. */
export function mount(host, { onPlace, file: initialFile } = {}) {
  let image = null; let fileName = 'photo.png';
  let traces = []; // [{ op: 'add' | 'sub', points: [[u,v]...] }] in image-normalized coordinates
  let redo = [];
  let mode = 'add'; let feather = 2; let preview = false;
  let drawing = null;
  const urls = new Set();
  const objectUrl = (b) => { const u = URL.createObjectURL(b); urls.add(u); return u; };

  // ---------- start screen + Characters gallery ----------

  async function showStart() {
    const input = el('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: 'co-file' });
    input.addEventListener('change', () => { if (input.files[0]) open(input.files[0]); input.value = ''; });
    const gallery = el('div', { class: 'char-grid' });
    host.replaceChildren(
      el('div', { class: 'drop' },
        el('label', { class: 'btn primary block', for: 'co-file', text: 'Choose a photo to cut from' }),
        el('p', { class: 'muted small center', text: 'Trace around a person, pet or thing with your finger. Save it with a transparent background, or keep it as a Character to put on other photos.' })),
      el('h3', { text: 'Your Characters' }), gallery, input);
    const list = await listCharacters();
    if (!list.length) { gallery.replaceChildren(el('p', { class: 'muted small', text: 'None yet. Cut something out and tap "Save as Character".' })); return; }
    gallery.replaceChildren(...await Promise.all(list.map(async (c) => {
      const blob = await getCharacterBlob(c.id);
      return el('button', { class: 'char-card', 'aria-label': c.name, onclick: () => characterSheet(c, blob) },
        el('span', { class: 'checker' }, blob ? el('img', { src: objectUrl(blob), alt: '' }) : null),
        el('span', { class: 'small', text: c.name }));
    })));
  }

  function characterSheet(c, blob) {
    const file = new File([blob], `${c.name}.png`, { type: 'image/png' });
    const dlg = el('dialog', { class: 'ed-dialog' }, el('form', { method: 'dialog', class: 'sheet' },
      el('h2', { text: c.name }),
      el('span', { class: 'checker big' }, el('img', { src: objectUrl(blob), alt: '' })),
      el('p', { class: 'muted small', text: `${c.width}×${c.height} · ${formatBytes(blob.size)}` }),
      el('div', { class: 'row wrap end' },
        onPlace ? el('button', { type: 'button', class: 'btn primary', text: 'Place on a photo', onclick: () => { dlg.close(); onPlace(file); } }) : null,
        canShareFiles([file]) ? el('button', { type: 'button', class: 'btn', text: 'Share', onclick: () => shareFiles([file], c.name).catch(() => {}) }) : null,
        el('button', { type: 'button', class: 'btn ghost', text: 'Save', onclick: () => downloadBlob(blob, file.name) }),
        el('button', { type: 'button', class: 'btn ghost', text: 'Rename', onclick: async () => { const n = window.prompt('Name', c.name); if (n) { await renameCharacter(c.id, n.trim()); dlg.close(); showStart(); } } }),
        el('button', { type: 'button', class: 'btn ghost', text: 'Delete', onclick: async () => { if (window.confirm(`Delete ${c.name}?`)) { await removeCharacter(c.id); dlg.close(); showStart(); } } }),
        el('button', { class: 'btn ghost', value: 'close', text: 'Close' }))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // ---------- tracing ----------

  async function open(blob, name = blob.name || 'photo.png') {
    host.replaceChildren(el('p', { class: 'muted center', text: 'Opening…' }));
    try {
      const bitmap = await decodeImage(blob, await sniffType(blob));
      const fit = fitSize(bitmap.width, bitmap.height, WORK_MAX);
      image = drawToCanvas(bitmap, fit.width, fit.height, null);
      bitmap.close?.();
      fileName = name; traces = []; redo = []; preview = false;
      buildEditor();
    } catch (err) {
      host.replaceChildren(el('p', { class: 'bad-text', text: err.message }), el('button', { class: 'btn', text: 'Back', onclick: showStart }));
    }
  }

  let canvas; let panel;
  function buildEditor() {
    canvas = el('canvas', { class: 'co-canvas', 'aria-label': 'Trace around the object' });
    panel = el('div', { class: 'ed-panel' });
    host.replaceChildren(
      el('div', { class: 'ed-top' },
        el('button', { class: 'icon-btn', 'aria-label': 'Close photo', text: '✕', onclick: () => { if (!traces.length || window.confirm('Discard this cutout?')) showStart(); } }),
        el('div', { class: 'ed-top-mid' },
          el('button', { class: 'icon-btn', 'aria-label': 'Undo', text: '↶', onclick: () => { if (traces.length) { redo.push(traces.pop()); refresh(); } } }),
          el('button', { class: 'icon-btn', 'aria-label': 'Redo', text: '↷', onclick: () => { if (redo.length) { traces.push(redo.pop()); refresh(); } } })),
        el('button', { class: 'btn primary small-btn', text: 'Done', onclick: finish })),
      el('div', { class: 'ed-stage co-stage' }, canvas), panel);
    bindPointer();
    window.addEventListener('resize', draw);
    refresh();
  }

  function refresh() { renderPanel(); draw(); }

  function renderPanel() {
    const fRange = el('input', { type: 'range', min: '0', max: '12', step: '1', value: String(feather), 'aria-label': 'Edge softness' });
    fRange.addEventListener('input', () => { feather = Number(fRange.value); if (preview) draw(); });
    panel.replaceChildren(
      el('div', { class: 'segmented', role: 'radiogroup' },
        ...[['add', '✏️ Trace'], ['sub', '➖ Remove']].map(([id, label]) => el('button', {
          class: `seg${mode === id ? ' active' : ''}`, role: 'radio', 'aria-checked': String(mode === id), text: label,
          onclick: () => { mode = id; renderPanel(); },
        }))),
      el('p', { class: 'muted small', text: mode === 'add'
        ? 'Draw all the way around what you want to keep. Lift your finger to close the outline; trace again to add more.'
        : 'Draw around parts to cut away (for example the gap between an arm and a body).' }),
      el('label', { class: 'field' }, el('span', { text: 'Edge softness' }), el('span', { class: 'range-row' }, fRange)),
      el('div', { class: 'row wrap' },
        el('button', { class: `btn small-btn${preview ? ' primary' : ''}`, text: preview ? 'Show photo' : 'Preview cutout', disabled: !traces.length, onclick: () => { preview = !preview; refresh(); } }),
        el('button', { class: 'btn small-btn ghost', text: 'Start over', disabled: !traces.length, onclick: () => { redo = []; traces = []; preview = false; refresh(); } })));
  }

  function fitCanvas() {
    const maxW = canvas.parentElement.clientWidth || 360;
    const maxH = Math.min(window.innerHeight * 0.58, 640);
    const k = Math.min(maxW / image.width, maxH / image.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${Math.floor(image.width * k)}px`; canvas.style.height = `${Math.floor(image.height * k)}px`;
    canvas.width = Math.floor(image.width * k * dpr); canvas.height = Math.floor(image.height * k * dpr);
    return dpr;
  }

  function tracePath(ctx, pts, w, h) {
    ctx.beginPath();
    pts.forEach(([u, v], i) => (i ? ctx.lineTo(u * w, v * h) : ctx.moveTo(u * w, v * h)));
    ctx.closePath();
  }

  /** Alpha mask of all traces at w×h (add = fill, remove = erase), feathered. */
  function maskCanvas(w, h, featherPx) {
    const m = document.createElement('canvas');
    m.width = w; m.height = h;
    const ctx = m.getContext('2d');
    for (const t of traces) {
      ctx.globalCompositeOperation = t.op === 'add' ? 'source-over' : 'destination-out';
      ctx.fillStyle = '#000';
      tracePath(ctx, t.points, w, h);
      ctx.fill();
    }
    if (featherPx >= 1) {
      const d = ctx.getImageData(0, 0, w, h);
      featherAlpha(d.data, w, h, featherPx);
      ctx.putImageData(d, 0, 0);
    }
    return m;
  }

  function draw() {
    if (!canvas?.isConnected || !image) return;
    const dpr = fitCanvas();
    const ctx = canvas.getContext('2d');
    const w = canvas.width; const h = canvas.height;
    if (preview && traces.length) {
      drawChecker(ctx, w, h, 10 * dpr);
      const cut = document.createElement('canvas'); cut.width = w; cut.height = h;
      const c2 = cut.getContext('2d');
      c2.drawImage(image, 0, 0, w, h);
      c2.globalCompositeOperation = 'destination-in';
      c2.drawImage(maskCanvas(w, h, feather * (w / image.width) * 2), 0, 0);
      ctx.drawImage(cut, 0, 0);
      return;
    }
    ctx.drawImage(image, 0, 0, w, h);
    if (traces.length) {
      // Dim everything outside the selection.
      const mask = maskCanvas(w, h, 0);
      const dim = document.createElement('canvas'); dim.width = w; dim.height = h;
      const d = dim.getContext('2d');
      d.fillStyle = 'rgba(0,0,0,0.55)'; d.fillRect(0, 0, w, h);
      d.globalCompositeOperation = 'destination-out';
      d.drawImage(mask, 0, 0);
      ctx.drawImage(dim, 0, 0);
    }
    ctx.lineWidth = 2.5 * dpr; ctx.setLineDash([8 * dpr, 6 * dpr]);
    for (const t of traces) { ctx.strokeStyle = t.op === 'add' ? '#ffffff' : '#ff3b30'; tracePath(ctx, t.points, w, h); ctx.stroke(); }
    if (drawing) {
      ctx.setLineDash([]); ctx.strokeStyle = mode === 'add' ? '#0a84ff' : '#ff3b30'; ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); drawing.forEach(([u, v], i) => (i ? ctx.lineTo(u * w, v * h) : ctx.moveTo(u * w, v * h))); ctx.stroke();
    }
  }

  function drawChecker(ctx, w, h, s) {
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
      ctx.fillStyle = ((x + y) / s) % 2 ? '#d9d9d9' : '#ffffff';
      ctx.fillRect(x, y, s, s);
    }
  }

  function bindPointer() {
    const at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    canvas.addEventListener('pointerdown', (e) => {
      if (preview) { preview = false; renderPanel(); }
      drawing = [at(e)];
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      draw();
    });
    canvas.addEventListener('pointermove', (e) => { if (drawing) { drawing.push(at(e)); draw(); } });
    const end = () => {
      if (!drawing) return;
      const r = canvas.getBoundingClientRect();
      const pts = thin(drawing, 2 / Math.max(r.width, r.height));
      drawing = null;
      // Ignore taps and scribbles too small to be an outline.
      if (pts.length >= 3 && polygonArea(pts.map(([u, v]) => [u * r.width, v * r.height])) > 150) {
        traces.push({ op: mode, points: smoothClosed(pts, 2) });
        redo = [];
      }
      refresh();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // ---------- result ----------

  /** The cutout at full working resolution, cropped to the visible part. */
  function renderCut() {
    const w = image.width; const h = image.height;
    const cut = document.createElement('canvas'); cut.width = w; cut.height = h;
    const ctx = cut.getContext('2d');
    ctx.drawImage(image, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskCanvas(w, h, feather * 2), 0, 0);
    const b = alphaBounds(ctx.getImageData(0, 0, w, h).data, w, h);
    if (!b) return null;
    const out = document.createElement('canvas'); out.width = b.width; out.height = b.height;
    out.getContext('2d').drawImage(cut, b.x, b.y, b.width, b.height, 0, 0, b.width, b.height);
    return out;
  }

  async function finish() {
    if (!traces.some((t) => t.op === 'add')) { window.alert('Trace around something first.'); return; }
    const out = renderCut();
    if (!out) { window.alert('Nothing is left inside the outline.'); return; }
    const blob = await canvasToBlob(out, 'image/png');
    const name = renameExt(fileName, 'png', '-cutout');
    const file = new File([blob], name, { type: 'image/png' });
    const status = el('p', { class: 'muted small', text: `${out.width}×${out.height} · ${formatBytes(blob.size)} · transparent background` });
    const dlg = el('dialog', { class: 'ed-dialog' }, el('form', { method: 'dialog', class: 'sheet' },
      el('h2', { text: 'Your cutout' }),
      el('span', { class: 'checker big' }, el('img', { src: objectUrl(blob), alt: 'Cutout preview' })),
      status,
      el('div', { class: 'row wrap end' },
        el('button', { type: 'button', class: 'btn primary', text: 'Save as Character', onclick: async () => {
          const n = window.prompt('Name this Character', fileName.replace(/\.[^.]+$/, ''));
          if (n === null) return;
          await addCharacter(blob, { name: n.trim(), width: out.width, height: out.height });
          status.textContent = `Saved as Character "${n.trim() || 'Character'}". Find it under Your Characters.`;
        } }),
        onPlace ? el('button', { type: 'button', class: 'btn', text: 'Place on a photo', onclick: () => { dlg.close(); onPlace(file); } }) : null,
        canShareFiles([file]) ? el('button', { type: 'button', class: 'btn', text: 'Share', onclick: () => shareFiles([file], name).catch(() => {}) }) : null,
        el('button', { type: 'button', class: 'btn ghost', text: 'Save PNG', onclick: () => downloadBlob(blob, name) }),
        el('button', { class: 'btn ghost', value: 'close', text: 'Close' }))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  if (initialFile) open(initialFile); else showStart();
  const unmount = () => { window.removeEventListener('resize', draw); for (const u of urls) URL.revokeObjectURL(u); };
  unmount.openFile = (blob, name) => { if (traces.length && !window.confirm('Discard the current cutout?')) return false; open(blob, name); return true; };
  unmount.show = () => draw();
  return unmount;
}
