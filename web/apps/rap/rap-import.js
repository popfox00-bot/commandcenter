// Rap → Import: lyrics into a new song from a text file, a Word document (.docx), a PDF, or a
// screenshot or photo of lyrics (its text read on the phone with Tesseract, vendor/tesseract). All on
// this phone, offline. importLyrics(file) → { title, lines }.

export const IMPORT_ACCEPT = '.txt,.text,.md,.rtf,.docx,.pdf,text/plain,text/markdown,application/rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,.heic,.heif';

/**
 * Lyrics from text: lines trimmed and spaced evenly, one blank line kept between verses, and the first
 * line as the title when it stands alone above the rest (short, then a blank line).
 */
export function lyricsFromText(text, fallbackTitle = '') {
  let lines = String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[\t  ]+/g, ' ').trim());
  // One blank line between verses at most, none at the ends.
  lines = lines.filter((l, i) => l || (i > 0 && lines[i - 1]));
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  let title = '';
  if (lines.length > 2 && lines[0].length <= 40 && !lines[1] && !/[.,;]$/.test(lines[0])) { title = lines[0].replace(/^#+\s*/, ''); lines = lines.slice(2); }
  // A generic file name (IMG_1234, Screenshot 2026-…) isn't a title: the song gets a smart one instead.
  if (!title && fallbackTitle && !/^(img|image|screenshot|scan|photo|document|untitled|new)[\s_-]?\d*/i.test(fallbackTitle) && /[a-z]{3}/i.test(fallbackTitle)) title = fallbackTitle;
  return { title: title.slice(0, 80), lines };
}

const baseName = (f) => String(f.name ?? '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

/** The lyrics in `file` (by its type), as { title, lines }. onProgress(0–1) while reading a picture. */
export async function importLyrics(file, { onProgress = () => {} } = {}) {
  const name = String(file.name ?? '').toLowerCase(); const type = file.type ?? '';
  let text;
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif|bmp)$/.test(name)) text = await textFromImage(file, onProgress);
  else if (type === 'application/pdf' || name.endsWith('.pdf')) text = await textFromPdf(file);
  else if (name.endsWith('.docx') || type.includes('wordprocessingml')) text = await textFromDocx(file);
  else if (name.endsWith('.doc')) throw new Error('Old Word files (.doc) can\'t be read here: save it as .docx (or as text) and import that.');
  else if (name.endsWith('.rtf') || type === 'application/rtf') text = textFromRtf(await file.text());
  else text = await file.text();
  return lyricsFromText(text, baseName(file));
}

// ---------- Word (.docx): a zip with word/document.xml ----------

/** The files in a zip: { name → { method, offset, size, compressed } } (from its central directory). */
function zipEntries(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('That isn\'t a Word document (.docx).');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const out = new Map(); const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true); const compressed = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true); const extraLen = dv.getUint16(p + 30, true); const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const fileName = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    out.set(fileName, { method, local, compressed });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
async function unzipFile(buf, entry) {
  const dv = new DataView(buf);
  const start = entry.local + 30 + dv.getUint16(entry.local + 26, true) + dv.getUint16(entry.local + 28, true);
  const data = new Uint8Array(buf, start, entry.compressed);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('This document can\'t be read on this device: save it as text and import that.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

/** The text of a .docx, a line per paragraph (and per line break). */
export async function textFromDocx(file) {
  const buf = await file.arrayBuffer();
  const doc = zipEntries(buf).get('word/document.xml');
  if (!doc) throw new Error('That Word document has no text.');
  const xml = await unzipFile(buf, doc);
  const unescape = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  // Each paragraph: its runs of text in order, with its line breaks and tabs.
  return xml.split(/<\/w:p>/).map((para) => {
    let line = '';
    for (const m of para.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\b[^>]*\/>|<w:tab\b[^>]*\/>/g)) line += m[1] !== undefined ? unescape(m[1]) : m[0].startsWith('<w:br') ? '\n' : ' ';
    return line;
  }).join('\n');
}

// ---------- RTF ----------

/** The text of an RTF document (its formatting dropped). */
export function textFromRtf(rtf) {
  return rtf.replace(/\\par[d]?\b/g, '\n').replace(/\\line\b/g, '\n').replace(/\{\\\*[^{}]*\}/g, '').replace(/\{\\(fonttbl|colortbl|stylesheet|info)[\s\S]*?\}\}?/g, '')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '').replace(/\\\\/g, '\\');
}

// ---------- PDF ----------

/** The text of a PDF, line by line (from where its pieces of text sit on the page). */
async function textFromPdf(file) {
  const { openPdf } = await import('../../lib/pdf-reader.js');
  const doc = await openPdf(file);
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    let line = ''; let y = null;
    for (const it of items) {
      const iy = Math.round(it.transform?.[5] ?? 0);
      if (y !== null && Math.abs(iy - y) > 2) { out.push(line); line = ''; }
      line += it.str; y = iy;
      if (it.hasEOL) { out.push(line); line = ''; y = null; }
    }
    if (line) out.push(line);
    out.push('');
  }
  return out.join('\n');
}

// ---------- a screenshot or photo ----------

let worker = null;
let progress = () => {};
/** Tesseract, set up once from this site (works offline). */
async function ocr() {
  if (worker) return worker;
  const base = new URL('../../vendor/tesseract/', import.meta.url).href;
  const mod = await import('../../vendor/tesseract/tesseract.esm.min.js');
  const createWorker = mod.createWorker ?? mod.default?.createWorker;
  worker = await createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}tesseract-core-simd-lstm.js`,
    langPath: `${base}lang/`,
    gzip: true,
    workerBlobURL: false,
    cacheMethod: 'none',
    logger: (m) => { if (m.status === 'recognizing text') progress(m.progress); },
  });
  return worker;
}

/** The text in a picture of lyrics (a screenshot, a photo of a page). */
export async function textFromImage(file, onProgress = () => {}) {
  if (typeof WebAssembly !== 'object' || !WebAssembly.validate?.(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]))) {
    throw new Error('Reading text from pictures needs a newer browser (iOS 16.4 or later).');
  }
  // Big photos are scaled to a size Tesseract reads well (and quickly).
  const { sniffType, decodeImage, fitSize, drawToCanvas } = await import('../../lib/image.js');
  const bitmap = await decodeImage(file, await sniffType(file));
  const fit = fitSize(bitmap.width, bitmap.height, 2400);
  const canvas = drawToCanvas(bitmap, fit.width, fit.height, '#ffffff');
  bitmap.close?.();
  progress = onProgress;
  const w = await ocr();
  const { data } = await w.recognize(canvas);
  // Lines as read, top to bottom; stray marks (a lone symbol, a status-bar time) dropped.
  // A capital I read as a bar ("every time | drop it") is put right.
  return String(data.text ?? '').split('\n').map((l) => l.trim().replace(/(^|\s)\|(?=\s|'|$)/g, '$1I')).filter((l) => !l || (/[a-z]{2}/i.test(l) && !/^\d{1,2}:\d{2}/.test(l))).join('\n');
}
