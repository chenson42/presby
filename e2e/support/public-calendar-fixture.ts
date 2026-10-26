/**
 * public-calendar-fixture.ts - setup and teardown for the public events
 * calendar specs (docs/work-log/2026-10-25-public-events-calendar.md, Phase 3
 * T19/T20; DECISION-157: a spec creates only its own rows and removes them
 * itself). EVENTS, TYPES, THE TOGGLE, A SITE AND ITS BUNDLE ONLY - no people, so
 * no person-id range is needed (the editor flow reuses the existing e2e-alpha
 * clerk through calendar-fixture.ts).
 *
 * TWO WORLDS
 *   world   a throwaway congregation (`e2e-pubcal-<stamp>`, `deletable_until`)
 *           with a LIVE site whose bundle places the `eventsCalendar` live slot
 *           on `/` and `/events`, a fallback type and two named types, and one
 *           of every event the definer must decide. The Public events calendar
 *           toggle is left OFF (no row); specs turn it on and off.
 *   alpha   e2e-alpha (the existing congregation the editor specs sign in to)
 *           gains a live site with the same bundle and the toggle row, for the
 *           editor flow ("tick, save, appears; untick, gone"). Everything is
 *           removed by id/prefix in teardown and confirmed by SELECT.
 *
 * DATES. Relative to the ORGANIZATION'S day in America/New_York (the default
 * zone: neither org has an organization_settings row), read from Postgres, so
 * the fixtures cannot land in the wrong month on the last evening of one.
 * The "today" event sits at 23:00 on today's date, so it is never an "earlier"
 * day and is in the opening month's HTML whatever day the spec runs. The rest
 * sit in NEXT month (always inside the 14-month window).
 */

import { createHash } from "node:crypto";
import type { Sql } from "./db";
import { CAL_ORG } from "./calendar-fixture";

export const PUBCAL_TOGGLE_KEY = "org_portal.public_calendar";
export const MEMBER_CAL_TOGGLE_KEY = "org_portal.calendar";

export const PUBCAL_TITLES = {
  today: "E2E Today gathering",
  listed: "E2E Listed worship",
  second: "E2E Second listed gathering",
  membersOnly: "E2E Members-only session meeting",
  cancelled: "E2E Cancelled listed supper",
  unlisted: "E2E Open but not marked for the website",
  /** 200 unbroken characters: the 360px overflow probe. */
  long: `E2E${"W".repeat(197)}`,
} as const;

export const PUBCAL_TEXT = {
  description: "Bring a hymnal and a friend.",
  location: "Sanctuary",
  /** The "today" event carries one, so its native <details> has a body to open before any script runs. */
  todayLocation: "Chapel",
  typeWorship: "E2E Worship",
  typeStudy: "E2E Study",
} as const;

export interface PublicCalendarWorld {
  orgId: string;
  slug: string;
  name: string;
}

function assertSlug(slug: string, prefix: string) {
  if (!slug.startsWith(prefix)) throw new Error(`[public-calendar-fixture] refusing to touch non-fixture slug "${slug}"`);
}

/** The bundle: the calendar slot on `/` and `/events`, under a hero. */
export function calendarBundle(heading: string): { pages: unknown[] } {
  const blocks = (title: string) => [
    { type: "hero", props: { heading: title } },
    { type: "prose", props: { body: "What is coming up." } },
    { type: "liveSlot", props: { slot: "eventsCalendar" } },
  ];
  return {
    pages: [
      { path: "/", frontMatter: { title: heading, navLabel: "Home" }, mdxAst: { blocks: blocks(heading) } },
      { path: "/events", frontMatter: { title: `${heading} events`, navLabel: "Events" }, mdxAst: { blocks: blocks(`${heading} events`) } },
    ],
  };
}

async function insertBundle(sql: Sql, orgId: string, bundle: { pages: unknown[] }): Promise<string> {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, pages: bundle.pages, imageKeys: {} }), "utf-8");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const rows = (await sql`
    insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes)
    values (${orgId}::uuid, ${hash}, 'application/json', ${bytes.byteLength}, decode(${bytes.toString("hex")}, 'hex'))
    on conflict (organization_id, content_hash) do update set content_type = excluded.content_type
    returning id`) as { id: string }[];
  return rows[0]!.id;
}

/** Turns the org's public-calendar toggle on/off (`null` removes the row: the default, off). */
export async function setPublicCalendarToggle(sql: Sql, orgId: string, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await sql`delete from organization_feature_toggles where organization_id = ${orgId}::uuid and feature_key = ${PUBCAL_TOGGLE_KEY}`;
    return;
  }
  await sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${orgId}::uuid, ${PUBCAL_TOGGLE_KEY}, ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = ${enabled}`;
}

/** The member-calendar toggle row of a THROWAWAY org (e2e-alpha's is the calendar fixture's). */
export async function setMemberCalendarToggle(sql: Sql, orgId: string, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await sql`delete from organization_feature_toggles where organization_id = ${orgId}::uuid and feature_key = ${MEMBER_CAL_TOGGLE_KEY}`;
    return;
  }
  await sql`
    insert into organization_feature_toggles (organization_id, feature_key, enabled)
    values (${orgId}::uuid, ${MEMBER_CAL_TOGGLE_KEY}, ${enabled})
    on conflict (organization_id, feature_key) do update set enabled = ${enabled}`;
}

/** The org's `worship` category row: `true`/`false` writes it, `null` removes it (a missing row is ON). */
export async function setWorshipCategory(sql: Sql, orgId: string, enabled: boolean | null): Promise<void> {
  await sql`delete from organization_feature_categories where organization_id = ${orgId}::uuid and category = 'worship'`;
  if (enabled !== null) {
    await sql`
      insert into organization_feature_categories (organization_id, category, enabled)
      values (${orgId}::uuid, 'worship', ${enabled})`;
  }
}

export async function setSiteStatus(sql: Sql, orgId: string, status: "provisioning" | "live" | "suspended"): Promise<void> {
  await sql`update organization_sites set status = ${status} where organization_id = ${orgId}::uuid`;
}

/** Sets website_listed on one fixture event by title (and clears it when `false`). */
export async function setListed(sql: Sql, orgId: string, title: string, listed: boolean): Promise<void> {
  await sql`update events set website_listed = ${listed} where organization_id = ${orgId}::uuid and title = ${title}`;
}

export async function listedFlag(sql: Sql, orgId: string, title: string): Promise<boolean | null> {
  const rows = (await sql`select website_listed from events where organization_id = ${orgId}::uuid and title = ${title}`) as { website_listed: boolean }[];
  return rows[0] ? rows[0].website_listed : null;
}

/** Inserts the world's events (relative to the org's day). Types are inserted first and looked up by name. */
async function insertWorldEvents(sql: Sql, orgId: string): Promise<void> {
  await sql`
    insert into event_types (organization_id, name, color, icon, sort_order, is_fallback)
    values (${orgId}::uuid, 'General', 'neutral', 'CalendarDays', 0, true)`;
  await sql`
    insert into event_types (organization_id, name, color, icon, sort_order)
    values (${orgId}::uuid, ${PUBCAL_TEXT.typeWorship}, 'teal', 'Church', 10),
           (${orgId}::uuid, ${PUBCAL_TEXT.typeStudy}, 'sky', 'BookOpen', 20)`;

  await sql`
    with t as (
      select date_trunc('day', now() at time zone 'America/New_York') as today,
             date_trunc('month', now() at time zone 'America/New_York') + interval '1 month' as nxt
    )
    insert into events (organization_id, title, description, location, starts_at, ends_at,
                        is_public, website_listed, cancelled_at, event_type_id)
    select ${orgId}::uuid, v.title, v.description, v.location, v.starts, v.ends, v.is_public, v.listed,
           case when v.cancelled then now() end,
           (select id from event_types where organization_id = ${orgId}::uuid and name = v.type_name)
      from t, (values
        -- today, 23:00: in the opening month's HTML on any day, never an "earlier" day
        (${PUBCAL_TITLES.today}, null, ${PUBCAL_TEXT.todayLocation}, (select today + interval '23 hours' from t), null::timestamp, true, true, false, null::text),
        (${PUBCAL_TITLES.listed}, ${PUBCAL_TEXT.description}, ${PUBCAL_TEXT.location},
           (select nxt + interval '9 days 10 hours' from t), (select nxt + interval '9 days 11 hours 30 minutes' from t),
           true, true, false, ${PUBCAL_TEXT.typeWorship}),
        (${PUBCAL_TITLES.second}, null, null, (select nxt + interval '10 days 18 hours' from t), null::timestamp, true, true, false, ${PUBCAL_TEXT.typeStudy}),
        (${PUBCAL_TITLES.long}, null, null, (select nxt + interval '12 days 9 hours' from t), null::timestamp, true, true, false, ${PUBCAL_TEXT.typeStudy}),
        (${PUBCAL_TITLES.membersOnly}, 'Session business', 'Library', (select nxt + interval '11 days 19 hours' from t), null::timestamp, false, false, false, null::text),
        (${PUBCAL_TITLES.cancelled}, null, null, (select nxt + interval '13 days 18 hours' from t), null::timestamp, true, true, true, null::text),
        (${PUBCAL_TITLES.unlisted}, null, null, (select nxt + interval '14 days 18 hours' from t), null::timestamp, true, false, false, null::text)
      ) as v(title, description, location, starts, ends, is_public, listed, cancelled, type_name)`;
}

/** The throwaway world. The public-calendar toggle is OFF (no row); the site is live with the calendar bundle. */
export async function setupPublicCalendarWorld(sql: Sql, stamp = Date.now()): Promise<PublicCalendarWorld> {
  const slug = `e2e-pubcal-${stamp}`;
  const name = "E2E Public Calendar Church";
  // Unique per run: audit rows and similar are append-only and keep a run's ids forever.
  const orgId = `e2e94001-0000-4000-8000-${String(stamp % 1_000_000_000_000).padStart(12, "0")}`;
  await removeStalePublicCalendarWorlds(sql);
  await sql`
    insert into organizations (id, organization_type, name, slug, path, platform_status, deletable_until)
    values (${orgId}::uuid, 'congregation', ${name}, ${slug}, ${slug.replace(/-/g, "_")}, 'managed', now() + interval '3 hours')`;
  const blobId = await insertBundle(sql, orgId, calendarBundle(name));
  await sql`
    insert into organization_sites (organization_id, repo, status, content_bundle_key, last_ingested_at)
    values (${orgId}::uuid, ${`org/site-${slug}`}, 'live', ${blobId}::uuid, now())`;
  await insertWorldEvents(sql, orgId);
  return { orgId, slug, name };
}

export async function removePublicCalendarWorld(sql: Sql, world: { orgId: string; slug: string }): Promise<void> {
  assertSlug(world.slug, "e2e-pubcal-");
  await sql`delete from organization_sites where organization_id = ${world.orgId}::uuid`;
  await sql`delete from blob_assets where organization_id = ${world.orgId}::uuid`;
  await sql`delete from organizations where id = ${world.orgId}::uuid`;
  const left = (await sql`select 1 from organizations where id = ${world.orgId}::uuid`) as unknown[];
  if (left.length > 0) throw new Error(`[public-calendar-fixture] the fixture organization ${world.slug} was not removed`);
}

/** Removes worlds a crashed earlier run left behind (slug prefix `e2e-pubcal-` only). */
export async function removeStalePublicCalendarWorlds(sql: Sql): Promise<void> {
  const stale = (await sql`select id, slug from organizations where slug like 'e2e-pubcal-%'`) as { id: string; slug: string }[];
  for (const s of stale) await removePublicCalendarWorld(sql, { orgId: s.id, slug: s.slug });
}

// ---------------------------------------------------------------------------
// e2e-alpha: a live site and the toggle, for the editor flow
// ---------------------------------------------------------------------------

export interface AlphaSiteState {
  blobId: string;
  priorToggle: boolean | null;
}

export const ALPHA_EVENT_PREFIX = "E2E Editor flow";

/** Gives e2e-alpha a live site (if it has none) carrying the calendar bundle, and the toggle ON. */
export async function setupAlphaSite(sql: Sql): Promise<AlphaSiteState> {
  const org = CAL_ORG.id;
  const existing = (await sql`select 1 from organization_sites where organization_id = ${org}::uuid`) as unknown[];
  if (existing.length > 0) throw new Error("[public-calendar-fixture] e2e-alpha already has a site row; refusing to overwrite it");
  const prior = (await sql`
    select enabled from organization_feature_toggles where organization_id = ${org}::uuid and feature_key = ${PUBCAL_TOGGLE_KEY}`) as { enabled: boolean }[];
  const blobId = await insertBundle(sql, org, calendarBundle(CAL_ORG.name));
  await sql`
    insert into organization_sites (organization_id, repo, status, content_bundle_key, last_ingested_at)
    values (${org}::uuid, 'org/site-e2e-alpha-pubcal', 'live', ${blobId}::uuid, now())`;
  await setPublicCalendarToggle(sql, org, true);
  return { blobId, priorToggle: prior[0]?.enabled ?? null };
}

export async function removeAlphaSite(sql: Sql, state: AlphaSiteState | null): Promise<void> {
  const org = CAL_ORG.id;
  // Events and audit rows the editor flow created (by title prefix; audit rows are append-only evidence and stay).
  await sql`delete from events where organization_id = ${org}::uuid and title like ${ALPHA_EVENT_PREFIX + "%"}`;
  await sql`delete from organization_sites where organization_id = ${org}::uuid and repo = 'org/site-e2e-alpha-pubcal'`;
  if (state) {
    await sql`delete from blob_assets where id = ${state.blobId}::uuid`;
    await setPublicCalendarToggle(sql, org, state.priorToggle);
  }
  const left = (await sql`select 1 from organization_sites where organization_id = ${org}::uuid`) as unknown[];
  if (left.length > 0) throw new Error("[public-calendar-fixture] e2e-alpha's site row was not removed");
}

// ---------------------------------------------------------------------------
// the org's calendar, as Postgres reads it (America/New_York, the default zone)
// ---------------------------------------------------------------------------

export interface OrgMonths {
  /** 'November 2026', the label the calendar's heading shows. */
  currentLabel: string;
  nextLabel: string;
  /** 'YYYY-MM' */
  nextKey: string;
}

export async function orgMonths(sql: Sql): Promise<OrgMonths> {
  const rows = (await sql`
    select to_char(m, 'FMMonth YYYY') as current_label,
           to_char(m + interval '1 month', 'FMMonth YYYY') as next_label,
           to_char(m + interval '1 month', 'YYYY-MM') as next_key
      from (select date_trunc('month', now() at time zone 'America/New_York') as m) t`) as {
    current_label: string;
    next_label: string;
    next_key: string;
  }[];
  return { currentLabel: rows[0]!.current_label, nextLabel: rows[0]!.next_label, nextKey: rows[0]!.next_key };
}
