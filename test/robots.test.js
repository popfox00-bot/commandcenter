import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, checkRobots } from '../src/core/robots.js';

const txt = `
User-agent: *
Disallow: /account/
Disallow: /*?print=
Allow: /account/public
Crawl-delay: 3

User-agent: BadBot
Disallow: /
`;

test('longest rule wins, allow wins ties, wildcards work', () => {
  const g = parseRobots(txt);
  assert.equal(checkRobots(g, '/en/search?kWord=x').allowed, true);
  assert.equal(checkRobots(g, '/account/settings').allowed, false);
  assert.equal(checkRobots(g, '/account/public/x').allowed, true);
  assert.equal(checkRobots(g, '/a/b?print=1').allowed, false);
  assert.equal(checkRobots(g, '/x').crawlDelay, 3);
  assert.equal(checkRobots(g, '/x', 'badbot').allowed, false);
});

test('empty robots allows everything', () => {
  assert.equal(checkRobots(parseRobots(''), '/anything').allowed, true);
});
