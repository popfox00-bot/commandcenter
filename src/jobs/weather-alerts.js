// Weather alerts for one place (default ZIP 80214): National Weather Service alerts (warnings,
// watches, advisories), freezes, bitter cold, strong wind gusts and poor air quality. The rules are
// shared with the Updates app (web/apps/updates/weather-core.js), so the app shows what will push.
// Each condition has a stable key, so it pushes once (e.g. one freeze push per night).
// Sources need no key or account: api.weather.gov (asks for a User-Agent with contact info) and
// Open-Meteo air quality.
import { z } from 'zod';
import { ParseError } from '../core/errors.js';
import * as W from '../../web/apps/updates/weather-core.js';

const rules = W.DEFAULT_RULES;
const SEVERITY = z.enum(['Extreme', 'Severe', 'Moderate', 'Minor']);
const PRIORITY = { danger: 'high', warning: 'default', info: 'low' };
const TAGS = { nws: 'warning', freeze: 'snowflake', cold: 'ice_cube', wind: 'dash', aqi: 'mask' };

export default {
  id: 'weather-alerts',
  name: 'Weather alerts',
  description: 'Weather Service alerts, freezes, wind and air quality for your ZIP code.',
  schedule: '*/20 * * * *',
  // Both are official APIs documented for programmatic use (weather.gov/documentation/services-web-api,
  // open-meteo.com/en/docs/air-quality-api); their robots.txt "Disallow: /" targets search crawlers.
  officialApis: ['api.weather.gov', 'air-quality-api.open-meteo.com'],
  configSchema: z.object({
    zip: z.string().regex(/^\d{5}$/).default(W.DEFAULT_PLACE.zip),
    name: z.string().default(W.DEFAULT_PLACE.name),
    lat: z.number().min(18).max(72).default(W.DEFAULT_PLACE.lat),
    lon: z.number().min(-180).max(-60).default(W.DEFAULT_PLACE.lon),
    /** api.weather.gov asks every app to identify itself with a way to reach its owner. */
    contact: z.string().min(3).default('github.com/popfox00-bot/commandcenter'),
    severities: z.array(SEVERITY).min(1).default(rules.severities),
    freezeF: z.number().default(rules.freezeF),
    freezeMonths: z.array(z.number().int().min(1).max(12)).default(rules.freezeMonths),
    coldF: z.number().default(rules.coldF),
    windGustMph: z.number().positive().default(rules.windGustMph),
    damagingGustMph: z.number().positive().default(rules.damagingGustMph),
    aqiMin: z.number().int().min(0).max(500).default(rules.aqiMin),
    hoursAhead: z.number().int().min(6).max(72).default(rules.hoursAhead),
  }).strict(),
  ui: { primary: 'recent' },
  formatNotification: (item) => {
    const f = item.fields;
    const until = f.end ? `\nUntil ${W.localTime(f.end, 'America/Denver', true)}` : '';
    return {
      title: `${W.KIND_EMOJI[f.kind] ?? '⚠️'} ${item.title}`,
      message: `${f.detail}${until}`,
      url: item.url,
      priority: f.severity === 'Extreme' ? 'max' : PRIORITY[f.level] ?? 'default',
      tags: [TAGS[f.kind] ?? 'warning'],
    };
  },
  async run(ctx) {
    const s = ctx.settings;
    const headers = { 'user-agent': `CommandCenter/1.0 (${s.contact})`, accept: 'application/geo+json' };
    const point = W.parsePoint(await ctx.http.json(W.urls.points(s.lat, s.lon), { headers }));
    if (!point) throw new ParseError(`api.weather.gov has no forecast office for ${s.lat},${s.lon}`);
    const alertsJson = await ctx.http.json(W.urls.alerts(s.lat, s.lon), { headers, cache: false });
    if (!Array.isArray(alertsJson?.features)) throw new ParseError('alerts response has no features array');
    const hourlyJson = await ctx.http.json(point.hourly, { headers });
    const hourly = W.parsePeriods(hourlyJson);
    if (!hourly.length) throw new ParseError('hourly forecast has no periods');

    // Gusts and air quality add to the alerts; if one is down, alert on the rest and say so in the log.
    let gusts = [];
    try { gusts = W.parseGusts(await ctx.http.json(point.grid, { headers })); } catch (err) { ctx.log.warn('wind gusts unavailable', { error: err.message }); }
    let air = null;
    try { air = W.parseAirQuality(await ctx.http.json(W.urls.airQuality(s.lat, s.lon, point.timeZone || ctx.timezone), { headers: { 'user-agent': headers['user-agent'] } })); } catch (err) { ctx.log.warn('air quality unavailable', { error: err.message }); }

    const conditions = W.assess({
      alerts: W.parseAlerts(alertsJson), hourly, gusts, air,
      now: ctx.now.getTime(), timeZone: point.timeZone || ctx.timezone, lat: s.lat, lon: s.lon,
      rules: { severities: s.severities, freezeF: s.freezeF, freezeMonths: s.freezeMonths, coldF: s.coldF, windGustMph: s.windGustMph, damagingGustMph: s.damagingGustMph, aqiMin: s.aqiMin, hoursAhead: s.hoursAhead },
    });
    ctx.log.info('weather assessed', { place: s.name, conditions: conditions.length, hours: hourly.length, gusts: gusts.length, air: !!air });
    return conditions.map((c) => ({
      key: c.key, type: 'weather', title: c.title, url: c.url,
      fields: { kind: c.kind, level: c.level, detail: c.detail, start: c.start ?? null, end: c.end ?? null, severity: c.severity ?? null, place: s.name },
      timestamp: ctx.now,
    }));
  },
};
