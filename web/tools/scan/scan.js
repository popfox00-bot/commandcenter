// Scan: photograph paper, straighten it, clean it up, and make a PDF (then sign it in the PDF tab).
import { el, store } from '../../lib/dom.js';
import { idb } from '../../lib/idb.js';
import { sniffType, decodeImage, fitSize, drawToCanvas, canvasToBlob } from '../../lib/image.js';
import { createPdf } from '../../lib/pdf-writer.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes } from '../../lib/files.js';
import { detectDocument, quadSize, warp, enhance } from './scan-core.js';

const SAVE_KEY = 'scan.session';
const PREFS_KEY = 'cc.scan.prefs';
const WORK_MAX = 3000;    // processing resolution (long edge)
const DETECT_MAX = 360;   // corner detection runs on a small copy
const FILTERS = [['color', 'Clean'], ['gray', 'Gray'], ['bw', 'B&W'], ['original', 'Original']];

/** mount(host, { onWrite }) — onWrite(file) sends the finished PDF to the PDF tab. */
export function mount(host, { onWrite } = {}) {
  const prefs = { pageSize: 'letter', quality: 0.82, ...store.json(PREFS_KEY, {}) };
  const savePrefs = () => store.set(PREFS_KEY, JSON.stringify(prefs));
  // pages: [{ id, blob, name, corners: [[u,v]x4], filter, rotate, result?: canvas, thumb?: url }]
  let pages = [];
  let saveTimer = 0;
  const list = el('ol', { class: 'scan-pages' });
  const footer = el('div', { class: 'scan-footer' });
  const output = el('section', { class: 'results', hidden: true });
  const camera = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden', id: 'sc-camera' });
  const library = el('input', { type: 'file', accept: 'image/*,.heic,.heif', multiple: true, class: 'visually-hidden', id: 'sc-files' });
  for (const input of [camera, library]) input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });

  host.append(
    el('div', { class: 'row wrap scan-add' },
      el('label', { class: 'btn primary', for: 'sc-camera', text: '📷 Take photo' }),
      el('label', { class: 'btn', for: 'sc-files', text: 'Choose photos' })),
    el('p', { class: 'muted small', text: 'Lay the page on a darker surface for the best automatic edges. Each photo becomes one page.' }),
    list, footer, output, camera, library);

  const write = () => idb.set(SAVE_KEY, { pages: pages.map(({ id, blob, name, corners, filter, rotate }) => ({ id, blob, name, corners, filter, rotate })), savedAt: Date.now() });
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(write, 300); };

  // ---------- adding pages ----------

  async function loadWork(blob) {
    const bitmap = await decodeImage(blob, await sniffType(blob));
    const fit = fitSize(bitmap.width, bitmap.height, WORK_MAX);
    const canvas = drawToCanvas(bitmap, fit.width, fit.height, null);
    bitmap.close?.();
    return canvas;
  }

  async function addFiles(files) {
    for (const f of files) {
      const page = { id: crypto.randomUUID(), blob: f, name: f.name || 'scan.jpg', corners: null, filter: 'color', rotate: 0 };
      try {
        const work = await loadWork(f);
        const small = fitSize(work.width, work.height, DETECT_MAX);
        const sc = drawToCanvas(work, small.width, small.height, null);
        page.corners = detectDocument(sc.getContext('2d').getImageData(0, 0, sc.width, sc.height)).corners;
        pages.push(page);
        renderList();
        // Let the user confirm the edges right away for the page they just added.
        await editCorners(page, work);
      } catch (err) {
        list.after(el('p', { class: 'bad-text small', text: `${f.name}: ${err.message}` }));
      }
    }
    persist();
  }

  // ---------- processing ----------

  async function process(page, work) {
    work ??= await loadWork(page.blob);
    const W = work.width; const H = work.height;
    const quad = page.corners.map(([u, v]) => [u * W, v * H]);
    const size = quadSize(quad);
    const src = work.getContext('2d').getImageData(0, 0, W, H);
    const flat = enhance(warp(src, quad, size.width, size.height), page.filter);
    let canvas = document.createElement('canvas');
    canvas.width = flat.width; canvas.height = flat.height;
    canvas.getContext('2d').putImageData(new ImageData(flat.data, flat.width, flat.height), 0, 0);
    if (page.rotate) {
      const r = document.createElement('canvas');
      const swap = page.rotate % 180 !== 0;
      r.width = swap ? canvas.height : canvas.width; r.height = swap ? canvas.width : canvas.height;
      const ctx = r.getContext('2d');
      ctx.translate(r.width / 2, r.height / 2); ctx.rotate((page.rotate * Math.PI) / 180);
      ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      canvas = r;
    }
    page.result = canvas;
    const t = fitSize(canvas.width, canvas.height, 240);
    if (page.thumb) URL.revokeObjectURL(page.thumb);
    page.thumb = URL.createObjectURL(await canvasToBlob(drawToCanvas(canvas, t.width, t.height, '#fff'), 'image/jpeg', 0.8));
  }

  async function processAndRender(page, work) {
    page.busy = true; renderList();
    try { await process(page, work); } catch (err) { page.error = err.message; }
    page.busy = false; renderList(); persist();
  }

  // ---------- list ----------

  function renderList() {
    list.replaceChildren(...pages.map((p, i) => el('li', { class: 'scan-page' },
      p.thumb ? el('img', { class: 'scan-thumb', src: p.thumb, alt: `Page ${i + 1}` }) : el('span', { class: 'scan-thumb placeholder', text: p.busy ? '…' : String(i + 1) }),
      el('div', { class: 'scan-page-body' },
        el('strong', { text: `Page ${i + 1}` }),
        p.error ? el('span', { class: 'bad-text small', text: p.error }) : null,
        el('div', { class: 'chips' }, ...FILTERS.map(([id, label]) => el('button', {
          class: `chip${p.filter === id ? ' active' : ''}`, text: label,
          onclick: () => { p.filter = id; processAndRender(p); },
        }))),
        el('div', { class: 'row wrap' },
          el('button', { class: 'btn small-btn', text: 'Edges', onclick: () => editCorners(p) }),
          el('button', { class: 'btn small-btn', text: '⟳', 'aria-label': 'Rotate page', onclick: () => { p.rotate = (p.rotate + 90) % 360; processAndRender(p); } }),
          el('button', { class: 'btn small-btn ghost', text: '↑', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; renderList(); persist(); } }),
          el('button', { class: 'btn small-btn ghost', text: '↓', 'aria-label': 'Move down', disabled: i === pages.length - 1, onclick: () => { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; renderList(); persist(); } }),
          el('button', { class: 'btn small-btn ghost', text: '✕', 'aria-label': `Remove page ${i + 1}`, onclick: () => { pages.splice(i, 1); renderList(); persist(); } }))))));
    footer.replaceChildren(...(pages.length ? [
      el('label', { class: 'field' }, el('span', { text: 'Page size' }), select(prefs.pageSize, [['letter', 'US Letter'], ['a4', 'A4'], ['fit', 'Same as scan']], (v) => { prefs.pageSize = v; savePrefs(); })),
      el('button', { class: 'btn primary block', text: `Make PDF (${pages.length} page${pages.length === 1 ? '' : 's'})`, disabled: pages.some((p) => p.busy), onclick: makePdf }),
    ] : []));
  }

  function select(value, choices, onChange) {
    const s = el('select', {}, ...choices.map(([v, l]) => el('option', { value: v, text: l, selected: v === value })));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  // ---------- corner editor ----------

  function editCorners(page, work) {
    return new Promise((resolve) => {
      const canvas = el('canvas', { class: 'scan-edit' });
      let corners = page.corners.map((c) => [...c]);
      let image = work;
      const dlg = el('dialog', { class: 'ed-dialog scan-dialog' }, el('div', { class: 'sheet' },
        el('h2', { text: 'Adjust the edges' }),
        el('p', { class: 'muted small', text: 'Drag the four corners onto the corners of the page.' }),
        canvas,
        el('div', { class: 'row space' },
          el('div', { class: 'row' },
            el('button', { class: 'btn small-btn ghost', text: 'Auto', onclick: () => { corners = detectOn(image); draw(); } }),
            el('button', { class: 'btn small-btn ghost', text: 'Whole photo', onclick: () => { corners = [[0, 0], [1, 0], [1, 1], [0, 1]]; draw(); } })),
          el('button', { class: 'btn primary', text: 'Done', onclick: () => dlg.close('done') }))));
      const draw = () => {
        if (!image) return;
        const maxW = Math.min(canvas.parentElement.clientWidth || 340, 640);
        const maxH = window.innerHeight * 0.55;
        const k = Math.min(maxW / image.width, maxH / image.height);
        const dpr = window.devicePixelRatio || 1;
        canvas.style.width = `${image.width * k}px`; canvas.style.height = `${image.height * k}px`;
        canvas.width = Math.round(image.width * k * dpr); canvas.height = Math.round(image.height * k * dpr);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const P = corners.map(([u, v]) => [u * canvas.width, v * canvas.height]);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.rect(0, 0, canvas.width, canvas.height);
        ctx.moveTo(...P[0]); for (const p of P.slice(1)) ctx.lineTo(...p); ctx.closePath();
        ctx.fill('evenodd');
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2.5 * dpr;
        ctx.beginPath(); ctx.moveTo(...P[0]); for (const p of P.slice(1)) ctx.lineTo(...p); ctx.closePath(); ctx.stroke();
        for (const [x, y] of P) { ctx.beginPath(); ctx.arc(x, y, 13 * dpr, 0, Math.PI * 2); ctx.fillStyle = 'rgba(59,130,246,0.35)'; ctx.fill(); ctx.lineWidth = 3 * dpr; ctx.strokeStyle = '#fff'; ctx.stroke(); }
      };
      let dragging = -1;
      const at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, r]; };
      canvas.addEventListener('pointerdown', (e) => {
        const [u, v, r] = at(e);
        let best = -1; let bestD = 44;
        corners.forEach(([cu, cv], i) => { const d = Math.hypot((cu - u) * r.width, (cv - v) * r.height); if (d < bestD) { bestD = d; best = i; } });
        dragging = best;
        if (best >= 0) { canvas.setPointerCapture(e.pointerId); e.preventDefault(); }
      });
      canvas.addEventListener('pointermove', (e) => {
        if (dragging < 0) return;
        const [u, v] = at(e);
        corners[dragging] = [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
        draw();
      });
      canvas.addEventListener('pointerup', () => { dragging = -1; });
      dlg.addEventListener('close', async () => {
        dlg.remove();
        page.corners = corners;
        await processAndRender(page, image);
        resolve();
      });
      document.body.append(dlg);
      dlg.showModal();
      (image ? Promise.resolve(image) : loadWork(page.blob)).then((img) => { image = img; requestAnimationFrame(draw); });
    });
  }

  function detectOn(work) {
    const small = fitSize(work.width, work.height, DETECT_MAX);
    const sc = drawToCanvas(work, small.width, small.height, null);
    return detectDocument(sc.getContext('2d').getImageData(0, 0, sc.width, sc.height)).corners;
  }

  // ---------- PDF ----------

  async function makePdf() {
    output.hidden = false;
    output.replaceChildren(el('p', { class: 'muted small', text: 'Making PDF…' }));
    try {
      for (const p of pages) if (!p.result) await process(p);
      const pdfPages = [];
      for (const p of pages) {
        const blob = await canvasToBlob(p.result, 'image/jpeg', prefs.quality);
        pdfPages.push({ width: p.result.width, height: p.result.height, image: { kind: 'jpeg', bytes: new Uint8Array(await blob.arrayBuffer()) } });
      }
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
      const name = `Scan ${stamp}.pdf`;
      const blob = new Blob([createPdf(pdfPages, { pageSize: prefs.pageSize, margin: 0, title: name })], { type: 'application/pdf' });
      const file = new File([blob], name, { type: 'application/pdf' });
      output.replaceChildren(...[
        el('h3', { text: `${name} · ${pages.length} page${pages.length === 1 ? '' : 's'} · ${formatBytes(blob.size)}` }),
        el('div', { class: 'row wrap' },
          onWrite ? el('button', { class: 'btn primary', text: 'Sign / write on it', onclick: () => onWrite(file) }) : null,
          canShareFiles([file]) ? el('button', { class: 'btn', text: 'Share', onclick: () => shareFiles([file], name).catch(() => {}) }) : null,
          el('button', { class: 'btn ghost', text: 'Save', onclick: () => downloadBlob(blob, name) }),
          el('button', { class: 'btn ghost', text: 'Start over', onclick: () => { if (window.confirm('Remove all scanned pages?')) { pages = []; idb.del(SAVE_KEY); output.hidden = true; renderList(); } } })),
      ].filter(Boolean));
    } catch (err) {
      output.replaceChildren(el('p', { class: 'bad-text small', text: `Could not make the PDF: ${err.message}` }));
    }
  }

  // ---------- restore ----------
  idb.get(SAVE_KEY).then(async (saved) => {
    if (!saved?.pages?.length || pages.length) return;
    pages = saved.pages.map((p) => ({ ...p }));
    renderList();
    for (const p of pages) await processAndRender(p);
  });
  renderList();

  return () => {
    if (saveTimer) { clearTimeout(saveTimer); write(); }
    for (const p of pages) if (p.thumb) URL.revokeObjectURL(p.thumb);
  };
}
