#!/usr/bin/env node
/**
 * Phase 5c flow A — monthly phpcbf auto-fix PRs.
 *
 * For each target repo marked `autofix.phpcs: true` in
 * discovered-targets.json:
 *   1. Skip if an open autofix PR already exists (prevents stacking).
 *   2. Skip if the same-month branch already exists on remote.
 *   3. Clone the target (shallow, depth 10 — enough for phpcbf).
 *   4. Run phpcbf with the WPCS ruleset.
 *   5. If diff non-empty: branch, commit, push, open PR, label.
 *
 * Idempotency: branch name is `repo-health/autofix-phpcbf-<YYYY-MM>`
 * so a single re-run inside the same month is a no-op.
 *
 * Environment:
 *   GH_TOKEN            App token (has ruleset bypass + repo write)
 *   DRY_RUN             "true" to log intent without pushing / opening PRs
 *   TARGETS_JSON        path to discovered-targets.json
 *   PHPCBF_STANDARD     phpcs standard to pass to phpcbf (default WordPress)
 *
 * Exit code: 0 regardless of per-repo outcomes. A single bad repo
 * shouldn't fail the whole monthly run.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const TARGETS_JSON = process.env.TARGETS_JSON || 'discovered-targets.json';
const STANDARD = process.env.PHPCBF_STANDARD || 'WordPress';
const ORG = process.env.ORG || 'Kilowott-labs';

if (!TOKEN) {
  console.error('GH_TOKEN / GITHUB_TOKEN required (App token preferred).');
  process.exit(1);
}
if (!fs.existsSync(TARGETS_JSON)) {
  console.error(`Targets file ${TARGETS_JSON} not found — run discover.js first.`);
  process.exit(1);
}

const MONTH = new Date().toISOString().slice(0, 7); // YYYY-MM
const BRANCH = `repo-health/autofix-phpcbf-${MONTH}`;
const BRANCH_PATTERN = 'repo-health/autofix-phpcbf-';

function log(line) {
  console.log(`[autofix-phpcbf] ${line}`);
}

// Array-form runners — no shell interpretation of dynamic strings.
function git(args, opts = {}) {
  return execFileSync('git', args, {
    stdio: 'inherit', encoding: 'utf8', ...opts,
  });
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: TOKEN, GITHUB_TOKEN: TOKEN },
  });
}

// Authenticated git — injects the token via per-command `http.extraheader`
// rather than embedding it in the remote URL. This avoids writing the
// token to .git/config, which would persist on disk after the run and
// leak if the workspace is snapshotted.
//
// Git smart-HTTP expects Basic auth (not Bearer) — matches the pattern
// actions/checkout@v4 installs. Token still appears in argv visible to
// same-uid processes on the runner, which is an accepted exposure on
// ephemeral runners.
const TOKEN_BASIC = Buffer.from(`x-access-token:${TOKEN}`).toString('base64');
function gitAuth(args, opts = {}) {
  return git(
    ['-c', `http.extraheader=Authorization: Basic ${TOKEN_BASIC}`, ...args],
    opts,
  );
}

// ---------------------------------------------------------------------------
// Eligibility — only process repos with autofix.phpcs === true
// ---------------------------------------------------------------------------
function loadEligibleRepos() {
  const raw = JSON.parse(fs.readFileSync(TARGETS_JSON, 'utf8'));
  const out = [];
  for (const repo of (raw.repos || [])) {
    const eligible = repo.autofix && repo.autofix.phpcs === true;
    if (eligible) out.push(repo);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Idempotency — skip if a matching open PR already exists
// ---------------------------------------------------------------------------
function existingAutofixPR(repo) {
  try {
    const body = gh([
      'pr', 'list',
      '--repo', `${ORG}/${repo}`,
      '--state', 'open',
      '--search', `head:${BRANCH_PATTERN} in:title [autofix]`,
      '--json', 'number,title,headRefName,url',
    ]);
    const arr = JSON.parse(body || '[]');
    // gh's --search doesn't always match exactly — filter by head prefix locally.
    return arr.find(pr => String(pr.headRefName || '').startsWith(BRANCH_PATTERN)) || null;
  } catch (err) {
    log(`${repo}: pr list failed (${err.message.slice(0, 120)}) — assuming none open`);
    return null;
  }
}

function existingAutofixBranch(repo) {
  try {
    const body = gh([
      'api', `/repos/${ORG}/${repo}/branches/${encodeURIComponent(BRANCH)}`,
    ]);
    return Boolean(body && body.trim());
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-repo workflow
// ---------------------------------------------------------------------------
function cloneTarget(repo, workDir) {
  // Plain https URL — no token in the URL means no token persists in
  // the cloned .git/config. Auth rides in via gitAuth's extraheader.
  gitAuth(['clone', '--depth', '10', `https://github.com/${ORG}/${repo}.git`, workDir]);
}

function runPhpcbf(workDir) {
  // phpcbf exits non-zero when it made changes — that's expected.
  // Don't treat exit code as fatal.
  try {
    execFileSync('phpcbf', ['--standard=' + STANDARD, '--report=summary', '.'], {
      cwd: workDir, stdio: 'inherit',
    });
  } catch {
    /* non-zero = fixes made, fall through */
  }
}

function hasDiff(workDir) {
  const out = execFileSync('git', ['status', '--porcelain'], {
    cwd: workDir, encoding: 'utf8',
  });
  return out.trim().length > 0;
}

function countFixedFiles(workDir) {
  const out = execFileSync('git', ['status', '--porcelain'], {
    cwd: workDir, encoding: 'utf8',
  });
  return out.trim().split('\n').filter(Boolean).length;
}

function commitAndPush(repo, workDir) {
  const commitMessage =
    `chore(autofix): phpcbf mechanical style fixes ${MONTH}\n\n` +
    `Auto-generated by Kilowott repo-health. Mechanical PHPCS fixes\n` +
    `(spacing, indentation, array syntax, docblocks) applied via phpcbf\n` +
    `--standard=${STANDARD}.\n\n` +
    `Review the diff — phpcbf is conservative but human review is\n` +
    `important before merging into a client codebase.`;

  const opts = { cwd: workDir };
  git(['config', 'user.name',  'kilowott-repo-health-bot[bot]'],                           opts);
  git(['config', 'user.email', 'kilowott-repo-health-bot[bot]@users.noreply.github.com'],  opts);
  git(['checkout', '-b', BRANCH],                                                          opts);
  git(['add', '-A'],                                                                       opts);
  git(['commit', '-m', commitMessage],                                                     opts);
  gitAuth(['push', 'origin', BRANCH],                                                      opts);
}

function openPullRequest(repo, fixedFileCount) {
  const title = `[autofix] PHPCS phpcbf ${MONTH}`;
  const body =
`Mechanical PHPCS fixes from repo-health's weekly scan pipeline.

## What changed
phpcbf \`--standard=${STANDARD}\` ran over .php files in this repo.
**${fixedFileCount} file${fixedFileCount === 1 ? '' : 's'} changed.**

## Scope
Only mechanical fixes: whitespace, indentation, array syntax,
docblock formatting. No semantic changes.

## Review guidance
- Check PHP files for any functional change — there should be none.
- Verify test suite (if any) still passes.
- If anything looks wrong, close without merging — next month's run
  will re-attempt with the current code.

## Acknowledgment
This PR was auto-generated by \`Kilowott Repo Health Bot\`.
Run: ${process.env.RUN_URL || 'local run'}
`;
  const url = gh([
    'pr', 'create',
    '--repo', `${ORG}/${repo}`,
    '--base', 'main',
    '--head', BRANCH,
    '--title', title,
    '--body', body,
    '--label', 'autofix',
    '--label', 'phpcbf',
  ]).trim();
  return url;
}

function labelPr(repo, number, labels) {
  try {
    gh([
      'pr', 'edit', String(number),
      '--repo', `${ORG}/${repo}`,
      ...labels.flatMap(l => ['--add-label', l]),
    ]);
  } catch (err) {
    log(`${repo}: label add failed (${err.message.slice(0, 120)})`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(function main() {
  const repos = loadEligibleRepos();
  log(`eligible repos: ${repos.length} (${repos.map(r => r.name).join(', ') || 'none'})`);
  log(`branch name for this month: ${BRANCH}`);
  log(`dry_run: ${DRY_RUN}`);

  const summary = { skipped: [], unchanged: [], opened: [], errored: [] };

  for (const repo of repos) {
    const name = repo.name;
    log(`--- ${name} ---`);

    // Idempotency: open PR
    const openPr = existingAutofixPR(name);
    if (openPr) {
      log(`${name}: open autofix PR exists (#${openPr.number}) — skipping`);
      summary.skipped.push({ name, reason: `open PR #${openPr.number}` });
      continue;
    }

    // Idempotency: same-month branch
    if (existingAutofixBranch(name)) {
      log(`${name}: branch ${BRANCH} already exists on remote — skipping`);
      summary.skipped.push({ name, reason: `branch exists` });
      continue;
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `autofix-${name}-`));
    try {
      log(`${name}: cloning → ${workDir}`);
      cloneTarget(name, workDir);

      log(`${name}: running phpcbf --standard=${STANDARD}`);
      runPhpcbf(workDir);

      if (!hasDiff(workDir)) {
        log(`${name}: no phpcbf changes`);
        summary.unchanged.push(name);
        continue;
      }

      const fixedCount = countFixedFiles(workDir);
      log(`${name}: ${fixedCount} file(s) changed`);

      if (DRY_RUN) {
        log(`${name}: DRY RUN — would push branch ${BRANCH} and open PR with ${fixedCount} fixes`);
        summary.opened.push({ name, dryRun: true, fixedCount });
        continue;
      }

      commitAndPush(name, workDir);
      const prUrl = openPullRequest(name, fixedCount);
      log(`${name}: PR opened → ${prUrl}`);
      summary.opened.push({ name, url: prUrl, fixedCount });
    } catch (err) {
      log(`${name}: errored — ${err.message.slice(0, 200)}`);
      summary.errored.push({ name, error: err.message.slice(0, 200) });
    } finally {
      // Clean up the temp clone to keep the runner tidy.
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }

  log('--- summary ---');
  log(JSON.stringify({
    eligible: repos.length,
    opened: summary.opened.length,
    unchanged: summary.unchanged.length,
    skipped: summary.skipped.length,
    errored: summary.errored.length,
    month: MONTH,
    dryRun: DRY_RUN,
  }));
  if (summary.opened.length > 0)   log('opened: '   + JSON.stringify(summary.opened));
  if (summary.unchanged.length > 0) log('unchanged: ' + JSON.stringify(summary.unchanged));
  if (summary.skipped.length > 0)  log('skipped: '  + JSON.stringify(summary.skipped));
  if (summary.errored.length > 0)  log('errored: '  + JSON.stringify(summary.errored));

  process.exit(0);
})();
