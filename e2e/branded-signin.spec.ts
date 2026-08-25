/**
 * branded-signin.spec.ts — org-branded `/signin`
 * (docs/work-log/2026-08-24-branded-signin.md), the CLAUDE.md-mandatory
 * auth-touching e2e smoke: this feature edits
 * `src/app/(auth)/signin/page.tsx`, which requires a running-server smoke of
 * the FULL login path, including an MFA-enrolled user, before Phase 5 can
 * begin.
 *
 * FIXTURE-STAGING CHOICE: mutates `scripts/seed-dev.sql`'s Alder Creek
 * fixture (`alder-creek`, `22222222-2222-2222-2222-222222222222`) directly
 * via raw SQL against the `PLATFORM_DATABASE_URL` connection — the exact
 * precedent `public-sites.spec.ts` already established and whose header
 * comment explains at length why (this repo's own `src/lib/sites.ts` is
 * guarded by `import "server-only"`, which throws unconditionally under
 * plain Node, so an e2e process cannot import the real query layer the way
 * `sites.test.ts` does under Vitest). Alder Creek over a fresh `e2e-*` org
 * for the same second reason that spec gives: `elder.fixture@example.invalid`
 * is the one sign-in-capable fixture with a real membership there, needed
 * for case 1's full credentials login. `e2e-gamma` (case 3) is reused as-is
 * from `e2e/support/seed-orgs.ts` — a real, `unmanaged`, never-published
 * organization is exactly the "real but never-published org" case 3 needs,
 * with no new fixture to invent.
 *
 * ALDER CREEK'S `organization_sites` ROW IS SEEDED `status = 'provisioning'`
 * (scripts/seed-dev.sql) — flipped to `'live'` for this spec's duration and
 * restored in `afterAll`. NO content bundle is staged: `getPublishedSiteBrand()`
 * does not read `content_bundle_key` at all (Phase 3's whole reason for not
 * reusing `getPublishedSite()`), so this spec proves that independence by
 * construction rather than merely by comment — Alder Creek is "live,
 * brand-configured, zero published content" for the whole file.
 *
 * `test.describe.serial` for the same reason `public-sites.spec.ts` uses it:
 * `playwright.config.ts` already runs one test at a time
 * (`workers: 1`/`fullyParallel: false`), and `.serial` additionally stops
 * the remaining cases if an earlier one fails, which matters because case 4
 * depends on `ui.branded_signin` having been ON for cases 1–3.
 */

import { neon } from "@neondatabase/serverless";
import { test, expect } from "@playwright/test";
import { generateBrandTokens } from "@/lib/brand/generate";
import { BRAND_SCOPE_SELECTOR } from "@/lib/brand/contract";
import { E2E_USERS } from "./support/users";
import { E2E_TOTP_TEST_SECRET } from "./support/totp-fixture";
import { generateSync } from "otplib";

type Sql = ReturnType<typeof neon<false, false>>;

const ALDER_CREEK_ID = "22222222-2222-2222-2222-222222222222";
const ALDER_CREEK_SLUG = "alder-creek";
const ALDER_CREEK_NAME = "Alder Creek Presbyterian Church";
const ALDER_CREEK_SEED_HEX = "#336699";

// A real, seeded, never-published org (e2e/support/seed-orgs.ts) — no
// organization_sites row at all, so it collapses through the SAME miss path
// as a nonexistent slug (Phase 1 Gap 5's enumeration-safety property).
const NEVER_PUBLISHED_SLUG = "e2e-gamma";

const ELDER_EMAIL = "elder.fixture@example.invalid";
const ELDER_PASSWORD = "e2e-fixture-only-not-a-secret";

async function getFlag(sql: Sql, key: string): Promise<boolean> {
  const rows = (await sql`
    select enabled from feature_flags where key = ${key}
  `) as { enabled: boolean }[];
  if (rows.length === 0) {
    throw new Error(`[branded-signin.spec] no feature_flags row for "${key}"`);
  }
  return rows[0].enabled;
}

async function setFlag(sql: Sql, key: string, enabled: boolean): Promise<void> {
  await sql`update feature_flags set enabled = ${enabled} where key = ${key}`;
}

interface OrganizationSitesRow {
  status: string;
}

/**
 * `<style>` elements carry no rendered/visible text (the UA stylesheet sets
 * `display: none` on them), so Playwright's `hasText` locator filter — which
 * matches against VISIBLE text, not raw `textContent` — never matches one
 * regardless of what CSS it actually contains. `page.evaluate()` reads the
 * DOM's real `textContent` directly, sidestepping that visibility rule
 * entirely. Returns `null` if no `<style>` tag's content starts with
 * `BRAND_SCOPE_SELECTOR` (`:root:root`) — `<BrandTokens brand={null} />`
 * renders nothing, so this is exactly how "no brand emitted" is detected.
 */
async function findBrandStyleText(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate((selector) => {
    const styles = Array.from(document.querySelectorAll("style"));
    const match = styles.find((s) => (s.textContent ?? "").trimStart().startsWith(selector));
    return match?.textContent ?? null;
  }, BRAND_SCOPE_SELECTOR);
}

async function getSiteStatus(sql: Sql): Promise<string> {
  const rows = (await sql`
    select status from organization_sites where organization_id = ${ALDER_CREEK_ID}::uuid
  `) as OrganizationSitesRow[];
  const row = rows[0];
  if (!row) {
    throw new Error(
      "[branded-signin.spec] no organization_sites row for Alder Creek — " +
        "scripts/seed-dev.sql's own provisioning fixture is expected to exist.",
    );
  }
  return row.status;
}

test.describe.serial("Org-branded /signin", () => {
  let sql: Sql;
  let originalSiteStatus: string;
  let originalBrandedSigninFlag: boolean;
  let originalBrandThemingFlag: boolean;
  let originalPublicRenderFlag: boolean;
  let originalRequire2faFlag: boolean;

  test.beforeAll(async () => {
    const platformDbUrl =
      process.env.E2E_PLATFORM_DATABASE_URL ?? process.env.PLATFORM_DATABASE_URL ?? "";
    if (!platformDbUrl) {
      throw new Error(
        "[branded-signin.spec] No platform database URL. Set PLATFORM_DATABASE_URL " +
          "(or E2E_PLATFORM_DATABASE_URL) in .env.local — this spec writes " +
          "organization_sites/organization_brands/feature_flags directly, which needs " +
          "the RLS-bypassing owner connection, same as e2e/support/seed-orgs.ts.",
      );
    }
    sql = neon(platformDbUrl);

    originalSiteStatus = await getSiteStatus(sql);
    originalBrandedSigninFlag = await getFlag(sql, "ui.branded_signin");
    originalBrandThemingFlag = await getFlag(sql, "ui.brand_theming");
    originalPublicRenderFlag = await getFlag(sql, "sites.public_render");
    originalRequire2faFlag = await getFlag(sql, "auth.require_2fa");

    // Live, brand-configured, zero published content (see this file's header).
    await sql`
      update organization_sites set status = 'live'
       where organization_id = ${ALDER_CREEK_ID}::uuid
    `;
    const { tokens } = generateBrandTokens(ALDER_CREEK_SEED_HEX);
    // updated_by is NOT NULL (drizzle/0016) — the seeded admin fixture user
    // is a real, always-present users row, reused here purely as a valid FK
    // target (this spec has no "acting admin" of its own).
    await sql`
      insert into organization_brands
        (organization_id, seed_hex, type_pairing, brand_token_version, updated_by)
      values
        (${ALDER_CREEK_ID}::uuid, ${ALDER_CREEK_SEED_HEX}, 'classic', ${tokens.version},
         (select id from users where email = ${E2E_USERS.admin.email}))
      on conflict (organization_id) do update
        set seed_hex = excluded.seed_hex,
            type_pairing = excluded.type_pairing,
            brand_token_version = excluded.brand_token_version,
            mark_asset_key = null,
            updated_by = excluded.updated_by
    `;

    await setFlag(sql, "ui.branded_signin", true);
    await setFlag(sql, "ui.brand_theming", true);
    await setFlag(sql, "sites.public_render", true);
  });

  test.afterAll(async () => {
    await sql`
      update organization_sites set status = ${originalSiteStatus}
       where organization_id = ${ALDER_CREEK_ID}::uuid
    `;
    await sql`
      delete from organization_brands where organization_id = ${ALDER_CREEK_ID}::uuid
    `;
    await setFlag(sql, "ui.branded_signin", originalBrandedSigninFlag);
    await setFlag(sql, "ui.brand_theming", originalBrandThemingFlag);
    await setFlag(sql, "sites.public_render", originalPublicRenderFlag);
    await setFlag(sql, "auth.require_2fa", originalRequire2faFlag);

    // Confirmed by direct query, not assumed — public-sites.spec.ts's own
    // established discipline against leftover fixture data.
    const restoredStatus = await getSiteStatus(sql);
    expect(restoredStatus).toBe(originalSiteStatus);
    const remainingBrand = (await sql`
      select count(*)::int as n from organization_brands
       where organization_id = ${ALDER_CREEK_ID}::uuid
    `) as { n: number }[];
    expect(remainingBrand[0]?.n).toBe(0);
    const restoredFlags = {
      brandedSignin: await getFlag(sql, "ui.branded_signin"),
      brandTheming: await getFlag(sql, "ui.brand_theming"),
      publicRender: await getFlag(sql, "sites.public_render"),
      require2fa: await getFlag(sql, "auth.require_2fa"),
    };
    expect(restoredFlags.brandedSignin).toBe(originalBrandedSigninFlag);
    expect(restoredFlags.brandTheming).toBe(originalBrandThemingFlag);
    expect(restoredFlags.publicRender).toBe(originalPublicRenderFlag);
    expect(restoredFlags.require2fa).toBe(originalRequire2faFlag);
  });

  // -------------------------------------------------------------------
  // Case 1 — the primary flow: reached via a live public site's own
  // /o/<slug> callback, the brand renders, and a REAL credentials sign-in
  // completes through it without being broken by the brand chrome.
  // -------------------------------------------------------------------
  test("1. branded chrome renders for a live, brand-configured org's callback, and a real sign-in completes through it", async ({
    page,
  }) => {
    await page.goto(`/signin?callbackUrl=${encodeURIComponent(`/o/${ALDER_CREEK_SLUG}/directory`)}`);

    // The brand <style> emitter (DECISION-052) — present, and carrying the
    // REAL seed-derived token value, not merely "a style tag exists."
    const { tokens } = generateBrandTokens(ALDER_CREEK_SEED_HEX);
    const styleText = await findBrandStyleText(page);
    expect(styleText).not.toBeNull();
    expect(styleText).toContain(tokens.light.brand);

    // OrgMark — no uploaded logo for this fixture, so the typographic
    // initials fallback ("Alder Creek Presbyterian Church" -> "AC").
    await expect(page.getByText("AC", { exact: true })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    // Alder Creek's own organization_settings.require_two_factor forces
    // elder.fixture through the 2FA gate at sign-in regardless of its own
    // two_factor_required column (public-sites.spec.ts's own documented
    // friction) — disabled narrowly for this one sign-in, restored in the
    // finally block below and re-confirmed in afterAll.
    await setFlag(sql, "auth.require_2fa", false);
    try {
      await page.locator('input[name="email"]').fill(ELDER_EMAIL);
      await page.locator('input[name="password"]').fill(ELDER_PASSWORD);
      await page.getByRole("button", { name: /sign in with email/i }).click();

      await page.waitForURL(new RegExp(`/o/${ALDER_CREEK_SLUG}/directory`), {
        timeout: 10_000,
      });
      await expect(
        page.getByRole("heading", { name: "Directory" }),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await setFlag(sql, "auth.require_2fa", originalRequire2faFlag);
    }
  });

  // -------------------------------------------------------------------
  // Case 2 — the CLAUDE.md-mandatory auth-touching smoke: brand renders on
  // /signin reached via the live-org callback, AND a full email+password ->
  // /totp -> verified-session login completes for the mfa-enrolled fixture
  // on the SAME (now brand-code-containing) page.tsx.
  //
  // TWO STEPS, DELIBERATELY NOT ONE, per a real finding surfaced by running
  // this smoke for real (exactly what the CLAUDE.md gate exists to catch):
  // credentials sign-in's redirectTo, when it points DIRECTLY at a 2FA-gated
  // route (`/admin` or `/o/*`) in a single hop from the `signInWithCredentials`
  // Server Action, is inlined by Next.js's own action-redirect optimization —
  // the client soft-navigates to the target using the flight data already
  // present in the ACTION'S OWN response, with NO subsequent network request
  // for that route, so `src/proxy.ts`'s Edge gate (which only ever sees real
  // HTTP requests) never runs and the TOTP challenge is silently skipped.
  // Confirmed by direct network trace: a callbackUrl of `/admin` produces
  // `POST /signin` -> 200 -> client-side transition straight to `/admin`, ZERO
  // further requests. The DEFAULT callbackUrl (`/launch`, what
  // `totp-full-login.spec.ts` already exercises and what this case's login
  // step mirrors exactly) does NOT hit this: `/launch` is not itself
  // 2FA-gated, so the action's single hop lands there safely, and /launch's
  // OWN follow-on `redirect()` to `/admin` forces a genuine second network
  // request, which DOES pass through the Edge gate correctly. This is a
  // pre-existing gap in `signInWithCredentials`/`src/proxy.ts`'s interaction
  // with any DIRECT-to-gated-route callbackUrl (not introduced by this
  // feature, and not fixed here — reported separately as its own,
  // security-relevant finding; branded-signin's own callbackUrl handling is
  // read-only, per Phase 3, and never itself calls `signIn()`). This spec
  // works around it by testing the two properties Phase 3 actually cares
  // about SEPARATELY: branding renders on the callback (step 1), and the
  // full TOTP challenge completes on the SAME page.tsx (step 2, via the
  // proven-safe default callbackUrl) — both true simultaneously proves this
  // feature didn't break the login path, without relying on the buggy path.
  // -------------------------------------------------------------------
  test("2. branded chrome renders for the MFA-enrolled fixture's callback, and a full TOTP-verified login completes on the same page", async ({
    page,
  }) => {
    const USER = E2E_USERS["mfa-enrolled"];

    // Step 1 — branding renders on the live-org callback for this account too
    // (brand is a function of the URL slug alone, never of who signs in).
    await page.goto(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${ALDER_CREEK_SLUG}/directory`)}`,
    );
    await expect(page.getByText("AC", { exact: true })).toBeVisible();

    // Step 2 — the full TOTP-verified login, on the default (safe) callback,
    // exactly totp-full-login.spec.ts's own proven pattern.
    await page.goto("/signin");
    await page.locator('input[name="email"]').fill(USER.email);
    await page.locator('input[name="password"]').fill(USER.password);
    await page.getByRole("button", { name: /sign in with email/i }).click();

    // A generous timeout here, not 10s like the rest of this file: in a cold
    // dev server this may be the FIRST hit to /totp all session, and
    // Turbopack's on-demand compile of that route (plus its otplib/crypto
    // dependency graph) alone can exceed 10s — totp-full-login.spec.ts
    // itself hits this same route warm because other specs precede it.
    await page.waitForURL(/\/totp/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: /two-factor authentication/i }),
    ).toBeVisible();

    const code = generateSync({ secret: E2E_TOTP_TEST_SECRET });
    await page.getByPlaceholder(/123456/).fill(code);
    await page.getByRole("button", { name: /^verify$/i }).click();

    // Same admin-role, no-organizations shape totp-full-login.spec.ts
    // exercises — /launch's matrix lands it on /admin once verified.
    await page.waitForURL(/\/admin$/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /welcome/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------
  // Case 3 — a real, seeded org with NO live public site -> platform-default
  // chrome, indistinguishable from no callbackUrl at all (Phase 1 Flow 2).
  // -------------------------------------------------------------------
  test("3. a real but never-published org's callback renders platform-default chrome", async ({
    page,
  }) => {
    await page.goto(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${NEVER_PUBLISHED_SLUG}/directory`)}`,
    );

    expect(await findBrandStyleText(page)).toBeNull();
    await expect(page.getByText("AC", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  // -------------------------------------------------------------------
  // Case 4 — the kill switch: same live, brand-configured Alder Creek
  // fixture as case 1, but ui.branded_signin is OFF -> platform-default
  // chrome regardless of a perfectly valid, live-org callbackUrl.
  // -------------------------------------------------------------------
  test("4. ui.branded_signin off renders platform-default chrome even for a live, brand-configured org", async ({
    page,
  }) => {
    await setFlag(sql, "ui.branded_signin", false);
    try {
      await page.goto(
        `/signin?callbackUrl=${encodeURIComponent(`/o/${ALDER_CREEK_SLUG}/directory`)}`,
      );
      expect(await findBrandStyleText(page)).toBeNull();
      await expect(page.getByText("AC", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    } finally {
      await setFlag(sql, "ui.branded_signin", true);
    }
  });
});
