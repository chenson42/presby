/**
 * drizzle/0062_presby_session_approval.sql, proven against a real database
 * (docs/work-log/2026-10-22-founding-admin-directory.md, Increment 2 Phase 3
 * Test Plan 1.1-1.8 and the SQL half of 1.9-1.10; DECISION-202, DECISION-203,
 * DECISION-205, DECISION-206; F180, F181, F184, F188, F189).
 *
 * Two connections, on purpose:
 *   - `presby_app` (`db`, RLS enforced, NOBYPASSRLS) for everything the
 *     application path does: calling the two decision definers under an org
 *     GUC, and the identity literal;
 *   - the owner (`getPlatformDb()`) for fixtures and for checks the tenant
 *     connection cannot make (the freeze trigger on the owner path, the
 *     migration's own sections replayed against fixtures). Owner checks that
 *     must not persist run inside a transaction that is always rolled back
 *     (`inRolledBackOwnerTx`).
 *
 * This file passes in both the 0062-only state and the 0063 lockdown state:
 * it never relies on presby_app's UPDATE or DELETE. 0063 itself is proven in
 * roll-decide-lockdown.db.test.ts.
 *
 * The outcome, kind and office lists below are the TypeScript constants the
 * application uses (src/lib/roll-action-kinds.ts, src/lib/officer-offices.ts),
 * imported rather than retyped, so the SQL is proven against the same lists
 * the code is. (Batch A carried SQL-literal copies until those modules
 * existed.)
 *
 * Fixtures: synthetic names, `example.invalid` addresses (No Real Data);
 * organizations and people are stamped `deletable_until` at insert. Teardown
 * deletes the stamped organizations, whose cascade removes their memberships,
 * terms, roles and roll rows; decided roll rows are frozen by
 * roll_actions_freeze, so teardown disables that trigger around the cascade
 * (as roll.test.ts and participant-roll.db.test.ts do), and
 * group_memberships_reject_derived as every DB suite does.
 *
 * Run with (serial, per docs/testing.md):
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/db/domain/session-approval.db.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";
import { rowsOf, type Row } from "@/lib/testing/invitation-fixture";
import {
  APPROVABLE_ROLL_ACTION_KINDS,
  COUNTED_GAIN_KINDS,
  ROLL_DECISION_REFUSALS,
  ROLL_WITHDRAW_REFUSALS,
} from "@/lib/roll-action-kinds";
import { OFFICER_OFFICES, PASTOR_OFFICES, SESSION_OFFICES } from "@/lib/officer-offices";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 90_000, hookTimeout: 240_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);

const M62 = path.join(process.cwd(), "drizzle", "0062_presby_session_approval.sql");
const M63 = path.join(process.cwd(), "drizzle", "0063_presby_roll_decide_lockdown.sql");
const DENY_LITERAL = "roll_actions: this roll decision is not permitted";

// The ground truth Batch A pinned its SQL to was a set of literal lists; Batch B
// replaced them with the TypeScript constants the application actually uses
// (src/lib/roll-action-kinds.ts, src/lib/officer-offices.ts), so this file now
// proves the SQL against the SAME lists the code does.
const DECIDE_OUTCOMES = ["ok", ...ROLL_DECISION_REFUSALS] as const;
const WITHDRAW_OUTCOMES = ["ok", ...ROLL_WITHDRAW_REFUSALS] as const;
const APPROVABLE_KINDS = APPROVABLE_ROLL_ACTION_KINDS;

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
function pgField(err: unknown, field: string): string | undefined {
  for (const e of chain(err)) {
    const v = (e as Record<string, unknown>)[field];
    if (typeof v === "string") return v;
  }
  return undefined;
}
function pgMessages(err: unknown): string {
  return chain(err)
    .map((e) => (e instanceof Error ? e.message : String(e)))
    .join(" :: ");
}
function pgMessage(err: unknown): string | undefined {
  const withCode = chain(err).filter((e) => typeof (e as { code?: unknown }).code === "string");
  const last = withCode[withCode.length - 1];
  return last instanceof Error ? last.message : undefined;
}

/** The text of one numbered section of a migration (`-- N. title` to the next). */
function section(file: string, n: number): string {
  const text = readFileSync(file, "utf8");
  const start = text.search(new RegExp(`^-- ${n}\\. `, "m"));
  const end = text.search(new RegExp(`^-- ${n + 1}\\. `, "m"));
  if (start < 0 || end < 0) throw new Error(`section ${n} not found in ${path.basename(file)}`);
  return text.slice(start, end);
}

function functionBody(text: string, name: string): string {
  const start = text.indexOf(`create or replace function ${name}(`);
  const end = text.indexOf("end $$;", start);
  if (start < 0 || end < 0) throw new Error(`function ${name} not found`);
  return text.slice(start, end);
}

/** The quoted literals of the first `<lead> (...)` list in `body`. */
function quotedList(body: string, lead: string): string[] {
  const at = body.indexOf(lead);
  if (at < 0) throw new Error(`"${lead}" not found`);
  const open = body.indexOf("(", at + lead.length - 1);
  const close = body.indexOf(")", open);
  return [...body.slice(open, close).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe.skipIf(!hasDb)("drizzle/0062 session approval (Postgres-backed)", () => {
  let platform: Db;
  let appDb: typeof import("@/lib/db").db;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let counter = 0;
  const orgIds: string[] = [];
  const personIds: string[] = [];
  const userIds: string[] = [];

  let rosterTypeId: string;
  let courtTypeId: string;

  let orgMain: string;
  let orgOther: string;
  let orgBare: string; // no derived groups at all (S4)

  let approverUser: string; // ruling elder at orgMain: roll.approve through the Session
  let approverPerson: string;
  let pastorUser: string; // installed pastor at orgMain, no roll: roll.approve through the Session (DECISION-206)
  let pastorPerson: string;
  let proposerUser: string; // roll.propose only (person arm)
  let proposerPerson: string;
  let noPermUser: string;
  let noPersonUser: string;
  let mergedUser: string;
  let otherOrgUser: string; // ruling elder at orgOther only
  let bareApproverUser: string;

  async function q(query: SQL): Promise<Row[]> {
    return rowsOf(await platform.execute(query));
  }

  async function makeUser(tag: string): Promise<string> {
    counter += 1;
    const [row] = await q(sql`
      insert into users (email, name)
      values (${`sap-${tag}-${stamp}-${counter}@example.invalid`}, 'Session Approval Fixture')
      returning id`);
    userIds.push(String(row!.id));
    return String(row!.id);
  }

  /** A congregation in the groupSeedPlan() shape, with the baseline session_member role (DECISION-202). */
  async function makeCongregation(tag: string, opts: { groups?: boolean } = {}): Promise<string> {
    counter += 1;
    const slug = `sap-${tag}-${stamp}-${counter}`;
    const [row] = await q(sql`
      insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
      values ('congregation', ${`Fixture ${tag} for session-approval`}, ${slug},
              ${slug.replace(/-/g, "_")}, 'managed', ${fixtureDeletableUntil()})
      returning id`);
    const id = String(row!.id);
    orgIds.push(id);
    if (opts.groups === false) return id;
    await q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      values (${id}, ${courtTypeId}, 'Session', 'derived', 'session', true),
             (${id}, ${courtTypeId}, 'Board of Deacons', 'derived', 'diaconate', true),
             (${id}, ${rosterTypeId}, 'Active Membership', 'derived', 'active_membership', true)`);
    const [role] = await q(sql`
      insert into app_roles (organization_id, key, name, role_kind, is_protected)
      values (${id}, 'session_member', 'Session member', 'constitutional', true) returning id`);
    await q(sql`insert into app_role_permissions (role_id, permission_key) values (${role!.id}, 'roll.approve')`);
    await q(sql`
      insert into role_grants (organization_id, role_id, group_id, starts_on)
      select ${id}, ${role!.id}, g.id, '2000-01-01' from groups g
       where g.organization_id = ${id} and g.derived_from = 'session'`);
    return id;
  }

  async function makePerson(first: string, opts: { dob?: string; userId?: string; deceased?: string } = {}) {
    counter += 1;
    const [row] = await q(sql`
      insert into people (first_name, last_name, date_of_birth, user_id, date_of_death, deletable_until)
      values (${first}, ${`Quenby${stamp}${counter}`}, ${opts.dob ?? null}::date,
              ${opts.userId ?? null}::uuid, ${opts.deceased ?? null}::date, ${fixtureDeletableUntil()})
      returning id`);
    personIds.push(String(row!.id));
    return String(row!.id);
  }

  async function addMembership(org: string, person: string, opts: { engagement?: string; endedOn?: string } = {}) {
    await q(sql`
      insert into memberships (organization_id, person_id, engagement_status, ended_on)
      values (${org}, ${person}, ${opts.engagement ?? "visitor"}, ${opts.endedOn ?? null}::date)`);
  }

  /** A membership at an org with NO derived group (the trigger would refuse it). */
  async function addMembershipAtBare(org: string, person: string) {
    await platform.transaction(async (tx) => {
      await tx.execute(sql`alter table memberships disable trigger memberships_sync_derived_group`);
      await tx.execute(sql`
        insert into memberships (organization_id, person_id, engagement_status)
        values (${org}, ${person}, 'regular')`);
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

  async function term(org: string, person: string, office: string, startsOn = "2020-01-01", endsOn: string | null = null) {
    const [row] = await q(sql`
      insert into officer_terms (organization_id, person_id, office, starts_on, ends_on)
      values (${org}, ${person}, ${office}, ${startsOn}::date, ${endsOn}::date) returning id`);
    return String(row!.id);
  }

  /** A fresh subject at `org` (default: a visitor at orgMain). */
  async function subject(opts: { org?: string; dob?: string; engagement?: string; endedOn?: string; deceased?: string; userId?: string } = {}) {
    const person = await makePerson("Subject", opts);
    await addMembership(opts.org ?? orgMain, person, { engagement: opts.engagement, endedOn: opts.endedOn });
    return person;
  }

  async function ownerInsertRoll(values: {
    org?: string; person: string; kind: string; date: string; roll: string | null;
    status?: string; voids?: string | null; proposedBy?: string | null; minute?: string | null;
  }): Promise<string> {
    const [row] = await q(sql`
      insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll,
                                approval_status, voids_action_id, proposed_by, minute_reference, recorded_at)
      values (${values.org ?? orgMain}, ${values.person}, ${values.kind}::roll_action_kind, ${values.date}::date,
              ${values.roll}, ${values.status ?? "pending"}, ${values.voids ?? null}::uuid,
              ${values.proposedBy ?? null}::uuid, ${values.minute ?? null}, clock_timestamp())
      returning id`);
    return String(row!.id);
  }

  /** A pending proposal of `kind` (resulting roll from the mapping) for `person`. */
  async function propose(person: string, kind = "profession_of_faith", date = "2025-01-05",
    opts: { org?: string; proposedBy?: string | null; minute?: string | null } = {}) {
    const roll = kind === "baptized_member_enrolled" ? "baptized"
      : kind === "affiliate_received" ? "affiliate"
      : kind === "other_participant_enrolled" ? "other_participant"
      : (COUNTED_GAIN_KINDS as readonly string[]).includes(kind) ? "active" : null;
    return ownerInsertRoll({
      org: opts.org, person, kind, date, roll, minute: opts.minute,
      proposedBy: opts.proposedBy === undefined ? proposerUser : opts.proposedBy,
    });
  }

  async function asApp<T>(org: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      if (org) await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
      return fn(tx as unknown as Tx);
    });
  }

  function decideSql(id: string | null, decision: string | null, user: string | null,
    opts: { minute?: string | null; reason?: string | null } = {}) {
    return sql`select * from presby_decide_roll_action(${id}::uuid, ${decision}::text,
                 ${opts.minute ?? null}::text, ${opts.reason ?? null}::text, ${user}::uuid)`;
  }
  function withdrawSql(id: string | null, reason: string | null, user: string | null) {
    return sql`select * from presby_withdraw_roll_action(${id}::uuid, ${reason}::text, ${user}::uuid)`;
  }

  /** presby_decide_roll_action through presby_app, committed. */
  async function decide(id: string | null, decision: string | null,
    opts: { user?: string | null; org?: string | null; minute?: string | null; reason?: string | null } = {}): Promise<Row> {
    const org = opts.org === undefined ? orgMain : opts.org;
    const user = opts.user === undefined ? approverUser : opts.user;
    const rows = await asApp(org, async (tx) => rowsOf(await tx.execute(decideSql(id, decision, user, opts))));
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  /** presby_withdraw_roll_action through presby_app, committed. */
  async function withdraw(id: string | null, reason: string | null,
    opts: { user?: string | null; org?: string | null } = {}): Promise<Row> {
    const org = opts.org === undefined ? orgMain : opts.org;
    const user = opts.user === undefined ? proposerUser : opts.user;
    const rows = await asApp(org, async (tx) => rowsOf(await tx.execute(withdrawSql(id, reason, user))));
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
  async function rejected(tx: Tx, query: SQL): Promise<{ code?: string; text: string; constraint?: string }> {
    let caught: unknown;
    try {
      await tx.transaction(async (sp) => {
        await sp.execute(query);
      });
    } catch (err) {
      caught = err;
    }
    if (!caught) throw new Error("expected the statement to be rejected");
    return { code: pgCode(caught), text: pgMessages(caught), constraint: pgField(caught, "constraint") };
  }

  /** Everything a refusal must leave untouched for one person at one org. */
  async function stateOf(org: string, person: string): Promise<Row> {
    const [row] = await q(sql`
      select (select string_agg(ra.id::text || ':' || ra.approval_status || ':' || coalesce(ra.decided_by::text, '-')
                                || ':' || coalesce(ra.approved_by::text, '-') || ':' || coalesce(ra.minute_reference, '-')
                                || ':' || coalesce(ra.denial_reason, '-') || ':' || coalesce(ra.withdrawal_reason, '-'),
                                ',' order by ra.id)
                from roll_actions ra where ra.organization_id = ${org} and ra.person_id = ${person}) as roll_rows,
             m.ended_on::text as ended_on, m.current_roll, m.current_roll_since::text as current_roll_since,
             m.engagement_status,
             (select gm.ends_on::text from group_memberships gm where gm.membership_id = m.id) as group_ends_on
        from memberships m where m.organization_id = ${org} and m.person_id = ${person}`);
    return row!;
  }

  async function rollRow(id: string): Promise<Row> {
    const [row] = await q(sql`
      select id, person_id, kind::text as kind, effective_date::text as effective_date, resulting_roll,
             approval_status, minute_reference, approved_on::text as approved_on, approved_by,
             decided_by, (decided_at is not null) as has_decided_at, (approved_on = current_date) as approved_today,
             denial_reason, withdrawal_reason, proposed_by
        from roll_actions where id = ${id}`);
    return row!;
  }

  async function drift(org: string, person: string): Promise<number> {
    const [row] = await q(sql`
      select count(*)::int as n from presby_roll_cache_drift() d
       where d.organization_id = ${org} and d.person_id = ${person}`);
    return Number(row!.n);
  }

  async function changes(org: string, from: string, to: string): Promise<Record<string, number>> {
    const rows = await q(sql`select line, count from presby_roll_changes(${org}, ${from}::date, ${to}::date)`);
    return Object.fromEntries(rows.map((r) => [String(r.line), Number(r.count)]));
  }

  async function counts(org: string, asOf = "today"): Promise<Row> {
    const date = asOf === "today" ? sql`current_date` : sql`${asOf}::date`;
    const [row] = await q(sql`select * from presby_roll_counts_as_of(${org}, ${date})`);
    return row!;
  }

  /** Asserts a refusal outcome and that nothing changed for the person. */
  async function refusedWithNoWrite(person: string, run: () => Promise<Row>, outcome: string, org = orgMain) {
    const before = await stateOf(org, person);
    const r = await run();
    expect(r).toMatchObject({
      outcome, roll_action_id: null, subject_person_id: null,
    });
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === "boolean") expect(v, `${outcome}: ${k}`).toBe(false);
    }
    expect(await stateOf(org, person)).toEqual(before);
  }

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    platform = dbModule.getPlatformDb();
    appDb = dbModule.db;

    await q(sql`insert into group_types (key, name) values ('roster', 'Roster'), ('court', 'Court') on conflict do nothing`);
    const types = await q(sql`select id, key from group_types where key in ('roster', 'court')`);
    rosterTypeId = String(types.find((t) => t.key === "roster")!.id);
    courtTypeId = String(types.find((t) => t.key === "court")!.id);

    orgMain = await makeCongregation("main");
    orgOther = await makeCongregation("other");
    orgBare = await makeCongregation("bare", { groups: false });

    // The ruling elder: an active member whose open term seats them on the
    // Session, which carries the session_member role (roll.approve).
    approverUser = await makeUser("elder");
    approverPerson = await makePerson("Elder", { userId: approverUser });
    await addMembership(orgMain, approverPerson, { engagement: "regular" });
    await term(orgMain, approverPerson, "ruling_elder");

    // The installed pastor: the anchor link carries no roll (DECISION-206).
    pastorUser = await makeUser("pastor");
    pastorPerson = await makePerson("Pastor", { userId: pastorUser });
    await addMembership(orgMain, pastorPerson, { engagement: "staff" });
    await term(orgMain, pastorPerson, "installed_pastor", "2019-06-01");

    // The clerk-shaped proposer: roll.propose only.
    proposerUser = await makeUser("proposer");
    proposerPerson = await makePerson("Proposer", { userId: proposerUser });
    await addMembership(orgMain, proposerPerson, { engagement: "regular" });
    await grant(orgMain, await makeRole(orgMain, "sap_proposer", ["roll.propose"]), proposerPerson);

    noPermUser = await makeUser("noperm");
    const noPermPerson = await makePerson("Noperm", { userId: noPermUser });
    await addMembership(orgMain, noPermPerson, { engagement: "regular" });

    noPersonUser = await makeUser("noperson");

    // A roll.approve holder at orgMain whose person has been merged away.
    mergedUser = await makeUser("merged");
    const survivor = await makePerson("Survivor");
    const mergedPerson = await makePerson("Merged", { userId: mergedUser });
    await addMembership(orgMain, mergedPerson, { engagement: "regular" });
    await grant(orgMain, await makeRole(orgMain, "sap_merged_approver", ["roll.approve", "roll.propose"]), mergedPerson);
    await q(sql`update people set merged_into_id = ${survivor} where id = ${mergedPerson}`);

    // A ruling elder at ANOTHER organization only.
    otherOrgUser = await makeUser("other");
    const otherPerson = await makePerson("Otherelder", { userId: otherOrgUser });
    await addMembership(orgOther, otherPerson, { engagement: "regular" });
    await term(orgOther, otherPerson, "ruling_elder");

    // The bare org's approver (person-arm role, membership inserted with the
    // derived-group trigger off, because the org has no derived groups).
    bareApproverUser = await makeUser("bare");
    const barePerson = await makePerson("Bareelder", { userId: bareApproverUser });
    await addMembershipAtBare(orgBare, barePerson);
    await grant(orgBare, await makeRole(orgBare, "sap_bare_approver", ["roll.approve"]), barePerson);
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
    it("decide and withdraw are SECURITY DEFINER, search_path pinned (pg_temp last), executable by presby_app only; the helpers are shaped as designed", async () => {
      const rows = await q(sql`
        select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as config,
               has_function_privilege('presby_app', p.oid, 'execute') as app_exec,
               has_function_privilege('presby_platform', p.oid, 'execute') as platform_exec,
               has_function_privilege('public', p.oid, 'execute') as public_exec
          from pg_proc p
         where p.proname in ('presby_decide_roll_action', 'presby_withdraw_roll_action',
                             'presby_roll__actor_holds', 'presby_deny_roll_decision',
                             'presby_guard_pastor_no_roll')
         order by p.proname`);
      const by = Object.fromEntries(rows.map((r) => [r.proname, r]));
      for (const name of ["presby_decide_roll_action", "presby_withdraw_roll_action"]) {
        expect(by[name]).toMatchObject({ prosecdef: true, config: "search_path=public, pg_temp", app_exec: true, platform_exec: false, public_exec: false });
      }
      expect(by.presby_roll__actor_holds).toMatchObject({ prosecdef: true, config: "search_path=public, pg_temp", app_exec: false, public_exec: false });
      expect(by.presby_deny_roll_decision).toMatchObject({ prosecdef: false, app_exec: true, public_exec: false });
      expect(by.presby_guard_pastor_no_roll).toMatchObject({ prosecdef: true, config: "search_path=public, pg_temp", app_exec: false, public_exec: false });
      // The derived-group sync and the freeze stay invoker, as before.
      const invokers = await q(sql`
        select proname, prosecdef from pg_proc
         where proname in ('presby_sync_derived_group', 'presby_freeze_approved_roll_action') order by proname`);
      expect(invokers).toEqual([
        { proname: "presby_freeze_approved_roll_action", prosecdef: false },
        { proname: "presby_sync_derived_group", prosecdef: false },
      ]);
    });

    it("R5: decided_by (FK to users), decided_at and withdrawal_reason exist and are nullable; the reason CHECKs and the widened vocabulary are VALIDATED", async () => {
      const cols = await q(sql`
        select column_name, data_type, is_nullable from information_schema.columns
         where table_name = 'roll_actions' and column_name in ('decided_by', 'decided_at', 'withdrawal_reason')
         order by column_name`);
      expect(cols).toEqual([
        { column_name: "decided_at", data_type: "timestamp with time zone", is_nullable: "YES" },
        { column_name: "decided_by", data_type: "uuid", is_nullable: "YES" },
        { column_name: "withdrawal_reason", data_type: "text", is_nullable: "YES" },
      ]);
      const [fk] = await q(sql`
        select pg_get_constraintdef(oid) as def from pg_constraint
         where conrelid = 'roll_actions'::regclass and conname = 'roll_actions_decided_by_users_id_fk'`);
      expect(fk!.def).toBe("FOREIGN KEY (decided_by) REFERENCES users(id)");
      const checks = await q(sql`
        select conname, convalidated, pg_get_constraintdef(oid) as def from pg_constraint
         where conrelid = 'roll_actions'::regclass and contype = 'c'
           and conname in ('roll_actions_approval_status_allowed', 'roll_actions_denial_reason_only_when_denied',
                           'roll_actions_withdrawal_reason_only_when_withdrawn')
         order by conname`);
      expect(checks.map((c) => [c.conname, c.convalidated])).toEqual([
        ["roll_actions_approval_status_allowed", true],
        ["roll_actions_denial_reason_only_when_denied", true],
        ["roll_actions_withdrawal_reason_only_when_withdrawn", true],
      ]);
      expect(checks[0]!.def).toContain("'withdrawn'::text");
    });

    it("R7 and R1d: one pending per person is a partial unique index; the one-live-void index ignores denied AND withdrawn voids", async () => {
      const idx = await q(sql`
        select indexname, indexdef from pg_indexes
         where indexname in ('roll_actions_one_pending_per_person_idx', 'roll_actions_one_live_void_idx') order by indexname`);
      expect(idx).toHaveLength(2);
      expect(idx[0]!.indexdef).toBe(
        "CREATE UNIQUE INDEX roll_actions_one_live_void_idx ON public.roll_actions USING btree (voids_action_id) WHERE ((kind = 'void'::roll_action_kind) AND (approval_status = ANY (ARRAY['pending'::text, 'approved'::text])))");
      expect(idx[1]!.indexdef).toBe(
        "CREATE UNIQUE INDEX roll_actions_one_pending_per_person_idx ON public.roll_actions USING btree (organization_id, person_id) WHERE (approval_status = 'pending'::text)");
    });

    it("F188: officer_terms_office_allowed is VALIDATED and lists exactly the nine offices; officer_terms_pastor_no_roll is a BEFORE INSERT OR UPDATE OF person_id, office, ends_on trigger", async () => {
      const [chk] = await q(sql`
        select convalidated, pg_get_constraintdef(oid) as def from pg_constraint
         where conrelid = 'officer_terms'::regclass and conname = 'officer_terms_office_allowed'`);
      expect(chk!.convalidated).toBe(true);
      expect([...String(chk!.def).matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort()).toEqual([...OFFICER_OFFICES].sort());
      const [trg] = await q(sql`
        select pg_get_triggerdef(oid) as def, tgenabled from pg_trigger
         where tgrelid = 'officer_terms'::regclass and tgname = 'officer_terms_pastor_no_roll'`);
      expect(trg!.tgenabled).toBe("O");
      expect(trg!.def).toBe(
        "CREATE TRIGGER officer_terms_pastor_no_roll BEFORE INSERT OR UPDATE OF person_id, office, ends_on ON public.officer_terms FOR EACH ROW EXECUTE FUNCTION presby_guard_pastor_no_roll()");
    });
  });

  // =========================================================================
  // R8: terminal rows freeze on the OWNER path too; one pending per person
  // =========================================================================
  describe("terminal rows and one pending per person", () => {
    it("as the owner, UPDATE and DELETE of an approved, a denied and a withdrawn row raise check_violation; a pending DELETE still works for the owner", async () => {
      const p = await subject({ engagement: "regular" });
      await inRolledBackOwnerTx(async (tx) => {
        const ins = async (status: string, extra: SQL = sql``) =>
          String(rowsOf(await tx.execute(sql`
            insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status,
                                      decided_by, decided_at ${extra})
            values (${orgMain}, ${p}, 'other_gain', '2024-01-01', 'active', ${status}, ${approverUser}, now()
                    ${status === "denied" ? sql`, 'no'` : status === "withdrawn" ? sql`, 'mistake'` : sql``})
            returning id`))[0]!.id);
        const approved = await ins("approved");
        const denied = await ins("denied", sql`, denial_reason`);
        const withdrawn = await ins("withdrawn", sql`, withdrawal_reason`);
        for (const [id, label, msg] of [
          [approved, "approved", /approved actions are immutable/],
          [denied, "denied", /decided actions are immutable \(denied\)/],
          [withdrawn, "withdrawn", /decided actions are immutable \(withdrawn\)/],
        ] as const) {
          const u = await rejected(tx, sql`update roll_actions set minute_reference = 'edit' where id = ${id}`);
          expect(u.code, `update ${label}`).toBe("23514");
          expect(u.text, `update ${label}`).toMatch(msg);
          const d = await rejected(tx, sql`delete from roll_actions where id = ${id}`);
          expect(d.code, `delete ${label}`).toBe("23514");
          expect(d.text, `delete ${label}`).toMatch(msg);
        }
        const pending = String(rowsOf(await tx.execute(sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
          values (${orgMain}, ${p}, 'other_gain', '2025-01-01', 'active', 'pending') returning id`))[0]!.id);
        await tx.execute(sql`delete from roll_actions where id = ${pending}`);
        const left = rowsOf(await tx.execute(sql`select count(*)::int as n from roll_actions where id = ${pending}`));
        expect(left[0]!.n).toBe(0);
      });
    });

    it("a second pending row for one person is a unique_violation on roll_actions_one_pending_per_person_idx; another person or another org is unaffected", async () => {
      const p = await subject({ engagement: "regular" });
      await propose(p);
      await inRolledBackOwnerTx(async (tx) => {
        const err = await rejected(tx, sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
          values (${orgMain}, ${p}, 'reaffirmation', '2025-02-01', 'active', 'pending')`);
        expect(err.code).toBe("23505");
        expect(err.text).toContain("roll_actions_one_pending_per_person_idx");
      });
      // Also through presby_app (the proposal path the application uses).
      let caught: unknown;
      try {
        await asApp(orgMain, async (tx) => {
          await tx.execute(sql`
            insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, proposed_by)
            values (${orgMain}, ${p}, 'reaffirmation', '2025-02-01', 'active', 'pending', ${proposerUser})`);
        });
      } catch (err) {
        caught = err;
      }
      expect(pgCode(caught)).toBe("23505");
      expect(pgField(caught, "constraint")).toBe("roll_actions_one_pending_per_person_idx");
      const other = await subject({ engagement: "regular" });
      await propose(other);
    });

    it("a withdrawn or denied row releases the person (a new proposal is allowed), never enters presby_effective_roll_actions, and a withdrawn void does not block a live one", async () => {
      const p = await subject({ engagement: "regular" });
      const first = await propose(p);
      expect((await withdraw(first, "entered by mistake")).outcome).toBe("ok");
      const second = await propose(p);
      expect((await decide(second, "deny", { reason: "no minute" })).outcome).toBe("ok");
      await propose(p);
      const eff = await q(sql`select count(*)::int as n from presby_effective_roll_actions where person_id = ${p}`);
      expect(eff[0]!.n).toBe(0);

      await inRolledBackOwnerTx(async (tx) => {
        const target = String(rowsOf(await tx.execute(sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
          values (${orgMain}, ${p}, 'other_participant_enrolled', '2024-01-01', 'other_participant', 'approved') returning id`))[0]!.id);
        const voidRow = (status: string, extra: SQL) => sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, approval_status, voids_action_id,
                                    decided_by, decided_at, withdrawal_reason)
          values (${orgMain}, ${p}, 'void', '2026-01-01', ${status}, ${target}, ${approverUser}, now(), ${extra})`;
        await tx.execute(voidRow("withdrawn", sql`'mistake'`));
        // The withdrawn void is not live: an approved one is still allowed.
        await tx.execute(sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, approval_status, voids_action_id)
          values (${orgMain}, ${p}, 'void', '2026-01-02', 'approved', ${target})`);
        const dup = await rejected(tx, sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, approval_status, voids_action_id)
          values (${orgMain}, ${p}, 'void', '2026-01-03', 'approved', ${target})`);
        expect(dup.code).toBe("23505");
        expect(dup.text).toContain("roll_actions_one_live_void_idx");
      });
    });

    it("R5 CHECKs: a denial reason on a non-denied row and a withdrawal reason on a non-withdrawn row are refused", async () => {
      const p = await subject({ engagement: "regular" });
      await inRolledBackOwnerTx(async (tx) => {
        const bad1 = await rejected(tx, sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, denial_reason)
          values (${orgMain}, ${p}, 'other_gain', '2025-01-01', 'active', 'pending', 'editable')`);
        expect(bad1.text).toContain("roll_actions_denial_reason_only_when_denied");
        const bad2 = await rejected(tx, sql`
          insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status, withdrawal_reason,
                                    decided_by, decided_at)
          values (${orgMain}, ${p}, 'other_gain', '2025-01-01', 'active', 'denied', 'oops', ${approverUser}, now())`);
        expect(bad2.text).toContain("roll_actions_withdrawal_reason_only_when_withdrawn");
      });
    });
  });

  // =========================================================================
  // Identity (R1): one literal, SQLSTATE 42501, nothing written
  // =========================================================================
  describe("identity refusals", () => {
    it("decide: no org context, null actor, a user with no person, no roll.approve, a propose-only actor, another org's elder, a merged person; the org is never a parameter", async () => {
      const p = await subject({ engagement: "regular" });
      const id = await propose(p);
      const before = await stateOf(orgMain, p);
      await expectDenied(() => decide(id, "approve", { org: null }));
      await expectDenied(() => decide(id, "approve", { user: null }));
      await expectDenied(() => decide(id, "approve", { user: noPersonUser }));
      await expectDenied(() => decide(id, "approve", { user: noPermUser }));
      await expectDenied(() => decide(id, "approve", { user: proposerUser }));
      await expectDenied(() => decide(id, "deny", { user: proposerUser, reason: "x" }));
      await expectDenied(() => decide(id, "approve", { user: otherOrgUser }));
      await expectDenied(() => decide(id, "approve", { user: mergedUser }));
      // The orgMain elder under orgOther's context is not a member there.
      await expectDenied(() => decide(id, "approve", { org: orgOther }));
      // Identity before the decision and the reason: garbage still gets the literal.
      await expectDenied(() => decide(id, "maybe", { user: noPermUser }));
      await expectDenied(() => decide(id, "deny", { user: noPermUser, reason: "" }));
      expect(await stateOf(orgMain, p)).toEqual(before);
    });

    it("withdraw: no org context, null actor, a user with no person, an approve-only elder (no roll.propose), another org's elder, a merged person", async () => {
      const p = await subject({ engagement: "regular" });
      const id = await propose(p);
      const before = await stateOf(orgMain, p);
      await expectDenied(() => withdraw(id, "why", { org: null }));
      await expectDenied(() => withdraw(id, "why", { user: null }));
      await expectDenied(() => withdraw(id, "why", { user: noPersonUser }));
      await expectDenied(() => withdraw(id, "why", { user: approverUser }));
      await expectDenied(() => withdraw(id, "why", { user: otherOrgUser }));
      await expectDenied(() => withdraw(id, "why", { user: mergedUser }));
      await expectDenied(() => withdraw(id, "", { user: noPermUser }));
      expect(await stateOf(orgMain, p)).toEqual(before);
    });

    it("an elder whose membership has ended is refused (rolled back: guard_end is off only inside the transaction)", async () => {
      const p = await subject({ engagement: "regular" });
      const id = await propose(p);
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`alter table memberships disable trigger memberships_guard_end`);
        await tx.execute(sql`update memberships set ended_on = current_date - 1 where organization_id = ${orgMain} and person_id = ${approverPerson}`);
        await tx.execute(sql`select set_config('app.current_org_id', ${orgMain}, true)`);
        // Still seated on the Session (the derived row lapses only with the term); only the membership ended.
        const held = rowsOf(await tx.execute(sql`select presby_has_permission(${approverPerson}, ${orgMain}, 'roll.approve') as h`));
        expect(held[0]!.h).toBe(true);
        let caught: unknown;
        try {
          await tx.transaction(async (sp) => { await sp.execute(decideSql(id, "approve", approverUser)); });
        } catch (err) {
          caught = err;
        }
        expect(pgCode(caught)).toBe("42501");
        expect(pgMessage(caught)).toBe(DENY_LITERAL);
      });
    });

    it("presby_app cannot execute the owner-only actor helper or the pastor guard (no probe for who holds a key)", async () => {
      let caught: unknown;
      try {
        await asApp(orgMain, async (tx) => {
          await tx.execute(sql`select presby_roll__actor_holds(${orgMain}, ${approverUser}, 'roll.approve')`);
        });
      } catch (err) {
        caught = err;
      }
      expect(pgCode(caught)).toBe("42501");
      expect(pgMessages(caught)).toMatch(/permission denied for function/);
      // A trigger function cannot be called directly anyway; the grant is what documents intent.
      const [g] = await q(sql`select has_function_privilege('presby_app', 'presby_guard_pastor_no_roll()', 'execute') as x`);
      expect(g!.x).toBe(false);
    });
  });

  // =========================================================================
  // Decide outcomes (R3, R4, R6, R12)
  // =========================================================================
  describe("decide refusals", () => {
    it("invalid_decision, reason_required, reason_too_long, minute_reference_too_long (bounds in the database too, F184)", async () => {
      const p = await subject({ engagement: "regular" });
      const id = await propose(p);
      await refusedWithNoWrite(p, () => decide(id, "maybe"), "invalid_decision");
      await refusedWithNoWrite(p, () => decide(id, null), "invalid_decision");
      await refusedWithNoWrite(p, () => decide(id, "deny", { reason: "   " }), "reason_required");
      await refusedWithNoWrite(p, () => decide(id, "deny", { reason: null }), "reason_required");
      await refusedWithNoWrite(p, () => decide(id, "deny", { reason: "x".repeat(501) }), "reason_too_long");
      await refusedWithNoWrite(p, () => decide(id, "approve", { minute: "m".repeat(201) }), "minute_reference_too_long");
      // The bounds are after trimming: 500 and 200 are allowed.
      expect((await decide(id, "deny", { reason: `  ${"x".repeat(500)}  ` })).outcome).toBe("ok");
      expect((await rollRow(id)).denial_reason).toBe("x".repeat(500));
      const p2 = await subject({ engagement: "regular" });
      const id2 = await propose(p2);
      expect((await decide(id2, "approve", { minute: ` ${"m".repeat(200)} ` })).outcome).toBe("ok");
      expect((await rollRow(id2)).minute_reference).toBe("m".repeat(200));
    });

    it("not_found: an unknown id, another organization's pending row, a null id (indistinguishable)", async () => {
      const p = await subject({ engagement: "regular" });
      const id = await propose(p);
      const elsewhere = await subject({ org: orgOther, engagement: "regular" });
      const otherId = await propose(elsewhere, "profession_of_faith", "2025-01-05", { org: orgOther, proposedBy: null });
      await refusedWithNoWrite(p, () => decide("00000000-0000-4000-8000-000000000000", "approve"), "not_found");
      await refusedWithNoWrite(elsewhere, () => decide(otherId, "approve"), "not_found", orgOther);
      await refusedWithNoWrite(elsewhere, () => decide(otherId, "deny", { reason: "x" }), "not_found", orgOther);
      await refusedWithNoWrite(p, () => decide(null, "approve"), "not_found");
      expect((await rollRow(id)).approval_status).toBe("pending");
    });

    it("already_decided: approve after deny, deny after approve, approve after withdraw", async () => {
      const a = await subject({ engagement: "regular" });
      const ida = await propose(a);
      expect((await decide(ida, "deny", { reason: "no" })).outcome).toBe("ok");
      await refusedWithNoWrite(a, () => decide(ida, "approve"), "already_decided");
      const b = await subject({ engagement: "regular" });
      const idb = await propose(b);
      expect((await decide(idb, "approve")).outcome).toBe("ok");
      await refusedWithNoWrite(b, () => decide(idb, "deny", { reason: "late" }), "already_decided");
      const c = await subject({ engagement: "regular" });
      const idc = await propose(c);
      expect((await withdraw(idc, "mistake")).outcome).toBe("ok");
      await refusedWithNoWrite(c, () => decide(idc, "approve"), "already_decided");
    });

    it("not_approvable_kind: a legacy pending void, loss, opening_balance or other_participant_enrolled row (owner path) cannot be approved, but can be denied", async () => {
      const cases: Array<[string, string | null]> = [
        ["other_participant_enrolled", "other_participant"], ["opening_balance", "active"],
        ["death", null], ["certificate_dismissed", null], ["affiliate_ended", null],
      ];
      for (const [kind, roll] of cases) {
        const p = await subject({ engagement: "regular" });
        const id = await ownerInsertRoll({ person: p, kind, date: "2025-01-05", roll, proposedBy: proposerUser });
        await refusedWithNoWrite(p, () => decide(id, "approve"), "not_approvable_kind");
        expect((await decide(id, "deny", { reason: "junk" })).outcome, kind).toBe("ok");
      }
      // A pending void (owner path): not approvable either.
      const p = await subject({ engagement: "regular" });
      const target = await ownerInsertRoll({ person: p, kind: "other_participant_enrolled", date: "2024-01-01", roll: "other_participant", status: "approved" });
      const v = await ownerInsertRoll({ person: p, kind: "void", date: "2025-01-05", roll: null, voids: target });
      await refusedWithNoWrite(p, () => decide(v, "approve"), "not_approvable_kind");
    });

    it("person_deceased, person_merged, membership_ended (and each can still be denied and withdrawn)", async () => {
      const dead = await subject({ engagement: "regular", deceased: "2025-03-01" });
      const idDead = await propose(dead);
      await refusedWithNoWrite(dead, () => decide(idDead, "approve"), "person_deceased");
      expect((await decide(idDead, "deny", { reason: "deceased" })).outcome).toBe("ok");

      const merged = await subject({ engagement: "regular" });
      const idMerged = await propose(merged);
      const survivor = await makePerson("Mergesurvivor");
      await q(sql`update people set merged_into_id = ${survivor} where id = ${merged}`);
      await refusedWithNoWrite(merged, () => decide(idMerged, "approve"), "person_merged");
      expect((await withdraw(idMerged, "merged record")).outcome).toBe("ok");

      const ended = await subject({ engagement: "regular", endedOn: "2025-02-01" });
      const idEnded = await propose(ended);
      await refusedWithNoWrite(ended, () => decide(idEnded, "approve"), "membership_ended");
      expect((await decide(idEnded, "deny", { reason: "left" })).outcome).toBe("ok");
    });

    it("holds_pastoral_office (R12): an open pastor-office term blocks a member-roll gain; a closed one does not", async () => {
      for (const office of PASTOR_OFFICES) {
        const p = await subject({ engagement: "staff" });
        await term(orgMain, p, office, "2020-01-01");
        const id = await propose(p);
        await refusedWithNoWrite(p, () => decide(id, "approve"), "holds_pastoral_office");
      }
      const past = await subject({ engagement: "regular" });
      await term(orgMain, past, "associate_pastor", "2010-01-01", "2015-01-01");
      const id = await propose(past);
      expect((await decide(id, "approve")).outcome).toBe("ok");
    });

    it("already_on_roll (R6, direction a): a second gain for someone already on that roll is refused and presby_roll_changes is unchanged", async () => {
      const p = await subject({ engagement: "regular" });
      await ownerInsertRoll({ person: p, kind: "opening_balance", date: "2020-01-01", roll: "active", status: "approved" });
      const before = await changes(orgMain, "2024-01-01", "2024-12-31");
      const id = await propose(p, "reaffirmation", "2024-05-01");
      await refusedWithNoWrite(p, () => decide(id, "approve"), "already_on_roll");
      expect(await changes(orgMain, "2024-01-01", "2024-12-31")).toEqual(before);
      // The same for the baptized roll.
      const b = await subject({ engagement: "regular" });
      await ownerInsertRoll({ person: b, kind: "baptized_member_enrolled", date: "2019-01-01", roll: "baptized", status: "approved" });
      const idb = await propose(b, "baptized_member_enrolled", "2023-01-01");
      await refusedWithNoWrite(b, () => decide(idb, "approve"), "already_on_roll");
    });

    it("already_on_roll (R6, direction b): an earlier gain before a later COUNTED gain is refused, so the person is not counted twice", async () => {
      const p = await subject({ engagement: "regular" });
      await ownerInsertRoll({ person: p, kind: "certificate_received", date: "2024-06-01", roll: "active", status: "approved" });
      const before = await changes(orgMain, "2022-01-01", "2024-12-31");
      const id = await propose(p, "profession_of_faith", "2022-03-01");
      await refusedWithNoWrite(p, () => decide(id, "approve"), "already_on_roll");
      expect(await changes(orgMain, "2022-01-01", "2024-12-31")).toEqual(before);
    });

    it("a following opening_balance is not counted: the 2018 profession entered after a 2020 opening balance is approved with the shadow warning only", async () => {
      const p = await subject({ engagement: "regular", dob: "1990-01-01" });
      await ownerInsertRoll({ person: p, kind: "opening_balance", date: "2020-01-01", roll: "active", status: "approved" });
      const before = await changes(orgMain, "2018-01-01", "2018-12-31");
      const id = await propose(p, "profession_of_faith", "2018-04-01");
      const r = await decide(id, "approve");
      expect(r).toMatchObject({
        outcome: "ok", roll_action_id: id, subject_person_id: p, action_kind: "profession_of_faith",
        shadowed_by_kind: "opening_balance",
      });
      expect(String(r.shadowed_by_date)).toMatch(/^2020-01-01/);
      const after = await changes(orgMain, "2018-01-01", "2018-12-31");
      expect((after.gain_profession_18_and_older ?? 0) - (before.gain_profession_18_and_older ?? 0)
        + (after.gain_profession_17_and_under ?? 0) - (before.gain_profession_17_and_under ?? 0)).toBe(1);
      // The cache still projects the later opening balance.
      expect((await stateOf(orgMain, p)).current_roll_since).toBe("2020-01-01");
      expect(await drift(orgMain, p)).toBe(0);
    });

    it("active_elsewhere: a person active at another organization hits memberships_one_active_roll_idx; typed, nothing written, the other organization never named", async () => {
      const p = await makePerson("Twoplaces");
      await addMembership(orgOther, p, { engagement: "regular" });
      await ownerInsertRoll({ org: orgOther, person: p, kind: "opening_balance", date: "2020-01-01", roll: "active", status: "approved" });
      // The second link needs memberships_guard_insert off (owner fixture only).
      await platform.transaction(async (tx) => {
        await tx.execute(sql`alter table memberships disable trigger memberships_guard_insert`);
        await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgMain}, ${p}, 'regular')`);
        await tx.execute(sql`alter table memberships enable trigger memberships_guard_insert`);
      });
      const id = await propose(p, "certificate_received", "2025-01-05");
      const before = await stateOf(orgMain, p);
      const r = await decide(id, "approve");
      expect(r.outcome).toBe("active_elsewhere");
      expect(JSON.stringify(r)).not.toContain(orgOther);
      expect(await stateOf(orgMain, p)).toEqual(before);
      expect((await rollRow(id)).approval_status).toBe("pending");
    });

    it("provisioning_incomplete (S4): an approval at an organization with no derived active_membership group, nothing written", async () => {
      const p = await makePerson("Bare");
      await addMembershipAtBare(orgBare, p);
      const id = await propose(p, "profession_of_faith", "2025-01-05", { org: orgBare, proposedBy: null });
      const before = await stateOf(orgBare, p);
      const r = await decide(id, "approve", { org: orgBare, user: bareApproverUser });
      expect(r).toMatchObject({ outcome: "provisioning_incomplete", roll_action_id: null });
      expect(await stateOf(orgBare, p)).toEqual(before);
    });
  });

  // =========================================================================
  // Decide and withdraw: the sanctioned path (state and replay)
  // =========================================================================
  describe("decide and withdraw: ok", () => {
    it("approve: projects current_roll and since, stamps approved_by/approved_on and decided_by/decided_at, keeps the proposer's minute when none is given; per-person drift 0", async () => {
      const p = await subject({ engagement: "regular", dob: "2000-05-01" });
      const id = await propose(p, "profession_of_faith", "2025-01-05", { minute: "S-2025-01" });
      const countsBefore = await counts(orgMain);
      const r = await decide(id, "approve");
      expect(r).toMatchObject({
        outcome: "ok", roll_action_id: id, subject_person_id: p, action_kind: "profession_of_faith",
        affects_filed_period: false, shadowed_by_kind: null, shadowed_by_date: null,
        self_approved: false, self_target: false,
      });
      expect(String(r.action_effective_date)).toMatch(/^2025-01-05/);
      expect(await rollRow(id)).toMatchObject({
        approval_status: "approved", approved_by: approverUser, decided_by: approverUser,
        has_decided_at: true, approved_today: true, minute_reference: "S-2025-01",
        denial_reason: null, withdrawal_reason: null,
      });
      expect(await stateOf(orgMain, p)).toMatchObject({ current_roll: "active", current_roll_since: "2025-01-05" });
      const countsAfter = await counts(orgMain);
      expect(Number(countsAfter.active) - Number(countsBefore.active)).toBe(1);
      expect(await drift(orgMain, p)).toBe(0);
      const eff = await q(sql`select count(*)::int as n from presby_effective_roll_actions where id = ${id}`);
      expect(eff[0]!.n).toBe(1);
    });

    it("approve: a supplied minute reference overwrites the proposer's; a blank one leaves it", async () => {
      const a = await subject({ engagement: "regular" });
      const ida = await propose(a, "profession_of_faith", "2025-01-05", { minute: "proposer" });
      await decide(ida, "approve", { minute: "  Session 2025-02  " });
      expect((await rollRow(ida)).minute_reference).toBe("Session 2025-02");
      const b = await subject({ engagement: "regular" });
      const idb = await propose(b, "profession_of_faith", "2025-01-05", { minute: "proposer" });
      await decide(idb, "approve", { minute: "   " });
      expect((await rollRow(idb)).minute_reference).toBe("proposer");
    });

    it("participant to member: the participant count drops, active rises, one gain line with the right age split, no loss line", async () => {
      const p = await subject({ engagement: "regular", dob: "2010-03-01" });
      await ownerInsertRoll({ person: p, kind: "other_participant_enrolled", date: "2023-01-01", roll: "other_participant", status: "approved" });
      expect((await stateOf(orgMain, p)).current_roll).toBe("other_participant");
      const changesBefore = await changes(orgMain, "2025-01-01", "2025-12-31");
      const before = await counts(orgMain);
      const id = await propose(p, "profession_of_faith", "2025-01-05");
      // The proposal path freezes age_at_action at proposal time (F173); a
      // pending row is still mutable on the owner path.
      await q(sql`update roll_actions set age_at_action = 14 where id = ${id}`);
      expect((await decide(id, "approve")).outcome).toBe("ok");
      const after = await counts(orgMain);
      expect(Number(after.other_participant) - Number(before.other_participant)).toBe(-1);
      expect(Number(after.active) - Number(before.active)).toBe(1);
      const changesAfter = await changes(orgMain, "2025-01-01", "2025-12-31");
      expect(changesAfter.gain_profession_17_and_under! - changesBefore.gain_profession_17_and_under!).toBe(1);
      expect(changesAfter.gain_profession_18_and_older).toBe(changesBefore.gain_profession_18_and_older);
      for (const line of ["loss_certificate", "loss_death", "loss_other"]) {
        expect(changesAfter[line], line).toBe(changesBefore[line]);
      }
    });

    it("a future-dated approval is approved but leaves current_roll until the daily reconcile (F29)", async () => {
      const p = await subject({ engagement: "regular" });
      const [d] = await q(sql`select (current_date + 30)::text as d`);
      const id = await propose(p, "certificate_received", String(d!.d));
      expect((await decide(id, "approve")).outcome).toBe("ok");
      expect(await stateOf(orgMain, p)).toMatchObject({ current_roll: null });
      expect((await rollRow(id)).approval_status).toBe("approved");
    });

    it("self_approved and self_target: the proposer approving their own proposal, and an approver who is the subject", async () => {
      // A person holding both keys through two roles (a clerk who is also an elder).
      const both = await makeUser("both");
      const bothPerson = await makePerson("Both", { userId: both });
      await addMembership(orgMain, bothPerson, { engagement: "regular" });
      await term(orgMain, bothPerson, "ruling_elder");
      await grant(orgMain, await makeRole(orgMain, `sap_both_${counter}`, ["roll.propose"]), bothPerson);
      const p = await subject({ engagement: "regular" });
      const id = await propose(p, "profession_of_faith", "2025-01-05", { proposedBy: both });
      expect(await decide(id, "approve", { user: both })).toMatchObject({ outcome: "ok", self_approved: true, self_target: false });

      // An elder who is the subject of the action (a baptized-roll enrolment;
      // a pastor approving their own gain would be refused by R12 instead).
      const selfUser = await makeUser("self");
      const selfPerson = await makePerson("Selfelder", { userId: selfUser });
      await addMembership(orgMain, selfPerson, { engagement: "regular" });
      await term(orgMain, selfPerson, "ruling_elder");
      const idSelf = await propose(selfPerson, "baptized_member_enrolled", "2025-01-05");
      expect(await decide(idSelf, "approve", { user: selfUser })).toMatchObject({ outcome: "ok", self_approved: false, self_target: true });
    });

    it("DECISION-206: the installed pastor is seated on the Session, inherits session_member, and can approve", async () => {
      const [held] = await q(sql`
        select exists (select 1 from group_memberships gm join groups g on g.id = gm.group_id
                        where gm.person_id = ${pastorPerson} and g.organization_id = ${orgMain}
                          and g.derived_from = 'session' and gm.source = 'derived') as seated`);
      expect(held!.seated).toBe(true);
      const p = await subject({ engagement: "regular" });
      const id = await propose(p);
      expect((await decide(id, "approve", { user: pastorUser })).outcome).toBe("ok");
      expect((await rollRow(id)).decided_by).toBe(pastorUser);
    });

    it("deny: stores the trimmed reason and the decision stamps, leaves approved_by null and the roll untouched", async () => {
      const p = await subject({ engagement: "regular" });
      const id = await propose(p);
      const before = await stateOf(orgMain, p);
      const r = await decide(id, "deny", { reason: "  No Session minute for this.  " });
      expect(r).toMatchObject({ outcome: "ok", roll_action_id: id, subject_person_id: p, action_kind: "profession_of_faith", self_approved: false });
      expect(await rollRow(id)).toMatchObject({
        approval_status: "denied", denial_reason: "No Session minute for this.", decided_by: approverUser,
        has_decided_at: true, approved_by: null, approved_on: null,
      });
      const after = await stateOf(orgMain, p);
      expect(after.current_roll).toBe(before.current_roll);
    });

    it("withdraw: stores the trimmed reason and stamps; self_proposed true for the proposer, false for another holder; reason bounds; not_found; already_decided", async () => {
      const p = await subject({ engagement: "regular" });
      const id = await propose(p);
      await refusedWithNoWrite(p, () => withdraw(id, "  "), "reason_required");
      await refusedWithNoWrite(p, () => withdraw(id, null), "reason_required");
      await refusedWithNoWrite(p, () => withdraw(id, "y".repeat(501)), "reason_too_long");
      await refusedWithNoWrite(p, () => withdraw("00000000-0000-4000-8000-000000000000", "why"), "not_found");
      const r = await withdraw(id, "  Entered on the wrong person.  ");
      expect(r).toMatchObject({ outcome: "ok", roll_action_id: id, subject_person_id: p, action_kind: "profession_of_faith", self_proposed: true });
      expect(await rollRow(id)).toMatchObject({
        approval_status: "withdrawn", withdrawal_reason: "Entered on the wrong person.", decided_by: proposerUser,
        has_decided_at: true, approved_by: null, denial_reason: null,
      });
      await refusedWithNoWrite(p, () => withdraw(id, "again"), "already_decided");
      // Another roll.propose holder may withdraw: self_proposed false.
      const q2 = await subject({ engagement: "regular" });
      const id2 = await propose(q2, "profession_of_faith", "2025-01-05", { proposedBy: null });
      expect(await withdraw(id2, "clerk tidy-up")).toMatchObject({ outcome: "ok", self_proposed: false });
      // Another org's row is not_found.
      const elsewhere = await subject({ org: orgOther, engagement: "regular" });
      const otherId = await propose(elsewhere, "profession_of_faith", "2025-01-05", { org: orgOther, proposedBy: null });
      await refusedWithNoWrite(elsewhere, () => withdraw(otherId, "why"), "not_found", orgOther);
    });
  });

  // =========================================================================
  // affects_filed_period (R14), rolled back
  // =========================================================================
  describe("affects_filed_period", () => {
    it("true for a live filed return in a year on or after the pivot, false after it", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        const presbySlug = `sap-fp-${stamp}`;
        const recipient = String(rowsOf(await tx.execute(sql`
          insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
          values ('presbytery', 'Fixture recipient', ${presbySlug}, ${presbySlug.replace(/-/g, "_")}, 'unmanaged', ${fixtureDeletableUntil()})
          returning id`))[0]!.id);
        await tx.execute(sql`select set_config('presby.publication_write_active', 'true', true)`);
        const ret = String(rowsOf(await tx.execute(sql`
          insert into statistical_returns (organization_id, about_org_id, report_year, form_version_key, provenance, payload, reconciled, attested_at)
          values (${orgMain}, ${orgMain}, 2024, '2024', 'submitted', '{}', true, now()) returning id`))[0]!.id);
        await tx.execute(sql`
          insert into publications (organization_id, recipient_org_id, record_class, artifact_id, minute_reference)
          values (${orgMain}, ${recipient}, 'statistical_return', ${ret}, 'fixture')`);
        await tx.execute(sql`select set_config('presby.publication_write_active', 'false', true)`);
        await tx.execute(sql`select set_config('app.current_org_id', ${orgMain}, true)`);
        const mk = async (date: string) => {
          const p = String(rowsOf(await tx.execute(sql`
            insert into people (first_name, last_name, deletable_until) values ('Filed', ${`Subject${stamp}`}, ${fixtureDeletableUntil()}) returning id`))[0]!.id);
          await tx.execute(sql`insert into memberships (organization_id, person_id, engagement_status) values (${orgMain}, ${p}, 'regular')`);
          return String(rowsOf(await tx.execute(sql`
            insert into roll_actions (organization_id, person_id, kind, effective_date, resulting_roll, approval_status)
            values (${orgMain}, ${p}, 'profession_of_faith', ${date}::date, 'active', 'pending') returning id`))[0]!.id);
        };
        const call = async (id: string) => rowsOf(await tx.execute(decideSql(id, "approve", approverUser)))[0]!;
        expect(await call(await mk("2024-06-01"))).toMatchObject({ outcome: "ok", affects_filed_period: true });
        expect(await call(await mk("2023-06-01"))).toMatchObject({ outcome: "ok", affects_filed_period: true });
        expect(await call(await mk("2025-01-01"))).toMatchObject({ outcome: "ok", affects_filed_period: false });
      });
    });
  });

  // =========================================================================
  // Concurrency (R2)
  // =========================================================================
  describe("concurrency", () => {
    it("two racing approvals give one ok and one already_decided; approve against deny; approve against withdraw", async () => {
      const a = await subject({ engagement: "regular" });
      const ida = await propose(a);
      const two = await Promise.all([decide(ida, "approve"), decide(ida, "approve", { user: pastorUser })]);
      expect(two.map((r) => r.outcome).sort()).toEqual(["already_decided", "ok"]);
      expect(await drift(orgMain, a)).toBe(0);

      const b = await subject({ engagement: "regular" });
      const idb = await propose(b);
      const ad = await Promise.all([decide(idb, "approve"), decide(idb, "deny", { user: pastorUser, reason: "race" })]);
      expect(ad.map((r) => r.outcome).sort()).toEqual(["already_decided", "ok"]);
      const statusB = (await rollRow(idb)).approval_status;
      expect(["approved", "denied"]).toContain(statusB);

      const c = await subject({ engagement: "regular" });
      const idc = await propose(c);
      const aw = await Promise.all([decide(idc, "approve"), withdraw(idc, "race")]);
      expect(aw.map((r) => r.outcome).sort()).toEqual(["already_decided", "ok"]);
      expect(await drift(orgMain, c)).toBe(0);
    });
  });

  // =========================================================================
  // Court groups and the session_member backfill (sections 6, 7), rolled back
  // =========================================================================
  describe("sections 6 and 7: court groups and the session_member backfill", () => {
    it("seeds the missing Session and Board of Deacons groups, then creates session_member {roll.approve} with one group-arm grant; skips an existing one unchanged and every non-congregation; the second run is a no-op", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        const mkOrg = async (type: string, tag: string) => {
          const slug = `sap-bf-${tag}-${stamp}`;
          return String(rowsOf(await tx.execute(sql`
            insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
            values (${type}::organization_type, ${`Backfill ${tag}`}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed', ${fixtureDeletableUntil()})
            returning id`))[0]!.id);
        };
        const fresh = await mkOrg("congregation", "fresh");
        await tx.execute(sql`
          insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
          values (${fresh}, ${rosterTypeId}, 'Active Membership', 'derived', 'active_membership', true)`);
        const held = await mkOrg("congregation", "held");
        await tx.execute(sql`
          insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
          values (${held}, ${courtTypeId}, 'Session', 'derived', 'session', true)`);
        const heldRole = String(rowsOf(await tx.execute(sql`
          insert into app_roles (organization_id, key, name, role_kind) values (${held}, 'session_member', 'Our own', 'custom') returning id`))[0]!.id);
        await tx.execute(sql`insert into app_role_permissions (role_id, permission_key) values (${heldRole}, 'directory.view')`);
        const presbytery = await mkOrg("presbytery", "presby");

        const shape = async () => rowsOf(await tx.execute(sql`
          select o.id::text as org,
                 (select string_agg(g.derived_from || ':' || g.name || ':' || g.membership_source || ':' || g.is_protected::text
                                    || ':' || gt.key, ',' order by g.derived_from)
                    from groups g join group_types gt on gt.id = g.group_type_id where g.organization_id = o.id) as groups,
                 (select string_agg(r.key || ':' || r.name || ':' || r.role_kind || ':' || r.is_protected::text, ',')
                    from app_roles r where r.organization_id = o.id) as roles,
                 (select string_agg(arp.permission_key, ',' order by arp.permission_key)
                    from app_roles r join app_role_permissions arp on arp.role_id = r.id
                   where r.organization_id = o.id and r.key = 'session_member') as perms,
                 (select string_agg(coalesce(g.derived_from, 'person') || ':' || (rg.person_id is null)::text || ':' || (rg.granted_by is null)::text, ',')
                    from role_grants rg left join groups g on g.id = rg.group_id where rg.organization_id = o.id) as grants
            from organizations o where o.id in (${fresh}, ${held}, ${presbytery}) order by o.id`));

        await tx.execute(sql.raw(section(M62, 6)));
        await tx.execute(sql.raw(section(M62, 7)));
        const once = Object.fromEntries((await shape()).map((r) => [r.org, r]));
        expect(once[fresh]).toMatchObject({
          groups: "active_membership:Active Membership:derived:true:roster,diaconate:Board of Deacons:derived:true:court,session:Session:derived:true:court",
          roles: "session_member:Session member:constitutional:true",
          perms: "roll.approve",
          grants: "session:true:true",
        });
        // An org-owned session_member is skipped and NOT modified (0052 note 5);
        // its missing Board of Deacons group is still seeded.
        expect(once[held]).toMatchObject({
          groups: "diaconate:Board of Deacons:derived:true:court,session:Session:derived:true:court",
          roles: "session_member:Our own:custom:false",
          perms: "directory.view",
          grants: null,
        });
        expect(once[presbytery]).toMatchObject({ groups: null, roles: null, grants: null });

        await tx.execute(sql.raw(section(M62, 6)));
        await tx.execute(sql.raw(section(M62, 7)));
        expect(Object.fromEntries((await shape()).map((r) => [r.org, r]))).toEqual(once);
      });
    });

    it("DECISION-202: no template role holds both roll keys, and no session_member role holds roll.propose", async () => {
      const [t] = await q(sql`
        select count(*)::int as n from app_roles r
         where r.organization_id is null
           and exists (select 1 from app_role_permissions p where p.role_id = r.id and p.permission_key = 'roll.approve')
           and exists (select 1 from app_role_permissions p where p.role_id = r.id and p.permission_key = 'roll.propose')`);
      expect(t!.n).toBe(0);
      const [s] = await q(sql`
        select count(*)::int as n from app_roles r join app_role_permissions p on p.role_id = r.id
         where r.key = 'session_member' and p.permission_key = 'roll.propose'`);
      expect(s!.n).toBe(0);
    });
  });

  // =========================================================================
  // Pastors (section 8; DECISION-206, S1)
  // =========================================================================
  describe("section 8: pastors as members of the Session", () => {
    async function derivedOf(termId: string): Promise<string | null> {
      const [row] = await q(sql`
        select g.derived_from from group_memberships gm join groups g on g.id = gm.group_id
         where gm.officer_term_id = ${termId}`);
      return row ? String(row.derived_from) : null;
    }

    it("the derived-group CASE: the four Session offices map to session, deacon to diaconate, moderator and the rest to nothing", async () => {
      const expected: Record<string, string | null> = {
        ruling_elder: "session", installed_pastor: "session", co_pastor: "session", associate_pastor: "session",
        deacon: "diaconate", moderator: null, clerk_of_session: null, treasurer: null, trustee: null,
      };
      for (const office of OFFICER_OFFICES) {
        const p = await subject({ engagement: "staff" });
        const id = await term(orgMain, p, office, "2021-01-01", "2022-01-01");
        expect(await derivedOf(id), office).toBe(expected[office]);
      }
      expect(Object.entries(expected).filter(([, v]) => v === "session").map(([k]) => k).sort()).toEqual([...SESSION_OFFICES].sort());
    });

    it("the no-op touch re-materialises an existing pastor term that predates the mapping (rolled back)", async () => {
      const p = await subject({ engagement: "staff" });
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`alter table officer_terms disable trigger officer_terms_sync_derived`);
        const id = String(rowsOf(await tx.execute(sql`
          insert into officer_terms (organization_id, person_id, office, starts_on)
          values (${orgMain}, ${p}, 'co_pastor', '2018-01-01') returning id`))[0]!.id);
        await tx.execute(sql`alter table officer_terms enable trigger officer_terms_sync_derived`);
        const none = rowsOf(await tx.execute(sql`select count(*)::int as n from group_memberships where officer_term_id = ${id}`));
        expect(none[0]!.n).toBe(0);
        const touch = section(M62, 8).match(/update officer_terms\s+set ends_on = ends_on\s+where office in \([^)]*\);/);
        expect(touch).not.toBeNull();
        await tx.execute(sql.raw(touch![0]));
        const row = rowsOf(await tx.execute(sql`
          select g.derived_from, gm.starts_on::text as starts_on from group_memberships gm join groups g on g.id = gm.group_id
           where gm.officer_term_id = ${id}`));
        expect(row).toEqual([{ derived_from: "session", starts_on: "2018-01-01" }]);
      });
    });

    it("a pastor seated on the Session inherits every role bound to the Session group (here session_member: roll.approve)", async () => {
      await inRolledBackOwnerTx(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', ${orgMain}, true)`);
        const rows = rowsOf(await tx.execute(sql`
          select permission_key, source_kind, role_name
            from presby_effective_permissions(${pastorPerson}, ${orgMain}, current_date)
           where permission_key = 'roll.approve'`));
        expect(rows).toHaveLength(1);
        expect(rows[0]!.role_name).toBe("Session member");
      });
    });

    it("officer_terms_office_allowed refuses an office outside the vocabulary", async () => {
      const p = await subject({ engagement: "regular" });
      await inRolledBackOwnerTx(async (tx) => {
        const err = await rejected(tx, sql`
          insert into officer_terms (organization_id, person_id, office, starts_on) values (${orgMain}, ${p}, 'bishop', '2024-01-01')`);
        expect(err.code).toBe("23514");
        expect(err.text).toContain("officer_terms_office_allowed");
      });
    });

    it("S1: an open pastor term for a person on the roll is refused (current_roll, or the replay as of a future start); a closed historical term is allowed", async () => {
      const rolled = await subject({ engagement: "regular" });
      await ownerInsertRoll({ person: rolled, kind: "opening_balance", date: "2020-01-01", roll: "active", status: "approved" });
      // A replay-only case: a future-dated gain the cache has not projected yet.
      const future = await subject({ engagement: "regular" });
      const [d] = await q(sql`select (current_date + 60)::text as d, (current_date + 90)::text as later`);
      await ownerInsertRoll({ person: future, kind: "certificate_received", date: String(d!.d), roll: "active", status: "approved" });
      await inRolledBackOwnerTx(async (tx) => {
        for (const office of PASTOR_OFFICES) {
          const err = await rejected(tx, sql`
            insert into officer_terms (organization_id, person_id, office, starts_on) values (${orgMain}, ${rolled}, ${office}, '2024-01-01')`);
          expect(err.code, office).toBe("23514");
          expect(err.constraint, office).toBe("officer_terms_pastor_no_roll");
          expect(err.text, office).toMatch(/a pastor's membership is held by the presbytery/);
        }
        // An open term ending in the future is still open.
        const openEnd = await rejected(tx, sql`
          insert into officer_terms (organization_id, person_id, office, starts_on, ends_on)
          values (${orgMain}, ${rolled}, 'associate_pastor', '2024-01-01', current_date + 365)`);
        expect(openEnd.constraint).toBe("officer_terms_pastor_no_roll");
        // Replay as of greatest(current_date, starts_on): a term starting after the future gain.
        const replay = await rejected(tx, sql`
          insert into officer_terms (organization_id, person_id, office, starts_on)
          values (${orgMain}, ${future}, 'installed_pastor', ${String(d!.later)}::date)`);
        expect(replay.constraint).toBe("officer_terms_pastor_no_roll");
        // A closed historical term is allowed, and ruling_elder is untouched by the guard.
        await tx.execute(sql`
          insert into officer_terms (organization_id, person_id, office, starts_on, ends_on)
          values (${orgMain}, ${rolled}, 'installed_pastor', '2005-01-01', '2010-01-01')`);
        await tx.execute(sql`
          insert into officer_terms (organization_id, person_id, office, starts_on) values (${orgMain}, ${rolled}, 'ruling_elder', '2024-01-01')`);
      });
    });

    it("S1 does not stop ending or shortening a term after the person acquired a roll, but refuses re-opening a closed one or moving an open term onto a rolled person", async () => {
      const p = await subject({ engagement: "staff" });
      const open = await term(orgMain, p, "installed_pastor", "2019-01-01");
      const closed = await term(orgMain, p, "associate_pastor", "2010-01-01", "2012-01-01");
      // The person later acquires a roll by the owner path (the R12 approve guard would refuse it).
      await ownerInsertRoll({ person: p, kind: "opening_balance", date: "2021-01-01", roll: "active", status: "approved" });
      await inRolledBackOwnerTx(async (tx) => {
        const reopen = await rejected(tx, sql`update officer_terms set ends_on = null where id = ${closed}`);
        expect(reopen.constraint).toBe("officer_terms_pastor_no_roll");
        // Ending the open term works.
        await tx.execute(sql`update officer_terms set ends_on = current_date where id = ${open}`);
      });
      await inRolledBackOwnerTx(async (tx) => {
        // Extending an already-open term for the same person is not a new opening.
        await tx.execute(sql`update officer_terms set ends_on = '2099-01-01' where id = ${open}`);
      });
      // Moving an open pastor term onto a rolled person.
      const rolled = await subject({ engagement: "regular" });
      await ownerInsertRoll({ person: rolled, kind: "opening_balance", date: "2020-01-01", roll: "active", status: "approved" });
      const elsewhereTerm = await term(orgMain, await subject({ engagement: "staff" }), "co_pastor", "2022-01-01");
      await inRolledBackOwnerTx(async (tx) => {
        const moved = await rejected(tx, sql`update officer_terms set person_id = ${rolled} where id = ${elsewhereTerm}`);
        expect(moved.constraint).toBe("officer_terms_pastor_no_roll");
      });
    });
  });

  // =========================================================================
  // Source scans of the migrations (1.9-1.10, SQL half). Batch B pins its
  // TypeScript constants to the same literals.
  // =========================================================================
  describe("source scan of drizzle/0062 and drizzle/0063", () => {
    const t62 = () => readFileSync(M62, "utf8");
    const t63 = () => readFileSync(M63, "utf8");
    const outcomesIn = (body: string) =>
      [...new Set([...body.matchAll(/(?:outcome|v_outcome) := '([a-z_]+)'/g)].map((m) => m[1]))].sort();

    it("the decide function's outcome vocabulary is exactly the closed list", () => {
      expect(outcomesIn(functionBody(t62(), "presby_decide_roll_action"))).toEqual([...DECIDE_OUTCOMES].sort());
    });

    it("the withdraw function's outcome vocabulary is exactly the closed list", () => {
      expect(outcomesIn(functionBody(t62(), "presby_withdraw_roll_action"))).toEqual([...WITHDRAW_OUTCOMES].sort());
    });

    it("the approvable kinds in the decide function equal 0063's insert-policy kinds", () => {
      const fn = quotedList(functionBody(t62(), "presby_decide_roll_action"), "v_t.kind not in (");
      const policy = quotedList(section(M63, 4), "and kind in (");
      expect(fn).toEqual([...APPROVABLE_KINDS]);
      expect(policy).toEqual([...APPROVABLE_KINDS]);
    });

    it("the counted gain kinds in the decide function equal exactly the kinds the live presby_roll_changes counts", async () => {
      const fn = quotedList(functionBody(t62(), "presby_decide_roll_action"), "v_next.kind in (");
      expect(fn).toEqual([...COUNTED_GAIN_KINDS]);
      const [def] = await q(sql`select pg_get_functiondef('presby_roll_changes'::regproc) as d`);
      const gainLines = String(def!.d).split("union all").filter((part) => /'gain_/.test(part));
      const counted = [...new Set(gainLines.flatMap((part) => [...part.matchAll(/'([a-z_]+)'(?!::)/g)].map((m) => m[1]!))
        .filter((k) => !k.startsWith("gain_")))].sort();
      expect(counted).toEqual([...COUNTED_GAIN_KINDS].sort());
    });

    it("the Session offices are the CASE arms mapping to 'session', in the file and in the live trigger function; the pastor offices agree everywhere", async () => {
      const arms = (body: string) => [...body.matchAll(/when '([a-z_]+)'\s+then 'session'/g)].map((m) => m[1]!).sort();
      expect(arms(functionBody(t62(), "presby_sync_derived_group"))).toEqual([...SESSION_OFFICES].sort());
      const [def] = await q(sql`select pg_get_functiondef('presby_sync_derived_group'::regproc) as d`);
      expect(arms(String(def!.d))).toEqual([...SESSION_OFFICES].sort());
      expect(quotedList(functionBody(t62(), "presby_guard_pastor_no_roll"), "new.office not in (")).toEqual([...PASTOR_OFFICES]);
      expect(quotedList(functionBody(t62(), "presby_decide_roll_action"), "ot.office in (")).toEqual([...PASTOR_OFFICES]);
    });

    it("the office vocabulary CHECK in the file equals OFFICER_OFFICES, as does the section 1 stop-block", () => {
      const s8 = section(M62, 8);
      expect(quotedList(s8, "check (office in (").sort()).toEqual([...OFFICER_OFFICES].sort());
      expect(quotedList(section(M62, 1), "where office not in (").sort()).toEqual([...OFFICER_OFFICES].sort());
    });

    it("neither decision function takes an organization parameter: the org is presby_current_org()", () => {
      for (const name of ["presby_decide_roll_action", "presby_withdraw_roll_action"]) {
        const body = functionBody(t62(), name);
        const params = body.slice(body.indexOf("("), body.indexOf("returns table"));
        expect(params).not.toMatch(/organization|p_org/);
        expect(body).toContain("v_org uuid := presby_current_org();");
      }
    });

    it("neither migration deletes or truncates anything", () => {
      for (const text of [t62(), t63()]) {
        const code = text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
        expect(code).not.toMatch(/\bdelete\s+from\b/i);
        expect(code).not.toMatch(/\btruncate\b/i);
      }
    });
  });
});
