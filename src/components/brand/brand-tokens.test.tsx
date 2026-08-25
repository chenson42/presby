// @vitest-environment jsdom
/**
 * Tests for `BrandTokens` — DECISION-052's own marker/emitter component,
 * previously untested at the unit level (covered only indirectly by
 * `check-brand-scope.mjs`'s static grep and by whichever page happened to
 * render it). Written alongside `light_only` mode (docs/work-log/2026-08-24-
 * light-only-brand.md) since that feature's whole correctness lives in this
 * file's CSS-string generation — worth pinning both the new behavior and the
 * pre-existing one it must not disturb.
 *
 * Called as a plain function (`BrandTokens({...})`), never as JSX
 * (`<BrandTokens ... />`) — `check-brand-scope.mjs`'s E1 rule greps the
 * literal `<BrandTokens` substring tree-wide and only allowlists the two
 * real emitting layouts (DECISION-047); a test file is not one of them, and
 * the rule deliberately has no test-file exemption. Since `BrandTokens` is
 * an ordinary function component, calling it directly and handing the
 * returned element to `render()` exercises identical behavior without
 * tripping that tripwire.
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { BrandTokens } from "./brand-tokens";
import { generateBrandTokens } from "@/lib/brand/generate";
import { PLATFORM_TOKENS } from "@/lib/brand/contract";

afterEach(cleanup);

const { tokens: BRAND } = generateBrandTokens("#2f6f5e");

function styleText(container: HTMLElement): string {
  return container.querySelector("style")?.textContent ?? "";
}

describe("BrandTokens — null safety", () => {
  it("renders nothing when brand is null", () => {
    const { container } = render(BrandTokens({ brand: null }));
    expect(container.querySelector("style")).toBeNull();
  });
});

describe("BrandTokens — default (lightOnly unset/false), unchanged from before light_only existed", () => {
  it("emits brand.light in :root:root and brand.dark in :root:root.dark", () => {
    const { container } = render(BrandTokens({ brand: BRAND }));
    const css = styleText(container);
    expect(css).toContain(":root:root {");
    expect(css).toContain(":root:root.dark {");
    expect(css).toContain(`--primary: ${BRAND.light.brand};`);
    expect(css).toContain(`--primary: ${BRAND.dark.brand};`);
  });

  it("never re-declares a platform-fixed token (e.g. --card, --border) regardless of lightOnly being explicitly false", () => {
    const { container } = render(BrandTokens({ brand: BRAND, lightOnly: false }));
    const css = styleText(container);
    expect(css).not.toContain("--card:");
    expect(css).not.toContain("--border:");
    expect(css).not.toContain("--popover:");
    expect(css).not.toContain("--input:");
  });
});

describe("BrandTokens — lightOnly=true", () => {
  it("puts brand.light's own values in :root:root.dark, not brand.dark's", () => {
    const { container } = render(BrandTokens({ brand: BRAND, lightOnly: true }));
    const css = styleText(container);
    const darkBlock = css.split(":root:root.dark {")[1] ?? "";
    expect(darkBlock).toContain(`--primary: ${BRAND.light.brand};`);
    // A generator-varying leaf (accent's background differs light vs dark
    // for this seed even though --primary itself happens not to) proves
    // this replaces the dark ramp rather than merely adding to it.
    expect(BRAND.light.accent).not.toBe(BRAND.dark.accent);
    expect(darkBlock).toContain(`--accent: ${BRAND.light.accent};`);
    expect(darkBlock).not.toContain(`--accent: ${BRAND.dark.accent};`);
  });

  it("additionally forces every platform-fixed colour token to its light PLATFORM_TOKENS value inside :root:root.dark", () => {
    const { container } = render(BrandTokens({ brand: BRAND, lightOnly: true }));
    const css = styleText(container);
    const darkBlock = css.split(":root:root.dark {")[1] ?? "";
    expect(darkBlock).toContain(`--card: ${PLATFORM_TOKENS.light["--card"]};`);
    expect(darkBlock).toContain(`--popover: ${PLATFORM_TOKENS.light["--popover"]};`);
    expect(darkBlock).toContain(`--muted: ${PLATFORM_TOKENS.light["--muted"]};`);
    expect(darkBlock).toContain(`--secondary: ${PLATFORM_TOKENS.light["--secondary"]};`);
    expect(darkBlock).toContain(`--destructive: ${PLATFORM_TOKENS.light["--destructive"]};`);
    expect(darkBlock).toContain(`--border: ${PLATFORM_TOKENS.light["--border"]};`);
    expect(darkBlock).toContain(`--input: ${PLATFORM_TOKENS.light["--input"]};`);
    // Never the platform's own DARK values for these — that's exactly the
    // hybrid Phase 1 Gap 1 named ("a dark card/popover/muted-surface
    // composited with the light brand colours").
    expect(darkBlock).not.toContain(PLATFORM_TOKENS.dark["--card"]);
    expect(darkBlock).not.toContain(PLATFORM_TOKENS.dark["--popover"]);
  });

  it("leaves :root:root (the light block) unaffected by lightOnly", () => {
    const withLightOnly = render(BrandTokens({ brand: BRAND, lightOnly: true }));
    const lightBlockA = styleText(withLightOnly.container).split(":root:root {")[1]!.split(
      ":root:root.dark",
    )[0];
    cleanup();
    const withoutLightOnly = render(BrandTokens({ brand: BRAND }));
    const lightBlockB = styleText(withoutLightOnly.container)
      .split(":root:root {")[1]!
      .split(":root:root.dark")[0];
    expect(lightBlockA).toBe(lightBlockB);
  });

  it("never touches --radius (nonColour) or the reserved --success/--warning/--info tokens", () => {
    const { container } = render(BrandTokens({ brand: BRAND, lightOnly: true }));
    const css = styleText(container);
    expect(css).not.toContain("--radius:");
    expect(css).not.toContain("--success:");
    expect(css).not.toContain("--warning:");
    expect(css).not.toContain("--info:");
  });
});

describe("BrandTokens — [data-brand-neutral] escape hatch (Google-button fix, work-log 2026-08-24-branded-signin Phase 6 rework)", () => {
  it("emits a [data-brand-neutral] block re-declaring --primary/--primary-foreground/--ring to the PLATFORM light values", () => {
    const { container } = render(BrandTokens({ brand: BRAND }));
    const css = styleText(container);
    const neutralBlock = css
      .split("[data-brand-neutral] {")[1]
      ?.split("}")[0];
    expect(neutralBlock).toBeTruthy();
    expect(neutralBlock).toContain(`--primary: ${PLATFORM_TOKENS.light["--primary"]};`);
    expect(neutralBlock).toContain(
      `--primary-foreground: ${PLATFORM_TOKENS.light["--primary-foreground"]};`,
    );
    expect(neutralBlock).toContain(`--ring: ${PLATFORM_TOKENS.light["--ring"]};`);
    // Never the org's own brand fill — the whole point of the escape hatch.
    expect(neutralBlock).not.toContain(BRAND.light.brand);
  });

  it("emits a :root:root.dark [data-brand-neutral] block with the PLATFORM dark values, distinct from the light block", () => {
    const { container } = render(BrandTokens({ brand: BRAND }));
    const css = styleText(container);
    const darkNeutralBlock = css
      .split(":root:root.dark [data-brand-neutral] {")[1]
      ?.split("}")[0];
    expect(darkNeutralBlock).toBeTruthy();
    expect(darkNeutralBlock).toContain(`--primary: ${PLATFORM_TOKENS.dark["--primary"]};`);
    expect(darkNeutralBlock).toContain(`--ring: ${PLATFORM_TOKENS.dark["--ring"]};`);
    expect(PLATFORM_TOKENS.dark["--primary"]).not.toBe(PLATFORM_TOKENS.light["--primary"]);
  });

  it("still emits the escape hatch when lightOnly is true, using the PLATFORM (not the org's) values", () => {
    const { container } = render(BrandTokens({ brand: BRAND, lightOnly: true }));
    const css = styleText(container);
    expect(css).toContain(
      `[data-brand-neutral] {\n  --primary: ${PLATFORM_TOKENS.light["--primary"]};`,
    );
  });
});
