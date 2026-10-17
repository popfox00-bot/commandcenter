// Tools run entirely on this device: files never leave the phone, and they work offline.
export const TOOLS = [
  {
    id: 'editor',
    name: 'Editor',
    description: 'Edit photos like the Photos app, write on and sign PDFs, scan paper into PDFs, and convert photos and PDFs.',
    icon: '✎',
    load: () => import('./studio/studio.js'),
  },
];

/** Old links (bookmarks, autosaved hashes) that moved. */
export const REDIRECTS = { '#/tools/convert': '#/tools/editor/convert' };
