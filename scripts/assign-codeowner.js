/**
 * Phase 5e — resolve health-check issue assignees.
 *
 * Given a target repo and a file path inside it, return an array of
 * GitHub usernames responsible for that file. Resolution order:
 *   1. .github/CODEOWNERS pattern match (last matching rule wins)
 *   2. Most recent commit author on the file (via /commits endpoint —
 *      uses GitHub's own author→user correlation; no email search hop)
 *   3. Admin fallback (ajajrajguruKW) if blame resolves null OR the
 *      resolved user is not a Kilowott-labs org member
 *
 * The module is API-only: it calls the gh() wrapper passed by the
 * caller. No clone required. Errors are swallowed — any failure in
 * resolution falls back to admin so the filer never throws.
 *
 * Exports a single async function:
 *   resolveAssignees(owner, repo, filePath, gh)
 *     → Promise<string[]>   // deduped, never empty
 */

const ADMIN_FALLBACK = 'ajajrajguruKW';
const CODEOWNERS_PATH = '.github/CODEOWNERS';

// In-process caches — one run at a time, safe as module-scope state.
const codeownersCache = new Map();   // repoKey → parsed rules (array) or null
const membershipCache = new Map();   // username → true|false

// ---------------------------------------------------------------------------
// CODEOWNERS parsing — minimal gitignore-style glob support
// ---------------------------------------------------------------------------
function parseCodeowners(text) {
  const rules = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const pattern = parts.shift();
    const owners = parts
      .filter(p => p.startsWith('@') && !p.includes('/'))   // drop team @org/team — we only assign users
      .map(p => p.replace(/^@/, ''));
    if (pattern && owners.length > 0) {
      rules.push({ pattern, owners });
    }
  }
  return rules;
}

function globToRegex(pattern) {
  // Handle leading `/` as root-anchor and trailing `/` as directory.
  let p = pattern;
  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);

  // Escape regex specials, then restore glob meaning for *, **, ?
  let re = p
    .replace(/[.+^$()|[\]{}\\]/g, '\\$&')
    .replace(/\*\*/g, '§DOUBLESTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/§DOUBLESTAR§/g, '.*');

  // Anchored patterns match from repo root; others match any depth.
  const prefix = anchored ? '^' : '(^|.*/)';
  const suffix = dirOnly ? '(/.*)?$' : '(/.*)?$';
  return new RegExp(prefix + re + suffix);
}

function matchCodeowners(rules, filePath) {
  // Per GitHub spec: later rules override earlier rules. Walk backwards
  // so the first match we encounter is the authoritative one.
  const cleanPath = filePath.replace(/^\.?\//, '');
  for (let i = rules.length - 1; i >= 0; i--) {
    const { pattern, owners } = rules[i];
    if (globToRegex(pattern).test(cleanPath)) {
      return owners;
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// GitHub API lookups — all errors swallowed, all returns defensive
// ---------------------------------------------------------------------------
async function fetchCodeowners(owner, repo, gh) {
  const key = `${owner}/${repo}`;
  if (codeownersCache.has(key)) return codeownersCache.get(key);

  try {
    const res = await gh(`/repos/${owner}/${repo}/contents/${CODEOWNERS_PATH}`);
    if (!res || res.type !== 'file' || typeof res.content !== 'string') {
      console.log(`[assign] ${key}: no CODEOWNERS (empty response)`);
      codeownersCache.set(key, null);
      return null;
    }
    const text = Buffer.from(res.content, res.encoding || 'base64').toString('utf8');
    const rules = parseCodeowners(text);
    console.log(`[assign] ${key}: CODEOWNERS loaded, ${rules.length} rules`);
    codeownersCache.set(key, rules);
    return rules;
  } catch (err) {
    // 404 is expected — most repos have no CODEOWNERS today.
    const status = /\b404\b/.test(err.message) ? 404 : 0;
    if (status === 404) {
      console.log(`[assign] ${key}: no CODEOWNERS (404)`);
    } else {
      console.log(`[assign] ${key}: CODEOWNERS fetch failed — ${err.message.slice(0, 120)}`);
    }
    codeownersCache.set(key, null);
    return null;
  }
}

async function fetchLastCommitAuthor(owner, repo, filePath, gh) {
  const key = `${owner}/${repo}`;
  if (!filePath) {
    console.log(`[assign] ${key}: no file path provided, skipping blame`);
    return null;
  }
  try {
    const params = new URLSearchParams({ path: filePath, per_page: '1' });
    const commits = await gh(`/repos/${owner}/${repo}/commits?${params.toString()}`);
    if (!Array.isArray(commits) || commits.length === 0) {
      console.log(`[assign] ${key}: no commits found for ${filePath}`);
      return null;
    }
    const login = commits[0]?.author?.login || null;
    if (login) {
      console.log(`[assign] ${key}: blame on ${filePath} → @${login}`);
    } else {
      console.log(`[assign] ${key}: blame on ${filePath} → GitHub could not correlate author`);
    }
    return login;
  } catch (err) {
    console.log(`[assign] ${key}: commits fetch failed for ${filePath} — ${err.message.slice(0, 120)}`);
    return null;
  }
}

async function isOrgMember(username, gh, org = 'Kilowott-labs') {
  if (!username) return false;
  if (membershipCache.has(username)) return membershipCache.get(username);

  try {
    // 204 → member (gh() returns null for 204 — no throw)
    await gh(`/orgs/${org}/members/${username}`);
    console.log(`[assign] @${username} is ${org} member`);
    membershipCache.set(username, true);
    return true;
  } catch (err) {
    const is404 = /\b404\b/.test(err.message);
    if (is404) {
      console.log(`[assign] @${username} is NOT ${org} member (404)`);
    } else {
      console.log(`[assign] membership check failed for @${username} — ${err.message.slice(0, 120)}`);
    }
    membershipCache.set(username, false);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
async function resolveAssignees(owner, repo, filePath, gh) {
  const key = `${owner}/${repo}`;

  // 1. CODEOWNERS
  try {
    const rules = await fetchCodeowners(owner, repo, gh);
    if (rules && rules.length > 0 && filePath) {
      const matched = matchCodeowners(rules, filePath);
      if (matched.length > 0) {
        console.log(`[assign] ${key}: CODEOWNERS match for ${filePath} → ${matched.map(u => '@' + u).join(' ')}`);
        return [...new Set(matched)];
      }
      console.log(`[assign] ${key}: CODEOWNERS present but no rule matched ${filePath}`);
    }
  } catch (err) {
    console.log(`[assign] ${key}: CODEOWNERS resolution errored — ${err.message.slice(0, 120)}`);
  }

  // 2. Git blame via commits endpoint
  try {
    let login = await fetchLastCommitAuthor(owner, repo, filePath, gh);
    // Reject bot accounts — they cannot be issue assignees (GitHub 422s
    // on bot-suffixed logins) and attributing ownership to a bot is
    // semantically wrong anyway. Fall through to admin.
    if (login && login.endsWith('[bot]')) {
      console.log(`[assign] ${key}: blame resolved to bot @${login} — skipping`);
      login = null;
    }
    if (login) {
      const member = await isOrgMember(login, gh);
      if (member) {
        console.log(`[assign] ${key}: blame resolved to org member @${login}`);
        return [login];
      }
      console.log(`[assign] ${key}: @${login} not in org — falling back to admin`);
    }
  } catch (err) {
    console.log(`[assign] ${key}: blame resolution errored — ${err.message.slice(0, 120)}`);
  }

  // 3. Admin fallback
  console.log(`[assign] ${key}: falling back to @${ADMIN_FALLBACK}`);
  return [ADMIN_FALLBACK];
}

module.exports = resolveAssignees;
