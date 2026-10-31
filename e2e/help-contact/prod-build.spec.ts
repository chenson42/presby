/**
 * CA13, the named proof, on `next build && next start` (`npm run test:e2e:contact:prod`; the
 * `contact-prod` project): a Server Action inside a `dynamic = "error"` segment CAN call `headers()`
 * and `after()` at request time (docs/work-log/2026-10-31-help-contact.md, Phase 2 CA13, Phase 3 Edge
 * Case 1). Not provable from source, so it is proven here, against a production build.
 *
 * FAILURE IS A LOOP-BACK TO PHASE 2. The segment is never switched to `force-static`: that could make
 * `headers()` empty and silently remove the per-IP limit.
 *
 *   (a) the page is static: HTTP 200, no `Set-Cookie`, the form (not "unavailable"), and the cache
 *       header this build actually emits is recorded;
 *   (b) a submission through the UI stores a row and shows the success block;
 *   (c) `headers()` is non-empty inside the action: from one `x-real-ip` three messages are stored and
 *       the fourth is refused as busy, so the per-IP key was derived from the request header;
 *   (d) `after()` ran at request time: when this lane's first message claimed the notification window,
 *       its queue rows exist and each has been ATTEMPTED (`last_attempt_at` is stamped only by
 *       `attemptQueuedSend`, which only `after()` calls; the 5-minute cron is not running here).
 *       When an earlier message in the last hour already holds the window, no claim is possible and the
 *       proof is skipped with the time it becomes possible; it is never faked.
 */
import { test, expect, type Browser } from "@playwright/test";
import {
  captureServerAction,
  dbNow,
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
import { HELP_CONTACT_FORM_COPY as COPY, HELP_CONTACT_OUTCOME_COPY as OUTCOME } from "../../src/lib/help-contact/copy";

const sql = ownerSql("help-contact/prod-build.spec");
const IP = "198.51.100.7";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

let start = "";
let windowHeld: { held: boolean; until: string | null } = { held: false, until: null };
const lane: string[] = [];

test.beforeAll(async () => {
  start = await dbNow(sql);
  const [row] = (await sql`
    select (max(notified_at) > now() - interval '60 minutes') as held,
           (max(notified_at) + interval '60 minutes')::text as until
      from help_contact_messages`) as { held: boolean | null; until: string | null }[];
  windowHeld = { held: row?.held === true, until: row?.held === true ? row.until : null };
});

async function phone(browser: Browser, ip = IP) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, extraHTTPHeaders: { "x-real-ip": ip } });
  const page = await ctx.newPage();
  await stubTurnstile(page);
  return { ctx, page };
}

test("(a) the page is static: 200, no cookie, the form, and the cache header this build emits", async ({ request }) => {
  const res = await request.get("/help/contact");
  expect(res.status()).toBe(200);
  expect(res.headers()["set-cookie"]).toBeUndefined();
  const html = await res.text();
  expect(html).toContain('data-testid="contact-form"');
  expect(html).not.toContain("contact-unavailable");
  // Recorded, not pinned to a literal: a build that serves this page as a dynamic render says so here.
  console.log(`[prod-build] GET /help/contact cache-control: ${res.headers()["cache-control"] ?? "(none)"}; x-nextjs-cache: ${res.headers()["x-nextjs-cache"] ?? "(none)"}`);
  expect(res.headers()["cache-control"] ?? "").not.toMatch(/private|no-store/);
});

test("(b) a submission through the UI stores a row and shows the success block", async ({ browser }) => {
  const { ctx, page } = await phone(browser);
  const mark = marker("prod-b");
  lane.push(mark);
  try {
    expect(await submitViaUi(page, typedFor(mark))).toBe("sent");
    await expect(page.getByTestId("contact-sent")).toContainText(OUTCOME.sentHeading);
    const rows = await rowsFor(sql, mark);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "new", email: typedFor(mark).email });
  } finally {
    await ctx.close();
  }
});

test("(c) headers() is non-empty inside the action: three stored from one x-real-ip, the fourth is refused as busy", async ({ browser }) => {
  const { ctx, page } = await phone(browser);
  try {
    for (const label of ["prod-c1", "prod-c2"]) {
      const mark = marker(label);
      lane.push(mark);
      expect(await submitViaUi(page, typedFor(mark))).toBe("sent");
      expect(await rowsFor(sql, mark)).toHaveLength(1);
    }
    const refused = marker("prod-c-refused");
    expect(await submitViaUi(page, typedFor(refused))).toBe("busy");
    await expect(page.getByTestId("contact-busy")).toContainText(OUTCOME.busy);
    expect(await rowsFor(sql, refused)).toHaveLength(0);
  } finally {
    await ctx.close();
  }
  // The per-IP key was derived from x-real-ip: a different address is a different key and still gets in.
  const other = await phone(browser, "198.51.100.8");
  try {
    const mark = marker("prod-c-other");
    lane.push(mark);
    expect(await submitViaUi(other.page, typedFor(mark))).toBe("sent");
  } finally {
    await other.ctx.close();
  }
});

test("(d) after() ran at request time: the claimed window's queue rows exist and were attempted", async () => {
  test.skip(
    windowHeld.held,
    `An earlier message already holds the notification window until ${windowHeld.until} (database clock). No message in this run can claim it, so after() cannot be shown. Re-run this lane after that time, or on a fresh branch; CI's ephemeral branch always can.`,
  );
  const [claimed] = (await sql`select count(*)::int as n from help_contact_messages where notified_at >= ${start}::timestamptz`) as { n: number }[];
  expect(claimed!.n, "the first message of this lane claims the window").toBe(1);

  const [operators] = (await sql`
    select count(distinct ur.user_id)::int as n
      from user_roles ur join role_features rf on rf.role_id = ur.role_id
     where rf.feature_key = 'admin.tickets'`) as { n: number }[];
  expect(operators!.n).toBeGreaterThan(0);

  const queued = async () =>
    (await sql`
      select id, to_email, last_attempt_at, attempt_count, html_body, text_body, subject
        from email_queue
       where template_key = 'help_contact_notification' and created_at >= ${start}::timestamptz`) as {
      id: string; to_email: string; last_attempt_at: string | null; attempt_count: number; html_body: string; text_body: string | null; subject: string;
    }[];
  expect((await queued()).length).toBe(operators!.n);

  // `last_attempt_at` is written only by attemptQueuedSend, which only after() calls here: this is the proof.
  await expect.poll(async () => (await queued()).filter((r) => r.last_attempt_at !== null).length, { timeout: 30_000 }).toBe(operators!.n);
  for (const row of await queued()) {
    expect(row.attempt_count).toBeGreaterThanOrEqual(1);
    for (const mark of lane) expect(`${row.html_body}${row.text_body}${row.subject}`).not.toContain(mark);
  }
  for (const mark of lane) {
    const typed = typedFor(mark);
    const [mailed] = (await sql`select count(*)::int as n from email_queue where lower(to_email) = ${typed.email.toLowerCase()}`) as { n: number }[];
    expect(mailed!.n, "no mail to the typed address").toBe(0);
  }
});

test("(e) on a production build, is the custom-host POST refused? (the CA7 question, measured, not assumed)", async ({ browser, request, baseURL }) => {
  // The CA7 defect was measured on the production server too (form.spec.ts test 8): the forwarded action ran as a
  // platform one. DECISION-313: step 1 refuses a forwarded action, so the replay stores nothing and is not `sent`.
  const { ctx, page } = await phone(browser, "198.51.100.9");
  const capture = captureServerAction(page);
  const mark = marker("prod-custom");
  try {
    await openForm(page);
    await fillForm(page, typedFor(mark));
    await waitForToken(page);
    await page.getByRole("button", { name: COPY.button }).click();
    await expect(page.getByTestId("contact-sent")).toBeVisible({ timeout: 30_000 });
  } finally {
    await ctx.close();
  }
  const action = capture.get();
  expect(action).not.toBeNull();
  const port = new URL(baseURL!).port;
  const { host: _h, "content-length": _c, ...rest } = action!.headers;
  void _h;
  void _c;
  const host = "church-one.invalid";
  const res = await rawPost(request, baseURL, host, new URL(action!.url).pathname, {
    headers: { ...rest, origin: `http://${host}:${port}`, "x-real-ip": "198.51.100.10" },
    data: action!.body as unknown as string,
  });
  const text = await res.text();
  console.log(`[prod-build] custom-host replay: HTTP ${res.status()}, sent=${text.includes('"kind":"sent"')}, rows=${(await rowsFor(sql, mark)).length}`);
  expect(text).not.toContain('"kind":"sent"');
  expect(text).toContain('"kind":"unavailable"');
  expect(res.headers()["set-cookie"]).toBeUndefined();
  expect(await rowsFor(sql, mark)).toHaveLength(1); // only the legitimate one
});
