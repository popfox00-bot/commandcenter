// Minimal PDF writer: one image per page. Works in browsers and Node.
// Images are JPEG (embedded as-is, DCTDecode) or raw RGB compressed with zlib (FlateDecode, lossless).

import { concat } from './zip.js';

const PAGE_SIZES = { letter: [612, 792], a4: [595.28, 841.89] }; // points (1/72 in)

/**
 * pages: [{ width, height, image: { kind: 'jpeg', bytes } | { kind: 'flate', bytes, width, height } }]
 *   width/height are the image's pixel size.
 * opts.pageSize: 'fit' (page = image at 72 dpi... scaled so the long edge is 11in) | 'letter' | 'a4'
 * opts.margin: points, for letter/a4.
 */
export function createPdf(pages, { pageSize = 'fit', margin = 36, title = 'Converted' } = {}) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (b) => { const bytes = typeof b === 'string' ? enc.encode(b) : b; chunks.push(bytes); length += bytes.length; };
  const startObj = (n) => { offsets[n] = length; push(`${n} 0 obj\n`); };

  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'); // second line: high bytes mark the file as binary
  // Object numbering: 1 catalog, 2 pages, 3 info, then per page: page, content, image.
  const pageObjs = pages.map((_, i) => 4 + i * 3);
  const fmt = (n) => Number(n.toFixed(2)).toString();

  startObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2); push(`<< /Type /Pages /Kids [${pageObjs.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);
  startObj(3); push(`<< /Producer (Command Center) /Title (${title.replace(/[()\\]/g, '\\$&')}) >>\nendobj\n`);

  pages.forEach((p, i) => {
    const [pageNo, contentNo, imageNo] = [pageObjs[i], pageObjs[i] + 1, pageObjs[i] + 2];
    let pw, ph, dw, dh, dx, dy;
    if (pageSize === 'fit') {
      // Page sized to the image, long edge 11 inches.
      const scale = 792 / Math.max(p.width, p.height);
      pw = dw = p.width * scale; ph = dh = p.height * scale; dx = dy = 0;
    } else {
      [pw, ph] = PAGE_SIZES[pageSize];
      if (p.width > p.height) [pw, ph] = [ph, pw]; // landscape page for landscape images
      const scale = Math.min((pw - 2 * margin) / p.width, (ph - 2 * margin) / p.height);
      dw = p.width * scale; dh = p.height * scale; dx = (pw - dw) / 2; dy = (ph - dh) / 2;
    }
    startObj(pageNo);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pw)} ${fmt(ph)}] /Resources << /XObject << /Im${i} ${imageNo} 0 R >> >> /Contents ${contentNo} 0 R >>\nendobj\n`);
    const content = `q ${fmt(dw)} 0 0 ${fmt(dh)} ${fmt(dx)} ${fmt(dy)} cm /Im${i} Do Q`;
    startObj(contentNo); push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    const img = p.image;
    const filter = img.kind === 'jpeg' ? '/DCTDecode' : '/FlateDecode';
    startObj(imageNo);
    push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter} /Length ${img.bytes.length} >>\nstream\n`);
    push(img.bytes);
    push('\nendstream\nendobj\n');
  });

  const count = 4 + pages.length * 3;
  const xrefAt = length;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return concat(chunks);
}

/** RGBA pixels -> zlib-compressed RGB (for lossless FlateDecode pages), flattening alpha onto `background`. */
export async function rgbaToFlate(rgba, background = [255, 255, 255]) {
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const a = rgba[i + 3] / 255;
    rgb[j] = Math.round(rgba[i] * a + background[0] * (1 - a));
    rgb[j + 1] = Math.round(rgba[i + 1] * a + background[1] * (1 - a));
    rgb[j + 2] = Math.round(rgba[i + 2] * a + background[2] * (1 - a));
  }
  // CompressionStream('deflate') produces zlib format, which is what FlateDecode expects.
  const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
