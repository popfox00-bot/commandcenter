// QR & Barcode: scan codes (camera or photo) and see exactly what they hold before anything opens,
// with a link safety check; make your own QR codes (link, Wi-Fi, contact, event, ...) in your style.
// Scanning and making codes run on the device. Only "Check where it leads" goes online, and only when tapped.

import { el, store } from '../../lib/dom.js';
import { idb } from '../../lib/idb.js';
import { sniffType, decodeImage, fitSize, drawToCanvas, canvasToBlob } from '../../lib/image.js';
import { shareFiles, canShareFiles, downloadBlob } from '../../lib/files.js';
import { parsePayload } from './qr-parse.js';
import { analyzeUrl, mergeOnline, parseRdap, VERDICT_TEXT, ageDays, ageText } from './link-check.js';
import { KINDS, SOCIAL, DOT_STYLES, EYE_STYLES, drawQr, toSvg, colorWarnings } from './qr-make.js';
import { encode } from '../../vendor/uqr/uqr.mjs';

const HISTORY_KEY = 'qr.history';
const SAVED_KEY = 'qr.saved';
const LOGO_KEY = 'qr.create.logo';
const PREFS_KEY = 'cc.qr.prefs';
const FORM_KEY = 'cc.qr.create';
const HISTORY_MAX = 100;
const LIVE_MAX = 720;            // live frames are scanned at this size (px)
const LIVE_OPTS = { formats: [], tryHarder: true, maxNumberOfSymbols: 1 };
const PHOTO_OPTS = { formats: [], tryHarder: true, maxNumberOfSymbols: 8 };
const FORMAT_NAMES = { QRCode: 'QR code', MicroQRCode: 'Micro QR', 'EAN-13': 'EAN-13', 'EAN-8': 'EAN-8', 'UPC-A': 'UPC-A', 'UPC-E': 'UPC-E', DataMatrix: 'Data Matrix', PDF417: 'PDF417', Aztec: 'Aztec', Code128: 'Code 128', Code39: 'Code 39', Code93: 'Code 93', ITF: 'ITF', Codabar: 'Codabar' };
const KIND_ICON = { url: '🔗', wifi: '📶', contact: '👤', email: '✉️', phone: '📞', sms: '💬', geo: '📍', event: '📅', otp: '🔐', payment: '💳', app: '📲', product: '🏷️', text: '📝' };

// ---------- decoder (ZXing-C++ as WebAssembly, loaded on first use) ----------

let zxing;
export function reader() {
  zxing ??= import('../../vendor/zxing/reader/index.js').then((m) => {
    m.prepareZXingModule({ overrides: { locateFile: (p) => new URL(`../../vendor/zxing/${p}`, import.meta.url).href } });
    return m;
  });
  return zxing;
}
export async function decode(input, opts = PHOTO_OPTS) {
  const z = await reader();
  return (await z.readBarcodes(input, opts)).filter((r) => r.isValid && r.text);
}

// ---------- Worker settings (shared with the Jobs tab) ----------

function workerSettings() {
  const url = (store.get('cc.workerUrl') || window.CC_CONFIG?.workerUrl || (location.hostname.endsWith('.github.io') ? '' : location.origin)).replace(/\/+$/, '');
  return { url, token: store.get('cc.apiToken') || '' };
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const shortUrl = (href, max = 80) => (href.length > max ? `${href.slice(0, max - 1)}…` : href);

export function mount(host) {
  const prefs = { tab: 'scan', history: true, pngSize: 1024, ...store.json(PREFS_KEY, {}) };
  const savePrefs = () => store.set(PREFS_KEY, JSON.stringify(prefs));
  const panes = { scan: el('section', { class: 'qr-pane' }), create: el('section', { class: 'qr-pane' }), saved: el('section', { class: 'qr-pane' }) };
  const seg = el('div', { class: 'segmented qr-tabs', role: 'tablist' });
  host.append(el('h2', { class: 'tool-title', text: 'QR & Barcode' }), seg, ...Object.values(panes));
  const cleanups = [];

  function showTab(id) {
    prefs.tab = id; savePrefs();
    seg.replaceChildren(...[['scan', 'Scan'], ['create', 'Create'], ['saved', 'Saved']].map(([k, label]) => el('button', {
      class: `seg${k === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(k === id), text: label, onclick: () => showTab(k),
    })));
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== id;
    if (id !== 'scan') scanner.stop();
    if (id === 'create') creator.refresh();
    if (id === 'saved') renderSaved();
  }

  // =====================================================================
  // Scan
  // =====================================================================

  const scanner = (() => {
    const video = el('video', { class: 'qr-video', playsinline: true, muted: true, autoplay: true });
    video.muted = true;
    const frame = el('div', { class: 'qr-frame', 'aria-hidden': 'true' });
    const cam = el('div', { class: 'qr-cam', hidden: true }, video, frame);
    const status = el('p', { class: 'muted small qr-status', 'aria-live': 'polite' });
    const torchBtn = el('button', { class: 'btn small-btn ghost', text: '🔦 Light', hidden: true, onclick: () => toggleTorch() });
    const startBtn = el('button', { class: 'btn primary', text: '📷 Scan with camera', onclick: () => start() });
    const stopBtn = el('button', { class: 'btn ghost', text: 'Stop', hidden: true, onclick: () => stop() });
    const photo = el('input', { type: 'file', accept: 'image/*,.heic,.heif', class: 'visually-hidden', id: 'qr-photo' });
    photo.addEventListener('change', () => { const f = photo.files[0]; photo.value = ''; if (f) scanPhoto(f); });
    const result = el('div', { class: 'qr-result' });
    const intro = el('div', {},
      el('div', { class: 'row wrap' }, startBtn, stopBtn, torchBtn, el('label', { class: 'btn', for: 'qr-photo', text: '🖼 From a photo or screenshot' })),
      el('p', { class: 'muted small', text: 'Nothing opens by itself: you see what the code holds, and links get a safety check first.' }));
    panes.scan.append(intro, cam, status, result, photo);

    let stream = null; let running = false; let timer = 0; let torch = false;
    const work = document.createElement('canvas');
    const wctx = work.getContext('2d', { willReadFrequently: true });

    async function start() {
      result.replaceChildren();
      if (!navigator.mediaDevices?.getUserMedia) { status.textContent = 'This browser can\'t use the camera here. Use "From a photo" instead.'; return; }
      status.textContent = 'Starting camera…';
      try {
        reader(); // start loading the decoder while the camera starts
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      } catch (err) {
        status.textContent = err?.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in Settings → Safari → Camera (or for this app), or use "From a photo".' : `Couldn't start the camera (${err?.message ?? err}).`;
        return;
      }
      video.srcObject = stream;
      cam.hidden = false; startBtn.hidden = true; stopBtn.hidden = false;
      try { await video.play(); } catch { /* autoplay attribute covers it */ }
      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() ?? {};
      torchBtn.hidden = !caps.torch;
      status.textContent = 'Point at a QR code or barcode.';
      running = true;
      loop();
    }

    function stop() {
      running = false;
      clearTimeout(timer);
      for (const t of stream?.getTracks() ?? []) t.stop();
      stream = null; torch = false;
      video.srcObject = null;
      cam.hidden = true; startBtn.hidden = false; stopBtn.hidden = true; torchBtn.hidden = true;
      if (!result.childElementCount) status.textContent = '';
    }

    async function toggleTorch() {
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      torch = !torch;
      try { await track.applyConstraints({ advanced: [{ torch }] }); } catch { torch = false; torchBtn.hidden = true; }
    }

    async function loop() {
      if (!running) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          // The square on screen is the centre of the picture; scan that part.
          const vw = video.videoWidth; const vh = video.videoHeight;
          const side = Math.min(vw, vh);
          const n = Math.min(side, LIVE_MAX);
          work.width = n; work.height = n;
          wctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, n, n);
          const hits = await decode(wctx.getImageData(0, 0, n, n), LIVE_OPTS);
          if (hits.length && running) {
            stop();
            showResult(hits[0].text, hits[0].format, { source: 'camera' });
            return;
          }
        }
      } catch (err) {
        status.textContent = `Scanner error: ${err?.message ?? err}`;
      }
      timer = setTimeout(loop, 90);
    }

    async function scanPhoto(file) {
      stop();
      result.replaceChildren();
      status.textContent = 'Reading the photo…';
      try {
        const bitmap = await decodeImage(file, await sniffType(file));
        // Try the full picture at a sensible size, then a larger one for small codes in big photos.
        let hits = [];
        for (const edge of [1600, 3000]) {
          const fit = fitSize(bitmap.width, bitmap.height, edge);
          const c = drawToCanvas(bitmap, fit.width, fit.height, '#ffffff');
          hits = await decode(c.getContext('2d').getImageData(0, 0, c.width, c.height), PHOTO_OPTS);
          if (hits.length || Math.max(bitmap.width, bitmap.height) <= edge) break;
        }
        bitmap.close?.();
        if (!hits.length) { status.textContent = 'No code found in that photo. Try a closer, sharper picture with the whole code in view.'; return; }
        const unique = [...new Map(hits.map((h) => [h.text, h])).values()];
        if (unique.length === 1) { showResult(unique[0].text, unique[0].format, { source: 'photo' }); return; }
        status.textContent = `${unique.length} codes found in the photo. Pick one:`;
        result.replaceChildren(el('div', { class: 'qr-list' }, ...unique.map((h) => {
          const p = parsePayload(h.text, h.format);
          return el('button', { class: 'qr-item', onclick: () => showResult(h.text, h.format, { source: 'photo' }) },
            el('span', { class: 'qr-item-icon', text: KIND_ICON[p.kind] ?? '▦' }),
            el('span', { class: 'qr-item-body' }, el('strong', { text: p.title }), el('span', { class: 'muted small', text: shortUrl(h.text.replace(/\s+/g, ' '), 70) })));
        })));
      } catch (err) {
        status.textContent = err?.message ?? String(err);
      }
    }

    // ---------- result ----------

    function showResult(text, format, { source = 'camera', fromHistory = false } = {}) {
      status.textContent = '';
      const p = parsePayload(text, format);
      if (!fromHistory && prefs.history) addHistory({ text, format, kind: p.kind, title: p.title, source });
      const card = el('article', { class: 'card qr-card' });
      card.append(el('div', { class: 'card-head' },
        el('h2', {}, `${KIND_ICON[p.kind] ?? '▦'} ${p.title}`),
        el('span', { class: 'pill', text: FORMAT_NAMES[format] ?? format })));

      const actions = el('div', { class: 'row wrap qr-actions' });
      const fields = el('dl', { class: 'meta qr-fields' });
      for (const [label, value, opt] of p.fields) {
        if (p.kind === 'url' && label === 'Link') continue; // shown in the safety panel
        const dd = el('dd', { text: opt?.secret ? '••••••••' : value });
        if (opt?.secret) {
          let shown = false;
          dd.append(' ', el('button', { class: 'btn small-btn ghost', text: 'Show', onclick: (e) => { shown = !shown; dd.firstChild.textContent = shown ? value : '••••••••'; e.target.textContent = shown ? 'Hide' : 'Show'; } }));
        }
        fields.append(el('dt', { text: label }), dd);
      }
      if (fields.childElementCount) card.append(fields);
      for (const w of p.warnings) card.append(el('p', { class: `qr-note ${p.danger ? 'danger' : 'caution'}`, text: `${p.danger ? '⛔' : '⚠️'} ${w}` }));

      const copy = (value, label = 'Copy') => el('button', { class: 'btn small-btn', text: label, onclick: async (e) => { await copyText(value); flash(e.target, 'Copied ✓'); } });

      switch (p.kind) {
        case 'url': card.append(linkPanel(p.data.href)); break;
        case 'wifi':
          if (p.data.password) actions.append(copy(p.data.password, 'Copy password'));
          actions.append(copy(p.data.ssid, 'Copy network name'));
          card.append(el('p', { class: 'muted small', text: `To join on iPhone: Settings → Wi-Fi → "${p.data.ssid}", then paste the password. (The iPhone Camera app can also join directly from the code.)` }));
          break;
        case 'contact':
          actions.append(el('button', { class: 'btn small-btn primary', text: 'Add to Contacts', onclick: () => saveFile(new Blob([contactVcard(p.data)], { type: 'text/vcard' }), `${(p.data.name || 'contact').replace(/[^\w -]+/g, '')}.vcf`) }));
          for (const u of p.data.urls) card.append(linkPanel(/^[a-z]+:/i.test(u) ? u : `https://${u}`, { compact: true }));
          break;
        case 'event':
          actions.append(el('button', { class: 'btn small-btn primary', text: 'Add to Calendar', onclick: () => saveFile(new Blob([eventIcs(p.data.raw)], { type: 'text/calendar' }), 'event.ics') }));
          break;
        case 'email':
          actions.append(el('button', { class: 'btn small-btn primary', text: 'Write email', onclick: () => openExternal(text.startsWith('MATMSG') ? `mailto:${p.data.to}?subject=${encodeURIComponent(p.data.subject)}&body=${encodeURIComponent(p.data.body)}` : text) }), copy(p.data.to, 'Copy address'));
          break;
        case 'phone': actions.append(el('button', { class: 'btn small-btn primary', text: 'Call', onclick: () => openExternal(`tel:${p.data.number}`) }), copy(p.data.number)); break;
        case 'sms': actions.append(el('button', { class: 'btn small-btn primary', text: 'Write text', onclick: () => openExternal(`sms:${p.data.number}${p.data.body ? `&body=${encodeURIComponent(p.data.body)}` : ''}`) }), copy(p.data.number, 'Copy number')); break;
        case 'geo': {
          const ll = `${p.data.lat},${p.data.lon}`;
          actions.append(
            el('button', { class: 'btn small-btn primary', text: 'Apple Maps', onclick: () => openExternal(`https://maps.apple.com/?ll=${ll}${p.data.label ? `&q=${encodeURIComponent(p.data.label)}` : ''}`) }),
            el('button', { class: 'btn small-btn', text: 'Google Maps', onclick: () => openExternal(`https://www.google.com/maps/search/?api=1&query=${ll}`) }), copy(ll, 'Copy coordinates'));
          break;
        }
        case 'product':
          actions.append(el('button', { class: 'btn small-btn primary', text: 'Search the web', onclick: () => openExternal(`https://duckduckgo.com/?q=${encodeURIComponent(p.data.isbn ? `ISBN ${p.data.code}` : p.data.code)}`) }), copy(p.data.code));
          break;
        case 'app':
          if (!p.danger) actions.append(el('button', { class: 'btn small-btn', text: 'Open in app…', onclick: () => { if (confirm(`Open this in the app that handles "${p.data.scheme}:" links?\n\n${shortUrl(text, 200)}`)) openExternal(text); } }));
          break;
        default: {
          // Plain text that contains a link: check that link too.
          const m = /\bhttps?:\/\/[^\s<>"']+/i.exec(text);
          if (m) card.append(linkPanel(m[0].replace(/[).,;!?]+$/, ''), { compact: true }));
        }
      }
      actions.append(copy(text, p.kind === 'url' ? 'Copy link' : 'Copy all'));
      card.append(actions);
      card.append(el('details', { class: 'qr-raw' }, el('summary', { text: 'Raw content' }), el('pre', { text })));
      card.append(el('div', { class: 'row' },
        el('button', { class: 'btn primary', text: '📷 Scan another', onclick: () => start() }),
        el('button', { class: 'btn ghost', text: 'Done', onclick: () => result.replaceChildren() })));
      result.replaceChildren(card);
      card.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }

    return { start, stop, showResult };
  })();

  // ---------- link safety panel ----------

  function linkPanel(href, { compact = false } = {}) {
    const box = el('section', { class: 'qr-link' });
    const offline = analyzeUrl(href);
    let state = { verdict: offline.verdict, findings: offline.findings, finalHref: offline.href, finalAnalysis: null };
    let online = null; let checking = false;

    function render() {
      const a = offline;
      const v = VERDICT_TEXT[state.verdict];
      const fin = state.finalAnalysis;
      const kids = [
        el('div', { class: `qr-verdict ${state.verdict}` },
          el('strong', { text: `${{ ok: '✅', caution: '⚠️', danger: '⛔' }[state.verdict]} ${v.label}` }),
          el('span', { class: 'small', text: online ? `${v.hint} (address and online check)` : `${v.hint} (checked on this phone, nothing was opened)` })),
      ];
      if (a.ok && a.host) {
        kids.push(el('div', { class: 'qr-dest' },
          el('span', { class: 'muted small', text: fin ? 'Starts at' : 'Goes to' }),
          domainLine(a),
          el('code', { class: 'qr-href', text: a.href })));
        if (fin) {
          kids.push(el('div', { class: 'qr-dest' },
            el('span', { class: 'muted small', text: 'Ends up at' }),
            domainLine(fin),
            el('code', { class: 'qr-href', text: fin.href })));
        }
      } else if (a.ok) {
        kids.push(el('code', { class: 'qr-href', text: a.href }));
      }
      if (online) kids.push(onlineDetails(online));

      if (state.findings.length) {
        kids.push(el('ul', { class: 'qr-findings' }, ...state.findings
          .slice().sort((x, y) => rank(y.level) - rank(x.level))
          .map((f) => el('li', { class: f.level }, el('strong', { text: `${{ danger: '⛔', caution: '⚠️', info: 'ℹ️' }[f.level]} ${f.title}` }), f.detail ? el('span', { class: 'small', text: f.detail }) : null))));
      }

      const btns = el('div', { class: 'row wrap' });
      const web = a.ok && (a.scheme === 'http' || a.scheme === 'https');
      if (web && !online) {
        const hidden = state.findings.some((f) => /^Short link|^Goes through a QR code service|^Forwards to/.test(f.title));
        btns.append(el('button', {
          class: `btn small-btn${hidden || state.verdict !== 'ok' ? ' primary' : ''}`, text: checking ? 'Checking…' : '🔍 Check where it leads', disabled: checking,
          onclick: runOnline,
        }));
      }
      if (web) {
        const openBtn = (label, target, primary = false) => el('button', {
          class: `btn small-btn${primary ? ' primary' : ''}${state.verdict === 'danger' ? ' danger' : ''}`, text: label,
          onclick: () => {
            if (state.verdict === 'danger' && !confirm(`This link has signs of a scam:\n\n• ${state.findings.filter((f) => f.level === 'danger').map((f) => f.title).join('\n• ')}\n\nOpen it anyway?`)) return;
            if (state.verdict === 'caution' && !confirm(`Open ${shortUrl(target, 120)}?\n\nRead the warnings first. Don't sign in or pay on a page opened from a QR code.`)) return;
            openExternal(target);
          },
        });
        if (state.finalHref && state.finalHref !== a.href) btns.append(openBtn('Open final page', state.finalHref, state.verdict === 'ok'));
        btns.append(openBtn(state.verdict === 'danger' ? 'Open anyway…' : 'Open link', a.href, state.verdict === 'ok' && state.finalHref === a.href));
        if (a.cleanHref) btns.append(openBtn('Open without tracking', state.finalHref !== a.href ? (analyzeUrl(state.finalHref).cleanHref ?? state.finalHref) : a.cleanHref));
      }
      if (compact) btns.append(el('button', { class: 'btn small-btn', text: 'Copy link', onclick: async (e) => { await copyText(a.href); flash(e.target, 'Copied ✓'); } }));
      kids.push(btns);
      if (web && !online) {
        const { url, token } = workerSettings();
        kids.push(el('p', { class: 'muted small', text: url && token
          ? 'The check opens the link from your Cloudflare Worker, not this phone, and reports each redirect, the final page, the domain\'s age and (if set up) Google Safe Browsing. The site sees a visit, but not your phone.'
          : 'Without the Jobs setup, the check can only look up the domain\'s registration date. Add your Worker in the Jobs tab to also trace redirects and see the final page.' }));
      }
      box.replaceChildren(...kids);
    }

    async function runOnline() {
      checking = true; render();
      try {
        online = await checkOnline(offline);
        state = mergeOnline(offline, online);
      } catch (err) {
        online = null;
        state.findings = [...offline.findings, { level: 'info', title: 'Online check failed', detail: err?.message ?? String(err) }];
      }
      checking = false; render();
    }

    render();
    return box;
  }

  const rank = (l) => ({ danger: 3, caution: 2, info: 1 })[l] ?? 0;

  function domainLine(a) {
    const sub = a.sub ? `${a.sub}.` : '';
    return el('div', { class: 'qr-domain' },
      a.scheme === 'https' ? el('span', { class: 'qr-lock', title: 'Encrypted (https)', text: '🔒' }) : el('span', { class: 'qr-lock', title: 'Not encrypted', text: '🔓' }),
      sub ? el('span', { class: 'qr-sub', text: sub }) : null,
      el('strong', { text: a.regUnicode ?? a.registrable }),
      a.unicodeHost !== a.host ? el('span', { class: 'muted small', text: ` (written ${a.host})` }) : null);
  }

  function onlineDetails(o) {
    const wrap = el('div', { class: 'qr-online' });
    if (o.hops?.length) {
      wrap.append(el('h3', { text: o.hops.length > 1 ? `Path (${o.hops.length - 1} redirect${o.hops.length === 2 ? '' : 's'})` : 'No redirects' }));
      wrap.append(el('ol', { class: 'qr-hops' }, ...o.hops.map((h, i) => el('li', {},
        el('code', { text: shortUrl(h.url, 90) }),
        el('span', { class: 'muted small', text: ` ${h.status ? h.status : 'no answer'}${i > 0 && h.kind && h.kind !== 'http' && h.kind !== 'start' ? ` · ${h.kind === 'meta' ? 'page refresh' : 'script'} redirect` : ''}` })))));
    }
    const fin = o.final;
    if (fin && (fin.title || fin.description || fin.siteName || fin.contentType)) {
      const dl = el('dl', { class: 'meta' });
      for (const [k, v] of [['Page title', fin.title], ['Site', fin.siteName], ['Description', fin.description], ['Content', fin.download ? `Download: ${fin.download}` : fin.contentType]]) if (v) dl.append(el('dt', { text: k }), el('dd', { text: v }));
      wrap.append(el('h3', { text: 'Final page' }), dl);
    }
    const doms = Object.entries(o.domains ?? {});
    if (doms.length) {
      const dl = el('dl', { class: 'meta' });
      for (const [d, info] of doms) {
        const days = ageDays(info?.registered);
        dl.append(el('dt', { text: d }), el('dd', { text: info?.error ? `Registration: ${info.error}` : `Registered ${fmtDate(info.registered)} (${ageText(days)} ago)${info.registrar ? ` · ${info.registrar}` : ''}` }));
      }
      wrap.append(el('h3', { text: 'Domain age' }), dl);
    }
    if (o.safeBrowsing) {
      wrap.append(el('p', { class: 'small', text: o.safeBrowsing.checked
        ? (o.safeBrowsing.matches.length ? '⛔ Google Safe Browsing lists this link as dangerous.' : '✅ Not on Google Safe Browsing\'s list of dangerous sites.')
        : `Google Safe Browsing: ${o.safeBrowsing.error ?? 'not set up (optional GSB_API_KEY on the Worker)'}.` }));
    }
    if (o.partial) wrap.append(el('p', { class: 'muted small', text: 'Redirects weren\'t traced: that needs your Worker (Jobs setup).' }));
    return wrap;
  }

  async function checkOnline(a) {
    const { url, token } = workerSettings();
    if (url && token) {
      const res = await fetch(`${url}/api/linkcheck`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ url: a.href }), cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.status === 422) return { hops: [{ url: a.href, status: 0, kind: 'start' }], final: null, stopped: `Not followed: ${body.error}.`, domains: {} };
      if (!res.ok) throw new Error(res.status === 401 ? 'The Worker token is wrong (Jobs → Settings).' : body.error || `Worker answered ${res.status}`);
      return body;
    }
    // No Worker: the phone can still ask the domain registry (RDAP) how old the domain is.
    if (!a.registrable || /^[\d.[\]:]+$/.test(a.registrable)) return { partial: true, hops: [], final: null, domains: {} };
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(a.registrable)}`, { headers: { accept: 'application/rdap+json, application/json' }, cache: 'no-store', referrerPolicy: 'no-referrer' });
    const info = res.ok ? parseRdap(await res.json()) : { error: res.status === 404 ? 'not found in the registry' : `lookup failed (${res.status})` };
    return { partial: true, hops: [], final: null, domains: { [a.registrable]: info ?? { error: 'no data' } } };
  }

  // ---------- small helpers ----------

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); } catch {
      const ta = el('textarea', { class: 'visually-hidden' }); ta.value = t; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); } finally { ta.remove(); }
    }
  }
  function flash(btn, text) { const old = btn.textContent; btn.textContent = text; setTimeout(() => { btn.textContent = old; }, 1400); }
  function openExternal(href) {
    if (/^https?:/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
    else location.href = href;
  }
  async function saveFile(blob, name) {
    const file = new File([blob], name, { type: blob.type });
    if (canShareFiles([file])) { try { if (await shareFiles([file], name)) return; } catch { /* fall back */ } }
    downloadBlob(blob, name);
  }
  function contactVcard(c) {
    if (/^BEGIN:VCARD/i.test(c.raw ?? '')) return c.raw;
    const [first, ...rest] = (c.name || '').split(' ');
    return KINDS.contact.build({ first, last: rest.join(' '), org: c.org, title: c.title, phone: c.phones[0]?.value, workPhone: c.phones[1]?.value, email: c.emails[0]?.value, website: c.urls[0], street: c.addresses[0], note: c.note });
  }
  function eventIcs(raw) {
    if (/^BEGIN:VCALENDAR/i.test(raw)) return raw;
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Command Center//QR//EN', raw.replace(/\r?\n/g, '\r\n'), 'END:VCALENDAR'].join('\r\n');
  }

  // ---------- history ----------

  async function addHistory(entry) {
    const list = (await idb.get(HISTORY_KEY)) ?? [];
    const now = Date.now();
    const next = [{ id: crypto.randomUUID(), at: now, ...entry }, ...list.filter((h) => h.text !== entry.text)].slice(0, HISTORY_MAX);
    await idb.set(HISTORY_KEY, next);
  }

  // =====================================================================
  // Create
  // =====================================================================

  const creator = (() => {
    const saved = store.json(FORM_KEY, {});
    const st = {
      kind: saved.kind && KINDS[saved.kind] ? saved.kind : 'url',
      values: saved.values ?? {},
      style: { fg: '#000000', bg: '#ffffff', eye: '', transparent: false, dotStyle: 'square', eyeStyle: 'square', margin: 4, caption: '', ecc: 'auto', logoSize: 0.22, ...(saved.style ?? {}) },
    };
    let logo = null; let logoBlob = null;
    const persist = () => store.set(FORM_KEY, JSON.stringify({ kind: st.kind, values: st.values, style: st.style }));

    const kindChips = el('div', { class: 'chips qr-kinds' });
    const form = el('div', { class: 'qr-form' });
    const preview = el('canvas', { class: 'qr-preview', 'aria-label': 'QR code preview' });
    const check = el('p', { class: 'small qr-check', 'aria-live': 'polite' });
    const styleBox = el('details', { class: 'qr-style' }, el('summary', { text: 'Style: colors, shapes, logo, caption' }));
    const exportRow = el('div', { class: 'row wrap qr-export' });
    const logoInput = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', id: 'qr-logo' });
    logoInput.addEventListener('change', async () => {
      const f = logoInput.files[0]; logoInput.value = '';
      if (!f) return;
      await setLogo(f);
      idb.set(LOGO_KEY, f);
    });
    // Preview first, so the code is in view while typing.
    panes.create.append(kindChips, el('div', { class: 'qr-preview-wrap checker' }, preview), check, exportRow, form, styleBox, logoInput);

    idb.get(LOGO_KEY).then(async (b) => { if (b) { await setLogo(b); draw(); } });

    async function setLogo(blob) {
      try {
        const bm = await decodeImage(blob, await sniffType(blob));
        const fit = fitSize(bm.width, bm.height, 512);
        logo = drawToCanvas(bm, fit.width, fit.height, null);
        bm.close?.();
        logoBlob = blob;
      } catch (err) { check.textContent = `Logo: ${err.message}`; }
      renderStyle(); draw();
    }

    // Field specs: [key, label, type, extra]
    const FIELDS = {
      url: [['url', 'Website address', 'url', { placeholder: 'example.com/menu' }]],
      text: [['text', 'Text', 'textarea']],
      wifi: [['ssid', 'Network name (SSID)', 'text'], ['password', 'Password', 'text', { autocomplete: 'off' }], ['security', 'Security', 'select', { options: [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP (old)'], ['nopass', 'None (open)']] }], ['hidden', 'Hidden network', 'checkbox']],
      contact: [['first', 'First name', 'text'], ['last', 'Last name', 'text'], ['phone', 'Mobile phone', 'tel'], ['email', 'Email', 'email'], ['org', 'Company', 'text'],
        ['title', 'Job title', 'text', { more: true }], ['workPhone', 'Work phone', 'tel', { more: true }], ['website', 'Website', 'url', { more: true }], ['street', 'Street', 'text', { more: true }], ['city', 'City', 'text', { more: true }], ['region', 'State', 'text', { more: true }], ['zip', 'ZIP', 'text', { inputmode: 'numeric', more: true }], ['country', 'Country', 'text', { more: true }], ['note', 'Note', 'textarea', { more: true }]],
      email: [['to', 'To', 'email'], ['subject', 'Subject', 'text'], ['body', 'Message', 'textarea']],
      phone: [['number', 'Phone number', 'tel']],
      sms: [['number', 'Phone number', 'tel'], ['message', 'Message', 'textarea']],
      geo: [['address', 'Address (or use coordinates below)', 'text'], ['lat', 'Latitude', 'text', { inputmode: 'decimal' }], ['lon', 'Longitude', 'text', { inputmode: 'decimal' }], ['label', 'Name of the place', 'text'], ['app', 'Opens in', 'select', { options: [['apple', 'Apple Maps link'], ['google', 'Google Maps link'], ['geo', 'Any map app (geo:)']] }]],
      event: [['title', 'Event name', 'text'], ['start', 'Starts', 'datetime-local'], ['end', 'Ends', 'datetime-local'], ['allDay', 'All day', 'checkbox'], ['location', 'Location', 'text'], ['notes', 'Details', 'textarea']],
      social: [['platform', 'Platform', 'select', { options: Object.entries(SOCIAL).map(([k, s]) => [k, s.label]) }], ['handle', 'Username', 'text', { placeholder: '@yourname', autocapitalize: 'off' }]],
    };

    function renderKinds() {
      kindChips.replaceChildren(...Object.entries(KINDS).map(([k, d]) => el('button', { class: `chip${k === st.kind ? ' active' : ''}`, text: d.label, onclick: () => { st.kind = k; persist(); renderKinds(); renderForm(); draw(); } })));
    }

    function renderForm() {
      const v = (st.values[st.kind] ??= {});
      const more = [];
      const nodes = FIELDS[st.kind].map(([key, label, type, { more: isMore, ...extra } = {}]) => {
        let input;
        if (type === 'textarea') input = el('textarea', { class: 'ed-textarea', rows: 3, ...extra });
        else if (type === 'select') input = el('select', {}, ...extra.options.map(([val, l]) => el('option', { value: val, text: l })));
        else input = el('input', { type, ...extra, ...(type === 'checkbox' ? { class: 'qr-check-input' } : {}) });
        const id = `qr-f-${st.kind}-${key}`;
        input.id = id;
        if (type === 'checkbox') input.checked = !!v[key];
        else if (type === 'select') input.value = v[key] ?? extra.options[0][0];
        else input.value = v[key] ?? '';
        if (type === 'select' && v[key] == null) v[key] = extra.options[0][0];
        input.addEventListener('input', () => { v[key] = type === 'checkbox' ? input.checked : input.value; persist(); draw(); });
        input.addEventListener('change', () => { v[key] = type === 'checkbox' ? input.checked : input.value; persist(); draw(); });
        const node = type === 'checkbox'
          ? el('label', { class: 'qr-checkbox', for: id }, input, ` ${label}`)
          : el('label', { for: id }, label, input);
        if (isMore) { more.push(node); return null; }
        return node;
      }).filter(Boolean);
      if (more.length) {
        const filled = more.some((n) => n.querySelector('input, textarea')?.value);
        nodes.push(el('details', { class: 'qr-more', open: filled }, el('summary', { text: 'More: job title, work phone, website, address, note' }), ...more));
      }
      if (st.kind === 'geo') {
        nodes.splice(3, 0, el('button', { class: 'btn small-btn', text: '📍 Use my current location', onclick: (e) => useLocation(e.target) }));
      }
      if (st.kind === 'wifi') nodes.push(el('p', { class: 'muted small', text: 'Guests scan it with the Camera app to join, no typing. Tip: add a caption like "Scan to join" under Style.' }));
      if (st.kind === 'url') nodes.push(el('p', { class: 'muted small', text: 'The link is stored in the code itself (a "static" code): it never expires and doesn\'t go through any QR service.' }));
      form.replaceChildren(...nodes);
    }

    function useLocation(btn) {
      if (!navigator.geolocation) { check.textContent = 'Location isn\'t available in this browser.'; return; }
      btn.disabled = true; btn.textContent = 'Finding you…';
      navigator.geolocation.getCurrentPosition((pos) => {
        const v = st.values.geo;
        v.lat = pos.coords.latitude.toFixed(6); v.lon = pos.coords.longitude.toFixed(6);
        persist(); renderForm(); draw();
      }, (err) => {
        btn.disabled = false; btn.textContent = '📍 Use my current location';
        check.textContent = err.code === 1 ? 'Location permission was denied.' : 'Couldn\'t get your location.';
      }, { enableHighAccuracy: true, timeout: 15000 });
    }

    function renderStyle() {
      const s = st.style;
      const color = (key, label) => {
        const input = el('input', { type: 'color', value: s[key] || s.fg, class: 'qr-color' });
        input.addEventListener('input', () => { s[key] = input.value; persist(); draw(); });
        return el('label', { class: 'qr-color-label' }, label, input);
      };
      const segs = (key, options) => el('div', { class: 'segmented' }, ...Object.entries(options).map(([k, l]) => el('button', { class: `seg${s[key] === k ? ' active' : ''}`, text: l, onclick: () => { s[key] = k; persist(); renderStyle(); draw(); } })));
      const range = (key, label, min, max, step, fmt) => {
        const out = el('output', { text: fmt(s[key]) });
        const input = el('input', { type: 'range', min, max, step, value: s[key] });
        input.addEventListener('input', () => { s[key] = +input.value; out.textContent = fmt(s[key]); persist(); draw(); });
        return el('div', { class: 'field' }, el('span', { text: label }), el('div', { class: 'range-row' }, input, out));
      };
      const transparent = el('input', { type: 'checkbox', class: 'qr-check-input', id: 'qr-transparent' });
      transparent.checked = s.transparent;
      transparent.addEventListener('change', () => { s.transparent = transparent.checked; persist(); draw(); });
      const sameEye = el('input', { type: 'checkbox', class: 'qr-check-input', id: 'qr-same-eye' });
      sameEye.checked = !s.eye;
      sameEye.addEventListener('change', () => { s.eye = sameEye.checked ? '' : s.fg; persist(); renderStyle(); draw(); });
      const caption = el('input', { type: 'text', value: s.caption, placeholder: st.kind === 'wifi' ? 'Scan to join Wi-Fi' : 'e.g. Scan for the menu', maxlength: 40 });
      caption.addEventListener('input', () => { s.caption = caption.value; persist(); draw(); });
      const ecc = el('select', {}, ...[['auto', 'Automatic'], ['L', 'Low (7%)'], ['M', 'Medium (15%)'], ['Q', 'High (25%)'], ['H', 'Highest (30%)']].map(([k, l]) => el('option', { value: k, text: l, selected: s.ecc === k })));
      ecc.addEventListener('change', () => { s.ecc = ecc.value; persist(); draw(); });
      const presets = el('div', { class: 'row wrap qr-presets' }, ...[['#000000', '#ffffff'], ['#1e3a8a', '#ffffff'], ['#14532d', '#f0fdf4'], ['#7c2d12', '#fff7ed'], ['#581c87', '#faf5ff'], ['#111827', '#fde68a']].map(([fg, bg]) => el('button', {
        class: 'qr-swatch', title: `${fg} on ${bg}`, style: { background: bg, borderColor: fg, color: fg }, text: '▦',
        onclick: () => { s.fg = fg; s.bg = bg; if (s.eye) s.eye = fg; persist(); renderStyle(); draw(); },
      })));

      styleBox.replaceChildren(...[styleBox.firstChild,
        el('h3', { text: 'Colors' }), presets,
        el('div', { class: 'row wrap' }, color('fg', 'Code'), color('bg', 'Background'), sameEye.checked ? null : color('eye', 'Corners')),
        el('label', { class: 'qr-checkbox', for: 'qr-same-eye' }, sameEye, ' Corners same color as code'),
        el('label', { class: 'qr-checkbox', for: 'qr-transparent' }, transparent, ' See-through background (PNG/SVG)'),
        el('h3', { text: 'Dots' }), segs('dotStyle', DOT_STYLES),
        el('h3', { text: 'Corner squares' }), segs('eyeStyle', EYE_STYLES),
        el('h3', { text: 'Logo in the middle' }),
        el('div', { class: 'row wrap' },
          el('label', { class: 'btn small-btn', for: 'qr-logo', text: logo ? 'Change logo' : '+ Add logo or photo' }),
          logo ? el('button', { class: 'btn small-btn ghost', text: 'Remove logo', onclick: () => { logo = null; logoBlob = null; idb.del(LOGO_KEY); renderStyle(); draw(); } }) : null),
        logo ? range('logoSize', 'Logo size', 0.12, 0.3, 0.01, (x) => `${Math.round(x * 100)}%`) : null,
        el('label', {}, 'Caption under the code', caption),
        range('margin', 'Quiet zone (white border)', 1, 8, 1, (x) => `${x}`),
        el('label', { class: 'field' }, el('span', { text: 'Error correction (more survives damage and logos, but is denser)' }), ecc)].filter(Boolean));
    }

    let drawTimer = 0; let verifyToken = 0;
    let current = null; // { text, qr }
    function draw() { clearTimeout(drawTimer); drawTimer = setTimeout(drawNow, 60); }
    function eccLevel() { return st.style.ecc === 'auto' ? (logo ? 'H' : 'M') : st.style.ecc; }

    function drawNow() {
      const text = KINDS[st.kind].build(st.values[st.kind] ?? {});
      exportRow.replaceChildren();
      const ctx = preview.getContext('2d');
      if (!text) {
        current = null;
        preview.width = 1; preview.height = 1; ctx.clearRect(0, 0, 1, 1);
        preview.hidden = true;
        check.textContent = 'Fill in the details above to make a code.';
        check.className = 'small qr-check muted';
        return;
      }
      let qr;
      try { qr = encode(text, { ecc: eccLevel(), border: 0 }); } catch {
        current = null; preview.hidden = true;
        check.textContent = `Too much to fit in one QR code (${new TextEncoder().encode(text).length} bytes). Shorten it, or lower the error correction.`;
        check.className = 'small qr-check bad-text';
        return;
      }
      preview.hidden = false;
      const style = { ...st.style, logoFraction: logo ? st.style.logoSize : 0 };
      drawQr(ctx, qr, style, 640, logo);
      current = { text, qr, style };
      const warn = colorWarnings(style.fg, style.bg, style.transparent);
      check.className = 'small qr-check muted';
      check.textContent = `Checking that it scans… (${qr.size}×${qr.size}, ${new TextEncoder().encode(text).length} bytes)`;
      exportRow.append(
        el('button', { class: 'btn primary', text: 'Save PNG', onclick: () => exportPng(false) }),
        el('button', { class: 'btn', text: 'Share', onclick: () => exportPng(true) }),
        el('button', { class: 'btn', text: 'SVG', onclick: () => exportSvg() }),
        el('button', { class: 'btn ghost', text: '☆ Keep in Saved', onclick: () => keepCode() }));
      const token = ++verifyToken;
      verify(qr, style, text).then((ok) => {
        if (token !== verifyToken) return;
        const lines = [ok ? '✓ Scans correctly.' : '⚠ This design doesn\'t scan reliably. Try a smaller logo, more contrast, square dots or higher error correction.', ...warn];
        check.textContent = lines.join(' ');
        check.className = `small qr-check ${ok && !warn.length ? 'ok-text' : 'warn-text'}`;
      });
    }

    async function verify(qr, style, text) {
      // Decode our own rendering, on a white background (transparent codes are judged on white).
      const c = document.createElement('canvas');
      drawQr(c.getContext('2d'), qr, { ...style, transparent: false, bg: style.transparent ? '#ffffff' : style.bg }, 480, logo);
      try {
        const hits = await decode(c.getContext('2d').getImageData(0, 0, c.width, c.height), { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
        return hits.some((h) => h.text === text);
      } catch { return false; }
    }

    const fileStem = () => {
      const v = st.values[st.kind] ?? {};
      const base = { wifi: v.ssid && `wifi-${v.ssid}`, contact: [v.first, v.last].filter(Boolean).join('-'), event: v.title, social: v.handle && `${v.platform}-${v.handle}` }[st.kind] || `qr-${st.kind}`;
      return base.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'qr';
    };

    async function renderBlob(px = prefs.pngSize) {
      const c = document.createElement('canvas');
      drawQr(c.getContext('2d'), current.qr, current.style, px, logo);
      return canvasToBlob(c, 'image/png');
    }

    async function exportPng(share) {
      if (!current) return;
      const blob = await renderBlob();
      const file = new File([blob], `${fileStem()}.png`, { type: 'image/png' });
      if (share && canShareFiles([file])) { try { await shareFiles([file], file.name); return; } catch { /* fall back to download */ } }
      if (!share && canShareFiles([file]) && /iPhone|iPad/.test(navigator.userAgent)) { try { if (await shareFiles([file], file.name)) return; } catch { /* download */ } }
      downloadBlob(blob, file.name);
    }

    async function exportSvg() {
      if (!current) return;
      const href = logoBlob && logo ? logo.toDataURL('image/png') : null;
      const blob = new Blob([toSvg(current.qr, current.style, href)], { type: 'image/svg+xml' });
      downloadBlob(blob, `${fileStem()}.svg`);
    }

    async function keepCode() {
      if (!current) return;
      const name = prompt('Name for this code', fileStem().replace(/-/g, ' '));
      if (name == null) return;
      const list = (await idb.get(SAVED_KEY)) ?? [];
      const thumb = await renderBlob(256);
      list.unshift({ id: crypto.randomUUID(), name: name.trim() || 'QR code', kind: st.kind, values: structuredClone(st.values[st.kind]), style: structuredClone(st.style), logo: logoBlob ?? null, thumb, at: Date.now() });
      await idb.set(SAVED_KEY, list);
      check.textContent = `Saved as "${name.trim() || 'QR code'}". Find it under Saved.`;
    }

    async function load(item) {
      st.kind = item.kind;
      st.values[item.kind] = structuredClone(item.values);
      st.style = { ...st.style, ...item.style };
      if (item.logo) { await setLogo(item.logo); idb.set(LOGO_KEY, item.logo); } else { logo = null; logoBlob = null; idb.del(LOGO_KEY); }
      persist();
      showTab('create');
    }

    function refresh() { renderKinds(); renderForm(); renderStyle(); draw(); }
    return { refresh, load };
  })();

  // =====================================================================
  // Saved: my codes and scan history
  // =====================================================================

  async function renderSaved() {
    const [codes = [], history = []] = await Promise.all([idb.get(SAVED_KEY), idb.get(HISTORY_KEY)]);
    const urls = [];
    const keep = el('input', { type: 'checkbox', class: 'qr-check-input', id: 'qr-keep-history' });
    keep.checked = prefs.history;
    keep.addEventListener('change', () => { prefs.history = keep.checked; savePrefs(); });
    const codeList = codes.length ? el('div', { class: 'qr-saved-grid' }, ...codes.map((c) => {
      const url = c.thumb ? URL.createObjectURL(c.thumb) : null;
      if (url) urls.push(url);
      return el('div', { class: 'qr-saved' },
        el('button', { class: 'qr-saved-open', onclick: () => creator.load(c) },
          url ? el('img', { src: url, alt: '' }) : null,
          el('strong', { text: c.name }), el('span', { class: 'muted small', text: KINDS[c.kind]?.label ?? c.kind })),
        el('button', { class: 'btn small-btn ghost', text: 'Delete', 'aria-label': `Delete ${c.name}`, onclick: async () => {
          if (!confirm(`Delete "${c.name}"?`)) return;
          await idb.set(SAVED_KEY, ((await idb.get(SAVED_KEY)) ?? []).filter((x) => x.id !== c.id));
          renderSaved();
        } }));
    })) : el('p', { class: 'muted small', text: 'Codes you make can be kept here with "☆ Keep in Saved", like your home Wi-Fi.' });

    const histList = history.length ? el('div', { class: 'qr-list' }, ...history.map((h) => el('div', { class: 'qr-item-row' },
      el('button', { class: 'qr-item', onclick: () => { showTab('scan'); scanner.showResult(h.text, h.format, { fromHistory: true }); } },
        el('span', { class: 'qr-item-icon', text: KIND_ICON[h.kind] ?? '▦' }),
        el('span', { class: 'qr-item-body' },
          el('strong', { text: h.title }),
          el('span', { class: 'muted small', text: `${new Date(h.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${shortUrl(h.kind === 'wifi' ? h.text.replace(/P:(?:\\.|[^;])*;/, 'P:••••;') : h.text.replace(/\s+/g, ' '), 60)}` }))),
      el('button', { class: 'btn small-btn ghost', text: '✕', 'aria-label': 'Remove from history', onclick: async () => {
        await idb.set(HISTORY_KEY, ((await idb.get(HISTORY_KEY)) ?? []).filter((x) => x.id !== h.id));
        renderSaved();
      } })))) : el('p', { class: 'muted small', text: prefs.history ? 'Codes you scan appear here.' : 'History is off.' });

    for (const u of panes.saved._urls ?? []) URL.revokeObjectURL(u);
    panes.saved._urls = urls;
    panes.saved.replaceChildren(
      el('h3', { text: 'My codes' }), codeList,
      el('div', { class: 'row space' }, el('h3', { text: 'Scan history' }),
        history.length ? el('button', { class: 'btn small-btn ghost', text: 'Clear history', onclick: async () => { if (confirm('Clear the whole scan history?')) { await idb.del(HISTORY_KEY); renderSaved(); } } }) : null),
      el('label', { class: 'qr-checkbox', for: 'qr-keep-history' }, keep, ' Keep a history of scanned codes (on this phone only)'),
      histList);
  }

  // =====================================================================

  const onVisibility = () => { if (document.hidden) scanner.stop(); };
  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
  showTab(prefs.tab in panes ? prefs.tab : 'scan');

  return () => {
    scanner.stop();
    for (const f of cleanups) f();
    for (const u of panes.saved._urls ?? []) URL.revokeObjectURL(u);
  };
}
