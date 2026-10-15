// Notifications. Transport: ntfy (topic from a secret) or console (local dev).
// Policy (what to send, batching, first-run silence) lives here so jobs never handle it.

import { redactString } from './redact.js';

const PRIORITY = { min: 1, low: 2, default: 3, high: 4, urgent: 5 };
const MAX_MESSAGE = 3800; // ntfy caps message bodies at 4096 bytes

export function createNtfyNotifier({ server = 'https://ntfy.sh', topic, token, fetchFn = fetch, log }) {
  if (!topic) throw new Error('NTFY_TOPIC is not set');
  return {
    kind: 'ntfy',
    async send({ title, message, url, priority = 'default', tags = [] }) {
      const body = { topic, title: title.slice(0, 250), message: message.slice(0, MAX_MESSAGE), priority: PRIORITY[priority] ?? 3, tags, ...(url ? { click: url } : {}) };
      const res = await fetchFn(server.replace(/\/+$/, '') + '/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`ntfy responded HTTP ${res.status}`);
      log?.info('notification sent', { title: body.title, priority: body.priority });
    },
  };
}

export function createConsoleNotifier({ out = (s) => process.stdout.write(s) } = {}) {
  const sent = [];
  return {
    kind: 'console',
    sent,
    async send(n) {
      sent.push(n);
      out(`\n🔔 [${n.priority ?? 'default'}] ${n.title}\n${n.message}${n.url ? `\n→ ${n.url}` : ''}\n`);
    },
  };
}

/** Pick a notifier from env: ntfy when NTFY_TOPIC is set (and not disabled), console otherwise. */
export function notifierFromEnv({ env = process.env, log, forceConsole = false } = {}) {
  if (!forceConsole && env.NTFY_TOPIC) {
    return createNtfyNotifier({ server: env.NTFY_SERVER || 'https://ntfy.sh', topic: env.NTFY_TOPIC, token: env.NTFY_TOKEN, log });
  }
  return createConsoleNotifier();
}

export function defaultFormat(item) {
  const lines = Object.entries(item.fields ?? {})
    .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${v}`);
  return { title: item.title, message: lines.join('\n') || item.title, url: item.url };
}

/**
 * Build the notifications for a run's new items.
 *  - First successful run with silentFirstRun: one summary ("now tracking N"), no per-item spam.
 *  - Otherwise: up to maxPerRun individual notifications, the rest folded into one summary.
 */
export function planNewItemNotifications({ job, items, notifyCfg, firstRun }) {
  if (!notifyCfg.onNew || !items.length) return [];
  const format = job.formatNotification ?? defaultFormat;
  const out = [];
  if (firstRun && notifyCfg.silentFirstRun) {
    return [{ title: `${job.name}: now tracking ${items.length} item${items.length === 1 ? '' : 's'}`, message: 'First run recorded existing results without alerting on each one. New ones from here on will notify.', priority: 'low', tags: ['seedling'] }];
  }
  const individual = items.slice(0, notifyCfg.maxPerRun);
  for (const it of individual) {
    const f = format(it);
    out.push({ title: f.title, message: f.message, url: f.url ?? it.url ?? undefined, priority: f.priority ?? notifyCfg.priority, tags: f.tags ?? [] });
  }
  const rest = items.slice(individual.length);
  if (rest.length) {
    out.push({
      title: `${job.name}: ${rest.length} more new`,
      message: rest.slice(0, 15).map((it) => `• ${it.title}`).join('\n') + (rest.length > 15 ? `\n…and ${rest.length - 15} more` : ''),
      priority: notifyCfg.priority,
      tags: ['heavy_plus_sign'],
    });
  }
  return out;
}

const FAILURE_LABEL = {
  parse: 'Selector or parse broke',
  expectation: 'Fewer results than expected',
  timeout: 'Timed out',
  fetch: 'Network/HTTP failure',
  policy: 'Blocked by robots.txt/policy',
  config: 'Invalid config',
  item: 'Job returned invalid items',
  notify: 'Notification delivery failed',
};

export function failureNotification({ job, error, errorKind, attempts, runUrl }) {
  const label = FAILURE_LABEL[errorKind] ?? 'Run failed';
  return {
    title: `❌ ${job.name}: ${label}`,
    message: redactString(`${error}\nAttempts: ${attempts ?? 1}${errorKind === 'parse' ? '\nThe site layout probably changed. Capture a new fixture and update the selectors.' : ''}`).slice(0, MAX_MESSAGE),
    url: runUrl,
    priority: errorKind === 'parse' || errorKind === 'expectation' ? 'high' : 'default',
    tags: ['warning'],
  };
}
