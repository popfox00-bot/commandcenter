// Capture one real GovDeals search and check the parser against it.
// Used by the cc-capture workflow (runs on GitHub's runners, where scheduled jobs run) and locally:
//   CAPTURE_KEYWORDS="pickup truck" CAPTURE_ZIP=80214 CAPTURE_MILES=100 CAPTURE_MAX_BID=8000 \
//     node scripts/capture-govdeals.js
// Writes to CAPTURE_OUT (default .cc/capture/): page.html, page.png, report.json, summary.md.
// Exit code: 0 = parser read the page, 1 = parse problem (artifacts are still written), 2 = setup error.

process.emitWarning = ((orig) => (w, ...r) => (String(w).includes('SQLite') ? undefined : orig.call(process, w, ...r)))(process.emitWarning);

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadRegistry } from '../src/core/registry.js';
import { loadConfig } from '../src/core/config.js';
import { createContext } from '../src/core/context.js';
import { createLogger } from '../src/core/logger.js';
import { createRng } from '../src/core/rng.js';
import { closeBrowser } from '../src/core/browser.js';
import { configSchema, buildSearchUrl, toItems } from '../src/jobs/govdeals/index.js';
import { parseSearchResults } from '../src/jobs/govdeals/parse.js';
import { DEFAULT_SELECTORS } from '../src/jobs/govdeals/selectors.js';

const env = process.env;
const outDir = resolve(env.CAPTURE_OUT || '.cc/capture');
mkdirSync(outDir, { recursive: true });

const search = {
  id: 'capture',
  // A pasted GovDeals URL counts as the search only when no keywords are given.
  ...(env.CAPTURE_URL && !env.CAPTURE_KEYWORDS ? { url: env.CAPTURE_URL } : {}),
  ...(env.CAPTURE_KEYWORDS ? { keywords: env.CAPTURE_KEYWORDS } : {}),
  ...(env.CAPTURE_ZIP ? { zip: env.CAPTURE_ZIP } : {}),
  ...(env.CAPTURE_MILES ? { maxDistanceMiles: Number(env.CAPTURE_MILES) } : {}),
  ...(env.CAPTURE_MAX_BID ? { maxBid: Number(env.CAPTURE_MAX_BID) } : {}),
};

const parsedSettings = configSchema.safeParse({ searches: [search] });
if (!parsedSettings.success) {
  console.error('Invalid capture input:\n' + parsedSettings.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(2);
}
const settings = parsedSettings.data;
const url = env.CAPTURE_URL || buildSearchUrl(settings.searches[0], settings.searchUrlTemplate);

const registry = await loadRegistry();
const config = loadConfig(registry);
const log = createLogger();
const now = new Date();
const ctx = createContext({ job: { id: 'capture' }, jobCfg: { settings }, config, runId: 'capture', attempt: 1, now, rng: createRng('capture'), log });

const report = { url, capturedAt: now.toISOString(), search: settings.searches[0] };
let exitCode = 0;
try {
  // Images load here (unlike scheduled runs) so the screenshot is useful for comparison.
  const page = await ctx.browser.withPage(async (p, { goto }) => {
    const res = await goto(url, { timeoutMs: 60_000 });
    await p.waitForSelector(DEFAULT_SELECTORS.ready, { timeout: 30_000, state: 'attached' }).catch(() => log.warn('no listing link or no-results marker appeared within 30 s'));
    await p.waitForTimeout(2500);
    return { status: res?.status() ?? null, finalUrl: p.url(), title: await p.title(), html: await p.content(), png: await p.screenshot({ fullPage: true }) };
  }, { blockResources: ['media', 'font'] });

  writeFileSync(join(outDir, 'page.html'), page.html);
  writeFileSync(join(outDir, 'page.png'), page.png);
  Object.assign(report, { httpStatus: page.status, finalUrl: page.finalUrl, pageTitle: page.title, bytes: page.html.length });

  try {
    const strict = parseSearchResults(page.html, { now, requireEndTime: true });
    report.parse = { ok: true, noResults: strict.noResults, listings: strict.listings };
  } catch (err) {
    exitCode = 1;
    report.parse = { ok: false, error: err.message };
    // Show what a lenient parse can still see, to guide selector fixes.
    try { report.parse.lenient = parseSearchResults(page.html, { now, requireEndTime: false }).listings; } catch (e) { report.parse.lenientError = e.message; }
  }
  if (report.parse.ok) {
    report.items = toItems([{ search: settings.searches[0], listings: report.parse.listings }], settings, now);
  }
} catch (err) {
  exitCode = 1;
  report.error = `${err.name}: ${err.message}`;
} finally {
  await closeBrowser();
}

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
const summary = renderSummary(report);
writeFileSync(join(outDir, 'summary.md'), summary);
if (env.GITHUB_STEP_SUMMARY) writeFileSync(env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
console.log(summary);
process.exit(exitCode);

function renderSummary(r) {
  const cell = (v) => String(v ?? '–').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = ['## GovDeals capture', '', `- Search URL: ${r.url}`];
  if (r.finalUrl && r.finalUrl !== r.url) lines.push(`- Landed on: ${r.finalUrl}`);
  if (r.httpStatus != null) lines.push(`- HTTP ${r.httpStatus}, page title "${cell(r.pageTitle)}", ${r.bytes} bytes`);
  if (r.error) {
    lines.push('', `**Capture failed:** ${cell(r.error)}`);
    if (/robots\.txt/.test(r.error)) lines.push('', 'GovDeals\' robots.txt does not allow this page, so the job will not fetch it.');
    return lines.join('\n') + '\n';
  }
  if (!r.parse.ok) {
    lines.push('', `**Parser failed:** ${cell(r.parse.error)}`, '');
    const seen = r.parse.lenient ?? [];
    lines.push(seen.length ? `A lenient parse still found ${seen.length} listing link(s):` : 'No listing links were recognized. Check page.png: this can mean a block page or a changed layout.');
    if (seen.length) lines.push('', table(seen.slice(0, 25)));
    return lines.join('\n') + '\n';
  }
  if (r.parse.noResults) { lines.push('', 'The parser recognized a valid **no results** page.'); return lines.join('\n') + '\n'; }
  const matches = r.items.filter((i) => i.type === 'match').length;
  lines.push('', `**Parser OK:** ${r.parse.listings.length} listing(s) read; ${matches} match the max-bid/exclude filters.`, '', 'Compare these against the same search in Safari:', '', table(r.parse.listings.slice(0, 50)));
  return lines.join('\n') + '\n';

  function table(listings) {
    return ['| Title | Current bid | Ends (UTC) | Location |', '| --- | --- | --- | --- |',
      ...listings.map((l) => `| [${cell(l.title)}](${l.url}) | ${l.currentBid == null ? '–' : '$' + l.currentBid.toLocaleString('en-US')} | ${cell(l.endTime?.replace('T', ' ').slice(0, 16))} | ${cell(l.location)} |`)].join('\n');
  }
}
