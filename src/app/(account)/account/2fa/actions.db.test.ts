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
import { eq, inArray } from "drizzle-orm";

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
    ({ encryptSecret, hashRecoveryCode } = await import("@/lib/two-factor"));
    schema = await import("@/lib/db/schema");
  });

  beforeEach(() => {
    mockAuth.mockReset();
    mockUpdate.mockReset();
  });

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
});
