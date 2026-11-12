// Downloads → Find videos: the video files read from a page's HTML, and the Worker's /api/findvideos
// (fetches the page, returns only the videos; refuses local / odd links; says when a link is a video).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findVideos, looksLikeVideoFile } from '../web/tools/download/find-videos.js';
import { findVideosAt, LinkError } from '../worker/src/linkcheck.js';
import { checkPageLink } from '../web/tools/download/download-core.js';
import worker from '../worker/src/index.js';

const PAGE = `<!doctype html><html><head><title>Trip &amp; more</title>
<meta property="og:video" content="https://cdn.example.com/og/main.mp4">
<meta property="og:video:secure_url" content="https://cdn.example.com/og/main.mp4">
<meta name="twitter:player:stream" content="https://cdn.example.com/tw/stream.mp4?x=1">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"VideoObject","name":"The talk","contentUrl":"https://media.example.org/talk.webm","thumbnailUrl":["https://media.example.org/t.jpg"]}]}</script>
</head><body>
<video poster="/p.jpg" title="Clip one"><source src="/v/one.mp4" type="video/mp4"><source src="/v/one.webm" type="video/webm"><source src="/v/one.vtt" type="text/vtt"></video>
<video src="https://cdn.example.com/v/two" data-x></video>
<a href="/files/three.mov" download="Three">Download</a> <a href="/about">About</a> <a href="/pic.jpg">pic</a>
<script>player.setup({file:"https:\\/\\/cdn.example.com\\/p\\/four.mp4?sig=abc", hls: "https://cdn.example.com/live/master.m3u8"});</script>
<a href="javascript:alert(1)">x</a><video src="data:video/mp4;base64,AAA"></video>
</body></html>`;

test('find videos: <video>/<source>, og:video, twitter stream, VideoObject, links and player scripts; streams counted; deduped', () => {
  const r = findVideos(PAGE, 'https://news.example.com/story/1');
  assert.equal(r.title, 'Trip & more');
  const urls = r.videos.map((v) => v.url);
  assert.deepEqual(urls.sort(), [
    'https://cdn.example.com/og/main.mp4',
    'https://cdn.example.com/p/four.mp4?sig=abc',
    'https://cdn.example.com/tw/stream.mp4?x=1',
    'https://cdn.example.com/v/two',
    'https://media.example.org/talk.webm',
    'https://news.example.com/files/three.mov',
    'https://news.example.com/v/one.mp4',
    'https://news.example.com/v/one.webm',
  ]);
  assert.equal(r.streams, 1, 'the .m3u8 counted, not listed');
  const one = r.videos.find((v) => v.url.endsWith('one.mp4'));
  assert.equal(one.title, 'Clip one'); assert.equal(one.poster, 'https://news.example.com/p.jpg'); assert.equal(one.from, 'video');
  assert.equal(r.videos.find((v) => v.url.endsWith('talk.webm')).title, 'The talk');
  assert.ok(!urls.some((u) => /about|pic\.jpg|javascript|data:/.test(u)), 'no pages, pictures or odd links');
  assert.deepEqual(findVideos('<p>nothing</p>', 'https://x.com/').videos, []);
  assert.equal(looksLikeVideoFile('https://cdn.example.com/a.MP4?x=1'), true);
  assert.equal(looksLikeVideoFile('https://news.example.com/story/1'), false);
});

test('page links: https, not local, not a scam; their own ending doesn\'t matter', () => {
  assert.equal(checkPageLink('news.example.com/story.html').ok, true);
  for (const bad of ['http://news.example.com/', 'https://192.168.0.1/', 'https://user:pw@x.com/', 'https://paypal-secure-login.com/watch', '']) assert.equal(checkPageLink(bad).ok, false, bad);
});

const page = (html, { type = 'text/html; charset=utf-8', status = 200, url = '' } = {}) => async () => { const r = new Response(html, { status, headers: { 'content-type': type } }); if (url) Object.defineProperty(r, 'url', { value: url }); return r; };

test('worker findVideosAt: fetches the page and returns only its videos; a video link says so; refuses local and odd', async () => {
  const r = await findVideosAt('https://news.example.com/story/1', { fetchImpl: page(PAGE) });
  assert.equal(r.direct, false); assert.equal(r.videos.length, 8); assert.equal(r.streams, 1);
  assert.ok(!JSON.stringify(r).includes('<html'), 'the page itself is never returned');
  const v = await findVideosAt('https://cdn.example.com/watch?v=1', { fetchImpl: page('', { type: 'video/mp4' }) });
  assert.equal(v.direct, true);
  await assert.rejects(findVideosAt('https://192.168.1.1/'), LinkError);
  await assert.rejects(findVideosAt('https://x.example.com/', { fetchImpl: page('', { url: 'https://10.0.0.1/' }) }), LinkError, 'a redirect to a local address');
  await assert.rejects(findVideosAt('https://x.example.com/a.zip', { fetchImpl: page('PK', { type: 'application/zip' }) }), /not a web page/);
  await assert.rejects(findVideosAt('https://x.example.com/', { fetchImpl: page('no', { status: 404 }) }), /answered 404/);
});

test('worker /api/findvideos: needs the token, POST only, a url', async () => {
  const tok = 'a'.repeat(32); const env = { CC_API_TOKEN: tok, DB: {} };
  const call = (init) => worker.fetch(new Request('https://w.example.com/api/findvideos', init), env);
  assert.equal((await call({ method: 'POST', body: JSON.stringify({ url: 'https://x.com/' }) })).status, 401);
  assert.equal((await call({ method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: '{}' })).status, 400);
  assert.equal((await call({ method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ url: 'https://127.0.0.1/' }) })).status, 422);
});
