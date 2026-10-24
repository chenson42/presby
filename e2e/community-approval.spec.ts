/**
 * community-approval.spec.ts - the Session approval queue end to end, against a
 * running server (2026-10-22-founding-admin-directory, Increment 2 Batch D;
 * Phase 3 Test Plan 4), at a desktop width and at 360px.
 *
 * Who: `congregation-clerk` at e2e-alpha. The shared community fixture gives her
 * `e2e_community_clerk` (people.manage, roll.propose, directory.view) and, for
 * this spec, `e2e_session_approver` (roll.approve only), so she holds both roll
 * keys and sees the queue in DECIDE mode; `setRollApprove(false)` drops her to
 * READ mode. alpha has an empty Session, which is what lets Member be proposed.
 * Every person here is named `E2ECommunity ...` and swept by that name.
 *
 * What it proves, by walking the real UI:
 *   1. propose a member through the wizard, see it in the queue ("You proposed
 *      this"), approve it, see the person under Members and under Recently decided;
 *   2. two proposals approved together with one minute reference;
 *   3. deny with a reason, and the reason shows under Recently decided;
 *   4. withdraw from the person's edit page and from the queue, then propose again;
 *   5. read-only mode: no Approve, Deny or checkboxes, the Session explanation and
 *      the "Ask an administrator" banner variant;
 *   6. the Community header "N waiting" link;
 *   7. at 360px the sticky "Approve N" bar does not cover a row the user focuses.
 * The persisted rows and audit events are asserted through the owner connection.
 */

import { test, expect as baseExpect, type Page } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { platformSql, type Sql } from "./support/db";
import {
  COMMUNITY_ORG,
  createProposalViaSql,
  removeCommunityFixture,
  setRollApprove,
  setupCommunityFixture,
  sweepCommunityPeople,
  type CommunityFixtureState,
} from "./support/community-fixture";

/** A dev server (Turbopack compile on first touch, a Neon round trip per refresh) is
 * slower than the 5s default for the post-action `router.refresh()` assertions. */
const expect = baseExpect.configure({ timeout: 30_000 });

const BASE = `/o/${COMMUNITY_ORG.slug}/admin/community`;
const QUEUE = `${BASE}/pending`;
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

function row(page: Page, fullName: string) {
  return page.getByTestId("pending-row").filter({ hasText: fullName });
}

/** The dialog fits the viewport horizontally and vertically (nothing unreachable on a phone). */
async function expectDialogFits(page: Page, vp: { width: number; height: number }) {
  const box = await page.getByRole("alertdialog").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 1);
}

async function rollRow(sql: Sql, personId: string) {
  const rows = (await sql`
    select approval_status, denial_reason, withdrawal_reason, minute_reference, decided_by, decided_at
      from roll_actions where person_id = ${personId}::uuid order by recorded_at desc`) as {
    approval_status: string;
    denial_reason: string | null;
    withdrawal_reason: string | null;
    minute_reference: string | null;
    decided_by: string | null;
    decided_at: string | null;
  }[];
  return rows;
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

test.describe("Session approval queue", () => {
  test.setTimeout(180_000);

  let sql: Sql;
  let state: CommunityFixtureState;

  test.beforeAll(async () => {
    sql = platformSql("community-approval.spec");
    await sweepCommunityPeople(sql); // a crashed prior run
    state = await setupCommunityFixture(sql);
  });

  test.afterEach(async () => {
    await setRollApprove(sql, true);
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

      test("propose a member through the wizard, see it in the queue, approve it, see them under Members", async ({ page }) => {
        const last = `Spec${tag}Approve`;
        const full = `E2ECommunity ${last}`;
        await walkToConnection(page, "E2ECommunity", last);
        await page.getByLabel(/how is this person connected/i).selectOption("member");
        await page.getByLabel(/^effective date/i).fill("2026-06-01");
        await page.getByRole("button", { name: /^next$/i }).click();
        await page.getByRole("button", { name: /add person/i }).click();
        await page.waitForURL((url) => url.pathname === BASE && !url.search.includes("view="));

        await page.goto(QUEUE);
        await expect(page.getByRole("heading", { name: "Pending approvals" })).toBeVisible();
        const proposed = row(page, full);
        await expect(proposed).toBeVisible();
        await expect(proposed.getByText("You proposed this")).toBeVisible();
        await noHorizontalOverflow(page);

        const approve = proposed.getByRole("button", { name: /^approve /i });
        await expect(approve).toBeEnabled();
        await approve.click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toBeVisible();
        await expectDialogFits(page, vp);
        await dialog.getByLabel(/minute reference/i).fill("E2E minutes 2026-06-01");
        await dialog.getByRole("button", { name: /^approve$/i }).click();
        await expect(page.getByText(`${full}'s roll action approved.`)).toBeVisible();
        await expect(row(page, full)).toHaveCount(0);

        // Recently decided carries it, with the self-approved marker (she proposed it).
        const decided = page.getByTestId("decided-row").filter({ hasText: full });
        await expect(decided).toBeVisible();
        await expect(decided.getByText("Self-approved")).toBeVisible();
        await expect(decided).toContainText("Approved");

        // The person is now a member.
        await page.goto(`${BASE}?view=members&search=${encodeURIComponent(last)}`);
        await expect(page.getByRole("listitem").filter({ hasText: full })).toBeVisible();
        await noHorizontalOverflow(page);

        const persisted = (await sql`
          select ra.approval_status, ra.minute_reference, ra.decided_by, ra.decided_at, m.current_roll
            from roll_actions ra join memberships m on m.person_id = ra.person_id and m.organization_id = ra.organization_id
           where ra.person_id = (select id from people where first_name = 'E2ECommunity' and last_name = ${last})`) as {
          approval_status: string; minute_reference: string | null; decided_by: string | null; decided_at: string | null; current_roll: string | null;
        }[];
        expect(persisted[0]!.approval_status).toBe("approved");
        expect(persisted[0]!.minute_reference).toBe("E2E minutes 2026-06-01");
        expect(persisted[0]!.decided_by).not.toBeNull();
        expect(persisted[0]!.current_roll).toBe("active");
        const audit = (await sql`
          select metadata->>'selfApproved' as self_approved from audit_events
           where action = 'tenant.roll_action.approved' and created_at > now() - interval '10 minutes'
             and metadata->>'organizationId' = ${COMMUNITY_ORG.id} order by created_at desc limit 1`) as { self_approved: string }[];
        expect(audit[0]!.self_approved).toBe("true");
      });

      test("two proposals approved together with one minute reference", async ({ page }) => {
        const a = await createProposalViaSql(sql, vp.name === "desktop" ? 1 : 11, `Spec${tag}BulkA`);
        const b = await createProposalViaSql(sql, vp.name === "desktop" ? 2 : 12, `Spec${tag}BulkB`);
        await page.goto(QUEUE);
        const rowA = row(page, `E2ECommunity ${a.lastName}`);
        const rowB = row(page, `E2ECommunity ${b.lastName}`);
        await expect(rowA).toBeVisible();

        // Selection is inert until hydration, a 44px target afterwards.
        const boxA = rowA.getByRole("checkbox");
        await expect(boxA).toBeEnabled();
        const target = await boxA.locator("xpath=ancestor::label").boundingBox();
        expect(target!.width).toBeGreaterThanOrEqual(44);
        expect(target!.height).toBeGreaterThanOrEqual(44);

        await boxA.check();
        await rowB.getByRole("checkbox").check();
        const bar = page.getByTestId("bulk-bar");
        await expect(bar).toBeVisible();
        const barBox = await bar.boundingBox();
        expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(vp.height + 1);
        await bar.getByRole("button", { name: "Approve 2 selected" }).click();

        const dialog = page.getByRole("alertdialog");
        await expect(dialog.getByText("Approve 2 roll actions?")).toBeVisible();
        await expectDialogFits(page, vp);
        await dialog.getByLabel(/minute reference/i).fill("E2E bulk minutes");
        await dialog.getByRole("button", { name: "Approve 2" }).click();
        await expect(page.getByText("2 roll actions approved.")).toBeVisible();
        await expect(rowA).toHaveCount(0);
        await expect(rowB).toHaveCount(0);

        for (const p of [a, b]) {
          const [r] = await rollRow(sql, p.personId);
          expect(r!.approval_status).toBe("approved");
          expect(r!.minute_reference).toBe("E2E bulk minutes");
        }
        await noHorizontalOverflow(page);
      });

      test("deny with a reason, and the reason shows under Recently decided", async ({ page }) => {
        const p = await createProposalViaSql(sql, vp.name === "desktop" ? 3 : 13, `Spec${tag}Deny`);
        const full = `E2ECommunity ${p.lastName}`;
        await page.goto(QUEUE);
        await row(page, full).getByRole("button", { name: /^deny /i }).click();
        const dialog = page.getByRole("alertdialog");
        const confirm = dialog.getByRole("button", { name: /^deny$/i });
        await expect(confirm).toBeDisabled(); // a reason is required
        await expectDialogFits(page, vp);
        await dialog
          .getByLabel(/reason/i)
          .fill("E2E: this entry duplicates one already on the roll, so it is denied and the reason is long enough to wrap on a phone.");
        await confirm.click();
        await expect(page.getByText(`${full}'s roll action denied.`)).toBeVisible();

        const decided = page.getByTestId("decided-row").filter({ hasText: full });
        await expect(decided).toContainText("Denied");
        await expect(decided).toContainText("duplicates one already on the roll");
        await noHorizontalOverflow(page); // a long reason wraps

        const [r] = await rollRow(sql, p.personId);
        expect(r!.approval_status).toBe("denied");
        expect(r!.denial_reason).toContain("duplicates one already");
        expect(r!.decided_by).not.toBeNull();
      });

      test("withdraw from the edit page and from the queue, then propose again", async ({ page }) => {
        const p = await createProposalViaSql(sql, vp.name === "desktop" ? 4 : 14, `Spec${tag}Withdraw`);
        const q = await createProposalViaSql(sql, vp.name === "desktop" ? 5 : 15, `Spec${tag}WithdrawQ`);

        // From the person's edit page.
        await page.goto(`${BASE}/${p.personId}/edit`);
        await expect(page.getByTestId("pending-notice")).toBeVisible({ timeout: 30_000 });
        // The Session roster is empty, so the notice explains why nothing is moving.
        await expect(page.getByText(/no one can approve yet/i)).toBeVisible();
        await expect(page.getByRole("link", { name: /see why on the pending approvals page/i })).toBeVisible();
        const withdraw = page.getByRole("button", { name: /withdraw proposal for/i });
        await expect(withdraw).toBeEnabled();
        await withdraw.click();
        const dialog = page.getByRole("alertdialog");
        await expect(dialog.getByText("Withdraw this proposal?")).toBeVisible();
        await expectDialogFits(page, vp);
        const confirm = dialog.getByRole("button", { name: "Withdraw", exact: true });
        await expect(confirm).toBeDisabled();
        await dialog.getByLabel(/reason/i).fill("E2E: entered by mistake.");
        await confirm.click();
        await expect(page.getByText(/proposal withdrawn/i)).toBeVisible();
        await expect(page.getByTestId("pending-notice")).toHaveCount(0);
        expect((await rollRow(sql, p.personId))[0]!.approval_status).toBe("withdrawn");

        // Propose again from the same page: the withdrawn row released the person (R7).
        await page.getByLabel("Roll action").selectOption("profession_of_faith");
        await page.getByLabel("Effective date", { exact: true }).fill("2026-06-02");
        await page.getByRole("button", { name: "Record roll action" }).click();
        await expect(page.getByText(/roll action proposed/i)).toBeVisible();
        await expect(page.getByTestId("pending-notice")).toBeVisible();
        const after = await rollRow(sql, p.personId);
        expect(after.map((r) => r.approval_status).sort()).toEqual(["pending", "withdrawn"]);

        // From the queue.
        await page.goto(QUEUE);
        await row(page, `E2ECommunity ${q.lastName}`).getByRole("button", { name: /withdraw proposal for/i }).click();
        await page.getByRole("alertdialog").getByLabel(/reason/i).fill("E2E: withdrawn from the queue.");
        await page.getByRole("alertdialog").getByRole("button", { name: "Withdraw", exact: true }).click();
        await expect(page.getByText(/proposal withdrawn/i)).toBeVisible();
        await expect(row(page, `E2ECommunity ${q.lastName}`)).toHaveCount(0);
        const decided = page.getByTestId("decided-row").filter({ hasText: `E2ECommunity ${q.lastName}` });
        await expect(decided).toContainText("Withdrawn");
        await expect(decided).toContainText("withdrawn from the queue");
        expect((await rollRow(sql, q.personId))[0]!.approval_status).toBe("withdrawn");
      });

      test("read-only mode: no Approve, Deny or checkboxes; the Session explanation and the Ask an administrator banner", async ({ page }) => {
        const p = await createProposalViaSql(sql, vp.name === "desktop" ? 6 : 16, `Spec${tag}Read`);
        await setRollApprove(sql, false);
        await page.goto(QUEUE);
        const waiting = row(page, `E2ECommunity ${p.lastName}`);
        await expect(waiting).toBeVisible();
        await expect(page.getByText(/only members of the session can approve/i)).toBeVisible();
        await expect(page.getByRole("checkbox")).toHaveCount(0);
        await expect(page.getByRole("button", { name: /^approve/i })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /^deny/i })).toHaveCount(0);
        await expect(waiting.getByRole("button", { name: /withdraw proposal for/i })).toBeVisible();

        // Flow 7: the Session roster is empty, and the clerk lacks officers.manage.
        const banner = page.getByTestId("session-state-banner");
        await expect(banner).toContainText("Your Session roster is empty");
        await expect(banner).toContainText("Ask an administrator to record the members of the Session under Officers.");
        await expect(banner.getByRole("link")).toHaveCount(0);
        await noHorizontalOverflow(page);
      });

      test("the Community header shows the waiting count and links to the queue", async ({ page }) => {
        await createProposalViaSql(sql, vp.name === "desktop" ? 7 : 17, `Spec${tag}HeadA`);
        await createProposalViaSql(sql, vp.name === "desktop" ? 8 : 18, `Spec${tag}HeadB`);
        await page.goto(BASE);
        const link = page.getByRole("link", { name: /^Pending approvals, \d+ waiting$/ });
        await expect(link).toBeVisible();
        const name = (await link.getAttribute("aria-label"))!;
        expect(Number(/(\d+) waiting/.exec(name)![1])).toBeGreaterThanOrEqual(2);
        const box = await link.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        await noHorizontalOverflow(page);
        await link.click();
        await expect(page).toHaveURL(new RegExp(`${QUEUE}$`));
        await expect(page.getByRole("heading", { name: "Pending approvals" })).toBeVisible();
      });
    });
  }

  test.describe("at 360px: the sticky bar", () => {
    test.use({
      storageState: storageStatePath("congregation-clerk"),
      viewport: { width: 360, height: 740 },
    });

    test("the Approve N bar sits above the viewport bottom and does not cover a row the user focuses", async ({ page }) => {
      const people = [];
      for (let i = 0; i < 6; i += 1) {
        people.push(await createProposalViaSql(sql, 30 + i, `SpecMBar${i}`));
      }
      await page.goto(QUEUE);
      // A row below the fold, not the last one: the bar rests in normal flow after
      // the last row, so only a middle row can end up under it.
      const last = row(page, `E2ECommunity ${people[4]!.lastName}`);
      await expect(last).toBeVisible();
      await page.getByRole("button", { name: /select all on this page/i }).click();
      const bar = page.getByTestId("bulk-bar");
      await expect(bar).toBeVisible();

      await page.evaluate(() => window.scrollTo(0, 0));
      // Focusing the row's own control scrolls it into view from below; the row must
      // end up fully above the bar, not under it. Chromium centres a focused element
      // that was off screen, so this geometry alone would pass without help; the
      // computed scroll-margin below is the contract for browsers that scroll "nearest"
      // (Safari), and it is what a missing `scroll-mb-28` fails.
      const margin = await last.evaluate((el) =>
        parseFloat(getComputedStyle(el.closest("li")!).scrollMarginBottom),
      );
      const barHeight = (await bar.boundingBox())!.height;
      expect(margin).toBeGreaterThanOrEqual(barHeight);
      await last.getByRole("button", { name: /^approve /i }).focus();
      // Poll the geometry (the scroll settles asynchronously): the row's bottom edge
      // must end up above the bar's top edge.
      await expect
        .poll(async () => {
          const lastBox = await last.boundingBox();
          const barBox = await bar.boundingBox();
          return lastBox!.y + lastBox!.height - barBox!.y;
        })
        .toBeLessThanOrEqual(1);
      const barBox = await bar.boundingBox();
      expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(740 + 1);
      await noHorizontalOverflow(page);
    });
  });
});
