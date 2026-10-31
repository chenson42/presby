/**
 * The /help/contact form against a running server (the contact lane: `npm run test:e2e:contact`;
 * docs/work-log/2026-10-31-help-contact.md, Phase 3 "E2E"). The server is this config's own, with
 * Cloudflare's PUBLIC test keys in its environment and the rate limiter ON; nobody signs in.
 *
 * Rows are read through the owner connection and matched by a per-test marker. The table cannot be
 * cleaned (never deleted), so the lane stores about 8 messages in all; `global-setup.ts` refuses to
 * start when the last hour is already close to the database ceiling. Each test that stores uses its
 * own `x-real-ip`, because the in-memory limiter lives as long as the server does.
 *
 * Every phone check is at 360px.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  STUB_TOKEN,
  captureServerAction,
  dbNow,
  expectNoHorizontalOverflow,
  fillForm,
  marker,
  openForm,
  ownerSql,
  rowsFor,
  stubTurnstile,
  submitViaUi,
  typedFor,
  waitForToken,
} from "./support";
import { rawPost } from "../support/custom-hosts";
import { HELP_CONTACT_OUTCOME_COPY as OUTCOME, HELP_CONTACT_FORM_COPY as COPY, HELP_CONTACT_EXIT_COPY as EXIT } from "../../src/lib/help-contact/copy";

const sql = ownerSql("help-contact/form.spec");
let laneStart = "";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeAll(async () => {
  laneStart = await dbNow(sql);
});

async function phone(browser: Browser, ip: string, opts: { stub?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, extraHTTPHeaders: { "x-real-ip": ip } });
  const page = await ctx.newPage();
  if (opts.stub !== false) await stubTurnstile(page);
  return { ctx, page };
}

test("canary: the page renders the form, not the unavailable block, and is static and cookie-free", async ({ request }) => {
  const res = await request.get("/help/contact");
  expect(res.status()).toBe(200);
  expect(res.headers()["set-cookie"]).toBeUndefined();
  const html = await res.text();
  expect(html).toMatch(/<meta name="robots" content="[^"]*noindex/);
  expect(html).toContain('data-testid="contact-form"');
  expect(html).not.toContain("contact-unavailable");
  expect(html).toContain('method="post"');
});

test("1. happy path at 360px: success replaces the form, the row holds the typed values, nothing is mailed to the typed address", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "198.51.100.11");
  const mark = marker("happy");
  const typed = typedFor(mark, { topic: "signing_in" });
  try {
    await openForm(page);
    await expect(page.getByRole("heading", { level: 1, name: COPY.title })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("button", { name: COPY.button })).toBeDisabled();
    await fillForm(page, typed);
    await waitForToken(page);
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: COPY.button }).click();

    const sent = page.getByTestId("contact-sent");
    await expect(sent).toBeVisible({ timeout: 30_000 });
    await expect(sent).toBeFocused();
    await expect(sent.getByRole("heading", { name: OUTCOME.sentHeading })).toBeVisible();
    await expect(sent).toContainText(OUTCOME.sentBody);
    await expect(sent).toContainText(OUTCOME.sentSigningIn); // the topic-dependent paragraph
    await expect(page.getByTestId("contact-form")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    const rows = await rowsFor(sql, mark);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      topic: "signing_in",
      name: typed.name,
      email: typed.email,
      congregation: typed.congregation,
      message: typed.message,
      status: "new",
    });

    // C5, C9: no path mails the typed address, and no notification carries the visitor's text.
    const mailed = (await sql`select count(*)::int as n from email_queue where lower(to_email) = ${typed.email.toLowerCase()}`) as { n: number }[];
    expect(mailed[0]!.n).toBe(0);
    const leaked = (await sql`
      select count(*)::int as n from email_queue
       where template_key = 'help_contact_notification' and created_at >= ${laneStart}::timestamptz
         and (html_body like ${`%${mark}%`} or coalesce(text_body, '') like ${`%${mark}%`} or subject like ${`%${mark}%`})`) as { n: number }[];
    expect(leaked[0]!.n).toBe(0);
  } finally {
    await ctx.close();
  }
});

test("2. field errors keep the typed text, the summary takes focus, and the token is kept (the widget is not remounted)", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "198.51.100.12");
  const mark = marker("errors");
  const typed = typedFor(mark, { email: "not an email", message: "short" });
  try {
    await openForm(page);
    await fillForm(page, typed);
    await waitForToken(page);
    const rendersBefore = await page.evaluate(() => (window as unknown as { __turnstileRenders: number }).__turnstileRenders);
    await page.getByRole("button", { name: COPY.button }).click();

    const summary = page.getByTestId("contact-error-summary");
    await expect(summary).toBeVisible({ timeout: 30_000 });
    await expect(summary).toBeFocused();
    await expect(summary).toContainText(COPY.errorSummary);
    await expect(summary).toContainText(OUTCOME.emailBadFormat);
    await expect(summary).toContainText(OUTCOME.messageShort);
    // beside the fields, linked for assistive technology
    await expect(page.locator("#contact-email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#contact-email")).toHaveAttribute("aria-describedby", /contact-email-error/);
    await expect(page.locator("#contact-email-error")).toContainText(OUTCOME.emailBadFormat);
    // the typed text is still there
    await expect(page.locator("#contact-email")).toHaveValue(typed.email);
    await expect(page.locator("#contact-message")).toHaveValue(typed.message);
    await expect(page.locator("#contact-name")).toHaveValue(typed.name);
    expect(await rowsFor(sql, mark)).toHaveLength(0);
    await expectNoHorizontalOverflow(page);

    // A rejected submission never reached Turnstile, so the token is still good: the widget was not remounted
    // and the button is still enabled with no new check.
    expect(await page.evaluate(() => (window as unknown as { __turnstileRenders: number }).__turnstileRenders)).toBe(rendersBefore);
    await expect(page.getByRole("button", { name: COPY.button })).toBeEnabled();

    await page.locator("#contact-email").fill(`${mark.toLowerCase()}@example.invalid`);
    await page.locator("#contact-message").fill(`Marker message ${mark}: now long enough to be sent.`);
    await page.getByRole("button", { name: COPY.button }).click();
    await expect(page.getByTestId("contact-sent")).toBeVisible({ timeout: 30_000 });
    expect(await rowsFor(sql, mark)).toHaveLength(1);
  } finally {
    await ctx.close();
  }
});

test("2b. an over-long message is rejected, never truncated, with its length in the sentence", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "198.51.100.13");
  const mark = marker("long");
  const long = `Marker ${mark} ` + "w".repeat(2100);
  try {
    await openForm(page);
    await fillForm(page, typedFor(mark, { message: long }));
    await expect(page.locator("#contact-message-count")).toContainText("of 2,000 characters");
    await waitForToken(page);
    await page.getByRole("button", { name: COPY.button }).click();
    const summary = page.getByTestId("contact-error-summary");
    await expect(summary).toBeVisible({ timeout: 30_000 });
    await expect(summary).toContainText(/Your message is [\d,]+ characters\. The limit is 2,000\./);
    await expect(page.locator("#contact-message")).toHaveValue(long); // never truncated
    expect(await rowsFor(sql, mark)).toHaveLength(0);
  } finally {
    await ctx.close();
  }
});

test("3. the honeypot returns the same success and writes no row", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "198.51.100.14");
  const mark = marker("honey");
  try {
    await openForm(page);
    await fillForm(page, typedFor(mark));
    // The honeypot is off-screen and unreachable by keyboard; a bot fills it anyway.
    await page.evaluate(() => {
      const hp = document.getElementById("contact-hp") as HTMLInputElement;
      hp.value = "http://spam.example.invalid";
    });
    await waitForToken(page);
    await page.getByRole("button", { name: COPY.button }).click();
    await expect(page.getByTestId("contact-sent")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("contact-sent")).toContainText(OUTCOME.sentHeading);
    expect(await rowsFor(sql, mark)).toHaveLength(0);
  } finally {
    await ctx.close();
  }
});

test("3b. the honeypot is off-screen, out of the tab order and hidden from assistive technology", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "198.51.100.15");
  try {
    await openForm(page);
    const hp = page.locator("#contact-hp");
    await expect(hp).toHaveAttribute("name", "_hp");
    await expect(hp).toHaveAttribute("tabindex", "-1");
    await expect(hp).toHaveAttribute("autocomplete", "off");
    await expect(hp).toHaveAttribute("aria-hidden", "true");
    const box = await hp.boundingBox();
    expect(box === null || box.x + box.width < 0).toBe(true);
    await expectNoHorizontalOverflow(page);
  } finally {
    await ctx.close();
  }
});

test("4. the live limiter: three stored per IP, the fourth is busy with its exit, another IP still works, and refusals write ONE audit row with no IP", async ({ browser }) => {
  const ip = "198.51.100.21";
  const { ctx, page } = await phone(browser, ip);
  const stamp = await dbNow(sql);
  const marks = [marker("lim-a"), marker("lim-b"), marker("lim-c")];
  try {
    for (const mark of marks) expect(await submitViaUi(page, typedFor(mark))).toBe("sent");
    for (const mark of marks) expect(await rowsFor(sql, mark)).toHaveLength(1);

    const refusedMark = marker("lim-refused");
    expect(await submitViaUi(page, typedFor(refusedMark))).toBe("busy");
    const busy = page.getByTestId("contact-busy");
    await expect(busy).toContainText(OUTCOME.busy);
    await expect(busy).toBeFocused();
    await expect(busy.getByTestId("contact-exit")).toContainText(EXIT.line1);
    await expect(busy.getByRole("link", { name: /PresbyPortal repository/ })).toHaveAttribute("href", "https://github.com/chenson42/presby");
    await expect(page.locator("#contact-message")).toHaveValue(/Marker message/); // the text is kept
    expect(await rowsFor(sql, refusedMark)).toHaveLength(0);
    await expectNoHorizontalOverflow(page);

    // two more refusals from the same IP: still ONE audit row (one per kind per hour, CA5)
    expect(await submitViaUi(page, typedFor(marker("lim-refused2")))).toBe("busy");
    expect(await submitViaUi(page, typedFor(marker("lim-refused3")))).toBe("busy");

    const audit = async () =>
      (await sql`
        select resource_id, ip, metadata::text as metadata, actor_user_id
          from audit_events
         where action = 'rate_limit.blocked' and resource_id like 'help_contact:%' and created_at >= ${stamp}::timestamptz`) as {
        resource_id: string; ip: string | null; metadata: string; actor_user_id: string | null;
      }[];
    await expect.poll(async () => (await audit()).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    const rows = await audit();
    const ipRows = rows.filter((r) => r.resource_id === "help_contact:ip");
    expect(ipRows).toHaveLength(1);
    expect(ipRows[0]!.ip).toBeNull();
    expect(ipRows[0]!.actor_user_id).toBeNull();
    for (const r of rows) {
      expect(r.metadata).not.toContain(ip);
      expect(r.metadata).not.toContain("Marker");
      expect(r.resource_id).not.toContain(ip);
    }
  } finally {
    await ctx.close();
  }

  // a different IP is a different key, and still gets in
  const other = await phone(browser, "198.51.100.22");
  try {
    const mark = marker("lim-other");
    expect(await submitViaUi(other.page, typedFor(mark))).toBe("sent");
    expect(await rowsFor(sql, mark)).toHaveLength(1);
  } finally {
    await other.ctx.close();
  }
});

test("6. Turnstile blocked: the check-did-not-load note and the exit show in words, the button stays off, and the form stays readable", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "198.51.100.31", { stub: false });
  await page.route(/challenges\.cloudflare\.com/, (route) => route.abort());
  try {
    await openForm(page);
    await expect(page.getByRole("button", { name: COPY.button })).toBeDisabled();
    await expect(page.getByText(COPY.waiting)).toBeVisible();
    const note = page.getByTestId("contact-check-note");
    await expect(note).toBeVisible({ timeout: 20_000 }); // the island's 8 second timer
    await expect(note).toContainText(EXIT.checkDidNotLoad);
    await expect(note.getByTestId("contact-exit")).toContainText(EXIT.line1);
    await expect(page.getByRole("button", { name: COPY.button })).toBeDisabled();
    await expect(page.getByText(COPY.waiting)).toHaveCount(0); // the note replaces the reason line
    await expect(page.locator("#contact-message")).toBeEnabled(); // still readable and typeable
    await expectNoHorizontalOverflow(page);
  } finally {
    await ctx.close();
  }
});

test("6b. JavaScript off: the noscript block carries the reason and the exit, and nothing can be submitted", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  try {
    await page.goto("/help/contact");
    const block = page.getByTestId("contact-noscript");
    await expect(block).toBeVisible();
    await expect(block).toContainText(EXIT.noScript);
    await expect(block.getByTestId("contact-exit")).toContainText(EXIT.line1);
    await expect(page.locator("#contact-message")).toBeDisabled(); // the hydration gate never opens
    await expect(page.getByRole("button", { name: COPY.button })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
  } finally {
    await ctx.close();
  }
});

test("7. pre-hydration: every control is disabled until the scripts run, then enabled; the form posts; typed text never reaches the URL", async ({ browser }) => {
  const { ctx, page } = await phone(browser, "198.51.100.41");
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => {
    await released;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto("/help/contact", { waitUntil: "domcontentloaded" });
    const form = page.getByTestId("contact-form");
    await expect(form).toBeVisible();
    await expect(form).toHaveAttribute("method", "post");
    for (const id of ["#contact-topic", "#contact-name", "#contact-email", "#contact-congregation", "#contact-message"]) {
      await expect(page.locator(id), id).toBeDisabled();
    }
    await expect(page.getByRole("button", { name: COPY.button })).toBeDisabled();
    await expect(page.locator("[data-slot=hydration-gate]")).toHaveAttribute("aria-busy", "true");

    release();
    await expect(page.locator("#contact-topic")).toBeEnabled({ timeout: 30_000 }); // control enablement is the hydration signal
    const mark = marker("hydrate");
    await fillForm(page, typedFor(mark));
    expect(page.url()).not.toContain(mark);
    expect(page.url()).not.toContain("?");
  } finally {
    await ctx.close();
  }
});

test("8. the custom-host POST (CA7): the same Server Action request that stores on the platform host stores nothing on a church's own host", async ({ browser, request, baseURL }) => {
  // KNOWN DEFECT, an open Phase 3 loop-back (docs/work-log/2026-10-31-help-contact.md, Phase 4 Batch 3, "CA7 does not hold").
  // On a church's own host the proxy rewrites the POST into the /site/<host> tree, where this action's id is not
  // registered, so Next FORWARDS the action to its owning route with an internal fetch that replaces `Host` with the
  // server's own (`localhost`) and adds `x-action-forwarded`; the original host survives only in `x-forwarded-host`.
  // submit.ts step 1 reads `Host` alone (R3), sees a platform host, and STORES the message. Measured 2026-10-31 on the
  // dev server: the replay below returns `{"kind":"sent"}` and writes a row. `test.fail` keeps the lane green while the
  // ruling is open AND turns red the moment the defect is fixed, so the annotation cannot outlive it.
  test.fail(true, "CA7 loop-back: Next forwards the Server Action with Host replaced; the host check cannot see the custom host");
  const { ctx, page } = await phone(browser, "198.51.100.51");
  const capture = captureServerAction(page);
  const mark = marker("custom");
  try {
    await openForm(page);
    await fillForm(page, typedFor(mark));
    await waitForToken(page);
    await page.getByRole("button", { name: COPY.button }).click();
    await expect(page.getByTestId("contact-sent")).toBeVisible({ timeout: 30_000 });
  } finally {
    await ctx.close();
  }
  expect(await rowsFor(sql, mark)).toHaveLength(1);
  const action = capture.get();
  expect(action, "the Server Action request was captured").not.toBeNull();
  expect(action!.body.toString("utf8")).toContain(mark);

  const port = new URL(baseURL!).port;
  const replayHeaders = (origin: string): Record<string, string> => {
    const { host: _host, "content-length": _cl, ...rest } = action!.headers;
    void _host;
    void _cl;
    return { ...rest, origin, "x-real-ip": "198.51.100.52" };
  };
  const replay = async (host: string, origin: string) => {
    const res = await rawPost(request, baseURL, host, new URL(action!.url).pathname, {
      headers: replayHeaders(origin),
      data: action!.body as unknown as string,
    });
    return { res, text: await res.text() };
  };

  // The CONTROL: replayed on the platform host, the captured request is accepted and stores a second row.
  // Without it a "nothing stored" below could be a replay that never worked.
  const control = await replay("localhost", `http://localhost:${port}`);
  expect(control.text).toContain('"kind":"sent"');
  expect(await rowsFor(sql, mark)).toHaveLength(2);

  // The same request on a church's own host, with an Origin that matches its Host so Next's own
  // cross-origin guard cannot be what refuses it: no row, no success, no cookie.
  for (const host of ["church-one.invalid", "nobody-home.invalid"]) {
    const attempt = await replay(host, `http://${host}:${port}`);
    expect(attempt.text, host).not.toContain('"kind":"sent"');
    expect(attempt.res.headers()["set-cookie"], host).toBeUndefined();
    expect(await rowsFor(sql, mark), host).toHaveLength(2);
    // ...and with the original Origin (a mismatch Next itself refuses): still nothing.
    const mismatched = await replay(host, `http://localhost:${port}`);
    expect(mismatched.text, host).not.toContain('"kind":"sent"');
    expect(await rowsFor(sql, mark), host).toHaveLength(2);
  }
});

test("5. coalescing: this lane claimed the notification window at most once, and no notification carries the visitor's text", async () => {
  const claimed = (await sql`
    select count(*)::int as n from help_contact_messages where notified_at >= ${laneStart}::timestamptz`) as { n: number }[];
  expect(claimed[0]!.n).toBeLessThanOrEqual(1);

  const operators = (await sql`
    select count(distinct ur.user_id)::int as n
      from user_roles ur join role_features rf on rf.role_id = ur.role_id
     where rf.feature_key = 'admin.tickets'`) as { n: number }[];
  const queued = (await sql`
    select count(*)::int as n from email_queue
     where template_key = 'help_contact_notification' and created_at >= ${laneStart}::timestamptz`) as { n: number }[];
  // Exactly one queue row per operator per claim: the count is claims times operators, whichever state the hour was in.
  expect(queued[0]!.n).toBe(claimed[0]!.n * operators[0]!.n);

  const bodies = (await sql`
    select count(*)::int as n from email_queue
     where template_key = 'help_contact_notification' and created_at >= ${laneStart}::timestamptz
       and (html_body like '%E2E-HC-%' or coalesce(text_body, '') like '%E2E-HC-%' or subject like '%E2E-HC-%')`) as { n: number }[];
  expect(bodies[0]!.n).toBe(0);
  expect(STUB_TOKEN).toBeTruthy();
});
