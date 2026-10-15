// robots.txt parsing and matching (RFC 9309): longest matching rule wins, Allow wins ties,
// "*" and "$" wildcards supported. We match the "*" group plus any group naming our product token.

export const ROBOTS_TOKEN = 'commandcenter';

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!lastWasAgent || !current) { current = { agents: [], rules: [], crawlDelay: null }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      if (field === 'disallow' && value === '') continue; // "Disallow:" = allow all
      current.rules.push({ allow: field === 'allow', path: value });
    } else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return groups;
}

function ruleToRegex(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export function selectGroups(groups, token = ROBOTS_TOKEN) {
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.toLowerCase().includes(a)));
  return specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
}

/** Returns { allowed, rule, crawlDelay } for a URL path+query. */
export function checkRobots(groups, pathAndQuery, token = ROBOTS_TOKEN) {
  const selected = selectGroups(groups, token);
  let best = null;
  for (const g of selected) {
    for (const r of g.rules) {
      if (ruleToRegex(r.path).test(pathAndQuery)) {
        const len = r.path.replace(/[*$]/g, '').length;
        if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { ...r, len };
      }
    }
  }
  const crawlDelay = selected.map((g) => g.crawlDelay).filter((d) => d != null).sort((a, b) => b - a)[0] ?? null;
  return { allowed: best ? best.allow : true, rule: best ? `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}` : null, crawlDelay };
}
