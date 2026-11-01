/**
 * H19, the help import boundary (R8, DECISION-293). Public help pages are static and
 * session-free, so nothing under the help trees may reach the database, the session, request
 * headers, flags, tenant authorization or the public-site modules: a transitive import is how a
 * `headers()` or an `auth()` slips into a page that `dynamic = "error"` then fails to build.
 *
 * Entries (non-test code files): src/app/(documentation)/help/**, src/app/(documentation)/docs/**,
 * src/lib/help/**, src/components/help/** and src/components/shared/markdown-document.tsx.
 * The contact form (Increment 2) writes to the database by design, through ONE named file,
 * `src/app/(documentation)/help/contact/actions.ts` (DECISION-304, replacing the subtree
 * exemption of R8). It is a `"use server"` STOP in the walk: reached and counted, not followed.
 * Everything else in `help/contact/` (the page, the client island) stays an entry and is walked
 * with all it imports, so those files, and `src/lib/help-contact/contract.ts` and its pure
 * siblings, must stay pure. Two further violations guard the stop itself: S1, the stop file's
 * first statement is not `"use server"`; S2, a file outside its own segment imports it.
 *
 * Banned: src/lib/db/**, @/auth, next-auth, next/headers, @/lib/flags, @/lib/authz and
 * src/lib/sites*.ts. `server-only` is allowed (content.ts reads fs at build) and so are node
 * builtins. `import type` is not followed.
 *
 * Pure: scripts/check-help.ts reads the tree and calls this.
 */
import {
  checkImportBoundary,
  importSpecifiers,
  resolveSpecifier,
  stripComments,
} from "./import-graph.mjs";

const CODE_FILE_RE = /\.(?:ts|tsx|mts|js|mjs)$/;
const TEST_FILE_RE = /\.test\.[mc]?[jt]sx?$/;

const TREES = [
  "src/app/(documentation)/help/",
  "src/app/(documentation)/docs/",
  "src/lib/help/",
  "src/components/help/",
];
const SINGLE_FILES = ["src/components/shared/markdown-document.tsx"];

/** The one database-reaching file under the help trees (DECISION-304). Exactly one path. */
export const SERVER_ACTION_STOPS = ["src/app/(documentation)/help/contact/actions.ts"];
const STOP_SEGMENT = "src/app/(documentation)/help/contact/";

/** Which of `paths` are walk entries, in the order given. */
export function helpBoundaryEntries(paths) {
  return paths.filter((p) => {
    if (!CODE_FILE_RE.test(p) || TEST_FILE_RE.test(p)) return false;
    if (SERVER_ACTION_STOPS.includes(p)) return false; // a stop, not an entry
    return TREES.some((t) => p.startsWith(t)) || SINGLE_FILES.includes(p);
  });
}

/** The label of the banned area `rel` is in, or null. */
export function helpBannedPath(rel) {
  if (rel.startsWith("src/lib/db/")) return "src/lib/db/**";
  if (/^src\/auth\.[mc]?[jt]sx?$/.test(rel)) return "@/auth (src/auth.ts)";
  if (/^src\/lib\/flags(?:\.[mc]?[jt]sx?|\/)/.test(rel)) return "@/lib/flags";
  if (/^src\/lib\/authz(?:\.[mc]?[jt]sx?|\/)/.test(rel)) return "@/lib/authz";
  if (/^src\/lib\/sites[^/]*\.[mc]?[jt]sx?$/.test(rel)) return "src/lib/sites*.ts";
  return null;
}

export const HELP_BANNED_BARE = [/^next-auth(\/|$)/, /^next\/headers$/];

const USE_SERVER_FIRST_RE = /^\s*(["'])use server\1\s*;?/;

/**
 * @param {Array<{ path: string, content: string }>} files every non-test source file the graph might touch
 * @returns {Array<{ rule: string, file: string, specifier?: string, chain: string[], message: string }>}
 *   P1 to P4 as `checkImportBoundary`; S1 a stop file that does not begin with "use server";
 *   S2 a stop file imported from outside its own segment.
 */
export function checkHelpBoundary(files) {
  const entries = helpBoundaryEntries(files.map((f) => f.path));
  const violations = checkImportBoundary(files, {
    entries,
    ban: { path: helpBannedPath, bare: HELP_BANNED_BARE },
    stopAt: SERVER_ACTION_STOPS,
  });

  const index = new Map(files.map((f) => [f.path, f.content]));
  const present = files.some((f) => SERVER_ACTION_STOPS.includes(f.path));
  // A stop file that is named but missing is a hole, not a pass; but a tree with no help files at
  // all (a fixture, a fork that removed the form) has nothing to guard.
  if (!present && entries.length > 0 && files.some((f) => f.path.startsWith(STOP_SEGMENT))) {
    for (const stop of SERVER_ACTION_STOPS) {
      violations.push({
        rule: "P4",
        file: stop,
        chain: [stop],
        message: `stop file ${stop} not found; the guard cannot check it.`,
      });
    }
  }

  for (const stop of SERVER_ACTION_STOPS) {
    const content = index.get(stop);
    if (content === undefined) continue;
    if (!USE_SERVER_FIRST_RE.test(stripComments(content))) {
      violations.push({
        rule: "S1",
        file: stop,
        chain: [stop],
        message: `${stop} is the one file under the help trees allowed to reach the database, and its first statement must be "use server" so that nothing else can import its server half by accident.`,
      });
    }
  }

  // S2: independent of the walk, scan every non-test file for an import that resolves to a stop.
  for (const file of files) {
    if (TEST_FILE_RE.test(file.path) || !CODE_FILE_RE.test(file.path)) continue;
    if (file.path.startsWith(STOP_SEGMENT)) continue;
    for (const spec of importSpecifiers(stripComments(file.content))) {
      const resolved = resolveSpecifier(spec, file.path, index);
      if (resolved && SERVER_ACTION_STOPS.includes(resolved)) {
        violations.push({
          rule: "S2",
          file: file.path,
          specifier: spec,
          chain: [file.path, resolved],
          message: `${file.path} imports "${spec}" (${resolved}). That file reaches the database and may be imported only from ${STOP_SEGMENT}.`,
        });
      }
    }
  }
  return violations;
}
