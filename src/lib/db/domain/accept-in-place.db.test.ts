/**
 * T-7 (Community Increment 2b, Batch A2): ACCEPT IN PLACE, R45 / Q2.
 * drizzle/0065 section 13: presby_accept_in_place through the shared
 * acceptance core, and presby_list_invitations_for_account, through the
 * presby_app connection (docs/work-log/2026-10-22-founding-admin-directory.md,
 * "Phase 3 amendment 2" sections 5.9 and 8.3; edge cases E-16, E-17, E-20,
 * E-40).
 *
 *   - gate order: a foreign id, an address mismatch, an unproven and an
 *     inactive account are each the ONE dead, with nothing written (the id
 *     is never an oracle);
 *   - the second-factor table: founding administrator and treasurer always,
 *     sign_in when the record is authority-bearing; needs_second_factor
 *     leaves the invitation open and the emailed token live;
 *   - an accepted sign_in writes the link and the contact stamp and nothing
 *     else;
 *   - the listing's closed shape (and a pg_proc column check), and that it
 *     shows only the proven, active account's own open rows.
 * The in-place audit fields (`via`, `secondFactor`) are TypeScript's (T-9).
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/accept-in-place.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { SignInFixture } from "@/lib/testing/sign-in-fixture";
import { FAKE_BCRYPT } from "@/lib/testing/invitation-fixture";

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

describe.skipIf(!hasDb)("drizzle/0065 presby_accept_in_place and the listing (T-7)", () => {
  let f: SignInFixture;
  let org: string;
  let other: string;

  const DEAD = {
    outcome: "dead", blocked_reason: null, invitation_id: null, organization_id: null,
    organization_slug: null, purpose: null, mode: null, user_id: null, person_id: null,
    person_mode: null, created_by_user_id: null, inviter_is_invitee: null,
    administration_role_key: null, office_role_key: null, permission_keys: null, treasurer_role_id: null,
  };

  async function signInScene(at: string, options: { authority?: boolean; userOptions?: Parameters<SignInFixture["user"]>[1] } = {}) {
    const p = await f.person(at);
    if (options.authority) await f.seat(at, p.id);
    const userId = await f.user(p.email!, options.userOptions);
    const inv = await f.signInRow(at, p.id, p.email!);
    return { personId: p.id, email: p.email!, userId, inv };
  }

  beforeAll(async () => {
    const { createSignInFixture } = await import("@/lib/testing/sign-in-fixture");
    f = await createSignInFixture("ip65");
    org = await f.congregation("a");
    other = await f.congregation("b");
  });

  afterAll(async () => {
    if (f) await f.cleanup();
  });

  // ===========================================================================
  // gate order: every identity miss is the one dead
  // ===========================================================================
  describe("gate order: a foreign id is never an oracle (E-16)", () => {
    it.each([
      ["a null invitation id", "inv"],
      ["a null user id", "user"],
      ["a null factor flag", "factor"],
    ])("%s is one dead row, no raise", async (_n, which) => {
      const s = await signInScene(org);
      const r = await f.acceptInPlace(which === "inv" ? null : s.inv.id, which === "user" ? null : s.userId, which === "factor" ? null : false);
      expect(r).toEqual(DEAD);
    });

    it("an unknown invitation id is dead", async () => {
      const s = await signInScene(org);
      expect(await f.acceptInPlace("00000000-0000-4000-8000-0000000000aa", s.userId, true)).toEqual(DEAD);
    });

    it.each([
      ["another account's invitation (an address mismatch, E-40)", "mismatch"],
      ["an unproven account whose address matches", "unproven"],
      ["an inactive account whose address matches", "inactive"],
    ])("%s is dead and writes nothing; the invitation stays open", async (_n, kind) => {
      const s = await signInScene(org);
      let userId = s.userId;
      if (kind === "mismatch") userId = await f.user(f.email("stranger"), { totp: true });
      if (kind === "unproven") {
        await f.q(sql`update users set email_verified = null where id = ${s.userId}`);
      }
      if (kind === "inactive") await f.q(sql`update users set is_active = false where id = ${s.userId}`);
      const inv = await f.invitation(s.inv.id);
      const before = await f.footprint(org);
      expect(await f.acceptInPlace(s.inv.id, userId, true)).toEqual(DEAD);
      expect(await f.invitation(s.inv.id)).toEqual(inv);
      expect(await f.footprint(org)).toEqual(before);
    });

    it.each([["revoked"], ["expired"]])("a %s invitation is dead", async (state) => {
      const s = await signInScene(org);
      if (state === "revoked") {
        await f.q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${f.actingUserId} where id = ${s.inv.id}`);
      } else {
        const p = await f.person(org);
        const u = await f.user(p.email!);
        const inv = await f.signInRow(org, p.id, p.email!, { createdAt: sql`now() - interval '9 days'`, expiresAt: sql`now() - interval '1 day'` });
        expect(await f.acceptInPlace(inv.id, u, true)).toEqual(DEAD);
        return;
      }
      expect(await f.acceptInPlace(s.inv.id, s.userId, true)).toEqual(DEAD);
    });

    it("sign_in: the invited address left the person's record (R27) -> dead, before the user gate", async () => {
      const s = await signInScene(org);
      await f.q(sql`update contact_methods set ended_at = now(), is_primary = false where person_id = ${s.personId}`);
      expect(await f.acceptInPlace(s.inv.id, s.userId, true)).toEqual(DEAD);
      expect((await f.invitation(s.inv.id)).blocked_at).toBeNull();
    });

    it("a mixed-case account address is the same address", async () => {
      const p = await f.person(org);
      const userId = await f.user(p.email!.toUpperCase());
      const inv = await f.signInRow(org, p.id, p.email!);
      expect((await f.acceptInPlace(inv.id, userId, false)).outcome).toBe("accepted");
    });
  });

  // ===========================================================================
  // the second-factor table (R42, R45, E-17)
  // ===========================================================================
  describe("the second-factor table", () => {
    async function faScene() {
      const email = f.email("fa");
      const inv = await f.insertInvitation({ organizationId: await f.congregation(`fa${Math.floor(Math.random() * 1e6)}`), purpose: "founding_administrator", email, createdByUserId: f.actingUserId, firstName: "Marisol", lastName: "Quenby" });
      return { email, inv };
    }
    async function trScene() {
      const at = await f.congregation(`tr${Math.floor(Math.random() * 1e6)}`);
      const p = await f.person(at);
      const inv = await f.insertInvitation({ organizationId: at, purpose: "treasurer", email: p.email!, createdByUserId: f.actingUserId, personId: p.id });
      return { email: p.email!, inv };
    }

    it.each([
      ["founding administrator", "fa"],
      ["treasurer", "tr"],
    ])("%s: always needs a user_totp row AND a verified factor", async (_n, kind) => {
      for (const [enrolled, factor, expected] of [
        [false, false, "needs_second_factor"],
        [false, true, "needs_second_factor"],
        [true, false, "needs_second_factor"],
        [true, true, "accepted"],
      ] as const) {
        const scene = kind === "fa" ? await faScene() : await trScene();
        const userId = await f.user(scene.email, { totp: enrolled });
        const before = await f.invitation(scene.inv.id);
        const r = await f.acceptInPlace(scene.inv.id, userId, factor);
        expect(r.outcome, `${kind} totp=${enrolled} factor=${factor}`).toBe(expected);
        if (expected === "needs_second_factor") {
          expect(r).toEqual({ ...DEAD, outcome: "needs_second_factor" });
          // non-terminal: nothing written, the invitation open, the emailed token live
          expect(await f.invitation(scene.inv.id)).toEqual(before);
          expect(await f.preview(scene.inv.token)).toHaveLength(1);
        } else {
          expect(r).toMatchObject({ purpose: kind === "fa" ? "founding_administrator" : "treasurer", mode: "existing_account", user_id: userId });
          expect(r.administration_role_key).not.toBeNull();
        }
      }
    });

    it("sign_in, authority-free: no factor needed in the database (G9 parity is TypeScript's)", async () => {
      const s = await signInScene(org);
      expect(await f.acceptInPlace(s.inv.id, s.userId, false)).toMatchObject({
        outcome: "accepted", purpose: "sign_in", person_id: s.personId, person_mode: "linked_person",
        administration_role_key: null, office_role_key: null, permission_keys: null, treasurer_role_id: null,
      });
    });

    it("sign_in, authority-bearing: needs_second_factor until a user_totp row AND a verified factor; then the emailed token was still live", async () => {
      const s = await signInScene(org, { authority: true, userOptions: { totp: false } });
      const before = await f.invitation(s.inv.id);
      expect((await f.acceptInPlace(s.inv.id, s.userId, true)).outcome).toBe("needs_second_factor");
      await f.totp(s.userId);
      expect((await f.acceptInPlace(s.inv.id, s.userId, false)).outcome).toBe("needs_second_factor");
      expect(await f.invitation(s.inv.id)).toEqual(before);
      expect(await f.preview(s.inv.token)).toHaveLength(1);
      expect((await f.acceptInPlace(s.inv.id, s.userId, true)).outcome).toBe("accepted");
      expect(await f.linkedUser(s.personId)).toBe(s.userId);
    });

    it("sign_in, authority via a person-arm grant is authority-bearing too", async () => {
      const s = await signInScene(org);
      await f.personGrant(org, s.personId, ["roles.manage"]);
      expect((await f.acceptInPlace(s.inv.id, s.userId, false)).outcome).toBe("needs_second_factor");
    });
  });

  // ===========================================================================
  // what an accepted sign_in writes (R35)
  // ===========================================================================
  it("an accepted sign_in writes people.user_id and the contact's verified_at and nothing else", async () => {
    const s = await signInScene(org);
    const before = await f.footprint(org);
    const r = await f.acceptInPlace(s.inv.id, s.userId, false);
    expect(r.outcome).toBe("accepted");
    expect(await f.footprint(org)).toEqual({
      ...before, linked: Number(before.linked) + 1, verified_contacts: Number(before.verified_contacts) + 1,
    });
    const inv = await f.invitation(s.inv.id);
    expect(inv).toMatchObject({ accepted_user_id: s.userId, person_id: s.personId });
    expect(inv.accepted_at).not.toBeNull();
    // a second acceptance, either way, is dead
    expect(await f.acceptInPlace(s.inv.id, s.userId, false)).toEqual(DEAD);
    expect((await f.accept(s.inv.token, { userId: s.userId })).outcome).toBe("dead");
  });

  it("the person already linked to this same account is the harmless no-op (E-19)", async () => {
    const s = await signInScene(org);
    await f.linkUser(s.personId, s.userId);
    expect(await f.acceptInPlace(s.inv.id, s.userId, false)).toMatchObject({ outcome: "accepted", person_mode: "existing_person" });
  });

  it("the account already belongs to another live person here -> blocked ambiguous_person; elsewhere -> person_elsewhere", async () => {
    const s = await signInScene(org);
    const mine = await f.person(org, { email: false });
    await f.linkUser(mine.id, s.userId);
    expect(await f.acceptInPlace(s.inv.id, s.userId, false)).toMatchObject({ outcome: "blocked", blocked_reason: "ambiguous_person" });

    const t = await signInScene(org);
    const away = await f.person(other, { email: false });
    await f.linkUser(away.id, t.userId);
    expect(await f.acceptInPlace(t.inv.id, t.userId, false)).toMatchObject({ outcome: "blocked", blocked_reason: "person_elsewhere" });
  });

  // ===========================================================================
  // the core is owner-only and refuses misuse
  // ===========================================================================
  it("presby_app may execute presby_accept_in_place but not the core; the core refuses a password hash in place and an unknown presentation", async () => {
    const [acl] = await f.q(sql`
      select has_function_privilege('presby_app', 'presby_accept_in_place(uuid,uuid,boolean)', 'execute') as in_place,
             has_function_privilege('presby_app', 'presby__accept_invitation_core(uuid,uuid,text,text,text,text,boolean)', 'execute') as core_app,
             has_function_privilege('presby_platform', 'presby__accept_invitation_core(uuid,uuid,text,text,text,text,boolean)', 'execute') as core_platform`);
    expect(acl).toEqual({ in_place: true, core_app: false, core_platform: false });

    const s = await signInScene(org);
    let caught: unknown;
    try {
      await f.q(sql`select * from presby__accept_invitation_core(${s.inv.id}, ${s.userId}, ${FAKE_BCRYPT}, null, null, 'in_place', true)`);
    } catch (err) { caught = err; }
    expect(pgCode(caught)).toBe("22023");
    caught = undefined;
    try {
      await f.q(sql`select * from presby__accept_invitation_core(${s.inv.id}, ${s.userId}, null, null, null, 'carrier_pigeon', true)`);
    } catch (err) { caught = err; }
    expect(pgCode(caught)).toBe("XX000");
  });

  // ===========================================================================
  // the listing (E-20)
  // ===========================================================================
  describe("presby_list_invitations_for_account", () => {
    it("the closed shape, from the catalog", async () => {
      const [row] = await f.q(sql`
        select array_to_string(p.proargnames, ',') as names,
               (select string_agg(format_type(t, null), ',' order by o)
                  from unnest(p.proallargtypes) with ordinality u(t, o)) as types,
               p.prosecdef, array_to_string(p.proconfig, ',') as config
          from pg_proc p where p.proname = 'presby_list_invitations_for_account'`);
      expect(row).toEqual({
        names: "p_user_id,invitation_id,organization_name,purpose,expires_at,person_display_name",
        types: "uuid,uuid,text,text,timestamp with time zone,text",
        prosecdef: true,
        config: "search_path=public, pg_temp",
      });
    });

    it("only the proven, active account's own open rows; a display name for sign_in only; ordered by creation", async () => {
      const p = await f.person(org, { first: "Listed" });
      const userId = await f.user(p.email!);
      const older = await f.signInRow(org, p.id, p.email!, { createdAt: sql`now() - interval '2 hours'` });
      const fa = await f.insertInvitation({ organizationId: other, purpose: "founding_administrator", email: p.email!, createdByUserId: f.actingUserId });
      // Not listed: someone else's, an expired one, a revoked one.
      const q = await f.person(other);
      await f.signInRow(other, q.id, q.email!);
      const r = await f.listFor(userId);
      expect(r.map((x) => x.invitation_id)).toEqual([older.id, fa.id]);
      const [o1] = await f.q(sql`select name from organizations where id = ${org}`);
      const [person] = await f.q(sql`select first_name || ' ' || last_name as n from people where id = ${p.id}`);
      expect(r[0]).toEqual({ invitation_id: older.id, organization_name: o1!.name, purpose: "sign_in", expires_at: expect.anything(), person_display_name: person!.n });
      expect(r[1]).toMatchObject({ purpose: "founding_administrator", person_display_name: null });
      expect(Object.keys(r[0]!).sort()).toEqual(["expires_at", "invitation_id", "organization_name", "person_display_name", "purpose"]);

      await f.q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${f.actingUserId} where id = ${fa.id}`);
      expect((await f.listFor(userId)).map((x) => x.invitation_id)).toEqual([older.id]);
    });

    it("nothing for an unproven or an inactive account, a null id, or an expired row", async () => {
      const a = await signInScene(org, { userOptions: { verified: false } });
      expect(await f.listFor(a.userId)).toEqual([]);
      const b = await signInScene(org, { userOptions: { active: false } });
      expect(await f.listFor(b.userId)).toEqual([]);
      expect(await f.listFor(null)).toEqual([]);
      const p = await f.person(org);
      const u = await f.user(p.email!);
      await f.signInRow(org, p.id, p.email!, { createdAt: sql`now() - interval '9 days'`, expiresAt: sql`now() - interval '1 day'` });
      expect(await f.listFor(u)).toEqual([]);
    });
  });
});
