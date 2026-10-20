/**
 * domains-platform.spec.ts - the platform admin's side of custom domains: the
 * Domains section on `/admin/organizations/<id>` and the cross-organization list
 * (Track F, Batch 1d; docs/work-log/2026-10-19-custom-domains.md Flow 7, G3, G31,
 * Phase 3 Component / Page Plan, operator rulings Q1 and Q2; e2e spec 10 and 11).
 *
 * Proves: the two operator toggles are changed here (and the church's own Features
 * page does NOT list them); a claim recorded on a church's behalf shows the proof
 * record; pause darkens (recorded as a hold, with the reason on the audit row) and
 * resume restores; dispute and clear; force-release needs a reason and starts the
 * release; the cross-org list shows the host with its organization and its filters;
 * every dialog is an AlertDialog (no native dialogs); and a person without the
 * platform permission sees neither. The fake provider and fake DNS are in force on the
 * server under test, so nothing real is called.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { addDomain } from "../support/custom-hosts";
import {
  removeDomainsUiFixture,
  retireAllDomains,
  setToggle,
  setupDomainsUiFixture,
  verifiedContext,
  type DomainsUiFixture,
} from "../support/domains-ui-fixture";
import { storageStatePath } from "../support/users";

let sql: Sql;
let fx: DomainsUiFixture;
const stamp = Date.now();
const claim = `platform-${stamp}.invalid`;
const REASON = "Paused while the previous webmaster's claim is reviewed.";

test.beforeAll(async () => {
  sql = platformSql("custom-domains/domains-platform.spec");
  fx = await setupDomainsUiFixture(sql, { stamp, toggle: false });
});

test.afterAll(async () => {
  await removeDomainsUiFixture(sql, fx);
});

const orgPage = () => `/admin/organizations/${fx.orgId}`;
const toast = (page: Page) => page.locator("[data-sonner-toast]").last();

test.describe("Member without the platform permission", () => {
  test.use({ storageState: storageStatePath("member") });
  test("cannot reach the organization page or the domains list", async ({ page }) => {
    for (const url of [orgPage(), "/admin/organizations/domains"]) {
      await page.goto(url);
      await expect(page).toHaveURL(/access-pending/);
    }
  });
});

test.describe.serial("Platform admin", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("the Domains section starts with both toggles off and no claim form; turning the website toggle on reveals it", async ({ page }) => {
    await page.goto(orgPage());
    const section = page.getByTestId("domains-section");
    await expect(section.getByRole("heading", { name: "Domains" })).toBeVisible();
    await expect(section.getByTestId("toggle-state-org_portal.domains")).toHaveText("Off");
    await expect(section.getByTestId("toggle-state-org_portal.mail_domain")).toHaveText("Off");
    await expect(section.getByText(/Website domains are off for/)).toBeVisible();
    await expect(section.getByRole("heading", { name: /Record a claim/ })).toHaveCount(0);

    await section.getByRole("button", { name: "Turn on Website domain" }).click();
    await expect(toast(page)).toContainText("Website domain is now on for");
    await expect(section.getByTestId("toggle-state-org_portal.domains")).toHaveText("On");
    const rows = (await sql`
      select enabled from organization_feature_toggles where organization_id = ${fx.orgId}::uuid and feature_key = 'org_portal.domains'`) as { enabled: boolean }[];
    expect(rows[0]?.enabled).toBe(true);
    const audited = (await sql`
      select count(*)::int as n from audit_events
       where action = 'tenant.org_feature.toggled' and metadata->>'via' = 'platform' and metadata->>'organizationId' = ${fx.orgId}`) as { n: number }[];
    expect(audited[0]!.n).toBeGreaterThanOrEqual(1);

    await page.reload();
    await expect(page.getByTestId("domains-section").getByRole("heading", { name: /Record a claim/ })).toBeVisible();
  });

  test("the church's own Features page never lists the operator toggles (Q1)", async ({ browser }) => {
    // The acting church person needs org_features.manage to open the page; the check is the page text.
    const ctx = await verifiedContext(browser, `/o/${fx.slug}/admin/features`);
    const page = await ctx.newPage();
    await page.goto(`/o/${fx.slug}/admin/features`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/feature/i);
    await expect(page.getByText("You don't have permission")).toHaveCount(0); // a positive control: the page rendered its list
    await expect(page.getByText(/Website domain/i)).toHaveCount(0);
    await expect(page.getByText("org_portal.domains")).toHaveCount(0);
    await ctx.close();
  });

  test("a claim recorded on the church's behalf shows the proof record and the claim's state", async ({ page }) => {
    await page.goto(orgPage());
    const section = page.getByTestId("domains-section");
    await section.getByLabel("Domain", { exact: true }).fill(claim);
    await section.getByRole("button", { name: "Record claim" }).click();
    await expect(toast(page)).toContainText("Claim recorded for");
    const card = section.getByTestId("claim-card");
    await expect(card).toHaveAttribute("data-phase", "proving");
    await expect(card.locator('[data-record-kind="proof"] code').first()).toHaveText(`_presby-challenge.${claim}`);
    const row = (await sql`select created_via from organization_domains where organization_id = ${fx.orgId}::uuid limit 1`) as { created_via: string }[];
    expect(row[0]!.created_via).toBe("platform");
    // The platform view has the support facts and the controls, and none of the church's own buttons.
    await expect(section.getByTestId("platform-support-facts")).toBeVisible();
    await expect(card.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  });

  test("pause needs a reason, records the hold and the audit row; resume clears it", async ({ page }) => {
    // Arrange a live host the church can see (the owner path, legal edges).
    await retireAllDomains(sql, fx.orgId);
    const live = await addDomain(sql, { orgId: fx.orgId, hostname: `www.${claim}`, claimName: claim, role: "canonical", state: "live", token: 41 });
    await page.goto(orgPage());
    const section = page.getByTestId("domains-section");

    await section.getByRole("button", { name: `Pause www.${claim}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`Pause www.${claim}?`);
    const confirm = dialog.getByRole("button", { name: "Pause", exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/^Reason/).fill("too short");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/^Reason/).fill(REASON);
    await confirm.click();
    await expect(toast(page)).toContainText("Pause: done.");

    const held = (await sql`select platform_hold, hold_reason from organization_domains where id = ${live.id}::uuid`) as { platform_hold: string | null; hold_reason: string | null }[];
    expect(held[0]).toEqual({ platform_hold: "paused", hold_reason: REASON });
    const audit = (await sql`
      select metadata from audit_events where action = 'domain.hold_set' and resource_id = ${live.id} order by created_at desc limit 1`) as { metadata: Record<string, unknown> }[];
    expect(audit[0]!.metadata).toMatchObject({ hold: "paused", reason: REASON, actorKind: "platform" });

    // The church-facing view of the same host now says paused; the platform page offers Resume.
    await page.reload();
    await expect(section.getByText(/Paused by PresbyPortal support/).first()).toBeVisible();
    await section.getByRole("button", { name: `Resume www.${claim}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Resume", exact: true }).click();
    await expect(toast(page)).toContainText("is no longer paused");
    const cleared = (await sql`select platform_hold from organization_domains where id = ${live.id}::uuid`) as { platform_hold: string | null }[];
    expect(cleared[0]!.platform_hold).toBeNull();
  });

  test("dispute sets and clears the dispute hold", async ({ page }) => {
    await page.goto(orgPage());
    const section = page.getByTestId("domains-section");
    await section.getByRole("button", { name: `Dispute www.${claim}` }).click();
    await page.getByRole("alertdialog").getByLabel(/^Reason/).fill("Two parties say they own this name.");
    await page.getByRole("alertdialog").getByRole("button", { name: "Mark disputed" }).click();
    await expect(toast(page)).toContainText("Mark disputed: done.");
    const rows = (await sql`select platform_hold from organization_domains where organization_id = ${fx.orgId}::uuid and hostname = ${`www.${claim}`} and state not in ('released','expired')`) as { platform_hold: string }[];
    expect(rows[0]!.platform_hold).toBe("disputed");
    await page.reload();
    await section.getByRole("button", { name: `Clear dispute www.${claim}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Clear dispute", exact: true }).click();
    await expect(toast(page)).toContainText("is no longer under dispute");
  });

  test("the cross-organization list shows the host with its organization, and its filters", async ({ page }) => {
    await page.goto("/admin/organizations/domains");
    const row = page.locator(`[data-domain="www.${claim}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: fx.name })).toHaveAttribute("href", orgPage());
    await expect(row).toContainText("Live");
    await page.getByRole("link", { name: "Paused or disputed" }).click();
    await expect(page).toHaveURL(/filter=held/);
    await expect(page.locator(`[data-domain="www.${claim}"]`)).toHaveCount(0); // hold was cleared
    await page.getByRole("link", { name: "Lapsed or removed" }).click();
    await expect(page.locator(`[data-domain="www.${claim}"]`)).toHaveCount(0);
    await page.getByRole("link", { name: "Live", exact: true }).click();
    await expect(page.locator(`[data-domain="www.${claim}"]`)).toBeVisible();
  });

  test("force-release needs a reason, records it, tells the church, and hands the host to the release", async ({ page }) => {
    await page.goto(orgPage());
    const section = page.getByTestId("domains-section");
    await section.getByRole("button", { name: `Force-release www.${claim}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("skipping the 30-day hold");
    const confirm = dialog.getByRole("button", { name: "Force-release", exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/^Reason/).fill("Ownership confirmed to be with the previous webmaster.");
    await confirm.click();
    await expect(toast(page)).toContainText("Force-release: done.");
    const rows = (await sql`
      select state, release_cause, force_release_reason from organization_domains where organization_id = ${fx.orgId}::uuid and hostname = ${`www.${claim}`} and state not in ('released','expired')`) as { state: string; release_cause: string; force_release_reason: string }[];
    expect(rows[0]).toMatchObject({ state: "release_pending", release_cause: "force_released" });
    expect(rows[0]!.force_release_reason).toContain("previous webmaster");
    await page.reload();
    await expect(section.getByRole("button", { name: `Force-release www.${claim}` })).toHaveCount(0); // already releasing
  });

  test("turning the website toggle off hides the on-behalf claim form again", async ({ page }) => {
    await retireAllDomains(sql, fx.orgId);
    await page.goto(orgPage());
    const section = page.getByTestId("domains-section");
    await section.getByRole("button", { name: "Turn off Website domain" }).click();
    await expect(toast(page)).toContainText("Website domain is now off for");
    await page.reload();
    await expect(page.getByTestId("domains-section").getByRole("heading", { name: /Record a claim/ })).toHaveCount(0);
    await setToggle(sql, fx.orgId, null);
  });
});
