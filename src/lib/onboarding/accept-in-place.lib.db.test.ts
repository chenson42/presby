/**
 * `acceptInvitationInPlace` and `listInvitationsForAccount` on a REAL Postgres
 * connection, through the presby_app `db` exactly as `/no-organization` runs
 * them (Community Increment 2b, Batch B2, T-9; R45, edge cases E-16 to E-20,
 * E-29). The SQL decisions are proven in
 * `src/lib/db/domain/accept-in-place.db.test.ts` and the anti-fork twin
 * `designation-parity-in-place.db.test.ts`; `accept.test.ts` pins the
 * TypeScript's decisions with the database mocked. What only a real database
 * shows, and this file does:
 *
 *   - the audit rows an in-place acceptance leaves: `invitation.accepted` (and
 *     the `org.*.designated` row for a designation) carrying `via: "in_place"`
 *     and `secondFactor`, in the transaction that made the change, and the
 *     TOKEN path's rows for the same acceptance WITHOUT those keys;
 *   - a FORCED failure of the audit insert rolls the acceptance back: the
 *     person is not linked and the invitation is still open;
 *   - `needs_second_factor` changes and writes nothing;
 *   - a blocked acceptance commits the block, writes its audit row, and
 *     returns the purpose and the congregation's name;
 *   - the listing's closed shape and who it shows.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/onboarding/accept-in-place.lib.db.test.ts
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

describe.skipIf(!hasDb)("acceptInvitationInPlace and listInvitationsForAccount (Postgres-backed)", () => {
  let f: SignInFixture;
  let org: string;
  let accept: typeof import("./accept");
  let inPlace: typeof import("./in-place");
  let errorSpy: ReturnType<typeof vi.spyOn>;

  async function scene(options: { authority?: boolean; totp?: boolean } = {}) {
    const p = await f.person(org);
    if (options.authority) await f.seat(org, p.id);
    const userId = await f.user(p.email!, { totp: options.totp });
    const inv = await f.signInRow(org, p.id, p.email!);
    return { personId: p.id, email: p.email!, userId, inv };
  }

  const audits = (resourceId: string): Promise<Row[]> =>
    f.q(sql`select * from audit_events where resource_id = ${resourceId} or metadata->>'invitationId' = ${resourceId} order by created_at, action`);
  const place = (s: { inv: { id: string }; userId: string; email: string }, factor: boolean) =>
    accept.acceptInvitationInPlace({ invitationId: s.inv.id, userId: s.userId, email: s.email, secondFactorVerified: factor });

  beforeAll(async () => {
    const { createSignInFixture } = await import("@/lib/testing/sign-in-fixture");
    f = await createSignInFixture("ipl65");
    org = await f.congregation("a");
    accept = await import("./accept");
    inPlace = await import("./in-place");
  });

  afterAll(async () => {
    if (!f) return;
    try {
      await f.q(sql`delete from audit_events where metadata->>'organizationId' = ${org}`);
    } finally {
      await f.cleanup();
    }
  });

  beforeEach(() => {
    auditControl.fail = false;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  // ===========================================================================
  describe("an in-place sign_in acceptance", () => {
    it("links the person, writes ONE invitation.accepted row carrying via and secondFactor, and no designation row", async () => {
      const s = await scene();
      const before = await f.footprint(org);
      const result = await place(s, false);
      expect(result.kind).toBe("accepted");
      if (result.kind !== "accepted") return;
      expect(result.mode).toBe("existing_account");
      expect(await f.linkedUser(s.personId)).toBe(s.userId);

      const after = await f.footprint(org);
      // The link and the contact stamp are the only domain writes (R35).
      expect(after).toEqual({ ...before, linked: Number(before.linked) + 1, verified_contacts: Number(before.verified_contacts) + 1 });

      const rows = await audits(s.inv.id);
      expect(rows.map((r) => r.action)).toEqual(["invitation.accepted"]);
      expect(rows[0]!.actor_user_id).toBe(s.userId);
      expect(rows[0]!.metadata).toMatchObject({
        invitationId: s.inv.id, organizationId: org, purpose: "sign_in", personId: s.personId, mode: "existing_account",
        via: "in_place", secondFactor: false,
      });
      expect(JSON.stringify(rows[0]!.metadata)).not.toContain(s.email);
    });

    it("the SAME acceptance by the emailed link leaves the same row WITHOUT via or secondFactor (the token path is unchanged byte for byte)", async () => {
      const s = await scene();
      const result = await accept.acceptInvitation({ token: s.inv.token, mode: { kind: "existing_account", userId: s.userId, email: s.email } });
      expect(result.kind).toBe("accepted");
      const row = (await audits(s.inv.id)).find((r) => r.action === "invitation.accepted")!;
      expect(Object.keys(row.metadata as object).sort()).toEqual(
        ["invitationId", "inviterIsInvitee", "invitedByUserId", "mode", "organizationId", "personId", "purpose"].sort(),
      );
    });

    it("an authority-bearing record needs the second factor: needs_second_factor changes and writes nothing, the invitation stays open and its token stays live", async () => {
      const s = await scene({ authority: true, totp: true });
      const before = await f.footprint(org);
      const invitation = await f.invitation(s.inv.id);
      expect(await place(s, false)).toEqual({ kind: "needs_second_factor" });
      expect(await f.invitation(s.inv.id)).toEqual(invitation);
      expect(await f.footprint(org)).toEqual(before);
      expect(await audits(s.inv.id)).toHaveLength(0);
      expect(await f.preview(s.inv.token)).toHaveLength(1);

      // Enrolled and verified: accepted, and the row records the factor.
      expect((await place(s, true)).kind).toBe("accepted");
      expect((await audits(s.inv.id)).find((r) => r.action === "invitation.accepted")!.metadata).toMatchObject({ via: "in_place", secondFactor: true });
    });

    it("RULE 7: a FORCED audit failure rolls the acceptance back: the person is not linked and the invitation is still open; it then accepts", async () => {
      const s = await scene();
      const before = await f.footprint(org);
      auditControl.fail = true;
      const result = await place(s, false);
      auditControl.fail = false;
      expect(result).toEqual({ kind: "db_error" });
      expect(await f.linkedUser(s.personId)).toBeNull();
      expect(await f.footprint(org)).toEqual(before);
      expect((await f.invitation(s.inv.id)).accepted_at).toBeNull();
      expect(await audits(s.inv.id)).toHaveLength(0);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(s.email);

      expect((await place(s, false)).kind).toBe("accepted");
    });

    it("a second acceptance of the same invitation is dead (single use)", async () => {
      const s = await scene();
      expect((await place(s, false)).kind).toBe("accepted");
      expect(await place(s, false)).toEqual({ kind: "dead" });
    });

    it("every identity miss is the one dead: a foreign account, an unproven account, a revoked invitation (E-16)", async () => {
      const s = await scene();
      const stranger = await f.user(f.email("stranger"), { totp: true });
      expect(await accept.acceptInvitationInPlace({ invitationId: s.inv.id, userId: stranger, email: null, secondFactorVerified: true })).toEqual({ kind: "dead" });

      const u = await scene();
      await f.q(sql`update users set email_verified = null where id = ${u.userId}`);
      expect(await place(u, true)).toEqual({ kind: "dead" });

      const r = await scene();
      await f.q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${r.userId} where id = ${r.inv.id}`);
      expect(await place(r, true)).toEqual({ kind: "dead" });
      expect(await audits(r.inv.id)).toHaveLength(0);
    });

    it("a blocked acceptance commits the block, writes invitation.accept_blocked, and returns the purpose and the congregation's name for the neutral sentence (G6)", async () => {
      const s = await scene();
      await f.q(sql`update memberships set ended_on = current_date - 1 where person_id = ${s.personId} and organization_id = ${org}`);
      const result = await place(s, false);
      expect(result).toMatchObject({ kind: "blocked", reason: "membership_ended", purpose: "sign_in", organizationName: expect.stringContaining("Fixture") });
      expect((await f.invitation(s.inv.id)).blocked_reason).toBe("membership_ended");
      expect(await f.linkedUser(s.personId)).toBeNull();
      const rows = await audits(s.inv.id);
      expect(rows.map((r) => r.action)).toEqual(["invitation.accept_blocked"]);
      expect(rows[0]!.metadata).toEqual({ invitationId: s.inv.id, organizationId: org, purpose: "sign_in", reason: "membership_ended" });
    });
  });

  // ===========================================================================
  describe("an in-place founding-administrator designation (always needs the second factor, Q2)", () => {
    async function faScene() {
      const target = await f.makeOrg(`fa${Math.floor(Math.random() * 1e6)}`);
      const email = f.email("fa");
      const userId = await f.user(email, { totp: true, name: "Marisol Quenby" });
      const inv = await f.insertInvitation({
        organizationId: target, purpose: "founding_administrator", email, createdByUserId: f.actingUserId, firstName: "Marisol", lastName: "Quenby",
      });
      return { target, email, userId, inv };
    }

    it("without a verified session it is needs_second_factor even for an enrolled account; nothing is written and the token stays live", async () => {
      const s = await faScene();
      const result = await accept.acceptInvitationInPlace({ invitationId: s.inv.id, userId: s.userId, email: s.email, secondFactorVerified: false });
      expect(result).toEqual({ kind: "needs_second_factor" });
      expect((await f.invitation(s.inv.id)).accepted_at).toBeNull();
      expect(await f.preview(s.inv.token)).toHaveLength(1);
      expect(await audits(s.inv.id)).toHaveLength(0);
    });

    it("with an enrolled and verified factor it designates, and BOTH rows carry via 'in_place' and secondFactor true", async () => {
      const s = await faScene();
      const result = await accept.acceptInvitationInPlace({ invitationId: s.inv.id, userId: s.userId, email: s.email, secondFactorVerified: true });
      expect(result.kind).toBe("accepted");
      try {
        const rows = await f.q(sql`
          select * from audit_events
           where metadata->>'invitationId' = ${s.inv.id} or metadata->>'viaInvitationId' = ${s.inv.id}
           order by action`);
        expect(rows.map((r) => r.action).sort()).toEqual(["invitation.accepted", "org.founding_administrator.designated"]);
        for (const row of rows) expect(row.metadata).toMatchObject({ via: "in_place", secondFactor: true });
        const designated = rows.find((r) => r.action === "org.founding_administrator.designated")!;
        expect(designated.metadata).toMatchObject({ organizationId: s.target, priorHolderCount: 0, viaInvitationId: s.inv.id });
      } finally {
        await f.q(sql`delete from audit_events where metadata->>'organizationId' = ${s.target}`);
      }
    });
  });

  // ===========================================================================
  describe("listInvitationsForAccount", () => {
    it("lists the proven account's own open invitations in the closed shape, oldest first, and nothing else", async () => {
      const s = await scene();
      const list = await inPlace.listInvitationsForAccount(s.userId);
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual({
        invitationId: s.inv.id,
        organizationName: expect.stringContaining("Fixture"),
        purpose: "sign_in",
        expiresAt: expect.any(Date),
        personDisplayName: expect.stringContaining("Wendeline"),
      });
      expect(Object.keys(list[0]!).sort()).toEqual(["expiresAt", "invitationId", "organizationName", "personDisplayName", "purpose"]);
      expect(JSON.stringify(list)).not.toContain(s.email);
      expect(JSON.stringify(list)).not.toContain(s.inv.token);
      expect(JSON.stringify(list)).not.toContain(s.personId);
    });

    it("an unproven account, an inactive account, another account, a revoked row and an expired row are not listed", async () => {
      const s = await scene();
      expect(await inPlace.listInvitationsForAccount(await f.user(f.email("nobody")))).toEqual([]);

      await f.q(sql`update users set email_verified = null where id = ${s.userId}`);
      expect(await inPlace.listInvitationsForAccount(s.userId)).toEqual([]);

      const inactive = await scene();
      await f.q(sql`update users set is_active = false where id = ${inactive.userId}`);
      expect(await inPlace.listInvitationsForAccount(inactive.userId)).toEqual([]);

      const revoked = await scene();
      await f.q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${revoked.userId} where id = ${revoked.inv.id}`);
      expect(await inPlace.listInvitationsForAccount(revoked.userId)).toEqual([]);

      const p = await f.person(org);
      const userId = await f.user(p.email!);
      await f.signInRow(org, p.id, p.email!, { createdAt: sql`now() - interval '9 days'`, expiresAt: sql`now() - interval '2 days'` });
      expect(await inPlace.listInvitationsForAccount(userId)).toEqual([]);
    });

    it("a designation shows with no person name; the list never carries the inviter or the person's id", async () => {
      const email = f.email("lst");
      const userId = await f.user(email);
      const target = await f.makeOrg(`ls${Math.floor(Math.random() * 1e6)}`);
      await f.insertInvitation({ organizationId: target, purpose: "founding_administrator", email, createdByUserId: f.actingUserId, firstName: "A", lastName: "B" });
      const list = await inPlace.listInvitationsForAccount(userId);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ purpose: "founding_administrator", personDisplayName: null });
    });

    it("the function's own columns are exactly the closed list (a pg_proc check)", async () => {
      const [fn] = await f.q(sql`
        select pg_get_function_result(p.oid) as result
          from pg_proc p where p.proname = 'presby_list_invitations_for_account'`);
      expect(String(fn!.result)).toBe(
        "TABLE(invitation_id uuid, organization_name text, purpose text, expires_at timestamp with time zone, person_display_name text)",
      );
    });

    it("a well-formed id with no account is simply an empty list (a database error, by contrast, throws: pinned in in-place.test.ts)", async () => {
      expect(await inPlace.listInvitationsForAccount("00000000-0000-4000-8000-000000000000")).toEqual([]);
    });
  });
});
