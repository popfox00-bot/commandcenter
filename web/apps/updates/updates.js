// Updates app: Weather (NWS alerts and forecast, air quality) and Sports (your teams' live scores,
// next games and results). Both load straight from public sources on the phone; no setup needed.
// Push notifications for the same things come from the weather-alerts and sports jobs.
// Routes: #/updates (weather), #/updates/sports.

import { el, store } from '../../lib/dom.js';
import * as W from './weather-core.js';
import * as S from './sports-core.js';

const PLACE_KEY = 'cc.updates.place';
const WEATHER_CACHE = 'cc.updates.weather';
const TEAMS_KEY = 'cc.updates.teams';
const SPORTS_CACHE = 'cc.updates.sports';
const TZ = 'America/Denver';

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/geo+json, application/json' }, cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export function mount(host) {
  const seg = el('div', { class: 'segmented upd-tabs', role: 'tablist' });
  const panes = { weather: el('section', { class: 'upd-pane' }), sports: el('section', { class: 'upd-pane' }) };
  host.append(seg, ...Object.values(panes));
  const timers = [];
  let active = null;

  const current = () => (location.hash.split('/')[2] === 'sports' ? 'sports' : 'weather');
  function show() {
    const id = current();
    seg.replaceChildren(...[['weather', '🌤 Weather'], ['sports', '🏟 Sports']].map(([k, label]) => el('a', {
      class: `seg${k === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(k === id), text: label, href: k === 'weather' ? '#/updates' : '#/updates/sports',
    })));
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== id;
    if (active !== id) { active = id; (id === 'weather' ? weather : sports).load(); }
  }

  // =====================================================================
  // Weather
  // =====================================================================

  const weather = (() => {
    const pane = panes.weather;
    let place = { ...W.DEFAULT_PLACE, ...store.json(PLACE_KEY, {}) };
    let loading = false;

    function savePlace(p) { place = p; store.set(PLACE_KEY, JSON.stringify(p)); }

    function locationBar(status) {
      const form = el('form', { class: 'upd-zip', hidden: true },
        el('input', { name: 'zip', inputmode: 'numeric', pattern: '\\d{5}', maxlength: 5, placeholder: 'ZIP code', value: place.zip ?? '', 'aria-label': 'ZIP code' }),
        el('button', { class: 'btn small-btn primary', text: 'Save' }),
        el('button', { type: 'button', class: 'btn small-btn', text: '📍 Here', onclick: useHere }));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const zip = form.zip.value.trim();
        if (!/^\d{5}$/.test(zip)) { form.zip.focus(); return; }
        try {
          const p = W.parseZip(await getJson(W.urls.zip(zip)));
          if (!p) throw new Error('ZIP not found');
          savePlace({ ...p });
          load(true);
        } catch (err) { status.textContent = `Couldn't look up ${zip}: ${err.message}`; }
      });
      return el('div', { class: 'upd-loc' },
        el('div', { class: 'row space' },
          el('strong', { text: `📍 ${place.name}${place.zip ? ` · ${place.zip}` : ''}` }),
          el('div', { class: 'row' },
            el('button', { class: 'btn small-btn ghost', text: 'Change', onclick: () => { form.hidden = !form.hidden; if (!form.hidden) form.zip.focus(); } }),
            el('button', { class: 'btn small-btn ghost', text: '⟳', 'aria-label': 'Refresh weather', onclick: () => load(true) }))),
        form, status);
    }

    function useHere() {
      navigator.geolocation?.getCurrentPosition(async (pos) => {
        const lat = +pos.coords.latitude.toFixed(4); const lon = +pos.coords.longitude.toFixed(4);
        let name = 'Current location';
        try { name = W.parsePoint(await getJson(W.urls.points(lat, lon)))?.city || name; } catch { /* keep generic name */ }
        savePlace({ zip: '', lat, lon, name });
        load(true);
      }, () => {}, { timeout: 15000 });
    }

    async function load(force = false) {
      const cached = store.json(WEATHER_CACHE, null);
      const fresh = cached && cached.lat === place.lat && cached.lon === place.lon;
      if (fresh) render(cached, { stale: true });
      else pane.replaceChildren(locationBar(el('p', { class: 'muted small', text: 'Loading the forecast…' })));
      if (loading || (!force && fresh && Date.now() - cached.at < 5 * 60_000)) { if (fresh) render(cached); return; }
      loading = true;
      const errors = [];
      const soft = (p, what) => p.catch((err) => { errors.push(`${what}: ${err.message}`); return null; });
      try {
        let point = place.point;
        if (!point || point.lat !== place.lat || point.lon !== place.lon) {
          const pt = W.parsePoint(await getJson(W.urls.points(place.lat, place.lon)));
          if (!pt) throw new Error('The Weather Service has no forecast for this place (US only).');
          point = { ...pt, lat: place.lat, lon: place.lon };
          savePlace({ ...place, point });
        }
        const [alerts, hourly, daily, grid, air] = await Promise.all([
          soft(getJson(W.urls.alerts(place.lat, place.lon)), 'Alerts'),
          soft(getJson(point.hourly), 'Hourly forecast'),
          soft(getJson(point.forecast), '7-day forecast'),
          soft(getJson(point.grid), 'Wind gusts'),
          soft(getJson(W.urls.airQuality(place.lat, place.lon, point.timeZone || TZ)), 'Air quality'),
        ]);
        const data = {
          at: Date.now(), lat: place.lat, lon: place.lon, tz: point.timeZone || TZ,
          alerts: alerts ? W.parseAlerts(alerts) : (fresh ? cached.alerts : []),
          hourly: hourly ? W.parsePeriods(hourly) : (fresh ? cached.hourly : []),
          daily: daily ? W.parsePeriods(daily) : (fresh ? cached.daily : []),
          gusts: grid ? W.parseGusts(grid) : (fresh ? cached.gusts : []),
          air: air ? W.parseAirQuality(air) : (fresh ? cached.air : null),
          errors,
        };
        store.set(WEATHER_CACHE, JSON.stringify(data));
        render(data);
      } catch (err) {
        if (fresh) render(cached, { error: `Couldn't refresh: ${err.message}` });
        else pane.replaceChildren(locationBar(el('p', { class: 'bad-text small', text: `Couldn't load the weather: ${err.message}` })));
      } finally { loading = false; }
    }

    function render(d, { stale = false, error = '' } = {}) {
      const now = Date.now();
      const status = el('p', { class: `small ${error ? 'bad-text' : 'muted'}`, text: error || `${stale ? 'Refreshing… · ' : ''}Updated ${ago(d.at)}${d.errors?.length ? ` · missing: ${d.errors.join('; ')}` : ''}` });
      const conditions = W.assess({ alerts: d.alerts, hourly: d.hourly, gusts: d.gusts, air: d.air, now, timeZone: d.tz, lat: d.lat, lon: d.lon });
      const nowP = d.hourly.find((p) => Date.parse(p.end) > now) ?? d.hourly[0];
      const aqiNow = d.air?.now?.aqi;
      const lvl = W.aqiLevel(aqiNow);
      const kids = [locationBar(status)];

      // Now
      if (nowP) {
        kids.push(el('section', { class: 'card upd-now' },
          el('div', { class: 'upd-now-main' },
            el('span', { class: 'upd-now-icon', 'aria-hidden': 'true', text: W.weatherEmoji(nowP.short, nowP.isDaytime) }),
            el('span', { class: 'upd-now-temp', text: `${nowP.tempF}°` }),
            el('span', { class: 'upd-now-text' }, el('strong', { text: nowP.short }), el('span', { class: 'muted small', text: [nowP.wind && `Wind ${nowP.wind}`, nowP.precip != null && `${nowP.precip}% precip`].filter(Boolean).join(' · ') }))),
          lvl != null ? el('div', { class: 'upd-aqi' },
            el('span', { class: 'upd-aqi-dot', style: { background: W.AQI_LEVELS[lvl].color } }),
            el('span', { text: `Air quality ${aqiNow} · ${W.AQI_LEVELS[lvl].name}` })) : null));
      }

      // Alerts and heads-ups
      const nws = conditions.filter((c) => c.kind === 'nws');
      const heads = conditions.filter((c) => c.kind !== 'nws');
      kids.push(el('h3', { text: nws.length ? `⚠️ Weather Service alerts (${nws.length})` : 'Weather Service alerts' }));
      if (!nws.length) kids.push(el('p', { class: 'muted small', text: 'No active alerts for this area.' }));
      for (const c of nws) {
        const a = d.alerts.find((x) => `nws:${x.key}` === c.key);
        kids.push(el('details', { class: `upd-alert ${c.level}` },
          el('summary', {}, el('strong', { text: c.title }), el('span', { class: 'small', text: c.detail })),
          a?.end ? el('p', { class: 'small muted', text: `Until ${W.localTime(a.end, d.tz, true)} · ${a.sender}` }) : null,
          a?.description ? el('p', { class: 'small upd-pre', text: a.description }) : null,
          a?.instruction ? el('p', { class: 'small upd-pre' }, el('strong', { text: 'What to do: ' }), a.instruction) : null));
      }
      kids.push(el('h3', { text: 'Heads-up (next 36 hours)' }));
      if (!heads.length) kids.push(el('p', { class: 'muted small', text: 'No freeze, strong wind or poor air quality expected.' }));
      for (const c of heads) {
        kids.push(el('div', { class: `upd-alert ${c.level}` },
          el('strong', { text: `${W.KIND_EMOJI[c.kind]} ${c.title}` }), el('span', { class: 'small', text: c.detail })));
      }

      // Hourly
      const hours = d.hourly.filter((p) => Date.parse(p.end) > now).slice(0, 24);
      if (hours.length) {
        const gustAt = (t) => d.gusts.find((g) => Math.abs(g.time - Date.parse(t)) < 1_800_000)?.mph;
        kids.push(el('h3', { text: 'Next 24 hours' }), el('div', { class: 'upd-hours' }, ...hours.map((p) => el('div', { class: 'upd-hour' },
          el('span', { class: 'small muted', text: W.localTime(p.start, d.tz).replace(':00', '') }),
          el('span', { 'aria-hidden': 'true', text: W.weatherEmoji(p.short, p.isDaytime) }),
          el('strong', { text: `${p.tempF}°` }),
          el('span', { class: 'small muted', text: p.precip ? `${p.precip}%` : ' ' }),
          el('span', { class: 'small muted', text: gustAt(p.start) ? `💨${gustAt(p.start)}` : ' ' })))));
      }

      // 7-day
      if (d.daily.length) {
        const rows = [];
        for (let i = 0; i < d.daily.length; i++) {
          const p = d.daily[i];
          const night = !p.isDaytime ? p : d.daily[i + 1] && !d.daily[i + 1].isDaytime ? d.daily[i + 1] : null;
          if (!p.isDaytime && i > 0) continue;
          rows.push(el('details', { class: 'upd-day' },
            el('summary', {},
              el('span', { class: 'upd-day-name', text: p.isDaytime ? p.name : 'Tonight' }),
              el('span', { 'aria-hidden': 'true', text: W.weatherEmoji(p.short, p.isDaytime) }),
              el('span', { class: 'upd-day-short small', text: p.short }),
              el('span', { class: 'upd-day-temps' }, p.isDaytime ? el('strong', { text: `${p.tempF}°` }) : null, night ? el('span', { class: 'muted', text: ` ${night.tempF}°` }) : null)),
            el('p', { class: 'small', text: p.detail }), night && night !== p ? el('p', { class: 'small muted', text: `${night.name}: ${night.detail}` }) : null));
          if (night === d.daily[i + 1]) i++;
        }
        kids.push(el('h3', { text: '7-day forecast' }), el('div', { class: 'upd-days' }, ...rows));
      }

      kids.push(el('div', { class: 'row wrap' },
        el('a', { class: 'btn small-btn', href: W.urls.page(d.lat, d.lon), target: '_blank', rel: 'noopener noreferrer', text: 'NWS forecast page' }),
        el('a', { class: 'btn small-btn', href: 'https://radar.weather.gov/', target: '_blank', rel: 'noopener noreferrer', text: 'Radar' }),
        el('a', { class: 'btn small-btn', href: 'https://www.airnow.gov/', target: '_blank', rel: 'noopener noreferrer', text: 'AirNow' })));
      kids.push(pushNote('weather-alerts', 'Push alerts for these (Weather Service alerts, freezes, wind, air quality) come from the weather-alerts job.'));
      kids.push(el('p', { class: 'muted small', text: 'Sources: National Weather Service (alerts, forecast, gusts) and Open-Meteo (U.S. AQI, CAMS model). Air quality is a model estimate; AirNow has the official monitor readings.' }));
      pane.replaceChildren(...kids);
    }

    return { load };
  })();

  // =====================================================================
  // Sports
  // =====================================================================

  const sports = (() => {
    const pane = panes.sports;
    let teams = store.json(TEAMS_KEY, null) ?? S.DEFAULT_TEAMS;
    let editing = false;
    let data = store.json(SPORTS_CACHE, {}); // "league:team" -> { at, team, games, error }
    let timer = 0;
    const keyOf = (t) => `${t.league}:${t.team}`;
    const saveTeams = () => store.set(TEAMS_KEY, JSON.stringify(teams));

    async function loadTeam(t) {
      const sched = await getJson(S.urls.schedule(t.league, t.team));
      return { at: Date.now(), team: S.parseScheduleTeam(sched), games: S.parseSchedule(sched) };
    }

    async function load(force = false) {
      render();
      const stale = teams.filter((t) => force || !data[keyOf(t)] || Date.now() - data[keyOf(t)].at > (hasLive() ? 45_000 : 5 * 60_000));
      await Promise.all(stale.map(async (t) => {
        try { data[keyOf(t)] = await loadTeam(t); } catch (err) { data[keyOf(t)] = { ...(data[keyOf(t)] ?? {}), at: Date.now(), error: err.message }; }
        render();
      }));
      try { store.set(SPORTS_CACHE, JSON.stringify(data)); } catch { /* quota: fine, it's a cache */ }
      schedule();
    }
    const hasLive = () => teams.some((t) => data[keyOf(t)]?.games?.some((g) => g.state === 'in'));
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!pane.hidden && document.visibilityState === 'visible') load(); else schedule(); }, hasLive() ? 45_000 : 5 * 60_000);
    }
    timers.push(() => clearTimeout(timer));

    function teamCard(t) {
      const d = data[keyOf(t)];
      const info = d?.team;
      const color = info?.color ?? '#555';
      const now = Date.now();
      const pick = d?.games ? S.pickGames(d.games, now) : {};
      const lines = [];
      if (pick.live) lines.push(el('p', { class: 'upd-live', text: `🔴 ${S.gameLine(pick.live, info?.id ?? t.team, now, TZ)}` }));
      if (pick.next && pick.next !== pick.live) lines.push(el('p', { class: 'small', text: `Next: ${S.gameLine(pick.next, info?.id ?? t.team, now, TZ)}` }));
      if (pick.last) lines.push(el('p', { class: 'small muted', text: `Last: ${S.gameLine(pick.last, info?.id ?? t.team, now, TZ)}` }));
      if (d && !d.games?.length && !d.error) lines.push(el('p', { class: 'small muted', text: 'No games scheduled right now (off-season?).' }));
      if (d?.error) lines.push(el('p', { class: 'small bad-text', text: `Couldn't refresh: ${d.error}` }));
      if (!d) lines.push(el('p', { class: 'small muted', text: 'Loading…' }));

      const schedule = d?.games?.length ? el('details', { class: 'upd-sched' },
        el('summary', { class: 'small', text: 'Schedule' }),
        el('ol', {}, ...d.games.map((g) => el('li', { class: `small${g.state === 'in' ? ' upd-live' : ''}`, text: S.gameLine(g, info?.id ?? t.team, now, TZ) })))) : null;

      return el('article', { class: 'card upd-team', style: { borderLeftColor: color } },
        el('div', { class: 'card-head' },
          el('div', { class: 'upd-team-head' },
            el('span', { class: 'upd-badge', style: { background: color, color: info?.alt && info.alt.toLowerCase() !== color.toLowerCase() ? info.alt : '#fff' }, text: info?.abbr ?? t.team.toUpperCase() }),
            el('span', {}, el('strong', { text: info?.name ?? t.name ?? t.team }), el('span', { class: 'muted small', text: [S.LEAGUES[t.league]?.name, info?.record, info?.standing].filter(Boolean).join(' · ') }))),
          editing ? el('button', { class: 'btn small-btn ghost', text: 'Remove', onclick: () => { teams = teams.filter((x) => keyOf(x) !== keyOf(t)); saveTeams(); render(); } }) : null),
        ...lines, schedule);
    }

    async function addPicker(box, league) {
      box.replaceChildren(el('p', { class: 'muted small', text: 'Loading teams…' }));
      try {
        const list = S.parseTeamList(await getJson(S.urls.teams(league)));
        const filter = el('input', { type: 'search', placeholder: `Search ${S.LEAGUES[league].name} teams`, 'aria-label': 'Search teams' });
        const ul = el('div', { class: 'upd-team-list' });
        const draw = () => ul.replaceChildren(...list.filter((t) => t.name.toLowerCase().includes(filter.value.toLowerCase())).slice(0, 60).map((t) => el('button', {
          class: 'chip', disabled: teams.some((x) => x.league === league && (x.team === t.id || x.team.toLowerCase() === t.abbr.toLowerCase())),
          text: t.name, onclick: () => { teams.push({ league, team: t.id, name: t.name }); saveTeams(); editing = false; load(); },
        })));
        filter.addEventListener('input', draw);
        draw();
        box.replaceChildren(filter, ul);
      } catch (err) { box.replaceChildren(el('p', { class: 'bad-text small', text: `Couldn't load teams: ${err.message}` })); }
    }

    function render() {
      const kids = [el('div', { class: 'row space' },
        el('h3', { text: 'My teams' }),
        el('div', { class: 'row' },
          el('button', { class: 'btn small-btn ghost', text: editing ? 'Done' : 'Edit', onclick: () => { editing = !editing; render(); } }),
          el('button', { class: 'btn small-btn ghost', text: '⟳', 'aria-label': 'Refresh scores', onclick: () => load(true) })))];
      if (editing) {
        const box = el('div', { class: 'upd-add' });
        kids.push(el('div', { class: 'card' },
          el('strong', { text: 'Add a team' }),
          el('div', { class: 'chips' }, ...Object.entries(S.LEAGUES).map(([k, L]) => el('button', { class: 'chip', text: L.name, onclick: () => addPicker(box, k) }))),
          box,
          el('button', { class: 'btn small-btn ghost', text: 'Reset to Denver teams', onclick: () => { teams = [...S.DEFAULT_TEAMS]; saveTeams(); load(); } })));
      }
      if (!teams.length) kids.push(el('p', { class: 'muted small', text: 'No teams yet. Tap Edit to add some.' }));
      kids.push(...teams.map(teamCard));
      kids.push(pushNote('sports', 'Push updates (final scores, game-day reminders with TV and line) come from the sports job, for the teams set in its settings.'));
      kids.push(el('p', { class: 'muted small', text: 'Scores, schedules and lines from ESPN\'s public data. Lines are for information only.' }));
      pane.replaceChildren(...kids);
    }

    return { load };
  })();

  // ---------- push status ----------

  function pushNote(jobId, text) {
    const url = (store.get('cc.workerUrl') || window.CC_CONFIG?.workerUrl || '').replace(/\/+$/, '');
    const token = store.get('cc.apiToken');
    const box = el('div', { class: 'card upd-push' }, el('strong', { text: '🔔 Push notifications' }), el('span', { class: 'small', text }));
    if (!url || !token) {
      box.append(el('span', { class: 'small muted', text: 'Not set up yet: pushes need the one-time cloud setup (ntfy, Worker, GitHub). Everything on this screen works without it.' }), el('a', { class: 'btn small-btn', href: '#/jobs', text: 'Jobs & setup' }));
      return box;
    }
    const status = el('span', { class: 'small muted', text: 'Checking…' });
    box.append(status, el('a', { class: 'btn small-btn', href: '#/jobs', text: 'Open Jobs' }));
    fetch(`${url}/api/jobs`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }).then((r) => r.json()).then(({ jobs }) => {
      const j = jobs?.find((x) => x.id === jobId);
      status.textContent = !j ? 'This job hasn\'t reported in yet (it appears after its first run).'
        : `${j.enabled ? 'On' : 'Off'} · last run ${j.lastRun ? `${new Date(j.lastRun.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${j.lastRun.status})` : 'never'}`;
    }).catch(() => { status.textContent = 'Couldn\'t reach your Worker.'; });
    return box;
  }

  const onHash = () => { if (location.hash.startsWith('#/updates')) show(); };
  const onVisible = () => { if (document.visibilityState === 'visible' && active) (active === 'weather' ? weather : sports).load(); };
  window.addEventListener('hashchange', onHash);
  document.addEventListener('visibilitychange', onVisible);
  show();
  return () => {
    window.removeEventListener('hashchange', onHash);
    document.removeEventListener('visibilitychange', onVisible);
    for (const t of timers) t();
  };
}
