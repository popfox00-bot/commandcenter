// The Vault's password (the area once called hidden; its keys keep that name): set once on this phone, then asked for each time it's opened. Only a salted
// hash of it is kept (PBKDF2-SHA-256 with a random salt, many rounds), never the password itself. Opened
// once, it stays open until this tab is closed (session storage) or it's locked again. A few wrong tries
// in a row: a short wait before the next.

const ROUNDS = 210_000;

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, rounds = ROUNDS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256));
}

/**
 * A password lock kept under `key` (localStorage: its salted hash), open in this tab while `openKey`
 * (sessionStorage) says so. The hidden area's is one; Socials has its own.
 */
export function makeLock(key, openKey) {
  const read = () => { try { const v = JSON.parse(localStorage.getItem(key)); return v?.salt && v?.hash ? v : null; } catch { return null; } };
  const open = () => { try { sessionStorage.setItem(openKey, '1'); } catch { /* private mode */ } };
  let fails = 0; let waitUntil = 0;
  const waitLeft = (now = Date.now()) => Math.max(0, Math.ceil((waitUntil - now) / 1000));
  return {
    /** Whether a password has been set on this phone. */
    hasPassword: () => !!read(),
    /** Whether it's open in this tab. */
    isOpen: () => { try { return sessionStorage.getItem(openKey) === '1'; } catch { return false; } },
    lock: () => { try { sessionStorage.removeItem(openKey); } catch { /* private mode */ } },
    /** Opened by its passkey (Face ID: web/lib/passkey.js) instead of the password. */
    openWithPasskey: () => open(),
    /** The password set (4 characters at least), and the lock opened. */
    async setPassword(password) {
      if (String(password).length < 4) throw new Error('Use at least 4 characters.');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await derive(password, salt);
      localStorage.setItem(key, JSON.stringify({ v: 1, salt: b64(salt), hash: b64(hash), rounds: ROUNDS }));
      open();
    },
    /** Seconds to wait before another try (0: none). */
    waitLeft,
    /** Whether `password` is the one set; right: the lock opened. */
    async tryPassword(password, now = Date.now()) {
      if (waitLeft(now)) return false;
      const v = read(); if (!v) return false;
      const got = await derive(String(password), unb64(v.salt), v.rounds ?? ROUNDS);
      const want = unb64(v.hash);
      let diff = got.length ^ want.length; for (let i = 0; i < Math.min(got.length, want.length); i++) diff |= got[i] ^ want[i];
      if (diff === 0) { fails = 0; open(); return true; }
      // (Five wrong in a row: 30 seconds before the next try.)
      if (++fails >= 5) { fails = 0; waitUntil = now + 30_000; }
      return false;
    },
  };
}

const hidden = makeLock('cc.hidden.lock', 'cc.hidden.open');
export const { hasPassword, isOpen, lock, setPassword, waitLeft, tryPassword, openWithPasskey } = hidden;
