#!/usr/bin/env node
/**
 * Phase 5c flow B — false-positive → allowlist PR.
 *
 * For each target repo, query health-check issues labeled
 * `false-positive`. For each matching issue:
 *   - Parse finding IDs (F-xxxxxxxx) from the issue body.
 *   - Look up each finding in reports/<repo>/latest.json.
 *   - Generate a config edit in repo-health itself:
 *       gitleaks   → .gitleaks.toml    (allowlist paths)
 *       phpcs      → configs/phpcs-ruleset.xml  (exclude-pattern)
 *       semgrep    → configs/semgrep.yml        (paths:exclude)
 *       npm-audit  → SKIPPED (dependency CVEs need manual triage)
 *       osv        → SKIPPED (same reason)
 *   - Batch all edits into a single monthly PR against repo-health.
 *
 * Idempotency: branch name is `repo-health/allowlist-update-<YYYY-MM>`
 * — re-runs in the same month are no-ops if the branch already
 * exists on origin.
 *
 * Environment:
 *   GH_TOKEN       App token (write access to repo-health)
 *   DRY_RUN        "true" to log intent without pushing / opening PRs
 *   TARGETS_JSON   path to discovered-targets.json
 *   REPORTS_DIR    path to reports/ (default 'reports')
 *   ORG            e.g. "Kilowott-labs"
 *
 * Exit code: 0 on any outcome. Best-effort tool.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { fingerprint } = require('./lib/fingerprint');

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const TARGETS_JSON = process.env.TARGETS_JSON || 'discovered-targets.json';
const REPORTS_DIR = process.env.REPORTS_DIR || 'reports';
const ORG = process.env.ORG || 'Kilowott-labs';

const MONTH = new Date().toISOString().slice(0, 7);
const BRANCH = `repo-health/allowlist-update-${MONTH}`;
const BRANCH_PATTERN = 'repo-health/allowlist-update-';

if (!TOKEN) {
  console.error('GH_TOKEN / GITHUB_TOKEN required.');
  process.exit(1);
}

function log(line) {
  console.log(`[autofix-allowlist] ${line}`);
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: TOKEN, GITHUB_TOKEN: TOKEN },
  });
}

// Array-form git runner — avoids shell interpretation of dynamic strings
// (commit messages, PR bodies) that would otherwise need escaping.
function git(args, opts = {}) {
  return execFileSync('git', args, {
    stdio: 'inherit', encoding: 'utf8', ...opts,
  });
}

// ---------------------------------------------------------------------------
// Discover false-positive issues across all target repos
// ---------------------------------------------------------------------------
function loadTargets() {
  const raw = JSON.parse(fs.readFileSync(TARGETS_JSON, 'utf8'));
  return raw.repos || [];
}

function findFalsePositiveIssues(repoName) {
  try {
    const body = gh([
      'issue', 'list',
      '--repo', `${ORG}/${repoName}`,
      '--label', 'health-check,false-positive',
      '--state', 'open',
      '--json', 'number,title,body,url,labels',
      '--limit', '50',
    ]);
    return JSON.parse(body || '[]');
  } catch (err) {
    log(`${repoName}: issue list failed (${err.message.slice(0, 120)})`);
    return [];
  }
}

// Finding IDs look like `F-abc12345` (8 hex chars). Extract from issue body.
function extractFindingIds(issueBody) {
  const re = /\bF-[0-9a-f]{8}\b/g;
  return Array.from(new Set((issueBody || '').match(re) || []));
}

function loadLatestFindings(repoName) {
  const p = path.join(REPORTS_DIR, repoName, 'latest.json');
  if (!fs.existsSync(p)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Config editors — one per scanner type
// ---------------------------------------------------------------------------
function addGitleaksAllowlist(configPath, file, ruleId, sourceIssue) {
  const contents = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const tag = `# allowlist: ${file} (${ruleId}) — from issue ${sourceIssue}`;
  if (contents.includes(tag)) return { changed: false, reason: 'already allowlisted' };

  // Append a paths entry. Gitleaks TOML allowlist supports `paths = [ "...regex..." ]`
  // at the top level. Escape `.` and `/` for regex safety.
  const escaped = file.replace(/[.+^$()|[\]{}\\]/g, '\\$&');
  const block =
    `\n${tag}\n` +
    `[[allowlists]]\n` +
    `description = "false-positive allowlist (auto-generated)"\n` +
    `paths = ["^${escaped}$"]\n`;

  fs.appendFileSync(configPath, block);
  return { changed: true };
}

function addPhpcsExclude(configPath, file, ruleId, sourceIssue) {
  if (!fs.existsSync(configPath)) return { changed: false, reason: 'config missing' };
  const contents = fs.readFileSync(configPath, 'utf8');
  const tag = `<!-- allowlist: ${file} (${ruleId}) — from issue ${sourceIssue} -->`;
  if (contents.includes(tag)) return { changed: false, reason: 'already allowlisted' };

  const block = `  ${tag}\n  <exclude-pattern>${file}</exclude-pattern>\n`;
  // Insert before the closing </ruleset> tag.
  if (!contents.includes('</ruleset>')) {
    return { changed: false, reason: '</ruleset> tag not found' };
  }
  const updated = contents.replace('</ruleset>', `${block}</ruleset>`);
  fs.writeFileSync(configPath, updated);
  return { changed: true };
}

function addSemgrepExclude(configPath, file, ruleId, sourceIssue) {
  if (!fs.existsSync(configPath)) return { changed: false, reason: 'config missing' };
  const contents = fs.readFileSync(configPath, 'utf8');
  const tag = `# allowlist: ${file} (${ruleId}) — from issue ${sourceIssue}`;
  if (contents.includes(tag)) return { changed: false, reason: 'already allowlisted' };

  // Append a paths.exclude entry. If the file has no paths: block,
  // add one. Simple append — semgrep config is YAML but we avoid
  // parsing (no dep); tag+newline is safe to append.
  const block = `\n${tag}\npaths:\n  exclude:\n    - "${file}"\n`;
  fs.appendFileSync(configPath, block);
  return { changed: true };
}

const SCANNER_HANDLERS = {
  gitleaks: (file, rule, issue) => addGitleaksAllowlist('.gitleaks.toml', file, rule, issue),
  phpcs:    (file, rule, issue) => addPhpcsExclude('configs/phpcs-ruleset.xml', file, rule, issue),
  semgrep:  (file, rule, issue) => addSemgrepExclude('configs/semgrep.yml', file, rule, issue),
};

// ---------------------------------------------------------------------------
// Idempotency + push + PR
// ---------------------------------------------------------------------------
function existingOpenPr() {
  try {
    const body = gh([
      'pr', 'list',
      '--repo', `${ORG}/repo-health`,
      '--state', 'open',
      '--search', `head:${BRANCH_PATTERN} in:title [autofix-allowlist]`,
      '--json', 'number,headRefName,url',
    ]);
    const arr = JSON.parse(body || '[]');
    return arr.find(pr => String(pr.headRefName || '').startsWith(BRANCH_PATTERN)) || null;
  } catch {
    return null;
  }
}

function existingBranch() {
  try {
    gh(['api', `/repos/${ORG}/repo-health/branches/${encodeURIComponent(BRANCH)}`]);
    return true;
  } catch {
    return false;
  }
}

// Ensure a label exists on repo-health. gh pr create --label aborts
// when the label is missing. --force makes the helper idempotent.
function ensureLabel(name, color, description) {
  try {
    execFileSync('gh', [
      'label', 'create', name,
      '--repo', `${ORG}/repo-health`,
      '--color', color,
      '--description', description,
      '--force',
    ], {
      encoding: 'utf8',
      env: { ...process.env, GH_TOKEN: TOKEN, GITHUB_TOKEN: TOKEN },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (err) {
    log(`label '${name}' ensure failed — ${err.message.slice(0, 120)}`);
  }
}

function commitAndPushSelf(appliedCount) {
  const msg =
    `chore(autofix-allowlist): batch config updates ${MONTH}\n\n` +
    `Auto-generated from ${appliedCount} false-positive label(s) across\n` +
    `target repos' health-check issues.\n\n` +
    `Review before merging — these entries silence findings permanently.`;
  git(['config', 'user.name',  'kilowott-repo-health-bot[bot]']);
  git(['config', 'user.email', 'kilowott-repo-health-bot[bot]@users.noreply.github.com']);
  git(['checkout', '-b', BRANCH]);
  git(['add', '-A']);
  git(['commit', '-m', msg]);
  git(['push', 'origin', BRANCH]);
}

function openSelfPr(applied) {
  const scanners = Array.from(new Set(applied.map(a => a.scanner)));
  const repos = Array.from(new Set(applied.map(a => a.repo)));
  const body =
`Batch allowlist updates from false-positive-labeled health-check issues.

## Applied entries
${applied.map(a => `- \`${a.scanner}\` · \`${a.file}\` · ${a.rule} (from ${ORG}/${a.repo}#${a.issueNumber})`).join('\n')}

## Scanners touched
${scanners.map(s => `- ${s}`).join('\n')}

## Repos sourced from
${repos.map(r => `- \`${r}\``).join('\n')}

## Review
Each entry silences a finding permanently on future scans. If any
allowlist entry looks wrong, remove it from this PR before merging —
the next scan will re-surface the finding and the label can be
cleared on the source issue.

## Note
\`npm-audit\` and \`osv\` findings are NOT auto-allowlisted — dependency
CVEs require human triage (upgrade, audit-resolve, or suppress with
context).

Run: ${process.env.RUN_URL || 'local run'}
`;
  return gh([
    'pr', 'create',
    '--repo', `${ORG}/repo-health`,
    '--base', 'main',
    '--head', BRANCH,
    '--title', `[autofix-allowlist] ${applied.length} entries · ${MONTH}`,
    '--body', body,
    '--label', 'autofix',
    '--label', 'allowlist',
  ]).trim();
}

function commentOnSourceIssue(repo, issueNumber, prUrl) {
  try {
    gh([
      'issue', 'comment', String(issueNumber),
      '--repo', `${ORG}/${repo}`,
      '--body', `Allowlist PR opened: ${prUrl}\n\nWhen merged, the finding(s) referenced here will no longer be reported on future scans.`,
    ]);
  } catch (err) {
    log(`${repo}#${issueNumber}: comment failed (${err.message.slice(0, 120)})`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(function main() {
  log(`month: ${MONTH}  dry_run: ${DRY_RUN}`);

  // Short-circuit: if a PR already exists or the branch exists on
  // origin, don't do anything this month.
  const existing = existingOpenPr();
  if (existing) {
    log(`open allowlist PR already exists: #${existing.number} — skipping`);
    process.exit(0);
  }
  if (existingBranch()) {
    log(`branch ${BRANCH} already exists on remote — skipping`);
    process.exit(0);
  }

  const targets = loadTargets();
  const applied = [];
  const skipped = [];

  for (const target of targets) {
    const repoName = target.name;
    const issues = findFalsePositiveIssues(repoName);
    if (issues.length === 0) continue;

    log(`${repoName}: ${issues.length} false-positive issue(s) found`);
    const findings = loadLatestFindings(repoName);
    // IDs are derived via the shared fingerprint module — same algorithm
    // that file-issues.js used to write the F-xxxxxxxx into the issue body
    // we're now parsing. Mismatch would mean no finding ever resolves.
    const findingById = new Map(findings.map(f => [fingerprint(f), f]));

    for (const issue of issues) {
      const ids = extractFindingIds(issue.body);
      if (ids.length === 0) {
        skipped.push({ repo: repoName, issue: issue.number, reason: 'no F- IDs in body' });
        continue;
      }
      for (const id of ids) {
        const finding = findingById.get(id);
        if (!finding) {
          skipped.push({ repo: repoName, issue: issue.number, id, reason: 'finding not in latest.json' });
          continue;
        }
        const scanner = String(finding.Source || '').toLowerCase();
        const handler = SCANNER_HANDLERS[scanner];
        if (!handler) {
          skipped.push({ repo: repoName, issue: issue.number, id, scanner, reason: 'scanner not auto-allowlistable' });
          continue;
        }
        const res = handler(finding.File || '', finding.RuleID || '', `${ORG}/${repoName}#${issue.number}`);
        if (res.changed) {
          applied.push({
            repo: repoName,
            issueNumber: issue.number,
            issueUrl: issue.url,
            id,
            scanner,
            file: finding.File,
            rule: finding.RuleID,
          });
          log(`  applied: ${id} (${scanner}) → ${finding.File}`);
        } else {
          skipped.push({ repo: repoName, issue: issue.number, id, scanner, reason: res.reason });
        }
      }
    }
  }

  log(`applied: ${applied.length}   skipped: ${skipped.length}`);
  if (skipped.length > 0) log('skipped: ' + JSON.stringify(skipped));

  if (applied.length === 0) {
    log('no applicable allowlist edits — nothing to PR.');
    process.exit(0);
  }

  if (DRY_RUN) {
    log(`DRY RUN — would push branch ${BRANCH} and open PR with ${applied.length} entries`);
    // Revert any file edits we made so the working tree doesn't leak into the next step.
    try { git(['checkout', '--', '.']); } catch { /* best effort */ }
    process.exit(0);
  }

  commitAndPushSelf(applied.length);
  // Ensure PR labels exist on repo-health before gh pr create.
  ensureLabel('autofix',   '84CC16', 'Auto-generated fix PR from repo-health');
  ensureLabel('allowlist', '65A30D', 'False-positive allowlist update');
  const prUrl = openSelfPr(applied);
  log(`PR opened: ${prUrl}`);

  // Back-link on each source issue so triage-ers can follow the fix.
  for (const entry of applied) {
    commentOnSourceIssue(entry.repo, entry.issueNumber, prUrl);
  }

  process.exit(0);
})();
