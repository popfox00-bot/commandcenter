// Clock (Productivity): World Clock, Timer and Stopwatch.
// - World Clock: the time in your places, the first one big at the top (Colorado to start), the others in two
//   columns below (California, New York, Hawaii, London, Germany, Romania to start), each with its day and how
//   far it is from the first. + Add New adds a place (search a state, country, city or any time zone); Edit
//   reorders them (drag ☰), changes one (tap its name) or takes it off (✕). Kept on this phone.
// - Timer: hours, minutes and seconds (or a preset), counted down; it rings (a tone and a buzz) while the app is
//   open. It keeps counting if you leave the Clock.
// - Stopwatch: start, stop, laps (the fastest and slowest marked), reset; it keeps running if you leave.

import { el, fill, store } from '../../lib/dom.js';
import { DEFAULT_CLOCKS, searchPlaces, partsIn, offsetMin, diffLabel, dayLabel, hm12, validZone } from '../../lib/places.js';
import { dragHandle, sortable, moved } from '../../lib/drag-sort.js';
import { sceneOf, skyOf, sceneSvg } from './scenes.js';

const PLACES_KEY = 'cc.clock.places';
const TIMER_KEY = 'cc.clock.timer';
const SW_KEY = 'cc.clock.stopwatch';
const TAB_KEY = 'cc.clock.tab';

/** The places kept (or the defaults): [{ name, zone }]. */
export function loadPlaces() {
  const v = store.json(PLACES_KEY, null);
  const ok = Array.isArray(v) ? v.filter((p) => p && typeof p.name === 'string' && validZone(p.zone)) : null;
  return ok && ok.length ? ok : DEFAULT_CLOCKS.map((p) => ({ ...p }));
}
const savePlaces = (l) => store.set(PLACES_KEY, JSON.stringify(l));

/** Milliseconds as a stopwatch shows them: "01:02.34", "1:01:02.34" from an hour on. */
export function swText(ms) {
  const cs = Math.floor(ms / 10) % 100; const s = Math.floor(ms / 1000) % 60; const m = Math.floor(ms / 60000) % 60; const h = Math.floor(ms / 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${h ? `${h}:${p(m)}` : p(m)}:${p(s)}.${p(cs)}`;
}
/** Seconds left as a timer shows them: "4:05", "1:02:03". */
export function timerText(sec) {
  const s = Math.max(0, Math.ceil(sec)); const h = Math.floor(s / 3600); const m = Math.floor(s / 60) % 60; const ss = s % 60; const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

export function mount(host) {
  let tab = store.get(TAB_KEY) || 'world';
  let places = loadPlaces();
  let editing = false; let picking = null; // null | { replace: index } | { add: true }
  const tabs = el('div', { class: 'ck-tabs', role: 'tablist', 'aria-label': 'Clock' });
  const body = el('div', { class: 'ck-body' });
  let tick = 0;

  // ---- World Clock
  function world() {
    const now = Date.now(); const first = places[0];
    const top = el('div', { class: 'ck-bar' },
      el('button', { type: 'button', class: 'btn small', text: editing ? 'Done' : 'Edit', 'aria-pressed': String(editing), onclick: () => { editing = !editing; picking = null; draw(); } }),
      el('button', { type: 'button', class: 'btn small primary', text: '+ Add New', onclick: () => { picking = { add: true }; draw(); } }));
    if (picking) return el('div', {}, top, picker());
    if (editing) {
      const list = el('ul', { class: 'ck-edit', 'aria-label': 'Your places: drag ☰ to reorder' }, places.map((p, i) => el('li', { class: 'ck-edit-row' },
        dragHandle(p.name),
        el('button', { type: 'button', class: 'ck-edit-name', 'aria-label': `Change ${p.name}`, onclick: () => { picking = { replace: i }; draw(); } }, el('strong', { text: p.name }), el('span', { class: 'small muted', text: ` ${p.zone.replace(/_/g, ' ')}` })),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${p.name}`, text: '✕', disabled: places.length < 2, onclick: () => { places = places.filter((_, j) => j !== i); savePlaces(places); draw(); } }))));
      sortable(list, (from, to) => { places = moved(places, from, to); savePlaces(places); draw(); });
      return el('div', {}, top, el('p', { class: 'small muted', text: 'Drag ☰ to reorder (the first is the big one), tap a name to change it, ✕ to remove.' }), list);
    }
    const card = (p, big) => {
      const pt = partsIn(p.zone, now);
      const sub = big ? `${pt.wd}, ${new Date(Date.UTC(pt.y, pt.mo - 1, pt.d)).toLocaleDateString([], { timeZone: 'UTC', month: 'long', day: 'numeric' })}` : `${dayLabel(p.zone, first.zone, now)}, ${diffLabel(offsetMin(p.zone, now) - offsetMin(first.zone, now))}`;
      const [t, ap] = hm12(pt).split(' ');
      // (Its picture behind it, the sky as it is there now; the time over a shade, white.)
      const scene = el('div', { class: 'ck-scene', 'data-sky': skyOf(pt.h) }); scene.innerHTML = sceneSvg(sceneOf(p), skyOf(pt.h));
      return el('div', { class: `ck-card${big ? ' ck-big' : ''}`, 'data-zone': p.zone, 'data-scene': sceneOf(p) }, scene, el('div', { class: 'ck-shade', 'aria-hidden': 'true' }),
        el('div', { class: 'ck-name', text: p.name }),
        el('div', { class: 'ck-time' }, el('span', { class: 'ck-hm', text: t }), big ? el('span', { class: 'ck-sec', text: `:${String(pt.s).padStart(2, '0')}` }) : null, el('span', { class: 'ck-ap', text: ap })),
        el('div', { class: 'ck-sub small muted', text: sub }));
    };
    return el('div', {}, top, card(first, true), el('div', { class: 'ck-grid' }, places.slice(1).map((p) => card(p, false))));
  }

  function picker() {
    const q = el('input', { type: 'search', class: 'ck-search', placeholder: 'Search a state, country, city or time zone', 'aria-label': 'Search places', autocomplete: 'off' });
    const res = el('ul', { class: 'ck-results' });
    const show = () => fill(res, searchPlaces(q.value, 20).map((p) => el('li', {}, el('button', { type: 'button', class: 'ck-result', onclick: () => {
      if (picking.replace != null) places[picking.replace] = p; else places.push(p);
      savePlaces(places); picking = null; draw();
    } }, el('strong', { text: p.name }), el('span', { class: 'small muted', text: ` ${p.zone.replace(/_/g, ' ')} · ${hm12(partsIn(p.zone, Date.now()))}` })))));
    q.addEventListener('input', show); show();
    requestAnimationFrame(() => q.focus());
    return el('section', { class: 'card' },
      el('div', { class: 'ck-bar' }, el('strong', { text: picking.replace != null ? `Change ${places[picking.replace].name}` : 'Add a place' }), el('button', { type: 'button', class: 'btn small', text: 'Cancel', onclick: () => { picking = null; draw(); } })),
      q, res);
  }

  // ---- Timer
  let timer = store.json(TIMER_KEY, null); // { end, total } running | { left, total } paused | null
  let ringing = null;
  const saveTimer = () => store.set(TIMER_KEY, JSON.stringify(timer ?? null));
  const left = () => (timer ? (timer.end ? (timer.end - Date.now()) / 1000 : timer.left) : 0);
  function ring() {
    if (ringing) return;
    try { navigator.vibrate?.([400, 200, 400, 200, 400]); } catch { /* none */ }
    let ctx = null; try { ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)(); } catch { ctx = null; }
    let n = 0; const beep = () => { if (!ctx || n++ > 20) return; const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = n % 2 ? 880 : 660; g.gain.value = 0.2; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25); };
    beep(); ringing = { ctx, iv: setInterval(beep, 600) };
  }
  const stopRing = () => { if (!ringing) return; clearInterval(ringing.iv); try { ringing.ctx?.close(); } catch { /* none */ } ringing = null; };
  let pick = store.json('cc.clock.pick', { h: 0, m: 5, s: 0 });
  function timerView() {
    if (!timer) {
      const num = (k, label, max) => { const i = el('input', { type: 'number', class: 'ck-num', min: '0', max: String(max), inputmode: 'numeric', value: String(pick[k]), 'aria-label': label }); i.addEventListener('input', () => { pick[k] = Math.max(0, Math.min(max, Math.floor(Number(i.value) || 0))); store.set('cc.clock.pick', JSON.stringify(pick)); }); return el('label', { class: 'ck-num-wrap' }, i, el('span', { class: 'small muted', text: label })); };
      const start = (sec) => { if (sec <= 0) return; timer = { end: Date.now() + sec * 1000, total: sec }; saveTimer(); draw(); };
      return el('section', { class: 'card ck-timer' },
        el('div', { class: 'ck-nums' }, num('h', 'hours', 23), num('m', 'min', 59), num('s', 'sec', 59)),
        el('div', { class: 'chips ck-presets' }, [1, 3, 5, 10, 15, 30, 60].map((m) => el('button', { type: 'button', class: 'chip', text: m < 60 ? `${m} min` : '1 hour', onclick: () => start(m * 60) }))),
        el('button', { type: 'button', class: 'btn primary block ck-go', text: 'Start', onclick: () => start(pick.h * 3600 + pick.m * 60 + pick.s) }),
        el('p', { class: 'small muted', text: 'It rings while the app is open (the phone can\'t let a web app ring when it\'s locked or closed).' }));
    }
    const l = left(); const done = l <= 0;
    if (done && !ringing) ring();
    const R = 90; const C = 2 * Math.PI * R; const frac = timer.total ? Math.max(0, l) / timer.total : 0;
    const svgNS = 'http://www.w3.org/2000/svg';
    const ringSvg = document.createElementNS(svgNS, 'svg'); ringSvg.setAttribute('viewBox', '0 0 200 200'); ringSvg.setAttribute('class', 'ck-ring'); ringSvg.setAttribute('aria-hidden', 'true');
    const c1 = document.createElementNS(svgNS, 'circle'); for (const [k, v] of Object.entries({ cx: 100, cy: 100, r: R, class: 'ck-ring-track' })) c1.setAttribute(k, v);
    const c2 = document.createElementNS(svgNS, 'circle'); for (const [k, v] of Object.entries({ cx: 100, cy: 100, r: R, class: 'ck-ring-fill', 'stroke-dasharray': `${C * frac} ${C}`, transform: 'rotate(-90 100 100)' })) c2.setAttribute(k, v);
    ringSvg.append(c1, c2);
    return el('section', { class: 'card ck-timer' },
      el('div', { class: 'ck-ring-wrap' }, ringSvg, el('div', { class: 'ck-left', role: 'timer', 'aria-live': 'off', text: done ? 'Time\'s up' : timerText(l) })),
      el('div', { class: 'ck-btns' },
        done ? el('button', { type: 'button', class: 'btn primary', text: 'Stop', onclick: () => { stopRing(); timer = null; saveTimer(); draw(); } })
          : el('button', { type: 'button', class: 'btn', text: timer.end ? 'Pause' : 'Resume', onclick: () => { timer = timer.end ? { left: left(), total: timer.total } : { end: Date.now() + timer.left * 1000, total: timer.total }; saveTimer(); draw(); } }),
        done ? null : el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => { timer = null; saveTimer(); draw(); } })));
  }

  // ---- Stopwatch
  let sw = store.json(SW_KEY, null) ?? { start: 0, before: 0, laps: [] }; // laps: lap lengths (ms)
  const saveSw = () => store.set(SW_KEY, JSON.stringify(sw));
  const elapsed = () => sw.before + (sw.start ? Date.now() - sw.start : 0);
  function stopwatchView() {
    const running = !!sw.start; const t = elapsed();
    const lapsSum = sw.laps.reduce((a, b) => a + b, 0);
    const best = sw.laps.length > 1 ? Math.min(...sw.laps) : null; const worst = sw.laps.length > 1 ? Math.max(...sw.laps) : null;
    return el('section', { class: 'card ck-sw' },
      el('div', { class: 'ck-sw-time', role: 'timer', text: swText(t) }),
      el('div', { class: 'ck-btns' },
        el('button', { type: 'button', class: 'btn', text: running ? 'Lap' : 'Reset', disabled: !running && !t, onclick: () => { if (running) sw.laps.push(elapsed() - lapsSum); else sw = { start: 0, before: 0, laps: [] }; saveSw(); draw(); } }),
        el('button', { type: 'button', class: `btn ${running ? 'danger' : 'primary'}`, text: running ? 'Stop' : 'Start', onclick: () => { if (running) sw = { ...sw, before: elapsed(), start: 0 }; else sw = { ...sw, start: Date.now() }; saveSw(); draw(); } })),
      t ? el('ol', { class: 'ck-laps', reversed: true },
        el('li', { class: 'ck-lap' }, el('span', { text: `Lap ${sw.laps.length + 1}` }), el('span', { class: 'ck-lap-now', text: swText(t - lapsSum) })),
        [...sw.laps].map((l, i) => [l, i]).reverse().map(([l, i]) => el('li', { class: `ck-lap${l === best ? ' ck-best' : l === worst ? ' ck-worst' : ''}` }, el('span', { text: `Lap ${i + 1}` }), el('span', { text: swText(l) })))) : null);
  }

  // ---- Updating: the world clock each second, the timer and stopwatch more often (text only).
  function update() {
    if (tab === 'world' && !editing && !picking) {
      const now = Date.now();
      for (const c of body.querySelectorAll('.ck-card')) {
        const z = c.dataset.zone; const pt = partsIn(z, now); const [t, ap] = hm12(pt).split(' ');
        c.querySelector('.ck-hm').textContent = t; c.querySelector('.ck-ap').textContent = ap;
        const s = c.querySelector('.ck-sec'); if (s) s.textContent = `:${String(pt.s).padStart(2, '0')}`;
        // (Its sky turning with the time there: night, sunrise, day, sunset.)
        const sc = c.querySelector('.ck-scene'); const sky = skyOf(pt.h); if (sc && sc.dataset.sky !== sky) { sc.dataset.sky = sky; sc.innerHTML = sceneSvg(c.dataset.scene, sky); }
      }
    } else if (tab === 'timer' && timer) {
      const l = left();
      if (l <= 0 && !ringing) { draw(); return; }
      const e = body.querySelector('.ck-left'); if (e && l > 0) e.textContent = timerText(l);
      const f = body.querySelector('.ck-ring-fill'); if (f && timer.total) { const C = 2 * Math.PI * 90; f.setAttribute('stroke-dasharray', `${C * Math.max(0, l) / timer.total} ${C}`); }
    } else if (tab === 'stopwatch' && sw.start) {
      const e = body.querySelector('.ck-sw-time'); if (e) e.textContent = swText(elapsed());
      const n = body.querySelector('.ck-lap-now'); if (n) n.textContent = swText(elapsed() - sw.laps.reduce((a, b) => a + b, 0));
    }
  }

  function draw() {
    fill(tabs, [['world', '🌎', 'World Clock'], ['timer', '⏲️', 'Timer'], ['stopwatch', '⏱️', 'Stopwatch']].map(([id, icon, label]) => el('button', { type: 'button', role: 'tab', 'aria-label': label, class: `ck-seg${tab === id ? ' on' : ''}`, 'aria-selected': String(tab === id), onclick: () => { tab = id; store.set(TAB_KEY, id); editing = false; picking = null; draw(); } }, el('span', { class: 'ck-seg-ic', 'aria-hidden': 'true', text: icon }), el('span', { class: 'ck-seg-tx', text: label }))));
    fill(body, tab === 'timer' ? timerView() : tab === 'stopwatch' ? stopwatchView() : world());
  }

  host.append(el('div', { class: 'ck' }, tabs, body));
  draw();
  tick = setInterval(update, 50);
  return () => { clearInterval(tick); stopRing(); };
}
