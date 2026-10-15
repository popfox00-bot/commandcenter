// GovDeals watcher: saved searches -> new-match alerts, plus "ending soon" alerts for listings
// that still match a search and close within a configured window.
//
// Access: GovDeals has no public API, so this renders the public search page in headless
// Chromium (it is a JavaScript app) at a low rate, honoring robots.txt. Nothing logs in.

import { z } from 'zod';
import { parseSearchResults, BASE_URL } from './parse.js';
import { ParseError } from '../../core/errors.js';
import { DEFAULT_SELECTORS } from './selectors.js';

const searchSchema = z.object({
  /** Stable id used in logs and item fields; defaults to a slug of the keywords. */
  id: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
  keywords: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  zip: z.string().regex(/^\d{5}$/, 'zip must be 5 digits').optional(),
  maxDistanceMiles: z.number().int().positive().max(5000).optional(),
  maxBid: z.number().nonnegative().optional(),
  /** Drop listings whose title contains any of these (case-insensitive). */
  excludeKeywords: z.array(z.string().min(1)).default([]),
  /** Alternative to keywords/zip/category: paste a search URL copied from govdeals.com. */
  url: z.string().url().refine((u) => new URL(u).hostname.endsWith('govdeals.com'), 'url must be on govdeals.com').optional(),
}).strict().refine((s) => s.keywords || s.url, { message: 'each search needs keywords or url' })
  .refine((s) => !s.maxDistanceMiles || s.zip || s.url, { message: 'maxDistanceMiles needs zip' });

export const configSchema = z.object({
  searches: z.array(searchSchema).min(1),
  endingSoon: z.object({
    enabled: z.boolean().default(true),
    /** Alert once per listing when it enters the smallest window it falls in (hours). */
    windowsHours: z.array(z.number().positive().max(24 * 14)).min(1).default([6]),
  }).strict().default({ enabled: true, windowsHours: [6] }),
  /**
   * Search URL template. {keywords} {zip} {miles} {category} are URL-encoded; params whose value
   * is empty are dropped. ASSUMPTION: matches GovDeals' current search URL. If not, copy a real
   * search URL into `url:` on each search instead.
   */
  searchUrlTemplate: z.string().default(`${BASE_URL}/en/search?kWord={keywords}&zipcode={zip}&miles={miles}&category={category}`),
  /** Fail the run if most listings have no readable end time (needed for ending-soon). */
  requireEndTime: z.boolean().default(true),
  selectors: z.object(Object.fromEntries(Object.keys(DEFAULT_SELECTORS).map((k) => [k, z.string().min(1).optional()]))).strict().default({}),
}).strict();

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'search';

export function buildSearchUrl(search, template) {
  if (search.url) return search.url;
  const values = { keywords: search.keywords ?? '', zip: search.zip ?? '', miles: search.maxDistanceMiles ? String(search.maxDistanceMiles) : '', category: search.category ?? '' };
  const filled = template.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(values[k] ?? ''));
  const url = new URL(filled);
  for (const [k, v] of [...url.searchParams.entries()]) if (v === '') url.searchParams.delete(k);
  return url.toString();
}

export function formatDuration(ms) {
  if (ms <= 0) return 'now';
  const m = Math.round(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return [d && `${d}d`, h && `${h}h`, (!d && mm) && `${mm}m`].filter(Boolean).join(' ') || '<1m';
}

const money = (n) => (n == null ? 'n/a' : `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`);

/**
 * Turn per-search parse results into normalized items. Pure (testable without a browser).
 * A listing matching several searches becomes one item listing all of them.
 */
export function toItems(resultsBySearch, settings, now) {
  const byKey = new Map();
  for (const { search, listings } of resultsBySearch) {
    const excludes = search.excludeKeywords.map((x) => x.toLowerCase());
    for (const l of listings) {
      if (search.maxBid != null && l.currentBid != null && l.currentBid > search.maxBid) continue;
      if (excludes.some((x) => l.title.toLowerCase().includes(x))) continue;
      if (l.endTime && Date.parse(l.endTime) <= now.getTime()) continue; // already closed
      const existing = byKey.get(l.key);
      if (existing) { existing.searches.push(search.id); continue; }
      byKey.set(l.key, { ...l, searches: [search.id] });
    }
  }

  const items = [];
  const windows = [...settings.endingSoon.windowsHours].sort((a, b) => a - b);
  for (const l of [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const fields = { assetId: l.assetId, accountId: l.accountId, currentBid: l.currentBid, endTime: l.endTime, endTimeText: l.endTimeText, location: l.location, searches: l.searches };
    items.push({ type: 'match', key: l.key, title: l.title, url: l.url, fields, timestamp: now });
    if (settings.endingSoon.enabled && l.endTime) {
      const remaining = Date.parse(l.endTime) - now.getTime();
      const win = windows.find((w) => remaining <= w * 3600_000);
      if (win != null && remaining > 0) {
        items.push({ type: 'ending_soon', key: `${l.key}@${win}h`, title: l.title, url: l.url, fields: { ...fields, windowHours: win, remainingMs: remaining }, timestamp: now });
      }
    }
  }
  return items;
}

export default {
  id: 'govdeals',
  name: 'GovDeals watcher',
  description: 'Saved GovDeals searches: alerts for new matches and listings ending soon.',
  schedule: '17 */3 * * *',
  configSchema,
  ui: { primary: 'current', sortBy: 'endTime', types: ['match', 'ending_soon'] },

  formatNotification(item) {
    const f = item.fields;
    const ends = f.endTime ? new Date(f.endTime) : null;
    const endsText = ends ? `${ends.toUTCString().replace(':00 GMT', ' UTC')}` : f.endTimeText || 'unknown';
    if (item.type === 'ending_soon') {
      return {
        title: `⏰ Ends in ${formatDuration(f.remainingMs)}: ${item.title}`.slice(0, 200),
        message: `Current bid: ${money(f.currentBid)}\nEnds: ${endsText}${f.location ? `\n${f.location}` : ''}`,
        url: item.url,
        priority: 'high',
        tags: ['alarm_clock'],
      };
    }
    return {
      title: `🏷️ ${item.title}`.slice(0, 200),
      message: `Current bid: ${money(f.currentBid)}\nEnds: ${endsText}${f.location ? `\n${f.location}` : ''}\nSearch: ${f.searches.join(', ')}`,
      url: item.url,
      tags: ['moneybag'],
    };
  },

  async run(ctx) {
    const { settings } = ctx;
    const results = [];
    for (const [i, raw] of settings.searches.entries()) {
      const search = { ...raw, id: raw.id ?? slug(raw.keywords ?? `search-${i + 1}`) };
      const url = buildSearchUrl(search, settings.searchUrlTemplate);
      if (i > 0) await ctx.pause();
      const page = await ctx.page(url, { render: true, waitForAny: [settings.selectors.ready ?? DEFAULT_SELECTORS.ready] });
      let parsed;
      try {
        parsed = parseSearchResults(page.html, { now: ctx.now, selectors: settings.selectors, requireEndTime: settings.requireEndTime });
      } catch (err) {
        if (err instanceof ParseError) err.message = `[search "${search.id}"] ${err.message}`;
        throw err;
      }
      ctx.log.info('search parsed', { search: search.id, url, listings: parsed.listings.length, noResults: parsed.noResults, fromCache: page.fromCache });
      results.push({ search, listings: parsed.listings });
    }
    return toItems(results, settings, ctx.now);
  },
};
