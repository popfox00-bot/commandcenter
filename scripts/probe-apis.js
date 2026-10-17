// Checks the public data sources the Updates app and the weather/sports jobs use, from wherever this
// runs (GitHub Actions in cc-try): HTTP status, whether a browser on the app's origin may read the
// response (CORS), robots.txt for the jobs, and a peek at the JSON. Read-only; no keys involved.
//   node scripts/probe-apis.js
import * as W from '../web/apps/updates/weather-core.js';
import * as S from '../web/apps/updates/sports-core.js';
import { parseRobots, checkRobots } from '../src/core/robots.js';

const ORIGIN = 'https://popfox00-bot.github.io';
const UA = 'CommandCenter/1.0 (github.com/popfox00-bot/commandcenter)';
const { lat, lon } = W.DEFAULT_PLACE;
const OFFICIAL = new Set((await import('../src/jobs/weather-alerts.js')).default.officialApis);

async function probe(label, url, peek) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { origin: ORIGIN, 'user-agent': UA, accept: 'application/geo+json, application/json' }, signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    const acao = res.headers.get('access-control-allow-origin');
    let note = '';
    try { note = peek ? peek(JSON.parse(text)) : ''; } catch (err) { note = `unexpected JSON: ${err.message}`; }
    const robots = OFFICIAL.has(new URL(url).hostname) ? 'n/a (declared official API)' : await robotsFor(url);
    console.log(`${res.ok ? '✔' : '✖'} ${label}: HTTP ${res.status} · ${text.length} bytes · ${Date.now() - started} ms · CORS ${acao ? `allowed (${acao})` : 'NOT allowed'} · robots ${robots}${note ? `\n    ${note}` : ''}`);
    return res.ok;
  } catch (err) {
    console.log(`✖ ${label}: ${err.message}`);
    return false;
  }
}

const robotsCache = new Map();
async function robotsFor(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    robotsCache.set(u.origin, fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': UA } }).then(async (r) => (r.ok ? parseRobots(await r.text()) : [])).catch(() => null));
  }
  const groups = await robotsCache.get(u.origin);
  if (groups == null) return 'unreachable';
  const v = checkRobots(groups, u.pathname + u.search);
  return v.allowed ? 'allows' : `DISALLOWS (${v.rule})`;
}

let ok = true;
ok &= await probe('ZIP lookup', W.urls.zip('80214'), (j) => JSON.stringify(W.parseZip(j)));
let point = null;
ok &= await probe('NWS point', W.urls.points(lat, lon), (j) => { point = W.parsePoint(j); return JSON.stringify({ city: point?.city, office: point?.office, tz: point?.timeZone }); });
ok &= await probe('NWS alerts', W.urls.alerts(lat, lon), (j) => { const a = W.parseAlerts(j); return `${a.length} active: ${a.map((x) => `${x.event} (${x.severity})`).join(', ') || 'none'}`; });
if (point) {
  ok &= await probe('NWS hourly', point.hourly, (j) => { const p = W.parsePeriods(j); return `${p.length} hours; now ${p[0]?.tempF}°F ${p[0]?.short}`; });
  ok &= await probe('NWS 7-day', point.forecast, (j) => { const p = W.parsePeriods(j); return `${p.length} periods; ${p[0]?.name}: ${p[0]?.short}`; });
  ok &= await probe('NWS grid (gusts)', point.grid, (j) => { const g = W.parseGusts(j); return `${g.length} hourly gusts; max next 36h ${Math.max(...g.filter((x) => x.time < Date.now() + 36 * 3.6e6).map((x) => x.mph))} mph`; });
}
ok &= await probe('Open-Meteo air quality', W.urls.airQuality(lat, lon), (j) => { const a = W.parseAirQuality(j); return `AQI now ${a?.now?.aqi}; ${a?.hourly.length} hours`; });
for (const t of S.DEFAULT_TEAMS) {
  ok &= await probe(`ESPN ${t.name} schedule`, S.urls.schedule(t.league, t.team), (j) => { const g = S.parseSchedule(j); const p = S.pickGames(g); const tm = S.parseScheduleTeam(j); return `${g.length} games; team: ${tm?.name} ${tm?.record} · ${tm?.standing}; next: ${p.next ? S.gameLine(p.next, t.team) : '-'}; last: ${p.last ? S.gameLine(p.last, t.team) : '-'}`; });
}
ok &= await probe('ESPN NFL teams (app team picker)', S.urls.teams('nfl'), (j) => `${S.parseTeamList(j).length} teams`);
// Not used yet: other places a team list could come from, to compare browser access (CORS).
for (const u of ['https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/teams', 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings', 'https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard', 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/groups']) {
  await probe(`candidate ${u.replace('https://', '')}`, u, (j) => `top-level keys: ${Object.keys(j).join(', ')}`);
}
process.exitCode = ok ? 0 : 1;
