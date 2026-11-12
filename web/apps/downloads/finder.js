// Downloads → "Find videos" (a switch, off by default): a link to a web page with videos in it
// (not a video file itself) is checked (https, not local, not a scam), then sent to your own Worker,
// which reads the page and answers with the video files on it (find-videos.js). Each can be opened
// (the usual checks, stills, Download) or all queued. Only the page's link goes to your Worker; the
// page's videos come straight from their sites as usual. Streaming-only and protected videos (most
// big video sites) aren't on pages as files, so there's nothing to find on those.

import { el, fill } from '../../lib/dom.js';
import { workerSettings } from '../../lib/worker-api.js';
import { checkPageLink, fileNameFor } from '../../tools/download/download-core.js';
import { verdict } from './job-ui.js';

/**
 * Looks for videos on the page at `input`, shown in `host`. `onUse(url)` opens one; `onQueueAll(urls)`
 * queues them all. Returns a function that stops it.
 * @param {HTMLElement} host @param {string} input
 * @param {{ onUse: (url: string) => void, onQueueAll: (urls: string[]) => void, fetchImpl?: typeof fetch }} o
 */
export function findOnPage(host, input, { onUse, onQueueAll, fetchImpl = globalThis.fetch }) {
  const ctrl = new AbortController();
  const c = checkPageLink(input);
  if (c.ok === false) { fill(host, verdict('danger', 'Not looked at', c.reasons)); return () => {}; }
  const { url: worker, token } = workerSettings();
  if (!worker || !token) {
    fill(host, verdict('caution', 'Find videos needs your Worker', [{ title: 'Set it up in Settings → Jobs', detail: 'Your own Cloudflare Worker reads the page (a phone\'s app isn\'t allowed to). Or turn Find videos off to paste a video file\'s link.' }]));
    return () => {};
  }
  fill(host, el('p', { class: 'dl-ok' }, el('span', { class: 'dl-ok-mark', text: '🔎' }), ` Looking for videos on ${c.host}…`));
  (async () => {
    let body;
    try {
      const res = await fetchImpl(`${worker}/api/findvideos`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ url: c.url }), cache: 'no-store', signal: ctrl.signal });
      body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 401 ? 'The Worker\'s token is wrong (Settings → Jobs).' : res.status === 404 ? 'Your Worker doesn\'t have Find videos yet: deploy its new version (README → Cloud setup).' : body.error ? `The page: ${body.error}.` : `Your Worker answered ${res.status}.`);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      fill(host, verdict('danger', 'Couldn\'t look at the page', [{ title: e.message || 'The connection failed.', detail: '' }]));
      return;
    }
    if (ctrl.signal.aborted) return;
    // A link that's a video itself: open it as one.
    if (body.direct) { onUse(body.page); return; }
    const vids = Array.isArray(body.videos) ? body.videos : [];
    const head = el('p', { class: 'dl-ok' }, el('span', { class: 'dl-ok-mark', text: vids.length ? '✓' : '–' }),
      ` ${vids.length ? `${vids.length} video${vids.length === 1 ? '' : 's'}` : 'No video files'} on ${body.title ? `“${body.title.slice(0, 60)}”` : c.host}`);
    const rows = vids.map((v) => el('div', { class: 'card dl-found' },
      el('div', { class: 'dl-title' }, el('strong', { class: 'dl-name', text: v.title || fileNameFor(v.url, (/\.(\w+)(?:$|\?)/.exec(new URL(v.url).pathname)?.[1] ?? 'mp4').toLowerCase()) }),
        el('span', { class: 'small muted', text: `${new URL(v.url).hostname} · ${{ video: 'a video on the page', meta: 'the page\'s main video', data: 'the page\'s video', link: 'a link on the page', script: 'in the page\'s player' }[v.from] ?? ''}` })),
      el('button', { class: 'btn primary', type: 'button', text: 'Open', onclick: () => onUse(v.url) })));
    const notes = [];
    if (body.streams) notes.push(el('p', { class: 'small muted', text: `${body.streams} more stream only (in pieces, not as a file): those can't be saved here.` }));
    if (!vids.length) notes.push(el('p', { class: 'small muted', text: 'Big video sites stream their videos (or protect them), so there\'s no file on the page to find. A site that shows a plain video usually works.' }));
    fill(host, head, vids.length > 1 ? el('button', { class: 'btn', type: 'button', text: `+ Queue all ${vids.length}`, onclick: () => onQueueAll(vids.map((v) => v.url)) }) : null, ...rows, ...notes);
  })();
  return () => ctrl.abort();
}
