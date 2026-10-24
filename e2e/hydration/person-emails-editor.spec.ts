/**
 * person-emails-editor.spec.ts - the pre-hydration guard for the address list
 * editor on the Community edit page (2026-10-23-person-emails, Batch 3;
 * DECISION-159). Same pattern as community-participant-dialogs.spec.ts: hold
 * every `/_next/static/**.js` chunk, load with `domcontentloaded`, assert the
 * editor's controls are inoperable, release the scripts, use control
 * enablement as the hydration signal (no networkidle, no waitForTimeout, no
 * throttling).
 *
 * The editor lives inside the edit form's own `HydrationGate`, so everything in
 * it is disabled until hydration. react-hook-form writes `defaultValues` over
 * the live DOM when it attaches, so an address typed before that would be
 * silently replaced: the PERSISTED state after a pre-hydration attempt is the
 * point (the saved list is unchanged, no audit row), not just the DOM.
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
import { addContactEmail, emailAudit, emailRows, removeEmailExtras } from "../support/person-emails-fixture";

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

test.describe("Hydration - Community address list editor (DECISION-159)", () => {
  test.setTimeout(120_000);
  test.use({ storageState: storageStatePath("congregation-clerk") });

  let sql: Sql;
  let state: CommunityFixtureState;
  const personIds: string[] = [];

  test.beforeAll(async () => {
    sql = platformSql("hydration/person-emails-editor.spec");
    await sweepCommunityPeople(sql);
    state = await setupCommunityFixture(sql);
  });

  test.afterAll(async () => {
    await removeEmailExtras(sql, personIds);
    await removeCommunityFixture(sql, state);
  });

  test("the address controls are disabled until hydration, then work; nothing was written before it", async ({ page }) => {
    const person = await createParticipantViaSql(sql, 60, "SpecEmailsHydration");
    personIds.push(person.personId);
    const saved = "e2e-60-hydration@example.invalid";
    await addContactEmail(sql, person.personId, { value: saved, subtype: "personal", isPrimary: true });

    const release = await holdScripts(page);
    await page.goto(`/o/${COMMUNITY_ORG.slug}/admin/community/${person.personId}/edit`, {
      waitUntil: "domcontentloaded",
    });

    const address = page.getByLabel("Email address", { exact: true });
    const label = page.getByLabel("Label", { exact: true });
    const remove = page.getByRole("button", { name: "Remove email address 1" });
    const add = page.getByRole("button", { name: /^add another email address$/i });
    const save = page.getByRole("button", { name: /^save$/i });
    await expect(address).toBeVisible();
    // (An uncontrolled react-hook-form input has no value in the server HTML: the
    // saved address appears at hydration, which is asserted after the release.)
    for (const control of [address, label, remove, add, save]) await expect(control).toBeDisabled();
    // A forced click on a disabled Remove opens nothing and writes nothing.
    await remove.click({ force: true }).catch(() => {});
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect((await emailRows(sql, person.personId)).map((r) => [r.value, r.ended])).toEqual([[saved, false]]);
    expect(await emailAudit(sql, person.personId)).toEqual([]);

    release();

    await expect(address).toBeEnabled();
    await expect(address).toHaveValue(saved);
    for (const control of [label, remove, add, save]) await expect(control).toBeEnabled();
    await remove.click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: /^keep$/i }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    // Keep changed nothing.
    expect((await emailRows(sql, person.personId)).map((r) => [r.value, r.ended])).toEqual([[saved, false]]);
  });
});
