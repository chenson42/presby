import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { organizations } from "./org";

/**
 * The Session Annual Statistical Report. See docs/schema-design.md section J.
 *
 * The SASR is a QUERY, not a data-entry screen (invariant 8). It is also the
 * publish-upward contract that resolves the presbytery-visibility problem: a
 * congregation's data stays congregation-scoped, and defined aggregates are
 * published to the presbytery. Because the denomination already works this way,
 * we are modeling an existing ecclesiastical boundary rather than inventing a
 * policy — which is why the political objection ("why can't I see Church X's
 * directory?") has a principled answer.
 *
 * Per capita is assessed on ending active membership, so it derives from the
 * roll and never touches giving data.
 */
export const sasrReports = pgTable(
  "sasr_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reportYear: integer("report_year").notNull(),

    // From last year's GA Minutes. IMMUTABLE — "THIS FIGURE CANNOT BE CHANGED."
    officialBeginningBalance: integer("official_beginning_balance").notNull(),
    // What our roll actually says, via rollAsOf(12/31 of the prior year).
    computedBeginningBalance: integer("computed_beginning_balance"),
    endingActive: integer("ending_active"),

    // draft | session_approved | submitted
    // `submitted` CLOSES the year: any later-approved action whose
    // effectiveDate falls in a closed year is counted in the OPEN year's Other
    // Gains or Other Losses, carrying a reference to the original action. This
    // is exactly why the denomination freezes the beginning balance, and why
    // the reconciliation line is a feature rather than a workaround. See F8.
    status: text("status").notNull().default("draft"),
    minuteReference: text("minute_reference"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),

    // The full projected report. Membership sections derive from rollActions,
    // demographics from personDemographics, officers from officerTerms, and
    // financial lines from the ledger once Phase 3 lands.
    payload: jsonb("payload").notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("sasr_reports_org_year_key").on(t.organizationId, t.reportYear)],
);
