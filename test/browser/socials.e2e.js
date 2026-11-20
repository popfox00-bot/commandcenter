// Socials: make two accounts, post a photo from one, follow it from the other and see the post in that
// one's feed; like and comment; everything is still there after a reload; nothing is fetched from outside.
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
  // A reload: the accounts, who follows whom, the post, its like and comment all still there.
  await page.reload();
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
