// Making QR codes: the text each kind of code holds (Wi-Fi, contact card, event, ...), and the drawing.
// The matrix comes from uqr; shapes are built here as SVG path data, which both the SVG export and the
// canvas preview (Path2D) use, so what you see is exactly what gets saved.

// ---------- payloads ----------

const wifiEsc = (s) => String(s ?? '').replace(/([\\;,:"])/g, '\\$1');
const vEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const icsEsc = vEsc;

export function normalizeUrl(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
/** Date -> "20261017T190000Z" (UTC), or "20261017" for all-day. */
export function icsStamp(date, allDay = false) {
  if (allDay) return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export const SOCIAL = {
  instagram: { label: 'Instagram', url: (h) => `https://instagram.com/${h}` },
  tiktok: { label: 'TikTok', url: (h) => `https://www.tiktok.com/@${h}` },
  x: { label: 'X (Twitter)', url: (h) => `https://x.com/${h}` },
  facebook: { label: 'Facebook', url: (h) => `https://facebook.com/${h}` },
  youtube: { label: 'YouTube', url: (h) => `https://youtube.com/@${h}` },
  linkedin: { label: 'LinkedIn', url: (h) => `https://www.linkedin.com/in/${h}` },
  snapchat: { label: 'Snapchat', url: (h) => `https://snapchat.com/add/${h}` },
  threads: { label: 'Threads', url: (h) => `https://www.threads.net/@${h}` },
  whatsapp: { label: 'WhatsApp', url: (h) => `https://wa.me/${h.replace(/\D/g, '')}` },
  telegram: { label: 'Telegram', url: (h) => `https://t.me/${h}` },
  github: { label: 'GitHub', url: (h) => `https://github.com/${h}` },
};

/** Code kinds for the Create screen, each turning form values into the text stored in the code. */
export const KINDS = {
  url: { label: 'Link', build: (v) => normalizeUrl(v.url) },
  text: { label: 'Text', build: (v) => String(v.text ?? '') },
  wifi: {
    label: 'Wi-Fi',
    build: (v) => {
      if (!v.ssid) return '';
      const t = v.security === 'nopass' ? 'nopass' : v.security || 'WPA';
      return `WIFI:T:${t};S:${wifiEsc(v.ssid)};${t === 'nopass' ? '' : `P:${wifiEsc(v.password)};`}${v.hidden ? 'H:true;' : ''};`;
    },
  },
  contact: {
    label: 'Contact',
    build: (v) => {
      const name = [v.first, v.last].filter(Boolean).join(' ');
      if (!name && !v.org && !v.phone && !v.email) return '';
      const L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEsc(v.last)};${vEsc(v.first)};;;`, `FN:${vEsc(name || v.org)}`];
      if (v.org) L.push(`ORG:${vEsc(v.org)}`);
      if (v.title) L.push(`TITLE:${vEsc(v.title)}`);
      if (v.phone) L.push(`TEL;TYPE=CELL:${v.phone.trim()}`);
      if (v.workPhone) L.push(`TEL;TYPE=WORK:${v.workPhone.trim()}`);
      if (v.email) L.push(`EMAIL:${v.email.trim()}`);
      if (v.website) L.push(`URL:${normalizeUrl(v.website)}`);
      if (v.street || v.city || v.region || v.zip || v.country) L.push(`ADR;TYPE=HOME:;;${[v.street, v.city, v.region, v.zip, v.country].map(vEsc).join(';')}`);
      if (v.note) L.push(`NOTE:${vEsc(v.note)}`);
      L.push('END:VCARD');
      return L.join('\r\n');
    },
  },
  email: {
    label: 'Email',
    build: (v) => {
      if (!v.to) return '';
      const q = [v.subject && `subject=${encodeURIComponent(v.subject)}`, v.body && `body=${encodeURIComponent(v.body)}`].filter(Boolean).join('&');
      return `mailto:${v.to.trim()}${q ? `?${q}` : ''}`;
    },
  },
  phone: { label: 'Phone', build: (v) => (v.number ? `tel:${v.number.replace(/[^\d+*#,;]/g, '')}` : '') },
  sms: { label: 'Text message', build: (v) => (v.number ? `SMSTO:${v.number.replace(/[^\d+]/g, '')}:${v.message ?? ''}` : '') },
  geo: {
    label: 'Location',
    build: (v) => {
      const hasPoint = v.lat !== '' && v.lat != null && v.lon !== '' && v.lon != null && Number.isFinite(+v.lat) && Number.isFinite(+v.lon);
      const q = (v.label || v.address || '').trim();
      if (!hasPoint && !v.address) return '';
      const ll = hasPoint ? `${(+v.lat).toFixed(6)},${(+v.lon).toFixed(6)}` : '';
      if (v.app === 'geo') return hasPoint ? `geo:${ll}${q ? `?q=${encodeURIComponent(q)}` : ''}` : `geo:0,0?q=${encodeURIComponent(v.address)}`;
      if (v.app === 'google') return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hasPoint ? ll : v.address)}`;
      return `https://maps.apple.com/?${hasPoint ? `ll=${ll}` : `address=${encodeURIComponent(v.address)}`}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
    },
  },
  event: {
    label: 'Event',
    build: (v) => {
      if (!v.title || !v.start) return '';
      const start = new Date(v.start);
      if (Number.isNaN(+start)) return '';
      let end = v.end ? new Date(v.end) : null;
      if (v.allDay) {
        const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const e = end && !Number.isNaN(+end) ? new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1) : new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1);
        return ['BEGIN:VEVENT', `SUMMARY:${icsEsc(v.title)}`, `DTSTART;VALUE=DATE:${icsStamp(s, true)}`, `DTEND;VALUE=DATE:${icsStamp(e, true)}`,
          v.location && `LOCATION:${icsEsc(v.location)}`, v.notes && `DESCRIPTION:${icsEsc(v.notes)}`, 'END:VEVENT'].filter(Boolean).join('\r\n');
      }
      if (!end || Number.isNaN(+end) || end <= start) end = new Date(+start + 3_600_000);
      return ['BEGIN:VEVENT', `SUMMARY:${icsEsc(v.title)}`, `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`,
        v.location && `LOCATION:${icsEsc(v.location)}`, v.notes && `DESCRIPTION:${icsEsc(v.notes)}`, 'END:VEVENT'].filter(Boolean).join('\r\n');
    },
  },
  social: {
    label: 'Social',
    build: (v) => {
      const h = String(v.handle ?? '').trim().replace(/^@/, '').replace(/^https?:\/\/\S+\//, '');
      return h && SOCIAL[v.platform] ? SOCIAL[v.platform].url(encodeURIComponent(h).replace(/%40/g, '@')) : '';
    },
  },
};

// ---------- colors ----------

function rgb(hex) {
  const h = String(hex).replace('#', '');
  const f = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255);
}
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrastRatio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** Warnings about colors that scanners struggle with. */
export function colorWarnings(fg, bg, transparent = false) {
  const out = [];
  if (transparent) {
    if (lum(fg) > 0.4) out.push('Light code on a see-through background: it will only scan when placed on something dark, and many scanners can\'t read light-on-dark codes.');
    return out;
  }
  if (lum(fg) > lum(bg)) out.push('The code is lighter than its background. Many scanners (including some phone cameras) can\'t read inverted codes.');
  const cr = contrastRatio(fg, bg);
  if (cr < 3) out.push(`Low contrast (${cr.toFixed(1)}:1). Use a darker code or lighter background so it scans reliably.`);
  return out;
}

// ---------- shapes ----------

export const DOT_STYLES = { square: 'Square', rounded: 'Rounded', dots: 'Dots' };
export const EYE_STYLES = { square: 'Square', rounded: 'Rounded', circle: 'Circle' };

const f = (n) => +n.toFixed(3);
function roundRect(x, y, w, h, r) {
  if (r <= 0) return `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}z`;
  return `M${f(x + r)} ${f(y)}h${f(w - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(r)}v${f(h - 2 * r)}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(r)}h${f(-(w - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(-r)}v${f(-(h - 2 * r))}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(-r)}z`;
}
const circle = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0z`;

/** One module with only its "exposed" corners rounded (both neighbours on that corner are light). */
function softCell(x, y, n) {
  const r = 0.5;
  const tl = !n.t && !n.l; const tr = !n.t && !n.r; const br = !n.b && !n.r; const bl = !n.b && !n.l;
  let d = `M${x + (tl ? r : 0)} ${y}`;
  d += `H${x + 1 - (tr ? r : 0)}`;
  if (tr) d += `A${r} ${r} 0 0 1 ${x + 1} ${y + r}`;
  d += `V${y + 1 - (br ? r : 0)}`;
  if (br) d += `A${r} ${r} 0 0 1 ${x + 1 - r} ${y + 1}`;
  d += `H${x + (bl ? r : 0)}`;
  if (bl) d += `A${r} ${r} 0 0 1 ${x} ${y + 1 - r}`;
  d += `V${y + (tl ? r : 0)}`;
  if (tl) d += `A${r} ${r} 0 0 1 ${x + r} ${y}`;
  return `${d}Z`;
}

/** Side of the cleared square for a logo, in modules (odd, so it stays centred). */
export function logoModules(size, fraction) {
  if (!fraction) return 0;
  let n = Math.round(size * fraction);
  if (n % 2 !== size % 2) n += 1;
  return Math.max(0, Math.min(n, size - 16));
}

/**
 * Path data (module units, origin at the top-left of the code without margin) for a uqr matrix.
 * Returns { modules, eyeOuter, eyeInner, size, logo: { x, y, n } | null }.
 */
export function qrPaths(qr, { dotStyle = 'square', eyeStyle = 'square', logoFraction = 0 } = {}) {
  const { size, data } = qr;
  const ln = logoModules(size, logoFraction);
  const lo = (size - ln) / 2;
  const inEye = (x, y) => (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
  const inLogo = (x, y) => ln > 0 && x >= lo && x < lo + ln && y >= lo && y < lo + ln;
  const dark = (x, y) => x >= 0 && y >= 0 && x < size && y < size && data[y][x] && !inEye(x, y) && !inLogo(x, y);

  let modules = '';
  for (let y = 0; y < size; y++) {
    if (dotStyle === 'square') {
      // Horizontal runs keep the path small.
      for (let x = 0; x < size;) {
        if (!dark(x, y)) { x++; continue; }
        let w = 1;
        while (dark(x + w, y)) w++;
        modules += `M${x} ${y}h${w}v1h${-w}z`;
        x += w;
      }
    } else {
      for (let x = 0; x < size; x++) {
        if (!dark(x, y)) continue;
        if (dotStyle === 'dots') modules += circle(x + 0.5, y + 0.5, 0.45);
        else modules += softCell(x, y, { t: dark(x, y - 1), b: dark(x, y + 1), l: dark(x - 1, y), r: dark(x + 1, y) });
      }
    }
  }
  let eyeOuter = ''; let eyeInner = '';
  for (const [ex, ey] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    if (eyeStyle === 'circle') {
      eyeOuter += circle(ex + 3.5, ey + 3.5, 3.5) + circle(ex + 3.5, ey + 3.5, 2.5);
      eyeInner += circle(ex + 3.5, ey + 3.5, 1.5);
    } else {
      const r = eyeStyle === 'rounded' ? 1 : 0;
      eyeOuter += roundRect(ex, ey, 7, 7, r * 2) + roundRect(ex + 1, ey + 1, 5, 5, r * 1.2);
      eyeInner += roundRect(ex + 2, ey + 2, 3, 3, r * 0.9);
    }
  }
  return { modules, eyeOuter, eyeInner, size, logo: ln ? { x: lo, y: lo, n: ln } : null };
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Layout of the whole picture in module units: code, margin, optional caption below.
 * Returns { W, H, codeX, codeY, captionY, captionSize }.
 */
export function layout(size, { margin = 4, caption = '' } = {}) {
  const captionSize = caption ? Math.max(2.4, size * 0.075) : 0;
  const W = size + margin * 2;
  const H = W + (caption ? captionSize * 1.6 : 0);
  return { W, H, codeX: margin, codeY: margin, captionY: W + captionSize * 0.55, captionSize };
}

/** A standalone SVG file. `logoHref` is a data: URL (embedded, so the file works anywhere). */
export function toSvg(qr, style = {}, logoHref = null) {
  const { fg = '#000000', bg = '#ffffff', eye = '', transparent = false, margin = 4, caption = '', captionColor = '' } = style;
  const p = qrPaths(qr, style);
  const L = layout(p.size, { margin, caption });
  const eyeColor = eye || fg;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(L.W)} ${f(L.H)}" width="${Math.round(L.W * 16)}" height="${Math.round(L.H * 16)}" shape-rendering="${style.dotStyle === 'square' && style.eyeStyle !== 'circle' && style.eyeStyle !== 'rounded' ? 'crispEdges' : 'geometricPrecision'}">`];
  if (!transparent) parts.push(`<rect width="100%" height="100%" fill="${xmlEsc(bg)}"/>`);
  parts.push(`<g transform="translate(${L.codeX} ${L.codeY})">`);
  parts.push(`<path d="${p.modules}" fill="${xmlEsc(fg)}"/>`);
  parts.push(`<path d="${p.eyeOuter}" fill="${xmlEsc(eyeColor)}" fill-rule="evenodd"/>`);
  parts.push(`<path d="${p.eyeInner}" fill="${xmlEsc(eyeColor)}"/>`);
  if (p.logo && logoHref) {
    const inset = 0.6;
    parts.push(`<image href="${xmlEsc(logoHref)}" x="${f(p.logo.x + inset)}" y="${f(p.logo.y + inset)}" width="${f(p.logo.n - inset * 2)}" height="${f(p.logo.n - inset * 2)}" preserveAspectRatio="xMidYMid meet"/>`);
  }
  parts.push('</g>');
  if (caption) parts.push(`<text x="${f(L.W / 2)}" y="${f(L.captionY)}" font-family="-apple-system, system-ui, Helvetica, Arial, sans-serif" font-size="${f(L.captionSize)}" font-weight="600" text-anchor="middle" dominant-baseline="middle" fill="${xmlEsc(captionColor || fg)}">${xmlEsc(caption)}</text>`);
  parts.push('</svg>');
  return parts.join('');
}

/**
 * Draw onto a 2D canvas context at `px` pixels wide (height follows the caption).
 * `logo` is an ImageBitmap/HTMLImageElement or null. Returns { width, height }.
 */
export function drawQr(ctx, qr, style = {}, px = 1024, logo = null) {
  const { fg = '#000000', bg = '#ffffff', eye = '', transparent = false, margin = 4, caption = '', captionColor = '' } = style;
  const p = qrPaths(qr, style);
  const L = layout(p.size, { margin, caption });
  const s = px / L.W;
  const width = Math.round(L.W * s); const height = Math.round(L.H * s);
  ctx.canvas.width = width; ctx.canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  if (!transparent) { ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height); }
  ctx.save();
  ctx.scale(s, s);
  ctx.translate(L.codeX, L.codeY);
  ctx.fillStyle = fg;
  ctx.fill(new Path2D(p.modules));
  ctx.fillStyle = eye || fg;
  ctx.fill(new Path2D(p.eyeOuter), 'evenodd');
  ctx.fill(new Path2D(p.eyeInner));
  if (p.logo && logo) {
    const inset = 0.6;
    const box = p.logo.n - inset * 2;
    const k = Math.min(box / logo.width, box / logo.height);
    const w = logo.width * k; const h = logo.height * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(logo, p.logo.x + inset + (box - w) / 2, p.logo.y + inset + (box - h) / 2, w, h);
  }
  ctx.restore();
  if (caption) {
    ctx.fillStyle = captionColor || fg;
    ctx.font = `600 ${L.captionSize * s}px -apple-system, system-ui, Helvetica, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(caption, (L.W / 2) * s, L.captionY * s, (L.W - margin) * s);
  }
  return { width, height };
}
