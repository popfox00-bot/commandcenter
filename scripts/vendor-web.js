// Copy third-party browser libraries into web/vendor/ (`npm run vendor`). They are committed so
// GitHub Pages can serve the PWA with no build step, and the service worker can cache them offline.
import { cpSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const nm = join(root, 'node_modules');
const out = join(root, 'web/vendor');

const copies = [
  // pdf.js (Apache-2.0): reading PDFs. Legacy build for older iOS versions.
  ['pdfjs-dist/legacy/build/pdf.min.mjs', 'pdfjs/pdf.min.mjs'],
  ['pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs'],
  ['pdfjs-dist/standard_fonts', 'pdfjs/standard_fonts'],
  ['pdfjs-dist/LICENSE', 'pdfjs/LICENSE'],
  // libwebp encoder from jSquash/Squoosh (Apache-2.0): Safari can't reliably encode WebP itself.
  ['@jsquash/webp/codec/enc/webp_enc.js', 'webp/webp_enc.js'],
  ['@jsquash/webp/codec/enc/webp_enc.wasm', 'webp/webp_enc.wasm'],
  ['@jsquash/webp/LICENSE', 'webp/LICENSE'],
  // pdf-lib (MIT): adds text, ink and shapes to existing PDFs without rasterizing their pages.
  ['pdf-lib/dist/pdf-lib.esm.min.js', 'pdf-lib/pdf-lib.esm.min.js'],
  ['pdf-lib/LICENSE.md', 'pdf-lib/LICENSE.md'],
  // ZXing-C++ reader as WebAssembly (zxing-wasm, MIT; ZXing-C++ is Apache-2.0): QR codes and barcodes.
  // reader/index.js imports ../share.js, so the layout is kept.
  ['zxing-wasm/dist/es/reader/index.js', 'zxing/reader/index.js'],
  ['zxing-wasm/dist/es/share.js', 'zxing/share.js'],
  ['zxing-wasm/dist/reader/zxing_reader.wasm', 'zxing/zxing_reader.wasm'],
  ['zxing-wasm/LICENSE', 'zxing/LICENSE'],
  // uqr (MIT): QR code encoder (module matrix only; the app draws it).
  ['uqr/dist/index.mjs', 'uqr/uqr.mjs'],
  ['uqr/LICENSE', 'uqr/LICENSE'],
  // Tesseract.js (Apache-2.0): reading the text in a screenshot or photo (Rap → Import), on the phone.
  // The SIMD + LSTM core (iOS 16.4+, current Android and desktops) and the compact English model.
  ['tesseract.js/dist/tesseract.esm.min.js', 'tesseract/tesseract.esm.min.js'],
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  ['tesseract.js/LICENSE.md', 'tesseract/LICENSE.md'],
  ['tesseract.js-core/tesseract-core-simd-lstm.js', 'tesseract/tesseract-core-simd-lstm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract/tesseract-core-simd-lstm.wasm'],
  ['tesseract.js-core/LICENSE', 'tesseract/LICENSE-core'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tesseract/lang/eng.traineddata.gz'],
];
const pdfWasm = ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm', 'LICENSE_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_JBIG2', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_PDFJS_QCMS', 'LICENSE_QCMS'];

rmSync(out, { recursive: true, force: true });
for (const [from, to] of copies) {
  mkdirSync(join(out, to, '..'), { recursive: true });
  cpSync(join(nm, from), join(out, to), { recursive: true });
}
mkdirSync(join(out, 'pdfjs/wasm'), { recursive: true });
for (const f of pdfWasm) cpSync(join(nm, 'pdfjs-dist/wasm', f), join(out, 'pdfjs/wasm', f));
// Drop source-map comments: the maps aren't shipped, and browsers would request them.
for (const f of ['pdf-lib/pdf-lib.esm.min.js', 'tesseract/tesseract.esm.min.js', 'tesseract/worker.min.js']) {
  const p = join(out, f);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n'));
}
console.log('vendored:', readdirSync(out).join(', '));
