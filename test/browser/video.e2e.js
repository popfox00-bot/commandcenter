// Browser tests for Files → Video Editor (`npm run test:web`): ✂️ Edit (crop, sound removed, reverse, combine,
// sound only) and 🥽 2D → 3D (preview, then each layout made: its size, frame count, sound and name checked). The
// clip is synthetic (test pattern + tone, test/fixtures/web/clip.mp4: 320×180, 30 fps, 1.5 s, H.264 + AAC). 2D → 3D
// runs in its test mode (depth guessed from the picture), so no model is downloaded here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const CLIP = resolve(import.meta.dirname, '../fixtures/web/clip.mp4');
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

async function open(hash, { testMode = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (testMode) await context.addInitScript(() => localStorage.setItem('cc.video3d.test', '1'));
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${origin}${BASE_PATH}${hash}`);
  return { context, page, errors };
}
/** Whether this browser can encode H.264 (the tests need it; a browser without says so on screen instead). */
const canEncode = (page) => page.evaluate(async () => !!globalThis.VideoEncoder && (await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 640, height: 360 })).supported);
const resultText = (page) => page.locator('.vid-result p.muted').first().textContent();

test('Files has the Video Editor: Edit and 2D → 3D, and Convert points to it', async () => {
  const { context, page, errors } = await open('#/files');
  await page.getByRole('link', { name: /Video Editor/ }).click();
  await page.waitForURL(/#\/files\/video$/);
  const tabs = page.getByRole('tablist', { name: 'Video Editor' });
  await tabs.getByRole('tab', { name: /Edit/ }).waitFor();
  await tabs.getByRole('tab', { name: /2D → 3D/ }).click();
  await page.getByRole('heading', { name: /2D → 3D for VR/ }).waitFor();
  await page.goto(`${origin}${BASE_PATH}#/files/convert`);
  await page.getByRole('link', { name: /Videos\? Trim, crop, combine or make 3D/ }).click();
  await page.getByRole('heading', { name: '🎬 Video Editor' }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

test('2D → 3D: preview a frame in each view, then every layout made with the right size, frames and sound', async (t) => {
  const { context, page, errors } = await open('#/files/video3d', { testMode: true });
  if (!(await canEncode(page))) { await page.getByText(/Can't make 3D videos in this browser/).waitFor(); t.skip('no H.264 encoder in this browser'); await context.close(); return; }
  await page.locator('.studio-pane:not([hidden]) input[type=file]').first().setInputFiles(CLIP);
  await page.getByText(/clip\.mp4: 320×180 · 1\.5 s · 30 fps · sound \(aac\)/).waitFor();
  await page.getByText(/Test mode/).waitFor();
  // Preview: drawn side by side, then the other views.
  await page.getByRole('button', { name: 'Preview this frame' }).click();
  await page.getByText(/Worked out in \d+ ms/).waitFor();
  const size = () => page.locator('.vid-canvas').evaluate((c) => [c.width, c.height]);
  assert.deepEqual(await size(), [640, 180]);
  await page.getByRole('radio', { name: 'Depth' }).click(); assert.equal((await size())[1] > 0, true);
  await page.getByRole('radio', { name: 'Red-cyan' }).click(); assert.deepEqual(await size(), [320, 180]);
  await page.getByRole('radio', { name: 'Cross-eye' }).click(); assert.deepEqual(await size(), [640, 180]);
  await page.getByText(/45 frames · about/).waitFor();
  for (const [layout, name, dims] of [['Full SBS', 'clip_SBS_LR.mp4', '640×180'], ['Half SBS', 'clip_3dh.mp4', '320×180'], ['Top-Bottom', 'clip_TB.mp4', '320×360']]) {
    await page.getByRole('radio', { name: layout }).click();
    await page.getByRole('button', { name: 'Convert to 3D' }).click();
    await page.getByRole('heading', { name: `Done: ${name}` }).waitFor({ timeout: 60000 });
    const text = await resultText(page);
    assert.match(text, new RegExp(`${dims} · 45 frames · 1\\.5 s · with sound`), `${layout}: ${text}`);
    assert.equal(await page.locator('.vid-problems').count(), 0);
    assert.equal(await page.locator('.vid-result .warn-text').count(), 0);
    await page.getByText('How to watch on a Meta Quest').waitFor();
    // (It plays here: the browser reads its size.)
    const played = await page.locator('.vid-result video').evaluate((v) => new Promise((ok) => { if (v.readyState >= 1) ok([v.videoWidth, v.videoHeight]); else v.addEventListener('loadedmetadata', () => ok([v.videoWidth, v.videoHeight]), { once: true }); }));
    assert.equal(played.join('×'), dims);
  }
  // Trimmed: fewer frames.
  await page.getByLabel('End (seconds)').fill('1'); await page.getByLabel('End (seconds)').dispatchEvent('change');
  await page.getByRole('button', { name: 'Convert to 3D' }).click();
  await page.getByText(/· 30 frames · 1\.0 s · with sound/).waitFor({ timeout: 60000 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('2D → 3D: a converting video can be canceled, and a file that isn\'t a video says so', async (t) => {
  const { context, page } = await open('#/files/video3d', { testMode: true });
  if (!(await canEncode(page))) { t.skip('no H.264 encoder in this browser'); await context.close(); return; }
  const input = page.locator('.studio-pane:not([hidden]) input[type=file]').first();
  await input.setInputFiles({ name: 'notes.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') });
  await page.getByRole('alert').filter({ hasText: /can't be read as a video|no video/i }).waitFor();
  await input.setInputFiles(CLIP);
  await page.getByRole('button', { name: 'Convert to 3D' }).waitFor();
  // (Canceled straight away: the short clip would finish before a second tap could land.)
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Convert to 3D'); b.click(); b.click(); });
  await page.getByText('Canceled. Nothing was saved.').waitFor();
  await page.getByRole('button', { name: 'Convert to 3D' }).waitFor();
  await context.close();
});

test('Edit: crop square without sound, play backward, save the sound, join two clips', async (t) => {
  const { context, page, errors } = await open('#/files/video');
  if (!(await canEncode(page))) { t.skip('no H.264 encoder in this browser'); await context.close(); return; }
  await page.locator('.studio-pane:not([hidden]) input[type=file]').first().setInputFiles(CLIP);
  await page.getByText(/clip\.mp4: 320×180/).waitFor();
  await page.getByLabel('Crop').selectOption('1:1');
  await page.getByRole('radio', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Make the video' }).click();
  await page.getByRole('heading', { name: 'Done: clip-edited.mp4' }).waitFor({ timeout: 60000 });
  assert.match(await resultText(page), /180×180 · 1\.5 s · no sound/);
  await page.getByRole('radio', { name: /Reverse/ }).click();
  await page.getByRole('button', { name: 'Make it backward' }).click();
  await page.getByRole('heading', { name: 'Done: clip-reversed.mp4' }).waitFor({ timeout: 60000 });
  assert.match(await resultText(page), /320×180 · 45 frames · 1\.5 s · with sound/);
  assert.equal(await page.locator('.vid-problems').count(), 0);
  await page.getByRole('radio', { name: /Sound only/ }).click();
  await page.getByRole('button', { name: 'Save the sound' }).click();
  await page.getByRole('heading', { name: 'Done: clip-sound.m4a' }).waitFor({ timeout: 60000 });
  await page.getByRole('radio', { name: /Combine/ }).click();
  await page.locator('.vid-clips + .drop input[type=file]').setInputFiles(CLIP);
  await page.getByRole('button', { name: 'Join 2 clips' }).click();
  await page.getByRole('heading', { name: 'Done: clip-combined.mp4' }).waitFor({ timeout: 60000 });
  assert.match(await resultText(page), /320×180 · 3\.0 s · with sound/);
  assert.equal(await page.locator('.vid-problems').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});
