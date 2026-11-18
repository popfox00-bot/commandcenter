// Units: converting between units (length, weight, temperature, volume, area, speed, time, data) and
// currencies. Each kind's units by how many of its base unit one is; temperature by its own formulas.
// Currency by rates from a base (USD): { USD: 1, EUR: 0.92, … }. Pure.

/** [id, name, unit list: [code, label, factor (in the base unit)]] */
export const KINDS = [
  ['length', 'Length', [['mm', 'Millimeters', 0.001], ['cm', 'Centimeters', 0.01], ['m', 'Meters', 1], ['km', 'Kilometers', 1000], ['in', 'Inches', 0.0254], ['ft', 'Feet', 0.3048], ['yd', 'Yards', 0.9144], ['mi', 'Miles', 1609.344], ['nmi', 'Nautical miles', 1852]]],
  ['weight', 'Weight', [['mg', 'Milligrams', 0.001], ['g', 'Grams', 1], ['kg', 'Kilograms', 1000], ['t', 'Metric tons', 1e6], ['oz', 'Ounces', 28.349523125], ['lb', 'Pounds', 453.59237], ['st', 'Stone', 6350.29318], ['ton', 'US tons', 907184.74]]],
  ['temperature', 'Temperature', [['C', 'Celsius', null], ['F', 'Fahrenheit', null], ['K', 'Kelvin', null]]],
  ['volume', 'Volume', [['ml', 'Milliliters', 0.001], ['l', 'Liters', 1], ['tsp', 'Teaspoons', 0.00492892159375], ['tbsp', 'Tablespoons', 0.01478676478125], ['floz', 'Fluid ounces', 0.0295735295625], ['cup', 'Cups', 0.2365882365], ['pt', 'Pints', 0.473176473], ['qt', 'Quarts', 0.946352946], ['gal', 'Gallons', 3.785411784]]],
  ['area', 'Area', [['sqft', 'Square feet', 0.09290304], ['sqm', 'Square meters', 1], ['sqyd', 'Square yards', 0.83612736], ['acre', 'Acres', 4046.8564224], ['ha', 'Hectares', 10000], ['sqmi', 'Square miles', 2589988.110336], ['sqkm', 'Square kilometers', 1e6]]],
  ['speed', 'Speed', [['mph', 'Miles per hour', 0.44704], ['kph', 'Kilometers per hour', 1 / 3.6], ['ms', 'Meters per second', 1], ['kn', 'Knots', 1852 / 3600], ['fps', 'Feet per second', 0.3048]]],
  ['time', 'Time', [['s', 'Seconds', 1], ['min', 'Minutes', 60], ['h', 'Hours', 3600], ['d', 'Days', 86400], ['wk', 'Weeks', 604800], ['mo', 'Months (avg)', 2629746], ['yr', 'Years', 31556952]]],
  ['data', 'Data', [['B', 'Bytes', 1], ['KB', 'Kilobytes', 1e3], ['MB', 'Megabytes', 1e6], ['GB', 'Gigabytes', 1e9], ['TB', 'Terabytes', 1e12], ['KiB', 'Kibibytes', 1024], ['MiB', 'Mebibytes', 1024 ** 2], ['GiB', 'Gibibytes', 1024 ** 3]]],
];

/** The currencies offered (the common ones first), with their names. */
export const CURRENCIES = [['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'British pound'], ['CAD', 'Canadian dollar'], ['MXN', 'Mexican peso'], ['JPY', 'Japanese yen'], ['CNY', 'Chinese yuan'], ['AUD', 'Australian dollar'], ['CHF', 'Swiss franc'], ['INR', 'Indian rupee'], ['KRW', 'South Korean won'], ['BRL', 'Brazilian real'], ['SEK', 'Swedish krona'], ['NOK', 'Norwegian krone'], ['DKK', 'Danish krone'], ['NZD', 'New Zealand dollar'], ['SGD', 'Singapore dollar'], ['HKD', 'Hong Kong dollar'], ['PLN', 'Polish złoty'], ['TRY', 'Turkish lira'], ['ZAR', 'South African rand'], ['THB', 'Thai baht'], ['PHP', 'Philippine peso'], ['ILS', 'Israeli shekel'], ['CZK', 'Czech koruna'], ['HUF', 'Hungarian forint']];

/** `value` in `from` as `to` (same kind). NaN when either isn't known. */
export function convert(kind, value, from, to) {
  const v = Number(value); if (!Number.isFinite(v)) return NaN;
  if (kind === 'temperature') {
    const c = from === 'C' ? v : from === 'F' ? ((v - 32) * 5) / 9 : from === 'K' ? v - 273.15 : NaN;
    return to === 'C' ? c : to === 'F' ? (c * 9) / 5 + 32 : to === 'K' ? c + 273.15 : NaN;
  }
  const units = KINDS.find(([id]) => id === kind)?.[2] ?? [];
  const a = units.find(([u]) => u === from)?.[2]; const b = units.find(([u]) => u === to)?.[2];
  return a && b ? (v * a) / b : NaN;
}

/** `value` of currency `from` in `to`, by `rates` (each currency per one of the base). NaN when unknown. */
export function convertMoney(value, from, to, rates) {
  const v = Number(value); const a = rates?.[from]; const b = rates?.[to];
  return Number.isFinite(v) && a > 0 && b > 0 ? (v / a) * b : NaN;
}

/** A result shown well: up to 6 significant digits, no trailing zeros; money with 2 decimals (0 for yen and won). */
export function show(n, money = '') {
  if (!Number.isFinite(n)) return '—';
  if (money) { const d = ['JPY', 'KRW', 'HUF'].includes(money) ? 0 : 2; return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
  if (n !== 0 && (Math.abs(n) >= 1e9 || Math.abs(n) < 1e-4)) return n.toExponential(4).replace(/\.?0+e/, 'e');
  return Number(n.toPrecision(6)).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/**
 * Rates from a currency API's answer: frankfurter ({ base, date, rates }) or open.er-api ({ base_code,
 * time_last_update_utc, rates }). { base, date, rates (with the base itself as 1) } or null.
 */
export function parseRates(json) {
  const base = json?.base ?? json?.base_code; const rates = json?.rates;
  if (!base || !rates || typeof rates !== 'object') return null;
  const clean = {}; for (const [k, v] of Object.entries(rates)) if (/^[A-Z]{3}$/.test(k) && Number(v) > 0) clean[k] = Number(v);
  clean[base] = 1;
  return { base, date: json.date ?? json.time_last_update_utc ?? '', rates: clean };
}
