// Remote store: the Worker's /ingest API, signed with CC_INGEST_SECRET (separate from the UI token).
import { sign, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../../shared/hmac.js';
import { FetchError, ConfigError } from '../core/errors.js';
import { withRetry } from '../core/retry.js';

export function createRemoteStore({ baseUrl = process.env.CC_WORKER_URL, secret = process.env.CC_INGEST_SECRET, fetchFn = fetch, retries = 3, env = process.env } = {}) {
  if (!baseUrl) throw new ConfigError('CC_WORKER_URL is not set (needed for --store remote)');
  if (!secret) throw new ConfigError('CC_INGEST_SECRET is not set (needed for --store remote)');
  const base = baseUrl.replace(/\/+$/, '');
  // Optional Cloudflare Access service token, when the Worker sits behind Access.
  const accessHeaders = env.CC_ACCESS_CLIENT_ID && env.CC_ACCESS_CLIENT_SECRET
    ? { 'cf-access-client-id': env.CC_ACCESS_CLIENT_ID, 'cf-access-client-secret': env.CC_ACCESS_CLIENT_SECRET }
    : {};

  async function call(method, path, payload) {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const { value } = await withRetry(async () => {
      const timestamp = String(Date.now());
      const signature = await sign(secret, { method, path, timestamp, body });
      let res;
      try {
        res = await fetchFn(base + path, {
          method,
          headers: { ...accessHeaders, 'content-type': 'application/json', [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature },
          body: method === 'GET' ? undefined : body,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        throw new FetchError(`Worker ${method} ${path} failed: ${err.message}`, { cause: err });
      }
      const text = await res.text();
      if (!res.ok) throw new FetchError(`Worker ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`, { status: res.status });
      return text ? JSON.parse(text) : {};
    }, { retries, baseMs: 1000 });
    return value;
  }

  return {
    kind: 'remote',
    syncJobs: (jobs, now) => call('POST', '/ingest/jobs', { jobs, now }),
    getJobStates: async () => (await call('GET', '/ingest/state')).states,
    startRun: (run) => call('POST', '/ingest/runs/start', run),
    upsertItems: (args) => call('POST', '/ingest/items', args),
    finishRun: (id, r) => call('POST', '/ingest/runs/finish', { id, ...r }),
    close: () => {},
  };
}
