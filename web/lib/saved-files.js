// Saved Files: files kept in your own Google Drive folder, through the Apps Script web app in your
// "Saved Files" spreadsheet (apps-script/saved-files.gs). Its URL and access key are entered on the
// phone and kept only here (localStorage), never in the app's code. Requests go as text/plain JSON
// so the browser sends them straight (no CORS preflight, which Apps Script can't answer).

const CONFIG_KEY = 'cc.savedFiles';
export const MAX_BYTES = 25 * 1024 * 1024;

export function getConfig(storage = globalThis.localStorage) {
  try { const c = JSON.parse(storage.getItem(CONFIG_KEY)); return c?.url && c?.key ? c : null; } catch { return null; }
}
export function setConfig(c, storage = globalThis.localStorage) {
  try { if (c) storage.setItem(CONFIG_KEY, JSON.stringify({ url: c.url, key: c.key })); else storage.removeItem(CONFIG_KEY); } catch { /* private mode */ }
}

/** An Apps Script web app URL ("https://script.google.com/macros/s/…/exec"), tidied; null if it isn't one. */
export function checkUrl(url) {
  try {
    const u = new URL(String(url).trim());
    if (u.protocol !== 'https:' || !/^(script\.google\.com|script\.googleusercontent\.com)$/.test(u.hostname) || !/\/exec$/.test(u.pathname)) return null;
    return `${u.origin}${u.pathname}`;
  } catch { return null; }
}

export async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64, type = 'application/octet-stream') {
  const s = atob(b64); const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** A client for one web app: { ping, list, upload, download, remove }. */
export function savedFiles({ url, key }, { fetch: f = globalThis.fetch } = {}) {
  async function call(action, body = {}) {
    let res;
    try {
      res = await f(url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key, action, ...body }), redirect: 'follow', cache: 'no-store', credentials: 'omit' });
    } catch { throw new Error(navigator.onLine === false ? 'You\'re offline. Saved Files need a connection.' : 'Couldn\'t reach your Saved Files script.'); }
    if (!res.ok) throw new Error(`Your Saved Files script answered ${res.status}. Is it deployed as a web app for "Anyone"?`);
    let out;
    try { out = await res.json(); } catch { throw new Error('That URL didn\'t answer like the Saved Files script. Check it ends in /exec.'); }
    if (!out?.ok) throw new Error(out?.error || 'The Saved Files script refused.');
    return out;
  }
  return {
    ping: async () => (await call('ping')).folder,
    list: async () => (await call('list')).files ?? [],
    async upload(file, from = '') {
      if (file.size > MAX_BYTES) throw new Error(`"${file.name}" is too big for Saved Files (25 MB at most).`);
      return (await call('upload', { name: file.name, type: file.type || 'application/octet-stream', data: await toBase64(file), from })).file;
    },
    async download(id) {
      const out = await call('download', { id });
      return new File([fromBase64(out.data, out.type)], out.name, { type: out.type });
    },
    remove: async (id) => { await call('delete', { id }); },
  };
}

/** The configured client, or null when Saved Files isn't set up on this phone. */
export const connected = () => { const c = getConfig(); return c ? savedFiles(c) : null; };

/** "1.2 MB" */
export function size(n) {
  if (!(n >= 0)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
