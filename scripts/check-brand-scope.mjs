#!/usr/bin/env node
/**
 * Brand-scope guard. DECISION-047 says per-org branding reaches exactly two
 * route groups — `(org)/o/[slug]` and `(public)/site/[slug]` — and nothing
 * else. Every other surface (`(auth)`, `(account)`, `(member)`, `(admin)`,
 * `(email-verify)`, `(password-reset)`, `access-pending`, `/launch`,
 * `/no-organization`, `/developer`) renders in the platform palette. That rule
 * is a *paper* invariant otherwise: nothing about the code stops a future
 * pipeline from painting the access-denied page in a congregation's colours,
 * which tells a prober the org is a configured tenant.
 *
 * The marker is the emitting component itself (DECISION-052): `<BrandTokens>`
 * IS the `:root`-scoped `<style>` element, so grep-presence and
 * behaviour-presence are one fact rather than two facts that can disagree.
 *
 * Four rules. E1, E3, C1 and, as of commit a8 (2026-08-19), C2 are live
 * tree-wide. E2 went live for `(org)/o/[slug]/layout.tsx` at commit c4
 * (2026-08-19) — that layout renders `<BrandTokens>` for real now. E2 stays
 * dormant for `(public)/site/[slug]/layout.tsx` and is flipped by a one-line
 * edit here once P3 creates that file:
 *
 *   E1 — emitter containment. `<BrandTokens` appears in no file outside
 *        EMITTERS. Live. At a1 it appears nowhere, so this is a ratchet placed
 *        before the thing it guards, which is the only time a ratchet is free.
 *   E2 — emitter presence. Each EMITTERS entry with `required: true` whose file
 *        exists must contain the marker. LIVE for `(org)/o/[slug]/layout.tsx`
 *        as of commit c4 (2026-08-19) — that layout now renders
 *        `<BrandTokens>` for real, and this rule is what stops a future edit
 *        from silently deleting it. Still DORMANT for `(public)/site/[slug]`:
 *        P3 has not created that file yet, so `required: true` there would
 *        fail on a file that does not exist rather than guard anything. A
 *        route group added later is un-brandable by default until someone
 *        edits this array, which is the point.
 *   E3 — no second emitter. No file under src/ outside src/components/brand/
 *        may contain `<style` or `dangerouslySetInnerHTML=`. Live, at zero
 *        violations today. This is what stops someone copy-pasting the <style>
 *        body into a third layout and sailing past a grep for the component
 *        name.
 *   C1 — brand-class containment. No `*-brand[-*]` utility outside the two
 *        brandable groups. Live, and vacuous until slice c introduces the
 *        additive `--brand-*` tokens — so its proof is the fixture test beside
 *        this file, not the tree. A shared component rendered in both `(admin)`
 *        and `(org)` takes a `tone` prop instead.
 *   C2 — no hand-rolled primitives. No class string outside src/components/ui/
 *        may be button-shaped (`rounded-*` AND `px-<n>` AND
 *        `font-medium|font-semibold`) or table-shaped (a literal `<table`).
 *        LIVE as of commit a8 (2026-08-19). The a1 dry-run census was 52
 *        violations (45 button-shaped across 28 files, 7 table-shaped across
 *        6); a4 re-confirmed 52 and put the failing half of the
 *        failing-before/passing-after demonstration on record; a5 (`(admin)`,
 *        28 cleared), a6 (credential surfaces, 11 cleared) and a7 (member +
 *        shared, 15 cleared) swept the tree to zero, each confirmed by its own
 *        flip-test. `npm run check` now runs C2 for real, tree-wide, on every
 *        commit. Escape hatch: `// ui-ok: <reason>` on the line above, matching
 *        check-sql-date.mjs's convention.
 *
 * The EMITTERS allowlist is two path strings literal in this file rather than
 * imported from src/lib/brand/contract.ts. The tripwires are .mjs with no build
 * step, and regex-extracting an array out of a .ts file breaks on a formatter
 * change. Duplicating two paths in a file whose entire job is to fail when they
 * change is the correct trade.
 *
 * Not a proof; just a tripwire. Comment-only lines are skipped (E10): three
 * existing comments contain the string `dangerouslySetInnerHTML` while
 * asserting the XSS invariant, and a tripwire that fires on a comment praising
 * the invariant is a tripwire people learn to bypass.
 *
 * Exported for unit-testing:
 *   checkBrandScope(files, opts) → violations[]
 *   where files is Array<{ path: string, content: string }> with POSIX paths
 *   relative to the repo root.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src");

// ── The allowlists ───────────────────────────────────────────────────────────

/**
 * The only two layouts that may emit the brand. `(org)`'s `required` flipped
 * to `true` at commit `c4` (2026-08-19) — see E2 below. `(public)`'s stays
 * `false`: P3 has not created that file yet.
 */
export const EMITTERS = [
  { path: "src/app/(org)/o/[slug]/layout.tsx", required: true },
  { path: "src/app/(public)/site/[slug]/layout.tsx", required: false },
];

/** The only two route groups a `*-brand` utility may appear in (C1). */
const BRANDABLE_PREFIXES = ["src/app/(org)/", "src/app/(public)/"];

/** The only directory that may contain a style emitter (E3). */
const EMITTER_DIR = "src/components/brand/";

/** Generated primitives are where button and table shapes belong (C2). */
const PRIMITIVE_DIR = "src/components/ui/";

/**
 * /developer is a hand-set register with its own `.reg`-scoped palette and no
 * shared tokens — verified: developer.css declares every value under `.reg`,
 * never `:root`. Exempt from C2 by path.
 */
const C2_EXEMPT_PREFIXES = ["src/app/(admin)/developer/"];

/** Flipped to true at commit a8 (2026-08-19), once the sweep cleared the census. */
export const C2_ENABLED = true;

// ── Patterns ─────────────────────────────────────────────────────────────────

const MARKER_RE = /<BrandTokens\b/;
const STYLE_ELEMENT_RE = /<style\b/;
const DANGEROUS_HTML_RE = /\bdangerouslySetInnerHTML\s*=/;

// bg-brand, text-brand-raw, ring-brand/50 — but NOT text-branding.
const BRAND_UTILITY_RE =
  /(?<![a-zA-Z0-9-])(bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|shadow|accent|caret|divide|placeholder)-brand(-[a-z0-9]+)*(?![a-zA-Z0-9])/;

const ROUNDED_RE = /(?<![a-zA-Z0-9-])rounded(-[a-z0-9]+)*(?![a-zA-Z0-9])/;
const PX_RE = /(?<![a-zA-Z0-9-])px-[0-9]/;
const FONT_WEIGHT_RE = /(?<![a-zA-Z0-9-])font-(medium|semibold)(?![a-zA-Z0-9-])/;
const TABLE_ELEMENT_RE = /<table\b/;
const UI_OK_RE = /\/\/\s*ui-ok:/i;

/**
 * Lines whose trimmed form starts with a comment opener are not code. Extends
 * check-sql-date.mjs's `//` rule with the JSDoc continuation and the JSX
 * comment form, both of which carry the strings E3 looks for.
 */
export function isCommentLine(line) {
  const t = line.trim();
  return (
    t.startsWith("//") ||
    t.startsWith("/*") ||
    t.startsWith("*") ||
    t.startsWith("{/*")
  );
}

// ── The checker ──────────────────────────────────────────────────────────────

/**
 * @param {Array<{ path: string, content: string }>} files
 * @param {{ emitters?: typeof EMITTERS, c2?: boolean }} [opts]
 * @returns {Array<{ rule: string, file: string, line: number|null, message: string, text?: string }>}
 */
export function checkBrandScope(files, opts = {}) {
  const emitters = opts.emitters ?? EMITTERS;
  const c2 = opts.c2 ?? C2_ENABLED;
  const emitterPaths = new Set(emitters.map((e) => e.path));

  const violations = [];
  const markerSeen = new Set();

  for (const file of files) {
    const rel = file.path;
    const lines = file.content.split("\n");
    const inBrandableGroup = BRANDABLE_PREFIXES.some((p) => rel.startsWith(p));
    const isEmitterDir = rel.startsWith(EMITTER_DIR);
    const isPrimitive = rel.startsWith(PRIMITIVE_DIR);
    const c2Exempt =
      isPrimitive || C2_EXEMPT_PREFIXES.some((p) => rel.startsWith(p));

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      const at = { file: rel, line: i + 1, text: line.trim().slice(0, 120) };

      // E1 — emitter containment.
      if (MARKER_RE.test(line)) {
        markerSeen.add(rel);
        if (!emitterPaths.has(rel)) {
          violations.push({
            rule: "E1",
            ...at,
            message:
              "<BrandTokens> may only be rendered by the layouts in EMITTERS. Per-org branding reaches exactly two route groups (DECISION-047).",
          });
        }
      }

      // E3 — no second emitter.
      if (!isEmitterDir) {
        if (STYLE_ELEMENT_RE.test(line)) {
          violations.push({
            rule: "E3",
            ...at,
            message: `a <style> element outside ${EMITTER_DIR} is a second, unpoliced brand emitter. Render <BrandTokens> instead.`,
          });
        }
        if (DANGEROUS_HTML_RE.test(line)) {
          violations.push({
            rule: "E3",
            ...at,
            message: `dangerouslySetInnerHTML outside ${EMITTER_DIR} is forbidden. The brand emitter uses a plain string child of <style>; nothing else needs raw HTML.`,
          });
        }
      }

      // C1 — brand-class containment.
      if (!inBrandableGroup && BRAND_UTILITY_RE.test(line)) {
        violations.push({
          rule: "C1",
          ...at,
          message:
            "a *-brand utility outside (org) and (public). A component rendered in both a brandable and an un-brandable group takes a `tone` prop instead.",
        });
      }

      // C2 — no hand-rolled primitives. Dormant until commit a8.
      if (c2 && !c2Exempt && !UI_OK_RE.test(lines[i - 1] ?? "")) {
        if (ROUNDED_RE.test(line) && PX_RE.test(line) && FONT_WEIGHT_RE.test(line)) {
          violations.push({
            rule: "C2",
            ...at,
            message:
              "button-shaped class string outside src/components/ui/. Use <Button> (or <Badge>), or annotate with `// ui-ok: <reason>` above the line.",
          });
        }
        if (TABLE_ELEMENT_RE.test(line)) {
          violations.push({
            rule: "C2",
            ...at,
            message:
              "a literal <table> outside src/components/ui/. Use <Table>, or annotate with `// ui-ok: <reason>` above the line.",
          });
        }
      }
    }
  }

  // E2 — emitter presence. Dormant while every `required` is false.
  const present = new Set(files.map((f) => f.path));
  for (const emitter of emitters) {
    if (!emitter.required) continue;
    if (!present.has(emitter.path)) continue; // the file does not exist yet
    if (!markerSeen.has(emitter.path)) {
      violations.push({
        rule: "E2",
        file: emitter.path,
        line: null,
        message:
          "this layout is listed as a required brand emitter but does not render <BrandTokens>. Its route group would render un-branded.",
      });
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
  process.argv[1]?.endsWith("check-brand-scope.mjs");

if (isMain) {
  const files = [];
  for await (const file of walk(SRC)) {
    files.push({
      path: path.relative(ROOT, file).split(path.sep).join("/"),
      content: await fs.readFile(file, "utf8"),
    });
  }

  const violations = checkBrandScope(files);

  if (violations.length > 0) {
    console.error("Brand-scope check FAILED:\n");
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.file}${v.line ? `:${v.line}` : ""}`);
      if (v.text) console.error(`  > ${v.text}`);
      console.error(`  ${v.message}`);
      console.error("");
    }
    console.error(
      "  Why this matters: branding is a cascade override scoped to two layouts",
    );
    console.error(
      "  (DECISION-047). A branded page outside them tells a prober the org is a",
    );
    console.error("  configured tenant, or paints content in an emphasis colour.");
    console.error("");
    process.exit(1);
  }

  const dormantEmitters = EMITTERS.filter((e) => !e.required).map(
    (e) => e.path,
  );
  const dormant = [
    ...(dormantEmitters.length
      ? [`E2 for ${dormantEmitters.join(", ")} (file does not exist yet)`]
      : []),
    ...(C2_ENABLED ? [] : ["C2 (turned on at commit a8)"]),
  ];
  console.log(
    `Brand-scope check passed${dormant.length ? ` — dormant: ${dormant.join(", ")}` : ""}.`,
  );
}
