// Browser test for Notes' voice memos (`npm run test:web`), with Chromium's stand-in microphone:
// record a memo in a note, play it back, see it on the note's card, delete it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server; let browser; let origin;

before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = path.startsWith(BASE) ? path.slice(BASE.length) || 'index.html' : null;
    try { res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(await readFile(join(WEB, rel))); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
});
after(async () => { await browser?.close(); server?.close(); });

test('Notes: 🎙 Memo records a voice memo into a new note; it plays back, shows on the card, and can be deleted', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/notes`);
  await page.waitForSelector('.nt-pane');
  await page.getByRole('button', { name: 'New voice memo' }).click();
  // Recording straight away, with a running time.
  await page.waitForSelector('.nt-recording');
  await page.waitForFunction(() => /● 0:0[1-9]/.test(document.querySelector('.nt-rec-time')?.textContent ?? ''), null, { timeout: 8000 });
  await page.getByRole('button', { name: '■ Stop' }).click();
  await page.waitForSelector('.nt-memo audio');
  assert.match(await page.textContent('.nt-memo'), /Memo 1 · 0:0[1-9]/);
  const audio = await page.$eval('.nt-memo audio', (a) => new Promise((res) => { if (a.readyState >= 1) res(a.src); else a.onloadedmetadata = () => res(a.src); a.onerror = () => res('error'); }));
  assert.match(audio, /^blob:/, 'plays from the phone');
  await page.fill('.nt-title', 'Hook idea');
  await page.getByRole('button', { name: '‹ Notes' }).click();
  assert.match(await page.textContent('.nt-card'), /Hook idea[\s\S]*🎙 1 · 0:0\d/);
  // Kept after a reload; delete it.
  await page.reload();
  await page.locator('.nt-card', { hasText: 'Hook idea' }).click();
  await page.waitForSelector('.nt-memo audio');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete memo 1' }).click();
  await page.waitForFunction(() => !document.querySelector('.nt-memo'));
  assert.deepEqual(errors, []);
  await context.close();
});
