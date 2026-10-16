/**
 * giving-shell.spec.ts - the toggle-aware shell at /o/<slug>/admin/giving
 * against a running server (online giving, Batch 1b; docs/work-log/
 * 2026-10-15-online-giving.md). The shell renders no tenant data; what these
 * tests prove is the GATE: the four honest states, the Node-side 2FA refusal,
 * and that "off" is a page, never a 404.
 *
 * Fixtures (DECISION-157: a spec creates only its own rows and removes them in
 * afterAll, on the owner connection):
 *   - the `org_portal.giving` org toggle at e2e-alpha, captured and restored;
 *   - a STRAY toggle row at the e2e-presbytery (a presbytery can never hold
 *     one through the app; the shell must still answer "not available");
 *   - one org-owned role `e2e_giving_view` holding giving.view, granted to
 *     `org-single` for the 2FA test only. Holding any giving key makes
 *     org-single's sign-in require 2FA (arm B of presby_two_factor_required),
 *     so the grant exists for one test and is removed straight after it.
 */

import { test, expect } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { E2E_ORGS } from "./support/seed-orgs";
import { storageStatePath } from "./support/users";

const ALPHA = E2E_ORGS.alpha;
const PRESBYTERY = E2E_ORGS.presbytery;
const ORG_SINGLE_PERSON = "e2e00000-0000-0000-0000-0000000000a1";
const TOGGLE = "org_portal.giving";
const ROLE_ID = "e2e91000-0000-4000-8000-000000000001";
const SHELL = `/o/${ALPHA.slug}/admin/giving`;

let sql: Sql;
let priorAlphaToggle: boolean | null = null;

async function setToggle(orgId: string, enabled: boolean | null) {
  if (enabled === null) {
    await sql`delete from organization_feature_toggles where organization_id = ${orgId}::uuid and feature_key = ${TOGGLE}`;
    return;
  }
  await sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${orgId}::uuid, ${TOGGLE}, ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`;
}

async function removeViewRole() {
  await sql`delete from role_grants where organization_id = ${ALPHA.id}::uuid and role_id = ${ROLE_ID}::uuid`;
  await sql`delete from app_roles where id = ${ROLE_ID}::uuid`;
}

test.describe("Giving admin shell", () => {
  test.beforeAll(async () => {
    sql = platformSql("giving-shell.spec");
    await removeViewRole(); // a crashed prior run
    const prior = (await sql`
      select enabled from organization_feature_toggles
       where organization_id = ${ALPHA.id}::uuid and feature_key = ${TOGGLE}`) as { enabled: boolean }[];
    priorAlphaToggle = prior[0]?.enabled ?? null;
  });

  test.afterAll(async () => {
    await removeViewRole();
    await setToggle(ALPHA.id, priorAlphaToggle);
    await setToggle(PRESBYTERY.id, null);
  });

  test.describe("signed out", () => {
    test("redirects to /signin and keeps the deep link", async ({ page }) => {
      await page.goto(SHELL);
      await expect(page).toHaveURL(/\/signin\?callbackUrl=%2Fo%2Fe2e-alpha%2Fadmin%2Fgiving/);
    });
  });

  test.describe("a member with no giving key", () => {
    test.use({ storageState: storageStatePath("org-single") });

    test("toggle OFF (no row): an honest 'not turned on' page at HTTP 200 - never a 404 - with no Features link for someone who cannot use it", async ({
      page,
    }) => {
      await setToggle(ALPHA.id, null);
      const response = await page.goto(SHELL);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Giving" })).toBeVisible();
      await expect(page.getByText(/giving isn.t turned on for Wrenfield Presbyterian Church/i)).toBeVisible();
      await expect(page.getByRole("link", { name: /go to features/i })).toHaveCount(0);
      // The member's own tile hub shows no Giving tile while the toggle is off.
      await page.goto(`/o/${ALPHA.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(`a[href="/o/${ALPHA.slug}/giving"]`)).toHaveCount(0);
    });

    test("toggle ON but no giving key: the Forbidden state names the organization and points at the treasurer", async ({
      page,
    }) => {
      await setToggle(ALPHA.id, true);
      const response = await page.goto(SHELL);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByText(/giving administration isn.t available to your account at Wrenfield Presbyterian Church/i),
      ).toBeVisible();
      await expect(page.getByText(/ask your treasurer/i)).toBeVisible();
      // The member hub now shows the (org-toggle-gated, org-type-scoped) Giving
      // tile. Its destination (/o/<slug>/giving) is a later batch's page.
      await page.goto(`/o/${ALPHA.slug}`);
      // The tile also appears in the nav and footer, so match by destination.
      await expect(page.locator(`a[href="/o/${ALPHA.slug}/giving"]`).first()).toBeVisible();
    });

    test("a state page fits a 360 px phone viewport with no horizontal scroll", async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await setToggle(ALPHA.id, null);
      await page.goto(SHELL);
      await expect(page.getByRole("heading", { level: 1, name: "Giving" })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflow).toBe(false);
    });

    test("holding a giving key while the session says 2FA is not verified redirects to /totp (or its enrolment) and never renders the shell (R4)", async ({
      page,
    }) => {
      await setToggle(ALPHA.id, true);
      await sql`
        insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
        values (${ROLE_ID}::uuid, ${ALPHA.id}::uuid, 'e2e_giving_view', 'E2E Giving View', 'custom', false)
        on conflict (id) do nothing`;
      await sql`
        insert into app_role_permissions (role_id, permission_key)
        values (${ROLE_ID}::uuid, 'giving.view') on conflict do nothing`;
      await sql`
        insert into role_grants (organization_id, role_id, person_id, starts_on)
        select ${ALPHA.id}::uuid, ${ROLE_ID}::uuid, ${ORG_SINGLE_PERSON}::uuid, date '2020-01-01'
         where not exists (select 1 from role_grants
                            where role_id = ${ROLE_ID}::uuid and person_id = ${ORG_SINGLE_PERSON}::uuid)`;
      try {
        await page.goto(SHELL);
        // org-single has no TOTP enrolment, so /totp walks them to /account/2fa;
        // either way the shell must not have rendered.
        await expect(page).toHaveURL(/\/(totp|account\/2fa)/, { timeout: 15_000 });
        await expect(page.getByText(/giving is turned on for/i)).toHaveCount(0);
      } finally {
        await removeViewRole();
      }
    });
  });

  test.describe("a presbytery", () => {
    test.use({ storageState: storageStatePath("presbytery-clerk") });

    test("is told Giving is not available for it, even with a stray toggle row - and gets no Features link", async ({
      page,
    }) => {
      await setToggle(PRESBYTERY.id, true);
      const response = await page.goto(`/o/${PRESBYTERY.slug}/admin/giving`);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByText(/giving isn.t available for Presbytery of the Eastern Fells/i),
      ).toBeVisible();
      await expect(page.getByText(/congregations and new worshiping communities/i)).toBeVisible();
      await expect(page.getByRole("link", { name: /go to features/i })).toHaveCount(0);
    });
  });

  test.describe("a person with no relationship to the organization", () => {
    test.use({ storageState: storageStatePath("org-single") });

    test("gets the shared access-denied page for another organization, not the giving gate (the four-way miss comes first)", async ({
      page,
    }) => {
      await page.goto(`/o/${E2E_ORGS.beta.slug}/admin/giving`);
      await expect(page.getByText(/you don.t have access to Thistledown Presbyterian Church/i)).toBeVisible();
    });
  });
});
