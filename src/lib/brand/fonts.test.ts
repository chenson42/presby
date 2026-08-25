// `next/font/google`'s real export is populated only by Next's SWC compiler
// plugin at build time (`node_modules/next/font/google/index.js` is a blank
// file outside that transform) — the exact reason
// `admin/organizations/[id]/actions.test.ts` and `tickets/actions.test.ts`
// both mock any module that transitively imports `fonts.ts` rather than let
// it load for real under plain Node Vitest. This file needs the real
// `fonts.ts` module (that's what's under test), so it mocks
// `next/font/google` itself instead, one level closer to the boundary: each
// mocked loader returns the same shape the real one does (`{ className }`)
// so `RESOLVED_PAIRINGS`' `.className` reads and `resolveTypePairing()`'s
// object lookup both exercise the real code path.
import { vi, describe, it, expect } from "vitest";

vi.mock("next/font/google", () => {
  const fakeLoader = (name: string) => (opts: { variable: string }) => ({
    className: `mock-${name}-${opts.variable}`,
    variable: opts.variable,
  });
  return {
    Lora: fakeLoader("lora"),
    Source_Sans_3: fakeLoader("source-sans-3"),
    Libre_Franklin: fakeLoader("libre-franklin"),
    Public_Sans: fakeLoader("public-sans"),
    Bitter: fakeLoader("bitter"),
    Karla: fakeLoader("karla"),
    Montserrat: fakeLoader("montserrat"),
    Open_Sans: fakeLoader("open-sans"),
  };
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
