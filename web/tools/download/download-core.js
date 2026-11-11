// @ts-check
// Files → Download: the parts with no screen (tested in Node).
// - The link: whether it's safe to fetch (https only, no sign-in in the address, not a device on your
//   own network, not a link the QR app's checker flags as a scam), when it stops working (signed CDN
//   links carry an expiry), whether it carries a personal access token, and tracking tags removed
//   (unless it's signed: changing a signed link breaks it).
// - Before downloading: its size and type, asked of the site without downloading it, and whether
//   it can be resumed (the site sends byte ranges).
// - The download: straight from the link's own site to this phone, no cookies or sign-ins sent,
//   stopped at once if what comes back isn't a video file (a web page, a playlist, an app); handed
//   over a piece at a time (to be stored, not kept in memory), and picked up where it stopped.
// - A part of an MP4 straight from the site: only its index and the frames of the part (mp4.js).

import { analyzeUrl, isPrivateHost, stripTracking } from '../qr/link-check.js';

/** The most it will download at all (a file this big is stored on the phone, piece by piece). */
export const MAX_BYTES = 20 * 1024 ** 3;

/** Addresses that are a streaming playlist (many small pieces), not one video file. */
const PLAYLIST = /\.(m3u8?|mpd|f4m|ism)(\/|$)/i;
/** Addresses that are plainly not a video. */
const NOT_VIDEO = /\.(exe|msi|apk|ipa|dmg|pkg|deb|rpm|appimage|bat|cmd|com|scr|ps1|sh|jar|js|mjs|html?|php|aspx?|svg|zip|rar|7z|gz|tar|iso|img|bin|pdf|docx?|xlsx?|pptx?|mobileconfig)$/i;

/**
 * @typedef {{ title: string, detail: string }} Note
 * @typedef {{ ok: true, url: string, host: string, warnings: Note[], notes: Note[], expires: number|null, signed: string[], removed: string[] }} LinkOk
 * @typedef {LinkOk | { ok: false, reasons: Note[] }} LinkCheck
 */

/**
 * Whether a pasted link may be fetched. Refused: not https, a name and password in it, a device on
 * your own network, a streaming playlist or a file that isn't a video, an expired signed link, or
 * anything the link checker calls dangerous. Its cautions (an odd port, a cheap domain ending, a
 * short link...) are `warnings`, to read before going on; `notes` say what else to know (when it
 * expires, that it carries a token, tracking removed). `url` is the link to fetch (tracking removed).
 * @param {string} input @param {{ now?: number }} [o] @returns {LinkCheck}
 */
export function checkVideoLink(input, { now = Date.now() } = {}) {
  const text = String(input ?? '').trim();
  if (!text) return refuse('No link', 'Paste the address of the video.');
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); } catch { return refuse('Not a web address', 'It can\'t be opened as a link.'); }
  if (u.protocol === 'http:') return refuse('Not encrypted (http)', 'Anyone on the same network could swap the file on the way. Only https links are downloaded.');
  if (u.protocol !== 'https:') return refuse(`A "${u.protocol.replace(':', '')}:" link`, 'Only https web links to a video file can be downloaded.');
  if (u.username || u.password) return refuse('A name or password in the address', 'Links like this are used to disguise where they go. Not downloaded.');
  if (isPrivateHost(u.hostname)) return refuse('A device on your own network', 'It points to a router, computer or other device, not a site on the internet.');
  if (PLAYLIST.test(u.pathname)) return refuse('A streaming playlist, not a video file', 'This is a list of many small pieces (HLS or DASH), which can\'t be saved as one file here. Look for a link ending in .mp4 or .webm.');
  if (NOT_VIDEO.test(u.pathname)) return refuse('Not a video file', `It ends in "${u.pathname.split('.').pop()}". Only video files are downloaded.`);
  const a = analyzeUrl(u.href);
  if (a.verdict === 'danger') return { ok: false, reasons: a.findings.filter((f) => f.level === 'danger').map(({ title, detail }) => ({ title, detail })) };
  const warnings = (a.findings ?? []).filter((f) => f.level === 'caution').map(({ title, detail }) => ({ title, detail }));

  const signed = signedParams(u.href); const expires = linkExpiry(u.href);
  if (expires != null && expires <= now) return refuse('This link has expired', `It stopped working ${ago(now - expires)} ago. Get a fresh link from where you found it.`);
  // Tracking tags off, unless the link is signed (the signature covers the whole address).
  let url = u.href; let removed = [];
  if (!signed.length) {
    const clean = stripTracking(u.href);
    if (clean) { removed = [...u.searchParams.keys()].filter((k) => !new URL(clean).searchParams.has(k)); url = clean; }
  }
  const notes = [];
  if (expires != null) notes.push({ title: `Stops working in ${ago(expires - now)}`, detail: 'It\'s a signed link with a time limit: download it before then.' });
  if (signed.length) notes.push({ title: 'Has an access token in it', detail: `Its ${signed.slice(0, 3).join(', ')} part lets anyone with the link download this, maybe as you. Don't share the link.` });
  if (removed.length) notes.push({ title: 'Tracking removed', detail: `${removed.join(', ')} taken off the link (they only tell the site where you came from).` });
  return { ok: true, url, host: a.unicodeHost || u.hostname, warnings, notes, expires, signed, removed };
}

/**
 * The link in pasted text: the first web address in it (a share sheet often adds a title or a
 * message around it), its trailing punctuation off; else the text as it is.
 * @param {string} text
 */
export function linkFromText(text) {
  const t = String(text ?? '').trim();
  const m = /https?:\/\/[^\s<>"'`]+/i.exec(t);
  return m ? m[0].replace(/[).,;:!?\]}'"]+$/, '') : t;
}

/** @param {string} title @param {string} detail @returns {LinkCheck} */
const refuse = (title, detail) => ({ ok: false, reasons: [{ title, detail }] });

/** 90 000 ms → "2 min", "3 h", "2 days". @param {number} ms */
export function ago(ms) {
  const s = Math.max(0, ms / 1000);
  if (s < 90) return `${Math.max(1, Math.round(s))} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

/** Query parts that sign a link or grant access (CloudFront, S3, Akamai, Google, Azure, generic). */
const SIGNED = /^(signature|sig|x-amz-signature|x-amz-credential|x-amz-security-token|x-goog-signature|x-goog-credential|policy|key-pair-id|hdnts|hdnea|__token__|token|access_token|auth|auth_key|authkey|hmac|hash|md5|st|se|sp|sv|sr|skoid|sktid|jwt|t|k|secure|wmsauthsign)$/i;
/** Ones that are only a sign when they look like one (long, random). */
const WEAK = new Set(['t', 'k', 'st', 'se', 'sp', 'sv', 'sr', 'hash', 'md5', 'secure']);

/** The names of a link's query parts that sign it or carry an access token. @param {string} href */
export function signedParams(href) {
  let u; try { u = new URL(href); } catch { return []; }
  const out = [];
  for (const [k, v] of u.searchParams) {
    if (!SIGNED.test(k)) continue;
    if (WEAK.has(k.toLowerCase()) && !(v.length >= 16 && /[A-Za-z]/.test(v) && /\d/.test(v))) continue;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * When a signed link stops working (ms since 1970), or null: CloudFront / Google (Expires=), S3
 * (X-Amz-Date + X-Amz-Expires), Azure (se=), Akamai tokens (exp=… inside hdnts / __token__), and
 * the common exp / expires / e. @param {string} href @returns {number|null}
 */
export function linkExpiry(href) {
  let u; try { u = new URL(href); } catch { return null; }
  const q = new Map([...u.searchParams].map(([k, v]) => [k.toLowerCase(), v]));
  const epoch = (v) => { if (!/^\d{9,13}$/.test(v ?? '')) return null; const n = Number(v); return n < 1e12 ? n * 1000 : n; };
  if (q.has('x-amz-date') && q.has('x-amz-expires')) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(q.get('x-amz-date'));
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + Number(q.get('x-amz-expires')) * 1000;
  }
  for (const k of ['expires', 'exp', 'e', 'x-goog-expires', 'expiry', 'expire', 'validto']) { const t = epoch(q.get(k)); if (t) return t; }
  if (q.has('se')) { const t = Date.parse(q.get('se')); if (!Number.isNaN(t)) return t; }
  for (const k of ['hdnts', 'hdnea', '__token__']) { const m = /(?:^|~)exp=(\d{9,13})/.exec(q.get(k) ?? ''); if (m) return epoch(m[1]); }
  return null;
}

/** 75 → "1:15", 3723 → "1:02:03". @param {number} s */
export function formatTime(s) {
  const t = Math.max(0, Math.floor(s)); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * The previews of a video `duration` seconds long: its start and each minute mark after it (every
 * few minutes instead when that would be more than `max`). `mark` is what it's labelled, `at` the
 * moment shown (the start a second in, past a black first frame).
 * @param {number} duration @returns {{ mark: number, at: number, label: string }[]}
 */
export function minuteMarks(duration, { max = 120 } = {}) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const minutes = Math.floor(duration / 60);
  const step = 60 * Math.max(1, Math.ceil(minutes / Math.max(1, max - 1)));
  const out = [{ mark: 0, at: Math.min(1, duration / 2), label: formatTime(0) }];
  for (let t = step; t < duration - 0.5; t += step) out.push({ mark: t, at: t, label: formatTime(t) });
  return out;
}

/** Closer looks inside one span (a minute): every `every` s from `from` until `to`. */
export function closerMarks(from, to, every = 10) {
  const out = [];
  for (let t = from; t < to - 0.25; t += every) out.push({ mark: t, at: t === 0 ? Math.min(1, to / 2) : t, label: formatTime(t) });
  return out;
}

/** What kind of video the first bytes are, or null. @param {Uint8Array} b */
export function sniffVideo(b) {
  const s = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 12 && s(4, 4) === 'ftyp') return s(8, 4) === 'qt  ' ? 'mov' : 'mp4';
  if (b.length >= 8 && ['moov', 'mdat', 'free', 'wide', 'skip'].includes(s(4, 4))) return 'mp4';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return s(0, Math.min(64, b.length)).includes('webm') ? 'webm' : 'mkv';
  if (b.length >= 4 && s(0, 4) === 'OggS') return 'ogv';
  if (b.length >= 12 && s(0, 4) === 'RIFF' && s(8, 4) === 'AVI ') return 'avi';
  if (b.length >= 3 && s(0, 3) === 'FLV') return 'flv';
  if (b.length >= 189 && b[0] === 0x47 && b[188] === 0x47) return 'ts';
  return null;
}

/** @type {Record<string, string>} */
export const MIME = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg', avi: 'video/x-msvideo', flv: 'video/x-flv', ts: 'video/mp2t' };
/** Names to show for each kind. */
export const KIND_NAME = { mp4: 'MP4', mov: 'MOV', webm: 'WebM', mkv: 'MKV', ogv: 'Ogg', avi: 'AVI', flv: 'FLV', ts: 'MPEG-TS' };

/**
 * A safe file name for the video: from the address's last part (or "video"), without characters a
 * phone's files won't take, ending in its kind's extension (a part: its times added).
 * @param {string} url @param {string} kind @param {string} [suffix]
 */
export function fileNameFor(url, kind, suffix = '') {
  let last = '';
  try { last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''); } catch { /* keep "" */ }
  // eslint-disable-next-line no-control-regex
  let stem = last.replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 80).trim();
  if (!stem) stem = 'video';
  return `${stem}${suffix}.${kind}`;
}

export class DownloadError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) { super(message); this.code = code; this.name = 'DownloadError'; }
}

/** Content types that are surely not a video file. */
const NOT_VIDEO_TYPE = /^(text\/|application\/(json|xml|xhtml|javascript|x-javascript|pdf|zip|x-msdownload|vnd\.android|x-apple-diskimage)|image\/|audio\/mpegurl|application\/(x-)?mpegurl|application\/vnd\.apple\.mpegurl|application\/dash\+xml)/i;
/** With "only files labelled as video": the types that count. */
const VIDEO_TYPE = /^(video\/|application\/mp4$)/i;

/** Whether a response's type is refused (a reason) or fine (null). @param {string} type @param {boolean} strict */
export function typeProblem(type, strict) {
  if (type && NOT_VIDEO_TYPE.test(type)) return `The link gives a ${type} file, not a video.`;
  if (strict && !VIDEO_TYPE.test(type)) return `The site doesn't label it as a video (${type || 'no type given'}), and you've chosen to accept only files labelled as video.`;
  return null;
}

const FETCH = /** @type {const} */ ({ mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', cache: 'no-store' });
const cancel = (res) => { res?.body?.cancel().catch(() => {}); };

/**
 * Asks the site about the file without downloading it: its size, type and date (a HEAD request), and
 * its first bytes (a request for just those, which also shows whether it can be resumed). Null when
 * the site doesn't let apps ask (then the download says why). Refused like downloadVideo.
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal, strict?: boolean }} [o]
 * @returns {Promise<{ total: number, type: string, kind: string|null, ranges: boolean, lastModified: string }|null>}
 */
export async function preflight(url, { fetchImpl = globalThis.fetch, signal, strict = false } = {}) {
  let total = 0; let type = ''; let lastModified = ''; let any = false;
  try {
    const h = await fetchImpl(url, { ...FETCH, method: 'HEAD', signal });
    if (h.ok) { any = true; total = Number(h.headers.get('content-length')) || 0; type = (h.headers.get('content-type') ?? '').split(';')[0].trim(); lastModified = h.headers.get('last-modified') ?? ''; }
    await redirectProblem(url, h);
  } catch (e) { if (e instanceof DownloadError || signal?.aborted) throw e; /* HEAD not allowed: try the range */ }
  let kind = null; let ranges = false;
  try {
    const r = await fetchImpl(url, { ...FETCH, method: 'GET', headers: { range: 'bytes=0-4095' }, signal });
    await redirectProblem(url, r);
    if (r.ok) {
      any = true; ranges = r.status === 206;
      type ||= (r.headers.get('content-type') ?? '').split(';')[0].trim();
      lastModified ||= r.headers.get('last-modified') ?? '';
      if (!ranges && !total) total = Number(r.headers.get('content-length')) || 0;
      const cr = /\/(\d+)\s*$/.exec(r.headers.get('content-range') ?? ''); if (cr && !total) total = Number(cr[1]);
      kind = sniffVideo(await firstBytes(r, 4096));
    } else cancel(r);
  } catch (e) { if (e instanceof DownloadError || signal?.aborted) throw e; }
  if (!any) return null;
  const bad = typeProblem(type, strict); if (bad) throw new DownloadError('not-video', bad);
  if (kind === null && ranges) throw new DownloadError('not-video', 'What the link gives isn\'t a video file.');
  return { total, type, kind, ranges, lastModified };
}

/** Refused when a redirect went to a link that wouldn't pass. */
async function redirectProblem(url, res) {
  if (res.url && res.url !== url) {
    const again = checkVideoLink(res.url);
    if (again.ok === false) { cancel(res); throw new DownloadError('redirect', `It was sent on to another address that isn't safe: ${again.reasons[0].title}.`); }
  }
}

/** Up to n bytes of a response, the rest not read. @param {Response} res @param {number} n */
async function firstBytes(res, n) {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader(); const got = []; let len = 0;
  while (len < n) { const { done, value } = await reader.read(); if (done) break; got.push(value); len += value.length; }
  reader.cancel().catch(() => {});
  return head(got, n);
}

/**
 * Downloads the video at `url` (already passed by checkVideoLink), from byte `start` (a resume: only
 * when the site sends ranges, and the file hasn't changed since: same size and date). No cookies,
 * no referrer. Refused if it was sent on to a link that wouldn't pass, if it's (or its first bytes
 * are) not a video, or past `maxBytes`. Each piece goes to `onChunk` as it arrives (nothing kept),
 * `onProgress({ loaded, total })` counts from the start of the file. Resolves { kind, total,
 * lastModified, ranges, url } ; rejects with a DownloadError (code: 'blocked' when the site doesn't
 * let apps fetch it or the connection failed, 'http', 'redirect', 'not-video', 'too-big', 'changed',
 * 'aborted').
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal, onChunk: (b: Uint8Array) => (void|Promise<void>), onProgress?: (p: { loaded: number, total: number }) => void,
 *   maxBytes?: number, start?: number, expect?: { total?: number, lastModified?: string }, strict?: boolean }} o
 */
export async function downloadVideo(url, { fetchImpl = globalThis.fetch, signal, onChunk, onProgress = () => {}, maxBytes = MAX_BYTES, start = 0, expect = {}, strict = false }) {
  let res;
  try {
    res = await fetchImpl(url, { ...FETCH, method: 'GET', signal, ...(start ? { headers: { range: `bytes=${start}-` } } : {}) });
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') throw new DownloadError('aborted', 'Stopped.');
    throw new DownloadError('blocked', 'The site didn\'t let this app download it (or the connection failed).');
  }
  if (start && res.status === 416) { cancel(res); throw new DownloadError('changed', 'The file on the site has changed since: it has to start over.'); }
  if (!res.ok) { cancel(res); throw new DownloadError('http', `The site answered ${res.status}${res.statusText ? ` (${res.statusText})` : ''}.`); }
  await redirectProblem(url, res);
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  const bad = typeProblem(type, strict); if (bad) { cancel(res); throw new DownloadError('not-video', bad); }
  const lastModified = res.headers.get('last-modified') ?? '';
  const length = Number(res.headers.get('content-length')) || 0;
  if (start) {
    // A resume: the rest of the same file, or start over.
    const same = res.status === 206 && (!expect.total || !length || start + length === expect.total) && (!expect.lastModified || !lastModified || lastModified === expect.lastModified);
    if (!same) { cancel(res); throw new DownloadError('changed', res.status === 206 ? 'The file on the site has changed since: it has to start over.' : 'The site can\'t continue where it stopped: it has to start over.'); }
  }
  const total = start ? (expect.total || (length ? start + length : 0)) : length;
  if (total > maxBytes) { cancel(res); throw new DownloadError('too-big', `It's ${Math.round(total / 1024 ** 2)} MB, more than there's room for.`); }
  if (!res.body) throw new DownloadError('blocked', 'The site sent nothing to read.');

  const reader = res.body.getReader();
  let loaded = start; let kind = null; const firstGot = [];
  const stop = async (/** @type {DownloadError} */ err) => { await reader.cancel().catch(() => {}); throw err; };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.length;
      if (loaded > maxBytes) await stop(new DownloadError('too-big', 'It\'s bigger than there\'s room for.'));
      // What it is, from its first bytes (enough of them for every kind), before any is kept.
      if (!start && !kind) {
        firstGot.push(value);
        if (loaded < 256) continue;
        kind = sniffVideo(head(firstGot, 256));
        if (!kind) await stop(new DownloadError('not-video', 'What the link gives isn\'t a video file.'));
        for (const c of firstGot) await onChunk(c);
        firstGot.length = 0;
      } else await onChunk(value);
      onProgress({ loaded, total });
    }
  } catch (e) {
    if (e instanceof DownloadError) throw e;
    if (signal?.aborted || e?.name === 'AbortError') throw new DownloadError('aborted', 'Stopped.');
    throw new DownloadError('cut', 'The connection dropped before it finished.');
  }
  if (firstGot.length) {
    kind = sniffVideo(head(firstGot, 256));
    if (!kind) throw new DownloadError('not-video', 'What the link gives isn\'t a video file.');
    for (const c of firstGot) await onChunk(c);
    onProgress({ loaded, total });
  }
  if (total && loaded < total) throw new DownloadError('cut', 'The connection dropped before it finished.');
  return { kind, total: total || loaded, lastModified, ranges: res.status === 206 || res.headers.get('accept-ranges') === 'bytes', url: res.url || url };
}

/**
 * The file on its site as a Source (mp4.js), read a range at a time (the site must send ranges).
 * @param {string} url @param {number} size @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [o]
 * @returns {import('./mp4.js').Source}
 */
export function remoteSource(url, size, { fetchImpl = globalThis.fetch, signal } = {}) {
  return {
    size,
    async read(offset, length) {
      const end = Math.min(size, offset + length) - 1;
      if (end < offset) return new Uint8Array(0);
      let res;
      try { res = await fetchImpl(url, { ...FETCH, method: 'GET', headers: { range: `bytes=${offset}-${end}` }, signal }); } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') throw new DownloadError('aborted', 'Stopped.');
        throw new DownloadError('cut', 'The connection failed.');
      }
      if (res.status !== 206) { cancel(res); throw new DownloadError('changed', 'The site stopped sending parts of the file.'); }
      await redirectProblem(url, res);
      const b = new Uint8Array(await res.arrayBuffer());
      if (b.length !== end - offset + 1) throw new DownloadError('changed', 'The site sent a different part than asked for.');
      return b;
    },
  };
}

/**
 * The bytes of a planned part (mp4.js planPart: its header, then source ranges), from output byte
 * `from` on, to `onChunk`, near ranges fetched together (a few MB at a time).
 * @param {import('./mp4.js').Source} src @param {{ head: Uint8Array, ranges: { offset: number, length: number }[] }} plan
 * @param {{ from?: number, onChunk: (b: Uint8Array) => (void|Promise<void>), onProgress?: (done: number) => void, gap?: number, span?: number }} o
 */
export async function streamPart(src, plan, { from = 0, onChunk, onProgress = () => {}, gap = 64 * 1024, span = 4 * 1024 ** 2 }) {
  let pos = 0;
  if (from < plan.head.length) await onChunk(plan.head.subarray(from));
  pos = plan.head.length; onProgress(Math.max(from, pos));
  // The ranges still to send, each trimmed to start at `from`.
  const todo = [];
  for (const r of plan.ranges) {
    const a = pos; pos += r.length;
    if (pos <= from) continue;
    const skip = Math.max(0, from - a);
    todo.push({ offset: r.offset + skip, length: r.length - skip });
  }
  let done = Math.max(from, plan.head.length);
  // The last span fetched: the ranges after it (in either track) are often inside it.
  let cache = { lo: 0, hi: 0, b: new Uint8Array(0) };
  for (let i = 0; i < todo.length; i++) {
    const r = todo[i];
    if (r.offset < cache.lo || r.offset + r.length > cache.hi) {
      // A span from here covering the next ranges that are close by (at most `span` long).
      let hi = r.offset + r.length;
      for (let j = i + 1; j < todo.length; j++) {
        const t = todo[j]; if (t.offset < r.offset || t.offset + t.length - r.offset > span) break;
        if (t.offset - hi > gap) break;
        hi = Math.max(hi, t.offset + t.length);
      }
      cache = { lo: r.offset, hi, b: await src.read(r.offset, hi - r.offset) };
    }
    const c = cache.b.subarray(r.offset - cache.lo, r.offset - cache.lo + r.length);
    await onChunk(c); done += c.length;
    onProgress(done);
  }
}

/** The first n bytes of the chunks. @param {Uint8Array[]} chunks @param {number} n */
function head(chunks, n) {
  const out = new Uint8Array(Math.min(n, chunks.reduce((s, c) => s + c.length, 0))); let o = 0;
  for (const c of chunks) { if (o >= out.length) break; const k = Math.min(c.length, out.length - o); out.set(c.subarray(0, k), o); o += k; }
  return out;
}
