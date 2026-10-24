// Tools run entirely on this device: files never leave the phone, and they work offline.
export const TOOLS = [
  {
    id: 'editor',
    name: 'Editor',
    description: 'Edit photos, make collages, cut out objects as Characters, write on and sign PDFs, scan paper, and convert files.',
    icon: '✎',
    load: () => import('./studio/studio.js'),
  },
  {
    id: 'draw',
    name: 'Draw',
    description: 'A blank canvas to sketch and design: pens with Apple Pencil pressure, shapes, text, colors and paper styles. Save to Photos or Files.',
    icon: '✏️',
    load: () => import('./draw/draw.js'),
  },
  {
    id: 'qr',
    name: 'QR & Barcode',
    description: 'Scan codes and check where links really go before opening them. Make QR codes for links, Wi-Fi, contacts, events and more.',
    icon: '▦',
    load: () => import('./qr/qr.js'),
  },
];

/** Old links (bookmarks, autosaved hashes) that moved. */
export const REDIRECTS = { '#/tools/convert': '#/tools/editor/convert' };
