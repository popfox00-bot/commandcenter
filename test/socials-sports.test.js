// Socials' Sports front: games into posts (final and live), stat leaders, captions, the feed kept and updated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gamePost, postsFrom, topLeaders, captionOf, mergeFeed, feedOrder, boardUrls, likesOf } from '../web/apps/socials/socials-sports-core.js';

const team = (abbr, name, short, color, alt) => ({ abbreviation: abbr, displayName: name, shortDisplayName: short, color, alternateColor: alt });
const L = (name, short, who, v) => ({ name, shortDisplayName: short, leaders: [{ displayValue: v, athlete: { shortName: who } }] });
const ev = (id, state, detail, hs, as, extra = {}) => ({ id, date: extra.date ?? '2026-11-24T02:00Z', competitions: [{ status: { type: { state, completed: state === 'post', shortDetail: detail } }, headlines: extra.headline ? [{ shortLinkText: extra.headline }] : [], leaders: extra.leaders ?? [], competitors: [
  { homeAway: 'home', team: team('DEN', 'Denver Nuggets', 'Nuggets', '0e2240', 'fec524'), score: hs, records: [{ summary: '12-5' }], leaders: extra.hl ?? [] },
  { homeAway: 'away', team: team('LAL', 'Los Angeles Lakers', 'Lakers', '552583', 'fdb927'), score: as, records: [{ summary: '10-7' }], leaders: extra.al ?? [] }] }] });

test('a final: score, team colors, the best of each stat across both teams, a written caption', () => {
  const p = gamePost(ev('1', 'post', 'Final', '118', '109', { hl: [L('points', 'PTS', 'N. Jokic', '34'), L('rebounds', 'REB', 'N. Jokic', '15')], al: [L('points', 'PTS', 'L. James', '28'), L('rebounds', 'REB', 'A. Davis', '17')] }), 'nba');
  assert.equal(p.id, 'nba:1'); assert.equal(p.state, 'post');
  assert.equal(p.home.color, '#0e2240'); assert.equal(p.away.alt, '#fdb927'); assert.equal(p.home.record, '12-5');
  assert.deepEqual(p.leaders.map((l) => `${l.stat} ${l.who} ${l.value} ${l.team}`), ['PTS N. Jokic 34 DEN', 'REB A. Davis 17 LAL']);
  assert.equal(p.caption, 'Nuggets beat Lakers 118-109, behind N. Jokic\'s 34 PTS.');
});

test('the recap headline when there is one; overtime noted; live games; games not started left out', () => {
  assert.equal(gamePost(ev('2', 'post', 'Final', '100', '90', { headline: 'Jokic dominates again' }), 'nba').caption, 'Jokic dominates again');
  assert.match(gamePost(ev('3', 'post', 'Final/OT', '101', '103'), 'nba').caption, /^Lakers beat Nuggets 103-101 \(OT\)\.$/);
  const live = gamePost(ev('4', 'in', '3rd 4:12', '78', '71'), 'nba');
  assert.equal(live.state, 'in'); assert.match(live.caption, /Lakers 71, Nuggets 78 · 3rd 4:12/);
  assert.equal(gamePost(ev('5', 'pre', '7:00 PM', null, null), 'nba'), null);
  assert.equal(postsFrom({ events: [ev('4', 'in', 'Q1', '2', '0'), ev('5', 'pre', '', null, null)] }, 'nba').length, 1);
  // Football's yards: the bigger yardage leads.
  assert.equal(topLeaders({ leaders: [L('passingYards', 'PASS', 'B. Nix', '24/31, 302 YDS, 3 TD')], competitors: [{ team: { abbreviation: 'KC' }, leaders: [L('passingYards', 'PASS', 'P. Mahomes', '19/30, 250 YDS')] }] })[0].who, 'B. Nix');
});

test('the feed: a live game\'s post replaced by its final, old games let go, live ones first', () => {
  const now = Date.parse('2026-11-24T06:00Z');
  let feed = mergeFeed({}, [gamePost(ev('4', 'in', 'Q3', '78', '71', { date: '2026-11-24T03:00Z' }), 'nba')], now);
  feed = mergeFeed(feed, [gamePost(ev('4', 'post', 'Final', '112', '104', { date: '2026-11-24T03:00Z' }), 'nba'), gamePost(ev('9', 'in', 'Q1', '5', '2', { date: '2026-11-24T05:00Z' }), 'nba')], now);
  assert.equal(feed['nba:4'].state, 'post'); assert.equal(feed['nba:4'].home.score, '112');
  assert.deepEqual(feedOrder(feed).map((p) => p.id), ['nba:9', 'nba:4']);
  assert.deepEqual(Object.keys(mergeFeed(feed, [], now + 6 * 86400000)), [], 'over 4 days: let go');
  assert.equal(boardUrls('nba', new Date(2026, 10, 24)).length, 2, 'yesterday and today');
  assert.match(boardUrls('nba', new Date(2026, 10, 24))[1], /dates=20261124/);
  assert.equal(boardUrls('nfl').length, 1);
  assert.equal(likesOf('nba:1'), likesOf('nba:1'), 'the same each time');
});

test('each team\'s own leaders; football lines made short; a card color dark enough for white text', async () => {
  const { teamLeaders, compact, cardColor, lightness } = await import('../web/apps/socials/socials-sports-core.js');
  const comp = { competitors: [
    { homeAway: 'home', team: { id: '1' }, leaders: [L('points', 'PTS', 'N. Jokic', '34'), L('rebounds', 'REB', 'N. Jokic', '15')] },
    { homeAway: 'away', team: { id: '2' }, leaders: [L('points', 'PTS', 'L. James', '28')] }] };
  const t = teamLeaders(comp);
  assert.deepEqual(t.home.map((x) => `${x.stat} ${x.who} ${x.value}`), ['PTS N. Jokic 34', 'REB N. Jokic 15']);
  assert.deepEqual(t.away.map((x) => x.who), ['L. James']);
  // (Football: the game's leaders that name each team.)
  const fb = teamLeaders({ leaders: [{ name: 'passingYards', shortDisplayName: 'PASS', leaders: [{ displayValue: '24/31, 302 YDS, 3 TD', athlete: { shortName: 'B. Nix' }, team: { id: '7' } }] }], competitors: [{ homeAway: 'home', team: { id: '7' } }, { homeAway: 'away', team: { id: '12' } }] });
  assert.deepEqual(fb.home, [{ stat: 'PASS', who: 'B. Nix', value: '302 YDS, 3 TD' }]); assert.deepEqual(fb.away, []);
  assert.equal(compact('18 CAR, 96 YDS'), '96 YDS');
  assert.equal(cardColor({ color: '#0e2240', alt: '#fec524' }), '#0e2240', 'dark: its own');
  assert.equal(cardColor({ color: '#ffffff', alt: '#002244' }), '#002244', 'white: its other color');
  assert.ok(lightness(cardColor({ color: '#f2f2f2', alt: '#ffffff' })) <= 0.45, 'both light: darkened');
});

test('primetime: nationally televised NFL and NBA games coming up are posts (CBS/FOX on a Sunday afternoon are regional); other leagues\' aren\'t', async () => {
  const { gamePost, nationalTv, isPrimetime, feedOrder, mergeFeed, previewCaption } = await import('../web/apps/socials/socials-sports-core.js');
  const now = Date.parse('2026-11-26T18:00:00Z'); // (Thanksgiving)
  const pre = (id, date, broadcasts, league = 'nfl') => gamePost({ id, date, competitions: [{ status: { type: { state: 'pre', shortDetail: '8:20 PM' } }, broadcasts, competitors: [
    { homeAway: 'home', team: { id: '9', abbreviation: 'GB', displayName: 'Green Bay Packers', shortDisplayName: 'Packers', color: '204e32' }, records: [{ summary: '8-3' }] },
    { homeAway: 'away', team: { id: '14', abbreviation: 'LAR', displayName: 'Los Angeles Rams', shortDisplayName: 'Rams', color: '003594' }, records: [{ summary: '7-4' }] }] }] }, league, now);
  const nbc = [{ market: 'national', names: ['NBC'] }];
  const p = pre('401', '2026-11-27T01:20:00Z', nbc);
  assert.equal(p.state, 'pre'); assert.equal(p.primetime, true); assert.equal(p.tv, 'NBC'); assert.equal(p.id, 'nfl:401');
  assert.match(p.caption, /Rams at Packers, .* on NBC\./);
  assert.equal(pre('402', '2026-11-27T01:20:00Z', [{ market: 'home', names: ['KTLA'] }]), null, 'local TV only: not a post until it starts');
  assert.equal(pre('403', '2026-11-30T01:20:00Z', nbc), null, 'days away: not yet');
  assert.equal(pre('404', '2026-11-27T01:20:00Z', nbc, 'nhl'), null, 'NFL and NBA only');
  assert.equal(nationalTv({ geoBroadcasts: [{ market: { type: 'National' }, media: { shortName: 'ESPN' } }] }), 'ESPN');
  // CBS on Sunday at 1 PM in New York: regional; on Thanksgiving: national.
  assert.equal(isPrimetime('nfl', 'CBS', '2026-11-29T18:00:00Z'), false); assert.equal(isPrimetime('nfl', 'CBS', '2026-11-26T17:30:00Z'), true);
  assert.equal(isPrimetime('nba', 'TNT', '2026-11-26T01:00:00Z'), true); assert.equal(isPrimetime('nba', 'Altitude', '2026-11-26T01:00:00Z'), false);
  // In the feed: live first, then the primetime games coming up (soonest first), then results.
  const feed = mergeFeed({}, [p, { ...p, id: 'nfl:405', date: '2026-11-26T21:30:00Z' }, { id: 'nba:1', state: 'post', date: '2026-11-26T03:00:00Z', home: p.home, away: p.away }, { id: 'nba:2', state: 'in', date: '2026-11-26T17:00:00Z', home: p.home, away: p.away }], now);
  assert.deepEqual(feedOrder(feed).map((x) => x.id), ['nba:2', 'nfl:405', 'nfl:401', 'nba:1']);
  assert.match(previewCaption({ home: p.home, away: p.away, tv: 'ESPN', date: '2026-11-27T20:00:00Z' }, now), /^(Tomorrow|Friday|Today|Tonight): Rams at Packers/);
});

test('each team\'s players\' stats, offense only, over the minimums (football yards; basketball points or assists)', async () => {
  const { playerRows, qualified, playerStats, summaryUrl, DEFAULT_MINS } = await import('../web/apps/socials/socials-sports-core.js');
  const A = (who, stats, pos = '') => ({ athlete: { shortName: who, position: { abbreviation: pos } }, stats });
  const football = { boxscore: { players: [{ team: { id: '14' }, statistics: [
    { name: 'passing', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'], athletes: [A('M. Stafford', ['24/33', '287', '8.7', '2', '1', '1-7', '70', '101'], 'QB')] },
    { name: 'rushing', labels: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], athletes: [A('K. Williams', ['18', '96', '5.3', '1', '22'], 'RB'), A('M. Stafford', ['2', '4', '2', '0', '3']), A('B. Corum', ['4', '12', '3', '0', '5'])] },
    { name: 'receiving', labels: ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'], athletes: [A('P. Nacua', ['9', '121', '13.4', '1', '40', '11'], 'WR'), A('D. Adams', ['3', '24', '8', '0', '10', '5']), A('K. Williams', ['3', '31', '10.3', '0', '15', '3'])] },
    { name: 'defensive', labels: ['TOT', 'SOLO', 'SACKS'], athletes: [A('J. Verse', ['5', '4', '2'])] }] }] } };
  const rows = playerRows(football, 'nfl')['14'];
  assert.ok(!rows.some((r) => r.who === 'J. Verse'), 'no defense');
  const q = qualified(rows, DEFAULT_MINS);
  assert.deepEqual(q.map((x) => x.who), ['M. Stafford', 'K. Williams', 'P. Nacua']);
  assert.match(q[0].line, /^24\/33, 287 pass yds, 2 TD, 1 INT$/, 'his 4 rushing yards under the minimum: left out');
  assert.equal(q[1].line, '18 car, 96 rush yds, 1 TD · 3 rec, 31 rec yds', 'a player once, each stat that counts');
  assert.ok(!q.some((x) => x.who === 'D. Adams'), '24 receiving yards: under 25');
  assert.deepEqual(qualified(rows, { rec: 20 }).map((x) => x.who).includes('D. Adams'), true, 'the minimum lowered: in');
  const bb = { boxscore: { players: [{ team: { id: '7' }, statistics: [{ labels: ['MIN', 'FG', '3PT', 'FT', 'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', '+/-', 'PTS'], athletes: [
    A('N. Jokic', ['36', '12-19', '2-4', '6-7', '3', '11', '14', '11', '2', '1', '3', '2', '+9', '32']), A('J. Murray', ['34', '4-12', '1-5', '0-0', '0', '3', '3', '6', '1', '0', '1', '2', '+4', '9']),
    A('C. Braun', ['20', '3-6', '0-1', '1-2', '1', '2', '3', '1', '0', '0', '0', '1', '+2', '7']), { athlete: { shortName: 'DNP Guy' }, didNotPlay: true, stats: [] }] }] }] } };
  const s = playerStats(bb, 'nba');
  assert.deepEqual(s['7'].map((x) => x.who), ['N. Jokic', 'J. Murray'], '9 points but 6 assists: in; 7 points, 1 assist: out');
  assert.equal(s['7'][0].line, '32 PTS, 14 REB, 11 AST, 2 STL, 1 BLK, 12-19 FG, 2-4 3PT');
  // Rebounds, stocks (steals + blocks) and 3-pointers made count too.
  const bb2 = { boxscore: { players: [{ team: { id: '8' }, statistics: [{ labels: ['MIN', 'FG', '3PT', 'FT', 'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', '+/-', 'PTS'], athletes: [
    A('Big Man', ['30', '2-4', '0-0', '0-0', '4', '6', '10', '1', '0', '1', '0', '2', '0', '4']), A('Pest', ['25', '1-3', '0-1', '0-0', '0', '2', '2', '1', '2', '1', '0', '1', '0', '2']), A('Shooter', ['22', '3-6', '3-5', '0-0', '0', '1', '1', '0', '0', '0', '0', '1', '0', '9']), A('Bench', ['8', '1-2', '0-0', '0-0', '0', '1', '1', '1', '0', '0', '0', '0', '0', '2'])] }] }] } };
  assert.deepEqual(playerStats(bb2, 'nba')['8'].map((x) => x.who).sort(), ['Big Man', 'Pest', 'Shooter'], '10 rebounds; 3 stocks; 3 threes: in; the bench player: out');
  assert.deepEqual(playerStats(bb2, 'nba', { reb: 11, stocks: 4, tpm: 4 })['8'], [], 'the minimums raised: out');
  // Who's out, from the injury report.
  const { outPlayers } = await import('../web/apps/socials/socials-sports-core.js');
  const inj = { injuries: [{ team: { id: '7' }, injuries: [{ status: 'Out', athlete: { displayName: 'Aaron Gordon', position: { abbreviation: 'PF' } }, details: { type: 'Hamstring' } }, { status: 'Questionable', athlete: { displayName: 'Jamal Murray' } }] }, { team: { id: '9' }, injuries: [] }] };
  assert.deepEqual(outPlayers(inj), { 7: [{ who: 'Aaron Gordon', pos: 'PF', detail: 'Hamstring' }] }, 'out only, not questionable');
  assert.match(summaryUrl('nfl:401'), /football\/nfl\/summary\?event=401$/); assert.equal(summaryUrl('nhl:5'), null);
});
