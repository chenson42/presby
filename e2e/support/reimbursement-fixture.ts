/**
 * reimbursement-fixture.ts - setup, seeding and teardown for the reimbursement e2e
 * specs (Treasury Increment 1, Batch 7; docs/work-log/2026-10-25-treasury-inc1.md,
 * Phase 3 "E2E and test blast radius", P3-24, the Phase 3 amendment "Copy gaps from
 * Batch 6" item 3). A NEW, additive file: it lifts what Batch 6 wrote inline in
 * `reimbursement-treasurer-ui.spec.ts` (the definer-driven request seeding and the
 * throwaway second payer) so the Batch 7 specs and that one share it. Nothing
 * existing under `e2e/support/` is edited (Workflow Rule 16: that directory is on the
 * shared-file list).
 *
 * WHY A THROWAWAY CONGREGATION. The six reimbursement tables refuse a DELETE while
 * their organization exists (history is append-only; EC34), so a request made
 * through the app can never be cleaned up on a permanent fixture. An organization
 * stamped `deletable_until` at insert is removed with ONE `delete from
 * organizations`, and the cascade takes every reimbursement row with it. Slugs are
 * `e2e-reimb<tag>-<stamp>`; ids use the design's confirmed prefixes: people, groups,
 * categories and roles `e2e96000-0000-4000-8000-`, organizations
 * `e2e96001-0000-4000-8000-` (unique per run: `audit_events` is append-only and keeps
 * a run's rows, so a reused organization id would make every audit count in a spec
 * include earlier runs).
 *
 * REQUESTS ARE SEEDED THROUGH THE DEFINERS (`save_draft`, `submit`, `approve`,
 * `waive_receipt`, `record_payment`) in one `DO` block per request, with the
 * organization set the way `withOrgContext` sets it: the same code the app runs, no
 * hand-written rows that could skip a trigger. (The one exception is `seedImportedPaid`,
 * which uses the migration-import door the design describes for EC36, to build more
 * rows than a definer loop could in a test's lifetime.)
 *
 * WHO HOLDS WHAT. Holding any money key makes a sign-in require 2FA, so the treasurer
 * is the `mfa-enrolled` user (the one fixture with a real, computable TOTP secret),
 * given a person and a membership at THIS congregation; the throwaway second payer
 * can be given its own password and the same enrolled secret (`signsIn`) so a spec
 * can sign in as them through the real form and the real challenge. Nothing here
 * imports application modules (the suite's standing rule: `src/lib/db` opens a
 * WebSocket pool at import time). Everything is synthetic: `.invalid` addresses,
 * invented names (No Real Data).
 */
import bcrypt from "bcryptjs";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { withDbRetry, type Sql } from "./db";
import { submitTotp } from "./invitation-ui";
import { E2E_TOTP_TEST_SECRET, seedTotpEnrollment } from "./totp-fixture";
import { E2E_USERS, storageStatePath, type E2ERole } from "./users";

export const REIMBURSEMENT_TOGGLE_KEY = "org_portal.reimbursement";

export const PERSON_PREFIX = "e2e96000-0000-4000-8000-";
export const ORG_PREFIX = "e2e96001-0000-4000-8000-";
/** People, groups, categories and roles: `pid(n)` is `e2e96000-0000-4000-8000-00000000000n`. */
export const pid = (n: number) => `${PERSON_PREFIX}${String(n).padStart(12, "0")}`;

/** The fixed ids a fixture of this file owns; the sweep and the teardown delete exactly these. */
export const FIXED_PEOPLE = [pid(2), pid(4), pid(40), pid(41), pid(42)] as const;

/** The password of the throwaway second payer when `signsIn` is set. Not a secret: a throwaway `.invalid` account. */
export const SECOND_PAYER_PASSWORD = "e2e-reimb-second-payer-not-a-secret";
export const SECOND_PAYER_EMAIL = "e2e-reimb-wren@presby.invalid";

/** E2E-owned names, one place (the specs assert on them). */
export const REIMB_NAMES = {
  org: "E2E Reimbursement Fixture Church",
  property: "Property Committee",
  worship: "Worship Committee",
  supplies: "Supplies",
  treasurer: "Octavia Vance",
  requester: "Tamsin Brightwater",
  secondPayer: "Wren Podmore",
  payerRole: "E2E Payer",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;
const uuidLit = (value: string) => {
  if (!UUID.test(value)) throw new Error(`[reimbursement-fixture] not a uuid: ${value}`);
  return `'${value}'::uuid`;
};

const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];

function assertFixtureSlug(slug: string) {
  if (!/^e2e-reimb[a-z]*-\d+$/.test(slug)) throw new Error(`[reimbursement-fixture] refusing to touch non-fixture slug "${slug}"`);
}

// ---------------------------------------------------------------------------
// small reads
// ---------------------------------------------------------------------------

export async function userIdByEmail(sql: Sql, email: string): Promise<string> {
  const found = await rows<{ id: string }>(sql`select id from users where email = ${email}`);
  if (!found[0]) throw new Error(`[reimbursement-fixture] no user row for ${email}; globalSetup must run first`);
  return found[0].id;
}

export async function rosterUserId(sql: Sql, role: E2ERole): Promise<string> {
  return userIdByEmail(sql, E2E_USERS[role].email);
}

/** The seeded person a fixture user already has (the chair is a presbytery user with one). */
export async function personIdForUser(sql: Sql, userId: string): Promise<string> {
  const found = await rows<{ id: string }>(sql`select id from people where user_id = ${userId}::uuid order by created_at limit 1`);
  if (!found[0]) throw new Error("[reimbursement-fixture] the seeded fixture user has no person row");
  return found[0].id;
}

/** `YYYY-MM-DD`, the organization's calendar day (the fixture orgs are `America/New_York`, the column default). */
export async function orgToday(sql: Sql): Promise<string> {
  return (await rows<{ d: string }>(sql`select to_char((now() at time zone 'America/New_York')::date, 'YYYY-MM-DD') as d`))[0]!.d;
}

export async function statusOf(sql: Sql, requestId: string): Promise<string> {
  return (await rows<{ status: string }>(sql`select status from reimbursement_requests where id = ${requestId}::uuid`))[0]!.status;
}

export async function requestIdByKey(sql: Sql, orgId: string, clientKey: string): Promise<string> {
  const found = await rows<{ id: string }>(
    sql`select id from reimbursement_requests where organization_id = ${orgId}::uuid and client_key = ${clientKey}`,
  );
  if (!found[0]) throw new Error(`[reimbursement-fixture] no request with client key ${clientKey}`);
  return found[0].id;
}

/** Audit rows of one action naming this organization, oldest first (ids and counts only, by design). */
export async function auditRows(sql: Sql, action: string, orgId: string): Promise<Array<{ metadata: Record<string, unknown>; actor_user_id: string | null }>> {
  return rows(
    sql`select metadata, actor_user_id from audit_events where action = ${action} and metadata->>'organizationId' = ${orgId} order by created_at, id`,
  );
}

// ---------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------

/** A membership for a person who may already belong elsewhere: the claim marker is armed in the same statement. */
export async function addMembership(sql: Sql, orgId: string, personId: string, engagement: "regular" | "visitor", roll: "active" | null) {
  await withDbRetry("add membership", () => sql`
    with armed as (select set_config('app.person_claim_authorized', ${personId}, true))
    insert into memberships (organization_id, person_id, engagement_status, current_roll)
    select ${orgId}::uuid, ${personId}::uuid, ${engagement}, ${roll} from armed
    on conflict (person_id, organization_id) do update
      set engagement_status = excluded.engagement_status, current_roll = excluded.current_roll`);
}

/** An organization and its derived Active Membership group (the baseline a roster needs). */
export async function createOrg(sql: Sql, input: { orgId: string; slug: string; name: string }) {
  assertFixtureSlug(input.slug);
  await sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${input.orgId}::uuid, 'congregation', ${input.name}, ${input.slug}, ${input.slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`;
  await sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${input.orgId}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`;
}

/** A managed roster group; `chairPersonId` makes that person its chair (the eligible approver). */
export async function createGroup(sql: Sql, orgId: string, input: { id: string; name: string; chairPersonId?: string }) {
  await sql`
    insert into groups (id, organization_id, group_type_id, name, membership_source)
    values (${input.id}::uuid, ${orgId}::uuid, (select id from group_types where key = 'roster'), ${input.name}, 'managed')`;
  if (input.chairPersonId) {
    await sql`
      insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on)
      values (${orgId}::uuid, ${input.id}::uuid, ${input.chairPersonId}::uuid, 'chair', 'managed', date '2020-01-01')`;
  }
}

/** Lists groups as able to receive requests, and adds a category. `by` is any user id (the audit-free owner insert records it). */
export async function makeChargeable(sql: Sql, orgId: string, groupIds: readonly string[], by: string) {
  for (const groupId of groupIds) {
    await sql`
      insert into reimbursement_chargeable_groups (organization_id, group_id, created_by_user)
      values (${orgId}::uuid, ${groupId}::uuid, ${by}::uuid)`;
  }
}

export async function createCategory(sql: Sql, orgId: string, input: { id: string; name: string }, by: string) {
  await sql`
    insert into reimbursement_categories (id, organization_id, name, created_by_user)
    values (${input.id}::uuid, ${orgId}::uuid, ${input.name}, ${by}::uuid)`;
}

/** A custom role with exactly these keys, granted to one person from 2020 (permissions are read live per request). */
export async function createRoleAndGrant(
  sql: Sql,
  orgId: string,
  input: { roleId: string; key: string; name: string; permissions: readonly string[]; personId?: string; grantedBy: string },
) {
  await sql`
    insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
    values (${input.roleId}::uuid, ${orgId}::uuid, ${input.key}, ${input.name}, 'custom', false)`;
  for (const permission of input.permissions) {
    await sql`insert into app_role_permissions (role_id, permission_key) values (${input.roleId}::uuid, ${permission})`;
  }
  if (input.personId) {
    await sql`
      insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
      values (${orgId}::uuid, ${input.roleId}::uuid, ${input.personId}::uuid, date '2020-01-01', ${input.grantedBy}::uuid)`;
  }
}

/** Turns the org's Reimbursements toggle on or off (`null` removes the row: the default, off). */
export async function setToggle(sql: Sql, orgId: string, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await withDbRetry("clear reimbursement toggle", () => sql`
      delete from organization_feature_toggles where organization_id = ${orgId}::uuid and feature_key = ${REIMBURSEMENT_TOGGLE_KEY}`);
    return;
  }
  await withDbRetry("set reimbursement toggle", () => sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${orgId}::uuid, ${REIMBURSEMENT_TOGGLE_KEY}, ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`);
}

/**
 * The throwaway second payer (the person the Treasury team page gives the payer role to).
 * With `signsIn` the account has a password and the SAME enrolled TOTP secret the
 * `mfa-enrolled` fixture has, so a spec can sign in as them through the real form and the
 * real /totp challenge (their money key makes 2FA required, arm B). Without it the account
 * has neither and is never signed in as.
 */
export async function createSecondPayer(sql: Sql, input: { signsIn?: boolean; email?: string } = {}): Promise<{ id: string; email: string; password: string | null }> {
  const email = input.email ?? SECOND_PAYER_EMAIL;
  if (!email.endsWith(".invalid")) throw new Error(`[reimbursement-fixture] refusing a non-.invalid address "${email}"`);
  await withDbRetry("delete stale second payer", () => sql`delete from users where email = ${email}`);
  if (input.signsIn) {
    const hash = await bcrypt.hash(SECOND_PAYER_PASSWORD, 10);
    const [row] = await rows<{ id: string }>(sql`
      insert into users (email, name, password, email_verified, is_active, two_factor_required)
      values (${email}, ${REIMB_NAMES.secondPayer}, ${hash}, now(), true, false) returning id`);
    await seedTotpEnrollment(sql, row!.id);
    return { id: row!.id, email, password: SECOND_PAYER_PASSWORD };
  }
  const [row] = await rows<{ id: string }>(sql`insert into users (email, name) values (${email}, ${REIMB_NAMES.secondPayer}) returning id`);
  return { id: row!.id, email, password: null };
}

// ---------------------------------------------------------------------------
// the whole fixture
// ---------------------------------------------------------------------------

export interface ReimbursementFixture {
  orgId: string;
  slug: string;
  name: string;
  groupProperty: string;
  groupWorship: string;
  categorySupplies: string;
  /** The `mfa-enrolled` user and the person made for them here. */
  treasurerUser: string;
  treasurerPerson: string;
  /** The `member` user: the requester. */
  requesterUser: string;
  requesterPerson: string;
  /** The `presbytery-nogrant` user: chair of the Property Committee (the eligible approver). */
  chairUser: string;
  chairPerson: string;
  /** The throwaway second payer. */
  secondUser: string;
  secondPerson: string;
  secondPayerSignsIn: boolean;
  /** The custom role that carries the four keys, and the pay-only role the Treasury team page can give. */
  treasurerRole: string;
  payerRole: string;
}

export interface SetupOptions {
  /** Lower-case letters: the slug is `e2e-reimb<tag>-<stamp>`. */
  tag: string;
  /** The treasurer holds the four reimbursement keys through a custom role (default true). */
  treasurerHoldsKeys?: boolean;
  /** The second payer gets a password and the enrolled TOTP secret (default false). */
  secondPayerSignsIn?: boolean;
  /** Reimbursements on for the organization (default true). */
  toggle?: boolean;
  stamp?: number;
}

/**
 * Builds the congregation: Property Committee (chaired by the chair) and Worship Committee
 * (no chair: its requests take the treasurer's path), both chargeable; a Supplies category;
 * the requester, the treasurer, the second payer and the chair as active members; the
 * treasurer's four-key role; a pay-only role for the Treasury team page to give. Sweeps stale
 * fixtures of this family first.
 */
export async function setupReimbursementFixture(sql: Sql, options: SetupOptions): Promise<ReimbursementFixture> {
  if (!/^[a-z]{0,6}$/.test(options.tag)) throw new Error("[reimbursement-fixture] the tag is up to six lower-case letters");
  await sweepStaleReimbursementFixtures(sql);
  const stamp = options.stamp ?? Date.now();
  const slug = `e2e-reimb${options.tag}-${stamp}`;
  const orgId = `${ORG_PREFIX}${String(stamp % 1_000_000_000_000).padStart(12, "0")}`;

  const treasurerUser = await userIdByEmail(sql, E2E_USERS["mfa-enrolled"].email);
  const requesterUser = await userIdByEmail(sql, E2E_USERS.member.email);
  const chairUser = await userIdByEmail(sql, E2E_USERS["presbytery-nogrant"].email);
  const chairPerson = await personIdForUser(sql, chairUser);
  const second = await createSecondPayer(sql, { signsIn: options.secondPayerSignsIn === true });
  const requesterPerson = pid(2);
  const treasurerPerson = pid(40);
  const secondPerson = pid(41);
  const groupProperty = pid(10);
  const groupWorship = pid(11);
  const categorySupplies = pid(20);
  const treasurerRole = pid(30);
  const payerRole = pid(31);

  await createOrg(sql, { orgId, slug, name: REIMB_NAMES.org });
  await createGroup(sql, orgId, { id: groupProperty, name: REIMB_NAMES.property });
  await createGroup(sql, orgId, { id: groupWorship, name: REIMB_NAMES.worship });
  await sql`
    insert into people (id, user_id, first_name, last_name, deletable_until)
    values (${requesterPerson}::uuid, ${requesterUser}::uuid, 'Tamsin', 'Brightwater', now() + interval '3 hours'),
           (${treasurerPerson}::uuid, ${treasurerUser}::uuid, 'Octavia', 'Vance', now() + interval '3 hours'),
           (${secondPerson}::uuid, ${second.id}::uuid, 'Wren', 'Podmore', now() + interval '3 hours')`;
  for (const person of [requesterPerson, treasurerPerson, secondPerson, chairPerson]) {
    await addMembership(sql, orgId, person, "regular", "active");
  }
  // The chair, on the Property Committee only: Worship has no approver, so its requests need the treasurer.
  await sql`
    insert into group_memberships (organization_id, group_id, person_id, group_role, source, starts_on)
    values (${orgId}::uuid, ${groupProperty}::uuid, ${chairPerson}::uuid, 'chair', 'managed', date '2020-01-01')`;
  await makeChargeable(sql, orgId, [groupProperty, groupWorship], chairUser);
  await createCategory(sql, orgId, { id: categorySupplies, name: REIMB_NAMES.supplies }, chairUser);

  const keys = ["reimbursement.request_for_others", "reimbursement.view", "reimbursement.pay", "reimbursement.manage"];
  await createRoleAndGrant(sql, orgId, {
    roleId: treasurerRole,
    key: "e2e_reimb_treasurer",
    name: "E2E Treasurer",
    permissions: keys,
    personId: options.treasurerHoldsKeys === false ? undefined : treasurerPerson,
    grantedBy: treasurerUser,
  });
  await createRoleAndGrant(sql, orgId, {
    roleId: payerRole,
    key: "e2e_reimb_payer",
    name: REIMB_NAMES.payerRole,
    permissions: ["reimbursement.pay"],
    grantedBy: treasurerUser,
  });
  if (options.toggle !== false) await setToggle(sql, orgId, true);

  return {
    orgId, slug, name: REIMB_NAMES.org, groupProperty, groupWorship, categorySupplies, treasurerUser, treasurerPerson,
    requesterUser, requesterPerson, chairUser, chairPerson, secondUser: second.id, secondPerson,
    secondPayerSignsIn: options.secondPayerSignsIn === true, treasurerRole, payerRole,
  };
}

// ---------------------------------------------------------------------------
// seeding requests through the definers
// ---------------------------------------------------------------------------

export interface SeedSpec {
  /** The idempotency key (`client_key`): 8 to 64 of `A-Za-z0-9_-`. Also how the spec finds the id. */
  key: string;
  group: string;
  cents: number;
  purpose: string;
  kind?: "reimburse" | "vendor";
  vendor?: string;
  daysAgo?: number;
  /** `undefined` is the fixture's Supplies category, `null` is none. */
  category?: string | null;
  /** submitted | approved (by the chair) | waived (approved, receipt waived) | paid (waived, then paid by the treasurer). */
  upTo: "submitted" | "approved" | "waived" | "paid";
  /** A payment reference for `paid`. */
  reference?: string;
}

/** The actors a seed needs; a fixture satisfies this, and so can a hand-built cast. */
export interface SeedActors {
  orgId: string;
  categorySupplies?: string;
  requesterUser: string;
  chairUser?: string;
  treasurerUser?: string;
}

/** One request in the state the spec needs, made by the definers themselves. Returns its id. */
export async function seedRequest(sql: Sql, actors: SeedActors, spec: SeedSpec): Promise<string> {
  const kind = spec.kind ?? "reimburse";
  const requester = uuidLit(actors.requesterUser);
  const days = spec.daysAgo ?? 3;
  const category =
    spec.category === null ? "null" : uuidLit(spec.category ?? actors.categorySupplies ?? (() => { throw new Error("no category"); })());
  const need = (value: string | undefined, what: string) => {
    if (!value) throw new Error(`[reimbursement-fixture] seeding ${spec.key} up to ${spec.upTo} needs a ${what}`);
    return uuidLit(value);
  };
  const steps = [
    `select s.request_id, s.revision into v_rid, v_rev from presby_reimbursement_save_draft(
       ${lit(spec.key)}, ${lit(kind)}, ${uuidLit(spec.group)}, null, ${spec.vendor ? lit(spec.vendor) : "null"}, ${spec.cents},
       ((now() at time zone 'America/New_York')::date - ${days}), ${lit(spec.purpose)},
       ${category}, null, true, ${requester}) s;`,
    `select s.revision into v_rev from presby_reimbursement_submit(v_rid, v_rev, ${requester}) s;`,
  ];
  if (spec.upTo !== "submitted") {
    steps.push(`perform * from presby_reimbursement_approve(v_rid, v_rev, 'seat', ${need(actors.chairUser, "chair user")});`);
  }
  if (spec.upTo === "waived" || spec.upTo === "paid") {
    steps.push(`perform * from presby_reimbursement_waive_receipt(v_rid, null, ${need(actors.treasurerUser, "treasurer user")});`);
  }
  if (spec.upTo === "paid") {
    steps.push(
      `perform * from presby_reimbursement_record_payment(v_rid, 'check', ${lit(spec.reference ?? "1001")},
         (now() at time zone 'America/New_York')::date, null, ${need(actors.treasurerUser, "treasurer user")});`,
    );
  }
  // Safe to retry: the request is keyed, so a repeat after a lost reply finds the same draft (the definer is idempotent on the key).
  await withDbRetry(`seed request ${spec.key}`, () =>
    sql.query(`
      do $do$
      declare v_rid uuid; v_rev integer;
      begin
        perform set_config('app.current_org_id', ${lit(actors.orgId)}, true);
        ${steps.join("\n        ")}
      end $do$`),
  );
  return requestIdByKey(sql, actors.orgId, spec.key);
}

/**
 * Moves an existing request through the payment definer as `payerUser`, behind a spec's back: how a
 * spec makes a page it already has open STALE (the request is paid while the page still offers Void),
 * so the refusal sentence it asserts is reached by a real POST from a real stale page.
 */
export async function recordPaymentViaDefiner(sql: Sql, input: { orgId: string; requestId: string; payerUser: string; reference?: string }): Promise<void> {
  await withDbRetry(`pay request ${input.requestId}`, () =>
    sql.query(`
      do $do$
      begin
        perform set_config('app.current_org_id', ${lit(input.orgId)}, true);
        perform * from presby_reimbursement_record_payment(${uuidLit(input.requestId)}, 'check', ${lit(input.reference ?? "9001")},
          (now() at time zone 'America/New_York')::date, null, ${uuidLit(input.payerUser)});
      end $do$`),
  );
}

/**
 * Bulk `import`-origin PAID requests, each with its payment and its `imported` event, in ONE
 * statement (the deferred status/payment/event consistency checks fire at the statement's commit and
 * see all three). The migration-import door of EC36, used only to cross the CSV row cap (20,000) in
 * a test, which no definer loop could do in a test's lifetime. Returns the number inserted.
 */
export async function seedImportedPaid(sql: Sql, input: { orgId: string; groupId: string; beneficiaryPersonId: string; count: number }): Promise<number> {
  const found = await withDbRetry("seed imported paid requests", async () =>
    rows<{ n: number }>(sql`
      with r as (
        insert into reimbursement_requests (organization_id, origin, kind, status, group_id, beneficiary_person_id,
               amount_cents, expense_date, purpose, approved_at, approved_revision, created_at)
        select ${input.orgId}::uuid, 'import', 'reimburse', 'paid', ${input.groupId}::uuid, ${input.beneficiaryPersonId}::uuid,
               100 + (g % 900), date '2019-03-04' + (g % 300), 'Imported historical request ' || g,
               timestamptz '2019-03-10', 1, timestamptz '2019-03-05' + (g || ' seconds')::interval
          from generate_series(1, ${input.count}::int) g
        returning id, amount_cents
      ), p as (
        insert into reimbursement_payments (organization_id, request_id, kind, method, paid_on, amount_cents)
        select ${input.orgId}::uuid, id, 'payment', 'cash', date '2019-03-20', amount_cents from r
        returning 1
      ), e as (
        insert into reimbursement_events (organization_id, request_id, kind, to_status, request_revision)
        select ${input.orgId}::uuid, id, 'imported', 'paid', 1 from r
        returning 1
      )
      select (select count(*) from p)::int as n`),
  );
  return found[0]!.n;
}

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------

/** Deletes one organization (the cascade takes every reimbursement row) with the derived-roster trigger off around it. */
export async function removeOrg(sql: Sql, orgId: string): Promise<void> {
  // The whole disable/delete/enable unit is ONE retried step (a drop between the statements can never leave
  // the trigger off: the next attempt re-disables, deletes and re-enables), and a final failure still tries
  // to re-enable, as every other fixture teardown in this repo does.
  try {
    await withDbRetry(`delete reimbursement org ${orgId}`, async () => {
      await sql`alter table group_memberships disable trigger group_memberships_reject_derived`;
      try {
        await sql`delete from organizations where id = ${orgId}::uuid`;
      } finally {
        await sql`alter table group_memberships enable trigger group_memberships_reject_derived`;
      }
    });
  } finally {
    await withDbRetry("re-enable roster trigger", () => sql`alter table group_memberships enable trigger group_memberships_reject_derived`);
  }
}

async function removeFixedPeopleAndSecondPayer(sql: Sql): Promise<void> {
  await withDbRetry("delete reimbursement fixture people", () => sql`delete from people where id = any(${[...FIXED_PEOPLE]}::uuid[])`);
  await withDbRetry("delete reimbursement second payer", () => sql`delete from users where email = ${SECOND_PAYER_EMAIL}`);
}

/**
 * Removes every `e2e-reimb<tag>-<digits>` congregation a crashed run left, then the fixed-id
 * people and the second payer. Safe at any time: it touches only that slug family and the ids above.
 */
export async function sweepStaleReimbursementFixtures(sql: Sql): Promise<number> {
  const stale = await withDbRetry(
    "list stale reimbursement orgs",
    async () => (await sql`select id from organizations where slug ~ '^e2e-reimb[a-z]*-[0-9]+$'`) as { id: string }[],
  );
  for (const { id } of stale) await removeOrg(sql, id);
  await removeFixedPeopleAndSecondPayer(sql);
  return stale.length;
}

/** Removes everything the fixture made, and confirms by SELECT that the organization is gone. */
export async function removeReimbursementFixture(sql: Sql, fx: ReimbursementFixture): Promise<void> {
  assertFixtureSlug(fx.slug);
  await removeOrg(sql, fx.orgId);
  await removeFixedPeopleAndSecondPayer(sql);
  const left = await withDbRetry("confirm reimbursement org gone", async () => (await sql`select 1 from organizations where id = ${fx.orgId}::uuid`) as unknown[]);
  if (left.length > 0) throw new Error(`[reimbursement-fixture] the fixture organization ${fx.slug} was not removed`);
}

// ---------------------------------------------------------------------------
// browser helpers
// ---------------------------------------------------------------------------

/**
 * One TOTP-verified session for the `mfa-enrolled` user in a fresh browser context (cookies live in the
 * context). Unlike giving's `verifiedContext` it survives a replayed time step: the shared secret's code
 * for the current 30 s window may already have been spent by an earlier spec, in which case `submitTotp`
 * waits for the next window and tries once more.
 */
export async function verifiedTreasurerContext(browser: Browser, callbackPath = "/home"): Promise<BrowserContext> {
  const context = await browser.newContext({ storageState: storageStatePath("mfa-enrolled") });
  const page = await context.newPage();
  await page.goto(`/totp?callbackUrl=${encodeURIComponent(callbackPath)}`);
  await submitTotp(page, E2E_TOTP_TEST_SECRET);
  await page.close();
  return context;
}

/** The page is a real page: not wider than the viewport. */
export async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

/**
 * React has attached to the page: a button carries its React props. A page with a form also has a
 * HydrationGate, which reports the same moment with `aria-busy`; one without (a dialog trigger only)
 * has nothing else to wait on, and a click before this would do nothing.
 */
export async function waitHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some((b) => Object.keys(b).some((k) => k.startsWith("__reactProps$"))),
  );
  const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
  if ((await gate.count()) > 0) await expect(gate).not.toHaveAttribute("aria-busy", "true");
}

/** A control is at least 44 px tall and wholly inside the viewport's width (a phone thumb target). */
export async function tallEnough(page: Page, testId: string, width: number): Promise<void> {
  const button = page.getByTestId(testId);
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  expect(box.height, testId).toBeGreaterThanOrEqual(44);
  expect(box.x, testId).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, testId).toBeLessThanOrEqual(width);
}
