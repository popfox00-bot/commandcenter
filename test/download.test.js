// Files → Download: which links are fetched (and what's said about them: expiry, tokens, tracking),
// the minute marks, what counts as a video, asking the site before downloading, the download itself
// (no cookies, refused on a bad redirect, a web page or past the limit; resumed only for the same
// file), a part of an MP4 read straight from the "site", its details, and the fingerprint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  checkVideoLink, linkFromText, minuteMarks, closerMarks, formatTime, sniffVideo, fileNameFor, downloadVideo, DownloadError,
  linkExpiry, signedParams, preflight, remoteSource, streamPart, typeProblem,
} from '../web/tools/download/download-core.js';
import { planPart, readMovie, mp4Details } from '../web/tools/download/mp4.js';
import { videoDetails, webmDetails, describe } from '../web/tools/download/media-info.js';
import { Sha256, sameFingerprint } from '../web/lib/sha256.js';
import { pickFour } from '../web/apps/downloads/link-view.js';

const FIX = resolve(import.meta.dirname, 'fixtures/web');
const mp4Head = () => { const b = new Uint8Array(4096); b.set([0, 0, 0, 0x20], 0); b.set([...'ftypisom'].map((c) => c.charCodeAt(0)), 4); return b; };
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

test('links: https video files pass; http, private, playlists, programs, scams and expired links are refused', () => {
  const ok = checkVideoLink('https://cdn.example.com/clips/My%20Trip.mp4');
  assert.equal(ok.ok, true); assert.equal(ok.host, 'cdn.example.com'); assert.deepEqual(ok.warnings, []); assert.deepEqual(ok.notes, []);
  assert.equal(checkVideoLink('cdn.example.com/a.mp4').ok, true, 'no scheme: https assumed');
  for (const bad of ['http://cdn.example.com/a.mp4', 'javascript:alert(1)', 'file:///etc/passwd', 'https://user:pw@cdn.example.com/a.mp4',
    'https://192.168.1.10/a.mp4', 'https://localhost/a.mp4', 'https://router.local/a.mp4', 'https://cdn.example.com/live/index.m3u8',
    'https://cdn.example.com/a.mpd', 'https://cdn.example.com/setup.exe', 'https://cdn.example.com/page.html', 'https://paypal-secure-login.com/a.mp4', '', 'not a link at all']) {
    const r = checkVideoLink(bad);
    assert.equal(r.ok, false, bad); assert.ok(r.reasons.length && r.reasons[0].title, bad);
  }
  const odd = checkVideoLink('https://cdn.example.com:8443/a.mp4');
  assert.equal(odd.ok, true); assert.ok(odd.warnings.some((w) => /port/i.test(w.title)));
  const old = checkVideoLink(`https://d1.cloudfront.net/a.mp4?Expires=${NOW / 1000 - 600}&Signature=abcDEF123456789xyz&Key-Pair-Id=K2ABC`, { now: NOW });
  assert.equal(old.ok, false); assert.match(old.reasons[0].title, /expired/); assert.match(old.reasons[0].detail, /10 min ago/);
});

test('pasted text: the link picked out of a message around it', () => {
  assert.equal(linkFromText('  https://cdn.example.com/a.mp4\n'), 'https://cdn.example.com/a.mp4');
  assert.equal(linkFromText('Watch this: https://cdn.example.com/a.mp4?x=1. So good!'), 'https://cdn.example.com/a.mp4?x=1');
  assert.equal(linkFromText('(https://cdn.example.com/a.mp4)'), 'https://cdn.example.com/a.mp4');
  assert.equal(linkFromText('cdn.example.com/a.mp4'), 'cdn.example.com/a.mp4', 'no scheme: as it is');
  assert.equal(linkFromText(''), '');
});

test('signed links: when they expire, their tokens pointed out, tracking kept on them', () => {
  const cf = `https://d1.cloudfront.net/v/a.mp4?Expires=${NOW / 1000 + 720}&Signature=abcDEF123456789xyz&Key-Pair-Id=K2ABC&utm_source=x`;
  assert.equal(linkExpiry(cf), NOW + 720_000);
  const c = checkVideoLink(cf, { now: NOW });
  assert.equal(c.ok, true);
  assert.deepEqual(c.signed, ['Signature', 'Key-Pair-Id']);
  assert.equal(c.url, cf, 'a signed link is left exactly as it is');
  assert.deepEqual(c.notes.map((n) => n.title), ['Stops working in 12 min', 'Has an access token in it']);
  assert.equal(linkExpiry('https://b.s3.amazonaws.com/a.mp4?X-Amz-Date=20261110T120000Z&X-Amz-Expires=3600&X-Amz-Signature=ab12'), NOW + 3_600_000);
  assert.equal(linkExpiry('https://x.blob.core.windows.net/a.mp4?se=2026-11-10T13:00:00Z&sig=abc'), NOW + 3_600_000);
  assert.equal(linkExpiry(`https://a.akamaized.net/a.mp4?hdnts=st=1~exp=${NOW / 1000 + 60}~acl=/*~hmac=ab`), NOW + 60_000);
  assert.equal(linkExpiry('https://cdn.example.com/a.mp4?exp=1794312000000'), 1794312000000, 'milliseconds too');
  assert.equal(linkExpiry('https://cdn.example.com/a.mp4?v=2'), null);
  assert.deepEqual(signedParams('https://cdn.example.com/a.mp4?t=12&k=abc'), [], 'short t / k are not tokens');
  assert.deepEqual(signedParams('https://cdn.example.com/a.mp4?token=x'), ['token']);
  assert.deepEqual(signedParams('https://cdn.example.com/a.mp4?t=a8f3k29dk3mf02kd'), ['t']);
});

test('tracking: taken off an unsigned link, and said so', () => {
  const c = checkVideoLink('https://cdn.example.com/a.mp4?utm_source=news&fbclid=abc&quality=hd');
  assert.equal(c.ok, true);
  assert.equal(c.url, 'https://cdn.example.com/a.mp4?quality=hd');
  assert.deepEqual(c.removed, ['utm_source', 'fbclid']);
  assert.match(c.notes.at(-1).title, /Tracking removed/);
});

test('minute marks: the start (a second in) and each minute; fewer for long videos; closer looks every 10 s', () => {
  assert.deepEqual(minuteMarks(NaN), []);
  assert.deepEqual(minuteMarks(0), []);
  assert.deepEqual(minuteMarks(30).map((m) => [m.mark, m.at, m.label]), [[0, 1, '0:00']]);
  assert.deepEqual(minuteMarks(185).map((m) => m.label), ['0:00', '1:00', '2:00', '3:00']);
  assert.deepEqual(minuteMarks(120).map((m) => m.label), ['0:00', '1:00'], 'not the very end');
  const long = minuteMarks(4 * 3600, { max: 120 });
  assert.ok(long.length <= 120 && long.length >= 60); assert.equal(long[1].mark, 180);
  assert.equal(formatTime(3723), '1:02:03'); assert.equal(formatTime(75), '1:15');
  assert.deepEqual(closerMarks(60, 120).map((m) => m.label), ['1:00', '1:10', '1:20', '1:30', '1:40', '1:50']);
  assert.deepEqual(closerMarks(0, 25).map((m) => m.at), [1, 10, 20]);
});

test('four stills spread through it: the first, the last and two between (all when 4 or fewer)', () => {
  const at = (d) => pickFour(minuteMarks(d)).map((m) => m.label);
  assert.deepEqual(at(150), ['0:00', '1:00', '2:00']);
  assert.deepEqual(at(600), ['0:00', '3:00', '6:00', '9:00']);
  assert.deepEqual(at(3600), ['0:00', '20:00', '39:00', '59:00']);
  assert.deepEqual(at(300.5), ['0:00', '1:00', '3:00', '4:00'], 'four of five');
});

test('sniff: video kinds from their first bytes; a web page is not one', () => {
  assert.equal(sniffVideo(mp4Head()), 'mp4');
  const mov = mp4Head(); mov.set([...'qt  '].map((c) => c.charCodeAt(0)), 8); assert.equal(sniffVideo(mov), 'mov');
  const webm = new Uint8Array(64); webm.set([0x1a, 0x45, 0xdf, 0xa3]); webm.set([...'webm'].map((c) => c.charCodeAt(0)), 20); assert.equal(sniffVideo(webm), 'webm');
  const ts = new Uint8Array(400); ts[0] = 0x47; ts[188] = 0x47; assert.equal(sniffVideo(ts), 'ts');
  assert.equal(sniffVideo(new TextEncoder().encode('<!doctype html><html>'.padEnd(300))), null);
  assert.equal(sniffVideo(new TextEncoder().encode('MZ'.padEnd(300))), null);
});

test('file names: from the address, safe, with the right extension', () => {
  assert.equal(fileNameFor('https://x.com/a/My%20Trip.mov', 'mp4'), 'My Trip.mp4');
  assert.equal(fileNameFor('https://x.com/a/..%2F..%2Fevil:%3F.mp4', 'mp4'), 'evil.mp4');
  assert.equal(fileNameFor('https://x.com/', 'webm'), 'video.webm');
  assert.equal(fileNameFor('https://x.com/a.mp4', 'mp4', ' (1.00–2.00)'), 'a (1.00–2.00).mp4');
});

test('only files labelled as video: octet-stream refused when asked for, video/* and application/mp4 accepted', () => {
  assert.equal(typeProblem('application/octet-stream', false), null);
  assert.match(typeProblem('application/octet-stream', true), /labelled as video/);
  assert.equal(typeProblem('video/mp4', true), null); assert.equal(typeProblem('application/mp4', true), null);
  assert.match(typeProblem('text/html', false), /not a video/);
});

// ---------- a fake site ----------

/** Serves `file` like a CDN: HEAD, ranges, a date; or blocks, redirects, mislabels. */
function site(file, { type = 'video/mp4', ranges = true, lastModified = 'Tue, 10 Nov 2026 10:00:00 GMT', head = true, url = '' } = {}) {
  const calls = [];
  const fetchImpl = async (u, init = {}) => {
    calls.push({ url: String(u), init });
    if (init.method === 'HEAD') {
      if (!head) return new Response(null, { status: 405 });
      return res(null, 200, { 'content-length': String(file.length) });
    }
    const m = /bytes=(\d+)-(\d*)/.exec(init.headers?.range ?? '');
    if (m && ranges) {
      const a = Number(m[1]); const b = m[2] ? Math.min(Number(m[2]), file.length - 1) : file.length - 1;
      if (a >= file.length) return res(null, 416, {});
      return res(file.subarray(a, b + 1), 206, { 'content-length': String(b - a + 1), 'content-range': `bytes ${a}-${b}/${file.length}` });
    }
    return res(file, 200, { 'content-length': String(file.length) });
  };
  const res = (body, status, h) => {
    const chunks = body ? [] : null;
    if (body) for (let i = 0; i < body.length; i += 1000) chunks.push(body.slice(i, i + 1000));
    const r = new Response(chunks ? new ReadableStream({ pull(c) { const n = chunks.shift(); if (n) c.enqueue(n); else c.close(); } }) : null,
      { status, headers: { 'content-type': type, 'last-modified': lastModified, ...(ranges ? { 'accept-ranges': 'bytes' } : {}), ...h } });
    if (url) Object.defineProperty(r, 'url', { value: url });
    return r;
  };
  return { fetchImpl, calls };
}

/** Downloads with the pieces collected. */
async function grab(url, o) {
  const got = []; const r = await downloadVideo(url, { ...o, onChunk: (b) => { got.push(Buffer.from(b)); } });
  return { ...r, bytes: Buffer.concat(got) };
}

test('preflight: size, type, kind and resumability without downloading it', async () => {
  const f = await readFile(`${FIX}/clock.mp4`);
  const s = site(f);
  const p = await preflight('https://cdn.example.com/a.mp4', { fetchImpl: s.fetchImpl });
  assert.deepEqual(p, { total: f.length, type: 'video/mp4', kind: 'mp4', ranges: true, lastModified: 'Tue, 10 Nov 2026 10:00:00 GMT' });
  assert.ok(s.calls.every((c) => c.init.credentials === 'omit' && c.init.referrerPolicy === 'no-referrer'));
  assert.equal(s.calls[1].init.headers.range, 'bytes=0-4095', 'only the first bytes');
  // No HEAD, no ranges: what it can tell from a plain answer.
  const p2 = await preflight('https://cdn.example.com/a.mp4', { fetchImpl: site(f, { head: false, ranges: false }).fetchImpl });
  assert.equal(p2.total, f.length); assert.equal(p2.ranges, false); assert.equal(p2.kind, 'mp4');
  // Blocked: null. A web page, or a mislabelled file with "only video": refused.
  assert.equal(await preflight('https://cdn.example.com/a.mp4', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), null);
  await assert.rejects(preflight('https://cdn.example.com/a.mp4', { fetchImpl: site(Buffer.from('<html>'.padEnd(5000)), { type: 'text/html' }).fetchImpl }), { code: 'not-video' });
  await assert.rejects(preflight('https://cdn.example.com/a.mp4', { strict: true, fetchImpl: site(f, { type: 'application/octet-stream' }).fetchImpl }), { code: 'not-video' });
  await assert.rejects(preflight('https://cdn.example.com/a.mp4', { fetchImpl: site(Buffer.from('MZ'.padEnd(5000)), { type: 'application/octet-stream' }).fetchImpl }), { code: 'not-video' });
  await assert.rejects(preflight('https://cdn.example.com/a.mp4', { fetchImpl: site(f, { url: 'http://cdn.example.com/a.mp4' }).fetchImpl }), { code: 'redirect' });
});

test('download: no cookies or referrer, pieces handed over as they come, progress, kind', async () => {
  const f = await readFile(`${FIX}/clock.mp4`);
  const s = site(f); const seen = [];
  const r = await grab('https://cdn.example.com/v/clip.mp4', { fetchImpl: s.fetchImpl, onProgress: (p) => seen.push(p) });
  assert.equal(s.calls[0].init.credentials, 'omit'); assert.equal(s.calls[0].init.referrerPolicy, 'no-referrer'); assert.equal(s.calls[0].init.mode, 'cors');
  assert.equal(r.kind, 'mp4'); assert.equal(r.total, f.length); assert.equal(r.ranges, true);
  assert.equal(Buffer.compare(r.bytes, f), 0);
  assert.deepEqual(seen.at(-1), { loaded: f.length, total: f.length });
});

test('download: resumed from where it stopped, only when it is the same file', async () => {
  const f = await readFile(`${FIX}/clock.mp4`);
  const lm = 'Tue, 10 Nov 2026 10:00:00 GMT';
  const r = await grab('https://cdn.example.com/a.mp4', { fetchImpl: site(f).fetchImpl, start: 100_000, expect: { total: f.length, lastModified: lm } });
  assert.equal(Buffer.compare(r.bytes, f.subarray(100_000)), 0);
  // Changed since (a new date, or a new size), or the site no longer sends ranges: start over.
  await assert.rejects(grab('https://cdn.example.com/a.mp4', { fetchImpl: site(f, { lastModified: 'Wed, 11 Nov 2026 10:00:00 GMT' }).fetchImpl, start: 100_000, expect: { total: f.length, lastModified: lm } }), { code: 'changed' });
  await assert.rejects(grab('https://cdn.example.com/a.mp4', { fetchImpl: site(f).fetchImpl, start: 100_000, expect: { total: f.length + 5 } }), { code: 'changed' });
  await assert.rejects(grab('https://cdn.example.com/a.mp4', { fetchImpl: site(f, { ranges: false }).fetchImpl, start: 100_000, expect: { total: f.length } }), { code: 'changed' });
});

test('download: refused for a web page, a bad redirect, too big, an error, cut off, or blocked', async () => {
  const code = async (p) => { try { await p; return 'ok'; } catch (e) { assert.ok(e instanceof DownloadError, e); return e.code; } };
  const url = 'https://cdn.example.com/a.mp4'; const f = Buffer.from(mp4Head());
  assert.equal(await code(grab(url, { fetchImpl: site(Buffer.from('<html>'), { type: 'text/html' }).fetchImpl })), 'not-video');
  assert.equal(await code(grab(url, { fetchImpl: site(Buffer.from('MZ'.padEnd(600)), { type: 'application/octet-stream' }).fetchImpl })), 'not-video');
  assert.equal(await code(grab(url, { strict: true, fetchImpl: site(f, { type: 'application/octet-stream' }).fetchImpl })), 'not-video');
  assert.equal(await code(grab(url, { fetchImpl: site(f, { url: 'http://cdn.example.com/a.mp4' }).fetchImpl })), 'redirect');
  assert.equal(await code(grab(url, { fetchImpl: site(f, { url: 'https://10.0.0.5/a.mp4' }).fetchImpl })), 'redirect');
  assert.equal(await code(grab(url, { maxBytes: 1000, fetchImpl: site(f).fetchImpl })), 'too-big');
  assert.equal(await code(grab(url, { fetchImpl: async () => new Response('x', { status: 404 }) })), 'http');
  assert.equal(await code(grab(url, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } })), 'blocked');
  assert.equal(await code(grab(url, { fetchImpl: async () => new Response(f.subarray(0, 2000), { headers: { 'content-type': 'video/mp4', 'content-length': '4096' } }) })), 'cut', 'cut off before its length');
  const ac = new AbortController(); ac.abort();
  assert.equal(await code(grab(url, { signal: ac.signal, fetchImpl: async (u, i) => { if (i.signal.aborted) throw new DOMException('x', 'AbortError'); } })), 'aborted');
  // Nothing is handed over before its first bytes show it's a video.
  const got = [];
  await code(downloadVideo(url, { fetchImpl: site(Buffer.from('MZ'.padEnd(5000)), { type: 'application/octet-stream' }).fetchImpl, onChunk: (b) => got.push(b) }));
  assert.equal(got.length, 0);
});

// ---------- MP4: details and parts ----------

const fileSrc = (f) => ({ size: f.length, read: async (o, n) => new Uint8Array(f.subarray(o, o + n)) });

test('mp4 details: length, size, codecs, frame rate, sound', async () => {
  const f = await readFile(`${FIX}/clock.mp4`);
  const d = await mp4Details(fileSrc(f));
  assert.equal(d.duration, 150); assert.equal(d.width, 96); assert.equal(d.height, 54); assert.equal(d.fps, 10);
  assert.equal(d.video, 'H.264'); assert.equal(d.audio, 'AAC'); assert.equal(d.channels, 1); assert.equal(d.rate, 22050);
  assert.equal(describe(d), '96×54 · 10 fps · H.264 · AAC mono 22.1 kHz · 18 kb/s');
});

test('webm details: from its header', async () => {
  const f = await readFile(`${FIX}/clock.webm`);
  const d = webmDetails(new Uint8Array(f), f.length);
  assert.equal(Math.round(d.duration), 150); assert.equal(d.width, 96); assert.equal(d.height, 54); assert.equal(d.video, 'VP9'); assert.equal(d.audio, null);
  assert.equal((await videoDetails(fileSrc(f), 'webm')).video, 'VP9');
  assert.equal(await videoDetails(fileSrc(Buffer.from('nonsense'.repeat(10))), 'mp4'), null, 'not readable: no details');
});

test('mp4 part: from the key frame at or before, both tracks, the same frames, a valid file', async () => {
  const f = await readFile(`${FIX}/clock.mp4`);
  const plan = await planPart(fileSrc(f), 61, 95);
  assert.equal(plan.start, 60, 'the key frame before 1:01');
  assert.ok(plan.end >= 95 && plan.end < 95.2);
  const out = Buffer.concat([plan.head, ...plan.ranges.map((r) => f.subarray(r.offset, r.offset + r.length))]);
  assert.equal(out.length, plan.size);
  // Read back: 35 s of video and of sound, each sample the same bytes as in the original.
  const src = await readMovie(fileSrc(f)); const part = await readMovie(fileSrc(out));
  assert.ok(Math.abs(part.duration - 35) < 0.2, String(part.duration));
  for (const kind of ['vide', 'soun']) {
    const a = src.tracks.find((t) => t.kind === kind); const b = part.tracks.find((t) => t.kind === kind);
    assert.ok(Math.abs(b.mediaDur / b.scale - 35) < 0.2, `${kind} ${b.mediaDur / b.scale}`);
    const first = Array.from(a.samples.dts).findIndex((t) => t + a.samples.dur[0] > 60 * a.scale);
    for (const i of [0, 1, Math.floor(b.n / 2), b.n - 1]) {
      const A = f.subarray(a.samples.off[first + i], a.samples.off[first + i] + a.samples.size[first + i]);
      const B = out.subarray(b.samples.off[i], b.samples.off[i] + b.samples.size[i]);
      assert.equal(Buffer.compare(A, B), 0, `${kind} sample ${i}`);
    }
    if (kind === 'vide') assert.equal(b.samples.sync[0], 1, 'starts on a key frame');
  }
  // (Where ffmpeg is installed, it decodes the part without an error.)
  let ff = true; try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ff = false; }
  if (ff) {
    const { writeFileSync, mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
    const p = `${mkdtempSync(`${tmpdir()}/dl-`)}/part.mp4`; writeFileSync(p, out);
    assert.equal(execFileSync('ffmpeg', ['-v', 'error', '-i', p, '-f', 'null', '-'], { encoding: 'utf8' }).trim(), '');
  }
  await assert.rejects(planPart(fileSrc(f), 100, 90), /empty/);
  await assert.rejects(planPart(fileSrc(Buffer.from(mp4Head())), 0, 10), /No index/);
});

test('mp4 part straight from the site: only ranges asked for, the same bytes as cut from the file, resumable', async () => {
  const f = await readFile(`${FIX}/clock.mp4`);
  const s = site(f);
  const src = remoteSource('https://cdn.example.com/a.mp4', f.length, { fetchImpl: s.fetchImpl });
  const plan = await planPart(src, 61, 95);
  const want = Buffer.concat([plan.head, ...plan.ranges.map((r) => f.subarray(r.offset, r.offset + r.length))]);
  const got = []; await streamPart(src, plan, { onChunk: (b) => { got.push(Buffer.from(b)); } });
  assert.equal(Buffer.compare(Buffer.concat(got), want), 0);
  const fetched = s.calls.slice().reduce((n, c) => { const m = /bytes=(\d+)-(\d+)/.exec(c.init.headers?.range ?? ''); return n + (m ? Number(m[2]) - Number(m[1]) + 1 : 0); }, 0);
  assert.ok(fetched < f.length * 0.5, `fetched ${fetched} of ${f.length}: about the part's share`);
  assert.ok(s.calls.every((c) => c.init.headers?.range), 'never the whole file');
  // From the middle on (a resume): the rest of the same bytes.
  const rest = []; await streamPart(src, plan, { from: 20_000, onChunk: (b) => { rest.push(Buffer.from(b)); } });
  assert.equal(Buffer.compare(Buffer.concat(rest), want.subarray(20_000)), 0);
  // A site that stops sending ranges: refused, not a wrong file.
  await assert.rejects(remoteSource('https://cdn.example.com/a.mp4', f.length, { fetchImpl: site(f, { ranges: false }).fetchImpl }).read(0, 100), { code: 'changed' });
});

test('fingerprint: SHA-256 a piece at a time, saved and picked up again, checked against a pasted one', () => {
  const data = Buffer.alloc(300_000); for (let i = 0; i < data.length; i++) data[i] = (i * 31 + (i >> 7)) & 255;
  const want = createHash('sha256').update(data).digest('hex');
  let s = new Sha256();
  for (let i = 0; i < data.length; i += 7777) { s.update(data.subarray(i, i + 7777)); if (i % 3 === 0) s = new Sha256(JSON.parse(JSON.stringify(s.state()))); }
  assert.equal(s.hex(), want);
  assert.equal(new Sha256().hex(), createHash('sha256').update('').digest('hex'));
  assert.equal(sameFingerprint(want, want.toUpperCase()), true);
  assert.equal(sameFingerprint(want, `sha256:${want.match(/../g).join(':')}`), true);
  assert.equal(sameFingerprint(want, `sha256-${createHash('sha256').update(data).digest('base64')}`), true);
  assert.equal(sameFingerprint(want, want.replace(/.$/, '0') === want ? want.replace(/.$/, '1') : want.replace(/.$/, '0')), false);
  assert.equal(sameFingerprint(want, 'nonsense'), false);
});
