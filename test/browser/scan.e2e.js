// Browser test for Scan: auto edges on a tilted sheet, cleanup, PDF, and hand-off to the PDF tab.
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

test('scan a tilted page: edges found automatically, page flattened and cleaned, PDF signed next', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}#/files/scan`);
  await page.waitForSelector('#sc-files', { state: 'attached' });
  const jpeg = await page.evaluate(async () => {
    // A 1200x900 "photo": wood-dark table, a slightly rotated sheet with shading and text lines.
    const c = new OffscreenCanvas(1200, 900); const x = c.getContext('2d');
    x.fillStyle = '#3b2f2a'; x.fillRect(0, 0, 1200, 900);
    x.save(); x.translate(600, 450); x.rotate(-0.12);
    const g = x.createLinearGradient(-300, 0, 300, 0); g.addColorStop(0, '#e9e6df'); g.addColorStop(1, '#b9b5ad');
    x.fillStyle = g; x.fillRect(-300, -380, 600, 760);
    x.fillStyle = '#222'; for (let i = 0; i < 18; i++) x.fillRect(-250, -320 + i * 36, 380 + (i % 3) * 40, 12);
    x.restore();
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer()));
  });
  await page.setInputFiles('#sc-files', { name: 'IMG_0101.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg) });
  await page.waitForSelector('.scan-dialog');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForSelector('.scan-thumb[src]');

  // Thumbnail corners and edges are paper (cleaned to near white), not table (dark brown).
  const edges = await page.$eval('.scan-thumb', async (img) => {
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const at = (fx, fy) => x.getImageData(Math.floor(fx * (c.width - 1)), Math.floor(fy * (c.height - 1)), 1, 1).data[0];
    return { tl: at(0.03, 0.03), tr: at(0.97, 0.03), bl: at(0.03, 0.97), br: at(0.97, 0.97), aspect: c.width / c.height };
  });
  for (const [k, v] of Object.entries(edges)) if (k !== 'aspect') assert.ok(v > 200, `${k} corner is paper-white (${v})`);
  assert.ok(Math.abs(edges.aspect - 600 / 760) < 0.06, `portrait sheet aspect ${edges.aspect}`);

  await page.getByRole('button', { name: /Make PDF/ }).click();
  await page.waitForSelector('text=1 page ·');
  await page.getByRole('button', { name: 'Sign / write on it' }).click();
  await page.waitForFunction(() => location.hash === '#/files/pdf' && document.querySelectorAll('.pw-page').length === 1);
  assert.deepEqual(errors, []);
  await context.close();
});
