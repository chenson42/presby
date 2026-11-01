/**
 * drizzle/0061_presby_participant_roll.sql, proven against a real database
 * (docs/work-log/2026-10-22-founding-admin-directory.md, Phase 3 Test Plan
 * 1.1-1.6, 1.8 (SQL half) and 1.9; DECISION-198, DECISION-199; F173, F174,
 * F175).
 *
 * Two connections, on purpose:
 *   - `presby_app` (`db`, RLS enforced, NOBYPASSRLS) for everything the
 *     application path does: calling the two definer functions under an org
 *     GUC, the R5 restrictive policy, the identity literal;
 *   - the owner (`getPlatformDb()`) for fixtures and for checks the tenant
 *     connection cannot see. Owner checks that must not persist run inside a
 *     transaction that is always rolled back (`inRolledBackOwnerTx`), which is
 *     also how the migration's own sections are re-executed against fixtures
 *     (the F173 repair needs the new CHECK dropped, which only a rolled-back
 *     transaction can do safely).
 *
 * Fixtures: synthetic names, `example.invalid` addresses (No Real Data);
 * organizations and people are stamped `deletable_until` at insert
 * (fixture-deletable.ts). Teardown deletes the stamped organizations, whose
 * cascade removes their memberships and roll rows; approved roll rows are
 * frozen by roll_actions_freeze, so teardown disables that trigger around the
 * cascade exactly as src/lib/roll.test.ts and src/lib/people.test.ts already
 * do, and group_memberships_reject_derived as every DB suite does.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/participant-roll.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";
import { rowsOf, type Row } from "@/lib/testing/invitation-fixture";
import { ROLL_ACTION_KIND_TO_ROLL } from "@/lib/roll-action-kinds";

vi.mock("server-only", () => ({}));
// Remote Neon, many round trips per case; the 5 s default is too tight on a
// cold pipeline branch.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const MIGRATION_PATH = path.join(process.cwd(), "drizzle", "0061_presby_participant_roll.sql");
const DENY_LITERAL = "roll_actions: this participant action is not permitted";
const RECORD_OUTCOMES = [
  "ok", "invalid_kind", "date_out_of_range", "person_not_found", "person_deceased",
  "membership_ended", "pending_action", "already_participant", "on_member_roll",
  "not_participant", "date_before_latest_action", "holds_position", "self_target",
  "provisioning_incomplete",
] as const;
const VOID_OUTCOMES = [
  "ok", "reason_required", "reason_too_long", "action_not_found", "not_on_record_kind",
  "already_voided", "not_latest_action", "membership_changed", "provisioning_incomplete",
] as const;
const REMOVAL_MARKER = "other_participant_removed";

type Db = ReturnType<typeof import("@/lib/db").getPlatformDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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
function pgMessages(err: unknown): string {
  return chain(err)
    .map((e) => (e instanceof Error ? e.message : String(e)))
    .join(" :: ");
}
function pgMessage(err: unknown): string | undefined {
  // The driver's own message (the innermost error carrying a SQLSTATE).
  const withCode = chain(err).filter((e) => typeof (e as { code?: unknown }).code === "string");
  const last = withCode[withCode.length - 1];
  return last instanceof Error ? last.message : undefined;
}

/** The text of one numbered section of the migration (`-- N. title` to the next). */
function migrationSection(n: number): string {
  const text = readFileSync(MIGRATION_PATH, "utf8");
  const start = text.search(new RegExp(`^-- ${n}\\. `, "m"));
  const end = text.search(new RegExp(`^-- ${n + 1}\\. `, "m"));
  if (start < 0 || end < 0) throw new Error(`section ${n} not found in 0061`);
  return text.slice(start, end);
}

describe.skipIf(!hasDb)("drizzle/0061 participant roll (Postgres-backed)", () => {
  let platform: Db;
  let appDb: typeof import("@/lib/db").db;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let counter = 0;
  const orgIds: string[] = [];
  const personIds: string[] = [];
  const userIds: string[] = [];

  let orgMain: string;
  let orgMainSlug: string;
  let orgOther: string;
  let orgBare: string; // no derived active_membership group (S4)
  let rosterTypeId: string;

  let actorUser: string;
  let actorPerson: string;
  let noPermUser: string;
  let otherOrgUser: string;
  let mergedUser: string;
  let noPersonUser: string;
  let bareActorUser: string;
  let proposeRoleMain: string;

  async function q(query: SQL): Promise<Row[]> {
    return rowsOf(await platform.execute(query));
  }

  async function makeUser(tag: string): Promise<string> {
    counter += 1;
    const [row] = await q(sql`
      insert into users (email, name)
      values (${`prt-${tag}-${stamp}-${counter}@example.invalid`}, 'Participant Roll Fixture')
      returning id`);
    userIds.push(String(row!.id));
    return String(row!.id);
  }

  async function makeOrg(tag: string, withGroup = true): Promise<{ id: string; slug: string }> {
    counter += 1;
    const slug = `prt-${tag}-${stamp}-${counter}`;
    const [row] = await q(sql`
      insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
      values ('congregation', ${`Fixture ${tag} for participant-roll`}, ${slug},
              ${slug.replace(/-/g, "_")}, 'managed', ${fixtureDeletableUntil()})
      returning id`);
    const id = String(row!.id);
    orgIds.push(id);
    if (withGroup) {
      await q(sql`
        insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
        values (${id}, ${rosterTypeId}, 'Active Membership', 'derived', 'active_membership', true)`);
    }
    return { id, slug };
  }

  async function makePerson(first: string, opts: { dob?: string; yearOnly?: boolean; userId?: string; deceased?: string } = {}) {
    counter += 1;
    const [row] = await q(sql`
      insert into people (first_name, last_name, date_of_birth, birth_year_only, user_id, date_of_death, deletable_until)
      values (${first}, ${`Fennick${stamp}${counter}`}, ${opts.dob ?? null}::date, ${opts.yearOnly ?? false},
              ${opts.userId ?? null}::uuid, ${opts.deceased ?? null}::date, ${fixtureDeletableUntil()})
      returning id`);
    personIds.push(String(row!.id));
    return String(row!.id);
  }

  async function addMembership(org: string, person: string, opts: { engagement?: string; endedOn?: string; endedReason?: string } = {}) {
    await q(sql`
      insert into memberships (organization_id, person_id, engagement_status, ended_on, ended_reason)
      values (${org}, ${person}, ${opts.engagement ?? "visitor"}, ${opts.endedOn ?? null}::date, ${opts.endedReason ?? null})`);
  }

  /** A membership at an org with NO derived group (the trigger would refuse it). */
  async function addMembershipAtBare(org: string, person: string, engagement = "regular") {
    await platform.transaction(async (tx) => {
      await tx.execute(sql`alter table memberships disable trigger memberships_sync_derived_group`);
      await tx.execute(sql`
        insert into memberships (organization_id, person_id, engagement_status)
        values (${org}, ${person}, ${engagement})`);
      await tx.execute(sql`alter table memberships enable trigger memberships_sync_derived_group`);
    });
  }

  async function makeRole(org: string, key: string, perms: string[]): Promise<string> {
    const [row] = await q(sql`
      insert into app_roles (organization_id, key, name, role_kind)
      values (${org}, ${key}, ${key}, 'custom') returning id`);
    const roleId = String(row!.id);
    for (const p of perms) {
      await q(sql`insert into app_role_permissions (role_id, permission_key) values (${roleId}, ${p})`);
    }
    return roleId;
  }

  async function grant(org: string, roleId: string, person: string) {
    await q(sql`
      insert into role_grants (organization_id, role_id, person_id, starts_on)
      values (${org}, ${roleId}, ${person}, '2020-01-01')`);
  }

  /** A fresh subject at `org` (default: a visitor at orgMain). */
  async function subject(opts: {
    org?: string; dob?: string; yearOnly?: boolean; engagement?: string;
    endedOn?: string; deceased?: string; userId?: string;
  } = {}): Promise<string> {
    const person = await makePerson("Subject", opts);
    await addMembership(opts.org ?? orgMain, person, { engagement: opts.engagement, endedOn: opts.endedOn });
    return person;
  }

  async function asApp<T>(org: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      if (org) await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
      return fn(tx as unknown as Tx);
    });
  }

  function recordSql(person: string | null, kind: string | null, date: string | null, user: string | null, minute: string | null = null) {
    return sql`select * from presby_record_participant_action(${person}::uuid, ${kind}::roll_action_kind,
                 ${date}::date, ${minute}::text, ${user}::uuid)`;
  }
  function voidSql(actionId: string | null, reason: string | null, user: string | null) {
    return sql`select * from presby_void_participant_action(${actionId}::uuid, ${reason}::text, ${user}::uuid)`;
  }

  /** presby_record_participant_action through presby_app, committed. */
  async function record(person: string | null, kind: string | null, date: string | null,
    opts: { user?: string | null; org?: string | null; minute?: string | null } = {}): Promise<Row> {
    const org = opts.org === undefined ? orgMain : opts.org;
    const user = opts.user === undefined ? actorUser : opts.user;
    const rows = await asApp(org, async (tx) => rowsOf(await tx.execute(recordSql(person, kind, date, user, opts.minute ?? null))));
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  /** presby_void_participant_action through presby_app, committed. */
  async function undo(actionId: string | null, reason: string | null,
    opts: { user?: string | null; org?: string | null } = {}): Promise<Row> {
    const org = opts.org === undefined ? orgMain : opts.org;
    const user = opts.user === undefined ? actorUser : opts.user;
    const rows = await asApp(org, async (tx) => rowsOf(await tx.execute(voidSql(actionId, reason, user))));
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  async function expectDenied(run: () => Promise<unknown>) {
    let caught: unknown;
    try {
      await run();
    } catch (err) {
      caught = err;
    }
    expect(caught, "expected the uniform identity refusal").toBeDefined();
    expect(pgCode(caught)).toBe("42501");
    expect(pgMessage(caught)).toBe(DENY_LITERAL);
  }

  async function inRolledBackOwnerTx(fn: (tx: Tx) => Promise<void>) {
    try {
      await platform.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  /** Runs `query` in a savepoint and returns its error (the outer tx stays usable). */
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
    return { code: pgCode(caught), text: pgMessages(caught) };
  }

  /** Everything a refusal must leave untouched for one person at one org. */
  async function stateOf(org: string, person: string): Promise<Row> {
    const [row] = await q(sql`
      select (select count(*) from roll_actions where organization_id = ${org} and person_id = ${person})::int as roll_rows,
             m.ended_on::text as ended_on, m.ended_reason, m.current_roll, m.current_roll_since::text as current_roll_since,
             m.engagement_status,
             -- drizzle/0066 (Increment 3a): a membership now holds one derived row per
             -- group (all_memberships and, with member standing, active_membership);
             -- this reads the Active Membership row, the one this helper always meant.
             (select gm.ends_on::text from group_memberships gm join groups g on g.id = gm.group_id
               where gm.membership_id = m.id and g.derived_from = 'active_membership') as group_ends_on
        from memberships m where m.organization_id = ${org} and m.person_id = ${person}`);
    return row!;
  }

  async function rollRow(id: string): Promise<Row> {
    const [row] = await q(sql`
      select id, organization_id, person_id, kind::text as kind, effective_date::text as effective_date,
             resulting_roll, age_at_action, approval_status, minute_reference, approved_on::text as approved_on,
             approved_by, proposed_by, voids_action_id, (approved_on = current_date) as approved_today,
             (effective_date = current_date) as effective_today
        from roll_actions where id = ${id}`);
    return row!;
  }

  async function ownerInsertRoll(values: {
    org?: string; person: string; kind: string; date: string; roll: string | null;
    status?: string; voids?: string | null;
  }): Promise<string> {
    const [row] = await q(sql`
      insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll,
                                approval_status, voids_action_id, recorded_at)
      values (${values.org ?? orgMain}, ${values.person}, ${values.kind}::roll_action_kind, ${values.date}::date,
              ${values.roll}, ${values.status ?? "approved"}, ${values.voids ?? null}::uuid, clock_timestamp())
      returning id`);
    return String(row!.id);
  }

  async function drift(org: string, person: string): Promise<number> {
    const [row] = await q(sql`
      select count(*)::int as n from presby_roll_cache_drift() d
       where d.organization_id = ${org} and d.person_id = ${person}`);
    return Number(row!.n);
  }

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    platform = dbModule.getPlatformDb();
    appDb = dbModule.db;

    await q(sql`insert into group_types (key, name) values ('roster', 'Roster') on conflict do nothing`);
    const [gt] = await q(sql`select id from group_types where key = 'roster'`);
    rosterTypeId = String(gt!.id);

    const main = await makeOrg("main");
    orgMain = main.id;
    orgMainSlug = main.slug;
    orgOther = (await makeOrg("other")).id;
    orgBare = (await makeOrg("bare", false)).id;

    // The actor: active member of orgMain holding roll.propose + directory.view.
    actorUser = await makeUser("actor");
    actorPerson = await makePerson("Actor", { userId: actorUser });
    await addMembership(orgMain, actorPerson, { engagement: "regular" });
    proposeRoleMain = await makeRole(orgMain, "prt_clerk", ["roll.propose", "directory.view"]);
    await grant(orgMain, proposeRoleMain, actorPerson);

    // A member of orgMain with no roll.propose.
    noPermUser = await makeUser("noperm");
    const noPermPerson = await makePerson("Noperm", { userId: noPermUser });
    await addMembership(orgMain, noPermPerson, { engagement: "regular" });

    // A roll.propose holder at ANOTHER organization only.
    otherOrgUser = await makeUser("other");
    const otherPerson = await makePerson("Otherorg", { userId: otherOrgUser });
    await addMembership(orgOther, otherPerson, { engagement: "regular" });
    const otherRole = await makeRole(orgOther, "prt_clerk_other", ["roll.propose"]);
    await grant(orgOther, otherRole, otherPerson);

    // A roll.propose holder at orgMain whose person has been MERGED away.
    mergedUser = await makeUser("merged");
    const survivor = await makePerson("Survivor");
    const mergedPerson = await makePerson("Merged", { userId: mergedUser });
    await addMembership(orgMain, mergedPerson, { engagement: "regular" });
    await grant(orgMain, proposeRoleMain, mergedPerson);
    await q(sql`update people set merged_into_id = ${survivor} where id = ${mergedPerson}`);

    // A user with no person at all.
    noPersonUser = await makeUser("noperson");

    // The bare org's actor (membership inserted with the derived-group trigger
    // off, because the org has no active_membership group).
    bareActorUser = await makeUser("bare");
    const barePerson = await makePerson("Bareactor", { userId: bareActorUser });
    await addMembershipAtBare(orgBare, barePerson);
    const bareRole = await makeRole(orgBare, "prt_clerk_bare", ["roll.propose"]);
    await grant(orgBare, bareRole, barePerson);
  });

  afterAll(async () => {
    if (!platform) return;
    await platform.execute(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
    await platform.execute(sql`alter table roll_actions disable trigger roll_actions_freeze`);
    try {
      for (const id of orgIds) {
        await platform.execute(sql`delete from organizations where id = ${id}`);
      }
    } finally {
      await platform.execute(sql`alter table roll_actions enable trigger roll_actions_freeze`);
      await platform.execute(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
    }
    // Merged people first (people_merged_into_id_people_id_fk), then the rest.
    const merged = new Set(
      (await q(sql`select id from people where merged_into_id is not null
                    and id in (${sql.join(personIds.map((id) => sql`${id}::uuid`), sql`, `)})`)).map((r) => String(r.id)),
    );
    for (const id of [...personIds].sort((x, y) => Number(merged.has(y)) - Number(merged.has(x)))) {
      await platform.execute(sql`delete from people where id = ${id}`);
    }
    for (const id of userIds) {
      await platform.execute(sql`delete from users where id = ${id}`);
    }
  });

  // =========================================================================
  // Structure
  // =========================================================================
  describe("structure", () => {
    it("both functions are SECURITY DEFINER with search_path pinned (pg_temp last), executable by presby_app only", async () => {
      const rows = await q(sql`
        select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as config,
               has_function_privilege('presby_app', p.oid, 'execute') as app_exec,
               has_function_privilege('presby_platform', p.oid, 'execute') as platform_exec,
               has_function_privilege('public', p.oid, 'execute') as public_exec
          from pg_proc p
         where p.proname in ('presby_record_participant_action', 'presby_void_participant_action',
                             'presby_participant__actor_may_propose', 'presby_deny_participant_action')
         order by p.proname`);
      const by = Object.fromEntries(rows.map((r) => [r.proname, r]));
      for (const name of ["presby_record_participant_action", "presby_void_participant_action"]) {
        expect(by[name]).toMatchObject({ prosecdef: true, config: "search_path=public, pg_temp", app_exec: true, platform_exec: false, public_exec: false });
      }
      // The actor helper: definer, pinned, and NO grant (owner-only).
      expect(by.presby_participant__actor_may_propose).toMatchObject({
        prosecdef: true, config: "search_path=public, pg_temp", app_exec: false, public_exec: false,
      });
      // The literal helper: invoker, executable by presby_app (one literal, never "permission denied for function").
      expect(by.presby_deny_participant_action).toMatchObject({ prosecdef: false, app_exec: true, public_exec: false });
    });

    it("R5: one RESTRICTIVE insert policy for presby_app requiring approval_status = 'pending', beside tenant_isolation", async () => {
      const rows = await q(sql`
        select policyname, permissive, cmd, roles::text as roles, with_check
          from pg_policies where tablename = 'roll_actions' order by policyname`);
      expect(rows.map((r) => r.policyname)).toEqual(["roll_actions_insert_pending_only", "tenant_isolation"]);
      expect(rows[0]).toMatchObject({ permissive: "RESTRICTIVE", cmd: "INSERT", roles: "{presby_app}" });
      // drizzle/0063 narrows the same policy to pending AND an approvable kind
      // (F191); the exact text is pinned in roll-decide-lockdown.db.test.ts.
      // Here only 0061's half, which holds in both states.
      expect(String(rows[0]!.with_check)).toContain("(approval_status = 'pending'::text)");
      const [force] = await q(sql`select relforcerowsecurity from pg_class where relname = 'roll_actions'`);
      expect(force!.relforcerowsecurity).toBe(true);
    });

    it("S2/S3: the three CHECKs are VALIDATED and the one-live-void index is partial and unique", async () => {
      // drizzle/0062 and 0063 add further CHECKs on roll_actions (proven in
      // session-approval.db.test.ts and roll-decide-lockdown.db.test.ts), so
      // this asserts 0061's three, not the whole set.
      const rows = await q(sql`
        select conname, convalidated from pg_constraint
         where conrelid = 'roll_actions'::regclass and contype = 'c'
           and conname in ('roll_actions_approval_status_allowed', 'roll_actions_resulting_roll_matches_kind',
                           'roll_actions_void_shape')
         order by conname`);
      expect(rows).toEqual([
        { conname: "roll_actions_approval_status_allowed", convalidated: true },
        { conname: "roll_actions_resulting_roll_matches_kind", convalidated: true },
        { conname: "roll_actions_void_shape", convalidated: true },
      ]);
      const [idx] = await q(sql`select indexdef from pg_indexes where indexname = 'roll_actions_one_live_void_idx'`);
      expect(idx!.indexdef).toContain("CREATE UNIQUE INDEX");
      expect(idx!.indexdef).toContain("(voids_action_id)");
      // Re-predicated by drizzle/0062 (a withdrawn void is not live either).
      expect(idx!.indexdef).toContain(
        "WHERE ((kind = 'void'::roll_action_kind) AND (approval_status = ANY (ARRAY['pending'::text, 'approved'::text])))");
    });

    it("F174 + DECISION-199: both roll keys are in the catalog (tier 1, module roll) and the clerk TEMPLATE carries exactly statistics.publish, roll.propose, directory.view", async () => {
      const perms = await q(sql`
        select key, module, sensitivity_tier from permissions where key in ('roll.propose', 'roll.approve') order by key`);
      expect(perms).toEqual([
        { key: "roll.approve", module: "roll", sensitivity_tier: 1 },
        { key: "roll.propose", module: "roll", sensitivity_tier: 1 },
      ]);
      const keys = await q(sql`
        select arp.permission_key from app_role_permissions arp join app_roles r on r.id = arp.role_id
         where r.organization_id is null and r.key = 'congregation_stated_clerk' order by 1`);
      expect(keys.map((r) => r.permission_key)).toEqual(["directory.view", "roll.propose", "statistics.publish"]);
      // No role carries both roll keys (No Role Carries a Wildcard; roll.approve is Increment 2).
      const [both] = await q(sql`
        select count(*)::int as n from app_roles r
         where exists (select 1 from app_role_permissions a where a.role_id = r.id and a.permission_key = 'roll.propose')
           and exists (select 1 from app_role_permissions a where a.role_id = r.id and a.permission_key = 'roll.approve')
           and r.organization_id is null`);
      expect(both!.n).toBe(0);
    });
  });

  // =========================================================================
  // The migration's own sections, re-executed against fixtures (1.9)
  // =========================================================================
  describe("migration sections against fixtures (rolled back)", () => {
    it("section 3: the backfill tops up a clerk copy ONLY at an organization holding a founding_administrator role, and touches no other role", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        const mk = async (tag: string) => {
          const slug = `prt-bf-${tag}-${stamp}`;
          const r = rowsOf(await tx.execute(sql`
            insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
            values ('congregation', ${`Fixture backfill ${tag}`}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed', ${fixtureDeletableUntil()})
            returning id`));
          return String(r[0]!.id);
        };
        const role = async (org: string, key: string, perms: string[]) => {
          const r = rowsOf(await tx.execute(sql`
            insert into app_roles (organization_id, key, name, role_kind) values (${org}, ${key}, ${key}, 'custom') returning id`));
          const id = String(r[0]!.id);
          for (const p of perms) await tx.execute(sql`insert into app_role_permissions values (${id}, ${p})`);
          return id;
        };
        const keysOf = async (roleId: string) =>
          rowsOf(await tx.execute(sql`select permission_key from app_role_permissions where role_id = ${roleId} order by 1`))
            .map((r) => r.permission_key);

        const designated = await mk("designated");
        const adopted = await mk("adopted");
        await role(designated, "founding_administrator", ["people.manage"]);
        const designatedClerk = await role(designated, "congregation_stated_clerk", ["statistics.publish"]);
        const designatedOther = await role(designated, "committee_chair", ["groups.manage"]);
        const adoptedClerk = await role(adopted, "congregation_stated_clerk", ["statistics.publish"]);

        await tx.execute(sql.raw(migrationSection(3)));

        expect(await keysOf(designatedClerk)).toEqual(["directory.view", "roll.propose", "statistics.publish"]);
        expect(await keysOf(adoptedClerk)).toEqual(["statistics.publish"]); // 0052 note 5: a tenant-adopted copy is not touched
        expect(await keysOf(designatedOther)).toEqual(["groups.manage"]);

        // Sections 1-3 replay as no-ops (idempotence, at the row level).
        const before = rowsOf(await tx.execute(sql`select count(*)::int as n from app_role_permissions`))[0]!.n;
        await tx.execute(sql.raw(migrationSection(1)));
        await tx.execute(sql.raw(migrationSection(2)));
        await tx.execute(sql.raw(migrationSection(3)));
        const after = rowsOf(await tx.execute(sql`select count(*)::int as n from app_role_permissions`))[0]!.n;
        expect(after).toBe(before);
      });
    });

    it("section 4: F173 repair fills resulting_roll and age_at_action on PENDING rows, leaves loss kinds null, and the stop-block raises on an APPROVED violator", async () => {
      const section4 = migrationSection(4);
      const splitAt = section4.indexOf("do $$");
      const repair = section4.slice(0, splitAt);
      const stop = section4.slice(splitAt);
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`alter table roll_actions drop constraint roll_actions_resulting_roll_matches_kind`);
        // The repair replays against the pre-0061 shape, which also predates
        // drizzle/0062's one-pending-per-person index (R7): three pending rows
        // for one person were possible then.
        await tx.execute(sql`drop index if exists roll_actions_one_pending_per_person_idx`);
        const p = rowsOf(await tx.execute(sql`
          insert into people (first_name, last_name, date_of_birth, deletable_until)
          values ('Repair', ${`Subject${stamp}`}, '2000-06-15', ${fixtureDeletableUntil()}) returning id`))[0]!.id as string;
        await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgMain}, ${p}, 'regular')`);
        const ins = async (kind: string, status: string, roll: string | null = null) =>
          String(rowsOf(await tx.execute(sql`
            insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
            values (${orgMain}, ${p}, ${kind}::roll_action_kind, '2026-01-01', ${roll}, ${status}) returning id`))[0]!.id);
        const pof = await ins("profession_of_faith", "pending");
        const enrol = await ins("other_participant_enrolled", "pending");
        const death = await ins("death", "pending");

        await tx.execute(sql.raw(stop)); // nothing approved violates yet: passes
        await tx.execute(sql.raw(repair));
        const after = rowsOf(await tx.execute(sql`
          select id, resulting_roll, age_at_action from roll_actions where person_id = ${p} order by kind`));
        const by = Object.fromEntries(after.map((r) => [r.id, r]));
        expect(by[pof]).toMatchObject({ resulting_roll: "active", age_at_action: 25 });
        expect(by[enrol]).toMatchObject({ resulting_roll: "other_participant", age_at_action: 25 });
        expect(by[death]).toMatchObject({ resulting_roll: null, age_at_action: null });

        await ins("other_gain", "approved", null); // an approved violator (cannot be updated: frozen)
        const err = await rejected(tx, sql.raw(stop));
        expect(err.code).toBe("23514");
        expect(err.text).toMatch(/1 approved roll_actions row\(s\) carry a resulting_roll that disagrees/);
      });
    });
  });

  // =========================================================================
  // Constraints (S2, S3)
  // =========================================================================
  describe("constraints", () => {
    it("roll_actions_resulting_roll_matches_kind equals ROLL_ACTION_KIND_TO_ROLL for every kind (opening_balance exempt)", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        const p = rowsOf(await tx.execute(sql`
          insert into people (first_name, last_name, deletable_until)
          values ('Parity', ${`Subject${stamp}`}, ${fixtureDeletableUntil()}) returning id`))[0]!.id as string;
        await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgMain}, ${p}, 'regular')`);
        const insert = (kind: string, roll: string | null) => sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
          values (${orgMain}, ${p}, ${kind}::roll_action_kind, '2026-01-01', ${roll}, 'pending')`;
        // Each accepted insert is rolled back to its savepoint: drizzle/0062's
        // one-pending-per-person index (R7) would otherwise refuse the second.
        const accepted = async (query: SQL) => {
          let ran = false;
          try {
            await tx.transaction(async (sp) => { await sp.execute(query); ran = true; throw new Rollback(); });
          } catch (err) {
            if (!(err instanceof Rollback)) throw err;
          }
          expect(ran).toBe(true);
        };
        const kinds = Object.keys(ROLL_ACTION_KIND_TO_ROLL).filter((k) => k !== "void");
        expect(kinds.length).toBe(16);
        for (const kind of kinds) {
          const mapped = ROLL_ACTION_KIND_TO_ROLL[kind as keyof typeof ROLL_ACTION_KIND_TO_ROLL];
          await accepted(insert(kind, mapped));
          if (kind === "opening_balance") {
            await accepted(insert(kind, "affiliate"));
            continue;
          }
          const wrong = mapped === null ? "active" : mapped === "active" ? "baptized" : "active";
          const err = await rejected(tx, insert(kind, wrong));
          expect(err.code, kind).toBe("23514");
          expect(err.text, kind).toContain("roll_actions_resulting_roll_matches_kind");
          if (mapped !== null) {
            const nullErr = await rejected(tx, insert(kind, null)); // F173's exact shape
            expect(nullErr.text, kind).toContain("roll_actions_resulting_roll_matches_kind");
          }
        }
      });
    });

    it("void shape, approval vocabulary and one live void per action (a denied void does not block; a pending one does)", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        const p = rowsOf(await tx.execute(sql`
          insert into people (first_name, last_name, deletable_until)
          values ('Shape', ${`Subject${stamp}`}, ${fixtureDeletableUntil()}) returning id`))[0]!.id as string;
        await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgMain}, ${p}, 'regular')`);
        const target = String(rowsOf(await tx.execute(sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
          values (${orgMain}, ${p}, 'other_participant_enrolled', '2025-01-01', 'other_participant', 'approved') returning id`))[0]!.id);
        // decided_by/decided_at: drizzle/0063's roll_actions_terminal_decision_stamps
        // requires them on a denied row; harmless on the others.
        const voidRow = (status: string, voids: string | null) => sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, approval_status, voids_action_id,
                                    decided_by, decided_at)
          values (${orgMain}, ${p}, 'void', '2026-01-01', ${status}, ${voids}::uuid, ${actorUser}, now())`;

        expect((await rejected(tx, voidRow("approved", null))).text).toContain("roll_actions_void_shape");
        expect((await rejected(tx, sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, voids_action_id)
          values (${orgMain}, ${p}, 'other_gain', '2026-01-01', 'active', 'pending', ${target})`)).text).toContain("roll_actions_void_shape");
        expect((await rejected(tx, sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
          values (${orgMain}, ${p}, 'other_gain', '2026-01-01', 'active', 'maybe')`)).text).toContain("roll_actions_approval_status_allowed");

        await tx.transaction(async (sp) => { await sp.execute(voidRow("denied", target)); });
        await tx.transaction(async (sp) => { await sp.execute(voidRow("pending", target)); });
        const second = await rejected(tx, voidRow("approved", target));
        expect(second.code).toBe("23505");
        expect(second.text).toContain("roll_actions_one_live_void_idx");
      });
    });
  });

  // =========================================================================
  // R5: the restrictive insert policy
  // =========================================================================
  describe("R5 restrictive insert policy", () => {
    it("presby_app cannot insert an approved (or denied) row, can insert a pending one; the owner still can (fixtures)", async () => {
      const p = await subject({ engagement: "regular" });
      for (const status of ["approved", "denied"]) {
        let caught: unknown;
        try {
          await asApp(orgMain, async (tx) => {
            await tx.execute(sql`
              insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
              values (${orgMain}, ${p}, 'other_participant_enrolled', '2025-01-01', 'other_participant', ${status})`);
          });
        } catch (err) {
          caught = err;
        }
        expect(pgCode(caught), status).toBe("42501");
        expect(pgMessages(caught), status).toMatch(/row-level security policy/);
      }
      // Positive control, rolled back: pending is allowed. A gain kind,
      // because drizzle/0063 narrows the policy to the approvable kinds (F191).
      let pendingWritten = false;
      try {
        await asApp(orgMain, async (tx) => {
          await tx.execute(sql`
            insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
            values (${orgMain}, ${p}, 'profession_of_faith', '2025-01-01', 'active', 'pending')`);
          pendingWritten = true;
          throw new Rollback();
        });
      } catch (err) {
        if (!(err instanceof Rollback)) throw err;
      }
      expect(pendingWritten).toBe(true);
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
          values (${orgMain}, ${p}, 'other_participant_enrolled', '2025-01-01', 'other_participant', 'approved')`);
      });
      expect((await stateOf(orgMain, p)).roll_rows).toBe(0);
    });
  });

  // =========================================================================
  // Identity refusals (one literal, raised, nothing written)
  // =========================================================================
  describe("identity refusals", () => {
    it("no org context, null actor, a user with no person, no roll.propose, another org's holder, a merged person: one literal, SQLSTATE 42501", async () => {
      const p = await subject();
      const before = await stateOf(orgMain, p);
      await expectDenied(() => record(p, "other_participant_enrolled", "2025-01-01", { org: null }));
      await expectDenied(() => record(p, "other_participant_enrolled", "2025-01-01", { user: null }));
      await expectDenied(() => record(p, "other_participant_enrolled", "2025-01-01", { user: noPersonUser }));
      await expectDenied(() => record(p, "other_participant_enrolled", "2025-01-01", { user: noPermUser }));
      await expectDenied(() => record(p, "other_participant_enrolled", "2025-01-01", { user: otherOrgUser }));
      await expectDenied(() => record(p, "other_participant_enrolled", "2025-01-01", { user: mergedUser }));
      // The org comes from presby_current_org(), never a parameter: the
      // other org's holder is refused at orgMain, and the actor is refused
      // under orgOther's context (where they are not a member).
      await expectDenied(() => record(p, "other_participant_enrolled", "2025-01-01", { org: orgOther }));
      // Identity is checked before the kind: a bad kind still gets the literal.
      await expectDenied(() => record(p, "profession_of_faith", "2025-01-01", { user: noPermUser }));
      expect(await stateOf(orgMain, p)).toEqual(before);
    });

    it("an actor whose membership has ended is refused (rolled back: the guard_end trigger is off only inside the transaction)", async () => {
      const p = await subject();
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`alter table memberships disable trigger memberships_guard_end`);
        await tx.execute(sql`update memberships set ended_on = current_date - 1 where organization_id = ${orgMain} and person_id = ${actorPerson}`);
        await tx.execute(sql`select set_config('app.current_org_id', ${orgMain}, true)`);
        // Still holds roll.propose by grant; only the membership ended.
        const held = rowsOf(await tx.execute(sql`select presby_has_permission(${actorPerson}, ${orgMain}, 'roll.propose') as h`));
        expect(held[0]!.h).toBe(true);
        let caught: unknown;
        try {
          await tx.transaction(async (sp) => { await sp.execute(recordSql(p, "other_participant_enrolled", "2025-01-01", actorUser)); });
        } catch (err) {
          caught = err;
        }
        expect(pgCode(caught)).toBe("42501");
        expect(pgMessage(caught)).toBe(DENY_LITERAL);
      });
    });

    it("the void function refuses with the same literal (no org, no roll.propose, another org)", async () => {
      const p = await subject();
      const ok = await record(p, "other_participant_enrolled", "2025-01-01");
      const id = String(ok.roll_action_id);
      await expectDenied(() => undo(id, "mistake", { org: null }));
      await expectDenied(() => undo(id, "mistake", { user: noPermUser }));
      await expectDenied(() => undo(id, "mistake", { user: otherOrgUser }));
      await expectDenied(() => undo(id, "", { user: null })); // identity before reason
      expect((await stateOf(orgMain, p)).roll_rows).toBe(1);
    });
  });

  // =========================================================================
  // Record outcomes
  // =========================================================================
  describe("presby_record_participant_action outcomes", () => {
    async function refusedWithNoWrite(org: string, p: string, run: () => Promise<Row>, outcome: string) {
      const before = await stateOf(org, p);
      const row = await run();
      expect(row).toEqual({ outcome, roll_action_id: null, membership_ended: false, affects_filed_period: false });
      expect(await stateOf(org, p)).toEqual(before);
    }

    it("invalid_kind: every kind outside the two on-record kinds, including null (R4)", async () => {
      const p = await subject();
      for (const kind of ["profession_of_faith", "affiliate_received", "void", "opening_balance", "death", null]) {
        await refusedWithNoWrite(orgMain, p, () => record(p, kind, "2025-01-01"), "invalid_kind");
      }
    });

    it("date_out_of_range: null, tomorrow, before 1900, before the birth date, before 1 January of a year-only birth", async () => {
      const p = await subject({ dob: "1990-06-15" });
      const y = await subject({ dob: "1990-06-15", yearOnly: true });
      const [tomorrow] = await q(sql`select (current_date + 1)::text as d`);
      for (const date of [null, String(tomorrow!.d), "1899-12-31"]) {
        await refusedWithNoWrite(orgMain, p, () => record(p, "other_participant_enrolled", date), "date_out_of_range");
      }
      await refusedWithNoWrite(orgMain, p, () => record(p, "other_participant_enrolled", "1990-06-14"), "date_out_of_range");
      await refusedWithNoWrite(orgMain, y, () => record(y, "other_participant_enrolled", "1989-12-31"), "date_out_of_range");
      expect((await record(y, "other_participant_enrolled", "1990-01-01")).outcome).toBe("ok");
      expect((await record(p, "other_participant_enrolled", "1990-06-15")).outcome).toBe("ok");
    });

    it("person_not_found: an unknown id, a person at another organization, a merged person", async () => {
      const elsewhere = await subject({ org: orgOther });
      const merged = await subject();
      const survivor = await makePerson("Survivor");
      await q(sql`update people set merged_into_id = ${survivor} where id = ${merged}`);
      await refusedWithNoWrite(orgMain, merged, () => record(merged, "other_participant_enrolled", "2025-01-01"), "person_not_found");
      await refusedWithNoWrite(orgOther, elsewhere, () => record(elsewhere, "other_participant_enrolled", "2025-01-01"), "person_not_found");
      const row = await record("00000000-0000-4000-8000-00000000dead", "other_participant_enrolled", "2025-01-01");
      expect(row.outcome).toBe("person_not_found");
    });

    it("person_deceased, membership_ended", async () => {
      const dead = await subject({ deceased: "2024-01-01" });
      await refusedWithNoWrite(orgMain, dead, () => record(dead, "other_participant_enrolled", "2023-01-01"), "person_deceased");
      const ended = await subject({ endedOn: "2024-01-01" });
      await refusedWithNoWrite(orgMain, ended, () => record(ended, "other_participant_enrolled", "2023-01-01"), "membership_ended");
    });

    it("pending_action: any pending roll action at this organization, for enrolment and removal", async () => {
      const p = await subject();
      await ownerInsertRoll({ person: p, kind: "profession_of_faith", date: "2025-01-01", roll: "active", status: "pending" });
      await refusedWithNoWrite(orgMain, p, () => record(p, "other_participant_enrolled", "2025-02-01"), "pending_action");
      const q2 = await subject();
      expect((await record(q2, "other_participant_enrolled", "2025-01-01")).outcome).toBe("ok");
      await ownerInsertRoll({ person: q2, kind: "profession_of_faith", date: "2025-06-01", roll: "active", status: "pending" });
      await refusedWithNoWrite(orgMain, q2, () => record(q2, "other_participant_removed", "2025-07-01"), "pending_action");
    });

    it("already_participant, on_member_roll (active, baptized, affiliate)", async () => {
      const p = await subject();
      expect((await record(p, "other_participant_enrolled", "2025-01-01")).outcome).toBe("ok");
      await refusedWithNoWrite(orgMain, p, () => record(p, "other_participant_enrolled", "2025-02-01"), "already_participant");
      for (const roll of ["active", "baptized", "affiliate"]) {
        const m = await subject({ engagement: "regular" });
        await ownerInsertRoll({ person: m, kind: "opening_balance", date: "2020-01-01", roll });
        await refusedWithNoWrite(orgMain, m, () => record(m, "other_participant_enrolled", "2025-01-01"), "on_member_roll");
      }
    });

    it("not_participant: removal of a visitor, of a member, and of someone whose enrolment was undone", async () => {
      const visitor = await subject();
      await refusedWithNoWrite(orgMain, visitor, () => record(visitor, "other_participant_removed", "2025-01-01"), "not_participant");
      const member = await subject({ engagement: "regular" });
      await ownerInsertRoll({ person: member, kind: "opening_balance", date: "2020-01-01", roll: "active" });
      await refusedWithNoWrite(orgMain, member, () => record(member, "other_participant_removed", "2025-01-01"), "not_participant");
      const undone = await subject();
      const e = await record(undone, "other_participant_enrolled", "2025-01-01");
      expect((await undo(String(e.roll_action_id), "entered in error")).outcome).toBe("ok");
      await refusedWithNoWrite(orgMain, undone, () => record(undone, "other_participant_removed", "2025-02-01"), "not_participant");
    });

    it("date_before_latest_action: enrolment before an earlier history row, removal before the enrolment (R11); the same date is allowed", async () => {
      // History: an approved loss on 2024-05-01 (replay null), so enrolment is otherwise legal.
      const r = await subject({ engagement: "regular" });
      await ownerInsertRoll({ person: r, kind: "opening_balance", date: "2020-01-01", roll: "active" });
      await ownerInsertRoll({ person: r, kind: "other_loss", date: "2024-05-01", roll: null });
      await refusedWithNoWrite(orgMain, r, () => record(r, "other_participant_enrolled", "2024-04-30"), "date_before_latest_action");
      expect((await record(r, "other_participant_enrolled", "2024-05-01")).outcome).toBe("ok");
      await refusedWithNoWrite(orgMain, r, () => record(r, "other_participant_removed", "2024-04-30"), "date_before_latest_action");
    });

    it("holds_position: an open staff position (pre-check), an open person-arm role grant (memberships_guard_end, caught); never ends the grant", async () => {
      const staff = await subject();
      expect((await record(staff, "other_participant_enrolled", "2025-01-01")).outcome).toBe("ok");
      await q(sql`
        insert into staff_positions (organization_id, person_id, position, position_key, starts_on)
        values (${orgMain}, ${staff}, 'Organist', 'organist', '2025-01-01')`);
      await refusedWithNoWrite(orgMain, staff, () => record(staff, "other_participant_removed", "2025-06-01"), "holds_position");

      const granted = await subject();
      expect((await record(granted, "other_participant_enrolled", "2025-01-01")).outcome).toBe("ok");
      const role = await makeRole(orgMain, `prt_usher_${counter++}`, ["events.view"]);
      await grant(orgMain, role, granted);
      await refusedWithNoWrite(orgMain, granted, () => record(granted, "other_participant_removed", "2025-06-01"), "holds_position");
      const [g] = await q(sql`select ends_on from role_grants where person_id = ${granted} and role_id = ${role}`);
      expect(g!.ends_on).toBeNull();
    });

    it("self_target: the actor cannot remove themselves", async () => {
      const selfUser = await makeUser("self");
      const selfPerson = await subject({ userId: selfUser });
      await grant(orgMain, proposeRoleMain, selfPerson);
      expect((await record(selfPerson, "other_participant_enrolled", "2025-01-01", { user: selfUser })).outcome).toBe("ok");
      await refusedWithNoWrite(orgMain, selfPerson,
        () => record(selfPerson, "other_participant_removed", "2025-06-01", { user: selfUser }), "self_target");
      // Removal by someone else is fine except that the person holds a role grant here.
      expect((await record(selfPerson, "other_participant_removed", "2025-06-01")).outcome).toBe("holds_position");
    });

    it("provisioning_incomplete (S4): enrolment and removal at an organization with no derived active_membership group, nothing written", async () => {
      const p = await makePerson("Bare");
      await addMembershipAtBare(orgBare, p, "visitor");
      await refusedWithNoWrite(orgBare, p,
        () => record(p, "other_participant_enrolled", "2025-01-01", { org: orgBare, user: bareActorUser }), "provisioning_incomplete");
      // A participant there (owner insert with the sync trigger off inside one transaction).
      const r = await makePerson("Bareremove");
      await addMembershipAtBare(orgBare, r, "visitor");
      await platform.transaction(async (tx) => {
        await tx.execute(sql`alter table roll_actions disable trigger roll_actions_sync_current`);
        await tx.execute(sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
          values (${orgBare}, ${r}, 'other_participant_enrolled', '2025-01-01', 'other_participant', 'approved')`);
        await tx.execute(sql`alter table roll_actions enable trigger roll_actions_sync_current`);
      });
      await refusedWithNoWrite(orgBare, r,
        () => record(r, "other_participant_removed", "2025-06-01", { org: orgBare, user: bareActorUser }), "provisioning_incomplete");
    });
  });

  // =========================================================================
  // Row shape, replay, and the downstream effects of a removal (1.3)
  // =========================================================================
  describe("row shape and replay", () => {
    it("an enrolment writes one approved row with the derived fields, sets the cache, counts in the SASR, adds no gain line, leaves no drift", async () => {
      const p = await subject({ dob: "2000-02-29" });
      const [before] = await q(sql`select * from presby_roll_counts_as_of(${orgMain})`);
      const changesBefore = await q(sql`select line, count from presby_roll_changes(${orgMain}, '2025-01-01', current_date) order by line`);
      expect(await drift(orgMain, p)).toBe(0);

      const row = await record(p, "other_participant_enrolled", "2025-02-28", { minute: "  Session 2025-02, item 4  " });
      expect(row).toMatchObject({ outcome: "ok", membership_ended: false, affects_filed_period: false });
      const ra = await rollRow(String(row.roll_action_id));
      expect(ra).toMatchObject({
        organization_id: orgMain, person_id: p, kind: "other_participant_enrolled", effective_date: "2025-02-28",
        resulting_roll: "other_participant", age_at_action: 24, approval_status: "approved",
        minute_reference: "Session 2025-02, item 4", approved_by: actorUser, proposed_by: actorUser,
        voids_action_id: null, approved_today: true,
      });
      const s = await stateOf(orgMain, p);
      expect(s).toMatchObject({ current_roll: "other_participant", current_roll_since: "2025-02-28", ended_on: null, engagement_status: "visitor" });
      const [asOf] = await q(sql`select presby_roll_as_of(${p}, ${orgMain}) as r`);
      expect(asOf!.r).toBe("other_participant");
      const [after] = await q(sql`select * from presby_roll_counts_as_of(${orgMain})`);
      expect(Number(after!.other_participant)).toBe(Number(before!.other_participant) + 1);
      expect(Number(after!.total_adherents)).toBe(Number(before!.total_adherents) + 1);
      expect(Number(after!.active)).toBe(Number(before!.active));
      const changesAfter = await q(sql`select line, count from presby_roll_changes(${orgMain}, '2025-01-01', current_date) order by line`);
      expect(changesAfter).toEqual(changesBefore);
      expect(await drift(orgMain, p)).toBe(0);
    });

    it("a blank minute reference is stored as null; the pastoral axis is never written", async () => {
      const p = await subject({ engagement: "regular" });
      const row = await record(p, "other_participant_enrolled", "2025-01-01", { minute: "   " });
      expect((await rollRow(String(row.roll_action_id))).minute_reference).toBeNull();
      expect((await stateOf(orgMain, p)).engagement_status).toBe("regular");
    });

    it("a removal ends the membership on the marker, lapses the derived group row, and withOrgContext, resolveOrgContext and getDirectory all reflect it", async () => {
      const { withOrgContext, resolveOrgContext } = await import("@/lib/authz");
      const { getDirectory } = await import("@/lib/directory");
      const targetUser = await makeUser("target");
      const p = await subject({ userId: targetUser, engagement: "regular" });
      expect((await record(p, "other_participant_enrolled", "2025-01-01")).outcome).toBe("ok");

      const dirBefore = await getDirectory(actorPerson, orgMain);
      expect(dirBefore.kind).toBe("ok");
      expect((dirBefore as { entries: Array<{ personId: string }> }).entries.map((e) => e.personId)).toContain(p);
      await withOrgContext(p, orgMain, async () => undefined); // active now

      const [today] = await q(sql`select current_date::text as d`);
      const row = await record(p, "other_participant_removed", String(today!.d));
      expect(row).toMatchObject({ outcome: "ok", membership_ended: true });
      const ra = await rollRow(String(row.roll_action_id));
      expect(ra).toMatchObject({ kind: "other_participant_removed", resulting_roll: null, approval_status: "approved", effective_today: true });
      expect(await stateOf(orgMain, p)).toMatchObject({
        ended_on: String(today!.d), ended_reason: REMOVAL_MARKER, current_roll: null, group_ends_on: String(today!.d),
      });

      await expect(withOrgContext(p, orgMain, async () => undefined)).rejects.toThrow();
      const resolved = await resolveOrgContext(targetUser, orgMainSlug);
      expect(resolved).toMatchObject({ kind: "ended", endedOn: String(today!.d) });
      const dirAfter = await getDirectory(actorPerson, orgMain);
      expect((dirAfter as { entries: Array<{ personId: string }> }).entries.map((e) => e.personId)).not.toContain(p);
      expect(await drift(orgMain, p)).toBe(0);
    });

    it("the SQL age expression on a 29 February birthday (the table Batch B's deriveRollFields must match)", async () => {
      const cases: Array<[string, string, number]> = [
        ["2000-02-29", "2025-02-28", 24],
        ["2000-02-29", "2025-03-01", 25],
        ["2000-02-29", "2024-02-28", 23],
        ["2000-02-29", "2024-02-29", 24],
        ["2000-06-15", "2026-06-14", 25],
        ["2000-06-15", "2026-06-15", 26],
      ];
      for (const [dob, on, age] of cases) {
        const [r] = await q(sql`select date_part('year', age(${on}::date, ${dob}::date))::int as a`);
        expect(r!.a, `${dob} on ${on}`).toBe(age);
      }
    });
  });

  // =========================================================================
  // Void outcomes and mechanics (1.4)
  // =========================================================================
  describe("presby_void_participant_action", () => {
    async function voidRefused(p: string, run: () => Promise<Row>, outcome: string) {
      const before = await stateOf(orgMain, p);
      const row = await run();
      expect(row).toEqual({
        outcome, void_roll_action_id: null, voided_action_id: null, voided_kind: null,
        membership_reopened: false, affects_filed_period: false,
      });
      expect(await stateOf(orgMain, p)).toEqual(before);
    }

    it("undoing an enrolment returns the person to the prior replay state; the void row carries the target's person_id", async () => {
      const p = await subject();
      const e = await record(p, "other_participant_enrolled", "2025-01-01");
      const row = await undo(String(e.roll_action_id), "  entered for the wrong person  ");
      expect(row).toMatchObject({
        outcome: "ok", voided_action_id: e.roll_action_id, voided_kind: "other_participant_enrolled",
        membership_reopened: false, affects_filed_period: false,
      });
      const v = await rollRow(String(row.void_roll_action_id));
      expect(v).toMatchObject({
        kind: "void", person_id: p, voids_action_id: e.roll_action_id, approval_status: "approved",
        resulting_roll: null, age_at_action: null, approved_by: actorUser, proposed_by: actorUser,
        effective_today: true, approved_today: true,
      });
      expect(await stateOf(orgMain, p)).toMatchObject({ current_roll: null, ended_on: null, engagement_status: "visitor" });
      expect(await drift(orgMain, p)).toBe(0);
      // The original stays in the record, frozen.
      expect((await rollRow(String(e.roll_action_id))).approval_status).toBe("approved");
    });

    it("undoing a removal reopens the membership and the derived group row on the marker, and the person is a participant again", async () => {
      const p = await subject();
      expect((await record(p, "other_participant_enrolled", "2025-01-01")).outcome).toBe("ok");
      const r = await record(p, "other_participant_removed", "2025-06-01");
      const row = await undo(String(r.roll_action_id), "removed by mistake");
      expect(row).toMatchObject({ outcome: "ok", voided_kind: "other_participant_removed", membership_reopened: true });
      expect(await stateOf(orgMain, p)).toMatchObject({
        ended_on: null, ended_reason: null, current_roll: "other_participant", group_ends_on: null,
      });
      expect(await drift(orgMain, p)).toBe(0);
    });

    it("reason_required, reason_too_long, action_not_found (unknown id, another organization's row)", async () => {
      const p = await subject();
      const e = await record(p, "other_participant_enrolled", "2025-01-01");
      const id = String(e.roll_action_id);
      await voidRefused(p, () => undo(id, "   "), "reason_required");
      await voidRefused(p, () => undo(id, null), "reason_required");
      await voidRefused(p, () => undo(id, "x".repeat(501)), "reason_too_long");
      await voidRefused(p, () => undo("00000000-0000-4000-8000-00000000dead", "why"), "action_not_found");
      const elsewhere = await subject({ org: orgOther });
      const otherId = await ownerInsertRoll({ org: orgOther, person: elsewhere, kind: "other_participant_enrolled", date: "2025-01-01", roll: "other_participant" });
      await voidRefused(p, () => undo(otherId, "why"), "action_not_found");
      expect((await undo(id, "x".repeat(500))).outcome).toBe("ok");
    });

    it("not_on_record_kind: a pending row, a void row, an approved membership-roll action", async () => {
      const p = await subject({ engagement: "regular" });
      const pending = await ownerInsertRoll({ person: p, kind: "profession_of_faith", date: "2025-01-01", roll: "active", status: "pending" });
      await voidRefused(p, () => undo(pending, "why"), "not_on_record_kind");
      const m = await subject({ engagement: "regular" });
      const gain = await ownerInsertRoll({ person: m, kind: "profession_of_faith", date: "2025-01-01", roll: "active" });
      await voidRefused(m, () => undo(gain, "why"), "not_on_record_kind");
      const v = await subject();
      const e = await record(v, "other_participant_enrolled", "2025-01-01");
      const voided = await undo(String(e.roll_action_id), "first");
      await voidRefused(v, () => undo(String(voided.void_roll_action_id), "void the void"), "not_on_record_kind");
    });

    it("already_voided: an approved void, and a live pending void (the S3 index caught as the same outcome)", async () => {
      const p = await subject();
      const e = await record(p, "other_participant_enrolled", "2025-01-01");
      expect((await undo(String(e.roll_action_id), "first")).outcome).toBe("ok");
      await voidRefused(p, () => undo(String(e.roll_action_id), "second"), "already_voided");

      const q2 = await subject();
      const e2 = await record(q2, "other_participant_enrolled", "2025-01-01");
      await ownerInsertRoll({ person: q2, kind: "void", date: "2025-02-01", roll: null, status: "pending", voids: String(e2.roll_action_id) });
      const before = await stateOf(orgMain, q2);
      expect((await undo(String(e2.roll_action_id), "racing a pending void")).outcome).toBe("already_voided");
      expect(await stateOf(orgMain, q2)).toEqual(before);
    });

    it("not_latest_action: an enrolment followed by a later effective action cannot be undone", async () => {
      const p = await subject();
      const e = await record(p, "other_participant_enrolled", "2025-01-01");
      expect((await record(p, "other_participant_removed", "2025-06-01")).outcome).toBe("ok");
      await voidRefused(p, () => undo(String(e.roll_action_id), "why"), "not_latest_action");
    });

    it("membership_changed: the removal's date or marker no longer matches, or the membership was already reopened", async () => {
      const cases: Array<(p: string) => SQL> = [
        (p) => sql`update memberships set ended_on = '2025-07-01' where organization_id = ${orgMain} and person_id = ${p}`,
        (p) => sql`update memberships set ended_reason = 'moved away' where organization_id = ${orgMain} and person_id = ${p}`,
        (p) => sql`update memberships set ended_on = null, ended_reason = null where organization_id = ${orgMain} and person_id = ${p}`,
      ];
      for (const change of cases) {
        const p = await subject();
        expect((await record(p, "other_participant_enrolled", "2025-01-01")).outcome).toBe("ok");
        const r = await record(p, "other_participant_removed", "2025-06-01");
        await q(change(p));
        await voidRefused(p, () => undo(String(r.roll_action_id), "why"), "membership_changed");
      }
    });

    it("provisioning_incomplete (S4): an undo at an organization with no derived group, nothing written", async () => {
      const p = await makePerson("Bareundo");
      await addMembershipAtBare(orgBare, p, "visitor");
      let target = "";
      await platform.transaction(async (tx) => {
        await tx.execute(sql`alter table roll_actions disable trigger roll_actions_sync_current`);
        const r = rowsOf(await tx.execute(sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
          values (${orgBare}, ${p}, 'other_participant_enrolled', '2025-01-01', 'other_participant', 'approved') returning id`));
        target = String(r[0]!.id);
        await tx.execute(sql`alter table roll_actions enable trigger roll_actions_sync_current`);
      });
      const before = await stateOf(orgBare, p);
      const row = await undo(target, "why", { org: orgBare, user: bareActorUser });
      expect(row.outcome).toBe("provisioning_incomplete");
      expect(await stateOf(orgBare, p)).toEqual(before);
    });
  });

  // =========================================================================
  // affects_filed_period (R12), rolled back
  // =========================================================================
  describe("affects_filed_period", () => {
    it("true for a live filed return in a year on or after the pivot; false after it, and false for a withdrawn return; undo pivots on the voided row's date", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        const presbySlug = `prt-fp-${stamp}`;
        const recipient = String(rowsOf(await tx.execute(sql`
          insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
          values ('presbytery', 'Fixture recipient', ${presbySlug}, ${presbySlug.replace(/-/g, "_")}, 'unmanaged', ${fixtureDeletableUntil()})
          returning id`))[0]!.id);
        await tx.execute(sql`select set_config('presby.publication_write_active', 'true', true)`);
        const ret = String(rowsOf(await tx.execute(sql`
          insert into statistical_returns (organization_id, about_org_id, report_year, form_version_key, provenance, payload, reconciled, attested_at)
          values (${orgMain}, ${orgMain}, 2024, '2024', 'submitted', '{}', true, now()) returning id`))[0]!.id);
        const pub = String(rowsOf(await tx.execute(sql`
          insert into publications (organization_id, recipient_org_id, record_class, artifact_id, minute_reference)
          values (${orgMain}, ${recipient}, 'statistical_return', ${ret}, 'fixture') returning id`))[0]!.id);
        await tx.execute(sql`select set_config('presby.publication_write_active', 'false', true)`);
        await tx.execute(sql`select set_config('app.current_org_id', ${orgMain}, true)`);

        const mk = async () => {
          const p = String(rowsOf(await tx.execute(sql`
            insert into people (first_name, last_name, deletable_until) values ('Filed', ${`Subject${stamp}`}, ${fixtureDeletableUntil()}) returning id`))[0]!.id);
          await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgMain}, ${p}, 'visitor')`);
          return p;
        };
        const call = async (query: SQL) => rowsOf(await tx.execute(query))[0]!;

        const a = await mk();
        const inYear = await call(recordSql(a, "other_participant_enrolled", "2024-06-01", actorUser));
        expect(inYear).toMatchObject({ outcome: "ok", affects_filed_period: true });
        const b = await mk();
        const before = await call(recordSql(b, "other_participant_enrolled", "2023-06-01", actorUser));
        expect(before).toMatchObject({ outcome: "ok", affects_filed_period: true });
        const c = await mk();
        const afterYear = await call(recordSql(c, "other_participant_enrolled", "2025-01-01", actorUser));
        expect(afterYear).toMatchObject({ outcome: "ok", affects_filed_period: false });
        // Undo pivots on the voided row's date (2024), not today.
        const undoA = await call(voidSql(String(inYear.roll_action_id), "why", actorUser));
        expect(undoA).toMatchObject({ outcome: "ok", affects_filed_period: true });
        const undoC = await call(voidSql(String(afterYear.roll_action_id), "why", actorUser));
        expect(undoC).toMatchObject({ outcome: "ok", affects_filed_period: false });

        // A withdrawn return does not count.
        await tx.execute(sql`select set_config('presby.withdrawal_write_active', 'true', true)`);
        await tx.execute(sql`
          update publications set withdrawn_at = now(), withdrawn_by = ${actorUser}, withdrawn_minute_reference = 'fixture'
           where id = ${pub}`);
        await tx.execute(sql`select set_config('presby.withdrawal_write_active', 'false', true)`);
        const d = await mk();
        const withdrawn = await call(recordSql(d, "other_participant_enrolled", "2024-06-01", actorUser));
        expect(withdrawn).toMatchObject({ outcome: "ok", affects_filed_period: false });
      });
    });
  });

  // =========================================================================
  // Concurrency (R6)
  // =========================================================================
  describe("concurrency", () => {
    it("two racing enrolments give one ok and one already_participant; two racing undos give one ok", async () => {
      const p = await subject();
      const results = await Promise.all([
        record(p, "other_participant_enrolled", "2025-01-01"),
        record(p, "other_participant_enrolled", "2025-01-01"),
      ]);
      expect(results.map((r) => r.outcome).sort()).toEqual(["already_participant", "ok"]);
      expect((await stateOf(orgMain, p)).roll_rows).toBe(1);

      const okRow = results.find((r) => r.outcome === "ok")!;
      const undos = await Promise.all([
        undo(String(okRow.roll_action_id), "race one"),
        undo(String(okRow.roll_action_id), "race two"),
      ]);
      const outcomes = undos.map((r) => r.outcome).sort();
      expect(outcomes[1]).toBe("ok");
      expect(["already_voided", "not_latest_action"]).toContain(outcomes[0]);
      expect((await stateOf(orgMain, p)).roll_rows).toBe(2);
      expect(await drift(orgMain, p)).toBe(0);
    });
  });

  // =========================================================================
  // Source scans of the migration (1.8, SQL half; Batch B pins TypeScript to these)
  // =========================================================================
  describe("source scan of drizzle/0061", () => {
    function functionBody(text: string, name: string): string {
      const start = text.indexOf(`create or replace function ${name}(`);
      const end = text.indexOf("end $$;", start);
      expect(start).toBeGreaterThan(-1);
      return text.slice(start, end);
    }
    const text = () => readFileSync(MIGRATION_PATH, "utf8");
    const outcomesIn = (body: string) =>
      [...new Set([...body.matchAll(/(?:outcome|v_outcome) := '([a-z_]+)'/g)].map((m) => m[1]))].sort();

    it("the record function's outcome vocabulary is exactly the closed list", () => {
      expect(outcomesIn(functionBody(text(), "presby_record_participant_action"))).toEqual([...RECORD_OUTCOMES].sort());
    });

    it("the void function's outcome vocabulary is exactly the closed list", () => {
      expect(outcomesIn(functionBody(text(), "presby_void_participant_action"))).toEqual([...VOID_OUTCOMES].sort());
    });

    it("the on-record kinds are exactly other_participant_enrolled and other_participant_removed, and the removal marker is fixed", () => {
      const body = functionBody(text(), "presby_record_participant_action");
      const m = body.match(/p_kind not in \(([^)]*)\)/);
      expect(m).not.toBeNull();
      expect(m![1]!.split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([
        "other_participant_enrolled", "other_participant_removed",
      ]);
      expect(body).toContain(`ended_reason = '${REMOVAL_MARKER}'`);
      expect(functionBody(text(), "presby_void_participant_action")).toContain(`is distinct from '${REMOVAL_MARKER}'`);
    });

    it("neither function takes an organization parameter: the org is presby_current_org()", () => {
      for (const name of ["presby_record_participant_action", "presby_void_participant_action"]) {
        const body = functionBody(text(), name);
        const params = body.slice(body.indexOf("("), body.indexOf("returns table"));
        expect(params).not.toMatch(/organization|p_org/);
        expect(body).toContain("v_org uuid := presby_current_org();");
      }
    });

    it("the migration deletes nothing (R14)", () => {
      const code = text().split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
      expect(code).not.toMatch(/\bdelete\s+from\b/i);
      expect(code).not.toMatch(/\btruncate\b/i);
    });
  });
});
