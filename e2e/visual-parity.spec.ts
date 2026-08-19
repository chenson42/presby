/**
 * visual-parity.spec.ts — the self-comparing screenshot harness (G11, DECISION-053).
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. This spec does not compare against a
 * committed baseline — there isn't one, deliberately. A baseline rendered on
 * macOS never matches `ubuntu-latest`, and a baseline generated on
 * `ubuntu-latest` drifts with the runner image (`.github/workflows/e2e.yml`
 * pins nothing). So the harness is self-comparing across two runs on ONE
 * machine: capture with `npm run visual:baseline`, make a change, compare with
 * `npm run visual:check`. `maxDiffPixels: 0` — any pixel movement fails. This
 * is the instrument that lets slice a's sweep (a4–a7) prove "this delta is the
 * primitive's stock geometry" rather than asserting it by eye across 18
 * routes x 2 viewports x 2 schemes.
 *
 * DO NOT BASELINE AGAINST A LONG-RUNNING DEV SERVER. `npm run dev` was
 * observed serving a stale CSS chunk that never recompiled even after a
 * touch (see the `0.1` commit notes in
 * docs/work-log/2026-08-19-brand-foundation.md) — a baseline captured against
 * it would be comparing against wrong CSS, silently. Baseline and check must
 * both run against a `next build` + `next start` production server on a
 * scratch port:
 *
 *   npm run build
 *   PORT=3100 npm run start &
 *   E2E_BASE_URL=http://localhost:3100 npm run visual:baseline
 *   E2E_BASE_URL=http://localhost:3100 npm run visual:check
 *
 * Setting E2E_BASE_URL makes playwright.config.ts's `webServer.reuseExistingServer`
 * (true outside CI) detect the already-running production server at that URL
 * and skip starting `npm run dev` for this run — no second webServer entry is
 * needed for that; it is the same mechanism the rest of the suite uses to let
 * a developer run against an already-running server.
 *
 * ROUTES. e2e/support/routes.ts is the manifest: path, which fixture's cached
 * storageState (or anonymous), expected HTTP status, and why. This spec's job
 * is only the matrix and the comparison — see that file for route selection
 * rationale.
 *
 * The `visual` project (playwright.config.ts) is the only project that runs
 * this file — `chromium`'s testIgnore excludes it, and `visual` itself is only
 * added to the config's `projects` array when `PW_VISUAL=1` is set (which only
 * the two visual:* npm scripts do), so a bare `npm run test:e2e` never
 * collects it.
 */

import { test, expect } from "@playwright/test";
import { VISUAL_ROUTES } from "./support/routes";
import { storageStatePath } from "./support/users";

const VIEWPORTS = [
  { label: "360x800", width: 360, height: 800 },
  { label: "1280x900", width: 1280, height: 900 },
] as const;

const SCHEMES = ["light", "dark"] as const;

/** `/admin/email-queue` -> `admin-email-queue`; `/` -> `root`. */
function routeSlug(routePath: string): string {
  return routePath === "/"
    ? "root"
    : routePath.replace(/^\//, "").replace(/\//g, "-");
}

for (const route of VISUAL_ROUTES) {
  test.describe(`${route.path} [${route.storageState ?? "anonymous"}]`, () => {
    if (route.storageState) {
      test.use({ storageState: storageStatePath(route.storageState) });
    }

    for (const viewport of VIEWPORTS) {
      for (const scheme of SCHEMES) {
        test.describe(`${viewport.label} / ${scheme}`, () => {
          test.use({
            viewport: { width: viewport.width, height: viewport.height },
            colorScheme: scheme,
          });

          test(`${routeSlug(route.path)}`, async ({ page }) => {
            const response = await page.goto(route.path, {
              waitUntil: "networkidle",
            });
            expect(
              response?.status(),
              `${route.path} (${route.storageState ?? "anonymous"}) should respond ${route.expectedStatus}`,
            ).toBe(route.expectedStatus);

            // Fonts loading async between the two captures is a classic
            // source of a false-positive diff at maxDiffPixels: 0.
            await page.evaluate(() => document.fonts.ready);

            await expect(page).toHaveScreenshot(
              `${routeSlug(route.path)}-${viewport.label}-${scheme}.png`,
              {
                fullPage: true,
                animations: "disabled",
                maxDiffPixels: 0,
              },
            );
          });
        });
      }
    }
  });
}
