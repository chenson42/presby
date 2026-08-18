import { test, expect } from "@playwright/test";

// The design tokens live in src/app/globals.css as raw custom properties on
// :root, mapped onto Tailwind's --color-* namespace with `@theme inline`.
//
// The previous shape wrapped a second `@theme` block in
// `@media (prefers-color-scheme: dark)`. Tailwind v4 hoists `@theme` out of the
// media query, so the compiled stylesheet carried ONE unconditional :root block
// holding the dark values — every visitor got the dark palette regardless of
// their OS setting, and no build, typecheck, or unit test could see it.
//
// These two assertions are the guard: the palette must actually follow
// prefers-color-scheme. Body background is the cheapest observable proxy for
// "the whole token set switched".

const LIGHT_BACKGROUND = "rgb(255, 255, 255)"; // hsl(0 0% 100%)
const DARK_BACKGROUND = "rgb(15, 23, 41)"; // hsl(222 47% 11%)

async function bodyBackground(page: import("@playwright/test").Page) {
  return page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
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
  });

  test.describe("dark", () => {
    test.use({ colorScheme: "dark" });

    test("renders the dark palette when the OS prefers dark", async ({
      page,
    }) => {
      await page.goto("/");
      expect(await bodyBackground(page)).toBe(DARK_BACKGROUND);
    });
  });
});
