// Notes app logic without the DOM: grocery categories (with icons), guessing an item's category from
// its name, list ordering by store section, quantities, and the shareable text version of a list.

/** Store sections in a typical walking order, each with an icon. */
export const CATEGORIES = [
  { id: 'produce', name: 'Produce', icon: '🥦' },
  { id: 'fruit', name: 'Fruit', icon: '🍎' },
  { id: 'bakery', name: 'Bakery & Bread', icon: '🍞' },
  { id: 'deli', name: 'Deli', icon: '🥪' },
  { id: 'meat', name: 'Meat', icon: '🥩' },
  { id: 'seafood', name: 'Seafood', icon: '🐟' },
  { id: 'dairy', name: 'Dairy & Eggs', icon: '🧀' },
  { id: 'breakfast', name: 'Breakfast & Cereal', icon: '🥣' },
  { id: 'pasta', name: 'Pasta, Rice & Grains', icon: '🍝' },
  { id: 'canned', name: 'Canned & Jarred', icon: '🥫' },
  { id: 'condiments', name: 'Condiments & Sauces', icon: '🫙' },
  { id: 'baking', name: 'Baking & Spices', icon: '🧂' },
  { id: 'snacks', name: 'Snacks & Sweets', icon: '🍿' },
  { id: 'drinks', name: 'Drinks', icon: '🥤' },
  { id: 'coffee', name: 'Coffee & Tea', icon: '☕' },
  { id: 'alcohol', name: 'Beer & Wine', icon: '🍷' },
  { id: 'frozen', name: 'Frozen', icon: '❄️' },
  { id: 'household', name: 'Household & Cleaning', icon: '🧽' },
  { id: 'personal', name: 'Personal Care', icon: '🧴' },
  { id: 'pharmacy', name: 'Pharmacy & Health', icon: '💊' },
  { id: 'baby', name: 'Baby', icon: '🍼' },
  { id: 'pet', name: 'Pet', icon: '🐾' },
  { id: 'other', name: 'Other', icon: '🛒' },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, { ...c, order: i }]));

// Words that place an item. Multi-word phrases (MULTI) are checked first, longest first, so
// "peanut butter" beats "butter", "frozen pizza" beats "pizza" and "ice cream" beats "cream".
const WORDS = {
  produce: 'lettuce spinach kale arugula salad greens romaine cabbage broccoli cauliflower carrot carrots celery cucumber cucumbers zucchini squash pepper peppers bell pepper jalapeno onion onions garlic potato potatoes sweet potato yam tomato tomatoes avocado avocados mushroom mushrooms corn green beans asparagus brussels sprouts cilantro parsley basil herbs ginger scallion scallions green onion leek beets radish eggplant',
  fruit: 'apple apples banana bananas orange oranges lemon lemons lime limes grapes grape strawberries strawberry blueberries blueberry raspberries blackberries berries peach peaches pear pears plum plums mango mangoes pineapple watermelon melon cantaloupe cherries kiwi grapefruit clementines cuties nectarines pomegranate',
  bakery: 'bread loaf bagel bagels buns bun rolls roll tortillas tortilla pita croissant croissants muffin muffins english muffins baguette sourdough naan cake donuts donut pie',
  deli: 'deli turkey deli ham sliced cheese salami pepperoni prosciutto hummus rotisserie chicken lunch meat',
  meat: 'chicken beef steak ground beef pork bacon sausage sausages ham turkey lamb ribs brisket hot dogs hotdogs meatballs chicken breast chicken thighs ground turkey roast chorizo',
  seafood: 'fish salmon tuna steak shrimp cod tilapia crab lobster scallops mahi halibut',
  dairy: 'milk eggs egg butter cheese cheddar mozzarella parmesan yogurt greek yogurt cream heavy cream half and half sour cream cream cheese cottage cheese creamer oat milk almond milk whipped cream',
  breakfast: 'cereal oatmeal oats granola pancake mix waffles syrup maple syrup pop tarts cheerios frosted flakes',
  pasta: 'pasta spaghetti penne macaroni noodles ramen rice quinoa couscous lasagna mac and cheese',
  canned: 'canned beans black beans chickpeas soup broth stock tomato sauce diced tomatoes tomato paste tuna can canned tuna canned corn pickles olives salsa',
  condiments: 'ketchup mustard mayo mayonnaise ranch dressing salad dressing bbq sauce hot sauce soy sauce sriracha vinegar olive oil oil vegetable oil peanut butter jelly jam honey nutella teriyaki pesto marinara alfredo',
  baking: 'flour sugar brown sugar baking soda baking powder yeast vanilla chocolate chips cocoa salt pepper spices cinnamon paprika cumin oregano seasoning sprinkles cake mix cornstarch',
  snacks: 'chips tortilla chips crackers pretzels popcorn cookies candy chocolate granola bars nuts almonds peanuts trail mix jerky goldfish fruit snacks gum',
  drinks: 'water sparkling water soda pop juice orange juice lemonade gatorade sports drink energy drink kombucha la croix seltzer',
  coffee: 'coffee coffee beans k cups kcups tea green tea',
  alcohol: 'beer wine red wine white wine seltzers hard seltzer vodka whiskey tequila rum',
  frozen: 'pizza frozen ice cream frozen pizza frozen vegetables frozen fruit ice popsicles frozen meals tater tots fries french fries frozen waffles',
  household: 'paper towels toilet paper tissues napkins trash bags garbage bags dish soap dishwasher pods detergent laundry detergent dryer sheets bleach cleaner wipes sponges foil aluminum foil plastic wrap ziploc bags batteries light bulbs',
  personal: 'shampoo conditioner soap body wash toothpaste toothbrush floss mouthwash deodorant razors lotion sunscreen tampons pads cotton swabs q tips',
  pharmacy: 'vitamins ibuprofen advil tylenol acetaminophen allergy medicine cold medicine bandaids band aids prescription allergy',
  baby: 'diapers baby wipes formula baby food',
  pet: 'dog food cat food cat litter litter dog treats cat treats pet food',
};
// Multi-word phrases (written out explicitly so splitting on spaces doesn't lose them).
const MULTI = [
  ['peanut butter', 'condiments'], ['ice cream', 'frozen'], ['frozen pizza', 'frozen'], ['frozen vegetables', 'frozen'], ['frozen fruit', 'frozen'], ['frozen meals', 'frozen'], ['frozen waffles', 'frozen'], ['frosted flakes', 'breakfast'], ['pizza sauce', 'condiments'], ['tater tots', 'frozen'], ['french fries', 'frozen'],
  ['sweet potato', 'produce'], ['green beans', 'produce'], ['green onion', 'produce'], ['bell pepper', 'produce'], ['brussels sprouts', 'produce'],
  ['english muffins', 'bakery'], ['hot dog buns', 'bakery'], ['hamburger buns', 'bakery'],
  ['lunch meat', 'deli'], ['deli turkey', 'deli'], ['rotisserie chicken', 'deli'], ['sliced cheese', 'dairy'],
  ['ground beef', 'meat'], ['ground turkey', 'meat'], ['chicken breast', 'meat'], ['chicken thighs', 'meat'], ['hot dogs', 'meat'],
  ['heavy cream', 'dairy'], ['half and half', 'dairy'], ['sour cream', 'dairy'], ['cream cheese', 'dairy'], ['cottage cheese', 'dairy'], ['greek yogurt', 'dairy'], ['oat milk', 'dairy'], ['almond milk', 'dairy'], ['whipped cream', 'dairy'],
  ['pancake mix', 'breakfast'], ['maple syrup', 'breakfast'], ['pop tarts', 'breakfast'],
  ['mac and cheese', 'pasta'],
  ['black beans', 'canned'], ['tomato sauce', 'canned'], ['diced tomatoes', 'canned'], ['tomato paste', 'canned'], ['canned tuna', 'canned'],
  ['salad dressing', 'condiments'], ['bbq sauce', 'condiments'], ['hot sauce', 'condiments'], ['soy sauce', 'condiments'], ['olive oil', 'condiments'], ['vegetable oil', 'condiments'],
  ['brown sugar', 'baking'], ['baking soda', 'baking'], ['baking powder', 'baking'], ['chocolate chips', 'baking'], ['cake mix', 'baking'],
  ['tortilla chips', 'snacks'], ['granola bars', 'snacks'], ['trail mix', 'snacks'], ['fruit snacks', 'snacks'],
  ['sparkling water', 'drinks'], ['orange juice', 'drinks'], ['sports drink', 'drinks'], ['energy drink', 'drinks'], ['la croix', 'drinks'],
  ['coffee beans', 'coffee'], ['k cups', 'coffee'], ['green tea', 'coffee'],
  ['red wine', 'alcohol'], ['white wine', 'alcohol'], ['hard seltzer', 'alcohol'],
  ['paper towels', 'household'], ['toilet paper', 'household'], ['trash bags', 'household'], ['garbage bags', 'household'], ['dish soap', 'household'], ['dishwasher pods', 'household'], ['laundry detergent', 'household'], ['dryer sheets', 'household'], ['aluminum foil', 'household'], ['plastic wrap', 'household'], ['ziploc bags', 'household'], ['light bulbs', 'household'],
  ['body wash', 'personal'], ['cotton swabs', 'personal'], ['q tips', 'personal'],
  ['allergy medicine', 'pharmacy'], ['cold medicine', 'pharmacy'], ['band aids', 'pharmacy'],
  ['baby wipes', 'baby'], ['baby food', 'baby'],
  ['dog food', 'pet'], ['cat food', 'pet'], ['cat litter', 'pet'], ['dog treats', 'pet'], ['cat treats', 'pet'], ['pet food', 'pet'],
].sort((a, b) => b[0].length - a[0].length);
// Single words: each list minus its multi-word phrases (so "peanut butter" doesn't make "butter" a condiment).
const SINGLE = new Map();
for (const [cat, list] of Object.entries(WORDS)) {
  let rest = ` ${list} `;
  for (const [phrase] of MULTI) rest = rest.replaceAll(` ${phrase} `, ' ');
  for (const w of rest.split(' ')) if (w.length > 1 && !SINGLE.has(w)) SINGLE.set(w, cat);
}
// Ambiguous single words where the more common meaning wins.
for (const [w, c] of [['chicken', 'meat'], ['turkey', 'meat'], ['ham', 'meat'], ['tuna', 'seafood'], ['steak', 'meat'], ['pepper', 'produce'], ['chocolate', 'snacks'], ['salt', 'baking'], ['cream', 'dairy'], ['oil', 'condiments'], ['ice', 'frozen'], ['allergy', 'pharmacy'], ['tea', 'coffee'], ['pie', 'bakery'], ['beans', 'canned'], ['corn', 'produce'], ['soap', 'personal'], ['wipes', 'household']]) SINGLE.set(w, c);

export const normalizeName = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9&' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const singular = (w) => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('es') && /(ch|sh|o|x|s)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Best-guess store section for an item name ("2 lb ground beef" -> meat). */
export function categorize(name) {
  const n = ` ${normalizeName(parseQuantity(name).name)} `;
  for (const [phrase, cat] of MULTI) if (n.includes(` ${phrase} `)) return cat;
  const words = n.trim().split(' ');
  // Last word first: "chocolate milk" is milk, "apple juice" is juice.
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (SINGLE.has(w)) return SINGLE.get(w);
    if (SINGLE.has(singular(w))) return SINGLE.get(singular(w));
  }
  return 'other';
}

/** "2 lb ground beef" -> { qty: '2 lb', name: 'ground beef' }; "milk x2" -> { qty: '2', name: 'milk' }. */
export function parseQuantity(input) {
  const s = String(input ?? '').trim().replace(/\s+/g, ' ');
  const unit = '(?:lbs?|pounds?|oz|ounces?|kg|g|gal(?:lons?)?|qt|quarts?|pints?|l|liters?|ml|dozen|doz|cans?|bags?|boxes?|bottles?|jars?|packs?|pkgs?|bunch(?:es)?|heads?|loaves|loaf|cartons?|ct|count)';
  // Digits may touch a unit ("2lb") but not a word ("7up"); number words need a space ("a loaf", not the "a" of "apple").
  let m = new RegExp(`^(?:(\\d+(?:[.,/]\\d+)?)(?:\\s*(${unit})\\b\\s*|\\s+)|(a|an|one|two|three|four|five|six|half)\\s+(?:(${unit})\\b\\s*)?)(?:of\\s+)?(.+)$`, 'i').exec(s);
  if (m && m[5] && !/^\d/.test(m[5])) {
    const words = { a: '1', an: '1', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', half: '½' };
    const n = m[1] ?? words[m[3].toLowerCase()];
    const u = m[2] ?? m[4];
    if (!u && m[3] && /^(a|an|one)$/i.test(m[3])) return { qty: '', name: m[5] };
    return { qty: [n, u].filter(Boolean).join(' '), name: m[5] };
  }
  m = /^(.+?)\s*(?:x|×)\s*(\d+)$/i.exec(s);
  if (m) return { qty: m[2], name: m[1] };
  return { qty: '', name: s };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A new list item from what was typed, reusing a saved "My items" entry when the name matches. */
export function makeItem(input, catalog = [], id = crypto.randomUUID()) {
  const { qty, name } = parseQuantity(input);
  const known = findInCatalog(catalog, name);
  return {
    id, name: known?.name ?? cap(name.trim()), qty, done: false,
    category: known?.category ?? categorize(name), catalogId: known?.id ?? null, added: Date.now(),
  };
}

export function findInCatalog(catalog, name) {
  const n = normalizeName(name);
  if (!n) return null;
  return catalog.find((c) => normalizeName(c.name) === n) ?? catalog.find((c) => singular(normalizeName(c.name)) === singular(n)) ?? null;
}

/** Catalog suggestions for what is being typed: prefix matches first, then most bought. */
export function suggest(catalog, typed, limit = 6) {
  const t = normalizeName(parseQuantity(typed).name);
  if (!t) return [];
  return catalog
    .map((c) => {
      const n = normalizeName(c.name); const b = normalizeName(c.brand ?? '');
      const score = n.startsWith(t) ? 3 : n.split(' ').some((w) => w.startsWith(t)) ? 2 : (n.includes(t) || b.includes(t)) ? 1 : 0;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.c.timesBought ?? 0) - (a.c.timesBought ?? 0) || a.c.name.localeCompare(b.c.name))
    .slice(0, limit).map((x) => x.c);
}

/** Group list items by section, in store order; checked items go last ("In the cart"). */
export function groupItems(items) {
  const open = items.filter((i) => !i.done);
  const groups = [];
  for (const c of CATEGORIES) {
    const list = open.filter((i) => (CATEGORY[i.category] ? i.category : 'other') === c.id).sort((a, b) => a.added - b.added);
    if (list.length) groups.push({ category: c, items: list });
  }
  return { groups, done: items.filter((i) => i.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)) };
}

/** Plain-text list for sharing (Messages, email), grouped with icons. */
export function listToText(items, catalog = [], title = 'Grocery list') {
  const { groups } = groupItems(items);
  const lines = [`🛒 ${title}`];
  for (const g of groups) {
    lines.push('', `${g.category.icon} ${g.category.name}`);
    for (const i of g.items) {
      const c = i.catalogId ? catalog.find((x) => x.id === i.catalogId) : null;
      const extra = [c?.brand, i.note].filter(Boolean).join(', ');
      lines.push(`• ${i.qty ? `${i.qty} ` : ''}${i.name}${extra ? ` (${extra})` : ''}`);
    }
  }
  if (!groups.length) lines.push('', '(nothing left to buy)');
  return lines.join('\n');
}

/** Notes: newest first, pinned on top; search matches title, text and checklist items. */
export function sortNotes(notes, query = '') {
  const q = normalizeName(query);
  const hit = (n) => !q || normalizeName(`${n.title} ${n.body} ${(n.checklist ?? []).map((c) => c.text).join(' ')}`).includes(q);
  return notes.filter(hit).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updated - a.updated);
}

/** A short preview line for a note card. */
export function notePreview(n) {
  if (n.checklist?.length) {
    const done = n.checklist.filter((c) => c.done).length;
    return `☑ ${done}/${n.checklist.length} · ${n.checklist.filter((c) => !c.done).slice(0, 3).map((c) => c.text).join(', ')}`;
  }
  return String(n.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

// Item-level icons (the section icon is the fallback): checked longest phrase first, then last word.
const ITEM_ICONS = Object.entries({
  '🍌': 'banana bananas', '🍎': 'apple apples', '🍊': 'orange oranges clementines cuties', '🍋': 'lemon lemons lime limes', '🍇': 'grape grapes',
  '🍓': 'strawberry strawberries', '🫐': 'blueberries blueberry berries raspberries blackberries', '🍑': 'peach peaches nectarines', '🍐': 'pear pears',
  '🥭': 'mango mangoes', '🍍': 'pineapple', '🍉': 'watermelon', '🍈': 'melon cantaloupe', '🍒': 'cherries', '🥝': 'kiwi',
  '🥑': 'avocado avocados guacamole', '🥬': 'lettuce spinach kale romaine greens arugula cabbage bok choy', '🥦': 'broccoli', '🥕': 'carrot carrots',
  '🥒': 'cucumber cucumbers zucchini pickles', '🫑': 'bell pepper peppers', '🌶️': 'jalapeno jalapenos chili chiles hot sauce sriracha salsa', '🧅': 'onion onions scallions green onion leek',
  '🧄': 'garlic', '🥔': 'potato potatoes tater tots', '🍠': 'sweet potato yam', '🍅': 'tomato tomatoes tomato sauce diced tomatoes marinara ketchup', '🍄': 'mushroom mushrooms',
  '🌽': 'corn', '🫘': 'beans black beans chickpeas', '🌿': 'cilantro parsley basil herbs', '🫚': 'ginger',
  '🍞': 'bread loaf sourdough baguette toast', '🥯': 'bagel bagels', '🥐': 'croissant croissants', '🫓': 'tortilla tortillas pita naan', '🧁': 'muffin muffins cupcakes', '🍩': 'donut donuts',
  '🥩': 'steak beef ground beef roast brisket ribs', '🍗': 'chicken chicken breast chicken thighs rotisserie chicken wings', '🥓': 'bacon', '🌭': 'hot dogs hotdogs sausage sausages bratwurst', '🍖': 'pork ham lamb', '🦃': 'turkey ground turkey',
  '🐟': 'fish salmon tuna cod tilapia halibut', '🦐': 'shrimp', '🦀': 'crab lobster',
  '🥛': 'milk oat milk almond milk half and half cream heavy cream creamer', '🧀': 'cheese cheddar mozzarella parmesan cream cheese cottage cheese', '🧈': 'butter', '🥚': 'egg eggs', '🍦': 'yogurt greek yogurt',
  '🥣': 'cereal oatmeal oats granola cheerios', '🥞': 'pancake mix pancakes waffles', '🍁': 'maple syrup syrup',
  '🍝': 'pasta spaghetti penne macaroni lasagna noodles mac and cheese', '🍚': 'rice quinoa couscous', '🍜': 'ramen soup broth stock',
  '🥜': 'peanut butter peanuts nuts almonds', '🍯': 'honey', '🍓 ': 'jam jelly', '🫒': 'olive oil olives oil vegetable oil', '🥫': 'canned tuna can soup',
  '🧂': 'salt pepper spices seasoning', '🌾': 'flour', '🍬': 'sugar brown sugar candy', '🍫': 'chocolate chocolate chips cocoa nutella', '🍪': 'cookies', '🥨': 'pretzels crackers goldfish',
  '🍿': 'popcorn', '🥔 ': 'chips tortilla chips', '🍕': 'pizza frozen pizza', '🍨': 'ice cream popsicles', '🧊': 'ice',
  '💧': 'water sparkling water seltzer la croix', '🧃': 'juice orange juice apple juice lemonade', '🥤': 'soda pop gatorade sports drink energy drink kombucha',
  '☕': 'coffee coffee beans k cups', '🍵': 'tea green tea', '🍺': 'beer ipa', '🍷': 'wine red wine white wine', '🥃': 'whiskey vodka tequila rum',
  '🧻': 'paper towels toilet paper napkins tissues', '🗑️': 'trash bags garbage bags', '🧼': 'soap dish soap hand soap', '🧺': 'detergent laundry detergent dryer sheets',
  '🧽': 'sponges cleaner bleach wipes', '🔋': 'batteries', '💡': 'light bulbs', '🧴': 'shampoo conditioner lotion sunscreen body wash', '🪥': 'toothpaste toothbrush floss mouthwash',
  '🪒': 'razors', '💊': 'vitamins ibuprofen advil tylenol medicine', '🩹': 'bandaids band aids', '🧷': 'diapers', '🍼': 'formula baby food',
  '🐶': 'dog food dog treats', '🐱': 'cat food cat treats cat litter litter',
}).flatMap(([icon, words]) => {
  const out = [];
  for (const m of [...MULTI.map(([p]) => p)].filter((p) => ` ${words} `.includes(` ${p} `))) out.push([m, icon.trim()]);
  for (const w of words.split(' ')) out.push([w, icon.trim()]);
  return out;
});
const ICON_PHRASES = ITEM_ICONS.filter(([p]) => p.includes(' ')).sort((a, b) => b[0].length - a[0].length);
const ICON_WORDS = new Map();
for (const [w, i] of ITEM_ICONS) if (!w.includes(' ') && !ICON_WORDS.has(w)) ICON_WORDS.set(w, i);

/** An icon for this particular item ("bananas" -> 🍌), falling back to its section's icon. */
export function itemIcon(name, category = categorize(name)) {
  const n = ` ${normalizeName(parseQuantity(name).name)} `;
  for (const [phrase, icon] of ICON_PHRASES) if (n.includes(` ${phrase} `)) return icon;
  const words = n.trim().split(' ');
  for (let i = words.length - 1; i >= 0; i--) {
    const hit = ICON_WORDS.get(words[i]) ?? ICON_WORDS.get(singular(words[i]));
    if (hit) return hit;
  }
  return (CATEGORY[category] ?? CATEGORY.other).icon;
}
