// Tools run entirely on this device: files never leave the phone, and they work offline.
export const TOOLS = [
  {
    id: 'editor',
    name: 'Editor',
    description: 'Edit photos, make collages, cut out objects as Characters, write on and sign PDFs, scan paper, and convert files.',
    icon: '✎',
    load: () => import('./studio/studio.js'),
  },
];

/** Old links (bookmarks, autosaved hashes) that moved. */
export const REDIRECTS = { '#/tools/convert': '#/tools/editor/convert' };
