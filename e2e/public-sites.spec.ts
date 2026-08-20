/**
 * public-sites.spec.ts — `/site/<slug>`, the public organization website
 * render path (docs/work-log/2026-08-20-public-sites.md). Closes the second
 * of qa's two Phase 5 coverage gaps: zero e2e coverage existed for this
 * pipeline's own primary surface.
 *
 * FIXTURE-STAGING CHOICE, MADE DELIBERATELY: this spec mutates
 * `scripts/seed-dev.sql`'s Alder Creek fixture (`alder-creek`,
 * `22222222-2222-2222-2222-222222222222`) directly against the database via
 * `@neondatabase/serverless`'s `neon()`, the exact mechanism
 * `e2e/support/seed-orgs.ts` and `e2e/support/global-setup.ts` already use for
 * fixture writes that need to bypass RLS (`PLATFORM_DATABASE_URL`). Two
 * reasons this is Alder Creek and not a fresh `e2e-*` org:
 *
 *   1. `organization_sites` and `site_contact_messages` are queried only
 *      through `src/lib/sites.ts`, which is guarded by `import "server-only"`
 *      — that throws unconditionally under plain Node (the `"server-only"`
 *      package resolves to a no-op only under Next's own `react-server`
 *      module condition), so this spec cannot import the real query layer the
 *      way `src/lib/sites.test.ts` does under Vitest (which mocks the module
 *      away). Raw SQL against the same tables, using the same columns and
 *      constraints the migration declares, is the available alternative for
 *      an e2e process — the same reason `seed-orgs.ts` writes `memberships`
 *      with a raw `INSERT` rather than importing anything under `@/lib`.
 *   2. Case 6 needs a `tickets.file`-holding org member to confirm a
 *      submitted message is visible on the read side (DECISION-089), and
 *      `elder.fixture@example.invalid` — Marguerite Ashcombe, the one seeded
 *      person holding `tickets.file`, upgraded to sign-in-capable by the
 *      support-tickets pipeline specifically so a real browser session could
 *      exercise `/o/alder-creek/tickets` (docs/testing.md) — only exists at
 *      Alder Creek. Inventing a second `tickets.file` fixture at a fresh
 *      `e2e-*` org, when one sign-in-capable holder already exists and is
 *      documented for exactly this purpose, would be exactly the
 *      "don't invent a new one unless genuinely necessary" the task warned
 *      against.
 *
 * `test.describe.serial` — Playwright's own default here is already
 * `workers: 1` / `fullyParallel: false` (playwright.config.ts), so the whole
 * suite runs one test at a time regardless; `.serial` additionally stops the
 * remaining tests in this file (running `afterAll` regardless) if an earlier
 * one fails, which matters because later tests build on state earlier tests
 * stage (a live site, a submitted message) rather than being independent.
 *
 * WHY A DIRECT DB QUERY, NOT ONLY A UI CHECK, VERIFIES CASE 6'S MESSAGE
 * LANDED: the direct query is the primary, unconditional assertion. The UI
 * check (signing in as elder.fixture and reading `/o/alder-creek/tickets`)
 * is layered on top of it, not instead of it, because Alder Creek's own
 * `organization_settings.require_two_factor = true` (scripts/seed-dev.sql,
 * seeded deliberately so the isolation suite can prove the per-church 2FA
 * policy resolves at sign-in) forces this fixture through the 2FA gate even
 * though `elder.fixture`'s own `two_factor_required` column is `false` — the
 * same friction commit 3's own manual walkthrough hit and worked around by
 * temporarily disabling the `auth.require_2fa` master switch. This spec does
 * the same, narrowly scoped to the one test that needs it, restored
 * immediately afterward and confirmed by direct query in `afterAll` — never
 * left for another spec file to inherit.
 *
 * CLEANUP: every row this spec creates or mutates is reverted in `afterAll`
 * and confirmed by a direct SELECT afterward, not assumed from a successful
 * revert query — this session has hit leftover-fixture-data mistakes more
 * than once. No `organization_brands` row is created at all (case 2 only
 * requires proving real staged content renders, not brand emission, which
 * `layout.test.tsx`/commit 3's own real-browser walkthrough already cover) —
 * named here because the task's cleanup checklist mentions it and this spec
 * deliberately keeps zero surface there.
 */

import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { test, expect, type Page } from "@playwright/test";

type Sql = ReturnType<typeof neon<false, false>>;

const ALDER_CREEK_ID = "22222222-2222-2222-2222-222222222222";
const ALDER_CREEK_SLUG = "alder-creek";
const ALDER_CREEK_NAME = "Alder Creek Presbyterian Church";

// Reserved `.invalid` TLD fixture, per docs/testing.md — same shared fixture
// password every other synthetic account in this repository uses. Not
// exported from e2e/support/users.ts: elder.fixture is a
// scripts/seed-dev.sql fixture, not part of the Playwright-owned roster (see
// this file's header for why it is the right fixture to reuse rather than
// inventing a new one).
const ELDER_EMAIL = "elder.fixture@example.invalid";
const ELDER_PASSWORD = "e2e-fixture-only-not-a-secret";

// A slug that can never collide with a real seeded organization — no
// "e2e-" prefix (that namespace belongs to seed-orgs.ts's own fixtures) and
// no resemblance to a real congregation name, per CLAUDE.md -> No Real Data.
const NONEXISTENT_SLUG = "public-sites-spec-does-not-exist";

const TEST_MARKER = "E2E Public Sites Test";
const TEST_TITLE = "Alder Creek — E2E Public Sites Test Content";
const TEST_COMMIT_SHA = "e2e0000000000000000000000000000000000e2";

interface OrganizationSitesRow {
  organization_id: string;
  repo: string;
  status: string;
  last_ingested_commit_sha: string | null;
  last_ingested_at: string | null;
  content_bundle_key: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

async function getFlag(sql: Sql, key: string): Promise<boolean> {
  const rows = (await sql`
    select enabled from feature_flags where key = ${key}
  `) as { enabled: boolean }[];
  if (rows.length === 0) {
    throw new Error(`[public-sites.spec] no feature_flags row for "${key}"`);
  }
  return rows[0].enabled;
}

async function setFlag(sql: Sql, key: string, enabled: boolean): Promise<void> {
  await sql`update feature_flags set enabled = ${enabled} where key = ${key}`;
}

async function getSiteRow(sql: Sql): Promise<OrganizationSitesRow> {
  const rows = (await sql`
    select organization_id, repo, status, last_ingested_commit_sha,
           last_ingested_at, content_bundle_key, updated_by, updated_at, created_at
      from organization_sites
     where organization_id = ${ALDER_CREEK_ID}::uuid
  `) as OrganizationSitesRow[];
  const row = rows[0];
  if (!row) {
    throw new Error(
      "[public-sites.spec] no organization_sites row for Alder Creek — " +
        "scripts/seed-dev.sql's own provisioning fixture is expected to exist.",
    );
  }
  return row;
}

async function setSiteStatus(sql: Sql, status: "provisioning" | "live" | "suspended"): Promise<void> {
  await sql`
    update organization_sites
       set status = ${status}
     where organization_id = ${ALDER_CREEK_ID}::uuid
  `;
}

/** Restores every column this spec could have touched, to its captured value. */
async function restoreSiteRow(sql: Sql, original: OrganizationSitesRow): Promise<void> {
  await sql`
    update organization_sites
       set status = ${original.status},
           last_ingested_commit_sha = ${original.last_ingested_commit_sha},
           last_ingested_at = ${original.last_ingested_at},
           content_bundle_key = ${original.content_bundle_key}::uuid,
           updated_by = ${original.updated_by}::uuid,
           updated_at = ${original.updated_at}
     where organization_id = ${ALDER_CREEK_ID}::uuid
  `;
}

/**
 * Stages a real, live content bundle for Alder Creek — the same shape
 * `recordSiteIngest()` (src/lib/sites.ts) writes on a real ingest: a JSON
 * document `{schemaVersion, pages, imageKeys}` stored as a `blob_assets` row
 * (content-addressed by sha256, exactly as `getBlobStore().store()` hashes
 * it), referenced by `organization_sites.content_bundle_key`. No images —
 * `imageKeys: {}` — none of this spec's assertions need one.
 */
async function stageLiveBundle(sql: Sql): Promise<{ blobId: string }> {
  const bundle = {
    schemaVersion: 1,
    pages: [{ path: "/", frontMatter: { title: TEST_TITLE }, mdxAst: null }],
    imageKeys: {},
  };
  const bytes = Buffer.from(JSON.stringify(bundle), "utf-8");
  const bytesHex = bytes.toString("hex");
  const contentHash = createHash("sha256").update(bytes).digest("hex");

  const inserted = (await sql`
    insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
    values (${ALDER_CREEK_ID}::uuid, ${contentHash}, 'application/json', ${bytes.byteLength}, decode(${bytesHex}, 'hex'))
    returning id
  `) as { id: string }[];
  const blobId = inserted[0]?.id;
  if (!blobId) {
    throw new Error("[public-sites.spec] blob_assets insert returned no row");
  }

  await sql`
    update organization_sites
       set status = 'live',
           content_bundle_key = ${blobId}::uuid,
           last_ingested_commit_sha = ${TEST_COMMIT_SHA},
           last_ingested_at = now(),
           updated_by = null,
           updated_at = now()
     where organization_id = ${ALDER_CREEK_ID}::uuid
  `;

  return { blobId };
}

/** Signs in via the real `/signin` form — elder.fixture has no cached
 * storageState (it is not part of e2e/support/users.ts's roster), so this
 * mirrors totp-full-login.spec.ts's own real-form sign-in rather than
 * `test.use({ storageState })`. */
async function signInAsElderFixture(page: Page): Promise<void> {
  await page.goto("/signin");
  await page.locator('input[name="email"]').fill(ELDER_EMAIL);
  await page.locator('input[name="password"]').fill(ELDER_PASSWORD);
  await page.getByRole("button", { name: /sign in with email/i }).click();
}

test.describe.serial("Public organization websites — /site/[slug]", () => {
  let sql: Sql;
  let originalSiteRow: OrganizationSitesRow;
  let originalPublicRenderFlag: boolean;
  let originalTicketsFlag: boolean;
  let originalRequire2faFlag: boolean;
  let stagedBlobId: string;
  /** Captured after the real form submission in case 6, used both for the
   * elder.fixture read-side check and for targeted afterAll cleanup. */
  let submittedMessageId: string | null = null;

  const notFoundBaseline: { status: number | undefined; bodyText: string } = {
    status: undefined,
    bodyText: "",
  };

  test.beforeAll(async () => {
    const platformDbUrl =
      process.env.E2E_PLATFORM_DATABASE_URL ?? process.env.PLATFORM_DATABASE_URL ?? "";
    if (!platformDbUrl) {
      throw new Error(
        "[public-sites.spec] No platform database URL. Set PLATFORM_DATABASE_URL " +
          "(or E2E_PLATFORM_DATABASE_URL) in .env.local — this spec writes " +
          "organization_sites/blob_assets/feature_flags directly, which needs the " +
          "RLS-bypassing owner connection, same as e2e/support/seed-orgs.ts.",
      );
    }
    sql = neon(platformDbUrl);

    // Capture everything this spec could mutate, BEFORE mutating anything —
    // restored verbatim in afterAll.
    originalSiteRow = await getSiteRow(sql);
    originalPublicRenderFlag = await getFlag(sql, "sites.public_render");
    originalTicketsFlag = await getFlag(sql, "org_portal.tickets");
    originalRequire2faFlag = await getFlag(sql, "auth.require_2fa");

    // A real, live bundle — used by every case except the nonexistent-slug
    // one. sites.public_render itself is left at its captured (seeded-false)
    // value here; case 1 depends on that being the starting state.
    const { blobId } = await stageLiveBundle(sql);
    stagedBlobId = blobId;
  });

  test.afterAll(async () => {
    // Targeted delete of the message(s) this spec created, plus a
    // marker-prefixed sweep as a defense-in-depth net against a
    // partially-failed prior run leaving rows behind.
    await sql`
      delete from site_contact_messages
       where organization_id = ${ALDER_CREEK_ID}::uuid
         and name like ${TEST_MARKER + " %"}
    `;
    // MUST restore organization_sites.content_bundle_key (back to its
    // original, typically-null value) BEFORE deleting the blob_assets row it
    // points at — organization_sites_content_bundle_fk (drizzle/0020) is a
    // real foreign key, and deleting the referenced blob first is rejected
    // with "violates foreign key constraint" (caught only by actually running
    // this cleanup, not by reading the migration).
    await restoreSiteRow(sql, originalSiteRow);
    await sql`delete from blob_assets where id = ${stagedBlobId}::uuid`;
    await setFlag(sql, "sites.public_render", originalPublicRenderFlag);
    await setFlag(sql, "org_portal.tickets", originalTicketsFlag);
    await setFlag(sql, "auth.require_2fa", originalRequire2faFlag);

    // Confirmed by direct query, not assumed from the revert queries above
    // succeeding — this session's own repeated leftover-fixture-data mistake
    // is exactly what this guards against.
    const restoredSite = await getSiteRow(sql);
    expect(restoredSite.status).toBe(originalSiteRow.status);
    expect(restoredSite.content_bundle_key).toBe(originalSiteRow.content_bundle_key);
    expect(restoredSite.last_ingested_commit_sha).toBe(
      originalSiteRow.last_ingested_commit_sha,
    );

    const remainingBlob = (await sql`
      select count(*)::int as n from blob_assets where id = ${stagedBlobId}::uuid
    `) as { n: number }[];
    expect(remainingBlob[0]?.n).toBe(0);

    const remainingMessages = (await sql`
      select count(*)::int as n from site_contact_messages
       where organization_id = ${ALDER_CREEK_ID}::uuid
         and name like ${TEST_MARKER + " %"}
    `) as { n: number }[];
    expect(remainingMessages[0]?.n).toBe(0);

    const restoredFlags = {
      publicRender: await getFlag(sql, "sites.public_render"),
      tickets: await getFlag(sql, "org_portal.tickets"),
      require2fa: await getFlag(sql, "auth.require_2fa"),
    };
    expect(restoredFlags.publicRender).toBe(originalPublicRenderFlag);
    expect(restoredFlags.tickets).toBe(originalTicketsFlag);
    expect(restoredFlags.require2fa).toBe(originalRequire2faFlag);
  });

  // ---------------------------------------------------------------------
  // Case 1 — sites.public_render OFF, for an org that otherwise has a live
  // site -> 404. Confirms the render-flag kill switch, not just "an
  // unprovisioned org 404s."
  // ---------------------------------------------------------------------
  test("1. sites.public_render flag off -> 404 even though the site is live", async ({
    page,
  }) => {
    await setFlag(sql, "sites.public_render", false);

    // Sanity: the site really is 'live' underneath the flag, so a 404 here
    // can only be the flag, not an unrelated status/content gap.
    const row = await getSiteRow(sql);
    expect(row.status).toBe("live");
    expect(row.content_bundle_key).toBe(stagedBlobId);

    const response = await page.goto(`/site/${ALDER_CREEK_SLUG}`);
    expect(response?.status()).toBe(404);
  });

  // ---------------------------------------------------------------------
  // Case 2 — flag on, a genuinely live site -> 200, real staged content
  // renders (not just the status code).
  // ---------------------------------------------------------------------
  test("2. flag on + live site -> 200, and the staged content actually renders", async ({
    page,
  }) => {
    await setFlag(sql, "sites.public_render", true);

    const response = await page.goto(`/site/${ALDER_CREEK_SLUG}`);
    expect(response?.status()).toBe(200);

    // presby-site-kit's v0.0.1-stub renders frontMatter.title as an <h1> —
    // this is the real, staged bundle's own content, not a placeholder.
    await expect(
      page.getByRole("heading", { level: 1, name: TEST_TITLE }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Content coming soon.")).toBeVisible();

    // The Contact section page.tsx renders below site-kit's own output,
    // naming the organization.
    await expect(
      page.getByRole("heading", { name: `Contact ${ALDER_CREEK_NAME}` }),
    ).toBeVisible();
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Message")).toBeVisible();
  });

  // ---------------------------------------------------------------------
  // Case 3 — a nonexistent slug -> 404. Captures the baseline page for
  // cases 4/5's indistinguishability assertion.
  // ---------------------------------------------------------------------
  test("3. nonexistent slug -> 404 (captures the enumeration-safety baseline)", async ({
    page,
  }) => {
    const response = await page.goto(`/site/${NONEXISTENT_SLUG}`);
    expect(response?.status()).toBe(404);

    notFoundBaseline.status = response?.status();
    notFoundBaseline.bodyText = await page.locator("body").innerText();
    expect(notFoundBaseline.bodyText.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------
  // Case 4 — an org whose site is `provisioning` -> 404, indistinguishable
  // from case 3's nonexistent-slug response (not merely "also 404").
  // ---------------------------------------------------------------------
  test("4. status='provisioning' -> 404, byte-identical to the nonexistent-slug case", async ({
    page,
  }) => {
    await setSiteStatus(sql, "provisioning");

    const response = await page.goto(`/site/${ALDER_CREEK_SLUG}`);
    expect(response?.status()).toBe(404);
    expect(response?.status()).toBe(notFoundBaseline.status);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toBe(notFoundBaseline.bodyText);

    // Restore for the remaining cases, which need the site live again.
    await setSiteStatus(sql, "live");
  });

  // ---------------------------------------------------------------------
  // Case 5 — an org whose site is `suspended` -> 404, same
  // indistinguishability assertion as case 4.
  // ---------------------------------------------------------------------
  test("5. status='suspended' -> 404, byte-identical to the nonexistent-slug case", async ({
    page,
  }) => {
    await setSiteStatus(sql, "suspended");

    const response = await page.goto(`/site/${ALDER_CREEK_SLUG}`);
    expect(response?.status()).toBe(404);
    expect(response?.status()).toBe(notFoundBaseline.status);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toBe(notFoundBaseline.bodyText);

    // Restore for case 6/7, which submit a real ContactForm message against
    // a live site.
    await setSiteStatus(sql, "live");
  });

  // ---------------------------------------------------------------------
  // Case 6 — a real ContactForm submission round trip: submitted through the
  // real browser form, confirmed in the database directly, AND confirmed
  // visible to the tickets.file role-holder on /o/alder-creek/tickets
  // (DECISION-089).
  // ---------------------------------------------------------------------
  test("6. ContactForm submission lands in the database and is visible to the tickets.file role-holder", async ({
    page,
    browser,
  }) => {
    const contactName = `${TEST_MARKER} Contact ${Date.now()}`;
    const contactEmail = "e2e-public-sites-contact@example.invalid";
    const contactBody = "This is a real Playwright-submitted contact message.";

    await page.goto(`/site/${ALDER_CREEK_SLUG}`);
    await page.getByLabel("Name").fill(contactName);
    await page.getByLabel("Email").fill(contactEmail);
    await page.getByLabel("Message").fill(contactBody);
    await page.getByRole("button", { name: /send message/i }).click();

    await expect(page.getByRole("status")).toHaveText(
      "Thanks — your message has been sent. Someone will follow up soon.",
      { timeout: 10_000 },
    );

    // Primary verification: the row is really in the database, unconditional
    // on any UI's ability to render it.
    const rows = (await sql`
      select id, name, email, body, status
        from site_contact_messages
       where organization_id = ${ALDER_CREEK_ID}::uuid
         and name = ${contactName}
    `) as { id: string; name: string; email: string; body: string; status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(contactEmail);
    expect(rows[0].body).toBe(contactBody);
    expect(rows[0].status).toBe("new");
    submittedMessageId = rows[0].id;

    // Secondary verification: visible to whoever's supposed to see it. Alder
    // Creek's organization_settings.require_two_factor is seeded true, which
    // forces elder.fixture through the 2FA gate at sign-in even though its
    // own two_factor_required column is false (see this file's header) — the
    // master switch is disabled for exactly the duration of this one sign-in
    // and page view, restored in the finally block below (also re-confirmed
    // in afterAll). org_portal.tickets must be on for /o/<slug>/tickets to
    // render at all (TicketsFlagOff otherwise).
    await setFlag(sql, "org_portal.tickets", true);
    await setFlag(sql, "auth.require_2fa", false);

    const elderContext = await browser.newContext();
    try {
      const elderPage = await elderContext.newPage();
      await signInAsElderFixture(elderPage);
      await elderPage.waitForURL(new RegExp(`/o/${ALDER_CREEK_SLUG}`), {
        timeout: 10_000,
      });

      await elderPage.goto(`/o/${ALDER_CREEK_SLUG}/tickets`);
      await expect(
        elderPage.getByRole("heading", { name: "Site messages" }),
      ).toBeVisible({ timeout: 10_000 });

      const messageItem = elderPage.locator("li", { hasText: contactName });
      await expect(messageItem).toBeVisible();
      await expect(messageItem).toContainText(contactEmail);
      await expect(messageItem).toContainText(contactBody);
      await expect(messageItem.getByText("New", { exact: true })).toBeVisible();

      // Exercises the read side's own mutation too — mirrors
      // site-messages-list.test.tsx's optimistic-update assertion, but
      // against a real server action and a real database row.
      await messageItem.getByRole("button", { name: /mark read/i }).click();
      await expect(messageItem.getByText("New", { exact: true })).toHaveCount(
        0,
        { timeout: 10_000 },
      );

      // Confirmed by direct query, not assumed from the optimistic UI update
      // succeeding — the badge disappears client-side via local state the
      // instant the button is clicked, BEFORE `markSiteContactMessageReadAction`'s
      // own fetch to the server has necessarily resolved (`startTransition`,
      // no success toast on this path to wait on). Polled, and — real find —
      // done BEFORE closing `elderContext` in the `finally` block below:
      // closing a browser context aborts requests still in flight from its
      // pages, and this test's own first draft closed the context and then
      // queried immediately, observing "new" instead of "read" because the
      // action's own fetch had been cancelled out from under it, not because
      // the action was broken.
      await expect
        .poll(
          async () => {
            const rows = (await sql`
              select status from site_contact_messages where id = ${submittedMessageId}::uuid
            `) as { status: string }[];
            return rows[0]?.status;
          },
          { timeout: 10_000 },
        )
        .toBe("read");
    } finally {
      await elderContext.close();
      await setFlag(sql, "auth.require_2fa", originalRequire2faFlag);
      await setFlag(sql, "org_portal.tickets", originalTicketsFlag);
    }
  });

  // ---------------------------------------------------------------------
  // Case 7 — honeypot rejection. `_hp` is a real hidden form field (off-
  // screen via `absolute left-[-9999px]`, not `display:none`) — a real
  // visitor never sees it, but it has a non-zero bounding box and no
  // visibility:hidden/display:none, so Playwright's actionability checks
  // treat it as fillable, exactly the "a real browser wouldn't fill it, but
  // Playwright can" case the task asked for. This IS practically testable at
  // the e2e layer — no skip needed.
  // ---------------------------------------------------------------------
  test("7. a filled honeypot field silently rejects the submission (no message created)", async ({
    page,
  }) => {
    const honeypotName = `${TEST_MARKER} Honeypot ${Date.now()}`;

    const before = (await sql`
      select count(*)::int as n from site_contact_messages
       where organization_id = ${ALDER_CREEK_ID}::uuid
    `) as { n: number }[];

    await page.goto(`/site/${ALDER_CREEK_SLUG}`);
    await page.getByLabel("Name").fill(honeypotName);
    await page.getByLabel("Email").fill("e2e-public-sites-honeypot@example.invalid");
    await page.getByLabel("Message").fill("A bot filled every field, including the hidden one.");
    // A real visitor's browser never populates this — it is off-screen and
    // never focused by a human tab sequence. Playwright can reach it directly
    // by id, exactly the case the task named.
    await page.locator("#_hp").fill("I am a bot");
    await page.getByRole("button", { name: /send message/i }).click();

    // The action returns a FAKE ok:true for a filled honeypot — indistinguishable
    // from a real success to whatever submitted it, by design. The UI showing
    // success here is the expected, correct behavior, not a test failure.
    await expect(page.getByRole("status")).toHaveText(
      "Thanks — your message has been sent. Someone will follow up soon.",
      { timeout: 10_000 },
    );

    // The database is where the real assertion lives: no row for this name,
    // and the total count for the org is unchanged from before this submission.
    const matching = (await sql`
      select count(*)::int as n from site_contact_messages
       where organization_id = ${ALDER_CREEK_ID}::uuid
         and name = ${honeypotName}
    `) as { n: number }[];
    expect(matching[0]?.n).toBe(0);

    const after = (await sql`
      select count(*)::int as n from site_contact_messages
       where organization_id = ${ALDER_CREEK_ID}::uuid
    `) as { n: number }[];
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});
