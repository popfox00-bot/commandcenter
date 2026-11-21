// WorldAtlas Tutorials: the blocks a design is built from. Every Bedrock block family (stones, woods, every
// colored block, ores, redstone, plants, liquids, utility blocks), each with a color to draw it in, how tall
// it is (a slab half, a carpet a sliver) and how see-through (glass, water). Searchable by name. Not every
// rare block's exact shade: close enough to read a design at a glance.

/** @typedef {{ id: string, name: string, color: string, h?: number, alpha?: number, cat: string, item?: boolean }} Block */

/** @type {Block[]} */
export const BLOCKS = [];
const add = (id, name, color, cat, o = {}) => { BLOCKS.push({ id, name, color, cat, h: o.h ?? 1, alpha: o.alpha ?? 1, ...(o.item ? { item: true } : {}) }); };
const cap = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Natural ground.
for (const [id, c] of [['grass_block', '#5d9b3a'], ['dirt', '#866043'], ['coarse_dirt', '#77553b'], ['rooted_dirt', '#90674d'], ['podzol', '#6a4b21'], ['mycelium', '#6f6265'], ['mud', '#3c393d'], ['packed_mud', '#8e6b50'], ['clay', '#a0a6b3'], ['sand', '#dbcfa3'], ['red_sand', '#be6621'], ['gravel', '#857f7c'], ['suspicious_sand', '#d8c99c'], ['suspicious_gravel', '#807b78'], ['snow_block', '#f4fcfc'], ['ice', '#8fb5fe'], ['packed_ice', '#8db4fa'], ['blue_ice', '#74a7fd'], ['moss_block', '#596e2d'], ['mud_bricks', '#89684f'], ['bone_block', '#e1dcc6'], ['dripstone_block', '#866b5c'], ['magma_block', '#8e3f1f'], ['soul_sand', '#513e32'], ['soul_soil', '#4b3a2f'], ['netherrack', '#6f3533'], ['crimson_nylium', '#832121'], ['warped_nylium', '#2b7265'], ['end_stone', '#dbdea0'], ['sculk', '#0c1d24']]) add(id, cap(id), c, 'Ground');
add('farmland', 'Farmland', '#5b3d22', 'Ground', { h: 0.94 }); add('dirt_path', 'Dirt Path', '#947a41', 'Ground', { h: 0.94 });
add('snow', 'Snow Layer', '#f4fcfc', 'Ground', { h: 0.13 }); add('moss_carpet', 'Moss Carpet', '#596e2d', 'Ground', { h: 0.06 });

// Stone and the like (each with its stairs, slab and wall where Bedrock has them).
const stones = [['stone', '#7d7d7d'], ['cobblestone', '#7a7a7a'], ['mossy_cobblestone', '#6e7a5e'], ['smooth_stone', '#9e9e9e'], ['stone_bricks', '#7a7979'], ['mossy_stone_bricks', '#737a63'], ['cracked_stone_bricks', '#767575'], ['chiseled_stone_bricks', '#777676'], ['granite', '#956755'], ['polished_granite', '#9a6a59'], ['diorite', '#bcbcbd'], ['polished_diorite', '#c0c1c2'], ['andesite', '#888889'], ['polished_andesite', '#848685'], ['deepslate', '#505053'], ['cobbled_deepslate', '#4d4d51'], ['polished_deepslate', '#48484a'], ['deepslate_bricks', '#464646'], ['deepslate_tiles', '#363637'], ['tuff', '#6c6d66'], ['polished_tuff', '#626a64'], ['tuff_bricks', '#636860'], ['calcite', '#dfe0dc'], ['blackstone', '#2a2328'], ['polished_blackstone', '#35303b'], ['polished_blackstone_bricks', '#302a31'], ['basalt', '#515156'], ['smooth_basalt', '#48484e'], ['obsidian', '#0f0b19'], ['crying_obsidian', '#200a3c'], ['bedrock', '#555555'], ['end_stone_bricks', '#dae0a2'], ['purpur_block', '#a97da9'], ['purpur_pillar', '#ab81ab'], ['nether_bricks', '#2c1519'], ['red_nether_bricks', '#450709'], ['quartz_block', '#ece6df'], ['smooth_quartz', '#ece6df'], ['quartz_bricks', '#eae5dd'], ['quartz_pillar', '#ebe6e0'], ['prismarine', '#63a29a'], ['prismarine_bricks', '#63ac9e'], ['dark_prismarine', '#335b4b'], ['sandstone', '#d8cb9b'], ['cut_sandstone', '#d9ce9f'], ['smooth_sandstone', '#e0d6aa'], ['chiseled_sandstone', '#d8ca9b'], ['red_sandstone', '#ba631d'], ['cut_red_sandstone', '#bd6620'], ['smooth_red_sandstone', '#b5621f'], ['bricks', '#976253'], ['terracotta', '#985e43']];
for (const [id, c] of stones) {
  add(id, cap(id), c, 'Stone');
  if (!/pillar|chiseled|cracked|bedrock|obsidian|crying|basalt$|calcite|terracotta|cut_/.test(id)) {
    const base = id.replace(/_bricks$/, '_brick').replace(/_tiles$/, '_tile').replace(/^bricks$/, 'brick').replace(/_block$/, '');
    add(`${base}_stairs`, `${cap(base)} Stairs`, c, 'Stone'); add(`${base}_slab`, `${cap(base)} Slab`, c, 'Stone', { h: 0.5 }); add(`${base}_wall`, `${cap(base)} Wall`, c, 'Stone');
  }
}

// Woods: each kind's log, planks and the rest.
const woods = [['oak', '#b8945f', '#6d5432', '#3d7a1c'], ['spruce', '#7a5a34', '#3b2711', '#2f4f2f'], ['birch', '#d7c185', '#d8d7d2', '#5c8a3a'], ['jungle', '#b88764', '#56441c', '#2f8a1a'], ['acacia', '#ad5d32', '#6a5f55', '#5a8a1c'], ['dark_oak', '#4a3118', '#3c2e1a', '#2a4f12'], ['mangrove', '#763631', '#544332', '#4a7a1c'], ['cherry', '#e3b3ad', '#3a1a22', '#e8a6c9'], ['pale_oak', '#e3d9d3', '#5b5654', '#7e8a77'], ['bamboo', '#c9b25a', '#8a8a2a', null], ['crimson', '#653147', '#5c1a1e', null], ['warped', '#2b6963', '#3a3a4d', null]];
for (const [w, plank, log, leaf] of woods) {
  const n = cap(w); const stem = w === 'crimson' || w === 'warped' ? 'Stem' : w === 'bamboo' ? 'Block' : 'Log';
  add(`${w}_${stem.toLowerCase()}`, `${n} ${stem}`, log, 'Wood'); add(`stripped_${w}_${stem.toLowerCase()}`, `Stripped ${n} ${stem}`, plank, 'Wood');
  add(`${w}_planks`, `${n} Planks`, plank, 'Wood'); add(`${w}_stairs`, `${n} Stairs`, plank, 'Wood'); add(`${w}_slab`, `${n} Slab`, plank, 'Wood', { h: 0.5 });
  add(`${w}_fence`, `${n} Fence`, plank, 'Wood'); add(`${w}_fence_gate`, `${n} Fence Gate`, plank, 'Wood'); add(`${w}_door`, `${n} Door`, plank, 'Wood');
  add(`${w}_trapdoor`, `${n} Trapdoor`, plank, 'Wood', { h: 0.19 }); add(`${w}_button`, `${n} Button`, plank, 'Wood', { h: 0.13 }); add(`${w}_pressure_plate`, `${n} Pressure Plate`, plank, 'Wood', { h: 0.06 });
  add(`${w}_sign`, `${n} Sign`, plank, 'Wood', { h: 0.5 }); add(`${w}_hanging_sign`, `${n} Hanging Sign`, plank, 'Wood', { h: 0.5 });
  if (leaf) add(`${w}_leaves`, `${n} Leaves`, leaf, 'Wood', { alpha: 0.85 });
}
add('bamboo_mosaic', 'Bamboo Mosaic', '#c3ab54', 'Wood'); add('bookshelf', 'Bookshelf', '#7d5d38', 'Wood'); add('chiseled_bookshelf', 'Chiseled Bookshelf', '#7d5d38', 'Wood');
add('ladder', 'Ladder', '#8d6c3c', 'Wood', { h: 0.15 }); add('scaffolding', 'Scaffolding', '#c7a95c', 'Wood', { alpha: 0.7 });

// Every color: wool, carpet, concrete, its powder, terracotta, glazed terracotta, stained glass and panes,
// beds, candles, shulker boxes.
const colors = [['white', '#e9ecec'], ['light_gray', '#8e8e86'], ['gray', '#3e4447'], ['black', '#141519'], ['brown', '#724728'], ['red', '#a12722'], ['orange', '#f07613'], ['yellow', '#f8c527'], ['lime', '#70b919'], ['green', '#546d1b'], ['cyan', '#158991'], ['light_blue', '#3aafd9'], ['blue', '#35399d'], ['purple', '#792aac'], ['magenta', '#bd44b3'], ['pink', '#ed8dac']];
for (const [c, hex] of colors) {
  const n = cap(c);
  add(`${c}_wool`, `${n} Wool`, hex, 'Colored'); add(`${c}_carpet`, `${n} Carpet`, hex, 'Colored', { h: 0.06 });
  add(`${c}_concrete`, `${n} Concrete`, hex, 'Colored'); add(`${c}_concrete_powder`, `${n} Concrete Powder`, hex, 'Colored');
  add(`${c}_terracotta`, `${n} Terracotta`, hex, 'Colored'); add(`${c}_glazed_terracotta`, `${n} Glazed Terracotta`, hex, 'Colored');
  add(`${c}_stained_glass`, `${n} Stained Glass`, hex, 'Colored', { alpha: 0.45 }); add(`${c}_stained_glass_pane`, `${n} Stained Glass Pane`, hex, 'Colored', { alpha: 0.45 });
  add(`${c}_bed`, `${n} Bed`, hex, 'Colored', { h: 0.56 }); add(`${c}_candle`, `${n} Candle`, hex, 'Colored', { h: 0.4 }); add(`${c}_shulker_box`, `${n} Shulker Box`, hex, 'Colored');
}

// Ores and minerals.
for (const [m, c] of [['coal', '#2e2e2e'], ['iron', '#d8af93'], ['copper', '#c06c50'], ['gold', '#fcee4b'], ['redstone', '#aa0f01'], ['lapis', '#1d47a8'], ['diamond', '#5decf5'], ['emerald', '#17dd62']]) {
  add(`${m}_ore`, `${cap(m)} Ore`, c, 'Ores'); add(`deepslate_${m}_ore`, `Deepslate ${cap(m)} Ore`, c, 'Ores');
  add(`${m}_block`, `Block of ${cap(m)}`, c, 'Ores');
  if (['iron', 'copper', 'gold'].includes(m)) add(`raw_${m}_block`, `Block of Raw ${cap(m)}`, c, 'Ores');
}
for (const [id, c] of [['nether_gold_ore', '#a7552f'], ['nether_quartz_ore', '#a8786b'], ['ancient_debris', '#5f4740'], ['netherite_block', '#423d3f'], ['amethyst_block', '#8562c0'], ['budding_amethyst', '#8462bf'], ['cut_copper', '#bf6b51'], ['exposed_copper', '#a17e68'], ['weathered_copper', '#6c9f6c'], ['oxidized_copper', '#52a185'], ['copper_bulb', '#c46d4e'], ['copper_grate', '#c06c50'], ['glowstone', '#ac8654'], ['sea_lantern', '#acc8be'], ['shroomlight', '#f19a49'], ['froglight', '#f5e9b5']]) add(id, cap(id), c, 'Ores');

// Redstone and moving parts.
for (const [id, c, h] of [['redstone_wire', '#d01010', 0.06], ['redstone_torch', '#d01010', 0.6], ['repeater', '#a8a8a8', 0.13], ['comparator', '#a8a8a8', 0.13], ['observer', '#5f5f5f', 1], ['piston', '#9a8763', 1], ['sticky_piston', '#7f9a60', 1], ['dispenser', '#6c6c6c', 1], ['dropper', '#6c6c6c', 1], ['crafter', '#6e6563', 1], ['hopper', '#3f3f42', 1], ['chest', '#a2752f', 0.88], ['trapped_chest', '#a2752f', 0.88], ['barrel', '#86613a', 1], ['lever', '#7a7a7a', 0.3], ['daylight_detector', '#d8c9a6', 0.38], ['target', '#e6c9b6', 1], ['note_block', '#5f3c2b', 1], ['jukebox', '#5f3c2b', 1], ['rail', '#8d7b5e', 0.06], ['powered_rail', '#a88f45', 0.06], ['detector_rail', '#8d6f61', 0.06], ['activator_rail', '#8a6157', 0.06], ['tripwire_hook', '#8a8a8a', 0.4], ['tnt', '#d8442e', 1], ['slime_block', '#76c162', 1], ['honey_block', '#f8bb3d', 1], ['redstone_lamp', '#b06a35', 1], ['lightning_rod', '#c26f53', 1], ['sculk_sensor', '#0e4752', 0.5], ['stone_button', '#7d7d7d', 0.13], ['stone_pressure_plate', '#7d7d7d', 0.06], ['light_weighted_pressure_plate', '#f9d849', 0.06], ['heavy_weighted_pressure_plate', '#dcdcdc', 0.06]]) add(id, cap(id), c, 'Redstone', { h });
BLOCKS.find((b) => b.id === 'redstone_wire').name = 'Redstone Dust';

// Workstations and other useful blocks.
for (const [id, c, h] of [['crafting_table', '#9b6f3f', 1], ['furnace', '#686868', 1], ['blast_furnace', '#59585c', 1], ['smoker', '#5c5148', 1], ['campfire', '#c97d32', 0.44], ['soul_campfire', '#4fc6c9', 0.44], ['composter', '#7d5a2f', 1], ['cauldron', '#3d3d3e', 1], ['anvil', '#444444', 1], ['bell', '#e2b94f', 1], ['lectern', '#b18a52', 0.9], ['grindstone', '#8e8e8e', 1], ['stonecutter', '#787878', 0.56], ['loom', '#a58d6a', 1], ['smithing_table', '#3a3b47', 1], ['cartography_table', '#674d33', 1], ['fletching_table', '#c5b37e', 1], ['enchanting_table', '#3a1e3f', 0.75], ['brewing_stand', '#7a6550', 0.88], ['beacon', '#79e6dd', 1], ['conduit', '#9b8a6a', 0.4], ['ender_chest', '#18312d', 0.88], ['lodestone', '#808286', 1], ['respawn_anchor', '#2b1550', 1], ['spawner', '#1b2a3a', 1], ['hay_block', '#a68b0c', 1], ['dried_kelp_block', '#323927', 1], ['honeycomb_block', '#e5941c', 1], ['sponge', '#c3c04a', 1], ['wet_sponge', '#abb546', 1], ['glass', '#c0d8dc', 1], ['tinted_glass', '#2c2632', 1], ['glass_pane', '#c0d8dc', 1], ['iron_bars', '#8f9296', 1], ['chain', '#3d4350', 1], ['iron_door', '#c4c4c4', 1], ['iron_trapdoor', '#c4c4c4', 0.19], ['torch', '#f6c443', 0.6], ['soul_torch', '#61d8dd', 0.6], ['lantern', '#e3a64f', 0.56], ['soul_lantern', '#5cc5ca', 0.56], ['end_rod', '#e9dfd7', 1], ['flower_pot', '#7c4536', 0.38], ['armor_stand', '#a2826a', 1], ['item_frame', '#8b6542', 0.1]]) add(id, cap(id), c, 'Utility', { h, ...(/glass(_pane)?$|tinted/.test(id) && id !== 'tinted_glass' ? { alpha: 0.4 } : {}) });

// Plants and crops.
for (const [id, c, h, a] of [['sugar_cane', '#91c26c', 1, 0.95], ['kelp', '#4f8a2e', 1, 0.95], ['bamboo', '#5d8a1e', 1, 1], ['cactus', '#5d8a2f', 1, 1], ['pumpkin', '#c47719', 1, 1], ['carved_pumpkin', '#c47719', 1, 1], ['jack_o_lantern', '#e3a03c', 1, 1], ['melon', '#72902c', 1, 1], ['pumpkin_stem', '#8a9c42', 0.5, 1], ['melon_stem', '#8a9c42', 0.5, 1], ['wheat', '#c8a83e', 0.9, 1], ['carrots', '#e48a1a', 0.5, 1], ['potatoes', '#c9b05a', 0.5, 1], ['beetroots', '#a32d2d', 0.5, 1], ['sweet_berry_bush', '#3a5a2c', 0.8, 1], ['cocoa', '#8a5a2a', 0.6, 1], ['nether_wart', '#8a1e1e', 0.4, 1], ['chorus_flower', '#937793', 1, 1], ['vine', '#3a6f1a', 1, 0.7], ['glow_lichen', '#6f8a7a', 0.1, 1], ['sea_pickle', '#6a7a2a', 0.4, 1], ['seagrass', '#3c8a2a', 0.9, 0.8], ['lily_pad', '#208030', 0.06, 1], ['dandelion', '#f8d021', 0.6, 1], ['poppy', '#d81a1a', 0.6, 1], ['sunflower', '#f8c41c', 1, 1], ['torchflower', '#e88a3a', 0.6, 1], ['azalea', '#6a8a2a', 1, 1], ['flowering_azalea', '#8a7a9a', 1, 1], ['short_grass', '#5d9b3a', 0.6, 0.9], ['fern', '#4a7a2a', 0.6, 0.9], ['dead_bush', '#8a6a3a', 0.6, 1], ['mushroom_red', '#c22a2a', 0.4, 1], ['mushroom_brown', '#9a7552', 0.4, 1]]) add(id, cap(id), c, 'Plants', { h, alpha: a });
BLOCKS.find((b) => b.id === 'mushroom_red').name = 'Red Mushroom'; BLOCKS.find((b) => b.id === 'mushroom_brown').name = 'Brown Mushroom';

// Liquids.
add('water', 'Water', '#3f76e4', 'Liquids', { alpha: 0.5 }); add('lava', 'Lava', '#e35b12', 'Liquids', { alpha: 0.9 }); add('powder_snow', 'Powder Snow', '#f8fdfd', 'Liquids', { alpha: 0.8 });

/** By id. */
export const BLOCK = Object.fromEntries(BLOCKS.map((b) => [b.id, b]));

/** The palette a new design starts with: what farms are mostly made of. */
export const PRESET_PALETTE = ['stone', 'cobblestone', 'glass', 'dirt', 'grass_block', 'farmland', 'sand', 'water', 'lava', 'oak_planks', 'oak_slab', 'oak_fence', 'oak_sign', 'hopper', 'chest', 'observer', 'piston', 'sticky_piston', 'redstone_wire', 'repeater', 'redstone_torch', 'rail', 'torch', 'white_bed', 'sugar_cane', 'kelp', 'pumpkin_stem', 'wheat', 'composter', 'dispenser'];

/** Blocks whose name (or id) has every word of `q` in it, the closest first. */
export function searchBlocks(q, limit = 60) {
  const words = String(q ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return BLOCKS.slice(0, limit);
  const hit = BLOCKS.filter((b) => { const t = `${b.name} ${b.id}`.toLowerCase(); return words.every((w) => t.includes(w)); });
  const score = (b) => (b.name.toLowerCase() === words.join(' ') ? 0 : b.name.toLowerCase().startsWith(words[0]) ? 1 : 2) * 100 + b.name.length;
  return hit.sort((a, b) => score(a) - score(b)).slice(0, limit);
}
