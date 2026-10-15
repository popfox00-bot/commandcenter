import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigError } from './errors.js';
import { parseCron } from './schedule.js';

export const JOBS_DIR = resolve(import.meta.dirname, '../jobs');

/** Check that a module exports the job contract. Throws ConfigError naming every missing piece. */
export function assertJobModule(mod, source = 'job') {
  const problems = [];
  if (typeof mod?.id !== 'string' || !/^[a-z][a-z0-9-]{1,40}$/.test(mod.id)) problems.push('id (lowercase string)');
  if (typeof mod?.name !== 'string' || !mod.name) problems.push('name');
  if (typeof mod?.description !== 'string') problems.push('description');
  if (typeof mod?.run !== 'function') problems.push('run(ctx)');
  try { parseCron(mod?.schedule); } catch { problems.push('schedule (5-field cron)'); }
  if (mod?.configSchema && typeof mod.configSchema.safeParse !== 'function') problems.push('configSchema (zod schema)');
  if (problems.length) throw new ConfigError(`${source} does not export a valid job: missing/invalid ${problems.join(', ')}`);
  return mod;
}

/**
 * Discover jobs: every `src/jobs/<name>.js` or `src/jobs/<name>/index.js`.
 * Files and folders starting with "_" (templates, helpers) are skipped.
 */
export async function loadRegistry(dir = JOBS_DIR) {
  const registry = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    let file;
    if (entry.isFile() && entry.name.endsWith('.js')) file = join(dir, entry.name);
    else if (entry.isDirectory() && existsSync(join(dir, entry.name, 'index.js'))) file = join(dir, entry.name, 'index.js');
    else continue;
    const imported = await import(pathToFileURL(file).href);
    const mod = assertJobModule(imported.default ?? imported, file);
    if (registry.has(mod.id)) throw new ConfigError(`Duplicate job id "${mod.id}" in ${file}`);
    registry.set(mod.id, mod);
  }
  return registry;
}
