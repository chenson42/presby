/**
 * oversight-records.spec.ts - the manage-only half of the congregation records (Congregation profile
 * Increment 1, Batch B4; docs/work-log/2026-11-17-congregation-profile-inc1.md, parent Phase 3 "E2E").
 *
 * WHO: a presbytery clerk who holds `congregation_oversight.manage` and nothing else (no tier-2 key, so no
 * second factor). A throwaway presbytery with two member congregations and a second presbytery with one,
 * all minted by `support/oversight-fixture.ts` and removed in the one order the foreign keys allow.
 * Flag: `org_portal.oversight`, set here and restored in afterAll (nothing goes into the CI baseline).
 *
 * COVERS, on a 360px phone: the profile (add, edit); buildings (add, both required-field messages, a duplicate
 * name, a primary that moves, edit, "No changes to save.", retire, bring back, remove); the Insurance and Loans
 * sections as visible "Locked" cards and the two finance form pages opened by URL (a Locked page, nothing
 * written); the list's columns for a manage-only viewer; the byte-identical 404 for a non-UUID, another
 * presbytery's congregation, another congregation's building and a removed building; audit rows that name
 * fields but never carry a value (sentinel text in every free-text field); a 120-character name that wraps
 * without sideways scroll; every control at least 44px tall; the back link with no `callbackUrl`.
 *
 * The cases share one signed-in context and one set of records, so they run in order (`describe.serial`).
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  mainText,
  newPhonePage,
  noSidewaysScroll,
  OVERSIGHT_FLAG,
  oversightAudit,
  removeOversightFixture,
  sectionStates,
  seedBuilding,
  setupOversightFixture,
  signedInContext,
  smallControls,
  waitHydrated,
  type OversightFixture,
} from "./support/oversight-fixture";

let sql: Sql;
let fx: OversightFixture;
let flags: FlagCapture;
let clerk: BrowserContext;
const base = () => `/o/${fx.presbytery.slug}/admin/oversight`;
const record = () => `${base()}/${fx.congA.id}`;

const SENTINEL_ADDRESS = "SENTINEL-ADDRESS-4417 Quarry Road";
const SENTINEL_NOTE = "SENTINEL-NOTE-7731 the narthex roof leaks";
const SENTINEL_NAME = "Sentinel Hall 9902";

async function buildingCount(whereName?: string): Promise<number> {
  const [row] = (await sql`
    select count(*)::int as n from oversight_buildings
     where organization_id = ${fx.presbytery.id}::uuid and about_org_id = ${fx.congA.id}::uuid and removed_at is null
       and (${whereName ?? null}::text is null or name = ${whereName ?? null})`) as { n: number }[];
  return row!.n;
}

async function primaryNames(): Promise<string[]> {
  const found = (await sql`
    select name from oversight_buildings
     where organization_id = ${fx.presbytery.id}::uuid and about_org_id = ${fx.congA.id}::uuid and removed_at is null and is_primary
     order by name`) as { name: string }[];
  return found.map((r) => r.name);
}

test.describe.serial("Oversight records: the manage-only clerk", () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    sql = platformSql("oversight-records.spec");
    flags = await captureFlags(sql, [OVERSIGHT_FLAG]);
    await setFlag(sql, OVERSIGHT_FLAG, true);
    fx = await setupOversightFixture(sql, { tag: "r", who: ["clerk", "both"] });
    clerk = await signedInContext(browser, "clerk", record());
  });

  test.afterAll(async () => {
    await clerk?.close();
    if (sql && fx) await removeOversightFixture(sql, fx);
    await flags?.restore();
  });

  test("the record page: five sections, the managed note, the back link, no callbackUrl", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(record());
    await expect(page.getByRole("heading", { level: 1, name: fx.congA.name })).toBeVisible();
    await expect(page.getByText(/This congregation is on PresbyPortal and can keep its own profile there/)).toBeVisible();
    expect(await sectionStates(page)).toEqual({ Profile: "open", Assessment: "open", Buildings: "open", Insurance: "locked", Loans: "locked" });
    await expect(page.getByText("Nothing is recorded in the profile yet.")).toBeVisible();
    await expect(page.getByText("No buildings are recorded for this congregation.")).toBeVisible();
    // The Locked cards name the permission and who can give it.
    await expect(page.getByRole("region", { name: "Insurance", exact: true })).toContainText(
      "You need permission to manage congregation property finances. An administrator can give it under Roles.",
    );

    // The unmanaged congregation carries no "on PresbyPortal" note.
    await page.goto(`${base()}/${fx.congB.id}`);
    await expect(page.getByRole("heading", { level: 1, name: fx.congB.name })).toBeVisible();
    await expect(page.getByText(/is on PresbyPortal and can keep its own profile/)).toHaveCount(0);

    // The way back is a plain link to the list; no `callbackUrl` or `next` is ever on an oversight URL.
    await page.goto(record());
    const back = page.getByRole("link", { name: "Back to oversight" });
    await expect(back).toHaveAttribute("href", base());
    await back.click();
    await expect(page.getByRole("heading", { level: 1, name: "Congregation Oversight" })).toBeVisible();
    expect(page.url()).not.toMatch(/callbackUrl|[?&]next=/);
    await page.close();
  });

  test("profile: add (returns to the record), then edit (stays); the audit row names fields, never the address", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(record());
    await page.getByRole("link", { name: "Add profile details" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Edit profile" })).toBeVisible();
    await waitHydrated(page);
    await page.locator("#profile-address").fill(SENTINEL_ADDRESS);
    await page.locator("#profile-city").fill("Aldermoor");
    await page.locator("#profile-county").fill("Reach County");
    await page.locator("#profile-year-organized").fill("1962");
    await page.locator("#profile-phone").fill("555-0142");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === record());
    await expect(page.getByRole("region", { name: "Profile", exact: true })).toContainText("Aldermoor");
    await expect(page.getByRole("region", { name: "Profile", exact: true })).toContainText("1962");

    // Edit stays on the page and says what happened.
    await page.getByRole("link", { name: "Edit profile" }).click();
    await waitHydrated(page);
    await expect(page.locator("#profile-city")).toHaveValue("Aldermoor");
    await page.locator("#profile-city").fill("Aldermoor Falls");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`${record()}/profile/edit`);
    // An edit that changes nothing writes nothing (reloaded first, so the form holds the saved version).
    await page.reload();
    await waitHydrated(page);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("No changes to save.")).toBeVisible();

    // A bad year is refused under its own field, the typed values are kept.
    await page.locator("#profile-year-organized").fill("1599");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#profile-year-organized-error")).toContainText("Year organized must be between 1600 and");
    await expect(page.locator("#profile-city")).toHaveValue("Aldermoor Falls");
    await noSidewaysScroll(page);
    await page.close();

    const [row] = (await sql`
      select city, year_organized, row_version, provenance from oversight_profiles
       where organization_id = ${fx.presbytery.id}::uuid and about_org_id = ${fx.congA.id}::uuid`) as { city: string; year_organized: number; row_version: number; provenance: string }[];
    expect(row).toMatchObject({ city: "Aldermoor Falls", year_organized: 1962, row_version: 2, provenance: "presbytery_entered" });
    const audit = (await oversightAudit(sql, fx.presbytery.id)).filter((a) => a.action === "tenant.oversight_profile.set");
    expect(audit.length).toBe(2);
    expect(JSON.stringify(audit)).not.toContain("SENTINEL");
    expect(JSON.stringify(audit)).not.toContain("Aldermoor");
    expect(JSON.stringify(audit)).not.toContain("555-0142");
  });

  test("buildings: both required-field messages, add, a duplicate name, a primary that moves", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(`${record()}/buildings/new`);
    await waitHydrated(page);
    await page.getByRole("button", { name: "Save building" }).click();
    await expect(page.locator("#building-name-error")).toHaveText("Enter a name for the building.");
    await expect(page.locator("#building-type-error")).toHaveText("Choose a type.");
    expect(await buildingCount()).toBe(0);

    await page.locator("#building-name").fill("Chapel");
    await page.locator("#building-type").selectOption("sanctuary");
    await page.locator("#building-primary").check();
    await page.locator("#building-year-built").fill("1931");
    await page.locator("#building-notes").fill(SENTINEL_NOTE);
    await page.getByRole("button", { name: "Save building" }).click();
    await expect(page.getByText("Building added.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === record());
    const chapel = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: "Chapel" }) });
    await expect(chapel.getByText("Primary", { exact: true })).toBeVisible();

    // The same name, in another case, is a duplicate: refused under Name with the typed values kept.
    await page.goto(`${record()}/buildings/new`);
    await waitHydrated(page);
    await page.locator("#building-name").fill("chapel");
    await page.locator("#building-type").selectOption("annex");
    await page.getByRole("button", { name: "Save building" }).click();
    await expect(page.locator("#building-name-error")).toHaveText("A building with that name is already recorded.");
    await expect(page.locator("#building-name")).toHaveValue("chapel");
    expect(await buildingCount()).toBe(1);

    // A second building marked primary takes the mark from the first.
    await page.locator("#building-name").fill("Fellowship Annex");
    await page.locator("#building-primary").check();
    await page.getByRole("button", { name: "Save building" }).click();
    await expect(page.getByText("Building added.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === record());
    expect(await primaryNames()).toEqual(["Fellowship Annex"]);
    await expect(
      page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: "Chapel" }) }).getByText("Primary", { exact: true }),
    ).toHaveCount(0);
    await page.close();

    // Both adds are audited, by building id, and the note text is nowhere in them.
    const audit = (await oversightAudit(sql, fx.presbytery.id)).filter((a) => a.action === "tenant.oversight_building.created");
    expect(audit.length).toBe(2);
    expect(JSON.stringify(audit)).not.toContain("SENTINEL");
    expect(JSON.stringify(audit)).not.toContain("Chapel");
  });

  test("buildings: edit, then an unchanged save; retire, bring back, remove", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(record());
    const chapel = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: "Chapel" }) });
    await chapel.getByRole("link", { name: /^Open/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Chapel" })).toBeVisible();
    const buildingUrl = page.url();

    await page.getByRole("link", { name: "Edit building" }).click();
    await waitHydrated(page);
    await expect(page.locator("#building-notes")).toHaveValue(SENTINEL_NOTE);
    await page.locator("#building-square-feet").fill("6400");
    await page.locator("#building-roof").selectOption("poor");
    await page.locator("#building-sprinklers").selectOption("no");
    await page.getByRole("button", { name: "Save building" }).click();
    await expect(page.getByText("Building saved.")).toBeVisible();
    // An unchanged save writes nothing (reloaded first, so the form holds the saved version).
    await page.reload();
    await waitHydrated(page);
    await page.getByRole("button", { name: "Save building" }).click();
    await expect(page.getByText("No changes to save.")).toBeVisible();

    // The edit form's addition-year ordering rule.
    await page.locator("#building-first-addition").fill("1900");
    await page.getByRole("button", { name: "Save building" }).click();
    await expect(page.locator("#building-first-addition-error")).toHaveText("The first addition can't be before the year built.");
    await page.goto(buildingUrl);
    await expect(page.getByText("6,400")).toBeVisible();

    // Retire: a reason is required, then the page says "Sold on {date}".
    await page.getByRole("button", { name: "Retire this building" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Retire building" }).click();
    await expect(dialog.getByText("Choose why this building is retired.")).toBeVisible();
    await dialog.locator("#retire-reason").selectOption("sold");
    await dialog.getByRole("button", { name: "Retire building" }).click();
    await expect(page.getByText("Building retired.")).toBeVisible();
    await expect(page.getByText(/^Sold on /)).toBeVisible();
    await expect(page.getByText("Retired", { exact: true }).first()).toBeVisible();

    // A retired building is not "in use": the list counts only the live, unretired ones
    // (the list's three states are asserted in the manage-only list test below).
    // Bring it back into use.
    await page.getByRole("button", { name: "Bring back into use" }).click();
    await expect(page.getByText("Building brought back into use.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retire this building" })).toBeVisible();

    // Remove (an AlertDialog, never a native confirm), then the page is gone.
    await page.getByRole("button", { name: "Remove (entered by mistake)" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Remove this building?");
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove building" }).click();
    await expect(page.getByText("Building removed.")).toBeVisible();
    await page.waitForURL((url) => url.pathname === record());
    await expect(page.getByRole("heading", { level: 3, name: "Chapel" })).toHaveCount(0);
    expect(await buildingCount("Chapel")).toBe(0);
    const [gone] = (await sql`
      select removed_at is not null as removed, retired_on is null as live_again from oversight_buildings
       where organization_id = ${fx.presbytery.id}::uuid and name = 'Chapel'`) as { removed: boolean; live_again: boolean }[];
    expect(gone).toEqual({ removed: true, live_again: true });
    await page.close();

    const actions = (await oversightAudit(sql, fx.presbytery.id)).map((a) => a.action);
    for (const expected of ["tenant.oversight_building.updated", "tenant.oversight_building.retired", "tenant.oversight_building.removed"]) {
      expect(actions, expected).toContain(expected);
    }
    expect(JSON.stringify(await oversightAudit(sql, fx.presbytery.id))).not.toContain("SENTINEL");
  });

  test("the removed building's page, another congregation's building, another presbytery's congregation and a non-UUID are the same 404", async () => {
    const removed = (await sql`select id from oversight_buildings where organization_id = ${fx.presbytery.id}::uuid and name = 'Chapel'`) as { id: string }[];
    const foreignBuilding = await seedBuilding(sql, fx, "congB", { name: "Birch Hall" });
    const page = await newPhonePage(clerk);

    const probe = async (path: string) => {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      return await mainText(page);
    };
    const absent = await probe(`${record()}/buildings/00000000-0000-4089-8000-0000000000ff`);
    expect(absent).not.toBe("");
    expect(await probe(`${record()}/buildings/${removed[0]!.id}`), "a removed building").toBe(absent);
    expect(await probe(`${record()}/buildings/${foreignBuilding}`), "another congregation's building").toBe(absent);
    expect(await probe(`${record()}/buildings/not-a-uuid`), "a non-UUID building").toBe(absent);
    expect(await probe(`${base()}/not-a-uuid`), "a non-UUID congregation").toBe(absent);
    expect(await probe(`${base()}/${fx.congO.id}`), "another presbytery's congregation").toBe(absent);
    expect(await probe(`${base()}/${fx.congO.id}/buildings/new`), "a form for another presbytery's congregation").toBe(absent);
    expect(await probe(`${base()}/00000000-0000-4089-8000-0000000000fe`), "a congregation that does not exist").toBe(absent);
    await page.close();
  });

  test("Insurance and Loans are Locked cards; their form pages opened by URL are a Locked page with no form, and nothing is written", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(record());
    await expect(page.getByRole("region", { name: "Insurance", exact: true }).getByText("Locked", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Loans", exact: true }).getByText("Locked", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Record a year" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Record a loan" })).toHaveCount(0);

    for (const [path, title] of [
      [`${record()}/insurance/new`, "Record insurance for a year"],
      [`${record()}/loans/new`, "Record a loan"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.getByText("Locked", { exact: true })).toBeVisible();
      await expect(page.getByText("You need permission to manage congregation property finances.")).toBeVisible();
      await expect(page.locator("form")).toHaveCount(0);
      await expect(page.getByRole("link", { name: `Back to ${fx.congA.name}` })).toHaveAttribute("href", record());
    }
    await page.close();

    const [counts] = (await sql`
      select (select count(*)::int from oversight_insurance_years where organization_id = ${fx.presbytery.id}::uuid) as insurance,
             (select count(*)::int from oversight_loans where organization_id = ${fx.presbytery.id}::uuid) as loans`) as { insurance: number; loans: number }[];
    expect(counts).toEqual({ insurance: 0, loans: 0 });
  });

  test("the list for a manage-only viewer: the manage columns, no Insurance column, one note about the missing key", async () => {
    await seedBuilding(sql, fx, "congA", { name: "Hall Of Records", primary: false });
    const page = await newPhonePage(clerk);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(base());
    await expect(page.getByRole("heading", { level: 1, name: "Congregation Oversight" })).toBeVisible();
    for (const name of ["Congregation", "Viability", "City and county", "Buildings in use", "Assessment updated"]) {
      await expect(page.getByRole("columnheader", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("columnheader", { name: "Insurance expires" })).toHaveCount(0);
    await expect(
      page.getByText("Insurance needs permission to manage congregation property finances. An administrator can give it under Roles."),
    ).toBeVisible();
    const alder = page.locator("tr", { hasText: fx.congA.name });
    // Two live buildings (Fellowship Annex, Hall Of Records): the removed Chapel is not counted.
    await expect(alder.getByRole("cell", { name: "2 buildings" })).toBeVisible();
    await expect(alder.getByRole("cell", { name: "Aldermoor Falls, Reach County" })).toBeVisible();
    const birch = page.locator("tr", { hasText: fx.congB.name });
    // One live building ("Birch Hall", seeded by the 404 test above), so the count wording.
    await expect(birch.getByRole("cell", { name: "1 building", exact: true })).toBeVisible();
    // Three states (QA run 1 item 4): once every recorded building is retired the cell says
    // "None in use", never "Not recorded" (the record page still lists it with its "Retired" badge).
    await sql`update oversight_buildings set retired_on = current_date, retired_reason = 'sold'
               where organization_id = ${fx.presbytery.id}::uuid and about_org_id = ${fx.congB.id}::uuid and removed_at is null`;
    await page.reload();
    await expect(
      page.locator("tr", { hasText: fx.congB.name }).getByRole("cell", { name: "None in use", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: fx.congO.name })).toHaveCount(0);
    await alder.getByRole("link", { name: /^Open/ }).click();
    await page.waitForURL((url) => url.pathname === record());
    await page.close();
  });

  test("360px: a 120-character building name wraps with no sideways scroll on every page that shows it, and every control is 44px — regression for the back link that named it and could not wrap", async () => {
    const long = "M".repeat(120);
    const id = await seedBuilding(sql, fx, "congA", { name: long, type: "gymnasium", primary: false, notes: "N".repeat(300) });
    const page = await newPhonePage(clerk, 360, 740);
    const pages: Array<[string, string]> = [
      ["the record page", record()],
      ["the building page", `${record()}/buildings/${id}`],
      ["the edit form", `${record()}/buildings/${id}/edit`],
      ["the new-building form", `${record()}/buildings/new`],
      ["the profile form", `${record()}/profile/edit`],
      ["the list", base()],
      ["the assessment form", `${record()}/assessment/edit`],
    ];
    for (const [label, path] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await waitHydrated(page).catch(() => undefined);
      await noSidewaysScroll(page);
      expect(await smallControls(page), `${label}: a control under 44px`).toEqual([]);
    }
    // The name is shown whole on the building page (wrapped, not clipped).
    await page.goto(`${record()}/buildings/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(long);
    // And the form refuses a 121st character with its own message, keeping the text.
    await page.goto(`${record()}/buildings/new`);
    await waitHydrated(page);
    await page.locator("#building-name").fill(`${long}M`);
    await page.locator("#building-type").selectOption("other");
    await page.getByRole("button", { name: "Save building" }).click();
    await expect(page.locator("#building-name-error")).toHaveText("Name must be 120 characters or fewer.");
    await page.close();
  });

  test("a sentinel in every free-text field reaches no audit row", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(`${record()}/buildings/new`);
    await waitHydrated(page);
    await page.locator("#building-name").fill(SENTINEL_NAME);
    await page.locator("#building-type").selectOption("office");
    await page.locator("#building-notes").fill(SENTINEL_NOTE);
    await page.getByRole("button", { name: "Save building" }).click();
    await expect(page.getByText("Building added.")).toBeVisible();
    await page.close();
    const audit = await oversightAudit(sql, fx.presbytery.id);
    expect(audit.length).toBeGreaterThan(5);
    const text = JSON.stringify(audit);
    for (const sentinel of ["SENTINEL", SENTINEL_NAME, "Aldermoor", "555-0142", "MMMMMMMM"]) expect(text, sentinel).not.toContain(sentinel);
    // Every row names the presbytery and the congregation by id and is attributed to an actor.
    for (const row of audit) {
      expect(row.metadata.organizationId).toBe(fx.presbytery.id);
      expect(row.metadata.aboutOrgId).toBe(fx.congA.id);
      expect(row.resource_id).toBeTruthy();
    }
  });
});
