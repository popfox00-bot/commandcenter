// Socials' photo editor: a photo being posted (or a profile picture) fitted to how it's shown, then filtered
// and adjusted, before it's kept. Built from the Photo Editor's own engine (its renderer, filters and
// adjustments: web/tools/editor/), but nothing of it is saved there: no recent edits, no work in progress.
// What's made here is only the photo handed back to Socials.
//
//   Fit:     the whole photo with the frame of what's kept on it (the rest dimmed): the shape (a post:
//            Original, Square, 4:5, 3:4, 9:16, 16:9, 4:3, 1.91:1 or a custom W:H; a profile picture: a
//            circle); drag to move the frame over the photo, pinch or slide to zoom it; ↻ turns it.
//   Filter:  the Photo Editor's filters, each previewed on the photo, with how strong.
//   Edit:    its adjustments (Brightness, Contrast, Saturation, Warmth, ...), each a slider.

import { el, fill } from '../../lib/dom.js';
import { sniffType, decodeImage, fitSize, drawToCanvas, canvasToBlob } from '../../lib/image.js';
import { Renderer } from '../../tools/editor/renderer.js';
import { defaultState, ADJUSTMENTS, FILTERS } from '../../tools/editor/state.js';
import { orientedSize, outputPixelSize, cropForRatio } from '../../tools/editor/geometry.js';

/** The shapes a post can take (w/h; null: as the photo is). */
export const POST_SHAPES = [['Original', null], ['Square', 1], ['Portrait 4:5', 4 / 5], ['3:4', 3 / 4], ['Story 9:16', 9 / 16], ['Landscape 1.91:1', 1.91], ['16:9', 16 / 9], ['4:3', 4 / 3]];
/** A custom shape's ratio from its width and height (each 1–100), or null if they aren't numbers. */
export const customRatio = (w, h) => { const a = Number(w); const b = Number(h); return a > 0 && b > 0 && a <= 100 && b <= 100 ? a / b : null; };

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

/** A crop frame (0..1 units of a W×H picture) as a shape, zoom and place (fitCrop's terms): { ratio, zoom, px, py }. */
export function fitFromRect(c, W, H) {
  const ratio = (c.w * W) / (c.h * H); const base = cropForRatio(ratio, W, H);
  return { ratio, zoom: Math.max(1, base.w / c.w), px: c.w < 1 - 1e-4 ? clamp(c.x / (1 - c.w), 0, 1) : 0.5, py: c.h < 1 - 1e-4 ? clamp(c.y / (1 - c.h), 0, 1) : 0.5 };
}

/**
 * A crop frame made bigger or smaller by one of its corners ('nw', 'ne', 'sw', 'se') dragged `dx`, `dy` (0..1
 * of the picture): the opposite corner stays, it stays inside the picture, and never under `min` across.
 */
export function resizeCrop(c, corner, dx, dy, min = 0.08) {
  let x0 = c.x; let y0 = c.y; let x1 = c.x + c.w; let y1 = c.y + c.h;
  if (corner.includes('w')) x0 = clamp(x0 + dx, 0, x1 - min); else x1 = clamp(x1 + dx, x0 + min, 1);
  if (corner.includes('n')) y0 = clamp(y0 + dy, 0, y1 - min); else y1 = clamp(y1 + dy, y0 + min, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The four corner handles of a crop frame (drag one to make it any size). */
export const cropHandles = () => ['nw', 'ne', 'sw', 'se'].map((k) => el('span', { class: `se-handle se-h-${k}`, 'data-corner': k, 'aria-hidden': 'true' }));

/**
 * Edit a photo (a File or Blob): `avatar` for a profile picture (square, shown round). Resolves to the
 * finished JPEG (a Blob), or null if cancelled. Throws if the photo can't be opened or this browser has no
 * WebGL 2 (the caller then keeps it as it is).
 */
export async function editPhoto(file, { avatar = false, maxEdge = avatar ? 480 : 1440, title = avatar ? 'Profile photo' : 'Edit photo' } = {}) {
  const bmp = await decodeImage(file, await sniffType(file));
  const preview = el('canvas', { class: 'se-canvas', 'aria-label': 'Your photo' });
  // (On Fit: the frame of what's kept, over the whole photo; drag it, pinch to zoom.)
  const cropBox = el('div', { class: 'se-cropbox', 'aria-label': 'What\'s kept: drag to move, pinch to zoom, drag a corner to resize' }, avatar ? null : cropHandles());
  let r;
  try {
    r = new Renderer(preview);
    const f = fitSize(bmp.width, bmp.height, Math.min(r.maxTexture, 3000));
    r.setSource(f.scale < 1 ? drawToCanvas(bmp, f.width, f.height, null) : bmp);
  } catch (e) { bmp.close?.(); r?.destroy(); throw e; }
  bmp.close?.();

  const st = defaultState();
  let shape = avatar ? 1 : null; let zoom = 1; let px = 0.5; let py = 0.5;
  let tab = 'fit'; let adj = 'brightness'; let custom = { w: '5', h: '7', on: false };
  const apply = () => { const { W, H } = orientedSize(r.srcW, r.srcH, st.rotate); st.crop = fitCrop(shape, zoom, px, py, W, H); };

  return new Promise((resolve) => {
    const frame = el('div', { class: `se-frame${avatar ? ' se-round' : ''}` }, preview, cropBox);
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
      const onFit = tab === 'fit';
      frame.classList.toggle('se-fitting', onFit);
      // (Fit shows the whole photo, the frame on it; the other tabs, what's kept.)
      const view = onFit ? { ...st, crop: { x: 0, y: 0, w: 1, h: 1 } } : st;
      const full = outputPixelSize(view, r.srcW, r.srcH);
      const box = frame.parentElement?.getBoundingClientRect(); const maxW = Math.max(200, (box?.width || 360) - 24); const maxH = Math.max(200, (box?.height || 420) - 24);
      const k = Math.min(maxW / full.width, maxH / full.height); const cw = Math.round(full.width * k); const ch = Math.round(full.height * k);
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      r.render(view, Math.max(1, Math.round(cw * dpr)), Math.max(1, Math.round(ch * dpr)));
      preview.style.width = `${cw}px`; preview.style.height = `${ch}px`;
      if (onFit) { const c = st.crop; const ox = preview.offsetLeft; const oy = preview.offsetTop; Object.assign(cropBox.style, { left: `${ox + c.x * cw}px`, top: `${oy + c.y * ch}px`, width: `${c.w * cw}px`, height: `${c.h * ch}px` }); }
    }

    // Moving it (drag) and zooming (pinch, or the slider).
    const pts = new Map(); let start = null;
    frame.addEventListener('pointerdown', (e) => { frame.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); start = { zoom, px, py, crop: { ...st.crop }, pts: new Map(pts), corner: tab === 'fit' && pts.size === 1 ? e.target.closest?.('.se-handle')?.dataset.corner ?? null : null }; });
    frame.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !start) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
      const rect = preview.getBoundingClientRect();
      // (On Fit, the whole photo shows: the frame goes where the finger goes.)
      // (A corner dragged: the frame any size; its shape becomes Custom.)
      if (tab === 'fit' && pts.size < 2 && start.corner) {
        const p0 = start.pts.get(e.pointerId); if (!p0) return;
        const { W, H } = orientedSize(r.srcW, r.srcH, st.rotate);
        const f = fitFromRect(resizeCrop(start.crop, start.corner, (e.clientX - p0[0]) / rect.width, (e.clientY - p0[1]) / rect.height), W, H);
        shape = f.ratio; zoom = Math.min(5, f.zoom); px = f.px; py = f.py; custom.on = true; custom.w = String(f.ratio >= 1 ? Math.min(100, Math.round(10 * f.ratio)) : 10); custom.h = String(f.ratio >= 1 ? 10 : Math.min(100, Math.round(10 / f.ratio)));
        zoomIn.value = String(zoom); draw(); return;
      }
      if (tab === 'fit' && pts.size < 2) {
        const p0 = start.pts.get(e.pointerId); if (!p0) return;
        const c = start.crop; const nx = c.x + (e.clientX - p0[0]) / rect.width; const ny = c.y + (e.clientY - p0[1]) / rect.height;
        px = 1 - c.w > 1e-4 ? clamp(nx / (1 - c.w), 0, 1) : 0.5; py = 1 - c.h > 1e-4 ? clamp(ny / (1 - c.h), 0, 1) : 0.5;
        draw(); return;
      }
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
    const up = (e) => { const wasCorner = !!start?.corner; pts.delete(e.pointerId); start = pts.size ? { zoom, px, py, crop: { ...st.crop }, pts: new Map(pts) } : null; if (wasCorner) drawPanel(); };
    frame.addEventListener('pointerup', up); frame.addEventListener('pointercancel', up);
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
      tabs.replaceChildren(...[['fit', 'Fit'], ['filter', 'Filter'], ['edit', 'Edit']].map(([id, label]) => el('button', { type: 'button', role: 'tab', class: `se-tab${tab === id ? ' on' : ''}`, 'aria-selected': String(tab === id), text: label, onclick: () => { tab = id; drawPanel(); draw(); } })));
      if (tab === 'fit') {
        const setShape = (ratio, isCustom = false) => { shape = ratio; custom.on = isCustom; zoom = 1; px = py = 0.5; zoomIn.value = '1'; draw(); drawPanel(); };
        const cw = el('input', { type: 'number', min: '1', max: '100', inputmode: 'numeric', class: 'se-num', value: custom.w, 'aria-label': 'Custom width' });
        const chh = el('input', { type: 'number', min: '1', max: '100', inputmode: 'numeric', class: 'se-num', value: custom.h, 'aria-label': 'Custom height' });
        const onCustom = () => { custom.w = cw.value; custom.h = chh.value; const r2 = customRatio(cw.value, chh.value); if (r2) { shape = r2; custom.on = true; draw(); } };
        cw.addEventListener('input', onCustom); chh.addEventListener('input', onCustom);
        fill(panel,
          avatar ? el('p', { class: 'se-hint', text: 'Drag the circle over the photo; pinch or slide to zoom.' })
            : el('div', { class: 'se-chips', role: 'group', 'aria-label': 'Shape' }, POST_SHAPES.map(([label, ratio]) => el('button', { type: 'button', class: `se-chip${!custom.on && shape === ratio ? ' on' : ''}`, 'aria-pressed': String(!custom.on && shape === ratio), text: label, onclick: () => setShape(ratio) })),
              el('button', { type: 'button', class: `se-chip${custom.on ? ' on' : ''}`, 'aria-pressed': String(custom.on), text: 'Custom', onclick: () => setShape(customRatio(custom.w, custom.h) ?? 1, true) })),
          !avatar && custom.on ? el('div', { class: 'se-row se-custom' }, el('span', { class: 'se-label', text: 'Width : height' }), cw, el('span', { text: ':' }), chh) : null,
          avatar ? null : el('p', { class: 'se-hint', text: 'Drag the frame over the photo to choose what it covers, drag a corner to make it any size; pinch or slide to zoom.' }),
          el('div', { class: 'se-row' }, el('span', { class: 'se-label', text: 'Zoom' }), zoomIn,
            el('button', { type: 'button', class: 'se-icon', 'aria-label': 'Turn', text: '↻', onclick: () => { st.rotate = (st.rotate + 1) % 4; zoom = 1; px = py = 0.5; zoomIn.value = '1'; thumbs = null; draw(); } })));
      } else if (tab === 'filter') {
        const t = makeThumbs();
        const strength = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(st.filterIntensity * 100)), 'aria-label': 'Filter strength', class: 'se-range' });
        strength.addEventListener('input', () => { st.filterIntensity = Number(strength.value) / 100; draw(); });
        fill(panel,
          el('div', { class: 'se-filters', role: 'group', 'aria-label': 'Filters' }, FILTERS.map((f) => el('button', { type: 'button', class: `se-filter${st.filter === f.id ? ' on' : ''}`, 'aria-pressed': String(st.filter === f.id), onclick: () => { st.filter = f.id; if (f.id !== 'original' && !st.filterIntensity) st.filterIntensity = 1; draw(); drawPanel(); } }, t.get(f.id), el('span', { text: f.label })))),
          st.filter !== 'original' ? el('div', { class: 'se-row' }, el('span', { class: 'se-label', text: 'Strength' }), strength) : null);
      } else {
        const a = ADJUSTMENTS.find((x) => x.id === adj) ?? ADJUSTMENTS[0];
        const s = el('input', { type: 'range', min: a.min === 0 ? '0' : '-100', max: '100', value: String(Math.round(st.adjust[a.id] * 100)), 'aria-label': a.label, class: 'se-range' });
        const val = el('span', { class: 'se-val', text: String(Math.round(st.adjust[a.id] * 100)) });
        s.addEventListener('input', () => { st.adjust[a.id] = Number(s.value) / 100; val.textContent = s.value; draw(); });
        fill(panel,
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
 * A video picked, ready to post: { video (as it is), still (a frame from it, for its tile; a plain one if no
 * frame can be had), seconds }. Generous with time (a long or big video from iCloud can take a while to
 * open); throws only when the phone can't play it at all.
 */
export async function prepareVideo(file, { timeout = 90000 } = {}) {
  const url = URL.createObjectURL(file);
  let still = null; let seconds = 0;
  try {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    try {
      await new Promise((ok, bad) => {
        let t = 0; const done = () => { clearTimeout(t); ok(); };
        v.onloadeddata = done; v.oncanplay = done;
        // (Some phones won't load a frame until it plays: a muted moment of it, then paused.)
        v.onloadedmetadata = () => { const pr = v.play?.(); pr?.then?.(() => v.pause(), () => {}); };
        v.onerror = () => { clearTimeout(t); bad(new Error('This video can\'t be played on this device.')); };
        t = setTimeout(() => bad(Object.assign(new Error('slow'), { slow: true })), timeout);
        v.src = url; v.load?.();
      });
      seconds = Number.isFinite(v.duration) ? v.duration : 0;
      // (A frame a little way in: the very first is often black.)
      if (seconds > 0.6) await new Promise((ok) => { const t = setTimeout(ok, 10000); v.onseeked = () => { clearTimeout(t); ok(); }; v.currentTime = Math.min(0.5, seconds / 3); });
      if (v.videoWidth) {
        const f = fitSize(v.videoWidth, v.videoHeight, 720);
        const c = document.createElement('canvas'); c.width = f.width; c.height = f.height;
        c.getContext('2d').drawImage(v, 0, 0, f.width, f.height);
        still = await canvasToBlob(c, 'image/jpeg', 0.85);
      }
    } catch (e) { if (!e.slow) throw e; }
    if (!still) still = await plainStill();
    return { video: file, still, seconds };
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Several frames from across a video (at 10%, 35%, 60% and 85% of it, `n` of them), small, for reading what it
 * shows: [Blob] (as many as could be had; [] if none). Each seek given a few seconds at most.
 */
export async function videoFrames(file, { n = 4, edge = 320, wait = 4000 } = {}) {
  const url = URL.createObjectURL(file); const out = [];
  try {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
    await new Promise((ok, bad) => { const t = setTimeout(() => bad(new Error('slow')), 30000); v.onloadedmetadata = () => { clearTimeout(t); ok(); }; v.onerror = () => { clearTimeout(t); bad(new Error('unplayable')); }; v.src = url; v.load?.(); });
    const d = Number.isFinite(v.duration) ? v.duration : 0; if (!d) return out;
    const at = n <= 1 ? [0.35] : Array.from({ length: n }, (_, i) => 0.1 + (0.75 * i) / (n - 1));
    for (const q of at) {
      const ok = await new Promise((res) => { const t = setTimeout(() => res(false), wait); v.onseeked = () => { clearTimeout(t); res(true); }; v.currentTime = Math.min(d - 0.05, Math.max(0, d * q)); });
      if (!ok || !v.videoWidth) continue;
      const f = fitSize(v.videoWidth, v.videoHeight, edge);
      const c = document.createElement('canvas'); c.width = f.width; c.height = f.height;
      c.getContext('2d').drawImage(v, 0, 0, f.width, f.height);
      out.push(await canvasToBlob(c, 'image/jpeg', 0.75));
    }
  } catch { /* what could be had */ } finally { URL.revokeObjectURL(url); }
  return out;
}

/** A plain still (dark, with ▶) for a video no frame could be taken from yet. */
async function plainStill() {
  const c = document.createElement('canvas'); c.width = 720; c.height = 1280; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 1280); gr.addColorStop(0, '#2b2f3a'); gr.addColorStop(1, '#111318'); g.fillStyle = gr; g.fillRect(0, 0, 720, 1280);
  g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.moveTo(300, 540); g.lineTo(300, 740); g.lineTo(460, 640); g.closePath(); g.fill();
  return canvasToBlob(c, 'image/jpeg', 0.85);
}
