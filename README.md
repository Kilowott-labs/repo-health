# Kilowott-labs repo health dashboard

_This README is regenerated automatically after every scan. If you're seeing this placeholder, the first scan hasn't run yet._

Trigger the first scan: **Actions → Weekly repo health scan → Run workflow**.

## What lives here

- **`targets.yml`** — the list of repos this system monitors. Add/remove here.
- **`.gitleaks.toml`** — secret-scanning rules (extends Gitleaks defaults with WordPress-specific patterns)
- **`.github/workflows/weekly-scan.yml`** — the scheduled scan
- **`scripts/aggregate.js`** — regenerates this dashboard from the latest reports
- **`reports/<repo>/`** — raw per-repo findings history as JSON

## How it runs

Every Monday at 06:00 UTC, or on manual dispatch, the workflow:

1. Reads the target list from `targets.yml`
2. Fans out — one parallel job per target repo
3. Each job clones the target (full history), runs Gitleaks, writes `reports/<repo>/<date>.json`
4. A final aggregation job merges all reports and regenerates this README

## Requirements

- An org-level Actions secret named `ORG_SCAN_TOKEN` holding a fine-grained PAT with:
  - `Contents: Read` and `Metadata: Read` on all Kilowott-labs repos
  - (`Issues: Write` will be added in Phase 3 when we wire up auto-issues)

## Roadmap

See progress in the generated dashboard above (after first scan).
