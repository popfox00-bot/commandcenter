// QR → Saved → App codes: keep the "add me / pay me" codes of your apps (Snapchat, Venmo, Cash App,
// PayPal, Instagram, ...) as cards in each app's colors, to show someone in person or share as a
// picture. Add one from a screenshot: the code in it is read and redrawn sharp, with your name and
// handle; if the picture has no QR code (Snapchat's ghost Snapcode), the picture itself goes on the
// card. Kept on this phone (IndexedDB); nothing is uploaded.

import { el } from '../../lib/dom.js';
import { idb } from '../../lib/idb.js';
import { canvasToBlob } from '../../lib/image.js';
import { shareFiles, canShareFiles, downloadBlob } from '../../lib/files.js';
import { encode } from '../../vendor/uqr/uqr.mjs';
import { drawQr } from './qr-make.js';
import { APP_BRANDS, detectApp, shownHandle, normalizeCard, cardColors } from './qr-cards-core.js';

export const CARDS_KEY = 'qr.cards';
const W = 1080; const H = 1440;
const FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

const roundRect = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };

/** Draw a card onto `canvas` (W×H scaled to `width`). `picture` is an ImageBitmap for picture cards. */
export function drawCard(canvas, card, picture = null, width = W) {
  const k = width / W;
  canvas.width = Math.round(W * k); canvas.height = Math.round(H * k);
  const c = canvas.getContext('2d');
  c.setTransform(k, 0, 0, k, 0, 0);
  const { bg, ink, accent } = cardColors(card);
  const brand = APP_BRANDS[card.app] ?? APP_BRANDS.other;
  // Background: the app's color, or its gradient corner to corner.
  if (bg.length > 1) { const g = c.createLinearGradient(0, H, W, 0); bg.forEach((col, i) => g.addColorStop(i / (bg.length - 1), col)); c.fillStyle = g; } else c.fillStyle = bg[0];
  roundRect(c, 0, 0, W, H, 64); c.fill();
  // The app's name.
  c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `800 92px ${FONT}`;
  c.fillText(card.app === 'other' ? (card.name || 'Scan me') : brand.name, W / 2, 150, W - 120);
  // The code panel (accent colors offset behind it for TikTok and Spotify).
  const P = 840; const px = (W - P) / 2; const py = 250;
  (accent ?? []).forEach((col, i) => { c.fillStyle = col; roundRect(c, px + (i ? 12 : -12), py + (i ? 12 : -12), P, P, 56); c.fill(); });
  c.fillStyle = '#FFFFFF'; roundRect(c, px, py, P, P, 56); c.fill();
  const inner = P - 80;
  if (card.text) {
    const qr = encode(card.text, { ecc: 'M', border: 0 });
    const q = document.createElement('canvas');
    drawQr(q.getContext('2d'), qr, { fg: '#000000', bg: '#FFFFFF', margin: 0 }, inner);
    c.imageSmoothingEnabled = false;
    c.drawImage(q, px + 40, py + 40, inner, inner);
    c.imageSmoothingEnabled = true;
  } else if (picture) {
    const s = Math.min(inner / picture.width, inner / picture.height);
    const w = picture.width * s; const h = picture.height * s;
    c.save(); roundRect(c, px + 40, py + 40, inner, inner, 24); c.clip();
    c.drawImage(picture, px + 40 + (inner - w) / 2, py + 40 + (inner - h) / 2, w, h);
    c.restore();
  }
  // Who it is.
  const handle = shownHandle(card.app, card.handle);
  const name = card.app === 'other' ? '' : card.name;
  let y = py + P + 110;
  if (name) { c.font = `700 68px ${FONT}`; c.fillText(name, W / 2, y, W - 120); y += 78; }
  if (handle) { c.globalAlpha = 0.9; c.font = `600 ${name ? 50 : 64}px ${FONT}`; c.fillText(handle, W / 2, y, W - 120); c.globalAlpha = 1; y += 66; }
  c.globalAlpha = 0.8; c.font = `500 36px ${FONT}`; c.fillText(brand.verb, W / 2, Math.min(H - 60, y + 6), W - 120); c.globalAlpha = 1;
  return canvas;
}

async function pictureOf(card) {
  if (card.text || !card.image) return null;
  try { return await createImageBitmap(card.image); } catch { return null; }
}

/** The card as a PNG file (full size). */
export async function cardFile(card) {
  const canvas = drawCard(document.createElement('canvas'), card, await pictureOf(card));
  const label = [APP_BRANDS[card.app]?.name, card.name || shownHandle(card.app, card.handle)].filter(Boolean).join(' ');
  return new File([await canvasToBlob(canvas, 'image/png')], `${label.replace(/[\\/:*?"<>|$@]+/g, '').trim().replace(/\s+/g, '-') || 'app-code'}.png`, { type: 'image/png' });
}

/**
 * The "App codes" section of the Saved tab. readCodes(file) → [{ text, format }] reads the codes in
 * a picture (the QR app's decoder); onChange() re-renders the tab.
 */
export function appCodes({ readCodes, onChange }) {
  const box = el('section', { class: 'qr-cards' });
  const urls = [];

  async function list() { return ((await idb.get(CARDS_KEY)) ?? []).map(normalizeCard).filter(Boolean); }
  async function store(cards) { await idb.set(CARDS_KEY, cards); }

  async function render() {
    for (const u of urls.splice(0)) URL.revokeObjectURL(u);
    const cards = await list();
    const picker = el('input', { type: 'file', accept: 'image/*', hidden: true, id: 'qr-card-file' });
    picker.addEventListener('change', () => { const f = picker.files[0]; picker.value = ''; if (f) fromScreenshot(f); });
    const grid = cards.length ? el('div', { class: 'qr-cards-grid' }, ...cards.map((card) => {
      const img = el('img', { class: 'qr-card-thumb', alt: '' });
      pictureOf(card).then((p) => canvasToBlob(drawCard(document.createElement('canvas'), card, p, 300), 'image/png')).then((b) => { const u = URL.createObjectURL(b); urls.push(u); img.src = u; }).catch(() => {});
      return el('button', { type: 'button', class: 'qr-card-open', 'aria-label': `${APP_BRANDS[card.app].name} code${card.name ? ` for ${card.name}` : ''}`, onclick: () => view(card) },
        img, el('strong', { class: 'small', text: APP_BRANDS[card.app].name }), el('span', { class: 'muted small', text: shownHandle(card.app, card.handle) || card.name || ' ' }));
    })) : el('p', { class: 'muted small', text: 'Keep your Snapchat, Venmo, Cash App or other "add me / pay me" codes here, to show someone or share. Take a screenshot of the code in the app, then add it.' });
    box.replaceChildren(
      el('div', { class: 'row space' }, el('h3', { text: '📇 App codes' }),
        el('label', { class: 'btn small-btn primary', for: 'qr-card-file', text: '+ Add from screenshot' })),
      picker, grid);
  }

  async function fromScreenshot(file) {
    let text = '';
    try {
      const hits = await readCodes(file);
      text = (hits.find((h) => /QR/i.test(h.format)) ?? hits[0])?.text ?? '';
    } catch { /* no code: the picture goes on the card */ }
    const { app, handle } = text ? detectApp(text) : { app: 'other', handle: '' };
    edit({ id: crypto.randomUUID(), app, handle, name: '', text, image: text ? null : file, color: '', at: Date.now() }, true);
  }

  async function edit(card, isNew = false) {
    const c = { ...card };
    const preview = el('canvas', { class: 'qr-card-preview', 'aria-label': 'Card preview' });
    const picture = await pictureOf(c);
    const redraw = () => drawCard(preview, c, picture, 540);
    const appSel = el('select', { 'aria-label': 'App' }, ...Object.entries(APP_BRANDS).map(([k, b]) => el('option', { value: k, text: b.name, selected: k === c.app })));
    const name = el('input', { value: c.name, placeholder: 'Your name (optional)', 'aria-label': 'Name', maxlength: '60' });
    const handle = el('input', { value: c.handle, placeholder: 'Handle or username (optional)', 'aria-label': 'Handle', maxlength: '60' });
    const color = el('input', { type: 'color', value: c.color || '#334155', 'aria-label': 'Card color' });
    const colorRow = el('label', { class: 'st-custom' }, 'Card color', color);
    const sync = () => { c.app = appSel.value; c.name = name.value.trim(); c.handle = handle.value.trim().replace(/^[@$]/, ''); c.color = color.value; colorRow.hidden = c.app !== 'other'; redraw(); };
    for (const i of [appSel, name, handle, color]) i.addEventListener('input', sync);
    appSel.addEventListener('change', sync);
    const note = c.text
      ? el('p', { class: 'small muted qr-card-note', text: `Read the code: ${c.text.length > 70 ? `${c.text.slice(0, 69)}…` : c.text}` })
      : el('p', { class: 'small qr-card-note', text: 'No QR code found in the picture, so the picture itself goes on the card (Snapchat\'s ghost Snapcodes, for one, aren\'t QR codes). A screenshot cropped close to the code looks best.' });
    const dlg = el('dialog', { class: 'ed-dialog' }, el('form', { class: 'sheet qr-card-form', method: 'dialog' },
      el('h2', { text: isNew ? 'New app code' : 'Edit app code' }),
      preview, note,
      el('label', { class: 'field' }, 'App', appSel), name, handle, colorRow,
      el('div', { class: 'row end' },
        el('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onclick: () => dlg.close() }),
        el('button', { type: 'submit', class: 'btn primary', text: 'Save' }))));
    dlg.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      sync();
      const cards = await list();
      const i = cards.findIndex((x) => x.id === c.id);
      if (i >= 0) cards[i] = normalizeCard(c); else cards.unshift(normalizeCard(c));
      await store(cards);
      dlg.close();
      await render(); onChange?.();
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    sync();
    dlg.showModal();
  }

  async function view(card) {
    const big = drawCard(el('canvas', { class: 'qr-card-big', 'aria-label': `${APP_BRANDS[card.app].name} code` }), card, await pictureOf(card), 1080);
    const link = /^https?:\/\//i.test(card.text) ? card.text : '';
    const dlg = el('dialog', { class: 'ed-dialog qr-card-viewer' }, el('div', { class: 'sheet' },
      big,
      el('div', { class: 'row wrap' },
        el('button', { class: 'btn primary', text: 'Share', onclick: async () => { const f = await cardFile(card); if (canShareFiles([f])) shareFiles([f], f.name).catch(() => {}); else downloadBlob(f, f.name); } }),
        link ? el('button', { class: 'btn', text: `Open in ${APP_BRANDS[card.app].name === 'Other' ? 'browser' : APP_BRANDS[card.app].name}`, onclick: () => window.open(link, '_blank', 'noopener,noreferrer') }) : null,
        el('button', { class: 'btn ghost', text: 'Edit', onclick: () => { dlg.close(); edit(card); } }),
        el('button', { class: 'btn ghost bad-text', text: 'Delete', onclick: async () => {
          if (!confirm(`Delete this ${APP_BRANDS[card.app].name} code?`)) return;
          await store((await list()).filter((x) => x.id !== card.id));
          dlg.close(); await render(); onChange?.();
        } }),
        el('button', { class: 'btn ghost', text: 'Close', onclick: () => dlg.close() }))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  render();
  return { node: box, dispose: () => { for (const u of urls.splice(0)) URL.revokeObjectURL(u); } };
}
