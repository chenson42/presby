/**
 * no-organization-controls.spec.ts - the pre-hydration guard for `/no-organization`'s
 * controls (Community Increment 2b, Batch C; DECISION-159). Same pattern as
 * community-approval-controls.spec.ts: hold every `/_next/static/**.js` chunk, load
 * with `domcontentloaded`, assert the controls are inoperable, release the scripts,
 * use control enablement as the hydration signal (no networkidle, no
 * waitForTimeout, no throttling).
 *
 * "Check again" and "Accept the invitation" are not `useForm` roots (small
 * `useActionState` islands), so `check:hydration-gate` does not see them; their
 * guard is `disabled={!useHydrated()}`. This spec proves it, and the PERSISTED state
 * is the point: after a pre-hydration click attempt the invitation must still be
 * open and no connection written.
 *
 * "Sign in with a different account" is a plain `<form action>` over a server
 * action and is meant to work before hydration (a native POST), so it is not
 * asserted disabled.
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in the
 * `prod-build` project.
 */
import { test, expect as baseExpect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { platformSql, type Sql } from "../support/db";
import {
  addRosterPerson,
  createThrowawayUser,
  inviteAddress,
  removeInviteOrg,
  rosterUserId,
  setupInviteOrg,
  THROWAWAY_PASSWORD,
  type InviteOrg,
} from "../support/invitation-fixture";
import { signInOnPage } from "../support/invitation-ui";

const expect = baseExpect.configure({ timeout: 30_000 });

/** Holds every `/_next/static/**.js` request until the returned function is called. */
async function holdScripts(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => {
    await released;
    await route.continue().catch(() => {});
  });
  return release;
}

test.describe("Hydration - /no-organization controls (DECISION-159)", () => {
  test.setTimeout(150_000);

  let sql: Sql;
  let org: InviteOrg | undefined;

  test.beforeAll(async () => {
    sql = platformSql("hydration/no-organization-controls.spec");
    org = await setupInviteOrg(sql);
  });

  test.afterAll(async () => {
    await removeInviteOrg(sql, org);
  });

  /** Signs in as a throwaway proven account, with scripts loaded, and lands on /no-organization. */
  async function signInUnlinked(page: Page, tag: string) {
    const user = await createThrowawayUser(sql, org!, { tag, name: "Hydration Account" });
    await page.goto("/signin");
    await signInOnPage(page, user.email, THROWAWAY_PASSWORD);
    await page.waitForURL(/\/no-organization/, { timeout: 45_000 });
    return user;
  }

  test("Check again is disabled until hydration; a forced click writes nothing; it works after", async ({ page }) => {
    // No toggle row at the fixture organization and no matching person: N0.
    const user = await signInUnlinked(page, "n0");

    const release = await holdScripts(page);
    await page.goto("/no-organization", { waitUntil: "domcontentloaded" });

    const check = page.getByRole("button", { name: "Check again" });
    await expect(check).toBeVisible();
    await expect(check).toBeDisabled();
    await check.click({ force: true }).catch(() => {});
    await expect(page.getByText("Nothing new yet.")).toHaveCount(0);
    const linked = (await sql`select 1 from people where user_id = ${user.id}::uuid`) as unknown[];
    expect(linked).toHaveLength(0);

    // The plain-form control is meant to work before hydration: present and not disabled.
    await expect(page.getByRole("button", { name: "Sign in with a different account" })).toBeEnabled();

    release();

    await expect(check).toBeEnabled();
    await check.click();
    await expect(page.getByText("Nothing new yet.")).toBeVisible();
  });

  test("Accept the invitation is disabled until hydration; the invitation is still open after a forced click", async ({ page }) => {
    const address = inviteAddress(org!, "inv");
    const personId = await addRosterPerson(sql, org!, { first: "Wendeline", last: "Ashgrove", email: address });
    const user = await createThrowawayUser(sql, org!, { tag: "inv", name: "Hydration Invitee" });
    const sender = await rosterUserId(sql, "admin");
    const tokenHash = createHash("sha256").update(`hydration-no-org-${org!.stamp}`).digest("hex");
    const [row] = (await sql`
      insert into account_invitations
        (organization_id, purpose, origin, email_normalized, person_id, token_hash, created_by_user_id, expires_at)
      values (${org!.orgId}::uuid, 'sign_in', 'org', ${address.toLowerCase()}, ${personId}::uuid, ${tokenHash},
              ${sender}::uuid, now() + interval '7 days')
      returning id`) as { id: string }[];

    await page.goto("/signin");
    await signInOnPage(page, user.email, THROWAWAY_PASSWORD);
    // An open invitation blocks auto-connect (FB5), so the account lands on the invitation card.
    await page.waitForURL(/\/no-organization/, { timeout: 45_000 });

    const release = await holdScripts(page);
    await page.goto("/no-organization", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1, name: /you're invited to/i })).toBeVisible();
    const accept = page.getByRole("button", { name: "Accept the invitation" });
    await expect(accept).toBeVisible();
    await expect(accept).toBeDisabled();
    await accept.click({ force: true }).catch(() => {});

    const open = (await sql`
      select accepted_at, revoked_at from account_invitations where id = ${row.id}::uuid`) as {
      accepted_at: Date | null;
      revoked_at: Date | null;
    }[];
    expect(open[0]!.accepted_at).toBeNull();
    expect(open[0]!.revoked_at).toBeNull();
    const linked = (await sql`select user_id from people where id = ${personId}::uuid`) as { user_id: string | null }[];
    expect(linked[0]!.user_id).toBeNull();

    release();

    await expect(accept).toBeEnabled();
  });
});
