// Bulk editing: many photos, one set of edits ("recipe"), one output file per photo.
// Per-photo steps adapt to each photo: Auto-Crop finds each photo's own bars, auto-enhance reads each
// photo's own light. Everything runs on this device; results are kept in memory until saved.

import { el } from '../../lib/dom.js';
import { sniffType, decodeImage, fitSize, drawToCanvas, encodeCanvas, canvasToBlob } from '../../lib/image.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes, renameExt } from '../../lib/files.js';
import { Renderer } from './renderer.js';
import { ADJUSTMENTS, FILTERS, RATIOS, defaultState } from './state.js';
import { rotateClockwise, flipHorizontal, outputPixelSize } from './geometry.js';
import { renderEdited, prepareState } from './render-file.js';
import { AUTO_CROP_DEFAULTS } from './autocrop.js';

const PREVIEW_SRC = 1400;   // preview works on a copy this size (long edge)
const THUMB = 220;
const SHARE_CHUNK = 20;     // if the share sheet can't take them all at once, offer them in groups
const TYPES = [['same', 'Same as photo'], ['image/jpeg', 'JPEG'], ['image/png', 'PNG'], ['image/webp', 'WebP']];
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function defaultRecipe() {
  return {
    autoCrop: true, barColors: [...AUTO_CROP_DEFAULTS.colors], autoEnhance: false,
    filter: 'original', filterIntensity: 1, adjust: defaultState().adjust,
    turns: 0, flipH: false, ratio: 'free',
    type: 'same', quality: 0.92, maxEdge: 0,
  };
}

/** The edit state a recipe stands for (before the per-photo steps). */
export function recipeState(rc) {
  let s = { ...defaultState(), adjust: { ...defaultState().adjust, ...rc.adjust }, filter: rc.filter, filterIntensity: rc.filterIntensity };
  for (let i = 0; i < rc.turns % 4; i++) s = rotateClockwise(s);
  if (rc.flipH) s = flipHorizontal(s);
  return s;
}
const ratioValue = (rc) => RATIOS.find((r) => r.id === rc.ratio)?.ratio ?? null;
export const outputType = (rc, sourceType) => (rc.type !== 'same' ? rc.type : ['image/jpeg', 'image/png', 'image/webp'].includes(sourceType) ? sourceType : 'image/jpeg');

/** Unique output names: "IMG_1.jpg" -> "IMG_1-edited.jpg", then "-edited-2" for repeats. */
export function uniqueName(name, ext, taken) {
  let n = renameExt(name, ext, '-edited');
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = renameExt(name, ext, `-edited-${i}`);
  taken.add(n.toLowerCase());
  return n;
}

/** Editable list of boundary colors (any of them counts as bar). onChange(colors) after each edit. */
export function barColorsPicker(colors, onChange) {
  const box = el('div', { class: 'row wrap bt-colors' });
  const draw = () => box.replaceChildren(
    ...colors.map((c, i) => {
      const input = el('input', { type: 'color', value: c, class: 'swatch-custom', 'aria-label': `Bar color ${i + 1}` });
      input.addEventListener('change', () => { colors[i] = input.value; onChange(colors); draw(); });
      return el('span', { class: 'bt-color' }, input, el('code', { class: 'small', text: c.toUpperCase() }),
        colors.length > 1 ? el('button', { class: 'btn small-btn ghost', 'aria-label': `Remove ${c}`, text: '✕', onclick: () => { colors.splice(i, 1); onChange(colors); draw(); } }) : null);
    }),
    colors.length < 4 ? el('button', { class: 'btn small-btn ghost', text: '+ Color', onclick: () => { colors.push('#000000'); onChange(colors); draw(); } }) : null,
    el('button', { class: 'linkish small', text: 'Defaults', onclick: () => { colors.splice(0, colors.length, ...AUTO_CROP_DEFAULTS.colors); onChange(colors); draw(); } }));
  draw();
  return box;
}

/** mountBatch(host, files, { prefs, savePrefs, onExit, onEditOne }) -> stop() */
export function mountBatch(host, files, { prefs, savePrefs, onExit, onEditOne }) {
  const recipe = { ...defaultRecipe(), ...(prefs.batchRecipe ?? {}), adjust: { ...defaultRecipe().adjust, ...(prefs.batchRecipe?.adjust ?? {}) } };
  if (!Array.isArray(recipe.barColors) || !recipe.barColors.length) recipe.barColors = [...AUTO_CROP_DEFAULTS.colors];
  delete recipe.barColor;
  const saveRecipe = () => { prefs.batchRecipe = recipe; savePrefs(); };
  let items = [];
  let focus = null;
  let results = [];      // [{ item, file: File, url, note, w, h }]
  let running = null;    // { cancel: bool }
  let stopped = false;
  let activeAdjust = 'exposure';
  const urls = new Set();
  const track = (u) => { urls.add(u); return u; };

  const grid = el('div', { class: 'bt-grid' });
  const count = el('strong');
  const previewCanvas = el('canvas', { class: 'bt-preview-canvas' });
  const previewNote = el('p', { class: 'small muted bt-preview-note' });
  const recipeBox = el('div', { class: 'bt-recipe' });
  const runBox = el('div', { class: 'bt-run' });
  const resultsBox = el('section', { class: 'bt-results', hidden: true });
  const addInput = el('input', { type: 'file', accept: 'image/*,.heic,.heif', multiple: true, class: 'visually-hidden', id: 'bt-add' });
  addInput.addEventListener('change', () => { addFiles([...addInput.files]); addInput.value = ''; });

  host.replaceChildren(
    el('div', { class: 'row space bt-top' },
      el('button', { class: 'btn small-btn ghost', text: '‹ Back', onclick: () => { if (!results.length || confirm('Leave? Edited photos you haven\'t saved will be lost.')) onExit(); } }),
      count,
      el('label', { class: 'btn small-btn', for: 'bt-add', text: '+ Add' })),
    el('div', { class: 'row wrap bt-select' },
      el('button', { class: 'btn small-btn ghost', text: 'Select all', onclick: () => { items.forEach((i) => { i.selected = true; }); drawGrid(); } }),
      el('button', { class: 'btn small-btn ghost', text: 'Select none', onclick: () => { items.forEach((i) => { i.selected = false; }); drawGrid(); } }),
      el('span', { class: 'muted small', text: 'Tap a photo to preview it; tap its circle to include or skip it.' })),
    grid,
    el('section', { class: 'bt-preview' }, previewCanvas, previewNote,
      el('button', { class: 'btn small-btn ghost', text: 'Edit just this photo in the full editor', onclick: () => { if (focus && (!results.length || confirm('Open the full editor? Bulk results you haven\'t saved will be lost.'))) onEditOne(focus.file); } })),
    recipeBox, runBox, resultsBox, addInput);

  // ---------- photos ----------

  function addFiles(list) {
    const fresh = list.map((file, i) => ({ id: crypto.randomUUID(), file, name: file.name || `photo-${items.length + i + 1}.jpg`, selected: true, thumb: null, type: null }));
    items.push(...fresh);
    focus ??= fresh[0] ?? null;
    drawGrid();
    loadThumbs(fresh);
    preview();
  }

  async function loadThumbs(list) {
    for (const it of list) {
      if (stopped) return;
      try {
        it.type = await sniffType(it.file);
        const bm = await decodeImage(it.file, it.type);
        const fit = fitSize(bm.width, bm.height, THUMB);
        it.thumb = track(URL.createObjectURL(await canvasToBlob(drawToCanvas(bm, fit.width, fit.height, '#ffffff'), 'image/jpeg', 0.8)));
        bm.close?.();
      } catch (err) { it.error = err.message; }
      drawTile(it);
    }
  }

  const tiles = new Map();
  function drawGrid() {
    const sel = items.filter((i) => i.selected).length;
    count.textContent = `${items.length} photos · ${sel} selected`;
    grid.replaceChildren(...items.map((it) => { const t = tile(it); tiles.set(it.id, t); return t; }));
    drawRun();
  }
  function drawTile(it) { const old = tiles.get(it.id); if (old) { const t = tile(it); tiles.set(it.id, t); old.replaceWith(t); } }
  function tile(it) {
    return el('div', { class: `bt-tile${it.selected ? ' selected' : ''}${focus === it ? ' focus' : ''}` },
      el('button', { class: 'bt-tile-img', 'aria-label': `Preview ${it.name}`, onclick: () => { focus = it; drawGrid(); preview(); } },
        it.thumb ? el('img', { src: it.thumb, alt: '' }) : el('span', { class: 'small muted', text: it.error ? '⚠' : '…' })),
      el('button', { class: 'bt-check', role: 'checkbox', 'aria-checked': String(it.selected), 'aria-label': `${it.selected ? 'Skip' : 'Include'} ${it.name}`, text: it.selected ? '✓' : '', onclick: () => { it.selected = !it.selected; drawGrid(); } }),
      el('span', { class: 'bt-tile-name small', text: it.name }));
  }

  // ---------- preview (one photo, the whole recipe, its own Auto-Crop) ----------

  let pr = null; let prFor = null; let prToken = 0; let prTimer = 0;
  function preview() { clearTimeout(prTimer); prTimer = setTimeout(previewNow, 60); }
  async function previewNow() {
    const it = focus;
    if (!it || stopped) return;
    const my = ++prToken;
    try {
      if (prFor !== it) {
        const bm = await decodeImage(it.file, it.type ?? await sniffType(it.file));
        if (my !== prToken) { bm.close?.(); return; }
        pr ??= new Renderer(previewCanvas);
        const fit = fitSize(bm.width, bm.height, Math.min(PREVIEW_SRC, pr.maxTexture));
        pr.setSource(drawToCanvas(bm, fit.width, fit.height, null));
        bm.close?.();
        prFor = it;
      }
      const { state: s, notes } = prepareState(pr, recipeState(recipe), opts());
      const out = outputPixelSize(s, pr.srcW, pr.srcH);
      const fit = fitSize(out.width, out.height, 900);
      pr.render(s, fit.width, fit.height);
      previewNote.textContent = `${it.name}${notes.length ? ` · ${notes.join(' · ')}` : ''}`;
    } catch (err) {
      previewNote.textContent = `${it.name}: ${err.message}`;
    }
  }
  const opts = () => ({ autoCrop: recipe.autoCrop ? { colors: [...recipe.barColors] } : null, autoEnhance: recipe.autoEnhance, ratio: ratioValue(recipe) });
  const changed = () => { saveRecipe(); drawRecipe(); drawRun(); preview(); };

  // ---------- recipe ----------

  function toggle(label, key, hint) {
    const id = `bt-${key}`;
    const box = el('input', { type: 'checkbox', class: 'qr-check-input', id, checked: !!recipe[key] });
    box.addEventListener('change', () => { recipe[key] = box.checked; changed(); });
    return el('div', { class: 'bt-opt' }, el('label', { class: 'qr-checkbox', for: id }, box, ` ${label}`), hint ? el('span', { class: 'small muted', text: hint }) : null);
  }
  function slider(value, min, onCommit, label) {
    const out = el('output', { text: String(value) });
    const r = el('input', { type: 'range', min: String(min), max: '100', value: String(value), 'aria-label': label });
    r.addEventListener('input', () => { out.textContent = r.value; });
    r.addEventListener('change', () => onCommit(Number(r.value)));
    return el('div', { class: 'range-row' }, r, out);
  }

  function drawRecipe() {
    const def = ADJUSTMENTS.find((a) => a.id === activeAdjust);
    const typeSel = el('select', { 'aria-label': 'File type' }, ...TYPES.map(([v, l]) => el('option', { value: v, text: l, selected: recipe.type === v })));
    typeSel.addEventListener('change', () => { recipe.type = typeSel.value; changed(); });
    const sizeSel = el('select', { 'aria-label': 'Size' }, ...[[0, 'Full size'], [4096, '4096 px'], [2048, '2048 px'], [1080, '1080 px']].map(([v, l]) => el('option', { value: String(v), text: l, selected: recipe.maxEdge === v })));
    sizeSel.addEventListener('change', () => { recipe.maxEdge = Number(sizeSel.value); changed(); });

    recipeBox.replaceChildren(...[
      el('h3', { text: 'Edits for every selected photo' }),
      el('div', { class: 'bt-opt' },
        toggle('Auto-Crop bars', 'autoCrop'),
        el('span', { class: 'small muted', text: 'Finds solid bars of these colors (either one) at the top and bottom of each photo and keeps the middle. Each photo gets its own crop.' }),
        barColorsPicker(recipe.barColors, () => changed())),
      toggle('Auto-enhance', 'autoEnhance', 'Light and color tuned for each photo.'),
      el('strong', { class: 'small', text: 'Filter' }),
      el('div', { class: 'chips' }, ...FILTERS.map((f) => el('button', { class: `chip${recipe.filter === f.id ? ' active' : ''}`, text: f.label, onclick: () => { recipe.filter = f.id; changed(); } }))),
      recipe.filter !== 'original' ? slider(Math.round(recipe.filterIntensity * 100), 0, (v) => { recipe.filterIntensity = v / 100; changed(); }, 'Filter intensity') : null,
      el('div', { class: 'row space' }, el('strong', { class: 'small', text: 'Light & color' }), el('button', { class: 'linkish small', text: 'Reset', onclick: () => { recipe.adjust = defaultState().adjust; changed(); } })),
      el('div', { class: 'chips' }, ...ADJUSTMENTS.map((a) => el('button', { class: `chip${a.id === activeAdjust ? ' active' : ''}${recipe.adjust[a.id] ? ' changed' : ''}`, text: `${a.icon} ${a.label}`, onclick: () => { activeAdjust = a.id; drawRecipe(); } }))),
      slider(Math.round(recipe.adjust[activeAdjust] * 100), def.min === 0 ? 0 : -100, (v) => { recipe.adjust = { ...recipe.adjust, [activeAdjust]: v / 100 }; changed(); }, def.label),
      el('strong', { class: 'small', text: 'Turn & shape' }),
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn small-btn', text: `⟳ Rotate${recipe.turns % 4 ? ` (${(recipe.turns % 4) * 90}°)` : ''}`, onclick: () => { recipe.turns = (recipe.turns + 1) % 4; changed(); } }),
        el('button', { class: `btn small-btn${recipe.flipH ? ' primary' : ''}`, text: '⇋ Flip', onclick: () => { recipe.flipH = !recipe.flipH; changed(); } })),
      el('div', { class: 'chips' }, ...RATIOS.filter((r) => r.id !== 'original').map((r) => el('button', { class: `chip${recipe.ratio === r.id ? ' active' : ''}`, text: r.id === 'free' ? 'Any shape' : r.label, onclick: () => { recipe.ratio = r.id; changed(); } }))),
      el('strong', { class: 'small', text: 'Files' }),
      el('div', { class: 'row wrap' }, typeSel, sizeSel),
      recipe.type !== 'image/png' ? slider(Math.round(recipe.quality * 100), 50, (v) => { recipe.quality = v / 100; changed(); }, 'Quality') : null,
    ].filter(Boolean));
  }

  // ---------- run ----------

  function drawRun() {
    const sel = items.filter((i) => i.selected);
    if (running) return;
    runBox.replaceChildren(el('button', { class: 'btn primary block', disabled: !sel.length, text: sel.length ? `Apply to ${sel.length} photo${sel.length === 1 ? '' : 's'}` : 'Select photos to edit', onclick: run }));
  }

  async function run() {
    const sel = items.filter((i) => i.selected);
    if (!sel.length) return;
    for (const r of results) { URL.revokeObjectURL(r.url); urls.delete(r.url); }
    results = [];
    running = { cancel: false };
    const bar = el('progress', { max: String(sel.length), value: '0' });
    const label = el('p', { class: 'small' });
    runBox.replaceChildren(label, bar, el('button', { class: 'btn small-btn ghost', text: 'Stop', onclick: () => { running.cancel = true; } }));
    const taken = new Set();
    const base = recipeState(recipe);
    for (let i = 0; i < sel.length; i++) {
      if (running.cancel || stopped) break;
      const it = sel[i];
      label.textContent = `Editing ${i + 1} of ${sel.length}: ${it.name}`;
      try {
        const type = outputType(recipe, it.type ?? await sniffType(it.file));
        const { canvas, notes } = await renderEdited(it.file, base, { ...opts(), maxEdge: recipe.maxEdge });
        const blob = await encodeCanvas(canvas, type, recipe.quality);
        const name = uniqueName(it.name, EXT[type], taken);
        const file = new File([blob], name, { type: blob.type, lastModified: Date.now() });
        const fit = fitSize(canvas.width, canvas.height, THUMB);
        const url = track(URL.createObjectURL(await canvasToBlob(drawToCanvas(canvas, fit.width, fit.height, '#ffffff'), 'image/jpeg', 0.8)));
        results.push({ item: it, file, url, note: notes.join(' · '), w: canvas.width, h: canvas.height });
        canvas.width = canvas.height = 0; // free the memory now, not at garbage collection
      } catch (err) {
        results.push({ item: it, error: err.message });
      }
      bar.value = i + 1;
      // Let the page breathe between photos (and the UI update).
      await new Promise((r) => setTimeout(r, 0));
    }
    const cancelled = running.cancel;
    running = null;
    drawRun();
    drawResults(cancelled);
  }

  // ---------- results + saving ----------

  function drawResults(cancelled) {
    const ok = results.filter((r) => r.file);
    const failed = results.filter((r) => r.error);
    const totalSize = ok.reduce((n, r) => n + r.file.size, 0);
    const shareable = typeof navigator.share === 'function';
    const status = el('p', { class: 'small muted' });
    const saveGroup = (label, hint) => el('button', { class: 'btn primary', text: label, disabled: !ok.length, onclick: () => saveAll(status, hint) });
    resultsBox.hidden = false;
    resultsBox.replaceChildren(...[
      el('h3', { text: `${ok.length} edited photo${ok.length === 1 ? '' : 's'}${cancelled ? ' (stopped early)' : ''} · ${formatBytes(totalSize)}` }),
      shareable
        ? el('div', { class: 'row wrap' }, saveGroup('Save to Photos', 'In the sheet, tap “Save Images”.'), saveGroup('Save to Files', 'In the sheet, tap “Save to Files” and pick a folder.'))
        : el('div', { class: 'row wrap' }, el('button', { class: 'btn primary', text: `Download ${ok.length} files`, disabled: !ok.length, onclick: () => downloadAll(status) })),
      el('p', { class: 'small muted', text: shareable ? 'Each photo is saved as its own file (no zip). Both buttons open the iPhone share sheet with all the files; pick the destination there.' : 'Each photo downloads as its own file (no zip).' }),
      status,
      failed.length ? el('p', { class: 'small bad-text', text: `${failed.length} couldn't be edited: ${failed.map((f) => `${f.item.name} (${f.error})`).join('; ')}` }) : null,
      el('ul', { class: 'bt-result-list' }, ...ok.map((r) => el('li', { class: 'bt-result' },
        el('img', { src: r.url, alt: '' }),
        el('div', { class: 'bt-result-text' },
          el('strong', { class: 'small', text: r.file.name }),
          el('span', { class: 'small muted', text: `${r.w}×${r.h} · ${formatBytes(r.file.size)}` }),
          r.note ? el('span', { class: 'small', text: r.note }) : null),
        el('button', { class: 'btn small-btn', text: shareable ? 'Share' : 'Save', onclick: () => saveOne(r.file) })))),
    ].filter(Boolean));
    resultsBox.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  async function saveOne(file) {
    if (canShareFiles([file])) { try { await shareFiles([file], file.name); } catch { /* cancelled */ } return; }
    downloadBlob(file, file.name);
  }

  /** All files through the share sheet; in groups if the sheet can't take them all at once. */
  async function saveAll(status, hint) {
    const files = results.filter((r) => r.file).map((r) => r.file);
    status.textContent = hint;
    if (canShareFiles(files)) {
      try { await shareFiles(files, `${files.length} photos`); status.textContent = 'Done.'; } catch (err) { status.textContent = err?.message ?? 'Sharing was cancelled.'; }
      return;
    }
    // Groups: each share needs its own tap (the browser rule), so offer the next group as a button.
    const groups = [];
    for (let i = 0; i < files.length; i += SHARE_CHUNK) groups.push(files.slice(i, i + SHARE_CHUNK));
    let g = 0;
    const next = el('button', { class: 'btn small-btn primary' });
    const step = async () => {
      const part = groups[g];
      try { await shareFiles(part, `${part.length} photos`); } catch { /* cancelled: allow a retry of this group */ return; }
      g += 1;
      if (g < groups.length) next.textContent = `Next ${groups[g].length} (${g * SHARE_CHUNK + 1}–${g * SHARE_CHUNK + groups[g].length} of ${files.length})`;
      else { next.remove(); status.textContent = 'Done.'; }
    };
    next.textContent = `Share ${groups[0].length} (1–${groups[0].length} of ${files.length})`;
    next.onclick = step;
    status.replaceChildren(document.createTextNode(`${hint} There are too many to share at once, so they come in groups of ${SHARE_CHUNK}. `), next);
  }

  async function downloadAll(status) {
    const files = results.filter((r) => r.file).map((r) => r.file);
    for (let i = 0; i < files.length; i++) {
      status.textContent = `Downloading ${i + 1} of ${files.length}…`;
      downloadBlob(files[i], files[i].name);
      await new Promise((r) => setTimeout(r, 350)); // browsers drop rapid-fire downloads
    }
    status.textContent = `Downloaded ${files.length} files.`;
  }

  // ---------- start ----------
  drawRecipe();
  addFiles(files);

  return () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(prTimer);
    if (running) running.cancel = true;
    pr?.destroy();
    for (const u of urls) URL.revokeObjectURL(u);
  };
}
