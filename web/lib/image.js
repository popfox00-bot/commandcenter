// Image decoding and encoding in the browser, within iOS Safari's limits.

// iOS Safari refuses canvases over 16,777,216 pixels (4096x4096): toBlob returns null or a blank
// image. iPhone 24/48 MP photos exceed it, so everything is scaled to fit under this budget.
export const MAX_CANVAS_PIXELS = 16_777_216;

export const IMAGE_TYPES = {
  'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/gif': 'GIF', 'image/avif': 'AVIF',
  'image/heic': 'HEIC', 'image/heif': 'HEIF', 'image/bmp': 'BMP', 'image/svg+xml': 'SVG', 'image/tiff': 'TIFF',
};

/** Sniff the real type from the first bytes (file.type is often empty or wrong for HEIC). */
export async function sniffType(file) {
  const b = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const ascii = (s, e) => String.fromCharCode(...b.slice(s, e));
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return 'image/tiff';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (/^avi[fs]$/.test(brand)) return 'image/avif';
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return 'image/heic';
  }
  const head = new TextDecoder().decode(b).trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name) ? 'image/svg+xml' : file.type;
  return file.type || 'application/octet-stream';
}

/** Scale (w, h) down to fit maxEdge and the canvas pixel budget. */
export function fitSize(w, h, maxEdge = Infinity) {
  let scale = Math.min(1, maxEdge / Math.max(w, h));
  if (w * h * scale * scale > MAX_CANVAS_PIXELS) scale = Math.sqrt(MAX_CANVAS_PIXELS / (w * h));
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)), scale };
}

/**
 * Decode an image file to an ImageBitmap with EXIF orientation applied.
 * HEIC/HEIF decode only where the browser supports it (Safari on iPhone and Mac).
 */
export async function decodeImage(file, type) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Some browsers (and SVG) need an <img> element first.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } catch {
      const name = IMAGE_TYPES[type] ?? type;
      throw new Error(/hei[cf]/.test(type)
        ? `${name} can only be opened in Safari (iPhone, iPad or Mac). Tip: on iPhone, Settings → Camera → Formats → Most Compatible saves new photos as JPEG.`
        : `This browser can't open ${name} images.`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Draw a bitmap onto a canvas of the target size, with an optional background (for JPEG). */
export function drawToCanvas(bitmap, width, height, background) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

export function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not encode this image (too large?)'))), type, quality));
}

let webpNative;
/** True if canvas.toBlob really produces WebP (Chrome yes; Safari historically returns PNG). */
export async function canEncodeWebpNatively() {
  if (webpNative !== undefined) return webpNative;
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8));
  webpNative = !!blob && blob.type === 'image/webp';
  return webpNative;
}

/** Encode a canvas. type: image/jpeg | image/png | image/webp. quality 0..1. */
export async function encodeCanvas(canvas, type, quality = 0.9) {
  if (type === 'image/webp' && !(await canEncodeWebpNatively())) {
    const { encodeWebp } = await import('./webp.js');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    return new Blob([await encodeWebp(data, Math.round(quality * 100))], { type: 'image/webp' });
  }
  return canvasToBlob(canvas, type, type === 'image/png' ? undefined : quality);
}
