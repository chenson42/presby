/**
 * admin-organizations-create.spec.ts —
 * docs/work-log/2026-08-24-admin-org-create.md, Phase 3 Implementation Order
 * #9's own instruction: "one new e2e test in e2e/admin-organizations.spec.ts
 * or a sibling file covering the create-then-land-on-detail-page happy path
 * and the duplicate-slug inline error."
 *
 * A sibling file, not appended to admin-organizations.spec.ts — that file's
 * own tests are scoped to the "alpha" e2e fixture org and never create rows;
 * this spec's whole point is creating (and cleaning up) fresh `organizations`
 * rows, which is a different lifecycle than every existing test there.
 *
 * Every slug here is namespaced `e2e-org-create-*` and every test deletes
 * what it created in its own body (via the RLS-bypassing platform
 * connection, same mechanism admin-organizations.spec.ts's own
 * `platformSql()` uses) — leaves no residue for the next run or for the real
 * fpcw org creation this feature exists to unblock.
 */

import { neon } from "@neondatabase/serverless";
import { test, expect } from "@playwright/test";
import { storageStatePath } from "./support/users";

type Sql = ReturnType<typeof neon<false, false>>;

function platformSql(): Sql {
  const platformDbUrl =
    process.env.E2E_PLATFORM_DATABASE_URL ?? process.env.PLATFORM_DATABASE_URL ?? "";
  if (!platformDbUrl) {
    throw new Error(
      "[admin-organizations-create.spec] No platform database URL. Set " +
        "PLATFORM_DATABASE_URL (or E2E_PLATFORM_DATABASE_URL) in .env.local.",
    );
  }
  return neon(platformDbUrl);
}

async function deleteOrgBySlug(sql: Sql, slug: string): Promise<void> {
  await sql`delete from organizations where slug = ${slug}`;
}

test.describe("Member — /admin/organizations/new blocked by proxy", () => {
  test.use({ storageState: storageStatePath("member") });

  test("member navigating to /admin/organizations/new is redirected to /access-pending", async ({
    page,
  }) => {
    await page.goto("/admin/organizations/new");
    await expect(page).toHaveURL(/\/access-pending/, { timeout: 10_000 });
  });
});

test.describe("Admin — create organization (leaves no residue)", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("admin creates a congregation and lands on its detail page", async ({
    page,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-org-create-${stamp}`;
    const name = `E2E Fixture Congregation ${stamp}`;
    const sql = platformSql();

    try {
      await page.goto("/admin/organizations/new");
      await expect(
        page.getByRole("heading", { name: "New organization" }),
      ).toBeVisible({ timeout: 10_000 });

      await page.locator("#name").fill(name);
      await page.locator("#slug").fill(slug);
      // organizationType defaults to "congregation"; platformStatus
      // defaults to "managed" — both left at their defaults for this test.

      await page.getByRole("button", { name: "Create organization" }).click();

      // Navigates to the (pre-existing) detail page for the new org —
      // proves createOrganizationAction's { ok, organizationId } round-trips
      // through the client's own router.push(), not a server redirect().
      await expect(page).toHaveURL(/\/admin\/organizations\/[0-9a-f-]{36}$/, {
        timeout: 15_000,
      });
      await expect(page.getByRole("heading", { name })).toBeVisible({
        timeout: 10_000,
      });

      // F16: the org is immediately usable, not blocked on a manual SQL
      // step — confirmed directly, since there is no UI yet that reads
      // groups.
      const groupRows = (await sql`
        select g.name, g.derived_from
          from groups g
          join organizations o on o.id = g.organization_id
         where o.slug = ${slug}
         order by g.name
      `) as Array<{ name: string; derived_from: string }>;
      expect(groupRows.map((r) => r.name).sort()).toEqual([
        "Active Membership",
        "Board of Deacons",
        "Session",
      ]);
    } finally {
      await deleteOrgBySlug(sql, slug);
    }
  });

  test("a duplicate slug shows the inline 'already taken' error and does not navigate away", async ({
    page,
  }) => {
    const stamp = Date.now();
    const slug = `e2e-org-create-dup-${stamp}`;
    const sql = platformSql();

    try {
      // Seed the taken slug directly — this test only needs a row to
      // collide with, not the create form's own happy path (already
      // covered above).
      await sql`
        insert into organizations (organization_type, name, slug, path, platform_status)
        values ('congregation', ${"E2E Fixture Pre-existing " + stamp}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed')
      `;

      await page.goto("/admin/organizations/new");
      await page.locator("#name").fill("Should Not Be Created");
      await page.locator("#slug").fill(slug);
      await page.getByRole("button", { name: "Create organization" }).click();

      await expect(
        page.getByRole("status").filter({
          hasText: "That slug is already taken — choose another.",
        }),
      ).toBeVisible({ timeout: 10_000 });
      // Stayed on the create page — no navigation happened on failure.
      await expect(page).toHaveURL(/\/admin\/organizations\/new$/);
    } finally {
      await deleteOrgBySlug(sql, slug);
    }
  });

  test("a reserved slug shows the inline reserved-word error", async ({
    page,
  }) => {
    await page.goto("/admin/organizations/new");
    await page.locator("#name").fill("Should Not Be Created Either");
    await page.locator("#slug").fill("admin");
    await page.getByRole("button", { name: "Create organization" }).click();

    await expect(
      page.getByRole("status").filter({
        hasText: "That slug is reserved for platform use — choose another.",
      }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/admin\/organizations\/new$/);
  });
});

// ---------------------------------------------------------------------------
// Mobile (360px) — CLAUDE.md "Verify in a Browser": three prior bugs in this
// codebase were phone-only and invisible to next build/tsc/curl.
// ---------------------------------------------------------------------------

test.describe("Admin — create organization at 360px", () => {
  test.use({ storageState: storageStatePath("admin"), viewport: { width: 360, height: 800 } });

  test("every field and the submit button are visible and usable at 360px", async ({
    page,
  }) => {
    await page.goto("/admin/organizations/new");
    await expect(
      page.getByRole("heading", { name: "New organization" }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#slug")).toBeVisible();
    await expect(
      page.getByText("This cannot be changed once the organization is created."),
    ).toBeVisible();
    await expect(page.locator("#organizationType")).toBeVisible();
    await expect(page.locator("#platformStatus")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create organization" }),
    ).toBeVisible();

    // No horizontal scroll — the classic phone-only overflow bug.
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
