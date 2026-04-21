# Phase 3: Team-facing issue system

## What this adds

The weekly scanner now writes findings as proper GitHub issues — one issue per
target repo, updated idempotently. A weekly digest issue lands in `repo-health`
itself summarizing the org-wide state.

## How it works

```
Weekly scan runs → aggregate regenerates README → file-issues runs
                                                   ↓
                          For each target repo:
                          ├─ Read reports/<repo>/latest.json
                          ├─ Fingerprint each finding (stable ID F-xxxxxxxx)
                          ├─ Check for dismissals (wontfix/acknowledged/false-positive labels)
                          ├─ Render issue body (severity-grouped, with fix steps)
                          └─ Create or update the single [health-check] issue
                          ↓
                          Write weekly digest issue in repo-health/
```

## Per-finding stability

Each finding gets a stable fingerprint: `F-xxxxxxxx` based on rule + file + line + commit.
Even after the issue body is regenerated, the same underlying finding has the
same ID — so dismissals and team references survive.

## Dismissal workflow

When the team wants to mark a finding as not-actionable:

1. Open the `[health-check]` issue in the affected repo
2. Add a comment with the finding ID and reason:
   ```
   dismiss F-abc12345 reason: test fixture, fake credential
   ```
3. Apply ONE of these labels to the issue:
   - `false-positive` — scanner is wrong; will be allowlisted in `.gitleaks.toml`
   - `acknowledged` — finding is real, fix is planned but not urgent
   - `wontfix` — finding is real, deliberate decision not to fix

On the next scan, that fingerprint is skipped. If the underlying file/line/commit
changes, the fingerprint changes and the finding resurfaces — which is correct,
a new occurrence deserves a new decision.

## What the team sees

### In each target repo
A single pinned-worthy issue titled:
`[health-check] N active findings — <repo-name>`

Structure:
- Summary table (severity counts)
- Active findings grouped by severity, each with stable ID, location, and expandable "why + fix" section
- Collapsed list of dismissed findings (for audit trail)
- Dismissal instructions

### In `repo-health` itself
A weekly digest issue titled:
`[health-check] Weekly digest — YYYY-MM-DD`

Structure:
- Totals across the org
- Per-repo row: priority, active count, dismissed count, link to the repo's issue
- Direct link to the dashboard

## Labels that get auto-created

The scanner auto-creates these labels in every target repo on first run:

| Label | Color | Purpose |
|---|---|---|
| `health-check` | red | Marks the auto-managed issue |
| `wontfix` | white | Dismissal — do not fix |
| `acknowledged` | yellow | Dismissal — fix planned |
| `false-positive` | green | Dismissal — scanner wrong |

## PAT scope update required

Phase 1 PAT scopes were read-only. Phase 3 needs to write issues and manage
labels in every target repo.

Add to the existing fine-grained PAT:
- `Issues: Write` on all Kilowott-labs repos
- `Metadata: Read` (already there)
- `Contents: Read` (already there)

No secret name change — `ORG_SCAN_TOKEN` continues to work.

## Rate limit notes

GitHub's REST API allows 5000 authenticated requests/hour. Per scan run,
the filer makes roughly:
- 2-4 calls per repo (search issue, ensure labels, read dismissals, write issue)
- 1 call for the digest

For 9 repos that's ~30-40 calls per scan run — well under the limit. Even at
100 target repos we'd be at ~400 calls, still far below ceiling.

## What's intentionally not here

- **No Slack/Discord webhook yet** — would add `SLACK_WEBHOOK_URL` secret and
  a post-step for critical-only alerts. Can bolt on later if the team wants it.
- **No SLA tracking** — "finding open > 30 days" would need a separate query
  over historical scans. Phase 4+ territory.
- **No auto-PR for false-positive allowlists** — the scanner could open a PR
  against `.gitleaks.toml` when a `false-positive` label is applied, but that
  adds complexity. For now, a human edits `.gitleaks.toml` manually.

## Testing with current findings

You have exactly 1 active finding right now (the Figma PAT in nordic-fund-day).
Once Phase 3 deploys and the scan re-runs, you'll see:

- An issue opens in `Kilowott-labs/nordic-fund-day` titled
  `[health-check] 1 active finding — nordic-fund-day` with the fingerprinted
  finding and fix steps
- A digest issue opens in `Kilowott-labs/repo-health` showing 1/9 repos flagged
- The 8 clean repos get nothing — no noise

Perfect proof case.
