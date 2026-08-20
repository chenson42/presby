import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
  unique,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./org";
import { people } from "./people";
import { users, auditEvents } from "../schema";

/**
 * Support tickets and the baseline-member congregation-feedback on-ramp.
 * See docs/work-log/2026-08-20-support-tickets.md Phase 3 "Data Model",
 * DECISION-069 through DECISION-077.
 *
 * Two systems, deliberately kept apart:
 *
 *   tickets / ticket_messages / ticket_actions   role-gated (tickets.file),
 *                                                 read by both `withOrgContext()`
 *                                                 (a tenant role-holder) and
 *                                                 `getPlatformDb()` (platform
 *                                                 triage at /admin/tickets).
 *   congregation_feedback                        baseline — any current
 *                                                 member, no permission gate
 *                                                 beyond an active
 *                                                 relationship (DECISION-070).
 *                                                 A distinct table from
 *                                                 schema.ts's platform
 *                                                 `feedback` — that table's
 *                                                 own no-joins privacy
 *                                                 invariant stays untouched.
 *
 * All FOUR tables are FORCE RLS (DECISION-069/070) — the isolation argument
 * DECISION-067 already made for why a plain `organization_id` column on an
 * RLS-less table is unsafe for a tenant-scoped reader, acted on here because
 * this pipeline's Flow 2/Flow 0 need one now. RLS policies, grants, and the
 * `tickets.file` permission-catalog row live in
 * drizzle/0019_presby_ticket_support.sql, not here — this file is schema
 * only (docs/decisions.md DECISION-061's convention: db/domain/*.ts holds
 * pgTable definitions; query/business logic lives one level up).
 */

// ---------------------------------------------------------------------------
// tickets
// ---------------------------------------------------------------------------

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Plain FK (D1/DECISION-069 — people is global). fileTicket(): always
    // the caller, membership-verified by withOrgContext()'s gate.
    // promoteFeedbackToTicket(): the ORIGINAL feedback submitter, no
    // current-membership re-check (see the work-log's Edge Cases).
    submitterPersonId: uuid("submitter_person_id")
      .notNull()
      .references(() => people.id),
    subject: text("subject").notNull(), // 1-200 chars, app-validated
    // 'content' | 'config' | 'theme' | 'bug' | 'feature'. Kept as
    // change_class (not renamed to "category") for continuity with
    // docs/schema-design.md §15's already-committed sketch; the UI label
    // reads "Category". Submitter sets it; operator-correctable at triage,
    // never submitter-authoritative for anything downstream.
    changeClass: text("change_class").notNull(),
    // 'directory' | 'roll' | 'roles' | 'giving' | 'events' | 'website' |
    // 'account' | 'other'. DECISION-076: a controlled vocabulary, not free
    // text, so an automated first triage pass can branch on it directly.
    area: text("area").notNull(),
    // 'low' | 'normal' | 'high' | 'urgent'. DECISION-076: submitter-set
    // (required in FileTicketInput), operator-correctable, mirrors
    // change_class's submitter-suggests/operator-confirms pattern.
    priority: text("priority").notNull().default("normal"),
    // 'new' | 'triaged' | 'in_progress' | 'resolved' | 'declined'.
    status: text("status").notNull().default("new"),
    // Phase 2 Note 2, resolved: the only assignee kind post-Phase-1 is
    // "platform operator" — no assignee_kind discriminator column, just
    // this nullable, platform-only-written FK.
    assigneeUserId: uuid("assignee_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite-FK target for ticket_messages/ticket_actions (F2 proper).
    unique("tickets_id_org_key").on(t.id, t.organizationId),
    // Tenant list + filter.
    index("tickets_org_status_created_idx").on(
      t.organizationId,
      t.status,
      t.createdAt,
    ),
    // /admin/tickets cross-org queue.
    index("tickets_status_created_idx").on(t.status, t.createdAt),
    check(
      "tickets_change_class_allowed",
      sql`${t.changeClass} in ('content','config','theme','bug','feature')`,
    ),
    check(
      "tickets_area_allowed",
      sql`${t.area} in ('directory','roll','roles','giving','events','website','account','other')`,
    ),
    check(
      "tickets_priority_allowed",
      sql`${t.priority} in ('low','normal','high','urgent')`,
    ),
    check(
      "tickets_status_allowed",
      sql`${t.status} in ('new','triaged','in_progress','resolved','declined')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// ticket_messages
// ---------------------------------------------------------------------------

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    // 'submitter' | 'operator'.
    authorKind: text("author_kind").notNull(),
    // Set iff authorKind = 'submitter'.
    authorPersonId: uuid("author_person_id").references(() => people.id),
    // Set iff authorKind = 'operator' — a platform operator has no people row.
    authorUserId: uuid("author_user_id").references(() => users.id),
    body: text("body").notNull(), // 1-5000 chars, app-validated
    attachmentAssetKey: uuid("attachment_asset_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ticket_messages_org_ticket_created_idx").on(
      t.organizationId,
      t.ticketId,
      t.createdAt,
    ),
    check(
      "ticket_messages_author_kind_allowed",
      sql`${t.authorKind} in ('submitter','operator')`,
    ),
    // The compound CHECK (not just num_nonnulls) is deliberate — num_nonnulls
    // alone would accept author_kind = 'submitter' paired with a populated
    // author_user_id, a mislabeled row that's structurally valid but a lie.
    // Same discriminated-identity shape audit_events.actor_kind uses.
    check(
      "ticket_messages_author_identity_check",
      sql`num_nonnulls(${t.authorPersonId}, ${t.authorUserId}) = 1
        and (
          (${t.authorKind} = 'submitter' and ${t.authorPersonId} is not null and ${t.authorUserId} is null)
          or
          (${t.authorKind} = 'operator'  and ${t.authorUserId}  is not null and ${t.authorPersonId} is null)
        )`,
    ),
    foreignKey({
      columns: [t.ticketId, t.organizationId],
      foreignColumns: [tickets.id, tickets.organizationId],
      name: "ticket_messages_ticket_fk",
    }),
    // Composite FK to blob_assets(id, organization_id) is enforced in the
    // migration only — declaring it here as a Drizzle foreignKey() would
    // require this file to import assets.ts AND assets.ts to import this
    // file's tickets export back, the same circular-module-dependency
    // problem assets.ts's own header documents for organization_brands.
  ],
);

// ---------------------------------------------------------------------------
// ticket_actions
// ---------------------------------------------------------------------------

export const ticketActions = pgTable(
  "ticket_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    // 'created' | 'promoted_from_feedback' | 'status_changed' |
    // 'reclassified' | 'area_changed' | 'priority_changed' | 'assigned'.
    action: text("action").notNull(),
    // Plain labels the calling action already has in hand (e.g. the
    // assignee's email) — not a second set of nullable FK columns per
    // action kind. This table is a generic timeline, not a
    // referentially-precise ledger.
    fromValue: text("from_value"),
    toValue: text("to_value"),
    // Always a platform operator; null on the 'created'/
    // 'promoted_from_feedback' rows fileTicket()/promoteFeedbackToTicket()
    // write (the actor there is a tenant person, already recorded
    // elsewhere on the ticket/feedback row).
    actorUserId: uuid("actor_user_id").references(() => users.id),
    // DECISION-075: ships always-null in this pipeline. recordAudit()
    // returns Promise<void>, not the inserted row's id, so there is
    // nothing to backfill this column with today — schema headroom for a
    // future recordAudit() signature change, out of scope here. The
    // working correlation direction is audit_events.metadata.ticketId
    // (audit -> ticket), not this column (ticket -> audit).
    auditEventId: uuid("audit_event_id").references(() => auditEvents.id),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ticket_actions_org_ticket_applied_idx").on(
      t.organizationId,
      t.ticketId,
      t.appliedAt,
    ),
    check(
      "ticket_actions_action_allowed",
      sql`${t.action} in ('created','promoted_from_feedback','status_changed','reclassified','area_changed','priority_changed','assigned')`,
    ),
    foreignKey({
      columns: [t.ticketId, t.organizationId],
      foreignColumns: [tickets.id, tickets.organizationId],
      name: "ticket_actions_ticket_fk",
    }),
  ],
);

// ---------------------------------------------------------------------------
// congregation_feedback (DECISION-070's standalone table)
// ---------------------------------------------------------------------------

export const congregationFeedback = pgTable(
  "congregation_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Plain FK; always the caller, membership-verified by
    // withOrgContext()'s own gate. No permission gate on submitFeedback() —
    // any current member.
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    body: text("body").notNull(), // 1-2000 chars, app-validated
    // 'new' | 'promoted' | 'dismissed'.
    status: text("status").notNull().default("new"),
    promotedToTicketId: uuid("promoted_to_ticket_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The review queue.
    index("congregation_feedback_org_status_created_idx").on(
      t.organizationId,
      t.status,
      t.createdAt,
    ),
    check(
      "congregation_feedback_status_allowed",
      sql`${t.status} in ('new','promoted','dismissed')`,
    ),
    foreignKey({
      columns: [t.promotedToTicketId, t.organizationId],
      foreignColumns: [tickets.id, tickets.organizationId],
      name: "congregation_feedback_promoted_ticket_fk",
    }),
  ],
);
