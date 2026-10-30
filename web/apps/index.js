// Apps on the home screen. Jobs is built into the shell; other apps load on first open. Files, Draw and
// QR run entirely on this phone and work offline (Files' Saved Files is the one part that goes online,
// to your own Google Drive). Games is Fox Games, a self-contained page of its own (web/apps/games/fox/).
export const APPS = [
  { id: 'files', name: 'Files', icon: '🗂️', tint: 'blue', note: 'Photos · PDF · Scan · Saved Files', href: '#/files', load: () => import('../tools/studio/studio.js') },
  { id: 'draw', name: 'Draw', icon: '✏️', tint: 'pink', note: 'Sketch and design', href: '#/draw', load: () => import('../tools/draw/draw.js') },
  { id: 'qr', name: 'QR', icon: '▦', tint: 'ink', note: 'Scan · Make codes', href: '#/qr', load: () => import('../tools/qr/qr.js') },
  { id: 'calendar', name: 'Calendar', icon: '📅', tint: 'red', note: 'Your events', href: '#/calendar', load: () => import('./calendar/calendar.js') },
  { id: 'updates', name: 'Updates', icon: '🔔', tint: 'amber', note: 'Weather · Sports', href: '#/updates', load: () => import('./updates/updates.js') },
  { id: 'notes', name: 'Notes', icon: '📝', tint: 'green', note: 'Notes · Grocery list', href: '#/notes', load: () => import('./notes/notes.js') },
  { id: 'games', name: 'Games', icon: '🦊', tint: 'fox', note: 'Fox Games', href: 'apps/games/fox/index.html' },
  { id: 'settings', name: 'Settings', icon: '⚙️', tint: 'gray', note: 'Background color', href: '#/settings', load: () => import('./settings/settings.js') },
  { id: 'jobs', name: 'Jobs', icon: '⏱', tint: 'slate', note: 'Background runs & settings', href: '#/jobs' },
];

/**
 * Old links (bookmarks, autosaved hashes, links in shared notes) to where things are now: the Tools
 * hub became separate apps, the Editor became Files.
 */
export function redirect(hash) {
  if (hash === '#/tools' || hash === '#/tools/') return '#/';
  if (hash === '#/tools/convert') return '#/files/convert';
  let m = /^#\/tools\/editor(\/.*)?$/.exec(hash);
  if (m) return `#/files${m[1] ?? ''}`;
  m = /^#\/tools\/(draw|qr)(\/.*)?$/.exec(hash);
  if (m) return `#/${m[1]}${m[2] ?? ''}`;
  return null;
}
