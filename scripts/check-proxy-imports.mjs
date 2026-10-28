#!/usr/bin/env node
/**
 * Proxy-imports guard (DECISION-177, F146, Phase 2 R12).
 *
 * "The proxy does not reach the database." On Next 16 `src/proxy.ts` runs on
 * Node.js, not the Edge, so the OLD reason for that rule - importing `@/lib/db`
 * breaks the build or the runtime - is no longer true, and nothing enforces it
 * any more. The rule stands for a different reason: the proxy runs on EVERY
 * matched request, a tenant decision made there would be a second
 * enumeration-sensitive path (DECISION-040), and it must stay a pure function
 * of host, path and session claims. This tripwire is what keeps it so.
 *
 * It walks the STATIC and DYNAMIC (`import()` / `require()`) import graph from
 * `src/proxy.ts`, resolving `@/` to `src/` and relative specifiers, and fails if
 * the graph reaches:
 *
 *   P1 - `src/lib/db/**`, `src/lib/sites*.ts`, or anything under
 *        `src/lib/domains/` that is not on the allow-list (`host.ts`,
 *        `probe.ts`, `cron-passthrough.ts` - the three pure, dependency-free
 *        files the proxy is meant to use);
 *   P2 - any file containing `import "server-only"` (it cannot be a proxy
 *        dependency by construction, and its presence means a server module
 *        has leaked into the proxy's graph);
 *   P3 - a bare import of `@neondatabase/*`, `drizzle-orm*`, `@auth/drizzle-adapter`,
 *        `pg`, `ws`, `resend` or `bcryptjs`;
 *   P4 - an in-repo specifier that cannot be resolved (a hole in the graph
 *        must fail loudly rather than hide a violation behind it).
 *
 * `import type ...` and `export type ... from` are erased by the compiler and
 * are not followed. Comments are stripped before scanning (a commented-out
 * import is not an import) with a scanner that respects string and template
 * literals, so a glob like "src/**\/*.ts" in a string cannot swallow code.
 *
 * Not a proof; a tripwire. It sees specifiers, not runtime `eval`.
 *
 * Exported for unit-testing:
 *   checkProxyImports(files, options?) -> violations[]
 *   where files is Array<{ path: string, content: string }> with POSIX paths
 *   relative to the repo root (every source file the graph might touch).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  NON_CODE_EXT_RE,
  SERVER_ONLY_RE,
  importSpecifiers,
  resolveSpecifier,
  stripComments,
} from "./lib/import-graph.mjs";

// The walker's primitives now live in scripts/lib/import-graph.mjs (user-help P3-3), shared with
// the help import boundary. Re-exported so this file's public surface, and its tests, are unchanged.
export { importSpecifiers, stripComments };

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SRC = path.join(ROOT, "src");

export const ENTRY = "src/proxy.ts";

/** The only files under src/lib/domains/ the proxy may reach. */
export const DOMAINS_ALLOW_LIST = [
  "src/lib/domains/host.ts",
  "src/lib/domains/probe.ts",
  "src/lib/domains/cron-passthrough.ts",
];

const BANNED_BARE = [
  /^@neondatabase\//,
  /^drizzle-orm(\/|$)/,
  /^@auth\/drizzle-adapter(\/|$)/,
  /^pg$/,
  /^ws$/,
  /^resend$/,
  /^bcryptjs$/,
];

function forbiddenPath(rel, allow) {
  if (rel.startsWith("src/lib/db/")) return "src/lib/db/**";
  if (/^src\/lib\/sites[^/]*\.[mc]?[jt]sx?$/.test(rel)) return "src/lib/sites*.ts";
  if (rel.startsWith("src/lib/domains/") && !allow.includes(rel)) {
    return "src/lib/domains/ (only host.ts, probe.ts and cron-passthrough.ts are proxy-safe)";
  }
  return null;
}

/**
 * @param {Array<{ path: string, content: string }>} files
 * @param {{ entry?: string, allow?: string[] }} [options]
 * @returns {Array<{ rule: string, file: string, specifier?: string, chain: string[], message: string }>}
 */
export function checkProxyImports(files, options = {}) {
  const entry = options.entry ?? ENTRY;
  const allow = options.allow ?? DOMAINS_ALLOW_LIST;
  const index = new Map(files.map((f) => [f.path, f.content]));
  const violations = [];

  if (!index.has(entry)) {
    return [
      {
        rule: "P4",
        file: entry,
        chain: [entry],
        message: `entry point ${entry} not found; the guard cannot walk anything.`,
      },
    ];
  }

  const parent = new Map([[entry, null]]);
  const queue = [entry];
  const chainOf = (p) => {
    const chain = [];
    for (let cur = p; cur !== null && cur !== undefined; cur = parent.get(cur)) chain.unshift(cur);
    return chain;
  };

  while (queue.length > 0) {
    const current = queue.shift();
    const code = stripComments(index.get(current));

    if (SERVER_ONLY_RE.test(code)) {
      violations.push({
        rule: "P2",
        file: current,
        chain: chainOf(current),
        message: `${current} imports "server-only" and is reachable from the proxy. A server-only module cannot be a proxy dependency.`,
      });
    }

    for (const spec of importSpecifiers(code)) {
      const resolved = resolveSpecifier(spec, current, index);

      if (resolved === undefined) {
        if (BANNED_BARE.some((re) => re.test(spec))) {
          violations.push({
            rule: "P3",
            file: current,
            specifier: spec,
            chain: chainOf(current),
            message: `${current} imports "${spec}", a database/server package, and is reachable from the proxy.`,
          });
        }
        continue; // other bare specifiers (next/server, node:crypto, ...) are fine
      }

      if (resolved === null) {
        if (NON_CODE_EXT_RE.test(spec)) continue;
        violations.push({
          rule: "P4",
          file: current,
          specifier: spec,
          chain: chainOf(current),
          message: `${current} imports "${spec}", which does not resolve to a source file. A hole in the graph could hide a violation, so it fails.`,
        });
        continue;
      }

      const why = forbiddenPath(resolved, allow);
      if (why !== null) {
        violations.push({
          rule: "P1",
          file: current,
          specifier: spec,
          chain: [...chainOf(current), resolved],
          message: `${current} imports "${spec}" (${resolved}), which is under ${why} and must not be reachable from the proxy.`,
        });
        continue; // do not walk into a forbidden module: one violation per edge is enough
      }

      if (!parent.has(resolved)) {
        parent.set(resolved, current);
        queue.push(resolved);
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
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(e.name) && !/\.test\.[tj]sx?$/.test(e.name)) yield full;
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-proxy-imports.mjs");

if (isMain) {
  const files = [];
  for await (const file of walk(SRC)) {
    files.push({
      path: path.relative(ROOT, file).split(path.sep).join("/"),
      content: await fs.readFile(file, "utf8"),
    });
  }

  const violations = checkProxyImports(files);

  if (violations.length > 0) {
    console.error("Proxy-imports check FAILED:\n");
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.file}${v.specifier ? `  ->  ${v.specifier}` : ""}`);
      console.error(`  ${v.message}`);
      console.error(`  chain: ${v.chain.join("  ->  ")}`);
      console.error("");
    }
    console.error("  Why this matters: src/proxy.ts runs on every matched request on Node.js (F146).");
    console.error("  It must stay a pure function of host, path and session claims (DECISION-177);");
    console.error("  a database or tenant read there is a second enumeration-sensitive path.");
    console.error("");
    process.exit(1);
  }

  console.log("Proxy-imports check passed.");
}
