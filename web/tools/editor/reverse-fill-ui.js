// @ts-check
// FM's 🎨 Reverse Fill, its tool on the photo: press on a color (the magnifier showing it), the area of
// that color found and outlined by itself (autoTrace), or a loop drawn by hand; brushed in or out; then
// taken out and filled from the surface around it (cleanup.js). Its own state; the editor hands it what
// it needs of the photo and the page (`env`).

import { el } from '../../lib/dom.js';
import { strokeMask, strokeShape, shadeMask, reverseFill, sampleShade, toLab, autoTrace, roomAround } from './cleanup.js';

/**
 * The tool. env: { source(), pixels(), state(), commit(next), makePatch(p, w, h), overlayToSource(x, y),
 * sourceToOverlayMatrix(), slider(opts), renderPanel(), schedule() }.
 */
export function reverseFillTool(env) {
  // The shades picked to remove, the shades of the surface to fill from (optional, with Fill From on),
  // the trace around it (found by itself from `seeds`, the spots picked; or `hand`: a loop drawn), the
  // brushed edits, the match tolerance, and the preview of what matches (cached by what it was made from).
  const newRf = () => ({ shades: [], from: [], fromMode: false, trace: null, tol: 18, preview: null, seeds: [], hand: false, edits: [], brush: null, brushSize: 18 });
  let rf = null; let cleanNote = ''; let cleaning = false;

  /**
   * A Reverse Fill stroke: a tap picks a shade (to remove, or with Fill From on, to fill from); a loop is
   * the trace. Pressing and moving (the magnifier showing what's under the finger) picks where it's let go.
   * Each spot picked to remove is a start for the trace found by itself (autoTrace), unless a loop was drawn.
   */
  function reverseStroke(st) {
    const w = env.source().width; const h = env.source().height;
    const pts = st.pts.map(([x, y]) => env.overlayToSource(x, y));
    const [ax, ay] = env.overlayToSource(st.pts[0][0], st.pts[0][1]); const [bx, by] = env.overlayToSource(st.pts[0][0] + st.r, st.pts[0][1]);
    const r = Math.max(2, Math.hypot(bx - ax, by - ay));
    // 🖌 / 🧽: brushed into, or out of, what goes.
    if (st.brush) {
      const m = strokeMask(pts, r, w, h);
      if (m.box) {
        rf.edits.push({ mask: m.mask, box: m.box, add: st.brush === 'add', r });
        if (st.brush === 'add') { if (rf.hand && rf.trace) widenTrace(m, r); else traceFromSeeds(); }
        cleanNote = st.brush === 'add' ? 'Added to what goes.' : 'Taken out of what goes: it stays.';
      }
      reversePreview(); env.renderPanel(); env.schedule(); return;
    }
    const shape = strokeShape(pts, r);
    const at = shape === 'tap' ? pts[0] : shape !== 'lasso' || !rf.hand ? pts.at(-1) : null;
    if (at) {
      const [x, y] = at;
      if (x < 0 || y < 0 || x >= w || y >= h) { env.schedule(); return; }
      const c = sampleShade(env.pixels(), w, h, x, y, Math.max(2, Math.round(Math.max(w, h) / 500)));
      const list = rf.fromMode ? rf.from : rf.shades;
      const lab = toLab(...c);
      // The same shade twice is one.
      if (!list.some((d) => { const e = toLab(...d); return Math.hypot(e[0] - lab[0], e[1] - lab[1], e[2] - lab[2]) < 4; })) list.push(c);
      if (rf.fromMode) cleanNote = 'Fill from that. Tap more of the surface, or turn Fill From off.';
      else if (rf.hand) cleanNote = rf.trace ? '' : 'Picked. Tap more shades of it, then draw a rough loop around it.';
      else { rf.seeds.push([x, y]); traceFromSeeds(); }
    } else if (shape === 'lasso') {
      const t = strokeMask(pts, 1, w, h);
      if (!t.box) { env.schedule(); return; }
      rf.trace = { pts, mask: t.mask, box: t.box };
      cleanNote = rf.shades.length ? '' : 'Traced. Now tap the colors to remove inside it.';
    } else {
      cleanNote = 'Draw all the way around it (a rough loop), or tap a color.';
    }
    reversePreview(); env.renderPanel(); env.schedule();
  }

  /** The trace found by itself from the spots picked (autoTrace), with its outline to show; a note if it's too much. */
  function traceFromSeeds() {
    if (rf.hand) return;
    const w = env.source().width; const h = env.source().height;
    let t = rf.seeds.length && rf.shades.length ? autoTrace(env.pixels(), w, h, rf.seeds, rf.shades, rf.tol) : null;
    // (And room around what was brushed in, too.)
    for (const e of rf.edits) if (e.add) t = unionTrace(t, roomAround(e.mask, w, h, e.box, Math.round(Math.max(8, e.r * 2))), w);
    if (!t) { rf.trace = null; cleanNote = rf.seeds.length ? 'Nothing of that color there: press right on it (the magnifier shows what you\'re on).' : ''; return; }
    // Its outline, a couple of pixels wide in the photo, to draw over it.
    const { box } = t; const bw = box.x1 - box.x0; const bh = box.y1 - box.y0; const lw = Math.max(1, Math.round(Math.max(w, h) / 500));
    const canvas = document.createElement('canvas'); canvas.width = bw; canvas.height = bh;
    const c2 = canvas.getContext('2d'); const img = c2.createImageData(bw, bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = (box.y0 + y) * w + box.x0 + x; if (!t.mask[i]) continue;
      let edge = false;
      for (let d = 1; d <= lw && !edge; d++) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) { const X = box.x0 + x + dx; const Y = box.y0 + y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h || !t.mask[Y * w + X]) { edge = true; break; } }
      if (edge) img.data.set([255, 214, 10, 255], (y * bw + x) * 4);
    }
    c2.putImageData(img, 0, 0);
    rf.trace = { mask: t.mask, box, canvas, share: t.share ?? 0 };
    cleanNote = t.share > 0.35 ? 'That color covers much of the photo: lower Match, or ✏️ draw a loop around just the part to remove.' : '';
  }

  /** Two traces ({ mask, box } over the photo, or null) as one. */
  function unionTrace(a, b, w) {
    if (!a) return b; if (!b) return a;
    const mask = Uint8Array.from(a.mask); const bb = b.box;
    for (let y = bb.y0; y < bb.y1; y++) for (let x = bb.x0; x < bb.x1; x++) if (b.mask[y * w + x]) mask[y * w + x] = 1;
    return { ...a, mask, box: { x0: Math.min(a.box.x0, bb.x0), y0: Math.min(a.box.y0, bb.y0), x1: Math.max(a.box.x1, bb.x1), y1: Math.max(a.box.y1, bb.y1) } };
  }
  /** A loop drawn by hand, widened to take in a brushed-in area (with room around it). */
  function widenTrace(m, r) {
    const w = env.source().width; const h = env.source().height;
    const u = unionTrace(rf.trace, roomAround(m.mask, w, h, m.box, Math.round(Math.max(8, r * 2))), w);
    rf.trace = { ...rf.trace, mask: u.mask, box: u.box };
  }

  /** What Reverse Fill will remove with the shades, trace and tolerance as they are (cached). */
  function reversePreview() {
    if (!rf?.trace || !(rf.shades.length || rf.edits.some((e) => e.add))) { if (rf) rf.preview = null; return null; }
    const key = `${rf.shades.join('|')}#${rf.tol}#${rf.edits.length}`;
    if (rf.preview?.key === key && rf.preview.trace === rf.trace && rf.preview.patches === env.state().patches) return rf.preview;
    const w = env.source().width; const h = env.source().height;
    // (In FM, a few pixels of rim too: a soft-edged thing's blur into what's around it, so none of it is left as a halo.)
    const m = shadeMask(env.pixels(), w, h, rf.trace.mask, rf.trace.box, rf.shades, rf.tol, { edge: Math.max(2, Math.round(Math.max(w, h) / 350)) });
    // Then what was brushed in or out, in the order it was.
    if (rf.edits?.length) {
      for (const e of rf.edits) for (let y = e.box.y0; y < e.box.y1; y++) for (let x = e.box.x0; x < e.box.x1; x++) {
        const i = y * w + x; if (!e.mask[i]) continue;
        if (e.add) { if (rf.trace.mask[i]) m.mask[i] = 1; } else m.mask[i] = 0;
      }
      let x0 = w; let y0 = h; let x1 = 0; let y1 = 0; let count = 0; const tb2 = rf.trace.box;
      for (let y = tb2.y0; y < tb2.y1; y++) for (let x = tb2.x0; x < tb2.x1; x++) if (m.mask[y * w + x]) { count++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x >= x1) x1 = x + 1; if (y >= y1) y1 = y + 1; }
      m.count = count; m.box = count ? { x0, y0, x1, y1 } : null;
    }
    let inTrace = 0; const tb = rf.trace.box;
    for (let y = tb.y0; y < tb.y1; y++) for (let x = tb.x0; x < tb.x1; x++) inTrace += rf.trace.mask[y * w + x];
    let canvas = null;
    if (m.box) {
      const bw = m.box.x1 - m.box.x0; const bh = m.box.y1 - m.box.y0;
      canvas = document.createElement('canvas'); canvas.width = bw; canvas.height = bh;
      const c2 = canvas.getContext('2d'); const img = c2.createImageData(bw, bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (m.mask[(m.box.y0 + y) * w + m.box.x0 + x]) img.data.set([255, 45, 149, 150], (y * bw + x) * 4);
      c2.putImageData(img, 0, 0);
    }
    rf.preview = { key, trace: rf.trace, patches: env.state().patches, ...m, share: inTrace ? m.count / inTrace : 0, canvas };
    return rf.preview;
  }

  function drawReverseUi(ctx, dpr) {
    const T = env.sourceToOverlayMatrix(); if (!T) return;
    const pv = reversePreview();
    ctx.save();
    ctx.setTransform(...T);
    if (pv?.canvas) { ctx.imageSmoothingEnabled = false; ctx.drawImage(pv.canvas, pv.box.x0, pv.box.y0); }
    // The trace found by itself: its outline.
    if (rf.trace?.canvas) { ctx.imageSmoothingEnabled = false; ctx.drawImage(rf.trace.canvas, rf.trace.box.x0, rf.trace.box.y0); }
    ctx.restore();
    if (rf.trace?.pts) {
      ctx.save();
      ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#ff2d95'; ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath();
      rf.trace.pts.forEach(([x, y], i) => { const px = T[0] * x + T[2] * y + T[4]; const py = T[1] * x + T[3] * y + T[5]; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.closePath(); ctx.stroke(); ctx.restore();
    }
  }

  /** ✨ Remove & fill: the matched shades taken out of the trace, filled from the surface left around them. */
  function runReverseFill() {
    const pv = reversePreview();
    if (!pv?.box) { cleanNote = 'Nothing in the trace matches those colors: tap them inside it, or raise Match.'; env.renderPanel(); return; }
    const w = env.source().width; const h = env.source().height; const { trace, from } = rf;
    cleaning = true; cleanNote = 'Removing and filling…'; env.renderPanel(); env.schedule();
    setTimeout(() => {
      try {
        const p = reverseFill(env.pixels(), w, h, pv.mask, pv.box, trace.mask, { from });
        if (!p) { cleanNote = ''; return; }
        const s = env.state();
        cleanNote = p.wide ? 'Removed. Little of the surface was left in the trace, so it was filled from around it: trace a bit wider for a better fill.' : `Removed and filled from the surface around it${p.wider ? ' (some from just past your loop: little of it was inside)' : ''}. Undo takes it back.`;
        rf = { ...newRf(), tol: rf.tol, hand: rf.hand };
        env.commit({ ...s, patches: [...(s.patches ?? []), env.makePatch(p, w, h)] });
      } finally { cleaning = false; env.renderPanel(); env.schedule(); }
    }, 30);
  }

  /** FM's Reverse Fill: pick the color with the magnifier, the area found and outlined by itself, filled from what's around it. */
  function rfillPanel() {
    rf ??= newRf();
    const swatch = (c, list, label) => el('button', {
      type: 'button', class: 'chip ed-shade', 'aria-label': `Remove ${label} ${c.join(', ')}`,
      onclick: () => { list.splice(list.indexOf(c), 1); if (list === rf.shades && !rf.shades.length) rf.seeds = []; traceFromSeeds(); reversePreview(); env.renderPanel(); env.schedule(); },
    }, el('span', { class: 'ed-shade-dot', style: { background: `rgb(${c.join(',')})` } }), el('span', { text: '✕' }));
    const tol = env.slider({
      min: 4, max: 45, value: rf.tol, label: 'Match',
      onInput: (v) => { rf.tol = v; reversePreview(); env.schedule(); },
      onChange: () => { traceFromSeeds(); reversePreview(); env.renderPanel(); env.schedule(); },
    });
    const pv = rf.preview;
    const ready = (rf.shades.length || rf.edits.some((e) => e.add)) && rf.trace;
    const status = !rf.shades.length && !rf.edits.length
      ? (rf.hand ? 'Tap the colors to remove, and draw a rough loop around the area.' : 'Press on the color to remove: the magnifier shows just what\'s under your finger; let go to pick it. The area of that color is found and outlined (yellow) by itself.')
      : !rf.trace ? (rf.hand ? 'Now draw a rough loop around the area to remove them from.' : 'Press right on the color (the magnifier shows what you\'re on).')
        : pv?.box ? `Pink shows what goes: ${Math.round(pv.share * 100)}% of the outlined area. Pick more shades of it (in shadow, its edge), or the same color elsewhere (each place is found and outlined too), or adjust Match; 🖌 / 🧽 brush more in or out.` : 'Nothing matches yet: pick the color again, or raise Match.';
    return [
      el('p', { class: 'small muted ed-clean-hint', text: 'Reverse Fill: removes a color (a label, a sticker, a logo, a stain) and fills in with the surface around it, its color, light and texture — not what\'s behind.' }),
      el('div', { class: 'ed-row' }, el('strong', { class: 'small', text: 'Remove' }),
        el('div', { class: 'chips ed-shades' }, ...rf.shades.map((c) => swatch(c, rf.shades, 'shade')), rf.shades.length ? null : el('span', { class: 'muted small', text: 'press on a color in the photo' }))),
      el('div', { class: 'ed-row' }, el('strong', { class: 'small', text: 'Match' }), el('span', { class: 'muted small', text: 'How close a shade counts.' })),
      tol,
      el('div', { class: 'chips' },
        el('button', { type: 'button', class: `chip${rf.fromMode ? ' active' : ''}`, 'aria-pressed': String(rf.fromMode), text: '🎯 Fill From', onclick: () => { rf.fromMode = !rf.fromMode; cleanNote = rf.fromMode ? 'Pick the surface to fill with (the can under the label).' : ''; env.renderPanel(); } }),
        ...rf.from.map((c) => swatch(c, rf.from, 'fill-from shade')),
        el('button', { type: 'button', class: `chip${rf.brush === 'add' ? ' active' : ''}`, 'aria-pressed': String(rf.brush === 'add'), text: '🖌 Add to it', onclick: () => { rf.brush = rf.brush === 'add' ? null : 'add'; cleanNote = rf.brush ? 'Brush over more that should go.' : ''; env.renderPanel(); } }),
        el('button', { type: 'button', class: `chip${rf.brush === 'del' ? ' active' : ''}`, 'aria-pressed': String(rf.brush === 'del'), text: '🧽 Take away', onclick: () => { rf.brush = rf.brush === 'del' ? null : 'del'; cleanNote = rf.brush ? 'Brush over what should stay.' : ''; env.renderPanel(); } }),
        el('button', { type: 'button', class: `chip${rf.hand ? ' active' : ''}`, 'aria-pressed': String(rf.hand), text: '✏️ Draw my own loop',
          onclick: () => { rf.hand = !rf.hand; rf.trace = null; if (!rf.hand) traceFromSeeds(); reversePreview(); cleanNote = rf.hand ? 'Draw a rough loop around the area.' : ''; env.renderPanel(); env.schedule(); } }),
        rf.shades.length || rf.trace || rf.from.length ? el('button', { type: 'button', class: 'chip', text: 'Clear', onclick: () => { rf = { ...newRf(), tol: rf.tol }; cleanNote = ''; env.renderPanel(); env.schedule(); } }) : null),
      rf.brush ? el('div', { class: 'ed-row' }, el('strong', { class: 'small', text: 'Brush size' })) : null,
      rf.brush ? env.slider({ min: 4, max: 60, value: rf.brushSize, label: 'Reverse Fill brush size', onInput: (v) => { rf.brushSize = v; }, onChange: () => {} }) : null,
      el('p', { class: 'small', 'aria-live': 'polite', text: status }),
      cleanNote ? el('p', { class: `small ${cleaning ? 'muted' : 'ok-text'}`, 'aria-live': 'polite', text: cleanNote }) : null,
      el('button', { type: 'button', class: 'btn primary', text: '✨ Remove & fill', disabled: !ready || cleaning || !pv?.box, onclick: runReverseFill }),
    ].filter(Boolean);
  }

  return {
    /** Whether it's on (its tab is open). */
    get on() { return !!rf; },
    /** Removing and filling just now (a stroke waits). */
    get busy() { return cleaning; },
    start() { rf ??= newRf(); },
    stop() { rf = null; cleanNote = ''; },
    /** The stroke a finger down at `pt` (overlay px; `k` overlay px per screen px) starts: a brush, a loop, or aiming the magnifier. */
    strokeAt(pt, k) { return rf.brush ? { pts: [pt], r: rf.brushSize * k, brush: rf.brush } : { pts: [pt], r: 10 * k, thin: true, aim: !rf.hand }; },
    stroke: reverseStroke,
    draw: drawReverseUi,
    panel: rfillPanel,
  };
}
