// Downloads: the stills (quick, small previews drawn from a video, never played), for every screen:
// a link's view, its closer look, and the queue's strips. One link at a time, app-wide (up to three
// video elements for it), so however many links are queued the phone never has more than that
// loading: what's being looked at goes first, the queue's strips after. Each still is drawn once
// and kept with its link (its stills map), so the queue, the view and a closer look share them.

/** Stills are quick previews: this wide at most, and drawn this many at a time for a link. */
export const THUMB_W = 240;
const DRAWERS = 3;

/** @typedef {{ mark: number, at: number, label: string }} Mark */
/** @type {{ link: any, marks: Mark[], signal: AbortSignal, onStill: (m: Mark, url: string) => void, prio: number, done: (e?: any) => void }[]} */
const tasks = [];
let busy = false;

/**
 * Draws `marks` of `link` (those it doesn't have yet), calling `onStill` for each as it's ready
 * (and for ones already drawn, at once). `prio`: 2 a closer look, 1 the view, 0 the queue's strips.
 * Rejects if the site doesn't let its frames be drawn (then paused frames are shown instead).
 * @param {any} link @param {Mark[]} marks
 * @param {{ signal: AbortSignal, onStill: (m: Mark, url: string) => void, prio?: number }} o
 */
export function drawStills(link, marks, { signal, onStill, prio = 1 }) {
  for (const m of marks) { const u = link.stills.get(m.mark); if (u) onStill(m, u); }
  const todo = marks.filter((m) => !link.stills.has(m.mark));
  if (!todo.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    tasks.push({ link, marks: todo, signal, onStill, prio, done: (e) => (e ? reject(e) : resolve()) });
    next();
  });
}

async function next() {
  if (busy) return;
  // The most wanted first (and the oldest of those); ones no longer wanted dropped.
  for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i].signal.aborted) tasks.splice(i, 1)[0].done();
  if (!tasks.length) return;
  let k = 0; for (let i = 1; i < tasks.length; i++) if (tasks[i].prio > tasks[k].prio) k = i;
  const t = tasks.splice(k, 1)[0];
  busy = true;
  try { await draw(t); t.done(); } catch (e) { t.done(e); } finally { busy = false; next(); }
}

/** One link's stills, by up to DRAWERS video elements (the first the one its check already loaded). */
async function draw({ link, marks, signal, onStill }) {
  const todo = marks.filter((m) => !link.stills.has(m.mark));
  const n = Math.min(DRAWERS, todo.length);
  const vids = [];
  const shared = link.video && !link.videoBusy ? link.video : null;
  if (shared) link.videoBusy = true;
  try {
    await Promise.all(Array.from({ length: n }, async (_, i) => {
      let v = i === 0 && shared ? shared : null;
      if (!v) { v = video(link.check.url); vids.push(v); if (!await loaded(v, signal)) return; }
      const c = document.createElement('canvas');
      const k = Math.min(1, THUMB_W / (v.videoWidth || THUMB_W));
      c.width = Math.max(1, Math.round((v.videoWidth || THUMB_W) * k)); c.height = Math.max(1, Math.round((v.videoHeight || THUMB_W * 0.5625) * k));
      const g = c.getContext('2d');
      for (let m = todo.shift(); m && !signal.aborted; m = todo.shift()) {
        if (link.stills.has(m.mark)) { onStill(m, link.stills.get(m.mark)); continue; }
        await seek(v, m.at, signal);
        g.drawImage(v, 0, 0, c.width, c.height);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.6)); // throws if the site didn't allow drawing
        if (signal.aborted || !blob) return;
        const u = URL.createObjectURL(blob); link.stills.set(m.mark, u);
        onStill(m, u);
      }
    }));
  } finally {
    if (shared) link.videoBusy = false;
    for (const v of vids) { v.removeAttribute('src'); v.load(); v.remove(); }
  }
}

/** A video element for drawing (loads only what it needs; muted; never played; off screen). */
function video(src) {
  const v = document.createElement('video');
  v.className = 'dl-probe'; v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.disablePictureInPicture = true;
  v.setAttribute('aria-hidden', 'true');
  v.crossOrigin = 'anonymous';
  v.src = src;
  document.body.append(v);
  return v;
}

/** Whether the video's details load (or it fails, or it's stopped). */
export function loaded(v, signal) {
  return new Promise((resolve) => {
    if (v.readyState >= 1) { resolve(true); return; }
    const done = (r) => { clearTimeout(t); resolve(r); };
    const t = setTimeout(() => done(false), 20000);
    v.addEventListener('loadedmetadata', () => done(true), { once: true });
    v.addEventListener('error', () => done(false), { once: true });
    signal.addEventListener('abort', () => done(false), { once: true });
  });
}

/** Seeks the (paused) video to `t` and waits for that frame (the nearest key frame where it can: quickest). */
function seek(v, t, signal) {
  return new Promise((resolve, reject) => {
    const done = (ok) => { clearTimeout(timer); v.removeEventListener('seeked', onSeeked); ok ? resolve() : reject(new Error('seek timed out')); };
    const onSeeked = () => done(true);
    const timer = setTimeout(() => done(false), 20000);
    v.addEventListener('seeked', onSeeked);
    signal.addEventListener('abort', () => done(false), { once: true });
    const to = Math.min(t, Math.max(0, (v.duration || t) - 0.1));
    if (typeof v.fastSeek === 'function') v.fastSeek(to); else v.currentTime = to;
  });
}
