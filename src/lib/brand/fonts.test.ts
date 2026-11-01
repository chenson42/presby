// `next/font/local`'s real export is populated only by Next's SWC compiler
// plugin at build time (`node_modules/next/font/local/index.js` is a blank
// file outside that transform) — the exact reason
// `admin/organizations/[id]/actions.test.ts` and `tickets/actions.test.ts`
// both mock any module that transitively imports `fonts.ts` rather than let
// it load for real under plain Node Vitest. This file needs the real
// `fonts.ts` module (that's what's under test), so it mocks
// `next/font/local` itself instead, one level closer to the boundary: each
// mocked loader returns the same shape the real one does (`{ className }`)
// so `RESOLVED_PAIRINGS`' `.className` reads and `resolveTypePairing()`'s
// object lookup both exercise the real code path.
import { vi, describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

vi.mock("next/font/local", () => {
  // Same shape the real loader returns ({ className, variable }). One default
  // export serves all eight faces; the class name carries the font file path
  // and the CSS variable, so a face wired to the wrong file shows in a test.
  const localFont = (opts: { src: string; variable: string }) => ({
    className: `mock-${opts.src}-${opts.variable}`,
    variable: opts.variable,
  });
  return { default: localFont };
});

const { TYPE_PAIRINGS } = await import("./contract");
const { resolveTypePairing } = await import("./fonts");

/**
 * Guards the exact failure mode Phase 2 of
 * docs/work-log/2026-08-24-custom-brand-fonts.md named: an entry added to
 * `TYPE_PAIRINGS` (contract.ts) without a matching `RESOLVED_PAIRINGS` entry
 * (fonts.ts) is a `tsc` failure today (the `as const satisfies
 * Record<TypePairingKey, ResolvedTypePairing>` on `RESOLVED_PAIRINGS`), but
 * this test makes the same guarantee visible to `npm run test`, independent
 * of the type checker, and pins the count so a silently-dropped pairing is
 * caught here too.
 */
describe("resolveTypePairing", () => {
  it("has exactly four curated pairings", () => {
    expect(TYPE_PAIRINGS.length).toBe(4);
    expect(TYPE_PAIRINGS.map((p) => p.key).sort()).toEqual(
      ["classic", "contemporary", "modern", "warm"].sort(),
    );
  });

  it.each(TYPE_PAIRINGS.map((p) => p.key))(
    "resolves %s to a font pairing without throwing",
    (key) => {
      const resolved = resolveTypePairing(key);
      expect(resolved.headingClassName).toEqual(expect.any(String));
      expect(resolved.headingClassName.length).toBeGreaterThan(0);
      expect(resolved.bodyClassName).toEqual(expect.any(String));
      expect(resolved.bodyClassName.length).toBeGreaterThan(0);
      expect(resolved.headingVariable).toMatch(/^--font-heading-/);
      expect(resolved.bodyVariable).toMatch(/^--font-body-/);
      // DECISION-143: the wiring mechanism (fonts.ts exposes next/font's
      // .variable class; globals.css's static .pairing-<key> rules alias the
      // generic property onto it). Every resolved pairing must carry all
      // three fields the three call sites apply alongside bodyClassName.
      expect(resolved.headingVariableClassName).toEqual(expect.any(String));
      expect(resolved.headingVariableClassName.length).toBeGreaterThan(0);
      expect(resolved.bodyVariableClassName).toEqual(expect.any(String));
      expect(resolved.bodyVariableClassName.length).toBeGreaterThan(0);
      expect(resolved.pairingClassName).toBe(`pairing-${key}`);
    },
  );

  // BRAND_UTILITY_RE, copied verbatim from scripts/check-brand-scope.mjs
  // (not imported: that script is a build tripwire over source text, not a
  // module with a stable export surface). Guards Phase 2 Ruling 3's warning
  // (i): a `pairing-<key>` class name must never match the pattern that
  // gates `*-brand*` utilities to the two brandable route groups, because
  // this class is applied inside `(auth)/signin`, which is not one of them.
  const BRAND_UTILITY_RE =
    /(?<![a-zA-Z0-9-])(bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|shadow|accent|caret|divide|placeholder)-brand(-[a-z0-9]+)*(?![a-zA-Z0-9])/;

  it.each(TYPE_PAIRINGS.map((p) => p.key))(
    "%s's pairingClassName never matches the *-brand* utility pattern (C1 scope)",
    (key) => {
      const resolved = resolveTypePairing(key);
      expect(BRAND_UTILITY_RE.test(resolved.pairingClassName)).toBe(false);
    },
  );

  it("round-trips the new contemporary pairing to its own Montserrat/Open Sans CSS variables", () => {
    const resolved = resolveTypePairing("contemporary");
    expect(resolved.headingVariable).toBe("--font-heading-contemporary");
    expect(resolved.bodyVariable).toBe("--font-body-contemporary");
    expect(resolved.headingClassName).toContain("montserrat");
    expect(resolved.bodyClassName).toContain("open-sans");
  });
});

/**
 * Self-hosting guards (docs/work-log/2026-11-01-self-host-fonts.md). Builds
 * once failed at random because `next/font/google` fetches Google Fonts at
 * build time (vercel/next.js#99114). These pin the replacement: every font
 * file the app names is committed, is really woff2, and sits beside its
 * licence, and nothing in `src/` imports `next/font/google` again.
 */
describe("self-hosted fonts", () => {
  const root = path.resolve(__dirname, "../..");
  const callers = [
    path.join(root, "lib/brand/fonts.ts"),
    path.join(root, "app/layout.tsx"),
  ];
  const named = callers.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/src:\s*"([^"]+\.woff2)"/g)].map(
      (m) => path.resolve(path.dirname(file), m[1]),
    ),
  );

  it("names nine font files: eight pairing faces and the platform's Inter", () => {
    expect(named.length).toBe(9);
    expect(new Set(named).size).toBe(9);
  });

  it.each(named.map((f) => [path.relative(root, f), f]))(
    "%s exists, is woff2 (wOF2 magic bytes) and has an OFL.txt beside it",
    (_label, file) => {
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file).subarray(0, 4).toString("latin1")).toBe("wOF2");
      expect(existsSync(path.join(path.dirname(file), "OFL.txt"))).toBe(true);
    },
  );

  it("every committed font directory is used and holds only a woff2 and an OFL.txt", () => {
    const base = path.join(root, "lib/brand/font-files");
    const used = new Set(named.map((f) => path.dirname(f)));
    for (const dir of readdirSync(base)) {
      const full = path.join(base, dir);
      expect(statSync(full).isDirectory()).toBe(true);
      expect(used.has(full)).toBe(true);
      expect(readdirSync(full).sort()).toEqual(
        [`${dir}-latin-variable.woff2`, "OFL.txt"].sort(),
      );
    }
  });

  it("nothing in src/ imports next/font/google — regression for the Turbopack font-query build failure", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          !entry.name.endsWith("fonts.test.ts")
        ) {
          if (
            /from\s+["']next\/font\/google["']|mock\(\s*["']next\/font\/google["']/.test(
              readFileSync(full, "utf8"),
            )
          ) {
            hits.push(path.relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
