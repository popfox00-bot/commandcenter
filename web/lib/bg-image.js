// Background pictures: your own photos behind a part of the app (Socials as a whole, an account's profile
// page, the Vault), kept on this phone (IndexedDB, as bytes; nothing uploaded). One layer behind the page,
// fixed, the picture covering it with a veil of the page's own background color over it so text stays
// readable in light and dark. Set from each part's settings.

import { idb } from './idb.js';
import { el } from './dom.js';

const key = (name) => `cc.bg.${name}`;

/** A background picture kept under `name`, as a Blob, or null. */
export async function loadBg(name) {
  const v = await idb.get(key(name));
  return v?.buf ? new Blob([v.buf], { type: v.type || 'image/jpeg' }) : null;
}

/** A picked photo kept as `name`'s background: made at most 1600 px across (JPEG). Returns it (a Blob). */
export async function saveBg(name, file) {
  let blob = file;
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    blob = await new Promise((ok) => c.toBlob((b) => ok(b ?? file), 'image/jpeg', 0.86));
  } catch { /* kept as it is */ }
  await idb.set(key(name), { buf: await blob.arrayBuffer(), type: blob.type || 'image/jpeg', at: Date.now() });
  return blob;
}

/** `name`'s background taken away. */
export const removeBg = (name) => idb.del(key(name));

// The one layer, behind everything (made the first time it's asked for).
let layer = null; let url = '';
function theLayer() {
  if (!layer) { layer = el('div', { class: 'cc-bgimg', 'aria-hidden': 'true', hidden: true }); document.body.prepend(layer); }
  return layer;
}

/** The picture behind the page now (a Blob), or none (null). */
export function showBg(blob) {
  const l = theLayer();
  if (url) { URL.revokeObjectURL(url); url = ''; }
  if (!blob) { l.hidden = true; l.style.backgroundImage = ''; document.body.classList.remove('has-bgimg'); return; }
  url = URL.createObjectURL(blob);
  l.style.backgroundImage = `url("${url}")`; l.hidden = false; document.body.classList.add('has-bgimg');
}

/**
 * A settings row for a background: its picture (small), Choose… and Remove. `name`: where it's kept; `label`;
 * `onChange(blob|null)` once it's changed.
 */
export function bgSetting(name, label, onChange = () => {}) {
  const thumb = el('span', { class: 'cc-bg-thumb', 'aria-hidden': 'true' });
  const status = el('span', { class: 'small muted' });
  const input = el('input', { type: 'file', accept: 'image/*', class: 'cc-bg-file', 'aria-label': `Choose a picture for ${label}` });
  const remove = el('button', { type: 'button', class: 'btn small-btn ghost', text: 'Remove', hidden: true });
  let turl = '';
  const paint = (b) => { if (turl) URL.revokeObjectURL(turl); turl = b ? URL.createObjectURL(b) : ''; thumb.style.backgroundImage = b ? `url("${turl}")` : ''; thumb.classList.toggle('none', !b); remove.hidden = !b; status.textContent = b ? '' : 'None'; };
  input.addEventListener('change', async () => { const f = input.files?.[0]; input.value = ''; if (!f) return; status.textContent = 'Saving…'; const b = await saveBg(name, f); paint(b); onChange(b); });
  remove.addEventListener('click', async () => { await removeBg(name); paint(null); onChange(null); });
  loadBg(name).then(paint);
  return el('div', { class: 'cc-bg-row' }, thumb, el('span', { class: 'cc-bg-label' }, el('strong', { text: label }), status),
    el('label', { class: 'btn small-btn' }, 'Choose…', input), remove);
}
