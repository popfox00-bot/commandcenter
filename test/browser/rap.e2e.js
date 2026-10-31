// Browser tests for the Rap app (`npm run test:web`): writing lines, the suggestions and rhyme bank,
// Saved Songs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' };
let server; let browser; let origin;

before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = path.startsWith(BASE) ? path.slice(BASE.length) || 'index.html' : null;
    try { res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(await readFile(join(WEB, rel))); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
});
after(async () => { await browser?.close(); server?.close(); });

test('Rap: write line by line (Enter for the next), suggestions and rhymes as you go, tap a word for its rhymes, saved as a song', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}`);
  await page.click('.app-tile >> text=Rap');
  await page.waitForSelector('.rap-current');
  await page.waitForSelector('.rap-sugg');
  await page.fill('.rap-title', 'Night Shift');
  await page.click('.rap-current');
  await page.keyboard.type('I been working all night ');
  // The rhyme bank follows the last word written.
  await page.waitForFunction(() => document.querySelector('.rap-bank-word')?.value === 'night');
  assert.match(await page.textContent('.rap-bank-list'), /light/);
  assert.equal(await page.textContent('.rap-syl'), '6');
  await page.keyboard.press('Enter');
  // A new line, in focus; the one before above it, smaller.
  assert.deepEqual(await page.$$eval('.rap-row', (rows) => rows.map((r) => r.className.includes('is-current') ? 'current' : r.textContent.replace('✎', '').trim())), ['I been working all night', 'current']);
  const sizes = await page.evaluate(() => [getComputedStyle(document.querySelector('.is-before .rap-line')).fontSize, getComputedStyle(document.querySelector('.rap-current')).fontSize].map(parseFloat));
  assert.ok(sizes[0] < sizes[1], `the line before is smaller (${sizes})`);
  // Complete the line: rhymes with "night".
  assert.match(await page.textContent('.rap-sugg h4'), /rhymes with “night”/);
  await page.keyboard.type('now I ');
  const completes = await page.$$eval('.rap-complete', (b) => b.map((x) => x.textContent));
  assert.equal(completes.length, 3);
  await page.locator('.rap-complete').first().click();
  const line2 = await page.inputValue('.rap-current');
  assert.ok(line2.startsWith('now I ') && line2.length > 'now I '.length + 3, `completed: "${line2}"`);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('rap-current')), true, 'still writing');
  await page.keyboard.press('Enter');
  // Tap a word in a line above: the bank shows its rhymes; tap one to add it.
  await page.locator('.rap-word', { hasText: 'working' }).click();
  await page.waitForFunction(() => document.querySelector('.rap-bank-word')?.value === 'working');
  assert.equal(await page.isVisible('.rap-word.picked'), true);
  await page.locator('.rap-bank-list .rap-chip').first().click();
  assert.ok((await page.inputValue('.rap-current')).trim().length > 2, 'a rhyme added to the line');
  // A next-word suggestion adds a word.
  const before = await page.inputValue('.rap-current');
  await page.locator('.rap-sugg .rap-chips .rap-chip').first().click();
  assert.ok((await page.inputValue('.rap-current')).length > before.length);

  // Saved Songs: it's there; it opens again after a reload.
  await page.waitForTimeout(400);
  await page.getByRole('tab', { name: '💾 Saved Songs' }).click();
  await page.waitForSelector('.rap-song');
  assert.match(await page.textContent('.rap-song'), /Night Shift[\s\S]*I been working all night[\s\S]*3 lines/);
  await page.reload();
  await page.getByRole('button', { name: 'Open Night Shift' }).click();
  await page.waitForSelector('.rap-current');
  assert.match(await page.textContent('.rap-stage'), /I been working all night/);
  assert.equal(await page.inputValue('.rap-title'), 'Night Shift');
  // Backspace at the start of a line joins it to the one before.
  await page.click('.rap-current');
  await page.keyboard.press('Home');
  const rows = await page.$$eval('.rap-row', (r) => r.length);
  await page.keyboard.press('Backspace');
  assert.equal(await page.$$eval('.rap-row', (r) => r.length), rows - 1);
  assert.deepEqual(errors, []);
  await context.close();
});
