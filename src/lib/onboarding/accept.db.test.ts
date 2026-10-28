/**
 * src/lib/onboarding/accept.ts on a REAL Postgres connection, through the
 * presby_app `db` exactly as the anonymous route runs it (docs/work-log/
 * 2026-10-21-invitations.md, Phase 3 Batch 2c; Phase 2 R1/R5/R7; addendum D-3).
 * The SQL decisions themselves are proven in
 * src/lib/db/domain/invitations.db.test.ts; this file proves what accept.ts
 * adds on top:
 *
 *   - RULE 7, AUDIT IN THE ACCEPTANCE TRANSACTION, per outcome:
 *       accepted (new account, existing account, each purpose) writes
 *       invitation.accepted, user.created_via_invitation (new only) and the
 *       org.*.designated event with viaInvitationId / invitedByUserId /
 *       inviterIsInvitee - ids only, never the address, token or hash;
 *       each blocked reason writes exactly one invitation.accept_blocked;
 *       dead, account_exists, email_mismatch and account_inactive write NO row.
 *   - A FAILED audit insert rolls the whole acceptance back (account, person,
 *     designation, claim - and a committed blocked_at), leaving the token live.
 *   - Validation (G17) happens before the database and cannot be a token oracle.
 *   - COST PARITY: bcrypt runs once for a new-account submission whether the
 *     token is live, dead or malformed.
 *   - The preview: masked address, session_matches, null for every dead state.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/onboarding/accept.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { compare } from "bcryptjs";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const hashSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("bcryptjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcryptjs")>();
  return {
    ...actual,
    hash: (...args: Parameters<typeof actual.hash>) => {
      hashSpy.calls += 1;
      return actual.hash(...args);
    },
  };
});

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

describe.skipIf(!hasDb)("src/lib/onboarding/accept.ts (Postgres-backed)", { timeout: 60_000 }, () => {
  let fx: InvitationFixture;
  let accept: typeof import("./accept");
  let operator: string;
  const orgIds: string[] = [];
  const PASSWORD = "correct horse battery";

  async function q(query: SQL): Promise<Row[]> {
    return fx.q(query);
  }

  async function org(type: "congregation" | "presbytery" | "synod" | "new_worshiping_community" = "congregation") {
    const id = await fx.makeOrg("acc", { organizationType: type });
    orgIds.push(id);
    return id;
  }

  async function faScene(options: { createdBy?: string; address?: string } = {}) {
    const orgId = await org();
    const address = options.address ?? fx.email("fa");
    const inv = await fx.insertInvitation({
      organizationId: orgId, purpose: "founding_administrator", email: address,
      createdByUserId: options.createdBy ?? operator, firstName: "Marisol", lastName: "Quenby",
    });
    return { orgId, address, ...inv };
  }

  async function trScene(type: "congregation" | "presbytery" = "congregation") {
    const orgId = await org(type);
    const person = await fx.makePerson("Odalys", "Pennick");
    await fx.addMember(orgId, person);
    const address = fx.email("tr");
    await fx.addEmail(person, address);
    const inv = await fx.insertInvitation({
      organizationId: orgId, purpose: "treasurer", email: address, createdByUserId: operator, personId: person,
    });
    return { orgId, address, person, ...inv };
  }

  async function track(address: string) {
    const [u] = await q(sql`select id from users where lower(email) = ${address}`);
    if (u) fx.trackUser(String(u.id));
    return u ? String(u.id) : null;
  }

  async function audit(orgId: string): Promise<Row[]> {
    return q(sql`select * from audit_events where metadata->>'organizationId' = ${orgId} order by created_at, action`);
  }

  const newAccount = (first = "Marisol", last = "Quenby", password = PASSWORD) =>
    ({ kind: "new_account" as const, firstName: first, lastName: last, password });

  beforeAll(async () => {
    const mod = await import("@/lib/testing/invitation-fixture");
    fx = await mod.createInvitationFixture("inv-accept");
    operator = fx.actingUserId;
    accept = await import("./accept");
  });

  beforeEach(() => {
    hashSpy.calls = 0;
  });

  afterEach(() => {
    auditControl.fail = false;
  });

  afterAll(async () => {
    if (!fx) return;
    try {
      for (const id of orgIds) {
        await q(sql`delete from audit_events where metadata->>'organizationId' = ${id}`);
      }
    } finally {
      await fx.cleanup();
    }
  });

  // =========================================================================
  describe("accepted: audit rows in the acceptance transaction", () => {
    it("new account x founding administrator: invitation.accepted + user.created_via_invitation + org.founding_administrator.designated, ids only", async () => {
      const s = await faScene();
      const r = await accept.acceptInvitation({ token: s.token, mode: newAccount() });
      expect(r).toEqual({ kind: "accepted", mode: "new_account", organizationSlug: expect.stringMatching(/^inv-accept-acc-/) });
      const userId = await track(s.address);
      expect(userId).not.toBeNull();

      // The account: the invitation's address (never client input), verified, the password hashed with bcrypt.
      const [user] = await q(sql`select email, name, password, email_verified, two_factor_required from users where id = ${userId!}`);
      // Own column false since 0080 (DECISION-291); required through the founding
      // bundle's flagged keys (roles.manage, role_grants.manage, domains.manage).
      expect(user).toMatchObject({ email: s.address, name: "Marisol Quenby", two_factor_required: false });
      const [req] = await q(sql`select presby_two_factor_required(${userId!}::uuid) as required`);
      expect(req!.required).toBe(true);
      expect(user!.email_verified).not.toBeNull();
      expect(String(user!.password)).toMatch(/^\$2[aby]\$10\$/);
      expect(await compare(PASSWORD, String(user!.password))).toBe(true);

      const rows = await audit(s.orgId);
      expect(rows.map((x) => x.action).sort()).toEqual([
        "invitation.accepted",
        "org.founding_administrator.designated",
        "user.created_via_invitation",
      ]);
      const by = (action: string) => rows.find((x) => x.action === action)!;
      const [inv] = await q(sql`select person_id from account_invitations where id = ${s.id}`);

      expect(by("invitation.accepted")).toMatchObject({ actor_user_id: userId, resource_type: "account_invitation", resource_id: s.id });
      expect(by("invitation.accepted").metadata).toEqual({
        invitationId: s.id, organizationId: s.orgId, purpose: "founding_administrator", personId: inv!.person_id,
        mode: "new_account", invitedByUserId: operator, inviterIsInvitee: false,
      });
      expect(by("user.created_via_invitation")).toMatchObject({ actor_user_id: userId, resource_type: "user", resource_id: userId });
      expect(by("user.created_via_invitation").metadata).toEqual({ userId, invitationId: s.id, organizationId: s.orgId });
      expect(by("org.founding_administrator.designated")).toMatchObject({ actor_user_id: userId, resource_type: "organization", resource_id: s.orgId });
      const designated = by("org.founding_administrator.designated").metadata as Record<string, unknown>;
      expect(designated).toMatchObject({
        organizationId: s.orgId, personId: inv!.person_id, userId, mode: "created_person",
        administrationRoleKey: "founding_administrator", priorHolderCount: 0,
        viaInvitationId: s.id, invitedByUserId: operator, inviterIsInvitee: false,
      });
      expect(designated.permissionKeys).toEqual(expect.arrayContaining(["roles.manage", "role_grants.manage"]));

      // Ids only: neither the address nor the token nor its hash anywhere in any audit row.
      const blob = JSON.stringify(rows);
      expect(blob).not.toContain(s.address);
      expect(blob).not.toContain(s.token);
      expect(blob).not.toContain(s.tokenHash);
      expect(blob).not.toContain(PASSWORD);
    });

    it("new account x treasurer: the designation row carries the treasurer role id", async () => {
      const s = await trScene();
      const r = await accept.acceptInvitation({ token: s.token, mode: newAccount("Odalys", "Pennick") });
      expect(r).toMatchObject({ kind: "accepted", mode: "new_account" });
      const userId = await track(s.address);
      const rows = await audit(s.orgId);
      expect(rows.map((x) => x.action).sort()).toEqual([
        "invitation.accepted", "org.treasurer.designated", "user.created_via_invitation",
      ]);
      const [role] = await q(sql`select id from app_roles where organization_id = ${s.orgId} and key = 'treasurer'`);
      const designated = rows.find((x) => x.action === "org.treasurer.designated")!;
      expect(designated).toMatchObject({ actor_user_id: userId, resource_id: s.orgId });
      expect(designated.metadata).toMatchObject({
        organizationId: s.orgId, personId: s.person, roleId: role!.id,
        viaInvitationId: s.id, invitedByUserId: operator, inviterIsInvitee: false,
      });
      expect((designated.metadata as Record<string, unknown>).permissionKeys).toEqual(expect.arrayContaining(["giving.manage"]));
    });

    it("existing account x founding administrator: no user.created row; the actor email is the session's", async () => {
      const s = await faScene();
      const userId = await fx.makeUser(s.address);
      const r = await accept.acceptInvitation({ token: s.token, mode: { kind: "existing_account", userId, email: s.address } });
      expect(r).toMatchObject({ kind: "accepted", mode: "existing_account" });
      const rows = await audit(s.orgId);
      expect(rows.map((x) => x.action).sort()).toEqual(["invitation.accepted", "org.founding_administrator.designated"]);
      expect(rows.find((x) => x.action === "invitation.accepted")).toMatchObject({ actor_user_id: userId, actor_email: s.address });
      expect(rows.find((x) => x.action === "invitation.accepted")!.metadata).toMatchObject({ mode: "existing_account", inviterIsInvitee: false });
    });

    it("existing account x treasurer", async () => {
      const s = await trScene();
      const userId = await fx.makeUser(s.address);
      const r = await accept.acceptInvitation({ token: s.token, mode: { kind: "existing_account", userId, email: null } });
      expect(r).toMatchObject({ kind: "accepted", mode: "existing_account" });
      const rows = await audit(s.orgId);
      expect(rows.map((x) => x.action).sort()).toEqual(["invitation.accepted", "org.treasurer.designated"]);
      expect(rows.find((x) => x.action === "org.treasurer.designated")).toMatchObject({ actor_user_id: userId, actor_email: null });
    });

    it("self-designation (operator ruling): inviterIsInvitee is stamped true on BOTH the accepted and the designated rows", async () => {
      const address = fx.email("self");
      const self = await fx.makeUser(address);
      const s = await faScene({ createdBy: self, address });
      await accept.acceptInvitation({ token: s.token, mode: { kind: "existing_account", userId: self, email: address } });
      const rows = await audit(s.orgId);
      for (const action of ["invitation.accepted", "org.founding_administrator.designated"]) {
        expect(rows.find((x) => x.action === action)!.metadata, action).toMatchObject({ inviterIsInvitee: true, invitedByUserId: self });
      }
    });

    it("single use: a second acceptance of the same token is dead and writes nothing more", async () => {
      const s = await faScene();
      await accept.acceptInvitation({ token: s.token, mode: newAccount() });
      await track(s.address);
      const before = (await audit(s.orgId)).length;
      expect(await accept.acceptInvitation({ token: s.token, mode: newAccount() })).toEqual({ kind: "dead" });
      expect((await audit(s.orgId)).length).toBe(before);
    });
  });

  // =========================================================================
  describe("a FAILED audit insert rolls the whole acceptance back (Rule 7)", () => {
    it("accepted: no account, no person, no designation, no claim; the token stays live", async () => {
      const s = await faScene();
      const before = await fx.snapshot(s.orgId, s.address);
      auditControl.fail = true;
      const r = await accept.acceptInvitation({ token: s.token, mode: newAccount() });
      expect(r).toEqual({ kind: "db_error" });
      expect(await fx.snapshot(s.orgId, s.address)).toEqual(before);
      const [inv] = await q(sql`select accepted_at, blocked_at from account_invitations where id = ${s.id}`);
      expect(inv).toEqual({ accepted_at: null, blocked_at: null });
      expect(await audit(s.orgId)).toHaveLength(0);
      // Still live.
      expect(await fx.preview(s.token)).toHaveLength(1);
      auditControl.fail = false;
      expect((await accept.acceptInvitation({ token: s.token, mode: newAccount() })).kind).toBe("accepted");
      await track(s.address);
    });

    it("blocked: the committed blocked_at is rolled back with the failed audit, so the link is not killed by an outage", async () => {
      const s = await faScene();
      const holder = await fx.makePerson("Current", "Admin");
      await fx.enroll(s.orgId, holder, ["roles.manage"]);
      auditControl.fail = true;
      expect(await accept.acceptInvitation({ token: s.token, mode: newAccount() })).toEqual({ kind: "db_error" });
      const [inv] = await q(sql`select blocked_at from account_invitations where id = ${s.id}`);
      expect(inv!.blocked_at).toBeNull();
      expect(await fx.preview(s.token)).toHaveLength(1);
    });
  });

  // =========================================================================
  describe("blocked: exactly one invitation.accept_blocked per reason, nothing else audited", () => {
    type Setup = () => Promise<{ token: string; orgId: string; address: string; id: string; purpose: string; mode: Parameters<typeof accept.acceptInvitation>[0]["mode"]; userId?: string }>;

    const reasons: Array<[string, Setup]> = [
      ["has_holders", async () => {
        const s = await faScene();
        const h = await fx.makePerson("Current", "Admin");
        await fx.enroll(s.orgId, h, ["role_grants.manage"]);
        return { ...s, purpose: "founding_administrator", mode: newAccount() };
      }],
      ["not_applicable", async () => {
        const s = await trScene("presbytery");
        return { ...s, purpose: "treasurer", mode: newAccount() };
      }],
      ["provisioning_incomplete", async () => {
        const orgId = await fx.makeBareOrg("acc-noprov");
        orgIds.push(orgId);
        const address = fx.email("noprov");
        const inv = await fx.insertInvitation({ organizationId: orgId, purpose: "founding_administrator", email: address, createdByUserId: operator });
        return { orgId, address, ...inv, purpose: "founding_administrator", mode: newAccount() };
      }],
      ["person_merged", async () => {
        const s = await trScene();
        const survivor = await fx.makePerson("Odalys", "Survivor");
        await q(sql`update people set merged_into_id = ${survivor} where id = ${s.person}`);
        return { ...s, purpose: "treasurer", mode: newAccount() };
      }],
      ["membership_ended", async () => {
        const s = await trScene();
        await q(sql`update memberships set ended_on = current_date - 1 where person_id = ${s.person} and organization_id = ${s.orgId}`);
        return { ...s, purpose: "treasurer", mode: newAccount() };
      }],
      ["person_linked_elsewhere", async () => {
        const s = await trScene();
        await fx.linkUser(s.person, await fx.makeUser(fx.email("owner-of-person")));
        return { ...s, purpose: "treasurer", mode: newAccount() };
      }],
      ["person_elsewhere", async () => {
        const s = await faScene();
        const elsewhere = await org();
        const userId = await fx.makeUser(s.address);
        const p = await fx.makePerson("Elsewhere", "Person");
        await fx.addMember(elsewhere, p);
        await fx.linkUser(p, userId);
        return { ...s, purpose: "founding_administrator", mode: { kind: "existing_account" as const, userId, email: s.address }, userId };
      }],
      ["ambiguous_person", async () => {
        const s = await faScene();
        for (const last of ["One", "Two"]) {
          const p = await fx.makePerson("Shared", last);
          await fx.addMember(s.orgId, p);
          await fx.addEmail(p, s.address);
        }
        return { ...s, purpose: "founding_administrator", mode: newAccount() };
      }],
    ];

    it.each(reasons)("%s", async (reason, setup) => {
      const s = await setup();
      const before = await fx.snapshot(s.orgId, s.address);
      const r = await accept.acceptInvitation({ token: s.token, mode: s.mode });
      // The result carries the PURPOSE (the invitee's copy depends on it, G6) and
      // the congregation's public name (Community Increment 2b, Batch B2).
      expect(r).toEqual({ kind: "blocked", reason, purpose: s.purpose, organizationName: expect.stringContaining("Fixture") });

      const rows = await audit(s.orgId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "invitation.accept_blocked",
        resource_type: "account_invitation",
        resource_id: s.id,
        actor_user_id: s.userId ?? null,
      });
      expect(rows[0]!.metadata).toEqual({ invitationId: s.id, organizationId: s.orgId, purpose: s.purpose, reason });
      // The metadata is ids and a reason only. (actor_email is the signed-in
      // account's own address in existing mode - the actor, not the invitation.)
      expect(JSON.stringify(rows[0]!.metadata)).not.toContain(s.address);

      // blocked_at committed, nothing else written, the link is dead afterwards.
      const [inv] = await q(sql`select blocked_at, blocked_reason, accepted_at from account_invitations where id = ${s.id}`);
      expect(inv).toMatchObject({ blocked_reason: reason, accepted_at: null });
      expect(inv!.blocked_at).not.toBeNull();
      expect(await fx.snapshot(s.orgId, s.address)).toEqual(before);
      expect(await accept.acceptInvitation({ token: s.token, mode: s.mode })).toEqual({ kind: "dead" });
    });
  });

  // =========================================================================
  describe("non-terminal and dead outcomes write no audit row and leave the token alive", () => {
    async function expectSilent(s: { orgId: string; address: string; token: string }, run: () => Promise<unknown>, expected: unknown) {
      const before = await fx.snapshot(s.orgId, s.address);
      expect(await run()).toEqual(expected);
      expect(await audit(s.orgId)).toHaveLength(0);
      expect(await fx.snapshot(s.orgId, s.address)).toEqual(before);
    }

    it("account_exists (a new-account submission for an address that has an account)", async () => {
      const s = await faScene();
      await fx.makeUser(s.address);
      await expectSilent(s, () => accept.acceptInvitation({ token: s.token, mode: newAccount() }), { kind: "account_exists" });
      expect(await fx.preview(s.token)).toHaveLength(1);
    });

    it("email_mismatch (signed in as another account)", async () => {
      const s = await faScene();
      const other = await fx.makeUser(fx.email("other"));
      await expectSilent(s, () => accept.acceptInvitation({ token: s.token, mode: { kind: "existing_account", userId: other, email: null } }), { kind: "email_mismatch" });
      expect(await fx.preview(s.token)).toHaveLength(1);
    });

    it("account_inactive", async () => {
      const s = await faScene();
      const user = await fx.makeUser(s.address, { isActive: false });
      await expectSilent(s, () => accept.acceptInvitation({ token: s.token, mode: { kind: "existing_account", userId: user, email: null } }), { kind: "account_inactive" });
    });

    it("dead: unknown, expired, revoked and superseded tokens are one outcome and write nothing", async () => {
      const orgId = await org();
      const address = fx.email("dead");
      const expired = await fx.insertInvitation({
        organizationId: orgId, purpose: "founding_administrator", email: address, createdByUserId: operator,
        createdAt: sql`now() - interval '9 days'`, expiresAt: sql`now() - interval '2 days'`,
      });
      const s = { orgId, address, token: expired.token };
      await expectSilent(s, () => accept.acceptInvitation({ token: expired.token, mode: newAccount() }), { kind: "dead" });
      const { mintInvitationToken } = await import("./invitation-token");
      await expectSilent(s, () => accept.acceptInvitation({ token: mintInvitationToken().token, mode: newAccount() }), { kind: "dead" });
      await q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${operator} where id = ${expired.id}`);
      await expectSilent(s, () => accept.acceptInvitation({ token: expired.token, mode: newAccount() }), { kind: "dead" });
      // The stored HASH is not a credential (R5).
      await expectSilent(s, () => accept.acceptInvitation({ token: expired.tokenHash, mode: newAccount() }), { kind: "dead" });
    });
  });

  // =========================================================================
  describe("validation before the database (G17) and cost parity", () => {
    it("rejects bad names and passwords with the field named, never touching the database or the token", async () => {
      const s = await faScene();
      const before = await fx.snapshot(s.orgId, s.address);
      expect(await accept.acceptInvitation({ token: s.token, mode: newAccount("   ", "Quenby") })).toEqual({ kind: "invalid_input", field: "firstName" });
      expect(await accept.acceptInvitation({ token: s.token, mode: newAccount("Marisol", "x".repeat(101)) })).toEqual({ kind: "invalid_input", field: "lastName" });
      expect(await accept.acceptInvitation({ token: s.token, mode: newAccount("Marisol", "Quenby", "1234567") })).toEqual({ kind: "invalid_input", field: "password" });
      expect(await accept.acceptInvitation({ token: s.token, mode: newAccount("Marisol", "Quenby", "a".repeat(73)) })).toEqual({ kind: "invalid_input", field: "password" });
      // Counted as UTF-8 BYTES: 37 two-byte characters is only 37 characters but 74 bytes.
      expect(await accept.acceptInvitation({ token: s.token, mode: newAccount("Marisol", "Quenby", "é".repeat(37)) })).toEqual({ kind: "invalid_input", field: "password" });
      expect(hashSpy.calls).toBe(0);
      expect(await fx.snapshot(s.orgId, s.address)).toEqual(before);
      expect(await fx.preview(s.token)).toHaveLength(1);
    });

    it("validation is independent of the token: a dead token with a bad password is invalid_input, not dead (no oracle)", async () => {
      const { mintInvitationToken } = await import("./invitation-token");
      expect(await accept.acceptInvitation({ token: mintInvitationToken().token, mode: newAccount("Marisol", "Quenby", "short") })).toEqual({ kind: "invalid_input", field: "password" });
    });

    it("bcrypt runs exactly once for a new-account submission, whether the token is live, dead or malformed", async () => {
      const { mintInvitationToken } = await import("./invitation-token");
      const s = await faScene();
      hashSpy.calls = 0;
      await accept.acceptInvitation({ token: mintInvitationToken().token, mode: newAccount() }); // unknown
      expect(hashSpy.calls).toBe(1);
      hashSpy.calls = 0;
      await accept.acceptInvitation({ token: "not-a-token", mode: newAccount() }); // malformed
      expect(hashSpy.calls).toBe(1);
      hashSpy.calls = 0;
      await accept.acceptInvitation({ token: s.token, mode: newAccount() }); // live
      expect(hashSpy.calls).toBe(1);
      await track(s.address);
    });

    it("an existing-account acceptance needs no password and runs no bcrypt", async () => {
      const s = await faScene();
      const userId = await fx.makeUser(s.address);
      hashSpy.calls = 0;
      await accept.acceptInvitation({ token: s.token, mode: { kind: "existing_account", userId, email: null } });
      expect(hashSpy.calls).toBe(0);
    });

    it("a malformed user id in existing mode is dead, with no call to the database", async () => {
      const s = await faScene();
      expect(await accept.acceptInvitation({ token: s.token, mode: { kind: "existing_account", userId: "not-a-uuid", email: null } })).toEqual({ kind: "dead" });
      expect(await audit(s.orgId)).toHaveLength(0);
    });
  });

  // =========================================================================
  describe("previewInvitation", () => {
    it("returns the masked address and never the full one, and reads no user without a session id (S1)", async () => {
      const s = await faScene();
      const p = await accept.previewInvitation(s.token);
      expect(p).toMatchObject({
        purpose: "founding_administrator", inviteeFirstName: "Marisol", inviteeLastName: "Quenby",
        sessionMatches: null,
      });
      expect(p!.maskedEmail).toMatch(/^.\*\*\*@/);
      expect(p!.maskedEmail).not.toBe(s.address);
      expect(JSON.stringify(p)).not.toContain(s.address);
      expect(p!.expiresAt).toBeInstanceOf(Date);
      expect(p!.organizationName).toMatch(/Fixture acc/);
    });

    it("session_matches: true for the invited account, false for another (D-3: the id is the session's)", async () => {
      const s = await faScene();
      const mine = await fx.makeUser(s.address);
      const other = await fx.makeUser(fx.email("other"));
      expect((await accept.previewInvitation(s.token, mine))!.sessionMatches).toBe(true);
      expect((await accept.previewInvitation(s.token, other))!.sessionMatches).toBe(false);
    });

    it("a malformed user id is treated as no session", async () => {
      const s = await faScene();
      expect((await accept.previewInvitation(s.token, "not-a-uuid"))!.sessionMatches).toBeNull();
    });

    it("is null for a malformed token and for every dead state, whatever user id is passed", async () => {
      const { mintInvitationToken } = await import("./invitation-token");
      const s = await faScene();
      const user = await fx.makeUser(s.address);
      expect(await accept.previewInvitation("nope", user)).toBeNull();
      expect(await accept.previewInvitation(mintInvitationToken().token, user)).toBeNull();
      expect(await accept.previewInvitation(s.tokenHash, user)).toBeNull(); // the hash is not a credential
      await q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${operator} where id = ${s.id}`);
      expect(await accept.previewInvitation(s.token, user)).toBeNull();
    });

    it("names the roster person for a treasurer", async () => {
      const s = await trScene();
      expect((await accept.previewInvitation(s.token))!.personDisplayName).toMatch(/Odalys/);
    });
  });
});
