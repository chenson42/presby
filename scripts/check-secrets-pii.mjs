#!/usr/bin/env node
/**
 * Secrets & PII tripwire. presby is public — this repo's own "No Real Data"
 * invariant (CLAUDE.md) says no real congregation name, person, address,
 * email, phone, or credential is ever committed. A pre-commit hook already
 * hard-blocks `private/`/`scratch/`, but that only stops one specific class
 * of accident (an agent running `git add -A` in a scratch directory) — it
 * says nothing about a real secret or a real person's contact info typed
 * directly into a tracked file, which has happened at least once in this
 * repo's own history (a generated dev password narrated into a work-log's
 * prose while documenting what `.env.local` contained).
 *
 * `checkSecretsPii(files)` is the pure, testable core — takes an array of
 * `{ path, content }` (mirroring check-brand-scope.mjs's own fixture shape)
 * and returns violations with no disk/git access, so its rules can be
 * exercised directly in check-secrets-pii.test.mjs. The CLI entry point
 * below (guarded by the ESM-main check at the bottom) is the only thing
 * that touches `git ls-files`/`readFileSync`.
 *
 * Two tiers:
 *
 *   1. HARD patterns (private keys, cloud-provider API key shapes, JWTs,
 *      connection strings with embedded credentials) — these should never
 *      appear in this repo under any circumstance, so there is no
 *      annotation escape hatch for them.
 *   2. SOFT patterns (an env-var-shaped SECRET/PASSWORD/TOKEN/KEY assignment
 *      to a real-looking value; an email address outside the project's own
 *      safe-domain allowlist; a phone or SSN-shaped number outside the
 *      555-exchange fake-number convention) — these can be real findings or
 *      false positives (a placeholder, a fixture using an allowed domain
 *      variant not yet in the allowlist, a work-log narrating a REDACTED
 *      value). Exempt a specific line with a same-line or line-above
 *      `// leak-ok: <reason>` comment (`<!-- leak-ok: ... -->` in Markdown).
 *
 * Not a substitute for a real secret-scanning service (e.g. GitHub's own
 * push protection, now that this repo is public) or for scrubbing git
 * history — this only ever sees the CURRENT tracked tree. A value already
 * in a past commit is still in the public history regardless of what this
 * script finds today; that needs a deliberate, separate history-rewrite
 * decision, never something this tripwire does on its own.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This tripwire's own test fixtures deliberately contain synthetic
// secret-shaped strings (a private key block, an AWS key ID, a JWT, ...) —
// that's the only way to prove HARD-tier detection actually fires, and HARD
// findings correctly have no annotation escape hatch. Excluding this one
// file by exact path is narrower and safer than a general "test files are
// exempt" rule, which would create a real loophole for accidentally-real
// secrets in an ordinary test fixture elsewhere in the tree.
export const SELF_TEST_EXEMPT_PATH = "scripts/check-secrets-pii.test.mjs";

export const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".gz", ".tar", ".mp4", ".mp3",
]);

// Domains this project already treats as safe placeholders — extend this
// list when a new legitimate convention is added, don't annotate every
// occurrence one by one.
export const SAFE_EMAIL_DOMAIN_RE =
  /\.invalid$|(@|\.)example\.(com|org|net)$|@presbyportal\.org$|@claudecode\.info$|@anthropic\.com$|@localhost$|@sentry\.io$/i;

// Not real emails at all — the `user@host` shape of a git SSH remote
// (git@github.com:org/repo.git, git+ssh://git@github.com/...) matches the
// email regex coincidentally. Exact local-part+domain pairs only, not a
// broad domain allowlist, since a real person could still have an address
// at one of these hosts in prose.
export const GIT_REMOTE_EMAIL_RE = /^git@(github\.com|gitlab\.com|bitbucket\.org)$/i;

// A connection-string userinfo segment (postgres://user:password@host) is  // leak-ok: pattern description, not a real value
// coincidentally email-shaped once you look at just the "word@word.tld"  // leak-ok: pattern description, not a real value
// tail — these local-parts are placeholder credential words, never a real
// person's mailbox.
export const CONNECTION_STRING_LOCAL_PART_RE =
  /^(password|user|pass|admin|root|xxxx|neondb_owner|presby_app|presby_platform)$/i;

export const OK_RE = /(\/\/|<!--)\s*leak-ok:/i;

/** @type {Array<{tier: "hard"|"soft", label: string, re: RegExp}>} */
export const PATTERNS = [
  {
    tier: "hard",
    label: "private key block",
    re: /-----BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
  },
  { tier: "hard", label: "AWS access key ID", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { tier: "hard", label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    tier: "hard",
    label: "GitHub token",
    re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  },
  {
    tier: "hard",
    label: "Stripe live key",
    re: /\b(sk|pk)_live_[A-Za-z0-9]{10,}\b/,
  },
  { tier: "hard", label: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    tier: "hard",
    label: "Anthropic/OpenAI-shaped API key",
    re: /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    tier: "hard",
    label: "JWT-shaped token",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    tier: "soft",
    label: "connection string with embedded credential",
    re: /(postgres|postgresql|mysql|mongodb)(\+[a-z]+)?:\/\/[^:/\s"']+:[^@/\s"']+@/,
  },
  {
    tier: "soft",
    label: "env-var-shaped secret assignment",
    // No leading \b: real env-var names commonly carry the keyword as a
    // SUFFIX after an underscore (AUTH_SECRET, SEED_ADMIN_PASSWORD), and `_`
    // is a word character, so `\bSECRET` would never match there.
    re: /(SECRET|PASSWORD|API_KEY|PRIVATE_KEY|ACCESS_TOKEN|CLIENT_SECRET)\s*[:=]\s*['"`]?[A-Za-z0-9+/=_-]{12,}['"`]?/,
  },
  {
    tier: "soft",
    label: "SSN-shaped number",
    re: /\b\d{3}-\d{2}-\d{4}\b/,
  },
  {
    tier: "soft",
    label: "phone-number-shaped value outside the 555 fake-number convention",
    // The project's own fake-number convention puts 555 in the EXCHANGE
    // (middle) group — NXX-555-XXXX — not the area code, so the negative
    // lookahead has to guard the second \d{3}, not the first.
    re: /\(?\b\d{3}\)?[-. ](?!555\b)\d{3}[-. ]\d{4}\b/,
  },
];

// Obvious placeholder values a SOFT secret-assignment match should not flag.
// Note: HARD connection-string findings are matched by the PATTERNS entry
// above regardless of this list — a real user:password@host pair is a real
// finding even if the password happens to contain one of these substrings.
export const PLACEHOLDER_VALUE_RE =
  /xxxx|changeme|your[-_]|<[a-z_-]+>|example|redacted|password123|\$\{|process\.env|ci:ci@localhost|fixture|do-not-use|not-a-secret|_TEST_SECRET\b/i;

/**
 * Pure core. `files` is `Array<{ path: string, content: string }>`.
 * Returns `Array<{ file, line, tier, label, text }>`.
 */
export function checkSecretsPii(files) {
  const violations = [];

  for (const { path: file, content } of files) {
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prevLine = i > 0 ? lines[i - 1] : "";

      for (const { tier, label, re } of PATTERNS) {
        if (!re.test(line)) continue;

        if (tier === "soft") {
          if (PLACEHOLDER_VALUE_RE.test(line)) continue;
          if (OK_RE.test(line) || OK_RE.test(prevLine)) continue;
        }
        // HARD findings never look at the annotation or the placeholder
        // list — a real private key or a real embedded-credential
        // connection string is a finding regardless of a nearby comment.

        violations.push({
          file,
          line: i + 1,
          tier,
          label,
          text: line.trim().slice(0, 160),
        });
      }

      // Email-domain allowlist check (kept separate from PATTERNS since
      // it's an allowlist-of-safe rather than a pattern-of-bad).
      for (const m of line.matchAll(
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
      )) {
        const email = m[0];
        if (SAFE_EMAIL_DOMAIN_RE.test(email)) continue;
        if (GIT_REMOTE_EMAIL_RE.test(email)) continue;
        const localPart = email.slice(0, email.indexOf("@"));
        if (CONNECTION_STRING_LOCAL_PART_RE.test(localPart)) continue;
        if (OK_RE.test(line) || OK_RE.test(prevLine)) continue;

        violations.push({
          file,
          line: i + 1,
          tier: "soft",
          label: `email outside the safe-domain allowlist (${email})`,
          text: line.trim().slice(0, 160),
        });
      }
    }
  }

  return violations;
}

function isMain() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

  const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !BINARY_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .filter((f) => f !== SELF_TEST_EXEMPT_PATH);

  const files = [];
  for (const file of tracked) {
    try {
      files.push({ path: file, content: readFileSync(path.join(ROOT, file), "utf8") });
    } catch {
      // deleted-but-still-tracked race, or genuinely unreadable — not this script's job
    }
  }

  const violations = checkSecretsPii(files);

  if (violations.length > 0) {
    const hard = violations.filter((v) => v.tier === "hard");
    const soft = violations.filter((v) => v.tier === "soft");

    console.error("Secrets & PII guard FAILED:\n");

    if (hard.length > 0) {
      console.error(
        `${hard.length} HARD finding(s) — these must never appear in this repo, no exemption exists:\n`,
      );
      for (const v of hard) {
        console.error(`  ${v.file}:${v.line} — ${v.label}`);
        console.error(`  > ${v.text}`);
        console.error("");
      }
    }

    if (soft.length > 0) {
      console.error(
        `${soft.length} SOFT finding(s) — likely real, but review before dismissing:\n`,
      );
      for (const v of soft) {
        console.error(`  ${v.file}:${v.line} — ${v.label}`);
        console.error(`  > ${v.text}`);
        console.error("");
      }
      console.error(
        "  If a soft finding is a genuine false positive (a documented safe\n" +
          "  fixture domain, a value that is already a placeholder your own\n" +
          "  regex missed, etc.), annotate the SAME line or the line ABOVE with:\n" +
          "    // leak-ok: <reason>          (code)\n" +
          "    <!-- leak-ok: <reason> -->    (Markdown)\n" +
          "  Never annotate to suppress a real finding — fix or redact it instead.\n",
      );
    }

    process.exit(1);
  }

  console.log("Secrets & PII guard passed.");
}
