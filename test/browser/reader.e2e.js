// Browser tests for Reader (in the Vault): set up (password, recovery key once), add files (encrypted on the phone,
// nothing readable kept), the figures (files, size, folders), folders (new, move, open), look at a file, 📤 export a
// locked package (downloaded), lock and open again by itself (the Vault open), 📥 import the package back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE_PATH = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
let server; let browser; let origin;
before(async () => {
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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDEgARQhAgB+dQX/7YG3VwAAAABJRU5ErkJggg==', 'base64');

test('Reader: set up, add files (encrypted), figures, folders, view, export a locked package, open by itself, import it back', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.addInitScript(() => { try { sessionStorage.setItem('cc.hidden.open', '1'); } catch { /* private mode */ } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE_PATH}#/hidden`);
  await page.getByRole('link', { name: /Reader/ }).click();
  // Set up: a password, then its recovery key once.
  await page.getByLabel('Reader password', { exact: true }).fill('maple river candle orbit');
  await page.getByLabel('Reader password again').fill('maple river candle orbit');
  await page.getByText(/Strong/).waitFor();
  await page.getByRole('button', { name: 'Set up Reader' }).click();
  const rk = await page.locator('.rd-rk').textContent({ timeout: 20000 });
  assert.match(rk, /^[A-Z0-9]{4}(-[A-Z0-9]{4}){7}$/);
  await page.getByRole('button', { name: 'I\'ve saved it' }).click();
  await page.getByText(/Nothing here yet/).waitFor();
  // Add three files: encrypted; the figures follow.
  await page.locator('#rd-add').setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Meet at the dock at 6. '.repeat(400)) },
    { name: 'dot.png', mimeType: 'image/png', buffer: PNG },
    { name: 'list.md', mimeType: 'text/markdown', buffer: Buffer.from('# list\n- one\n- two\n') },
  ]);
  await page.getByText('Added 3 files, encrypted.').waitFor();
  const figures = async () => (await page.locator('.rd-stats').innerText()).replace(/\s+/g, ' ');
  assert.match(await figures(), /^3 files .+ in all 0 folders$/);
  assert.match(await page.locator('.rd-stored').textContent(), /compressed and encrypted \(\d+% smaller\)/);
  // Nothing readable kept on the phone.
  const leak = await page.evaluate(async () => { const { idb } = await import('./lib/idb.js'); const vals = []; for (const k of (await idb.keys()).map(String).filter((x) => x.startsWith('cc.reader.'))) { const v = await idb.get(k); vals.push(JSON.stringify(v, (kk, x) => (x instanceof Uint8Array ? new TextDecoder().decode(x) : x))); } return vals.join(' '); });
  assert.ok(!/Meet at the dock|notes\.txt|list\.md/.test(leak), 'no names or contents readable');
  // A folder; move two files into it; its figures.
  page.once('dialog', (d) => d.accept('Trip'));
  await page.getByRole('button', { name: '📁 New folder' }).click();
  await page.getByRole('button', { name: /^Folder Trip, 0 files/ }).waitFor();
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByLabel('Pick notes.txt').check(); await page.getByLabel('Pick dot.png').check();
  await page.getByRole('button', { name: 'Move to…' }).click();
  await page.getByRole('dialog', { name: 'Move to' }).getByRole('button', { name: '📁 Trip' }).click();
  await page.getByText('Moved 2 to Trip.').waitFor();
  assert.match(await figures(), /^3 files .+ 1 folder$/);
  await page.getByRole('button', { name: /^Folder Trip, 2 files/ }).click();
  assert.match(await page.locator('.rd-stored').textContent(), /This folder: 2 of 3 files/);
  assert.equal((await page.locator('.rd-crumbs').innerText()).replace(/\s+/g, ' ').trim(), 'Reader › Trip');
  // Look at a file (decrypted in memory), and the next.
  await page.getByRole('button', { name: 'Open notes.txt' }).click();
  await page.locator('.rd-text').filter({ hasText: 'Meet at the dock at 6.' }).waitFor();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('.rd-view-body img').waitFor();
  await page.getByRole('dialog', { name: 'File' }).getByRole('button', { name: 'Close' }).click();
  // 📤 Export the folder: one locked package, downloaded.
  await page.getByRole('button', { name: '📤 Export' }).first().click();
  const ex = page.getByRole('dialog', { name: 'Export' });
  await ex.getByRole('button', { name: 'Make the package (2 files)' }).click();
  await ex.getByText(/Trip\.ccv: /).waitFor({ timeout: 30000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), ex.getByRole('button', { name: 'Download' }).click()]);
  assert.equal(dl.suggestedFilename(), 'Trip.ccv');
  const pkg = await dl.path();
  await ex.getByRole('button', { name: 'Close' }).click();
  // Locked, then open again: with the Vault open it opens by itself (a reload).
  await page.reload();
  await page.locator('.rd-stats').waitFor();
  assert.match(await figures(), /^3 files/);
  // 📥 Import the package back: opened by Reader's own key, no question; into a folder of its name.
  await page.locator('#rd-import').setInputFiles(pkg);
  await page.getByText('Imported 2 files, encrypted.').waitFor({ timeout: 30000 });
  assert.match(await figures(), /^5 files .+ 2 folders$/);
  await page.getByRole('button', { name: /^Folder Trip \(2\), 2 files/ }).waitFor();
  if (process.env.SHOT) { await page.screenshot({ path: process.env.SHOT }); await page.getByRole('button', { name: /^Folder Trip, 2 files/ }).click(); await page.getByRole('button', { name: 'Open dot.png' }).click(); await page.locator('.rd-view-body img').waitFor(); await page.screenshot({ path: process.env.SHOT.replace('.png', '-view.png') }); await page.getByRole('dialog', { name: 'File' }).getByRole('button', { name: 'Close' }).click(); }
  assert.deepEqual(errors, []);
  await context.close();
});

test('Reader 💽 Drive: connect a drive (its STORAGE folder made), lock a whole folder into it a piece at a time, see it, open it, take everything out, add it to the library', async () => {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await context.addInitScript(() => {
    try { sessionStorage.setItem('cc.hidden.open', '1'); } catch { /* private mode */ }
    // (Chrome's folder picker stood in for by folders of the browser's own private storage: the same API.)
    const dirOf = async (path) => { let d = await navigator.storage.getDirectory(); for (const p of path) d = await d.getDirectoryHandle(p, { create: true }); return d; };
    globalThis.showDirectoryPicker = async (o = {}) => dirOf(o.id === 'reader-source' ? ['src', 'Holiday'] : o.id === 'reader-out' ? ['out'] : ['E-drive']);
    for (const P of [FileSystemDirectoryHandle.prototype, FileSystemFileHandle.prototype]) { P.queryPermission ??= async () => 'granted'; P.requestPermission ??= async () => 'granted'; }
  });
  const page = await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE_PATH}#/reader`);
  // A folder to pack: two files (one big, several pieces) and a sub-folder.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory(); for (const n of ['src', 'out', 'E-drive']) { try { await root.removeEntry(n, { recursive: true }); } catch { /* none */ } }
    let d = root; for (const p of ['src', 'Holiday']) d = await d.getDirectoryHandle(p, { create: true });
    const put = async (dir, name, data) => { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
    const big = new Uint8Array(9 * 1024 * 1024); for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761) >>> 24;
    await put(d, 'clip.mp4', big); await put(await d.getDirectoryHandle('notes', { create: true }), 'plan.txt', 'Day 1: beach. '.repeat(5000));
  });
  await page.getByLabel('Reader password', { exact: true }).fill('maple river candle orbit'); await page.getByLabel('Reader password again').fill('maple river candle orbit');
  await page.getByRole('button', { name: 'Set up Reader' }).click(); await page.getByRole('button', { name: 'I\'ve saved it' }).click({ timeout: 20000 });
  await page.getByRole('tab', { name: /Drive · STORAGE/ }).click();
  await page.getByRole('button', { name: '💽 Choose the drive…' }).click();
  await page.getByText(/No packages in STORAGE yet/).waitFor();
  assert.ok(await page.evaluate(async () => { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle('E-drive'); await d.getDirectoryHandle('STORAGE'); return true; }), 'STORAGE made on the drive');
  // 🔒 A whole folder into STORAGE.
  await page.getByRole('button', { name: '🔒 New package from a folder…' }).click();
  const dlg = page.getByRole('dialog', { name: 'New package' });
  assert.equal(await dlg.getByLabel('Package name').inputValue(), 'Holiday');
  await dlg.getByRole('button', { name: 'Lock 2 files into STORAGE' }).click();
  await dlg.getByText(/✓ Holiday\.ccv in STORAGE: /).waitFor({ timeout: 60000 });
  await dlg.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Open Holiday.ccv' }).waitFor();
  assert.match((await page.locator('.rd-stats').innerText()).replace(/\s+/g, ' '), /^1 package /);
  // Open it: what's in it (Reader's own key: no password), take everything out exactly.
  await page.getByRole('button', { name: 'Open Holiday.ccv' }).click();
  const pkg = page.getByRole('dialog', { name: 'Package' });
  await pkg.getByRole('button', { name: /Look at Holiday\/notes\/plan\.txt/ }).waitFor();
  assert.match((await pkg.locator('.rd-stats').innerText()).replace(/\s+/g, ' '), /^2 files 9\.\d MB inside/);
  await pkg.getByRole('button', { name: '📂 Take everything out to a folder…' }).click();
  await pkg.getByText(/✓ 2 files taken out/).waitFor({ timeout: 60000 });
  const same = await page.evaluate(async () => {
    const r = await navigator.storage.getDirectory(); const out = await (await (await r.getDirectoryHandle('out')).getDirectoryHandle('Holiday')).getDirectoryHandle('Holiday');
    const a = await (await out.getFileHandle('clip.mp4')).getFile(); const b = await (await (await out.getDirectoryHandle('notes')).getFileHandle('plan.txt')).getFile();
    const src = await (await (await (await r.getDirectoryHandle('src')).getDirectoryHandle('Holiday')).getFileHandle('clip.mp4')).getFile();
    const h = async (f) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()))].join(',');
    return { clip: (await h(a)) === (await h(src)), text: (await b.text()).startsWith('Day 1: beach.'), size: b.size };
  });
  assert.deepEqual(same, { clip: true, text: true, size: 70000 });
  // A look at one file, then into the library.
  await pkg.getByRole('button', { name: /Look at Holiday\/notes\/plan\.txt/ }).click();
  await page.locator('.rd-text').filter({ hasText: 'Day 1: beach.' }).waitFor();
  await page.getByRole('dialog', { name: 'File' }).getByRole('button', { name: 'Close' }).click();
  await pkg.getByRole('button', { name: '📚 Add to the library' }).click();
  await pkg.getByText('✓ Added 2 to the library.').waitFor({ timeout: 60000 });
  await pkg.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('tab', { name: '📚 Library' }).click();
  assert.match((await page.locator('.rd-stats').innerText()).replace(/\s+/g, ' '), /^2 files .+ 3 folders$/);
  assert.deepEqual(errors, []);
  await context.close();
});
