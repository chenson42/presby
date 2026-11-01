import { sql } from "drizzle-orm";
import { pgTable, text, uuid, timestamp, index, check } from "drizzle-orm/pg-core";
import { users } from "../schema";

/**
 * The /help/contact drop box (User help Increment 2,
 * docs/work-log/2026-10-31-help-contact.md, Phase 2 CA1 and Phase 3 "Data
 * Model"; DECISION-300, DECISION-301, DECISION-303).
 *
 * One row per message an anonymous visitor sends to the PresbyPortal team.
 * Platform axis: no organization, no person, no sender user id, and never an
 * IP address or a user agent (FC6, C2, C4). The typed email authenticates
 * nothing and no system path ever mails it.
 *
 * This file is for TypeScript's benefit. The ground truth is
 * drizzle/0083_presby_help_contact.sql, and Drizzle Kit emits none of what
 * makes this table safe:
 *
 *   - FORCE ROW LEVEL SECURITY with NO policy, a deliberate deny-all (0083
 *     section 4). presby_app, presby_platform and PUBLIC hold NO table
 *     privilege at all.
 *   - The ONE write path is `presby_submit_help_contact(text, text, text,
 *     text, text)` (0083 section 5): SECURITY DEFINER, EXECUTE to presby_app
 *     only, returning only `'stored' | 'stored_notify' | 'ceiling'` (no id, no
 *     content). It holds the notification coalescing (one claim per 60
 *     minutes, under a transaction advisory lock) and the database ceiling
 *     (90 per hour, 300 per day). Call it from src/lib/help-contact/submit.ts
 *     only; never `.insert()` this table from application code.
 *   - `help_contact_guard_update` (0083 section 3b), on every connection
 *     including the owner's (F44): id, createdAt, topic and notifiedAt never
 *     change; the four personal fields change only in a clear, which sets all
 *     four to null, needs `clearedBy` and a status other than `new`, and is
 *     irreversible; a status change needs `statusChangedBy`; the guard stamps
 *     `clearedAt` and `statusChangedAt` itself; a cleared row never returns to
 *     `new`.
 *   - `help_contact_guard_delete` (0083 section 3a): never deleted, on any
 *     connection. No teardown exemption.
 *
 * READS AND TRIAGE: src/lib/help-contact/inbox.ts through getPlatformDb(),
 * each mutation in one transaction with its audit row (ids and statuses only,
 * never a personal field: CA10, AF-5).
 *
 * The CHECKs below mirror 0083 section 1 for readability; the migration is
 * what enforces them (check:schema-parity compares presence, nullability and
 * FK shape, not CHECK bodies).
 */

/** The four topic keys (0083 `help_contact_topic_allowed`). */
export const HELP_CONTACT_TOPICS = [
  "starting_a_congregation",
  "signing_in",
  "help_page_wrong",
  "something_else",
] as const;
export type HelpContactTopicKey = (typeof HELP_CONTACT_TOPICS)[number];

/** 0083 `help_contact_status_allowed`. */
export const HELP_CONTACT_STATUSES = ["new", "handled", "spam"] as const;
export type HelpContactStatus = (typeof HELP_CONTACT_STATUSES)[number];

/** The definer's closed outcome tokens (0083 section 5). */
export const HELP_CONTACT_SUBMIT_OUTCOMES = ["stored", "stored_notify", "ceiling"] as const;
export type HelpContactSubmitOutcome = (typeof HELP_CONTACT_SUBMIT_OUTCOMES)[number];

/** The definer's SQL constants, named here so tests can pin them. */
export const HELP_CONTACT_NOTIFY_WINDOW_MINUTES = 60;
export const HELP_CONTACT_DB_CEILING_PER_HOUR = 90;
export const HELP_CONTACT_DB_CEILING_PER_DAY = 300;

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

export const helpContactMessages = pgTable(
  "help_contact_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // IMMUTABLE.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // IMMUTABLE.
    topic: text("topic").$type<HelpContactTopicKey>().notNull(),
    // Personal fields: null-only after a clear, otherwise immutable.
    name: text("name"),
    // Required until cleared (cleared-shape CHECK). Not verified.
    email: text("email"),
    congregation: text("congregation"),
    // Required until cleared.
    message: text("message"),
    status: text("status").$type<HelpContactStatus>().notNull().default("new"),
    // TRIGGER-STAMPED on a status change.
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    // Users are never hard-deleted, so ON DELETE stays at the default.
    statusChangedBy: uuid("status_changed_by").references(() => users.id),
    // IMMUTABLE. Set only by the definer on the message that claimed its window.
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    // TRIGGER-STAMPED on the clear; never reset.
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    clearedBy: uuid("cleared_by").references(() => users.id),
  },
  (t) => [
    index("help_contact_status_created_ix").on(t.status, t.createdAt.desc()),
    index("help_contact_created_ix").on(t.createdAt),
    // Partial (where notified_at is not null): 0083 section 2.
    index("help_contact_notified_ix")
      .on(t.notifiedAt.desc())
      .where(sql`${t.notifiedAt} is not null`),
    check("help_contact_topic_allowed", sql`${t.topic} in (${sqlList(HELP_CONTACT_TOPICS)})`),
    check("help_contact_status_allowed", sql`${t.status} in (${sqlList(HELP_CONTACT_STATUSES)})`),
    check(
      "help_contact_bounds",
      sql`(${t.name} is null or char_length(${t.name}) <= 100)
        and (${t.congregation} is null or char_length(${t.congregation}) <= 150)
        and (${t.email} is null or char_length(${t.email}) <= 254)
        and (${t.message} is null or (char_length(${t.message}) <= 2000
                                       and char_length(btrim(${t.message}, E' \\t\\r\\n')) >= 10))`,
    ),
    check(
      "help_contact_email_shape",
      sql`${t.email} is null or (${t.email} !~ '[[:space:]]' and ${t.email} ~ '^[^@]+@[^@]+\\.[^@]+$')`,
    ),
    // help_contact_no_controls: no C0 control but tab, LF and CR, and no DEL,
    // in name, email, congregation or message (0083 section 1).
    check(
      "help_contact_cleared_shape",
      sql`(${t.clearedAt} is null) = (${t.clearedBy} is null)
        and ((${t.clearedAt} is null and ${t.email} is not null and ${t.message} is not null)
          or (${t.clearedAt} is not null and ${t.name} is null and ${t.email} is null
              and ${t.congregation} is null and ${t.message} is null))`,
    ),
    check(
      "help_contact_status_stamp_shape",
      sql`(${t.statusChangedAt} is null) = (${t.statusChangedBy} is null)`,
    ),
  ],
);

export type HelpContactMessage = typeof helpContactMessages.$inferSelect;
