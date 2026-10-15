// Builds the `ctx` handed to job.run(ctx). Everything a job may touch (network, browser, time,
// randomness, secrets, logging) comes through ctx so runs are reproducible and policy is central.

import { createPoliteHttp } from './http.js';
import { createBrowser } from './browser.js';
import { registerSecret } from './redact.js';
import { sleep } from './retry.js';
import { randInt } from './rng.js';
import { ConfigError } from './errors.js';

export function createContext({ job, jobCfg, config, runId, attempt, now, rng, signal, log, fixture, env = process.env, fetchFn, cacheDir }) {
  const http = createPoliteHttp({ politeness: config.politeness, log, rng, signal, fetchFn, cacheDir });
  const browser = createBrowser({ politeness: config.politeness, http, log, signal });

  /**
   * Fetch a page's HTML. render:true loads it in headless Chromium (for JS-rendered sites) and
   * optionally waits for a selector. In fixture mode (local CLI --fixture, tests) the saved HTML
   * is returned instead and nothing touches the network.
   */
  async function page(url, { render = false, waitForSelector, waitForAny = [], timeoutMs = 45_000, cache = true, settleMs = 1500 } = {}) {
    if (fixture) {
      const html = await fixture(url);
      if (html != null) { log.info('page from fixture', { url }); return { url, html, fromFixture: true, fromCache: false }; }
    }
    if (!render) {
      const r = await http.request(url, { cache, timeoutMs });
      return { url: r.url, html: r.text, fromFixture: false, fromCache: r.fromCache };
    }
    const key = `render:${url}:${waitForSelector ?? ''}:${waitForAny.join('|')}`;
    if (cache) {
      const hit = http.cacheGet(key);
      if (hit) { log.debug('render cache hit', { url }); return { url: hit.url, html: hit.text, fromFixture: false, fromCache: true }; }
    }
    const result = await browser.withPage(async (p, { goto }) => {
      const res = await goto(url, { timeoutMs });
      if (res && res.status() >= 400) {
        const { FetchError } = await import('./errors.js');
        throw new FetchError(`GET ${url} -> HTTP ${res.status()} (browser)`, { status: res.status() });
      }
      const selectors = [waitForSelector, ...waitForAny].filter(Boolean);
      if (selectors.length) {
        // Resolve as soon as any selector appears; a timeout here is left to the parser to judge.
        await p.waitForSelector(selectors.join(', '), { timeout: timeoutMs, state: 'attached' }).catch(() => log.warn('wait selectors not found before timeout', { selectors }));
      }
      if (settleMs) await p.waitForTimeout(settleMs);
      return { url: p.url(), html: await p.content() };
    });
    log.info('rendered page', { url, bytes: result.html.length });
    if (cache) http.cachePut(key, { url: result.url, text: result.html });
    return { ...result, fromFixture: false, fromCache: false };
  }

  /**
   * Job-scoped secret from env: ctx.secret("password") reads JOB_<JOBID>_PASSWORD.
   * Values are registered for redaction before they are returned.
   */
  function secret(name, { required = true } = {}) {
    const envName = `JOB_${job.id.toUpperCase().replace(/-/g, '_')}_${name.toUpperCase()}`;
    const value = env[envName];
    if (!value && required) throw new ConfigError(`Missing secret ${envName} for job ${job.id}`);
    if (value) registerSecret(value);
    return value;
  }

  return Object.freeze({
    jobId: job.id,
    runId,
    attempt,
    /** Fixed for the whole run: jobs must use this, never Date.now(). */
    now,
    settings: jobCfg.settings,
    timezone: config.timezone,
    log,
    signal,
    rng,
    page,
    http: { text: http.text, json: http.json, request: http.request },
    browser: { withPage: browser.withPage },
    secret,
    /** Polite pause between steps of a multi-page job (randomized within config bounds). */
    pause: () => (fixture ? Promise.resolve() : sleep(randInt(rng, config.politeness.minDelayMs, config.politeness.maxDelayMs), signal)),
  });
}
