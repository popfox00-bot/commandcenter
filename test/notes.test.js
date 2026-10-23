// Notes app logic: grocery categories, quantities, catalog matching and suggestions, list grouping and
// sharing text, note sorting/search and previews.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, categorize, parseQuantity, makeItem, findInCatalog, suggest, groupItems, listToText, sortNotes, notePreview } from '../web/apps/notes/notes-core.js';

test('categorize: common groceries land in the right section, phrases beat single words', () => {
  const cases = {
    milk: 'dairy', butter: 'dairy', 'peanut butter': 'condiments', '2 lb ground beef': 'meat', bananas: 'fruit', avocados: 'produce',
    'ice cream': 'frozen', 'frozen pizza': 'frozen', 'chocolate milk': 'dairy', 'apple juice': 'drinks', 'Tillamook cheddar': 'dairy',
    'paper towels': 'household', 'dog food': 'pet', 'chicken breast': 'meat', 'green beans': 'produce', tortillas: 'bakery',
    Cheerios: 'breakfast', toothpaste: 'personal', diapers: 'baby', 'IPA beer': 'alcohol', salmon: 'seafood', 'oat milk': 'dairy',
    coffee: 'coffee', 'black beans': 'canned', 'olive oil': 'condiments', 'chocolate chips': 'baking', 'tortilla chips': 'snacks',
    'mystery gadget': 'other',
  };
  for (const [name, cat] of Object.entries(cases)) assert.equal(categorize(name), cat, name);
  assert.ok(CATEGORIES.every((c) => c.icon && c.name), 'every section has an icon');
});

test('quantities: numbers, units, words and "x2" are split from the name', () => {
  assert.deepEqual(parseQuantity('2 lb ground beef'), { qty: '2 lb', name: 'ground beef' });
  assert.deepEqual(parseQuantity('2lb ground beef'), { qty: '2 lb', name: 'ground beef' });
  assert.deepEqual(parseQuantity('3 cans black beans'), { qty: '3 cans', name: 'black beans' });
  assert.deepEqual(parseQuantity('a loaf of bread'), { qty: '1 loaf', name: 'bread' });
  assert.deepEqual(parseQuantity('an onion'), { qty: '', name: 'onion' });
  assert.deepEqual(parseQuantity('milk x2'), { qty: '2', name: 'milk' });
  assert.deepEqual(parseQuantity('apple juice'), { qty: '', name: 'apple juice' }, 'the "a" of apple is not a quantity');
  assert.deepEqual(parseQuantity('7up'), { qty: '', name: '7up' });
});

test('catalog: saved items (brand, photo, section) are reused and suggested by what is typed', () => {
  const catalog = [
    { id: 'c1', name: 'Shredded cheddar', category: 'dairy', brand: 'Tillamook', photoId: 'p1', timesBought: 5 },
    { id: 'c2', name: 'Sharp cheddar block', category: 'dairy', brand: 'Kerrygold', timesBought: 1 },
    { id: 'c3', name: 'Strawberries', category: 'fruit', timesBought: 3 },
  ];
  const item = makeItem('2 shredded cheddar', catalog, 'i1');
  assert.deepEqual({ ...item, added: 0 }, { id: 'i1', name: 'Shredded cheddar', qty: '2', done: false, category: 'dairy', catalogId: 'c1', added: 0 });
  assert.equal(findInCatalog(catalog, 'strawberry').id, 'c3', 'singular/plural match');
  assert.deepEqual(suggest(catalog, 'ched').map((c) => c.id), ['c1', 'c2'], 'word-start matches, most bought first');
  assert.deepEqual(suggest(catalog, 'kerry').map((c) => c.id), ['c2'], 'brand matches');
  assert.equal(makeItem('bok choy', catalog).category, 'other');
});

test('list: grouped by store section in walking order; checked items go to the cart; share text', () => {
  const items = [
    { id: '1', name: 'Paper towels', qty: '', category: 'household', added: 1 },
    { id: '2', name: 'Bananas', qty: '', category: 'fruit', added: 2 },
    { id: '3', name: 'Shredded cheddar', qty: '2', category: 'dairy', catalogId: 'c1', note: 'if on sale', added: 3 },
    { id: '4', name: 'Spinach', qty: '', category: 'produce', added: 4 },
    { id: '5', name: 'Milk', qty: '', category: 'dairy', done: true, doneAt: 9, added: 5 },
  ];
  const { groups, done } = groupItems(items);
  assert.deepEqual(groups.map((g) => g.category.id), ['produce', 'fruit', 'dairy', 'household']);
  assert.deepEqual(done.map((i) => i.name), ['Milk']);
  const text = listToText(items, [{ id: 'c1', brand: 'Tillamook' }]);
  assert.equal(text, '🛒 Grocery list\n\n🥦 Produce\n• Spinach\n\n🍎 Fruit\n• Bananas\n\n🧀 Dairy & Eggs\n• 2 Shredded cheddar (Tillamook, if on sale)\n\n🧽 Household & Cleaning\n• Paper towels');
  assert.match(listToText([]), /nothing left to buy/);
});

test('notes: pinned first then newest; search covers title, text and checklist; previews', () => {
  const notes = [
    { id: 'a', title: 'Old', body: 'garage door 16 ft', updated: 1 },
    { id: 'b', title: 'Camping', body: '', checklist: [{ text: 'Tent', done: true }, { text: 'Stove', done: false }], updated: 3 },
    { id: 'c', title: 'Pinned', body: 'wifi password on fridge', pinned: true, updated: 2 },
  ];
  assert.deepEqual(sortNotes(notes).map((n) => n.id), ['c', 'b', 'a']);
  assert.deepEqual(sortNotes(notes, 'stove').map((n) => n.id), ['b']);
  assert.deepEqual(sortNotes(notes, 'GARAGE').map((n) => n.id), ['a']);
  assert.equal(notePreview(notes[1]), '☑ 1/2 · Stove');
  assert.equal(notePreview(notes[0]), 'garage door 16 ft');
});

test('item icons: each food type gets its own icon, falling back to the section icon', async () => {
  const { itemIcon } = await import('../web/apps/notes/notes-core.js');
  const cases = { bananas: '🍌', milk: '🥛', 'Shredded cheddar': '🧀', 'peanut butter': '🥜', 'paper towels': '🧻', '2 lb ground beef': '🥩', spinach: '🥬', avocados: '🥑', 'chocolate milk': '🥛', 'apple juice': '🧃', 'ice cream': '🍨', 'chicken breast': '🍗', 'dog food': '🐶', eggs: '🥚', 'mystery gadget': '🛒', 'Kerrygold': '🛒' };
  for (const [n, icon] of Object.entries(cases)) assert.equal(itemIcon(n), icon, n);
  assert.equal(itemIcon('Kerrygold', 'dairy'), '🧀', 'unknown name uses its section icon');
});
