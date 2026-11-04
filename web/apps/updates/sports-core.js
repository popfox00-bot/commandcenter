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
  /** Every team in a league, from the standings (the /teams list sends no CORS header). */
  teams: (league) => `${base(league).replace('/apis/site/v2/', '/apis/v2/')}/standings`,
  team: (league, team) => `${base(league)}/teams/${encodeURIComponent(team)}`,
  schedule: (league, team) => `${base(league)}/teams/${encodeURIComponent(team)}/schedule`,
  scoreboard: (league) => `${base(league)}/scoreboard`,
  /** One game in full: box score, leaders, the situation, win probability. */
  summary: (league, event) => `${base(league)}/summary?event=${encodeURIComponent(event)}`,
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

/** Teams from a standings response (conferences/divisions nested in `children`) or a /teams list. */
export function parseTeamList(json) {
  const found = new Map();
  const add = (t) => { if (t?.id && !found.has(String(t.id))) found.set(String(t.id), { id: String(t.id), abbr: t.abbreviation ?? '', name: t.displayName ?? t.name ?? '', color: t.color ? `#${t.color}` : '#444444' }); };
  const walk = (node) => {
    for (const e of node?.standings?.entries ?? []) add(e.team);
    for (const c of node?.children ?? []) walk(c);
  };
  walk(json);
  for (const { team } of json?.sports?.[0]?.leagues?.[0]?.teams ?? []) add(team);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- live stats ----------

const num = (v) => (v == null || v === '' ? null : String(v));

/** Top performers from ESPN leader groups ([{ name, shortDisplayName, leaders: [{ displayValue, athlete }] }]). */
function readLeaders(groups, abbr = '') {
  const out = [];
  for (const g of groups ?? []) {
    const top = g.leaders?.[0];
    if (!top) continue;
    const who = top.athlete?.shortName ?? top.athlete?.displayName ?? '';
    const value = top.displayValue ?? (top.value != null ? String(top.value) : '');
    if (!who && !value) continue;
    out.push({ team: abbr, stat: g.shortDisplayName ?? g.abbreviation ?? g.displayName ?? g.name ?? '', who, value });
  }
  return out;
}

/** The situation of a live game: football's down and distance, baseball's count and bases, the last play. */
function readSituation(sit, comp) {
  if (!sit) return null;
  const parts = [];
  if (sit.downDistanceText || sit.shortDownDistanceText) parts.push(sit.downDistanceText ?? sit.shortDownDistanceText);
  if (sit.isRedZone) parts.push('red zone');
  if (sit.balls != null || sit.strikes != null || sit.outs != null) {
    const bases = [sit.onFirst && '1st', sit.onSecond && '2nd', sit.onThird && '3rd'].filter(Boolean);
    parts.push(`${sit.balls ?? 0}-${sit.strikes ?? 0}, ${sit.outs ?? 0} out${sit.outs === 1 ? '' : 's'}${bases.length ? `, on ${bases.join(' & ')}` : ''}`);
  }
  const poss = sit.possession ? comp?.competitors?.find((c) => String(c.team?.id ?? c.id) === String(sit.possession))?.team?.abbreviation : null;
  return { text: parts.join(' · '), possession: poss ?? null, lastPlay: sit.lastPlay?.text ?? null };
}

/**
 * Live stats of the games on a league's scoreboard: id → { game, situation, leaders, teams }, where
 * teams are [{ abbr, stats: [{ label, value }], lines: [period scores] }].
 */
export function parseScoreboard(json) {
  const out = new Map();
  for (const ev of json?.events ?? []) {
    const game = parseGame(ev); if (!game) continue;
    const comp = ev.competitions[0];
    const teams = (comp.competitors ?? []).map((c) => ({
      abbr: c.team?.abbreviation ?? '', home: c.homeAway === 'home',
      stats: (c.statistics ?? []).map((st) => ({ label: st.abbreviation ?? st.label ?? st.name ?? '', value: num(st.displayValue) })).filter((st) => st.label && st.value != null),
      lines: (c.linescores ?? []).map((l) => num(l.displayValue ?? l.value)).filter((v) => v != null),
    }));
    const leaders = [...readLeaders(comp.leaders), ...(comp.competitors ?? []).flatMap((c) => readLeaders(c.leaders, c.team?.abbreviation ?? ''))];
    out.set(game.id, { game, situation: readSituation(comp.situation, comp), leaders, teams, at: Date.now() });
  }
  return out;
}

/**
 * One game's summary (box score): { situation, leaders, teams: [{ abbr, stats }], winProb: { home,
 * away } (percent) or null }. Only what ESPN has for the sport and moment is filled in.
 */
export function parseSummary(json) {
  const comp = json?.header?.competitions?.[0];
  const teams = (json?.boxscore?.teams ?? []).map((t) => ({
    abbr: t.team?.abbreviation ?? '', home: t.homeAway === 'home',
    stats: (t.statistics ?? []).map((st) => ({ label: st.label ?? st.abbreviation ?? st.name ?? '', value: num(st.displayValue) })).filter((st) => st.label && st.value != null),
  }));
  const leaders = (json?.leaders ?? []).flatMap((block) => readLeaders(block.leaders, block.team?.abbreviation ?? ''));
  const wp = json?.winprobability?.at?.(-1);
  const winProb = wp?.homeWinPercentage != null ? { home: Math.round(wp.homeWinPercentage * 100), away: Math.round((1 - wp.homeWinPercentage) * 100) } : null;
  return { situation: readSituation(json?.situation ?? comp?.situation, comp), leaders, teams, winProb, at: Date.now() };
}

/** The few team stats worth a glance, for each sport (the first ones ESPN gives otherwise). */
const KEY_STATS = {
  basketball: ['FG%', 'Field Goal %', '3P%', '3PT', 'REB', 'Rebounds', 'AST', 'Assists', 'TO', 'Turnovers'],
  football: ['Total Yards', 'YDS', 'Passing', 'Rushing', 'Turnovers', 'TO', '3rd down efficiency', 'Possession', 'TOP'],
  hockey: ['Shots', 'SOG', 'Power Play Goals', 'PPG', 'Faceoffs Won', 'FW', 'Hits', 'HT'],
  baseball: ['H', 'Hits', 'E', 'Errors', 'HR', 'Home Runs', 'LOB'],
  soccer: ['Possession', 'POSS', 'Shots', 'SH', 'On Goal', 'ST', 'Corner Kicks', 'CK', 'Fouls', 'FC'],
};
/** Side-by-side team stats [{ label, away, home }], the key ones for the sport first, at most `n`. */
export function statRows(teams, sport, n = 4) {
  const home = teams.find((t) => t.home) ?? teams[1]; const away = teams.find((t) => !t.home) ?? teams[0];
  if (!home || !away) return [];
  const labels = [...new Set([...home.stats, ...away.stats].map((st) => st.label))];
  const want = KEY_STATS[sport] ?? [];
  labels.sort((a, b) => (want.indexOf(a) < 0 ? 99 : want.indexOf(a)) - (want.indexOf(b) < 0 ? 99 : want.indexOf(b)));
  return labels.slice(0, n).map((label) => ({ label, away: away.stats.find((st) => st.label === label)?.value ?? '–', home: home.stats.find((st) => st.label === label)?.value ?? '–' }));
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
