// WorldAtlas Tutorials: reached from WorldAtlas; the farms it starts with (3D, supply list, space needed);
// a new design drawn layer by layer (palette, search, air), its supply list, a video link; kept after a reload.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
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

test('Tutorials: from WorldAtlas; a farm\'s 3D view, supply list and size; a design drawn layer by layer, kept after a reload', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}${BASE}apps/worldatlas/index.html`);
  await page.getByRole('link', { name: '📚 Tutorials' }).click();
  await page.getByRole('heading', { name: 'Tutorials' }).waitFor();
  assert.ok(await page.locator('.card').count() >= 5, 'the farms it starts with');
  // A farm: its 3D view drawn, the space it takes, its supply list, built up layer by layer.
  await page.getByRole('button', { name: /Automatic Sugar Cane Farm/ }).click();
  await page.getByText('Space needed').waitFor();
  assert.deepEqual(await page.locator('.dim strong').allTextContents(), ['10', '4', '5']);
  const supply = await page.locator('.supply').textContent(); assert.match(supply, /Piston8/); assert.match(supply, /Observer8/); assert.match(supply, /Plants \(shown grown\)/);
  const painted = () => page.locator('.view3d canvas').evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  const all = await painted(); assert.ok(all > 1000, 'drawn in 3D');
  await page.getByLabel('Layers shown').fill('1'); assert.ok((await painted()) < all, 'fewer layers, less of it');
  assert.ok(await page.getByRole('link', { name: 'Videos (YouTube)' }).count());
  // A new design: 3×3, two layers.
  await page.getByRole('button', { name: '‹ Tutorials' }).click();
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByLabel('Name').fill('My hut'); await page.getByLabel('Name').dispatchEvent('change');
  await page.getByLabel('Width').fill('3'); await page.getByLabel('Depth').fill('3'); await page.getByLabel('Layers').fill('2');
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByPlaceholder('https://youtube.com/…').fill('https://youtu.be/dQw4w9WgXcQ'); await page.getByLabel('Link title').fill('Build video');
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  // Layer 1 all cobblestone (from the palette); one block taken out (air).
  await page.getByRole('button', { name: 'Cobblestone', exact: true }).click();
  await page.getByRole('button', { name: /Fill layer with Cobblestone/ }).click();
  await page.getByRole('button', { name: '⬚ Air (erase)' }).click();
  { const g = page.locator('.ed-grid'); const b = await g.boundingBox(); await g.click({ position: { x: b.width / 6, y: b.height / 6 } }); }
  // Layer 2: one block found by search.
  await page.getByRole('button', { name: 'Layer above', exact: true }).click();
  await page.getByLabel('Search all blocks').fill('crafting');
  await page.getByRole('button', { name: 'Crafting Table' }).click();
  { const g = page.locator('.ed-grid'); const b = await g.boundingBox(); await g.click({ position: { x: b.width / 2, y: b.height / 2 } }); }
  await page.getByRole('button', { name: '‹ Done' }).click();
  await page.getByRole('heading', { name: 'My hut' }).waitFor();
  const s2 = await page.locator('.supply').textContent(); assert.match(s2, /Cobblestone8/); assert.match(s2, /Crafting Table1/);
  // Kept after a reload.
  await page.reload(); await page.getByRole('button', { name: /My hut/ }).click();
  assert.match(await page.locator('.supply').textContent(), /Cobblestone8.*Crafting Table1/);
  assert.equal(await page.getByRole('link', { name: 'Build video' }).getAttribute('href'), 'https://youtu.be/dQw4w9WgXcQ');
  assert.deepEqual(errors, []);
  await page.close();
});
