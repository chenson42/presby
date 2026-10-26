/**
 * getOrCreatePendingEnrollment against the REAL database (F342).
 *
 * Bug: the helper was find-then-upsert with an unconditional `do update`, so two
 * concurrent first renders of /account/2fa each minted a secret, the last write
 * won, and one page showed a secret the database no longer held: a correct code
 * for it was refused. The contract these tests pin is "one stored secret per
 * pending enrolment, the page always shows what the database holds, a fresh row
 * is never overwritten, an expired row is replaced atomically".
 *
 * T1 and T2 are the regression tests: they fail against the find-then-upsert
 * helper (the loser returns the secret it minted, not the secret stored). The
 * exhaustion and loser-returns-winner cases that need a mocked database live in
 * totp-pending.exhaustion.test.ts.
 *
 * Harness: `credentials.test.ts`'s (hasDb skip-guard, dynamic imports in
 * beforeAll, throwaway fixture torn down in afterAll). Needs
 * AUTH_TOTP_ENCRYPTION_KEY, so run it with `npm run test:db` (dotenv .env.local,
 * serial). A missing key makes the helper throw: a loud failure, not a skip.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
);

const PARALLEL = 16;

describe.skipIf(!hasDb)(
  "getOrCreatePendingEnrollment (Postgres-backed, real dev database)",
  () => {
    let getOrCreatePendingEnrollment: typeof import("./totp-pending").getOrCreatePendingEnrollment;
    let decryptSecret: typeof import("./two-factor").decryptSecret;
    let encryptSecret: typeof import("./two-factor").encryptSecret;
    let getPlatformDb: typeof import("@/lib/db").getPlatformDb;
    let users: typeof import("@/lib/db/schema").users;
    let pending: typeof import("@/lib/db/schema").userTotpPendingEnrollments;

    const created: string[] = [];

    async function makeUser(): Promise<{ id: string; email: string }> {
      const id = randomUUID();
      const email = `totp-pending-${id}@example.invalid`;
      await getPlatformDb().insert(users).values({ id, email });
      created.push(id);
      return { id, email };
    }

    async function rowsFor(userId: string) {
      return getPlatformDb()
        .select()
        .from(pending)
        .where(eq(pending.userId, userId));
    }

    async function seedRow(
      userId: string,
      secret: string,
      expiry: "fresh" | "expired",
    ) {
      await getPlatformDb()
        .insert(pending)
        .values({
          userId,
          secretCiphertext: encryptSecret(secret),
          expiresAt:
            expiry === "fresh"
              ? sql`now() + interval '5 minutes'`
              : sql`now() - interval '1 hour'`,
        });
    }

    beforeAll(async () => {
      ({ getOrCreatePendingEnrollment } = await import("./totp-pending"));
      ({ decryptSecret, encryptSecret } = await import("./two-factor"));
      ({ getPlatformDb } = await import("@/lib/db"));
      ({ users, userTotpPendingEnrollments: pending } = await import(
        "@/lib/db/schema"
      ));
    });

    afterAll(async () => {
      // Fixture teardown only: the FK cascade removes the pending rows. The
      // application code never hard-deletes users.
      if (created.length > 0) {
        await getPlatformDb().delete(users).where(inArray(users.id, created));
      }
    });

    it("T1 concurrent first render: every caller gets the one stored secret — regression for F342 enrolment secret race", async () => {
      const u = await makeUser();
      const results = await Promise.all(
        Array.from({ length: PARALLEL }, () =>
          getOrCreatePendingEnrollment(u.id, u.email),
        ),
      );
      const secrets = new Set(results.map((r) => r.secret));
      expect(secrets.size).toBe(1);
      const rows = await rowsFor(u.id);
      expect(rows).toHaveLength(1);
      const stored = decryptSecret(rows[0]!.secretCiphertext);
      expect([...secrets][0]).toBe(stored);
      for (const r of results) expect(r.uri).toContain(stored);
    });

    it("T2 expiry race: concurrent callers replace an expired row with one new secret — regression for F342 enrolment secret race", async () => {
      const u = await makeUser();
      const oldSecret = "OLDSECRETOLDSECRETOLDSECRET234567";
      await seedRow(u.id, oldSecret, "expired");
      const results = await Promise.all(
        Array.from({ length: PARALLEL }, () =>
          getOrCreatePendingEnrollment(u.id, u.email),
        ),
      );
      const secrets = new Set(results.map((r) => r.secret));
      expect(secrets.size).toBe(1);
      expect([...secrets][0]).not.toBe(oldSecret);
      const rows = await rowsFor(u.id);
      expect(rows).toHaveLength(1);
      expect(decryptSecret(rows[0]!.secretCiphertext)).toBe([...secrets][0]);
      // The new TTL, read with the database's clock (no JS clock in the test).
      const [fresh] = await getPlatformDb()
        .select({
          ok: sql<boolean>`${pending.expiresAt} > now() + interval '9 minutes'`,
        })
        .from(pending)
        .where(eq(pending.userId, u.id));
      expect(fresh!.ok).toBe(true);
    });

    it("T3 reload within the TTL returns the same secret and rewrites nothing", async () => {
      const u = await makeUser();
      const first = await getOrCreatePendingEnrollment(u.id, u.email);
      const [before] = await rowsFor(u.id);
      const second = await getOrCreatePendingEnrollment(u.id, u.email);
      const [after] = await rowsFor(u.id);
      expect(second.secret).toBe(first.secret);
      expect(after!.secretCiphertext).toBe(before!.secretCiphertext);
      expect(after!.createdAt.getTime()).toBe(before!.createdAt.getTime());
      expect(after!.expiresAt.getTime()).toBe(before!.expiresAt.getTime());
    });

    it("T4 a fresh row survives a concurrent burst unchanged", async () => {
      const u = await makeUser();
      const known = "KNOWNSECRETKNOWNSECRETKNOWN234567";
      await seedRow(u.id, known, "fresh");
      const [before] = await rowsFor(u.id);
      const results = await Promise.all(
        Array.from({ length: PARALLEL }, () =>
          getOrCreatePendingEnrollment(u.id, u.email),
        ),
      );
      for (const r of results) expect(r.secret).toBe(known);
      const [after] = await rowsFor(u.id);
      expect(after).toEqual(before);
    });

    it("T5 after the row is deleted (admin reset, completion) the next call mints a new secret", async () => {
      const u = await makeUser();
      const first = await getOrCreatePendingEnrollment(u.id, u.email);
      await getPlatformDb().delete(pending).where(eq(pending.userId, u.id));
      const second = await getOrCreatePendingEnrollment(u.id, u.email);
      expect(second.secret).not.toBe(first.secret);
      const rows = await rowsFor(u.id);
      expect(rows).toHaveLength(1);
      expect(decryptSecret(rows[0]!.secretCiphertext)).toBe(second.secret);
    });

    it("T6 two users interleaved: one secret each, distinct, each row keyed to its own user", async () => {
      const a = await makeUser();
      const b = await makeUser();
      const calls = Array.from({ length: PARALLEL }, (_, i) =>
        getOrCreatePendingEnrollment(
          i % 2 === 0 ? a.id : b.id,
          i % 2 === 0 ? a.email : b.email,
        ).then((r) => ({ who: i % 2 === 0 ? a.id : b.id, ...r })),
      );
      const results = await Promise.all(calls);
      const secretsOf = (id: string) =>
        new Set(results.filter((r) => r.who === id).map((r) => r.secret));
      expect(secretsOf(a.id).size).toBe(1);
      expect(secretsOf(b.id).size).toBe(1);
      expect([...secretsOf(a.id)][0]).not.toBe([...secretsOf(b.id)][0]);
      for (const u of [a, b]) {
        const rows = await rowsFor(u.id);
        expect(rows).toHaveLength(1);
        expect(decryptSecret(rows[0]!.secretCiphertext)).toBe(
          [...secretsOf(u.id)][0],
        );
      }
    });

    it("T7 an undecryptable fresh row rejects and is left untouched (never re-minted over a fresh row)", async () => {
      const u = await makeUser();
      await getPlatformDb()
        .insert(pending)
        .values({
          userId: u.id,
          secretCiphertext: Buffer.alloc(64, 7).toString("base64"),
          expiresAt: sql`now() + interval '5 minutes'`,
        });
      const [before] = await rowsFor(u.id);
      await expect(
        getOrCreatePendingEnrollment(u.id, u.email),
      ).rejects.toThrow();
      const [after] = await rowsFor(u.id);
      expect(after).toEqual(before);
    });
  },
);
