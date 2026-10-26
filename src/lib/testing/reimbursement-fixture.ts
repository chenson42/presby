/**
 * A throwaway-tenant harness for the DB-backed reimbursement suites
 * (drizzle/0073, 0074; docs/work-log/2026-10-25-treasury-inc1.md). TEST
 * SUPPORT ONLY - never imported by application code.
 *
 * Two connections, as every DB suite here: the owner (`platform`, BYPASSRLS,
 * for fixtures and the owner-path trigger proofs) and presby_app (`appDb`,
 * RLS enforced, for every definer call). Organizations and people are stamped
 * `deletable_until` at insert (src/lib/db/fixture-deletable.ts); `cleanup()`
 * deletes the organizations (whose cascade the reimbursement delete guards
 * permit, because the parent organization is gone), then the people (merged
 * ones first), then the users.
 *
 * Every database module is imported INSIDE the factory: `@/lib/db` throws at
 * import when DATABASE_URL is unset. The calling test must
 * `vi.mock("server-only")` itself.
 *
 * Names are synthetic (`example.invalid`, invented names) - No Real Data.
 */
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { fixtureDeletableUntil } from "@/lib/db/fixture-deletable";

export type Row = Record<string, unknown>;

/** The Postgres SQLSTATE and message at the bottom of a driver error chain. */
export function pgError(err: unknown): { code: string | undefined; message: string } {
  const chain: unknown[] = [];
  let cur: unknown = err;
  while (cur && chain.length < 6) {
    chain.push(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  const withCode = chain.filter((e) => typeof (e as { code?: unknown }).code === "string"
    && /^[0-9A-Z]{5}$/.test((e as { code: string }).code));
  const last = withCode[withCode.length - 1] as { code?: string; message?: string } | undefined;
  return {
    code: last?.code,
    message: last?.message ?? chain.map((e) => (e instanceof Error ? e.message : String(e))).join(" :: "),
  };
}

export function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

/** The four keys drizzle/0074 adds. */
export const REIMBURSEMENT_TEST_KEYS = [
  "reimbursement.request_for_others",
  "reimbursement.view",
  "reimbursement.pay",
  "reimbursement.manage",
] as const;

export interface MemberOptions {
  engagement?: "visitor" | "regular" | "staff" | "inactive";
  roll?: string | null;
  /** false: a person with no login. */
  withUser?: boolean;
}

export async function createReimbursementFixture(label: string) {
  const dbModule = await import("@/lib/db");
  const platform = dbModule.getPlatformDb();
  const appDb = dbModule.db;
  type Tx = Parameters<Parameters<typeof appDb.transaction>[0]>[0];

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  let counter = 0;
  const orgIds: string[] = [];
  const personIds: string[] = [];
  const userIds: string[] = [];
  const mailAddresses: string[] = [];

  async function q(query: SQL): Promise<Row[]> {
    return rowsOf(await platform.execute(query));
  }

  await q(sql`insert into group_types (key, name) values ('roster', 'Roster'), ('court', 'Court') on conflict do nothing`);
  const types = await q(sql`select id, key from group_types where key in ('roster', 'court')`);
  const rosterTypeId = String(types.find((t) => t.key === "roster")!.id);
  const courtTypeId = String(types.find((t) => t.key === "court")!.id);

  async function makeUser(tag: string): Promise<string> {
    counter += 1;
    const [row] = await q(sql`
      insert into users (email, name)
      values (${`rmb-${label}-${tag}-${stamp}-${counter}@example.invalid`}, 'Reimbursement Fixture')
      returning id`);
    userIds.push(String(row!.id));
    return String(row!.id);
  }

  /** A congregation with the derived Session, Board of Deacons and Active Membership groups. */
  async function makeOrg(
    tag: string,
    opts: { timeZone?: string; type?: string; toggle?: boolean } = {},
  ): Promise<string> {
    counter += 1;
    const slug = `rmb-${label}-${tag}-${stamp}-${counter}`.toLowerCase().slice(0, 63).replace(/-+$/, "");
    const [row] = await q(sql`
      insert into organizations (organization_type, name, slug, path, platform_status, deletable_until)
      values (${opts.type ?? "congregation"}::organization_type, ${`Fixture ${tag} for reimbursements`}, ${slug},
              ${slug.replace(/-/g, "_")}, 'managed', ${fixtureDeletableUntil()})
      returning id`);
    const id = String(row!.id);
    orgIds.push(id);
    await q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      values (${id}, ${courtTypeId}, 'Session', 'derived', 'session', true),
             (${id}, ${courtTypeId}, 'Board of Deacons', 'derived', 'diaconate', true),
             (${id}, ${rosterTypeId}, 'Active Membership', 'derived', 'active_membership', true)`);
    if (opts.timeZone) {
      await q(sql`insert into organization_settings (organization_id, time_zone) values (${id}, ${opts.timeZone})`);
    }
    if (opts.toggle) await setToggle(id, true);
    return id;
  }

  /** The per-organization `org_portal.reimbursement` toggle row (a missing row is OFF). */
  async function setToggle(org: string, enabled: boolean): Promise<void> {
    await q(sql`
      insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
      values (${org}, 'org_portal.reimbursement', ${enabled}, null)
      on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`);
  }

  async function derivedGroup(org: string, derivedFrom: string): Promise<string> {
    const [row] = await q(sql`select id from groups where organization_id = ${org} and derived_from = ${derivedFrom}`);
    return String(row!.id);
  }

  async function makeGroup(org: string, name: string): Promise<string> {
    const [row] = await q(sql`
      insert into groups (organization_id, group_type_id, name, membership_source)
      values (${org}, ${rosterTypeId}, ${name}, 'managed') returning id`);
    return String(row!.id);
  }

  async function makePerson(first: string, userId: string | null = null): Promise<string> {
    counter += 1;
    const [row] = await q(sql`
      insert into people (first_name, last_name, user_id, deletable_until)
      values (${first}, ${`Quillfeather${stamp}${counter}`}, ${userId}::uuid, ${fixtureDeletableUntil()})
      returning id`);
    personIds.push(String(row!.id));
    return String(row!.id);
  }

  /** A membership; a second organization for the same person goes through the claim marker. */
  async function addMembership(org: string, person: string, opts: MemberOptions = {}) {
    await platform.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.person_claim_authorized', ${person}, true)`);
      await tx.execute(sql`
        insert into memberships (organization_id, person_id, engagement_status, current_roll)
        values (${org}, ${person}, ${opts.engagement ?? "regular"},
                ${opts.roll === undefined ? "active" : opts.roll})`);
    });
  }

  /** A user, a person linked to it, and a membership at `org`. */
  async function member(org: string, first: string, opts: MemberOptions = {}) {
    const userId = opts.withUser === false ? null : await makeUser(first.toLowerCase());
    const personId = await makePerson(first, userId);
    await addMembership(org, personId, opts);
    return { userId: userId as string, personId };
  }

  async function seat(org: string, group: string, person: string,
    opts: { role?: string; startsOn?: string; endsOn?: string | null } = {}): Promise<string> {
    const [row] = await q(sql`
      insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on, ends_on)
      values (${org}, ${group}, ${person}, ${opts.role ?? "chair"}, 'managed',
              ${opts.startsOn ?? "2020-01-01"}::date, ${opts.endsOn ?? null}::date)
      returning id`);
    return String(row!.id);
  }

  async function makeRole(org: string, key: string, perms: readonly string[]): Promise<string> {
    const [row] = await q(sql`
      insert into app_roles (organization_id, key, name, role_kind)
      values (${org}, ${`${key}_${counter++}`}, ${key}, 'custom') returning id`);
    const roleId = String(row!.id);
    for (const p of perms) {
      await q(sql`insert into app_role_permissions (role_id, permission_key) values (${roleId}, ${p})`);
    }
    return roleId;
  }

  async function grant(org: string, roleId: string, person: string): Promise<string> {
    const [row] = await q(sql`
      insert into role_grants (organization_id, role_id, person_id, starts_on)
      values (${org}, ${roleId}, ${person}, '2020-01-01') returning id`);
    return String(row!.id);
  }

  async function chargeable(org: string, group: string, byUser: string): Promise<string> {
    const [row] = await q(sql`
      insert into reimbursement_chargeable_groups (organization_id, group_id, created_by_user)
      values (${org}, ${group}, ${byUser}) returning id`);
    return String(row!.id);
  }

  async function category(org: string, name: string, byUser: string): Promise<string> {
    const [row] = await q(sql`
      insert into reimbursement_categories (organization_id, name, created_by_user)
      values (${org}, ${name}, ${byUser}) returning id`);
    return String(row!.id);
  }

  /** A stored blob at `org` (synthetic bytes). Returns its id and the sha to attach under. */
  async function blob(org: string, contentType = "image/jpeg"): Promise<{ id: string; sha: string; size: number }> {
    counter += 1;
    const sha = createHash("sha256").update(`${label}-${stamp}-${counter}`).digest("hex");
    const [row] = await q(sql`
      insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
      values (${org}, ${`fixture-${sha}`}, ${contentType}, 3, '\\x010203'::bytea) returning id`);
    return { id: String(row!.id), sha, size: 3 };
  }

  /**
   * An active email address for a person (owner connection). The first address a
   * person gets is their MAIN one (the deferred "active main" constraint needs
   * one); `subtype` is `work` | `personal` | `other` | null; `doNotContact` marks
   * it unusable for mail. Returns the address, which `queued()` reads back by.
   */
  async function email(
    personId: string,
    tag: string,
    opts: { subtype?: string | null; doNotContact?: boolean; main?: boolean; address?: string } = {},
  ): Promise<string> {
    counter += 1;
    const address = (opts.address ?? `rmb-${label}-${tag}-${stamp}-${counter}@example.invalid`).toLowerCase();
    mailAddresses.push(address);
    const [{ n }] = (await q(sql`
      select count(*)::int as n from contact_methods
       where person_id = ${personId} and kind = 'email' and ended_at is null and is_primary`)) as Array<{ n: number }>;
    const main = opts.main ?? n === 0;
    await q(sql`
      insert into contact_methods (person_id, kind, value, subtype, is_primary, do_not_contact)
      values (${personId}, 'email', ${address}, ${opts.subtype ?? null}, ${main}, ${opts.doNotContact ?? false})`);
    return address;
  }

  /** The `email_queue` rows addressed to any of `addresses` (owner connection), oldest first. */
  async function queued(addresses: readonly string[]): Promise<Row[]> {
    if (addresses.length === 0) return [];
    return q(sql`
      select id, to_email, template_key, subject, html_body, text_body, status
        from email_queue
       where to_email in (${sql.join(addresses.map((a) => sql`${a}`), sql`, `)})
       order by created_at, id`);
  }

  /** A presby_app transaction with the org GUC set (null: no GUC). Commits unless fn throws. */
  async function asApp<T>(org: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return appDb.transaction(async (tx) => {
      if (org) await tx.execute(sql`select set_config('app.current_org_id', ${org}, true)`);
      return fn(tx);
    });
  }

  /** One presby_app statement in its own committed transaction. */
  async function app(org: string | null, query: SQL): Promise<Row[]> {
    return asApp(org, async (tx) => rowsOf(await tx.execute(query)));
  }

  async function cleanup() {
    if (mailAddresses.length > 0) {
      await platform.execute(
        sql`delete from email_queue where to_email in (${sql.join(mailAddresses.map((a) => sql`${a}`), sql`, `)})`,
      );
    }
    await platform.execute(sql`alter table group_memberships disable trigger group_memberships_reject_derived`);
    try {
      for (const id of orgIds) {
        await platform.execute(sql`delete from organizations where id = ${id}`);
      }
    } finally {
      await platform.execute(sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
    }
    if (personIds.length > 0) {
      const merged = new Set(
        (await q(sql`select id from people where merged_into_id is not null
                      and id in (${sql.join(personIds.map((id) => sql`${id}::uuid`), sql`, `)})`)).map((r) => String(r.id)),
      );
      for (const id of [...personIds].sort((x, y) => Number(merged.has(y)) - Number(merged.has(x)))) {
        await platform.execute(sql`delete from people where id = ${id}`);
      }
    }
    for (const id of userIds) {
      await platform.execute(sql`delete from users where id = ${id}`);
    }
  }

  return {
    platform,
    appDb,
    q,
    app,
    asApp,
    makeUser,
    makeOrg,
    setToggle,
    derivedGroup,
    makeGroup,
    makePerson,
    addMembership,
    member,
    seat,
    makeRole,
    grant,
    chargeable,
    category,
    blob,
    email,
    queued,
    cleanup,
  };
}

export type ReimbursementFixture = Awaited<ReturnType<typeof createReimbursementFixture>>;
