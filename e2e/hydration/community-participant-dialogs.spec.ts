/**
 * community-participant-dialogs.spec.ts - the pre-hydration guard for the
 * participant controls on the Community edit page (2026-10-22-founding-admin-
 * directory, Batch D; DECISION-159). Same pattern as domains-claim-form.spec.ts:
 * hold every `/_next/static/**.js` chunk, load with `domcontentloaded`, assert the
 * triggers are inoperable, release the scripts, use control enablement as the
 * hydration signal (no networkidle, no waitForTimeout, no throttling).
 *
 * "Remove as participant" and "Undo last entry" are controlled AlertDialogs, not
 * `useForm` roots, so `check:hydration-gate` does not see them; their guard is
 * `disabled={!useHydrated()}` on the trigger. This spec is what proves it, and
 * the PERSISTED state is the point: after a pre-hydration click attempt the
 * person must still be a participant and no `tenant.roll_action.recorded` row
 * may exist for the person's removal.
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in
 * the `prod-build` project.
 */
import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "../support/users";
import { platformSql, type Sql } from "../support/db";
import {
  COMMUNITY_ORG,
  createParticipantViaSql,
  removeCommunityFixture,
  setupCommunityFixture,
  sweepCommunityPeople,
  type CommunityFixtureState,
} from "../support/community-fixture";

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

test.describe("Hydration - Community participant controls (DECISION-159)", () => {
  test.setTimeout(120_000);
  test.use({ storageState: storageStatePath("congregation-clerk") });

  let sql: Sql;
  let state: CommunityFixtureState;

  test.beforeAll(async () => {
    sql = platformSql("hydration/community-participant-dialogs.spec");
    await sweepCommunityPeople(sql);
    state = await setupCommunityFixture(sql);
  });

  test.afterAll(async () => {
    await removeCommunityFixture(sql, state);
  });

  test("Remove and Undo are disabled until hydration, then work; nothing was recorded before it", async ({ page }) => {
    const person = await createParticipantViaSql(sql, 1, "SpecHydration");

    const release = await holdScripts(page);
    await page.goto(`/o/${COMMUNITY_ORG.slug}/admin/community/${person.personId}/edit`, {
      waitUntil: "domcontentloaded",
    });

    const remove = page.getByRole("button", { name: /remove as participant/i });
    const undo = page.getByRole("button", { name: /undo last entry/i });
    await expect(remove).toBeVisible();
    await expect(undo).toBeVisible();
    await expect(remove).toBeDisabled();
    await expect(undo).toBeDisabled();
    // A forced click on a disabled control opens nothing and writes nothing.
    await remove.click({ force: true }).catch(() => {});
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    const before = (await sql`
      select count(*)::int as n from roll_actions
       where person_id = ${person.personId}::uuid and kind = 'other_participant_removed'`) as { n: number }[];
    expect(before[0]!.n).toBe(0);

    release();

    await expect(remove).toBeEnabled();
    await expect(undo).toBeEnabled();
    await remove.click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: /^keep$/i }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // Keeping it recorded nothing, and the person is still a participant.
    const after = (await sql`
      select m.current_roll, m.ended_on from memberships m
       where m.person_id = ${person.personId}::uuid and m.organization_id = ${COMMUNITY_ORG.id}::uuid`) as {
      current_roll: string | null;
      ended_on: string | null;
    }[];
    expect(after[0]!.current_roll).toBe("other_participant");
    expect(after[0]!.ended_on).toBeNull();
  });
});
