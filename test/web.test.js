// Node tests for the PWA's pure modules (no browser): ZIP and PDF writers, offline file list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createZip, crc32 } from '../web/lib/zip.js';
import { createPdf, rgbaToFlate } from '../web/lib/pdf-writer.js';
import { buildManifest, renderSw, WEB } from '../scripts/build-precache.js';

const fixture = (n) => new Uint8Array(readFileSync(resolve(import.meta.dirname, 'fixtures/web', n)));

async function loadPdf(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useWorkerFetch: false });
  const doc = await task.promise;
  doc.close = () => task.destroy();
  return doc;
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip: valid archive with unique UTF-8 names (verified by Python zipfile)', () => {
  const zip = createZip([
    { name: 'photo.jpg', bytes: fixture('tiny.jpg') },
    { name: 'photo.jpg', bytes: new TextEncoder().encode('second') },
    { name: 'résumé.pdf', bytes: new Uint8Array([1, 2, 3]) },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'cczip-'));
  const file = join(dir, 'out.zip');
  writeFileSync(file, zip);
  const out = execFileSync('python3', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("|".join(f"{i.filename}:{i.file_size}" for i in z.infolist()))', file], { encoding: 'utf8' }).trim();
  assert.equal(out, `photo.jpg:${fixture('tiny.jpg').length}|photo (2).jpg:6|résumé.pdf:3`);
});

test('pdf: JPEG and lossless pages open in pdf.js with the right page sizes', async () => {
  const jpeg = fixture('tiny.jpg'); // 64x48
  const rgba = new Uint8Array(10 * 20 * 4).fill(255);
  const flate = await rgbaToFlate(rgba);
  const bytes = createPdf([
    { width: 64, height: 48, image: { kind: 'jpeg', bytes: jpeg } },
    { width: 10, height: 20, image: { kind: 'flate', bytes: flate } },
  ], { pageSize: 'fit', title: 'Test (1)' });
  const doc = await loadPdf(bytes);
  assert.equal(doc.numPages, 2);
  const p1 = (await doc.getPage(1)).getViewport({ scale: 1 });
  assert.deepEqual([Math.round(p1.width), Math.round(p1.height)], [792, 594], 'long edge 11in, aspect kept');
  const p2 = (await doc.getPage(2)).getViewport({ scale: 1 });
  assert.deepEqual([Math.round(p2.width), Math.round(p2.height)], [396, 792]);
  const ops = await (await doc.getPage(1)).getOperatorList();
  assert.ok(ops.fnArray.length > 0);
  await doc.close();
});

test('pdf: letter and A4 pages turn landscape for landscape images', async () => {
  const jpeg = fixture('tiny.jpg');
  const doc = await loadPdf(createPdf([{ width: 64, height: 48, image: { kind: 'jpeg', bytes: jpeg } }], { pageSize: 'a4' }));
  const v = (await doc.getPage(1)).getViewport({ scale: 1 });
  assert.deepEqual([Math.round(v.width), Math.round(v.height)], [842, 595]);
  await doc.close();
});

test('service worker precache list is up to date (run `npm run precache`)', () => {
  const sw = readFileSync(join(WEB, 'sw.js'), 'utf8');
  assert.equal(sw, renderSw(buildManifest(), sw), 'web/sw.js is stale: run `npm run precache` and commit');
  const { files } = buildManifest();
  for (const must of ['index.html', 'app.js', 'tools/convert/convert.js', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/webp/webp_enc.wasm']) assert.ok(files.includes(must), must);
});
