/**
 * person-photos-upload.spec.ts - the pre-hydration guard for the photos page
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 Test Plan E3;
 * DECISION-159). Same pattern as person-emails-editor.spec.ts: hold every
 * `/_next/static/**.js` chunk, load with `domcontentloaded`, assert the controls
 * are inoperable, release the scripts, use control enablement as the hydration
 * signal (no networkidle, no waitForTimeout, no throttling).
 *
 * What it guards: a file picked before the page's JavaScript runs would be posted
 * as the ORIGINAL, un-downscaled picture (the client downscale never ran), so the
 * upload input and its button stay disabled until hydration, and so do the
 * per-photo buttons (a pre-hydration click on Remove must open and change nothing).
 * The PERSISTED state after a pre-hydration attempt is the point: the person's
 * photos and designations are unchanged and no audit row exists.
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in the
 * `prod-build` project.
 */
import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "../support/users";
import { platformSql, withDbRetry, type Sql } from "../support/db";
import {
  CLERK_EMAIL,
  COMMUNITY_ORG,
  createParticipantViaSql,
  removeCommunityFixture,
  setupCommunityFixture,
  sweepCommunityPeople,
  type CommunityFixtureState,
} from "../support/community-fixture";
import {
  designationRows,
  getPhotosToggle,
  photoAudit,
  photoRows,
  removePhotoRows,
  restorePhotosToggle,
  seedPhoto,
  setPhotosToggle,
  sweepPhotoRows,
  syntheticLargePng,
} from "../support/person-photos-fixture";

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

test.describe("Hydration - the person photos page (DECISION-159)", () => {
  test.setTimeout(180_000);
  test.use({ storageState: storageStatePath("congregation-clerk") });

  let sql: Sql;
  let state: CommunityFixtureState;
  let priorToggle: boolean | null;
  const personIds: string[] = [];

  test.beforeAll(async () => {
    sql = platformSql("hydration/person-photos-upload.spec");
    priorToggle = await getPhotosToggle(sql, COMMUNITY_ORG.id);
    await setPhotosToggle(sql, COMMUNITY_ORG.id, true);
    await sweepPhotoRows(sql);
    await sweepCommunityPeople(sql);
    state = await setupCommunityFixture(sql);
  });

  test.afterAll(async () => {
    await removePhotoRows(sql, personIds);
    await removeCommunityFixture(sql, state);
    await restorePhotosToggle(sql, COMMUNITY_ORG.id, priorToggle);
  });

  test("the upload and the per-photo buttons are disabled until hydration, then work; nothing was written before it", async ({ page }) => {
    const person = await createParticipantViaSql(sql, 76, "SpecPhotosHydration");
    personIds.push(person.personId);
    const user = (await withDbRetry("clerk user", () => sql`select id::text from users where email = ${CLERK_EMAIL}`)) as { id: string }[];
    const seeded = await seedPhoto(sql, { orgId: COMMUNITY_ORG.id, personId: person.personId, userId: user[0]!.id, tag: "hydration", purposes: ["directory"] });
    const full = `${person.firstName} ${person.lastName}`;

    const release = await holdScripts(page);
    await page.goto(`/o/${COMMUNITY_ORG.slug}/admin/community/${person.personId}/edit/photos`, { waitUntil: "domcontentloaded" });

    const input = page.getByLabel("Add a photo");
    const choose = page.getByRole("button", { name: "Choose a photo" });
    const group = page.getByRole("group", { name: `${full}, photo 1` });
    const remove = group.getByRole("button", { name: "Remove" });
    const stopDirectory = group.getByRole("button", { name: "Stop using in directory" });
    const useWebsite = group.getByRole("button", { name: "Use on website" });
    // The seeded directory photo is NOT cleared for the website, so its tile carries a fourth button (Phase 5 run 1, R-b).
    const clearWebsite = group.getByRole("button", { name: "Clear for website" });
    await expect(input).toBeAttached();
    for (const control of [input, choose, remove, stopDirectory, clearWebsite, useWebsite]) await expect(control).toBeDisabled();

    // A forced click on a disabled Remove opens nothing, and a file set on the disabled input is refused by the browser.
    await remove.click({ force: true }).catch(() => {});
    await clearWebsite.click({ force: true }).catch(() => {});
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await input.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: await syntheticLargePng(800, 600) }).catch(() => {});
    expect(await photoRows(sql, COMMUNITY_ORG.id, person.personId)).toHaveLength(1);
    expect((await designationRows(sql, COMMUNITY_ORG.id, person.personId)).map((d) => [d.photo_id === seeded.photoId, d.purpose, d.ended])).toEqual([
      [true, "directory", false],
    ]);
    expect(await photoAudit(sql, person.personId)).toEqual([]);

    release();

    await expect(input).toBeEnabled();
    for (const control of [choose, remove, stopDirectory, clearWebsite, useWebsite]) await expect(control).toBeEnabled();
    await remove.click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: /^cancel$/i }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    // Cancel changed nothing.
    expect((await photoRows(sql, COMMUNITY_ORG.id, person.personId)).map((p) => p.removed)).toEqual([false]);
  });
});
