// Socials' photo editor: a photo being posted (or a profile picture) fitted to how it's shown, then filtered
// and adjusted, before it's kept. Built from the Photo Editor's own engine (its renderer, filters and
// adjustments: web/tools/editor/), but nothing of it is saved there: no recent edits, no work in progress.
// What's made here is only the photo handed back to Socials.
//
//   Fit:     the shape it's shown in (a post: Original, Square, 4:5 portrait, 1.91:1 landscape; a profile
//            picture: a circle), then drag to move it and pinch or slide to zoom; ↻ turns it.
//   Filter:  the Photo Editor's filters, each previewed on the photo, with how strong.
//   Edit:    its adjustments (Brightness, Contrast, Saturation, Warmth, ...), each a slider.

import { el } from '../../lib/dom.js';
import { sniffType, decodeImage, fitSize, drawToCanvas, canvasToBlob } from '../../lib/image.js';
import { Renderer } from '../../tools/editor/renderer.js';
import { defaultState, ADJUSTMENTS, FILTERS } from '../../tools/editor/state.js';
import { orientedSize, outputPixelSize, cropForRatio } from '../../tools/editor/geometry.js';

/** The shapes a post can take (w/h; null: as the photo is). */
export const POST_SHAPES = [['Original', null], ['Square', 1], ['Portrait', 4 / 5], ['Landscape', 1.91]];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The crop for a shape (`ratio`), zoomed in `zoom` times (1: the largest that fits) and moved to `px`, `py`
 * (0..1: from one side to the other) inside a W×H photo, in the editor's 0..1 crop units.
 */
export function fitCrop(ratio, zoom, px, py, W, H) {
  const base = cropForRatio(ratio, W, H);
  const w = base.w / zoom; const h = base.h / zoom;
  return { x: clamp(px, 0, 1) * (1 - w), y: clamp(py, 0, 1) * (1 - h), w, h };
}

/**
 * Edit a photo (a File or Blob): `avatar` for a profile picture (square, shown round). Resolves to the
 * finished JPEG (a Blob), or null if cancelled. Throws if the photo can't be opened or this browser has no
 * WebGL 2 (the caller then keeps it as it is).
 */
export async function editPhoto(file, { avatar = false, maxEdge = avatar ? 480 : 1440, title = avatar ? 'Profile photo' : 'Edit photo' } = {}) {
  const bmp = await decodeImage(file, await sniffType(file));
  const preview = el('canvas', { class: 'se-canvas', 'aria-label': 'Your photo: drag to move it, pinch to zoom' });
  let r;
  try {
    r = new Renderer(preview);
    const f = fitSize(bmp.width, bmp.height, Math.min(r.maxTexture, 3000));
    r.setSource(f.scale < 1 ? drawToCanvas(bmp, f.width, f.height, null) : bmp);
  } catch (e) { bmp.close?.(); r?.destroy(); throw e; }
  bmp.close?.();

  const st = defaultState();
  let shape = avatar ? 1 : null; let zoom = 1; let px = 0.5; let py = 0.5;
  let tab = 'fit'; let adj = 'brightness';
  const apply = () => { const { W, H } = orientedSize(r.srcW, r.srcH, st.rotate); st.crop = fitCrop(shape, zoom, px, py, W, H); };

  return new Promise((resolve) => {
    const frame = el('div', { class: `se-frame${avatar ? ' se-round' : ''}` }, preview);
    const panel = el('div', { class: 'se-panel' });
    const tabs = el('div', { class: 'se-tabs', role: 'tablist' });
    const finish = async (keep) => {
      if (!keep) { close(); resolve(null); return; }
      done.disabled = true; done.textContent = '…';
      try {
        apply();
        const full = outputPixelSize(st, r.srcW, r.srcH); const out = fitSize(full.width, full.height, maxEdge);
        r.render(st, out.width, out.height);
        // (Copied to a 2D canvas: a WebGL canvas can't always be encoded directly.)
        const c = document.createElement('canvas'); c.width = out.width; c.height = out.height;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(r.canvas, 0, 0);
        const blob = await canvasToBlob(c, 'image/jpeg', 0.9);
        close(); resolve(blob);
      } catch { close(); resolve(null); }
    };
    const done = el('button', { type: 'button', class: 'se-done', text: 'Done', onclick: () => finish(true) });
    const sheet = el('div', { class: 'se', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'se-bar' }, el('button', { type: 'button', class: 'se-cancel', text: 'Cancel', onclick: () => finish(false) }), el('strong', { text: title }), done),
      el('div', { class: 'se-stage' }, frame), tabs, panel);
    const close = () => { sheet.remove(); document.body.classList.remove('se-open'); r.destroy(); };

    // The preview: the crop rendered at the size it's shown (sharp on the phone's screen).
    function draw() {
      apply();
      const full = outputPixelSize(st, r.srcW, r.srcH);
      const box = frame.parentElement?.getBoundingClientRect(); const maxW = Math.max(200, (box?.width || 360) - 24); const maxH = Math.max(200, (box?.height || 420) - 24);
      const k = Math.min(maxW / full.width, maxH / full.height); const cw = Math.round(full.width * k); const ch = Math.round(full.height * k);
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      r.render(st, Math.max(1, Math.round(cw * dpr)), Math.max(1, Math.round(ch * dpr)));
      preview.style.width = `${cw}px`; preview.style.height = `${ch}px`;
    }

    // Moving it (drag) and zooming (pinch, or the slider).
    const pts = new Map(); let start = null;
    preview.addEventListener('pointerdown', (e) => { preview.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); start = { zoom, px, py, pts: new Map(pts) }; });
    preview.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !start) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
      const rect = preview.getBoundingClientRect();
      if (pts.size >= 2 && start.pts.size >= 2) {
        const [a, b] = [...pts.values()]; const [a0, b0] = [...start.pts.values()];
        zoom = clamp(start.zoom * (Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, Math.hypot(a0[0] - b0[0], a0[1] - b0[1]))), 1, 5);
      } else {
        const p0 = start.pts.get(e.pointerId); if (!p0) return;
        const c = st.crop; const dx = (e.clientX - p0[0]) / rect.width * c.w; const dy = (e.clientY - p0[1]) / rect.height * c.h;
        px = 1 - c.w > 1e-4 ? clamp(start.px - dx / (1 - c.w), 0, 1) : 0.5; py = 1 - c.h > 1e-4 ? clamp(start.py - dy / (1 - c.h), 0, 1) : 0.5;
      }
      draw(); if (tab === 'fit') zoomIn.value = String(zoom);
    });
    const up = (e) => { pts.delete(e.pointerId); start = pts.size ? { zoom, px, py, pts: new Map(pts) } : null; };
    preview.addEventListener('pointerup', up); preview.addEventListener('pointercancel', up);
    const zoomIn = el('input', { type: 'range', min: '1', max: '5', step: '0.01', value: '1', 'aria-label': 'Zoom', class: 'se-range' });
    zoomIn.addEventListener('input', () => { zoom = Number(zoomIn.value); draw(); });

    // Filter previews: each filter on a small version of the photo, made once.
    let thumbs = null;
    const makeThumbs = () => {
      if (thumbs) return thumbs;
      const { W, H } = orientedSize(r.srcW, r.srcH, st.rotate); const sq = { ...st, crop: cropForRatio(1, W, H), adjust: defaultState().adjust };
      thumbs = new Map();
      for (const f of FILTERS) {
        r.render({ ...sq, filter: f.id, filterIntensity: 1 }, 96, 96);
        const c = el('canvas', { class: 'se-thumb', width: '96', height: '96' }); c.getContext('2d').drawImage(r.canvas, 0, 0); thumbs.set(f.id, c);
      }
      draw(); return thumbs;
    };

    function drawPanel() {
      tabs.replaceChildren(...[['fit', avatar ? 'Fit' : 'Fit'], ['filter', 'Filter'], ['edit', 'Edit']].map(([id, label]) => el('button', { type: 'button', role: 'tab', class: `se-tab${tab === id ? ' on' : ''}`, 'aria-selected': String(tab === id), text: label, onclick: () => { tab = id; drawPanel(); } })));
      if (tab === 'fit') {
        panel.replaceChildren(
          avatar ? el('p', { class: 'se-hint', text: 'Drag to move it in the circle; pinch or slide to zoom.' })
            : el('div', { class: 'se-chips', role: 'group', 'aria-label': 'Shape' }, POST_SHAPES.map(([label, ratio]) => el('button', { type: 'button', class: `se-chip${shape === ratio ? ' on' : ''}`, 'aria-pressed': String(shape === ratio), text: label, onclick: () => { shape = ratio; zoom = 1; px = py = 0.5; zoomIn.value = '1'; draw(); drawPanel(); } }))),
          el('div', { class: 'se-row' }, el('span', { class: 'se-label', text: 'Zoom' }), zoomIn,
            el('button', { type: 'button', class: 'se-icon', 'aria-label': 'Turn', text: '↻', onclick: () => { st.rotate = (st.rotate + 1) % 4; zoom = 1; px = py = 0.5; zoomIn.value = '1'; thumbs = null; draw(); } })));
      } else if (tab === 'filter') {
        const t = makeThumbs();
        const strength = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(st.filterIntensity * 100)), 'aria-label': 'Filter strength', class: 'se-range' });
        strength.addEventListener('input', () => { st.filterIntensity = Number(strength.value) / 100; draw(); });
        panel.replaceChildren(
          el('div', { class: 'se-filters', role: 'group', 'aria-label': 'Filters' }, FILTERS.map((f) => el('button', { type: 'button', class: `se-filter${st.filter === f.id ? ' on' : ''}`, 'aria-pressed': String(st.filter === f.id), onclick: () => { st.filter = f.id; if (f.id !== 'original' && !st.filterIntensity) st.filterIntensity = 1; draw(); drawPanel(); } }, t.get(f.id), el('span', { text: f.label })))),
          st.filter !== 'original' ? el('div', { class: 'se-row' }, el('span', { class: 'se-label', text: 'Strength' }), strength) : null);
      } else {
        const a = ADJUSTMENTS.find((x) => x.id === adj) ?? ADJUSTMENTS[0];
        const s = el('input', { type: 'range', min: a.min === 0 ? '0' : '-100', max: '100', value: String(Math.round(st.adjust[a.id] * 100)), 'aria-label': a.label, class: 'se-range' });
        const val = el('span', { class: 'se-val', text: String(Math.round(st.adjust[a.id] * 100)) });
        s.addEventListener('input', () => { st.adjust[a.id] = Number(s.value) / 100; val.textContent = s.value; draw(); });
        panel.replaceChildren(
          el('div', { class: 'se-chips se-adjusts', role: 'group', 'aria-label': 'Adjustments' }, ADJUSTMENTS.map((x) => el('button', { type: 'button', class: `se-chip${x.id === adj ? ' on' : ''}${st.adjust[x.id] ? ' set' : ''}`, 'aria-pressed': String(x.id === adj), onclick: () => { adj = x.id; drawPanel(); } }, el('span', { 'aria-hidden': 'true', text: `${x.icon} ` }), x.label))),
          el('div', { class: 'se-row' }, el('span', { class: 'se-label', text: a.label }), s, val,
            el('button', { type: 'button', class: 'se-icon', 'aria-label': `Reset ${a.label}`, text: '⟲', onclick: () => { st.adjust[a.id] = 0; draw(); drawPanel(); } })));
      }
    }

    document.body.append(sheet); document.body.classList.add('se-open');
    drawPanel(); requestAnimationFrame(draw);
    const onResize = () => { if (sheet.isConnected) draw(); else globalThis.removeEventListener('resize', onResize); };
    globalThis.addEventListener('resize', onResize);
  });
}

/**
 * A video picked to post: checked that it plays here, and a still from it (a JPEG, for its tile and its
 * poster). Resolves to { video: the file as it is (with its sound), still: Blob, seconds } or throws.
 */
export async function prepareVideo(file) {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = () => bad(new Error('This video can\'t be played on this device.')); setTimeout(() => bad(new Error('This video took too long to open.')), 20000); });
    const seconds = Number.isFinite(v.duration) ? v.duration : 0;
    // (A frame a little way in: the very first is often black.)
    if (seconds > 0.6) await new Promise((ok) => { v.onseeked = ok; v.currentTime = Math.min(0.5, seconds / 3); setTimeout(ok, 3000); });
    const f = fitSize(v.videoWidth || 720, v.videoHeight || 1280, 720);
    const c = document.createElement('canvas'); c.width = f.width; c.height = f.height;
    c.getContext('2d').drawImage(v, 0, 0, f.width, f.height);
    return { video: file, still: await canvasToBlob(c, 'image/jpeg', 0.85), seconds };
  } finally { URL.revokeObjectURL(url); }
}
