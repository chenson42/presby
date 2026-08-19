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
 * the reserved `.invalid` TLD, which can never resolve, and seed-users.ts
 * refuses to write any user whose email does not end in that domain — so this
 * code cannot touch a real account even if pointed at the wrong database.
 *
 * Roles and features are NOT owned here. They are application catalog data and
 * come from `npm run db:seed`; the seeder only binds these users to them.
 */

import path from "node:path";

export type E2ERole =
  | "admin"
  | "member"
  | "mfa-admin"
  /**
   * The three organization fixtures. They carry NO platform role — that is the
   * point: the post-login router's interesting rows are about congregations,
   * not about `admin.*` features, and a fixture holding both cannot tell you
   * which predicate did the routing. Their relationships are provisioned by
   * seed-orgs.ts, which runs after this roster exists.
   */
  | "org-single"
  | "org-multi"
  | "org-unmanaged"
  | "org-ended";

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
    email: "admin@presby.invalid",
    password: FIXTURE_PASSWORD,
    name: "E2E Admin",
    roleName: "admin",
    twoFactorRequired: false,
  },
  member: {
    role: "member",
    email: "member@presby.invalid",
    password: FIXTURE_PASSWORD,
    name: "E2E Member",
    roleName: "member",
    twoFactorRequired: false,
  },
  "mfa-admin": {
    role: "mfa-admin",
    email: "admin-2fa@presby.invalid",
    password: FIXTURE_PASSWORD,
    name: "E2E MFA Admin",
    roleName: "admin",
    twoFactorRequired: true,
  },
  // Exactly one enterable organization: /launch forwards this fixture straight
  // into /o/e2e-alpha without showing the chooser.
  "org-single": {
    role: "org-single",
    email: "org1@presby.invalid",
    password: FIXTURE_PASSWORD,
    name: "E2E One Organization",
    roleName: null,
    twoFactorRequired: false,
  },
  // A congregation AND the presbytery — the ruling elder on a presbytery
  // committee, which is how PC(USA) service actually works. Two cards.
  "org-multi": {
    role: "org-multi",
    email: "org1-org2@presby.invalid",
    password: FIXTURE_PASSWORD,
    name: "E2E Two Organizations",
    roleName: null,
    twoFactorRequired: false,
  },
  // A relationship at an `unmanaged` congregation only: in the presbytery's
  // records, not a tenant, so there is no portal and no card.
  "org-unmanaged": {
    role: "org-unmanaged",
    email: "org3-unmanaged@presby.invalid",
    password: FIXTURE_PASSWORD,
    name: "E2E Unmanaged Only",
    roleName: null,
    twoFactorRequired: false,
  },
  // A relationship that ENDED. The only fixture that reaches the one screen in
  // P0 which renders a date, which is the screen a timezone bug ruins: "your
  // access ended on 31 March" must say the 31st in every timezone.
  "org-ended": {
    role: "org-ended",
    email: "org2-ended@presby.invalid",
    password: FIXTURE_PASSWORD,
    name: "E2E Ended Relationship",
    roleName: null,
    twoFactorRequired: false,
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
