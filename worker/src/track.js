// Packages' live status, for the app (POST /api/track): each tracking number asked of 17TRACK (one service
// for USPS, UPS, FedEx, DHL, Amazon and many more), with the key kept here as the Worker secret
// TRACK17_KEY (never in the app). Numbers are registered with it the first time (it then follows them),
// then their status read. The answer cut down to what the app shows.

const API = 'https://api.17track.net/track/v2.2';
/** The app's carrier ids as 17TRACK's carrier codes (left out: it finds the carrier itself). */
const CODES = { usps: 21051, ups: 100002, fedex: 100003, dhl: 100001 };

export class TrackError extends Error {}

/** [{ number, carrier }] from the app, checked: 1 to 20, each a plausible tracking number. */
export function checkNumbers(list) {
  if (!Array.isArray(list) || !list.length || list.length > 20) throw new TrackError('1 to 20 numbers');
  return list.map((x) => {
    const number = String(x?.number ?? '').toUpperCase().replace(/[\s-]+/g, '');
    if (!/^[A-Z0-9]{6,40}$/.test(number)) throw new TrackError('a tracking number is 6 to 40 letters and digits');
    return { number, carrier: typeof x?.carrier === 'string' ? x.carrier : '' };
  });
}

/** One 17TRACK answer's packages as the app's: { number, status, sub, eta, events: [{ time, text, place }] }. */
export function parseTrackInfo(json) {
  const out = [];
  for (const a of json?.data?.accepted ?? []) {
    const ti = a.track_info ?? {};
    const events = (ti.tracking?.providers ?? []).flatMap((p) => p.events ?? [])
      .map((e) => ({ time: e.time_iso ?? e.time_utc ?? '', text: e.description ?? '', place: e.location ?? '' }))
      .filter((e) => e.text)
      .sort((x, y) => String(y.time).localeCompare(String(x.time)));
    const eta = ti.time_metrics?.estimated_delivery_date?.to ?? ti.time_metrics?.estimated_delivery_date?.from ?? null;
    out.push({ number: a.number, status: ti.latest_status?.status ?? 'NotFound', sub: ti.latest_status?.sub_status ?? '', eta, events: events.slice(0, 40) });
  }
  for (const r of json?.data?.rejected ?? []) out.push({ number: r.number, status: 'NotFound', sub: '', eta: null, events: [], error: r.error?.message ?? 'not found' });
  return out;
}

/** The status of each of `numbers` (checked), asked of 17TRACK with `key`. */
export async function track(numbers, key, f = fetch) {
  if (!key) throw new TrackError('Package tracking isn\'t set up on the Worker yet (the TRACK17_KEY secret).');
  const post = (path, body) => f(`${API}/${path}`, { method: 'POST', headers: { '17token': key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // (Registered first: already registered ones are refused, which is fine.)
  await post('register', numbers.map((n) => (CODES[n.carrier] ? { number: n.number, carrier: CODES[n.carrier] } : { number: n.number }))).catch(() => {});
  const res = await post('gettrackinfo', numbers.map((n) => ({ number: n.number })));
  if (!res.ok) throw new TrackError(`the tracking service answered ${res.status}`);
  return parseTrackInfo(await res.json());
}
