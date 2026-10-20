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

const CODE_EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs"];
const NON_CODE_EXT_RE = /\.(css|json|svg|png|jpe?g|gif|webp|ico|woff2?|txt|md|sql)$/i;

/**
 * Removes comments, keeping string and template literal contents intact (the
 * specifiers live in strings). Replaces each comment with spaces/newlines so
 * line numbers are preserved. Regex literals are not modelled (a `/` after an
 * operator is treated as division); an exotic regex containing a quote is the
 * only way to desync it, and the failure direction is a spurious violation.
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < n) {
          out += src[i] + src[i + 1];
          i += 2;
          continue;
        }
        if (quote !== "`" && src[i] === "\n") break; // unterminated: resync at the newline
        out += src[i];
        i++;
      }
      if (i < n && src[i] === quote) {
        out += quote;
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const STATIC_FROM_RE = /(?:^|[\s;}])(import|export)(\s+type\b)?([^"'`;]*?)\bfrom\s*["']([^"']+)["']/g;
const SIDE_EFFECT_RE = /(?:^|[\s;}])import\s*["']([^"']+)["']/g;
const DYNAMIC_RE = /\b(?:import|require)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
const SERVER_ONLY_RE = /(?:^|[\s;}])import\s*["']server-only["']|\brequire\s*\(\s*["']server-only["']\s*\)/;

/** Every module specifier a (comment-stripped) file imports at runtime. */
export function importSpecifiers(code) {
  const found = new Set();
  for (const m of code.matchAll(STATIC_FROM_RE)) {
    const isTypeOnly = Boolean(m[2]);
    if (isTypeOnly) continue; // erased
    found.add(m[4]);
  }
  for (const m of code.matchAll(SIDE_EFFECT_RE)) found.add(m[1]);
  for (const m of code.matchAll(DYNAMIC_RE)) found.add(m[1]);
  return [...found];
}

function normalize(p) {
  const parts = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** Resolves an in-repo specifier to a file path in `index`, or null. */
function resolveSpecifier(spec, fromPath, index) {
  let base;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
    base = normalize(`${dir}/${spec}`);
  } else return undefined; // bare specifier: not in-repo
  const candidates = [
    base,
    ...CODE_EXTS.map((e) => base + e),
    ...CODE_EXTS.map((e) => `${base}/index${e}`),
  ];
  for (const c of candidates) if (index.has(c)) return c;
  return null;
}

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
