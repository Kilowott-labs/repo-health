# Phase 3c: operational polish

## What's new

Four additions layered on top of the existing scanner + issue system:

| Feature | What it does |
|---|---|
| Slack alerts | Posts to Slack when critical findings appear (dedupes unchanged state) |
| State-transition audit comments | Auto-comments on health-check issues when finding count swings past threshold |
| SLA tracking | Flags issues open >30 days with `overdue` label; updates digest with overdue section |
| Dependabot | One-time setup script adds dependabot.yml to all eligible target repos |
| Branch protection on repo-health | Manual GitHub setting; documented below |

None of these change scanner behavior. They make the existing output more actionable.

## Required secret

Add a new repo-level secret to `Kilowott-labs/repo-health`:

- **Name**: `CRITICAL_ALERT_WEBHOOK`
- **Value**: Slack incoming webhook URL (starts `https://hooks.slack.com/services/...`)

If the secret is missing, Slack notifications are silently skipped — no failures.

## How the pieces fit together

```
weekly-scan.yml
  discover
  └─> scan (matrix)
  └─> aggregate
  └─> file-issues
         ├─ File / update per-repo health issues           (Phase 3)
         ├─ Post state-transition audit comments           (Phase 3c NEW)
         ├─ Commit updated history files                   (Phase 3c NEW)
         ├─ Track SLA breaches                             (Phase 3c NEW)
         └─ Notify Slack on critical findings              (Phase 3c NEW)
```

Each step runs regardless of prior step outcome (`if: always()`) so a failure in one doesn't break the others.

## State-transition audit comments

**What triggers a comment** (on the health-check issue in the affected repo):

- Finding count change >|5| (configurable via `THRESHOLD` env var)
- Repo transitions clean → flagged (any new finding where before was 0)
- Repo transitions flagged → clean (count goes to 0)

**What does NOT trigger**:

- Small delta (e.g. 100 findings → 103)
- First observation (no prior baseline to compare)

**Where state is stored**: `reports/<repo>/history.json` — last 26 entries (~6 months weekly). Committed back to `repo-health` on each scan.

**What a comment looks like**:

```
### 📊 Finding-count state change — 2026-04-27 03:15 UTC

📈 18 → 42 (Δ +24)

Findings increased by more than 5. Could be new commits with issues, a new scanner enabled, or a ruleset change.

**Change by scanner:**

| Scanner | Previous | Current | Δ |
|---|---|---|---|
| gitleaks | 0 | 0 | — |
| phpcs | 18 | 40 | +22 |
| semgrep | 0 | 2 | +2 |

Auto-posted by repo-health state tracker. Threshold: |Δ| > 5.
```

## SLA tracking

**Threshold**: 30 days (configurable via `SLA_THRESHOLD_DAYS` env var).

**What happens when an issue crosses threshold**:

1. The `overdue` label is auto-created in the target repo (first time only)
2. The label is applied to the health-check issue
3. The current weekly digest issue in `repo-health` gets an "Overdue" section appended

**Overdue section format in the digest**:

```
## ⏰ Overdue (3) — open > 30 days

| Repo | Priority | Age | Issue |
|---|---|---|---|
| kw-security-plugin | critical | 47d | #1 |
| nordic-fund-day | high | 35d | #3 |
| design-systems | medium | 31d | #5 |

SLA threshold: 30 days. Issues past threshold get the `overdue` label automatically.
```

The label and digest section naturally disappear once the issue closes (findings remediated) or is triaged (dismissal label applied → issue re-titled → age reset? no, `created_at` is fixed. Only full resolution clears it.)

## Slack notifications

**When Slack gets pinged**:

- One or more critical findings present in the current scan
- AND the critical state differs from last notification (prevents spam on unchanged state)

**When Slack does NOT get pinged**:

- No critical findings (even if medium/high are flagged)
- Critical findings are unchanged since last run (same rules + files + lines)
- `CRITICAL_ALERT_WEBHOOK` secret is missing

**What the Slack message looks like**:

```
Repo health — critical alerts
🔴 4 critical findings across 2 repos
─────────────────
kw-security-plugin — 1 critical (gitleaks: 1)
Example: stripe-secret-key in config/live.php

nordic-fund-day — 3 critical (gitleaks: 3)
Example: generic-api-key in figma-cache/full.json
─────────────────
View scan run · Open dashboard
```

**State dedup**: a hash of the critical findings is stored in `.slack-notify-state.json`. Same state = no new alert. State clears when no criticals remain, so re-alerting works correctly when issues resurface.

## Dependabot setup (one-time)

Run once from your working directory with `gh` authenticated:

```bash
bash scripts/setup-dependabot.sh          # adds dependabot.yml to every eligible target repo
bash scripts/setup-dependabot.sh --dry-run # shows what would be added without pushing
```

**What gets added to each target repo**:

- `.github/dependabot.yml` with ecosystems matching what's in the repo (composer, npm, always github-actions)
- Weekly Monday schedule, 5 open-PR limit per ecosystem

**Result**: Dependabot opens PRs in each target repo whenever a dependency needs updating. Our scanner keeps catching what Dependabot misses (secrets, code patterns). The two systems are complementary.

## Branch protection on repo-health (manual)

Go to https://github.com/Kilowott-labs/repo-health/settings/branches and add a protection rule for `main`:

- ☑ Require a pull request before merging
- ☑ Require approvals: 1
- ☑ Do not allow bypassing the above settings
- ☐ (leave force-push disabled by default)

Why manual: GitHub's API for branch protection rules varies across account types and is error-prone to automate. Two minutes in the UI is safer.

The bot's automated commits (reports, README, history) use `contents: write` scope from the Actions permissions, which bypasses the PR requirement because they're not coming through a PR. That's the correct behavior — we want the bot to commit freely but humans to need review.

## Troubleshooting

**"Post state-transition audit comments" step errors on first run**: Expected. No `history.json` exists yet, so every repo logs "first observation, no baseline to compare". No comments are posted. On the next scan, comparisons work.

**Slack webhook returns 404**: Webhook URL was revoked or mistyped. Regenerate in Slack app settings, update the secret.

**SLA tracker adds overdue labels but digest isn't updated**: Check there's actually a current open digest issue (`[health-check] Weekly digest — ...`). If the digest got manually closed, the tracker has nowhere to append.

**Dependabot PRs not appearing after setup**: First PR can take up to 24 hours after dependabot.yml is committed. Check the Security → Dependabot tab on the target repo for status.
