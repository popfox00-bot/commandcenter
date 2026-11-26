// Calendar app, in the browser: home → Calendar, week view with today highlighted, add an event and
// a weekly one, month and day views, edit and delete; events stay after a reload and never leave
// the phone. Magic → Saved Files against a stand-in for the Apps Script web app: connect, save,
// list, open, delete; and Draw's "Save to Files".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
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
  // (Its apps are in the hidden area: opened here as if it's been unlocked in this tab.)
  const plain = browser.newContext.bind(browser);
  browser.newContext = async (o) => { const c = await plain(o); await c.addInitScript(() => { try { sessionStorage.setItem('cc.hidden.open', '1'); } catch { /* private mode */ } }); return c; };
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
  // From the home screen's Updates card: the Updates page, Calendar first.
  await page.click('.updates-head');
  await page.waitForSelector('.cal');
  assert.equal(await page.textContent('#title'), 'Updates');
  assert.equal(await page.textContent('.upd-hub-tabs [aria-selected=true]'), '📅 Calendar');
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
async function fakeScript(context, key = 'k3y', { version = 4 } = {}) {
  const files = []; const kit = []; const folders = []; let n = 0; const calls = [];
  const pathOf = (id) => { const out = []; for (let d = folders.find((x) => x.id === id); d; d = folders.find((x) => x.id === d.parent)) out.unshift({ id: d.id, name: d.name }); return out; };
  await context.route('https://script.google.com/macros/s/TEST/exec', async (route) => {
    const req = JSON.parse(route.request().postData());
    calls.push({ action: req.action, type: route.request().headers()['content-type'], folder: req.folder, folderId: req.folderId });
    const send = (body) => route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
    if (req.key !== key) return send({ ok: false, error: 'Wrong access key' });
    const here = version >= 3 && req.action === 'list' ? (req.folder || '') : '';
    if (here && !folders.some((d) => d.id === here)) return send({ ok: false, error: 'No such folder' });
    if (req.action === 'ping') return send({ ok: true, folder: 'Command Center', version });
    if (req.action === 'list') {
      const list = files.filter((f) => (f.parent || '') === here).map(({ data, parent, ...f }) => f).reverse();
      return send(version >= 3 ? { ok: true, files: list, folders: folders.filter((d) => d.parent === here).map(({ id, name }) => ({ id, name, updated: NOW })).sort((a, b) => a.name.localeCompare(b.name)), path: pathOf(here) } : { ok: true, files: list });
    }
    if (req.action === 'folders') return send({ ok: true, folders: folders.map((d) => ({ id: d.id, name: d.name, path: pathOf(d.id).map((p) => p.name).join('/') })) });
    if (req.action === 'mkdir') { const d = { id: `d${folders.length + 1}`, name: req.name, parent: req.parent || '' }; folders.push(d); return send({ ok: true, folder: { id: d.id, name: d.name, updated: NOW } }); }
    if (req.action === 'rename') { const d = folders.find((x) => x.id === req.id); d.name = req.name; return send({ ok: true, folder: { id: d.id, name: d.name } }); }
    if (req.action === 'rmdir') { folders.splice(folders.findIndex((x) => x.id === req.id), 1); return send({ ok: true }); }
    if (req.action === 'movedir') {
      if (version < 4) return send({ ok: false, error: 'Unknown action' });
      const d = folders.find((x) => x.id === req.id); d.parent = req.to || ''; return send({ ok: true, folder: { id: d.id, name: d.name, parent: d.parent } });
    }
    if (req.action === 'move') { const f = files.find((x) => x.id === req.id); f.parent = req.to || ''; return send({ ok: true, file: { id: f.id } }); }
    if (req.action === 'upload' && req.folder) {
      kit.push({ folder: req.folder, name: req.name, data: req.data });
      if (!folders.some((d) => d.name === req.folder && !d.parent)) folders.push({ id: `d${folders.length + 1}`, name: req.folder, parent: '' });
      return send({ ok: true, file: { id: `k${kit.length}`, name: req.name, folder: req.folder } });
    }
    if (req.action === 'upload') { const f = { id: `f${++n}`, name: req.name, type: req.type, size: Buffer.from(req.data, 'base64').length, updated: NOW + n, data: req.data, from: req.from, parent: req.folderId || '' }; files.push(f); const { data, parent, ...info } = f; return send({ ok: true, file: info }); }
    if (req.action === 'download') { const f = files.find((x) => x.id === req.id); return send(f ? { ok: true, name: f.name, type: f.type, data: f.data } : { ok: false, error: 'No such file' }); }
    if (req.action === 'delete') { files.splice(files.findIndex((x) => x.id === req.id), 1); return send({ ok: true }); }
    return send({ ok: false, error: 'Unknown action' });
  });
  return { files, kit, folders, calls };
}

test('Magic → Saved Files: connect in Settings with the URL and key, save, list, open, delete; Draw saves to it', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const script = await fakeScript(context);
  // Not connected yet: Magic → Saved Files points to Settings, where the URL and key go.
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
  assert.doesNotMatch(await page.textContent('#saved-files'), /null|undefined/);
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
  await page.waitForFunction(() => location.hash === '#/files/photo');
  await page.waitForSelector('.ed-canvas');

  // Delete (back in Magic → Saved Files).
  await page.goto(`${origin}${BASE}#/saved`);
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

test('Saved Files folders: make one, save into it, move a file in, rename, delete; an old script says to update', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const script = await fakeScript(context);
  script.files.push({ id: 'top1', name: 'receipt.pdf', type: 'application/pdf', size: 4, updated: NOW - 1000, data: Buffer.from('%PDF').toString('base64'), from: 'Files', parent: '' });
  await context.addInitScript(() => localStorage.setItem('cc.savedFiles', JSON.stringify({ url: 'https://script.google.com/macros/s/TEST/exec', key: 'k3y' })));
  const { page, errors } = await open(context, '#/files/saved');
  await page.waitForSelector('.sv-item:has-text("receipt.pdf")');
  assert.doesNotMatch(await page.textContent('.sv'), /null|undefined/, 'no stray "null" where a part is left out');
  let answer = 'Taxes';
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(answer) : d.accept()));

  await page.getByRole('button', { name: '+ New folder' }).click();
  await page.waitForSelector('text=Folder "Taxes" is ready.');
  assert.deepEqual(script.folders.map((d) => d.name), ['Taxes']);
  // Move the receipt into it.
  await page.getByRole('button', { name: 'Move receipt.pdf' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: '📁 Taxes' }).click();
  await page.waitForSelector('text=Moved "receipt.pdf" to "Taxes".');
  assert.equal(script.files[0].parent, 'd1');
  assert.equal(await page.isVisible('.sv-item:has-text("receipt.pdf")'), false);
  // Open it, save a file there, then a folder inside it.
  await page.getByRole('button', { name: 'Open folder Taxes' }).click();
  await page.waitForSelector('[aria-current="page"]:has-text("Taxes")');
  await page.waitForSelector('.sv-item:has-text("receipt.pdf")');
  await page.setInputFiles('#sv-file', { name: 'w2.txt', mimeType: 'text/plain', buffer: Buffer.from('wages') });
  await page.waitForSelector('text=Saved 1 file to "Taxes".');
  assert.equal(script.files.at(-1).parent, 'd1');
  answer = '2026';
  await page.getByRole('button', { name: '+ New folder' }).click();
  await page.waitForSelector('text=Folder "2026" is ready.');
  assert.equal(script.folders[1].parent, 'd1');
  await page.getByRole('button', { name: 'Open folder 2026' }).click();
  await page.waitForSelector('text=This folder is empty.');
  assert.match(await page.textContent('.sv-crumbs'), /Saved Files›Taxes›📁 2026/);
  // Back up by the path, rename, delete.
  await page.locator('.sv-crumbs').getByRole('button', { name: 'Taxes' }).click();
  await page.waitForSelector('.sv-item:has-text("w2.txt")');
  // Colour-coded icons: a text file's tile, a folder's.
  assert.match(await page.getAttribute('.sv-item:has-text("w2.txt") .sv-icon', 'class'), /sv-k-text/);
  assert.equal(await page.textContent('.sv-item:has-text("w2.txt") .sv-ext'), 'TXT');
  assert.match(await page.getAttribute('.sv-folder .sv-icon', 'class'), /sv-k-folder/);
  assert.notEqual(await page.$eval('.sv-item:has-text("w2.txt") .sv-icon', (e) => getComputedStyle(e).backgroundColor), await page.$eval('.sv-folder .sv-icon', (e) => getComputedStyle(e).backgroundColor));
  // Move a folder: not into itself; out to the main folder and back in.
  await page.getByRole('button', { name: 'Move folder 2026' }).click();
  await page.waitForSelector('dialog[open] .sv-dest');
  assert.deepEqual(await page.$$eval('dialog[open] .sv-dest', (els) => els.map((e) => e.textContent)), ['☁️ Saved Files (main folder)'], 'not into itself or where it already is');
  await page.locator('dialog[open]').getByRole('button', { name: '☁️ Saved Files (main folder)' }).click();
  await page.waitForSelector('text=Moved the folder "2026" to the main folder.');
  assert.equal(script.folders[1].parent, '');
  await page.getByRole('button', { name: '☁️ Saved Files' }).click();
  await page.getByRole('button', { name: 'Move folder Taxes' }).click();
  await page.waitForSelector('dialog[open] .sv-dest');
  assert.deepEqual(await page.$$eval('dialog[open] .sv-dest', (els) => els.map((e) => e.textContent)), ['📁 2026']);
  await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Move folder 2026' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: '📁 Taxes' }).click();
  await page.waitForSelector('text=Moved the folder "2026" to "Taxes".');
  assert.equal(script.folders[1].parent, 'd1');
  await page.getByRole('button', { name: 'Open folder Taxes' }).click();
  await page.waitForSelector('.sv-item:has-text("w2.txt")');
  answer = 'Tax 2026';
  await page.getByRole('button', { name: 'Rename folder 2026' }).click();
  await page.waitForSelector('text=Renamed to "Tax 2026".');
  await page.getByRole('button', { name: 'Delete folder Tax 2026' }).click();
  await page.waitForSelector('text=Deleted the folder "Tax 2026".');
  assert.deepEqual(script.folders.map((d) => d.name), ['Taxes']);
  await page.getByRole('button', { name: '☁️ Saved Files' }).click();
  await page.waitForSelector('.sv-item:has-text("Taxes")');
  assert.equal(await page.isVisible('.sv-crumbs'), false, 'no path in the main folder');
  assert.deepEqual(errors, []);
  await context.close();

  // A script from before folders: no folder buttons, a note to update it.
  const old = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await fakeScript(old, 'k3y', { version: 2 });
  await old.addInitScript(() => localStorage.setItem('cc.savedFiles', JSON.stringify({ url: 'https://script.google.com/macros/s/TEST/exec', key: 'k3y' })));
  const o = await open(old, '#/files/saved');
  await o.page.waitForSelector('text=update the Saved Files script to version 3');
  assert.equal(await o.page.isVisible('text=+ New folder'), false);
  assert.deepEqual(o.errors, []);
  await old.close();

  // Version 3: folders, but moving one says to update.
  const v3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const s3 = await fakeScript(v3, 'k3y', { version: 3 });
  s3.folders.push({ id: 'd1', name: 'A', parent: '' }, { id: 'd2', name: 'B', parent: '' });
  await v3.addInitScript(() => localStorage.setItem('cc.savedFiles', JSON.stringify({ url: 'https://script.google.com/macros/s/TEST/exec', key: 'k3y' })));
  const p3 = await open(v3, '#/files/saved');
  await p3.page.getByRole('button', { name: 'Move folder A' }).click();
  await p3.page.locator('dialog[open]').getByRole('button', { name: '📁 B' }).click();
  await p3.page.waitForSelector('text=Moving folders needs the newer Saved Files script (version 4)');
  assert.deepEqual(p3.errors, []);
  await v3.close();
});

test('Draw → Save to Files before Saved Files is connected: offers to connect it in Settings', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errors } = await open(context, '#/draw');
  await page.getByRole('button', { name: '+ New drawing' }).click();
  await page.waitForSelector('.dr-canvas');
  await page.getByRole('button', { name: '☁️ Save to Files' }).click(); // the confirm is accepted
  await page.waitForFunction(() => location.hash === '#/settings/saved');
  await page.waitForSelector('#saved-files >> text=Not connected.');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Saved Files encryption: turn it on (recovery key shown once), files encrypted on the phone, unlocked once a session, old files encrypted, a file opened anywhere', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const script = await fakeScript(context);
  // An older file, saved before encryption.
  script.files.push({ id: 'old1', name: 'old.txt', type: 'text/plain', size: 9, updated: NOW - 1000, data: Buffer.from('old plain').toString('base64'), from: 'Files' });
  await context.addInitScript(() => localStorage.setItem('cc.savedFiles', JSON.stringify({ url: 'https://script.google.com/macros/s/TEST/exec', key: 'k3y' })));
  const { page, errors } = await open(context, '#/settings/saved');
  await page.waitForSelector('text=🔒 Turn on encryption');
  await page.fill('[aria-label="Choose a password"]', 'short');
  await page.fill('[aria-label="The same again"]', 'short');
  await page.getByRole('button', { name: '🔒 Turn on encryption' }).click();
  await page.waitForSelector('text=Choose a longer password');
  await page.fill('[aria-label="Choose a password"]', 'maple river candle orbit');
  await page.fill('[aria-label="The same again"]', 'maple river candle orbit');
  await page.getByRole('button', { name: '🔒 Turn on encryption' }).click();
  await page.waitForSelector('.vault-key', { timeout: 20000 });
  const recovery = await page.textContent('.vault-key');
  assert.match(recovery, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
  assert.equal(await page.isDisabled('dialog[open] >> text=Done'), true, 'Done only once you\'ve kept it');
  await page.check('#vault-saved');
  await page.click('dialog[open] >> text=Done');
  await page.waitForSelector('text=Encryption is on, and unlocked');
  await page.waitForSelector('text=The decryption kit (to open files without this app) is in the "Decryption" folder.');
  assert.deepEqual(script.kit.map((k) => `${k.folder}/${k.name}`), ['Decryption/decrypt.html', 'Decryption/decrypt.py', 'Decryption/FORMAT.md']);
  assert.match(Buffer.from(script.kit[0].data, 'base64').toString(), /Open encrypted Saved Files/, 'the real page, as plain files (they hold no keys)');
  const vault = script.files.find((f) => f.name === 'command-center-vault.json');
  assert.ok(vault && !Buffer.from(vault.data, 'base64').toString().includes('maple'), 'the vault file holds no password');

  // Magic → Saved Files: a new file is encrypted before it leaves the phone.
  await page.goto(`${origin}${BASE}#/files/saved`);
  await page.waitForSelector('.sv-item');
  await page.setInputFiles('#sv-file', { name: 'bank notes.txt', mimeType: 'text/plain', buffer: Buffer.from('account 12345') });
  await page.waitForSelector('text=Saved 1 file to your Drive.');
  const stored = script.files.at(-1);
  assert.match(stored.name, /^ccv\./); assert.equal(stored.type, 'application/octet-stream');
  assert.ok(!stored.name.includes('bank') && !Buffer.from(stored.data, 'base64').toString('latin1').includes('12345'), 'Drive sees neither the name nor the content');
  assert.match(await page.textContent('ul.sv-list:last-of-type'), /bank notes\.txt[\s\S]*🔒 encrypted/);
  assert.equal(await page.isVisible('.sv-list >> text=command-center-vault.json'), false, 'the vault file isn\'t listed');
  assert.equal(await page.locator('details.about >> text=Folder names are kept as they are in Drive').count(), 1, 'says (under ⓘ About) folder names aren\'t encrypted');
  // The kit's folder: its files are plain on purpose (no Encrypt button there).
  await page.getByRole('button', { name: 'Open folder Decryption' }).click();
  await page.waitForSelector('[aria-current="page"]:has-text("Decryption")');
  await page.getByRole('button', { name: '☁️ Saved Files' }).click();
  await page.waitForSelector('.sv-item:has-text("bank notes.txt")');

  // The older plain file: encrypt it.
  assert.match(await page.textContent('.sv-item:has-text("old.txt")'), /not encrypted/);
  await page.getByRole('button', { name: 'Encrypt old.txt' }).click();
  await page.waitForSelector('text=Encrypted 1 file');
  assert.ok(!script.files.some((f) => f.name === 'old.txt'), 'the plain copy is gone (to Drive\'s trash)');

  // Reloaded: locked. A wrong password doesn't open it; the recovery key does.
  await page.reload();
  await page.waitForSelector('text=🔒 Locked');
  assert.match(await page.textContent('ul.sv-list:last-of-type'), /🔒 Locked file/);
  await page.fill('[aria-label="Saved Files password"]', 'maple river candle orbiT');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.waitForSelector('text=Wrong password or recovery key.');
  await page.fill('[aria-label="Saved Files password"]', recovery.toLowerCase());
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.waitForSelector('text=bank notes.txt');
  assert.match(await page.textContent('ul.sv-list:last-of-type'), /old\.txt/);

  // Open anywhere: the downloaded encrypted file, with the password, in Settings.
  await page.goto(`${origin}${BASE}#/settings/saved`);
  await page.click('summary >> text=Open an encrypted file');
  await page.setInputFiles('[aria-label="Encrypted file"]', { name: stored.name, mimeType: 'application/octet-stream', buffer: Buffer.from(stored.data, 'base64') });
  await page.fill('[aria-label="Password or recovery key for the file"]', 'maple river candle orbit');
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.waitForSelector('text=Opened "bank notes.txt"', { timeout: 20000 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('Saved Files ★ Favorites: starred files as two columns of cards (title, description), reordered by dragging, kept on the phone', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const script = await fakeScript(context);
  const fx = async (n) => (await readFile(join(import.meta.dirname, '../fixtures', n))).toString('base64');
  for (const [i, n] of ['counter_pill.png', 'icon_tags.png', 'icon_mute.png', 'feed_dark_gray_media_723.png'].entries()) script.files.push({ id: `p${i}`, name: n, type: 'image/png', size: 10, updated: NOW - i * 1000, data: await fx(n), from: 'Files', parent: '' });
  await context.addInitScript(() => localStorage.setItem('cc.savedFiles', JSON.stringify({ url: 'https://script.google.com/macros/s/TEST/exec', key: 'k3y' })));
  const { page, errors } = await open(context, '#/files/saved');
  await page.waitForSelector('.sv-item:has-text("icon_tags.png")');
  for (const n of ['counter_pill.png', 'icon_tags.png', 'icon_mute.png']) { await page.getByRole('button', { name: `Favorite ${n}` }).click(); await page.getByRole('button', { name: `Unfavorite ${n}` }).waitFor(); }
  await page.getByRole('button', { name: /★ Favorites \(3\)/ }).click();
  const cards = page.locator('.fv-card'); await cards.nth(2).waitFor();
  const titles = () => page.locator('.fv-title').allTextContents();
  assert.deepEqual(await titles(), ['icon mute', 'icon tags', 'counter pill'], 'the newest starred first; names as titles');
  // Two columns.
  const [a, b, c] = await Promise.all([0, 1, 2].map((i) => cards.nth(i).boundingBox()));
  assert.ok(Math.abs(a.y - b.y) < 2 && b.x > a.x && c.y > a.y + 50, 'two columns, filled from the top');
  assert.ok(a.height < 300 && a.width < 200, 'small enough for 4–6 on a screen');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // A title and description of its own.
  await page.getByRole('button', { name: 'counter pill: details' }).click();
  await page.getByLabel('Title').fill('The pill'); await page.getByLabel('Description').fill('My favorite button');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.fv-desc', { hasText: 'My favorite button' }).waitFor();
  // Dragged to the front.
  const h = cards.nth(2).locator('.fv-handle'); const hb = await h.boundingBox(); const tb = await cards.nth(0).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
  await page.mouse.move(tb.x + 30, tb.y + 60, { steps: 8 }); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.fv-title')?.textContent === 'The pill');
  assert.deepEqual((await titles())[0], 'The pill');
  // Kept: after a reload, offline too (the cards come from the phone).
  await page.reload(); await page.waitForSelector('.sv-item'); await context.setOffline(true);
  await page.getByRole('button', { name: /★ Favorites \(3\)/ }).click(); await page.locator('.fv-card').nth(2).waitFor();
  assert.deepEqual(await titles(), ['The pill', 'icon mute', 'icon tags']);
  assert.equal(await page.locator('.fv-card img.fv-pic').count(), 3, 'their pictures kept');
  await context.setOffline(false);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Saved Files 🔎 Scan for characters: pick files, scanned on the phone, suggestions only; Character matches kept and removable', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const script = await fakeScript(context);
  const fx = async (n) => (await readFile(join(import.meta.dirname, '../fixtures', n))).toString('base64');
  script.files.push({ id: 'p1', name: 'icon_tags.png', type: 'image/png', size: 10, updated: NOW, data: await fx('icon_tags.png'), from: 'Files', parent: '' });
  script.files.push({ id: 't1', name: 'notes.txt', type: 'text/plain', size: 4, updated: NOW - 1, data: Buffer.from('hi').toString('base64'), from: 'Files', parent: '' });
  await context.addInitScript(() => localStorage.setItem('cc.savedFiles', JSON.stringify({ url: 'https://script.google.com/macros/s/TEST/exec', key: 'k3y' })));
  const { page, errors, external } = await open(context, '#/files/saved');
  await page.waitForSelector('.sv-item:has-text("icon_tags.png")');
  await page.getByRole('button', { name: '🔎 Scan for characters' }).click();
  const dlg = page.getByRole('dialog', { name: 'Scan for characters' });
  assert.deepEqual((await dlg.locator('.sc-pick li').allTextContents()).map((t) => t.trim()), ['🖼️ icon_tags.png'], 'only photos and videos');
  await dlg.getByRole('button', { name: /^Scan 1 file/ }).click();
  await dlg.getByText('None of your Socials accounts has a profile photo with a face yet').waitFor({ timeout: 20000 });
  await dlg.getByRole('button', { name: 'Close' }).click();
  // Character matches: a kept one shows, by account, and can be removed.
  await page.evaluate(async () => { const { keepMatch } = await import('./tools/saved/scanner.js'); await keepMatch({ fileId: 'p1', name: 'icon_tags.png', accountId: 'a1', handle: 'amy', sure: 91 }); });
  await page.getByRole('button', { name: '⚙ Character matches' }).click();
  const m = page.getByRole('dialog', { name: 'Character matches' });
  await m.getByText('@amy · 1').waitFor(); assert.match(await m.textContent(), /icon_tags\.png.*91%/);
  await m.getByRole('button', { name: 'Remove icon_tags.png as @amy' }).click();
  await m.getByText('No matches kept yet.').waitFor();
  assert.deepEqual(external.filter((u) => !u.startsWith('https://script.google.com/')), [], 'nothing but your own Saved Files');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Scan review: the file\'s picture and the face beside the account\'s photo; "It\'s them" puts a draft on that account in Socials (encrypted, waiting for your OK) and marks the file 👤, filterable by person', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const script = await fakeScript(context);
  const fx = async (n) => (await readFile(join(import.meta.dirname, '../fixtures', n))).toString('base64');
  script.files.push({ id: 'p1', name: 'icon_tags.png', type: 'image/png', size: 10, updated: NOW, data: await fx('icon_tags.png'), from: 'Files', parent: '' });
  script.files.push({ id: 'p2', name: 'icon_mute.png', type: 'image/png', size: 10, updated: NOW - 1, data: await fx('icon_mute.png'), from: 'Files', parent: '' });
  await context.addInitScript(() => localStorage.setItem('cc.savedFiles', JSON.stringify({ url: 'https://script.google.com/macros/s/TEST/exec', key: 'k3y' })));
  const { page, errors, external } = await open(context, 'index.html');
  // Socials, with its password and two accounts.
  await page.locator('.app-name', { hasText: 'Socials' }).click();
  await page.locator('.sp-feed').waitFor();
  await page.getByRole('button', { name: 'Settings' }).click(); await page.getByRole('button', { name: 'Admin' }).click();
  const pw = ['her', 'on42'].join('');
  await page.getByLabel('Password', { exact: true }).fill(pw); await page.getByLabel('Password again').fill(pw);
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('maya'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Welcome to your feed').waitFor();
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click();
  await page.getByLabel('Username', { exact: true }).fill('jordan'); await page.getByRole('button', { name: 'Create account' }).click();
  const saved = page.getByRole('button', { name: 'I\'ve saved it' }); await saved.or(page.getByText('Welcome to your feed')).first().waitFor(); if (await saved.count()) await saved.click();
  await page.getByText('Welcome to your feed').waitFor();
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: /^Use @maya/ }).click();
  await page.locator('.so-switch', { hasText: 'maya' }).waitFor();
  // Saved Files: a scan's review (its results as the scanner makes them: the faces themselves can't be faked here).
  await page.goto(`${origin}${BASE}#/files/saved`); await page.waitForSelector('.sv-item:has-text("icon_tags.png")');
  await page.evaluate(async () => {
    const { openScanner, knownAccounts } = await import('./tools/saved/scanner.js');
    const { accounts } = await knownAccounts(); const jordan = accounts.find((a) => a.handle === 'jordan'); const maya = accounts.find((a) => a.handle === 'maya');
    const pic = await (await fetch('./icons/icon-192.png')).blob();
    const f = { id: 'p1', name: 'icon_tags.png', type: 'image/png' };
    const files = (await import('./lib/saved-files.js')); const api = files.secureFiles(files.savedFiles(files.getConfig()));
    openScanner([f], { download: (id) => api.download(id), results: [{ f, faces: 1, pics: [pic], hits: [{ id: jordan.id, handle: 'jordan', avatar: null, distance: 0.3, sure: 89, crop: pic }, { id: maya.id, handle: 'maya', avatar: null, distance: 0.35, sure: 80, crop: pic }], error: '' }] });
  });
  const dlg = page.getByRole('dialog', { name: 'Scan for characters' });
  await dlg.locator('.sc-preview img').waitFor();
  assert.equal(await dlg.getByRole('img', { name: 'The face in icon_tags.png' }).count(), 2, 'each face, to compare');
  assert.match(await dlg.locator('.sc-hit').first().textContent(), /@jordan\s*89% likely/);
  await dlg.getByRole('button', { name: 'It\'s @jordan in icon_tags.png' }).click();
  await dlg.getByText('✓ Matched · a draft on @jordan, waiting for your OK in Socials').waitFor({ timeout: 20000 });
  // (Two people in it: the second added to the same draft as a collaborator.)
  await dlg.getByRole('button', { name: 'It\'s @maya in icon_tags.png' }).click();
  await dlg.getByText('✓ Matched · added as a collaborator on @jordan\'s draft (it\'s one post with them both)').waitFor({ timeout: 20000 });
  await dlg.getByRole('button', { name: 'Done' }).click();
  // Marked in Files, and a filter by person.
  await page.reload(); await page.waitForSelector('.sv-item:has-text("icon_mute.png")');
  assert.equal(await page.locator('.sv-item:has-text("icon_tags.png") .sv-match').textContent(), '👤 @jordan, @maya', 'both matched');
  assert.equal(await page.locator('.sv-item:has-text("icon_tags.png") .sv-thumb img').count(), 0, 'no picture kept for it until a real scan');
  await page.getByRole('button', { name: '👤 @jordan' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.sv-item:not(.sv-folder)').length === 1);
  assert.match(await page.locator('.sv-item:not(.sv-folder)').textContent(), /icon_tags\.png/);
  await page.getByRole('button', { name: '👤 @maya' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.sv-item:not(.sv-folder)').length === 1);
  assert.match(await page.locator('.sv-item:not(.sv-folder)').textContent(), /icon_tags\.png/, 'under each person');
  await page.getByRole('button', { name: 'Everyone' }).click();
  await page.waitForSelector('.sv-item:has-text("icon_mute.png")');
  // In Socials: the draft from Saved Files, waiting; opened on @jordan, ready to share. Kept encrypted.
  const raw = await page.evaluate(async () => (await import('./lib/idb.js')).idb.get('cc.socials'));
  assert.ok(raw?.enc === 1 && !JSON.stringify(raw).includes('icon_tags'), 'Socials\' data stays encrypted');
  await page.goto(`${origin}${BASE}index.html`);
  await page.locator('.app-name', { hasText: 'Socials' }).click(); await page.locator('.sp-feed').waitFor();
  await page.getByRole('button', { name: 'Settings' }).click(); await page.getByRole('button', { name: 'Admin' }).click();
  const pass = page.getByLabel('Password', { exact: true }); if (await pass.count()) { await pass.fill(pw); await page.getByRole('button', { name: /Unlock|Open/ }).first().click(); }
  await page.getByRole('button', { name: /📥 1 draft from Saved Files waiting for your OK/ }).click();
  assert.match(await page.locator('.so-fs-item').textContent(), /@jordan.*icon_tags\.png/);
  await page.getByRole('button', { name: 'Open the draft on @jordan: icon_tags.png' }).click();
  assert.match(await page.locator('.so-switch').textContent(), /jordan/, 'switched to that account');
  assert.match(await page.locator('.so-main').textContent(), /Collab · 1/, 'maya a collaborator on it');
  await page.getByRole('button', { name: 'Share' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.so-main button.btn.primary')?.disabled);
  await page.getByRole('button', { name: 'Share' }).click();
  // (This test's stand-in Drive has no Socials folder, so each sync shows a new recovery key: put aside.)
  for (let i = 0; i < 6 && !(await page.locator('.so-post').count()); i++) { const k = page.getByRole('button', { name: 'I\'ve saved it' }); await k.or(page.locator('.so-post').first()).first().waitFor(); if (await k.count()) await k.click(); await page.waitForTimeout(300); }
  await page.locator('.so-post').first().waitFor();
  await page.getByRole('button', { name: 'Home' }).first().click().catch(() => {});
  assert.equal(await page.getByRole('button', { name: /draft.* from Saved Files/ }).count(), 0, 'nothing left waiting once shared');
  assert.deepEqual(external.filter((u) => !u.startsWith('https://script.google.com/') && !u.startsWith('https://site.api.espn.com/')), [], 'nothing but your own Saved Files (and the Sports front\'s scores)');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings → Saved Files: the extras kept only on this phone backed up (encrypted, to Saved Files → Backups) and restored with the backup password', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const script = await fakeScript(context);
  await context.addInitScript(() => localStorage.setItem('cc.savedFiles', JSON.stringify({ url: 'https://script.google.com/macros/s/TEST/exec', key: 'k3y' })));
  const { page, errors, external } = await open(context, '#/settings/saved');
  await page.evaluate(async () => {
    const { idb } = await import('./lib/idb.js');
    await idb.set('cc.saved.matches', [{ fileId: 'p1', name: 'beach.jpg', accountId: 'a1', handle: 'amy', sure: 90, at: 1 }]);
    await idb.set('cc.bg.vault', { buf: new Uint8Array([1, 2, 3, 250]).buffer, type: 'image/jpeg', at: 1 });
    await idb.set('cc.notes.other', 'not part of it');
    localStorage.setItem('cc.dock.mode', JSON.stringify({ socials: 'tucked' }));
  });
  await page.getByText('Back up the extras kept on this phone').click();
  const pw = ['tide', 'pool', '77'].join('-');
  await page.getByLabel('Backup password').fill(pw);
  await page.getByRole('button', { name: 'Back up to Saved Files' }).click();
  await page.getByText(/Backed up 3 things to Saved Files → Backups → cc-extras-\d{4}-\d\d-\d\d\.ccx \(encrypted\)/).waitFor({ timeout: 20000 });
  const up = script.kit.find((k) => k.folder === 'Backups');
  const text = Buffer.from(up.data, 'base64').toString();
  assert.ok(!/amy|beach|tucked/.test(text), 'encrypted: none of it readable in Drive');
  // Gone from the phone, then restored from the file: not with a wrong password; with the right one, all of it.
  await page.evaluate(async () => { const { idb } = await import('./lib/idb.js'); await idb.del('cc.saved.matches'); await idb.del('cc.bg.vault'); localStorage.removeItem('cc.dock.mode'); });
  const file = { name: up.name, mimeType: 'application/octet-stream', buffer: Buffer.from(up.data, 'base64') };
  await page.getByLabel('Backup password').fill('wrong-one');
  await page.setInputFiles('[aria-label="Backup file to restore"]', file);
  await page.getByText('That password doesn\'t open this backup.').waitFor();
  await page.getByLabel('Backup password').fill(pw);
  await page.setInputFiles('[aria-label="Backup file to restore"]', file);
  await page.getByText('Restored 3 things.').waitFor();
  const got = await page.evaluate(async () => { const { idb } = await import('./lib/idb.js'); return { m: await idb.get('cc.saved.matches'), bg: [...new Uint8Array((await idb.get('cc.bg.vault')).buf)], dock: localStorage.getItem('cc.dock.mode') }; });
  assert.equal(got.m[0].handle, 'amy'); assert.deepEqual(got.bg, [1, 2, 3, 250]); assert.equal(got.dock, '{"socials":"tucked"}');
  assert.deepEqual(external.filter((u) => !u.startsWith('https://script.google.com/')), []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Unknown people: faces that are none of your accounts, grouped by person across scans; made a Socials account (the face its profile photo, its files matched, known to later scans); or set aside', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const script = await fakeScript(context);
  const fx = async (n) => (await readFile(join(import.meta.dirname, '../fixtures', n))).toString('base64');
  for (const [id, n] of [['p1', 'icon_tags.png'], ['p2', 'icon_mute.png'], ['p3', 'counter_pill.png']]) script.files.push({ id, name: n, type: 'image/png', size: 10, updated: NOW, data: await fx(n), from: 'Files', parent: '' });
  await context.addInitScript(() => localStorage.setItem('cc.savedFiles', JSON.stringify({ url: 'https://script.google.com/macros/s/TEST/exec', key: 'k3y' })));
  const { page, errors } = await open(context, '#/files/saved');
  await page.waitForSelector('.sv-item:has-text("counter_pill.png")');
  // (Two scans' unknown faces, as the scanner leaves them: one person in two files, another in one.)
  await page.evaluate(async () => {
    const { addStrangers } = await import('./tools/saved/scanner.js');
    const vec = (k, e = 0) => Array.from({ length: 128 }, (_, i) => Math.sin(i * k) * 0.1 + (i % 2 ? e : -e));
    const crop = await (await fetch('./icons/icon-192.png')).blob();
    await addStrangers([{ f: { id: 'p1', name: 'icon_tags.png' }, unknown: [{ d: vec(5), size: 0.3, crop }, { d: vec(9), size: 0.2, crop }] }]);
    await addStrangers([{ f: { id: 'p2', name: 'icon_mute.png' }, unknown: [{ d: vec(5, 0.01), size: 0.4, crop }] }]);
  });
  await page.getByRole('button', { name: '⚙ Character matches' }).click();
  const dlg = page.getByRole('dialog', { name: 'Character matches' });
  await dlg.getByRole('tab', { name: '👥 Unknown people · 2' }).click();
  const first = dlg.locator('.sc-stranger').first();
  assert.match(await first.textContent(), /In 2 files.*icon_tags\.png, icon_mute\.png|In 2 files.*icon_mute\.png, icon_tags\.png/, 'the same person, both files');
  // Set aside, and back.
  await dlg.locator('.sc-stranger').nth(1).getByRole('button', { name: 'Not someone: set aside the person in 1 file' }).click();
  await dlg.getByRole('tab', { name: '👥 Unknown people · 1' }).waitFor();
  await dlg.getByRole('button', { name: 'Show the 1 set aside' }).click();
  await dlg.getByRole('button', { name: 'Bring back' }).click();
  await dlg.getByRole('tab', { name: '👥 Unknown people · 2' }).waitFor();
  // Made a Socials account.
  await first.getByRole('button', { name: /Make a Socials account/ }).click();
  await first.getByLabel('Username').fill('Lee.Park'); await first.getByLabel('Name', { exact: true }).fill('Lee');
  await first.getByRole('button', { name: 'Make the account' }).click();
  await dlg.getByText('@lee.park is a Socials account now, with this face as its profile photo; 2 files matched to it.').waitFor();
  await dlg.getByRole('tab', { name: '👥 Unknown people · 1' }).waitFor();
  const acc = await page.evaluate(async () => { const { loadState } = await import('./apps/socials/socials-store.js'); const { state } = await loadState(); const a = state.accounts.find((x) => x.handle === 'lee.park'); return { avatar: !!a?.avatar, face: a?.face?.length, learned: a?.learned?.length ?? 0, name: a?.name }; });
  assert.deepEqual(acc, { avatar: true, face: 128, learned: 1, name: 'Lee' }, 'its profile photo and faces');
  await dlg.getByRole('tab', { name: 'Matches' }).click();
  await dlg.getByText('@lee.park · 2').waitFor();
  await dlg.getByRole('button', { name: 'Close' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.sv-match').length === 2);
  assert.equal(await page.locator('.sv-item:has-text("icon_mute.png") .sv-match').textContent(), '👤 @lee.park');
  // Later scans know it: a face like theirs now matches the account.
  const hit = await page.evaluate(async () => {
    const { knownAccounts } = await import('./tools/saved/scanner.js'); const { matchFaces } = await import('./apps/socials/socials-faces.js');
    const vec = (k, e = 0) => Array.from({ length: 128 }, (_, i) => Math.sin(i * k) * 0.1 + (i % 2 ? e : -e));
    const k = await knownAccounts(); return matchFaces([{ d: vec(5, 0.02) }], k.known, 0.5, { not: k.not }).map((h) => k.accounts.find((a) => a.id === h.id)?.handle);
  });
  assert.deepEqual(hit, ['lee.park']);
  assert.deepEqual(errors, []);
  await context.close();
});
