#!/usr/bin/env node
/**
 * Phase 4: uptime-digest-merge
 *
 * Fetches the current uptime status from Kilowott-labs/uptime and appends
 * an "Uptime" section to the most recent digest issue in repo-health.
 *
 * Runs as part of the weekly-scan.yml workflow, after the digest is
 * already filed by file-issues.js.
 *
 * How it works:
 *   - Upptime maintains a `history/summary.json` file in its repo.
 *   - This script fetches that file, extracts per-site status + response time,
 *     and inserts a table into the digest body.
 *
 * Env:
 *   GITHUB_TOKEN       PAT with repo:read on Kilowott-labs/uptime + issues:write on repo-health
 *   UPTIME_REPO        default "Kilowott-labs/uptime"
 *   DIGEST_REPO        default "Kilowott-labs/repo-health"
 */

const TOKEN = process.env.GITHUB_TOKEN;
const UPTIME_REPO = process.env.UPTIME_REPO || 'Kilowott-labs/uptime';
const DIGEST_REPO = process.env.DIGEST_REPO || 'Kilowott-labs/repo-health';
const DIGEST_LABEL = 'health-check-digest';

if (!TOKEN) {
  console.log('GITHUB_TOKEN missing — skipping uptime merge.');
  process.exit(0);
}

async function gh(pathname, opts = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'kilowott-repo-health',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function fetchRawFile(repo, path, ref = 'master') {
  // Upptime uses 'master' by default; some forks use 'main'
  const tryRefs = [ref, 'main'];
  for (const r of tryRefs) {
    try {
      const url = `https://raw.githubusercontent.com/${repo}/${r}/${path}`;
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch { /* try next */ }
  }
  throw new Error(`Could not fetch ${path} from ${repo}`);
}

(async () => {
  // --- 1. Pull Upptime's summary ---
  let summary;
  try {
    const raw = await fetchRawFile(UPTIME_REPO, 'history/summary.json');
    summary = JSON.parse(raw);
  } catch (e) {
    console.error(`Could not load uptime summary: ${e.message}`);
    console.log('Uptime repo may not exist yet or have no scan data. Skipping.');
    process.exit(0);
  }

  if (!Array.isArray(summary) || summary.length === 0) {
    console.log('Uptime summary empty — skipping digest merge.');
    return;
  }

  // --- 2. Find current open digest in repo-health ---
  const [owner, repo] = DIGEST_REPO.split('/');
  const params = new URLSearchParams({
    labels: DIGEST_LABEL,
    state: 'open',
    per_page: '5',
  });
  const digests = await gh(`/repos/${owner}/${repo}/issues?${params}`);
  const currentDigest = digests.find(d => !d.pull_request);
  if (!currentDigest) {
    console.log('No open digest found — skipping merge.');
    return;
  }

  // --- 3. Build uptime section ---
  // Upptime's summary.json shape (per entry):
  //   { name, url, icon, slug, status: "up"|"down"|"degraded",
  //     uptime: "100.00%", uptimeDay, uptimeWeek, uptimeMonth, uptimeYear,
  //     time: 450, timeDay, timeWeek, ...
  //   }
  const statusEmoji = {
    up: '🟢',
    degraded: '🟡',
    down: '🔴',
  };

  const lines = [];
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`## 📡 Uptime (last 7 days)`);
  lines.push('');
  lines.push(`_Data from [${UPTIME_REPO}](https://github.com/${UPTIME_REPO}) · [Status page](https://${owner}.github.io/uptime) ·  Checks every 5 minutes_`);
  lines.push('');
  lines.push('| Site | Status | 7-day uptime | Avg response |');
  lines.push('|---|---|---|---|');

  // Sort: down first, then degraded, then up (most recent concerns up top)
  const sortKey = { down: 0, degraded: 1, up: 2 };
  const sorted = [...summary].sort((a, b) => (sortKey[a.status] ?? 9) - (sortKey[b.status] ?? 9));

  for (const site of sorted) {
    const emoji = statusEmoji[site.status] || '⚪';
    const name = site.name || site.slug || '?';
    const uptimeWeek = site.uptimeWeek || site.uptime || '—';
    const timeWeek = site.timeWeek ? `${site.timeWeek}ms` : (site.time ? `${site.time}ms` : '—');
    lines.push(`| [${name}](${site.url || '#'}) | ${emoji} ${site.status || 'unknown'} | ${uptimeWeek} | ${timeWeek} |`);
  }

  const downCount = summary.filter(s => s.status === 'down').length;
  const degradedCount = summary.filter(s => s.status === 'degraded').length;

  lines.push('');
  if (downCount === 0 && degradedCount === 0) {
    lines.push(`_All ${summary.length} monitored sites operational._`);
  } else {
    const issues = [];
    if (downCount > 0) issues.push(`**${downCount} down**`);
    if (degradedCount > 0) issues.push(`**${degradedCount} degraded**`);
    lines.push(`⚠️ ${issues.join(', ')} — see [status page](https://${owner}.github.io/uptime) for details and incident history.`);
  }

  const uptimeSection = lines.join('\n');

  // --- 4. Merge into digest body ---
  // Replace an existing uptime section if one's already there, else append.
  let body = currentDigest.body || '';
  const marker = '## 📡 Uptime';
  const idx = body.indexOf(marker);
  if (idx >= 0) {
    // Strip everything from the marker through the next section or end of body.
    // Assume next section starts with \n## or end-of-string.
    const remaining = body.slice(idx);
    const nextSectionIdx = remaining.slice(marker.length).search(/\n## /);
    if (nextSectionIdx >= 0) {
      const before = body.slice(0, idx).replace(/\n+---\s*\n*$/, '');
      const after = remaining.slice(marker.length + nextSectionIdx);
      body = before + uptimeSection + '\n' + after;
    } else {
      // No next section; uptime is at end. Replace to end.
      const before = body.slice(0, idx).replace(/\n+---\s*\n*$/, '');
      body = before + uptimeSection;
    }
  } else {
    body = body + '\n' + uptimeSection;
  }

  await gh(`/repos/${owner}/${repo}/issues/${currentDigest.number}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  });
  console.log(`Digest #${currentDigest.number} updated with uptime section.`);
  console.log(`Sites: ${summary.length} total, ${downCount} down, ${degradedCount} degraded.`);
})();
