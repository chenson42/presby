/**
 * reimbursement-treasurer-ui.spec.ts - the TREASURER side of reimbursements against
 * a running server (Treasury Increment 1, Batch 6; docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 "Component / Page Plan", Copy C7 to C9, the Batch 4 amendment S1
 * to S7 and X3, X6, X7).
 *
 * This is the treasurer-UI slice. What stays in Batch 7's four specs, named where
 * it would go: the signed-out MFA deep link through /signin and /totp to a request,
 * the role-bundle test (a treasurer made by the real invitation accept), the CSV
 * export's bytes, the Features-page toggle, and any receipt (Batch 2b). The member
 * side is `reimbursement-member.spec.ts`.
 *
 * Everything lives in a THROWAWAY congregation (`e2e-reimbt-<stamp>`) removed in
 * afterAll by deleting that organization (the cascade takes every reimbursement
 * row). Invented names, `.invalid` addresses, no real data.
 *
 * Cast:
 *   - Octavia (the `mfa-enrolled` user): the treasurer. Holds the four reimbursement
 *     keys through a custom role, so every page needs the real TOTP step, done once
 *     (`verifiedContext`) and reused.
 *   - Tamsin (the `member` user): the requester. Cassius (`presbytery-nogrant`): chair of
 *     the Property Committee. Wren: a throwaway user who can become the second payer
 *     through the Treasury team page, never signed in as.
 *
 * REQUESTS ARE SEEDED THROUGH THE DEFINERS (save_draft, submit, approve, waive,
 * record_payment) in one `DO` block per request, with the organization set the way
 * `withOrgContext` sets it: the same code the app runs, no hand-written rows that
 * could skip a trigger. The fixture helpers are inline (the Rule 16
 * `e2e/support/reimbursement-fixture` is Batch 7's); the id range is the design's.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, withDbRetry, type Sql } from "./support/db";
import { verifiedContext } from "./support/giving-fixture";
import { E2E_USERS, storageStatePath } from "./support/users";

const TOGGLE = "org_portal.reimbursement";
const P = "e2e96000-0000-4000-8000-";
const pid = (n: number) => `${P}${String(n).padStart(12, "0")}`;

const NAMES = {
  org: "E2E Treasurer Fixture Church",
  property: "Property Committee",
  worship: "Worship Committee",
  supplies: "Supplies",
  treasurer: "Octavia Vance",
  requester: "Tamsin Brightwater",
  secondPayer: "Wren Podmore",
  payerRole: "E2E Payer",
} as const;

const LONG_PURPOSE = "Unbroken".repeat(50); // 400 characters, no space
const LONG_VENDOR = "WaterlooAndWestminsterWholesaleFurnitureAndFixtureSupplyCompanyIncorporated"; // 74 characters, no space

interface Fixture {
  orgId: string;
  slug: string;
  groupProperty: string;
  groupWorship: string;
  categorySupplies: string;
  treasurerUser: string;
  treasurerPerson: string;
  requesterUser: string;
  requesterPerson: string;
  chairUser: string;
  chairPerson: string;
  secondUser: string;
  secondPerson: string;
  treasurerRole: string;
  payerRole: string;
}

let sql: Sql;
let fx: Fixture;
let treasurerContext: BrowserContext;
const ids: Record<string, string> = {};

const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];

async function userIdByEmail(email: string): Promise<string> {
  const found = await rows<{ id: string }>(sql`select id from users where email = ${email}`);
  if (!found[0]) throw new Error(`[reimbursement-treasurer-ui] no user row for ${email}; globalSetup must run first`);
  return found[0].id;
}

async function personIdForUser(userId: string): Promise<string> {
  const found = await rows<{ id: string }>(sql`select id from people where user_id = ${userId}::uuid`);
  if (!found[0]) throw new Error("[reimbursement-treasurer-ui] the seeded fixture user has no person row");
  return found[0].id;
}

async function addMembership(orgId: string, personId: string, engagement: "regular" | "visitor", roll: "active" | null) {
  await withDbRetry("add membership", () => sql`
    with armed as (select set_config('app.person_claim_authorized', ${personId}, true))
    insert into memberships (organization_id, person_id, engagement_status, current_roll)
    select ${orgId}::uuid, ${personId}::uuid, ${engagement}, ${roll} from armed
    on conflict (person_id, organization_id) do update
      set engagement_status = excluded.engagement_status, current_roll = excluded.current_roll`);
}

async function removeOrg(orgId: string) {
  try {
    await withDbRetry(`delete treasurer-ui org ${orgId}`, async () => {
      await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
      try {
        await sql`delete from organizations where id = ${orgId}::uuid`;
      } finally {
        await sql`alter table group_memberships enable trigger group_memberships_reject_derived`;
      }
    });
  } finally {
    await withDbRetry("re-enable roster trigger", () => sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
  }
}

async function removeStale() {
  const stale = await rows<{ id: string }>(sql`select id from organizations where slug ~ '^e2e-reimbt-[0-9]+$'`);
  for (const { id } of stale) await removeOrg(id);
  await withDbRetry("delete fixture people", () => sql`delete from people where id in (${pid(40)}::uuid, ${pid(41)}::uuid, ${pid(42)}::uuid)`);
  await withDbRetry("delete fixture users", () => sql`delete from users where email = 'e2e-reimbt-wren@presby.invalid'`);
}

const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidLit = (value: string) => {
  if (!UUID.test(value)) throw new Error(`not a uuid: ${value}`);
  return `'${value}'::uuid`;
};

interface SeedSpec {
  key: string;
  group: string;
  cents: number;
  purpose: string;
  kind?: "reimburse" | "vendor";
  vendor?: string;
  daysAgo?: number;
  category?: string | null;
  /** submitted | approved (by the chair) | paid (approved, waived, paid by the treasurer). */
  upTo: "submitted" | "approved" | "waived" | "paid";
  /** A payment reference for `paid`. */
  reference?: string;
}

/** One request in the state the spec needs, made by the definers themselves. Returns its id. */
async function seedRequest(spec: SeedSpec): Promise<string> {
  const kind = spec.kind ?? "reimburse";
  const requester = uuidLit(fx.requesterUser);
  const chair = uuidLit(fx.chairUser);
  const treasurer = uuidLit(fx.treasurerUser);
  const days = spec.daysAgo ?? 3;
  const steps = [
    `select s.request_id, s.revision into v_rid, v_rev from presby_reimbursement_save_draft(
       ${lit(spec.key)}, ${lit(kind)}, ${uuidLit(spec.group)}, null, ${spec.vendor ? lit(spec.vendor) : "null"}, ${spec.cents},
       ((now() at time zone 'America/New_York')::date - ${days}), ${lit(spec.purpose)},
       ${spec.category === null ? "null" : uuidLit(spec.category ?? fx.categorySupplies)}, null, true, ${requester}) s;`,
    `select s.revision into v_rev from presby_reimbursement_submit(v_rid, v_rev, ${requester}) s;`,
  ];
  if (spec.upTo !== "submitted") {
    steps.push(`perform * from presby_reimbursement_approve(v_rid, v_rev, 'seat', ${chair});`);
  }
  if (spec.upTo === "waived" || spec.upTo === "paid") {
    steps.push(`perform * from presby_reimbursement_waive_receipt(v_rid, null, ${treasurer});`);
  }
  if (spec.upTo === "paid") {
    steps.push(
      `perform * from presby_reimbursement_record_payment(v_rid, 'check', ${lit(spec.reference ?? "1001")},
         (now() at time zone 'America/New_York')::date, null, ${treasurer});`,
    );
  }
  await withDbRetry(`seed request ${spec.key}`, () =>
    sql.query(`
      do $do$
      declare v_rid uuid; v_rev integer;
      begin
        perform set_config('app.current_org_id', ${lit(fx.orgId)}, true);
        ${steps.join("\n        ")}
      end $do$`),
  );
  const found = await rows<{ id: string }>(
    sql`select id from reimbursement_requests where organization_id = ${fx.orgId}::uuid and client_key = ${spec.key}`,
  );
  if (!found[0]) throw new Error(`[reimbursement-treasurer-ui] the seed for ${spec.key} produced no request`);
  return found[0].id;
}

async function statusOf(requestId: string): Promise<string> {
  return (await rows<{ status: string }>(sql`select status from reimbursement_requests where id = ${requestId}::uuid`))[0]!.status;
}

async function setupFixture(stamp = Date.now()): Promise<Fixture> {
  await removeStale();
  const slug = `e2e-reimbt-${stamp}`;
  const orgId = `e2e96001-0000-4000-8000-${String(stamp % 1_000_000_000_000).padStart(12, "0")}`;
  const treasurerUser = await userIdByEmail(E2E_USERS["mfa-enrolled"].email);
  const requesterUser = await userIdByEmail(E2E_USERS.member.email);
  const chairUser = await userIdByEmail(E2E_USERS["presbytery-nogrant"].email);
  const requesterPerson = pid(2);
  const treasurerPerson = pid(40);
  const secondPerson = pid(41);
  const chairPerson = await personIdForUser(chairUser);
  const groupProperty = pid(10);
  const groupWorship = pid(11);
  const categorySupplies = pid(20);
  const treasurerRole = pid(30);
  const payerRole = pid(31);

  await withDbRetry("clear fixture people", () => sql`delete from people where id in (${requesterPerson}::uuid, ${treasurerPerson}::uuid, ${secondPerson}::uuid)`);
  const second = await rows<{ id: string }>(
    sql`insert into users (email, name) values ('e2e-reimbt-wren@presby.invalid', 'Wren Podmore') returning id`,
  );
  const secondUser = second[0]!.id;

  await sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${orgId}::uuid, 'congregation', ${NAMES.org}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`;
  await sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`;
  await sql`
    insert into groups (id, organization_id, group_type_id, name, membership_source)
    values (${groupProperty}::uuid, ${orgId}::uuid, (select id from group_types where key = 'roster'), ${NAMES.property}, 'managed'),
           (${groupWorship}::uuid, ${orgId}::uuid, (select id from group_types where key = 'roster'), ${NAMES.worship}, 'managed')`;
  await sql`
    insert into people (id, user_id, first_name, last_name, deletable_until)
    values (${requesterPerson}::uuid, ${requesterUser}::uuid, 'Tamsin', 'Brightwater', now() + interval '3 hours'),
           (${treasurerPerson}::uuid, ${treasurerUser}::uuid, 'Octavia', 'Vance', now() + interval '3 hours'),
           (${secondPerson}::uuid, ${secondUser}::uuid, 'Wren', 'Podmore', now() + interval '3 hours')`;
  for (const person of [requesterPerson, treasurerPerson, secondPerson, chairPerson]) await addMembership(orgId, person, "regular", "active");

  await sql`
    insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on)
    values (${orgId}::uuid, ${groupProperty}::uuid, ${chairPerson}::uuid, 'chair', 'managed', date '2020-01-01')`;
  await sql`
    insert into reimbursement_chargeable_groups (organization_id, group_id, created_by_user)
    values (${orgId}::uuid, ${groupProperty}::uuid, ${chairUser}::uuid), (${orgId}::uuid, ${groupWorship}::uuid, ${chairUser}::uuid)`;
  await sql`
    insert into reimbursement_categories (id, organization_id, name, created_by_user)
    values (${categorySupplies}::uuid, ${orgId}::uuid, ${NAMES.supplies}, ${chairUser}::uuid)`;

  // The treasurer: the four keys. The payer role (pay only) is what the Treasury team page grants to Wren.
  await sql`
    insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
    values (${treasurerRole}::uuid, ${orgId}::uuid, 'e2e_reimb_treasurer', 'E2E Treasurer', 'custom', false),
           (${payerRole}::uuid, ${orgId}::uuid, 'e2e_reimb_payer', ${NAMES.payerRole}, 'custom', false)`;
  await sql`
    insert into app_role_permissions (role_id, permission_key)
    values (${treasurerRole}::uuid, 'reimbursement.request_for_others'), (${treasurerRole}::uuid, 'reimbursement.view'),
           (${treasurerRole}::uuid, 'reimbursement.pay'), (${treasurerRole}::uuid, 'reimbursement.manage'),
           (${payerRole}::uuid, 'reimbursement.pay')`;
  await sql`
    insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
    values (${orgId}::uuid, ${treasurerRole}::uuid, ${treasurerPerson}::uuid, date '2020-01-01', ${treasurerUser}::uuid)`;
  await withDbRetry("set toggle", () => sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${orgId}::uuid, ${TOGGLE}, true)
    on conflict (organization_id, feature_key) do update set enabled = true`);

  return {
    orgId, slug, groupProperty, groupWorship, categorySupplies, treasurerUser, treasurerPerson, requesterUser, requesterPerson,
    chairUser, chairPerson, secondUser, secondPerson, treasurerRole, payerRole,
  };
}

const base = () => `/o/${fx.slug}/admin/reimbursements`;

async function treasurerPage(width = 1280, height = 900): Promise<Page> {
  const page = await treasurerContext.newPage();
  await page.setViewportSize({ width, height });
  return page;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

/**
 * React has attached to the page: a button carries its React props. A page with a form also has a
 * HydrationGate, which reports the same moment with `aria-busy`; one without (a dialog trigger only)
 * has nothing else to wait on, and a click before this would do nothing.
 */
async function waitHydrated(page: Page) {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some((b) => Object.keys(b).some((k) => k.startsWith("__reactProps$"))),
  );
  const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
  if ((await gate.count()) > 0) await expect(gate).not.toHaveAttribute("aria-busy", "true");
}

async function shot(page: Page, folder: "360" | "1280", name: string, fullPage = true) {
  await page.screenshot({ path: `test-results/reimbursement-treasurer-${folder}/${name}.png`, fullPage });
}

async function tallEnough(page: Page, testId: string, width: number) {
  const button = page.getByTestId(testId);
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  expect(box.height, testId).toBeGreaterThanOrEqual(44);
  expect(box.x, testId).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, testId).toBeLessThanOrEqual(width);
}

async function orgToday(): Promise<string> {
  return (await rows<{ d: string }>(sql`select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d`))[0]!.d;
}

async function contextFor(browser: Browser, role: "member" | "presbytery-nogrant", width = 360, height = 740) {
  return browser.newContext({ storageState: storageStatePath(role), viewport: { width, height } });
}

test.describe.configure({ mode: "serial" });

test.describe("Reimbursements, treasurer side", () => {
  test.setTimeout(180_000);

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("reimbursement-treasurer-ui.spec");
    fx = await setupFixture();
    ids.claim = await seedRequest({ key: "tui-claim-0001", group: fx.groupProperty, cents: 4250, purpose: "Folding tables for the fellowship hall", upTo: "approved" });
    ids.payable = await seedRequest({ key: "tui-payable-001", group: fx.groupProperty, cents: 1999, purpose: "Hymnal repair kit", upTo: "waived" });
    ids.override = await seedRequest({ key: "tui-override-01", group: fx.groupWorship, cents: 7500, purpose: "Choir folders", upTo: "submitted" });
    ids.progress = await seedRequest({ key: "tui-progress-01", group: fx.groupProperty, cents: 3000, purpose: "Candles for Advent", upTo: "submitted" });
    ids.paid = await seedRequest({
      key: "tui-paid-000001", group: fx.groupProperty, cents: 12000, purpose: "New hose bib", kind: "vendor", vendor: "Harbor Hardware",
      upTo: "paid", reference: "1001",
    });
    ids.long = await seedRequest({
      key: "tui-long-000001", group: fx.groupProperty, cents: 500, purpose: LONG_PURPOSE, kind: "vendor", vendor: LONG_VENDOR, upTo: "submitted",
    });
    treasurerContext = await verifiedContext(browser, `${base()}`);
  });

  test.afterAll(async () => {
    await treasurerContext?.close().catch(() => undefined);
    if (!fx) return; // setup failed before the fixture existed; the next run's sweep clears any leftover
    await removeOrg(fx.orgId);
    await withDbRetry("delete fixture people", () => sql`delete from people where id in (${pid(2)}::uuid, ${pid(40)}::uuid, ${pid(41)}::uuid)`);
    await withDbRetry("delete fixture user", () => sql`delete from users where id = ${fx.secondUser}::uuid`);
  });

  // -------------------------------------------------------------------------
  test("the queue at 360 px: the five tabs with their counts, cards, the filter bar, Export CSV, no sideways scroll", async () => {
    const page = await treasurerPage(360, 740);
    await page.goto(base());
    await expect(page.getByRole("heading", { level: 1, name: "Reimbursement requests" })).toBeVisible();
    const tabs = page.getByTestId("queue-tabs");
    await expect(tabs.getByRole("link", { name: "Waiting for payment (2)" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Needs treasurer approval (1)" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "In progress (2)" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Paid" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "All" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: /^Waiting for payment/ })).toHaveAttribute("aria-current", "page");
    for (const tab of ["pay", "override", "progress", "paid", "all"]) await tallEnough(page, `queue-tab-${tab}`, 360);

    // The Waiting for payment tab: the two approved requests, as cards, each one link.
    const queueRows = page.getByTestId("queue-row");
    await expect(queueRows).toHaveCount(2);
    await expect(queueRows.first()).toContainText("Charged to");
    await expect(queueRows.first()).toContainText("Approved");
    const box = (await queueRows.first().boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);

    await expect(page.getByLabel("Charged to")).toBeVisible();
    await expect(page.getByLabel("Submitted from")).toBeVisible();
    await expect(page.getByLabel("Submitted to")).toBeVisible();
    await expect(page.getByText("Dates are the day each request was last submitted.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Filter" })).toBeVisible();
    await expect(page.getByTestId("export-csv")).toHaveAttribute("href", `${base()}/export?status=approved`);
    // The treasurer holds manage, so Settings and the Treasury team are offered.
    await expect(page.getByRole("link", { name: "Reimbursement settings" })).toHaveAttribute("href", `${base()}/settings`);
    await expect(page.getByRole("link", { name: "Treasury team" })).toHaveAttribute("href", `${base()}/team`);
    // Someone holds pay, so no banner.
    await expect(page.getByTestId("no-pay-holder")).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "360", "queue-pay");

    await tabs.getByRole("link", { name: "Needs treasurer approval (1)" }).click();
    await expect(page.getByTestId("override-tab-note")).toHaveText("No one in the group is able to approve these, so they wait for a treasurer.");
    await expect(page.getByTestId("queue-row")).toHaveCount(1);
    await noHorizontalScroll(page);
    await shot(page, "360", "queue-override");

    await page.getByTestId("queue-tab-paid").click();
    await expect(page.getByTestId("queue-row")).toHaveCount(1);
    await expect(page.getByTestId("queue-row")).toContainText("Harbor Hardware");
    await expect(page.getByTestId("export-csv")).toHaveAttribute("href", `${base()}/export?status=paid`);

    await page.getByTestId("queue-tab-all").click();
    await expect(page.getByTestId("queue-row")).toHaveCount(6);
    // An unbroken 400-character purpose and a long vendor name never scroll the page sideways.
    await noHorizontalScroll(page);
    await shot(page, "360", "queue-all-long-values");
    await page.close();
  });

  test("filters: a group narrows the list, a date range with nothing says so, Clear returns; junk in the URL is dropped; a page past the last goes to page 1", async () => {
    const page = await treasurerPage(1280, 900);
    await page.goto(`${base()}?tab=all`);
    await expect(page.getByTestId("queue-row")).toHaveCount(6);
    // Worship has only the override request.
    await page.getByLabel("Charged to").selectOption({ label: NAMES.worship });
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(new RegExp(`tab=all&group=${fx.groupWorship}`));
    await expect(page.getByTestId("queue-row")).toHaveCount(1);
    await expect(page.getByTestId("queue-row")).toContainText(`Charged to ${NAMES.worship}`);
    await expect(page.getByTestId("export-note")).toHaveText("The file covers every group, not only the one chosen under Charged to.");
    // The group options are the groups that appear on requests (Property, Worship), by name.
    const options = await page.getByLabel("Charged to").locator("option").allTextContents();
    expect(options).toEqual(["All groups", NAMES.property, NAMES.worship]);
    // A date range in the far past matches nothing: the filtered sentence, not the tab's.
    await page.getByLabel("Submitted from").fill("2001-01-01");
    await page.getByLabel("Submitted to").fill("2001-01-31");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByTestId("queue-empty")).toHaveText("No requests match those filters.");
    await expect(page.getByTestId("export-csv")).toHaveAttribute("href", `${base()}/export?from=2001-01-01&to=2001-01-31`);
    await page.getByRole("link", { name: "Clear" }).click();
    await expect(page).toHaveURL(`${base()}?tab=all`);
    await expect(page.getByTestId("queue-row")).toHaveCount(6);

    // X7: junk is dropped and the bar shows what was applied.
    await page.goto(`${base()}?tab=bogus&from=2026-13-45&group=nope&to=x`);
    await expect(page.getByLabel("Submitted from")).toHaveValue("");
    await expect(page.getByLabel("Charged to")).toHaveValue("");
    await expect(page.getByTestId("queue-tab-pay")).toHaveAttribute("aria-current", "page");
    // X6: a page past the last is page 1 of the same filters, never "page 2 of 0".
    await page.goto(`${base()}?tab=paid&page=9`);
    await expect(page).toHaveURL(`${base()}?tab=paid`);
    await expect(page.getByText(/of 0/)).toHaveCount(0);
    // An empty tab says its own sentence.
    await page.goto(`${base()}?tab=paid&to=2001-01-01`);
    await expect(page.getByTestId("queue-empty")).toHaveText("No requests match those filters.");
    await page.close();
  });

  // -------------------------------------------------------------------------
  test("a request with no receipt: the payment area says to add or waive one; Waive receipt then unlocks the form", async () => {
    const page = await treasurerPage(360, 740);
    await page.goto(`${base()}/${ids.claim}`);
    await expect(page.getByRole("heading", { level: 1, name: "$42.50" })).toBeVisible();
    await expect(page.getByTestId("request-banner")).toContainText("Waiting for payment.");
    await expect(page.getByTestId("approved-by")).toContainText("Approved by Cassius");
    await expect(page.getByTestId("payment-block")).toHaveText("Add a receipt or waive it before paying.");
    await expect(page.getByTestId("payment-form")).toHaveCount(0);
    await expect(page.getByTestId("request-receipts")).toContainText("The requester says they can't attach a receipt.");
    for (const testId of ["waive-open", "treasury-send-back-open", "void-open", "note-open"]) await tallEnough(page, testId, 360);
    await noHorizontalScroll(page);
    await shot(page, "360", "detail-no-receipt");

    await page.getByTestId("waive-open").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Waive the receipt?")).toBeVisible();
    await expect(dialog).toContainText("The request can be paid without one. This is recorded.");
    await shot(page, "360", "dialog-waive", false);
    // The note is optional: confirm with it empty.
    await dialog.getByTestId("waive-confirm").click();
    await expect(page.getByText("Receipt waived.").first()).toBeVisible();
    await expect(page.getByTestId("payment-form")).toBeVisible();
    await expect(page.getByTestId("request-receipts")).toContainText("Receipt waived.");
    await page.close();
  });

  test("Record payment: a check needs its number, the date has bounds, then the payment is recorded and shown; Reverse needs a reason", async () => {
    const page = await treasurerPage(360, 740);
    await page.goto(`${base()}/${ids.claim}`);
    await waitHydrated(page);
    const form = page.getByTestId("payment-form");
    await expect(form.getByLabel("How was it paid?")).toHaveValue("check");
    await expect(form.getByLabel("Check number")).toBeVisible();
    await expect(form.getByLabel("Date paid")).toHaveValue(await orgToday());
    await expect(page.getByText("PresbyPortal records the payment. It doesn't send money or ask for bank details.")).toBeVisible();
    await shot(page, "360", "payment-form");

    await page.getByTestId("payment-submit").click();
    await expect(page.getByText("Enter a check number.")).toBeVisible();
    await form.getByLabel("Check number").fill("2044");
    await form.getByLabel("Date paid").fill("2001-01-01");
    await page.getByTestId("payment-submit").click();
    await expect(page.getByText("Choose a date between the day of the expense and today.")).toBeVisible();
    expect(await statusOf(ids.claim)).toBe("approved");

    await form.getByLabel("Date paid").fill(await orgToday());
    await form.getByLabel("Note (optional)").fill("Mailed Tuesday");
    await page.getByTestId("payment-submit").click();
    await expect(page.getByText("Payment recorded.").first()).toBeVisible();
    await expect(page.getByTestId("request-banner")).toContainText("Paid on");
    await expect(page.getByTestId("payment-form")).toHaveCount(0);
    expect(await statusOf(ids.claim)).toBe("paid");
    const payment = page.getByTestId("payment-row");
    await expect(payment).toContainText("Check");
    await expect(payment).toContainText("Check number 2044");
    await expect(payment).toContainText(NAMES.treasurer);
    await expect(page.getByTestId("request-history")).toContainText("Paid");
    await expect(page.getByTestId("request-history")).toContainText(NAMES.treasurer);
    await noHorizontalScroll(page);
    await shot(page, "360", "detail-paid");

    // The requester is told it was paid, in the requester's page; the payer is the signed-in user, never a field.
    await page.getByTestId("reverse-open").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Reverse this payment?")).toBeVisible();
    await expect(dialog).toContainText("The request goes back to “Approved, waiting for payment”. Both entries stay on record.");
    await dialog.getByTestId("reverse-confirm").click();
    await expect(dialog.getByText("Give a reason.")).toBeVisible();
    await dialog.getByLabel("Reason", { exact: true }).fill("Check went to the wrong payee");
    await shot(page, "360", "dialog-reverse", false);
    await dialog.getByTestId("reverse-confirm").click();
    await expect(page.getByText("Payment reversed.").first()).toBeVisible();
    expect(await statusOf(ids.claim)).toBe("approved");
    await expect(page.getByTestId("request-history")).toContainText("Payment corrected");
    // Both payment entries stay visible, and the form is back (the receipt is waived).
    await expect(page.getByTestId("payment-row")).toHaveCount(2);
    await expect(page.getByTestId("payment-form")).toBeVisible();
    await page.close();
  });

  test("a payment by ACH needs no reference; Send back to requester has NO radio, needs a reason, and the requester reads it", async ({ browser }) => {
    const page = await treasurerPage(360, 740);
    await page.goto(`${base()}/${ids.payable}`);
    await waitHydrated(page);
    await page.getByLabel("How was it paid?").selectOption("ach");
    await expect(page.getByLabel("Reference (optional)")).toBeVisible();
    await expect(page.getByLabel("Check number")).toHaveCount(0);

    // Send back first (from approved): the approved body says it will need approval again.
    await page.getByTestId("treasury-send-back-open").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Send this request back?")).toBeVisible();
    await expect(dialog).toContainText("The requester can fix it and send it again. It will need approval again.");
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(dialog).not.toContainText("Needs changes");
    await expect(dialog).not.toContainText("Not approved");
    await shot(page, "360", "dialog-send-back", false);
    await dialog.getByTestId("treasury-send-back-confirm").click();
    await expect(dialog.getByText("Give a reason.")).toBeVisible();
    await dialog.getByLabel("Reason (the requester will see this)").fill("The amount does not match the invoice");
    await dialog.getByTestId("treasury-send-back-confirm").click();
    await expect(page.getByText("Sent back.").first()).toBeVisible();
    expect(await statusOf(ids.payable)).toBe("returned");
    await expect(page.getByTestId("request-banner")).toContainText("Sent back. Reason: The amount does not match the invoice");
    await expect(page.getByTestId("request-banner")).not.toContainText("Sent back to you");
    await page.close();

    // The requester reads it in the requester's words.
    const ctx = await contextFor(browser, "member");
    const mine = await ctx.newPage();
    await mine.goto(`/o/${fx.slug}/reimbursements/${ids.payable}`);
    await expect(mine.getByTestId("request-banner")).toContainText("Sent back to you. Reason: The amount does not match the invoice");
    await ctx.close();
  });

  test("Void request: a required reason, then the request is closed (not deleted)", async () => {
    const page = await treasurerPage(360, 740);
    await page.goto(`${base()}/${ids.progress}`);
    await waitHydrated(page);
    await expect(page.getByTestId("payment-block")).toHaveText("This request isn't waiting for payment.");
    await page.getByTestId("void-open").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Void this request?")).toBeVisible();
    await expect(dialog).toContainText("It will be closed and can't be paid. Nothing is deleted.");
    await dialog.getByTestId("void-confirm").click();
    await expect(dialog.getByText("Give a reason.")).toBeVisible();
    await dialog.getByLabel("Reason", { exact: true }).fill("Bought on the church card instead");
    await dialog.getByTestId("void-confirm").click();
    await expect(page.getByText("Request voided.").first()).toBeVisible();
    expect(await statusOf(ids.progress)).toBe("voided");
    await expect(page.getByTestId("request-banner")).toContainText("This request was closed.");
    await expect(page.getByTestId("void-open")).toHaveCount(0);
    const stillThere = await rows<{ n: number }>(sql`select count(*)::int as n from reimbursement_requests where id = ${ids.progress}::uuid`);
    expect(stillThere[0]!.n).toBe(1);
    await page.close();
  });

  test("Add a note: 'Write a note.' for an empty one; the note shows in the history with the writer's name (treasury only)", async () => {
    const page = await treasurerPage(360, 740);
    await page.goto(`${base()}/${ids.override}`);
    await waitHydrated(page);
    await page.getByTestId("note-open").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Only the treasury team can see notes.")).toBeVisible();
    await dialog.getByTestId("note-confirm").click();
    await expect(dialog.getByText("Write a note.")).toBeVisible();
    await dialog.getByLabel("Note", { exact: true }).fill("Called the vendor about a discount");
    await dialog.getByTestId("note-confirm").click();
    await expect(page.getByText("Note added.").first()).toBeVisible();
    const history = page.getByTestId("request-history");
    await expect(history).toContainText("Note");
    await expect(history).toContainText("Called the vendor about a discount");
    await expect(history).toContainText(NAMES.treasurer);
    await page.close();
  });

  test("Approve as treasurer with only one person who can pay: the refusal, the link to the Treasury team, a second payer added there, then it works", async () => {
    const page = await treasurerPage(360, 740);
    await page.goto(`${base()}/${ids.override}`);
    await waitHydrated(page);
    await expect(page.getByTestId("request-banner")).toHaveText("Waiting for the treasurer to approve it.");
    await page.getByTestId("override-open").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Approve as treasurer?")).toBeVisible();
    await expect(dialog).toContainText(`No one in ${NAMES.worship} is able to approve this. Once approved, a different person who can record payments must pay it.`);
    await dialog.getByTestId("override-confirm").click();
    const refusal = dialog.getByTestId("override-refusal");
    await expect(refusal).toContainText("This needs a second person who can record payments before you can approve it. Whoever approves can't also pay. Add one under Treasury team.");
    await shot(page, "360", "dialog-override-refusal", false);
    await dialog.getByTestId("override-team-link").click();

    // The Treasury team page: give the payer role to Wren.
    await expect(page).toHaveURL(`${base()}/team`);
    await waitHydrated(page);
    await expect(page.getByRole("heading", { level: 1, name: "Treasury team" })).toBeVisible();
    await page.getByLabel("Role", { exact: true }).selectOption({ label: NAMES.payerRole });
    await page.getByLabel("Person", { exact: true }).selectOption({ label: NAMES.secondPayer });
    await page.getByTestId("team-grant-submit").click();
    await expect(page.getByText("Role given.").first()).toBeVisible();
    await expect(page.getByTestId("team-row").filter({ hasText: NAMES.secondPayer })).toContainText(NAMES.payerRole);

    await page.goto(`${base()}/${ids.override}`);
    await waitHydrated(page);
    await page.getByTestId("override-open").click();
    await page.getByRole("alertdialog").getByTestId("override-confirm").click();
    await expect(page.getByText("Approved.").first()).toBeVisible();
    expect(await statusOf(ids.override)).toBe("approved");
    await expect(page.getByTestId("approved-by")).toContainText(`Approved by ${NAMES.treasurer}`);
    await expect(page.getByTestId("approved-by")).toContainText("as treasurer");
    // The approver cannot also pay: the block, not a form that would be refused.
    await expect(page.getByTestId("payment-block")).toHaveText("A different person must record this payment.");
    await expect(page.getByTestId("payment-form")).toHaveCount(0);
    await shot(page, "360", "detail-approver-cannot-pay");
    await page.close();
  });

  // -------------------------------------------------------------------------
  test("Settings: groups switch on and off, categories add, rename, retire; the errors are Copy's", async () => {
    const page = await treasurerPage(360, 740);
    await page.goto(`${base()}/settings`);
    await waitHydrated(page);
    await expect(page.getByRole("heading", { level: 1, name: "Reimbursement settings" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Groups that can receive requests" })).toBeVisible();
    const property = page.getByTestId("chargeable-row").filter({ hasText: NAMES.property });
    await expect(property).toContainText("1 chair or leader can approve.");
    const worship = page.getByTestId("chargeable-row").filter({ hasText: NAMES.worship });
    await expect(worship).toContainText("No chair or leader right now: requests go to the treasurer.");
    // Every group has a switch: the two committees and the derived Active Membership roster.
    await expect(page.getByRole("switch", { name: "Can receive requests" })).toHaveCount(3);
    for (const row of [property, worship]) await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await noHorizontalScroll(page);
    await shot(page, "360", "settings");

    // Un-list Worship, see it persisted, then list it again.
    await worship.getByRole("switch").click();
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByTestId("chargeable-row").filter({ hasText: NAMES.worship }).getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("chargeable-row").filter({ hasText: NAMES.worship }).getByRole("switch").click();
    await page.reload();
    await waitHydrated(page);
    await expect(page.getByTestId("chargeable-row").filter({ hasText: NAMES.worship }).getByRole("switch")).toHaveAttribute("aria-checked", "true");

    // Categories.
    await expect(page.getByTestId("category-row")).toHaveCount(1);
    await page.getByTestId("add-category-submit").click();
    await expect(page.getByText("Use 1 to 60 characters.")).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill(NAMES.supplies);
    await page.getByTestId("add-category-submit").click();
    await expect(page.getByText("You already have a category with that name.")).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Hospitality");
    await page.getByTestId("add-category-submit").click();
    await expect(page.getByTestId("category-row")).toHaveCount(2);
    await expect(page.getByText("Retired categories stay on old requests.")).toBeVisible();
    await shot(page, "360", "settings-categories");

    const hospitality = page.getByTestId("category-row").filter({ hasText: "Hospitality" });
    await hospitality.getByTestId("rename-open").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Hospitality");
    await dialog.getByLabel("Name", { exact: true }).fill("Hospitality and meals");
    await dialog.getByTestId("rename-confirm").click();
    await expect(page.getByTestId("category-row").filter({ hasText: "Hospitality and meals" })).toHaveCount(1);
    await page.getByTestId("category-row").filter({ hasText: "Hospitality and meals" }).getByTestId("retire").click();
    await expect(page.getByRole("alertdialog")).toContainText("Retire Hospitality and meals?");
    await page.waitForTimeout(400); // let the dialog finish fading in before the screenshot
    await shot(page, "360", "retire-dialog", false);
    await page.getByTestId("retire-confirm").click();
    await expect(page.getByTestId("category-row")).toHaveCount(1);
    await page.close();
  });

  test("Treasury team: set up the Reimbursement Clerk role, give it, end it; the last manager cannot be ended", async () => {
    const page = await treasurerPage(360, 740);
    await page.goto(`${base()}/team`);
    await waitHydrated(page);
    await expect(page.getByText("Who can handle reimbursements and giving at")).toContainText(NAMES.org);
    await expect(page.getByRole("heading", { level: 2, name: "Who has a treasury role" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Roles to set up" })).toBeVisible();
    await expect(page.getByText("Can enter requests on behalf of members who don't use the portal.")).toBeVisible();
    await noHorizontalScroll(page);
    await expect(page.getByTestId("team-row").filter({ hasText: "E2E Treasurer" }).getByTestId("team-keys").getByText("Manage reimbursements")).toBeVisible();
    await shot(page, "360", "team");

    await page.getByRole("button", { name: "Set up the Reimbursement Clerk role" }).click();
    await expect(page.getByText("Role set up.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Set up the Reimbursement Clerk role" })).toHaveCount(0);

    await page.getByLabel("Role", { exact: true }).selectOption({ label: "Reimbursement Clerk" });
    await page.getByLabel("Person", { exact: true }).selectOption({ label: NAMES.requester });
    await page.getByTestId("team-grant-submit").click();
    await expect(page.getByText("Role given.").first()).toBeVisible();
    const row = page.getByTestId("team-row").filter({ hasText: NAMES.requester });
    await expect(row).toContainText("Reimbursement Clerk");
    await row.getByTestId("team-end-open").click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`End ${NAMES.requester}'s Reimbursement Clerk role?`);
    await shot(page, "360", "dialog-team-end", false);
    await dialog.getByTestId("team-end-confirm").click();
    await expect(page.getByTestId("team-row").filter({ hasText: NAMES.requester })).toHaveCount(0);

    // The only manager is Octavia: ending that grant is refused in Copy's words.
    await page.getByTestId("team-row").filter({ hasText: NAMES.treasurer }).getByTestId("team-end-open").click();
    await page.getByRole("alertdialog").getByTestId("team-end-confirm").click();
    await expect(page.getByText("That would leave no one able to manage reimbursements. Give the role to someone else first.").first()).toBeVisible();
    await page.close();
  });

  // -------------------------------------------------------------------------
  test("a treasury-only viewer who opens the MEMBER address of a request lands on the treasurer's page (the 404 is closed)", async () => {
    const page = await treasurerPage(1280, 900);
    await page.goto(`/o/${fx.slug}/reimbursements/${ids.paid}`);
    await expect(page).toHaveURL(`${base()}/${ids.paid}`);
    await expect(page.getByRole("heading", { level: 1, name: "$120.00" })).toBeVisible();
    await expect(page.getByTestId("payment-row")).toContainText("Check number 1001");
    await page.close();
  });

  test("someone with no treasury key gets the plain explanation at HTTP 200; a missing or foreign id is the one neutral 404", async ({ browser }) => {
    const ctx = await contextFor(browser, "member");
    const page = await ctx.newPage();
    for (const path of [base(), `${base()}/settings`, `${base()}/team`]) {
      const response = await page.goto(path);
      expect(response!.status(), path).toBe(200);
      await expect(page.getByText(`This page is for the people who handle reimbursements at ${NAMES.org}. If you think you should be one of them, ask your treasurer or another administrator there.`)).toBeVisible();
      await noHorizontalScroll(page);
    }
    // The treasurer view: a request id that does not exist.
    const missing = await treasurerPage(360, 740);
    const response = await missing.goto(`${base()}/00000000-0000-4000-8000-000000000000`);
    expect(response!.status()).toBe(404);
    await expect(missing.getByText("This request isn't available.")).toBeVisible();
    await expect(missing.getByRole("link", { name: "Back to reimbursements" })).toHaveAttribute("href", base());
    const junk = await missing.goto(`${base()}/not-a-uuid`);
    expect(junk!.status()).toBe(404);
    await missing.close();
    await ctx.close();
  });

  test("with no chargeable group the member form says so in place of the Charge to select and Send stays disabled", async ({ browser }) => {
    // Soft, as the app does it: the rows are ended, never deleted.
    await withDbRetry("unlist all groups", () => sql`
      update reimbursement_chargeable_groups set ended_at = now(), ended_by_user = ${fx.treasurerUser}::uuid
       where organization_id = ${fx.orgId}::uuid and ended_at is null`);
    const ctx = await contextFor(browser, "member");
    const page = await ctx.newPage();
    await page.goto(`/o/${fx.slug}/reimbursements/new`);
    await waitHydrated(page);
    await expect(page.getByTestId("no-chargeable-group")).toHaveText("No groups can be charged yet. Ask your treasurer to set them up.");
    await expect(page.getByLabel("Charge to")).toHaveCount(0);
    await expect(page.getByTestId("request-send")).toBeDisabled();
    await expect(page.getByTestId("request-save-draft")).toBeEnabled();
    await noHorizontalScroll(page);
    await shot(page, "360", "member-form-no-group");
    await ctx.close();
  });

  test("every treasurer page at 1280 px: no sideways scroll, screenshots for a human to read", async () => {
    const page = await treasurerPage(1280, 900);
    const pages: Array<[string, string]> = [
      ["queue-all", `${base()}?tab=all`],
      ["queue-override", `${base()}?tab=override`],
      ["detail-paid", `${base()}/${ids.paid}`],
      ["detail-long-values", `${base()}/${ids.long}`],
      ["settings", `${base()}/settings`],
      ["team", `${base()}/team`],
    ];
    for (const [name, path] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await noHorizontalScroll(page);
      await shot(page, "1280", name);
    }
    // And the long-value request at 360, where the unbroken purpose must wrap.
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`${base()}/${ids.long}`);
    await expect(page.getByTestId("request-fields")).toContainText("Unbroken");
    await noHorizontalScroll(page);
    await shot(page, "360", "detail-long-values");
    await page.close();
  });
});
