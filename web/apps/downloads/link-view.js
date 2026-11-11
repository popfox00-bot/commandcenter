// Downloads: one link's view (the Download tab's, and each queued link's), kept simple:
//   ✓ its check (one line; a warning or a refusal in full)
//   53 KB · 2:30 (its size and length)
//   ⬇️ Download (or its progress, or 💾 Save to phone once it's done)
//   six stills spread through it, each the whole picture (never played; quick, small; tap one for
//   a closer look around it)
//   ▸ More: every minute's still, all it knows (type, site, resumable, picture, codecs; a token in
//     the link, tracking removed), and ✂️ just a part of an MP4.

import { el, fill } from '../../lib/dom.js';
import { formatBytes } from '../../lib/files.js';
import { noteError } from '../../lib/diag.js';
import { minuteMarks, closerMarks, spreadMarks, formatTime, ago, KIND_NAME } from '../../tools/download/download-core.js';
import { describe } from '../../tools/download/media-info.js';
import { links, sizeAndLength } from './links.js';
import { progressBar, jobButtons, jobState, jobMessage, partPicker, verdict } from './job-ui.js';
import { drawStills } from './stills.js';

/** Paused frames (when a site doesn't let stills be drawn) load this many at a time. */
const DRAWERS = 3;

/**
 * Shows `link` in `host`; returns a function that takes it away (what it was loading stopped; the
 * stills drawn stay with the link while it's kept).
 * @param {HTMLElement} host @param {import('./links.js').Link} link @param {{ jobs: any }} o
 */
export function linkView(host, link, { jobs }) {
  const status = el('div', { class: 'dl-status' });
  const summary = el('p', { class: 'dl-summary' });
  const actions = el('div', { class: 'dl-actions' });
  const grid = el('div', { class: 'dl-grid dl-six' });
  const moreBody = el('div', { class: 'dl-more-body' });
  const more = el('details', { class: 'dl-more', hidden: true }, el('summary', { text: 'More' }), moreBody);
  const root = el('div', { class: 'dl-view' }, status, summary, actions, grid, more);
  fill(host, root);
  const view = new AbortController();
  let timer = 0;

  // ---------- its check: one line when fine ----------
  function renderStatus() {
    const c = link.check;
    clearInterval(timer);
    if (c.ok === false) { fill(status, verdict('danger', 'Not downloaded', c.reasons)); return; }
    if (link.state === 'refused') { fill(status, verdict('danger', 'Not downloaded', [{ title: link.error, detail: '' }])); return; }
    if (link.state === 'caution') {
      fill(status, verdict('caution', `Be careful with ${c.host}`, c.warnings),
        el('div', { class: 'row' },
          el('button', { class: 'btn', text: 'I trust it: continue', onclick: () => links.trust(link) }),
          el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => links.remove(link) })));
      return;
    }
    const expiry = el('span', { class: 'dl-expiry' });
    const tick = () => { expiry.textContent = c.expires ? (c.expires > Date.now() ? ` · ⏱ expires in ${ago(c.expires - Date.now())}` : ' · ⏱ expired') : ''; };
    tick(); if (c.expires) timer = setInterval(tick, 30000);
    fill(status, el('p', { class: 'dl-ok' }, el('span', { class: 'dl-ok-mark', text: '✓' }), ` Safe link · ${c.host}`, expiry));
  }

  // ---------- size · length ----------
  function renderSummary() {
    const usable = link.check.ok && !['caution', 'refused'].includes(link.state);
    summary.hidden = !usable;
    if (!usable) return;
    const sl = sizeAndLength(link);
    summary.textContent = link.state === 'asking' ? 'Checking the file…' : (sl || (link.mode ? 'Size and length not given' : 'Reading the video…'));
  }

  // ---------- Download / its progress / Save ----------
  let shown = ''; let bar = null;
  function renderActions() {
    if (!link.check.ok || ['caution', 'refused', 'asking'].includes(link.state)) { fill(actions); shown = ''; return; }
    const job = link.jobId ? jobs.get(link.jobId) : null;
    if (!job) {
      const others = jobs.running();
      const key = `none|${others}`;
      if (key === shown) return; shown = key;
      const pre = link.pre;
      const go = (after) => async () => {
        const j = await jobs.start({ url: link.check.url, host: link.check.host, kind: pre?.kind ?? null, total: pre?.total ?? 0, ranges: !!pre?.ranges, lastModified: pre?.lastModified ?? '', strict: link.strict, after });
        links.setJob(link, j.id);
      };
      fill(actions, others
        ? [el('div', { class: 'row dl-two' }, el('button', { class: 'btn primary', text: '⬇️ Download now', onclick: go(false) }), el('button', { class: 'btn', text: '⏳ After the others', onclick: go(true) })),
          el('p', { class: 'small muted dl-share-note', text: `${others === 1 ? 'Another download is' : `${others} downloads are`} going: now shares the connection (each slower).` })]
        : el('button', { class: 'btn primary block', text: '⬇️ Download', onclick: go(false) }));
      return;
    }
    const key = `job|${job.id}|${jobState(job, jobs)}`;
    if (key !== shown) {
      shown = key; bar = progressBar(jobs);
      fill(actions, bar.node,
        job.error ? el('p', { class: 'small warn-text', text: jobMessage(job) }) : null,
        el('div', { class: 'row wrap dl-btns' }, jobButtons(job, jobs)));
    }
    bar.update(job);
  }

  // ---------- stills: six spread through it, every minute under More ----------
  let tilesFor = '';
  function renderStills() {
    const usable = link.check.ok && ['ready', 'blocked'].includes(link.state) && link.meta && link.mode && link.mode !== 'none';
    const key = usable ? `${link.mode}|${link.meta.duration}` : '';
    if (key === tilesFor) return; tilesFor = key;
    if (!usable) { fill(grid); return; }
    const d = link.meta.duration;
    // Every still the whole picture, all the same size: the video's own shape.
    if (link.meta.width && link.meta.height) root.style.setProperty('--dl-ar', `${link.meta.width} / ${link.meta.height}`);
    // (A tall video's stills go three across, so the six still fit on a phone's screen.)
    grid.classList.toggle('dl-tall', link.meta.height > link.meta.width);
    const six = spreadMarks(d, 6);
    const main = six.map((m, i) => tile(m, () => closer(m.mark, i + 1 < six.length ? six[i + 1].mark : d)));
    fill(grid, main.map((t) => t.node));
    load(main);
    const marks = minuteMarks(d);
    const step = marks.length > 1 ? marks[1].mark : d;
    allTiles = marks.length > 1 ? marks.map((m) => tile(m, () => closer(m.mark, Math.min(d, m.mark + step)))) : [];
    allLoaded = false;
    renderMore();
  }
  let allTiles = []; let allLoaded = false;
  /** Stills shown: drawn (shared, kept with the link) or paused frames. */
  function load(tiles, prio = 1, signal = view.signal) {
    if (link.mode === 'drawn') {
      for (const t of tiles) if (!link.stills.has(t.m.mark)) t.pic.classList.add('loading');
      const byMark = new Map(tiles.map((t) => [t.m.mark, t]));
      drawStills(link, tiles.map((t) => t.m), { signal, prio, onStill: (m, u) => { const t = byMark.get(m.mark); if (!t) return; t.pic.classList.remove('loading'); fill(t.pic, el('img', { src: u, alt: `At ${m.label}` })); } })
        .catch((e) => { if (!signal.aborted) { noteError('Downloads: previews', e); link.mode = 'frames'; framesInstead(tiles, signal); } });
    } else framesInstead(tiles, signal);
  }

  // ---------- More ----------
  function renderMore() {
    const c = link.check;
    if (!c.ok || ['caution', 'refused'].includes(link.state)) { more.hidden = true; return; }
    more.hidden = false;
    const pre = link.pre; const d = link.details; const meta = link.meta;
    const rows = [];
    const add = (k, v) => { if (v) rows.push(el('div', { class: 'dl-kv' }, el('span', { class: 'muted', text: k }), el('span', { text: v }))); };
    add('Type', pre ? (KIND_NAME[pre.kind] ?? pre.type ?? '') : '');
    add('Size', pre?.total ? formatBytes(pre.total) : 'not given');
    add('Length', meta?.duration ? formatTime(meta.duration) : '');
    add('Picture', d ? describe(d) : meta?.width ? `${meta.width}×${meta.height}` : '');
    add('From', c.host);
    add('Resumable', pre ? (pre.ranges ? 'yes' : 'no: starts over if stopped') : 'the site doesn\'t say');
    if (link.mode === 'none') add('Stills', 'this browser can\'t show stills of it (it can still download it)');
    for (const n of c.notes ?? []) if (!n.title.startsWith('Stops')) add(n.title, n.detail);
    const partBox = el('div', { class: 'dl-partwrap' });
    const mp4 = pre?.kind === 'mp4' || pre?.kind === 'mov'; const dur = meta?.duration ?? d?.duration;
    if (mp4 && pre.ranges && pre.total && dur) {
      fill(partBox, el('p', { class: 'dl-sub', text: '✂️ Just a part' }), el('p', { class: 'muted small', text: 'Only that part (and the file\'s index) is downloaded, as an MP4 of its own.' }),
        partPicker(dur, async (from, to) => {
          const j = await jobs.start({ url: c.url, host: c.host, kind: pre.kind, total: pre.total, ranges: true, lastModified: pre.lastModified, strict: link.strict, part: { from, to }, after: jobs.running() > 0 });
          links.setJob(link, j.id);
        }, '⬇️ Download part'));
    }
    const allGrid = allTiles.length ? el('div', { class: 'dl-grid dl-all' }, allTiles.map((t) => t.node)) : null;
    fill(moreBody, el('div', { class: 'dl-kvs' }, rows), allGrid ? el('p', { class: 'dl-sub', text: `Every minute (${allTiles.length})` }) : null, allGrid, partBox);
  }
  more.addEventListener('toggle', () => { if (more.open && !allLoaded && allTiles.length) { allLoaded = true; load(allTiles); } });

  const tile = (m, onTap) => {
    const pic = el('div', { class: 'dl-pic' });
    const node = el('figure', { class: 'dl-thumb' }, pic, el('figcaption', { text: m.label }));
    if (onTap) { node.tabIndex = 0; node.setAttribute('role', 'button'); node.setAttribute('aria-label', `Closer look at ${m.label}`); node.addEventListener('click', onTap); node.addEventListener('keydown', (e) => { if (e.key === 'Enter') onTap(); }); }
    return { m, pic, node };
  };

  /** A closer look: six stills from one still to the next, in a sheet. */
  async function closer(from, to) {
    const marks = closerMarks(from, to, Math.max(2, Math.ceil((to - from) / 6)));
    const tiles = marks.map((m) => tile(m, null));
    const dlg = el('dialog', { class: 'ed-dialog dl-closer' }, el('form', { method: 'dialog', class: 'sheet' },
      el('div', { class: 'card-head' }, el('h2', { text: `${formatTime(from)} – ${formatTime(to)}` }), el('button', { class: 'icon-btn', 'aria-label': 'Close', text: '✕' })),
      el('div', { class: 'dl-grid' }, tiles.map((t) => t.node))));
    if (link.meta?.width) dlg.style.setProperty('--dl-ar', `${link.meta.width} / ${link.meta.height}`);
    const ctrl = new AbortController();
    view.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    dlg.addEventListener('close', () => { ctrl.abort(); dlg.remove(); });
    document.body.append(dlg); dlg.showModal();
    load(tiles, 2, ctrl.signal);
  }

  /** When it can't be drawn: each preview a paused video at its mark, loaded as it scrolls into view, a few at a time. */
  function framesInstead(tiles, signal) {
    let running = 0; const queue = [];
    const next = () => {
      while (running < DRAWERS && queue.length && !signal.aborted) {
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

  const render = () => { renderStatus(); renderSummary(); renderActions(); renderStills(); renderMore(); };
  const offLinks = links.subscribe((l) => { if (!l || l === link) render(); });
  const offJobs = jobs.subscribe((j) => { if (!j || j.id === link.jobId || !link.jobId) renderActions(); });
  render();

  return () => {
    view.abort(); clearInterval(timer); offLinks(); offJobs();
  };
}
