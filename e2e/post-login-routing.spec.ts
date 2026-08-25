/**
 * post-login-routing.spec.ts — where a signed-in person actually lands.
 *
 * P0 changes `sanitizeCallbackUrl`'s fallback and the Edge gate in
 * `src/proxy.ts`, so CLAUDE.md's Phase 4 gate applies in full: a running-server
 * smoke over the whole login path, INCLUDING an MFA-enrolled user, before
 * Phase 5 opens. Tests 1–5 are that smoke. Tests 6–12 are the ones that make
 * the feature verified in a browser rather than by unit test — the chooser, the
 * single-organization forward, the four-way miss response and the one screen
 * that renders a date.
 *
 * These sign in through the FORM rather than injecting storageState, because
 * the thing under test is what happens between submitting credentials and
 * arriving somewhere. A cached session skips exactly that.
 *
 * Fixtures: e2e/support/users.ts (users) and e2e/support/seed-orgs.ts
 * (organizations and relationships), both provisioned by globalSetup.
 */

import { test, expect, type Page } from "@playwright/test";
import { E2E_USERS, storageStatePath } from "./support/users";
import { E2E_ORGS, E2E_ENDED_ON } from "./support/seed-orgs";

/**
 * Sign-in is TWO soft navigations, not one, and a spec that waits for the first
 * lands on `/launch` and asserts against a page that is about to redirect.
 *
 * The server action throws NEXT_REDIRECT to `/launch`; the client soft-navigates
 * there; `/launch` computes the destination and redirects again. Both hops
 * update the URL, so the destination is the first URL that is neither.
 *
 * A user sees the same thing — a brief `/launch` in the address bar. That is
 * inherent to having a router page and is the cost of the matrix living in one
 * testable file instead of being smeared across sign-in, the OAuth callback and
 * /totp.
 */
async function signInAndLand(page: Page, role: keyof typeof E2E_USERS) {
  const user = E2E_USERS[role];
  await page.goto("/signin");
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: /sign in with email/i }).click();
  await page.waitForURL(
    (u) => u.pathname !== "/signin" && u.pathname !== "/launch",
    { timeout: 15_000 },
  );
}

// ---------------------------------------------------------------------------
// The auth-path smoke (mandatory before Phase 5)
// ---------------------------------------------------------------------------

test("1 — a platform admin with no congregations lands on /admin", async ({
  page,
}) => {
  // Zero enterable organizations + canAccessAdmin + NOT isPlatformAdmin. The
  // brief's "if you are only a super admin you would go straight into the admin
  // page", and the row that would break if the two platform predicates were
  // ever collapsed into one (DECISION-044).
  await signInAndLand(page, "admin");

  expect(new URL(page.url()).pathname).toBe("/admin");
});

test("2 — a signed-in user with no congregation lands on /no-organization", async ({
  page,
}) => {
  await signInAndLand(page, "member");

  expect(new URL(page.url()).pathname).toBe("/no-organization");
  await expect(
    page.getByRole("heading", { name: /not connected to a congregation/i }),
  ).toBeVisible();
  // The funnel, not a dead end: both doors must be on the page.
  await expect(page.getByText(/ask your church administrator/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /read about presby/i })).toBeVisible();
});

test("3 — an MFA-required user is walked from /admin into enrolment", async ({
  page,
}) => {
  // The MFA leg the Phase 4 gate names, and a deliberate behavior change: this
  // fixture used to land on /home, where the 2FA gate did not apply. It now
  // routes straight to /admin, which IS gated, so the two-hop chain
  // (proxy → /totp → /account/2fa) fires on the first screen after sign-in.
  // That is DECISION-037 working, and it is the reason the gate was pulled
  // forward rather than left to P1.
  await signInAndLand(page, "mfa-admin");

  await expect(page).toHaveURL(/\/account\/2fa/);
  // CONTRACT CHANGE (docs/work-log/2026-08-24-totp-callback-bypass-fix.md):
  // signInWithCredentials now evaluates the 2FA predicate itself and
  // redirects straight to /totp with the RAW callbackUrl this sign-in
  // submitted ("/launch" — no explicit callbackUrl was on the /signin URL),
  // skipping the /launch hop entirely rather than letting /launch compute
  // "/admin" first. /totp then forwards that same value on to /account/2fa
  // unenrolled. Not a security change — see actions.ts's IMPLEMENTATION NOTE
  // and member-home.spec.ts's matching assertion for the full trace.
  expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/launch");
});

test("4 — a deep link to an organization survives the sign-in round trip", async ({
  page,
}) => {
  await page.goto(`/o/${E2E_ORGS.alpha.slug}`);

  const bounced = new URL(page.url());
  expect(bounced.pathname).toBe("/signin");
  expect(bounced.searchParams.get("callbackUrl")).toBe(
    `/o/${E2E_ORGS.alpha.slug}`,
  );

  await page.locator('input[name="email"]').fill(E2E_USERS["org-single"].email);
  await page
    .locator('input[name="password"]')
    .fill(E2E_USERS["org-single"].password);
  await page.getByRole("button", { name: /sign in with email/i }).click();
  await page.waitForURL(
    (u) => u.pathname !== "/signin" && u.pathname !== "/launch",
    { timeout: 15_000 },
  );

  expect(new URL(page.url()).pathname).toBe(`/o/${E2E_ORGS.alpha.slug}`);
  await expect(
    page.getByRole("heading", { name: E2E_ORGS.alpha.name }),
  ).toBeVisible();
});

test.describe("5 — /launch never leaves the origin", () => {
  test.use({ storageState: storageStatePath("org-single") });

  test("an absolute ?next= is discarded, not followed", async ({ page }) => {
    // sanitizeCallbackUrl returns "/launch" for anything absolute, and the loop
    // guard in computeDestination then drops it — so the user reaches their
    // normal destination rather than evil.com and rather than a redirect loop.
    // The v0.3 open-redirect regression lives here.
    await page.goto("/launch?next=https://evil.com/steal");

    const url = new URL(page.url());
    expect(url.origin).toBe(new URL(page.url()).origin);
    expect(url.hostname).not.toBe("evil.com");
    expect(url.pathname).toBe(`/o/${E2E_ORGS.alpha.slug}`);
  });
});

// ---------------------------------------------------------------------------
// The destination matrix, in a browser
// ---------------------------------------------------------------------------

test("6 — one organization forwards straight into it, with no chooser", async ({
  page,
}) => {
  await signInAndLand(page, "org-single");

  expect(new URL(page.url()).pathname).toBe(`/o/${E2E_ORGS.alpha.slug}`);
});

test("7 — two organizations get the chooser, with no membership language", async ({
  page,
}) => {
  await signInAndLand(page, "org-multi");

  expect(new URL(page.url()).pathname).toBe("/orgs");

  const cards = page.getByRole("link", { name: /presbyter/i });
  await expect(
    page.getByRole("heading", { name: E2E_ORGS.alpha.name }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: E2E_ORGS.presbytery.name }),
  ).toBeVisible();
  expect(await cards.count()).toBe(2);

  // DECISION-039: a card is a RELATIONSHIP, not a roll status. The elder on a
  // presbytery committee and the secretary who worships elsewhere both get one,
  // and "member of" is wrong for both.
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/\bmember\b/i);
  expect(body).not.toMatch(/\broll\b/i);

  // Both links resolve to a real portal rather than an error page.
  for (const slug of [E2E_ORGS.alpha.slug, E2E_ORGS.presbytery.slug]) {
    await page.goto(`/o/${slug}`);
    await expect(page.getByText(/you're in/i)).toBeVisible();
  }
});

test("8 — a relationship at a non-tenant congregation is not a card", async ({
  page,
}) => {
  // The presbytery holds records about congregations that are not tenants (D9).
  // There is no portal behind one, so it yields no card and no route — but the
  // copy must be truer than "you're not connected to a congregation".
  await signInAndLand(page, "org-unmanaged");

  expect(new URL(page.url()).pathname).toBe("/no-organization");
  await expect(page.getByText(E2E_ORGS.gamma.name)).toBeVisible();
  await expect(page.getByText(/isn't set up on presby yet/i)).toBeVisible();
});

test.describe("9 — the four-way miss response (DECISION-040)", () => {
  test.use({ storageState: storageStatePath("org-single") });

  test("names the organization, identically for a tenant and a non-tenant, and 404s an unknown slug", async ({
    page,
  }) => {
    // THE ASSERTION THIS WHOLE TEST EXISTS FOR. e2e-beta is `managed` and
    // e2e-gamma is `unmanaged`. The org tree is public, so naming them leaks
    // nothing; which congregations are TENANTS is commercial information
    // PC(USA) does not publish, so the two responses must be one string.
    const copy: string[] = [];
    for (const org of [E2E_ORGS.beta, E2E_ORGS.gamma]) {
      const response = await page.goto(`/o/${org.slug}`);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { name: new RegExp(org.name, "i") }),
      ).toBeVisible();
      copy.push(
        (await page.locator("main").innerText()).replaceAll(org.name, "«ORG»"),
      );
      // No status-dependent tell anywhere on the page.
      expect(copy.at(-1)).not.toMatch(/set up|invited|managed|tenant/i);
    }
    expect(copy[0]).toBe(copy[1]);

    // A slug that is in no organization at all is the one genuinely different
    // answer, and it carries a real 404 rather than a rendered look-alike.
    const missing = await page.goto("/o/no-such-congregation");
    expect(missing?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: /couldn't find that organization/i }),
    ).toBeVisible();
  });
});

test.describe("10 — the chooser is a convenience, never a gate", () => {
  test.use({ storageState: storageStatePath("org-single") });

  test("/orgs renders for a one-organization user instead of auto-forwarding", async ({
    page,
  }) => {
    // If /orgs auto-forwarded, a platform admin with no congregations could
    // never reach the Developer card — which is why the decision and the
    // surface are two separate routes.
    await page.goto("/orgs");

    expect(new URL(page.url()).pathname).toBe("/orgs");
    await expect(
      page.getByRole("heading", { name: E2E_ORGS.alpha.name }),
    ).toBeVisible();
  });
});

test.describe("11 — an ended relationship is named and dated", () => {
  test.use({ storageState: storageStatePath("org-ended") });

  test("says the organization and the correct calendar day", async ({
    page,
  }) => {
    await page.goto(`/o/${E2E_ORGS.beta.slug}`);

    await expect(
      page.getByRole("heading", { name: new RegExp(E2E_ORGS.beta.name, "i") }),
    ).toBeVisible();
    await expect(page.getByText(/has ended/i).first()).toBeVisible();

    // THE DATE, WHICH IS THE POINT. `ended_on` is a calendar date — no time,
    // no zone — and it must read as the 31st for every viewer. Parsed as UTC
    // midnight and formatted locally it becomes the 30th west of UTC, which is
    // the bug fixed in two layers: the SQL cast in userOrganizations() and the
    // calendar-date branch in <FormattedDate>. The <time> element carries the
    // machine-readable value; the day number is what a human reads.
    const day = E2E_ENDED_ON.slice(-2);
    const previousDay = String(Number(day) - 1);
    const time = page.locator("time").first();
    await expect(time).toHaveAttribute("datetime", E2E_ENDED_ON);
    const rendered = await time.innerText();
    expect(rendered).toContain(day);
    expect(rendered).not.toContain(previousDay);
  });
});

test.describe("12 — the chooser is reachable without typing a URL", () => {
  test.use({ storageState: storageStatePath("org-multi") });

  test("the org switcher reaches the chooser without typing a URL", async ({
    page,
  }) => {
    // /launch forwards you through the chooser once, at sign-in. Without a way
    // back, a user with two congregations has no route to the second one.
    //
    // CONTRACT CHANGE: the bare "Organizations" link is now the org switcher's
    // trigger, and the chooser is the last item inside it. The property being
    // asserted — /orgs is reachable from the header on any signed-in page — is
    // unchanged.
    await page.goto("/home");

    await page.getByTestId("org-switcher-trigger").click();
    const all = page.getByRole("menuitem", { name: "All organizations" });
    await expect(all).toBeVisible();
    await all.click();
    await page.waitForURL((u) => u.pathname === "/orgs");
  });
});
