/**
 * getOrCreatePendingEnrollment with a scripted database (F342). No DB: the
 * `@/lib/db` module is replaced by a recording builder chain, while the real
 * subject and the real `two-factor` crypto are used, so the secrets and
 * ciphertexts in play are genuine.
 *
 *   T8   every attempt loses and nothing is ever readable: the call rejects
 *        with a constant message after exactly MAX_ATTEMPTS insert attempts,
 *        and neither the rejection nor anything written to the console carries
 *        a ciphertext or a secret. It never returns a secret it minted.
 *   T9   the loser (the upsert wrote nothing) returns the WINNER's stored
 *        secret, not the one it minted. Red on the find-then-upsert helper.
 *   T9b  a row deleted between the two statements: the next attempt writes its
 *        own and returns the decrypted ciphertext read back from `returning`.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Rows = Array<{ secretCiphertext: string }>;

const script = {
  selects: [] as Rows[],
  /** "own" answers with the ciphertext the attempt just inserted (it wrote the row). */
  returnings: [] as Array<Rows | "own">,
  insertedCiphertexts: [] as string[],
  insertCalls: 0,
};

function next(queue: Rows[]): Rows {
  return queue.shift() ?? [];
}

function nextReturning(): Rows {
  const r = script.returnings.shift() ?? [];
  if (r === "own") {
    return [{ secretCiphertext: script.insertedCiphertexts.at(-1)! }];
  }
  return r;
}

vi.mock("@/lib/db", () => {
  const db = {
    // Only the pre-fix helper reads through the relational API; kept so the
    // same specs can be run against it and fail for the right reason.
    query: {
      userTotpPendingEnrollments: { findFirst: async () => undefined },
    },
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => next(script.selects) }),
      }),
    }),
    insert: () => {
      script.insertCalls++;
      return {
        values: (v: { secretCiphertext: string }) => {
          script.insertedCiphertexts.push(v.secretCiphertext);
          return {
            onConflictDoUpdate: () => ({
              returning: async () => nextReturning(),
            }),
          };
        },
      };
    },
  };
  return { db };
});

let getOrCreatePendingEnrollment: typeof import("./totp-pending").getOrCreatePendingEnrollment;
let encryptSecret: typeof import("./two-factor").encryptSecret;
let decryptSecret: typeof import("./two-factor").decryptSecret;

beforeAll(async () => {
  process.env.AUTH_TOTP_ENCRYPTION_KEY ??= Buffer.alloc(32, 3).toString("base64");
  ({ getOrCreatePendingEnrollment } = await import("./totp-pending"));
  ({ encryptSecret, decryptSecret } = await import("./two-factor"));
});

beforeEach(() => {
  script.selects = [];
  script.returnings = [];
  script.insertedCiphertexts = [];
  script.insertCalls = 0;
});

describe("getOrCreatePendingEnrollment — scripted database", () => {
  it("T8 exhaustion: constant error after 3 attempts, nothing secret leaks, no unstored secret returned", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    let thrown: unknown;
    let returned: unknown;
    try {
      returned = await getOrCreatePendingEnrollment("user-1", "a@example.invalid");
    } catch (e) {
      thrown = e;
    }
    expect(returned).toBeUndefined();
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      "Pending two-factor enrolment could not be established",
    );
    expect((thrown as Error).cause).toBeUndefined();
    expect(script.insertCalls).toBe(3);
    const everything = JSON.stringify([
      (thrown as Error).message,
      (thrown as Error).stack,
      spies.map((s) => s.mock.calls),
    ]);
    for (const ct of script.insertedCiphertexts) {
      expect(everything).not.toContain(ct);
      expect(everything).not.toContain(decryptSecret(ct));
    }
    spies.forEach((s) => s.mockRestore());
  });

  it("T9 the loser returns the winner's stored secret, not the one it minted", async () => {
    const winner = "WINNERSECRETWINNER";
    script.selects = [[], [{ secretCiphertext: encryptSecret(winner) }]];
    script.returnings = [[]];
    const r = await getOrCreatePendingEnrollment("user-1", "a@example.invalid");
    expect(r.secret).toBe(winner);
    expect(r.uri).toContain(winner);
    expect(script.insertedCiphertexts).toHaveLength(1);
    expect(decryptSecret(script.insertedCiphertexts[0]!)).not.toBe(winner);
  });

  it("T9b a row deleted between the statements: the next attempt writes and returns the stored value", async () => {
    // Attempt 1: nothing to read, the upsert wrote nothing (the winner was deleted meanwhile).
    // Attempt 2: nothing to read, the upsert writes, and `returning` gives its own row back.
    script.selects = [[], []];
    script.returnings = [[], "own"];
    const r = await getOrCreatePendingEnrollment("user-1", "a@example.invalid");
    expect(script.insertCalls).toBe(2);
    expect(r.secret).toBe(decryptSecret(script.insertedCiphertexts[1]!));
    expect(r.secret).not.toBe(decryptSecret(script.insertedCiphertexts[0]!));
  });
});
