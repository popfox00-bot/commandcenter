// Socials: behind its own password; make two accounts, post a photo from one, follow it from the other and
// see the post in that one's feed; like and comment; everything is still there after a reload (the password
// asked again); nothing is fetched from outside (but the Sports front's scores). With Saved Files set up: a second device opens the same
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
  const outside = []; page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('blob:') && !r.url().startsWith('data:') && !r.url().startsWith('https://site.api.espn.com/')) outside.push(r.url()); });
  // (The Sports front's scores: answered here, no games.)
  await page.route('https://site.api.espn.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"events":[]}' }));
  await page.goto(`${origin}${BASE}index.html`);
  await page.locator('.app-name', { hasText: 'Socials' }).click();
  // It opens to its Sports front; the accounts are behind ⚙ → Admin.
  await page.locator('.sp-feed').waitFor();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Admin' }).click();
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
  await page.getByLabel('Photo or video').setInputFiles(await photo(page));
  await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-new-prev img').waitFor();
  await page.getByLabel('Caption').fill('Sunset at the pier');
  await page.getByRole('button', { name: 'Share' }).click();
  await page.locator('.so-post').first().waitFor();
  assert.match(await page.locator('.so-post .so-caption').textContent(), /maya\.shoots Sunset at the pier/);
  // A second account: its feed is empty until it follows the first.
  await page.locator('.so-switch').click();
  await page.getByRole('button', { name: '+ Add New' }).click();
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
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await page.getByLabel('Add a comment').fill('Gorgeous!');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.locator('.so-comment', { hasText: 'jordan Gorgeous!' }).waitFor();
  // (Saved: the comment written to the phone's storage before the page goes.)
  await page.waitForFunction(() => new Promise((res) => { const r = indexedDB.open('command-center'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('cc.socials'); g.onsuccess = () => res(!!g.result?.posts?.some((p) => p.comments.some((c) => c.text === 'Gorgeous!'))); g.onerror = () => res(false); }; r.onerror = () => res(false); }));
  // A reload: the accounts, who follows whom, the post, its like and comment all still there.
  await page.reload();
  // (The Sports front again; ⚙ → Admin; asked for the password again: a wrong one refused, the right one opens it.)
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Admin' }).click();
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
    const page = await ctx.newPage(); await page.goto(`${origin}${BASE}index.html#/socials/admin`);
    return { ctx, page };
  };
  // Device 1: a password (Drive has no Socials yet), an account, a post; sent to Drive, a recovery key shown once.
  const A = await device();
  await A.page.getByLabel('Password', { exact: true }).fill('heron42'); await A.page.getByLabel('Password again').fill('heron42');
  await A.page.getByRole('button', { name: 'Set password' }).click();
  await A.page.getByLabel('Username', { exact: true }).fill('maya'); await A.page.getByRole('button', { name: 'Create account' }).click();
  // (The recovery key comes with the first sync: before the post or after it, as it happens; it stays on screen until
  // "I've saved it", whatever's tapped meanwhile.)
  let key = '';
  const takeKey = async () => { key = await A.page.locator('.so-key').textContent(); await A.page.locator('.so-tabs button').nth(2).click({ timeout: 3000 }).catch(() => {}); assert.equal(await A.page.locator('.so-key').count(), 1, 'still shown after a tab was tapped'); await A.page.getByRole('button', { name: 'I\'ve saved it' }).click(); };
  await A.page.getByText('Welcome to your feed').or(A.page.getByText('Your recovery key')).first().waitFor();
  await A.page.waitForTimeout(800); if (await A.page.locator('.so-key').count()) await takeKey();
  await A.page.getByRole('button', { name: 'New post' }).first().click();
  await A.page.getByLabel('Photo or video').setInputFiles(await photo(A.page)); await A.page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click(); await A.page.locator('.so-new-prev img').waitFor();
  await A.page.getByLabel('Caption').fill('From the first phone'); await A.page.getByRole('button', { name: 'Share' }).click();
  await A.page.locator('.so-post', { hasText: 'From the first phone' }).or(A.page.getByText('Your recovery key')).first().waitFor({ timeout: 30000 });
  if (!key) { await A.page.getByText('Your recovery key').waitFor({ timeout: 60000 }); await takeKey(); }
  assert.match(key, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){7}$/);
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
  await B.page.getByRole('button', { name: 'Comments', exact: true }).click();
  await B.page.getByLabel('Add a comment').fill('Seen on the second phone'); await B.page.getByRole('button', { name: 'Post', exact: true }).click();
  await B.page.getByRole('button', { name: 'Sync and password' }).click(); await B.page.getByRole('button', { name: 'Sync now' }).click();
  await B.page.waitForFunction(() => /^Synced/.test(document.querySelector('.so-sync-msg')?.textContent ?? ''));
  await A.page.getByRole('button', { name: 'Sync and password' }).click(); await A.page.getByRole('button', { name: 'Sync now' }).click();
  await A.page.waitForFunction(() => /^Synced/.test(document.querySelector('.so-sync-msg')?.textContent ?? ''));
  await A.page.getByRole('button', { name: 'Home' }).click();
  await A.page.getByRole('button', { name: 'Comments', exact: true }).click();
  await A.page.locator('.so-comment', { hasText: 'Seen on the second phone' }).waitFor();
  await A.ctx.close(); await B.ctx.close();
});

/** A short WebM video with a tone in it, made in the page (canvas + an oscillator, recorded). */
async function clip(page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 284; const x = c.getContext('2d');
    const ac = new AudioContext(); const osc = ac.createOscillator(); const dest = ac.createMediaStreamDestination(); osc.connect(dest); osc.start();
    const stream = new MediaStream([...c.captureStream(15).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' }); const parts = []; rec.ondataavailable = (e) => parts.push(e.data);
    let t = 0; const iv = setInterval(() => { x.fillStyle = `hsl(${(t += 12) % 360} 80% 50%)`; x.fillRect(0, 0, 160, 284); }, 60);
    rec.start(); await new Promise((r) => setTimeout(r, 1200)); rec.stop(); await new Promise((r) => { rec.onstop = r; }); clearInterval(iv); osc.stop(); ac.close();
    const s = new Uint8Array(await new Blob(parts, { type: 'video/webm' }).arrayBuffer()); let out = ''; for (const v of s) out += String.fromCharCode(v); return btoa(out);
  });
  return { name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(b64, 'base64') };
}

test('Socials extras: a photo fitted square and filtered Mono in the editor (nothing kept in the Photo Editor); a video with sound in Reels; DMs between accounts; the Owner listed first', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  // A colourful 64×48 photo, made Square and Mono in the editor.
  await page.getByRole('button', { name: 'New post' }).first().click();
  const colour = await page.evaluate(async () => { const c = new OffscreenCanvas(640, 480); const x = c.getContext('2d'); x.fillStyle = '#e33'; x.fillRect(0, 0, 320, 480); x.fillStyle = '#33e'; x.fillRect(320, 0, 320, 480); const b = await c.convertToBlob({ type: 'image/png' }); const s = new Uint8Array(await b.arrayBuffer()); let t = ''; for (const v of s) t += String.fromCharCode(v); return btoa(t); });
  await page.getByLabel('Photo or video').setInputFiles({ name: 'c.png', mimeType: 'image/png', buffer: Buffer.from(colour, 'base64') });
  const ed = page.getByRole('dialog', { name: 'Edit photo' });
  await ed.getByRole('button', { name: 'Square' }).click();
  await ed.getByRole('tab', { name: 'Filter' }).click();
  assert.ok(!(await ed.locator('.se-panel').textContent()).includes('null'), 'no stray text in the panel');
  await ed.getByRole('button', { name: 'Mono' }).click();
  await ed.getByRole('tab', { name: 'Edit' }).click();
  await ed.getByRole('button', { name: 'Brightness', exact: true }).click();
  await ed.getByRole('slider', { name: 'Brightness' }).fill('30');
  await ed.getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-new-prev img').waitFor();
  const shot = await page.locator('.so-new-prev img').evaluate(async (img) => { await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(c.width / 4, c.height / 2, 1, 1).data; return { w: c.width, h: c.height, px: [...d] }; });
  assert.equal(shot.w, shot.h, 'square');
  assert.ok(Math.abs(shot.px[0] - shot.px[1]) < 6 && Math.abs(shot.px[1] - shot.px[2]) < 6, `mono: ${shot.px}`);
  await page.getByLabel('Caption').fill('Squared'); await page.getByRole('button', { name: 'Share' }).click();
  await page.locator('.so-post', { hasText: 'Squared' }).waitFor();
  assert.ok(!(await page.locator('.so-top').textContent()).includes('null'), 'no stray text in the top bar');
  // (Nothing of it in the Photo Editor: no work in progress or recent edit there.)
  const kept = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('command-center'); r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').getAllKeys(); g.onsuccess = () => res(g.result); }; }));
  assert.ok(!kept.includes('editor.session'), `not in the Photo Editor: ${kept}`);
  // Edit the post's caption from its ⋯.
  await page.getByRole('button', { name: 'Post options' }).click(); await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Caption').fill('Squared and edited'); await page.getByRole('button', { name: 'Save' }).click();
  await page.locator('.so-post', { hasText: 'Squared and edited' }).waitFor();
  assert.match(await page.locator('.so-post .so-dot').first().textContent(), /edited/);
  // A video, with its sound, shown in Reels.
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles(await clip(page));
  await page.locator('.so-new-prev video').waitFor();
  await page.getByLabel('Caption').fill('My first reel'); await page.getByRole('button', { name: 'Share' }).click();
  await page.locator('.so-reel', { hasText: 'My first reel' }).waitFor();
  assert.ok(await page.locator('.so-tab.active[aria-label="Reels"]').count(), 'on the Reels tab');
  await page.waitForFunction(() => { const v = document.querySelector('.so-reel video'); return v && v.readyState >= 2; });
  await page.getByRole('button', { name: 'Sound on' }).click();
  // (Its sound kept: audio decoded as it plays.)
  await page.waitForFunction(() => (document.querySelector('.so-reel video')?.webkitAudioDecodedByteCount ?? 0) > 0, null, { timeout: 10000 });
  assert.equal(await page.locator('.so-reel video').evaluate((v) => v.muted), false, 'sound turned on');
  assert.equal(await page.locator('.so-reel').count(), 1, 'only videos in Reels');
  // A second account; the Owner listed first, on its own.
  await page.locator('.so-switch').click();
  await page.getByRole('button', { name: '+ Add New' }).click();
  await page.getByLabel('Username', { exact: true }).fill('alt.acct'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-switch').click();
  assert.deepEqual(await page.locator('.so-section').allTextContents(), ['Owner', 'Friends · 1', 'Celebrities']);
  assert.match(await page.locator('.so-person').first().textContent(), /owner\.meOwner/);
  // A DM from alt.acct to the Owner; the Owner sees it unread, answers.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Messages' }).click();
  await page.getByRole('button', { name: 'Message @owner.me' }).click();
  await page.getByLabel('Message', { exact: true }).fill('Hey owner!'); await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.so-bubble.mine', { hasText: 'Hey owner!' }).waitFor();
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  await page.getByRole('button', { name: 'Messages, 1 unread' }).click();
  await page.getByRole('button', { name: /Chat with @alt\.acct, 1 unread/ }).click();
  await page.locator('.so-bubble:not(.mine)', { hasText: 'Hey owner!' }).waitFor();
  await page.getByLabel('Message', { exact: true }).fill('Hi alt'); await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.so-bubble.mine', { hasText: 'Hi alt' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Messages', exact: true }).count(), 1, 'read: no unread badge');
  await page.close();
});

test('Socials offline: posts made offline wait for Saved Files, counted for the Owner (also after a refresh before syncing), and are saved once back online', async () => {
  const script = fakeScript(); const URL_ = 'https://script.google.com/macros/s/test/exec'; let down = false;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(([u]) => { localStorage.setItem('cc.savedFiles', JSON.stringify({ url: u, key: 'k'.repeat(24) })); }, [URL_]);
  await ctx.route(URL_, async (route) => (down ? route.abort('internetdisconnected') : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(script.handle(JSON.parse(route.request().postData()))) })));
  const page = await ctx.newPage(); await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  // (The first sync makes the copy in Drive: its recovery key, once.)
  await page.getByText('Your recovery key').waitFor({ timeout: 60000 }); await page.getByRole('button', { name: 'I\'ve saved it' }).click();
  await page.getByRole('button', { name: 'Sync and password' }).click();
  await page.getByText('Everything is saved to Saved Files.').waitFor();
  // Offline: two posts, still made and shown.
  await ctx.setOffline(true);
  for (const cap of ['Offline one', 'Offline two']) {
    await page.getByRole('button', { name: 'New post' }).first().click();
    await page.getByLabel('Photo or video').setInputFiles(await photo(page)); await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
    await page.locator('.so-new-prev img').waitFor(); await page.getByLabel('Caption').fill(cap); await page.getByRole('button', { name: 'Share' }).click();
    await page.locator('.so-post', { hasText: cap }).waitFor();
  }
  // The Owner sees how many wait (two photos, and the posts' file), and the ⏳ by the cloud.
  await page.getByRole('button', { name: /Sync and password: 3 files waiting/ }).click();
  await page.getByText('⏳ 3 files waiting to be saved to Saved Files').waitFor();
  assert.match(await page.locator('.so-waiting').textContent(), /offline/);
  // Refreshed before it could sync (Drive still unreachable): nothing lost, still counted.
  down = true; await ctx.setOffline(false);
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByRole('button', { name: 'Open' }).click();
  await page.locator('.so-post', { hasText: 'Offline two' }).waitFor();
  await page.getByRole('button', { name: /3 files waiting/ }).click();
  await page.getByText('⏳ 3 files waiting to be saved to Saved Files').waitFor();
  // Not shown to an account that isn't the Owner.
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click(); await page.getByLabel('Username', { exact: true }).fill('alt.acct'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: /Sync and password/ }).click();
  assert.equal(await page.locator('.so-waiting:not([hidden])').count(), 0, 'only on the Owner account');
  // Back online: saved; nothing waiting.
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  down = false;
  await page.getByRole('button', { name: /Sync and password/ }).click(); await page.getByRole('button', { name: 'Sync now' }).click();
  await page.getByText('Everything is saved to Saved Files.').waitFor({ timeout: 20000 });
  assert.equal(script.files.filter((f) => /^socials-m-/.test(f.name)).length, 2, 'both photos in Drive');
  await ctx.close();
});

test('Socials keeps photos as bytes: the older way (Blobs) moved over; a photo whose file is lost says so, then comes back from Drive', async () => {
  const script = fakeScript(); const URL_ = 'https://script.google.com/macros/s/test/exec'; let down = false;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(([u]) => { localStorage.setItem('cc.savedFiles', JSON.stringify({ url: u, key: 'k'.repeat(24) })); }, [URL_]);
  await ctx.route(URL_, async (route) => (down ? route.abort('internetdisconnected') : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(script.handle(JSON.parse(route.request().postData()))) })));
  const page = await ctx.newPage(); await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  // (The app's storage, read or changed directly: `op` 'get' or 'delete' on `key`.)
  const kv = (op, key) => page.evaluate(([o, k]) => new Promise((res) => { const r = indexedDB.open('command-center'); r.onsuccess = () => { const q = r.result.transaction('kv', 'readwrite').objectStore('kv')[o](k); q.onsuccess = () => res(o === 'get' ? (q.result && (q.result.ct ? { bytes: q.result.ct.byteLength, enc: !!q.result.enc } : q.result.buf ? { bytes: q.result.buf.byteLength } : q.result.posts ? { image: q.result.posts[0].image === undefined ? 'none' : 'kept' } : null)) : true); q.onerror = () => res(null); }; r.onerror = () => res(null); }), [op, key]);
  // (Kept the older way, before this version: a Blob inside the one key.)
  down = true;
  const png = (await photo(page)).buffer.toString('base64');
  await page.evaluate(([b64]) => new Promise((res) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); const blob = new Blob([bytes], { type: 'image/png' }); const st = { accounts: [{ id: 'a1', handle: 'kikiparty', owner: true, following: [], at: 1, upd: 1 }], posts: [{ id: 'p1', by: 'a1', image: blob, imageId: 'img1', caption: 'From before', at: 2, upd: 2, likes: [], comments: [] }], me: 'a1' }; const r = indexedDB.open('command-center', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const t = r.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(st, 'cc.socials'); t.oncomplete = res; }; }), [png]);
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.locator('.so-post', { hasText: 'From before' }).waitFor();
  assert.ok(await page.locator('.so-post .so-pic img').evaluate((i) => i.decode().then(() => i.naturalWidth > 0)), 'shown');
  const m1 = await kv('get', 'cc.socials.m.img1'); assert.ok(m1?.bytes > 0 && m1.enc, 'its bytes kept on their own, encrypted');
  assert.equal((await kv('get', 'cc.socials'))?.enc, true, 'the state encrypted (no Blob, nothing readable)');
  // (Nothing of it readable as it's kept: the caption not in the stored bytes.)
  assert.equal(await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('command-center'); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('cc.socials'); q.onsuccess = () => res(new TextDecoder().decode(q.result.ct).includes('From before')); }; })), false);
  // Sent to Drive; then its file lost on this device: the post says so (Drive unreachable), then gets it back.
  down = false; await page.getByRole('button', { name: /Sync and password/ }).click(); await page.getByRole('button', { name: 'Sync now' }).click();
  await page.getByText('Your recovery key').waitFor({ timeout: 60000 }); await page.getByRole('button', { name: 'I\'ve saved it' }).click();
  assert.ok(script.files.some((f) => f.name === 'socials-m-img1.ccs'));
  await kv('delete', 'cc.socials.m.img1');
  down = true; await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByRole('button', { name: 'Open' }).click();
  await page.getByText('This photo couldn\'t be loaded on this device').waitFor();
  assert.equal(await page.locator('.so-post img[src^="blob:"]').count(), 0, 'no broken picture');
  down = false; await page.getByRole('button', { name: /Sync and password/ }).click(); await page.getByRole('button', { name: 'Sync now' }).click();
  await page.waitForFunction(() => /^Synced/.test(document.querySelector('.so-sync-msg')?.textContent ?? ''));
  await page.getByRole('button', { name: 'Home' }).click();
  await page.locator('.so-post .so-pic img').waitFor();
  assert.ok(await page.locator('.so-post .so-pic img').evaluate((i) => i.decode().then(() => i.naturalWidth > 0)), 'back from Drive');
  assert.ok((await kv('get', 'cc.socials.m.img1'))?.bytes > 0, 'and kept again');
  await ctx.close();
});

test('Socials: tag accounts in a post (and @mention them), share it in a DM, and on the Owner account open any photo in the Photo Editor, FM or Fashion', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click(); await page.getByLabel('Username', { exact: true }).fill('pal'); await page.getByRole('button', { name: 'Create account' }).click();
  // As pal: a photo, tagging the Owner, mentioning them in the caption.
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles(await photo(page)); await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-new-prev img').waitFor();
  await page.getByLabel('Caption').fill('Beach day with @owner.me!');
  await page.getByRole('button', { name: /^👤 Tag/ }).click();
  await page.getByRole('group', { name: 'Tag people' }).getByRole('button', { name: '@owner.me' }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.locator('.so-post .so-tags', { hasText: 'with owner.me' }).waitFor();
  assert.equal(await page.locator('.so-post .so-caption .so-mention').textContent(), 'owner.me', 'the @mention a link');
  // Shared to the Owner in a DM.
  await page.getByRole('button', { name: 'Share', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Send to' }).getByRole('button', { name: '@owner.me (Owner)' }).click();
  await page.getByText('Sent to @owner.me').waitFor();
  // The Owner: the post in their Tagged grid, the shared post in their messages, opening it.
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  await page.getByRole('button', { name: 'Profile' }).click(); await page.getByRole('tab', { name: 'Tagged' }).click();
  assert.equal(await page.locator('.so-grid .so-tile').count(), 1, 'in their Tagged posts');
  await page.getByRole('button', { name: 'Messages, 1 unread' }).click();
  assert.match(await page.locator('.so-person').first().textContent(), /Shared a post/);
  await page.getByRole('button', { name: /Chat with @pal/ }).click();
  await page.getByRole('button', { name: /Shared post by @pal/ }).click();
  await page.locator('.so-post', { hasText: 'Beach day' }).waitFor();
  // Owner: ⋯ → Open in… → Fashion → the piece: Fashion opens (behind the hidden area's password) with it.
  await page.getByRole('button', { name: 'Post options' }).click();
  await page.getByRole('dialog', { name: 'Post options' }).getByRole('button', { name: 'Open in…' }).click();
  const apps = await page.getByRole('dialog', { name: 'Open in' }).getByRole('button').allTextContents();
  assert.deepEqual(apps, ['🖼️ Photo Editor', '🎭 FM', '👕 Fashion', 'Cancel']);
  await page.getByRole('dialog', { name: 'Open in' }).getByRole('button', { name: '🖼️ Photo Editor' }).click();
  await page.waitForFunction(() => location.hash === '#/files/photo');
  await page.locator('#view-app canvas').first().waitFor({ timeout: 20000 });
  // (Not offered to an account that isn't the Owner, on someone else's post.)
  // (Back in Socials in the same session: still open, no password asked.)
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @pal' }).click();
  await page.locator('.so-post').first().waitFor();
  await page.getByRole('button', { name: 'Post options' }).first().click();
  assert.equal(await page.getByRole('dialog', { name: 'Post options' }).getByRole('button', { name: 'Open in…' }).count(), 0, 'pal (not the Owner): no Open in');
  await page.close();
});

test('Socials: several photos and a video in one post (a carousel), and Reels shuffled, again on a pull down at the top', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  // Two photos picked at once (each through the editor), then a video added: three in one post.
  await page.getByRole('button', { name: 'New post' }).first().click();
  const p1 = await photo(page); const p2 = { ...(await photo(page)), name: 'b.png' };
  await page.getByLabel('Photo or video').setInputFiles([p1, p2]);
  for (let i = 0; i < 2; i++) {
    const d = page.getByRole('dialog', { name: 'Edit photo' }); await d.waitFor(); const h = await d.elementHandle();
    await d.getByRole('button', { name: 'Done' }).click(); await page.waitForFunction((e) => !e.isConnected, h);
  }
  await page.getByLabel('Add more photos or videos').setInputFiles(await clip(page));
  await page.locator('.so-mrow[data-status="ready"]').nth(2).waitFor();
  assert.equal(await page.locator('.so-mrow').count(), 3);
  await page.getByRole('button', { name: 'Remove 2' }).click();
  assert.equal(await page.locator('.so-mrow').count(), 2, 'one taken out');
  await page.getByLabel('Caption').fill('A day out'); await page.getByRole('button', { name: 'Share', exact: true }).click();
  const post = page.locator('.so-post', { hasText: 'A day out' }); await post.waitFor();
  assert.equal(await post.locator('.so-slide').count(), 2, 'a carousel of two');
  assert.equal(await post.locator('.so-count').textContent(), '1/2');
  await post.locator('.so-carousel').evaluate((t) => { t.scrollLeft = t.clientWidth; t.dispatchEvent(new Event('scroll')); });
  await page.waitForFunction(() => document.querySelector('.so-count')?.textContent === '2/2');
  assert.equal(await post.locator('.so-slide').nth(1).locator('video').count(), 1, 'the video second');
  // Reels: six videos; the order shuffled, and shuffled again on a pull down at the top.
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'New post' }).first().click();
    await page.getByLabel('Photo or video').setInputFiles(await clip(page)); await page.locator('.so-new-prev video').first().waitFor();
    await page.getByLabel('Caption').fill(`Reel ${i}`); await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.locator('.so-reel').first().waitFor();
  }
  const order = () => page.locator('.so-reel').evaluateAll((els) => els.map((e) => e.dataset.post));
  const first = await order(); assert.equal(first.length, 5, 'only posts that start with a video');
  let changed = false;
  for (let t = 0; t < 4 && !changed; t++) {
    const box = await page.locator('.so-reels').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 30); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 8 }); await page.mouse.up();
    await page.getByText('Shuffled').first().waitFor();
    const now = await order(); assert.deepEqual([...now].sort(), [...first].sort(), 'the same reels'); changed = now.join() !== first.join();
  }
  assert.ok(changed, 'a new order after pulling down');
  await page.close();
});

test('Socials: stories (new posts, on their circle), drafts, pinning, Recently deleted, comments on new posts, hashtags, and a zip of an account', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  for (const h of ['ann', 'ben', 'cat']) { await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click(); await page.getByLabel('Username', { exact: true }).fill(h); await page.getByRole('button', { name: 'Create account' }).click(); }
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  const newPhoto = async (cap, { draft = false } = {}) => {
    await page.getByRole('button', { name: 'New post' }).first().click();
    await page.getByLabel('Photo or video').setInputFiles(await photo(page)); await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
    await page.locator('.so-new-prev img').waitFor(); await page.getByLabel('Caption').fill(cap);
    await page.getByRole('button', { name: draft ? 'Save as draft' : 'Share', exact: true }).click();
  };
  // A draft: not shared; then opened and shared.
  await newPhoto('Sunset at the #beach', { draft: true });
  await page.getByRole('tab', { name: /Drafts \(1\)/ }).waitFor();
  await page.getByRole('button', { name: 'Home' }).click();
  assert.equal(await page.locator('.so-post').count(), 0, 'a draft isn\'t in the feed');
  await page.getByRole('button', { name: 'Profile' }).click(); await page.getByRole('tab', { name: /Drafts/ }).click();
  await page.getByRole('button', { name: /^Draft by owner\.me/ }).click();
  assert.equal(await page.getByLabel('Caption').inputValue(), 'Sunset at the #beach');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const post = page.locator('.so-post', { hasText: 'Sunset at the' }); await post.waitFor();
  // (Three of the other accounts said something nice.)
  assert.equal(await post.locator('.so-comment').count(), 2, 'two shown in the feed');
  assert.match(await post.getByRole('button', { name: 'View all 3 comments' }).textContent(), /3/);
  // The hashtag: a link to its posts.
  await post.getByRole('button', { name: '#beach' }).click();
  await page.getByText('1 post', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Search' }).click(); await page.getByLabel('Search accounts and hashtags').fill('#bea');
  await page.getByRole('button', { name: /#beach/ }).waitFor();
  // A second post; pin the first: first on the profile, 📌.
  await page.getByRole('button', { name: 'Home' }).click();
  await newPhoto('Second one');
  await page.locator('.so-post', { hasText: 'Sunset at the' }).getByRole('button', { name: 'Post options' }).click();
  await page.getByRole('button', { name: 'Pin to profile' }).click();
  await page.getByRole('button', { name: 'Profile' }).click();
  assert.match(await page.locator('.so-grid .so-tile').first().getAttribute('aria-label'), /\(pinned\): Sunset/);
  // Stories: the Owner's ring; tapping their circle opens them; as seen after.
  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: "@owner.me's story, new" }).click();
  const sv = page.getByRole('dialog', { name: 'Stories' }); await sv.waitFor();
  assert.equal(await sv.locator('.so-sv-bar').count(), 2, 'both posts of today');
  await sv.getByRole('button', { name: 'Next' }).click(); await sv.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: "@owner.me's story" }).waitFor();
  assert.equal(await page.getByRole('button', { name: "@owner.me's story, new" }).count(), 0, 'seen');
  // Delete → Recently deleted (7 days) → restored.
  await page.locator('.so-post', { hasText: 'Second one' }).getByRole('button', { name: 'Post options' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText('Deleted: in Recently deleted for 7 days').waitFor();
  assert.equal(await page.locator('.so-post', { hasText: 'Second one' }).count(), 0);
  await page.getByRole('button', { name: /Sync and password/ }).click();
  await page.getByText('Recently deleted (1)').waitFor(); assert.match(await page.locator('.so-trash-row').textContent(), /7 days left/);
  await page.getByRole('button', { name: "Restore @owner.me's post" }).click();
  await page.getByRole('button', { name: 'Home' }).click(); await page.locator('.so-post', { hasText: 'Second one' }).waitFor();
  // A zip of the Owner's photos (each post's file and a list of captions).
  await page.getByRole('button', { name: 'Profile' }).click();
  const dl = page.waitForEvent('download'); await page.getByRole('button', { name: "Download @owner.me's photos and videos" }).click();
  const file = await dl; assert.equal(file.suggestedFilename(), 'owner.me-socials.zip');
  const bytes = await readFile(await file.path());
  const names = []; for (let i = 0; i + 30 < bytes.length; i++) if (bytes.readUInt32LE(i) === 0x04034b50) { const n = bytes.readUInt16LE(i + 26); names.push(bytes.subarray(i + 30, i + 30 + n).toString()); }
  assert.equal(names.filter((n) => /\.(jpg|png)$/.test(n)).length, 2, `two photos: ${names}`); assert.ok(names.includes('captions.txt'));
  await ctx.close();
});

test('Socials collab: invite while posting; a collab request in their messages; accepted, the same post on both profiles, "a and b"', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click(); await page.getByLabel('Username', { exact: true }).fill('pal'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles(await photo(page)); await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-new-prev img').waitFor(); await page.getByLabel('Caption').fill('Made together');
  await page.getByRole('button', { name: /^🤝 Collab/ }).click();
  await page.getByRole('group', { name: 'Collab' }).getByRole('button', { name: 'Collab with @pal' }).click();
  // (Collab tags them too.)
  assert.match(await page.getByRole('button', { name: /^👤 Tag/ }).textContent(), /· 1/);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.locator('.so-post', { hasText: 'Made together' }).waitFor();
  assert.doesNotMatch(await page.locator('.so-post-head').first().textContent(), /and pal/, 'not until pal accepts');
  // As pal: the request, accepted.
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @pal' }).click();
  await page.getByRole('button', { name: 'Messages, 1 unread' }).click();
  assert.match(await page.locator('.so-person').first().textContent(), /Collab request/);
  await page.getByRole('button', { name: /Chat with @owner\.me/ }).click();
  await page.getByText('@owner.me invited you to collaborate on this post').waitFor();
  await page.getByRole('button', { name: 'Accept' }).click();
  await page.getByText('You accepted: it\'s on your profile').waitFor();
  // On pal's profile, the same post, "owner.me and pal".
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Profile' }).click();
  assert.equal(await page.locator('.so-grid .so-tile').count(), 1, 'on pal\'s profile');
  await page.locator('.so-grid .so-tile').first().click();
  assert.match(await page.locator('.so-post-head').textContent(), /owner\.me and pal/);
  // pal leaves it: off pal's profile.
  await page.getByRole('button', { name: 'Post options' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Remove me from this collab' }).click();
  await page.getByRole('button', { name: 'Profile' }).click();
  assert.equal(await page.locator('.so-grid .so-tile').count(), 0, 'left');
  await page.close();
});

test('Socials: 🔖 saved posts (in your own Saved tab), and views counted (feed, a post opened from a profile, once per account while the app\'s open)', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles(await photo(page)); await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-new-prev img').waitFor(); await page.getByLabel('Caption').fill('Worth keeping'); await page.getByRole('button', { name: 'Share', exact: true }).click();
  const post = page.locator('.so-post', { hasText: 'Worth keeping' }); await post.waitFor();
  // (Seen in the feed for a second: one view.)
  await post.locator('.so-views').waitFor({ timeout: 8000 });
  assert.match(await post.locator('.so-views').textContent(), /1 view$/);
  // Saved: in the Saved tab.
  await post.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved (your profile → 🔖)').waitFor();
  await page.getByRole('button', { name: 'Profile' }).click(); await page.getByRole('tab', { name: 'Saved' }).click();
  assert.equal(await page.locator('.so-grid .so-tile').count(), 1);
  // Opened again by the same account: not counted again; by another account: counted.
  await page.locator('.so-grid .so-tile').first().click();
  assert.match(await page.locator('.so-views').textContent(), /1 view$/, 'the same account, once');
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click(); await page.getByLabel('Username', { exact: true }).fill('pal'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Search' }).click(); await page.locator('.so-grid .so-tile').first().click();
  assert.match(await page.locator('.so-views').textContent(), /2 views$/, 'another account: counted');
  // (pal's Saved: their own, empty.)
  await page.getByRole('button', { name: 'Profile' }).click(); await page.getByRole('tab', { name: 'Saved' }).click();
  assert.equal(await page.locator('.so-grid .so-tile').count(), 0);
  await page.close();
});

test('Socials: Tag and Collab folded and alphabetical, collab tags too; # Community hashtags by use; the account list by unread then last used; ✨ generated comments and DM replies (Owner only)', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  for (const h of ['zed', 'amy', 'mo']) { await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click(); await page.getByLabel('Username', { exact: true }).fill(h); await page.getByRole('button', { name: 'Create account' }).click(); }
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  // Two posts with hashtags: #beach twice, #sun once.
  const newPhoto = async (cap) => {
    await page.getByRole('button', { name: 'New post' }).first().click();
    await page.getByLabel('Photo or video').setInputFiles(await photo(page)); await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
    await page.locator('.so-new-prev img').waitFor(); await page.getByLabel('Caption').fill(cap);
  };
  await newPhoto('Waves #beach #sun 🌊'); await page.getByRole('button', { name: 'Share', exact: true }).click(); await page.locator('.so-post', { hasText: 'Waves' }).first().waitFor();
  await newPhoto('Again #beach'); await page.getByRole('button', { name: 'Share', exact: true }).click(); await page.locator('.so-post', { hasText: 'Again' }).first().waitFor();
  await newPhoto('Pizza night 🍕');
  assert.equal(await page.getByRole('group', { name: 'Tag people' }).count(), 0, 'folded until opened');
  await page.getByRole('button', { name: /^👤 Tag/ }).click();
  assert.deepEqual(await page.getByRole('group', { name: 'Tag people' }).getByRole('button').allTextContents(), ['@amy', '@mo', '@zed'], 'alphabetical');
  await page.getByRole('button', { name: /^# Community/ }).click();
  assert.deepEqual((await page.getByRole('group', { name: 'Hashtags used before' }).getByRole('button').allTextContents()).map((t) => t.split(' ')[0]), ['#beach', '#sun'], 'the most used first');
  await page.getByRole('group', { name: 'Hashtags used before' }).getByRole('button', { name: /#sun/ }).click();
  assert.equal(await page.getByLabel('Caption').inputValue(), 'Pizza night 🍕 #sun');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  // ✨ Generate comment on the post (as @mo, picked).
  const post = page.locator('.so-post', { hasText: 'Pizza night' }).first(); await post.waitFor();
  await post.getByRole('button', { name: 'Comments', exact: true }).click();
  await page.getByLabel('Comment as').selectOption({ label: '@mo' });
  await page.getByRole('button', { name: 'Generate 1 comment' }).click();
  await page.locator('.so-comment', { hasText: 'mo' }).first().waitFor();
  // DMs: the Owner writes to amy; amy answers by herself (typing… first), to what was said.
  await page.getByRole('button', { name: 'Messages' }).first().click();
  await page.getByRole('button', { name: 'Message @amy' }).click();
  await page.getByLabel('Message', { exact: true }).fill('Thank you so much! 🎉'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByLabel('@amy is typing').waitFor();
  assert.equal(await page.getByRole('button', { name: /Generate reply/ }).count(), 0, 'a reply on its way: no button');
  // (Its reply: one message or two; all in once "typing" is gone.)
  const theirs = page.locator('.so-bubble:not(.mine):not(.so-typing)');
  const settled = async () => { await page.waitForFunction(() => !document.querySelector('.so-typing'), null, { timeout: 12000 }); return (await theirs.allTextContents()).join(' '); };
  await theirs.first().waitFor({ timeout: 8000 });
  assert.match(await settled(), /Anytime|Of course|Always|problem|welcome|Aww|Yay|Love|amazing|No way|OMG|really/i);
  // And from the conversation: asked back, it answers about itself.
  const before = await theirs.count();
  await page.getByLabel('Message', { exact: true }).fill('how are you?'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.so-bubble:not(.mine):not(.so-typing)').length > n, before, { timeout: 8000 });
  await settled();
  assert.match((await theirs.allTextContents()).slice(before).join(' '), /good|great|not bad|chilling|gym|dinner|movie|home|coffee|working|cleaning|walk|phone/i);
  // The account list: last used first (mo was made last, then amy (just replied), then zed)…
  const order = async () => (await page.locator('.so-person-main').evaluateAll((l) => l.map((e) => e.getAttribute('aria-label')))).map((t) => t.replace(/^Use @/, '').replace(/ \(Owner\)$/, ''));
  await page.getByRole('button', { name: 'Back', exact: true }).first().click(); // (a chat fills the screen: back to switch accounts)
  await page.locator('.so-switch').click();
  assert.deepEqual(await order(), ['owner.me', 'mo', 'amy', 'zed']);
  // …but one with an unread message goes to the top (below the Owner).
  await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  await page.getByRole('button', { name: 'Messages' }).first().click(); await page.getByRole('button', { name: 'Message @zed' }).click();
  await page.getByLabel('Message', { exact: true }).fill('hi zed'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await page.locator('.so-switch').click();
  assert.deepEqual(await order(), ['owner.me', 'zed', 'mo', 'amy']);
  await page.getByRole('button', { name: 'Use @amy' }).click(); await page.locator('.so-switch').click();
  assert.deepEqual(await order(), ['owner.me', 'zed', 'amy', 'mo'], 'used: amy up');
  // As mo, no Generate buttons (the Owner only).
  await page.getByRole('button', { name: 'Use @mo' }).click();
  await page.getByRole('button', { name: 'Search' }).click(); await page.locator('.so-grid .so-tile').first().click();
  await page.locator('.so-post').first().waitFor();
  assert.equal(await page.getByRole('button', { name: /^Generate \d comment/ }).count(), 0);
  await page.close();
});

test('Socials: + Add New under the Owner; Friends and Celebrities listed apart; a new profile photo posted whole; a custom crop shape, the frame dragged over the photo', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  // A celebrity, with a profile photo (a wide one: it's posted whole, not the square crop).
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click();
  const wide = await page.evaluate(async () => { const c = new OffscreenCanvas(300, 100); const x = c.getContext('2d'); x.fillStyle = '#36c'; x.fillRect(0, 0, 300, 100); const b = await c.convertToBlob({ type: 'image/png' }); const s = new Uint8Array(await b.arrayBuffer()); let t = ''; for (const v of s) t += String.fromCharCode(v); return btoa(t); });
  await page.getByLabel('Profile picture').setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: Buffer.from(wide, 'base64') });
  await page.getByRole('dialog', { name: 'Profile photo' }).getByRole('button', { name: 'Done' }).click();
  await page.getByLabel('Username', { exact: true }).fill('star');
  await page.getByRole('radio', { name: '⭐ Celebrity' }).click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-post', { hasText: 'New profile picture' }).waitFor();
  const dims = await page.locator('.so-post', { hasText: 'New profile picture' }).locator('.so-pic img').first().evaluate((im) => new Promise((ok) => { if (im.complete) ok([im.naturalWidth, im.naturalHeight]); else im.onload = () => ok([im.naturalWidth, im.naturalHeight]); }));
  assert.equal(dims[0] / dims[1], 3, `posted whole (3:1), not cropped: ${dims}`);
  // A friend.
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click();
  await page.getByLabel('Username', { exact: true }).fill('pal'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-switch').click();
  assert.deepEqual(await page.locator('.so-section').allTextContents(), ['Owner', 'Friends · 1', 'Celebrities · 1']);
  const sections = await page.evaluate(() => [...document.querySelectorAll('.so-section')].map((h) => [h.textContent, h.nextElementSibling?.textContent ?? '']));
  assert.match(sections[1][1], /pal/); assert.match(sections[2][1], /star/);
  // A post with a custom crop: 3:1 of a 64×48 photo.
  await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles(await photo(page));
  const dlg = page.getByRole('dialog', { name: 'Edit photo' });
  await dlg.getByRole('button', { name: 'Custom' }).click();
  await dlg.getByLabel('Custom width').fill('3'); await dlg.getByLabel('Custom height').fill('1');
  assert.equal(await dlg.locator('.se-cropbox').isVisible(), true, 'the frame shows over the whole photo');
  const fb = await dlg.locator('.se-cropbox').boundingBox(); const cb = await dlg.locator('.se-canvas').boundingBox();
  assert.ok(Math.abs(fb.width / fb.height - 3) < 0.1 && fb.width <= cb.width + 1, 'a 3:1 frame inside the photo');
  await dlg.getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-new-prev img').waitFor();
  const nd = await page.locator('.so-new-prev img').evaluate((im) => new Promise((ok) => { if (im.complete) ok([im.naturalWidth, im.naturalHeight]); else im.onload = () => ok([im.naturalWidth, im.naturalHeight]); }));
  assert.ok(Math.abs(nd[0] / nd[1] - 3) < 0.1, `cropped 3:1: ${nd}`);
  await page.close();
});

test('Socials opens to its Sports front: games as posts in team colors (final, live), filtered by league, updated as games go on; Admin leads to the accounts', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const team = (abbr, name, short, color, alt) => ({ abbreviation: abbr, displayName: name, shortDisplayName: short, color, alternateColor: alt });
  const L = (name, short, who, v) => ({ name, shortDisplayName: short, leaders: [{ displayValue: v, athlete: { shortName: who } }] });
  const ev = (id, state, detail, hs, as, home, away, extra = {}) => ({ id, date: new Date(Date.now() - 3600e3).toISOString(), competitions: [{ status: { type: { state, completed: state === 'post', shortDetail: detail } }, headlines: [], leaders: extra.leaders ?? [], competitors: [
    { homeAway: 'home', team: home, score: hs, records: [{ summary: '12-5' }], leaders: extra.hl ?? [] }, { homeAway: 'away', team: away, score: as, records: [{ summary: '10-7' }], leaders: [] }] }] });
  const DEN = team('DEN', 'Denver Nuggets', 'Nuggets', '0e2240', 'fec524'); const LAL = team('LAL', 'Los Angeles Lakers', 'Lakers', '552583', 'fdb927');
  let nbaState = 'in';
  await page.route('https://site.api.espn.com/**', (r) => {
    const u = r.request().url();
    const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const today = ymd(new Date()); const yest = ymd(new Date(Date.now() - 86400e3));
    const body = u.includes('/nba/') && u.endsWith(`dates=${today}`) ? { events: [nbaState === 'in' ? ev('1', 'in', '3rd 4:12', '78', '71', DEN, LAL, { hl: [L('points', 'PTS', 'N. Jokic', '24')] }) : ev('1', 'post', 'Final', '112', '104', DEN, LAL, { hl: [L('points', 'PTS', 'N. Jokic', '34')] })] }
      : u.includes('/nhl/') && u.endsWith(`dates=${yest}`) ? { events: [ev('2', 'post', 'Final/SO', '3', '2', team('COL', 'Colorado Avalanche', 'Avalanche', '6f263d', '236192'), team('DAL', 'Dallas Stars', 'Stars', '006847', '8f8f8c'))] }
      : { events: [] };
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await page.goto(`${origin}${BASE}index.html#/socials`);
  const nba = page.locator('.sp-post[data-id="nba:1"]');
  await nba.waitFor();
  assert.match(await nba.locator('.sp-state').textContent(), /LIVE · 3rd 4:12/);
  assert.match(await nba.locator('.sp-caption').textContent(), /Lakers 71, Nuggets 78/);
  const bg = await nba.locator('.sp-card').evaluate((c) => c.style.background);
  assert.match(bg, /rgb\(85, 37, 131\).*rgb\(14, 34, 64\)/, 'the two teams\' colors');
  assert.ok(await page.locator('.sp-post[data-id^="nhl:"]').count() >= 1, 'yesterday\'s NHL final');
  // Only the NHL.
  await page.getByRole('tab', { name: /NHL/ }).click();
  assert.equal(await page.locator('.sp-post[data-id^="nba:"]').count(), 0);
  await page.getByRole('tab', { name: /All/ }).click();
  // The game ends; on the next update its post is the final, with the stat leaders.
  nbaState = 'post';
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.waitForFunction(() => /FINAL/.test(document.querySelector('.sp-post[data-id="nba:1"] .sp-state')?.textContent ?? ''));
  assert.equal(await nba.locator('.sp-caption').textContent(), 'NBA Nuggets beat Lakers 112-104, behind N. Jokic\'s 34 PTS.');
  assert.match(await nba.locator('.sp-lteam', { hasText: 'Nuggets' }).textContent(), /PTS.*N\. Jokic.*34/);
  // Like.
  await nba.getByRole('button', { name: 'Like' }).click();
  assert.equal(await nba.getByRole('button', { name: 'Unlike' }).count(), 1);
  // ⚙ → Admin: Socials' own password, then the accounts.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Admin' }).click();
  await page.getByLabel('Password', { exact: true }).waitFor();
  assert.equal(await page.locator('.sp-feed').count(), 0, 'the front gone');
  assert.deepEqual(errors, []);
  await page.close();
});

test('Socials: two videos in one post: Reels plays them one after the other (a bar for each); from the profile the post opens to swipe through; a progress bar while posting', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  const a = await clip(page); const b = { ...(await clip(page)), name: 'clip2.webm' };
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles([a, b]);
  await page.locator('.so-mrow[data-status="ready"]').nth(1).waitFor({ timeout: 20000 });
  await page.getByLabel('Caption').fill('Two clips');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  // (The progress bar: posted.)
  await page.locator('.so-upbar', { hasText: 'Posted' }).waitFor();
  // Reels: the first clip with two bars, then the second.
  await page.locator('.so-reel-segs').waitFor();
  assert.equal(await page.locator('.so-reel-seg').count(), 2);
  await page.waitForFunction(() => document.querySelector('.so-reel-video')?.dataset.clip === '1', null, { timeout: 15000 });
  assert.match(await page.locator('.so-reel-video').getAttribute('aria-label'), /2 of 2/);
  // The profile: its tile opens the post, two slides to swipe through.
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.locator('.so-grid .so-tile').first().click();
  await page.locator('.so-carousel').waitFor();
  assert.equal(await page.locator('.so-carousel .so-slide').count(), 2);
  assert.equal(await page.locator('.so-carousel video').count(), 2);
  await page.locator('.so-carousel').evaluate((t) => t.scrollTo({ left: t.clientWidth }));
  await page.waitForFunction(() => document.querySelector('.so-count')?.textContent === '2/2');
  await page.close();
});

test('Socials: each file shown loading then ready; reordered by dragging (or ↑ ↓); Edit post adds, removes and reorders; the Owner tagged in new posts; 3 comments generated at once', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  for (const h of ['amy', 'bo', 'cy']) {
    await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click();
    await page.getByLabel('Username', { exact: true }).fill(h); await page.getByRole('button', { name: 'Create account' }).click();
  }
  // As cy (not the Owner): a video and a photo; each listed with its status, then ready.
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles([await clip(page), { ...(await photo(page)), name: 'pic.png' }]);
  await page.locator('.so-mrow').nth(1).waitFor();
  assert.match(await page.locator('.so-mrow').nth(1).textContent(), /pic\.png/);
  await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-mrow[data-status="ready"]').nth(1).waitFor({ timeout: 20000 });
  assert.match(await page.locator('.so-mrow').first().textContent(), /Video.*Ready ✓/);
  // The photo moved first: by its handle, dragged up.
  const handle = page.locator('.so-mrow').nth(1).locator('.drag-handle'); const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y - 60, { steps: 6 }); await page.mouse.up();
  assert.match(await page.locator('.so-mrow').first().textContent(), /1\. Photo/);
  assert.match(await page.getByRole('button', { name: /^👤 Tag/ }).textContent(), /1/, 'the Owner tagged already');
  // ✨ Suggest caption: made from the photo (read on the phone), with hashtags; again for another.
  await page.getByRole('button', { name: '✨ Suggest caption' }).click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Caption"]')?.value.includes('#'), null, { timeout: 30000 });
  await page.getByLabel('Caption').fill('Trip to Denver #mountains');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const post = page.locator('.so-post', { hasText: 'Trip to Denver' }).first(); await post.waitFor();
  assert.match(await post.textContent(), /owner\.me/, 'the Owner tagged');
  assert.equal(await post.locator('.so-slide').first().locator('img').count(), 1, 'the photo first');
  // Edit post: a photo added, the video removed, the new photo moved up (↑ on its handle).
  await post.getByRole('button', { name: /More|Post options|⋯/ }).first().click();
  await page.getByRole('button', { name: /Edit/ }).first().click();
  await page.locator('.so-mrow').nth(1).waitFor();
  await page.getByLabel('Add more photos or videos').setInputFiles({ ...(await photo(page)), name: 'new.png' });
  await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-mrow[data-status="ready"]').nth(2).waitFor();
  await page.getByRole('button', { name: 'Remove 2' }).click();
  await page.locator('.so-mrow').nth(1).locator('.drag-handle').focus(); await page.keyboard.press('ArrowUp');
  assert.match(await page.locator('.so-mrow').first().textContent(), /new\.png/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const edited = page.locator('.so-post', { hasText: 'Trip to Denver' }).first(); await edited.waitFor();
  assert.equal(await edited.locator('.so-slide').count(), 2, 'two photos now');
  assert.equal(await edited.locator('video').count(), 0, 'the video gone');
  // As the Owner: 3 comments at once, each from a different account.
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  await page.getByRole('button', { name: 'Search' }).click(); await page.locator('.so-grid .so-tile').first().click();
  await page.getByRole('button', { name: 'Generate 3 comments' }).click();
  await page.locator('.so-comment:not(.so-reply)').nth(2).waitFor();
  const comments = await page.locator('.so-comment:not(.so-reply)').allTextContents();
  assert.equal(new Set(comments).size, comments.length, 'all different');
  // (Its account's answers to them: none the same.)
  await page.waitForTimeout(500); const answers = (await page.locator('.so-comment.so-reply').allTextContents()).map((t) => t.replace(/\s*@\S+/, ''));
  assert.equal(new Set(answers).size, answers.length, `its answers all different: ${answers.join(' | ')}`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Socials: picking and posting a video never widens the page (nothing pushed off to the right, no zoom change)', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  const widths = []; const measure = async (at) => widths.push([at, await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))]);
  await page.getByRole('button', { name: 'New post' }).first().click(); await measure('new');
  const v = { ...(await clip(page)), name: 'IMG_20261125_183455_very_long_icloud_drive_video_file_name_copy_2.webm' };
  await page.getByLabel('Photo or video').setInputFiles([v, { ...v, name: `B_${v.name}` }]);
  await page.locator('.so-mrow').first().waitFor(); await measure('loading');
  await page.locator('.so-mrow[data-status="ready"]').nth(1).waitFor({ timeout: 20000 }); await measure('ready');
  // (The preview held to its frame: inside the page's width, not over the buttons.)
  const vb = await page.locator('.so-new-prev video').boundingBox(); const fb = await page.locator('.so-new-prev').boundingBox();
  assert.ok(vb.x >= fb.x - 1 && vb.x + vb.width <= fb.x + fb.width + 1 && vb.y + vb.height <= fb.y + fb.height + 1, 'the video inside its frame');
  // (A video read from several of its frames: a caption suggested from them.)
  const frames = await page.evaluate(async () => { const { videoFrames } = await import('./apps/socials/socials-editor.js'); const v = document.querySelector('.so-new-prev video'); const b = await (await fetch(v.src)).blob(); return (await videoFrames(b)).length; });
  assert.ok(frames >= 2, `several frames (${frames})`);
  // (Auto-caption: written in from the video once it's read, while the caption's empty and untouched.)
  await page.locator('.so-autocap').waitFor({ timeout: 40000 });
  assert.ok((await page.getByLabel('Caption').inputValue()).length > 3, 'a caption written in');
  await page.getByRole('button', { name: '✨ Suggest caption' }).click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Caption"]')?.value.length > 3, null, { timeout: 30000 }); await measure('caption');
  await page.getByRole('button', { name: 'Share', exact: true }).click(); await measure('sharing');
  await page.locator('.so-reel').first().waitFor(); await measure('reels');
  await page.locator('.so-upbar', { hasText: 'Posted' }).waitFor(); await measure('posted');
  for (const [at, w] of widths) assert.ok(w <= 390, `${at}: the page is ${w}px wide`);
  await page.close();
});

test('Socials: ✓ Accept All in Messages accepts every collab request at once', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click(); await page.getByLabel('Username', { exact: true }).fill('pal'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  for (const cap of ['One together', 'Two together']) {
    await page.getByRole('button', { name: 'New post' }).first().click();
    await page.getByLabel('Photo or video').setInputFiles(await photo(page)); await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
    await page.locator('.so-new-prev img').waitFor(); await page.getByLabel('Caption').fill(cap);
    await page.getByRole('button', { name: /^🤝 Collab/ }).click();
    await page.getByRole('group', { name: 'Collab' }).getByRole('button', { name: 'Collab with @pal' }).click();
    await page.getByRole('button', { name: 'Share', exact: true }).click(); await page.locator('.so-post', { hasText: cap }).first().waitFor();
  }
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @pal' }).click();
  await page.getByRole('button', { name: /^Messages/ }).first().click();
  const bar = page.getByRole('group', { name: 'Collab requests' });
  assert.match(await bar.textContent(), /2 collab requests.*@owner\.me/);
  assert.match(await page.getByRole('button', { name: /^Messages/ }).first().getAttribute('aria-label'), /unread/);
  await bar.getByRole('button', { name: 'Accept All' }).click();
  assert.equal(await page.getByRole('group', { name: 'Collab requests' }).count(), 0, 'none left');
  assert.equal(await page.getByRole('button', { name: /^Messages/ }).first().getAttribute('aria-label'), 'Messages', 'their notifications cleared');
  assert.equal(await page.locator('.so-badge-inline').count(), 0, 'no unread chats');
  await page.getByRole('button', { name: /Chat with @owner\.me/ }).click();
  assert.equal(await page.getByText('You accepted: it\'s on your profile').count(), 2);
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Profile' }).click();
  assert.equal(await page.locator('.so-grid .so-tile').count(), 2, 'both on pal\'s profile');
  await page.close();
});

test('Socials: a hashtag taken back out by tapping it again; a video framed (Square) and shown through its frame; ⋯ → Download post: all, or the ones picked', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  // A first post with #sun, so # Community has it.
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles(await photo(page)); await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-new-prev img').waitFor(); await page.getByLabel('Caption').fill('First #sun');
  await page.getByRole('button', { name: 'Share', exact: true }).click(); await page.locator('.so-post', { hasText: 'First' }).first().waitFor();
  // A video and a photo; the video framed square.
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles([await clip(page), { ...(await photo(page)), name: 'pic.png' }]);
  await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-mrow[data-status="ready"]').nth(1).waitFor({ timeout: 20000 });
  await page.getByLabel('Caption').fill('Clip and pic');
  await page.getByRole('button', { name: /^# Community/ }).click();
  const chip = page.getByRole('group', { name: 'Hashtags used before' }).getByRole('button', { name: /#sun/ });
  await chip.click(); assert.equal(await page.getByLabel('Caption', { exact: true }).inputValue(), 'Clip and pic #sun');
  await chip.click(); assert.equal(await page.getByLabel('Caption', { exact: true }).inputValue(), 'Clip and pic', 'tapped again: taken out');
  await page.locator('.so-mrow').first().locator('.so-mrow-thumb').click();
  await page.getByRole('button', { name: '✂︎ Frame video' }).click();
  const fr = page.getByRole('dialog', { name: 'Frame video' }); await fr.waitFor();
  await fr.getByRole('button', { name: 'Square' }).click();
  await fr.getByRole('button', { name: 'Done' }).click();
  assert.match(await page.locator('.so-mrow').first().textContent(), /framed/);
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.locator('.so-reel').first().waitFor();
  const box = await page.locator('.so-reel .so-vfit').first().boundingBox();
  assert.ok(box && Math.abs(box.width - box.height) < 2, `shown square in Reels (${box?.width}×${box?.height})`);
  // ⋯ → Download post: the picker, all or some.
  await page.getByRole('button', { name: 'Profile' }).click(); await page.locator('.so-grid .so-tile').first().click();
  await page.evaluate(() => { navigator.canShare = () => true; navigator.share = async (d) => { window.__shared = d.files.map((f) => f.name); }; });
  const post = page.locator('.so-post', { hasText: 'Clip and pic' }).first(); await post.waitFor();
  await post.getByRole('button', { name: 'Post options' }).click(); await page.getByRole('button', { name: 'Download post…' }).click();
  const dl = page.getByRole('dialog', { name: 'Download post' }); await dl.waitFor();
  assert.equal(await dl.locator('.so-dl-item').count(), 2);
  await dl.getByRole('button', { name: 'Photo 2' }).click();
  await dl.getByRole('button', { name: /Download selected \(1\)/ }).click();
  await page.waitForFunction(() => window.__shared);
  const one = await page.evaluate(() => window.__shared); assert.equal(one.length, 1); assert.match(one[0], /owner\.me_.*_1\.webm/);
  await page.evaluate(() => { window.__shared = null; });
  await post.getByRole('button', { name: 'Post options' }).click(); await page.getByRole('button', { name: 'Download post…' }).click();
  await page.getByRole('dialog', { name: 'Download post' }).getByRole('button', { name: 'Download all (2)' }).click();
  await page.waitForFunction(() => window.__shared);
  assert.equal((await page.evaluate(() => window.__shared)).length, 2);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Socials\' Sports front: a nationally televised NFL game coming up (📺 Primetime); each team\'s players\' stats in a final, by the minimums set in its settings', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const T = (id, abbr, name, short, color) => ({ id, abbreviation: abbr, displayName: name, shortDisplayName: short, color, alternateColor: 'ffffff' });
  const LAR = T('14', 'LAR', 'Los Angeles Rams', 'Rams', '003594'); const GB = T('9', 'GB', 'Green Bay Packers', 'Packers', '204e32');
  const DEN = T('7', 'DEN', 'Denver Broncos', 'Broncos', 'fb4f14'); const KC = T('12', 'KC', 'Kansas City Chiefs', 'Chiefs', 'e31837');
  const lead = (name, who, value) => ({ name, shortDisplayName: name.slice(0, 4).toUpperCase(), leaders: [{ displayValue: value, athlete: { shortName: who.replace(/^(\w)\w*\s/, '$1. '), displayName: who } }] });
  const game = (id, state, date, home, away, hs, as, extra = {}) => ({ id, date, competitions: [{ status: { type: { state, completed: state === 'post', shortDetail: state === 'post' ? 'Final' : '8:20 PM' } }, broadcasts: extra.broadcasts ?? [], headlines: [], leaders: [], competitors: [
    { homeAway: 'home', team: home, score: hs, records: [{ summary: '8-3' }], leaders: state === 'post' ? [lead('passingYards', 'Bo Nix', '22/30, 264 YDS, 2 TD'), lead('receivingYards', 'Courtland Sutton', '6 REC, 98 YDS, 1 TD')] : [] }, { homeAway: 'away', team: away, score: as, records: [{ summary: '7-4' }], leaders: [] }] }] });
  const A = (who, stats, pos) => ({ athlete: { shortName: who, position: { abbreviation: pos } }, stats });
  const box = { boxscore: { players: [
    { team: { id: '7' }, statistics: [{ name: 'passing', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT'], athletes: [A('B. Nix', ['22/30', '264', '8.8', '2', '0'], 'QB')] }, { name: 'rushing', labels: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], athletes: [A('J. Dobbins', ['16', '81', '5.1', '1', '19'], 'RB')] }, { name: 'receiving', labels: ['REC', 'YDS', 'AVG', 'TD', 'LONG'], athletes: [A('C. Sutton', ['6', '98', '16', '1', '41'], 'WR'), A('E. Engram', ['2', '18', '9', '0', '11'], 'TE')] }] },
    { team: { id: '12' }, statistics: [{ name: 'passing', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT'], athletes: [A('P. Mahomes', ['25/38', '241', '6.3', '1', '1'], 'QB')] }, { name: 'receiving', labels: ['REC', 'YDS', 'AVG', 'TD', 'LONG'], athletes: [A('T. Kelce', ['7', '64', '9.1', '0', '18'], 'TE')] }] }] },
    injuries: [{ team: { id: '7' }, injuries: [{ status: 'Out', athlete: { displayName: 'Marvin Mims Jr.', position: { abbreviation: 'WR' } } }, { status: 'Questionable', athlete: { displayName: 'Courtland Sutton' } }] }, { team: { id: '9' }, injuries: [{ status: 'Out', athlete: { displayName: 'Jordan Love', position: { abbreviation: 'QB' } } }] }] };
  await page.route('https://site.api.espn.com/**', (r) => {
    const u = r.request().url();
    const body = u.includes('/nfl/summary') ? box
      : u.includes('/nfl/scoreboard') ? { events: [game('500', 'post', new Date(Date.now() - 5 * 3600e3).toISOString(), DEN, KC, '27', '20'), game('501', 'pre', new Date(Date.now() + 4 * 3600e3).toISOString(), GB, LAR, null, null, { broadcasts: [{ market: 'national', names: ['NBC'] }] }), game('502', 'pre', new Date(Date.now() + 4 * 3600e3).toISOString(), DEN, KC, null, null, { broadcasts: [{ market: 'home', names: ['KDVR'] }] })] }
        : { events: [] };
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await page.goto(`${origin}${BASE}index.html#/socials`);
  const prime = page.locator('.sp-post[data-id="nfl:501"]'); await prime.waitFor();
  assert.match(await prime.locator('.sp-state').textContent(), /PRIMETIME/); assert.equal(await prime.locator('.sp-tv').textContent(), 'NBC');
  assert.match(await prime.locator('.sp-caption').textContent(), /Rams at Packers, .* on NBC\./);
  assert.equal(await page.locator('.sp-post[data-id="nfl:502"]').count(), 0, 'a local-TV game: not until it starts');
  // (Not started: who's out, from the injury report.)
  // (Its post is drawn again once the report's in: scrolled to, whichever copy is there.)
  const into = (sel) => page.evaluate((q) => document.querySelector(q)?.scrollIntoView({ block: 'center' }), sel);
  await into('.sp-post[data-id="nfl:501"]'); await prime.locator('.sp-out').first().waitFor({ timeout: 8000 });
  assert.match(await prime.locator('.sp-out-box').textContent(), /Injury report.*Packers.*🚫 OUT: Jordan Love \(QB\)/);
  await page.getByRole('tab', { name: /Primetime/ }).click();
  assert.deepEqual(await page.locator('.sp-post').evaluateAll((l) => l.map((x) => x.dataset.id)), ['nfl:501']);
  await page.getByRole('tab', { name: /All/ }).click();
  // The final: each team's players over the minimums.
  const fin = page.locator('.sp-post[data-id="nfl:500"]'); await into('.sp-post[data-id="nfl:500"]');
  await fin.locator('.sp-pl-team').first().waitFor({ timeout: 8000 });
  const den = fin.locator('.sp-pl-team', { hasText: 'Broncos' });
  assert.match(await den.textContent(), /B\. Nix QB22\/30, 264 pass yds, 2 TD/); assert.match(await den.textContent(), /C\. Sutton WR6 rec, 98 rec yds, 1 TD/);
  assert.doesNotMatch(await den.textContent(), /Engram/, '18 receiving yards: under 25');
  assert.match(await fin.locator('.sp-pl-team', { hasText: 'Chiefs' }).textContent(), /T\. Kelce/);
  assert.match(await den.locator('.sp-out').textContent(), /🚫 OUT: Marvin Mims Jr\. \(WR\)/, 'out, not the questionable');
  // Leaders by their full names, never cut off.
  const who = fin.locator('.sp-lwho', { hasText: 'Courtland Sutton' }); await who.waitFor();
  assert.ok(await who.evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis'), 'the whole name shows');
  // Settings: receiving yards at least 70: Kelce's 64 out, Sutton's 98 still in.
  await page.getByRole('button', { name: 'Settings' }).click();
  // (Admin first in the settings; rebounds, stocks and 3-pointers among the minimums.)
  assert.equal(await page.locator('.sp-sheet-card > :nth-child(2)').textContent(), '🔐 Admin');
  for (const l of ['rebounds', 'stocks (steals + blocks)', '3-pointers made']) assert.equal(await page.getByLabel(`Least ${l} to show`).count(), 1, l);
  await page.getByLabel('Least receiving yards to show').fill('70'); await page.getByLabel('Least receiving yards to show').dispatchEvent('change');
  await page.getByRole('button', { name: 'Close' }).click();
  assert.doesNotMatch(await fin.locator('.sp-pl-team', { hasText: 'Chiefs' }).textContent(), /Kelce/);
  assert.match(await fin.locator('.sp-pl-team', { hasText: 'Broncos' }).textContent(), /Sutton/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Socials settings: the language slider (Tame → Explicit) kept; AI replies say plainly when the device can\'t run them; face recognition switch', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-sync, [aria-label*="Sync"]').first().click();
  const slider = page.getByLabel('Language: tame to explicit'); await slider.waitFor();
  assert.equal(await slider.inputValue(), '0'); assert.match(await page.locator('.so-level-name').textContent(), /Tame/);
  await slider.fill('3'); assert.match(await page.locator('.so-level-name').textContent(), /Adult/);
  assert.equal(await page.evaluate(() => localStorage.getItem('cc.socials.level')), '3');
  await slider.fill('4'); assert.match(await page.locator('.so-level-name').textContent(), /Explicit/);
  assert.match(await page.locator('.so-level-note').textContent(), /Celebrity accounts stay at Adult/);
  await page.locator('.so-ai:not(.so-tts) p[aria-live]').filter({ hasText: /Not available on this device|Not downloaded/ }).waitFor();
  assert.ok(await page.getByText('Recognize faces in new posts').count() === 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Socials: writing text never leaves the app: posting (photo read, auto-caption), generated comments and messages answered by themselves make no outside request', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const outside = []; page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')) outside.push(`${r.method()} ${u}`); });
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  for (const h of ['amy', 'bo']) { await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click(); await page.getByLabel('Username', { exact: true }).fill(h); await page.getByRole('button', { name: 'Create account' }).click(); }
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  // A post: its photo read and a caption written on the phone.
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles(await photo(page)); await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-mrow[data-status="ready"]').first().waitFor();
  await page.getByRole('button', { name: '✨ Suggest caption' }).click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="Caption"]')?.value.length > 3, null, { timeout: 30000 });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const post = page.locator('.so-post').first(); await post.waitFor();
  // Comments generated.
  await post.getByRole('button', { name: 'Comments', exact: true }).click();
  await page.getByRole('button', { name: 'Generate 3 comments' }).click(); await page.locator('.so-comment').nth(2).waitFor();
  // A message, answered by itself.
  await page.getByRole('button', { name: 'Messages' }).first().click(); await page.getByRole('button', { name: 'Message @amy' }).click();
  await page.getByLabel('Message', { exact: true }).fill('i just got the job!!'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.locator('.so-bubble:not(.mine):not(.so-typing)').first().waitFor({ timeout: 10000 });
  assert.deepEqual(outside, [], 'nothing left the app');
  await page.close();
});

test('backgrounds: a picture behind all of Socials, an account\'s own on its profile page; gone outside Socials', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  const layer = page.locator('.cc-bgimg');
  const bgOf = () => layer.evaluate((e) => (e.hidden ? '' : e.style.backgroundImage));
  await page.locator('.so-sync, [aria-label*="Sync"]').first().click();
  await page.getByLabel('Choose a picture for Socials background').setInputFiles(await photo(page));
  await page.waitForFunction(() => !document.querySelector('.cc-bgimg')?.hidden);
  const app = await bgOf(); assert.match(app, /^url\("blob:/);
  // The Owner's profile: its own picture there.
  await page.getByRole('button', { name: 'Profile' }).click();
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await page.getByLabel('Choose a picture for Profile background').setInputFiles({ ...(await photo(page)), name: 'p.png' });
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction((a) => { const e = document.querySelector('.cc-bgimg'); return e && !e.hidden && e.style.backgroundImage !== a; }, app);
  assert.notEqual(await bgOf(), app, 'its own on the profile');
  await page.getByRole('button', { name: 'Home' }).first().click(); await page.waitForTimeout(200);
  // Out of Socials: none.
  await page.goto(`${origin}${BASE}index.html#/clock`); await page.waitForTimeout(300);
  assert.equal(await layer.evaluate((e) => e.hidden), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Socials is encrypted on the phone: nothing readable as kept; opened again with the password (and the new one after a change)', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('secret.owner'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles(await photo(page)); await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-mrow[data-status="ready"]').first().waitFor();
  await page.getByLabel('Caption', { exact: true }).fill('Top secret caption'); await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.locator('.so-post', { hasText: 'Top secret caption' }).waitFor();
  // As kept: nothing readable (no caption, no handle, the photo's bytes not a PNG).
  const kept = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('command-center'); r.onsuccess = () => { const st = r.result.transaction('kv').objectStore('kv'); const all = st.getAll(); const keys = st.getAllKeys(); all.onsuccess = () => keys.onsuccess = () => { const out = { text: false, png: false, plain: [] }; all.result.forEach((v, i) => { const k = String(keys.result[i]); if (!k.startsWith('cc.socials')) return; const bytes = v?.ct ?? v?.buf; const s = bytes ? new TextDecoder().decode(bytes) : JSON.stringify(v); if (/Top secret caption|secret\.owner/.test(s)) out.text = true; if (bytes && new Uint8Array(bytes).subarray(1, 4).every((b, j) => b === [80, 78, 71][j])) out.png = true; if ((k === 'cc.socials' || k.startsWith('cc.socials.m.')) && !v?.enc) out.plain.push(k); }); res(out); }; }; }));
  assert.deepEqual(kept, { text: false, png: false, plain: [] }, 'all of it encrypted');
  // Reopened (a new session): the password unlocks it.
  await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByRole('button', { name: 'Open' }).click();
  await page.locator('.so-post', { hasText: 'Top secret caption' }).waitFor();
  // The password changed: the new one opens it (the data as it was).
  await page.locator('.so-sync, [aria-label*="Sync"]').first().click();
  await page.getByLabel('Current password').fill('heron42'); await page.getByLabel('New password', { exact: true }).fill('falcon77'); await page.getByLabel('New password again').fill('falcon77');
  await page.getByRole('button', { name: 'Change password' }).click(); await page.waitForTimeout(800);
  await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await page.getByLabel('Password', { exact: true }).fill('falcon77'); await page.getByRole('button', { name: 'Open' }).click();
  await page.locator('.so-post', { hasText: 'Top secret caption' }).waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('Socials: replies to comments: the post\'s account answers a comment on its post in a thread under it (in its own voice); Reply under a comment answers it; the Owner\'s posts left for you', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click(); await page.getByLabel('Username', { exact: true }).fill('amy'); await page.getByRole('button', { name: 'Create account' }).click();
  // A post from amy.
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles(await photo(page)); await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-mrow[data-status="ready"]').first().waitFor();
  await page.getByLabel('Caption').fill('Pizza night in Denver');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.locator('.so-post').first().waitFor();
  // The Owner comments on it: amy answers, under it.
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  const postId = await page.evaluate(async () => { const { loadState } = await import('./apps/socials/socials-store.js'); const { state } = await loadState(); return state.posts.find((p) => p.caption.startsWith('Pizza'))?.id; });
  assert.ok(postId);
  await page.getByRole('button', { name: 'Search' }).click(); await page.getByLabel('Search accounts').fill('amy');
  await page.locator('.so-person', { hasText: 'amy' }).locator('.so-person-main').click(); await page.locator('.so-tile').first().click();
  await page.getByLabel('Add a comment').fill('where is this?? looks amazing');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  // (Her automatic comments get answers too: this is hers to mine, found by what it answers.)
  const comments = () => page.evaluate(async (id) => { const { loadState } = await import('./apps/socials/socials-store.js'); const { state } = await loadState(); return state.posts.find((x) => x.id === id).comments.map((c) => ({ id: c.id, re: c.re ?? null, text: c.text, by: c.by })); }, postId);
  let mine; let answer;
  for (let k = 0; k < 100 && !answer; k++) { const cs = await comments(); mine = cs.find((c) => c.text === 'where is this?? looks amazing'); answer = cs.find((c) => c.re === mine?.id); if (!answer) await page.waitForTimeout(250); }
  if (!answer) console.log('DBG', JSON.stringify(await comments()));
  assert.ok(answer, 'amy answers my comment'); assert.match(answer.text, /denv/i, 'where: from her caption (in her voice: Denverrr!!)');
  const reply = page.locator('.so-comment.so-reply', { hasText: answer.text }).first(); await reply.waitFor();
  assert.match(await reply.textContent(), /^amy /);
  // Reply under amy's answer: in the same thread.
  await reply.getByRole('button', { name: 'Reply to @amy' }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Reply to @amy' }).inputValue(), '@amy ');
  await page.getByRole('textbox', { name: 'Reply to @amy' }).fill('@amy need to go!!');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await page.locator('.so-comment.so-reply', { hasText: 'need to go!!' }).waitFor();
  const st = await comments();
  assert.deepEqual(st.filter((c) => c.re === mine.id).map((c) => c.text).sort(), [answer.text, '@amy need to go!!'].sort(), 'her answer and mine, both under my comment');
  assert.deepEqual(errors, []);
  await page.close();
});

test('Socials: an account\'s Voice and Into in its profile (kept); home-screen shortcuts open a new post and messages, behind the password', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click();
  await page.getByLabel('Username', { exact: true }).fill('kai');
  await page.getByLabel('Voice', { exact: true }).selectOption('chill'); await page.getByLabel('Into').fill('surfing, dry humor');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Welcome to your feed').waitFor();
  const acc = await page.evaluate(async () => { const { loadState } = await import('./apps/socials/socials-store.js'); const { state } = await loadState(); const a = state.accounts.find((x) => x.handle === 'kai'); return [a.voice, a.interests]; });
  assert.deepEqual(acc, ['chill', 'surfing, dry humor']);
  // Edit profile shows them, to change.
  await page.getByRole('button', { name: 'Profile' }).first().click();
  await page.getByRole('button', { name: 'Edit profile' }).click();
  assert.equal(await page.getByLabel('Voice', { exact: true }).inputValue(), 'chill'); assert.equal(await page.getByLabel('Into').inputValue(), 'surfing, dry humor');
  // Shortcuts: a new post (after the password), then messages.
  await page.goto(`${origin}${BASE}index.html#/socials/new`); await page.reload();
  const pass = page.getByLabel('Password', { exact: true }); await pass.or(page.getByText(/New post as @/)).first().waitFor();
  if (await pass.count()) { await pass.fill('heron42'); await page.getByRole('button', { name: /^(Open|Unlock)$/ }).first().click(); }
  await page.getByText(/New post as @kai/).waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#/socials/admin', 'the shortcut not left in the address');
  await page.goto(`${origin}${BASE}index.html#/socials/inbox`); await page.reload();
  const pass2 = page.getByLabel('Password', { exact: true }); const inbox = page.getByText(/Messages · @kai/); await pass2.or(inbox).first().waitFor();
  if (await pass2.count()) { await pass2.fill('heron42'); await page.getByRole('button', { name: /^(Open|Unlock)$/ }).first().click(); }
  await inbox.first().waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('Socials read aloud: 🔊 on messages, comments and captions speaks in the account\'s voice; its Speaking voice and speed in Edit profile; new replies read aloud; natural voices offered as a download', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // (The phone's speech, recorded: what's said, in which voice, how fast.)
  await context.addInitScript(() => {
    const voices = [{ voiceURI: 'v-sam', name: 'Samantha', lang: 'en-US', localService: true }, { voiceURI: 'v-dan', name: 'Daniel', lang: 'en-GB', localService: true }, { voiceURI: 'v-net', name: 'Online Voice', lang: 'en-US', localService: false }];
    globalThis.__said = [];
    // (What the audio player is given to play, and how long each is.)
    globalThis.__clips = []; const play0 = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { const el = this; el.addEventListener('loadedmetadata', () => globalThis.__clips.push({ secs: el.duration }), { once: true }); return play0.call(this); };
    globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    Object.defineProperty(globalThis, 'speechSynthesis', { value: { getVoices: () => voices, addEventListener() {}, cancel() {}, speak(u) { if (u.text.trim()) globalThis.__said.push({ text: u.text, voice: u.voice?.voiceURI, rate: u.rate }); else globalThis.__primed = (globalThis.__primed ?? 0) + 1; setTimeout(() => { u.onstart?.(); u.onend?.(); }, 30); } }, configurable: true });
  });
  const page = await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  // An account with its own speaking voice (only this phone's voices that speak on the device are offered).
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click();
  await page.getByLabel('Username', { exact: true }).fill('kai');
  // The picker: each voice described by words, filtered by them; on-device voices only.
  await page.getByRole('button', { name: 'Choose its speaking voice' }).click();
  const vp = page.getByRole('dialog', { name: 'Speaking voice' });
  // The natural voices are listed before they're downloaded: ▶ plays each one's sample (made ahead, kept with the app) at once.
  await vp.getByRole('button', { name: 'Play Heart', exact: true }).click();
  await page.waitForFunction(() => (globalThis.__clips ?? []).some((x) => x.secs > 1));
  assert.equal(await page.evaluate(() => globalThis.__said.length), 0, 'a sample, not this phone\'s voice');
  await vp.getByRole('button', { name: '📱 This phone' }).click();
  await vp.locator('.vp-card', { hasText: 'Daniel' }).waitFor();
  assert.equal(await vp.locator('.vp-card', { hasText: 'Online Voice' }).count(), 0, 'on-device voices only');
  assert.match(await vp.locator('.vp-card', { hasText: 'Daniel' }).textContent(), /polished.*deep.*man.*British/);
  await vp.getByRole('button', { name: 'British', exact: true }).click();
  assert.deepEqual(await vp.locator('.vp-card strong').allTextContents(), ['Daniel']);
  await vp.getByRole('button', { name: 'Play Daniel' }).click();
  await page.waitForFunction(() => globalThis.__said.some((x) => x.voice === 'v-dan'));
  await vp.getByRole('button', { name: 'Use Daniel' }).click();
  await page.locator('.so-say-line', { hasText: 'Daniel · polished · deep · man · British' }).waitFor();
  await page.getByLabel('Speaking speed').selectOption('1.15'); await page.getByLabel('Speaking pitch').selectOption('0.88');
  await page.evaluate(() => { globalThis.__said.length = 0; });
  await page.getByRole('button', { name: '▶ Preview' }).click();
  await page.waitForFunction(() => globalThis.__said.length === 1);
  assert.equal(await page.evaluate(() => globalThis.__primed), 1, 'the phone\'s speech woken at the tap, once (silently)');
  assert.deepEqual(await page.evaluate(() => globalThis.__said[0].voice), 'v-dan');
  await page.getByRole('button', { name: 'Create account' }).click(); await page.getByText('Welcome to your feed').waitFor();
  // A post with a caption: 🔊 reads it (hashtags as words, no emojis).
  await page.getByRole('button', { name: 'New post' }).first().click();
  await page.getByLabel('Photo or video').setInputFiles(await photo(page)); await page.getByRole('dialog', { name: 'Edit photo' }).getByRole('button', { name: 'Done' }).click();
  await page.locator('.so-mrow[data-status="ready"]').first().waitFor();
  await page.getByLabel('Caption').fill('Sunset surf 🌅 #golden_hour'); await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.locator('.so-post').first().getByRole('button', { name: 'Comments', exact: true }).click();
  await page.getByRole('button', { name: 'Play @kai\'s caption aloud' }).click();
  await page.waitForFunction(() => globalThis.__said.some((x) => x.text === 'Sunset surf golden hour'));
  const said = await page.evaluate(() => globalThis.__said.find((x) => x.text === 'Sunset surf golden hour'));
  assert.equal(said.voice, 'v-dan'); assert.ok(said.rate > 1, 'faster');
  // Settings: read new replies aloud; natural voices offered (not downloaded here).
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: /^Use @owner\.me/ }).click();
  await page.getByRole('button', { name: 'Sync and password' }).click();
  await page.getByText('🗣 Natural voices (on this phone)').waitFor();
  assert.match(await page.locator('.so-tts').textContent(), /28 voices.*Not downloaded \(about 330 MB, once\)/);
  // Replies play by themselves while you're chatting: on unless turned off.
  assert.equal(await page.getByRole('checkbox', { name: /Play replies while chatting/ }).isChecked(), true);
  // Sent to kai: its reply is spoken as it comes, in its voice (both lines, one after the other).
  await page.getByRole('button', { name: 'Messages' }).first().click(); await page.getByRole('button', { name: 'Message @kai' }).click();
  await page.getByLabel('Message', { exact: true }).fill('how was the surf today?'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.locator('.so-bubble:not(.mine):not(.so-typing)').first().waitFor({ timeout: 10000 });
  await page.waitForFunction(() => globalThis.__said.filter((x) => x.voice === 'v-dan').length >= 3);
  // Opening the chat again (not chatting): nothing plays by itself.
  await page.waitForFunction(() => !document.querySelector('.so-typing'), null, { timeout: 15000 }); await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Back' }).click(); await page.evaluate(() => { globalThis.__said.length = 0; });
  await page.getByRole('button', { name: /@kai/ }).first().click(); await page.locator('.so-chat-bar').waitFor(); await page.waitForTimeout(1500);
  assert.deepEqual(await page.evaluate(() => globalThis.__said.map((x) => x.text)), [], 'opening a chat plays nothing');
  // Voices made are kept on the phone across restarts: encrypted, under a name that doesn't give the words away.
  const kept = await page.evaluate(async () => {
    const S = await import('./apps/socials/socials-store.js');
    const audio = Float32Array.from({ length: 2400 }, (_, i) => Math.sin(i / 7) * 0.4);
    await S.voiceStore.put('n:af_heart|1.000|see you at the beach', audio, 24000);
    const back = await S.voiceStore.get('n:af_heart|1.000|see you at the beach');
    const { idb } = await import('./lib/idb.js');
    const keys = (await idb.keys()).map(String).filter((k) => k.startsWith('cc.socials.v.'));
    const rec = await idb.get(keys[0]);
    return { n: back?.audio.length, close: Math.abs(back.audio[100] - audio[100]) < 0.001, rate: back?.rate, keys, enc: rec?.enc === 1, plain: 'buf' in rec, other: await S.voiceStore.get('n:af_heart|1.000|something else') };
  });
  assert.equal(kept.n, 2400); assert.ok(kept.close); assert.equal(kept.rate, 24000); assert.equal(kept.keys.length, 1);
  assert.ok(!/beach|heart/i.test(kept.keys[0]), 'the name gives nothing away'); assert.ok(kept.enc && !kept.plain, 'encrypted'); assert.equal(kept.other, null);
  // 🔊 on a message bubble too.
  await page.locator('.so-bubble.mine').getByRole('button', { name: /Play @owner\.me's message aloud/ }).click();
  await page.waitForFunction(() => globalThis.__said.some((x) => x.text === 'how was the surf today?'));
  assert.deepEqual(errors, []);
  await context.close();
});

test('Socials chat: the whole screen, its header at the top and the box at the bottom; the page itself never scrolls; the latest messages in sight', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click(); await page.getByLabel('Username', { exact: true }).fill('amy'); await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  await page.getByRole('button', { name: 'Messages' }).first().click(); await page.getByRole('button', { name: 'Message @amy' }).click();
  for (let i = 1; i <= 14; i++) { await page.getByLabel('Message', { exact: true }).fill(`message number ${i}`); await page.getByRole('button', { name: 'Send', exact: true }).click(); }
  await page.locator('.so-bubble:not(.mine):not(.so-typing)').first().waitFor({ timeout: 10000 });
  await page.getByLabel('Message', { exact: true }).focus();
  const box = await page.evaluate(() => { const w = document.querySelector('.so-chat-wrap').getBoundingClientRect(); const head = document.querySelector('.so-chat-wrap .so-back').getBoundingClientRect(); const bar = document.querySelector('.so-chat-bar').getBoundingClientRect(); const list = document.querySelector('.so-chat'); return { top: w.top, bottom: w.bottom, head: head.top, bar: bar.bottom, vh: innerHeight, scrollY, scrolled: list.scrollHeight - list.scrollTop - list.clientHeight }; });
  assert.ok(Math.abs(box.top) < 1 && Math.abs(box.bottom - box.vh) < 1, `the whole screen: ${JSON.stringify(box)}`);
  assert.ok(box.head >= 0 && box.head < 80, 'its header at the top, in sight');
  assert.ok(Math.abs(box.bar - box.vh) < 1, 'the box at the bottom');
  assert.equal(box.scrollY, 0, 'the page itself not scrolled');
  assert.ok(box.scrolled < 40, 'the latest messages in sight');
  // The keyboard up (the visible part of the screen shorter): the chat fits what's left, header and box both in sight.
  await page.setViewportSize({ width: 390, height: 450 }); await page.waitForTimeout(200);
  const kb = await page.evaluate(() => ({ head: document.querySelector('.so-chat-wrap .so-back').getBoundingClientRect().top, bar: document.querySelector('.so-chat-bar').getBoundingClientRect().bottom, vh: visualViewport.height, last: document.querySelector('.so-chat').lastElementChild.getBoundingClientRect().bottom, barTop: document.querySelector('.so-chat-bar').getBoundingClientRect().top }));
  assert.ok(kb.head >= 0 && Math.abs(kb.bar - kb.vh) < 1 && kb.last <= kb.barTop + 1, `fits above the keyboard: ${JSON.stringify(kb)}`);
  await page.setViewportSize({ width: 390, height: 844 });
  // Leaving the chat: the page as it was.
  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('so-chat-open')), false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Socials group chats: 👥 New group with two accounts; the Owner\'s message is answered by them in turn, each named and in its own voice (played while chatting); listed in Messages; renamed and left', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    const voices = [{ voiceURI: 'v-sam', name: 'Samantha', lang: 'en-US', localService: true }, { voiceURI: 'v-dan', name: 'Daniel', lang: 'en-GB', localService: true }];
    globalThis.__said = [];
    globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    Object.defineProperty(globalThis, 'speechSynthesis', { value: { getVoices: () => voices, addEventListener() {}, cancel() {}, speak(u) { if (u.text.trim()) globalThis.__said.push({ text: u.text, voice: u.voice?.voiceURI }); setTimeout(() => { u.onstart?.(); u.onend?.(); }, 30); } }, configurable: true });
  });
  const page = await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  for (const h of ['amy', 'ben']) { await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click(); await page.getByLabel('Username', { exact: true }).fill(h); await page.getByRole('button', { name: 'Create account' }).click(); await page.getByText('Welcome to your feed').or(page.locator('.so-post').first()).first().waitFor(); }
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  await page.getByRole('button', { name: 'Messages' }).first().click();
  await page.getByRole('button', { name: '👥 New group' }).click();
  const start = page.getByRole('button', { name: /Pick at least two|Start the group/ });
  assert.equal(await start.isDisabled(), true);
  await page.getByLabel('Add @amy').check(); await page.getByLabel('Add @ben').check();
  await page.getByLabel('Group name').fill('Beach crew');
  await page.getByRole('button', { name: 'Start the group (3 people)' }).click();
  await page.getByRole('log', { name: 'Group chat Beach crew' }).waitFor();
  await page.getByLabel('Message', { exact: true }).fill('beach at 5 today?'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  // One or more answer, one after the other, each named over its message, and played (while chatting).
  await page.locator('.so-bubble-who').first().waitFor({ timeout: 15000 });
  assert.match(await page.locator('.so-bubble-who').first().textContent(), /amy|ben/);
  await page.waitForFunction(() => globalThis.__said.length >= 1, null, { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('.so-typing'), null, { timeout: 30000 });
  const answers = await page.locator('.so-bubble:not(.mine):not(.so-typing)').count();
  assert.ok(answers >= 1 && answers <= 2, `${answers} answers`);
  await page.waitForFunction((n) => globalThis.__said.length >= n, answers, { timeout: 15000 });
  // In Messages, with its last message; renamed; left (and gone from the list).
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: /^Group chat Beach crew/ }).waitFor();
  await page.getByRole('button', { name: /^Group chat Beach crew/ }).click();
  await page.getByRole('button', { name: 'About the group Beach crew' }).click();
  const dlg = page.getByRole('dialog', { name: 'Group' });
  await dlg.getByLabel('Group name').fill('Sunset crew'); await dlg.getByRole('button', { name: 'Save name' }).click();
  await page.getByRole('log', { name: 'Group chat Sunset crew' }).waitFor();
  await page.getByRole('button', { name: 'About the group Sunset crew' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('dialog', { name: 'Group' }).getByRole('button', { name: 'Leave the group' }).click();
  await page.getByRole('button', { name: '👥 New group' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Group chat/ }).count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Socials chat looks: 🎨 a theme for one chat (its bubbles and background change; other chats keep the usual look), a wallpaper of your own, back to the usual', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}index.html#/socials/admin`);
  await page.getByLabel('Password', { exact: true }).fill('heron42'); await page.getByLabel('Password again').fill('heron42');
  await page.getByRole('button', { name: 'Set password' }).click();
  await page.getByLabel('Username', { exact: true }).fill('owner.me'); await page.getByRole('button', { name: 'Create account' }).click();
  for (const h of ['amy', 'ben']) { await page.locator('.so-switch').click(); await page.getByRole('button', { name: '+ Add New' }).click(); await page.getByLabel('Username', { exact: true }).fill(h); await page.getByRole('button', { name: 'Create account' }).click(); await page.getByText('Welcome to your feed').or(page.locator('.so-post').first()).first().waitFor(); }
  await page.locator('.so-switch').click(); await page.getByRole('button', { name: 'Use @owner.me (Owner)' }).click();
  await page.getByRole('button', { name: 'Messages' }).first().click(); await page.getByRole('button', { name: 'Message @amy' }).click();
  await page.getByLabel('Message', { exact: true }).fill('hey!'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  const mineBg = () => page.locator('.so-bubble.mine').first().evaluate((b) => getComputedStyle(b).backgroundImage + getComputedStyle(b).backgroundColor);
  const usual = await mineBg();
  await page.getByRole('button', { name: 'Chat theme and wallpaper' }).click();
  const dlg = page.getByRole('dialog', { name: 'Chat look' });
  await dlg.getByRole('radio', { name: '🖤 Mono' }).click();
  assert.equal(await dlg.getByRole('radio', { name: '🖤 Mono' }).getAttribute('aria-checked'), 'true');
  await page.waitForFunction(() => document.querySelector('.so-chat-wrap')?.classList.contains('so-themed'));
  assert.notEqual(await mineBg(), usual);
  assert.match(await page.locator('.so-chat').evaluate((c) => getComputedStyle(c).backgroundColor), /rgb\(17, 17, 17\)/);
  // A wallpaper of your own: behind this chat.
  await dlg.getByLabel('Choose a picture for Chat wallpaper').setInputFiles(await photo(page));
  await page.waitForFunction(() => document.querySelector('.so-chat')?.classList.contains('so-wallpaper'));
  await dlg.getByRole('button', { name: 'Close' }).click();
  // Another chat keeps the usual look.
  await page.getByRole('button', { name: 'Back' }).click(); await page.getByRole('button', { name: 'Message @ben' }).click();
  await page.locator('.so-chat-bar').waitFor();
  assert.equal(await page.locator('.so-chat-wrap.so-themed').count(), 0); assert.equal(await page.locator('.so-chat.so-wallpaper').count(), 0);
  // Back to amy's: still Mono (kept); then the usual again.
  await page.getByRole('button', { name: 'Back' }).click(); await page.getByRole('button', { name: /Chat with @amy/ }).click();
  await page.waitForFunction(() => document.querySelector('.so-chat-wrap')?.classList.contains('so-themed'));
  await page.getByRole('button', { name: 'Chat theme and wallpaper' }).click();
  await page.getByRole('dialog', { name: 'Chat look' }).getByRole('radio', { name: 'Usual' }).click();
  await page.waitForFunction(() => !document.querySelector('.so-chat-wrap')?.classList.contains('so-themed'));
  assert.deepEqual(errors, []);
  await page.close();
});
