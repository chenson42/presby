/**
 * Shared helpers for the contact lane's specs (form.spec.ts, prod-build.spec.ts). Rows are read
 * through the owner connection and matched by a per-test MARKER that appears in the message body;
 * no real name, address or credential appears anywhere (`example.invalid`, RFC 2606).
 */
import { expect, type Page, type Request } from "@playwright/test";
import { platformSql, type Sql } from "../support/db";

/** What the stubbed Cloudflare script hands the island as a token. Cloudflare's documented dummy value. */
export const STUB_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/**
 * Replaces Cloudflare's api.js with a stub that calls the widget callback with the dummy token
 * after a moment. Counts `render` calls on `window.__turnstileRenders` so a spec can tell whether
 * the widget was remounted (a spent token) or left alone (a kept one).
 */
export async function stubTurnstile(page: Page): Promise<void> {
  await page.route(/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        window.__turnstileRenders = 0;
        window.turnstile = {
          render: function (el, opts) {
            window.__turnstileRenders += 1;
            el.setAttribute("data-stub-widget", "1");
            setTimeout(function () { opts.callback(${JSON.stringify(STUB_TOKEN)}); }, 30);
            return "stub-" + window.__turnstileRenders;
          },
          remove: function () {}
        };`,
    }),
  );
}

export function marker(label: string): string {
  return `E2E-HC-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface Typed {
  topic: "starting_a_congregation" | "signing_in" | "help_page_wrong" | "something_else";
  name: string;
  email: string;
  congregation: string;
  message: string;
}

export function typedFor(mark: string, overrides: Partial<Typed> = {}): Typed {
  return {
    topic: "something_else",
    name: `Marker Name ${mark}`,
    email: `${mark.toLowerCase()}@example.invalid`,
    congregation: `Marker Congregation ${mark}`,
    message: `Marker message ${mark}: a perfectly ordinary note for the team.`,
    ...overrides,
  };
}

/** Fills the form (does not submit). */
export async function fillForm(page: Page, typed: Typed): Promise<void> {
  await page.locator("#contact-topic").selectOption(typed.topic);
  await page.locator("#contact-name").fill(typed.name);
  await page.locator("#contact-email").fill(typed.email);
  await page.locator("#contact-congregation").fill(typed.congregation);
  await page.locator("#contact-message").fill(typed.message);
}

/** Opens the page and waits for the form to be enabled with a token in hand (the button is the signal). */
export async function openForm(page: Page): Promise<void> {
  await page.goto("/help/contact");
  await expect(page.getByTestId("contact-form")).toBeVisible();
  await expect(page.locator("#contact-topic")).toBeEnabled();
}

export async function waitForToken(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
}

export type UiOutcome = "sent" | "busy" | "check_failed" | "not_sent" | "unavailable" | "invalid";

const OUTCOME_TEST_IDS: Record<UiOutcome, string> = {
  sent: "contact-sent",
  busy: "contact-busy",
  check_failed: "contact-check_failed",
  not_sent: "contact-not_sent",
  unavailable: "contact-unavailable",
  invalid: "contact-error-summary",
};

/** Submits through the UI and returns which result block appeared. */
export async function submitViaUi(page: Page, typed: Typed): Promise<UiOutcome> {
  await openForm(page);
  await fillForm(page, typed);
  await waitForToken(page);
  await page.getByRole("button", { name: "Send message" }).click();
  const any = page.locator(Object.values(OUTCOME_TEST_IDS).map((id) => `[data-testid="${id}"]`).join(", "));
  await expect(any.first()).toBeVisible({ timeout: 30_000 });
  for (const [kind, id] of Object.entries(OUTCOME_TEST_IDS)) {
    if (await page.getByTestId(id).isVisible()) return kind as UiOutcome;
  }
  throw new Error("no outcome block was visible");
}

export interface StoredRow {
  id: string;
  topic: string;
  name: string | null;
  email: string | null;
  congregation: string | null;
  message: string | null;
  status: string;
  notified_at: string | null;
  created_at: string;
}

export function ownerSql(spec: string): Sql {
  return platformSql(spec);
}

/** Every stored row whose message carries `mark`. */
export async function rowsFor(sql: Sql, mark: string): Promise<StoredRow[]> {
  return (await sql`
    select id, topic, name, email, congregation, message, status, notified_at, created_at
      from help_contact_messages where message like ${`%${mark}%`} order by created_at`) as StoredRow[];
}

/** The database's own clock, so a comparison never depends on this machine's. */
export async function dbNow(sql: Sql): Promise<string> {
  const [row] = (await sql`select now()::text as now`) as { now: string }[];
  return row!.now;
}

/** The scrollbar test: nothing is wider than the viewport. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
}

/** A captured Server Action request: enough to replay it byte for byte. */
export interface CapturedAction {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

export function captureServerAction(page: Page): { get: () => CapturedAction | null } {
  let captured: CapturedAction | null = null;
  page.on("request", (req: Request) => {
    if (req.method() !== "POST" || !req.headers()["next-action"]) return;
    const body = req.postDataBuffer();
    if (!body) return;
    captured = { url: req.url(), headers: req.headers(), body };
  });
  return { get: () => captured };
}
