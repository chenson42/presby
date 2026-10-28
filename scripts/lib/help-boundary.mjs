/**
 * H19, the help import boundary (R8, DECISION-293). Public help pages are static and
 * session-free, so nothing under the help trees may reach the database, the session, request
 * headers, flags, tenant authorization or the public-site modules: a transitive import is how a
 * `headers()` or an `auth()` slips into a page that `dynamic = "error"` then fails to build.
 *
 * Entries (non-test code files): src/app/(documentation)/help/**, src/app/(documentation)/docs/**,
 * src/lib/help/**, src/components/help/** and src/components/shared/markdown-document.tsx.
 * `help/contact/**` is exempt: Increment 2's contact form writes to the database by design (C1),
 * and the exemption is only that subtree, never the rest of the help tree.
 *
 * Banned: src/lib/db/**, @/auth, next-auth, next/headers, @/lib/flags, @/lib/authz and
 * src/lib/sites*.ts. `server-only` is allowed (content.ts reads fs at build) and so are node
 * builtins. `import type` is not followed.
 *
 * Pure: scripts/check-help.ts reads the tree and calls this.
 */
import { checkImportBoundary } from "./import-graph.mjs";

const CODE_FILE_RE = /\.(?:ts|tsx|mts|js|mjs)$/;
const TEST_FILE_RE = /\.test\.[mc]?[jt]sx?$/;

const TREES = [
  "src/app/(documentation)/help/",
  "src/app/(documentation)/docs/",
  "src/lib/help/",
  "src/components/help/",
];
const SINGLE_FILES = ["src/components/shared/markdown-document.tsx"];
const EXEMPT = ["src/app/(documentation)/help/contact/"];

/** Which of `paths` are walk entries, in the order given. */
export function helpBoundaryEntries(paths) {
  return paths.filter((p) => {
    if (!CODE_FILE_RE.test(p) || TEST_FILE_RE.test(p)) return false;
    if (EXEMPT.some((e) => p.startsWith(e))) return false;
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

/**
 * @param {Array<{ path: string, content: string }>} files every non-test source file the graph might touch
 * @returns {Array<{ rule: string, file: string, specifier?: string, chain: string[], message: string }>}
 */
export function checkHelpBoundary(files) {
  const entries = helpBoundaryEntries(files.map((f) => f.path));
  return checkImportBoundary(files, {
    entries,
    ban: { path: helpBannedPath, bare: HELP_BANNED_BARE },
  });
}
