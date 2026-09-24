import {
  pgTable,
  check,
  date,
  index,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./org";
import { users } from "../schema";

/**
 * The organization's THIRD axis: what happened to it, and whose council it
 * belongs to. D10 (lifecycle + successions) and D19/D26 (council affiliation
 * with history). DDL, RLS, triggers and functions live in
 * `drizzle/0044_presby_org_lifecycle.sql`; design rationale in
 * `docs/schema-design-2.md` sec 2b/sec 3 and
 * `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`.
 *
 * MUCH OF THIS FILE'S REAL ENFORCEMENT IS NOT EXPRESSIBLE IN DRIZZLE and
 * lives only in 0044 — stated here so a reader does not mistake the absence
 * for permission:
 *
 *   - `organization_affiliations_no_overlap`, a GIST EXCLUDE over
 *     `daterange(effective_from, effective_to, '[)')`. Drizzle has no
 *     EXCLUDE builder. It is the reason at most one open affiliation exists
 *     per (subject, relationship_type) — and, per F40, the reason the table's
 *     DML is revoked: a constraint is checked against ALL rows, not the
 *     RLS-visible subset, so it would otherwise be a cross-tenant existence
 *     oracle.
 *   - `presby_app` holds **SELECT ONLY** on `organization_affiliations`, and
 *     `presby_platform` (the `getPlatformDb()` connection) holds **SELECT +
 *     INSERT ONLY** — `createOrganization()`'s initial affiliation row is the
 *     entire reason the INSERT exists. `presby_transfer_affiliation()` is the
 *     one path that closes a row. Writing to this table any other way fails
 *     at runtime, not at `tsc`.
 *   - `organization_lifecycle_events` is APPEND-ONLY on EVERY connection:
 *     SELECT + INSERT to both roles, and `presby_freeze_lifecycle_event()`
 *     (a BEFORE UPDATE OR DELETE trigger mirroring `roll_actions_freeze`)
 *     refuses both on the owner path too, which no grant can bind. Correct a
 *     recorded act by recording another act — the `roll_actions` void
 *     precedent. There is deliberately NO such trigger on
 *     `organization_affiliations`: closing a row IS a legitimate UPDATE that
 *     `presby_transfer_affiliation()` performs, and the narrowed grant is the
 *     right instrument there.
 *   - The acting-council / parent-fits-child rule
 *     (`presby_assert_council_authority()`) is a BEFORE INSERT trigger on
 *     both tables. Both organization types live on `organizations`, so it
 *     cannot be a CHECK.
 *   - `organization_successions` is SELECT-ONLY for `presby_app` and
 *     select+insert for `presby_platform`, and carries a BEFORE INSERT
 *     event-scope trigger plus a BEFORE UPDATE OR DELETE freeze. Its absent
 *     `organization_id` protects READS through a join and protects no write
 *     at all (Phase 5 Finding 1) — see the table's own doc comment below.
 *   - `organization_successions` cardinality per event type is a DEFERRED
 *     CONSTRAINT TRIGGER — a `merged` event's second predecessor cannot
 *     exist at the moment the first row is inserted.
 *
 * `subject_org_id` / `parent_org_id` are PLAIN FKs to `organizations` and are
 * deliberately NOT composite tenant FKs (F2's structural exception,
 * docs/schema-design.md sec 17 — the same shape
 * `congregationOversight.aboutOrgId` already uses). Do not "fix" them.
 */

/**
 * The minuted acts of G-3.0301(a) (a presbytery organizing, receiving,
 * merging, dismissing or dissolving a congregation), G-3.0403(c) (a synod on
 * a presbytery) and G-3.0502(d) (the GA on a synod).
 *
 * `organizations.lifecycle_status` is a CACHE of the most recent row here,
 * maintained by trigger. It cannot answer a historical question; this table
 * is the record.
 */
export const organizationLifecycleEvents = pgTable(
  "organization_lifecycle_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // The ACTING council. Tenant scope for the standard tenant_isolation
    // policy.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    // The body acted upon — plain FK, about-org pattern.
    subjectOrgId: uuid("subject_org_id")
      .notNull()
      .references(() => organizations.id),
    // organized | received | merged | divided | dismissed | dissolved.
    // `divided` is our addition for congregations (G-3.0301(a) does not name
    // it); for presbyteries and synods it is verbatim polity, G-3.0403(c)
    // and G-3.0502(d).
    event: text("event").notNull(),
    effectiveOn: date("effective_on").notNull(),
    minuteReference: text("minute_reference").notNull(),
    // GA concurrence on a synod act (G-3.0502(e)) is DATA, never a second
    // actor: the actor rule stays exactly-one-level-above.
    concurrenceReference: text("concurrence_reference"),
    // The counterparty outside this system. Required for received/dismissed,
    // null otherwise (CHECK below).
    externalBody: text("external_body"),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
  },
  (t) => [
    unique("organization_lifecycle_events_id_org_key").on(
      t.id,
      t.organizationId,
    ),
    index("organization_lifecycle_events_org_idx").on(t.organizationId),
    index("organization_lifecycle_events_subject_idx").on(
      t.subjectOrgId,
      t.effectiveOn,
    ),
    check(
      "organization_lifecycle_events_event_allowed",
      sql`${t.event} in ('organized','received','merged','divided','dismissed','dissolved')`,
    ),
    // A presbytery cannot constitutionally dissolve itself. The stronger
    // one-level-above rule is the trigger's job; this is the cheap half.
    check(
      "organization_lifecycle_events_not_self",
      sql`${t.organizationId} <> ${t.subjectOrgId}`,
    ),
    check(
      "organization_lifecycle_events_external_body_shape",
      sql`(${t.event} in ('received','dismissed')) = (${t.externalBody} is not null)`,
    ),
  ],
);

/**
 * Pure topology: who became whom. Deliberately carries NO `organization_id`.
 * A single `merged_into_org_id` column on `organizations` cannot express 1→N
 * or N→1, which is D10's whole reason for a table.
 *
 * **The absent `organization_id` is a READ story only.** It was originally
 * described as "visibility follows the parent event's tenant policy through
 * a join" — true of a read that performs the join, and false of every write,
 * because a write joins nothing. QA demonstrated it (Phase 5 Finding 1): a
 * congregation could `INSERT` (and `DELETE`) succession rows naming a
 * lifecycle event its own `SELECT` returned zero rows for. `SELECT` stays
 * open to both roles on purpose — topology is public, the same call
 * `organizations` itself makes — and the write side is closed instead, per
 * Phase 2 Ruling 1 ("cross-council access to the three-axis tables is
 * function-mediated, never policy-mediated"):
 *
 *   - `presby_app` holds **SELECT ONLY**. The future
 *     `presby_record_lifecycle_event()` DEFINER function (the lifecycle-UI
 *     pipeline, one family with the deferred `presby_organize_congregation()`)
 *     is the only tenant-side writer there will be. Do not re-grant INSERT
 *     to give that pipeline a shortcut.
 *   - `presby_platform` holds select + insert — no UPDATE, no DELETE.
 *   - `presby_check_succession_event()` (BEFORE INSERT, `security definer`
 *     so it can see past the events table's own RLS) refuses an event id the
 *     current org does not own, raising the SAME uniform literal
 *     `presby_deny_lifecycle_change()` uses everywhere else, so "no such
 *     event" and "not your event" are byte-identical.
 *   - `presby_freeze_succession()` (BEFORE UPDATE OR DELETE) refuses both on
 *     EVERY connection, owner included — the `roll_actions` standard, the
 *     same pairing `organizationLifecycleEvents` above carries. A succession
 *     row is the content of a minuted act.
 *
 * Cardinality per event type (`merged` → ≥2 predecessors / 1 successor,
 * `divided` → 1 / ≥2, everything else → none) is the DEFERRED constraint
 * trigger in 0044, not expressible here. Deferred, so an in-progress `merged`
 * is legal until commit and a mistake is unwound by ROLLBACK — which is why
 * the freeze above costs no legitimate flow.
 */
export const organizationSuccessions = pgTable(
  "organization_successions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => organizationLifecycleEvents.id, {
        onDelete: "cascade",
      }),
    predecessorOrgId: uuid("predecessor_org_id")
      .notNull()
      .references(() => organizations.id),
    successorOrgId: uuid("successor_org_id")
      .notNull()
      .references(() => organizations.id),
  },
  (t) => [
    index("organization_successions_event_idx").on(t.eventId),
    /**
     * One event recording the same edge twice is one fact written twice
     * (F48/DECISION-140). It is NOT closing a cardinality-gaming bug:
     * `presby_check_succession_cardinality()` counts `count(distinct …)`, so
     * a duplicate edge could never have satisfied a `merged` event's
     * two-predecessor rule on its own.
     */
    unique("organization_successions_edge_unique").on(
      t.eventId,
      t.predecessorOrgId,
      t.successorOrgId,
    ),
    check(
      "organization_successions_not_self",
      sql`${t.predecessorOrgId} <> ${t.successorOrgId}`,
    ),
  ],
);

/**
 * Which council a body belongs to, WITH HISTORY (D19/D26).
 *
 * `organizations.parent_id` and `organizations.path` are a derived cache of
 * the currently-open row here, rebuilt only by
 * `presby_apply_affiliation_to_org_tree()`. Both columns are write-closed:
 * a direct `INSERT ... parent_id` or `UPDATE ... SET parent_id/path` is
 * rejected by trigger on BOTH connections.
 *
 * `effectiveFrom` is NULLABLE and null means UNBOUNDED BELOW ("predates our
 * records") — F41. A backfill with a bounded lower edge would make
 * `presby_org_affiliated(as_of => 1987)` false for an entire 41-year
 * archive. `authority = 'backfill'` plus the CHECK that `minuteReference`
 * may be null only then is what keeps an inferred relationship from ever
 * being mistaken for a minuted act.
 *
 * `organizationId` is the RECORDING council and is PROVENANCE: it never
 * changes, not even when another council closes the row. That is what the
 * four `closed*` columns are for.
 */
export const organizationAffiliations = pgTable(
  "organization_affiliations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    // ON DELETE CASCADE in 0044 — alone among the four organization FKs
    // here. See that file's comment; the only DELETE that reaches
    // `organizations` at all is a `deletableUntil`-stamped test fixture.
    subjectOrgId: uuid("subject_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    parentOrgId: uuid("parent_org_id")
      .notNull()
      .references(() => organizations.id),
    // member_congregation | member_presbytery | member_synod | member_nwc.
    // `member_nwc` exists because G-3.0301(b) enumerates new church
    // developments separately from congregations, and overloading
    // member_congregation would make "how many congregations does this
    // presbytery have" — a live per-capita question — return the wrong
    // number.
    relationshipType: text("relationship_type").notNull(),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    authority: text("authority").notNull().default("recorded"),
    reason: text("reason"),
    minuteReference: text("minute_reference"),
    concurrenceReference: text("concurrence_reference"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedByOrgId: uuid("closed_by_org_id").references(() => organizations.id),
    closedBy: uuid("closed_by").references(() => users.id),
    closedOn: date("closed_on"),
    closedMinuteReference: text("closed_minute_reference"),
  },
  (t) => [
    unique("organization_affiliations_id_org_key").on(t.id, t.organizationId),
    index("organization_affiliations_org_idx").on(t.organizationId),
    index("organization_affiliations_subject_idx").on(
      t.subjectOrgId,
      t.effectiveTo,
    ),
    index("organization_affiliations_parent_idx").on(t.parentOrgId),
    check(
      "organization_affiliations_relationship_type_allowed",
      sql`${t.relationshipType} in ('member_congregation','member_presbytery','member_synod','member_nwc')`,
    ),
    check(
      "organization_affiliations_authority_allowed",
      sql`${t.authority} in ('recorded','backfill')`,
    ),
    check(
      "organization_affiliations_backfill_minute_shape",
      sql`${t.authority} = 'backfill' or ${t.minuteReference} is not null`,
    ),
    /**
     * The empty-range loophole (F49/DECISION-140). `daterange(d, d, '[)')` is
     * a VALID, EMPTY range: it overlaps nothing, so the GIST EXCLUDE below
     * accepts any number of them. An affiliation that was never in effect for
     * a single day is not a fact about the church.
     * `presby_transfer_affiliation()` refuses a same-day close before it can
     * happen, so the uniform rejection literal fires rather than this
     * constraint's raw name.
     */
    check(
      "organization_affiliations_range_order",
      sql`${t.effectiveTo} is null or ${t.effectiveFrom} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    /**
     * A close is an ATTRIBUTABLE ACT: a row is open with no close attribution
     * at all, or closed with all of it (F49/DECISION-140).
     *
     * `closedBy` — the acting USER — is DELIBERATELY EXCLUDED. There is no
     * `app.current_user_id` GUC in this platform (Ruling A4), so
     * `presby_transfer_affiliation()` writes it null on every close; a
     * constraint demanding it would reject every close the system can
     * currently perform. It joins the tuple when the acting-user GUC lands.
     */
    check(
      "organization_affiliations_closed_shape",
      sql`(${t.effectiveTo} is null and ${t.closedByOrgId} is null and ${t.closedOn} is null and ${t.closedMinuteReference} is null)
          or (${t.effectiveTo} is not null and ${t.closedByOrgId} is not null and ${t.closedOn} is not null and ${t.closedMinuteReference} is not null)`,
    ),
    check(
      "organization_affiliations_not_self",
      sql`${t.subjectOrgId} <> ${t.parentOrgId}`,
    ),
    // organization_affiliations_no_overlap (GIST EXCLUDE) is in 0044 only —
    // Drizzle cannot express it. See this module's header.
    //
    // NOT EXPRESSIBLE HERE EITHER, and load-bearing (F49/DECISION-140):
    // `organization_affiliations_guard`, a BEFORE UPDATE OR DELETE trigger
    // that refuses both unless the transaction-local GUC
    // `presby.affiliation_trigger_active` is set — which only
    // `presby_transfer_affiliation()` (at its entry) and
    // `presby_guard_organizations_delete()` (after validating
    // `deletableUntil`, to pre-authorize the fixture-teardown cascade) ever
    // do. The grant revoke alone does NOT close this: PLATFORM_DATABASE_URL
    // connects as `neondb_owner`, which owns the table and holds every
    // privilege by ownership (F44). drizzle/0044's own earlier comment
    // arguing the opposite is superseded.
  ],
);

/**
 * The four `relationship_type` values, as a TypeScript union. Used by
 * `createOrganization()`'s optional hierarchical-provisioning input.
 */
export type RelationshipType =
  | "member_congregation"
  | "member_presbytery"
  | "member_synod"
  | "member_nwc";
