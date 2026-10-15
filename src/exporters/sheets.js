// Optional Google Sheets exporter: appends one row per new item via the Sheets REST API.
// Auth: a Google service account (JSON key in the GOOGLE_SERVICE_ACCOUNT_JSON secret). Share the
// target spreadsheet with the service account's email (Editor). No Google SDK dependency.

import { createSign } from 'node:crypto';
import { ConfigError } from '../core/errors.js';
import { registerSecret } from '../core/redact.js';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function buildJwt(sa, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;
}

/** Row layout: timestamp, type, key, title, url, then the configured field columns. */
export function itemsToRows(items, columns) {
  return items.map((it) => [it.timestamp, it.type, it.key, it.title, it.url ?? '', ...columns.map((c) => {
    const v = it.fields?.[c];
    return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v;
  })]);
}

export async function exportToSheets({ cfg, items, log, env, fetchFn }) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new ConfigError('GOOGLE_SERVICE_ACCOUNT_JSON is not set (needed by the sheets exporter)');
  let sa;
  try { sa = JSON.parse(raw); } catch { throw new ConfigError('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON'); }
  registerSecret(sa.private_key);

  const tokenRes = await fetchFn(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: buildJwt(sa) }),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange failed: HTTP ${tokenRes.status}`);
  const { access_token: accessToken } = await tokenRes.json();
  registerSecret(accessToken);

  const range = encodeURIComponent(`${cfg.sheet}!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const rows = itemsToRows(items, cfg.columns);
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  });
  if (!res.ok) throw new Error(`Sheets append failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  log.info('exported to sheets', { rows: rows.length, sheet: cfg.sheet });
  return { rows: rows.length };
}
