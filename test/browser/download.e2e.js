// Files → Download in the browser: a link checked, a still at its start and each minute drawn
// without playing it, downloaded with progress and saved; a site that blocks apps gets frames and
// a link to open it instead; unsafe links aren't fetched at all. The "CDN" is routed by Playwright.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE_PATH = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };

let server; let browser; let origin; let clip;

before(async () => {
  clip = await readFile(resolve(import.meta.dirname, '../fixtures/web/clock.webm')); // 2:30 long
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.startsWith(BASE_PATH)) { res.writeHead(404).end(); return; }
    const rel = path.slice(BASE_PATH.length) || 'index.html';
    try { res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(await readFile(join(WEB, rel))); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
});
after(async () => { await browser?.close(); server?.close(); });

/** Serves the clip (with byte ranges), with or without letting other sites' apps read it. */
function cdn(cors, seen) {
  return async (route) => {
    const req = route.request(); const headers = await req.allHeaders(); seen.push({ url: req.url(), headers });
    // (Routed responses skip the browser's cross-site check, so a site that doesn't allow apps is
    // played out here: the requests an app could read are refused.)
    if (!cors && headers.origin) return route.abort('accessdenied');
    const base = { 'content-type': 'video/webm', 'accept-ranges': 'bytes', ...(cors ? { 'access-control-allow-origin': '*' } : {}) };
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers().range ?? '');
    if (!m) return route.fulfill({ status: 200, headers: { ...base, 'content-length': String(clip.length) }, body: clip });
    const a = Number(m[1]); const b = m[2] ? Math.min(Number(m[2]), clip.length - 1) : clip.length - 1;
    return route.fulfill({ status: 206, headers: { ...base, 'content-range': `bytes ${a}-${b}/${clip.length}`, 'content-length': String(b - a + 1) }, body: clip.subarray(a, b + 1) });
  };
}

async function openDownload(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE_PATH}#/files/download`);
  await page.waitForSelector('.dl-url');
  return { page, errors };
}

test('download: checks the link, draws a still per minute, downloads with progress, saves the file', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true });
  const seen = [];
  await context.route('https://cdn.example.com/**', cdn(true, seen));
  const { page, errors } = await openDownload(context);
  await page.fill('.dl-url', 'https://cdn.example.com/v/clock.webm');
  await page.click('text=Check link');
  await page.waitForSelector('.qr-verdict.ok');
  // 2:30 long: the start, 1:00 and 2:00, each a picture drawn here.
  await page.waitForFunction(() => document.querySelectorAll('.dl-thumb img').length === 3, null, { timeout: 30000 });
  assert.deepEqual(await page.$$eval('.dl-thumb figcaption', (els) => els.map((e) => e.textContent)), ['0:00', '1:00', '2:00']);
  assert.match(await page.textContent('.dl-meta'), /2:30 long · 96×54/);
  assert.equal(await page.$$eval('.dl-thumb img', (els) => els.every((i) => i.naturalWidth > 0)), true);
  assert.equal(await page.$eval('video.dl-probe', (v) => v.paused), true, 'never played');

  await page.click('text=⬇️ Download');
  await page.waitForSelector('text=💾 Save to phone');
  assert.match(await page.textContent('.progress-label'), /Downloaded · \d+ KB/);
  assert.match(await page.textContent('.dl-file'), /clock\.webm/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=💾 Save to phone')]);
  assert.equal(dl.suggestedFilename(), 'clock.webm');
  const saved = await readFile(await dl.path());
  assert.equal(Buffer.compare(saved, clip), 0, 'the same bytes as the link');
  // Nothing but the link was fetched, and no cookies or referrer went with it.
  assert.ok(seen.length > 0 && seen.every((s) => s.url === 'https://cdn.example.com/v/clock.webm'));
  assert.ok(seen.every((s) => !s.headers.cookie && !s.headers.referer));
  assert.deepEqual(errors, []);
  await context.close();
});

test('download: a site that blocks apps shows frames and offers to open it; unsafe links are never fetched', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const seen = [];
  await context.route('https://nocors.example.com/**', cdn(false, seen));
  await context.route('http://**', (r) => { seen.push({ url: r.request().url() }); return r.continue(); });
  const { page, errors } = await openDownload(context);
  await page.fill('.dl-url', 'https://nocors.example.com/v/clock.webm');
  await page.click('text=Check link');
  await page.waitForSelector('.dl-thumb video');
  assert.deepEqual(await page.$$eval('.dl-thumb figcaption', (els) => els.map((e) => e.textContent)), ['0:00', '1:00', '2:00']);
  await page.click('text=⬇️ Download');
  await page.waitForSelector('text=↗ Open the video in the browser');
  assert.equal(await page.getAttribute('.dl-help a', 'rel'), 'noopener noreferrer');

  const before = seen.length;
  for (const bad of ['http://cdn.example.com/a.mp4', 'https://192.168.0.2/a.mp4', 'https://cdn.example.com/live.m3u8', 'https://paypal-secure-login.com/a.mp4']) {
    await page.fill('.dl-url', bad);
    await page.click('text=Check link');
    await page.waitForSelector('.qr-verdict.danger');
    assert.equal(await page.$$eval('.dl-thumb', (els) => els.length), 0, bad);
  }
  assert.equal(seen.length, before, 'nothing fetched for them');
  // A caution (an odd port) is asked about before anything is fetched.
  await page.fill('.dl-url', 'https://nocors.example.com:8443/v/clock.webm');
  await page.click('text=Check link');
  await page.waitForSelector('.qr-verdict.caution');
  assert.equal(await page.isVisible('text=I trust it: continue'), true);
  assert.equal(seen.length, before);
  assert.deepEqual(errors, []);
  await context.close();
});
