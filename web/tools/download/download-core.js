// @ts-check
// Files → Download: the parts with no screen (tested in Node). Whether a video link is safe to fetch
// (https only, no sign-in in the address, not a device on your own network, not a link the QR app's
// checker flags as a scam), the minute marks to show previews at, and the download itself: straight
// from the link's own site to this phone, no cookies or sign-ins sent, stopped at once if what comes
// back isn't a video file (a web page, a playlist, an app) or grows past the size limit.

import { analyzeUrl, isPrivateHost } from '../qr/link-check.js';

/** The most it will download (kept in the phone's memory until saved). */
export const MAX_BYTES = 2 * 1024 ** 3;
/** Above this, it says so before starting (a phone may run short of memory). */
export const LARGE_BYTES = 500 * 1024 ** 2;

/** Addresses that are a streaming playlist (many small pieces), not one video file. */
const PLAYLIST = /\.(m3u8?|mpd|f4m|ism)(\/|$)/i;
/** Addresses that are plainly not a video. */
const NOT_VIDEO = /\.(exe|msi|apk|ipa|dmg|pkg|deb|rpm|appimage|bat|cmd|com|scr|ps1|sh|jar|js|mjs|html?|php|aspx?|svg|zip|rar|7z|gz|tar|iso|img|bin|pdf|docx?|xlsx?|pptx?|mobileconfig)$/i;

/**
 * @typedef {{ title: string, detail: string }} Note
 * @typedef {{ ok: true, url: string, host: string, warnings: Note[] } | { ok: false, reasons: Note[] }} LinkCheck
 */

/**
 * Whether a pasted link may be fetched. Refused: not https, a name and password in it, a device on
 * your own network, a streaming playlist or a file that isn't a video, or anything the link checker
 * calls dangerous. Its cautions (an odd port, a cheap domain ending, a short link...) are `warnings`,
 * to read before going on. @param {string} input @returns {LinkCheck}
 */
export function checkVideoLink(input) {
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
  return { ok: true, url: u.href, host: a.unicodeHost || u.hostname, warnings };
}

/** @param {string} title @param {string} detail @returns {LinkCheck} */
const refuse = (title, detail) => ({ ok: false, reasons: [{ title, detail }] });

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

/**
 * A safe file name for the video: from the address's last part (or "video"), without characters a
 * phone's files won't take, ending in its kind's extension. @param {string} url @param {string} kind
 */
export function fileNameFor(url, kind) {
  let last = '';
  try { last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''); } catch { /* keep "" */ }
  // eslint-disable-next-line no-control-regex
  let stem = last.replace(/\.[^.]*$/, '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').replace(/\s+/g, ' ').slice(0, 80).trim();
  if (!stem) stem = 'video';
  return `${stem}.${kind}`;
}

export class DownloadError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) { super(message); this.code = code; this.name = 'DownloadError'; }
}

/** Content types that are surely not a video file. */
const NOT_VIDEO_TYPE = /^(text\/|application\/(json|xml|xhtml|javascript|x-javascript|pdf|zip|x-msdownload|vnd\.android|x-apple-diskimage)|image\/|audio\/mpegurl|application\/(x-)?mpegurl|application\/vnd\.apple\.mpegurl|application\/dash\+xml)/i;

/**
 * Downloads the video at `url` (already passed by checkVideoLink): no cookies, no referrer, nothing
 * else fetched. Refused if it was sent on to a link that wouldn't pass, if it says it's (or its
 * first bytes are) not a video, or once it's bigger than `maxBytes`. `onProgress({ loaded, total })`
 * (total: 0 when the site doesn't say). Resolves { blob, kind, name, size }; rejects with a
 * DownloadError (code: 'blocked' when the site doesn't let apps fetch it, 'http', 'redirect',
 * 'not-video', 'too-big', 'aborted').
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal, onProgress?: (p: { loaded: number, total: number }) => void, maxBytes?: number }} [o]
 */
export async function downloadVideo(url, { fetchImpl = globalThis.fetch, signal, onProgress = () => {}, maxBytes = MAX_BYTES } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow', cache: 'no-store', signal });
  } catch (e) {
    if (signal?.aborted || e?.name === 'AbortError') throw new DownloadError('aborted', 'Stopped.');
    throw new DownloadError('blocked', 'The site didn\'t let this app download it (or the connection failed).');
  }
  if (!res.ok) throw new DownloadError('http', `The site answered ${res.status}${res.statusText ? ` (${res.statusText})` : ''}.`);
  if (res.url && res.url !== url) {
    const again = checkVideoLink(res.url);
    if (again.ok === false) { res.body?.cancel().catch(() => {}); throw new DownloadError('redirect', `It was sent on to another address that isn't safe: ${again.reasons[0].title}.`); }
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (type && NOT_VIDEO_TYPE.test(type)) { res.body?.cancel().catch(() => {}); throw new DownloadError('not-video', `The link gives a ${type} file, not a video.`); }
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > maxBytes) { res.body?.cancel().catch(() => {}); throw new DownloadError('too-big', `It's ${Math.round(total / 1024 ** 2)} MB, more than this app downloads.`); }
  if (!res.body) throw new DownloadError('blocked', 'The site sent nothing to read.');

  const reader = res.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = []; let loaded = 0; let kind = null;
  const stop = async (/** @type {DownloadError} */ err) => { await reader.cancel().catch(() => {}); throw err; };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.length;
      if (loaded > maxBytes) await stop(new DownloadError('too-big', 'It\'s bigger than this app downloads.'));
      // What it is, from its first bytes (enough of them for every kind).
      if (!kind && loaded >= 256) {
        kind = sniffVideo(head(chunks, 256));
        if (!kind) await stop(new DownloadError('not-video', 'What the link gives isn\'t a video file.'));
      }
      onProgress({ loaded, total });
    }
  } catch (e) {
    if (e instanceof DownloadError) throw e;
    if (signal?.aborted || e?.name === 'AbortError') throw new DownloadError('aborted', 'Stopped.');
    throw new DownloadError('blocked', 'The download was cut off.');
  }
  kind ??= sniffVideo(head(chunks, 256));
  if (!kind) throw new DownloadError('not-video', 'What the link gives isn\'t a video file.');
  const blob = new Blob(chunks, { type: MIME[kind] });
  return { blob, kind, name: fileNameFor(res.url || url, kind), size: loaded };
}

/** The first n bytes of the chunks. @param {Uint8Array[]} chunks @param {number} n */
function head(chunks, n) {
  const out = new Uint8Array(Math.min(n, chunks.reduce((s, c) => s + c.length, 0))); let o = 0;
  for (const c of chunks) { if (o >= out.length) break; const k = Math.min(c.length, out.length - o); out.set(c.subarray(0, k), o); o += k; }
  return out;
}
