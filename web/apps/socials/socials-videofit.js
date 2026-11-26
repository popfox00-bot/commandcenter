// Framing a video for its post: the whole video playing (muted) with the frame of what's shown over it, the
// rest dimmed, as the photo editor's Fit is. Pick a shape (the whole video, Square, 4:5, 9:16, 16:9, 4:3),
// drag the frame over the video to choose what it covers, drag a corner to make it any size, pinch or slide to
// zoom. Nothing is re-encoded: the video is kept as it is and shown through the frame (fit: { x, y, w, h, a },
// the frame in 0..1 of the video and its width ÷ height), wherever it's shown.

import { el, fill } from '../../lib/dom.js';
import { fitCrop, fitFromRect, resizeCrop, cropHandles } from './socials-editor.js';
import { cleanFit } from './socials-core.js';

export { cleanFit };

const SHAPES = [['Whole video', null], ['Square', 1], ['Portrait 4:5', 4 / 5], ['Story 9:16', 9 / 16], ['16:9', 16 / 9], ['4:3', 4 / 3]];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * How to show a video through its frame: { box: aspect-ratio, video: { width, height, left, top } } as CSS
 * values (the video sized and moved so just the frame shows), or null for the whole video.
 */
export function fitStyle(fit) {
  const f = cleanFit(fit); if (!f) return null;
  return { box: String(f.a), video: { width: `${100 / f.w}%`, height: `${100 / f.h}%`, left: `${(-f.x / f.w) * 100}%`, top: `${(-f.y / f.h) * 100}%` } };
}

/** Where a framed video's middle is, as an object-position ("40% 25%"), for its still in a square tile. */
export function fitPosition(fit) {
  const f = cleanFit(fit); if (!f) return '';
  const px = f.w < 0.999 ? clamp(f.x / (1 - f.w), 0, 1) : 0.5; const py = f.h < 0.999 ? clamp(f.y / (1 - f.h), 0, 1) : 0.5;
  return `${Math.round(px * 100)}% ${Math.round(py * 100)}%`;
}

/**
 * Frame a video (a Blob). `fit`: its frame so far. Resolves to { fit } (null: the whole video) when Done, or
 * null when cancelled.
 */
export function frameVideo(blob, fit = null) {
  const url = URL.createObjectURL(blob);
  const video = el('video', { class: 'sv-video', src: url, muted: true, loop: true, playsinline: true, autoplay: true, 'aria-label': 'Your video' });
  video.muted = true;
  const box = el('div', { class: 'se-cropbox', 'aria-label': 'What\'s shown: drag to move, drag a corner to resize, pinch to zoom' }, cropHandles());
  const frame = el('div', { class: 'se-frame se-fitting sv-frame' }, video, box);
  let W = 16; let H = 9;
  // (Its frame as fitCrop's terms: a shape, zoom and place.)
  let shape = null; let zoom = 1; let px = 0.5; let py = 0.5; let custom = false;
  const f0 = cleanFit(fit);
  return new Promise((resolve) => {
    const panel = el('div', { class: 'se-panel' });
    const crop = () => fitCrop(shape, zoom, px, py, W, H);
    const close = (val) => { sheet.remove(); document.body.classList.remove('se-open'); URL.revokeObjectURL(url); resolve(val); };
    const done = el('button', { type: 'button', class: 'se-done', text: 'Done', onclick: () => { const c = crop(); close({ fit: shape ? cleanFit({ ...c, a: (c.w * W) / (c.h * H) }) : null }); } });
    const sheet = el('div', { class: 'se sv', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Frame video' },
      el('div', { class: 'se-bar' }, el('button', { type: 'button', class: 'se-cancel', text: 'Cancel', onclick: () => close(null) }), el('strong', { text: 'Frame video' }), done),
      el('div', { class: 'se-stage' }, frame), panel);
    const zoomIn = el('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Zoom', class: 'se-range' });
    zoomIn.addEventListener('input', () => { if (!shape) return; zoom = Number(zoomIn.value); draw(); });

    function draw() {
      const stage = frame.parentElement?.getBoundingClientRect(); const maxW = Math.max(200, (stage?.width || 360) - 24); const maxH = Math.max(200, (stage?.height || 420) - 24);
      const k = Math.min(maxW / W, maxH / H); const cw = Math.round(W * k); const ch = Math.round(H * k);
      video.style.width = `${cw}px`; video.style.height = `${ch}px`;
      const c = crop(); box.hidden = !shape;
      Object.assign(box.style, { left: `${video.offsetLeft + c.x * cw}px`, top: `${video.offsetTop + c.y * ch}px`, width: `${c.w * cw}px`, height: `${c.h * ch}px` });
    }
    function drawPanel() {
      fill(panel,
        el('div', { class: 'se-chips', role: 'group', 'aria-label': 'Shape' }, SHAPES.map(([label, ratio]) => el('button', { type: 'button', class: `se-chip${!custom && shape === ratio ? ' on' : ''}`, 'aria-pressed': String(!custom && shape === ratio), text: label, onclick: () => { shape = ratio; custom = false; zoom = 1; px = py = 0.5; zoomIn.value = '1'; draw(); drawPanel(); } })),
          custom ? el('span', { class: 'se-chip on', text: 'Custom' }) : null),
        el('p', { class: 'se-hint', text: shape ? 'Drag the frame over the video to choose what shows; drag a corner to make it any size; pinch or slide to zoom.' : 'The whole video shows. Pick a shape to frame it.' }),
        el('div', { class: 'se-row' }, el('span', { class: 'se-label', text: 'Zoom' }), zoomIn));
    }

    // (Drag the frame; drag a corner to resize it; pinch to zoom.)
    const pts = new Map(); let start = null;
    frame.addEventListener('pointerdown', (e) => { if (!shape) return; frame.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); start = { zoom, crop: crop(), pts: new Map(pts), corner: pts.size === 1 ? e.target.closest?.('.se-handle')?.dataset.corner ?? null : null }; });
    frame.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !start) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
      const rect = video.getBoundingClientRect(); const p0 = start.pts.get(e.pointerId);
      if (pts.size >= 2 && start.pts.size >= 2) {
        const [a, b] = [...pts.values()]; const [a0, b0] = [...start.pts.values()];
        zoom = clamp(start.zoom * (Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, Math.hypot(a0[0] - b0[0], a0[1] - b0[1]))), 1, 4); zoomIn.value = String(zoom);
      } else if (p0 && start.corner) {
        const f = fitFromRect(resizeCrop(start.crop, start.corner, (e.clientX - p0[0]) / rect.width, (e.clientY - p0[1]) / rect.height), W, H);
        shape = f.ratio; zoom = Math.min(4, f.zoom); px = f.px; py = f.py; custom = true; zoomIn.value = String(zoom);
      } else if (p0) {
        const c = start.crop; const nx = c.x + (e.clientX - p0[0]) / rect.width; const ny = c.y + (e.clientY - p0[1]) / rect.height;
        px = 1 - c.w > 1e-4 ? clamp(nx / (1 - c.w), 0, 1) : 0.5; py = 1 - c.h > 1e-4 ? clamp(ny / (1 - c.h), 0, 1) : 0.5;
      }
      draw();
    });
    const up = (e) => { const was = !!start?.corner; pts.delete(e.pointerId); start = pts.size ? { zoom, crop: crop(), pts: new Map(pts), corner: null } : null; if (was) drawPanel(); };
    frame.addEventListener('pointerup', up); frame.addEventListener('pointercancel', up);

    video.addEventListener('loadedmetadata', () => {
      W = video.videoWidth || 16; H = video.videoHeight || 9;
      // (Its frame so far, as the shape, zoom and place.)
      if (f0) { const f = fitFromRect(f0, W, H); shape = f.ratio; zoom = Math.min(4, f.zoom); px = f.px; py = f.py; custom = !SHAPES.some(([, r]) => r && Math.abs(r - f.ratio) < 0.01); if (!custom) shape = SHAPES.find(([, r]) => r && Math.abs(r - f.ratio) < 0.01)[1]; zoomIn.value = String(zoom); }
      drawPanel(); draw(); video.play?.().catch(() => {});
    }, { once: true });
    document.body.append(sheet); document.body.classList.add('se-open');
    drawPanel(); requestAnimationFrame(draw);
    const onResize = () => { if (sheet.isConnected) draw(); else globalThis.removeEventListener('resize', onResize); };
    globalThis.addEventListener('resize', onResize);
  });
}
