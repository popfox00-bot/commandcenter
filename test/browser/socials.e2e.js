// Socials: behind its own password; make two accounts, post a photo from one, follow it from the other and
// see the post in that one's feed; like and comment; everything is still there after a reload (the password
// asked again); nothing is fetched from outside. With Saved Files set up: a second device opens the same
// Socials with the same password, encrypted in Drive, and changes go both ways.
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
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
});
after(async () => { await browser?.close(); server?.close(); });

/** A small PNG made in the page (a red square), as a file to pick. */
async function photo(page) {
  const b64 = await page.evaluate(async () => { const c = new OffscreenCanvas(64, 48); const x = c.getContext('2d'); x.fillStyle = '#e33'; x.fillRect(0, 0, 64, 48); const b = await c.convertToBlob({ type: 'image/png' }); const s = new Uint8Array(await b.arrayBuffer()); let t = ''; for (const v of s) t += String.fromCharCode(v); return btoa(t); });
  return { name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

test('Socials: accounts, a post, following, the feed, likes and comments, kept after a reload, all local', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const outside = []; page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) outside.push(r.url()); });
  await page.goto(`${origin}${BASE}index.html`);
  await page.locator('.app-name', { hasText: 'Socials' }).click();
  // Its own password, set the first time.
  await page.getByLabel('Password', { exact: true }).fill('heron42');
  await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  // The first account.
  await page.getByLabel('Username', { exact: true }).fill('Maya.Shoots');
  await page.getByLabel('Name', { exact: true }).fill('Maya');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Welcome to your feed').waitFor();
  assert.match(await page.locator('.so-switch').textContent(), /maya\.shoots/, 'the handle cleaned up, in use');
  // A post from it.
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo').setInputFiles(await photo(page));
  await page.locator('.so-new-prev img').waitFor();
  await page.getByLabel('Caption').fill('Sunset at the pier');
  await page.getByRole('button', { name: 'Share' }).click();
  await page.locator('.so-post').first().waitFor();
  assert.match(await page.locator('.so-post .so-caption').textContent(), /maya\.shoots Sunset at the pier/);
  // A second account: its feed is empty until it follows the first.
  await page.locator('.so-switch').click();
  await page.getByLabel('Username', { exact: true }).fill('jordan');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Welcome to your feed').waitFor();
  assert.equal(await page.locator('.so-post').count(), 0, 'nothing followed yet');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByLabel('Search accounts').fill('maya');
  await page.locator('.so-person', { hasText: 'maya.shoots' }).getByRole('button', { name: 'Follow' }).click();
  await page.locator('.so-person', { hasText: 'maya.shoots' }).getByRole('button', { name: 'Following' }).waitFor();
  await page.getByRole('button', { name: 'Home' }).click();
  await page.locator('.so-post').first().waitFor();
  assert.match(await page.locator('.so-post .so-caption').textContent(), /Sunset at the pier/, 'the followed account\'s post in the feed');
  // Like it and comment, as jordan.
  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await page.getByText('1 like').waitFor();
  await page.getByRole('button', { name: 'Comments' }).click();
  await page.getByLabel('Add a comment').fill('Gorgeous!');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.locator('.so-comment', { hasText: 'jordan Gorgeous!' }).waitFor();
  // (Saved: the comment written to the phone's storage before the page goes.)
  await page.waitForFunction(() => new Promise((res) => { const r = indexedDB.open('command-center'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('cc.socials'); g.onsuccess = () => res(!!g.result?.posts?.some((p) => p.comments.some((c) => c.text === 'Gorgeous!'))); g.onerror = () => res(false); }; r.onerror = () => res(false); }));
  // A reload: the accounts, who follows whom, the post, its like and comment all still there.
  await page.reload();
  // (Asked for the password again: a wrong one refused, the right one opens it.)
  await page.getByLabel('Password', { exact: true }).fill('nope');
  await page.getByRole('button', { name: 'Open' }).click();
  await page.getByText('Wrong password.').waitFor();
  assert.equal(await page.locator('.so-post').count(), 0, 'nothing shown while locked');
  await page.getByLabel('Password', { exact: true }).fill('heron42');
  await page.getByRole('button', { name: 'Open' }).click();
  await page.locator('.so-post').first().waitFor();
  assert.match(await page.locator('.so-switch').textContent(), /jordan/);
  assert.match(await page.locator('.so-likes').textContent(), /1 like/);
  assert.match(await page.locator('.so-post').textContent(), /jordan Gorgeous!/);
  assert.ok(await page.locator('.so-pic img').evaluate((i) => i.complete && i.naturalWidth > 0), 'the photo, kept on the phone');
  // Maya's profile: 1 post, 1 follower.
  await page.locator('.so-post-head .so-handle').click();
  assert.match(await page.locator('.so-stats').textContent(), /1posts1followers0following/);
  assert.deepEqual(outside, [], 'nothing fetched from outside');
  await page.close();
});

/** A Saved Files script stand-in (its web app's actions, in memory), shared by two "devices". */
function fakeScript() {
  const files = []; const folders = []; let n = 0;
  const handle = (req) => {
    if (req.action === 'ping') return { ok: true, folder: 'Saved Files', version: 4 };
    if (req.action === 'folders') return { ok: true, folders: folders.map((f) => ({ id: f.id, name: f.name, path: f.name })) };
    if (req.action === 'list') return { ok: true, files: files.filter((f) => f.folder === (req.folder ?? '')).map(({ id, name, type }) => ({ id, name, type })), folders: [], path: [] };
    if (req.action === 'upload') {
      let fid = '';
      if (req.folder) { let f = folders.find((x) => x.name === req.folder); if (!f) { f = { id: `d${++n}`, name: req.folder }; folders.push(f); } fid = f.id; }
      for (let i = files.length - 1; i >= 0; i--) if (files[i].folder === fid && files[i].name === req.name) files.splice(i, 1);
      const f = { id: `f${++n}`, name: req.name, type: req.type, data: req.data, folder: fid }; files.push(f);
      return { ok: true, file: { id: f.id, name: f.name } };
    }
    if (req.action === 'download') { const f = files.find((x) => x.id === req.id); return f ? { ok: true, name: f.name, type: f.type, data: f.data } : { ok: false, error: 'gone' }; }
    return { ok: false, error: 'unknown' };
  };
  return { files, handle };
}

test('Socials on two devices: the same password opens the same Socials from Drive, encrypted there; a post on one reaches the other', async () => {
  const script = fakeScript(); const URL_ = 'https://script.google.com/macros/s/test/exec';
  const device = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(([u]) => { localStorage.setItem('cc.savedFiles', JSON.stringify({ url: u, key: 'k'.repeat(24) })); }, [URL_]);
    await ctx.route(URL_, async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(script.handle(JSON.parse(route.request().postData()))) }));
    const page = await ctx.newPage(); await page.goto(`${origin}${BASE}index.html#/socials`);
    return { ctx, page };
  };
  // Device 1: a password (Drive has no Socials yet), an account, a post; sent to Drive, a recovery key shown once.
  const A = await device();
  await A.page.getByLabel('Password', { exact: true }).fill('heron42'); await A.page.getByLabel('Password again').fill('heron42');
  await A.page.getByRole('button', { name: 'Set password' }).click();
  await A.page.getByLabel('Username', { exact: true }).fill('maya'); await A.page.getByRole('button', { name: 'Create account' }).click();
  await A.page.getByRole('button', { name: 'New post' }).first().click();
  await A.page.getByLabel('Photo').setInputFiles(await photo(A.page)); await A.page.locator('.so-new-prev img').waitFor();
  await A.page.getByLabel('Caption').fill('From the first phone'); await A.page.getByRole('button', { name: 'Share' }).click();
  await A.page.getByText('Your recovery key').waitFor({ timeout: 20000 });
  assert.match(await A.page.locator('.so-key').textContent(), /^[A-Z2-9]{4}(-[A-Z2-9]{4}){7}$/);
  await A.page.getByRole('button', { name: 'I\'ve saved it' }).click();
  await A.page.getByRole('button', { name: 'Sync and password' }).click(); await A.page.getByRole('button', { name: 'Sync now' }).click();
  await A.page.waitForFunction(() => /^Synced/.test(document.querySelector('.so-sync-msg')?.textContent ?? '') && document.querySelector('.so-cloud')?.textContent === '☁');
  // (In Drive: only scrambled files, no caption, handle or photo readable.)
  assert.ok(script.files.some((f) => f.name === 'socials-data.ccs') && script.files.some((f) => /^socials-m-/.test(f.name)));
  const raw = script.files.filter((f) => f.name !== 'socials-key.json').map((f) => Buffer.from(f.data, 'base64').toString('latin1')).join('');
  assert.ok(!raw.includes('From the first phone') && !raw.includes('maya') && !raw.includes('JFIF'), 'encrypted in Drive');
  // Device 2: Socials found in Drive; a wrong password refused, the right one brings the account and post.
  const B = await device();
  await B.page.getByText('Your Socials is in your Drive').waitFor();
  await B.page.getByLabel('Password or recovery key').fill('wrong!');
  await B.page.getByRole('button', { name: 'Open' }).click(); await B.page.getByText('That doesn\'t open it.').waitFor();
  await B.page.getByLabel('Password or recovery key').fill('heron42'); await B.page.getByRole('button', { name: 'Open' }).click();
  await B.page.locator('.so-post', { hasText: 'From the first phone' }).waitFor({ timeout: 20000 });
  assert.ok(await B.page.locator('.so-pic img').evaluate((i) => i.complete && i.naturalWidth > 0), 'the photo came too');
  // Device 2 comments; device 1, syncing, sees it.
  await B.page.getByRole('button', { name: 'Comments' }).click();
  await B.page.getByLabel('Add a comment').fill('Seen on the second phone'); await B.page.getByRole('button', { name: 'Post', exact: true }).click();
  await B.page.getByRole('button', { name: 'Sync and password' }).click(); await B.page.getByRole('button', { name: 'Sync now' }).click();
  await B.page.waitForFunction(() => /^Synced/.test(document.querySelector('.so-sync-msg')?.textContent ?? ''));
  await A.page.getByRole('button', { name: 'Sync and password' }).click(); await A.page.getByRole('button', { name: 'Sync now' }).click();
  await A.page.waitForFunction(() => /^Synced/.test(document.querySelector('.so-sync-msg')?.textContent ?? ''));
  await A.page.getByRole('button', { name: 'Home' }).click();
  await A.page.getByRole('button', { name: 'Comments' }).click();
  await A.page.locator('.so-comment', { hasText: 'Seen on the second phone' }).waitFor();
  await A.ctx.close(); await B.ctx.close();
});
