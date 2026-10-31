/**
 * `connectSignedInAccount` (Community Increment 2b, R41/R42, DECISION-226): the
 * audited, best-effort TypeScript caller of `presby_connect_signed_in_account`.
 * Who is eligible is SQL's and is proven in `src/lib/db/domain/connect.db.test.ts`;
 * the Postgres-backed behaviour of this wrapper (the audit row, the rollback,
 * the lock timeout) is `connect.db.test.ts` beside this file. This file pins
 * what the wrapper decides: the factor flag it passes, the audit it writes, and
 * that nothing it logs or returns can carry an address.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  insertAuditRow: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => h.transaction(fn),
  },
}));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return { ...actual, insertAuditRow: h.insertAuditRow };
});

const {
  connectSignedInAccount,
  CONNECT_OUTCOMES,
  CONNECT_AUDIT_METADATA_KEYS,
  CONNECT_AUDIT_AUTHORITY_KEYS,
} = await import("./connect");

const USER = "33333333-3333-4333-8333-333333333333";
const ORG = "44444444-4444-4444-8444-444444444444";
const PERSON = "55555555-5555-4555-8555-555555555555";
const CONTACT = "66666666-6666-4666-8666-666666666666";
const CREATED = new Date("2026-01-02T03:04:05.000Z");
const EMAIL = "connect-fixture@example.invalid";
const tx = { execute: h.execute };

const connectedRow = {
  outcome: "connected",
  organization_id: ORG,
  organization_slug: "fixture-congregation",
  person_id: PERSON,
  contact_method_id: CONTACT,
  contact_method_created_at: CREATED,
  session_seat: false,
  diaconate_seat: false,
  role_keys: [],
  permission_keys: [],
};

function queryOf(call: number) {
  return new PgDialect().sqlToQuery(h.execute.mock.calls[call]![0]);
}

/** Answer the `set local lock_timeout` call, then the definer call. */
function definerReturns(row: Record<string, unknown> | undefined) {
  h.execute.mockImplementation(async (query: unknown) => {
    const text = new PgDialect().sqlToQuery(query as never).sql;
    if (/lock_timeout/.test(text)) return { rows: [] };
    return { rows: row ? [row] : [] };
  });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.execute.mockReset();
  h.insertAuditRow.mockReset();
  h.transaction.mockReset();
  h.transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

describe("the call", () => {
  it("sets a 3 s lock timeout first, so a connect can never hold up a sign-in", async () => {
    definerReturns({ outcome: "declined" });
    await connectSignedInAccount({ userId: USER, via: "sign_in", proof: "account" });
    expect(queryOf(0).sql).toMatch(/set local lock_timeout = '3s'/);
    expect(queryOf(1).sql).toMatch(/presby_connect_signed_in_account/);
  });

  it("at sign-in the second-factor flag is ALWAYS false", async () => {
    definerReturns({ outcome: "declined" });
    await connectSignedInAccount({ userId: USER, via: "sign_in", proof: "google" });
    expect(queryOf(1).params).toEqual([USER, false]);
  });

  it("at Check again the flag is exactly the session's claim", async () => {
    definerReturns({ outcome: "declined" });
    await connectSignedInAccount({ userId: USER, via: "check_again", secondFactorVerified: true });
    expect(queryOf(1).params).toEqual([USER, true]);
    h.execute.mockClear();
    definerReturns({ outcome: "declined" });
    await connectSignedInAccount({ userId: USER, via: "check_again", secondFactorVerified: false });
    expect(queryOf(1).params).toEqual([USER, false]);
  });

  it("a non-boolean claim at Check again is false (only the boolean true counts)", async () => {
    definerReturns({ outcome: "declined" });
    await connectSignedInAccount({
      userId: USER,
      via: "check_again",
      secondFactorVerified: "true" as unknown as boolean,
    });
    expect(queryOf(1).params).toEqual([USER, false]);
  });

  it("passing a factor flag at sign-in is a compile error (the type forbids it)", () => {
    // Checked by `npm run typecheck`; at runtime the flag is ignored anyway.
    // @ts-expect-error a sign-in connect carries no second-factor flag
    const input: Parameters<typeof connectSignedInAccount>[0] = { userId: USER, via: "sign_in", proof: "account", secondFactorVerified: true };
    expect(input.via).toBe("sign_in");
  });

  it("a malformed user id reaches no database", async () => {
    await expect(connectSignedInAccount({ userId: "nope", via: "sign_in", proof: "account" })).resolves.toEqual({ kind: "error" });
    expect(h.transaction).not.toHaveBeenCalled();
  });
});

describe("the four outcomes", () => {
  it.each([
    ["declined", { kind: "declined" }],
    ["already_connected", { kind: "already_connected" }],
    ["needs_second_factor", { kind: "needs_second_factor" }],
  ] as const)("%s writes no audit row (declines write nothing)", async (outcome, expected) => {
    definerReturns({ outcome });
    await expect(connectSignedInAccount({ userId: USER, via: "check_again", secondFactorVerified: false })).resolves.toEqual(expected);
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });

  it("connected returns the organization slug and writes ONE tenant.person.sign_in_connected row in the same transaction", async () => {
    definerReturns(connectedRow);
    await expect(
      connectSignedInAccount({ userId: USER, via: "sign_in", proof: "account", actorEmail: EMAIL }),
    ).resolves.toEqual({ kind: "connected", organizationSlug: "fixture-congregation" });
    expect(h.insertAuditRow).toHaveBeenCalledTimes(1);
    const [passedTx, row] = h.insertAuditRow.mock.calls[0]!;
    expect(passedTx).toBe(tx);
    expect(row.action).toBe("tenant.person.sign_in_connected");
    expect(row.actor).toEqual({ userId: USER, email: EMAIL });
    expect(row.resourceType).toBe("person");
    expect(row.resourceId).toBe(PERSON);
  });

  it("the audit metadata is exactly the closed key list, with the authority snapshot", async () => {
    definerReturns({
      ...connectedRow,
      session_seat: true,
      diaconate_seat: false,
      role_keys: ["clerk_of_session"],
      permission_keys: ["people.manage", "officers.manage"],
    });
    await connectSignedInAccount({ userId: USER, via: "check_again", secondFactorVerified: true });
    const { metadata } = h.insertAuditRow.mock.calls[0]![1];
    expect(Object.keys(metadata).sort()).toEqual([...CONNECT_AUDIT_METADATA_KEYS].sort());
    expect(Object.keys(metadata.authority).sort()).toEqual([...CONNECT_AUDIT_AUTHORITY_KEYS].sort());
    expect(metadata).toEqual({
      organizationId: ORG,
      personId: PERSON,
      contactMethodId: CONTACT,
      contactMethodCreatedAt: CREATED.toISOString(),
      via: "check_again",
      proof: null,
      secondFactor: true,
      authority: {
        sessionSeat: true,
        diaconateSeat: false,
        roleKeys: ["clerk_of_session"],
        permissionKeys: ["people.manage", "officers.manage"],
      },
    });
  });

  it("metadata carries ids, enums, booleans and ISO dates: no address, no name, no token", async () => {
    definerReturns(connectedRow);
    await connectSignedInAccount({ userId: USER, via: "sign_in", proof: "google", actorEmail: EMAIL });
    const { metadata } = h.insertAuditRow.mock.calls[0]![1];
    expect(JSON.stringify(metadata)).not.toMatch(/@/);
    expect(metadata.via).toBe("sign_in");
    expect(metadata.proof).toBe("google");
    expect(metadata.secondFactor).toBe(false);
  });

  it("a timestamp that arrives as a string is normalised to ISO", async () => {
    definerReturns({ ...connectedRow, contact_method_created_at: "2026-01-02 03:04:05+00" });
    await connectSignedInAccount({ userId: USER, via: "sign_in", proof: "account" });
    expect(h.insertAuditRow.mock.calls[0]![1].metadata.contactMethodCreatedAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("missing arrays and non-true seats become empty lists and false", async () => {
    definerReturns({ ...connectedRow, role_keys: null, permission_keys: undefined, session_seat: "t", diaconate_seat: null });
    await connectSignedInAccount({ userId: USER, via: "sign_in", proof: "account" });
    expect(h.insertAuditRow.mock.calls[0]![1].metadata.authority).toEqual({
      sessionSeat: false,
      diaconateSeat: false,
      roleKeys: [],
      permissionKeys: [],
    });
  });

  it("a platform administrator is audited like anyone: nothing here reads a platform predicate", () => {
    const source = readFileSync(path.resolve(__dirname, "connect.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(source).not.toMatch(/is_platform_admin|isPlatformAdmin|getPlatformDb/);
  });
});

describe("failure is best effort", () => {
  it("a failed audit insert is an 'error' (the transaction rolls the link back) and logs a class only", async () => {
    definerReturns(connectedRow);
    h.insertAuditRow.mockRejectedValue(new Error(`insert failed for ${EMAIL} ${USER}`));
    await expect(
      connectSignedInAccount({ userId: USER, via: "sign_in", proof: "account", actorEmail: EMAIL }),
    ).resolves.toEqual({ kind: "error" });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toMatch(/@/);
    expect(logged).not.toContain(USER);
    expect(errorSpy).toHaveBeenCalledWith("[connect] failed", "Error");
  });

  it("a lock timeout (55P03) is an 'error' whose log carries the SQLSTATE and nothing else", async () => {
    h.execute.mockRejectedValue(Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }));
    await expect(connectSignedInAccount({ userId: USER, via: "sign_in", proof: "account" })).resolves.toEqual({ kind: "error" });
    expect(errorSpy).toHaveBeenCalledWith("[connect] failed", "Error/55P03");
  });

  it("a lock timeout wrapped by the query layer (the SQLSTATE is on the cause) still logs the SQLSTATE, and never the wrapper's message", async () => {
    const wrapped = Object.assign(new Error(`Failed query: select ... params: ${USER},${EMAIL}`), {
      name: "DrizzleQueryError",
      cause: Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }),
    });
    h.execute.mockRejectedValue(wrapped);
    await expect(connectSignedInAccount({ userId: USER, via: "sign_in", proof: "account" })).resolves.toEqual({ kind: "error" });
    expect(errorSpy).toHaveBeenCalledWith("[connect] failed", "DrizzleQueryError/55P03");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/@/);
  });

  it("an unknown outcome and an empty result are 'error', never a connect", async () => {
    definerReturns({ outcome: "linked" });
    await expect(connectSignedInAccount({ userId: USER, via: "sign_in", proof: "account" })).resolves.toEqual({ kind: "error" });
    definerReturns(undefined);
    await expect(connectSignedInAccount({ userId: USER, via: "sign_in", proof: "account" })).resolves.toEqual({ kind: "error" });
    expect(h.insertAuditRow).not.toHaveBeenCalled();
  });
});

describe("pins to the migration", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../drizzle/0065_presby_sign_in_and_connect.sql"), "utf8");
  const start = sql.indexOf("create or replace function presby_connect_signed_in_account");
  const body = sql.slice(start, sql.indexOf("revoke all on function presby_connect_signed_in_account"));

  it("CONNECT_OUTCOMES equals the literals the definer returns", () => {
    const literals = new Set([...body.matchAll(/outcome := '([a-z_]+)'/g)].map((m) => m[1]));
    expect([...literals].sort()).toEqual([...CONNECT_OUTCOMES].sort());
  });

  it("the definer returns the columns the audit row reads", () => {
    for (const column of [
      "organization_id", "organization_slug", "person_id", "contact_method_id",
      "contact_method_created_at", "session_seat", "diaconate_seat", "role_keys", "permission_keys",
    ]) {
      expect(body, column).toContain(column);
    }
  });
});
