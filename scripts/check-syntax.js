// `npm run check`: syntax-check every JS file (no build step in this repo).
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const skip = new Set(['node_modules', '.git', '.cc', '.wrangler']);
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p); else if (name.endsWith('.js') || name.endsWith('.mjs')) files.push(p);
  }
})(root);
let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { failed += 1; process.stderr.write(e.stderr.toString()); }
}
console.log(`${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
