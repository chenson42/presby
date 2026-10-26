/**
 * global-setup.ts — provisions the fixture users, then caches a session per role.
 *
 * Provisions the roster in e2e/support/users.ts, then acquires a session for
 * each via the NextAuth credentials API (GET /api/auth/csrf → POST
 * /api/auth/callback/credentials → GET /api/auth/session) and writes
 * storageState to e2e/support/.auth/.
 *
 * NOTHING HERE IS CONDITIONAL. This setup used to read six SEED_* environment
 * variables and log "Skipping <role>: env vars not set" when they were absent,
 * at which point every authenticated spec skipped itself and Playwright exited
 * 0 — a suite reporting success having run 6 of 48 specs. The fixture now owns
 * its users, so a failure to provision or sign in is a thrown error and a red
 * run. See docs/work-log/2026-08-18-e2e-owns-its-users.md.
 *
 * If a fixture email ever changes, delete e2e/support/.auth/ — the 12h freshness
 * check would otherwise reuse a storageState carrying the old email's JWT.
 *
 * RATE_LIMIT_DISABLED=true must be set in .env.local and in CI secrets. Without
 * it, three consecutive sign-ins can trip the in-memory limiter and this file
 * throws a misleading credentials error.
 */

import { chromium, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { E2E_EMAILS, E2E_USER_LIST } from "./users";
import { seedE2EUsers } from "./seed-users";
import { seedE2EOrgs } from "./seed-orgs";
import { withDbRetry } from "./db";
import { sweepStaleDomainsUiFixtures } from "./domains-ui-fixture";
import { sweepStaleInvitationFixtures } from "./invitation-fixture";
import { sweepStaleParishFixtures } from "./parish-fixture";

const AUTH_DIR = path.resolve(__dirname, ".auth");
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function isStorageStateFresh(filePath: string): boolean {
  try {
    return Date.now() - fs.statSync(filePath).mtimeMs < TWELVE_HOURS_MS;
  } catch {
    return false;
  }
}

function runDbIsolationGuard(): void {
  // Step A: dedicated E2E database URL — guard passes
  if (process.env.E2E_DATABASE_URL) return;

  // Step B: parse DATABASE_URL — if parsing fails, skip guard
  let hostname: string;
  try {
    hostname = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return;
  }

  // Step C: non-Neon host — guard passes
  if (!hostname.endsWith(".neon.tech")) return;

  const ACTIONABLE_MESSAGE =
    "[globalSetup] DATABASE_URL points at a Neon shared database (*.neon.tech).\n" +
    "Running e2e tests against a shared database may pollute production or staging data.\n" +
    "To fix, choose one option:\n" +
    "  A) Set E2E_DATABASE_URL to a dedicated Neon branch connection string (recommended for CI).\n" +
    "     Create a branch at console.neon.tech, copy its connection string, and add it to CI secrets.\n" +
    "  B) Set E2E_ALLOW_SHARED_DB=true to acknowledge the risk and continue.\n" +
    "     This is only appropriate if the database is disposable or isolated by other means.\n" +
    "See docs/work-log/2026-07-01-e2e-auth-infra.md for rationale (DECISION-019).";

  // Step D: user explicitly accepted shared-DB risk — guard passes
  if (process.env.E2E_ALLOW_SHARED_DB === "true") return;

  // Step E: CI — hard block
  if (process.env.CI) {
    throw new Error(ACTIONABLE_MESSAGE);
  }

  // Step F: local dev — warn and continue
  console.warn("\n" + ACTIONABLE_MESSAGE + "\n");
}

async function cleanupTestFeedback(dbUrl: string): Promise<void> {
  if (!dbUrl) return;

  try {
    const sql = neon(dbUrl);
    const deleted = await withDbRetry(
      "delete test feedback",
      () => sql`
        DELETE FROM feedback
        WHERE user_id IN (
          SELECT id FROM users WHERE email = ANY(${E2E_EMAILS})
        )
        RETURNING id
      `,
    );
    console.log(
      `[globalSetup] cleanup: deleted ${deleted.length} test feedback rows`
    );
  } catch (err) {
    console.warn(
      "[globalSetup] cleanup: failed to delete test feedback rows (continuing)",
      err
    );
  }
}

/**
 * A custom-domains UI spec's teardown can lose to a Neon connection drop and leave its congregation behind
 * (e2e/support/domains-ui-fixture.ts). That org holds a membership for the `mfa-enrolled` user, so the NEXT
 * run's post-login landing for that user is `/home` rather than `/admin`, and the TOTP specs time out
 * waiting for the wrong page (Phase 5 QA run 1, custom-domains). Sweep any such leftover before a session is
 * acquired. A sweep failure is a thrown error, not a warning: running on past it reproduces the cascade.
 */
async function sweepStaleDomainsUiFixtureOrgs(platformDbUrl: string): Promise<void> {
  if (!platformDbUrl) return; // seedE2EOrgs above has already thrown if the owner URL is missing where it matters
  const removed = await sweepStaleDomainsUiFixtures(neon(platformDbUrl));
  if (removed > 0) console.warn(`[globalSetup] swept ${removed} stale e2e-domui-* organization(s) left by an earlier run`);
}

/**
 * The invitation specs (e2e/invitation-*.spec.ts, admin-organizations.spec.ts Tests 7-8) build a throwaway
 * congregation and accept invitations into it. An acceptance addressed to a permanent fixture user
 * (`mfa-enrolled`) gives that user a membership there; if teardown lost to a Neon connection drop, the user's
 * post-login landing would change from `/admin` to `/o/<slug>` or `/home` for every later spec. Sweep any such
 * leftover (and its throwaway users) before a session is acquired, exactly as the custom-domains UI fixture does.
 */
async function sweepStaleInvitationFixtureOrgs(platformDbUrl: string): Promise<void> {
  if (!platformDbUrl) return;
  const removed = await sweepStaleInvitationFixtures(neon(platformDbUrl));
  if (removed > 0) console.warn(`[globalSetup] swept ${removed} stale e2e-invite-* organization(s) left by an earlier run`);
}

/**
 * The parish-management specs (e2e/parishes.spec.ts, e2e/hydration/parishes-controls.spec.ts) build a throwaway
 * congregation (`e2e-parish-*`) in which the `mfa-enrolled` user is a member. If teardown lost to a Neon connection
 * drop, that membership would change the user's post-login landing for every later spec. Sweep any leftover (and its
 * fixed-range people) before a session is acquired, exactly as the invitation and custom-domains fixtures do.
 */
async function sweepStaleParishFixtureOrgs(platformDbUrl: string): Promise<void> {
  if (!platformDbUrl) return;
  const removed = await sweepStaleParishFixtures(neon(platformDbUrl));
  if (removed > 0) console.warn(`[globalSetup] swept ${removed} stale e2e-parish-* organization(s) left by an earlier run`);
}

async function signInAndSave(
  config: FullConfig,
  email: string,
  password: string,
  filePath: string
): Promise<void> {
  const baseURL =
    config.projects[0].use.baseURL ?? "http://localhost:3000";
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();

    // Step 1: CSRF token
    const csrfRes = await context.request.get(`${baseURL}/api/auth/csrf`);
    if (!csrfRes.ok()) {
      throw new Error(
        `[globalSetup] CSRF fetch failed (HTTP ${csrfRes.status()}) for ${email}. ` +
          (process.env.PW_PROD_BUILD === "1"
            ? `Did the production server (next build && next start) come up on ${baseURL}? ` +
              `(The prod lane starts it itself: \`npm run test:e2e:prod\`)`
            : `Is the dev server running on ${baseURL}? ` +
              `(Tip: run \`npm run dev\` first, then \`npm run test:e2e\`)`)
      );
    }
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    // Step 2: Credentials POST
    // NextAuth 5 beta.31 ALWAYS returns HTTP 302, not 2xx. (DECISION-020)
    // Do NOT use callbackRes.ok() — it returns false on 302.
    // Do NOT include json=true — it has no effect in beta.31.
    // The session cookie is issued in the Set-Cookie of the 302 response.
    const callbackRes = await context.request.post(
      `${baseURL}/api/auth/callback/credentials`,
      {
        form: {
          csrfToken,
          email,
          password,
          // Cosmetic: maxRedirects: 0 means we never follow it. /launch is the
          // single post-authentication target after DECISION-034, and a
          // fixture that still says /home is the next reader's wrong mental
          // model of where sign-in lands.
          callbackUrl: `${baseURL}/launch`,
        },
        // Playwright follows redirects by default; the 302 Location points at
        // AUTH_URL which may be a different host/port. Stop at the first response.
        maxRedirects: 0,
      }
    );
    if (callbackRes.status() >= 400) {
      const body = await callbackRes.text().catch(() => "(unreadable)");
      throw new Error(
        `[globalSetup] Credentials POST returned HTTP ${callbackRes.status()} for ${email}. Body: ${body}`
      );
    }

    // Step 3: Session verification
    const sessionRes = await context.request.get(`${baseURL}/api/auth/session`);
    const session = (await sessionRes.json()) as {
      user?: {
        email: string;
        twoFactorRequired: boolean;
        twoFactorVerified: boolean;
      };
    };
    if (!session?.user?.email) {
      throw new Error(
        `[globalSetup] /api/auth/session returned no user after sign-in for ${email}. ` +
          `Session payload: ${JSON.stringify(session)}`
      );
    }
    if (session.user.email !== email) {
      throw new Error(
        `[globalSetup] Session email mismatch: expected "${email}", got "${session.user.email}". ` +
          `Session payload: ${JSON.stringify(session)}`
      );
    }

    // Save storageState (cookies + localStorage)
    await context.storageState({ path: filePath });
  } finally {
    await browser.close();
  }
}

/**
 * Credentials sign-in is limited to 5/min per ip:email (src/auth.ts). This
 * suite signs the same fixture in many more times than that, and a rate-limited
 * attempt returns null — which the UI renders as "Wrong email or password"
 * while leaving failed_login_attempts at 0. It reads exactly like a wrong
 * password, and it is not.
 *
 * `.env.local` is the one place that fixes both processes at once: Next reads it
 * for the dev server, and Playwright injects it into this one. So checking this
 * process is a good proxy for the server — with one exception, a dev server that
 * was already running before the variable was added, which is why the message
 * says to restart it.
 */
function assertRateLimiterDisabled(): void {
  if (process.env.RATE_LIMIT_DISABLED === "true") return;

  throw new Error(
    '[globalSetup] RATE_LIMIT_DISABLED is not set to "true".\n' +
      "Credentials sign-in is capped at 5/min per ip:email, and this suite\n" +
      "exceeds that for a single fixture user. A blocked attempt returns null and\n" +
      'the UI renders "Wrong email or password" while failed_login_attempts stays\n' +
      "at 0 — it reads exactly like a bad password, and it is not.\n" +
      "\n" +
      "Fix: add RATE_LIMIT_DISABLED=true to .env.local, then restart the dev\n" +
      "server so it picks the variable up. Dev/test only — never in production.",
  );
}

/**
 * The custom-domain specs (e2e/custom-domains/, Track F) drive `/api/cron/*` with a bearer to prove
 * the proxy's cron pass-through on a church's own domain, which only works if the SERVER has
 * `CRON_SECRET` set. `playwright.config.ts` sets it (and the `DOMAINS_*` test fakes) for a server it
 * starts itself, but - exactly like RATE_LIMIT_DISABLED - not for a dev server that was already
 * running and got reused. Without it a cron answers 503 ("set CRON_SECRET to enable"), the
 * pass-through never matches, and the failure reads as a proxy bug. This asks the server, with a
 * deliberately WRONG bearer so nothing runs: 401 means a secret is set, 503 means it is not.
 */
async function assertCronSecretOnServer(baseURL: string): Promise<void> {
  let status: number;
  try {
    const res = await fetch(`${baseURL}/api/cron/domains`, { headers: { authorization: "Bearer not-the-secret" } });
    status = res.status;
  } catch {
    return; // not reachable: the CSRF fetch below fails with its own, better message
  }
  if (status === 503) {
    throw new Error(
      `[globalSetup] The server at ${baseURL} has no CRON_SECRET (GET /api/cron/domains answered 503).\n` +
        "The custom-domain specs prove the cron pass-through on a church's own domain and need it, plus the\n" +
        "test-only fakes DOMAINS_ALLOW_RESERVED_TLDS=1 DOMAINS_PROVIDER=fake DOMAINS_DNS_PROVIDER=fake\n" +
        "DOMAINS_FAKE_STATE_FILE=.tmp/domains-fake-state.json. playwright.config.ts sets them for a server it\n" +
        "starts; a dev server you started yourself needs them in ITS environment (CRON_SECRET must equal the\n" +
        "value the specs use: $CRON_SECRET, default giving-e2e-cron-secret). Restart it with them set.",
    );
  }
}

/**
 * The production-build lane (PW_PROD_BUILD=1, DECISION-159) is worthless if a
 * dev server answers it: a Turbopack dev server's hydration window is far wider
 * than a real user's. playwright.config.ts already refuses E2E_BASE_URL and
 * reuseExistingServer; this is the last layer, which fingerprints what the
 * server actually returned. A dev page references the HMR client chunk
 * (`[turbopack]_browser_dev_hmr-client_...`), a production page never does and
 * always carries `/_next/static/**.js` script tags.
 */
export async function assertProductionServer(baseURL: string): Promise<void> {
  const res = await fetch(`${baseURL}/signin`);
  const html = await res.text();
  if (/hmr-client|%5Bturbopack%5D|\[turbopack\]/i.test(html)) {
    throw new Error(
      `[globalSetup] PW_PROD_BUILD=1 but the server at ${baseURL} is a DEV server (its /signin HTML references the Turbopack HMR client). ` +
        "The production lane must run against `next build && next start`; stop whatever is bound to that port.",
    );
  }
  if (!/\/_next\/static\/[^"']*\.js/.test(html)) {
    throw new Error(
      `[globalSetup] PW_PROD_BUILD=1 but the server at ${baseURL} returned no /_next/static/**.js script tags on /signin (HTTP ${res.status}); it does not look like a Next production server.`,
    );
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  // DB isolation guard runs first — before any browser launch, and before we
  // write anything. It matters more now that this setup provisions users.
  runDbIsolationGuard();
  assertRateLimiterDisabled();
  if (process.env.PW_PROD_BUILD === "1") {
    await assertProductionServer(
      config.projects[0].use.baseURL ?? "http://localhost:3800",
    );
  }

  await assertCronSecretOnServer(config.projects[0].use.baseURL ?? "http://localhost:3000");

  const dbUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  // Organizations, people and memberships need the OWNER connection: dbUrl
  // above is presby_app, which is NOBYPASSRLS and cannot write any of them.
  // See the header of seed-orgs.ts.
  const platformDbUrl =
    process.env.E2E_PLATFORM_DATABASE_URL ??
    process.env.PLATFORM_DATABASE_URL ??
    "";

  // The suite owns its users. Any failure here throws — see the file header.
  // Both re-run on every start against a populated database (idempotent by header), so a
  // dropped connection mid-seed is retried as a whole.
  await withDbRetry("seed e2e users", () => seedE2EUsers(dbUrl));
  await withDbRetry("seed e2e orgs", () => seedE2EOrgs(platformDbUrl));
  await sweepStaleDomainsUiFixtureOrgs(platformDbUrl);
  await sweepStaleInvitationFixtureOrgs(platformDbUrl);
  await sweepStaleParishFixtureOrgs(platformDbUrl);
  await cleanupTestFeedback(dbUrl);

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  for (const user of E2E_USER_LIST) {
    const filePath = path.join(AUTH_DIR, `${user.role}.json`);
    if (isStorageStateFresh(filePath)) {
      console.log(
        `[globalSetup] "${user.role}": storageState is fresh (<12h), reusing.`
      );
      continue;
    }
    console.log(
      `[globalSetup] "${user.role}": acquiring storageState for ${user.email}...`
    );
    // The mfa-admin session is intentionally NOT TOTP-verified
    // (twoFactorRequired=true, twoFactorVerified=false). Use it ONLY to assert
    // the /totp redirect gate fires — never for /admin page content or admin
    // server actions.
    await signInAndSave(config, user.email, user.password, filePath);
    console.log(`[globalSetup] "${user.role}": saved to ${filePath}`);
  }
}
