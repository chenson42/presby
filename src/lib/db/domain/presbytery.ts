import {
  pgTable,
  text,
  uuid,
  integer,
  numeric,
  smallint,
  date,
  timestamp,
  index,
  unique,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./org";
import { users } from "../schema";

/**
 * The presbytery's operational relationship to its member congregations
 * (docs/work-log/2026-08-27-presbytery-program.md Phase 3, DECISION-120).
 *
 * Four tables, all owned by the PRESBYTERY (`organizationId`), never by the
 * subject congregation (`aboutOrgId`) — even for `congregation_statistics`
 * rows with `provenance = 'published_by_congregation'`, which are written
 * upward through `presby_publish_sasr_snapshot()` (drizzle/00XX_presby_
 * presbytery_program.sql) and land at the presbytery like every other row in
 * the table. This is distinct from `reporting.ts` (the single-purpose,
 * currently-unused `sasrReports` source doc) and from `officers.ts` ("who
 * serves" shapes) — this file is "what the presbytery keeps on record about
 * a congregation," structurally the same shape `appointments` (officers.ts)
 * already established: composite person FKs can only resolve at the
 * presbytery (D1/F2), and `aboutOrgId`/`servingOrgId`-style references to the
 * SUBJECT congregation are plain FKs, legal per schema-design.md section 17
 * (`organizations` is the one cross-tenant-readable structural table).
 *
 * `congregation_oversight` and `per_capita_rates`/`per_capita_records` have no
 * cross-org read at all this pipeline (Phase 1 Q1's own reframing: this is
 * the presbytery's own opinion/ledger, not a congregation's record).
 * `congregation_statistics` is the one exception, and only via the two
 * SECURITY DEFINER functions — no bespoke cross-org RLS policy (schema-
 * design.md section 17 reserves that shape for exactly two named cases;
 * DECISION-112 already declined a third).
 */

/**
 * The presbytery's own judgment about a member congregation: viability,
 * redevelopment notes, buildings/insurance. Never the congregation's own
 * record (Phase 1 Q1 ruling) — no publication dependency, no cross-org RLS.
 *
 * ONE mutable row per congregation, like `organization_profiles` — no history
 * table. `audit_events` already captures who changed what and when; a
 * dedicated history table is added only if a future increment names an
 * actual restore-previous requirement (the bar `organization_brand_history`
 * cleared, and this hasn't).
 *
 * `latitude`/`longitude` live HERE, not on `organization_profiles`
 * (DECISION-120 ruling 3): `organization_profiles` is congregation-editable
 * and simply does not exist for the majority-unmanaged case D9 describes, so
 * it cannot be the viability map's data source without also solving "who
 * fills this in for a church with no session on the platform." Manually
 * entered by the presbytery clerk — no geocoding dependency, a real
 * sub-problem Phase 1 never scoped.
 */
export const congregationOversight = pgTable(
  "congregation_oversight",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // The PRESBYTERY — the owner, forced (D1/F2 shape), never the
    // congregation being assessed.
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Plain FK — organizations is the one cross-tenant-readable structural
    // table (schema-design.md section 17), same structural exception
    // appointments.servingOrgId already uses. Validated at the application
    // layer to be an actual member congregation of this presbytery
    // (parentId + organizationType check) before insert; the DB does not
    // enforce that relationship itself.
    aboutOrgId: uuid("about_org_id").notNull().references(() => organizations.id),
    // 1-3, CHECK-enforced below.
    viabilityScore: smallint("viability_score"),
    redevelopmentNotes: text("redevelopment_notes"),
    // Free text in v1, not a structured buildings/insurance schema —
    // psvonline-portal's own shape is richer than any requirement Phase 1
    // named; a structured schema is a future increment if a real presbytery
    // asks for one.
    buildingsNotes: text("buildings_notes"),
    insuranceCarrier: text("insurance_carrier"),
    insuranceExpiresOn: date("insurance_expires_on"),
    // MANUALLY entered by the presbytery clerk. See the viability-map note
    // above for why these live here and not on organization_profiles.
    latitude: numeric("latitude"),
    longitude: numeric("longitude"),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("congregation_oversight_org_about_key").on(t.organizationId, t.aboutOrgId),
    unique("congregation_oversight_id_org_key").on(t.id, t.organizationId),
    // Phase 3's own Data Model lists this alongside the identically-shaped
    // unique constraint above — a duplicate index on the same two leading
    // columns (the unique constraint already serves every lookup this index
    // would). Kept as specified rather than silently dropped; harmless
    // (index bloat only), flagged in the work-log rather than papered over.
    index("congregation_oversight_org_about_idx").on(t.organizationId, t.aboutOrgId),
    check(
      "congregation_oversight_viability_score_range",
      sql`${t.viabilityScore} is null or ${t.viabilityScore} between 1 and 3`,
    ),
  ],
);

/**
 * Annual statistical record for a member congregation. ONE table with a
 * `provenance` column, not two coalesced tables (DECISION-120) — every
 * consumer (3b's list, 4a's read-back, 4b's rollup, per-capita's basis-year
 * lookup) needs the SAME (about_org_id, year) keyspace regardless of who
 * wrote a given row.
 *
 * `organizationId` is the presbytery for EVERY provenance, including
 * published rows — `presby_publish_sasr_snapshot()` inserts here, not at the
 * congregation. `provenance = 'presbytery_entered' | 'published_by_
 * congregation' | 'imported'` is a CHECK constraint, not an app-only
 * convention (mislabeling is a named adversarial risk, Phase 1 §Gaps).
 *
 * Freeze-only-on-published-rows is a PARTIAL unique index (mutable
 * provenances upsert cleanly; a published row is never unique-constrained on
 * (about_org_id, year) because a correction is a brand-new frozen row
 * chained by supersedesPublicationId, never an UPDATE) plus a trigger
 * predicated on the same column — the roll_actions/void precedent, applied
 * to a column instead of a second table.
 */
export const congregationStatistics = pgTable(
  "congregation_statistics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Plain FK, same structural exception as congregationOversight.aboutOrgId.
    aboutOrgId: uuid("about_org_id").notNull().references(() => organizations.id),
    year: integer("year").notNull(),
    // presbytery_entered | published_by_congregation | imported
    provenance: text("provenance").notNull(),
    // Self-FK, AnyPgColumn idiom (events.parentEventId / organizations.
    // parentId precedent) — only meaningful for provenance =
    // 'published_by_congregation'; a republish chains to the row it
    // corrects rather than updating it in place.
    supersedesPublicationId: uuid("supersedes_publication_id").references(
      (): AnyPgColumn => congregationStatistics.id,
    ),
    // Set only for published rows.
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Phase 3's API Contract names `p_minute_reference` as
    // `presby_publish_sasr_snapshot()`'s second parameter (the session
    // minute ratifying publication, D3's session-ratifies/clerk-submits
    // pattern), but Phase 3's own Data Model table listing has no column for
    // it to land in — an omission, not a deliberate no-column decision
    // (nothing else about the design explains discarding it). Added here,
    // nullable, meaningful only for provenance = 'published_by_congregation'
    // (also usable by a future presbytery_entered UI for the same purpose),
    // same shape as appointments.minuteReference. Named as a Phase 3
        // deviation in the work-log rather than silently reconciled.
    minuteReference: text("minute_reference"),
    // Null for published rows (the presbytery didn't write it) and for
    // imports with no human actor.
    enteredBy: uuid("entered_by").references(() => users.id),

    // Gains (SASR). 17-and-under / 18-and-over split matches the schema-
    // design field table exactly; certificate/other are the report's own
    // remaining gain lines.
    gainsProfessionsUnder18: integer("gains_professions_under18"),
    gainsProfessions18Plus: integer("gains_professions_18plus"),
    gainsCertificate: integer("gains_certificate"),
    gainsOther: integer("gains_other"),
    // Losses
    lossesCertificate: integer("losses_certificate"),
    lossesDeaths: integer("losses_deaths"),
    lossesOther: integer("losses_other"),
    // Ending rolls
    endingActive: integer("ending_active"),
    endingBaptized: integer("ending_baptized"),
    endingAffiliate: integer("ending_affiliate"),
    endingOtherParticipants: integer("ending_other_participants"),
    // Gender (2024 SASR categories)
    genderWoman: integer("gender_woman"),
    genderMan: integer("gender_man"),
    genderNonbinary: integer("gender_nonbinary"),
    // Age brackets, incl. the schema's own "unknown" bucket (F-adjacent: age
    // distribution must not silently under-report members with no
    // birthdate).
    age17Under: integer("age_17_under"),
    age18To25: integer("age_18_25"),
    age26To40: integer("age_26_40"),
    age41To55: integer("age_41_55"),
    age56To70: integer("age_56_70"),
    age71Over: integer("age_71_over"),
    ageUnknown: integer("age_unknown"),
    // Racial-ethnic, 9 SASR categories. LEAN CALL (Phase 3): aggregated
    // against ACTIVE MEMBERSHIP ONLY in v1 — no officer cross-tab, which no
    // consumer in this design needs yet.
    raceAsian: integer("race_asian"),
    raceAfrican: integer("race_african"),
    raceAfricanAmerican: integer("race_african_american"),
    raceBlack: integer("race_black"),
    raceHispanic: integer("race_hispanic"),
    raceMiddleEastern: integer("race_middle_eastern"),
    raceNativeAmerican: integer("race_native_american"),
    raceWhite: integer("race_white"),
    raceOther: integer("race_other"),
    // Disabilities (aggregate; schema-design.md section 11's own note).
    disabilityHearing: integer("disability_hearing"),
    disabilityMobility: integer("disability_mobility"),
    disabilitySight: integer("disability_sight"),
    disabilityOther: integer("disability_other"),
    // Officers. LEAN CALL, same reasoning as race: TOTAL counts only, no
    // gender cross-tab in v1.
    officersRulingElderCount: integer("officers_ruling_elder_count"),
    officersDeaconCount: integer("officers_deacon_count"),
    // Baptisms, youth
    baptismsChildren: integer("baptisms_children"),
    baptismsAdults: integer("baptisms_adults"),
    youth4Under: integer("youth_4_under"),
    youthKTo5: integer("youth_k_5"),
    youth6To8: integer("youth_6_8"),
    youth9To12: integer("youth_9_12"),
    // Worship / giving-unit counts
    avgWeeklyWorshipAttendance: integer("avg_weekly_worship_attendance"),
    potentialGivingUnits: integer("potential_giving_units"),
    // Financial (14 SASR lines + budgeted income/expense)
    receiptsContributions: numeric("receipts_contributions"),
    receiptsCapitalBuildingFunds: numeric("receipts_capital_building_funds"),
    receiptsInvestmentEndowmentIncome: numeric(
      "receipts_investment_endowment_income",
    ),
    receiptsBequests: numeric("receipts_bequests"),
    receiptsOtherIncome: numeric("receipts_other_income"),
    receiptsSubsidyOrAid: numeric("receipts_subsidy_or_aid"),
    expLocalProgram: numeric("exp_local_program"),
    expLocalMission: numeric("exp_local_mission"),
    expCapital: numeric("exp_capital"),
    expInvestment: numeric("exp_investment"),
    expPerCapitaApportionment: numeric("exp_per_capita_apportionment"),
    expValidatedMissionPcusa: numeric("exp_validated_mission_pcusa"),
    expGaTheologicalEducationFund: numeric("exp_ga_theological_education_fund"),
    expOtherMission: numeric("exp_other_mission"),
    budgetedIncome: numeric("budgeted_income"),
    budgetedExpense: numeric("budgeted_expense"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("congregation_statistics_id_org_key").on(t.id, t.organizationId),
    // Partial: deliberately excludes 'published_by_congregation' — a
    // republish is a new frozen row chained by supersedesPublicationId,
    // never an UPDATE, so it must never collide with this constraint.
    uniqueIndex("congregation_statistics_entered_unique_idx")
      .on(t.organizationId, t.aboutOrgId, t.year, t.provenance)
      .where(sql`${t.provenance} in ('presbytery_entered', 'imported')`),
    // NOT partial — every consumer's rollup/basis-year read needs to find a
    // row regardless of provenance, including published ones the unique
    // index above deliberately excludes.
    index("congregation_statistics_org_about_year_idx").on(
      t.organizationId,
      t.aboutOrgId,
      t.year,
    ),
    check(
      "congregation_statistics_provenance_allowed",
      sql`${t.provenance} in ('presbytery_entered', 'published_by_congregation', 'imported')`,
    ),
    // Boundary validation belt-and-suspenders — presby_publish_sasr_
    // snapshot() is the primary gate for published rows (F26: the trust
    // boundary is the function, not the calling action); this also covers
    // presbytery_entered/imported rows, which have no function in front of
    // them at all. NULL passes (an unreported field), only a negative value
    // is rejected.
    check(
      "congregation_statistics_nonneg_check",
      sql`(${t.gainsProfessionsUnder18} is null or ${t.gainsProfessionsUnder18} >= 0)
      and (${t.gainsProfessions18Plus} is null or ${t.gainsProfessions18Plus} >= 0)
      and (${t.gainsCertificate} is null or ${t.gainsCertificate} >= 0)
      and (${t.gainsOther} is null or ${t.gainsOther} >= 0)
      and (${t.lossesCertificate} is null or ${t.lossesCertificate} >= 0)
      and (${t.lossesDeaths} is null or ${t.lossesDeaths} >= 0)
      and (${t.lossesOther} is null or ${t.lossesOther} >= 0)
      and (${t.endingActive} is null or ${t.endingActive} >= 0)
      and (${t.endingBaptized} is null or ${t.endingBaptized} >= 0)
      and (${t.endingAffiliate} is null or ${t.endingAffiliate} >= 0)
      and (${t.endingOtherParticipants} is null or ${t.endingOtherParticipants} >= 0)
      and (${t.genderWoman} is null or ${t.genderWoman} >= 0)
      and (${t.genderMan} is null or ${t.genderMan} >= 0)
      and (${t.genderNonbinary} is null or ${t.genderNonbinary} >= 0)
      and (${t.age17Under} is null or ${t.age17Under} >= 0)
      and (${t.age18To25} is null or ${t.age18To25} >= 0)
      and (${t.age26To40} is null or ${t.age26To40} >= 0)
      and (${t.age41To55} is null or ${t.age41To55} >= 0)
      and (${t.age56To70} is null or ${t.age56To70} >= 0)
      and (${t.age71Over} is null or ${t.age71Over} >= 0)
      and (${t.ageUnknown} is null or ${t.ageUnknown} >= 0)
      and (${t.raceAsian} is null or ${t.raceAsian} >= 0)
      and (${t.raceAfrican} is null or ${t.raceAfrican} >= 0)
      and (${t.raceAfricanAmerican} is null or ${t.raceAfricanAmerican} >= 0)
      and (${t.raceBlack} is null or ${t.raceBlack} >= 0)
      and (${t.raceHispanic} is null or ${t.raceHispanic} >= 0)
      and (${t.raceMiddleEastern} is null or ${t.raceMiddleEastern} >= 0)
      and (${t.raceNativeAmerican} is null or ${t.raceNativeAmerican} >= 0)
      and (${t.raceWhite} is null or ${t.raceWhite} >= 0)
      and (${t.raceOther} is null or ${t.raceOther} >= 0)
      and (${t.disabilityHearing} is null or ${t.disabilityHearing} >= 0)
      and (${t.disabilityMobility} is null or ${t.disabilityMobility} >= 0)
      and (${t.disabilitySight} is null or ${t.disabilitySight} >= 0)
      and (${t.disabilityOther} is null or ${t.disabilityOther} >= 0)
      and (${t.officersRulingElderCount} is null or ${t.officersRulingElderCount} >= 0)
      and (${t.officersDeaconCount} is null or ${t.officersDeaconCount} >= 0)
      and (${t.baptismsChildren} is null or ${t.baptismsChildren} >= 0)
      and (${t.baptismsAdults} is null or ${t.baptismsAdults} >= 0)
      and (${t.youth4Under} is null or ${t.youth4Under} >= 0)
      and (${t.youthKTo5} is null or ${t.youthKTo5} >= 0)
      and (${t.youth6To8} is null or ${t.youth6To8} >= 0)
      and (${t.youth9To12} is null or ${t.youth9To12} >= 0)
      and (${t.avgWeeklyWorshipAttendance} is null or ${t.avgWeeklyWorshipAttendance} >= 0)
      and (${t.potentialGivingUnits} is null or ${t.potentialGivingUnits} >= 0)`,
    ),
  ],
);

/**
 * Presbytery-set per-capita rate for a billing year. `basisYear` is explicit
 * and presbytery-set (defaults to `billingYear - 2` at the ACTION layer per
 * Operator Answer 1 — arrears on a two-year lag is the dominant real
 * PC(USA) practice — not a generated column, because a presbytery may
 * legitimately override it).
 */
export const perCapitaRates = pgTable(
  "per_capita_rates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    billingYear: integer("billing_year").notNull(),
    basisYear: integer("basis_year").notNull(),
    // ONE combined rate, not three GA/synod/presbytery components. LEAN
    // CALL: no consumer in this design needs the component breakdown.
    ratePerMember: numeric("rate_per_member").notNull(),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("per_capita_rates_org_billing_year_key").on(t.organizationId, t.billingYear),
    unique("per_capita_rates_id_org_key").on(t.id, t.organizationId),
  ],
);

/**
 * A congregation's per-capita bill for a billing year, generated from the
 * statistics rollup at `basisYear` × the rate in effect. `endingActiveBasis`/
 * `rateApplied`/`amountOwed` are SNAPSHOTS, frozen at generation time —
 * ending_active_basis is psvonline-portal's own documented practice ("snapshot
 * at calculation time"), and amount_owed is stored (not generated) so a later
 * rate correction or republished statistic cannot silently move a bill
 * already issued (Phase 3 Edge Cases: "republish-after-billing").
 */
export const perCapitaRecords = pgTable(
  "per_capita_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    aboutOrgId: uuid("about_org_id").notNull().references(() => organizations.id),
    billingYear: integer("billing_year").notNull(),
    // Copied from the rate row at generation time — same don't-retroactively
    // -drift reasoning as the two snapshot columns below.
    basisYear: integer("basis_year").notNull(),
    endingActiveBasis: integer("ending_active_basis").notNull(),
    rateApplied: numeric("rate_applied").notNull(),
    amountOwed: numeric("amount_owed").notNull(),
    // unpaid | partial | paid
    paidStatus: text("paid_status").notNull().default("unpaid"),
    paidAmount: numeric("paid_amount"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("per_capita_records_org_about_billing_year_key").on(
      t.organizationId,
      t.aboutOrgId,
      t.billingYear,
    ),
    unique("per_capita_records_id_org_key").on(t.id, t.organizationId),
    check(
      "per_capita_records_paid_status_allowed",
      sql`${t.paidStatus} in ('unpaid', 'partial', 'paid')`,
    ),
  ],
);
