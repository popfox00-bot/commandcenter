// A calendar for the apps (personal events in Calendar, games in Updates → Sports): day, week and
// month views with today highlighted. Days are keys in the phone's own time zone ("2026-10-30").
// The date math is pure (tested in Node); calendarView() builds the DOM.

import { el } from './dom.js';

export const VIEWS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];

/** Where each agenda list was scrolled to (by its label), kept across redraws of the same days. */
const agendaScroll = new Map();
const pad = (n) => String(n).padStart(2, '0');
/** The day key of a Date (or anything Date accepts) in the phone's time zone. */
export const dayKey = (d = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
/** Local midnight of a day key. */
export const parseDay = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (key, n) => { const d = parseDay(key); d.setDate(d.getDate() + n); return dayKey(d); };
/** The same day n months on (the 31st becomes the last day of a shorter month). */
export function addMonths(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const first = new Date(y, m - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return dayKey(new Date(first.getFullYear(), first.getMonth(), Math.min(d, last)));
}
/** The Sunday (weekStart 0) or Monday (1) on or before a day. */
export const startOfWeek = (key, weekStart = 0) => addDays(key, -((parseDay(key).getDay() - weekStart + 7) % 7));
export const isWeekend = (key) => [0, 6].includes(parseDay(key).getDay());

/**
 * The days a view shows around `anchor`: { days: [keys], from, to (exclusive) }. A month is whole
 * weeks from the week of its 1st to the week of its last day (5 or 6 rows, sometimes 4).
 */
export function viewDays(view, anchor, weekStart = 0) {
  let from; let count;
  if (view === 'day') { from = anchor; count = 1; } else if (view === 'week') { from = startOfWeek(anchor, weekStart); count = 7; } else {
    const first = `${anchor.slice(0, 7)}-01`;
    from = startOfWeek(first, weekStart);
    const lastDay = addDays(addMonths(first, 1), -1);
    const end = addDays(startOfWeek(lastDay, weekStart), 7);
    count = Math.round((parseDay(end) - parseDay(from)) / 86_400_000);
  }
  const days = Array.from({ length: count }, (_, i) => addDays(from, i));
  return { days, from, to: addDays(from, count) };
}

/** Move a view one step back (-1) or on (+1). */
export const step = (view, anchor, dir) => (view === 'day' ? addDays(anchor, dir) : view === 'week' ? addDays(anchor, 7 * dir) : addMonths(anchor, dir));

/** The heading for a view: "Friday, Oct 30", "Oct 25 – 31, 2026", "October 2026". */
export function title(view, anchor, weekStart = 0) {
  const d = parseDay(anchor);
  if (view === 'day') return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  if (view === 'month') return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const { days } = viewDays('week', anchor, weekStart);
  const a = parseDay(days[0]); const b = parseDay(days[6]);
  const sameMonth = a.getMonth() === b.getMonth();
  const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const right = b.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${left} – ${right}, ${b.getFullYear()}`;
}

/** Items into a Map of day key → items, by `keyOf(item)`, keeping each day's order. */
export function byDay(items, keyOf) {
  const out = new Map();
  for (const it of items) { const k = keyOf(it); if (!out.has(k)) out.set(k, []); out.get(k).push(it); }
  return out;
}

// ---------- the view ----------

/**
 * A calendar: a bar to switch Day / Week / Month and step back and on (with Today), and the days.
 * state: { view, anchor }; items: Map day key → items; renderItem(item, view) → a node;
 * onChange({ view, anchor }) when the user moves; onAdd(dayKey) shows a "+" on each day (optional);
 * empty: text for a day with nothing on it. agenda: the week as a scrolling list focused on today (or
 * the day stepped to): that day at the top, the week before above it (grayed, fading), the next two
 * weeks below (softer), scrolled to it.
 */
export function calendarView({ state, items, renderItem, onChange, onAdd = null, today = dayKey(), empty = 'Nothing scheduled', weekStart = 0, label = 'Calendar', agenda = false }) {
  const { view, anchor } = state;
  const go = (next) => { agendaScroll.delete(label); onChange({ ...state, ...next }); };
  const bar = el('div', { class: 'cal-bar' },
    el('div', { class: 'segmented cal-views', role: 'tablist', 'aria-label': `${label} view` }, ...VIEWS.map(([v, text]) => el('button', {
      type: 'button', class: `seg${v === view ? ' active' : ''}`, role: 'tab', 'aria-selected': String(v === view), text, onclick: () => go({ view: v }),
    }))),
    el('div', { class: 'row cal-nav' },
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous', text: '‹', onclick: () => go({ anchor: step(view, anchor, -1) }) }),
      el('strong', { class: 'cal-title', 'aria-live': 'polite', text: view === 'week' && agenda ? (anchor === today ? 'This week' : `Around ${parseDay(anchor).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`) : title(view, anchor, weekStart) }),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next', text: '›', onclick: () => go({ anchor: step(view, anchor, 1) }) }),
      el('button', { type: 'button', class: 'btn small-btn ghost', text: 'Today', disabled: (view === 'week' && agenda) ? anchor === today : viewDays(view, anchor, weekStart).days.includes(today) && (view !== 'month' || anchor.slice(0, 7) === today.slice(0, 7)), onclick: () => go({ anchor: today }) })));

  const dayLabel = (key, opts) => parseDay(key).toLocaleDateString('en-US', opts);
  const add = (key) => (onAdd ? el('button', { type: 'button', class: 'icon-btn cal-add', 'aria-label': `Add on ${dayLabel(key, { weekday: 'long', month: 'short', day: 'numeric' })}`, text: '+', onclick: () => onAdd(key) }) : null);

  let body;
  if (view === 'week' && agenda) {
    // Focused on the anchor day: a week before it, two weeks after, scrolled so it's at the top.
    const focus = anchor;
    const days = Array.from({ length: 21 }, (_, i) => addDays(focus, i - 7));
    const sections = days.map((key) => {
      const list = items.get(key) ?? [];
      const ago = Math.round((parseDay(focus) - parseDay(key)) / 86_400_000);
      const none = !list.length && empty ? el('span', { class: 'cal-empty muted small', text: empty }) : null;
      const when = key === focus ? 'cal-focus' : ago > 0 ? `cal-past cal-past-${Math.min(4, Math.ceil(ago / 2))}` : 'cal-future';
      return el('section', { class: `cal-day ${when}${key === today ? ' cal-today' : ''}${isWeekend(key) ? ' cal-weekend' : ''}${list.length ? '' : ' cal-free'}`, 'data-day': key, 'aria-label': `${dayLabel(key, { weekday: 'long', month: 'long', day: 'numeric' })}${key === today ? ', today' : ''}` },
        el('div', { class: 'cal-day-head' },
          el('button', { type: 'button', class: 'cal-day-link', onclick: () => go({ view: 'day', anchor: key }) },
            el('span', { class: 'cal-wd', text: dayLabel(key, { weekday: 'short' }) }), el('span', { class: 'cal-num', text: String(parseDay(key).getDate()) }),
            el('span', { class: 'cal-mon muted small', text: dayLabel(key, { month: 'short' }) }),
            key === today ? el('span', { class: 'cal-today-tag', text: 'Today' }) : null, none),
          add(key)),
        list.length ? el('div', { class: 'cal-items' }, ...list.map((it) => renderItem(it, view))) : null);
    });
    body = el('div', { class: 'cal-list cal-week cal-agenda', role: 'list', 'aria-label': `${label} around ${dayLabel(focus, { month: 'long', day: 'numeric' })}` }, ...sections);
    // Once on screen: the focused day at the top of the list (the days before it above, a scroll away).
    // A redraw of the same days (new scores, stats opened) keeps where the user scrolled to.
    const kept = agendaScroll.get(label);
    let auto = null; let moved = false;
    const settle = () => {
      if (moved || !body.isConnected || !body.clientHeight) return;
      if (kept?.anchor === focus) body.scrollTop = kept.top;
      else { const f = body.querySelector('.cal-focus'); if (f) body.scrollTop += f.getBoundingClientRect().top - body.getBoundingClientRect().top - 2; }
      auto = body.scrollTop;
    };
    // Settled once it's on screen with a size (drawn in a hidden tab, that's when the tab opens), and
    // again as it lays out, until the user scrolls it.
    requestAnimationFrame(() => { settle(); requestAnimationFrame(settle); });
    for (const ms of [0, 150, 500]) setTimeout(settle, ms);
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => { if (moved || !body.isConnected && auto != null) ro.disconnect(); else settle(); });
      ro.observe(body);
    }
    // Only the user's own scrolling counts (a touch, the wheel, a key), not the page laying out.
    let touched = false;
    for (const type of ['pointerdown', 'touchstart', 'wheel', 'keydown']) body.addEventListener(type, () => { touched = true; }, { passive: true });
    body.addEventListener('scroll', () => {
      if (!touched || auto == null || !body.clientHeight || Math.abs(body.scrollTop - auto) <= 4) return;
      moved = true; agendaScroll.set(label, { anchor: focus, top: body.scrollTop });
    }, { passive: true });
    return el('div', { class: 'cal' }, bar, body);
  }
  if (view === 'month') {
    const { days } = viewDays('month', anchor, weekStart);
    const month = anchor.slice(0, 7);
    const heads = Array.from({ length: 7 }, (_, i) => el('span', { class: 'cal-wd', text: dayLabel(days[i], { weekday: 'narrow' }) }));
    body = el('div', { class: 'cal-month', role: 'grid', 'aria-label': title('month', anchor) }, ...heads, ...days.map((key) => {
      const list = items.get(key) ?? [];
      return el('button', {
        type: 'button', role: 'gridcell',
        class: `cal-cell${key === today ? ' cal-today' : ''}${key.slice(0, 7) !== month ? ' cal-out' : ''}${list.length ? ' cal-busy' : ''}`,
        'aria-label': `${dayLabel(key, { weekday: 'long', month: 'long', day: 'numeric' })}${key === today ? ', today' : ''}${list.length ? `, ${list.length} item${list.length === 1 ? '' : 's'}` : ''}`,
        onclick: () => go({ view: 'day', anchor: key }),
      }, el('span', { class: 'cal-num', text: String(parseDay(key).getDate()) }),
      ...list.slice(0, 3).map((it) => renderItem(it, 'month')),
      list.length > 3 ? el('span', { class: 'cal-more', text: `+${list.length - 3}` }) : null);
    }));
  } else {
    const { days } = viewDays(view, anchor, weekStart);
    body = el('div', { class: `cal-list cal-${view}` }, ...days.map((key) => {
      const list = items.get(key) ?? [];
      // A day with nothing on it in the week is one short line, so the whole week fits on a phone.
      const none = !list.length && empty ? el('span', { class: 'cal-empty muted small', text: empty }) : null;
      return el('section', { class: `cal-day${key === today ? ' cal-today' : ''}${isWeekend(key) ? ' cal-weekend' : ''}${list.length ? '' : ' cal-free'}`, 'aria-label': `${dayLabel(key, { weekday: 'long', month: 'long', day: 'numeric' })}${key === today ? ', today' : ''}` },
        el('div', { class: 'cal-day-head' },
          view === 'week'
            ? el('button', { type: 'button', class: 'cal-day-link', onclick: () => go({ view: 'day', anchor: key }) },
              el('span', { class: 'cal-wd', text: dayLabel(key, { weekday: 'short' }) }), el('span', { class: 'cal-num', text: String(parseDay(key).getDate()) }), key === today ? el('span', { class: 'cal-today-tag', text: 'Today' }) : null, none)
            : el('span', { class: 'cal-day-link' }, key === today ? el('span', { class: 'cal-today-tag', text: 'Today' }) : null, none),
          add(key)),
        list.length ? el('div', { class: 'cal-items' }, ...list.map((it) => renderItem(it, view))) : null);
    }));
  }
  return el('div', { class: 'cal' }, bar, body);
}
