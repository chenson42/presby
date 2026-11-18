/**
 * oversight-photos.spec.ts (hydration) - the pre-hydration guard for a building's photos page (DECISION-159, rule H3;
 * Congregation profile Increment 2, Batch B9). Hold every `/_next/static/**.js` chunk, load with `domcontentloaded`,
 * assert the upload island and the larger view's controls are INERT, release the scripts, wait for the gate to open,
 * then act and assert the PERSISTED row. Why it matters: the upload's client downscale runs only after hydration, so a
 * file chosen earlier must never reach the Server Action as the original picture; and a pre-hydration click on "Remove
 * photo" must open and change nothing. A DOM check alone would not catch a control that looked inert but wrote.
 * Pictures are generated solid colours (no real photograph).
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, the production build (the lane that counts).
 * Flag `org_portal.oversight` set here and restored in afterAll.
 */
import { createHash, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { platformSql, type Sql } from "../support/db";
import { captureFlags, setFlag, type FlagCapture } from "../support/flags";
import {
  OVERSIGHT_FLAG,
  oversightAudit,
  removeOversightFixture,
  seedBuilding,
  setupOversightFixture,
  signedInContext,
  type OversightFixture,
} from "../support/oversight-fixture";

async function holdScripts(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => {
    await released;
    await route.continue().catch(() => {});
  });
  return release;
}

let sql: Sql;
let fx: OversightFixture;
let flags: FlagCapture;
let buildingId: string;
const photosPath = () => `/o/${fx.presbytery.slug}/admin/oversight/${fx.congA.id}/buildings/${buildingId}/photos`;

const colour = (i: number) => ({ r: (i * 37 + 20) % 256, g: (i * 91 + 60) % 256, b: (i * 53 + 100) % 256 });

/** A seeded live photo (owner path), the way `photo-store.ts` writes one: two private blobs and the row. */
async function seedPhotoRow(i: number, cover: boolean): Promise<string> {
  const master = await sharp({ create: { width: 800, height: 600, channels: 3, background: colour(i) } }).jpeg({ quality: 80 }).toBuffer();
  const thumb = await sharp({ create: { width: 160, height: 160, channels: 3, background: colour(i) } }).webp().toBuffer();
  const keys = [randomUUID(), randomUUID()];
  for (const [id, bytes, type] of [
    [keys[0]!, master, "image/jpeg"],
    [keys[1]!, thumb, "image/webp"],
  ] as const) {
    await sql`
      insert into blob_assets (id, organization_id, content_hash, content_type, byte_size, bytes, audience)
      values (${id}::uuid, ${fx.presbytery.id}::uuid, ${createHash("sha256").update(bytes).digest("hex")}, ${type},
              ${bytes.byteLength}, decode(${bytes.toString("hex")}, 'hex'), 'private')`;
  }
  const [row] = (await sql`
    insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, is_cover, created_by)
    values (${fx.presbytery.id}::uuid, ${fx.congA.id}::uuid, ${buildingId}::uuid, ${keys[0]!}::uuid, ${keys[1]!}::uuid, 800, 600, ${cover}, ${fx.users.clerk}::uuid)
    returning id::text`) as { id: string }[];
  return row!.id;
}

const photoRows = async () =>
  (await sql`
    select id::text, caption, is_cover, removed_at is not null as removed from oversight_building_photos
     where organization_id = ${fx.presbytery.id}::uuid and building_id = ${buildingId}::uuid order by created_at, id`) as Array<{
    id: string;
    caption: string | null;
    is_cover: boolean;
    removed: boolean;
  }>;

const photoAudit = async () => (await oversightAudit(sql, fx.presbytery.id)).filter((a) => a.action.startsWith("tenant.oversight_photo."));

test.describe("Hydration - building photos (DECISION-159)", () => {
  test.setTimeout(240_000);
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    sql = platformSql("hydration/oversight-photos.spec");
    flags = await captureFlags(sql, [OVERSIGHT_FLAG]);
    await setFlag(sql, OVERSIGHT_FLAG, true);
    fx = await setupOversightFixture(sql, { tag: "hp", who: ["clerk"] });
    buildingId = await seedBuilding(sql, fx, "congA", { name: "Hydration Hall", primary: true });
  });
  test.afterAll(async () => {
    if (sql && fx) await removeOversightFixture(sql, fx);
    await flags?.restore();
  });

  test("the upload is inert until hydration (nothing is written by a pre-hydration pick), then a picked picture is stored as the cover", async ({ browser }) => {
    const context = await signedInContext(browser, "clerk", photosPath(), { viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const release = await holdScripts(page);
    await page.goto(photosPath(), { waitUntil: "domcontentloaded" });

    const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    const input = page.locator("#building-photo-input");
    const button = page.locator("button", { hasText: "Add a photo" });
    await expect(input).toBeAttached();
    await expect(input).toBeDisabled();
    await expect(button).toBeDisabled();

    // A forced click and a file set on the disabled controls do nothing: no row, no audit row.
    await button.click({ force: true }).catch(() => {});
    await input
      .setInputFiles({ name: "early.jpg", mimeType: "image/jpeg", buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: colour(1) } }).jpeg().toBuffer() })
      .catch(() => {});
    expect(await photoRows()).toEqual([]);
    expect(await photoAudit()).toEqual([]);

    release();
    await expect(gate).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
    await expect(input).toBeEnabled();
    await expect(button).toBeEnabled();
    expect(await photoRows(), "nothing was written before hydration").toEqual([]);

    await input.setInputFiles({
      name: "after.jpg",
      mimeType: "image/jpeg",
      buffer: await sharp({ create: { width: 2000, height: 1500, channels: 3, background: colour(2) } }).jpeg().toBuffer(),
    });
    await expect(page.getByText("Photo added.")).toBeVisible({ timeout: 60_000 });
    const rows = await photoRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ caption: null, is_cover: true, removed: false });
    expect((await photoAudit()).map((a) => a.action)).toEqual(["tenant.oversight_photo.added"]);
    await context.close();
  });

  test("the larger view's controls are inert until hydration (a pre-hydration Remove opens nothing); after it, a caption and a new cover are persisted", async ({ browser }) => {
    const second = await seedPhotoRow(3, false);
    const before = await photoRows();
    expect(before).toHaveLength(2);
    const auditBefore = (await photoAudit()).length;

    const context = await signedInContext(browser, "clerk", photosPath(), { viewport: { width: 360, height: 740 } });
    const page = await context.newPage();
    const release = await holdScripts(page);
    await page.goto(`${photosPath()}?view=${second}`, { waitUntil: "domcontentloaded" });

    const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
    await expect(gate).toHaveAttribute("aria-busy", "true");
    const edit = page.getByRole("button", { name: "Edit caption" });
    const cover = page.getByRole("button", { name: "Make this the cover" });
    const remove = page.getByRole("button", { name: "Remove photo" });
    for (const control of [edit, cover, remove]) await expect(control).toBeDisabled();
    await remove.click({ force: true }).catch(() => {});
    await cover.click({ force: true }).catch(() => {});
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await photoRows()).toEqual(before);
    expect((await photoAudit()).length).toBe(auditBefore);

    release();
    await expect(gate).not.toHaveAttribute("aria-busy", "true", { timeout: 30_000 });
    for (const control of [edit, cover, remove]) await expect(control).toBeEnabled();

    // Remove opens an AlertDialog and Cancel changes nothing.
    await remove.click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect((await photoRows()).every((r) => !r.removed)).toBe(true);

    // A caption typed after the gate opened is the one saved (react-hook-form writes defaults over the DOM at hydration).
    await edit.click();
    await page.locator("#photo-caption").fill("Chosen after hydration");
    await page.getByRole("button", { name: "Save caption" }).click();
    await expect(page.getByText("Caption saved.")).toBeVisible();
    await expect.poll(async () => (await photoRows()).find((r) => r.id === second)!.caption).toBe("Chosen after hydration");

    await cover.click();
    await expect(page.getByText("Cover changed.")).toBeVisible();
    await expect.poll(async () => (await photoRows()).find((r) => r.id === second)!.is_cover).toBe(true);
    expect((await photoRows()).filter((r) => r.is_cover).map((r) => r.id)).toEqual([second]);
    await context.close();
  });
});
