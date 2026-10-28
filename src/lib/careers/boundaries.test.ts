/**
 * Source-scan boundaries for the careers feature - docs/work-log/2026-10-25-careers-inc1.md,
 * Phase 3 T24. Each is a property the type system and the database cannot see and
 * review would only catch by luck. Directories Batch 3 creates are scanned when they
 * exist, so the scans hold as the UI lands.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const isTest = (file: string) => /\.test\.(ts|tsx)$/.test(file) || file.includes(`${path.sep}testing${path.sep}`);
const rel = (file: string) => path.relative(ROOT, file);
const read = (file: string) => readFileSync(file, "utf8");

/** Application (non-test) files, optionally within directories. */
function appFiles(...dirs: string[]): string[] {
  return dirs.flatMap((d) => walk(path.join(SRC, d))).filter((f) => !isTest(f));
}

/** Source with comments removed, so a scan never trips on the prose that explains the rule. */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Everything that is careers UI or careers lib: scanned for the content-injection and dialog rules. */
function careersSurface(): string[] {
  const publicTree = walk(path.join(SRC, "app/(public)/site/[slug]")).filter(
    (f) => /[\\/]careers[\\/]/.test(f) || /careers-slot\.tsx$/.test(f),
  );
  const staffTree = walk(path.join(SRC, "app/(org)/o/[slug]/admin/careers"));
  return [
    ...walk(path.join(SRC, "lib/careers")),
    ...walk(path.join(SRC, "components/careers")),
    ...publicTree,
    ...staffTree,
  ].filter((f) => !isTest(f));
}

describe("T24 - two hierarchies: no platform page reads careers data", () => {
  it("nothing under (admin) or admin-portal imports the careers lib or its schema", () => {
    const offenders = appFiles("app/(admin)", "lib/admin-portal", "components/admin-portal").filter((file) =>
      /@\/lib\/careers|@\/lib\/db\/domain\/careers|\blib\/careers\b/.test(read(file)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no platform-axis dashboard reader or boundary list names job_postings", () => {
    const offenders = appFiles("lib/admin-portal", "app/(admin)").filter((file) => /job_postings|jobPostings/.test(read(file)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("T24 - the platform connection", () => {
  it("getPlatformDb appears in src/lib/careers/ only in sweep.ts", () => {
    const users = walk(path.join(SRC, "lib/careers"))
      .filter((f) => !isTest(f))
      .filter((f) => /getPlatformDb/.test(code(f)))
      .map((f) => path.basename(f));
    expect(users).toEqual(["sweep.ts"]);
  });

  it("no careers UI file (components, public routes, staff pages) uses the platform connection", () => {
    const offenders = careersSurface()
      .filter((f) => !f.includes(`${path.sep}lib${path.sep}careers${path.sep}`))
      .filter((f) => /getPlatformDb/.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("T24 - job_postings has one writer module", () => {
  it("only src/lib/careers/postings.ts, public.ts-free sweep.ts and the Drizzle mirror name the table in application code", () => {
    const named = appFiles("lib", "app", "components")
      .filter((f) => /\bjob_postings\b|\bjobPostings\b/.test(code(f)))
      .map(rel)
      // dev-docs.ts only files the table under a /developer module heading
      // (dev-docs.test.ts requires every table classified, F338); it reads no row.
      .filter((f) => f !== "src/lib/dev-docs.ts")
      .sort();
    expect(named).toEqual(["src/lib/careers/postings.ts", "src/lib/db/domain/careers.ts"].sort());
  });

  it("the sweep reaches the table only through its definer", () => {
    const sweep = code(path.join(SRC, "lib/careers/sweep.ts"));
    expect(sweep).toContain("presby_careers_sweep");
    expect(sweep).not.toMatch(/job_postings|jobPostings/);
  });

  it("nothing deletes a posting (all deletes are soft, D12) and no SQL deletes from the table", () => {
    for (const file of appFiles("lib", "app", "components")) {
      const text = code(file);
      expect(text, rel(file)).not.toMatch(/\.delete\(\s*jobPostings\s*\)/);
      expect(text, rel(file)).not.toMatch(/delete\s+from\s+"?job_postings/i);
    }
  });

  it("nothing inserts through Drizzle's .insert(jobPostings): it lists every column and presby_app's grant refuses it", () => {
    for (const file of appFiles("lib", "app", "components")) {
      expect(code(file), rel(file)).not.toMatch(/\.insert\(\s*jobPostings\s*\)/);
    }
  });

  it("the Drizzle mirror gives no column an $onUpdate (updated_at is trigger-owned and outside the UPDATE grant)", () => {
    expect(code(path.join(SRC, "lib/db/domain/careers.ts"))).not.toContain("$onUpdate");
  });

  it("no code names a trigger-owned column in a write (.set / insert column list)", () => {
    const text = code(path.join(SRC, "lib/careers/postings.ts"));
    const sets = [...text.matchAll(/\.set\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]!);
    expect(sets.length).toBeGreaterThan(0);
    for (const body of sets) {
      expect(body).not.toMatch(/\b(version|postedOn|firstPublishedAt|closedAt|createdBy|createdAt|updatedAt|organizationId|id)\s*:/);
    }
    const insert = text.match(/insert into job_postings \(([\s\S]*?)\) values/)?.[1] ?? "";
    expect(insert).not.toMatch(/\b(id|status|sort_order|version|posted_on|first_published_at|closed_at|created_at|updated_at)\b/);
  });
});

describe("T24 - every status writer audits", () => {
  const text = code(path.join(SRC, "lib/careers/postings.ts"));

  it("each .set({ status ... }) in the staff lib is followed, in the same function, by insertAuditRow", () => {
    const writers = [...text.matchAll(/\.set\(\{\s*status\b/g)];
    expect(writers.length).toBe(1); // setPostingStatus is the ONE status writer
    for (const writer of writers) {
      const after = text.slice(writer.index!);
      const nextFunction = after.slice(1).search(/\nexport async function |\nasync function |\nfunction /);
      const body = nextFunction === -1 ? after : after.slice(0, nextFunction + 1);
      expect(body).toContain("insertAuditRow(tx");
    }
  });

  it("the three audit keys are all written by it, the discard edge writes none, and the metadata is ids and an enum", () => {
    expect(text).toContain("AUDIT_ACTIONS.CAREERS_POSTING_PUBLISHED");
    expect(text).toContain("AUDIT_ACTIONS.CAREERS_POSTING_CLOSED");
    expect(text).toContain("AUDIT_ACTIONS.CAREERS_POSTING_REOPENED");
    // The discard edge maps to no action at all (the comment naming why is stripped from `text`).
    expect(read(path.join(SRC, "lib/careers/postings.ts"))).toMatch(/: null; \/\/ discard: nothing was ever public/);
    expect(text).toMatch(/if \(action !== null\)/);
    expect(text).toMatch(/metadata: \{ organizationId, postingId: current\.id, via: "staff" \}/);
  });

  it("the sweep audits each close with a null actor and via closing_date, and nothing else writes the status", () => {
    const sweep = code(path.join(SRC, "lib/careers/sweep.ts"));
    expect(sweep).toContain("CAREERS_POSTING_CLOSED");
    expect(sweep).toMatch(/actor: null/);
    expect(sweep).toContain('via: "closing_date"');
  });

  it("insertAuditRow is the same-transaction writer: recordAudit (its own connection, failures swallowed) is not used for these rows", () => {
    for (const file of [path.join(SRC, "lib/careers/postings.ts"), path.join(SRC, "lib/careers/sweep.ts")]) {
      expect(code(file), rel(file)).not.toMatch(/\brecordAudit\b/);
    }
  });
});

describe("T24 - content injection and dialogs", () => {
  it("no dangerouslySetInnerHTML anywhere in the careers surface", () => {
    const offenders = careersSurface().filter((f) => /dangerouslySetInnerHTML/.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no toLocale* or Intl date formatting (ui-standards: static names only)", () => {
    const offenders = careersSurface().filter((f) => /\.toLocale\w*\(|new Intl\.DateTimeFormat|Intl\.DateTimeFormat/.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no native browser dialogs", () => {
    const offenders = careersSurface().filter((f) => /(^|[^\w.])(alert|confirm|prompt)\s*\(/.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no console.log in production paths (the cron's structured log lives in the route, not here)", () => {
    const offenders = careersSurface().filter((f) => /console\.log\(/.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no date-typed sql template (the check:sql-date tripwire's subject) in the careers lib", () => {
    // Built from parts so this file does not itself trip the tripwire it mirrors.
    const banned = new RegExp(`sql<\\s*${"Da"}${"te"}`);
    const offenders = careersSurface().filter((f) => banned.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("T24 - the anonymous reader", () => {
  it("public.ts uses the anonymous db connection and names no platform connection, no org context, no session", () => {
    const text = code(path.join(SRC, "lib/careers/public.ts"));
    expect(text).toContain('from "@/lib/db"');
    expect(text).not.toMatch(/getPlatformDb|withOrgContext|auth\(\)|cookies\(|headers\(/);
    expect(text).not.toMatch(/unstable_cache|use cache/);
  });

  it("the staff lib never runs outside withOrgContext", () => {
    const text = code(path.join(SRC, "lib/careers/postings.ts"));
    expect(text).toContain("withOrgContext(");
    expect(text).not.toMatch(/from "@\/lib\/db"\s*;?\s*$/m);
    expect(text).not.toMatch(/getPlatformDb/);
  });
});
