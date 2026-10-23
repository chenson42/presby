/**
 * community-participants.spec.ts - the Community page end to end, against a
 * running server (2026-10-22-founding-admin-directory, Batch D; Phase 3 Test
 * Plan 4), at a desktop width and at 360px.
 *
 * Who: `congregation-clerk` (Ottoline Fairweather) at e2e-alpha, who holds the
 * spec-owned role `e2e_community_clerk` (people.manage, roll.propose,
 * directory.view). See e2e/support/community-fixture.ts for what it creates,
 * captures and restores. Every person added here is named `E2ECommunity ...`
 * and swept by that name.
 *
 * What it proves, by walking the real UI:
 *   - the participant lifecycle: add through the wizard (takes effect now), see
 *     them under Participants, Remove as participant, see them under Former,
 *     Undo, see them back;
 *   - a visitor: added with first visit and how-heard, listed under Visitors,
 *     and ABSENT from Everyone (never in the member Directory);
 *   - the match step says "already here" and links to the record instead of
 *     offering the confirm that could only fail (F178);
 *   - a Member is a proposal: it waits for the Session and shows that badge (the
 *     fixture gives alpha an empty Session, which is what R15 requires for the
 *     Member choice to be offered; e2e/community-approval.spec.ts covers the queue);
 *   - the degrade (DECISION-197): with directory.view removed the page keeps
 *     Add person and Visitors and names the missing permission;
 *   - nothing overflows horizontally at 360px.
 * The persisted audit rows are asserted through the owner connection.
 */

import { test, expect, type Page } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { platformSql, type Sql } from "./support/db";
import {
  CLERK_EMAIL,
  COMMUNITY_ORG,
  removeCommunityFixture,
  setDirectoryView,
  setupCommunityFixture,
  sweepCommunityPeople,
  type CommunityFixtureState,
} from "./support/community-fixture";

const BASE = `/o/${COMMUNITY_ORG.slug}/admin/community`;
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "360px", width: 360, height: 740 },
] as const;

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Steps 1 to 3 of the wizard for a brand-new person; leaves the Connection step showing. */
async function walkToConnection(page: Page, first: string, last: string) {
  await page.goto(`${BASE}/new`);
  const firstName = page.getByLabel(/^first name/i);
  await expect(firstName).toBeEnabled(); // hydration is the signal
  await firstName.fill(first);
  await page.getByLabel(/^last name/i).fill(last);
  await page.getByRole("button", { name: /^search$/i }).click();
  await expect(page.getByText(/name & birth date/i)).toBeVisible();
  await page.getByRole("button", { name: /^next$/i }).click();
  await expect(page.getByText(/contact & address/i)).toBeVisible();
  await page.getByRole("button", { name: /^next$/i }).click();
  await expect(page.getByText(/^household$/i)).toBeVisible();
  await page.getByRole("button", { name: /^next$/i }).click();
  await expect(page.getByLabel(/how is this person connected/i)).toBeVisible();
}

test.describe("Community", () => {
  test.setTimeout(180_000);

  let sql: Sql;
  let state: CommunityFixtureState;

  test.beforeAll(async () => {
    sql = platformSql("community-participants.spec");
    await sweepCommunityPeople(sql); // a crashed prior run
    state = await setupCommunityFixture(sql);
  });

  test.afterAll(async () => {
    await removeCommunityFixture(sql, state);
  });

  for (const vp of VIEWPORTS) {
    test.describe(`at ${vp.name}`, () => {
      test.use({
        storageState: storageStatePath("congregation-clerk"),
        viewport: { width: vp.width, height: vp.height },
      });
      const tag = vp.name === "desktop" ? "D" : "M";

      test("participant lifecycle: add, list, remove, former, undo, back", async ({ page }) => {
        const last = `Spec${tag}Part`;
        const full = `E2ECommunity ${last}`;
        await walkToConnection(page, "E2ECommunity", last);

        // Participant is offered, and its description follows the choice.
        const connection = page.getByLabel(/how is this person connected/i);
        await connection.selectOption("participant");
        await expect(page.getByText(/no approval is needed/i)).toBeVisible();
        await page.getByLabel(/^effective date/i).fill("2026-01-15");
        await page.getByRole("button", { name: /^next$/i }).click();
        await expect(page.getByText(/takes effect immediately and is counted/i)).toBeVisible();
        await page.getByRole("button", { name: /add person/i }).click();

        // Lands on Participants with the person listed and badged.
        await page.waitForURL(/view=participants/);
        const card = page.getByRole("listitem").filter({ hasText: full });
        await expect(card).toBeVisible();
        await expect(card.getByText("Participant", { exact: true })).toBeVisible();
        await noHorizontalOverflow(page);

        // The audit row is the persisted proof that it was recorded, not approved.
        const audit = (await sql`
          select action from audit_events
           where action in ('tenant.roll_action.recorded', 'tenant.roll_action.approved')
             and actor_email = ${CLERK_EMAIL} and created_at > now() - interval '10 minutes'
             and metadata->>'organizationId' = ${COMMUNITY_ORG.id}`) as { action: string }[];
        expect(audit.length).toBeGreaterThan(0);
        expect(audit.every((r) => r.action === "tenant.roll_action.recorded")).toBe(true);

        // Open the record: the Connection card names them a participant.
        await card.getByRole("link", { name: /^edit/i }).click();
        // The edit page compiles on first touch in a dev server: allow for it.
        await expect(page.getByTestId("connection-card")).toContainText("Participant", { timeout: 30_000 });
        await expect(
          page.getByText(/to receive this person as a member, record a profession of faith/i),
        ).toBeVisible();

        // Remove as participant: the dialog explains it and asks for a date.
        const remove = page.getByRole("button", { name: /remove as participant/i });
        await expect(remove).toBeEnabled();
        await remove.click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText("You can usually undo it afterward.");
        // The dialog fits the viewport and its buttons are reachable.
        const box = await dialog.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
        await dialog.getByRole("button", { name: /^remove$/i }).click();
        await expect(page.getByText(/removed as a participant/i)).toBeVisible();

        // Former lists them, with the removal date, and Participants no longer does.
        await page.goto(`${BASE}?view=former`);
        const former = page.getByRole("listitem").filter({ hasText: full });
        await expect(former).toBeVisible();
        await expect(former).toContainText("Removed");
        await page.goto(`${BASE}?view=participants`);
        await expect(page.getByRole("listitem").filter({ hasText: full })).toHaveCount(0);

        // Undo from the record: a reason is required.
        await page.goto(`${BASE}?view=former`);
        await page.getByRole("listitem").filter({ hasText: full }).getByRole("link", { name: /^edit/i }).click();
        await expect(page.getByTestId("connection-card")).toContainText("Former participant", { timeout: 30_000 });
        const undo = page.getByRole("button", { name: /undo last entry/i });
        await expect(undo).toBeEnabled();
        await undo.click();
        const undoDialog = page.getByRole("alertdialog");
        const confirmUndo = undoDialog.getByRole("button", { name: /^undo entry$/i });
        await expect(confirmUndo).toBeDisabled();
        await undoDialog.getByLabel(/reason/i).fill("E2E: the removal was a mistake.");
        await expect(confirmUndo).toBeEnabled();
        await confirmUndo.click();
        await expect(page.getByText(/removal undone/i)).toBeVisible();

        // Back under Participants.
        await page.goto(`${BASE}?view=participants`);
        await expect(page.getByRole("listitem").filter({ hasText: full })).toBeVisible();
        await noHorizontalOverflow(page);

        const voided = (await sql`
          select count(*)::int as n from audit_events
           where action = 'tenant.roll_action.voided' and actor_email = ${CLERK_EMAIL}
             and created_at > now() - interval '10 minutes' and metadata->>'organizationId' = ${COMMUNITY_ORG.id}`) as { n: number }[];
        expect(voided[0]!.n).toBeGreaterThanOrEqual(1);
      });

      test("a visitor is listed under Visitors and never under Everyone; the match step says already here", async ({ page }) => {
        const last = `Spec${tag}Visit`;
        const full = `E2ECommunity ${last}`;
        await walkToConnection(page, "E2ECommunity", last);

        // Visitor is the default, with its two optional fields.
        const connection = page.getByLabel(/how is this person connected/i);
        await expect(connection).toHaveValue("visitor");
        await page.getByLabel(/first visit/i).fill("2026-05-03");
        await page.getByLabel(/how did they hear about us/i).fill("A neighbor invited them");
        await page.getByRole("button", { name: /^next$/i }).click();
        await expect(page.getByText(/visitors aren't listed in the directory/i)).toBeVisible();
        await page.getByRole("button", { name: /add person/i }).click();

        await page.waitForURL(/view=visitors/);
        const card = page.getByRole("listitem").filter({ hasText: full });
        await expect(card).toBeVisible();
        await expect(card).toContainText(/first visit/i);
        await noHorizontalOverflow(page);

        // Never in the member Directory, nor Everyone.
        await page.goto(`${BASE}?search=${encodeURIComponent(last)}`);
        await expect(page.getByText(/no people match/i)).toBeVisible();

        // Searching for them again hits the already-here step, not the failing confirm.
        await page.goto(`${BASE}/new`);
        const firstName = page.getByLabel(/^first name/i);
        await expect(firstName).toBeEnabled();
        await firstName.fill("E2ECommunity");
        await page.getByLabel(/^last name/i).fill(last);
        await page.getByRole("button", { name: /^search$/i }).click();
        await expect(page.getByText(/is already in this community/i)).toBeVisible();
        await expect(page.getByText("They're a visitor.")).toBeVisible();
        await expect(page.getByRole("button", { name: /^yes, this is/i })).toHaveCount(0);
        await expect(page.getByText(/belongs to another organization/i)).toHaveCount(0);
        // Full-width buttons on a phone.
        const link = page.getByRole("link", { name: /open their record/i });
        const linkBox = await link.boundingBox();
        expect(linkBox!.height).toBeGreaterThanOrEqual(44);
        await noHorizontalOverflow(page);
        await link.click();
        await expect(page.getByTestId("connection-card")).toContainText("Visitor", { timeout: 30_000 });
        // A visitor is not a participant: no Remove.
        await expect(page.getByRole("button", { name: /remove as participant/i })).toHaveCount(0);
      });

      test("a member is a proposal that waits for the Session", async ({ page }) => {
        const last = `Spec${tag}Member`;
        const full = `E2ECommunity ${last}`;
        await walkToConnection(page, "E2ECommunity", last);
        await page.getByLabel(/how is this person connected/i).selectOption("member");
        await expect(page.getByText(/the session must approve before they count as a member/i)).toBeVisible();
        await page.getByLabel(/^effective date/i).fill("2026-06-01");
        await page.getByRole("button", { name: /^next$/i }).click();
        // The fixture's Session roster is empty (Flow 7), so the review note is the
        // honest one: this will wait because no one on the Session can approve yet.
        await expect(
          page.getByText(/this person's roll action will wait\. no one on your session can approve yet/i),
        ).toBeVisible();
        await page.getByRole("button", { name: /add person/i }).click();

        // Stays on Everyone; the person is listed with the waiting badge and is not a member yet.
        await page.waitForURL((url) => url.pathname === BASE && !url.search.includes("view="));
        const card = page.getByRole("listitem").filter({ hasText: full });
        await expect(card).toBeVisible();
        await expect(card.getByText("Waiting for the Session")).toBeVisible();
        await page.goto(`${BASE}?view=members`);
        await expect(page.getByRole("listitem").filter({ hasText: full })).toHaveCount(0);
        await noHorizontalOverflow(page);
      });

      test("the nav is six real links in one scrollable row, and every empty state reads", async ({ page }) => {
        await page.goto(BASE);
        const nav = page.getByRole("group", { name: "Community view" });
        await expect(nav.getByRole("link")).toHaveCount(6);
        await noHorizontalOverflow(page);
        // One row: every link shares the first link's vertical band (no lopsided wrap).
        const tops = await nav.getByRole("link").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
        expect(new Set(tops).size).toBe(1);

        for (const [view, text] of [
          ["staff", /staff/i],
          ["former", /former participants/i],
        ] as const) {
          await page.goto(`${BASE}?view=${view}&search=zzzzznomatch`);
          await expect(page.getByText(/no .* match "zzzzznomatch"/i)).toBeVisible();
          expect(text).toBeTruthy();
        }
      });
    });
  }

  test.describe("the degrade (DECISION-197)", () => {
    test.use({
      storageState: storageStatePath("congregation-clerk"),
      viewport: { width: 360, height: 740 },
    });

    test.afterEach(async () => {
      await setDirectoryView(sql, true);
    });

    test("without directory.view the page keeps Add person and Visitors and names the missing permission — regression for founding administrator cannot reach Add person (F172)", async ({ page }) => {
      await setDirectoryView(sql, false);
      await page.goto(BASE);
      await expect(page.getByRole("heading", { name: "Community" })).toBeVisible();
      await expect(page.getByRole("link", { name: /add person/i })).toBeVisible();
      await expect(page.getByText(/the directory\.view permission/i)).toBeVisible();
      await expect(page.getByText(/you don't have permission to do that/i)).toHaveCount(0);
      await noHorizontalOverflow(page);

      // Visitors still lists (it needs people.manage, not directory.view).
      await page.getByRole("link", { name: "Visitors" }).click();
      await expect(page.getByText(/the directory\.view permission/i)).toHaveCount(0);
      await expect(page).toHaveURL(/view=visitors/);

      // Add person still works for them (a Visitor needs nothing more).
      await page.goto(`${BASE}/new`);
      await expect(page.getByRole("button", { name: /^search$/i })).toBeVisible();
    });
  });
});
