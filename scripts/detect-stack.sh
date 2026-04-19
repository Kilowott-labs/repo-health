#!/usr/bin/env bash
# Phase 2 — detect-stack.sh
# --------------------------
# Inspects a cloned repo and outputs which scanners should run for it.
#
# Emits to $GITHUB_OUTPUT (or stdout if not in Actions):
#   has_composer=true|false
#   has_npm=true|false
#   has_wp=true|false
#   has_any_code=true|false   (there's something to semgrep)
#
# Called from inside the cloned target repo directory.

set -euo pipefail

has_composer=false
has_npm=false
has_wp=false
has_any_code=false

if [ -f composer.json ]; then has_composer=true; has_any_code=true; fi
if [ -f package.json ]; then has_npm=true; has_any_code=true; fi

# WordPress detection: any of these signals is sufficient
if [ -f wp-config.php ] || [ -f wp-config-sample.php ]; then
  has_wp=true
  has_any_code=true
fi
if [ "$has_composer" = "true" ] && grep -qE '"(wpackagist-plugin|johnpbloch/wordpress|roots/wordpress|automattic/woocommerce)"' composer.json 2>/dev/null; then
  has_wp=true
fi
# Plugin headers live in .php; theme headers live in style.css.
# A single grep across both extensions catches both.
if grep -rlE '^\s*(Plugin Name|Theme Name):\s*' --include='*.php' --include='*.css' --max-count=1 . 2>/dev/null | head -1 | grep -q .; then
  has_wp=true
  has_any_code=true
fi
# Fallback signal: style.css in root + functions.php is the classic WP theme
# layout. Catches scaffolds where headers may be placeholder or missing.
if [ -f style.css ] && [ -f functions.php ]; then
  has_wp=true
  has_any_code=true
fi

# Detect any code for semgrep (falls back to language detection if no manifests)
if [ "$has_any_code" = "false" ]; then
  if find . -maxdepth 3 \( -name '*.php' -o -name '*.js' -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.py' -o -name '*.go' -o -name '*.rb' \) -print -quit 2>/dev/null | grep -q .; then
    has_any_code=true
  fi
fi

echo "has_composer=$has_composer"
echo "has_npm=$has_npm"
echo "has_wp=$has_wp"
echo "has_any_code=$has_any_code"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "has_composer=$has_composer"
    echo "has_npm=$has_npm"
    echo "has_wp=$has_wp"
    echo "has_any_code=$has_any_code"
  } >> "$GITHUB_OUTPUT"
fi
