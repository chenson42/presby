/**
 * Fixture tests for the brand-scope tripwire.
 *
 * C1 has nothing real to catch until slice c introduces the additive
 * `--brand-*` tokens. C2 was dormant through the sweep (a1–a7) and went live
 * at commit a8 (2026-08-19), once the census was cleared to zero tree-wide. A
 * rule with no live violations is a rule nobody has proved works, so the proof
 * is here: synthetic files fed straight to checkBrandScope(), which is why that
 * function takes an array of { path, content } rather than reading the disk.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import {
  checkBrandScope,
  isCommentLine,
  EMITTERS,
} from "./check-brand-scope.mjs";

/** @param {string} path @param {string} content */
const f = (path, content) => ({ path, content });

const rules = (violations) => violations.map((v) => v.rule);

describe("EMITTERS allowlist", () => {
  // DECISION-047 as amended by the branded-signin pipeline
  // (docs/work-log/2026-08-24-branded-signin.md): the brand reaches exactly
  // three files, two layouts and one page. A fourth appearing here should be
  // a deliberate edit with a decision behind it, not a quiet append.
  it("is exactly the three brandable files", () => {
    expect(EMITTERS.map((e) => e.path)).toEqual([
      "src/app/(org)/o/[slug]/layout.tsx",
      "src/app/(public)/site/[slug]/layout.tsx",
      "src/app/(auth)/signin/page.tsx",
    ]);
  });
});

describe("isCommentLine", () => {
  it("recognises the four comment forms that carry the guarded strings", () => {
    expect(isCommentLine("  // no dangerouslySetInnerHTML")).toBe(true);
    expect(isCommentLine("/* block */")).toBe(true);
    expect(isCommentLine(" * JSDoc continuation")).toBe(true);
    expect(isCommentLine("  {/* Plain text — no dangerouslySetInnerHTML */}")).toBe(
      true,
    );
  });

  it("does not swallow code", () => {
    expect(isCommentLine('  <div className="bg-brand" />')).toBe(false);
  });
});

// ── E1 — emitter containment (live) ─────────────────────────────────────────

describe("E1 — emitter containment", () => {
  it("flags <BrandTokens> in a file outside EMITTERS", () => {
    const v = checkBrandScope([
      f("src/app/(admin)/admin/layout.tsx", "return <BrandTokens brand={b} />;"),
    ]);
    expect(rules(v)).toEqual(["E1"]);
    expect(v[0].line).toBe(1);
  });

  it("allows <BrandTokens> in an allowlisted layout", () => {
    const v = checkBrandScope([
      f("src/app/(org)/o/[slug]/layout.tsx", "return <BrandTokens brand={b} />;"),
    ]);
    expect(v).toEqual([]);
  });

  it("does not fire on a comment mentioning the marker", () => {
    const v = checkBrandScope([
      f("src/app/(member)/home/page.tsx", "// never render <BrandTokens> here"),
    ]);
    expect(v).toEqual([]);
  });

  it("does not fire on a longer identifier", () => {
    const v = checkBrandScope([
      f("src/app/(member)/home/page.tsx", "return <BrandTokensPreview />;"),
    ]);
    expect(v).toEqual([]);
  });
});

// ── E2 — emitter presence (live for (org) as of commit c4, 2026-08-19; live
// for (public) as of the public-sites pipeline's Phase 4 commit 3/3,
// 2026-08-20) ────────────────────────────────────────────────────────────

describe("E2 — emitter presence", () => {
  it("flags a required emitter that exists without the marker (synthetic (public) stand-in)", () => {
    const emitters = [
      { path: "src/app/(public)/site/[slug]/layout.tsx", required: true },
    ];
    const v = checkBrandScope(
      [f("src/app/(public)/site/[slug]/layout.tsx", "return <div>{children}</div>;")],
      { emitters },
    );
    expect(rules(v)).toEqual(["E2"]);
  });

  it("flags a required emitter that exists without the marker", () => {
    const emitters = [{ path: "src/app/(org)/o/[slug]/layout.tsx", required: true }];
    const v = checkBrandScope(
      [f("src/app/(org)/o/[slug]/layout.tsx", "return <div>{children}</div>;")],
      { emitters },
    );
    expect(rules(v)).toEqual(["E2"]);
  });

  it("passes when the required emitter renders the marker", () => {
    const emitters = [{ path: "src/app/(org)/o/[slug]/layout.tsx", required: true }];
    const v = checkBrandScope(
      [f("src/app/(org)/o/[slug]/layout.tsx", "return <BrandTokens brand={b} />;")],
      { emitters },
    );
    expect(v).toEqual([]);
  });

  it("does not flag a required emitter whose file does not exist yet", () => {
    const emitters = [
      { path: "src/app/(public)/site/[slug]/layout.tsx", required: true },
    ];
    const v = checkBrandScope([f("src/app/page.tsx", "export default X;")], {
      emitters,
    });
    expect(v).toEqual([]);
  });

  // Live against the REAL (default) EMITTERS array as of commit c4
  // (2026-08-19) — no `{ emitters }` override. `(org)/o/[slug]/layout.tsx`
  // flipped to `required: true` at c4; `(public)/site/[slug]/layout.tsx`
  // flipped to `required: true` in the public-sites pipeline's Phase 4
  // commit 3/3 (2026-08-20). This is the demonstration Note 11's shape asks
  // for: failing before the marker exists, passing after — proven here
  // rather than only against a synthetic override.
  it("flags the real (org) layout under the default EMITTERS array if the marker is ever removed", () => {
    const v = checkBrandScope([
      f("src/app/(org)/o/[slug]/layout.tsx", "return <main>{children}</main>;"),
    ]);
    expect(rules(v)).toEqual(["E2"]);
    expect(v[0].file).toBe("src/app/(org)/o/[slug]/layout.tsx");
  });

  it("passes under the default EMITTERS array now that the real (org) layout renders the marker", () => {
    const v = checkBrandScope([
      f(
        "src/app/(org)/o/[slug]/layout.tsx",
        '<BrandTokens brand={orgBrand?.tokens ?? null} />\nreturn <main>{children}</main>;',
      ),
    ]);
    expect(v).toEqual([]);
  });

  it("flags the real (public) layout under the default EMITTERS array if the marker is ever removed", () => {
    const v = checkBrandScope([
      f(
        "src/app/(public)/site/[slug]/layout.tsx",
        "return <main>{children}</main>;",
      ),
    ]);
    expect(rules(v)).toEqual(["E2"]);
    expect(v[0].file).toBe("src/app/(public)/site/[slug]/layout.tsx");
  });

  it("passes under the default EMITTERS array now that the real (public) layout renders the marker", () => {
    const v = checkBrandScope([
      f(
        "src/app/(public)/site/[slug]/layout.tsx",
        "<BrandTokens brand={brand?.tokens ?? null} />\nreturn <main>{children}</main>;",
      ),
    ]);
    expect(v).toEqual([]);
  });

  // Live against the REAL (default) EMITTERS array as of the branded-signin
  // pipeline's Phase 4 commit (2026-08-24) — the third emitter,
  // `(auth)/signin/page.tsx`, landed `required: true` in the same commit as
  // the emission itself (no "file doesn't exist yet" dormant period, unlike
  // the earlier two entries).
  it("flags the real /signin page under the default EMITTERS array if the marker is ever removed", () => {
    const v = checkBrandScope([
      f("src/app/(auth)/signin/page.tsx", "return <main>Sign in</main>;"),
    ]);
    expect(rules(v)).toEqual(["E2"]);
    expect(v[0].file).toBe("src/app/(auth)/signin/page.tsx");
  });

  it("passes under the default EMITTERS array now that the real /signin page renders the marker", () => {
    const v = checkBrandScope([
      f(
        "src/app/(auth)/signin/page.tsx",
        "<BrandTokens brand={siteBrand?.brand?.tokens ?? null} />\nreturn <main>Sign in</main>;",
      ),
    ]);
    expect(v).toEqual([]);
  });

  it("a required emitter whose file is absent from the input is not flagged — the file-does-not-exist-yet path", () => {
    const v = checkBrandScope([
      f("src/app/page.tsx", "export default function Home() { return null; }"),
    ]);
    expect(v).toEqual([]);
  });
});

// ── E3 — no second emitter (live) ───────────────────────────────────────────

describe("E3 — no second emitter", () => {
  it("flags a <style> element outside src/components/brand/", () => {
    // page.tsx, not layout.tsx: layout.tsx is a required E2 emitter as of
    // commit c4, and this fixture is testing E3 in isolation, not E2.
    const v = checkBrandScope([
      f("src/app/(org)/o/[slug]/page.tsx", "return <style>{css}</style>;"),
    ]);
    expect(rules(v)).toEqual(["E3"]);
  });

  it("allows <style> inside src/components/brand/", () => {
    const v = checkBrandScope([
      f("src/components/brand/brand-tokens.tsx", "return <style>{cssText}</style>;"),
    ]);
    expect(v).toEqual([]);
  });

  it("flags dangerouslySetInnerHTML outside src/components/brand/", () => {
    const v = checkBrandScope([
      f(
        "src/app/(member)/home/page.tsx",
        "<div dangerouslySetInnerHTML={{ __html: body }} />",
      ),
    ]);
    expect(rules(v)).toEqual(["E3"]);
  });

  it("does not fire on the three real comments asserting the XSS invariant (E10)", () => {
    const v = checkBrandScope([
      f(
        "src/app/(member)/whats-new/page.tsx",
        "              {/* XSS invariant: all content rendered as JSX text nodes — no dangerouslySetInnerHTML */}",
      ),
      f(
        "src/app/(admin)/admin/feedback/page.tsx",
        [
          "// is rendered as plain JSX text nodes. No dangerouslySetInnerHTML, no markdown.",
          "                          {/* Plain text — no dangerouslySetInnerHTML, no markdown */}",
        ].join("\n"),
      ),
    ]);
    expect(v).toEqual([]);
  });

  it("does not fire on a bare mention without an assignment", () => {
    const v = checkBrandScope([
      f("src/lib/sanitize.ts", "const forbidden = ['dangerouslySetInnerHTML'];"),
    ]);
    expect(v).toEqual([]);
  });
});

// ── C1 — brand-class containment (live, vacuous against today's tree) ───────

describe("C1 — brand-class containment", () => {
  it("flags a bg-brand utility in an un-brandable group", () => {
    const v = checkBrandScope([
      f("src/app/(admin)/admin/page.tsx", '<div className="bg-brand p-4" />'),
    ]);
    expect(rules(v)).toEqual(["C1"]);
  });

  it("flags a multi-segment brand utility", () => {
    const v = checkBrandScope([
      f("src/components/shared/hero.tsx", '<div className="bg-brand-raw" />'),
    ]);
    expect(rules(v)).toEqual(["C1"]);
  });

  it("flags an opacity-modified brand utility", () => {
    const v = checkBrandScope([
      f("src/app/(account)/account/page.tsx", '<div className="ring-brand/50" />'),
    ]);
    expect(rules(v)).toEqual(["C1"]);
  });

  it("allows brand utilities inside (org)", () => {
    const v = checkBrandScope([
      f("src/app/(org)/o/[slug]/page.tsx", '<div className="bg-brand text-on-brand" />'),
    ]);
    expect(v).toEqual([]);
  });

  it("allows brand utilities inside (public)", () => {
    const v = checkBrandScope([
      f("src/app/(public)/site/[slug]/page.tsx", '<div className="border-brand" />'),
    ]);
    expect(v).toEqual([]);
  });

  it("does not fire on a longer word that merely starts with brand", () => {
    const v = checkBrandScope([
      f("src/app/(admin)/admin/page.tsx", '<div className="text-branding" />'),
    ]);
    expect(v).toEqual([]);
  });

  it("does not fire on an unrelated utility ending in -brand", () => {
    const v = checkBrandScope([
      f("src/app/(admin)/admin/page.tsx", '<div className="data-brand" />'),
    ]);
    expect(v).toEqual([]);
  });

  it("does not fire on a comment", () => {
    const v = checkBrandScope([
      f("src/app/(admin)/admin/page.tsx", "// bg-brand is illegal here"),
    ]);
    expect(v).toEqual([]);
  });
});

// ── C2 — no hand-rolled primitives (live as of commit a8, 2026-08-19) ───────

describe("C2 — no hand-rolled primitives", () => {
  const button = f(
    "src/app/(account)/account/profile-form.tsx",
    '<button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background" />',
  );

  it("is live by default — no opt-in required after commit a8", () => {
    const v = checkBrandScope([button]);
    expect(rules(v)).toEqual(["C2"]);
    expect(v[0].message).toMatch(/button-shaped/);
  });

  it("can still be forced on explicitly via opts.c2 (unchanged call sites)", () => {
    const v = checkBrandScope([button], { c2: true });
    expect(rules(v)).toEqual(["C2"]);
    expect(v[0].message).toMatch(/button-shaped/);
  });

  it("catches a literal <table> when enabled", () => {
    const v = checkBrandScope(
      [f("src/app/(admin)/admin/users/page.tsx", '<table className="mt-6 w-full">')],
      { c2: true },
    );
    expect(rules(v)).toEqual(["C2"]);
    expect(v[0].message).toMatch(/<table>/);
  });

  it("requires all three shape signals — rounded + px alone is not a button", () => {
    const v = checkBrandScope(
      [f("src/app/(member)/home/page.tsx", '<div className="rounded-md px-4 py-2" />')],
      { c2: true },
    );
    expect(v).toEqual([]);
  });

  it("honours the // ui-ok: escape hatch on the line above", () => {
    const v = checkBrandScope(
      [
        f(
          "src/app/(member)/home/page.tsx",
          [
            "// ui-ok: third-party embed requires its own markup",
            '<a className="rounded-md px-4 py-2 font-semibold" />',
          ].join("\n"),
        ),
      ],
      { c2: true },
    );
    expect(v).toEqual([]);
  });

  it("exempts the generated primitives", () => {
    const v = checkBrandScope(
      [
        f(
          "src/components/ui/button.tsx",
          '"rounded-md px-4 py-2 font-medium"',
        ),
        f("src/components/ui/table.tsx", "<table data-slot=\"table\" />"),
      ],
      { c2: true },
    );
    expect(v).toEqual([]);
  });

  it("exempts /developer, which is a hand-set register with its own palette", () => {
    const v = checkBrandScope(
      [
        f(
          "src/app/(admin)/developer/tables/[table]/page.tsx",
          '<table className="reg-table">',
        ),
      ],
      { c2: true },
    );
    expect(v).toEqual([]);
  });
});

// ── Cross-rule ──────────────────────────────────────────────────────────────

describe("reporting", () => {
  it("reports every violation, not just the first", () => {
    const v = checkBrandScope(
      [
        f(
          "src/app/(admin)/admin/page.tsx",
          [
            "<BrandTokens brand={b} />",
            '<div className="bg-brand" />',
            "<style>{css}</style>",
          ].join("\n"),
        ),
      ],
      { c2: true },
    );
    expect(rules(v).sort()).toEqual(["C1", "E1", "E3"]);
    expect(v.every((x) => x.file === "src/app/(admin)/admin/page.tsx")).toBe(true);
  });
});
