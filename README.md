# Command Center

A personal, phone-first app with two halves:

- **Tools** that run entirely on your phone, offline, with no setup. Files never leave the device.
  Today: the **Editor** app, with tabs for the [Photo Editor](#photo-editor),
  [Collage](#collage--superimpose), [Cutout](#cutout-and-characters), [Write on PDF](#write-on-pdf),
  [Scan](#scan) and the [File Converter](#file-converter). Converted images have an **Edit** button
  (opens the photo editor) and converted PDFs a **Write on it** button. And
  [QR & Barcode](#qr--barcode): scan codes with a link safety check before anything opens, and make
  your own QR codes.
- **Jobs**, an automation dashboard. Jobs run on a schedule or on demand, results are
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
 ntfy.sh ──► phone        (new items, failures, selector breaks, stalled scheduler)
```

## Contents

- [Tools](#tools)
- [Repository layout](#repository-layout)
- [Quick start (local, no cloud)](#quick-start-local-no-cloud)
- [Cloud setup](#cloud-setup): [ntfy](#1-ntfy) · [Cloudflare](#2-cloudflare-worker--d1) · [GitHub](#3-github-secrets-and-token) · [PWA on iPhone](#4-install-the-pwa-on-iphone)
- [Configuration](#configuration)
- [Adding a job](#adding-a-job)
- [Free-tier budget](#free-tier-budget)
- [Security](#security)
- [Optional: Cloudflare Access](#optional-cloudflare-access)
- [Optional: Google Sheets export](#optional-google-sheets-export)
- [Planned jobs](#planned-jobs-design-notes)
- [Assumptions to verify](#assumptions-to-verify)
- [Troubleshooting](#troubleshooting)

## Tools

Open **https://popfox00-bot.github.io/commandcenter/** in Safari, then Share → **Add to Home
Screen**. The Tools tab works immediately; the Jobs tab needs the cloud setup below.

Everything a tool does happens in the browser on your phone. Nothing is uploaded, and after the
first visit every tool works offline: the service worker precaches the whole app, including its
libraries.

### File Converter

| From | To |
| --- | --- |
| HEIC/HEIF*, JPEG, PNG, WebP, GIF, AVIF, BMP, SVG | JPEG, PNG, WebP, or PDF (one page per image, one combined PDF or one per file) |
| PDF (each page) | JPEG, PNG, WebP, or PDF (pages become images; useful to merge PDFs and photos) |

- Options: quality, max size (long edge), PDF page size (fit / Letter / A4), lossless PDF pages, PDF
  reading resolution.
- Photo orientation is applied, then **all metadata is removed** (EXIF, GPS location, camera).
- Results: **Share** (Save Image to Photos, Save to Files, AirDrop), **Save** (download), or
  **Download all** as a .zip.
- Limits: iPhone Safari caps an image canvas at 16.7 megapixels, so 24/48 MP photos are scaled to
  fit and the result says so. Very large batches can run out of memory; convert in smaller groups.

\* HEIC opens only where the browser can decode it (Safari on iPhone, iPad and Mac). When you pick
from Photos, iOS often hands Safari a JPEG already.

Libraries (vendored in `web/vendor/`, Apache-2.0): pdf.js for reading PDFs, libwebp (via jSquash)
for WebP encoding because Safari can't encode WebP itself. Writing PDFs and ZIPs uses small modules
in `web/lib/`.

### Photo Editor

Modeled on the iPhone Photos editor; edits are non-destructive and the original is never changed.

- **Adjust**: Auto, Exposure, Brilliance, Highlights, Shadows, Contrast, Brightness, Black Point,
  Saturation, Vibrance, Warmth, Tint, Sharpness, Definition, Noise Reduction, Vignette.
  Double-tap a slider or chip to reset it.
- **Filters**: Vivid (+ Warm/Cool), Dramatic (+ Warm/Cool), Mono, Silvertone, Noir, plus Fade and
  Sepia, each with an intensity slider.
- **Crop**: Freeform, Original, Square, 4:5, 3:4, 2:3, 9:16 and the landscape ratios; drag corners,
  edges or the whole box; rotate 90°, flip, and straighten ±45° (auto-zooms so no corners go empty).
- **Markup**: pen, highlighter, line, arrow, box, oval, text (optional background box), eraser;
  colors and size. Markup stays attached to the picture when you crop, rotate or flip.
- Undo/redo for every step, hold ◑ to compare with the original, and **autosave**: if iOS closes the
  app, reopening the editor offers to continue where you left off.
- **Done** exports at full resolution (or 4096/2048/1080 px) as JPEG, PNG or WebP, then Share (Save
  Image to Photos) or Save.

Rendering runs on the GPU (WebGL 2) in two passes: geometry and color in one, then sharpness,
definition, noise reduction and vignette. Full-size export is limited by the same 16.7 MP canvas
cap and the device's maximum texture size.

Planned next: text with more fonts and moving/resizing items (layers), blur/pixelate a region,
curves and per-color HSL, social-size presets and templates, then automatic background removal with
an on-device model.

### Collage / Superimpose

- **Grid**: pick a layout (2 side by side, 2 stacked, 3, 4, 6 or 9), a shape (square, 4:5, 9:16,
  16:9, ...), spacing, rounded corners and a background color. Drag a photo to reposition it in its
  cell, pinch or use the Zoom slider to crop; Replace and Remove act on the selected cell.
- **Free / Superimpose**: set a background photo, then add photos or saved Characters on top. Drag
  to move, pinch (or the corner handle) to resize and rotate; Flip, Forward/Backward, Duplicate,
  Delete and Opacity act on the selected layer.
- Export at 1080–4096 px as JPEG or PNG: Share, Save, or **Edit in Photo** to keep adjusting.
  Work is autosaved.

### Cutout and Characters

Cut an object out of a photo: trace around it with your finger (**Trace**), or trace areas to take
away (**Remove**), with undo/redo and an **Edge softness** slider. **Preview cutout** shows the
result on a checkerboard. The result can be saved as a transparent PNG, shared, placed on another
photo (opens Collage in Free mode), or saved as a **Character**: a named library of cutouts kept on
the device (IndexedDB) that you can reuse from Collage ("+ Character"), rename, share or delete.

### Write on PDF

Fill in and sign PDFs: **Text** (tap to type; tap text to edit, drag to move), **Signature** and
**Initials**, **Draw**, **Check** ✓ and **Cross** ✗ marks, **Box**, **Highlight**, **White-out**,
and an **Eraser**, with undo/redo and autosave. **Scroll** mode lets your finger scroll the pages
instead of drawing.

- **Saved signature and initials**: draw them once; after that each tap places them (drag to move).
  They're kept on this device only; **Redraw** replaces them and **Forget saved** removes them.
- **Zoom**: pinch with two fingers, or use Zoom out / Fit width / Zoom in (100–400%). Pages are
  re-rendered sharp at the new size.

Saving writes your additions into the original PDF (pdf-lib, vendored, MIT): existing pages are not
turned into images, their text stays selectable, and your typed text is real PDF text too. Rotated
pages (common in scans) are handled. Limits: typed text uses the standard Helvetica font, so
characters outside Western European languages (and emoji) become "?" (the save dialog says when);
password-protected PDFs can be viewed but not saved.

### Scan

Photograph paper documents (camera or library) and get a clean PDF. Edges are found automatically
and the page is flattened; drag the corners to adjust (**Auto** / **Whole photo**). Each page has a
filter (**Clean**, **Gray**, **B&W**, **Original**), rotate, reorder and remove. **Make PDF** at
US Letter, A4 or the scan's own size, then Share, Save, or **Sign / write on it** (opens Write on PDF).

### QR & Barcode

**Scan** with the camera (live) or from a photo or screenshot (several codes in one picture are
listed). QR codes, Data Matrix, Aztec, PDF417 and product barcodes (UPC/EAN/ISBN, Code 128, ...) are
read on the device with ZXing-C++ (WebAssembly, vendored). **Nothing opens by itself**: you first
see what the code holds:

- **Links** get a safety check on the phone, without visiting the site: the real site name in bold
  (`paypal.com.`**`secure-login.ru`**), look-alike spellings (`paypa1`, Cyrillic letters), brand names
  in the wrong place, disguised `user@host` addresses, number-only or local addresses, unencrypted
  http, short links and QR-code services that hide the destination, links forwarded inside other
  links, risky downloads (iPhone configuration profiles, app installers), sign-in and
  parking/toll-payment pages, scam-heavy domain endings and tracking tags. The verdict is
  **No warning signs found**, **Be careful** or **Don't open this**. Opening a risky link asks first.
  **Open without tracking** strips `utm_*`, `fbclid` and similar tags.
- **Check where it leads** (optional, tap to run): with the Jobs setup, your Worker opens the link
  from Cloudflare, not your phone. It follows every redirect (HTTP, refresh tags, simple script
  redirects; never into local-network addresses) and reports each hop, the final page's title, file
  downloads, each domain's registration date (brand-new domains are a top scam sign) and, if you add
  the optional `GSB_API_KEY` Worker secret, Google Safe Browsing matches. The site does see a visit
  (from Cloudflare). Without a Worker, the phone only looks up the domain's age (RDAP).
- **Wi-Fi** (password hidden until you tap Show, copy buttons), **contacts** (Add to Contacts),
  **events** (Add to Calendar), email, phone, text messages (warns about premium and short-code
  numbers), map locations, product barcodes (check digit, web search), two-factor setup codes and
  payment codes (warnings, no open button), app links and enterprise app installs (blocked).
- **History** of scans stays on the phone; it can be turned off or cleared. Wi-Fi passwords are
  masked in the list.

**Create**: Link, Text, Wi-Fi, Contact (vCard), Email, Phone, Text message, Location (Apple Maps,
Google Maps or `geo:`, with "use my current location"), Event and Social profile (Instagram, TikTok,
X, YouTube, ...). Style it: colors (with contrast warnings), see-through background, square/rounded/dot
modules, square/rounded/circle corners, a logo or photo in the middle, a caption underneath, border
size and error correction. Every design is **test-scanned** as you edit ("✓ Scans correctly"). Save
as PNG (1024 px) or SVG (any size), share it, or keep it under **Saved** (e.g. your home Wi-Fi). Codes are
static: the content is in the code itself, with no QR service in between, so they never expire.

### Developing the tools

```bash
npm run vendor          # re-copy web/vendor from node_modules (after upgrading pdfjs-dist / @jsquash/webp)
npm run precache        # regenerate the offline file list in web/sw.js (a test fails if it is stale)
npm run test:web        # browser tests in Chromium: conversions, WebP encoder, offline mode
```

Add a tool: create `web/tools/<id>/<id>.js` exporting `mount(host)` (return an unmount function),
add it to `web/tools/index.js`, and run `npm run precache`.

## Repository layout

```
config/jobs.yaml            All job config (validated; invalid config fails loudly)
src/cli.js                  CLI: validate, list, due, run, scheduled, capture, notify-test, items, runs
src/core/                   Framework: config, registry, runner, retries/timeouts, schedule (cron),
                            polite HTTP + robots.txt, Playwright, notifications, logging + redaction
src/jobs/                   One module per job (files starting with "_" are templates)
  heartbeat.js              No-network self-test job
  _template.js              Copy this to add a job
src/store/                  local (SQLite file) / remote (Worker) / d1-shim (node:sqlite as D1)
src/exporters/sheets.js     Optional Google Sheets exporter
shared/                     Code shared by runner and Worker: SQL store, HMAC signing
worker/                     Cloudflare Worker (API, ingest, cron) + D1 migrations
web/                        PWA (no build step): app.js shell, jobs.js dashboard, tools/, lib/, vendor/
index.html                  Redirects the GitHub Pages root to web/
test/                       node:test suites; test/browser/ = Playwright tests for the tools
.github/workflows/          cc-scheduled, cc-dispatch, cc-ci (tests + secret scan), cc-pages
scripts/                    secret scan, git hook installer, icon renderer, failure alert
```

## Quick start (local, no cloud)

Requires Node 22.13+.

```bash
npm install
npx playwright install chromium         # only for jobs that render pages (needsBrowser)
npm run hooks:install                   # pre-commit secret scan

npm run validate                        # check config/jobs.yaml
npm test                                # framework + Worker tests

# Run a job: nothing persisted, notifications print to the console
npm run job -- heartbeat --dry-run

# Run it for real (state in .cc/local.db), then again: the second run reports "0 new" (dedupe)
npm run job -- heartbeat
npm run job -- heartbeat
npm run cc -- items heartbeat
npm run cc -- runs heartbeat
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
# Optional: npx wrangler secret put GSB_API_KEY  # Google Safe Browsing key (free; Google Cloud console → "Safe Browsing API") for the QR link check

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

**Pages**: "Deploy from a branch" (`main`, root) already works. Switching Settings → Pages →
Source to **GitHub Actions** and running **cc-pages** once additionally pre-fills the Worker URL in
the app, so you only type the token.

**Turn on the schedule** last: in `.github/workflows/cc-scheduled.yml`, uncomment the two
`schedule:` lines. It ships switched off so an unfinished setup doesn't fail every hour, and it also
skips itself while the `CC_WORKER_URL` repository variable is missing.

Check: Actions → **cc-dispatch** → Run workflow → `heartbeat`. Within a couple of minutes the run
is green and `GET /api/jobs` shows heartbeat with a successful last run.

### 4. Install the PWA on iPhone

GitHub Pages works either way: **deploy from branch** (`main`, root; the root `index.html`
redirects to `web/`; every merge is live within a minute or two) or **GitHub Actions** (run the
`cc-pages` workflow by hand; it publishes `web/` and writes the Worker URL into it).

Updates: the installed app checks for a new version whenever it is opened or brought back to the
foreground. If one is ready before you tap anything, it is applied immediately; if it arrives while
you are working, a "new version is ready" bar lets you reload when convenient.

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
  my-job:
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

## Adding a job

1. Copy `src/jobs/_template.js` to `src/jobs/<id>.js` (or `src/jobs/<id>/index.js`).
2. Export `{ id, name, description, schedule, configSchema?, needsBrowser?, formatNotification?, run(ctx) }`.
3. Add a `jobs.<id>` entry to `config/jobs.yaml` and run `npm run validate`.
4. Add a test that runs it against a saved page or API response (`fixture` option of `runJob`; see
   `test/worker.test.js`).

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
| GitHub Actions | Private repos: 2,000 Linux min/month. Public repos: unlimited | Hourly sweep ≈ 24 billed min/day (each job rounds up to 1 min) ≈ 720/mo. A browser job at 6 runs/day adds ~540/mo; an API job ~180/mo. CI ≈ 1–2 min per push | **This repo is public, so minutes are unlimited.** On a private repo the sweep plus two browser jobs would exceed 2,000; cut the sweep to every 2 hours (`23 */2 * * *`) there |
| GitHub Actions cron | Public repos: scheduled workflows are disabled after 60 days without repo activity | The Worker cron re-enables `cc-scheduled` and alerts | Handled |
| GitHub Pages | Free for public repos; **private repos need a paid plan** | PWA via cc-pages | **Flag:** if the repo is private on GitHub Free, use the Worker URL. The Worker serves the same PWA (static assets, free) |
| Workers | 100,000 requests/day; 10 ms CPU per request and per cron run; 50 subrequests; 5 cron triggers per account | A few hundred requests/day; 1 cron trigger (every 2h, ≤3 subrequests) | Fits. The cron lookback was rewritten to walk hours (~200 time-zone conversions) to stay inside 10 ms |
| D1 | 5M rows read/day, 100k rows written/day, 5 GB | A job returning ~50 items 6×/day ≈ 300 upserts/day (~1k row writes with indexes) | Fits. Retention prunes runs after 60 days and items unseen for 120 days |
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
    sheet: Results
    types: [match]
    columns: [currentBid, endTime, location]
```

Each run appends rows for its new items only: `timestamp, type, key, title, url, …columns`.
Exporter errors are logged and recorded on the run.

## Planned jobs (design notes)

Not built yet. Each fits the current contract:

| Job | Approach | Notes |
| --- | --- | --- |
| eBay comps | Browse API (free key) via `ctx.http.json` | **Active listings / asking prices only.** Sold data needs Marketplace Insights, which is approval-only; the Finding API (completed items) was shut down 2025-02-05 |
| Home listing tracker | Listing pages or feed via `ctx.page`; key = listing id; Sheets exporter | Needs **change** alerts (price drop, status). Plan: a read-only `ctx.previous(type, key)` backed by the existing `items` table, so jobs can emit `price_drop` items keyed `id@price` |
| Price drop / restock | Prefer the retailer's API or structured data (JSON-LD `offers`); key `url@price` or `url@instock` | Same `ctx.previous` addition |
| Odds snapshots | Odds API (e.g. The Odds API free tier) via `ctx.http.json`; key `event@book@timestamp` | API only, no sportsbook logins |
| Page → PDF / screenshot | `ctx.browser.withPage(p => p.pdf())` | Needs blob storage. R2 has a free tier (verify first); D1 is not for binaries |
| Utility bill PDFs | Low-risk login with `ctx.secret('username')` / `ctx.secret('password')` | Only if the site's terms allow it; never MFA-bypass; credentials stay in encrypted secrets |

## Assumptions to verify

Each one is a default you can test, change in one place, and report back on:

1. **Rendered pages run in UTC.** The runner's browser uses the UTC time zone, so a page that shows
   local times without a zone shows them in UTC. Parse them as UTC.
2. **"Current" items** are those present in the job's latest successful run (the PWA's default view
   for jobs with `ui.primary: 'current'`).
3. **A site may refuse automated access.** Check the site's robots.txt and terms before writing a
   scraping job, and test from GitHub's runners first: some sites block cloud IPs outright
   (GovDeals returned HTTP 403 "Access Denied" there, so that job was dropped). Prefer official APIs.

## Troubleshooting

| Symptom | Where to look |
| --- | --- |
| Push "Selector or parse broke" | Save the page with `npm run cc -- capture <url> --out page.html`, fix the job's parser against it, and add it as a test fixture |
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
