/**
 * global-setup.ts — Playwright globalSetup for cached per-role storageState.
 *
 * Acquires sessions for admin, member, and mfa-admin via the NextAuth
 * credentials API (GET /api/auth/csrf → POST /api/auth/callback/credentials
 * → GET /api/auth/session), then writes storageState to e2e/support/.auth/.
 *
 * IMPORTANT: Delete e2e/support/.auth/ after changing any SEED_*_EMAIL env
 * var. The 12h TTL check skips re-acquisition for fresh files, so a stale
 * storageState carrying the old email's JWT will be reused silently. Just
 * `rm -rf e2e/support/.auth/` and re-run.
 *
 * RATE_LIMIT_DISABLED=true must be set in .env.local and in CI secrets.
 * Without it, a globalSetup retry for the same email within the in-memory
 * rate-limit window will be blocked and globalSetup will throw a misleading
 * credentials error.
 */

import { chromium, type FullConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

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
  const emails = [
    process.env.SEED_ADMIN_EMAIL,
    process.env.SEED_MEMBER_EMAIL,
    process.env.SEED_MFA_ADMIN_EMAIL,
  ].filter((e): e is string => typeof e === "string" && e.length > 0);

  if (emails.length === 0 || !dbUrl) return;

  try {
    const sql = neon(dbUrl);
    const deleted = await sql`
      DELETE FROM feedback
      WHERE user_id IN (
        SELECT id FROM users WHERE email = ANY(${emails})
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
          callbackUrl: `${baseURL}/home`,
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

export default async function globalSetup(config: FullConfig): Promise<void> {
  // DB isolation guard runs first — before any browser launch
  runDbIsolationGuard();

  await cleanupTestFeedback(
    process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? ""
  );

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const roles = [
    {
      role: "admin",
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
    },
    {
      role: "member",
      email: process.env.SEED_MEMBER_EMAIL,
      password: process.env.SEED_MEMBER_PASSWORD,
    },
    {
      // mfa-admin storageState is intentionally NOT TOTP-verified
      // (twoFactorRequired=true, twoFactorVerified=false).
      // Use it ONLY to assert the /totp redirect gate fires.
      // Do NOT use it to test /admin page content or admin server actions.
      role: "mfa-admin",
      email: process.env.SEED_MFA_ADMIN_EMAIL,
      password: process.env.SEED_MFA_ADMIN_PASSWORD,
    },
  ];

  for (const { role, email, password } of roles) {
    if (!email || !password) {
      console.warn(`[globalSetup] Skipping "${role}": env vars not set.`);
      continue;
    }
    const filePath = path.join(AUTH_DIR, `${role}.json`);
    if (isStorageStateFresh(filePath)) {
      console.log(
        `[globalSetup] "${role}": storageState is fresh (<12h), skipping sign-in.`
      );
      continue;
    }
    console.log(
      `[globalSetup] "${role}": acquiring storageState for ${email}...`
    );
    await signInAndSave(config, email, password, filePath);
    console.log(`[globalSetup] "${role}": saved to ${filePath}`);
  }
}
