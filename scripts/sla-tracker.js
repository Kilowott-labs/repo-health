#!/usr/bin/env node
/**
 * Phase 3c: sla-tracker
 *
 * Finds health-check issues open >SLA_THRESHOLD_DAYS and updates the current
 * weekly digest issue with an "overdue" section. Also applies an `overdue`
 * label to individual issues that cross the threshold.
 *
 * Runs after file-issues + state-transition-commenter.
 *
 * Env:
 *   GITHUB_TOKEN          PAT with Issues: Write
 *   TARGETS_JSON          path to discovered-targets.json
 *   ORG                   org name
 *   SLA_THRESHOLD_DAYS    default 30
 */

const fs = require('fs');

const TOKEN = process.env.GITHUB_TOKEN;
const ORG = process.env.ORG || 'Kilowott-labs';
const TARGETS_JSON = process.env.TARGETS_JSON || 'discovered-targets.json';
const THRESHOLD_DAYS = parseInt(process.env.SLA_THRESHOLD_DAYS || '30', 10);
const ISSUE_LABEL = 'health-check';
const DIGEST_LABEL = 'health-check-digest';
const OVERDUE_LABEL = 'overdue';

if (!TOKEN) {
  console.log('GITHUB_TOKEN missing — skipping SLA tracker.');
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
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

function daysSince(isoDate) {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24));
}

async function ensureOverdueLabel(owner, repo) {
  try {
    await gh(`/repos/${owner}/${repo}/labels`, {
      method: 'POST',
      body: JSON.stringify({
        name: OVERDUE_LABEL,
        color: 'd73a4a',
        description: `Open >${THRESHOLD_DAYS} days — SLA breach`,
      }),
    });
  } catch (e) {
    if (!/\b422\b/.test(e.message)) throw e;
  }
}

(async () => {
  const targets = JSON.parse(fs.readFileSync(TARGETS_JSON, 'utf8')).repos || [];
  const overdueIssues = [];

  // Find open health-check issues past threshold
  for (const repo of targets) {
    try {
      const params = new URLSearchParams({
        labels: ISSUE_LABEL,
        state: 'open',
        per_page: '20',
      });
      const issues = await gh(`/repos/${ORG}/${repo.name}/issues?${params}`);
      for (const issue of issues) {
        if (issue.pull_request) continue;
        const age = daysSince(issue.created_at);
        if (age > THRESHOLD_DAYS) {
          overdueIssues.push({
            repo: repo.name,
            priority: repo.priority,
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
            age,
            hasOverdueLabel: (issue.labels || []).some(l => (l.name || l) === OVERDUE_LABEL),
          });

          // Apply overdue label if not present
          if (!(issue.labels || []).some(l => (l.name || l) === OVERDUE_LABEL)) {
            await ensureOverdueLabel(ORG, repo.name);
            await gh(`/repos/${ORG}/${repo.name}/issues/${issue.number}/labels`, {
              method: 'POST',
              body: JSON.stringify({ labels: [OVERDUE_LABEL] }),
            });
            console.log(`[${repo.name}] applied overdue label to #${issue.number} (${age} days old)`);
          }
        }
      }
    } catch (e) {
      console.error(`[${repo.name}] SLA check failed: ${e.message}`);
    }
  }

  console.log(`SLA scan: ${overdueIssues.length} issues overdue (>${THRESHOLD_DAYS} days)`);

  if (overdueIssues.length === 0) return;

  // Update the current open digest issue with an overdue section
  try {
    const params = new URLSearchParams({
      labels: DIGEST_LABEL,
      state: 'open',
      per_page: '5',
    });
    const digests = await gh(`/repos/${ORG}/repo-health/issues?${params}`);
    const currentDigest = digests[0]; // most recent open
    if (!currentDigest) {
      console.log('No open digest found — overdue info logged but not appended.');
      return;
    }

    // Sort by age descending
    overdueIssues.sort((a, b) => b.age - a.age);

    const overdueSection = [
      '',
      '---',
      '',
      `## ⏰ Overdue (${overdueIssues.length}) — open > ${THRESHOLD_DAYS} days`,
      '',
      '| Repo | Priority | Age | Issue |',
      '|---|---|---|---|',
    ];
    for (const o of overdueIssues) {
      overdueSection.push(`| \`${o.repo}\` | ${o.priority} | ${o.age}d | [#${o.number}](${o.url}) |`);
    }
    overdueSection.push('');
    overdueSection.push(`_SLA threshold: ${THRESHOLD_DAYS} days. Issues past threshold get the \`overdue\` label automatically._`);

    // Append to existing body (or replace prior overdue section if any)
    let body = currentDigest.body || '';
    const marker = '## ⏰ Overdue (';
    const idx = body.indexOf(marker);
    if (idx >= 0) {
      // Strip the old overdue section (everything from the marker to end)
      const before = body.slice(0, idx).replace(/\n+---\s*\n*$/, '');
      body = before + overdueSection.join('\n');
    } else {
      body = body + overdueSection.join('\n');
    }

    await gh(`/repos/${ORG}/repo-health/issues/${currentDigest.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
    console.log(`Updated digest #${currentDigest.number} with overdue section`);
  } catch (e) {
    console.error(`Digest update failed: ${e.message}`);
  }
})();
