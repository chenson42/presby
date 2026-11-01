#!/usr/bin/env node
/**
 * Treasury-boundaries guard. docs/work-log/2026-10-25-treasury.md, Phase 1 R12
 * and Phase 2 (DECISION-271); docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
 * and the Batch 7 brief. Reimbursements (and the ledger increments that follow)
 * are built from a handful of "this appears nowhere else" properties, every one
 * of which is a PAPER invariant otherwise: nothing about the type system stops a
 * later batch from reaching for the owner connection in a money path, naming a
 * reimbursement table in a page, putting an amount in an email, adding a
 * `capture` attribute to a receipt picker, or importing the image library from a
 * third file (DECISION-312). This is the tripwire that makes each one a failing command
 * instead of a review comment. Modelled on `check-giving-boundaries.mjs` (and
 * sharing its comment stripper); later ledger increments extend THIS script, they
 * do not fork it.
 *
 * Rules (all over non-test `.ts`/`.tsx` files under `src/`; comments are blanked
 * first, so a header that talks about `getPlatformDb()` is not a violation):
 *
 *   T1 - no owner connection in the money paths. `getPlatformDb`,
 *        `PLATFORM_DATABASE_URL` or `MIGRATE_DATABASE_URL` may not appear under
 *        `src/lib/reimbursement/`, `src/lib/treasury/`, `src/components/treasury/`,
 *        either route tree (`(org)/o/[slug]/reimbursements/` and
 *        `(org)/o/[slug]/admin/reimbursements/`) or any `src/app/api/**` path
 *        containing "reimbursement". Every treasury surface runs on `db`
 *        (`presby_app`, RLS enforced) through a SECURITY DEFINER function.
 *   T2 - only `src/lib/reimbursement/` and the Drizzle mirror
 *        (`src/lib/db/domain/reimbursement*.ts`) name a reimbursement table or
 *        definer: `reimbursement_{chargeable_groups,categories,requests,
 *        attachments,payments,events}`, any `presby_reimbursement_*` function, or
 *        a Drizzle table identifier (`reimbursementRequests`, ...). A page or an
 *        action that wanted a row reads through a function in
 *        `src/lib/reimbursement/`. `src/lib/testing/` (DB-test actors, never
 *        shipped) and `src/lib/dev-docs.ts` (the developer reference's
 *        classification of every table by name: a map key, never a query or a
 *        shape; orchestrator ruling F338 has each pipeline file its own tables
 *        there) are the two others.
 *   T3 - no `capture` attribute on any `type="file"` input in `src/`. Global,
 *        because there is no legitimate use: `capture` forces the camera and
 *        removes the photo library, which is the wrong picker for a receipt that
 *        is a PDF, a screenshot or an old photo. Applies to `<input>` and the
 *        shadcn `<Input>`.
 *   T4 - a notice carries no money and no free text (Phase 2: the purpose field
 *        can hold pastoral-care spending; `email_queue` is indefinite). A file
 *        that references a `reimbursement.notice.` template key, or imports the
 *        notices module, names no amount, cents, formatter, purpose, vendor,
 *        payee, expense date or reason identifier. The permission keys also start
 *        `reimbursement.`; the `notice.` namespace is what is matched. The one
 *        exception is the shared audience registry
 *        (`src/lib/contact-methods/email-audience.ts`), which holds every module's
 *        template keys and is not notice code.
 *   T5 - `sharp` is imported at RUNTIME by a CLOSED LIST of two files,
 *        `src/lib/person-photos/image.ts` and `src/lib/storage/image-sanitize.ts`
 *        (DECISION-312, amending DECISION-270/271 T5, which named one). The
 *        re-encoders are the guarantee that no EXIF location or embedded payload
 *        survives, so the library has a short, named list of doors. A type-only
 *        import is erased and is not a runtime import. EXACTLY these two: no other
 *        file imports it, and each listed file exists and does (a tree where a
 *        re-encoder has stopped using the library, or has been renamed away, fails
 *        too - `checkTreasuryBoundariesTree`, which the command runs;
 *        `checkTreasuryBoundaries` alone is the "no other importer" half, for the
 *        synthetic-file tests). Each listed file also begins with
 *        `import "server-only";` and, comments aside, never names a sharp option
 *        that keeps metadata (`withMetadata`, `keepMetadata`, `keepExif`,
 *        `withExif`, `withExifMerge`, `keepIccProfile`, `withIccProfile`,
 *        `keepXmp`, `withXmp`): the output carries none. A third importer is a
 *        design amendment (a new DECISION), not an edit to this list.
 *
 * Not a proof; just a tripwire. It sees file PRESENCE of a token, not data flow
 * - the DB tests (`scripts/treasury/test-rls-73.sql`) and code review cover what
 * a grep cannot. There is deliberately NO general exemption comment: each rule is
 * "appears nowhere / in one place", and an exception is a design amendment, not
 * an annotation.
 *
 * Exported for unit-testing:
 *   checkTreasuryBoundaries(files) -> violations[]
 *   where files is Array<{ path: string, content: string }> with POSIX paths
 *   relative to the repo root.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { stripComments } from "./check-giving-boundaries.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src");

// ── The zones and allowlists ─────────────────────────────────────────────────

/** The closed list of files that may, and must, import `sharp` at runtime (T5, DECISION-312). */
export const SHARP_FILES = ["src/lib/person-photos/image.ts", "src/lib/storage/image-sanitize.ts"];

/** The audience registry: holds every module's template keys; not notice code (T4). */
export const EMAIL_AUDIENCE_FILE = "src/lib/contact-methods/email-audience.ts";

const ORG_TREE = "src/app/(org)/o/[slug]/";

/** T1's zone, as a predicate over a POSIX repo-relative path. */
export function isNoOwnerConnectionZone(rel) {
  if (rel.startsWith("src/lib/reimbursement/")) return true;
  if (rel.startsWith("src/lib/treasury/")) return true;
  if (rel.startsWith("src/components/treasury/")) return true;
  if (rel.startsWith(`${ORG_TREE}reimbursements/`)) return true;
  if (rel.startsWith(`${ORG_TREE}admin/reimbursements/`)) return true;
  if (rel.startsWith("src/app/api/") && /reimbursement/i.test(rel)) return true;
  return false;
}

/** Names every table once, as a map key, to classify it for the developer reference (T2 exemption). */
export const DEV_DOCS_FILE = "src/lib/dev-docs.ts";

/** The places allowed to name a reimbursement table or definer (T2). */
export function mayNameReimbursementTables(rel) {
  if (rel.startsWith("src/lib/reimbursement/")) return true;
  if (/^src\/lib\/db\/domain\/reimbursement[^/]*\.ts$/.test(rel)) return true;
  if (rel.startsWith("src/lib/testing/")) return true;
  // The developer reference files every table under a module by NAME (F283's classification test, F338).
  if (rel === DEV_DOCS_FILE) return true;
  return false;
}

// ── Patterns ─────────────────────────────────────────────────────────────────

const OWNER_CONNECTION_RE = /\bgetPlatformDb\b|\bPLATFORM_DATABASE_URL\b|\bMIGRATE_DATABASE_URL\b/;

const TABLES = "chargeable_groups|categories|requests|attachments|payments|events";
const TABLE_NAME_RE = new RegExp(`\\breimbursement_(?:${TABLES})\\b`);
const DEFINER_NAME_RE = /\bpresby_reimbursement_\w+/;
const DRIZZLE_TABLE_RE = /\breimbursement(?:ChargeableGroups|Categories|Requests|Attachments|Payments|Events)\b/;

const NOTICE_KEY_RE = /reimbursement\.notice\./;
const NOTICES_IMPORT_RE = /from\s*["'](?:\.\/notices|@\/lib\/reimbursement\/notices)["']/;
/** Money, formatters and the free-text fields a request carries. Word-bounded; case-sensitive. */
const NOTICE_FORBIDDEN_RE =
  /\b(?:amount\w*|\w*[Cc]ents\w*|format(?:Money|Amount|Currency|Dollars)\w*|NumberFormat|currency\w*|dollars?\w*|purpose\w*|vendor\w*|payee\w*|expense_?[Dd]ate|reason\w*)\b/;

/** Sharp options that carry input metadata (EXIF, ICC, XMP) into the output. Word-bounded; comments stripped first. */
const SHARP_KEEP_METADATA_RE =
  /\b(?:withMetadata|keepMetadata|keepExif|withExif|withExifMerge|keepIccProfile|withIccProfile|keepXmp|withXmp)\b/;

const SHARP_FROM_RE = /\b(import|export)\s+(type\s+)?([^;'"]*?)\bfrom\s*["']sharp(?:\/[^"']*)?["']/g;
const SHARP_SIDE_EFFECT_RE = /\bimport\s+["']sharp(?:\/[^"']*)?["']/g;
const SHARP_DYNAMIC_RE = /\b(?:require|import)\s*\(\s*["']sharp(?:\/[^"']*)?["']\s*\)/g;

/** Every runtime (not type-only) import of `sharp` in comment-stripped source, as `{ index }`. */
function sharpRuntimeImports(code) {
  const imports = [];
  for (const m of code.matchAll(SHARP_FROM_RE)) if (!m[2]) imports.push({ index: m.index });
  for (const m of code.matchAll(SHARP_SIDE_EFFECT_RE)) imports.push({ index: m.index });
  for (const m of code.matchAll(SHARP_DYNAMIC_RE)) imports.push({ index: m.index });
  return imports;
}

function isTestFile(rel) {
  return /\.(test|spec)\.(ts|tsx|mjs)$/.test(rel);
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Finds every `<input ...>` / `<Input ...>` opening tag in comment-stripped
 * source and returns `{ index, text, attributes }`, where `attributes` is the set
 * of attribute NAMES at the tag's own top level (not words inside a quoted value
 * or a `{...}` expression, so `className="capture"` is not the attribute).
 */
export function inputTags(code) {
  const tags = [];
  const open = /<(?:input|Input)(?=[\s/>])/g;
  let match;
  while ((match = open.exec(code))) {
    let i = match.index + match[0].length;
    let depth = 0;
    let quote = null;
    let word = "";
    const attributes = new Set();
    const flush = () => {
      if (word) attributes.add(word);
      word = "";
    };
    for (; i < code.length; i++) {
      const ch = code[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "{") {
        flush();
        depth++;
        continue;
      }
      if (ch === "}") {
        depth--;
        continue;
      }
      if (depth > 0) continue;
      if (ch === ">") {
        flush();
        break;
      }
      if (/[A-Za-z0-9_:-]/.test(ch)) word += ch;
      else flush();
    }
    tags.push({ index: match.index, text: code.slice(match.index, i + 1), attributes });
    open.lastIndex = Math.max(open.lastIndex, i + 1);
  }
  return tags;
}

const TYPE_FILE_RE = /\btype\s*=\s*(?:"file"|'file'|\{\s*["'`]file["'`]\s*\})/;

// ── The checker ──────────────────────────────────────────────────────────────

/**
 * @param {Array<{ path: string, content: string }>} files
 * @returns {Array<{ rule: string, file: string, line: number, message: string, text?: string }>}
 */
export function checkTreasuryBoundaries(files) {
  const violations = [];

  for (const file of files) {
    const rel = file.path;
    if (!/\.tsx?$/.test(rel)) continue;
    if (isTestFile(rel)) continue;

    const original = file.content.split("\n");
    const code = stripComments(file.content);
    const codeLines = code.split("\n");
    const snippet = (n) => (original[n - 1] ?? "").trim().slice(0, 120);

    // T1 - no owner connection in the money paths.
    if (isNoOwnerConnectionZone(rel)) {
      for (let i = 0; i < codeLines.length; i++) {
        if (OWNER_CONNECTION_RE.test(codeLines[i])) {
          violations.push({
            rule: "T1",
            file: rel,
            line: i + 1,
            text: snippet(i + 1),
            message:
              "the owner connection (getPlatformDb / PLATFORM_DATABASE_URL / MIGRATE_DATABASE_URL) may not appear in a treasury money path (DECISION-271). Use `db` (presby_app) through withOrgContext and a SECURITY DEFINER function.",
          });
        }
      }
    }

    // T2 - only src/lib/reimbursement/ (and the Drizzle mirror) names the tables and definers.
    if (!mayNameReimbursementTables(rel)) {
      for (let i = 0; i < codeLines.length; i++) {
        const line = codeLines[i];
        if (TABLE_NAME_RE.test(line) || DEFINER_NAME_RE.test(line) || DRIZZLE_TABLE_RE.test(line)) {
          violations.push({
            rule: "T2",
            file: rel,
            line: i + 1,
            text: snippet(i + 1),
            message:
              "a reimbursement table or presby_reimbursement_* function is named outside src/lib/reimbursement/. Add a function there and call it; a page or action must not know the table shapes (DECISION-271, T2).",
          });
        }
      }
    }

    // T3 - no `capture` on a file input, anywhere.
    for (const tag of inputTags(code)) {
      if (TYPE_FILE_RE.test(tag.text) && tag.attributes.has("capture")) {
        const line = lineOf(code, tag.index);
        violations.push({
          rule: "T3",
          file: rel,
          line,
          text: snippet(line),
          message:
            'a `capture` attribute on <input type="file">. It forces the camera and removes the photo library, the wrong picker for a receipt that is a PDF, a screenshot or an old photo. There is no legitimate use (DECISION-271, T3).',
        });
      }
    }

    // T4 - a notice carries no money and no free text.
    const referencesNotice = NOTICE_KEY_RE.test(code) || NOTICES_IMPORT_RE.test(code);
    if (referencesNotice && rel !== EMAIL_AUDIENCE_FILE) {
      for (let i = 0; i < codeLines.length; i++) {
        const hit = NOTICE_FORBIDDEN_RE.exec(codeLines[i]);
        if (hit) {
          violations.push({
            rule: "T4",
            file: rel,
            line: i + 1,
            text: snippet(i + 1),
            message: `this file builds or sends a reimbursement notice (it references a reimbursement.notice. key or imports the notices module) and names \`${hit[0]}\`. A notice says that a request needs something and where to open it; it carries no amount, name, purpose, reason or date (the email queue is indefinite). Put the code that needs that identifier in another file (DECISION-271, T4).`,
          });
        }
      }
    }

    // T5 - sharp is imported at runtime by the closed list of two files.
    if (!SHARP_FILES.includes(rel)) {
      for (const imp of sharpRuntimeImports(code)) {
        const line = lineOf(code, imp.index);
        violations.push({
          rule: "T5",
          file: rel,
          line,
          text: snippet(line),
          message: `"sharp" is imported at runtime only by ${SHARP_FILES.join(" and ")} (DECISION-312, amending DECISION-270/271 T5: the closed list of two re-encoders). Call their exports instead.`,
        });
      }
    }
  }

  return violations;
}

/**
 * T5's other half: every listed file must actually be there, import `sharp` at
 * runtime ("exactly these", not "at most these"), begin with
 * `import "server-only";`, and name no metadata-keeping sharp option. Needs the
 * WHOLE tree, so it is separate from `checkTreasuryBoundaries`, whose callers
 * pass a handful of synthetic files. One run reports every listed file.
 *
 * @param {Array<{ path: string, content: string }>} files
 */
export function checkSharpHasItsImporter(files) {
  const violations = [];
  for (const listed of SHARP_FILES) {
    const own = files.find((file) => file.path === listed);
    if (!own) {
      violations.push({
        rule: "T5",
        file: listed,
        line: 1,
        text: "",
        message: `${listed} does not exist. T5 is EXACTLY the closed list ${SHARP_FILES.join(" and ")} (DECISION-312): each re-encoder must exist, or its images have no sanitizer.`,
      });
      continue;
    }
    const code = stripComments(own.content);
    if (sharpRuntimeImports(code).length === 0) {
      violations.push({
        rule: "T5",
        file: listed,
        line: 1,
        text: "",
        message: `${listed} no longer imports "sharp" at runtime. T5 is EXACTLY the closed list ${SHARP_FILES.join(" and ")} (DECISION-312): each re-encoder must use the library, or its images have no sanitizer.`,
      });
    }
    if (!own.content.startsWith('import "server-only";')) {
      violations.push({
        rule: "T5",
        file: listed,
        line: 1,
        text: own.content.split("\n")[0].trim().slice(0, 120),
        message: `${listed} must begin with \`import "server-only";\` so the re-encoder can never reach a client bundle (DECISION-312).`,
      });
    }
    const codeLines = code.split("\n");
    for (let i = 0; i < codeLines.length; i++) {
      const hit = SHARP_KEEP_METADATA_RE.exec(codeLines[i]);
      if (hit) {
        violations.push({
          rule: "T5",
          file: listed,
          line: i + 1,
          text: (own.content.split("\n")[i] ?? "").trim().slice(0, 120),
          message: `${listed} names \`${hit[0]}\`. A re-encoder's output carries no input metadata (no EXIF location, ICC or XMP); a sharp option that keeps it defeats the sanitizer (DECISION-312, DECISION-270).`,
        });
      }
    }
  }
  return violations;
}

/** The whole-tree check the command runs: every rule, plus T5's "and those two do, cleanly". */
export function checkTreasuryBoundariesTree(files) {
  return [...checkTreasuryBoundaries(files), ...checkSharpHasItsImporter(files)];
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

/** The files the script scans: everything under src/. */
export async function collectFiles() {
  const files = [];
  for await (const file of walk(SRC)) {
    files.push({
      path: path.relative(ROOT, file).split(path.sep).join("/"),
      content: await fs.readFile(file, "utf8"),
    });
  }
  return files;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("check-treasury-boundaries.mjs");

if (isMain) {
  const violations = checkTreasuryBoundariesTree(await collectFiles());

  if (violations.length > 0) {
    console.error("Treasury-boundaries check FAILED:\n");
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.file}:${v.line}`);
      if (v.text) console.error(`  > ${v.text}`);
      console.error(`  ${v.message}`);
      console.error("");
    }
    console.error("  Why this matters: reimbursements rest on a few things appearing in exactly one place");
    console.error("  (the table shapes), the library behind the image re-encoders appearing in exactly two");
    console.error("  (DECISION-312), and a few appearing in none (the owner connection in a money path, an");
    console.error("  amount in an email, `capture` on a receipt picker). DECISION-271.");
    console.error("");
    process.exit(1);
  }

  console.log("Treasury-boundaries check passed.");
}
