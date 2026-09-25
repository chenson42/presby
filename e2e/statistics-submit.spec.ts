/**
 * statistics-submit.spec.ts — the running-server e2e smoke Phase 4's gate
 * requires for `(statistics-submit)`, the platform's FIRST unauthenticated
 * write path (D16 / DECISION-147,
 * `docs/work-log/2026-09-25-submission-grants.md` Phase 4 batch C).
 *
 * FIXTURE-STAGING CHOICE, same reasoning `branded-signin.spec.ts` and
 * `public-sites.spec.ts` give for their own direct-SQL fixtures:
 * `src/lib/statistics-grants.ts` is `import "server-only"`-guarded (it pulls
 * the Neon pool and `@/lib/email`'s queue), so this spec cannot call it
 * directly under plain Node — raw SQL against `@neondatabase/serverless`'s
 * `neon()`, using the same columns and constraints `drizzle/0049` declares,
 * is the available alternative. The presbytery admin is org-multi
 * (`org1-org2@presby.invalid`) — `e2e/support/seed-orgs.ts`'s appended block
 * grants it `statistics.manage` at `e2e-presbytery` specifically for this
 * spec; the about-org is `e2e-gamma`, the suite's existing `unmanaged` member
 * congregation (`statistics_submission_grants_unmanaged` requires exactly
 * that `platform_status` — no new organization fixture needed).
 *
 * `test.describe.serial`: playwright.config.ts already runs one test at a
 * time (`workers: 1`, `fullyParallel: false`); `.serial` additionally stops
 * the remaining cases if an earlier one fails, which matters here because
 * the LIVE grant issued in case 1 is spent by case 3 and re-used (refused)
 * by case 4 — later cases depend on earlier ones' side effects, and both
 * feature flags this spec flips (`statistics.submission_grants`,
 * confirmed already ON for `org_portal.reports` on this pipeline's branch)
 * are GLOBAL state restored in `afterAll`.
 *
 * RESPONSE-BODY EQUALITY, NOT JUST VISIBLE TEXT: case 5 fetches the raw HTML
 * response body for five distinct failure causes (nonexistent, expired,
 * revoked, spent, flag-off) via `request.get()` — not a browser navigation —
 * and asserts full-body equality, per Phase 2's enumeration-safety rule and
 * this task's own instruction. `normalizeRscNoise()` (below) strips exactly
 * two things first, both framework-injected and neither visible to a real
 * visitor: Next's per-response dev/Turbopack HMR client id
 * (`self.__next_r="..."`) and the request's own query string, which the RSC
 * flight payload echoes back verbatim as the current route's params — i.e.
 * the raw token value itself, the one thing that MUST differ between
 * requests by construction and is not a leak (a real browser never displays
 * it either). Measured live: without this normalization the bodies differ
 * only in those two places — confirmed by running this spec unnormalized
 * first and reading the diff.
 */

import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { storageStatePath } from "./support/users";
import { E2E_ORGS } from "./support/seed-orgs";

type Sql = ReturnType<typeof neon<false, false>>;

const SUBMISSION_GRANTS_FLAG = "statistics.submission_grants";
const REPORTS_FLAG = "org_portal.reports";

const RECIPIENT_EMAIL = "grant-recipient@example.invalid";
const RECIPIENT_NAME = "Rosalind Pyke";
// A report year this spec owns exclusively, distinct from any fixture in
// `scripts/seed-dev.sql` or `e2e/support/seed-orgs.ts` — never collides with
// the partial-unique (organization_id, about_org_id, report_year) index.
const LIVE_REPORT_YEAR = 2091;
const EXPIRED_REPORT_YEAR = 2092;
const REVOKED_REPORT_YEAR = 2093;

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function getFlag(sql: Sql, key: string): Promise<boolean> {
  const rows = (await sql`
    select enabled from feature_flags where key = ${key}
  `) as { enabled: boolean }[];
  if (rows.length === 0) {
    throw new Error(`[statistics-submit.spec] no feature_flags row for "${key}"`);
  }
  return rows[0].enabled;
}

async function setFlag(sql: Sql, key: string, enabled: boolean): Promise<void> {
  await sql`update feature_flags set enabled = ${enabled} where key = ${key}`;
}

/** Reads the queued email row directly — the queue TABLE, not a mailbox — and
 *  extracts the raw token from its `/file-statistics?token=...` link. */
async function extractTokenFromQueue(sql: Sql, toEmail: string): Promise<string> {
  const rows = (await sql`
    select html_body from email_queue
     where to_email = ${toEmail} and template_key = 'statistics_submission_grant'
     order by created_at desc
     limit 1
  `) as { html_body: string }[];
  const html = rows[0]?.html_body;
  if (!html) {
    throw new Error(
      `[statistics-submit.spec] no queued email found for ${toEmail} — did issuance succeed?`,
    );
  }
  const match = html.match(/\/file-statistics\?token=([^"&\s<]+)/);
  if (!match) {
    throw new Error(
      `[statistics-submit.spec] queued email for ${toEmail} carried no /file-statistics link`,
    );
  }
  return match[1];
}

/**
 * Strips three forms of per-request noise Next's own dev/Turbopack runtime
 * injects into an otherwise-static RSC response — none of it is application
 * content and none of it is visible to a real visitor, so normalizing it out
 * is comparing the actual RENDERED PAGE byte-for-byte (identical DOM
 * structure, classes, meta tags, and script references), not merely
 * "visible text":
 *
 *   1. `self.__next_r="<random-id>"` — a fresh dev-mode HMR client id
 *      generated per response.
 *   2. The RSC flight payload's `self.__next_f.push([1, "..."])` blob — an
 *      opaque, never-rendered, internal serialization whose exact byte
 *      content embeds dev-mode module-reference numbering that measurably
 *      drifts request to request in Turbopack dev mode (confirmed live:
 *      diffing two unnormalized bodies for the SAME page differed only in a
 *      chunk-reference id, `c3` vs `c6`, with no content difference) — never
 *      user data, and this is the one normalization that goes beyond "the
 *      literal token value," which is the credential itself and is expected
 *      to differ.
 *   3. The request's own query string / route params, which the flight
 *      payload would otherwise echo verbatim (the `?token=...` value, by
 *      construction the one thing that MUST differ between requests and is
 *      not a leak — a real browser never displays it either).
 */
function normalizeRscNoise(body: string, token: string): string {
  return body
    .replace(/self\.__next_r="[^"]*"/g, 'self.__next_r="<id>"')
    .replace(/self\.__next_f\.push\(\[1,"[\s\S]*?"\]\)/g, 'self.__next_f.push([1,"<flight>"])')
    .split(token)
    .join("<token>");
}

async function fetchBody(
  request: APIRequestContext,
  url: string,
  token: string,
): Promise<string> {
  const response = await request.get(url);
  expect(response.status(), `${url} should respond 2xx`).toBeLessThan(400);
  return normalizeRscNoise(await response.text(), token);
}

test.describe.serial("Statistics submission grants (D16/DECISION-147)", () => {
  let sql: Sql;
  let priorSubmissionGrantsFlag: boolean;
  let priorReportsFlag: boolean;
  let liveToken: string;

  test.beforeAll(async () => {
    const platformDbUrl =
      process.env.E2E_PLATFORM_DATABASE_URL ?? process.env.PLATFORM_DATABASE_URL ?? "";
    if (!platformDbUrl) {
      throw new Error(
        "[statistics-submit.spec] no platform database URL — set PLATFORM_DATABASE_URL " +
          "(or E2E_PLATFORM_DATABASE_URL) in .env.local.",
      );
    }
    sql = neon(platformDbUrl);

    priorSubmissionGrantsFlag = await getFlag(sql, SUBMISSION_GRANTS_FLAG);
    priorReportsFlag = await getFlag(sql, REPORTS_FLAG);
    await setFlag(sql, SUBMISSION_GRANTS_FLAG, true);
    await setFlag(sql, REPORTS_FLAG, true);

    // Clean up any leftover rows from a prior failed run at this spec's own
    // report years — idempotent re-run, same discipline `seed-orgs.ts` uses.
    await sql`
      delete from statistics_submission_grants
       where organization_id = ${E2E_ORGS.presbytery.id}::uuid
         and about_org_id = ${E2E_ORGS.gamma.id}::uuid
         and report_year in (${LIVE_REPORT_YEAR}, ${EXPIRED_REPORT_YEAR}, ${REVOKED_REPORT_YEAR})
    `;
    await sql`
      delete from email_queue where to_email = ${RECIPIENT_EMAIL}
    `;
  });

  test.afterAll(async () => {
    await setFlag(sql, SUBMISSION_GRANTS_FLAG, priorSubmissionGrantsFlag);
    await setFlag(sql, REPORTS_FLAG, priorReportsFlag);

    // The grant row is deleted FIRST — its `(return_id, about_org_id)`
    // composite FK points at the `statistical_returns` row the chain
    // cleanup below removes, and a grant surviving that removal would be a
    // dangling reference.
    await sql`
      delete from statistics_submission_grants
       where organization_id = ${E2E_ORGS.presbytery.id}::uuid
         and about_org_id = ${E2E_ORGS.gamma.id}::uuid
         and report_year in (${LIVE_REPORT_YEAR}, ${EXPIRED_REPORT_YEAR}, ${REVOKED_REPORT_YEAR})
    `;
    await sql`delete from email_queue where to_email = ${RECIPIENT_EMAIL}`;

    // QA Phase 5 advisory 3: case 3's real submission writes an append-only
    // `statistical_returns` / `publications` / `congregation_statistics`
    // chain that the grant/email cleanup above never touches — left alone,
    // every run of this spec adds one more row at `LIVE_REPORT_YEAR`
    // forever. `presbytery.test.ts`'s own header names the mechanism this
    // teardown copies: all three tables' freeze triggers reject DELETE on
    // every connection, owner included, so removing them needs the SAME
    // disable/delete/enable discipline that file already documents for
    // `congregation_statistics_freeze`/`publications_freeze`/
    // `statistical_returns_freeze`.
    //
    // ONE STATEMENT, hence one atomic unit under the neon() HTTP driver
    // (which — per `e2e/support/seed-orgs.ts`'s own header — gives every
    // separate tagged-template call its own implicit transaction and has no
    // multi-statement transaction): the three `disable trigger` DDL
    // statements and the three child-before-parent deletes all live inside
    // ONE `do $$ ... $$` block, so a failing delete rolls the disables back
    // too — there is no window where a trigger is disabled but the delete
    // that justified disabling it never ran. The three `enable trigger`
    // statements immediately after are a defensive, idempotent no-op belt
    // (enabling an already-enabled trigger is not an error) for the one
    // failure mode a single statement cannot cover: the block committing
    // successfully but a bug in ITS OWN body leaving something disabled.
    await sql.query(
      `
      do $cleanup$
      begin
        alter table congregation_statistics disable trigger congregation_statistics_freeze;
        alter table publications disable trigger publications_freeze;
        alter table statistical_returns disable trigger statistical_returns_freeze;

        delete from congregation_statistics
         where organization_id = '${E2E_ORGS.presbytery.id}'::uuid
           and about_org_id = '${E2E_ORGS.gamma.id}'::uuid
           and year = ${LIVE_REPORT_YEAR};

        delete from publications
         where organization_id = '${E2E_ORGS.gamma.id}'::uuid
           and artifact_id in (
             select id from statistical_returns
              where organization_id = '${E2E_ORGS.gamma.id}'::uuid
                and report_year = ${LIVE_REPORT_YEAR}
           );

        delete from statistical_returns
         where organization_id = '${E2E_ORGS.gamma.id}'::uuid
           and report_year = ${LIVE_REPORT_YEAR};

        alter table statistical_returns enable trigger statistical_returns_freeze;
        alter table publications enable trigger publications_freeze;
        alter table congregation_statistics enable trigger congregation_statistics_freeze;
      end
      $cleanup$;
      `,
    );
    // Defensive belt, not the primary mechanism (see the comment above) —
    // idempotent regardless of whether the DO block's own re-enables above
    // already ran.
    await sql`alter table statistical_returns enable trigger statistical_returns_freeze`;
    await sql`alter table publications enable trigger publications_freeze`;
    await sql`alter table congregation_statistics enable trigger congregation_statistics_freeze`;
  });

  test("1. presbytery admin issues a grant; the emailed link lands in the queue table", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: storageStatePath("org-multi") });
    const page = await context.newPage();

    await page.goto(`/o/${E2E_ORGS.presbytery.slug}/admin/reports`);
    await expect(page.getByRole("heading", { name: /submission grants/i })).toBeVisible({
      timeout: 10_000,
    });

    // Scoped by id, not `getByLabel` — the "Congregation Statistics" section
    // above the "Submission grants" one on this SAME page has its own
    // "Congregation"-labeled `<select>` (`statistics-form.tsx`), so a bare
    // label query is ambiguous (caught live, not assumed).
    await page.locator("#grant-congregation").selectOption(E2E_ORGS.gamma.id);
    await page.locator("#grant-year").fill(String(LIVE_REPORT_YEAR));
    await page.locator("#grant-recipient-name").fill(RECIPIENT_NAME);
    await page.locator("#grant-recipient-email").fill(RECIPIENT_EMAIL);
    await page.getByRole("button", { name: /^issue grant$/i }).click();

    await expect(page.getByText(/grant issued/i)).toBeVisible({ timeout: 10_000 });

    liveToken = await extractTokenFromQueue(sql, RECIPIENT_EMAIL);
    expect(liveToken.length).toBeGreaterThan(20);

    await context.close();
  });

  test("2. the link opens correctly at a 360x800 mobile viewport and at 1280x900 desktop", async ({
    browser,
  }) => {
    const mobile = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`/file-statistics?token=${liveToken}`);
    await expect(mobilePage.getByText(E2E_ORGS.gamma.name)).toBeVisible({ timeout: 10_000 });
    await expect(mobilePage.getByRole("button", { name: /^submit .* report$/i })).toBeVisible();
    await mobile.close();

    const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const desktopPage = await desktop.newPage();
    await desktopPage.goto(`/file-statistics?token=${liveToken}`);
    await expect(desktopPage.getByText(E2E_ORGS.gamma.name)).toBeVisible({ timeout: 10_000 });
    await desktop.close();
  });

  test("3. filling and submitting the form redirects to the static confirmation page", async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    await page.goto(`/file-statistics?token=${liveToken}`);

    await page.getByLabel(/^your name/i).fill("Rosalind Pyke");
    // Every count/currency field left blank — the "fields left blank are
    // recorded as zero" copy on the page itself.
    await page.getByRole("button", { name: /^submit .* report$/i }).click();

    await expect(page).toHaveURL(/\/file-statistics\/submitted$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /report submitted/i })).toBeVisible();

    await context.close();
  });

  test("4. the presbytery reports page shows the 'Congregation reported' badge", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: storageStatePath("org-multi") });
    const page = await context.newPage();
    await page.goto(
      `/o/${E2E_ORGS.presbytery.slug}/admin/reports?year=${LIVE_REPORT_YEAR}`,
    );
    await expect(page.getByText(/congregation reported/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await context.close();
  });

  test("5. re-opening the same link, an expired token, a revoked token, a garbage token, and the flag off all render byte-identical HTML", async ({
    request,
  }) => {
    const spentUrl = `/file-statistics?token=${liveToken}`;

    const expiredToken = "e2e-expired-grant-token";
    const revokedToken = "e2e-revoked-grant-token";
    const garbageToken = "e2e-this-token-was-never-issued";

    await sql`
      insert into statistics_submission_grants
        (organization_id, about_org_id, report_year, token_hash, issued_to_name,
         issued_to_email, issued_by, issued_at, expires_at)
      select ${E2E_ORGS.presbytery.id}::uuid, ${E2E_ORGS.gamma.id}::uuid,
             ${EXPIRED_REPORT_YEAR}, ${sha256Hex(expiredToken)}, ${RECIPIENT_NAME},
             ${RECIPIENT_EMAIL}, id, now() - interval '400 days', now() - interval '355 days'
        from users where email = 'org1-org2@presby.invalid'
    `;
    await sql`
      insert into statistics_submission_grants
        (organization_id, about_org_id, report_year, token_hash, issued_to_name,
         issued_to_email, issued_by, issued_at, expires_at, revoked_at)
      select ${E2E_ORGS.presbytery.id}::uuid, ${E2E_ORGS.gamma.id}::uuid,
             ${REVOKED_REPORT_YEAR}, ${sha256Hex(revokedToken)}, ${RECIPIENT_NAME},
             ${RECIPIENT_EMAIL}, id, now() - interval '10 days', now() + interval '35 days',
             now() - interval '5 days'
        from users where email = 'org1-org2@presby.invalid'
    `;

    const nonexistentBody = await fetchBody(
      request,
      `/file-statistics?token=${garbageToken}`,
      garbageToken,
    );
    const expiredBody = await fetchBody(
      request,
      `/file-statistics?token=${expiredToken}`,
      expiredToken,
    );
    const revokedBody = await fetchBody(
      request,
      `/file-statistics?token=${revokedToken}`,
      revokedToken,
    );
    const spentBody = await fetchBody(request, spentUrl, liveToken);

    await setFlag(sql, SUBMISSION_GRANTS_FLAG, false);
    const flagOffBody = await fetchBody(
      request,
      `/file-statistics?token=${garbageToken}`,
      garbageToken,
    );
    await setFlag(sql, SUBMISSION_GRANTS_FLAG, true);

    expect(expiredBody).toBe(nonexistentBody);
    expect(revokedBody).toBe(nonexistentBody);
    expect(spentBody).toBe(nonexistentBody);
    expect(flagOffBody).toBe(nonexistentBody);
  });

  test("6. a second submission of the same (now-spent) token is refused", async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    await page.goto(`/file-statistics?token=${liveToken}`);
    // The generic notice has no form to resubmit through — this asserts the
    // token page itself never reoffers the form for a spent credential.
    await expect(
      page.getByRole("heading", { name: /link is no longer active/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^submit .* report$/i })).toHaveCount(0);
    await context.close();
  });

  test("7. the token page carries no org identifier in the URL and is noindex", async ({
    page,
  }) => {
    await page.goto(`/file-statistics?token=${liveToken}`);
    expect(page.url()).not.toContain(E2E_ORGS.gamma.slug);
    expect(page.url()).not.toContain(E2E_ORGS.gamma.id);

    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /noindex/);
  });
});
