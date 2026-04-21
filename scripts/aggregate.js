#!/usr/bin/env node
/**
 * Regenerates README.md, dashboard.json, and per-repo history snapshots.
 *
 * Reads:
 *   - TARGETS_JSON env var (path to targets JSON, defaults to 'targets.json')
 *     Expected shape: { org: "...", repos: [{ name, priority, stack, private }] }
 *   - reports/<repo>/latest.json for each target
 *   - Optional: GITHUB_TOKEN env var — enables description/language/gh_issue
 *     enrichment via GitHub API. Without it, those fields are null.
 *
 * Writes:
 *   - README.md                                  (existing behavior)
 *   - dashboard.json                             (new — consolidated UI data)
 *   - history/<repo>/<YYYY-MM-DD>.json           (new — per-repo time series)
 *
 * Run locally:
 *   TARGETS_JSON=discovered-targets.json node scripts/aggregate.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TARGETS_JSON = process.env.TARGETS_JSON || 'targets.json';
const ORG = process.env.ORG || 'Kilowott-labs';
const TOKEN = process.env.GITHUB_TOKEN || '';

function loadTargets() {
  const raw = fs.readFileSync(TARGETS_JSON, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed.repos || [];
}

function loadLatest(repoName) {
  const p = path.join('reports', repoName, 'latest.json');
  if (!fs.existsSync(p)) return { status: 'not-scanned', findings: [] };
  try {
    const body = fs.readFileSync(p, 'utf8').trim();
    if (!body || body === 'null') return { status: 'clean', findings: [] };
    const findings = JSON.parse(body);
    return {
      status: findings.length === 0 ? 'clean' : 'findings',
      findings,
    };
  } catch (err) {
    return { status: 'error', findings: [], error: err.message };
  }
}

function statusCell(result, priority) {
  if (result.status === 'not-scanned') return '⚪ not scanned';
  if (result.status === 'error') return '⚠️ scan error';
  if (result.status === 'clean') return '🟢 clean';
  const count = result.findings.length;
  if (priority === 'critical' || count >= 5) return `🔴 ${count} findings`;
  return `🟡 ${count} findings`;
}

function visibilityCell(repo) {
  return repo.private ? '🔒 private' : '🌐 public';
}

function escapeMd(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// ---------------------------------------------------------------------------
// Dashboard helpers — severity/scanner rollups, fingerprints, API fetches
// ---------------------------------------------------------------------------
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

function computeSeverityCounts(findings) {
  const counts = Object.fromEntries(SEVERITIES.map(s => [s, 0]));
  for (const f of findings) {
    const sev = String(f.Severity || 'info').toLowerCase();
    counts[sev in counts ? sev : 'info']++;
  }
  return counts;
}

function computeScannerCounts(findings) {
  const counts = {};
  for (const f of findings) {
    const src = String(f.Source || 'unknown').toLowerCase();
    counts[src] = (counts[src] || 0) + 1;
  }
  return counts;
}

// Same hash shape as file-issues.js — keep IDs consistent across both outputs.
function findingFingerprint(f) {
  const parts = [
    f.Source || '',
    f.RuleID || '',
    f.File || '',
    String(f.StartLine || 0),
  ].join('|');
  return 'F-' + crypto.createHash('sha256').update(parts).digest('hex').slice(0, 8);
}

function ageDays(isoOrDate) {
  if (!isoOrDate) return 0;
  const then = new Date(isoOrDate).getTime();
  if (!then || isNaN(then)) return 0;
  const diff = Date.now() - then;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function nextMondayUTC() {
  // Workflow cron: '0 6 * * 1' → next Monday 06:00 UTC.
  // Spec asked for 03:00 but cron is 06:00 — match the actual schedule.
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6, 0, 0, 0));
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon
  const daysUntilMonday = (8 - dow) % 7 || 7; // always jump to next week's Monday
  d.setUTCDate(d.getUTCDate() + (dow === 1 && now.getUTCHours() < 6 ? 0 : daysUntilMonday));
  return d.toISOString();
}

async function ghFetch(pathname) {
  if (!TOKEN) return null;
  try {
    const res = await fetch(`https://api.github.com${pathname}`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'kilowott-repo-health-aggregate',
      },
    });
    if (!res.ok) {
      console.warn(`[aggregate] API ${res.status} on ${pathname}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[aggregate] fetch failed on ${pathname}: ${err.message}`);
    return null;
  }
}

async function fetchRepoMetadata(repoName) {
  const data = await ghFetch(`/repos/${ORG}/${repoName}`);
  if (!data) return { description: '', language: '' };
  return {
    description: data.description || '',
    language: data.language || '',
  };
}

async function fetchHealthIssueUrl(repoName) {
  const issues = await ghFetch(`/repos/${ORG}/${repoName}/issues?labels=health-check&state=open&per_page=1`);
  if (!Array.isArray(issues) || issues.length === 0) return null;
  return issues[0].html_url || null;
}

function buildDashboardFindings(findings) {
  return findings.map(f => ({
    id: findingFingerprint(f),
    severity: String(f.Severity || 'info').toLowerCase(),
    scanner: String(f.Source || 'unknown').toLowerCase(),
    rule: f.RuleID || 'unknown',
    file: f.File || '',
    line: f.StartLine || 0,
    title: f.Match || f.RuleID || '',
    first_seen: f.Date || '',
    age_days: ageDays(f.Date),
    status: 'open',     // TODO(5a-2+): resolve via dismissal comments on the target repo's issue
    labels: [],
    gh_issue: null,     // repo-level URL injected after per-repo loop
  }));
}

async function writeDashboardAndHistory(results) {
  const generatedAt = new Date().toISOString();
  const today = generatedAt.slice(0, 10);
  const totalsBySev = Object.fromEntries(SEVERITIES.map(s => [s, 0]));

  const reposOut = [];
  for (const { repo, result } of results) {
    const findings = result.findings || [];
    const sevCounts = computeSeverityCounts(findings);
    const scannerCounts = computeScannerCounts(findings);
    for (const s of SEVERITIES) totalsBySev[s] += sevCounts[s];

    const [meta, issueUrl] = await Promise.all([
      fetchRepoMetadata(repo.name),
      findings.length > 0 ? fetchHealthIssueUrl(repo.name) : Promise.resolve(null),
    ]);

    const dashFindings = buildDashboardFindings(findings).map(f => ({ ...f, gh_issue: issueUrl }));

    reposOut.push({
      name: repo.name,
      description: meta.description,
      language: meta.language,
      url: `https://github.com/${ORG}/${repo.name}`,
      last_scanned_at: result.lastScannedAt || generatedAt,
      severity_counts: sevCounts,
      scanner_counts: scannerCounts,
      findings: dashFindings,
    });

    // Per-repo history snapshot (daily file)
    const histDir = path.join('history', repo.name);
    fs.mkdirSync(histDir, { recursive: true });
    const histPath = path.join(histDir, `${today}.json`);
    fs.writeFileSync(histPath, JSON.stringify({
      date: today,
      severity_counts: sevCounts,
      scanner_counts: scannerCounts,
      total: findings.length,
    }, null, 2));
  }

  // Combined history — one file per repo (all dates sorted ascending) +
  // one org-wide index. The dashboard UI fetches the org-wide file once
  // on Overview/Trends mount instead of N per-date files.
  const combinedByRepo = {};
  for (const { repo } of results) {
    const histDir = path.join('history', repo.name);
    if (!fs.existsSync(histDir)) continue;
    const entries = fs.readdirSync(histDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(histDir, f), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean);
    fs.writeFileSync(path.join(histDir, 'combined.json'), JSON.stringify(entries, null, 2));
    combinedByRepo[repo.name] = entries;
  }
  fs.writeFileSync('history-combined.json', JSON.stringify(combinedByRepo, null, 2));

  const dashboard = {
    generated_at: generatedAt,
    next_scan_at: nextMondayUTC(),
    repos: reposOut,
    totals: {
      repos_monitored: results.length,
      repos_clean: results.filter(r => r.result.findings.length === 0 && r.result.status !== 'not-scanned').length,
      findings_by_severity: totalsBySev,
    },
  };

  // Minified — dashboard.json is fetched on every page load; 14k findings
  // pretty-printed ~7 MB vs ~4 MB raw. The history files stay pretty for
  // human readability since they're small.
  fs.writeFileSync('dashboard.json', JSON.stringify(dashboard));
  console.log(`dashboard.json written: ${reposOut.length} repos, totals=${JSON.stringify(dashboard.totals.findings_by_severity)}`);
}

async function generate() {
  const repos = loadTargets();
  const now = new Date().toISOString().replace('T', ' ').replace(/\..+/, ' UTC');

  const results = repos.map(r => ({ repo: r, result: loadLatest(r.name) }));
  const totalFindings = results.reduce((sum, { result }) => sum + result.findings.length, 0);
  const repoCount = repos.length;
  const cleanCount = results.filter(r => r.result.status === 'clean').length;
  const flaggedCount = results.filter(r => r.result.status === 'findings').length;

  const lines = [];

  lines.push('# Kilowott-labs repo health dashboard');
  lines.push('');
  lines.push(`_Last regenerated: **${now}**_  `);
  lines.push(`_Repos monitored: **${repoCount}**  ·  Clean: **${cleanCount}**  ·  Flagged: **${flaggedCount}**  ·  Total findings: **${totalFindings}**_`);
  lines.push('');
  lines.push('## Status at a glance');
  lines.push('');
  lines.push('| Repo | Stack | Priority | Secret scan | Visibility |');
  lines.push('|---|---|---|---|---|');

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...results].sort((a, b) => {
    return (priorityOrder[a.repo.priority] ?? 9) - (priorityOrder[b.repo.priority] ?? 9);
  });

  for (const { repo, result } of sorted) {
    const link = `[\`${repo.name}\`](https://github.com/Kilowott-labs/${repo.name})`;
    const stack = escapeMd(repo.stack || '—');
    const pri = escapeMd(repo.priority || '—');
    const status = statusCell(result, repo.priority);
    const vis = visibilityCell(repo);
    lines.push(`| ${link} | ${stack} | ${pri} | ${status} | ${vis} |`);
  }

  lines.push('');
  lines.push('## Detailed findings');
  lines.push('');

  const flagged = sorted.filter(({ result }) => result.findings.length > 0);
  if (flagged.length === 0) {
    lines.push('_No active findings. All clear._');
    lines.push('');
  } else {
    for (const { repo, result } of flagged) {
      lines.push(`### \`${repo.name}\` — ${result.findings.length} findings`);
      lines.push('');
      lines.push('| Rule | File | Line | Commit | Date |');
      lines.push('|---|---|---|---|---|');
      const shown = result.findings.slice(0, 25);
      for (const f of shown) {
        const rule = escapeMd(f.RuleID || f.ruleID || 'unknown');
        const file = escapeMd(f.File || f.file || '');
        const line = f.StartLine || f.startLine || '';
        const commit = String(f.Commit || f.commit || '').slice(0, 7);
        const date = String(f.Date || f.date || '').slice(0, 10);
        lines.push(`| ${rule} | \`${file}\` | ${line} | \`${commit}\` | ${date} |`);
      }
      if (result.findings.length > shown.length) {
        lines.push('');
        lines.push(`_${result.findings.length - shown.length} more findings — see [\`reports/${repo.name}/latest.json\`](reports/${repo.name}/latest.json)._`);
      }
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('## How this works');
  lines.push('');
  lines.push('- Weekly scan runs every **Monday 06:00 UTC** via GitHub Actions');
  lines.push('- Auto-discovery queries the org for all repos, applies skip rules (archived, forks, scratch/test/demo), then merges with `targets.yml` overrides');
  lines.push('- Gitleaks walks **full git history** on every target repo');
  lines.push('- Findings are written to `reports/<repo>/<date>.json` and `latest.json`');
  lines.push('- This README is regenerated automatically after each scan');
  lines.push('');
  lines.push('Trigger a manual scan: **Actions → Weekly repo health scan → Run workflow**. Leave the target blank to scan everything, or enter a single repo name.');
  lines.push('');
  lines.push('## What each finding means');
  lines.push('');
  lines.push('- 🔴 **Critical repos** (priority critical) are flagged red on *any* finding — treat every finding as a live credential until proven otherwise.');
  lines.push('- 🟡 **Other repos** are flagged yellow for 1–4 findings, red for 5+.');
  lines.push('- 🟢 **Clean** = Gitleaks found nothing across full history with the current rules.');
  lines.push('- ⚪ **Not scanned** = repo is in the target list but no report has run yet.');
  lines.push('');
  lines.push('When something is flagged: **rotate the credential first**, then clean the history (see [the GitHub docs on removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)).');
  lines.push('');
  lines.push('## Roadmap');
  lines.push('');
  lines.push('- [x] **Phase 1** — Gitleaks secret scanning across full history');
  lines.push('- [x] **Phase 3** — Auto-managed issues in target repos + weekly digest');
  lines.push('- [x] **Phase 3b** — Auto-discovery of new repos (this release)');
  lines.push('- [ ] **Phase 2** — Stack-aware scanners: `composer audit`, `npm audit`, PHPCS+WPCS, Semgrep');
  lines.push('- [ ] **Phase 4** — Uptime monitoring via Upptime for client sites');
  lines.push('');

  fs.writeFileSync('README.md', lines.join('\n'));
  console.log(`Dashboard regenerated: ${repoCount} repos, ${totalFindings} total findings.`);

  await writeDashboardAndHistory(results);
}

generate().catch(err => {
  console.error('aggregate.js failed:', err);
  process.exit(1);
});
