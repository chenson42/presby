/**
 * domains-admin.spec.ts - the church's `/o/<slug>/admin/domains` checklist, end
 * to end on the FAKE provider and fake DNS (Track F, Batch 1d;
 * docs/work-log/2026-10-19-custom-domains.md Phase 3 Component / Page Plan,
 * Implementation Order 1d, E2E spec 9; tech-lead follow-ups A and B).
 *
 * No real Vercel, Resend or public-DNS call: the dev (or production) server runs
 * with DOMAINS_PROVIDER=fake / DOMAINS_DNS_PROVIDER=fake, and this spec scripts the
 * "DNS" and the "hosting provider" by rewriting DOMAINS_FAKE_STATE_FILE between
 * clicks. The acting person is the mfa-enrolled user, who completes a real TOTP
 * challenge first (the `/o/*` Edge gate), as a member of a throwaway congregation.
 *
 * What it proves, in the browser:
 *   - the gate states: toggle off, no `domains.manage`, and the empty state with Start;
 *   - the full flow: claim -> the proof record is shown (type, name, value, Copy) ->
 *     Check now before publishing (nothing changed, record Missing) -> publish the record,
 *     Check now (found, connected) -> Check now again (live) -> "View your site" ->
 *     Make primary on the alias -> Remove (30-day explanation) -> exit checklist ->
 *     Reconnect;
 *   - every state at 360px with no horizontal scroll, 44px buttons, and a screenshot per
 *     state under .tmp/custom-domains-ui-360/ (gitignored) (read by the implementer, not asserted);
 *   - the primary-address advisory (follow-up A) and its remedy.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { addDomain, setHold, type WalkState } from "../support/custom-hosts";
import {
  removeDomainsUiFixture,
  retireAllDomains,
  setDomainsRole,
  setObservation,
  setSiteStatus,
  setToggle,
  setupDomainsUiFixture,
  verifiedContext,
  type DomainsUiFixture,
} from "../support/domains-ui-fixture";

const STATE_FILE = process.env.DOMAINS_FAKE_STATE_FILE ?? path.resolve(__dirname, "..", "..", ".tmp", "domains-fake-state.json");
const SHOTS = path.resolve(__dirname, "..", "..", ".tmp", "custom-domains-ui-360");

function writeState(state: object) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

/** The fake world for one claim: its proof published (or not), DNS pointed at the provider, the probe answering. */
function world(claim: string, opts: { proof?: string; routing?: boolean; probe?: boolean } = {}) {
  const zone: Record<string, string[]> = {};
  if (opts.proof) zone[`TXT _presby-challenge.${claim}`] = [opts.proof];
  if (opts.routing) {
    zone[`SOA ${claim}`] = ["ns1.dns-host.invalid hostmaster.invalid 1 7200 3600 1209600 300"];
    zone[`A ${claim}`] = ["192.0.2.10"];
    zone[`CNAME www.${claim}`] = ["cname.vercel-dns.invalid"];
  }
  return { dns: { zone }, probe: opts.probe ? { [claim]: "ack", [`www.${claim}`]: "ack" } : {} };
}

let sql: Sql;
let fx: DomainsUiFixture;
let ctx: BrowserContext;
/** The fake DNS/provider world once the proof is published (set by the flow test, reused by the reconnect tests). */
let published: object = {};
const stamp = Date.now();
const claimName = `church-ui-${stamp}.invalid`;
const pageUrl = () => `/o/${fx.slug}/admin/domains`;

test.beforeAll(async ({ browser }) => {
  sql = platformSql("custom-domains/domains-admin.spec");
  writeState({});
  fx = await setupDomainsUiFixture(sql, { stamp });
  ctx = await verifiedContext(browser, pageUrl());
});

test.afterAll(async () => {
  await ctx?.close();
  writeState({});
  await removeDomainsUiFixture(sql, fx);
});

async function open(page: Page) {
  await page.goto(pageUrl());
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const toastText = (page: Page) => page.locator("[data-sonner-toast]");
const card = (page: Page) => page.getByTestId("claim-card").first();

test.describe.serial("Domains checklist (desktop)", () => {
  test("toggle off is an honest 'not turned on' state, and a missing permission is a different one", async () => {
    const page = await ctx.newPage();
    await setToggle(sql, fx.orgId, false);
    await open(page);
    await expect(page.getByTestId("domains-feature-off")).toContainText("isn't turned on");
    await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0);

    await setToggle(sql, fx.orgId, true);
    await setDomainsRole(sql, fx, false);
    await open(page);
    await expect(page.getByTestId("domains-forbidden")).toContainText("permission to manage the website domain");

    await setDomainsRole(sql, fx, true);
    await open(page);
    await expect(page.getByTestId("domains-empty")).toBeVisible();
    await page.close();
  });

  test("claim -> proof shown -> check before publishing -> publish -> connected -> live -> View your site", async () => {
    const page = await ctx.newPage();
    await open(page);

    // Empty state: the two paths and Start (G29).
    await expect(page.getByText("Bring a domain you already own.")).toBeVisible();
    await expect(page.getByText("Get one later.")).toBeVisible();
    await page.getByLabel("Your domain").fill(claimName);
    await expect(page.getByRole("radio")).toHaveCount(2); // a bare domain: www or not
    await page.getByRole("button", { name: "Start" }).click();

    // The proof record is shown, with Copy controls and a Missing chip.
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toHaveAttribute("data-phase", "proving");
    const proof = card(page).locator('[data-record-kind="proof"]');
    await expect(proof.locator("code").nth(0)).toHaveText(`_presby-challenge.${claimName}`);
    const value = (await proof.locator("code").nth(1).textContent())!.trim();
    expect(value).toMatch(/^presby-verify=\S+/);
    await expect(proof.getByRole("button", { name: "Copy the record value" })).toBeEnabled();
    await expect(proof.locator("[data-status]")).toHaveText("Couldn't check"); // never checked yet
    await expect(card(page).getByText(/Publish this record by/)).toBeVisible();

    // Check now before the record is published: nothing happens, and it says why that is normal.
    writeState(world(claimName));
    await card(page).getByRole("button", { name: "Check now" }).click();
    await expect(toastText(page).last()).toContainText("Nothing has changed yet. DNS changes can take up to an hour to be seen.");
    await expect(proof.locator("[data-status]")).toHaveText("Missing");

    // Publish the record (the fake "DNS" now has it) and the routing, then check: found and connected.
    published = world(claimName, { proof: value, routing: true, probe: true });
    writeState(published);
    await card(page).getByRole("button", { name: "Check now" }).click();
    await expect(toastText(page).last()).toContainText("We found your ownership record. We're connecting your domain now.");
    await expect(card(page)).toHaveAttribute("data-phase", "connecting");
    await expect(proof.locator("[data-status]")).toHaveText("Correct");

    // The next check connects it: the provider has the name, and the HTTPS certificate is on its way.
    await card(page).getByRole("button", { name: "Check now" }).click();
    await expect(toastText(page).last()).toContainText("Connected. Now securing your site with HTTPS.");
    await expect(card(page)).toHaveAttribute("data-phase", "securing");
    await expect(card(page).getByText("Securing your site... this usually takes a few minutes.")).toBeVisible();
    await expect(card(page).locator('[data-record-kind="routing"]')).not.toHaveCount(0);
    await expect(proof.locator("[data-status]")).toHaveText("Correct");

    // Check again: the probe answers, the host is live.
    await card(page).getByRole("button", { name: "Check now" }).click();
    await expect(toastText(page).last()).toContainText("Your site is live on this domain.");
    await expect(card(page)).toHaveAttribute("data-phase", "live");
    const view = card(page).getByRole("link", { name: /View your site/ });
    await expect(view).toHaveAttribute("href", `https://www.${claimName}/`);
    await expect(view).toHaveAttribute("rel", "noopener noreferrer");
    // www is the primary by default; every routing record is Correct.
    await expect(card(page).locator('[data-host="www.' + claimName + '"]')).toContainText("Primary address");
    for (const chip of await card(page).locator('[data-record-kind="routing"] [data-status]').all()) {
      await expect(chip).toHaveText("Correct");
    }
    await page.close();
  });

  test("Make primary on the live alias, with a confirmation that names what changes", async () => {
    const page = await ctx.newPage();
    await open(page);
    const alias = card(page).locator(`[data-host="${claimName}"]`);
    await expect(alias).toContainText("Sends visitors to your primary address");
    await alias.getByRole("button", { name: `Make ${claimName} primary` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(`Make ${claimName} your primary address?`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(alias).toContainText("Sends visitors to your primary address");

    await alias.getByRole("button", { name: `Make ${claimName} primary` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Make primary" }).click();
    await expect(toastText(page).last()).toContainText(`${claimName} is now your primary address.`);
    await expect(card(page).locator(`[data-host="${claimName}"]`)).toContainText("Primary address");
    await expect(card(page).getByRole("link", { name: /View your site/ })).toHaveAttribute("href", `https://${claimName}/`);
    // The change is in the recent-activity list, in words.
    await expect(page.getByTestId("claim-card").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
    await expect(page.getByText(`Primary address changed to ${claimName}.`)).toBeVisible();
    const audited = (await sql`
      select count(*)::int as n from audit_events
       where action = 'domain.canonical_changed' and metadata->>'organizationId' = ${fx.orgId}`) as { n: number }[];
    expect(audited[0]!.n).toBe(1);
    await page.close();
  });

  test("Remove explains the 30-day hold, shows the exit checklist; Reconnect brings it back", async () => {
    const page = await ctx.newPage();
    await open(page);
    await card(page).getByRole("button", { name: /^Remove/ }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("30 days");
    await expect(dialog).toContainText("page not found");
    await dialog.getByRole("button", { name: "Keep it" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    await card(page).getByRole("button", { name: /^Remove/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove domain" }).click();
    await expect(toastText(page).last()).toContainText(`${claimName} was removed.`);
    await expect(card(page)).toHaveAttribute("data-phase", "parked");

    const exit = page.getByTestId("offboarding-card");
    await expect(exit).toContainText("Before you delete anything,");
    await expect(exit).toContainText("valid HTTPS");
    await expect(exit.getByRole("heading", { name: "Delete these records from your DNS" })).toBeVisible();
    await expect(exit.getByRole("heading", { name: "Keep this one until the domain is released" })).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Check now" })).toHaveCount(0);

    // The ownership record is still published, so Reconnect works.
    await card(page).getByRole("button", { name: "Reconnect" }).click();
    await expect(toastText(page).last()).toContainText("Reconnected. We're checking your records again.");
    await expect(card(page)).not.toHaveAttribute("data-phase", "parked");
    await expect(page.getByTestId("offboarding-card")).toHaveCount(0);
    await page.close();
  });

  test("a reconnect without the record says to add it back", async () => {
    const page = await ctx.newPage();
    await open(page);
    // Back to live first (a never-connected host is released outright; only a connected one is held for 30 days).
    await card(page).getByRole("button", { name: "Check now" }).click();
    await expect(toastText(page).last()).toContainText("Connected. Now securing your site with HTTPS.");
    await card(page).getByRole("button", { name: "Check now" }).click();
    await expect(toastText(page).last()).toContainText("Your site is live on this domain.");
    await expect(card(page)).toHaveAttribute("data-phase", "live");
    // Remove it, then take the proof away.
    await card(page).getByRole("button", { name: /^Remove/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove domain" }).click();
    await expect(card(page)).toHaveAttribute("data-phase", "parked");
    writeState({});
    await card(page).getByRole("button", { name: "Reconnect" }).click();
    await expect(toastText(page).last()).toContainText("We can't find your ownership record yet. Add it back at your DNS provider, then try again.");
    await expect(card(page)).toHaveAttribute("data-phase", "parked");
    // Put the record back and it reconnects.
    writeState(published);
    await card(page).getByRole("button", { name: "Reconnect" }).click();
    await expect(toastText(page).last()).toContainText("Reconnected. We're checking your records again.");
    await expect(card(page)).not.toHaveAttribute("data-phase", "parked");
    await page.close();
  });

  test("a bad domain is refused on the field, with no organization named and nothing claimed", async () => {
    const page = await ctx.newPage();
    await retireAllDomains(sql, fx.orgId);
    await open(page);
    await page.getByLabel("Your domain").fill("localhost");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /./ }).first()).toBeVisible();
    await expect(page.getByLabel("Your domain")).toHaveAttribute("aria-invalid", "true");
    const rows = (await sql`select count(*)::int as n from organization_domains where organization_id = ${fx.orgId}::uuid and state not in ('released','expired')`) as { n: number }[];
    expect(rows[0]!.n).toBe(0);
    await page.close();
  });
});

// ---------------------------------------------------------------------------
// Follow-up A: the primary address is not serving while an alias is live.
// ---------------------------------------------------------------------------
test.describe.serial("Primary address advisory (follow-up A)", () => {
  test("a lapsed primary with a live alias in another domain offers the remedy, and it works", async () => {
    const page = await ctx.newPage();
    await retireAllDomains(sql, fx.orgId);
    const a = `first-${stamp}.invalid`;
    const b = `second-${stamp}.invalid`;
    const primary = await addDomain(sql, { orgId: fx.orgId, hostname: `www.${a}`, claimName: a, role: "canonical", state: "lapsed", token: 11 });
    const alias = await addDomain(sql, { orgId: fx.orgId, hostname: `www.${b}`, claimName: b, role: "alias", state: "live", token: 12 });
    await open(page);
    const banner = page.getByTestId("primary-advisory");
    await expect(banner).toContainText(`Your primary address, www.${a}, isn't serving`);
    await expect(banner).toContainText(`www.${b} is live`);
    await banner.getByRole("button", { name: `Make www.${b} primary` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Make primary" }).click();
    await expect(toastText(page).last()).toContainText(`www.${b} is now your primary address.`);
    await expect(page.getByTestId("primary-advisory")).toHaveCount(0);
    const roles = (await sql`select hostname, web_role from organization_domains where id in (${primary.id}::uuid, ${alias.id}::uuid) order by hostname`) as { hostname: string; web_role: string }[];
    expect(roles.find((r) => r.hostname === `www.${b}`)!.web_role).toBe("canonical");
    expect(roles.find((r) => r.hostname === `www.${a}`)!.web_role).toBe("alias");
    await page.close();
  });
});

// ---------------------------------------------------------------------------
// 360px: every state, no horizontal scroll, 44px buttons, a screenshot each.
// ---------------------------------------------------------------------------
test.describe.serial("Domains checklist at 360px", () => {
  /** A page from the shared signed-in context at a phone width (a `test.use` viewport does not reach a hand-made context). */
  const problems = new WeakMap<Page, string[]>();
  async function narrowPage(): Promise<Page> {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 360, height: 740 });
    const seen: string[] = [];
    problems.set(page, seen);
    page.on("pageerror", (e) => seen.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") seen.push(`console.error: ${m.text().slice(0, 300)}`);
    });
    return page;
  }

  async function shoot(page: Page, name: string, opts: { viewportOnly?: boolean } = {}) {
    fs.mkdirSync(SHOTS, { recursive: true });
    // Let open/close animations finish so a dialog is captured at rest, not mid-fade.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    // Hydrated = the page's JS has run (the troubleshooting button, a plain onClick control, is enabled) and said nothing.
    const diag = page.getByRole("button", { name: /Why isn.t it working/ });
    if (await diag.count()) await expect(diag.first(), `${name}: page never hydrated`).toBeEnabled({ timeout: 20_000 });
    expect(problems.get(page) ?? [], `${name}: browser errors`).toEqual([]);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: !opts.viewportOnly });
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(await page.evaluate(() => window.innerWidth), `${name}: the page is really phone-width`).toBe(360);
    const dialogOverflow = await page.evaluate(() => {
      const d = document.querySelector('[role="alertdialog"]');
      if (!d) return null;
      const widest = Math.max(...Array.from(d.querySelectorAll("*")).map((el) => el.getBoundingClientRect().right));
      return { dialogRight: d.getBoundingClientRect().right, widest };
    });
    if (dialogOverflow) expect(dialogOverflow.widest, `${name}: dialog content spills out of the dialog`).toBeLessThanOrEqual(dialogOverflow.dialogRight + 0.5);
    expect(overflow.scroll, `${name}: horizontal scroll (${overflow.scroll} > ${overflow.client})`).toBeLessThanOrEqual(overflow.client);
    // Buttons in the page body are 44px targets (the layout's own header controls are not ours).
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll("main button:not([disabled])"))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({ text: (el.textContent ?? "").trim().slice(0, 40), h: el.getBoundingClientRect().height }))
        .filter((b) => b.h < 43.5),
    );
    expect(small, `${name}: buttons under 44px`).toEqual([]);
  }

  const routing = (claim: string, statuses: Array<[string, string, string?, boolean?]>) => ({
    checkedAt: new Date().toISOString(),
    targets: { cname: "cname.vercel-dns.invalid", ipv4: ["192.0.2.10"], source: "provider" },
    routing: { records: statuses.map(([hostname, status, hint, apex]) => ({ hostname, status, hint: hint ?? null, apex: apex ?? false })) },
  });

  async function arrange(spec: { claim: string; state: WalkState; hosts?: Array<{ name: string; role: "canonical" | "alias" }>; cls?: string | null; obs?: Record<string, unknown>; hold?: "paused" | "disputed" }) {
    await retireAllDomains(sql, fx.orgId);
    const hosts = spec.hosts ?? [
      { name: `www.${spec.claim}`, role: "canonical" as const },
      { name: spec.claim, role: "alias" as const },
    ];
    const rows = [];
    for (const h of hosts) {
      const row = await addDomain(sql, { orgId: fx.orgId, hostname: h.name, claimName: spec.claim, role: h.role, state: spec.state, token: 21 });
      if (spec.obs) await setObservation(sql, row.id, { observation: spec.obs });
      if (spec.cls !== undefined) await setObservation(sql, row.id, { lastCheckClass: spec.cls });
      await setObservation(sql, row.id, { lastCheckedAt: true });
      if (spec.hold) await setHold(sql, row.id, spec.hold);
      rows.push(row);
    }
    return rows;
  }

  const c = `narrow-${stamp}.invalid`;

  test("states without a claim: toggle off, no permission, empty", async () => {
    const page = await narrowPage();
    await retireAllDomains(sql, fx.orgId);
    await setToggle(sql, fx.orgId, false);
    await open(page);
    await shoot(page, "01-feature-off");
    await setToggle(sql, fx.orgId, true);
    await setDomainsRole(sql, fx, false);
    await open(page);
    await shoot(page, "02-forbidden");
    await setDomainsRole(sql, fx, true);
    await open(page);
    await shoot(page, "03-empty");
    // The form is usable here: a typed bare domain reveals the www choice.
    await page.getByLabel("Your domain").fill(c);
    await expect(page.getByRole("radio")).toHaveCount(2);
    await shoot(page, "04-empty-typed-apex");
    await page.close();
  });

  const scenarios: Array<{ name: string; spec: Parameters<typeof arrange>[0]; after?: (page: Page) => Promise<void> }> = [
    { name: "10-pending-proof-and-lookup-failed", spec: { claim: c, state: "pending", cls: "dns_unknown" } },
    { name: "11-pending-site-not-published", spec: { claim: c, state: "pending", cls: null } },
    { name: "12-held-elsewhere", spec: { claim: c, state: "pending", cls: "held_elsewhere" } },
    { name: "13-provider-unavailable-generic-targets", spec: { claim: c, state: "attach_pending", cls: "provider_unavailable", obs: { checkedAt: new Date().toISOString(), targets: { cname: "cname.vercel-dns.invalid", ipv4: ["76.76.21.21"], source: "generic" } } } },
    { name: "14-refused-by-host", spec: { claim: c, state: "attach_pending", cls: "provider_rejected", obs: routing(c, []) } },
    {
      name: "15-securing-mixed-record-statuses",
      spec: {
        claim: c,
        state: "attached",
        cls: null,
        obs: routing(c, [
          [`www.${c}`, "wrong_value", "proxied"],
          [c, "conflicting", "leftover_aaaa", true],
        ]),
      },
      after: async (page) => {
        await page.getByRole("button", { name: /Why isn.t it working/ }).click();
        await expect(page.getByRole("region", { name: "Common causes" })).toBeVisible();
      },
    },
    { name: "16-live-pair", spec: { claim: c, state: "live", cls: "ok", obs: routing(c, [[`www.${c}`, "correct"], [c, "correct", null as never, true]]) } },
    { name: "17-live-paused", spec: { claim: c, state: "live", cls: "ok", hold: "paused", obs: routing(c, [[`www.${c}`, "correct"], [c, "correct", null as never, true]]) } },
    { name: "18-live-disputed", spec: { claim: c, state: "live", cls: "ok", hold: "disputed", obs: routing(c, [[`www.${c}`, "correct"], [c, "correct", null as never, true]]) } },
    { name: "19-lapsed", spec: { claim: c, state: "lapsed", cls: "proof_absent", obs: routing(c, [[`www.${c}`, "correct"], [c, "correct", null as never, true]]) } },
    { name: "20-parked-exit-checklist", spec: { claim: c, state: "parked", cls: null, obs: routing(c, [[`www.${c}`, "correct"], [c, "correct", null as never, true]]) } },
    { name: "21-releasing", spec: { claim: c, state: "release_pending", cls: null, obs: routing(c, [[`www.${c}`, "correct"], [c, "correct", null as never, true]]) } },
  ];

  for (const s of scenarios) {
    test(s.name, async () => {
      const page = await narrowPage();
      await setSiteStatus(sql, fx.orgId, s.name.startsWith("11-") ? "provisioning" : "live");
      await arrange(s.spec);
      await open(page);
      await expect(page.getByTestId("claim-card").first()).toBeVisible();
      if (s.after) await s.after(page);
      await shoot(page, s.name);
      await setSiteStatus(sql, fx.orgId, "live");
      await page.close();
    });
  }

  test("22-primary-advisory, add-another form and recent activity; 23-remove dialog; 24-make-primary dialog", async () => {
    const page = await narrowPage();
    await retireAllDomains(sql, fx.orgId);
    const a = `adv-a-${stamp}.invalid`;
    const b = `adv-b-${stamp}.invalid`;
    await addDomain(sql, { orgId: fx.orgId, hostname: `www.${a}`, claimName: a, role: "canonical", state: "lapsed", token: 31 });
    await addDomain(sql, { orgId: fx.orgId, hostname: `www.${b}`, claimName: b, role: "alias", state: "live", token: 32 });
    await open(page);
    await expect(page.getByTestId("primary-advisory")).toBeVisible();
    await shoot(page, "22-primary-advisory");
    await page.getByTestId("primary-advisory").getByRole("button").click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await shoot(page, "24-make-primary-dialog", { viewportOnly: true });
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
    await page.getByTestId("claim-card").filter({ hasText: `www.${b}` }).getByRole("button", { name: /^Remove/ }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await shoot(page, "23-remove-dialog", { viewportOnly: true });
    await page.getByRole("alertdialog").getByRole("button", { name: "Keep it" }).click();
    await page.close();
  });
});
