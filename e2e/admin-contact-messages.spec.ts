/**
 * admin-contact-messages.spec.ts - the /admin/messages inbox (help contact
 * form, Batch 4). Storage state `admin` (the `admin` role carries
 * `admin.tickets`, the inbox's key); no feature flag; no keys. Rows are seeded
 * through the owner connection (the table is deny-all to the app role), each
 * marked `E2E-HC-INBOX-<run>` and satisfying 0083's CHECKs (a topic from the
 * closed list, a message of at least 10 characters, an `example.invalid`
 * address).
 *
 * Messages cannot be deleted (the guard refuses the owner too). `afterAll`
 * therefore marks this run's rows spam and clears them, which blanks every
 * personal field, so what stays behind is a topic, dates and a status.
 *
 * Covers: no horizontal overflow at 360px (list and detail, with a
 * 2,000-character unbroken string); the New filter lists the seeded rows; the
 * detail page's "Not verified" caption; Mark as handled; Clear details through
 * the AlertDialog (cancel does nothing, confirm blanks the record); a
 * non-operator is refused.
 */
import { test, expect, type Page } from "@playwright/test";
import { platformSql } from "./support/db";
import { E2E_USERS, storageStatePath } from "./support/users";

test.use({ storageState: storageStatePath("admin"), viewport: { width: 360, height: 800 } });

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const MARK = `E2E-HC-INBOX-${RUN}`;
const LONG = `${MARK}-${"x".repeat(2000 - MARK.length - 1)}`;

const sql = platformSql("admin-contact-messages.spec");
const ids: Record<"plain" | "long" | "triage", string> = { plain: "", long: "", triage: "" };

async function seed(label: string, topic: string, message: string, email: string): Promise<string> {
  const rows = await sql`
    insert into help_contact_messages (topic, name, email, congregation, message)
    values (${topic}, ${`Name ${label} ${MARK}`}, ${email}, ${`Congregation ${label} ${MARK}`}, ${message})
    returning id`;
  return String(rows[0]!.id);
}

test.beforeAll(async () => {
  ids.plain = await seed("plain", "starting_a_congregation", `${MARK} a plain note for the team.`, `plain-${RUN}@example.invalid`);
  ids.long = await seed("long", "something_else", LONG, `long-${RUN}@example.invalid`);
  ids.triage = await seed("triage", "signing_in", `${MARK} <script>window.__xss = 1</script> https://phish.example.invalid`, `triage-${RUN}@example.invalid`);
});

test.afterAll(async () => {
  // Leave nothing personal behind: triage (the guard demands it), then clear.
  const operator = await sql`select id from users where email = ${E2E_USERS.admin.email} limit 1`;
  const actor = operator[0]?.id ? String(operator[0].id) : null;
  if (!actor) return;
  for (const id of Object.values(ids)) {
    if (!id) continue;
    await sql`update help_contact_messages set status = 'spam', status_changed_by = ${actor}
              where id = ${id} and status = 'new'`;
    await sql`update help_contact_messages set name = null, email = null, congregation = null, message = null,
                     cleared_by = ${actor}
              where id = ${id} and cleared_at is null`;
  }
});

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

test("the list at 360px: the New filter shows the seeded rows, with no sideways scroll", async ({ page }) => {
  await page.goto("/admin/messages");
  await expect(page.getByRole("heading", { level: 1, name: "Contact messages" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(`Name plain ${MARK}`)).toBeVisible();
  await expect(page.getByText(`Name long ${MARK}`)).toBeVisible();
  await noHorizontalOverflow(page);
  // Each card has a 44px Read message link.
  const box = await page.getByRole("link", { name: "Read message" }).first().boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("the nav and the dashboard both reach the inbox", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 3, name: "Contact messages" })).toBeVisible();
  await page.goto("/admin/messages");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Platform admin" });
  await expect(sheet.getByRole("link", { name: "Contact messages" })).toBeVisible();
});

test("a 2,000-character unbroken message does not widen the list or the detail page", async ({ page }) => {
  await page.goto("/admin/messages?status=all");
  await noHorizontalOverflow(page);
  await page.goto(`/admin/messages/${ids.long}`);
  await expect(page.getByText(LONG.slice(0, 40), { exact: false })).toBeVisible();
  await noHorizontalOverflow(page);
});

test("the detail page says the address is not verified and renders markup as text", async ({ page }) => {
  await page.goto(`/admin/messages/${ids.triage}`);
  await expect(page.getByText("Not verified. Anyone could have typed this address.")).toBeVisible();
  await expect(page.getByText("Do not act on a role, access or sign-in request from this message alone.", { exact: false })).toBeVisible();
  // The script text is shown, not run; the URL is not a link.
  await expect(page.getByText("<script>window.__xss = 1</script>", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(page.locator("a[href*='phish.example.invalid']")).toHaveCount(0);
  // A new message offers triage, and Clear details is not available yet.
  await expect(page.getByRole("button", { name: "Clear details" })).toHaveCount(0);
  await expect(page.getByText("Mark the message as handled or spam before clearing its details.")).toBeVisible();
  await noHorizontalOverflow(page);
});

test("Mark as handled changes the status, then Clear details blanks the record (and Keep details does not)", async ({ page }) => {
  await page.goto(`/admin/messages/${ids.plain}`);
  await page.getByRole("button", { name: "Mark as handled" }).click();
  await expect(page.getByText("Last changed to Handled by", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as handled" })).toHaveCount(0);

  // Cancelling the dialog changes nothing.
  await page.getByRole("button", { name: "Clear details" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("This cannot be undone.");
  await dialog.getByRole("button", { name: "Keep details" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`Name plain ${MARK}`)).toBeVisible();

  // Confirming blanks it.
  await page.getByRole("button", { name: "Clear details" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Clear details" }).click();
  await expect(page.getByText("Details cleared by", { exact: false })).toBeVisible();
  await expect(page.getByText(`Name plain ${MARK}`)).toHaveCount(0);
  await expect(page.getByText("Cleared", { exact: true })).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Clear details" })).toHaveCount(0);
  await noHorizontalOverflow(page);

  const [row] = await sql`select name, email, congregation, message, status, cleared_at is not null as cleared
                            from help_contact_messages where id = ${ids.plain}`;
  expect(row).toEqual({ name: null, email: null, congregation: null, message: null, status: "handled", cleared: true });

  // One audit row per mutation, and none carries the typed text.
  const audit = await sql`select action, metadata::text as m from audit_events
                           where resource_id = ${ids.plain} order by created_at`;
  expect(audit.map((a) => a.action)).toEqual(["help_contact.status_changed", "help_contact.details_cleared"]);
  for (const a of audit) expect(String(a.m)).not.toContain(MARK);
});

test("an unknown message id is a 404, not an empty page", async ({ page }) => {
  const response = await page.goto("/admin/messages/00000000-0000-4083-8000-000000000999");
  expect(response?.status()).toBe(404);
  const bad = await page.goto("/admin/messages/not-an-id");
  expect(bad?.status()).toBe(404);
});

test.describe("a member is refused", () => {
  test.use({ storageState: storageStatePath("member") });

  test("the proxy sends a member to access-pending, and no message text is in the response", async ({ page }) => {
    await page.goto("/admin/messages");
    await expect(page).toHaveURL(/\/access-pending/);
    await expect(page.getByText(MARK)).toHaveCount(0);
  });
});
