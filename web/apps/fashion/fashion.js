// Fashion (in Magic): put a piece of clothing from one photo onto the person in another. Two photos: the
// base (the person to dress) and the piece (a photo with the top, jacket, pants, dress, hat or shoes in
// it, worn or not). Pick its kind, then the piece itself: ✨ found by itself (where that kind is worn),
// 👆 a tap on its color (the area of that color found, as Reverse Fill does; the magnifier shows what's
// under the finger), or ✏️ a loop traced around it; 🧽 taps take colors away. Then on the base: ➕ Add
// (as it is, on top), 🧥 Overlay (over what's worn there, fitted to it), or 🔁 Replace (what's worn
// there taken off and filled, the piece fitted to its shape). Placed by the body (as big as the person,
// where that kind is worn), its light matched to the photo, the photo's folds and shadows carried onto
// it, hair kept in front; then fine-tuned: drag it, size, width, length, turn, fit, form, light, edge.
// All on this phone (the person finder runs here, offline): nothing leaves it.

import { el, fill, about } from '../../lib/dom.js';
import { sniffType, decodeImage, fitSize, drawToCanvas } from '../../lib/image.js';
import { shareFiles, canShareFiles, downloadBlob } from '../../lib/files.js';
import { drawLoupe } from '../../lib/loupe.js';
import { fillPolygon, softenMask } from '../../lib/geometry.js';
import { noteError } from '../../lib/diag.js';
import { colorRegion, sampleShade, cleanUp, strokeShape } from '../../tools/editor/cleanup.js';
import { KINDS, boxOf, peopleAt, bodyLayout, kindZone, kindRegion, mainParts, fillHoles, rowSpans, rigidPlace, renderPiece, lightGains, formMap, finishLayer, composite } from '../../tools/fashion/fashion-core.js';

const WORK_MAX = 1024;
const MODES = [['add', '➕ Add'], ['overlay', '🧥 Overlay'], ['replace', '🔁 Replace']];
// What each way starts with: how far it's fitted to what's worn there, and how much of the photo's form it takes.
const MODE_TUNE = { add: { fit: 0, form: 35 }, overlay: { fit: 55, form: 55 }, replace: { fit: 85, form: 65 } };
const newTune = (mode) => ({ scale: 100, wide: 100, long: 100, rot: 0, dx: 0, dy: 0, soft: 2, light: 60, front: true, ...MODE_TUNE[mode] });

export function mount(host) {
  /** @type {any} */ let base = null; /** @type {any} */ let piece = null;
  let kind = 'top'; let mode = 'replace'; let step = 'photos';
  let tool = 'tap';        // the piece: 'tap' | 'erase' | 'trace'; the base: 'move' | 'tap' | 'trace'
  let tol = 20; let note = ''; let busy = false;
  let target = null;       // what's worn on the base there: { mask, box, spans, auto }
  let filled = null;       // the base with that taken off (Replace): { key, rgba }
  let tune = newTune(mode); let place = null;
  let form = null;         // the base's form where the piece is: { key, box, map }
  let canvas = null; let ctx = null; let panel = null; let raf = 0; let press = null; let shown = null;
  let alive = true;

  // ---------- photos ----------

  async function load(file) {
    const type = await sniffType(file);
    const bmp = await decodeImage(file, type);
    const fit = fitSize(bmp.width, bmp.height, WORK_MAX);
    const c = drawToCanvas(bmp, fit.width, fit.height, '#fff'); bmp.close?.();
    const img = { canvas: c, w: c.width, h: c.height, rgba: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, people: null, layout: null, finding: true };
    // The person in it (where their face, body and clothes are), worked out on the phone. Without it
    // (the model can't load), everything still works by tapping and tracing.
    (async () => {
      try {
        const { segmentPeople } = await import('../../lib/face-parts.js');
        const p = await segmentPeople(c);
        if (p) { img.people = peopleAt(p, img.w, img.h); img.layout = bodyLayout(img.people, img.rgba); }
      } catch (e) { noteError('Fashion: finding the person', e); }
      img.finding = false;
      if (!alive) return;
      if (img === piece && step === 'pick' && !piece.sel) autoPick(true);
      if (img === base && step === 'put') { if (!target) autoTarget(); placeIt(); }
      render();
    })();
    return img;
  }

  function photosView() {
    const slot = (which, label, hint) => {
      const img = which === 'base' ? base : piece;
      const input = el('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: `fa-${which}` });
      input.addEventListener('change', async () => {
        const f = input.files?.[0]; input.value = ''; if (!f) return;
        note = 'Opening…'; render();
        try {
          const im = await load(f);
          if (which === 'base') { base = im; target = null; filled = null; } else { piece = im; piece.sel = null; }
          note = '';
        } catch (e) { note = e.message; }
        render();
      });
      const thumb = img ? el('img', { class: 'fa-thumb', alt: label, src: img.canvas.toDataURL('image/jpeg', 0.7) }) : el('span', { class: 'fa-thumb fa-empty', text: which === 'base' ? '🧍' : '👕' });
      return el('label', { class: 'card fa-slot', for: `fa-${which}` }, thumb, el('strong', { text: label }), el('span', { class: 'small muted', text: img ? 'Tap to change' : hint }), input);
    };
    return [
      el('div', { class: 'fa-slots' },
        slot('base', '1 · Base', 'The person to dress'),
        slot('piece', '2 · Piece', 'A photo with the clothes in it')),
      note ? el('p', { class: 'small muted center', text: note }) : null,
      el('button', { class: 'btn primary block', type: 'button', text: 'Next: pick the piece', disabled: !base || !piece, onclick: () => { step = 'pick'; tool = 'tap'; note = ''; if (!piece.sel) autoPick(true); render(); } }),
      about('Pick the person to dress, then a photo with the piece in it (worn by someone, or on its own). Both stay on this phone: nothing is uploaded.'),
    ];
  }

  // ---------- the piece ----------

  /** ✨ The piece found by itself: what's worn where its kind is, on the person in its photo. */
  function autoPick(quiet = false) {
    if (!piece) return;
    if (piece.finding) { if (!quiet) note = 'Still finding the person…'; return; }
    const r = piece.people && piece.layout ? kindRegion(kind, piece.people, piece.layout) : null;
    if (!r) { if (!quiet) note = 'Couldn\'t find one by itself: tap its color, or trace around it.'; return; }
    setSel(r.mask); note = 'Found ✨ (pink). Tap more of it, 🧽 take colors away, or ✏️ trace to keep only what\'s inside.';
  }
  function setSel(mask, keepPicks = false) {
    if (!keepPicks) piece.picks = { add: [], del: [], loop: null, base: mask };
    const b = boxOf(mask, piece.w, piece.h);
    piece.sel = b ? mask : null; piece.box = b; piece.alpha = null; piece.view = null; place = null;
  }
  /**
   * A tap on the piece: its color picked (👆) or taken away (🧽). The piece is the area of all the colors
   * picked, grown from all the spots tapped together (so stripes or a print, color against color, are one
   * piece), less the areas of the colors taken away, inside a traced loop if there is one.
   */
  function pickAt(x, y) {
    const { w, h, rgba } = piece;
    const c = { at: [x, y], shade: sampleShade(rgba, w, h, x, y, 2) };
    if (!colorRegion(rgba, w, h, [c.at], [c.shade], tol)) { note = 'Nothing of that color right there: press on it (the magnifier shows what you\'re on).'; return; }
    piece.picks ??= { add: [], del: [], loop: null, base: null };
    piece.picks[tool === 'erase' ? 'del' : 'add'].push(c);
    rebuildSel();
    note = tool === 'erase' ? 'Taken away.' : piece.sel && boxShare(piece) > 0.6 ? 'That covers much of the photo: lower Match, or ✏️ trace around just the piece.' : '';
  }
  const boxShare = (im) => { const b = im.box; return b ? ((b.x1 - b.x0) * (b.y1 - b.y0)) / (im.w * im.h) : 0; };
  /** The piece from what's been picked (on top of what was found by itself, if it was). */
  function rebuildSel() {
    const { w, h, rgba } = piece; const pk = piece.picks;
    const m = pk.base ? Uint8Array.from(pk.base) : new Uint8Array(w * h);
    if (pk.add.length) {
      const r = colorRegion(rgba, w, h, pk.add.map((c) => c.at), pk.add.map((c) => c.shade), tol);
      if (r) for (let i = 0; i < w * h; i++) if (r.sel[i]) m[i] = 1;
    }
    let b = boxOf(m, w, h); if (b) fillHoles(m, w, h, b, 0.3);
    if (pk.del.length) {
      const r = colorRegion(rgba, w, h, pk.del.map((c) => c.at), pk.del.map((c) => c.shade), tol);
      if (r) for (let i = 0; i < w * h; i++) if (r.sel[i]) m[i] = 0;
    }
    if (pk.loop) for (let i = 0; i < w * h; i++) if (!pk.loop[i]) m[i] = 0;
    b = boxOf(m, w, h);
    const k = b ? mainParts(m, w, h, b, 0.05) : null;
    setSel(k ? k.mask : m, true);
  }
  function traceLoop(pts, w, h) {
    const b = { x0: 0, y0: 0, x1: w, y1: h };
    const f = fillPolygon(pts, b.x0, b.y0, w, h);
    const m = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) m[i] = f[i] ? 1 : 0;
    return m;
  }

  function pickView() {
    const kinds = el('div', { class: 'chips' }, ...KINDS.map(([id, icon, name]) => el('button', {
      type: 'button', class: `chip${kind === id ? ' active' : ''}`, 'aria-pressed': String(kind === id), text: `${icon} ${name}`,
      onclick: () => { kind = id; target = null; filled = null; place = null; if (piece.people) autoPick(); render(); },
    })));
    const tools = el('div', { class: 'chips' },
      el('button', { type: 'button', class: 'chip', text: '✨ Find it', disabled: piece.finding || !piece.people, onclick: () => { autoPick(); render(); } }),
      ...[['tap', '👆 Tap its color'], ['erase', '🧽 Take away'], ['trace', '✏️ Trace']].map(([id, label]) => el('button', {
        type: 'button', class: `chip${tool === id ? ' active' : ''}`, 'aria-pressed': String(tool === id), text: label,
        onclick: () => { tool = id; note = id === 'trace' ? (piece.sel ? 'Draw around the piece: only what\'s inside stays.' : 'Draw all the way around the piece.') : ''; render(); },
      })),
      piece.sel ? el('button', { type: 'button', class: 'chip', text: 'Clear', onclick: () => { piece.picks = { add: [], del: [], loop: null, base: null }; setSel(new Uint8Array(piece.w * piece.h), true); render(); } }) : null);
    return [
      el('p', { class: 'small', text: 'What is it?' }), kinds,
      tools,
      el('div', { class: 'range-row' }, el('span', { class: 'small', text: 'Match' }), rangeInput(4, 45, tol, 'Match', (v) => { tol = v; }, () => { if (piece.picks?.add.length || piece.picks?.del.length) { rebuildSel(); render(); } })),
      el('p', { class: 'small muted', 'aria-live': 'polite', text: note || (piece.finding ? 'Finding the person…' : piece.sel ? 'Pink is the piece.' : 'Press on the piece\'s color (the magnifier shows what you\'re on), or trace around it.') }),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', type: 'button', text: '‹ Photos', onclick: () => { step = 'photos'; note = ''; render(); } }),
        el('button', { class: 'btn primary', type: 'button', text: 'Next: put it on', disabled: !piece.sel, onclick: () => goPut() })),
    ];
  }

  // ---------- on the base ----------

  function goPut() {
    step = 'put'; tool = 'move'; note = '';
    // Its edge: softened a little so it isn't cut out with a hard line.
    piece.alpha = softenMask(piece.sel, piece.w, piece.h, 1);
    if (!target) autoTarget();
    tune = newTune(mode); placeIt();
    render();
  }
  /** What's worn on the base where the piece goes, found by itself (for Overlay and Replace). */
  function autoTarget() {
    if (!base?.people || !base.layout || kind === 'other') return;
    const r = kindRegion(kind, base.people, base.layout);
    if (r) setTarget(r.mask, true);
  }
  function setTarget(mask, auto = false) {
    const b = boxOf(mask, base.w, base.h);
    target = b ? { mask, box: b, spans: rowSpans(mask, base.w, b, 3), auto } : null; filled = null; form = null;
  }
  function placeIt() {
    if (!piece?.box || !base) return;
    const zone = base.layout ? kindZone(kind, base.layout, base.w, base.h) : null;
    place = rigidPlace(kind, piece.box, piece.layout, base.layout, target?.box ?? zone, base.w, base.h);
  }
  function tapTarget(x, y) {
    const { w, h, rgba } = base;
    const c = { at: [x, y], shade: sampleShade(rgba, w, h, x, y, 2) };
    if (!colorRegion(rgba, w, h, [c.at], [c.shade], tol)) { note = 'Nothing of that color right there.'; return; }
    const taps = [...(target && !target.auto ? target.taps ?? [] : []), c];
    const r = colorRegion(rgba, w, h, taps.map((t) => t.at), taps.map((t) => t.shade), tol);
    const k = r && mainParts(r.sel, w, h, r.box, 0.05);
    if (k) { fillHoles(k.mask, w, h, k.box, 0.3); setTarget(k.mask); target.taps = taps; }
    placeIt(); note = 'That\'s what it goes on (yellow). Tap more of it, or ✋ Move to place the piece.';
  }

  /** The finished picture, on `out` (rgba, the base's size). */
  function compose(out) {
    const { w, h } = base;
    if (mode === 'replace' && target) {
      if (filled?.target !== target) filled = { target, rgba: takeOff() };
      out.set(filled.rgba);
    } else out.set(base.rgba);
    if (!place || !piece?.alpha) return null;
    const p = { x0: place.x0, y0: place.y0, s: place.s };
    const region = mode !== 'add' && target ? (mode === 'overlay' ? { box: target.box, spans: widen(target.spans, target.box, 0.04) } : target) : null;
    let layer = renderPiece(piece.rgba, piece.alpha, piece.w, piece.h, piece.box, p, region, tune.fit / 100, w, h);
    if (!layer) return null;
    layer = transformLayer(layer, w, h);
    if (!layer) return null;
    // The base's form where the piece is.
    const fbox = { x0: layer.x0, y0: layer.y0, x1: layer.x0 + layer.pw, y1: layer.y0 + layer.ph };
    const key = `${fbox.x0},${fbox.y0},${fbox.x1},${fbox.y1},${mode}`;
    if (form?.key !== key) {
      const fh = base.layout?.fh ?? h / 7;
      form = { key, box: fbox, map: formMap(base.rgba, w, fbox, Math.max(1, Math.round(fh / 40)), Math.max(4, Math.round(fh / 3))) };
    }
    const front = tune.front && base.people && kind !== 'shoes' ? frontMask() : null;
    const gains = lightGains(piece.rgba, piece.people?.face ?? null, base.rgba, base.people?.face ?? null);
    finishLayer(layer, w, { gains, light: tune.light / 100, form: form.map, fbox: form.box, formAmt: tune.form / 100, front, soft: tune.soft });
    composite(out, w, h, layer);
    return layer;
  }
  /** Spans widened by `k` of the box's width on each side (Overlay: over what's worn, a little bigger). */
  function widen(spans, box, k) {
    const d = (box.x1 - box.x0) * k; const out = Float32Array.from(spans);
    for (let i = 0; i < out.length; i += 2) if (out[i] >= 0) { out[i] -= d; out[i + 1] += d; }
    return out;
  }
  /** What's kept in front of the piece: the face, and the hair (a hat goes over the hair, so only the face). */
  let frontCache = null;
  function frontMask() {
    const k = kind === 'hat' ? 'face' : 'both';
    if (frontCache?.base === base && frontCache.k === k) return frontCache.m;
    const { face, hair } = base.people; const m = new Uint8Array(face.length);
    for (let i = 0; i < m.length; i++) m[i] = k === 'face' ? face[i] : Math.max(face[i], hair[i]);
    frontCache = { base, k, m };
    return m;
  }
  /** What's worn there taken off the base (Replace): filled from what's around it. */
  function takeOff() {
    const { w, h } = base; const out = Uint8ClampedArray.from(base.rgba);
    const b = target.box; const m = new Uint8Array(w * h);
    // (A couple of pixels past its edge, so no rim of it is left.)
    for (let y = Math.max(0, b.y0 - 2); y < Math.min(h, b.y1 + 2); y++) for (let x = Math.max(0, b.x0 - 2); x < Math.min(w, b.x1 + 2); x++) {
      let on = 0; for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx; const Y = y + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && target.mask[Y * w + X]) { on = 1; break; } }
      m[y * w + x] = on;
    }
    const box = { x0: Math.max(0, b.x0 - 2), y0: Math.max(0, b.y0 - 2), x1: Math.min(w, b.x1 + 2), y1: Math.min(h, b.y1 + 2) };
    try {
      const p = cleanUp(base.rgba, w, h, m, box);
      if (p) for (let y = 0; y < p.ph; y++) for (let x = 0; x < p.pw; x++) {
        const o = (y * p.pw + x) * 4; const a = p.rgba[o + 3] / 255; if (!a) continue;
        const i = ((p.y0 + y) * w + p.x0 + x) * 4;
        for (let c = 0; c < 3; c++) out[i + c] = out[i + c] * (1 - a) + p.rgba[o + c] * a;
      }
    } catch (e) { noteError('Fashion: taking it off', e); }
    return out;
  }
  /** The layer moved, sized, stretched and turned by hand (about its middle). */
  function transformLayer(layer, w, h) {
    const t = tune;
    if (t.scale === 100 && t.wide === 100 && t.long === 100 && !t.rot && !t.dx && !t.dy) return layer;
    const src = document.createElement('canvas'); src.width = layer.pw; src.height = layer.ph;
    src.getContext('2d').putImageData(new ImageData(layer.rgba, layer.pw, layer.ph), 0, 0);
    const sx = (t.scale / 100) * (t.wide / 100); const sy = (t.scale / 100) * (t.long / 100); const r = (t.rot * Math.PI) / 180;
    const cx = layer.x0 + layer.pw / 2; const cy = layer.y0 + layer.ph / 2;
    // Its box after: the corners turned and sized.
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const x = (u * layer.pw) / 2 * sx; const y = (v * layer.ph) / 2 * sy; return [cx + t.dx + x * Math.cos(r) - y * Math.sin(r), cy + t.dy + x * Math.sin(r) + y * Math.cos(r)]; });
    const x0 = Math.max(0, Math.floor(Math.min(...cs.map((c) => c[0])))); const y0 = Math.max(0, Math.floor(Math.min(...cs.map((c) => c[1]))));
    const x1 = Math.min(w, Math.ceil(Math.max(...cs.map((c) => c[0])))); const y1 = Math.min(h, Math.ceil(Math.max(...cs.map((c) => c[1]))));
    if (x1 <= x0 || y1 <= y0) return null;
    const dst = document.createElement('canvas'); dst.width = x1 - x0; dst.height = y1 - y0;
    const c2 = dst.getContext('2d');
    c2.translate(cx + t.dx - x0, cy + t.dy - y0); c2.rotate(r); c2.scale(sx, sy); c2.drawImage(src, -layer.pw / 2, -layer.ph / 2);
    return { x0, y0, pw: dst.width, ph: dst.height, rgba: c2.getImageData(0, 0, dst.width, dst.height).data };
  }

  function putView() {
    const hasPerson = !!base.layout;
    const modeBar = el('div', { class: 'segmented', role: 'tablist' }, ...MODES.map(([id, label]) => el('button', {
      class: `seg${mode === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(mode === id), text: label,
      onclick: () => { mode = id; Object.assign(tune, MODE_TUNE[id]); form = null; note = id !== 'add' && !target ? 'Tap what it goes on in the photo (👆), or trace it (✏️): it\'s fitted to that.' : ''; render(); },
    })));
    const tools = el('div', { class: 'chips' },
      ...[['move', '✋ Move'], ['tap', '👆 Tap what it goes on'], ['trace', '✏️ Trace it']].map(([id, label]) => el('button', {
        type: 'button', class: `chip${tool === id ? ' active' : ''}`, 'aria-pressed': String(tool === id), text: label,
        onclick: () => { tool = id; note = id === 'move' ? 'Drag the piece to move it.' : id === 'tap' ? 'Tap what\'s worn there now (its color).' : 'Draw around what\'s worn there now.'; render(); },
      })),
      target ? el('button', { type: 'button', class: 'chip', text: 'Clear what it goes on', onclick: () => { target = null; filled = null; placeIt(); render(); } }) : null,
      el('button', { type: 'button', class: 'chip', text: '↺ Reset', onclick: () => { tune = newTune(mode); placeIt(); render(); } }));
    const row = (label, key, min, max, extra = '') => el('div', { class: 'fa-tune' }, el('span', { class: 'small', text: label }),
      rangeInput(min, max, tune[key], label, (v) => { tune[key] = v; }), extra ? el('span', { class: 'small muted', text: extra }) : null);
    return [
      modeBar,
      el('p', { class: 'small muted', text: { add: 'Add: the piece as it is, on top (a hat, shoes, something new).', overlay: 'Overlay: over what\'s worn there, fitted to it (a jacket over a shirt).', replace: 'Replace: what\'s worn there is taken off, and the piece fitted to its shape.' }[mode] }),
      tools,
      el('div', { class: 'fa-tunes' },
        row('Size', 'scale', 40, 200), row('Width', 'wide', 50, 160), row('Length', 'long', 50, 160), row('Turn', 'rot', -45, 45),
        mode !== 'add' ? row('Fit to body', 'fit', 0, 100) : null,
        row('Form', 'form', 0, 100), row('Light', 'light', 0, 100), row('Edge', 'soft', 0, 12)),
      kind !== 'shoes' && base.people ? el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: tune.front, onchange: (e) => { tune.front = e.target.checked; render(); } }), el('span', { text: kind === 'hat' ? 'Keep the face in front' : 'Keep hair and face in front' })) : null,
      el('p', { class: 'small muted', 'aria-live': 'polite', text: note || (base.finding ? 'Finding the person…' : hasPerson ? '' : 'No person found in the base: drag the piece into place.') }),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', type: 'button', text: '‹ Piece', onclick: () => { step = 'pick'; tool = 'tap'; note = ''; render(); } }),
        el('button', { class: 'btn primary', type: 'button', text: '💾 Save', disabled: busy, onclick: save })),
      about('Form carries the photo\'s folds and shadows onto the piece; Light matches its light to the photo; Fit to body bends it onto the shape of what\'s worn there; Edge softens its edge. Everything is worked out on this phone.'),
    ];
  }

  async function save() {
    busy = true; render();
    try {
      const c = document.createElement('canvas'); c.width = base.w; c.height = base.h;
      const out = new Uint8ClampedArray(base.w * base.h * 4); compose(out);
      c.getContext('2d').putImageData(new ImageData(out, base.w, base.h), 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
      const name = `fashion-${new Date().toISOString().slice(0, 10)}.jpg`;
      const f = new File([blob], name, { type: 'image/jpeg' });
      if (!(canShareFiles([f]) && await shareFiles([f], name))) downloadBlob(blob, name);
    } catch (e) { noteError('Fashion: save', e); note = e.message; }
    busy = false; render();
  }

  // ---------- the picture and the finger ----------

  function rangeInput(min, max, value, label, set, done = null) {
    const out = el('output', { text: String(value) });
    const r = el('input', { type: 'range', min: String(min), max: String(max), value: String(value), 'aria-label': label });
    r.addEventListener('input', () => { out.textContent = r.value; set(Number(r.value)); draw(); });
    if (done) r.addEventListener('change', done);
    return el('span', { class: 'range-row fa-range' }, r, out);
  }

  /** The canvas pixel under a pointer event. */
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height]; };
  function onDown(e) {
    if (step === 'photos' || busy) return;
    canvas.setPointerCapture?.(e.pointerId); e.preventDefault();
    const p = at(e);
    press = { pts: [p], start: p, dx: tune.dx, dy: tune.dy };
    draw();
  }
  function onMove(e) {
    if (!press) return; e.preventDefault();
    const p = at(e); press.pts.push(p);
    if (step === 'put' && tool === 'move') { tune.dx = Math.round(press.dx + p[0] - press.start[0]); tune.dy = Math.round(press.dy + p[1] - press.start[1]); }
    draw();
  }
  function onUp() {
    if (!press) return;
    const pr = press; press = null;
    const img = step === 'pick' ? piece : base;
    const last = pr.pts.at(-1); const k = canvas.width / canvas.getBoundingClientRect().width;
    const shape = strokeShape(pr.pts, 10 * k);
    if (step === 'pick' || tool !== 'move') {
      const isTrace = tool === 'trace' && shape === 'lasso';
      if (tool === 'trace' && !isTrace) note = 'Draw all the way around it.';
      else if (isTrace) {
        const loop = traceLoop(pr.pts, img.w, img.h);
        if (step === 'pick') {
          piece.picks ??= { add: [], del: [], loop: null, base: null };
          if (piece.sel) { piece.picks.loop = loop; rebuildSel(); } else setSel(loop);
          note = piece.sel ? '' : 'Nothing inside that loop.';
        } else { setTarget(loop); placeIt(); note = 'That\'s what it goes on (yellow).'; }
      } else if (last[0] >= 0 && last[1] >= 0 && last[0] < img.w && last[1] < img.h) {
        if (step === 'pick') pickAt(Math.round(last[0]), Math.round(last[1])); else tapTarget(Math.round(last[0]), Math.round(last[1]));
      }
      render(); return;
    }
    draw();
  }

  /** What's shown: the piece's photo with the piece in pink, or the base with the piece on it. */
  function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!canvas || !ctx) return;
      const img = step === 'pick' ? piece : base; if (!img) return;
      if (canvas.width !== img.w || canvas.height !== img.h) { canvas.width = img.w; canvas.height = img.h; }
      if (step === 'pick') {
        if (piece.view?.sel !== piece.sel) {
          const v = new Uint8ClampedArray(piece.rgba);
          if (piece.sel) for (let i = 0; i < piece.w * piece.h; i++) if (piece.sel[i]) { v[i * 4] = v[i * 4] * 0.45 + 255 * 0.55; v[i * 4 + 1] *= 0.45; v[i * 4 + 2] = v[i * 4 + 2] * 0.45 + 149 * 0.55; }
          piece.view = { sel: piece.sel, data: new ImageData(v, piece.w, piece.h) };
        }
        ctx.putImageData(piece.view.data, 0, 0);
      } else {
        const out = new Uint8ClampedArray(base.w * base.h * 4);
        try { compose(out); } catch (e) { noteError('Fashion: putting it on', e); }
        if (target && tool !== 'move') for (let y = target.box.y0; y < target.box.y1; y++) for (let x = target.box.x0; x < target.box.x1; x++) {
          const i = y * base.w + x; if (!target.mask[i]) continue;
          const edge = !target.mask[i - 1] || !target.mask[i + 1] || !target.mask[i - base.w] || !target.mask[i + base.w];
          if (edge) out.set([255, 214, 10, 255], i * 4);
        }
        ctx.putImageData(new ImageData(out, base.w, base.h), 0, 0);
      }
      shown = step;
      // A loop being drawn, and the magnifier while picking a color.
      if (press && (tool === 'trace' || tool === 'tap' || tool === 'erase')) {
        const k = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
        if (tool === 'trace') {
          ctx.save(); ctx.lineWidth = 2 * k; ctx.strokeStyle = '#ff2d95'; ctx.setLineDash([6 * k, 4 * k]); ctx.beginPath();
          press.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
        } else { const [x, y] = press.pts.at(-1); drawLoupe(ctx, img.canvas, x, y, { k }); }
      }
    });
  }

  function render() {
    if (!alive) return;
    if (step === 'photos') { canvas = null; ctx = null; fill(host, el('div', { class: 'fa' }, ...photosView().filter(Boolean))); return; }
    if (!canvas || shown === 'photos') {
      canvas = el('canvas', { class: 'fa-canvas', 'aria-label': 'Photo' });
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', () => { press = null; draw(); });
      panel = el('div', { class: 'fa-panel' });
      fill(host, el('div', { class: 'fa' }, el('div', { class: 'fa-stage' }, canvas), panel));
      shown = null;
    }
    fill(panel, ...(step === 'pick' ? pickView() : putView()).filter(Boolean));
    draw();
  }

  render();
  return () => { alive = false; cancelAnimationFrame(raf); };
}
