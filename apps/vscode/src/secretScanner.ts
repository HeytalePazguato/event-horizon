/**
 * Secret scanner — decides whether a file read may be retained in the read cache / digests.
 *
 * Two layers, per the 3.3.0 security notes ("denylist + entropy scan"):
 *   1. Path denylist (`isSecretPath`) — `.env*`, key/cert stores, credential/secret names,
 *      ~/.ssh|.aws|.gnupg, and anything the workspace `.gitignore` covers.
 *   2. Content scan (`containsSecret`) — well-known token prefixes plus high-entropy tokens.
 *
 * Pure module: no `vscode` import, no I/O, no dependencies.
 *
 * Entropy heuristics (kept deliberately conservative to limit false positives):
 *   - Candidate tokens are runs of `[A-Za-z0-9+/=_-]` of at least 32 chars.
 *   - Lockfile integrity values (`sha1-`/`sha256-`/`sha384-`/`sha512-<base64>`) are stripped first.
 *   - Hex-only tokens: need a digit and a letter, Shannon entropy >= 3.0 (16-symbol alphabet
 *     tops out at 4.0). Exactly-40-char hex is treated as a git SHA and ignored.
 *   - Other tokens: need lowercase, uppercase AND a digit (real random keys have all three;
 *     long camelCase identifiers, paths and kebab-case names usually do not) and entropy >= 4.0.
 *   - Only the first MAX_SCAN_CHARS (~1 MB) of content is scanned.
 */

const MAX_SCAN_CHARS = 1_000_000;

// ── Path denylist ────────────────────────────────────────────────────────────

const SECRET_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore'];
const SECRET_EXACT_NAMES = new Set(['.npmrc', '.netrc', '.pgpass', '.git-credentials']);
const SECRET_NAME_PREFIXES = ['id_rsa', 'id_ed25519', 'id_ecdsa'];
const SECRET_DIRS = new Set(['.ssh', '.aws', '.gnupg']);
const ENV_TEMPLATE_SUFFIXES = new Set(['example', 'sample', 'template']);

export interface SecretPathOptions {
  /** Returns true when the (absolute or relative) path is covered by the workspace .gitignore. */
  isIgnored?: (filePath: string) => boolean;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function isSecretPath(filePath: string, opts?: SecretPathOptions): boolean {
  const norm = normalizePath(filePath);
  const segments = norm.split('/').filter(Boolean);
  const base = (segments[segments.length - 1] ?? '').toLowerCase();

  // Directories (every segment except the file name itself).
  for (let i = 0; i < segments.length - 1; i++) {
    if (SECRET_DIRS.has(segments[i].toLowerCase())) return true;
  }

  if (base === '.env') return true;
  if (base.startsWith('.env.')) {
    const suffix = base.slice('.env.'.length);
    if (!ENV_TEMPLATE_SUFFIXES.has(suffix)) return true;
  }
  if (SECRET_EXACT_NAMES.has(base)) return true;
  if (SECRET_EXTENSIONS.some((ext) => base.endsWith(ext))) return true;
  if (SECRET_NAME_PREFIXES.some((p) => base.startsWith(p))) return true;
  if (base.includes('credentials') || base.includes('secret')) return true;

  if (opts?.isIgnored?.(filePath)) return true;
  return false;
}

// ── Gitignore matcher (common subset) ────────────────────────────────────────

interface GitignoreRule {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

function globToRegexSource(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` → any number of directories; `/**` or trailing `**` → everything below.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if ('\\^$+.()|{}[]'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return out;
}

function parseGitignore(text: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (!line) continue;
    // A slash at the start or middle anchors the pattern to the .gitignore's directory.
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const src = globToRegexSource(line);
    const re = new RegExp(anchored ? `^${src}$` : `(?:^|/)${src}$`);
    rules.push({ re, negate, dirOnly });
  }
  return rules;
}

/**
 * Build a matcher from `.gitignore` text. Returned function takes an absolute path and reports
 * whether it is ignored. Supports blank/comment lines, `*`, `?`, `**`, trailing `/` (dirs only),
 * leading `/` anchoring and `!` negation. A path under an ignored directory is ignored.
 * Paths outside `rootDir` are never ignored.
 */
export function createGitignoreMatcher(
  gitignoreText: string,
  rootDir: string,
): (absPath: string) => boolean {
  const rules = parseGitignore(gitignoreText);
  const root = normalizePath(rootDir).replace(/\/+$/, '');
  const rootLower = root.toLowerCase();

  return (absPath: string): boolean => {
    if (rules.length === 0) return false;
    const norm = normalizePath(absPath);
    if (norm.toLowerCase() !== rootLower && !norm.toLowerCase().startsWith(rootLower + '/')) {
      return false;
    }
    const rel = norm.slice(root.length).replace(/^\/+/, '');
    if (!rel) return false;
    const parts = rel.split('/').filter(Boolean);

    // Walk each ancestor directory, then the file itself; an ignored ancestor wins.
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.slice(0, i + 1).join('/');
      const isDir = i < parts.length - 1;
      let ignored = false;
      for (const rule of rules) {
        if (rule.dirOnly && !isDir) continue;
        if (rule.re.test(prefix)) ignored = !rule.negate;
      }
      if (ignored) return true;
    }
    return false;
  };
}

// ── Content scan ─────────────────────────────────────────────────────────────

const KNOWN_SECRET_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{10,}/, // Anthropic
  /\bsk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/, // OpenAI-style (needs a digit: skips "sk-some-long-name")
  /\bgh[pos]_[A-Za-z0-9]{30,}/, // GitHub ghp_ / gho_ / ghs_
  /\bgithub_pat_[A-Za-z0-9_]{20,}/, // GitHub fine-grained PAT
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/, // AWS access key id
  /\bxox[bp]-[A-Za-z0-9-]{10,}/, // Slack
  /\bAIza[0-9A-Za-z_-]{35}/, // Google API key
  /\bglpat-[A-Za-z0-9_-]{20,}/, // GitLab PAT
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/, // PEM private keys
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\./, // JWT
];

const INTEGRITY_RE = /\bsha(?:1|256|384|512)-[A-Za-z0-9+/=]+/g;
const TOKEN_RE = /[A-Za-z0-9+/=_-]{32,}/g;
const HEX_RE = /^[0-9a-fA-F]+$/;

export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function isHighEntropyToken(token: string): boolean {
  const t = token.replace(/=+$/, '');
  if (t.length < 32) return false;
  const hasDigit = /\d/.test(t);
  if (HEX_RE.test(t)) {
    if (t.length === 40) return false; // git SHA
    return hasDigit && /[a-fA-F]/.test(t) && shannonEntropy(t) >= 3.0;
  }
  if (!hasDigit || !/[a-z]/.test(t) || !/[A-Z]/.test(t)) return false;
  return shannonEntropy(t) >= 4.0;
}

export function containsSecret(content: string): boolean {
  const text = content.length > MAX_SCAN_CHARS ? content.slice(0, MAX_SCAN_CHARS) : content;

  for (const re of KNOWN_SECRET_PATTERNS) {
    if (re.test(text)) return true;
  }

  const stripped = text.replace(INTEGRITY_RE, ' ');
  for (const m of stripped.matchAll(TOKEN_RE)) {
    if (isHighEntropyToken(m[0])) return true;
  }
  return false;
}

/** True when the file's content may be retained in the cache / digests. */
export function mayCache(filePath: string, content: string, opts?: SecretPathOptions): boolean {
  return !isSecretPath(filePath, opts) && !containsSecret(content);
}
