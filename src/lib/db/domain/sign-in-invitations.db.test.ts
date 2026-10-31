/**
 * drizzle/0065_presby_sign_in_and_connect.sql sections 5, 6, 8 and 9 against a
 * real database: the sign-in invitation vocabulary, shape CHECKs, indexes and
 * insert guard (R28, R33, R34, F197), the user-link guard (F186, A1), the
 * auto-connect toggle seed (R47) and the audit index. Community Increment 2b,
 * Batch A1, the A1 part of Test Plan T-4 (docs/work-log/2026-10-22-founding-
 * admin-directory.md, "Phase 3 amendment 2" sections 5.1, 5.3, 5.5 and 8.3;
 * Phase 3 Test Plan 1.1 and 1.3).
 *
 * Batch A2 extends this file with the issue / resend / revoke definers, the
 * reader and the sign-in acceptance cases (R27 both directions, E1's race in
 * the accept core). Nothing here calls a function A2 adds.
 *
 * Two connections: the owner (`getPlatformDb()`) writes invitation rows (no
 * application role holds a privilege on account_invitations) and fixtures;
 * `presby_app` (`db`) proves what the application connection cannot do.
 * Everything that must not persist runs inside a rolled-back transaction.
 *
 * Fixtures: synthetic names, `example.invalid` addresses (No Real Data);
 * organizations and people are stamped `deletable_until` at insert.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/sign-in-invitations.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import type { InvitationFixture, Row } from "@/lib/testing/invitation-fixture";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const MIGRATION_PATH = path.join(process.cwd(), "drizzle", "0065_presby_sign_in_and_connect.sql");
const LINK_REFUSED = /people: user_id is bound only on the owner path, by invitation acceptance or by sign-in connection/;
const SIGN_IN_RESEND_REFUSED = /a sign-in resend must follow a superseded sign-in invitation of the same organization, origin and person/;
const RESEND_REFUSED = /a resend must follow a superseded invitation of the same organization, purpose and address/;

interface Tx {
  execute(query: SQL): Promise<unknown>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
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
function pgText(err: unknown): string {
  return chain(err)
    .map((e) => {
      const x = e as { message?: unknown; constraint?: unknown };
      return `${String(x.message ?? e)} ${String(x.constraint ?? "")}`;
    })
    .join(" :: ");
}
function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

/** The text of one numbered section of 0065 (`-- N. title` to the next). */
function migrationSection(n: number): string {
  const text = readFileSync(MIGRATION_PATH, "utf8");
  const start = text.search(new RegExp(`^-- ${n}\\. `, "m"));
  const end = text.search(new RegExp(`^-- ${n + 1}\\. `, "m"));
  if (start < 0 || end < 0) throw new Error(`section ${n} not found in 0065`);
  return text.slice(start, end);
}

const HASH = (n: number) => n.toString(16).padStart(64, "0");

describe.skipIf(!hasDb)("drizzle/0065 sign-in invitations and the user-link guard, A1 (Postgres-backed)", () => {
  let fx: InvitationFixture;
  let org: string;
  let otherOrg: string;
  let hashSeq = Math.floor(Math.random() * 1e9);

  async function q(query: SQL): Promise<Row[]> {
    return fx.q(query);
  }

  async function member(org_: string, first = "Wendeline"): Promise<string> {
    const p = await fx.makePerson(first, `Ashgrove${Math.floor(Math.random() * 1e6)}`);
    await fx.addMember(org_, p);
    return p;
  }

  interface SignInRow {
    organizationId?: string;
    personId: string | null;
    email?: string;
    purpose?: string;
    origin?: string;
    firstName?: string | null;
    lastName?: string | null;
    resentFromId?: string | null;
    resendCount?: number;
  }

  /** An invitation insert (defaults: a sign_in row from the organization). */
  function insertSql(r: SignInRow): SQL {
    hashSeq += 1;
    return sql`
      insert into account_invitations (organization_id, purpose, origin, email_normalized,
             invitee_first_name, invitee_last_name, person_id, token_hash, created_by_user_id,
             expires_at, resent_from_id, resend_count)
      values (${r.organizationId ?? org}, ${r.purpose ?? "sign_in"}, ${r.origin ?? "org"},
              ${r.email ?? fx.email("si")}, ${r.firstName ?? null}, ${r.lastName ?? null},
              ${r.personId}, ${HASH(hashSeq)}, ${fx.actingUserId}, now() + interval '7 days',
              ${r.resentFromId ?? null}, ${r.resendCount ?? 0})
      returning id`;
  }

  async function inRolledBackOwnerTx(fn: (tx: Tx) => Promise<void>): Promise<void> {
    try {
      await fx.platform.transaction(async (tx) => {
        await fn(tx as unknown as Tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  async function inRolledBackAppTx(orgId: string | null, fn: (tx: Tx) => Promise<void>): Promise<void> {
    try {
      await fx.appDb.transaction(async (tx) => {
        if (orgId) await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
        await fn(tx as unknown as Tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  async function rejected(tx: Tx, query: SQL): Promise<{ code?: string; text: string }> {
    let caught: unknown;
    try {
      await tx.transaction(async (sp) => {
        await sp.execute(query);
      });
    } catch (err) {
      caught = err;
    }
    if (!caught) throw new Error("expected the statement to be rejected");
    return { code: pgCode(caught), text: pgText(caught) };
  }

  async function id(tx: Tx, query: SQL): Promise<string> {
    return String(rowsOf(await tx.execute(query))[0]!.id);
  }

  /** A throwaway non-owner role with DML on people and BYPASSRLS (so its UPDATE reaches the row). */
  async function becomeThrowawayRole(tx: Tx): Promise<void> {
    const role = `presby_t65p_${Math.floor(Math.random() * 1e9)}`;
    await tx.execute(sql.raw(`create role ${role} nologin bypassrls`));
    await tx.execute(sql.raw(`grant ${role} to current_user with set true`));
    await tx.execute(sql.raw(`grant select, insert, update on people to ${role}`));
    await tx.execute(sql.raw(`set local role ${role}`));
  }

  beforeAll(async () => {
    const { createInvitationFixture } = await import("@/lib/testing/invitation-fixture");
    fx = await createInvitationFixture("si65");
    org = await fx.makeOrg("a");
    otherOrg = await fx.makeOrg("b");
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  // ===========================================================================
  // Structure (section 5)
  // ===========================================================================
  describe("structure", () => {
    it("the widened and new CHECKs, as the catalog spells them", async () => {
      const rows = await q(sql`
        select conname, pg_get_constraintdef(oid) as def, convalidated from pg_constraint
         where conrelid = 'account_invitations'::regclass
           and conname in ('account_invitations_purpose_allowed', 'account_invitations_origin_allowed',
                           'account_invitations_purpose_origin_tie', 'account_invitations_names_by_purpose',
                           'account_invitations_sign_in_has_person', 'account_invitations_blocked_reason_allowed')
         order by conname`);
      const byName = Object.fromEntries(rows.map((r) => [String(r.conname), String(r.def)]));
      expect(rows.every((r) => r.convalidated === true)).toBe(true);
      expect(Object.keys(byName)).toHaveLength(6);
      expect(byName.account_invitations_purpose_allowed).toContain("'sign_in'::text");
      expect(byName.account_invitations_origin_allowed).toContain("'org'::text");
      expect(byName.account_invitations_purpose_origin_tie).toBe(
        "CHECK (((purpose = 'sign_in'::text) = (origin = 'org'::text)))",
      );
      expect(byName.account_invitations_sign_in_has_person).toBe(
        "CHECK (((purpose <> 'sign_in'::text) OR (person_id IS NOT NULL)))",
      );
      expect(byName.account_invitations_names_by_purpose).toContain("(purpose <> 'sign_in'::text)");
      expect(byName.account_invitations_blocked_reason_allowed).toContain("'person_deceased'::text");
    });

    it("the three indexes 0065 owns, with their predicates (open_address_uq excludes sign_in; no expiry term)", async () => {
      const rows = await q(sql`
        select indexname, indexdef from pg_indexes
         where tablename = 'account_invitations'
           and indexname in ('account_invitations_open_address_uq', 'account_invitations_open_sign_in_person_uq',
                             'account_invitations_person_created_ix')
         order by indexname`);
      expect(rows).toEqual([
        {
          indexname: "account_invitations_open_address_uq",
          indexdef:
            "CREATE UNIQUE INDEX account_invitations_open_address_uq ON public.account_invitations USING btree (organization_id, purpose, email_normalized) WHERE ((purpose <> 'sign_in'::text) AND (accepted_at IS NULL) AND (revoked_at IS NULL) AND (superseded_at IS NULL) AND (blocked_at IS NULL))",
        },
        {
          indexname: "account_invitations_open_sign_in_person_uq",
          indexdef:
            "CREATE UNIQUE INDEX account_invitations_open_sign_in_person_uq ON public.account_invitations USING btree (organization_id, person_id) WHERE ((purpose = 'sign_in'::text) AND (accepted_at IS NULL) AND (revoked_at IS NULL) AND (superseded_at IS NULL) AND (blocked_at IS NULL))",
        },
        {
          indexname: "account_invitations_person_created_ix",
          indexdef:
            "CREATE INDEX account_invitations_person_created_ix ON public.account_invitations USING btree (person_id, created_at DESC) WHERE (person_id IS NOT NULL)",
        },
      ]);
    });

    it("presby_app still holds no privilege on account_invitations", async () => {
      const [r] = await q(sql`
        select has_table_privilege('presby_app', 'account_invitations', 'select') as s,
               has_table_privilege('presby_app', 'account_invitations', 'insert') as i,
               has_table_privilege('presby_app', 'account_invitations', 'update') as u,
               has_table_privilege('presby_app', 'account_invitations', 'delete') as d`);
      expect(r).toEqual({ s: false, i: false, u: false, d: false });
    });
  });

  // ===========================================================================
  // Vocabulary and shape (section 5)
  // ===========================================================================
  describe("vocabulary and shape", () => {
    it("a sign_in row from the organization, naming its person and no invitee names, is accepted", async () => {
      const p = await member(org);
      await inRolledBackOwnerTx(async (tx) => {
        const rid = await id(tx, insertSql({ personId: p }));
        const [r] = rowsOf(await tx.execute(sql`select purpose, origin, person_id::text as p from account_invitations where id = ${rid}`));
        expect(r).toEqual({ purpose: "sign_in", origin: "org", p });
      });
    });

    it("the purpose/origin tie refuses sign_in from the platform and a designation from the organization", async () => {
      const p = await member(org);
      await inRolledBackOwnerTx(async (tx) => {
        const a = await rejected(tx, insertSql({ personId: p, origin: "platform" }));
        expect(a.code).toBe("23514");
        expect(a.text).toContain("account_invitations_purpose_origin_tie");
        const b = await rejected(tx, insertSql({ personId: p, purpose: "treasurer", origin: "org" }));
        expect(b.code).toBe("23514");
        expect(b.text).toContain("account_invitations_purpose_origin_tie");
      });
    });

    it("sign_in carries no invitee names; unknown purposes and origins are refused", async () => {
      const p = await member(org);
      await inRolledBackOwnerTx(async (tx) => {
        const a = await rejected(tx, insertSql({ personId: p, firstName: "Named", lastName: "Person" }));
        expect(a.code).toBe("23514");
        expect(a.text).toContain("account_invitations_names_by_purpose");
        const b = await rejected(tx, insertSql({ personId: p, purpose: "deacon" }));
        expect(b.code).toBe("23514");
        expect(b.text).toContain("account_invitations_purpose_allowed");
        const c = await rejected(tx, insertSql({ personId: p, purpose: "treasurer", origin: "presbytery" }));
        expect(c.code).toBe("23514");
        expect(c.text).toContain("account_invitations_origin_allowed");
      });
    });

    it("a sign_in row with no person is refused (the insert guard fires before the CHECK)", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        const r = await rejected(tx, insertSql({ personId: null }));
        expect(r.code).toBe("42501");
        expect(r.text).toMatch(/a sign-in invitation names its person when it is created/);
      });
    });

    it("the person must be a member of the inviting organization (the 0059 composite FK still binds sign_in)", async () => {
      const elsewhere = await member(otherOrg);
      await inRolledBackOwnerTx(async (tx) => {
        const r = await rejected(tx, insertSql({ personId: elsewhere }));
        expect(r.code).toBe("23503");
        expect(r.text).toContain("account_invitations_person_membership_fk");
      });
    });

    it("blocked_reason admits person_deceased (through the accept marker) and still refuses an unknown reason", async () => {
      const p = await member(org);
      await inRolledBackOwnerTx(async (tx) => {
        const rid = await id(tx, insertSql({ personId: p }));
        await tx.execute(sql`select set_config('presby.invitation_accept_active', 'true', true)`);
        const bad = await rejected(tx, sql`
          update account_invitations set blocked_at = now(), blocked_reason = 'person_vanished' where id = ${rid}`);
        expect(bad.code).toBe("23514");
        expect(bad.text).toContain("account_invitations_blocked_reason_allowed");
        await tx.execute(sql`
          update account_invitations set blocked_at = now(), blocked_reason = 'person_deceased' where id = ${rid}`);
      });
    });
  });

  // ===========================================================================
  // Indexes (section 5): R28 and the per-person open row
  // ===========================================================================
  describe("open-row uniqueness", () => {
    it("one open sign_in row per (organization, person); a superseded one does not block a successor", async () => {
      const p = await member(org);
      await inRolledBackOwnerTx(async (tx) => {
        const first = await id(tx, insertSql({ personId: p }));
        const dup = await rejected(tx, insertSql({ personId: p }));
        expect(dup.code).toBe("23505");
        expect(dup.text).toContain("account_invitations_open_sign_in_person_uq");
        await tx.execute(sql`update account_invitations set superseded_at = now() where id = ${first}`);
        await id(tx, insertSql({ personId: p, resentFromId: first, resendCount: 1 }));
      });
    });

    it("an expired open row still blocks (no expiry term in the predicate)", async () => {
      const p = await member(org);
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`
          insert into account_invitations (organization_id, purpose, origin, email_normalized, person_id,
                 token_hash, created_by_user_id, created_at, expires_at)
          values (${org}, 'sign_in', 'org', ${fx.email("exp")}, ${p}, ${HASH(++hashSeq)}, ${fx.actingUserId},
                  now() - interval '10 days', now() - interval '3 days')`);
        const dup = await rejected(tx, insertSql({ personId: p }));
        expect(dup.text).toContain("account_invitations_open_sign_in_person_uq");
      });
    });

    it("R28: two open sign_in rows to one shared address for two different people are allowed", async () => {
      const p1 = await member(org, "Hester");
      const p2 = await member(org, "Hollis");
      const shared = fx.email("shared");
      await inRolledBackOwnerTx(async (tx) => {
        await id(tx, insertSql({ personId: p1, email: shared }));
        await id(tx, insertSql({ personId: p2, email: shared }));
      });
    });

    it("address uniqueness still binds every other purpose (a second open treasurer row to one address)", async () => {
      // open_designation_uq fires first for two treasurer rows at one org; drop it inside the
      // rolled-back transaction so the re-predicated open_address_uq is what refuses.
      const p = await member(org);
      const address = fx.email("treas");
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`drop index account_invitations_open_designation_uq`);
        await id(tx, insertSql({ personId: p, purpose: "treasurer", origin: "platform", email: address }));
        const dup = await rejected(tx, insertSql({ personId: p, purpose: "treasurer", origin: "platform", email: address }));
        expect(dup.code).toBe("23505");
        expect(dup.text).toContain("account_invitations_open_address_uq");
      });
    });
  });

  // ===========================================================================
  // Insert guard (section 5): R33 / F197 resend lineage
  // ===========================================================================
  describe("resend lineage", () => {
    it("R33: a sign_in resend may change the address (re-read from the record), with resend_count = parent + 1", async () => {
      const p = await member(org);
      await inRolledBackOwnerTx(async (tx) => {
        const parent = await id(tx, insertSql({ personId: p, email: fx.email("old") }));
        await tx.execute(sql`update account_invitations set superseded_at = now() where id = ${parent}`);
        await id(tx, insertSql({ personId: p, email: fx.email("corrected"), resentFromId: parent, resendCount: 1 }));
      });
    });

    it("a sign_in resend that changes the person, skips a count or follows an open parent is refused", async () => {
      const p = await member(org);
      const other = await member(org, "Isolde");
      await inRolledBackOwnerTx(async (tx) => {
        const parent = await id(tx, insertSql({ personId: p }));
        const open = await rejected(tx, insertSql({ personId: p, resentFromId: parent, resendCount: 1 }));
        expect(open.code).toBe("42501");
        expect(open.text).toMatch(SIGN_IN_RESEND_REFUSED);
        await tx.execute(sql`update account_invitations set superseded_at = now() where id = ${parent}`);
        const person = await rejected(tx, insertSql({ personId: other, resentFromId: parent, resendCount: 1 }));
        expect(person.text).toMatch(SIGN_IN_RESEND_REFUSED);
        const count = await rejected(tx, insertSql({ personId: p, resentFromId: parent, resendCount: 2 }));
        expect(count.text).toMatch(SIGN_IN_RESEND_REFUSED);
      });
    });

    it("every other purpose keeps the address comparison verbatim (a treasurer resend to a new address is refused)", async () => {
      const p = await member(org);
      await inRolledBackOwnerTx(async (tx) => {
        const parent = await id(tx, insertSql({ personId: p, purpose: "treasurer", origin: "platform", email: fx.email("t-old") }));
        await tx.execute(sql`update account_invitations set superseded_at = now() where id = ${parent}`);
        const r = await rejected(tx, insertSql({
          personId: p, purpose: "treasurer", origin: "platform", email: fx.email("t-new"), resentFromId: parent, resendCount: 1,
        }));
        expect(r.code).toBe("42501");
        expect(r.text).toMatch(RESEND_REFUSED);
      });
    });
  });

  // ===========================================================================
  // F186: people_guard_user_link (section 6)
  // ===========================================================================
  describe("F186 people_guard_user_link", () => {
    it("is a BEFORE INSERT OR UPDATE OF user_id row trigger, enabled", async () => {
      const [t] = await q(sql`
        select tgenabled, pg_get_triggerdef(oid) as def from pg_trigger
         where tgrelid = 'people'::regclass and tgname = 'people_guard_user_link'`);
      expect(t!.tgenabled).toBe("O");
      expect(String(t!.def)).toMatch(
        /BEFORE INSERT OR UPDATE OF user_id ON public\.people FOR EACH ROW EXECUTE FUNCTION presby_guard_people_user_link\(\)/,
      );
    });

    it("presby_app: linking, re-linking and unlinking are refused with the literal (42501)", async () => {
      const p = await member(org);
      const linked = await member(org, "Linked");
      const u1 = await fx.makeUser(fx.email("u1"));
      const u2 = await fx.makeUser(fx.email("u2"));
      await fx.linkUser(linked, u1); // owner path
      await inRolledBackAppTx(org, async (tx) => {
        for (const stmt of [
          sql`update people set user_id = ${u2} where id = ${p}`,
          sql`update people set user_id = ${u2} where id = ${linked}`,
          sql`update people set user_id = null where id = ${linked}`,
        ]) {
          const r = await rejected(tx, stmt);
          expect(r.code).toBe("42501");
          expect(r.text).toMatch(LINK_REFUSED);
        }
      });
    });

    it("presby_app: an insert carrying a user_id is refused; one without, and an update that leaves user_id alone, pass", async () => {
      const p = await member(org);
      const u = await fx.makeUser(fx.email("ins"));
      await inRolledBackAppTx(org, async (tx) => {
        const r = await rejected(tx, sql`
          insert into people (first_name, last_name, user_id) values ('Gideon', 'Fallow', ${u})`);
        expect(r.code).toBe("42501");
        expect(r.text).toMatch(LINK_REFUSED);
        await tx.execute(sql`insert into people (first_name, last_name) values ('Gideon', 'Fallow')`);
        await tx.execute(sql`update people set preferred_name = 'Gid' where id = ${p}`);
        // naming user_id with its current value is not a transition
        await tx.execute(sql`update people set user_id = user_id where id = ${p}`);
      });
    });

    it("a second non-owner role is refused the same way (A1: deny by default, no role named)", async () => {
      const p = await member(org);
      const u = await fx.makeUser(fx.email("2nd"));
      await inRolledBackOwnerTx(async (tx) => {
        await becomeThrowawayRole(tx);
        const r = await rejected(tx, sql`update people set user_id = ${u} where id = ${p}`);
        expect(r.code).toBe("42501");
        expect(r.text).toMatch(LINK_REFUSED);
        const i = await rejected(tx, sql`insert into people (first_name, last_name, user_id) values ('Tamsin', 'Reed', ${u})`);
        expect(i.code).toBe("42501");
        expect(i.text).toMatch(LINK_REFUSED);
      });
    });

    it("the owner path is NOT bound (the recorded paper residual; fixtures and definers rely on it)", async () => {
      const p = await member(org);
      const u = await fx.makeUser(fx.email("own"));
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`update people set user_id = ${u} where id = ${p}`);
        await tx.execute(sql`update people set user_id = null where id = ${p}`);
      });
    });

    it("deleting a user as presby_app still nulls people.user_id (the FK SET NULL action runs as the owner)", async () => {
      const p = await member(org);
      const u = await fx.makeUser(fx.email("del"));
      await fx.linkUser(p, u);
      await inRolledBackAppTx(org, async (tx) => {
        await tx.execute(sql`delete from users where id = ${u}`);
        const [r] = rowsOf(await tx.execute(sql`select user_id from people where id = ${p}`));
        expect(r!.user_id).toBeNull();
      });
      // rolled back: still linked
      const [after] = await q(sql`select user_id::text as u from people where id = ${p}`);
      expect(after!.u).toBe(u);
    });
  });

  // ===========================================================================
  // Sections 8 and 9: the toggle seed and the audit index
  // ===========================================================================
  describe("toggle seed (R47) and audit index", () => {
    it("organizations created by raw SQL (the e2e and Vitest fixtures) have no toggle row: auto-connect is off there", async () => {
      const fixtureRows = await q(sql`
        select 1 from organization_feature_toggles
         where organization_id in (${org}, ${otherOrg}) and feature_key = 'org_portal.sign_in_connect'`);
      expect(fixtureRows).toHaveLength(0);
    });

    it("section 8 gives every organization the row, on, and never switches back on one that is off", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`
          insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
          values (${org}, 'org_portal.sign_in_connect', false, null)`);
        await tx.execute(sql.raw(migrationSection(8)));
        const [all] = rowsOf(await tx.execute(sql`
          select count(*)::int as orgs, count(t.organization_id)::int as with_row
            from organizations o
            left join organization_feature_toggles t
              on t.organization_id = o.id and t.feature_key = 'org_portal.sign_in_connect'`));
        expect(all!.with_row).toBe(all!.orgs);
        const rows = rowsOf(await tx.execute(sql`
          select organization_id::text as o, enabled, updated_by from organization_feature_toggles
           where organization_id in (${org}, ${otherOrg}) and feature_key = 'org_portal.sign_in_connect'`));
        const byOrg = Object.fromEntries(rows.map((r) => [String(r.o), r]));
        expect(byOrg[org]!.enabled).toBe(false);
        expect(byOrg[otherOrg]!.enabled).toBe(true);
        expect(byOrg[otherOrg]!.updated_by).toBeNull();
        // a second run inserts nothing
        await tx.execute(sql.raw(migrationSection(8)));
        const [again] = rowsOf(await tx.execute(sql`
          select count(*)::int as n from organization_feature_toggles where feature_key = 'org_portal.sign_in_connect'`));
        expect(again!.n).toBe(all!.orgs);
      });
    });

    it("audit_events_sign_in_connected_ix is partial on the connect action", async () => {
      const [ix] = await q(sql`select indexdef from pg_indexes where indexname = 'audit_events_sign_in_connected_ix'`);
      expect(String(ix!.indexdef)).toBe(
        "CREATE INDEX audit_events_sign_in_connected_ix ON public.audit_events USING btree (((metadata ->> 'organizationId'::text)), ((metadata ->> 'personId'::text))) WHERE (action = 'tenant.person.sign_in_connected'::text)",
      );
    });
  });

  // ===========================================================================
  // Idempotence
  // ===========================================================================
  describe("idempotence", () => {
    it("the whole file applies twice more with no error inside a rolled-back transaction, changing no row", async () => {
      const text = readFileSync(MIGRATION_PATH, "utf8");
      const digest = sql`
        select (select md5(coalesce(string_agg(t::text, '|' order by id), '')) from users t) as users,
               (select md5(coalesce(string_agg(t::text, '|' order by id), '')) from account_invitations t) as inv,
               (select md5(coalesce(string_agg(t::text, '|' order by id), '')) from people t) as people,
               (select md5(coalesce(string_agg(t::text, '|' order by id), '')) from contact_methods t) as cm,
               (select md5(coalesce(string_agg(t::text, '|' order by organization_id, feature_key), ''))
                  from organization_feature_toggles t) as toggles`;
      await inRolledBackOwnerTx(async (tx) => {
        const [before] = rowsOf(await tx.execute(digest));
        await tx.execute(sql.raw(text));
        const [mid] = rowsOf(await tx.execute(digest));
        // The first re-apply may only seed toggle rows for organizations created since the
        // real apply (this suite's raw-SQL fixtures); every other table is untouched.
        expect({ ...mid, toggles: null }).toEqual({ ...before, toggles: null });
        await tx.execute(sql.raw(text));
        const [after] = rowsOf(await tx.execute(digest));
        expect(after).toEqual(mid);
      });
    });
  });
});

// =============================================================================
// Batch A2: issue, resend, revoke, the reader and card standing (drizzle/0065
// section 12; Phase 3 Test Plan 1.1 and 1.5 as amended by Phase 3 amendment 2
// sections 5.8 and 8.3 T-4). Through the presby_app connection with the
// organization context set, exactly as org-invite.ts will call them.
// =============================================================================
describe.skipIf(!hasDb)("drizzle/0065 sign-in invitation callables, A2 (Postgres-backed)", () => {
  const DENY = /account_invitations: this sign-in invitation action is not permitted/;
  let s: import("@/lib/testing/sign-in-fixture").SignInFixture;
  let org: string;
  let other: string;
  let admin: { userId: string; personId: string; email: string };

  async function refusal(p: Promise<unknown>): Promise<{ code?: string; text: string }> {
    try {
      await p;
    } catch (err) {
      return { code: pgCode(err), text: pgText(err) };
    }
    throw new Error("expected a refusal");
  }

  const UUID = /^[0-9a-f-]{36}$/;
  /** Seed `n` already-revoked org-origin rows (owner path) so the limits count them. */
  async function seedRows(n: number, r: { org: string; person: string; address: string; createdBy: string; createdAt?: string; purpose?: string }) {
    for (const v of [r.org, r.person, r.createdBy]) if (!UUID.test(v)) throw new Error("bad uuid");
    if (!/^[a-z0-9.@+-]+$/.test(r.address)) throw new Error("bad address");
    const platform = r.purpose === "founding_administrator";
    const created = r.createdAt ? `'${r.createdAt}'::timestamptz` : "now() - interval '1 hour'";
    await s.q(sql.raw(`
      do $do$
      declare v uuid;
      begin
        for i in 1..${n} loop
          insert into account_invitations (organization_id, purpose, origin, email_normalized, person_id,
                 invitee_first_name, invitee_last_name, token_hash, created_by_user_id, created_at, expires_at)
          values ('${r.org}', '${platform ? "founding_administrator" : "sign_in"}', '${platform ? "platform" : "org"}',
                  '${r.address}', ${platform ? "null" : `'${r.person}'`}, ${platform ? "'Seed', 'Row'" : "null, null"},
                  md5(random()::text) || md5(random()::text), '${r.createdBy}', ${created}, ${created} + interval '7 days')
          returning id into v;
          update account_invitations set revoked_at = now(), revoked_by_user_id = '${r.createdBy}' where id = v;
        end loop;
      end $do$`));
  }

  beforeAll(async () => {
    const { createSignInFixture } = await import("@/lib/testing/sign-in-fixture");
    s = await createSignInFixture("is65");
    org = await s.congregation("a");
    other = await s.congregation("b");
    admin = await s.sender(org, ["people.manage", "officers.manage", "directory.view", "events.view"]);
  });

  afterAll(async () => {
    if (s) await s.cleanup();
  });

  // ---------------------------------------------------------------------------
  // identity: one literal, 42501, for every callable
  // ---------------------------------------------------------------------------
  describe("identity refusals raise the one literal (42501)", () => {
    it.each(["issue", "resend", "revoke", "states", "card"] as const)("%s", async (fn) => {
      const p = await s.person(org);
      const noManage = await s.sender(org, ["directory.view"]);
      const merged = await s.sender(org, ["people.manage"]);
      await s.merge(merged.personId);
      const ended = await s.sender(org, ["people.manage"]);
      // A membership cannot end over an open position (presby_guard_membership_end): end the grant first.
      await s.q(sql`update role_grants set ends_on = current_date where person_id = ${ended.personId} and organization_id = ${org}`);
      await s.q(sql`update memberships set ended_on = current_date where person_id = ${ended.personId} and organization_id = ${org}`);
      const foreign = await s.sender(other, ["people.manage", "officers.manage"]);
      const call = (o: string | null, actor: string | null) => {
        switch (fn) {
          case "issue": return s.issue(o, actor, p.id, { confirmed: p.email });
          case "resend": return s.resend(o, actor, p.id, { confirmed: p.email });
          case "revoke": return s.revoke(o, actor, p.id);
          case "states": return s.states(o, actor, [p.id]);
          case "card": return s.card(o, actor, p.id);
        }
      };
      const before = await s.footprint(org);
      for (const [label, o, actor] of [
        ["no organization context", null, admin.userId],
        ["a null actor", org, null],
        ["an actor without people.manage", org, noManage.userId],
        ["a merged actor", org, merged.userId],
        ["an actor whose membership ended", org, ended.userId],
        ["an actor from another organization", org, foreign.userId],
      ] as const) {
        const r = await refusal(call(o, actor));
        expect(r.code, `${fn}: ${label}`).toBe("42501");
        expect(r.text, `${fn}: ${label}`).toMatch(DENY);
      }
      expect(await s.footprint(org)).toEqual(before);
    });
  });

  // ---------------------------------------------------------------------------
  // issue
  // ---------------------------------------------------------------------------
  describe("issue", () => {
    it("ok: the row's shape and what the email needs", async () => {
      const p = await s.person(org, { first: "Ignatius" });
      await s.q(sql`update people set preferred_name = 'Iggy' where id = ${p.id}`);
      const [q] = await s.q(sql`insert into email_queue (to_email, subject, html_body, template_key, status)
                                 values (${p.email}, 'Fixture', '<p>fixture</p>', 'account_sign_in_invitation', 'queued') returning id`);
      const hash = (await import("@/lib/testing/invitation-fixture")).mintToken().tokenHash;
      const r = await s.issue(org, admin.userId, p.id, { confirmed: p.email, tokenHash: hash, queueId: String(q!.id) });
      const [o] = await s.q(sql`select name from organizations where id = ${org}`);
      const [sender] = await s.q(sql`select first_name || ' ' || last_name as n from people where id = ${admin.personId}`);
      expect(r).toMatchObject({
        outcome: "ok", address: p.email, recipient_first_name: "Iggy", organization_name: o!.name,
        sender_name: sender!.n, ack_reasons: [], existing_invitation_expired: false,
      });
      const row = await s.invitation(String(r.invitation_id));
      expect(row).toMatchObject({
        organization_id: org, purpose: "sign_in", origin: "org", email_normalized: p.email, person_id: p.id,
        token_hash: hash, created_by_user_id: admin.userId, email_queue_id: q!.id, resend_count: 0,
        invitee_first_name: null, invitee_last_name: null, accepted_at: null,
      });
      expect(new Date(String(r.invitation_expires_at)).getTime()).toBe(new Date(String(row.expires_at)).getTime());
      await s.q(sql`delete from email_queue where id = ${q!.id}`);
    });

    it("the confirmed address is compared case- and space-insensitively", async () => {
      const p = await s.person(org);
      expect((await s.issue(org, admin.userId, p.id, { confirmed: `  ${p.email!.toUpperCase()} ` })).outcome).toBe("ok");
    });

    it("a person under 18 with an address of their own is invitable (no age gate)", async () => {
      const p = await s.person(org);
      await s.q(sql`update people set date_of_birth = current_date - interval '12 years' where id = ${p.id}`);
      expect((await s.issue(org, admin.userId, p.id, { confirmed: p.email })).outcome).toBe("ok");
    });

    it("every refusal writes nothing", async () => {
      const cases: Array<[string, () => Promise<{ id: string | null; confirmed: string | null }>]> = [
        ["not_found", async () => ({ id: "00000000-0000-4000-8000-000000000065", confirmed: "x@example.invalid" })],
        ["not_found", async () => { const p = await s.person(other); return { id: p.id, confirmed: p.email }; }],
        ["not_found", async () => ({ id: null, confirmed: "x@example.invalid" })],
        ["already_signs_in", async () => { const p = await s.person(org); await s.linkUser(p.id, await s.user(s.email("x"))); return { id: p.id, confirmed: p.email }; }],
        ["already_signs_in", async () => ({ id: admin.personId, confirmed: admin.email })],
        ["no_email_on_file", async () => { const p = await s.person(org, { email: false }); return { id: p.id, confirmed: "x@example.invalid" }; }],
        ["address_changed", async () => { const p = await s.person(org); return { id: p.id, confirmed: s.email("typo") }; }],
        ["address_changed", async () => { const p = await s.person(org); return { id: p.id, confirmed: null }; }],
        ["address_is_yours", async () => { const p = await s.person(org, { email: admin.email }); return { id: p.id, confirmed: admin.email }; }],
        ["address_shared", async () => {
          const p = await s.person(org);
          const q2 = await s.person(org, { email: false });
          await s.addEmail(q2.id, p.email!);
          return { id: p.id, confirmed: p.email };
        }],
        ["needs_acknowledgement", async () => { const p = await s.person(org, { engagement: "visitor", roll: null }); return { id: p.id, confirmed: p.email }; }],
        ["needs_acknowledgement", async () => {
          const p = await s.person(org);
          await s.q(sql`update contact_methods set do_not_contact = true where person_id = ${p.id}`);
          return { id: p.id, confirmed: p.email };
        }],
      ];
      for (const [expected, make] of cases) {
        const m = await make();
        const before = await s.footprint(org);
        const r = await s.issue(org, admin.userId, m.id, { confirmed: m.confirmed });
        expect(r.outcome, expected).toBe(expected);
        expect(r.invitation_id ?? null).toBeNull();
        expect(r.address ?? null).toBeNull();
        expect(r.existing_invitation_expired).toBe(false);
        expect(await s.footprint(org)).toEqual(before);
      }
    });

    it("address_shared ignores another organization's holder and a holder whose membership ended (R29)", async () => {
      const p = await s.person(org);
      const away = await s.person(other, { email: false });
      await s.addEmail(away.id, p.email!);
      const ended = await s.person(org, { email: false, endedOn: "2024-01-01" });
      await s.addEmail(ended.id, p.email!);
      expect((await s.issue(org, admin.userId, p.id, { confirmed: p.email })).outcome).toBe("ok");
    });

    it("acknowledgements: the reasons come from the definer, never the client (F177 conditions 1 and 2)", async () => {
      const v = await s.person(org, { engagement: "visitor", roll: null });
      expect(await s.issue(org, admin.userId, v.id, { confirmed: v.email })).toMatchObject({ outcome: "needs_acknowledgement", ack_reasons: ["visitor"] });
      expect(await s.issue(org, admin.userId, v.id, { confirmed: v.email, acknowledged: true })).toMatchObject({ outcome: "ok", ack_reasons: ["visitor"] });

      const d = await s.person(org, { engagement: "visitor", roll: null });
      await s.q(sql`update contact_methods set do_not_contact = true where person_id = ${d.id}`);
      expect(await s.issue(org, admin.userId, d.id, { confirmed: d.email })).toMatchObject({ outcome: "needs_acknowledgement", ack_reasons: ["do_not_contact", "visitor"] });

      // A client that acknowledges for a non-visitor records nothing.
      const m = await s.person(org);
      expect(await s.issue(org, admin.userId, m.id, { confirmed: m.email, acknowledged: true })).toMatchObject({ outcome: "ok", ack_reasons: [] });
    });

    it("already_pending for an open row, saying whether it has expired", async () => {
      const p = await s.person(org);
      await s.signInRow(org, p.id, p.email!);
      expect(await s.issue(org, admin.userId, p.id, { confirmed: p.email })).toMatchObject({ outcome: "already_pending", existing_invitation_expired: false, invitation_id: null });
      const q = await s.person(org);
      await s.signInRow(org, q.id, q.email!, { createdAt: sql`now() - interval '9 days'`, expiresAt: sql`now() - interval '2 days'` });
      expect(await s.issue(org, admin.userId, q.id, { confirmed: q.email })).toMatchObject({ outcome: "already_pending", existing_invitation_expired: true });
    });
  });

  // ---------------------------------------------------------------------------
  // limits (R32, G9): origin org only, created_at <= now(), inside the org lock
  // ---------------------------------------------------------------------------
  describe("limits: 30 per organization, 30 per inviter, 3 per (organization, address) in 24 hours", () => {
    it("the 31st send at an organization is rate_limited; 2099-dated and platform-origin rows never count", async () => {
      const at = await s.congregation("lim");
      const sender = await s.sender(at, ["people.manage", "officers.manage", "directory.view", "events.view"]);
      const seed = await s.person(at);
      await seedRows(25, { org: at, person: seed.id, address: s.email("seed"), createdBy: sender.userId });
      await seedRows(4, { org: at, person: seed.id, address: s.email("seed"), createdBy: s.actingUserId });
      await seedRows(5, { org: at, person: seed.id, address: s.email("far"), createdBy: sender.userId, createdAt: "2099-01-01" });
      await seedRows(5, { org: at, person: seed.id, address: s.email("plat"), createdBy: sender.userId, purpose: "founding_administrator" });
      const p30 = await s.person(at);
      expect((await s.issue(at, sender.userId, p30.id, { confirmed: p30.email })).outcome).toBe("ok");
      const p31 = await s.person(at);
      const before = await s.footprint(at);
      expect((await s.issue(at, sender.userId, p31.id, { confirmed: p31.email })).outcome).toBe("rate_limited");
      expect(await s.footprint(at)).toEqual(before);
    });

    it("an inviter's 30 sends at other organizations count against them here", async () => {
      const at = await s.congregation("liminv");
      const away = await s.congregation("liminv2");
      const sender = await s.sender(at, ["people.manage", "officers.manage", "directory.view", "events.view"]);
      const seed = await s.person(away);
      await seedRows(30, { org: away, person: seed.id, address: s.email("inv"), createdBy: sender.userId });
      const p = await s.person(at);
      expect((await s.issue(at, sender.userId, p.id, { confirmed: p.email })).outcome).toBe("rate_limited");
    });

    it("3 sends to one address at one organization; another organization's sends to it do not count (F155)", async () => {
      const at = await s.congregation("limaddr");
      const sender = await s.sender(at, ["people.manage", "officers.manage", "directory.view", "events.view"]);
      const p = await s.person(at);
      const away = await s.congregation("limaddr2");
      const awayPerson = await s.person(away, { email: false });
      await seedRows(5, { org: away, person: awayPerson.id, address: p.email!, createdBy: s.actingUserId });
      await seedRows(2, { org: at, person: p.id, address: p.email!, createdBy: s.actingUserId });
      expect((await s.issue(at, sender.userId, p.id, { confirmed: p.email })).outcome).toBe("ok");
      await s.revoke(at, sender.userId, p.id);
      expect((await s.issue(at, sender.userId, p.id, { confirmed: p.email })).outcome).toBe("rate_limited");
    });

    it("the SQL literals are 30, 30, 3, 5 minutes and 5 resends, in issue and resend alike", () => {
      const text = readFileSync(MIGRATION_PATH, "utf8");
      for (const fn of ["presby_issue_sign_in_invitation", "presby_resend_sign_in_invitation"]) {
        const start = text.indexOf(`create or replace function ${fn}(`);
        const body = text.slice(start, text.indexOf("end $$;", start));
        expect([...body.matchAll(/\) >= (\d+)/g)].map((m) => Number(m[1])), fn).toEqual([30, 30, 3]);
        expect(body).toMatch(/i\.origin = 'org'/);
        expect(body.match(/i\.created_at <= now\(\)/g)?.length, fn).toBe(3);
      }
      const resend = text.slice(text.indexOf("create or replace function presby_resend_sign_in_invitation("));
      expect(resend).toMatch(/interval '5 minutes' > now\(\)/);
      expect(resend).toMatch(/resend_count >= 5/);
    });
  });

  // ---------------------------------------------------------------------------
  // resend and revoke
  // ---------------------------------------------------------------------------
  describe("resend", () => {
    it("not_open when nothing is open (and for another organization's person)", async () => {
      const p = await s.person(org);
      expect(await s.resend(org, admin.userId, p.id, { confirmed: p.email })).toMatchObject({ outcome: "not_open", invitation_id: null });
      const away = await s.person(other);
      await s.signInRow(other, away.id, away.email!);
      expect((await s.resend(org, admin.userId, away.id, { confirmed: away.email })).outcome).toBe("not_open");
    });

    it("cooldown within 5 minutes of the open row, with next_resend_at", async () => {
      const p = await s.person(org);
      const inv = await s.signInRow(org, p.id, p.email!);
      const r = await s.resend(org, admin.userId, p.id, { confirmed: p.email });
      const row = await s.invitation(inv.id);
      expect(r.outcome).toBe("cooldown");
      expect(new Date(String(r.next_resend_at)).getTime()).toBe(new Date(String(row.created_at)).getTime() + 5 * 60_000);
      expect(row.superseded_at).toBeNull();
    });

    it("R33: a corrected address resends to the NEW address; the old row is superseded; the queue row to cancel is returned", async () => {
      const p = await s.person(org);
      const [q] = await s.q(sql`insert into email_queue (to_email, subject, html_body, template_key, status)
                                 values (${p.email}, 'Fixture', '<p>fixture</p>', 'account_sign_in_invitation', 'queued') returning id`);
      const old = await s.signInRow(org, p.id, p.email!, { createdAt: sql`now() - interval '10 minutes'`, emailQueueId: String(q!.id) });
      const corrected = s.email("corrected");
      await s.platform.transaction(async (tx) => {
        await tx.execute(sql`update contact_methods set ended_at = now(), is_primary = false where person_id = ${p.id} and ended_at is null`);
        await tx.execute(sql`insert into contact_methods (person_id, kind, value, is_primary) values (${p.id}, 'email', ${corrected}, true)`);
      });
      const r = await s.resend(org, admin.userId, p.id, { confirmed: corrected });
      expect(r).toMatchObject({ outcome: "ok", cancel_email_queue_id: q!.id, address: corrected });
      expect((await s.invitation(old.id)).superseded_at).not.toBeNull();
      expect(await s.invitation(String(r.invitation_id))).toMatchObject({
        email_normalized: corrected, resent_from_id: old.id, resend_count: 1, purpose: "sign_in", origin: "org", person_id: p.id,
      });
      await s.q(sql`delete from email_queue where id = ${q!.id}`);
    });

    it("a refusal from the shared check leaves the open row as it was", async () => {
      const p = await s.person(org);
      const old = await s.signInRow(org, p.id, p.email!, { createdAt: sql`now() - interval '10 minutes'` });
      const before = await s.invitation(old.id);
      expect((await s.resend(org, admin.userId, p.id, { confirmed: s.email("stale") })).outcome).toBe("address_changed");
      expect(await s.invitation(old.id)).toEqual(before);
    });

    it("chain_cap at 5 resends", async () => {
      const p = await s.person(org);
      let parent = await s.signInRow(org, p.id, p.email!, { createdAt: sql`now() - interval '1 hour'` });
      for (let n = 1; n <= 5; n += 1) {
        await s.q(sql`update account_invitations set superseded_at = now() where id = ${parent.id}`);
        const { tokenHash } = (await import("@/lib/testing/invitation-fixture")).mintToken();
        const [row] = await s.q(sql`
          insert into account_invitations (organization_id, purpose, origin, email_normalized, person_id, token_hash,
                 created_by_user_id, created_at, expires_at, resent_from_id, resend_count)
          values (${org}, 'sign_in', 'org', ${p.email}, ${p.id}, ${tokenHash}, ${s.actingUserId},
                  now() - interval '1 hour', now() + interval '6 days', ${parent.id}, ${n})
          returning id`);
        parent = { ...parent, id: String(row!.id) };
      }
      expect((await s.resend(org, admin.userId, p.id, { confirmed: p.email })).outcome).toBe("chain_cap");
    });
  });

  describe("revoke", () => {
    it("ok, terminal, and then not_open; the queue row to cancel is returned", async () => {
      const p = await s.person(org);
      const inv = await s.signInRow(org, p.id, p.email!);
      const r = await s.revoke(org, admin.userId, p.id);
      expect(r).toMatchObject({ outcome: "ok", invitation_id: inv.id, cancel_email_queue_id: null });
      expect(await s.invitation(inv.id)).toMatchObject({ revoked_by_user_id: admin.userId });
      expect(await s.revoke(org, admin.userId, p.id)).toMatchObject({ outcome: "not_open", invitation_id: null });
      expect((await s.accept(inv.token, { userId: await s.user(p.email!) })).outcome).toBe("dead");
    });

    it("people.manage alone may cancel (cancelling is never an escalation)", async () => {
      const clerk = await s.sender(org, ["people.manage"]);
      const p = await s.person(org);
      await s.seat(org, p.id);
      await s.signInRow(org, p.id, p.email!);
      expect((await s.revoke(org, clerk.userId, p.id)).outcome).toBe("ok");
    });
  });

  // ---------------------------------------------------------------------------
  // the reader (R30, R42)
  // ---------------------------------------------------------------------------
  describe("the reader", () => {
    it("the closed column list, from the catalog", async () => {
      const [row] = await s.q(sql`
        select array_to_string(p.proargnames, ',') as names from pg_proc p
         where p.proname = 'presby_sign_in_invitation_states'`);
      expect(row!.names).toBe(
        "p_person_ids,p_actor_user_id,person_id,linked,state,sent_at,expires_at,resend_count,next_resend_at," +
          "invited_address,address_current,outcome,queue_status,queue_delivered_at,queue_bounced_at," +
          "queue_complained_at,connected_via,connected_on",
      );
      const body = readFileSync(MIGRATION_PATH, "utf8");
      const fn = body.slice(body.indexOf("create or replace function presby_sign_in_invitation_states("));
      const text = fn.slice(0, fn.indexOf("end $$;"));
      expect(text).not.toMatch(/token_hash|to_email|subject|html_body|failure_reason|provider_message_id|created_by_user_id|from users/);
    });

    it("bounds: an empty array, a null and 501 ids raise", async () => {
      expect((await refusal(s.states(org, admin.userId, []))).code).toBe("22023");
      expect((await refusal(s.states(org, admin.userId, null))).code).toBe("22023");
      const many = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
      expect((await refusal(s.states(org, admin.userId, many))).code).toBe("22023");
    });

    it("every state, with linked taking precedence, another organization's person omitted, and nothing beyond the closed shape", async () => {
      const none = await s.person(org);
      const pending = await s.person(org);
      const pendingInv = await s.signInRow(org, pending.id, pending.email!);
      const expired = await s.person(org);
      await s.signInRow(org, expired.id, expired.email!, { createdAt: sql`now() - interval '9 days'`, expiresAt: sql`now() - interval '1 day'` });
      const revoked = await s.person(org);
      await s.signInRow(org, revoked.id, revoked.email!);
      await s.revoke(org, admin.userId, revoked.id);
      const linked = await s.person(org);
      await s.signInRow(org, linked.id, linked.email!);
      await s.linkUser(linked.id, await s.user(s.email("lk")));
      const away = await s.person(other);

      const rows = await s.states(org, admin.userId, [none.id, pending.id, expired.id, revoked.id, linked.id, away.id]);
      const by = Object.fromEntries(rows.map((r) => [String(r.person_id), r]));
      expect(Object.keys(by).sort()).toEqual([none.id, pending.id, expired.id, revoked.id, linked.id].sort());
      expect(by[none.id]).toMatchObject({ linked: false, state: "none", sent_at: null, invited_address: null });
      const [pRow] = await s.q(sql`select created_at from account_invitations where id = ${pendingInv.id}`);
      expect(by[pending.id]).toMatchObject({ state: "pending", invited_address: pending.email, address_current: true, resend_count: 0, outcome: null });
      expect(new Date(String(by[pending.id]!.next_resend_at)).getTime()).toBe(new Date(String(pRow!.created_at)).getTime() + 5 * 60_000);
      expect(by[expired.id]).toMatchObject({ state: "expired", invited_address: expired.email });
      expect(by[revoked.id]).toMatchObject({ state: "revoked", next_resend_at: null });
      expect(by[linked.id]).toMatchObject({ linked: true, state: "signs_in", sent_at: null, invited_address: null, connected_via: null });
    });

    it("invited_address is withheld once the address leaves the record", async () => {
      const p = await s.person(org);
      await s.signInRow(org, p.id, p.email!);
      await s.platform.transaction(async (tx) => {
        await tx.execute(sql`update contact_methods set ended_at = now(), is_primary = false where person_id = ${p.id}`);
        await tx.execute(sql`insert into contact_methods (person_id, kind, value, is_primary) values (${p.id}, 'email', ${s.email("n")}, true)`);
      });
      expect((await s.states(org, admin.userId, [p.id]))[0]).toMatchObject({ state: "pending", invited_address: null, address_current: false });
    });

    it("blocked outcomes: the three cross-organization reasons collapse to needs_support", async () => {
      for (const [reason, outcome] of [
        ["person_elsewhere", "needs_support"], ["person_linked_elsewhere", "needs_support"], ["ambiguous_person", "needs_support"],
        ["membership_ended", "membership_ended"], ["person_merged", "person_merged"], ["person_deceased", "person_deceased"],
      ] as const) {
        const p = await s.person(org);
        const inv = await s.signInRow(org, p.id, p.email!);
        await s.platform.transaction(async (tx) => {
          await tx.execute(sql`select set_config('presby.invitation_accept_active', 'true', true)`);
          await tx.execute(sql`update account_invitations set blocked_at = now(), blocked_reason = ${reason} where id = ${inv.id}`);
        });
        expect((await s.states(org, admin.userId, [p.id]))[0], reason).toMatchObject({ state: "blocked", outcome });
      }
    });

    it("the delivery columns come only through this organization's own row", async () => {
      const p = await s.person(org);
      const [q] = await s.q(sql`insert into email_queue (to_email, subject, html_body, template_key, status, sent_at, delivered_at)
                                 values (${p.email}, 'Fixture', '<p>fixture</p>', 'account_sign_in_invitation', 'sent', now(), now()) returning id`);
      await s.signInRow(org, p.id, p.email!, { emailQueueId: String(q!.id) });
      const [r] = await s.states(org, admin.userId, [p.id]);
      expect(r).toMatchObject({ queue_status: "sent", queue_bounced_at: null, queue_complained_at: null });
      expect(r!.queue_delivered_at).not.toBeNull();
      await s.q(sql`delete from email_queue where id = ${q!.id}`);
    });

    it("connected_via / connected_on: an accepted invitation, a sign_in_connected audit row, the earlier of the two; never from users", async () => {
      const a = await s.person(org);
      const ua = await s.user(a.email!);
      const ia = await s.signInRow(org, a.id, a.email!);
      expect((await s.accept(ia.token, { userId: ua })).outcome).toBe("accepted");

      const b = await s.person(org);
      await s.linkUser(b.id, await s.user(b.email!));
      await s.q(sql`insert into audit_events (action, resource_type, resource_id, metadata, created_at)
                    values ('tenant.person.sign_in_connected', 'person', ${b.id},
                            jsonb_build_object('organizationId', ${org}::text, 'personId', ${b.id}::text), '2026-03-04 12:00+00')`);
      // the same audit row for another organization does not count
      const c = await s.person(org);
      await s.linkUser(c.id, await s.user(c.email!));
      await s.q(sql`insert into audit_events (action, resource_type, resource_id, metadata)
                    values ('tenant.person.sign_in_connected', 'person', ${c.id},
                            jsonb_build_object('organizationId', ${other}::text, 'personId', ${c.id}::text))`);

      const rows = await s.states(org, admin.userId, [a.id, b.id, c.id]);
      const by = Object.fromEntries(rows.map((r) => [String(r.person_id), r]));
      expect(by[a.id]).toMatchObject({ state: "signs_in", connected_via: "invitation" });
      expect(by[a.id]!.connected_on).not.toBeNull();
      expect(by[b.id]).toMatchObject({ connected_via: "sign_in" });
      expect(String(by[b.id]!.connected_on).slice(0, 10)).toBe("2026-03-04");
      expect(by[c.id]).toMatchObject({ connected_via: null, connected_on: null });

      // both: the earlier wins
      await s.q(sql`insert into audit_events (action, resource_type, resource_id, metadata, created_at)
                    values ('tenant.person.sign_in_connected', 'person', ${a.id},
                            jsonb_build_object('organizationId', ${org}::text, 'personId', ${a.id}::text), '2020-01-02 12:00+00')`);
      const [again] = await s.states(org, admin.userId, [a.id]);
      expect(again).toMatchObject({ connected_via: "sign_in" });
      expect(String(again!.connected_on).slice(0, 10)).toBe("2020-01-02");
    });
  });
});
