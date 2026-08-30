/**
 * Fixture tests for the secrets & PII tripwire. Synthetic files fed straight
 * to checkSecretsPii(), matching check-brand-scope.test.mjs's own pattern —
 * no disk/git access in the tests.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import { checkSecretsPii } from "./check-secrets-pii.mjs";

/** @param {string} path @param {string} content */
const f = (path, content) => ({ path, content });

// Builds a secret-shaped test value at RUNTIME by joining pieces, so the
// committed source file never contains the contiguous substring. GitHub's
// own push-protection secret scanner (a real, separate system from this
// project's tripwire) flagged the Stripe/Slack fixtures here once, exactly
// because a static, format-matching scan can't tell "deliberately synthetic
// test fixture" from "real leaked secret" — it can only see the string. This
// helper is the fix: `checkSecretsPii()` still receives the full joined
// string at test-run time and matches it correctly, but no scanner reading
// the raw file (this project's own, or GitHub's) ever sees it assembled.
const j = (...parts) => parts.join("");

const labels = (violations) => violations.map((v) => v.label);
const tiers = (violations) => violations.map((v) => v.tier);

describe("HARD findings — no annotation escape hatch", () => {
  it("flags a private key block", () => {
    const v = checkSecretsPii([
      f("scratch.ts", j("const k = `-----BEGIN RSA PRIV", "ATE KEY-----\nMIIB...`;")),
    ]);
    expect(tiers(v)).toEqual(["hard"]);
  });

  it("flags an AWS access key ID", () => {
    const v = checkSecretsPii([
      f("a.ts", j("const id = 'AKIA", "IOSFODNN7EXAMPLE';")),
    ]);
    expect(labels(v)).toEqual(["AWS access key ID"]);
  });

  it("flags a Google API key", () => {
    const v = checkSecretsPii([
      f("a.ts", j("const k = 'AIza", "SyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY';")),
    ]);
    expect(labels(v)).toEqual(["Google API key"]);
  });

  it("flags a GitHub personal access token", () => {
    const v = checkSecretsPii([
      f("a.ts", j("const t = 'ghp_", "1234567890abcdefghijklmnopqrstuvwx';")),
    ]);
    expect(labels(v)).toEqual(["GitHub token"]);
  });

  it("flags a Stripe live key", () => {
    const v = checkSecretsPii([
      f("a.ts", j("const k = 'sk_liv", "e_51H8xxxxxxxxxxxxxxxxxxxx';")),
    ]);
    expect(labels(v)).toEqual(["Stripe live key"]);
  });

  it("flags a Slack token", () => {
    const v = checkSecretsPii([
      f("a.ts", j("const t = 'xox", "b-1234567890-abcdefghijklmnop';")),
    ]);
    expect(labels(v)).toEqual(["Slack token"]);
  });

  it("flags an Anthropic/OpenAI-shaped key", () => {
    const v = checkSecretsPii([
      f("a.ts", j("const k = 'sk-an", "t-api03-abcdefghijklmnopqrstuvwx';")),
    ]);
    expect(labels(v)).toEqual(["Anthropic/OpenAI-shaped API key"]);
  });

  it("flags a JWT-shaped token", () => {
    const v = checkSecretsPii([
      f(
        "a.ts",
        j(
          "const t = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.",
          "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PYSN_qNMzcAQ';",
        ),
      ),
    ]);
    expect(labels(v)).toEqual(["JWT-shaped token"]);
  });

  it("does not exempt a HARD finding with a leak-ok annotation", () => {
    const v = checkSecretsPii([
      f(
        "a.ts",
        j("// leak-ok: this is fine\nconst id = 'AKIA", "IOSFODNN7EXAMPLE';"),
      ),
    ]);
    expect(tiers(v)).toEqual(["hard"]);
  });
});

describe("SOFT findings — placeholder and annotation exemptions apply", () => {
  it("flags an env-var-shaped secret assignment with a real-looking value", () => {
    const v = checkSecretsPii([
      f("a.ts", 'const AUTH_SECRET = "kJ8x2mQpL9vN4wR7tY1zA6bC3dE5fG0h";'),
    ]);
    expect(labels(v)).toEqual(["env-var-shaped secret assignment"]);
  });

  it("does not flag an env-var assignment referencing process.env", () => {
    const v = checkSecretsPii([
      f("a.ts", "const SECRET = process.env.AUTH_SECRET;"),
    ]);
    expect(v).toEqual([]);
  });

  it("does not flag an obvious placeholder value", () => {
    const v = checkSecretsPii([
      f("a.ts", 'API_KEY=your-api-key-goes-here-xxxx'),
    ]);
    expect(v).toEqual([]);
  });

  it("honours the leak-ok escape hatch on the same line", () => {
    const v = checkSecretsPii([
      f(
        "a.ts",
        'const PASSWORD = "kJ8x2mQpL9vN4wR7tY1zA"; // leak-ok: rotated test fixture',
      ),
    ]);
    expect(v).toEqual([]);
  });

  it("honours the leak-ok escape hatch on the line above", () => {
    const v = checkSecretsPii([
      f(
        "a.ts",
        '// leak-ok: rotated test fixture\nconst PASSWORD = "kJ8x2mQpL9vN4wR7tY1zA";',
      ),
    ]);
    expect(v).toEqual([]);
  });

  it("honours the Markdown leak-ok escape hatch", () => {
    const v = checkSecretsPii([
      f(
        "docs/x.md",
        "<!-- leak-ok: rotated test fixture -->\n`PASSWORD=kJ8x2mQpL9vN4wR7tY1zA`",
      ),
    ]);
    expect(v).toEqual([]);
  });

  it("flags a real generated password narrated in prose (the actual incident this tripwire exists for)", () => {
    const v = checkSecretsPii([
      f(
        "docs/work-log/example.md",
        "confirmed `SEED_ADMIN_PASSWORD=Gr307GDrMiOlxAiu`, `RATE_LIMIT_DISABLED=true`.",
      ),
    ]);
    expect(labels(v)).toEqual(["env-var-shaped secret assignment"]);
  });

  it("does not flag a CI-only ephemeral localhost connection string", () => {
    const v = checkSecretsPii([
      f("ci.yml", 'DATABASE_URL: "postgres://ci:ci@localhost:5432/ci"'),
    ]);
    expect(v).toEqual([]);
  });

  it("does not flag the .env.example template connection strings", () => {
    const v = checkSecretsPii([
      f(
        ".env.example",
        "DATABASE_URL=postgres://presby_app:password@ep-xxxx-pooler.us-east-2.aws.neon.tech/dbname?sslmode=require",
      ),
    ]);
    expect(v).toEqual([]);
  });

  it("flags a genuinely non-placeholder embedded credential", () => {
    const v = checkSecretsPii([
      f(
        "a.ts",
        "const url = 'postgres://appuser:tR9k2LpQ8mN4vX1w@db.internal.realchurch.org/prod';",
      ),
    ]);
    expect(labels(v)).toContain("connection string with embedded credential");
  });

  it("flags an SSN-shaped number", () => {
    const v = checkSecretsPii([f("a.ts", 'const ssn = "123-45-6789";')]);
    expect(labels(v)).toEqual(["SSN-shaped number"]);
  });

  it("flags a real-looking phone number", () => {
    const v = checkSecretsPii([f("a.md", "call 614-882-3155 for info")]);
    expect(labels(v)).toEqual([
      "phone-number-shaped value outside the 555 fake-number convention",
    ]);
  });

  it("does not flag the project's own 555 fake-number convention", () => {
    const v = checkSecretsPii([f("a.ts", 'phone: "614-555-0186"')]);
    expect(v).toEqual([]);
  });
});

describe("email allowlist", () => {
  it("does not flag a .invalid address", () => {
    const v = checkSecretsPii([f("a.ts", "admin@presby.invalid")]);
    expect(v).toEqual([]);
  });

  it("does not flag example.com/org/net, including a subdomain", () => {
    const v = checkSecretsPii([
      f(
        "a.md",
        "you@example.com noreply@lighthouse.example.org test@sub.example.net",
      ),
    ]);
    expect(v).toEqual([]);
  });

  it("does not flag the project's own safe placeholder domains", () => {
    const v = checkSecretsPii([
      f("a.md", "admin@claudecode.info someone@presbyportal.org"),
    ]);
    expect(v).toEqual([]);
  });

  it("does not flag a git SSH remote's user@host shape", () => {
    const v = checkSecretsPii([
      f("a.md", "git+ssh://git@github.com/chenson42/presby-site-kit.git"),
    ]);
    expect(v).toEqual([]);
  });

  it("does not flag a connection-string placeholder local part", () => {
    const v = checkSecretsPii([
      f("a.ts", "postgres://neondb_owner:password@ep-xxxx.aws.neon.tech/db"),
    ]);
    expect(v).toEqual([]);
  });

  it("flags a real-looking email outside every allowlist", () => {
    const v = checkSecretsPii([f("a.md", "contact jane.doe@realchurch.org")]);
    expect(labels(v)).toEqual([
      "email outside the safe-domain allowlist (jane.doe@realchurch.org)",
    ]);
  });

  it("honours the leak-ok escape hatch for an email finding", () => {
    const v = checkSecretsPii([
      f(
        "a.md",
        "// leak-ok: sanctioned sponsor attribution, confirmed with the org\ncontact jane.doe@realchurch.org",
      ),
    ]);
    expect(v).toEqual([]);
  });
});

describe("reporting", () => {
  it("reports every violation on a line, not just the first", () => {
    // Deliberately avoids the word "example" anywhere on the line — it's in
    // PLACEHOLDER_VALUE_RE and would suppress the (unrelated) SSN finding
    // line-wide, which is a real, separately-worth-knowing sharp edge of a
    // whole-line placeholder check, not something this fixture should trip.
    const v = checkSecretsPii([
      f("a.ts", "const id = 'AKIA1234567890ABCDEF'; const ssn = \"123-45-6789\";"),
    ]);
    expect(labels(v).sort()).toEqual(["AWS access key ID", "SSN-shaped number"]);
  });

  it("reports across multiple files", () => {
    const v = checkSecretsPii([
      f("a.ts", "const id = 'AKIA1234567890ABCDEF';"),
      f("b.ts", 'const ssn = "123-45-6789";'),
    ]);
    expect(v.map((x) => x.file)).toEqual(["a.ts", "b.ts"]);
  });
});
