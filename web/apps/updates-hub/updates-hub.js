// Updates: Calendar, Weather and Sports together, as tabs (the home screen's Updates card opens it). Route:
// #/updates (Calendar first) and #/updates/<calendar|weather|sports>. Each tab is its own app, mounted when
// it's opened and put away when another is.

import { el } from '../../lib/dom.js';
import { APPS } from '../index.js';

const TABS = [['calendar', '📅 Calendar'], ['weather', '⛅ Weather'], ['sports', '🏆 Sports']];

export function mount(host) {
  const bar = el('nav', { class: 'segmented upd-hub-tabs', role: 'tablist', 'aria-label': 'Updates' });
  const body = el('div', { class: 'upd-hub-body' });
  host.append(bar, body);
  let shown = null; let unmount = null; let run = 0;

  const current = () => { const t = (location.hash || '').split('/')[2]; return TABS.some(([id]) => id === t) ? t : 'calendar'; };

  async function show() {
    const id = current();
    bar.replaceChildren(...TABS.map(([t, label]) => el('a', { class: `seg${t === id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(t === id), href: `#/updates/${t}`, text: label })));
    if (id === shown) return;
    shown = id; const me = ++run;
    if (typeof unmount === 'function') unmount();
    unmount = null;
    body.replaceChildren(el('p', { class: 'muted center', text: 'Loading…' }));
    const app = APPS.find((a) => a.id === id);
    try {
      const mod = await app.load();
      if (me !== run) return;
      body.replaceChildren();
      unmount = mod.mount(body);
    } catch (err) {
      if (me === run) body.replaceChildren(el('p', { class: 'bad-text', text: `Could not load ${app.name}: ${err.message}` }));
    }
  }

  const onHash = () => { if ((location.hash || '').startsWith('#/updates')) show(); };
  window.addEventListener('hashchange', onHash);
  show();
  return () => { window.removeEventListener('hashchange', onHash); run++; if (typeof unmount === 'function') unmount(); };
}
