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
