// Storage (Productivity): what's on this device as a pie and a list (largest items inside), GB from
// 1,000 MB, and Google Drive's space with Saved Files' folder counted (a pretend Saved Files script).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server; let browser; let origin;

before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.startsWith(BASE)) { res.writeHead(404).end(); return; }
    const rel = path.slice(BASE.length) || 'index.html';
    try { res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(await readFile(join(WEB, rel))); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
});
after(async () => { await browser?.close(); server?.close(); });

test('Storage: a pie of what\'s on this device, its items, and Google Drive\'s space with Saved Files counted (GB from 1,000 MB)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const GB = 1024 ** 3;
  await page.route('https://script.google.com/**', async (route) => {
    const req = JSON.parse(route.request().postData());
    const files = { '': [{ name: 'ccv.a', size: 820e6 }, { name: 'command-center-vault.json', size: 1800 }], s1: [{ name: 'socials-key.json', size: 900 }, { name: 'socials-m-1.ccs', size: 2.1e6 }] };
    const body = req.action === 'quota' ? { ok: true, used: 9.4 * GB, limit: 15 * GB } : req.action === 'folders' ? { ok: true, folders: [{ id: 's1', name: 'Socials', path: 'Socials' }] } : req.action === 'list' ? { ok: true, files: files[req.folder ?? ''], folders: [], path: [] } : { ok: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`${origin}${BASE}index.html#/`);
  // Home: Storage is in Productivity.
  await page.locator('a[href="#/storage"]').first().waitFor();
  await page.evaluate(async () => {
    const { idb } = await import('./lib/idb.js');
    await idb.set('draw.sketch1', new Uint8Array(3e6)); await idb.set('cc.socials.m.p1', { type: 'image/jpeg', buf: new Uint8Array(1.5e6) });
    localStorage.setItem('cc.savedFiles', JSON.stringify({ url: 'https://script.google.com/macros/s/X/exec', key: 'k' }));
  });
  await page.goto(`${origin}${BASE}index.html#/storage`);
  const device = page.locator('.stg-card').first();
  await device.locator('.stg-pie').waitFor();
  assert.ok(await device.locator('.stg-pie-slice').count() >= 2, 'slices drawn');
  assert.match(await device.locator('.stg-legend').innerText(), /Drawings[\s\S]*MB/);
  await device.getByText('Drawings', { exact: true }).last().click();
  assert.match(await device.locator('.stg-items').first().innerText(), /Drawing \(sketch1\)/);
  const drive = page.locator('.stg-card').nth(1);
  await drive.getByText('Count again').waitFor({ timeout: 15000 });
  const t = await drive.innerText();
  assert.match(t, /9\.40 GB of 15\.0 GB/);
  assert.match(t, /Saved Files: your files \(1\)/);
  assert.match(t, /Socials' copy \(1 files\)/);
  assert.match(t, /Encryption keys and kit \(2\)/);
  assert.match(t, /The rest of your Drive/);
  // The explanations.
  assert.match(await page.locator('.stg').innerText(), /25 MB a file in Saved Files[\s\S]*How encryption affects storage[\s\S]*about 430 bytes/);
  assert.deepEqual(errors, []);
  await ctx.close();
});
