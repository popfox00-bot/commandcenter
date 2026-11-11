// Downloads: pieces of screen shared by the link view, the queue and History: a download's progress
// bar, Save to phone, its fingerprint, a part picker, the check's verdict.

import { el, fill } from '../../lib/dom.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes } from '../../lib/files.js';
import { noteError } from '../../lib/diag.js';
import { sameFingerprint } from '../../lib/sha256.js';
import { formatTime, minuteMarks } from '../../tools/download/download-core.js';

/** A download's progress bar and its line ("45% · 120 MB of 340 MB · 3.1 MB/s · 1:10 left"). */
export function progressBar(jobs) {
  const bar = el('div', { class: 'progress-bar' });
  const label = el('span', { class: 'small muted progress-label' });
  const node = el('div', { class: 'progress' }, bar, label);
  const update = (job) => {
    const loaded = jobs.loadedOf(job); const total = job.total; const rate = jobs.rateOf(job);
    node.hidden = job.status === 'done';
    bar.style.width = total ? `${Math.min(100, (loaded / total) * 100).toFixed(1)}%` : `${(loaded / (loaded + 20e6)) * 100}%`;
    const of = total ? ` of ${formatBytes(total)}` : '';
    label.textContent = job.status === 'running'
      ? `${total ? `${Math.floor((loaded / total) * 100)}% · ` : ''}${formatBytes(loaded)}${of}${rate ? ` · ${formatBytes(rate)}/s` : ''}${rate && total ? ` · ${formatTime((total - loaded) / rate)} left` : ''}`
      : job.status === 'waiting' ? `Waiting for the other downloads to finish${loaded ? ` · ${formatBytes(loaded)}${of}` : ''}`
        : `${job.status === 'paused' ? 'Paused' : 'Stopped'} · ${formatBytes(loaded)}${of}`;
  };
  return { node, update };
}

/** The buttons for a download in its state (rebuilt only when that changes). */
export function jobButtons(job, jobs, { extra = [] } = {}) {
  const b = [];
  if (job.status === 'running') b.push(el('button', { class: 'btn', text: '⏸ Pause', onclick: () => jobs.pause(job) }));
  if (job.status === 'waiting') b.push(el('button', { class: 'btn', text: '▶ Start now', onclick: () => jobs.resume(job) }), el('button', { class: 'btn ghost', text: '⏸ Hold', onclick: () => jobs.pause(job) }));
  if (job.status === 'paused' || job.status === 'failed') {
    if (!['not-video', 'redirect'].includes(job.code)) b.push(el('button', { class: 'btn primary', text: job.status === 'paused' || (job.loaded && job.ranges) ? '▶ Continue' : '⟳ Try again', onclick: () => jobs.resume(job) }));
    if (job.code === 'blocked' && navigator.onLine) b.push(openInBrowser(job.url));
  }
  if (job.status === 'done') b.push(el('button', { class: `btn ${job.saved ? '' : 'primary'}`, text: job.saved ? '✓ Saved · save again' : '💾 Save to phone', onclick: () => saveJob(job, jobs) }));
  return [...b, ...extra];
}
export const jobState = (job, jobs) => `${job.status}|${jobs.isLive(job)}|${job.hash}|${job.code ?? ''}|${job.details ? 1 : 0}|${job.saved ? 1 : 0}`;
/** What went wrong, said plainly. */
export const jobMessage = (job) => (job.error ? job.error + (job.code === 'blocked' && job.status === 'failed' ? ' Some sites only let their own pages fetch their videos: open it in the browser and save it from there (Share → Save to Files, or ⋮ → Download).' : '') : '');

/** Save to phone: the share sheet (Save Video / Save to Files), or a download. */
export async function saveJob(job, jobs) {
  try {
    const f = await jobs.file(job);
    // The share sheet where there is one (cancelled: nothing saved, nothing else done); else a download.
    if (canShareFiles([f])) { if (await shareFiles([f], f.name)) await jobs.markSaved(job); return; }
    downloadBlob(f, f.name);
    await jobs.markSaved(job);
  } catch (e) { noteError('Downloads: save', e); alert(`Couldn't save it: ${e.message}`); }
}

/** When the site won't let apps fetch it: open it in the browser (its own tab, nothing of this app sent). */
export function openInBrowser(url) {
  return el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer', text: '↗ Open in the browser', title: 'Some sites only let their own pages fetch their videos: open it there and save it (Share → Save to Files, or ⋮ → Download).' });
}

/** The fingerprint (short, tap for all of it) and a box to check it against one you have. */
export function fingerprint(hex) {
  const full = el('code', { class: 'dl-hash', text: hex, hidden: true });
  const short = el('button', { class: 'linkish small', text: `🔏 Fingerprint ${hex.slice(0, 8)} ${hex.slice(8, 16)}…`, title: 'SHA-256: tap to show all of it' });
  short.addEventListener('click', () => { full.hidden = !full.hidden; try { navigator.clipboard?.writeText(hex); } catch { /* fine */ } });
  const box = el('input', { type: 'text', class: 'dl-fp-in', placeholder: 'Paste a SHA-256 to check it against', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Fingerprint to check' });
  const out = el('span', { class: 'small' });
  box.addEventListener('input', () => {
    if (!box.value.trim()) { out.textContent = ''; out.className = 'small'; return; }
    const same = sameFingerprint(hex, box.value);
    out.textContent = same ? '✓ Matches: this is the same file' : '✗ Doesn\'t match: not the file it should be (or a different version)';
    out.className = `small ${same ? 'ok-text' : 'warn-text'}`;
  });
  return [short, full, el('div', { class: 'row dl-fp-row' }, box), out];
}

/** From / To (minute marks) and a button. */
export function partPicker(duration, onGo, label) {
  const marks = minuteMarks(duration).map((m) => m.mark);
  const opts = (sel) => [...marks.map((t) => el('option', { value: String(t), text: formatTime(t), selected: t === sel })), el('option', { value: String(duration), text: `${formatTime(duration)} (end)`, selected: sel === duration })];
  const from = el('select', { 'aria-label': 'From' }, ...opts(0).slice(0, -1));
  const to = el('select', { 'aria-label': 'To' }, ...opts(duration));
  const go = el('button', { class: 'btn primary', text: label });
  const note = el('span', { class: 'muted small' });
  const valid = () => { const ok = Number(to.value) > Number(from.value); go.disabled = !ok; note.textContent = ok ? `About ${formatTime(Number(to.value) - Number(from.value))} long. It starts at the key frame at or just before, so it may begin a moment early.` : 'Pick an end after the start.'; };
  from.addEventListener('change', valid); to.addEventListener('change', valid); valid();
  go.addEventListener('click', () => onGo(Number(from.value), Number(to.value)));
  return el('div', { class: 'dl-part' }, el('div', { class: 'row wrap' }, el('label', { class: 'small' }, 'From ', from), el('label', { class: 'small' }, 'to ', to), go), note);
}

/** The check's result: ok / caution / danger, with its notes. */
export function verdict(level, title, notes) {
  return el('div', { class: `qr-verdict ${level}`, role: level === 'ok' ? 'status' : 'alert' },
    el('strong', { text: title }),
    ...notes.map((n) => el('span', { class: 'small' }, el('b', { text: n.title }), n.detail ? ` — ${n.detail}` : '')));
}

export { fill };
