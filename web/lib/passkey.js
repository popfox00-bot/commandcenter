// Passkeys (Face ID, Touch ID, a fingerprint, the phone's own screen lock) to open a locked part of the app
// (the hidden area, Socials) as well as its password: never instead of it, so the password still works and
// a passkey can be turned off any time. All on this device: the app has no server, so a passkey here proves
// that the phone's owner (Face ID) is present, as the password does, and nothing is sent anywhere.
//
// Where the passkey can give the app a secret of its own (the WebAuthn "prf" extension: iCloud Keychain on
// iOS 18 and later, Google Password Manager, Windows Hello…), that secret encrypts what the area needs its
// password for (Socials: the key to its copy in Drive), so Face ID alone opens it and it syncs. Without it,
// Face ID opens the area and its password is asked for only what needs it.
//
// Kept (localStorage `cc.passkey.<area>`): the passkey's id, and with prf the password encrypted (AES-GCM,
// with a key from the passkey's secret, which never leaves the passkey but at a Face ID check).

const enc = new TextEncoder(); const dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const keyOf = (area) => `cc.passkey.${area}`;

/** Whether this browser can do passkeys at all. */
export const passkeysSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials?.create && window.isSecureContext;

/** Whether this device has its own Face ID / fingerprint / screen-lock passkeys (false when unknown). */
export async function deviceCanPasskey() {
  if (!passkeysSupported()) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
}

function read(area) { try { const v = JSON.parse(localStorage.getItem(keyOf(area))); return v?.id ? v : null; } catch { return null; } }
/** The area's passkey as kept: { id, prf, salt, wrapped?, at } or null. */
export const passkeyOf = (area) => read(area);
export const hasPasskey = (area) => !!read(area);
/** Turn an area's passkey off (the passkey itself stays in the phone's passwords; it's just no longer used here). */
export function removePasskey(area) { try { localStorage.removeItem(keyOf(area)); } catch { /* private mode */ } }

async function aesFrom(prfOut) { return crypto.subtle.importKey('raw', new Uint8Array(prfOut).slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']); }
const prfResult = (cred) => cred?.getClientExtensionResults?.()?.prf?.results?.first ?? null;

/**
 * Make a passkey for `area` ("Command Center · <label>", in the phone's passwords) and keep it, with `secret`
 * (the area's password) encrypted by the passkey's own secret where the passkey can give one. Asks for Face ID.
 * Resolves to { prf: whether Face ID alone can give the password back }.
 */
export async function createPasskey(area, label, { secret = null } = {}) {
  if (!passkeysSupported()) throw new Error('This browser can\'t use passkeys.');
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: 'Command Center' },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: `command-center-${area}`, displayName: `Command Center · ${label}` },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
    timeout: 120000, attestation: 'none',
    extensions: { prf: { eval: { first: salt } } },
  } });
  if (!cred) throw new Error('No passkey was made.');
  const id = b64(cred.rawId);
  let out = prfResult(cred); let prfOk = !!cred.getClientExtensionResults?.()?.prf?.enabled || !!out;
  // (Some passkeys give their secret only when used, not when made: once more, now.)
  if (prfOk && !out && secret) { try { const g = await getWith(id, salt); out = prfResult(g); } catch { out = null; } }
  let wrapped = null;
  if (out && secret) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesFrom(out), enc.encode(secret)); wrapped = { iv: b64(iv), ct: b64(ct) }; }
  prfOk = !!wrapped || (prfOk && !secret);
  localStorage.setItem(keyOf(area), JSON.stringify({ v: 1, id, salt: b64(salt), prf: !!wrapped, wrapped, at: Date.now() }));
  return { prf: !!wrapped };
}

function getWith(id, salt) {
  return navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [{ type: 'public-key', id: unb64(id) }],
    userVerification: 'required', timeout: 120000,
    extensions: { prf: { eval: { first: salt } } },
  } });
}

/**
 * Open `area` with its passkey: asks for Face ID. Resolves to { ok: true, secret } (the password where the
 * passkey keeps it, else null), or { ok: false, reason }.
 */
export async function usePasskey(area) {
  const k = read(area); if (!k) return { ok: false, reason: 'No passkey is set up for this.' };
  let cred;
  try { cred = await getWith(k.id, unb64(k.salt)); } catch (e) { return { ok: false, reason: e?.name === 'NotAllowedError' ? 'Cancelled.' : (e?.message || 'Face ID didn\'t work.') }; }
  if (!cred) return { ok: false, reason: 'Cancelled.' };
  // (Only this area's passkey opens it.)
  if (b64(cred.rawId) !== k.id) return { ok: false, reason: 'That isn\'t this passkey.' };
  let secret = null;
  if (k.wrapped) {
    const out = prfResult(cred);
    if (out) { try { secret = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(k.wrapped.iv) }, await aesFrom(out), unb64(k.wrapped.ct))); } catch { secret = null; } }
  }
  return { ok: true, secret };
}
