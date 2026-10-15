import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { ConfigError } from './errors.js';
import { parseCron } from './schedule.js';

export const DEFAULT_CONFIG_PATH = resolve(import.meta.dirname, '../../config/jobs.yaml');

const cronString = z.string().refine((s) => { try { parseCron(s); return true; } catch { return false; } }, { message: 'invalid 5-field cron expression' });

const notifySchema = z.object({
  onNew: z.boolean().default(true),
  onFailure: z.boolean().default(true),
  /** Individual notifications per run; anything beyond this is folded into one summary. */
  maxPerRun: z.number().int().min(0).max(50).default(5),
  /** First successful run of a job records items without one notification each (one summary instead). */
  silentFirstRun: z.boolean().default(true),
  priority: z.enum(['min', 'low', 'default', 'high', 'urgent']).default('default'),
}).strict();

const politenessSchema = z.object({
  userAgent: z.string().min(10).default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'),
  /** Randomized delay before every request, in ms. */
  minDelayMs: z.number().int().min(0).default(2000),
  maxDelayMs: z.number().int().min(0).default(6000),
  /** Minimum spacing between two requests to the same host. */
  perHostIntervalMs: z.number().int().min(0).default(5000),
  respectRobots: z.boolean().default(true),
  /** Response cache TTL for identical GETs within/between runs on the same machine. */
  cacheTtlSec: z.number().int().min(0).default(600),
}).strict().refine((p) => p.maxDelayMs >= p.minDelayMs, { message: 'maxDelayMs must be >= minDelayMs' });

const exporterSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sheets'),
    spreadsheetId: z.string().min(10),
    sheet: z.string().min(1).default('Sheet1'),
    /** Item types to export (default: all). */
    types: z.array(z.string()).optional(),
    /** Field names to export as columns after timestamp,key,title,url. */
    columns: z.array(z.string()).default([]),
  }).strict(),
]);

const defaultsSchema = z.object({
  retries: z.number().int().min(0).max(5).default(2),
  retryBaseMs: z.number().int().min(0).default(5000),
  timeoutMs: z.number().int().min(1000).max(60 * 60 * 1000).default(5 * 60 * 1000),
  notify: notifySchema.default(notifySchema.parse({})),
}).strict();

const jobEntrySchema = z.object({
  enabled: z.boolean().default(true),
  /** Overrides the job module's default schedule. */
  schedule: cronString.optional(),
  /** Fail the run (and alert) when fewer items are returned. */
  minItems: z.number().int().min(0).default(0),
  retries: z.number().int().min(0).max(5).optional(),
  timeoutMs: z.number().int().min(1000).max(60 * 60 * 1000).optional(),
  notify: notifySchema.partial().optional(),
  exporters: z.array(exporterSchema).default([]),
  /** Job-specific settings, validated by the job module's own configSchema. */
  settings: z.unknown().optional(),
}).strict();

export const rootSchema = z.object({
  version: z.literal(1),
  timezone: z.string().default('UTC'),
  politeness: politenessSchema.default(politenessSchema.parse({})),
  defaults: defaultsSchema.default(defaultsSchema.parse({})),
  jobs: z.record(z.string().regex(/^[a-z][a-z0-9-]{1,40}$/, 'job ids are lowercase letters, digits and dashes'), jobEntrySchema),
}).strict();

function formatZod(err, where) {
  const lines = err.issues.map((i) => `  - ${[where, ...i.path].filter((x) => x !== '').join('.')}: ${i.message}`);
  return lines.join('\n');
}

/**
 * Read the raw config. Precedence: CC_CONFIG_YAML (inline, e.g. from a GitHub secret so search
 * terms and ZIP codes need not be committed) > CC_CONFIG_PATH > config/jobs.yaml.
 */
export function readConfigSource({ env = process.env, path } = {}) {
  if (env.CC_CONFIG_YAML && !path) return { text: env.CC_CONFIG_YAML, origin: 'env:CC_CONFIG_YAML' };
  const file = path || env.CC_CONFIG_PATH || DEFAULT_CONFIG_PATH;
  if (!existsSync(file)) throw new ConfigError(`Config file not found: ${file}`);
  return { text: readFileSync(file, 'utf8'), origin: file };
}

export function parseConfigText(text, origin = 'config') {
  let raw;
  try {
    raw = YAML.parse(text, { prettyErrors: true, uniqueKeys: true });
  } catch (err) {
    throw new ConfigError(`${origin}: YAML syntax error: ${err.message}`);
  }
  if (!raw || typeof raw !== 'object') throw new ConfigError(`${origin}: config is empty`);
  return raw;
}

/**
 * Validate the root config and each job's settings against the job module's schema.
 * Throws a single ConfigError listing every problem, so a bad config fails loudly and completely.
 */
export function validateConfig(raw, registry, origin = 'config') {
  const root = rootSchema.safeParse(raw);
  if (!root.success) throw new ConfigError(`${origin} is invalid:\n${formatZod(root.error, '')}`);
  const cfg = root.data;
  const problems = [];
  try { new Intl.DateTimeFormat('en-US', { timeZone: cfg.timezone }); } catch { problems.push(`  - timezone: unknown time zone "${cfg.timezone}"`); }

  const jobs = {};
  for (const [id, entry] of Object.entries(cfg.jobs)) {
    const mod = registry.get(id);
    if (!mod) { problems.push(`  - jobs.${id}: no job module with id "${id}" (known: ${[...registry.keys()].join(', ') || 'none'})`); continue; }
    let settings = entry.settings ?? {};
    if (mod.configSchema) {
      const parsed = mod.configSchema.safeParse(settings);
      if (!parsed.success) { problems.push(formatZod(parsed.error, `jobs.${id}.settings`)); continue; }
      settings = parsed.data;
    }
    const schedule = entry.schedule ?? mod.schedule;
    try { parseCron(schedule); } catch (e) { problems.push(`  - jobs.${id}.schedule: ${e.message}`); }
    jobs[id] = {
      id,
      enabled: entry.enabled,
      schedule,
      minItems: entry.minItems,
      retries: entry.retries ?? cfg.defaults.retries,
      retryBaseMs: cfg.defaults.retryBaseMs,
      timeoutMs: entry.timeoutMs ?? cfg.defaults.timeoutMs,
      notify: { ...cfg.defaults.notify, ...(entry.notify ?? {}) },
      exporters: entry.exporters,
      settings,
    };
  }
  if (problems.length) throw new ConfigError(`${origin} is invalid:\n${problems.join('\n')}`);
  return { timezone: cfg.timezone, politeness: cfg.politeness, defaults: cfg.defaults, jobs, origin };
}

export function loadConfig(registry, opts = {}) {
  const { text, origin } = readConfigSource(opts);
  return validateConfig(parseConfigText(text, origin), registry, origin);
}
