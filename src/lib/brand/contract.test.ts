import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  BRAND_ROLES,
  BRAND_TOKEN_VERSION,
  FOCUS_RING_OFFSET_PX,
  LEGAL_PAIRS,
  PLATFORM_TOKENS,
  ROLE_TO_TOKEN,
  TOKEN_POLICY,
  TYPE_SCALE,
  type BrandRole,
  type PlatformTokenName,
  type Scheme,
} from "./contract";
import {
  contrastRatio,
  meets,
  parseColor,
  relativeLuminance,
} from "./contrast";

/**
 * The contract's own proof.
 *
 * Three groups, per the Phase 3 design (commit `0.1`):
 *   (a) every entry of LEGAL_PAIRS against PLATFORM_TOKENS in BOTH schemes,
 *       reading `min` FROM THE PAIR rather than restating D1-D6 — so adding a
 *       pair adds its assertion and nobody has to remember to;
 *   (b) closure — `globals.css` and TOKEN_POLICY describe the same set of
 *       custom properties, with the same values;
 *   (c) `contrast.ts` against published WCAG reference values.
 *
 * Group (b) answers E12 in the design's Edge Cases, which asked the
 * implementer to choose between asserting token NAMES only and also asserting
 * the VALUES, and not to leave it ambiguous. CHOSEN: values as well as names,
 * compared as parsed 8-bit RGB rather than as strings.
 *
 * The reason is that names-only leaves the whole suite self-certifying: every
 * pair assertion below reads PLATFORM_TOKENS, so a `globals.css` that had
 * drifted from it would pass its own tests while the browser painted something
 * nobody measured. Comparing parsed RGB rather than raw strings costs nothing
 * (the parser already exists, and it is the parser the ratios are computed
 * with) and survives an equivalent renotation — `#ffffff` for
 * `hsl(0 0% 100%)` is not drift, and a test that called it drift would train
 * people to edit the test.
 */

const GLOBALS_CSS = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

const SCHEMES: readonly Scheme[] = ["light", "dark"];

function colourFor(role: BrandRole, scheme: Scheme): string {
  return PLATFORM_TOKENS[scheme][ROLE_TO_TOKEN[role]];
}

/* -------------------------------------------------------------------------
 * (a) Every legal pair, both schemes, floor read from the pair
 * ---------------------------------------------------------------------- */

describe("LEGAL_PAIRS against the platform palette", () => {
  for (const pair of LEGAL_PAIRS) {
    for (const scheme of SCHEMES) {
      it(`${scheme}: ${pair.fg} on ${pair.bg} clears ${pair.min}:1 (${pair.kind}, ${pair.derives})`, () => {
        const fg = colourFor(pair.fg, scheme);
        const bg = colourFor(pair.bg, scheme);
        const ratio = contrastRatio(fg, bg);

        expect(
          ratio,
          `${pair.fg} (${fg}) on ${pair.bg} (${bg}) in ${scheme} is ${ratio.toFixed(2)}:1, floor ${pair.min}:1`,
        ).toBeGreaterThanOrEqual(pair.min);
        expect(meets(pair, fg, bg)).toBe(true);
      });
    }
  }

  it("declares a floor for every pair", () => {
    for (const pair of LEGAL_PAIRS) {
      expect(pair.min).toBeGreaterThan(1);
    }
  });

  it("references only roles that resolve to a token with a platform value", () => {
    for (const pair of LEGAL_PAIRS) {
      for (const role of [pair.fg, pair.bg]) {
        expect(BRAND_ROLES).toContain(role);
        for (const scheme of SCHEMES) {
          expect(typeof colourFor(role, scheme)).toBe("string");
        }
      }
    }
  });

  /**
   * D4, and the reason it is a geometry rule rather than a colour rule.
   *
   * `--ring` is `--primary`, so a focus ring drawn flush against the default
   * button is 1.00:1 — invisible, in both schemes, shipped since P0. The pair
   * above only measures the ring against the SURFACE, which is honest exactly
   * as long as the ring is never adjacent to the control it rings. This test
   * is what keeps those two facts joined: if a future palette leaves the ring
   * indistinguishable from the brand fill, the contract must be mandating an
   * offset.
   */
  it("D4: the ring either clears the control it rings, or the contract mandates an offset", () => {
    for (const scheme of SCHEMES) {
      const ringOnControl = contrastRatio(
        colourFor("ring", scheme),
        colourFor("brand", scheme),
      );
      if (ringOnControl < 3) {
        expect(
          FOCUS_RING_OFFSET_PX,
          `the ${scheme} ring is ${ringOnControl.toFixed(2)}:1 against the brand fill, so it must be drawn offset`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  /**
   * Pairs the closed role vocabulary cannot express, asserted here rather than
   * in LEGAL_PAIRS.
   *
   * `--card` and `--popover` have no role in BRAND_ROLES — the vocabulary the
   * design fixed has one surface role, not three. But D1 says body text on ANY
   * generated surface clears 7:1, and the design's own failure table measured
   * `muted-foreground` on `card` at 4.70 light / 5.78 dark. Leaving that
   * unasserted would mean the two corrections that fix it could be reverted
   * with a green suite. Kept local to the test on purpose: adding roles is a
   * change to the contract's closed vocabulary, not something a test file gets
   * to do quietly. Named in the Phase 4 notes as a gap for the vocabulary to
   * close.
   */
  it("D1 also holds on the card and popover surfaces, which have no role", () => {
    const surfaces: readonly PlatformTokenName[] = ["--card", "--popover"];
    const bodyForegrounds: readonly PlatformTokenName[] = [
      "--card-foreground",
      "--popover-foreground",
      "--muted-foreground",
    ];
    for (const scheme of SCHEMES) {
      for (const surface of surfaces) {
        for (const fg of bodyForegrounds) {
          const ratio = contrastRatio(
            PLATFORM_TOKENS[scheme][fg],
            PLATFORM_TOKENS[scheme][surface],
          );
          expect(
            ratio,
            `${fg} on ${surface} in ${scheme} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(7);
        }
      }
    }
  });
});

/* -------------------------------------------------------------------------
 * (b) Closure — globals.css and TOKEN_POLICY describe the same thing
 * ---------------------------------------------------------------------- */

/** Strip CSS comments so a token named inside prose is never mistaken for a
 * declaration. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The body of the balanced `{ … }` beginning at or after `from`. */
function balancedBlock(
  css: string,
  from: number,
): { body: string; start: number; end: number } {
  const open = css.indexOf("{", from);
  if (open === -1) throw new Error("no block found");
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return { body: css.slice(open + 1, i), start: open, end: i };
      }
    }
  }
  throw new Error("unbalanced braces in globals.css");
}

function ruleBody(css: string, selector: RegExp): string {
  const match = selector.exec(css);
  if (!match) throw new Error(`no rule matching ${selector} in globals.css`);
  return balancedBlock(css, match.index).body;
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(match[1], match[2].trim());
  }
  return out;
}

/**
 * The two scheme blocks.
 *
 * The dark block is `@media (prefers-color-scheme: dark) { :root { … } }`
 * today and becomes `.dark { … }` in slice a. Both shapes are handled, so this
 * test does not have to be rewritten by the commit that moves the block — a
 * test that needs editing during a mechanism change is a test that gets edited
 * into agreement with the bug.
 */
function schemeBlocks(source = GLOBALS_CSS): Record<Scheme, Map<string, string>> {
  const css = stripComments(source);

  const media = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/.exec(css);
  const dark = /\.dark\s*\{/.exec(css);

  let darkBody: string;
  let lightSource: string;

  if (media) {
    const block = balancedBlock(css, media.index);
    darkBody = ruleBody(block.body, /:root\s*\{/);
    lightSource = css.slice(0, media.index) + css.slice(block.end + 1);
  } else if (dark) {
    const block = balancedBlock(css, dark.index);
    darkBody = block.body;
    lightSource = css.slice(0, dark.index) + css.slice(block.end + 1);
  } else {
    throw new Error("globals.css declares no dark scheme block");
  }

  return {
    light: declarations(ruleBody(lightSource, /:root\s*\{/)),
    dark: declarations(darkBody),
  };
}

describe("globals.css closure", () => {
  const blocks = schemeBlocks();

  const declared = new Set<string>(
    TOKEN_POLICY.filter(
      (entry) => !("additive" in entry) && !("reserved" in entry),
    ).map((entry) => entry.token),
  );

  it("parses both scheme blocks", () => {
    expect(blocks.light.size).toBeGreaterThan(0);
    expect(blocks.dark.size).toBeGreaterThan(0);
  });

  /**
   * The `.dark` branch of the parser has nothing to read today — slice a moves
   * the dark block out of the media query. Proving it on a fixture now is what
   * stops that commit from landing against a parser branch nobody ever ran,
   * with the closure test silently reading an empty dark block.
   */
  it("reads the dark block from a `.dark` class too, which is where slice a puts it", () => {
    const fixture = `
      :root { --background: hsl(0 0% 100%); --foreground: hsl(0 0% 0%); }
      .dark { --background: hsl(0 0% 0%); --foreground: hsl(0 0% 100%); }
    `;
    const parsed = schemeBlocks(fixture);
    expect([...parsed.light.keys()]).toEqual(["--background", "--foreground"]);
    expect(parsed.dark.get("--background")).toBe("hsl(0 0% 0%)");
    expect(parsed.light.get("--background")).toBe("hsl(0 0% 100%)");
  });

  it("ignores tokens that appear only inside a comment", () => {
    const fixture = `
      /* --background: hsl(1 2% 3%); is what it used to be */
      :root { --foreground: hsl(0 0% 0%); }
      .dark { --foreground: hsl(0 0% 100%); }
    `;
    expect([...schemeBlocks(fixture).light.keys()]).toEqual(["--foreground"]);
  });

  it("declares exactly the non-additive, non-reserved TOKEN_POLICY set in :root", () => {
    const inCss = new Set(blocks.light.keys());
    const missingFromCss = [...declared].filter((t) => !inCss.has(t)).sort();
    const unclassified = [...inCss].filter((t) => !declared.has(t)).sort();

    expect(
      unclassified,
      `globals.css declares properties TOKEN_POLICY does not classify: ${unclassified.join(", ")}`,
    ).toEqual([]);
    expect(
      missingFromCss,
      `TOKEN_POLICY classifies properties globals.css does not declare: ${missingFromCss.join(", ")}`,
    ).toEqual([]);
  });

  it("declares the same property set in both schemes, except --radius", () => {
    const light = [...blocks.light.keys()].filter((t) => t !== "--radius").sort();
    const dark = [...blocks.dark.keys()].sort();
    expect(dark).toEqual(light);
  });

  /**
   * E12, the chosen half: the values are asserted, not just the names.
   * Compared as parsed RGB, so `#ffffff` and `hsl(0 0% 100%)` are the same
   * colour and a genuine drift is still caught.
   */
  for (const scheme of SCHEMES) {
    it(`transcribes PLATFORM_TOKENS.${scheme} exactly`, () => {
      const block = blocks[scheme];
      for (const [token, expected] of Object.entries(
        PLATFORM_TOKENS[scheme],
      )) {
        const entry = TOKEN_POLICY.find((e) => e.token === token);
        // Additive tokens (--brand-raw*) have a platform default but are not
        // declared in globals.css until the emitter lands in slice c.
        if (entry && "additive" in entry) continue;

        const actual = block.get(token);
        expect(actual, `${scheme} globals.css is missing ${token}`).toBeDefined();
        expect(
          parseColor(actual as string),
          `${token} in ${scheme}: globals.css has ${actual}, PLATFORM_TOKENS has ${expected}`,
        ).toEqual(parseColor(expected));
      }
    });
  }

  it("carries a platform value for every colour token in both schemes", () => {
    for (const entry of TOKEN_POLICY) {
      if ("reserved" in entry || "nonColour" in entry) continue;
      for (const scheme of SCHEMES) {
        const table: Record<string, string> = PLATFORM_TOKENS[scheme];
        expect(
          table[entry.token],
          `PLATFORM_TOKENS.${scheme} has no value for ${entry.token}`,
        ).toBeTruthy();
      }
    }
  });
});

describe("TOKEN_POLICY", () => {
  it("classifies every token exactly once", () => {
    const tokens = TOKEN_POLICY.map((entry) => entry.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("gives every bounded token a named constraint, and no other token one", () => {
    for (const entry of TOKEN_POLICY) {
      if (entry.policy === "bounded") {
        expect(
          "bound" in entry && entry.bound.length > 0,
          `${entry.token} is bounded but names no constraint`,
        ).toBe(true);
      } else {
        expect("bound" in entry, `${entry.token} is not bounded`).toBe(false);
      }
    }
  });

  it("gives every token a reason someone could quote in a review", () => {
    for (const entry of TOKEN_POLICY) {
      expect(entry.why.length, `${entry.token} has no reason`).toBeGreaterThan(20);
    }
  });

  it("never classifies a content-axis or semantic token as brandable", () => {
    const mustBePlatform = [
      "--card",
      "--card-foreground",
      "--popover",
      "--popover-foreground",
      "--muted",
      "--muted-foreground",
      "--secondary",
      "--secondary-foreground",
      "--destructive",
      "--destructive-foreground",
      "--border",
      "--input",
      "--radius",
    ];
    for (const token of mustBePlatform) {
      const entry = TOKEN_POLICY.find((e) => e.token === token);
      expect(entry?.policy, `${token} must stay platform-owned`).toBe("platform");
    }
  });
});

describe("roles", () => {
  it("maps every role to a token, and every mapped token is classified", () => {
    for (const role of BRAND_ROLES) {
      const token = ROLE_TO_TOKEN[role];
      expect(token, `role ${role} maps to nothing`).toBeTruthy();
      expect(
        TOKEN_POLICY.some((entry) => entry.token === token),
        `${token} is not classified in TOKEN_POLICY`,
      ).toBe(true);
    }
  });

  it("maps no two roles to the same token", () => {
    const tokens = BRAND_ROLES.map((role) => ROLE_TO_TOKEN[role]);
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe("the type scale", () => {
  it("is monotonically decreasing, so the roles are orderable", () => {
    for (let i = 1; i < TYPE_SCALE.length; i++) {
      expect(TYPE_SCALE[i].rem).toBeLessThan(TYPE_SCALE[i - 1].rem);
    }
  });

  it("keeps rem and px agreeing at a 16px root", () => {
    for (const step of TYPE_SCALE) {
      expect(step.rem * 16).toBe(step.px);
    }
  });

  it("puts body at the 16px floor", () => {
    const body = TYPE_SCALE.find((step) => step.role === "body");
    expect(body?.px).toBe(16);
  });
});

describe("versioning", () => {
  it("pins a token version, so a generator change cannot silently re-skin", () => {
    expect(Number.isInteger(BRAND_TOKEN_VERSION)).toBe(true);
    expect(BRAND_TOKEN_VERSION).toBeGreaterThanOrEqual(1);
  });
});

/* -------------------------------------------------------------------------
 * (c) contrast.ts against published WCAG reference values
 * ---------------------------------------------------------------------- */

describe("contrast", () => {
  describe("contrastRatio", () => {
    it("is 21:1 for black on white — the maximum the formula can produce", () => {
      expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
    });

    it("is 1:1 for a colour against itself", () => {
      expect(contrastRatio("#3b5998", "#3b5998")).toBeCloseTo(1, 10);
    });

    // The three greys every published contrast table pivots on: #767676 is the
    // lightest grey that clears 4.5:1 on white, #595959 the lightest that
    // clears 7:1, #949494 the lightest that clears 3:1.
    it("matches the published value for #767676 on white (4.54:1)", () => {
      expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    });

    it("matches the published value for #595959 on white (7.00:1)", () => {
      expect(contrastRatio("#595959", "#ffffff")).toBeCloseTo(7.0, 2);
    });

    it("matches the published value for #949494 on white (3.03:1)", () => {
      expect(contrastRatio("#949494", "#ffffff")).toBeCloseTo(3.03, 2);
    });

    it("is symmetric — argument order never changes the answer", () => {
      expect(contrastRatio("#123456", "#fedcba")).toBeCloseTo(
        contrastRatio("#fedcba", "#123456"),
        10,
      );
    });

    it("agrees across notations for the same colour", () => {
      expect(contrastRatio("hsl(0 0% 100%)", "#000000")).toBeCloseTo(
        contrastRatio("#ffffff", "hsl(0 0% 0%)"),
        10,
      );
    });
  });

  describe("relativeLuminance", () => {
    it("is 1 for white and 0 for black", () => {
      expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
      expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 10);
    });

    it("weights green above red above blue, as the formula does", () => {
      const red = relativeLuminance({ r: 255, g: 0, b: 0 });
      const green = relativeLuminance({ r: 0, g: 255, b: 0 });
      const blue = relativeLuminance({ r: 0, g: 0, b: 255 });
      expect(green).toBeGreaterThan(red);
      expect(red).toBeGreaterThan(blue);
      expect(red).toBeCloseTo(0.2126, 4);
      expect(green).toBeCloseTo(0.7152, 4);
      expect(blue).toBeCloseTo(0.0722, 4);
    });
  });

  describe("parseColor", () => {
    it("converts hsl() to the same 8-bit channels a browser does", () => {
      // hsl(221 83% 53%) is #2563eb.
      expect(parseColor("hsl(221 83% 53%)")).toEqual({ r: 36, g: 99, b: 235 });
      expect(parseColor("hsl(0 0% 100%)")).toEqual({ r: 255, g: 255, b: 255 });
      expect(parseColor("hsl(0 0% 0%)")).toEqual({ r: 0, g: 0, b: 0 });
    });

    it("accepts the legacy comma-separated hsl() form", () => {
      expect(parseColor("hsl(221, 83%, 53%)")).toEqual(
        parseColor("hsl(221 83% 53%)"),
      );
    });

    it("wraps hue rather than failing on it", () => {
      expect(parseColor("hsl(360 84% 48%)")).toEqual(parseColor("hsl(0 84% 48%)"));
    });

    it("reads #rrggbb in either case", () => {
      expect(parseColor("#2563EB")).toEqual(parseColor("#2563eb"));
    });

    it("throws on a notation whose contrast nobody has verified", () => {
      // Alpha in particular: the ratio would depend on what is behind the
      // fill, so it is not a property of the pair at all.
      expect(() => parseColor("rgb(1 2 3)")).toThrow();
      expect(() => parseColor("hsl(0 84% 48% / 60%)")).toThrow();
      expect(() => parseColor("#2563eb80")).toThrow();
      expect(() => parseColor("var(--primary)")).toThrow();
      expect(() => parseColor("rebeccapurple")).toThrow();
    });
  });

  describe("meets", () => {
    const bodyPair = LEGAL_PAIRS[0];

    it("reads the floor from the pair rather than from the caller", () => {
      expect(bodyPair.min).toBe(7);
      expect(meets(bodyPair, "#595959", "#ffffff")).toBe(true); // 7.00
      expect(meets(bodyPair, "#767676", "#ffffff")).toBe(false); // 4.54
    });

    it("does not round a near miss up into a pass", () => {
      const nonText = LEGAL_PAIRS.find((pair) => pair.min === 3);
      expect(nonText).toBeDefined();
      // 2.9980:1 — prints as "3.00", is not 3.
      const ratio = contrastRatio("#595959", "#000000");
      expect(ratio).toBeLessThan(3);
      expect(ratio.toFixed(2)).toBe("3.00");
      expect(meets(nonText!, "#595959", "#000000")).toBe(false);
    });
  });
});
