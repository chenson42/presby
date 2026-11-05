/**
 * worship-fixture.ts - setup, seeding and teardown for the worship e2e specs (worship
 * Increment 1, Batch 6; docs/work-log/2026-11-04-worship-inc1.md, Phase 3 "E2E"). A NEW,
 * additive file: nothing existing under `e2e/support/` is edited (Workflow Rule 16 lists that
 * directory as shared). It borrows two generic helpers from `reimbursement-fixture.ts`
 * (`removeOrg`, `addMembership`) by import and owns everything else.
 *
 * WHY A THROWAWAY CONGREGATION. A worship assignment is permanent record: no role holds DELETE
 * on it, so a spec's rows cannot be cleaned up on a standing fixture. An organization stamped
 * `deletable_until` at insert is removed with ONE `delete from organizations`, and the cascade
 * takes every worship row with it. Slugs are `e2e-worship<tag>-<stamp>`.
 *
 * IDS. People use the range this pipeline owns, `00000000-0000-4085-8000-`; organizations
 * `00000000-0000-4085-9001-` (unique per run: `audit_events` is append-only and keeps a run's rows,
 * so a reused organization id would make every audit count in a spec include earlier runs). Every
 * other row (groups, positions, events, assignments) takes a random uuid made here, so a spec
 * knows the id without a read-back.
 *
 * F433 - THE ORG CONTEXT. The worship actor guards call `presby_has_permission`, which answers only
 * when `app.current_org_id` equals the row's organization (migration 0010). The app always writes
 * through `withOrgContext()`; this owner-connection fixture therefore sets the context itself, in
 * the SAME statement as the guarded write (`set_config(..., true)` inside one `DO` block, because the
 * HTTP driver runs each statement in its own transaction). Without it the guard refuses with 42501
 * and the fixture fails closed.
 *
 * WHO IS WHO (all synthetic, `.invalid` addresses, invented names; No Real Data):
 *   planner  Celeste Marlowe     worship.manage/plan/schedule and org_features.manage by custom roles
 *   leader   Barnaby Ellsworth   `leader` of the Sunday Band group: schedules it by the SEAT, no key
 *   wren     Wren Pellam         band member, can fill Vocals; signs in
 *   linus    Linus Ashby         band member, no assignment (the "someone else's id" case); signs in
 *   posy     Posy Wetherby       a child (household role): a presumed minor, no sign-in, no email
 *   jasper   Jasper Quill        band member with no email address on file
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { withDbRetry, type Sql } from "./db";
import { signInOnPage } from "./invitation-ui";
import { addMembership, removeOrg } from "./reimbursement-fixture";

export const WORSHIP_TOGGLE_KEY = "org_portal.worship";

export const PERSON_PREFIX = "00000000-0000-4085-8000-";
export const ORG_PREFIX = "00000000-0000-4085-9001-";
/** `pid(n)` is `00000000-0000-4085-8000-00000000000n`. */
export const pid = (n: number) => `${PERSON_PREFIX}${String(n).padStart(12, "0")}`;

/** Not a secret: throwaway `.invalid` accounts, removed with the fixture. */
export const WORSHIP_PASSWORD = "e2e-worship-fixture-not-a-secret";

export const WORSHIP_NAMES = {
  org: "E2E Worship Fixture Church",
  band: "Sunday Band",
  choir: "Chancel Choir",
  planner: "Celeste Marlowe",
  leader: "Barnaby Ellsworth",
  wren: "Wren Pellam",
  linus: "Linus Ashby",
  posy: "Posy Wetherby",
  jasper: "Jasper Quill",
  serviceTitle: "Sunday worship",
} as const;

type Who = "planner" | "leader" | "wren" | "linus" | "posy" | "jasper";
const PEOPLE: Record<Who, { n: number; first: string; last: string; email: string | null; signsIn: boolean }> = {
  planner: { n: 1, first: "Celeste", last: "Marlowe", email: "e2e-worship-celeste@presby.invalid", signsIn: true },
  leader: { n: 2, first: "Barnaby", last: "Ellsworth", email: "e2e-worship-barnaby@presby.invalid", signsIn: true },
  wren: { n: 3, first: "Wren", last: "Pellam", email: "e2e-worship-wren@presby.invalid", signsIn: true },
  linus: { n: 4, first: "Linus", last: "Ashby", email: "e2e-worship-linus@presby.invalid", signsIn: true },
  posy: { n: 5, first: "Posy", last: "Wetherby", email: null, signsIn: false },
  jasper: { n: 6, first: "Jasper", last: "Quill", email: null, signsIn: false },
};
export const WORSHIP_EMAILS = Object.fromEntries(Object.entries(PEOPLE).map(([k, v]) => [k, v.email])) as Record<Who, string | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidLit = (value: string) => {
  if (!UUID.test(value)) throw new Error(`[worship-fixture] not a uuid: ${value}`);
  return `'${value}'::uuid`;
};
const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;
const rows = async <T = Record<string, unknown>>(query: Promise<unknown>) => (await query) as T[];

function assertFixtureSlug(slug: string) {
  if (!/^e2e-worship[a-z]*-\d+$/.test(slug)) throw new Error(`[worship-fixture] refusing to touch non-fixture slug "${slug}"`);
}

export interface WorshipFixture {
  orgId: string;
  slug: string;
  name: string;
  band: string;
  choir: string;
  positions: { leader: string; vocals: string; keys: string; drums: string; sopranos: string };
  people: Record<Who, string>;
  users: Record<Who, string | null>;
  /** The next-but-one Sunday at 10:00 in the organization's zone: always ahead. */
  serviceId: string;
  /** A second, later service the band also serves (for the multi-request email and the list). */
  serviceId2: string;
  /** The wall-clock text the first service's read shows ('YYYY-MM-DDTHH:mm'). */
  serviceStartsAt: string;
}

// ---------------------------------------------------------------------------
// guarded writes
// ---------------------------------------------------------------------------

/**
 * Runs `body` (plpgsql statements) as the owner with the organization context set (F433). One
 * `DO` block = one transaction, so the context and the guarded write share it.
 */
export async function inOrg(sql: Sql, orgId: string, body: string): Promise<void> {
  await withDbRetry("worship fixture guarded write", () =>
    sql.query(`do $$ begin perform set_config('app.current_org_id', '${orgId}', true); ${body} end $$`),
  );
}

// ---------------------------------------------------------------------------
// the whole fixture
// ---------------------------------------------------------------------------

export interface SetupOptions {
  /** Lower-case letters: the slug is `e2e-worship<tag>-<stamp>`. */
  tag: string;
  /** The org's Worship toggle (default on). `null` leaves it unset (the provisioned default: off). */
  toggle?: boolean | null;
  stamp?: number;
}

export async function sweepStaleWorshipFixtures(sql: Sql): Promise<number> {
  const stale = await withDbRetry(
    "list stale worship orgs",
    async () => (await sql`select id from organizations where slug ~ '^e2e-worship[a-z]*-[0-9]+$'`) as { id: string }[],
  );
  for (const { id } of stale) await removeOrg(sql, id);
  await withDbRetry("delete worship fixture people", () => sql`delete from people where id::text like '00000000-0000-4085-8000-%'`);
  await withDbRetry("delete worship fixture users", () => sql`delete from users where email like 'e2e-worship-%@presby.invalid'`);
  return stale.length;
}

export async function setToggle(sql: Sql, orgId: string, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await withDbRetry("clear worship toggle", () => sql`
      delete from organization_feature_toggles where organization_id = ${orgId}::uuid and feature_key = ${WORSHIP_TOGGLE_KEY}`);
    return;
  }
  await withDbRetry("set worship toggle", () => sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${orgId}::uuid, ${WORSHIP_TOGGLE_KEY}, ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = excluded.enabled`);
}

export async function setupWorshipFixture(sql: Sql, options: SetupOptions): Promise<WorshipFixture> {
  if (!/^[a-z]{0,6}$/.test(options.tag)) throw new Error("[worship-fixture] the tag is up to six lower-case letters");
  await sweepStaleWorshipFixtures(sql);
  const stamp = options.stamp ?? Date.now();
  const slug = `e2e-worship${options.tag}-${stamp}`;
  assertFixtureSlug(slug);
  const orgId = `${ORG_PREFIX}${String(stamp % 1_000_000_000_000).padStart(12, "0")}`;
  const hash = await bcrypt.hash(WORSHIP_PASSWORD, 10);

  await sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${orgId}::uuid, 'congregation', ${WORSHIP_NAMES.org}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`;
  await sql`
    insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected)
    select ${orgId}::uuid, (select id from group_types where key = 'roster'), 'Active Membership', 'derived', 'active_membership', true`;

  const people = {} as Record<Who, string>;
  const users = {} as Record<Who, string | null>;
  for (const [who, p] of Object.entries(PEOPLE) as Array<[Who, (typeof PEOPLE)[Who]]>) {
    people[who] = pid(p.n);
    users[who] = null;
    if (p.signsIn && p.email) {
      const [row] = await rows<{ id: string }>(sql`
        insert into users (email, name, password, email_verified, is_active, two_factor_required)
        values (${p.email}, ${`${p.first} ${p.last}`}, ${hash}, now(), true, false) returning id`);
      users[who] = row!.id;
    }
    await sql`
      insert into people (id, user_id, first_name, last_name, deletable_until)
      values (${pid(p.n)}::uuid, ${users[who]}::uuid, ${p.first}, ${p.last}, now() + interval '3 hours')`;
    await addMembership(sql, orgId, pid(p.n), "regular", "active");
    if (p.email) {
      await sql`
        insert into contact_methods (person_id, kind, subtype, value, is_primary)
        values (${pid(p.n)}::uuid, 'email', 'personal', ${p.email}, true)`;
    }
  }
  // Posy is a child (a presumed minor: no email of any kind, whatever her record says).
  await sql`update memberships set household_role = 'child' where organization_id = ${orgId}::uuid and person_id = ${pid(PEOPLE.posy.n)}::uuid`;

  // Keys: one custom role for the planner with the three worship keys, another with the Features key.
  const plannerRole = randomUUID();
  const featuresRole = randomUUID();
  for (const [roleId, key, name, permissions] of [
    [plannerRole, "e2e_worship_planner", "E2E Worship Planner", ["worship.manage", "worship.plan", "worship.schedule"]],
    [featuresRole, "e2e_worship_features", "E2E Features Manager", ["org_features.manage"]],
  ] as const) {
    await sql`
      insert into app_roles (id, organization_id, key, name, role_kind, is_protected)
      values (${roleId}::uuid, ${orgId}::uuid, ${key}, ${name}, 'custom', false)`;
    for (const permission of permissions) {
      await sql`insert into app_role_permissions (role_id, permission_key) values (${roleId}::uuid, ${permission})`;
    }
    await sql`
      insert into role_grants (organization_id, role_id, person_id, starts_on, granted_by)
      values (${orgId}::uuid, ${roleId}::uuid, ${pid(PEOPLE.planner.n)}::uuid, date '2020-01-01', ${users.planner}::uuid)`;
  }

  // The team, its roster, positions and who can fill what, then the services. All guarded writes carry the context.
  const band = randomUUID();
  const choir = randomUUID();
  const positions = { leader: randomUUID(), vocals: randomUUID(), keys: randomUUID(), drums: randomUUID(), sopranos: randomUUID() };
  const serviceId = randomUUID();
  const serviceId2 = randomUUID();
  const P = (who: Who) => uuidLit(people[who]);
  await inOrg(
    sql,
    orgId,
    `
    insert into groups (id, organization_id, group_type_id, name, description)
    select ${uuidLit(band)}, ${uuidLit(orgId)}, gt.id, ${lit(WORSHIP_NAMES.band)}, 'Leads music at the Sunday service.' from group_types gt where gt.key = 'team';
    insert into groups (id, organization_id, group_type_id, name, description)
    select ${uuidLit(choir)}, ${uuidLit(orgId)}, gt.id, ${lit(WORSHIP_NAMES.choir)}, 'Sings at the Sunday service.' from group_types gt where gt.key = 'choir';
    insert into worship_teams (group_id, organization_id) values (${uuidLit(band)}, ${uuidLit(orgId)}), (${uuidLit(choir)}, ${uuidLit(orgId)});
    insert into worship_positions (id, organization_id, group_id, name, slots, sort_order) values
      (${uuidLit(positions.leader)}, ${uuidLit(orgId)}, ${uuidLit(band)}, 'Worship leader', 1, 10),
      (${uuidLit(positions.vocals)}, ${uuidLit(orgId)}, ${uuidLit(band)}, 'Vocals', 2, 20),
      (${uuidLit(positions.keys)}, ${uuidLit(orgId)}, ${uuidLit(band)}, 'Keys', 1, 30),
      (${uuidLit(positions.drums)}, ${uuidLit(orgId)}, ${uuidLit(band)}, 'Drums', 1, 40),
      (${uuidLit(positions.sopranos)}, ${uuidLit(orgId)}, ${uuidLit(choir)}, 'Soprano', 4, 10);
    insert into group_memberships (organization_id, group_id, person_id, group_role, starts_on) values
      (${uuidLit(orgId)}, ${uuidLit(band)}, ${P("leader")}, 'leader', date '2024-09-01'),
      (${uuidLit(orgId)}, ${uuidLit(band)}, ${P("wren")}, 'member', date '2024-09-01'),
      (${uuidLit(orgId)}, ${uuidLit(band)}, ${P("linus")}, 'member', date '2024-09-01'),
      (${uuidLit(orgId)}, ${uuidLit(band)}, ${P("posy")}, 'member', date '2024-09-01'),
      (${uuidLit(orgId)}, ${uuidLit(band)}, ${P("jasper")}, 'member', date '2024-09-01');
    insert into worship_position_qualifications (organization_id, group_id, position_id, person_id) values
      (${uuidLit(orgId)}, ${uuidLit(band)}, ${uuidLit(positions.vocals)}, ${P("wren")}),
      (${uuidLit(orgId)}, ${uuidLit(band)}, ${uuidLit(positions.keys)}, ${P("posy")}),
      (${uuidLit(orgId)}, ${uuidLit(band)}, ${uuidLit(positions.drums)}, ${P("jasper")});
    insert into events (id, organization_id, title, location, starts_at, ends_at, is_public, website_listed, allows_checkin) values
      (${uuidLit(serviceId)}, ${uuidLit(orgId)}, ${lit(WORSHIP_NAMES.serviceTitle)}, 'Sanctuary',
         (date_trunc('day', now() at time zone 'America/New_York') + interval '14 days' + time '10:00'),
         (date_trunc('day', now() at time zone 'America/New_York') + interval '14 days' + time '11:15'), true, false, false),
      (${uuidLit(serviceId2)}, ${uuidLit(orgId)}, 'Evening worship', 'Chapel',
         (date_trunc('day', now() at time zone 'America/New_York') + interval '21 days' + time '18:00'),
         (date_trunc('day', now() at time zone 'America/New_York') + interval '21 days' + time '19:00'), true, false, false);
    insert into worship_services (event_id, organization_id) values (${uuidLit(serviceId)}, ${uuidLit(orgId)}), (${uuidLit(serviceId2)}, ${uuidLit(orgId)});
    insert into worship_service_teams (organization_id, event_id, group_id) values
      (${uuidLit(orgId)}, ${uuidLit(serviceId)}, ${uuidLit(band)}),
      (${uuidLit(orgId)}, ${uuidLit(serviceId)}, ${uuidLit(choir)}),
      (${uuidLit(orgId)}, ${uuidLit(serviceId2)}, ${uuidLit(band)});
  `,
  );
  const [event] = await rows<{ s: string }>(sql`select to_char(starts_at, 'YYYY-MM-DD"T"HH24:MI') as s from events where id = ${serviceId}::uuid`);

  if (options.toggle !== null) await setToggle(sql, orgId, options.toggle !== false);

  return {
    orgId, slug, name: WORSHIP_NAMES.org, band, choir, positions, people, users, serviceId, serviceId2,
    serviceStartsAt: event!.s,
  };
}

// ---------------------------------------------------------------------------
// seeding assignments (the way the store builds them: draft first, then legal edges)
// ---------------------------------------------------------------------------

export interface SeedAssignment {
  who: Who;
  position: keyof WorshipFixture["positions"];
  team?: "band" | "choir";
  event?: "first" | "second";
  /** draft | requested (emailed) | requested-guardian | confirmed | declined */
  upTo: "draft" | "requested" | "guardian" | "confirmed" | "declined";
  reason?: "away" | "work" | "family" | "other";
  by?: Who;
}

/** One assignment in the state a spec needs. Returns its id. */
export async function seedAssignment(sql: Sql, fx: WorshipFixture, spec: SeedAssignment): Promise<string> {
  const id = randomUUID();
  const team = spec.team === "choir" ? fx.choir : fx.band;
  const event = spec.event === "second" ? fx.serviceId2 : fx.serviceId;
  const by = fx.people[spec.by ?? "leader"];
  const person = fx.people[spec.who];
  const steps = [
    `insert into worship_assignments (id, organization_id, event_id, group_id, position_id, person_id, assigned_by_person_id)
       values (${uuidLit(id)}, ${uuidLit(fx.orgId)}, ${uuidLit(event)}, ${uuidLit(team)}, ${uuidLit(fx.positions[spec.position])}, ${uuidLit(person)}, ${uuidLit(by)});`,
  ];
  if (spec.upTo !== "draft") {
    steps.push(
      `update worship_assignments set status = 'requested', sent_by_person_id = ${uuidLit(by)}, notice_outcome = ${spec.upTo === "guardian" ? "'guardian'" : "'emailed'"} where id = ${uuidLit(id)};`,
    );
  }
  if (spec.upTo === "confirmed") {
    steps.push(`update worship_assignments set status = 'confirmed', response_source = 'self', responded_by_person_id = ${uuidLit(person)} where id = ${uuidLit(id)};`);
  }
  if (spec.upTo === "declined") {
    steps.push(
      `update worship_assignments set status = 'declined', response_source = 'self', responded_by_person_id = ${uuidLit(person)}, decline_reason = ${lit(spec.reason ?? "away")} where id = ${uuidLit(id)};`,
    );
  }
  await inOrg(sql, fx.orgId, steps.join("\n"));
  return id;
}

export async function assignmentStatus(sql: Sql, id: string): Promise<{ status: string; decline_reason: string | null; response_source: string | null }> {
  return (await rows<{ status: string; decline_reason: string | null; response_source: string | null }>(
    sql`select status, decline_reason, response_source from worship_assignments where id = ${id}::uuid`,
  ))[0]!;
}

export async function queuedTo(sql: Sql, email: string): Promise<Array<{ template_key: string; subject: string; status: string }>> {
  return rows(sql`select template_key, subject, status from email_queue where lower(to_email) = ${email} order by created_at`);
}

export async function clearQueue(sql: Sql, emails: string[]): Promise<void> {
  await withDbRetry("clear worship fixture email queue", () => sql`delete from email_queue where lower(to_email) = any(${emails}::text[])`);
}

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------

export async function removeWorshipFixture(sql: Sql, fx: WorshipFixture): Promise<void> {
  assertFixtureSlug(fx.slug);
  await clearQueue(sql, Object.values(WORSHIP_EMAILS).filter((e): e is string => Boolean(e)));
  await removeOrg(sql, fx.orgId);
  await withDbRetry("delete worship fixture people", () => sql`delete from people where id::text like '00000000-0000-4085-8000-%'`);
  await withDbRetry("delete worship fixture users", () => sql`delete from users where email like 'e2e-worship-%@presby.invalid'`);
  const left = await withDbRetry("confirm worship org gone", async () => (await sql`select 1 from organizations where id = ${fx.orgId}::uuid`) as unknown[]);
  if (left.length > 0) throw new Error(`[worship-fixture] the fixture organization ${fx.slug} was not removed`);
}

// ---------------------------------------------------------------------------
// browser helpers
// ---------------------------------------------------------------------------

/** A fresh browser context signed in as `who`, landing on `path`. Phone-sized by default. */
export async function signedInContext(browser: Browser, who: Who, path: string, viewport = { width: 360, height: 740 }): Promise<BrowserContext> {
  const email = WORSHIP_EMAILS[who];
  if (!email) throw new Error(`[worship-fixture] ${who} does not sign in`);
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`/signin?callbackUrl=${encodeURIComponent(path)}`);
  await signInOnPage(page, email, WORSHIP_PASSWORD);
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 30_000 });
  await page.close();
  return context;
}

export async function newPhonePage(context: BrowserContext, width = 360, height = 740): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  return page;
}

/** The page is a real page: not wider than the viewport. */
export async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

/** Every visible button and link on the page is at least 44px tall (the phone thumb target), ignoring inline text links in prose. */
export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll("main button, main a[href], main select, main input:not([type=hidden])"))) {
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el as HTMLElement);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if ((el as HTMLElement).closest("[data-radix-popper-content-wrapper]")) continue;
      // The portal layout's own "Back to portal" link is not worship's to resize.
      if ((el.textContent ?? "").trim() === "Back to portal") continue;
      if (rect.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(rect.height)}px`);
    }
    return out;
  });
}

/** React has attached to the page (a button carries its React props), and any HydrationGate has opened. */
export async function waitHydrated(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some((b) => Object.keys(b).some((k) => k.startsWith("__reactProps$"))),
  );
  const gate = page.locator('fieldset[data-slot="hydration-gate"]').first();
  if ((await gate.count()) > 0) await expect(gate).not.toHaveAttribute("aria-busy", "true");
}
