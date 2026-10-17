// Tools run entirely on this device: files never leave the phone, and they work offline.
export const TOOLS = [
  {
    id: 'convert',
    name: 'File Converter',
    description: 'Photos and PDFs: HEIC, JPEG, PNG, WebP ↔ JPEG, PNG, WebP, PDF. Resize and strip location data.',
    icon: '⇄',
    load: () => import('./convert/convert.js'),
  },
  {
    id: 'editor',
    name: 'Photo Editor',
    description: 'Crop, straighten, light and color, filters, and markup. Like the Photos app, plus extras.',
    icon: '✎',
    load: () => import('./editor/editor.js'),
  },
];
