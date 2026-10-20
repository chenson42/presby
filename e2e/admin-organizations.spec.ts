/**
 * admin-organizations.spec.ts — S18's minimal `(admin)` operator brand
 * surface (P0.5 slice c, commit `c3`), plus (Tests 5/6) the Profile and
 * Service-times/office-hours sections added by
 * docs/work-log/2026-08-21-public-site-org-profile.md, closing qa's Phase 5
 * gap ("no e2e coverage for the two new admin sections").
 *
 * Uses the "alpha" e2e fixture organization (Wrenfield Presbyterian Church,
 * e2e00000-0000-0000-0000-000000000002 — see e2e/support/seed-orgs.ts) rather
 * than a scripts/seed-dev.sql fixture, so this spec cannot collide with the
 * unrelated post-login-routing specs that also read that org: it only ever
 * touches `organization_brands`, `organization_profiles`, and
 * `organization_service_times` — tables those specs never read. Every CRUD
 * smoke test in this file sets data and then clears it back out in the same
 * test, so the fixture is back to its starting state for whichever spec runs
 * next — same discipline as whats-new.spec.ts's create-then-verify pattern.
 *
 * Tests 5/6 verify DB state directly (via `@neondatabase/serverless`'s
 * `neon()` against the RLS-bypassing platform connection, the same mechanism
 * `e2e/public-sites.spec.ts` and `e2e/support/seed-orgs.ts` already use), not
 * just the UI's own re-render — because `organization_profiles` and
 * `organization_brands` behave differently on "clear": brand's own
 * "neutralise" action DELETEs its row (Test 4 restores true zero rows
 * through the UI alone), but `setOrganizationProfile` is upsert-only and
 * never DELETEs (confirmed by reading `src/lib/sites.ts` before writing Test
 * 5) — an emptied profile form still leaves a row with every field `null`,
 * so Test 5 restores the pre-test zero-row state with one direct SQL DELETE
 * after asserting that real product behavior, rather than assuming the UI
 * alone can get back there. `organization_service_times`' own
 * `replaceOrganizationServiceTimes` genuinely DELETEs on an empty-list save
 * (DECISION-092), so Test 6 needs no equivalent direct-SQL cleanup step.
 */

import { neon } from "@neondatabase/serverless";
import { test, expect } from "@playwright/test";
import { storageStatePath } from "./support/users";

type Sql = ReturnType<typeof neon<false, false>>;

const ALPHA_ORG_ID = "e2e00000-0000-0000-0000-000000000002";
const ALPHA_ORG_NAME = "Wrenfield Presbyterian Church";

/**
 * The RLS-bypassing owner connection, same mechanism
 * `e2e/public-sites.spec.ts` and `e2e/support/seed-orgs.ts` already use for
 * direct-query fixture verification — `DATABASE_URL` connects as
 * `presby_app`, which sees zero rows in a tenant table with no org GUC set.
 */
function platformSql(): Sql {
  const platformDbUrl =
    process.env.E2E_PLATFORM_DATABASE_URL ?? process.env.PLATFORM_DATABASE_URL ?? "";
  if (!platformDbUrl) {
    throw new Error(
      "[admin-organizations.spec] No platform database URL. Set " +
        "PLATFORM_DATABASE_URL (or E2E_PLATFORM_DATABASE_URL) in .env.local " +
        "— these tests confirm organization_profiles/organization_service_times " +
        "state directly, not just through the UI's own re-render.",
    );
  }
  return neon(platformDbUrl);
}

// ---------------------------------------------------------------------------
// Test 1 — Member denied /admin/organizations (Edge proxy bounce)
// ---------------------------------------------------------------------------

test.describe("Member — /admin/organizations blocked by proxy", () => {
  test.use({ storageState: storageStatePath("member") });

  test("member navigating to /admin/organizations is redirected to /access-pending", async ({
    page,
  }) => {
    await page.goto("/admin/organizations");
    await expect(page).toHaveURL(/\/access-pending/, { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Admin reaches the list, nav link present, OQ4 filter toggles
// ---------------------------------------------------------------------------

test.describe("Admin — /admin/organizations list", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin reaches the organizations list and sees the heading", async ({
    page,
  }) => {
    const response = await page.goto("/admin/organizations");
    expect(response?.status(), "/admin/organizations should respond 2xx").toBeLessThan(400);
    await expect(
      page.getByRole("heading", { name: "Organizations" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Organizations nav link is present in the admin sidebar", async ({
    page,
  }) => {
    await page.goto("/admin/organizations");
    await expect(
      page.getByRole("link", { name: "Organizations" }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("OQ4 report: the 'Still on default palette' filter narrows the same list, not a second page", async ({
    page,
  }) => {
    await page.goto("/admin/organizations");
    await expect(page.getByText(ALPHA_ORG_NAME)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("link", { name: /still on default palette/i }).click();
    await expect(page).toHaveURL(/\/admin\/organizations\?filter=unbranded/);
    // Still on the SAME route (a filter, not a new page) and the never-branded
    // fixture is still present under the filter.
    await expect(page.getByText(ALPHA_ORG_NAME)).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Detail page: default-palette state, notFound on a bad id
// ---------------------------------------------------------------------------

test.describe("Admin — /admin/organizations/[id] detail", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("detail page shows the platform-default note for a never-branded org", async ({
    page,
  }) => {
    await page.goto(`/admin/organizations/${ALPHA_ORG_ID}`);
    await expect(
      page.getByRole("heading", { name: ALPHA_ORG_NAME }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/platform default palette/i),
    ).toBeVisible();
    // No neutralise button when there is nothing to neutralise (G10's "show
    // the default as it actually renders," not a disabled danger button).
    await expect(
      page.getByRole("button", { name: /neutralise brand/i }),
    ).toHaveCount(0);
  });

  test("a well-formed but nonexistent organization id 404s", async ({ page }) => {
    const response = await page.goto(
      "/admin/organizations/00000000-0000-0000-0000-000000000000",
    );
    expect(response?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — CRUD smoke: set a brand, confirm it saved, neutralise it back
// ---------------------------------------------------------------------------

test.describe("Admin — set and neutralise a brand (leaves the fixture as found)", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin sets a brand colour, sees it save, then neutralises it back to default", async ({
    page,
  }) => {
    await page.goto(`/admin/organizations/${ALPHA_ORG_ID}`);

    const hexInput = page.locator("#seedHex");
    await hexInput.fill("#2f6f4f");

    // Flow 3 / D11: this seed produces no adjustments — the "Before you
    // save" box must stay absent for an ordinary colour.
    await expect(page.getByText(/before you save/i)).toHaveCount(0);

    await page.getByRole("button", { name: /save brand/i }).click();
    // getByRole("status"): the inline banner (E-c1/E-c2 — this must persist,
    // unlike the toast, which also fires and renders the same text).
    await expect(page.getByRole("status")).toHaveText("Brand saved.", {
      timeout: 15_000,
    });

    // The now-current-brand section reflects the save (server data
    // revalidated), and the organization drops out of the OQ4 filter.
    await expect(page.getByText(/platform default palette/i)).toHaveCount(0);

    await page.goto("/admin/organizations?filter=unbranded");
    await expect(page.getByText(ALPHA_ORG_NAME)).toHaveCount(0);

    // Neutralise it back — A2: the confirmation names the organization.
    await page.goto(`/admin/organizations/${ALPHA_ORG_ID}`);
    await page.getByRole("button", { name: /neutralise brand/i }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(ALPHA_ORG_NAME);

    await page
      .getByRole("button", { name: new RegExp(`yes, neutralise ${ALPHA_ORG_NAME}`, "i") })
      .click();

    // The confirm button closes the dialog immediately (Radix's own
    // behaviour), but the server action it kicked off is still in flight —
    // wait for its toast before navigating, or the next goto() can race
    // ahead of the actual DB write.
    await expect(
      page.getByText(`${ALPHA_ORG_NAME}'s brand has been neutralised.`),
    ).toBeVisible({ timeout: 15_000 });

    await page.goto(`/admin/organizations/${ALPHA_ORG_ID}`);
    await expect(page.getByText(/platform default palette/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Test 5 — CRUD smoke: the Profile section (address/phone/social links)
// docs/work-log/2026-08-21-public-site-org-profile.md, Phase 5 gap closure.
// Same fixture, same discipline as Test 4: fill -> save -> confirm persisted
// across a reload -> clear back to empty -> confirm restored, verified by
// direct query against organization_profiles rather than assumed from the
// UI's own re-render.
// ---------------------------------------------------------------------------

test.describe("Admin — set and clear organization profile (leaves the fixture as found)", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin sets address/phone/a social link, sees them persist across a reload, then clears them back to empty", async ({
    page,
  }) => {
    const sql = platformSql();

    // Baseline confirmed by direct query, not assumed — this fixture carries
    // no organization_profiles row until this test writes one.
    const before = (await sql`
      select 1 from organization_profiles where organization_id = ${ALPHA_ORG_ID}::uuid
    `) as unknown[];
    expect(
      before,
      "organization_profiles should start with no row for this fixture",
    ).toHaveLength(0);

    await page.goto(`/admin/organizations/${ALPHA_ORG_ID}`);

    await page.locator("#address").fill("100 Fixture Lane, Anytown, ST 00000");
    await page.locator("#phone").fill("(555) 555-0142");
    await page
      .locator("#facebookUrl")
      .fill("https://facebook.com/e2e-fixture-only");

    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Profile saved." }),
    ).toBeVisible({ timeout: 15_000 });

    // Persisted across a reload — re-fetched from the DB via the server
    // component, not client state surviving in memory.
    await page.goto(`/admin/organizations/${ALPHA_ORG_ID}`);
    await expect(page.locator("#address")).toHaveValue(
      "100 Fixture Lane, Anytown, ST 00000",
    );
    await expect(page.locator("#phone")).toHaveValue("(555) 555-0142");
    await expect(page.locator("#facebookUrl")).toHaveValue(
      "https://facebook.com/e2e-fixture-only",
    );

    // Direct DB confirmation of the same write.
    type ProfileRow = {
      address: string | null;
      phone: string | null;
      facebook_url: string | null;
      instagram_url: string | null;
      x_twitter_url: string | null;
      youtube_url: string | null;
      other_url: string | null;
    };
    const afterSave = (await sql`
      select address, phone, facebook_url, instagram_url, x_twitter_url,
             youtube_url, other_url
        from organization_profiles
       where organization_id = ${ALPHA_ORG_ID}::uuid
    `) as ProfileRow[];
    expect(afterSave).toHaveLength(1);
    expect(afterSave[0].address).toBe("100 Fixture Lane, Anytown, ST 00000");
    expect(afterSave[0].phone).toBe("(555) 555-0142");
    expect(afterSave[0].facebook_url).toBe(
      "https://facebook.com/e2e-fixture-only",
    );
    expect(afterSave[0].instagram_url).toBeNull();

    // Clear every field back to empty.
    await page.locator("#address").fill("");
    await page.locator("#phone").fill("");
    await page.locator("#facebookUrl").fill("");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Profile saved." }),
    ).toBeVisible({ timeout: 15_000 });

    // setOrganizationProfile (src/lib/sites.ts) is upsert-only — read before
    // writing this assertion, not assumed: an empty submit still
    // `onConflictDoUpdate`s the degenerate-PK row, it never DELETEs it. The
    // "empty" contract on this table is therefore a row with every field
    // null, not an absent row.
    const afterClear = (await sql`
      select address, phone, facebook_url, instagram_url, x_twitter_url,
             youtube_url, other_url
        from organization_profiles
       where organization_id = ${ALPHA_ORG_ID}::uuid
    `) as ProfileRow[];
    expect(afterClear).toHaveLength(1);
    expect(afterClear[0].address).toBeNull();
    expect(afterClear[0].phone).toBeNull();
    expect(afterClear[0].facebook_url).toBeNull();
    expect(afterClear[0].instagram_url).toBeNull();
    expect(afterClear[0].x_twitter_url).toBeNull();
    expect(afterClear[0].youtube_url).toBeNull();
    expect(afterClear[0].other_url).toBeNull();

    // Unlike organization_brands' "neutralise" (which DELETEs its row), this
    // feature ships no UI path back to zero rows for organization_profiles —
    // restore the pre-test state directly, matching every other e2e spec's
    // "leaves the fixture as found" discipline for a table the app itself
    // cannot fully clear.
    await sql`delete from organization_profiles where organization_id = ${ALPHA_ORG_ID}::uuid`;
    const restored = (await sql`
      select 1 from organization_profiles where organization_id = ${ALPHA_ORG_ID}::uuid
    `) as unknown[];
    expect(restored).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — CRUD smoke: Service times & office hours (two independent kinds)
// docs/work-log/2026-08-21-public-site-org-profile.md, Phase 5 gap closure.
// ---------------------------------------------------------------------------

test.describe("Admin — set and clear service times & office hours (leaves the fixture as found)", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin adds a service time and an office-hours entry, sees them persist independently across a reload, then clears both back to empty", async ({
    page,
  }) => {
    const sql = platformSql();

    const before = (await sql`
      select 1 from organization_service_times where organization_id = ${ALPHA_ORG_ID}::uuid
    `) as unknown[];
    expect(
      before,
      "organization_service_times should start with no rows for this fixture",
    ).toHaveLength(0);

    await page.goto(`/admin/organizations/${ALPHA_ORG_ID}`);

    // Scoped to each TimeRowsEditor instance via its own Save button — the
    // two kinds render as independent editors on the same page (DECISION-092,
    // "two saves, not one"), and both use identical Day/Start/End/Label
    // labels, so an unscoped getByLabel would be ambiguous.
    const serviceEditor = page
      .locator("div.space-y-4")
      .filter({ has: page.getByRole("button", { name: "Save service times" }) });
    const officeHoursEditor = page
      .locator("div.space-y-4")
      .filter({ has: page.getByRole("button", { name: "Save office hours" }) });

    // Both kinds start empty (Phase 1's empty-state contract).
    await expect(
      serviceEditor.getByText("No rows yet — add one below."),
    ).toBeVisible();
    await expect(
      officeHoursEditor.getByText("No rows yet — add one below."),
    ).toBeVisible();

    // Service times: one Sunday row.
    await serviceEditor.getByRole("button", { name: "Add row" }).click();
    await serviceEditor.getByLabel("Day").selectOption("0"); // Sunday
    await serviceEditor.getByLabel("Start").fill("09:00");
    await serviceEditor.getByLabel("End").fill("10:00");
    await serviceEditor.getByLabel("Label (optional)").fill("Traditional");
    await serviceEditor
      .getByRole("button", { name: "Save service times" })
      .click();
    await expect(
      serviceEditor
        .getByRole("status")
        .filter({ hasText: "Service times saved." }),
    ).toBeVisible({ timeout: 15_000 });

    // Office hours: one Monday row, added and saved independently.
    await officeHoursEditor.getByRole("button", { name: "Add row" }).click();
    await officeHoursEditor.getByLabel("Day").selectOption("1"); // Monday
    await officeHoursEditor.getByLabel("Start").fill("09:00");
    await officeHoursEditor.getByLabel("End").fill("17:00");
    await officeHoursEditor.getByLabel("Label (optional)").fill("Front office");
    await officeHoursEditor
      .getByRole("button", { name: "Save office hours" })
      .click();
    await expect(
      officeHoursEditor
        .getByRole("status")
        .filter({ hasText: "Office hours saved." }),
    ).toBeVisible({ timeout: 15_000 });

    // Persisted across a reload, and the two kinds render independently of
    // each other (adding office hours did not touch the service-times row).
    await page.goto(`/admin/organizations/${ALPHA_ORG_ID}`);
    const serviceEditorAfterReload = page
      .locator("div.space-y-4")
      .filter({ has: page.getByRole("button", { name: "Save service times" }) });
    const officeHoursEditorAfterReload = page
      .locator("div.space-y-4")
      .filter({ has: page.getByRole("button", { name: "Save office hours" }) });

    await expect(serviceEditorAfterReload.getByLabel("Day")).toHaveValue("0");
    await expect(serviceEditorAfterReload.getByLabel("Start")).toHaveValue(
      "09:00",
    );
    await expect(serviceEditorAfterReload.getByLabel("End")).toHaveValue(
      "10:00",
    );
    await expect(
      serviceEditorAfterReload.getByLabel("Label (optional)"),
    ).toHaveValue("Traditional");

    await expect(officeHoursEditorAfterReload.getByLabel("Day")).toHaveValue(
      "1",
    );
    await expect(officeHoursEditorAfterReload.getByLabel("Start")).toHaveValue(
      "09:00",
    );
    await expect(officeHoursEditorAfterReload.getByLabel("End")).toHaveValue(
      "17:00",
    );
    await expect(
      officeHoursEditorAfterReload.getByLabel("Label (optional)"),
    ).toHaveValue("Front office");

    // Direct DB confirmation — both kinds present, independent of each
    // other, at the exact values entered.
    type ServiceTimeRow = {
      kind: string;
      day_of_week: number;
      start_time: string;
      end_time: string;
      label: string | null;
    };
    const afterSave = (await sql`
      select kind, day_of_week, start_time, end_time, label
        from organization_service_times
       where organization_id = ${ALPHA_ORG_ID}::uuid
       order by kind
    `) as ServiceTimeRow[];
    expect(afterSave).toHaveLength(2);
    const service = afterSave.find((r) => r.kind === "service");
    const officeHours = afterSave.find((r) => r.kind === "office_hours");
    expect(service?.day_of_week).toBe(0);
    expect(service?.start_time.slice(0, 5)).toBe("09:00");
    expect(service?.end_time.slice(0, 5)).toBe("10:00");
    expect(service?.label).toBe("Traditional");
    expect(officeHours?.day_of_week).toBe(1);
    expect(officeHours?.start_time.slice(0, 5)).toBe("09:00");
    expect(officeHours?.end_time.slice(0, 5)).toBe("17:00");
    expect(officeHours?.label).toBe("Front office");

    // Clear both kinds back to empty — a legal "clear all" for each, per
    // Phase 3 Edge Cases (no confirmation step).
    await serviceEditorAfterReload
      .getByRole("button", { name: "Remove" })
      .click();
    await serviceEditorAfterReload
      .getByRole("button", { name: "Save service times" })
      .click();
    await expect(
      serviceEditorAfterReload
        .getByRole("status")
        .filter({ hasText: "Service times saved." }),
    ).toBeVisible({ timeout: 15_000 });

    await officeHoursEditorAfterReload
      .getByRole("button", { name: "Remove" })
      .click();
    await officeHoursEditorAfterReload
      .getByRole("button", { name: "Save office hours" })
      .click();
    await expect(
      officeHoursEditorAfterReload
        .getByRole("status")
        .filter({ hasText: "Office hours saved." }),
    ).toBeVisible({ timeout: 15_000 });

    // Unlike organization_profiles, replaceOrganizationServiceTimes's own
    // delete-then-insert on an empty list genuinely leaves zero rows — no
    // extra cleanup query needed to restore the pre-test state.
    const restored = (await sql`
      select 1 from organization_service_times where organization_id = ${ALPHA_ORG_ID}::uuid
    `) as unknown[];
    expect(restored).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — Treasurer designation (online giving, Batch 1b)
// docs/work-log/2026-10-15-online-giving.md, Phase 2 R2 / Phase 3 "Designation".
//
// The section renders only for a congregation / new worshiping community:
//   - alpha (a congregation with NO giving.manage holder) shows the control;
//   - the presbytery shows no section at all;
//   - once a treasurer is designated the control disappears and the section
//     shows a COUNT, never a name or an email.
//
// The designee is the existing `org-single` fixture person (Marguerite
// Ashcombe, an active member of alpha). Holding giving.manage flips her
// sign-in 2FA requirement (arm B of presby_two_factor_required), so every row
// this test creates — the role grant, the org-owned `treasurer` and
// `giving_recorder` roles and their bindings — is removed again in `afterAll`
// (and defensively in `beforeAll`, repairing a crashed prior run), and nothing
// else in the suite signs in as org-single while it is in place (workers: 1).
// ---------------------------------------------------------------------------

import { E2E_ORGS } from "./support/seed-orgs";
import { E2E_USERS } from "./support/users";

const TREASURER_ORG = E2E_ORGS.alpha;
const DESIGNEE = E2E_USERS["org-single"];
const DESIGNEE_PERSON_ID = "e2e00000-0000-0000-0000-0000000000a1";

async function removeGivingDesignation(sql: Sql) {
  // Grants first (the role FK would cascade, but being explicit documents it),
  // then the org-owned roles. `where key in (...)` and the org id are the only
  // rows this can touch; alpha has no such roles before the test (asserted).
  await sql`
    delete from role_grants
     where organization_id = ${TREASURER_ORG.id}::uuid
       and role_id in (select id from app_roles
                        where organization_id = ${TREASURER_ORG.id}::uuid
                          and key in ('treasurer', 'giving_recorder'))
  `;
  await sql`
    delete from app_roles
     where organization_id = ${TREASURER_ORG.id}::uuid
       and key in ('treasurer', 'giving_recorder')
  `;
}

test.describe("Admin — treasurer designation (online giving)", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const sql = platformSql();
    await removeGivingDesignation(sql);
    const holders = (await sql`
      select 1
        from role_grants rg
        join app_role_permissions arp on arp.role_id = rg.role_id
       where rg.organization_id = ${TREASURER_ORG.id}::uuid
         and arp.permission_key = 'giving.manage'
         and rg.starts_on <= current_date
         and (rg.ends_on is null or rg.ends_on > current_date)
    `) as unknown[];
    expect(
      holders,
      "the alpha fixture must start with no giving.manage holder for the designation control to render",
    ).toHaveLength(0);
  });

  test.afterAll(async () => {
    await removeGivingDesignation(platformSql());
  });

  test("a congregation with no giving.manage holder shows the treasurer control, disabled until the email looks valid", async ({
    page,
  }) => {
    await page.goto(`/admin/organizations/${TREASURER_ORG.id}`);
    const section = page.getByTestId("treasurer-designation-section");
    await expect(section).toBeVisible({ timeout: 10_000 });
    await expect(section.getByRole("heading", { name: "Treasurer" })).toBeVisible();

    const email = section.getByLabel(/treasurer.s email address/i);
    const trigger = section.getByRole("button", { name: "Designate treasurer" });
    // HydrationGate keeps the fieldset disabled until the page has hydrated;
    // wait for it before typing, exactly as a user would.
    await expect(email).toBeEnabled({ timeout: 15_000 });
    await expect(trigger).toBeDisabled();
    await email.fill("not-an-email");
    await expect(trigger).toBeDisabled();
    await email.fill(DESIGNEE.email);
    await expect(trigger).toBeEnabled();
  });

  test("a presbytery shows no treasurer section at all", async ({ page }) => {
    await page.goto(`/admin/organizations/${E2E_ORGS.presbytery.id}`);
    await expect(
      page.getByRole("heading", { name: E2E_ORGS.presbytery.name }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("treasurer-designation-section")).toHaveCount(0);
    await expect(page.getByLabel(/treasurer.s email address/i)).toHaveCount(0);
  });

  test("an account that is not a member of the organization is refused in plain words, creates nothing, and leaves the control in place", async ({
    page,
  }) => {
    const sql = platformSql();
    const membershipsBefore = (await sql`
      select count(*)::int as n from memberships where organization_id = ${TREASURER_ORG.id}::uuid
    `) as { n: number }[];

    await page.goto(`/admin/organizations/${TREASURER_ORG.id}`);
    const section = page.getByTestId("treasurer-designation-section");
    const email = section.getByLabel(/treasurer.s email address/i);
    await expect(email).toBeEnabled({ timeout: 15_000 });
    // The platform admin fixture has an account and no person at alpha.
    await email.fill(E2E_USERS.admin.email);
    await section.getByRole("button", { name: "Designate treasurer" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Yes, designate" }).click();

    await expect(section.getByRole("status")).toContainText(/not a member of this organization/i, {
      timeout: 15_000,
    });
    await expect(section.getByRole("button", { name: "Designate treasurer" })).toBeVisible();

    const membershipsAfter = (await sql`
      select count(*)::int as n from memberships where organization_id = ${TREASURER_ORG.id}::uuid
    `) as { n: number }[];
    expect(membershipsAfter[0].n).toBe(membershipsBefore[0].n);
    const roles = (await sql`
      select 1 from app_roles
       where organization_id = ${TREASURER_ORG.id}::uuid and key in ('treasurer', 'giving_recorder')
    `) as unknown[];
    expect(roles, "a refused designation writes nothing").toHaveLength(0);
  });

  test("designating a member makes the control disappear; the section then shows a count, never a name, and the audit row carries ids only", async ({
    page,
  }) => {
    const sql = platformSql();
    type Counts = { people: number; memberships: number };
    const countRows = async (): Promise<Counts> => {
      const [row] = (await sql`
        select (select count(*) from people)::int as people,
               (select count(*) from memberships)::int as memberships
      `) as Counts[];
      return row;
    };
    const before = await countRows();

    await page.goto(`/admin/organizations/${TREASURER_ORG.id}`);
    const section = page.getByTestId("treasurer-designation-section");
    const email = section.getByLabel(/treasurer.s email address/i);
    await expect(email).toBeEnabled({ timeout: 15_000 });
    await email.fill(DESIGNEE.email);
    await section.getByRole("button", { name: "Designate treasurer" }).click();

    // The confirm is an AlertDialog (no native dialog), and it names the
    // account and the organization before anything is written.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(DESIGNEE.email);
    await expect(dialog).toContainText(TREASURER_ORG.name);
    await dialog.getByRole("button", { name: "Yes, designate" }).click();

    // The server action revalidates the page: the control is gone and the
    // collapsed line appears. A count, not a name.
    await expect(section.getByText(/already has one person who can manage giving/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(section.getByLabel(/treasurer.s email address/i)).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Designate treasurer" })).toHaveCount(0);

    // And it stays that way on a fresh load. No name, no email anywhere in the section.
    await page.goto(`/admin/organizations/${TREASURER_ORG.id}`);
    const reloaded = page.getByTestId("treasurer-designation-section");
    await expect(reloaded.getByText(/already has one person who can manage giving/i)).toBeVisible({
      timeout: 10_000,
    });
    const text = (await reloaded.textContent()) ?? "";
    expect(text).not.toContain("Marguerite");
    expect(text).not.toContain("Ashcombe");
    expect(text).not.toContain(DESIGNEE.email);

    // Database truth: no person and no membership was created; the designee
    // holds one person-arm grant on the org-owned treasurer role; the
    // recorder role exists and is ungranted.
    expect(await countRows()).toEqual(before);
    const grants = (await sql`
      select r.key, rg.person_id::text as person_id, rg.group_id
        from role_grants rg join app_roles r on r.id = rg.role_id
       where rg.organization_id = ${TREASURER_ORG.id}::uuid
         and r.key in ('treasurer', 'giving_recorder')
    `) as { key: string; person_id: string | null; group_id: string | null }[];
    expect(grants).toEqual([{ key: "treasurer", person_id: DESIGNEE_PERSON_ID, group_id: null }]);
    const recorder = (await sql`
      select 1 from app_roles
       where organization_id = ${TREASURER_ORG.id}::uuid and key = 'giving_recorder'
    `) as unknown[];
    expect(recorder).toHaveLength(1);

    // The audit row: platform-axis action, the org as resource, ids only.
    type AuditRow = { metadata: Record<string, unknown>; actor_email: string | null };
    const audit = (await sql`
      select metadata, actor_email
        from audit_events
       where action = 'org.treasurer.designated'
         and resource_id = ${TREASURER_ORG.id}
       order by created_at desc
       limit 1
    `) as AuditRow[];
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({
      organizationId: TREASURER_ORG.id,
      personId: DESIGNEE_PERSON_ID,
      permissionKeys: ["giving.manage", "giving.record", "giving.view"],
    });
    expect(JSON.stringify(audit[0].metadata)).not.toContain(DESIGNEE.email);
    expect(audit[0].actor_email).toBe(E2E_USERS.admin.email);
  });
});

test.describe("Admin — treasurer designation at a 360 px phone viewport", () => {
  test.use({
    storageState: storageStatePath("admin"),
    viewport: { width: 360, height: 740 },
  });

  test("the section fits the viewport with a 44 px touch target and no horizontal scroll inside it", async ({
    page,
  }) => {
    // The previous describe's afterAll has removed the designation by now.
    await page.goto(`/admin/organizations/${TREASURER_ORG.id}`);
    const section = page.getByTestId("treasurer-designation-section");
    await expect(section).toBeVisible({ timeout: 10_000 });
    const email = section.getByLabel(/treasurer.s email address/i);
    await expect(email).toBeEnabled({ timeout: 15_000 });
    await email.fill(DESIGNEE.email);

    const box = await section.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360 + 1);
    const trigger = section.getByRole("button", { name: "Designate treasurer" });
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox!.height).toBeGreaterThanOrEqual(44);
    expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(360 + 1);

    // Nothing inside the section scrolls sideways.
    const overflows = await section.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflows).toBe(false);
  });
});
