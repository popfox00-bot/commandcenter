// Face ID (passkeys) as well as the passwords: the hidden area and Socials, on a virtual authenticator (a
// phone's Face ID stand-in). With the passkey's own secret (prf), Face ID alone opens Socials and it can sync;
// without it, Socials opens and its password is asked for only to sync. The passwords keep working. And
// Settings → Storage: bars against this device's limit and your Drive's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
let server; let browser; let origin;
before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = path.startsWith(BASE) ? path.slice(BASE.length) || 'index.html' : null;
    try { res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(await readFile(join(WEB, rel))); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://localhost:${server.address().port}`; // (passkeys need a name, not an IP address)
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
});
after(async () => { await browser?.close(); server?.close(); });

/** A page with a Face ID stand-in (`prf`: whether its passkeys can give the app a secret). */
async function faceIdPage({ prf = true, verified = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: verified, automaticPresenceSimulation: true, hasPrf: prf } });
  return { ctx, page, cdp, authenticatorId };
}

test('Face ID opens the hidden area as well as its password; turned off, only the password', async () => {
  const { ctx, page, cdp, authenticatorId } = await faceIdPage();
  await page.goto(`${origin}${BASE}index.html#/hidden`);
  await page.getByLabel('New password').fill('secret1'); await page.getByLabel('The same again').fill('secret1');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByText('Welcome!').waitFor();
  await page.getByRole('button', { name: 'Set up Face ID' }).click();
  await page.getByRole('button', { name: 'Turn off Face ID' }).waitFor();
  // Locked: Face ID opens it.
  await page.getByRole('button', { name: '🔒 Lock' }).click();
  await page.goto(`${origin}${BASE}index.html#/hidden`);
  await page.getByRole('button', { name: '🔓 Use Face ID' }).click();
  await page.getByText('Welcome!').waitFor();
  // (A failed Face ID: not opened.)
  await page.getByRole('button', { name: '🔒 Lock' }).click();
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
  await page.goto(`${origin}${BASE}index.html#/hidden`);
  await page.getByRole('button', { name: '🔓 Use Face ID' }).click();
  await page.waitForTimeout(800);
  assert.equal(await page.getByText('Welcome!').count(), 0, 'not opened by a failed Face ID');
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
  // The password still opens it; turning Face ID off removes the button.
  await page.getByLabel('Password').fill('secret1'); await page.getByRole('button', { name: 'Open' }).click();
  await page.getByText('Welcome!').waitFor();
  await page.getByRole('button', { name: 'Turn off Face ID' }).click();
  await page.getByRole('button', { name: '🔒 Lock' }).click();
  await page.goto(`${origin}${BASE}index.html#/hidden`); await page.getByLabel('Password').waitFor();
  assert.equal(await page.getByRole('button', { name: '🔓 Use Face ID' }).count(), 0);
  await ctx.close();
});

for (const prf of [true, false]) {
  test(`Face ID opens Socials (${prf ? 'with prf: it can sync with no password' : 'without prf: the password asked for only to sync'})`, async () => {
    const { ctx, page } = await faceIdPage({ prf });
    const URL_ = 'https://script.google.com/macros/s/test/exec'; let synced = 0;
    await ctx.addInitScript(([u]) => { localStorage.setItem('cc.savedFiles', JSON.stringify({ url: u, key: 'k'.repeat(24) })); }, [URL_]);
    const files = []; let n = 0;
    await ctx.route(URL_, async (route) => {
      const q = JSON.parse(route.request().postData()); let out = { ok: true };
      if (q.action === 'folders') out = { ok: true, folders: files.length ? [{ id: 'd1', name: 'Socials', path: 'Socials' }] : [] };
      else if (q.action === 'list') out = { ok: true, files: files.map(({ id, name }) => ({ id, name })) };
      else if (q.action === 'upload') { synced++; for (let i = files.length - 1; i >= 0; i--) if (files[i].name === q.name) files.splice(i, 1); files.push({ id: `f${++n}`, name: q.name, type: q.type, data: q.data }); out = { ok: true, file: { id: `f${n}`, name: q.name } }; }
      else if (q.action === 'download') { const f = files.find((x) => x.id === q.id); out = { ok: true, name: f.name, type: f.type, data: f.data }; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
    });
    await page.goto(`${origin}${BASE}index.html#/socials/admin`);
    await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
    await page.getByRole('button', { name: 'Set password' }).click();
    await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByText('Your recovery key').waitFor({ timeout: 60000 }); await page.getByRole('button', { name: 'I\'ve saved it' }).click();
    await page.getByRole('button', { name: /Sync and password/ }).click();
    await page.getByRole('button', { name: 'Set up Face ID' }).click();
    await page.getByText(prf ? 'Face ID now opens Socials (and syncs).' : 'Face ID now opens Socials.', { exact: true }).waitFor();
    // Reloaded (the password forgotten): Face ID opens it.
    await page.reload();
    await page.getByRole('button', { name: '🔓 Use Face ID' }).click();
    await page.locator('.so-switch').waitFor();
    const before = synced;
    await page.getByRole('button', { name: /Sync and password/ }).click();
    if (prf) {
      await page.getByRole('button', { name: 'Sync now' }).click();
      await page.waitForFunction(() => /^Synced/.test(document.querySelector('.so-sync-msg')?.textContent ?? ''));
      assert.ok(synced > before, 'synced with no password typed');
    } else {
      await page.getByText('Socials was opened with Face ID').waitFor();
      await page.getByLabel('Your Socials password').first().fill('heron42'); await page.getByRole('button', { name: 'Sync with it' }).click();
      await page.waitForFunction(() => /^Synced/.test(document.querySelector('.so-sync-msg')?.textContent ?? ''), null, { timeout: 20000 });
      assert.ok(synced > before, 'synced once the password was given');
    }
    await ctx.close();
  });
}

test('Settings → Storage: a bar against this device\'s limit (what makes it up), and your Drive\'s space', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const URL_ = 'https://script.google.com/macros/s/test/exec';
  await ctx.addInitScript(([u]) => { localStorage.setItem('cc.savedFiles', JSON.stringify({ url: u, key: 'k'.repeat(24) })); }, [URL_]);
  await ctx.route(URL_, (route) => { const q = JSON.parse(route.request().postData()); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(q.action === 'quota' ? { ok: true, used: 6 * 2 ** 30, limit: 15 * 2 ** 30 } : { ok: true }) }); });
  const page = await ctx.newPage();
  await page.goto(`${origin}${BASE}index.html#/settings`);
  await page.locator('summary', { hasText: 'Storage' }).click();
  const dev = page.getByRole('progressbar', { name: 'On this device' }); await dev.waitFor();
  assert.match(await dev.getAttribute('aria-valuetext'), / of .*\(.*%\)/);
  const drive = page.getByRole('progressbar', { name: 'Google Drive (Saved Files)' }); await drive.waitFor();
  assert.equal(await drive.getAttribute('aria-valuenow'), '40');
  assert.match(await page.locator('.st-limits').textContent(), /25 MB a file/);
  await ctx.close();
});
