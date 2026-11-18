/**
 * oversight-fixture.ts - setup, seeding and teardown for the congregation-records e2e specs
 * (Congregation profile Increment 1, Batch B4; docs/work-log/2026-11-17-congregation-profile-inc1.md,
 * parent Phase 3 "Test plan"). A NEW, additive file: nothing existing under `e2e/support/` is edited
 * (Workflow Rule 16 lists that directory as shared). It borrows two generic helpers
 * (`addMembership`, `removeOrg`) from `reimbursement-fixture.ts` and the page helpers from
 * `worship-fixture.ts` by import, and owns everything else.
 *
 * WHY THROWAWAY COUNCILS. Every oversight row is permanent record: `presby_app` holds no DELETE on the
 * six tables, and each carries `about_org_id` as a plain (NO ACTION) foreign key, so a congregation with
 * records about it cannot be deleted and an open affiliation blocks the presbytery's delete until the
 * congregation is gone. Records made through the app therefore cannot be cleaned up on a standing
 * fixture. This fixture mints its own presbyteries and congregations (stamped `deletable_until`) and
 * tears them down in the ONE order that works (B1's Implementer Note 1, pinned by `oversight.db.test.ts`):
 * as the OWNER, delete every row of the six tables (children first: photos, appraisals, loans, then
 * buildings, insurance years, profiles) for the fixture councils, then the legacy `congregation_oversight`
 * rows, then the congregations, then the presbyteries.
 *
 * SHAPE. Presbytery A has two member congregations (`congA` managed, `congB` unmanaged: the two sides of
 * the "this congregation is on PresbyPortal" note). Presbytery B has one (`congO`), for the
 * cross-presbytery cases.
 *
 * IDS (this pipeline's range, grepped free in e2e/ and scripts/): people `00000000-0000-4089-8000-`,
 * roles `00000000-0000-4089-9000-`, organizations `00000000-0000-4089-9001-` (unique per run, because
 * `audit_events` is append-only and keeps a run's rows: a reused organization id would make every audit
 * count in a spec include earlier runs). Users take a random uuid, found again by their `.invalid` address.
 *
 * WHO IS WHO (all synthetic, `.invalid` addresses, invented names; No Real Data):
 *   clerk    Ione Marchetti     manage only (a custom role), no two-factor: the Locked-finance viewer
 *   finance  Tobias Quennell    finance only, MFA enrolled (a flagged key requires it)
 *   both     Odalys Renfrew     manage and finance, MFA enrolled
 *   founder  Corwin Peabody     founding administrator, minted through the real definer
 *            (`presby_apply_founding_administrator`, the F362 lesson), MFA enrolled
 *   second   Saffron Whitlock   a member with NO role and NO enrolment: the R2 walk gives her the finance
 *            key through a custom role the founder creates, and her next sign-in must ask her to enrol
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { withDbRetry, type Sql } from "./db";
import { signInOnPage, submitTotp } from "./invitation-ui";
import { addMembership, removeOrg } from "./reimbursement-fixture";
import { E2E_TOTP_TEST_SECRET, seedTotpEnrollment } from "./totp-fixture";

export { newPhonePage, noSidewaysScroll, smallTargets, waitHydrated } from "./worship-fixture";

export const OVERSIGHT_FLAG = "org_portal.oversight";

export const PERSON_PREFIX = "00000000-0000-4089-8000-";
export const ROLE_PREFIX = "00000000-0000-4089-9000-";
export const ORG_PREFIX = "00000000-0000-4089-9001-";
/** `pid(n)` is `00000000-0000-4089-8000-00000000000n`; `rid(n)` and the organizations likewise. */
export const pid = (n: number) => `${PERSON_PREFIX}${String(n).padStart(12, "0")}`;
export const rid = (n: number) => `${ROLE_PREFIX}${String(n).padStart(12, "0")}`;

/** Not a secret: throwaway `.invalid` accounts, removed with the fixture. */
export const OVERSIGHT_PASSWORD = "e2e-oversight-fixture-not-a-secret"; // leak-ok: throwaway password for a `.invalid` fixture account

export const MANAGE_KEY = "congregation_oversight.manage";
export const FINANCE_KEY = "congregation_oversight.finance";

export type Who = "clerk" | "finance" | "both" | "founder" | "second";

const PEOPLE: Record<Who, { n: number; first: string; last: string; mfa: boolean }> = {
  clerk: { n: 1, first: "Ione", last: "Marchetti", mfa: false },
  finance: { n: 2, first: "Tobias", last: "Quennell", mfa: true },
  both: { n: 3, first: "Odalys", last: "Renfrew", mfa: true },
  founder: { n: 4, first: "Corwin", last: "Peabody", mfa: true },
  second: { n: 5, first: "Saffron", last: "Whitlock", mfa: false },
};

export const OVERSIGHT_EMAILS = Object.fromEntries(
  Object.keys(PEOPLE).map((who) => [who, `e2e-ovs-${who}@presby.invalid`]),
) as Record<Who, string>;

export const OVERSIGHT_NAMES = {
  presbytery: "E2E Oversight Presbytery",
  congA: "E2E Oversight Congregation Alder",
  congB: "E2E Oversight Congregation Birch",
  presbyteryOther: "E2E Oversight Other Presbytery",
  congO: "E2E Oversight Congregation Cedar",
  clerk: "Ione Marchetti",
  finance: "Tobias Quennell",
  both: "Odalys Renfrew",
  founder: "Corwin Peabody",
  second: "Saffron Whitlock",
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];

export interface FixtureOrg {
  id: string;
  slug: string;
  name: string;
}

export interface OversightFixture {
  presbytery: FixtureOrg;
  /** Managed, a member of the presbytery. */
  congA: FixtureOrg;
  /** Unmanaged (in the presbytery's records only), a member of the presbytery. */
  congB: FixtureOrg;
  /** A second presbytery and its one congregation: nothing in them belongs to presbytery A. */
  presbyteryOther: FixtureOrg;
  congO: FixtureOrg;
  people: Record<Who, string>;
  users: Record<Who, string>;
  roles: { clerk: string; finance: string; both: string };
}

function assertFixtureSlug(slug: string) {
  if (!/^e2e-ovs[a-z]*-\d+(-[a-z]+)?$/.test(slug)) throw new Error(`[oversight-fixture] refusing to touch non-fixture slug "${slug}"`);
}

const orgIds = (fx: OversightFixture) => [fx.presbytery.id, fx.congA.id, fx.congB.id, fx.presbyteryOther.id, fx.congO.id];

// ---------------------------------------------------------------------------
// teardown (B1's contract) and the sweep
// ---------------------------------------------------------------------------

/**
 * Deletes, as the owner, every row of the six oversight tables and the legacy `congregation_oversight`
 * table for these organizations (as the council or as the congregation it is about), children first.
 */
export async function deleteOversightRows(sql: Sql, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  for (const table of [
    "oversight_building_photos",
    "oversight_building_appraisals",
    "oversight_loans",
    "oversight_buildings",
    "oversight_insurance_years",
    "oversight_profiles",
    "congregation_oversight",
  ]) {
    await withDbRetry(`delete ${table} rows`, () =>
      sql.query(`delete from ${table} where organization_id = any($1::uuid[]) or about_org_id = any($1::uuid[])`, [ids]),
    );
  }
}

/** Removes a congregation or presbytery (the owner delete; the caller has already cleared the records). */
async function removeCouncil(sql: Sql, orgId: string): Promise<void> {
  await removeOrg(sql, orgId);
}

async function removeFixturePeopleAndUsers(sql: Sql): Promise<void> {
  await withDbRetry("delete oversight fixture people", () => sql`delete from people where id::text like '00000000-0000-4089-8000-%'`);
  await withDbRetry("delete oversight fixture users", () => sql`delete from users where email like 'e2e-ovs-%@presby.invalid'`);
}

/** Removes every `e2e-ovs<tag>-<digits>` council a crashed run left, then the fixture people and users. */
export async function sweepStaleOversightFixtures(sql: Sql): Promise<number> {
  const stale = await withDbRetry(
    "list stale oversight orgs",
    async () =>
      (await sql`select id, organization_type::text as type from organizations where slug ~ '^e2e-ovs[a-z]*-[0-9]+(-[a-z]+)?$'`) as {
        id: string;
        type: string;
      }[],
  );
  const ids = stale.map((s) => s.id);
  await deleteOversightRows(sql, ids);
  for (const council of stale.filter((s) => s.type === "congregation")) await removeCouncil(sql, council.id);
  for (const council of stale.filter((s) => s.type !== "congregation")) await removeCouncil(sql, council.id);
  await removeFixturePeopleAndUsers(sql);
  return stale.length;
}

export async function removeOversightFixture(sql: Sql, fx: OversightFixture): Promise<void> {
  for (const org of [fx.presbytery, fx.congA, fx.congB, fx.presbyteryOther, fx.congO]) assertFixtureSlug(org.slug);
  await deleteOversightRows(sql, orgIds(fx));
  for (const congregation of [fx.congA, fx.congB, fx.congO]) await removeCouncil(sql, congregation.id);
  for (const presbytery of [fx.presbytery, fx.presbyteryOther]) await removeCouncil(sql, presbytery.id);
  await removeFixturePeopleAndUsers(sql);
  const left = await withDbRetry(
    "confirm oversight orgs gone",
    async () => (await sql.query(`select 1 from organizations where id = any($1::uuid[])`, [orgIds(fx)])) as unknown[],
  );
  if (left.length > 0) throw new Error(`[oversight-fixture] fixture organizations of ${fx.presbytery.slug} were not removed`);
}

// ---------------------------------------------------------------------------
// the whole fixture
// ---------------------------------------------------------------------------

export interface SetupOptions {
  /** Lower-case letters: the slug is `e2e-ovs<tag>-<stamp>`. */
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
            'e2e fixture affiliation (e2e/support/oversight-fixture.ts)')`;
}

export async function setupOversightFixture(sql: Sql, options: SetupOptions): Promise<OversightFixture> {
  if (!/^[a-z]{0,6}$/.test(options.tag)) throw new Error("[oversight-fixture] the tag is up to six lower-case letters");
  await sweepStaleOversightFixtures(sql);
  const stamp = options.stamp ?? Date.now();
  const base = `e2e-ovs${options.tag}-${stamp}`;
  // Five organizations per run, ids unique per run: stamp tail, then the organization's own digit.
  const oid = (k: number) => `${ORG_PREFIX}${String((stamp % 100_000_000_000) * 10 + k).padStart(12, "0")}`;
  const org = (k: number, suffix: string, name: string): FixtureOrg => ({ id: oid(k), slug: suffix ? `${base}-${suffix}` : base, name });
  const fx = {
    presbytery: org(1, "", OVERSIGHT_NAMES.presbytery),
    congA: org(2, "ca", OVERSIGHT_NAMES.congA),
    congB: org(3, "cb", OVERSIGHT_NAMES.congB),
    presbyteryOther: org(4, "po", OVERSIGHT_NAMES.presbyteryOther),
    congO: org(5, "co", OVERSIGHT_NAMES.congO),
  } as Pick<OversightFixture, "presbytery" | "congA" | "congB" | "presbyteryOther" | "congO">;

  await insertOrg(sql, { ...fx.presbytery, type: "presbytery", status: "managed" });
  await insertOrg(sql, { ...fx.presbyteryOther, type: "presbytery", status: "managed" });
  await insertOrg(sql, { ...fx.congA, type: "congregation", status: "managed" });
  await insertOrg(sql, { ...fx.congB, type: "congregation", status: "unmanaged" });
  await insertOrg(sql, { ...fx.congO, type: "congregation", status: "managed" });
  await affiliate(sql, fx.presbytery.id, fx.congA.id);
  await affiliate(sql, fx.presbytery.id, fx.congB.id);
  await affiliate(sql, fx.presbyteryOther.id, fx.congO.id);
  // The presbytery's derived Active Membership group: every `memberships` insert syncs it (0017).
  for (const council of [fx.presbytery, fx.presbyteryOther]) {
    await sql`
      insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
      select ${council.id}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`;
  }

  const hash = await bcrypt.hash(OVERSIGHT_PASSWORD, 10);
  const people = {} as Record<Who, string>;
  const users = {} as Record<Who, string>;
  for (const who of options.who ?? (Object.keys(PEOPLE) as Who[])) {
    const p = PEOPLE[who];
    const [user] = await rows<{ id: string }>(sql`
      insert into users (email, name, password, email_verified, is_active, two_factor_required)
      values (${OVERSIGHT_EMAILS[who]}, ${`${p.first} ${p.last}`}, ${hash}, now(), true, ${p.mfa})
      returning id`);
    users[who] = user!.id;
    people[who] = pid(p.n);
    await sql`
      insert into people (id, user_id, first_name, last_name, deletable_until)
      values (${pid(p.n)}::uuid, ${user!.id}::uuid, ${p.first}, ${p.last}, now() + interval '3 hours')`;
    await addMembership(sql, fx.presbytery.id, pid(p.n), "regular", null);
    if (p.mfa) await seedTotpEnrollment(sql, user!.id);
  }

  // The custom roles. The founder holds hers through the definer (below), the second person has none.
  const roles = { clerk: rid(1), finance: rid(2), both: rid(3) };
  const custom: Array<[string, string, string, string[], Who]> = [
    [roles.clerk, "e2e_ovs_manager", "E2E Oversight Manager", [MANAGE_KEY], "clerk"],
    [roles.finance, "e2e_ovs_finance", "E2E Oversight Finance", [FINANCE_KEY], "finance"],
    [roles.both, "e2e_ovs_both", "E2E Oversight Manager and Finance", [MANAGE_KEY, FINANCE_KEY], "both"],
  ];
  for (const [roleId, key, name, permissions, who] of custom) {
    if (!people[who]) continue;
    await sql`
      insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
      values (${roleId}::uuid, ${fx.presbytery.id}::uuid, ${key}, ${name}, 'custom', false)`;
    for (const permission of permissions) {
      await sql`insert into app_role_permissions (role_id, permission_key) values (${roleId}::uuid, ${permission})`;
    }
    await sql`
      insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
      values (${fx.presbytery.id}::uuid, ${roleId}::uuid, ${people[who]}::uuid, date '2020-01-01', ${users[who]}::uuid)`;
  }
  if (people.founder) {
    const [applied] = await rows<{ outcome: string }>(
      sql`select outcome from presby_apply_founding_administrator(${fx.presbytery.id}::uuid, ${people.founder}::uuid, ${users.founder}::uuid)`,
    );
    if (applied?.outcome === "has_holders") throw new Error("[oversight-fixture] the founding administrator was already designated");
  }
  return { ...fx, people, users, roles };
}

// ---------------------------------------------------------------------------
// owner-side record seeding (the way a spec makes a row it does not want to type)
// ---------------------------------------------------------------------------

type Cong = "congA" | "congB" | "congO";
const councilOf = (fx: OversightFixture, cong: Cong) => (cong === "congO" ? fx.presbyteryOther.id : fx.presbytery.id);

export async function seedBuilding(
  sql: Sql,
  fx: OversightFixture,
  cong: Cong,
  b: { name: string; type?: string; primary?: boolean; yearBuilt?: number; notes?: string; retiredOn?: string; retiredReason?: string },
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into oversight_buildings (id, organization_id, about_org_id, name, building_type, year_built, is_primary, notes,
                                     retired_on, retired_reason, created_by, updated_by)
    values (${id}::uuid, ${councilOf(fx, cong)}::uuid, ${fx[cong].id}::uuid, ${b.name}, ${b.type ?? "sanctuary"},
            ${b.yearBuilt ?? null}, ${b.primary ?? false}, ${b.notes ?? null}, ${b.retiredOn ?? null}::date,
            ${b.retiredReason ?? null}, ${fx.users.clerk ?? fx.users.both}::uuid, ${fx.users.clerk ?? fx.users.both}::uuid)`;
  return id;
}

export async function seedAppraisal(sql: Sql, fx: OversightFixture, cong: Cong, buildingId: string, year: number, cents: number): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into oversight_building_appraisals (id, organization_id, about_org_id, building_id, assessed_year, amount_cents, created_by)
    values (${id}::uuid, ${councilOf(fx, cong)}::uuid, ${fx[cong].id}::uuid, ${buildingId}::uuid, ${year}, ${cents}, ${fx.users.both}::uuid)`;
  return id;
}

export async function seedInsurance(
  sql: Sql,
  fx: OversightFixture,
  cong: Cong,
  i: { policyYear: number; carrier?: string; policyNumber?: string; expiresOn?: string | null },
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into oversight_insurance_years (id, organization_id, about_org_id, policy_year, carrier, policy_number, policy_expires_on, created_by, updated_by)
    values (${id}::uuid, ${councilOf(fx, cong)}::uuid, ${fx[cong].id}::uuid, ${i.policyYear}, ${i.carrier ?? null}, ${i.policyNumber ?? null},
            ${i.expiresOn ?? null}::date, ${fx.users.both}::uuid, ${fx.users.both}::uuid)`;
  return id;
}

export async function seedLoan(
  sql: Sql,
  fx: OversightFixture,
  cong: Cong,
  l: { kind?: string; lender?: string; originalCents?: number; balanceCents?: number; balanceAsOf?: string },
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into oversight_loans (id, organization_id, about_org_id, kind, lender, original_amount_cents, current_balance_cents, balance_as_of, created_by, updated_by)
    values (${id}::uuid, ${councilOf(fx, cong)}::uuid, ${fx[cong].id}::uuid, ${l.kind ?? "presbytery_program"}, ${l.lender ?? null},
            ${l.originalCents ?? null}, ${l.balanceCents ?? null}, ${l.balanceAsOf ?? null}::date, ${fx.users.both}::uuid, ${fx.users.both}::uuid)`;
  return id;
}

export async function seedProfile(sql: Sql, fx: OversightFixture, cong: Cong, p: { city?: string; county?: string }): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into oversight_profiles (id, organization_id, about_org_id, city, county, created_by, updated_by)
    values (${id}::uuid, ${councilOf(fx, cong)}::uuid, ${fx[cong].id}::uuid, ${p.city ?? null}, ${p.county ?? null}, ${fx.users.clerk}::uuid, ${fx.users.clerk}::uuid)`;
  return id;
}

/** The audit rows `tenant.oversight_*` of one presbytery, oldest first. */
export async function oversightAudit(sql: Sql, presbyteryId: string): Promise<Array<{ action: string; resource_id: string | null; metadata: Record<string, unknown> }>> {
  return rows(
    sql`select action, resource_id, metadata from audit_events
         where action like 'tenant.oversight_%' and metadata->>'organizationId' = ${presbyteryId}
         order by created_at, id`,
  );
}

export const isUuidText = (s: string) => UUID.test(s);

// ---------------------------------------------------------------------------
// browser helpers
// ---------------------------------------------------------------------------

/**
 * A fresh browser context signed in as `who`, landing on `path`. Phone-sized by default. A person whose
 * account requires a second factor answers `/totp` with the shared enrolled secret; one who has not
 * enrolled is left wherever the app sends them (the caller asserts where that is).
 */
export async function signedInContext(
  browser: Browser,
  who: Who,
  path: string,
  options: { viewport?: { width: number; height: number }; answerTotp?: boolean } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 360, height: 740 } });
  const page = await context.newPage();
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(path)}`);
  await signInOnPage(page, OVERSIGHT_EMAILS[who], OVERSIGHT_PASSWORD);
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 60_000 });
  if (options.answerTotp !== false && new URL(page.url()).pathname.startsWith("/totp")) await submitTotp(page, E2E_TOTP_TEST_SECRET);
  await page.close();
  return context;
}

/** The text of the page's `<main>` with whitespace collapsed (for "byte-identical body" comparisons). */
export async function mainText(page: Page): Promise<string> {
  return ((await page.locator("main").first().innerText()) ?? "").replace(/\s+/g, " ").trim();
}

/** Every named section heading on a record page, with whether its card says "Locked". */
export async function sectionStates(page: Page): Promise<Record<string, "locked" | "open">> {
  const out: Record<string, "locked" | "open"> = {};
  for (const name of ["Profile", "Assessment", "Buildings", "Insurance", "Loans"]) {
    const section = page.getByRole("region", { name, exact: true });
    await expect(section, `the ${name} section is on the page`).toBeVisible();
    out[name] = (await section.getByText("Locked", { exact: true }).count()) > 0 ? "locked" : "open";
  }
  return out;
}

/**
 * Every control a thumb has to hit is at least 44px tall (a checkbox's own row is the target, so the
 * box itself is not measured). Returns what is too small, as readable strings.
 */
export async function smallControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const selector = "main button, main a[href], main select, main textarea, main input:not([type=hidden]):not([type=checkbox])";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      // The portal layout's own "Back to portal" link is not oversight's to resize.
      if ((el.textContent ?? "").trim() === "Back to portal") continue;
      if (rect.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(rect.height)}px`);
    }
    return out;
  });
}
