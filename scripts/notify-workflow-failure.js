// Called by workflows on failure (e.g. npm ci or config validation failed before any job ran),
// so a broken pipeline is never silent. Needs NTFY_TOPIC; prints nothing secret.
const { NTFY_TOPIC, NTFY_SERVER = 'https://ntfy.sh', NTFY_TOKEN, WORKFLOW_NAME = 'workflow', RUN_URL } = process.env;
if (!NTFY_TOPIC) { console.log('NTFY_TOPIC not set; skipping failure alert'); process.exit(0); }
const res = await fetch(NTFY_SERVER.replace(/\/+$/, '') + '/', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(NTFY_TOKEN ? { authorization: `Bearer ${NTFY_TOKEN}` } : {}) },
  body: JSON.stringify({ topic: NTFY_TOPIC, title: `❌ Command Center: ${WORKFLOW_NAME} failed`, message: 'The GitHub Actions run failed. Job-level failures are alerted separately; this one may be a setup or config problem.', priority: 4, tags: ['warning'], ...(RUN_URL ? { click: RUN_URL } : {}) }),
});
console.log(`failure alert: HTTP ${res.status}`);
