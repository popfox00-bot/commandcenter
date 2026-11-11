// Downloads: one link's view (the Download tab's, and each queued link's): its check (and what to
// know: expiry, a token, tracking removed), what the site says about the file, Download (or its
// progress, or 💾 Save to phone once it's done) above its previews (a still at its start and each
// minute, never played; tap one for every 10 seconds of that minute), and just a part of an MP4.

import { el, fill } from '../../lib/dom.js';
import { formatBytes } from '../../lib/files.js';
import { noteError } from '../../lib/diag.js';
import { minuteMarks, closerMarks, formatTime, ago, KIND_NAME, fileNameFor } from '../../tools/download/download-core.js';
import { describe } from '../../tools/download/media-info.js';
import { links } from './links.js';
import { progressBar, jobButtons, jobState, jobMessage, partPicker, verdict } from './job-ui.js';

const THUMB_W = 320;

/**
 * Shows `link` in `host`; returns a function that takes it away (what it was loading stopped; the
 * stills drawn stay with the link while it's kept).
 * @param {HTMLElement} host @param {import('./links.js').Link} link @param {{ jobs: any }} o
 */
export function linkView(host, link, { jobs }) {
  const status = el('div', { class: 'dl-status' });
  const info = el('div', { class: 'dl-info' });
  const actions = el('div', { class: 'dl-actions' });
  const part = el('div', { class: 'dl-partwrap' });
  const grid = el('div', { class: 'dl-grid' });
  const root = el('div', { class: 'dl-view' }, status, info, actions, part, grid);
  fill(host, root);
  const view = new AbortController();
  let probe = null; let previewsStarted = false; let timer = 0;

  // ---------- its check ----------
  function renderStatus() {
    const c = link.check;
    if (c.ok === false) { fill(status, verdict('danger', 'Not downloaded', c.reasons)); return; }
    if (link.state === 'refused') { fill(status, verdict('danger', 'Not downloaded', [{ title: link.error, detail: '' }]), notes(c)); return; }
    if (link.state === 'caution') {
      fill(status, verdict('caution', `Be careful with ${c.host}`, c.warnings), notes(c),
        el('div', { class: 'row' },
          el('button', { class: 'btn', text: 'I trust it: continue', onclick: () => links.trust(link) }),
          el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => links.remove(link) })));
      return;
    }
    fill(status, verdict('ok', `No warning signs: ${c.host}`, []), notes(c));
  }
  /** What else to know about the link: when it expires (kept up to date), a token in it, tracking removed. */
  function notes(c) {
    if (!c.notes?.length) return null;
    clearInterval(timer);
    if (c.expires) timer = setInterval(() => { const n = status.querySelector('.dl-expiry b'); if (n) n.textContent = c.expires > Date.now() ? `Stops working in ${ago(c.expires - Date.now())}` : 'This link has expired'; }, 30000);
    return el('ul', { class: 'dl-notes small' }, ...c.notes.map((n) => el('li', { class: n.title.startsWith('Stops') ? 'dl-expiry' : '' }, el('b', { text: n.title }), ` — ${n.detail}`)));
  }

  // ---------- what the site says ----------
  function renderInfo() {
    if (!link.check.ok || link.state === 'caution' || link.state === 'refused') { fill(info); return; }
    if (link.state === 'asking') { fill(info, el('p', { class: 'muted small', text: 'Asking the site about the file…' })); return; }
    const pre = link.pre; const d = link.details;
    const facts = pre ? el('p', { class: 'dl-facts' }, el('strong', { text: `${KIND_NAME[pre.kind] ?? (pre.type || 'Video')} · ${pre.total ? formatBytes(pre.total) : 'size not given'}` }), ` · from ${link.check.host}${pre.ranges ? ' · can be resumed' : ' · can\'t be resumed (starts over if stopped)'}`, d ? el('br') : null, d ? el('span', { class: 'small', text: describe(d) }) : null)
      : el('p', { class: 'muted small', text: 'The site doesn\'t answer questions about the file (it may only let its own pages use it).' });
    const meta = link.meta;
    const len = meta ? el('p', { class: 'dl-meta' }, el('strong', { text: formatTime(meta.duration) }), ` long${meta.width ? ` · ${meta.width}×${meta.height}` : ''}`) : null;
    const tip = link.mode === 'none' ? el('p', { class: 'muted small', text: meta ? 'This browser can\'t show stills of this video (its format), but it can download it.' : 'This phone can\'t show previews of it (the site may not allow it, or it isn\'t a video this browser plays). You can still try downloading it.' })
      : link.mode ? el('p', { class: 'muted small', text: 'Tap a still for every 10 seconds of that minute.' }) : el('p', { class: 'muted small', text: 'Reading the video…' });
    fill(info, facts, len, tip);
  }

  // ---------- Download / its progress / Save ----------
  let shown = ''; let bar = null;
  function renderActions() {
    if (!link.check.ok || ['caution', 'refused', 'asking'].includes(link.state)) { fill(actions); fill(part); shown = ''; return; }
    const job = link.jobId ? jobs.get(link.jobId) : null;
    if (!job) {
      const key = `none|${jobs.running()}`;
      if (key === shown) return; shown = key;
      const pre = link.pre; const size = pre?.total ? ` (${formatBytes(pre.total)})` : '';
      const go = (wait) => async () => {
        const j = await jobs.start({ url: link.check.url, host: link.check.host, kind: pre?.kind ?? null, total: pre?.total ?? 0, ranges: !!pre?.ranges, lastModified: pre?.lastModified ?? '', strict: link.strict, wait });
        links.setJob(link, j.id);
      };
      const others = jobs.running();
      fill(actions, others
        ? [el('p', { class: 'small dl-share-note', text: `${others === 1 ? 'Another download is' : `${others} other downloads are`} going: downloading this now shares the connection, so each goes slower.` }),
          el('div', { class: 'row wrap' }, el('button', { class: 'btn primary', text: `⬇️ Download now${size}`, onclick: go(false) }), el('button', { class: 'btn', text: '⏳ When the others finish', onclick: go(true) }))]
        : el('button', { class: 'btn primary block', text: `⬇️ Download${size}`, onclick: go(false) }));
      renderPart();
      return;
    }
    const key = `job|${job.id}|${jobState(job, jobs)}`;
    if (key !== shown) {
      shown = key; bar = progressBar(jobs);
      fill(actions,
        job.status === 'done' ? el('p', { class: 'dl-file' }, el('strong', { text: job.name }), ` · ${formatBytes(job.loaded)}${job.details ? ` · ${job.details}` : ''}`) : null,
        bar.node,
        job.error ? el('p', { class: 'small warn-text', text: jobMessage(job) }) : null,
        el('div', { class: 'row wrap dl-btns' }, jobButtons(job, jobs)),
        job.status === 'done' ? el('p', { class: 'muted small', text: 'On iPhone, pick "Save Video" for Photos or "Save to Files". It\'s also in History.' }) : null);
      renderPart();
    }
    bar.update(job);
  }
  function renderPart() {
    const pre = link.pre; const dur = link.meta?.duration ?? link.details?.duration;
    const mp4 = pre?.kind === 'mp4' || pre?.kind === 'mov';
    if (!mp4 || part.childElementCount) { if (!mp4) fill(part); return; }
    if (pre.ranges && pre.total && dur) {
      fill(part, el('details', { class: 'dl-partbox' }, el('summary', { text: '✂️ Download just a part' }),
        el('p', { class: 'muted small', text: 'Only that part is downloaded (and the file\'s index), saved as an MP4 of its own.' }),
        partPicker(dur, async (from, to) => {
          const j = await jobs.start({ url: link.check.url, host: link.check.host, kind: pre.kind, total: pre.total, ranges: true, lastModified: pre.lastModified, strict: link.strict, part: { from, to }, wait: jobs.running() > 0 && !confirm('Another download is going: downloading this part now shares the connection, so each goes slower. OK = now, Cancel = when the others finish.') });
          links.setJob(link, j.id);
        }, '⬇️ Download part')));
    } else fill(part, el('p', { class: 'muted small', text: 'This site doesn\'t send parts of the file, so to keep just a part, download it all and use ✂️ Save a part in History.' }));
  }

  // ---------- previews ----------
  async function startPreviews() {
    if (previewsStarted || !link.check.ok || !['ready', 'blocked'].includes(link.state)) return;
    previewsStarted = true;
    if (!link.mode) {
      const meta = await probeIt();
      if (view.signal.aborted) return;
      link.meta = meta ?? (link.details?.duration ? { duration: link.details.duration, width: link.details.width, height: link.details.height } : null);
      if (!meta) link.mode = 'none';
      renderInfo(); renderActions();
    }
    if (link.mode === 'none' || !link.meta) return;
    const marks = minuteMarks(link.meta.duration);
    const step = marks.length > 1 ? marks[1].mark : link.meta.duration;
    const tiles = marks.map((m) => tile(m, () => closer(m.mark, Math.min(link.meta.duration, m.mark + step))));
    fill(grid, tiles.map((t) => t.node));
    if (link.mode === 'drawn') {
      const todo = tiles.filter((t) => !link.stills.has(t.m.mark));
      for (const t of tiles) if (link.stills.has(t.m.mark)) fill(t.pic, el('img', { src: link.stills.get(t.m.mark), alt: `At ${t.m.label}`, loading: 'lazy' }));
      if (!todo.length) return;
      if (!probe) { probe = video(link.check.url, true); if (!await loaded(probe, view.signal)) return; }
      drawStills(probe, todo, view.signal, (m, u) => link.stills.set(m.mark, u)).catch((e) => { if (!view.signal.aborted) { noteError('Downloads: previews', e); link.mode = 'frames'; framesInstead(tiles, view.signal); } });
    } else framesInstead(tiles, view.signal);
  }

  /**
   * Its length and size, from a video element that loads only what it needs (not played, muted).
   * First as an app may draw it (the site allows that: previews are stills drawn here); else as the
   * browser shows it (previews are paused frames instead).
   */
  async function probeIt() {
    for (const drawable of [true, false]) {
      const v = video(link.check.url, drawable);
      const ok = await loaded(v, view.signal);
      if (view.signal.aborted) { v.remove(); return null; }
      if (ok && Number.isFinite(v.duration) && v.duration > 0) {
        link.mode = drawable ? 'drawn' : 'frames';
        if (drawable) probe = v; else v.remove();
        return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
      }
      v.remove();
    }
    return null;
  }

  function video(src, drawable) {
    const v = /** @type {HTMLVideoElement} */ (el('video', { class: 'dl-probe', muted: true, playsinline: true, preload: 'metadata', 'aria-hidden': 'true' }));
    v.muted = true; v.disablePictureInPicture = true;
    if (drawable) v.crossOrigin = 'anonymous';
    v.src = src;
    root.append(v);
    return v;
  }

  const tile = (m, onTap) => {
    const pic = el('div', { class: 'dl-pic' });
    const node = el('figure', { class: 'dl-thumb' }, pic, el('figcaption', { text: m.label }));
    if (onTap) { node.tabIndex = 0; node.setAttribute('role', 'button'); node.setAttribute('aria-label', `Closer look at ${m.label}`); node.addEventListener('click', onTap); node.addEventListener('keydown', (e) => { if (e.key === 'Enter') onTap(); }); }
    return { m, pic, node };
  };

  /** A closer look: every 10 seconds from one mark to the next, in a sheet. */
  async function closer(from, to) {
    const marks = closerMarks(from, to, to - from > 60 ? Math.ceil((to - from) / 6) : 10);
    const tiles = marks.map((m) => tile(m, null));
    const dlg = el('dialog', { class: 'ed-dialog dl-closer' }, el('form', { method: 'dialog', class: 'sheet' },
      el('div', { class: 'card-head' }, el('h2', { text: `${formatTime(from)} – ${formatTime(to)}` }), el('button', { class: 'icon-btn', 'aria-label': 'Close', text: '✕' })),
      el('div', { class: 'dl-grid' }, tiles.map((t) => t.node))));
    const ctrl = new AbortController();
    view.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    const urls = [];
    dlg.addEventListener('close', () => { ctrl.abort(); dlg.remove(); for (const u of urls) URL.revokeObjectURL(u); });
    document.body.append(dlg); dlg.showModal();
    if (link.mode === 'drawn') {
      const v = video(link.check.url, true);
      try { if (await loaded(v, ctrl.signal)) await drawStills(v, tiles, ctrl.signal, (m, u) => urls.push(u)); } catch { if (!ctrl.signal.aborted) framesInstead(tiles, ctrl.signal); } finally { v.remove(); }
    } else framesInstead(tiles, ctrl.signal);
  }

  /** Each preview drawn from one video element, a mark at a time. */
  async function drawStills(v, tiles, signal, keep) {
    const k = Math.min(1, THUMB_W / (v.videoWidth || THUMB_W));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((v.videoWidth || THUMB_W) * k)); c.height = Math.max(1, Math.round((v.videoHeight || THUMB_W * 0.5625) * k));
    const g = c.getContext('2d');
    for (const t of tiles) {
      if (signal.aborted) return;
      t.pic.classList.add('loading');
      await seek(v, t.m.at, signal);
      g.drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); // throws if the site didn't allow drawing
      if (signal.aborted || !blob) return;
      const u = URL.createObjectURL(blob); keep(t.m, u);
      t.pic.classList.remove('loading');
      fill(t.pic, el('img', { src: u, alt: `At ${t.m.label}`, loading: 'lazy' }));
    }
  }

  /** When it can't be drawn: each preview a paused video at its mark, loaded as it scrolls into view, a few at a time. */
  function framesInstead(tiles, signal) {
    let running = 0; const queue = [];
    const next = () => {
      while (running < 2 && queue.length && !signal.aborted) {
        const t = queue.shift(); running++;
        const v = /** @type {HTMLVideoElement} */ (el('video', { muted: true, playsinline: true, preload: 'metadata', 'aria-label': `At ${t.m.label}` }));
        v.muted = true; v.disablePictureInPicture = true;
        const done = () => { clearTimeout(tm); running--; t.pic.classList.remove('loading'); next(); };
        const tm = setTimeout(done, 15000);
        v.addEventListener('loadeddata', done, { once: true });
        v.addEventListener('error', done, { once: true });
        v.src = `${link.check.url}#t=${t.m.at}`;
        t.pic.classList.add('loading');
        fill(t.pic, v);
      }
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); queue.push(tiles.find((t) => t.node === e.target)); }
      next();
    }, { rootMargin: '200px' });
    for (const t of tiles) io.observe(t.node);
    signal.addEventListener('abort', () => { io.disconnect(); for (const t of tiles) t.pic.querySelector('video')?.removeAttribute('src'); }, { once: true });
  }

  const render = () => { renderStatus(); renderInfo(); renderActions(); startPreviews(); };
  const offLinks = links.subscribe((l) => { if (!l || l === link) render(); });
  const offJobs = jobs.subscribe((j) => { if (!j || j.id === link.jobId || !link.jobId) renderActions(); });
  render();

  return () => {
    view.abort(); clearInterval(timer); offLinks(); offJobs();
    probe?.removeAttribute('src'); probe?.remove();
  };
}

/** Whether the video's details load (or it fails, or it's stopped). */
function loaded(v, signal) {
  return new Promise((resolve) => {
    const done = (r) => { clearTimeout(t); resolve(r); };
    const t = setTimeout(() => done(false), 20000);
    v.addEventListener('loadedmetadata', () => done(true), { once: true });
    v.addEventListener('error', () => done(false), { once: true });
    signal.addEventListener('abort', () => done(false), { once: true });
  });
}

/** Seeks the (paused) video to `t` and waits for that frame. */
function seek(v, t, signal) {
  return new Promise((resolve, reject) => {
    const done = (ok) => { clearTimeout(timer); v.removeEventListener('seeked', onSeeked); ok ? resolve() : reject(new Error('seek timed out')); };
    const onSeeked = () => done(true);
    const timer = setTimeout(() => done(false), 20000);
    v.addEventListener('seeked', onSeeked);
    signal.addEventListener('abort', () => done(false), { once: true });
    v.currentTime = Math.min(t, Math.max(0, (v.duration || t) - 0.1));
  });
}

export { fileNameFor };
