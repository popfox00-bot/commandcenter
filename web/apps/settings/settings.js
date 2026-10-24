// Settings: app-wide preferences, kept on this phone. For now the background color: a preset or any
// color; text, cards and borders follow it so everything stays readable (see web/theme.js).
// Route: #/settings.

import { el } from '../../lib/dom.js';

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

  host.append(el('div', { class: 'st' },
    el('section', { class: 'card' },
      el('h2', { text: 'Background' }),
      el('p', { class: 'small muted', text: 'Used across the whole app. Saved on this phone only.' }),
      grid,
      el('label', { class: 'st-custom' }, 'Custom color', custom),
      status,
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', text: 'Reset to default', onclick: () => { theme.save(null); render(); } })))));
  render();
}
