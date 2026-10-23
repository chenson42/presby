/**
 * Source scan: the zod 4 conventions that nothing else would catch
 * (docs/work-log/2026-10-23-zod-4.md, Phase 2 Ruling 1 and 2, DECISION-223).
 * Same shape as the `SiteUrls` scan in `site-urls.test.ts`; deliberately not a
 * ninth `npm run check` tripwire.
 *
 *   - `.uuid(` is banned: zod 4's `.uuid()` demands a strict RFC 9562 UUID, and
 *     ids in shipped migrations (the built-in role ids, 00000000-...-0000000000N)
 *     and in the seeds are not. Use `z.guid()`, the same 8-4-4-4-12 hex shape as
 *     zod 3's `.uuid()` and `src/lib/is-uuid.ts`. (`isUuid(` is not a zod call
 *     and does not match.)
 *   - `ZodIssueCode`, `invalid_type_error` and `required_error` are zod 3 API
 *     (deprecated or removed in zod 4). Use `code: "custom"` and `{ error }`.
 *   - `zod/v3`, `zod/v4`, `zod/mini` and `zod/v4-mini` imports are banned: the
 *     `zod/v3` subpath still ships the unfixed array behaviour behind
 *     GHSA-mrhx-c7xc-m3w5 while `npm audit` reports the package as fixed.
 *
 * A branch that adds one of these fails here with the offending file:line.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");
const SELF = path.relative(SRC, __filename).split(path.sep).join("/");

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(name)) yield full;
  }
}

const RULES: Array<{ name: string; re: RegExp }> = [
  { name: ".uuid( (use z.guid())", re: /\.uuid\(/ },
  { name: "ZodIssueCode (use code: \"custom\")", re: /ZodIssueCode/ },
  { name: "invalid_type_error / required_error (use { error })", re: /\b(invalid_type_error|required_error)\b/ },
  { name: "zod subpath import", re: /["']zod\/(v3|v4|mini|v4-mini)(\/[^"']*)?["']/ },
];

const isCommentLine = (line: string): boolean => /^\s*(\/\/|\*|\/\*)/.test(line);

/** The rules a line breaks, or none for a comment-only line. */
function violations(line: string): string[] {
  if (isCommentLine(line)) return [];
  return RULES.filter((rule) => rule.re.test(line)).map((rule) => rule.name);
}

describe("source scan: zod 4 conventions", () => {
  const files = [...walk(SRC)].map((full) => ({ full, rel: path.relative(SRC, full).split(path.sep).join("/") }));

  it("walks a real tree (a vacuous pass would hide a broken scan)", () => {
    expect(files.length).toBeGreaterThan(100);
    const importsZod = files.filter((f) => /from "zod"/.test(readFileSync(f.full, "utf8")));
    expect(importsZod.length).toBeGreaterThan(10);
  });

  it("no .uuid(, ZodIssueCode, invalid_type_error, required_error or zod subpath import anywhere in src/", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.rel === SELF) continue;
      readFileSync(f.full, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const rule of violations(line)) offenders.push(`${f.rel}:${i + 1}  ${rule}  ${line.trim().slice(0, 100)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("the scan flags each banned form (self-test on synthetic lines)", () => {
    const banned = [
      "const a = z.string().uuid();",
      'const b = z.string().uuid("Choose a fund");',
      "const c = z.uuid();",
      "code: z.ZodIssueCode.custom,",
      "z.number({ invalid_type_error: 'x' })",
      "z.number({ required_error: 'x' })",
      'import { z } from "zod/v3";',
      "import { z } from 'zod/v4';",
      'import { z } from "zod/mini";',
      'import { z } from "zod/v4-mini";',
      'const m = await import("zod/v3");',
      'const r = require("zod/v4/core");',
    ];
    for (const line of banned) expect(violations(line).length, line).toBeGreaterThan(0);
  });

  it("the scan leaves the allowed forms and comments alone", () => {
    const allowed = [
      "const a = z.guid();",
      'const b = z.guid("Choose a fund");',
      "const c = z.email().max(320);",
      "if (isUuid(value)) return;",
      "const d = randomUUID();",
      'code: "custom",',
      'import { z } from "zod";',
      'import { zodResolver } from "@hookform/resolvers/zod";',
      "  // z.string().uuid() is banned here",
      "   * z.ZodIssueCode.custom is zod 3 API",
      "/* invalid_type_error */",
    ];
    for (const line of allowed) expect(violations(line), line).toEqual([]);
  });
});
