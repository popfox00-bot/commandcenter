import { exportToSheets } from './sheets.js';

const EXPORTERS = { sheets: exportToSheets };

/** Run each configured exporter for the run's new items. Exporter failures are logged, not fatal. */
export async function runExporters({ exporters, job, items, log, env = process.env, fetchFn = fetch }) {
  const results = {};
  for (const cfg of exporters) {
    const fn = EXPORTERS[cfg.type];
    const selected = cfg.types ? items.filter((i) => cfg.types.includes(i.type)) : items;
    if (!selected.length) continue;
    try {
      results[cfg.type] = await fn({ cfg, job, items: selected, log, env, fetchFn });
    } catch (err) {
      log.error('exporter failed', { type: cfg.type, error: err.message });
      results[cfg.type] = { error: err.message };
    }
  }
  return results;
}
