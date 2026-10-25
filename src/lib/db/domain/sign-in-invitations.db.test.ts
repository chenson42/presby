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
