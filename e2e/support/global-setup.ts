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
    const deleted = await sql`
      DELETE FROM feedback
      WHERE user_id IN (
        SELECT id FROM users WHERE email = ANY(${E2E_EMAILS})
      )
      RETURNING id
    `;
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
          `Is the dev server running on ${baseURL}? ` +
          `(Tip: run \`npm run dev\` first, then \`npm run test:e2e\`)`
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

export default async function globalSetup(config: FullConfig): Promise<void> {
  // DB isolation guard runs first — before any browser launch, and before we
  // write anything. It matters more now that this setup provisions users.
  runDbIsolationGuard();
  assertRateLimiterDisabled();

  const dbUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  // Organizations, people and memberships need the OWNER connection: dbUrl
  // above is presby_app, which is NOBYPASSRLS and cannot write any of them.
  // See the header of seed-orgs.ts.
  const platformDbUrl =
    process.env.E2E_PLATFORM_DATABASE_URL ??
    process.env.PLATFORM_DATABASE_URL ??
    "";

  // The suite owns its users. Any failure here throws — see the file header.
  await seedE2EUsers(dbUrl);
  await seedE2EOrgs(platformDbUrl);
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
