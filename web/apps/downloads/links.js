// Downloads: the links pasted, each checked as soon as it's in (download-core: safe? expired? a
// token in it? tracking off) and then asked about (its type, size, resumability; an MP4's details
// from its index), in the background. The one being looked at, and the queue of others added with
// "+ Add to Queue". Kept in memory only, for this visit: never written to the phone, and a link
// cleared or removed is gone (a download started from one is in History until removed there).

import { checkVideoLink, preflight, remoteSource, DownloadError, fileNameFor, formatTime } from '../../tools/download/download-core.js';
import { formatBytes as fmtBytes } from '../../lib/files.js';
import { mp4Details } from '../../tools/download/mp4.js';

/**
 * @typedef {{ id: string, input: string, check: import('../../tools/download/download-core.js').LinkCheck,
 *   state: 'refused'|'caution'|'asking'|'ready'|'blocked', pre: any, details: any, error: string, jobId: string,
 *   queued: boolean, strict: boolean, created: number, abort: AbortController, stills: Map<number, string>, meta: any, mode: string, video?: HTMLVideoElement|null, videoBusy?: boolean }} Link
 */

const listeners = new Set();
/** @type {Link[]} */
let queue = [];
/** @type {Link|null} */
let current = null;
const tell = (link) => { for (const f of listeners) { try { f(link); } catch { /* a screen gone */ } } };

export const links = {
  subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
  queue: () => queue,
  current: () => current,
  get: (id) => (current?.id === id ? current : queue.find((l) => l.id === id) ?? null),

  /** A pasted link checked (and, if fine, asked about): the one looked at now (the last one dropped, unless queued). */
  open(input, { strict = false } = {}) {
    if (current && !current.queued) forget(current);
    current = make(input, strict);
    tell(null);
    return current;
  },
  /** The one looked at goes in the queue (still checking in the background); nothing is looked at. */
  enqueue() {
    if (!current) return;
    current.queued = true; queue.push(current); current = null; tell(null);
  },
  /** The one looked at let go (✕): forgotten unless it's queued. */
  close() {
    if (current && !current.queued) forget(current);
    current = null; tell(null);
  },
  /** A cautioned link trusted: asked about now. */
  trust(link) { if (link.state === 'caution') inspect(link); },
  /** Out of the queue and forgotten. */
  remove(link) {
    queue = queue.filter((l) => l !== link);
    if (current === link) current = null;
    forget(link); tell(null);
  },
  /** Linked to the download started from it. */
  setJob(link, jobId) { link.jobId = jobId; tell(link); },
  changed: (link) => tell(link),
  /** A name to show for it. */
  name: (link) => (link.check.ok ? fileNameFor(link.check.url, link.pre?.kind ?? 'mp4') : link.input),
};

function make(input, strict) {
  const check = checkVideoLink(input);
  /** @type {Link} */
  const link = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, input, check, state: 'refused', pre: null, details: null, error: '',
    jobId: '', queued: false, strict, created: Date.now(), abort: new AbortController(), stills: new Map(), meta: null, mode: '',
  };
  if (check.ok) { if (check.warnings.length) link.state = 'caution'; else inspect(link); }
  return link;
}

/** Asks the site about the file (and an MP4's index), without downloading it. */
async function inspect(link) {
  if (!link.check.ok) return;
  link.state = 'asking'; tell(link);
  const url = link.check.url; const signal = link.abort.signal;
  try {
    link.pre = await preflight(url, { signal, strict: link.strict });
    if (link.pre && (link.pre.kind === 'mp4' || link.pre.kind === 'mov') && link.pre.ranges && link.pre.total) {
      try { link.details = await mp4Details(remoteSource(url, link.pre.total, { signal })); } catch { /* none */ }
    }
    if (signal.aborted) return;
    link.state = link.pre ? 'ready' : 'blocked';
    tell(link);
    // Its length (and whether its stills can be drawn here), from the video's own header only.
    if (!link.mode) await probe(link);
    if (signal.aborted) return;
  } catch (e) {
    if (signal.aborted) return;
    link.state = 'refused';
    link.error = e instanceof DownloadError ? e.message : 'The site couldn\'t be asked about it.';
  }
  tell(link);
}

/**
 * Its length and picture size, from a video element that loads only the header (never played):
 * first as the app may draw it (stills drawn here: mode 'drawn'), else as the browser shows it
 * (paused frames instead: 'frames'); 'none' when neither works (an MP4's index may still say).
 */
async function probe(link) {
  for (const drawable of [true, false]) {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'metadata'; v.playsInline = true; v.disablePictureInPicture = true;
    if (drawable) v.crossOrigin = 'anonymous';
    v.src = link.check.url;
    const ok = await new Promise((resolve) => {
      const done = (r) => { clearTimeout(t); resolve(r); };
      const t = setTimeout(() => done(false), 20000);
      v.addEventListener('loadedmetadata', () => done(true), { once: true });
      v.addEventListener('error', () => done(false), { once: true });
      link.abort.signal.addEventListener('abort', () => done(false), { once: true });
    });
    const meta = ok && Number.isFinite(v.duration) && v.duration > 0 ? { duration: v.duration, width: v.videoWidth, height: v.videoHeight } : null;
    // A drawable one is kept, header loaded, to draw the first stills from (no second fetch).
    if (!(meta && drawable) || link.abort.signal.aborted) { v.removeAttribute('src'); v.load(); }
    if (link.abort.signal.aborted) return;
    if (meta) { link.meta = meta; link.mode = drawable ? 'drawn' : 'frames'; if (drawable) link.video = v; return; }
  }
  link.mode = 'none';
  if (link.details?.duration) link.meta = { duration: link.details.duration, width: link.details.width, height: link.details.height };
}

/** "53 KB · 2:30" (what's known of its size and length). */
export function sizeAndLength(link) {
  const parts = [];
  if (link.pre?.total) parts.push(fmtBytes(link.pre.total));
  if (link.meta?.duration) parts.push(formatTime(link.meta.duration));
  return parts.join(' · ');
}

/** Nothing of it kept: what it was fetching stopped, its stills let go. */
function forget(link) {
  link.abort.abort();
  if (link.video) { link.video.removeAttribute('src'); link.video.load(); link.video = null; }
  for (const u of link.stills.values()) URL.revokeObjectURL(u);
  link.stills.clear();
}
