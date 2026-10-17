// Polite HTTP: robots.txt enforcement, per-host spacing, randomized delays, a realistic UA,
// a small on-disk response cache, and timeouts. Every outbound request a job makes goes through here
// (the browser helper reuses the same robots/rate-limit gate).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FetchError, PolicyError } from './errors.js';
import { parseRobots, checkRobots } from './robots.js';
import { randInt } from './rng.js';
import { sleep } from './retry.js';

export const DEFAULT_CACHE_DIR = resolve(import.meta.dirname, '../../.cc/cache');

/**
 * officialApis: hosts of documented public APIs a job declares it uses (e.g. api.weather.gov). Their
 * robots.txt ("Disallow: /" aimed at search crawlers) is not applied to them; everything else
 * (rate limits, delays, timeouts, cache) still is. Any other host keeps full robots.txt enforcement.
 */
export function createPoliteHttp({ politeness, log, rng, signal, fetchFn = fetch, cacheDir = process.env.CC_CACHE_DIR || DEFAULT_CACHE_DIR, now = () => Date.now(), sleepFn = sleep, officialApis = [] }) {
  const robotsCache = new Map(); // origin -> Promise<groups|null>
  const lastHit = new Map(); // host -> ms
  const apiHosts = new Set(officialApis.map((h) => h.toLowerCase()));
  const noted = new Set();

  async function robotsFor(url) {
    const origin = url.origin;
    if (!robotsCache.has(origin)) {
      robotsCache.set(origin, (async () => {
        try {
          const res = await fetchFn(`${origin}/robots.txt`, { headers: { 'user-agent': politeness.userAgent }, signal: AbortSignal.timeout(15_000) });
          if (res.status >= 400 && res.status < 500) return { groups: [], note: `robots.txt HTTP ${res.status} (treated as allow-all)` };
          if (!res.ok) return { unreachable: true, note: `robots.txt HTTP ${res.status}` };
          return { groups: parseRobots(await res.text()) };
        } catch (err) {
          return { unreachable: true, note: `robots.txt fetch failed: ${err.message}` };
        }
      })());
    }
    return robotsCache.get(origin);
  }

  /** Throws PolicyError if robots.txt disallows the URL. Returns extra crawl delay (ms). */
  async function gate(rawUrl) {
    const url = new URL(rawUrl);
    let crawlDelayMs = 0;
    if (apiHosts.has(url.hostname.toLowerCase())) {
      if (!noted.has(url.hostname)) { noted.add(url.hostname); log.info('robots.txt not applied: declared official API', { host: url.hostname }); }
    } else if (politeness.respectRobots) {
      const robots = await robotsFor(url);
      if (robots.unreachable) {
        // RFC 9309: if robots.txt is unreachable (5xx/network), assume complete disallow.
        throw new FetchError(`Not fetching ${url.origin}: ${robots.note}`, { status: 503 });
      }
      const verdict = checkRobots(robots.groups, url.pathname + url.search);
      if (!verdict.allowed) throw new PolicyError(`robots.txt disallows ${url.pathname} (${verdict.rule})`);
      crawlDelayMs = (verdict.crawlDelay ?? 0) * 1000;
    }
    const spacing = Math.max(politeness.perHostIntervalMs, crawlDelayMs);
    const jitter = randInt(rng, politeness.minDelayMs, politeness.maxDelayMs);
    const since = now() - (lastHit.get(url.host) ?? -Infinity);
    const wait = Math.max(jitter, spacing - since);
    if (wait > 0) {
      log.debug('polite delay', { host: url.host, ms: wait });
      await sleepFn(wait, signal);
    }
    lastHit.set(url.host, now());
  }

  function cachePath(key) {
    return join(cacheDir, createHash('sha256').update(key).digest('hex').slice(0, 32) + '.json');
  }

  function cacheGet(key) {
    if (!politeness.cacheTtlSec) return null;
    const p = cachePath(key);
    if (!existsSync(p)) return null;
    try {
      const entry = JSON.parse(readFileSync(p, 'utf8'));
      if (now() - entry.storedAt > politeness.cacheTtlSec * 1000) return null;
      return entry;
    } catch { return null; }
  }

  function cachePut(key, value) {
    if (!politeness.cacheTtlSec) return;
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath(key), JSON.stringify({ ...value, storedAt: now() }));
  }

  /** GET (or other method) a URL politely. Returns { status, url, headers, text, fromCache }. */
  async function request(rawUrl, { method = 'GET', headers = {}, body, cache = method === 'GET', timeoutMs = 30_000 } = {}) {
    const cacheKey = `http:${method}:${rawUrl}`;
    if (cache) {
      const hit = cacheGet(cacheKey);
      if (hit) { log.debug('cache hit', { url: rawUrl }); return { ...hit, fromCache: true }; }
    }
    await gate(rawUrl);
    let res;
    try {
      res = await fetchFn(rawUrl, {
        method, body,
        headers: { 'user-agent': politeness.userAgent, 'accept-language': 'en-US,en;q=0.9', ...headers },
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
      });
    } catch (err) {
      const why = err.cause?.code || err.cause?.message || err.name;
      throw new FetchError(`${method} ${rawUrl} failed: ${err.message}${why && why !== err.message ? ` (${why})` : ''}`, { cause: err });
    }
    const text = await res.text();
    log.info('http', { method, url: rawUrl, status: res.status, bytes: text.length });
    if (!res.ok) throw new FetchError(`${method} ${rawUrl} -> HTTP ${res.status}`, { status: res.status });
    const out = { status: res.status, url: res.url || rawUrl, headers: Object.fromEntries(res.headers), text };
    if (cache) cachePut(cacheKey, out);
    return { ...out, fromCache: false };
  }

  return {
    gate,
    request,
    text: async (url, opts) => (await request(url, opts)).text,
    json: async (url, opts) => {
      const r = await request(url, { ...opts, headers: { accept: 'application/json', ...(opts?.headers ?? {}) } });
      try { return JSON.parse(r.text); } catch { throw new FetchError(`${url} did not return JSON`); }
    },
    cacheGet,
    cachePut,
  };
}
