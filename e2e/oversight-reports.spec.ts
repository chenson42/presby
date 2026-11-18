/**
 * oversight-reports.spec.ts - the Buildings and Insurance-and-loans reports, end to end (Congregation profile
 * Increment 2, Batch B9; docs/work-log/2026-11-17-congregation-profile-inc2.md, parent Phase 3 "Test plan" E2E
 * rows for reports; DECISION-348).
 *
 * WHO: a presbytery clerk who holds `congregation_oversight.manage` and nothing else (Buildings, no second
 * factor), and a finance-only holder (Insurance and loans; MFA enrolled, a flagged key requires it). A throwaway
 * presbytery from `support/oversight-fixture.ts` with two member congregations: Alder (a building in use, a
 * policy that expired, an open loan with no balance, an appraisal) and Birch (nothing at first, then only a
 * retired building: the two empty lines the Buildings report tells apart). Flag `org_portal.reports` set here
 * and restored in afterAll; the reports do not ride `org_portal.oversight`.
 *
 * COVERS: the hub for each viewer (the right cards open, the others Locked, with their reason); each report for
 * the right key on a 360px phone (cards, no sideways scroll, 44px targets, "Expired" in words, "1 not recorded",
 * no `$0`, "Not recorded" for a congregation with no building ever and "None in use" for one with only a retired
 * building) and as a table on a desktop; a Locked page for the wrong key and a 403 on the wrong key's export, with
 * nothing audited; both CSV downloads (BOM, CRLF, the exact headers, the right rows, the guarantee present, and
 * never a street address, a policy number, a lender or a note); the export audit row (the report key, the row
 * count and the organization, never a name or an amount). SENTINEL text in every field a file must leave out.
 *
 * The cases share one signed-in context per viewer and one set of records, so they run in order.
 */
import { readFile } from "node:fs/promises";
import { test, expect, type BrowserContext } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  newPhonePage,
  noSidewaysScroll,
  OVERSIGHT_NAMES,
  removeOversightFixture,
  seedAppraisal,
  seedBuilding,
  seedInsurance,
  seedLoan,
  seedProfile,
  setupOversightFixture,
  signedInContext,
  smallControls,
  type OversightFixture,
} from "./support/oversight-fixture";

const REPORTS_FLAG = "org_portal.reports";
const EXPORTED = "tenant.presbytery_report.exported";
const BUILDINGS_HEADER =
  "congregation,city,county,building,building_type,year_built,first_addition_year,second_addition_year,square_feet,roof_condition,plumbing_condition,hvac_condition,boiler_condition,sprinklers,fire_alarm,security_system,primary";
const INSURANCE_HEADER =
  "congregation,carrier,policy_year,policy_expires_on,recent_claims,pool_interest,open_loans,original_amount,balance,balance_unrecorded_loans,grants,guarantee,appraised_value,buildings_without_appraisal";
const FORBIDDEN_EXPORT = "You don't have permission to export this report.";

const SENTINEL_STREET = "SENTINEL-STREET-4417 Quarry Road";
const SENTINEL_NOTE = "SENTINEL-NOTE-7731 the narthex roof leaks";
const SENTINEL_POLICY = "SENTINEL-POLICY-88123";
const SENTINEL_LENDER = "SENTINEL-LENDER Savings 3307";
const GUARANTEE = "Guaranteed by the session in 2019";

let sql: Sql;
let fx: OversightFixture;
let flags: FlagCapture;
let clerk: BrowserContext;
let finance: BrowserContext;
const hub = () => `/o/${fx.presbytery.slug}/admin/reports`;
const buildingsPath = () => `${hub()}/buildings`;
const insurancePath = () => `${hub()}/insurance-and-loans`;

async function exportedRows(): Promise<Array<{ metadata: Record<string, unknown> }>> {
  return (await sql`
    select metadata from audit_events
     where action = ${EXPORTED} and metadata->>'organizationId' = ${fx.presbytery.id}
     order by created_at, id`) as never;
}

const csvLines = (text: string) => text.replace(/^﻿/, "").split("\r\n").filter((l) => l !== "");

test.describe.serial("Oversight reports: Buildings and Insurance and loans", () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(420_000);
    sql = platformSql("oversight-reports.spec");
    flags = await captureFlags(sql, [REPORTS_FLAG]);
    await setFlag(sql, REPORTS_FLAG, true);
    fx = await setupOversightFixture(sql, { tag: "r", who: ["clerk", "finance", "both"] }); // `both` authors the rows the fixture helpers seed

    // Alder: a profile with a street address, a building in use with a note, an expired policy with a policy number,
    // two open loans (one with a lender, a guarantee and an original amount, one with no figure at all; neither has a balance), and an appraisal.
    await seedProfile(sql, fx, "congA", { city: "Alder Bend", county: "Reach County" });
    await sql`update oversight_profiles set street_address = ${SENTINEL_STREET} where about_org_id = ${fx.congA.id}::uuid`;
    const sanctuary = await seedBuilding(sql, fx, "congA", { name: "Main Sanctuary", primary: true, yearBuilt: 1931, notes: SENTINEL_NOTE });
    await seedAppraisal(sql, fx, "congA", sanctuary, 2024, 50_000_000);
    await seedInsurance(sql, fx, "congA", { policyYear: 2023, carrier: "Alder Mutual", policyNumber: SENTINEL_POLICY, expiresOn: "2023-06-30" });
    await seedLoan(sql, fx, "congA", { kind: "presbytery_program", lender: SENTINEL_LENDER, originalCents: 12_000_000 });
    await sql`update oversight_loans set guarantee_note = ${GUARANTEE} where about_org_id = ${fx.congA.id}::uuid`;
    // A second open loan with no figure at all: the original amount's total then says "1 not recorded".
    await seedLoan(sql, fx, "congA", { kind: "other", lender: SENTINEL_LENDER });
    // Birch: a place and nothing else (no building ever).
    await seedProfile(sql, fx, "congB", { city: "Birchford", county: "Birch County" });

    clerk = await signedInContext(browser, "clerk", hub());
    finance = await signedInContext(browser, "finance", hub());
  });

  test.afterAll(async () => {
    await clerk?.close();
    await finance?.close();
    if (sql && fx) await removeOversightFixture(sql, fx);
    await flags?.restore();
  });

  test("the hub: each viewer's own cards open and the rest are Locked with their reason; Buildings and Insurance and loans have cards", async () => {
    const cases = [
      { context: () => clerk, open: ["buildings", "viability"], locked: 4 },
      { context: () => finance, open: ["insurance-and-loans"], locked: 5 },
    ] as const;
    for (const c of cases) {
      const page = await newPhonePage(c.context());
      await page.goto(hub());
      const cards = page.getByTestId("reports-hub");
      await expect(cards.getByRole("heading", { name: "Reports and exports" })).toBeVisible();
      await expect(cards.getByRole("heading", { level: 3, name: "Buildings" })).toBeVisible();
      await expect(cards.getByRole("heading", { level: 3, name: "Insurance and loans" })).toBeVisible();
      for (const segment of ["vacant-pulpits", "membership-trend", "viability", "per-capita", "buildings", "insurance-and-loans"]) {
        await expect(cards.locator(`a[href="${hub()}/${segment}"]`), segment).toHaveCount((c.open as readonly string[]).includes(segment) ? 1 : 0);
      }
      await expect(cards.getByText("Locked", { exact: true })).toHaveCount(c.locked);
      await noSidewaysScroll(page);
      await page.close();
    }
    const page = await newPhonePage(clerk);
    await page.goto(hub());
    await expect(page.getByTestId("reports-hub").getByText("You need permission to manage congregation property finances. An administrator can give it under Roles.")).toBeVisible();
    await page.close();
  });

  test("Buildings at 360px: cards, the building's facts, \"Not recorded\" for a congregation with no building ever, no street address or note, no sideways scroll", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(buildingsPath());
    await expect(page.getByRole("heading", { level: 1, name: "Buildings" })).toBeVisible();
    await expect(page.getByText("1 building in 1 congregation")).toBeVisible();
    await expect(page.getByText("The CSV file leaves out street addresses and notes.")).toBeVisible();
    await expect(page.getByTestId("report-cards")).toBeVisible();
    await expect(page.getByTestId("report-table")).toBeHidden();

    const alder = page.getByTestId("report-cards").getByRole("listitem").filter({ hasText: fx.congA.name });
    await expect(alder).toContainText("Alder Bend, Reach County");
    await expect(alder).toContainText("Main Sanctuary");
    await expect(alder).toContainText("Primary");
    await expect(alder).toContainText("1931");
    const birch = page.getByTestId("report-cards").getByRole("listitem").filter({ hasText: fx.congB.name });
    await expect(birch).toContainText("Birchford, Birch County");
    await expect(birch).toContainText("Not recorded");
    await expect(birch).not.toContainText("None in use");

    const body = await page.locator("main").innerText();
    for (const sentinel of [SENTINEL_STREET, SENTINEL_NOTE, SENTINEL_POLICY, SENTINEL_LENDER]) expect(body).not.toContain(sentinel);
    await noSidewaysScroll(page);
    const exportLink = page.getByRole("link", { name: "Export CSV" });
    expect((await exportLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await smallControls(page)).toEqual([]);
    await page.close();
  });

  test("Buildings: a congregation whose only building is retired reads \"None in use\"; on a desktop the report is a table", async () => {
    await seedBuilding(sql, fx, "congB", { name: "Birch Chapel", retiredOn: "2022-05-01", retiredReason: "sold" });
    const phone = await newPhonePage(clerk);
    await phone.goto(buildingsPath());
    const birch = phone.getByTestId("report-cards").getByRole("listitem").filter({ hasText: fx.congB.name });
    await expect(birch).toContainText("None in use");
    await expect(birch).not.toContainText("Not recorded");
    await expect(phone.getByText("Birch Chapel")).toHaveCount(0); // a retired building is not listed
    await expect(phone.getByText("Only buildings in use are listed. A building that has been retired is not.")).toBeVisible();
    await phone.close();

    const desk = await clerk.newPage();
    await desk.setViewportSize({ width: 1100, height: 800 });
    await desk.goto(buildingsPath());
    const table = desk.getByTestId("report-table");
    await expect(table).toBeVisible();
    await expect(desk.getByTestId("report-cards")).toBeHidden();
    for (const column of ["Congregation", "City", "County", "Building", "Type", "Year built", "Square feet", "Roof", "Sprinklers", "Primary"]) {
      await expect(table.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
    }
    await expect(table.locator("tr", { hasText: fx.congA.name })).toContainText("Main Sanctuary");
    await expect(table.locator("tr", { hasText: fx.congB.name })).toContainText("None in use");
    await desk.close();
  });

  test("Insurance and loans at 360px: Expired in words, \"1 not recorded\", the guarantee, a Total card, no $0, and nothing a file leaves out", async () => {
    const page = await newPhonePage(finance);
    await page.goto(insurancePath());
    await expect(page.getByRole("heading", { level: 1, name: "Insurance and loans" })).toBeVisible();
    await expect(
      page.getByText("The CSV file leaves out street addresses, policy numbers, lenders and notes. It does include each loan's guarantee."),
    ).toBeVisible();
    await expect(page.getByTestId("report-cards")).toBeVisible();
    await expect(page.getByTestId("report-table")).toBeHidden();

    const alder = page.getByTestId("report-cards").getByRole("listitem").filter({ hasText: fx.congA.name });
    await expect(alder).toContainText("Alder Mutual");
    await expect(alder).toContainText("2023");
    await expect(alder.getByText("Expired", { exact: true })).toBeVisible();
    await expect(alder).toContainText("$120,000"); // the original amount
    await expect(alder).toContainText("Not recorded"); // the balance
    await expect(alder).toContainText("1 not recorded"); // beside the original amount: the second loan has no figure
    await expect(alder).toContainText(GUARANTEE);
    await expect(alder).toContainText("$500,000"); // the appraised value
    const birch = page.getByTestId("report-cards").getByRole("listitem").filter({ hasText: fx.congB.name });
    await expect(birch).toContainText("Not recorded");
    await expect(page.getByTestId("report-total")).toContainText("Total");
    await expect(page.getByTestId("report-total")).toContainText("$120,000");

    const body = await page.locator("main").innerText();
    expect(body).not.toContain("$0");
    for (const sentinel of [SENTINEL_STREET, SENTINEL_NOTE, SENTINEL_POLICY, SENTINEL_LENDER]) expect(body).not.toContain(sentinel);
    await noSidewaysScroll(page);
    expect((await page.getByRole("link", { name: "Export CSV" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await smallControls(page)).toEqual([]);
    await page.close();
  });

  test("the wrong key: each page is a permission line with no data and no export link, and each export is the one 403 with nothing audited", async () => {
    const auditBefore = (await exportedRows()).length;

    const clerkPage = await newPhonePage(clerk);
    await clerkPage.goto(insurancePath());
    await expect(clerkPage.getByRole("heading", { level: 1, name: "Insurance and loans" })).toBeVisible();
    await expect(
      clerkPage.getByText(`You don't have permission to manage congregation property finances at ${OVERSIGHT_NAMES.presbytery}.`),
    ).toBeVisible();
    await expect(clerkPage.getByRole("link", { name: "Export CSV" })).toHaveCount(0);
    expect(await clerkPage.locator("main").innerText()).not.toContain("Alder Mutual");
    await clerkPage.close();

    const financePage = await newPhonePage(finance);
    await financePage.goto(buildingsPath());
    await expect(financePage.getByRole("heading", { level: 1, name: "Buildings" })).toBeVisible();
    await expect(financePage.getByText(`You don't have permission to manage congregation oversight at ${OVERSIGHT_NAMES.presbytery}.`)).toBeVisible();
    await expect(financePage.getByRole("link", { name: "Export CSV" })).toHaveCount(0);
    expect(await financePage.locator("main").innerText()).not.toContain("Main Sanctuary");
    await financePage.close();

    for (const [context, path] of [
      [clerk, `${insurancePath()}/export`],
      [finance, `${buildingsPath()}/export`],
    ] as const) {
      const res = await context.request.get(path);
      expect(res.status(), path).toBe(403);
      expect(await res.text()).toBe(FORBIDDEN_EXPORT);
    }
    expect((await exportedRows()).length, "a refused export audits nothing").toBe(auditBefore);
  });

  test("the Buildings CSV, downloaded from the page: BOM, CRLF, the exact header, the right rows, nothing the file leaves out, one audit row", async () => {
    const before = (await exportedRows()).length;
    const page = await newPhonePage(clerk);
    await page.goto(buildingsPath());
    const link = page.getByRole("link", { name: "Export CSV" });
    expect(await link.getAttribute("href")).toBe(`${buildingsPath()}/export`);
    expect(await link.getAttribute("download")).not.toBeNull();
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^buildings-${fx.presbytery.slug}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    const bytes = await readFile((await download.path())!);
    await page.close();

    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString("utf8");
    expect(text).toContain("\r\n");
    expect(text).not.toMatch(/[^\r]\n/);
    const lines = csvLines(text);
    expect(lines[0]).toBe(BUILDINGS_HEADER);
    expect(lines).toHaveLength(3);
    const alder = lines.find((l) => l.startsWith(fx.congA.name))!;
    expect(alder).toBe(`${fx.congA.name},Alder Bend,Reach County,Main Sanctuary,Sanctuary,1931,,,,,,,,,,,Yes`);
    // Birch has only a retired building: one line, its name, city and county, nothing else.
    const birch = lines.find((l) => l.startsWith(fx.congB.name))!;
    expect(birch).toBe([fx.congB.name, "Birchford", "Birch County", ...Array<string>(14).fill("")].join(","));
    for (const sentinel of [SENTINEL_STREET, SENTINEL_NOTE, SENTINEL_POLICY, SENTINEL_LENDER, GUARANTEE, "Birch Chapel"]) expect(text).not.toContain(sentinel);

    // The route's own headers, and the audit row (the report key, the row count, the organization; never a name).
    const res = await clerk.request.get(`${buildingsPath()}/export`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect(res.headers()["content-disposition"]).toMatch(/^attachment; filename="buildings-/);

    const audit = await exportedRows();
    expect(audit.length).toBe(before + 2); // the download and the request above
    expect(audit.at(-1)!.metadata).toEqual({ organizationId: fx.presbytery.id, report: "buildings", rowCount: 2 });
    expect(JSON.stringify(audit.slice(before))).not.toMatch(/Alder|Birch|Main Sanctuary|SENTINEL/);
  });

  test("the Insurance and loans CSV: the exact header, the guarantee present, no street address, policy number or lender, one audit row", async () => {
    const before = (await exportedRows()).length;
    const res = await finance.request.get(`${insurancePath()}/export`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect(res.headers()["content-disposition"]).toMatch(
      new RegExp(`^attachment; filename="insurance-and-loans-${fx.presbytery.slug}-\\d{4}-\\d{2}-\\d{2}\\.csv"$`),
    );
    const bytes = await res.body();
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString("utf8");
    const lines = csvLines(text);
    expect(lines[0]).toBe(INSURANCE_HEADER);
    expect(lines).toHaveLength(3);
    // Carrier, policy year and expiry; two open loans, one original amount, no balance (2 unrecorded), the guarantee; the appraisal.
    expect(lines.find((l) => l.startsWith(fx.congA.name))).toBe(
      `${fx.congA.name},Alder Mutual,2023,2023-06-30,,,2,120000.00,,2,,${GUARANTEE},500000.00,0`,
    );
    expect(lines.find((l) => l.startsWith(fx.congB.name))).toBe(`${fx.congB.name},,,,,,0,,,0,,,,0`);
    for (const sentinel of [SENTINEL_STREET, SENTINEL_NOTE, SENTINEL_POLICY, SENTINEL_LENDER]) expect(text).not.toContain(sentinel);
    expect(text).toContain(GUARANTEE);

    const audit = await exportedRows();
    expect(audit.length).toBe(before + 1);
    expect(audit.at(-1)!.metadata).toEqual({ organizationId: fx.presbytery.id, report: "insurance_and_loans", rowCount: 2 });
    expect(JSON.stringify(audit.at(-1))).not.toMatch(/Alder|Alder Mutual|120000|Guaranteed|SENTINEL/);
  });
});
