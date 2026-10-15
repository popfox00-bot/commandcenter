// Pure parsing of a rendered GovDeals search results page. No network, no clock: `now` is passed
// in, so the same HTML always yields the same listings (fixture-testable).

import * as cheerio from 'cheerio';
import { ParseError } from '../../core/errors.js';
import { mergeSelectors } from './selectors.js';

export const BASE_URL = 'https://www.govdeals.com';

const TZ_OFFSETS = {
  UTC: 0, GMT: 0, Z: 0,
  EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7,
  AKST: -9, AKDT: -8, HST: -10, AST: -4, ADT: -3,
};
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/** "$1,250.00" -> 1250. Returns null if no amount is present. */
export function parseMoney(text) {
  const m = clean(text).match(/\$\s?([\d,]+(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an end time from text. Supports:
 *  - ISO strings ("2026-10-18T20:00:00Z")
 *  - "10/18/2026 3:00 PM CDT", "Oct 18, 2026 03:00 PM EDT" (no zone -> UTC, matching the
 *    runner's browser timezone so rendered local times are UTC)
 *  - countdowns relative to `now`: "2d 4h 13m", "3 days 2 hours", "45m 10s"
 * Returns an ISO string or null.
 */
export function parseEndTime(text, now) {
  const t = clean(text);
  if (!t) return null;
  const iso = t.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (iso) {
    const d = new Date(/[Z+-]\d*:?\d*$/.test(iso[0].slice(10)) ? iso[0] : iso[0] + 'Z');
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const time = '(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*([AaPp][Mm])?\\s*([A-Z]{1,4})?';
  let m = t.match(new RegExp(`\\b(\\d{1,2})/(\\d{1,2})/(\\d{4})\\s+(?:at\\s+)?${time}`));
  let y, mo, d, hh, mm, ss, ap, tz;
  if (m) [, mo, d, y, hh, mm, ss, ap, tz] = m;
  else {
    m = t.match(new RegExp(`\\b([A-Za-z]{3,9})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4}),?\\s+(?:at\\s+)?${time}`));
    if (m) { let mon; [, mon, d, y, hh, mm, ss, ap, tz] = m; mo = MONTHS[mon.toLowerCase().slice(0, mon.toLowerCase().startsWith('sept') ? 4 : 3)]; }
  }
  if (m && mo) {
    let hour = Number(hh) % (ap ? 12 : 24);
    if (ap && ap.toLowerCase() === 'pm') hour += 12;
    const offset = tz && tz in TZ_OFFSETS ? TZ_OFFSETS[tz] : 0;
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), hour - offset, Number(mm), Number(ss ?? 0));
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  // Countdown: needs at least one unit.
  const units = { d: 86400, day: 86400, days: 86400, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, s: 1, sec: 1, secs: 1, second: 1, seconds: 1 };
  const parts = [...t.matchAll(/(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi)];
  if (parts.length && now) {
    const secs = parts.reduce((acc, [, n, u]) => acc + Number(n) * units[u.toLowerCase()], 0);
    return new Date(now.getTime() + secs * 1000).toISOString();
  }
  return null;
}

function absoluteUrl(href) {
  try { return new URL(href, BASE_URL).toString(); } catch { return null; }
}

/**
 * Parse listings from a search results page.
 * Returns { listings, noResults }. Throws ParseError if the page has neither listing links
 * nor a "no results" marker (layout changed / page didn't render), or if listing cards are
 * found but the required fields can't be read from most of them (selectors broke).
 */
export function parseSearchResults(html, { now, selectors: overrides, requireEndTime = true } = {}) {
  const sel = mergeSelectors(overrides);
  const $ = cheerio.load(html);
  const hrefRe = new RegExp(sel.listingHref);

  const byKey = new Map();
  $(sel.listingLink).each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const m = href.match(hrefRe);
    if (!m) return;
    const key = `${m[2]}-${m[1]}`; // accountId-assetId: assetIds are only unique per seller account
    if (!byKey.has(key)) byKey.set(key, { key, assetId: m[1], accountId: m[2], href, links: [] });
    byKey.get(key).links.push(a);
  });

  const pageText = clean($('body').text());
  const noResults = $(sel.noResults).length > 0 || new RegExp(sel.noResultsText, 'i').test(pageText);

  if (!byKey.size) {
    if (noResults) return { listings: [], noResults: true };
    throw new ParseError(`GovDeals: no listing links (${sel.listingLink}) and no "no results" marker; the layout probably changed or the page did not render`, { details: { bytes: html.length, title: clean($('title').text()) } });
  }

  const listings = [];
  for (const entry of byKey.values()) {
    const card = findCard($, entry, sel, hrefRe);
    const title = pickTitle($, card, entry, sel);
    const bidSource = card.find(sel.bidText).filter((_, el) => /bid|\$/i.test($(el).text())).first();
    const bidText = clean(bidSource.text()) || (clean(card.text()).match(/(current|high|starting|min(imum)?)?\s*bid[^$]{0,20}\$\s?[\d,]+(\.\d{2})?/i)?.[0] ?? '');
    const currentBid = parseMoney(bidText) ?? parseMoney(clean(card.text()));

    let endTime = null;
    let endTimeText = '';
    const attrEl = card.find(sel.endTimeAttr).first();
    if (attrEl.length) {
      endTimeText = attrEl.attr('data-end-time') ?? attrEl.attr('data-endtime') ?? attrEl.attr('data-auction-end') ?? attrEl.attr('datetime') ?? '';
      endTime = parseEndTime(endTimeText, now);
    }
    if (!endTime) {
      card.find(sel.endText).each((_, el) => {
        if (endTime) return;
        const txt = clean($(el).text());
        const parsed = parseEndTime(txt, now);
        if (parsed) { endTime = parsed; endTimeText = txt; }
      });
    }

    listings.push({
      key: entry.key,
      assetId: entry.assetId,
      accountId: entry.accountId,
      url: absoluteUrl(entry.href),
      title,
      currentBid,
      endTime,
      endTimeText: endTimeText.slice(0, 80),
      location: clean(card.find(sel.location).first().text()).slice(0, 120) || null,
    });
  }

  const missingTitle = listings.filter((l) => !l.title).length;
  const missingBid = listings.filter((l) => l.currentBid == null).length;
  const missingEnd = listings.filter((l) => !l.endTime).length;
  const threshold = Math.ceil(listings.length / 2);
  const broken = [];
  if (missingTitle >= threshold && listings.length) broken.push(`title (${missingTitle}/${listings.length})`);
  if (missingBid >= threshold && listings.length) broken.push(`current bid (${missingBid}/${listings.length})`);
  if (requireEndTime && missingEnd >= threshold && listings.length) broken.push(`end time (${missingEnd}/${listings.length})`);
  if (broken.length) {
    throw new ParseError(`GovDeals: found ${listings.length} listing links but could not read ${broken.join(', ')}; selectors need updating`);
  }

  listings.sort((a, b) => a.key.localeCompare(b.key));
  return { listings: listings.filter((l) => l.title), noResults: false };
}

/** Nearest ancestor that contains this listing's link but no other listing's link. */
function findCard($, entry, sel, hrefRe) {
  const link = $(entry.links[0]);
  const preferred = link.closest(sel.card);
  if (preferred.length && distinctKeys($, preferred, sel, hrefRe) === 1) {
    // Climb further while still single-listing, to include siblings like the bid/time block.
    return climb($, preferred, sel, hrefRe);
  }
  return climb($, link, sel, hrefRe);
}

function climb($, start, sel, hrefRe) {
  let node = start;
  for (let i = 0; i < 8; i++) {
    const parent = node.parent();
    if (!parent.length || parent.is('body') || distinctKeys($, parent, sel, hrefRe) !== 1) break;
    node = parent;
  }
  return node;
}

function distinctKeys($, node, sel, hrefRe) {
  const keys = new Set();
  node.find(sel.listingLink).addBack(sel.listingLink).each((_, a) => {
    const m = ($(a).attr('href') ?? '').match(hrefRe);
    if (m) keys.add(`${m[2]}-${m[1]}`);
  });
  return keys.size;
}

function pickTitle($, card, entry, sel) {
  const heading = clean(card.find(sel.title).filter((_, el) => clean($(el).text()).length > 3 && !/^\$/.test(clean($(el).text()))).first().text());
  if (heading) return heading.slice(0, 300);
  const linkTexts = entry.links.map((a) => clean($(a).text() || $(a).attr('title') || $(a).find('img').attr('alt'))).filter((t) => t.length > 3);
  linkTexts.sort((a, b) => b.length - a.length);
  return (linkTexts[0] ?? '').slice(0, 300);
}
