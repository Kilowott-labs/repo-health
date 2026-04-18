#!/usr/bin/env node
/**
 * Phase 3b — auto-discovery
 *
 * Queries the org's repos from the GitHub API, applies default rules, merges
 * with targets.yml overrides, and emits the final target list as JSON for
 * downstream jobs (scan matrix, file-issues).
 *
 * Design: keep the logic boring and predictable so the team can always answer
 * "why was repo X scanned/skipped?" by reading the rules, not debugging.
 *
 * Output: writes discovered-targets.json with the same shape the existing
 * pipeline already expects (repos array with name/priority/stack/private).
 *
 * Env:
 *   GITHUB_TOKEN   PAT with Metadata: Read on all org repos
 *   ORG            e.g. "Kilowott-labs"
 *   OVERRIDES      path to targets.yml (already converted to JSON by yq)
 *   OUTPUT         path to write the final target JSON
 */

const fs = require('fs');

const TOKEN = process.env.GITHUB_TOKEN;
const ORG = process.env.ORG || 'Kilowott-labs';
const OVERRIDES_JSON = process.env.OVERRIDES || 'targets.json';
const OUTPUT = process.env.OUTPUT || 'discovered-targets.json';

if (!TOKEN) {
  console.error('GITHUB_TOKEN is required');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
const SKIP_NAME_PATTERNS = [/scratch/i, /\btest\b/i, /\bdemo\b/i];
const CRITICAL_NAME_PATTERNS = [/security/i, /secret/i, /auth/i];

function shouldSkip(repo) {
  if (repo.archived) return { skip: true, reason: 'archived' };
  if (repo.fork) return { skip: true, reason: 'fork' };
  if (repo.disabled) return { skip: true, reason: 'disabled' };
  if (repo.size === 0) return { skip: true, reason: 'empty' };
  for (const pat of SKIP_NAME_PATTERNS) {
    if (pat.test(repo.name)) return { skip: true, reason: `name matches /${pat.source}/` };
  }
  return { skip: false };
}

function detectPriority(repo) {
  for (const pat of CRITICAL_NAME_PATTERNS) {
    if (pat.test(repo.name)) return 'critical';
  }
  if (repo.private && /^kw-/i.test(repo.name)) return 'high';
  return 'medium';
}

function detectStack(repo) {
  // Primary language from the API is our first signal. Deeper stack detection
  // (e.g. "is this a WP plugin vs plain PHP?") happens during the clone step
  // in Phase 2 when we have access to the filesystem.
  const lang = (repo.language || '').toLowerCase();
  if (lang === 'php') return 'php';
  if (lang === 'typescript' || lang === 'javascript') return 'node';
  if (lang === 'scss' || lang === 'css' || lang === 'html') return 'frontend';
  if (lang === 'powershell') return 'powershell';
  return lang || 'unknown';
}

// ---------------------------------------------------------------------------
// GitHub API (paginated)
// ---------------------------------------------------------------------------
async function gh(pathname) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kilowott-repo-health-discovery',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} on ${pathname}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function listOrgRepos(org) {
  const all = [];
  let page = 1;
  while (true) {
    const batch = await gh(`/orgs/${org}/repos?per_page=100&type=all&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
    if (page > 20) break; // safety cap at 2000 repos
  }
  return all;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  // Load overrides if present
  let overrides = { skip: [], overrides: {} };
  if (fs.existsSync(OVERRIDES_JSON)) {
    try {
      const raw = JSON.parse(fs.readFileSync(OVERRIDES_JSON, 'utf8'));
      overrides = { skip: raw.skip || [], overrides: raw.overrides || {} };
    } catch (e) {
      console.error(`Failed to parse ${OVERRIDES_JSON}: ${e.message}`);
      process.exit(1);
    }
  }

  const skipSet = new Set(overrides.skip);

  console.log(`Discovering repos in ${ORG}...`);
  const apiRepos = await listOrgRepos(ORG);
  console.log(`API returned ${apiRepos.length} repos.`);

  const decisions = { scanned: [], skipped: [] };

  for (const repo of apiRepos) {
    // Manual skip via targets.yml wins over everything
    if (skipSet.has(repo.name)) {
      decisions.skipped.push({ name: repo.name, reason: 'manual skip in targets.yml' });
      continue;
    }

    // Auto-skip rules
    const skipCheck = shouldSkip(repo);
    if (skipCheck.skip) {
      decisions.skipped.push({ name: repo.name, reason: skipCheck.reason });
      continue;
    }

    // Build the entry using detection + overrides
    const ov = overrides.overrides[repo.name] || {};
    const autoPriority = detectPriority(repo);
    const autoStack = detectStack(repo);
    const entry = {
      name: repo.name,
      priority: ov.priority || autoPriority,
      stack: ov.stack || autoStack,
      private: repo.private,
      // Metadata for audit / debugging
      _source: {
        autoPriority,
        autoStack,
        overridden: Object.keys(ov).length > 0,
        criticalByName: CRITICAL_NAME_PATTERNS.some(p => p.test(repo.name)),
      },
    };
    decisions.scanned.push(entry);
  }

  // Emit final JSON in the shape the downstream jobs expect
  const output = {
    org: ORG,
    generatedAt: new Date().toISOString(),
    repos: decisions.scanned,
    skipped: decisions.skipped,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));

  // Human-readable summary to workflow log
  console.log('');
  console.log('Discovery summary:');
  console.log(`  Scanned: ${decisions.scanned.length}`);
  console.log(`  Skipped: ${decisions.skipped.length}`);
  console.log('');
  if (decisions.scanned.length > 0) {
    console.log('Scanned repos:');
    for (const r of decisions.scanned) {
      const vis = r.private ? 'private' : 'public';
      const note = r._source.overridden ? ' (overridden)'
        : r._source.criticalByName ? ' (critical by name match)' : '';
      console.log(`  + ${r.name} [${vis}, priority=${r.priority}, stack=${r.stack}]${note}`);
    }
  }
  if (decisions.skipped.length > 0) {
    console.log('');
    console.log('Skipped repos:');
    for (const s of decisions.skipped) {
      console.log(`  - ${s.name} (${s.reason})`);
    }
  }

  // Write a GitHub Actions summary if running in Actions
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [];
    lines.push('## Auto-discovery results');
    lines.push('');
    lines.push(`**Scanned:** ${decisions.scanned.length}  ·  **Skipped:** ${decisions.skipped.length}  ·  **Total in org:** ${apiRepos.length}`);
    lines.push('');
    lines.push('### Scanned');
    lines.push('');
    lines.push('| Repo | Visibility | Priority | Stack | Source |');
    lines.push('|---|---|---|---|---|');
    for (const r of decisions.scanned) {
      const vis = r.private ? '🔒 private' : '🌐 public';
      const source = r._source.overridden ? 'override'
        : r._source.criticalByName ? 'name match' : 'auto';
      lines.push(`| \`${r.name}\` | ${vis} | ${r.priority} | ${r.stack} | ${source} |`);
    }
    if (decisions.skipped.length > 0) {
      lines.push('');
      lines.push('### Skipped');
      lines.push('');
      lines.push('| Repo | Reason |');
      lines.push('|---|---|');
      for (const s of decisions.skipped) {
        lines.push(`| \`${s.name}\` | ${s.reason} |`);
      }
    }
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
})();
