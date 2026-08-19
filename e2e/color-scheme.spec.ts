import { test, expect } from "@playwright/test";

// The design tokens live in src/app/globals.css as raw custom properties on
// :root and .dark, mapped onto Tailwind's --color-* namespace with
// `@theme inline`.
//
// P0.5 slice a (work-log 2026-08-19-brand-foundation, DECISION-050) replaced
// the `@media (prefers-color-scheme: dark)` mechanism with a `.dark` class
// applied to <html> by next-themes' pre-paint script, declared via
// `@custom-variant dark (&:is(.dark *))`. The class strategy is what lets a
// future per-org brand emit BOTH ramps in one <style> element with `.dark`
// selecting between them — a media query cannot do that.
//
// The previous header comment here described an earlier incident: Tailwind
// v4 hoisting a second `@theme` block out of a `prefers-color-scheme` media
// query, so every visitor got the dark palette regardless of OS setting, with
// no build, typecheck, or unit test able to see it. That specific bug cannot
// recur now that the block is a plain `.dark { … }` class rule with nothing
// to hoist, but the LESSON generalises: a scheme mechanism that only a
// running browser can verify needs a running-browser test, so this spec
// stays and is strengthened.
//
// Playwright's `colorScheme` emulation drives `window.matchMedia`, which is
// exactly what next-themes' pre-paint script reads to resolve `theme="system"`
// before paint — so these fixtures still exercise the real decision, just
// through one more layer of indirection than a media query would.
//
// Three assertions per scheme: body background (the previous proxy, kept —
// cheapest signal that the whole token set switched), and NEW, the
// documentElement class itself. The class assertion is the one that actually
// guards the mechanism: without it, this spec would keep passing for the
// WRONG reason if next-themes were ever misconfigured and the CSS happened to
// fall back to a value that coincidentally matched.

const LIGHT_BACKGROUND = "rgb(255, 255, 255)"; // hsl(0 0% 100%)
const DARK_BACKGROUND = "rgb(15, 23, 41)"; // hsl(222 47% 11%)

async function bodyBackground(page: import("@playwright/test").Page) {
  return page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
}

async function htmlClassList(page: import("@playwright/test").Page) {
  return page.evaluate(() => [...document.documentElement.classList]);
}

test.describe("Color scheme tokens — regression for light mode rendering dark", () => {
  test.describe("light", () => {
    test.use({ colorScheme: "light" });

    test("renders the light palette when the OS prefers light", async ({
      page,
    }) => {
      await page.goto("/");
      expect(await bodyBackground(page)).toBe(LIGHT_BACKGROUND);
    });

    test("does not apply the .dark class to <html>", async ({ page }) => {
      await page.goto("/");
      expect(await htmlClassList(page)).not.toContain("dark");
    });
  });

  test.describe("dark", () => {
    test.use({ colorScheme: "dark" });

    test("renders the dark palette when the OS prefers dark", async ({
      page,
    }) => {
      await page.goto("/");
      expect(await bodyBackground(page)).toBe(DARK_BACKGROUND);
    });

    test("applies the .dark class to <html>", async ({ page }) => {
      await page.goto("/");
      expect(await htmlClassList(page)).toContain("dark");
    });
  });
});
