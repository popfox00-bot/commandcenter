// Heartbeat: a no-network job that emits one item per UTC day. Use it to verify the pipeline
// (CLI -> store -> Worker -> PWA -> ntfy) end to end before pointing jobs at real sites.
import { z } from 'zod';

export default {
  id: 'heartbeat',
  name: 'Heartbeat',
  description: 'Pipeline self-test: one item per day, no network.',
  schedule: '7 12 * * *',
  configSchema: z.object({
    message: z.string().default('Command Center is alive'),
  }).strict(),
  ui: { primary: 'recent' },
  async run(ctx) {
    const day = ctx.now.toISOString().slice(0, 10);
    ctx.log.info('heartbeat', { day });
    return [{ key: day, title: `${ctx.settings.message} (${day})`, url: null, fields: { day, attempt: ctx.attempt }, timestamp: ctx.now }];
  },
};
