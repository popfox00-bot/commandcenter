// Apps on the home screen. Tools and Jobs are built into the shell; other apps load on first open.
// Games is Fox Games, a self-contained page of its own (web/apps/games/fox/).
export const APPS = [
  { id: 'tools', name: 'Tools', icon: '🧰', tint: 'blue', note: 'Editor · Draw · QR & Barcode', href: '#/tools' },
  { id: 'updates', name: 'Updates', icon: '🔔', tint: 'amber', note: 'Weather · Sports', href: '#/updates', load: () => import('./updates/updates.js') },
  { id: 'notes', name: 'Notes', icon: '📝', tint: 'green', note: 'Notes · Grocery list', href: '#/notes', load: () => import('./notes/notes.js') },
  { id: 'games', name: 'Games', icon: '🦊', tint: 'fox', note: 'Fox Games', href: 'apps/games/fox/index.html' },
  { id: 'jobs', name: 'Jobs', icon: '⏱', tint: 'slate', note: 'Background runs & settings', href: '#/jobs' },
];
