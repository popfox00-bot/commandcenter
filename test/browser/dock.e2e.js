// The Dock: along the bottom of every screen, Home in the middle and two Favorites each side; a Favorite opens
// its app, Home goes back; holding one down (or Settings → Dock) changes it, kept after a reload; out of the
// way while typing; Socials' own tab bar sits above it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
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

test('the Dock: Home in the middle, four Favorites; open an app, go Home, change a Favorite (held, or in Settings), kept', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://**', (r) => r.abort());
  await page.goto(`${origin}${BASE}index.html`);
  const dock = page.getByRole('navigation', { name: 'Dock' });
  const labels = () => dock.locator('a, button').evaluateAll((l) => l.map((e) => e.getAttribute('aria-label')));
  assert.deepEqual(await labels(), ['Notes', 'Clock', 'Home', 'Socials', 'Calculator']);
  const box = await dock.boundingBox(); assert.ok(box.height <= 64, 'short'); assert.ok(Math.abs(box.y + box.height - 844) < 1, 'at the bottom');
  const home = await dock.getByRole('link', { name: 'Home' }).boundingBox(); assert.ok(Math.abs(home.x + home.width / 2 - 195) < 2, 'Home centered');
  // A Favorite opens its app; Home goes back.
  await dock.getByRole('link', { name: 'Clock' }).click(); await page.waitForURL(/#\/clock/);
  assert.equal(await dock.getByRole('link', { name: 'Clock' }).getAttribute('aria-current'), 'page');
  await dock.getByRole('link', { name: 'Home' }).click(); await page.waitForURL(/#\/$/); await page.locator('#app-grid .app-tile').first().waitFor();
  // Held down: change it.
  const fav = dock.getByRole('link', { name: 'Notes' }); const fb = await fav.boundingBox();
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
  const pick = page.getByRole('dialog', { name: /Favorite on the left/ }); await pick.waitFor();
  await pick.getByRole('button', { name: /Units/ }).click();
  assert.deepEqual(await labels(), ['Units', 'Clock', 'Home', 'Socials', 'Calculator']);
  assert.match(page.url(), /#\/$/, 'holding it didn\'t open it');
  // Settings → Dock.
  await page.goto(`${origin}${BASE}index.html#/settings/dock`);
  await page.getByLabel('Right 2').selectOption('draw');
  assert.deepEqual(await labels(), ['Units', 'Clock', 'Home', 'Socials', 'Draw']);
  await page.reload(); assert.deepEqual(await labels(), ['Units', 'Clock', 'Home', 'Socials', 'Draw'], 'kept');
  // Typing: the Dock steps out of the way.
  await page.goto(`${origin}${BASE}index.html#/clock`); await page.locator('#app-host').waitFor();
  // (A text box in the page, as any app's: typing in it is what counts.)
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'text'; i.id = 'dock-test-input'; i.setAttribute('aria-label', 'Test text'); document.querySelector('#app-host').prepend(i); });
  const box2 = page.locator('#dock-test-input'); await box2.waitFor();
  await page.waitForTimeout(300); await box2.click();
  await page.waitForFunction(() => document.body.classList.contains('dock-typing'), null, { timeout: 3000 });
  assert.equal(await dock.isVisible(), false, 'hidden while typing');
  await box2.blur(); await page.waitForTimeout(100); assert.equal(await dock.isVisible(), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('the Dock in Socials: tucked away behind the logo at the bottom left (above its tab bar); the logo opens it and closes it, remembered per app; Settings chooses for each app', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('https://**', (r) => r.abort());
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  const dock = page.locator('#dock'); const logo = page.locator('.dock-toggle');
  await page.waitForTimeout(300);
  assert.equal(await dock.isVisible(), false, 'tucked away in Socials');
  assert.equal(await logo.getAttribute('aria-label'), 'Show the Dock');
  const tabs = await page.locator('.so-tabs').boundingBox(); const lb = await logo.boundingBox();
  assert.ok(Math.abs(tabs.y + tabs.height - 844) < 1.5, 'its tab bar at the bottom');
  assert.ok(lb.x < 20 && lb.y + lb.height <= tabs.y, 'the logo at the left, above the tab bar');
  await logo.click(); await page.waitForTimeout(300);
  assert.equal(await dock.isVisible(), true, 'opened'); assert.equal(await logo.getAttribute('aria-expanded'), 'true');
  const tabs2 = await page.locator('.so-tabs').boundingBox(); const db = await dock.boundingBox();
  assert.ok(Math.abs(tabs2.y + tabs2.height - db.y) < 1.5, 'the tab bar just above the Dock');
  const lb2 = await logo.boundingBox(); assert.ok(lb2.y + lb2.height <= tabs2.y && lb2.x < 20, 'the logo floats above (not in) the Dock and the tab bar');
  await logo.click(); await page.waitForTimeout(300); assert.equal(await dock.isVisible(), false, 'closed again');
  // Elsewhere it's shown; the logo there tucks it away, for that app only.
  await page.goto(`${origin}${BASE}index.html#/clock`); await page.waitForTimeout(300);
  assert.equal(await dock.isVisible(), true, 'shown in the Clock');
  const db3 = await dock.boundingBox(); const lb3 = await logo.boundingBox(); assert.ok(lb3.y + lb3.height <= db3.y, 'above the Dock in the Clock too');
  await logo.click(); await page.waitForTimeout(300); assert.equal(await dock.isVisible(), false);
  await page.goto(`${origin}${BASE}index.html#/calculator`); await page.waitForTimeout(300); assert.equal(await dock.isVisible(), true, 'still shown in the Calculator');
  await page.goto(`${origin}${BASE}index.html#/clock`); await page.waitForTimeout(300); assert.equal(await dock.isVisible(), false, 'the Clock remembers');
  // Settings → Dock: Socials shown.
  await page.goto(`${origin}${BASE}index.html#/settings/dock`);
  assert.equal(await page.getByLabel('Dock in Clock').inputValue(), 'tucked');
  await page.getByLabel('Dock in Socials').selectOption('shown');
  await page.goto(`${origin}${BASE}index.html#/socials/admin`); await page.waitForTimeout(500);
  assert.equal(await dock.isVisible(), true, 'shown in Socials now');
  await page.close();
});
