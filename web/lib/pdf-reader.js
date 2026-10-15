// Reading PDFs with pdf.js (vendor/pdfjs). Everything is loaded from this site, so it works offline.
import { fitSize } from './image.js';

const base = new URL('../vendor/pdfjs/', import.meta.url).href;
let libPromise;
const tasks = new WeakMap(); // doc -> loading task (pdf.js v6 closes documents via the task)

function pdfjs() {
  libPromise ??= import('../vendor/pdfjs/pdf.min.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
    return lib;
  });
  return libPromise;
}

export async function openPdf(file) {
  const lib = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = lib.getDocument({
    data,
    standardFontDataUrl: base + 'standard_fonts/',
    wasmUrl: base + 'wasm/',
    isEvalSupported: false,
    enableXfa: false,
  });
  try {
    const doc = await task.promise;
    tasks.set(doc, task);
    return doc;
  } catch (err) {
    task.destroy();
    if (err?.name === 'PasswordException') throw new Error('This PDF is password-protected.');
    throw new Error(`Could not read this PDF: ${err?.message ?? err}`);
  }
}

/** Render page n (1-based) at `dpi`, capped to maxEdge and the canvas budget. Returns a canvas. */
export async function renderPage(doc, n, { dpi = 150, maxEdge = Infinity } = {}) {
  const page = await doc.getPage(n);
  const base1 = page.getViewport({ scale: 1 }); // 72 dpi
  const want = dpi / 72;
  const { scale } = fitSize(base1.width * want, base1.height * want, maxEdge);
  const viewport = page.getViewport({ scale: want * scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
  page.cleanup();
  return canvas;
}

/** Free the document and its worker resources. */
export async function closePdf(doc) {
  await tasks.get(doc)?.destroy();
}
