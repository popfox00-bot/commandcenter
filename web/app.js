// Command Center PWA shell: home screen of apps, hash routing, service worker updates.
// No build step; every module is plain ES modules served from this folder.

import { $, el, store } from './lib/dom.js';
import { APPS, FILES_APPS, redirect, homeApps, HOME_ORDER_KEY } from './apps/index.js';
import { setJobsActive } from './jobs.js';
import { VERSION, HISTORY } from './version.js';

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
  // An app inside another (Files' Photo Editor…, Magic's Downloads…): its own name, and back to
  // the one it's in.
  const tab = (location.hash || '').split('/')[2] ?? '';
  const inFiles = app?.id === 'files' ? FILES_APPS.find((f) => f.tabs.includes(tab)) : null;
  const parent = app?.parent ? APPS.find((a) => a.id === app.parent) : null;
  const back = $('#view-app .back');
  if (inFiles) { back.href = '#/files'; back.textContent = '‹ Files'; } else if (parent) { back.href = parent.href; back.textContent = `‹ ${parent.name}`; } else { back.href = '#/'; back.textContent = '‹ Home'; }
  $('#title').textContent = { home: 'Command Center', jobs: 'Jobs', app: inFiles?.name ?? app?.name }[view];
  $('#jobs-actions').hidden = view !== 'jobs';
  $('#version').hidden = view !== 'home';
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

// The version, small at the top right of the home screen; tap it for what changed in each.
$('#version').textContent = `v${VERSION}`;
$('#version').setAttribute('aria-label', `Version ${VERSION}: what's new`);
$('#version').addEventListener('click', () => {
  const d = $('#versions');
  d.replaceChildren(
    el('div', { class: 'versions-head' }, el('h2', { id: 'versions-title', text: 'Version history' }),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => d.close() })),
    el('ol', { class: 'versions-list' }, ...HISTORY.map((h) => el('li', { class: h.v === VERSION ? 'current' : '' },
      el('div', { class: 'versions-row' }, el('strong', { text: `v${h.v}` }), el('span', { class: 'small muted', text: new Date(`${h.date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) }), h.v === VERSION ? el('span', { class: 'small versions-now', text: 'This version' }) : null),
      el('p', { class: 'small', text: h.notes })))));
  d.showModal();
});
$('#versions').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

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
// touch, so a swipe on the photo traces rather than scrolls), slide along it to scroll. It glides: the
// page moves about as far as the finger does (never more than 2.5× it on a long page), eased frame by
// frame, and a tap doesn't jump. While it shows, the page leaves its strip clear (nothing under it).
{
  const thumb = el('span', { class: 'scroll-thumb' });
  const rail = el('div', { class: 'scroll-rail', 'aria-hidden': 'true', hidden: true }, thumb);
  document.body.append(rail);
  const coarse = matchMedia('(pointer: coarse)');
  let raf = 0; let drag = null; let glide = 0;
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
    document.body.classList.toggle('has-rail', show);
    if (!show) return;
    thumb.style.height = `${th}px`;
    thumb.style.transform = `translateY(${max ? (scrollY / max) * track : 0}px)`;
  };
  const soon = () => { if (!raf) raf = requestAnimationFrame(layout); };
  addEventListener('scroll', soon, { passive: true });
  addEventListener('resize', soon);
  coarse.addEventListener?.('change', soon);
  new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
  // Eased toward where the finger says, a little each frame (smooth, never a jump).
  const step = () => {
    glide = 0;
    if (!drag) return;
    const d = drag.target - scrollY;
    if (Math.abs(d) < 0.5) { if (drag.released) drag = null; return; }
    scrollTo(0, scrollY + d * 0.35);
    glide = requestAnimationFrame(step);
  };
  rail.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    rail.setPointerCapture(e.pointerId);
    const { max, track } = geometry();
    // How far the page goes per pixel the finger moves: the thumb's own pace, but at most 2.5×.
    drag = { y: e.clientY, from: scrollY, gain: Math.max(1, Math.min(2.5, track > 0 ? max / track : 1)), target: scrollY, max };
    rail.classList.add('active');
  });
  rail.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.target = Math.max(0, Math.min(drag.max, drag.from + (e.clientY - drag.y) * drag.gain));
    if (!glide) glide = requestAnimationFrame(step);
  });
  // Let go: it glides the rest of the way there.
  const end = () => { if (drag) { drag.released = true; if (!glide) glide = requestAnimationFrame(step); } rail.classList.remove('active'); };
  rail.addEventListener('pointerup', end);
  rail.addEventListener('pointercancel', end);
  soon();
}
