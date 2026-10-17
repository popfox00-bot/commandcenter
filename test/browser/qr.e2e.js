// Browser tests for QR & Barcode: make a styled Wi-Fi code and scan it back from the saved PNG, the link
// safety check on a phishing code (offline, then with a mocked Worker trace), and the live camera scanner
// fed by Chromium's fake camera.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { encode } from '../../web/vendor/uqr/uqr.mjs';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
let server; let browser; let origin; let tmp;

before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = path.startsWith(BASE) ? path.slice(BASE.length) || 'index.html' : null;
    try { res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(await readFile(join(WEB, rel))); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  tmp = await mkdtemp(join(tmpdir(), 'cc-qr-'));
});
after(async () => { await browser?.close(); server?.close(); await rm(tmp, { recursive: true, force: true }); });

/** A plain black-on-white QR code as a PNG, drawn in the page. */
async function qrPng(page, text, scale = 8) {
  const { size, data } = encode(text, { ecc: 'M', border: 4 });
  const bytes = await page.evaluate(async ({ size, data, scale }) => {
    const c = new OffscreenCanvas(size * scale, size * scale); const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#000';
    data.forEach((row, y) => row.forEach((on, i) => { if (on) x.fillRect(i * scale, y * scale, scale, scale); }));
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }, { size, data, scale });
  return Buffer.from(bytes);
}

async function open(context, tab) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((t) => localStorage.setItem('cc.qr.prefs', JSON.stringify({ tab: t, history: true, pngSize: 1024 })), tab);
  await page.goto(`${origin}${BASE}#/tools/qr`);
  await page.waitForSelector('.qr-tabs .seg.active');
  return { page, errors };
}

test('create a styled Wi-Fi code with a logo, save the PNG, scan it back from the photo', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const { page, errors } = await open(context, 'create');
  await page.getByRole('button', { name: 'Wi-Fi', exact: true }).click();
  await page.getByLabel('Network name (SSID)').fill('Casa; Guest');
  await page.getByLabel('Password', { exact: true }).fill('p@ss:word;1');
  await page.waitForFunction(() => document.querySelector('.qr-check')?.textContent.includes('Scans correctly'));

  // Style: dots, round corners, colors, a logo and a caption, and it still scans.
  await page.locator('.qr-style summary').click();
  await page.getByRole('button', { name: 'Dots', exact: true }).click();
  await page.getByRole('button', { name: 'Circle', exact: true }).click();
  await page.locator('.qr-swatch').nth(1).click();
  const logo = await page.evaluate(async () => {
    const c = new OffscreenCanvas(200, 200); const x = c.getContext('2d');
    x.fillStyle = '#e11d48'; x.beginPath(); x.arc(100, 100, 95, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#fff'; x.font = 'bold 120px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('C', 100, 108);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await page.setInputFiles('#qr-logo', { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(logo) });
  await page.getByText('Remove logo').waitFor();
  await page.getByLabel('Caption under the code').fill('Scan to join');
  await page.waitForFunction(() => /Scans correctly/.test(document.querySelector('.qr-check')?.textContent ?? ''));

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save PNG' }).click()]);
  assert.match(download.suggestedFilename(), /^wifi-Casa-Guest\.png$/);
  const png = await readFile(await download.path());

  await page.getByRole('button', { name: '☆ Keep in Saved' }).click().catch(() => {});
  // Scan the saved PNG back in the Scan tab.
  await page.getByRole('tab', { name: 'Scan' }).click();
  await page.setInputFiles('#qr-photo', { name: 'wifi.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('.qr-card');
  const card = page.locator('.qr-card');
  await assert.doesNotReject(card.getByText('Wi-Fi network').waitFor());
  assert.equal(await card.locator('dd').first().textContent(), 'Casa; Guest');
  assert.match(await card.locator('dd').nth(2).textContent(), /^••••••••/);
  await card.getByRole('button', { name: 'Show' }).click();
  assert.match(await card.locator('dd').nth(2).textContent(), /^p@ss:word;1/);

  // History lists it, with the password masked.
  await page.getByRole('tab', { name: 'Saved' }).click();
  await page.waitForSelector('.qr-item');
  const hist = await page.locator('.qr-item').first().textContent();
  assert.match(hist, /Wi-Fi network/);
  assert.doesNotMatch(hist, /p@ss/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('a phishing link is flagged before opening, and the online trace shows where it really goes', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errors } = await open(context, 'scan');
  let popups = 0;
  context.on('page', () => { popups += 1; });

  await page.setInputFiles('#qr-photo', { name: 'sticker.png', mimeType: 'image/png', buffer: await qrPng(page, 'https://paypal.com.secure-login.ru/verify?utm_source=qr') });
  await page.waitForSelector('.qr-verdict');
  assert.match(await page.locator('.qr-verdict').textContent(), /Don't open this/);
  assert.equal(await page.locator('.qr-domain strong').first().textContent(), 'secure-login.ru');
  assert.match(await page.locator('.qr-findings').textContent(), /Pretends to be PayPal/);
  // Opening asks first; cancelling opens nothing.
  page.once('dialog', (d) => { assert.match(d.message(), /signs of a scam/); d.dismiss(); });
  await page.getByRole('button', { name: 'Open anyway…' }).click();
  assert.equal(popups, 0);

  // A short link, with a (mocked) Worker: trace shows the redirect chain, final page and a brand-new domain.
  await page.evaluate(() => { localStorage.setItem('cc.workerUrl', 'https://worker.example'); localStorage.setItem('cc.apiToken', 'x'.repeat(32)); });
  let sent = null;
  await page.route('https://worker.example/api/linkcheck', async (route) => {
    sent = { auth: route.request().headers().authorization, body: route.request().postDataJSON() };
    const registered = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await route.fulfill({ json: {
      hops: [{ url: 'https://bit.ly/3xyz', status: 301, kind: 'start' }, { url: 'https://track.example.net/c?id=1', status: 302, kind: 'http' }, { url: 'https://usps-redelivery.top/fee', status: 200, kind: 'http' }],
      final: { url: 'https://usps-redelivery.top/fee', status: 200, title: 'USPS - Redelivery fee', contentType: 'text/html' },
      domains: { 'bit.ly': { registered: '2008-01-01T00:00:00Z', registrar: 'Registrar A' }, 'usps-redelivery.top': { registered, registrar: 'Cheap Names' } },
      safeBrowsing: { checked: false, matches: [] },
    } });
  });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.setInputFiles('#qr-photo', { name: 'short.png', mimeType: 'image/png', buffer: await qrPng(page, 'https://bit.ly/3xyz') });
  await page.waitForSelector('.qr-verdict');
  assert.match(await page.locator('.qr-verdict').textContent(), /Be careful/);
  await page.getByRole('button', { name: /Check where it leads/ }).click();
  await page.waitForSelector('.qr-online');
  assert.equal(sent.auth, `Bearer ${'x'.repeat(32)}`);
  assert.deepEqual(sent.body, { url: 'https://bit.ly/3xyz' });
  assert.match(await page.locator('.qr-verdict').textContent(), /Don't open this/);
  const text = await page.locator('.qr-link').textContent();
  assert.match(text, /Ends up at/);
  assert.match(text, /usps-redelivery\.top/);
  assert.match(text, /USPS - Redelivery fee/);
  assert.match(text, /registered 3 days ago/);
  assert.match(text, /Pretends to be USPS/);
  assert.match(text, /Page claims to be USPS/);
  assert.match(text, /2 redirects/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('live camera: the fake camera shows a QR code and the scanner reads it', async () => {
  // Chromium's fake camera plays a .y4m file: one grey (Y-only) frame with a QR code.
  const text = 'https://example.com/menu';
  const { size, data } = encode(text, { ecc: 'M', border: 4 });
  const W = 480; const s = Math.floor(W / size); const off = Math.floor((W - size * s) / 2);
  const y = Buffer.alloc(W * W, 255);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (data[r][c]) for (let dy = 0; dy < s; dy++) y.fill(0, (off + r * s + dy) * W + off + c * s, (off + r * s + dy) * W + off + (c + 1) * s);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, Buffer.alloc((W / 2) * (W / 2) * 2, 128)]);
  const file = join(tmp, 'qr.y4m');
  await writeFile(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${W} F10:1 Ip A1:1 C420jpeg\n`), frame, frame]));

  const cam = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${file}`],
  });
  try {
    const context = await cam.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
    const { page, errors } = await open(context, 'scan');
    await page.getByRole('button', { name: '📷 Scan with camera' }).click();
    await page.waitForSelector('.qr-card', { timeout: 15000 });
    assert.match(await page.locator('.qr-verdict').textContent(), /No warning signs/);
    assert.equal(await page.locator('.qr-domain strong').textContent(), 'example.com');
    assert.equal(await page.evaluate(() => document.querySelector('.qr-video').srcObject), null, 'camera stopped after the scan');
    assert.deepEqual(errors, []);
  } finally {
    await cam.close();
  }
});
