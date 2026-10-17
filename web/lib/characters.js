// "Characters": cut-out images (transparent PNGs) kept on this device for reuse in collages.
// Metadata lives under one IndexedDB key; each image blob under its own key.
import { idb } from './idb.js';

const INDEX = 'characters.index';
const blobKey = (id) => `characters.blob.${id}`;

export async function listCharacters() {
  return (await idb.get(INDEX)) ?? [];
}

export async function addCharacter(blob, { name, width, height }) {
  const list = await listCharacters();
  const id = crypto.randomUUID();
  const entry = { id, name: name || `Character ${list.length + 1}`, width, height, createdAt: Date.now() };
  await idb.set(blobKey(id), blob);
  await idb.set(INDEX, [entry, ...list]);
  return entry;
}

export const getCharacterBlob = (id) => idb.get(blobKey(id));

export async function renameCharacter(id, name) {
  const list = await listCharacters();
  await idb.set(INDEX, list.map((c) => (c.id === id ? { ...c, name } : c)));
}

export async function removeCharacter(id) {
  await idb.del(blobKey(id));
  await idb.set(INDEX, (await listCharacters()).filter((c) => c.id !== id));
}
