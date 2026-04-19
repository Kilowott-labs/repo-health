#!/usr/bin/env node
/**
 * Phase 3c: state-transition-commenter
 *
 * Runs after file-issues.js. For each repo, compares this scan's finding
 * count to the previous scan's count (read from reports/<repo>/history.json,
 * which we maintain here). Posts an audit comment on the health-check issue
 * when the delta crosses the threshold OR the clean/flagged state changes.
 *
 * This is audit trail, not alerting — Slack handles urgent alerts. Comments
 * here are for the "what happened to this repo's finding count between last
 * Monday and this Monday" question.
 *
 * Threshold rule:
 *   - Post a comment if: |delta| > THRESHOLD  OR  repo went clean→flagged  OR  flagged→clean
 *   - Otherwise: update history silently, no comment
 *
 * Env:
 *   GITHUB_TOKEN    PAT with Issues: Write on target repos
 *   TARGETS_JSON    path to discovered-targets.json
 *   REPORTS_DIR     path to reports/
 *   ORG             org name
 *   THRESHOLD       numeric delta threshold (default 5)
 */

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GITHUB_TOKEN;
const ORG = process.env.ORG || 'Kilowott-labs';
const TARGETS_JSON = process.env.TARGETS_JSON || 'discovered-targets.json';
const REPORTS_DIR = process.env.REPORTS_DIR || 'reports';
const THRESHOLD = parseInt(process.env.THRESHOLD || '5', 10);
const ISSUE_LABEL = 'health-check';

if (!TOKEN) {
  console.error('GITHUB_TOKEN required');
  process.exit(0); // don't fail workflow
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------
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
    throw new Error(`GitHub API ${res.status} on ${pathname}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function findHealthIssue(owner, repo) {
  const params = new URLSearchParams({
    labels: ISSUE_LABEL,
    state: 'all',
    per_page: '20',
  });
  const issues = await gh(`/repos/${owner}/${repo}/issues?${params}`);
  const open = issues.find(i => i.state === 'open' && !i.pull_request);
  if (open) return open;
  const closed = issues
    .filter(i => i.state === 'closed' && !i.pull_request)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return closed[0] || null;
}

// ---------------------------------------------------------------------------
// History file management
// ---------------------------------------------------------------------------
function historyPath(repoName) {
  return path.join(REPORTS_DIR, repoName, 'history.json');
}

function loadHistory(repoName) {
  const p = historyPath(repoName);
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(repoName, entries) {
  const p = historyPath(repoName);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Keep last 26 entries (~6 months at weekly cadence) to cap file size
  const trimmed = entries.slice(-26);
  fs.writeFileSync(p, JSON.stringify(trimmed, null, 2));
}

function currentCount(repoName) {
  const latestPath = path.join(REPORTS_DIR, repoName, 'latest.json');
  if (!fs.existsSync(latestPath)) return 0;
  try {
    const body = fs.readFileSync(latestPath, 'utf8').trim();
    if (!body || body === 'null') return 0;
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function countBySource(repoName) {
  const latestPath = path.join(REPORTS_DIR, repoName, 'latest.json');
  if (!fs.existsSync(latestPath)) return {};
  try {
    const body = fs.readFileSync(latestPath, 'utf8').trim();
    if (!body || body === 'null') return {};
    const findings = JSON.parse(body);
    if (!Array.isArray(findings)) return {};
    const counts = {};
    for (const f of findings) {
      const src = f.Source || f.source || 'gitleaks';
      counts[src] = (counts[src] || 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Transition detection
// ---------------------------------------------------------------------------
function detectTransition(previous, current) {
  // No previous data — no transition to report
  if (!previous || typeof previous.count !== 'number') {
    return { shouldPost: false, kind: 'first-observation' };
  }

  const prevCount = previous.count;
  const currCount = current.count;
  const delta = currCount - prevCount;

  // State transitions are always worth noting
  if (prevCount === 0 && currCount > 0) {
    return { shouldPost: true, kind: 'clean-to-flagged', delta };
  }
  if (prevCount > 0 && currCount === 0) {
    return { shouldPost: true, kind: 'flagged-to-clean', delta };
  }

  // Threshold-based on magnitude of change
  if (Math.abs(delta) > THRESHOLD) {
    return {
      shouldPost: true,
      kind: delta > 0 ? 'increase' : 'decrease',
      delta,
    };
  }

  return { shouldPost: false, kind: 'minor-change', delta };
}

// ---------------------------------------------------------------------------
// Comment body
// ---------------------------------------------------------------------------
function buildCommentBody(repo, previous, current, transition, generatedAt) {
  const lines = [];
  lines.push(`### 📊 Finding-count state change — ${generatedAt}`);
  lines.push('');

  const emoji = {
    'clean-to-flagged': '🚨',
    'flagged-to-clean': '✅',
    'increase': '📈',
    'decrease': '📉',
  }[transition.kind] || '📊';

  lines.push(`${emoji} **${previous.count} → ${current.count}** (Δ ${transition.delta > 0 ? '+' : ''}${transition.delta})`);
  lines.push('');

  if (transition.kind === 'clean-to-flagged') {
    lines.push('Previously clean. New findings appeared since the last scan.');
  } else if (transition.kind === 'flagged-to-clean') {
    lines.push('All findings cleared since the last scan. 🎉');
  } else if (transition.kind === 'increase') {
    lines.push(`Findings increased by more than ${THRESHOLD}. Could be new commits with issues, a new scanner enabled, or a ruleset change.`);
  } else if (transition.kind === 'decrease') {
    lines.push(`Findings decreased by more than ${THRESHOLD}. Usually means fixes landed or findings were allowlisted.`);
  }

  // Source breakdown if available
  if (current.bySource && Object.keys(current.bySource).length > 0) {
    const prevBySource = previous.bySource || {};
    lines.push('');
    lines.push('**Change by scanner:**');
    lines.push('');
    lines.push('| Scanner | Previous | Current | Δ |');
    lines.push('|---|---|---|---|');
    const allSources = new Set([...Object.keys(prevBySource), ...Object.keys(current.bySource)]);
    for (const src of [...allSources].sort()) {
      const prev = prevBySource[src] || 0;
      const curr = current.bySource[src] || 0;
      const d = curr - prev;
      const dStr = d === 0 ? '—' : (d > 0 ? `+${d}` : String(d));
      lines.push(`| ${src} | ${prev} | ${curr} | ${dStr} |`);
    }
  }

  lines.push('');
  lines.push(`<sub>Auto-posted by repo-health state tracker. Threshold: |Δ| > ${THRESHOLD}.</sub>`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  if (!fs.existsSync(TARGETS_JSON)) {
    console.error(`${TARGETS_JSON} missing`);
    process.exit(0);
  }
  const targets = JSON.parse(fs.readFileSync(TARGETS_JSON, 'utf8')).repos || [];
  const generatedAt = new Date().toISOString().replace('T', ' ').replace(/\..+/, ' UTC');
  const isoDate = new Date().toISOString();

  let posted = 0;
  let skipped = 0;
  let errored = 0;

  for (const repo of targets) {
    try {
      const history = loadHistory(repo.name);
      const previous = history.length > 0 ? history[history.length - 1] : null;

      const current = {
        date: isoDate,
        count: currentCount(repo.name),
        bySource: countBySource(repo.name),
      };

      const transition = detectTransition(previous, current);

      if (transition.shouldPost) {
        const issue = await findHealthIssue(ORG, repo.name);
        if (!issue) {
          console.log(`[${repo.name}] transition detected but no health-check issue to comment on — skipping`);
        } else {
          const body = buildCommentBody(repo, previous, current, transition, generatedAt);
          await gh(`/repos/${ORG}/${repo.name}/issues/${issue.number}/comments`, {
            method: 'POST',
            body: JSON.stringify({ body }),
          });
          console.log(`[${repo.name}] posted audit comment on #${issue.number}: ${transition.kind} (Δ ${transition.delta})`);
          posted++;
        }
      } else {
        if (transition.kind !== 'first-observation') {
          console.log(`[${repo.name}] no significant change (Δ ${transition.delta}) — silent update`);
        } else {
          console.log(`[${repo.name}] first observation, no baseline to compare`);
        }
        skipped++;
      }

      // Always update history
      history.push(current);
      saveHistory(repo.name, history);
    } catch (e) {
      console.error(`[${repo.name}] state-transition failed: ${e.message}`);
      errored++;
    }
  }

  console.log(`Summary: posted=${posted} skipped=${skipped} errored=${errored}`);
})();
