// Calendar: personal events, kept on this phone. The event model and how repeating events fall on
// days, without any UI (tested in Node).
//   { id, title, date: 'YYYY-MM-DD', allDay, start: 'HH:MM', end: 'HH:MM', location, notes, color,
//     repeat: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly', until: '' | 'YYYY-MM-DD' }

import { parseDay, addDays, dayKey } from '../../lib/calendar.js';

export const COLORS = ['#0a84ff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#ff2d55', '#5ac8fa', '#8e8e93'];
export const REPEATS = [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A new event on `date` (an hour from the next full hour when it's today, else 9 am). */
export function newEvent({ id, date, now = new Date() } = {}) {
  const today = dayKey(now) === date;
  const h = today ? Math.min(22, now.getHours() + 1) : 9;
  const hh = String(h).padStart(2, '0'); const he = String(h + 1).padStart(2, '0');
  return { id, title: '', date, allDay: false, start: `${hh}:00`, end: `${he}:00`, location: '', notes: '', color: COLORS[0], repeat: 'none', until: '' };
}

/** A stored or typed-in event, checked and tidied; null when it can't be an event (no title or date). */
export function normalizeEvent(e) {
  if (!e || typeof e !== 'object' || !DAY.test(e.date ?? '') || !String(e.title ?? '').trim()) return null;
  const allDay = !!e.allDay || !TIME.test(e.start ?? '');
  let end = TIME.test(e.end ?? '') ? e.end : '';
  if (!allDay && end && end <= e.start) end = '';
  return {
    id: String(e.id ?? ''), title: String(e.title).trim().slice(0, 200), date: e.date, allDay,
    start: allDay ? '' : e.start, end: allDay ? '' : end,
    location: String(e.location ?? '').trim().slice(0, 200), notes: String(e.notes ?? '').slice(0, 4000),
    color: COLORS.includes(e.color) ? e.color : COLORS[0],
    repeat: REPEATS.some(([k]) => k === e.repeat) ? e.repeat : 'none',
    until: DAY.test(e.until ?? '') && e.until >= e.date ? e.until : '',
  };
}

/** Whether a (repeating) event falls on day `key`. */
export function occursOn(e, key) {
  if (key < e.date || (e.until && key > e.until)) return false;
  if (key === e.date) return true;
  const a = parseDay(e.date); const b = parseDay(key);
  switch (e.repeat) {
    case 'daily': return true;
    case 'weekly': return a.getDay() === b.getDay();
    // On the same day of the month; a 31st repeats only in months that have one (like most calendars).
    case 'monthly': return a.getDate() === b.getDate();
    case 'yearly': return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
    default: return false;
  }
}

/** Every event on each day from `from` to `to` (exclusive): [{ event, date }], each day's in time order (all-day first). */
export function occurrences(events, from, to) {
  const out = [];
  for (let key = from; key < to; key = addDays(key, 1)) {
    const day = events.filter((e) => occursOn(e, key)).sort(compare);
    for (const event of day) out.push({ event, date: key });
  }
  return out;
}

export const compare = (a, b) => (a.allDay === b.allDay ? (a.start || '').localeCompare(b.start || '') || a.title.localeCompare(b.title) : a.allDay ? -1 : 1);

/** "9:30 AM", from "09:30". */
export function clock(hhmm) {
  if (!TIME.test(hhmm ?? '')) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "All day", "9 AM", "9 AM – 10:30 AM". */
export const when = (e) => (e.allDay ? 'All day' : e.end ? `${clock(e.start)} – ${clock(e.end)}` : clock(e.start));

/** Events from the next `days` days starting `from`, for "Coming up". */
export const upcoming = (events, from, days = 14) => occurrences(events, from, addDays(from, days));
