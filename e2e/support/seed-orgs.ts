/**
 * seed-orgs.ts — provisions the organizations and relationships the post-login
 * router's specs need.
 *
 * Called by globalSetup immediately after seed-users.ts, which this file
 * depends on: it links `people` rows to users that must already exist.
 *
 * WHY THIS FILE EXISTS. Before it, `E2E_USERS` were platform users with no
 * `people` row at all, and `scripts/seed-dev.sql`'s people carry no password —
 * so four rows of the destination matrix (the chooser, the single-organization
 * forward, the access-denied page, the 404) were reachable by unit test only.
 * That is precisely the "a page that returns 200 is not a page that works"
 * gap CLAUDE.md's browser invariant is about.
 *
 * TWO MECHANICS THAT ARE NOT OBVIOUS AND COST AN HOUR EACH TO REDISCOVER:
 *
 *   1. IT NEEDS THE PLATFORM CONNECTION, NOT `DATABASE_URL`. seed-users.ts runs
 *      as `presby_app`, which is `NOBYPASSRLS` — it has no INSERT on
 *      `organizations` and is filtered to zero rows on `people` and
 *      `memberships` with no org GUC set. Writing fixtures needs the owner
 *      connection: `E2E_PLATFORM_DATABASE_URL ?? PLATFORM_DATABASE_URL`. This is
 *      the one legitimate use of it in the suite, and it is fixture setup, not
 *      application code.
 *
 *   2. THE SECOND MEMBERSHIP MUST BE ONE STATEMENT. `memberships_guard_insert`
 *      (F21) rejects a person who already exists elsewhere unless
 *      `app.person_claim_authorized` is set — and that setting is
 *      transaction-local. The neon HTTP driver gives every tagged-template call
 *      its own implicit transaction and has no multi-statement transaction, so
 *      a `set_config` in one call and an INSERT in the next silently loses the
 *      flag. The DO block below is therefore one statement doing both, which is
 *      the same shape `scripts/seed-dev.sql` uses for the pastor.
 *
 * Everything here is idempotent: fixed UUIDs, upserts, and `on conflict do
 * nothing`. Every name is invented and every address is on the reserved
 * reserved `.invalid` TLD (RFC 2606), per CLAUDE.md → No Real Data.
 */

import { neon } from "@neondatabase/serverless";
import { E2E_USERS, type E2ERole } from "./users";

type Sql = ReturnType<typeof neon<false, false>>;

/**
 * Fixture organizations. Slugs are `e2e-` prefixed so they are recognisable in
 * a database that also carries `scripts/seed-dev.sql`, and so the guard below
 * can refuse to touch anything else. They already satisfy the DNS-label CHECK
 * on `organizations.slug` — that constraint is why a slug like `e2e_alpha`
 * would be rejected.
 *
 * `path` is ltree-SHAPED but the column is plain `text`
 * (`src/lib/db/domain/org.ts` — the extension is not installed; only
 * `btree_gist` is). It is written in ltree label form anyway, because that is
 * the house style and because the day the extension arrives the existing rows
 * should already cast. ltree labels allow underscores but not hyphens, so the
 * labels are the slugs with hyphens swapped — the same mismatch
 * `scripts/seed-dev.sql` carries.
 */
export const E2E_ORGS = {
  presbytery: {
    id: "e2e00000-0000-0000-0000-000000000001",
    parentId: null as string | null,
    type: "presbytery",
    name: "Presbytery of the Eastern Fells",
    slug: "e2e-presbytery",
    path: "e2e_presbytery",
    platformStatus: "managed",
  },
  alpha: {
    id: "e2e00000-0000-0000-0000-000000000002",
    parentId: "e2e00000-0000-0000-0000-000000000001",
    type: "congregation",
    name: "Wrenfield Presbyterian Church",
    slug: "e2e-alpha",
    path: "e2e_presbytery.e2e_alpha",
    platformStatus: "managed",
  },
  // A managed congregation the fixtures have NO relationship with — the
  // access-denied case that must be worded identically to the unmanaged one.
  beta: {
    id: "e2e00000-0000-0000-0000-000000000003",
    parentId: "e2e00000-0000-0000-0000-000000000001",
    type: "congregation",
    name: "Thistledown Presbyterian Church",
    slug: "e2e-beta",
    path: "e2e_presbytery.e2e_beta",
    platformStatus: "managed",
  },
  // In the presbytery's records, not a tenant (D9). No portal behind it.
  gamma: {
    id: "e2e00000-0000-0000-0000-000000000004",
    parentId: "e2e00000-0000-0000-0000-000000000001",
    type: "congregation",
    name: "Halloway Presbyterian Church",
    slug: "e2e-gamma",
    path: "e2e_presbytery.e2e_gamma",
    platformStatus: "unmanaged",
  },
} as const;

/**
 * The date the `org-ended` fixture's relationship ended.
 *
 * Exported because the spec asserts it renders as the 31st. It is deliberately
 * a month-end: a calendar date parsed as UTC midnight and formatted locally
 * rolls back a day west of UTC, and 31 March → 30 March is the version of that
 * bug you notice. Both layers that could reintroduce it — the SQL cast in
 * userOrganizations() and the calendar-date branch in <FormattedDate> — are
 * pinned by this fixture end to end.
 */
export const E2E_ENDED_ON = "2026-03-31";

/**
 * The ONE branded fixture organization, and its invented seed colour.
 *
 * `presbytery` (e2e-presbytery) — NOT `alpha` (e2e-alpha). `alpha` looked
 * like the obvious choice (it is already `/o/e2e-alpha`, the "active-
 * relationship org portal stub" route `e2e/support/routes.ts` walks) and
 * branding it first is exactly the mistake this comment exists to head off:
 * `e2e/admin-organizations.spec.ts` (P0.5 commit `c3`) hard-codes `alpha` as
 * the PERMANENTLY-unbranded fixture for its "still on default palette" OQ4
 * filter test and its "never-branded" detail-page test, and branding it here
 * broke both — caught by running the full suite, not reasoned about in
 * advance. `presbytery` has no other spec asserting anything about its brand
 * state, and `org-multi`'s SECOND relationship (see `firstMemberships` /
 * the presbytery DO block below) is already active there, so `/o/e2e-
 * presbytery` is a real, enterable "ok" route for an existing fixture user —
 * no new person, user, or storageState needed. `beta` (org-ended) and
 * `gamma` (unmanaged) were considered and rejected for a different reason:
 * neither ever reaches the "ok" branch of `resolveOrgContext()`, so a brand
 * row on either would never actually render anywhere — branding them would
 * prove nothing.
 *
 * A deep maroon, nowhere near the platform's `hsl(221 83% 53%)` blue, so a
 * branded vs. unbranded screenshot is unmistakable at a glance even before
 * reading any computed style. Invented, per CLAUDE.md → No Real Data — no
 * real congregation's actual colour.
 */
export const E2E_BRANDED_ORG = E2E_ORGS.presbytery;
export const E2E_BRAND_SEED_HEX = "#7a1f2b";

/** One `people` row per organization fixture user, with a stable id. */
const FIXTURE_PEOPLE: Array<{
  id: string;
  role: Extract<
    E2ERole,
    | "org-single"
    | "org-multi"
    | "org-unmanaged"
    | "org-ended"
    | "presbytery-clerk"
    | "presbytery-nogrant"
    | "congregation-clerk"
  >;
  firstName: string;
  lastName: string;
}> = [
  {
    id: "e2e00000-0000-0000-0000-0000000000a1",
    role: "org-single",
    firstName: "Marguerite",
    lastName: "Ashcombe",
  },
  {
    id: "e2e00000-0000-0000-0000-0000000000a2",
    role: "org-multi",
    firstName: "Tobias",
    lastName: "Fennimore",
  },
  {
    id: "e2e00000-0000-0000-0000-0000000000a3",
    role: "org-unmanaged",
    firstName: "Rosalind",
    lastName: "Pyke",
  },
  {
    id: "e2e00000-0000-0000-0000-0000000000a4",
    role: "org-ended",
    firstName: "Aurelio",
    lastName: "Standish",
  },
  // -------------------------------------------------------------------
  // APPENDED — presbytery-portal e2e coverage (2026-09-28-presbytery-e2e,
  // DECISION-157). Appended to the existing array, not a parallel one —
  // assertFixtureShape() only validates what is in THIS array.
  // -------------------------------------------------------------------
  {
    id: "e2e00000-0000-0000-0000-0000000000a5",
    role: "presbytery-clerk",
    firstName: "Perpetua",
    lastName: "Winlock",
  },
  {
    id: "e2e00000-0000-0000-0000-0000000000a6",
    role: "presbytery-nogrant",
    firstName: "Cassius",
    lastName: "Brightwell",
  },
  {
    id: "e2e00000-0000-0000-0000-0000000000a7",
    role: "congregation-clerk",
    firstName: "Ottoline",
    lastName: "Fairweather",
  },
];

const REQUIRED_EMAIL_SUFFIX = ".invalid";
const REQUIRED_SLUG_PREFIX = "e2e-";

/**
 * The same guard seed-users.ts carries, widened by one clause.
 *
 * This module writes with an RLS-BYPASSING connection, so it is the most
 * dangerous file in the suite if it is ever pointed at the wrong database. The
 * email suffix is a reserved TLD that can never resolve; the slug prefix means
 * a mistake cannot land on `alder-creek` — or on a real congregation.
 */
function assertFixtureShape(): void {
  for (const org of Object.values(E2E_ORGS)) {
    if (!org.slug.startsWith(REQUIRED_SLUG_PREFIX)) {
      throw new Error(
        `[seed-orgs] Refusing to write organization "${org.slug}": fixture ` +
          `slugs must start with "${REQUIRED_SLUG_PREFIX}". This guard is what ` +
          `keeps an RLS-bypassing seeder off real rows.`,
      );
    }
  }
  for (const person of FIXTURE_PEOPLE) {
    const email = E2E_USERS[person.role].email;
    if (!email.endsWith(REQUIRED_EMAIL_SUFFIX)) {
      throw new Error(
        `[seed-orgs] Refusing to provision "${email}": e2e fixture emails must ` +
          `end in ${REQUIRED_EMAIL_SUFFIX}.`,
      );
    }
  }
}

async function userIdByEmail(sql: Sql, email: string): Promise<string> {
  const rows = (await sql`SELECT id FROM users WHERE email = ${email}`) as {
    id: string;
  }[];
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(
      `[seed-orgs] No user row for ${email}. seedE2EUsers() must run first — ` +
        `globalSetup calls it immediately before this.`,
    );
  }
  return id;
}

/**
 * Provision the fixture organizations, people, and relationships.
 *
 * Throws on the first failure. A fixture that cannot be created is a failed
 * run, never a skipped one (DECISION-032).
 */
export async function seedE2EOrgs(platformDbUrl: string): Promise<void> {
  if (!platformDbUrl) {
    throw new Error(
      "[seed-orgs] No platform database URL. Set PLATFORM_DATABASE_URL (or " +
        "E2E_PLATFORM_DATABASE_URL) in .env.local.\n" +
        "DATABASE_URL will not do: it connects as presby_app, which is " +
        "NOBYPASSRLS — it cannot INSERT into organizations and sees zero rows " +
        "in people/memberships with no org context set.",
    );
  }

  assertFixtureShape();
  const sql = neon(platformDbUrl);

  // `parent_id` and `path` are NOT written here, on either the INSERT or the
  // upsert's SET list (drizzle/0044). Both columns are derived from
  // `organization_affiliations` by `presby_apply_affiliation_to_org_tree()`,
  // and `organizations_guard_insert`/`organizations_guard_reparent` reject a
  // direct write on BOTH connections — including this one, since BYPASSRLS
  // exempts a role from policies but never from triggers. Note that the
  // upsert's old `path = EXCLUDED.path` would have tripped the reparent
  // guard on every re-seed even when the value was unchanged: `UPDATE OF
  // path` fires on the column being in the SET list, not on it changing.
  //
  // The INSERT seeds the root-shaped label; the affiliation loop below
  // derives the real `e2e_presbytery.<label>` path for the three children.
  for (const org of Object.values(E2E_ORGS)) {
    await sql`
      INSERT INTO organizations (id, organization_type, name, slug, path, platform_status)
      VALUES (
        ${org.id}::uuid,
        ${org.type},
        ${org.name},
        ${org.slug},
        ${org.slug.replace(/-/g, "_")},
        ${org.platformStatus}
      )
      ON CONFLICT (id) DO UPDATE SET
        organization_type = EXCLUDED.organization_type,
        name              = EXCLUDED.name,
        slug              = EXCLUDED.slug,
        platform_status   = EXCLUDED.platform_status
    `;
  }

  // One open affiliation per child fixture, written only when the child has
  // none: `organization_affiliations_no_overlap` (a GIST EXCLUDE) would
  // reject a second unbounded/overlapping row on a re-seed, and this seeder
  // must stay re-runnable. The INSERT's own AFTER trigger sets the child's
  // parent_id and path, so `E2E_ORGS[...].path` is the value the database
  // ends up with, not the value written.
  for (const org of Object.values(E2E_ORGS)) {
    if (!org.parentId) continue;
    await sql`
      INSERT INTO organization_affiliations
        (organization_id, subject_org_id, parent_org_id, relationship_type,
         effective_from, authority, minute_reference)
      SELECT ${org.parentId}::uuid, ${org.id}::uuid, ${org.parentId}::uuid,
             'member_congregation', DATE '2020-01-01', 'recorded',
             'e2e fixture affiliation (e2e/support/seed-orgs.ts)'
       WHERE NOT EXISTS (
         SELECT 1 FROM organization_affiliations
          WHERE subject_org_id = ${org.id}::uuid AND effective_to IS NULL
       )
    `;
  }

  // Each org's `active_membership` DERIVED GROUP (drizzle/0017, DECISION-060/
  // 063) — discovered mid-implementation (2026-09-28-presbytery-e2e), not
  // anticipated by Phase 3's design. `memberships_sync_derived_group` fires
  // unconditionally on ANY insert into `memberships` and raises if the
  // target org has no `active_membership` group yet. Every existing e2e-*
  // membership row predates migration 0017 (created 2026-08-18) and this
  // seeder's own `WHERE NOT EXISTS` guard has silently skipped re-inserting
  // them ever since — so the gap was invisible until THIS pipeline's new
  // fixture actors became the first genuinely NEW membership insert at these
  // orgs since 0017 landed (presbytery-clerk/presbytery-nogrant, first-ever
  // memberships at e2e-presbytery; congregation-clerk, a first-ever new
  // person at e2e-alpha). Same remediation `scripts/seed-dev.sql` already
  // applies for its own fixture orgs (DECISION-063): `roster` group_type
  // (a platform-wide, code-seeded template — `db:seed`'s `seedGroupTypes()`),
  // named 'Active Membership' verbatim (`presby_effective_permissions()`'s
  // group arm surfaces this as `source_name`). Written BEFORE any membership
  // insert below, for every org, not only the ones this pipeline's own new
  // actors target — the next pipeline to add a membership at e2e-beta/
  // e2e-gamma should not have to rediscover this.
  for (const org of Object.values(E2E_ORGS)) {
    await sql`
      INSERT INTO groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      SELECT ${org.id}::uuid, (SELECT id FROM group_types WHERE key = 'roster'),
             'Active Membership', 'derived', 'active_membership', true
       WHERE NOT EXISTS (
         SELECT 1 FROM groups
          WHERE organization_id = ${org.id}::uuid AND derived_from = 'active_membership'
       )
    `;
  }

  for (const person of FIXTURE_PEOPLE) {
    const userId = await userIdByEmail(sql, E2E_USERS[person.role].email);
    // The user id is not stable across databases (seed-users upserts on email
    // and keeps whatever id already existed), so re-point the person row rather
    // than assuming it.
    await sql`
      INSERT INTO people (id, user_id, first_name, last_name)
      VALUES (${person.id}::uuid, ${userId}::uuid, ${person.firstName}, ${person.lastName})
      ON CONFLICT (id) DO UPDATE SET
        user_id    = EXCLUDED.user_id,
        first_name = EXCLUDED.first_name,
        last_name  = EXCLUDED.last_name
    `;
  }

  // FIRST relationships. current_roll stays null on every one: DECISION-039 —
  // `memberships` is the universal relationship anchor and roll status is a
  // column on it, not its meaning. These fixtures are relationships without a
  // roll, which is exactly what the presbytery-committee elder and the church
  // secretary who worships elsewhere look like, and the router must return them.
  const firstMemberships: Array<
    [personId: string, orgId: string, endedOn: string | null]
  > = [
    [FIXTURE_PEOPLE[0].id, E2E_ORGS.alpha.id, null],
    [FIXTURE_PEOPLE[1].id, E2E_ORGS.alpha.id, null],
    [FIXTURE_PEOPLE[2].id, E2E_ORGS.gamma.id, null],
    // Inserted already-ended rather than ended by UPDATE: the DECISION-039
    // guard fires on UPDATE OF ended_on, and a fixture has no business
    // exercising a trigger it is not testing.
    [FIXTURE_PEOPLE[3].id, E2E_ORGS.beta.id, E2E_ENDED_ON],
    // APPENDED — presbytery-portal e2e coverage (2026-09-28-presbytery-e2e).
    // Each of these three is a FIRST and only relationship, so the plain
    // INSERT ... WHERE NOT EXISTS shape applies — no
    // app.person_claim_authorized DO block needed (that mechanic is only
    // for org-multi's SECOND membership, below).
    [FIXTURE_PEOPLE[4].id, E2E_ORGS.presbytery.id, null], // presbytery-clerk
    [FIXTURE_PEOPLE[5].id, E2E_ORGS.presbytery.id, null], // presbytery-nogrant
    [FIXTURE_PEOPLE[6].id, E2E_ORGS.alpha.id, null], // congregation-clerk
  ];
  for (const [personId, orgId, endedOn] of firstMemberships) {
    // WHERE NOT EXISTS, not ON CONFLICT DO NOTHING. `on conflict` resolves
    // AFTER the BEFORE INSERT triggers have run, and `memberships_guard_insert`
    // raises on the second run for anyone who now holds a relationship
    // somewhere — so the obvious idempotent form is idempotent only until the
    // first successful run. Producing no row at all is what keeps the trigger
    // out of it.
    await sql`
      INSERT INTO memberships (organization_id, person_id, engagement_status, current_roll, ended_on)
      SELECT ${orgId}::uuid, ${personId}::uuid, 'regular', NULL, ${endedOn}::date
      WHERE NOT EXISTS (
        SELECT 1 FROM memberships
         WHERE person_id = ${personId}::uuid
           AND organization_id = ${orgId}::uuid
      )
    `;
  }

  // org-multi's SECOND relationship, at the presbytery. See mechanic 2 in the
  // file header: one statement, because the F21 authorization flag is
  // transaction-local and this driver has no multi-statement transaction.
  //
  // The DO body is a dollar-quoted string, so `$1` placeholders inside it are
  // literal text rather than bind parameters — the ids have to be inlined. They
  // are module constants that assertFixtureShape() has already vetted, never
  // anything read from outside this file.
  await sql.query(`
    do $seed$
    begin
      perform set_config('app.person_claim_authorized', '${FIXTURE_PEOPLE[1].id}', true);
      insert into memberships (organization_id, person_id, engagement_status, current_roll)
      select '${E2E_ORGS.presbytery.id}'::uuid, '${FIXTURE_PEOPLE[1].id}'::uuid, 'regular', null
       where not exists (
         select 1 from memberships
          where person_id = '${FIXTURE_PEOPLE[1].id}'::uuid
            and organization_id = '${E2E_ORGS.presbytery.id}'::uuid
       );
    end
    $seed$;
  `);

  // The ONE branded fixture (P0.5 slice c, commit c4) — e2e-alpha only. See
  // E2E_BRANDED_ORG's comment above for why this org and not a new one, and
  // why beta/gamma/presbytery are deliberately untouched. `updated_by` needs
  // a real `users.id`; the seeded platform admin already exists by this
  // point in globalSetup (seedE2EUsers runs first).
  const adminUserId = await userIdByEmail(sql, E2E_USERS.admin.email);
  await sql`
    INSERT INTO organization_brands
      (organization_id, seed_hex, type_pairing, brand_token_version, updated_by)
    VALUES (
      ${E2E_BRANDED_ORG.id}::uuid,
      ${E2E_BRAND_SEED_HEX},
      'classic',
      1,
      ${adminUserId}::uuid
    )
    ON CONFLICT (organization_id) DO UPDATE SET
      seed_hex            = EXCLUDED.seed_hex,
      type_pairing        = EXCLUDED.type_pairing,
      brand_token_version = EXCLUDED.brand_token_version,
      updated_by          = EXCLUDED.updated_by,
      updated_at          = now()
  `;

  // ---------------------------------------------------------------------
  // APPENDED BLOCK — statistics submission grants (increment 6, D16,
  // DECISION-147). docs/work-log/2026-09-25-submission-grants.md, Phase 4
  // batch C. Appended, not restructured, per that pipeline's own Rule 16
  // discipline for this shared file.
  //
  // Grants `statistics.manage` to org-multi (Tobias Fennimore,
  // FIXTURE_PEOPLE[1]) at the e2e-presbytery org he already holds a SECOND
  // membership at (see the `app.person_claim_authorized` DO block above) —
  // the presbytery-side "issue/revoke a submission grant" surface needs a
  // real, storageState-cached, browser-reachable presbytery admin, and
  // org-multi is the one fixture person who already has a relationship
  // there with no role bound. `gamma` (unmanaged, already a member
  // congregation of `presbytery`) is the about-org target — no new
  // organization fixture needed, since `statistics_submission_grants_
  // unmanaged` requires exactly that platform_status.
  //
  // A fresh, org-scoped `app_role` rather than reusing a template: this
  // suite's fixtures are `e2e-*`-scoped and idempotent, and inventing a
  // one-permission role here mirrors `scripts/seed-dev.sql`'s own
  // "adopted copy" pattern (`f0000000-...-000e`, `presbytery_stated_
  // clerk`) without needing that file's global-template machinery.
  const GRANT_ROLE_ID = "e2e00000-0000-0000-0000-0000000000b1";
  await sql`
    INSERT INTO app_roles (id, organization_id, key, name, role_kind, is_protected)
    VALUES (
      ${GRANT_ROLE_ID}::uuid,
      ${E2E_ORGS.presbytery.id}::uuid,
      'e2e_statistics_manage',
      'E2E Statistics Manager',
      'custom',
      false
    )
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO app_role_permissions (role_id, permission_key)
    VALUES (${GRANT_ROLE_ID}::uuid, 'statistics.manage')
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO role_grants (organization_id, role_id, person_id, starts_on, granted_by)
    SELECT ${E2E_ORGS.presbytery.id}::uuid, ${GRANT_ROLE_ID}::uuid,
           ${FIXTURE_PEOPLE[1].id}::uuid, DATE '2020-01-01', ${adminUserId}::uuid
     WHERE NOT EXISTS (
       SELECT 1 FROM role_grants
        WHERE person_id = ${FIXTURE_PEOPLE[1].id}::uuid
          AND organization_id = ${E2E_ORGS.presbytery.id}::uuid
          AND role_id = ${GRANT_ROLE_ID}::uuid
     )
  `;

  // ---------------------------------------------------------------------
  // APPENDED BLOCK — presbytery-portal e2e coverage (2026-09-28-presbytery-e2e,
  // DECISION-157). Two fresh, org-scoped app_roles, mirroring the existing
  // e2e_statistics_manage precedent immediately above — never a template
  // adoption (assertPermissionSubset() blocks adopting congregation_stated_
  // clerk for statistics.publish, docs/TODO.md:120).
  //
  // FIXTURE_PEOPLE[4]/[5]/[6] are presbytery-clerk/presbytery-nogrant/
  // congregation-clerk respectively (see the appended FIXTURE_PEOPLE block
  // above). presbytery-nogrant (FIXTURE_PEOPLE[5]) gets NO app_roles/
  // role_grants row at all — the membership alone is the fixture (the
  // "state 3" denial for oversight, reports, and credentials at once).
  // ---------------------------------------------------------------------
  const PRESBYTERY_CLERK_ROLE_ID = "e2e00000-0000-0000-0000-0000000000b2";
  await sql`
    INSERT INTO app_roles (id, organization_id, key, name, role_kind, is_protected)
    VALUES (${PRESBYTERY_CLERK_ROLE_ID}::uuid, ${E2E_ORGS.presbytery.id}::uuid,
            'e2e_presbytery_clerk', 'E2E Presbytery Clerk', 'custom', false)
    ON CONFLICT (id) DO NOTHING
  `;
  for (const key of [
    "congregation_oversight.manage",
    "per_capita.manage",
    "credentials.manage",
    "statistics.manage",
  ]) {
    await sql`
      INSERT INTO app_role_permissions (role_id, permission_key)
      VALUES (${PRESBYTERY_CLERK_ROLE_ID}::uuid, ${key})
      ON CONFLICT DO NOTHING
    `;
  }
  await sql`
    INSERT INTO role_grants (organization_id, role_id, person_id, starts_on, granted_by)
    SELECT ${E2E_ORGS.presbytery.id}::uuid, ${PRESBYTERY_CLERK_ROLE_ID}::uuid,
           ${FIXTURE_PEOPLE[4].id}::uuid, DATE '2020-01-01', ${adminUserId}::uuid
     WHERE NOT EXISTS (
       SELECT 1 FROM role_grants
        WHERE person_id = ${FIXTURE_PEOPLE[4].id}::uuid
          AND organization_id = ${E2E_ORGS.presbytery.id}::uuid
          AND role_id = ${PRESBYTERY_CLERK_ROLE_ID}::uuid
     )
  `;

  const STATISTICS_PUBLISH_ROLE_ID = "e2e00000-0000-0000-0000-0000000000b3";
  await sql`
    INSERT INTO app_roles (id, organization_id, key, name, role_kind, is_protected)
    VALUES (${STATISTICS_PUBLISH_ROLE_ID}::uuid, ${E2E_ORGS.alpha.id}::uuid,
            'e2e_statistics_publish', 'E2E Statistics Publisher', 'custom', false)
    ON CONFLICT (id) DO NOTHING
  `;
  await sql`
    INSERT INTO app_role_permissions (role_id, permission_key)
    VALUES (${STATISTICS_PUBLISH_ROLE_ID}::uuid, 'statistics.publish')
    ON CONFLICT DO NOTHING
  `;
  await sql`
    INSERT INTO role_grants (organization_id, role_id, person_id, starts_on, granted_by)
    SELECT ${E2E_ORGS.alpha.id}::uuid, ${STATISTICS_PUBLISH_ROLE_ID}::uuid,
           ${FIXTURE_PEOPLE[6].id}::uuid, DATE '2020-01-01', ${adminUserId}::uuid
     WHERE NOT EXISTS (
       SELECT 1 FROM role_grants
        WHERE person_id = ${FIXTURE_PEOPLE[6].id}::uuid
          AND organization_id = ${E2E_ORGS.alpha.id}::uuid
          AND role_id = ${STATISTICS_PUBLISH_ROLE_ID}::uuid
     )
  `;

  console.log(
    `[seed-orgs] provisioned ${Object.keys(E2E_ORGS).length} organizations ` +
      `(${Object.values(E2E_ORGS)
        .map((o) => o.slug)
        .join(", ")}), ${FIXTURE_PEOPLE.length} relationships, a brand ` +
      `on ${E2E_BRANDED_ORG.slug}, org-multi's statistics.manage grant ` +
      `at ${E2E_ORGS.presbytery.slug}, presbytery-clerk's e2e_presbytery_clerk ` +
      `grant, and congregation-clerk's e2e_statistics_publish grant`,
  );
}
