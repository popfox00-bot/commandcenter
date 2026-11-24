// Places and their time zones (for the Clock's world clock and Units' time zone converter): US states, countries
// and big cities by the names people use, each with its IANA time zone; any other zone the browser knows can be
// found by its own name ("Europe/Lisbon"). Times worked out with the browser's own time zone data
// (Intl), daylight saving included.

/** [name, IANA zone] — the names people search for. */
export const PLACES = [
  // United States
  ['Colorado', 'America/Denver'], ['California', 'America/Los_Angeles'], ['New York', 'America/New_York'], ['Hawaii', 'Pacific/Honolulu'],
  ['Alaska', 'America/Anchorage'], ['Arizona', 'America/Phoenix'], ['Texas', 'America/Chicago'], ['Florida', 'America/New_York'],
  ['Illinois', 'America/Chicago'], ['Washington', 'America/Los_Angeles'], ['Oregon', 'America/Los_Angeles'], ['Nevada', 'America/Los_Angeles'],
  ['Utah', 'America/Denver'], ['New Mexico', 'America/Denver'], ['Montana', 'America/Denver'], ['Wyoming', 'America/Denver'], ['Idaho', 'America/Boise'],
  ['Minnesota', 'America/Chicago'], ['Wisconsin', 'America/Chicago'], ['Missouri', 'America/Chicago'], ['Louisiana', 'America/Chicago'], ['Tennessee', 'America/Chicago'],
  ['Georgia (US)', 'America/New_York'], ['Massachusetts', 'America/New_York'], ['Pennsylvania', 'America/New_York'], ['Ohio', 'America/New_York'], ['Michigan', 'America/Detroit'],
  ['North Carolina', 'America/New_York'], ['Virginia', 'America/New_York'], ['Washington, D.C.', 'America/New_York'],
  ['Denver', 'America/Denver'], ['Los Angeles', 'America/Los_Angeles'], ['San Francisco', 'America/Los_Angeles'], ['Seattle', 'America/Los_Angeles'], ['Las Vegas', 'America/Los_Angeles'],
  ['Chicago', 'America/Chicago'], ['Dallas', 'America/Chicago'], ['Houston', 'America/Chicago'], ['Miami', 'America/New_York'], ['Boston', 'America/New_York'], ['Atlanta', 'America/New_York'],
  ['Phoenix', 'America/Phoenix'], ['Honolulu', 'Pacific/Honolulu'], ['Anchorage', 'America/Anchorage'], ['Puerto Rico', 'America/Puerto_Rico'],
  // The Americas
  ['Canada (Toronto)', 'America/Toronto'], ['Vancouver', 'America/Vancouver'], ['Calgary', 'America/Edmonton'], ['Montreal', 'America/Toronto'],
  ['Mexico City', 'America/Mexico_City'], ['Cancún', 'America/Cancun'], ['Brazil (São Paulo)', 'America/Sao_Paulo'], ['Rio de Janeiro', 'America/Sao_Paulo'], ['Argentina', 'America/Argentina/Buenos_Aires'],
  ['Chile', 'America/Santiago'], ['Colombia', 'America/Bogota'], ['Peru', 'America/Lima'], ['Costa Rica', 'America/Costa_Rica'], ['Jamaica', 'America/Jamaica'],
  // Europe
  ['London', 'Europe/London'], ['United Kingdom', 'Europe/London'], ['Ireland', 'Europe/Dublin'], ['Germany', 'Europe/Berlin'], ['Berlin', 'Europe/Berlin'], ['Munich', 'Europe/Berlin'],
  ['Romania', 'Europe/Bucharest'], ['Bucharest', 'Europe/Bucharest'], ['France', 'Europe/Paris'], ['Paris', 'Europe/Paris'], ['Spain', 'Europe/Madrid'], ['Madrid', 'Europe/Madrid'],
  ['Italy', 'Europe/Rome'], ['Rome', 'Europe/Rome'], ['Netherlands', 'Europe/Amsterdam'], ['Amsterdam', 'Europe/Amsterdam'], ['Belgium', 'Europe/Brussels'], ['Switzerland', 'Europe/Zurich'],
  ['Austria', 'Europe/Vienna'], ['Portugal', 'Europe/Lisbon'], ['Greece', 'Europe/Athens'], ['Poland', 'Europe/Warsaw'], ['Czechia', 'Europe/Prague'], ['Hungary', 'Europe/Budapest'],
  ['Sweden', 'Europe/Stockholm'], ['Norway', 'Europe/Oslo'], ['Denmark', 'Europe/Copenhagen'], ['Finland', 'Europe/Helsinki'], ['Iceland', 'Atlantic/Reykjavik'], ['Ukraine', 'Europe/Kyiv'],
  ['Turkey', 'Europe/Istanbul'], ['Istanbul', 'Europe/Istanbul'], ['Russia (Moscow)', 'Europe/Moscow'], ['Bulgaria', 'Europe/Sofia'], ['Moldova', 'Europe/Chisinau'], ['Serbia', 'Europe/Belgrade'], ['Croatia', 'Europe/Zagreb'],
  // Africa and the Middle East
  ['Egypt', 'Africa/Cairo'], ['South Africa', 'Africa/Johannesburg'], ['Nigeria', 'Africa/Lagos'], ['Kenya', 'Africa/Nairobi'], ['Morocco', 'Africa/Casablanca'],
  ['Israel', 'Asia/Jerusalem'], ['Dubai', 'Asia/Dubai'], ['United Arab Emirates', 'Asia/Dubai'], ['Saudi Arabia', 'Asia/Riyadh'], ['Qatar', 'Asia/Qatar'], ['Iran', 'Asia/Tehran'],
  // Asia and the Pacific
  ['India', 'Asia/Kolkata'], ['Pakistan', 'Asia/Karachi'], ['Nepal', 'Asia/Kathmandu'], ['Bangladesh', 'Asia/Dhaka'], ['Thailand', 'Asia/Bangkok'], ['Vietnam', 'Asia/Ho_Chi_Minh'],
  ['Singapore', 'Asia/Singapore'], ['Malaysia', 'Asia/Kuala_Lumpur'], ['Indonesia (Jakarta)', 'Asia/Jakarta'], ['Bali', 'Asia/Makassar'], ['Philippines', 'Asia/Manila'],
  ['China', 'Asia/Shanghai'], ['Beijing', 'Asia/Shanghai'], ['Hong Kong', 'Asia/Hong_Kong'], ['Taiwan', 'Asia/Taipei'], ['South Korea', 'Asia/Seoul'], ['Seoul', 'Asia/Seoul'],
  ['Japan', 'Asia/Tokyo'], ['Tokyo', 'Asia/Tokyo'], ['Australia (Sydney)', 'Australia/Sydney'], ['Melbourne', 'Australia/Melbourne'], ['Brisbane', 'Australia/Brisbane'], ['Perth', 'Australia/Perth'],
  ['New Zealand', 'Pacific/Auckland'], ['Fiji', 'Pacific/Fiji'], ['Guam', 'Pacific/Guam'],
  ['UTC', 'UTC'],
];

/** The world clock's places to start with: Colorado (the big one), then the others. */
export const DEFAULT_CLOCKS = [['Colorado', 'America/Denver'], ['California', 'America/Los_Angeles'], ['New York', 'America/New_York'], ['Hawaii', 'Pacific/Honolulu'], ['London', 'Europe/London'], ['Germany', 'Europe/Berlin'], ['Romania', 'Europe/Bucharest']].map(([name, zone]) => ({ name, zone }));

/** This device's own time zone. */
export const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/** Whether the browser knows a zone. */
export function validZone(zone) { try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; } }

/** A zone as a place name: "Europe/Lisbon" → "Lisbon". */
export const zoneName = (zone) => String(zone).split('/').pop().replace(/_/g, ' ');

/**
 * Places matching `q` (by name, then any zone the browser knows by its own name): [{ name, zone }], at most `n`.
 */
export function searchPlaces(q, n = 12) {
  const s = String(q ?? '').trim().toLowerCase(); if (!s) return PLACES.slice(0, n).map(([name, zone]) => ({ name, zone }));
  const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ns = norm(s);
  const named = PLACES.filter(([name]) => norm(name).includes(ns)).sort(([a], [b]) => (norm(b).startsWith(ns) ? 1 : 0) - (norm(a).startsWith(ns) ? 1 : 0)).map(([name, zone]) => ({ name, zone }));
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone').filter((z) => norm(z.replace(/_/g, ' ')).includes(ns) && !named.some((p) => p.zone === z)).map((z) => ({ name: zoneName(z), zone: z })); } catch { zones = []; }
  return [...named, ...zones].slice(0, n);
}

/** The parts of instant `t` (ms) as a clock in `zone` shows them: { y, mo, d, h, mi, s, wd }. */
export function partsIn(zone, t) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
  const o = {}; for (const p of f.formatToParts(new Date(t))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: o.weekday };
}

/** How far `zone` is ahead of UTC at instant `t`, in minutes (Colorado in winter: -420). */
export function offsetMin(zone, t) {
  const p = partsIn(zone, t);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000) / 60000);
}

/** The instant (ms) when a clock in `zone` shows y-mo-d h:mi (mo 1–12), daylight saving included. */
export function instantOf(zone, y, mo, d, h, mi) {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall - offsetMin(zone, wall) * 60000;
  // (Once more: near a daylight saving change the offset at the answer can differ from the first guess.)
  t = wall - offsetMin(zone, t) * 60000;
  return t;
}

/** A time zone difference as people say it: "+1h", "−7h", "+5h 30m", "same time". */
export function diffLabel(min) {
  if (!min) return 'same time';
  const sign = min > 0 ? '+' : '−'; const a = Math.abs(min); const h = Math.floor(a / 60); const m = a % 60;
  return `${sign}${h ? `${h}h` : ''}${h && m ? ' ' : ''}${m ? `${m}m` : ''}`;
}

/** The calendar day of `zone` at `t` relative to `ref` zone: 'Today' | 'Tomorrow' | 'Yesterday'. */
export function dayLabel(zone, ref, t) {
  const a = partsIn(zone, t); const b = partsIn(ref, t);
  const dd = Math.round((Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(b.y, b.mo - 1, b.d)) / 86400000);
  return dd === 0 ? 'Today' : dd > 0 ? 'Tomorrow' : 'Yesterday';
}

/** "3:05 PM" for parts. */
export function hm12(p) { const h = p.h % 12 || 12; return `${h}:${String(p.mi).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`; }
