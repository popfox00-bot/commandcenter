// Link safety check for scanned QR codes, done on the device before anything is opened.
// Nothing here touches the network: it reads the address itself (the real site, look-alike letters,
// brand impersonation, hidden destinations, risky downloads, ...). The optional online check (redirect
// trace, domain age, Google Safe Browsing) is merged in with mergeOnline().
// No check can prove a site is safe; the wording says "no warning signs", never "safe".

// ---------- domains ----------

// Common two-level public suffixes (a compact subset of the Public Suffix List).
const MULTI_SUFFIXES = new Set(`co.uk org.uk ac.uk gov.uk me.uk ltd.uk plc.uk net.uk nhs.uk sch.uk
com.au net.au org.au edu.au gov.au asn.au id.au co.nz org.nz net.nz govt.nz ac.nz
co.jp ne.jp or.jp ac.jp go.jp com.br net.br org.br gov.br com.mx org.mx gob.mx com.cn net.cn org.cn gov.cn
com.tw org.tw com.hk org.hk co.in net.in org.in gov.in ac.in co.kr or.kr go.kr co.za org.za gov.za
com.sg org.sg gov.sg com.tr org.tr gov.tr com.ar gob.ar co.il org.il gov.il ac.il com.my gov.my
co.id or.id go.id com.ph gov.ph com.vn com.pk com.ng com.eg com.sa com.ua co.th go.th or.th
com.pl com.es com.pt com.co com.pe com.ve com.ec com.uy com.do com.gt com.bo com.py com.sv`.split(/\s+/));

// Free hosting where every subdomain belongs to a different person (private part of the PSL).
const HOSTING = new Set(`github.io pages.dev workers.dev netlify.app vercel.app herokuapp.com firebaseapp.com
web.app blogspot.com wixsite.com weebly.com glitch.me ngrok.io ngrok-free.app ngrok.app azurewebsites.net
cloudfront.net appspot.com onrender.com repl.co replit.dev replit.app webflow.io square.site godaddysites.com
carrd.co notion.site wordpress.com myshopify.com surge.sh fly.dev railway.app translate.goog
sharepoint.com framer.website framer.app gitbook.io r2.dev s3.amazonaws.com amplifyapp.com`.split(/\s+/));

const SHORTENERS = new Set(`bit.ly bitly.com tinyurl.com t.co goo.gl ow.ly is.gd v.gd buff.ly rebrand.ly cutt.ly
shorturl.at rb.gy t.ly tiny.cc s.id bl.ink soo.gd x.co shorte.st adf.ly tr.ee urlz.fr short.gy
lnkd.in amzn.to a.co youtu.be spoti.fi apple.co fb.me trib.al dlvr.it ift.tt hubs.ly tiny.one
shrtco.de clck.ru u.to qr.ae bit.do`.split(/\s+/));

// Official short links (still hide the final page, but the shortener itself is the brand's).
const OFFICIAL_SHORT = { 'youtu.be': 'YouTube', 'amzn.to': 'Amazon', 'a.co': 'Amazon', 'lnkd.in': 'LinkedIn', 't.co': 'X (Twitter)', 'spoti.fi': 'Spotify', 'apple.co': 'Apple', 'fb.me': 'Facebook' };

// "Dynamic" QR services: the code points at the service, and its owner can change the destination any time.
const DYNAMIC_QR = new Set(`qrco.de qr-code-generator.com l.ead.me ead.me me-qr.com qrfy.io qrfy.com scnv.io
q-r.to uqr.me qr.page flowcode.com flow.page linktr.ee beacons.ai qrcodechimp.com qr.io qrs.ly
qrcg.com qr1.at qr.net`.split(/\s+/));

// Endings that are cheap and disproportionately used for scams, or that look like file names.
const RISKY_TLDS = new Set('zip mov top xyz click link cfd sbs rest quest cyou icu buzz monster gq tk ml cf ga work bond lol beauty hair skin mom'.split(' '));
const FILE_TLDS = new Set(['zip', 'mov']);

// Brands that scams copy, with their real registrable domains.
export const BRANDS = {
  apple: ['apple.com', 'icloud.com', 'apple.co'], google: ['google.com', 'youtube.com', 'gmail.com', 'goo.gl', 'youtu.be', 'g.co'],
  paypal: ['paypal.com', 'paypal.me'], amazon: ['amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amzn.to', 'a.co', 'amazonaws.com', 'cloudfront.net'],
  microsoft: ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'microsoftonline.com', 'xbox.com'],
  netflix: ['netflix.com'], facebook: ['facebook.com', 'fb.me', 'meta.com', 'facebookmail.com', 'fbcdn.net'], instagram: ['instagram.com'], whatsapp: ['whatsapp.com', 'wa.me'],
  chase: ['chase.com', 'jpmorganchase.com'], wellsfargo: ['wellsfargo.com'], bankofamerica: ['bankofamerica.com', 'bofa.com'],
  citibank: ['citi.com', 'citibank.com'], capitalone: ['capitalone.com'], usbank: ['usbank.com'], americanexpress: ['americanexpress.com', 'amex.com'],
  venmo: ['venmo.com'], cashapp: ['cash.app', 'cashapp.com', 'square.com'], zelle: ['zellepay.com'], coinbase: ['coinbase.com'], binance: ['binance.com', 'binance.us'],
  usps: ['usps.com'], fedex: ['fedex.com'], ups: ['ups.com'], dhl: ['dhl.com'], irs: ['irs.gov'],
  ebay: ['ebay.com'], walmart: ['walmart.com'], target: ['target.com'], costco: ['costco.com'], bestbuy: ['bestbuy.com'],
  verizon: ['verizon.com'], tmobile: ['t-mobile.com'], xfinity: ['xfinity.com', 'comcast.com', 'comcast.net'],
  spotify: ['spotify.com', 'spoti.fi'], steam: ['steampowered.com', 'steamcommunity.com'], docusign: ['docusign.com', 'docusign.net'],
  dropbox: ['dropbox.com'], adobe: ['adobe.com'], linkedin: ['linkedin.com', 'lnkd.in'], tiktok: ['tiktok.com'], snapchat: ['snapchat.com'],
  roblox: ['roblox.com'], ticketmaster: ['ticketmaster.com'], uber: ['uber.com'], doordash: ['doordash.com'], airbnb: ['airbnb.com'],
  geico: ['geico.com'], statefarm: ['statefarm.com'], progressive: ['progressive.com'], att: ['att.com'], discord: ['discord.com', 'discord.gg'],
};
const BRAND_NAMES = { bankofamerica: 'Bank of America', wellsfargo: 'Wells Fargo', capitalone: 'Capital One', usbank: 'U.S. Bank', americanexpress: 'American Express', cashapp: 'Cash App', tmobile: 'T-Mobile', statefarm: 'State Farm', usps: 'USPS', ups: 'UPS', dhl: 'DHL', irs: 'IRS', att: 'AT&T', paypal: 'PayPal', ebay: 'eBay', tiktok: 'TikTok', linkedin: 'LinkedIn', docusign: 'DocuSign', bestbuy: 'Best Buy', doordash: 'DoorDash' };
export const brandName = (b) => BRAND_NAMES[b] ?? b[0].toUpperCase() + b.slice(1);
// Short brand words match only as a whole label/word, so "ups" doesn't fire on "groups" or "startups".
const WORD_ONLY = new Set(['ups', 'irs', 'att', 'dhl', 'usps', 'chase', 'target', 'uber', 'steam', 'apple', 'citibank', 'zelle']);

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|mc_eid|mc_cid|igshid|igsh|_hsenc|_hsmi|yclid|ttclid|twclid|li_fat_id|mkt_tok|oly_enc_id|oly_anon_id|_kx|vero_id|rb_clickid|s_cid)$/i;
const REDIRECT_KEYS = /^(url|u|redirect|redirect_uri|redirect_url|redirecturl|redir|next|dest|destination|target|to|goto|continue|return|returnurl|return_to|returnto|r|link|out|q|forward|view|ref_url|origin)$/i;
const LOGIN_WORDS = /(^|[^a-z])(log-?in|sign-?in|verify|verification|account|secure|update|wallet|unlock|suspend(ed)?|billing|confirm|password|recover|validate|authenticate|reactivate)([^a-z]|$)/i;
const PAY_WORDS = /(^|[^a-z])(pay|payment|parking|park|meter|toll|tolls|citation|ticket|fine|invoice)([^a-z]|$)/i;

const DOWNLOADS = [
  { re: /\.mobileconfig$/i, level: 'danger', title: 'Installs an iPhone configuration profile', detail: 'Profiles can add certificates, VPNs or device management that let someone read your traffic. Never install one from a QR code you don\'t fully trust.' },
  { re: /\.(apk|xapk|aab)$/i, level: 'danger', title: 'Android app download', detail: 'Installs an app outside the app store. It won\'t run on iPhone, and on Android it is a common way to spread malware.' },
  { re: /\.(exe|msi|scr|bat|cmd|com|ps1|vbs|jar|dll)$/i, level: 'danger', title: 'Windows program download', detail: 'Downloads a program file. These are a common way to spread malware.' },
  { re: /\.(dmg|pkg|app|command)$/i, level: 'danger', title: 'Mac installer download', detail: 'Downloads a program installer.' },
  { re: /\.ipa$/i, level: 'danger', title: 'iPhone app file', detail: 'Apps from outside the App Store are a common scam.' },
  { re: /\.shortcut$/i, level: 'caution', title: 'Adds an iPhone Shortcut', detail: 'Shortcuts can run actions on your phone. Look at every step before adding it.' },
  { re: /\.(zip|rar|7z|tar|gz|iso|img)$/i, level: 'caution', title: 'Downloads an archive', detail: 'Archives can hide programs inside.' },
  { re: /\.(ics|vcs)$/i, level: 'info', title: 'Calendar file', detail: 'Adds events to your calendar.' },
  { re: /\.(pdf|docx?|xlsx?|pptx?)$/i, level: 'info', title: 'Document download', detail: 'Opens a document.' },
];

// ---------- punycode (RFC 3492 decode), for showing internationalized domains as they really look ----------

function punyDecode(input) {
  const base = 36; let n = 128; let bias = 72; let i = 0;
  const out = [];
  const basic = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(basic, 0); j++) out.push(input.charCodeAt(j));
  const digit = (c) => (c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base);
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
    const old = i;
    for (let w = 1, k = base; ; k += base) {
      if (idx >= input.length) throw new Error('bad punycode');
      const d = digit(input.charCodeAt(idx++));
      if (d >= base) throw new Error('bad punycode');
      i += d * w;
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (d < t) break;
      w *= base - t;
    }
    const len = out.length + 1;
    let delta = old === 0 ? Math.floor((i - old) / 700) : (i - old) >> 1;
    delta += Math.floor(delta / len);
    let k = 0;
    for (; delta > 455; k += base) delta = Math.floor(delta / 35);
    bias = Math.floor(k + (36 * delta) / (delta + 38));
    n += Math.floor(i / len);
    i %= len;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

export function toUnicodeHost(host) {
  return host.split('.').map((l) => {
    if (!l.startsWith('xn--')) return l;
    try { return punyDecode(l.slice(4)); } catch { return l; }
  }).join('.');
}

// Letters from other alphabets that look like Latin ones.
const CONFUSABLES = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ɡ: 'g', һ: 'h', ӏ: 'l', ո: 'n', ν: 'v', ο: 'o', ρ: 'p', α: 'a', ε: 'e', ι: 'i', κ: 'k', τ: 't', υ: 'u', χ: 'x', ԛ: 'q', ԝ: 'w', ɑ: 'a', ı: 'i', ł: 'l', ø: 'o', ß: 'ss', 'ǀ': 'l' };
const skeleton = (s) => [...s.normalize('NFKD').replace(/\p{M}/gu, '')].map((c) => CONFUSABLES[c] ?? c).join('').toLowerCase();

function scriptsOf(s) {
  const found = new Set();
  for (const c of s) {
    if (/[a-z]/i.test(c)) found.add('Latin');
    else if (/\p{Script=Cyrillic}/u.test(c)) found.add('Cyrillic');
    else if (/\p{Script=Greek}/u.test(c)) found.add('Greek');
    else if (/\p{Script=Armenian}/u.test(c)) found.add('Armenian');
    else if (/\p{Script=Latin}/u.test(c)) found.add('Latin');
    else if (/\p{L}/u.test(c)) found.add('Other');
  }
  return found;
}

// ---------- helpers ----------

const isIPv4 = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
const isIPv6 = (h) => h.startsWith('[');
export function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || /\.(localhost|local|internal|lan|home|home\.arpa|intranet|corp)$/.test(h)) return true;
  if (isIPv4(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}

/** "a.b.example.co.uk" -> { registrable: "example.co.uk", sub: "a.b", suffix: "co.uk", hosting } */
export function splitHost(host) {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (isIPv4(h) || isIPv6(h)) return { registrable: h, sub: '', suffix: '', hosting: null };
  const labels = h.split('.');
  for (const hostingSuffix of HOSTING) {
    if (h.endsWith(`.${hostingSuffix}`)) {
      const n = hostingSuffix.split('.').length + 1;
      return { registrable: labels.slice(-n).join('.'), sub: labels.slice(0, -n).join('.'), suffix: hostingSuffix, hosting: hostingSuffix };
    }
  }
  const two = labels.slice(-2).join('.');
  const n = labels.length >= 3 && MULTI_SUFFIXES.has(two) ? 3 : 2;
  return { registrable: labels.slice(-n).join('.'), sub: labels.slice(0, -n).join('.'), suffix: labels.slice(-(n - 1)).join('.'), hosting: null };
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const deLeet = (s) => s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/\$/g, 's').replace(/-/g, '');
const isOfficial = (brand, registrable) => BRANDS[brand].some((d) => registrable === d || registrable.endsWith(`.${d}`));
const ownsBrand = (registrable) => Object.keys(BRANDS).find((b) => isOfficial(b, registrable));

function mentions(text, brand) {
  const t = text.toLowerCase();
  if (WORD_ONLY.has(brand)) return new RegExp(`(^|[^a-z])${brand}([^a-z]|$)`).test(t);
  return t.includes(brand);
}

/** A redirect target hidden in a query parameter (e.g. ?url=https://...). */
function nestedTargets(u) {
  const out = [];
  for (const [k, v] of u.searchParams) {
    let val = v;
    for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(val); i++) { try { val = decodeURIComponent(val); } catch { break; } }
    if (/^https?:\/\//i.test(val) || (REDIRECT_KEYS.test(k) && /^\/\/[^/]/.test(val))) {
      try { out.push({ key: k, url: new URL(val.startsWith('//') ? `https:${val}` : val).href }); } catch { /* not a URL */ }
    }
  }
  return out;
}

export function stripTracking(href) {
  try {
    const u = new URL(href);
    const before = u.search;
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    if (u.search === before) return null;
    return u.href.replace(/\?$/, '');
  } catch { return null; }
}

// ---------- the check ----------

/**
 * Analyse a link without visiting it.
 * Returns { ok, href, scheme, host, unicodeHost, registrable, sub, verdict, findings: [{ level, title, detail }],
 *           nested: [href], cleanHref, brand }
 */
export function analyzeUrl(input, { depth = 0 } = {}) {
  const findings = [];
  const add = (level, title, detail = '') => findings.push({ level, title, detail });
  let u;
  try { u = new URL(String(input).trim()); } catch { return { ok: false, verdict: 'caution', findings: [{ level: 'caution', title: 'Not a valid web address', detail: 'It can\'t be opened as a link.' }] }; }

  const scheme = u.protocol.replace(':', '').toLowerCase();
  if (['javascript', 'data', 'vbscript', 'file', 'blob'].includes(scheme)) {
    add('danger', scheme === 'javascript' || scheme === 'vbscript' ? 'Runs code instead of opening a site' : `A "${scheme}:" link, not a website`, 'Legitimate QR codes don\'t do this. Don\'t open it.');
    return { ok: true, href: u.href, scheme, host: '', unicodeHost: '', registrable: '', sub: '', verdict: 'danger', findings, nested: [], cleanHref: null };
  }
  if (scheme !== 'http' && scheme !== 'https') {
    return { ok: true, href: u.href, scheme, host: '', unicodeHost: '', registrable: '', sub: '', verdict: 'caution', findings: [{ level: 'caution', title: `Opens an app ("${scheme}:" link)`, detail: 'This isn\'t a website: it hands the code to an app on your phone.' }], nested: [], cleanHref: null };
  }

  const host = u.hostname.toLowerCase();
  const unicodeHost = toUnicodeHost(host);
  const { registrable, sub, hosting } = splitHost(host);
  const regUnicode = toUnicodeHost(registrable);
  const label = regUnicode.split('.')[0];

  if (scheme === 'http') add('caution', 'Not encrypted (http, not https)', 'Anyone on the same Wi-Fi could see or change the page. Never enter passwords or card numbers on it.');
  if (u.username || u.password) {
    add('danger', 'Disguised address', `Everything before the "@" is ignored. This really goes to ${unicodeHost}, not "${decodeURIComponent(u.username)}".`);
  }
  if (isIPv4(host) || isIPv6(host)) {
    if (isPrivateHost(host)) add('caution', 'Points to a device on a local network', 'Like a router or printer page. Only open it if you expected that.');
    else add('caution', 'Uses a bare number instead of a name', 'Real companies use names (like apple.com). Number addresses are common in scams.');
  } else if (isPrivateHost(host)) {
    add('caution', 'Points to a device on a local network', 'Like a router or printer page.');
  }
  if (u.port && !['80', '443'].includes(u.port)) add('caution', `Unusual port (:${u.port})`, 'Normal websites don\'t need a port number in the address.');

  // Look-alike letters (internationalized domains).
  let idnBrand = null;
  if (unicodeHost !== host) {
    const scripts = scriptsOf(unicodeHost.replace(/\./g, ''));
    const skel = skeleton(regUnicode);
    const lookalike = Object.keys(BRANDS).find((b) => skel.split('.')[0] === b || BRANDS[b].includes(skel));
    idnBrand = lookalike ?? null;
    if (lookalike) add('danger', `Fake ${brandName(lookalike)} address`, `"${regUnicode}" uses letters from another alphabet to look like ${BRANDS[lookalike][0]}.`);
    else if (scripts.size > 1 || [...unicodeHost].some((c) => CONFUSABLES[c])) add('danger', 'Uses look-alike letters', `The name mixes alphabets (${[...scripts].join(' + ')}), a trick to imitate another site. Written out: ${host}`);
    else add('info', 'International domain name', `Shown as ${unicodeHost} (written ${host}).`);
  }

  // Brand impersonation and look-alike spellings.
  const owner = ownsBrand(registrable);
  let brand = owner ?? idnBrand;
  if (!owner && !idnBrand && !isIPv4(host)) {
    const sld = label.toLowerCase();
    const plain = deLeet(sld);
    const exact = Object.keys(BRANDS).find((b) => plain === b && sld !== b);
    const contained = Object.keys(BRANDS).find((b) => b.length >= 5 && !WORD_ONLY.has(b) && plain.includes(b) && plain !== b)
      // Short brand words count as a whole word of the name: "usps-redelivery", not "groups".
      ?? Object.keys(BRANDS).find((b) => WORD_ONLY.has(b) && sld.includes('-') && mentions(sld.replace(/-/g, ' '), b));
    const close = Object.keys(BRANDS).find((b) => b.length >= 5 && editDistance(plain, b) === 1);
    const inSub = Object.keys(BRANDS).find((b) => sub && mentions(sub.replace(/\./g, ' '), b));
    // A brand in the path only matters next to sign-in words ("/paypal/login"), not in "/apple-pie".
    const pathText = decodeURIComponent(u.pathname).replace(/[/_.-]/g, ' ');
    const inPath = LOGIN_WORDS.test(pathText) && Object.keys(BRANDS).find((b) => !WORD_ONLY.has(b) && mentions(pathText, b));
    if (exact) { brand = exact; add('danger', `Look-alike of ${brandName(exact)}`, `"${regUnicode}" is spelled to look like ${BRANDS[exact][0]}, but it's a different site.`); }
    else if (contained) {
      // "paypal-secure-login.com" is a classic fake; "instagramtips.com" is more likely a blog.
      brand = contained;
      const strong = sld.includes('-') || LOGIN_WORDS.test(sld.replace(contained, ' ')) || PAY_WORDS.test(sld.replace(contained, ' '));
      add(strong ? 'danger' : 'caution', `Pretends to be ${brandName(contained)}`, `The site is ${regUnicode}, which is not ${brandName(contained)}'s (${BRANDS[contained][0]}).`);
    }
    else if (inSub) { brand = inSub; add('danger', `Pretends to be ${brandName(inSub)}`, `"${sub}" is only the front part. The real site is ${regUnicode}, not ${BRANDS[inSub][0]}.`); }
    else if (close) { brand = close; add('caution', `Spelled like ${brandName(close)}`, `"${regUnicode}" is one letter away from ${BRANDS[close][0]}. Check it isn't a fake.`); }
    else if (inPath) { brand = inPath; add('caution', `Mentions ${brandName(inPath)} but isn't their site`, `The site is ${regUnicode}.`); }
  }

  if (hosting) add('caution', 'Free website host', `${regUnicode} is a personal page on ${hosting}: anyone can make one in minutes, so a company name in it proves nothing.`);
  if (sub && sub.split('.').length >= 4) add('caution', 'Unusually long address', 'Scam links often stack many words in front of the real name to push it out of view.');

  const tld = host.split('.').pop();
  if (FILE_TLDS.has(tld)) add('caution', `Ends in ".${tld}" like a file name`, `It's a website, not a .${tld} file. This ending is used to trick people.`);
  else if (RISKY_TLDS.has(tld)) add('caution', `".${tld}" address`, 'This cheap ending is used often by scam sites. Not proof by itself.');

  if (SHORTENERS.has(registrable) || SHORTENERS.has(host)) {
    const official = OFFICIAL_SHORT[host] ?? OFFICIAL_SHORT[registrable];
    add(official ? 'info' : 'caution', official ? `${official} short link` : 'Short link: the real destination is hidden', 'Use "Check where it leads" to see the final page before opening.');
  }
  if (DYNAMIC_QR.has(registrable) || DYNAMIC_QR.has(host)) add('caution', 'Goes through a QR code service', `${regUnicode} forwards to the real page, and whoever made the code can change where it goes at any time. Use "Check where it leads".`);

  const path = decodeURIComponent(u.pathname);
  for (const d of DOWNLOADS) if (d.re.test(path)) { add(d.level, d.title, d.detail); break; }
  if (!owner && LOGIN_WORDS.test(`${sub} ${path} ${label}`)) add('caution', 'Asks you to sign in or verify', 'Only sign in on sites you open yourself (from the app or by typing the address), never from a QR code or text.');
  if (!owner && PAY_WORDS.test(`${sub} ${path} ${label}`)) add('caution', 'About a payment, parking or toll', 'Fake QR stickers on parking meters and fake toll notices are a common scam. Pay in the official app or on a site you type yourself.');

  const nested = depth < 2 ? nestedTargets(u) : [];
  for (const n of nested) {
    const inner = analyzeUrl(n.url, { depth: depth + 1 });
    if (inner.registrable && inner.registrable !== registrable) add(inner.verdict === 'ok' ? 'info' : 'caution', `Forwards to ${inner.unicodeHost}`, `The address carries another link (${n.key}=…) that it may send you on to.`);
    for (const f of inner.findings) if (f.level !== 'info') add(f.level, `${inner.unicodeHost}: ${f.title}`, f.detail);
  }

  const cleanHref = stripTracking(u.href);
  if (cleanHref) add('info', 'Contains tracking tags', 'Tags like utm_source tell the site where you came from. "Open without tracking" removes them.');
  if (u.href.length > 300) add('info', 'Very long address', `${u.href.length} characters.`);

  return { ok: true, href: u.href, scheme, host, unicodeHost, registrable, regUnicode, sub: toUnicodeHost(sub), verdict: verdictOf(findings), findings, nested: nested.map((n) => n.url), cleanHref, brand, owner: owner ?? null };
}

export function verdictOf(findings) {
  if (findings.some((f) => f.level === 'danger')) return 'danger';
  if (findings.some((f) => f.level === 'caution')) return 'caution';
  return 'ok';
}

export const VERDICT_TEXT = {
  ok: { label: 'No warning signs found', hint: 'Still only open links from sources you trust.' },
  caution: { label: 'Be careful', hint: 'Read the notes below before opening.' },
  danger: { label: 'Don\'t open this', hint: 'It has signs of a scam or a harmful link.' },
};

// ---------- online results ----------

/** Registration date and registrar from an RDAP domain response (rdap.org, registries). */
export function parseRdap(json) {
  if (!json || typeof json !== 'object') return null;
  const ev = (a) => (json.events ?? []).find((e) => e.eventAction === a)?.eventDate ?? null;
  let registrar = null;
  for (const ent of json.entities ?? []) {
    if (!(ent.roles ?? []).includes('registrar')) continue;
    const fn = (ent.vcardArray?.[1] ?? []).find((v) => v[0] === 'fn');
    registrar = fn?.[3] ?? ent.handle ?? null;
  }
  return { registered: ev('registration'), updated: ev('last changed'), expires: ev('expiration'), registrar };
}

export const ageDays = (iso, now = Date.now()) => (iso && !Number.isNaN(Date.parse(iso)) ? Math.floor((now - Date.parse(iso)) / 86_400_000) : null);

/** Words for a domain age: "3 days", "5 months", "12 years". */
export function ageText(days) {
  if (days == null) return 'unknown';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) return `${Math.round(days / 30.4)} months`;
  return `${Math.floor(days / 365.25)} years`;
}

/**
 * Merge the online check into an offline analysis.
 * online = { hops: [{ url, status, kind }], final: { url, status, title, contentType, download, error },
 *            domains: { [registrable]: { registered, registrar } | { error } }, safeBrowsing: { checked, matches: [{ url, threat }] } }
 * Returns { verdict, findings, finalHref, finalAnalysis }.
 */
export function mergeOnline(analysis, online, now = Date.now()) {
  const findings = [...analysis.findings];
  const add = (level, title, detail = '') => findings.push({ level, title, detail, online: true });
  const hops = online?.hops ?? [];
  const finalHref = online?.final?.url ?? analysis.href;
  let finalAnalysis = null;

  // Short links and QR services are explained now: drop the "hidden destination" notes.
  const explained = (f) => !(f.title.startsWith('Short link') || f.title.startsWith('Goes through a QR code service'));
  const kept = findings.filter((f) => f.online || explained(f) || !online?.final?.url);
  findings.length = 0; findings.push(...kept);

  if (finalHref && finalHref !== analysis.href) {
    finalAnalysis = analyzeUrl(finalHref);
    if (finalAnalysis.registrable !== analysis.registrable) add('info', `Ends up on ${finalAnalysis.unicodeHost}`, `${hops.length - 1} redirect${hops.length === 2 ? '' : 's'} on the way.`);
    for (const f of finalAnalysis.findings) if (f.level !== 'info') add(f.level, `Final page: ${f.title}`, f.detail);
  }
  // Every site passed through on the way, not just the last one.
  const seen = new Set([analysis.registrable, finalAnalysis?.registrable]);
  for (const h of hops.slice(1, -1)) {
    const a = analyzeUrl(h.url);
    if (seen.has(a.registrable)) continue;
    seen.add(a.registrable);
    for (const f of a.findings) if (f.level === 'danger') add('danger', `On the way (${a.unicodeHost}): ${f.title}`, f.detail);
  }
  if (hops.length > 4) add('caution', `${hops.length - 1} redirects`, 'Long redirect chains are used to hide where a link really goes.');
  if (hops.some((h) => h.kind === 'script' || h.kind === 'meta')) add('info', 'Redirected by the page itself', 'Not only by the server: the page sends you on with a script or refresh tag.');
  if (online?.stopped) add('caution', 'Trace stopped early', online.stopped);

  const fin = online?.final ?? {};
  // The page calls itself a brand that doesn't own the domain ("USPS - Redelivery fee" on usps-redelivery.top).
  const finalReg = (finalAnalysis ?? analysis).registrable;
  if (fin.title && finalReg && !ownsBrand(finalReg)) {
    const claimed = Object.keys(BRANDS).find((b) => mentions(fin.title.replace(/[^a-z0-9& ]+/gi, ' '), b) || (b.length >= 5 && fin.title.toLowerCase().replace(/[^a-z]/g, '').includes(b) && !WORD_ONLY.has(b)));
    if (claimed) {
      const pushy = LOGIN_WORDS.test(fin.title) || PAY_WORDS.test(fin.title) || /fee|redeliver|refund|prize|winner|locked/i.test(fin.title);
      add(pushy ? 'danger' : 'caution', `Page claims to be ${brandName(claimed)}`, `Its title is "${fin.title}", but the site is ${toUnicodeHost(finalReg)}, not ${BRANDS[claimed][0]}.`);
    }
  }
  if (fin.error) add('caution', 'The site didn\'t answer', fin.error);
  else if (fin.status >= 400) add('info', `The page returns an error (${fin.status})`, fin.status === 404 ? 'The page doesn\'t exist (anymore).' : 'The site refused or failed to load the page.');
  if (fin.download) add(/android|apple-aspen|x-msdownload|x-msi|octet-stream/.test(fin.contentType ?? '') ? 'danger' : 'caution', 'Starts a file download', `${fin.download}${fin.contentType ? ` (${fin.contentType})` : ''}`);
  else if (/apple-aspen-config/.test(fin.contentType ?? '')) add('danger', 'Installs an iPhone configuration profile', 'Profiles can add certificates or VPNs that let someone read your traffic.');

  for (const [domain, info] of Object.entries(online?.domains ?? {})) {
    const days = ageDays(info?.registered, now);
    if (days == null) continue;
    if (days < 30) add('danger', `${domain} was registered ${ageText(days)} ago`, 'Brand-new domains are one of the strongest signs of a scam site.');
    else if (days < 180) add('caution', `${domain} is only ${ageText(days)} old`, 'Young domains are more often used for scams.');
  }
  for (const m of online?.safeBrowsing?.matches ?? []) {
    add('danger', `Google Safe Browsing: ${({ SOCIAL_ENGINEERING: 'phishing / deceptive site', MALWARE: 'malware', UNWANTED_SOFTWARE: 'unwanted software', POTENTIALLY_HARMFUL_APPLICATION: 'harmful app' })[m.threat] ?? m.threat}`, m.url);
  }
  return { verdict: verdictOf(findings), findings, finalHref, finalAnalysis };
}
