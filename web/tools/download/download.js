// Files → Download: paste a link to a video (a CDN address that plays in the browser). The link is
// checked first (download-core: https only, not a scam or a device at home, not expired; tracking
// taken off; a token in it pointed out); the site is asked the file's size and type without
// downloading it; then a still from its start and each minute mark is shown (tap one for every 10
// seconds of that minute), without playing it. Download the whole file, or just a part of an MP4.
// Downloads go in the list below: stored on the phone piece by piece (pause, continue, carry on
// after the app was closed), each with its fingerprint, its details, Save, and × to remove.
// The one part of Files that needs a connection. Only the video at the link is fetched, straight from
// its site: no cookies or sign-ins sent, no other server in between, nothing from its page runs.

import { el, fill, store as ls } from '../../lib/dom.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes } from '../../lib/files.js';
import { noteError } from '../../lib/diag.js';
import { sameFingerprint } from '../../lib/sha256.js';
import { checkVideoLink, linkFromText, minuteMarks, closerMarks, formatTime, preflight, ago, DownloadError, KIND_NAME, fileNameFor, remoteSource } from './download-core.js';
import { createJobs } from './download-jobs.js';
import { planPart, mp4Details } from './mp4.js';
import { blobSource, describe } from './media-info.js';

const THUMB_W = 320;
const STRICT_KEY = 'cc.download.strict';

export function mount(host) {
  const root = el('div', { class: 'dl' });
  host.append(root);

  const input = el('input', { type: 'url', class: 'dl-url', placeholder: 'https://…/video.mp4', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Video link' });
  const checkBtn = el('button', { class: 'btn primary', text: 'Check link' });
  const pasteBtn = el('button', { class: 'btn', text: 'Paste' });
  const clearBtn = el('button', { class: 'dl-clear', type: 'button', 'aria-label': 'Clear the link', title: 'Clear the link and start again', text: '✕', hidden: true });
  const field = el('div', { class: 'dl-field' }, input, clearBtn);
  const pasteHint = el('p', { class: 'small muted dl-paste-hint', hidden: true, text: 'This browser didn\'t hand over what you copied. Press and hold in the box and tap Paste: it\'s checked as soon as it\'s in.' });
  const strict = el('input', { type: 'checkbox', checked: ls.get(STRICT_KEY) === '1' });
  strict.addEventListener('change', () => ls.set(STRICT_KEY, strict.checked ? '1' : '0'));
  const status = el('div', { class: 'dl-status' });
  const info = el('div', { class: 'dl-info' });
  const grid = el('div', { class: 'dl-grid' });
  const actions = el('div', { class: 'dl-actions' });
  const listHead = el('h3', { class: 'dl-list-head', text: 'Downloads' });
  const list = el('div', { class: 'dl-list' });
  root.append(
    el('h3', { text: 'Download a video' }),
    el('p', { class: 'muted small', text: 'Paste the address of a video that plays in the browser (ending in .mp4, .webm, .mov…). It isn\'t played: you see a still from each minute, then download all of it or a part.' }),
    el('div', { class: 'row dl-row' }, field, pasteBtn, checkBtn),
    pasteHint,
    el('label', { class: 'dl-strict small' }, strict, ' Only accept files the site labels as video'),
    status, info, grid, actions, listHead, list,
    el('p', { class: 'muted small privacy', text: 'Needs a connection. Only the video at the link is downloaded, straight from its site to this phone: no other server, no cookies or sign-ins sent, nothing from its web page runs. Links that aren\'t https, point inside your own network, have expired or look like a scam aren\'t opened. Downloads stay on this phone until you remove them (×).' }),
  );

  // ---------- the downloads ----------
  const cards = new Map(); // job id -> { node, update }
  const jobs = createJobs({
    onChange: (job) => {
      if (!job) { renderList(); return; }
      cards.get(job.id)?.update();
      listHead.textContent = headText();
    },
  });
  const headText = () => { const n = jobs.list().length; return n ? `Downloads · ${formatBytes(jobs.used())} on this phone` : 'Downloads'; };
  function renderList() {
    const all = jobs.list();
    listHead.textContent = headText();
    for (const id of [...cards.keys()]) if (!all.some((j) => j.id === id)) cards.delete(id);
    fill(list, all.length ? all.map((j) => (cards.get(j.id) ?? makeCard(j)).node) : el('p', { class: 'muted small', text: 'Nothing downloaded yet.' }));
    for (const j of all) cards.get(j.id).update();
  }
  jobs.restore().then(async () => { if (await jobs.memoryOnly()) listHead.after(el('p', { class: 'muted small', text: 'Storage isn\'t available here (a private window?): downloads only last until the app is closed.' })); });

  function makeCard(job) {
    const name = el('strong', { class: 'dl-name' });
    const sub = el('span', { class: 'muted small' });
    const bar = el('div', { class: 'progress-bar' });
    const label = el('span', { class: 'small muted progress-label' });
    const progress = el('div', { class: 'progress' }, bar, label);
    const msg = el('p', { class: 'small' });
    const details = el('p', { class: 'small dl-details' });
    const fp = el('div', { class: 'dl-fp' });
    const btns = el('div', { class: 'row wrap dl-btns' });
    const extra = el('div', { class: 'dl-extra' });
    const remove = el('button', { class: 'icon-btn dl-x', 'aria-label': `Remove ${job.name}`, title: 'Remove', text: '✕' });
    remove.addEventListener('click', async () => {
      if (job.status === 'done' || confirm(`Remove "${job.name}"? What's downloaded so far is deleted.`)) await jobs.remove(job);
    });
    const node = el('article', { class: 'card dl-card' }, el('div', { class: 'card-head' }, el('div', { class: 'dl-title' }, name, sub), remove), progress, msg, details, fp, btns, extra);
    let shown = '';
    const update = () => {
      name.textContent = job.name;
      sub.textContent = `${job.host} · ${new Date(job.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${job.part ? ' · a part' : ''}`;
      const loaded = jobs.loadedOf(job); const total = job.total;
      const done = job.status === 'done';
      progress.hidden = done;
      bar.style.width = total ? `${Math.min(100, (loaded / total) * 100).toFixed(1)}%` : `${(loaded / (loaded + 20e6)) * 100}%`;
      const rate = jobs.rateOf(job);
      label.textContent = job.status === 'running'
        ? `${total ? `${Math.floor((loaded / total) * 100)}% · ${formatBytes(loaded)} of ${formatBytes(total)}` : formatBytes(loaded)}${rate ? ` · ${formatBytes(rate)}/s` : ''}${rate && total ? ` · ${formatTime((total - loaded) / rate)} left` : ''}`
        : `${job.status === 'paused' ? 'Paused' : 'Stopped'} · ${formatBytes(loaded)}${total ? ` of ${formatBytes(total)}` : ''}`;
      msg.hidden = !job.error; msg.className = 'small warn-text';
      msg.textContent = job.error + (job.code === 'blocked' && job.status === 'failed' ? ' Some sites only let their own pages fetch their videos: open it in the browser and save it from there (Share → Save to Files, or ⋮ → Download).' : '');
      details.hidden = !done; details.textContent = done ? `${formatBytes(job.loaded)}${job.details ? ` · ${job.details}` : ''}` : '';
      // Buttons only rebuilt when its state changes (not on every progress tick).
      const state = `${job.status}|${jobs.isLive(job)}|${job.hash}|${job.code ?? ''}`;
      if (state === shown) return; shown = state;
      const b = [];
      if (job.status === 'running') b.push(el('button', { class: 'btn', text: '⏸ Pause', onclick: () => jobs.pause(job) }));
      if (job.status === 'paused' || job.status === 'failed') {
        const canGo = !['not-video', 'redirect'].includes(job.code);
        if (canGo) b.push(el('button', { class: 'btn primary', text: job.status === 'paused' ? '▶ Continue' : (job.loaded && job.ranges ? '▶ Continue' : '⟳ Try again'), onclick: () => jobs.resume(job) }));
        if (job.code === 'blocked' && navigator.onLine) b.push(openInBrowser(job.url));
      }
      if (done) {
        b.push(el('button', { class: 'btn primary', text: '💾 Save to phone', onclick: () => saveJob(job) }));
        if ((job.kind === 'mp4' || job.kind === 'mov') && !job.part) b.push(el('button', { class: 'btn', text: '✂️ Save a part', onclick: () => partFromFile(job, extra) }));
      }
      if (done || job.status === 'failed') b.push(el('button', { class: 'btn ghost', text: '⟳ Download again', onclick: () => { input.value = job.url; showClear(); check(); root.scrollIntoView({ behavior: 'smooth' }); } }));
      fill(btns, b);
      fill(fp, done && job.hash ? fingerprint(job.hash) : null);
    };
    const c = { node, update }; cards.set(job.id, c);
    return c;
  }

  /** The fingerprint (short, tap for all of it) and a box to check it against one you have. */
  function fingerprint(hex) {
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

  async function saveJob(job) {
    try {
      const f = await jobs.file(job);
      if (canShareFiles([f]) && await shareFiles([f], f.name)) return;
      downloadBlob(f, f.name);
    } catch (e) { noteError('Download save', e); alert(`Couldn't save it: ${e.message}`); }
  }

  /** A part of a downloaded MP4, cut on the phone (nothing downloaded again). */
  async function partFromFile(job, host) {
    if (host.childElementCount) { fill(host); return; }
    const f = await jobs.file(job);
    const pick = partPicker(job.duration ?? 0, async (from, to) => {
      try {
        const plan = await planPart(blobSource(f), from, to);
        const out = new File([plan.head, ...plan.ranges.map((r) => f.slice(r.offset, r.offset + r.length))], fileNameFor(job.url, 'mp4', ` (${formatTime(plan.start).replace(/:/g, '.')}–${formatTime(plan.end).replace(/:/g, '.')})`), { type: 'video/mp4' });
        if (canShareFiles([out]) && await shareFiles([out], out.name)) return;
        downloadBlob(out, out.name);
      } catch (e) { noteError('Download part (file)', e); alert(e.message); }
    }, '💾 Save this part');
    fill(host, pick);
  }

  /** From / To (minute marks) and a button. */
  function partPicker(duration, onGo, label) {
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

  // ---------- the link being looked at ----------
  /** Everything for the link on screen: dropped when another is checked. */
  let job = null;
  const newLook = () => {
    job?.abort.abort();
    clearInterval(job?.timer);
    for (const u of job?.urls ?? []) URL.revokeObjectURL(u);
    job?.probe?.remove();
    job = { abort: new AbortController(), urls: [], probe: null, previews: 'none', src: '', meta: null, pre: null, link: null, timer: 0 };
    return job;
  };

  // Paste: what was copied, its link picked out of any text around it, then checked. Some browsers
  // (iPhone, in a home-screen app) won't hand the clipboard over: then say how to paste by hand.
  pasteBtn.addEventListener('click', async () => {
    let text = '';
    try { text = (await navigator.clipboard?.readText?.()) ?? ''; } catch { /* not allowed */ }
    if (linkFromText(text)) { pasteHint.hidden = true; input.value = linkFromText(text); showClear(); check(); return; }
    pasteHint.hidden = false; input.focus(); input.select();
  });
  // Pasted into the box by hand: the link picked out and checked straight away.
  input.addEventListener('paste', () => setTimeout(() => { input.value = linkFromText(input.value); pasteHint.hidden = true; showClear(); if (input.value) check(); }, 0));
  const showClear = () => { clearBtn.hidden = !input.value; };
  input.addEventListener('input', showClear);
  // Clear: the link and all that was shown for it gone, ready for another (downloads stay).
  clearBtn.addEventListener('click', () => {
    newLook(); input.value = ''; showClear(); pasteHint.hidden = true;
    fill(status); fill(info); fill(grid); fill(actions);
    input.focus();
  });
  checkBtn.addEventListener('click', () => check());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });

  function check() {
    const j = newLook();
    fill(info); fill(grid); fill(actions);
    const c = checkVideoLink(input.value);
    if (c.ok === false) { fill(status, verdict('danger', 'Not downloaded', c.reasons)); return; }
    input.value = c.url; showClear(); j.link = c;
    const showOk = () => {
      fill(status, verdict('ok', `No warning signs: ${c.host}`, []), notes(c));
      // A signed link's time left, kept up to date.
      if (c.expires) j.timer = setInterval(() => { if (j !== job) return; const n = status.querySelector('.dl-expiry b'); if (n) n.textContent = c.expires > Date.now() ? `Stops working in ${ago(c.expires - Date.now())}` : 'This link has expired'; }, 30000);
      open(j, c.url);
    };
    if (c.warnings.length) {
      fill(status,
        verdict('caution', `Be careful with ${c.host}`, c.warnings), notes(c),
        el('div', { class: 'row' },
          el('button', { class: 'btn', text: 'I trust it: continue', onclick: showOk }),
          el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => { newLook(); fill(status); } })));
      return;
    }
    showOk();
  }

  /** What else to know about the link: when it expires, a token in it, tracking removed. */
  function notes(c) {
    if (!c.notes.length) return null;
    return el('ul', { class: 'dl-notes small' }, ...c.notes.map((n) => el('li', { class: n.title.startsWith('Stops') ? 'dl-expiry' : '' }, el('b', { text: n.title }), ` — ${n.detail}`)));
  }

  /** Its size and type (asked of the site), its length, its previews; then Download. */
  async function open(j, url) {
    j.src = url;
    fill(info, el('p', { class: 'muted small', text: 'Asking the site about the file…' }));
    let pre = null;
    try { pre = await preflight(url, { signal: j.abort.signal, strict: strict.checked }); } catch (e) {
      if (j !== job) return;
      if (e instanceof DownloadError && e.code !== 'aborted') { fill(info); fill(status, verdict('danger', 'Not downloaded', [{ title: e.message, detail: '' }])); return; }
    }
    if (j !== job) return;
    j.pre = pre;
    const facts = pre ? el('p', { class: 'dl-facts' }, el('strong', { text: `${KIND_NAME[pre.kind] ?? (pre.type || 'Video')} · ${pre.total ? formatBytes(pre.total) : 'size not given'}` }), ` · from ${j.link.host}${pre.ranges ? ' · can be resumed' : ' · can\'t be resumed (starts over if stopped)'}`)
      : el('p', { class: 'muted small', text: 'The site doesn\'t answer questions about the file (it may only let its own pages use it).' });
    fill(info, facts, el('p', { class: 'muted small', text: 'Reading the video…' }));
    // An MP4 on a site that sends ranges: its details from its index, before downloading it.
    let details = null;
    if ((pre?.kind === 'mp4' || pre?.kind === 'mov') && pre.ranges && pre.total) {
      try { details = await mp4Details(remoteSource(url, pre.total, { signal: j.abort.signal })); } catch { /* none */ }
      if (j !== job) return;
      if (details) facts.append(el('br'), el('span', { class: 'small', text: describe(details) }));
    }
    const meta = await probe(j, url);
    if (j !== job) return;
    j.meta = meta ?? (details?.duration ? { duration: details.duration, width: details.width, height: details.height, v: null } : null);
    if (!meta && j.meta) {
      fill(info, facts, el('p', { class: 'dl-meta' }, el('strong', { text: formatTime(j.meta.duration) }), ' long'), el('p', { class: 'muted small', text: 'This browser can\'t show stills of this video (its format), but it can download it.' }));
      downloadControls(j, url);
      return;
    }
    if (!meta) {
      fill(info, facts, el('p', { class: 'muted small', text: 'This phone can\'t show previews of it (the site may not allow it, or it isn\'t a video this browser plays). You can still try downloading it.' }));
    } else {
      fill(info, facts, el('p', { class: 'dl-meta' }, el('strong', { text: formatTime(meta.duration) }), ` long${meta.width ? ` · ${meta.width}×${meta.height}` : ''}`), el('p', { class: 'muted small', text: 'Tap a still for every 10 seconds of that minute.' }));
      showPreviews(j, meta);
    }
    downloadControls(j, url);
  }

  /**
   * Its length and size, from a video element that loads only what it needs (not played, muted).
   * First as an app may draw it (the site allows that: previews are stills drawn here); else as the
   * browser shows it (previews are paused frames instead).
   */
  async function probe(j, url) {
    for (const drawable of [true, false]) {
      const v = video(url, drawable);
      j.probe = v;
      const ok = await loaded(v, j.abort.signal);
      if (j !== job) { v.remove(); return null; }
      if (ok && Number.isFinite(v.duration) && v.duration > 0) {
        j.previews = drawable ? 'drawn' : 'frames';
        return { duration: v.duration, width: v.videoWidth, height: v.videoHeight, v };
      }
      v.remove(); j.probe = null;
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

  function showPreviews(j, meta) {
    const marks = minuteMarks(meta.duration);
    const step = marks.length > 1 ? marks[1].mark : meta.duration;
    const tiles = marks.map((m) => tile(m, () => closer(j, m.mark, Math.min(meta.duration, m.mark + step))));
    fill(grid, tiles.map((t) => t.node));
    if (j.previews === 'drawn') drawStills(j, meta.v, tiles).catch((e) => { if (j === job) { noteError('Download previews', e); framesInstead(j, tiles); } });
    else framesInstead(j, tiles);
  }

  /** A closer look: every 10 seconds from one mark to the next, in a sheet. */
  async function closer(j, from, to) {
    const marks = closerMarks(from, to, to - from > 60 ? Math.ceil((to - from) / 6) : 10);
    const tiles = marks.map((m) => tile(m, null));
    const dlg = el('dialog', { class: 'ed-dialog dl-closer' }, el('form', { method: 'dialog', class: 'sheet' },
      el('div', { class: 'card-head' }, el('h2', { text: `${formatTime(from)} – ${formatTime(to)}` }), el('button', { class: 'icon-btn', 'aria-label': 'Close', text: '✕' })),
      el('div', { class: 'dl-grid' }, tiles.map((t) => t.node))));
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(); j.abort.signal.addEventListener('abort', onAbort, { once: true });
    dlg.addEventListener('close', () => { ctrl.abort(); dlg.remove(); });
    document.body.append(dlg); dlg.showModal();
    const sub = { abort: ctrl, urls: j.urls, src: j.src };
    if (j.previews === 'drawn') {
      const v = video(j.src, true);
      try { if (await loaded(v, ctrl.signal)) await drawStills(sub, v, tiles, () => !ctrl.signal.aborted && j === job); } catch (e) { if (!ctrl.signal.aborted) framesInstead(sub, tiles, () => !ctrl.signal.aborted); } finally { v.remove(); }
    } else framesInstead(sub, tiles, () => !ctrl.signal.aborted);
  }

  /** Each preview drawn from one video element, a mark at a time. */
  async function drawStills(j, v, tiles, alive = () => j === job) {
    const k = Math.min(1, THUMB_W / (v.videoWidth || THUMB_W));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((v.videoWidth || THUMB_W) * k)); c.height = Math.max(1, Math.round((v.videoHeight || THUMB_W * 0.5625) * k));
    const g = c.getContext('2d');
    for (const t of tiles) {
      if (!alive()) return;
      t.pic.classList.add('loading');
      await seek(v, t.m.at, j.abort.signal);
      g.drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); // throws if the site didn't allow drawing
      if (!alive() || !blob) return;
      const u = URL.createObjectURL(blob); j.urls.push(u);
      t.pic.classList.remove('loading');
      fill(t.pic, el('img', { src: u, alt: `At ${t.m.label}`, loading: 'lazy' }));
    }
  }

  /** When it can't be drawn: each preview a paused video at its mark, loaded as it scrolls into view, a few at a time. */
  function framesInstead(j, tiles, alive = () => j === job) {
    let running = 0; const queue = [];
    const next = () => {
      while (running < 2 && queue.length && alive()) {
        const t = queue.shift(); running++;
        const v = /** @type {HTMLVideoElement} */ (el('video', { muted: true, playsinline: true, preload: 'metadata', 'aria-label': `At ${t.m.label}` }));
        v.muted = true; v.disablePictureInPicture = true;
        const done = () => { clearTimeout(timer); running--; t.pic.classList.remove('loading'); next(); };
        const timer = setTimeout(done, 15000);
        v.addEventListener('loadeddata', done, { once: true });
        v.addEventListener('error', done, { once: true });
        v.src = `${j.src}#t=${t.m.at}`;
        t.pic.classList.add('loading');
        fill(t.pic, v);
      }
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); queue.push(tiles.find((t) => t.node === e.target)); }
      next();
    }, { rootMargin: '200px' });
    for (const t of tiles) io.observe(t.node);
    j.abort.signal.addEventListener('abort', () => io.disconnect(), { once: true });
  }

  function downloadControls(j, url) {
    const pre = j.pre;
    const go = el('button', { class: 'btn primary block', text: `⬇️ Download${pre?.total ? ` (${formatBytes(pre.total)})` : ''}` });
    go.addEventListener('click', async () => {
      go.disabled = true;
      await jobs.start({ url, host: j.link.host, kind: pre?.kind ?? null, total: pre?.total ?? 0, ranges: !!pre?.ranges, lastModified: pre?.lastModified ?? '', strict: strict.checked });
      go.disabled = false;
      listHead.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const parts = [go];
    const mp4 = pre?.kind === 'mp4' || pre?.kind === 'mov';
    if (mp4 && pre.ranges && pre.total && j.meta) {
      parts.push(el('details', { class: 'dl-partbox' }, el('summary', { text: '✂️ Download just a part' }),
        el('p', { class: 'muted small', text: 'Only that part is downloaded (and the file\'s index), saved as an MP4 of its own.' }),
        partPicker(j.meta.duration, async (from, to) => {
          await jobs.start({ url, host: j.link.host, kind: pre.kind, total: pre.total, ranges: true, lastModified: pre.lastModified, strict: strict.checked, part: { from, to } });
          listHead.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, '⬇️ Download part')));
    } else if (mp4) parts.push(el('p', { class: 'muted small', text: 'This site doesn\'t send parts of the file, so to keep just a part, download it all and use ✂️ Save a part.' }));
    fill(actions, parts);
  }

  return () => { newLook(); };
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

/** When the site won't let apps fetch it: open it in the browser (its own tab, nothing of this app sent). */
function openInBrowser(url) {
  return el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer', text: '↗ Open in the browser', title: 'Some sites only let their own pages fetch their videos: open it there and save it (Share → Save to Files, or ⋮ → Download).' });
}

/** The check's result: ok / caution / danger, with its notes. */
function verdict(level, title, notes) {
  return el('div', { class: `qr-verdict ${level}`, role: level === 'ok' ? 'status' : 'alert' },
    el('strong', { text: title }),
    ...notes.map((n) => el('span', { class: 'small' }, el('b', { text: n.title }), n.detail ? ` — ${n.detail}` : '')));
}
