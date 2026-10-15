// Minimal 5-field cron (minute hour day-of-month month day-of-week) evaluated in an IANA time zone.
// Supports *, lists (1,5), ranges (1-5), and steps (*/15, 0-30/10). Day-of-week 0 and 7 are Sunday.
// When both day-of-month and day-of-week are restricted, either matching counts (standard cron).

import { ConfigError } from './errors.js';

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day-of-week', min: 0, max: 7 },
];

function parseField(src, { name, min, max }) {
  const values = new Set();
  for (const part of src.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) throw new ConfigError(`Invalid cron ${name} field "${src}"`);
    let lo = min;
    let hi = max;
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-').map(Number);
      lo = a;
      hi = b ?? (m[2] ? max : a);
    }
    const step = m[2] ? Number(m[2]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) throw new ConfigError(`Cron ${name} field "${src}" out of range ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) values.add(name === 'day-of-week' && v === 7 ? 0 : v);
  }
  return values;
}

export function parseCron(expr) {
  if (typeof expr !== 'string') throw new ConfigError('Cron expression must be a string');
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new ConfigError(`Cron "${expr}" must have 5 fields (minute hour day month weekday)`);
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]));
  return { expr, minute, hour, dom, month, dow, domStar: parts[2] === '*', dowStar: parts[4] === '*' };
}

const formatters = new Map();
function partsIn(date, timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
    } catch {
      throw new ConfigError(`Unknown time zone "${timeZone}"`);
    }
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { minute: Number(p.minute), hour: Number(p.hour), dom: Number(p.day), month: Number(p.month), dow: wd };
}

function fieldsMatch(cron, p) {
  if (!cron.hour.has(p.hour) || !cron.month.has(p.month)) return false;
  const domOk = cron.dom.has(p.dom);
  const dowOk = cron.dow.has(p.dow);
  if (cron.domStar || cron.dowStar) return domOk && dowOk;
  return domOk || dowOk;
}

export function cronMatches(cron, date, timeZone = 'UTC') {
  const p = partsIn(date, timeZone);
  return cron.minute.has(p.minute) && fieldsMatch(cron, p);
}

/**
 * Most recent fire time at or before `now`, searching back at most `lookbackMinutes`. Null if none.
 * Walks back one UTC hour at a time (one time-zone conversion per hour, so 8 days is ~200
 * conversions: cheap enough for a Worker's 10 ms CPU budget). Zones with a non-whole-hour
 * offset fall back to checking each minute of the hour.
 */
export function previousFire(cron, now, timeZone = 'UTC', lookbackMinutes = 8 * 24 * 60) {
  const startMin = Math.floor(now.getTime() / 60000) * 60000;
  const floor = startMin - lookbackMinutes * 60000;
  const minutesDesc = [...cron.minute].sort((a, b) => b - a);
  for (let h = Math.floor(startMin / 3600000) * 3600000; h >= floor - 3600000; h -= 3600000) {
    const maxMinute = Math.min(59, (startMin - h) / 60000);
    const p = partsIn(new Date(h), timeZone);
    if (p.minute === 0) {
      if (!fieldsMatch(cron, p)) continue;
      const m = minutesDesc.find((x) => x <= maxMinute && h + x * 60000 >= floor);
      if (m !== undefined) return new Date(h + m * 60000);
      continue;
    }
    for (let i = maxMinute; i >= 0; i--) {
      const d = new Date(h + i * 60000);
      if (d.getTime() >= floor && cronMatches(cron, d, timeZone)) return d;
    }
  }
  return null;
}

/**
 * A job is due when its most recent scheduled fire time is later than its last run start.
 * A job that has never run is due as soon as any fire time has passed within the lookback.
 * Late scheduler wake-ups are harmless: the comparison is against the last run, not the current minute.
 */
export function isDue({ cron, now, lastRunAt, timeZone = 'UTC' }) {
  const parsed = typeof cron === 'string' ? parseCron(cron) : cron;
  const fire = previousFire(parsed, now, timeZone);
  if (!fire) return { due: false, fire: null };
  const last = lastRunAt ? new Date(lastRunAt) : null;
  return { due: !last || last < fire, fire };
}
