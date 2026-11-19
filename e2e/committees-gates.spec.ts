/**
 * committees-gates.spec.ts - what stands in front of the Committees & Commissions pages, and what the groups
 * admin now says at a presbytery (Presbytery committees Increment 1, Batch B4;
 * docs/work-log/2026-11-19-presbytery-committees.md Phase 3 "Test plan" -> "E2E").
 *
 *   - flag `org_portal.committees` off: "Committees & Commissions isn't turned on for {name} yet." (for a
 *     person who holds the key: the flag and the key are two questions, and the flag is asked first);
 *   - a congregation reaching `/admin/committees` gets the not-available sentence (the page is a presbytery's);
 *   - the groups admin AT A PRESBYTERY points to Committees & Commissions, offers no "Committee" type, and a
 *     committee id typed into `/admin/groups/<id>` is a 404; a committee group that predates the page
 *     (never labelled) is still reachable under Committees as "Not yet labelled";
 *   - THE CONGREGATION'S GROUPS ADMIN IS UNCHANGED: no pointer, the Committee type still offered, and a
 *     congregation's own committee group is still its page.
 *
 * Flags set here and restored in afterAll: `org_portal.committees` and `org_portal.groups` (the groups admin
 * is its own global flag, off in a fresh database).
 */
import { test, expect, type BrowserContext } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  COMMITTEES_FLAG,
  COMMITTEES_NAMES,
  GROUPS_FLAG,
  newPhonePage,
  removeCommitteesFixture,
  seedCommittee,
  setupCommitteesFixture,
  signedInContext,
  waitHydrated,
  type CommitteesFixture,
} from "./support/committees-fixture";

let sql: Sql;
let fx: CommitteesFixture;
let flags: FlagCapture;
let clerk: BrowserContext;
let congClerk: BrowserContext;
const base = () => `/o/${fx.presbytery.slug}/admin/committees`;
const groups = () => `/o/${fx.presbytery.slug}/admin/groups`;

test.describe.serial("Committees: the gates, and the groups admin at a presbytery", () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(420_000);
    sql = platformSql("committees-gates.spec");
    flags = await captureFlags(sql, [COMMITTEES_FLAG, GROUPS_FLAG]);
    await setFlag(sql, COMMITTEES_FLAG, true);
    await setFlag(sql, GROUPS_FLAG, true);
    fx = await setupCommitteesFixture(sql, { tag: "g", who: ["clerk", "congClerk"] });
    clerk = await signedInContext(browser, "clerk", base());
    congClerk = await signedInContext(browser, "congClerk", `/o/${fx.congA.slug}/admin/groups`);
  });

  test.afterAll(async () => {
    await clerk?.close();
    await congClerk?.close();
    if (sql && fx) await removeCommitteesFixture(sql, fx);
    await flags?.restore();
  });

  test("with org_portal.committees off, every page says it isn't turned on and shows nothing of the committees", async () => {
    const committee = await seedCommittee(sql, fx, { name: "E2E Cmt Gate Committee", kind: "standing" });
    await setFlag(sql, COMMITTEES_FLAG, false);
    try {
      const page = await newPhonePage(clerk);
      for (const path of [base(), `${base()}/new`, `${base()}/${committee}`, `${base()}/${committee}/members/new`]) {
        await page.goto(path);
        await expect(page.getByText(`Committees & Commissions isn't turned on for ${fx.presbytery.name} yet.`)).toBeVisible();
        await expect(page.getByText("E2E Cmt Gate Committee")).toHaveCount(0);
        await expect(page.locator("form")).toHaveCount(0);
      }
      // The tile is not a live link while the flag is off.
      await page.goto(`/o/${fx.presbytery.slug}`);
      await expect(page.locator(`a[href="${base()}"]`)).toHaveCount(0);
      await page.close();
    } finally {
      await setFlag(sql, COMMITTEES_FLAG, true);
    }
  });

  test("a congregation reaching the presbytery's page is told it is not available for that organization", async () => {
    const page = await newPhonePage(congClerk);
    for (const path of [`/o/${fx.congA.slug}/admin/committees`, `/o/${fx.congA.slug}/admin/committees/new`]) {
      await page.goto(path);
      await expect(
        page.getByText(`Committees & Commissions isn't available for ${fx.congA.name} — this isn't the kind of organization this tool is built for.`),
      ).toBeVisible();
      await expect(page.locator("form")).toHaveCount(0);
    }
    // And that person, who belongs only to the congregation, gets the one denial at the presbytery's path
    // (byte-identical to a stranger's: which organizations are tenants is not for this page to say).
    const denied = await page.goto(base());
    expect(denied?.status()).toBeLessThan(500);
    await expect(page.getByRole("heading", { level: 1, name: `You don't have access to ${fx.presbytery.name}` })).toBeVisible();
    await expect(page.getByText("Committees & Commissions")).toHaveCount(0);
    await expect(page.getByText(/permission to manage committees/)).toHaveCount(0);
    await page.close();
  });

  test("the groups admin at a presbytery points to Committees & Commissions and offers no Committee type", async () => {
    const page = await newPhonePage(clerk);
    await page.goto(groups());
    await expect(page.getByRole("heading", { level: 1, name: /Groups/ }).first()).toBeVisible();
    const pointer = page.getByText(`Committees of ${fx.presbytery.name} are kept under`);
    await expect(pointer).toBeVisible();
    const link = pointer.getByRole("link", { name: "Committees & Commissions" });
    await expect(link).toHaveAttribute("href", base());
    await link.click();
    await page.waitForURL((url) => url.pathname === base());
    await expect(page.getByRole("heading", { level: 1, name: "Committees & Commissions" })).toBeVisible();
    // The page before this one seeded a committee, so the list (not its empty state) is what the link reaches.
    await expect(page.getByText("E2E Cmt Gate Committee").first()).toBeVisible();

    // The seeded choir is a group here; the committee type is not on offer in the create form.
    await page.goto(groups());
    await expect(page.getByText(COMMITTEES_NAMES.choir)).toBeVisible();
    await page.goto(`${groups()}/new`);
    await waitHydrated(page);
    const options = await page.locator("#new-group-type option").allInnerTexts();
    expect(options.length).toBeGreaterThan(0);
    expect(options).not.toContain("Committee");
    await expect(page.getByText("Committees of")).toHaveCount(0); // the pointer is the list page's, not the form's
    await page.close();
  });

  test("a committee id typed into the groups admin at the presbytery is a 404, and the committee is under Committees as Not yet labelled", async () => {
    const legacy = await seedCommittee(sql, fx, { name: "E2E Cmt Legacy Committee", kind: null });
    const page = await newPhonePage(clerk);
    for (const path of [`${groups()}/${legacy}`, `${groups()}/${legacy}/edit`]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
    await page.goto(base());
    await expect(page.getByRole("heading", { level: 2, name: "Not yet labelled" })).toBeVisible();
    await expect(page.getByText("E2E Cmt Legacy Committee").first()).toBeVisible();
    await page.close();
  });

  test("the congregation's groups admin is unchanged: no pointer, the Committee type offered, its committee group is still its page", async () => {
    const congGroups = `/o/${fx.congA.slug}/admin/groups`;
    const page = await newPhonePage(congClerk);
    await page.goto(congGroups);
    await expect(page.getByText("are kept under")).toHaveCount(0);
    await expect(page.getByText(COMMITTEES_NAMES.congCommittee)).toBeVisible();
    await page.goto(`${congGroups}/new`);
    await waitHydrated(page);
    const options = await page.locator("#new-group-type option").allInnerTexts();
    expect(options).toContain("Committee");
    const response = await page.goto(`${congGroups}/${fx.groups.congCommittee}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: COMMITTEES_NAMES.congCommittee })).toBeVisible();
    await page.close();
  });
});
