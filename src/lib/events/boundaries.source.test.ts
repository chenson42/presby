/**
 * Source-scan tripwires for the event writers' import boundaries (worship
 * Increment 1, Batch 0; DECISION-326; architect addendum C1 and C2). DB-free:
 * these read source text, so a violation fails without a database.
 *
 * C1 - no import cycle through the hook list. `events/hooks.ts` imports its
 *      consumers (worship's `event-hooks.ts`, sign-ups' hook file); a consumer
 *      must never import `@/lib/events` (the file), `events/mutate.ts`,
 *      `events/hooks.ts`, `events/insert.ts` or `worship/store.ts`, directly OR
 *      through any file it imports. The walk is transitive because a cycle is
 *      transitive by nature. `import type` is erased and allowed. While the
 *      hook lists are empty (Batch 0) the scan is satisfied vacuously; the
 *      offending samples below prove it can fail.
 *
 * C2 - `events/mutate.ts` checks no permission, so who may import it IS its
 *      access control: `events.ts` (after `events.manage`) and
 *      `worship/store.ts` (after `worship.plan` plus the join that proves the
 *      event carries a `worship_services` row). A third importer is an event
 *      writer with no gate of its own.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..", "..");

const HOOKS = "src/lib/events/hooks.ts";
const FORBIDDEN_FOR_CONSUMERS = new Set([
  "src/lib/events.ts",
  "src/lib/events/mutate.ts",
  "src/lib/events/hooks.ts",
  "src/lib/events/insert.ts",
  "src/lib/worship/store.ts",
]);
const MUTATE = "src/lib/events/mutate.ts";
const ALLOWED_MUTATE_IMPORTERS = ["src/lib/events.ts", "src/lib/worship/store.ts"];

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:\\"'`])\/\/.*$/gm, "$1");
}

/**
 * The module specifiers a file loads at RUNTIME: `import x from "m"`,
 * `import "m"`, `export ... from "m"`, and `import("m")`. A type-only import is
 * erased and excluded: `import type ...`, `export type ... from`, and an import
 * whose every named specifier is inline `type`.
 */
function runtimeImports(source: string): string[] {
  const code = stripComments(source);
  const out: string[] = [];

  const statement = /\b(import|export)\s+(type\s+)?([^;"'`]*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(statement)) {
    const [, , typeKeyword, clause, spec] = m;
    if (typeKeyword) continue;
    const named = /^\{([\s\S]*)\}$/.exec(clause!.trim());
    if (named) {
      const specifiers = named[1]!.split(",").map((s) => s.trim()).filter(Boolean);
      if (specifiers.length > 0 && specifiers.every((s) => /^type\s/.test(s))) continue;
    }
    out.push(spec!);
  }
  for (const m of code.matchAll(/\bimport\s*["']([^"']+)["']/g)) out.push(m[1]!);
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]!);
  return out;
}

/** `@/x` and relative specifiers to a repo-relative source path; bare packages to null. */
function resolveSpecifier(
  fromRel: string,
  spec: string,
  exists: (rel: string) => boolean,
): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else return null;
  // A file beats a directory of the same name (`@/lib/events` is `events.ts`, not `events/`).
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.(ts|tsx)$/.test(candidate) && exists(candidate)) return candidate;
  }
  return null;
}

type Graph = {
  read: (rel: string) => string;
  exists: (rel: string) => boolean;
};

/**
 * Every (importer -> forbidden target) edge reachable from `start` through
 * runtime imports. Returns human-readable paths.
 */
function forbiddenReachable(start: string, graph: Graph): string[] {
  const violations: string[] = [];
  const seen = new Set<string>([start]);
  const queue: Array<{ file: string; trail: string[] }> = [{ file: start, trail: [start] }];
  while (queue.length > 0) {
    const { file, trail } = queue.shift()!;
    for (const spec of runtimeImports(graph.read(file))) {
      const target = resolveSpecifier(file, spec, graph.exists);
      if (!target) continue;
      if (FORBIDDEN_FOR_CONSUMERS.has(target)) {
        violations.push([...trail, target].join(" -> "));
        continue;
      }
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push({ file: target, trail: [...trail, target] });
    }
  }
  return violations;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.posix.join(dir, name);
    const full = path.join(ROOT, rel);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const realGraph: Graph = {
  read,
  exists: (rel) => existsSync(path.join(ROOT, rel)),
};

describe("event writers' import boundaries", () => {
  describe("C1: nothing reachable from events/hooks.ts imports an event writer", () => {
    it("the real graph has no path back to events.ts, mutate.ts, hooks.ts, insert.ts or worship/store.ts", () => {
      expect(forbiddenReachable(HOOKS, realGraph)).toEqual([]);
    });

    it("the scan can fail: a consumer importing @/lib/events directly is caught", () => {
      const files: Record<string, string> = {
        [HOOKS]: `import { onCancelled } from "@/lib/worship/event-hooks";`,
        "src/lib/worship/event-hooks.ts": `import { cancelEvent } from "@/lib/events";`,
        "src/lib/events.ts": "",
      };
      const graph: Graph = { read: (rel) => files[rel] ?? "", exists: (rel) => rel in files };
      expect(forbiddenReachable(HOOKS, graph)).toEqual([
        `${HOOKS} -> src/lib/worship/event-hooks.ts -> src/lib/events.ts`,
      ]);
    });

    it("the scan is transitive: a consumer reaching worship/store.ts through a helper is caught", () => {
      const files: Record<string, string> = {
        [HOOKS]: `import { h } from "@/lib/worship/event-hooks";`,
        "src/lib/worship/event-hooks.ts": `import { notify } from "./notify";`,
        "src/lib/worship/notify.ts": `export * from "@/lib/worship/store";`,
        "src/lib/worship/store.ts": "",
      };
      const graph: Graph = { read: (rel) => files[rel] ?? "", exists: (rel) => rel in files };
      expect(forbiddenReachable(HOOKS, graph)).toEqual([
        `${HOOKS} -> src/lib/worship/event-hooks.ts -> src/lib/worship/notify.ts -> src/lib/worship/store.ts`,
      ]);
    });

    it("a type-only import of a forbidden file is erased and allowed", () => {
      const files: Record<string, string> = {
        [HOOKS]: `import { h } from "@/lib/worship/event-hooks";`,
        "src/lib/worship/event-hooks.ts": [
          `import type { EventActor } from "@/lib/events/insert";`,
          `import { type EventHookResult } from "@/lib/events/hooks";`,
          `import type { Anything } from "@/lib/events";`,
        ].join("\n"),
        "src/lib/events/insert.ts": "",
        "src/lib/events.ts": "",
      };
      const graph: Graph = { read: (rel) => files[rel] ?? "", exists: (rel) => rel in files };
      expect(forbiddenReachable(HOOKS, graph)).toEqual([]);
    });

    it("the real hooks.ts imports only types from the writers (its own argument types)", () => {
      const direct = runtimeImports(read(HOOKS))
        .map((spec) => resolveSpecifier(HOOKS, spec, realGraph.exists))
        .filter((rel): rel is string => rel !== null);
      expect(direct.filter((rel) => FORBIDDEN_FOR_CONSUMERS.has(rel))).toEqual([]);
    });

    it("runtimeImports reads every static form and skips only erased ones", () => {
      const src = [
        `import a from "@/a";`,
        `import { b, type C } from "@/b";`,
        `import { type D } from "@/d";`,
        `import type E from "@/e";`,
        `import "@/side-effect";`,
        `export { f } from "@/f";`,
        `export type { G } from "@/g";`,
        `const lazy = await import("@/lazy");`,
        `// import x from "@/commented";`,
      ].join("\n");
      expect(runtimeImports(src).sort()).toEqual(
        ["@/a", "@/b", "@/f", "@/lazy", "@/side-effect"].sort(),
      );
    });

    it("resolveSpecifier: `@/lib/events` is the file, not the directory", () => {
      const have = new Set(["src/lib/events.ts", "src/lib/events/insert.ts"]);
      expect(resolveSpecifier(HOOKS, "@/lib/events", (r) => have.has(r))).toBe("src/lib/events.ts");
      expect(resolveSpecifier(HOOKS, "@/lib/events/insert", (r) => have.has(r))).toBe(
        "src/lib/events/insert.ts",
      );
      expect(resolveSpecifier(HOOKS, "react", (r) => have.has(r))).toBeNull();
    });
  });

  describe("C2: events/mutate.ts has exactly the importers that gate it", () => {
    function importersOf(target: string, graph: { files: string[]; read: (rel: string) => string }) {
      const have = new Set(graph.files);
      return graph.files
        .filter((rel) => rel !== target)
        .filter((rel) =>
          runtimeImports(graph.read(rel)).some(
            (spec) => resolveSpecifier(rel, spec, (r) => have.has(r)) === target,
          ),
        )
        .sort();
    }

    it("exactly events.ts and worship/store.ts import it (equality, both directions: a missing importer is as much a change as an extra one)", () => {
      const importers = importersOf(MUTATE, { files: sourceFiles("src"), read });
      expect(importers).toEqual([...ALLOWED_MUTATE_IMPORTERS].sort());
    });

    it("the scan can fail: a third importer is seen", () => {
      const files: Record<string, string> = {
        "src/lib/events.ts": `import { cancelEventInTx } from "@/lib/events/mutate";`,
        "src/lib/worship/store.ts": `import { cancelEventInTx } from "@/lib/events/mutate";`,
        "src/lib/worship/reads.ts": `import { cancelEventInTx } from "@/lib/events/mutate";`,
        "src/lib/other/type-only.ts": `import type { X } from "@/lib/events/mutate";`,
        [MUTATE]: "",
      };
      const importers = importersOf(MUTATE, {
        files: Object.keys(files),
        read: (rel) => files[rel] ?? "",
      });
      expect(importers).toEqual(["src/lib/events.ts", "src/lib/worship/reads.ts", "src/lib/worship/store.ts"]);
      expect(importers.filter((rel) => !ALLOWED_MUTATE_IMPORTERS.includes(rel))).toEqual([
        "src/lib/worship/reads.ts",
      ]);
    });
  });
});
