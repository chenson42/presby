/**
 * careers-fixture.ts - setup and teardown for the job-openings specs
 * (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 T25-T27; DECISION-157: a spec
 * creates only its own rows and removes them itself). A NEW file, written for this
 * pipeline; it edits no shared e2e support file and reuses `giving-fixture`'s
 * `verifiedContext` (a real TOTP challenge for the `mfa-enrolled` user) unchanged.
 *
 * THE WORLD. A throwaway congregation (`e2e-careers-<stamp>`, `deletable_until`) with
 * a LIVE site whose bundle carries the `careers` live slot on `/employment` (and
 * optionally its own `/careers` page), an invented profile phone, and three people:
 *
 *   acting   the `mfa-enrolled` user, linked to a person at THIS congregation. Their
 *            careers role is swapped in the database between tests (permissions are
 *            read live per request): manager, applicants-only (to prove neither key
 *            implies the other), features-only, or none.
 *   other    a second member who is never signed in as.
 *
 * Holding a careers key does NOT force 2FA (both keys are `requires_two_factor =
 * false`), but the `mfa-enrolled` user's sign-in does require it, so the spec
 * completes the real challenge once (`verifiedContext`).
 *
 * The Job openings toggle is left OFF (no row); specs turn it on and off.
 *
 * IDS. Children use the fixed prefix `e2e96000-...` (person ids and role ids, so a
 * crashed run is repaired by the next); the organization id is unique per run so audit
 * rows, which are append-only and kept forever, never mix runs. No person-id range was
 * pre-assigned for this pipeline: the prefix is not used by any other fixture (grepped).
 *
 * Postings are written through the OWNER connection by walking legal edges, because the
 * `job_postings` triggers bind the owner too: insert as a draft, then publish, then
 * close. One statement per call (the http driver has no multi-statement transaction).
 */

import { createHash } from "node:crypto";
import { withDbRetry, type Sql } from "./db";
import { E2E_USERS } from "./users";

export const CAREERS_TOGGLE_KEY = "org_portal.careers";
export const CAREERS_NAMES = {
  org: "E2E Careers Church",
  actingFirst: "Perpetua",
  actingLast: "Lindqvist",
  otherFirst: "Barnaby",
  otherLast: "Oakhurst",
  phone: "614-555-0188",
} as const;

const CHILD = "e2e96000-0000-4000-8000-";
const id = (n: number) => `${CHILD}${String(n).padStart(12, "0")}`;

export type CareersRoleName = "manager" | "applicants" | "none";

const ROLE_KEYS: Record<Exclude<CareersRoleName, "none">, string[]> = {
  manager: ["careers.manage"],
  applicants: ["careers.applicants"],
};

export interface CareersFixture {
  orgId: string;
  slug: string;
  name: string;
  actingPersonId: string;
  actingUserId: string;
  otherPersonId: string;
  roleIds: Record<Exclude<CareersRoleName, "none">, string>;
  featuresRoleId: string;
}

function assertFixtureSlug(slug: string) {
  if (!/^e2e-careers-\d+$/.test(slug)) throw new Error(`[careers-fixture] refusing to touch non-fixture slug "${slug}"`);
}

async function userIdByEmail(sql: Sql, email: string): Promise<string> {
  const rows = (await withDbRetry("careers user id", () => sql`select id from users where email = ${email}`)) as { id: string }[];
  if (!rows[0]) throw new Error(`[careers-fixture] no user row for ${email}; globalSetup must run first`);
  return rows[0].id;
}

/** The bundle: the slot on `/employment`, plus `/` so the site has a home. `ownCareersPage` adds the bundle's own `/careers`. */
export function careersBundle(orgName: string, options: { ownCareersPage?: boolean; slotOnHome?: boolean } = {}): { pages: unknown[] } {
  const slot = { type: "liveSlot", props: { slot: "careers" } };
  const pages: unknown[] = [
    {
      path: "/",
      frontMatter: { title: orgName, navLabel: "Home" },
      mdxAst: { blocks: [{ type: "hero", props: { heading: orgName } }, ...(options.slotOnHome ? [slot] : [])] },
    },
    {
      path: "/employment",
      frontMatter: { title: "Employment", navLabel: "Employment" },
      mdxAst: { blocks: [{ type: "hero", props: { heading: "Employment" } }, { type: "prose", props: { body: "Come work with us." } }, slot] },
    },
  ];
  if (options.ownCareersPage) {
    pages.push({
      path: "/careers",
      frontMatter: { title: "Our own careers page", navLabel: "Careers" },
      mdxAst: { blocks: [{ type: "hero", props: { heading: "Our own careers page" } }] },
    });
  }
  return { pages };
}

async function insertBundle(sql: Sql, orgId: string, bundle: { pages: unknown[] }): Promise<string> {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, pages: bundle.pages, imageKeys: {} }), "utf-8");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const rows = (await withDbRetry("careers bundle", () => sql`
    insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
    values (${orgId}::uuid, ${hash}, 'application/json', ${bytes.byteLength}, decode(${bytes.toString("hex")}, 'hex'))
    on conflict (organization_id, audience, content_hash) do update set content_type = excluded.content_type  -- 0072 (F289, F341): dedup is per audience; the bundle is private (the column default)
    returning id`)) as { id: string }[];
  return rows[0]!.id;
}

/** Creates the congregation, its live site, profile, people and roles. The toggle is left OFF (no row). */
export async function setupCareersFixture(sql: Sql, stamp = Date.now()): Promise<CareersFixture> {
  const slug = `e2e-careers-${stamp}`;
  assertFixtureSlug(slug);
  const orgId = `e2e96001-0000-4000-8000-${String(stamp % 1_000_000_000_000).padStart(12, "0")}`;
  const actingPersonId = id(2);
  const otherPersonId = id(3);
  const actingUserId = await userIdByEmail(sql, E2E_USERS["mfa-enrolled"].email);
  const roleIds = { manager: id(30), applicants: id(31) };
  const featuresRoleId = id(34);

  await removeStaleCareersFixtures(sql);

  await withDbRetry("careers org", () => sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${orgId}::uuid, 'congregation', ${CAREERS_NAMES.org}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`);
  await withDbRetry("careers roster group", () => sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`);

  for (const [personId, first, last, userId] of [
    [actingPersonId, CAREERS_NAMES.actingFirst, CAREERS_NAMES.actingLast, actingUserId],
    [otherPersonId, CAREERS_NAMES.otherFirst, CAREERS_NAMES.otherLast, null],
  ] as const) {
    await withDbRetry("careers person", () => sql`
      insert into people (id, user_id, first_name, last_name, deletable_until)
      values (${personId}::uuid, ${userId}::uuid, ${first}, ${last}, now() + interval '3 hours')`);
    await withDbRetry("careers membership", () => sql`
      insert into memberships (organization_id, person_id, engagement_status, current_roll)
      values (${orgId}::uuid, ${personId}::uuid, 'regular', 'active')`);
  }

  await withDbRetry("careers profile", () => sql`
    insert into organization_profiles (organization_id, phone, updated_by)
    values (${orgId}::uuid, ${CAREERS_NAMES.phone}, ${actingUserId}::uuid)`);

  const blobId = await insertBundle(sql, orgId, careersBundle(CAREERS_NAMES.org));
  await withDbRetry("careers site", () => sql`
    insert into organization_sites (organization_id, repo, status, content_bundle_key, last_ingested_at)
    values (${orgId}::uuid, ${`org/site-${slug}`}, 'live', ${blobId}::uuid, now())`);

  for (const name of Object.keys(ROLE_KEYS) as Array<keyof typeof ROLE_KEYS>) {
    await withDbRetry("careers role", () => sql`
      insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
      values (${roleIds[name]}::uuid, ${orgId}::uuid, ${`e2e_careers_${name}`}, ${`E2E Careers ${name}`}, 'custom', false)`);
    for (const key of ROLE_KEYS[name]) {
      await withDbRetry("careers role key", () => sql`insert into app_role_permissions (role_id, permission_key) values (${roleIds[name]}::uuid, ${key})`);
    }
  }
  await withDbRetry("careers features role", () => sql`
    insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
    values (${featuresRoleId}::uuid, ${orgId}::uuid, 'e2e_careers_features', 'E2E Careers Features', 'custom', false)`);
  await withDbRetry("careers features key", () => sql`insert into app_role_permissions (role_id, permission_key) values (${featuresRoleId}::uuid, 'org_features.manage')`);

  return { orgId, slug, name: CAREERS_NAMES.org, actingPersonId, actingUserId, otherPersonId, roleIds, featuresRoleId };
}

/** Turns the org's Job openings toggle on/off (`null` removes the row: the default, off). */
export async function setCareersToggle(sql: Sql, fx: CareersFixture, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await withDbRetry("clear careers toggle", () => sql`delete from organization_feature_toggles where organization_id = ${fx.orgId}::uuid and feature_key = ${CAREERS_TOGGLE_KEY}`);
    return;
  }
  await withDbRetry("set careers toggle", () => sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${fx.orgId}::uuid, ${CAREERS_TOGGLE_KEY}, ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`);
}

/** The org's `people` category row: `true`/`false` writes it, `null` removes it (a missing row is ON). */
export async function setPeopleCategory(sql: Sql, fx: CareersFixture, enabled: boolean | null): Promise<void> {
  await withDbRetry("clear people category", () => sql`delete from organization_feature_categories where organization_id = ${fx.orgId}::uuid and category = 'people'`);
  if (enabled !== null) {
    await withDbRetry("set people category", () => sql`
      insert into organization_feature_categories (organization_id, category, enabled)
      values (${fx.orgId}::uuid, 'people', ${enabled})`);
  }
}

/** Makes the acting user hold exactly one careers role (or none), optionally also the Features role. */
export async function setCareersRole(sql: Sql, fx: CareersFixture, role: CareersRoleName, options: { features?: boolean } = {}): Promise<void> {
  const grants: string[] = [];
  if (role !== "none") grants.push(fx.roleIds[role]);
  if (options.features) grants.push(fx.featuresRoleId);
  await withDbRetry("set careers role", async () => {
    await sql`delete from role_grants where organization_id = ${fx.orgId}::uuid and person_id = ${fx.actingPersonId}::uuid`;
    for (const roleId of grants) {
      await sql`
        insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
        values (${fx.orgId}::uuid, ${roleId}::uuid, ${fx.actingPersonId}::uuid, date '2020-01-01', ${fx.actingUserId}::uuid)`;
    }
  });
}

/** Replaces the site's published bundle (the slot on /employment; optionally the bundle's own /careers). */
export async function setSiteBundle(sql: Sql, fx: CareersFixture, options: { ownCareersPage?: boolean; slotOnHome?: boolean } = {}): Promise<void> {
  assertFixtureSlug(fx.slug);
  const blobId = await insertBundle(sql, fx.orgId, careersBundle(fx.name, options));
  await withDbRetry("careers set bundle", () => sql`update organization_sites set content_bundle_key = ${blobId}::uuid where organization_id = ${fx.orgId}::uuid`);
}

export async function setSiteStatus(sql: Sql, fx: CareersFixture, status: "provisioning" | "live" | "suspended"): Promise<void> {
  assertFixtureSlug(fx.slug);
  await withDbRetry("careers site status", () => sql`update organization_sites set status = ${status} where organization_id = ${fx.orgId}::uuid`);
}

export type PostingState = "draft" | "published" | "closed" | "discarded";

export interface PostingSpec {
  slug: string;
  title: string;
  state: PostingState;
  summary?: string;
  location?: string;
  type?: "full_time" | "part_time" | "intern";
  payMinCents?: number | null;
  payMaxCents?: number | null;
  payUnit?: "hour" | "year" | null;
  description?: string;
  /** Set AFTER publishing, so a past date is possible (a legal edit). 'YYYY-MM-DD'. */
  closingDate?: string | null;
}

/** Inserts one posting by walking legal edges as the owner. Returns its id. */
export async function addPosting(sql: Sql, fx: CareersFixture, spec: PostingSpec): Promise<string> {
  assertFixtureSlug(fx.slug);
  const complete = spec.state === "published" || spec.state === "closed";
  const rows = (await withDbRetry("insert posting", () => sql`
    insert into job_postings (organization_id, slug, title, summary, location, employment_type,
                              pay_min_cents, pay_max_cents, pay_unit, description_md)
    values (${fx.orgId}::uuid, ${spec.slug}, ${spec.title},
            ${spec.summary ?? (complete ? "A summary for the opening." : "")},
            ${spec.location ?? (complete ? "Main campus" : "")},
            ${spec.type ?? "full_time"},
            ${spec.payMinCents ?? null}, ${spec.payMaxCents ?? null}, ${spec.payUnit ?? null},
            ${spec.description ?? (complete ? "## About the role\n\nA description of the role." : "")})
    returning id`)) as { id: string }[];
  const postingId = rows[0]!.id;
  if (spec.state === "published" || spec.state === "closed") {
    await withDbRetry("publish posting", () => sql`update job_postings set status = 'published' where id = ${postingId}::uuid`);
  }
  if (spec.closingDate !== undefined && spec.closingDate !== null) {
    await setClosingDate(sql, fx, postingId, spec.closingDate);
  }
  if (spec.state === "closed" || spec.state === "discarded") {
    await withDbRetry("close posting", () => sql`update job_postings set status = 'closed' where id = ${postingId}::uuid`);
  }
  return postingId;
}

/** Sets a posting's closing date by owner SQL (a past date is only reachable after publishing). */
export async function setClosingDate(sql: Sql, fx: CareersFixture, postingId: string, day: string | null): Promise<void> {
  assertFixtureSlug(fx.slug);
  await withDbRetry("set closing date", () => sql`
    update job_postings set closing_date = ${day}::date where id = ${postingId}::uuid and organization_id = ${fx.orgId}::uuid`);
}

/** The organization's own today, as Postgres reads it ('YYYY-MM-DD', default zone America/New_York). */
export async function orgToday(sql: Sql, offsetDays = 0): Promise<string> {
  const rows = (await withDbRetry("org today", () => sql`
    select to_char((now() at time zone 'America/New_York')::date + ${offsetDays}::int, 'YYYY-MM-DD') as d`)) as { d: string }[];
  return rows[0]!.d;
}

export interface PostingDbRow {
  status: string;
  version: number;
  title: string;
  slug: string;
  sort_order: number;
}

export async function postingBySlug(sql: Sql, fx: CareersFixture, slug: string): Promise<PostingDbRow | null> {
  const rows = (await withDbRetry("posting by slug", () => sql`
    select status, version, title, slug, sort_order from job_postings
     where organization_id = ${fx.orgId}::uuid and slug = ${slug}`)) as PostingDbRow[];
  return rows[0] ?? null;
}

export async function postingCount(sql: Sql, fx: CareersFixture): Promise<number> {
  const rows = (await withDbRetry("posting count", () => sql`select count(*)::int as n from job_postings where organization_id = ${fx.orgId}::uuid`)) as { n: number }[];
  return rows[0]!.n;
}

/** Audit rows for this organization's careers status changes, oldest first. */
export async function careersAuditRows(sql: Sql, fx: CareersFixture): Promise<Array<{ action: string; metadata: Record<string, unknown> }>> {
  return (await withDbRetry("careers audit", () => sql`
    select action, metadata from audit_events
     where action like 'careers.posting.%' and metadata->>'organizationId' = ${fx.orgId}
     order by created_at asc`)) as Array<{ action: string; metadata: Record<string, unknown> }>;
}

/** Removes every `e2e-careers-<digits>` congregation a crashed run left behind, then the fixed-id people. */
async function removeStaleCareersFixtures(sql: Sql): Promise<void> {
  const stale = (await withDbRetry("list stale careers orgs", () => sql`select id from organizations where slug ~ '^e2e-careers-[0-9]+$'`)) as { id: string }[];
  for (const { id: orgId } of stale) await removeCareersFixtureById(sql, orgId);
  await withDbRetry("delete careers fixture people", () => sql`delete from people where id in (${id(2)}::uuid, ${id(3)}::uuid)`);
}

async function removeCareersFixtureById(sql: Sql, orgId: string): Promise<void> {
  // The derived-roster trigger refuses the cascade a fixture org's delete fires against its
  // group_memberships; disabled around the delete, as every other fixture teardown here does.
  try {
    await withDbRetry(`delete careers org ${orgId}`, async () => {
      await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
      try {
        await sql`delete from organization_sites where organization_id = ${orgId}::uuid`;
        await sql`delete from blob_assets where organization_id = ${orgId}::uuid`;
        await sql`delete from organizations where id = ${orgId}::uuid`;
      } finally {
        await sql`alter table group_memberships enable trigger group_memberships_reject_derived`;
      }
    });
  } finally {
    await withDbRetry("re-enable roster trigger", () => sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
  }
  await withDbRetry("delete careers fixture people", () => sql`delete from people where id in (${id(2)}::uuid, ${id(3)}::uuid)`);
}

/** Removes everything the fixture made: the org cascades every posting, then the people. */
export async function removeCareersFixture(sql: Sql, fx: CareersFixture): Promise<void> {
  assertFixtureSlug(fx.slug);
  await removeCareersFixtureById(sql, fx.orgId);
  const left = (await withDbRetry("confirm careers org gone", () => sql`select 1 from organizations where id = ${fx.orgId}::uuid`)) as unknown[];
  if (left.length > 0) throw new Error(`[careers-fixture] the fixture organization ${fx.slug} was not removed`);
}
