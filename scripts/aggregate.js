#!/usr/bin/env node
/**
 * Regenerates README.md as a health dashboard.
 *
 * Reads:
 *   - TARGETS_JSON env var (path to targets JSON, defaults to 'targets.json')
 *     Expected shape: { org: "...", repos: [{ name, priority, stack, private }] }
 *   - reports/<repo>/latest.json for each target
 *
 * Writes:
 *   - README.md
 *
 * Run locally:
 *   TARGETS_JSON=discovered-targets.json node scripts/aggregate.js
 */

const fs = require('fs');
const path = require('path');

const TARGETS_JSON = process.env.TARGETS_JSON || 'targets.json';

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

function generate() {
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
}

generate();
