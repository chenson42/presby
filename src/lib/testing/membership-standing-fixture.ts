/**
 * A throwaway-tenant harness for the drizzle/0066 suites
 * (`src/lib/membership-standing.db.test.ts`,
 * `src/lib/db/domain/derived-group-guard.db.test.ts`,
 * `src/lib/db/domain/engagement-guards.db.test.ts`; Community Increment 3a,
 * docs/work-log/2026-10-22-founding-admin-directory-inc3.md). TEST SUPPORT
 * ONLY - never imported by application code.
 *
 * Two connections, both real: `platform` is `getPlatformDb()` (neondb_owner,
 * the TABLE OWNER, which 0066's owner test lets through and which no grant
 * binds, F44) and `asApp()` runs a transaction on `db` (presby_app,
 * NOBYPASSRLS) with `app.current_org_id` set, exactly as `withOrgContext()`
 * does after its membership check.
 *
 * Organizations and people are stamped `deletable_until` at insert
 * (`fixtureDeletableUntil()`; organizations from `createOrganization()` are
 * stamped at teardown, the documented exception). Teardown deletes the
 * organizations with the two triggers that refuse a cascade disabled around it
 * (group_memberships_reject_derived and roll_actions_freeze, as every DB suite
 * does), then the people. Synthetic names, `example.invalid` (No Real Data).
 *
 * Every database module is imported INSIDE the functions. The calling test
 * must `vi.mock("server-only")` itself and run serially
 * (`--no-file-parallelism`): `alter table ... disable trigger` is global.
 */
import { sql, type SQL } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";
import { rowsOf, type Row } from "@/lib/testing/invitation-fixture";

export type { Row };

type Db = ReturnType<typeof import("@/lib/db").getPlatformDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class Rollback extends Error {}

function chain(err: unknown): unknown[] {
  const out: unknown[] = [];
  let cur: unknown = err;
  while (cur && out.length < 6) {
    out.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}

/** The SQLSTATE of a driver error (walks Drizzle's `cause` chain). */
export function pgCode(err: unknown): string | undefined {
  for (const e of chain(err)) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

/** A named field of a driver error (`constraint`, `detail`, ...). */
export function pgField(err: unknown, field: string): string | undefined {
  for (const e of chain(err)) {
    const v = (e as Record<string, unknown>)[field];
    if (typeof v === "string") return v;
  }
  return undefined;
}

/** The server's message text of a driver error. */
export function pgMessage(err: unknown): string | undefined {
  const withCode = chain(err).filter((e) => typeof (e as { code?: unknown }).code === "string");
  const last = withCode[withCode.length - 1];
  return last instanceof Error ? last.message : undefined;
}

export interface Refusal {
  code: string | undefined;
  message: string | undefined;
  constraint: string | undefined;
}

export async function createMembershipStandingFixture(label: string) {
  const dbModule = await import("@/lib/db");
  const platform = dbModule.getPlatformDb();
  const appDb = dbModule.db;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  let counter = 0;
  const orgIds: string[] = [];
  const personIds: string[] = [];
  const userIds: string[] = [];

  async function q(query: SQL): Promise<Row[]> {
    return rowsOf(await platform.execute(query));
  }

  await q(sql`insert into group_types (key, name) values ('roster', 'Roster'), ('court', 'Court'), ('committee', 'Committee') on conflict do nothing`);
  const types = await q(sql`select id, key from group_types where key in ('roster', 'court', 'committee')`);
  const typeId = (key: string) => String(types.find((t) => t.key === key)!.id);
  const rosterTypeId = typeId("roster");
  const courtTypeId = typeId("court");
  const committeeTypeId = typeId("committee");

  /** An organization with NO groups and NO roles (stamped deletable_until). */
  async function bareOrg(tag: string, type: "congregation" | "presbytery" = "congregation"): Promise<string> {
    counter += 1;
    const slug = `${label}-${tag}-${stamp}-${counter}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const [row] = await q(sql`
      insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
      values (${type}::organization_type, ${`Fixture ${tag} for ${label}`}, ${slug},
              ${slug.replace(/-/g, "_")}, 'managed', ${fixtureDeletableUntil()})
      returning id`);
    const id = String(row!.id);
    orgIds.push(id);
    return id;
  }

  /**
   * A bare organization plus its derived Active Membership group, inserted
   * ALONE: the groups_pair_derived trigger (0066) adds All Current Records.
   * With `courts`, also the Session and Board of Deacons groups.
   */
  async function org(tag: string, options: { courts?: boolean } = {}): Promise<string> {
    const id = await bareOrg(tag);
    await q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      values (${id}, ${rosterTypeId}, 'Active Membership', 'derived', 'active_membership', true)`);
    if (options.courts) {
      await q(sql`
        insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
        values (${id}, ${courtTypeId}, 'Session', 'derived', 'session', true),
               (${id}, ${courtTypeId}, 'Board of Deacons', 'derived', 'diaconate', true)`);
    }
    return id;
  }

  /** Track an organization made elsewhere (createOrganization) for teardown. */
  function trackOrg(id: string) {
    if (!orgIds.includes(id)) orgIds.push(id);
  }

  async function person(first = "Fixture", options: { deceased?: boolean } = {}): Promise<string> {
    counter += 1;
    const [row] = await q(sql`
      insert into people (first_name, last_name, date_of_death, deletable_until)
      values (${first}, ${`Standing${stamp}${counter}`}, ${options.deceased ? sql`date '2020-01-01'` : sql`null`},
              ${fixtureDeletableUntil()})
      returning id`);
    const id = String(row!.id);
    personIds.push(id);
    return id;
  }

  /** A membership written on the OWNER connection (the roll cache is owner-path). */
  async function membership(
    orgId: string,
    personId: string,
    roll: string | null,
    engagement: string,
  ): Promise<string> {
    const [row] = await q(sql`
      insert into memberships (organization_id, person_id, current_roll, engagement_status)
      values (${orgId}, ${personId}, ${roll}, ${engagement})
      returning id`);
    return String(row!.id);
  }

  /**
   * One main email address for a person, stored normalized (0064's CHECK),
   * synthetic (`example.invalid`). Returns the address.
   */
  async function addEmail(personId: string): Promise<string> {
    counter += 1;
    const address = `${label}-p${counter}-${stamp}@example.invalid`.toLowerCase();
    await q(sql`
      insert into contact_methods (person_id, kind, value, is_primary)
      values (${personId}, 'email', ${address}, true)`);
    return address;
  }

  /** An active, proven (owner-stamped), unlinked account at `address`. */
  async function user(address: string): Promise<string> {
    const [row] = await q(sql`
      insert into users (email, name, is_active, email_verified)
      values (${address}, 'Standing Fixture User', true, clock_timestamp())
      returning id`);
    const id = String(row!.id);
    userIds.push(id);
    return id;
  }

  /** The auto-connect toggle row (org_portal.sign_in_connect) set ON. */
  async function enableConnect(orgId: string): Promise<void> {
    await q(sql`
      insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
      values (${orgId}, 'org_portal.sign_in_connect', true, null)
      on conflict (organization_id, feature_key) do update set enabled = true`);
  }

  /** The derived rows of one membership, by kind. */
  async function derivedRows(membershipId: string): Promise<Record<string, { startsOn: string; endsOn: string | null } | undefined>> {
    const rows = await q(sql`
      select g.derived_from, gm.starts_on::text as starts_on, gm.ends_on::text as ends_on
        from group_memberships gm join groups g on g.id = gm.group_id
       where gm.membership_id = ${membershipId} and gm.source = 'derived'`);
    const out: Record<string, { startsOn: string; endsOn: string | null }> = {};
    for (const r of rows) {
      out[String(r.derived_from)] = { startsOn: String(r.starts_on), endsOn: r.ends_on === null ? null : String(r.ends_on) };
    }
    return out;
  }

  /** The resolver's answer, in that organization's context (presby_effective_permissions requires it). */
  async function hasPermission(personId: string, orgId: string, key: string): Promise<boolean> {
    return platform.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
      const [row] = rowsOf(await tx.execute(sql`select presby_has_permission(${personId}::uuid, ${orgId}::uuid, ${key}) as ok`));
      return row!.ok === true;
    });
  }

  async function today(): Promise<string> {
    const [row] = await q(sql`select current_date::text as d`);
    return String(row!.d);
  }

  /** A presby_app transaction with the tenant GUC set (withOrgContext's shape). */
  async function asApp<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
      return fn(tx as unknown as Tx);
    });
  }

  /** An owner transaction that always rolls back. */
  async function ownerRolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
    try {
      await platform.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  /** A presby_app transaction that always rolls back. */
  async function appRolledBack(orgId: string, fn: (tx: Tx) => Promise<void>): Promise<void> {
    try {
      await asApp(orgId, async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  /** Runs `query` in a savepoint of `tx` and returns the refusal (throws if it was accepted). */
  async function refused(tx: Tx, query: SQL): Promise<Refusal> {
    let caught: unknown;
    try {
      await tx.transaction(async (sp) => {
        await sp.execute(query);
      });
    } catch (err) {
      caught = err;
    }
    if (!caught) throw new Error("expected the statement to be refused, and it was accepted");
    return { code: pgCode(caught), message: pgMessage(caught), constraint: pgField(caught, "constraint") };
  }

  async function cleanup() {
    await platform.execute(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
    await platform.execute(sql`alter table roll_actions disable trigger roll_actions_freeze`);
    try {
      for (const id of orgIds) {
        await platform.execute(sql`update organizations set deletable_until = ${fixtureDeletableUntil()} where id = ${id} and deletable_until is null`);
        await platform.execute(sql`delete from organizations where id = ${id}`);
      }
    } finally {
      await platform.execute(sql`alter table roll_actions enable trigger roll_actions_freeze`);
      await platform.execute(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
    }
    for (const id of personIds) {
      await platform.execute(sql`update people set merged_into_id = null where id = ${id}`);
    }
    for (const id of personIds) {
      await platform.execute(sql`delete from people where id = ${id}`);
    }
    for (const id of userIds) {
      await platform.execute(sql`delete from users where id = ${id}`);
    }
  }

  return {
    platform,
    appDb,
    stamp,
    rosterTypeId,
    courtTypeId,
    committeeTypeId,
    q,
    bareOrg,
    org,
    trackOrg,
    person,
    membership,
    addEmail,
    user,
    enableConnect,
    derivedRows,
    hasPermission,
    today,
    asApp,
    ownerRolledBack,
    appRolledBack,
    refused,
    cleanup,
  };
}

export type MembershipStandingFixture = Awaited<ReturnType<typeof createMembershipStandingFixture>>;
