// Downloads → History: every download kept on the phone (stored piece by piece; pause, continue,
// carries on after the app was closed), each with its progress or its fingerprint and details,
// 💾 Save to phone, ✂️ Save a part (an MP4, cut on the phone), ⟳ Download again, and ✕ to remove it.
// 🗑 Clear all removes every one. Removing deletes the download's record and file: nothing of it,
// the link included, is kept anywhere.

import { el, fill } from '../../lib/dom.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes } from '../../lib/files.js';
import { noteError } from '../../lib/diag.js';
import { formatTime, fileNameFor } from '../../tools/download/download-core.js';
import { planPart } from '../../tools/download/mp4.js';
import { blobSource } from '../../tools/download/media-info.js';
import { progressBar, jobButtons, jobState, jobMessage, fingerprint, partPicker } from './job-ui.js';

/** @param {HTMLElement} host @param {{ jobs: any, onAgain: (url: string) => void }} o */
export function historyView(host, { jobs, onAgain }) {
  const head = el('div', { class: 'row dl-hist-head' });
  const list = el('div', { class: 'dl-list' });
  const note = el('p', { class: 'muted small', hidden: true, text: 'Storage isn\'t available here (a private window?): downloads only last until the app is closed.' });
  fill(host, head, note, list,
    el('p', { class: 'muted small privacy', text: 'Downloads stay on this phone, in this app, until you remove them (✕ or Clear all): that deletes the file and its link. Nothing is sent anywhere.' }));
  jobs.memoryOnly().then((m) => { note.hidden = !m; });
  const cards = new Map();

  function renderHead() {
    const n = jobs.list().length;
    fill(head, el('h3', { class: 'dl-list-head', text: n ? `${n} download${n === 1 ? '' : 's'} · ${formatBytes(jobs.used())} on this phone` : 'History' }),
      n ? el('button', { class: 'btn ghost small-btn', text: '🗑 Clear all', onclick: async () => { if (confirm(`Remove all ${n} downloads? Their files are deleted from this phone.`)) await jobs.clearAll(); } }) : null);
  }
  function render() {
    const all = jobs.list();
    renderHead();
    for (const id of [...cards.keys()]) if (!all.some((j) => j.id === id)) cards.delete(id);
    fill(list, all.length ? all.map((j) => (cards.get(j.id) ?? card(j)).node) : el('p', { class: 'muted small', text: 'Nothing downloaded yet.' }));
    for (const j of all) cards.get(j.id).update();
  }

  function card(job) {
    const name = el('strong', { class: 'dl-name' });
    const sub = el('span', { class: 'muted small' });
    const bar = progressBar(jobs);
    const msg = el('p', { class: 'small warn-text' });
    const details = el('p', { class: 'small dl-details' });
    const fp = el('div', { class: 'dl-fp' });
    const btns = el('div', { class: 'row wrap dl-btns' });
    const extra = el('div', { class: 'dl-extra' });
    const remove = el('button', { class: 'icon-btn dl-x', 'aria-label': `Remove ${job.name}`, title: 'Remove', text: '✕' });
    remove.addEventListener('click', async () => {
      if (job.status === 'done' || confirm(`Remove "${job.name}"? What's downloaded so far is deleted.`)) await jobs.remove(job);
    });
    const node = el('article', { class: 'card dl-card' }, el('div', { class: 'card-head' }, el('div', { class: 'dl-title' }, name, sub), remove), bar.node, msg, details, fp, btns, extra);
    let shown = '';
    const update = () => {
      name.textContent = job.name;
      sub.textContent = `${job.host} · ${new Date(job.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${job.part ? ' · a part' : ''}`;
      bar.update(job);
      const m = jobMessage(job); msg.hidden = !m; msg.textContent = m;
      const done = job.status === 'done';
      details.hidden = !done; details.textContent = done ? `${formatBytes(job.loaded)}${job.details ? ` · ${job.details}` : ''}` : '';
      const state = jobState(job, jobs);
      if (state === shown) return; shown = state;
      const more = [];
      if (done && (job.kind === 'mp4' || job.kind === 'mov') && !job.part) more.push(el('button', { class: 'btn', text: '✂️ Save a part', onclick: () => partFromFile(job, extra) }));
      if (done || job.status === 'failed') more.push(el('button', { class: 'btn ghost', text: '⟳ Download again', onclick: () => onAgain(job.url) }));
      fill(btns, jobButtons(job, jobs, { extra: more }));
      fill(fp, done && job.hash ? fingerprint(job.hash) : null);
    };
    const c = { node, update }; cards.set(job.id, c);
    return c;
  }

  /** A part of a downloaded MP4, cut on the phone (nothing downloaded again). */
  async function partFromFile(job, box) {
    if (box.childElementCount) { fill(box); return; }
    const f = await jobs.file(job);
    fill(box, partPicker(job.duration ?? 0, async (from, to) => {
      try {
        const plan = await planPart(blobSource(f), from, to);
        const out = new File([plan.head, ...plan.ranges.map((r) => f.slice(r.offset, r.offset + r.length))], fileNameFor(job.url, 'mp4', ` (${formatTime(plan.start).replace(/:/g, '.')}–${formatTime(plan.end).replace(/:/g, '.')})`), { type: 'video/mp4' });
        if (canShareFiles([out]) && await shareFiles([out], out.name)) return;
        downloadBlob(out, out.name);
      } catch (e) { noteError('Downloads: part (file)', e); alert(e.message); }
    }, '💾 Save this part'));
  }

  const off = jobs.subscribe((j) => { if (!j) render(); else { cards.get(j.id)?.update(); renderHead(); } });
  jobs.ready.then(render);
  render();
  return () => off();
}
