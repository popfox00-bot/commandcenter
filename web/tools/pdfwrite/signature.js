// Saved signature and initials: drawn once on a pad, stored on this device only (localStorage),
// then stamped onto pages as a single 'sign' annotation (strokes of points).
import { el, store } from '../../lib/dom.js';
import { displaySize } from './annotate.js';

const KEY = 'cc.pdf.signatures';
export const KINDS = { signature: { label: 'Signature', height: 34 }, initials: { label: 'Initials', height: 22 } };

export function loadSignature(kind) {
  return store.json(KEY, {})[kind] ?? null;
}

function saveSignature(kind, sig) {
  const all = store.json(KEY, {});
  if (sig) all[kind] = sig; else delete all[kind];
  store.set(KEY, JSON.stringify(all));
}

/**
 * Normalize pad strokes (css px) into a unit box: points 0..1 within the drawing's bounding box,
 * plus its aspect ratio and the stroke width relative to its height. Returns null if empty.
 */
export function normalizeStrokes(strokes, lineWidthPx) {
  const pts = strokes.flat();
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs); const minY = Math.min(...ys);
  const w = Math.max(1, Math.max(...xs) - minX); const h = Math.max(1, Math.max(...ys) - minY);
  return {
    aspect: w / h,
    width: lineWidthPx / h,
    strokes: strokes.map((s) => s.map(([x, y]) => [Math.round(((x - minX) / w) * 1e4) / 1e4, Math.round(((y - minY) / h) * 1e4) / 1e4])),
  };
}

/** A 'sign' annotation for `sig`, centered at display point (u,v), `heightPt` tall. */
export function signItem(sig, page, info, u, v, heightPt, color) {
  const { w, h } = displaySize(info);
  const hu = heightPt / h; const wu = (heightPt * sig.aspect) / w;
  const u0 = u - wu / 2; const v0 = v - hu / 2;
  return {
    page, type: 'sign', color,
    width: Math.min(3, Math.max(0.6, sig.width * heightPt)),
    strokes: sig.strokes.map((s) => s.map(([x, y]) => [u0 + x * wu, v0 + y * hu])),
  };
}

/** Opens the drawing pad. Resolves with the saved signature, or null if cancelled/cleared. */
export function drawSignature(kind) {
  return new Promise((resolve) => {
    const canvas = el('canvas', { class: 'sig-pad', 'aria-label': `Draw your ${KINDS[kind].label.toLowerCase()}` });
    const strokes = [];
    let current = null;
    const LINE = 3;
    const ctx = canvas.getContext('2d');
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#111'; ctx.lineWidth = LINE; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const s of strokes) {
        ctx.beginPath(); ctx.moveTo(...s[0]);
        if (s.length === 1) ctx.lineTo(s[0][0] + 0.01, s[0][1]);
        for (const p of s.slice(1)) ctx.lineTo(...p);
        ctx.stroke();
      }
    };
    const at = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', (e) => { current = [at(e)]; strokes.push(current); canvas.setPointerCapture(e.pointerId); redraw(); e.preventDefault(); });
    canvas.addEventListener('pointermove', (e) => { if (!current) return; current.push(at(e)); redraw(); });
    const up = () => { current = null; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    const existing = loadSignature(kind);
    const dlg = el('dialog', { class: 'ed-dialog' }, el('form', { method: 'dialog', class: 'sheet' },
      el('h2', { text: `Your ${KINDS[kind].label.toLowerCase()}` }),
      el('p', { class: 'muted small', text: 'Sign with your finger. It is saved on this phone only, so you can stamp it on any PDF.' }),
      canvas,
      el('div', { class: 'row space' },
        el('button', { type: 'button', class: 'btn ghost', text: 'Clear', onclick: () => { strokes.length = 0; redraw(); } }),
        el('div', { class: 'row' },
          existing ? el('button', { class: 'btn ghost', value: 'forget', text: 'Forget saved' }) : null,
          el('button', { class: 'btn ghost', value: 'cancel', text: 'Cancel' }),
          el('button', { class: 'btn primary', value: 'save', text: 'Save' })))));
    dlg.addEventListener('close', () => {
      let result = existing;
      if (dlg.returnValue === 'save') {
        const sig = normalizeStrokes(strokes, LINE);
        if (sig) { saveSignature(kind, sig); result = sig; }
      } else if (dlg.returnValue === 'forget') { saveSignature(kind, null); result = null; }
      else result = null;
      dlg.remove();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    requestAnimationFrame(resize);
  });
}
