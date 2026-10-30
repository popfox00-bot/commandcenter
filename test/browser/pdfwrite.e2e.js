// Browser tests for "write on PDF": annotate in the app, save, and read the result back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import * as lib from 'pdf-lib';

const WEB = resolve(import.meta.dirname, '../../web');
const BASE = '/commandcenter/web/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
let server; let browser; let origin; let pdfPath;

before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = path.startsWith(BASE) ? path.slice(BASE.length) || 'index.html' : null;
    try { res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(await readFile(join(WEB, rel))); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const doc = await lib.PDFDocument.create();
  const font = await doc.embedFont(lib.StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) doc.addPage([612, 792]).drawText(`Form page ${i + 1}  Name: ________`, { x: 72, y: 700, size: 14, font });
  pdfPath = join(await mkdtemp(join(tmpdir(), 'cc-pdfw-')), 'form.pdf');
  await writeFile(pdfPath, await doc.save());
});
after(async () => { await browser?.close(); server?.close(); });

async function textOf(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fonts = resolve(import.meta.dirname, '../../node_modules/pdfjs-dist/standard_fonts') + '/';
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, standardFontDataUrl: fonts });
  const doc = await task.promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) out.push(...(await (await doc.getPage(n)).getTextContent()).items.map((i) => i.str));
  const pages = doc.numPages;
  await task.destroy();
  return { text: out.join('|'), pages };
}

async function openPdfTab(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${origin}${BASE}#/files/pdf`);
  await page.setInputFiles('#pw-file', pdfPath);
  await page.waitForFunction(() => document.querySelectorAll('.pw-page').length === 2 && document.querySelector('.pw-base').width > 0);
  return { page, errors };
}

async function pageBox(page, n) {
  // Center the page: the sticky toolbar covers the top of the screen.
  return page.$eval(`.pw-page[data-page="${n}"] .pw-overlay`, (o) => { o.scrollIntoView({ block: 'center' }); const r = o.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
}

test('type, sign and check on a PDF, then save a real PDF with the original text intact', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errors } = await openPdfTab(context);
  let b = await pageBox(page, 0);

  await page.getByRole('button', { name: /Text/ }).click();
  await page.mouse.click(b.x + b.w * 0.45, b.y + b.h * 0.11);
  await page.fill('.ed-textarea', 'Pat Example');
  await page.getByRole('button', { name: 'Add' }).click();

  await page.getByRole('button', { name: '✍ Draw', exact: true }).click();
  b = await pageBox(page, 0);
  await page.mouse.move(b.x + b.w * 0.2, b.y + b.h * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + b.w * (0.2 + i * 0.04), b.y + b.h * (0.5 + (i % 2 ? 0.02 : -0.02)));
  await page.mouse.up();

  await page.getByRole('button', { name: /Check/ }).click();
  const b2 = await pageBox(page, 1);
  await page.mouse.click(b2.x + b2.w * 0.1, b2.y + b2.h * 0.3);

  // Edit the text by tapping it with the Text tool.
  await page.getByRole('button', { name: /Text/ }).click();
  b = await pageBox(page, 0);
  await page.mouse.click(b.x + b.w * 0.47, b.y + b.h * 0.115);
  await page.waitForSelector('.ed-dialog');
  await page.fill('.ed-textarea', 'Pat Q. Example');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // The overlay shows ink where we signed.
  const inked = await page.$eval('.pw-page[data-page="0"] .pw-overlay', (o) => {
    const d = o.getContext('2d').getImageData(Math.floor(o.width * 0.3), Math.floor(o.height * 0.47), Math.floor(o.width * 0.1), Math.floor(o.height * 0.06)).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  });
  assert.ok(inked, 'signature drawn');

  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => /form-signed\.pdf/.test(document.querySelector('.ed-dialog .muted')?.textContent ?? ''));
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const file = await dl;
  assert.equal(file.suggestedFilename(), 'form-signed.pdf');
  const { text, pages } = await textOf(await readFile(await file.path()));
  assert.equal(pages, 2);
  assert.match(text, /Form page 1/, 'original text kept as text');
  assert.match(text, /Pat Q\. Example/, 'typed text is real text');
  assert.doesNotMatch(text, /Pat Example/, 'edited, not duplicated');
  assert.deepEqual(errors, []);
  await context.close();
});

test('PDF work survives closing the app; eraser and undo work', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page } = await openPdfTab(context);
  await page.getByRole('button', { name: /Cross/ }).click();
  let b = await pageBox(page, 0); // measure after each tool tap (it may scroll)
  await page.mouse.click(b.x + b.w * 0.5, b.y + b.h * 0.6);
  await page.getByRole('button', { name: /Eraser/ }).click();
  b = await pageBox(page, 0);
  await page.mouse.click(b.x + b.w * 0.5, b.y + b.h * 0.6);
  await page.getByRole('button', { name: 'Undo' }).click(); // cross is back
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('text=Continue with form.pdf?');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => document.querySelector('.pw-base')?.width > 0);
  const saved = await page.evaluate(async () => (await new Promise((r) => { const q = indexedDB.open('command-center'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('pdfwrite.session'); g.onsuccess = () => r(g.result); }; })).items);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].type, 'cross');
  await context.close();
});

test('a PDF made in Convert can be sent to the PDF tab', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${origin}${BASE}#/files/convert`);
  await page.setInputFiles('#cv-files', [resolve(import.meta.dirname, '../fixtures/web/tiny.jpg')]);
  await page.getByRole('radio', { name: 'PDF', exact: true }).click();
  await page.getByRole('button', { name: /^Convert/ }).click();
  await page.getByRole('button', { name: 'Write on it' }).click();
  await page.waitForFunction(() => location.hash === '#/files/pdf' && document.querySelectorAll('.pw-page').length === 1);
  await context.close();
});

test('signature: draw once, stamp twice, drag, and it is remembered', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page, errors } = await openPdfTab(context);
  await page.getByRole('button', { name: /✒️ Signature/ }).click();
  await page.getByRole('button', { name: 'Draw signature' }).click();
  const pad = await page.$eval('.sig-pad', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.mouse.move(pad.x + 30, pad.y + 120);
  await page.mouse.down();
  for (let i = 1; i < 20; i++) await page.mouse.move(pad.x + 30 + i * 12, pad.y + 120 - Math.sin(i / 2) * 40);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForSelector('.ed-dialog', { state: 'detached' });

  let b = await pageBox(page, 0);
  await page.mouse.click(b.x + b.w * 0.5, b.y + b.h * 0.7);
  b = await pageBox(page, 1);
  await page.mouse.click(b.x + b.w * 0.5, b.y + b.h * 0.7);
  assert.equal(await page.$$eval('.ed-dialog', (d) => d.length), 0, 'no pad the second time');

  // Drag the first signature down a bit.
  b = await pageBox(page, 0);
  await page.waitForTimeout(500); // autosave
  const items = async () => page.evaluate(async () => (await new Promise((r) => { const q = indexedDB.open('command-center'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('pdfwrite.session'); g.onsuccess = () => r(g.result); }; })).items);
  const before = await items();
  assert.equal(before.length, 2);
  assert.equal(before[0].type, 'sign');
  const [u0, v0] = before[0].strokes[0][0];
  await page.mouse.move(b.x + b.w * u0, b.y + b.h * v0);
  await page.mouse.down();
  await page.mouse.move(b.x + b.w * u0, b.y + b.h * (v0 + 0.1), { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await items();
  assert.ok(Math.abs(after[0].strokes[0][0][1] - (v0 + 0.1)) < 0.02, 'moved down');

  // Remembered across sessions.
  assert.ok(await page.evaluate(() => !!JSON.parse(localStorage.getItem('cc.pdf.signatures')).signature));
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => /form-signed\.pdf/.test(document.querySelector('.ed-dialog .muted')?.textContent ?? ''));
  assert.deepEqual(errors, []);
  await context.close();
});

test('zoom: buttons and a two-finger pinch enlarge pages and re-render them sharp', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const { page, errors } = await openPdfTab(context);
  const widths = () => page.$eval('.pw-page[data-page="0"]', (n) => ({ css: n.clientWidth, px: n.querySelector('.pw-base').width }));
  const w1 = await widths();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForFunction((w) => document.querySelector('.pw-base').width > w * 1.4, w1.px);
  const w2 = await widths();
  assert.ok(w2.css > w1.css * 1.4, `css ${w1.css} -> ${w2.css}`);
  assert.equal(await page.$eval('.pw-zoom .linkish', (b) => b.textContent), '150%');
  await page.getByRole('button', { name: 'Fit width' }).click();
  await page.waitForFunction((w) => document.querySelector('.pw-page').clientWidth === w, w1.css);

  // Pinch out with two fingers while a drawing tool is active: zooms, draws nothing.
  await page.getByRole('button', { name: '✍ Draw', exact: true }).click();
  const b = await pageBox(page, 0); // measure after the tap, which may scroll
  const cx = b.x + b.w / 2; const cy = 520; // middle of the screen, on the page
  const cdp = await context.newCDPSession(page);
  const touch = (type, d) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }] });
  await touch('touchStart', 40);
  for (let d = 50; d <= 120; d += 10) await touch('touchMove', d);
  await touch('touchEnd', 0);
  await page.waitForTimeout(500);
  const w3 = await widths();
  assert.ok(w3.css > w1.css * 2, `pinch zoomed ${w1.css} -> ${w3.css}`);
  const saved = await page.evaluate(async () => (await new Promise((r) => { const q = indexedDB.open('command-center'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('pdfwrite.session'); g.onsuccess = () => r(g.result); }; })).items);
  assert.equal(saved.length, 0, 'the pinch did not leave a stroke');
  await page.getByRole('button', { name: /T Text/ }).click();
  await page.getByRole('button', { name: 'Fit width' }).click();
  const b2 = await pageBox(page, 0);
  const t = (type, d) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: b2.x + 150 - d, y: 520, id: 1 }, { x: b2.x + 150 + d, y: 520, id: 2 }] });
  await t('touchStart', 30); for (let d = 40; d <= 90; d += 10) await t('touchMove', d); await t('touchEnd', 0);
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval('.ed-dialog', (d) => d.length), 0, 'pinching with the Text tool does not open the text box');
  assert.deepEqual(errors, []);
  await context.close();
});
