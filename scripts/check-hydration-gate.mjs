#!/usr/bin/env node
/**
 * Hydration-gate guard (DECISION-159, F116).
 *
 * react-hook-form's `register()` writes `defaultValues` over the live DOM when
 * it attaches during hydration, so anything a user types or picks before the
 * page's JavaScript has run is silently overwritten (F116: a congregation's
 * annual statistics saved against the wrong congregation). The fix is that
 * every form root calling `useForm` is wrapped in `<HydrationGate>`
 * (`src/components/shared/hydration-gate.tsx`), which keeps the form disabled
 * until the client has hydrated. This tripwire stops the 19th form regressing
 * silently.
 *
 * Rules:
 *
 *   H1 — a non-test `.ts`/`.tsx` file under src/ that calls `useForm(` or
 *        `useForm<...>(` on a non-comment line must ALSO import `HydrationGate`
 *        from "@/components/shared/hydration-gate" AND render `<HydrationGate`
 *        (both on non-comment lines).
 *   H2 — a `.ts` (non-`.tsx`) file that calls `useForm` can never render the
 *        gate itself (the "move the call into a custom hook" bypass), so it
 *        fails unless exempted.
 *
 * Exemption: `// hydration-gate-ok: <reason>` on the SAME line as the
 * `useForm` call or on the line directly above. The reason is mandatory. A
 * file passes if every call is exempted, or if the gate import and element are
 * present. Use it only for a deliberately client-only, never-SSR'd form.
 *
 * Not a proof; just a tripwire. It sees PRESENCE, not that the gate actually
 * wraps the controls (the SSR wiring tests, code review and a browser pass
 * cover that). `useFormState(`, `useFormStatus(` and `useFormContext(` are not
 * matched.
 *
 * Exported for unit-testing:
 *   checkHydrationGate(files) -> violations[]
 *   where files is Array<{ path: string, content: string }> with POSIX paths
 *   relative to the repo root.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src");

const CALL_RE = /(?<![A-Za-z0-9_$])useForm\s*[<(]/;
const IMPORT_RE = /from\s+["']@\/components\/shared\/hydration-gate["']/;
const ELEMENT_RE = /<HydrationGate[\s>]/;
const EXEMPT_RE = /\/\/\s*hydration-gate-ok:\s*(\S.*)$/;
const EXEMPT_NO_REASON_RE = /\/\/\s*hydration-gate-ok:\s*$/;

/** Lines whose trimmed form starts with a comment opener are not code. */
export function isCommentLine(line) {
  const t = line.trim();
  return (
    t.startsWith("//") ||
    t.startsWith("/*") ||
    t.startsWith("*") ||
    t.startsWith("{/*")
  );
}

function isTestFile(rel) {
  return /\.test\.tsx?$/.test(rel);
}

/**
 * @param {Array<{ path: string, content: string }>} files
 * @returns {Array<{ rule: string, file: string, line: number, message: string, text?: string }>}
 */
export function checkHydrationGate(files) {
  const violations = [];

  for (const file of files) {
    const rel = file.path;
    if (!/\.tsx?$/.test(rel) || isTestFile(rel)) continue;

    const lines = file.content.split("\n");
    const calls = [];
    let hasImport = false;
    let hasElement = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      if (IMPORT_RE.test(line)) hasImport = true;
      if (ELEMENT_RE.test(line)) hasElement = true;
      if (CALL_RE.test(line)) calls.push(i);
    }
    if (calls.length === 0) continue;

    const gated = hasImport && hasElement;
    const isTsx = rel.endsWith(".tsx");

    for (const i of calls) {
      const here = lines[i];
      const above = lines[i - 1] ?? "";
      const exempt = EXEMPT_RE.test(here) || EXEMPT_RE.test(above);
      const emptyReason =
        !exempt && (EXEMPT_NO_REASON_RE.test(here) || EXEMPT_NO_REASON_RE.test(above));
      const at = { file: rel, line: i + 1, text: here.trim().slice(0, 120) };

      if (exempt) continue;

      if (emptyReason) {
        violations.push({
          rule: isTsx ? "H1" : "H2",
          ...at,
          message:
            "`// hydration-gate-ok:` needs a reason after the colon. Say why this form is never server-rendered.",
        });
        continue;
      }

      if (!isTsx) {
        violations.push({
          rule: "H2",
          ...at,
          message:
            "a .ts file calls useForm, so it cannot render <HydrationGate> itself. Call useForm in the .tsx form root and wrap it there (DECISION-159), or annotate with `// hydration-gate-ok: <reason>`.",
        });
        continue;
      }

      if (!gated) {
        const missing = [
          ...(hasImport ? [] : ["the import from @/components/shared/hydration-gate"]),
          ...(hasElement ? [] : ["a <HydrationGate> element"]),
        ].join(" and ");
        violations.push({
          rule: "H1",
          ...at,
          message: `this file calls useForm but lacks ${missing}. A react-hook-form form must be inoperable until it hydrates (DECISION-159; docs/ui-standards.md, Forms — State Patterns). Wrap the <form> in <HydrationGate>, or annotate with \`// hydration-gate-ok: <reason>\`.`,
        });
      }
    }
  }

  return violations;
}

// ── Script entry point ───────────────────────────────────────────────────────

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) yield full;
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-hydration-gate.mjs");

if (isMain) {
  const files = [];
  for await (const file of walk(SRC)) {
    files.push({
      path: path.relative(ROOT, file).split(path.sep).join("/"),
      content: await fs.readFile(file, "utf8"),
    });
  }

  const violations = checkHydrationGate(files);

  if (violations.length > 0) {
    console.error("Hydration-gate check FAILED:\n");
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.file}:${v.line}`);
      if (v.text) console.error(`  > ${v.text}`);
      console.error(`  ${v.message}`);
      console.error("");
    }
    console.error(
      "  Why this matters: react-hook-form overwrites what a user typed or picked",
    );
    console.error(
      "  before hydration finished, silently (F116, DECISION-159).",
    );
    console.error("");
    process.exit(1);
  }

  console.log("Hydration-gate check passed.");
}
