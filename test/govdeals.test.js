import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import govdeals, { configSchema, toItems, buildSearchUrl } from '../src/jobs/govdeals/index.js';
import { parseSearchResults, parseEndTime, parseMoney } from '../src/jobs/govdeals/parse.js';
import { ParseError } from '../src/core/errors.js';
import { runJob } from '../src/core/runner.js';
import { configFor, memoryStore, recordingNotifier, quietLog, noSleep } from './helpers/harness.js';

const fixture = (name) => readFileSync(resolve(import.meta.dirname, 'fixtures/govdeals', name), 'utf8');
const NOW = new Date('2026-10-15T12:00:00Z');

test('parses listing cards from the saved search page', () => {
  const { listings, noResults } = parseSearchResults(fixture('search-results.html'), { now: NOW });
  assert.equal(noResults, false);
  assert.equal(listings.length, 6, 'sidebar link to an existing listing does not duplicate it');
  const hyster = listings.find((l) => l.assetId === '1001');
  assert.deepEqual(hyster, {
    key: '2001-1001', assetId: '1001', accountId: '2001',
    url: 'https://www.govdeals.com/en/asset/1001/2001',
    title: '2015 Hyster S50FT Forklift', currentBid: 1250,
    endTime: '2026-10-18T20:00:00.000Z', endTimeText: 'Auction Ends: 10/18/2026 3:00 PM CDT', location: 'Austin, TX',
  });
  assert.equal(listings.find((l) => l.assetId === '1002').endTime, '2026-10-20T19:30:00.000Z', '<time datetime> wins');
  assert.equal(listings.find((l) => l.assetId === '777').endTime, '2026-10-15T15:00:00.000Z', 'data-end-time attribute');
  assert.equal(listings.find((l) => l.assetId === '553').endTime, '2026-10-16T14:05:00.000Z', 'countdown relative to now');
  assert.equal(listings.find((l) => l.assetId === '888').endTime, '2026-10-19T16:15:00.000Z', 'month-name format');
  assert.equal(listings.find((l) => l.assetId === '999').currentBid, 600);
});

test('parse output is deterministic for the same input', () => {
  const a = parseSearchResults(fixture('search-results.html'), { now: NOW });
  const b = parseSearchResults(fixture('search-results.html'), { now: NOW });
  assert.deepEqual(a, b);
  assert.deepEqual(a.listings.map((l) => l.key), [...a.listings.map((l) => l.key)].sort());
});

test('an explicit no-results page is a legitimate empty result', () => {
  assert.deepEqual(parseSearchResults(fixture('no-results.html'), { now: NOW }), { listings: [], noResults: true });
});

test('an unrendered or changed page fails loudly instead of returning []', () => {
  assert.throws(() => parseSearchResults(fixture('unrendered.html'), { now: NOW }), (e) => e instanceof ParseError && /no listing links/.test(e.message));
});

test('cards whose bids cannot be read are a selector break', () => {
  assert.throws(() => parseSearchResults(fixture('missing-bids.html'), { now: NOW }), (e) => e instanceof ParseError && /current bid \(3\/3\)/.test(e.message));
});

test('selector overrides from config are honored', () => {
  assert.throws(() => parseSearchResults(fixture('search-results.html'), { now: NOW, selectors: { listingLink: 'a.never-matches' } }), ParseError);
});

test('money and time helpers', () => {
  assert.equal(parseMoney('Current Bid: $12,345.67'), 12345.67);
  assert.equal(parseMoney('no price'), null);
  assert.equal(parseEndTime('Ends 1/2/2027 12:05 AM EST', NOW), '2027-01-02T05:05:00.000Z');
  assert.equal(parseEndTime('Ends 1/2/2027 12:05 PM', NOW), '2027-01-02T12:05:00.000Z', 'no zone = UTC (runner browser zone)');
  assert.equal(parseEndTime('45m 10s', NOW), '2026-10-15T12:45:10.000Z');
  assert.equal(parseEndTime('Sept 3, 2026 1:00 PM PDT', NOW), '2026-09-03T20:00:00.000Z');
  assert.equal(parseEndTime('nothing here', NOW), null);
});

test('search URL building drops empty params and accepts pasted URLs', () => {
  const t = configSchema.parse({ searches: [{ keywords: 'x' }] }).searchUrlTemplate;
  assert.equal(buildSearchUrl({ keywords: 'fork lift', zip: '78701', maxDistanceMiles: 50 }, t), 'https://www.govdeals.com/en/search?kWord=fork+lift&zipcode=78701&miles=50');
  assert.equal(buildSearchUrl({ keywords: 'truck' }, t), 'https://www.govdeals.com/en/search?kWord=truck');
  assert.equal(buildSearchUrl({ url: 'https://www.govdeals.com/en/search?foo=1' }, t), 'https://www.govdeals.com/en/search?foo=1');
});

test('config validation: searches need keywords or url, distance needs zip', () => {
  assert.equal(configSchema.safeParse({ searches: [] }).success, false);
  assert.equal(configSchema.safeParse({ searches: [{ zip: '78701' }] }).success, false);
  assert.equal(configSchema.safeParse({ searches: [{ keywords: 'a', maxDistanceMiles: 10 }] }).success, false);
  assert.equal(configSchema.safeParse({ searches: [{ keywords: 'a', zip: '1234' }] }).success, false);
  assert.equal(configSchema.safeParse({ searches: [{ url: 'https://evil.example.com/' }] }).success, false);
  assert.equal(configSchema.safeParse({ searches: [{ keywords: 'a', zip: '78701', maxDistanceMiles: 10, maxBid: 5000 }] }).success, true);
});

test('toItems: maxBid, excludes, closed listings, multi-search merge and ending-soon windows', () => {
  const settings = configSchema.parse({ searches: [{ keywords: 'forklift' }], endingSoon: { windowsHours: [6, 48] } });
  const { listings } = parseSearchResults(fixture('search-results.html'), { now: NOW });
  const items = toItems([
    { search: { id: 'forklift', maxBid: 5000, excludeKeywords: ['battery'] }, listings },
    { search: { id: 'pallet', excludeKeywords: [] }, listings: listings.filter((l) => l.assetId === '553') },
  ], settings, NOW);

  const matches = items.filter((i) => i.type === 'match');
  assert.deepEqual(matches.map((i) => i.key), ['2001-1001', '2001-777', '3107-553'], 'over-max Toyota, excluded battery and closed Yale are dropped');
  assert.deepEqual(matches.find((i) => i.key === '3107-553').fields.searches, ['forklift', 'pallet']);

  const ending = items.filter((i) => i.type === 'ending_soon');
  assert.deepEqual(ending.map((i) => i.key), ['2001-777@6h', '3107-553@48h'], 'smallest window that contains the listing');
  assert.equal(ending[0].fields.currentBid, 300);
});

test('end to end with the fixture: new-match and ending-soon notifications, then dedupe', async () => {
  const { config } = configFor([govdeals], {
    govdeals: { notify: { silentFirstRun: false, maxPerRun: 10 }, settings: { searches: [{ keywords: 'forklift', maxBid: 5000, excludeKeywords: ['battery'] }], endingSoon: { windowsHours: [6] } } },
  });
  const store = memoryStore();
  const notifier = recordingNotifier();
  const html = fixture('search-results.html');
  const run = (now) => runJob({ job: govdeals, config, store, notifier, now, fixture: () => html, log: quietLog(), sleepFn: noSleep, closeBrowserAfter: false });

  const r1 = await run(NOW);
  assert.equal(r1.status, 'success', r1.error);
  assert.equal(r1.newItems.filter((i) => i.type === 'match').length, 3);
  const titles = notifier.sent.map((n) => n.title);
  assert.ok(titles.some((t) => t.startsWith('⏰ Ends in 3h: Clark C25 Forklift')), titles.join('\n'));
  assert.ok(titles.some((t) => t === '🏷️ 2015 Hyster S50FT Forklift'));
  assert.match(notifier.sent.find((n) => n.title.includes('Hyster')).message, /Current bid: \$1,250\nEnds: Sun, 18 Oct 2026 20:00 UTC\nAustin, TX/);

  const before = notifier.sent.length;
  const r2 = await run(new Date('2026-10-15T13:00:00Z'));
  assert.equal(r2.newItems.length, 0);
  assert.equal(notifier.sent.length, before, 'seen listings and already-sent ending-soon alerts are not repeated');

  const current = await store.listItems('govdeals', { view: 'current', type: 'match' });
  assert.equal(current.length, 3);
});

test('end to end: a broken page fails the run with a parse alert', async () => {
  const { config } = configFor([govdeals], { govdeals: { retries: 0, settings: { searches: [{ keywords: 'forklift' }] } } });
  const notifier = recordingNotifier();
  const r = await runJob({ job: govdeals, config, store: memoryStore(), notifier, now: NOW, fixture: () => fixture('unrendered.html'), log: quietLog(), sleepFn: noSleep, closeBrowserAfter: false });
  assert.equal(r.status, 'failed');
  assert.equal(r.errorKind, 'parse');
  assert.match(r.error, /\[search "forklift"\]/);
  assert.match(notifier.sent[0].title, /GovDeals watcher: Selector or parse broke/);
});
