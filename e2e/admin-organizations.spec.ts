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

  // ---- Review-polish Batch C: the council tree and its filters ----------
  const PRESBYTERY_NAME = "Presbytery of the Eastern Fells";

  test("tree: the presbytery row precedes its congregations, which sit deeper", async ({
    page,
  }) => {
    await page.goto("/admin/organizations");
    const pres = page.locator("tr", { hasText: PRESBYTERY_NAME }).first();
    const alpha = page.locator("tr", { hasText: ALPHA_ORG_NAME });
    await expect(alpha).toBeVisible({ timeout: 10_000 });
    const presDepth = Number(await pres.getAttribute("data-depth"));
    const alphaDepth = Number(await alpha.getAttribute("data-depth"));
    expect(alphaDepth).toBeGreaterThan(presDepth);
    const rows = await page.locator("tbody tr").evaluateAll((trs) =>
      trs.map((t) => t.textContent ?? ""),
    );
    const presIdx = rows.findIndex((t) => t.includes(PRESBYTERY_NAME));
    const alphaIdx = rows.findIndex((t) => t.includes(ALPHA_ORG_NAME));
    expect(presIdx).toBeGreaterThanOrEqual(0);
    expect(presIdx).toBeLessThan(alphaIdx);
  });

  test("filter by name: the match is emphasised, its presbytery is dimmed with no Manage link", async ({
    page,
  }) => {
    await page.goto("/admin/organizations?q=wrenfield");
    const alpha = page.locator("tr", { hasText: ALPHA_ORG_NAME });
    await expect(alpha).toHaveAttribute("data-match", "true", { timeout: 10_000 });
    await expect(alpha.getByRole("link", { name: /manage/i })).toBeVisible();
    const pres = page.locator("tr", { hasText: PRESBYTERY_NAME });
    await expect(pres).toHaveAttribute("data-match", "false");
    await expect(pres.getByRole("link", { name: /manage/i })).toHaveCount(0);
  });

  test("filter by type: congregations match, their presbytery stays as context", async ({
    page,
  }) => {
    await page.goto("/admin/organizations?type=congregation");
    await expect(page.locator("tr", { hasText: ALPHA_ORG_NAME })).toHaveAttribute(
      "data-match",
      "true",
      { timeout: 10_000 },
    );
    await expect(page.locator("tr", { hasText: PRESBYTERY_NAME })).toHaveAttribute(
      "data-match",
      "false",
    );
  });

  test("unknown type/status values are ignored: 200 and the unfiltered tree", async ({
    page,
  }) => {
    const response = await page.goto("/admin/organizations?type=bogus&status=nonsense");
    expect(response?.status()).toBe(200);
    await expect(page.locator("tr", { hasText: PRESBYTERY_NAME })).toHaveAttribute(
      "data-match",
      "true",
      { timeout: 10_000 },
    );
    await expect(page.getByText(/organizations match/)).toHaveCount(0);
  });

  test("the GET form round-trips into the URL and Clear filters resets it", async ({
    page,
  }) => {
    await page.goto("/admin/organizations");
    await page.getByLabel("Name").fill("wrenfield");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/q=wrenfield/, { timeout: 10_000 });
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/admin\/organizations$/);
  });

  test("nothing matching shows the empty state with a way out", async ({ page }) => {
    await page.goto("/admin/organizations?q=zzzz-no-such-church");
    await expect(page.getByText("Nothing matches these filters.")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("at 360px the name and Manage stay visible and the page does not scroll sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/admin/organizations?q=wrenfield");
    const alpha = page.locator("tr", { hasText: ALPHA_ORG_NAME });
    const manage = alpha.getByRole("link", { name: /manage/i });
    await manage.scrollIntoViewIfNeeded({ timeout: 10_000 });
    const box = await manage.boundingBox();
    expect(box).not.toBeNull();
    // Horizontally inside the 360px viewport (vertical position is irrelevant).
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
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
// Test 7 — Treasurer INVITATION (online giving, Batch 1b; rewritten for the
// account-invitation pipeline, docs/work-log/2026-10-21-invitations.md,
// Phase 3 "E2E blast radius").
//
// A platform designation is no longer an instant grant: the operator sends a
// single-use invitation to the address on file for a member of the congregation,
// and nobody holds the access until the invitee accepts (the acceptance paths are
// e2e/invitation-new-account.spec.ts and invitation-existing-account.spec.ts).
// So this block asserts what a SEND does and does not do:
//   - alpha-like congregation (no giving.manage holder) shows the control;
//   - the presbytery shows no section at all;
//   - an address nobody enrolled is refused in roster words, writes nothing;
//   - a send queues one `account_invitation` mail, writes `invitation.created`
//     (ids only), shows a pending row in place of the form, and grants NOTHING;
//   - Resend inside the 5-minute cooldown is refused in plain words; Revoke kills
//     the link and brings the form back.
//
// WHY A THROWAWAY CONGREGATION. Invitation rows cannot be deleted except by the
// cascade of their organization, and the durable per-inviter / per-address limits
// would fail repeated runs on the permanent alpha fixture. The treasurer is a
// roster person (a person, a `contact_methods` email and an active membership,
// F159) created for this block and removed with it. Nothing here touches alpha,
// so the old `removeGivingDesignation()` cleanup is gone with the instant grant.
// ---------------------------------------------------------------------------

import { E2E_ORGS } from "./support/seed-orgs";
import { E2E_USERS } from "./support/users";
import {
  addRosterPerson,
  auditRowsFor,
  INVITE_NAMES,
  inviteAddress,
  removeInviteOrg,
  rosterUserId,
  setupInviteOrg,
  type InviteOrg,
} from "./support/invitation-fixture";

/** Where a credential email's body goes once it is sent (`src/lib/email/credential-keys.ts`). */
const REDACTED_BODY_MARKER = "[Removed after delivery: this message contained a one-time sign-in link.]";

type QueueRow = { to_email: string; template_key: string; status: string; html_body: string; text_body: string | null };

async function queueRowFor(sql: Sql, invitationId: string): Promise<QueueRow> {
  const rows = (await sql`
    select q.to_email, q.template_key, q.status, q.html_body, q.text_body
      from account_invitations i join email_queue q on q.id = i.email_queue_id
     where i.id = ${invitationId}::uuid`) as QueueRow[];
  expect(rows, "the invitation is linked to exactly one queued mail").toHaveLength(1);
  return rows[0];
}

test.describe("Admin — treasurer invitation (online giving)", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);

  let org: InviteOrg;
  let treasurerEmail: string;
  let treasurerPersonId: string;

  test.beforeAll(async () => {
    const sql = platformSql();
    org = await setupInviteOrg(sql);
    treasurerEmail = inviteAddress(org, "treasurer");
    treasurerPersonId = await addRosterPerson(sql, org, {
      first: INVITE_NAMES.rosterFirst,
      last: INVITE_NAMES.rosterLast,
      email: treasurerEmail,
    });
    const holders = (await sql`
      select 1
        from role_grants rg
        join app_role_permissions arp on arp.role_id = rg.role_id
       where rg.organization_id = ${org.orgId}::uuid
         and arp.permission_key = 'giving.manage'
         and rg.starts_on <= current_date
         and (rg.ends_on is null or rg.ends_on > current_date)
    `) as unknown[];
    expect(
      holders,
      "the throwaway congregation must start with no giving.manage holder for the invitation control to render",
    ).toHaveLength(0);
  });

  test.afterAll(async () => {
    await removeInviteOrg(platformSql(), org);
  });

  test("a congregation with no giving.manage holder shows the treasurer control, disabled until the email looks valid", async ({
    page,
  }) => {
    await page.goto(`/admin/organizations/${org.orgId}`);
    const section = page.getByTestId("treasurer-designation-section");
    await expect(section).toBeVisible({ timeout: 10_000 });
    await expect(section.getByRole("heading", { name: "Treasurer" })).toBeVisible();

    const email = section.getByLabel(/treasurer.s email address/i);
    const trigger = section.getByRole("button", { name: "Send invitation" });
    // HydrationGate keeps the fieldset disabled until the page has hydrated;
    // wait for it before typing, exactly as a user would.
    await expect(email).toBeEnabled({ timeout: 15_000 });
    await expect(trigger).toBeDisabled();
    await email.fill("not-an-email");
    await expect(trigger).toBeDisabled();
    await email.fill(treasurerEmail);
    await expect(trigger).toBeEnabled();
    // No sentence anywhere tells the operator the person must "sign up first" (C5: there is no sign-up path).
    expect(((await section.textContent()) ?? "").toLowerCase()).not.toContain("sign up first");
  });

  test("a presbytery shows no treasurer section at all", async ({ page }) => {
    await page.goto(`/admin/organizations/${E2E_ORGS.presbytery.id}`);
    await expect(
      page.getByRole("heading", { name: E2E_ORGS.presbytery.name }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("treasurer-designation-section")).toHaveCount(0);
    await expect(page.getByLabel(/treasurer.s email address/i)).toHaveCount(0);
  });

  test("an address nobody enrolled here is refused in roster words, writes nothing, and leaves the control in place", async ({
    page,
  }) => {
    const sql = platformSql();
    const stranger = inviteAddress(org, "nobody");
    await page.goto(`/admin/organizations/${org.orgId}`);
    const section = page.getByTestId("treasurer-designation-section");
    const email = section.getByLabel(/treasurer.s email address/i);
    await expect(email).toBeEnabled({ timeout: 15_000 });
    await email.fill(stranger);
    await section.getByRole("button", { name: "Send invitation" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Yes, send invitation" }).click();

    // The refusal describes the roster, never whether the address has an account.
    const alert = section.getByRole("alert").filter({ hasText: /nobody enrolled at this congregation/i });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText("has that email on file");
    await expect(section.getByRole("button", { name: "Send invitation" })).toBeVisible();

    const counts = (await sql`
      select (select count(*)::int from account_invitations where organization_id = ${org.orgId}::uuid) as invitations,
             (select count(*)::int from email_queue where to_email = ${stranger}) as mail,
             (select count(*)::int from app_roles where organization_id = ${org.orgId}::uuid
                and key in ('treasurer', 'giving_recorder')) as roles`) as { invitations: number; mail: number; roles: number }[];
    expect(counts[0], "a refused invitation writes nothing").toEqual({ invitations: 0, mail: 0, roles: 0 });
  });

  test("sending to the roster person's address queues one invitation mail, shows a pending row in place of the form, and grants nothing", async ({
    page,
  }) => {
    const sql = platformSql();
    const operatorId = await rosterUserId(sql, "admin");
    type Counts = { people: number; memberships: number; grants: number; roles: number };
    const countRows = async (): Promise<Counts> => {
      const [row] = (await sql`
        select (select count(*)::int from memberships where organization_id = ${org.orgId}::uuid) as memberships,
               (select count(distinct m.person_id)::int from memberships m where m.organization_id = ${org.orgId}::uuid) as people,
               (select count(*)::int from role_grants where organization_id = ${org.orgId}::uuid) as grants,
               (select count(*)::int from app_roles where organization_id = ${org.orgId}::uuid) as roles`) as Counts[];
      return row;
    };
    const before = await countRows();

    await page.goto(`/admin/organizations/${org.orgId}`);
    const section = page.getByTestId("treasurer-designation-section");
    const email = section.getByLabel(/treasurer.s email address/i);
    await expect(email).toBeEnabled({ timeout: 15_000 });
    await email.fill(treasurerEmail);
    await section.getByRole("button", { name: "Send invitation" }).click();

    // The confirm is an AlertDialog (no native dialog); it names the address and the organization before
    // anything is written, and tells the operator nobody holds the access until it is accepted.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(treasurerEmail);
    await expect(dialog).toContainText(org.name);
    await expect(dialog).toContainText(/nobody holds this role until it is accepted/i);
    await expect(dialog.getByTestId("self-address-sentence")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Yes, send invitation" }).click();

    const notice = section.getByRole("status").filter({ hasText: /Invitation (sent|created)/ });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText(`Invitation sent to ${treasurerEmail}.`);
    await expect(notice).toContainText(/The treasurer designation takes effect when .+ accepts it\. Until then nobody holds this access\./);
    // The open line replaces "nobody holds ... until it is accepted" with the named person.
    await expect(section).toContainText(/An invitation is open for .+\. Nobody holds this access until .+ accepts it\./);
    // The pending row replaces the form: the control is gone, the row shows the address and its state.
    await expect(section.getByLabel(/treasurer.s email address/i)).toHaveCount(0);
    const row = section.getByTestId("invitation-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(treasurerEmail);
    await expect(row).toContainText("Pending");
    await expect(row.getByRole("button", { name: "Resend" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Revoke" })).toBeVisible();

    // And it stays that way on a fresh load: still pending, still no form, nobody holds the access.
    await page.goto(`/admin/organizations/${org.orgId}`);
    const reloaded = page.getByTestId("treasurer-designation-section");
    await expect(reloaded.getByTestId("invitation-row")).toContainText("Pending", { timeout: 10_000 });
    await expect(reloaded.getByLabel(/treasurer.s email address/i)).toHaveCount(0);

    // Database truth: one open treasurer invitation naming the roster person; nothing was granted and no
    // person, membership or role was created (acceptance, not sending, is what applies the designation).
    const [invitation] = (await sql`
      select id, purpose, person_id::text as person_id, created_by_user_id::text as created_by,
             accepted_at, revoked_at, email_queue_id is not null as queued
        from account_invitations where organization_id = ${org.orgId}::uuid`) as {
      id: string; purpose: string; person_id: string; created_by: string; accepted_at: string | null;
      revoked_at: string | null; queued: boolean;
    }[];
    expect(invitation).toMatchObject({
      purpose: "treasurer",
      person_id: treasurerPersonId,
      created_by: operatorId,
      accepted_at: null,
      revoked_at: null,
      queued: true,
    });
    expect(await countRows(), "sending creates no person, membership, grant or role").toEqual(before);

    // The mail: one row, platform-domain account mail by key; once sent its body no longer holds the link.
    const mail = await queueRowFor(sql, invitation.id);
    expect(mail.to_email).toBe(treasurerEmail);
    expect(mail.template_key).toBe("account_invitation");
    if (mail.status === "sent") {
      expect(mail.html_body, "the credential is scrubbed from the stored body once sent").toBe(REDACTED_BODY_MARKER);
      expect(mail.text_body).toBe(REDACTED_BODY_MARKER);
    } else {
      // A provider that is down leaves it queued WITH the link (the named residual); never anything else.
      expect(mail.status).toBe("queued");
      expect(mail.html_body).toContain("/invite?token=");
    }
    expect(mail.html_body).not.toContain(treasurerEmail);

    // The audit row: the operator as actor, the organization in metadata, ids only.
    const audit = (await auditRowsFor(sql, invitation.id)).filter((a) => a.action === "invitation.created");
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({
      invitationId: invitation.id,
      organizationId: org.orgId,
      purpose: "treasurer",
      personId: treasurerPersonId,
    });
    expect(JSON.stringify(audit[0].metadata)).not.toContain(treasurerEmail);
    expect(audit[0].actor_email).toBe(E2E_USERS.admin.email);
    expect(audit[0].actor_user_id).toBe(operatorId);
    // No designation event until it is accepted.
    const designated = (await sql`
      select 1 from audit_events where action = 'org.treasurer.designated' and resource_id = ${org.orgId}`) as unknown[];
    expect(designated).toHaveLength(0);
  });

  test("Resend inside the cooldown is refused in plain words; Revoke kills the link and brings the form back", async ({
    page,
  }) => {
    const sql = platformSql();
    await page.goto(`/admin/organizations/${org.orgId}`);
    const section = page.getByTestId("treasurer-designation-section");
    const row = section.getByTestId("invitation-row");
    await expect(row).toContainText("Pending", { timeout: 15_000 });

    // Just sent: the 5-minute cooldown refuses a resend, and the refusal is announced inline, not toast-only.
    await row.getByRole("button", { name: "Resend" }).click();
    const refusal = section.getByRole("alert").filter({ hasText: /not sent/i });
    await expect(refusal).toBeVisible({ timeout: 15_000 });
    // One literal for every limit (cooldown, per-address, per-org, per-inviter): it does not say which.
    await expect(refusal).toContainText("Too many invitations right now. Try again later.");

    // Revoke behind an AlertDialog (never a native confirm).
    await row.getByRole("button", { name: "Revoke" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(treasurerEmail);
    await dialog.getByRole("button", { name: "Yes, revoke" }).click();

    // The form is back for a different invitation; the old row is a revoked one.
    await expect(section.getByLabel(/treasurer.s email address/i)).toBeVisible({ timeout: 20_000 });
    await expect(section.getByTestId("invitation-row")).toContainText("Revoked");
    const [invitation] = (await sql`
      select id, revoked_at is not null as revoked, accepted_at from account_invitations
       where organization_id = ${org.orgId}::uuid`) as { id: string; revoked: boolean; accepted_at: string | null }[];
    expect(invitation).toMatchObject({ revoked: true, accepted_at: null });
    const audit = await auditRowsFor(sql, invitation.id);
    expect(audit.map((a) => a.action)).toEqual(["invitation.created", "invitation.revoked"]);
    expect(audit[1].metadata).toMatchObject({ invitationId: invitation.id, organizationId: org.orgId, via: "single" });
    // The refused resend left no successor row behind.
    const rows = (await sql`select count(*)::int as n from account_invitations where organization_id = ${org.orgId}::uuid`) as { n: number }[];
    expect(rows[0].n).toBe(1);
  });

  test.describe("at a 360 px phone viewport", () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test("the section fits the viewport with a 44 px touch target and no horizontal scroll inside it", async ({
      page,
    }) => {
      // The previous test revoked the only invitation, so the form is back.
      await page.goto(`/admin/organizations/${org.orgId}`);
      const section = page.getByTestId("treasurer-designation-section");
      await expect(section).toBeVisible({ timeout: 10_000 });
      const email = section.getByLabel(/treasurer.s email address/i);
      await expect(email).toBeEnabled({ timeout: 15_000 });
      await email.fill(treasurerEmail);

      const box = await section.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(360 + 1);
      const trigger = section.getByRole("button", { name: "Send invitation" });
      const triggerBox = await trigger.boundingBox();
      expect(triggerBox!.height).toBeGreaterThanOrEqual(44);
      expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(360 + 1);

      // Nothing inside the section scrolls sideways - including the revoked row listed under the form.
      const overflows = await section.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(overflows).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Test 8 — Founding-administrator INVITATION (Phase 3 QA requirement 3, the
// "send half"). Same throwaway-congregation discipline as Test 7.
//
// The sender's screen is IDENTICAL whether or not the address already has an
// account (the send step reads no `users` row): the same notice, the same
// pending row. Sent to an address with no account (org A) and to the `member`
// fixture's address, which has one (org B), the notice text must be the same
// string. A self-addressed send (the operator's own address) adds one sentence
// to the confirm dialog and nothing else (the operator ruling on R9).
// ---------------------------------------------------------------------------

test.describe("Admin — founding administrator invitation", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);

  let orgA: InviteOrg;
  let orgB: InviteOrg;
  let noticeForNewAddress = "";

  test.beforeAll(async () => {
    const sql = platformSql();
    orgA = await setupInviteOrg(sql);
    // Distinct stamps: both orgs live at once, and the slug and id are derived from the stamp.
    orgB = await setupInviteOrg(sql, { stamp: orgA.stamp + 1, sweep: false });
  });

  test.afterAll(async () => {
    const sql = platformSql();
    await removeInviteOrg(sql, orgA);
    await removeInviteOrg(sql, orgB);
  });

  async function fillAndSend(page: import("@playwright/test").Page, input: { email: string; first: string; last: string }) {
    const section = page.getByTestId("founding-administrator-section");
    const email = section.getByLabel("Email address");
    await expect(email).toBeEnabled({ timeout: 15_000 });
    const send = section.getByRole("button", { name: "Send invitation" });
    await expect(send).toBeDisabled();
    await email.fill(input.email);
    await section.getByLabel("First name").fill(input.first);
    await expect(send, "disabled until the last name is filled too").toBeDisabled();
    await section.getByLabel("Last name").fill(input.last);
    await expect(send).toBeEnabled();
    await send.click();
    return section;
  }

  test("an address with no account: the dialog names the organization, address and role; the send queues one mail and shows a pending row", async ({
    page,
  }) => {
    const sql = platformSql();
    const address = inviteAddress(orgA, "founding");
    await page.goto(`/admin/organizations/${orgA.orgId}`);
    const section = await fillAndSend(page, { email: address, first: INVITE_NAMES.first, last: INVITE_NAMES.last });

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(address);
    await expect(dialog).toContainText(orgA.name);
    await expect(dialog).toContainText(/founding administrator/i);
    await expect(dialog.getByTestId("self-address-sentence")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Yes, send invitation" }).click();

    const notice = section.getByRole("status").filter({ hasText: /Invitation (sent|created)/ });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    noticeForNewAddress = ((await notice.textContent()) ?? "").replace(/\s+/g, " ").trim();
    expect(noticeForNewAddress).toContain(
      `The founding administrator designation takes effect when ${INVITE_NAMES.first} ${INVITE_NAMES.last} accepts it. Until then nobody holds this role.`,
    );
    expect(noticeForNewAddress).toContain(`Invitation sent to ${address}.`);
    // The notice names the typed address and name; mask them so the second send's screen can be
    // compared on everything else (the account-existence property must not change it).
    noticeForNewAddress = noticeForNewAddress.split(address).join("<address>").split(`${INVITE_NAMES.first} ${INVITE_NAMES.last}`).join("<name>");
    const row = section.getByTestId("invitation-row");
    await expect(row).toContainText(address);
    await expect(row).toContainText(`${INVITE_NAMES.first} ${INVITE_NAMES.last}`);
    await expect(row).toContainText("Pending");

    const [invitation] = (await sql`
      select id, purpose, invitee_first_name, invitee_last_name, person_id, accepted_at
        from account_invitations where organization_id = ${orgA.orgId}::uuid`) as {
      id: string; purpose: string; invitee_first_name: string; invitee_last_name: string; person_id: string | null; accepted_at: string | null;
    }[];
    expect(invitation).toMatchObject({
      purpose: "founding_administrator",
      invitee_first_name: INVITE_NAMES.first,
      invitee_last_name: INVITE_NAMES.last,
      person_id: null,
      accepted_at: null,
    });
    const mail = await queueRowFor(sql, invitation.id);
    expect(mail.to_email).toBe(address);
    expect(mail.template_key).toBe("account_invitation");
    if (mail.status === "sent") expect(mail.html_body).toBe(REDACTED_BODY_MARKER);
    else expect(mail.status).toBe("queued");
    // Sending creates no account, no person and no grant: acceptance does.
    const written = (await sql`
      select (select count(*)::int from users where lower(email) = ${address}) as users,
             (select count(*)::int from memberships where organization_id = ${orgA.orgId}::uuid) as memberships,
             (select count(*)::int from role_grants where organization_id = ${orgA.orgId}::uuid) as grants`) as { users: number; memberships: number; grants: number }[];
    expect(written[0]).toEqual({ users: 0, memberships: 0, grants: 0 });
    const audit = await auditRowsFor(sql, invitation.id);
    expect(audit.map((a) => a.action)).toEqual(["invitation.created"]);
    expect(JSON.stringify(audit[0].metadata)).not.toContain(address);
  });

  test("an address that already has an account gets the IDENTICAL result (the send never reads users); the operator's own address adds one sentence", async ({
    page,
  }) => {
    const sql = platformSql();
    await page.goto(`/admin/organizations/${orgB.orgId}`);
    const section = page.getByTestId("founding-administrator-section");
    const email = section.getByLabel("Email address");
    await expect(email).toBeEnabled({ timeout: 15_000 });

    // Self-addressed: the one extra sentence, then cancel without sending.
    await email.fill(E2E_USERS.admin.email);
    await section.getByLabel("First name").fill("Operator");
    await section.getByLabel("Last name").fill("Selfaddress");
    await section.getByRole("button", { name: "Send invitation" }).click();
    const selfDialog = page.getByRole("alertdialog");
    await expect(selfDialog.getByTestId("self-address-sentence")).toContainText(/your own address/i);
    await selfDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    const none = (await sql`select count(*)::int as n from account_invitations where organization_id = ${orgB.orgId}::uuid`) as { n: number }[];
    expect(none[0].n, "cancelling the confirm sends nothing").toBe(0);

    // An existing account's address (the `member` fixture has one).
    await email.fill(E2E_USERS.member.email);
    await section.getByRole("button", { name: "Send invitation" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(E2E_USERS.member.email);
    await expect(dialog.getByTestId("self-address-sentence")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Yes, send invitation" }).click();

    const notice = section.getByRole("status").filter({ hasText: /Invitation (sent|created)/ });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    const noticeForExisting = ((await notice.textContent()) ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .split(E2E_USERS.member.email)
      .join("<address>")
      .split("Operator Selfaddress")
      .join("<name>");
    expect(noticeForExisting, "the sender's screen is the same whether or not the address has an account").toBe(noticeForNewAddress);
    await expect(section.getByTestId("invitation-row")).toContainText("Pending");

    // The person it names was NOT looked up or touched: no grant, no membership, the member account unchanged.
    const written = (await sql`
      select (select count(*)::int from memberships where organization_id = ${orgB.orgId}::uuid) as memberships,
             (select count(*)::int from role_grants where organization_id = ${orgB.orgId}::uuid) as grants`) as { memberships: number; grants: number }[];
    expect(written[0]).toEqual({ memberships: 0, grants: 0 });
  });
});

// ---------------------------------------------------------------------------
// Test 9 — a long UNBROKEN invitee name at a 360 px phone viewport
// (docs/work-log/2026-10-24-invite-accept-copy.md, QA run 1, regression for the
// open line and the list "For" row overflowing). The name validates at 100
// characters per part, and a string with no spaces gives the browser nowhere to
// wrap, so every surface that prints it needs an explicit wrap rule. After the
// send, nothing in the section may extend past the viewport and the document may
// not scroll sideways.
// ---------------------------------------------------------------------------

test.describe("Admin — founding administrator invitation, long unbroken name at 360 px", () => {
  test.use({ storageState: storageStatePath("admin"), viewport: { width: 360, height: 740 } });
  test.setTimeout(90_000);

  let org: InviteOrg;

  test.beforeAll(async () => {
    org = await setupInviteOrg(platformSql());
  });

  test.afterAll(async () => {
    await removeInviteOrg(platformSql(), org);
  });

  test("the notice, the open line and the For row wrap; no element passes the viewport and the page does not scroll sideways — regression for long-name overflow", async ({
    page,
  }) => {
    const first = "W".repeat(100);
    const last = "M".repeat(100);
    const address = inviteAddress(org, "long-name");

    await page.goto(`/admin/organizations/${org.orgId}`);
    const section = page.getByTestId("founding-administrator-section");
    const email = section.getByLabel("Email address");
    await expect(email).toBeEnabled({ timeout: 15_000 });
    await email.fill(address);
    await section.getByLabel("First name").fill(first);
    await section.getByLabel("Last name").fill(last);
    await section.getByRole("button", { name: "Send invitation" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Yes, send invitation" }).click();

    // The notice, the standing open line and the pending row all name the person.
    const fullName = `${first} ${last}`;
    const notice = section.getByRole("status").filter({ hasText: /Invitation (sent|created)/ });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText(fullName);
    await expect(section).toContainText(`An invitation is open for ${fullName}.`, { timeout: 20_000 });
    const row = section.getByTestId("invitation-row");
    await expect(row).toContainText(fullName);

    const offenders = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const section = document.querySelector('[data-testid="founding-administrator-section"]');
      const found: string[] = [];
      for (const el of section ? [section, ...Array.from(section.querySelectorAll("*"))] : []) {
        const label = `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}`;
        const right = el.getBoundingClientRect().right;
        if (right > viewport + 1) found.push(`${label} right edge ${Math.round(right)}px`);
        // Text that overflows its own box does not move the box's edge, so also compare
        // the content width with the box (inline elements report clientWidth 0).
        if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
          found.push(`${label} content ${el.scrollWidth}px in a ${el.clientWidth}px box`);
        }
      }
      return { viewport, found, docWidth: document.documentElement.scrollWidth };
    });
    expect(offenders.viewport).toBeLessThanOrEqual(360);
    expect(offenders.found, "no element in the section extends past the viewport").toEqual([]);
    expect(offenders.docWidth, "the document has no horizontal scroll").toBeLessThanOrEqual(offenders.viewport);
  });
});
