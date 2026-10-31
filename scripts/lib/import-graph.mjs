/**
 * The import-graph primitives shared by the boundary tripwires (P3-3, user-help Increment 1).
 *
 * Lifted out of scripts/check-proxy-imports.mjs, which now imports them and re-exports
 * `stripComments` and `importSpecifiers`; its behaviour is unchanged and its own test file
 * (scripts/check-proxy-imports.test.mjs) is the guard. A second consumer, the help import
 * boundary (scripts/lib/help-boundary.mjs, rule H19), walks the same way through
 * `checkImportBoundary`.
 *
 * Pure: nothing here reads the disk. `files` is Array<{ path, content }> with POSIX paths
 * relative to the repo root.
 *
 * `import type ...` and `export type ... from` are erased by the compiler and are not followed.
 * Comments are stripped before scanning (a commented-out import is not an import) with a scanner
 * that respects string and template literals. Not a proof; a tripwire. It sees specifiers, not
 * runtime `eval`.
 */

export const CODE_EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs"];
export const NON_CODE_EXT_RE = /\.(css|json|svg|png|jpe?g|gif|webp|ico|woff2?|txt|md|sql)$/i;

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
export const SERVER_ONLY_RE =
  /(?:^|[\s;}])import\s*["']server-only["']|\brequire\s*\(\s*["']server-only["']\s*\)/;

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

/** Collapses `.` and `..` segments of a POSIX path. */
export function normalize(p) {
  const parts = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** The path a specifier names before extension and index fallbacks, or undefined for a bare one. */
export function specifierBase(spec, fromPath) {
  if (spec.startsWith("@/")) return `src/${spec.slice(2)}`;
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
    return normalize(`${dir}/${spec}`);
  }
  return undefined;
}

/**
 * Resolves an in-repo specifier to a file path in `index`, or null when it names nothing in the
 * index; undefined for a bare (package) specifier, which is not in-repo.
 */
export function resolveSpecifier(spec, fromPath, index) {
  const base = specifierBase(spec, fromPath);
  if (base === undefined) return undefined;
  const candidates = [
    base,
    ...CODE_EXTS.map((e) => base + e),
    ...CODE_EXTS.map((e) => `${base}/index${e}`),
  ];
  for (const c of candidates) if (index.has(c)) return c;
  return null;
}

/**
 * Walks the runtime import graph from every entry and reports what reaches a banned module.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @param {{
 *   entries: string[],
 *   ban: { path?: (rel: string) => (string | null), bare?: RegExp[] },
 *   serverOnly?: boolean,
 *   stopAt?: string[],
 * }} options
 *   `ban.path(rel)` returns a label when `rel` (a resolved in-repo path) is banned, else null;
 *   `ban.bare` lists banned package specifiers. `serverOnly` makes a reachable
 *   `import "server-only"` a violation (the proxy's rule; help allows it). `stopAt` lists in-repo
 *   files that are REACHED and counted but whose source is not scanned and whose imports are not
 *   followed (default none, so check:proxy-imports is unchanged). A stop file is a deliberate,
 *   named seam, such as a `"use server"` action whose server half the caller guards another way
 *   (DECISION-304).
 * @returns {Array<{ rule: string, file: string, specifier?: string, chain: string[], message: string }>}
 *   P1 a banned in-repo path; P2 server-only (opt-in); P3 a banned package; P4 a hole in the graph
 *   (an entry or an in-repo specifier that resolves to no file) which must fail loudly rather than
 *   hide a violation behind it.
 */
export function checkImportBoundary(files, options) {
  const { entries, ban = {}, serverOnly = false, stopAt = [] } = options;
  const stops = new Set(stopAt);
  const banPath = ban.path ?? (() => null);
  const banBare = ban.bare ?? [];
  const index = new Map(files.map((f) => [f.path, f.content]));
  const violations = [];
  const parent = new Map();
  const queue = [];

  for (const entry of entries) {
    if (!index.has(entry)) {
      violations.push({
        rule: "P4",
        file: entry,
        chain: [entry],
        message: `entry point ${entry} not found; the guard cannot walk it.`,
      });
      continue;
    }
    if (!parent.has(entry)) {
      parent.set(entry, null);
      queue.push(entry);
    }
  }

  const chainOf = (p) => {
    const chain = [];
    for (let cur = p; cur !== null && cur !== undefined; cur = parent.get(cur)) chain.unshift(cur);
    return chain;
  };

  while (queue.length > 0) {
    const current = queue.shift();
    if (stops.has(current)) continue; // reached and counted, never scanned or followed
    const code = stripComments(index.get(current));

    if (serverOnly && SERVER_ONLY_RE.test(code)) {
      violations.push({
        rule: "P2",
        file: current,
        chain: chainOf(current),
        message: `${current} imports "server-only" and is reachable from a boundary entry. A server-only module cannot be a dependency here.`,
      });
    }

    for (const spec of importSpecifiers(code)) {
      const resolved = resolveSpecifier(spec, current, index);

      if (resolved === undefined) {
        if (banBare.some((re) => re.test(spec))) {
          violations.push({
            rule: "P3",
            file: current,
            specifier: spec,
            chain: chainOf(current),
            message: `${current} imports "${spec}", a package this boundary bans.`,
          });
        }
        continue; // other bare specifiers (next/server, node:crypto, ...) are fine
      }

      if (resolved === null) {
        if (NON_CODE_EXT_RE.test(spec)) continue;
        // A banned module that happens to be missing from the file list must not turn into a
        // mere hole: judge the path the specifier names first.
        const named = specifierBase(spec, current);
        const why = named === undefined ? null : banPath(named);
        if (why) {
          violations.push({
            rule: "P1",
            file: current,
            specifier: spec,
            chain: [...chainOf(current), named],
            message: `${current} imports "${spec}" (${named}), which is under ${why} and must not be reachable here.`,
          });
          continue;
        }
        violations.push({
          rule: "P4",
          file: current,
          specifier: spec,
          chain: chainOf(current),
          message: `${current} imports "${spec}", which does not resolve to a source file. A hole in the graph could hide a violation, so it fails.`,
        });
        continue;
      }

      const why = banPath(resolved);
      if (why) {
        violations.push({
          rule: "P1",
          file: current,
          specifier: spec,
          chain: [...chainOf(current), resolved],
          message: `${current} imports "${spec}" (${resolved}), which is under ${why} and must not be reachable here.`,
        });
        continue; // do not walk into a banned module: one violation per edge is enough
      }

      if (!parent.has(resolved)) {
        parent.set(resolved, current);
        queue.push(resolved);
      }
    }
  }

  return violations;
}
