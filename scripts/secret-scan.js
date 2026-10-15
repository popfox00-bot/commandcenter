// Secret scanner with no external dependencies. Used by the pre-commit hook (--staged) and CI (--all).
// Flags provider token formats, private keys, committed .env files, and high-entropy values
// assigned to secret-looking names. Allow a false positive with a trailing "secret-scan:allow" comment.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';

const RULES = [
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['AWS access key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['Anthropic/OpenAI key', /\bsk-(ant-)?[A-Za-z0-9_-]{32,}\b/],
  ['Stripe key', /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ['Google service account', /"type"\s*:\s*"service_account"/],
  ['Bearer token literal', /\bBearer\s+[A-Za-z0-9._~+/-]{24,}={0,2}(?![A-Za-z0-9])/],
];
const ASSIGN = /\b([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_KEY|NTFY_TOPIC)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"'#]{16,})/i;
const SKIP = [/^node_modules\//, /package-lock\.json$/, /\.(png|jpg|jpeg|gif|ico|woff2?|pdf)$/i, /^test\/fixtures\//, /^scripts\/secret-scan\.js$/];

function entropy(s) {
  const f = {};
  for (const c of s) f[c] = (f[c] ?? 0) + 1;
  return Object.values(f).reduce((h, n) => h - (n / s.length) * Math.log2(n / s.length), 0);
}

function files(mode) {
  const args = mode === '--staged' ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR'] : ['ls-files'];
  return execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function content(file, mode) {
  if (mode === '--staged') return execFileSync('git', ['show', `:${file}`], { encoding: 'utf8', maxBuffer: 20e6 });
  if (!existsSync(file) || statSync(file).size > 2e6) return '';
  return readFileSync(file, 'utf8');
}

const mode = process.argv[2] ?? '--staged';
const findings = [];
for (const file of files(mode)) {
  if (SKIP.some((r) => r.test(file))) continue;
  if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example')) { findings.push(`${file}: .env files must not be committed`); continue; }
  if (/(^|\/)\.dev\.vars$/.test(file)) { findings.push(`${file}: .dev.vars must not be committed`); continue; }
  const lines = content(file, mode).split('\n');
  lines.forEach((line, i) => {
    if (line.includes('secret-scan:allow')) return;
    for (const [name, re] of RULES) if (re.test(line)) findings.push(`${file}:${i + 1}: possible ${name}`);
    const m = line.match(ASSIGN);
    if (m && entropy(m[3]) > 3.5 && !/^(\/|\[|\$\{\{|\$\{|process\.env|env\.|<|REPLACE|your-|example)/i.test(m[3])) findings.push(`${file}:${i + 1}: high-entropy value assigned to ${m[1]}`);
  });
}

if (findings.length) {
  console.error(`✖ secret scan found ${findings.length} problem(s):\n  ${findings.join('\n  ')}\nRemove the secret (and rotate it if it was ever pushed). False positive? add "secret-scan:allow" on that line.`);
  process.exit(1);
}
console.log(`✔ secret scan clean (${mode.replace('--', '')})`);
