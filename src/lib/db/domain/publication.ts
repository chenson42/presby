import {
  pgTable,
  check,
  foreignKey,
  index,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./org";
import { statisticalReturns } from "./returns";
import { users } from "../schema";

/**
 * The publication EVENT (D20). DDL, RLS, the freeze trigger and the two
 * SECURITY DEFINER read/write functions live in
 * `drizzle/0047_presby_publications.sql`; design rationale in
 * `docs/schema-design-2.md` sec 5 and
 * `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`.
 *
 * ITS OWN MODULE, DELIBERATELY (Phase 2 Ruling 9 / DECISION-138). D20 defines
 * publication as generic over `recordClass`, and this table is the schema
 * expression of the platform's second invariant — "access flows up by
 * publication, never down by inheritance." Parking it in a statistics module
 * would guarantee that the day a second record class lands, either the table
 * moves file (churn in `/developer` and every import) or the module name
 * lies. `assets.ts` (91 lines) and `events.ts` (104) are the precedent for a
 * small module that earns its name.
 *
 * MUCH OF THE REAL ENFORCEMENT IS NOT EXPRESSIBLE IN DRIZZLE and lives only
 * in `0047`:
 *
 *   - `publications_guard` (BEFORE INSERT, executing the shared
 *     `presby_guard_publication_write()` defined in `drizzle/0046` section
 *     4b, F55/DECISION-141) refuses any INSERT unless the transaction-local
 *     GUC `presby.publication_write_active` is set. Creation guarded as
 *     strongly as mutation: the freeze below made a publication immutable
 *     once written, but nothing made WRITING one a sanctioned act, and the
 *     revoked grant binds nobody on `getPlatformDb()` (F44). Armed inside
 *     `presby_publish_sasr_snapshot()`, `drizzle/0047`'s own backfill and
 *     `scripts/seed-dev.sql` — one GUC for the whole
 *     return → publication → projection act.
 *   - `publications_freeze` (BEFORE UPDATE OR DELETE) refuses DELETE
 *     outright and permits EXACTLY ONE UPDATE transition: a row whose three
 *     withdrawal columns are all null may have them set together
 *     (`withdrawnAt` required), with nothing else on the row moving in that
 *     same statement, AND the transaction must be inside the sanctioned
 *     withdrawal writer (`presby.withdrawal_write_active`, a SEPARATE GUC —
 *     F56/DECISION-141). A withdrawal is not reversible, re-datable or
 *     re-minutable — correcting one means publishing again. It fires on EVERY
 *     connection, including the owner: `presby_app` and `presby_platform`
 *     hold `select, insert` only, but a grant does not bind `neondb_owner`,
 *     which `PLATFORM_DATABASE_URL` actually connects as (Ruling A5's batch-B
 *     finding). `BYPASSRLS` exempts a role from RLS policies, never from
 *     triggers.
 *   - WITHDRAWAL CARRIES PROVENANCE, because it is itself a minuted act:
 *     `withdrawnAt`, `withdrawnBy` and `withdrawnMinuteReference` are
 *     DECISION-135's affiliation-close shape (`closedByOrgId` / `closedBy` /
 *     `closedOn` / `closedMinuteReference`) applied to a publication, for the
 *     same reason — a close with no attribution is an unattributable mutation
 *     of an otherwise provenanced record.
 *   - `publications_supersession` (BEFORE INSERT, SECURITY DEFINER) makes
 *     supersession a real CHAIN: the predecessor named by `supersedesId` must
 *     share `organizationId`, `recipientOrgId`, `recordClass` and — for
 *     `statistical_return` — the artifact's `reportYear`. Paired with the
 *     partial unique index on `supersedesId`, which forbids forks.
 *   - `presby_app` and `presby_platform` hold `SELECT` ONLY as of
 *     F51/DECISION-140 — INSERT was revoked too, since
 *     `presby_publish_sasr_snapshot()` (SECURITY DEFINER) is the only writer.
 *   - There is NO withdrawal path AT ALL today, on any connection
 *     (F56/DECISION-141, 2026-09-24). Nothing sets
 *     `presby.withdrawal_write_active`, so both halves of the pair — this
 *     table's withdrawal triple and `congregationStatistics.withdrawnAt` —
 *     are unreachable until the writer ships. That is deliberate: before the
 *     conjunct, each table permitted its own half INDEPENDENTLY, so a raw
 *     connection could withdraw the publication and leave the recipient's
 *     projection silently disagreeing with it. The intended writer is a
 *     future `presby_withdraw_publication()` SECURITY DEFINER function in the
 *     publish-UI pipeline, in the same confused-deputy shape as
 *     `presby_transfer_affiliation()` — no caller-supplied council id, the
 *     actor is `presby_current_org()` — which arms the GUC once and performs
 *     both UPDATEs in one transaction. It is NOT built here.
 *   - The RECIPIENT cannot read this table under the tenant policy —
 *     `organizationId` is the SOURCE council. That is the point: the
 *     recipient reads through `presby_list_published_returns_to_me()`
 *     (SECURITY DEFINER), so the publication EVENT grants the read rather
 *     than the tenant policy (Ruling 5 / DECISION-135). Not a third named
 *     cross-org RLS policy — `docs/schema-design.md` sec 17's
 *     two-named-policies rule is untouched.
 *   - `presby_publish_sasr_snapshot()` is the only writer today, and it
 *     DERIVES both `recipientOrgId` (from
 *     `presby_affiliation_parent_as_of()`, never `organizations.parent_id`)
 *     and `supersedesId` (the caller's most recent non-withdrawn publication
 *     for the year). Neither is a parameter, so neither can be spoofed.
 *
 * `organizationId` and `recipientOrgId` are PLAIN FKs to `organizations`
 * (F2's structural exception, `docs/schema-design.md` sec 17). `artifactId`
 * is NOT: it is composite to `statistical_returns (id, organization_id)`,
 * because `artifactId` alone would let a publication claim an artifact
 * recorded under a different organization.
 */
export const publications = pgTable(
  "publications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The SOURCE council — the body that published. Tenant scope. */
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /**
     * The council the artifact was published TO: the presbytery of current
     * membership at `publishedAt` (D19 / G-3.0108(a)), resolved ONCE from
     * `presby_affiliation_parent_as_of()` and never re-derived — a later
     * redistricting cannot change who received an already-filed return.
     */
    recipientOrgId: uuid("recipient_org_id")
      .notNull()
      .references(() => organizations.id),
    /** `'statistical_return'` today; generic by design (D20). */
    recordClass: text("record_class").notNull().default("statistical_return"),
    artifactId: uuid("artifact_id").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * The publication this one corrects. Derived, never caller-supplied.
     *
     * Self-referential AND composite since B-M3 (drizzle/0048 section 7) —
     * see the `publications_supersedes_fk` entry below. The single-column
     * form it replaces let a correction chain cross councils (F2).
     */
    supersedesId: uuid("supersedes_id"),
    /**
     * Null everywhere today: there is no acting-USER context in this platform
     * (only `app.current_org_id` exists as a GUC — Ruling A4), and accepting
     * a user id as a function parameter would be the caller-supplied identity
     * claim the publish function's whole shape refuses. It fills in when the
     * `app.current_user_id` GUC lands.
     */
    authorizedBy: uuid("authorized_by").references(() => users.id),
    /**
     * The PUBLISHING council's own minute authorizing publication (a
     * congregation's session minute for an SASR). NOT the same fact as
     * `congregationStatistics.minuteReference`, which is the presbytery's
     * data-entry minute on a `presbytery_entered` row — collapsing them is
     * the one-column-two-facts error this design refuses everywhere else
     * (F39).
     */
    minuteReference: text("minute_reference"),
    /**
     * Withdrawal is a column, not a delete (D20), and it is a MINUTED ACT:
     * these three move together, exactly once, on a row that is not already
     * withdrawn.
     *
     * OPTION A THROUGHOUT (F52/DECISION-140). A withdrawn publication STILL
     * APPEARS in `presby_list_published_returns_to_me()`, carrying the whole
     * triple, and `congregationStatistics` gains its own `withdrawnAt` so the
     * recipient's projection is MARKED rather than either vanishing or
     * silently counting. The recipient retains what it received — the same
     * permanence rule that voids a roll action rather than deleting it, and
     * G-3.0107's "a ceased council's records become the property of the next
     * higher council". Every consumer computing CURRENT totals filters
     * `withdrawnAt is null` itself.
     */
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    /**
     * Null on every row today: `presby_app` holds no UPDATE grant, so
     * withdrawal is an owner-only act until `presby_withdraw_publication()`
     * ships — and there is still no acting-USER context in this platform
     * (Ruling A4: only `app.current_org_id` exists as a GUC).
     */
    withdrawnBy: uuid("withdrawn_by").references(() => users.id),
    /**
     * The WITHDRAWING council's own minute. Distinct from `minuteReference`,
     * which authorized the publication — one column, one fact.
     */
    withdrawnMinuteReference: text("withdrawn_minute_reference"),
  },
  (t) => [
    unique("publications_id_org_key").on(t.id, t.organizationId),
    /**
     * The RECIPIENT half of the projection's composite key (F51/
     * DECISION-140). `congregationStatistics` carries a second composite FK,
     * `(publicationId, organizationId) -> publications (id, recipientOrgId)`,
     * alongside the source-end `(publicationId, aboutOrgId) -> publications
     * (id, organizationId)`. Both pin to the same `publications.id`, so
     * together they force BOTH ends of the relationship on one row — closing
     * "Presbytery B holds a projection of a publication whose real recipient
     * was Presbytery A."
     */
    unique("publications_id_recipient_key").on(t.id, t.recipientOrgId),
    foreignKey({
      name: "publications_artifact_fk",
      columns: [t.artifactId, t.organizationId],
      foreignColumns: [statisticalReturns.id, statisticalReturns.organizationId],
    }),
    /**
     * Composite Tenant Keys (F2 / B-M3). A correction must supersede a
     * publication issued by the SAME publishing council. No new index:
     * publications_supersedes_idx and publications_supersedes_once_idx below
     * both already lead with supersedesId. DDL: drizzle/0048 section 7.
     */
    foreignKey({
      name: "publications_supersedes_fk",
      columns: [t.supersedesId, t.organizationId],
      // Self-reference via `t`, not `publications` — see events.ts's
      // events_parent_fk for why (TS7022 circularity).
      foreignColumns: [t.id, t.organizationId],
    }),
    index("publications_recipient_idx").on(t.recipientOrgId),
    index("publications_org_artifact_idx").on(t.organizationId, t.artifactId),
    index("publications_supersedes_idx").on(t.supersedesId),
    /**
     * Supersession may not FORK (F51/DECISION-140): two publications naming
     * the same predecessor make "which one is current" unanswerable, which is
     * the one question the chain exists to answer. Partial, because null is
     * the overwhelmingly common value.
     */
    uniqueIndex("publications_supersedes_once_idx")
      .on(t.supersedesId)
      .where(sql`${t.supersedesId} is not null`),
    check(
      "publications_record_class_allowed",
      sql`${t.recordClass} in ('statistical_return')`,
    ),
    check(
      "publications_not_self_superseding",
      sql`${t.supersedesId} is null or ${t.supersedesId} <> ${t.id}`,
    ),
    /**
     * All three withdrawal columns are null, or all three are set. The
     * trigger enforces the TRANSITION; this enforces the resulting SHAPE,
     * including for the owner's own writes — CHECK constraints bind the table
     * owner, unlike RLS policies and unlike grants, so F44 does not exempt it.
     *
     * CORRECTED (F51/DECISION-140). It used to read `withdrawnAt is not null
     * or (withdrawnBy is null and withdrawnMinuteReference is null)`, which is
     * true whenever `withdrawnAt` is set whatever the other two hold —
     * permitting exactly the unattributable withdrawal its own column comment
     * says is impossible.
     */
    check(
      "publications_withdrawal_shape",
      sql`(${t.withdrawnAt} is null and ${t.withdrawnBy} is null and ${t.withdrawnMinuteReference} is null)
          or (${t.withdrawnAt} is not null and ${t.withdrawnBy} is not null and ${t.withdrawnMinuteReference} is not null)`,
    ),
    // NOT EXPRESSIBLE HERE (F51/DECISION-140): `publications_supersession`, a
    // SECURITY DEFINER BEFORE INSERT trigger requiring the predecessor named
    // by `supersedesId` to share `organizationId`, `recipientOrgId`,
    // `recordClass` and — for `statistical_return` — the artifact's
    // `reportYear`. DEFINER because `publications` is FORCE RLS: an
    // invoker-mode check's answer would depend on the caller's policy view
    // rather than on the fact (F26). One uniform, cause-blind literal, so the
    // trigger is not a cross-tenant existence oracle (F40).
  ],
);
