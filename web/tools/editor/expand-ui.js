// Photo Editor → Crop → 🪄 Generative Expand: pick the new shape and where the photo sits in it (a
// preview shows the black space to fill), then the space is filled from the photo's own detail
// (expand.js, in a worker). The result comes back as a new picture for the editor to open.

import { el } from '../../lib/dom.js';
import { encodeCanvas } from '../../lib/image.js';
import { expandLayout, expandFill, PLACES } from './expand.js';

/** The shapes offered (w/h). */
export const EXPAND_RATIOS = [['1:1', 1], ['4:5', 4 / 5], ['3:4', 3 / 4], ['2:3', 2 / 3], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9], ['2:1', 2]];
/** The largest the expanded picture gets (longest side), so the fill stays quick on a phone. */
export const EXPAND_MAX = 2048;

/** The expanded picture, filled in a worker (on this thread if workers aren't available). */
export function runExpand(rgba, w, h, layout, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker(new URL('./expand-worker.js', import.meta.url), { type: 'module' }); } catch { worker = null; }
    if (!worker) {
      setTimeout(() => { try { resolve(expandFill(rgba, w, h, layout, { onProgress })); } catch (err) { reject(err); } }, 30);
      return;
    }
    worker.onmessage = (e) => {
      if (e.data.progress != null) { onProgress(e.data.progress); return; }
      worker.terminate();
      if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.rgba);
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'The fill stopped.')); };
    worker.postMessage({ rgba, w, h, layout, opts: {} }, [rgba.buffer]);
  });
}

/**
 * The dialog. `photo` is a canvas of the photo with its edits. `ratio` and `place` start where they
 * were last left. onUse({ blob, ratio, place }) gets the expanded picture (JPEG) to open.
 */
export function openExpandDialog({ photo, ratio = '9:16', place = 'center', onUse }) {
  // Work on a copy small enough that the expanded picture fits EXPAND_MAX.
  const pw = photo.width; const ph = photo.height;
  let pick = EXPAND_RATIOS.find(([id]) => id === ratio) ?? EXPAND_RATIOS[0];
  let where = PLACES.includes(place) ? place : 'center';
  let busy = false; let result = null; // result: { canvas, ratio, place }
  const preview = el('canvas', { class: 'ed-expand-preview', 'aria-label': 'Preview' });
  const note = el('p', { class: 'small muted', 'aria-live': 'polite' });
  const bar = el('progress', { class: 'ed-expand-progress', max: '1', value: '0', hidden: true });
  const shapes = el('div', { class: 'chips', role: 'group', 'aria-label': 'New shape' });
  const places = el('div', { class: 'chips', role: 'group', 'aria-label': 'Photo at' });
  const go = el('button', { type: 'button', class: 'btn primary', text: '✨ Expand' });
  const use = el('button', { type: 'button', class: 'btn primary', text: '✓ Use it', hidden: true });
  const again = el('button', { type: 'button', class: 'btn ghost', text: '↺ Change', hidden: true });
  const cancel = el('button', { type: 'button', class: 'btn ghost', text: 'Cancel' });
  const dlg = el('dialog', { class: 'ed-dialog ed-expand' },
    el('div', { class: 'sheet' },
      el('h2', { text: '🪄 Generative Expand' }),
      el('p', { class: 'small muted', text: 'A new shape for the photo: it stays as it is, on the side you pick, and the black space is filled in from the photo\'s own detail.' }),
      preview,
      el('strong', { class: 'small', text: 'New shape' }), shapes,
      el('strong', { class: 'small', text: 'Photo at' }), places,
      bar, note,
      el('div', { class: 'row end' }, cancel, again, go, use)));

  const layoutFor = (r, p = where) => expandLayout(pw, ph, r, p);
  function draw() {
    const L = result ? null : layoutFor(pick[1]);
    const W = result ? result.canvas.width : L ? L.W : pw; const H = result ? result.canvas.height : L ? L.H : ph;
    const css = Math.min(1, 300 / Math.max(W, H)); const k = css * (window.devicePixelRatio || 1);
    preview.width = Math.max(1, Math.round(W * k)); preview.height = Math.max(1, Math.round(H * k));
    preview.style.width = `${Math.round(W * css)}px`; preview.style.aspectRatio = `${W} / ${H}`;
    const ctx = preview.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, preview.width, preview.height);
    if (result) ctx.drawImage(result.canvas, 0, 0, preview.width, preview.height);
    else ctx.drawImage(photo, (L?.ox ?? 0) * k, (L?.oy ?? 0) * k, pw * k, ph * k);
  }
  function renderChips() {
    shapes.replaceChildren(...EXPAND_RATIOS.map((r) => el('button', {
      type: 'button', class: `chip${r === pick ? ' active' : ''}`, 'aria-pressed': String(r === pick), text: r[0],
      disabled: busy || !layoutFor(r[1]), title: layoutFor(r[1]) ? '' : 'The photo is this shape already',
      onclick: () => { pick = r; result = null; refresh(); },
    })));
    const L = layoutFor(pick[1]);
    const names = L?.axis === 'y' ? ['▲ Top', 'Middle', '▼ Bottom'] : ['◀ Left', 'Center', 'Right ▶'];
    places.replaceChildren(...PLACES.map((p, i) => el('button', {
      type: 'button', class: `chip${p === where ? ' active' : ''}`, 'aria-pressed': String(p === where), text: names[i], disabled: busy || !L,
      onclick: () => { where = p; result = null; refresh(); },
    })));
  }
  function refresh() {
    renderChips(); draw();
    const L = layoutFor(pick[1]);
    go.hidden = !!result; use.hidden = !result; again.hidden = !result || busy; go.disabled = busy || !L;
    if (!busy && !result) {
      note.textContent = !L ? 'The photo is that shape already: pick another.'
        : `${pick[0]}: ${L.W - pw || L.H - ph} px of new space ${L.axis === 'x' ? (where === 'start' ? 'on the right' : where === 'end' ? 'on the left' : 'on both sides') : (where === 'start' ? 'below' : where === 'end' ? 'above' : 'above and below')}.`;
    }
  }
  go.addEventListener('click', async () => {
    const L0 = layoutFor(pick[1]); if (!L0 || busy) return;
    busy = true; bar.hidden = false; bar.value = 0; note.textContent = 'Filling in from the photo… (up to half a minute for a big one)'; refresh();
    try {
      // The photo at a size where the new picture fits EXPAND_MAX.
      const k = Math.min(1, EXPAND_MAX / Math.max(L0.W, L0.H));
      const w = Math.max(8, Math.round(pw * k)); const h = Math.max(8, Math.round(ph * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(photo, 0, 0, w, h);
      const L = expandLayout(w, h, pick[1], where);
      const out = await runExpand(cx.getImageData(0, 0, w, h).data, w, h, L, (p) => { bar.value = p; });
      const canvas = document.createElement('canvas'); canvas.width = L.W; canvas.height = L.H;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(out.buffer, out.byteOffset, out.length), L.W, L.H), 0, 0);
      result = { canvas };
      note.textContent = `Expanded to ${pick[0]} (${L.W}×${L.H}). Use it, or change the shape or side and try again.`;
    } catch (err) { note.textContent = `Couldn't expand it: ${err.message}`; }
    finally { busy = false; bar.hidden = true; refresh(); }
  });
  again.addEventListener('click', () => { result = null; refresh(); });
  use.addEventListener('click', async () => {
    if (!result) return;
    use.disabled = true;
    const blob = await encodeCanvas(result.canvas, 'image/jpeg', 0.94);
    dlg.close();
    onUse({ blob, ratio: pick[0], place: where });
  });
  cancel.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  refresh();
  dlg.showModal();
  return dlg;
}
