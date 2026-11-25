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

/** Places by where they are: [name, lat, lon] (cities, and towns people post from, Colorado's among them). */
export const PLACE_COORDS = [
  ['Denver', 39.74, -104.99], ['Boulder', 40.01, -105.27], ['Colorado Springs', 38.83, -104.82], ['Fort Collins', 40.59, -105.08], ['Vail', 39.64, -106.37], ['Aspen', 39.19, -106.82],
  ['Breckenridge', 39.48, -106.04], ['Estes Park', 40.38, -105.52], ['Telluride', 37.94, -107.81], ['Steamboat Springs', 40.48, -106.83], ['Durango', 37.28, -107.88], ['Grand Junction', 39.06, -108.55],
  ['Red Rocks', 39.665, -105.205], ['Golden', 39.76, -105.22], ['Keystone', 39.6, -105.95], ['Winter Park', 39.89, -105.76], ['Pueblo', 38.25, -104.61],
  ['Los Angeles', 34.05, -118.24], ['San Diego', 32.72, -117.16], ['San Francisco', 37.77, -122.42], ['Lake Tahoe', 39.1, -120.03], ['Seattle', 47.61, -122.33], ['Portland', 45.52, -122.68],
  ['Las Vegas', 36.17, -115.14], ['Salt Lake City', 40.76, -111.89], ['Park City', 40.65, -111.5], ['Phoenix', 33.45, -112.07], ['Scottsdale', 33.49, -111.93], ['Sedona', 34.87, -111.76], ['Grand Canyon', 36.1, -112.11],
  ['Santa Fe', 35.69, -105.94], ['Albuquerque', 35.08, -106.65], ['Jackson Hole', 43.48, -110.76], ['Yellowstone', 44.43, -110.59], ['Moab', 38.57, -109.55],
  ['Chicago', 41.88, -87.63], ['Dallas', 32.78, -96.8], ['Austin', 30.27, -97.74], ['Houston', 29.76, -95.37], ['San Antonio', 29.42, -98.49], ['Nashville', 36.16, -86.78], ['New Orleans', 29.95, -90.07],
  ['Minneapolis', 44.98, -93.27], ['Kansas City', 39.1, -94.58], ['St. Louis', 38.63, -90.2], ['Atlanta', 33.75, -84.39], ['Miami', 25.76, -80.19], ['Orlando', 28.54, -81.38], ['Tampa', 27.95, -82.46],
  ['Key West', 24.56, -81.78], ['Charleston', 32.78, -79.93], ['Washington, D.C.', 38.9, -77.04], ['Philadelphia', 39.95, -75.17], ['New York', 40.71, -74.01], ['Boston', 42.36, -71.06], ['Detroit', 42.33, -83.05],
  ['Honolulu', 21.31, -157.86], ['Maui', 20.8, -156.33], ['Kauai', 22.05, -159.5], ['Big Island', 19.6, -155.5], ['Anchorage', 61.22, -149.9], ['San Juan', 18.47, -66.11],
  ['Toronto', 43.65, -79.38], ['Vancouver', 49.28, -123.12], ['Banff', 51.18, -115.57], ['Calgary', 51.05, -114.07], ['Montreal', 45.5, -73.57], ['Mexico City', 19.43, -99.13], ['Cancún', 21.16, -86.85],
  ['Cabo San Lucas', 22.89, -109.91], ['Tulum', 20.21, -87.47], ['Puerto Vallarta', 20.65, -105.23], ['Costa Rica', 9.93, -84.08], ['Rio de Janeiro', -22.91, -43.17], ['São Paulo', -23.55, -46.63], ['Buenos Aires', -34.6, -58.38],
  ['London', 51.51, -0.13], ['Dublin', 53.35, -6.26], ['Edinburgh', 55.95, -3.19], ['Paris', 48.86, 2.35], ['Nice', 43.7, 7.27], ['Barcelona', 41.39, 2.17], ['Madrid', 40.42, -3.7], ['Lisbon', 38.72, -9.14],
  ['Rome', 41.9, 12.5], ['Florence', 43.77, 11.26], ['Venice', 45.44, 12.33], ['Milan', 45.46, 9.19], ['Amalfi', 40.63, 14.6], ['Amsterdam', 52.37, 4.9], ['Brussels', 50.85, 4.35], ['Zurich', 47.38, 8.54],
  ['Vienna', 48.21, 16.37], ['Prague', 50.08, 14.44], ['Budapest', 47.5, 19.04], ['Berlin', 52.52, 13.4], ['Munich', 48.14, 11.58], ['Frankfurt', 50.11, 8.68], ['Hamburg', 53.55, 9.99],
  ['Bucharest', 44.43, 26.1], ['Brașov', 45.66, 25.61], ['Cluj-Napoca', 46.77, 23.6], ['Sibiu', 45.79, 24.15], ['Constanța', 44.18, 28.63], ['Athens', 37.98, 23.73], ['Santorini', 36.39, 25.46], ['Istanbul', 41.01, 28.98],
  ['Copenhagen', 55.68, 12.57], ['Stockholm', 59.33, 18.07], ['Oslo', 59.91, 10.75], ['Reykjavik', 64.15, -21.94], ['Dubai', 25.2, 55.27], ['Cairo', 30.04, 31.24], ['Cape Town', -33.92, 18.42],
  ['Tokyo', 35.68, 139.69], ['Kyoto', 35.01, 135.77], ['Seoul', 37.57, 126.98], ['Beijing', 39.9, 116.41], ['Shanghai', 31.23, 121.47], ['Hong Kong', 22.32, 114.17], ['Singapore', 1.35, 103.82],
  ['Bangkok', 13.76, 100.5], ['Phuket', 7.88, 98.39], ['Bali', -8.41, 115.19], ['Sydney', -33.87, 151.21], ['Melbourne', -37.81, 144.96], ['Auckland', -36.85, 174.76],
];

/** The nearest place in PLACE_COORDS to lat, lon, within `maxKm` (else null). */
export function nearestPlace(lat, lon, maxKm = 60) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rad = Math.PI / 180; let best = null; let bd = Infinity;
  for (const [name, la, lo] of PLACE_COORDS) {
    const a = Math.sin(((la - lat) * rad) / 2) ** 2 + Math.cos(lat * rad) * Math.cos(la * rad) * Math.sin(((lo - lon) * rad) / 2) ** 2;
    const km = 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
    if (km < bd) { bd = km; best = name; }
  }
  return bd <= maxKm ? best : null;
}
