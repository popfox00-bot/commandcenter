// Getting results out of the app: Share sheet (Save to Photos / Files / AirDrop) or download.

export function canShareFiles(files) {
  try { return !!navigator.canShare && navigator.canShare({ files }); } catch { return false; }
}

/** Opens the iOS share sheet. Must be called from a tap handler. Returns false if cancelled/unsupported. */
export async function shareFiles(files, title) {
  if (!canShareFiles(files)) return false;
  try {
    await navigator.share({ files, title });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return false;
    throw err;
  }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "IMG_1234.HEIC" + "jpg" -> "IMG_1234.jpg"; optional suffix for pages ("-p2"). */
export function renameExt(name, ext, suffix = '') {
  const stem = name.replace(/\.[^./]+$/, '') || 'file';
  return `${stem}${suffix}.${ext}`;
}
