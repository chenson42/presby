/**
 * community-approval-controls.spec.ts - the pre-hydration guard for the pending
 * queue's controls (2026-10-22-founding-admin-directory, Increment 2 Batch D;
 * DECISION-159). Same pattern as community-participant-dialogs.spec.ts: hold
 * every `/_next/static/**.js` chunk, load with `domcontentloaded`, assert the
 * controls are inoperable, release the scripts, use control enablement as the
 * hydration signal (no networkidle, no waitForTimeout, no throttling).
 *
 * The row checkboxes and the Approve, Deny and Withdraw triggers are not
 * `useForm` roots (AlertDialogs and plain state), so `check:hydration-gate` does
 * not see them; their guard is `disabled={!useHydrated()}`. This spec proves it,
 * and the PERSISTED state is the point: after a pre-hydration click attempt the
 * proposal must still be pending, and nothing may have been decided. The bulk
 * "Approve N selected" trigger lives in a bar that only exists after a selection,
 * which cannot be made before hydration, so its pre-hydration state is "absent".
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in
 * the `prod-build` project.
 */
import { test, expect as baseExpect, type Page } from "@playwright/test";
import { storageStatePath } from "../support/users";
import { platformSql, type Sql } from "../support/db";
import {
  COMMUNITY_ORG,
  createProposalViaSql,
  removeCommunityFixture,
  setupCommunityFixture,
  sweepCommunityPeople,
  type CommunityFixtureState,
} from "../support/community-fixture";

/** A dev server (Turbopack compile on first touch, a Neon round trip per refresh) is
 * slower than the 5s default for the post-action `router.refresh()` assertions. */
const expect = baseExpect.configure({ timeout: 30_000 });

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

test.describe("Hydration - pending queue controls (DECISION-159)", () => {
  test.setTimeout(120_000);
  test.use({ storageState: storageStatePath("congregation-clerk") });

  let sql: Sql;
  let state: CommunityFixtureState;

  test.beforeAll(async () => {
    sql = platformSql("hydration/community-approval-controls.spec");
    await sweepCommunityPeople(sql);
    state = await setupCommunityFixture(sql);
  });

  test.afterAll(async () => {
    await removeCommunityFixture(sql, state);
  });

  test("checkboxes and the Approve, Deny and Withdraw triggers are disabled until hydration; nothing was decided before it", async ({ page }) => {
    const person = await createProposalViaSql(sql, 90, "SpecHydrationQueue");
    const full = `E2ECommunity ${person.lastName}`;

    const release = await holdScripts(page);
    await page.goto(`/o/${COMMUNITY_ORG.slug}/admin/community/pending`, {
      waitUntil: "domcontentloaded",
    });

    const row = page.getByTestId("pending-row").filter({ hasText: full });
    await expect(row).toBeVisible();
    const checkbox = row.getByRole("checkbox");
    const approve = row.getByRole("button", { name: /^approve /i });
    const deny = row.getByRole("button", { name: /^deny /i });
    const withdraw = row.getByRole("button", { name: /withdraw proposal for/i });
    await expect(checkbox).toBeDisabled();
    await expect(approve).toBeDisabled();
    await expect(deny).toBeDisabled();
    await expect(withdraw).toBeDisabled();
    await expect(page.getByRole("button", { name: /select all on this page/i })).toBeDisabled();
    await expect(page.getByTestId("bulk-bar")).toHaveCount(0);

    // A forced click on a disabled control opens nothing and writes nothing.
    await approve.click({ force: true }).catch(() => {});
    await withdraw.click({ force: true }).catch(() => {});
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    const before = (await sql`
      select approval_status from roll_actions where person_id = ${person.personId}::uuid`) as { approval_status: string }[];
    expect(before.map((r) => r.approval_status)).toEqual(["pending"]);

    release();

    await expect(checkbox).toBeEnabled();
    await expect(approve).toBeEnabled();
    await expect(deny).toBeEnabled();
    await expect(withdraw).toBeEnabled();

    // Selection works after hydration, and the bar appears.
    await checkbox.check();
    await expect(page.getByRole("button", { name: "Approve 1 selected" })).toBeEnabled();
    await checkbox.uncheck();

    // Each dialog opens, and cancelling decides nothing.
    for (const [trigger, cancel] of [
      [approve, /^cancel$/i],
      [deny, /^cancel$/i],
      [withdraw, /^keep it$/i],
    ] as const) {
      await trigger.click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: cancel }).click();
      await expect(dialog).toHaveCount(0);
    }
    const after = (await sql`
      select approval_status from roll_actions where person_id = ${person.personId}::uuid`) as { approval_status: string }[];
    expect(after.map((r) => r.approval_status)).toEqual(["pending"]);
  });
});
