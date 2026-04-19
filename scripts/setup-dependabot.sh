#!/usr/bin/env bash
# Phase 3c: setup-dependabot.sh
# -----------------------------
# One-time script to add .github/dependabot.yml to every Kilowott-labs repo
# that has composer.json or package.json. Dependabot then auto-opens PRs
# when dependencies need upgrading — complementary to our scanner.
#
# Safe to re-run: skips repos that already have dependabot.yml.
#
# Prerequisites:
#   - gh CLI authenticated as a user with write access to target repos
#   - discovered-targets.json present (from a prior scan run)
#
# Usage:
#   bash scripts/setup-dependabot.sh [--dry-run]

set -euo pipefail

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
  echo "DRY RUN — will show planned changes but not push"
fi

ORG="${ORG:-Kilowott-labs}"
TARGETS_JSON="${TARGETS_JSON:-discovered-targets.json}"

if [ ! -f "$TARGETS_JSON" ]; then
  echo "ERROR: $TARGETS_JSON not found. Run the scan workflow first, then retry."
  exit 1
fi

# Template per ecosystem
make_dependabot_yml() {
  local ecosystems=$1
  cat <<'YAML'
version: 2
updates:
YAML
  if [[ "$ecosystems" == *composer* ]]; then
    cat <<'YAML'
  - package-ecosystem: "composer"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
    open-pull-requests-limit: 5
    labels:
      - "dependencies"
      - "php"
YAML
  fi
  if [[ "$ecosystems" == *npm* ]]; then
    cat <<'YAML'
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
    open-pull-requests-limit: 5
    labels:
      - "dependencies"
      - "javascript"
YAML
  fi
  cat <<'YAML'
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "monthly"
    labels:
      - "dependencies"
      - "ci"
YAML
}

# Parse targets.json for repo names + stack info
repos=$(jq -r '.repos[] | "\(.name)|\(.stack)"' "$TARGETS_JSON")

echo "Processing $(echo "$repos" | wc -l) repos..."
echo ""

added=0
skipped=0
errored=0

while IFS='|' read -r repo stack; do
  [ -z "$repo" ] && continue

  echo "→ $repo (stack: $stack)"

  # Decide which ecosystems apply
  ecosystems=""
  # We do a live check on the repo since stack is sometimes coarse
  has_composer=$(gh api "repos/$ORG/$repo/contents/composer.json" --silent 2>/dev/null && echo yes || echo no)
  has_package=$(gh api "repos/$ORG/$repo/contents/package.json" --silent 2>/dev/null && echo yes || echo no)

  [ "$has_composer" = "yes" ] && ecosystems="${ecosystems}composer "
  [ "$has_package" = "yes" ] && ecosystems="${ecosystems}npm "

  if [ -z "$ecosystems" ]; then
    echo "  — no composer.json or package.json, skipping (github-actions still auto-enabled via default Dependabot)"
    skipped=$((skipped + 1))
    continue
  fi

  # Skip if dependabot.yml already exists
  if gh api "repos/$ORG/$repo/contents/.github/dependabot.yml" --silent 2>/dev/null; then
    echo "  — already has .github/dependabot.yml, skipping"
    skipped=$((skipped + 1))
    continue
  fi

  # Compose the file
  content=$(make_dependabot_yml "$ecosystems")
  echo "  — will add dependabot.yml with ecosystems: $ecosystems"

  if [ "$DRY_RUN" = "true" ]; then
    echo "  [DRY] skipped actual push"
    added=$((added + 1))
    continue
  fi

  # Push via contents API (creates file directly on default branch)
  encoded=$(echo "$content" | base64 -w0 2>/dev/null || echo "$content" | base64)
  default_branch=$(gh api "repos/$ORG/$repo" --jq '.default_branch')

  if gh api "repos/$ORG/$repo/contents/.github/dependabot.yml" \
    --method PUT \
    -f message="chore: add dependabot config (repo-health setup)" \
    -f content="$encoded" \
    -f branch="$default_branch" \
    >/dev/null 2>&1; then
    echo "  ✓ added"
    added=$((added + 1))
  else
    echo "  ✗ failed to push"
    errored=$((errored + 1))
  fi
done <<< "$repos"

echo ""
echo "Summary: added=$added skipped=$skipped errored=$errored"
