# Command Center

A personal, phone-first automation dashboard. Jobs run on a schedule or on demand, results are
stored in Cloudflare D1, new matches are pushed to your phone with ntfy, and an installable PWA
shows every job as a card with its latest results and a **Run now** button.

Everything runs on free tiers. See [Free-tier budget](#free-tier-budget) for the numbers and the
choices that keep usage under them.

```
 iPhone PWA (GitHub Pages, or served by the Worker)
     │  GET /api/*  POST /api/jobs/:id/run          bearer CC_API_TOKEN
     ▼
 Cloudflare Worker ──── D1 (jobs, runs, items = dedupe keys + results)
     │  workflow_dispatch (fine-grained PAT: this repo, Actions write)
     │  cron: stale runs, retention, watchdog, re-enable scheduled workflow
     ▼
 GitHub Actions: cc-scheduled (hourly sweep of due jobs) / cc-dispatch (one job)
     │  Node 22 + Playwright Chromium
     │  POST /ingest/*  HMAC-signed with CC_INGEST_SECRET (a separate secret)
     ▼
 ntfy.sh ──► phone        (new matches, ending soon, failures, selector breaks)
```

## Contents

- [Repository layout](#repository-layout)
- [Quick start (local, no cloud)](#quick-start-local-no-cloud)
- [Cloud setup](#cloud-setup): [ntfy](#1-ntfy) · [Cloudflare](#2-cloudflare-worker--d1) · [GitHub](#3-github-secrets-and-token) · [PWA on iPhone](#4-install-the-pwa-on-iphone)
- [Configuration](#configuration)
- [GovDeals watcher](#govdeals-watcher)
- [Adding a job](#adding-a-job)
- [Free-tier budget](#free-tier-budget)
- [Security](#security)
- [Optional: Cloudflare Access](#optional-cloudflare-access)
- [Optional: Google Sheets export](#optional-google-sheets-export)
- [Planned jobs](#planned-jobs-design-notes)
- [Assumptions to verify](#assumptions-to-verify)
- [Troubleshooting](#troubleshooting)

## Repository layout

```
config/jobs.yaml            All job config (validated; invalid config fails loudly)
src/cli.js                  CLI: validate, list, due, run, scheduled, capture, notify-test, items, runs
src/core/                   Framework: config, registry, runner, retries/timeouts, schedule (cron),
                            polite HTTP + robots.txt, Playwright, notifications, logging + redaction
src/jobs/                   One module per job (files starting with "_" are templates)
  govdeals/                 GovDeals watcher (index.js, parse.js, selectors.js)
  heartbeat.js              No-network self-test job
  _template.js              Copy this to add a job
src/store/                  local (SQLite file) / remote (Worker) / d1-shim (node:sqlite as D1)
src/exporters/sheets.js     Optional Google Sheets exporter
shared/                     Code shared by runner and Worker: SQL store, HMAC signing
worker/                     Cloudflare Worker (API, ingest, cron) + D1 migrations
web/                        PWA (no build step)
test/                       node:test suites + GovDeals HTML fixtures
.github/workflows/          cc-scheduled, cc-dispatch, cc-ci (tests + secret scan), cc-pages
scripts/                    secret scan, git hook installer, icon renderer, failure alert
```

## Quick start (local, no cloud)

Requires Node 22.13+.

```bash
npm install
npx playwright install chromium         # only needed for live GovDeals runs
npm run hooks:install                   # pre-commit secret scan

npm run validate                        # check config/jobs.yaml
npm test                                # framework + GovDeals parser + Worker tests

# Run a job against a saved page: no network, nothing persisted, notifications print to the console
npm run job -- govdeals --dry-run --fixture test/fixtures/govdeals/search-results.html

# Run it for real (renders govdeals.com, stores state in .cc/local.db, prints notifications)
npm run job -- govdeals
npm run job -- govdeals                 # second run: "0 new" (dedupe)
npm run cc -- items govdeals --view current
npm run cc -- runs govdeals
```

Useful flags: `--store local|remote|memory`, `--notify` (real ntfy push), `--config <file>`,
`--trigger`. `npm run cc -- --help` lists everything.

The local store is a SQLite file using the **same schema and SQL** as D1 (`shared/sql-store.js`),
so local runs behave exactly like cloud runs.

## Cloud setup

Do these in order. Each step ends with a check.

### 1. ntfy

1. Install the **ntfy** app on your iPhone (App Store).
2. Pick an unguessable topic name, e.g. `cc-` + 20 random characters
   (`node -e "console.log('cc-'+require('crypto').randomBytes(15).toString('base64url'))"`).
   On ntfy.sh, **anyone who knows the topic can read and post to it**, so treat it like a password.
3. In the app: **+** → subscribe to that topic on `https://ntfy.sh`.
4. Check: put `NTFY_TOPIC=<topic>` in `.env`, then run `npm run cc -- notify-test`.

### 2. Cloudflare Worker + D1

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create command-center      # copy database_id into wrangler.toml
npm run db:migrate                         # applies migrations/ to the remote D1

# Secrets (prompted, never written to disk). Use two DIFFERENT random values for the first two:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put CC_API_TOKEN        # the PWA's bearer token
npx wrangler secret put CC_INGEST_SECRET    # HMAC secret shared with GitHub Actions only
npx wrangler secret put GH_DISPATCH_TOKEN   # see step 3
npx wrangler secret put NTFY_TOPIC          # watchdog alerts

npm run deploy
```

Edit `[vars]` in `worker/wrangler.toml` first if your GitHub owner, repo or Pages origin differ.

Check: `curl https://command-center.<you>.workers.dev/api/health` returns `{"ok":true}`, and
`/api/jobs` without a token returns 401.

Local Worker development: put `CC_API_TOKEN=...` and `CC_INGEST_SECRET=...` in `worker/.dev.vars`
(git-ignored), then `npm run db:migrate:local && npm run dev`, and run jobs with
`CC_WORKER_URL=http://127.0.0.1:8787 npm run job -- heartbeat --store remote`.

### 3. GitHub secrets and token

**Fine-grained token for Run now** (least privilege): GitHub → Settings → Developer settings →
Fine-grained tokens → Generate. Repository access: **Only select repositories → commandcenter**.
Permissions: **Actions: Read and write**, and nothing else (Metadata: read is added
automatically). Set an expiry and a calendar reminder. Store it only as the Worker secret
`GH_DISPATCH_TOKEN`.

**Repository secrets** (Settings → Secrets and variables → Actions → Secrets):

| Secret | Required | Value |
| --- | --- | --- |
| `CC_WORKER_URL` | yes | `https://command-center.<you>.workers.dev` |
| `CC_INGEST_SECRET` | yes | same value as the Worker secret |
| `NTFY_TOPIC` | yes | your topic |
| `NTFY_TOKEN` | no | only for a protected or reserved topic |
| `CC_CONFIG_YAML` | no | whole `jobs.yaml`, to keep search terms and ZIP out of a public repo |
| `CC_ACCESS_CLIENT_ID` / `CC_ACCESS_CLIENT_SECRET` | no | Cloudflare Access service token |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | no | Sheets exporter |

**Repository variable** (Variables tab): `CC_WORKER_URL`, the same URL. `cc-pages` writes it into
the PWA so you don't have to type it on the phone.

**Pages**: Settings → Pages → Source: **GitHub Actions**. Merge to `main` (workflows only run from
the default branch), then run **cc-pages** once.

Check: Actions → **cc-dispatch** → Run workflow → `heartbeat`. Within a couple of minutes the run
is green and `GET /api/jobs` shows heartbeat with a successful last run.

### 4. Install the PWA on iPhone

1. Open `https://popfox00-bot.github.io/commandcenter/` in **Safari**. Alternatively, open the
   Worker URL itself (`https://command-center.<you>.workers.dev/`), which serves the same app.
2. Tap **Share → Add to Home Screen → Add**.
3. Open it from the home screen. Settings opens on first launch: enter the Worker URL (pre-filled
   when deployed via cc-pages) and `CC_API_TOKEN`, tap **Test**, then **Save**.

The token is kept in that home-screen app's storage on your phone only.

## Configuration

`config/jobs.yaml` is validated with zod on every run, including each job's own `configSchema`.
Unknown keys, invalid crons, bad ZIPs and so on fail the run with a list of every problem, and
send a failure push from Actions. Run `npm run validate` before pushing.

```yaml
version: 1
timezone: America/Chicago        # all job crons use this zone
politeness: { minDelayMs: 3000, maxDelayMs: 8000, perHostIntervalMs: 10000, respectRobots: true, cacheTtlSec: 600 }
defaults:
  retries: 2                     # exponential backoff with jitter, seeded per run
  timeoutMs: 600000
  notify: { onNew: true, onFailure: true, maxPerRun: 5, silentFirstRun: true }
jobs:
  govdeals:
    enabled: true
    schedule: "17 6-21/3 * * *"  # overrides the module default
    minItems: 0                  # >0 makes "fewer items than this" a failure
    notify: { maxPerRun: 8 }
    settings: { ... }            # validated by the job's schema
```

**Scheduling.** `cc-scheduled` wakes hourly at :23. For each enabled job it compares the job's
most recent cron fire time (in `timezone`) with the job's last run start in D1, and runs the job
if it hasn't run since. So job crons have one-hour resolution, and GitHub's cron can start late.

**Notifications.** You get a push for:
- each new item (up to `maxPerRun`, the rest folded into one summary);
- every failure, labeled by kind;
- a scheduler that has stopped running (Worker watchdog).

A job's first successful run sends one "now tracking N" summary instead of one push per existing
listing.

## GovDeals watcher

`src/jobs/govdeals/` renders each saved search in headless Chromium (the site is a JavaScript
app with no public API). It reads the listing cards and returns:

- `match` items, keyed `<accountId>-<assetId>`, with title, current bid, end time, location and
  the searches they matched. Each new key sends one push: *🏷️ title / Current bid / Ends / link*.
- `ending_soon` items, for listings that still match and end within `endingSoon.windowsHours`.
  Each listing alerts once per window: *⏰ Ends in 3h: title, current bid*.

```yaml
settings:
  searches:
    - id: forklift
      keywords: forklift
      category: ""               # optional, passed as a query param
      zip: "78701"
      maxDistanceMiles: 100      # passed to GovDeals' own distance filter
      maxBid: 5000               # applied here, on the current bid
      excludeKeywords: [battery]
    - id: custom
      url: "https://www.govdeals.com/en/search?..."   # or paste any search URL from the site
  endingSoon: { enabled: true, windowsHours: [24, 3] }
  # selectors: { listingLink: "...", bidText: "..." }  # hot-fix selectors without a code change
```

In the PWA, the card's **Tracked** tab lists the listings in the latest successful run sorted by
end time. **New matches** and **Ending alerts** show history.

It fails loudly in these cases, sending a push labeled "Selector or parse broke":
- the page has no listing links and no "no results" marker (layout changed or didn't render);
- listing links are found but most cards have no readable bid or end time.

## Adding a job

1. Copy `src/jobs/_template.js` to `src/jobs/<id>.js` (or `src/jobs/<id>/index.js`).
2. Export `{ id, name, description, schedule, configSchema?, needsBrowser?, formatNotification?, run(ctx) }`.
3. Add a `jobs.<id>` entry to `config/jobs.yaml` and run `npm run validate`.
4. Add a fixture test like `test/govdeals.test.js`.

`run(ctx)` returns `[{ key, title, url, fields, timestamp, type? }]`. The framework handles
dedupe, persistence, notifications, logging, retries, timeouts and politeness, so jobs must not.
Use only what `ctx` provides:

| `ctx` | Purpose |
| --- | --- |
| `ctx.settings` | validated job settings |
| `ctx.now`, `ctx.rng` | fixed run time and seeded randomness (reproducible runs) |
| `ctx.http.json/text/request` | polite fetch: robots.txt, per-host spacing, jitter, cache, UA |
| `ctx.page(url, { render })` | HTML, optionally rendered in Chromium; serves fixtures in tests |
| `ctx.browser.withPage(fn)` | raw Playwright page (screenshots, PDFs) with blocked heavy assets |
| `ctx.pause()` | polite randomized pause between steps |
| `ctx.secret(name)` | reads `JOB_<ID>_<NAME>` from encrypted secrets, auto-redacted |
| `ctx.log` | structured, redacted, stored with the run |

Throw `ParseError` when a page doesn't look as expected. Never return `[]` for a page you
couldn't understand.

## Free-tier budget

Limits checked on 2026-10-15 via web search (the container couldn't open the vendor pages
directly; sources are listed at the end). Re-check them if anything changes.

| Service | Free limit | This design | Status |
| --- | --- | --- | --- |
| GitHub Actions | Private repos: 2,000 Linux min/month. Public repos: unlimited | Hourly sweep ≈ 24 billed min/day (each job rounds up to 1 min) ≈ 720/mo. GovDeals 6 runs/day × ~3 min ≈ 540/mo. CI ≈ 1–2 min per push | **~1,300–1,400/mo on a private repo: fits, with ~30% headroom.** Each extra browser job at 6 runs/day adds ~540/mo, so a second one would exceed the limit. Then make the repo public, or cut the sweep to every 2 hours (`23 */2 * * *`) |
| GitHub Actions cron | Public repos: scheduled workflows are disabled after 60 days without repo activity | The Worker cron re-enables `cc-scheduled` and alerts | Handled |
| GitHub Pages | Free for public repos; **private repos need a paid plan** | PWA via cc-pages | **Flag:** if the repo is private on GitHub Free, use the Worker URL. The Worker serves the same PWA (static assets, free) |
| Workers | 100,000 requests/day; 10 ms CPU per request and per cron run; 50 subrequests; 5 cron triggers per account | A few hundred requests/day; 1 cron trigger (every 2h, ≤3 subrequests) | Fits. The cron lookback was rewritten to walk hours (~200 time-zone conversions) to stay inside 10 ms |
| D1 | 5M rows read/day, 100k rows written/day, 5 GB | GovDeals ≈ 50 items × 6 runs ≈ 300 upserts/day (~1k row writes with indexes) | Fits. Retention prunes runs after 60 days and items unseen for 120 days |
| KV | n/a | Not used (D1 only) | – |
| ntfy.sh | 250 messages/day per visitor; 4,096-byte messages | At most 6 pushes per job run (5 + summary) plus failures | Fits for one person. **Flag:** limits are per visitor (IP), and GitHub runners share IPs. If you ever see HTTP 429, create an ntfy account and set `NTFY_TOKEN` |

## Security

- **No secrets in the repo, client code or logs.** Secrets live only in GitHub Actions encrypted
  secrets and Worker secrets. `.env` and `worker/.dev.vars` are git-ignored, and the PWA token is
  typed in on the device.
- **Secret scanning:** the `npm run hooks:install` pre-commit hook (`scripts/secret-scan.js
  --staged`) and CI (`npm run secret-scan` plus gitleaks).
- **Separate credentials per direction:**
  - PWA → Worker: bearer `CC_API_TOKEN` (compared in constant time).
  - Runner → Worker: HMAC-SHA256 over method, path, timestamp and body with `CC_INGEST_SECRET`,
    with a 5-minute replay window. The UI token cannot write.
  - Worker → GitHub: fine-grained PAT, this repo only, Actions read and write only.
- **Run now safety:** it only dispatches known job ids, enforces a 2-minute cooldown, and refuses
  while a run is in progress. The workflow re-validates the id and passes it through `$JOB_ID`,
  never `${{ }}` interpolation.
- **Redaction:** every log entry is redacted before printing or storing. This covers known secret
  values, sensitive query params (`token`, `key`, `sig`, `code`…), URL userinfo and
  sensitive-named fields. In Actions, `CC_LOG_STDOUT=minimal` keeps log data out of the
  (possibly public) Actions log; the full redacted log is stored with the run in D1.
- **Least privilege in workflows:** `permissions: contents: read`, and `persist-credentials: false`
  on checkout.
- **PWA:** strict CSP; all server data is rendered with `textContent`; links are limited to
  http(s) and open with `noopener noreferrer`; the service worker never caches API responses.

### Scope boundaries (enforced by design, not just policy)

- No banking, brokerage, payment or email credential automation.
- No logged-in sportsbook automation (odds come from APIs only).
- No automation of employer or work systems.
- Low-risk logins (e.g. a utility portal) may come later, with credentials only in encrypted
  secrets via `ctx.secret()`.

## Optional: Cloudflare Access

The bearer token is enough for one person. To add SSO in front of it:

1. Use the Worker URL for the PWA (it serves the app), so the page and the API share one origin
   and the Access cookie applies to both.
2. Cloudflare dashboard → Zero Trust → Access → Applications → **Self-hosted**, domain
   `command-center.<you>.workers.dev`. Add a policy: **Allow**, *Emails* = your address.
   (Workers also have a one-click "Cloudflare Access" toggle under Settings → Domains & Routes.)
3. Access → Service credentials → **Create service token**. Add a second policy on the same
   application: **Service Auth**, include that token. Put its id and secret in the GitHub secrets
   `CC_ACCESS_CLIENT_ID` / `CC_ACCESS_CLIENT_SECRET`; the runner sends them on every ingest call.
4. Keep `CC_API_TOKEN` and `CC_INGEST_SECRET` as a second layer.

## Optional: Google Sheets export

1. In Google Cloud, create a service account, enable the Sheets API, and create a JSON key.
2. Share the spreadsheet with the service account's email as Editor.
3. Save the JSON key as the GitHub secret `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. Add it to the job's config:

```yaml
exporters:
  - type: sheets
    spreadsheetId: "1AbC..."
    sheet: GovDeals
    types: [match]
    columns: [currentBid, endTime, location]
```

Each run appends rows for its new items only: `timestamp, type, key, title, url, …columns`.
Exporter errors are logged and recorded on the run.

## Planned jobs (design notes)

Not built yet. Each fits the current contract:

| Job | Approach | Notes |
| --- | --- | --- |
| eBay sold comps | eBay Browse/Marketplace Insights API via `ctx.http.json`, app credentials via `ctx.secret` | On-demand job keyed by query. API terms limit how sold data may be used and stored |
| Home listing tracker | Listing pages or feed via `ctx.page`; key = listing id; Sheets exporter | Needs **change** alerts (price drop, status). Plan: a read-only `ctx.previous(type, key)` backed by the existing `items` table, so jobs can emit `price_drop` items keyed `id@price` |
| Price drop / restock | Prefer the retailer's API or structured data (JSON-LD `offers`); key `url@price` or `url@instock` | Same `ctx.previous` addition |
| Odds snapshots | Odds API (e.g. The Odds API free tier) via `ctx.http.json`; key `event@book@timestamp` | API only, no sportsbook logins |
| Page → PDF / screenshot | `ctx.browser.withPage(p => p.pdf())` | Needs blob storage. R2 has a free tier (verify first); D1 is not for binaries |
| Utility bill PDFs | Low-risk login with `ctx.secret('username')` / `ctx.secret('password')` | Only if the site's terms allow it; never MFA-bypass; credentials stay in encrypted secrets |

## Assumptions to verify

Each one is a default you can test, change in one place, and report back on:

1. **GovDeals markup.** The parser anchors on links like `/en/asset/<assetId>/<accountId>`. The
   fixtures were written by hand because this build environment couldn't reach govdeals.com.
   Test: `npm run cc -- capture "<a GovDeals search URL>" --out test/fixtures/govdeals/live.html`,
   then `npm run job -- govdeals --dry-run --fixture test/fixtures/govdeals/live.html`. The
   listings printed should match what you see in Safari.
2. **GovDeals search URL.** Default: `/en/search?kWord=…&zipcode=…&miles=…&category=…`. If
   results look unfiltered, paste a real search URL into `url:` for that search, or change
   `searchUrlTemplate`.
3. **GovDeals robots.txt and terms** allow polite reading of public search pages. The runner
   enforces robots.txt on every request (and stops if it can't fetch it). Read the site's terms
   yourself before enabling the job.
4. **Times without a zone** on cards are treated as UTC, because the runner's browser runs in UTC.
5. **"Tracked"** means the listing appeared in the latest successful run. A listing whose bid rose
   above `maxBid` drops off and gets no ending-soon alert.
6. **Distance** is filtered by GovDeals itself (ZIP + miles in the URL). Cards don't carry
   coordinates, so it isn't re-checked here.

## Troubleshooting

| Symptom | Where to look |
| --- | --- |
| Push "Selector or parse broke" | Capture the page (assumption 1), update `selectors.js` or `settings.selectors`, then add a fixture test |
| Push "Command Center scheduler" | Actions → cc-scheduled: disabled, failing, or secrets missing |
| Run now → "GitHub dispatch failed (HTTP 404)" | Workflows must be on `main`; check `GH_OWNER`/`GH_REPO`; token repo access |
| Run now → 401 from GitHub | `GH_DISPATCH_TOKEN` expired or lacks Actions write |
| `ingest auth failed` | `CC_INGEST_SECRET` differs between the Worker and GitHub, or the runner clock drifted >5 min |
| PWA "Wrong token" | Re-enter `CC_API_TOKEN` in settings |
| CORS error in Safari | Add your Pages origin to `ALLOWED_ORIGINS` in `wrangler.toml` and redeploy, or use the Worker URL |

## Sources (free-tier limits)

- GitHub Actions minutes: [cicdcalculator.com](https://cicdcalculator.com/github-actions-free-tier), [heise.de](https://heise.de/-11118027)
- GitHub scheduled-workflow inactivity: [docs.github.com](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)
- Cloudflare Workers limits: [developers.cloudflare.com/workers/platform/limits](https://developers.cloudflare.com/workers/platform/limits)
- Cloudflare D1 pricing and limits: [developers.cloudflare.com/d1/platform/pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- ntfy limits: [docs.ntfy.sh/publish](https://docs.ntfy.sh/publish/), [docs.ntfy.sh/terms](https://docs.ntfy.sh/terms/)
