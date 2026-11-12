/**
 * learn-spot-the-scam.spec.ts (hydration) - the pre-hydration guard for the Spot the scam island
 * (DECISION-159, F440; docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 "E2E plan"). The same pattern as
 * careers-posting-form.spec.ts: hold every `/_next/static/**.js` chunk, load with `domcontentloaded`, assert
 * the controls are inoperable, release the scripts, use control enablement as the hydration signal (no
 * networkidle, no throttling), then use the island and assert it WORKED.
 *
 * Before the chunks arrive, a tap on an answer must meet a visibly disabled control (not a control that
 * looks live and does nothing), the message is already readable (server-rendered), and the six rules are
 * on the page. After release the controls enable and the first answer works.
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in the `prod-build` project.
 * The route is anonymous, so no sign-in is needed. Rows live in a throwaway congregation (and presbytery)
 * removed in afterAll.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { getPublicRenderFlag, setPublicRenderFlag } from "../support/custom-hosts";
import { SCENARIOS } from "../../src/lib/learn/spot-the-scam/content";
import { removeLearnFixture, setLearnToggle, setupLearnFixture, type LearnFixture } from "../support/learn-fixture";

/** Holds every `/_next/static/**.js` request until the returned function is called. */
async function holdScripts(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => {
    await released;
    await route.continue().catch(() => {});
  });
  return release;
}

test.describe("Hydration - Spot the scam (DECISION-159)", () => {
  test.setTimeout(120_000);

  let sql: Sql;
  let fx: LearnFixture;
  let originalRenderFlag: boolean;

  test.beforeAll(async () => {
    sql = platformSql("hydration/learn-spot-the-scam.spec");
    originalRenderFlag = await getPublicRenderFlag(sql);
    await setPublicRenderFlag(sql, true);
    fx = await setupLearnFixture(sql);
    await setLearnToggle(sql, fx.congregation.orgId, true);
  });

  test.afterAll(async () => {
    if (sql) {
      if (fx) await removeLearnFixture(sql, fx);
      await setPublicRenderFlag(sql, originalRenderFlag);
      expect(await getPublicRenderFlag(sql), "sites.public_render must be restored").toBe(originalRenderFlag);
    }
  });

  test("every answer control is disabled until hydration, the message and the six rules are already readable, and the first answer works afterwards", async ({ page }) => {
    const release = await holdScripts(page);
    await page.goto(`/site/${fx.congregation.slug}/learn/spot-the-scam`, { waitUntil: "domcontentloaded" });

    // Server-rendered: the message, the rules and the noscript-safe frame are there with no JavaScript.
    await expect(page.getByRole("heading", { level: 1, name: "Spot the scam" })).toBeVisible();
    await expect(page.getByTestId("message")).toContainText(SCENARIOS[0]!.subject!);
    await expect(page.getByTestId("rules-card").locator("li")).toHaveCount(6);

    // The controls sit inside a busy, disabled gate: they LOOK disabled and cannot be tapped.
    const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("button", { name: "Looks genuine" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Something's off" })).toBeDisabled();
    // A tap that lands anyway does nothing (the click is refused by the browser, not lost silently by React).
    await page.getByRole("button", { name: "Looks genuine" }).click({ force: true, timeout: 2_000 }).catch(() => {});
    await expect(page.getByTestId("reveal")).toHaveCount(0);

    release();
    // Control enablement is the hydration signal.
    await expect(page.getByRole("button", { name: "Looks genuine" })).toBeEnabled({ timeout: 30_000 });
    await expect(gate).not.toHaveAttribute("aria-busy", "true");
    await page.getByRole("button", { name: SCENARIOS[0]!.isScam ? "Something's off" : "Looks genuine" }).click();
    await expect(page.getByRole("heading", { level: 4 })).toContainText("Right.");
    await expect(page.getByRole("heading", { level: 4 })).toBeFocused();
    await expect(page.getByTestId("reveal")).toContainText(SCENARIOS[0]!.lesson);
  });
});
