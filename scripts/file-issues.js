#!/usr/bin/env node
/**
 * Phase 3: issue filer
 *
 * For each target repo, maintains ONE issue summarising all active findings.
 * - Idempotent: edits the existing issue in place, never creates duplicates
 * - Dismissal-aware: findings labeled wontfix/acknowledged/false-positive
 *   are suppressed on future runs
 * - Closes the issue when the repo goes clean
 *
 * Per-finding stability: each finding is assigned a stable fingerprint
 * (rule + file + line + commit-short) so the team can reference a specific
 * finding even as the issue body is regenerated.
 *
 * Inputs (env / args):
 *   GITHUB_TOKEN          PAT with Issues: Write on all Kilowott-labs repos
 *   ORG                   e.g. "Kilowott-labs"
 *   TARGETS_JSON          path to targets.json (from yq of targets.yml)
 *   REPORTS_DIR           path to reports/ (contains <repo>/latest.json)
 *
 * Exits non-zero only on unexpected API errors, never on findings.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.GITHUB_TOKEN;
const ORG = process.env.ORG || 'Kilowott-labs';
const TARGETS_JSON = process.env.TARGETS_JSON || 'targets.json';
const REPORTS_DIR = process.env.REPORTS_DIR || 'reports';
const ISSUE_LABEL = 'health-check';
const DISMISS_LABELS = ['wontfix', 'acknowledged', 'false-positive'];
const TITLE_PREFIX = '[health-check]';

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fingerprinting — stable per-finding ID so dismissals survive re-scans
// ---------------------------------------------------------------------------
function fingerprint(finding) {
  const rule = finding.RuleID || finding.ruleID || 'unknown';
  const file = finding.File || finding.file || '';
  const line = finding.StartLine || finding.startLine || 0;
  const commit = String(finding.Commit || finding.commit || '').slice(0, 7);
  const h = crypto.createHash('sha1')
    .update(`${rule}|${file}|${line}|${commit}`)
    .digest('hex')
    .slice(0, 8);
  return `F-${h}`;
}

function severityOf(finding, repoPriority) {
  // Any secret finding in a public repo is critical
  // Any secret finding in a critical-priority repo is critical
  // Everything else starts at high (we'll calibrate when Phase 2 adds non-secret scanners)
  if (repoPriority === 'critical') return 'critical';
  return 'high';
}

function severityEmoji(s) {
  return { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' }[s] || '⚪';
}

// ---------------------------------------------------------------------------
// GitHub API helpers (no external deps — use built-in fetch in Node 20+)
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
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} on ${opts.method || 'GET'} ${pathname}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function findExistingIssue(owner, repo) {
  // Find the single open [health-check] issue, if any. We also look at closed
  // issues so we can reopen instead of creating a new one if findings return.
  const q = encodeURIComponent(
    `repo:${owner}/${repo} is:issue label:${ISSUE_LABEL} in:title ${TITLE_PREFIX}`,
  );
  const search = await gh(`/search/issues?q=${q}&per_page=5`);
  // Prefer open, then most-recently-updated closed
  const items = search.items || [];
  const open = items.find(i => i.state === 'open');
  if (open) return open;
  return items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0] || null;
}

async function ensureLabels(owner, repo) {
  const desired = [
    { name: ISSUE_LABEL, color: 'b60205', description: 'Auto-managed by repo-health scanner' },
    { name: 'wontfix', color: 'ffffff', description: 'Finding acknowledged — do not fix' },
    { name: 'acknowledged', color: 'fbca04', description: 'Finding reviewed — fix planned' },
    { name: 'false-positive', color: '0e8a16', description: 'Finding is incorrect — will allowlist' },
  ];
  for (const l of desired) {
    try {
      await gh(`/repos/${owner}/${repo}/labels`, {
        method: 'POST',
        body: JSON.stringify(l),
      });
    } catch (e) {
      // 422 = already exists, ignore
      if (!/\b422\b/.test(e.message)) throw e;
    }
  }
}

async function readDismissals(owner, repo) {
  // A finding is dismissed if its fingerprint appears in any issue/comment
  // tagged with wontfix / acknowledged / false-positive.
  //
  // Convention: to dismiss finding F-abc123, either:
  //   (a) apply a dismissal label to the health-check issue and add a comment
  //       like "dismiss F-abc123 reason: test fixture"
  //   (b) open a separate issue titled "[health-check-dismiss] F-abc123" with
  //       a dismissal label
  const dismissed = new Map(); // fingerprint -> { reason, label }
  for (const label of DISMISS_LABELS) {
    const q = encodeURIComponent(`repo:${owner}/${repo} is:issue label:${label}`);
    const search = await gh(`/search/issues?q=${q}&per_page=100`);
    for (const issue of (search.items || [])) {
      // Scrape fingerprints from body + comments
      const bodies = [issue.body || ''];
      if (issue.comments > 0) {
        const comments = await gh(`/repos/${owner}/${repo}/issues/${issue.number}/comments?per_page=100`);
        for (const c of comments) bodies.push(c.body || '');
      }
      for (const body of bodies) {
        const matches = body.matchAll(/\bF-[a-f0-9]{8}\b/g);
        for (const m of matches) {
          if (!dismissed.has(m[0])) {
            dismissed.set(m[0], { reason: extractReason(body, m[0]), label });
          }
        }
      }
    }
  }
  return dismissed;
}

function extractReason(body, fingerprint) {
  // Pull the rest of the line after the fingerprint as the reason
  const re = new RegExp(`${fingerprint}\\s*[:\\-]?\\s*(.+)`);
  const m = body.match(re);
  return m ? m[1].trim().slice(0, 120) : '';
}

// ---------------------------------------------------------------------------
// Issue body rendering
// ---------------------------------------------------------------------------
function renderIssueBody({ owner, repo, repoPriority, activeFindings, dismissedFindings, runUrl, generatedAt }) {
  const lines = [];
  lines.push(`_Auto-generated by [repo-health](https://github.com/${ORG}/repo-health) on ${generatedAt}._`);
  lines.push('_This issue is updated in place after every scan. Do not rename the title._');
  lines.push('');

  // Severity counts
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of activeFindings) counts[f.severity]++;

  lines.push('## Summary');
  lines.push('');
  lines.push('| Severity | Count |');
  lines.push('|---|---|');
  lines.push(`| 🔴 Critical | ${counts.critical} |`);
  lines.push(`| 🟠 High | ${counts.high} |`);
  lines.push(`| 🟡 Medium | ${counts.medium} |`);
  lines.push(`| 🔵 Low | ${counts.low} |`);
  lines.push('');
  lines.push(`**Repo priority:** \`${repoPriority}\`  ·  **Scan run:** [${runUrl.split('/').pop()}](${runUrl})`);
  lines.push('');

  if (activeFindings.length === 0) {
    lines.push('## ✅ No active findings');
    lines.push('');
    lines.push('This repo is currently clean. Issue will close automatically. It will reopen if new findings appear on the next scan.');
    lines.push('');
  } else {
    lines.push('## Active findings');
    lines.push('');
    lines.push('Each finding has a stable ID (`F-xxxxxxxx`). Reference this ID in a dismissal comment or label to suppress it on future scans.');
    lines.push('');

    // Group by severity
    for (const sev of ['critical', 'high', 'medium', 'low']) {
      const forSev = activeFindings.filter(f => f.severity === sev);
      if (forSev.length === 0) continue;
      lines.push(`### ${severityEmoji(sev)} ${sev[0].toUpperCase() + sev.slice(1)} (${forSev.length})`);
      lines.push('');
      for (const f of forSev) {
        lines.push(`#### \`${f.id}\` — ${f.ruleId}`);
        lines.push('');
        lines.push(`- **File:** \`${f.file}\` line ${f.line}`);
        lines.push(`- **Commit:** \`${f.commit}\`${f.date ? ` (${f.date})` : ''}`);
        if (f.match) lines.push(`- **Pattern matched:** \`${f.match.slice(0, 80)}${f.match.length > 80 ? '…' : ''}\``);
        lines.push('');
        lines.push('<details><summary>Why this matters &amp; fix sequence</summary>');
        lines.push('');
        lines.push(explainRule(f.ruleId));
        lines.push('');
        lines.push('**Fix sequence:**');
        lines.push('');
        for (const step of fixSteps(f, owner, repo)) {
          lines.push(`- [ ] ${step}`);
        }
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }
    }
  }

  if (dismissedFindings.length > 0) {
    lines.push('## Dismissed findings');
    lines.push('');
    lines.push('<details><summary>Show dismissed</summary>');
    lines.push('');
    lines.push('| ID | Rule | Status | Reason |');
    lines.push('|---|---|---|---|');
    for (const d of dismissedFindings) {
      lines.push(`| \`${d.id}\` | ${d.ruleId} | ${d.label} | ${d.reason || '—'} |`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## How to dismiss a finding');
  lines.push('');
  lines.push('Add a comment to this issue with one of these formats:');
  lines.push('');
  lines.push('```');
  lines.push('dismiss F-abc12345 reason: test fixture, not a real credential');
  lines.push('```');
  lines.push('');
  lines.push('Then apply one of these labels to this issue:');
  lines.push('- `false-positive` — finding is wrong, scanner rule will be allowlisted');
  lines.push('- `acknowledged` — finding is real, fix is planned but not urgent');
  lines.push('- `wontfix` — finding is real, decision is not to fix');
  lines.push('');
  lines.push('The next scan will honor the dismissal.');

  return lines.join('\n');
}

function explainRule(ruleId) {
  const map = {
    'generic-api-key': 'A value matching a generic API key pattern was committed. Even if the value looks low-impact, assume it was indexed by scrapers the moment it hit a public repo.',
    'wp-auth-key': 'A WordPress authentication key/salt was committed as a literal. These must live in environment variables or a separate `.env` that is gitignored.',
    'wp-db-password-literal': 'The database password is hardcoded in `wp-config.php`. Move to an environment variable before deploy.',
    'woocommerce-api-secret': 'A WooCommerce REST API consumer secret (cs_...) was committed. This grants read/write access to orders, customers, and payments.',
    'woocommerce-api-key': 'A WooCommerce REST API consumer key (ck_...) was committed. Paired with the secret, enables full API access.',
    'stripe-secret-key': 'A Stripe secret key was committed. **Live keys** can charge real cards. Rotate immediately via the Stripe dashboard.',
  };
  return map[ruleId] || 'A potential secret was detected by the scanner. Review the match and decide whether it is a real credential.';
}

function fixSteps(finding, owner, repo) {
  const common = [
    `Verify whether this is a real credential (open \`${finding.file}\` at commit \`${finding.commit}\`)`,
    'If real: **rotate the credential at the provider immediately** — assume compromised',
    `Stop tracking the file: \`echo "${finding.file}" >> .gitignore && git rm --cached "${finding.file}" && git commit -m "fix(security): stop tracking ${path.basename(finding.file)}"\``,
    'For public repos: history purge is optional — rotation is the real mitigation',
    'For private repos with few collaborators: consider `git filter-repo` to scrub history',
    'Add the finding ID to a dismissal comment here once resolved',
  ];
  return common;
}

// ---------------------------------------------------------------------------
// Main per-repo flow
// ---------------------------------------------------------------------------
async function processRepo(repo, runUrl, generatedAt) {
  const owner = ORG;
  const name = repo.name;
  const latestPath = path.join(REPORTS_DIR, name, 'latest.json');
  if (!fs.existsSync(latestPath)) {
    console.log(`[${name}] no latest.json — skipping`);
    return;
  }

  let rawFindings;
  try {
    rawFindings = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  } catch (e) {
    console.error(`[${name}] malformed report: ${e.message}`);
    return;
  }
  if (!Array.isArray(rawFindings)) rawFindings = [];

  await ensureLabels(owner, name);
  const dismissals = await readDismissals(owner, name);

  // Normalise + classify
  const classified = rawFindings.map(f => ({
    id: fingerprint(f),
    ruleId: f.RuleID || f.ruleID || 'unknown',
    file: f.File || f.file || '',
    line: f.StartLine || f.startLine || 0,
    commit: String(f.Commit || f.commit || '').slice(0, 7),
    date: String(f.Date || f.date || '').slice(0, 10),
    match: f.Match || f.match || '',
    severity: severityOf(f, repo.priority),
  }));

  const active = classified.filter(f => !dismissals.has(f.id));
  const dismissed = classified
    .filter(f => dismissals.has(f.id))
    .map(f => ({ ...f, ...dismissals.get(f.id) }));

  console.log(`[${name}] active=${active.length} dismissed=${dismissed.length} raw=${rawFindings.length}`);

  const title = `${TITLE_PREFIX} ${active.length} active finding${active.length === 1 ? '' : 's'} — ${name}`;
  const body = renderIssueBody({
    owner, repo: name,
    repoPriority: repo.priority,
    activeFindings: active,
    dismissedFindings: dismissed,
    runUrl, generatedAt,
  });

  const existing = await findExistingIssue(owner, name);

  if (!existing && active.length === 0) {
    // Nothing to do — repo is clean, no prior issue
    return;
  }

  if (existing) {
    // Update in place
    const nextState = active.length === 0 ? 'closed' : 'open';
    await gh(`/repos/${owner}/${name}/issues/${existing.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ title, body, state: nextState, labels: [ISSUE_LABEL] }),
    });
    console.log(`[${name}] updated issue #${existing.number} (state=${nextState})`);
  } else {
    // Create new
    const created = await gh(`/repos/${owner}/${name}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body, labels: [ISSUE_LABEL] }),
    });
    console.log(`[${name}] opened issue #${created.number}`);
  }
}

// ---------------------------------------------------------------------------
// Digest issue in repo-health itself
// ---------------------------------------------------------------------------
async function writeDigestIssue(repos, results, runUrl, generatedAt) {
  const digestTitle = `[health-check] Weekly digest — ${generatedAt.split(' ')[0]}`;
  const totalActive = results.reduce((s, r) => s + r.active, 0);
  const flaggedRepos = results.filter(r => r.active > 0);

  const lines = [];
  lines.push(`_Generated ${generatedAt}. Run: [${runUrl.split('/').pop()}](${runUrl})._`);
  lines.push('');
  lines.push(`**${totalActive}** active findings across **${flaggedRepos.length}** of **${repos.length}** repos.`);
  lines.push('');
  lines.push('| Repo | Priority | Active | Dismissed | Issue |');
  lines.push('|---|---|---|---|---|');
  for (const r of results.sort((a, b) => b.active - a.active)) {
    const issueLink = r.issueNumber
      ? `[#${r.issueNumber}](https://github.com/${ORG}/${r.name}/issues/${r.issueNumber})`
      : '—';
    lines.push(`| \`${r.name}\` | ${r.priority} | ${r.active} | ${r.dismissed} | ${issueLink} |`);
  }
  lines.push('');
  lines.push('[Open dashboard](https://github.com/' + ORG + '/repo-health)');

  // Digest lives in repo-health itself, one issue per week (close old ones)
  const existing = await gh(
    `/search/issues?q=${encodeURIComponent(`repo:${ORG}/repo-health is:issue label:${ISSUE_LABEL}-digest is:open`)}`,
  );
  for (const old of (existing.items || [])) {
    await gh(`/repos/${ORG}/repo-health/issues/${old.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    });
  }
  await ensureLabels(ORG, 'repo-health');
  try {
    await gh(`/repos/${ORG}/repo-health/labels`, {
      method: 'POST',
      body: JSON.stringify({ name: `${ISSUE_LABEL}-digest`, color: '1d76db', description: 'Weekly aggregate report' }),
    });
  } catch (e) { if (!/\b422\b/.test(e.message)) throw e; }
  await gh(`/repos/${ORG}/repo-health/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: digestTitle, body: lines.join('\n'), labels: [`${ISSUE_LABEL}-digest`] }),
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const targets = JSON.parse(fs.readFileSync(TARGETS_JSON, 'utf8')).repos || [];
  const runUrl = process.env.RUN_URL
    || `https://github.com/${ORG}/repo-health/actions`;
  const generatedAt = new Date().toISOString().replace('T', ' ').replace(/\..+/, ' UTC');

  const results = [];
  for (const repo of targets) {
    try {
      const latestPath = path.join(REPORTS_DIR, repo.name, 'latest.json');
      let raw = [];
      if (fs.existsSync(latestPath)) {
        raw = JSON.parse(fs.readFileSync(latestPath, 'utf8')) || [];
      }
      const dismissals = await readDismissals(ORG, repo.name).catch(() => new Map());
      const classified = raw.map(f => ({ ...f, id: fingerprint(f) }));
      const active = classified.filter(f => !dismissals.has(f.id));
      const existing = await findExistingIssue(ORG, repo.name).catch(() => null);

      await processRepo(repo, runUrl, generatedAt);

      results.push({
        name: repo.name,
        priority: repo.priority,
        active: active.length,
        dismissed: classified.length - active.length,
        issueNumber: existing ? existing.number : null,
      });
    } catch (e) {
      console.error(`[${repo.name}] failed: ${e.message}`);
      results.push({ name: repo.name, priority: repo.priority, active: -1, dismissed: 0, issueNumber: null });
    }
  }

  try {
    await writeDigestIssue(targets, results, runUrl, generatedAt);
  } catch (e) {
    console.error(`digest issue failed: ${e.message}`);
  }

  console.log('Issue filing complete.');
})();
