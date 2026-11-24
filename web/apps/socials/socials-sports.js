// Socials' Sports front: what Socials opens to. A feed of posts made from NBA, NFL, MLB, NHL and college
// football games as they happen and end (socials-sports-core.js): each a card in the two teams' colors with
// the score, final or live, the stat leaders and a caption; filtered by league; refreshed by itself (every
// minute while a game is on, else every few minutes) and on ↻, and kept for offline. Its ⚙ settings choose
// the leagues and hold Admin.

import { el, fill, store } from '../../lib/dom.js';
import { SPORTS_LEAGUES, boardUrls, postsFrom, mergeFeed, feedOrder, likesOf, lightness } from './socials-sports-core.js';

const FEED_KEY = 'cc.socials.sports';
const PREFS_KEY = 'cc.socials.sports.prefs';
const LIKES_KEY = 'cc.socials.sports.likes';

const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const countLabel = (n) => (n >= 10000 ? `${(n / 1000).toFixed(0)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

/** The Sports front in `host`; `onAdmin()` when Admin is chosen. Returns its cleanup. */
export function sportsFront(host, { onAdmin }) {
  const kept = store.json(FEED_KEY, null) ?? { at: 0, feed: {} };
  let feed = kept.feed ?? {}; let at = kept.at ?? 0;
  const prefs = { league: 'all', off: [], ...store.json(PREFS_KEY, {}) };
  const likes = new Set(store.json(LIKES_KEY, []));
  let busy = false; let note = ''; let timer = 0; let alive = true;
  const keepPrefs = () => store.set(PREFS_KEY, JSON.stringify(prefs));

  const root = el('div', { class: 'sp' });
  const bar = el('div', { class: 'sp-top' });
  const chips = el('div', { class: 'sp-chips', role: 'tablist', 'aria-label': 'Leagues' });
  const status = el('p', { class: 'sp-status small muted', 'aria-live': 'polite' });
  const list = el('div', { class: 'sp-feed' });
  const sheet = el('div', { class: 'sp-sheet', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' });
  root.append(bar, chips, status, list, sheet);
  host.append(root);

  const leagues = () => SPORTS_LEAGUES.filter(([id]) => !prefs.off.includes(id));

  async function refresh() {
    if (busy) return; busy = true; drawStatus();
    const fresh = []; let ok = 0; let tried = 0;
    await Promise.all(leagues().flatMap(([id]) => boardUrls(id).map(async (u) => {
      tried++;
      try { const res = await fetch(u, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }); if (!res.ok) return; fresh.push(...postsFrom(await res.json(), id)); ok++; } catch { /* that board: next time */ }
    })));
    if (!alive) return;
    busy = false;
    if (ok) { feed = mergeFeed(feed, fresh); at = Date.now(); note = ''; store.set(FEED_KEY, JSON.stringify({ at, feed })); } else note = navigator.onLine === false ? 'Offline: showing the last results loaded.' : tried ? 'Couldn\'t reach the scores: showing the last loaded.' : '';
    draw(); schedule();
  }
  function schedule() {
    clearTimeout(timer);
    const live = Object.values(feed).some((p) => p.state === 'in');
    timer = setTimeout(refresh, live ? 60000 : 5 * 60000);
  }

  function badge(t, big = false) {
    const c = t.color; const fg = lightness(c) > 0.62 ? '#111' : '#fff';
    return el('span', { class: `sp-badge${big ? ' sp-badge-big' : ''}`, 'aria-hidden': 'true', text: t.abbr, style: { background: c, color: fg, borderColor: t.alt } });
  }
  function teamRow(t, other, done) {
    const lose = done && Number(t.score) < Number(other.score);
    return el('div', { class: `sp-team${lose ? ' sp-lose' : ''}` },
      badge(t, true),
      el('span', { class: 'sp-team-name' }, el('strong', { text: `${t.rank ? `${t.rank} ` : ''}${t.short}` }), t.record ? el('span', { class: 'sp-rec', text: t.record }) : null),
      el('span', { class: 'sp-score', text: t.score ?? '0' }));
  }
  function post(p) {
    const [, label, emoji] = SPORTS_LEAGUES.find(([id]) => id === p.league) ?? ['', p.league.toUpperCase(), '🏟️'];
    const done = p.state === 'post'; const liked = likes.has(p.id);
    const card = el('div', { class: 'sp-card', role: 'img', 'aria-label': `${p.away.name} ${p.away.score}, ${p.home.name} ${p.home.score}, ${p.detail}`, style: { background: `linear-gradient(118deg, ${p.away.color} 0%, ${p.away.color} 47%, ${p.home.color} 53%, ${p.home.color} 100%)` } },
      el('div', { class: 'sp-card-in' },
        el('div', { class: `sp-state${done ? '' : ' sp-live'}`, text: done ? (p.detail || 'Final').toUpperCase() : `● LIVE · ${p.detail}` }),
        teamRow(p.away, p.home, done), teamRow(p.home, p.away, done),
        p.venue ? el('div', { class: 'sp-venue', text: p.venue }) : null));
    const leaders = p.leaders.length ? el('ul', { class: 'sp-leaders', 'aria-label': 'Stat leaders' }, p.leaders.map((l) => {
      const team = [p.home, p.away].find((t) => t.abbr === l.team);
      return el('li', {}, el('span', { class: 'sp-lstat', text: l.stat }), team ? badge(team) : el('span', {}), el('span', { class: 'sp-lwho', text: l.who }), el('strong', { class: 'sp-lval', text: l.value }));
    })) : null;
    const n = likesOf(p.id, p.league === 'nfl') + (liked ? 1 : 0);
    const heart = el('button', { type: 'button', class: `sp-act${liked ? ' on' : ''}`, 'aria-pressed': String(liked), 'aria-label': liked ? 'Unlike' : 'Like', text: liked ? '♥' : '♡', onclick: () => { if (likes.has(p.id)) likes.delete(p.id); else likes.add(p.id); store.set(LIKES_KEY, JSON.stringify([...likes].slice(-500))); draw(); } });
    return el('article', { class: 'sp-post', 'data-id': p.id },
      el('header', { class: 'sp-head' }, el('span', { class: `sp-av sp-av-${p.league}`, 'aria-hidden': 'true', text: emoji }), el('strong', { text: label }), el('span', { class: 'sp-verified', 'aria-label': 'Verified', text: '✓' }), el('span', { class: 'muted small', text: ` · ${ago(Date.parse(p.date))}` })),
      card, leaders,
      el('div', { class: 'sp-actions' }, heart, el('span', { class: 'sp-likes', text: `${countLabel(n)} likes` })),
      el('p', { class: 'sp-caption' }, el('strong', { text: label }), ' ', p.caption));
  }

  function drawStatus() { status.textContent = busy ? 'Updating scores…' : note || (at ? (ago(at) === 'now' ? 'Updated just now' : `Updated ${ago(at)} ago`) : ''); }
  function draw() {
    fill(bar, el('span', { class: 'sp-logo', text: 'Socials' }),
      el('div', { class: 'sp-top-acts' },
        el('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Refresh', text: '↻', onclick: refresh }),
        el('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Settings', text: '⚙', onclick: openSheet })));
    fill(chips, [['all', 'All', '🔥'], ...leagues()].map(([id, label, emoji]) => el('button', { type: 'button', role: 'tab', class: `sp-chip${prefs.league === id ? ' on' : ''}`, 'aria-selected': String(prefs.league === id), text: `${emoji} ${label}`, onclick: () => { prefs.league = id; keepPrefs(); draw(); } })));
    if (prefs.league !== 'all' && prefs.off.includes(prefs.league)) prefs.league = 'all';
    const posts = feedOrder(feed).filter((p) => (prefs.league === 'all' ? !prefs.off.includes(p.league) : p.league === prefs.league));
    fill(list, posts.length ? posts.map(post) : el('div', { class: 'sp-empty' }, el('p', { class: 'sp-empty-big', text: busy ? 'Loading the latest games…' : 'No games right now' }), el('p', { class: 'muted', text: busy ? '' : 'Results post here as games finish (live ones as they\'re played).' })));
    drawStatus();
  }

  function openSheet() {
    const toggles = SPORTS_LEAGUES.map(([id, label, emoji]) => {
      const on = !prefs.off.includes(id);
      return el('button', { type: 'button', role: 'switch', class: `sp-toggle${on ? ' on' : ''}`, 'aria-checked': String(on), onclick: () => { if (on) prefs.off = [...prefs.off, id]; else prefs.off = prefs.off.filter((x) => x !== id); keepPrefs(); openSheet(); draw(); if (!on) refresh(); } }, el('span', { text: `${emoji} ${label}` }), el('span', { class: 'sp-switch', 'aria-hidden': 'true' }));
    });
    fill(sheet, el('div', { class: 'sp-sheet-card' },
      el('div', { class: 'sp-sheet-head' }, el('strong', { text: 'Settings' }), el('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Close', text: '✕', onclick: () => { sheet.hidden = true; } })),
      el('h3', { class: 'sp-sheet-h', text: 'Leagues in your feed' }), el('div', { class: 'sp-toggles' }, toggles),
      el('button', { type: 'button', class: 'btn block', text: '↻ Refresh scores', onclick: () => { sheet.hidden = true; refresh(); } }),
      el('p', { class: 'small muted', text: 'Scores and stats from ESPN, updated by themselves while Socials is open.' }),
      el('div', { class: 'sp-sheet-foot' }, el('button', { type: 'button', class: 'sp-admin', text: 'Admin', onclick: () => { sheet.hidden = true; onAdmin(); } }))));
    sheet.hidden = false;
  }

  draw();
  refresh();
  return () => { alive = false; clearTimeout(timer); root.remove(); };
}
