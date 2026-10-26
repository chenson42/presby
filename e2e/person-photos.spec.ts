/**
 * person-photos.spec.ts - person photos, end to end against a running server
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 Test Plan E1, E4;
 * Batch 3):
 *
 *   ADMIN (E1, E4). `congregation-clerk` at e2e-alpha, who holds the spec-owned
 *   `e2e_community_clerk` role (people.manage, directory.view). At 360 px and at
 *   1280 px: the Photos link on the edit page (toggle on), a synthetic EXIF-rotated,
 *   GPS-bearing JPEG of about 5 MB and a synthetic PNG of about 9 MB each go through the
 *   client downscale (the request body is under the 1 MiB Server Action limit), the
 *   stored master is upright, at most 1200 px, with no metadata, the first becomes the
 *   directory photo, the website choice needs the attestation, a directory choice with
 *   the attestation moves the directory photo, the member directory shows the chosen
 *   thumbnail, and Remove (through the AlertDialog, which states the residuals) takes
 *   it out of the directory again. No horizontal scroll, 44 px targets, a dialog that
 *   fits the viewport, no native dialog.
 *
 *   The PUBLIC staff roster (E2) is `custom-domains/person-photos-roster.spec.ts`: a
 *   custom host needs the `custom-hosts` project's `*.invalid` resolver.
 *
 * EVERY PICTURE IS SYNTHETIC (random noise, invented metadata). No real photograph
 * enters the repository. The spec creates only its own rows and removes them itself
 * (DECISION-157); photo rows go first (F337).
 */
import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { storageStatePath } from "./support/users";
import { platformSql, withDbRetry, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  CLERK_EMAIL,
  COMMUNITY_ORG,
  createParticipantViaSql,
  removeCommunityFixture,
  setupCommunityFixture,
  sweepCommunityPeople,
  type CommunityFixtureState,
} from "./support/community-fixture";
import { addOpenStaffPosition, removeEmailExtras, sweepEmailExtras } from "./support/person-emails-fixture";
import {
  blobBytes,
  designationRows,
  getPhotosToggle,
  photoAudit,
  photoRows,
  removePhotoRows,
  removeSeededPhoto,
  restorePhotosToggle,
  seedPhoto,
  setPhotosToggle,
  sweepPhotoRows,
  syntheticExifJpeg,
  syntheticLargePng,
} from "./support/person-photos-fixture";

const BASE = `/o/${COMMUNITY_ORG.slug}/admin/community`;
const DIRECTORY = `/o/${COMMUNITY_ORG.slug}/directory`;
const DIRECTORY_FLAGS = ["org_portal.directory", "org_portal.directory_v2"];
const VIEWPORTS = [
  { name: "360px", width: 360, height: 800, n: 70 },
  { name: "desktop", width: 1280, height: 800, n: 72 },
] as const;

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** A dialog zooms in (95% to 100%), so the height is polled until the animation has settled. */
async function expectTouchTarget(page: Page, name: string | RegExp, role: "button" | "link" = "button") {
  const target = page.getByRole(role, { name }).first();
  await expect(target, `${String(name)} is rendered`).toBeVisible();
  await expect
    .poll(async () => (await target.boundingBox())?.height ?? 0, { message: `${String(name)} is at least 44px tall` })
    .toBeGreaterThanOrEqual(44);
}

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------

test.describe("Person photos: the admin page", () => {
  test.setTimeout(240_000);

  let sql: Sql;
  let state: CommunityFixtureState;
  let flags: FlagCapture;
  let priorToggle: boolean | null;
  const personIds: string[] = [];

  test.beforeAll(async () => {
    sql = platformSql("person-photos.spec");
    flags = await captureFlags(sql, DIRECTORY_FLAGS);
    for (const key of DIRECTORY_FLAGS) await setFlag(sql, key, true);
    priorToggle = await getPhotosToggle(sql, COMMUNITY_ORG.id);
    await setPhotosToggle(sql, COMMUNITY_ORG.id, true);
    await sweepPhotoRows(sql); // a crashed prior run's photo rows block the sweeps below (F337)
    await sweepEmailExtras(sql);
    await sweepCommunityPeople(sql);
    state = await setupCommunityFixture(sql);
  });

  test.afterAll(async () => {
    await removePhotoRows(sql, personIds);
    await removeEmailExtras(sql, personIds);
    await removeCommunityFixture(sql, state);
    await restorePhotosToggle(sql, COMMUNITY_ORG.id, priorToggle);
    await flags.restore();
  });

  for (const vp of VIEWPORTS) {
    test.describe(`at ${vp.name}`, () => {
      test.use({ storageState: storageStatePath("congregation-clerk"), viewport: { width: vp.width, height: vp.height } });

      test("upload through the downscale, designate for the directory and the website with the attestation, see it in the directory, remove it", async ({ page }) => {
        const nativeDialogs: string[] = [];
        page.on("dialog", (d) => {
          nativeDialogs.push(d.message());
          void d.dismiss();
        });
        // The wire size of each Server Action upload's picture, measured in the page where the body is still a
        // FormData (Playwright cannot see a streamed multipart body). Installed before any navigation.
        await page.addInitScript(() => {
          const w = window as unknown as { __uploadBytes: number[] };
          w.__uploadBytes = [];
          const original = window.fetch.bind(window);
          window.fetch = (input, init) => {
            const body = init?.body;
            const headers = new Headers(init?.headers);
            if (body instanceof FormData && headers.has("next-action")) {
              let total = 0;
              body.forEach((value) => {
                total += value instanceof File ? value.size : 0;
              });
              if (total > 0) w.__uploadBytes.push(total);
            }
            return original(input, init);
          };
        });
        const lastUploadBytes = async () => (await page.evaluate(() => (window as unknown as { __uploadBytes: number[] }).__uploadBytes.at(-1))) ?? 0;

        const person = await createParticipantViaSql(sql, vp.n, `SpecPhotos${vp.n}`);
        personIds.push(person.personId);
        await addOpenStaffPosition(sql, person.personId); // on the directory
        const first = person.firstName;
        const full = `${person.firstName} ${person.lastName}`;
        const since = (await withDbRetry("db clock", () => sql`select clock_timestamp()::text as t`)) as { t: string }[];

        // 1. The link on the edit page, because the toggle is on.
        await page.goto(`${BASE}/${person.personId}/edit`);
        const link = page.getByRole("link", { name: "Photos", exact: true });
        await expect(link).toBeVisible({ timeout: 45_000 });
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await link.click();

        // 2. The empty state and the controls.
        await expect(page.getByRole("heading", { level: 1, name: "Photos" })).toBeVisible({ timeout: 45_000 });
        await expect(page.getByText("No photos yet")).toBeVisible();
        await expect(page.getByText("0 of 10 photos")).toBeVisible();
        await expect(page.getByText(`Directory: no photo chosen, so members who can see ${first} in the directory see initials.`)).toBeVisible();
        const input = page.getByLabel("Add a photo");
        await expect(input).toBeEnabled({ timeout: 45_000 }); // hydrated
        await expect(input).not.toHaveAttribute("capture", /.*/);
        await expectTouchTarget(page, "Choose a photo");
        await expectTouchTarget(page, "Back to edit person", "link");
        await noHorizontalOverflow(page);

        // 3. A large EXIF-rotated, GPS-bearing JPEG through the downscale.
        const jpeg = await syntheticExifJpeg();
        expect(jpeg.byteLength, "the synthetic JPEG is far over the 1 MiB action limit").toBeGreaterThan(3_000_000);
        const sourceMeta = await sharp(jpeg).metadata();
        expect(sourceMeta.orientation).toBe(6);
        expect(sourceMeta.exif, "the source carries EXIF").toBeTruthy();
        await input.setInputFiles({ name: "Grandma's Beach Trip 2019.JPG", mimeType: "image/jpeg", buffer: jpeg });
        await expect(page.getByText("0 of 10 photos")).toBeHidden({ timeout: 60_000 });
        await expect(page.getByText("1 of 10 photos")).toBeVisible();
        await expect(page.getByAltText(`${full}, photo 1`)).toBeVisible();
        await expect(
          page.getByText(`Directory: members who can see ${first} in the directory see the photo marked "Directory" below.`),
        ).toBeVisible();

        let photos = await photoRows(sql, COMMUNITY_ORG.id, person.personId);
        expect(photos).toHaveLength(1);
        const sentBytes = await lastUploadBytes();
        expect(sentBytes, "the request carried the downscaled picture, not the 5 MB original").toBeLessThanOrEqual(1_000_000);
        expect(sentBytes).toBeGreaterThan(1_000);
        let master = await blobBytes(sql, photos[0]!.image_asset_key);
        expect(master).not.toBeNull();
        expect(master!.audience).toBe("private");
        expect(master!.contentType).toBe("image/jpeg");
        const stored = await sharp(master!.bytes).metadata();
        expect(stored.exif, "no EXIF (so no GPS) is stored").toBeUndefined();
        expect(stored.orientation).toBeUndefined();
        expect(stored.icc).toBeUndefined();
        expect(master!.bytes.includes(Buffer.from("Exif"))).toBe(false);
        expect(master!.bytes.includes(Buffer.from("synthetic e2e"))).toBe(false);
        expect(Math.max(stored.width!, stored.height!)).toBeLessThanOrEqual(1200);
        expect(stored.height!, "the rotate-90 landscape source is stored upright (portrait)").toBeGreaterThan(stored.width!);
        expect(master!.bytes.byteLength).toBeLessThanOrEqual(400_000);
        let designations = await designationRows(sql, COMMUNITY_ORG.id, person.personId);
        expect(designations.map((d) => [d.purpose, d.attested, d.ended])).toEqual([["directory", false, false]]);

        // 4. A large PNG through the same path; it is not auto-designated (the slot is taken).
        const png = await syntheticLargePng();
        expect(png.byteLength).toBeGreaterThan(5_000_000);
        await input.setInputFiles({ name: "scan.png", mimeType: "image/png", buffer: png });
        await expect(page.getByText("2 of 10 photos")).toBeVisible({ timeout: 90_000 });
        expect(await lastUploadBytes()).toBeLessThanOrEqual(1_000_000);
        photos = await photoRows(sql, COMMUNITY_ORG.id, person.personId);
        expect(photos).toHaveLength(2);
        const pngMaster = await blobBytes(sql, photos[1]!.image_asset_key);
        expect(pngMaster!.contentType).toBe("image/jpeg");
        expect((await sharp(pngMaster!.bytes).metadata()).exif).toBeUndefined();
        await noHorizontalOverflow(page);

        // 4b. Phase 5 run 1 (R-b): the directory photo was chosen without the website box, so the page offers a
        // remedy it can perform. The remedy line names the "Clear for website" button; the button opens a dialog
        // that records the clearance on the SAME photo, and the website line then names the directory photo.
        const first1 = page.getByRole("group", { name: `${full}, photo 1` });
        await expect(
          page.getByText(
            'Website: none. The directory photo isn\'t cleared for the website. Choose a website photo, or choose "Clear for website" on the photo marked "Directory".',
          ),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "Clear for website" })).toHaveCount(1); // photo 1 only
        await expect(page.getByRole("group", { name: `${full}, photo 2` }).getByRole("button", { name: "Clear for website" })).toHaveCount(0);
        await expect(first1.getByRole("button", { name: "Clear for website" })).toBeVisible();
        expect((await first1.getByRole("button", { name: "Clear for website" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await noHorizontalOverflow(page);
        await first1.getByRole("button", { name: "Clear for website" }).click();
        const clearDialog = page.getByRole("dialog");
        await expect(clearDialog.getByText("Clear this photo for the website?")).toBeVisible();
        await expect(clearDialog.getByText(/search engines and web archives may keep copies/i)).toBeVisible();
        const confirmClear = clearDialog.getByRole("button", { name: "Clear for website" });
        await expect(confirmClear).toBeDisabled();
        const clearBox = await clearDialog.boundingBox();
        expect(clearBox!.x).toBeGreaterThanOrEqual(0);
        expect(clearBox!.x + clearBox!.width).toBeLessThanOrEqual(vp.width);
        await clearDialog
          .getByLabel(`I have ${first}'s permission to also use this photo on the public website if they are listed there and no website photo is chosen.`)
          .check();
        await expect(confirmClear).toBeEnabled();
        await expect.poll(async () => (await confirmClear.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await confirmClear.click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.getByText("Website: the directory photo, because it was cleared for the website.")).toBeVisible();
        await expect(page.getByText("Directory, cleared for website")).toBeVisible();
        await expect(page.getByRole("button", { name: "Clear for website" })).toHaveCount(0);
        designations = await designationRows(sql, COMMUNITY_ORG.id, person.personId);
        expect(designations.filter((d) => !d.ended).map((d) => [d.photo_id === photos[0]!.id, d.purpose, d.attested])).toEqual([[true, "directory", true]]);
        await noHorizontalOverflow(page);

        // 5. The website choice needs the attestation: the confirm stays disabled until ticked.
        const one = page.getByRole("group", { name: `${full}, photo 1` });
        const two = page.getByRole("group", { name: `${full}, photo 2` });
        await expect(one.getByRole("button", { name: "Use on website" })).toBeEnabled();
        await one.getByRole("button", { name: "Use on website" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByText("Use this photo on the public website?")).toBeVisible();
        await expect(dialog.getByText(/search engines and web archives may keep copies/i)).toBeVisible();
        const confirmWebsite = dialog.getByRole("button", { name: "Use on website" });
        await expect(confirmWebsite).toBeDisabled();
        const box = await dialog.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
        await dialog.getByLabel(`I have ${first}'s permission to show this photo on the public website.`).check();
        await expect(confirmWebsite).toBeEnabled();
        await expectTouchTarget(page, "Use on website");
        await confirmWebsite.click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(one.getByRole("button", { name: "Stop using on website" })).toBeVisible();
        designations = await designationRows(sql, COMMUNITY_ORG.id, person.personId);
        expect(designations.filter((d) => !d.ended).map((d) => [d.photo_id === photos[0]!.id, d.purpose, d.attested]).sort()).toEqual([
          [true, "directory", true], // cleared in step 4b
          [true, "website", true],
        ]);

        // 6. A directory choice with the attestation: the directory photo moves to photo 2, cleared for the website.
        await two.getByRole("button", { name: "Use in directory" }).click();
        const dirDialog = page.getByRole("dialog");
        await expect(dirDialog.getByText("Use this photo in the directory?")).toBeVisible();
        const optional = dirDialog.getByLabel(new RegExp(`I have ${first}'s permission to also use this photo on the public website`));
        await expect(optional).not.toBeChecked();
        await optional.check();
        await dirDialog.getByRole("button", { name: "Use in directory" }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(page.getByText("Directory, cleared for website")).toBeVisible();
        designations = await designationRows(sql, COMMUNITY_ORG.id, person.personId);
        const activeDirectory = designations.find((d) => !d.ended && d.purpose === "directory")!;
        expect(activeDirectory.photo_id).toBe(photos[1]!.id);
        expect(activeDirectory.attested).toBe(true);
        await noHorizontalOverflow(page);

        // 7. The member directory shows photo 2's thumbnail.
        const thumb = await blobBytes(sql, photos[1]!.thumb_asset_key);
        expect(thumb!.contentType).toBe("image/webp");
        await page.goto(`${DIRECTORY}/${person.personId}`);
        const avatar = page.locator(`img[src^="data:image/webp;base64,"]`).first();
        await expect(avatar).toBeVisible({ timeout: 45_000 });
        expect(await avatar.getAttribute("src")).toBe(`data:image/webp;base64,${thumb!.bytes.toString("base64")}`);
        expect(await avatar.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
        await noHorizontalOverflow(page);

        // 8. View larger, then remove photo 2 through the AlertDialog.
        await page.goto(`${BASE}/${person.personId}/edit/photos`);
        await expect(page.getByText("2 of 10 photos")).toBeVisible({ timeout: 45_000 });
        await page.getByRole("group", { name: `${full}, photo 2` }).locator("xpath=ancestor::li").getByRole("link", { name: "View larger" }).click();
        await expect(page.getByRole("link", { name: "Back to all photos" })).toBeVisible({ timeout: 45_000 });
        const large = page.locator(`img[src^="data:image/jpeg;base64,"]`).first();
        await expect(large).toBeVisible();
        expect(await large.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
        await noHorizontalOverflow(page);
        await page.getByRole("link", { name: "Back to all photos" }).click();

        const removeButton = page.getByRole("group", { name: `${full}, photo 2` }).getByRole("button", { name: "Remove" });
        await expect(removeButton).toBeEnabled({ timeout: 45_000 });
        await removeButton.click();
        const alert = page.getByRole("alertdialog");
        await expect(alert.getByText("Remove this photo?")).toBeVisible();
        await expect(alert.getByText(/can't be erased from here/)).toBeVisible();
        await expect(
          alert.getByText(`It is ${first}'s directory photo, so wherever ${first} appears in the directory it will show initials instead.`),
        ).toBeVisible();
        const alertBox = await alert.boundingBox();
        expect(alertBox!.x).toBeGreaterThanOrEqual(0);
        expect(alertBox!.x + alertBox!.width).toBeLessThanOrEqual(vp.width);
        await expectTouchTarget(page, "Remove photo");
        await alert.getByRole("button", { name: "Remove photo" }).click();
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
        await expect(page.getByText("1 of 10 photos")).toBeVisible();
        await expect(page.getByText(`Directory: no photo chosen, so members who can see ${first} in the directory see initials.`)).toBeVisible();

        photos = await photoRows(sql, COMMUNITY_ORG.id, person.personId);
        expect(photos.map((p) => p.removed)).toEqual([false, true]);
        designations = await designationRows(sql, COMMUNITY_ORG.id, person.personId);
        expect(designations.filter((d) => !d.ended).map((d) => d.purpose)).toEqual(["website"]);

        // 9. The directory is back to initials; the audit rows exist for each act.
        await page.goto(`${DIRECTORY}/${person.personId}`);
        await expect(page.getByRole("heading", { level: 1, name: full })).toBeVisible({ timeout: 45_000 });
        await expect(page.locator(`img[src^="data:image/webp;base64,"]`)).toHaveCount(0);
        const actions = (await photoAudit(sql, person.personId, since[0]!.t)).map((a) => a.action);
        for (const expected of [
          "tenant.person_photo.added",
          "tenant.person_photo.designated",
          "tenant.person_photo.undesignated",
          "tenant.person_photo.removed",
        ]) {
          expect(actions, expected).toContain(expected);
        }
        expect(nativeDialogs, "no native dialog").toEqual([]);
      });
    });
  }

  test("E4: a directory page of 25 people with photos stays inside the 500 KB document budget, and every thumbnail loads", async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({ storageState: storageStatePath("congregation-clerk"), viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    try {
      const userRows = (await withDbRetry("clerk user", () => sql`select id::text from users where email = ${CLERK_EMAIL}`)) as { id: string }[];
      const tag = "SpecPhotosBudget";
      for (let n = 75; n < 100; n += 1) {
        const person = await createParticipantViaSql(sql, n, tag);
        personIds.push(person.personId);
        await addOpenStaffPosition(sql, person.personId);
        await seedPhoto(sql, {
          orgId: COMMUNITY_ORG.id,
          personId: person.personId,
          userId: userRows[0]!.id,
          tag: `budget-${n}`,
          purposes: ["directory"],
          thumbnail: "photographic",
        });
      }
      await page.goto(`${DIRECTORY}?search=${encodeURIComponent(tag)}`);
      const thumbs = page.locator(`main img[src^="data:image/webp;base64,"]`);
      await expect(thumbs).toHaveCount(25, { timeout: 60_000 });
      const loaded = await thumbs.evaluateAll((els) => (els as HTMLImageElement[]).filter((e) => e.complete && e.naturalWidth > 0).length);
      expect(loaded).toBe(25);
      const html = await page.content();
      const documentBytes = Buffer.byteLength(await (await page.request.get(page.url())).text(), "utf8");
      const averageThumb = Math.round(
        (await thumbs.evaluateAll((els) => (els as HTMLImageElement[]).reduce((n, e) => n + e.src.length, 0))) / 25,
      );
      // Recorded, so the revisit trigger (DECISION-289: 500 KB) has a measured baseline in the report.
      test.info().annotations.push({ type: "E4 document bytes (server HTML, 25 inlined thumbnails)", description: String(documentBytes) });
      test.info().annotations.push({ type: "E4 average inlined thumbnail data-URI chars", description: String(averageThumb) });
      console.info(`[person-photos E4] document ${documentBytes} bytes; average inlined thumbnail ${averageThumb} chars`);
      expect(html.length).toBeGreaterThan(0);
      expect(documentBytes, "the 25-thumbnail directory document is within 500 KB").toBeLessThanOrEqual(500_000);
      await noHorizontalOverflow(page);
    } finally {
      await context.close();
    }
  });

  test("with the toggle off the link is absent and the page says so; turning it on restores the link", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("congregation-clerk"), viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    try {
      const person = await createParticipantViaSql(sql, 74, "SpecPhotosOff");
      personIds.push(person.personId);
      await setPhotosToggle(sql, COMMUNITY_ORG.id, false);
      await page.goto(`${BASE}/${person.personId}/edit`);
      await expect(page.getByRole("button", { name: /^save$/i })).toBeEnabled({ timeout: 45_000 });
      await expect(page.getByRole("link", { name: "Photos", exact: true })).toHaveCount(0);
      await page.goto(`${BASE}/${person.personId}/edit/photos`);
      await expect(page.getByText(/Photos of people aren't turned on for .+\. Someone who manages your organization's features can turn them on\./)).toBeVisible({
        timeout: 45_000,
      });
      await expect(page.getByLabel("Add a photo")).toHaveCount(0);
      await noHorizontalOverflow(page);
    } finally {
      await setPhotosToggle(sql, COMMUNITY_ORG.id, true);
      await context.close();
    }
  });
});
