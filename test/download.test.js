// Files → Download: which links are fetched, the minute marks, what counts as a video, and the
// download itself (no cookies, refused on a bad redirect, a web page or past the size limit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkVideoLink, minuteMarks, formatTime, sniffVideo, fileNameFor, downloadVideo, DownloadError } from '../web/tools/download/download-core.js';

const mp4Head = () => { const b = new Uint8Array(4096); b.set([0, 0, 0, 0x20], 0); b.set([...'ftypisom'].map((c) => c.charCodeAt(0)), 4); return b; };

test('links: https video files pass; http, private, playlists, programs and scams are refused', () => {
  const ok = checkVideoLink('https://cdn.example.com/clips/My%20Trip.mp4');
  assert.equal(ok.ok, true); assert.equal(ok.host, 'cdn.example.com'); assert.deepEqual(ok.warnings, []);
  assert.equal(checkVideoLink('cdn.example.com/a.mp4').ok, true, 'no scheme: https assumed');
  for (const bad of ['http://cdn.example.com/a.mp4', 'javascript:alert(1)', 'file:///etc/passwd', 'https://user:pw@cdn.example.com/a.mp4',
    'https://192.168.1.10/a.mp4', 'https://localhost/a.mp4', 'https://router.local/a.mp4', 'https://cdn.example.com/live/index.m3u8',
    'https://cdn.example.com/a.mpd', 'https://cdn.example.com/setup.exe', 'https://cdn.example.com/page.html', 'https://paypal-secure-login.com/a.mp4', '', 'not a link at all']) {
    const r = checkVideoLink(bad);
    assert.equal(r.ok, false, bad); assert.ok(r.reasons.length && r.reasons[0].title, bad);
  }
  const odd = checkVideoLink('https://cdn.example.com:8443/a.mp4');
  assert.equal(odd.ok, true); assert.ok(odd.warnings.some((w) => /port/i.test(w.title)));
});

test('minute marks: the start (a second in) and each minute; fewer for long videos', () => {
  assert.deepEqual(minuteMarks(NaN), []);
  assert.deepEqual(minuteMarks(0), []);
  assert.deepEqual(minuteMarks(30).map((m) => [m.mark, m.at, m.label]), [[0, 1, '0:00']]);
  assert.deepEqual(minuteMarks(185).map((m) => m.label), ['0:00', '1:00', '2:00', '3:00']);
  assert.deepEqual(minuteMarks(120).map((m) => m.label), ['0:00', '1:00'], 'not the very end');
  const long = minuteMarks(4 * 3600, { max: 120 });
  assert.ok(long.length <= 120 && long.length >= 60); assert.equal(long[1].mark, 180);
  assert.equal(formatTime(3723), '1:02:03'); assert.equal(formatTime(75), '1:15');
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
});

/** A response whose body comes in chunks. */
function resp(chunks, { status = 200, type = 'video/mp4', length = true, url = '' } = {}) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const body = new ReadableStream({ pull(c) { const n = chunks.shift(); if (n) c.enqueue(n); else c.close(); } });
  const r = new Response(body, { status, headers: { 'content-type': type, ...(length ? { 'content-length': String(total) } : {}) } });
  if (url) Object.defineProperty(r, 'url', { value: url });
  return r;
}

test('download: no cookies or referrer, progress reported, a video blob with its name', async () => {
  let init; const seen = [];
  const head = mp4Head();
  const r = await downloadVideo('https://cdn.example.com/v/clip.mp4', {
    fetchImpl: async (u, i) => { init = i; return resp([head.subarray(0, 100), head.subarray(100), new Uint8Array(1000)]); },
    onProgress: (p) => seen.push(p),
  });
  assert.equal(init.credentials, 'omit'); assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.mode, 'cors');
  assert.equal(r.kind, 'mp4'); assert.equal(r.name, 'clip.mp4'); assert.equal(r.size, 5096); assert.equal(r.blob.type, 'video/mp4');
  assert.deepEqual(seen.at(-1), { loaded: 5096, total: 5096 });
});

test('download: refused for a web page, a bad redirect, too big, an error, or blocked', async () => {
  const code = async (p) => { try { await p; return 'ok'; } catch (e) { assert.ok(e instanceof DownloadError, e); return e.code; } };
  const url = 'https://cdn.example.com/a.mp4';
  assert.equal(await code(downloadVideo(url, { fetchImpl: async () => resp([new TextEncoder().encode('<html>')], { type: 'text/html' }) })), 'not-video');
  assert.equal(await code(downloadVideo(url, { fetchImpl: async () => resp([new TextEncoder().encode('MZ'.padEnd(600))], { type: 'application/octet-stream' }) })), 'not-video');
  assert.equal(await code(downloadVideo(url, { fetchImpl: async () => resp([mp4Head()], { url: 'http://cdn.example.com/a.mp4' }) })), 'redirect');
  assert.equal(await code(downloadVideo(url, { fetchImpl: async () => resp([mp4Head()], { url: 'https://10.0.0.5/a.mp4' }) })), 'redirect');
  assert.equal(await code(downloadVideo(url, { maxBytes: 1000, fetchImpl: async () => resp([mp4Head()]) })), 'too-big');
  assert.equal(await code(downloadVideo(url, { maxBytes: 5000, fetchImpl: async () => resp([mp4Head(), mp4Head()], { length: false }) })), 'too-big', 'no length given: stopped once past it');
  assert.equal(await code(downloadVideo(url, { fetchImpl: async () => resp([], { status: 404 }) })), 'http');
  assert.equal(await code(downloadVideo(url, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } })), 'blocked');
  const ac = new AbortController(); ac.abort();
  assert.equal(await code(downloadVideo(url, { signal: ac.signal, fetchImpl: async (u, i) => { if (i.signal.aborted) throw new DOMException('x', 'AbortError'); } })), 'aborted');
});
