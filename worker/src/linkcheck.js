// POST /api/linkcheck {"url": "..."}  (bearer CC_API_TOKEN, like the rest of /api)
// Follows a scanned link's redirects from Cloudflare, not from the phone, and reports every hop, the
// final page's title, whether it starts a download, each domain's registration date (RDAP), and Google
// Safe Browsing matches when the optional GSB_API_KEY secret is set.
// Safety: only http(s) on ports 80/443, no private or local hosts, no cookies, bodies capped and never
// returned, nothing logged (links can carry tokens).

import { isPrivateHost, splitHost, parseRdap } from '../../web/tools/qr/link-check.js';

const MAX_HOPS = 8;
const HOP_TIMEOUT_MS = 6000;
const MAX_BODY_BYTES = 256 * 1024;
// Look like the iPhone that would open it: some scam pages show bots something harmless.
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export class LinkError extends Error {}

/** Throws LinkError if the URL must not be fetched from the Worker. */
export function assertFetchable(href) {
  let u;
  try { u = new URL(href); } catch { throw new LinkError('not a valid link'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new LinkError(`only web links can be checked (${u.protocol})`);
  if (u.port && !['80', '443'].includes(u.port)) throw new LinkError(`unusual port :${u.port} not followed`);
  if (u.username || u.password) u.username = u.password = '';
  if (isPrivateHost(u.hostname)) throw new LinkError('points to a local network address, not followed');
  if (/^\d+$/.test(u.hostname.replace(/\./g, '')) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)) throw new LinkError('unusual numeric address, not followed');
  return u;
}

async function readCapped(res, limit = MAX_BODY_BYTES) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = []; let n = 0;
  while (n < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.length;
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(n, limit));
  let o = 0;
  for (const c of chunks) { const part = c.subarray(0, all.length - o); all.set(part, o); o += part.length; if (o >= all.length) break; }
  return new TextDecoder('utf-8', { fatal: false }).decode(all);
}

const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/\s+/g, ' ').trim();
const meta = (html, re) => { const m = re.exec(html); return m ? decodeEntities(m[1]).slice(0, 300) : ''; };

/** What a fetched HTML page says about itself, and whether it sends the browser on. */
export function readPage(html, base) {
  const title = meta(html, /<title[^>]*>([\s\S]{0,500}?)<\/title>/i);
  const description = meta(html, /<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']*)["']/i) || meta(html, /<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["'](?:og:)?description["']/i);
  const siteName = meta(html, /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']*)["']/i);
  const ogTitle = meta(html, /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
  let next = null; let kind = null;
  const refresh = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']\s*\d*\s*;?\s*url\s*=\s*['"]?([^"'>\s]+)/i.exec(html);
  if (refresh) { next = refresh[1]; kind = 'meta'; }
  else if (html.length < 20_000) {
    // Small pages that only bounce you on with a script: follow plain string redirects.
    const js = /(?:window\.|document\.|top\.|self\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']|location\.(?:replace|assign)\(\s*["']([^"']+)["']\s*\)/i.exec(html);
    if (js) { next = js[1] ?? js[2]; kind = 'script'; }
  }
  if (next) { try { next = new URL(decodeEntities(next), base).href; } catch { next = null; } }
  return { title: title || ogTitle, description, siteName, next, kind: next ? kind : null };
}

const DOWNLOAD_TYPES = /^(application\/(octet-stream|vnd\.android\.package-archive|x-apple-aspen-config|x-msdownload|x-msi|x-ms-installer|zip|x-zip-compressed|x-rar-compressed|x-7z-compressed|java-archive|x-sh|x-apple-diskimage)|application\/x-itunes)/i;

export async function traceLink(href, env, { fetchImpl = fetch } = {}) {
  let url = assertFetchable(href).href;
  const hops = [];
  let final = null; let stopped = null;
  const visited = new Set();

  for (let i = 0; i <= MAX_HOPS; i++) {
    if (visited.has(url)) { stopped = 'The link loops back on itself.'; break; }
    visited.add(url);
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'GET', redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' },
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
      });
    } catch (err) {
      hops.push({ url, status: 0, kind: hops.length ? hops[hops.length - 1].next : 'start' });
      final = { url, status: 0, error: err?.name === 'TimeoutError' ? 'No answer within 6 seconds.' : 'Couldn\'t connect (the site may not exist).' };
      break;
    }
    const hop = { url, status: res.status, kind: i === 0 ? 'start' : hops[hops.length - 1].next };
    hops.push(hop);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      res.body?.cancel().catch(() => {});
      let next;
      try { next = new URL(location, url).href; } catch { final = { url, status: res.status, error: 'Redirects to an invalid address.' }; break; }
      try { assertFetchable(next); } catch (err) { hops.push({ url: next, status: 0, kind: 'http' }); stopped = `Next step ${err.message}.`; final = { url: next, status: 0 }; break; }
      hop.next = 'http';
      url = next;
      continue;
    }
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const disposition = res.headers.get('content-disposition') ?? '';
    const fileName = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disposition)?.[1];
    const download = /attachment/i.test(disposition) || DOWNLOAD_TYPES.test(contentType) ? (fileName ? decodeURIComponent(fileName) : 'a file') : null;
    final = { url, status: res.status, contentType, download, size: Number(res.headers.get('content-length')) || null };
    if (!download && /html|xml|text\/plain/.test(contentType)) {
      let html = '';
      try { html = await readCapped(res); } catch { /* keep what the headers said */ }
      const page = readPage(html, url);
      Object.assign(final, { title: page.title, description: page.description, siteName: page.siteName });
      if (page.next && i < MAX_HOPS) {
        try { assertFetchable(page.next); hop.next = page.kind; url = page.next; final = null; continue; } catch { /* stay on this page */ }
      }
    } else {
      res.body?.cancel().catch(() => {});
    }
    break;
  }
  if (!final) { stopped ??= `More than ${MAX_HOPS} redirects.`; final = { url, status: 0 }; }
  for (const h of hops) delete h.next;

  const domains = {};
  const regs = [...new Set(hops.map((h) => { try { return splitHost(new URL(h.url).hostname).registrable; } catch { return null; } }).filter((d) => d && /[a-z]/i.test(d) && !d.includes(':')))].slice(0, 4);
  const [, safeBrowsing] = await Promise.all([
    Promise.all(regs.map((d) => lookupDomain(d, fetchImpl).then((info) => { domains[d] = info; }))),
    checkSafeBrowsing(hops.map((h) => h.url), env, fetchImpl),
  ]);
  return { input: href, hops, final, stopped, domains, safeBrowsing, checkedAt: new Date().toISOString() };
}

export async function lookupDomain(domain, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { accept: 'application/rdap+json, application/json' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { error: res.status === 404 ? 'not found in the registry' : `registry lookup failed (${res.status})` };
    return parseRdap(await res.json()) ?? { error: 'no data' };
  } catch {
    return { error: 'registry lookup failed' };
  }
}

async function checkSafeBrowsing(urls, env, fetchImpl) {
  if (!env.GSB_API_KEY) return { checked: false, matches: [] };
  try {
    const res = await fetchImpl(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(env.GSB_API_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'command-center', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'],
          threatEntries: [...new Set(urls)].slice(0, 20).map((url) => ({ url })),
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { checked: false, matches: [], error: `Safe Browsing answered ${res.status}` };
    const body = await res.json();
    return { checked: true, matches: (body.matches ?? []).map((m) => ({ url: m.threat?.url, threat: m.threatType })) };
  } catch {
    return { checked: false, matches: [], error: 'Safe Browsing lookup failed' };
  }
}
