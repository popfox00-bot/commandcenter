// @ts-check
// Diagnostics: what loaded, how long things took, and what went wrong, kept on this phone (the last few
// errors in local storage, so they're still there after the app is closed), and shown in Settings →
// Diagnostics. Nothing leaves the phone. Where a step fails and the app carries on without it (a model
// that didn't load, the worker that wasn't there), it's noted here rather than lost.

const KEY = 'cc.diag.errors';
const MAX = 20;

/** @type {Map<string, { status: 'loading' | 'ready' | 'failed', ms?: number, error?: string }>} */
const models = new Map();
/** @type {Map<string, { at: number, steps: Record<string, number> }>} */
const timings = new Map();
/** @type {Set<() => void>} */
const listeners = new Set();
const changed = () => { for (const fn of listeners) { try { fn(); } catch { /* a view gone */ } } };

const store = {
  read() { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } },
  write(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch { /* storage off (a private window) */ } },
};

/**
 * A model (or anything) being loaded: noted as loading, then ready (with how long it took) or failed (with
 * why). The same promise back. @template T @param {string} name @param {Promise<T>} promise @returns {Promise<T>}
 */
export function trackLoad(name, promise) {
  const t0 = performance.now();
  models.set(name, { status: 'loading' }); changed();
  promise.then(
    () => { models.set(name, { status: 'ready', ms: Math.round(performance.now() - t0) }); changed(); },
    (err) => { models.set(name, { status: 'failed', ms: Math.round(performance.now() - t0), error: String(err?.message ?? err) }); noteError(`Loading ${name}`, err); },
  );
  return promise;
}

/** Something that went wrong where the app carried on without it. @param {string} where @param {unknown} err */
export function noteError(where, err) {
  const e = /** @type {any} */ (err);
  const list = store.read();
  list.push({ at: Date.now(), where, message: String(e?.message ?? e), stack: typeof e?.stack === 'string' ? e.stack.split('\n').slice(0, 4).join('\n') : undefined });
  store.write(list);
  changed();
}

/** How long each step of something took (ms). @param {string} what @param {Record<string, number>} steps */
export function noteTimings(what, steps) {
  timings.set(what, { at: Date.now(), steps: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, Math.round(v)])) });
  changed();
}

/** Time `fn` (sync or async) as one step of `what`. @template T @param {string} what @param {string} step @param {() => T} fn @returns {T} */
export function timed(what, step, fn) {
  const t0 = performance.now();
  const add = () => { const cur = timings.get(what)?.steps ?? {}; noteTimings(what, { ...cur, [step]: performance.now() - t0 }); };
  const r = fn();
  if (r && typeof (/** @type {any} */ (r)).then === 'function') /** @type {any} */ (r).then(add, add); else add();
  return r;
}

/** Everything noted so far. */
export function snapshot() {
  return { models: [...models].map(([name, m]) => ({ name, ...m })), timings: [...timings].map(([what, t]) => ({ what, ...t })), errors: store.read() };
}

/** Forget the errors kept. */
export function clearErrors() { store.write([]); changed(); }

/** Called whenever something new is noted; returns how to stop. @param {() => void} fn */
export function onDiag(fn) { listeners.add(fn); return () => listeners.delete(fn); }
