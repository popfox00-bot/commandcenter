// Settings: pick an app-wide background color. It shows at once on every screen (home, Files, an
// app), the text stays readable, it is still there after a reload (before the app's scripts run), a
// custom color works, and Reset goes back to the phone's light/dark default. Nothing leaves the phone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
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

/** A row of `list` (by its data-id) dragged by its ☰ handle `by` rows (− up, + down), as a finger would. */
async function dragRow(page, list, id, by) {
  const rows = await page.$$eval(`${list} > [data-id]`, (n) => n.map((x) => { const b = x.getBoundingClientRect(); return { id: x.dataset.id, top: b.top }; }));
  const i = rows.findIndex((r) => r.id === id);
  const step = rows.length > 1 ? rows[1].top - rows[0].top : 60;
  const h = await page.locator(`${list} > [data-id="${id}"] .drag-handle`).first().boundingBox();
  const x = h.x + h.width / 2; const y = h.y + h.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, y + by * step * 0.6, { steps: 4 });
  await page.mouse.move(x, y + by * step, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(([l, d, at]) => [...document.querySelectorAll(`${l} > [data-id]`)].findIndex((x) => x.dataset.id === d) === at, [list, id, i + by]);
}
after(async () => { await browser?.close(); server?.close(); });

const colors = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); const cs = getComputedStyle(n); return { bg: getComputedStyle(document.body).backgroundColor, text: cs.color }; }, sel);

test('a background color picked in Settings is used everywhere, readable, and kept', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  const page = await context.newPage();
  const errors = []; const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !/^(blob|data):/.test(r.url())) external.push(r.url()); });
  await page.goto(`${origin}${BASE}`);
  assert.equal((await colors(page, '.app-name')).bg, 'rgb(246, 247, 249)', 'the default light background');

  await page.click('#home-settings');
  await page.waitForSelector('.st h2');
  await page.locator('summary', { hasText: 'Background' }).click();
  await page.click('[aria-label="Background Midnight"]');
  assert.equal(await page.getAttribute('[aria-label="Background Midnight"]', 'aria-pressed'), 'true');
  assert.equal((await colors(page, '.st h2')).bg, 'rgb(11, 16, 32)');
  assert.equal((await colors(page, '.st h2')).text, 'rgb(232, 234, 238)', 'light text on the dark background');
  assert.equal(await page.getAttribute('meta[name="theme-color"]', 'content'), '#0b1020');

  // Every screen, and still there after a reload.
  await page.goto(`${origin}${BASE}#/files/photo`);
  await page.waitForSelector('.studio-sub [role=tab]');
  assert.equal((await colors(page, '.studio-sub')).bg, 'rgb(11, 16, 32)');
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.goto(`${origin}${BASE}`);
  await page.waitForSelector('.app-tile');
  assert.equal((await colors(page, '.app-name')).bg, 'rgb(11, 16, 32)');
  assert.equal((await colors(page, '.app-name')).text, 'rgb(232, 234, 238)');

  // A light custom color: dark text.
  await page.goto(`${origin}${BASE}#/settings`);
  await page.locator('summary', { hasText: 'Background' }).click();
  await page.waitForSelector('.st-color');
  await page.fill('.st-color', '#f4ecdc');
  assert.equal((await colors(page, '.st h2')).bg, 'rgb(244, 236, 220)');
  assert.equal((await colors(page, '.st h2')).text, 'rgb(20, 23, 28)');
  await page.waitForSelector('text=Background: Sand');

  // Reset: back to the default.
  await page.getByRole('button', { name: 'Reset to default', exact: true }).click();
  assert.equal((await colors(page, '.st h2')).bg, 'rgb(246, 247, 249)');
  await page.reload();
  await page.waitForSelector('.st-color', { state: 'attached' });
  assert.equal(await page.evaluate(() => localStorage.getItem('cc.theme.v1')), null);
  assert.equal(await page.getAttribute('[aria-label="Background System"]', 'aria-pressed'), 'true');

  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings → Edit Home Screen: apps dragged into order and hidden with their switches; the home screen follows; reset, show all', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}`);
  const home = () => page.$$eval('.app-name', (els) => els.map((e) => e.textContent));
  await page.waitForSelector('.app-tile');
  assert.deepEqual(await home(), ['Notes', 'Files', 'Draw', 'Units', 'Laundry Timer', 'Rap', 'Inkling', 'Trade Desk', 'Games', 'WorldAtlas']);
  await page.click('#home-settings');
  await page.waitForSelector('.st-home', { state: 'attached' });
  // Folded until tapped.
  assert.equal(await page.locator('.st-home').isVisible(), false, 'the reorder list starts folded');
  await page.locator('summary', { hasText: 'Edit Home Screen' }).click();
  await page.waitForSelector('.st-home');
  // Dragged by their ☰: Draw up one place, Notes down one, then Trade Desk up one with the keyboard.
  await dragRow(page, '.st-home', 'draw', -1);
  await dragRow(page, '.st-home', 'notes', 1);
  await page.getByRole('button', { name: /Reorder Trade Desk/ }).focus();
  await page.keyboard.press('ArrowUp');
  assert.deepEqual(await page.$$eval('.st-home-name', (els) => els.map((e) => e.textContent)), ['Draw', 'Notes', 'Files', 'Units', 'Laundry Timer', 'Rap', 'Inkling', 'Games', 'Trade Desk', 'WorldAtlas']);
  await page.click('#view-app .back');
  await page.waitForSelector('#view-home:not([hidden])');
  assert.deepEqual(await home(), ['Draw', 'Notes', 'Files', 'Units', 'Laundry Timer', 'Rap', 'Inkling', 'Trade Desk', 'Games', 'WorldAtlas']);
  // Each in its category, in that order: Productivity, then Creativity.
  assert.deepEqual(await page.$$eval('.home-cat', (cs) => cs.map((c) => `${c.querySelector('.home-cat-title').textContent}: ${[...c.querySelectorAll('.app-name')].map((n) => n.textContent).join(', ')}`)), ['Productivity: Draw, Notes, Files, Units, Laundry Timer', 'Creativity: Rap, Inkling, Trade Desk', 'Games: Games, WorldAtlas']);
  await page.reload();
  await page.waitForSelector('.app-tile');
  assert.deepEqual(await home(), ['Draw', 'Notes', 'Files', 'Units', 'Laundry Timer', 'Rap', 'Inkling', 'Trade Desk', 'Games', 'WorldAtlas'], 'kept after a reload');
  await page.click('#home-settings');
  await page.locator('summary', { hasText: 'Edit Home Screen' }).click();
  await page.getByRole('button', { name: 'Reset to default order' }).click();
  await page.click('#view-app .back');
  await page.waitForSelector('#view-home:not([hidden])');
  assert.deepEqual(await home(), ['Notes', 'Files', 'Draw', 'Units', 'Laundry Timer', 'Rap', 'Inkling', 'Trade Desk', 'Games', 'WorldAtlas']);
  // Hidden with its switch: off the home screen, still in the list (dimmed) to show again; Show all.
  await page.click('#home-settings');
  await page.locator('summary', { hasText: 'Edit Home Screen' }).click();
  await page.getByRole('switch', { name: 'Show Rap on the home screen' }).click();
  await page.getByRole('switch', { name: 'Show Units on the home screen' }).click();
  assert.equal(await page.getAttribute('[data-id="rap"] .st-home-show', 'aria-checked'), 'false');
  assert.match(await page.textContent('[data-id="rap"]'), /Hidden from the home screen/);
  await page.click('#view-app .back');
  await page.waitForSelector('#view-home:not([hidden])');
  assert.deepEqual(await home(), ['Notes', 'Files', 'Draw', 'Laundry Timer', 'Inkling', 'Trade Desk', 'Games', 'WorldAtlas']);
  await page.reload(); await page.waitForSelector('.app-tile');
  assert.equal((await home()).includes('Rap'), false, 'kept after a reload');
  await page.click('#home-settings');
  await page.locator('summary', { hasText: 'Edit Home Screen' }).click();
  await page.getByRole('switch', { name: 'Show Rap on the home screen' }).click();
  await page.getByRole('button', { name: 'Show all' }).click();
  await page.click('#view-app .back');
  await page.waitForSelector('#view-home:not([hidden])');
  assert.deepEqual(await home(), ['Notes', 'Files', 'Draw', 'Units', 'Laundry Timer', 'Rap', 'Inkling', 'Trade Desk', 'Games', 'WorldAtlas']);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings: every card after App version folded until tapped; their order changed by dragging its ☰ (or ↑ ↓ on it) and kept', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/settings`);
  await page.waitForSelector('.st-sections .st-fold');
  const order = () => page.$$eval('.st-sections > [data-id]', (n) => n.map((x) => x.dataset.id));
  assert.deepEqual(await order(), ['home', 'background', 'saved', 'storage', 'diagnostics', 'suggest', 'jobs']);
  assert.equal(await page.locator('.st > section.card h2').first().textContent(), 'App version', 'App version first');
  assert.ok(await page.getByRole('button', { name: 'Update to Latest Version' }).isVisible(), 'and open');
  assert.equal(await page.locator('details.st-fold[open]').count(), 0, 'the rest folded');
  assert.equal(await page.locator('.st-move-btn').count(), 0, 'no ↑ ↓ buttons');
  // Dragged by its ☰: Storage up two places (the card doesn't open).
  await dragRow(page, '.st-sections', 'storage', -2);
  assert.deepEqual(await order(), ['home', 'storage', 'background', 'saved', 'diagnostics', 'suggest', 'jobs']);
  assert.equal(await page.locator('details.st-fold[open]').count(), 0);
  // On the keyboard: the focused ☰ moves its card with ↑.
  await page.getByRole('button', { name: /Reorder Jobs/ }).focus();
  await page.keyboard.press('ArrowUp');
  assert.deepEqual(await order(), ['home', 'storage', 'background', 'saved', 'diagnostics', 'jobs', 'suggest']);
  await page.reload();
  await page.waitForSelector('.st-sections .st-fold');
  assert.deepEqual(await order(), ['home', 'storage', 'background', 'saved', 'diagnostics', 'jobs', 'suggest'], 'kept after a reload');
  // (An open card stays open when it's moved.)
  await page.locator('summary', { hasText: 'Background' }).click();
  await page.getByRole('button', { name: /Reorder Background/ }).focus();
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => document.querySelector('.st-sections > [data-id]:nth-child(2)')?.dataset.id === 'background');
  assert.equal(await page.locator('details.st-fold[data-id="background"]').getAttribute('open'), '');
  assert.ok(await page.locator('[aria-label="Background Midnight"]').isVisible());
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings → Suggest Improvements: notes kept on the phone (offline too), newest first, deleted; Saved Files not set up says where they are', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/settings`);
  await page.locator('summary', { hasText: 'Suggest Improvements' }).click();
  await page.fill('.st-sug-text', 'Dark mode for Draw');
  await page.getByRole('button', { name: 'Save suggestion' }).click();
  await page.fill('.st-sug-text', 'A timer app');
  await page.getByRole('button', { name: 'Save suggestion' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.st-sug-row').length === 2);
  assert.deepEqual(await page.$$eval('.st-sug-row .st-sug-body > span:first-child', (n) => n.map((x) => x.textContent)), ['A timer app', 'Dark mode for Draw']);
  assert.match(await page.textContent('.st-sug-row'), /on this phone/);
  assert.match(await page.textContent('[data-id="suggest"]'), /Connect Saved Files/);
  await page.reload();
  await page.locator('summary', { hasText: 'Suggest Improvements' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.st-sug-row').length === 2);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Delete suggestion: A timer app/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.st-sug-row').length === 1);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('cc.suggestions'))).length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings → Diagnostics: what loaded, how long it took, and problems noted (kept after a reload, cleared)', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/settings`);
  await page.locator('summary', { hasText: 'Diagnostics' }).click();
  await page.waitForSelector('.st-diag >> text=Nothing yet');
  // Something loaded, a step timed and a problem noted (as the face tools do), shown as they happen.
  await page.evaluate(async () => {
    const d = await import('./lib/diag.js');
    await d.trackLoad('A model', new Promise((r) => setTimeout(r, 20)));
    d.noteTimings('A job', { first: 12, second: 30 });
    d.noteError('Doing a thing', new Error('it broke'));
  });
  await page.waitForSelector('.st-diag >> text=/✅ A model: \\d+ ms/');
  await page.waitForSelector('.st-diag >> text=/A job .*: 42 ms/');
  await page.waitForSelector('.st-diag >> text=/Doing a thing: it broke/');
  // Problems are kept on the phone: still there after a reload.
  await page.reload();
  await page.locator('summary', { hasText: 'Diagnostics' }).click();
  await page.waitForSelector('.st-diag >> text=/Doing a thing: it broke/');
  await page.getByRole('button', { name: 'Clear problems' }).click();
  await page.waitForSelector('.st-diag >> text=None.');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Home: the version small at the top right; tapped, the version history (this version first); only on Home', async () => {
  const { VERSION, HISTORY } = await import('../../web/version.js');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}`);
  const tag = page.locator('#version');
  assert.equal(await tag.textContent(), `v${VERSION}`);
  // At the top right, and small.
  const box = await tag.boundingBox(); const font = await tag.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  // (Just left of the ⚙ Settings, which is at the very right.)
  const gear = await page.locator('#home-settings').boundingBox();
  assert.ok(box.x + box.width > 390 - 100 && box.y < 50, `top right: ${JSON.stringify(box)}`);
  assert.ok(gear.x >= box.x + box.width - 1 && gear.x + gear.width > 390 - 30, `⚙ to its right, at the edge: ${JSON.stringify(gear)}`);
  assert.ok(font <= 13, `small: ${font}px`);
  await tag.click();
  const dialog = page.getByRole('dialog', { name: 'Version history' });
  await dialog.waitFor();
  const items = dialog.locator('.versions-list li');
  assert.equal(await items.count(), HISTORY.length);
  assert.match(await items.first().textContent(), new RegExp(`v${VERSION.replace('.', '\\.')}.*This version`));
  // An Update button in it too.
  assert.ok(await dialog.getByRole('button', { name: 'Update to Latest Version' }).isVisible());
  await dialog.getByRole('button', { name: 'Close' }).click();
  assert.equal(await dialog.isVisible(), false);
  // Not inside an app.
  await page.goto(`${origin}${BASE}#/notes`); await page.waitForSelector('#view-app:not([hidden])');
  assert.equal(await tag.isHidden(), true);
  assert.equal(await page.locator('#home-settings').isHidden(), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings → Storage: what\'s kept on the phone by kind, with its size; what can go is cleared (asked first), your notes can\'t be from here', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}`);
  await page.evaluate(async () => { const { idb } = await import('./lib/idb.js'); await idb.set('fashion.session', { x: new Uint8Array(300000) }); await idb.set('notes.v1', [{ t: 'kept' }]); });
  await page.goto(`${origin}${BASE}#/settings`);
  await page.locator('summary', { hasText: 'Storage' }).click();
  const card = page.locator('details.st-fold[data-id="storage"]');
  const row = (name) => card.locator('.st-storage-row', { hasText: name });
  await row('Work in progress').waitFor();
  assert.match(await row('Work in progress').textContent(), /29\d KB/);
  assert.equal(await row('Notes').getByRole('button').count(), 0, 'notes have no Clear here');
  page.once('dialog', (d) => d.accept());
  await row('Work in progress').getByRole('button', { name: /Clear/ }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.st-storage-name')].some((n) => n.textContent === 'Work in progress'));
  assert.equal(await page.evaluate(async () => (await (await import('./lib/idb.js')).idb.get('fashion.session')) ?? null), null);
  assert.deepEqual(await page.evaluate(async () => (await (await import('./lib/idb.js')).idb.get('notes.v1'))), [{ t: 'kept' }], 'notes untouched');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Home: the Updates card (the next event, today\'s weather, a live game: from what each kept, no requests) opening the Updates page; Recent edits in the apps they belong to (not on Home)', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !/^(blob|data):/.test(r.url())) external.push(r.url()); });
  await page.goto(`${origin}${BASE}`);
  // Nothing kept yet: the card says where to start; no Recent edits.
  await page.waitForSelector('.updates-card');
  assert.match(await page.locator('.updates-card').textContent(), /Calendar\s*Nothing coming up[\s\S]*Weather\s*Open to see your forecast[\s\S]*Sports\s*Open to see your teams/);
  assert.equal(await page.locator('.recent').count(), 0);
  await page.evaluate(async () => {
    const now = Date.now(); const iso = (ms) => new Date(now + ms).toISOString();
    localStorage.setItem('cc.updates.weather', JSON.stringify({ at: now, lat: 1, lon: 1, hourly: [{ start: iso(-1800000), end: iso(1800000), tempF: 47, short: 'Mostly Sunny', precip: 10 }], daily: [{ isDaytime: true, end: iso(6 * 3600000), tempF: 54 }, { isDaytime: false, end: iso(18 * 3600000), tempF: 31 }], alerts: [{ event: 'Wind Advisory' }] }));
    localStorage.setItem('cc.updates.sports', JSON.stringify({ 'nba:den': { at: now, games: [{ id: '1', date: iso(86400000), state: 'pre', home: { abbr: 'DEN' }, away: { abbr: 'UTA' } }, { id: '2', date: iso(-3600000), state: 'in', detail: 'Q4 2:31', home: { abbr: 'DEN', score: '102' }, away: { abbr: 'LAL', score: '98' } }] } }));
    const { idb } = await import('./lib/idb.js');
    const c = new OffscreenCanvas(40, 40); c.getContext('2d').fillRect(0, 0, 40, 40);
    await idb.set('editor.session', { name: 'beach.jpg', blob: await c.convertToBlob({ type: 'image/png' }), state: {}, savedAt: now - 3600000 });
    await idb.set('scan.session', { pages: [], savedAt: now - 60000 });
    await idb.set('collage.session', { images: [{ blob: await c.convertToBlob({ type: 'image/png' }) }], savedAt: now - 120000 });
    const d = new Date(now + 86400000); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await idb.set('calendar.events', [{ id: 'e1', title: 'Dentist', date: k, start: '09:30', end: '10:30', allDay: false }]);
  });
  await page.reload();
  await page.waitForSelector('.updates-card >> text=Dentist');
  const rows = await page.$$eval('.upd-prev', (r) => r.map((x) => x.textContent));
  assert.match(rows[0], /Calendar\s*Dentist\s*Tomorrow · 9:30 AM – 10:30 AM/);
  assert.match(rows[1], /47° Mostly Sunny/); assert.match(rows[1], /H 54°/); assert.match(rows[1], /Wind Advisory/);
  assert.match(rows[2], /LAL 98 @ DEN 102/, 'the live game, not the one tomorrow'); assert.match(rows[2], /Q4 2:31/);
  // The card opens the Updates page (Calendar, Weather, Sports).
  await page.click('.updates-head');
  await page.waitForSelector('.upd-hub-tabs');
  assert.deepEqual(await page.$$eval('.upd-hub-tabs .seg', (t) => t.map((x) => x.textContent)), ['📅 Calendar', '⛅ Weather', '🏆 Sports', '📦 Packages']);
  await page.goto(`${origin}${BASE}#/`); await page.waitForSelector('.updates-card');
  // Not on Home.
  assert.equal(await page.locator('.recent-item').count(), 0, 'no Recent edits on Home');
  // In Files: its own, newest first (Scan a minute ago, Collage, then the Photo Editor an hour ago).
  await page.click('.app-tile >> text=Files');
  await page.waitForSelector('.studio-hub .recent-item');
  assert.deepEqual(await page.locator('.studio-hub .recent-name').allTextContents(), ['📷 Scan', '🧩 Collage', '🖼️ Photo Editor']);
  // In the Photo Editor: its other parts' (the collage in progress), not its own.
  await page.click('.studio-hub .app-tile >> text=Photo Editor');
  await page.waitForSelector('.studio-recent .recent-item');
  assert.deepEqual(await page.locator('.studio-recent .recent-name').allTextContents(), ['🧩 Collage']);
  await page.goto(`${origin}${BASE}#/files`);
  await page.locator('.studio-hub .recent-item', { hasText: 'Photo Editor' }).click();
  await page.waitForFunction(() => location.hash === '#/files/photo');
  await page.waitForSelector('text=Continue editing beach.jpg?');
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Settings: Update to Latest Version at the top: checks now, and says when this is already the latest', async () => {
  const { VERSION } = await import('../../web/version.js');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/settings`);
  const btn = page.getByRole('button', { name: 'Update to Latest Version' });
  await btn.waitFor();
  // The first card in Settings.
  assert.equal(await page.locator('.st > .card').first().locator('button', { hasText: 'Update to Latest Version' }).count(), 1);
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.getRegistration().then((r) => !!r));
  await btn.click();
  await page.waitForSelector(`text=/latest version \\(v${VERSION.replace('.', '\\.')}\\)|Updating|Reloading/`);
  assert.deepEqual(errors, []);
  await context.close();
});
