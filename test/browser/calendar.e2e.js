// Calendar app, in the browser: home → Calendar, week view with today highlighted, add an event and
// a weekly one, month and day views, edit and delete; events stay after a reload and never leave
// the phone. Files → Saved Files against a stand-in for the Apps Script web app: connect, save,
// list, open, delete; and Draw's "Save to Files".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
const NOW = Date.parse('2026-10-30T18:00:00Z'); // Friday Oct 30, noon in Denver
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

async function open(context, hash = '') {
  const page = await context.newPage();
  const errors = []; const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !/^(blob|data):/.test(r.url())) external.push(r.url()); });
  await page.clock.setFixedTime(NOW);
  await page.goto(`${origin}${BASE}${hash}`);
  return { page, errors, external };
}

test('Calendar: week view with today highlighted; add, repeat, month and day views, edit, delete; kept after a reload', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Denver' });
  const { page, errors, external } = await open(context);
  await page.click('.app-tile >> text=Calendar');
  await page.waitForSelector('.cal');
  assert.equal(await page.textContent('#title'), 'Calendar');
  assert.equal(await page.textContent('.cal-views [aria-selected=true]'), 'Week');
  assert.equal(await page.textContent('.cal-title'), 'Oct 25 – 31, 2026');
  assert.match(await page.textContent('.cal-day.cal-today'), /Fri\s*30\s*Today/);

  // A new event: starts today at the next hour.
  await page.getByRole('button', { name: '+ Event' }).click();
  await page.fill('[aria-label=Title]', 'Dentist');
  assert.equal(await page.inputValue('[aria-label=Date]'), '2026-10-30');
  assert.equal(await page.inputValue('[aria-label=Starts]'), '13:00');
  await page.fill('[aria-label=Starts]', '15:30');
  await page.fill('[aria-label=Ends]', '16:15');
  await page.fill('[aria-label=Location]', 'Main St');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => /Dentist/.test(document.querySelector('.cal-day.cal-today')?.textContent ?? ''));
  assert.match(await page.textContent('.cal-day.cal-today'), /3:30 PM – 4:15 PM\s*Dentist/);

  // A weekly all-day event from the "+" on Monday: shows on Mondays.
  await page.getByRole('button', { name: 'Add on Monday, Oct 26' }).click();
  await page.fill('[aria-label=Title]', 'Trash day');
  await page.check('[aria-label="All day"]');
  await page.selectOption('[aria-label=Repeat]', 'weekly');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => /Trash day/.test(document.querySelector('.cal-list')?.textContent ?? ''));
  await page.getByRole('button', { name: 'Next' }).click();
  assert.equal(await page.textContent('.cal-title'), 'Nov 1 – 7, 2026');
  assert.match(await page.textContent('.cal-day:has-text("Mon")'), /All day\s*Trash day/);
  assert.doesNotMatch(await page.textContent('.cal-list'), /Dentist/);

  // Month view: today's cell is highlighted; tapping a day opens it.
  await page.getByRole('tab', { name: 'Month' }).click();
  assert.equal(await page.textContent('.cal-title'), 'November 2026');
  await page.getByRole('button', { name: 'Today' }).click();
  assert.equal(await page.textContent('.cal-title'), 'October 2026');
  assert.match(await page.getAttribute('.cal-cell.cal-today', 'aria-label'), /Friday, October 30, today, 1 item/);
  await page.click('.cal-cell.cal-today');
  assert.equal(await page.textContent('.cal-views [aria-selected=true]'), 'Day');
  assert.match(await page.textContent('.cal-list'), /Dentist[\s\S]*📍 Main St/);

  // Kept after a reload (Day view remembered).
  await page.reload();
  await page.waitForSelector('.cal-item');
  assert.equal(await page.textContent('.cal-views [aria-selected=true]'), 'Day');

  // Edit, then delete.
  await page.click('.cal-item >> text=Dentist');
  await page.fill('[aria-label=Title]', 'Dentist (moved)');
  await page.fill('[aria-label=Date]', '2026-10-31');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => /Saturday/.test(document.querySelector('.cal-title')?.textContent ?? ''));
  assert.match(await page.textContent('.cal-list'), /Dentist \(moved\)/);
  await page.click('.cal-item >> text=Dentist (moved)');
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.waitForFunction(() => !/Dentist/.test(document.querySelector('.cal-list')?.textContent ?? ''));
  const stored = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('command-center'); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('calendar.events'); q.onsuccess = () => res(q.result); }; }));
  assert.deepEqual(stored.map((e) => e.title), ['Trash day']);

  assert.deepEqual(external, [], 'events never leave the phone');
  assert.deepEqual(errors, []);
  await context.close();
});

/** A stand-in for the Saved Files Apps Script web app (same requests and answers). */
async function fakeScript(context, key = 'k3y') {
  const files = []; let n = 0; const calls = [];
  await context.route('https://script.google.com/macros/s/TEST/exec', async (route) => {
    const req = JSON.parse(route.request().postData());
    calls.push({ action: req.action, type: route.request().headers()['content-type'] });
    const send = (body) => route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
    if (req.key !== key) return send({ ok: false, error: 'Wrong access key' });
    if (req.action === 'ping') return send({ ok: true, folder: 'Command Center' });
    if (req.action === 'list') return send({ ok: true, files: files.map(({ data, ...f }) => f).reverse() });
    if (req.action === 'upload') { const f = { id: `f${++n}`, name: req.name, type: req.type, size: Buffer.from(req.data, 'base64').length, updated: NOW + n, data: req.data, from: req.from }; files.push(f); const { data, ...info } = f; return send({ ok: true, file: info }); }
    if (req.action === 'download') { const f = files.find((x) => x.id === req.id); return send(f ? { ok: true, name: f.name, type: f.type, data: f.data } : { ok: false, error: 'No such file' }); }
    if (req.action === 'delete') { files.splice(files.findIndex((x) => x.id === req.id), 1); return send({ ok: true }); }
    return send({ ok: false, error: 'Unknown action' });
  });
  return { files, calls };
}

test('Files → Saved Files: connect in Settings with the URL and key, save, list, open, delete; Draw saves to it', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const script = await fakeScript(context);
  // Not connected yet: Files → Saved Files points to Settings, where the URL and key go.
  const { page, errors } = await open(context, '#/files/saved');
  await page.waitForSelector('text=Connect it once in Settings');
  await page.getByRole('link', { name: 'Open Settings' }).click();
  await page.waitForSelector('#saved-files');
  // A wrong URL and a wrong key are caught.
  await page.fill('[aria-label="Web app URL"]', 'https://example.com/exec');
  await page.fill('[aria-label="Access key"]', 'k3y');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForSelector('text=isn\'t an Apps Script web app URL');
  await page.fill('[aria-label="Web app URL"]', 'https://script.google.com/macros/s/TEST/exec');
  await page.fill('[aria-label="Access key"]', 'wrong');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForSelector('text=Wrong access key');
  await page.fill('[aria-label="Access key"]', 'k3y');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.waitForSelector('text=Connected to "Command Center"');
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('cc.savedFiles'))), { url: 'https://script.google.com/macros/s/TEST/exec', key: 'k3y' });
  await page.goto(`${origin}${BASE}#/files/saved`);
  await page.waitForSelector('text=No files saved yet.');

  // Save two files from the phone.
  await page.setInputFiles('#sv-file', [
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello drive') },
    { name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64') },
  ]);
  await page.waitForSelector('text=Saved 2 files to your Drive.');
  assert.deepEqual(await page.$$eval('.sv-name', (els) => els.map((e) => e.textContent)), ['pixel.png', 'notes.txt']);
  assert.ok(script.calls.every((c) => /^text\/plain/.test(c.type)), 'plain-text requests (no CORS preflight)');

  // Open a text file in the viewer; open the photo in the photo editor.
  await page.locator('.sv-item:has-text("notes.txt")').getByRole('button', { name: 'Open' }).click();
  await page.waitForSelector('.sv-viewer iframe');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.locator('.sv-item:has-text("pixel.png")').getByRole('button', { name: 'Edit' }).click();
  await page.waitForFunction(() => location.hash === '#/files');
  await page.waitForSelector('.ed-canvas');

  // Delete.
  await page.getByRole('tab', { name: 'Saved Files' }).click();
  await page.waitForSelector('.sv-item:has-text("notes.txt")');
  await page.getByRole('button', { name: 'Delete notes.txt' }).click();
  await page.waitForSelector('text=Deleted "notes.txt".');
  assert.deepEqual(script.files.map((f) => f.name), ['pixel.png']);

  // Draw → Save to Files: the drawing goes to Saved Files as a PNG.
  await page.goto(`${origin}${BASE}#/draw`);
  await page.getByRole('button', { name: '+ New drawing' }).click();
  await page.waitForSelector('.dr-canvas');
  await page.fill('.dr-name', 'Plan'); await page.press('.dr-name', 'Enter');
  await page.getByRole('button', { name: '☁️ Save to Files' }).click();
  await page.waitForSelector('text=Saved "Plan.png" to Saved Files.');
  const drawn = script.files.at(-1);
  assert.deepEqual([drawn.name, drawn.type, drawn.from], ['Plan.png', 'image/png', 'Draw']);
  assert.equal(Buffer.from(drawn.data, 'base64').subarray(1, 4).toString(), 'PNG');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Draw → Save to Files before Saved Files is connected: offers to connect it in Settings', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errors } = await open(context, '#/draw');
  await page.getByRole('button', { name: '+ New drawing' }).click();
  await page.waitForSelector('.dr-canvas');
  await page.getByRole('button', { name: '☁️ Save to Files' }).click(); // the confirm is accepted
  await page.waitForFunction(() => location.hash === '#/settings');
  await page.waitForSelector('#saved-files >> text=Not connected.');
  assert.deepEqual(errors, []);
  await context.close();
});
