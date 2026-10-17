// File Converter UI. Pick files -> choose a format -> Convert -> Share/Save each result or all.
import { el, store } from '../../lib/dom.js';
import { inspect, convert, TARGETS, DEFAULT_OPTIONS } from './convert-core.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes } from '../../lib/files.js';
import { createZip } from '../../lib/zip.js';

const OPTIONS_KEY = 'cc.convert.options';
const SIZES = [[0, 'Original'], [4096, '4096 px'], [2048, '2048 px'], [1600, '1600 px'], [1080, '1080 px'], [720, '720 px']];

/** mount(host, { onEdit }) — onEdit(file) adds an Edit button to image results. */
export function mount(host, { onEdit } = {}) {
  const options = { ...DEFAULT_OPTIONS, ...store.json(OPTIONS_KEY, {}) };
  let inputs = [];
  let results = [];
  const urls = new Set();
  let controller = null;

  const save = () => store.set(OPTIONS_KEY, JSON.stringify(options));
  const objectUrl = (blob) => { const u = URL.createObjectURL(blob); urls.add(u); return u; };

  // ---------- elements ----------
  const fileInput = el('input', { type: 'file', multiple: true, accept: 'image/*,.heic,.heif,application/pdf,.pdf', class: 'visually-hidden', id: 'cv-files' });
  const pickBtn = el('label', { class: 'btn primary block', for: 'cv-files', text: 'Choose photos or PDFs' });
  const drop = el('div', { class: 'drop' }, pickBtn, el('p', { class: 'muted small center', text: 'From Photos, Files, or the camera. You can also drop files here.' }));
  const inputList = el('ul', { class: 'file-list' });
  const formatBar = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Convert to' });
  const optionsBox = el('div', { class: 'options' });
  const convertBtn = el('button', { class: 'btn primary block', text: 'Convert' });
  const progress = el('div', { class: 'progress', hidden: true }, el('div', { class: 'progress-bar' }), el('span', { class: 'small muted progress-label' }));
  const resultsBox = el('section', { class: 'results', hidden: true });

  host.append(
    drop, inputList,
    el('h3', { text: 'Convert to' }), formatBar, optionsBox,
    convertBtn, progress, resultsBox,
    el('p', { class: 'muted small privacy', text: 'Converted on this phone; nothing is uploaded. Location and camera details are removed from converted files.' }),
  );
  host.append(fileInput);

  // ---------- inputs ----------
  async function addFiles(files) {
    if (!files.length) return;
    const described = await inspect(files);
    inputs = [...inputs, ...described];
    clearResults();
    renderInputs();
  }

  function renderInputs() {
    inputList.replaceChildren(...inputs.map((it, i) => el('li', { class: `file${it.supported ? '' : ' unsupported'}` },
      el('span', { class: 'badge', text: it.label }),
      el('span', { class: 'file-name', text: it.file.name }),
      el('span', { class: 'muted small', text: it.supported ? formatBytes(it.file.size) : 'not supported' }),
      el('button', { class: 'icon-btn small-btn', 'aria-label': `Remove ${it.file.name}`, text: '✕', onclick: () => { inputs.splice(i, 1); clearResults(); renderInputs(); } }))));
    convertBtn.disabled = !inputs.some((i) => i.supported);
    convertBtn.textContent = inputs.length > 1 ? `Convert ${inputs.length} files` : 'Convert';
    renderOptions();
  }

  fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
  const onPaste = (e) => { const files = [...(e.clipboardData?.files ?? [])]; if (files.length) addFiles(files); };
  document.addEventListener('paste', onPaste);

  // ---------- options ----------
  function renderFormats() {
    formatBar.replaceChildren(...Object.entries(TARGETS).map(([id, t]) => el('button', {
      class: `seg${options.target === id ? ' active' : ''}`, role: 'radio', 'aria-checked': String(options.target === id), text: t.label,
      onclick: () => { options.target = id; save(); clearResults(); renderFormats(); renderOptions(); },
    })));
  }

  function field(label, control, hint) {
    return el('label', { class: 'field' }, el('span', { text: label }), control, hint ? el('span', { class: 'muted small', text: hint }) : null);
  }
  function select(value, choices, onChange) {
    const s = el('select', {}, ...choices.map(([v, l]) => el('option', { value: String(v), text: l, selected: String(v) === String(value) })));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }
  function toggle(checked, onChange) {
    const c = el('input', { type: 'checkbox', checked });
    c.addEventListener('change', () => onChange(c.checked));
    return c;
  }

  function renderOptions() {
    const t = TARGETS[options.target];
    const hasPdf = inputs.some((i) => i.isPdf);
    const parts = [];
    if (t.lossy && !(options.target === 'pdf' && options.pdfLossless)) {
      const out = el('output', { text: `${Math.round(options.quality * 100)}` });
      const range = el('input', { type: 'range', min: '40', max: '100', step: '1', value: String(Math.round(options.quality * 100)) });
      range.addEventListener('input', () => { options.quality = Number(range.value) / 100; out.textContent = range.value; });
      range.addEventListener('change', () => { save(); clearResults(); });
      parts.push(field('Quality', el('span', { class: 'range-row' }, range, out), 'Lower = smaller file. 80–90 is visually lossless for photos.'));
    }
    parts.push(field('Max size (long edge)', select(options.maxEdge, SIZES, (v) => { options.maxEdge = Number(v); save(); clearResults(); })));
    if (options.target === 'pdf') {
      parts.push(field('Page size', select(options.pdfPageSize, [['fit', 'Fit to image'], ['letter', 'US Letter'], ['a4', 'A4']], (v) => { options.pdfPageSize = v; save(); clearResults(); })));
      parts.push(el('label', { class: 'check' }, toggle(options.pdfCombine, (v) => { options.pdfCombine = v; save(); clearResults(); }), el('span', { text: 'Combine everything into one PDF' })));
      parts.push(el('label', { class: 'check' }, toggle(options.pdfLossless, (v) => { options.pdfLossless = v; save(); clearResults(); renderOptions(); }), el('span', { text: 'Lossless pages (much bigger files)' })));
    }
    if (hasPdf) {
      parts.push(field('PDF page resolution', select(options.pdfDpi, [[72, '72 dpi (small)'], [150, '150 dpi'], [220, '220 dpi'], [300, '300 dpi (print)']], (v) => { options.pdfDpi = Number(v); save(); clearResults(); }),
        options.target === 'pdf' ? 'PDF pages are turned into images, so text won\'t be selectable in the result.' : 'Each page becomes one image.'));
    }
    optionsBox.replaceChildren(...parts);
  }

  // ---------- convert ----------
  convertBtn.addEventListener('click', async () => {
    if (controller) { controller.abort(); return; }
    controller = new AbortController();
    clearResults();
    convertBtn.textContent = 'Cancel';
    progress.hidden = false;
    const bar = progress.querySelector('.progress-bar');
    const label = progress.querySelector('.progress-label');
    try {
      const { outputs, errors } = await convert(inputs.filter((i) => i.supported), options, {
        signal: controller.signal,
        onProgress: ({ done, total, label: l }) => { bar.style.width = `${Math.round((done / Math.max(total, 1)) * 100)}%`; label.textContent = l; },
      });
      results = outputs;
      renderResults(errors);
    } catch (err) {
      if (err?.name !== 'AbortError') renderResults([{ name: 'Conversion', message: err?.message ?? String(err) }]);
    } finally {
      controller = null;
      progress.hidden = true;
      renderInputs();
    }
  });

  function clearResults() {
    results = [];
    for (const u of urls) URL.revokeObjectURL(u);
    urls.clear();
    resultsBox.hidden = true;
    resultsBox.replaceChildren();
  }

  function toFile(r) { return new File([r.blob], r.name, { type: r.blob.type }); }

  function renderResults(errors = []) {
    resultsBox.hidden = false;
    const inputBytes = inputs.reduce((n, i) => n + i.file.size, 0);
    const outputBytes = results.reduce((n, r) => n + r.blob.size, 0);
    const all = results.map(toFile);
    const actions = results.length > 1 ? el('div', { class: 'row wrap' },
      canShareFiles(all) ? el('button', { class: 'btn primary', text: `Share all ${results.length}`, onclick: () => shareFiles(all, 'Converted files').catch(showError) }) : null,
      zipButton()) : null;

    resultsBox.replaceChildren(...[
      el('h3', { text: results.length ? `Done: ${results.length} file${results.length === 1 ? '' : 's'}, ${formatBytes(outputBytes)} (from ${formatBytes(inputBytes)})` : 'Nothing converted' }),
      actions,
      el('ul', { class: 'result-list' }, ...results.map((r) => {
        const file = toFile(r);
        const isImage = r.blob.type.startsWith('image/');
        return el('li', { class: 'result' },
          isImage ? el('img', { class: 'thumb', src: objectUrl(r.blob), alt: '' }) : el('span', { class: 'thumb doc', 'aria-hidden': 'true', text: 'PDF' }),
          el('div', { class: 'result-text' },
            el('strong', { text: r.name }),
            el('span', { class: 'muted small', text: [formatBytes(r.blob.size), r.width ? `${r.width}×${r.height}` : r.source].filter(Boolean).join(' · ') }),
            r.note ? el('span', { class: 'warn-text small', text: r.note }) : null),
          el('div', { class: 'result-actions' },
            onEdit && isImage ? el('button', { class: 'btn small-btn ghost', text: 'Edit', onclick: () => onEdit(file) }) : null,
            canShareFiles([file]) ? el('button', { class: 'btn small-btn', text: 'Share', onclick: () => shareFiles([file], r.name).catch(showError) }) : null,
            el('button', { class: 'btn small-btn ghost', text: 'Save', onclick: () => downloadBlob(r.blob, r.name) })));
      })),
      errors.length ? el('ul', { class: 'error-list' }, ...errors.map((e) => el('li', { class: 'bad-text small', text: `${e.name}: ${e.message}` }))) : null,
      results.length && canShareFiles([toFile(results[0])]) ? el('p', { class: 'muted small', text: 'Tip: Share → "Save Image" puts photos in your library; "Save to Files" keeps PDFs.' }) : null,
    ].filter(Boolean)); // replaceChildren would turn null into the text "null"
    resultsBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // The ZIP is built right away so the tap can download it synchronously (iOS blocks downloads
  // that start after an await in the tap handler).
  function zipButton() {
    const btn = el('button', { class: 'btn', text: 'Preparing .zip…', disabled: true });
    const batch = results;
    Promise.all(batch.map(async (r) => ({ name: r.name, bytes: new Uint8Array(await r.blob.arrayBuffer()) })))
      .then((files) => {
        if (batch !== results) return;
        const zip = new Blob([createZip(files)], { type: 'application/zip' });
        btn.textContent = `Download all (.zip, ${formatBytes(zip.size)})`;
        btn.disabled = false;
        btn.onclick = () => downloadBlob(zip, 'converted.zip');
      })
      .catch(showError);
    return btn;
  }

  function showError(err) {
    resultsBox.append(el('p', { class: 'bad-text small', text: err?.message ?? String(err) }));
  }

  renderFormats();
  renderInputs();

  return () => {
    controller?.abort();
    document.removeEventListener('paste', onPaste);
    clearResults();
  };
}
