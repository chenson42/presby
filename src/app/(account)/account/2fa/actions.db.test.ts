/**
 * The /account/2fa server actions against the REAL database (F344, F166).
 *
 * The unit suite (actions.test.ts) scripts the database to pin ordering and
 * argument shapes; this file pins the properties only Postgres can answer:
 * what is, and is not, left in `user_totp_recovery_codes` after a refusal.
 *
 * Harness: totp-pending.test.ts's (hasDb skip-guard, dynamic imports in
 * beforeAll, throwaway users torn down in afterAll). Session, cache and header
 * access are stubbed, because there is no request. Needs
 * AUTH_TOTP_ENCRYPTION_KEY: run with `npm run test:db` (serial).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { generateSync } from "otplib";

vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth, unstable_update: mockUpdate }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("no request scope in a db test");
  },
  cookies: async () => ({ set: vi.fn(), delete: vi.fn() }),
}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("2fa actions (Postgres-backed, real dev database)", () => {
  let actions: typeof import("./actions");
  let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
  let encryptSecret: typeof import("@/lib/two-factor").encryptSecret;
  let hashRecoveryCode: typeof import("@/lib/two-factor").hashRecoveryCode;
  let generateSecret: typeof import("@/lib/two-factor").generateSecret;
  let schema: typeof import("@/lib/db/schema");

  const created: string[] = [];

  async function makeUser(): Promise<{ id: string; email: string }> {
    const id = randomUUID();
    const email = `2fa-actions-${id}@example.invalid`;
    await getPlatformDb().insert(schema.users).values({ id, email });
    created.push(id);
    return { id, email };
  }

  /** An enrolled user with ten known recovery-code hashes. */
  async function enrolledUser() {
    const u = await makeUser();
    await getPlatformDb()
      .insert(schema.userTotp)
      .values({ userId: u.id, secretCiphertext: encryptSecret("SEEDEDSECRETSEEDEDSECRETSEEDED23") });
    const hashes = Array.from({ length: 10 }, (_, i) => hashRecoveryCode(`SEED-${1000 + i}`));
    await getPlatformDb()
      .insert(schema.userTotpRecoveryCodes)
      .values(hashes.map((codeHash) => ({ userId: u.id, codeHash })));
    return { ...u, hashes };
  }

  async function hashesOf(userId: string): Promise<string[]> {
    const rows = await getPlatformDb()
      .select({ h: schema.userTotpRecoveryCodes.codeHash })
      .from(schema.userTotpRecoveryCodes)
      .where(eq(schema.userTotpRecoveryCodes.userId, userId));
    return rows.map((r) => r.h).sort();
  }

  async function auditActionsOf(userId: string): Promise<string[]> {
    const rows = await getPlatformDb()
      .select({ a: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, userId));
    return rows.map((r) => r.a).sort();
  }

  function signedInAs(
    u: { id: string; email: string },
    over: { twoFactorRequired?: boolean; twoFactorVerified?: boolean },
  ) {
    mockAuth.mockResolvedValue({
      user: { id: u.id, email: u.email, twoFactorRequired: true, twoFactorVerified: false, ...over },
    });
  }

  beforeAll(async () => {
    actions = await import("./actions");
    ({ getPlatformDb } = await import("@/lib/db"));
    ({ encryptSecret, generateSecret, hashRecoveryCode } = await import("@/lib/two-factor"));
    schema = await import("@/lib/db/schema");
  });

  beforeEach(() => {
    mockAuth.mockReset();
    mockUpdate.mockReset();
    mockUpdate.mockImplementation(async () => ({ user: { twoFactorVerified: true } }));
  });

  /** A not-yet-enrolled user with a fresh pending secret; returns a correct code for it. */
  async function pendingUser() {
    const u = await makeUser();
    const secret = generateSecret();
    const ciphertext = encryptSecret(secret);
    await getPlatformDb()
      .insert(schema.userTotpPendingEnrollments)
      .values({ userId: u.id, secretCiphertext: ciphertext, expiresAt: sql`now() + interval '5 minutes'` });
    return { ...u, secret, ciphertext, code: () => generateSync({ secret }) };
  }

  async function storedSecret(userId: string): Promise<string | undefined> {
    const rows = await getPlatformDb()
      .select({ c: schema.userTotp.secretCiphertext })
      .from(schema.userTotp)
      .where(eq(schema.userTotp.userId, userId));
    return rows[0]?.c;
  }

  async function pendingRows(userId: string): Promise<number> {
    const rows = await getPlatformDb()
      .select({ id: schema.userTotpPendingEnrollments.userId })
      .from(schema.userTotpPendingEnrollments)
      .where(eq(schema.userTotpPendingEnrollments.userId, userId));
    return rows.length;
  }

  afterAll(async () => {
    // Fixture teardown only; the FK cascades remove the TOTP rows. The
    // application never hard-deletes a user.
    if (created.length > 0) {
      await getPlatformDb().delete(schema.auditEvents).where(inArray(schema.auditEvents.resourceId, created));
      await getPlatformDb().delete(schema.users).where(inArray(schema.users.id, created));
    }
  });

  it("D3 an unverified session cannot replace the recovery codes: refused, hashes byte-identical, refusal audited — regression for F344 regenerate bypass", async () => {
    const u = await enrolledUser();
    const before = await hashesOf(u.id);
    expect(before).toHaveLength(10);

    signedInAs(u, { twoFactorRequired: true, twoFactorVerified: false });
    const refused = await actions.regenerateRecoveryCodes();
    expect(refused.ok).toBe(false);
    expect(await hashesOf(u.id)).toEqual(before);
    expect(await auditActionsOf(u.id)).toEqual(["totp.recovery_codes.regenerate_refused"]);

    // Not required, still unverified: the same refusal.
    signedInAs(u, { twoFactorRequired: false, twoFactorVerified: false });
    expect((await actions.regenerateRecoveryCodes()).ok).toBe(false);
    expect(await hashesOf(u.id)).toEqual(before);
  });

  it("D3b a verified session replaces all ten hashes in one step and audits it", async () => {
    const u = await enrolledUser();
    const before = await hashesOf(u.id);

    signedInAs(u, { twoFactorVerified: true });
    const ok = await actions.regenerateRecoveryCodes();
    expect(ok.ok).toBe(true);
    const after = await hashesOf(u.id);
    expect(after).toHaveLength(10);
    expect(after.some((h) => before.includes(h))).toBe(false);
    expect(await auditActionsOf(u.id)).toEqual(["totp.recovery_codes.regenerated"]);
  });

  it("D1 two concurrent confirmations of one pending secret: exactly one wins, the secret is unchanged and the winner's ten codes are the stored ones — regression for F166 silent replacement", async () => {
    const u = await pendingUser();
    signedInAs(u, { twoFactorVerified: false });
    const code = u.code();
    const results = await Promise.all([actions.completeEnrollment({ code }), actions.completeEnrollment({ code })]);

    const wins = results.filter((r) => r.ok);
    const losses = results.filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0]!.ok === false && losses[0]!.error).toMatch(
      /already set up on this account|No setup in progress was found/,
    );

    expect(await storedSecret(u.id)).toBe(u.ciphertext);
    const winnerCodes = (wins[0]!.ok && wins[0]!.data?.recoveryCodes) || [];
    expect(winnerCodes).toHaveLength(10);
    expect(await hashesOf(u.id)).toEqual(winnerCodes.map((c) => hashRecoveryCode(c)).sort());
    expect(await pendingRows(u.id)).toBe(0);
    expect(await auditActionsOf(u.id)).toEqual(["totp.enrolled"]);
  });

  it("D2 an already-enrolled user cannot replace the secret by confirming a pending one: refused, secret and codes byte-identical, no grant, no audit — regression for F166 silent replacement", async () => {
    const u = await enrolledUser();
    const secretBefore = await storedSecret(u.id);
    const hashesBefore = await hashesOf(u.id);
    const attacker = generateSecret();
    await getPlatformDb()
      .insert(schema.userTotpPendingEnrollments)
      .values({ userId: u.id, secretCiphertext: encryptSecret(attacker), expiresAt: sql`now() + interval '5 minutes'` });

    signedInAs(u, { twoFactorVerified: false });
    const r = await actions.completeEnrollment({ code: generateSync({ secret: attacker }) });

    expect(r).toEqual({
      ok: false,
      error: "Two-factor authentication is already set up on this account, possibly in another tab. Reload this page.",
    });
    expect(await storedSecret(u.id)).toBe(secretBefore);
    expect(await hashesOf(u.id)).toEqual(hashesBefore);
    expect(await pendingRows(u.id)).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(await auditActionsOf(u.id)).toEqual([]);
  });

  it("D4 a first enrolment stores the pending secret, ten hashed codes, deletes the pending row and audits sessionVerified", async () => {
    const u = await pendingUser();
    signedInAs(u, { twoFactorVerified: false });
    const r = await actions.completeEnrollment({ code: u.code() });
    expect(r.ok).toBe(true);
    expect(r.ok && r.data?.sessionVerified).toBe(true);
    expect(await storedSecret(u.id)).toBe(u.ciphertext);
    expect(await hashesOf(u.id)).toHaveLength(10);
    expect(await pendingRows(u.id)).toBe(0);
    const audit = await getPlatformDb()
      .select({ m: schema.auditEvents.metadata })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, u.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.m).toEqual({ sessionVerified: true });
  });
});
