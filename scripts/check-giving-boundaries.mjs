#!/usr/bin/env node
/**
 * Giving-boundaries guard. docs/work-log/2026-10-15-online-giving.md, Phase 2
 * S1 (adopted by Phase 3 as P3-2), R1/R6/R8/R11, P3-6. Online giving is built
 * from a handful of "this appears nowhere else" properties, every one of which
 * is a PAPER invariant otherwise: nothing about the type system stops a later
 * batch from importing the Stripe SDK into a page, reaching for the owner
 * connection inside the giving code, or resurrecting the retired platform flag.
 * This is the tripwire that makes each one a failing command instead of a
 * review comment. Batch 1 creates it; later batches extend it.
 *
 * Rules (all over non-test `.ts`/`.tsx` files under `src/`, plus
 * `scripts/seed.ts` for B4; comments are blanked first, so a header that talks
 * about `getPlatformDb()` is not a violation):
 *
 *   B1 — the `stripe` package is imported at RUNTIME by exactly one file,
 *        `src/lib/giving/providers/stripe/client.ts` (R8: the allowlist
 *        module — the only code that can reach a Stripe resource, so the only
 *        code a restricted key's scope has to be reasoned about for). Anything
 *        else importing "stripe" or "stripe/..." as a value fails.
 *   B2 — a TYPE-ONLY import of `stripe` (`import type ...`) is legal only
 *        inside `src/lib/giving/providers/stripe/**` (`normalize.ts` /
 *        `status.ts` type their inputs with it). Everywhere else the
 *        provider-neutral core knows no provider's types.
 *   B3 — no owner connection inside the money paths (R6, P3-6, DECISION-171):
 *        `getPlatformDb`, `PLATFORM_DATABASE_URL` or `MIGRATE_DATABASE_URL`
 *        may not appear under `src/lib/giving/`, `src/app/api/webhooks/stripe/`,
 *        any `src/app/api/**` path containing "giving", any `(org)` route
 *        directory named "giving", or `src/app/(public)/site/[slug]/give/`.
 *        The webhook, cron, ingest, and every tenant giving surface run on
 *        `db` (`presby_app`, RLS enforced); the two owner-only functions are
 *        reached from one file outside all of these (B6). Test files are
 *        exempt (their fixtures legitimately reach the owner connection).
 *   B4 — the `org_portal.giving` PLATFORM flag is retired (R11; 0055 deleted
 *        the row). No `isFlagEnabled("org_portal.giving")`, no tile
 *        `flagKey: "org_portal.giving"`, and `scripts/seed.ts` may not seed it.
 *        The per-org TOGGLE of the same key (`orgFeatureKey`, the catalog
 *        `key`) is the whole gate and is not matched.
 *   B5 — a statement notice email carries no amounts (P3-1: "no amounts
 *        anywhere, subject included"). A file that references a
 *        `giving.statement` email template must not also touch money:
 *        `formatCents`, `amountCents`, `amount_cents`, `totalCents`,
 *        `giving_gifts` or `giving_statement_lines`. This forces the notice
 *        builder into a file of its own. Exemption, with a mandatory reason:
 *        `// giving-amounts-ok: <reason>` on the line above the template
 *        reference.
 *   B6 — `presby_giving_ingest_health`, `presby_giving_dead_letters` and
 *        `presby_giving_requeue_event` are OWNER-ONLY functions (P3-6; the
 *        dead-letter list is 0055 C2) called through `getPlatformDb()` from ONE
 *        file, `src/lib/admin/giving-ingest-health.ts`. No other non-test file
 *        may name any of them.
 *
 *   B7 — no Stripe origin in the CSP's navigation/script/frame directives
 *        (Batch 3; R7/G30). A donor reaches Checkout by a top-level REDIRECT, so
 *        `form-action`, `script-src`, `script-src-elem`, `frame-src`,
 *        `child-src` and `default-src` (their fallback) in `next.config.ts` must
 *        never name `stripe.com`. Stripe.js is never loaded on a presby page
 *        (the sealed-section invariant), and a `stripe.com` there would be the
 *        first step toward embedding a card form.
 *   B8 — no session machinery in the ingest paths (Batch 3; R6). The webhook
 *        route, the giving cron route and `src/lib/giving/ingest/` run with NO
 *        session and NO org context: they may not import `@/auth`, call
 *        `auth()` / `cachedAuth()` / `resolveOrgContext()` / `withOrgContext()`.
 *        Their only door is the SECURITY DEFINER family on `db`.
 *   B9 — the allowlist's calls have named callers (Batch 3; F141).
 *        `retrieveInvoiceForPayment` is called only from `ingest/process.ts`
 *        (it takes an id from a CLAIMED event; anywhere else it is an arbitrary
 *        invoice read on a congregation's account). The account-lifecycle trio
 *        (`createConnectedAccount`, `createOnboardingLink`,
 *        `retrieveConnectedAccount`) is called only from
 *        `src/lib/giving/connection.ts`.
 *
 * Not a proof; just a tripwire. It sees file PRESENCE of a token, not data
 * flow — the DB tests (`scripts/giving/test-rls-46.sql`) and code review cover
 * what a grep cannot. There is deliberately NO general exemption comment: each
 * rule above is "appears nowhere", and an exception is a Phase 3 amendment, not
 * an annotation.
 *
 * Exported for unit-testing:
 *   checkGivingBoundaries(files) -> violations[]
 *   where files is Array<{ path: string, content: string }> with POSIX paths
 *   relative to the repo root.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src");

// ── The allowlists ───────────────────────────────────────────────────────────

/** The one file that may import `stripe` at runtime (B1). */
export const STRIPE_CLIENT = "src/lib/giving/providers/stripe/client.ts";

/** Where a type-only `stripe` import is legal (B2). */
export const STRIPE_TYPES_DIR = "src/lib/giving/providers/stripe/";

/** The one file that may name the two owner-only functions (B6). */
export const INGEST_HEALTH_FILE = "src/lib/admin/giving-ingest-health.ts";

/** The one file that may call `retrieveInvoiceForPayment` besides its definition (B9). */
export const INGEST_PROCESS_FILE = "src/lib/giving/ingest/process.ts";

/** The one file that may call the account-lifecycle allowlist entries (B9). */
export const CONNECTION_FILE = "src/lib/giving/connection.ts";

const ACCOUNT_LIFECYCLE_CALLS = ["createConnectedAccount", "createOnboardingLink", "retrieveConnectedAccount"];

/** The CSP directives that must never name a Stripe origin (B7). */
const CSP_NO_STRIPE_DIRECTIVES = [
  "default-src",
  "script-src",
  "script-src-elem",
  "frame-src",
  "child-src",
  "form-action",
];

const OWNER_ONLY_FUNCTIONS = [
  "presby_giving_ingest_health",
  "presby_giving_dead_letters",
  "presby_giving_requeue_event",
];

/**
 * B3's zone, as a predicate over a POSIX repo-relative path. Kept as code
 * rather than a prefix list because two of the entries are shapes ("any api
 * path containing giving", "any (org) directory named giving").
 */
export function isNoOwnerConnectionZone(rel) {
  if (rel.startsWith("src/lib/giving/")) return true;
  if (rel.startsWith("src/app/api/webhooks/stripe/")) return true;
  if (rel.startsWith("src/app/api/") && /giving/i.test(rel)) return true;
  if (/^src\/app\/\(org\)\/o\/\[slug\]\/(?:.*\/)?giving\//.test(rel)) return true;
  if (rel.startsWith("src/app/(public)/site/[slug]/give/")) return true;
  return false;
}

/** B8's zone: no session, no org context. */
export function isNoSessionZone(rel) {
  if (rel.startsWith("src/app/api/webhooks/stripe/")) return true;
  if (rel.startsWith("src/app/api/cron/giving/")) return true;
  if (rel.startsWith("src/lib/giving/ingest/")) return true;
  return false;
}

// ── Patterns ─────────────────────────────────────────────────────────────────

// import / export ... from "stripe" | "stripe/..." — the clause may span lines
// but never crosses a statement (`;`) or a quote.
const STRIPE_FROM_RE =
  /\b(import|export)\s+(type\s+)?([^;'"]*?)\bfrom\s*["'](stripe(?:\/[^"']*)?)["']/g;
const STRIPE_SIDE_EFFECT_RE = /\bimport\s+["']stripe(?:\/[^"']*)?["']/g;
const STRIPE_DYNAMIC_RE =
  /\b(?:require|import)\s*\(\s*["']stripe(?:\/[^"']*)?["']\s*\)/g;

const OWNER_CONNECTION_RE =
  /\bgetPlatformDb\b|\bPLATFORM_DATABASE_URL\b|\bMIGRATE_DATABASE_URL\b/;

const SESSION_MACHINERY_RE =
  /from\s*["']@\/auth["']|from\s*["']@\/lib\/auth\/cached-auth["']|\bauth\s*\(|\bcachedAuth\s*\(|\bresolveOrgContext\b|\bwithOrgContext\b/;

const RETIRED_FLAG_CALL_RE = /\bisFlagEnabled\s*\(\s*["'`]org_portal\.giving["'`]/;
const RETIRED_FLAG_TILE_RE = /\bflagKey\s*:\s*["'`]org_portal\.giving["'`]/;
const RETIRED_FLAG_SEED_RE = /\bkey\s*:\s*["'`]org_portal\.giving["'`]/;

const STATEMENT_TEMPLATE_RE = /giving\.statement/;
const MONEY_TOKEN_RE =
  /\b(formatCents|amountCents|amount_cents|totalCents|giving_gifts|giving_statement_lines)\b/;
const AMOUNTS_OK_RE = /\/\/\s*giving-amounts-ok:\s*(\S.*)$/;

function isTestFile(rel) {
  return /\.(test|spec)\.(ts|tsx|mjs)$/.test(rel);
}

/**
 * Blanks comments while preserving every newline (so line numbers survive):
 * block comments, whole-line `//` comments, and a trailing `// ...` after code
 * when the code before it has balanced quotes (so a `//` inside a string such
 * as "https://" is left alone). String contents are NOT blanked — B1 must see
 * the module specifier, B4 the flag name.
 */
export function stripComments(content) {
  const out = [];
  let inBlock = false;
  for (const raw of content.split("\n")) {
    let line = raw;
    let result = "";
    while (line.length > 0) {
      if (inBlock) {
        const end = line.indexOf("*/");
        if (end === -1) {
          line = "";
        } else {
          inBlock = false;
          line = line.slice(end + 2);
        }
        continue;
      }
      const blockStart = line.indexOf("/*");
      const lineStart = line.indexOf("//");
      const hasBlock = blockStart !== -1;
      const hasLine = lineStart !== -1;
      if (!hasBlock && !hasLine) {
        result += line;
        line = "";
        break;
      }
      // Whichever opener comes first wins.
      const useBlock = hasBlock && (!hasLine || blockStart < lineStart);
      if (useBlock) {
        const before = line.slice(0, blockStart);
        if (!quotesBalanced(before)) {
          // A "/*" inside a string/template: not a comment. Keep the rest.
          result += line;
          line = "";
          break;
        }
        result += before;
        line = line.slice(blockStart + 2);
        inBlock = true;
      } else {
        const before = line.slice(0, lineStart);
        if (quotesBalanced(before)) {
          result += before;
        } else {
          result += line; // "//" inside a string (a URL): keep the whole line
        }
        line = "";
        break;
      }
    }
    out.push(result);
  }
  return out.join("\n");
}

function quotesBalanced(text) {
  for (const q of ['"', "'", "`"]) {
    const count = text.split(q).length - 1;
    if (count % 2 !== 0) return false;
  }
  return true;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

// ── The checker ──────────────────────────────────────────────────────────────

/**
 * @param {Array<{ path: string, content: string }>} files
 * @returns {Array<{ rule: string, file: string, line: number, message: string, text?: string }>}
 */
export function checkGivingBoundaries(files) {
  const violations = [];

  for (const file of files) {
    const rel = file.path;
    const isSource = /\.tsx?$/.test(rel);
    const isSeed = rel === "scripts/seed.ts";
    if (!isSource && !isSeed) continue;
    if (isTestFile(rel)) continue;

    const original = file.content.split("\n");
    const code = stripComments(file.content);
    const codeLines = code.split("\n");
    const snippet = (n) => (original[n - 1] ?? "").trim().slice(0, 120);

    if (isSource) {
      // B1 / B2 — the stripe package.
      const stripeImports = [];
      for (const m of code.matchAll(STRIPE_FROM_RE)) {
        stripeImports.push({ index: m.index, typeOnly: Boolean(m[2]) });
      }
      for (const m of code.matchAll(STRIPE_SIDE_EFFECT_RE)) {
        stripeImports.push({ index: m.index, typeOnly: false });
      }
      for (const m of code.matchAll(STRIPE_DYNAMIC_RE)) {
        stripeImports.push({ index: m.index, typeOnly: false });
      }
      for (const imp of stripeImports) {
        const line = lineOf(code, imp.index);
        if (imp.typeOnly) {
          if (!rel.startsWith(STRIPE_TYPES_DIR)) {
            violations.push({
              rule: "B2",
              file: rel,
              line,
              text: snippet(line),
              message: `a type-only import of "stripe" outside ${STRIPE_TYPES_DIR}. The provider-neutral core knows no provider's types — use src/lib/giving/types.ts.`,
            });
          }
        } else if (rel !== STRIPE_CLIENT) {
          violations.push({
            rule: "B1",
            file: rel,
            line,
            text: snippet(line),
            message: `the "stripe" package is imported at runtime only by ${STRIPE_CLIENT} (R8: the allowlist module). Call one of its exports instead.`,
          });
        }
      }

      // B3 — no owner connection in the money paths.
      if (isNoOwnerConnectionZone(rel)) {
        for (let i = 0; i < codeLines.length; i++) {
          if (OWNER_CONNECTION_RE.test(codeLines[i])) {
            violations.push({
              rule: "B3",
              file: rel,
              line: i + 1,
              text: snippet(i + 1),
              message:
                "the owner connection (getPlatformDb / PLATFORM_DATABASE_URL / MIGRATE_DATABASE_URL) may not appear in the giving money paths (R6, P3-6). Use `db` (presby_app) and a SECURITY DEFINER function; the two owner-only functions live in " +
                INGEST_HEALTH_FILE +
                ".",
            });
          }
        }
      }

      // B4 — the retired platform flag (src half).
      for (let i = 0; i < codeLines.length; i++) {
        if (RETIRED_FLAG_CALL_RE.test(codeLines[i])) {
          violations.push({
            rule: "B4",
            file: rel,
            line: i + 1,
            text: snippet(i + 1),
            message:
              'isFlagEnabled("org_portal.giving") reads a platform flag that no longer exists (R11; drizzle/0055 deleted the row). Giving is toggle-only: use the org toggle via loadGivingContext() / orgFeatureEnabledInTx().',
          });
        }
        if (RETIRED_FLAG_TILE_RE.test(codeLines[i])) {
          violations.push({
            rule: "B4",
            file: rel,
            line: i + 1,
            text: snippet(i + 1),
            message:
              'a tile `flagKey: "org_portal.giving"` gates on the retired platform flag (R11). Use `orgFeatureKey: "org_portal.giving"`.',
          });
        }
      }

      // B6 — the owner-only functions have one caller.
      if (rel !== INGEST_HEALTH_FILE) {
        for (let i = 0; i < codeLines.length; i++) {
          for (const fn of OWNER_ONLY_FUNCTIONS) {
            if (codeLines[i].includes(fn)) {
              violations.push({
                rule: "B6",
                file: rel,
                line: i + 1,
                text: snippet(i + 1),
                message: `${fn}() is owner-only (P3-6) and is reached from one file, ${INGEST_HEALTH_FILE}, through getPlatformDb(). Call that module's exports.`,
              });
            }
          }
        }
      }

      // B8 — no session machinery in the ingest paths.
      if (isNoSessionZone(rel)) {
        for (let i = 0; i < codeLines.length; i++) {
          if (SESSION_MACHINERY_RE.test(codeLines[i])) {
            violations.push({
              rule: "B8",
              file: rel,
              line: i + 1,
              text: snippet(i + 1),
              message:
                "the webhook, the giving cron and src/lib/giving/ingest/ run with no session and no org context (R6). Reach the database only through the SECURITY DEFINER functions in src/lib/giving/ingest/functions.ts, which derive the organization from the inbox row.",
            });
          }
        }
      }

      // B9 — the allowlist's calls have named callers.
      if (rel !== STRIPE_CLIENT && rel !== INGEST_PROCESS_FILE) {
        for (let i = 0; i < codeLines.length; i++) {
          if (/\bretrieveInvoiceForPayment\b/.test(codeLines[i])) {
            violations.push({
              rule: "B9",
              file: rel,
              line: i + 1,
              text: snippet(i + 1),
              message: `retrieveInvoiceForPayment() reads an invoice by id on a congregation's Stripe account; it is called only from ${INGEST_PROCESS_FILE}, with an id taken from a claimed, signed event (F141).`,
            });
          }
        }
      }
      if (rel !== STRIPE_CLIENT && rel !== CONNECTION_FILE) {
        for (let i = 0; i < codeLines.length; i++) {
          for (const fn of ACCOUNT_LIFECYCLE_CALLS) {
            if (new RegExp(`\\b${fn}\\b`).test(codeLines[i])) {
              violations.push({
                rule: "B9",
                file: rel,
                line: i + 1,
                text: snippet(i + 1),
                message: `${fn}() is the connect flow's call; it is made only from ${CONNECTION_FILE}, after the giving.manage check.`,
              });
            }
          }
        }
      }

      // B7 — no Stripe origin in the CSP's navigation / script / frame directives.
      if (rel === "next.config.ts") {
        for (const m of code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*?(?:default-src|form-action|script-src|frame-src)(?:\\.|(?!\1)[^\\])*?)\1/g)) {
          const line = lineOf(code, m.index);
          for (const directive of m[2].split(";")) {
            const [name, ...values] = directive.trim().split(/\s+/);
            if (CSP_NO_STRIPE_DIRECTIVES.includes(name) && values.some((v) => /stripe\.com/i.test(v))) {
              violations.push({
                rule: "B7",
                file: rel,
                line,
                text: snippet(line),
                message: `the CSP directive "${name}" names a stripe.com origin. A donor reaches Checkout by a top-level redirect (window.location.assign), which needs no CSP allowance; Stripe.js is never loaded on a presby page.`,
              });
            }
          }
        }
      }

      // B5 — a statement notice carries no amounts.
      const templateLine = codeLines.findIndex((l) => STATEMENT_TEMPLATE_RE.test(l));
      if (templateLine !== -1) {
        const exempt = AMOUNTS_OK_RE.test(original[templateLine - 1] ?? "");
        const moneyLine = codeLines.findIndex((l) => MONEY_TOKEN_RE.test(l));
        if (!exempt && moneyLine !== -1) {
          violations.push({
            rule: "B5",
            file: rel,
            line: templateLine + 1,
            text: snippet(templateLine + 1),
            message: `this file references a giving.statement email template AND touches money (line ${moneyLine + 1}). A statement notice carries no amounts anywhere, subject included (P3-1): build it in a file that imports no amount, or annotate with \`// giving-amounts-ok: <reason>\` above the template reference.`,
          });
        }
      }
    }

    // B4 — the retired platform flag (seed half).
    if (isSeed) {
      for (let i = 0; i < codeLines.length; i++) {
        if (RETIRED_FLAG_SEED_RE.test(codeLines[i])) {
          violations.push({
            rule: "B4",
            file: rel,
            line: i + 1,
            text: snippet(i + 1),
            message:
              "scripts/seed.ts seeds the retired org_portal.giving platform flag (R11). 0055 deleted that row and 46m asserts it stays absent.",
          });
        }
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

/** The files the script scans: everything under src/, plus scripts/seed.ts and next.config.ts. */
export async function collectFiles() {
  const files = [];
  for await (const file of walk(SRC)) {
    files.push({
      path: path.relative(ROOT, file).split(path.sep).join("/"),
      content: await fs.readFile(file, "utf8"),
    });
  }
  files.push({
    path: "scripts/seed.ts",
    content: await fs.readFile(path.join(ROOT, "scripts/seed.ts"), "utf8"),
  });
  files.push({
    path: "next.config.ts",
    content: await fs.readFile(path.join(ROOT, "next.config.ts"), "utf8"),
  });
  return files;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-giving-boundaries.mjs");

if (isMain) {
  const violations = checkGivingBoundaries(await collectFiles());

  if (violations.length > 0) {
    console.error("Giving-boundaries check FAILED:\n");
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.file}:${v.line}`);
      if (v.text) console.error(`  > ${v.text}`);
      console.error(`  ${v.message}`);
      console.error("");
    }
    console.error(
      "  Why this matters: online giving's safety rests on a few things appearing in",
    );
    console.error(
      "  exactly one place (the Stripe client, the owner-only health file) and in none",
    );
    console.error(
      "  (the owner connection in a money path, the retired flag). Phase 2 S1.",
    );
    console.error("");
    process.exit(1);
  }

  console.log("Giving-boundaries check passed.");
}
