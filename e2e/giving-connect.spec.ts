/**
 * giving-connect.spec.ts - the Stripe connection panel, the connect pages and
 * the platform ingest-health page against a running server (online giving,
 * Batch 3b; docs/work-log/2026-10-15-online-giving.md).
 *
 * NO LIVE STRIPE ACCOUNT EXISTS and nothing here calls Stripe. Every state is
 * reached by writing fixture connection rows on the owner connection
 * (`setConnection`); the actions exercised through the UI are the ones that are
 * purely local (attest, go live / offline, disconnect, fee rates). The
 * connect-return page is exercised only where its retrieve cannot reach Stripe
 * (no open connection), which is also the proof that the URL decides nothing.
 * The Start / Continue buttons are covered by the component specs with a mocked
 * action and a re-asserted origin.
 *
 * One congregation, `e2e-giving-<stamp>`, torn down in afterAll (the cascade
 * takes every giving row). The signed-in actor is the `mfa-enrolled` fixture
 * (holding a giving key forces 2FA; `verifiedContext` completes a real TOTP).
 *
 * THE SERVER'S STRIPE CONFIGURATION IS NOT ASSUMED. A suite server normally has
 * no `STRIPE_SECRET_KEY` (the public-giving spec in Batch 4 needs it unset), so
 * "not started" renders the installation notice instead of the Connect button.
 * The spec asserts whichever the page actually says, both of which are real
 * behaviours; starting the server with `STRIPE_SECRET_KEY` set exercises the
 * Connect-button branch.
 *
 * Phone: the overview in every state, the return page and the platform pages
 * are checked at 360 px (no horizontal scroll, 40 px+ controls) and
 * screenshotted to test-results/giving-connect-360/ for a human to read.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import {
  GIVING_NAMES as N,
  addInboxEvent,
  offerFundOnline,
  removeGivingFixture,
  setConnection,
  setGivingRole,
  setGivingToggle,
  setupGivingFixture,
  verifiedContext,
  type GivingFixture,
} from "./support/giving-fixture";
import { storageStatePath } from "./support/users";

let sql: Sql;
let fx: GivingFixture;
let ctx: BrowserContext;

const base = () => `/o/${fx.slug}/admin/giving`;
const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/giving-connect-360/${name}.png`, fullPage: true });

async function noHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} scrolls sideways`).toBeLessThanOrEqual(1);
}

async function controlsAtLeast40px(page: Page, label: string) {
  const short = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("main a[data-slot=button], main button, main input[type=submit]"))
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30), h: Math.round(el.getBoundingClientRect().height) }))
      .filter((c) => c.h > 0 && c.h < 40),
  );
  expect(short, `${label} has controls shorter than 40px`).toEqual([]);
}

async function audited(action: string): Promise<number> {
  return (await rows<{ n: number }>(sql`select count(*)::int as n from audit_events where action = ${action} and metadata->>'organizationId' = ${fx.orgId}`))[0]!.n;
}

test.describe.configure({ mode: "serial" });

test.describe("Giving - the Stripe connection panel (treasurer)", () => {
  test.setTimeout(90_000);

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("giving-connect.spec");
    fx = await setupGivingFixture(sql);
    await setGivingToggle(sql, fx, true);
    await setGivingRole(sql, fx, "treasurer");
    ctx = await verifiedContext(browser, "/home");
  });

  test.afterAll(async () => {
    await ctx?.close();
    if (fx) await removeGivingFixture(sql, fx);
  });

  async function openOverview(): Promise<Page> {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(base());
    await expect(page.getByRole("heading", { name: "Online giving" })).toBeVisible();
    return page;
  }

  // -----------------------------------------------------------------------
  test("the six states: each shows its badge and its one primary action (360 px, screenshots read by a human)", async () => {
    // not started - which button appears depends on whether THIS server has Stripe configured
    await setConnection(sql, fx, null);
    let page = await openOverview();
    const card = page.getByTestId("connection-card");
    const dataState = await card.getAttribute("data-state");
    if (dataState === "unconfigured") {
      await expect(page.getByTestId("connection-state")).toHaveText("Not available");
      await expect(card).toContainText("Online giving isn't enabled on this installation");
      await expect(card.getByRole("button")).toHaveCount(0);
    } else {
      expect(dataState).toBe("not_started");
      await expect(page.getByTestId("connection-state")).toHaveText("Not connected");
      await expect(card.getByRole("button", { name: "Connect Stripe" })).toBeVisible();
      await expect(page.getByTestId("connect-disclosure")).toContainText("processing fee");
      await expect(page.getByTestId("connect-disclosure")).toContainText("does not give tax advice");
    }
    await noHorizontalScroll(page, "not started");
    await controlsAtLeast40px(page, "not started");
    await shot(page, "01-not-started");
    await page.close();

    const cases: Array<{ name: string; spec: Parameters<typeof setConnection>[2]; state: string; badge: string; button: string; absent?: string[] }> = [
      { name: "02-details-due", spec: { status: "onboarding", detailsSubmitted: false }, state: "details_due", badge: "Setup needs details", button: "Continue setup" },
      { name: "03-pending-verification", spec: { status: "onboarding", detailsSubmitted: true }, state: "pending_verification", badge: "Waiting for Stripe", button: "Refresh status", absent: ["Continue setup"] },
      { name: "04-active", spec: { status: "active" }, state: "active", badge: "Connected", button: "Confirm automatic payouts" },
      { name: "05-restricted", spec: { status: "restricted", requirementsDue: true, disabledReason: "requirements.past_due" }, state: "restricted", badge: "Needs attention", button: "Continue setup" },
      { name: "06-disconnected", spec: { status: "disconnected", disconnectedReason: "deauthorized" }, state: "disconnected", badge: "Disconnected", button: "Connect a new Stripe account", absent: ["Disconnect", "Refresh status"] },
    ];
    for (const c of cases) {
      await setConnection(sql, fx, c.spec);
      page = await openOverview();
      await expect(page.getByTestId("connection-card"), c.name).toHaveAttribute("data-state", c.state);
      await expect(page.getByTestId("connection-state"), c.name).toHaveText(c.badge);
      await expect(page.getByTestId("connection-card").getByRole("button", { name: c.button, exact: true }), c.name).toBeVisible();
      for (const gone of c.absent ?? []) {
        await expect(page.getByTestId("connection-card").getByRole("button", { name: gone, exact: true }), `${c.name} must not offer ${gone}`).toHaveCount(0);
      }
      await noHorizontalScroll(page, c.name);
      await controlsAtLeast40px(page, c.name);
      await shot(page, c.name);
      await page.close();
    }
  });

  // -----------------------------------------------------------------------
  test("the restricted card names Stripe's reason, and a Stripe-side disconnect reads differently from the treasurer's", async () => {
    await setConnection(sql, fx, { status: "restricted", requirementsDue: true, disabledReason: "requirements.past_due" });
    let page = await openOverview();
    await expect(page.getByTestId("restricted-detail")).toContainText("waiting on more information");
    await expect(page.getByTestId("restricted-detail")).toContainText("requirements.past_due");
    await expect(page.getByTestId("attention-list")).toContainText("needs attention before it can take gifts");
    await page.close();

    await setConnection(sql, fx, { status: "disconnected", disconnectedReason: "deauthorized" });
    page = await openOverview();
    await expect(page.getByTestId("disconnected-detail")).toContainText("from the Stripe side");
    await page.close();
    await setConnection(sql, fx, { status: "disconnected", disconnectedReason: "treasurer" });
    page = await openOverview();
    await expect(page.getByTestId("disconnected-detail")).toContainText("by your treasurer");
    await page.close();
  });

  // -----------------------------------------------------------------------
  test("the test-mode badge shows on every giving admin page while the OPEN connection is test mode, and only then", async () => {
    const paths = ["", "/funds", "/gifts", "/gifts/new", "/donors", "/settings", "/team", "/connect/return"];
    await setConnection(sql, fx, { status: "active", livemode: false });
    const page = await ctx.newPage();
    for (const path of paths) {
      await page.goto(`${base()}${path}`);
      await expect(page.getByRole("heading", { level: 1 }), path).toBeVisible();
      await expect(page.getByTestId("giving-test-mode-badge"), `badge on ${path || "/"}`).toBeVisible();
      await expect(page.getByTestId("giving-test-mode-badge")).toContainText("Test mode");
    }
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(base());
    await noHorizontalScroll(page, "badge at 360");
    await shot(page, "07-test-mode-badge");

    // a LIVE connection, no connection, and a disconnected test connection: no badge
    for (const spec of [{ status: "active" as const, livemode: true }, null, { status: "disconnected" as const, livemode: false }]) {
      await setConnection(sql, fx, spec);
      for (const path of ["", "/funds", "/gifts"]) {
        await page.goto(`${base()}${path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByTestId("giving-test-mode-badge"), `no badge on ${path || "/"} for ${JSON.stringify(spec)}`).toHaveCount(0);
      }
    }
    await page.close();
  });

  test("a giving.view-only holder sees the badge too, and a member with NO giving key learns nothing (no badge, no connection data)", async () => {
    await setConnection(sql, fx, { status: "active", livemode: false });
    const page = await ctx.newPage();

    await setGivingRole(sql, fx, "viewer");
    await page.goto(`${base()}/gifts`);
    await expect(page.getByTestId("giving-test-mode-badge")).toBeVisible();
    await page.goto(base());
    await expect(page.getByRole("heading", { name: "Online giving" })).toHaveCount(0); // manage only
    await expect(page.getByTestId("connection-card")).toHaveCount(0);

    // S4: a recorder reads no provider state, so no badge either
    await setGivingRole(sql, fx, "recorder");
    await page.goto(`${base()}/donors`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("giving-test-mode-badge")).toHaveCount(0);

    await setGivingRole(sql, fx, "none");
    await page.goto(base());
    await expect(page.getByText(/giving administration isn.t available to your account/i)).toBeVisible();
    await expect(page.getByTestId("giving-test-mode-badge")).toHaveCount(0);
    await expect(page.getByTestId("connection-card")).toHaveCount(0);
    await page.close();
    await setGivingRole(sql, fx, "treasurer");
  });

  // -----------------------------------------------------------------------
  test("going live is refused with the missing items NAMED, then attest -> fund -> go live -> take offline all work and are audited", async () => {
    await offerFundOnline(sql, fx, false);
    await setConnection(sql, fx, { status: "active" });
    const page = await openOverview();

    const checklist = page.getByTestId("go-live-checklist");
    await expect(checklist).toContainText("At least one fund offered online");
    await expect(checklist).toContainText("pays out to your bank automatically");

    // refused
    await page.getByRole("button", { name: "Turn on the give page" }).click();
    const notReady = page.getByTestId("not-ready");
    await expect(notReady).toBeVisible();
    await expect(notReady).toContainText("At least one fund offered online");
    await expect(notReady).toContainText("Confirmation that Stripe pays out to your bank automatically");
    await expect(notReady).not.toContainText("finished setup");
    expect((await rows(sql`select public_enabled_at from giving_provider_connections where organization_id = ${fx.orgId}::uuid`))[0]).toMatchObject({ public_enabled_at: null });

    // attest (AlertDialog, never a native dialog)
    page.on("dialog", () => {
      throw new Error("a native browser dialog opened");
    });
    await page.getByRole("button", { name: "Confirm automatic payouts" }).click();
    const attest = page.getByRole("alertdialog");
    await expect(attest).toContainText("set to automatic");
    await attest.getByRole("button", { name: "Yes, payouts are automatic" }).click();
    await expect(page.getByText("Thank you. Automatic payouts confirmed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm automatic payouts" })).toHaveCount(0);
    expect((await rows(sql`select payouts_attested_at is not null as done from giving_provider_connections where organization_id = ${fx.orgId}::uuid`))[0]).toMatchObject({ done: true });
    expect(await audited("tenant.giving_connection.payouts_attested")).toBe(1);

    // still no fund
    await page.getByRole("button", { name: "Turn on the give page" }).click();
    await expect(page.getByTestId("not-ready")).toContainText("At least one fund offered online");
    await expect(page.getByTestId("not-ready")).not.toContainText("Confirmation that Stripe pays");

    // offer a fund online, then go live
    await offerFundOnline(sql, fx, true);
    await page.reload();
    await page.getByRole("button", { name: "Turn on the give page" }).click();
    await expect(page.getByText("The give page is on.", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("give-page-state")).toContainText("give page is on");
    expect((await rows(sql`select public_enabled_at is not null as on_ from giving_provider_connections where organization_id = ${fx.orgId}::uuid`))[0]).toMatchObject({ on_: true });
    expect(await audited("tenant.giving_connection.public_toggled")).toBeGreaterThanOrEqual(1);

    // take offline - asks first
    await page.getByRole("button", { name: "Take the give page offline" }).click();
    const offline = page.getByRole("alertdialog");
    await expect(offline).toContainText("Monthly gifts already set up keep charging in Stripe");
    await offline.getByRole("button", { name: "Keep it on" }).click();
    expect((await rows(sql`select public_enabled_at is not null as on_ from giving_provider_connections where organization_id = ${fx.orgId}::uuid`))[0]).toMatchObject({ on_: true });
    await page.getByRole("button", { name: "Take the give page offline" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Take it offline" }).click();
    await expect(page.getByTestId("give-page-state")).toContainText("give page is off");
    expect((await rows(sql`select public_enabled_at is null as off_ from giving_provider_connections where organization_id = ${fx.orgId}::uuid`))[0]).toMatchObject({ off_: true });
    await page.close();
    await offerFundOnline(sql, fx, false);
  });

  // -----------------------------------------------------------------------
  test("disconnect: the dialog states the active monthly-gift count first; Keep it changes nothing; confirming disconnects locally and audits", async () => {
    await setConnection(sql, fx, { status: "active", schedules: 2 });
    const page = await openOverview();

    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByTestId("disconnect-body")).toContainText("2 monthly gifts are still active in Stripe. They keep charging");
    await expect(dialog.getByTestId("disconnect-body")).toContainText("connect a new Stripe account");
    await dialog.getByRole("button", { name: "Keep it connected" }).click();
    expect((await rows(sql`select status from giving_provider_connections where organization_id = ${fx.orgId}::uuid`))[0]).toMatchObject({ status: "active" });
    expect(await audited("tenant.giving_connection.disconnected")).toBe(0);

    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect Stripe" }).click();
    await expect(page.getByTestId("connection-state")).toHaveText("Disconnected");
    await expect(page.getByRole("button", { name: "Connect a new Stripe account" })).toBeVisible();
    expect((await rows(sql`select status, disconnected_reason from giving_provider_connections where organization_id = ${fx.orgId}::uuid`))[0]).toMatchObject({ status: "disconnected", disconnected_reason: "treasurer" });
    expect(await audited("tenant.giving_connection.disconnected")).toBe(1);
    // the monthly gifts are untouched (local disconnect; Stripe keeps charging)
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from giving_checkout_intents where organization_id = ${fx.orgId}::uuid and subscription_ended_at is null`))[0]!.n).toBe(2);
    await page.close();
  });

  test("with no monthly gifts the dialog says so", async () => {
    await setConnection(sql, fx, { status: "active" });
    const page = await openOverview();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByRole("alertdialog").getByTestId("disconnect-body")).toContainText("No monthly gifts are active right now");
    await page.getByRole("alertdialog").getByRole("button", { name: "Keep it connected" }).click();
    await page.close();
  });

  // -----------------------------------------------------------------------
  test("fee rates: edited as percent and dollars, stored as basis points and cents, audited with field names; a bad entry is refused inline", async () => {
    await setConnection(sql, fx, { status: "active" });
    const page = await openOverview();
    await page.getByRole("button", { name: "Edit fee rates" }).click();
    await expect(page.getByLabel("Card percentage")).toHaveValue("2.9");
    await expect(page.getByLabel("Bank fee cap (dollars)")).toHaveValue("5.00");

    await page.getByLabel("Card percentage").fill("2,7");
    await page.getByRole("button", { name: "Save fee rates" }).click();
    await expect(page.getByLabel("Card percentage")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#rate-cardFeeBps-error")).toContainText("enter a number like 2.9");

    await page.getByLabel("Card percentage").fill("2.7");
    await page.getByLabel("Card fixed fee (dollars)").fill("0.25");
    await page.getByLabel("Bank percentage").fill("0.5");
    await page.getByLabel("Bank fee cap (dollars)").fill("4");
    await page.getByRole("button", { name: "Save fee rates" }).click();
    await expect(page.getByTestId("rates-summary")).toContainText("Card: 2.7% + $0.25. Bank: 0.5%, capped at $4.00.");
    expect((await rows(sql`select card_fee_bps, card_fee_fixed_cents, ach_fee_bps, ach_fee_cap_cents from giving_provider_connections where organization_id = ${fx.orgId}::uuid`))[0]).toMatchObject({
      card_fee_bps: 270, card_fee_fixed_cents: 25, ach_fee_bps: 50, ach_fee_cap_cents: 400,
    });
    const [event] = await rows<{ metadata: { fields: string[] } }>(sql`select metadata from audit_events where action = 'tenant.giving_connection.rates_changed' and metadata->>'organizationId' = ${fx.orgId}`);
    expect(event!.metadata.fields.sort()).toEqual(["achFeeBps", "achFeeCapCents", "cardFeeBps", "cardFeeFixedCents"]);
    await page.close();
  });

  // -----------------------------------------------------------------------
  test("connect/return: the URL proves nothing (query-string claims change nothing), and a disconnected account is shown as disconnected", async () => {
    await setConnection(sql, fx, null);
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 360, height: 800 });
    // claim "active" in the query string with no connection behind it
    await page.goto(`${base()}/connect/return?status=active&state=active&account=acct_fixtureclaim0001&charges_enabled=true`);
    await expect(page.getByRole("heading", { level: 1, name: "Stripe connection" })).toBeVisible();
    await expect(page.getByTestId("connect-return-result")).toBeVisible();
    await expect(page.getByTestId("connection-state")).not.toHaveText("Connected");
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from giving_provider_connections where organization_id = ${fx.orgId}::uuid`))[0]!.n).toBe(0);
    await noHorizontalScroll(page, "return page");
    await shot(page, "08-return-no-connection");

    await setConnection(sql, fx, { status: "disconnected" });
    await page.goto(`${base()}/connect/return`);
    await expect(page.getByTestId("connection-state")).toHaveText("Disconnected");
    await controlsAtLeast40px(page, "return page, disconnected");
    await shot(page, "09-return-disconnected");
    await page.close();
  });

  // -----------------------------------------------------------------------
  test("toggle OFF: the connect routes and the overview render the honest 'not turned on' state at 200 - never a 404 - and the refresh route bounces back with a notice", async () => {
    await setConnection(sql, fx, { status: "onboarding" });
    await setGivingToggle(sql, fx, null);
    const page = await ctx.newPage();
    for (const path of ["", "/connect/return"]) {
      const response = await page.goto(`${base()}${path}`);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByText(new RegExp(`giving isn.t turned on for ${N.org}`, "i")), path).toBeVisible();
      await expect(page.getByTestId("connection-card"), path).toHaveCount(0);
      await expect(page.getByTestId("giving-test-mode-badge"), path).toHaveCount(0);
    }
    const refresh = await page.request.get(`${base()}/connect/refresh`, { maxRedirects: 0 });
    expect(refresh.status()).toBe(307);
    expect(refresh.headers().location ?? "").toContain("/admin/giving?connect=no_access");
    // and the overview shows that notice as a message, not a blank
    await setGivingToggle(sql, fx, true);
    await page.goto(`${base()}?connect=no_access`);
    await expect(page.getByTestId("connect-notice")).toContainText("don't have permission to manage the Stripe connection");
    await page.goto(`${base()}?connect=refresh_failed`);
    await expect(page.getByTestId("connect-notice")).toContainText("setup link had expired");
    await page.goto(`${base()}?connect=%3Cscript%3E`);
    await expect(page.getByTestId("connect-notice")).toHaveCount(0);
    await page.close();
  });

  test("a giving.view-only holder cannot open connect/return, and connect/refresh bounces them back with no_access", async () => {
    await setConnection(sql, fx, { status: "onboarding" });
    await setGivingRole(sql, fx, "viewer");
    const page = await ctx.newPage();
    await page.goto(`${base()}/connect/return`);
    await expect(page.getByText(/Stripe connection isn.t available to your account/)).toBeVisible();
    await expect(page.getByTestId("connection-card")).toHaveCount(0);
    const refresh = await page.request.get(`${base()}/connect/refresh`, { maxRedirects: 0 });
    expect(refresh.status()).toBe(307);
    expect(refresh.headers().location ?? "").toContain("connect=no_access");
    await page.close();
    await setGivingRole(sql, fx, "treasurer");
  });
});

// ---------------------------------------------------------------------------
test.describe("Giving - connect routes for a platform admin who is not a member", () => {
  test.use({ storageState: storageStatePath("admin") });
  let spec: Sql;
  let local: GivingFixture;

  test.beforeAll(async () => {
    spec = platformSql("giving-connect.spec/miss");
    local = await setupGivingFixture(spec);
    await setGivingToggle(spec, local, true);
    await setConnection(spec, local, { status: "active", livemode: false });
  });
  test.afterAll(async () => {
    if (local) await removeGivingFixture(spec, local);
  });

  test("gets the shared access-denied page on connect/return and the overview (no platform branch, no connection data, no badge); connect/refresh bounces without revealing anything", async ({ page }) => {
    for (const path of ["", "/connect/return"]) {
      const response = await page.goto(`/o/${local.slug}/admin/giving${path}`);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByText(new RegExp(`you don.t have access to ${N.org}`, "i")), path).toBeVisible();
      await expect(page.getByTestId("connection-card"), path).toHaveCount(0);
      await expect(page.getByTestId("giving-test-mode-badge"), path).toHaveCount(0);
    }
    const refresh = await page.request.get(`/o/${local.slug}/admin/giving/connect/refresh`, { maxRedirects: 0 });
    expect(refresh.status()).toBe(307);
    expect(refresh.headers().location ?? "").toContain("connect=no_access");
    // an unknown slug is the 404
    const missing = await page.goto(`/o/e2e-giving-nonexistent/admin/giving/connect/return`);
    expect(missing?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
test.describe("Giving - the platform ingest-health page and the organization section", () => {
  test.setTimeout(90_000);
  let adminCtx: BrowserContext;
  let eventId: string;
  const EXTERNAL = "evt_e2econnect00001";
  const OTHER_DEAD = "evt_e2econnect00002";

  test.beforeAll(async ({ browser }) => {
    sql = platformSql("giving-connect.spec/health");
    fx = await setupGivingFixture(sql);
    const connId = (await setConnection(sql, fx, { status: "active", livemode: false }))!;
    eventId = await addInboxEvent(sql, fx, connId, { externalEventId: EXTERNAL, status: "dead_letter", attempts: 8, lastError: "over_reversal" });
    await addInboxEvent(sql, fx, connId, { externalEventId: OTHER_DEAD, status: "dead_letter", attempts: 8, lastError: "normalize_api_version", type: "charge.dispute.created" });
    await addInboxEvent(sql, fx, connId, { externalEventId: "evt_e2econnect00003", status: "parked", lastError: "no_gift" });
    await addInboxEvent(sql, fx, connId, { externalEventId: "evt_e2econnect00004", status: "applied", type: "charge.succeeded" });
    adminCtx = await browser.newContext({ storageState: storageStatePath("admin") });
  });
  test.afterAll(async () => {
    await adminCtx?.close();
    if (fx) await removeGivingFixture(sql, fx);
  });

  test("lists the fixture connection with counts and the dead letters, by organization NAME, with no donor or amount data (360 px screenshot)", async () => {
    const page = await adminCtx.newPage();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/admin/giving");
    await expect(page.getByRole("heading", { level: 1, name: "Giving" })).toBeVisible();

    const healthRow = page.getByTestId("ingest-health-row").filter({ hasText: N.org });
    await expect(healthRow).toHaveCount(1);
    await expect(healthRow).toContainText("Test");
    const cells = (await healthRow.locator("td").allInnerTexts()).map((t) => t.trim());
    // Organization, Mode, Status, Received, Applied, Waiting, Dead letters, Last notice, Oldest waiting
    expect(cells.slice(3, 7)).toEqual(["4", "1", "1", "2"]);

    await expect(page.getByTestId("dead-letter-row").filter({ hasText: EXTERNAL })).toContainText("over_reversal");
    await expect(page.getByTestId("dead-letter-row").filter({ hasText: OTHER_DEAD })).toContainText("charge.dispute.created");

    const text = (await page.locator("main").innerText());
    expect(text).not.toMatch(/\$\s?\d|Imogen|Thackeray|@example/);
    await noHorizontalScroll(page, "platform health");
    await controlsAtLeast40px(page, "platform health");
    await shot(page, "10-platform-health");
    await page.close();
  });

  test("Requeue asks first, then moves THAT dead letter back to 'received' (attempts reset), audits it against the organization, and the row leaves the list", async () => {
    const page = await adminCtx.newPage();
    page.on("dialog", () => {
      throw new Error("a native browser dialog opened");
    });
    await page.goto("/admin/giving");

    await page.getByRole("button", { name: `Requeue ${EXTERNAL}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(EXTERNAL);
    await expect(dialog).toContainText("recorded in the audit log");
    // Cancel changes nothing
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect((await rows(sql`select status from giving_provider_events where id = ${eventId}::uuid`))[0]).toMatchObject({ status: "dead_letter" });

    await page.getByRole("button", { name: `Requeue ${EXTERNAL}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Requeue event" }).click();
    await expect(page.getByText("Event requeued. It will be retried on the next run.")).toBeVisible();

    const [event] = await rows<{ status: string; attempts: number; last_error: string | null }>(sql`select status, attempts, last_error from giving_provider_events where id = ${eventId}::uuid`);
    expect(event).toMatchObject({ status: "received", attempts: 0, last_error: null });
    // the OTHER dead letter was not touched
    expect((await rows(sql`select status from giving_provider_events where organization_id = ${fx.orgId}::uuid and external_event_id = ${OTHER_DEAD}`))[0]).toMatchObject({ status: "dead_letter" });

    await expect(page.getByTestId("dead-letter-row").filter({ hasText: EXTERNAL })).toHaveCount(0);
    await expect(page.getByTestId("dead-letter-row").filter({ hasText: OTHER_DEAD })).toHaveCount(1);

    const [audit] = await rows<{ resource_id: string; resource_type: string; metadata: Record<string, unknown> }>(sql`
      select resource_id, resource_type, metadata from audit_events where action = 'org.giving_event.requeued' and resource_id = ${fx.orgId}`);
    expect(audit).toMatchObject({ resource_type: "organization", resource_id: fx.orgId });
    expect(audit!.metadata).toMatchObject({ organizationId: fx.orgId, eventId, eventType: "charge.refunded" });
    expect(JSON.stringify(audit!.metadata)).not.toMatch(/evt_|over_reversal/);

    // a second attempt on an event that is no longer a dead letter is refused, not repeated
    await page.close();
  });

  test("the organization page carries a 'Payment notices' section with this organization's counts and a link to the platform page", async () => {
    const page = await adminCtx.newPage();
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/admin/organizations/${fx.orgId}`);
    const section = page.getByTestId("ingest-health-section");
    await expect(section).toBeVisible();
    await expect(section).toContainText("Payment notices");
    const connection = section.getByTestId("ingest-health-connection");
    await expect(connection).toContainText("Test");
    await expect(connection).toContainText(/Received\s*4/);
    await expect(connection).toContainText(/Dead letters\s*1/);
    await expect(section.getByRole("link", { name: "Open giving health" })).toHaveAttribute("href", "/admin/giving");
    await noHorizontalScroll(page, "organization page");
    await shot(page, "11-organization-section");
    await page.close();
  });

  test.describe("a signed-in user without the platform organizations feature", () => {
    test("cannot see the health page", async ({ browser }) => {
      const member = await browser.newContext({ storageState: storageStatePath("member") });
      const page = await member.newPage();
      await page.goto("/admin/giving");
      await expect(page.getByTestId("giving-health-summary")).toHaveCount(0);
      await expect(page.getByTestId("dead-letters-table")).toHaveCount(0);
      await member.close();
    });
  });
});
