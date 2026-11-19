/**
 * committees-commissions.spec.ts - the presbytery's administrative commission RECORDS, end to end (Presbytery
 * committees Increment 2, Batch B7; docs/work-log/2026-11-19-presbytery-committees-inc2.md, parent Phase 3
 * "Test plan" -> "E2E").
 *
 * THE FOUNDER IS REAL, as in committees-roster.spec.ts: a presbytery founding administrator minted by the
 * definer, MFA enrolled, holding no grant beyond the bundle. Tests 1 to 6 are the founding-administrator walk
 * for the commissions half (record, edit, add members, plan one, end a term, cancel a planned term, end the
 * commission, remove a record), scripted and run in a real Chromium at 360px. The clerk (a custom role holding
 * ONLY `groups.manage`, no two-factor prompt) records one too; a member with no role is told, in a sentence,
 * that they lack the key.
 *
 * THE HARD RULE IS A TEST, NOT A COMMENT. A commission record gives its members NO access to anything. The
 * spec takes the count of `administrative_commissions`, `org_delegations` and `role_grants` before the first
 * write and asserts it unchanged after the last, and that every audit row carries ids, roles, dates, counts and
 * field NAMES only (never a title, a charge or a minute text, never a person's name).
 *
 * Flag set here and restored in afterAll: `org_portal.committees` (named; nothing is added to
 * scripts/ci/e2e-baseline-flags.sql). Throwaway presbytery, invented names, `.invalid` addresses.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { platformSql, type Sql } from "./support/db";
import { captureFlags, setFlag, type FlagCapture } from "./support/flags";
import {
  COMMITTEES_FLAG,
  COMMITTEES_NAMES,
  commissionAudit,
  commissionById,
  commissionMembers,
  commissionsByTitle,
  committeesAudit,
  downwardCounts,
  expectNoSidewaysScroll,
  LONG_PERSON,
  mainText,
  newPhonePage,
  removeCommitteesFixture,
  SEATABLE_NAMES,
  seedCommission,
  seedCommissionMember,
  seedCommittee,
  setupCommitteesFixture,
  signedInContext,
  smallControls,
  waitHydrated,
  type CommitteesFixture,
} from "./support/committees-fixture";

/** Free-text sentinels: they must reach the commission page and never an audit row. */
const CHARGE_SENTINEL = "CHARGE-SENTINEL-4090 reviews the session's pastoral care";
const CHARGE_SENTINEL_2 = "CHARGE-SENTINEL-4090 second wording of the charge";
const MINUTE_SENTINEL = "MINUTE-SENTINEL-4090 item 7";
const END_MINUTE_SENTINEL = "ENDMINUTE-SENTINEL-4090 final report";
const TITLE = "Pastoral Care Review Commission E2E";
const TITLE_EDITED = "Pastoral Care Review Commission E2E (edited)";
const TITLE_NONE = "Standing Review Commission E2E";
const TITLE_CLERK = "Clerk Recorded Commission E2E";
const LONG_TITLE = "Commission".repeat(20); // 200 characters, no break opportunity
const LONG_CHARGE = "Charge".repeat(83); // 498 characters, no break opportunity
const LONG_MINUTE = "Minute".repeat(33); // 198 characters, no break opportunity

const NO_ACCESS_ALDER = `This record gives no one access to ${COMMITTEES_NAMES.congA}'s PresbyPortal, and ${COMMITTEES_NAMES.congA} does not see it.`;
const NO_ACCESS_NONE = "This record gives no one access to any congregation's PresbyPortal.";

let sql: Sql;
let fx: CommitteesFixture;
let flags: FlagCapture;
let founder: BrowserContext;
let baseline: Awaited<ReturnType<typeof downwardCounts>>;
let commissionId = "";
let todayLocal = "";
const base = () => `/o/${fx.presbytery.slug}/admin/committees`;
const commissionsBase = () => `${base()}/commissions`;
const congregationRefusal = () => `That congregation could not be found among ${fx.presbytery.name}'s member congregations.`;

/** `YYYY-MM-DD` shifted by whole days (UTC arithmetic on a date-only string). */
function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function toastOrText(page: Page, text: string) {
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
}

/** Drives the add-member form on a commission's page. */
async function addMember(page: Page, who: keyof typeof SEATABLE_NAMES, role: string, startsOn: string, endsOn?: string) {
  await page.goto(`${commissionsBase()}/${commissionId}/members/new`);
  await waitHydrated(page);
  await page.locator("#commission-person").selectOption({ label: SEATABLE_NAMES[who] });
  await page.locator("#commission-role").selectOption(role);
  await page.locator("#commission-starts").fill(startsOn);
  await page.locator("#commission-ends").fill(endsOn ?? "");
  await page.getByRole("button", { name: "Add to commission" }).click();
  await toastOrText(page, "Added to the commission.");
  await page.waitForURL((url) => url.pathname === `${commissionsBase()}/${commissionId}`);
}

test.describe.serial("Commissions: the records, end to end", () => {
  test.setTimeout(240_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(420_000);
    sql = platformSql("committees-commissions.spec");
    flags = await captureFlags(sql, [COMMITTEES_FLAG]);
    await setFlag(sql, COMMITTEES_FLAG, true);
    fx = await setupCommitteesFixture(sql, { tag: "k" });
    baseline = await downwardCounts(sql, fx);
    founder = await signedInContext(browser, "founder", base());
  });

  test.afterAll(async () => {
    await founder?.close();
    if (sql && fx) await removeCommitteesFixture(sql, fx);
    await flags?.restore();
  });

  test("1. the founder (the bundle alone) meets the Administrative commissions section and its guided empty state", async () => {
    const keys = (await sql`
      select p.permission_key from app_roles r join app_role_permissions p on p.role_id = r.id
       where r.organization_id = ${fx.presbytery.id}::uuid and r.key = 'founding_administrator'`) as { permission_key: string }[];
    expect(keys.map((k) => k.permission_key)).toContain("groups.manage");

    const page = await newPhonePage(founder);
    await page.goto(base());
    await expect(page.getByRole("heading", { level: 2, name: "Administrative commissions" })).toBeVisible();
    await expect(
      page.getByText("A record gives no one access to a congregation's PresbyPortal, and the congregation does not see it."),
    ).toBeVisible();
    await expect(page.getByText("No administrative commissions are recorded.")).toBeVisible();
    await page.getByRole("link", { name: "Record a commission" }).click();
    await page.waitForURL((url) => url.pathname === `${commissionsBase()}/new`);
    await expect(page.getByRole("heading", { level: 1, name: "Record a commission" })).toBeVisible();
    await page.close();
  });

  test("2. record: the title is required, an appointment after today is refused, a save lands on the commission page with the no-access sentence", async () => {
    const page = await newPhonePage(founder);
    await page.goto(`${commissionsBase()}/new`);
    await waitHydrated(page);
    todayLocal = await page.locator("#commission-appointed").inputValue();
    await page.getByRole("button", { name: "Record commission" }).click();
    await expect(page.getByText("Title is required.")).toBeVisible();

    await page.getByLabel("Title").fill(TITLE);
    await page.getByLabel("Appointed on").fill(shift(todayLocal, 3));
    await page.getByRole("button", { name: "Record commission" }).click();
    await expect(page.getByText("The appointed date can't be after today.")).toBeVisible();
    expect(await commissionsByTitle(sql, fx, TITLE)).toHaveLength(0);

    await page.getByLabel("Charge (optional)").fill(CHARGE_SENTINEL);
    await page.getByLabel("Congregation (optional)").selectOption({ label: COMMITTEES_NAMES.congA });
    await page.getByLabel("Appointed on").fill(shift(todayLocal, -30));
    await page.getByLabel("Minute reference (optional)").fill(MINUTE_SENTINEL);
    await page.getByRole("button", { name: "Record commission" }).click();
    await toastOrText(page, "Commission recorded.");
    await page.waitForURL((url) => new RegExp(`${commissionsBase()}/[0-9a-f-]{36}$`).test(url.pathname));

    const [row] = await commissionsByTitle(sql, fx, TITLE);
    expect(row).toMatchObject({ title: TITLE, charge: CHARGE_SENTINEL, about_org_id: fx.congA.id, appointed_on: shift(todayLocal, -30), minute_reference: MINUTE_SENTINEL, ended_on: null, removed_at: null });
    commissionId = row!.id;

    await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();
    await expect(page.getByText(`About ${COMMITTEES_NAMES.congA}`)).toBeVisible();
    await expect(page.getByText(CHARGE_SENTINEL)).toBeVisible();
    await expect(page.getByText(`Minute: ${MINUTE_SENTINEL}`)).toBeVisible();
    await expect(page.getByText(NO_ACCESS_ALDER)).toBeVisible();
    await expect(page.getByText("No one serves on this commission yet.")).toBeVisible();
    for (const action of ["Edit commission", "Add a member"]) await expect(page.getByRole("link", { name: action }).first()).toBeVisible();
    for (const action of ["End commission", "Remove this record"]) await expect(page.getByRole("button", { name: action })).toBeVisible();

    // The list carries the title and the congregation and never the charge.
    await page.goto(base());
    await expect(page.getByRole("link", { name: TITLE })).toBeVisible();
    expect(await mainText(page)).not.toContain(CHARGE_SENTINEL);

    // A record about no congregation says so and names none in its no-access sentence.
    await page.goto(`${commissionsBase()}/new`);
    await waitHydrated(page);
    await page.getByLabel("Title").fill(TITLE_NONE);
    await page.getByRole("button", { name: "Record commission" }).click();
    await toastOrText(page, "Commission recorded.");
    await page.waitForURL((url) => new RegExp(`${commissionsBase()}/[0-9a-f-]{36}$`).test(url.pathname));
    await expect(page.getByText("No congregation recorded")).toBeVisible();
    await expect(page.getByText(NO_ACCESS_NONE)).toBeVisible();
    await expect(page.getByText("No minute recorded")).toBeVisible();
    await page.close();
  });

  test("3. edit: the form carries the record, a save changes it and audits the field names, a stale form is a toast and writes nothing", async () => {
    const page = await newPhonePage(founder);
    await page.goto(`${commissionsBase()}/${commissionId}`);
    await page.getByRole("link", { name: "Edit commission" }).click();
    await waitHydrated(page);
    await expect(page.getByLabel("Title")).toHaveValue(TITLE);
    await expect(page.getByLabel("Congregation (optional)")).toHaveValue(fx.congA.id);
    await page.getByLabel("Title").fill(TITLE_EDITED);
    await page.getByLabel("Charge (optional)").fill(CHARGE_SENTINEL_2);
    await page.getByRole("button", { name: "Save changes" }).click();
    await toastOrText(page, "Commission saved.");
    await page.waitForURL((url) => url.pathname === `${commissionsBase()}/${commissionId}`);
    const saved = (await commissionById(sql, commissionId))!;
    expect(saved).toMatchObject({ title: TITLE_EDITED, charge: CHARGE_SENTINEL_2, about_org_id: fx.congA.id, minute_reference: MINUTE_SENTINEL });
    expect(saved.row_version).toBeGreaterThan(1);
    await expect(page.getByRole("heading", { level: 1, name: TITLE_EDITED })).toBeVisible();
    const updated = (await commissionAudit(sql, fx.presbytery.id)).filter((a) => a.action === "tenant.commission_record.updated");
    expect(updated).toHaveLength(1);
    expect([...(updated[0]!.metadata.changed as string[])].sort()).toEqual(["charge", "title"]);

    // A stale form: someone else changed the record after this form opened.
    await page.goto(`${commissionsBase()}/${commissionId}/edit`);
    await waitHydrated(page);
    await sql`update commission_records set row_version = row_version + 1 where id = ${commissionId}::uuid`;
    await page.getByLabel("Title").fill("Stale Overwrite Attempt");
    await page.getByRole("button", { name: "Save changes" }).click();
    await toastOrText(page, "This record was changed by someone else after you opened it. Reload the page, then make your change again.");
    expect((await commissionById(sql, commissionId))!.title).toBe(TITLE_EDITED);
    await page.close();
  });

  test("4. members: add three and plan one, the added person is no longer offered, end a term and cancel a planned one through their own dialogs", async () => {
    const page = await newPhonePage(founder);
    const nativeDialogs: string[] = [];
    page.on("dialog", (d) => {
      nativeDialogs.push(d.message());
      void d.dismiss();
    });
    // Avery (chair, serving), Blair (planned: starts in 14 days), Casey (serving, with a planned end), Emery (planned: starts in 20 days).
    await page.goto(`${commissionsBase()}/${commissionId}/members/new`);
    await waitHydrated(page);
    await page.getByRole("button", { name: "Add to commission" }).click();
    await expect(page.getByText("Choose a person.")).toBeVisible();
    await addMember(page, "avery", "chair", shift(todayLocal, -10));
    await addMember(page, "blair", "member", shift(todayLocal, 14));
    await addMember(page, "casey", "secretary", shift(todayLocal, -5), shift(todayLocal, 60));
    await addMember(page, "emery", "member", shift(todayLocal, 20));

    // The roster: sections, titles, dates.
    const serving = page.getByRole("region", { name: "Serving now" });
    await expect(serving.getByText(SEATABLE_NAMES.avery).first()).toBeVisible();
    await expect(serving.getByText("Chair", { exact: true }).first()).toBeVisible();
    await expect(serving.getByText(SEATABLE_NAMES.casey).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Starting later" }).getByText(SEATABLE_NAMES.blair).first()).toBeVisible();
    expect(await commissionMembers(sql, commissionId)).toHaveLength(4);

    // A person who already serves is a disabled option.
    await page.goto(`${commissionsBase()}/${commissionId}/members/new`);
    await waitHydrated(page);
    const already = page.locator("#commission-person option", { hasText: `${SEATABLE_NAMES.avery} (already serves)` });
    await expect(already).toHaveCount(1);
    await expect(already).toBeDisabled();

    await page.goto(`${commissionsBase()}/${commissionId}`);
    await waitHydrated(page);
    const dialog = page.getByRole("alertdialog");

    // END A TERM: the commission wording, a date before the start refused in the dialog, "Go back" writes nothing.
    await page.getByRole("button", { name: `End term for ${SEATABLE_NAMES.avery}` }).click();
    await expect(dialog.getByRole("heading", { name: `End ${SEATABLE_NAMES.avery}'s term on this commission?` })).toBeVisible();
    await expect(dialog.getByText("Their name stays in the history of this commission, with its dates.")).toBeVisible();
    await dialog.getByLabel("Ends on").fill(shift(todayLocal, -11));
    await dialog.getByRole("button", { name: "End term" }).click();
    await expect(dialog.getByText("The end date can't be before the start date.")).toBeVisible();
    await dialog.getByRole("button", { name: "Go back" }).click();
    await expect(dialog).toHaveCount(0);
    const members = await commissionMembers(sql, commissionId);
    expect(members.find((m) => m.person_id === fx.seatable.avery)?.ends_on).toBeNull();

    await page.getByRole("button", { name: `End term for ${SEATABLE_NAMES.avery}` }).click();
    await dialog.getByLabel("Ends on").fill(todayLocal);
    await dialog.getByRole("button", { name: "End term" }).click();
    await toastOrText(page, "Term ended.");
    await expect(dialog).toHaveCount(0);
    expect((await commissionMembers(sql, commissionId)).find((m) => m.person_id === fx.seatable.avery)?.ends_on).toBe(todayLocal);
    await expect(page.getByRole("region", { name: "Past members" }).getByText(SEATABLE_NAMES.avery).first()).toBeVisible();

    // CANCEL A PLANNED TERM (Blair): no date field; the term ends at its own start.
    await page.getByRole("button", { name: `Cancel planned term for ${SEATABLE_NAMES.blair}` }).click();
    await expect(dialog.getByLabel("Ends on")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel planned term" }).click();
    await toastOrText(page, "Planned term cancelled.");
    await expect(dialog).toHaveCount(0);
    const blair = (await commissionMembers(sql, commissionId)).find((m) => m.person_id === fx.seatable.blair)!;
    expect(blair.ends_on).toBe(blair.starts_on);

    // CHANGE AN END DATE (Casey has a planned end).
    await page.getByRole("button", { name: `Change end date for ${SEATABLE_NAMES.casey}` }).click();
    await dialog.getByLabel("Ends on").fill(shift(todayLocal, 30));
    await dialog.getByRole("button", { name: "Save end date" }).click();
    await toastOrText(page, "End date saved.");
    expect((await commissionMembers(sql, commissionId)).find((m) => m.person_id === fx.seatable.casey)?.ends_on).toBe(shift(todayLocal, 30));
    expect(nativeDialogs, "no alert, confirm or prompt").toEqual([]);

    const ended = (await commissionAudit(sql, fx.presbytery.id)).filter((a) => a.action === "tenant.commission_record.member_ended");
    expect(ended).toHaveLength(3);
    expect(ended.map((a) => a.metadata.cancelled).sort()).toEqual([false, false, true]);
    await page.close();
  });

  test("5. end the commission: a future date and a date before the appointment are refused in the dialog; a valid date ends every member and keeps the record", async () => {
    const page = await newPhonePage(founder);
    await page.goto(`${commissionsBase()}/${commissionId}`);
    await waitHydrated(page);
    await page.getByRole("button", { name: "End commission" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: "End this commission?" })).toBeVisible();

    await dialog.getByLabel("Ended on").fill(shift(todayLocal, 2));
    await dialog.getByRole("button", { name: "End commission" }).click();
    await expect(dialog.getByText("The end date can't be in the future.")).toBeVisible();
    await dialog.getByLabel("Ended on").fill(shift(todayLocal, -31));
    await dialog.getByRole("button", { name: "End commission" }).click();
    await expect(dialog.getByText(/The end date can't be before .*, when it was appointed\./)).toBeVisible();
    expect((await commissionById(sql, commissionId))!.ended_on).toBeNull();

    // Go back writes nothing; then a valid end.
    await dialog.getByRole("button", { name: "Go back" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await commissionById(sql, commissionId))!.ended_on).toBeNull();
    await page.getByRole("button", { name: "End commission" }).click();
    await dialog.getByLabel("Ended on").fill(todayLocal);
    await dialog.getByLabel("Minute reference for its report (optional)").fill(END_MINUTE_SENTINEL);
    await dialog.getByRole("button", { name: "End commission" }).click();
    await toastOrText(page, "Commission ended.");
    await expect(dialog).toHaveCount(0);

    const ended = (await commissionById(sql, commissionId))!;
    expect(ended.ended_on).toBe(todayLocal);
    expect(ended.ended_minute_reference).toBe(END_MINUTE_SENTINEL);
    // Casey (serving, end planned later) ends today; Emery (not yet started) ends at her own start; Avery and Blair were already over.
    const members = await commissionMembers(sql, commissionId);
    expect(members.find((m) => m.person_id === fx.seatable.casey)?.ends_on).toBe(todayLocal);
    const emery = members.find((m) => m.person_id === fx.seatable.emery)!;
    expect(emery.ends_on).toBe(emery.starts_on);
    expect(members.every((m) => m.ends_on !== null)).toBe(true);
    const endedAudit = (await commissionAudit(sql, fx.presbytery.id)).filter((a) => a.action === "tenant.commission_record.ended");
    expect(endedAudit).toHaveLength(1);
    expect(endedAudit[0]!.metadata).toMatchObject({ commissionId, endedOn: todayLocal, membersEnded: 2 });

    // The page keeps the history and offers no write control but the note's own correction and removal.
    await expect(page.getByText(`Reported in: ${END_MINUTE_SENTINEL}`)).toBeVisible();
    await expect(page.getByText(/^Ended /).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "End commission" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Add a member" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^End term for / })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit commission" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove this record" })).toBeVisible();

    // No one can be added to an ended record, by the form's URL either.
    await page.goto(`${commissionsBase()}/${commissionId}/members/new`);
    await expect(page.getByText("This commission has ended, so no one can be added.")).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);

    // The list: the record moves under "Show ended commissions".
    await page.goto(base());
    await expect(page.getByRole("link", { name: TITLE_EDITED })).toHaveCount(0);
    await page.getByRole("link", { name: "Show ended commissions (1)" }).click();
    await page.waitForURL((url) => url.searchParams.get("show") === "ended");
    await expect(page.getByRole("link", { name: TITLE_EDITED })).toBeVisible();
    await expect(page.getByRole("link", { name: "Hide ended commissions" })).toBeVisible();
    await page.close();
  });

  test("6. remove: the dialog's Go back writes nothing; a removal hides the record, answers 404 afterwards and audits once", async () => {
    const [none] = await commissionsByTitle(sql, fx, TITLE_NONE);
    const page = await newPhonePage(founder);
    await page.goto(`${commissionsBase()}/${none!.id}`);
    await waitHydrated(page);
    await page.getByRole("button", { name: "Remove this record" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: "Remove this record?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Go back" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await commissionById(sql, none!.id))!.removed_at).toBeNull();

    await page.getByRole("button", { name: "Remove this record" }).click();
    await dialog.getByRole("button", { name: "Remove record" }).click();
    await toastOrText(page, "Record removed.");
    await page.waitForURL((url) => url.pathname === base());
    expect((await commissionById(sql, none!.id))!.removed_at).not.toBeNull();
    await expect(page.getByRole("link", { name: TITLE_NONE })).toHaveCount(0);
    const response = await page.goto(`${commissionsBase()}/${none!.id}`);
    expect(response?.status()).toBe(404);
    const removed = (await commissionAudit(sql, fx.presbytery.id)).filter((a) => a.action === "tenant.commission_record.removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.resource_id).toBe(none!.id);
    await page.close();
  });

  test("7. the congregation refusal is one sentence whatever was forged: another presbytery's congregation, a non-congregation, a nonexistent id, a malformed one", async () => {
    const forged = [fx.congOther.id, fx.presbyteryOther.id, "00000000-0000-4090-8000-0000000000fe", "not-a-uuid"];
    const page = await newPhonePage(founder);
    await page.goto(`${commissionsBase()}/new`);
    await waitHydrated(page);
    const before = (await sql`select count(*)::int as n from commission_records where organization_id = ${fx.presbytery.id}::uuid`) as { n: number }[];
    const seen = new Set<string>();
    for (const id of forged) {
      // The select offers only this presbytery's member congregations, so a forged id is added to the DOM.
      await page.evaluate((value) => {
        const select = document.querySelector<HTMLSelectElement>("#commission-congregation")!;
        const option = document.createElement("option");
        option.value = value;
        option.textContent = "forged";
        select.appendChild(option);
      }, id);
      await page.getByLabel("Title").fill("Forged Congregation Commission");
      await page.getByLabel("Congregation (optional)").selectOption(id);
      await page.getByRole("button", { name: "Record commission" }).click();
      const alert = page.getByText(congregationRefusal(), { exact: true });
      await expect(alert, id).toBeVisible();
      seen.add((await alert.innerText()).trim());
    }
    expect([...seen], "every forged id reads the same").toEqual([congregationRefusal()]);
    expect(await commissionsByTitle(sql, fx, "Forged Congregation Commission")).toHaveLength(0);
    const after = (await sql`select count(*)::int as n from commission_records where organization_id = ${fx.presbytery.id}::uuid`) as { n: number }[];
    expect(after[0]!.n).toBe(before[0]!.n);
    // The name of the other presbytery, its congregation and the stranger never appear.
    const text = await mainText(page);
    for (const leak of [fx.congOther.name, fx.presbyteryOther.name]) expect(text).not.toContain(leak);
    await page.close();
  });

  test("8. the clerk (groups.manage only, no second factor) records a commission and is never sent to /totp; the audit names the clerk", async ({ browser }) => {
    const context = await signedInContext(browser, "clerk", base());
    const page = await newPhonePage(context);
    await page.goto(`${commissionsBase()}/new`);
    await waitHydrated(page);
    await page.getByLabel("Title").fill(TITLE_CLERK);
    await page.getByRole("button", { name: "Record commission" }).click();
    await toastOrText(page, "Commission recorded.");
    await page.waitForURL((url) => new RegExp(`${commissionsBase()}/[0-9a-f-]{36}$`).test(url.pathname));
    expect(page.url()).not.toContain("/totp");
    const [row] = await commissionsByTitle(sql, fx, TITLE_CLERK);
    const audit = (await sql`
      select actor_user_id from audit_events where action = 'tenant.commission_record.recorded' and resource_id = ${row!.id}`) as { actor_user_id: string }[];
    expect(audit.map((a) => a.actor_user_id)).toEqual([fx.users.clerk]);
    await context.close();
  });

  test("9. a presbytery member with no role is told they lack the key; a direct hit on every commission page shows and writes nothing", async ({ browser }) => {
    const before = { commissions: (await commissionAudit(sql, fx.presbytery.id)).length, members: (await commissionMembers(sql, commissionId)).length };
    const context = await signedInContext(browser, "plain", base());
    const page = await newPhonePage(context);
    const sentence = `You don't have permission to manage committees at ${fx.presbytery.name}. If you think this is a mistake, ask your presbytery's administrator.`;
    for (const path of [base(), `${commissionsBase()}/new`, `${commissionsBase()}/${commissionId}`, `${commissionsBase()}/${commissionId}/edit`, `${commissionsBase()}/${commissionId}/members/new`]) {
      await page.goto(path);
      await expect(page.getByText(sentence), path).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Committees & Commissions" })).toBeVisible();
      const text = await mainText(page);
      for (const leak of [TITLE_EDITED, TITLE_CLERK, CHARGE_SENTINEL_2, MINUTE_SENTINEL, SEATABLE_NAMES.avery]) expect(text, `${path} leaks ${leak}`).not.toContain(leak);
      await expect(page.locator("form")).toHaveCount(0);
    }
    expect((await commissionAudit(sql, fx.presbytery.id)).length).toBe(before.commissions);
    expect((await commissionMembers(sql, commissionId)).length).toBe(before.members);
    await context.close();
  });

  test("10. the congregation's own administrator cannot reach the record or see it from the congregation", async ({ browser }) => {
    // congClerk (groups.manage at congregation Alder only) is part of the fixture's default `who`.
    const context = await signedInContext(browser, "congClerk", `/o/${fx.congA.slug}/admin/groups`);
    const page = await newPhonePage(context);
    // At the presbytery's path: the one org denial, naming the presbytery, saying nothing of commissions.
    for (const path of [`${commissionsBase()}/${commissionId}`, base()]) {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(500);
      await expect(page.getByRole("heading", { level: 1, name: `You don't have access to ${fx.presbytery.name}` })).toBeVisible();
      const text = await mainText(page);
      expect(text).not.toContain(TITLE_EDITED);
      expect(text).not.toContain("commission");
    }
    // At the congregation's own path: the commissions tool is not for a congregation, and nothing of the record is there.
    await page.goto(`/o/${fx.congA.slug}/admin/committees/commissions/${commissionId}`);
    expect(await mainText(page)).not.toContain(TITLE_EDITED);
    await page.goto(`/o/${fx.congA.slug}`);
    expect(await mainText(page)).not.toContain(TITLE_EDITED);
    await page.goto(`/o/${fx.congA.slug}/admin/groups`);
    expect(await mainText(page)).not.toContain(TITLE_EDITED);
    await context.close();
  });

  test("11. one answer for every commission that is not this presbytery's: malformed, another presbytery's, a committee's id, a congregation's id, a removed or nonexistent one", async () => {
    const foreign = await seedCommission(sql, fx, { title: "E2E Foreign Commission Record", appointedOn: "2024-01-01", orgId: fx.presbyteryOther.id });
    const committee = await seedCommittee(sql, fx, { name: "E2E Cmt Real Committee", kind: "standing" });
    const [removed] = await commissionsByTitle(sql, fx, TITLE_NONE);
    const urls = [
      `${commissionsBase()}/not-a-uuid`,
      `${commissionsBase()}/${foreign}`,
      `${commissionsBase()}/${fx.groups.otherCommittee}`,
      `${commissionsBase()}/${committee}`,
      `${commissionsBase()}/${fx.groups.choir}`,
      `${commissionsBase()}/${fx.congA.id}`,
      `${commissionsBase()}/${removed!.id}`,
      `${commissionsBase()}/00000000-0000-4090-8000-0000000000ff`,
      // The deeper pages answer the same for the same objects.
      `${commissionsBase()}/${foreign}/edit`,
      `${commissionsBase()}/${removed!.id}/edit`,
      `${commissionsBase()}/${foreign}/members/new`,
      `${commissionsBase()}/00000000-0000-4090-8000-0000000000ff/members/new`,
    ];
    const page = await newPhonePage(founder);
    const bodies = new Set<string>();
    for (const url of urls) {
      const response = await page.goto(url);
      expect(response?.status(), url).toBe(404);
      const body = await mainText(page);
      bodies.add(body);
      for (const name of ["E2E Foreign Commission Record", COMMITTEES_NAMES.otherCommittee, COMMITTEES_NAMES.choir, TITLE_NONE, fx.congA.name]) expect(body, `${url} names ${name}`).not.toContain(name);
    }
    expect([...bodies], "every miss reads the same").toHaveLength(1);
    // A commission's id typed into the committee page is the committee page's own miss.
    const response = await page.goto(`${base()}/${removed!.id}`);
    expect(response?.status()).toBe(404);
    await page.close();
  });

  test("12. with org_portal.committees off, every commission page says it isn't turned on and shows nothing of the records", async ({ browser }) => {
    const context = await signedInContext(browser, "clerk", base());
    await setFlag(sql, COMMITTEES_FLAG, false);
    try {
      const page = await newPhonePage(context);
      for (const path of [base(), `${commissionsBase()}/new`, `${commissionsBase()}/${commissionId}`, `${commissionsBase()}/${commissionId}/edit`, `${commissionsBase()}/${commissionId}/members/new`]) {
        await page.goto(path);
        await expect(page.getByText(`Committees & Commissions isn't turned on for ${fx.presbytery.name} yet.`), path).toBeVisible();
        await expect(page.getByText(TITLE_EDITED)).toHaveCount(0);
        await expect(page.getByText("Administrative commissions")).toHaveCount(0);
        await expect(page.locator("form")).toHaveCount(0);
      }
      await page.close();
    } finally {
      await setFlag(sql, COMMITTEES_FLAG, true);
      await context.close();
    }
  });

  test("13. every audit row carries ids, roles, dates, counts and field names and no title, charge, minute or name", async () => {
    const rowsAudited = await commissionAudit(sql, fx.presbytery.id);
    const kinds = new Set(rowsAudited.map((a) => a.action));
    for (const expected of [
      "tenant.commission_record.recorded",
      "tenant.commission_record.updated",
      "tenant.commission_record.member_added",
      "tenant.commission_record.member_ended",
      "tenant.commission_record.ended",
      "tenant.commission_record.removed",
    ]) {
      expect(kinds, `an audit row ${expected} exists`).toContain(expected);
    }
    const allowed = new Set(["organizationId", "commissionId", "aboutOrgId", "changed", "memberId", "personId", "role", "startsOn", "endsOn", "endedOn", "membersEnded", "cancelled"]);
    for (const row of rowsAudited) {
      expect(row.metadata.organizationId).toBe(fx.presbytery.id);
      for (const key of Object.keys(row.metadata)) expect(allowed.has(key), `${row.action} carries the key ${key}`).toBe(true);
    }
    const text = JSON.stringify(rowsAudited);
    for (const forbidden of [
      "SENTINEL",
      CHARGE_SENTINEL,
      MINUTE_SENTINEL,
      END_MINUTE_SENTINEL,
      TITLE,
      TITLE_NONE,
      TITLE_CLERK,
      "Commission E2E",
      "E2E Committees Congregation",
      ...Object.values(SEATABLE_NAMES),
      "Peabody",
      "Marchetti",
    ]) {
      expect(text, `no audit row carries "${forbidden}"`).not.toContain(forbidden);
    }
    // The committee audit stream is untouched by commission work (a record is not a committee).
    expect((await committeesAudit(sql, fx.presbytery.id)).filter((a) => /commission/.test(a.action))).toEqual([]);
  });

  test("14. nothing in this spec wrote administrative_commissions, org_delegations or role_grants, and no member holds a role through a record", async () => {
    expect(await downwardCounts(sql, fx)).toEqual(baseline);
    // The member tables carry no role or group column at all (the record is not a grant).
    const columns = (await sql`
      select column_name from information_schema.columns
       where table_name in ('commission_records', 'commission_record_members') and column_name in ('role_id', 'group_id', 'public_listed')`) as unknown[];
    expect(columns).toEqual([]);
  });

  test("15. at 360px a 200-character title, a 498-character charge, a 200-character minute and a 120-character person name wrap: no sideways scroll, every control 44px, no callbackUrl", async () => {
    expect(LONG_TITLE).toHaveLength(200);
    expect(LONG_CHARGE.length).toBeLessThanOrEqual(500);
    expect(LONG_MINUTE.length).toBeLessThanOrEqual(200);
    expect(LONG_PERSON).toHaveLength(120);
    const long = await seedCommission(sql, fx, { title: LONG_TITLE, charge: LONG_CHARGE, aboutOrgId: fx.congA.id, appointedOn: "2024-03-01", minuteReference: LONG_MINUTE });
    await seedCommissionMember(sql, fx, long, fx.seatable.long, { role: "chair", startsOn: "2024-03-01" });
    await seedCommissionMember(sql, fx, long, fx.seatable.devon, { role: "member", startsOn: "2024-03-01", endsOn: shift(todayLocal, 15) });
    const page = await newPhonePage(founder, 360, 740);

    const checks: Array<[string, string]> = [
      ["the list", base()],
      ["the long commission's page", `${commissionsBase()}/${long}`],
      ["its edit form", `${commissionsBase()}/${long}/edit`],
      ["its add form", `${commissionsBase()}/${long}/members/new`],
      ["the record form", `${commissionsBase()}/new`],
    ];
    for (const [what, path] of checks) {
      await page.goto(path);
      if (path.endsWith("/edit") || path.endsWith("/new")) await waitHydrated(page);
      await expectNoSidewaysScroll(page, what);
      expect(await smallControls(page), `${what}: controls under 44px`).toEqual([]);
      const hrefs = await page.locator("main a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
      for (const href of hrefs) expect(href, `${what}: ${href}`).not.toMatch(/callbackUrl|[?&]next=/);
    }

    await page.goto(`${commissionsBase()}/${long}`);
    await waitHydrated(page);
    await expect(page.getByRole("link", { name: "Back to committees" })).toHaveAttribute("href", base());
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Commission");
    const serving = page.getByRole("region", { name: "Serving now" });
    await expect(serving.getByText("Chair", { exact: true }).first()).toBeVisible();
    await expect(serving.getByText(/^Since /).first()).toBeVisible();
    await expect(serving.getByText(/^Ends /).first()).toBeVisible();

    // Each dialog, open on the long page: inside the viewport, every button 44px (layout sizes: a dialog opens with a scale animation).
    const dialog = page.getByRole("alertdialog");
    for (const opener of [`End term for ${LONG_PERSON}`, "End commission", "Remove this record"]) {
      await page.getByRole("button", { name: opener }).click();
      await expect(dialog).toBeVisible();
      const fit = await dialog.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, buttons: Array.from(el.querySelectorAll<HTMLElement>("button")).map((b) => ({ name: (b.textContent ?? "").trim(), height: b.offsetHeight })) };
      });
      expect(fit.left, opener).toBeGreaterThanOrEqual(-1);
      expect(fit.right, opener).toBeLessThanOrEqual(361);
      await expectNoSidewaysScroll(page, `the ${opener} dialog`);
      expect(fit.buttons.length).toBeGreaterThan(0);
      for (const button of fit.buttons) expect(button.height, `${opener}: dialog button "${button.name}"`).toBeGreaterThanOrEqual(44);
      await dialog.getByRole("button", { name: "Go back" }).click();
      await expect(dialog).toHaveCount(0);
    }
    await page.close();
  });

  test("16. at 1280px the list is a table and the roster is a table, neither scrolls sideways", async () => {
    const [ended] = await commissionsByTitle(sql, fx, TITLE_EDITED);
    const context = await founder.browser()!.newContext({ viewport: { width: 1280, height: 900 }, storageState: await founder.storageState() });
    const page = await context.newPage();
    await page.goto(base());
    const section = page.getByRole("region", { name: "Administrative commissions" });
    for (const name of ["Title", "Congregation", "Appointed", "Status", "Serving"]) {
      await expect(section.getByRole("columnheader", { name, exact: true }), name).toBeVisible();
    }
    await expect(page.getByRole("cell", { name: LONG_TITLE })).toBeVisible();
    await expectNoSidewaysScroll(page, "the desktop list");

    await page.goto(`${commissionsBase()}/${ended!.id}`);
    const past = page.getByRole("region", { name: "Past members" });
    for (const name of ["Name", "Role", "Dates"]) await expect(past.getByRole("columnheader", { name }), name).toBeVisible();
    await expect(past.getByRole("cell", { name: SEATABLE_NAMES.avery, exact: true })).toBeVisible();
    await expectNoSidewaysScroll(page, "the desktop commission page");
    await context.close();
  });
});
