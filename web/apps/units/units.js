// Units: a unit and currency converter. Pick a kind (Length, Weight, Temperature, Volume, Area, Speed,
// Time, Data, Currency), type an amount, pick From and To (⇅ swaps them); the answer, and the amount in
// every other unit of that kind under it. Currency by the day's rates (European Central Bank, through
// frankfurter.app; else open.er-api.com), kept on this phone so it works offline with the last ones loaded.

import { el, store } from '../../lib/dom.js';
import { KINDS, CURRENCIES, convert, convertMoney, show, parseRates } from './units-core.js';

const PREFS = 'cc.units.prefs';
const RATES = 'cc.units.rates';

export function mount(host) {
  const prefs = { kind: 'length', amount: '1', pick: {}, ...store.json(PREFS, {}) };
  const keep = () => store.set(PREFS, JSON.stringify(prefs));
  let rates = store.json(RATES, null);
  let rateNote = '';

  const kinds = [...KINDS.map(([id, name]) => [id, name]), ['currency', 'Currency']];
  const unitsOf = (k) => (k === 'currency' ? CURRENCIES.map(([c, n]) => [c, `${c} · ${n}`]) : KINDS.find(([id]) => id === k)[2].map(([u, label]) => [u, label]));
  const defaults = { length: ['ft', 'm'], weight: ['lb', 'kg'], temperature: ['F', 'C'], volume: ['cup', 'ml'], area: ['sqft', 'sqm'], speed: ['mph', 'kph'], time: ['h', 'min'], data: ['GB', 'MB'], currency: ['USD', 'EUR'] };
  const pick = (k) => prefs.pick[k] ?? defaults[k];

  const amount = el('input', { class: 'un-amount', type: 'text', inputmode: 'decimal', 'aria-label': 'Amount', value: prefs.amount });
  const fromSel = el('select', { class: 'un-select', 'aria-label': 'From' });
  const toSel = el('select', { class: 'un-select', 'aria-label': 'To' });
  const result = el('div', { class: 'un-result', 'aria-live': 'polite' });
  const all = el('ul', { class: 'un-all' });
  const chips = el('div', { class: 'chips un-kinds', role: 'tablist', 'aria-label': 'Kind' });
  const note = el('p', { class: 'small muted un-note' });

  function value(from, to) {
    const v = Number(String(amount.value).replace(/,/g, ''));
    return prefs.kind === 'currency' ? convertMoney(v, from, to, rates?.rates) : convert(prefs.kind, v, from, to);
  }
  function draw() {
    const k = prefs.kind; const [f, t] = pick(k); const list = unitsOf(k);
    chips.replaceChildren(...kinds.map(([id, name]) => el('button', { type: 'button', class: `chip${id === k ? ' active' : ''}`, role: 'tab', 'aria-selected': String(id === k), text: name, onclick: () => { prefs.kind = id; keep(); draw(); if (id === 'currency') loadRates(); } })));
    fromSel.replaceChildren(...list.map(([u, label]) => el('option', { value: u, text: label, selected: u === f })));
    toSel.replaceChildren(...list.map(([u, label]) => el('option', { value: u, text: label, selected: u === t })));
    compute();
  }
  function compute() {
    const k = prefs.kind; const [f, t] = pick(k); const money = k === 'currency';
    const r = value(f, t);
    const label = (u) => unitsOf(k).find(([c]) => c === u)?.[1] ?? u;
    result.replaceChildren(
      el('span', { class: 'un-big', text: `${show(r, money ? t : '')} ${money ? t : label(t).toLowerCase()}` }),
      el('span', { class: 'small muted', text: `${amount.value || '0'} ${money ? f : label(f).toLowerCase()}` }));
    // (In every other unit of it.)
    all.replaceChildren(...unitsOf(k).filter(([u]) => u !== f && u !== t).slice(0, money ? 8 : 12).map(([u, l]) => el('li', {}, el('span', { text: money ? u : l }), el('strong', { text: show(value(f, u), money ? u : '') }))));
    note.textContent = money ? rateNote || (rates ? `Rates of ${rates.date || 'the last day loaded'}.` : 'Loading today\'s rates…') : '';
  }

  async function loadRates(force = false) {
    const fresh = rates && Date.now() - (rates.at ?? 0) < 6 * 3600_000;
    if (fresh && !force) { compute(); return; }
    rateNote = rates ? `Rates of ${rates.date}; checking for today's…` : 'Loading today\'s rates…'; compute();
    for (const url of ['https://api.frankfurter.app/latest?from=USD', 'https://open.er-api.com/v6/latest/USD']) {
      try {
        const res = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!res.ok) continue;
        const got = parseRates(await res.json());
        if (!got) continue;
        rates = { ...got, at: Date.now() }; store.set(RATES, JSON.stringify(rates));
        rateNote = `Rates of ${rates.date ? String(rates.date).slice(0, 16) : 'today'} (European Central Bank${url.includes('er-api') ? ', via open.er-api.com' : ''}).`;
        compute(); return;
      } catch { /* the next source */ }
    }
    rateNote = rates ? `Offline: using the rates of ${rates.date}.` : 'Couldn\'t load rates: connect once to get them (they\'re kept for offline use).';
    compute();
  }

  amount.addEventListener('input', () => { prefs.amount = amount.value; keep(); compute(); });
  fromSel.addEventListener('change', () => { prefs.pick[prefs.kind] = [fromSel.value, toSel.value]; keep(); compute(); });
  toSel.addEventListener('change', () => { prefs.pick[prefs.kind] = [fromSel.value, toSel.value]; keep(); compute(); });
  const swap = el('button', { type: 'button', class: 'icon-btn un-swap', 'aria-label': 'Swap From and To', text: '⇅', onclick: () => { const [f, t] = pick(prefs.kind); prefs.pick[prefs.kind] = [t, f]; keep(); draw(); } });

  host.append(el('div', { class: 'un' },
    chips,
    el('section', { class: 'card un-card' },
      el('label', { class: 'un-row' }, el('span', { class: 'small muted', text: 'Amount' }), amount),
      el('label', { class: 'un-row' }, el('span', { class: 'small muted', text: 'From' }), fromSel),
      el('div', { class: 'un-swap-row' }, swap),
      el('label', { class: 'un-row' }, el('span', { class: 'small muted', text: 'To' }), toSel),
      result, note),
    el('section', { class: 'card' }, el('h2', { class: 'small muted', text: 'In other units' }), all)));
  draw();
  if (prefs.kind === 'currency') loadRates();
}
