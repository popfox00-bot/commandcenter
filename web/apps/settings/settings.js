// Settings: app-wide preferences, kept on this phone. Edit Home Screen (the order of the apps), the
// background color (a preset or any color; text, cards and borders follow it so everything stays
// readable, see web/theme.js), the Saved Files connection (Google Drive), and the way into Jobs.
// Route: #/settings.

import { el, store } from '../../lib/dom.js';
import { homeApps, HOME_ORDER_KEY } from '../index.js';
import { savedFilesSettings } from '../../lib/saved-files-setup.js';

export function mount(host) {
  const theme = globalThis.ccTheme;
  const current = () => theme.load()?.bg ?? null;

  const swatch = (bg, name) => el('button', {
    type: 'button', class: 'st-swatch', 'aria-label': `Background ${name}`, title: name,
    onclick: () => { theme.save(bg ? { bg } : null); render(); },
  }, el('span', { class: 'st-chip', 'data-bg': bg ?? 'system' }), el('span', { class: 'st-name small', text: name }));

  const custom = el('input', { type: 'color', class: 'st-color', 'aria-label': 'Custom background color' });
  custom.addEventListener('input', () => { theme.save({ bg: custom.value }); render(); });
  const status = el('p', { class: 'small muted', 'aria-live': 'polite' });
  const grid = el('div', { class: 'st-grid' }, swatch(null, 'System'), ...theme.PRESETS.map((p) => swatch(p.bg, p.name)));

  function render() {
    const bg = current();
    for (const b of grid.children) {
      const chip = b.querySelector('.st-chip');
      const v = chip.dataset.bg;
      // Swatch colors go through the CSSOM: inline style attributes are blocked by the page's CSP.
      chip.style.background = v === 'system' ? 'linear-gradient(135deg, #f6f7f9 50%, #0f1115 50%)' : v;
      b.setAttribute('aria-pressed', String(v === (bg ?? 'system')));
    }
    custom.value = bg ?? (matchMedia('(prefers-color-scheme: dark)').matches ? '#0f1115' : '#f6f7f9');
    const preset = theme.PRESETS.find((p) => p.bg === bg);
    status.textContent = bg ? `Background: ${preset ? preset.name : bg.toUpperCase()}. Text and cards adjust to stay readable.` : 'Background: follows the phone\'s light or dark mode.';
  }

  // ---------- Edit Home Screen ----------
  const homeList = el('ol', { class: 'st-home', 'aria-label': 'Home screen order' });
  function drawHome() {
    const apps = homeApps(store.json(HOME_ORDER_KEY, null));
    const move = (i, d) => {
      const ids = apps.map((a) => a.id);
      [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
      store.set(HOME_ORDER_KEY, JSON.stringify(ids));
      drawHome();
      homeList.querySelector(`[data-id="${ids[i + d]}"] button[data-dir="${d}"]`)?.focus();
    };
    homeList.replaceChildren(...apps.map((a, i) => el('li', { class: 'st-home-row', 'data-id': a.id },
      el('span', { class: `app-icon st-home-icon tint-${a.tint}`, 'aria-hidden': 'true', text: a.icon }),
      el('strong', { class: 'st-home-name', text: a.name }),
      el('button', { type: 'button', class: 'icon-btn', 'data-dir': '-1', 'aria-label': `Move ${a.name} up`, text: '↑', disabled: i === 0, onclick: () => move(i, -1) }),
      el('button', { type: 'button', class: 'icon-btn', 'data-dir': '1', 'aria-label': `Move ${a.name} down`, text: '↓', disabled: i === apps.length - 1, onclick: () => move(i, 1) }))));
  }
  drawHome();

  host.append(el('div', { class: 'st' },
    el('section', { class: 'card' },
      el('h2', { text: 'Edit Home Screen' }),
      el('p', { class: 'small muted', text: 'The order of the apps on the home screen. Saved on this phone only.' }),
      homeList,
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', text: 'Reset to default order', onclick: () => { try { localStorage.removeItem(HOME_ORDER_KEY); } catch { /* private mode */ } drawHome(); } }))),
    el('section', { class: 'card' },
      el('h2', { text: 'Background' }),
      el('p', { class: 'small muted', text: 'Used across the whole app. Saved on this phone only.' }),
      grid,
      el('label', { class: 'st-custom' }, 'Custom color', custom),
      status,
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', text: 'Reset to default', onclick: () => { theme.save(null); render(); } }))),
    savedFilesSettings(),
    el('a', { class: 'card st-link', href: '#/jobs' },
      el('span', { class: 'app-icon st-home-icon tint-slate', 'aria-hidden': 'true', text: '⏱' }),
      el('span', { class: 'st-link-text' }, el('strong', { text: 'Jobs' }), el('span', { class: 'small muted', text: 'Background runs, push notifications and their setup' })),
      el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }))));
  render();
}
