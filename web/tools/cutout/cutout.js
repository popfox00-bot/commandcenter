// Cutout: trace around an object with a finger to cut it out of a photo. Smart edges then trim the
// background left just inside the trace, carefully (cutout-core.js smartEdge). What's still off is
// fixed by hand: Patch fix (drag along an edge: it's worked out again there), Wand (tap a leftover to
// cut it away, or a part cut off to bring it back) and Brush (paint it exactly), each set to cut away
// or keep, with a magnifier under the finger. Save it as a transparent PNG, keep it as a "Character"
// for later, or place it onto another photo (Collage tab).
import { el, store, fill } from '../../lib/dom.js';
import { sniffType, decodeImage, fitSize, drawToCanvas, canvasToBlob } from '../../lib/image.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes, renameExt } from '../../lib/files.js';
import { listCharacters, addCharacter, getCharacterBlob, renameCharacter, removeCharacter } from '../../lib/characters.js';
import { smoothClosed, polygonArea, thin, featherAlpha, alphaBounds, smartEdge, softColors, textureMap, edgeDistance, colorModel, refineSpot, wand, wandAuto, refineEdge, brush, applyChanges } from './cutout-core.js';

const WORK_MAX = 2400; // cut resolution (long edge)
const SMART_MAX = 720;  // smart edges are worked out at this size (long edge), then scaled up
const SMART_KEY = 'cc.cutout.smart';

/** mount(host, { onPlace, file }) — onPlace(file) puts a cutout on a photo in the Collage tab. */
export function mount(host, { onPlace, file: initialFile } = {}) {
  let image = null; let fileName = 'photo.png';
  // [{ op: 'add' | 'sub', points: [[u,v]...] }] in image-normalized coordinates, and fixes:
  // { op: 'fix', kind: 'patch' | 'wand' | 'brush', id, spots: [[u, v, ru]...], ch: { idx, val } } (the
  // pixels of the work copy they set, replayed in order over the cut).
  let traces = [];
  let past = []; let redo = []; // undo/redo: earlier and later lists of traces
  let mode = 'add'; let feather = 2; let preview = false;
  let smart = store.get(SMART_KEY) !== 'off';
  let smartCache = null; // smart edges for the current outlines (see smartCut)
  let finalCache = null; // the cut with patches applied (see finalMask)
  let work = null;       // the photo at the work size for smart edges and patches: { w, h, rgba }
  let patchSize = Number(store.get('cc.cutout.patch')) || 36; // patch / brush radius, in screen px
  // Patch, wand and brush work out in or out themselves ('auto'); ✂️ Cut away or ↩︎ Keep can be picked
  // for the next stroke or tap, then it's back to Auto.
  let patchDir = 'auto'; let paintDir = 'auto';
  let wandTol = Number(store.get('cc.cutout.tol')) || 28;
  let stroke = null; // a patch or brush stroke in progress (see startStroke)
  let loupe = null;  // [u, v] under the finger while fixing: shown magnified
  const outlines = () => traces.filter((t) => t.op === 'add' || t.op === 'sub');
  const fixes = () => traces.filter((t) => t.op === 'fix');
  const FIX_MODES = ['patch', 'wand', 'brush'];
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
    fill(panel,
      el('div', { class: 'segmented co-modes', role: 'radiogroup' },
        ...[['add', '✏️ Trace'], ['sub', '➕ Add to trace'], ['patch', '🩹 Patch fix'], ['wand', '🪄 Wand'], ['brush', '🖌 Brush'], ['delete', '🗑 Remove trace']].map(([id, label]) => el('button', {
          class: `seg${mode === id ? ' active' : ''}`, role: 'radio', 'aria-checked': String(mode === id), text: label,
          onclick: () => { mode = id; patchNote = ''; refresh(); },
        }))),
      el('p', { class: 'muted small', text: {
        add: 'Draw all the way around what you want to keep. Lift your finger to close the outline; trace again to add more.',
        sub: 'Trace inside your outline around a part to leave out, like the sky under a basket\'s handle or the gap between an arm and a body.',
        patch: {
          auto: 'Tap or drag along where the edge is off: the edge is found again there from the colors and textures of the object and the background, moving in or out. ✨ Refine whole edge does it all the way round.',
          cut: 'For the next drag: background left in (grass, sky, table) is cut away where it looks like background. Nothing is added. Then back to Auto.',
          keep: 'For the next drag: parts cut off by mistake come back where they look like the object. Nothing is cut. Then back to Auto.',
        }[patchDir],
        wand: { auto: 'Tap a leftover (cut away) or a part cut off (brought back): everything joined to it that looks like it changes, never what looks like the other side.', cut: 'For the next tap: everything joined to it that looks like it is cut away. Then back to Auto.', keep: 'For the next tap: everything joined to it that looks like it comes back (inside your trace). Then back to Auto.' }[paintDir],
        brush: { auto: 'A smart brush: paint along an edge, and under the brush each pixel goes with the object or the background, by its color and texture.', cut: 'For the next stroke: what you paint goes, exactly. Then back to Auto.', keep: 'For the next stroke: what you paint stays, exactly. Then back to Auto.' }[paintDir],
        delete: 'Tap a trace or a fix to delete it. Undo brings it back.',
      }[mode] }),
      FIX_MODES.includes(mode) ? el('div', { class: 'segmented co-dir', role: 'radiogroup', 'aria-label': 'Fix' },
        ...[['auto', '✨ Auto'], ['cut', '✂️ Cut away'], ['keep', '↩︎ Keep']].map(([id, label]) => {
          const on = (mode === 'patch' ? patchDir : paintDir) === id;
          return el('button', { class: `seg${on ? ' active' : ''}`, role: 'radio', 'aria-checked': String(on), text: label, onclick: () => {
            if (mode === 'patch') patchDir = id; else paintDir = id;
            patchNote = ''; renderPanel();
          } });
        })) : null,
      mode === 'patch' ? el('button', { class: 'btn small-btn', text: '✨ Refine whole edge', onclick: refineWhole }) : null,
      FIX_MODES.includes(mode) && patchNote ? el('p', { class: `small ${/^Nothing/.test(patchNote) ? 'warn-text' : 'muted'}`, 'aria-live': 'polite', text: patchNote }) : null,
      mode === 'patch' || mode === 'brush' ? (() => {
        const label = mode === 'patch' ? 'Patch size' : 'Brush size';
        const size = el('input', { type: 'range', min: '6', max: '120', step: '2', value: String(patchSize), 'aria-label': label });
        size.addEventListener('input', () => { patchSize = Number(size.value); store.set('cc.cutout.patch', String(patchSize)); draw(); });
        return el('label', { class: 'field' }, el('span', { text: label }), el('span', { class: 'range-row' }, size));
      })() : null,
      mode === 'wand' ? (() => {
        const tol = el('input', { type: 'range', min: '8', max: '70', step: '2', value: String(wandTol), 'aria-label': 'Wand reach' });
        tol.addEventListener('input', () => { wandTol = Number(tol.value); store.set('cc.cutout.tol', String(wandTol)); });
        return el('label', { class: 'field' }, el('span', { text: 'Reach (how different a color it spreads to)' }), el('span', { class: 'range-row' }, tol));
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
    work = { w, h, rgba: pc.getImageData(0, 0, w, h).data, soft: null };
    return work;
  }

  const softOf = () => { const wk = workCopy(); wk.soft ??= softColors(wk.rgba, wk.w, wk.h); return wk.soft; };
  const texOf = () => { const wk = workCopy(); wk.tex ??= textureMap(softOf(), wk.w, wk.h); return wk.tex; };
  /** One-shot directions: after a stroke with ✂️ Cut away or ↩︎ Keep, back to Auto. */
  const backToAuto = () => { patchDir = 'auto'; paintDir = 'auto'; };
  /** ✨ Refine whole edge: patches all along the outline (auto), one undo step. */
  function refineWhole() {
    if (!outlines().some((t) => t.op === 'add')) { patchNote = 'Trace around something first.'; renderPanel(); return; }
    const { w, h } = workCopy();
    const base = finalMask().bits;
    const r = Math.max(8, Math.round(Math.max(w, h) / 45));
    const global = colorModel(softOf(), w, h, base, edgeDistance(base, w, h), { tex: texOf() });
    const ch = refineEdge(softOf(), texOf(), w, h, base, r, { global });
    if (!ch.idx.length) { patchNote = 'Nothing to change: the outline already follows the edge.'; renderPanel(); return; }
    const cut = [...ch.val].filter((v) => !v).length;
    patchNote = `Refined the whole edge: cut away ${plural(cut)}${ch.idx.length - cut ? `, brought back ${plural(ch.idx.length - cut)}` : ''}.`;
    commit([...traces, { op: 'fix', kind: 'edge', id: newId(), spots: [], ch }]);
  }

  /** The outlines as drawn (add, less sub) at the work size: where the wand may bring things back. */
  function tracedBits() {
    const { w, h } = workCopy();
    const d = traceCanvas(w, h).getContext('2d').getImageData(0, 0, w, h).data;
    return Uint8Array.from({ length: w * h }, (_, i) => (d[i * 4 + 3] > 127 ? 1 : 0));
  }

  /**
   * The cut at the work size: the outlines (with smart edges when on), then each fix in turn.
   * { bits, canvas, changed } (changed: it differs from the outlines as drawn, so it's used as is).
   */
  function finalMask() {
    const key = `${smart}|${outlineKey()}|${fixes().map((t) => t.id).join(',')}`;
    if (finalCache?.key === key) return finalCache;
    const { w, h } = workCopy();
    const s = smartCut();
    let bits;
    if (s && (s.cutN || s.giveN)) bits = Uint8Array.from(s.F);
    else bits = tracedBits();
    for (const f of fixes()) applyChanges(bits, f.ch);
    finalCache = { key, bits, canvas: bitsCanvas(bits, w, h), changed: !!(s && (s.cutN || s.giveN)) || fixes().length > 0 };
    return finalCache;
  }
  function bitsCanvas(bits, w, h) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const cx = canvas.getContext('2d'); const img = cx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) if (bits[i]) img.data[i * 4 + 3] = 255;
    cx.putImageData(img, 0, 0);
    return canvas;
  }

  // ---------- fixes: patch, wand, brush ----------

  let patchNote = '';
  const fixRadius = () => { const { w } = workCopy(); return Math.max(2, (patchSize / canvas.getBoundingClientRect().width) * w); };
  const newId = () => `${Date.now()}${Math.random()}`;
  const plural = (n) => `${n.toLocaleString()} pixel${n === 1 ? '' : 's'}`;

  /** A patch or brush stroke starts at (u, v): later points come through strokeTo, and endStroke keeps it. */
  function startStroke(u, v) {
    const { w, h } = workCopy();
    const base = finalMask().bits;
    const bits = Uint8Array.from(base);
    stroke = { kind: mode, base, bits, w, h, r: fixRadius(), spots: [], last: null, pts: [], noData: 0 };
    // Patch, and the brush on Auto (a smart brush), work from the cut's color and texture models.
    stroke.dir = mode === 'patch' ? patchDir : paintDir;
    if (mode === 'patch' || stroke.dir === 'auto') {
      const dist = edgeDistance(base, w, h);
      stroke.global = colorModel(softOf(), w, h, base, dist, { tex: texOf() });
    }
    strokeTo(u, v, true);
  }
  function strokeTo(u, v, first = false) {
    const s = stroke; const x = u * s.w; const y = v * s.h;
    if (s.kind === 'brush' && s.dir === 'auto') {
      // Smart brush: under the brush, each pixel goes with the object or the background (decisively).
      if (!first && s.last && Math.hypot(x - s.last[0], y - s.last[1]) < s.r * 0.5) return;
      s.last = [x, y];
      const ch = refineSpot(softOf(), s.w, s.h, s.bits, x, y, s.r, { dir: 'auto', global: s.global, tex: texOf(), decisive: true });
      if (ch) applyChanges(s.bits, ch); else s.noData++;
      s.spots.push([u, v, s.r / s.w]);
    } else if (s.kind === 'brush') {
      s.pts.push([x, y]);
      const seg = s.pts.slice(-2);
      applyChanges(s.bits, brush(s.w, s.h, s.bits, seg, s.r, s.dir === 'keep'));
      if (first || !s.last || Math.hypot(x - s.last[0], y - s.last[1]) >= s.r) { s.spots.push([u, v, s.r / s.w]); s.last = [x, y]; }
    } else {
      // A patch every ~2/3 of its radius along the drag, each on the cut as the stroke has left it.
      if (!first && s.last && Math.hypot(x - s.last[0], y - s.last[1]) < s.r * 0.66) return;
      s.last = [x, y];
      const ch = refineSpot(softOf(), s.w, s.h, s.bits, x, y, s.r, { dir: s.dir, global: s.global, tex: texOf() });
      if (ch) applyChanges(s.bits, ch); else s.noData++;
      s.spots.push([u, v, s.r / s.w]);
    }
    s.canvas = bitsCanvas(s.bits, s.w, s.h);
  }
  function endStroke() {
    const s = stroke; stroke = null;
    backToAuto();
    const idx = []; const val = [];
    for (let i = 0; i < s.bits.length; i++) if (s.bits[i] !== s.base[i]) { idx.push(i); val.push(s.bits[i]); }
    const cut = val.filter((v) => !v).length; const kept = val.length - cut;
    if (!idx.length) {
      patchNote = s.kind === 'brush' && s.dir !== 'auto' ? 'Nothing to change there: it\'s already that way.'
        : s.noData === s.spots.length ? 'Nothing to go by there: patch where the cut meets the object, with some of each around.'
          : 'Nothing to change there: the edge already follows the colors (try ✂️ Cut away or ↩︎ Keep, or the Brush).';
      refresh(); return;
    }
    patchNote = [cut ? `cut away ${plural(cut)}` : '', kept ? `brought back ${plural(kept)}` : ''].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()) + '.';
    commit([...traces, { op: 'fix', kind: s.kind, id: newId(), spots: s.spots, ch: { idx: Uint32Array.from(idx), val: Uint8Array.from(val) } }]);
  }
  function wandAt(u, v) {
    const { w, h } = workCopy();
    const bits = finalMask().bits;
    const dir = paintDir; backToAuto();
    let x = Math.round(u * w); let y = Math.round(v * h);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    // Auto: the side tapped changes. Cut away / Keep: a finger isn't a pixel, so the nearest pixel on
    // that side, within a few.
    if (dir !== 'auto') {
      const want = dir === 'cut' ? 1 : 0; let best = null;
      for (let d = 0; d <= 6 && !best; d++) for (let dy = -d; dy <= d && !best; dy++) for (let dx = -d; dx <= d; dx++) {
        const X = x + dx; const Y = y + dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) === d && X >= 0 && Y >= 0 && X < w && Y < h && bits[Y * w + X] === want) { best = [X, Y]; break; }
      }
      if (!best) { patchNote = want ? 'Nothing to cut there: tap a leftover that\'s still kept.' : 'Nothing to bring back there: tap a part that was cut off.'; refresh(); return; }
      [x, y] = best;
    }
    const cutting = !!bits[y * w + x];
    const ch = dir === 'auto'
      ? wandAuto(softOf(), texOf(), w, h, bits, x, y, wandTol, { within: tracedBits(), model: colorModel(softOf(), w, h, bits, edgeDistance(bits, w, h), { tex: texOf() }) })
      : wand(softOf(), w, h, bits, x, y, wandTol, { within: cutting ? null : tracedBits(), tex: texOf() });
    if (!ch || !ch.idx.length) { patchNote = ch ? 'Nothing to change there.' : 'Nothing to change there: it would spread over most of the photo (try less reach).'; refresh(); return; }
    patchNote = `${cutting ? 'Cut away' : 'Brought back'} ${plural(ch.idx.length)}.`;
    commit([...traces, { op: 'fix', kind: 'wand', id: newId(), spots: [[x / w, y / h, 8 / canvas.getBoundingClientRect().width]], ch }]);
  }

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
    const f = stroke ? { changed: true, canvas: stroke.canvas } : outlines().length ? finalMask() : null;
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
    // Where the fixes are (while fixing or removing them): patches as rings, brush strokes and wand taps as dots.
    if (FIX_MODES.includes(mode) || mode === 'delete') {
      ctx.setLineDash([]); ctx.lineWidth = 1.5 * dpr;
      for (const t of fixes()) {
        ctx.strokeStyle = t.kind === 'patch' ? 'rgba(255,214,10,.8)' : 'rgba(255,255,255,.85)';
        ctx.fillStyle = t.kind === 'brush' ? 'rgba(10,132,255,.5)' : 'rgba(255,214,10,.9)';
        for (const [u, v, ru] of t.spots) {
          ctx.beginPath();
          if (t.kind === 'patch') { ctx.arc(u * w, v * h, ru * w, 0, Math.PI * 2); ctx.stroke(); } else { ctx.arc(u * w, v * h, 3.5 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        }
      }
    }
    if (drawing) {
      ctx.setLineDash([]); ctx.strokeStyle = mode === 'add' ? '#0a84ff' : '#ff3b30'; ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); drawing.forEach(([u, v], i) => (i ? ctx.lineTo(u * w, v * h) : ctx.moveTo(u * w, v * h))); ctx.stroke();
    }
    if (loupe) drawLoupe(ctx, w, h, dpr);
  }

  /** A magnifier of what's under the finger (3×), in the top corner away from it, with the patch or brush size. */
  function drawLoupe(ctx, w, h, dpr) {
    const [u, v] = loupe; const x = u * w; const y = v * h;
    const R = Math.min(64 * dpr, w * 0.22); const zoom = 3; const src = R / zoom;
    const cx = u < 0.5 ? w - R - 8 * dpr : R + 8 * dpr; const cy = R + 8 * dpr;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#000'; ctx.fill(); ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, x - src, y - src, src * 2, src * 2, cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
    ctx.setLineDash([]);
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = paintDir === 'keep' && mode !== 'patch' ? '#30d158' : '#ffd60a';
    if (mode === 'wand') { ctx.beginPath(); ctx.moveTo(cx - 8 * dpr, cy); ctx.lineTo(cx + 8 * dpr, cy); ctx.moveTo(cx, cy - 8 * dpr); ctx.lineTo(cx, cy + 8 * dpr); ctx.stroke(); }
    else { const rr = Math.min(R - 2, (patchSize * dpr) * zoom); ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke(); }
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
      if (FIX_MODES.includes(mode)) {
        e.preventDefault();
        if (!outlines().some((t) => t.op === 'add')) { patchNote = 'Trace around something first.'; renderPanel(); return; }
        canvas.setPointerCapture(e.pointerId);
        loupe = at(e);
        if (mode !== 'wand') startStroke(...loupe);
        draw();
        return;
      }
      drawing = [at(e)];
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drawing) { drawing.push(at(e)); draw(); return; }
      if (loupe) { loupe = at(e); if (stroke) strokeTo(...loupe); draw(); }
    });
    const end = () => {
      if (loupe) {
        const spot = loupe; loupe = null;
        if (stroke) endStroke(); else if (mode === 'wand') wandAt(...spot); else draw();
        return;
      }
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
      // A fix tapped (inside a patch's ring, or near a brush or wand dot): the most recent one.
      traces.forEach((t, i) => { if (t.op === 'fix' && t.spots.some(([su, sv, ru]) => Math.hypot(x - su * r.width, y - sv * r.height) <= Math.max(ru * r.width, 14))) best = i; });
      if (best >= 0) { commit(traces.filter((_, i) => i !== best)); return; }
      traces.forEach((t, i) => {
        if (t.op === 'fix') return;
        const pts = t.points.map(px);
        for (let k = 0; k < pts.length; k++) { const d = segDist(x, y, pts[k], pts[(k + 1) % pts.length]); if (d < bestD) { bestD = d; best = i; } }
      });
      if (best < 0) {
        let area = Infinity;
        traces.forEach((t, i) => { if (t.op === 'fix') return; const pts = t.points.map(px); if (inPolygon(x, y, pts)) { const a = polygonArea(pts); if (a < area) { area = a; best = i; } } });
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
