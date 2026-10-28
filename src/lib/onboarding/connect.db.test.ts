/**
 * `connectSignedInAccount` on a REAL Postgres connection, through the
 * presby_app `db` exactly as `src/auth.ts` runs it at sign-in (Community
 * Increment 2b, Batch B1, T-9; R41/R42, edge cases E-10, E-11, E-14, E-29).
 * The SQL decisions (who is eligible) are proven in
 * `src/lib/db/domain/connect.db.test.ts`; this file proves what connect.ts
 * adds on top:
 *
 *   - RULE 7: a connect writes exactly one tenant.person.sign_in_connected
 *     row, in the connecting transaction, from the closed key list, carrying
 *     the authority snapshot and the join key (contactMethodCreatedAt) to the
 *     row that put the address on the record, and no address;
 *   - a FAILED audit insert leaves no link (the transaction rolls back);
 *   - declines, needs-second-factor and already-connected write no row;
 *   - a second connect (two tabs, a double submit) is already_connected with
 *     still exactly one audit row (E-14);
 *   - a lock timeout is an `error` that returns within seconds, writes
 *     nothing, and logs a class only (E-11).
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/onboarding/connect.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Row, SignInFixture } from "@/lib/testing/sign-in-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const auditControl = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/audit-tx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit-tx")>();
  return {
    ...actual,
    insertAuditRow: async (...args: Parameters<typeof actual.insertAuditRow>) => {
      if (auditControl.fail) throw new Error("audit insert failed (test-injected)");
      return actual.insertAuditRow(...args);
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

describe.skipIf(!hasDb)("src/lib/onboarding/connect.ts (Postgres-backed)", () => {
  let f: SignInFixture;
  let org: string;
  let connect: typeof import("./connect");
  let errorSpy: ReturnType<typeof vi.spyOn>;

  async function pair(options: Parameters<SignInFixture["person"]>[1] = {}, userOptions: Parameters<SignInFixture["user"]>[1] = {}) {
    const p = await f.person(org, options);
    const userId = await f.user(p.email!, userOptions);
    return { personId: p.id, email: p.email!, userId };
  }

  async function auditRows(personId: string): Promise<Row[]> {
    return f.q(sql`
      select * from audit_events
       where action = 'tenant.person.sign_in_connected' and resource_id = ${personId}`);
  }

  beforeAll(async () => {
    const { createSignInFixture } = await import("@/lib/testing/sign-in-fixture");
    f = await createSignInFixture("cn65ts");
    org = await f.congregation("a");
    connect = await import("./connect");
  });

  afterAll(async () => {
    if (f) await f.cleanup();
  });

  beforeEach(() => {
    auditControl.fail = false;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("an authority-free record connects at sign-in; one audit row from the closed key list, no address", async () => {
    const s = await pair();
    const [contact] = await f.q(sql`
      select id, created_at from contact_methods
       where person_id = ${s.personId} and kind = 'email' and ended_at is null`);
    const result = await connect.connectSignedInAccount({
      userId: s.userId, via: "sign_in", proof: "account", actorEmail: s.email,
    });
    expect(result.kind).toBe("connected");
    expect(await f.linkedUser(s.personId)).toBe(s.userId);

    const rows = await auditRows(s.personId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.actor_user_id).toBe(s.userId);
    expect(row.resource_type).toBe("person");
    const metadata = row.metadata as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual([...connect.CONNECT_AUDIT_METADATA_KEYS].sort());
    expect(metadata).toMatchObject({
      organizationId: org,
      personId: s.personId,
      contactMethodId: String(contact!.id),
      via: "sign_in",
      proof: "account",
      secondFactor: false,
      authority: { sessionSeat: false, diaconateSeat: false, roleKeys: [], permissionKeys: [] },
    });
    // The join key to the row that put the address on the record (F232 detection chain).
    expect(new Date(String(metadata.contactMethodCreatedAt)).getTime()).toBe(new Date(contact!.created_at as string | Date).getTime());
    expect(JSON.stringify(metadata)).not.toMatch(/@/);
    expect(JSON.stringify(metadata)).not.toContain(s.email);
  });

  it("the second call (two tabs, a double submit) is already_connected and writes no second row (E-14)", async () => {
    const s = await pair();
    expect((await connect.connectSignedInAccount({ userId: s.userId, via: "sign_in", proof: "account" })).kind).toBe("connected");
    expect((await connect.connectSignedInAccount({ userId: s.userId, via: "check_again", secondFactorVerified: false })).kind).toBe("already_connected");
    expect(await auditRows(s.personId)).toHaveLength(1);
  });

  it("a decline writes nothing: no link, no audit row (a visitor, then an unproven account)", async () => {
    const visitor = await pair({ engagement: "visitor", roll: null });
    expect((await connect.connectSignedInAccount({ userId: visitor.userId, via: "sign_in", proof: "account" })).kind).toBe("declined");
    expect(await f.linkedUser(visitor.personId)).toBeNull();
    expect(await auditRows(visitor.personId)).toHaveLength(0);

    const unproven = await pair({}, { verified: false });
    expect((await connect.connectSignedInAccount({ userId: unproven.userId, via: "sign_in", proof: "account" })).kind).toBe("declined");
    expect(await f.linkedUser(unproven.personId)).toBeNull();
    expect(await auditRows(unproven.personId)).toHaveLength(0);
  });

  it("an authority-bearing record never connects at sign-in; Check again needs the enrolled factor AND the session claim, then snapshots what the record carried (E-10)", async () => {
    const s = await pair();
    await f.seat(org, s.personId);

    // Sign-in: the factor flag is always false -> needs_second_factor, nothing written.
    expect((await connect.connectSignedInAccount({ userId: s.userId, via: "sign_in", proof: "account" })).kind).toBe("needs_second_factor");
    expect(await f.linkedUser(s.personId)).toBeNull();
    expect(await auditRows(s.personId)).toHaveLength(0);

    // The session claims a factor but the account never enrolled one: still not enough.
    expect((await connect.connectSignedInAccount({ userId: s.userId, via: "check_again", secondFactorVerified: true })).kind).toBe("needs_second_factor");
    expect(await f.linkedUser(s.personId)).toBeNull();

    // Enrolled, but the session has not been through the challenge: not enough.
    await f.totp(s.userId);
    expect((await connect.connectSignedInAccount({ userId: s.userId, via: "check_again", secondFactorVerified: false })).kind).toBe("needs_second_factor");
    expect(await f.linkedUser(s.personId)).toBeNull();

    // Enrolled AND verified: connects, and the row records what the record carried.
    expect((await connect.connectSignedInAccount({ userId: s.userId, via: "check_again", secondFactorVerified: true })).kind).toBe("connected");
    expect(await f.linkedUser(s.personId)).toBe(s.userId);
    const rows = await auditRows(s.personId);
    expect(rows).toHaveLength(1);
    const metadata = rows[0]!.metadata as { via: string; proof: unknown; secondFactor: boolean; authority: { sessionSeat: boolean } };
    expect(metadata.via).toBe("check_again");
    expect(metadata.proof).toBeNull();
    expect(metadata.secondFactor).toBe(true);
    expect(metadata.authority.sessionSeat).toBe(true);
  });

  it("the authority snapshot carries role and permission keys (a person-arm grant)", async () => {
    const s = await pair();
    await f.totp(s.userId);
    await f.personGrant(org, s.personId, ["people.manage"]);
    expect((await connect.connectSignedInAccount({ userId: s.userId, via: "check_again", secondFactorVerified: true })).kind).toBe("connected");
    const authority = ((await auditRows(s.personId))[0]!.metadata as { authority: { permissionKeys: string[]; roleKeys: string[] } }).authority;
    expect(authority.permissionKeys).toContain("people.manage");
  });

  it("a FAILED audit insert leaves no link and no row: the connect is one transaction (Rule 7)", async () => {
    const s = await pair();
    auditControl.fail = true;
    const result = await connect.connectSignedInAccount({ userId: s.userId, via: "sign_in", proof: "account", actorEmail: s.email });
    auditControl.fail = false;
    expect(result.kind).toBe("error");
    expect(await f.linkedUser(s.personId)).toBeNull();
    expect(await auditRows(s.personId)).toHaveLength(0);
    // The contact was not stamped either (the bind helper's write rolled back).
    const [stamped] = await f.q(sql`
      select count(*)::int as n from contact_methods
       where person_id = ${s.personId} and verified_at is not null`);
    expect(stamped!.n).toBe(0);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toMatch(/@/);
    expect(logged).not.toContain(s.userId);

    // And the same account connects normally afterwards: nothing was left half-done.
    expect((await connect.connectSignedInAccount({ userId: s.userId, via: "sign_in", proof: "account" })).kind).toBe("connected");
    expect(await auditRows(s.personId)).toHaveLength(1);
  });

  it("a lock timeout is an error that returns within seconds, writes nothing, and logs a class only (E-11)", async () => {
    const s = await pair();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = f.platform.transaction(async (tx) => {
      await tx.execute(sql`select 1 from organizations where id = ${org} for update`);
      locked();
      await held;
    });
    await isLocked;
    const t0 = Date.now();
    const result = await connect.connectSignedInAccount({ userId: s.userId, via: "sign_in", proof: "account", actorEmail: s.email });
    const elapsed = Date.now() - t0;
    release();
    await holder;
    expect(result.kind).toBe("error");
    expect(elapsed).toBeLessThan(15_000);
    expect(await f.linkedUser(s.personId)).toBeNull();
    expect(await auditRows(s.personId)).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledWith("[connect] failed", "Error/55P03");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/@/);
  });

  it("a platform administrator connects exactly as anyone else, and the audit row shows it (DECISION-183, E-24)", async () => {
    const s = await pair();
    await f.q(sql`update users set is_platform_admin = true where id = ${s.userId}`);
    expect((await connect.connectSignedInAccount({ userId: s.userId, via: "sign_in", proof: "account" })).kind).toBe("connected");
    const rows = await auditRows(s.personId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_user_id).toBe(s.userId);
  });
});
