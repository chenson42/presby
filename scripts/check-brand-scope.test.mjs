/**
 * Fixture tests for the brand-scope tripwire.
 *
 * C1 has nothing real to catch until slice c introduces the additive
 * `--brand-*` tokens, and C2 is dormant until the sweep clears its census. A
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
  // DECISION-047: the brand reaches exactly two layouts. A third appearing here
  // should be a deliberate edit with a decision behind it, not a quiet append.
  it("is exactly the two brandable layouts", () => {
    expect(EMITTERS.map((e) => e.path)).toEqual([
      "src/app/(org)/o/[slug]/layout.tsx",
      "src/app/(public)/site/[slug]/layout.tsx",
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

// ── E2 — emitter presence (dormant: every `required` is false) ──────────────

describe("E2 — emitter presence", () => {
  it("is dormant under the shipped allowlist — a bare org layout passes", () => {
    const v = checkBrandScope([
      f("src/app/(org)/o/[slug]/layout.tsx", "return <div>{children}</div>;"),
    ]);
    expect(v).toEqual([]);
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
});

// ── E3 — no second emitter (live) ───────────────────────────────────────────

describe("E3 — no second emitter", () => {
  it("flags a <style> element outside src/components/brand/", () => {
    const v = checkBrandScope([
      f("src/app/(org)/o/[slug]/layout.tsx", "return <style>{css}</style>;"),
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

// ── C2 — no hand-rolled primitives (dormant until commit a8) ────────────────

describe("C2 — no hand-rolled primitives", () => {
  const button = f(
    "src/app/(account)/account/profile-form.tsx",
    '<button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background" />',
  );

  it("is dormant by default — the census of 44 real violations passes today", () => {
    expect(checkBrandScope([button])).toEqual([]);
  });

  it("catches a button-shaped class string when enabled", () => {
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
