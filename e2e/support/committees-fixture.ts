/**
 * committees-fixture.ts - setup, seeding and teardown for the presbytery-committees e2e specs
 * (Presbytery committees Increment 1, Batch B4; docs/work-log/2026-11-19-presbytery-committees-inc1.md,
 * parent Phase 3 "Test plan" -> "E2E"). A NEW, additive file: nothing existing under `e2e/support/` is
 * edited (Workflow Rule 16 lists that directory as shared). It borrows `addMembership` and `removeOrg`
 * from `reimbursement-fixture.ts` and the page helpers from `worship-fixture.ts` by import, and owns
 * everything else (modelled on `oversight-fixture.ts`).
 *
 * WHY THROWAWAY COUNCILS. A committee and its seats are permanent record (the stores never delete), and the
 * audit rows of a run are append-only. This fixture therefore mints its own presbyteries and congregations
 * (stamped `deletable_until`) and tears them down as the OWNER: the congregations first, then the
 * presbyteries (the organization delete cascades the groups, the committee details and the seats; B1's D2
 * test pins that cascade).
 *
 * SHAPE.
 *   presbytery A    the one under test. Managed. Starts with NO committee (the guided empty state is real).
 *                   Holds a `choir` group and its derived Active Membership group (the wrong-kind 404 cases).
 *   congA (managed) and congB (unmanaged): member congregations of A. congA also holds a `committee` group
 *                   (a congregation's committee, untouched by this feature: a 404 under A's committee path).
 *   presbytery B    a second presbytery with one committee, for the cross-presbytery 404.
 *
 * IDS (this pipeline's range, grepped free in e2e/, scripts/ and src/): people `00000000-0000-4090-8000-`,
 * roles `00000000-0000-4090-9000-`, organizations `00000000-0000-4090-9001-` (unique per run, because
 * `audit_events` is append-only and keeps a run's rows: a reused organization id would make every audit
 * count in a spec include earlier runs). Users take a random uuid, found again by their `.invalid` address.
 *
 * WHO IS WHO (all synthetic, `.invalid` addresses, invented names; No Real Data):
 *   founder   Corwin Peabody    presbytery founding administrator, minted through the REAL definer
 *             (`presby_apply_founding_administrator`, the F362 lesson), MFA enrolled: the person the
 *             invitation path creates, which is how a real user holds `groups.manage`
 *   clerk     Ione Marchetti    a custom role holding ONLY `groups.manage` (not two-factor-flagged), no MFA
 *   plain     Saffron Whitlock  a presbytery member with NO role
 *   congClerk Tobias Quennell   a member of congregation congA holding `groups.manage` there
 *   plus eight people WITHOUT accounts with presbytery memberships, for the rosters (one with a very
 *   long name, one whose membership has ended, one recorded as deceased).
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { withDbRetry, type Sql } from "./db";
import { signInOnPage, submitTotp } from "./invitation-ui";
import { addMembership, removeOrg } from "./reimbursement-fixture";
import { E2E_TOTP_TEST_SECRET, seedTotpEnrollment } from "./totp-fixture";

export { newPhonePage, noSidewaysScroll, waitHydrated } from "./worship-fixture";

export const COMMITTEES_FLAG = "org_portal.committees";
export const GROUPS_FLAG = "org_portal.groups";

export const PERSON_PREFIX = "00000000-0000-4090-8000-";
export const ROLE_PREFIX = "00000000-0000-4090-9000-";
export const ORG_PREFIX = "00000000-0000-4090-9001-";
/** `pid(n)` is `00000000-0000-4090-8000-00000000000n`; `rid(n)` likewise. */
export const pid = (n: number) => `${PERSON_PREFIX}${String(n).padStart(12, "0")}`;
export const rid = (n: number) => `${ROLE_PREFIX}${String(n).padStart(12, "0")}`;

/** Not a secret: throwaway `.invalid` accounts, removed with the fixture. */
export const COMMITTEES_PASSWORD = "e2e-committees-fixture-not-a-secret"; // leak-ok: throwaway password for a `.invalid` fixture account

export const GROUPS_MANAGE = "groups.manage";

export type Who = "founder" | "clerk" | "plain" | "congClerk";

const ACCOUNTS: Record<Who, { n: number; first: string; last: string; mfa: boolean }> = {
  founder: { n: 1, first: "Corwin", last: "Peabody", mfa: true },
  clerk: { n: 2, first: "Ione", last: "Marchetti", mfa: false },
  plain: { n: 3, first: "Saffron", last: "Whitlock", mfa: false },
  congClerk: { n: 4, first: "Tobias", last: "Quennell", mfa: false },
};

export const COMMITTEES_EMAILS = Object.fromEntries(
  Object.keys(ACCOUNTS).map((who) => [who, `e2e-cmt-${who.toLowerCase()}@presby.invalid`]),
) as Record<Who, string>;

/** A 108-character last name with no space: the 120-character person-name case (11 + 1 + 108). */
export const LONG_LAST = "Ab".repeat(54);
export const LONG_FIRST = "Bartholomew";
export const LONG_PERSON = `${LONG_FIRST} ${LONG_LAST}`;

/** People without accounts who can be seated. `n` is the person-id suffix. */
const SEATABLE = {
  avery: { n: 11, first: "Avery", last: "Lindqvist" },
  blair: { n: 12, first: "Blair", last: "Okonkwo" },
  casey: { n: 13, first: "Casey", last: "Delacroix" },
  devon: { n: 14, first: "Devon", last: "Halvorsen" },
  emery: { n: 15, first: "Emery", last: "Tzeng" },
  long: { n: 16, first: LONG_FIRST, last: LONG_LAST },
  /** Their presbytery membership has ended. */
  gone: { n: 17, first: "Ines", last: "Fairweather" },
  /** Recorded as deceased. */
  late: { n: 18, first: "Rowan", last: "Ashdown" },
} as const;
export type Seatable = keyof typeof SEATABLE;
export const SEATABLE_NAMES = Object.fromEntries(
  Object.entries(SEATABLE).map(([k, v]) => [k, `${v.first} ${v.last}`]),
) as Record<Seatable, string>;

export const COMMITTEES_NAMES = {
  presbytery: "E2E Committees Presbytery",
  congA: "E2E Committees Congregation Alder",
  congB: "E2E Committees Congregation Birch",
  presbyteryOther: "E2E Committees Other Presbytery",
  founder: "Corwin Peabody",
  clerk: "Ione Marchetti",
  plain: "Saffron Whitlock",
  congClerk: "Tobias Quennell",
  choir: "E2E Cmt Choir",
  congCommittee: "E2E Cmt Congregation Property Committee",
  otherCommittee: "E2E Cmt Other Presbytery Committee",
  carrying: "E2E Cmt Carrying Committee",
  carriedRole: "E2E Committee Access",
} as const;

const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];

export interface FixtureOrg {
  id: string;
  slug: string;
  name: string;
}

export interface CommitteesFixture {
  presbytery: FixtureOrg;
  /** Managed, a member congregation of the presbytery. */
  congA: FixtureOrg;
  /** Unmanaged, a member congregation of the presbytery. */
  congB: FixtureOrg;
  /** A second presbytery: nothing in it belongs to presbytery A. */
  presbyteryOther: FixtureOrg;
  people: Record<Who, string>;
  users: Record<Who, string>;
  seatable: Record<Seatable, string>;
  /** Groups for the wrong-kind cases. `otherCommittee` is a real committee at presbytery B. */
  groups: { choir: string; derived: string; congCommittee: string; otherCommittee: string };
  roles: { clerk: string; congClerk: string; carried: string };
}

function assertFixtureSlug(slug: string) {
  if (!/^e2e-cmt[a-z]*-\d+(-[a-z]+)?$/.test(slug)) throw new Error(`[committees-fixture] refusing to touch non-fixture slug "${slug}"`);
}

const orgIds = (fx: CommitteesFixture) => [fx.presbytery.id, fx.congA.id, fx.congB.id, fx.presbyteryOther.id];

// ---------------------------------------------------------------------------
// teardown and the sweep
// ---------------------------------------------------------------------------

async function removeFixturePeopleAndUsers(sql: Sql): Promise<void> {
  await withDbRetry("delete committees fixture people", () => sql`delete from people where id::text like '00000000-0000-4090-8000-%'`);
  await withDbRetry("delete committees fixture users", () => sql`delete from users where email like 'e2e-cmt-%@presby.invalid'`);
}

async function removeSites(sql: Sql, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withDbRetry("delete committees fixture sites", () => sql.query(`delete from organization_sites where organization_id = any($1::uuid[])`, [ids]));
}

/** Removes every `e2e-cmt<tag>-<digits>` council a crashed run left, then the fixture people and users. */
export async function sweepStaleCommitteesFixtures(sql: Sql): Promise<number> {
  const stale = await withDbRetry(
    "list stale committees orgs",
    async () =>
      (await sql`select id, organization_type::text as type from organizations where slug ~ '^e2e-cmt[a-z]*-[0-9]+(-[a-z]+)?$'`) as {
        id: string;
        type: string;
      }[],
  );
  await removeSites(sql, stale.map((s) => s.id));
  for (const council of stale.filter((s) => s.type === "congregation")) await removeOrg(sql, council.id);
  for (const council of stale.filter((s) => s.type !== "congregation")) await removeOrg(sql, council.id);
  await removeFixturePeopleAndUsers(sql);
  return stale.length;
}

export async function removeCommitteesFixture(sql: Sql, fx: CommitteesFixture): Promise<void> {
  for (const org of [fx.presbytery, fx.congA, fx.congB, fx.presbyteryOther]) assertFixtureSlug(org.slug);
  await removeSites(sql, orgIds(fx));
  for (const congregation of [fx.congA, fx.congB]) await removeOrg(sql, congregation.id);
  for (const presbytery of [fx.presbytery, fx.presbyteryOther]) await removeOrg(sql, presbytery.id);
  await removeFixturePeopleAndUsers(sql);
  const left = await withDbRetry(
    "confirm committees orgs gone",
    async () => (await sql.query(`select 1 from organizations where id = any($1::uuid[])`, [orgIds(fx)])) as unknown[],
  );
  if (left.length > 0) throw new Error(`[committees-fixture] fixture organizations of ${fx.presbytery.slug} were not removed`);
}

// ---------------------------------------------------------------------------
// the whole fixture
// ---------------------------------------------------------------------------

export interface SetupOptions {
  /** Lower-case letters: the slug is `e2e-cmt<tag>-<stamp>`. */
  tag: string;
  stamp?: number;
  /** Who gets a person and an account. Default: everyone. */
  who?: Who[];
}

async function insertOrg(sql: Sql, o: { id: string; type: "presbytery" | "congregation"; name: string; slug: string; status: "managed" | "unmanaged" }) {
  assertFixtureSlug(o.slug);
  await sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${o.id}::uuid, ${o.type}, ${o.name}, ${o.slug}, ${o.slug.replace(/-/g, "_")}, ${o.status}, now() + interval '3 hours')`;
}

async function affiliate(sql: Sql, parent: string, child: string) {
  await sql`
    insert into organization_affiliations
      (organization_id, subject_org_id, parent_org_id, relationship_type, effective_from, authority, minute_reference)
    values (${parent}::uuid, ${child}::uuid, ${parent}::uuid, 'member_congregation', date '2020-01-01', 'recorded',
            'e2e fixture affiliation (e2e/support/committees-fixture.ts)')`;
}

async function insertGroup(sql: Sql, orgId: string, typeKey: string, name: string): Promise<string> {
  const [row] = await rows<{ id: string }>(sql`
    insert into groups (organization_id, group_type_id, name)
    values (${orgId}::uuid, (select id from group_types where key = ${typeKey}), ${name}) returning id`);
  return row!.id;
}

export async function setupCommitteesFixture(sql: Sql, options: SetupOptions): Promise<CommitteesFixture> {
  if (!/^[a-z]{0,6}$/.test(options.tag)) throw new Error("[committees-fixture] the tag is up to six lower-case letters");
  await sweepStaleCommitteesFixtures(sql);
  const stamp = options.stamp ?? Date.now();
  const base = `e2e-cmt${options.tag}-${stamp}`;
  const oid = (k: number) => `${ORG_PREFIX}${String((stamp % 100_000_000_000) * 10 + k).padStart(12, "0")}`;
  const org = (k: number, suffix: string, name: string): FixtureOrg => ({ id: oid(k), slug: suffix ? `${base}-${suffix}` : base, name });
  const orgs = {
    presbytery: org(1, "", COMMITTEES_NAMES.presbytery),
    congA: org(2, "ca", COMMITTEES_NAMES.congA),
    congB: org(3, "cb", COMMITTEES_NAMES.congB),
    presbyteryOther: org(4, "po", COMMITTEES_NAMES.presbyteryOther),
  };

  await insertOrg(sql, { ...orgs.presbytery, type: "presbytery", status: "managed" });
  await insertOrg(sql, { ...orgs.presbyteryOther, type: "presbytery", status: "managed" });
  await insertOrg(sql, { ...orgs.congA, type: "congregation", status: "managed" });
  await insertOrg(sql, { ...orgs.congB, type: "congregation", status: "unmanaged" });
  await affiliate(sql, orgs.presbytery.id, orgs.congA.id);
  await affiliate(sql, orgs.presbytery.id, orgs.congB.id);
  // The derived Active Membership group of each council: every `memberships` insert syncs it (0017).
  for (const council of [orgs.presbytery, orgs.presbyteryOther, orgs.congA]) {
    await sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      select ${council.id}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`;
  }
  const [derived] = await rows<{ id: string }>(
    sql`select id from groups where organization_id = ${orgs.presbytery.id}::uuid and derived_from = 'active_membership'`,
  );

  const hash = await bcrypt.hash(COMMITTEES_PASSWORD, 10);
  const people = {} as Record<Who, string>;
  const users = {} as Record<Who, string>;
  for (const who of options.who ?? (Object.keys(ACCOUNTS) as Who[])) {
    const p = ACCOUNTS[who];
    const [user] = await rows<{ id: string }>(sql`
      insert into users (email, name, password, email_verified, is_active, two_factor_required)
      values (${COMMITTEES_EMAILS[who]}, ${`${p.first} ${p.last}`}, ${hash}, now(), true, ${p.mfa})
      returning id`);
    users[who] = user!.id;
    people[who] = pid(p.n);
    await sql`
      insert into people (id, user_id, first_name, last_name, deletable_until)
      values (${pid(p.n)}::uuid, ${user!.id}::uuid, ${p.first}, ${p.last}, now() + interval '3 hours')`;
    // The congregation clerk belongs to congregation A, everyone else to the presbytery.
    await addMembership(sql, who === "congClerk" ? orgs.congA.id : orgs.presbytery.id, pid(p.n), "regular", null);
    if (p.mfa) await seedTotpEnrollment(sql, user!.id);
  }

  const seatable = {} as Record<Seatable, string>;
  for (const [key, p] of Object.entries(SEATABLE) as Array<[Seatable, (typeof SEATABLE)[Seatable]]>) {
    seatable[key] = pid(p.n);
    await sql`
      insert into people (id, first_name, last_name, deletable_until)
      values (${pid(p.n)}::uuid, ${p.first}, ${p.last}, now() + interval '3 hours')`;
    await addMembership(sql, orgs.presbytery.id, pid(p.n), "regular", null);
  }

  // The custom roles. The founder holds hers through the definer (below), `plain` has none.
  const roles = { clerk: rid(1), congClerk: rid(2), carried: rid(3) };
  const custom: Array<[string, string, string, string, string[], Who | null]> = [
    [roles.clerk, orgs.presbytery.id, "e2e_cmt_clerk", "E2E Committees Clerk", [GROUPS_MANAGE], "clerk"],
    [roles.congClerk, orgs.congA.id, "e2e_cmt_congclerk", "E2E Congregation Groups Clerk", [GROUPS_MANAGE], "congClerk"],
    // Held by nobody: bound to a committee group by `bindRoleToCommittee` (the carries-role note).
    [roles.carried, orgs.presbytery.id, "e2e_cmt_carried", COMMITTEES_NAMES.carriedRole, ["directory.view"], null],
  ];
  for (const [roleId, orgId, key, name, permissions, who] of custom) {
    if (who && !people[who]) continue;
    await sql`
      insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
      values (${roleId}::uuid, ${orgId}::uuid, ${key}, ${name}, 'custom', false)`;
    for (const permission of permissions) {
      await sql`insert into app_role_permissions (role_id, permission_key) values (${roleId}::uuid, ${permission})`;
    }
    if (who) {
      await sql`
        insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
        values (${orgId}::uuid, ${roleId}::uuid, ${people[who]}::uuid, date '2020-01-01', ${users[who]}::uuid)`;
    }
  }
  if (people.founder) {
    const [applied] = await rows<{ outcome: string }>(
      sql`select outcome from presby_apply_founding_administrator(${orgs.presbytery.id}::uuid, ${people.founder}::uuid, ${users.founder}::uuid)`,
    );
    if (applied?.outcome === "has_holders") throw new Error("[committees-fixture] the founding administrator was already designated");
  }

  // The wrong-kind groups, and presbytery B's one real committee.
  const actor = Object.values(users)[0];
  if (!actor) throw new Error("[committees-fixture] the fixture needs at least one account (the details row records its author)");
  const choir = await insertGroup(sql, orgs.presbytery.id, "choir", COMMITTEES_NAMES.choir);
  const congCommittee = await insertGroup(sql, orgs.congA.id, "committee", COMMITTEES_NAMES.congCommittee);
  const otherCommittee = await insertGroup(sql, orgs.presbyteryOther.id, "committee", COMMITTEES_NAMES.otherCommittee);
  await sql`
    insert into committee_details (organization_id, group_id, kind, created_by, updated_by)
    values (${orgs.presbyteryOther.id}::uuid, ${otherCommittee}::uuid, 'standing', ${actor}::uuid, ${actor}::uuid)`;

  return {
    ...orgs,
    people,
    users,
    seatable,
    groups: { choir, derived: derived!.id, congCommittee, otherCommittee },
    roles,
  };
}

// ---------------------------------------------------------------------------
// owner-side seeding (the way a spec makes a row it does not want to type)
// ---------------------------------------------------------------------------

/** A managed committee group at presbytery A with its details row (kind may be null: "Not yet labelled"). */
export async function seedCommittee(
  sql: Sql,
  fx: CommitteesFixture,
  c: { name: string; kind?: "required" | "standing" | "ad_hoc" | null; purpose?: string; meetsWhen?: string },
): Promise<string> {
  const actor = Object.values(fx.users)[0]!;
  const [row] = await rows<{ id: string }>(sql`
    insert into groups (organization_id, group_type_id, name, description, meets_when)
    values (${fx.presbytery.id}::uuid, (select id from group_types where key = 'committee'), ${c.name}, ${c.purpose ?? null}, ${c.meetsWhen ?? null})
    returning id`);
  await sql`
    insert into committee_details (organization_id, group_id, kind, created_by, updated_by)
    values (${fx.presbytery.id}::uuid, ${row!.id}::uuid, ${c.kind ?? null}, ${actor}::uuid, ${actor}::uuid)`;
  return row!.id;
}

/** A seat on one of presbytery A's committees. Dates are `YYYY-MM-DD`. */
export async function seedSeat(
  sql: Sql,
  fx: CommitteesFixture,
  committeeId: string,
  personId: string,
  s: { role?: string; startsOn: string; endsOn?: string | null },
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into group_memberships (id, organization_id, group_id, person_id, group_role, source, starts_on, ends_on)
    values (${id}::uuid, ${fx.presbytery.id}::uuid, ${committeeId}::uuid, ${personId}::uuid, ${s.role ?? "member"}, 'managed',
            ${s.startsOn}::date, ${s.endsOn ?? null}::date)`;
  return id;
}

/** Makes the committee carry the fixture's custom role (the carries-role note and warning). */
export async function bindRoleToCommittee(sql: Sql, fx: CommitteesFixture, committeeId: string): Promise<void> {
  await sql`
    insert into role_grants (organization_id, role_id, group_id, starts_on, granted_by)
    values (${fx.presbytery.id}::uuid, ${fx.roles.carried}::uuid, ${committeeId}::uuid, date '2020-01-01', ${Object.values(fx.users)[0]!}::uuid)`;
}

/** Ends `gone`'s presbytery membership and records `late` as deceased (the two status badges). Neither holds a term or a grant. */
export async function retireSeatablePeople(sql: Sql, fx: CommitteesFixture): Promise<void> {
  await sql`update memberships set ended_on = date '2022-06-15' where organization_id = ${fx.presbytery.id}::uuid and person_id = ${fx.seatable.gone}::uuid`;
  await sql`update people set date_of_death = date '2023-03-04' where id = ${fx.seatable.late}::uuid`;
}

/** A live public site for the presbytery, so `presby_public_committee_roster` can answer. Removed with the fixture. */
export async function makePresbyterySiteLive(sql: Sql, fx: CommitteesFixture): Promise<void> {
  await sql`
    insert into organization_sites (organization_id, repo, status, last_ingested_at)
    values (${fx.presbytery.id}::uuid, ${`org/site-${fx.presbytery.slug}`}, 'live', now())`;
}

/** What the public committee directory would show for the presbytery: the definer, as the owner (it is `presby_app`'s door). */
export async function publicRoster(sql: Sql, fx: CommitteesFixture, committeeName: string): Promise<Array<{ group_name: string; group_role: string; display_name: string }>> {
  return rows(
    sql`select group_name, group_role, display_name from presby_public_committee_roster(${fx.presbytery.slug}, ${committeeName}, null)`,
  );
}

export interface SeatRow {
  id: string;
  person_id: string;
  group_role: string;
  starts_on: string;
  ends_on: string | null;
  public_listed: boolean;
}

/** Every seat on a committee, oldest first. */
export async function seatsOf(sql: Sql, committeeId: string): Promise<SeatRow[]> {
  return rows<SeatRow>(
    sql`select id, person_id, group_role, starts_on::text as starts_on, ends_on::text as ends_on, public_listed
          from group_memberships where group_id = ${committeeId}::uuid order by starts_on, ends_on nulls last, id`,
  );
}

export async function committeeByName(sql: Sql, fx: CommitteesFixture, name: string): Promise<{ id: string; kind: string | null; dissolved_on: string | null } | undefined> {
  const [row] = await rows<{ id: string; kind: string | null; dissolved_on: string | null }>(
    sql`select g.id, cd.kind, cd.dissolved_on::text as dissolved_on
          from groups g left join committee_details cd on cd.group_id = g.id
         where g.organization_id = ${fx.presbytery.id}::uuid and g.name = ${name}`,
  );
  return row;
}

/** The `tenant.committee.*` audit rows of one presbytery, oldest first. */
export async function committeesAudit(sql: Sql, presbyteryId: string): Promise<Array<{ action: string; resource_id: string | null; metadata: Record<string, unknown> }>> {
  return rows(
    sql`select action, resource_id, metadata from audit_events
         where action like 'tenant.committee.%' and metadata->>'organizationId' = ${presbyteryId}
         order by created_at, id`,
  );
}

// ---------------------------------------------------------------------------
// browser helpers
// ---------------------------------------------------------------------------

/**
 * A fresh browser context signed in as `who`, landing on `path`. Phone-sized by default. An account that
 * requires a second factor answers `/totp` with the shared enrolled secret; the caller asserts where it ends.
 */
export async function signedInContext(
  browser: Browser,
  who: Who,
  path: string,
  options: { viewport?: { width: number; height: number } } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 360, height: 740 } });
  const page = await context.newPage();
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(path)}`);
  await signInOnPage(page, COMMITTEES_EMAILS[who], COMMITTEES_PASSWORD);
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 60_000 });
  if (new URL(page.url()).pathname.startsWith("/totp")) await submitTotp(page, E2E_TOTP_TEST_SECRET);
  await page.close();
  return context;
}

/** The text of the page's `<main>` with whitespace collapsed (for "byte-identical body" comparisons). */
export async function mainText(page: Page): Promise<string> {
  return ((await page.locator("body").innerText()) ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Every visible control a thumb has to hit is at least 44px tall. A switch is measured by the label that
 * wraps it (the committees toggle's tap target is the label), the rest by themselves. Returns what is
 * too small, as readable strings.
 */
export async function smallControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const selector = "main button, main a[href], main select, main textarea, main input:not([type=hidden])";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const target = el.getAttribute("role") === "switch" ? (el.closest("label") ?? el) : el;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      // The portal layout's own "Back to portal" link is not this feature's to resize.
      if ((el.textContent ?? "").trim() === "Back to portal") continue;
      if (rect.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(rect.height)}px`);
    }
    return out;
  });
}

/** Pinned so a spec failure names the page: the page is not wider than the viewport. */
export async function expectNoSidewaysScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(overflow.scroll, `${what} must not scroll sideways (scrollWidth ${overflow.scroll}, clientWidth ${overflow.client})`).toBeLessThanOrEqual(overflow.client);
}
