/**
 * community-engagement-controls.spec.ts - the pre-hydration guard for the
 * Increment 3a controls (docs/work-log/2026-10-22-founding-admin-directory-inc3.md,
 * Phase 3 section 11; DECISION-159). Same pattern as community-sign-in-controls:
 * hold every `/_next/static/**.js` chunk, load with `domcontentloaded`, assert
 * the controls are inoperable, release the scripts, use control enablement as the
 * hydration signal (no networkidle, no waitForTimeout, no throttling).
 *
 * The row buttons (Mark as regular, Archive, Restore), the Engagement card's Save
 * and the nudge, and Save visit details are controlled client islands, not
 * `useForm` roots, so `check:hydration-gate` does not see them; their guard is
 * `disabled={!useHydrated()}`. The PERSISTED state is the point: after a
 * pre-hydration click attempt the membership must be exactly as it was and no
 * engagement, archive, restore or visit-details audit row may exist.
 *
 * A throwaway congregation (the invitation fixture) keeps this spec's rows out of
 * `e2e-alpha`; the sender signs in BEFORE the scripts are held, so the held load is
 * the page under test and not the sign-in. Runs in the default `chromium` project
 * and, via `npm run test:e2e:prod`, in the `prod-build` project.
 */
import { test, expect as baseExpect, type Page } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";
import { captureFlags, setFlag, type FlagCapture } from "../support/flags";
import {
  addSender,
  COMMUNITY_FLAG,
  removeSignInOrg,
  setOrgToggle,
  signInAs,
  type FixtureSender,
} from "../support/sign-in-invite-fixture";
import { setupInviteOrg, type InviteOrg } from "../support/invitation-fixture";

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

test.describe("Hydration - the Community engagement controls (DECISION-159)", () => {
  test.setTimeout(180_000);

  let sql: Sql;
  let flags: FlagCapture;
  let org: InviteOrg;
  let sender: FixtureSender;

  test.beforeAll(async () => {
    sql = platformSql("hydration/community-engagement-controls.spec");
    flags = await captureFlags(sql, [COMMUNITY_FLAG]);
    await setFlag(sql, COMMUNITY_FLAG, true);
    org = await setupInviteOrg(sql);
    await setOrgToggle(sql, org, COMMUNITY_FLAG, true);
    sender = await addSender(sql, org);
  });

  test.afterAll(async () => {
    try {
      await removeSignInOrg(sql, org);
    } finally {
      await flags.restore();
    }
  });

  async function person(first: string, last: string, engagement: string, opts: { archived?: boolean; participant?: boolean } = {}) {
    const [p] = (await sql`
      insert into people (first_name, last_name, deletable_until)
      values (${first}, ${last}, now() + interval '3 hours') returning id`) as { id: string }[];
    await sql`
      insert into memberships (organization_id, person_id, engagement_status, ended_on, ended_reason)
      values (${org.orgId}::uuid, ${p.id}::uuid, ${engagement},
              case when ${opts.archived === true} then current_date end,
              case when ${opts.archived === true} then 'community_archived' end)`;
    if (opts.participant) {
      await sql`
        insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll,
                                  approval_status, approved_on, recorded_at)
        values (${org.orgId}::uuid, ${p.id}::uuid, 'other_participant_enrolled', date '2026-01-15',
                'other_participant', 'approved', date '2026-01-15', now())`;
    }
    return { id: p.id, name: `${first} ${last}` };
  }

  async function stateOf(personId: string) {
    const rows = (await sql`
      select engagement_status, ended_on::text as ended_on, first_visit_date::text as first_visit_date
        from memberships where organization_id = ${org.orgId}::uuid and person_id = ${personId}::uuid`) as {
      engagement_status: string;
      ended_on: string | null;
      first_visit_date: string | null;
    }[];
    return rows[0]!;
  }

  async function auditCount(personId: string): Promise<number> {
    const rows = (await sql`
      select count(*)::int as n from audit_events
       where resource_id = ${personId}
         and action in ('tenant.person.engagement_changed', 'tenant.person.archived',
                        'tenant.person.restored', 'tenant.person.visit_details_updated')`) as { n: number }[];
    return rows[0]!.n;
  }

  test("the row buttons are disabled until hydration; forced clicks open nothing and write nothing", async ({ page }) => {
    const inactive = await person("Ainsley", "Hydrate", "inactive");
    const archived = await person("Bartholomew", "Hydrate", "visitor", { archived: true });
    await signInAs(page, sender.user, new RegExp(`/o/${org.slug}`));

    const release = await holdScripts(page);
    await page.goto(`/o/${org.slug}/admin/community?view=inactive`, { waitUntil: "domcontentloaded" });
    const mark = page.getByRole("button", { name: `Mark as regular ${inactive.name}`, exact: true });
    const archive = page.getByRole("button", { name: `Archive ${inactive.name}`, exact: true });
    await expect(mark).toBeVisible();
    await expect(mark).toBeDisabled();
    await expect(archive).toBeDisabled();
    await mark.click({ force: true }).catch(() => {});
    await archive.click({ force: true }).catch(() => {});
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect((await stateOf(inactive.id)).engagement_status).toBe("inactive");
    expect(await auditCount(inactive.id)).toBe(0);

    release();
    await expect(mark).toBeEnabled();
    await mark.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep as it is" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await stateOf(inactive.id)).engagement_status).toBe("inactive");

    // Former: Restore is held the same way.
    await page.unroute(/\/_next\/static\/.*\.js(\?.*)?$/);
    const release2 = await holdScripts(page);
    await page.goto(`/o/${org.slug}/admin/community?view=former`, { waitUntil: "domcontentloaded" });
    const restore = page.getByRole("button", { name: `Restore ${archived.name}`, exact: true });
    await expect(restore).toBeVisible();
    await expect(restore).toBeDisabled();
    await restore.click({ force: true }).catch(() => {});
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect((await stateOf(archived.id)).ended_on).not.toBeNull();
    expect(await auditCount(archived.id)).toBe(0);
    release2();
    await expect(restore).toBeEnabled();
    await restore.click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "Keep archived" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect((await stateOf(archived.id)).ended_on).not.toBeNull();
  });

  test("the Engagement card, the nudge and Save visit details are disabled until hydration; nothing was written before it", async ({ page }) => {
    const visitor = await person("Cordelia", "Hydrate", "visitor");
    const rolled = await person("Desmond", "Hydrate", "visitor", { participant: true });
    await signInAs(page, sender.user, new RegExp(`/o/${org.slug}`));

    // The visitor's record: the select, Save engagement and Save visit details.
    const release = await holdScripts(page);
    await page.goto(`/o/${org.slug}/admin/community/${visitor.id}/edit`, { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("engagement-card");
    await expect(card).toBeVisible();
    const select = card.getByLabel(`Engagement for ${visitor.name}`);
    const save = card.getByRole("button", { name: "Save engagement" });
    const form = page.getByTestId("visit-details-form");
    const saveVisit = form.getByRole("button", { name: "Save visit details" });
    await expect(select).toBeDisabled();
    await expect(save).toBeDisabled();
    await expect(saveVisit).toBeDisabled();
    await expect(form.getByLabel("First visit (optional)")).toBeDisabled();
    await saveVisit.click({ force: true }).catch(() => {});
    await save.click({ force: true }).catch(() => {});
    expect(await stateOf(visitor.id)).toMatchObject({ engagement_status: "visitor", first_visit_date: null });
    expect(await auditCount(visitor.id)).toBe(0);

    release();
    await expect(select).toBeEnabled();
    await expect(saveVisit).toBeEnabled();
    await expect(save, "off until something changes").toBeDisabled();
    await select.selectOption("inactive");
    await expect(save).toBeEnabled();

    // The rolled visitor's record: the nudge button.
    await page.unroute(/\/_next\/static\/.*\.js(\?.*)?$/);
    const release2 = await holdScripts(page);
    await page.goto(`/o/${org.slug}/admin/community/${rolled.id}/edit`, { waitUntil: "domcontentloaded" });
    const nudge = page.getByTestId("engagement-nudge").getByRole("button", { name: "Mark as regular attender" });
    await expect(nudge).toBeVisible();
    await expect(nudge).toBeDisabled();
    await nudge.click({ force: true }).catch(() => {});
    expect((await stateOf(rolled.id)).engagement_status).toBe("visitor");
    expect(await auditCount(rolled.id)).toBe(0);
    release2();
    await expect(nudge).toBeEnabled();
  });
});
