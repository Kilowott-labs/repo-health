# Phase 2: stack-aware scanners

## What's new

On top of Phase 1/3/3b (Gitleaks secret scanning + auto-issues + discovery),
Phase 2 adds four more scanners that run conditionally based on what's in
each repo:

| Scanner | Runs on | What it finds |
|---|---|---|
| `composer audit` | repos with `composer.json` | PHP dependency vulnerabilities |
| `npm audit` | repos with `package.json` | Node dependency vulnerabilities |
| `OSV-Scanner` | any repo with PHP or Node deps | Cross-ecosystem vulnerabilities (broader coverage) |
| `PHPCS + WPCS + WooCommerce sniffs + PHPCompatibilityWP` | WordPress repos | WP coding standards, security patterns, PHP compatibility |
| `Semgrep` | any code | Security patterns (OWASP Top 10, secrets, framework-specific) |

Gitleaks (Phase 1) still runs on every repo — unchanged.

## How the stack detection works

Each matrix job clones the target repo, runs `scripts/detect-stack.sh`, and
that script emits four signals:

- `has_composer` — `composer.json` present
- `has_npm` — `package.json` present
- `has_wp` — `wp-config.php`, WordPress composer deps, or a WP plugin/theme header found
- `has_any_code` — any PHP/JS/TS/Python/Go/Ruby files present

Scanners are gated on these outputs via `if:` conditions in the workflow.
A repo with no code (e.g. `Claude-skills`, pure markdown) only gets Gitleaks.

## Expected output volume

"Find everything" mode is noisy. Realistic expectations for your 11-repo portfolio:

| Repo | Expected findings | Why |
|---|---|---|
| `kw-security-plugin` | 50-150 | WP plugin, full PHPCS + WPCS, composer audit |
| `kw-wp-scaffold` | 30-80 | WP theme scaffold, PHPCS + Semgrep |
| `kw-wp-factory` | 5-15 | PowerShell (only Semgrep applies) |
| `WP-QA-Agent` | 20-60 | TypeScript, Semgrep + npm audit |
| `design-systems` | 10-40 | JavaScript, Semgrep + npm audit |
| `nordic-fund-day` | 10-30 | HTML, Semgrep on any embedded JS |
| `kw-figma-preflight` | 5-20 | HTML plugin |
| `creometric-website` | unknown | Already flagged 4 in Phase 1 |
| `Claude-skills` | 0-5 | Markdown only, Gitleaks only |
| `repo-health` | 0 | Allowlisted `reports/` |

**Total: 150-400 findings on first run.** That's a lot but expected —
this is the initial audit baseline. Most will be PHPCS style issues
(spacing, docblocks, naming), which triage quickly as bulk acknowledge.

## Severity mapping

Each scanner produces its own severity vocabulary. The normalizer maps
all to one of `critical` / `high` / `medium` / `low`:

| Scanner output | Our severity |
|---|---|
| composer/npm `critical` | critical |
| composer/npm `high` | high |
| composer/npm `moderate` / `medium` | medium |
| composer/npm `low` / `info` | low |
| OSV CVSS >= 9 | critical |
| OSV CVSS 7-9 | high |
| OSV CVSS 4-7 | medium |
| Semgrep `ERROR` | high |
| Semgrep `WARNING` | medium |
| Semgrep `INFO` | low |
| PHPCS `ERROR` | medium |
| PHPCS `WARNING` | low |
| Gitleaks (any) | high (escalated to critical on critical-priority repos) |

## Issue rendering at scale

When a severity section has >15 findings, the issue body switches to
**compact table mode** — grouped by scanner, collapsed in `<details>`,
capped at 100 entries per scanner to stay under GitHub's 65KB body limit.
Full findings always remain in `reports/<repo>/<scanner>.json` for any
that need inspection.

For small counts (critical + high typically), findings still render with
full detail blocks + explanation + fix steps.

## Workflow shape

```
discover (1 job)
  └─> scan matrix (N parallel jobs, N = discovered repo count)
         ├─ clone + detect stack
         ├─ Gitleaks (always)
         ├─ composer audit + OSV (if composer.json)
         ├─ npm audit + OSV (if package.json)
         ├─ PHPCS (if WordPress detected)
         ├─ Semgrep (if any code)
         └─ normalize each output → reports/<repo>/latest.json
  └─> aggregate (regenerates dashboard)
  └─> file-issues (creates/updates per-repo + digest issues)
```

## Runtime expectations

- Per-repo scan job: 3-15 minutes depending on scanners + repo size
- Total matrix runtime: 10-25 minutes (parallelism of 10)
- Actions minutes used per weekly scan: ~60-150 minutes

You have 2000 minutes/month on Free plan. At ~100 minutes/week = 400/month.
Well within budget.

## What changed vs Phase 3b

| File | Change |
|---|---|
| `.github/workflows/weekly-scan.yml` | Replaced — adds scanner steps + cron moved to `0 3 * * 1` |
| `scripts/file-issues.js` | Replaced — source-aware fingerprint + severity, compact table mode, source-aware explanations |
| `scripts/normalize-findings.js` | NEW — parser for 6 scanner output formats |
| `scripts/detect-stack.sh` | NEW — per-repo stack detection |
| `configs/phpcs-ruleset.xml` | NEW — full WP + WooCommerce ruleset |
| `configs/semgrep.yml` | NEW — placeholder for future custom rules |

Files unchanged: `scripts/discover.js`, `scripts/aggregate.js`, `targets.yml`,
`.gitleaks.toml`.

## Dismissal workflow — same as before

The `false-positive` / `acknowledged` / `wontfix` label flow from Phase 3
works identically on new scanner types. A PHPCS docblock warning is dismissed
the same way as a Gitleaks secret.

Realistic first-use pattern for the initial audit:
1. Scan runs, issues file with hundreds of findings
2. You (or the team) skim each repo's issue
3. For PHPCS style noise: apply `acknowledged` label en masse — this is
   not a security issue, fix over time
4. For dependency vulnerabilities: triage by severity, upgrade packages
5. For Semgrep OWASP findings: triage individually — these can be real

## Cron timing

The new schedule is `0 3 * * 1` (Monday 03:00 UTC). Rationale:

- Off-peak for GitHub Actions queue — scheduled jobs run more reliably
  at 3am UTC than at 6am/9am UTC when load spikes
- Results ready by business hours in IST (08:30), BST (04:00), EST (22:00 Sun)

If you want different, edit the cron expression in
`.github/workflows/weekly-scan.yml`. Use [crontab.guru](https://crontab.guru)
to verify syntax.
