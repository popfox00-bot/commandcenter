// Apps on the home screen. Tools and Jobs are built into the shell; other apps load on first open.
export const APPS = [
  { id: 'tools', name: 'Tools', icon: '🧰', tint: 'blue', note: 'Editor · QR & Barcode', href: '#/tools' },
  { id: 'updates', name: 'Updates', icon: '🔔', tint: 'amber', note: 'Weather · Sports', href: '#/updates', load: () => import('./updates/updates.js') },
  { id: 'jobs', name: 'Jobs', icon: '⏱', tint: 'slate', note: 'Background runs & settings', href: '#/jobs' },
];
