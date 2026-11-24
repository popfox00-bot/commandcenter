// Socials' Sports front: games turned into posts. Each NBA, NFL, MLB, NHL and college football game that's
// on or over becomes a post from its league's account: the score in the teams' colors, final or live, the
// stat leaders, and a caption (ESPN's recap headline when it has one, else written from the result). From
// ESPN's public scoreboards (no key), as the Sports app reads them. Pure: callers fetch, these read.

import { LEAGUES } from '../updates/sports-core.js';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
/** [id, label, emoji] of the leagues posted, in their order. */
export const SPORTS_LEAGUES = [['nba', 'NBA', '🏀'], ['nfl', 'NFL', '🏈'], ['mlb', 'MLB', '⚾'], ['nhl', 'NHL', '🏒'], ['ncaaf', 'CFB', '🏈']];
/** Leagues played most days: today's and yesterday's games are read; the others by their week. */
const DAILY = new Set(['nba', 'mlb', 'nhl']);

/** A date as ESPN takes it: 20261124. */
export const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/** The scoreboard URLs to read for a league at `now`: [url]. */
export function boardUrls(league, now = new Date()) {
  const L = LEAGUES[league]; const base = `${ESPN}/${L.sport}/${L.league}/scoreboard`;
  if (!DAILY.has(league)) return [base];
  const y = new Date(now); y.setDate(y.getDate() - 1);
  return [`${base}?dates=${ymd(y)}`, `${base}?dates=${ymd(now)}`];
}

const hex = (c, fb) => (typeof c === 'string' && /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : fb);
const scoreOf = (s) => (s == null ? null : typeof s === 'object' ? (s.displayValue ?? (s.value != null ? String(s.value) : null)) : String(s));

function side(c) {
  if (!c) return null;
  const t = c.team ?? {};
  return {
    abbr: t.abbreviation ?? '', name: t.displayName ?? t.name ?? '', short: t.shortDisplayName ?? t.name ?? t.abbreviation ?? '',
    color: hex(t.color, '#3a3f47'), alt: hex(t.alternateColor, '#ffffff'), score: scoreOf(c.score), winner: c.winner === true,
    record: c.records?.[0]?.summary ?? c.record?.[0]?.summary ?? '', rank: c.curatedRank?.current && c.curatedRank.current < 99 ? c.curatedRank.current : null,
  };
}

/** The first number in a stat ("181 YDS" → 181, "32" → 32), for picking the best. */
const amount = (v) => { const m = String(v ?? '').match(/(\d+(?:\.\d+)?)\s*(?:YDS|yds)?/); const y = String(v ?? '').match(/(\d+)\s*YDS/i); return y ? Number(y[1]) : m ? Number(m[1]) : 0; };

/** The stat leaders: for each stat, whoever did best of the two teams (at most `n`). */
export function topLeaders(comp, n = 4) {
  const all = [];
  const read = (groups, abbr) => { for (const g of groups ?? []) { const top = g.leaders?.[0]; if (!top) continue; const who = top.athlete?.shortName ?? top.athlete?.displayName ?? ''; const value = top.displayValue ?? (top.value != null ? String(top.value) : ''); if (who && value) all.push({ stat: g.shortDisplayName ?? g.abbreviation ?? g.displayName ?? g.name ?? '', key: g.name ?? g.shortDisplayName ?? '', who, value, team: abbr ?? top.team?.abbreviation ?? '' }); } };
  read(comp?.leaders, '');
  for (const c of comp?.competitors ?? []) read(c.leaders, c.team?.abbreviation ?? '');
  const best = new Map();
  for (const l of all) { const k = l.key || l.stat; const was = best.get(k); if (!was || amount(l.value) > amount(was.value)) best.set(k, l); }
  // (Not the summary "rating" stats: points, yards, goals… first, as ESPN orders them.)
  return [...best.values()].filter((l) => !/rating/i.test(l.key)).slice(0, n);
}

/** One game as a post, or null for a game not started. */
export function gamePost(ev, league) {
  const comp = ev?.competitions?.[0]; if (!comp) return null;
  const st = comp.status?.type ?? ev.status?.type ?? {};
  const state = st.state ?? 'pre'; if (state === 'pre') return null;
  const home = side(comp.competitors?.find((c) => c.homeAway === 'home')); const away = side(comp.competitors?.find((c) => c.homeAway === 'away'));
  if (!home || !away) return null;
  const leaders = topLeaders(comp);
  const head = comp.headlines?.[0]; const headline = head?.shortLinkText ?? head?.description ?? '';
  const done = !!st.completed || state === 'post';
  return {
    id: `${league}:${ev.id}`, league, date: ev.date ?? comp.date, state: done ? 'post' : 'in', detail: st.shortDetail ?? st.detail ?? (done ? 'Final' : ''),
    home, away, leaders, headline, caption: captionOf({ state: done ? 'post' : 'in', home, away, leaders, headline, detail: st.shortDetail ?? '' }), venue: comp.venue?.fullName ?? '',
  };
}

/** A caption for a game: the recap headline, else "The Nuggets beat the Lakers 112-104 behind N. Jokic's 32 PTS." */
export function captionOf(g) {
  if (g.state === 'post' && g.headline) return g.headline;
  const hs = Number(g.home.score); const as = Number(g.away.score);
  const top = g.leaders[0];
  if (g.state !== 'post') return `${g.away.short} ${g.away.score ?? 0}, ${g.home.short} ${g.home.score ?? 0} · ${g.detail || 'Live'}${top ? ` · ${top.who}: ${top.value} ${top.stat}` : ''}`;
  if (hs === as) return `${g.away.short} and ${g.home.short} tie ${as}-${hs}.`;
  const [w, l, ws, ls] = hs > as ? [g.home, g.away, hs, as] : [g.away, g.home, as, hs];
  const ot = /OT|SO|\/\d+/.test(g.detail ?? '') ? ` (${g.detail.replace(/^Final\/?/, '') || 'OT'})` : '';
  return `${w.short} beat ${l.short} ${ws}-${ls}${ot}${top ? `, behind ${top.who}'s ${top.value} ${top.stat}` : ''}.`;
}

/** Every post from a scoreboard response. */
export function postsFrom(json, league) { return (json?.events ?? []).map((ev) => gamePost(ev, league)).filter(Boolean); }

/**
 * The feed kept (id → post) updated with fresh posts: a post's result replaced as its game goes on, old ones
 * (over `days` days) let go. Returns the feed's posts newest first.
 */
export function mergeFeed(kept, fresh, now = Date.now(), days = 4) {
  const m = new Map(Object.entries(kept ?? {}));
  for (const p of fresh) m.set(p.id, { ...p, seen: m.get(p.id)?.seen ?? now });
  for (const [k, p] of m) if (now - Date.parse(p.date) > days * 86400000) m.delete(k);
  return Object.fromEntries(m);
}
/** The feed's posts in order: live games first, then results, newest first. */
export const feedOrder = (feed) => Object.values(feed ?? {}).sort((a, b) => (a.state === 'in' ? 0 : 1) - (b.state === 'in' ? 0 : 1) || Date.parse(b.date) - Date.parse(a.date));

/** A steady like count for a post (the same each time it's shown): 800 to ~26,000. */
export function likesOf(id, big = false) {
  let h = 2166136261; for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const base = 800 + ((h >>> 0) % 25000);
  return big ? base * 3 : base;
}

/** A color's lightness (0 dark … 1 light), to pick white or dark text on it. */
export function lightness(c) {
  const n = parseInt(String(c).replace('#', ''), 16); if (!Number.isFinite(n)) return 0;
  const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
