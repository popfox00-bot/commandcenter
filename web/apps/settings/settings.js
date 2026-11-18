// Settings: app-wide preferences, kept on this phone. Edit Home Screen (the order of the apps), the
// background color (a preset or any color; text, cards and borders follow it so everything stays
// readable, see web/theme.js), the Saved Files connection (Google Drive), Storage (what's kept on the
// phone, how much room it takes, and clearing what can go), Diagnostics, and the way into Jobs.
// Route: #/settings (#/settings/saved and the like: that card opened).

import { el, store } from '../../lib/dom.js';
import { homeApps, HOME_ORDER_KEY } from '../index.js';
import { savedFilesSettings } from '../../lib/saved-files-setup.js';
import { snapshot, clearErrors, onDiag } from '../../lib/diag.js';
import { storageSettings } from '../../lib/storage-usage.js';
import { VERSION } from '../../version.js';
import { updateToLatest } from '../../lib/update.js';

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

  // ---------- Diagnostics ----------
  // What's loaded on this phone (the face finders, the face-part maps, the upscaler), how long the last
  // face swap took, step by step, and anything that went wrong where the app carried on without it.
  const diagBody = el('div', { class: 'st-diag' });
  function drawDiag() {
    const d = snapshot();
    const when = (t) => new Date(t).toLocaleString();
    diagBody.replaceChildren(
      el('h3', { class: 'small', text: 'Loaded' }),
      d.models.length ? el('ul', { class: 'st-diag-list small' }, ...d.models.map((m) => el('li', { text: `${m.status === 'ready' ? '✅' : m.status === 'failed' ? '⚠️' : '⏳'} ${m.name}${m.ms != null ? `: ${m.ms} ms` : ''}${m.error ? ` (${m.error})` : ''}` })))
        : el('p', { class: 'small muted', text: 'Nothing yet: they load the first time they\'re needed (open FM and use a face tool).' }),
      el('h3', { class: 'small', text: 'How long it took' }),
      d.timings.length ? el('div', {}, ...d.timings.map((t) => el('div', { class: 'st-diag-timing' },
        el('p', { class: 'small', text: `${t.what} (${when(t.at)}): ${Object.values(t.steps).reduce((a, b) => a + b, 0)} ms` }),
        el('ul', { class: 'st-diag-list small muted' }, ...Object.entries(t.steps).map(([k, v]) => el('li', { text: `${k}: ${v} ms` }))))))
        : el('p', { class: 'small muted', text: 'Nothing timed yet (a face swap is).' }),
      el('h3', { class: 'small', text: 'Problems' }),
      d.errors.length ? el('ul', { class: 'st-diag-list small' }, ...d.errors.slice().reverse().map((e) => el('li', { text: `${when(e.at)}: ${e.where}: ${e.message}` })))
        : el('p', { class: 'small muted', text: 'None.' }),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'btn', text: 'Copy report', onclick: async (ev) => { const b = ev.currentTarget; try { await navigator.clipboard.writeText(JSON.stringify({ app: location.href.split('#')[0], ua: navigator.userAgent, ...snapshot() }, null, 2)); b.textContent = 'Copied'; } catch { b.textContent = 'Couldn\'t copy'; } } }),
        d.errors.length ? el('button', { type: 'button', class: 'btn', text: 'Clear problems', onclick: () => clearErrors() }) : null));
  }
  drawDiag();
  const stop = onDiag(drawDiag);
  // (Stop listening once Settings is closed.)
  const gone = new MutationObserver(() => { if (!host.isConnected || !host.contains(diagBody)) { stop(); gone.disconnect(); } });
  gone.observe(document.body, { childList: true, subtree: true });

  // ---------- Update to the latest version ----------
  // Asks for the newest version now (instead of waiting for the app to notice by itself); when there is
  // one, it's put in and the app reloads on it. Nothing on the phone (notes, edits, settings) is lost.
  const updNote = el('p', { class: 'small muted', 'aria-live': 'polite', text: `This is v${VERSION}.` });
  const updBtn = el('button', { type: 'button', class: 'btn primary block', text: 'Update to Latest Version' });
  updBtn.addEventListener('click', async () => {
    updBtn.disabled = true;
    await updateToLatest((t) => { updNote.textContent = t; });
    updBtn.disabled = false;
  });

  // Every card after App version: folded until tapped, in the order you set (↑ / ↓ on each), kept on this
  // phone. App version stays first and open.
  const ORDER_KEY = 'cc.settings.order';
  const homeBody = el('div', {},
    el('p', { class: 'small muted', text: 'The order of the apps on the home screen. Saved on this phone only.' }),
    homeList,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', text: 'Reset to default order', onclick: () => { try { localStorage.removeItem(HOME_ORDER_KEY); } catch { /* private mode */ } drawHome(); } })));
  const bgBody = el('div', {},
    el('p', { class: 'small muted', text: 'Used across the whole app. Saved on this phone only.' }),
    grid,
    el('label', { class: 'st-custom' }, 'Custom color', custom),
    status,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', text: 'Reset to default', onclick: () => { theme.save(null); render(); } })));
  const inner = (section) => { section.classList.remove('card'); section.classList.add('st-inner'); return section; };
  const diagSection = el('div', {},
    el('p', { class: 'small muted', text: 'What\'s loaded, how long things took, and anything that went wrong. Kept on this phone only; Copy report to share it.' }),
    diagBody);
  const jobsLink = () => el('a', { class: 'st-link st-link-inner', href: '#/jobs' },
    el('span', { class: 'app-icon st-home-icon tint-slate', 'aria-hidden': 'true', text: '⏱' }),
    el('span', { class: 'st-link-text' }, el('strong', { text: 'Jobs' }), el('span', { class: 'small muted', text: 'Background runs, push notifications and their setup' })),
    el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }));
  const SECTIONS = [
    { id: 'home', title: 'Edit Home Screen', body: () => homeBody },
    { id: 'background', title: 'Background', body: () => bgBody },
    { id: 'saved', title: 'Saved Files', body: () => inner(savedFilesSettings()) },
    { id: 'storage', title: 'Storage', body: () => inner(storageSettings()) },
    { id: 'diagnostics', title: 'Diagnostics', body: () => diagSection },
    { id: 'jobs', title: 'Jobs', link: true },
  ];
  // (#/settings/<card>, from a link elsewhere: that card opened.)
  const built = new Map(); const openNow = new Set([(location.hash || '').split('/')[2] ?? ''].filter(Boolean));
  const orderNow = () => { const saved = store.json(ORDER_KEY, null); const ids = SECTIONS.map((q) => q.id); const o = Array.isArray(saved) ? saved.filter((id) => ids.includes(id)) : []; return [...o, ...ids.filter((id) => !o.includes(id))]; };
  const list = el('div', { class: 'st-sections' });
  function drawSections(focusId = null, dir = 0) {
    const order = orderNow();
    const move = (id, d) => { const o = orderNow(); const i = o.indexOf(id); const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; store.set(ORDER_KEY, JSON.stringify(o)); drawSections(id, d); };
    const arrows = (q, i) => el('span', { class: 'st-move' },
      el('button', { type: 'button', class: 'icon-btn st-move-btn', 'aria-label': `Move ${q.title} up`, 'data-dir': '-1', text: '↑', disabled: i === 0, onclick: (e) => { e.preventDefault(); e.stopPropagation(); move(q.id, -1); } }),
      el('button', { type: 'button', class: 'icon-btn st-move-btn', 'aria-label': `Move ${q.title} down`, 'data-dir': '1', text: '↓', disabled: i === order.length - 1, onclick: (e) => { e.preventDefault(); e.stopPropagation(); move(q.id, 1); } }));
    list.replaceChildren(...order.map((id, i) => {
      const q = SECTIONS.find((x) => x.id === id);
      if (q.link) return el('div', { class: 'card st-fold st-linkcard', 'data-id': id }, jobsLink(), arrows(q, i));
      // (Each card's contents built once and moved, not rebuilt: what's typed in it stays.)
      if (!built.has(id)) built.set(id, q.body());
      const d = el('details', { class: 'card st-fold', 'data-id': id, open: openNow.has(id) ? true : null },
        el('summary', {}, el('h2', { text: q.title }), arrows(q, i)), built.get(id));
      d.addEventListener('toggle', () => { if (d.open) openNow.add(id); else openNow.delete(id); });
      return d;
    }));
    if (focusId) list.querySelector(`[data-id="${focusId}"] button[data-dir="${dir}"]`)?.focus();
  }
  drawSections();

  host.append(el('div', { class: 'st' },
    el('section', { class: 'card' },
      el('h2', { text: 'App version' }),
      updBtn, updNote),
    list));
  const linked = list.querySelector('details[open]');
  if (linked) requestAnimationFrame(() => linked.scrollIntoView({ block: 'start' }));
  render();
}
