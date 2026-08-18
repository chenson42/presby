#!/usr/bin/env node
/**
 * sql<Date> guard. Drizzle's sql<T> tag on a COMPUTED expression (e.g.
 * COALESCE, date_trunc, NOW()) lies at runtime: the Neon serverless driver
 * returns the value as a STRING, not a Date, because there is no column OID to
 * map against. TypeScript cannot catch this — the generic is a compile-time
 * cast, not a runtime conversion.
 *
 * This script scans src/**\/*.{ts,tsx} for any `sql<Date` pattern (covers
 * sql<Date>, sql<Date | null>, sql<Date | undefined>, etc.) and requires one of:
 *   1. A `// sql-date-ok: <reason>` comment on the SAME line, or
 *   2. A `// sql-date-ok: <reason>` comment on the line DIRECTLY ABOVE.
 *
 * Any occurrence that lacks an annotation is a violation. Fix by:
 *   - Selecting the real timestamp column(s) and computing the Date in JS, or
 *   - Using Drizzle's .mapWith() to teach the driver the type, or
 *   - Annotating with `// sql-date-ok: <reason>` when the expression is used
 *     ONLY in WHERE/ORDER clauses and is never selected/returned to JS.
 *
 * Motivating incident: a `sql<Date>` on a COALESCE expression typed the value
 * as Date at compile time but returned a string at runtime; calling `.getTime()`
 * on it threw TypeError at runtime. tsc cannot catch this. This script gives
 * that class of bug a tripwire.
 *
 * Not a proof; just a tripwire. Comment-only lines (lines whose trimmed form
 * starts with `//`) are skipped — test-file references in JSDoc are not code.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

// ROOT is the repo root (one level up from scripts/).
const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src");

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) yield full;
  }
}

// Match sql<Date (covers sql<Date>, sql<Date | null>, sql<Date | undefined>…)
const SQL_DATE_RE = /sql<\s*Date\b/;
// Annotation that exempts the line (case-insensitive for robustness)
const OK_RE = /\/\/\s*sql-date-ok:/i;

const violations = [];

for await (const file of walk(SRC)) {
  const src = await fs.readFile(file, "utf8");
  const lines = src.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comment-only lines — mentions of sql<Date> in JSDoc / inline comments
    // are not code and should not trigger a violation.
    if (line.trim().startsWith("//")) continue;

    if (!SQL_DATE_RE.test(line)) continue;

    // Found sql<Date in actual code. Check for annotation:
    //   - same line (inline comment after the expression), or
    //   - the line directly above (a stand-alone annotation comment).
    const prevLine = i > 0 ? lines[i - 1] : "";
    if (OK_RE.test(line) || OK_RE.test(prevLine)) continue;

    violations.push({
      file: path.relative(ROOT, file),
      line: i + 1,
      text: line.trim().slice(0, 120),
    });
  }
}

if (violations.length > 0) {
  console.error("sql<Date> guard FAILED — unannotated occurrence(s):\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`  > ${v.text}`);
    console.error("");
    console.error(
      "  Why this matters: sql<Date> on a computed expression (e.g. COALESCE,",
    );
    console.error(
      "  date_trunc) returns a STRING at runtime (Neon). tsc cannot catch this.",
    );
    console.error("");
    console.error("  Fix options:");
    console.error(
      "    1. Select the real timestamp columns; compute the Date in JS.",
    );
    console.error("    2. Use .mapWith(Date) on the column expression.");
    console.error(
      "    3. If this sql<Date> is used ONLY in WHERE/ORDER and is never",
    );
    console.error(
      "       selected or returned to JS, annotate it with:",
    );
    console.error(
      "         // sql-date-ok: SQL-side only (WHERE/ORDER); never selected/returned to JS",
    );
    console.error("");
  }
  process.exit(1);
}

console.log("sql<Date> guard passed.");
