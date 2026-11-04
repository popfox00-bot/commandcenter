// Zoom within a photo (not the page): two fingers pinch to zoom in and out and drag to pan, while
// one finger keeps drawing, tracing or fixing as before. On a computer, Ctrl/⌘ + scroll (or a
// trackpad pinch) zooms at the pointer. A "⤢ Fit" button appears while zoomed in.
//
// zoomable(stage, layer, opts): `stage` is the frame (overflow hidden), `layer` what's zoomed inside
// it (the canvases). The layer is scaled with a CSS transform, so code that maps a pointer through
// the canvas's getBoundingClientRect() keeps working at any zoom. opts:
//   enabled()  - false while two fingers mean something else (pinching a layer being placed)
//   onGesture() - a pinch began: drop whatever stroke the first finger started
//   onChange(view) - the zoom changed ({ z, tx, ty }): e.g. draw at more detail
//   max        - the most it zooms in (default 8×)

import { el } from './dom.js';

/** The view after a pinch: scale z (1..max) and translation t (px), keeping the content under the fingers there. */
export function pinchView({ z0, tx0, ty0, mid0, mid, d0, d, max = 8, w, h }) {
  const z = Math.min(max, Math.max(1, (z0 * d) / d0));
  // The layer point under the fingers at the start stays under them.
  const qx = (mid0[0] - tx0) / z0; const qy = (mid0[1] - ty0) / z0;
  return clampView({ z, tx: mid[0] - qx * z, ty: mid[1] - qy * z, w, h });
}

/** Kept so the zoomed layer always fills its own box (no empty edge showing), and 1× is centered. */
export function clampView({ z, tx, ty, w, h }) {
  return { z, tx: Math.min(0, Math.max(w * (1 - z), tx)), ty: Math.min(0, Math.max(h * (1 - z), ty)) };
}

export function zoomable(stage, layer, { enabled = () => true, onGesture = () => {}, onChange = () => {}, max = 8 } = {}) {
  let view = { z: 1, tx: 0, ty: 0 };
  const pointers = new Map(); // id -> [x, y] in the layer's own (unzoomed) box
  let pinch = null; const swallow = new Set(); // pointers whose events the page mustn't see (a pinch's)
  layer.style.transformOrigin = '0 0';
  const fit = el('button', { type: 'button', class: 'zoom-fit', 'aria-label': 'Fit photo', text: '⤢ Fit', hidden: true, onclick: () => set({ z: 1, tx: 0, ty: 0 }) });
  stage.append(fit);

  /** A client point in the layer's own box (its place at 1×, before the zoom). */
  const local = (e) => {
    const r = layer.getBoundingClientRect(); // includes the transform
    return [(e.clientX - r.left) + view.tx, (e.clientY - r.top) + view.ty];
  };
  const size = () => ({ w: layer.offsetWidth, h: layer.offsetHeight });
  function set(v) {
    view = clampView({ ...v, ...size() });
    if (view.z < 1.01) view = { z: 1, tx: 0, ty: 0 };
    layer.style.transform = view.z === 1 ? '' : `translate(${view.tx}px, ${view.ty}px) scale(${view.z})`;
    fit.hidden = view.z === 1;
    stage.classList.toggle('zoomed', view.z > 1);
    onChange(view);
  }

  const opts = { capture: true };
  stage.addEventListener('pointerdown', (e) => {
    if (e.target === fit) return;
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 2 && enabled()) {
      const [a, b] = [...pointers.values()];
      pinch = { z0: view.z, tx0: view.tx, ty0: view.ty, mid0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d0: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1 };
      for (const id of pointers.keys()) swallow.add(id);
      onGesture();
      e.stopPropagation(); e.preventDefault();
    } else if (pinch) { swallow.add(e.pointerId); e.stopPropagation(); }
  }, opts);
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (!swallow.has(e.pointerId)) return;
    e.stopPropagation(); e.preventDefault();
    if (!pinch || pointers.size < 2) return;
    // Both fingers in the frame's own pixels (as at the start): zoom by their spread, pan by their middle.
    const [a, b] = [...pointers.values()];
    set(pinchView({ ...pinch, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d: Math.hypot(b[0] - a[0], b[1] - a[1]), max, ...size() }));
  }, opts);
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (!swallow.has(e.pointerId)) return;
    // A finger of a pinch: the page never sees it, even the one left down after the other lifts.
    e.stopPropagation();
    swallow.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  stage.addEventListener('pointerup', up, opts);
  stage.addEventListener('pointercancel', up, opts);
  // Ctrl/⌘ + wheel, or a trackpad pinch (which comes as wheel with ctrlKey): zoom at the pointer.
  stage.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !enabled()) return;
    e.preventDefault();
    const p = local(e);
    const z = Math.min(max, Math.max(1, view.z * Math.exp(-e.deltaY * 0.01)));
    const qx = (p[0] - view.tx) / view.z; const qy = (p[1] - view.ty) / view.z;
    set({ z, tx: p[0] - qx * z, ty: p[1] - qy * z });
  }, { passive: false });
  return { reset: () => set({ z: 1, tx: 0, ty: 0 }), get view() { return { ...view }; }, set };
}
