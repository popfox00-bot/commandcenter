// File conversion logic (no UI). Everything happens in this browser tab.
//
//   images (HEIC, JPEG, PNG, WebP, GIF, AVIF, BMP, SVG) -> JPEG | PNG | WebP | PDF
//   PDF pages                                          -> JPEG | PNG | WebP | PDF (pages as images)
//
// Re-encoding drops all metadata (EXIF, GPS location, camera info). Orientation is applied first.

import { sniffType, decodeImage, fitSize, drawToCanvas, encodeCanvas, IMAGE_TYPES, MAX_CANVAS_PIXELS } from '../../lib/image.js';
import { createPdf, rgbaToFlate } from '../../lib/pdf-writer.js';
import { renameExt } from '../../lib/files.js';

export const TARGETS = {
  jpeg: { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', lossy: true },
  png: { label: 'PNG', mime: 'image/png', ext: 'png', lossy: false },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true },
  pdf: { label: 'PDF', mime: 'application/pdf', ext: 'pdf', lossy: true },
};

export const DEFAULT_OPTIONS = {
  target: 'jpeg',
  quality: 0.85,        // JPEG / WebP / PDF (JPEG pages)
  maxEdge: 0,           // 0 = original size (still capped by the browser's canvas limit)
  pdfPageSize: 'fit',   // fit | letter | a4
  pdfCombine: true,     // one PDF for all inputs
  pdfLossless: false,   // PNG-quality pages (bigger files)
  pdfDpi: 150,          // when reading PDFs
};

/** Describe inputs before converting: [{ file, type, label, isPdf }]. */
export async function inspect(files) {
  return Promise.all([...files].map(async (file) => {
    const type = await sniffType(file);
    const isPdf = type === 'application/pdf';
    const label = isPdf ? 'PDF' : IMAGE_TYPES[type] ?? (type.split('/')[1] || 'file').toUpperCase();
    const supported = isPdf || type.startsWith('image/');
    return { file, type, label, isPdf, supported };
  }));
}

/**
 * Convert inputs. Returns { outputs: [{ name, blob, source, width, height, note? }], errors: [{ name, message }] }.
 * onProgress({ done, total, label }) is called as work proceeds; `signal` can cancel between steps.
 */
export async function convert(inputs, options = {}, { onProgress, signal } = {}) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const target = TARGETS[o.target];
  if (!target) throw new Error(`Unknown target ${o.target}`);
  const maxEdge = o.maxEdge > 0 ? o.maxEdge : Infinity;
  const outputs = [];
  const errors = [];
  const pdfPages = []; // for combined PDF output
  let done = 0;
  let total = inputs.length;
  const tick = (label) => onProgress?.({ done, total, label });

  // Turn one source canvas into the requested output (or a PDF page).
  async function emit(canvas, name, source, suffix, note) {
    if (o.target === 'pdf') {
      const page = await canvasToPdfPage(canvas, o);
      if (o.pdfCombine) pdfPages.push(page);
      else outputs.push({ name: renameExt(name, 'pdf', suffix), blob: new Blob([createPdf([page], { pageSize: o.pdfPageSize, title: name })], { type: 'application/pdf' }), source, width: canvas.width, height: canvas.height, note });
      return;
    }
    const blob = await encodeCanvas(canvas, target.mime, o.quality);
    outputs.push({ name: renameExt(name, target.ext, suffix), blob, source, width: canvas.width, height: canvas.height, note });
  }

  for (const input of inputs) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const { file } = input;
    tick(file.name);
    try {
      if (!input.supported) throw new Error('Not an image or PDF.');
      if (input.isPdf) {
        const { openPdf, renderPage, closePdf } = await import('../../lib/pdf-reader.js');
        const doc = await openPdf(file);
        total += doc.numPages - 1;
        for (let n = 1; n <= doc.numPages; n++) {
          if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
          tick(`${file.name} · page ${n}/${doc.numPages}`);
          const canvas = await renderPage(doc, n, { dpi: o.pdfDpi, maxEdge });
          await emit(canvas, file.name, file.name, doc.numPages > 1 ? `-p${n}` : '');
          releaseCanvas(canvas);
          if (n < doc.numPages) done += 1;
        }
        await closePdf(doc);
      } else {
        const bitmap = await decodeImage(file, input.type);
        const fit = fitSize(bitmap.width, bitmap.height, maxEdge);
        const note = fit.scale < 1 && maxEdge === Infinity
          ? `Scaled to ${fit.width}×${fit.height}: the browser can't handle more than ${Math.round(MAX_CANVAS_PIXELS / 1e6)} MP.`
          : undefined;
        const background = o.target === 'jpeg' || o.target === 'pdf' ? '#ffffff' : null;
        const canvas = drawToCanvas(bitmap, fit.width, fit.height, background);
        bitmap.close?.();
        await emit(canvas, file.name, file.name, '', note);
        releaseCanvas(canvas);
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      errors.push({ name: file.name, message: err?.message ?? String(err) });
    }
    done += 1;
    tick(file.name);
  }

  if (o.target === 'pdf' && o.pdfCombine && pdfPages.length) {
    const first = inputs[0]?.file.name ?? 'converted';
    const name = inputs.length > 1 ? `${first.replace(/\.[^.]+$/, '')}-and-${inputs.length - 1}-more.pdf` : renameExt(first, 'pdf');
    outputs.push({ name, blob: new Blob([createPdf(pdfPages, { pageSize: o.pdfPageSize, title: name })], { type: 'application/pdf' }), source: `${pdfPages.length} page${pdfPages.length === 1 ? '' : 's'}`, width: null, height: null });
  }
  return { outputs, errors };
}

async function canvasToPdfPage(canvas, o) {
  if (o.pdfLossless) {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return { width: canvas.width, height: canvas.height, image: { kind: 'flate', bytes: await rgbaToFlate(data) } };
  }
  const blob = await encodeCanvas(canvas, 'image/jpeg', o.quality);
  return { width: canvas.width, height: canvas.height, image: { kind: 'jpeg', bytes: new Uint8Array(await blob.arrayBuffer()) } };
}

/** iOS keeps canvas memory around until the size is zeroed; free it promptly in batches. */
function releaseCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}
