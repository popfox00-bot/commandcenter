// Calculator: the arithmetic and its state, kept apart from the screen. A standard calculator as a phone's:
// × and ÷ before + and −, % (of the number before it when adding or taking away: 50 + 10% = 55), ±, C / AC,
// = again repeats the last step, and results rounded to 12 significant digits (0.1 + 0.2 = 0.3).

export const OPS = { '+': 1, '−': 1, '×': 2, '÷': 2 };
const round = (v) => (Number.isFinite(v) ? Number(Number(v).toPrecision(12)) : v);

/** [a, op, b, op, c…] worked out, × ÷ first: a number, or NaN (÷ 0). */
export function evaluate(tokens) {
  const t = [...tokens]; if (typeof t[t.length - 1] === 'string') t.pop();
  if (!t.length) return 0;
  const lo = [t[0]];
  for (let i = 1; i < t.length; i += 2) {
    const op = t[i]; const b = t[i + 1];
    if (op === '×' || op === '÷') { const a = lo.pop(); lo.push(op === '×' ? a * b : b === 0 ? NaN : a / b); } else lo.push(op, b);
  }
  let v = lo[0];
  for (let i = 1; i < lo.length; i += 2) v = lo[i] === '+' ? v + lo[i + 1] : v - lo[i + 1];
  return round(v);
}

/** A number as the screen shows it: "1,234.5", "-0.25", "1.234568e+15", "Error". */
export function display(v) {
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return 'Error';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e15 || a < 1e-9)) return v.toExponential(6).replace(/\.?0+e/, 'e');
  const [i, f] = String(round(v)).split('.');
  return `${Number(i).toLocaleString('en-US')}${f ? `.${f}` : ''}`.replace(/^-0$/, '0');
}

export function newCalc() { return { tokens: [], entry: '0', fresh: true, done: false, last: null, error: false }; }

/** The calculator after a key: '0'–'9', '.', '+', '−', '×', '÷', '=', '%', '±', 'C' (clear entry / all), '⌫'. */
export function press(s, key) {
  const c = { ...s, tokens: [...s.tokens] };
  if (c.error && key !== 'C') return c;
  const val = () => Number(c.entry);
  if (/^[0-9]$/.test(key)) {
    if (c.done) { c.tokens = []; c.done = false; c.last = null; }
    if (c.fresh) { c.entry = key; c.fresh = false; } else if (c.entry.replace(/[-.]/g, '').length < 15) c.entry = c.entry === '0' ? key : c.entry === '-0' ? `-${key}` : c.entry + key;
    return c;
  }
  if (key === '.') {
    if (c.done) { c.tokens = []; c.done = false; c.last = null; }
    if (c.fresh) { c.entry = '0.'; c.fresh = false; } else if (!c.entry.includes('.')) c.entry += '.';
    return c;
  }
  if (key in OPS) {
    c.done = false;
    if (c.fresh && typeof c.tokens[c.tokens.length - 1] === 'string') c.tokens[c.tokens.length - 1] = key;
    else { c.tokens.push(val(), key); c.entry = String(evaluate(c.tokens)); }
    c.fresh = true; return c;
  }
  if (key === '=') {
    let toks;
    if (c.done && c.last) toks = [val(), ...c.last];
    else { toks = [...c.tokens, val()]; const n = toks.length; c.last = n >= 3 ? [toks[n - 2], toks[n - 1]] : null; }
    const r = evaluate(toks);
    if (!Number.isFinite(r)) return { ...newCalc(), entry: 'Error', error: true };
    c.tokens = []; c.entry = String(r); c.fresh = true; c.done = true; return c;
  }
  if (key === '%') {
    const op = c.tokens[c.tokens.length - 1];
    const v = (op === '+' || op === '−') ? evaluate(c.tokens.slice(0, -1)) * val() / 100 : val() / 100;
    c.entry = String(round(v)); c.fresh = false; return c;
  }
  if (key === '±') { c.entry = c.entry.startsWith('-') ? c.entry.slice(1) : c.entry === '0' ? '-0' : `-${c.entry}`; if (c.done) c.done = false; return c; }
  if (key === '⌫') { if (c.fresh || c.done) return c; c.entry = c.entry.length > 1 && c.entry !== '-0' ? c.entry.slice(0, -1).replace(/^-$/, '-0') : '0'; if (c.entry === '-0' || c.entry === '0') c.fresh = c.entry === '0'; return c; }
  if (key === 'C') {
    // (C clears what's being typed; then AC clears it all.)
    if (!c.fresh && c.entry !== '0') { c.entry = '0'; c.fresh = true; return c; }
    return newCalc();
  }
  return c;
}

/** What the screen shows: { main, expr, clear: 'C' | 'AC' }. */
export function screen(s) {
  const n = s.error ? 'Error' : s.entry.endsWith('.') ? `${display(Number(s.entry.slice(0, -1)))}.` : /\.\d*0$/.test(s.entry) && !s.fresh ? `${display(Math.trunc(Number(s.entry)))}.${s.entry.split('.')[1]}` : s.entry === '-0' ? '-0' : display(Number(s.entry));
  const expr = s.tokens.map((t) => (typeof t === 'number' ? display(t) : t)).join(' ');
  return { main: n, expr, clear: !s.fresh && s.entry !== '0' ? 'C' : 'AC' };
}
