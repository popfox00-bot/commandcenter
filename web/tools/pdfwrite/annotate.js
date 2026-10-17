// Annotations for "write on PDF". One model drives both the on-screen preview (2D canvas) and the
// saved PDF (pdf-lib), so what you see is what gets saved. Original page content is kept as is
// (text stays selectable, vectors stay sharp); annotations are drawn on top as page content.
//
// Items use display coordinates of the page as shown (after the page's /Rotate), normalized 0..1
// with the origin at the top-left. Sizes are in PDF points (1/72 inch).
//   { page, type: 'text', u, v, text, size, color }          u,v = top-left of the text
//   { page, type: 'ink', points: [[u,v]...], width, color }
//   { page, type: 'check' | 'cross', u, v, size, color }      u,v = top-left of the mark's box
//   { page, type: 'box' | 'highlight' | 'whiteout', u1, v1, u2, v2, color, width }

export const LINE_HEIGHT = 1.2;
const ASCENT = 0.78; // Helvetica-ish ascent as a fraction of font size

export const FONT_STACK = 'Helvetica, Arial, sans-serif';

/**
 * page info: { width, height } of the unrotated page in points, { x, y } of its media box origin,
 * and `rotate` (0, 90, 180, 270). Display size swaps width/height for 90/270.
 */
export function displaySize(info) {
  return info.rotate % 180 ? { w: info.height, h: info.width } : { w: info.width, h: info.height };
}

/** Display-normalized (u,v) -> PDF user-space point (x, y) on the unrotated page. */
export function toPdf(info, u, v) {
  let a; let b;
  switch (((info.rotate % 360) + 360) % 360) {
    case 90: a = v; b = 1 - u; break;
    case 180: a = 1 - u; b = 1 - v; break;
    case 270: a = 1 - v; b = u; break;
    default: a = u; b = v;
  }
  return { x: info.x + a * info.width, y: info.y + (1 - b) * info.height };
}

/** Polylines (display-normalized) that draw a check or cross mark of `size` points. */
export function markLines(item, info) {
  const { w, h } = displaySize(info);
  const su = item.size / w; const sv = item.size / h;
  const P = (x, y) => [item.u + x * su, item.v + y * sv];
  if (item.type === 'check') return [[P(0.05, 0.55), P(0.38, 0.88), P(0.95, 0.12)]];
  return [[P(0.1, 0.1), P(0.9, 0.9)], [P(0.9, 0.1), P(0.1, 0.9)]];
}

export function textLines(item) {
  return String(item.text).split('\n');
}

const RECT_STYLE = {
  box: (it) => ({ stroke: it.color, fill: null, opacity: 1 }),
  highlight: () => ({ stroke: null, fill: '#ffd60a', opacity: 0.38 }),
  whiteout: () => ({ stroke: null, fill: '#ffffff', opacity: 1 }),
};

// ---------- preview ----------

/** Draw items of one page onto a 2D context sized pxW×pxH showing that page. */
export function drawPage(ctx, items, info, pxW, pxH) {
  const { w } = displaySize(info);
  const k = pxW / w; // px per point
  const X = (u) => u * pxW; const Y = (v) => v * pxH;
  for (const it of items) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (it.type === 'text') {
      ctx.fillStyle = it.color;
      ctx.font = `${it.size * k}px ${FONT_STACK}`;
      ctx.textBaseline = 'alphabetic';
      textLines(it).forEach((line, i) => ctx.fillText(line, X(it.u), Y(it.v) + (ASCENT + i * LINE_HEIGHT) * it.size * k));
    } else if (it.type === 'ink' || it.type === 'check' || it.type === 'cross') {
      ctx.strokeStyle = it.color;
      ctx.lineWidth = Math.max(1, (it.width ?? it.size * 0.14) * k);
      const lines = it.type === 'ink' ? [it.points] : markLines(it, info);
      for (const pts of lines) {
        ctx.beginPath();
        ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
        if (pts.length === 1) ctx.lineTo(X(pts[0][0]) + 0.01, Y(pts[0][1]));
        for (const [u, v] of pts.slice(1)) ctx.lineTo(X(u), Y(v));
        ctx.stroke();
      }
    } else if (RECT_STYLE[it.type]) {
      const s = RECT_STYLE[it.type](it);
      const x = X(Math.min(it.u1, it.u2)); const y = Y(Math.min(it.v1, it.v2));
      const rw = Math.abs(X(it.u2) - X(it.u1)); const rh = Math.abs(Y(it.v2) - Y(it.v1));
      ctx.globalAlpha = s.opacity;
      if (s.fill) { ctx.fillStyle = s.fill; ctx.fillRect(x, y, rw, rh); }
      if (s.stroke) { ctx.strokeStyle = s.stroke; ctx.lineWidth = Math.max(1, (it.width ?? 1.5) * k); ctx.strokeRect(x, y, rw, rh); }
    }
    ctx.restore();
  }
}

/** Approximate text box in display-normalized units (for tapping and dragging text). */
export function textBox(item, info, measure = (s, size) => s.length * size * 0.52) {
  const { w, h } = displaySize(info);
  const lines = textLines(item);
  const wPt = Math.max(...lines.map((l) => measure(l, item.size)));
  const hPt = (lines.length - 1) * LINE_HEIGHT * item.size + item.size;
  return { u: item.u, v: item.v, w: wPt / w, h: hPt / h };
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Index (in `items`) of the topmost item of `page` near (u,v); tol in points. */
export function hitTest(items, page, u, v, info, tolPt = 8) {
  const { w, h } = displaySize(info);
  const P = (a, b) => [a * w, b * h];
  const [px, py] = P(u, v);
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.page !== page) continue;
    if (it.type === 'text') {
      const b = textBox(it, info);
      if (u >= b.u - tolPt / w && u <= b.u + b.w + tolPt / w && v >= b.v - tolPt / h && v <= b.v + b.h + tolPt / h) return i;
    } else if (it.type === 'ink' || it.type === 'check' || it.type === 'cross') {
      const lines = it.type === 'ink' ? [it.points] : markLines(it, info);
      for (const pts of lines) {
        const q = pts.map(([a, b]) => P(a, b));
        if (q.length === 1 && Math.hypot(px - q[0][0], py - q[0][1]) <= tolPt) return i;
        for (let j = 1; j < q.length; j++) if (distSeg(px, py, ...q[j - 1], ...q[j]) <= tolPt + (it.width ?? 2)) return i;
      }
    } else if (RECT_STYLE[it.type]) {
      const [ax, ay] = P(Math.min(it.u1, it.u2), Math.min(it.v1, it.v2));
      const [bx, by] = P(Math.max(it.u1, it.u2), Math.max(it.v1, it.v2));
      if (px >= ax - tolPt && px <= bx + tolPt && py >= ay - tolPt && py <= by + tolPt) return i;
    }
  }
  return -1;
}

// ---------- saving ----------

function hexToRgb(lib, hex) {
  const n = parseInt(hex.slice(1), 16);
  return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Replace characters the standard Helvetica font can't encode. Returns { text, replaced }. */
export function encodable(font, text) {
  let replaced = 0;
  const out = [...text].map((ch) => {
    if (ch === '\n') return ch;
    try { font.encodeText(ch); return ch; } catch { replaced += 1; return '?'; }
  }).join('');
  return { text: out, replaced };
}

/** Page info as this module expects it, from a pdf-lib page. */
export function pageInfoFromLib(page) {
  const mb = page.getMediaBox();
  return { x: mb.x, y: mb.y, width: mb.width, height: mb.height, rotate: page.getRotation().angle };
}

/**
 * Write `items` into the PDF `bytes` and return the new bytes. `lib` is the pdf-lib module.
 * Returns { bytes, replacedChars }.
 */
export async function applyToPdf(lib, bytes, items) {
  const doc = await lib.PDFDocument.load(bytes); // throws EncryptedPDFError for protected files
  const font = await doc.embedFont(lib.StandardFonts.Helvetica);
  const pages = doc.getPages();
  let replacedChars = 0;
  for (const it of items) {
    const page = pages[it.page];
    if (!page) continue;
    const info = pageInfoFromLib(page);
    const rot = lib.degrees(info.rotate);
    const color = it.color ? hexToRgb(lib, it.color) : undefined;
    if (it.type === 'text') {
      const { h } = displaySize(info);
      textLines(it).forEach((line, i) => {
        if (!line) return;
        const enc = encodable(font, line);
        replacedChars += enc.replaced;
        const at = toPdf(info, it.u, it.v + ((ASCENT + i * LINE_HEIGHT) * it.size) / h);
        page.drawText(enc.text, { x: at.x, y: at.y, size: it.size, font, color, rotate: rot });
      });
    } else if (it.type === 'ink' || it.type === 'check' || it.type === 'cross') {
      const thickness = it.width ?? it.size * 0.14;
      const lines = it.type === 'ink' ? [it.points] : markLines(it, info);
      for (const pts of lines) {
        const q = pts.map(([u, v]) => toPdf(info, u, v));
        if (q.length === 1) q.push({ x: q[0].x + 0.01, y: q[0].y });
        for (let j = 1; j < q.length; j++) {
          page.drawLine({ start: q[j - 1], end: q[j], thickness, color, lineCap: lib.LineCapStyle.Round });
        }
      }
    } else if (RECT_STYLE[it.type]) {
      const s = RECT_STYLE[it.type](it);
      const a = toPdf(info, it.u1, it.v1); const b = toPdf(info, it.u2, it.v2);
      page.drawRectangle({
        x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
        ...(s.fill ? { color: hexToRgb(lib, s.fill), opacity: s.opacity } : {}),
        ...(s.stroke ? { borderColor: hexToRgb(lib, s.stroke), borderWidth: it.width ?? 1.5 } : {}),
      });
    }
  }
  return { bytes: await doc.save(), replacedChars };
}
