// Sports for the Updates app and the sports job: team schedules, live scores, results and (when ESPN
// lists them) betting lines, from ESPN's public site API (no key). Read-only public data; nothing here
// logs into or automates any sportsbook. Pure functions: callers fetch, these read the JSON.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';

export const LEAGUES = {
  nfl: { sport: 'football', league: 'nfl', name: 'NFL' },
  nba: { sport: 'basketball', league: 'nba', name: 'NBA' },
  nhl: { sport: 'hockey', league: 'nhl', name: 'NHL' },
  mlb: { sport: 'baseball', league: 'mlb', name: 'MLB' },
  mls: { sport: 'soccer', league: 'usa.1', name: 'MLS' },
  wnba: { sport: 'basketball', league: 'wnba', name: 'WNBA' },
  ncaaf: { sport: 'football', league: 'college-football', name: 'College football' },
  ncaab: { sport: 'basketball', league: 'mens-college-basketball', name: 'College basketball' },
  epl: { sport: 'soccer', league: 'eng.1', name: 'Premier League' },
};

// Denver's teams to start with; the app lets you change them.
export const DEFAULT_TEAMS = [
  { league: 'nfl', team: 'den', name: 'Denver Broncos' },
  { league: 'nba', team: 'den', name: 'Denver Nuggets' },
  { league: 'nhl', team: 'col', name: 'Colorado Avalanche' },
  { league: 'mlb', team: 'col', name: 'Colorado Rockies' },
];

const base = (league) => {
  const L = LEAGUES[league];
  if (!L) throw new Error(`Unknown league "${league}"`);
  return `${ESPN}/${L.sport}/${L.league}`;
};
export const urls = {
  teams: (league) => `${base(league)}/teams`,
  team: (league, team) => `${base(league)}/teams/${encodeURIComponent(team)}`,
  schedule: (league, team) => `${base(league)}/teams/${encodeURIComponent(team)}/schedule`,
  scoreboard: (league) => `${base(league)}/scoreboard`,
};

// ---------- reading ESPN ----------

const scoreOf = (s) => (s == null ? null : typeof s === 'object' ? (s.displayValue ?? (s.value != null ? String(s.value) : null)) : String(s));

function side(c) {
  if (!c) return null;
  const t = c.team ?? {};
  return {
    id: String(t.id ?? c.id ?? ''), abbr: t.abbreviation ?? '', name: t.displayName ?? t.name ?? '', short: t.shortDisplayName ?? t.name ?? t.abbreviation ?? '',
    color: t.color ? `#${t.color}` : null, score: scoreOf(c.score), winner: c.winner === true,
  };
}

/** One game from a schedule or scoreboard event. */
export function parseGame(ev) {
  const comp = ev?.competitions?.[0];
  if (!comp) return null;
  const status = comp.status?.type ?? ev.status?.type ?? {};
  const home = side(comp.competitors?.find((c) => c.homeAway === 'home'));
  const away = side(comp.competitors?.find((c) => c.homeAway === 'away'));
  const odds = comp.odds?.[0];
  const tv = comp.broadcasts?.map((b) => b.media?.shortName ?? b.names?.join('/')).filter(Boolean).join(', ') || comp.geoBroadcasts?.[0]?.media?.shortName || '';
  return {
    id: String(ev.id), date: ev.date ?? comp.date, name: ev.shortName ?? ev.name ?? '',
    state: status.state ?? 'pre', completed: !!status.completed, detail: status.shortDetail ?? status.detail ?? '',
    home, away, venue: comp.venue?.fullName ?? '', tv,
    odds: odds ? { details: odds.details ?? '', overUnder: odds.overUnder ?? null, provider: odds.provider?.name ?? '' } : null,
    link: ev.links?.find((l) => (l.rel ?? []).includes('summary'))?.href ?? ev.links?.[0]?.href ?? null,
  };
}

export function parseSchedule(json) {
  return (json?.events ?? []).map(parseGame).filter(Boolean).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

export function parseTeam(json) {
  const t = json?.team;
  if (!t) return null;
  const total = t.record?.items?.find((i) => i.type === 'total') ?? t.record?.items?.[0];
  return {
    id: String(t.id), abbr: t.abbreviation, name: t.displayName, short: t.shortDisplayName ?? t.name,
    color: t.color ? `#${t.color}` : '#444444', alt: t.alternateColor ? `#${t.alternateColor}` : '#ffffff',
    record: total?.summary ?? '', standing: t.standingSummary ?? '',
    next: (t.nextEvent ?? []).map(parseGame).filter(Boolean),
  };
}

/** The team block of a schedule response (record and standing included; the team endpoint
 * itself can't be read by the browser, it sends no CORS header). */
export function parseScheduleTeam(json) {
  const t = json?.team;
  if (!t) return null;
  return {
    id: String(t.id), abbr: t.abbreviation, name: t.displayName, short: t.shortDisplayName ?? t.name,
    color: t.color ? `#${t.color}` : '#444444', alt: t.alternateColor ? `#${t.alternateColor}` : '#ffffff',
    record: t.recordSummary ?? t.record?.items?.[0]?.summary ?? '', standing: t.standingSummary ?? '',
  };
}

export function parseTeamList(json) {
  return (json?.sports?.[0]?.leagues?.[0]?.teams ?? []).map(({ team: t }) => ({
    id: String(t.id), abbr: t.abbreviation, name: t.displayName, color: t.color ? `#${t.color}` : '#444444',
  })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- wording ----------

/** Which side is "us" in a game, by team id or abbreviation. */
export function perspective(game, team) {
  const t = String(team).toLowerCase();
  const isUs = (s) => s && (s.id === String(team) || s.abbr.toLowerCase() === t);
  if (isUs(game.home)) return { us: game.home, them: game.away, at: 'vs' };
  if (isUs(game.away)) return { us: game.away, them: game.home, at: '@' };
  return { us: game.home, them: game.away, at: 'vs' };
}

/** "W 24–17", "L 98–104", "T 2–2" for a finished game. */
export function result(game, team) {
  const { us, them } = perspective(game, team);
  if (us.score == null || them.score == null) return '';
  const a = parseFloat(us.score); const b = parseFloat(them.score);
  const wl = us.winner ? 'W' : them.winner ? 'L' : a > b ? 'W' : a < b ? 'L' : 'T';
  return `${wl} ${us.score}–${them.score}`;
}

const fmtWhen = (date, now, timeZone) => {
  const d = new Date(date);
  const same = (x, y) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(x) === new Intl.DateTimeFormat('en-CA', { timeZone }).format(y);
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(d);
  if (same(d, new Date(now))) return `Today ${time}`;
  if (same(d, new Date(+new Date(now) + 86_400_000))) return `Tomorrow ${time}`;
  return `${new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(d)}, ${time}`;
};

/** One line about a game from a team's point of view. */
export function gameLine(game, team, now = Date.now(), timeZone = 'America/Denver') {
  const { us, them, at } = perspective(game, team);
  if (game.state === 'in') return `LIVE · ${game.detail} · ${us.abbr} ${us.score ?? 0}–${them.score ?? 0} ${them.abbr}`;
  if (game.state === 'post' || game.completed) return `${result(game, team) || 'Final'} ${at} ${them.short || them.abbr}${/final/i.test(game.detail) && !/^final$/i.test(game.detail) ? ` (${game.detail})` : ''}`;
  if (/postponed|canceled|cancelled|suspended/i.test(game.detail)) return `${game.detail} ${at} ${them.short || them.abbr}`;
  const extra = [game.tv, game.odds?.details].filter(Boolean).join(' · ');
  return `${fmtWhen(game.date, now, timeZone)} ${at} ${them.short || them.abbr}${extra ? ` · ${extra}` : ''}`;
}

/** The live game, else the next one, and the last finished one, for a team schedule. */
export function pickGames(games, now = Date.now()) {
  const live = games.find((g) => g.state === 'in') ?? null;
  const next = games.find((g) => g.state === 'pre' && Date.parse(g.date) >= now - 6 * 3_600_000 && !/postponed|canceled|cancelled/i.test(g.detail)) ?? null;
  const done = games.filter((g) => g.state === 'post' || g.completed);
  return { live, next, last: done[done.length - 1] ?? null };
}

/**
 * Push-worthy events for the sports job: finished games (recent only) and game-day reminders.
 * Keys are stable so each one pushes once.
 */
export function sportsEvents({ league, team, teamName, games, now, timeZone = 'America/Denver', finalWithinHours = 36, gameDayHours = 12, finals = true, gameDay = true }) {
  const out = [];
  for (const g of games) {
    const start = Date.parse(g.date);
    const { us, them, at } = perspective(g, team);
    const name = teamName || us.name;
    if (finals && (g.state === 'post' || g.completed) && start >= now - finalWithinHours * 3_600_000 && start <= now) {
      const res = result(g, team);
      out.push({
        key: `final:${league}:${g.id}`, kind: 'final',
        title: `${name}: ${res || 'Final'} ${at} ${them.name || them.abbr}`,
        detail: [g.detail && !/^final$/i.test(g.detail) ? g.detail : '', g.venue].filter(Boolean).join(' · '),
        start: g.date, url: g.link, result: res.slice(0, 1),
      });
    }
    if (gameDay && g.state === 'pre' && start > now && start - now <= gameDayHours * 3_600_000 && !/postponed|canceled|cancelled/i.test(g.detail)) {
      out.push({
        key: `gameday:${league}:${g.id}`, kind: 'gameday',
        title: `Game day: ${name} ${at} ${them.name || them.abbr}`,
        detail: [fmtWhen(g.date, now, timeZone), g.tv && `TV: ${g.tv}`, g.odds?.details && `Line: ${g.odds.details}${g.odds.overUnder ? `, O/U ${g.odds.overUnder}` : ''}`, g.venue].filter(Boolean).join(' · '),
        start: g.date, url: g.link,
      });
    }
  }
  return out;
}
