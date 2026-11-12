// Apps on the home screen (their order can be changed in Settings). Jobs is built into the shell and
// opened from Settings; other apps load on first open. Two apps hold others:
// - Files: Photo Editor (with Collage and Cutout), Convert, PDF and Scan (documents, and QR codes):
//   all on this phone, offline.
// - Magic: Downloads (a video from a link: needs a connection), FM (FaceMask) and Saved Files (your
//   own Google Drive folder).
// Games is Fox Games, a self-contained page of its own (web/apps/games/fox/).
export const APPS = [
  { id: 'calendar', name: 'Calendar', icon: '📅', tint: 'red', note: 'Your events', href: '#/calendar', load: () => import('./calendar/calendar.js') },
  { id: 'weather', name: 'Weather', icon: '⛅', tint: 'amber', note: 'Alerts · Forecast', href: '#/weather', load: () => import('./weather/weather.js') },
  { id: 'sports', name: 'Sports', icon: '🏆', tint: 'green', note: 'Your teams · Live scores', href: '#/sports', load: () => import('./sports/sports.js') },
  { id: 'notes', name: 'Notes', icon: '📝', tint: 'green', note: 'Notes · Grocery list', href: '#/notes', load: () => import('./notes/notes.js') },
  { id: 'files', name: 'Files', icon: '🗂️', tint: 'blue', note: 'Photos · Convert · PDF · Scan', href: '#/files', load: () => import('../tools/studio/studio.js') },
  { id: 'magic', name: 'Magic', icon: '🪄', tint: 'purple', note: 'Downloads · FM · Saved Files', href: '#/magic', load: () => import('./magic/magic.js') },
  { id: 'draw', name: 'Draw', icon: '✏️', tint: 'pink', note: 'Sketch and design', href: '#/draw', load: () => import('../tools/draw/draw.js') },
  { id: 'rap', name: 'Rap', icon: '🎤', tint: 'purple', note: 'Write · Rhymes · Saved Songs', href: '#/rap', load: () => import('./rap/rap.js') },
  { id: 'games', name: 'Games', icon: '🦊', tint: 'fox', note: 'Fox Games', href: 'apps/games/fox/index.html' },
  { id: 'settings', name: 'Settings', icon: '⚙️', tint: 'gray', note: 'Home screen · Colors · Jobs', href: '#/settings', load: () => import('./settings/settings.js') },
  // In Magic (its own apps, opened from it).
  { id: 'downloads', name: 'Downloads', icon: '⬇️', tint: 'blue', note: 'Video links · Queue · History', href: '#/downloads', parent: 'magic', home: false, load: () => import('./downloads/downloads.js') },
  { id: 'fm', name: 'FM', icon: '🎭', tint: 'purple', note: 'FaceMask · Quick Swap · Characters', href: '#/fm', parent: 'magic', home: false, load: () => import('./fm/fm.js') },
  { id: 'saved', name: 'Saved Files', icon: '☁️', tint: 'slate', note: 'Your Google Drive folder', href: '#/saved', parent: 'magic', home: false, load: () => import('./saved/saved-app.js') },
  // Not on the home screen: opened from Settings.
  { id: 'jobs', name: 'Jobs', icon: '⏱', tint: 'slate', note: 'Background runs & settings', href: '#/jobs', home: false },
];

/** Files' own apps (routes #/files/<tab>; each lists the tabs that are part of it). */
export const FILES_APPS = [
  { id: 'photo', name: 'Photo Editor', icon: '🖼️', tint: 'blue', note: 'Edit · Collage · Cutout', tabs: ['photo', 'collage', 'cutout'] },
  { id: 'convert', name: 'Convert', icon: '🔁', tint: 'green', note: 'Photos and PDFs', tabs: ['convert'] },
  { id: 'pdf', name: 'PDF', icon: '📄', tint: 'red', note: 'Write · Sign', tabs: ['pdf'] },
  { id: 'scan', name: 'Scan', icon: '📷', tint: 'ink', note: 'Documents · QR codes', tabs: ['scan', 'qr'] },
];

/** The apps inside an app (Magic's), for its page of them. */
export const childrenOf = (id) => APPS.filter((a) => a.parent === id);

export const HOME_ORDER_KEY = 'cc.home.order';
/** The apps on the home screen, in the order you set in Settings (apps added later go at the end). */
export function homeApps(order = null) {
  const list = APPS.filter((a) => a.home !== false);
  if (!Array.isArray(order)) return list;
  // (Updates became Weather and Sports: they take its place. FM and Downloads went into Magic: it
  // takes the place of the first of them. QR went into Files → Scan.)
  order = order.flatMap((id) => (id === 'updates' ? ['weather', 'sports'] : id === 'fm' || id === 'downloads' ? ['magic'] : id === 'qr' ? [] : [id]));
  order = order.filter((id, i) => order.indexOf(id) === i);
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...list].sort((a, b) => (pos.get(a.id) ?? 1e9 + list.indexOf(a)) - (pos.get(b.id) ?? 1e9 + list.indexOf(b)));
}

/**
 * Old links (bookmarks, autosaved hashes, links in shared notes) to where things are now: the Tools
 * hub became separate apps, the Editor became Files.
 */
export function redirect(hash) {
  if (hash === '#/tools' || hash === '#/tools/') return '#/';
  if (hash === '#/tools/convert') return '#/files/convert';
  // Download was a tab of Files; it's the Downloads app (in Magic) now.
  if (hash === '#/files/download') return '#/downloads';
  // Saved Files was a tab of Files; it's in Magic now.
  if (hash === '#/files/saved') return '#/saved';
  // QR was an app of its own; it's part of Files → Scan now.
  if (/^#\/(tools\/)?qr(\/.*)?$/.test(hash)) return '#/files/qr';
  // Updates was one app with Weather and Sports tabs; they're apps of their own now.
  if (hash === '#/updates' || hash === '#/updates/') return '#/weather';
  if (/^#\/updates\/sports(\/.*)?$/.test(hash)) return '#/sports';
  // FaceMask was a tab of Files' photo editor; it's the FM app now.
  if (/^#\/files\/facemask(\/.*)?$/.test(hash)) return '#/fm';
  // The Editor became Files (its photo editor: Files → Photo Editor).
  const m = /^#\/tools\/editor(\/.*)?$/.exec(hash);
  if (m) return m[1] && m[1] !== '/' ? `#/files${m[1]}` : '#/files/photo';
  const d = /^#\/tools\/draw(\/.*)?$/.exec(hash);
  if (d) return `#/draw${d[1] ?? ''}`;
  return null;
}
