/**
 * Shared finding fingerprint — single source of truth for `F-xxxxxxxx` IDs.
 *
 * Previously both file-issues.js (SHA-1) and aggregate.js (SHA-256)
 * had their own implementations, which produced DIFFERENT IDs for
 * the same finding. Issue bodies in target repos use the SHA-1
 * value (file-issues.js is what writes the issue text), so this
 * module preserves that algorithm. autofix-allowlist.js parses
 * IDs out of those issue bodies, so it must match.
 *
 * Exclusions:
 *   - commit SHA is NOT in the fingerprint — the same leak across
 *     many commits dedupes to one entry with first/last-seen meta.
 *
 * Inclusions:
 *   - Source (scanner name) guards against cross-scanner collisions
 *     where a PHPCS finding and a Gitleaks finding happen to land
 *     on the same file:line.
 */

const crypto = require('crypto');

function fingerprint(finding) {
  const rule   = finding.RuleID    || finding.ruleID    || 'unknown';
  const file   = finding.File      || finding.file      || '';
  const line   = finding.StartLine || finding.startLine || 0;
  const source = finding.Source    || finding.source    || 'gitleaks';
  const h = crypto.createHash('sha1')
    .update(`${source}|${rule}|${file}|${line}`)
    .digest('hex')
    .slice(0, 8);
  return `F-${h}`;
}

module.exports = { fingerprint };
