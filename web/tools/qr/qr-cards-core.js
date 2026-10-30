// App codes: the "scan to add me / pay me" codes that apps like Snapchat, Venmo or Cash App show
// for your profile. From a screenshot of one, the code's contents are read, the app and your
// handle worked out, and the code redrawn as a clean card in the app's colors (qr-cards.js).
// This part is pure (tested in Node): which app a code belongs to, and each app's look.
// Only the apps' names and colors are used, never their logos.

/** Each app: its name, card colors (bg: one color or a gradient's stops; ink: text on it), and how
 * to read a handle out of its code's link. */
export const APP_BRANDS = {
  snapchat: { name: 'Snapchat', bg: ['#FFFC00'], ink: '#FFFFFF', outline: '#000000', verb: 'Add me on Snapchat', match: /snapchat\.com\/(?:add|t)\/([^/?#]+)/i, at: '@' },
  venmo: { name: 'Venmo', bg: ['#008CFF'], ink: '#FFFFFF', verb: 'Pay me on Venmo', match: /venmo\.com\/(?:u\/)?([^/?#]*)/i, at: '@' },
  cashapp: { name: 'Cash App', bg: ['#00D64F'], ink: '#FFFFFF', verb: 'Pay me on Cash App', match: /cash\.(?:app|me)\/\$?([^/?#]+)/i, at: '$' },
  paypal: { name: 'PayPal', bg: ['#003087', '#009CDE'], ink: '#FFFFFF', verb: 'Pay me with PayPal', match: /paypal\.(?:me|com\/paypalme)\/([^/?#]+)/i, at: '' },
  zelle: { name: 'Zelle', bg: ['#6D1ED4'], ink: '#FFFFFF', verb: 'Send with Zelle', match: /zellepay\.com/i },
  instagram: { name: 'Instagram', bg: ['#F58529', '#DD2A7B', '#8134AF', '#515BD4'], ink: '#FFFFFF', verb: 'Follow me on Instagram', match: /instagram\.com\/([^/?#]+)/i, at: '@' },
  tiktok: { name: 'TikTok', bg: ['#010101'], accent: ['#25F4EE', '#FE2C55'], ink: '#FFFFFF', verb: 'Follow me on TikTok', match: /tiktok\.com\/@([^/?#]+)/i, at: '@' },
  whatsapp: { name: 'WhatsApp', bg: ['#25D366', '#128C7E'], ink: '#FFFFFF', verb: 'Message me on WhatsApp', match: /wa\.me\/(?:qr\/)?([^/?#]+)/i, at: '' },
  facebook: { name: 'Facebook', bg: ['#1877F2'], ink: '#FFFFFF', verb: 'Find me on Facebook', match: /(?:facebook\.com|fb\.me)\/([^/?#]+)/i, at: '' },
  linkedin: { name: 'LinkedIn', bg: ['#0A66C2'], ink: '#FFFFFF', verb: 'Connect on LinkedIn', match: /linkedin\.com\/in\/([^/?#]+)/i, at: '' },
  x: { name: 'X', bg: ['#000000'], ink: '#FFFFFF', verb: 'Follow me on X', match: /(?:\/\/|\.)(?:x|twitter)\.com\/([^/?#]+)/i, at: '@' },
  telegram: { name: 'Telegram', bg: ['#2AABEE', '#229ED9'], ink: '#FFFFFF', verb: 'Message me on Telegram', match: /t\.me\/([^/?#]+)/i, at: '@' },
  discord: { name: 'Discord', bg: ['#5865F2'], ink: '#FFFFFF', verb: 'Join me on Discord', match: /discord\.(?:gg|com\/invite)\/([^/?#]+)/i, at: '' },
  spotify: { name: 'Spotify', bg: ['#191414'], accent: ['#1DB954'], ink: '#FFFFFF', verb: 'Listen on Spotify', match: /open\.spotify\.com\/(?:user|artist|playlist)\/([^/?#]+)/i, at: '' },
  other: { name: 'Other', bg: ['#334155'], ink: '#FFFFFF', verb: 'Scan me', at: '' },
};

/** Which app a code's contents belong to, and the handle in it when there is one: { app, handle }. */
export function detectApp(text) {
  const t = String(text ?? '').trim();
  for (const [app, b] of Object.entries(APP_BRANDS)) {
    if (!b.match) continue;
    const m = b.match.exec(t);
    if (!m) continue;
    let handle = m[1] ? decodeURIComponent(m[1]).replace(/^[@$]/, '') : '';
    if (/^(?:qr|code|add|u|profile\.php)$/i.test(handle)) handle = '';
    return { app, handle };
  }
  return { app: 'other', handle: '' };
}

/** The handle as the app writes it: "@alex", "$alex", "alex". */
export const shownHandle = (app, handle) => (handle ? `${APP_BRANDS[app]?.at ?? ''}${handle.replace(/^[@$]/, '')}` : '');

/** A stored card, checked: null when it has neither a code nor a picture. */
export function normalizeCard(c) {
  if (!c || typeof c !== 'object' || (!c.text && !c.image)) return null;
  const app = APP_BRANDS[c.app] ? c.app : 'other';
  return {
    id: String(c.id ?? ''), app, text: c.text ? String(c.text) : '', image: c.image ?? null,
    name: String(c.name ?? '').trim().slice(0, 60), handle: String(c.handle ?? '').trim().replace(/^[@$]/, '').slice(0, 60),
    color: /^#[0-9a-f]{6}$/i.test(c.color ?? '') ? c.color : '', at: Number(c.at) || 0,
  };
}

/** The card's colors: the app's own, or the one picked for "Other". */
export function cardColors(c) {
  const b = APP_BRANDS[c.app] ?? APP_BRANDS.other;
  if (c.app === 'other' && c.color) {
    const n = parseInt(c.color.slice(1), 16);
    const light = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 160;
    return { bg: [c.color], ink: light ? '#000000' : '#FFFFFF', accent: null, outline: light ? null : 'rgba(0,0,0,0.55)' };
  }
  // White text gets a thin dark outline so it reads on bright colors (Snapchat's yellow).
  return { bg: b.bg, ink: b.ink, accent: b.accent ?? null, outline: b.outline ?? (b.ink === '#FFFFFF' ? 'rgba(0,0,0,0.55)' : null) };
}
