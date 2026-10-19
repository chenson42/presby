/**
 * giving-admin.spec.ts - the giving administration surface against a running
 * server (online giving, Batch 2; docs/work-log/2026-10-15-online-giving.md).
 *
 * Everything lives at a THROWAWAY congregation (`e2e-giving-<stamp>`, see
 * support/giving-fixture.ts for why it is not e2e-alpha) and is removed in
 * afterAll by deleting that organization.
 *
 * The signed-in actor is the `mfa-enrolled` fixture. Holding any giving key
 * forces 2FA, so the spec completes a REAL TOTP challenge once (verifiedContext)
 * and reuses that session; the actor's giving role is swapped in the database
 * between tests (permissions are read live). A second describe signs in with
 * the password only and proves the Node-side 2FA refusal (R4) on every admin
 * route; a third proves a platform admin who is not a member gets the four-way
 * miss on every route. Nothing here signs in as congregation-clerk or a
 * presbytery user, so no other spec's login changes.
 *
 * Phone: the overview, gifts list, new-gift form, donor page and team page are
 * checked at 360 px (no horizontal scroll, 44 px primary controls) and
 * screenshotted to test-results/giving-360/ for a human to read.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  GIVING_NAMES as N,
  addActiveMonthlyGift,
  addForeignEntry,
  removeGivingFixture,
  setGivingRole,
  setGivingToggle,
  setupGivingFixture,
  verifiedContext,
  type GivingFixture,
} from "./support/giving-fixture";
import { E2E_USERS, storageStatePath } from "./support/users";

let sql: Sql;
let fx: GivingFixture;
let ctx: BrowserContext;
let flags: FlagCapture;

const base = () => `/o/${fx.slug}/admin/giving`;
const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];

async function openPage(path: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(path);
  return page;
}

async function pickDonor(page: Page, query: string, name: RegExp) {
  await page.getByRole("searchbox").fill(query);
  await page.getByRole("button", { name }).click();
  await expect(page.getByTestId("chosen-donor")).toBeVisible();
}

async function fillGift(page: Page, opts: { fund: string; amount: string; method?: "cash" | "check" | "stock"; checkNumber?: string; stock?: string; shares?: string }) {
  await page.getByLabel(/^Fund/).selectOption({ label: opts.fund });
  if (opts.method) await page.getByLabel(/How was it given/).selectOption(opts.method);
  if (opts.checkNumber) await page.getByLabel(/Check number/).fill(opts.checkNumber);
  if (opts.stock) await page.getByLabel(/What was given/).fill(opts.stock);
  if (opts.shares) await page.getByLabel(/Number of shares/).fill(opts.shares);
  await page.getByLabel(/^Amount/).fill(opts.amount);
}

test.describe.configure({ mode: "serial" });

test.describe("Giving admin (treasurer, recorder, manager)", () => {
  test.setTimeout(90_000);

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("giving-admin.spec");
    flags = await captureFlags(sql, ["org_portal.features"]);
    fx = await setupGivingFixture(sql);
    ctx = await verifiedContext(browser, "/home");
  });

  test.afterAll(async () => {
    await ctx?.close();
    if (fx) await removeGivingFixture(sql, fx);
    await flags?.restore();
  });

  // -----------------------------------------------------------------------
  test("toggle OFF: every giving route renders the honest 'not turned on' state at HTTP 200 - never a 404 - and the CSV answers 403", async () => {
    await setGivingToggle(sql, fx, null);
    await setGivingRole(sql, fx, "treasurer");
    const [gift] = [fx.funds.general]; // any uuid shape works: the gate answers before the id is read
    const routes = ["", "/funds", "/gifts", "/gifts/new", `/gifts/${gift}`, "/donors", `/donors/${fx.donors.imogen}`, "/settings", "/team", "/statements"];
    const page = await ctx.newPage();
    for (const route of routes) {
      const response = await page.goto(`${base()}${route}`);
      expect(response?.status(), route).toBe(200);
      await expect(page.getByText(new RegExp(`giving isn.t turned on for ${N.org}`, "i")), route).toBeVisible();
    }
    const csv = await page.request.get(`${base()}/gifts/export`);
    expect(csv.status()).toBe(403);
    // The statement routes answer 403 too (never a PDF) while Giving is off.
    expect((await page.request.get(`${base()}/statements/print?year=2027`)).status()).toBe(403);
    expect((await page.request.get(`${base()}/statements/${fx.funds.general}/download`)).status()).toBe(403);
    await page.close();
  });

  // -----------------------------------------------------------------------
  test("the Features page can switch Giving on, and asks before switching it off while monthly gifts are active", async () => {
    await setFlag(sql, "org_portal.features", true);
    await setGivingToggle(sql, fx, null);
    await setGivingRole(sql, fx, "none", { features: true });
    const page = await openPage(`/o/${fx.slug}/admin/features`);
    const card = page.locator("li", { has: page.getByRole("heading", { name: "Giving", exact: true }) });
    await expect(card).toBeVisible();
    await card.getByRole("switch").click();
    await expect(page.getByText("Giving turned on.")).toBeVisible();
    expect((await rows(sql`select enabled from organization_feature_toggles where organization_id = ${fx.orgId}::uuid and feature_key = 'org_portal.giving'`))[0]).toMatchObject({ enabled: true });

    // With no active monthly gift, turning it back off needs no confirmation.
    await card.getByRole("switch").click();
    await expect(page.getByText("Giving turned off.")).toBeVisible();
    await card.getByRole("switch").click();
    await expect(page.getByText("Giving turned on.").first()).toBeVisible();

    // An active monthly gift: turning it off asks first.
    await addActiveMonthlyGift(sql, fx);
    await page.reload();
    const again = page.locator("li", { has: page.getByRole("heading", { name: "Giving", exact: true }) });
    await again.getByRole("switch").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Turn off Giving?");
    await expect(dialog).toContainText("1 monthly gift is still active in Stripe and keeps charging until cancelled there");
    await expect(dialog).toContainText("does not stop recording");
    await dialog.getByRole("button", { name: "Keep it on" }).click();
    expect((await rows(sql`select enabled from organization_feature_toggles where organization_id = ${fx.orgId}::uuid and feature_key = 'org_portal.giving'`))[0]).toMatchObject({ enabled: true });
    await page.close();
    await setFlag(sql, "org_portal.features", flags.values["org_portal.features"]!);
  });

  // -----------------------------------------------------------------------
  test("treasurer records a cash, a check and a stock gift, sees them in the list, exports a PII-free CSV, and voids one with a reason", async () => {
    await setGivingToggle(sql, fx, true);
    await setGivingRole(sql, fx, "treasurer");
    const page = await openPage(`${base()}/gifts/new`);
    await expect(page.getByRole("heading", { level: 1, name: "Record a gift" })).toBeVisible();
    await expect(page.getByText("Record only the deductible amount. Dinners, raffles and purchases are not gifts.")).toBeVisible();

    // 1. cash, into a NON-default fund
    await pickDonor(page, "Imogen", /Imogen Thackeray/);
    await fillGift(page, { fund: N.fundBuilding, amount: "125.50" });
    await page.getByRole("button", { name: "Record gift" }).click();
    await expect(page.getByTestId("gift-recorded")).toContainText("Recorded $125.50 from Imogen Thackeray.");

    // the fund survives the reset (a stack of gifts to one fund), the donor and amount do not
    await expect(page.getByLabel(/^Fund/)).toHaveValue(fx.funds.building);
    await expect(page.getByLabel(/^Amount/)).toHaveValue("");

    // 2. a check with a number
    await pickDonor(page, "Imogen", /Imogen Thackeray/);
    await fillGift(page, { fund: N.fundGeneral, amount: "75", method: "check", checkNumber: "1042" });
    await page.getByRole("button", { name: "Record gift" }).click();
    await expect(page.getByTestId("gift-recorded")).toContainText("Recorded $75.00 from Imogen Thackeray.");

    // 3. stock from a NEW donor (created with the gift)
    await page.getByRole("radio", { name: "A new donor" }).check();
    await page.getByLabel(/^Name/).fill("Barnaby Quill");
    await fillGift(page, { fund: N.fundGeneral, amount: "2000", method: "stock", stock: "20 shares of an index fund", shares: "20" });
    await page.getByRole("button", { name: "Record gift" }).click();
    await expect(page.getByTestId("gift-recorded")).toContainText("Recorded $2,000.00 from Barnaby Quill.");

    // the persisted rows, not just the DOM
    const saved = await rows<{ method: string; amount_cents: number; check_number: string | null; stock_description: string | null; fund: string; recorded_by: string; donor: string }>(sql`
      select g.method, g.amount_cents, g.check_number, g.stock_description, f.name as fund, g.recorded_by::text as recorded_by, d.display_name as donor
        from giving_gifts g join giving_funds f on f.id = g.fund_id join giving_donors d on d.id = g.donor_id
       where g.organization_id = ${fx.orgId}::uuid order by g.amount_cents`);
    expect(saved.map((r) => [r.method, r.amount_cents, r.fund, r.donor])).toEqual([
      ["check", 7_500, N.fundGeneral, N.donorImogen],
      ["cash", 12_550, N.fundBuilding, N.donorImogen],
      ["stock", 200_000, N.fundGeneral, "Barnaby Quill"],
    ]);
    expect(saved[0]!.check_number).toBe("1042");
    expect(saved[2]!.stock_description).toBe("20 shares of an index fund");
    expect(new Set(saved.map((r) => r.recorded_by))).toEqual(new Set([fx.actingUserId]));
    const audited = await rows<{ n: number }>(sql`select count(*)::int as n from audit_events where action = 'tenant.giving_gift.recorded' and metadata->>'organizationId' = ${fx.orgId}`);
    expect(audited[0]!.n).toBe(3);

    // the list
    await page.goto(`${base()}/gifts`);
    await expect(page.getByTestId("gifts-list").getByRole("link")).toHaveCount(3);
    await expect(page.getByText("$125.50")).toBeVisible();
    await expect(page.getByText("$75.00")).toBeVisible();
    await expect(page.getByText("$2,000.00")).toBeVisible();
    await expect(page.getByText(/Check #1042/)).toBeVisible();

    // the CSV: attachment, header, rows, and NO email / address / memo
    const href = await page.getByRole("link", { name: /download csv/i }).getAttribute("href");
    const csv = await page.request.get(href!);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    expect(csv.headers()["content-disposition"]).toMatch(/^attachment; filename="gifts-e2e-giving-\d+-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(csv.headers()["cache-control"]).toBe("no-store");
    const body = await csv.text();
    const [header, ...lines] = body.trim().split("\r\n");
    expect(header).toBe("gift_id,date,donor_id,donor_name,fund,source,method,status,amount,donor_covered_fee,stripe_fee,net,reversed,check_number");
    expect(lines).toHaveLength(3);
    expect(body).toContain("125.50");
    expect(body).toContain(N.fundBuilding);
    expect(body).not.toMatch(/@|example\.invalid|index fund/); // no email, no stock description / memo
    const exported = await rows<{ n: number }>(sql`select count(*)::int as n from audit_events where action = 'tenant.giving_gifts.exported' and metadata->>'organizationId' = ${fx.orgId}`);
    expect(exported[0]!.n).toBe(1);

    // void the check, with a reason
    await page.getByRole("link", { name: /Imogen Thackeray/ }).filter({ hasText: "$75.00" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "$75.00 gift" })).toBeVisible();
    await page.getByRole("button", { name: "Void gift" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("button", { name: "Void gift" })).toBeDisabled(); // a reason is required
    await dialog.getByLabel(/Reason/).fill("Keyed twice by mistake");
    await dialog.getByRole("button", { name: "Void gift" }).click();
    await expect(page.getByText("Reason: Keyed twice by mistake")).toBeVisible();
    await expect(page.getByText("Voided").first()).toBeVisible();
    const reversal = await rows<{ kind: string; amount_cents: number; reason: string }>(sql`select r.kind, r.amount_cents, r.reason from giving_gift_reversals r where r.organization_id = ${fx.orgId}::uuid`);
    expect(reversal).toEqual([{ kind: "void", amount_cents: 7_500, reason: "Keyed twice by mistake" }]);
    const gift = await rows<{ status: string; amount_cents: number }>(sql`select status, amount_cents from giving_gifts where organization_id = ${fx.orgId}::uuid and amount_cents = 7500`);
    expect(gift[0]).toMatchObject({ status: "succeeded", amount_cents: 7_500 }); // the gift itself is untouched
    await page.close();
  });

  test("a possible duplicate gift warns inline and records only when the treasurer says it is a different gift", async () => {
    await setGivingRole(sql, fx, "treasurer");
    const page = await openPage(`${base()}/gifts/new`);
    await pickDonor(page, "Imogen", /Imogen Thackeray/);
    await fillGift(page, { fund: N.fundBuilding, amount: "125.50" }); // same donor, date, amount as gift 1
    await page.getByRole("button", { name: "Record gift" }).click();
    const warning = page.getByTestId("duplicate-gift-warning");
    await expect(warning).toContainText("already recorded");
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from giving_gifts where organization_id = ${fx.orgId}::uuid and amount_cents = 12550`))[0]!.n).toBe(1);
    await warning.getByRole("button", { name: /Record it anyway/ }).click();
    await expect(page.getByTestId("gift-recorded")).toContainText("Recorded $125.50");
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from giving_gifts where organization_id = ${fx.orgId}::uuid and amount_cents = 12550`))[0]!.n).toBe(2);
    await page.close();
  });

  test("a client-side error is inline and labelled: a future date and an unusable amount record nothing", async () => {
    await setGivingRole(sql, fx, "treasurer");
    const page = await openPage(`${base()}/gifts/new`);
    await pickDonor(page, "Imogen", /Imogen Thackeray/);
    await page.getByLabel(/^Amount/).fill("$5");
    await page.getByRole("button", { name: "Record gift" }).click();
    await expect(page.getByText(/Enter an amount like 25 or 25\.00/)).toBeVisible();
    await expect(page.getByLabel(/^Amount/)).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel(/^Amount/).fill("5");
    await page.getByLabel(/Date received/).fill("2099-01-01");
    await page.getByRole("button", { name: "Record gift" }).click();
    await expect(page.getByText(/That date can.t be recorded/)).toBeVisible();
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from giving_gifts where organization_id = ${fx.orgId}::uuid and amount_cents = 500`))[0]!.n).toBe(0);
    await page.close();
  });

  // -----------------------------------------------------------------------
  test("a recorder sees the reduced variant: own entries only, no ledger, no CSV, no funds, names-only donors", async () => {
    await setGivingRole(sql, fx, "recorder");
    const page = await openPage(`${base()}/gifts`);
    await expect(page.getByRole("heading", { level: 1, name: "Your recent entries" })).toBeVisible();
    await expect(page.getByRole("link", { name: /download csv/i })).toHaveCount(0);
    await expect(page.locator("form[method=get]")).toHaveCount(0); // no ledger filters
    // the actor's own earlier entries are listed - and another user's entry never is
    await addForeignEntry(sql, fx, 9_900);
    await page.reload();
    await expect(page.getByTestId("recent-entries")).toContainText("$125.50");
    await expect(page.getByTestId("recent-entries")).not.toContainText("$99.00");

    // the recorder records one, and sees it - with a void control
    await page.goto(`${base()}/gifts/new`);
    await pickDonor(page, "Imogen", /Imogen Thackeray/);
    await fillGift(page, { fund: N.fundGeneral, amount: "31" });
    await page.getByRole("button", { name: "Record gift" }).click();
    await expect(page.getByTestId("gift-recorded")).toContainText("Recorded $31.00");
    await expect(page.getByTestId("recent-entries")).toContainText("$31.00");
    // one Void control per live entry (the earlier voided check has none)
    await expect(page.getByTestId("recent-entries").getByRole("button", { name: "Void gift" })).toHaveCount(4);
    await expect(page.getByTestId("recent-entries").getByText("Voided")).toHaveCount(1);

    // Funds, Settings, Team and the gift ledger detail are not theirs
    for (const route of ["/funds", "/settings", "/team"]) {
      await page.goto(`${base()}${route}`);
      await expect(page.getByText(/isn.t available to your account at/), route).toBeVisible();
    }
    await page.goto(`${base()}/gifts/${fx.funds.general}`);
    await expect(page.getByText(/Gifts isn.t available to your account/)).toBeVisible();
    expect((await page.request.get(`${base()}/gifts/export`)).status()).toBe(403);

    // Donors: a name search, names only
    await page.goto(`${base()}/donors?q=Imogen`);
    await expect(page.getByTestId("donors-list")).toContainText("Imogen Thackeray");
    expect(await page.locator("body").innerText()).not.toMatch(/example\.invalid/);
    await page.getByRole("link", { name: "Imogen Thackeray" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Imogen Thackeray" })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/example\.invalid|gifts/i);
    await page.close();
  });

  test("the member-link proposal: a recorder confirms it in a dialog that names the member, and the link is audited", async () => {
    await setGivingRole(sql, fx, "recorder");
    const page = await openPage(`${base()}/donors`);
    await expect(page.getByRole("heading", { name: "Member suggestions" })).toBeVisible();
    await expect(page.getByText(`Looks like ${fx.proposedPersonName}`)).toBeVisible();
    await page.getByRole("link", { name: N.donorMatched }).click();
    await expect(page.getByText(new RegExp(`Looks like ${fx.proposedPersonName}`))).toBeVisible();

    await page.getByRole("button", { name: `Link to ${fx.proposedPersonName}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`Link this donor to ${fx.proposedPersonName}?`);
    await expect(dialog).toContainText("will be able to see this donor");
    await dialog.getByRole("button", { name: "Yes, link them" }).click();
    await expect(page.getByTestId("linked-member")).toHaveText(fx.proposedPersonName);

    const [donor] = await rows<{ linked_membership_id: string | null; link_source: string }>(sql`select linked_membership_id, link_source from giving_donors where id = ${fx.donors.matched}::uuid`);
    expect(donor!.link_source).toBe("recorder_confirmed");
    expect(donor!.linked_membership_id).toBeTruthy();
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from audit_events where action = 'tenant.giving_donor.link_confirmed' and metadata->>'organizationId' = ${fx.orgId}`))[0]!.n).toBe(1);

    // and the suggestion is gone from the list
    await page.goto(`${base()}/donors`);
    await expect(page.getByRole("heading", { name: "Member suggestions" })).toHaveCount(0);
    await page.close();
  });

  // -----------------------------------------------------------------------
  test("a manager runs funds, statement details and the giving team (and a manage-only holder cannot reach the ledger)", async () => {
    await setGivingRole(sql, fx, "treasurer");

    // -- funds: add, retire (dialog), reactivate
    let page = await openPage(`${base()}/funds`);
    await expect(page.getByRole("heading", { name: "Active funds" })).toBeVisible();
    await page.getByLabel(/Fund name/).last().fill("E2E Missions Fund");
    await page.getByRole("button", { name: "Add fund" }).click();
    await expect(page.getByText("Fund added.")).toBeVisible();
    const missions = page.locator("li", { has: page.getByRole("heading", { name: "E2E Missions Fund" }) });
    await missions.getByRole("button", { name: "Retire" }).click();
    await page.getByRole("button", { name: "Retire fund" }).click();
    await expect(page.getByRole("heading", { name: "Retired funds" })).toBeVisible();
    await page.locator("li", { has: page.getByRole("heading", { name: "E2E Missions Fund" }) }).getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByText(/is active again/)).toBeVisible();
    // a duplicate name is an inline error
    await page.getByLabel(/Fund name/).last().fill("e2e missions fund");
    await page.getByRole("button", { name: "Add fund" }).click();
    await expect(page.getByText("A fund with that name already exists").first()).toBeVisible();
    for (const action of ["created", "retired", "reactivated"]) {
      expect((await rows<{ n: number }>(sql`select count(*)::int as n from audit_events where action = ${`tenant.giving_fund.${action}`} and metadata->>'organizationId' = ${fx.orgId}`))[0]!.n).toBe(1);
    }

    // -- settings: blockers named, then cleared by saving
    await page.goto(`${base()}/settings`);
    await expect(page.getByTestId("statement-blockers")).toContainText("legal name of the church");
    await page.getByLabel(/Legal name of the church/).fill("E2E Giving Fixture Presbyterian Church");
    await page.getByLabel(/Street address/).fill("1 Mill Road");
    await page.getByLabel(/^City/).fill("Dover");
    await page.getByLabel(/^State/).fill("DE");
    await page.getByLabel(/^ZIP/).fill("19901");
    await page.getByRole("button", { name: "Save statement details" }).click();
    await expect(page.getByText("Statement details saved.")).toBeVisible();
    await expect(page.getByTestId("statement-ready")).toBeVisible();
    const [audited] = await rows<{ metadata: { fields: string[] } }>(sql`select metadata from audit_events where action = 'tenant.giving_settings.changed' and metadata->>'organizationId' = ${fx.orgId}`);
    expect(audited!.metadata.fields).toContain("doneeLegalName");
    expect(JSON.stringify(audited!.metadata)).not.toContain("Presbyterian Church");

    // -- team: give the recorder role to another member, then end it
    await page.goto(`${base()}/team`);
    // the church has no role built from the Giving Recorder template yet: set it up (P3-18), then give it
    await page.getByRole("button", { name: "Set up the Giving Recorder role" }).click();
    await expect(page.getByText("Role set up.")).toBeVisible();
    await page.locator("#team-role").selectOption({ label: "Giving Recorder (record gifts)" });
    await page.locator("#team-person").selectOption({ label: fx.otherPersonName });
    await page.getByRole("button", { name: "Give role" }).click();
    await expect(page.getByText("Role given.")).toBeVisible();
    const entry = page.getByTestId("team-list").locator("li", { hasText: fx.otherPersonName });
    await expect(entry).toContainText("Record gifts");
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from audit_events where action = 'tenant.role.granted' and metadata->>'path' = 'giving_team' and metadata->>'organizationId' = ${fx.orgId}`))[0]!.n).toBe(1);
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from audit_events where action = 'tenant.role_definition.adopted_from_template' and metadata->>'path' = 'giving_team' and metadata->>'organizationId' = ${fx.orgId}`))[0]!.n).toBe(1);
    await entry.getByRole("button", { name: "End this role" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "End role" }).click();
    await expect(page.getByText(`${fx.otherPersonName} no longer has this role.`)).toBeVisible();

    // the last manager cannot end their own manage grant
    await page.reload();
    const mine = page.getByTestId("team-list").locator("li", { hasText: `${N.actingFirst} ${N.actingLast}` });
    await mine.getByRole("button", { name: "End this role" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "End role" }).click();
    await expect(page.getByText(/no one able to manage giving/)).toBeVisible();
    await page.close();

    // -- a manage-only holder reaches Funds but not the ledger or the donor list
    await setGivingRole(sql, fx, "manager");
    page = await openPage(`${base()}/funds`);
    await expect(page.getByRole("heading", { name: "Active funds" })).toBeVisible();
    await page.goto(`${base()}/gifts`);
    await expect(page.getByText(/Gifts isn.t available to your account/)).toBeVisible();
    await page.goto(`${base()}/donors`);
    await expect(page.getByText(/Donors isn.t available to your account/)).toBeVisible();
    await page.close();
  });

  // -----------------------------------------------------------------------
  test("a donor merge names both donors in a dialog and moves the gifts' reading to the survivor", async () => {
    await setGivingRole(sql, fx, "treasurer");
    const page = await openPage(`${base()}/donors/${fx.donors.matched}`);
    await page.getByRole("button", { name: "Merge into another donor" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`Merge ${N.donorMatched} into another donor?`);
    await dialog.getByRole("searchbox").fill("Imogen");
    await dialog.getByRole("button", { name: /Imogen Thackeray/ }).click();
    await expect(dialog).toContainText(`Merge ${N.donorMatched} into ${N.donorImogen}?`);
    await dialog.getByRole("button", { name: "Merge donors" }).click();
    await page.waitForURL(new RegExp(`/donors/${fx.donors.imogen}$`));
    const [merged] = await rows<{ merged_into_id: string | null; linked_membership_id: string | null }>(sql`select merged_into_id, linked_membership_id from giving_donors where id = ${fx.donors.matched}::uuid`);
    expect(merged).toMatchObject({ merged_into_id: fx.donors.imogen, linked_membership_id: null });
    // the survivor inherited the link the merged donor held
    const [survivor] = await rows<{ linked_membership_id: string | null }>(sql`select linked_membership_id from giving_donors where id = ${fx.donors.imogen}::uuid`);
    expect(survivor!.linked_membership_id).toBeTruthy();
    // the merged donor's own URL now goes to the survivor
    await page.goto(`${base()}/donors/${fx.donors.matched}`);
    await page.waitForURL(new RegExp(`/donors/${fx.donors.imogen}$`));
    await page.close();
  });

  // -----------------------------------------------------------------------
  test("360 px: the overview, gifts list, new-gift form, donor page and team page fit the phone with 44 px controls (screenshots read by a human)", async () => {
    await setGivingRole(sql, fx, "treasurer");
    const pages: Array<[string, string]> = [
      ["overview", base()],
      ["gifts", `${base()}/gifts`],
      ["new-gift", `${base()}/gifts/new`],
      ["donor", `${base()}/donors/${fx.donors.imogen}`],
      ["team", `${base()}/team`],
    ];
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 360, height: 740 });
    for (const [name, path] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name} has horizontal scroll`).toBeLessThanOrEqual(1);
      const short = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("main a[data-slot=button], main button, main input[type=submit]"))
          .filter((el) => el.offsetParent !== null)
          .map((el) => ({ text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30), h: Math.round(el.getBoundingClientRect().height) }))
          .filter((c) => c.h > 0 && c.h < 40),
      );
      expect(short, `${name} has controls shorter than 40px`).toEqual([]);
      await page.screenshot({ path: `test-results/giving-360/${name}.png`, fullPage: true });
    }
    await page.close();
  });
});

// ---------------------------------------------------------------------------
test.describe("Giving admin - the 2FA gate (R4) and the four-way miss", () => {
  test.setTimeout(60_000);
  const routes = (f: GivingFixture) => [
    "", "/funds", "/gifts", "/gifts/new", `/gifts/${f.funds.general}`, "/donors", `/donors/${f.donors.imogen}`, "/settings", "/team", "/statements",
  ];

  test.beforeAll(async () => {
    sql = platformSql("giving-admin.spec/gate");
    fx = await setupGivingFixture(sql);
    await setGivingToggle(sql, fx, true);
    await setGivingRole(sql, fx, "treasurer");
  });
  test.afterAll(async () => {
    if (fx) await removeGivingFixture(sql, fx);
  });

  test.describe("an MFA-enrolled giving-key holder who has NOT verified TOTP", () => {
    test.use({ storageState: storageStatePath("mfa-enrolled") });

    test("is redirected to /totp with the page they asked for as the callback, on every admin route", async ({ page }) => {
      for (const route of routes(fx)) {
        const path = `/o/${fx.slug}/admin/giving${route}`;
        await page.goto(path);
        await expect(page, path).toHaveURL(new RegExp(`/totp\\?.*callbackUrl=${encodeURIComponent(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
        await expect(page.getByRole("heading", { name: /two-factor authentication/i })).toBeVisible();
      }
      // the CSV never streams to an unverified session either
      const csv = await page.request.get(`/o/${fx.slug}/admin/giving/gifts/export`, { maxRedirects: 0 });
      expect([307, 308, 302]).toContain(csv.status());
      expect(csv.headers()["content-type"] ?? "").not.toContain("text/csv");
      // ...nor does a statement PDF
      for (const route of ["/statements/print?year=2027", `/statements/${fx.funds.general}/download`]) {
        const res = await page.request.get(`/o/${fx.slug}/admin/giving${route}`, { maxRedirects: 0 });
        expect([307, 308, 302], route).toContain(res.status());
        expect(res.headers()["content-type"] ?? "", route).not.toContain("application/pdf");
      }
    });
  });

  test.describe("a platform admin who is not a member of the congregation", () => {
    test.use({ storageState: storageStatePath("admin") });

    test("gets the shared access-denied page on every giving route (no platform branch) and a 403 on the CSV", async ({ page }) => {
      expect(E2E_USERS.admin.roleName).toBe("admin");
      for (const route of routes(fx)) {
        const path = `/o/${fx.slug}/admin/giving${route}`;
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(200);
        await expect(page.getByText(new RegExp(`you don.t have access to ${N.org}`, "i")), path).toBeVisible();
        await expect(page.getByTestId("gifts-list"), path).toHaveCount(0);
      }
      expect((await page.request.get(`/o/${fx.slug}/admin/giving/gifts/export`)).status()).toBe(403);
      // no platform branch on the statement routes either: not a member, no PDF
      expect((await page.request.get(`/o/${fx.slug}/admin/giving/statements/print?year=2027`)).status()).toBe(403);
      expect((await page.request.get(`/o/${fx.slug}/admin/giving/statements/${fx.funds.general}/download`)).status()).toBe(403);
    });
  });
});
