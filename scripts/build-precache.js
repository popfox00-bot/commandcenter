// Writes the list of web/ files (and a content hash as the cache version) into web/sw.js.
// `npm run precache`. test/web.test.js fails if the committed list is stale.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';

export const WEB = resolve(import.meta.dirname, '../web');
const SKIP = new Set(['sw.js', '.DS_Store']);

export function listWebFiles(dir = WEB) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listWebFiles(p));
    else out.push(relative(WEB, p).split('\\').join('/'));
  }
  return out;
}

export function buildManifest() {
  // config.js is rewritten at deploy time, so it doesn't count toward the version.
  const files = listWebFiles();
  const hash = createHash('sha256');
  for (const f of files) if (f !== 'config.js') hash.update(f).update(readFileSync(join(WEB, f)));
  return { version: hash.digest('hex').slice(0, 12), files };
}

export function renderSw(manifest, sw = readFileSync(join(WEB, 'sw.js'), 'utf8')) {
  const block = `/* PRECACHE:BEGIN */\nconst PRECACHE = ${JSON.stringify(manifest, null, 2)};\n/* PRECACHE:END */`;
  return sw.replace(/\/\* PRECACHE:BEGIN \*\/[\s\S]*?\/\* PRECACHE:END \*\//, block);
}

if (process.argv[1] === import.meta.filename) {
  const manifest = buildManifest();
  writeFileSync(join(WEB, 'sw.js'), renderSw(manifest));
  console.log(`sw.js: ${manifest.files.length} files, version ${manifest.version}`);
}
