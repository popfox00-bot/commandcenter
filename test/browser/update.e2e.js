// The installed app must pick up a new deploy: relaunching applies a waiting update automatically.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, cp, mkdtemp } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
let server; let browser; let origin; let dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cc-update-'));
  await cp(resolve(import.meta.dirname, '../../web'), dir, { recursive: true });
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = path.startsWith(BASE) ? path.slice(BASE.length) || 'index.html' : null;
    // Like GitHub Pages: files may be cached by the browser for 10 minutes.
    try { res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream', 'cache-control': 'max-age=600' }).end(await readFile(join(dir, rel))); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
});
after(async () => { await browser?.close(); server?.close(); });

test('a new deploy is applied when the app is reopened, even with HTTP caching', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}${BASE}`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.match(await page.textContent('#tool-list'), /File Converter/);

  // Deploy a new version: changed tool list + new precache version.
  const idx = join(dir, 'tools/index.js');
  await writeFile(idx, (await readFile(idx, 'utf8')).replace("name: 'File Converter'", "name: 'File Converter v2'"));
  const sw = join(dir, 'sw.js');
  await writeFile(sw, (await readFile(sw, 'utf8')).replace(/"version": "[0-9a-f]+"/, '"version": "deadbeef0001"'));

  // "Reopen" the app (navigation triggers the update check). No taps: the update applies itself.
  await page.goto(`${origin}${BASE}`);
  await page.waitForFunction(() => /File Converter v2/.test(document.querySelector('#tool-list')?.textContent ?? ''), null, { timeout: 15000 });
  await context.close();
});

test('an update arriving mid-use asks before reloading', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}${BASE}`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.mouse.click(5, 300); // the user is doing something
  const sw = join(dir, 'sw.js');
  await writeFile(sw, (await readFile(sw, 'utf8')).replace(/"version": "[0-9a-f]+"/, '"version": "deadbeef0002"'));
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForSelector('#update:not([hidden])', { timeout: 15000 });
  await Promise.all([page.waitForEvent('load'), page.click('#update')]);
  await context.close();
});
