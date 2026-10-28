/**
 * community-sign-in-controls.spec.ts - the pre-hydration guard for the sign-in
 * card on the Community edit page (Community Increment 2b, Batch C; DECISION-159).
 * Same pattern as community-approval-controls.spec.ts: hold every
 * `/_next/static/**.js` chunk, load with `domcontentloaded`, assert the controls
 * are inoperable, release the scripts, use control enablement as the hydration
 * signal.
 *
 * The card's triggers (Send invitation, Send again, Cancel invitation) open
 * AlertDialogs over controlled state; none is a `useForm` root, so
 * `check:hydration-gate` does not see them and their guard is
 * `disabled={!useHydrated()}`. The dialogs themselves (and the acknowledgement
 * checkbox inside the send dialog) do not exist before hydration, so the
 * trigger being inoperable is the whole pre-hydration contract; the dialog and
 * the checkbox are driven after release. The PERSISTED state is the point: after a
 * pre-hydration click attempt the invitation must still be open and none sent.
 *
 * Runs in the default `chromium` project and, via `npm run test:e2e:prod`, in the
 * `prod-build` project.
 */
import { test, expect as baseExpect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { storageStatePath } from "../support/users";
import { platformSql, withDbRetry, type Sql } from "../support/db";
import {
  CLERK_EMAIL,
  COMMUNITY_ORG,
  createParticipantViaSql,
  removeCommunityFixture,
  setupCommunityFixture,
  sweepCommunityPeople,
  type CommunityFixtureState,
} from "../support/community-fixture";

const expect = baseExpect.configure({ timeout: 30_000 });

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

test.describe("Hydration - the sign-in card (DECISION-159)", () => {
  test.setTimeout(150_000);
  test.use({ storageState: storageStatePath("congregation-clerk") });

  let sql: Sql;
  let state: CommunityFixtureState;

  /**
   * Our invitation rows reference the fixture people, and a row is permanent by trigger
   * (revoke, never delete): the guard is disabled around the delete exactly as every other
   * fixture teardown does, inside a try/finally that re-enables it, and the whole unit is retried.
   */
  async function deleteFixtureInvitations() {
    try {
      await withDbRetry("delete hydration sign-in invitations", async () => {
        await sql`alter table account_invitations disable trigger account_invitations_guard_delete`;
        try {
          await sql`delete from account_invitations
                     where organization_id = ${COMMUNITY_ORG.id}::uuid and email_normalized like 'e2e-hydration-signin-%'`;
        } finally {
          await sql`alter table account_invitations enable trigger account_invitations_guard_delete`;
        }
      });
    } finally {
      await withDbRetry("re-enable invitation delete guard", () => sql`alter table account_invitations enable trigger account_invitations_guard_delete`);
    }
  }

  test.beforeAll(async () => {
    sql = platformSql("hydration/community-sign-in-controls.spec");
    await deleteFixtureInvitations();
    await sweepCommunityPeople(sql);
    state = await setupCommunityFixture(sql);
  });

  test.afterAll(async () => {
    try {
      await deleteFixtureInvitations();
    } finally {
      // Always restore the flags and the toggle, even if the delete above failed.
      await removeCommunityFixture(sql, state);
    }
  });

  async function personWithAddress(n: number, last: string, tag: string) {
    const person = await createParticipantViaSql(sql, n, last);
    const address = `e2e-hydration-signin-${tag}@example.invalid`;
    await sql`
      insert into contact_methods (person_id, kind, value, is_primary)
      values (${person.personId}::uuid, 'email', ${address}, true)`;
    return { ...person, address };
  }

  test("Send invitation is disabled until hydration, then opens its dialog; nothing was sent before it", async ({ page }) => {
    const person = await personWithAddress(95, "SpecHydrationSignInSend", "send");
    const release = await holdScripts(page);
    await page.goto(`/o/${COMMUNITY_ORG.slug}/admin/community/${person.personId}/edit`, { waitUntil: "domcontentloaded" });

    const card = page.getByTestId("sign-in-card");
    await expect(card).toBeVisible();
    const send = card.getByRole("button", { name: "Send invitation" });
    await expect(send).toBeDisabled();
    await send.click({ force: true }).catch(() => {});
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    const none = (await sql`select 1 from account_invitations where person_id = ${person.personId}::uuid`) as unknown[];
    expect(none).toHaveLength(0);

    release();

    await expect(send).toBeEnabled();
    await send.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(person.address);
    // Cancelling sends nothing.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    const still = (await sql`select 1 from account_invitations where person_id = ${person.personId}::uuid`) as unknown[];
    expect(still).toHaveLength(0);
  });

  test("Send again and Cancel invitation are disabled until hydration; the invitation is still open after forced clicks", async ({ page }) => {
    const person = await personWithAddress(96, "SpecHydrationSignInOpen", "open");
    const clerk = (await sql`select id from users where email = ${CLERK_EMAIL}`) as { id: string }[];
    const tokenHash = createHash("sha256").update(`hydration-signin-${Date.now()}`).digest("hex");
    const [inv] = (await sql`
      insert into account_invitations
        (organization_id, purpose, origin, email_normalized, person_id, token_hash, created_by_user_id, created_at, expires_at)
      values (${COMMUNITY_ORG.id}::uuid, 'sign_in', 'org', ${person.address}, ${person.personId}::uuid, ${tokenHash},
              ${clerk[0]!.id}::uuid, now() - interval '1 day', now() + interval '6 days')
      returning id`) as { id: string }[];

    const release = await holdScripts(page);
    await page.goto(`/o/${COMMUNITY_ORG.slug}/admin/community/${person.personId}/edit`, { waitUntil: "domcontentloaded" });

    const card = page.getByTestId("sign-in-card");
    await expect(card).toBeVisible();
    const again = card.getByRole("button", { name: "Send again" });
    const cancel = card.getByRole("button", { name: "Cancel invitation" });
    await expect(again).toBeDisabled();
    await expect(cancel).toBeDisabled();
    await again.click({ force: true }).catch(() => {});
    await cancel.click({ force: true }).catch(() => {});
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    const open = (await sql`select revoked_at, accepted_at from account_invitations where id = ${inv.id}::uuid`) as {
      revoked_at: Date | null;
      accepted_at: Date | null;
    }[];
    expect(open[0]!.revoked_at).toBeNull();
    expect(open[0]!.accepted_at).toBeNull();

    release();

    // The row was seeded a day ago, so the 5-minute resend cooldown is long over.
    await expect(again).toBeEnabled();
    await expect(cancel).toBeEnabled();
    await cancel.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep it" }).click();
    await expect(dialog).toHaveCount(0);
    const after = (await sql`select revoked_at from account_invitations where id = ${inv.id}::uuid`) as { revoked_at: Date | null }[];
    expect(after[0]!.revoked_at).toBeNull();
  });
});
