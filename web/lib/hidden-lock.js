// The hidden area's password: set once on this phone, then asked for each time it's opened. Only a salted
// hash of it is kept (PBKDF2-SHA-256 with a random salt, many rounds), never the password itself. Opened
// once, it stays open until this tab is closed (session storage) or it's locked again. A few wrong tries
// in a row: a short wait before the next.

const KEY = 'cc.hidden.lock';
const OPEN = 'cc.hidden.open';
const ROUNDS = 210_000;

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, rounds = ROUNDS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256));
}

const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v?.salt && v?.hash ? v : null; } catch { return null; } };

/** Whether a password has been set on this phone. */
export const hasPassword = () => !!read();
/** Whether it's open in this tab. */
export const isOpen = () => { try { return sessionStorage.getItem(OPEN) === '1'; } catch { return false; } };
export function lock() { try { sessionStorage.removeItem(OPEN); } catch { /* private mode */ } }
function open() { try { sessionStorage.setItem(OPEN, '1'); } catch { /* private mode */ } }

/** The password set (4 characters at least), and the area opened. */
export async function setPassword(password) {
  if (String(password).length < 4) throw new Error('Use at least 4 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  localStorage.setItem(KEY, JSON.stringify({ v: 1, salt: b64(salt), hash: b64(hash), rounds: ROUNDS }));
  open();
}

let fails = 0; let waitUntil = 0;
/** Seconds to wait before another try (0: none). */
export const waitLeft = (now = Date.now()) => Math.max(0, Math.ceil((waitUntil - now) / 1000));

/** Whether `password` is the one set; right: the area opened. */
export async function tryPassword(password, now = Date.now()) {
  if (waitLeft(now)) return false;
  const v = read(); if (!v) return false;
  const got = await derive(String(password), unb64(v.salt), v.rounds ?? ROUNDS);
  const want = unb64(v.hash);
  let diff = got.length ^ want.length; for (let i = 0; i < Math.min(got.length, want.length); i++) diff |= got[i] ^ want[i];
  if (diff === 0) { fails = 0; open(); return true; }
  // (Five wrong in a row: 30 seconds before the next try.)
  if (++fails >= 5) { fails = 0; waitUntil = now + 30_000; }
  return false;
}

/** The order of Photo Editor switches that leads to it. */
export const SEQUENCE = ['cutout', 'photo', 'collage', 'photo', 'cutout', 'collage', 'cutout'];

/**
 * A watcher of the taps on those switches: `tap(tab, now)` true when the last taps (within 20 seconds of the
 * first of them) are the sequence.
 */
export function sequenceWatcher(seq = SEQUENCE, within = 20_000) {
  let taps = [];
  return (tab, now = Date.now()) => {
    taps = [...taps, { tab, at: now }].slice(-seq.length);
    const hit = taps.length === seq.length && taps.every((t, i) => t.tab === seq[i]) && now - taps[0].at <= within;
    if (hit) taps = [];
    return hit;
  };
}
