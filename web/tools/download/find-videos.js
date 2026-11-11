// @ts-check
// The video files a web page has in it, read from its HTML (no script run): <video> and its
// <source>s, og:video / twitter:player:stream tags, structured data (a VideoObject's contentUrl),
// links to video files, and video addresses in the page's scripts (players often keep them there).
// Streaming playlists (.m3u8 / .mpd) are counted but not listed: they can't be saved as one file.
// Used by the Worker's /api/findvideos (which fetches the page), and tested on its own. Pure.

/** Addresses of video files, by their ending. */
const VIDEO_FILE = /\.(mp4|m4v|webm|mov|mkv|ogv)(?:$|[?#])/i;
const STREAM = /\.(m3u8|mpd)(?:$|[?#])/i;
const MAX = 30;

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\\//g, '/').replace(/\\u0026/gi, '&').trim();
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? decode(m[1] ?? m[2] ?? m[3] ?? '') : ''; };

/**
 * @typedef {{ url: string, from: 'video'|'meta'|'data'|'link'|'script', type: string, title: string, poster: string }} Found
 * @param {string} html @param {string} base the page's address
 * @returns {{ title: string, videos: Found[], streams: number }}
 */
export function findVideos(html, base) {
  /** @type {Map<string, Found>} */
  const found = new Map(); let streams = 0;
  const pageTitle = decode((/<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' '));
  const add = (raw, from, extra = {}) => {
    if (!raw || found.size >= MAX) return;
    let u; try { u = new URL(decode(raw), base); } catch { return; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
    u.hash = '';
    if (STREAM.test(u.pathname)) { streams++; return; }
    const isFile = VIDEO_FILE.test(u.pathname);
    // A <video>'s or a tag's own address counts even without a video ending; a link or a script's only with one.
    if (!isFile && (from === 'link' || from === 'script')) return;
    const key = u.href;
    const prev = found.get(key);
    if (prev) { if (!prev.title && extra.title) prev.title = extra.title; if (!prev.poster && extra.poster) prev.poster = extra.poster; return; }
    found.set(key, { url: key, from, type: extra.type ?? '', title: extra.title ?? '', poster: extra.poster ? safe(extra.poster, base) : '' });
  };

  // <video src> and its <source>s.
  for (const m of html.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)) {
    const tag = `<video${m[1]}>`; const title = attr(tag, 'title') || attr(tag, 'aria-label'); const poster = attr(tag, 'poster');
    add(attr(tag, 'src') || attr(tag, 'data-src'), 'video', { title, poster });
    for (const s of m[2].matchAll(/<source\b[^>]*>/gi)) {
      const type = attr(s[0], 'type');
      if (type && !/^video\//i.test(type) && !/mpegurl|dash/i.test(type)) continue;
      add(attr(s[0], 'src') || attr(s[0], 'data-src'), 'video', { title, poster, type });
    }
  }
  for (const m of html.matchAll(/<video\b[^>]*\/?>/gi)) add(attr(m[0], 'src') || attr(m[0], 'data-src'), 'video', { poster: attr(m[0], 'poster') });
  // og:video, twitter:player:stream.
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], 'property') || attr(m[0], 'name')).toLowerCase();
    if (/^og:video(:url|:secure_url)?$|^twitter:player:stream$/.test(key)) add(attr(m[0], 'content'), 'meta', { title: pageTitle });
  }
  // Structured data: a VideoObject's contentUrl.
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1]); } catch { continue; }
    const walk = (o, depth = 0) => {
      if (!o || typeof o !== 'object' || depth > 6) return;
      if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
      if (/VideoObject/i.test(String(o['@type'] ?? '')) && typeof o.contentUrl === 'string') add(o.contentUrl, 'data', { title: typeof o.name === 'string' ? o.name : '', poster: typeof o.thumbnailUrl === 'string' ? o.thumbnailUrl : Array.isArray(o.thumbnailUrl) ? o.thumbnailUrl[0] : '' });
      for (const v of Object.values(o)) walk(v, depth + 1);
    };
    walk(data);
  }
  // Links to video files.
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) add(attr(m[0], 'href'), 'link', { title: attr(m[0], 'title') || attr(m[0], 'download') });
  // Video addresses in scripts (player settings).
  for (const m of html.matchAll(/https?:(?:\\?\/){2}[^"'\s<>()]+?\.(?:mp4|m4v|webm|mov|m3u8|mpd)(?:\?[^"'\s<>()]*)?(?=["'\s<>()]|$)/gi)) add(m[0], 'script');

  return { title: pageTitle, videos: [...found.values()], streams };
}

/** An image address made absolute (http(s) only), or ''. */
function safe(raw, base) {
  try { const u = new URL(decode(raw), base); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch { return ''; }
}

/** Whether an address looks like a video file itself (then there's nothing to find on it). */
export const looksLikeVideoFile = (href) => { try { return VIDEO_FILE.test(new URL(href).pathname); } catch { return false; } };
