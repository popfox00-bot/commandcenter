// Weather for the Updates app and the weather-alerts job (same rules on the phone and in the cloud).
// Sources (free, no key, no account):
//   - National Weather Service (api.weather.gov): active alerts, hourly and 7-day forecast, wind gusts.
//   - Open-Meteo air quality (CAMS model): U.S. AQI now and forecast.
//   - Zippopotam.us: ZIP code -> coordinates (only when the coordinates aren't known yet).
// Everything here is pure: callers fetch, these functions read the JSON.

export const NWS = 'https://api.weather.gov';
export const DEFAULT_PLACE = { zip: '80214', lat: 39.7436, lon: -105.0617, name: 'Lakewood, CO' };

export const DEFAULT_RULES = {
  severities: ['Extreme', 'Severe', 'Moderate'], // NWS alert severities to include (also: Minor)
  freezeF: 32,                                   // freeze alert at or below this...
  freezeMonths: [3, 4, 5, 9, 10, 11],            // ...in these months (spring/fall: plants, sprinklers)
  coldF: 10,                                     // bitter cold, any month
  windGustMph: 45,                               // gusts at or above
  damagingGustMph: 58,                           // a second, louder alert
  aqiMin: 101,                                   // U.S. AQI: 101+ is "Unhealthy for Sensitive Groups"
  hoursAhead: 36,                                // how far ahead to look for freeze/wind/air quality
};

export const urls = {
  zip: (zip) => `https://api.zippopotam.us/us/${encodeURIComponent(zip)}`,
  points: (lat, lon) => `${NWS}/points/${(+lat).toFixed(4)},${(+lon).toFixed(4)}`,
  alerts: (lat, lon) => `${NWS}/alerts/active?point=${(+lat).toFixed(4)},${(+lon).toFixed(4)}`,
  airQuality: (lat, lon, tz = 'America/Denver') => `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${(+lat).toFixed(4)}&longitude=${(+lon).toFixed(4)}&current=us_aqi,pm2_5,ozone&hourly=us_aqi,us_aqi_pm2_5,us_aqi_ozone&timezone=${encodeURIComponent(tz)}&forecast_days=3`,
  /** The NWS forecast page for a place: alerts, forecast, radar. */
  page: (lat, lon) => `https://forecast.weather.gov/MapClick.php?lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`,
};

// ---------- reading the sources ----------

export function parseZip(json) {
  const p = json?.places?.[0];
  if (!p) return null;
  return { zip: json['post code'], lat: +p.latitude, lon: +p.longitude, name: `${p['place name']}, ${p['state abbreviation']}` };
}

export function parsePoint(json) {
  const p = json?.properties;
  if (!p?.forecastHourly) return null;
  const rl = p.relativeLocation?.properties;
  return { forecast: p.forecast, hourly: p.forecastHourly, grid: p.forecastGridData, timeZone: p.timeZone, city: rl ? `${rl.city}, ${rl.state}` : '', office: p.gridId };
}

/** Active NWS alerts, newest first, without cancellations or tests. */
export function parseAlerts(json) {
  return (json?.features ?? []).map((f) => f.properties).filter((p) => p && p.status === 'Actual' && p.messageType !== 'Cancel').map((p) => ({
    // Updates of an alert get new ids; keying on the first message keeps one push per alert.
    key: p.references?.length ? p.references[0].identifier : p.id,
    id: p.id,
    event: p.event,
    headline: p.parameters?.NWSheadline?.[0] || p.headline || p.event,
    severity: p.severity, urgency: p.urgency, certainty: p.certainty,
    start: p.onset || p.effective, end: p.ends || p.expires,
    description: p.description ?? '', instruction: p.instruction ?? '',
    area: p.areaDesc ?? '', sender: p.senderName ?? '',
  })).sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}

/** "10 mph", "10 to 15 mph", "5 km/h" -> highest value in mph. */
export function windMph(s) {
  const nums = String(s ?? '').match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (!nums.length) return null;
  const v = Math.max(...nums);
  return /km/i.test(s) ? Math.round(v * 0.621371) : v;
}

export function parsePeriods(json) {
  return (json?.properties?.periods ?? []).map((p) => ({
    name: p.name, start: p.startTime, end: p.endTime, isDaytime: p.isDaytime,
    tempF: p.temperatureUnit === 'C' ? Math.round(p.temperature * 9 / 5 + 32) : p.temperature,
    windMph: windMph(p.windSpeed), wind: p.windSpeed ? `${p.windDirection ?? ''} ${p.windSpeed}`.trim() : '',
    precip: p.probabilityOfPrecipitation?.value ?? null,
    short: p.shortForecast ?? '', detail: p.detailedForecast ?? '',
  }));
}

/** ISO 8601 duration ("PT3H", "P1DT6H") -> hours. */
export function durationHours(d) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d ?? '');
  return m ? (+(m[1] ?? 0)) * 24 + (+(m[2] ?? 0)) + (+(m[3] ?? 0)) / 60 : 1;
}

/** Hourly wind gusts (mph) from NWS grid data: [{ time: ms, mph }]. */
export function parseGusts(json) {
  const g = json?.properties?.windGust;
  if (!g?.values) return [];
  const kmh = !/m_s-1|mi_h-1|kt/.test(g.uom ?? 'wmoUnit:km_h-1');
  const factor = /m_s-1/.test(g.uom ?? '') ? 2.23694 : /kt/.test(g.uom ?? '') ? 1.15078 : kmh ? 0.621371 : 1;
  const out = [];
  for (const { validTime, value } of g.values) {
    if (value == null) continue;
    const [start, dur] = validTime.split('/');
    const t0 = Date.parse(start);
    const hours = Math.max(1, Math.round(durationHours(dur)));
    for (let h = 0; h < hours; h++) out.push({ time: t0 + h * 3_600_000, mph: Math.round(value * factor) });
  }
  return out;
}

export function parseAirQuality(json) {
  if (!json?.hourly?.time) return null;
  const h = json.hourly;
  return {
    now: json.current ? { aqi: json.current.us_aqi, pm25: json.current.pm2_5, ozone: json.current.ozone, time: json.current.time } : null,
    hourly: h.time.map((t, i) => ({ time: t, aqi: h.us_aqi?.[i] ?? null, pm25: h.us_aqi_pm2_5?.[i] ?? null, ozone: h.us_aqi_ozone?.[i] ?? null })),
    offsetSec: json.utc_offset_seconds ?? 0,
  };
}

// ---------- categories and wording ----------

export const AQI_LEVELS = [
  { max: 50, name: 'Good', color: '#00e400', advice: 'Air quality is fine.' },
  { max: 100, name: 'Moderate', color: '#ffff00', advice: 'Unusually sensitive people should limit long or heavy exertion outdoors.' },
  { max: 150, name: 'Unhealthy for sensitive groups', color: '#ff7e00', advice: 'Children, older adults and people with heart or lung conditions should reduce long or heavy exertion outdoors.' },
  { max: 200, name: 'Unhealthy', color: '#ff0000', advice: 'Everyone should reduce long or heavy exertion outdoors; sensitive groups should avoid it.' },
  { max: 300, name: 'Very unhealthy', color: '#8f3f97', advice: 'Everyone should avoid long or heavy exertion outdoors.' },
  { max: Infinity, name: 'Hazardous', color: '#7e0023', advice: 'Everyone should avoid all physical activity outdoors.' },
];
export const aqiLevel = (aqi) => (aqi == null ? null : AQI_LEVELS.findIndex((l) => aqi <= l.max));

/** Local "YYYY-MM-DD" for a time in a time zone. */
export function localDate(time, timeZone = 'America/Denver') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
}
export function localTime(time, timeZone = 'America/Denver', withDay = false) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', ...(withDay ? { weekday: 'short' } : {}) }).format(new Date(time));
}
/** "tonight", "tomorrow", "Sat" relative to `now`. */
export function dayWord(time, now, timeZone = 'America/Denver') {
  const d = localDate(time, timeZone); const today = localDate(now, timeZone);
  const tomorrow = localDate(+new Date(now) + 86_400_000, timeZone);
  const hour = +new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(time));
  if (d === today) return hour >= 17 ? 'tonight' : 'today';
  if (d === tomorrow) return hour < 6 ? 'tonight' : hour >= 17 ? 'tomorrow night' : 'tomorrow';
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(new Date(time));
}

export function weatherEmoji(short = '', isDaytime = true) {
  const s = short.toLowerCase();
  if (/thunder|t-storm/.test(s)) return '⛈️';
  if (/tornado/.test(s)) return '🌪️';
  if (/blizzard|snow|flurr/.test(s)) return '🌨️';
  if (/sleet|freezing|ice/.test(s)) return '🧊';
  if (/rain|shower|drizzle/.test(s)) return '🌧️';
  if (/fog|haze|smoke/.test(s)) return '🌫️';
  if (/wind|breez|blustery/.test(s)) return '💨';
  if (/partly|mostly sunny|mostly clear|few clouds/.test(s)) return isDaytime ? '⛅' : '☁️';
  if (/cloud|overcast/.test(s)) return '☁️';
  if (/sunny|clear|fair/.test(s)) return isDaytime ? '☀️' : '🌙';
  return isDaytime ? '🌤️' : '🌙';
}

const SEVERITY_LEVEL = { Extreme: 'danger', Severe: 'danger', Moderate: 'warning', Minor: 'info', Unknown: 'info' };

// ---------- what to alert on ----------

/**
 * Turn the forecasts into alert conditions. Each has a stable `key` (one push per thing), a level
 * (danger | warning | info) and words for a person.
 * Input: { alerts, hourly, gusts, air, now (ms), timeZone, rules, lat, lon }
 */
export function assess({ alerts = [], hourly = [], gusts = [], air = null, now, timeZone = 'America/Denver', rules = DEFAULT_RULES, lat, lon }) {
  const r = { ...DEFAULT_RULES, ...rules };
  const out = [];
  const until = now + r.hoursAhead * 3_600_000;
  const link = lat != null ? urls.page(lat, lon) : null;
  const when = (t) => `${dayWord(t, now, timeZone)} ${localTime(t, timeZone)}`;

  for (const a of alerts) {
    if (!r.severities.includes(a.severity)) continue;
    if (a.end && Date.parse(a.end) < now) continue;
    out.push({
      key: `nws:${a.key}`, kind: 'nws', level: SEVERITY_LEVEL[a.severity] ?? 'info',
      title: a.event, detail: a.headline,
      start: a.start, end: a.end, url: link, severity: a.severity, urgency: a.urgency,
    });
  }

  // Temperature: the coldest stretch in the next hours, per night.
  const upcoming = hourly.filter((p) => Date.parse(p.start) >= now - 3_600_000 && Date.parse(p.start) <= until);
  const month = +localDate(now, timeZone).slice(5, 7);
  const coldRuns = (limit) => {
    const runs = [];
    let cur = null;
    for (const p of upcoming) {
      if (p.tempF <= limit) {
        if (!cur) runs.push(cur = { start: p.start, end: p.end, min: p.tempF, minAt: p.start });
        cur.end = p.end;
        if (p.tempF < cur.min) { cur.min = p.tempF; cur.minAt = p.start; }
      } else cur = null;
    }
    return runs;
  };
  for (const run of coldRuns(r.coldF)) {
    out.push({
      key: `cold:${localDate(run.minAt, timeZone)}`, kind: 'cold', level: 'warning',
      title: `Bitter cold: ${run.min}°F ${dayWord(run.minAt, now, timeZone)}`,
      detail: `${r.coldF}°F or colder from ${when(run.start)} to ${when(run.end)}. Cover skin, bring pets in, protect pipes.`,
      start: run.start, end: run.end, url: link,
    });
  }
  if (r.freezeMonths.includes(month)) {
    for (const run of coldRuns(r.freezeF)) {
      if (run.min <= r.coldF) continue; // already covered by the bitter-cold alert
      const hard = run.min <= 28;
      out.push({
        key: `freeze:${localDate(run.minAt, timeZone)}`, kind: 'freeze', level: hard ? 'warning' : 'info',
        title: `${hard ? 'Hard freeze' : 'Freeze'}: low ${run.min}°F ${dayWord(run.minAt, now, timeZone)}`,
        detail: `At or below ${r.freezeF}°F from ${when(run.start)} to ${when(run.end)}. Cover plants, disconnect hoses, check sprinklers.`,
        start: run.start, end: run.end, url: link,
      });
    }
  }

  // Wind gusts, per day, with a louder second tier.
  const byDay = new Map();
  for (const g of gusts) {
    if (g.time < now - 3_600_000 || g.time > until) continue;
    const d = localDate(g.time, timeZone);
    if (!byDay.has(d) || g.mph > byDay.get(d).mph) byDay.set(d, g);
  }
  for (const [d, peak] of byDay) {
    if (peak.mph < r.windGustMph) continue;
    const damaging = peak.mph >= r.damagingGustMph;
    out.push({
      key: `wind:${d}${damaging ? ':damaging' : ''}`, kind: 'wind', level: damaging ? 'danger' : 'warning',
      title: `${damaging ? 'Damaging wind' : 'Strong wind'}: gusts to ${peak.mph} mph ${dayWord(peak.time, now, timeZone)}`,
      detail: `Strongest around ${when(peak.time)}. ${damaging ? 'Expect damage to trees and power lines; stay away from windows.' : 'Secure trash cans, patio furniture and decorations.'}`,
      start: new Date(peak.time).toISOString(), end: null, url: link,
    });
  }

  // Air quality: now and forecast, per day and category.
  if (air) {
    const offset = air.offsetSec ?? 0;
    const toMs = (t) => Date.parse(`${t}Z`) - offset * 1000; // Open-Meteo local times have no offset
    const days = new Map();
    for (const h of air.hourly) {
      const t = toMs(h.time);
      if (h.aqi == null || t < now - 3_600_000 || t > until) continue;
      const d = h.time.slice(0, 10);
      if (!days.has(d) || h.aqi > days.get(d).aqi) days.set(d, { ...h, t });
    }
    if (air.now?.aqi != null) {
      const d = localDate(now, timeZone);
      if (!days.has(d) || air.now.aqi >= days.get(d).aqi) days.set(d, { aqi: air.now.aqi, pm25: null, ozone: null, t: now, current: true });
    }
    for (const [d, peak] of days) {
      if (peak.aqi < r.aqiMin) continue;
      const lvl = aqiLevel(peak.aqi);
      const driver = peak.pm25 != null && peak.ozone != null ? (peak.ozone > peak.pm25 ? 'ozone' : 'fine particles (PM2.5, often smoke)') : '';
      out.push({
        key: `aqi:${d}:${lvl}`, kind: 'aqi', level: lvl >= 3 ? 'danger' : 'warning',
        title: `Air quality ${peak.current ? 'now' : dayWord(peak.t, now, timeZone)}: ${AQI_LEVELS[lvl].name} (AQI ${peak.aqi})`,
        detail: `${AQI_LEVELS[lvl].advice}${driver ? ` Main pollutant: ${driver}.` : ''}`,
        start: new Date(peak.t).toISOString(), end: null, url: 'https://www.airnow.gov/?reportingArea=Denver&stateCode=CO',
      });
    }
  }

  const rank = { danger: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || Date.parse(a.start) - Date.parse(b.start));
}

export const KIND_EMOJI = { nws: '⚠️', freeze: '🥶', cold: '🧊', wind: '💨', aqi: '😷' };
