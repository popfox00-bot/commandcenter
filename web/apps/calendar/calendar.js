// Calendar app: your own events, in a week (default), day or month view with today highlighted.
// Events are kept on this phone (IndexedDB) and work offline. Route: #/calendar.

import { el, store } from '../../lib/dom.js';
import { idb } from '../../lib/idb.js';
import { calendarView, viewDays, byDay, dayKey } from '../../lib/calendar.js';
import { COLORS, REPEATS, newEvent, normalizeEvent, occurrences, when } from './calendar-core.js';

const EVENTS_KEY = 'calendar.events';
const VIEW_KEY = 'cc.calendar.view';
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function mount(host) {
  const root = el('div', { class: 'calapp' });
  host.append(root);
  let events = [];
  let state = { view: 'week', ...store.json(VIEW_KEY, {}), anchor: dayKey() };
  if (!['day', 'week', 'month'].includes(state.view)) state.view = 'week';

  const save = async () => idb.set(EVENTS_KEY, events);

  function render() {
    const today = dayKey();
    const { from, to } = viewDays(state.view, state.anchor);
    const items = byDay(occurrences(events, from, to), (o) => o.date);
    const renderItem = ({ event, date }, view) => (view === 'month'
      ? el('span', { class: 'cal-chip', style: { background: event.color }, text: event.title })
      : el('button', { type: 'button', class: 'cal-item', style: { borderLeftColor: event.color }, onclick: () => edit(event, date) },
        el('span', { class: 'cal-time small', text: when(event) }),
        el('span', { class: 'cal-what' }, el('strong', { text: event.title }),
          view === 'day' && event.location ? el('span', { class: 'muted small', text: `📍 ${event.location}` }) : null,
          view === 'day' && event.notes ? el('span', { class: 'muted small cal-notes', text: event.notes }) : null),
        event.repeat !== 'none' ? el('span', { class: 'muted small', 'aria-label': 'Repeats', text: '↻' }) : null));
    root.replaceChildren(
      el('div', { class: 'row space' },
        el('h2', { class: 'calapp-h', text: 'My calendar' }),
        el('button', { class: 'btn primary small-btn', text: '+ Event', onclick: () => edit(null, state.view === 'day' || state.anchor !== today ? state.anchor : today) })),
      calendarView({
        state, items, renderItem, today, label: 'Calendar', empty: '',
        onChange: (next) => { state = next; store.set(VIEW_KEY, JSON.stringify({ view: state.view })); render(); },
        onAdd: (key) => edit(null, key),
      }),
      el('p', { class: 'muted small', text: 'Events are kept on this phone only and work offline.' }));
  }

  function edit(existing, date) {
    const e = existing ? { ...existing } : newEvent({ id: uid(), date });
    const f = (name, attrs = {}) => el('input', { name, ...attrs });
    const titleIn = f('title', { value: e.title, placeholder: 'Title', 'aria-label': 'Title', maxlength: '200', required: true });
    const dateIn = f('date', { type: 'date', value: e.date, 'aria-label': 'Date', required: true });
    const allDay = f('allDay', { type: 'checkbox', 'aria-label': 'All day' }); allDay.checked = e.allDay;
    const start = f('start', { type: 'time', value: e.start || '09:00', 'aria-label': 'Starts' });
    const end = f('end', { type: 'time', value: e.end || '', 'aria-label': 'Ends' });
    const times = el('div', { class: 'row cal-times' }, el('label', { class: 'field' }, 'Starts', start), el('label', { class: 'field' }, 'Ends', end));
    const syncTimes = () => { times.hidden = allDay.checked; };
    allDay.addEventListener('change', syncTimes); syncTimes();
    const repeat = el('select', { name: 'repeat', 'aria-label': 'Repeat' }, ...REPEATS.map(([k, label]) => el('option', { value: k, text: label, selected: k === e.repeat })));
    const until = f('until', { type: 'date', value: e.until, 'aria-label': 'Repeat until' });
    const untilRow = el('label', { class: 'field' }, 'Until (optional)', until);
    const syncRepeat = () => { untilRow.hidden = repeat.value === 'none'; };
    repeat.addEventListener('change', syncRepeat); syncRepeat();
    const location = f('location', { value: e.location, placeholder: 'Location', 'aria-label': 'Location', maxlength: '200' });
    const notes = el('textarea', { name: 'notes', rows: '3', placeholder: 'Notes', 'aria-label': 'Notes' }); notes.value = e.notes;
    let color = e.color;
    const swatches = el('div', { class: 'swatches' });
    const drawSwatches = () => swatches.replaceChildren(...COLORS.map((c) => el('button', { type: 'button', class: `swatch${c === color ? ' active' : ''}`, style: { background: c }, 'aria-label': `Color ${c}`, 'aria-pressed': String(c === color), onclick: () => { color = c; drawSwatches(); } })));
    drawSwatches();
    const error = el('p', { class: 'bad-text small', 'aria-live': 'polite' });

    const form = el('form', { class: 'sheet cal-form', method: 'dialog' },
      el('h2', { text: existing ? 'Edit event' : 'New event' }),
      titleIn,
      el('label', { class: 'field' }, 'Date', dateIn),
      el('label', { class: 'cal-check' }, allDay, 'All day'),
      times,
      el('label', { class: 'field' }, 'Repeat', repeat), untilRow,
      location, notes,
      el('strong', { class: 'small', text: 'Color' }), swatches,
      error,
      el('div', { class: 'row space' },
        existing ? el('button', { type: 'button', class: 'btn danger', text: 'Delete', onclick: async () => {
          if (!confirm(existing.repeat !== 'none' ? `Delete "${existing.title}" and all its repeats?` : `Delete "${existing.title}"?`)) return;
          events = events.filter((x) => x.id !== existing.id); await save(); dlg.close(); render();
        } }) : el('span'),
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onclick: () => dlg.close() }),
          el('button', { type: 'submit', class: 'btn primary', text: 'Save' }))));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const next = normalizeEvent({ ...e, title: titleIn.value, date: dateIn.value, allDay: allDay.checked, start: start.value, end: end.value, repeat: repeat.value, until: until.value, location: location.value, notes: notes.value, color });
      if (!next) { error.textContent = titleIn.value.trim() ? 'Pick a date.' : 'Give the event a title.'; return; }
      events = [...events.filter((x) => x.id !== next.id), next];
      await save();
      dlg.close();
      state = { ...state, anchor: next.date };
      render();
    });
    const dlg = el('dialog', { class: 'ed-dialog' }, form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    if (!existing) titleIn.focus();
  }

  // A new day (the app left open past midnight, or reopened later): today moves.
  let shownDay = dayKey();
  const onVisible = () => { if (document.visibilityState === 'visible' && dayKey() !== shownDay) { if (state.anchor === shownDay) state.anchor = dayKey(); shownDay = dayKey(); render(); } };
  document.addEventListener('visibilitychange', onVisible);

  root.append(el('p', { class: 'muted center', text: 'Loading…' }));
  idb.get(EVENTS_KEY).then((list) => { events = (list ?? []).map(normalizeEvent).filter(Boolean); render(); });
  return () => document.removeEventListener('visibilitychange', onVisible);
}
