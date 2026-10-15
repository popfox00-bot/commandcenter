// HMAC-SHA256 request signing for runner -> Worker write-back. Web Crypto only, so it runs in
// both Node 22 and Workers. The signed string binds method, path, timestamp and body, and the
// Worker rejects timestamps outside a 5-minute window to limit replay.

export const SIGNATURE_HEADER = 'x-cc-signature';
export const TIMESTAMP_HEADER = 'x-cc-timestamp';
export const MAX_SKEW_MS = 5 * 60 * 1000;

const enc = new TextEncoder();

async function key(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

export function canonical({ method, path, timestamp, body }) {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${body ?? ''}`;
}

export async function sign(secret, parts) {
  return toHex(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(canonical(parts))));
}

/** Constant-time verification (crypto.subtle.verify). Returns { ok, reason }. */
export async function verify(secret, { method, path, timestamp, body, signature, now = Date.now() }) {
  if (!secret) return { ok: false, reason: 'server has no ingest secret configured' };
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return { ok: false, reason: 'missing or malformed signature' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) return { ok: false, reason: 'timestamp outside allowed window' };
  const ok = await crypto.subtle.verify('HMAC', await key(secret), fromHex(signature), enc.encode(canonical({ method, path, timestamp, body })));
  return ok ? { ok: true } : { ok: false, reason: 'bad signature' };
}
