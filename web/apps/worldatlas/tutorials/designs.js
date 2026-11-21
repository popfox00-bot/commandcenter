// WorldAtlas Tutorials: designs it starts with, popular Bedrock farms, each laid out layer by layer (bottom
// first; each layer's rows front to back, one character per block), with a video search and a written guide.
// The automatic ones (sugar cane, iron) are laid out for their shape and materials: which way each observer and
// piston faces is in the notes, and the videos show them built.

import { fromPlan } from './tutorials-core.js';

const yt = (q) => ({ title: 'Videos (YouTube)', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`minecraft bedrock ${q}`)}` });

export const PRESETS = [
  fromPlan({
    id: 'preset-wheat-9x9', name: 'Wheat Farm (9×9, one water)', category: 'Crops',
    desc: 'The classic crop field: one water block in the middle keeps all 80 farmland blocks around it wet (water reaches 4 blocks each way). Plant wheat, carrots, potatoes or beetroot; a fence keeps animals out, torches let it grow at night.',
    links: [yt('9x9 wheat farm'), { title: 'Beginner farms (minecraft.net)', url: 'https://www.minecraft.net/sv-se/article/tutorial--bedrock-beginner-farms' }],
    extras: [{ name: 'Wheat seeds', count: 80 }, { name: 'Hoe', count: 1 }, { name: 'Water bucket', count: 1 }],
  }, { L: 'oak_log', F: 'farmland', W: 'water', w: 'wheat', f: 'oak_fence', g: 'oak_fence_gate', t: 'torch', c: 'composter' }, [
    ['LLLLLLLLLLL', 'LFFFFFFFFFL', 'LFFFFFFFFFL', 'LFFFFFFFFFL', 'LFFFFFFFFFL', 'LFFFFWFFFFL', 'LFFFFFFFFFL', 'LFFFFFFFFFL', 'LFFFFFFFFFL', 'LFFFFFFFFFL', 'LLLLLLLLLLL'],
    ['fffffgfffff', 'fwwwwwwwwwf', 'fwwwwwwwwwf', 'fwwwwwwwwwf', 'fwwwwwwwwwf', 'fwwww.wwwwf', 'fwwwwwwwwwf', 'fwwwwwwwwwf', 'fwwwwwwwwwf', 'fwwwwwwwwwf', 'ffffffffffc'],
    ['t.........t', '...........', '...........', '...........', '...........', '...........', '...........', '...........', '...........', '...........', 't.........t'],
  ]),
  fromPlan({
    id: 'preset-pumpkin-melon', name: 'Pumpkin & Melon Farm (two rows)', category: 'Crops',
    desc: 'A water channel down the middle keeps the farmland on both sides wet: pumpkin stems on one side, melon stems on the other. Each stem grows its fruit onto the dirt beside it (keep those spaces clear); break the fruit, the stem stays.',
    links: [yt('pumpkin melon farm'), { title: 'Best farms (Beebom)', url: 'https://beebom.com/best-minecraft-farms/amp' }],
    extras: [{ name: 'Pumpkin seeds', count: 9 }, { name: 'Melon seeds', count: 9 }, { name: 'Water bucket', count: 2 }],
  }, { D: 'dirt', F: 'farmland', W: 'water', p: 'pumpkin_stem', m: 'melon_stem', t: 'torch', P: 'pumpkin', M: 'melon' }, [
    ['DDDDDDDDD', 'FFFFFFFFF', 'WWWWWWWWW', 'FFFFFFFFF', 'DDDDDDDDD'],
    ['t.P...P.t', 'ppppppppp', '.........', 'mmmmmmmmm', 't...M...t'],
  ]),
  fromPlan({
    id: 'preset-sugar-cane', name: 'Automatic Sugar Cane Farm (8 wide)', category: 'Automatic farms',
    desc: 'Sugar cane grows on dirt beside water. When a cane reaches three tall, the observer level with its top sees it and fires the piston below it, which breaks the middle block; the cane falls into the water channel, which carries it to the hopper and chest at the end. Pistons face the cane; observers face the cane, with their back (the red dot) toward the piston\'s side so their signal reaches it. Make it as long as you like: one dirt, cane, piston and observer per column.',
    links: [yt('automatic sugar cane farm observer piston'), { title: 'Sugar cane farm (Sportskeeda)', url: 'https://www.sportskeeda.com/minecraft/how-make-minecraft-1-21-sugarcane-farm' }, { title: 'Sugar cane farm video (Chunkbase)', url: 'https://www.chunkbase.com/tutorials/videos/sugar-cane-farm' }],
    extras: [{ name: 'Sugar cane (to plant)', count: 8 }, { name: 'Water bucket', count: 2 }],
  }, { S: 'stone', D: 'dirt', W: 'water', H: 'hopper', C: 'chest', P: 'piston', O: 'observer', U: 'sugar_cane', G: 'glass', R: 'redstone_wire' }, [
    ['SSSSSSSSSS', 'SSSSSSSSSS', 'SSSSSSSSSH', 'SSSSSSSSSC'],
    ['SSSSSSSSSS', 'SDDDDDDDDS', 'SWWWWWWWW.', 'GGGGGGGGGG'],
    ['SSSSSSSSSS', '.UUUUUUUU.', '..........', 'GGGGGGGGGG'],
    ['.PPPPPPPP.', '.UUUUUUUU.', '..........', 'GGGGGGGGGG'],
    ['.OOOOOOOO.', '.UUUUUUUU.', '..........', '..........'],
  ]),
  fromPlan({
    id: 'preset-iron', name: 'Iron Farm (villagers + zombie, simplified)', category: 'Automatic farms',
    desc: 'Three villagers each with a bed, in a glass pod, and a zombie kept where they can see it (in a boat, or behind glass) scare the villagers into summoning iron golems. Golems spawn on the platform, the water pushes them into the hole in the middle, the lava held by a sign at head height kills them, and their iron drops through the hopper into the chest. Build it well away (100+ blocks) from any village so the golems spawn here. A simplified layout: follow a video for the exact build in your version.',
    links: [yt('easy iron farm 1.21'), { title: 'Iron farm (Sportskeeda, Bedrock)', url: 'https://www.sportskeeda.com/minecraft/how-build-iron-farm-minecraft-bedrock-edition' }, { title: 'Iron farm 1.21 (Sportskeeda)', url: 'https://sportskeeda.com/minecraft/how-make-iron-farm-minecraft-1-21' }],
    extras: [{ name: 'Villagers', count: 3 }, { name: 'Zombie (name-tagged)', count: 1 }, { name: 'Boat', count: 1 }, { name: 'Lava bucket', count: 1 }, { name: 'Water bucket', count: 4 }],
  }, { S: 'stone', H: 'hopper', C: 'chest', G: 'glass', W: 'water', L: 'lava', s: 'oak_sign', B: 'white_bed', c: 'composter' }, [
    ['.......', '.......', '.......', '...C...', '.......', '.......', '.......'],
    ['.......', '.......', '..GGG..', '..GHG..', '..GGG..', '.......', '.......'],
    ['SSSSSSS', 'SSSSSSS', 'SSSSSSS', 'SSS.SSS', 'SSSSSSS', 'SSSSSSS', 'SSSSSSS'],
    ['W.....W', '.......', '.......', '...s...', '.......', '.......', 'W.....W'],
    ['GBGBGBG', 'G.....G', '.......', '...L...', '.......', '.......', 'GGGGGGG'],
    ['GGGGGGG', '.......', '.......', '.......', '.......', '.......', 'GGGGGGG'],
  ]),
  fromPlan({
    id: 'preset-cobble', name: 'Cobblestone Generator', category: 'Resources',
    desc: 'Lava flowing toward water makes cobblestone where they meet (not obsidian: obsidian is only when water touches a lava source). Mine the cobblestone in the middle and it forms again; with an Efficiency pickaxe it\'s endless stone. Keep a wall around the lava.',
    links: [yt('cobblestone generator')],
    extras: [{ name: 'Lava bucket', count: 1 }, { name: 'Water bucket', count: 1 }, { name: 'Pickaxe', count: 1 }],
  }, { S: 'stone', L: 'lava', W: 'water', C: 'cobblestone' }, [
    ['SSSSSSS', 'SSSSSSS', 'SSSSSSS'],
    ['SSSSSSS', 'SL.C.WS', 'SSSSSSS'],
  ]),
  fromPlan({
    id: 'preset-chicken-eggs', name: 'Egg Farm (chickens on hoppers)', category: 'Animals',
    desc: 'Chickens kept in a glass box over a hopper lay eggs that drop straight into the chest below. Eight chickens give a steady supply for breeding or cooking; add a dispenser of lava above (a "chicken cooker") for automatic cooked chicken.',
    links: [yt('egg farm chicken hopper')],
    extras: [{ name: 'Chickens', count: 8 }, { name: 'Seeds (to lead them)', count: 16 }],
  }, { C: 'chest', H: 'hopper', G: 'glass', S: 'stone_slab' }, [
    ['...', '.C.', '...'],
    ['GGG', 'GHG', 'GGG'],
    ['GGG', 'G.G', 'GGG'],
    ['GGG', 'G.G', 'GGG'],
    ['SSS', 'SSS', 'SSS'],
  ]),
];
