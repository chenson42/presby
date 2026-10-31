/**
 * T-6 (Community Increment 2b, Batch A2): AUTO-CONNECT, R41 / R42 / R47.
 * drizzle/0065 section 14, presby_connect_signed_in_account, through the
 * presby_app connection as connect.ts will call it
 * (docs/work-log/2026-10-22-founding-admin-directory.md, "Phase 3 amendment
 * 2" sections 5.10 and 8.3, edge cases E-7 to E-15, E-24, E-26, E-27, E-31,
 * E-36, E-37).
 *
 *   - the G18 matrix: every ineligible case declines with the one literal;
 *     the eligible cases connect;
 *   - R42: an authority-bearing record connects only with a user_totp row
 *     AND a verified factor; the returned snapshot carries what the record
 *     carried;
 *   - the toggle (R47): off or absent declines; turning it off disconnects
 *     nobody (E-31);
 *   - writes: people.user_id and the contact's verified_at, nothing else;
 *   - concurrency (two connections): connect vs connect, vs an address edit,
 *     vs a token acceptance and an in-place acceptance (lock order shared
 *     with acceptance, no deadlock), and a lock timeout is an error, not a
 *     hang;
 *   - no platform predicate: a platform administrator connects exactly as
 *     anyone else (E-24, DECISION-183).
 *
 * The audit row (tenant.person.sign_in_connected) and its closed key list are
 * TypeScript's (connect.ts, Batch B1, T-9).
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/connect.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Row, SignInFixture } from "@/lib/testing/sign-in-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

function chain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let cur: unknown = err;
  while (cur && out.length < 6) {
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}
function pgCode(err: unknown): string | undefined {
  for (const e of chain(err)) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe.skipIf(!hasDb)("drizzle/0065 presby_connect_signed_in_account (T-6)", () => {
  let f: SignInFixture;
  let org: string;
  let other: string;

  const DECLINED = {
    outcome: "declined", organization_id: null, organization_slug: null, person_id: null,
    contact_method_id: null, contact_method_created_at: null,
    session_seat: false, diaconate_seat: false, role_keys: null, permission_keys: null,
  };

  /** A person at `at` with a fresh address, and a proven, active account for that address. */
  async function pair(at: string, options: Parameters<SignInFixture["person"]>[1] = {}, userOptions: Parameters<SignInFixture["user"]>[1] = {}) {
    const p = await f.person(at, options);
    const userId = await f.user(p.email!, userOptions);
    return { personId: p.id, email: p.email!, userId };
  }

  beforeAll(async () => {
    const { createSignInFixture } = await import("@/lib/testing/sign-in-fixture");
    f = await createSignInFixture("cn65");
    org = await f.congregation("a");
    other = await f.congregation("b");
  });

  afterAll(async () => {
    if (f) await f.cleanup();
  });

  // ===========================================================================
  // eligible: connects
  // ===========================================================================
  describe("eligible records connect", () => {
    it("an authority-free member: connected, user_id set, the contact stamped, the snapshot empty; a second call is already_connected", async () => {
      const s = await pair(org);
      const before = await f.footprint(org);
      const r = await f.connect(s.userId, false);
      const [cm] = await f.q(sql`select id, created_at, verified_at from contact_methods where person_id = ${s.personId} and ended_at is null`);
      const [o] = await f.q(sql`select slug from organizations where id = ${org}`);
      expect(r).toMatchObject({
        outcome: "connected", organization_id: org, organization_slug: o!.slug, person_id: s.personId,
        contact_method_id: cm!.id, session_seat: false, diaconate_seat: false, role_keys: [], permission_keys: [],
      });
      expect(new Date(String(r.contact_method_created_at)).getTime()).toBe(new Date(String(cm!.created_at)).getTime());
      expect(cm!.verified_at).not.toBeNull();
      expect(await f.linkedUser(s.personId)).toBe(s.userId);
      // Nothing but the link and the stamp.
      expect(await f.footprint(org)).toEqual({ ...before, linked: Number(before.linked) + 1, verified_contacts: Number(before.verified_contacts) + 1 });
      expect(await f.connect(s.userId, false)).toMatchObject({ ...DECLINED, outcome: "already_connected" });
    });

    it.each([
      ["a visitor with a roll (E-36)", { engagement: "visitor", roll: "active" }],
      ["a staff anchor", { engagement: "staff", roll: null }],
      ["a regular without a roll", { engagement: "regular", roll: null }],
    ])("%s connects", async (_n, options) => {
      const s = await pair(org, options);
      expect((await f.connect(s.userId, false)).outcome).toBe("connected");
    });

    it("a different-case account address matches (exact lower(btrim), E-27)", async () => {
      const p = await f.person(org);
      const userId = await f.user(p.email!.toUpperCase());
      expect((await f.connect(userId, false)).outcome).toBe("connected");
      expect(await f.linkedUser(p.id)).toBe(userId);
    });

    it("a deceased or ended relative holding the same address does not block (E-7)", async () => {
      const s = await pair(org);
      const dead = await f.person(org, { email: false, deceased: "2023-01-01" });
      await f.addEmail(dead.id, s.email);
      const gone = await f.person(other, { email: false, endedOn: "2023-01-01" });
      await f.addEmail(gone.id, s.email);
      expect((await f.connect(s.userId, false)).outcome).toBe("connected");
    });

    it("an expired or a revoked invitation to the address does not hold it back (E-8)", async () => {
      const a = await pair(org);
      await f.signInRow(org, a.personId, a.email, { createdAt: sql`now() - interval '9 days'`, expiresAt: sql`now() - interval '2 days'` });
      expect((await f.connect(a.userId, false)).outcome).toBe("connected");

      const b = await pair(org);
      const inv = await f.signInRow(org, b.personId, b.email);
      await f.q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${f.actingUserId} where id = ${inv.id}`);
      expect((await f.connect(b.userId, false)).outcome).toBe("connected");
    });

    it("a platform administrator connects exactly as anyone else; nothing reads the platform predicate (E-24)", async () => {
      const s = await pair(org);
      await f.q(sql`update users set is_platform_admin = true where id = ${s.userId}`);
      expect((await f.connect(s.userId, false)).outcome).toBe("connected");
      const admin = await pair(org, {}, {});
      await f.q(sql`update users set is_platform_admin = true where id = ${admin.userId}`);
      await f.seat(org, admin.personId);
      expect((await f.connect(admin.userId, false)).outcome).toBe("needs_second_factor");
    });
  });

  // ===========================================================================
  // the G18 decline matrix
  // ===========================================================================
  describe("every ineligible case declines with the one uniform row", () => {
    const cases: Array<[string, () => Promise<string | null>]> = [
      ["a null user id", async () => null],
      ["an unknown user id", async () => "00000000-0000-4000-8000-000000000065"],
      ["an inactive account", async () => (await pair(org, {}, { active: false })).userId],
      ["an unproven account (E-34)", async () => (await pair(org, {}, { verified: false })).userId],
      ["a visitor without a roll", async () => (await pair(org, { engagement: "visitor", roll: null })).userId],
      ["an address shared with another live person at the organization (E-26: a child on a parent's address)", async () => {
        const s = await pair(org);
        const child = await f.person(org, { email: false, first: "Child" });
        await f.addEmail(child.id, s.email);
        return s.userId;
      }],
      ["an address on two people in two organizations", async () => {
        const s = await pair(org);
        const twin = await f.person(other, { email: false });
        await f.addEmail(twin.id, s.email);
        return s.userId;
      }],
      ["the only holder is linked to another account", async () => {
        const s = await pair(org);
        const someoneElse = await f.user(f.email("else"));
        await f.linkUser(s.personId, someoneElse);
        return s.userId;
      }],
      ["the only holder's address was removed (ended)", async () => {
        const s = await pair(org);
        await f.q(sql`update contact_methods set ended_at = now(), is_primary = false where person_id = ${s.personId}`);
        return s.userId;
      }],
      ["the only holder is merged", async () => {
        const s = await pair(org);
        await f.merge(s.personId);
        return s.userId;
      }],
      ["the only holder is deceased", async () => (await pair(org, { deceased: "2024-02-02" })).userId],
      ["the only holder's membership ended", async () => (await pair(org, { endedOn: "2024-02-02" })).userId],
      ["the holder is at two organizations, both live", async () => {
        const s = await pair(org);
        await f.elsewhere(s.personId, other);
        return s.userId;
      }],
      ["the holder is at two organizations, the other ended (R31)", async () => {
        const s = await pair(org);
        await f.elsewhere(s.personId, other, "2022-01-01");
        return s.userId;
      }],
      ["the organization is unmanaged", async () => (await pair(await f.congregation("u", { platformStatus: "unmanaged" }))).userId],
      ["the organization is invited", async () => (await pair(await f.congregation("i", { platformStatus: "invited" }))).userId],
      ["the toggle is off", async () => (await pair(await f.congregation("off", { toggle: false }))).userId],
      ["the toggle row is absent (DECISION-097)", async () => (await pair(await f.congregation("none", { toggle: null }))).userId],
      ["an open sign_in invitation to the address (FB5)", async () => {
        const s = await pair(org);
        await f.signInRow(org, s.personId, s.email);
        return s.userId;
      }],
      ["an open founding-administrator invitation to the address at another organization (FB5: any purpose, any organization)", async () => {
        const s = await pair(org);
        await f.insertInvitation({ organizationId: other, purpose: "founding_administrator", email: s.email, createdByUserId: f.actingUserId });
        return s.userId;
      }],
      ["an open treasurer invitation to the address at another organization", async () => {
        const s = await pair(org);
        const tOrg = await f.congregation("t");
        const tp = await f.person(tOrg, { email: false });
        await f.insertInvitation({ organizationId: tOrg, purpose: "treasurer", email: s.email, createdByUserId: f.actingUserId, personId: tp.id });
        return s.userId;
      }],
      ["a plus-tagged account address (no folding, E-27)", async () => {
        const p = await f.person(org);
        const [local, domain] = p.email!.split("@");
        return f.user(`${local}+tag@${domain}`);
      }],
      ["a dot-folded account address (no folding)", async () => {
        const n = Math.floor(Math.random() * 1e9);
        await f.person(org, { email: `dotfold${n}@example.invalid` });
        return f.user(`dot.fold${n}@example.invalid`);
      }],
      ["a lookalike (homograph) account address (E-27)", async () => {
        const p = await f.person(org);
        return f.user(p.email!.replace(/a/, "а"));
      }],
      ["the account is linked to a person at an unmanaged organization only", async () => {
        const u = await f.congregation("lu", { platformStatus: "unmanaged" });
        const s = await pair(u);
        await f.linkUser(s.personId, s.userId);
        return s.userId;
      }],
      ["the account is linked to a person whose only membership ended", async () => {
        const s = await pair(org, { endedOn: "2024-03-03" });
        await f.linkUser(s.personId, s.userId);
        return s.userId;
      }],
    ];

    it.each(cases)("%s", async (_n, make) => {
      const userId = await make();
      const before = await f.footprint(org);
      const r = await f.connect(userId, true);
      expect(r).toEqual(DECLINED);
      expect(await f.footprint(org)).toEqual(before);
    });
  });

  // ===========================================================================
  // managed == isEnterableOrganization (E-37)
  // ===========================================================================
  it("connect's 'enterable' equals isEnterableOrganization over every platform_status value (E-37)", async () => {
    const { isEnterableOrganization } = await import("@/lib/authz");
    for (const status of ["managed", "unmanaged", "invited"] as const) {
      const at = await f.congregation(`p${status.slice(0, 3)}`, { platformStatus: status });
      const s = await pair(at);
      const r = await f.connect(s.userId, false);
      const enterable = isEnterableOrganization({ endedOn: null, platformStatus: status } as never);
      expect(r.outcome === "connected", status).toBe(enterable);
    }
  });

  // ===========================================================================
  // R42: authority needs a second factor
  // ===========================================================================
  describe("R42: an authority-bearing record needs a user_totp row AND a verified factor", () => {
    it.each([
      ["no user_totp row, factor false", false, false, "needs_second_factor"],
      ["no user_totp row, factor true", false, true, "needs_second_factor"],
      ["a user_totp row, factor false (always so at sign-in)", true, false, "needs_second_factor"],
      ["a user_totp row and a verified factor", true, true, "connected"],
    ])("%s", async (_n, enrolled, factor, expected) => {
      const s = await pair(org, {}, { totp: enrolled });
      await f.seat(org, s.personId);
      const before = await f.footprint(org);
      const r = await f.connect(s.userId, factor);
      expect(r.outcome).toBe(expected);
      if (expected !== "connected") {
        expect(r).toEqual({ ...DECLINED, outcome: "needs_second_factor" });
        expect(await f.footprint(org)).toEqual(before);
        expect(await f.linkedUser(s.personId)).toBeNull();
      }
    });

    it("a null factor is false", async () => {
      const s = await pair(org, {}, { totp: true });
      await f.seat(org, s.personId);
      expect((await f.connect(s.userId, null)).outcome).toBe("needs_second_factor");
    });

    it("the snapshot carries what the record carried: seats, roles and permission keys", async () => {
      const s = await pair(org, {}, { totp: true });
      await f.seat(org, s.personId);
      await f.seat(org, s.personId, "deacon");
      await f.personGrant(org, s.personId, ["roles.manage"]);
      await f.groupGrant(org, s.personId, ["events.manage"], { memberStartsOn: "2099-01-01" });
      const r = await f.connect(s.userId, true);
      expect(r).toMatchObject({ outcome: "connected", session_seat: true, diaconate_seat: true, permission_keys: ["events.manage", "roles.manage"] });
      expect((r.role_keys as string[]).length).toBe(2);
    });

    it.each([
      ["a future-dated seat", async (p: string) => f.seat(org, p, "ruling_elder", "2099-01-01")],
      ["a person-arm grant", async (p: string) => { await f.personGrant(org, p, ["roles.manage"]); }],
      ["a managed-group grant", async (p: string) => { await f.groupGrant(org, p, ["roles.manage"]); }],
    ])("%s is authority: needs_second_factor without the factor", async (_n, give) => {
      const s = await pair(org, {}, { totp: true });
      await give(s.personId);
      expect((await f.connect(s.userId, false)).outcome).toBe("needs_second_factor");
      expect((await f.connect(s.userId, true)).outcome).toBe("connected");
    });
  });

  // ===========================================================================
  // the toggle never disconnects (E-31)
  // ===========================================================================
  it("turning the toggle off or ending the membership disconnects nobody (E-31)", async () => {
    const at = await f.congregation("e31");
    const s = await pair(at);
    expect((await f.connect(s.userId, false)).outcome).toBe("connected");
    await f.toggle(at, false);
    expect(await f.linkedUser(s.personId)).toBe(s.userId);
    expect((await f.connect(s.userId, false)).outcome).toBe("already_connected");
    await f.q(sql`update memberships set ended_on = current_date where person_id = ${s.personId} and organization_id = ${at}`);
    expect(await f.linkedUser(s.personId)).toBe(s.userId);
    // linked, but no enterable organization left: declined, never a loop to /launch
    expect((await f.connect(s.userId, false)).outcome).toBe("declined");
  });

  // ===========================================================================
  // concurrency and lock order
  // ===========================================================================
  describe("concurrency (two connections)", () => {
    it("two connects for one account: exactly one connected, the other already_connected (E-14)", async () => {
      const s = await pair(org);
      const [a, b] = await Promise.all([f.connect(s.userId, false), f.connect(s.userId, false)]);
      expect([a.outcome, b.outcome].sort()).toEqual(["already_connected", "connected"]);
      expect(await f.linkedUser(s.personId)).toBe(s.userId);
    });

    it("connect vs an address edit holding the contact row: connect waits, re-checks, and declines; never a link to a stale address (E-15)", async () => {
      const s = await pair(org);
      let releaseEdit!: () => void;
      const editHeld = new Promise<void>((r) => (releaseEdit = r));
      let editStarted!: () => void;
      const started = new Promise<void>((r) => (editStarted = r));
      const edit = f.platform.transaction(async (tx) => {
        await tx.execute(sql`update contact_methods set ended_at = now(), is_primary = false
                              where person_id = ${s.personId} and ended_at is null`);
        editStarted();
        await editHeld;
      });
      await started;
      const pending = f.connect(s.userId, false);
      await sleep(1500);
      releaseEdit();
      await edit;
      const r = await pending;
      expect(r).toEqual(DECLINED);
      expect(await f.linkedUser(s.personId)).toBeNull();
    });

    /**
     * The person carries a second, non-main address B with an open sign_in
     * invitation to it, for a second account; connect links the first account
     * through the main address A (no invitation is open to A, so FB5 does not
     * apply) and HOLDS its locks. An invitation cannot be inserted for the
     * organization while connect holds the row FOR UPDATE (the FK takes FOR
     * KEY SHARE on it), so the row is created first.
     */
    async function heldConnectThenAccept(acceptVia: "in_place" | "token") {
      const s = await pair(org);
      const second = f.email("b");
      await f.q(sql`insert into contact_methods (person_id, kind, value, is_primary)
                    values (${s.personId}, 'email', ${second}, false)`);
      const otherUser = await f.user(second);
      const inv = await f.signInRow(org, s.personId, second);
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let connected!: (row: Row) => void;
      const got = new Promise<Row>((r) => (connected = r));
      const connectTx = f.appDb.transaction(async (tx) => {
        const res = await tx.execute(sql`select * from presby_connect_signed_in_account(${s.userId}::uuid, false)`);
        connected(((res as unknown as { rows: Row[] }).rows)[0]!);
        await held;
      });
      expect((await got).outcome).toBe("connected");
      const accept = acceptVia === "in_place"
        ? f.acceptInPlace(inv.id, otherUser, false)
        : f.accept(inv.token, { userId: otherUser });
      let settled = false;
      void accept.then(() => (settled = true), () => (settled = true));
      await sleep(1500);
      expect(settled, "the acceptance waits on connect's organization lock").toBe(false);
      release();
      await connectTx;
      const a = await accept;
      // It re-reads under its own locks and sees the link connect made.
      expect(a).toMatchObject({ outcome: "blocked", blocked_reason: "person_linked_elsewhere" });
      expect(await f.linkedUser(s.personId)).toBe(s.userId);
    }

    it("connect holding its locks vs an in-place acceptance of the same person: the acceptance waits, then sees the link; no deadlock", async () => {
      await heldConnectThenAccept("in_place");
    });

    it("connect holding its locks vs a token acceptance of the same person: the acceptance waits, then sees the link; no deadlock", async () => {
      await heldConnectThenAccept("token");
    });

    it("an acceptance holding its locks vs connect: connect declines on the open invitation without waiting (FB5)", async () => {
      const s = await pair(org);
      const inv = await f.signInRow(org, s.personId, s.email);
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let accepted!: () => void;
      const done = new Promise<void>((r) => (accepted = r));
      const acceptTx = f.appDb.transaction(async (tx) => {
        await tx.execute(sql`select * from presby_accept_in_place(${inv.id}::uuid, ${s.userId}::uuid, false)`);
        accepted();
        await held;
      });
      await done;
      const t0 = Date.now();
      const r = await f.connect(s.userId, false);
      expect(Date.now() - t0).toBeLessThan(10_000);
      expect(r).toEqual(DECLINED);
      release();
      await acceptTx;
      expect(await f.linkedUser(s.personId)).toBe(s.userId);
    });

    it("a lock timeout surfaces as an error, not a hang (connect.ts sets lock_timeout = '3s')", async () => {
      const s = await pair(org);
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
      let caught: unknown;
      const t0 = Date.now();
      try {
        await f.appDb.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '1s'`);
          await tx.execute(sql`select * from presby_connect_signed_in_account(${s.userId}::uuid, false)`);
        });
      } catch (err) {
        caught = err;
      }
      release();
      await holder;
      expect(pgCode(caught)).toBe("55P03");
      expect(Date.now() - t0).toBeLessThan(15_000);
      expect(await f.linkedUser(s.personId)).toBeNull();
    });
  });
});
