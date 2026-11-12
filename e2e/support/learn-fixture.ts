/**
 * learn-fixture.ts - setup and teardown for the Spot the scam specs
 * (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 "E2E plan"; DECISION-157: a spec creates
 * only its own rows and removes them itself). A NEW file, written for this pipeline (the
 * `careers-fixture.ts` precedent); it edits no shared e2e support file and reuses
 * `giving-fixture`'s `verifiedContext` (a real TOTP challenge for the `mfa-enrolled` user) and
 * `custom-hosts`'s `setBrand`/`addDomain`, unchanged.
 *
 * THE WORLD. Two throwaway organizations, both `deletable_until`, each with a LIVE site:
 *
 *   congregation  `e2e-learn-<stamp>`        the main subject; a bundle with the `spotTheScam`
 *                                            live slot on `/practice` (and twice on
 *                                            `/practice-twice`), a `/learn` page and a
 *                                            `/learn/other` page of its own (the bundle owns
 *                                            every `/learn/...` path but the trainer's)
 *   presbytery    `e2e-learn-pres-<stamp>`   proves "every organization type": the toggle, the
 *                                            route and the (org) page are not congregation-only
 *
 * ACTING USER. The `mfa-enrolled` fixture, linked to a person with a membership in BOTH
 * organizations, who completes the real TOTP challenge once. Their `org_features.manage` role
 * at the congregation is swapped in the database between tests (permissions are read live):
 * `manager` or `none`, to prove the "Turn it on under Features" link appears only for someone
 * who can use it.
 *
 * Toggle, category and axis writes are owner SQL. The Spot the scam toggle is left OFF (no row).
 *
 * IDS. Person ids use the pre-assigned range `00000000-0000-4087-8000-...`, role ids
 * `00000000-0000-4087-9000-...`; organization ids are unique per run (`...-a001-` / `...-a002-`)
 * so audit rows, which are append-only and kept forever, never mix runs.
 */

import { createHash } from "node:crypto";
import { withDbRetry, type Sql } from "./db";
import { E2E_USERS } from "./users";

export const LEARN_TOGGLE_KEY = "org_portal.spot_the_scam";
export const LEARN_SLOT = "spotTheScam";
export const LEARN_PATH = "/learn/spot-the-scam";
export const LEARN_NAMES = {
  congregation: "E2E Learn Church",
  presbytery: "E2E Learn Presbytery",
  actingFirst: "Ottoline",
  actingLast: "Brannigan",
} as const;

const PERSON = "00000000-0000-4087-8000-";
const ROLE = "00000000-0000-4087-9000-";
const pid = (n: number) => `${PERSON}${String(n).padStart(12, "0")}`;
const rid = (n: number) => `${ROLE}${String(n).padStart(12, "0")}`;

export interface LearnOrg {
  orgId: string;
  slug: string;
  name: string;
}

export interface LearnFixture {
  congregation: LearnOrg;
  presbytery: LearnOrg;
  actingPersonId: string;
  actingUserId: string;
  featuresRoleId: string;
}

function assertUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error(`[learn-fixture] not a uuid: ${value}`);
}

const SLUG_RE = /^e2e-learn-(?:pres-)?\d+$/;

function assertFixtureSlug(slug: string) {
  if (!SLUG_RE.test(slug)) throw new Error(`[learn-fixture] refusing to touch non-fixture slug "${slug}"`);
}

async function userIdByEmail(sql: Sql, email: string): Promise<string> {
  const rows = (await withDbRetry("learn user id", () => sql`select id from users where email = ${email}`)) as { id: string }[];
  if (!rows[0]) throw new Error(`[learn-fixture] no user row for ${email}; globalSetup must run first`);
  return rows[0].id;
}

export interface BundleOptions {
  /** The bundle's own page at exactly /learn/spot-the-scam (it wins over the platform page). */
  ownTrainerPage?: boolean;
  /** Place the slot on the home page too. */
  slotOnHome?: boolean;
  /** Leave out the bundle's own /learn and /learn/other pages (so they are the site's neutral 404). */
  noLearnPages?: boolean;
}

/**
 * The bundle: the slot on `/practice` (once) and `/practice-twice` (twice), the bundle's own `/learn` and
 * `/learn/other` pages (a bundle owns every /learn/... path except the platform trainer's), and `/` so
 * the site has a home. `ownTrainerPage` adds the bundle's own `/learn/spot-the-scam`.
 */
export function learnBundle(orgName: string, options: BundleOptions = {}): { pages: unknown[] } {
  const slot = { type: "liveSlot", props: { slot: LEARN_SLOT } };
  const hero = (heading: string) => ({ type: "hero", props: { heading } });
  const pages: unknown[] = [
    {
      path: "/",
      frontMatter: { title: orgName, navLabel: "Home" },
      mdxAst: { blocks: [hero(orgName), ...(options.slotOnHome ? [slot] : [])] },
    },
    {
      path: "/practice",
      frontMatter: { title: "Practice", navLabel: "Practice" },
      mdxAst: { blocks: [hero("Practice"), { type: "prose", props: { body: "Try this practice." } }, slot] },
    },
    {
      path: "/practice-twice",
      frontMatter: { title: "Practice twice", navLabel: "Practice twice" },
      mdxAst: { blocks: [hero("Practice twice"), slot, slot] },
    },
    ...(options.noLearnPages
      ? []
      : [
          {
            path: "/learn",
            frontMatter: { title: "Learn", navLabel: "Learn" },
            mdxAst: { blocks: [hero("Our own learn page")] },
          },
          {
            path: "/learn/other",
            frontMatter: { title: "Another learn page", navLabel: "Another" },
            mdxAst: { blocks: [hero("Our own other learn page")] },
          },
        ]),
  ];
  if (options.ownTrainerPage) {
    pages.push({
      path: LEARN_PATH,
      frontMatter: { title: "Our own trainer page", navLabel: "Trainer" },
      mdxAst: { blocks: [hero("Our own trainer page")] },
    });
  }
  return { pages };
}

async function insertBundle(sql: Sql, orgId: string, bundle: { pages: unknown[] }): Promise<string> {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, pages: bundle.pages, imageKeys: {} }), "utf-8");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const rows = (await withDbRetry("learn bundle", () => sql`
    insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
    values (${orgId}::uuid, ${hash}, 'application/json', ${bytes.byteLength}, decode(${bytes.toString("hex")}, 'hex'))
    on conflict (organization_id, audience, content_hash) do update set content_type = excluded.content_type
    returning id`)) as { id: string }[];
  return rows[0]!.id;
}

async function insertOrg(
  sql: Sql,
  o: { id: string; type: "congregation" | "presbytery"; name: string; slug: string; personId: string; bundle: { pages: unknown[] } },
): Promise<void> {
  assertFixtureSlug(o.slug);
  await withDbRetry(`learn org ${o.slug}`, () => sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${o.id}::uuid, ${o.type}, ${o.name}, ${o.slug}, ${o.slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`);
  await withDbRetry(`learn roster group ${o.slug}`, () => sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${o.id}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`);
  // The acting person is a member of BOTH organizations, and a second membership for one person is refused
  // unless the claim is authorized (drizzle/0009): one statement, because the authorization is
  // transaction-local and this driver has no multi-statement transaction (seed-orgs.ts, mechanic 2).
  // A person is on ONE roll (memberships_one_active_roll_idx), so only the congregation's membership carries
  // `current_roll = 'active'`; the presbytery relationship has none (org-multi's second relationship, seed-orgs.ts).
  // The ids are module constants and a UUID-shaped, validated organization id, never request input.
  assertUuid(o.id);
  assertUuid(o.personId);
  await withDbRetry(`learn membership ${o.slug}`, () => sql.query(`
    do $learn$
    begin
      perform set_config('app.person_claim_authorized', '${o.personId}', true);
      insert into memberships (organization_id, person_id, engagement_status, current_roll)
      values ('${o.id}'::uuid, '${o.personId}'::uuid, 'regular', ${o.type === "congregation" ? "'active'" : "null"});
    end
    $learn$;`));
  const blobId = await insertBundle(sql, o.id, o.bundle);
  await withDbRetry(`learn site ${o.slug}`, () => sql`
    insert into organization_sites (organization_id, repo, status, content_bundle_key, last_ingested_at)
    values (${o.id}::uuid, ${`org/site-${o.slug}`}, 'live', ${blobId}::uuid, now())`);
}

/** Creates both organizations, their live sites, the acting person and the Features role. The toggle is left OFF (no row). */
export async function setupLearnFixture(sql: Sql, stamp = Date.now()): Promise<LearnFixture> {
  const tail = String(stamp % 1_000_000_000_000).padStart(12, "0");
  const congregation: LearnOrg = { orgId: `00000000-0000-4087-a001-${tail}`, slug: `e2e-learn-${stamp}`, name: LEARN_NAMES.congregation };
  const presbytery: LearnOrg = { orgId: `00000000-0000-4087-a002-${tail}`, slug: `e2e-learn-pres-${stamp}`, name: LEARN_NAMES.presbytery };
  const actingPersonId = pid(2);
  const featuresRoleId = rid(30);
  const actingUserId = await userIdByEmail(sql, E2E_USERS["mfa-enrolled"].email);

  await removeStaleLearnFixtures(sql);

  await withDbRetry("learn acting person", () => sql`
    insert into people (id, user_id, first_name, last_name, deletable_until)
    values (${actingPersonId}::uuid, ${actingUserId}::uuid, ${LEARN_NAMES.actingFirst}, ${LEARN_NAMES.actingLast}, now() + interval '3 hours')`);
  await insertOrg(sql, { id: congregation.orgId, type: "congregation", name: congregation.name, slug: congregation.slug, personId: actingPersonId, bundle: learnBundle(congregation.name) });
  await insertOrg(sql, { id: presbytery.orgId, type: "presbytery", name: presbytery.name, slug: presbytery.slug, personId: actingPersonId, bundle: learnBundle(presbytery.name) });

  await withDbRetry("learn features role", () => sql`
    insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
    values (${featuresRoleId}::uuid, ${congregation.orgId}::uuid, 'e2e_learn_features', 'E2E Learn Features', 'custom', false)`);
  await withDbRetry("learn features role key", () => sql`insert into app_role_permissions (role_id, permission_key) values (${featuresRoleId}::uuid, 'org_features.manage')`);

  return { congregation, presbytery, actingPersonId, actingUserId, featuresRoleId };
}

/** Turns an org's Spot the scam toggle on/off (`null` removes the row: the default, off). */
export async function setLearnToggle(sql: Sql, orgId: string, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await withDbRetry("clear learn toggle", () => sql`delete from organization_feature_toggles where organization_id = ${orgId}::uuid and feature_key = ${LEARN_TOGGLE_KEY}`);
    return;
  }
  await withDbRetry("set learn toggle", () => sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${orgId}::uuid, ${LEARN_TOGGLE_KEY}, ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`);
}

/** The org's `learn` category row: `true`/`false` writes it, `null` removes it (a missing row is ON). */
export async function setLearnCategory(sql: Sql, orgId: string, enabled: boolean | null): Promise<void> {
  await withDbRetry("clear learn category", () => sql`delete from organization_feature_categories where organization_id = ${orgId}::uuid and category = 'learn'`);
  if (enabled !== null) {
    await withDbRetry("set learn category", () => sql`
      insert into organization_feature_categories (organization_id, category, enabled)
      values (${orgId}::uuid, 'learn', ${enabled})`);
  }
}

/** Makes the acting user hold the Features role at the congregation (`manager`) or nothing (`none`). */
export async function setActingRole(sql: Sql, fx: LearnFixture, role: "manager" | "none"): Promise<void> {
  await withDbRetry("set learn role", async () => {
    await sql`delete from role_grants where organization_id = ${fx.congregation.orgId}::uuid and person_id = ${fx.actingPersonId}::uuid`;
    if (role === "manager") {
      await sql`
        insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
        values (${fx.congregation.orgId}::uuid, ${fx.featuresRoleId}::uuid, ${fx.actingPersonId}::uuid, date '2020-01-01', ${fx.actingUserId}::uuid)`;
    }
  });
}

/** Replaces an org's published bundle. */
export async function setSiteBundle(sql: Sql, org: LearnOrg, options: BundleOptions = {}): Promise<void> {
  assertFixtureSlug(org.slug);
  const blobId = await insertBundle(sql, org.orgId, learnBundle(org.name, options));
  await withDbRetry("learn set bundle", () => sql`update organization_sites set content_bundle_key = ${blobId}::uuid where organization_id = ${org.orgId}::uuid`);
}

export async function setLearnSiteStatus(sql: Sql, org: LearnOrg, status: "provisioning" | "live" | "suspended"): Promise<void> {
  assertFixtureSlug(org.slug);
  await withDbRetry("learn site status", () => sql`update organization_sites set status = ${status} where organization_id = ${org.orgId}::uuid`);
}

/** Renames an org (a long name must wrap at 360px). */
export async function setOrgName(sql: Sql, org: LearnOrg, name: string): Promise<void> {
  assertFixtureSlug(org.slug);
  await withDbRetry("learn org name", () => sql`update organizations set name = ${name} where id = ${org.orgId}::uuid`);
}

/** Audit rows for the Spot the scam toggle at one organization, oldest first. */
export async function learnToggleAuditRows(sql: Sql, orgId: string): Promise<Array<{ action: string; metadata: Record<string, unknown> }>> {
  return (await withDbRetry("learn toggle audit", () => sql`
    select action, metadata from audit_events
     where action = 'tenant.org_feature.toggled' and metadata->>'organizationId' = ${orgId}
       and metadata->>'featureKey' = ${LEARN_TOGGLE_KEY}
     order by created_at asc`)) as Array<{ action: string; metadata: Record<string, unknown> }>;
}

/** Removes every `e2e-learn-...` organization a crashed run left behind, then the fixed-id person. */
async function removeStaleLearnFixtures(sql: Sql): Promise<void> {
  const stale = (await withDbRetry("list stale learn orgs", () => sql`select id from organizations where slug ~ '^e2e-learn-(pres-)?[0-9]+$'`)) as { id: string }[];
  for (const { id: orgId } of stale) await removeLearnOrgById(sql, orgId);
  await withDbRetry("delete learn fixture person", () => sql`delete from people where id = ${pid(2)}::uuid`);
}

async function removeLearnOrgById(sql: Sql, orgId: string): Promise<void> {
  // The derived-roster trigger refuses the cascade a fixture org's delete fires against its
  // group_memberships; disabled around the delete, as every other fixture teardown here does.
  try {
    await withDbRetry(`delete learn org ${orgId}`, async () => {
      await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
      try {
        await sql`delete from organization_brands where organization_id = ${orgId}::uuid`;
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
}

/** Removes everything the fixture made, then confirms by SELECT that it is gone. */
export async function removeLearnFixture(sql: Sql, fx: LearnFixture): Promise<void> {
  for (const org of [fx.congregation, fx.presbytery]) {
    assertFixtureSlug(org.slug);
    await removeLearnOrgById(sql, org.orgId);
  }
  await withDbRetry("delete learn fixture person", () => sql`delete from people where id = ${fx.actingPersonId}::uuid`);
  for (const org of [fx.congregation, fx.presbytery]) {
    const left = (await withDbRetry("confirm learn org gone", () => sql`select 1 from organizations where id = ${org.orgId}::uuid`)) as unknown[];
    if (left.length > 0) throw new Error(`[learn-fixture] the fixture organization ${org.slug} was not removed`);
  }
  const person = (await withDbRetry("confirm learn person gone", () => sql`select 1 from people where id = ${fx.actingPersonId}::uuid`)) as unknown[];
  if (person.length > 0) throw new Error("[learn-fixture] the fixture person was not removed");
}
