#!/usr/bin/env node
/**
 * Phase 3c: slack-notify
 *
 * Runs after file-issues completes. Reads the same reports/ tree the filer
 * already processed, identifies critical findings, and posts a Slack alert
 * if any exist.
 *
 * Posts:
 *   - Summary card: N critical across M repos
 *   - Per-repo list with link to health-check issue
 *
 * Doesn't double-notify — tracks last notification state in a small state file
 * so unchanged critical findings don't re-alert every scan.
 *
 * Env:
 *   CRITICAL_ALERT_WEBHOOK  Slack incoming webhook URL
 *   TARGETS_JSON            path to discovered-targets.json
 *   REPORTS_DIR             path to reports/
 *   ORG                     org name for link construction
 *   RUN_URL                 workflow run URL for deep-linking
 *
 * Exits 0 regardless of notification outcome — don't fail the scan if Slack
 * is unreachable.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WEBHOOK = process.env.CRITICAL_ALERT_WEBHOOK;
const TARGETS_JSON = process.env.TARGETS_JSON || 'discovered-targets.json';
const REPORTS_DIR = process.env.REPORTS_DIR || 'reports';
const ORG = process.env.ORG || 'Kilowott-labs';
const RUN_URL = process.env.RUN_URL || '';
const STATE_FILE = '.slack-notify-state.json';

if (!WEBHOOK) {
  console.log('CRITICAL_ALERT_WEBHOOK not set — Slack notifications disabled.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Load targets + discover critical findings
// ---------------------------------------------------------------------------
function loadTargets() {
  if (!fs.existsSync(TARGETS_JSON)) return [];
  const raw = JSON.parse(fs.readFileSync(TARGETS_JSON, 'utf8'));
  return raw.repos || [];
}

function loadFindings(repoName) {
  const p = path.join(REPORTS_DIR, repoName, 'latest.json');
  if (!fs.existsSync(p)) return [];
  try {
    const body = fs.readFileSync(p, 'utf8').trim();
    if (!body || body === 'null') return [];
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Matches the severity logic from file-issues.js. Critical = either scanner
// said so, OR it's a secret finding on a critical-priority repo.
function isCritical(finding, repoPriority) {
  const sev = (finding.Severity || finding.severity || '').toLowerCase();
  if (sev === 'critical') return true;
  const source = (finding.Source || finding.source || '').toLowerCase();
  if (repoPriority === 'critical' && (source === 'gitleaks' || source === '')) return true;
  return false;
}

// Stable hash of the critical-findings state for dedup
function stateHash(perRepoCriticals) {
  const normalized = Object.keys(perRepoCriticals).sort().map(repo => {
    const ids = perRepoCriticals[repo].map(f => `${f.Source || 'gitleaks'}:${f.RuleID || f.ruleID}:${f.File || f.file}:${f.StartLine || f.startLine}`).sort();
    return `${repo}=${ids.join(',')}`;
  }).join('|');
  return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// Slack message builder
// ---------------------------------------------------------------------------
function buildSlackMessage(perRepoCriticals, totalCount) {
  const repoCount = Object.keys(perRepoCriticals).length;
  const header = `🔴 *${totalCount} critical finding${totalCount === 1 ? '' : 's'}* across *${repoCount} repo${repoCount === 1 ? '' : 's'}*`;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Repo health — critical alerts' },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: header },
    },
    { type: 'divider' },
  ];

  // One section per affected repo
  for (const [repo, findings] of Object.entries(perRepoCriticals)) {
    const issueUrl = `https://github.com/${ORG}/${repo}/issues?q=is:issue+is:open+label:health-check`;
    const bySource = {};
    for (const f of findings) {
      const src = f.Source || f.source || 'gitleaks';
      bySource[src] = (bySource[src] || 0) + 1;
    }
    const sourceBreak = Object.entries(bySource).map(([s, n]) => `${s}: ${n}`).join(', ');
    const exampleLine = findings[0]
      ? `_Example:_ \`${findings[0].RuleID || findings[0].ruleID || 'unknown'}\` in \`${findings[0].File || findings[0].file || '?'}\``
      : '';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${issueUrl}|${repo}>* — ${findings.length} critical (${sourceBreak})\n${exampleLine}`,
      },
    });
  }

  if (RUN_URL) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `<${RUN_URL}|View scan run> · <https://github.com/${ORG}/repo-health|Open dashboard>` },
      ],
    });
  }

  return {
    text: header.replace(/\*/g, ''), // Fallback for notifications/clients that don't render blocks
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  const targets = loadTargets();
  const perRepoCriticals = {};
  let totalCount = 0;

  for (const repo of targets) {
    const findings = loadFindings(repo.name);
    const criticals = findings.filter(f => isCritical(f, repo.priority));
    if (criticals.length > 0) {
      perRepoCriticals[repo.name] = criticals;
      totalCount += criticals.length;
    }
  }

  if (totalCount === 0) {
    console.log('No critical findings this run — skipping Slack.');
    // Also clear state so next critical finding re-alerts properly
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    return;
  }

  // Dedup: compare current state to last notification
  const currentHash = stateHash(perRepoCriticals);
  let lastHash = '';
  if (fs.existsSync(STATE_FILE)) {
    try {
      lastHash = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).hash || '';
    } catch { /* ignore */ }
  }

  if (currentHash === lastHash) {
    console.log(`Critical findings unchanged since last notification (hash ${currentHash}) — skipping Slack to avoid spam.`);
    return;
  }

  const message = buildSlackMessage(perRepoCriticals, totalCount);

  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      console.error(`Slack webhook returned ${res.status}: ${await res.text()}`);
      process.exit(0); // don't fail the workflow
    }
    console.log(`Slack alert posted for ${totalCount} critical findings across ${Object.keys(perRepoCriticals).length} repos.`);

    // Persist state so we don't spam next time
    fs.writeFileSync(STATE_FILE, JSON.stringify({ hash: currentHash, at: new Date().toISOString() }, null, 2));
  } catch (e) {
    console.error(`Slack post failed: ${e.message}`);
    process.exit(0);
  }
})();
