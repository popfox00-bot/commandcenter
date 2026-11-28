// Video Editor's shared pieces of screen: picking a video, form fields, the progress bar, and a finished file
// (played here, its check's warnings shown, shared or saved).
import { el, fill } from '../../lib/dom.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes } from '../../lib/files.js';

let uid = 0;
/** A "choose a video" drop zone; `onFiles(files)` gets what's picked or dropped. */
export function picker(label, onFiles, { multiple = false, accept = 'video/*,.mp4,.mov,.m4v,.webm,.mkv' } = {}) {
  const id = `vid-pick-${++uid}`;
  const input = el('input', { type: 'file', accept, multiple, class: 'visually-hidden', id });
  input.addEventListener('change', () => { const f = [...input.files]; input.value = ''; if (f.length) onFiles(f); });
  const drop = el('div', { class: 'drop' }, el('label', { class: 'btn primary block', for: id, text: label }),
    el('p', { class: 'muted small center', text: 'From Photos, Files, or the camera. You can also drop a video here.' }), input);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = [...e.dataTransfer.files]; if (f.length) onFiles(f); });
  return drop;
}

/** A labelled group of several controls (not a <label>: that would name and click only its first). */
export const group = (label, control, hint) => el('div', { class: 'field' }, el('span', { text: label }), control, hint ? el('span', { class: 'muted small', text: hint }) : null);
export const field = (label, control, hint) => el('label', { class: 'field' }, el('span', { text: label }), control, hint ? el('span', { class: 'muted small', text: hint }) : null);
export function select(value, choices, onChange) {
  const s = el('select', {}, ...choices.map(([v, l]) => el('option', { value: String(v), text: l, selected: String(v) === String(value) })));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
export function toggle(label, checked, onChange) {
  const c = el('input', { type: 'checkbox', checked });
  c.addEventListener('change', () => onChange(c.checked));
  return el('label', { class: 'check' }, c, el('span', { text: label }));
}
/** A slider with its value shown: `fmt(value)` for the label. */
export function slider(label, value, { min, max, step = 1, fmt = String, hint, onChange }) {
  const out = el('output', { text: fmt(value) });
  const r = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
  r.addEventListener('input', () => { out.textContent = fmt(Number(r.value)); onChange(Number(r.value)); });
  return field(label, el('span', { class: 'range-row' }, r, out), hint);
}
/** Segmented buttons: `choices` [[value, label]]; returns the bar (its `set(value)` re-marks it). */
export function segmented(label, value, choices, onChange) {
  const bar = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const draw = (v) => fill(bar, choices.map(([c, l]) => el('button', { type: 'button', class: `seg${c === v ? ' active' : ''}`, role: 'radio', 'aria-checked': String(c === v), text: l, onclick: () => { draw(c); onChange(c); } })));
  draw(value); bar.set = draw;
  return bar;
}

/** A progress bar: set(fraction, label), hide(). */
export function progressBar() {
  const bar = el('div', { class: 'progress-bar' }); const label = el('span', { class: 'small muted progress-label' });
  const node = el('div', { class: 'progress', hidden: true, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar, label);
  node.set = (f, text) => { node.hidden = false; const p = Math.round(Math.max(0, Math.min(1, f)) * 100); bar.style.width = `${p}%`; node.setAttribute('aria-valuenow', String(p)); label.textContent = text; };
  node.hide = () => { node.hidden = true; };
  return node;
}

export const clock = (s) => { if (s == null || !Number.isFinite(s)) return '…'; s = Math.round(s); return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };
export const secs = (s) => `${(Math.round(s * 10) / 10).toFixed(1)} s`;

/**
 * A finished file: played here (video or sound), its size and picture, its check's problems and warnings (never
 * hidden), Share and Save, and `extra` (nodes) under it. `urls` collects object URLs to revoke later.
 */
export function resultCard({ blob, name, check, extra = [] }, urls) {
  const url = URL.createObjectURL(blob); urls.add(url);
  const file = new File([blob], name, { type: blob.type });
  const isAudio = blob.type.startsWith('audio/'); const isImage = blob.type.startsWith('image/');
  const info = check?.info;
  const media = isImage ? el('img', { src: url, alt: name, class: 'vid-player vid-gif' }) : isAudio ? el('audio', { controls: true, src: url, class: 'vid-player' }) : el('video', { controls: true, playsinline: true, src: url, class: 'vid-player', preload: 'metadata' });
  return el('section', { class: 'results vid-result' },
    el('h3', { text: `Done: ${name}` }),
    media,
    el('p', { class: 'muted small', text: [formatBytes(blob.size), info ? `${info.w}×${info.h}` : null, info?.frames ? `${info.frames} frames` : null, info ? secs(info.duration) : null, info && !isImage ? (info.audio ? 'with sound' : 'no sound') : null].filter(Boolean).join(' · ') }),
    check?.problems?.length ? el('div', { class: 'vid-problems', role: 'alert' }, el('strong', { class: 'bad-text', text: 'The file came out wrong:' }), el('ul', {}, ...check.problems.map((p) => el('li', { class: 'bad-text small', text: p })))) : null,
    ...(check?.warnings ?? []).map((w) => el('p', { class: 'warn-text small', role: 'status', text: w })),
    el('div', { class: 'row wrap' },
      canShareFiles([file]) ? el('button', { type: 'button', class: 'btn primary', text: 'Share', onclick: () => shareFiles([file], name).catch(() => {}) }) : null,
      el('button', { type: 'button', class: 'btn', text: 'Save', onclick: () => downloadBlob(blob, name) })),
    ...extra);
}

/** An error, in words, in `box`. */
export const showError = (box, err) => fill(box, el('p', { class: 'bad-text', role: 'alert', text: err?.message ?? String(err) }));

/**
 * A timeline to trim with: a strip of the video's frames, the part kept lit between two handles (dragged with a
 * finger or the mouse, or moved with the arrow keys), and its times. `opened` (openVideo's), `frameAt(t, w, h)` (the
 * frame's RGBA), { start, end, onChange(start, end) }. Returns the element; its set(start, end) moves the handles.
 */
export function timeline(opened, frameAt, { start = 0, end = opened.info.duration, onChange = () => {} } = {}) {
  const dur = opened.info.duration; const step = 0.05;
  const strip = el('canvas', { class: 'vid-tl-strip', width: '640', height: '64', 'aria-hidden': 'true' });
  const sel = el('div', { class: 'vid-tl-sel', 'aria-hidden': 'true' });
  const a = el('input', { type: 'range', class: 'vid-tl-h', min: '0', max: String(dur), step: String(step), value: String(start), 'aria-label': 'Start of the part kept' });
  const b = el('input', { type: 'range', class: 'vid-tl-h', min: '0', max: String(dur), step: String(step), value: String(end), 'aria-label': 'End of the part kept' });
  const label = el('p', { class: 'small muted vid-tl-label' });
  const box = el('div', { class: 'vid-tl' }, strip, sel, a, b);
  const node = el('div', { class: 'vid-tl-wrap' }, box, label);
  const paint = () => {
    const s = Number(a.value); const e2 = Number(b.value);
    sel.style.left = `${(s / dur) * 100}%`; sel.style.width = `${Math.max(0, ((e2 - s) / dur) * 100)}%`;
    label.textContent = `${secs(s)} – ${secs(e2)} (${secs(e2 - s)} kept)`;
  };
  const moved = (which) => {
    let s = Number(a.value); let e2 = Number(b.value);
    if (e2 - s < 0.1) { if (which === a) s = Math.max(0, e2 - 0.1); else e2 = Math.min(dur, s + 0.1); a.value = String(s); b.value = String(e2); }
    paint(); onChange(s, e2);
  };
  a.addEventListener('input', () => moved(a)); b.addEventListener('input', () => moved(b));
  node.set = (s, e2) => { a.value = String(s); b.value = String(e2); paint(); };
  paint();
  // (The frames, drawn in as they're read: ten across.)
  (async () => {
    const ctx = strip.getContext('2d'); const n = 10; const tw = strip.width / n; const th = strip.height;
    for (let i = 0; i < n; i++) {
      if (!node.isConnected && i > 0) return;
      try { const t = Math.min(dur - 0.01, (i + 0.5) * (dur / n)); const px = await frameAt(opened, t, Math.round(tw), th); ctx.putImageData(new ImageData(new Uint8ClampedArray(px), Math.round(tw), th), Math.round(i * tw), 0); } catch { /* a frame that won't read: left blank */ }
    }
  })();
  return node;
}
