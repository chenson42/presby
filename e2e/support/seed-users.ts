/**
 * seed-users.ts — provisions the e2e fixture roster into the database.
 *
 * Called by globalSetup before any sign-in. Idempotent: safe to run against a
 * database that already has the fixtures, and safe to run repeatedly.
 *
 * Raw SQL over @neondatabase/serverless rather than Drizzle, for the same reason
 * cleanupTestFeedback uses it: nothing under e2e/ should import application
 * modules. `src/lib/db/index.ts` opens a WebSocket pool and demands
 * PLATFORM_DATABASE_URL at import time — a test fixture has no business
 * triggering either.
 *
 * What this does NOT own: the role and feature catalog. Those are application
 * data from `npm run db:seed`. This seeder binds users to roles that must
 * already exist, and fails loudly if they do not — a fixture that invented its
 * own permission catalog could pass a spec against permissions that do not
 * match production.
 */

import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { E2E_USER_LIST, type E2EUser } from "./users";

/**
 * Reserved TLD (RFC 2606) — it can never resolve, so a fixture address can
 * never collide with, or send mail to, a real person.
 */
const REQUIRED_EMAIL_SUFFIX = "@example.invalid";

type Sql = ReturnType<typeof neon<false, false>>;

function assertFixtureEmail(user: E2EUser): void {
  if (!user.email.endsWith(REQUIRED_EMAIL_SUFFIX)) {
    throw new Error(
      `[seed-users] Refusing to provision "${user.email}": e2e fixture emails ` +
        `must end in ${REQUIRED_EMAIL_SUFFIX}. This guard is what makes it safe ` +
        `for the fixture password to live in the repository.`,
    );
  }
}

async function roleIdByName(sql: Sql, name: string): Promise<string> {
  const rows = (await sql`SELECT id FROM roles WHERE name = ${name}`) as {
    id: string;
  }[];
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(
      `[seed-users] Role "${name}" not found. The role/feature catalog is ` +
        `application data, not fixture data — run \`npm run db:seed\` against ` +
        `this database first.`,
    );
  }
  return id;
}

async function provision(sql: Sql, user: E2EUser): Promise<void> {
  assertFixtureEmail(user);

  const hash = await bcrypt.hash(user.password, 10);

  // Upsert on the unique email. failed_login_attempts / locked_until are reset
  // deliberately: a spec that exercised the lockout path last run would
  // otherwise leave this account locked and poison the next run's sign-in with
  // a misleading "invalid credentials" error.
  const rows = (await sql`
    INSERT INTO users (email, name, password, email_verified, is_active, two_factor_required)
    VALUES (
      ${user.email},
      ${user.name},
      ${hash},
      now(),
      true,
      ${user.twoFactorRequired}
    )
    ON CONFLICT (email) DO UPDATE SET
      name                  = EXCLUDED.name,
      password              = EXCLUDED.password,
      email_verified        = now(),
      is_active             = true,
      two_factor_required   = EXCLUDED.two_factor_required,
      failed_login_attempts = 0,
      locked_until          = NULL
    RETURNING id
  `) as { id: string }[];

  const userId = rows[0]?.id;
  if (!userId) {
    throw new Error(`[seed-users] Upsert returned no id for ${user.email}`);
  }

  if (user.roleName) {
    const roleId = await roleIdByName(sql, user.roleName);
    await sql`
      INSERT INTO user_roles (user_id, role_id)
      VALUES (${userId}, ${roleId})
      ON CONFLICT DO NOTHING
    `;
  }

  // The mfa-admin fixture must stay un-enrolled: its whole purpose is to prove
  // that a user who is REQUIRED to have 2FA but has not enrolled gets sent to
  // enrolment. An enrolment left behind by a previous run would silently
  // invalidate that assertion.
  if (user.twoFactorRequired) {
    await sql`DELETE FROM user_totp WHERE user_id = ${userId}`;
    await sql`DELETE FROM user_totp_pending_enrollments WHERE user_id = ${userId}`;
  }
}

/**
 * Provision every fixture user. Throws on the first failure — a fixture that
 * cannot be created is a failed run, never a skipped one.
 */
export async function seedE2EUsers(dbUrl: string): Promise<void> {
  if (!dbUrl) {
    throw new Error(
      "[seed-users] No database URL. Set DATABASE_URL (or E2E_DATABASE_URL) " +
        "in .env.local — the e2e suite provisions its own users and cannot run " +
        "without a database.",
    );
  }

  const sql = neon(dbUrl);

  for (const user of E2E_USER_LIST) {
    await provision(sql, user);
  }

  console.log(
    `[seed-users] provisioned ${E2E_USER_LIST.length} fixture users: ` +
      E2E_USER_LIST.map((u) => u.email).join(", "),
  );
}
