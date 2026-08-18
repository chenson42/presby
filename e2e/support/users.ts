/**
 * users.ts — the e2e fixture roster.
 *
 * These users are TEST DATA and the suite owns them: `globalSetup` provisions
 * them into the database on every run (see seed-users.ts). They are deliberately
 * hardcoded rather than read from environment variables, because the previous
 * env-driven arrangement had a failure mode worse than any inconvenience it
 * avoided — when the variables were unset, every authenticated spec called
 * `test.skip()` and Playwright exited 0. The suite reported success having run
 * 6 of 48 specs. See docs/work-log/2026-08-18-e2e-owns-its-users.md.
 *
 * The password below is not a secret. It provisions throwaway accounts on
 * `example.invalid` (a reserved TLD that can never resolve), and seed-users.ts
 * refuses to write any user whose email does not end in that domain — so this
 * code cannot touch a real account even if pointed at the wrong database.
 *
 * Roles and features are NOT owned here. They are application catalog data and
 * come from `npm run db:seed`; the seeder only binds these users to them.
 */

import path from "node:path";

export type E2ERole = "admin" | "member" | "mfa-admin";

export interface E2EUser {
  /** Fixture key — also the storageState filename. */
  role: E2ERole;
  email: string;
  password: string;
  name: string;
  /** Role name in the `roles` table, or null to bind nothing. */
  roleName: "admin" | "member" | null;
  /**
   * Seeded value of users.two_factor_required. The mfa-admin fixture is the
   * only one that carries `true`, and it is intentionally left WITHOUT a TOTP
   * enrolment so the redirect-to-enrol gate is what the specs observe.
   */
  twoFactorRequired: boolean;
}

const FIXTURE_PASSWORD = "e2e-fixture-only-not-a-secret";

export const E2E_USERS: Record<E2ERole, E2EUser> = {
  admin: {
    role: "admin",
    email: "e2e-admin@example.invalid",
    password: FIXTURE_PASSWORD,
    name: "E2E Admin",
    roleName: "admin",
    twoFactorRequired: false,
  },
  member: {
    role: "member",
    email: "e2e-member@example.invalid",
    password: FIXTURE_PASSWORD,
    name: "E2E Member",
    roleName: "member",
    twoFactorRequired: false,
  },
  "mfa-admin": {
    role: "mfa-admin",
    email: "e2e-mfa-admin@example.invalid",
    password: FIXTURE_PASSWORD,
    name: "E2E MFA Admin",
    roleName: "admin",
    twoFactorRequired: true,
  },
};

export const E2E_USER_LIST: E2EUser[] = Object.values(E2E_USERS);

/** Every fixture email — used by the pre-run cleanup sweep. */
export const E2E_EMAILS: string[] = E2E_USER_LIST.map((u) => u.email);

/**
 * Path to a role's cached storageState. `globalSetup` writes these; specs read
 * them via `test.use({ storageState: storageStatePath("admin") })`.
 */
export function storageStatePath(role: E2ERole): string {
  return path.resolve(__dirname, ".auth", `${role}.json`);
}
