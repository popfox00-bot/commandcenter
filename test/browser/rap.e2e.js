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
  assert.deepEqual(await page.$$eval('.rap-row', (rows) => rows.map((r) => (r.className.includes('is-current') ? 'current' : r.querySelector('.rap-line').textContent.trim()))), ['I been working all night', 'current']);
  const sizes = await page.evaluate(() => [getComputedStyle(document.querySelector('.is-before .rap-line')).fontSize, getComputedStyle(document.querySelector('.rap-current')).fontSize].map(parseFloat));
  assert.ok(sizes[0] < sizes[1], `the line before is smaller (${sizes})`);
  // Complete the line: rhymes with "night".
  assert.match(await page.textContent('.rap-group'), /^Arhymes with “night”fits/);
  await page.keyboard.type('now I ');
  const completes = await page.$$eval('.rap-complete', (b) => b.map((x) => x.textContent));
  assert.equal(completes.length, 3);
  await page.locator('.rap-complete').first().click();
  const line2 = await page.inputValue('.rap-current');
  assert.ok(line2.startsWith('now I ') && line2.length > 'now I '.length + 3, `completed: "${line2}"`);
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('rap-current')), true, 'still writing');
  await page.keyboard.press('Enter');
  // Rhyme letters beside the lines, and the scheme.
  await page.keyboard.type('keep it real');
  assert.deepEqual(await page.$$eval('.rap-letter', (b) => b.map((x) => x.textContent)).then((l) => l.slice(0, 3)), ['A', 'A', 'B']);
  assert.match(await page.textContent('.rap-scheme'), /^AAB?$/);
  await page.keyboard.press('Enter');
  // The next line: B (rhymes with "real") fits the pairs; a new rhyme is offered too.
  const groups = await page.$$eval('.rap-group', (g) => g.map((x) => x.textContent));
  assert.match(groups[0], /^Brhymes with “real”fits/);
  assert.ok(groups.some((g) => /new rhyme/.test(g)));
  // A next-word suggestion adds a word.
  await page.locator('.rap-sugg .rap-chips .rap-chip').first().click();
  assert.ok((await page.inputValue('.rap-current')).trim().length > 0);
  // Tap inside a word of an earlier line: that line is edited, the cursor right there, the bank on that word.
  await page.locator('.rap-word', { hasText: 'working' }).click({ position: { x: 6, y: 10 } });
  await page.waitForFunction(() => document.querySelector('.rap-bank-word')?.value === 'working');
  assert.equal(await page.inputValue('.rap-current'), 'I been working all night');
  const caret = await page.evaluate(() => document.activeElement.selectionStart);
  assert.ok(caret >= 7 && caret <= 14, `the cursor in "working" (${caret})`);
  await page.keyboard.type('X');
  assert.match(await page.inputValue('.rap-current'), /^I been w\w*X\w*ing all night$|^I been \w*X\w* all night$/);
  await page.keyboard.press('Backspace');
  assert.equal(await page.inputValue('.rap-current'), 'I been working all night');

  // A note on a line: the note button opens it under the line; the button shows there's one.
  await page.getByRole('button', { name: 'Note for line 1' }).click();
  await page.waitForSelector('.rap-note');
  await page.waitForFunction(() => document.activeElement?.classList.contains('rap-note')); // ready to type
  await page.keyboard.type('slow, half-time delivery');
  await page.getByRole('button', { name: 'Note for line 1' }).click();
  assert.equal(await page.isVisible('.rap-note'), false);
  assert.match(await page.getAttribute('[aria-label="Note for line 1"]', 'class'), /has-note/);
  assert.doesNotMatch(await page.getAttribute('[aria-label="Note for line 2"]', 'class'), /has-note/);

  // Saved Songs: it's there; it opens again after a reload.
  await page.waitForTimeout(400);
  await page.getByRole('tab', { name: '💾 Saved Songs' }).click();
  await page.waitForSelector('.rap-song');
  assert.match(await page.textContent('.rap-song'), /Night Shift[\s\S]*I been working all night[\s\S]*4 lines/);
  await page.reload();
  await page.getByRole('button', { name: 'Open Night Shift' }).click();
  await page.waitForSelector('.rap-current');
  assert.match(await page.textContent('.rap-stage'), /I been working all night/);
  assert.equal(await page.inputValue('.rap-title'), 'Night Shift');
  await page.getByRole('button', { name: 'Note for line 1' }).click();
  assert.equal(await page.inputValue('.rap-note'), 'slow, half-time delivery', 'notes are saved with the song');
  await page.getByRole('button', { name: 'Note for line 1' }).click();
  // Backspace at the start of a line joins it to the one before.
  await page.click('.rap-current');
  await page.keyboard.press('Home');
  const rows = await page.$$eval('.rap-row', (r) => r.length);
  await page.keyboard.press('Backspace');
  assert.equal(await page.$$eval('.rap-row', (r) => r.length), rows - 1);
  assert.deepEqual(errors, []);
  await context.close();
});
