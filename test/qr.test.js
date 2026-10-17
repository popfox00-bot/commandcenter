// QR & Barcode: link safety rules, payload parsing, payload building and drawing, and a real round trip
// (uqr encode -> rasterize -> ZXing decode) for every kind of code the Create screen makes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeUrl, mergeOnline, parseRdap, splitHost, toUnicodeHost, stripTracking, isPrivateHost, ageText } from '../web/tools/qr/link-check.js';
import { parsePayload, parseWifi, parseVcard, gtinValid, icsDate } from '../web/tools/qr/qr-parse.js';
import { KINDS, qrPaths, toSvg, colorWarnings, logoModules, icsStamp } from '../web/tools/qr/qr-make.js';
import { encode } from '../web/vendor/uqr/uqr.mjs';

const titles = (a) => a.findings.map((f) => `${f.level}:${f.title}`).join(' | ');

test('link check: real sites pass, the classic tricks are caught', () => {
  for (const ok of ['https://www.paypal.com/signin', 'https://amazon.co.uk/x', 'https://groups.google.com/a', 'https://applebees.com/menu', 'https://startups.com', 'https://example.com/apple-pie']) {
    assert.equal(analyzeUrl(ok).verdict, 'ok', `${ok}: ${titles(analyzeUrl(ok))}`);
  }
  const cases = [
    ['https://paypal.com.secure-login.ru/verify', 'danger', /Pretends to be PayPal/],
    ['http://paypa1.com', 'danger', /Look-alike of PayPal/],
    ['https://xn--pple-43d.com/', 'danger', /Fake Apple address/],
    ['https://apple.com@phish.example/', 'danger', /Disguised address/],
    ['https://amazon-pay-secure.com/', 'danger', /Pretends to be Amazon/],
    ['https://usps-redelivery.top/fee', 'danger', /Pretends to be USPS/],
    ['https://my-wellsfargo.pages.dev/', 'danger', /Wells Fargo.*Free website host|Free website host/s],
    ['https://files.example.com/setup.mobileconfig', 'danger', /configuration profile/],
    ['https://example.com/app.apk', 'danger', /Android app/],
    ['javascript:alert(1)', 'danger', /Runs code/],
    ['https://bit.ly/3abc', 'caution', /Short link/],
    ['https://qrco.de/bdX1', 'caution', /QR code service/],
    ['https://192.168.1.1/', 'caution', /local network/],
    ['https://instagramtips.com', 'caution', /Pretends to be Instagram/],
    ['https://parkmobile-pay.click/', 'caution', /parking|\.click/],
    ['http://example.com/', 'caution', /Not encrypted/],
    ['https://www.google.com/url?q=https://evil.top/login', 'caution', /Forwards to evil\.top/],
  ];
  for (const [url, verdict, re] of cases) {
    const a = analyzeUrl(url);
    assert.equal(a.verdict, verdict, `${url}: ${titles(a)}`);
    assert.match(titles(a), re, url);
  }
  // The part people misread: what the real site is.
  assert.equal(analyzeUrl('https://paypal.com.secure-login.ru/x').registrable, 'secure-login.ru');
  assert.equal(analyzeUrl('https://paypal.com.secure-login.ru/x').sub, 'paypal.com');
});

test('link check helpers: domains, unicode, tracking, private hosts', () => {
  assert.deepEqual(splitHost('a.b.example.co.uk'), { registrable: 'example.co.uk', sub: 'a.b', suffix: 'co.uk', hosting: null });
  assert.equal(splitHost('evil.pages.dev').hosting, 'pages.dev');
  assert.equal(toUnicodeHost('xn--pple-43d.com'), 'аpple.com');
  assert.equal(toUnicodeHost('xn--mnchen-3ya.de'), 'münchen.de');
  assert.equal(stripTracking('https://x.com/a?utm_source=q&id=2&fbclid=z'), 'https://x.com/a?id=2');
  assert.equal(stripTracking('https://x.com/a?id=2'), null);
  for (const h of ['localhost', '10.0.0.5', '172.20.1.1', '192.168.0.1', '169.254.1.1', '[::1]', 'printer.local']) assert.ok(isPrivateHost(h), h);
  for (const h of ['8.8.8.8', 'example.com', '172.32.0.1']) assert.ok(!isPrivateHost(h), h);
  assert.equal(ageText(3), '3 days');
  assert.equal(ageText(400), '13 months');
});

test('online results: redirect chain, page title claiming a brand, new domain, Safe Browsing', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const a = analyzeUrl('https://bit.ly/3xyz');
  const merged = mergeOnline(a, {
    hops: [{ url: 'https://bit.ly/3xyz', status: 301 }, { url: 'https://t.example.net/c', status: 302 }, { url: 'https://redeliver-now.top/pay', status: 200 }],
    final: { url: 'https://redeliver-now.top/pay', status: 200, title: 'USPS | Pay redelivery fee' },
    domains: { 'redeliver-now.top': { registered: '2026-10-15T00:00:00Z' } },
    safeBrowsing: { checked: true, matches: [{ url: 'https://redeliver-now.top/pay', threat: 'SOCIAL_ENGINEERING' }] },
  }, now);
  assert.equal(merged.verdict, 'danger');
  assert.equal(merged.finalHref, 'https://redeliver-now.top/pay');
  const t = merged.findings.map((f) => f.title).join(' | ');
  assert.match(t, /Ends up on redeliver-now\.top/);
  assert.match(t, /Page claims to be USPS/);
  assert.match(t, /registered 2 days ago/);
  assert.match(t, /Safe Browsing: phishing/);
  assert.doesNotMatch(t, /Short link/, 'the hidden-destination note goes once it is known');

  const clean = mergeOnline(analyzeUrl('https://example.com/menu'), { hops: [{ url: 'https://example.com/menu', status: 200 }], final: { url: 'https://example.com/menu', status: 200, title: 'Menu' }, domains: { 'example.com': { registered: '1995-08-14T04:00:00Z' } }, safeBrowsing: { checked: true, matches: [] } }, now);
  assert.equal(clean.verdict, 'ok');

  assert.deepEqual(parseRdap({ events: [{ eventAction: 'registration', eventDate: '1997-09-15T04:00:00Z' }, { eventAction: 'expiration', eventDate: '2028-09-14T04:00:00Z' }], entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'MarkMonitor Inc.']]] }] }),
    { registered: '1997-09-15T04:00:00Z', updated: null, expires: '2028-09-14T04:00:00Z', registrar: 'MarkMonitor Inc.' });
});

test('parse: Wi-Fi, contacts, events, messages, barcodes, risky schemes', () => {
  assert.deepEqual(parseWifi('WIFI:T:WPA;S:My\\;Net;P:pa\\:ss;H:true;;'), { ssid: 'My;Net', password: 'pa:ss', security: 'WPA', hidden: true });
  assert.equal(parsePayload('WIFI:S:Cafe;T:nopass;;').warnings.length, 1);

  const v = parseVcard('BEGIN:VCARD\r\nVERSION:3.0\r\nN:Rivera;Alex;;;\r\nFN:Alex Rivera\r\nTEL;TYPE=CELL:+1 303 555 0142\r\nEMAIL:alex@example.com\r\nORG:Acme\\, Inc.\r\nEND:VCARD');
  assert.equal(v.name, 'Alex Rivera'); assert.equal(v.org, 'Acme, Inc.'); assert.equal(v.phones[0].value, '+1 303 555 0142');
  assert.equal(parsePayload('MECARD:N:Rivera,Alex;TEL:3035550142;EMAIL:a@b.co;;').data.name, 'Alex Rivera');

  const ev = parsePayload('BEGIN:VEVENT\nSUMMARY:Party\nDTSTART:20261031T010000Z\nDTEND:20261031T040000Z\nLOCATION:Home\nEND:VEVENT');
  assert.equal(ev.kind, 'event'); assert.equal(ev.data.start.toISOString(), '2026-10-31T01:00:00.000Z');
  assert.equal(icsDate('20261031').getDate(), 31);

  assert.deepEqual(parsePayload('SMSTO:12345:JOIN').data, { number: '12345', body: 'JOIN' });
  assert.match(parsePayload('SMSTO:12345:JOIN').warnings.join(), /Short code/);
  assert.deepEqual(parsePayload('sms:+13035550142&body=Hi%20there').data, { number: '+13035550142', body: 'Hi there' });
  assert.deepEqual(parsePayload('mailto:a@b.co?subject=Hi&body=Yo').data, { to: 'a@b.co', subject: 'Hi', body: 'Yo' });
  assert.equal(parsePayload('geo:39.7392,-104.9903?q=Denver').data.label, 'Denver');
  assert.equal(parsePayload('www.example.com').data.href, 'https://www.example.com');

  assert.ok(gtinValid('4006381333931')); assert.ok(!gtinValid('4006381333932'));
  assert.equal(parsePayload('9780306406157', 'EAN-13').data.isbn, true);
  assert.equal(parsePayload('012345678905', 'UPC-A').fields.find(([k]) => k === 'Check digit')[1], 'OK');

  assert.equal(parsePayload('otpauth://totp/GitHub:me?secret=ABC&issuer=GitHub').kind, 'otp'); // secret-scan:allow (fake test value)
  assert.equal(parsePayload('bitcoin:bc1qxyz?amount=0.5').kind, 'payment');
  assert.ok(parsePayload('itms-services://?action=download-manifest&url=https://x/y.plist').danger);
  assert.ok(parsePayload('javascript:alert(1)').danger);
});

test('make: payloads for each kind of code', () => {
  assert.equal(KINDS.url.build({ url: 'example.com/menu' }), 'https://example.com/menu');
  assert.equal(KINDS.wifi.build({ ssid: 'Casa; Guest', password: 'p@ss:1', security: 'WPA' }), 'WIFI:T:WPA;S:Casa\\; Guest;P:p@ss\\:1;;');
  assert.equal(KINDS.wifi.build({ ssid: 'Open', security: 'nopass', hidden: true }), 'WIFI:T:nopass;S:Open;H:true;;');
  assert.deepEqual(parseWifi(KINDS.wifi.build({ ssid: 'a\\b,c"d', password: ';;', security: 'WPA' })), { ssid: 'a\\b,c"d', password: ';;', security: 'WPA', hidden: false });

  const card = KINDS.contact.build({ first: 'Alex', last: 'Rivera', org: 'Acme, Inc.', phone: '+1 303 555 0142', email: 'alex@example.com', city: 'Denver', region: 'CO' });
  const back = parseVcard(card);
  assert.equal(back.name, 'Alex Rivera'); assert.equal(back.org, 'Acme, Inc.'); assert.equal(back.addresses[0], 'Denver, CO');

  assert.equal(KINDS.email.build({ to: 'a@b.co', subject: 'Hi there' }), 'mailto:a@b.co?subject=Hi%20there');
  assert.equal(KINDS.phone.build({ number: '(303) 555-0142' }), 'tel:3035550142');
  assert.equal(KINDS.sms.build({ number: '+1 303 555 0142', message: 'Hi' }), 'SMSTO:+13035550142:Hi');
  assert.equal(KINDS.geo.build({ lat: '39.7392', lon: '-104.9903', label: 'Denver', app: 'apple' }), 'https://maps.apple.com/?ll=39.739200,-104.990300&q=Denver');
  assert.equal(KINDS.geo.build({ lat: '39.7392', lon: '-104.9903', app: 'geo' }), 'geo:39.739200,-104.990300');
  assert.equal(KINDS.social.build({ platform: 'instagram', handle: '@popfox' }), 'https://instagram.com/popfox');

  const ev = KINDS.event.build({ title: 'Party, yay', start: '2026-10-31T19:00:00Z', end: '' });
  assert.match(ev, /^BEGIN:VEVENT\r\nSUMMARY:Party\\, yay\r\nDTSTART:20261031T190000Z\r\nDTEND:20261031T200000Z\r\nEND:VEVENT$/);
  assert.equal(parsePayload(ev).data.title, 'Party, yay');
  assert.equal(icsStamp(new Date(2026, 9, 31), true), '20261031');
  assert.match(KINDS.event.build({ title: 'Trip', start: '2026-10-31T00:00', allDay: true }), /DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101/);

  // Empty forms make no code.
  for (const k of Object.keys(KINDS)) assert.equal(KINDS[k].build({}), '', k);
});

test('make: drawing paths, logo space, colors, SVG', () => {
  const qr = encode('https://example.com', { ecc: 'H', border: 0 });
  const plain = qrPaths(qr);
  assert.ok(plain.modules.length > 100 && plain.logo === null);
  const n = logoModules(qr.size, 0.22);
  assert.equal(n % 2, qr.size % 2, 'logo square stays centred');
  const withLogo = qrPaths(qr, { logoFraction: 0.22, dotStyle: 'dots', eyeStyle: 'circle' });
  assert.equal(withLogo.logo.n, n);
  const svg = toSvg(qr, { fg: '#1e3a8a', bg: '#ffffff', caption: 'Scan <me>', dotStyle: 'rounded', eyeStyle: 'rounded' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /Scan &lt;me&gt;/);
  assert.match(svg, /fill="#1e3a8a"/);
  assert.equal(colorWarnings('#000000', '#ffffff').length, 0);
  assert.match(colorWarnings('#ffffff', '#000000').join(), /inverted/);
  assert.match(colorWarnings('#bbbbbb', '#ffffff').join(), /Low contrast/);
});

test('round trip: every kind of code decodes back to the same text (uqr -> pixels -> ZXing)', async () => {
  globalThis.ImageData ??= class ImageData { constructor(data, width, height) { Object.assign(this, { data, width, height, colorSpace: 'srgb' }); } };
  const z = await import('../web/vendor/zxing/reader/index.js');
  z.prepareZXingModule({ overrides: { wasmBinary: readFileSync(new URL('../web/vendor/zxing/zxing_reader.wasm', import.meta.url)) } });
  const samples = {
    url: { url: 'example.com/menu?table=4' }, text: { text: 'Hello ☕ 東京' }, wifi: { ssid: 'Casa; Guest', password: 'p@ss:1', security: 'WPA' },
    contact: { first: 'Alex', last: 'Rivera', phone: '+1 303 555 0142', email: 'alex@example.com', org: 'Acme, Inc.' },
    email: { to: 'a@b.co', subject: 'Hi', body: 'Line 1\nLine 2' }, phone: { number: '+13035550142' }, sms: { number: '3035550142', message: 'On my way' },
    geo: { lat: '39.7392', lon: '-104.9903', app: 'apple', label: 'Denver' }, event: { title: 'Party', start: '2026-10-31T19:00:00Z' }, social: { platform: 'tiktok', handle: 'popfox' },
  };
  for (const [kind, values] of Object.entries(samples)) {
    const text = KINDS[kind].build(values);
    const { size, data } = encode(text, { ecc: 'M', border: 4 });
    const s = 4; const W = size * s; const px = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const v = data[(y / s) | 0][(x / s) | 0] ? 0 : 255; const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255; }
    const [hit] = await z.readBarcodes(new ImageData(px, W, W), { formats: ['QRCode'] });
    assert.equal(hit?.text, text, kind);
    assert.equal(parsePayload(hit.text).kind, { url: 'url', text: 'text', wifi: 'wifi', contact: 'contact', email: 'email', phone: 'phone', sms: 'sms', geo: 'url', event: 'event', social: 'url' }[kind], kind);
  }
});
