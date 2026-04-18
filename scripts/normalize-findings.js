#!/usr/bin/env node
/**
 * Phase 2: normalize-findings
 *
 * Each scanner outputs a different format:
 *   - Gitleaks: its own JSON (already handled in Phase 1)
 *   - composer audit: PHP advisory JSON
 *   - npm audit:      npm's advisory JSON
 *   - osv-scanner:    OSV spec JSON
 *   - PHPCS:          checkstyle or phpcs-JSON
 *   - Semgrep:        SARIF or semgrep-JSON
 *
 * This script takes a scanner name + input path and emits findings in the
 * shape file-issues.js already reads (File/StartLine/Commit/RuleID/Match/Severity).
 *
 * Output: appends to reports/<repo>/latest.json (merging with existing Gitleaks
 * findings) and writes a typed-scanner breakdown to reports/<repo>/<scanner>.json
 * for debugging.
 *
 * Env: none (all args via argv)
 * Usage:
 *   node normalize-findings.js <scanner> <input-file> <repo-name>
 * Scanners: gitleaks | composer | npm | osv | phpcs | semgrep
 */

const fs = require('fs');
const path = require('path');

const [,, scanner, inputPath, repoName] = process.argv;
if (!scanner || !inputPath || !repoName) {
  console.error('Usage: normalize-findings.js <scanner> <input> <repo-name>');
  process.exit(1);
}

const REPORTS_DIR = process.env.REPORTS_DIR || 'reports';

// ---------------------------------------------------------------------------
// Per-scanner parsers
// Each returns an array of normalised findings with this shape:
//   { RuleID, File, StartLine, Commit, Match, Source, Severity }
// ---------------------------------------------------------------------------

function parseGitleaks(raw) {
  // Gitleaks output is already our canonical shape — just tag the source.
  if (!Array.isArray(raw)) return [];
  return raw.map(f => ({
    RuleID: f.RuleID || f.ruleID || 'unknown',
    File: f.File || f.file || '',
    StartLine: f.StartLine || f.startLine || 0,
    Commit: (f.Commit || f.commit || '').slice(0, 40),
    Date: f.Date || f.date || '',
    Match: f.Match || f.match || '',
    Source: 'gitleaks',
    Severity: 'high', // secrets are always high; filer escalates to critical on critical repos
  }));
}

function parseComposerAudit(raw) {
  // composer audit --format=json output:
  // { advisories: { "vendor/pkg": [ {advisoryId, cve, title, link, affectedVersions, severity, reportedAt, ...} ] } }
  const out = [];
  const advisories = raw.advisories || {};
  for (const pkg of Object.keys(advisories)) {
    for (const adv of advisories[pkg]) {
      out.push({
        RuleID: adv.cve || adv.advisoryId || `composer-${pkg}`,
        File: 'composer.lock',
        StartLine: 0,
        Commit: '',
        Date: adv.reportedAt || '',
        Match: `${pkg} ${adv.affectedVersions || ''} — ${adv.title || ''}`.slice(0, 200),
        Source: 'composer-audit',
        Severity: mapSeverity(adv.severity, 'medium'),
        Extra: {
          package: pkg,
          advisory: adv.advisoryId,
          cve: adv.cve,
          link: adv.link,
          title: adv.title,
        },
      });
    }
  }
  return out;
}

function parseNpmAudit(raw) {
  // npm audit --json output shape (npm 7+):
  // { vulnerabilities: { "pkgname": { name, severity, via: [...], range, effects, nodes, fixAvailable } } }
  const out = [];
  const vulns = raw.vulnerabilities || {};
  for (const name of Object.keys(vulns)) {
    const v = vulns[name];
    // 'via' can be strings (direct deps) or objects (source advisories)
    const viaDetails = (v.via || []).filter(x => typeof x === 'object');
    if (viaDetails.length === 0) {
      // Transitive — no direct advisory detail, but still worth flagging
      out.push({
        RuleID: `npm-${name}`,
        File: 'package-lock.json',
        StartLine: 0,
        Commit: '',
        Date: '',
        Match: `${name}@${v.range || '?'} — transitive vulnerability`,
        Source: 'npm-audit',
        Severity: mapSeverity(v.severity, 'medium'),
        Extra: { package: name, range: v.range, fixAvailable: v.fixAvailable },
      });
    } else {
      for (const adv of viaDetails) {
        out.push({
          RuleID: adv.url ? adv.url.split('/').pop() : `npm-${name}`,
          File: 'package-lock.json',
          StartLine: 0,
          Commit: '',
          Date: '',
          Match: `${name}@${v.range || '?'} — ${adv.title || adv.name || ''}`.slice(0, 200),
          Source: 'npm-audit',
          Severity: mapSeverity(adv.severity || v.severity, 'medium'),
          Extra: {
            package: name,
            title: adv.title,
            url: adv.url,
            cwe: adv.cwe,
            cvss: adv.cvss,
            fixAvailable: v.fixAvailable,
          },
        });
      }
    }
  }
  return out;
}

function parseOsv(raw) {
  // OSV-Scanner JSON:
  // { results: [ { source: {path}, packages: [ { package: {name, version}, vulnerabilities: [...] } ] } ] }
  const out = [];
  for (const result of (raw.results || [])) {
    const file = (result.source && result.source.path) || '';
    for (const pkg of (result.packages || [])) {
      for (const vuln of (pkg.vulnerabilities || [])) {
        out.push({
          RuleID: vuln.id || 'osv-unknown',
          File: file,
          StartLine: 0,
          Commit: '',
          Date: vuln.published || '',
          Match: `${pkg.package.name}@${pkg.package.version} — ${vuln.summary || vuln.id}`.slice(0, 200),
          Source: 'osv-scanner',
          Severity: mapOsvSeverity(vuln.database_specific, vuln.severity),
          Extra: {
            package: pkg.package.name,
            version: pkg.package.version,
            ecosystem: pkg.package.ecosystem,
            aliases: vuln.aliases,
            summary: vuln.summary,
          },
        });
      }
    }
  }
  return out;
}

function parsePhpcs(raw) {
  // PHPCS JSON output:
  // { totals: {...}, files: { "path/file.php": { errors, warnings, messages: [ {message, source, severity, type, line, column, fixable} ] } } }
  const out = [];
  const files = raw.files || {};
  for (const file of Object.keys(files)) {
    for (const msg of (files[file].messages || [])) {
      out.push({
        RuleID: msg.source || 'phpcs-unknown',
        File: file,
        StartLine: msg.line || 0,
        Commit: '',
        Date: '',
        Match: msg.message || '',
        Source: 'phpcs',
        Severity: msg.type === 'ERROR' ? 'medium' : 'low',
        Extra: {
          type: msg.type,
          column: msg.column,
          fixable: msg.fixable,
        },
      });
    }
  }
  return out;
}

function parseSemgrep(raw) {
  // Semgrep --json output:
  // { results: [ { check_id, path, start: {line, col}, end: {...}, extra: {message, severity, metadata} } ] }
  const out = [];
  for (const r of (raw.results || [])) {
    const extra = r.extra || {};
    out.push({
      RuleID: r.check_id || 'semgrep-unknown',
      File: r.path || '',
      StartLine: (r.start && r.start.line) || 0,
      Commit: '',
      Date: '',
      Match: (extra.message || '').slice(0, 200),
      Source: 'semgrep',
      Severity: mapSemgrepSeverity(extra.severity),
      Extra: {
        category: extra.metadata && extra.metadata.category,
        cwe: extra.metadata && extra.metadata.cwe,
        owasp: extra.metadata && extra.metadata.owasp,
        ruleUrl: extra.metadata && extra.metadata['source-rule-url'],
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Severity mapping — normalise each scanner's vocabulary to ours
// ---------------------------------------------------------------------------
function mapSeverity(raw, fallback) {
  if (!raw) return fallback;
  const s = String(raw).toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'high') return 'high';
  if (s === 'moderate' || s === 'medium') return 'medium';
  if (s === 'low' || s === 'info') return 'low';
  return fallback;
}

function mapOsvSeverity(dbSpecific, sevArray) {
  // OSV can have either database_specific.severity or an array of severities
  if (dbSpecific && dbSpecific.severity) return mapSeverity(dbSpecific.severity, 'medium');
  if (Array.isArray(sevArray) && sevArray[0] && sevArray[0].score) {
    // CVSS score — try to extract
    const score = parseFloat(sevArray[0].score) || 0;
    if (score >= 9) return 'critical';
    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
  }
  return 'medium';
}

function mapSemgrepSeverity(raw) {
  if (!raw) return 'medium';
  const s = String(raw).toUpperCase();
  if (s === 'ERROR') return 'high';
  if (s === 'WARNING') return 'medium';
  if (s === 'INFO') return 'low';
  return 'medium';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const parsers = {
  gitleaks: parseGitleaks,
  composer: parseComposerAudit,
  npm: parseNpmAudit,
  osv: parseOsv,
  phpcs: parsePhpcs,
  semgrep: parseSemgrep,
};

const parser = parsers[scanner];
if (!parser) {
  console.error(`Unknown scanner: ${scanner}. Known: ${Object.keys(parsers).join(', ')}`);
  process.exit(1);
}

let raw;
try {
  if (!fs.existsSync(inputPath)) {
    console.log(`[${scanner}:${repoName}] no input file at ${inputPath} — emitting empty.`);
    raw = scanner === 'gitleaks' ? [] : {};
  } else {
    const body = fs.readFileSync(inputPath, 'utf8').trim();
    if (!body || body === 'null') {
      raw = scanner === 'gitleaks' ? [] : {};
    } else {
      raw = JSON.parse(body);
    }
  }
} catch (e) {
  console.error(`[${scanner}:${repoName}] failed to read/parse ${inputPath}: ${e.message}`);
  process.exit(0); // don't fail the whole run — other scanners still useful
}

const normalised = parser(raw);
console.log(`[${scanner}:${repoName}] ${normalised.length} findings`);

// Write the per-scanner dump (for debugging / audit trail)
const scannerDir = path.join(REPORTS_DIR, repoName);
fs.mkdirSync(scannerDir, { recursive: true });
fs.writeFileSync(path.join(scannerDir, `${scanner}.json`), JSON.stringify(normalised, null, 2));

// Merge into latest.json — union of findings from all scanners this run
const latestPath = path.join(scannerDir, 'latest.json');
let existing = [];
if (fs.existsSync(latestPath)) {
  try {
    const b = fs.readFileSync(latestPath, 'utf8').trim();
    existing = (b && b !== 'null') ? JSON.parse(b) : [];
    if (!Array.isArray(existing)) existing = [];
  } catch {
    existing = [];
  }
}

// Replace findings from this scanner (re-run should overwrite, not duplicate)
const filtered = existing.filter(f => f.Source !== scanner);
const merged = [...filtered, ...normalised];
fs.writeFileSync(latestPath, JSON.stringify(merged, null, 2));

// Also write a dated snapshot so history is preserved
const date = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(scannerDir, `${date}.json`), JSON.stringify(merged, null, 2));

console.log(`[${scanner}:${repoName}] merged — total findings in latest.json: ${merged.length}`);
