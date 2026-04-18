# Kilowott-labs repo health dashboard

_Last regenerated: **2026-04-18 10:20:19 UTC**_  
_Repos monitored: **9**  ·  Clean: **8**  ·  Flagged: **1**  ·  Total findings: **6**_

## Status at a glance

| Repo | Stack | Priority | Secret scan | Visibility |
|---|---|---|---|---|
| [`kw-security-plugin`](https://github.com/Kilowott-labs/kw-security-plugin) | php-wp-plugin | critical | 🟢 clean | 🔒 private |
| [`kw-wp-scaffold`](https://github.com/Kilowott-labs/kw-wp-scaffold) | wp-theme | high | 🟢 clean | 🔒 private |
| [`kw-wp-factory`](https://github.com/Kilowott-labs/kw-wp-factory) | powershell | high | 🟢 clean | 🌐 public |
| [`kw-figma-preflight`](https://github.com/Kilowott-labs/kw-figma-preflight) | html-js | medium | 🟢 clean | 🌐 public |
| [`WP-QA-Agent`](https://github.com/Kilowott-labs/WP-QA-Agent) | typescript-node | medium | 🟢 clean | 🌐 public |
| [`design-systems`](https://github.com/Kilowott-labs/design-systems) | javascript | medium | 🟢 clean | 🌐 public |
| [`nordic-fund-day`](https://github.com/Kilowott-labs/nordic-fund-day) | html | medium | 🔴 6 findings | 🌐 public |
| [`test-agent-project`](https://github.com/Kilowott-labs/test-agent-project) | scss | low | 🟢 clean | 🔒 private |
| [`Claude-skills`](https://github.com/Kilowott-labs/Claude-skills) | markdown | low | 🟢 clean | 🌐 public |

## Detailed findings

### `nordic-fund-day` — 6 findings

| Rule | File | Line | Commit | Date |
|---|---|---|---|---|
| generic-api-key | `figma-cache/nordic-fund-day-full.json` | 4 | `cbb14bd` | 2026-04-10 |
| generic-api-key | `figma-cache/nordic-fund-day-full.json` | 4 | `cbb14bd` | 2026-04-10 |
| generic-api-key | `figma-cache/nordic-fund-day-full.json` | 4 | `cbb14bd` | 2026-04-10 |
| generic-api-key | `figma-cache/nordic-fund-day-full.json` | 4 | `cbb14bd` | 2026-04-10 |
| generic-api-key | `figma-cache/nordic-fund-day-full.json` | 4 | `cbb14bd` | 2026-04-10 |
| generic-api-key | `figma-cache/nordic-fund-day-full.json` | 4 | `cbb14bd` | 2026-04-10 |

---

## How this works

- Weekly scan runs every **Monday 06:00 UTC** via GitHub Actions
- Gitleaks walks **full git history** on every target repo
- Findings are written to `reports/<repo>/<date>.json` and `latest.json`
- This README is regenerated automatically after each scan

Trigger a manual scan: **Actions → Weekly repo health scan → Run workflow**. Leave the target blank to scan everything, or enter a single repo name.

## What each finding means

- 🔴 **Critical repos** (like `kw-security-plugin`) are flagged red on *any* finding — treat every finding as a live credential until proven otherwise.
- 🟡 **Other repos** are flagged yellow for 1–4 findings, red for 5+.
- 🟢 **Clean** = Gitleaks found nothing across full history with the current rules.
- ⚪ **Not scanned** = repo is in `targets.yml` but no report has run yet.

When something is flagged: **rotate the credential first**, then clean the history (see [the GitHub docs on removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)).

## Roadmap

- [x] **Phase 1** — Gitleaks secret scanning across full history (this)
- [ ] **Phase 2** — Stack-aware scanners: `composer audit`, `npm audit`, PHPCS+WPCS, Semgrep
- [ ] **Phase 3** — Auto-open/update `[health-check]` issues in target repos
- [ ] **Phase 4** — Uptime monitoring via Upptime for client sites
