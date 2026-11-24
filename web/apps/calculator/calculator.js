// Calculator (Productivity): a standard calculator laid out as a phone's (C / AC, ±, %, ÷ × − +, =), with the
// sum so far shown small above the number, ⌫ to take back a digit, and the keyboard too (digits, + - * /,
// Enter, Backspace, Esc). The arithmetic: calc-core.js.

import { el } from '../../lib/dom.js';
import { newCalc, press, screen } from './calc-core.js';

const KEYS = [
  ['C', 'fn'], ['±', 'fn'], ['%', 'fn'], ['÷', 'op'],
  ['7'], ['8'], ['9'], ['×', 'op'],
  ['4'], ['5'], ['6'], ['−', 'op'],
  ['1'], ['2'], ['3'], ['+', 'op'],
  ['0', 'zero'], ['.'], ['=', 'op eq'],
];
const LABEL = { '÷': 'Divide', '×': 'Multiply', '−': 'Subtract', '+': 'Add', '=': 'Equals', '±': 'Plus or minus', '%': 'Percent', '.': 'Decimal point' };

export function mount(host) {
  let s = newCalc();
  const expr = el('div', { class: 'calc-expr', 'aria-live': 'polite' });
  const main = el('output', { class: 'calc-main', 'aria-live': 'polite' });
  const back = el('button', { type: 'button', class: 'calc-back', 'aria-label': 'Delete last digit', text: '⌫', onclick: () => go('⌫') });
  const btns = new Map();
  const pad = el('div', { class: 'calc-pad' }, KEYS.map(([k, kind = 'num']) => {
    const b = el('button', { type: 'button', class: `calc-key calc-${kind.split(' ').join(' calc-')}`, 'aria-label': LABEL[k] ?? k, text: k, onclick: () => go(k) });
    btns.set(k, b); return b;
  }));
  function draw() {
    const v = screen(s);
    main.textContent = v.main; expr.textContent = v.expr || ' ';
    main.classList.toggle('calc-long', v.main.length > 9); main.classList.toggle('calc-longer', v.main.length > 13);
    const c = btns.get('C'); c.textContent = v.clear; c.setAttribute('aria-label', v.clear === 'C' ? 'Clear entry' : 'All clear');
    // (The operator waiting for its number: lit.)
    const last = s.tokens[s.tokens.length - 1];
    for (const op of ['÷', '×', '−', '+']) btns.get(op).classList.toggle('on', s.fresh && last === op);
  }
  function go(k) { s = press(s, k); draw(); }
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    const map = { '*': '×', x: '×', '/': '÷', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'C', Delete: 'C', ',': '.', '.': '.', '%': '%' };
    const k = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
    if (!k) return; e.preventDefault(); go(k);
  };
  document.addEventListener('keydown', onKey);
  host.append(el('div', { class: 'calc' }, el('div', { class: 'calc-screen' }, expr, el('div', { class: 'calc-row' }, back, main)), pad));
  draw();
  return () => document.removeEventListener('keydown', onKey);
}
