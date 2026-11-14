// What sits on the home screen above the apps: today's weather and your teams' games at a glance (from
// what Weather and Sports last loaded, kept on the phone: Home makes no requests of its own), and Recent
// edits (unfinished work in any editor, newest first, each opening its app, which offers to continue).

import { el, store } from './dom.js';
import { idb } from './idb.js';

const WEATHER_CACHE = 'cc.updates.weather';
const SPORTS_CACHE = 'cc.updates.sports';
const PLACE_KEY = 'cc.updates.place';
const DEFAULT_PLACE_NAME = 'Lakewood, CO';

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayOf = (iso) => {
  const d = new Date(iso); const t = new Date(); const k = (x) => x.toDateString();
  const tomorrow = new Date(t.getTime() + 86_400_000);
  return k(d) === k(t) ? 'Today' : k(d) === k(tomorrow) ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

/** A short summary of the weather Weather last loaded: { place, now, sky, high, low, alerts, at } or null. */
export function weatherSummary(data = store.json(WEATHER_CACHE, null), place = store.json(PLACE_KEY, {})) {
  if (!data?.hourly?.length && !data?.daily?.length) return null;
  const now = Date.now();
  const hour = (data.hourly ?? []).find((p) => Date.parse(p.end) > now) ?? data.hourly?.[0] ?? null;
  // (Today's high and low: the day's period and the night after it.)
  const day = (data.daily ?? []).find((p) => p.isDaytime && Date.parse(p.end) > now) ?? null;
  const night = (data.daily ?? []).find((p) => !p.isDaytime && Date.parse(p.end) > now) ?? null;
  return {
    place: place?.name || DEFAULT_PLACE_NAME,
    now: hour?.tempF ?? day?.tempF ?? null, sky: hour?.short ?? day?.short ?? '',
    high: day?.tempF ?? null, low: night?.tempF ?? null, rain: hour?.precip ?? null,
    alerts: (data.alerts ?? []).length, alert: data.alerts?.[0]?.event ?? data.alerts?.[0]?.headline ?? null, at: data.at,
  };
}

/**
 * The game to show from what Sports last loaded: a live one first, else the next one coming up, else the
 * latest result (within two days). { game, live, at } or null.
 */
export function gameSummary(data = store.json(SPORTS_CACHE, {})) {
  const games = []; let at = 0;
  for (const v of Object.values(data ?? {})) { if (!v?.games) continue; at = Math.max(at, v.at ?? 0); for (const g of v.games) games.push(g); }
  if (!games.length) return null;
  const now = Date.now();
  const seen = new Map(); for (const g of games) seen.set(g.id, g);
  const all = [...seen.values()];
  const live = all.filter((g) => g.state === 'in');
  if (live.length) return { game: live[0], live: true, more: live.length - 1, at };
  const next = all.filter((g) => g.state === 'pre' && Date.parse(g.date) > now - 3 * 3600_000).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  const last = all.filter((g) => g.completed && now - Date.parse(g.date) < 2 * 86_400_000).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  if (last && (!next || Date.parse(next.date) - now > 12 * 3600_000)) return { game: last, live: false, at };
  return next ? { game: next, live: false, at } : last ? { game: last, live: false, at } : null;
}

/** The two at-a-glance cards (weather, games), each opening its app. */
export function glanceCards() {
  const w = weatherSummary(); const g = gameSummary();
  const weather = el('a', { class: 'glance card', href: '#/weather', 'aria-label': 'Weather' },
    el('span', { class: 'glance-head small muted' }, el('span', { text: '⛅ Weather' }), w ? el('span', { text: w.place }) : null),
    w ? el('span', { class: 'glance-main' }, el('strong', { class: 'glance-big', text: w.now != null ? `${w.now}°` : '—' }), el('span', { class: 'small', text: w.sky })) : el('span', { class: 'small muted', text: 'Open Weather to see your forecast here.' }),
    w ? el('span', { class: 'small muted', text: [w.high != null ? `H ${w.high}°` : null, w.low != null ? `L ${w.low}°` : null, w.rain ? `${w.rain}% rain` : null].filter(Boolean).join(' · ') || ago(w.at) }) : null,
    w?.alerts ? el('span', { class: 'glance-alert small', text: `⚠️ ${w.alert ?? 'Alert'}${w.alerts > 1 ? ` +${w.alerts - 1}` : ''}` }) : null);
  const side = (s) => (s ? `${s.abbr || s.short}${s.score != null ? ` ${s.score}` : ''}` : '');
  let line = 'Open Sports to see your teams here.'; let sub = '';
  if (g) {
    const { game } = g;
    line = `${side(game.away)}  @  ${side(game.home)}`;
    sub = g.live ? `🔴 ${game.detail || 'Live'}${g.more ? ` · +${g.more} live` : ''}` : game.completed ? `Final · ${dayOf(game.date)}` : `${dayOf(game.date)} ${timeOf(game.date)}${game.tv ? ` · ${game.tv}` : ''}`;
  }
  const sports = el('a', { class: `glance card${g?.live ? ' live' : ''}`, href: '#/sports', 'aria-label': 'Sports' },
    el('span', { class: 'glance-head small muted' }, el('span', { text: '🏆 Sports' }), g ? el('span', { text: g.live ? 'Live' : g.game.completed ? 'Latest' : 'Next' }) : null),
    el('strong', { class: g ? 'glance-game' : 'small muted', text: line }),
    sub ? el('span', { class: 'small muted', text: sub }) : null);
  return el('div', { class: 'glance-row' }, weather, sports);
}

/** Unfinished work kept by the editors: [{ key, name, icon, href, at, blob? }] newest first. */
export async function recentEdits() {
  const SESSIONS = [
    ['editor.session', 'Photo Editor', '🖼️', '#/files/photo', (v) => v.blob],
    ['fm.session', 'FM', '🎭', '#/fm', (v) => v.blob],
    ['refill.session', 'Reverse Fill', '🎨', '#/refill', (v) => v.blob],
    ['collage.session', 'Collage', '🧩', '#/files/collage', (v) => v.images?.[0]?.blob],
    ['scan.session', 'Scan', '📷', '#/files/scan', (v) => v.pages?.[0]?.blob],
    ['pdfwrite.session', 'PDF', '📄', '#/files/pdf', () => null],
    ['fashion.session', 'Fashion', '👕', '#/fashion', (v) => v.baseFile],
  ];
  const out = [];
  for (const [key, name, icon, href, pic] of SESSIONS) {
    const v = await idb.get(key);
    if (!v || !v.savedAt) continue;
    const b = pic(v);
    out.push({ key, name, icon, href, at: v.savedAt, blob: b instanceof Blob && /^image\//.test(b.type || 'image/') ? b : null, file: v.name ?? null });
  }
  // (The drawing worked on last.)
  const draws = await idb.get('draw.list');
  if (Array.isArray(draws) && draws.length) {
    const d = [...draws].sort((a, b) => b.updated - a.updated)[0];
    const thumb = await idb.get(`draw.thumb.${d.id}`);
    out.push({ key: `draw.${d.id}`, name: 'Draw', icon: '✏️', href: '#/draw', at: d.updated, blob: thumb instanceof Blob ? thumb : null, thumb: typeof thumb === 'string' ? thumb : null, file: d.name });
  }
  return out.filter((r) => Date.now() - r.at < 30 * 86_400_000).sort((a, b) => b.at - a.at).slice(0, 6);
}

/** The Recent edits strip (empty when there's nothing unfinished). URLs made for its pictures are kept in `urls` to free later. */
export async function recentStrip(urls) {
  const list = await recentEdits();
  if (!list.length) return null;
  return el('section', { class: 'recent', 'aria-label': 'Recent edits' },
    el('h2', { class: 'small muted recent-title', text: 'Recent edits' }),
    el('div', { class: 'recent-row' }, ...list.map((r) => {
      let src = r.thumb ?? null;
      if (!src && r.blob) { src = URL.createObjectURL(r.blob); urls.push(src); }
      return el('a', { class: 'recent-item', href: r.href, 'aria-label': `Continue in ${r.name}` },
        src ? el('img', { class: 'recent-pic', src, alt: '' }) : el('span', { class: 'recent-pic recent-icon', 'aria-hidden': 'true', text: r.icon }),
        el('span', { class: 'recent-name small', text: `${r.icon} ${r.name}` }),
        el('span', { class: 'recent-when small muted', text: ago(r.at) }));
    })));
}
