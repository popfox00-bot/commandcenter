// Command Center API (Cloudflare Worker + D1).
//   /api/*     read API for the PWA + "Run now" + link check for scanned QR codes; bearer CC_API_TOKEN
//   /ingest/*  write-back from job runners; HMAC-signed with CC_INGEST_SECRET (a separate secret)
//   cron       stale-run cleanup, retention, scheduler watchdog, re-enable the scheduled workflow

import * as sql from '../../shared/sql-store.js';
import { verify, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../../shared/hmac.js';
import { isDue, parseCron } from '../../src/core/schedule.js';
import { traceLink, LinkError } from './linkcheck.js';

const MAX_BODY = 1_000_000;
const DISPATCH_COOLDOWN_MS = 2 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- helpers ----------

function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra },
  });
}

/** Constant-time string comparison via HMAC of both sides (works without timingSafeEqual). */
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [x, y] = await Promise.all([crypto.subtle.sign('HMAC', key, enc.encode(a)), crypto.subtle.sign('HMAC', key, enc.encode(b))]);
  const ua = new Uint8Array(x); const ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

async function requireBearer(request, env) {
  if (!env.CC_API_TOKEN || env.CC_API_TOKEN.length < 24) throw new HttpError(500, 'CC_API_TOKEN is not configured (needs 24+ chars)');
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !(await safeEqual(token, env.CC_API_TOKEN))) throw new HttpError(401, 'unauthorized');
}

async function readSignedBody(request, env, path) {
  const body = await request.text();
  if (body.length > MAX_BODY) throw new HttpError(413, 'body too large');
  const result = await verify(env.CC_INGEST_SECRET, {
    method: request.method, path, body,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
  });
  if (!result.ok) throw new HttpError(401, `ingest auth failed: ${result.reason}`);
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw new HttpError(400, 'invalid JSON'); }
}

const isId = (s) => typeof s === 'string' && /^[a-z][a-z0-9-]{1,40}$/.test(s);
const isRunId = (s) => typeof s === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(s);
const nowIso = () => new Date().toISOString();

function assertItems(items) {
  if (!Array.isArray(items) || items.length > 500) throw new HttpError(400, 'items must be an array of at most 500');
  for (const it of items) {
    if (typeof it?.key !== 'string' || !it.key || it.key.length > 256) throw new HttpError(400, 'item.key invalid');
    if (typeof it.type !== 'string' || !/^[a-z_]{1,32}$/.test(it.type)) throw new HttpError(400, 'item.type invalid');
    if (typeof it.title !== 'string' || !it.title) throw new HttpError(400, 'item.title invalid');
    if (typeof it.timestamp !== 'string' || Number.isNaN(Date.parse(it.timestamp))) throw new HttpError(400, 'item.timestamp invalid');
    if (it.url != null && !/^https?:\/\//.test(it.url)) throw new HttpError(400, 'item.url invalid');
  }
}

// ---------- GitHub ----------

function ghHeaders(env) {
  return {
    authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'command-center-worker',
  };
}

function workflowUrl(env, workflow) {
  return `https://api.github.com/repos/${encodeURIComponent(env.GH_OWNER)}/${encodeURIComponent(env.GH_REPO)}/actions/workflows/${encodeURIComponent(workflow)}`;
}

async function dispatchJob(env, jobId) {
  if (!env.GH_DISPATCH_TOKEN || !env.GH_OWNER || !env.GH_REPO) throw new HttpError(500, 'GitHub dispatch is not configured');
  const res = await fetch(`${workflowUrl(env, env.GH_DISPATCH_WORKFLOW || 'cc-dispatch.yml')}/dispatches`, {
    method: 'POST',
    headers: { ...ghHeaders(env), 'content-type': 'application/json' },
    body: JSON.stringify({ ref: env.GH_REF || 'main', inputs: { job_id: jobId } }),
  });
  if (res.status !== 204 && res.status !== 200) {
    // Don't echo GitHub's body to the client; it can include repo details.
    throw new HttpError(502, `GitHub dispatch failed (HTTP ${res.status})`);
  }
  return res.status;
}

// ---------- notifications (watchdog only; job alerts are sent by the runner) ----------

async function ntfy(env, { title, message, priority = 4, tags = ['warning'] }) {
  if (!env.NTFY_TOPIC) return false;
  const res = await fetch((env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '') + '/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(env.NTFY_TOKEN ? { authorization: `Bearer ${env.NTFY_TOKEN}` } : {}) },
    body: JSON.stringify({ topic: env.NTFY_TOPIC, title, message, priority, tags }),
  });
  return res.ok;
}

// ---------- routes ----------

async function handleApi(request, env, url) {
  await requireBearer(request, env);
  const parts = url.pathname.split('/').filter(Boolean); // ["api", ...]
  const q = url.searchParams;

  if (request.method === 'GET' && parts.length === 2 && parts[1] === 'jobs') {
    return json({ jobs: await sql.listJobs(env.DB), now: nowIso() });
  }
  if (parts[1] === 'jobs' && parts.length >= 4 && isId(parts[2])) {
    const jobId = parts[2];
    if (request.method === 'GET' && parts[3] === 'items') {
      const view = q.get('view') === 'current' ? 'current' : 'recent';
      const type = q.get('type');
      if (type && !/^[a-z_]{1,32}$/.test(type)) throw new HttpError(400, 'bad type');
      return json({ items: await sql.listItems(env.DB, jobId, { view, type, limit: q.get('limit') }) });
    }
    if (request.method === 'GET' && parts[3] === 'runs') {
      return json({ runs: await sql.listRuns(env.DB, jobId, { limit: q.get('limit') }) });
    }
    if (request.method === 'POST' && parts[3] === 'run') {
      const job = await env.DB.prepare('SELECT id, enabled FROM jobs WHERE id = ?1').bind(jobId).first();
      if (!job) throw new HttpError(404, 'unknown job');
      const since = new Date(Date.now() - DISPATCH_COOLDOWN_MS).toISOString();
      const recent = await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM dispatches WHERE job_id = ?1 AND requested_at > ?2) AS d,
                (SELECT COUNT(*) FROM runs WHERE job_id = ?1 AND status = 'running' AND started_at > ?3) AS r`,
      ).bind(jobId, since, new Date(Date.now() - 30 * 60_000).toISOString()).first();
      if (recent.d > 0) throw new HttpError(429, 'a run was requested in the last 2 minutes');
      if (recent.r > 0) throw new HttpError(409, 'a run is already in progress');
      const requestedAt = nowIso();
      const status = await dispatchJob(env, jobId);
      await env.DB.prepare('INSERT INTO dispatches (job_id, requested_at, status) VALUES (?1, ?2, ?3)').bind(jobId, requestedAt, status).run();
      return json({ ok: true, jobId, requestedAt }, 202);
    }
  }
  // POST, so the scanned link (which can carry tokens) never appears in request logs as a query string.
  if (request.method === 'POST' && parts.length === 2 && parts[1] === 'linkcheck') {
    const raw = await request.text();
    if (raw.length > 8192) throw new HttpError(413, 'body too large');
    let target;
    try { target = JSON.parse(raw).url; } catch { throw new HttpError(400, 'invalid JSON'); }
    if (typeof target !== 'string' || !target || target.length > 4096) throw new HttpError(400, 'url is required (max 4096 chars)');
    try {
      return json(await traceLink(target, env));
    } catch (err) {
      if (err instanceof LinkError) throw new HttpError(422, err.message);
      throw new HttpError(502, 'link check failed');
    }
  }
  if (request.method === 'GET' && parts[1] === 'runs' && parts.length === 3 && isRunId(parts[2])) {
    const run = await sql.getRun(env.DB, parts[2]);
    if (!run) throw new HttpError(404, 'run not found');
    return json({ run });
  }
  throw new HttpError(404, 'not found');
}

async function handleIngest(request, env, url) {
  const path = url.pathname;
  if (request.method === 'GET' && path === '/ingest/state') {
    await readSignedBody(request, env, path);
    return json({ states: await sql.getJobStates(env.DB) });
  }
  if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');
  const body = await readSignedBody(request, env, path);

  if (path === '/ingest/jobs') {
    if (!Array.isArray(body.jobs) || body.jobs.length > 100 || !body.jobs.every((j) => isId(j.id) && typeof j.name === 'string')) throw new HttpError(400, 'bad jobs');
    for (const j of body.jobs) if (j.schedule) { try { parseCron(j.schedule); } catch { throw new HttpError(400, `bad schedule for ${j.id}`); } }
    await sql.syncJobs(env.DB, body.jobs, nowIso());
    return json({ ok: true });
  }
  if (path === '/ingest/runs/start') {
    if (!isRunId(body.id) || !isId(body.jobId) || !['schedule', 'manual', 'local'].includes(body.trigger)) throw new HttpError(400, 'bad run');
    await sql.startRun(env.DB, { ...body, startedAt: body.startedAt && !Number.isNaN(Date.parse(body.startedAt)) ? body.startedAt : nowIso() });
    return json({ ok: true });
  }
  if (path === '/ingest/items') {
    if (!isId(body.jobId) || !isRunId(body.runId)) throw new HttpError(400, 'bad ids');
    assertItems(body.items);
    const run = await env.DB.prepare(`SELECT status FROM runs WHERE id = ?1 AND job_id = ?2`).bind(body.runId, body.jobId).first();
    if (!run || run.status !== 'running') throw new HttpError(409, 'run is not active');
    return json(await sql.upsertItems(env.DB, { jobId: body.jobId, runId: body.runId, now: body.now ?? nowIso(), items: body.items }));
  }
  if (path === '/ingest/runs/finish') {
    if (!isRunId(body.id) || !['success', 'failed'].includes(body.status)) throw new HttpError(400, 'bad finish');
    await sql.finishRun(env.DB, body.id, body);
    return json({ ok: true });
  }
  throw new HttpError(404, 'not found');
}

async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (url.pathname === '/api/health') return json({ ok: true });
  if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
  if (url.pathname.startsWith('/ingest/')) return handleIngest(request, env, url);
  throw new HttpError(404, 'not found');
}

// ---------- cron ----------

/**
 * Watchdog: alert (at most once per 12h) if an enabled job had a scheduled fire time more than
 * WATCHDOG_HOURS ago but hasn't started since. Catches a disabled/broken scheduled workflow.
 * Also re-enables the scheduled workflow if GitHub disabled it for inactivity (public repos, 60 days).
 */
export async function scheduled(env, now = new Date()) {
  const report = { stale: 0, pruned: null, overdue: [], reenabled: false, alerted: false };
  report.stale = await sql.failStaleRuns(env.DB, { now: now.toISOString() });
  report.pruned = await sql.prune(env.DB, { now: now.toISOString(), runDays: Number(env.RETAIN_RUN_DAYS || 60), itemDays: Number(env.RETAIN_ITEM_DAYS || 120) });

  const hours = Number(env.WATCHDOG_HOURS || 8);
  const jobs = await sql.listJobs(env.DB);
  for (const j of jobs) {
    if (!j.enabled || !j.schedule) continue;
    const threshold = new Date(now.getTime() - hours * 3600_000);
    const { due, fire } = isDue({ cron: j.schedule, now: threshold, lastRunAt: j.lastRun?.startedAt, timeZone: j.timezone || 'UTC' });
    if (due && fire) report.overdue.push(j.id);
  }

  if (env.GH_DISPATCH_TOKEN && env.GH_OWNER && env.GH_REPO) {
    try {
      const wf = await fetch(workflowUrl(env, env.GH_SCHEDULED_WORKFLOW || 'cc-scheduled.yml'), { headers: ghHeaders(env) });
      if (wf.ok) {
        const data = await wf.json();
        if (data.state === 'disabled_inactivity') {
          const r = await fetch(`${workflowUrl(env, env.GH_SCHEDULED_WORKFLOW || 'cc-scheduled.yml')}/enable`, { method: 'PUT', headers: ghHeaders(env) });
          report.reenabled = r.status === 204;
        }
      }
    } catch { /* best effort */ }
  }

  if (report.overdue.length || report.reenabled) {
    const last = await env.DB.prepare(`SELECT value FROM worker_state WHERE key = 'watchdog_alert_at'`).first('value');
    if (!last || now.getTime() - Date.parse(last) > 12 * 3600_000) {
      const parts = [];
      if (report.overdue.length) parts.push(`No run for ${report.overdue.join(', ')} in over ${hours}h although scheduled. Check the cc-scheduled workflow in GitHub Actions.`);
      if (report.reenabled) parts.push('GitHub had disabled the scheduled workflow for inactivity; it was re-enabled.');
      report.alerted = await ntfy(env, { title: '⚠️ Command Center scheduler', message: parts.join('\n') });
      await env.DB.prepare(`INSERT INTO worker_state (key, value) VALUES ('watchdog_alert_at', ?1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(now.toISOString()).run();
    }
  }
  return report;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    try {
      const res = await route(request, env);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err instanceof HttpError ? err.message : err?.stack ?? String(err));
      return json({ error: status === 500 && !(err instanceof HttpError) ? 'internal error' : err.message }, status, cors);
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(scheduled(env, new Date(controller.scheduledTime)).then((r) => console.log(JSON.stringify(r))));
  },
};
