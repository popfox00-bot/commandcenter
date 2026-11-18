// Packages (a tab of Updates): tracking numbers you add (USPS, UPS, FedEx, DHL, Amazon, OnTrac: the carrier
// told from the number, or picked), each with its live status: a progress bar (label created → in transit →
// out for delivery → delivered), where it is now and when it's expected, and its steps so far. Live status
// comes through your own Worker (the Jobs setup), which asks 17TRACK; checked when the tab opens, every 10
// minutes while it's open, and with ↻. Without it, each has a button to its carrier's own tracking page.
// Kept on this phone.

import { el, store } from '../../lib/dom.js';
import { workerSettings } from '../../lib/worker-api.js';
import { CARRIERS, clean, detectCarrier, carrierName, trackUrl, STEPS, statusOf } from './packages-core.js';

const KEY = 'cc.packages';

export function mount(host) {
  let items = store.json(KEY, []); if (!Array.isArray(items)) items = [];
  const save = () => store.set(KEY, JSON.stringify(items));
  let note = ''; let busy = false;

  const num = el('input', { class: 'pk-num', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'Tracking number', 'aria-label': 'Tracking number' });
  const name = el('input', { class: 'pk-name', type: 'text', placeholder: 'What it is (optional)', 'aria-label': 'What it is' });
  const carrier = el('select', { class: 'pk-carrier', 'aria-label': 'Carrier' },
    el('option', { value: '', text: 'Carrier: found from the number' }), ...CARRIERS.map(([id, n]) => el('option', { value: id, text: n })), el('option', { value: 'other', text: 'Other' }));
  const guess = el('span', { class: 'small muted pk-guess', 'aria-live': 'polite' });
  num.addEventListener('input', () => { const c = detectCarrier(num.value); guess.textContent = num.value.trim() ? (c ? `Looks like ${carrierName(c)}` : 'Carrier not clear: pick it') : ''; });
  const list = el('div', { class: 'pk-list' });
  const status = el('p', { class: 'small muted', 'aria-live': 'polite' });

  function add(e) {
    e?.preventDefault();
    const n = clean(num.value); if (n.length < 6) { status.textContent = 'That doesn\'t look like a tracking number.'; return; }
    if (items.some((p) => p.number === n)) { status.textContent = 'That one is already here.'; return; }
    const c = carrier.value || detectCarrier(n) || 'other';
    items.unshift({ id: `p${Date.now().toString(36)}`, number: n, carrier: c, name: name.value.trim(), added: Date.now(), status: '', events: [], eta: null, checkedAt: 0 });
    save(); num.value = ''; name.value = ''; carrier.value = ''; guess.textContent = '';
    draw(); refresh();
  }

  async function refresh() {
    const live = items.filter((p) => statusOf(p.status).step !== 3 || Date.now() - (p.checkedAt || 0) > 86400_000);
    if (!items.length) { note = ''; draw(); return; }
    const { url, token } = workerSettings();
    if (!url || !token) { note = 'Live status needs your Worker (Settings → Jobs connection) with a tracking key. Until then, each package\'s button opens its carrier\'s page.'; draw(); return; }
    if (navigator.onLine === false) { note = 'Offline: showing the last status.'; draw(); return; }
    if (!live.length) { note = ''; draw(); return; }
    busy = true; note = 'Checking…'; draw();
    try {
      const res = await fetch(`${url}/api/track`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ numbers: live.slice(0, 20).map((p) => ({ number: p.number, carrier: p.carrier })) }), cache: 'no-store' });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 501 ? 'Live status isn\'t set up on your Worker yet (its TRACK17_KEY secret).' : out.error || `your Worker answered ${res.status}`);
      for (const got of out.packages ?? []) {
        const p = items.find((x) => x.number === got.number); if (!p) continue;
        Object.assign(p, { status: got.status, sub: got.sub, eta: got.eta, events: got.events?.length ? got.events : p.events, checkedAt: Date.now(), error: got.error ?? '' });
      }
      save(); note = `Checked ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
    } catch (err) { note = `Couldn't check: ${err.message}`; }
    busy = false; draw();
  }

  const fmt = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const day = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };

  function card(p) {
    const st = statusOf(p.status); const last = p.events?.[0];
    const open = el('details', { class: 'pk-steps' }, el('summary', { class: 'small', text: `All updates (${p.events?.length ?? 0})` }),
      el('ol', { class: 'pk-events' }, ...(p.events ?? []).map((e) => el('li', {}, el('span', { class: 'small muted', text: `${fmt(e.time)}${e.place ? ` · ${e.place}` : ''}` }), el('span', { text: e.text })))));
    return el('article', { class: `card pk-card${st.problem ? ' pk-problem' : ''}${st.step === 3 ? ' pk-done' : ''}`, 'data-number': p.number },
      el('div', { class: 'pk-head' },
        el('div', { class: 'pk-title' }, el('strong', { text: p.name || `${carrierName(p.carrier)} package` }), el('span', { class: 'small muted pk-numtext', text: `${carrierName(p.carrier)} · ${p.number}` })),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${p.name || p.number}`, text: '✕', onclick: () => { if (!confirm(`Stop tracking ${p.name || p.number}?`)) return; items = items.filter((x) => x !== p); save(); draw(); } })),
      el('p', { class: 'pk-status' }, el('strong', { text: st.text }), p.eta && st.step < 3 ? el('span', { class: 'small muted', text: ` · expected ${day(p.eta)}` }) : null),
      // The bar: each step lit as far as it's got.
      el('div', { class: 'pk-bar', role: 'img', 'aria-label': `Progress: ${st.step >= 0 ? STEPS[st.step][1] : 'not started'}` },
        ...STEPS.map(([, label], i) => el('span', { class: `pk-step${i <= st.step ? ' on' : ''}${i === st.step ? ' now' : ''}` }, el('span', { class: 'pk-dot' }), el('span', { class: 'pk-label small', text: label })))),
      last ? el('p', { class: 'small pk-last' }, el('span', { text: last.text }), el('span', { class: 'muted', text: ` · ${fmt(last.time)}${last.place ? ` · ${last.place}` : ''}` })) : null,
      p.error ? el('p', { class: 'small muted', text: p.error }) : null,
      p.events?.length > 1 ? open : null,
      el('a', { class: 'btn small-btn', href: trackUrl(p.carrier, p.number), target: '_blank', rel: 'noopener noreferrer', text: `Track on ${carrierName(p.carrier) === 'Other' ? 'the web' : carrierName(p.carrier)} ↗` }));
  }

  function draw() {
    list.replaceChildren(...(items.length ? items.map(card) : [el('p', { class: 'muted center small', text: 'No packages yet: add a tracking number above.' })]));
    status.textContent = note;
    refreshBtn.disabled = busy;
  }

  const refreshBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Check now', text: '↻', onclick: () => refresh() });
  host.append(el('div', { class: 'pk' },
    el('form', { class: 'card pk-add', onsubmit: add },
      el('div', { class: 'row space' }, el('h2', { text: 'Packages' }), refreshBtn),
      num, guess, name, carrier,
      el('button', { type: 'submit', class: 'btn primary block', text: 'Track it' })),
    status, list));
  draw(); refresh();
  // (Checked again every 10 minutes while it's open.)
  const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 10 * 60_000);
  return () => clearInterval(timer);
}
