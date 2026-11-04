// Command Center PWA shell: home screen of apps, hash routing, service worker updates.
// No build step; every module is plain ES modules served from this folder.

import { $, el, store } from './lib/dom.js';
import { APPS, redirect, homeApps, HOME_ORDER_KEY } from './apps/index.js';
import { setJobsActive } from './jobs.js';

const views = { home: $('#view-home'), app: $('#view-app'), jobs: $('#view-jobs') };
let mountedApp = null;

function renderHome() {
  $('#app-grid').replaceChildren(...homeApps(store.json(HOME_ORDER_KEY, null)).map((a) => el('a', { class: 'app-tile', href: a.href },
    el('span', { class: `app-icon tint-${a.tint}`, 'aria-hidden': 'true', text: a.icon }),
    el('span', { class: 'app-name', text: a.name }),
    el('span', { class: 'app-note muted', text: a.note }))));
}

async function route() {
  const moved = redirect(location.hash);
  if (moved) { location.replace(moved); return; }
  const [, section = ''] = (location.hash || '#/').split('/');
  const app = APPS.find((a) => a.id === section && a.load);
  const view = section === 'jobs' ? 'jobs' : app ? 'app' : 'home';
  if (view === 'home') renderHome(); // the order may have changed in Settings
  for (const [name, node] of Object.entries(views)) node.hidden = name !== view;
  $('#title').textContent = { home: 'Command Center', jobs: 'Jobs', app: app?.name }[view];
  $('#jobs-actions').hidden = view !== 'jobs';
  setJobsActive(view === 'jobs');

  if (mountedApp && (view !== 'app' || mountedApp.id !== app.id)) {
    mountedApp.unmount?.();
    mountedApp = null;
  }
  if (view === 'app' && !mountedApp) mountedApp = await mountInto($('#app-host'), app, app.id);
  if (view !== 'app') document.title = view === 'home' ? 'Command Center' : `${$('#title').textContent} · Command Center`;
  window.scrollTo(0, 0);
}

/** Load a tool/app module and mount it; returns { id, unmount } (unmount may be null). */
async function mountInto(host, entry, id) {
  host.replaceChildren(el('p', { class: 'muted center', text: 'Loading…' }));
  document.title = `${entry.name} · Command Center`;
  try {
    const mod = await entry.load();
    host.replaceChildren();
    const unmount = mod.mount(host);
    return { id, unmount: typeof unmount === 'function' ? unmount : null };
  } catch (err) {
    host.replaceChildren(el('p', { class: 'bad-text', text: `Could not load ${entry.name}: ${err.message}` }));
    return { id, unmount: null };
  }
}

renderHome();
window.addEventListener('hashchange', route);
route();

// Service worker: offline support and updates. A new version installs in the background and then
// waits. If it is ready before the user has touched anything (i.e. right after opening the app), it
// is applied at once; otherwise a "tap to reload" bar appears, so nobody loses work mid-task.
if ('serviceWorker' in navigator) {
  let interacted = false;
  let reloading = false;
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { interacted = true; }, { once: true, capture: true });

  const apply = (worker) => { reloading = true; worker.postMessage('skip-waiting'); };
  const offer = (reg) => {
    const waiting = reg.waiting;
    if (!waiting || !navigator.serviceWorker.controller) return; // first install: nothing to replace
    if (!interacted) { apply(waiting); return; }
    const bar = $('#update');
    bar.hidden = false;
    bar.onclick = () => apply(waiting);
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });

  navigator.serviceWorker.register('sw.js').then((reg) => {
    offer(reg); // an update may already be waiting from an earlier visit
    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      next?.addEventListener('statechange', () => { if (next.state === 'installed') offer(reg); });
    });
    // Home-screen apps stay alive in the background for days: check again whenever they return.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}

// Press and hold on a drawing surface (the photo editor, cutout, collage, draw, scan, PDF): no
// "copy / save image" menu and no text selection starting there, so a long press just draws, traces,
// patches or uses the wand.
const HOLD_SURFACES = '.ed-stage, .co-stage, .cl-canvas, .dr-stage, .scan-edit, .pw-page, .sig-pad, .ed-expand-preview, .no-hold-select';
const onSurface = (t) => (t?.nodeType === 1 ? t : t?.parentElement)?.closest?.(HOLD_SURFACES);
for (const type of ['contextmenu', 'selectstart']) document.addEventListener(type, (e) => { if (onSurface(e.target)) e.preventDefault(); });

// A thin scroll bar on the right edge for phones: on a page with a drawing surface (which takes every
// touch, so a swipe on the photo traces rather than scrolls), drag it (or tap along it) to scroll.
{
  const thumb = el('span', { class: 'scroll-thumb' });
  const rail = el('div', { class: 'scroll-rail', 'aria-hidden': 'true', hidden: true }, thumb);
  document.body.append(rail);
  const coarse = matchMedia('(pointer: coarse)');
  let raf = 0; let drag = null;
  const geometry = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    const th = Math.max(48, (innerHeight * innerHeight) / document.documentElement.scrollHeight);
    return { max, th, track: innerHeight - th };
  };
  const layout = () => {
    raf = 0;
    const { max, th, track } = geometry();
    const show = coarse.matches && max > 40 && !!document.querySelector(HOLD_SURFACES);
    rail.hidden = !show;
    if (!show) return;
    thumb.style.height = `${th}px`;
    thumb.style.transform = `translateY(${max ? (scrollY / max) * track : 0}px)`;
  };
  const soon = () => { if (!raf) raf = requestAnimationFrame(layout); };
  addEventListener('scroll', soon, { passive: true });
  addEventListener('resize', soon);
  coarse.addEventListener?.('change', soon);
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
  const scrollFor = (y) => { const { max, track } = geometry(); scrollTo(0, track > 0 ? Math.max(0, Math.min(1, (y - drag.offset) / track)) * max : 0); };
  rail.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    rail.setPointerCapture(e.pointerId);
    const r = thumb.getBoundingClientRect();
    // On the thumb: it moves with the finger from where it was held. On the track: it jumps there.
    drag = { offset: e.clientY >= r.top && e.clientY <= r.bottom ? e.clientY - r.top : r.height / 2 };
    rail.classList.add('active');
    scrollFor(e.clientY);
  });
  rail.addEventListener('pointermove', (e) => { if (drag) scrollFor(e.clientY); });
  const end = () => { drag = null; rail.classList.remove('active'); };
  rail.addEventListener('pointerup', end);
  rail.addEventListener('pointercancel', end);
  soon();
}
