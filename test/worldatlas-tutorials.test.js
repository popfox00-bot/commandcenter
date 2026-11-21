// WorldAtlas Tutorials (web/apps/worldatlas/tutorials/): the blocks, the designs it starts with, supply lists,
// the space a design takes, editing layers, links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKS, BLOCK, PRESET_PALETTE, searchBlocks } from '../web/apps/worldatlas/tutorials/blocks.js';
import { PRESETS } from '../web/apps/worldatlas/tutorials/designs.js';
import { blankDesign, setBlock, blockAt, fillLayer, copyLayerBelow, addLayer, removeLayer, resize, footprint, supplyList, stacksOf, youtubeId, cleanUrl, normalizeDesign, fromPlan } from '../web/apps/worldatlas/tutorials/tutorials-core.js';

test('blocks: hundreds of them, each once, searchable; the palette all real blocks', () => {
  assert.ok(BLOCKS.length > 500, `${BLOCKS.length} blocks`);
  assert.equal(new Set(BLOCKS.map((b) => b.id)).size, BLOCKS.length, 'no block twice');
  assert.ok(BLOCKS.every((b) => /^#[0-9a-f]{6}$/i.test(b.color) && b.h > 0 && b.h <= 1), 'a color and height each');
  assert.deepEqual(PRESET_PALETTE.filter((id) => !BLOCK[id]), []);
  assert.equal(searchBlocks('oak slab')[0].id, 'oak_slab'); assert.equal(searchBlocks('Observer')[0].id, 'observer');
  assert.ok(searchBlocks('glass').some((b) => b.id === 'light_blue_stained_glass'));
});

test('the designs it starts with: popular farms, every block real, each with videos and a supply list', () => {
  assert.ok(PRESETS.length >= 5);
  for (const p of PRESETS) {
    assert.deepEqual([...new Set(p.layers.flat().filter((id) => id && !BLOCK[id]))], [], `${p.name}: blocks`);
    assert.ok(p.links.length && p.links.every((l) => cleanUrl(l.url)), `${p.name}: links`);
    assert.ok(supplyList(p).length > 0 && footprint(p).w > 0, `${p.name}: what it needs`);
  }
  const cane = PRESETS.find((p) => /Sugar Cane/.test(p.name)); const list = supplyList(cane); const n = (name) => list.find((r) => r.name === name)?.count;
  assert.equal(n('Piston'), 8); assert.equal(n('Observer'), 8); assert.equal(n('Hopper'), 1);
  assert.equal(list.find((r) => r.name === 'Sugar Cane').kind, 'plant', 'grown cane apart from what to gather');
  assert.equal(PRESETS.find((p) => /Wheat/.test(p.name)).layers[0].filter((id) => id === 'farmland').length, 80, '9×9 less the water');
});

test('a design: built block by block and layer by layer; its supply list and the space it takes', () => {
  const d = blankDesign('Test', 4, 3, 2);
  setBlock(d, 0, 0, 0, 'stone'); setBlock(d, 3, 0, 2, 'stone'); setBlock(d, 9, 0, 0, 'stone');
  assert.equal(blockAt(d, 3, 0, 2), 'stone'); assert.equal(blockAt(d, 9, 0, 0), '', 'outside: nothing');
  fillLayer(d, 1, 'glass'); copyLayerBelow(d, 1);
  assert.equal(d.layers[1].filter(Boolean).length, 2, 'copied from below');
  fillLayer(d, 1, 'water'); addLayer(d, 1); setBlock(d, 1, 2, 1, 'hopper');
  assert.equal(d.h, 3);
  const list = supplyList({ ...d, extras: [{ name: 'Villager', count: 3 }] });
  assert.deepEqual(list.map((r) => [r.name, r.count, r.kind]), [['Stone', 2, 'block'], ['Hopper', 1, 'block'], ['Water', 12, 'liquid'], ['Villager', 3, 'extra']]);
  assert.deepEqual(footprint(d), { w: 4, l: 3, h: 3 });
  removeLayer(d, 1); assert.equal(d.h, 2); assert.equal(blockAt(d, 1, 1, 1), 'hopper', 'the layer above came down');
  resize(d, 2, 2, 2); assert.equal(blockAt(d, 0, 0, 0), 'stone'); assert.equal(d.layers[0].length, 4, 'smaller: the rest dropped');
  assert.deepEqual(footprint(blankDesign()), { w: 0, l: 0, h: 0 });
  assert.equal(stacksOf(40), '40'); assert.equal(stacksOf(64), '1 stack'); assert.equal(stacksOf(140), '2 stacks + 12');
});

test('links and stored designs: YouTube links known, only http(s), a design from storage made safe', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ'); assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ'); assert.equal(youtubeId('https://example.com'), null);
  assert.equal(cleanUrl('javascript:alert(1)'), null); assert.equal(cleanUrl(' https://youtu.be/x '), 'https://youtu.be/x');
  const d = normalizeDesign({ name: 'X', w: 2, l: 2, h: 1, layers: [['stone', 7]], links: [{ title: 'bad', url: 'javascript:x' }, { url: 'https://a.b/' }], extras: [{ name: 'Zombie', count: 0 }] });
  assert.deepEqual(d.layers[0], ['stone', '', '', '']); assert.equal(d.links.length, 1); assert.equal(d.extras[0].count, 1);
  assert.equal(normalizeDesign({ w: 999, l: 0, h: 'x' }).w, 64);
  assert.throws(() => fromPlan({ name: 'Bad' }, { S: 'stone' }, [['SX']]), /No block for "X"/);
});
