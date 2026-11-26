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
    id: String(t.id ?? c.id ?? ''), abbr: t.abbreviation ?? '', name: t.displayName ?? t.name ?? '', short: t.shortDisplayName ?? t.name ?? t.abbreviation ?? '',
    color: hex(t.color, '#3a3f47'), alt: hex(t.alternateColor, '#ffffff'), score: scoreOf(c.score), winner: c.winner === true,
    record: c.records?.[0]?.summary ?? c.record?.[0]?.summary ?? '', rank: c.curatedRank?.current && c.curatedRank.current < 99 ? c.curatedRank.current : null,
  };
}

/** A stat line made short: football's "27/35, 341 YDS, 3 TD" → "341 YDS, 3 TD", "18 CAR, 96 YDS" → "96 YDS". */
export const compact = (v) => String(v ?? '').replace(/^\d+\/\d+,\s*/, '').replace(/^\d+\s*(CAR|REC|ATT),\s*/i, '');

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

/**
 * Each team's own leaders: { home: [...], away: [...] } (each [{ stat, who, value }], at most `n`), from the
 * teams' leader groups, else the game's leaders that name the team.
 */
export function teamLeaders(comp, n = 3) {
  const out = { home: [], away: [] };
  const read = (groups) => (groups ?? []).map((g) => { const top = g.leaders?.[0]; const who = top?.athlete?.shortName ?? top?.athlete?.displayName ?? ''; const value = top?.displayValue ?? (top?.value != null ? String(top.value) : ''); return who && value && !/rating/i.test(g.name ?? '') ? { stat: g.shortDisplayName ?? g.abbreviation ?? g.displayName ?? g.name ?? '', who, value: compact(value) } : null; }).filter(Boolean);
  for (const c of comp?.competitors ?? []) {
    const k = c.homeAway === 'home' ? 'home' : 'away'; const id = String(c.team?.id ?? c.id ?? '');
    let l = read(c.leaders);
    if (!l.length && id) l = (comp.leaders ?? []).flatMap((g) => (g.leaders ?? []).filter((x) => String(x.team?.id ?? x.athlete?.team?.id ?? '') === id).slice(0, 1).map((x) => ({ stat: g.shortDisplayName ?? g.name ?? '', who: x.athlete?.shortName ?? x.athlete?.displayName ?? '', value: compact(x.displayValue ?? '') }))).filter((x) => x.who && x.value);
    out[k] = l.slice(0, n);
  }
  return out;
}

/**
 * A team's color for the card, dark enough for white text on it: its own, else its other color, else its own
 * darkened.
 */
export function cardColor(t) {
  for (const c of [t.color, t.alt]) if (c && lightness(c) <= 0.5) return c;
  const c = t.color ?? '#3a3f47'; const n = parseInt(c.slice(1), 16); const L = Math.max(0.01, lightness(c)); const k = 0.38 / L;
  const ch = (v) => Math.round(Math.max(0, Math.min(255, v * k))).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

// ---- Nationally televised games (NFL and NBA): on a national network, as primetime is. The NFL's Sunday
// afternoon games on CBS and FOX are regional, so those count only off a Sunday afternoon (Thanksgiving, a
// Saturday, a night game).
const NATIONAL = { nfl: /^(NBC|ESPN|ESPN2|ABC|Prime Video|Amazon|Amazon Prime Video|NFL Network|NFL Net|NFLN|Netflix|Peacock|YouTube|CBS|FOX)$/i, nba: /^(ESPN|ESPN2|ABC|TNT|TBS|truTV|NBA TV|NBATV|NBC|Peacock|Prime Video|Amazon|Amazon Prime Video)$/i };

/** The national network a game is on, from its broadcasts (ESPN's two ways of listing them), or ''. */
export function nationalTv(comp) {
  const names = [];
  for (const g of comp?.geoBroadcasts ?? []) if (/national/i.test(g?.market?.type ?? g?.market ?? '') && g?.media?.shortName) names.push(g.media.shortName);
  for (const b of comp?.broadcasts ?? []) if (/national/i.test(b?.market ?? '')) names.push(...(b.names ?? []));
  return names.find(Boolean) ?? '';
}

/** Whether a game is a nationally televised one (NFL and NBA only): on `tv`, starting at `date`. */
export function isPrimetime(league, tv, date) {
  const re = NATIONAL[league]; if (!re || !tv || !re.test(tv)) return false;
  if (league === 'nfl' && /^(CBS|FOX)$/i.test(tv)) {
    // (Sunday afternoon in New York's time: regional.)
    const d = new Date(date); const ny = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    if (ny.getDay() === 0 && ny.getHours() < 19) return false;
  }
  return true;
}

/** One game as a post: live or over; or, not started, only a nationally televised NFL or NBA game (its preview). */
export function gamePost(ev, league, now = Date.now()) {
  const comp = ev?.competitions?.[0]; if (!comp) return null;
  const st = comp.status?.type ?? ev.status?.type ?? {};
  const state = st.state ?? 'pre';
  const tv = nationalTv(comp); const date = ev.date ?? comp.date; const prime = isPrimetime(league, tv, date);
  // (Not started: a primetime game coming up in the next day and a half.)
  if (state === 'pre' && !(prime && Date.parse(date) - now < 36 * 3600000 && Date.parse(date) - now > -6 * 3600000)) return null;
  const home = side(comp.competitors?.find((c) => c.homeAway === 'home')); const away = side(comp.competitors?.find((c) => c.homeAway === 'away'));
  if (!home || !away) return null;
  if (state === 'pre') return { id: `${league}:${ev.id}`, league, date, state: 'pre', detail: st.shortDetail ?? '', home, away, leaders: [], byTeam: { home: [], away: [] }, headline: '', tv, primetime: true, caption: previewCaption({ home, away, tv, date }, now), venue: comp.venue?.fullName ?? '' };
  const leaders = topLeaders(comp); const byTeam = teamLeaders(comp);
  const head = comp.headlines?.[0]; const headline = head?.shortLinkText ?? head?.description ?? '';
  const done = !!st.completed || state === 'post';
  return {
    id: `${league}:${ev.id}`, league, date: ev.date ?? comp.date, state: done ? 'post' : 'in', detail: st.shortDetail ?? st.detail ?? (done ? 'Final' : ''),
    home, away, leaders, byTeam, headline, tv, primetime: prime, caption: captionOf({ state: done ? 'post' : 'in', home, away, leaders, headline, detail: st.shortDetail ?? '' }), venue: comp.venue?.fullName ?? '',
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
  const tv = top ? compact(top.value) : '';
  return `${w.short} beat ${l.short} ${ws}-${ls}${ot}${top ? `, behind ${top.who}'s ${tv}${/[A-Z]{2,}/.test(tv) ? '' : ` ${top.stat}`}` : ''}.`;
}

/** A primetime game's preview caption: "Tonight: Rams at Packers, 8:20 PM on NBC." */
export function previewCaption(g, now = Date.now()) {
  const d = new Date(g.date); const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = new Date(now); const sameDay = d.toDateString() === day.toDateString(); const tmr = new Date(now + 86400000).toDateString() === d.toDateString();
  const when = sameDay ? (d.getHours() >= 17 ? 'Tonight' : 'Today') : tmr ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'long' });
  return `${when}: ${g.away.short} at ${g.home.short}, ${t}${g.tv ? ` on ${g.tv}` : ''}.`;
}

/** Every post from a scoreboard response. */
export function postsFrom(json, league, now = Date.now()) { return (json?.events ?? []).map((ev) => gamePost(ev, league, now)).filter(Boolean); }

// ---- Each player's stats (offense only), from a game's box score (ESPN's summary for it), for those who did
// enough to count: the minimums are the Owner's, in Sports settings.

/** The minimums to start with: football's passing, rushing and receiving yards; basketball's points and assists. */
export const DEFAULT_MINS = { pass: 100, rush: 25, rec: 25, pts: 10, ast: 5 };
/** Leagues with player stats, and their sport. */
export const STAT_SPORT = { nfl: 'football', ncaaf: 'football', nba: 'basketball' };

/** A game's box score URL (ESPN's summary for it), or null for a league without player stats. */
export function summaryUrl(postId) {
  const [league, id] = String(postId).split(':'); const L = LEAGUES[league];
  return L && STAT_SPORT[league] ? `${ESPN}/${L.sport}/${L.league}/summary?event=${encodeURIComponent(id)}` : null;
}

const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };

/**
 * Each team's players with offensive stats, from a summary response: { [team id]: [{ who, pos, pass?, rush?,
 * rec?, bb? }] }: football's passing { att, yds, td, int }, rushing { car, yds, td }, receiving { rec, yds, td };
 * basketball's { pts, ast, reb, fg, three }. All of them (the minimums are applied when shown: `qualified`).
 */
export function playerRows(json, league) {
  const sport = STAT_SPORT[league]; const out = {}; if (!sport) return out;
  for (const tm of json?.boxscore?.players ?? []) {
    const tid = String(tm.team?.id ?? ''); const rows = new Map();
    const row = (a) => { const who = a.athlete?.shortName ?? a.athlete?.displayName ?? ''; if (!who) return null; if (!rows.has(who)) rows.set(who, { who, pos: a.athlete?.position?.abbreviation ?? '' }); return rows.get(who); };
    for (const g of tm.statistics ?? []) {
      const labels = (g.labels ?? g.names ?? []).map((x) => String(x).toUpperCase());
      const v = (a, lab) => (labels.indexOf(lab) >= 0 ? a.stats?.[labels.indexOf(lab)] : undefined);
      const kind = String(g.name ?? '').toLowerCase();
      for (const a of g.athletes ?? []) {
        if (a.didNotPlay || !a.stats?.length) continue;
        if (sport === 'football') {
          if (kind === 'passing') { const r = row(a); if (r) r.pass = { att: v(a, 'C/ATT') ?? '', yds: num(v(a, 'YDS')), td: num(v(a, 'TD')), int: num(v(a, 'INT')) }; }
          else if (kind === 'rushing') { const r = row(a); if (r) r.rush = { car: num(v(a, 'CAR')), yds: num(v(a, 'YDS')), td: num(v(a, 'TD')) }; }
          else if (kind === 'receiving') { const r = row(a); if (r) r.rec = { rec: num(v(a, 'REC')), yds: num(v(a, 'YDS')), td: num(v(a, 'TD')) }; }
        } else if (labels.includes('PTS')) { const r = row(a); if (r) r.bb = { pts: num(v(a, 'PTS')), ast: num(v(a, 'AST')), reb: num(v(a, 'REB')), fg: v(a, 'FG') ?? '', three: v(a, '3PT') ?? '' }; }
      }
    }
    out[tid] = [...rows.values()];
  }
  return out;
}

/**
 * The players who did enough to show, by the minimums (`mins`, as DEFAULT_MINS): [{ who, pos, line, score }],
 * the best first; a player once, with each of their stats that counts.
 */
export function qualified(rows, mins = DEFAULT_MINS) {
  const m = { ...DEFAULT_MINS, ...(mins ?? {}) };
  return (rows ?? []).map((r) => {
    const parts = []; let score = 0;
    if (r.pass && r.pass.yds >= m.pass) { parts.push(`${r.pass.att ? `${r.pass.att}, ` : ''}${r.pass.yds} pass yds${r.pass.td ? `, ${r.pass.td} TD` : ''}${r.pass.int ? `, ${r.pass.int} INT` : ''}`); score += r.pass.yds; }
    if (r.rush && r.rush.yds >= m.rush) { parts.push(`${r.rush.car} car, ${r.rush.yds} rush yds${r.rush.td ? `, ${r.rush.td} TD` : ''}`); score += r.rush.yds * 1.2; }
    if (r.rec && r.rec.yds >= m.rec) { parts.push(`${r.rec.rec} rec, ${r.rec.yds} rec yds${r.rec.td ? `, ${r.rec.td} TD` : ''}`); score += r.rec.yds * 1.2; }
    if (r.bb && (r.bb.pts >= m.pts || r.bb.ast >= m.ast)) { parts.push(`${r.bb.pts} PTS, ${r.bb.ast} AST, ${r.bb.reb} REB${r.bb.fg ? `, ${r.bb.fg} FG` : ''}${r.bb.three && !/^0-/.test(r.bb.three) ? `, ${r.bb.three} 3PT` : ''}`); score += r.bb.pts + r.bb.ast * 1.5; }
    return parts.length ? { who: r.who, pos: r.pos, line: parts.join(' · '), score } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}

/** Each team's players who did enough (see playerRows and qualified): { [team id]: [{ who, pos, line, score }] }. */
export function playerStats(json, league, mins = DEFAULT_MINS) {
  return Object.fromEntries(Object.entries(playerRows(json, league)).map(([k, rows]) => [k, qualified(rows, mins)]));
}

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
/** The feed's posts in order: live games first, then primetime games coming up (the soonest first), then results, newest first. */
export const feedOrder = (feed) => { const rank = (p) => (p.state === 'in' ? 0 : p.state === 'pre' ? 1 : 2); return Object.values(feed ?? {}).sort((a, b) => rank(a) - rank(b) || (a.state === 'pre' ? Date.parse(a.date) - Date.parse(b.date) : Date.parse(b.date) - Date.parse(a.date))); };

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
