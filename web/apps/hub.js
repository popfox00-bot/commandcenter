// An app that holds others (Magic, Files): its page of them, tiles like the home screen's.
import { el } from '../lib/dom.js';

/** @param {HTMLElement} host @param {{ name: string, icon: string, tint: string, note: string, href: string }[]} items */
export function renderHub(host, items) {
  const grid = el('nav', { class: 'app-grid hub-grid', 'aria-label': 'Apps' }, ...items.map((a) => el('a', { class: 'app-tile', href: a.href },
    el('span', { class: `app-icon tint-${a.tint}`, 'aria-hidden': 'true', text: a.icon }),
    el('span', { class: 'app-name', text: a.name }),
    el('span', { class: 'app-note muted', text: a.note }))));
  host.append(grid);
  return grid;
}
