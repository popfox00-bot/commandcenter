#!/usr/bin/env node
// Scores FM's face swaps on your own photos, in numbers, to tune it by (web/tools/editor/swap-score.js):
// for each pair it runs ⚡ Quick Swap in the real app (a browser, offline), finds the faces again in the
// result, and reports how well it's lined up with the face it went on, how much of the new face's own
// shape it kept, and how visible the seam is (0 is perfect for each). Your photos stay where they are:
// nothing is copied into the repository or sent anywhere.
//
//   node scripts/score-swaps.mjs <folder> [--json out.json] [--save <folder for the results>]
//
// <folder> holds one folder per pair, each with base.jpg (the photo to change) and char.jpg (the new face).
// Any result*.jpg there (a swap saved earlier, or made another way) is scored too, as it is, to compare.

import { createServer } from 'node:http';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const WEB = resolve(import.meta.dirname, '../web');
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };

const args = process.argv.slice(2);
const dir = args.find((a, i) => !a.startsWith('--') && !['--json', '--save'].includes(args[i - 1]));
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const saveDir = args.includes('--save') ? args[args.indexOf('--save') + 1] : null;
if (!dir) { console.error('usage: node scripts/score-swaps.mjs <folder of pairs> [--json out.json]'); process.exit(2); }

const pairs = [];
for (const name of (await readdir(dir)).sort()) {
  const d = join(dir, name);
  if (!(await stat(d)).isDirectory()) continue;
  const files = await readdir(d);
  const base = files.find((f) => /^base\.(jpe?g|png|webp)$/i.test(f)); const char = files.find((f) => /^char\.(jpe?g|png|webp)$/i.test(f));
  if (base && char) pairs.push({ name, base: join(d, base), char: join(d, char), saved: files.filter((f) => /^result.*\.(jpe?g|png|webp)$/i.test(f)).sort().map((f) => join(d, f)) });
}
if (!pairs.length) { console.error(`No pairs in ${dir} (each a folder with base.jpg and char.jpg).`); process.exit(2); }

const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try { const rel = p.slice('/commandcenter/web/'.length) || 'index.html'; res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' }).end(await readFile(join(WEB, rel))); } catch { if (!res.headersSent) res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/commandcenter/web/index.html#/fm`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

/** Scores a saved result (an image file) against its pair, in a page of the app. */
async function scoreSaved(page, pair, file) {
  const [b, c, r] = await Promise.all([readFile(pair.base), readFile(pair.char), readFile(file)]);
  return page.evaluate(async ([b64Base, b64Char, b64Result]) => {
    const { detectFaces } = await import('./lib/face.js');
    const { scoreSwap } = await import('./tools/editor/swap-score.js');
    const load = async (b64) => { const i = new Image(); i.src = `data:image/jpeg;base64,${b64}`; await i.decode(); const cv = document.createElement('canvas'); cv.width = i.naturalWidth; cv.height = i.naturalHeight; cv.getContext('2d').drawImage(i, 0, 0); return cv; };
    const result = await load(b64Result); const photo = await load(b64Base); const char = await load(b64Char);
    const base = document.createElement('canvas'); base.width = result.width; base.height = result.height;
    const bx = base.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(photo, 0, 0, result.width, result.height);
    const biggest = (fs) => fs.sort((p, q) => q.box.w * q.box.h - p.box.w * p.box.h)[0];
    const fb = biggest(await detectFaces(base)); const fc = biggest(await detectFaces(char)); const fr = biggest(await detectFaces(result));
    if (!fb || !fc || !fr) return { error: 'face not found again' };
    const px = (f, cv) => f.pts.map(([u, v]) => [u * cv.width, v * cv.height]);
    const data = (cv) => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    return scoreSwap({ base: px(fb, base), character: px(fc, char), result: px(fr, result), rgba: data(result), before: data(base), W: base.width, H: base.height });
  }, [b.toString('base64'), c.toString('base64'), r.toString('base64')]);
}

const results = [];
for (const pair of pairs) {
  for (const file of pair.saved) {
    const page = await (await browser.newContext()).newPage();
    try { await page.goto(url); results.push({ pair: `${pair.name}/${file.split('/').pop()}`, ...(await scoreSaved(page, pair, file)) }); } catch (err) { results.push({ pair: `${pair.name}/${file.split('/').pop()}`, error: String(err.message ?? err).split('\n')[0] }); } finally { await page.context().close(); }
  }
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const t0 = Date.now();
  try {
    await page.goto(url);
    await page.waitForSelector('#ed-file', { state: 'attached' });
    await page.getByRole('button', { name: '⚡ Quick Swap faces' }).click();
    await page.setInputFiles('#qs-base', pair.base);
    await page.setInputFiles('#qs-face', pair.char);
    await page.locator('dialog[open].qs-pick').getByRole('button', { name: '⚡ Swap' }).click();
    await page.waitForSelector('.ed-panel >> text=/⚡ Swapped|No face|Couldn|didn/', { timeout: 600000 });
    const note = await page.locator('.ed-panel p[aria-live]').last().textContent();
    if (!/Swapped/.test(note)) throw new Error(note);
    const [baseB, charB] = await Promise.all([readFile(pair.base), readFile(pair.char)]);
    const score = await page.evaluate(async ([b64Base, b64Char]) => {
      const { detectFaces } = await import('./lib/face.js');
      const { scoreSwap } = await import('./tools/editor/swap-score.js');
      const load = async (b64) => { const i = new Image(); i.src = `data:image/jpeg;base64,${b64}`; await i.decode(); const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; c.getContext('2d').drawImage(i, 0, 0); return c; };
      const shown = document.querySelector('.ed-canvas');
      const photo = await load(b64Base); const char = await load(b64Char);
      // The result as the editor shows it, and the photo before at that same size, drawn the same way (so
      // only what the swap changed differs between them).
      const result = document.createElement('canvas'); result.width = shown.width; result.height = shown.height; result.getContext('2d').drawImage(shown, 0, 0);
      const base = document.createElement('canvas'); base.width = shown.width; base.height = shown.height;
      const bx = base.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(photo, 0, 0, shown.width, shown.height);
      const biggest = (fs) => fs.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
      const fb = biggest(await detectFaces(base)); const fc = biggest(await detectFaces(char)); const fr = biggest(await detectFaces(result));
      if (!fb || !fc || !fr) return { error: `face not found again (${!fb ? 'base ' : ''}${!fc ? 'new face ' : ''}${!fr ? 'result' : ''})` };
      const px = (f, c) => f.pts.map(([u, v]) => [u * c.width, v * c.height]);
      const data = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      return scoreSwap({ base: px(fb, base), character: px(fc, char), result: px(fr, result), rgba: data(result), before: data(base), W: base.width, H: base.height });
    }, [baseB.toString('base64'), charB.toString('base64')]);
    // (--save <folder>: each swap's result, as the editor shows it, to look at.)
    if (saveDir) {
      const b64 = await page.evaluate(() => document.querySelector('.ed-canvas').toDataURL('image/jpeg', 0.9).split(',')[1]);
      await writeFile(join(saveDir, `${pair.name}.jpg`), Buffer.from(b64, 'base64'));
    }
    results.push({ pair: pair.name, seconds: Math.round((Date.now() - t0) / 100) / 10, ...score });
  } catch (err) {
    results.push({ pair: pair.name, error: String(err.message ?? err).split('\n')[0] });
  } finally { await page.context().close(); }
}
await browser.close(); server.close();

const f = (v) => (typeof v === 'number' ? v.toFixed(3) : '—');
console.log('pair'.padEnd(24), 'aligned', 'inner', 'shape', ' seam', ' secs');
for (const r of results) console.log(String(r.pair).padEnd(24), r.error ? `  error: ${r.error}` : `${f(r.alignment)}   ${f(r.inner)} ${f(r.distortion)} ${f(r.seam)} ${String(r.seconds ?? '').padStart(5)}`);
const ok = results.filter((r) => !r.error);
const avg = (k) => f(ok.reduce((t, r) => t + r[k], 0) / ok.length);
if (ok.length > 1) console.log('mean'.padEnd(24), `${avg('alignment')}   ${avg('inner')} ${avg('distortion')} ${avg('seam')}`);
console.log('(0 is perfect for each: aligned ~0.05 is close (inner: eyes, brows, nose, mouth only), shape ~0.05 is itself, seam ~0 can\'t be seen.)');
if (jsonOut) await writeFile(jsonOut, JSON.stringify(results, null, 2));
