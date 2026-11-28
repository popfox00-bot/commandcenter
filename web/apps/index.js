// Apps on the home screen, by category (Updates, Productivity, Creativity; their order can be changed in
// Settings). Jobs is built into the shell and
// opened from Settings; other apps load on first open. Two apps hold others:
// - Files: Photo Editor (with Collage and Cutout), Convert, PDF and Scan (documents, and QR codes):
//   all on this phone, offline.
// - Magic (in the Vault, behind its password): Downloads (a video from a link: needs a connection),
//   FM (FaceMask), Reverse Fill and Fashion. Saved Files (your own Google Drive folder) is in the hidden
//   area too, an app of its own.
// Games is Fox Games, a self-contained page of its own (web/apps/games/fox/). Trade Desk is the LHS
// fantasy football trade analyzer, likewise a page of its own (web/apps/tradedesk/, copied from the
// tradedesk repository with a ‹ Home link added and its own service worker left out). WorldAtlas (the
// Minecraft world map) too: web/apps/worldatlas/ is the minecraft repository's build, with a ‹ Home link;
// and Laundry Timer (web/apps/laundrytimer/) and Inkling (web/apps/inkling/, its browser version: your own
// Anthropic key in its settings), copied from their repositories with a ‹ Home link. Games played in the
// app go into Fox Games; WorldAtlas stays its own app (a Minecraft companion, not a game played here).
// Socials (Creativity) is a photo feed of accounts you make yourself, all kept on this phone. Storage
// (Productivity) shows all of the app's storage, on this device and in Google Drive, with pie charts.
export const APPS = [
  { id: 'calendar', name: 'Calendar', icon: '📅', tint: 'red', note: 'Your events', href: '#/calendar', cat: 'updates', home: false, parent: 'updates', load: () => import('./calendar/calendar.js') },
  { id: 'weather', name: 'Weather', icon: '⛅', tint: 'amber', note: 'Alerts · Forecast', href: '#/weather', cat: 'updates', home: false, parent: 'updates', load: () => import('./weather/weather.js') },
  { id: 'sports', name: 'Sports', icon: '🏆', tint: 'green', note: 'Your teams · Live scores', href: '#/sports', cat: 'updates', home: false, parent: 'updates', load: () => import('./sports/sports.js') },
  { id: 'packages', name: 'Packages', icon: '📦', tint: 'amber', note: 'Tracking numbers · Live status', href: '#/packages', cat: 'updates', home: false, parent: 'updates', load: () => import('./packages/packages.js') },
  { id: 'notes', name: 'Notes', icon: '📝', tint: 'green', note: 'Notes · Grocery list', href: '#/notes', cat: 'productivity', load: () => import('./notes/notes.js') },
  { id: 'files', name: 'Files', icon: '🗂️', tint: 'blue', note: 'Photos · Video · Convert · PDF · Scan', href: '#/files', cat: 'productivity', load: () => import('../tools/studio/studio.js') },
  { id: 'magic', name: 'Magic', icon: '🪄', tint: 'purple', note: 'Downloads · FM · Reverse Fill · Fashion', href: '#/magic', parent: 'hidden', home: false, locked: true, load: () => import('./magic/magic.js') },
  { id: 'draw', name: 'Draw', icon: '✏️', tint: 'pink', note: 'Sketch and design', href: '#/draw', cat: 'productivity', load: () => import('../tools/draw/draw.js') },
  { id: 'units', name: 'Units', icon: '📐', tint: 'teal', note: 'Units · Currency', href: '#/units', cat: 'productivity', load: () => import('./units/units.js') },
  { id: 'clock', name: 'Clock', icon: '🕐', tint: 'blue', note: 'World clock · Timer · Stopwatch', href: '#/clock', cat: 'productivity', load: () => import('./clock/clock.js') },
  { id: 'calculator', name: 'Calculator', icon: '🧮', tint: 'amber', note: 'Standard', href: '#/calculator', cat: 'productivity', load: () => import('./calculator/calculator.js') },
  { id: 'storage', name: 'Storage', icon: '💾', tint: 'slate', note: 'This device · Google Drive', href: '#/storage', cat: 'productivity', load: () => import('./storage/storage.js') },
  { id: 'laundrytimer', name: 'Laundry Timer', icon: '🧺', tint: 'blue', note: 'Washer · Dryer', href: 'apps/laundrytimer/index.html', cat: 'productivity' },
  { id: 'rap', name: 'Rap', icon: '🎤', tint: 'purple', note: 'Write · Rhymes · Saved Songs', href: '#/rap', cat: 'creativity', load: () => import('./rap/rap.js') },
  { id: 'socials', name: 'Socials', icon: '📸', tint: 'pink', note: 'Your accounts · Posts · Feed', href: '#/socials', cat: 'creativity', load: () => import('./socials/socials.js') },
  { id: 'inkling', name: 'Inkling', icon: '🖍️', tint: 'ink', note: 'Sketch it · Search it', href: 'apps/inkling/index.html', cat: 'creativity' },
  { id: 'games', name: 'Games', icon: '🦊', tint: 'fox', note: 'Fox Games', href: 'apps/games/fox/index.html', cat: 'games' },
  { id: 'worldatlas', name: 'WorldAtlas', icon: '🗺️', tint: 'green', note: 'Minecraft world map', href: 'apps/worldatlas/index.html', cat: 'games' },
  { id: 'tradedesk', name: 'Trade Desk', icon: '🏈', tint: 'blue', note: 'LHS fantasy trades', href: 'apps/tradedesk/index.html', cat: 'creativity' },
  // Settings: the ⚙ at the top right of the home screen, not a tile.
  { id: 'settings', name: 'Settings', icon: '⚙️', tint: 'gray', note: 'Home screen · Colors · Jobs', href: '#/settings', home: false, load: () => import('./settings/settings.js') },
  // Updates: Calendar, Weather and Sports together (the home screen's Updates card opens it).
  { id: 'updates', name: 'Updates', icon: '📰', tint: 'amber', note: 'Calendar · Weather · Sports · Packages', href: '#/updates', home: false, load: () => import('./updates-hub/updates-hub.js') },
  // In Magic (its own apps, opened from it).
  { id: 'downloads', name: 'Downloads', icon: '⬇️', tint: 'blue', note: 'Video links · Queue · History', href: '#/downloads', parent: 'magic', home: false, locked: true, load: () => import('./downloads/downloads.js') },
  { id: 'fm', name: 'FM', icon: '🎭', tint: 'purple', note: 'FaceMask · Quick Swap · Characters', href: '#/fm', parent: 'magic', home: false, locked: true, load: () => import('./fm/fm.js') },
  { id: 'refill', name: 'Reverse Fill', icon: '🎨', tint: 'amber', note: 'Take off a label, logo or stain', href: '#/refill', parent: 'magic', home: false, locked: true, load: () => import('./refill/refill.js') },
  { id: 'fashion', name: 'Fashion', icon: '👕', tint: 'pink', note: 'Put a top, pants, hat or shoes on', href: '#/fashion', parent: 'magic', home: false, locked: true, load: () => import('./fashion/fashion.js') },
  { id: 'saved', name: 'Saved Files', icon: '☁️', tint: 'slate', note: 'Your Google Drive folder', href: '#/saved', parent: 'hidden', home: false, locked: true, load: () => import('./saved/saved-app.js') },
  // The Vault: not on the home screen; Files' ⚙ settings → Admin, behind its own password (web/lib/hidden-lock.js).
  { id: 'hidden', name: 'Vault', icon: '🔐', tint: 'slate', note: '', href: '#/hidden', home: false, load: () => import('./hidden/hidden.js') },
  // Not on the home screen: opened from Settings.
  { id: 'jobs', name: 'Jobs', icon: '⏱', tint: 'slate', note: 'Background runs & settings', href: '#/jobs', home: false },
];

/**
 * The home screen's categories, in order: Updates (one card of previews, opening the Updates page),
 * Productivity, Creativity and Games (tiles).
 */
export const CATEGORIES = [
  { id: 'updates', name: 'Updates' },
  { id: 'productivity', name: 'Productivity' },
  { id: 'creativity', name: 'Creativity' },
  { id: 'games', name: 'Games' },
];

/** Files' own apps (routes #/files/<tab>; each lists the tabs that are part of it). */
export const FILES_APPS = [
  { id: 'photo', name: 'Photo Editor', icon: '🖼️', tint: 'blue', note: 'Edit · Collage · Cutout', tabs: ['photo', 'collage', 'cutout'] },
  { id: 'video', name: 'Video Editor', icon: '🎬', tint: 'purple', note: 'Edit · 2D → 3D · Socials Frame', tabs: ['video', 'video3d', 'videoframe'] },
  { id: 'convert', name: 'Convert', icon: '🔁', tint: 'green', note: 'Photos and PDFs', tabs: ['convert'] },
  { id: 'pdf', name: 'PDF', icon: '📄', tint: 'red', note: 'Write · Sign', tabs: ['pdf'] },
  { id: 'scan', name: 'Scan', icon: '📷', tint: 'ink', note: 'Documents · QR codes', tabs: ['scan', 'qr'] },
];

/** The apps inside an app (Magic's, the Vault's), for its page of them. */
export const childrenOf = (id) => APPS.filter((a) => a.parent === id);
/** Whether an app is in the Vault (Magic and its apps, Saved Files): opened only once it's unlocked. */
export const isLocked = (app) => !!app?.locked;

export const HOME_ORDER_KEY = 'cc.home.order';
/** The apps hidden from the home screen (Settings → Edit Home Screen): their ids. */
export const HOME_HIDDEN_KEY = 'cc.home.hidden';
/** Whether `id` is hidden, by the list kept (`hidden`: an array of ids, or anything else for none). */
export const isHidden = (id, hidden) => Array.isArray(hidden) && hidden.includes(id);
/** The apps on the home screen, in the order you set in Settings (apps added later go at the end). */
export function homeApps(order = null) {
  const list = APPS.filter((a) => a.home !== false);
  if (!Array.isArray(order)) return list;
  // (Updates became Weather and Sports: they take its place. QR went into Files → Scan.)
  order = order.flatMap((id) => (id === 'updates' ? ['weather', 'sports'] : id === 'qr' ? [] : [id]));
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
  // (#/updates is the Updates page again: Calendar, Weather and Sports together.)
  // FaceMask was a tab of Files' photo editor; it's the FM app now.
  if (/^#\/files\/facemask(\/.*)?$/.test(hash)) return '#/fm';
  // The Editor became Files (its photo editor: Files → Photo Editor).
  const m = /^#\/tools\/editor(\/.*)?$/.exec(hash);
  if (m) return m[1] && m[1] !== '/' ? `#/files${m[1]}` : '#/files/photo';
  const d = /^#\/tools\/draw(\/.*)?$/.exec(hash);
  if (d) return `#/draw${d[1] ?? ''}`;
  return null;
}
