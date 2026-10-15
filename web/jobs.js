// Jobs dashboard: job cards from the Worker API, Run now, run history and logs.
// All server data is rendered with textContent (never innerHTML) and links are limited to http(s).

import { $, el, safeLink, store } from './lib/dom.js';

const LS = { url: 'cc.workerUrl', token: 'cc.apiToken', cache: 'cc.lastJobs', tabs: 'cc.tabs' };
const POLL_MS = 10_000;
const POLL_FOR_MS = 6 * 60_000;


const state = {
  jobs: [],
  open: new Set(),
  tabs: JSON.parse(store.get(LS.tabs) || '{}'),
  pendingSince: new Map(), // jobId -> ms when Run now was tapped
  pollTimer: null,
};

function settings() {
  return {
    // Default: the deploy-time URL, else this page's own origin when the Worker serves the PWA.
    url: (store.get(LS.url) || window.CC_CONFIG?.workerUrl || (location.hostname.endsWith('.github.io') ? '' : location.origin)).replace(/\/+$/, ''),
    token: store.get(LS.token) || '',
  };
}

async function api(path, { method = 'GET', url, token } = {}) {
  const s = settings();
  const base = url ?? s.url;
  const auth = token ?? s.token;
  if (!base || !auth) throw Object.assign(new Error('Open settings to add the Worker URL and token.'), { setup: true });
  const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${auth}` }, cache: 'no-store' });
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status });
  return body;
}

// ---------- formatting ----------

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}
function countdown(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return 'ended';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60); const mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
}
const money = (n) => (typeof n === 'number' ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 }) : '');
const dur = (ms) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const localTime = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

function banner(msg, kind = 'info') {
  const b = $('#banner');
  if (!msg) { b.hidden = true; return; }
  b.hidden = false;
  b.className = `banner ${kind}`;
  b.textContent = msg;
}

// ---------- rendering ----------

function statusOf(job) {
  if (state.pendingSince.has(job.id)) return { label: 'queued', cls: 'running' };
  const r = job.lastRun;
  if (!r) return { label: 'never run', cls: 'idle' };
  if (r.status === 'running') return { label: 'running', cls: 'running' };
  return r.status === 'success' ? { label: 'ok', cls: 'ok' } : { label: 'failed', cls: 'bad' };
}

function tabsFor(job) {
  const ui = job.meta?.ui;
  if (ui?.types?.includes('ending_soon')) {
    return [
      { id: 'tracked', label: 'Tracked', view: 'current', type: 'match', sort: ui.sortBy },
      { id: 'matches', label: 'New matches', view: 'recent', type: 'match' },
      { id: 'ending', label: 'Ending alerts', view: 'recent', type: 'ending_soon' },
    ];
  }
  return [{ id: 'recent', label: 'Recent', view: ui?.primary === 'current' ? 'current' : 'recent' }];
}

/** Shown until the Worker URL and token are saved. The tools work without any of this. */
function renderSetup() {
  $('#jobs').replaceChildren(el('section', { class: 'card setup' },
    el('h2', { text: 'Connect your jobs' }),
    el('p', { class: 'muted small', text: 'Scheduled jobs run in the cloud (GitHub Actions + a Cloudflare Worker). After the one-time setup in the README, enter the Worker URL and token here. The Tools tab works without this.' }),
    el('div', { class: 'row' }, el('button', { class: 'btn primary', text: 'Open settings', onclick: openSettings }))));
}

function renderJobs() {
  const root = $('#jobs');
  root.replaceChildren();
  if (!state.jobs.length) { root.append(el('p', { class: 'muted center', text: 'No jobs yet. They appear after the first run syncs.' })); return; }
  const tpl = $('#job-card');
  for (const job of state.jobs) {
    const card = tpl.content.firstElementChild.cloneNode(true);
    card.dataset.job = job.id;
    $('.job-name', card).textContent = job.name;
    $('.job-desc', card).textContent = job.description;
    const st = statusOf(job);
    const pill = $('.pill', card);
    pill.textContent = job.enabled ? st.label : 'disabled';
    pill.classList.add(job.enabled ? st.cls : 'idle');
    const r = job.lastRun;
    const outcome = r?.status === 'success' ? `${r.itemCount ?? 0} items, ${r.newCount ?? 0} new` : r?.status === 'failed' ? 'no results saved' : 'in progress';
    $('.job-status', card).textContent = r
      ? `Last run ${ago(r.startedAt)} (${r.trigger}) · ${outcome}${r.durationMs != null ? ` · ${dur(r.durationMs)}` : ''}${job.lastSuccessAt && r.status !== 'success' ? ` · last ok ${ago(job.lastSuccessAt)}` : ''}`
      : `Schedule: ${job.schedule} (${job.timezone})`;
    if (r?.status === 'failed' && r.error) {
      const e = $('.job-error', card);
      e.hidden = false;
      e.textContent = `${r.errorKind ? `[${r.errorKind}] ` : ''}${r.error}`;
    }
    const runBtn = $('.run-now', card);
    runBtn.disabled = !job.enabled || state.pendingSince.has(job.id) || r?.status === 'running';
    runBtn.addEventListener('click', () => runNow(job, runBtn));
    const toggle = $('.toggle', card);
    const details = $('.details', card);
    const setOpen = (open) => {
      details.hidden = !open;
      toggle.textContent = open ? 'Hide' : 'Details';
      if (open) { state.open.add(job.id); loadDetails(job, card); } else state.open.delete(job.id);
    };
    toggle.addEventListener('click', () => setOpen(details.hidden));
    root.append(card);
    if (state.open.has(job.id)) setOpen(true);
  }
}

async function loadDetails(job, card) {
  const tabs = tabsFor(job);
  const active = tabs.find((t) => t.id === state.tabs[job.id]) ?? tabs[0];
  const tabBar = $('.tabs', card);
  tabBar.replaceChildren(...(tabs.length > 1 ? tabs.map((t) => el('button', {
    class: `tab${t.id === active.id ? ' active' : ''}`, role: 'tab', 'aria-selected': String(t.id === active.id), text: t.label,
    onclick: () => { state.tabs[job.id] = t.id; store.set(LS.tabs, JSON.stringify(state.tabs)); loadDetails(job, card); },
  })) : []));

  const list = $('.items', card);
  const runsList = $('.runs', card);
  list.replaceChildren(el('li', { class: 'muted small', text: 'Loading…' }));
  try {
    const q = new URLSearchParams({ view: active.view, limit: '50' });
    if (active.type) q.set('type', active.type);
    const [{ items }, { runs }] = await Promise.all([
      api(`/api/jobs/${encodeURIComponent(job.id)}/items?${q}`),
      api(`/api/jobs/${encodeURIComponent(job.id)}/runs?limit=10`),
    ]);
    if (active.sort === 'endTime') {
      items.sort((a, b) => (Date.parse(a.fields?.endTime) || Infinity) - (Date.parse(b.fields?.endTime) || Infinity));
    }
    list.replaceChildren(...(items.length ? items.map(renderItem) : [el('li', { class: 'muted small', text: 'Nothing here yet.' })]));
    runsList.replaceChildren(...runs.map((r) => el('li', { class: 'run' },
      el('button', { class: 'linkish', onclick: () => openRun(r.id) },
        el('span', { class: `dot ${r.status === 'success' ? 'ok' : r.status === 'running' ? 'running' : 'bad'}` }),
        `${localTime(r.startedAt)} · ${r.trigger} · ${r.itemCount ?? '–'} items · ${r.newCount ?? '–'} new · ${dur(r.durationMs)}`),
      r.error ? el('div', { class: 'small bad-text', text: r.error }) : null)));
  } catch (err) {
    list.replaceChildren(el('li', { class: 'bad-text small', text: err.message }));
  }
}

function renderItem(it) {
  const f = it.fields ?? {};
  const meta = [];
  if (typeof f.currentBid === 'number') meta.push(el('strong', { text: money(f.currentBid) }));
  if (f.endTime) {
    const left = countdown(f.endTime);
    meta.push(el('span', { class: Date.parse(f.endTime) - Date.now() < 6 * 3600_000 ? 'warn-text' : '', text: left === 'ended' ? 'ended' : `ends in ${left}` }));
    meta.push(el('span', { class: 'muted', text: localTime(f.endTime) }));
  }
  if (f.location) meta.push(el('span', { class: 'muted', text: f.location }));
  if (!meta.length) {
    for (const [k, v] of Object.entries(f).slice(0, 3)) if (v != null && typeof v !== 'object') meta.push(el('span', { class: 'muted', text: `${k}: ${v}` }));
  }
  meta.push(el('span', { class: 'muted', text: `seen ${ago(it.firstSeenAt)}` }));
  return el('li', { class: 'item' },
    el('div', { class: 'item-title' }, it.url ? safeLink(it.url, it.title) : it.title),
    el('div', { class: 'item-meta small' }, meta));
}

async function openRun(id) {
  const dlg = $('#run-detail');
  $('#run-title').textContent = 'Run';
  $('#run-meta').replaceChildren();
  $('#run-log').textContent = 'Loading…';
  dlg.showModal();
  try {
    const { run } = await api(`/api/runs/${encodeURIComponent(id)}`);
    $('#run-title').textContent = `${run.jobId} · ${run.status}`;
    const rows = [
      ['Started', localTime(run.startedAt)], ['Duration', dur(run.durationMs)], ['Trigger', run.trigger],
      ['Attempts', run.attempts], ['Items', run.itemCount], ['New', run.newCount], ['Seed', run.seed],
      ['Error', run.error ? `${run.errorKind ? `[${run.errorKind}] ` : ''}${run.error}` : null],
    ].filter(([, v]) => v != null && v !== '');
    $('#run-meta').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: String(v) })]),
      ...(run.source?.startsWith('https://') ? [el('dt', { text: 'Actions' }), el('dd', {}, safeLink(run.source, 'Open run'))] : []));
    $('#run-log').textContent = (run.log ?? []).map((e) => `${(e.t ?? '').slice(11, 19)} ${String(e.level).toUpperCase().padEnd(5)} ${e.msg}${e.data ? ' ' + JSON.stringify(e.data) : ''}`).join('\n') || '(empty)';
  } catch (err) {
    $('#run-log').textContent = err.message;
  }
}

// ---------- actions ----------

async function refresh({ quiet = false } = {}) {
  try {
    const { jobs } = await api('/api/jobs');
    state.jobs = jobs;
    store.set(LS.cache, JSON.stringify({ at: new Date().toISOString(), jobs }));
    for (const [id, since] of state.pendingSince) {
      const j = jobs.find((x) => x.id === id);
      if ((j?.lastRun && Date.parse(j.lastRun.startedAt) >= since - 60_000) || Date.now() - since > POLL_FOR_MS) state.pendingSince.delete(id);
    }
    banner(null);
    $('#updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } catch (err) {
    const cached = JSON.parse(store.get(LS.cache) || 'null');
    if (cached && !state.jobs.length) state.jobs = cached.jobs;
    if (err.setup) { banner(null); renderSetup(); return; }
    if (!quiet) banner(`${err.message}${cached ? ` · showing data from ${ago(cached.at)}` : ''}`, 'bad');
  }
  renderJobs();
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  const busy = state.pendingSince.size || state.jobs.some((j) => j.lastRun?.status === 'running');
  if (busy) state.pollTimer = setTimeout(() => refresh({ quiet: true }), POLL_MS);
}

async function runNow(job, btn) {
  btn.disabled = true;
  btn.textContent = 'Queuing…';
  try {
    await api(`/api/jobs/${encodeURIComponent(job.id)}/run`, { method: 'POST' });
    state.pendingSince.set(job.id, Date.now());
    banner(`${job.name} queued. GitHub usually starts it within a minute.`, 'info');
  } catch (err) {
    banner(`Run now failed: ${err.message}`, 'bad');
  }
  renderJobs();
  schedulePoll();
}

// ---------- settings ----------

function openSettings() {
  const s = settings();
  $('#worker-url').value = s.url;
  $('#api-token').value = s.token;
  $('#test-result').textContent = '';
  const dlg = $('#settings');
  if (!dlg.open) dlg.showModal();
}

let active = false;

/** Called by the router when the Jobs tab is shown or hidden. */
export function setJobsActive(on) {
  active = on;
  if (on) refresh({ quiet: true }); else clearTimeout(state.pollTimer);
}

$('#settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.submitter?.value === 'save') {
    store.set(LS.url, $('#worker-url').value.trim().replace(/\/+$/, ''));
    store.set(LS.token, $('#api-token').value.trim());
    refresh();
  }
  $('#settings').close();
});
$('#test-connection').addEventListener('click', async () => {
  const out = $('#test-result');
  out.textContent = 'Testing…';
  try {
    const { jobs } = await api('/api/jobs', { url: $('#worker-url').value.trim().replace(/\/+$/, ''), token: $('#api-token').value.trim() });
    out.textContent = `✔ Connected (${jobs.length} jobs)`;
  } catch (err) {
    out.textContent = `✖ ${err.status === 401 ? 'Wrong token' : err.message}`;
  }
});
$('#open-settings').addEventListener('click', openSettings);
$('#refresh').addEventListener('click', () => refresh());
$('#close-run').addEventListener('click', () => $('#run-detail').close());
