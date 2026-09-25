#!/usr/bin/env node
/**
 * Audit-coverage check. CLAUDE.md says "security-sensitive mutations write to
 * auditEvents." This script gives that invariant teeth.
 *
 * Heuristic: any `actions.ts` under `src/app/` that contains a mutating DB
 * call (`db.insert`, `db.update`, `db.delete`) MUST also contain at least one
 * `auditEvents` insert. Files can opt out per-action with an exempt comment:
 *
 *     // audit-exempt: <reason>
 *
 * placed on the line above the mutation. The exempt comment is captured in the
 * grep — review them at the 30-day security review.
 *
 * Not a proof; just a tripwire. Catches the case where someone adds a new
 * mutation and forgets the audit row.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src", "app");

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name === "actions.ts" || e.name === "actions.tsx") yield full;
  }
}

// Allow whitespace/newlines between `db`, `.`, and the verb — multi-line
// fluent calls are common.
//
// `execute` is included alongside insert/update/delete (added
// docs/work-log/2026-09-25-submission-grants.md, Phase 2/3 ruling 11):
// src/app/(statistics-submit)/actions.ts calls a SECURITY DEFINER function
// via `db.execute(sql`select presby_submit_granted_return(...)`)`, which is a
// real mutation this regex previously could not see at all — the tripwire
// would have passed that file whether or not recordAudit() was present.
// Verified tree-wide at the time of the extension to be a no-op everywhere
// else: the only other `.execute(`-bearing `actions.ts` under `src/app/` was
// `(admin)/admin/2fa/actions.ts`, which already calls `recordAudit`.
const MUTATION_RE = /\bdb\s*\.\s*(insert|update|delete|execute)\b/;
const AUDIT_RE = /\bauditEvents\b|\brecordAudit\b/;
const EXEMPT_RE = /\/\/\s*audit-exempt:/i;

const failures = [];

for await (const file of walk(SRC)) {
  const src = await fs.readFile(file, "utf8");
  if (!MUTATION_RE.test(src)) continue;

  // Strip lines whose previous line is an `// audit-exempt:` comment before
  // re-checking. Heuristic but readable.
  const lines = src.split("\n");
  const filtered = lines
    .map((l, i) => {
      const prev = lines[i - 1] ?? "";
      return EXEMPT_RE.test(prev) ? "" : l;
    })
    .join("\n");
  if (!MUTATION_RE.test(filtered)) continue;

  if (!AUDIT_RE.test(src)) {
    failures.push({
      file: path.relative(ROOT, file),
      reason:
        "file contains DB mutations but no auditEvents insert or recordAudit call. Add one or annotate with `// audit-exempt: <reason>` above the mutation.",
    });
  }
}

if (failures.length > 0) {
  console.error("Audit-coverage check FAILED:");
  for (const f of failures) {
    console.error(`  ${f.file}: ${f.reason}`);
  }
  process.exit(1);
}

console.log("Audit-coverage check passed.");
