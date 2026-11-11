// Downloads app: a video from a link (a CDN address that plays in the browser), with tabs:
// - Download: paste a link (📋 Paste, or press and hold in the box): it's checked at once (no button
//   to press), the site asked about the file, and its view shown (Download / Save to phone above the
//   stills). "+ Add to Queue" puts it in the queue (still checking there) and clears the box for the
//   next one.
// - Queue: every link added, with its state and, while downloading, its progress bar; tap one for
//   its view. "Download all" one after another.
// - History: the downloads kept on the phone (history.js).
// Routes: #/downloads, #/downloads/queue(/<id>), #/downloads/history.
// The one app that needs a connection. Only the video at a link is fetched, straight from its site:
// no other server, no cookies or sign-ins sent. Links pasted and the queue are kept in memory only
// (never written to the phone); a link cleared or removed is gone.

import { el, fill, store as ls } from '../../lib/dom.js';
import { formatBytes } from '../../lib/files.js';
import { linkFromText, KIND_NAME } from '../../tools/download/download-core.js';
import { getJobs } from '../../tools/download/download-jobs.js';
import { links } from './links.js';
import { linkView } from './link-view.js';
import { historyView } from './history.js';
import { progressBar } from './job-ui.js';

const STRICT_KEY = 'cc.download.strict';
const TABS = [['download', 'Download'], ['queue', 'Queue'], ['history', 'History']];

export function mount(host) {
  const jobs = getJobs();
  const bar = el('div', { class: 'chips studio-tabs dl-tabs', role: 'tablist', 'aria-label': 'Downloads' });
  const panes = { download: el('section', { class: 'dl-pane' }), queue: el('section', { class: 'dl-pane', hidden: true }), history: el('section', { class: 'dl-pane', hidden: true }) };
  host.append(bar, panes.download, panes.queue, panes.history);
  const offs = [];

  // ---------- Download ----------
  const input = el('input', { type: 'url', class: 'dl-url', placeholder: 'Paste a video link (https://…/video.mp4)', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Video link' });
  const clearBtn = el('button', { class: 'dl-clear', type: 'button', 'aria-label': 'Clear the link', title: 'Clear the link and start again', text: '✕', hidden: true });
  const pasteBtn = el('button', { class: 'btn primary dl-paste', type: 'button', text: '📋 Paste' });
  const pasteHint = el('p', { class: 'small muted dl-paste-hint', hidden: true });
  const strict = el('input', { type: 'checkbox', checked: ls.get(STRICT_KEY) === '1' });
  strict.addEventListener('change', () => ls.set(STRICT_KEY, strict.checked ? '1' : '0'));
  const queueRow = el('div', { class: 'row wrap dl-queue-row' });
  const viewHost = el('div', { class: 'dl-current' });
  fill(panes.download,
    el('p', { class: 'muted small', text: 'Paste the address of a video that plays in the browser (ending in .mp4, .webm, .mov…). It\'s checked as soon as it\'s in. It isn\'t played: you see a still from each minute, then download all of it or a part.' }),
    el('div', { class: 'row dl-row' }, el('div', { class: 'dl-field' }, input, clearBtn), pasteBtn),
    pasteHint,
    el('label', { class: 'dl-strict small' }, strict, ' Only accept files the site labels as video'),
    queueRow, viewHost,
    el('p', { class: 'muted small privacy', text: 'Needs a connection. Only the video at the link is downloaded, straight from its site to this phone: no other server, no cookies or sign-ins sent, nothing from its web page runs. Links that aren\'t https, point inside your own network, have expired or look like a scam aren\'t opened. Links you paste (and the queue) aren\'t saved: clearing one forgets it.' }));

  let closeView = null; let shownId = '';
  function renderCurrent() {
    const cur = links.current();
    clearBtn.hidden = !input.value && !cur;
    const q = links.queue().length;
    fill(queueRow,
      cur && cur.check.ok && cur.state !== 'refused' ? el('button', { class: 'btn', text: '+ Add to Queue', title: 'Keep this one checking in the queue, and paste another', onclick: () => { links.enqueue(); input.value = ''; lastChecked = ''; renderCurrent(); flash(`Added to the queue (${links.queue().length}). Paste the next link.`); input.focus(); } }) : null,
      q ? el('a', { class: 'btn ghost', href: '#/downloads/queue', text: `View Queue (${q})` }) : null);
    if ((cur?.id ?? '') === shownId) return;
    closeView?.(); closeView = null; shownId = cur?.id ?? '';
    if (cur) closeView = linkView(viewHost, cur, { jobs }); else fill(viewHost);
  }
  const flashBox = el('p', { class: 'small ok-text dl-flash', hidden: true });
  queueRow.before(flashBox);
  let flashT = 0;
  const flash = (t) => { flashBox.textContent = t; flashBox.hidden = false; clearTimeout(flashT); flashT = setTimeout(() => { flashBox.hidden = true; }, 4000); };

  // Checked as soon as it's in: pasted, typed (once typing stops), or Enter.
  let lastChecked = '';
  const check = () => {
    const v = linkFromText(input.value);
    if (v !== input.value) input.value = v;
    if (!v) { links.close(); lastChecked = ''; renderCurrent(); return; }
    if (v === lastChecked && links.current()) return;
    lastChecked = v;
    const l = links.open(v, { strict: strict.checked });
    if (l.check.ok) { input.value = l.check.url; lastChecked = input.value; }
    pasteHint.hidden = true;
    renderCurrent();
  };
  let typing = 0;
  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value && !links.current();
    clearTimeout(typing);
    if (!input.value) { check(); return; }
    if (/^\S+\.\S+$/.test(input.value.trim())) typing = setTimeout(check, 900);
  });
  input.addEventListener('paste', () => setTimeout(check, 0));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(typing); check(); } });
  // ✕: the link and all that was shown for it gone (and forgotten), ready for another.
  clearBtn.addEventListener('click', () => { input.value = ''; lastChecked = ''; links.close(); pasteHint.hidden = true; renderCurrent(); input.focus(); });
  // 📋 Paste: what was copied, its link picked out of any text around it, then checked. An iPhone asks
  // first with a small "Paste" bubble by the button; some browsers won't hand it over at all.
  pasteBtn.addEventListener('click', async () => {
    pasteHint.textContent = 'If a small "Paste" bubble pops up by the button, tap it.';
    pasteHint.hidden = false;
    let text = '';
    try { text = (await navigator.clipboard?.readText?.()) ?? ''; } catch { /* not allowed, or the bubble dismissed */ }
    if (!text) {
      try {
        for (const item of (await navigator.clipboard?.read?.()) ?? []) {
          const type = item.types.find((t) => t === 'text/plain' || t === 'text/uri-list');
          if (type) { text = await (await item.getType(type)).text(); break; }
        }
      } catch { /* not allowed */ }
    }
    if (linkFromText(text)) { input.value = linkFromText(text); check(); return; }
    pasteHint.textContent = 'This browser didn\'t hand over what you copied. Press and hold in the box above and tap Paste: it\'s checked as soon as it\'s in.';
    input.focus(); input.select();
  });

  // ---------- Queue ----------
  const queueList = el('div', { class: 'dl-qlist' });
  const queueHead = el('div', { class: 'row wrap dl-qhead' });
  const queueItem = el('div', { class: 'dl-qitem', hidden: true });
  fill(panes.queue, queueHead, queueList, queueItem);
  let closeItem = null; let itemId = '';
  const rows = new Map(); // link id -> { node, update }

  const stateText = (l) => {
    if (!l.check.ok) return l.check.reasons[0].title;
    return { refused: `Not downloaded: ${l.error}`, caution: 'Has warnings: tap to read them', asking: 'Checking…', blocked: 'Checked · the site doesn\'t say its size', ready: `Checked · ${KIND_NAME[l.pre?.kind] ?? 'Video'}${l.pre?.total ? ` · ${formatBytes(l.pre.total)}` : ''}` }[l.state];
  };
  function row(l) {
    const title = el('strong', { class: 'dl-name' });
    const sub = el('span', { class: 'small muted' });
    const pb = progressBar(jobs);
    const x = el('button', { class: 'icon-btn dl-x', 'aria-label': 'Remove from the queue', title: 'Remove from the queue (a download already started stays in History)', text: '✕' });
    x.addEventListener('click', (e) => { e.stopPropagation(); links.remove(l); });
    const node = el('article', { class: `card dl-qrow`, role: 'button', tabIndex: 0 }, el('div', { class: 'card-head' }, el('div', { class: 'dl-title' }, title, sub), x), pb.node);
    const open = () => { location.hash = `#/downloads/queue/${l.id}`; };
    node.addEventListener('click', open); node.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    const update = () => {
      const job = l.jobId ? jobs.get(l.jobId) : null;
      title.textContent = job?.name ?? links.name(l);
      sub.textContent = job ? (job.status === 'done' ? `Downloaded · ${formatBytes(job.loaded)} · tap to save` : job.error || { running: 'Downloading', waiting: 'Waiting for the others to finish', paused: 'Paused' }[job.status] || '') : stateText(l);
      sub.className = `small ${!l.check.ok || l.state === 'refused' || job?.error ? 'warn-text' : 'muted'}`;
      pb.node.hidden = !job || job.status === 'done';
      if (job) pb.update(job);
      node.classList.toggle('dl-bad', !l.check.ok || l.state === 'refused');
    };
    return { node, update };
  }
  function renderQueue() {
    const q = links.queue();
    for (const id of [...rows.keys()]) if (!q.some((l) => l.id === id)) rows.delete(id);
    const ready = q.filter((l) => !l.jobId && (l.state === 'ready' || l.state === 'blocked'));
    const going = q.filter((l) => l.jobId && jobs.get(l.jobId)?.status === 'running').length;
    fill(queueHead,
      el('h3', { class: 'dl-list-head', text: q.length ? `${q.length} link${q.length === 1 ? '' : 's'} queued${going ? ` · ${going} downloading` : ''}` : 'Queue' }),
      ready.length ? el('button', { class: 'btn primary small-btn', text: `⬇️ Download all ${ready.length} (one after another)`, onclick: async () => {
        for (const l of ready) {
          const pre = l.pre;
          const j = await jobs.start({ url: l.check.url, host: l.check.host, kind: pre?.kind ?? null, total: pre?.total ?? 0, ranges: !!pre?.ranges, lastModified: pre?.lastModified ?? '', strict: l.strict, wait: true });
          links.setJob(l, j.id);
        }
      } }) : null,
      el('a', { class: 'btn ghost small-btn', href: '#/downloads', text: '+ Add links' }));
    fill(queueList, q.length ? q.map((l) => (rows.get(l.id) ?? rows.set(l.id, row(l)).get(l.id)).node) : el('p', { class: 'muted small', text: 'Nothing queued. On Download, paste a link and tap + Add to Queue, then paste the next.' }));
    for (const l of q) rows.get(l.id).update();
    if (going > 1) queueList.prepend(el('p', { class: 'small muted', text: `${going} downloads share the connection, so each goes slower than one alone would.` }));
  }
  function showQueueItem(id) {
    const l = id ? links.get(id) : null;
    if ((l?.id ?? '') === itemId) return;
    closeItem?.(); closeItem = null; itemId = l?.id ?? '';
    queueItem.hidden = !l; queueHead.hidden = !!l; queueList.hidden = !!l;
    if (!l) { fill(queueItem); return; }
    const inner = el('div');
    fill(queueItem, el('a', { class: 'btn ghost small-btn dl-back', href: '#/downloads/queue', text: '‹ Queue' }), el('p', { class: 'dl-qurl small muted', text: l.check.ok ? l.check.url : l.input }), inner);
    closeItem = linkView(inner, l, { jobs });
  }

  // ---------- History ----------
  offs.push(historyView(panes.history, { jobs, onAgain: (url) => { location.hash = '#/downloads'; input.value = url; lastChecked = ''; check(); } }));

  // ---------- tabs ----------
  function route() {
    const [, , tab = 'download', id = ''] = location.hash.split('/');
    const t = TABS.some(([k]) => k === tab) ? tab : 'download';
    const q = links.queue().length;
    fill(bar, TABS.map(([k, label]) => el('a', { class: `chip${k === t ? ' active' : ''}`, role: 'tab', 'aria-selected': String(k === t), href: k === 'download' ? '#/downloads' : `#/downloads/${k}`, text: k === 'queue' && q ? `${label} (${q})` : label })));
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== t;
    if (t === 'queue') { renderQueue(); showQueueItem(id && links.get(id) ? id : ''); if (id && !links.get(id)) location.hash = '#/downloads/queue'; } else showQueueItem('');
  }
  const onHash = () => { if (/^#\/downloads(\/|$)/.test(location.hash)) route(); };
  window.addEventListener('hashchange', onHash);
  offs.push(links.subscribe((l) => {
    renderCurrent();
    if (!l) { route(); return; }
    rows.get(l.id)?.update();
  }));
  offs.push(jobs.subscribe((j) => {
    if (!j) { renderQueue(); return; }
    for (const l of links.queue()) if (l.jobId === j.id) rows.get(l.id)?.update();
  }));
  // Coming back to the app: the link being looked at is still here (this visit only).
  const cur = links.current(); if (cur) { input.value = cur.check.ok ? cur.check.url : cur.input; lastChecked = input.value; }
  renderCurrent();
  route();

  return () => {
    window.removeEventListener('hashchange', onHash);
    closeView?.(); closeItem?.();
    for (const f of offs) f();
    clearTimeout(typing); clearTimeout(flashT);
  };
}
