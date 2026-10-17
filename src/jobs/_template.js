// Copy this file to src/jobs/<your-id>.js (or src/jobs/<your-id>/index.js), then add
//   jobs:
//     <your-id>:
//       settings: { ... }
// to config/jobs.yaml. Files starting with "_" are ignored by the registry.
//
// Rules for jobs (the framework does the rest):
//  - Return normalized items: { key, title, url, fields, timestamp, type? }. `key` must be stable
//    for the same real-world thing (listing id, URL, SKU); it drives dedupe and notifications.
//  - Never call fetch/Date.now/Math.random directly. Use ctx.http / ctx.page / ctx.browser,
//    ctx.now, ctx.rng. That is what makes runs polite, cached, logged and reproducible.
//  - Throw ParseError when the page doesn't look like you expect (missing selector, no results
//    marker). Never return [] for a page you couldn't understand.
//  - Do not dedupe, persist, notify, retry or sleep-retry yourself.
//  - Secrets: ctx.secret('name') reads JOB_<ID>_<NAME> from encrypted platform secrets.
import { z } from 'zod';
import { ParseError } from '../core/errors.js';

export default {
  id: 'my-job',
  name: 'My job',
  description: 'What it watches and why.',
  schedule: '0 */6 * * *',
  /**
   * Optional: hosts of documented public APIs this job calls (e.g. 'api.weather.gov'). robots.txt is
   * not applied to these hosts only; use it solely for official APIs meant for programs, never to
   * get around a website's robots.txt.
   */
  // officialApis: [],
  /** Set true if the job uses ctx.page({ render: true }) or ctx.browser. */
  needsBrowser: false,
  configSchema: z.object({
    url: z.string().url(),
  }).strict(),
  /** Optional: how a new item reads as a push notification. */
  formatNotification: (item) => ({ title: item.title, message: JSON.stringify(item.fields), url: item.url }),
  async run(ctx) {
    const data = await ctx.http.json(ctx.settings.url);
    if (!Array.isArray(data?.items)) throw new ParseError('response has no items array');
    return data.items.map((d) => ({ key: String(d.id), title: d.name, url: d.link, fields: { price: d.price }, timestamp: ctx.now }));
  },
};
