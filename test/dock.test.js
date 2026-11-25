// The Dock's Favorites (web/lib/dock.js): four apps, never the hidden area's, any gone replaced, swapped
// when one's picked that's already there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPS } from '../web/apps/index.js';
import { dockChoices, dockFavorites, DEFAULT_DOCK, setFavorite, DOCK_KEY } from '../web/lib/dock.js';

test('the Dock\'s Favorites: four, from the app\'s own apps (not the hidden area\'s), defaults to start', () => {
  const ids = dockChoices(APPS).map((a) => a.id);
  for (const x of ['hidden', 'magic', 'fm', 'fashion', 'downloads', 'saved', 'jobs', 'refill']) assert.ok(!ids.includes(x), `${x} not offered`);
  for (const x of ['notes', 'socials', 'clock', 'calendar', 'settings', 'games']) assert.ok(ids.includes(x), `${x} offered`);
  assert.deepEqual(dockFavorites(APPS, null), DEFAULT_DOCK);
  assert.deepEqual(dockFavorites(APPS, ['units', 'fm', 'nope']).slice(0, 1), ['units']);
  const f = dockFavorites(APPS, ['units', 'fm', 'nope']); assert.equal(f.length, 4); assert.equal(new Set(f).size, 4, 'each once'); assert.ok(!f.includes('fm'));
});

test('picking a Favorite already in the Dock swaps the two', () => {
  const mem = new Map(); globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  try {
    assert.deepEqual(setFavorite(APPS, 0, 'socials'), ['socials', 'clock', 'notes', 'calculator']);
    assert.deepEqual(JSON.parse(mem.get(DOCK_KEY)), ['socials', 'clock', 'notes', 'calculator']);
    assert.deepEqual(setFavorite(APPS, 3, 'draw'), ['socials', 'clock', 'notes', 'draw']);
  } finally { delete globalThis.localStorage; }
});
