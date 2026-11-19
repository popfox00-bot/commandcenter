// Settings: app-wide preferences, kept on this phone. Edit Home Screen (the order of the apps, and which are
// hidden), the
// background color (a preset or any color; text, cards and borders follow it so everything stays
// readable, see web/theme.js), the Saved Files connection (Google Drive), Storage (what's kept on the
// phone, how much room it takes, and clearing what can go), Diagnostics, and the way into Jobs.
// Route: #/settings (#/settings/saved and the like: that card opened).

import { el, store } from '../../lib/dom.js';
import { homeApps, HOME_ORDER_KEY, HOME_HIDDEN_KEY, isHidden } from '../index.js';
import { savedFilesSettings } from '../../lib/saved-files-setup.js';
import { snapshot, clearErrors, onDiag } from '../../lib/diag.js';
import { storageSettings } from '../../lib/storage-usage.js';
import { VERSION } from '../../version.js';
import { updateToLatest } from '../../lib/update.js';
import { dragHandle, sortable, moved } from '../../lib/drag-sort.js';

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
  const homeNote = el('p', { class: 'small muted', 'aria-live': 'polite' });
  function drawHome() {
    const apps = homeApps(store.json(HOME_ORDER_KEY, null));
    // (Drag a row by its ☰ to move it; each app stays in its part of the home screen.)
    // (Each with a switch: shown on the home screen, or hidden there, still here to show again.)
    const hidden = store.json(HOME_HIDDEN_KEY, []);
    const setShown = (id, show) => {
      const now = Array.isArray(store.json(HOME_HIDDEN_KEY, [])) ? store.json(HOME_HIDDEN_KEY, []) : [];
      store.set(HOME_HIDDEN_KEY, JSON.stringify(show ? now.filter((x) => x !== id) : [...new Set([...now, id])]));
      drawHome();
      homeList.querySelector(`[data-id="${id}"] .st-home-show`)?.focus();
    };
    homeList.replaceChildren(...apps.map((a) => {
      const off = isHidden(a.id, hidden);
      return el('li', { class: `st-home-row${off ? ' st-home-hidden' : ''}`, 'data-id': a.id },
        el('span', { class: `app-icon st-home-icon tint-${a.tint}`, 'aria-hidden': 'true', text: a.icon }),
        el('span', { class: 'st-home-text' }, el('strong', { class: 'st-home-name', text: a.name }), off ? el('span', { class: 'small muted', text: 'Hidden from the home screen' }) : null),
        el('button', { type: 'button', class: 'st-home-show', role: 'switch', 'aria-checked': String(!off), 'aria-label': `Show ${a.name} on the home screen`, onclick: () => setShown(a.id, off) }, el('span', { class: 'st-switch-knob', 'aria-hidden': 'true' })),
        dragHandle(a.name));
    }));
    homeNote.textContent = Array.isArray(hidden) && hidden.length ? `${hidden.length} hidden.` : '';
    sortable(homeList, (from, to) => {
      const ids = moved(homeApps(store.json(HOME_ORDER_KEY, null)).map((a) => a.id), from, to);
      store.set(HOME_ORDER_KEY, JSON.stringify(ids));
      drawHome();
    });
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

  // Every card after App version: folded until tapped, in the order you set (drag one by its ☰), kept on
  // this phone. App version stays first and open.
  const ORDER_KEY = 'cc.settings.order';
  const homeBody = el('div', {},
    el('p', { class: 'small muted', text: 'The order of the apps on the home screen (drag ☰), and which show there (the switch). Saved on this phone only.' }),
    homeList, homeNote,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', text: 'Reset to default order', onclick: () => { try { localStorage.removeItem(HOME_ORDER_KEY); } catch { /* private mode */ } drawHome(); } }), el('button', { type: 'button', class: 'btn', text: 'Show all', onclick: () => { try { localStorage.removeItem(HOME_HIDDEN_KEY); } catch { /* private mode */ } drawHome(); } })));
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
  // ---------- Suggest Improvements ----------
  // Notes for future updates, written any time (offline too), kept on this phone, and copied to your Drive
  // (Saved Files) as one plain file when it's connected and there's a connection.
  const sugBox = el('textarea', { class: 'st-sug-text', rows: '3', placeholder: 'What would make the app better?', 'aria-label': 'Suggestion' });
  const sugList = el('ul', { class: 'st-sug-list' });
  const sugNote = el('p', { class: 'small muted', 'aria-live': 'polite' });
  async function syncSuggestions() {
    const S = await import('../../lib/suggestions.js');
    const { getConfig, savedFiles } = await import('../../lib/saved-files.js');
    const cfg = getConfig();
    if (!cfg) { sugNote.textContent = 'Kept on this phone. Connect Saved Files (below) to have them copied to your Drive.'; return; }
    if (!S.needsSync()) { sugNote.textContent = `All copied to your Drive (${S.DRIVE_FOLDER}/${S.DRIVE_FILE}).`; return; }
    if (navigator.onLine === false) { sugNote.textContent = 'Kept on this phone; copied to your Drive when you\'re back online.'; return; }
    sugNote.textContent = 'Copying to your Drive…';
    try { await S.sync(savedFiles(cfg)); sugNote.textContent = `Copied to your Drive (${S.DRIVE_FOLDER}/${S.DRIVE_FILE}).`; } catch (e) { sugNote.textContent = `Kept on this phone; not copied yet: ${e.message}`; }
    drawSuggestions();
  }
  async function drawSuggestions() {
    const S = await import('../../lib/suggestions.js');
    const items = S.list();
    sugList.replaceChildren(...[...items].reverse().map((q) => el('li', { class: 'st-sug-row' },
      el('span', { class: 'st-sug-body' }, el('span', { text: q.text }), el('span', { class: 'small muted', text: `${new Date(q.at).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${q.synced ? 'on your Drive' : 'on this phone'}` })),
      el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Delete suggestion: ${q.text.slice(0, 40)}`, text: '✕', onclick: async () => { S.remove(q.id); await drawSuggestions(); syncSuggestions(); } }))));
    if (!items.length) sugList.replaceChildren(el('li', { class: 'small muted', text: 'None yet.' }));
  }
  const sugBody = el('div', {},
    el('p', { class: 'small muted', text: 'Ideas and fixes for future updates. Saved on this phone (works offline) and copied to your Drive when Saved Files is connected, for the next time the app is worked on.' }),
    sugBox,
    el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn primary', text: 'Save suggestion', onclick: async () => { const S = await import('../../lib/suggestions.js'); if (!sugBox.value.trim()) return; S.add(sugBox.value); sugBox.value = ''; await drawSuggestions(); syncSuggestions(); } })),
    sugNote, sugList);
  drawSuggestions(); syncSuggestions();
  // (Back online: copied then; not once Settings is closed.)
  const onOnline = () => { if (!host.isConnected) { window.removeEventListener('online', onOnline); return; } syncSuggestions(); };
  window.addEventListener('online', onOnline);

  const SECTIONS = [
    { id: 'home', title: 'Edit Home Screen', body: () => homeBody },
    { id: 'background', title: 'Background', body: () => bgBody },
    { id: 'saved', title: 'Saved Files', body: () => inner(savedFilesSettings()) },
    { id: 'storage', title: 'Storage', body: () => inner(storageSettings()) },
    { id: 'diagnostics', title: 'Diagnostics', body: () => diagSection },
    { id: 'suggest', title: 'Suggest Improvements', body: () => sugBody },
    { id: 'jobs', title: 'Jobs', link: true },
  ];
  // (#/settings/<card>, from a link elsewhere: that card opened.)
  const built = new Map(); const openNow = new Set([(location.hash || '').split('/')[2] ?? ''].filter(Boolean));
  const orderNow = () => { const saved = store.json(ORDER_KEY, null); const ids = SECTIONS.map((q) => q.id); const o = Array.isArray(saved) ? saved.filter((id) => ids.includes(id)) : []; return [...o, ...ids.filter((id) => !o.includes(id))]; };
  const list = el('div', { class: 'st-sections' });
  function drawSections() {
    const order = orderNow();
    list.replaceChildren(...order.map((id) => {
      const q = SECTIONS.find((x) => x.id === id);
      if (q.link) return el('div', { class: 'card st-fold st-linkcard', 'data-id': id }, jobsLink(), dragHandle(q.title));
      // (Each card's contents built once and moved, not rebuilt: what's typed in it stays.)
      if (!built.has(id)) built.set(id, q.body());
      const d = el('details', { class: 'card st-fold', 'data-id': id, open: openNow.has(id) ? true : null },
        el('summary', {}, el('h2', { text: q.title }), dragHandle(q.title)), built.get(id));
      d.addEventListener('toggle', () => { if (d.open) openNow.add(id); else openNow.delete(id); });
      return d;
    }));
    sortable(list, (from, to) => { store.set(ORDER_KEY, JSON.stringify(moved(orderNow(), from, to))); drawSections(); });
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
