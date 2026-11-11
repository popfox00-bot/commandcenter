// Downloads: the downloads themselves, apart from the screen (one manager for the whole visit, so
// leaving the app and coming back never starts a download twice). Each one is stored on the phone
// a piece at a time as it arrives (download-store), so it can be paused and continued, picks up
// again after the app was closed (where the site allows: otherwise it starts over), and is never
// held in memory whole. Its fingerprint (SHA-256) is worked out on the way, and its details (codecs,
// size, frame rate) read from the file at the end. A part of an MP4 is fetched the same way: only
// its index and the frames of the part, straight from the site.

import { store, roomLeft, keepStorage } from './download-store.js';
import { downloadVideo, remoteSource, streamPart, fileNameFor, formatTime, DownloadError, MIME, MAX_BYTES } from './download-core.js';
import { planPart } from './mp4.js';
import { videoDetails, blobSource, describe } from './media-info.js';
import { Sha256 } from '../../lib/sha256.js';
import { formatBytes } from '../../lib/files.js';

/** Stored in pieces of this size (what's in memory at most while downloading). */
const PIECE = 4 * 1024 ** 2;

let manager = null;
/** The downloads manager (made once). Its changes go to `subscribe` listeners: (job) or (null: the list). */
export function getJobs() { manager ??= createJobs(); return manager; }

function createJobs() {
  /** @type {any[]} */
  let jobs = [];
  /** Downloads running now: id -> { ctrl, buffered, rate } */
  const live = new Map();
  const listeners = new Set();
  const onChange = (job) => { for (const f of listeners) { try { f(job); } catch { /* a screen gone */ } } };

  const save = (job) => { job.updated = Date.now(); return store.putJob(job); };
  const changed = (job) => onChange(job);

  const ready = (async () => {
    jobs = await store.jobs();
    onChange(null);
    // Ones that were going when the app closed carry on; ones waiting their turn wait.
    for (const j of jobs) if (j.status === 'running') run(j);
    pump();
  })();

  /** The next one waiting starts when none is running. */
  function pump() {
    if (live.size) return;
    const next = [...jobs].reverse().find((j) => j.status === 'waiting');
    if (next) run(next);
  }

  /** A new download (or a part: `part` { from, to } seconds). */
  async function start({ url, host, kind = null, total = 0, ranges = false, lastModified = '', strict = false, part = null, wait = false }) {
    await ready; await keepStorage();
    const job = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, url, host, kind, total, ranges, lastModified, strict, part,
      name: part ? fileNameFor(url, 'mp4', ` (${formatTime(part.from).replace(/:/g, '.')}–${formatTime(part.to).replace(/:/g, '.')})`) : fileNameFor(url, kind ?? 'mp4'),
      loaded: 0, pieces: 0, sha: null, hash: '', status: wait ? 'waiting' : 'running', error: '', details: '', created: Date.now(), updated: Date.now(),
    };
    jobs.unshift(job); await save(job); onChange(null);
    if (wait) pump(); else run(job);
    return job;
  }

  /** Bytes it has so far (stored and on the way). */
  const loadedOf = (job) => job.loaded + (live.get(job.id)?.buffered ?? 0);

  async function run(job) {
    if (live.has(job.id)) return;
    const me = { ctrl: new AbortController(), buffered: 0, rate: 0, t0: performance.now(), l0: job.loaded };
    live.set(job.id, me);
    job.status = 'running'; job.error = ''; changed(job);
    let sha = new Sha256(job.sha ?? undefined); let buf = [];
    const flush = async () => {
      if (!me.buffered) return;
      const blob = new Blob(buf); const i = job.pieces;
      job.loaded += me.buffered; job.pieces++; job.sha = sha.state();
      buf = []; me.buffered = 0;
      await store.putPiece(job, i, blob);
    };
    const onChunk = async (b) => {
      sha.update(b); buf.push(b); me.buffered += b.length;
      if (me.buffered >= PIECE) await flush();
    };
    let lastTell = 0;
    const tell = () => {
      const now = performance.now(); if (now - lastTell < 250) return; lastTell = now;
      me.rate = (loadedOf(job) - me.l0) / Math.max(0.5, (now - me.t0) / 1000);
      changed(job);
    };
    const restart = async () => { await store.clear(job.id); job.loaded = 0; job.pieces = 0; job.sha = null; sha = new Sha256(); buf = []; me.buffered = 0; me.l0 = 0; await save(job); };
    try {
      const room = await roomLeft();
      if (job.total && job.total - job.loaded > room) throw new DownloadError('too-big', `Not enough room on the phone: it needs ${formatBytes(job.total - job.loaded)}, and ${formatBytes(room)} is free.`);
      const maxBytes = Math.min(MAX_BYTES, job.loaded + room);
      if (job.part) {
        const src = remoteSource(job.url, job.total0 ?? job.total, { signal: me.ctrl.signal });
        const plan = await planPart(src, job.part.from, job.part.to);
        job.total0 ??= job.total; job.total = plan.size; job.kind = 'mp4'; changed(job);
        await streamPart(src, plan, { from: job.loaded, onChunk, onProgress: tell });
      } else {
        if (job.loaded && !job.ranges) await restart();
        let r;
        for (let attempt = 0; ; attempt++) {
          try {
            r = await downloadVideo(job.url, { signal: me.ctrl.signal, start: job.loaded, expect: { total: job.total, lastModified: job.lastModified }, strict: job.strict, maxBytes, onChunk, onProgress: tell });
            break;
          } catch (e) {
            if (e instanceof DownloadError && e.code === 'changed' && attempt === 0) { await restart(); continue; }
            throw e;
          }
        }
        if (r.kind && r.kind !== job.kind) { job.kind = r.kind; job.name = fileNameFor(job.url, r.kind); }
        job.total = r.total; job.ranges = r.ranges; job.lastModified ||= r.lastModified;
      }
      await flush();
      job.hash = sha.hex(); job.sha = null; job.total = job.loaded; job.status = 'done';
      await save(job); live.delete(job.id); changed(job); pump();
      // Its details, from the file.
      try {
        const f = await store.file(job, job.name, MIME[job.kind] ?? 'video/mp4');
        const d = await videoDetails(blobSource(f), job.kind);
        if (d) { job.details = describe(d); job.duration = d.duration; await save(job); changed(job); }
      } catch { /* no details */ }
    } catch (e) {
      const err = e instanceof DownloadError ? e : new DownloadError('cut', e?.message || 'It stopped.');
      // What arrived is kept (to continue), unless it isn't what was asked for at all.
      if (['not-video', 'redirect', 'too-big'].includes(err.code)) { await restart().catch(() => {}); } else { await flush().catch(() => {}); }
      job.status = err.code === 'aborted' ? 'paused' : 'failed';
      job.error = err.code === 'aborted' ? '' : err.message; job.code = err.code;
      await save(job).catch(() => {}); live.delete(job.id); changed(job); pump();
    }
  }

  return {
    ready,
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
    start,
    list: () => jobs,
    get: (id) => jobs.find((j) => j.id === id) ?? null,
    loadedOf,
    rateOf: (job) => live.get(job.id)?.rate ?? 0,
    isLive: (job) => live.has(job.id),
    /** How many are downloading now. */
    running: () => live.size,
    pause(job) { if (job.status === 'waiting') { job.status = 'paused'; save(job); changed(job); } else live.get(job.id)?.ctrl.abort(); },
    resume(job) { run(job); },
    /** Saved to the phone (Save to phone went through): shown filled in green in the queue. */
    async markSaved(job) { job.saved = true; await save(job); changed(job); },
    /** Removed, with what it stored: nothing of it is kept anywhere. */
    async remove(job) {
      const l = live.get(job.id); if (l) { l.ctrl.abort(); while (live.has(job.id)) await new Promise((r) => setTimeout(r, 30)); }
      job.status = 'removed';
      await store.clear(job.id, { record: true });
      jobs = jobs.filter((j) => j !== job); onChange(null);
    },
    /** All of them removed. */
    async clearAll() { for (const j of [...jobs]) await this.remove(j); },
    file: (job) => store.file(job, job.name, MIME[job.kind] ?? 'video/mp4'),
    /** All they take on the phone. */
    used: () => jobs.reduce((s, j) => s + j.loaded, 0),
    memoryOnly: () => store.memoryOnly(),
  };
}
