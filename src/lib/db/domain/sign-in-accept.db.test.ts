/**
 * T-4, acceptance half (Community Increment 2b, Batch A2): the sign_in branch
 * of the shared acceptance core and of preview, through the TOKEN
 * presentation (drizzle/0065 section 13; Phase 3 Test Plan 1.2 and 1.4 as
 * amended by Phase 3 amendment 2 section 8.3,
 * docs/work-log/2026-10-22-founding-admin-directory.md).
 *
 *   - R27 in both directions: the address still on file accepts; an address
 *     removed after the send is dead from accept AND zero rows from preview,
 *     for new and existing accounts alike (account_exists and email_mismatch
 *     are never reached for a stale link); a main address demoted but still
 *     on file accepts; a concurrent edit vs accept is dead or an accept, never
 *     a link to a stale address;
 *   - R31 at acceptance, and the gate set (person_merged, person_deceased,
 *     membership_ended, person_linked_elsewhere, ambiguous_person), each a
 *     committed blocked_at and nothing else;
 *   - R35: an accepted sign_in writes people.user_id and the contact's
 *     verified_at (and, for a new account, the users row) and nothing else;
 *   - F196: an unknown purpose raises internal_error in accept and preview
 *     (forced, with the CHECK relaxed inside a rolled-back transaction);
 *   - G5: preview names the person only to the signed-in account the row is
 *     addressed to; the invitee name columns are always null;
 *   - E1: a users_email_lower_uq race maps to account_exists for EVERY
 *     purpose (two connections).
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/sign-in-accept.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { SignInFixture } from "@/lib/testing/sign-in-fixture";
import { FAKE_BCRYPT } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

class Rollback extends Error {}
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

describe.skipIf(!hasDb)("drizzle/0065 sign_in acceptance and preview (T-4, acceptance)", () => {
  let f: SignInFixture;
  let org: string;
  let other: string;

  const newAccount = () => ({ passwordHash: FAKE_BCRYPT, firstName: "Wendeline", lastName: "Ashgrove" });

  async function scene(options: { user?: boolean; userOptions?: Parameters<SignInFixture["user"]>[1] } = {}) {
    const p = await f.person(org);
    const userId = options.user === false ? null : await f.user(p.email!, options.userOptions);
    const inv = await f.signInRow(org, p.id, p.email!);
    return { personId: p.id, email: p.email!, userId, inv };
  }

  async function endAddress(personId: string) {
    await f.q(sql`update contact_methods set ended_at = now(), is_primary = false
                   where person_id = ${personId} and kind = 'email' and ended_at is null`);
  }

  beforeAll(async () => {
    const { createSignInFixture } = await import("@/lib/testing/sign-in-fixture");
    f = await createSignInFixture("sa65");
    org = await f.congregation("a");
    other = await f.congregation("b");
  });

  afterAll(async () => {
    if (f) await f.cleanup();
  });

  // ===========================================================================
  // R27 both directions
  // ===========================================================================
  describe("R27: the invited address must still be on the record", () => {
    it("still on file: an existing account accepts (linked_person) and a new account accepts (created account, linked)", async () => {
      const a = await scene();
      expect(await f.accept(a.inv.token, { userId: a.userId })).toMatchObject({
        outcome: "accepted", purpose: "sign_in", mode: "existing_account", person_id: a.personId,
        person_mode: "linked_person", administration_role_key: null, office_role_key: null,
        permission_keys: null, treasurer_role_id: null,
      });

      const b = await scene({ user: false });
      const r = await f.accept(b.inv.token, newAccount());
      expect(r).toMatchObject({ outcome: "accepted", mode: "new_account", person_id: b.personId, person_mode: "linked_person" });
      const [u] = await f.q(sql`select email, email_verified is not null as proven from users where id = ${String(r.user_id)}`);
      expect(u).toEqual({ email: b.email, proven: true });
      expect(await f.linkedUser(b.personId)).toBe(r.user_id);
    });

    it.each([["existing account"], ["new account"]])("removed after the send: %s -> dead, preview zero rows, nothing written", async (mode) => {
      const s = await scene({ user: mode === "existing account" });
      await endAddress(s.personId);
      const before = await f.footprint(org);
      const inv = await f.invitation(s.inv.id);
      const r = await f.accept(s.inv.token, mode === "existing account" ? { userId: s.userId } : newAccount());
      expect(r.outcome).toBe("dead");
      expect(await f.preview(s.inv.token, s.userId)).toEqual([]);
      expect(await f.invitation(s.inv.id)).toEqual(inv);
      expect(await f.footprint(org)).toEqual(before);
    });

    it("a stale link is dead even where account_exists or email_mismatch would otherwise answer", async () => {
      // account_exists: a new-account accept for an address that has an account
      const a = await scene();
      await endAddress(a.personId);
      expect((await f.accept(a.inv.token, newAccount())).outcome).toBe("dead");
      // email_mismatch: an existing account with a different address
      const b = await scene({ user: false });
      await endAddress(b.personId);
      const stranger = await f.user(f.email("stranger"));
      expect((await f.accept(b.inv.token, { userId: stranger })).outcome).toBe("dead");
    });

    it("a main address demoted but still on file accepts", async () => {
      const s = await scene();
      // One transaction: the deferred contact_methods_primary_required check
      // (drizzle/0064 section 7) wants an active main at commit.
      await f.platform.transaction(async (tx) => {
        await tx.execute(sql`update contact_methods set is_primary = false where person_id = ${s.personId}`);
        await tx.execute(sql`insert into contact_methods (person_id, kind, value, is_primary)
                              values (${s.personId}, 'email', ${f.email("newmain")}, true)`);
      });
      expect((await f.accept(s.inv.token, { userId: s.userId })).outcome).toBe("accepted");
    });

    it("an account address in a different case accepts", async () => {
      const p = await f.person(org);
      const userId = await f.user(p.email!.toUpperCase());
      const inv = await f.signInRow(org, p.id, p.email!);
      expect((await f.accept(inv.token, { userId })).outcome).toBe("accepted");
    });

    it("a concurrent address edit holding the contact row: accept waits on its FOR SHARE re-check and answers dead; never a link to a stale address", async () => {
      const s = await scene();
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let edited!: () => void;
      const started = new Promise<void>((r) => (edited = r));
      const edit = f.platform.transaction(async (tx) => {
        await tx.execute(sql`update contact_methods set ended_at = now(), is_primary = false
                              where person_id = ${s.personId} and ended_at is null`);
        edited();
        await held;
      });
      await started;
      const accept = f.accept(s.inv.token, { userId: s.userId });
      await sleep(1500);
      release();
      await edit;
      expect((await accept).outcome).toBe("dead");
      expect(await f.linkedUser(s.personId)).toBeNull();
      expect((await f.invitation(s.inv.id)).accepted_at).toBeNull();
    });
  });

  // ===========================================================================
  // gates: each a committed blocked_at and nothing else
  // ===========================================================================
  describe("the gates block, committing blocked_at and nothing else", () => {
    async function expectBlocked(s: Awaited<ReturnType<typeof scene>>, reason: string) {
      const before = await f.footprint(org);
      const r = await f.accept(s.inv.token, { userId: s.userId });
      expect(r).toMatchObject({ outcome: "blocked", blocked_reason: reason, invitation_id: s.inv.id, purpose: "sign_in" });
      const inv = await f.invitation(s.inv.id);
      expect(inv.blocked_reason).toBe(reason);
      expect(inv.blocked_at).not.toBeNull();
      expect(await f.footprint(org)).toEqual(before);
      expect((await f.accept(s.inv.token, { userId: s.userId })).outcome).toBe("dead");
    }

    it("person_merged", async () => {
      const s = await scene();
      await f.merge(s.personId);
      await expectBlocked(s, "person_merged");
    });

    it("person_deceased (the new reason)", async () => {
      const s = await scene();
      await f.q(sql`update people set date_of_death = '2024-04-04' where id = ${s.personId}`);
      await expectBlocked(s, "person_deceased");
    });

    it("membership_ended", async () => {
      const s = await scene();
      await f.q(sql`update memberships set ended_on = current_date where person_id = ${s.personId}`);
      await expectBlocked(s, "membership_ended");
    });

    it("R31: a membership elsewhere appearing after the send -> person_elsewhere", async () => {
      const s = await scene();
      await f.elsewhere(s.personId, other);
      await expectBlocked(s, "person_elsewhere");
    });

    it("person_linked_elsewhere: the person already has a different account", async () => {
      const s = await scene();
      await f.linkUser(s.personId, await f.user(f.email("prior")));
      await expectBlocked(s, "person_linked_elsewhere");
    });

    it("ambiguous_person: the account is already another live person at this organization", async () => {
      const s = await scene();
      const mine = await f.person(org, { email: false });
      await f.linkUser(mine.id, s.userId!);
      await expectBlocked(s, "ambiguous_person");
    });

    it("person_elsewhere: the account is already a live person at another organization", async () => {
      const s = await scene();
      const away = await f.person(other, { email: false });
      await f.linkUser(away.id, s.userId!);
      await expectBlocked(s, "person_elsewhere");
    });

    it("the same account on the same person is the harmless no-op (E-19)", async () => {
      const s = await scene();
      await f.linkUser(s.personId, s.userId!);
      expect(await f.accept(s.inv.token, { userId: s.userId })).toMatchObject({ outcome: "accepted", person_mode: "existing_person" });
    });
  });

  // ===========================================================================
  // R35: what an accepted sign_in writes
  // ===========================================================================
  it("R35: an accepted sign_in writes no role grant, role, permission, group membership, officer term or designation", async () => {
    const s = await scene();
    const before = await f.footprint(org);
    const r = await f.accept(s.inv.token, { userId: s.userId });
    expect(r.outcome).toBe("accepted");
    expect(await f.footprint(org)).toEqual({
      ...before, linked: Number(before.linked) + 1, verified_contacts: Number(before.verified_contacts) + 1,
    });
    const [cm] = await f.q(sql`select verified_at from contact_methods where person_id = ${s.personId} and ended_at is null`);
    expect(cm!.verified_at).not.toBeNull();
  });

  // ===========================================================================
  // G5: preview
  // ===========================================================================
  it("preview: the person is named only to the account the row is addressed to; the invitee name columns are null", async () => {
    const s = await scene();
    const [person] = await f.q(sql`select first_name || ' ' || last_name as n from people where id = ${s.personId}`);
    const anonymous = await f.preview(s.inv.token);
    expect(anonymous).toHaveLength(1);
    expect(anonymous[0]).toMatchObject({ purpose: "sign_in", invitee_first_name: null, invitee_last_name: null, person_display_name: null, session_matches: null });
    const stranger = await f.user(f.email("other"));
    expect((await f.preview(s.inv.token, stranger))[0]).toMatchObject({ person_display_name: null, session_matches: false });
    expect((await f.preview(s.inv.token, s.userId))[0]).toMatchObject({ person_display_name: person!.n, session_matches: true });
  });

  // ===========================================================================
  // F196: explicit purpose routing
  // ===========================================================================
  it("F196: an unknown purpose cannot be stored (CHECK), and with the CHECK relaxed accept and preview raise internal_error", async () => {
    const p = await f.person(org);
    const { tokenHash, token } = (await import("@/lib/testing/invitation-fixture")).mintToken();
    const codes: Array<string | undefined> = [];
    try {
      await f.platform.transaction(async (tx) => {
        await tx.execute(sql`alter table account_invitations drop constraint account_invitations_purpose_allowed`);
        await tx.execute(sql`alter table account_invitations drop constraint account_invitations_purpose_origin_tie`);
        await tx.execute(sql`
          insert into account_invitations (organization_id, purpose, origin, email_normalized, person_id, token_hash, created_by_user_id, expires_at)
          values (${org}, 'mystery', 'platform', ${p.email}, ${p.id}, ${tokenHash}, ${f.actingUserId}, now() + interval '7 days')`);
        for (const q of [
          sql`select * from presby_preview_invitation(${token}, null)`,
          sql`select * from presby_accept_invitation(${token}, null, ${FAKE_BCRYPT}, 'A', 'B')`,
        ]) {
          try {
            await tx.transaction(async (sp) => { await sp.execute(q); });
            codes.push("none");
          } catch (err) {
            codes.push(pgCode(err));
          }
        }
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
    expect(codes).toEqual(["XX000", "XX000"]);
    const [n] = await f.q(sql`select count(*)::int as n from pg_constraint where conname = 'account_invitations_purpose_allowed'`);
    expect(n!.n).toBe(1);
  });

  // ===========================================================================
  // E1: users_email_lower_uq maps to account_exists for every purpose
  // ===========================================================================
  describe("E1: a case-variant account racing a new-account acceptance -> account_exists (two connections)", () => {
    async function race(token: string, address: string) {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let inserted!: () => void;
      const started = new Promise<void>((r) => (inserted = r));
      const winner = f.platform.transaction(async (tx) => {
        const [row] = (await tx.execute(sql`insert into users (email, name) values (${address.toUpperCase()}, 'Race Winner') returning id`) as unknown as { rows: Array<{ id: string }> }).rows;
        f.trackUser(row!.id);
        inserted();
        await held;
      });
      await started;
      const accept = f.accept(token, newAccount());
      await sleep(1500);
      release();
      await winner;
      return accept;
    }

    it("sign_in", async () => {
      const s = await scene({ user: false });
      const inv = await f.invitation(s.inv.id);
      expect((await race(s.inv.token, s.email)).outcome).toBe("account_exists");
      expect(await f.invitation(s.inv.id)).toEqual(inv);
      expect(await f.preview(s.inv.token)).toHaveLength(1);
    });

    it("founding administrator", async () => {
      const at = await f.congregation("e1fa");
      const email = f.email("e1fa");
      const inv = await f.insertInvitation({ organizationId: at, purpose: "founding_administrator", email, createdByUserId: f.actingUserId });
      expect((await race(inv.token, email)).outcome).toBe("account_exists");
    });

    it("treasurer", async () => {
      const at = await f.congregation("e1tr");
      const p = await f.person(at);
      const inv = await f.insertInvitation({ organizationId: at, purpose: "treasurer", email: p.email!, createdByUserId: f.actingUserId, personId: p.id });
      expect((await race(inv.token, p.email!)).outcome).toBe("account_exists");
    });
  });
});
