/**
 * person-emails.spec.ts - several email addresses per person, end to end
 * against a running server (2026-10-23-person-emails, Batch 3), at a desktop
 * width and at 360px.
 *
 * Who: `congregation-clerk` at e2e-alpha, who holds the spec-owned
 * `e2e_community_clerk` role (people.manage, roll.propose, directory.view); see
 * e2e/support/community-fixture.ts. People are `E2ECommunity ...` participants
 * written through the owner connection; addresses are `example.invalid`.
 *
 * What it proves, by walking the real UI and then reading what was PERSISTED:
 *   - the editor on a person's edit page: add a Work address, make it Main,
 *     remove the Main through the AlertDialog and see the promotion toast;
 *   - the audit rows for each change carry ids and labels and never an address;
 *   - the "Also on file for {Name}" note for an address another person holds;
 *   - the Add person wizard's list, with the search-step address pre-filled;
 *   - the member directory shows the Main address plus a staff member's Work
 *     address;
 *   - at 360px: one column, 44px targets, a dialog that fits, no overflow.
 */

import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { platformSql, type Sql } from "./support/db";
import {
  COMMUNITY_ORG,
  createParticipantViaSql,
  removeCommunityFixture,
  setupCommunityFixture,
  sweepCommunityPeople,
  type CommunityFixtureState,
} from "./support/community-fixture";
import {
  addContactEmail,
  addOpenStaffPosition,
  dbNow,
  emailAudit,
  sweepEmailExtras,
  emailRows,
  removeEmailExtras,
} from "./support/person-emails-fixture";

const BASE = `/o/${COMMUNITY_ORG.slug}/admin/community`;
const DIRECTORY = `/o/${COMMUNITY_ORG.slug}/directory`;
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800, n: 40 },
  { name: "360px", width: 360, height: 740, n: 50 },
] as const;

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Opens a person's edit page and waits for hydration (the Save button is the signal). */
async function openEdit(page: Page, personId: string) {
  await page.goto(`${BASE}/${personId}/edit`);
  // The edit page compiles on first touch in a dev server: allow for it.
  await expect(page.getByRole("button", { name: /^save$/i })).toBeEnabled({ timeout: 45_000 });
}

const addressInputs = (page: Page) => page.getByLabel("Email address", { exact: true });

test.describe("Person emails", () => {
  test.setTimeout(180_000);

  let sql: Sql;
  let state: CommunityFixtureState;
  const personIds: string[] = [];

  test.beforeAll(async () => {
    sql = platformSql("person-emails.spec");
    await sweepEmailExtras(sql); // a crashed prior run's staff positions block the sweep below
    await sweepCommunityPeople(sql); // a crashed prior run
    state = await setupCommunityFixture(sql);
  });

  test.afterAll(async () => {
    await removeEmailExtras(sql, personIds);
    await removeCommunityFixture(sql, state);
  });

  for (const vp of VIEWPORTS) {
    test.describe(`at ${vp.name}`, () => {
      test.use({
        storageState: storageStatePath("congregation-clerk"),
        viewport: { width: vp.width, height: vp.height },
      });

      test("add a Work address, make it Main, remove the Main and see the promotion; nothing persisted leaks an address into audit", async ({ page }) => {
        const since = await dbNow(sql);
        const person = await createParticipantViaSql(sql, vp.n, `SpecEmails${vp.n}`);
        personIds.push(person.personId);
        const personal = `e2e-${vp.n}-home@example.invalid`;
        const work = `e2e-${vp.n}-work@example.invalid`;
        await addContactEmail(sql, person.personId, { value: personal, subtype: "personal", isPrimary: true });

        // The editor lists the saved address as Main, one column, with 44px targets.
        await openEdit(page, person.personId);
        await expect(addressInputs(page)).toHaveCount(1);
        await expect(addressInputs(page).first()).toHaveValue(personal);
        await expect(page.getByText("Main", { exact: true })).toBeVisible();
        const removeFirst = page.getByRole("button", { name: "Remove email address 1" });
        expect((await removeFirst.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await noHorizontalOverflow(page);

        // Add a Work address and save: still Main = the personal one.
        await page.getByRole("button", { name: /^add another email address$/i }).click();
        await addressInputs(page).nth(1).fill(work.toUpperCase());
        await page.getByLabel("Label", { exact: true }).nth(1).selectOption("work");
        await noHorizontalOverflow(page);
        await page.getByRole("button", { name: /^save$/i }).click();
        // The toast outlives the redirect; assert it first, then the landing.
        await expect(page.getByText("Person updated.", { exact: true })).toBeVisible({ timeout: 45_000 });
        await page.waitForURL(new RegExp(`${BASE}$`), { timeout: 45_000 });

        let rows = await emailRows(sql, person.personId);
        expect(rows.map((r) => [r.value, r.subtype, r.is_primary, r.ended])).toEqual([
          [personal, "personal", true, false],
          [work, "work", false, false],
        ]);

        // Make the Work address Main.
        await openEdit(page, person.personId);
        await expect(addressInputs(page)).toHaveCount(2);
        await page.getByRole("radio", { name: "Main address" }).nth(1).check();
        await page.getByRole("button", { name: /^save$/i }).click();
        await page.waitForURL(new RegExp(`${BASE}$`), { timeout: 45_000 });
        rows = await emailRows(sql, person.personId);
        expect(rows.map((r) => [r.value, r.is_primary])).toEqual([
          [personal, false],
          [work, true],
        ]);

        // Remove the Main: the dialog names the address that becomes Main.
        await openEdit(page, person.personId);
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
        // The Main address is listed first once it is saved as Main.
        await expect(addressInputs(page).first()).toHaveValue(work);
        await page.getByRole("button", { name: "Remove email address 1" }).click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText("Remove this email address?");
        await expect(dialog).toContainText(`${work} will stop being used`);
        await expect(dialog).toContainText(`It is the main address, so ${personal} will become the main address.`);
        // The dialog zooms in: measure once it has settled.
        const keep = dialog.getByRole("button", { name: /^keep$/i });
        await expect(async () => {
          const box = (await dialog.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
          expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
          expect((await keep.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }).toPass({ timeout: 10_000 });
        await dialog.getByRole("button", { name: /^remove$/i }).click();
        await expect(addressInputs(page)).toHaveCount(1);
        await page.getByRole("button", { name: /^save$/i }).click();

        // The promotion is said out loud, and the database agrees.
        await expect(page.getByText(`Person updated. Now the main address: ${personal}.`)).toBeVisible({
          timeout: 45_000,
        });
        await page.waitForURL(new RegExp(`${BASE}$`), { timeout: 45_000 });
        rows = await emailRows(sql, person.personId);
        expect(rows.map((r) => [r.value, r.is_primary, r.ended])).toEqual([
          [personal, true, false],
          [work, false, true],
        ]);

        // The audit trail: ids and labels, never an address; the promotion was automatic.
        const audit = await emailAudit(sql, person.personId, since);
        // (Rows written in one transaction share a timestamp, so compare as a set.)
        expect(audit.map((a) => a.action).sort()).toEqual([
          "tenant.person_email.added",
          "tenant.person_email.ended",
          "tenant.person_email.primary_changed",
          "tenant.person_email.primary_changed",
        ]);
        const changes = audit
          .filter((a) => a.action === "tenant.person_email.primary_changed")
          .map((a) => (a.metadata as { automatic: boolean }).automatic)
          .sort();
        expect(changes).toEqual([false, true]); // the explicit switch, then the automatic promotion
        for (const a of audit) expect(JSON.stringify(a.metadata)).not.toContain("@");
      });

      test("an address another person here already holds saves, with an 'Also on file for' note", async ({ page }) => {
        const other = await createParticipantViaSql(sql, vp.n + 1, `SpecEmailsOther${vp.n}`);
        const person = await createParticipantViaSql(sql, vp.n + 2, `SpecEmailsShare${vp.n}`);
        personIds.push(other.personId, person.personId);
        const shared = `e2e-${vp.n}-shared@example.invalid`;
        await addContactEmail(sql, other.personId, { value: shared, isPrimary: true });

        await openEdit(page, person.personId);
        await expect(page.getByText("No email address on file.")).toBeVisible();
        await page.getByRole("button", { name: /^add an email address$/i }).click();
        await addressInputs(page).first().fill(shared);
        await page.getByRole("button", { name: /^save$/i }).click();
        await expect(page.getByText("Also on file for E2ECommunity SpecEmailsOther" + vp.n)).toBeVisible({
          timeout: 45_000,
        });
        // Same toast group: assert the body before the redirect eats its 10 seconds.
        await expect(page.getByText(`${shared} is saved on both records.`)).toBeVisible();
        await page.waitForURL(new RegExp(`${BASE}$`), { timeout: 45_000 });
        // It saved: households share a mailbox.
        expect((await emailRows(sql, person.personId)).map((r) => [r.value, r.is_primary])).toEqual([[shared, true]]);
      });

      test("field errors read, keep the page, and save nothing", async ({ page }) => {
        const person = await createParticipantViaSql(sql, vp.n + 3, `SpecEmailsErr${vp.n}`);
        personIds.push(person.personId);
        await addContactEmail(sql, person.personId, { value: `e2e-${vp.n}-err@example.invalid`, isPrimary: true });

        await openEdit(page, person.personId);
        await addressInputs(page).first().fill("not an address");
        await page.getByRole("button", { name: /^save$/i }).click();
        await expect(page.getByText("Enter a valid email address.")).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/${person.personId}/edit$`));
        await noHorizontalOverflow(page);
        expect((await emailRows(sql, person.personId)).map((r) => r.value)).toEqual([`e2e-${vp.n}-err@example.invalid`]);
      });

      test("the Add person wizard takes a list of addresses and pre-fills the first from the search step", async ({ page }) => {
        const last = `SpecEmailsWizard${vp.n}`;
        const first = `e2e-${vp.n}-wiz@example.invalid`;
        const second = `e2e-${vp.n}-wizwork@example.invalid`;
        await page.goto(`${BASE}/new`);
        const firstName = page.getByLabel(/^first name/i);
        await expect(firstName).toBeEnabled({ timeout: 45_000 });
        await firstName.fill("E2ECommunity");
        await page.getByLabel(/^last name/i).fill(last);
        await page.getByLabel(/^email/i).fill(first);
        await page.getByRole("button", { name: /^search$/i }).click();
        await expect(page.getByText(/name & birth date/i)).toBeVisible();
        await page.getByRole("button", { name: /^next$/i }).click();
        await expect(page.getByText(/contact & address/i)).toBeVisible();

        // Pre-filled from the search step; a second, Work row.
        await expect(addressInputs(page)).toHaveCount(1);
        await expect(addressInputs(page).first()).toHaveValue(first);
        await page.getByRole("button", { name: /^add another email address$/i }).click();
        await addressInputs(page).nth(1).fill(second);
        await page.getByLabel("Label", { exact: true }).nth(1).selectOption("work");
        await noHorizontalOverflow(page);
        await page.getByRole("button", { name: /^next$/i }).click();
        await expect(page.getByText(/^household$/i)).toBeVisible();
        await page.getByRole("button", { name: /^next$/i }).click();
        await expect(page.getByLabel(/how is this person connected/i)).toBeVisible();
        await page.getByRole("button", { name: /^next$/i }).click();

        // The review lists every address with its tags.
        await expect(page.getByText(`${first} (Main)`)).toBeVisible();
        await expect(page.getByText(`${second} (Work)`)).toBeVisible();
        await page.getByRole("button", { name: /add person/i }).click();
        await page.waitForURL(/view=visitors/, { timeout: 45_000 });

        const created = (await sql`
          select p.id from people p
           where p.first_name = 'E2ECommunity' and p.last_name = ${last}`) as { id: string }[];
        expect(created).toHaveLength(1);
        personIds.push(created[0]!.id);
        expect((await emailRows(sql, created[0]!.id)).map((r) => [r.value, r.subtype, r.is_primary])).toEqual([
          [first, null, true],
          [second, "work", false],
        ]);
      });

      test("the member directory shows the Main address plus a staff member's Work address", async ({ page }) => {
        const person = await createParticipantViaSql(sql, vp.n + 4, `SpecEmailsDir${vp.n}`);
        personIds.push(person.personId);
        const main = `e2e-${vp.n}-dirmain@example.invalid`;
        const work = `e2e-${vp.n}-dirwork@example.invalid`;
        await addContactEmail(sql, person.personId, { value: main, subtype: "personal", isPrimary: true });
        await addContactEmail(sql, person.personId, { value: work, subtype: "work" });
        await addOpenStaffPosition(sql, person.personId);

        await page.goto(`${DIRECTORY}/${person.personId}`);
        await expect(page.getByRole("link", { name: main, exact: true })).toBeVisible({ timeout: 45_000 });
        const workLink = page.getByRole("link", { name: `Work: ${work}`, exact: true });
        await expect(workLink).toBeVisible();
        await expect(workLink).toHaveAttribute("href", `mailto:${work}`);
        expect((await workLink.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await noHorizontalOverflow(page);

        // The list shows the same two lines.
        await page.goto(`${DIRECTORY}?search=${encodeURIComponent(`SpecEmailsDir${vp.n}`)}`);
        await expect(page.getByRole("link", { name: `Work: ${work}`, exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: main, exact: true })).toBeVisible();
        await noHorizontalOverflow(page);
      });
    });
  }
});
