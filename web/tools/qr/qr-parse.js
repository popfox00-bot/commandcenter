// What a scanned code contains: a link, Wi-Fi login, contact, event, phone number, product barcode, ...
// parsePayload() never opens anything; it describes the content so the screen can show it first.

const unescapeMe = (s) => s.replace(/\\([\\;,:"])/g, '$1');

/** Split "K:v;K2:v2;;" (Wi-Fi and MeCard style) honouring backslash escapes. */
function splitFields(body) {
  const out = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && i + 1 < body.length) { cur += c + body[++i]; continue; }
    if (c === ';') { if (cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out.map((f) => {
    const k = f.indexOf(':');
    return k < 0 ? [f.toUpperCase(), ''] : [f.slice(0, k).toUpperCase(), unescapeMe(f.slice(k + 1))];
  });
}

export function parseWifi(text) {
  const f = Object.fromEntries(splitFields(text.replace(/^WIFI:/i, '')));
  const type = (f.T || 'nopass').toUpperCase();
  return { ssid: f.S ?? '', password: f.P ?? '', security: type === 'NOPASS' || type === '' ? 'none' : type, hidden: /^true$/i.test(f.H ?? '') };
}

// vCard (2.1/3.0/4.0): unfold lines, read the common properties.
export function parseVcard(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const c = { name: '', org: '', title: '', phones: [], emails: [], urls: [], addresses: [], note: '', birthday: '' };
  const val = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  for (const line of lines) {
    const k = line.indexOf(':');
    if (k < 0) continue;
    const [prop, ...params] = line.slice(0, k).split(';');
    const name = prop.replace(/^item\d+\./i, '').toUpperCase();
    const v = line.slice(k + 1);
    const type = params.join(';').replace(/TYPE=/gi, '').toLowerCase();
    if (name === 'FN') c.name = val(v);
    else if (name === 'N' && !c.name) c.name = v.split(';').slice(0, 2).reverse().map(val).filter(Boolean).join(' ');
    else if (name === 'ORG') c.org = v.split(';').map(val).filter(Boolean).join(', ');
    else if (name === 'TITLE') c.title = val(v);
    else if (name === 'TEL') c.phones.push({ value: val(v).replace(/^tel:/i, ''), type });
    else if (name === 'EMAIL') c.emails.push({ value: val(v), type });
    else if (name === 'URL') c.urls.push(val(v));
    else if (name === 'ADR') c.addresses.push(v.split(';').map(val).filter(Boolean).join(', '));
    else if (name === 'NOTE') c.note = val(v);
    else if (name === 'BDAY') c.birthday = v;
  }
  return c;
}

export function parseMecard(text) {
  const c = { name: '', org: '', title: '', phones: [], emails: [], urls: [], addresses: [], note: '', birthday: '' };
  for (const [k, v] of splitFields(text.replace(/^MECARD:/i, ''))) {
    if (k === 'N') c.name = v.includes(',') ? v.split(',').reverse().map((s) => s.trim()).join(' ') : v;
    else if (k === 'ORG') c.org = v;
    else if (k === 'TEL') c.phones.push({ value: v, type: '' });
    else if (k === 'EMAIL') c.emails.push({ value: v, type: '' });
    else if (k === 'URL') c.urls.push(v);
    else if (k === 'ADR') c.addresses.push(v);
    else if (k === 'NOTE') c.note = v;
    else if (k === 'BDAY') c.birthday = v;
  }
  return c;
}

/** iCalendar date ("20261017T190000Z", "20261017") -> Date. */
export function icsDate(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v ?? '');
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
  return z ? new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +s)) : new Date(+y, mo - 1, +d, +h, +mi, +s);
}

export function parseEvent(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const e = { title: '', start: null, end: null, allDay: false, location: '', description: '' };
  const val = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  for (const line of lines) {
    const k = line.indexOf(':');
    if (k < 0) continue;
    const prop = line.slice(0, k).split(';')[0].toUpperCase();
    const v = line.slice(k + 1).trim();
    if (prop === 'SUMMARY') e.title = val(v);
    else if (prop === 'DTSTART') { e.start = icsDate(v); e.allDay = /^\d{8}$/.test(v); }
    else if (prop === 'DTEND') e.end = icsDate(v);
    else if (prop === 'LOCATION') e.location = val(v);
    else if (prop === 'DESCRIPTION') e.description = val(v);
  }
  return e;
}

// GS1 check digit (EAN-8/13, UPC-A/E as UPC-A, ISBN-13, GTIN-14).
export function gtinValid(digits) {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const d = [...digits].map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const PAYMENT_SCHEMES = { bitcoin: 'Bitcoin', ethereum: 'Ethereum', litecoin: 'Litecoin', bitcoincash: 'Bitcoin Cash', dogecoin: 'Dogecoin', monero: 'Monero', solana: 'Solana', upi: 'UPI payment', venmo: 'Venmo', cashapp: 'Cash App', paypal: 'PayPal' };

/**
 * Describe a decoded code.
 * Returns { kind, title, fields: [[label, value, { secret? }]], data, warnings: [string] }.
 * kind: url | wifi | contact | email | phone | sms | geo | event | otp | payment | app | product | text
 */
export function parsePayload(text, format = 'QRCode') {
  const t = String(text ?? '');
  const trimmed = t.trim();
  const isLinear = !/QR|DataMatrix|Aztec|PDF417|MaxiCode/i.test(format);

  if (isLinear && /^\d{8}$|^\d{12,14}$/.test(trimmed)) {
    const valid = gtinValid(trimmed.length === 12 ? `0${trimmed}` : trimmed);
    const isbn = /^97[89]/.test(trimmed) && trimmed.length === 13;
    return { kind: 'product', title: isbn ? 'Book (ISBN)' : 'Product barcode', fields: [[isbn ? 'ISBN' : 'Number', trimmed], ['Type', format], ['Check digit', valid ? 'OK' : 'Doesn\'t match (misread?)']], data: { code: trimmed, isbn }, warnings: [] };
  }
  if (/^WIFI:/i.test(trimmed)) {
    const w = parseWifi(trimmed);
    const fields = [['Network', w.ssid || '(no name)'], ['Security', w.security === 'none' ? 'None (open network)' : w.security]];
    if (w.password) fields.push(['Password', w.password, { secret: true }]);
    if (w.hidden) fields.push(['Hidden network', 'Yes']);
    return { kind: 'wifi', title: 'Wi-Fi network', fields, data: w, warnings: w.security === 'none' ? ['Open network: others nearby can see what you send over it.'] : [] };
  }
  if (/^BEGIN:VCARD/i.test(trimmed) || /^MECARD:/i.test(trimmed)) {
    const c = /^MECARD:/i.test(trimmed) ? parseMecard(trimmed) : parseVcard(trimmed);
    const fields = [['Name', c.name], ['Company', c.org], ['Job title', c.title],
      ...c.phones.map((p) => [`Phone${p.type ? ` (${p.type.replace(/,?voice/, '').replace(/^pref,?/, '') || 'main'})` : ''}`, p.value]),
      ...c.emails.map((e) => ['Email', e.value]), ...c.urls.map((u) => ['Website', u]), ...c.addresses.map((a) => ['Address', a]),
      ['Birthday', c.birthday], ['Note', c.note]].filter(([, v]) => v);
    return { kind: 'contact', title: c.name || 'Contact card', fields, data: { ...c, raw: trimmed }, warnings: [] };
  }
  if (/^BEGIN:(VEVENT|VCALENDAR)/i.test(trimmed)) {
    const e = parseEvent(trimmed);
    const fmt = (d) => (d ? (e.allDay ? d.toLocaleDateString() : d.toLocaleString()) : '');
    return { kind: 'event', title: e.title || 'Calendar event', fields: [['Event', e.title], ['Starts', fmt(e.start)], ['Ends', fmt(e.end)], ['Where', e.location], ['Details', e.description]].filter(([, v]) => v), data: { ...e, raw: trimmed }, warnings: [] };
  }
  if (/^(mailto:|MATMSG:)/i.test(trimmed)) {
    let to = ''; let subject = ''; let body = '';
    if (/^MATMSG:/i.test(trimmed)) {
      const f = Object.fromEntries(splitFields(trimmed.slice(7)));
      to = f.TO ?? ''; subject = f.SUB ?? ''; body = f.BODY ?? '';
    } else {
      const [addr, query = ''] = trimmed.slice(7).split('?');
      const q = new URLSearchParams(query);
      to = decodeURIComponent(addr); subject = q.get('subject') ?? ''; body = q.get('body') ?? '';
    }
    return { kind: 'email', title: 'Email', fields: [['To', to], ['Subject', subject], ['Message', body]].filter(([, v]) => v), data: { to, subject, body }, warnings: [] };
  }
  if (/^tel:/i.test(trimmed)) {
    const number = decodeURIComponent(trimmed.slice(4));
    return { kind: 'phone', title: 'Phone number', fields: [['Number', number]], data: { number }, warnings: premium(number) };
  }
  if (/^(smsto:|sms:|mmsto:)/i.test(trimmed)) {
    const rest = trimmed.replace(/^(smsto|sms|mmsto):/i, '');
    let number; let body = '';
    if (/^smsto:|^mmsto:/i.test(trimmed)) {
      const i = rest.indexOf(':');
      number = i < 0 ? rest : rest.slice(0, i);
      body = i < 0 ? '' : rest.slice(i + 1);
    } else {
      // sms:+15551234567?body=Hi (standard) or sms:+15551234567&body=Hi (iPhone style)
      const n = rest.split(/[?&]/, 1)[0];
      number = decodeURIComponent(n);
      body = new URLSearchParams(rest.slice(n.length + 1)).get('body') ?? '';
    }
    return { kind: 'sms', title: 'Text message', fields: [['To', number], ['Message', body]].filter(([, v]) => v), data: { number, body }, warnings: [...premium(number), ...(body ? ['Sending a pre-written text to a short number can sign you up for paid services.'] : [])] };
  }
  if (/^geo:/i.test(trimmed)) {
    const m = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,[^?]*)?(?:\?(.*))?$/i.exec(trimmed);
    if (m) {
      const q = new URLSearchParams(m[3] ?? '').get('q') ?? '';
      return { kind: 'geo', title: 'Map location', fields: [['Latitude', m[1]], ['Longitude', m[2]], ['Label', q]].filter(([, v]) => v), data: { lat: +m[1], lon: +m[2], label: q }, warnings: [] };
    }
  }
  if (/^otpauth(-migration)?:\/\//i.test(trimmed)) {
    let issuer = ''; let account = '';
    try {
      const u = new URL(trimmed);
      const label = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
      [issuer, account] = label.includes(':') ? label.split(':') : [u.searchParams.get('issuer') ?? '', label];
      issuer = u.searchParams.get('issuer') ?? issuer;
    } catch { /* keep blanks */ }
    return { kind: 'otp', title: 'Two-factor login setup', fields: [['Service', issuer], ['Account', account]].filter(([, v]) => v), data: { raw: trimmed }, warnings: ['This holds a secret login key. Only scan it into your authenticator app while setting up an account yourself. Anyone else who scans it can make your codes.'] };
  }
  const scheme = /^([a-z][a-z0-9+.-]{1,30}):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && PAYMENT_SCHEMES[scheme]) {
    const body = trimmed.slice(scheme.length + 1);
    const [addr, query = ''] = body.split('?');
    const q = new URLSearchParams(query);
    const fields = [['Type', PAYMENT_SCHEMES[scheme]], ['To', decodeURIComponent(addr.replace(/^\/\//, '')) || q.get('pa') || ''], ['Amount', q.get('amount') ?? q.get('am') ?? ''], ['Note', q.get('message') ?? q.get('label') ?? q.get('tn') ?? '']].filter(([, v]) => v);
    return { kind: 'payment', title: 'Payment request', fields, data: { raw: trimmed, scheme }, warnings: ['Payment QR codes are a common scam (fake parking, "refunds", crypto giveaways). Payments usually can\'t be undone: check who you\'re paying another way first.'] };
  }
  if (scheme === 'http' || scheme === 'https' || /^www\.[^\s]+\.[a-z]{2,}/i.test(trimmed)) {
    const href = scheme ? trimmed : `https://${trimmed}`;
    return { kind: 'url', title: 'Website link', fields: [['Link', href]], data: { href }, warnings: [] };
  }
  if (scheme === 'itms-services') {
    return { kind: 'app', title: 'Installs an app outside the App Store', fields: [['Link', trimmed]], data: { href: trimmed, scheme }, warnings: ['This installs an "enterprise" app that skips App Store review. It\'s a known way to put spyware on iPhones. Don\'t install it unless your IT department gave it to you.'], danger: true };
  }
  if (scheme === 'webcal' || scheme === 'webcals') {
    return { kind: 'app', title: 'Calendar subscription', fields: [['Link', trimmed]], data: { href: trimmed, scheme }, warnings: ['Subscribed calendars can fill your calendar with spam events and links. You can remove one in Settings → Calendar → Accounts.'] };
  }
  if (scheme && !/\s/.test(trimmed) && trimmed.length < 2000 && !['javascript', 'data', 'vbscript', 'file'].includes(scheme)) {
    return { kind: 'app', title: `Opens an app ("${scheme}:" link)`, fields: [['Link', trimmed]], data: { href: trimmed, scheme }, warnings: ['Links like this open an app on your phone and can start actions in it.'] };
  }
  if (scheme && ['javascript', 'data', 'vbscript', 'file'].includes(scheme)) {
    return { kind: 'text', title: 'Unsafe code', fields: [['Content', trimmed.slice(0, 500)]], data: { text: trimmed }, warnings: ['This tries to run code or open a local file. It won\'t be opened.'], danger: true };
  }
  return { kind: 'text', title: isLinear ? 'Barcode' : 'Text', fields: [[isLinear ? 'Value' : 'Text', t], ...(isLinear ? [['Type', format]] : [])], data: { text: t }, warnings: [] };
}

// US premium-rate and short codes cost money to call or text.
function premium(number) {
  const n = number.replace(/[^\d+]/g, '');
  if (/^(\+?1)?900\d{7}$/.test(n) || /^(\+?1)?976\d{7}$/.test(n)) return ['This is a premium-rate number: calling it costs extra.'];
  if (/^\d{4,6}$/.test(n)) return ['Short code number: texting it can sign you up for paid messages.'];
  if (n.startsWith('+') && !n.startsWith('+1')) return ['International number: calls and texts may cost extra.'];
  return [];
}
