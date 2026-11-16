/**
 * presbytery-report-exports.spec.ts - the four presbytery reports and their CSV
 * exports (docs/work-log/2026-11-15-presbytery-reports.md, Phase 3 Test Plan,
 * DECISION-337 to 339).
 *
 * Runs against its OWN dev server (port 3102, `E2E_BASE_URL=http://localhost:3102`).
 * Sets `org_portal.reports` itself through `captureFlags`/`setFlag` and restores
 * it, and depends on no other flag. Stages one appointment in the e2e presbytery
 * (an installed call that ended two years ago at Wrenfield, so Wrenfield is
 * vacant) with the existing fixture members, and removes it in `afterAll`.
 * Assertions are about the rows this spec staged, never counts: other specs
 * share the e2e presbytery.
 *
 * Both the card list and the table are in the DOM (CSS hides one), so every
 * row assertion is scoped by `data-testid`.
 */
import { test, expect, request as pwRequest } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";

const REPORTS_FLAG = "org_portal.reports";
const SLUG = E2E_ORGS.presbytery.slug;
const BASE = `/o/${SLUG}/admin/reports`;
const SEGMENTS = ["vacant-pulpits", "membership-trend", "viability", "per-capita"] as const;
const STAGED_MINUTE = "e2e presbytery-report-exports staged";

test.describe.serial("Presbytery reports and exports (2026-11-15-presbytery-reports)", () => {
  let sql: Sql;
  let flags: FlagCapture;
  let appointeeId: string;

  async function removeStaged() {
    await sql`delete from appointments where organization_id = ${E2E_ORGS.presbytery.id}::uuid and minute_reference = ${STAGED_MINUTE}`;
  }

  test.beforeAll(async () => {
    sql = platformSql("presbytery-report-exports.spec");
    flags = await captureFlags(sql, [REPORTS_FLAG]);
    await setFlag(sql, REPORTS_FLAG, true);

    const members = (await sql`
      select person_id from memberships where organization_id = ${E2E_ORGS.presbytery.id}::uuid order by created_at limit 1
    `) as { person_id: string }[];
    appointeeId = members[0].person_id;

    await removeStaged();
    await sql`
      insert into appointments (organization_id, person_id, serving_org_id, call_type, starts_on, ends_on, end_reason, minute_reference)
      values (${E2E_ORGS.presbytery.id}::uuid, ${appointeeId}::uuid, ${E2E_ORGS.alpha.id}::uuid, 'installed_pastor',
              (current_date - interval '9 years')::date, (current_date - interval '2 years')::date, 'Retired', ${STAGED_MINUTE})
    `;
  });

  test.afterAll(async () => {
    await removeStaged();
    await flags.restore();
  });

  test("the hub shows four report links to a holder of all four keys", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();
    await page.goto(BASE);
    const hub = page.getByTestId("reports-hub");
    await expect(hub.getByRole("heading", { name: "Reports and exports" })).toBeVisible();
    for (const segment of SEGMENTS) {
      await expect(hub.locator(`a[href="${BASE}/${segment}"]`)).toBeVisible();
    }
    await expect(hub.getByText("Locked")).toHaveCount(0);
    await context.close();
  });

  test("the hub shows four locked cards, and no report link, to a member with no key", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-nogrant") });
    const page = await context.newPage();
    await page.goto(BASE);
    const hub = page.getByTestId("reports-hub");
    await expect(hub.getByText("Locked")).toHaveCount(4);
    for (const segment of SEGMENTS) {
      await expect(hub.locator(`a[href="${BASE}/${segment}"]`)).toHaveCount(0);
    }
    await context.close();
  });

  test("vacant pulpits loads, lists the staged vacancy, and its export link downloads a BOM-prefixed file and writes an audit row", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();
    await page.goto(`${BASE}/vacant-pulpits`);
    await expect(page.getByRole("heading", { level: 1, name: "Vacant pulpits" })).toBeVisible();
    await expect(page.getByTestId("report-table").getByText(E2E_ORGS.alpha.name)).toBeVisible();

    const link = page.getByRole("link", { name: "Export CSV" });
    const href = await link.getAttribute("href");
    expect(href).toBe(`${BASE}/vacant-pulpits/export`);
    expect(await link.getAttribute("download")).not.toBeNull();

    const before = (await sql`
      select count(*)::int as n from audit_events
       where action = 'tenant.presbytery_report.exported' and metadata->>'organizationId' = ${E2E_ORGS.presbytery.id}
    `) as { n: number }[];

    const res = await context.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers()["content-disposition"]).toMatch(new RegExp(`^attachment; filename="vacant-pulpits-${SLUG}-\\d{4}-\\d{2}-\\d{2}\\.csv"$`));
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = await res.body();
    expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(body.toString("utf8")).toContain(E2E_ORGS.alpha.name);

    const after = (await sql`
      select count(*)::int as n, max(metadata::text) as meta from audit_events
       where action = 'tenant.presbytery_report.exported' and metadata->>'organizationId' = ${E2E_ORGS.presbytery.id}
    `) as { n: number; meta: string }[];
    expect(after[0].n).toBe(before[0].n + 1);
    expect(after[0].meta).not.toContain(E2E_ORGS.alpha.name);
    await context.close();
  });

  test("the other three pages load for the holder of all four keys", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const page = await context.newPage();
    for (const [segment, heading] of [
      ["membership-trend", "Membership trend"],
      ["viability", "Viability"],
      ["per-capita", "Per capita"],
    ] as const) {
      const res = await page.goto(`${BASE}/${segment}`);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
    // Viability lists every member congregation, assessed or not.
    await page.goto(`${BASE}/viability`);
    await expect(page.getByTestId("report-table").getByText(E2E_ORGS.alpha.name)).toBeVisible();
    await context.close();
  });

  test("a direct export by a member with no key is 403; signed out is a 307 to /signin; a mistyped report URL is a 404", async ({ browser, baseURL }) => {
    const noGrant = await browser.newContext({ storageState: storageStatePath("presbytery-nogrant") });
    for (const segment of SEGMENTS) {
      const res = await noGrant.request.get(`${BASE}/${segment}/export`);
      expect(res.status(), segment).toBe(403);
      expect(await res.text()).toBe("You don't have permission to export this report.");
    }
    const notUuid = await noGrant.request.get(`${BASE}/not-a-uuid`);
    expect(notUuid.status()).toBe(404);
    await noGrant.close();

    const anon = await pwRequest.newContext({ baseURL: baseURL! });
    for (const segment of SEGMENTS) {
      const res = await anon.get(`${BASE}/${segment}/export`, { maxRedirects: 0 });
      expect(res.status(), segment).toBe(307);
      expect(res.headers().location).toContain(`/signin?callbackUrl=${encodeURIComponent(`${BASE}/${segment}/export`)}`);
    }
    await anon.dispose();
  });

  test("with the flag off an export is the same 403 as a missing key", async ({ browser }) => {
    await setFlag(sql, REPORTS_FLAG, false);
    try {
      const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
      const res = await context.request.get(`${BASE}/viability/export`);
      expect(res.status()).toBe(403);
      expect(await res.text()).toBe("You don't have permission to export this report.");
      await context.close();
    } finally {
      await setFlag(sql, REPORTS_FLAG, true);
    }
  });

  test("a bad year on an export is a 400, after the gate", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath("presbytery-clerk") });
    const bad = await context.request.get(`${BASE}/membership-trend/export?from=abc`);
    expect(bad.status()).toBe(400);
    const both = await context.request.get(`${BASE}/per-capita/export?allYears=1&billingYear=2025`);
    expect(both.status()).toBe(400);
    await context.close();
  });

  test("at 360px the hub and the four pages have no horizontal scroll, show the card list and hide the table, with a 44px export control", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: storageStatePath("presbytery-clerk"),
      viewport: { width: 360, height: 800 },
    });
    const page = await context.newPage();
    const noScroll = async (label: string) => {
      const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(widths.scroll, `${label} scrollWidth`).toBeLessThanOrEqual(widths.inner);
    };

    await page.goto(BASE);
    await expect(page.getByTestId("reports-hub")).toBeVisible();
    await noScroll("hub");

    for (const segment of SEGMENTS) {
      await page.goto(`${BASE}/${segment}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await noScroll(segment);
    }

    await page.goto(`${BASE}/vacant-pulpits`);
    await expect(page.getByTestId("report-cards")).toBeVisible();
    await expect(page.getByTestId("report-table")).toBeHidden();
    const vacantExport = await page.getByRole("link", { name: "Export CSV" }).boundingBox();
    expect(vacantExport!.height).toBeGreaterThanOrEqual(44);

    await page.goto(`${BASE}/viability`);
    await expect(page.getByTestId("report-cards")).toBeVisible();
    await expect(page.getByTestId("report-table")).toBeHidden();
    const viabilityExport = await page.getByRole("link", { name: "Export CSV" }).boundingBox();
    expect(viabilityExport!.height).toBeGreaterThanOrEqual(44);
    await context.close();
  });
});
