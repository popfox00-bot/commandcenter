// Worker link check: redirect tracing (HTTP, meta refresh, script), downloads, refusing local/odd
// targets, RDAP and Safe Browsing, and the /api/linkcheck route (auth, POST only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceLink, assertFetchable, readPage, LinkError } from '../worker/src/linkcheck.js';
import worker from '../worker/src/index.js';

/** A fake internet: url -> Response factory. Records every request. */
function web(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const r = routes[String(url)] ?? routes[String(url).split('?')[0]];
    if (!r) throw new TypeError('fetch failed');
    return r(init);
  };
  return { fetchImpl, calls };
}
const redirect = (to, status = 301) => () => new Response(null, { status, headers: { location: to } });
const html = (body, headers = {}) => () => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const rdap = (date) => () => Response.json({ events: [{ eventAction: 'registration', eventDate: date }], entities: [] });

test('trace follows HTTP, meta-refresh and script redirects to the final page', async () => {
  const { fetchImpl, calls } = web({
    'https://bit.ly/abc': redirect('https://t.example.net/c?id=1'),
    'https://t.example.net/c': redirect('/land', 302),
    'https://t.example.net/land': html('<html><head><meta http-equiv="refresh" content="0; url=https://shop.example.org/go"></head></html>'),
    'https://shop.example.org/go': html('<script>window.location.href = "https://shop.example.org/final";</script>'),
    'https://shop.example.org/final': html('<html><head><title>Fall Sale &amp; More</title><meta property="og:site_name" content="Example Shop"><meta name="description" content="Deals"></head><body>…</body></html>'),
    'https://rdap.org/domain/bit.ly': rdap('2008-01-01T00:00:00Z'),
    'https://rdap.org/domain/example.net': rdap('1995-01-01T00:00:00Z'),
    'https://rdap.org/domain/example.org': rdap('1995-08-31T04:00:00Z'),
  });
  const r = await traceLink('https://bit.ly/abc', {}, { fetchImpl });
  assert.deepEqual(r.hops.map((h) => [h.url, h.status, h.kind]), [
    ['https://bit.ly/abc', 301, 'start'],
    ['https://t.example.net/c?id=1', 302, 'http'],
    ['https://t.example.net/land', 200, 'http'],
    ['https://shop.example.org/go', 200, 'meta'],
    ['https://shop.example.org/final', 200, 'script'],
  ]);
  assert.equal(r.final.url, 'https://shop.example.org/final');
  assert.equal(r.final.title, 'Fall Sale & More');
  assert.equal(r.final.siteName, 'Example Shop');
  assert.equal(r.domains['example.org'].registered, '1995-08-31T04:00:00Z');
  assert.deepEqual(r.safeBrowsing, { checked: false, matches: [] });
  // Manual redirects, a phone user agent, no cookies.
  const first = calls[0].init;
  assert.equal(first.redirect, 'manual');
  assert.match(first.headers['user-agent'], /iPhone/);
  assert.equal(first.headers.cookie, undefined);
});

test('trace stops at local addresses, odd ports and loops; reports downloads and dead sites', async () => {
  const local = web({ 'https://evil.example/': redirect('http://192.168.1.1/admin'), 'https://rdap.org/domain/evil.example': rdap('2026-10-16T00:00:00Z') });
  const r1 = await traceLink('https://evil.example/', {}, { fetchImpl: local.fetchImpl });
  assert.match(r1.stopped, /local network/);
  assert.ok(!local.calls.some((c) => c.url.includes('192.168')), 'never fetched');

  const loop = web({ 'https://a.example/': redirect('https://a.example/x'), 'https://a.example/x': redirect('https://a.example/') });
  assert.match((await traceLink('https://a.example/', {}, { fetchImpl: loop.fetchImpl })).stopped, /loops/);

  const dl = web({ 'https://get.example/app': () => new Response('PK', { headers: { 'content-type': 'application/vnd.android.package-archive', 'content-disposition': 'attachment; filename="free-prize.apk"' } }) });
  assert.equal((await traceLink('https://get.example/app', {}, { fetchImpl: dl.fetchImpl })).final.download, 'free-prize.apk');

  const dead = web({});
  assert.match((await traceLink('https://nope.example/', {}, { fetchImpl: dead.fetchImpl })).final.error, /connect/);

  for (const bad of ['http://localhost/', 'https://10.0.0.1/', 'https://example.com:8443/', 'ftp://example.com/', 'file:///etc/passwd', 'http://2130706433/']) {
    assert.throws(() => assertFetchable(bad), LinkError, bad);
  }
});

test('Safe Browsing is asked when GSB_API_KEY is set', async () => {
  let asked = null;
  const { fetchImpl } = web({
    'https://phish.example/': html('<title>Sign in</title>'),
    'https://rdap.org/domain/phish.example': () => new Response('', { status: 404 }),
    'https://safebrowsing.googleapis.com/v4/threatMatches:find': (init) => { asked = JSON.parse(init.body); return Response.json({ matches: [{ threatType: 'SOCIAL_ENGINEERING', threat: { url: 'https://phish.example/' } }] }); },
  });
  const r = await traceLink('https://phish.example/', { GSB_API_KEY: 'k' }, { fetchImpl });
  assert.deepEqual(asked.threatInfo.threatEntries, [{ url: 'https://phish.example/' }]);
  assert.deepEqual(r.safeBrowsing, { checked: true, matches: [{ url: 'https://phish.example/', threat: 'SOCIAL_ENGINEERING' }] });
  assert.match(r.domains['phish.example'].error, /not found/);
});

test('readPage: titles, entities, refresh tags', () => {
  assert.deepEqual(readPage('<title>A &lt;b&gt;</title>', 'https://x.example/'), { title: 'A <b>', description: '', siteName: '', next: null, kind: null });
  assert.equal(readPage('<meta http-equiv="refresh" content="3;URL=\'/next\'">', 'https://x.example/a/').next, 'https://x.example/next');
  assert.equal(readPage('<script>location.replace("https://y.example/")</script>', 'https://x.example/').next, 'https://y.example/');
});

test('/api/linkcheck: bearer token, POST with JSON, 422 for links it won\'t follow', async () => {
  const env = { CC_API_TOKEN: 'a'.repeat(32) };
  const call = (init) => worker.fetch(new Request('https://w.example/api/linkcheck', init), env);
  assert.equal((await call({ method: 'POST', body: '{"url":"https://x.example/"}' })).status, 401);
  const auth = { authorization: `Bearer ${'a'.repeat(32)}`, 'content-type': 'application/json' };
  assert.equal((await call({ method: 'GET', headers: auth })).status, 404);
  assert.equal((await call({ method: 'POST', headers: auth, body: 'nope' })).status, 400);
  const res = await call({ method: 'POST', headers: auth, body: JSON.stringify({ url: 'http://127.0.0.1/' }) });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /local network/);
});
