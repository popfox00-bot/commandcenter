// Your own Cloudflare Worker (the Jobs setup): its address and access token, as set in Settings → Jobs
// (or the deploy's config). Used by QR's "Check where it leads" and Downloads' "Find videos".
import { store } from './dom.js';

/** { url, token } ('' when not set up). */
export function workerSettings() {
  const url = (store.get('cc.workerUrl') || window.CC_CONFIG?.workerUrl || (location.hostname.endsWith('.github.io') ? '' : location.origin)).replace(/\/+$/, '');
  return { url, token: store.get('cc.apiToken') || '' };
}
