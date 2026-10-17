// Sports updates for your teams: a push when a game ends (score and result) and a game-day reminder
// (time, TV, betting line when ESPN lists one). Read-only public data from ESPN's site API; no
// sportsbook is logged into or automated. Shares its rules with the Updates app's Sports tab.
import { z } from 'zod';
import { FetchError, ParseError } from '../core/errors.js';
import * as S from '../../web/apps/updates/sports-core.js';

const LEAGUE = z.enum(Object.keys(S.LEAGUES));
const EMOJI = { nfl: '🏈', ncaaf: '🏈', nba: '🏀', wnba: '🏀', ncaab: '🏀', nhl: '🏒', mlb: '⚾', mls: '⚽', epl: '⚽' };

export default {
  id: 'sports',
  name: 'Sports updates',
  description: 'Final scores and game-day reminders for your teams.',
  schedule: '13 * * * *',
  configSchema: z.object({
    teams: z.array(z.object({ league: LEAGUE, team: z.string().min(1), name: z.string().optional() }).strict()).min(1).default(S.DEFAULT_TEAMS),
    finals: z.boolean().default(true),
    gameDay: z.boolean().default(true),
    /** Remind about games starting within this many hours... */
    gameDayHours: z.number().int().min(1).max(24).default(14),
    /** ...but only between these local hours, so nothing buzzes overnight. */
    quietUntil: z.number().int().min(0).max(23).default(8),
    quietFrom: z.number().int().min(1).max(24).default(22),
  }).strict(),
  ui: { primary: 'recent' },
  formatNotification: (item) => ({
    title: `${EMOJI[item.fields.league] ?? '🏟'} ${item.title}`,
    message: item.fields.detail || item.title,
    url: item.url,
    priority: item.fields.kind === 'final' ? 'default' : 'low',
    tags: [item.fields.kind === 'final' ? (item.fields.result === 'W' ? 'tada' : 'checkered_flag') : 'calendar'],
  }),
  async run(ctx) {
    const s = ctx.settings;
    const now = ctx.now.getTime();
    const hour = +new Intl.DateTimeFormat('en-US', { timeZone: ctx.timezone, hour: 'numeric', hourCycle: 'h23' }).format(ctx.now);
    const awake = hour >= s.quietUntil && hour < s.quietFrom;
    const items = [];
    const failures = [];
    for (const t of s.teams) {
      let games;
      try {
        const json = await ctx.http.json(S.urls.schedule(t.league, t.team));
        if (!Array.isArray(json?.events)) throw new ParseError(`${t.league}/${t.team}: schedule has no events array`);
        games = S.parseSchedule(json);
      } catch (err) {
        ctx.log.warn('team failed', { league: t.league, team: t.team, error: err.message });
        failures.push(err);
        continue;
      }
      const events = S.sportsEvents({ league: t.league, team: t.team, teamName: t.name, games, now, timeZone: ctx.timezone, finals: s.finals, gameDay: s.gameDay && awake, gameDayHours: s.gameDayHours });
      for (const e of events) {
        items.push({ key: e.key, type: e.kind, title: e.title, url: e.url, fields: { league: t.league, team: t.team, kind: e.kind, detail: e.detail, start: e.start, result: e.result ?? null }, timestamp: ctx.now });
      }
      ctx.log.info('team checked', { league: t.league, team: t.team, games: games.length, events: events.length });
    }
    if (failures.length === s.teams.length) throw failures[0] instanceof Error ? failures[0] : new FetchError('every team failed');
    return items;
  },
};
