/**
 * community-engagement.spec.ts - Community Increment 3a, Batch D: engagement,
 * archive and restore, end to end against a running server, at a desktop width
 * and at 360px (docs/work-log/2026-10-22-founding-admin-directory-inc3.md,
 * Phase 3 section 11 and the Batch C "What Batch D needs" list).
 *
 * Who: a throwaway congregation (`e2e-invite-<stamp>`) with a SENDER, a linked
 * account holding people.manage, directory.view, officers.manage and
 * roll.propose by a custom role. Every person, account and audit-adjacent row
 * the spec makes goes with the congregation (the invitation fixture's
 * teardown), so a repeat run starts clean and the shared `e2e-alpha` fixture is
 * not touched (DECISION-157). People are written on the owner connection with
 * the engagement under test; no person-id range is claimed (the ids are
 * generated), and nothing is added to `e2e/support/*` (Workflow Rule 16).
 *
 *   1.  the Inactive and Visitors lists: seven nav segments with Inactive
 *       current, rows, details, row buttons at 44px, a long surname, nothing in
 *       Everyone;
 *   2.  the empty states of Inactive, Visitors and Former, and the
 *       no-match line;
 *   3.  Mark as regular from an Inactive row: the dialog and its auto-connect
 *       line, "Keep as it is" changes nothing, confirming writes one audit row
 *       and puts the person in Everyone;
 *   4.  the same dialog with the sign-in toggle OFF (no auto-connect line) and
 *       with a connected sign-in (the connected line, no auto-connect line);
 *   5.  Archive then Restore from the lists (Inactive and Visitors), with the
 *       connected-sign-in lines, "Keep" and "Keep archived", Former's detail,
 *       and the audit rows;
 *   6.  an archive the database refuses (a role is held) says so and writes
 *       nothing;
 *   7.  the Engagement card: Save is off until a change, a change that moves no
 *       listing saves at once, one that gives listing asks first;
 *   8.  the nudge for a person on the roll who is still marked Visitor, and the
 *       select not offering Visitor to them;
 *   9.  the stale form (`changed_meanwhile`) from the card and from the row: the
 *       error toast, nothing overwritten, no audit row, the page refreshed;
 *   10. Visit details: save, persist, the bad-date and too-long sentences under
 *       their fields, an audit row that never carries the text;
 *   11. Archive and Restore on the person's own record;
 *   12. the wizard's archived match: "Restore" there, then the restored record.
 *
 * FLAGS. `org_portal.members_create` (global) is captured, set and restored; the
 * congregation's own members_create and sign_in_connect toggles are written by
 * SQL on the throwaway congregation. No key is added to `e2e-baseline-flags.sql`.
 * There is no `org_portal.followups` toggle on this branch (it belongs to 3b),
 * so the toggle states exercised here are `sign_in_connect` on and off.
 */
import { test, expect as baseExpect, type Page } from "@playwright/test";
import { platformSql, withDbRetry, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  addAccount,
  addSender,
  auditFor,
  COMMUNITY_FLAG,
  CONNECT_TOGGLE,
  expectTargets44,
  grantCustomRole,
  linkUser,
  noHorizontalOverflow,
  removeSignInOrg,
  setOrgToggle,
  signInAs,
  VIEWPORTS,
  type FixtureAccount,
  type FixtureSender,
} from "./support/sign-in-invite-fixture";
import { setupInviteOrg, type InviteOrg } from "./support/invitation-fixture";

// The dev server compiles each route on first touch: give assertions room.
const expect = baseExpect.configure({ timeout: 30_000 });

type Engagement = "visitor" | "regular" | "inactive" | "moved_away";

interface Person {
  personId: string;
  first: string;
  last: string;
  name: string;
  email: string | null;
}

/** A person with a membership at the org carrying exactly the engagement under test (owner connection). */
async function addPerson(
  sql: Sql,
  org: InviteOrg,
  input: {
    first: string;
    last: string;
    engagement: Engagement;
    email?: string | null;
    firstVisit?: string | null;
    howHeard?: string | null;
    archived?: boolean;
    /** The person is on the participant roll (the enrolment is approved AFTER the membership, as the app does). */
    participant?: boolean;
  },
): Promise<Person> {
  const email = input.email ?? null;
  const [person] = (await sql`
    insert into people (first_name, last_name, deletable_until)
    values (${input.first}, ${input.last}, now() + interval '3 hours')
    returning id`) as { id: string }[];
  if (email !== null) {
    await sql`
      insert into contact_methods (person_id, kind, value, is_primary)
      values (${person.id}::uuid, 'email', ${email.trim().toLowerCase()}, true)`;
  }
  await sql`
    insert into memberships (organization_id, person_id, engagement_status, first_visit_date, how_heard, ended_on, ended_reason)
    values (${org.orgId}::uuid, ${person.id}::uuid, ${input.engagement},
            ${input.firstVisit ?? null}::date, ${input.howHeard ?? null},
            case when ${input.archived === true} then current_date end,
            case when ${input.archived === true} then 'community_archived' end)`;
  if (input.participant) {
    await sql`
      insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll,
                                approval_status, approved_on, recorded_at)
      values (${org.orgId}::uuid, ${person.id}::uuid, 'other_participant_enrolled', date '2026-01-15',
              'other_participant', 'approved', date '2026-01-15', now())`;
  }
  return { personId: person.id, first: input.first, last: input.last, name: `${input.first} ${input.last}`, email };
}

async function membershipOf(sql: Sql, org: InviteOrg, personId: string) {
  const rows = (await withDbRetry("read membership", () => sql`
    select engagement_status, current_roll, ended_on::text as ended_on, ended_reason, first_visit_date::text as first_visit_date, how_heard
      from memberships where organization_id = ${org.orgId}::uuid and person_id = ${personId}::uuid`)) as {
    engagement_status: string;
    current_roll: string | null;
    ended_on: string | null;
    ended_reason: string | null;
    first_visit_date: string | null;
    how_heard: string | null;
  }[];
  return rows[0]!;
}

test.describe("Community engagement, archive and restore (Increment 3a)", () => {
  test.setTimeout(240_000);

  let sql: Sql;
  let flags: FlagCapture;

  test.beforeAll(async () => {
    sql = platformSql("community-engagement.spec");
    flags = await captureFlags(sql, [COMMUNITY_FLAG]);
    await setFlag(sql, COMMUNITY_FLAG, true);
  });

  test.afterAll(async () => {
    await flags.restore();
  });

  for (const vp of VIEWPORTS) {
    test.describe(`at ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      let org: InviteOrg | undefined;
      let sender: FixtureSender;
      let base: string;

      test.beforeEach(async () => {
        org = await setupInviteOrg(sql);
        await setOrgToggle(sql, org, COMMUNITY_FLAG, true);
        // On by default for this spec; the toggle-off lane turns it off.
        await setOrgToggle(sql, org, CONNECT_TOGGLE, true);
        sender = await addSender(sql, org);
        base = `/o/${org.slug}/admin/community`;
      });

      test.afterEach(async () => {
        await removeSignInOrg(sql, org);
        org = undefined;
      });

      const dialog = (page: Page) => page.getByRole("alertdialog");
      const row = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

      async function signIn(page: Page) {
        await signInAs(page, sender.user, new RegExp(`/o/${org!.slug}`));
      }

      async function openList(page: Page, view: string, params = "") {
        await page.goto(`${base}?view=${view}${params}`);
        await expect(page.getByRole("heading", { level: 1, name: "Community" })).toBeVisible();
      }

      async function openRecord(page: Page, person: Person) {
        await page.goto(`${base}/${person.personId}/edit`);
        await expect(page.getByTestId("engagement-card").or(page.getByTestId("connection-card")).first()).toBeVisible({ timeout: 60_000 });
      }

      /** The dialog sits inside the viewport on both axes, and its buttons are 44px. */
      async function expectDialogFits(page: Page) {
        await expect(async () => {
          const box = (await dialog(page).boundingBox())!;
          expect(box).not.toBeNull();
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
          expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
          for (const button of await dialog(page).getByRole("button").all()) await expectTargets44(button);
        }).toPass({ timeout: 10_000 });
      }

      /** A throwaway sign-in account linked to the person: "a sign-in is connected". */
      async function connectSignIn(person: Person, tag: string): Promise<FixtureAccount> {
        const account = await addAccount(sql, org!, tag, { name: "Fixture Connected" });
        await linkUser(sql, person.personId, account.id);
        return account;
      }

      // -----------------------------------------------------------------
      test("1. the Inactive and Visitors lists: seven segments, rows, details, 44px buttons, a long surname, and neither list is in Everyone", async ({ page }) => {
        const longLast = "Wolfeschlegelsteinhausenbergerdorff-Featherstonehaugh"; // 53 characters, no break opportunity but the hyphen
        const inactive = await addPerson(sql, org!, { first: "Ainsley", last: "Quillfeather", engagement: "inactive" });
        const away = await addPerson(sql, org!, { first: "Bartholomew", last: "Hargrove", engagement: "moved_away" });
        const longName = await addPerson(sql, org!, { first: "Cordelia", last: longLast, engagement: "inactive" });
        const visitor = await addPerson(sql, org!, { first: "Desmond", last: "Pennywhistle", engagement: "visitor", firstVisit: "2026-05-03" });
        await signIn(page);

        await openList(page, "inactive");
        const nav = page.getByRole("group", { name: "Community view" });
        await expect(nav.getByRole("link")).toHaveCount(7);
        await expect(nav.getByRole("link", { name: "Inactive" })).toHaveAttribute("aria-current", "page");
        const tops = await nav.getByRole("link").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
        expect(new Set(tops).size, "the seven segments stay in one row").toBe(1);

        await expect(row(page, inactive.name)).toContainText("Inactive");
        await expect(row(page, away.name)).toContainText("Moved away");
        await expect(row(page, longName.name)).toBeVisible();
        await expect(row(page, visitor.name)).toHaveCount(0);
        for (const person of [inactive, away, longName]) {
          const buttons = [
            page.getByRole("button", { name: `Mark as regular ${person.name}`, exact: true }),
            page.getByRole("button", { name: `Archive ${person.name}`, exact: true }),
          ];
          for (const button of buttons) await expect(button).toBeVisible();
          await expectTargets44(...buttons);
        }
        await noHorizontalOverflow(page);

        await openList(page, "visitors");
        await expect(row(page, visitor.name)).toContainText(/first visit/i);
        await expect(page.getByRole("button", { name: `Archive ${visitor.name}`, exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: /^Mark as regular/ })).toHaveCount(0);
        await expect(row(page, inactive.name)).toHaveCount(0);
        await noHorizontalOverflow(page);

        // Neither an inactive person nor a visitor is in Everyone.
        for (const last of ["Quillfeather", "Hargrove", "Pennywhistle"]) {
          await page.goto(`${base}?search=${last}`);
          await expect(page.getByText(/no people match/i)).toBeVisible();
        }
      });

      // -----------------------------------------------------------------
      test("2. the empty states of Inactive, Visitors and Former, and the no-match lines", async ({ page }) => {
        await signIn(page);
        await openList(page, "inactive");
        await expect(page.getByText("No one is marked inactive or moved away")).toBeVisible();
        await expect(page.getByText("People on the roll who are marked inactive stay under Members or Participants.")).toBeVisible();
        await openList(page, "visitors");
        await expect(page.getByText("No visitors yet")).toBeVisible();
        await openList(page, "former");
        await expect(page.getByText("No one has been removed or archived")).toBeVisible();
        await expect(page.getByText("People you remove as participants or archive appear here.")).toBeVisible();
        await noHorizontalOverflow(page);

        for (const [view, noun] of [
          ["inactive", "inactive people"],
          ["former", "former people"],
          ["visitors", "visitors"],
        ] as const) {
          await openList(page, view, "&search=zzzzznomatch");
          await expect(page.getByText(new RegExp(`no ${noun} match "zzzzznomatch"`, "i"))).toBeVisible();
        }
      });

      // -----------------------------------------------------------------
      test("3. Mark as regular from an Inactive row: the dialog, Keep as it is changes nothing, confirming writes one audit row and lists the person", async ({ page }) => {
        const person = await addPerson(sql, org!, {
          first: "Ainsley",
          last: "Quillfeather",
          engagement: "inactive",
          email: `${org!.emailPrefix}ainsley@example.invalid`,
        });
        await signIn(page);
        await openList(page, "inactive");

        const open = page.getByRole("button", { name: `Mark as regular ${person.name}`, exact: true });
        await expect(open).toBeEnabled();
        await open.click();
        await expect(dialog(page)).toBeVisible();
        await expect(dialog(page).getByRole("heading", { name: `Mark ${person.name} as a regular attender?` })).toBeVisible();
        await expect(dialog(page)).toContainText("They can then appear in the member directory.");
        // The toggle is on, an address is on file and no sign-in is connected.
        await expect(dialog(page)).toContainText(
          `${person.name} could be connected to this record automatically when they sign in with an address on file.`,
        );
        await expect(dialog(page)).not.toContainText("has a sign-in connected");
        await expectDialogFits(page);

        // Keep as it is: closes, changes nothing.
        await dialog(page).getByRole("button", { name: "Keep as it is" }).click();
        await expect(dialog(page)).toHaveCount(0);
        expect((await membershipOf(sql, org!, person.personId)).engagement_status).toBe("inactive");
        expect(await auditFor(sql, "tenant.person.engagement_changed", person.personId)).toHaveLength(0);

        await open.click();
        await dialog(page).getByRole("button", { name: "Mark as regular attender", exact: true }).click();
        await expect(page.getByText(`${person.name} is now marked as a regular attender.`)).toBeVisible();
        await expect(dialog(page)).toHaveCount(0);
        await expect(row(page, person.name)).toHaveCount(0);

        expect((await membershipOf(sql, org!, person.personId)).engagement_status).toBe("regular");
        const audit = await auditFor(sql, "tenant.person.engagement_changed", person.personId);
        expect(audit).toHaveLength(1);
        expect(audit[0]!.metadata).toMatchObject({
          organizationId: org!.orgId,
          personId: person.personId,
          from: "inactive",
          to: "regular",
          standingFrom: "inactive",
          standingTo: "listed",
          signInConnected: false,
        });
        expect(audit[0]!.actor_user_id).toBe(sender.user.id);

        // Listed now: Everyone shows them.
        await page.goto(`${base}?search=Quillfeather`);
        await expect(row(page, person.name)).toBeVisible();
        await noHorizontalOverflow(page);
      });

      // -----------------------------------------------------------------
      test("4. the dialog's outlook follows the sign-in toggle and the connected sign-in", async ({ page }) => {
        const withAddress = await addPerson(sql, org!, {
          first: "Beatrix",
          last: "Cromwell",
          engagement: "inactive",
          email: `${org!.emailPrefix}beatrix@example.invalid`,
        });
        const connected = await addPerson(sql, org!, {
          first: "Cuthbert",
          last: "Dunmore",
          engagement: "inactive",
          email: `${org!.emailPrefix}cuthbert@example.invalid`,
        });
        await connectSignIn(connected, "connected");
        await signIn(page);

        // Toggle OFF: the auto-connect line would promise a connection that cannot happen, so it is not shown.
        await setOrgToggle(sql, org!, CONNECT_TOGGLE, false);
        await openList(page, "inactive");
        await page.getByRole("button", { name: `Mark as regular ${withAddress.name}`, exact: true }).click();
        await expect(dialog(page)).toContainText("They can then appear in the member directory.");
        await expect(dialog(page)).not.toContainText("connected to this record automatically");
        await dialog(page).getByRole("button", { name: "Keep as it is" }).click();
        await expect(dialog(page)).toHaveCount(0);

        // Toggle ON again: a connected person gets the connected line and still no auto-connect line.
        await setOrgToggle(sql, org!, CONNECT_TOGGLE, true);
        await openList(page, "inactive");
        await page.getByRole("button", { name: `Mark as regular ${connected.name}`, exact: true }).click();
        await expect(dialog(page)).toContainText(`${connected.name} has a sign-in connected, so this can also change what they can see.`);
        await expect(dialog(page)).not.toContainText("connected to this record automatically");
        await expectDialogFits(page);
        await dialog(page).getByRole("button", { name: "Keep as it is" }).click();
        await expect(dialog(page)).toHaveCount(0);
        expect((await membershipOf(sql, org!, connected.personId)).engagement_status).toBe("inactive");
      });

      // -----------------------------------------------------------------
      test("5. Archive then Restore from the lists: the connected lines, Keep and Keep archived, Former, and the audit rows", async ({ page }) => {
        const person = await addPerson(sql, org!, { first: "Ainsley", last: "Quillfeather", engagement: "inactive" });
        await connectSignIn(person, "archived");
        const visitor = await addPerson(sql, org!, { first: "Desmond", last: "Pennywhistle", engagement: "visitor" });
        await signIn(page);

        // Inactive: Archive.
        await openList(page, "inactive");
        const archive = page.getByRole("button", { name: `Archive ${person.name}`, exact: true });
        await expect(archive).toBeEnabled();
        await archive.click();
        await expect(dialog(page).getByRole("heading", { name: `Archive ${person.name}?` })).toBeVisible();
        await expect(dialog(page)).toContainText(
          `${person.name} will leave the Inactive list and appear under Former. Their record is kept and you can restore it any time.`,
        );
        await expect(dialog(page)).toContainText(
          `${person.name} has a sign-in connected and will no longer reach ${org!.name} through this record.`,
        );
        await expectDialogFits(page);
        await dialog(page).getByRole("button", { name: "Keep", exact: true }).click();
        await expect(dialog(page)).toHaveCount(0);
        expect((await membershipOf(sql, org!, person.personId)).ended_on).toBeNull();

        await archive.click();
        await dialog(page).getByRole("button", { name: "Archive", exact: true }).click();
        await expect(page.getByText(`${person.name} is archived. You can restore them from Former.`)).toBeVisible();
        await expect(row(page, person.name)).toHaveCount(0);
        const archived = await membershipOf(sql, org!, person.personId);
        expect(archived.ended_on).not.toBeNull();
        expect(archived.engagement_status).toBe("inactive"); // kept: it is what Restore returns to

        // Former: archived, dated, with Restore.
        await openList(page, "former");
        await expect(row(page, person.name)).toContainText(/^[\s\S]*Archived, /);
        const restore = page.getByRole("button", { name: `Restore ${person.name}`, exact: true });
        await expectTargets44(restore);
        await restore.click();
        await expect(dialog(page).getByRole("heading", { name: `Restore ${person.name}?` })).toBeVisible();
        await expect(dialog(page)).toContainText(`${person.name} will return to the Inactive list.`);
        await expect(dialog(page)).toContainText(`${person.name} has a sign-in connected and will reach ${org!.name} again.`);
        await expectDialogFits(page);
        await dialog(page).getByRole("button", { name: "Keep archived" }).click();
        await expect(dialog(page)).toHaveCount(0);
        expect((await membershipOf(sql, org!, person.personId)).ended_on).not.toBeNull();

        await restore.click();
        await dialog(page).getByRole("button", { name: "Restore", exact: true }).click();
        await expect(page.getByText(`${person.name} is back on the Inactive list.`)).toBeVisible();
        await expect(row(page, person.name)).toHaveCount(0);
        const restored = await membershipOf(sql, org!, person.personId);
        expect(restored.ended_on).toBeNull();
        expect(restored.ended_reason).toBeNull();
        await openList(page, "inactive");
        await expect(row(page, person.name)).toBeVisible();

        const archivedAudit = await auditFor(sql, "tenant.person.archived", person.personId);
        const restoredAudit = await auditFor(sql, "tenant.person.restored", person.personId);
        expect(archivedAudit).toHaveLength(1);
        expect(restoredAudit).toHaveLength(1);
        expect(archivedAudit[0]!.metadata).toMatchObject({ engagement: "inactive", signInConnected: true });
        expect(restoredAudit[0]!.metadata).toMatchObject({ engagement: "inactive", signInConnected: true });

        // Visitors: an archived visitor is "Archived visitor" in Former and returns to Visitors.
        await openList(page, "visitors");
        await page.getByRole("button", { name: `Archive ${visitor.name}`, exact: true }).click();
        await expect(dialog(page)).toContainText(`${visitor.name} will leave the Visitors list and appear under Former.`);
        await dialog(page).getByRole("button", { name: "Archive", exact: true }).click();
        await expect(page.getByText(`${visitor.name} is archived. You can restore them from Former.`)).toBeVisible();
        await openList(page, "former");
        await expect(row(page, visitor.name)).toContainText("Archived visitor");
        await page.getByRole("button", { name: `Restore ${visitor.name}`, exact: true }).click();
        await expect(dialog(page)).toContainText(`${visitor.name} will return to the Visitors list.`);
        await expect(dialog(page)).not.toContainText("has a sign-in connected");
        await dialog(page).getByRole("button", { name: "Restore", exact: true }).click();
        await expect(page.getByText(`${visitor.name} is back on the Visitors list.`)).toBeVisible();
        await openList(page, "visitors");
        await expect(row(page, visitor.name)).toBeVisible();
        await noHorizontalOverflow(page);
      });

      // -----------------------------------------------------------------
      test("6. an archive the database refuses (a role is held) says so, leaves the dialog open and writes nothing", async ({ page }) => {
        const person = await addPerson(sql, org!, { first: "Edmund", last: "Fairbairn", engagement: "inactive" });
        await grantCustomRole(sql, org!, {
          personId: person.personId,
          key: "e2e_held_role",
          name: "E2E held role",
          permissions: ["events.view"],
          grantedBy: sender.user.id,
        });
        await signIn(page);
        await openList(page, "inactive");
        await page.getByRole("button", { name: `Archive ${person.name}`, exact: true }).click();
        await dialog(page).getByRole("button", { name: "Archive", exact: true }).click();
        await expect(
          page.getByText("This person still holds an office, a role or a staff position here. End that first, then try again."),
        ).toBeVisible();
        await expect(dialog(page)).toBeVisible(); // stays open so the reader sees which person it was about
        expect((await membershipOf(sql, org!, person.personId)).ended_on).toBeNull();
        expect(await auditFor(sql, "tenant.person.archived", person.personId)).toHaveLength(0);
      });

      // -----------------------------------------------------------------
      test("7. the Engagement card: Save is off until a change; a change that moves no listing saves at once, one that gives listing asks first", async ({ page }) => {
        const person = await addPerson(sql, org!, { first: "Gwendolyn", last: "Holloway", engagement: "visitor" });
        await signIn(page);
        await openRecord(page, person);

        const card = page.getByTestId("engagement-card");
        const select = card.getByLabel(`Engagement for ${person.name}`);
        const save = card.getByRole("button", { name: "Save engagement" });
        await expect(select).toBeEnabled();
        await expect(select).toHaveValue("visitor");
        await expect(save).toBeDisabled();
        await expect(card).toContainText("Engagement is for your own care.");

        // Visitor -> Inactive moves no listing: no dialog, saved at once.
        await select.selectOption("inactive");
        await expect(card).toContainText("Inactive. Not attending lately. Does not appear in the member directory.");
        await expect(save).toBeEnabled();
        await save.click();
        await expect(page.getByText(`${person.name} is now marked as inactive.`)).toBeVisible();
        await expect(dialog(page)).toHaveCount(0);
        expect((await membershipOf(sql, org!, person.personId)).engagement_status).toBe("inactive");
        await expect(card.getByLabel(`Engagement for ${person.name}`)).toHaveValue("inactive");
        await expect(page.getByTestId("connection-card")).toContainText("Inactive");

        // Inactive -> Regular gives listing: the dialog asks first.
        await card.getByLabel(`Engagement for ${person.name}`).selectOption("regular");
        await expect(card).toContainText("Regular attender. Can appear in the member directory.");
        await card.getByRole("button", { name: "Save engagement" }).click();
        await expect(dialog(page).getByRole("heading", { name: `Mark ${person.name} as a regular attender?` })).toBeVisible();
        await expectDialogFits(page);
        await dialog(page).getByRole("button", { name: "Keep as it is" }).click();
        await expect(dialog(page)).toHaveCount(0);
        expect((await membershipOf(sql, org!, person.personId)).engagement_status).toBe("inactive");

        await card.getByRole("button", { name: "Save engagement" }).click();
        await dialog(page).getByRole("button", { name: "Mark as regular attender", exact: true }).click();
        await expect(page.getByText(`${person.name} is now marked as a regular attender.`)).toBeVisible();
        expect((await membershipOf(sql, org!, person.personId)).engagement_status).toBe("regular");
        const audit = await auditFor(sql, "tenant.person.engagement_changed", person.personId);
        expect(audit.map((r) => [r.metadata.from, r.metadata.to])).toEqual([
          ["visitor", "inactive"],
          ["inactive", "regular"],
        ]);
        await noHorizontalOverflow(page);
      });

      // -----------------------------------------------------------------
      test("8. the nudge: a person on the roll who is still marked Visitor is offered Regular attender, and Visitor is not selectable", async ({ page }) => {
        const person = await addPerson(sql, org!, { first: "Hortensia", last: "Ingleby", engagement: "visitor", participant: true });
        await signIn(page);
        await openRecord(page, person);

        const card = page.getByTestId("engagement-card");
        const nudge = page.getByTestId("engagement-nudge");
        await expect(nudge).toContainText(`${person.name} is still marked as a visitor. Mark as a regular attender?`);
        const select = card.getByLabel(`Engagement for ${person.name}`);
        await expect(select).toHaveValue("visitor");
        await expect(select.locator("option")).toHaveText(["Visitor (current)", "Regular attender", "Inactive", "Moved away"]);
        await expect(select.locator('option[value="visitor"]')).toBeDisabled();

        const button = nudge.getByRole("button", { name: "Mark as regular attender" });
        await expectTargets44(button);
        await button.click();
        await expect(page.getByText(`${person.name} is now marked as a regular attender.`)).toBeVisible();
        await expect(nudge).toHaveCount(0);

        const after = await membershipOf(sql, org!, person.personId);
        expect(after.engagement_status).toBe("regular");
        expect(after.current_roll, "the roll is never touched by engagement").toBe("other_participant");
        const audit = await auditFor(sql, "tenant.person.engagement_changed", person.personId);
        expect(audit).toHaveLength(1);
        // Listing did not change (the roll already listed them): the standing is `listed` on both sides.
        expect(audit[0]!.metadata).toMatchObject({ from: "visitor", to: "regular", standingFrom: "listed", standingTo: "listed" });
      });

      // -----------------------------------------------------------------
      test("9. the stale form: another change made meanwhile is never overwritten, from the card and from the row (changed_meanwhile)", async ({ page }) => {
        const viaCard = await addPerson(sql, org!, { first: "Isadora", last: "Jessamy", engagement: "visitor" });
        const viaRow = await addPerson(sql, org!, { first: "Jasper", last: "Kettleby", engagement: "inactive" });
        await signIn(page);

        // The card: the page rendered Visitor; someone else marks the person a regular attender; then Save (inactive).
        await openRecord(page, viaCard);
        const card = page.getByTestId("engagement-card");
        await card.getByLabel(`Engagement for ${viaCard.name}`).selectOption("inactive");
        await sql`
          update memberships set engagement_status = 'regular'
           where organization_id = ${org!.orgId}::uuid and person_id = ${viaCard.personId}::uuid`;
        await card.getByRole("button", { name: "Save engagement" }).click();
        await expect(
          page.getByText("This changed while you were looking. Reload the page to see the current setting."),
        ).toBeVisible();
        expect((await membershipOf(sql, org!, viaCard.personId)).engagement_status, "the other change stands").toBe("regular");
        expect(await auditFor(sql, "tenant.person.engagement_changed", viaCard.personId)).toHaveLength(0);
        // The page refreshed: the card now starts from the current value.
        await expect(card.getByLabel(`Engagement for ${viaCard.name}`)).toHaveValue("regular");

        // The row: the list rendered Inactive; the person is marked a regular attender meanwhile; then Mark as regular.
        await openList(page, "inactive");
        const open = page.getByRole("button", { name: `Mark as regular ${viaRow.name}`, exact: true });
        await expect(open).toBeEnabled();
        await sql`
          update memberships set engagement_status = 'moved_away'
           where organization_id = ${org!.orgId}::uuid and person_id = ${viaRow.personId}::uuid`;
        await open.click();
        await dialog(page).getByRole("button", { name: "Mark as regular attender", exact: true }).click();
        await expect(
          page.getByText("This changed while you were looking. Reload the page to see the current setting."),
        ).toBeVisible();
        await expect(dialog(page)).toHaveCount(0);
        expect((await membershipOf(sql, org!, viaRow.personId)).engagement_status, "the other change stands").toBe("moved_away");
        expect(await auditFor(sql, "tenant.person.engagement_changed", viaRow.personId)).toHaveLength(0);
        // Refreshed: the row now reads what is true.
        await expect(row(page, viaRow.name)).toContainText("Moved away");
      });

      // -----------------------------------------------------------------
      test("10. Visit details: save and persist, the bad-date and too-long sentences sit under their fields, and the audit row never carries the text", async ({ page }) => {
        const person = await addPerson(sql, org!, { first: "Lucinda", last: "Mapleton", engagement: "visitor" });
        await signIn(page);
        await openRecord(page, person);

        const form = page.getByTestId("visit-details-form");
        const date = form.getByLabel("First visit (optional)");
        const heard = form.getByLabel("How did they hear about us? (optional)");
        const save = form.getByRole("button", { name: "Save visit details" });
        await expect(save).toBeEnabled();
        await expectTargets44(save, date, heard);

        // A future date and an over-long text are refused with their own sentence, under their own field.
        await date.fill("2999-01-01");
        await save.click();
        await expect(form.getByRole("alert")).toHaveText("That date can't be used. Choose a date from 1900 up to today.");
        await heard.fill("x".repeat(201));
        await date.fill("2026-05-03");
        await save.click();
        await expect(form.getByRole("alert")).toHaveText("Keep this under 200 characters.");
        let stored = await membershipOf(sql, org!, person.personId);
        expect(stored.first_visit_date).toBeNull();
        expect(stored.how_heard).toBeNull();
        expect(await auditFor(sql, "tenant.person.visit_details_updated", person.personId)).toHaveLength(0);

        const secret = "A neighbor invited them to the harvest supper";
        await heard.fill(secret);
        await save.click();
        await expect(page.getByText("Visit details saved.")).toBeVisible();
        stored = await membershipOf(sql, org!, person.personId);
        expect(stored.first_visit_date).toBe("2026-05-03");
        expect(stored.how_heard).toBe(secret);

        // It persists across a reload and reaches the Visitors row.
        await openRecord(page, person);
        await expect(page.getByTestId("visit-details-form").getByLabel("First visit (optional)")).toHaveValue("2026-05-03");
        await expect(page.getByTestId("visit-details-form").getByLabel("How did they hear about us? (optional)")).toHaveValue(secret);
        await openList(page, "visitors");
        await expect(row(page, person.name)).toContainText(/first visit/i);

        const audit = await auditFor(sql, "tenant.person.visit_details_updated", person.personId);
        expect(audit).toHaveLength(1);
        expect(audit[0]!.metadata).toMatchObject({ firstVisitDateChanged: true, howHeardChanged: true });
        expect(JSON.stringify(audit[0]!.metadata)).not.toContain("harvest");
        await noHorizontalOverflow(page);
      });

      // -----------------------------------------------------------------
      test("11. Archive and Restore on the person's own record, and the card says why engagement can't be changed while archived", async ({ page }) => {
        const person = await addPerson(sql, org!, { first: "Marguerite", last: "Northcott", engagement: "moved_away" });
        await signIn(page);
        await openRecord(page, person);

        const archive = page.getByRole("button", { name: `Archive ${person.name}`, exact: true });
        await expectTargets44(archive);
        await archive.click();
        await expect(dialog(page).getByRole("heading", { name: `Archive ${person.name}?` })).toBeVisible();
        await dialog(page).getByRole("button", { name: "Archive", exact: true }).click();
        await expect(page.getByText(`${person.name} is archived. You can restore them from Former.`)).toBeVisible();

        await expect(page.getByTestId("connection-card")).toContainText("Archived");
        await expect(page.getByTestId("engagement-card")).toContainText(`${person.name} was archived. Restore them to change this.`);
        await expect(page.getByTestId("engagement-card").getByRole("combobox")).toHaveCount(0);
        await expect(page.getByTestId("visit-details-form")).toHaveCount(0);

        const restore = page.getByRole("button", { name: `Restore ${person.name}`, exact: true });
        await restore.click();
        await expect(dialog(page)).toContainText(`${person.name} will return to the Inactive list.`);
        await dialog(page).getByRole("button", { name: "Restore", exact: true }).click();
        await expect(page.getByText(`${person.name} is back on the Inactive list.`)).toBeVisible();
        await expect(page.getByTestId("connection-card")).toContainText("Moved away");
        await expect(page.getByTestId("engagement-card").getByLabel(`Engagement for ${person.name}`)).toHaveValue("moved_away");
        expect((await membershipOf(sql, org!, person.personId)).ended_on).toBeNull();
        await noHorizontalOverflow(page);
      });

      // -----------------------------------------------------------------
      test("12. the wizard's archived match offers Restore, and the administrator lands on the restored record", async ({ page }) => {
        const person = await addPerson(sql, org!, { first: "Eleanor", last: "Visitor", engagement: "visitor", archived: true });
        await signIn(page);
        await page.goto(`${base}/new`);
        const firstName = page.getByLabel(/^first name/i);
        await expect(firstName).toBeEnabled();
        await firstName.fill(person.first);
        await page.getByLabel(/^last name/i).fill(person.last);
        await page.getByRole("button", { name: /^search$/i }).click();

        await expect(page.getByText(/is already in this community/i)).toBeVisible();
        await expect(page.getByText(/^They were archived on /)).toBeVisible();
        await expect(page.getByRole("button", { name: /^yes, this is/i })).toHaveCount(0);
        const restore = page.getByRole("button", { name: /^Restore /i });
        await expect(restore).toBeEnabled();
        await expectTargets44(restore);
        await noHorizontalOverflow(page);
        await restore.click();
        await expect(dialog(page)).toContainText("will return to the Visitors list.");
        await expect(dialog(page)).not.toContainText("has a sign-in connected"); // the wizard never reads it
        await dialog(page).getByRole("button", { name: "Restore", exact: true }).click();

        await page.waitForURL(new RegExp(`/admin/community/${person.personId}/edit`), { timeout: 60_000 });
        await expect(page.getByTestId("connection-card")).toContainText("Visitor", { timeout: 60_000 });
        const restored = await membershipOf(sql, org!, person.personId);
        expect(restored.ended_on).toBeNull();
        expect(restored.engagement_status).toBe("visitor");
        expect(await auditFor(sql, "tenant.person.restored", person.personId)).toHaveLength(1);
      });
    });
  }
});
