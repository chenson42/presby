/**
 * drizzle/0059_presby_account_invitations.sql on a REAL Postgres connection
 * (docs/work-log/2026-10-21-invitations.md, Phase 3 Implementation Order
 * Batch 1c, plus the Phase 2 addendum's conditions on D-1 and D-5 and its
 * case-insensitive new-account check).
 *
 * What this proves, and on which connection:
 *   - STRUCTURE / ACL (catalog, owner): FORCE RLS and the one policy; presby_app
 *     holds no table privilege and EXECUTE on exactly the two functions;
 *     PUBLIC and presby_platform execute nothing; every function is SECURITY
 *     DEFINER, owned by neondb_owner, search_path pinned (DECISION-148).
 *   - GUARDS (owner path - getPlatformDb() is neondb_owner, which no grant
 *     binds, F44): rows born open; marker-less accept/blocked transitions
 *     refused; identity immutable; terminal states one-way; redaction only on
 *     a terminal row; the delete guard and its teardown cascade; both open-row
 *     partial uniques; the resend chain (D-1) at insert and as a consistency
 *     invariant over a real chain.
 *   - SINGLE SOURCES: the SQL founding-administrator bundle equals
 *     foundingAdministratorPlan() for every organization_type enum value read
 *     from the catalog; the two SQL holder counts equal the TS counts.
 *   - PREVIEW / ACCEPT through the presby_app connection (`db`), as accept.ts
 *     will call them: every dead state is zero preview rows and one `dead`
 *     row; each outcome per {new, existing} x {founding administrator,
 *     treasurer}; each non-terminal outcome writes nothing (snapshot equality);
 *     each blocked reason commits blocked_at and nothing else; every arm of the
 *     exception mapping (D-5.2) driven through the REAL guard that raises it,
 *     including a late memberships_guard_insert refusal whose blocked_at is
 *     read back after commit (D-5.1); the mixed-case existing account
 *     (addendum contradiction 2); self-acceptance (inviter_is_invitee); the
 *     raw-token property (R5); concurrency (two accepts, accept vs revoke,
 *     accept vs resend, a resend/accept loop for lock order).
 *
 * LATE-REFUSAL INJECTION. The exception arms are race backstops: step 4
 * refuses every one of those states before the apply phase runs, so no single
 * call can reach them naturally. The suite installs ONE test-only trigger
 * function, `presby_test_invitation_inject()`, that fires only when the
 * transaction-local GUC `presby_test.inject` is set (inert for every other
 * session), and whose job is to CHANGE THE WORLD between step 4 and the write
 * that a real guard then refuses with its real message (e.g. insert a
 * membership elsewhere just after acceptance creates the person, so the real
 * memberships_guard_insert fires). It is created in beforeAll and dropped in
 * afterAll (pipeline Neon branch only; never development or production).
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/invitations.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const DEFINER_FUNCTIONS = [
  "presby_founding_administrator_holder_count(uuid)",
  "presby_giving_manage_holder_count(uuid)",
  "presby_founding_administrator_permission_keys(text)",
  "presby_apply_founding_administrator(uuid,uuid,uuid)",
  "presby_apply_treasurer(uuid,uuid,uuid)",
  "presby_preview_invitation(text,uuid)",
  "presby_accept_invitation(text,uuid,text,text,text)",
  // drizzle/0060 (designation revoke, DECISION-196): owner only, none
  // executable by presby_app. The two counts above are redefined there over
  // the two list functions; their pin test below is deliberately unchanged.
  "presby_founding_administrator_holder_grants(uuid)",
  "presby_giving_manage_holder_grants(uuid)",
  "presby_founding_administrator_companion_grants(uuid,uuid)",
  "presby_revoke_designation_holder(uuid,text,text,uuid,uuid[])",
];
const APP_EXECUTABLE = new Set([
  "presby_preview_invitation(text,uuid)",
  "presby_accept_invitation(text,uuid,text,text,text)",
]);
const GUARD_FUNCTIONS = [
  "presby_account_invitations_guard_insert()",
  "presby_account_invitations_guard_update()",
  "presby_account_invitations_guard_delete()",
];

describe.skipIf(!hasDb)("drizzle/0059 account_invitations (Postgres-backed)", () => {
  let fx: InvitationFixture;
  let FAKE_BCRYPT: string;
  let operator: string;

  async function q(query: SQL): Promise<Row[]> {
    return fx.q(query);
  }

  /** Drizzle wraps the Postgres error - match the whole cause chain (message, code, constraint). */
  async function expectRaise(p: Promise<unknown>, pattern: RegExp) {
    let caught: unknown = null;
    try {
      await p;
    } catch (err) {
      caught = err;
    }
    expect(caught, `expected a raise matching ${pattern}`).not.toBeNull();
    const parts: string[] = [];
    for (let e = caught as { message?: string; code?: string; constraint?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
      parts.push(String(e.message ?? e), String(e.code ?? ""), String(e.constraint ?? ""));
    }
    expect(parts.join(" | ")).toMatch(pattern);
  }

  /** A congregation (by default) with no holders, and an operator-created FA invitation. */
  async function faScene(options: { type?: "congregation" | "presbytery" | "synod" | "new_worshiping_community"; email?: string; createdBy?: string } = {}) {
    const org = await fx.makeOrg("fa", { organizationType: options.type ?? "congregation" });
    const address = options.email ?? fx.email("fa");
    const inv = await fx.insertInvitation({
      organizationId: org,
      purpose: "founding_administrator",
      email: address,
      createdByUserId: options.createdBy ?? operator,
      firstName: "Marisol",
      lastName: "Quenby",
    });
    return { org, address, ...inv };
  }

  /** A congregation with one active, unlinked member carrying an on-file email, and a treasurer invitation. */
  async function trScene(options: { type?: "congregation" | "new_worshiping_community" | "presbytery" } = {}) {
    const org = await fx.makeOrg("tr", { organizationType: options.type ?? "congregation" });
    const person = await fx.makePerson("Odalys", "Pennick");
    await fx.addMember(org, person);
    const address = fx.email("tr");
    await fx.addEmail(person, address);
    const inv = await fx.insertInvitation({
      organizationId: org,
      purpose: "treasurer",
      email: address,
      createdByUserId: operator,
      personId: person,
    });
    return { org, person, address, ...inv };
  }

  function newAccount(first = "Marisol", last = "Quenby") {
    return { passwordHash: FAKE_BCRYPT, firstName: first, lastName: last };
  }

  async function expectBlocked(id: string, token: string, reason: string, before: Row, org: string, address: string) {
    const row = await fx.invitation(id);
    expect(row.blocked_at).not.toBeNull();
    expect(row.blocked_reason).toBe(reason);
    expect(row.accepted_at).toBeNull();
    expect(row.person_id ?? null).toEqual(row.purpose === "treasurer" ? row.person_id : null);
    // Nothing else written.
    expect(await fx.snapshot(org, address)).toEqual(before);
    // Terminal: the link is dead now.
    expect(await fx.preview(token)).toHaveLength(0);
    expect((await fx.accept(token, newAccount())).outcome).toBe("dead");
  }

  beforeAll(async () => {
    const mod = await import("@/lib/testing/invitation-fixture");
    FAKE_BCRYPT = mod.FAKE_BCRYPT;
    fx = await mod.createInvitationFixture("inv-db");
    operator = fx.actingUserId;

    // The late-refusal injector (see header). SECURITY INVOKER: inside the
    // definer it runs as the owner, like the real guards it provokes.
    await q(sql.raw(`
      create or replace function presby_test_invitation_inject()
      returns trigger language plpgsql set search_path = public, pg_temp as $f$
      declare
        v_mode text := coalesce(current_setting('presby_test.inject', true), '');
        v_org uuid := nullif(current_setting('presby_test.inject_org', true), '')::uuid;
        v_other uuid := nullif(current_setting('presby_test.inject_other_org', true), '')::uuid;
        v_ref uuid := nullif(current_setting('presby_test.inject_ref', true), '')::uuid;
        v_ref2 uuid := nullif(current_setting('presby_test.inject_ref2', true), '')::uuid;
      begin
        if v_mode = '' then return coalesce(new, old); end if;
        -- One branch per table: PL/pgSQL does not short-circuit AND, so a
        -- field of NEW is only named inside its own table's branch.
        if tg_table_name = 'people' then
          if v_mode = 'person_elsewhere' then
            insert into memberships (organization_id, person_id, engagement_status) values (v_other, new.id, 'regular');
          elsif v_mode = 'provisioning_incomplete' then
            update groups set derived_from = 'session' where organization_id = v_org and derived_from = 'active_membership';
          end if;
        elsif tg_table_name = 'app_role_permissions' then
          if v_mode = 'membership_ended' then
            update memberships set ended_on = current_date where organization_id = v_org and person_id = v_ref and ended_on is null;
          end if;
        elsif tg_table_name = 'memberships' then
          if v_mode = 'has_holders' then
            if new.organization_id = v_org and new.person_id <> v_ref then
              insert into role_grants (organization_id, role_id, person_id, starts_on) values (v_org, v_ref2, v_ref, '2020-01-01');
            end if;
          end if;
        elsif tg_table_name = 'users' then
          if v_mode = 'account_exists_race' and pg_trigger_depth() = 1 then
            insert into users (email, name) values (new.email, 'Race Winner');
          end if;
        elsif tg_table_name = 'role_grants' then
          if v_mode = 'other_unique' then
            raise exception 'injected: an unrelated unique violation' using errcode = 'unique_violation', constraint = 'app_roles_org_key';
          elsif v_mode = 'other_privilege' then
            raise exception 'injected: an unrelated refusal' using errcode = 'insufficient_privilege';
          end if;
        end if;
        return coalesce(new, old);
      end $f$`));
    await q(sql.raw(`
      drop trigger if exists zz_test_invitation_inject on people;
      create trigger zz_test_invitation_inject after insert on people for each row execute function presby_test_invitation_inject();
      drop trigger if exists zz_test_invitation_inject on memberships;
      create trigger zz_test_invitation_inject after insert on memberships for each row execute function presby_test_invitation_inject();
      drop trigger if exists zz_test_invitation_inject on app_role_permissions;
      create trigger zz_test_invitation_inject after insert on app_role_permissions for each row execute function presby_test_invitation_inject();
      drop trigger if exists zz_test_invitation_inject on users;
      create trigger zz_test_invitation_inject before insert on users for each row execute function presby_test_invitation_inject();
      drop trigger if exists zz_test_invitation_inject on role_grants;
      create trigger zz_test_invitation_inject before insert on role_grants for each row execute function presby_test_invitation_inject();
    `));
  });

  afterAll(async () => {
    if (!fx) return;
    try {
      await q(sql.raw(`
        drop trigger if exists zz_test_invitation_inject on people;
        drop trigger if exists zz_test_invitation_inject on memberships;
        drop trigger if exists zz_test_invitation_inject on app_role_permissions;
        drop trigger if exists zz_test_invitation_inject on users;
        drop trigger if exists zz_test_invitation_inject on role_grants;
        drop function if exists presby_test_invitation_inject();
      `));
    } finally {
      await fx.cleanup();
    }
  });

  /** Accept with the injector armed, through presby_app, in one committed transaction. */
  async function acceptInjected(
    token: string,
    input: { userId?: string | null; passwordHash?: string | null; firstName?: string | null; lastName?: string | null },
    inject: { mode: string; org?: string; otherOrg?: string; ref?: string; ref2?: string },
  ): Promise<Row> {
    const row = await fx.appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('presby_test.inject', ${inject.mode}, true),
                                  set_config('presby_test.inject_org', ${inject.org ?? ""}, true),
                                  set_config('presby_test.inject_other_org', ${inject.otherOrg ?? ""}, true),
                                  set_config('presby_test.inject_ref', ${inject.ref ?? ""}, true),
                                  set_config('presby_test.inject_ref2', ${inject.ref2 ?? ""}, true)`);
      const r = await tx.execute(sql`
        select * from presby_accept_invitation(${token}::text, ${input.userId ?? null}::uuid,
               ${input.passwordHash ?? null}::text, ${input.firstName ?? null}::text, ${input.lastName ?? null}::text)`);
      return ((r as unknown as { rows: Row[] }).rows ?? [])[0]!;
    });
    fx.trackUser(row.user_id as string | null);
    return row;
  }

  // =========================================================================
  // Structure and ACL
  // =========================================================================
  describe("structure and ACL", () => {
    it("FORCE row level security with exactly one tenant_isolation policy (F1)", async () => {
      const [c] = await q(sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'account_invitations'`);
      expect(c).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const policies = await q(sql`select policyname, qual, with_check from pg_policies where tablename = 'account_invitations'`);
      expect(policies).toEqual([
        {
          policyname: "tenant_isolation",
          qual: "(organization_id = presby_current_org())",
          with_check: "(organization_id = presby_current_org())",
        },
      ]);
    });

    it("presby_app holds NO table privilege; presby_platform holds SELECT only; nobody holds DELETE", async () => {
      const acl = await q(sql`
        select r.rolname,
               has_table_privilege(r.rolname, 'account_invitations', 'SELECT') as s,
               has_table_privilege(r.rolname, 'account_invitations', 'INSERT') as i,
               has_table_privilege(r.rolname, 'account_invitations', 'UPDATE') as u,
               has_table_privilege(r.rolname, 'account_invitations', 'DELETE') as d
          from pg_roles r where r.rolname in ('presby_app', 'presby_platform') order by r.rolname`);
      expect(acl).toEqual([
        { rolname: "presby_app", s: false, i: false, u: false, d: false },
        { rolname: "presby_platform", s: true, i: false, u: false, d: false },
      ]);
      const [cols] = await q(sql`
        select count(*)::int as n from information_schema.column_privileges
         where table_name = 'account_invitations' and grantee = 'presby_app'`);
      expect(cols!.n).toBe(0);
    });

    it("presby_app EXECUTEs exactly preview and accept; PUBLIC and presby_platform execute nothing; the guards lend no privilege", async () => {
      for (const fn of DEFINER_FUNCTIONS) {
        const [r] = await q(sql`
          select has_function_privilege('presby_app', ${fn}::regprocedure, 'EXECUTE') as app,
                 has_function_privilege('presby_platform', ${fn}::regprocedure, 'EXECUTE') as platform,
                 exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                          where p.oid = ${fn}::regprocedure and a.grantee = 0) as public_exec`);
        expect({ fn, ...r }).toEqual({ fn, app: APP_EXECUTABLE.has(fn), platform: false, public_exec: false });
      }
      for (const fn of GUARD_FUNCTIONS) {
        const [r] = await q(sql`
          select has_function_privilege('presby_app', ${fn}::regprocedure, 'EXECUTE') as app, p.prosecdef
            from pg_proc p where p.oid = ${fn}::regprocedure`);
        expect({ fn, ...r }).toEqual({ fn, app: false, prosecdef: false });
      }
    });

    it("every function is SECURITY DEFINER, owned by neondb_owner, search_path = public, pg_temp (DECISION-148)", async () => {
      for (const fn of [...DEFINER_FUNCTIONS]) {
        const [r] = await q(sql`
          select p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.proconfig
            from pg_proc p where p.oid = ${fn}::regprocedure`);
        expect({ fn, ...r }).toEqual({ fn, prosecdef: true, owner: "neondb_owner", proconfig: ["search_path=public, pg_temp"] });
      }
      for (const fn of GUARD_FUNCTIONS) {
        const [r] = await q(sql`select p.proconfig from pg_proc p where p.oid = ${fn}::regprocedure`);
        expect(r!.proconfig).toEqual(["search_path=public, pg_temp"]);
      }
    });

    it("the three BEFORE ROW guards are enabled, and no other trigger exists on the table", async () => {
      const t = await q(sql`
        select tgname, tgenabled, (tgtype & 2) = 2 as before, (tgtype & 1) = 1 as row
          from pg_trigger where tgrelid = 'account_invitations'::regclass and not tgisinternal order by tgname`);
      expect(t).toEqual([
        { tgname: "account_invitations_guard_delete", tgenabled: "O", before: true, row: true },
        { tgname: "account_invitations_guard_insert", tgenabled: "O", before: true, row: true },
        { tgname: "account_invitations_guard_update", tgenabled: "O", before: true, row: true },
      ]);
    });

    it("through the presby_app connection: the table and the owner-only functions are refused", async () => {
      await expectRaise(fx.appDb.execute(sql`select count(*) from account_invitations`), /permission denied/);
      await expectRaise(
        fx.appDb.execute(sql`select presby_founding_administrator_holder_count(${operator}::uuid)`),
        /permission denied/,
      );
      await expectRaise(
        fx.appDb.execute(sql`select * from presby_apply_founding_administrator(${operator}::uuid, ${operator}::uuid, ${operator}::uuid)`),
        /permission denied/,
      );
    });
  });

  // =========================================================================
  // Guards, on the OWNER path (F44)
  // =========================================================================
  describe("guards on the owner path", () => {
    it("an invitation is born open: a pre-accepted, pre-blocked, pre-revoked or pre-redacted insert is refused", async () => {
      const org = await fx.makeOrg("born");
      const person = await fx.makePerson("Born", "Open");
      await fx.addMember(org, person);
      const base = sql`(organization_id, purpose, email_normalized, person_id, token_hash, created_by_user_id, expires_at`;
      const variants: SQL[] = [
        sql`insert into account_invitations ${base}, accepted_at, accepted_user_id) values (${org}, 'treasurer', ${fx.email("b1")}, ${person}, ${"a".repeat(64)}, ${operator}, now() + interval '1 day', now(), ${operator})`,
        sql`insert into account_invitations ${base}, blocked_at, blocked_reason) values (${org}, 'treasurer', ${fx.email("b2")}, ${person}, ${"b".repeat(64)}, ${operator}, now() + interval '1 day', now(), 'has_holders')`,
        sql`insert into account_invitations ${base}, revoked_at, revoked_by_user_id) values (${org}, 'treasurer', ${fx.email("b3")}, ${person}, ${"c".repeat(64)}, ${operator}, now() + interval '1 day', now(), ${operator})`,
        sql`insert into account_invitations ${base}, superseded_at) values (${org}, 'treasurer', ${fx.email("b4")}, ${person}, ${"d".repeat(64)}, ${operator}, now() + interval '1 day', now())`,
      ];
      for (const v of variants) {
        await expectRaise(q(v), /created open/);
      }
    });

    it("a founding-administrator row cannot name its person at insert", async () => {
      const org = await fx.makeOrg("faperson");
      const person = await fx.makePerson("Early", "Person");
      await fx.addMember(org, person);
      await expectRaise(
        fx.insertInvitation({ organizationId: org, purpose: "founding_administrator", email: fx.email("fp"), createdByUserId: operator, personId: person }),
        /names its person only at acceptance/,
      );
    });

    it("the accept and blocked transitions are refused WITHOUT the marker, even for the owner", async () => {
      const s = await trScene();
      await expectRaise(
        q(sql`update account_invitations set accepted_at = now(), accepted_user_id = ${operator} where id = ${s.id}`),
        /accepted only through presby_accept_invitation/,
      );
      await expectRaise(
        q(sql`update account_invitations set blocked_at = now(), blocked_reason = 'has_holders' where id = ${s.id}`),
        /blocked only through presby_accept_invitation/,
      );
      // Positive control: WITH the marker (the definer's own idiom) the owner
      // path can - which is why only presby_accept_invitation arms it.
      await fx.platform.transaction(async (tx) => {
        await tx.execute(sql`select set_config('presby.invitation_accept_active', 'true', true)`);
        await tx.execute(sql`update account_invitations set blocked_at = now(), blocked_reason = 'has_holders' where id = ${s.id}`);
        tx.rollback();
      }).catch((err: unknown) => {
        if (!String((err as Error).message).includes("Rollback")) throw err;
      });
      expect((await fx.invitation(s.id)).blocked_at).toBeNull();
    });

    it("identity columns are immutable on an open row", async () => {
      const s = await trScene();
      const edits: SQL[] = [
        sql`update account_invitations set token_hash = ${"e".repeat(64)} where id = ${s.id}`,
        sql`update account_invitations set expires_at = expires_at + interval '1 day' where id = ${s.id}`,
        sql`update account_invitations set email_normalized = ${fx.email("other")} where id = ${s.id}`,
        sql`update account_invitations set purpose = 'founding_administrator', invitee_first_name = 'A', invitee_last_name = 'B' where id = ${s.id}`,
        sql`update account_invitations set created_by_user_id = ${operator}, created_at = created_at - interval '1 minute' where id = ${s.id}`,
        sql`update account_invitations set email_queue_id = gen_random_uuid() where id = ${s.id}`,
        sql`update account_invitations set person_id = null where id = ${s.id}`,
      ];
      for (const e of edits) {
        await expectRaise(q(e), /42501|insufficient_privilege|one legal transition/);
      }
    });

    it("revoke is an owner-path transition; afterwards the row is frozen except for redaction", async () => {
      const s = await trScene();
      await q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${operator} where id = ${s.id}`);
      await expectRaise(q(sql`update account_invitations set revoked_at = null, revoked_by_user_id = null where id = ${s.id}`), /is finished/);
      await expectRaise(q(sql`update account_invitations set superseded_at = now() where id = ${s.id}`), /is finished|23514/);
      await q(sql`update account_invitations set email_normalized = null, redacted_at = now() where id = ${s.id}`);
      const row = await fx.invitation(s.id);
      expect(row.email_normalized).toBeNull();
      expect(row.redacted_at).not.toBeNull();
      await expectRaise(q(sql`update account_invitations set redacted_at = now() + interval '1 day' where id = ${s.id}`), /is finished/);
    });

    it("an OPEN row cannot be redacted", async () => {
      const s = await trScene();
      await expectRaise(
        q(sql`update account_invitations set email_normalized = null, redacted_at = now() where id = ${s.id}`),
        /one legal transition|23514|redacted_terminal/,
      );
    });

    it("delete is refused while the organization exists, and the teardown cascade passes", async () => {
      const s = await trScene();
      await expectRaise(q(sql`delete from account_invitations where id = ${s.id}`), /permanent/);
      // A bare org (no derived group): a founding-administrator row needs no membership.
      const bare = await fx.makeBareOrg("cascade");
      const inv = await fx.insertInvitation({ organizationId: bare, purpose: "founding_administrator", email: fx.email("casc"), createdByUserId: operator });
      await q(sql`delete from organizations where id = ${bare}`);
      expect(await q(sql`select id from account_invitations where id = ${inv.id}`)).toHaveLength(0);
    });

    it("one open designation per (org, purpose) regardless of address (D-2); an expired-open row still blocks; a revoked one does not", async () => {
      const s = await faScene();
      await expectRaise(
        fx.insertInvitation({ organizationId: s.org, purpose: "founding_administrator", email: fx.email("second"), createdByUserId: operator }),
        /account_invitations_open_designation_uq|account_invitations_open_address_uq/,
      );
      // The same address too (both open-row indexes cover it; either may report).
      await expectRaise(
        fx.insertInvitation({ organizationId: s.org, purpose: "founding_administrator", email: s.address, createdByUserId: operator }),
        /account_invitations_open_(designation|address)_uq/,
      );
      // A treasurer invitation at the same org is a different purpose.
      const person = await fx.makePerson("Other", "Purpose");
      await fx.addMember(s.org, person);
      await fx.insertInvitation({ organizationId: s.org, purpose: "treasurer", email: fx.email("tp"), createdByUserId: operator, personId: person });

      const org2 = await fx.makeOrg("expired-blocks");
      await fx.insertInvitation({
        organizationId: org2, purpose: "founding_administrator", email: fx.email("old"), createdByUserId: operator,
        createdAt: sql`now() - interval '10 days'`, expiresAt: sql`now() - interval '3 days'`,
      });
      await expectRaise(
        fx.insertInvitation({ organizationId: org2, purpose: "founding_administrator", email: fx.email("new"), createdByUserId: operator }),
        /account_invitations_open_designation_uq/,
      );
      await q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${operator}
                   where organization_id = ${org2} and revoked_at is null`);
      await fx.insertInvitation({ organizationId: org2, purpose: "founding_administrator", email: fx.email("new2"), createdByUserId: operator });
    });

    it("CHECKs: expiry window, token shape, email shape, names by purpose", async () => {
      const org = await fx.makeOrg("checks");
      await expectRaise(
        fx.insertInvitation({ organizationId: org, purpose: "founding_administrator", email: fx.email("x"), createdByUserId: operator, expiresAt: sql`now() + interval '31 days'` }),
        /account_invitations_expiry_window/,
      );
      await expectRaise(
        q(sql`insert into account_invitations (organization_id, purpose, email_normalized, invitee_first_name, invitee_last_name, token_hash, created_by_user_id, expires_at)
              values (${org}, 'founding_administrator', ${fx.email("y")}, 'A', 'B', 'NOTHEX', ${operator}, now() + interval '1 day')`),
        /account_invitations_token_hash_shape/,
      );
      await expectRaise(
        fx.insertInvitation({ organizationId: org, purpose: "founding_administrator", email: "Mixed.Case@example.invalid", createdByUserId: operator }),
        /account_invitations_email_shape/,
      );
      await expectRaise(
        fx.insertInvitation({ organizationId: org, purpose: "founding_administrator", email: fx.email("n"), createdByUserId: operator, firstName: null }),
        /account_invitations_names_by_purpose/,
      );
    });
  });

  // =========================================================================
  // The resend chain (addendum D-1)
  // =========================================================================
  describe("resend chain (D-1)", () => {
    async function resend(parentId: string, overrides: { email?: string; resendCount?: number; supersede?: boolean } = {}) {
      const [p] = await q(sql`select * from account_invitations where id = ${parentId}`);
      if (overrides.supersede !== false) {
        await q(sql`update account_invitations set superseded_at = now() where id = ${parentId} and superseded_at is null`);
      }
      return fx.insertInvitation({
        organizationId: String(p!.organization_id),
        purpose: p!.purpose as "treasurer",
        email: overrides.email ?? String(p!.email_normalized),
        createdByUserId: operator,
        personId: (p!.person_id as string | null) ?? null,
        firstName: (p!.invitee_first_name as string | null) ?? null,
        lastName: (p!.invitee_last_name as string | null) ?? null,
        resentFromId: parentId,
        resendCount: overrides.resendCount ?? Number(p!.resend_count) + 1,
      });
    }

    it("a resend must follow a SUPERSEDED parent with the same address and resend_count = parent + 1", async () => {
      const s = await trScene();
      await expectRaise(resend(s.id, { supersede: false }), /resend must follow|open_(designation|address)_uq/);
      await q(sql`update account_invitations set superseded_at = now() where id = ${s.id}`);
      await expectRaise(resend(s.id, { supersede: false, resendCount: 2 }), /resend must follow/);
      await expectRaise(resend(s.id, { supersede: false, email: fx.email("diff") }), /resend must follow/);
      const ok = await resend(s.id, { supersede: false });
      expect((await fx.invitation(ok.id)).resend_count).toBe(1);
    });

    it("a superseded row has at most one successor (account_invitations_resent_from_uq)", async () => {
      const s = await trScene();
      const first = await resend(s.id);
      await q(sql`update account_invitations set superseded_at = now() where id = ${first.id}`);
      await expectRaise(resend(s.id, { supersede: false, resendCount: 1 }), /account_invitations_resent_from_uq/);
    });

    it("the cap: a sixth resend is refused by the CHECK", async () => {
      const s = await faScene();
      let current = s.id;
      for (let i = 0; i < 5; i += 1) current = (await resend(current)).id;
      expect((await fx.invitation(current)).resend_count).toBe(5);
      await expectRaise(resend(current), /account_invitations_resend_count_range/);
    });

    it("chain consistency over a real chain: every parent superseded, same purpose and address, count = parent + 1, and exactly one successor per superseded row", async () => {
      const s = await trScene();
      let current = s.id;
      for (let i = 0; i < 3; i += 1) current = (await resend(current)).id;
      const bad = await q(sql`
        select c.id
          from account_invitations c
          join account_invitations p on p.id = c.resent_from_id
         where c.organization_id = ${s.org}
           and (p.superseded_at is null or p.purpose <> c.purpose
                or p.email_normalized is distinct from c.email_normalized
                or c.resend_count <> p.resend_count + 1 or p.organization_id <> c.organization_id)`);
      expect(bad).toHaveLength(0);
      const orphans = await q(sql`
        select p.id, (select count(*) from account_invitations c where c.resent_from_id = p.id)::int as successors
          from account_invitations p
         where p.organization_id = ${s.org} and p.superseded_at is not null`);
      expect(orphans.length).toBe(3);
      for (const o of orphans) expect(o.successors).toBe(1);
      // The new head is live, every ancestor is dead.
      const heads = await q(sql`select id from account_invitations where organization_id = ${s.org} and superseded_at is null`);
      expect(heads.map((h) => h.id)).toEqual([current]);
    });
  });

  // =========================================================================
  // Single sources
  // =========================================================================
  describe("single sources", () => {
    it("presby_founding_administrator_permission_keys() equals foundingAdministratorPlan() for EVERY organization_type in the catalog", async () => {
      const { foundingAdministratorPlan } = await import("@/lib/onboarding/founding-administrator");
      const types = await q(sql`select unnest(enum_range(null::organization_type))::text as t`);
      expect(types.length).toBeGreaterThanOrEqual(5);
      for (const { t } of types) {
        const [r] = await q(sql`select presby_founding_administrator_permission_keys(${t}) as keys`);
        expect({ t, keys: r!.keys }).toEqual({
          t,
          keys: foundingAdministratorPlan(t as Parameters<typeof foundingAdministratorPlan>[0]).administration.permissionKeys,
        });
      }
    });

    it("the SQL holder counts across holder shapes pin the lifted asymmetry; the TypeScript counts are thin wrappers over them since Batch 2d (so agreement is by construction)", async () => {
      const { countFoundingAdministratorHolders } = await import("@/lib/onboarding/founding-administrator");
      const { countGivingManageHolders } = await import("@/lib/onboarding/treasurer-designation");
      const org = await fx.makeOrg("counts");
      const check = async () => {
        const [r] = await q(sql`select presby_founding_administrator_holder_count(${org}) as fa,
                                       presby_giving_manage_holder_count(${org}) as gm`);
        expect(r).toEqual({
          fa: await countFoundingAdministratorHolders(fx.platform, org),
          gm: await countGivingManageHolders(fx.platform, org),
        });
        return r!;
      };
      expect(await check()).toEqual({ fa: 0, gm: 0 });
      const a = await fx.makePerson("Holder", "Alpha");
      await fx.enroll(org, a, ["roles.manage"]);
      const b = await fx.makePerson("Holder", "Beta");
      await fx.enroll(org, b, ["giving.manage"]);
      expect(await check()).toEqual({ fa: 1, gm: 1 });
      // An ended membership: still an FA holder (TS has no membership join),
      // no longer a giving holder (membership-aware) - pinned as lifted.
      await q(sql`update role_grants set ends_on = current_date where organization_id = ${org} and person_id = ${b}`);
      await q(sql`update memberships set ended_on = current_date where organization_id = ${org} and person_id = ${b}`);
      expect(await check()).toEqual({ fa: 1, gm: 0 });
    });
  });

  // =========================================================================
  // Preview
  // =========================================================================
  describe("preview", () => {
    it("a live founding-administrator invitation: masked address, names, session_matches null without a session", async () => {
      const s = await faScene();
      const rows = await fx.preview(s.token);
      expect(rows).toHaveLength(1);
      const r = rows[0]!;
      expect(r.purpose).toBe("founding_administrator");
      expect(r.organization_type).toBe("congregation");
      expect(r.invitee_first_name).toBe("Marisol");
      expect(r.person_display_name).toBe("Marisol Quenby");
      expect(r.session_matches).toBeNull();
      const [local, domain] = s.address.split("@");
      expect(r.masked_email).toBe(`${local![0]}***@${domain}`);
      expect(JSON.stringify(r)).not.toContain(s.address);
    });

    it("session_matches: true for the invited account (case-insensitively), false for another", async () => {
      const s = await faScene();
      const mixed = await fx.makeUser(s.address.replace(/^./, (c) => c.toUpperCase()));
      const other = await fx.makeUser(fx.email("other"));
      expect((await fx.preview(s.token, mixed))[0]!.session_matches).toBe(true);
      expect((await fx.preview(s.token, other))[0]!.session_matches).toBe(false);
    });

    it("treasurer: the roster name; founding administrator: the single on-file match at the org", async () => {
      const t = await trScene();
      expect((await fx.preview(t.token))[0]!.person_display_name).toBe("Odalys Pennick");
      const s = await faScene();
      const p = await fx.makePerson("Rosamund", "Tilbury");
      await fx.addMember(s.org, p);
      await fx.addEmail(p, `  ${s.address.toUpperCase()} `);
      expect((await fx.preview(s.token))[0]!.person_display_name).toBe("Rosamund Tilbury");
    });

    it("every non-live state is ZERO rows (unknown, empty, null, the hash itself, expired, revoked, superseded, accepted, blocked)", async () => {
      const expired = await fx.insertInvitation({
        organizationId: await fx.makeOrg("pv-exp"), purpose: "founding_administrator", email: fx.email("exp"), createdByUserId: operator,
        createdAt: sql`now() - interval '9 days'`, expiresAt: sql`now() - interval '2 days'`,
      });
      const revoked = await faScene();
      await q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${operator} where id = ${revoked.id}`);
      const superseded = await faScene();
      await q(sql`update account_invitations set superseded_at = now() where id = ${superseded.id}`);
      const accepted = await faScene();
      expect((await fx.accept(accepted.token, newAccount())).outcome).toBe("accepted");
      const blocked = await faScene({ type: "congregation" });
      const holder = await fx.makePerson("Existing", "Holder");
      await fx.enroll(blocked.org, holder, ["roles.manage"]);
      expect((await fx.accept(blocked.token, newAccount())).outcome).toBe("blocked");
      const live = await faScene();

      const tokens: Array<[string, string | null]> = [
        ["unknown", "x".repeat(43)],
        ["empty", ""],
        ["null", null],
        ["the stored hash (R5)", live.tokenHash],
        ["expired", expired.token],
        ["revoked", revoked.token],
        ["superseded", superseded.token],
        ["accepted", accepted.token],
        ["blocked", blocked.token],
      ];
      for (const [label, token] of tokens) {
        expect({ label, rows: await fx.preview(token) }).toEqual({ label, rows: [] });
      }
      expect(await fx.preview(live.token)).toHaveLength(1);
    });

    it("preview writes nothing", async () => {
      const s = await faScene();
      const before = await fx.snapshot(s.org, s.address);
      const inv = await fx.invitation(s.id);
      await fx.preview(s.token);
      await fx.preview(s.token);
      expect(await fx.snapshot(s.org, s.address)).toEqual(before);
      expect(await fx.invitation(s.id)).toEqual(inv);
    });
  });

  // =========================================================================
  // Accept: the dead bucket and the raw-token property
  // =========================================================================
  describe("accept: one dead bucket", () => {
    it("every dead state returns ONE identical row shape: outcome 'dead', every other column null", async () => {
      const revoked = await faScene();
      await q(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${operator} where id = ${revoked.id}`);
      const expired = await fx.insertInvitation({
        organizationId: await fx.makeOrg("dead-exp"), purpose: "founding_administrator", email: fx.email("dexp"), createdByUserId: operator,
        createdAt: sql`now() - interval '9 days'`, expiresAt: sql`now() - interval '1 day'`,
      });
      const live = await faScene();
      const shapes = [];
      for (const token of ["nope", "", null, live.tokenHash, revoked.token, expired.token]) {
        shapes.push(await fx.accept(token, newAccount()));
        shapes.push(await fx.accept(token, { userId: operator }));
      }
      const keys = Object.keys(shapes[0]!).sort();
      for (const s of shapes) {
        expect(Object.keys(s).sort()).toEqual(keys);
        const { outcome, ...rest } = s;
        expect(outcome).toBe("dead");
        expect(Object.values(rest).every((v) => v === null)).toBe(true);
      }
      // The live row was never touched by being named by its hash.
      expect((await fx.invitation(live.id)).accepted_at).toBeNull();
    });

    it("exactly one of p_user_id / p_password_hash is a programmer error, not an outcome", async () => {
      const s = await faScene();
      await expectRaise(fx.accept(s.token, {}), /exactly one of p_user_id and p_password_hash/);
      await expectRaise(fx.accept(s.token, { userId: operator, passwordHash: FAKE_BCRYPT }), /exactly one/);
      await expectRaise(fx.accept(s.token, { passwordHash: "plaintext", firstName: "A", lastName: "B" }), /not a bcrypt hash/);
      await expectRaise(fx.accept(s.token, { passwordHash: FAKE_BCRYPT, firstName: " ", lastName: "B" }), /first and last name/);
      expect((await fx.invitation(s.id)).accepted_at).toBeNull();
    });
  });

  // =========================================================================
  // Accept: each outcome per {new, existing} x {founding administrator, treasurer}
  // =========================================================================
  describe("accept: accepted", () => {
    it("new account x founding administrator: account, person, staff membership, bundle + office grants, claim", async () => {
      const s = await faScene();
      const r = await fx.accept(s.token, newAccount("Marisol", "Quenby"));
      expect(r).toMatchObject({
        outcome: "accepted", blocked_reason: null, invitation_id: s.id, organization_id: s.org,
        purpose: "founding_administrator", mode: "new_account", person_mode: "created_person",
        created_by_user_id: operator, inviter_is_invitee: false,
        administration_role_key: "founding_administrator", office_role_key: "congregation_stated_clerk",
      });
      const [u] = await q(sql`select email, email_verified is not null as verified, name, password, two_factor_required from users where id = ${String(r.user_id)}`);
      expect(u).toEqual({ email: s.address, verified: true, name: "Marisol Quenby", password: FAKE_BCRYPT, two_factor_required: true });
      const [p] = await q(sql`select first_name, last_name, user_id from people where id = ${String(r.person_id)}`);
      expect(p).toEqual({ first_name: "Marisol", last_name: "Quenby", user_id: r.user_id });
      const [m] = await q(sql`select engagement_status, current_roll, ended_on from memberships where person_id = ${String(r.person_id)} and organization_id = ${s.org}`);
      expect(m).toEqual({ engagement_status: "staff", current_roll: null, ended_on: null });
      const grants = await q(sql`
        select r.key, g.granted_by, g.grant_reason from role_grants g join app_roles r on r.id = g.role_id
         where g.organization_id = ${s.org} and g.person_id = ${String(r.person_id)} order by r.key`);
      expect(grants).toEqual([
        { key: "congregation_stated_clerk", granted_by: operator, grant_reason: "founding administrator designation" },
        { key: "founding_administrator", granted_by: operator, grant_reason: "founding administrator designation" },
      ]);
      const inv = await fx.invitation(s.id);
      expect(inv.accepted_at).not.toBeNull();
      expect(inv.accepted_user_id).toBe(r.user_id);
      expect(inv.person_id).toBe(r.person_id);
      const [hc] = await q(sql`select presby_founding_administrator_holder_count(${s.org}) as n`);
      expect(hc!.n).toBe(1);
      // Single use.
      expect(await fx.preview(s.token)).toHaveLength(0);
      expect((await fx.accept(s.token, newAccount())).outcome).toBe("dead");
    });

    it("new account x treasurer: links the roster person, verifies the on-file address, grants treasurer, mints giving_recorder ungranted", async () => {
      const s = await trScene();
      const r = await fx.accept(s.token, newAccount("Odalys", "Pennick"));
      expect(r).toMatchObject({ outcome: "accepted", mode: "new_account", person_mode: "linked_person", person_id: s.person, purpose: "treasurer", administration_role_key: "treasurer" });
      expect(r.treasurer_role_id).not.toBeNull();
      // The union of both templates' keys, in byte order (the TS .sort()).
      const tpl = await q(sql`
        select distinct p.permission_key as k from app_role_permissions p join app_roles t on t.id = p.role_id
         where t.organization_id is null and t.key in ('treasurer', 'giving_recorder')`);
      expect(r.permission_keys).toEqual(tpl.map((x) => String(x.k)).sort());
      const [p] = await q(sql`select user_id from people where id = ${s.person}`);
      expect(p!.user_id).toBe(r.user_id);
      const [cm] = await q(sql`select verified_at is not null as v from contact_methods where person_id = ${s.person}`);
      expect(cm!.v).toBe(true);
      const roles = await q(sql`
        select r.key, (select count(*) from role_grants g where g.role_id = r.id)::int as grants
          from app_roles r where r.organization_id = ${s.org} and r.key in ('treasurer', 'giving_recorder') order by r.key`);
      expect(roles).toEqual([{ key: "giving_recorder", grants: 0 }, { key: "treasurer", grants: 1 }]);
      const [gm] = await q(sql`select presby_giving_manage_holder_count(${s.org}) as n`);
      expect(gm!.n).toBe(1);
    });

    it("existing account (MIXED-CASE email) x founding administrator: the account is verified case-insensitively, a person is created", async () => {
      const s = await faScene();
      const user = await fx.makeUser(s.address.toUpperCase());
      const r = await fx.accept(s.token, { userId: user });
      expect(r).toMatchObject({ outcome: "accepted", mode: "existing_account", user_id: user, person_mode: "created_person", inviter_is_invitee: false });
      const [n] = await q(sql`select count(*)::int as n from users where lower(email) = ${s.address}`);
      expect(n!.n).toBe(1);
    });

    it("existing account x treasurer: an already-linked roster person is reused", async () => {
      const s = await trScene();
      const user = await fx.makeUser(s.address);
      await fx.linkUser(s.person, user);
      const r = await fx.accept(s.token, { userId: user });
      expect(r).toMatchObject({ outcome: "accepted", mode: "existing_account", person_mode: "existing_person", person_id: s.person });
    });

    it("existing account x founding administrator: the account's own person at this org is reused (no second person)", async () => {
      const s = await faScene();
      const user = await fx.makeUser(s.address);
      const p = await fx.makePerson("Already", "Here");
      await fx.addMember(s.org, p);
      await fx.linkUser(p, user);
      const r = await fx.accept(s.token, { userId: user });
      expect(r).toMatchObject({ outcome: "accepted", person_mode: "existing_person", person_id: p });
      const [n] = await q(sql`select count(*)::int as n from people where user_id = ${user}`);
      expect(n!.n).toBe(1);
    });

    it("founding administrator, address on file at the org: the roster person is LINKED, not duplicated (G3)", async () => {
      const s = await faScene();
      const p = await fx.makePerson("Rosamund", "Tilbury");
      await fx.addMember(s.org, p);
      await fx.addEmail(p, s.address);
      const r = await fx.accept(s.token, newAccount());
      expect(r).toMatchObject({ outcome: "accepted", person_mode: "linked_person", person_id: p });
      const [m] = await q(sql`select engagement_status from memberships where person_id = ${p} and organization_id = ${s.org}`);
      expect(m!.engagement_status).toBe("regular");
    });

    it("presbytery: the presbytery bundle and presbytery_stated_clerk; synod: no office half", async () => {
      const pr = await faScene({ type: "presbytery" });
      const r1 = await fx.accept(pr.token, newAccount());
      expect(r1.office_role_key).toBe("presbytery_stated_clerk");
      expect(r1.permission_keys as string[]).toContain("congregation_oversight.manage");
      const sy = await faScene({ type: "synod" });
      const r2 = await fx.accept(sy.token, newAccount());
      expect(r2).toMatchObject({ outcome: "accepted", office_role_key: null });
      expect(r2.permission_keys as string[]).not.toContain("congregation_oversight.manage");
    });

    it("self-acceptance is permitted and reported (operator's R9 reversal): inviter_is_invitee = true", async () => {
      const address = fx.email("self");
      const self = await fx.makeUser(address);
      const s = await faScene({ email: address, createdBy: self });
      const r = await fx.accept(s.token, { userId: self });
      expect(r).toMatchObject({ outcome: "accepted", user_id: self, created_by_user_id: self, inviter_is_invitee: true });
    });
  });

  // =========================================================================
  // Accept: non-terminal outcomes write NOTHING and leave the token live
  // =========================================================================
  describe("accept: non-terminal outcomes", () => {
    async function expectNothingWritten(s: { id: string; org: string; address: string; token: string }, run: () => Promise<Row>, outcome: string) {
      const before = await fx.snapshot(s.org, s.address);
      const inv = await fx.invitation(s.id);
      const r = await run();
      expect(r.outcome).toBe(outcome);
      expect(r.invitation_id).toBeNull();
      expect(await fx.snapshot(s.org, s.address)).toEqual(before);
      expect(await fx.invitation(s.id)).toEqual(inv);
      expect(await fx.preview(s.token)).toHaveLength(1);
    }

    it("account_exists: new mode when an account with the address exists (exact case)", async () => {
      const s = await faScene();
      await fx.makeUser(s.address);
      await expectNothingWritten(s, () => fx.accept(s.token, newAccount()), "account_exists");
    });

    it("account_exists: a MIXED-CASE existing account blocks a second account for the lowercase address (addendum contradiction 2)", async () => {
      const s = await trScene();
      const mixed = s.address.replace(/^(.)(.)/, (_m, a: string, b: string) => `${a.toUpperCase()}${b.toUpperCase()}`);
      expect(mixed).not.toBe(s.address);
      await fx.makeUser(mixed);
      await expectNothingWritten(s, () => fx.accept(s.token, newAccount()), "account_exists");
      const [n] = await q(sql`select count(*)::int as n from users where lower(email) = ${s.address}`);
      expect(n!.n).toBe(1);
    });

    it("email_mismatch: another account, and a user id that does not exist", async () => {
      const s = await faScene();
      const other = await fx.makeUser(fx.email("someone-else"));
      await expectNothingWritten(s, () => fx.accept(s.token, { userId: other }), "email_mismatch");
      await expectNothingWritten(s, () => fx.accept(s.token, { userId: "00000000-0000-0000-0000-00000000dead" }), "email_mismatch");
    });

    it("account_inactive", async () => {
      const s = await faScene();
      const user = await fx.makeUser(s.address, { isActive: false });
      await expectNothingWritten(s, () => fx.accept(s.token, { userId: user }), "account_inactive");
    });
  });

  // =========================================================================
  // Accept: each blocked reason at step 4 (gate refusals, nothing written)
  // =========================================================================
  describe("accept: blocked at the gates (step 4)", () => {
    it("has_holders (founding administrator)", async () => {
      const s = await faScene();
      const h = await fx.makePerson("Current", "Admin");
      await fx.enroll(s.org, h, ["role_grants.manage"]);
      const before = await fx.snapshot(s.org, s.address);
      const r = await fx.accept(s.token, newAccount());
      expect(r).toMatchObject({ outcome: "blocked", blocked_reason: "has_holders", invitation_id: s.id, user_id: null, mode: "new_account" });
      await expectBlocked(s.id, s.token, "has_holders", before, s.org, s.address);
    });

    it("has_holders (treasurer), existing mode reports the account as user_id", async () => {
      const s = await trScene();
      const h = await fx.makePerson("Current", "Treasurer");
      await fx.enroll(s.org, h, ["giving.manage"]);
      const user = await fx.makeUser(s.address);
      const before = await fx.snapshot(s.org, s.address);
      const r = await fx.accept(s.token, { userId: user });
      expect(r).toMatchObject({ outcome: "blocked", blocked_reason: "has_holders", user_id: user, mode: "existing_account" });
      await expectBlocked(s.id, s.token, "has_holders", before, s.org, s.address);
    });

    it("not_applicable (treasurer at a presbytery)", async () => {
      const s = await trScene({ type: "presbytery" });
      const before = await fx.snapshot(s.org, s.address);
      expect((await fx.accept(s.token, newAccount())).blocked_reason).toBe("not_applicable");
      await expectBlocked(s.id, s.token, "not_applicable", before, s.org, s.address);
    });

    it("provisioning_incomplete (founding administrator at an org with no derived Active Membership group)", async () => {
      const org = await fx.makeBareOrg("noprov");
      const address = fx.email("noprov");
      const inv = await fx.insertInvitation({ organizationId: org, purpose: "founding_administrator", email: address, createdByUserId: operator });
      const before = await fx.snapshot(org, address);
      expect((await fx.accept(inv.token, newAccount())).blocked_reason).toBe("provisioning_incomplete");
      await expectBlocked(inv.id, inv.token, "provisioning_incomplete", before, org, address);
    });

    it("provisioning_incomplete (treasurer with a missing template) - owner path, rolled back", async () => {
      const s = await trScene();
      let outcome: Row | null = null;
      await fx.platform.transaction(async (tx) => {
        await tx.execute(sql`update app_roles set key = 'giving_recorder__hidden' where key = 'giving_recorder' and organization_id is null`);
        const r = await tx.execute(sql`select * from presby_accept_invitation(${s.token}, null, ${FAKE_BCRYPT}, 'A', 'B')`);
        outcome = ((r as unknown as { rows: Row[] }).rows ?? [])[0]!;
        tx.rollback();
      }).catch((err: unknown) => {
        if (!String((err as Error).message).includes("Rollback")) throw err;
      });
      expect(outcome).toMatchObject({ outcome: "blocked", blocked_reason: "provisioning_incomplete" });
      const [t] = await q(sql`select count(*)::int as n from app_roles where key = 'giving_recorder' and organization_id is null`);
      expect(t!.n).toBe(1);
    });

    it("person_merged (treasurer)", async () => {
      const s = await trScene();
      const survivor = await fx.makePerson("Odalys", "Survivor");
      await q(sql`update people set merged_into_id = ${survivor} where id = ${s.person}`);
      const before = await fx.snapshot(s.org, s.address);
      expect((await fx.accept(s.token, newAccount())).blocked_reason).toBe("person_merged");
      await expectBlocked(s.id, s.token, "person_merged", before, s.org, s.address);
      await q(sql`update people set merged_into_id = null where id = ${s.person}`);
    });

    it("membership_ended (treasurer)", async () => {
      const s = await trScene();
      await q(sql`update memberships set ended_on = current_date - 1 where person_id = ${s.person} and organization_id = ${s.org}`);
      const before = await fx.snapshot(s.org, s.address);
      expect((await fx.accept(s.token, newAccount())).blocked_reason).toBe("membership_ended");
      await expectBlocked(s.id, s.token, "membership_ended", before, s.org, s.address);
    });

    it("membership_ended (founding administrator, the account's own person ended here)", async () => {
      const s = await faScene();
      const user = await fx.makeUser(s.address);
      const p = await fx.makePerson("Former", "Member");
      await fx.addMember(s.org, p);
      await fx.linkUser(p, user);
      await q(sql`update memberships set ended_on = current_date - 1 where person_id = ${p}`);
      const before = await fx.snapshot(s.org, s.address);
      expect((await fx.accept(s.token, { userId: user })).blocked_reason).toBe("membership_ended");
      await expectBlocked(s.id, s.token, "membership_ended", before, s.org, s.address);
    });

    it("membership_ended (founding administrator, the on-file match ended here)", async () => {
      const s = await faScene();
      const p = await fx.makePerson("Former", "Match");
      await fx.addMember(s.org, p);
      await fx.addEmail(p, s.address);
      await q(sql`update memberships set ended_on = current_date - 1 where person_id = ${p}`);
      const before = await fx.snapshot(s.org, s.address);
      expect((await fx.accept(s.token, newAccount())).blocked_reason).toBe("membership_ended");
      await expectBlocked(s.id, s.token, "membership_ended", before, s.org, s.address);
    });

    it("person_linked_elsewhere (treasurer: the roster person belongs to another account)", async () => {
      const s = await trScene();
      const someone = await fx.makeUser(fx.email("owner-of-person"));
      await fx.linkUser(s.person, someone);
      const before = await fx.snapshot(s.org, s.address);
      expect((await fx.accept(s.token, newAccount())).blocked_reason).toBe("person_linked_elsewhere");
      await expectBlocked(s.id, s.token, "person_linked_elsewhere", before, s.org, s.address);
    });

    it("person_linked_elsewhere (founding administrator: the on-file match belongs to another account)", async () => {
      const s = await faScene();
      const p = await fx.makePerson("Linked", "Match");
      await fx.addMember(s.org, p);
      await fx.addEmail(p, s.address);
      await fx.linkUser(p, await fx.makeUser(fx.email("someone")));
      const before = await fx.snapshot(s.org, s.address);
      expect((await fx.accept(s.token, newAccount())).blocked_reason).toBe("person_linked_elsewhere");
      await expectBlocked(s.id, s.token, "person_linked_elsewhere", before, s.org, s.address);
    });

    it("person_elsewhere (founding administrator: the account's person belongs to another organization)", async () => {
      const s = await faScene();
      const elsewhere = await fx.makeOrg("elsewhere");
      const user = await fx.makeUser(s.address);
      const p = await fx.makePerson("Elsewhere", "Person");
      await fx.addMember(elsewhere, p);
      await fx.linkUser(p, user);
      const before = await fx.snapshot(s.org, s.address);
      expect((await fx.accept(s.token, { userId: user })).blocked_reason).toBe("person_elsewhere");
      await expectBlocked(s.id, s.token, "person_elsewhere", before, s.org, s.address);
    });

    it("person_elsewhere (treasurer: the account is already a different person at another organization)", async () => {
      const s = await trScene();
      const elsewhere = await fx.makeOrg("elsewhere-tr");
      const user = await fx.makeUser(s.address);
      const p = await fx.makePerson("Elsewhere", "Treasurer");
      await fx.addMember(elsewhere, p);
      await fx.linkUser(p, user);
      const before = await fx.snapshot(s.org, s.address);
      expect((await fx.accept(s.token, { userId: user })).blocked_reason).toBe("person_elsewhere");
      await expectBlocked(s.id, s.token, "person_elsewhere", before, s.org, s.address);
    });

    it("ambiguous_person (founding administrator: two people at the org share the address)", async () => {
      const s = await faScene();
      for (const last of ["One", "Two"]) {
        const p = await fx.makePerson("Shared", last);
        await fx.addMember(s.org, p);
        await fx.addEmail(p, s.address);
      }
      const before = await fx.snapshot(s.org, s.address);
      expect((await fx.accept(s.token, newAccount())).blocked_reason).toBe("ambiguous_person");
      await expectBlocked(s.id, s.token, "ambiguous_person", before, s.org, s.address);
    });

    it("ambiguous_person (treasurer: the account is already a different person at THIS organization)", async () => {
      const s = await trScene();
      const user = await fx.makeUser(s.address);
      const dup = await fx.makePerson("Odalys", "Duplicate");
      await fx.addMember(s.org, dup);
      await fx.linkUser(dup, user);
      const before = await fx.snapshot(s.org, s.address);
      expect((await fx.accept(s.token, { userId: user })).blocked_reason).toBe("ambiguous_person");
      await expectBlocked(s.id, s.token, "ambiguous_person", before, s.org, s.address);
    });
  });

  // =========================================================================
  // Accept: the exception mapping (D-5.2), each arm through the REAL guard
  // =========================================================================
  describe("accept: late refusals through the real guards (D-5)", () => {
    it("memberships_guard_insert (42501) -> blocked person_elsewhere, and blocked_at is COMMITTED with nothing else (D-5.1)", async () => {
      const s = await faScene();
      const other = await fx.makeOrg("late-elsewhere");
      const before = await fx.snapshot(s.org, s.address);
      const r = await acceptInjected(s.token, newAccount(), { mode: "person_elsewhere", otherOrg: other });
      expect(r).toMatchObject({ outcome: "blocked", blocked_reason: "person_elsewhere", user_id: null });
      // Read back on a DIFFERENT connection after the presby_app commit: the
      // outer block re-armed the marker, so the blocked update survived.
      const [committed] = await q(sql`select blocked_at is not null as b, blocked_reason from account_invitations where id = ${s.id}`);
      expect(committed).toEqual({ b: true, blocked_reason: "person_elsewhere" });
      // The subtransaction's account, person and memberships are all gone.
      await expectBlocked(s.id, s.token, "person_elsewhere", before, s.org, s.address);
      expect(await q(sql`select id from memberships where organization_id = ${other}`)).toHaveLength(0);
    });

    it("role_grants_needs_membership (23514) -> blocked membership_ended", async () => {
      const s = await trScene();
      const before = await fx.snapshot(s.org, s.address);
      const r = await acceptInjected(s.token, newAccount(), { mode: "membership_ended", org: s.org, ref: s.person });
      expect(r).toMatchObject({ outcome: "blocked", blocked_reason: "membership_ended" });
      await expectBlocked(s.id, s.token, "membership_ended", before, s.org, s.address);
    });

    it("memberships_sync_derived_group (23503) -> blocked provisioning_incomplete; the group is restored with the rollback", async () => {
      const s = await faScene();
      const before = await fx.snapshot(s.org, s.address);
      const r = await acceptInjected(s.token, newAccount(), { mode: "provisioning_incomplete", org: s.org });
      expect(r).toMatchObject({ outcome: "blocked", blocked_reason: "provisioning_incomplete" });
      await expectBlocked(s.id, s.token, "provisioning_incomplete", before, s.org, s.address);
    });

    it("an apply helper's own gate (P0001 'apply refused') -> blocked has_holders", async () => {
      const s = await faScene();
      const rival = await fx.makePerson("Rival", "Holder");
      await fx.addMember(s.org, rival);
      const role = await fx.makeRole(s.org, "fx_rival_roles_manage", ["roles.manage"]);
      const before = await fx.snapshot(s.org, s.address);
      const r = await acceptInjected(s.token, newAccount(), { mode: "has_holders", org: s.org, ref: rival, ref2: role });
      expect(r).toMatchObject({ outcome: "blocked", blocked_reason: "has_holders" });
      await expectBlocked(s.id, s.token, "has_holders", before, s.org, s.address);
    });

    it("users_email_unique (23505) -> account_exists, NON-terminal: nothing written, the token stays live", async () => {
      const s = await faScene();
      const inv = await fx.invitation(s.id);
      const r = await acceptInjected(s.token, newAccount(), { mode: "account_exists_race" });
      expect(r.outcome).toBe("account_exists");
      expect(await fx.invitation(s.id)).toEqual(inv);
      // The race winner was inserted inside the rolled-back subtransaction too.
      const [n] = await q(sql`select count(*)::int as n from users where lower(email) = ${s.address}`);
      expect(n!.n).toBe(0);
      expect(await fx.preview(s.token)).toHaveLength(1);
    });

    it("ANY OTHER unique_violation re-raises (never 'account_exists'): the call fails and nothing is written", async () => {
      const s = await faScene();
      const before = await fx.snapshot(s.org, s.address);
      const inv = await fx.invitation(s.id);
      await expectRaise(acceptInjected(s.token, newAccount(), { mode: "other_unique" }), /unrelated unique violation|app_roles_org_key/);
      expect(await fx.invitation(s.id)).toEqual(inv);
      expect(await fx.snapshot(s.org, s.address)).toEqual(before);
    });

    it("an insufficient_privilege with any other message re-raises", async () => {
      const s = await faScene();
      const inv = await fx.invitation(s.id);
      await expectRaise(acceptInjected(s.token, newAccount(), { mode: "other_privilege" }), /unrelated refusal/);
      expect(await fx.invitation(s.id)).toEqual(inv);
    });
  });

  // =========================================================================
  // Concurrency and lock order
  // =========================================================================
  describe("concurrency", () => {
    it("two parallel acceptances of one token: exactly one winner, the other is dead", async () => {
      const s = await faScene();
      const results = await Promise.all([
        fx.accept(s.token, newAccount("First", "Racer")),
        fx.accept(s.token, newAccount("Second", "Racer")),
      ]);
      const outcomes = results.map((r) => r.outcome).sort();
      expect(outcomes).toEqual(["accepted", "dead"]);
      const [n] = await q(sql`select count(*)::int as n from users where lower(email) = ${s.address}`);
      expect(n!.n).toBe(1);
    });

    it("accept vs revoke: a revoke holding the org lock wins, the waiting accept re-validates to dead", async () => {
      const s = await faScene();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const revoke = fx.platform.transaction(async (tx) => {
        await tx.execute(sql`select id from organizations where id = ${s.org} for update`);
        await tx.execute(sql`update account_invitations set revoked_at = now(), revoked_by_user_id = ${operator} where id = ${s.id}`);
        await gate;
      });
      await new Promise((r) => setTimeout(r, 300));
      const acceptP = fx.accept(s.token, newAccount());
      await new Promise((r) => setTimeout(r, 500));
      release();
      await revoke;
      expect((await acceptP).outcome).toBe("dead");
    });

    it("accept vs resend: the old token is dead once the resend commits, the new one accepts", async () => {
      const s = await trScene();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const fresh = (await import("@/lib/testing/invitation-fixture")).mintToken();
      const resend = fx.platform.transaction(async (tx) => {
        await tx.execute(sql`select id from organizations where id = ${s.org} for update`);
        await tx.execute(sql`update account_invitations set superseded_at = now() where id = ${s.id}`);
        await tx.execute(sql`
          insert into account_invitations (organization_id, purpose, email_normalized, person_id, token_hash, created_by_user_id, expires_at, resent_from_id, resend_count)
          values (${s.org}, 'treasurer', ${s.address}, ${s.person}, ${fresh.tokenHash}, ${operator}, now() + interval '7 days', ${s.id}, 1)`);
        await gate;
      });
      await new Promise((r) => setTimeout(r, 300));
      const oldAccept = fx.accept(s.token, newAccount());
      await new Promise((r) => setTimeout(r, 500));
      release();
      await resend;
      expect((await oldAccept).outcome).toBe("dead");
      expect((await fx.accept(fresh.token, newAccount())).outcome).toBe("accepted");
    });

    it("a resend/accept loop on one org never deadlocks (lock order org -> invitation -> users -> person)", async () => {
      const s = await faScene();
      let currentId = s.id;
      let currentToken = s.token;
      const { mintToken } = await import("@/lib/testing/invitation-fixture");
      for (let round = 0; round < 3; round += 1) {
        const next = mintToken();
        const parent = currentId;
        const resendP = fx.platform.transaction(async (tx) => {
          await tx.execute(sql`select id from organizations where id = ${s.org} for update`);
          const [p] = ((await tx.execute(sql`select * from account_invitations where id = ${parent} for update`)) as unknown as { rows: Row[] }).rows;
          if (p!.accepted_at || p!.superseded_at || p!.blocked_at || p!.revoked_at) return null;
          await tx.execute(sql`update account_invitations set superseded_at = now() where id = ${parent}`);
          const ins = await tx.execute(sql`
            insert into account_invitations (organization_id, purpose, email_normalized, invitee_first_name, invitee_last_name, token_hash, created_by_user_id, expires_at, resent_from_id, resend_count)
            values (${s.org}, 'founding_administrator', ${s.address}, 'Marisol', 'Quenby', ${next.tokenHash}, ${operator}, now() + interval '7 days', ${parent}, ${Number(p!.resend_count) + 1})
            returning id`);
          return String(((ins as unknown as { rows: Row[] }).rows)[0]!.id);
        });
        const acceptP = fx.accept(currentToken, { userId: operator });
        const [newId, accepted] = await Promise.all([resendP, acceptP]);
        // email_mismatch (operator's address is not the invited one) or dead -
        // never a deadlock (40P01) or any other error.
        expect(["email_mismatch", "dead"]).toContain(accepted.outcome);
        if (newId) {
          currentId = newId;
          currentToken = next.token;
        }
      }
      const live = await fx.preview(currentToken);
      expect(live).toHaveLength(1);
    });
  });
});
