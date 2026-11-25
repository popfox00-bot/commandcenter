// The Dock: a short bar along the bottom of every screen of the app (Home, each app, Jobs). In its middle, a
// rounded square that goes back to the home screen; two Favorites on each side, each going straight to an
// app. Which four is yours: hold one down (or right-click it) to change it, or Settings → Dock. Kept on this
// phone. Hidden while typing (the keyboard's up), and under anything full screen.
//
// It can be tucked away: a small Command logo at the bottom left opens it, and closes it again. Each app keeps
// its own choice (tap the logo in it, or Settings → Dock → Show the Dock in…); Socials starts tucked away.

import { el, store } from './dom.js';

export const DOCK_KEY = 'cc.dock';
export const DOCK_MODE_KEY = 'cc.dock.mode';
/** The apps whose Dock starts tucked away (behind the logo). */
export const DEFAULT_TUCKED = ['socials'];

/** Whether the Dock is tucked away (just the logo) in an app ('' : the home screen). */
export function dockTucked(appId, saved = store.json(DOCK_MODE_KEY, {})) {
  const v = saved && typeof saved === 'object' ? saved[appId || 'home'] : undefined;
  return v === 'tucked' ? true : v === 'shown' ? false : DEFAULT_TUCKED.includes(appId);
}
/** Keep whether the Dock is tucked away in an app. */
export function setDockTucked(appId, tucked) {
  const m = { ...(store.json(DOCK_MODE_KEY, {}) ?? {}) }; m[appId || 'home'] = tucked ? 'tucked' : 'shown';
  store.set(DOCK_MODE_KEY, JSON.stringify(m)); return m;
}

/** The Favorites to start with: two on the left, two on the right. */
export const DEFAULT_DOCK = ['notes', 'clock', 'socials', 'calculator'];

/** The apps a Favorite can be: any of the app's own, not the hidden area's (a Dock shouldn't give it away). */
export function dockChoices(apps) {
  return apps.filter((a) => a.href && !a.locked && a.parent !== 'hidden' && !['hidden', 'jobs'].includes(a.id));
}

/** The four Favorites (app ids) kept, any that's gone replaced by a default not already there. */
export function dockFavorites(apps, saved = store.json(DOCK_KEY, null)) {
  const ok = new Set(dockChoices(apps).map((a) => a.id));
  const out = Array.isArray(saved) ? saved.slice(0, 4).map((id) => (ok.has(id) ? id : null)) : [...DEFAULT_DOCK];
  while (out.length < 4) out.push(null);
  for (let i = 0; i < 4; i++) if (!out[i]) out[i] = [...DEFAULT_DOCK, ...ok].find((id) => ok.has(id) && !out.includes(id)) ?? null;
  return out;
}

/** Keep Favorite `slot` (0–3) as app `id`; one already elsewhere in the Dock swaps places with it. */
export function setFavorite(apps, slot, id) {
  const fav = dockFavorites(apps); const was = fav.indexOf(id);
  if (was >= 0) fav[was] = fav[slot];
  fav[slot] = id; store.set(DOCK_KEY, JSON.stringify(fav));
  return fav;
}

/** A small rounded-square icon for an app (its tint and emoji). */
export const dockIcon = (a, extra = '') => el('span', { class: `dock-icon app-icon tint-${a.tint}${extra}`, 'aria-hidden': 'true', text: a.icon });

/**
 * The Dock, in `host` (the page's body): returns { draw(current app id) }. `apps`: the app list.
 */
export function mountDock(host, apps) {
  const nav = el('nav', { class: 'dock', id: 'dock', 'aria-label': 'Dock' });
  const picker = el('dialog', { class: 'dock-pick', 'aria-labelledby': 'dock-pick-title' });
  // (The logo at the bottom left: opens the Dock, closes it again; remembered for the app it's in.)
  const toggle = el('button', { type: 'button', class: 'dock-toggle', 'aria-controls': 'dock' }, el('img', { src: 'icons/icon.svg', alt: '', width: '22', height: '22' }));
  toggle.addEventListener('click', () => { setDockTucked(current, !dockTucked(current)); place(); window.dispatchEvent(new Event('cc-dock-mode')); });
  host.append(nav, toggle, picker);
  document.body.classList.add('has-dock');
  let current = '';

  /** Choose an app for Favorite `slot`. */
  function pick(slot) {
    const fav = dockFavorites(apps); const choices = dockChoices(apps);
    picker.replaceChildren(
      el('div', { class: 'dock-pick-head' }, el('h2', { id: 'dock-pick-title', text: `Favorite ${slot < 2 ? 'on the left' : 'on the right'}` }), el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', text: '✕', onclick: () => picker.close() })),
      el('p', { class: 'small muted', text: 'Tap an app to put it here.' }),
      el('div', { class: 'dock-pick-grid' }, choices.map((a) => el('button', { type: 'button', class: `dock-pick-app${fav[slot] === a.id ? ' on' : ''}`, 'aria-pressed': String(fav[slot] === a.id), onclick: () => { setFavorite(apps, slot, a.id); picker.close(); draw(current); window.dispatchEvent(new Event('cc-dock')); } }, dockIcon(a), el('span', { class: 'small', text: a.name })))));
    picker.showModal();
  }
  picker.addEventListener('click', (e) => { if (e.target === picker) picker.close(); });

  function favLink(id, slot) {
    const a = apps.find((x) => x.id === id);
    if (!a) return el('button', { type: 'button', class: 'dock-fav dock-empty', 'aria-label': 'Choose a Favorite', text: '＋', onclick: () => pick(slot) });
    const link = el('a', { class: `dock-fav${current === a.id ? ' on' : ''}`, href: a.href, 'aria-label': a.name, title: `${a.name} (hold to change)`, 'aria-current': current === a.id ? 'page' : null, 'data-slot': String(slot) }, dockIcon(a));
    // (Held down, or right-clicked: change it.)
    let t = 0; let held = false;
    const start = () => { held = false; clearTimeout(t); t = setTimeout(() => { held = true; navigator.vibrate?.(10); pick(slot); }, 550); };
    const stop = () => clearTimeout(t);
    link.addEventListener('pointerdown', start); link.addEventListener('pointerup', stop); link.addEventListener('pointerleave', stop); link.addEventListener('pointercancel', stop);
    link.addEventListener('click', (e) => { if (held) { e.preventDefault(); held = false; } });
    link.addEventListener('contextmenu', (e) => { e.preventDefault(); stop(); pick(slot); });
    return link;
  }

  /** The Dock open or tucked away, as this app keeps it. */
  function place() {
    const tucked = dockTucked(current);
    document.body.classList.toggle('dock-tucked', tucked);
    nav.setAttribute('aria-hidden', String(tucked)); nav.inert = tucked;
    toggle.setAttribute('aria-expanded', String(!tucked)); toggle.setAttribute('aria-label', tucked ? 'Show the Dock' : 'Hide the Dock'); toggle.title = tucked ? 'Show the Dock' : 'Hide the Dock';
  }

  function draw(cur = current) {
    current = cur; place();
    const fav = dockFavorites(apps);
    nav.replaceChildren(
      favLink(fav[0], 0), favLink(fav[1], 1),
      el('a', { class: `dock-home${!cur ? ' on' : ''}`, href: '#/', 'aria-label': 'Home', 'aria-current': !cur ? 'page' : null, onclick: () => { if (!cur) window.scrollTo({ top: 0, behavior: 'smooth' }); } }, el('img', { src: 'icons/icon.svg', alt: '', width: '28', height: '28' })),
      favLink(fav[2], 2), favLink(fav[3], 3));
  }

  // (The keyboard up: out of its way.)
  const typing = (t) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit'].includes(t.type);
  document.addEventListener('focusin', (e) => { if (typing(e.target)) document.body.classList.add('dock-typing'); });
  document.addEventListener('focusout', () => setTimeout(() => { if (!typing(document.activeElement)) document.body.classList.remove('dock-typing'); }, 50));

  draw('');
  return { draw, pick, place };
}
