// Every assumption about GovDeals markup lives here, so a layout change is a one-file fix
// (or a config override: jobs.govdeals.settings.selectors.* in config/jobs.yaml).
//
// ASSUMPTION (verify on first live run with `node src/cli.js capture <search url> --out test/fixtures/govdeals/live.html`):
// GovDeals is a JavaScript single-page app; listing links look like /en/asset/<assetId>/<accountId>.
// The parser anchors on those links rather than on CSS class names, which change more often.

export const DEFAULT_SELECTORS = {
  /** Links to a listing. The regex below extracts ids from their href. */
  listingLink: 'a[href*="/asset/"]',
  listingHref: '/asset/(\\d+)/(\\d+)',
  /** Candidate card containers, nearest first. The parser also climbs ancestors generically. */
  card: 'app-asset-card, [data-asset-id], .card, li, article',
  title: 'h1, h2, h3, h4, h5, [class*="title" i], [class*="name" i]',
  /** Elements that may hold an end time in a machine-readable attribute. */
  endTimeAttr: '[data-end-time], [data-endtime], [data-auction-end], time[datetime]',
  /** Elements whose text may hold the current bid / end time. */
  bidText: '[class*="bid" i], [class*="price" i], [class*="amount" i]',
  endText: '[class*="end" i], [class*="close" i], [class*="countdown" i], [class*="time" i]',
  location: '[class*="location" i], [class*="city" i]',
  /** Page-level marker(s) for a legitimate empty result set. */
  noResults: '[class*="no-result" i], [class*="noresult" i], [class*="empty-state" i]',
  noResultsText: '(no (results|assets|items|matches)( were)? found|did not match any|0 results)',
  /** Selectors the browser waits for before reading the page. */
  ready: 'a[href*="/asset/"], [class*="no-result" i], [class*="empty-state" i]',
};

export function mergeSelectors(overrides = {}) {
  return { ...DEFAULT_SELECTORS, ...overrides };
}
