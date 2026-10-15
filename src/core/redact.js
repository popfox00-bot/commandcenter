// Redaction for anything that is logged or persisted. Two layers:
//  1. Known secret values (registered from env at startup) are masked wherever they appear.
//  2. Sensitive-looking URL params, header names, and object keys are masked by name.

// Long names match anywhere ("x-api-key", "githubToken"); short ones only as a whole word or segment
// ("code", "sig") so that keys like "zipCode" or "statusCode" are not masked.
const SENSITIVE_LONG = /(token|secret|passw(or)?d|api[-_]?key|apikey|authorization|cookie|session|signature|credential|private[-_]?key|access[-_]?key|jwt|bearer)/i;
const SENSITIVE_SHORT = /(^|[-_.])(auth|code|otp|sig|pwd|key)$/i;
const SENSITIVE_NAME = { test: (name) => SENSITIVE_LONG.test(name) || SENSITIVE_SHORT.test(name) };
const MASK = '[REDACTED]';

const secretValues = new Set();

/** Register a secret value to be masked everywhere. Values shorter than 6 chars are ignored (too collision-prone). */
export function registerSecret(value) {
  if (typeof value === 'string' && value.length >= 6) secretValues.add(value);
}

/**
 * Register env values that are secrets: our own secret names, job secrets (JOB_*), and any var
 * with a sensitive-looking name. Values that look like paths or booleans are skipped so that
 * e.g. a *_SESSION_DIR variable doesn't mask every file path in the logs.
 */
const KNOWN_SECRET_ENV = /^(NTFY_TOPIC|NTFY_TOKEN|CC_INGEST_SECRET|CC_API_TOKEN|GH_DISPATCH_TOKEN|GITHUB_TOKEN|GOOGLE_SERVICE_ACCOUNT_JSON|CC_CONFIG_YAML|JOB_[A-Z0-9_]+)$/;
export function registerSecretsFromEnv(env = process.env, extraNames = []) {
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string' || value.length < 6) continue;
    const known = KNOWN_SECRET_ENV.test(name) || extraNames.includes(name);
    const looksLikeSetting = /^(\/|\.\/|~|true$|false$|https?:\/\/[^/?#]*\/?$)/i.test(value);
    if (known || (SENSITIVE_NAME.test(name) && !looksLikeSetting)) registerSecret(value);
  }
}

export function clearRegisteredSecrets() {
  secretValues.clear();
}

export function isSensitiveName(name) {
  return SENSITIVE_NAME.test(name);
}

function maskKnownSecrets(str) {
  let out = str;
  for (const s of secretValues) {
    if (out.includes(s)) out = out.split(s).join(MASK);
  }
  return out;
}

/** Mask sensitive query params and userinfo in every URL found in a string. */
export function redactUrlsInString(str) {
  return str.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (match) => redactUrl(match));
}

export function redactUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return raw; }
  if (url.username || url.password) { url.username = 'REDACTED'; url.password = ''; }
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_NAME.test(key)) url.searchParams.set(key, MASK);
  }
  // URLSearchParams re-encodes the mask; keep it readable.
  return url.toString().replaceAll(encodeURIComponent(MASK), MASK);
}

export function redactString(str) {
  return maskKnownSecrets(redactUrlsInString(str));
}

/** Deep-redact any JSON-like value. Returns a new value; never mutates input. */
export function redact(value, depth = 0) {
  if (depth > 12) return '[TRUNCATED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), kind: value.kind };
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_NAME.test(k) && v !== null && typeof v !== 'object' && typeof v !== 'boolean' ? MASK : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
