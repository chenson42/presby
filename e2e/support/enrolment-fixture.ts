/**
 * enrolment-fixture.ts - throwaway users for the two-factor enrolment and
 * recovery-code specs (F166, F344; docs/work-log/2026-10-26-recovery-codes.md).
 *
 * The shared fixtures cannot serve here: `mfa-enrolled` must stay enrolled (a
 * spec that regenerates its codes or re-enrols it would poison every sign-in
 * that follows) and `mfa-admin` must stay unenrolled. So each spec mints its own
 * `.invalid` accounts, deletes them in afterAll, and sweeps any left by a crashed
 * run first. Raw SQL on the owner connection, per this directory's no-app-import
 * rule (seed-users.ts header). A NEW file on purpose: the shared support files
 * are not edited mid-pipeline (Workflow Rule 16).
 */
import bcrypt from "bcryptjs";
import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { withDbRetry, type Sql } from "./db";
import { seedTotpEnrollment } from "./totp-fixture";

export const ENROL_PASSWORD = "e2e-enrol-throwaway-not-a-secret"; // leak-ok: throwaway password for a `.invalid` fixture account

export interface ThrowawayUser {
  id: string;
  email: string;
}

/** Deletes throwaway users a crashed run left behind (older than an hour). */
export async function sweepStaleUsers(sql: Sql, prefix: string): Promise<void> {
  assertPrefix(prefix);
  await withDbRetry("sweep stale throwaway users", async () => {
    await sql`delete from users where email like ${`${prefix}-%@example.invalid`} and created_at < now() - interval '1 hour'`;
  });
}

function assertPrefix(prefix: string): void {
  if (!/^e2e-[a-z0-9-]+$/.test(prefix)) throw new Error(`refusing an unsafe fixture prefix: ${prefix}`);
}

export interface MakeUserOptions {
  prefix: string;
  tag: string;
  stamp: number;
  twoFactorRequired: boolean;
  /** Seeds a working TOTP enrolment (the fixed E2E_TOTP_TEST_SECRET) and one recovery code. */
  enrolled?: boolean;
  /** Binds the user to an existing role by name (for example `admin`). */
  roleName?: string;
}

export async function createThrowawayUser(sql: Sql, o: MakeUserOptions): Promise<ThrowawayUser> {
  assertPrefix(o.prefix);
  const email = `${o.prefix}-${o.stamp}-${o.tag}@example.invalid`;
  if (!new RegExp(`^${o.prefix}-\\d+-[a-z0-9]+@example\\.invalid$`).test(email)) {
    throw new Error("refusing a non-fixture address");
  }
  const hash = await bcrypt.hash(ENROL_PASSWORD, 10);
  const rows = (await withDbRetry(
    "create throwaway user",
    async () =>
      await sql`
        insert into users (email, name, password, email_verified, is_active, two_factor_required)
        values (${email}, 'Enrolment Fixture', ${hash}, now(), true, ${o.twoFactorRequired})
        returning id`,
  )) as { id: string }[];
  const id = rows[0]!.id;
  if (o.roleName) {
    await withDbRetry("bind throwaway role", async () => {
      const role = (await sql`select id from roles where name = ${o.roleName!}`) as { id: string }[];
      if (!role[0]) throw new Error(`role "${o.roleName}" not found; run npm run db:seed`);
      await sql`insert into user_roles (user_id, role_id) values (${id}::uuid, ${role[0].id}::uuid) on conflict do nothing`;
    });
  }
  if (o.enrolled) await seedTotpEnrollment(sql, id);
  return { id, email };
}

export async function deleteThrowawayUsers(sql: Sql, prefix: string, ids: string[]): Promise<void> {
  assertPrefix(prefix);
  if (ids.length === 0) return;
  await withDbRetry("delete throwaway users", async () => {
    await sql`delete from users where id = any(${ids}::uuid[]) and email like ${`${prefix}-%@example.invalid`}`;
  });
}

/**
 * Signs `email` in through the credentials API on `context` (no page involved),
 * replacing the context's session cookie with a FRESH session whose 2FA claim is
 * unverified (src/auth.ts resets it at every sign-in). That is the stale-tab
 * case: another tab of the same browser signs in again.
 */
export async function signInViaApi(context: BrowserContext, email: string, password: string): Promise<void> {
  const csrfRes = await context.request.get("/api/auth/csrf");
  expect(csrfRes.ok()).toBe(true);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const res = await context.request.post("/api/auth/callback/credentials", {
    form: { csrfToken, email, password, callbackUrl: "/launch" },
    maxRedirects: 0,
  });
  // Auth.js answers 302 (DECISION-020); anything >= 400 is a failed sign-in.
  expect(res.status()).toBeLessThan(400);
}

/** The manual key under "Can't scan? Enter manually" (in the DOM whether or not the <details> is open). */
export async function readManualKey(page: Page): Promise<string> {
  const key = ((await page.locator("details pre").textContent()) ?? "").trim();
  expect(key).toMatch(/^[A-Z2-7]{16,}$/);
  return key;
}

/** The ten codes in the recovery-code panel, as shown (XXXX-XXXX). */
export async function readPanelCodes(page: Page): Promise<string[]> {
  const codes = await page.locator("ul.font-mono li").allTextContents();
  return codes.map((c) => c.trim());
}
