// "Write on PDF": annotations are saved into the original PDF without rasterizing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lib from 'pdf-lib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyToPdf, toPdf, hitTest, displaySize } from '../web/tools/pdfwrite/annotate.js';

async function samplePdf() {
  const doc = await lib.PDFDocument.create();
  const font = await doc.embedFont(lib.StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('Original text', { x: 72, y: 700, size: 14, font });
  const p2 = doc.addPage([612, 792]);
  p2.setRotation(lib.degrees(90));
  return doc.save();
}

async function textItems(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fonts = resolve(import.meta.dirname, '../node_modules/pdfjs-dist/standard_fonts') + '/';
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: fonts });
  const doc = await task.promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!it.str.trim()) continue;
      // Position in display space (after /Rotate), normalized, origin top-left.
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      out.push({ page: n - 1, str: it.str, u: x / vp.width, v: y / vp.height });
    }
  }
  await task.destroy();
  return out;
}

test('display coordinates map to PDF space for every page rotation', () => {
  const info = { x: 0, y: 0, width: 600, height: 800, rotate: 0 };
  assert.deepEqual(toPdf(info, 0, 0), { x: 0, y: 800 });
  assert.deepEqual(toPdf({ ...info, rotate: 90 }, 0, 0), { x: 0, y: 0 });
  assert.deepEqual(toPdf({ ...info, rotate: 180 }, 0, 0), { x: 600, y: 0 });
  assert.deepEqual(toPdf({ ...info, rotate: 270 }, 0, 0), { x: 600, y: 800 });
  assert.deepEqual(displaySize({ ...info, rotate: 90 }), { w: 800, h: 600 });
  assert.deepEqual(toPdf({ ...info, x: 10, y: 20 }, 1, 1), { x: 610, y: 20 }, 'media box offset');
});

test('text, ink, marks and boxes are written; original content stays; positions match the screen', async () => {
  const original = await samplePdf();
  const items = [
    { page: 0, type: 'text', u: 0.5, v: 0.5, text: 'Signed by Pat\nLine two', size: 12, color: '#0a3fd1' },
    { page: 0, type: 'ink', points: [[0.1, 0.8], [0.2, 0.82], [0.3, 0.79]], width: 2, color: '#111111' },
    { page: 0, type: 'check', u: 0.1, v: 0.1, size: 14, color: '#111111' },
    { page: 0, type: 'whiteout', u1: 0.6, v1: 0.6, u2: 0.8, v2: 0.65 },
    { page: 0, type: 'highlight', u1: 0.1, v1: 0.1, u2: 0.4, v2: 0.15 },
    { page: 0, type: 'box', u1: 0.1, v1: 0.3, u2: 0.4, v2: 0.4, color: '#ff3b30', width: 2 },
    { page: 1, type: 'text', u: 0.25, v: 0.25, text: 'Rotated page', size: 12, color: '#111111' },
  ];
  const { bytes, replacedChars } = await applyToPdf(lib, original, items);
  assert.equal(replacedChars, 0);
  const texts = await textItems(bytes);
  assert.ok(texts.some((t) => t.str === 'Original text'), 'original text is still real text');
  const signed = texts.find((t) => t.str === 'Signed by Pat');
  assert.ok(signed, 'added text is selectable text, not an image');
  assert.ok(Math.abs(signed.u - 0.5) < 0.01, `x ${signed.u}`);
  assert.ok(Math.abs(signed.v - (0.5 + (0.78 * 12) / 792)) < 0.01, `baseline ${signed.v}`);
  assert.ok(texts.some((t) => t.str === 'Line two'));
  const rotated = texts.find((t) => t.str === 'Rotated page');
  assert.equal(rotated.page, 1);
  assert.ok(Math.abs(rotated.u - 0.25) < 0.01 && Math.abs(rotated.v - (0.25 + (0.78 * 12) / 612)) < 0.01, `rotated page position ${rotated.u},${rotated.v}`);
  const doc = await lib.PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
});

test('characters the standard font cannot encode are replaced, not fatal', async () => {
  const { bytes, replacedChars } = await applyToPdf(lib, await samplePdf(), [{ page: 0, type: 'text', u: 0.1, v: 0.1, text: 'OK ✓ 中', size: 12, color: '#000000' }]);
  assert.equal(replacedChars, 2);
  assert.ok((await textItems(bytes)).some((t) => t.str.startsWith('OK ?')));
});

test('password-protected PDFs are refused clearly', async () => {
  // test/fixtures/web/encrypted.pdf: one blank page, user password "secret" (made with pypdf).
  const bytes = new Uint8Array(readFileSync(resolve(import.meta.dirname, 'fixtures/web/encrypted.pdf')));
  await assert.rejects(applyToPdf(lib, bytes, []), /encrypt/i);
});

test('hit testing finds annotations on the right page', () => {
  const info = { x: 0, y: 0, width: 612, height: 792, rotate: 0 };
  const items = [
    { page: 0, type: 'text', u: 0.5, v: 0.5, text: 'Hello', size: 12, color: '#000' },
    { page: 1, type: 'box', u1: 0.1, v1: 0.1, u2: 0.2, v2: 0.2, color: '#000', width: 1 },
  ];
  assert.equal(hitTest(items, 0, 0.51, 0.505, info), 0);
  assert.equal(hitTest(items, 0, 0.15, 0.15, info), -1, 'box is on another page');
  assert.equal(hitTest(items, 1, 0.15, 0.15, info), 1);
});

test('saved signatures are normalized once and stamped as one item that saves as vector strokes', async () => {
  const { normalizeStrokes, signItem } = await import('../web/tools/pdfwrite/signature.js');
  const sig = normalizeStrokes([[[10, 50], [60, 20], [110, 50]], [[20, 70], [100, 70]]], 3);
  assert.equal(sig.aspect, 100 / 50);
  assert.deepEqual(sig.strokes[0][0], [0, 0.6]);
  assert.equal(normalizeStrokes([[[1, 1]]], 3), null, 'a single dot is not a signature');
  const info = { x: 0, y: 0, width: 612, height: 792, rotate: 0 };
  const item = signItem(sig, 0, info, 0.5, 0.5, 36, '#111111');
  const us = item.strokes.flat().map((p) => p[0]); const vs = item.strokes.flat().map((p) => p[1]);
  assert.ok(Math.abs((Math.max(...vs) - Math.min(...vs)) * 792 - 36) < 1e-6, '36 pt tall');
  assert.ok(Math.abs((Math.max(...us) - Math.min(...us)) * 612 - 72) < 1e-6, 'aspect kept');
  assert.equal(hitTest([item], 0, 0.5, Math.max(...vs), info), 0, 'tap on the underline stroke');
  assert.equal(hitTest([item], 0, 0.9, 0.9, info), -1);
  const { bytes } = await applyToPdf(lib, await samplePdf(), [item]);
  assert.equal((await lib.PDFDocument.load(bytes)).getPageCount(), 2);
});
