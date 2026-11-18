/**
 * oversight-photos.spec.ts - a building's photos, end to end (Congregation profile Increment 2, Batch B9;
 * docs/work-log/2026-11-17-congregation-profile-inc2.md, parent Phase 3 "Test plan" E2E rows for photos).
 *
 * WHO: a presbytery clerk who holds `congregation_oversight.manage` and nothing else (the tier-1 key photos
 * ride), and a finance-only holder (MFA enrolled) for the Locked state. A throwaway presbytery from
 * `support/oversight-fixture.ts`; flag `org_portal.oversight` set here and restored in afterAll.
 *
 * COVERS, on a 360px phone: the Photos block on the building page ("Add a photo" when there is none); an
 * upload of a GENERATED, EXIF- and GPS-bearing picture through the real island (the client downscale, the
 * Server Action, the pipeline) with the stored master checked for private audience and no metadata, the
 * first photo becoming the cover; two more uploads and the grid (two columns, no sideways scroll, 44px
 * targets, one "Cover" badge); the larger view (`?view=`, its controls); a caption (a 201-character one
 * refused under the field, a 200-character unbroken one that wraps without sideways scroll, a short one
 * saved); make cover (the badge moves, the cover shows on the record page and the building page); remove
 * through the AlertDialog (Cancel changes nothing, confirm hides the photo and keeps the row); a wrong-type
 * file and a duplicate refused with their fixed strings and nothing written; the cap at ten (a stale page's
 * eleventh is refused, a fresh page shows the sentence and no Add button); a finance-only holder sees the
 * Locked state and no picture; another presbytery's congregation, another congregation's building, a
 * removed building and a non-UUID are the same 404, and a `?view=` that is not a live photo of THIS
 * building shows nothing larger; and audit rows that carry ids and booleans, never a caption or a filename.
 *
 * EVERY PICTURE IS GENERATED (a solid colour, no real photograph). The cases share one signed-in context and
 * one building, so they run in order (`describe.serial`).
 */
import { createHash, randomUUID } from "node:crypto";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import sharp from "sharp";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  mainText,
  newPhonePage,
  noSidewaysScroll,
  OVERSIGHT_FLAG,
  oversightAudit,
  removeOversightFixture,
  seedBuilding,
  setupOversightFixture,
  signedInContext,
  smallControls,
  type OversightFixture,
} from "./support/oversight-fixture";

let sql: Sql;
let fx: OversightFixture;
let flags: FlagCapture;
let clerk: BrowserContext;
let finance: BrowserContext;
let buildingId: string;
let otherBuildingId: string;
const base = () => `/o/${fx.presbytery.slug}/admin/oversight`;
const record = () => `${base()}/${fx.congA.id}`;
const buildingPath = () => `${record()}/buildings/${buildingId}`;
const photosPath = () => `${buildingPath()}/photos`;

const SENTINEL_CAPTION = "SENTINEL-CAPTION-5521 east wall";
const UPLOADED: string[] = []; // photo ids, in the order the island uploaded them

/** A distinct, generated solid colour per index (so no two pictures are byte-identical). */
const colour = (i: number) => ({ r: (i * 37 + 20) % 256, g: (i * 91 + 60) % 256, b: (i * 53 + 100) % 256 });

/** A generated solid-colour JPEG, large enough that the client downscale has real work, with an EXIF orientation and a GPS latitude. */
async function generatedJpeg(i: number, width = 2400, height = 1600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: colour(i) } })
    .jpeg({ quality: 90 })
    .withMetadata({
      orientation: 6,
      exif: { IFD0: { Copyright: "synthetic e2e" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 0/1 0/1" } },
    })
    .toBuffer();
}

/** A seeded live photo (owner path), the way `photo-store.ts` writes one: two private blobs and the row. Returns the photo id. */
async function seedPhotoRow(into: string, i: number): Promise<string> {
  const master = await sharp({ create: { width: 800, height: 600, channels: 3, background: colour(i + 100) } }).jpeg({ quality: 80 }).toBuffer();
  const thumb = await sharp({ create: { width: 160, height: 160, channels: 3, background: colour(i + 100) } }).webp().toBuffer();
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
    insert into oversight_building_photos (organization_id, about_org_id, building_id, image_asset_key, thumb_asset_key, width, height, created_by)
    values (${fx.presbytery.id}::uuid, ${fx.congA.id}::uuid, ${into}::uuid, ${keys[0]!}::uuid, ${keys[1]!}::uuid, 800, 600, ${fx.users.clerk}::uuid)
    returning id::text`) as { id: string }[];
  return row!.id;
}

interface PhotoRow {
  id: string;
  caption: string | null;
  is_cover: boolean;
  removed: boolean;
  has_remover: boolean;
  width: number;
  height: number;
  image_asset_key: string;
}

async function photoRows(forBuilding = buildingId): Promise<PhotoRow[]> {
  return (await sql`
    select id::text, caption, is_cover, removed_at is not null as removed, removed_by is not null as has_remover, width, height,
           image_asset_key::text
      from oversight_building_photos
     where organization_id = ${fx.presbytery.id}::uuid and about_org_id = ${fx.congA.id}::uuid and building_id = ${forBuilding}::uuid
     order by created_at, id`) as never;
}

const livePhotos = async () => (await photoRows()).filter((p) => !p.removed);

async function photoAudit() {
  return (await oversightAudit(sql, fx.presbytery.id)).filter((a) => a.action.startsWith("tenant.oversight_photo."));
}

const tiles = (page: Page) => page.locator('a[aria-label^="View larger"]');
const fileInput = (page: Page) => page.locator("#building-photo-input");

/** The sr-only file input is 1px by design (the person-photo precedent); every other control must be a thumb target. */
async function smallOnes(page: Page): Promise<string[]> {
  return (await smallControls(page)).filter((s) => !s.startsWith('input ""'));
}

/** Waits for the island to hydrate (the gate opens), then chooses one generated file and waits for the toast. */
async function upload(page: Page, i: number, toastText: string | RegExp = "Photo added.") {
  const input = fileInput(page);
  await expect(input).toBeEnabled({ timeout: 60_000 });
  await input.setInputFiles({ name: `Generated Colour ${i}.JPG`, mimeType: "image/jpeg", buffer: await generatedJpeg(i) });
  await expect(page.getByText(toastText).first()).toBeVisible({ timeout: 60_000 });
}

test.describe.serial("Oversight photos: a building's photos", () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(420_000);
    sql = platformSql("oversight-photos.spec");
    flags = await captureFlags(sql, [OVERSIGHT_FLAG]);
    await setFlag(sql, OVERSIGHT_FLAG, true);
    fx = await setupOversightFixture(sql, { tag: "p", who: ["clerk", "finance"] });
    buildingId = await seedBuilding(sql, fx, "congA", { name: "Main Sanctuary", primary: true, yearBuilt: 1931 });
    otherBuildingId = await seedBuilding(sql, fx, "congA", { name: "Fellowship Hall", type: "fellowship_hall" });
    clerk = await signedInContext(browser, "clerk", record());
    finance = await signedInContext(browser, "finance", record());
  });

  test.afterAll(async () => {
    await clerk?.close();
    await finance?.close();
    if (sql && fx) await removeOversightFixture(sql, fx);
    await flags?.restore();
  });

  test("the building page offers \"Add a photo\"; the photos page is empty, hydrated, and has a file input with no capture attribute", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(buildingPath());
    const block = page.getByRole("region", { name: "Photos", exact: true });
    await expect(block).toBeVisible();
    await expect(block.getByRole("link", { name: "Add a photo" })).toBeVisible();
    await block.getByRole("link", { name: "Add a photo" }).click();
    await page.waitForURL((url) => url.pathname === photosPath());

    await expect(page.getByRole("heading", { level: 1, name: "Photos of Main Sanctuary" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "All photos (0)" })).toBeVisible();
    await expect(tiles(page)).toHaveCount(0);
    await expect(fileInput(page)).toBeEnabled({ timeout: 60_000 }); // hydrated
    await expect(fileInput(page)).not.toHaveAttribute("capture", /.*/);
    const add = page.locator("button", { hasText: "Add a photo" });
    expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noSidewaysScroll(page);
    expect(await smallOnes(page)).toEqual([]);
    await page.close();
  });

  test("an upload through the island: downscaled, stored private with no metadata, the first photo is the cover; audited with ids only", async () => {
    const nativeDialogs: string[] = [];
    const page = await newPhonePage(clerk);
    page.on("dialog", (d) => {
      nativeDialogs.push(d.message());
      void d.dismiss();
    });
    // The wire size of the Server Action's picture, measured in the page where the body is still a FormData.
    await page.addInitScript(() => {
      const w = window as unknown as { __uploadBytes: number[] };
      w.__uploadBytes = [];
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const body = init?.body;
        if (body instanceof FormData && new Headers(init?.headers).has("next-action")) {
          let total = 0;
          body.forEach((value) => {
            total += value instanceof File ? value.size : 0;
          });
          if (total > 0) w.__uploadBytes.push(total);
        }
        return original(input, init);
      };
    });
    await page.goto(photosPath());
    const source = await generatedJpeg(1);
    expect((await sharp(source).metadata()).exif, "the source carries EXIF").toBeTruthy();
    await upload(page, 1);
    await expect(page.getByRole("heading", { level: 2, name: "All photos (1)" })).toBeVisible();
    await expect(tiles(page)).toHaveCount(1);
    await expect(page.getByText("Cover", { exact: true })).toHaveCount(1);
    expect(nativeDialogs).toEqual([]);

    const sent = (await page.evaluate(() => (window as unknown as { __uploadBytes: number[] }).__uploadBytes.at(-1))) ?? 0;
    expect(sent, "the request carried the downscaled picture").toBeLessThanOrEqual(1_000_000);
    expect(sent).toBeGreaterThan(100);

    const rows = await photoRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.is_cover, "the building's first photo carries the cover mark").toBe(true);
    UPLOADED.push(rows[0]!.id);
    expect(Math.max(rows[0]!.width, rows[0]!.height)).toBeLessThanOrEqual(1200);
    const [master] = (await sql`
      select audience, content_type, bytes from blob_assets where id = ${rows[0]!.image_asset_key}::uuid`) as { audience: string; content_type: string; bytes: Buffer }[];
    expect(master!.audience).toBe("private");
    expect(master!.content_type).toBe("image/jpeg");
    const stored = await sharp(master!.bytes).metadata();
    expect(stored.exif, "no EXIF (so no GPS) is stored").toBeUndefined();
    expect(master!.bytes.includes(Buffer.from("synthetic e2e"))).toBe(false);

    const audit = await photoAudit();
    expect(audit.map((a) => a.action)).toEqual(["tenant.oversight_photo.added"]);
    expect(audit[0]!.resource_id).toBe(rows[0]!.id);
    expect(audit[0]!.metadata).toMatchObject({
      organizationId: fx.presbytery.id,
      aboutOrgId: fx.congA.id,
      buildingId,
      photoId: rows[0]!.id,
      cover: true,
    });
    expect(JSON.stringify(audit)).not.toMatch(/Generated Colour|\.JPG/i);
    await page.close();
  });

  test("two more uploads: the grid is two columns at 360px, every target is 44px, no sideways scroll, one Cover badge", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(photosPath());
    await upload(page, 2);
    await expect(page.getByRole("heading", { level: 2, name: "All photos (2)" })).toBeVisible();
    await upload(page, 3);
    await expect(page.getByRole("heading", { level: 2, name: "All photos (3)" })).toBeVisible();
    const rows = await livePhotos();
    expect(rows).toHaveLength(3);
    UPLOADED.push(...rows.slice(1).map((r) => r.id));
    expect(rows.map((r) => r.is_cover)).toEqual([true, false, false]);

    await expect(tiles(page)).toHaveCount(3);
    const boxes = await Promise.all((await tiles(page).all()).map((t) => t.boundingBox()));
    const [a, b, c] = boxes as NonNullable<(typeof boxes)[number]>[];
    expect(Math.abs(a!.y - b!.y), "the first two tiles share a row").toBeLessThan(2);
    expect(b!.x, "the second sits to the right of the first").toBeGreaterThanOrEqual(a!.x + a!.width - 1);
    expect(c!.y, "the third wraps to a new row").toBeGreaterThan(a!.y + 100);
    expect(c!.x, "and starts the left column").toBeLessThan(a!.x + 2);
    for (const box of boxes) expect(box!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText("Cover", { exact: true })).toHaveCount(1);
    await expect(page.locator(`li:has(a[href$="?view=${UPLOADED[0]}"])`)).toContainText("Cover");
    await noSidewaysScroll(page);
    expect(await smallOnes(page)).toEqual([]);
    await page.close();
  });

  test("a wrong-type file, a corrupt picture and a duplicate are each refused with their fixed string, and nothing is written", async () => {
    const before = { rows: (await photoRows()).length, audit: (await photoAudit()).length };
    const page = await newPhonePage(clerk);
    await page.goto(photosPath());
    const input = fileInput(page);
    await expect(input).toBeEnabled({ timeout: 60_000 });

    const wrongType = "That file isn't a JPEG, PNG or WebP picture.";
    await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("this is not a picture") });
    await expect(page.getByText(wrongType, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(input).toBeEnabled();

    await input.setInputFiles({ name: "broken.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not really a jpeg, just text pretending") });
    await expect(page.getByText(wrongType, { exact: false }).first()).toBeVisible();

    // The first picture again: byte-identical after the same downscale, so the server refuses it as a duplicate.
    await input.setInputFiles({ name: "same-again.jpg", mimeType: "image/jpeg", buffer: await generatedJpeg(1) });
    await expect(page.getByText("That picture is already in this building's photos.")).toBeVisible({ timeout: 60_000 });

    expect((await photoRows()).length).toBe(before.rows);
    expect((await photoAudit()).length).toBe(before.audit);
    await noSidewaysScroll(page);
    await page.close();
  });

  test("the larger view: the master, its controls at 44px, a way back; no sideways scroll", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(photosPath());
    await tiles(page).nth(1).click();
    await page.waitForURL((url) => url.pathname === photosPath() && url.search === `?view=${UPLOADED[1]}`);
    const large = page.locator('img[alt="Photo"]');
    await expect(large).toBeVisible();
    expect(await large.getAttribute("src")).toMatch(/^data:image\/jpeg;base64,/);
    await expect(page.getByRole("button", { name: "Edit caption" })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Make this the cover" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove photo" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to all photos" })).toBeVisible();
    await noSidewaysScroll(page);
    expect(await smallOnes(page)).toEqual([]);

    // The cover's own larger view has no "Make this the cover".
    await page.goto(`${photosPath()}?view=${UPLOADED[0]}`);
    await expect(page.getByRole("button", { name: "Edit caption" })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Make this the cover" })).toHaveCount(0);
    await page.getByRole("link", { name: "Back to all photos" }).click();
    await page.waitForURL((url) => url.pathname === photosPath() && url.search === "");
    await page.close();
  });

  test("caption: 201 characters is refused under the field; 200 unbroken characters wrap with no sideways scroll; a short caption is saved", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(`${photosPath()}?view=${UPLOADED[1]}`);
    await expect(page.getByRole("button", { name: "Edit caption" })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Edit caption" }).click();
    const field = page.locator("#photo-caption");
    await expect(page.getByLabel("Caption (optional)")).toBeVisible();

    await field.fill("A".repeat(201));
    await page.getByRole("button", { name: "Save caption" }).click();
    await expect(page.getByText("Caption must be 200 characters or fewer.")).toBeVisible();
    expect((await photoRows()).find((p) => p.id === UPLOADED[1])!.caption).toBeNull();

    await field.fill("W".repeat(200));
    await page.getByRole("button", { name: "Save caption" }).click();
    await expect(page.getByText("Caption saved.")).toBeVisible();
    await expect.poll(async () => (await photoRows()).find((p) => p.id === UPLOADED[1])!.caption).toBe("W".repeat(200));
    await expect(page.locator(`img[alt="${"W".repeat(200)}"]`)).toBeVisible();
    await noSidewaysScroll(page);
    await page.goto(photosPath());
    await expect(page.getByRole("link", { name: `View larger: ${"W".repeat(200)}` })).toBeVisible();
    await noSidewaysScroll(page);

    // A short caption, then an unchanged save writes nothing.
    await page.goto(`${photosPath()}?view=${UPLOADED[1]}`);
    await expect(page.getByRole("button", { name: "Edit caption" })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Edit caption" }).click();
    await page.locator("#photo-caption").fill(SENTINEL_CAPTION);
    await page.getByRole("button", { name: "Save caption" }).click();
    await expect(page.getByText("Caption saved.")).toBeVisible();
    await expect.poll(async () => (await photoRows()).find((p) => p.id === UPLOADED[1])!.caption).toBe(SENTINEL_CAPTION);
    const captionAudits = (await photoAudit()).filter((a) => a.action === "tenant.oversight_photo.caption_set");
    expect(captionAudits).toHaveLength(2);
    // Wait for the refreshed view (the form's default is the caption the page was rendered with).
    await expect(page.locator(`img[alt="${SENTINEL_CAPTION}"]`)).toBeVisible();
    await page.getByRole("button", { name: "Edit caption" }).click();
    await expect(page.locator("#photo-caption")).toHaveValue(SENTINEL_CAPTION);
    await page.getByRole("button", { name: "Save caption" }).click();
    await expect(page.getByRole("button", { name: "Edit caption" })).toBeEnabled();
    expect((await photoAudit()).filter((a) => a.action === "tenant.oversight_photo.caption_set")).toHaveLength(2);
    await page.close();
  });

  test("make cover: the button goes, the Cover badge moves, the record page's building card and the building page show it; audited with the previous cover", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(`${photosPath()}?view=${UPLOADED[1]}`);
    await expect(page.getByRole("button", { name: "Make this the cover" })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Make this the cover" }).click();
    await expect(page.getByText("Cover changed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Make this the cover" })).toHaveCount(0);
    expect(
      (await livePhotos()).map((p) => [p.id === UPLOADED[1], p.is_cover]).filter(([, cover]) => cover),
      "exactly one photo carries the mark, the one chosen",
    ).toEqual([[true, true]]);

    await expect(page.getByText("Cover", { exact: true })).toHaveCount(1);
    await expect(page.locator(`li:has(a[href$="?view=${UPLOADED[1]}"])`)).toContainText("Cover");

    const audit = (await photoAudit()).filter((a) => a.action === "tenant.oversight_photo.cover_set");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ photoId: UPLOADED[1], previousCoverPhotoId: UPLOADED[0], buildingId });

    // Making the cover the cover again writes nothing more.
    await page.goto(`${photosPath()}?view=${UPLOADED[1]}`);
    await expect(page.getByRole("button", { name: "Edit caption" })).toBeEnabled({ timeout: 60_000 });
    expect((await photoAudit()).filter((a) => a.action === "tenant.oversight_photo.cover_set")).toHaveLength(1);

    // The cover on the record page's building card, and the building page's Photos block.
    await page.goto(record());
    const card = page.getByRole("region", { name: "Buildings", exact: true }).getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: "Main Sanctuary" }) });
    await expect(card.locator('img[src^="data:image/webp"]')).toHaveCount(1);
    await noSidewaysScroll(page);
    await page.goto(buildingPath());
    const block = page.getByRole("region", { name: "Photos", exact: true });
    await expect(block.locator('img[src^="data:image/webp"]')).toHaveCount(1);
    await expect(block.getByRole("link", { name: "All photos (3)" })).toBeVisible();
    await expect(block.getByRole("link", { name: "Add a photo" })).toHaveCount(0);
    await noSidewaysScroll(page);
    expect(await smallOnes(page)).toEqual([]);
    await page.close();
  });

  test("remove: the AlertDialog states the file stays; Cancel changes nothing; confirming hides the photo, returns to the grid and keeps the row", async () => {
    const nativeDialogs: string[] = [];
    const page = await newPhonePage(clerk);
    page.on("dialog", (d) => {
      nativeDialogs.push(d.message());
      void d.dismiss();
    });
    await page.goto(`${photosPath()}?view=${UPLOADED[2]}`);
    await expect(page.getByRole("button", { name: "Remove photo" })).toBeEnabled({ timeout: 60_000 });
    await page.getByRole("button", { name: "Remove photo" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Remove this photo?")).toBeVisible();
    await expect(dialog).toContainText("The picture file itself stays in storage and can't be erased from here.");
    // The dialog zooms in, so the heights are polled until it has settled.
    for (const name of ["Cancel", "Remove photo"]) {
      await expect.poll(async () => (await dialog.getByRole("button", { name, exact: true }).boundingBox())?.height ?? 0, { message: `${name} is 44px` }).toBeGreaterThanOrEqual(44);
    }
    const dialogBox = (await dialog.boundingBox())!;
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(360);

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await livePhotos()).toHaveLength(3);

    await page.getByRole("button", { name: "Remove photo" }).click();
    await dialog.getByRole("button", { name: "Remove photo", exact: true }).click();
    await expect(page.getByText("Photo removed.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === photosPath() && url.search === "");
    await expect(page.getByRole("heading", { level: 2, name: "All photos (2)" })).toBeVisible();
    await expect(tiles(page)).toHaveCount(2);
    expect(nativeDialogs).toEqual([]);

    const rows = await photoRows();
    expect(rows).toHaveLength(3); // never deleted
    const removed = rows.find((r) => r.id === UPLOADED[2])!;
    expect(removed.removed && removed.has_remover).toBe(true);
    const audit = (await photoAudit()).filter((a) => a.action === "tenant.oversight_photo.removed");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ photoId: UPLOADED[2], buildingId });
    await noSidewaysScroll(page);
    await page.close();
  });

  test("a finance-only holder sees the Locked state on the photos page, with or without ?view=, and no picture", async () => {
    const page = await newPhonePage(finance);
    for (const path of [photosPath(), `${photosPath()}?view=${UPLOADED[0]}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: "Photos" })).toBeVisible();
      await expect(page.getByText("Locked", { exact: true })).toBeVisible();
      await expect(page.getByText("You need permission to manage congregation oversight.")).toBeVisible();
      await expect(page.locator('img[src^="data:"]')).toHaveCount(0);
      await expect(fileInput(page)).toHaveCount(0);
      await expect(tiles(page)).toHaveCount(0);
      await expect(page.getByText(SENTINEL_CAPTION)).toHaveCount(0);
      await expect(page.getByRole("link", { name: `Back to ${fx.congA.name}` })).toHaveAttribute("href", record());
    }
    await page.close();
  });

  test("another presbytery's congregation, another congregation's building, a removed building and a non-UUID are the same 404; a ?view= that is not a live photo of this building shows nothing", async () => {
    const foreign = await seedBuilding(sql, fx, "congB", { name: "Birch Hall" });
    const congOBuilding = await seedBuilding(sql, fx, "congO", { name: "Cedar Hall" });
    const gone = await seedBuilding(sql, fx, "congA", { name: "Old Chapel" });
    await sql`update oversight_buildings set removed_at = now(), removed_by = ${fx.users.clerk}::uuid where id = ${gone}::uuid`;
    const page = await newPhonePage(clerk);

    const probe = async (path: string) => {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      return await mainText(page);
    };
    const absent = await probe(`${record()}/buildings/00000000-0000-4089-8000-0000000000ff/photos`);
    expect(absent).not.toBe("");
    expect(await probe(`${record()}/buildings/${foreign}/photos`), "another congregation's building").toBe(absent);
    expect(await probe(`${record()}/buildings/${gone}/photos`), "a removed building").toBe(absent);
    expect(await probe(`${record()}/buildings/not-a-uuid/photos`), "a non-UUID building").toBe(absent);
    expect(await probe(`${base()}/not-a-uuid/buildings/${buildingId}/photos`), "a non-UUID congregation").toBe(absent);
    expect(await probe(`${base()}/${fx.congO.id}/buildings/${congOBuilding}/photos`), "another presbytery's congregation").toBe(absent);
    expect(await probe(`${base()}/${fx.congO.id}/buildings/${buildingId}/photos`), "another presbytery's congregation with this building's id").toBe(absent);

    // `?view=` honours only a LIVE photo of THIS building: another building's, a removed one, and a non-UUID show no larger picture.
    const otherPhoto = await seedPhotoRow(otherBuildingId, 1);
    for (const view of [otherPhoto, UPLOADED[2]!, "not-a-uuid", "00000000-0000-4089-8000-0000000000fd"]) {
      const response = await page.goto(`${photosPath()}?view=${view}`);
      expect(response?.status(), view).toBe(200);
      await expect(page.getByRole("heading", { level: 2, name: "All photos (2)" })).toBeVisible();
      await expect(page.locator('img[alt="Photo"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Remove photo" })).toHaveCount(0);
    }
    await page.close();
  });

  test("the cap: a stale page's eleventh photo is refused, and a fresh page shows the sentence and no Add button", async () => {
    // Two live photos now. Seed seven more (nine live), open the page, seed the tenth, then upload from the stale page.
    for (let i = 1; i <= 7; i += 1) await seedPhotoRow(buildingId, i + 10);
    expect(await livePhotos()).toHaveLength(9);
    const stale = await newPhonePage(clerk);
    await stale.goto(photosPath());
    await expect(stale.getByRole("heading", { level: 2, name: "All photos (9)" })).toBeVisible();
    await expect(fileInput(stale)).toBeEnabled({ timeout: 60_000 });
    await seedPhotoRow(buildingId, 30);
    expect(await livePhotos()).toHaveLength(10);

    const before = (await photoAudit()).length;
    await upload(stale, 40, "This building already has 10 photos. Remove one to add another.");
    expect(await livePhotos()).toHaveLength(10);
    expect((await photoAudit()).length).toBe(before);
    await stale.close();

    const fresh = await newPhonePage(clerk);
    await fresh.goto(photosPath());
    await expect(fresh.getByRole("heading", { level: 2, name: "All photos (10)" })).toBeVisible();
    await expect(fresh.getByRole("status").filter({ hasText: "This building already has 10 photos. Remove one to add another." })).toBeVisible();
    await expect(fileInput(fresh)).toHaveCount(0);
    await expect(fresh.locator("button", { hasText: "Add a photo" })).toHaveCount(0);
    await expect(tiles(fresh)).toHaveCount(10);
    await noSidewaysScroll(fresh);
    expect(await smallOnes(fresh)).toEqual([]);
    await fresh.close();
  });

  test("the photo audit rows carry ids and booleans, never a caption, a filename or a hash", async () => {
    const audit = await photoAudit();
    const actions = new Set(audit.map((a) => a.action));
    for (const expected of [
      "tenant.oversight_photo.added",
      "tenant.oversight_photo.caption_set",
      "tenant.oversight_photo.cover_set",
      "tenant.oversight_photo.removed",
    ]) {
      expect(actions, expected).toContain(expected);
    }
    const text = JSON.stringify(audit);
    expect(text).not.toContain("SENTINEL");
    expect(text).not.toContain("WWWW");
    expect(text).not.toMatch(/Generated Colour|\.JPG|notes\.txt|sha256|content_hash/i);
    for (const row of audit) {
      for (const value of Object.values(row.metadata)) {
        expect(["string", "boolean"].includes(typeof value) || value === null, `${row.action} metadata is ids and booleans`).toBe(true);
      }
    }
  });
});
