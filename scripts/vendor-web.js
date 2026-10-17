// Copy third-party browser libraries into web/vendor/ (`npm run vendor`). They are committed so
// GitHub Pages can serve the PWA with no build step, and the service worker can cache them offline.
import { cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
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
];
const pdfWasm = ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm', 'LICENSE_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_JBIG2', 'LICENSE_PDFJS_OPENJPEG', 'LICENSE_PDFJS_QCMS', 'LICENSE_QCMS'];

rmSync(out, { recursive: true, force: true });
for (const [from, to] of copies) {
  mkdirSync(join(out, to, '..'), { recursive: true });
  cpSync(join(nm, from), join(out, to), { recursive: true });
}
mkdirSync(join(out, 'pdfjs/wasm'), { recursive: true });
for (const f of pdfWasm) cpSync(join(nm, 'pdfjs-dist/wasm', f), join(out, 'pdfjs/wasm', f));
console.log('vendored:', readdirSync(out).join(', '));
