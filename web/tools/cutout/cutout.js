// Cutout: trace around an object with a finger to cut it out of a photo. Smart edges then trim the
// background left just inside the trace, carefully (cutout-core.js smartEdge). Save it as a
// transparent PNG, keep it as a "Character" for later, or place it onto another photo (Collage tab).
import { el, store } from '../../lib/dom.js';
import { sniffType, decodeImage, fitSize, drawToCanvas, canvasToBlob } from '../../lib/image.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes, renameExt } from '../../lib/files.js';
import { listCharacters, addCharacter, getCharacterBlob, renameCharacter, removeCharacter } from '../../lib/characters.js';
import { smoothClosed, polygonArea, thin, featherAlpha, alphaBounds, smartEdge, patchMask } from './cutout-core.js';

const WORK_MAX = 2400; // cut resolution (long edge)
const SMART_MAX = 720;  // smart edges are worked out at this size (long edge), then scaled up
const SMART_KEY = 'cc.cutout.smart';

/** mount(host, { onPlace, file }) — onPlace(file) puts a cutout on a photo in the Collage tab. */
export function mount(host, { onPlace, file: initialFile } = {}) {
  let image = null; let fileName = 'photo.png';
  let traces = []; // [{ op: 'add' | 'sub', points: [[u,v]...] }] in image-normalized coordinates
  let past = []; let redo = []; // undo/redo: earlier and later lists of traces
  let mode = 'add'; let feather = 2; let preview = false;
  let smart = store.get(SMART_KEY) !== 'off';
  let smartCache = null; // smart edges for the current outlines (see smartCut)
  let finalCache = null; // the cut with patches applied (see finalMask)
  let work = null;       // the photo at the work size for smart edges and patches: { w, h, rgba }
  let patchSize = Number(store.get('cc.cutout.patch')) || 36; // patch radius, in screen px
  const outlines = () => traces.filter((t) => t.op !== 'patch');
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
      fileName = name; traces = []; past = []; redo = []; preview = false; work = null; smartCache = null; finalCache = null;
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
          el('button', { class: 'icon-btn', 'aria-label': 'Undo', text: '↶', onclick: () => { if (past.length) { redo.push(traces); traces = past.pop(); refresh(); } } }),
          el('button', { class: 'icon-btn', 'aria-label': 'Redo', text: '↷', onclick: () => { if (redo.length) { past.push(traces); traces = redo.pop(); refresh(); } } })),
        el('button', { class: 'btn primary small-btn', text: 'Done', onclick: finish })),
      el('div', { class: 'ed-stage co-stage' }, canvas), panel);
    bindPointer();
    window.addEventListener('resize', draw);
    refresh();
  }

  function refresh() { renderPanel(); draw(); }
  /** A change to the traces, undoable. */
  function commit(next) { past.push(traces); traces = next; redo = []; refresh(); }

  function renderPanel() {
    const fRange = el('input', { type: 'range', min: '0', max: '12', step: '1', value: String(feather), 'aria-label': 'Edge softness' });
    fRange.addEventListener('input', () => { feather = Number(fRange.value); if (preview) draw(); });
    panel.replaceChildren(
      el('div', { class: 'segmented co-modes', role: 'radiogroup' },
        ...[['add', '✏️ Trace'], ['sub', '➕ Add to trace'], ['patch', '🩹 Patch fix'], ['delete', '🗑 Remove trace']].map(([id, label]) => el('button', {
          class: `seg${mode === id ? ' active' : ''}`, role: 'radio', 'aria-checked': String(mode === id), text: label,
          onclick: () => { mode = id; renderPanel(); },
        }))),
      el('p', { class: 'muted small', text: {
        add: 'Draw all the way around what you want to keep. Lift your finger to close the outline; trace again to add more.',
        sub: 'Trace inside your outline around a part to leave out, like the sky under a basket\'s handle or the gap between an arm and a body.',
        patch: 'Tap where the outline is off: that spot is worked out again from the colors around it, moving the edge in or out. Undo takes a patch back.',
        delete: 'Tap a trace or a patch to delete it. Undo brings it back.',
      }[mode] }),
      mode === 'patch' && patchNote ? el('p', { class: 'small warn-text', text: patchNote }) : null,
      mode === 'patch' ? (() => {
        const size = el('input', { type: 'range', min: '12', max: '120', step: '2', value: String(patchSize), 'aria-label': 'Patch size' });
        size.addEventListener('input', () => { patchSize = Number(size.value); store.set('cc.cutout.patch', String(patchSize)); draw(); });
        return el('label', { class: 'field' }, el('span', { text: 'Patch size' }), el('span', { class: 'range-row' }, size));
      })() : null,
      el('div', { class: 'row space co-smart' },
        el('button', { class: `chip${smart ? ' active' : ''}`, 'aria-pressed': String(smart), text: '✨ Smart edges', onclick: () => { smart = !smart; store.set(SMART_KEY, smart ? 'on' : 'off'); refresh(); } }),
        el('span', { class: 'muted small', 'aria-live': 'polite', text: smartNote() })),
      el('label', { class: 'field' }, el('span', { text: 'Edge softness' }), el('span', { class: 'range-row' }, fRange)),
      el('div', { class: 'row wrap' },
        el('button', { class: `btn small-btn${preview ? ' primary' : ''}`, text: preview ? 'Show photo' : 'Preview cutout', disabled: !traces.length, onclick: () => { preview = !preview; refresh(); } }),
        el('button', { class: 'btn small-btn ghost', text: 'Start over', disabled: !traces.length, onclick: () => { preview = false; commit([]); } })));
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

  /** The traces alone (add = fill, remove = erase) at w×h. */
  function traceCanvas(w, h) {
    const m = document.createElement('canvas');
    m.width = w; m.height = h;
    const ctx = m.getContext('2d');
    for (const t of outlines()) {
      ctx.globalCompositeOperation = t.op === 'add' ? 'source-over' : 'destination-out';
      ctx.fillStyle = '#000';
      tracePath(ctx, t.points, w, h);
      ctx.fill();
    }
    return m;
  }

  /**
   * Smart edges for the traces, worked out once per set of traces at up to SMART_MAX px: the outline
   * comes in to the object's edge (background just inside it trimmed), and a trace added inside it
   * (around the sky under a basket's handle) leaves out only what looks like what it's around, so
   * the handle itself stays. Returns { final } (the mask, as a canvas at the work size), how much was
   * trimmed from (cutN) and given back to (giveN) the traces as drawn, and whether the object was too
   * like its background.
   */
  function smartCut() {
    if (!smart || !outlines().some((t) => t.op === 'add')) return null;
    const key = outlineKey();
    if (smartCache?.key === key) return smartCache;
    const { w, h, rgba } = workCopy();
    const bits = (c) => { const d = c.getContext('2d').getImageData(0, 0, w, h).data; return Uint8Array.from({ length: w * h }, (_, i) => (d[i * 4 + 3] > 127 ? 1 : 0)); };
    const only = (op) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#000'; for (const t of outlines().filter((t) => t.op === op)) { tracePath(x, t.points, w, h); x.fill(); } return bits(c); };
    const T = bits(traceCanvas(w, h)); // the traces as drawn, in order
    const A = only('add'); const S = only('sub');
    const ra = smartEdge(rgba, w, h, A);
    const A2 = ra.tooMuch ? A : ra.keep;
    const rs = S.some(Boolean) ? smartEdge(rgba, w, h, S) : null;
    const S2 = rs && !rs.tooMuch ? rs.keep : S; // the part of each added trace that really goes
    const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const F = new Uint8Array(w * h);
    let cutN = 0; let giveN = 0; let area = 0;
    for (let i = 0; i < w * h; i++) {
      F[i] = (T[i] && A2[i]) || (A2[i] && S[i] && !S2[i]) ? 1 : 0;
      if (T[i]) area++;
      if (T[i] && !F[i]) cutN++;
      if (F[i] && !T[i]) giveN++;
    }
    smartCache = { key, F, cutN, giveN, share: area ? cutN / area : 0, tooMuch: !!ra.tooMuch };
    return smartCache;
  }

  const outlineKey = () => outlines().map((t) => `${t.op}${t.points.length}:${t.points[0]}`).join('|');
  /** The photo at the work size (up to SMART_MAX px), read once per photo. */
  function workCopy() {
    if (work) return work;
    const k = Math.min(1, SMART_MAX / Math.max(image.width, image.height));
    const w = Math.max(1, Math.round(image.width * k)); const h = Math.max(1, Math.round(image.height * k));
    const pic = document.createElement('canvas'); pic.width = w; pic.height = h;
    const pc = pic.getContext('2d'); pc.drawImage(image, 0, 0, w, h);
    work = { w, h, rgba: pc.getImageData(0, 0, w, h).data };
    return work;
  }

  /**
   * The cut at the work size: the outlines (with smart edges when on), then each patch in turn.
   * { bits, canvas, changed } (changed: it differs from the outlines as drawn, so it's used as is).
   */
  function finalMask() {
    const key = `${smart}|${outlineKey()}|${traces.filter((t) => t.op === 'patch').map((t) => t.id).join(',')}`;
    if (finalCache?.key === key) return finalCache;
    const { w, h } = workCopy();
    const s = smartCut();
    let bits;
    if (s && (s.cutN || s.giveN)) bits = Uint8Array.from(s.F);
    else { const d = traceCanvas(w, h).getContext('2d').getImageData(0, 0, w, h).data; bits = Uint8Array.from({ length: w * h }, (_, i) => (d[i * 4 + 3] > 127 ? 1 : 0)); }
    const patches = traces.filter((t) => t.op === 'patch');
    for (const { p } of patches) for (let j = 0; j < p.bw * p.bh; j++) bits[(p.y0 + Math.floor(j / p.bw)) * w + p.x0 + (j % p.bw)] = p.bits[j];
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const cx = canvas.getContext('2d'); const img = cx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) if (bits[i]) img.data[i * 4 + 3] = 255;
    cx.putImageData(img, 0, 0);
    finalCache = { key, bits, canvas, changed: !!(s && (s.cutN || s.giveN)) || patches.length > 0 };
    return finalCache;
  }

  /** A patch where the user tapped (u, v: 0–1 across the photo). */
  function patchAt(u, v) {
    if (!outlines().some((t) => t.op === 'add')) return;
    const { w, h, rgba } = workCopy();
    const r = Math.max(4, (patchSize / canvas.getBoundingClientRect().width) * w);
    const p = patchMask(rgba, w, h, finalMask().bits, u * w, v * h, r);
    if (!p || !p.changed) { patchNote = p ? 'Nothing to change there: the outline already follows the edge.' : 'Nothing to go by there: tap where the outline meets the object.'; renderPanel(); return; }
    patchNote = '';
    commit([...traces, { op: 'patch', id: `${Date.now()}${Math.random()}`, u, v, ru: r / w, p }]);
  }
  let patchNote = '';

  function smartNote() {
    if (!smart) return 'Off: the cut follows your trace exactly.';
    if (!outlines().some((t) => t.op === 'add')) return 'Snaps the trace in to the object\'s edge.';
    const s = smartCut();
    if (s.tooMuch) return 'Too close to its background to tell apart: your trace is kept as drawn.';
    const kept = s.giveN ? ' Kept the object\'s own edge inside the parts left out.' : '';
    return (s.share > 0.005 ? `Trimmed ${Math.round(s.share * 100)}% of the traced area: background just inside your trace.` : 'Nothing to trim: your trace already follows the edge.') + kept;
  }

  /** Alpha mask of all traces at w×h, less what smart edges trim, feathered. */
  function maskCanvas(w, h, featherPx) {
    const f = outlines().length ? finalMask() : null;
    let m;
    if (f?.changed) {
      // Smart edges and patches, scaled up smoothly (no faint rim of the hand-drawn outline left around it).
      m = document.createElement('canvas'); m.width = w; m.height = h;
      const c = m.getContext('2d');
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.drawImage(f.canvas, 0, 0, w, h);
    } else m = traceCanvas(w, h);
    const ctx = m.getContext('2d');
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
    for (const t of outlines()) { ctx.strokeStyle = t.op === 'add' ? '#ffffff' : '#ff3b30'; tracePath(ctx, t.points, w, h); ctx.stroke(); }
    ctx.strokeStyle = '#ffd60a';
    for (const t of traces.filter((x) => x.op === 'patch')) { ctx.beginPath(); ctx.arc(t.u * w, t.v * h, t.ru * w, 0, Math.PI * 2); ctx.stroke(); }
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
      if (mode === 'delete') { e.preventDefault(); removeTraceAt(at(e)); return; }
      if (mode === 'patch') { e.preventDefault(); patchAt(...at(e)); return; }
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
      if (pts.length >= 3 && polygonArea(pts.map(([u, v]) => [u * r.width, v * r.height])) > 150) { commit([...traces, { op: mode, points: smoothClosed(pts, 2) }]); return; }
      refresh();
    };
    /** Delete the trace tapped: the one whose line is nearest (within a finger's width), else the smallest one around the spot. */
    function removeTraceAt([u, v]) {
      const r = canvas.getBoundingClientRect();
      const px = ([a, b]) => [a * r.width, b * r.height];
      const [x, y] = px([u, v]);
      let best = -1; let bestD = 24;
      // A patch tapped inside: the most recent one.
      traces.forEach((t, i) => { if (t.op === 'patch' && Math.hypot(x - t.u * r.width, y - t.v * r.height) <= t.ru * r.width) best = i; });
      if (best >= 0) { commit(traces.filter((_, i) => i !== best)); return; }
      traces.forEach((t, i) => {
        if (t.op === 'patch') return;
        const pts = t.points.map(px);
        for (let k = 0; k < pts.length; k++) { const d = segDist(x, y, pts[k], pts[(k + 1) % pts.length]); if (d < bestD) { bestD = d; best = i; } }
      });
      if (best < 0) {
        let area = Infinity;
        traces.forEach((t, i) => { if (t.op === 'patch') return; const pts = t.points.map(px); if (inPolygon(x, y, pts)) { const a = polygonArea(pts); if (a < area) { area = a; best = i; } } });
      }
      if (best >= 0) commit(traces.filter((_, i) => i !== best));
    }
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

/** Distance from (x, y) to the segment a–b. */
function segDist(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax; const dy = by - ay; const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
/** Whether (x, y) is inside a polygon (even-odd). */
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
