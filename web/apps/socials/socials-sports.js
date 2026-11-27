// Socials' Sports front: what Socials opens to. A feed of posts made from NBA, NFL, MLB, NHL and college
// football games as they happen and end (socials-sports-core.js): each a card in the two teams' colors with
// the score, final or live, the stat leaders and a caption; filtered by league; refreshed by itself (every
// minute while a game is on, else every few minutes) and on ↻, and kept for offline. Its ⚙ settings choose
// the leagues and hold Admin.

import { el, fill, store } from '../../lib/dom.js';
import { SPORTS_LEAGUES, boardUrls, postsFrom, mergeFeed, feedOrder, likesOf, lightness, cardColor, summaryUrl, playerRows, qualified, outPlayers, DEFAULT_MINS, MIN_FIELDS, STAT_SPORT } from './socials-sports-core.js';

const FEED_KEY = 'cc.socials.sports';
const PREFS_KEY = 'cc.socials.sports.prefs';
const LIKES_KEY = 'cc.socials.sports.likes';
const BOX_KEY = 'cc.socials.sports.box';

const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
const countLabel = (n) => (n >= 10000 ? `${(n / 1000).toFixed(0)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

/** The Sports front in `host`; `onAdmin()` when Admin is chosen. Returns its cleanup. */
export function sportsFront(host, { onAdmin }) {
  const kept = store.json(FEED_KEY, null) ?? { at: 0, feed: {} };
  let feed = kept.feed ?? {}; let at = kept.at ?? 0;
  const prefs = { league: 'all', off: [], ...store.json(PREFS_KEY, {}) }; prefs.mins = { ...DEFAULT_MINS, ...(prefs.mins ?? {}) };
  // (Each game's players' stats, read from its box score when its post comes into view: { id: { at, done, rows } }.)
  const boxes = store.json(BOX_KEY, {}) ?? {}; const loading = new Set();
  const keepBoxes = () => { const ids = Object.keys(boxes).sort((a, b) => boxes[b].at - boxes[a].at); for (const k of ids.slice(150)) delete boxes[k]; try { store.set(BOX_KEY, JSON.stringify(boxes)); } catch { /* full */ } };
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
  function teamRow(t, other, done, pre = false) {
    const lose = done && Number(t.score) < Number(other.score);
    return el('div', { class: `sp-team${lose ? ' sp-lose' : ''}` },
      badge(t, true),
      el('span', { class: 'sp-team-name' }, el('strong', { text: `${t.rank ? `${t.rank} ` : ''}${t.short}` }), t.record ? el('span', { class: 'sp-rec', text: t.record }) : null),
      pre ? null : el('span', { class: 'sp-score', text: t.score ?? '0' }));
  }

  /** A game's players' stats (offense only, those over the minimums), each team's; loaded as its post comes into view. */
  // (Who's OUT for a team (its injury report), as a note.)
  const outNote = (b, t) => { const o = b?.out?.[t.id] ?? []; return o.length ? el('p', { class: 'small sp-out', 'aria-label': `${t.short}: out` }, el('strong', { text: '🚫 OUT: ' }), o.map((x) => `${x.who}${x.pos ? ` (${x.pos})` : ''}`).join(', ')) : null; };
  function playersBox(p) {
    if (!STAT_SPORT[p.league]) return null;
    const b = boxes[p.id];
    // (Not started: only who's out.)
    if (p.state === 'pre') {
      const notes = b ? [p.away, p.home].map((t) => { const n = outNote(b, t); return n ? el('div', { class: 'sp-out-team' }, el('div', { class: 'sp-lhead' }, badge(t), el('strong', { text: t.short })), n) : null; }).filter(Boolean) : [];
      return notes.length ? el('div', { class: 'sp-players sp-out-box' }, el('strong', { class: 'sp-out-h', text: 'Injury report' }), ...notes) : null;
    }
    const body = !b ? el('p', { class: 'small muted sp-pl-wait', text: loading.has(p.id) ? 'Loading player stats…' : 'Player stats load when you scroll to it.' })
      : el('div', { class: 'sp-pl-teams' }, [p.away, p.home].map((t) => {
        const list = qualified(b.rows?.[t.id] ?? [], prefs.mins);
        return el('div', { class: 'sp-pl-team', 'aria-label': `${t.short} player stats` }, el('div', { class: 'sp-lhead' }, badge(t), el('strong', { text: t.short })),
          list.length ? el('ul', { class: 'sp-pl-rows' }, list.map((x) => el('li', {}, el('strong', { class: 'sp-pl-who', text: `${x.who}${x.pos ? ` ${x.pos}` : ''}` }), el('span', { class: 'sp-pl-line', text: x.line })))) : el('p', { class: 'small muted', text: 'No one over the minimums yet.' }),
          outNote(b, t));
      }));
    return el('details', { class: 'sp-players', open: true }, el('summary', {}, el('strong', { text: 'Player stats' }), el('span', { class: 'small muted', text: ' · offense' })), body);
  }
  async function loadBox(id) {
    const p = feed[id]; const u = summaryUrl(id); if (!p || !u || loading.has(id)) return;
    const b = boxes[id]; if (b && (b.done || Date.now() - b.at < 90000)) return;
    loading.add(id);
    try { const res = await fetch(u, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }); if (res.ok) { const j = await res.json(); boxes[id] = { at: Date.now(), done: p.state === 'post', rows: playerRows(j, p.league), out: outPlayers(j) }; keepBoxes(); } } catch { /* next time */ }
    loading.delete(id); if (alive) redrawPost(id);
  }
  const seen = 'IntersectionObserver' in globalThis ? new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) loadBox(e.target.dataset.id); }, { rootMargin: '200px' }) : null;
  function redrawPost(id) { const old = list.querySelector(`[data-id="${CSS.escape(id)}"]`); const p = feed[id]; if (old && p) { const n = post(p); old.replaceWith(n); seen?.observe(n); } }
  function post(p) {
    const [, label, emoji] = SPORTS_LEAGUES.find(([id]) => id === p.league) ?? ['', p.league.toUpperCase(), '🏟️'];
    const done = p.state === 'post'; const pre = p.state === 'pre'; const liked = likes.has(p.id);
    const when = pre ? new Date(p.date).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    const card = el('div', { class: `sp-card${pre ? ' sp-pre' : ''}`, role: 'img', 'aria-label': pre ? `${p.away.name} at ${p.home.name}, ${when}${p.tv ? ` on ${p.tv}` : ''}` : `${p.away.name} ${p.away.score}, ${p.home.name} ${p.home.score}, ${p.detail}`, style: { background: `linear-gradient(118deg, ${cardColor(p.away)} 0%, ${cardColor(p.away)} 47%, ${cardColor(p.home)} 53%, ${cardColor(p.home)} 100%)` } },
      el('div', { class: 'sp-card-in' },
        el('div', { class: 'sp-state-row' }, el('span', { class: `sp-state${done || pre ? '' : ' sp-live'}`, text: pre ? `📺 PRIMETIME · ${when.toUpperCase()}` : done ? (p.detail || 'Final').toUpperCase() : `● LIVE · ${p.detail}` }), p.tv && p.primetime ? el('span', { class: 'sp-tv', text: p.tv }) : null),
        teamRow(p.away, p.home, done, pre), pre ? el('div', { class: 'sp-at', text: '@' }) : null, teamRow(p.home, p.away, done, pre),
        p.venue ? el('div', { class: 'sp-venue', text: p.venue }) : null));
    // (Each team's leaders, side by side; else the game's.)
    const side = (t, l) => el('div', { class: 'sp-lteam', 'aria-label': `${t.short} leaders` }, el('div', { class: 'sp-lhead' }, badge(t), el('strong', { text: t.short })),
      el('ul', { class: 'sp-lrows' }, l.length ? l.map((x) => el('li', {}, el('span', { class: 'sp-lstat', text: x.stat }), el('span', { class: 'sp-lwho', text: x.who }), el('strong', { class: 'sp-lval', text: x.value }))) : el('li', { class: 'muted small', text: 'No leaders yet' })));
    const bt = p.byTeam ?? { home: [], away: [] };
    const leaders = bt.home.length || bt.away.length ? el('div', { class: 'sp-leaders2', 'aria-label': 'Stat leaders' }, side(p.away, bt.away), side(p.home, bt.home))
      : p.leaders.length ? el('ul', { class: 'sp-leaders', 'aria-label': 'Stat leaders' }, p.leaders.map((l) => {
        const team = [p.home, p.away].find((t) => t.abbr === l.team);
        return el('li', {}, el('span', { class: 'sp-lstat', text: l.stat }), team ? badge(team) : el('span', {}), el('span', { class: 'sp-lwho', text: l.who }), el('strong', { class: 'sp-lval', text: l.value }));
      })) : null;
    const n = likesOf(p.id, p.league === 'nfl') + (liked ? 1 : 0);
    const heart = el('button', { type: 'button', class: `sp-act${liked ? ' on' : ''}`, 'aria-pressed': String(liked), 'aria-label': liked ? 'Unlike' : 'Like', text: liked ? '♥' : '♡', onclick: () => { if (likes.has(p.id)) likes.delete(p.id); else likes.add(p.id); store.set(LIKES_KEY, JSON.stringify([...likes].slice(-500))); draw(); } });
    return el('article', { class: 'sp-post', 'data-id': p.id },
      el('header', { class: 'sp-head' }, el('span', { class: `sp-av sp-av-${p.league}`, 'aria-hidden': 'true', text: emoji }), el('strong', { text: label }), el('span', { class: 'sp-verified', 'aria-label': 'Verified', text: '✓' }), el('span', { class: 'muted small', text: ` · ${p.state === 'pre' ? 'upcoming' : ago(Date.parse(p.date))}` })),
      card, pre ? null : leaders, playersBox(p),
      el('div', { class: 'sp-actions' }, heart, el('span', { class: 'sp-likes', text: `${countLabel(n)} likes` })),
      el('p', { class: 'sp-caption' }, el('strong', { text: label }), ' ', p.caption));
  }

  function drawStatus() { status.textContent = busy ? 'Updating scores…' : note || (at ? (ago(at) === 'now' ? 'Updated just now' : `Updated ${ago(at)} ago`) : ''); }
  function draw() {
    fill(bar, el('span', { class: 'sp-logo', text: 'Socials' }),
      el('div', { class: 'sp-top-acts' },
        el('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Refresh', text: '↻', onclick: refresh }),
        el('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Settings', text: '⚙', onclick: openSheet })));
    const anyPrime = Object.values(feed).some((p) => p.primetime && !prefs.off.includes(p.league));
    fill(chips, [['all', 'All', '🔥'], ...(anyPrime ? [['prime', 'Primetime', '📺']] : []), ...leagues()].map(([id, label, emoji]) => el('button', { type: 'button', role: 'tab', class: `sp-chip${prefs.league === id ? ' on' : ''}`, 'aria-selected': String(prefs.league === id), text: `${emoji} ${label}`, onclick: () => { prefs.league = id; keepPrefs(); draw(); } })));
    if (prefs.league !== 'all' && prefs.league !== 'prime' && prefs.off.includes(prefs.league)) prefs.league = 'all';
    const posts = feedOrder(feed).filter((p) => (prefs.league === 'all' ? !prefs.off.includes(p.league) : prefs.league === 'prime' ? p.primetime && !prefs.off.includes(p.league) : p.league === prefs.league));
    seen?.disconnect();
    fill(list, posts.length ? posts.map(post) : el('div', { class: 'sp-empty' }, el('p', { class: 'sp-empty-big', text: busy ? 'Loading the latest games…' : 'No games right now' }), el('p', { class: 'muted', text: busy ? '' : 'Results post here as games finish (live ones as they\'re played).' })));
    for (const a of list.querySelectorAll('.sp-post[data-id]')) seen?.observe(a);
    drawStatus();
  }

  function openSheet() {
    const toggles = SPORTS_LEAGUES.map(([id, label, emoji]) => {
      const on = !prefs.off.includes(id);
      return el('button', { type: 'button', role: 'switch', class: `sp-toggle${on ? ' on' : ''}`, 'aria-checked': String(on), onclick: () => { if (on) prefs.off = [...prefs.off, id]; else prefs.off = prefs.off.filter((x) => x !== id); keepPrefs(); openSheet(); draw(); if (!on) refresh(); } }, el('span', { text: `${emoji} ${label}` }), el('span', { class: 'sp-switch', 'aria-hidden': 'true' }));
    });
    fill(sheet, el('div', { class: 'sp-sheet-card' },
      el('div', { class: 'sp-sheet-head' }, el('strong', { text: 'Settings' }), el('button', { type: 'button', class: 'sp-icon', 'aria-label': 'Close', text: '✕', onclick: () => { sheet.hidden = true; } })),
      el('button', { type: 'button', class: 'btn block sp-admin sp-admin-top', text: '🔐 Admin', onclick: () => { sheet.hidden = true; onAdmin(); } }),
      el('h3', { class: 'sp-sheet-h', text: 'Leagues in your feed' }), el('div', { class: 'sp-toggles' }, toggles),
      el('h3', { class: 'sp-sheet-h', text: 'Player stats: the least to show' }),
      el('p', { class: 'small muted', text: 'Offense only. A player shows in a game\'s post once they reach any of these.' }),
      el('div', { class: 'sp-mins' }, MIN_FIELDS.map(([k, label]) => {
        const inp = el('input', { type: 'number', min: '0', max: '999', inputmode: 'numeric', class: 'sp-min-input', value: String(prefs.mins[k]), 'aria-label': `Least ${label.replace(/^\S+ /, '').toLowerCase()} to show` });
        inp.addEventListener('change', () => { const v = Math.max(0, Math.min(999, Math.round(Number(inp.value) || 0))); inp.value = String(v); prefs.mins = { ...prefs.mins, [k]: v }; keepPrefs(); draw(); });
        return el('label', { class: 'sp-min' }, el('span', { text: label }), inp);
      }), el('button', { type: 'button', class: 'sp-link', text: `Reset to ${Object.values(DEFAULT_MINS).join(' / ')}`, onclick: () => { prefs.mins = { ...DEFAULT_MINS }; keepPrefs(); openSheet(); draw(); } })),
      el('button', { type: 'button', class: 'btn block', text: '↻ Refresh scores', onclick: () => { sheet.hidden = true; refresh(); } }),
      el('p', { class: 'small muted', text: 'Scores and stats from ESPN, updated by themselves while Socials is open.' })));
    sheet.hidden = false;
  }

  draw();
  refresh();
  return () => { alive = false; clearTimeout(timer); seen?.disconnect(); root.remove(); };
}
