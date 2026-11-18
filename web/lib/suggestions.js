// Settings → Suggest Improvements: notes for future updates of the app, written any time (offline too) and
// kept on this phone; when Saved Files is connected and there's a connection, copied to your Google Drive
// as one plain-text file (Command Center/Suggested improvements.md, not encrypted, so it can be read when
// the app is next worked on: see CLAUDE.md), replaced each time with the whole list.

import { store } from './dom.js';

export const KEY = 'cc.suggestions';
export const DRIVE_FOLDER = 'Command Center';
export const DRIVE_FILE = 'Suggested improvements.md';

/** [{ id, text, at (ms), synced (bool) }], oldest first. */
export const list = () => { const v = store.json(KEY, []); return Array.isArray(v) ? v.filter((s) => s && typeof s.text === 'string') : []; };
const save = (v) => store.set(KEY, JSON.stringify(v));

/** One more (trimmed; nothing for an empty note). Returns the list. */
export function add(text, now = Date.now()) {
  const t = String(text ?? '').trim(); if (!t) return list();
  const v = [...list(), { id: `s${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: t, at: now, synced: false }];
  save(v); return v;
}
export function remove(id) { const v = list().filter((s) => s.id !== id); save(v); store.set(DIRTY, '1'); return v; }
const DIRTY = 'cc.suggestions.dirty';
/** Whether Drive's copy is behind (one not copied yet, or one taken off since). */
export const needsSync = () => list().some((s) => !s.synced) || store.get(DIRTY) === '1';

/** The whole list as the Drive file's text: a heading, then a line each (date, then the note). */
export function toMarkdown(items = list(), now = new Date()) {
  const day = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  return [
    '# Command Center: suggested improvements',
    '',
    `Written in the app (Settings → Suggest Improvements); this file is replaced with the whole list each time. Updated ${now.toISOString()}.`,
    '',
    ...(items.length ? items.map((s) => `- [ ] ${day(s.at)} (${s.id}): ${s.text.replace(/\s*\n\s*/g, ' / ')}`) : ['(none)']),
    '',
  ].join('\n');
}

/**
 * The list copied to Drive (`api`: a Saved Files client, plain: not encrypted), all of it marked as copied.
 * Resolves when done; throws when it can't (offline, not connected).
 */
export async function sync(api) {
  const items = list();
  const file = new File([toMarkdown(items)], DRIVE_FILE, { type: 'text/markdown' });
  await api.upload(file, 'Settings', DRIVE_FOLDER);
  const ids = new Set(items.map((s) => s.id));
  save(list().map((s) => (ids.has(s.id) ? { ...s, synced: true } : s)));
  store.set(DIRTY, '');
}
