// Files → Download: paste a link to a video (a CDN address that plays in the browser). The link is
// checked first (download-core: https only, not a scam or a device at home); then a still from its
// start and each minute mark is shown, without playing it, and Download fetches the file itself,
// with a progress bar, to save to the phone. The one part of Files that needs a connection.
// Only the video at the link is fetched, straight from its site: no cookies or sign-ins sent, no
// other server in between, nothing from the page it came from runs. A site that doesn't let apps
// fetch its files gets a link to open it in the browser instead (Share → Save to Files there).

import { el, fill } from '../../lib/dom.js';
import { shareFiles, canShareFiles, downloadBlob, formatBytes } from '../../lib/files.js';
import { noteError } from '../../lib/diag.js';
import { checkVideoLink, minuteMarks, formatTime, downloadVideo, DownloadError, LARGE_BYTES } from './download-core.js';

const THUMB_W = 320;

export function mount(host) {
  const root = el('div', { class: 'dl' });
  host.append(root);

  const input = el('input', { type: 'url', class: 'dl-url', placeholder: 'https://…/video.mp4', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Video link' });
  const checkBtn = el('button', { class: 'btn primary', text: 'Check link' });
  const pasteBtn = navigator.clipboard?.readText ? el('button', { class: 'btn', text: 'Paste' }) : null;
  const status = el('div', { class: 'dl-status' });
  const info = el('div', { class: 'dl-info' });
  const grid = el('div', { class: 'dl-grid' });
  const actions = el('div', { class: 'dl-actions' });
  root.append(
    el('h3', { text: 'Download a video' }),
    el('p', { class: 'muted small', text: 'Paste the address of a video that plays in the browser (ending in .mp4, .webm, .mov…). It isn\'t played: you see a still from each minute, then download it to save.' }),
    el('div', { class: 'row dl-row' }, input, pasteBtn, checkBtn),
    status, info, grid, actions,
    el('p', { class: 'muted small privacy', text: 'Needs a connection. Only the video at the link is downloaded, straight from its site to this phone: no other server, no cookies or sign-ins sent, nothing from its web page runs. Links that aren\'t https, point inside your own network, or look like a scam aren\'t opened.' }),
  );

  /** Everything for the link on screen: dropped when another is checked. */
  let job = null;
  const newJob = () => {
    job?.abort.abort();
    for (const u of job?.urls ?? []) URL.revokeObjectURL(u);
    job?.probe?.remove();
    job = { abort: new AbortController(), urls: [], probe: null, file: null, previews: 'none', src: '', dl: null };
    return job;
  };

  pasteBtn?.addEventListener('click', async () => {
    try { input.value = (await navigator.clipboard.readText()).trim(); check(); } catch { input.focus(); }
  });
  checkBtn.addEventListener('click', () => check());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });

  function check() {
    const j = newJob();
    fill(info); fill(grid); fill(actions);
    const c = checkVideoLink(input.value);
    if (!c.ok) {
      fill(status, verdict('danger', 'Not downloaded', c.reasons));
      return;
    }
    input.value = c.url;
    if (c.warnings.length) {
      fill(status,
        verdict('caution', `Be careful with ${c.host}`, c.warnings),
        el('div', { class: 'row' },
          el('button', { class: 'btn', text: 'I trust it: continue', onclick: () => { fill(status, verdict('ok', `Checked: ${c.host}`, [])); open(j, c.url); } }),
          el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => { newJob(); fill(status); } })));
      return;
    }
    fill(status, verdict('ok', `No warning signs: ${c.host}`, []));
    open(j, c.url);
  }

  /** The video's length, then its previews; then Download. */
  async function open(j, url) {
    j.src = url;
    fill(info, el('p', { class: 'muted small', text: 'Reading the video…' }));
    const meta = await probe(j, url);
    if (j !== job) return;
    if (!meta) {
      fill(info, el('p', { class: 'muted small', text: 'This phone can\'t show previews of it (the site may not allow it, or it isn\'t a video this browser plays). You can still try downloading it.' }));
    } else {
      fill(info, el('p', { class: 'dl-meta' }, el('strong', { text: formatTime(meta.duration) }), ` long${meta.width ? ` · ${meta.width}×${meta.height}` : ''}`));
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
      const ok = await new Promise((resolve) => {
        const done = (r) => { clearTimeout(t); resolve(r); };
        const t = setTimeout(() => done(false), 20000);
        v.addEventListener('loadedmetadata', () => done(true), { once: true });
        v.addEventListener('error', () => done(false), { once: true });
        j.abort.signal.addEventListener('abort', () => done(false), { once: true });
      });
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

  function showPreviews(j, meta) {
    const marks = minuteMarks(meta.duration);
    const tiles = marks.map((m) => {
      const pic = el('div', { class: 'dl-pic' });
      return { m, pic, node: el('figure', { class: 'dl-thumb' }, pic, el('figcaption', { text: m.label })) };
    });
    fill(grid, tiles.map((t) => t.node));
    if (j.previews === 'drawn') drawStills(j, meta.v, tiles).catch((e) => { if (j === job) { noteError('Download previews', e); framesInstead(j, tiles); } });
    else framesInstead(j, tiles);
  }

  /** Each preview drawn from the one video element, a mark at a time. */
  async function drawStills(j, v, tiles) {
    const k = Math.min(1, THUMB_W / (v.videoWidth || THUMB_W));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((v.videoWidth || THUMB_W) * k)); c.height = Math.max(1, Math.round((v.videoHeight || THUMB_W * 0.5625) * k));
    const g = c.getContext('2d');
    for (const t of tiles) {
      if (j !== job) return;
      t.pic.classList.add('loading');
      await seek(v, t.m.at, j.abort.signal);
      g.drawImage(v, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); // throws if the site didn't allow drawing
      if (j !== job || !blob) return;
      const u = URL.createObjectURL(blob); j.urls.push(u);
      t.pic.classList.remove('loading');
      fill(t.pic, el('img', { src: u, alt: `At ${t.m.label}`, loading: 'lazy' }));
    }
  }

  /** When it can't be drawn: each preview a paused video at its mark, loaded as it scrolls into view, a few at a time. */
  function framesInstead(j, tiles) {
    let running = 0; const queue = [];
    const next = () => {
      while (running < 2 && queue.length && j === job) {
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
    const bar = el('div', { class: 'progress-bar' });
    const label = el('span', { class: 'small muted progress-label' });
    const progress = el('div', { class: 'progress', hidden: true }, bar, label);
    const go = el('button', { class: 'btn primary block', text: '⬇️ Download' });
    const stop = el('button', { class: 'btn ghost', text: 'Stop', hidden: true });
    const out = el('div', { class: 'dl-out' });
    fill(actions, go, progress, stop, out);
    stop.addEventListener('click', () => { j.dl?.abort(); });
    go.addEventListener('click', async () => {
      go.hidden = true; stop.hidden = false; progress.hidden = false; fill(out);
      const dl = new AbortController(); j.dl = dl;
      j.abort.signal.addEventListener('abort', () => dl.abort(), { once: true });
      const started = performance.now(); let warned = false;
      try {
        const r = await downloadVideo(url, {
          signal: dl.signal,
          onProgress: ({ loaded, total }) => {
            const secs = (performance.now() - started) / 1000; const rate = loaded / Math.max(0.5, secs);
            bar.style.width = total ? `${Math.min(100, (loaded / total) * 100).toFixed(1)}%` : `${(loaded / (loaded + 20e6)) * 100}%`;
            label.textContent = total
              ? `${Math.floor((loaded / total) * 100)}% · ${formatBytes(loaded)} of ${formatBytes(total)} · ${formatBytes(rate)}/s${rate > 0 ? ` · ${formatTime((total - loaded) / rate)} left` : ''}`
              : `${formatBytes(loaded)} · ${formatBytes(rate)}/s`;
            if (!warned && (total || loaded) > LARGE_BYTES) { warned = true; fill(out, el('p', { class: 'muted small', text: 'A large file: keep the app open until it finishes.' })); }
          },
        });
        if (j !== job) return;
        bar.style.width = '100%'; label.textContent = `Downloaded · ${formatBytes(r.size)}`;
        stop.hidden = true;
        j.file = new File([r.blob], r.name, { type: r.blob.type });
        saveControls(j, out);
        // Previews it couldn't draw from the site can be drawn from the file now.
        if (j.previews !== 'drawn') redrawFromFile(j, r.blob);
      } catch (e) {
        if (j !== job) return;
        stop.hidden = true; go.hidden = false; go.textContent = '⬇️ Try again';
        const code = e instanceof DownloadError ? e.code : 'blocked';
        progress.hidden = code === 'aborted';
        label.textContent = code === 'aborted' ? '' : 'Not downloaded';
        bar.style.width = '0';
        if (!(e instanceof DownloadError)) noteError('Download', e);
        fill(out, el('p', { class: code === 'aborted' ? 'muted small' : 'warn-text small', text: e.message }),
          code === 'blocked' ? blockedHelp(url) : null);
      }
    });
  }

  function saveControls(j, out) {
    const f = j.file;
    const save = el('button', { class: 'btn primary block', text: '💾 Save to phone' });
    save.addEventListener('click', async () => {
      try {
        if (canShareFiles([f]) && await shareFiles([f], f.name)) return;
      } catch (e) { noteError('Download save', e); }
      downloadBlob(f, f.name);
    });
    fill(out, el('p', { class: 'dl-file' }, el('strong', { text: f.name }), ` · ${formatBytes(f.size)}`), save,
      el('p', { class: 'muted small', text: 'On iPhone, pick "Save Video" for Photos or "Save to Files".' }));
  }

  /** When the site won't let apps fetch it: open it in the browser (its own tab, nothing of this app sent). */
  function blockedHelp(url) {
    if (!navigator.onLine) return el('p', { class: 'muted small', text: 'You seem to be offline. Connect and try again.' });
    return el('div', { class: 'dl-help' },
      el('p', { class: 'muted small', text: 'Some sites only let their own pages fetch their videos. You can open it in the browser instead and save it from there (Share → Save to Files, or ⋮ → Download).' }),
      el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer', text: '↗ Open the video in the browser' }));
  }

  async function redrawFromFile(j, blob) {
    const src = URL.createObjectURL(blob); j.urls.push(src);
    const v = video(src, false);
    try {
      await new Promise((resolve, reject) => { v.addEventListener('loadedmetadata', resolve, { once: true }); v.addEventListener('error', reject, { once: true }); });
      if (j !== job) return;
      j.previews = 'drawn';
      fill(info, el('p', { class: 'dl-meta' }, el('strong', { text: formatTime(v.duration) }), ` long · ${v.videoWidth}×${v.videoHeight}`));
      const marks = minuteMarks(v.duration);
      const tiles = marks.map((m) => { const pic = el('div', { class: 'dl-pic' }); return { m, pic, node: el('figure', { class: 'dl-thumb' }, pic, el('figcaption', { text: m.label })) }; });
      fill(grid, tiles.map((t) => t.node));
      await drawStills(j, v, tiles);
    } catch (e) { noteError('Download previews (file)', e); } finally { v.remove(); }
  }

  return () => newJob();
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

/** The check's result: ok / caution / danger, with its notes. */
function verdict(level, title, notes) {
  return el('div', { class: `qr-verdict ${level}`, role: level === 'ok' ? 'status' : 'alert' },
    el('strong', { text: title }),
    ...notes.map((n) => el('span', { class: 'small' }, el('b', { text: n.title }), n.detail ? ` — ${n.detail}` : '')));
}
