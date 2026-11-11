// Downloads (its own app) in the browser: a link checked as soon as it's in (signed links: expiry and
// token noted), the site asked the file's size and type, a still at its start and each minute drawn
// without playing it (tap one for every 10 seconds), downloaded with Save to phone above the stills,
// kept in History (after a reload too) with its fingerprint and details; a dropped download continued;
// a part of an MP4 fetched straight from the site; the queue (several links, each with its view and
// progress; one after another, or sharing the connection); leaving and coming back never downloads
// twice; cleared links leave nothing stored; a site that blocks apps gets frames and a link to open
// it; unsafe or expired links aren't fetched at all. The "CDN" is routed by Playwright.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { planPart } from '../../web/tools/download/mp4.js';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE_PATH = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };

let server; let browser; let origin; let webm; let mp4;

before(async () => {
  webm = await readFile(resolve(import.meta.dirname, '../fixtures/web/clock.webm')); // 2:30, VP9, no sound
  mp4 = await readFile(resolve(import.meta.dirname, '../fixtures/web/clock.mp4')); // 2:30, H.264 + AAC
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

/**
 * Serves a file like a CDN (HEAD, byte ranges, a date), with or without letting other sites' apps
 * read it. `cutFirst`: the first whole-file answer stops part way (a dropped connection). `slow`:
 * whole-file answers wait that long (a download that takes a while).
 */
function cdn(file, { cors = true, type = 'video/webm', seen = [], cutFirst = 0, slow = 0 } = {}) {
  let cut = cutFirst;
  return async (route) => {
    const req = route.request(); const entry = { url: req.url(), method: req.method(), headers: req.headers() }; seen.push(entry);
    const headers = await req.allHeaders(); entry.headers = headers;
    // (Routed responses skip the browser's cross-site check, so a site that doesn't allow apps is
    // played out here: the requests an app could read are refused.)
    if (!cors && headers.origin) return route.abort('accessdenied');
    const base = { 'content-type': type, 'accept-ranges': 'bytes', 'last-modified': 'Tue, 10 Nov 2026 10:00:00 GMT', ...(cors ? { 'access-control-allow-origin': '*' } : {}) };
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...base, 'content-length': String(file.length) }, body: '' });
    const m = /bytes=(\d+)-(\d*)/.exec(headers.range ?? '');
    if (!m) {
      if (slow) await new Promise((r) => setTimeout(r, slow));
      if (cut) { const n = cut; cut = 0; return route.fulfill({ status: 200, headers: { ...base, 'content-length': String(file.length) }, body: file.subarray(0, n) }); }
      return route.fulfill({ status: 200, headers: { ...base, 'content-length': String(file.length) }, body: file });
    }
    const a = Number(m[1]); const b = m[2] ? Math.min(Number(m[2]), file.length - 1) : file.length - 1;
    return route.fulfill({ status: 206, headers: { ...base, 'content-range': `bytes ${a}-${b}/${file.length}`, 'content-length': String(b - a + 1) }, body: file.subarray(a, b + 1) });
  };
}
/** The whole-file downloads asked for (not the stills' or checks' ranges). */
const downloads = (seen, url) => seen.filter((s) => s.method === 'GET' && !s.headers.range && (!url || s.url === url)).length;

async function openApp(context, hash = '#/downloads') {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE_PATH}${hash}`);
  await page.waitForSelector(hash ? '.dl-url' : '.app-tile');
  return { page, errors };
}
/** A link typed in and Enter (as checked when typing stops or it's pasted). */
const enter = async (page, url) => { await page.fill('.dl-url', url); await page.press('.dl-url', 'Enter'); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tab = (page, name) => page.click(`.dl-tabs >> text=${name}`);

test('downloads: its own app; checked as soon as it\'s in; stills and a closer look; Save above the stills; History with fingerprint, kept after a reload, saved, removed', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true });
  const seen = [];
  await context.route('https://cdn.example.com/**', cdn(webm, { seen }));
  const { page, errors } = await openApp(context, '');
  await page.click('.app-tile >> text=Downloads');
  await page.waitForSelector('.dl-url');
  assert.deepEqual(await page.$$eval('.dl-tabs [role=tab]', (els) => els.map((e) => e.textContent)), ['Download', 'Queue', 'History']);
  assert.equal(await page.locator('text=Check link').count(), 0, 'no button to press: it checks by itself');
  // Typed in: checked once typing stops (no Enter needed).
  await page.fill('.dl-url', 'https://cdn.example.com/v/clock.webm?utm_source=newsletter');
  await page.waitForSelector('.qr-verdict.ok');
  assert.equal(await page.inputValue('.dl-url'), 'https://cdn.example.com/v/clock.webm', 'tracking taken off');
  assert.match(await page.textContent('.dl-notes'), /Tracking removed — utm_source/);
  await page.waitForSelector('.dl-facts');
  assert.match(await page.textContent('.dl-facts'), /WebM · 53 KB · from cdn\.example\.com · can be resumed/);
  await page.waitForFunction(() => document.querySelectorAll('.dl-current .dl-grid .dl-thumb img').length === 3, null, { timeout: 30000 });
  assert.deepEqual(await page.$$eval('.dl-current .dl-grid figcaption', (els) => els.map((e) => e.textContent)), ['0:00', '1:00', '2:00']);
  assert.match(await page.textContent('.dl-meta'), /2:30 long · 96×54/);
  assert.equal(await page.$eval('video.dl-probe', (v) => v.paused), true, 'never played');
  // A closer look at 1:00: every 10 seconds of that minute.
  await page.click('.dl-current .dl-grid .dl-thumb >> nth=1');
  await page.waitForFunction(() => document.querySelectorAll('.dl-closer .dl-thumb img').length === 6, null, { timeout: 30000 });
  assert.deepEqual(await page.$$eval('.dl-closer figcaption', (els) => els.map((e) => e.textContent)), ['1:00', '1:10', '1:20', '1:30', '1:40', '1:50']);
  await page.click('.dl-closer [aria-label=Close]');
  await page.waitForSelector('.dl-closer', { state: 'detached' });

  await page.click('text=⬇️ Download (53 KB)');
  await page.waitForSelector('.dl-actions >> text=💾 Save to phone');
  // Save to phone sits above the stills.
  assert.equal(await page.evaluate(() => !!(document.querySelector('.dl-actions').compareDocumentPosition(document.querySelector('.dl-current .dl-grid')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('.dl-actions >> text=💾 Save to phone')]);
  assert.equal(Buffer.compare(await readFile(await dl1.path()), webm), 0, 'the same bytes as the link');

  // History: its details and fingerprint.
  await tab(page, 'History');
  await page.waitForSelector('.dl-card >> text=💾 Save to phone');
  assert.match(await page.textContent('.dl-card .dl-details'), /53 KB · 96×54 · 2 fps · VP9 · no sound/);
  assert.match(await page.textContent('.dl-hist-head'), /1 download · 53 KB on this phone/);
  assert.match(await page.textContent('.dl-fp .linkish'), new RegExp(`Fingerprint ${sha(webm).slice(0, 8)} ${sha(webm).slice(8, 16)}`));
  await page.fill('.dl-fp-in', sha(webm).toUpperCase());
  assert.match(await page.textContent('.dl-fp .ok-text'), /Matches/);
  // Kept on the phone: still there after a reload, and saves the same bytes.
  await page.reload();
  await page.waitForSelector('.dl-card >> text=💾 Save to phone');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.dl-card >> text=💾 Save to phone')]);
  assert.equal(dl.suggestedFilename(), 'clock.webm');
  assert.equal(Buffer.compare(await readFile(await dl.path()), webm), 0);
  // Nothing but the link was fetched, and no cookies or referrer went with it.
  assert.ok(seen.length > 0 && seen.every((s) => s.url === 'https://cdn.example.com/v/clock.webm'));
  assert.ok(seen.every((s) => !s.headers.cookie && !s.headers.referer));
  // ✕ removes it (and what it stored).
  await page.click('.dl-card .dl-x');
  await page.waitForSelector('text=Nothing downloaded yet.');
  await page.reload();
  await page.waitForSelector('text=Nothing downloaded yet.');
  // The old Files → Download address comes here.
  await page.goto(`${origin}${BASE_PATH}#/files/download`);
  await page.waitForFunction(() => location.hash === '#/downloads');
  assert.deepEqual(errors, []);
  await context.close();
});

test('downloads: a dropped download continues from where it stopped, with the whole file\'s fingerprint', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true });
  const seen = [];
  await context.route('https://cdn.example.com/**', cdn(webm, { seen, cutFirst: 20_000 }));
  const { page, errors } = await openApp(context);
  await enter(page, 'https://cdn.example.com/v/clock.webm');
  await page.click('text=⬇️ Download (53 KB)');
  await page.waitForSelector('.dl-actions >> text=▶ Continue');
  assert.match(await page.textContent('.dl-actions .progress-label'), /Stopped · 20 KB of 53 KB/);
  await page.click('.dl-actions >> text=▶ Continue');
  await page.waitForSelector('.dl-actions >> text=💾 Save to phone');
  assert.ok(seen.some((s) => s.headers.range === 'bytes=20000-'), 'asked for the rest only');
  await tab(page, 'History');
  assert.match(await page.textContent('.dl-fp .linkish'), new RegExp(sha(webm).slice(0, 8)));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.dl-card >> text=💾 Save to phone')]);
  assert.equal(Buffer.compare(await readFile(await dl.path()), webm), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('downloads: an MP4\'s details before downloading, and just a part of it fetched from the site', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true });
  const seen = [];
  await context.route('https://cdn.example.com/**', cdn(mp4, { seen, type: 'video/mp4' }));
  const { page, errors } = await openApp(context);
  await enter(page, 'https://cdn.example.com/v/clock.mp4');
  await page.waitForSelector('.dl-facts >> text=H.264');
  assert.match(await page.textContent('.dl-facts'), /MP4 · 328 KB .* · can be resumed\s*96×54 · 10 fps · H\.264 · AAC mono 22\.1 kHz/);
  await page.click('text=✂️ Download just a part');
  await page.selectOption('.dl-partbox select[aria-label=From]', '60');
  await page.selectOption('.dl-partbox select[aria-label=To]', '120');
  // (The stills' own requests settle first, so only the part's are counted.)
  for (let n = -1; n !== seen.length;) { n = seen.length; await page.waitForTimeout(700); }
  const before = seen.length;
  await page.click('text=⬇️ Download part');
  await page.waitForSelector('.dl-actions >> text=💾 Save to phone');
  assert.match(await page.textContent('.dl-actions .dl-file'), /clock \(1\.00–2\.00\)\.mp4 · .* H\.264 · AAC/);
  const asked = seen.slice(before).filter((s) => s.method === 'GET');
  assert.ok(asked.length && asked.every((s) => /^bytes=\d+-\d+$/.test(s.headers.range)), 'only ranges: the index and the part\'s frames');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.dl-actions >> text=💾 Save to phone')]);
  const plan = await planPart({ size: mp4.length, read: async (o, n) => new Uint8Array(mp4.subarray(o, o + n)) }, 60, 120);
  const want = Buffer.concat([plan.head, ...plan.ranges.map((r) => mp4.subarray(r.offset, r.offset + r.length))]);
  assert.equal(Buffer.compare(await readFile(await dl.path()), want), 0, 'exactly the part');
  assert.deepEqual(errors, []);
  await context.close();
});

test('downloads: the queue — add links while one checks, each with its view and progress; one after another or sharing the connection; leaving and coming back never downloads twice', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true });
  const seen = [];
  await context.route('https://cdn.example.com/**', cdn(webm, { seen, slow: 2500 }));
  const { page, errors } = await openApp(context);
  const A = 'https://cdn.example.com/v/a.webm'; const B = 'https://cdn.example.com/v/b.webm'; const C = 'https://cdn.example.com/v/c.webm';
  for (const u of [A, B, C]) {
    await enter(page, u);
    await page.click('.dl-queue-row >> text=+ Add to Queue');
    assert.equal(await page.inputValue('.dl-url'), '', 'the box is ready for the next');
  }
  assert.match(await page.textContent('.dl-flash'), /Added to the queue \(3\)/);
  await page.click('text=View Queue (3)');
  await page.waitForSelector('.dl-qrow');
  assert.equal(await page.textContent('.dl-tabs .active'), 'Queue (3)');
  await page.waitForFunction(() => [...document.querySelectorAll('.dl-qrow')].every((r) => /Checked · WebM · 53 KB/.test(r.textContent)));
  assert.deepEqual(await page.$$eval('.dl-qrow .dl-name', (els) => els.map((e) => e.textContent)), ['a.webm', 'b.webm', 'c.webm']);
  // One opened: the same view as a single link (check, Download, stills).
  await page.click('.dl-qrow >> nth=0');
  await page.waitForSelector('.dl-qitem .qr-verdict.ok');
  await page.waitForFunction(() => document.querySelectorAll('.dl-qitem .dl-grid .dl-thumb img').length === 3, null, { timeout: 30000 });
  await page.click('.dl-qitem >> text=⬇️ Download (53 KB)');
  await page.waitForSelector('.dl-qitem .progress-label');
  // Another while that one is going: it says they'd share the connection, and offers to wait.
  await page.click('text=‹ Queue');
  await page.click('.dl-qrow >> nth=1');
  await page.waitForSelector('.dl-qitem .dl-share-note');
  assert.match(await page.textContent('.dl-qitem .dl-share-note'), /Another download is going: downloading this now shares the connection, so each goes slower/);
  await page.click('.dl-qitem >> text=⏳ When the others finish');
  await page.waitForSelector('.dl-qitem >> text=Waiting for the other downloads to finish');
  // The queue shows each one's progress bar.
  await page.click('text=‹ Queue');
  assert.equal(await page.$$eval('.dl-qrow .progress:not([hidden])', (els) => els.length), 2);
  // Leaving the app and coming back while it downloads: it carries on, not started again.
  await page.click('#view-app .back');
  await page.waitForSelector('#view-home:not([hidden])');
  await page.click('.app-tile >> text=Downloads');
  await tab(page, 'Queue');
  // The rest one after another.
  await page.click('text=⬇️ Download all 1 (one after another)');
  await page.waitForFunction(() => [...document.querySelectorAll('.dl-qrow')].every((r) => /Downloaded · 53 KB/.test(r.textContent)), null, { timeout: 30000 });
  for (const u of [A, B, C]) assert.equal(downloads(seen, u), 1, `${u} downloaded once`);
  // Tap one that's done: Save to phone.
  await page.click('.dl-qrow >> nth=2');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.dl-qitem >> text=💾 Save to phone')]);
  assert.equal(dl.suggestedFilename(), 'c.webm');
  // Removing from the queue: the link's gone (its download stays in History).
  await page.click('text=‹ Queue');
  await page.click('.dl-qrow >> nth=0 >> .dl-x');
  assert.equal(await page.$$eval('.dl-qrow', (els) => els.length), 2);
  await tab(page, 'History');
  assert.equal(await page.$$eval('.dl-card', (els) => els.length), 3);
  assert.deepEqual(errors, []);
  await context.close();
});

test('downloads: links pasted and cleared leave nothing stored; Paste picks the link out of what was copied; a refused clipboard says how; ✕ starts again', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.route('https://cdn.example.com/**', cdn(webm));
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const { page, errors } = await openApp(context);
  const paste = () => page.getByRole('button', { name: '📋 Paste', exact: true }).click();
  assert.equal(await page.isVisible('.dl-clear'), false, 'nothing to clear yet');
  await page.evaluate(() => navigator.clipboard.writeText('Watch this: https://cdn.example.com/v/secret-clip.webm?token=abc. So good'));
  await paste();
  await page.waitForSelector('.qr-verdict.ok');
  assert.equal(await page.inputValue('.dl-url'), 'https://cdn.example.com/v/secret-clip.webm?token=abc');
  await page.waitForFunction(() => document.querySelectorAll('.dl-current .dl-grid .dl-thumb img').length === 3, null, { timeout: 30000 });
  await page.click('.dl-queue-row >> text=+ Add to Queue');
  // Pasted into the box by hand: checked straight away.
  await page.evaluate(() => navigator.clipboard.writeText('https://cdn.example.com/v/other.webm'));
  await page.focus('.dl-url');
  await page.keyboard.press('ControlOrMeta+V');
  await page.waitForSelector('.qr-verdict.ok');
  // ✕: the link and everything shown for it gone.
  await page.click('.dl-clear');
  assert.equal(await page.inputValue('.dl-url'), '');
  assert.equal(await page.$$eval('.dl-current *', (els) => els.length), 0);
  assert.equal(await page.isVisible('.dl-clear'), false);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('dl-url')), true, 'ready to paste another');
  // Remove the queued one too: then nothing of either link is stored anywhere on the phone.
  await tab(page, 'Queue');
  await page.click('.dl-qrow .dl-x');
  const stored = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i), localStorage.getItem(localStorage.key(i)));
    for (let i = 0; i < sessionStorage.length; i++) out.push(sessionStorage.key(i), sessionStorage.getItem(sessionStorage.key(i)));
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise((r) => { const q = indexedDB.open(name); q.onsuccess = () => r(q.result); });
      for (const s of db.objectStoreNames) out.push(JSON.stringify(await new Promise((r) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); })));
      db.close();
    }
    out.push(...(await caches.keys()));
    return out.join('\n');
  });
  assert.ok(!/secret-clip|other\.webm|token=abc/.test(stored), 'no trace of the links');
  // A browser that won't hand over the clipboard: how to paste instead.
  await tab(page, 'Download');
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'readText', { value: () => Promise.reject(new DOMException('no', 'NotAllowedError')) }); Object.defineProperty(navigator.clipboard, 'read', { value: () => Promise.reject(new DOMException('no', 'NotAllowedError')) }); });
  await paste();
  await page.waitForSelector('.dl-paste-hint:not([hidden]) >> text=Press and hold in the box');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('dl-url')), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('downloads: a site that blocks apps shows frames and offers to open it; unsafe and expired links are never fetched; signed links noted', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const seen = [];
  await context.route('https://nocors.example.com/**', cdn(webm, { cors: false, seen }));
  await context.route('https://cdn.example.com/**', cdn(webm, { seen }));
  await context.route('http://**', (r) => { seen.push({ url: r.request().url() }); return r.continue(); });
  const { page, errors } = await openApp(context);
  await enter(page, 'https://nocors.example.com/v/clock.webm');
  await page.waitForSelector('.dl-current .dl-grid .dl-thumb video');
  assert.match(await page.textContent('.dl-info'), /doesn't answer questions about the file/);
  assert.deepEqual(await page.$$eval('.dl-current .dl-grid figcaption', (els) => els.map((e) => e.textContent)), ['0:00', '1:00', '2:00']);
  await page.click('text=⬇️ Download');
  await page.waitForSelector('.dl-actions >> text=↗ Open in the browser');
  assert.equal(await page.getAttribute('.dl-actions a.btn', 'rel'), 'noopener noreferrer');
  assert.match(await page.textContent('.dl-actions .warn-text'), /only let their own pages/);

  const before = seen.length;
  const exp = Math.floor(Date.now() / 1000);
  for (const bad of ['http://cdn.example.com/a.mp4', 'https://192.168.0.2/a.mp4', 'https://cdn.example.com/live.m3u8', 'https://paypal-secure-login.com/a.mp4',
    `https://cdn.example.com/a.webm?Expires=${exp - 300}&Signature=abcDEF123456789xyz&Key-Pair-Id=K2`]) {
    await enter(page, bad);
    await page.waitForSelector('.qr-verdict.danger');
    assert.equal(await page.$$eval('.dl-current .dl-grid .dl-thumb', (els) => els.length), 0, bad);
    assert.equal(await page.locator('.dl-queue-row button', { hasText: 'Add to Queue' }).count(), 0, `a refused link can't be queued (${bad})`);
  }
  assert.match(await page.textContent('.qr-verdict.danger'), /expired/);
  assert.equal(seen.length, before, 'nothing fetched for them');
  // A caution (an odd port) is asked about before anything is fetched.
  await enter(page, 'https://nocors.example.com:8443/v/clock.webm');
  await page.waitForSelector('.qr-verdict.caution');
  assert.equal(await page.isVisible('text=I trust it: continue'), true);
  assert.equal(seen.length, before);
  // A signed link: when it stops working, and its token, said; left exactly as it is.
  const signed = `https://cdn.example.com/v/clock.webm?Expires=${exp + 3600}&Signature=abcDEF123456789xyz&Key-Pair-Id=K2&utm_source=x`;
  await enter(page, signed);
  await page.waitForSelector('.dl-notes');
  assert.match(await page.textContent('.dl-notes'), /Stops working in (59|60) min.*Has an access token in it/s);
  assert.equal(await page.inputValue('.dl-url'), signed);
  assert.deepEqual(errors, []);
  await context.close();
});
