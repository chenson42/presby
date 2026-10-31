/**
 * help-404.spec.ts - the help 404 is one body, never cached (user-help Inc 1, DECISION-293).
 *
 * Every /help URL that is not a published page or a planned placeholder is answered by the
 * force-dynamic catch-all `help/[...unmatched]`, which calls notFound() and so renders
 * help/not-found.tsx inside the documentation layout. Two claims, both pinned here:
 *
 *   1. The body is the HELP 404 (the heading and the link to the index), not the framework's
 *      default 404, for an unknown slug, for an unknown planned slug and for a deeper path.
 *   2. A miss is never written to the cache. With `dynamicParams = true` instead, Next caches one
 *      404 per distinct URL (`s-maxage` one year, `x-nextjs-cache: MISS` then `HIT`), which is
 *      attacker-chosen cache growth; the catch-all is dynamic so each request is rendered fresh
 *      and sent `no-store`.
 *
 * Runs in BOTH lanes. The dev lane proves the routing; the production lane (`prod-build`, see
 * playwright.config.ts) is the one that proves the caching claim, because a dev server sends
 * `no-store` on everything and proves nothing about it.
 *
 * Flagless, anonymous, no fixture user.
 */
import { test, expect } from "@playwright/test";

/** Dev compiles each route on first touch. */
test.describe.configure({ timeout: 120_000 });

const MISSES = ["/help/no-such-page", "/help/planned/no-such", "/help/no-such-page/deeper"];

for (const path of MISSES) {
  test(`${path} is the help 404, twice, with no cache entry`, async ({ page }) => {
    for (const attempt of [1, 2]) {
      const res = await page.goto(path);
      const label = `${path} (request ${attempt})`;
      expect(res?.status(), label).toBe(404);
      expect(new URL(page.url()).pathname, label).toBe(path);

      await expect(page.getByRole("heading", { level: 1 }), label).toHaveText("We couldn't find that page");
      await expect(page.getByRole("link", { name: "Go to the help index" }), label).toHaveAttribute("href", "/help");

      const headers = res!.headers();
      expect(headers["cache-control"] ?? "", `${label}: cache-control`).toContain("no-store");
      expect(headers["cache-control"] ?? "", `${label}: cache-control`).not.toContain("s-maxage");
      expect(headers["x-nextjs-cache"], `${label}: x-nextjs-cache`).toBeUndefined();
    }
  });
}
