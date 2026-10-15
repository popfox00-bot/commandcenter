import { ItemError } from './errors.js';

const MAX_KEY = 256;
const MAX_TITLE = 500;
const MAX_FIELDS_BYTES = 8192;

/**
 * Normalize and validate the items a job returns. The contract is
 * { key, title, url, fields, timestamp } plus an optional `type` (default "match") that lets
 * one job emit several alert kinds (e.g. a "match" and an "ending_soon" alert) under the same
 * dedupe and notification machinery.
 */
export function normalizeItems(raw, { now, jobId }) {
  if (!Array.isArray(raw)) throw new ItemError(`${jobId}: run(ctx) must return an array of items, got ${typeof raw}`);
  const seen = new Set();
  const out = [];
  raw.forEach((it, i) => {
    const where = `${jobId} item[${i}]`;
    if (!it || typeof it !== 'object') throw new ItemError(`${where}: not an object`);
    const key = typeof it.key === 'number' ? String(it.key) : it.key;
    if (typeof key !== 'string' || !key.trim()) throw new ItemError(`${where}: missing key`);
    if (key.length > MAX_KEY) throw new ItemError(`${where}: key longer than ${MAX_KEY} chars`);
    const type = it.type ?? 'match';
    if (typeof type !== 'string' || !/^[a-z_]{1,32}$/.test(type)) throw new ItemError(`${where}: invalid type "${type}"`);
    if (typeof it.title !== 'string' || !it.title.trim()) throw new ItemError(`${where} (${key}): missing title`);
    let url = null;
    if (it.url != null && it.url !== '') {
      try {
        const u = new URL(it.url);
        if (!/^https?:$/.test(u.protocol)) throw new Error();
        url = u.toString();
      } catch { throw new ItemError(`${where} (${key}): url is not an absolute http(s) URL: ${it.url}`); }
    }
    const fields = it.fields ?? {};
    if (typeof fields !== 'object' || Array.isArray(fields)) throw new ItemError(`${where} (${key}): fields must be an object`);
    const fieldsJson = JSON.stringify(fields);
    if (fieldsJson.length > MAX_FIELDS_BYTES) throw new ItemError(`${where} (${key}): fields exceed ${MAX_FIELDS_BYTES} bytes`);
    let timestamp = it.timestamp ?? now.toISOString();
    if (timestamp instanceof Date) timestamp = timestamp.toISOString();
    if (Number.isNaN(Date.parse(timestamp))) throw new ItemError(`${where} (${key}): invalid timestamp`);
    const dedupeKey = `${type}\u0000${key}`;
    if (seen.has(dedupeKey)) return; // duplicates within one run collapse to the first
    seen.add(dedupeKey);
    out.push({ key: key.trim(), type, title: it.title.trim().slice(0, MAX_TITLE), url, fields: JSON.parse(fieldsJson), timestamp: new Date(timestamp).toISOString() });
  });
  return out;
}

