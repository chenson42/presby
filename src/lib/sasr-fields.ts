/**
 * SASR field labels, grouping and display order — the piece Phase 2 of
 * `docs/work-log/2026-09-25-submission-grants.md` (architect's ruling 3)
 * placed here rather than in the database: `sasr_form_versions.field_spec`
 * owns the field SET, TYPE and BOUNDS (and is frozen the moment any
 * `statistical_returns` row references a version key —
 * `presby_freeze_used_field_spec`, F53), but it carries no human-readable
 * label. This module is the one hand-maintained place the 2024 form's 60
 * fields get a label, a group and an order — the "third leg" of the parity
 * this codebase already enforces twice over: `drizzle/0046` section 2's own
 * `DO` block asserts the field-spec key set equals the typed
 * `congregation_statistics` column set; `sasr-fields.test.ts` asserts THIS
 * module's key set against the same seeded spec.
 *
 * `inputType` is derived from the spec's own declared JSON `type` — "integer"
 * fields are a plain count, "numeric" fields are a dollar amount — so a form
 * renderer can pick `inputMode="numeric"` and a `$` affix without asking the
 * database again. Nothing here re-declares a min/max: the server (through
 * `presby_enforce_sasr_field_spec()`) and the client `zod` schema both read
 * bounds from the spec itself, never from this file.
 *
 * KEYED BY `form_version_key`, not hard-coded to "2024" — a future form
 * version adds a second entry to `SASR_FIELD_GROUPS`, never edits this one
 * (the frozen 2024 spec cannot change, so neither should its labels).
 */

export type SasrFieldInputType = "count" | "currency";

export interface SasrFieldMeta {
  /** Must equal a key in `sasr_form_versions.field_spec->'fields'` for this version. */
  key: string;
  label: string;
  inputType: SasrFieldInputType;
}

export interface SasrFieldGroup {
  title: string;
  fields: SasrFieldMeta[];
}

function count(key: string, label: string): SasrFieldMeta {
  return { key, label, inputType: "count" };
}

function currency(key: string, label: string): SasrFieldMeta {
  return { key, label, inputType: "currency" };
}

export const SASR_FIELD_GROUPS: Record<string, SasrFieldGroup[]> = {
  "2024": [
    {
      title: "Gains",
      fields: [
        count("gains_professions_under18", "Professions of faith, under 18"),
        count("gains_professions_18plus", "Professions of faith, 18 and older"),
        count("gains_certificate", "Certificate of transfer"),
        count("gains_other", "Other means"),
      ],
    },
    {
      title: "Losses",
      fields: [
        count("losses_certificate", "Certificate of transfer"),
        count("losses_deaths", "Deaths"),
        count("losses_other", "Other means"),
      ],
    },
    {
      title: "Ending rolls",
      fields: [
        count("ending_active", "Active members"),
        count("ending_baptized", "Baptized, not confirmed members"),
        count("ending_affiliate", "Affiliate members"),
        count("ending_other_participants", "Other participants"),
      ],
    },
    {
      title: "Gender",
      fields: [
        count("gender_woman", "Woman"),
        count("gender_man", "Man"),
        count("gender_nonbinary", "Nonbinary"),
      ],
    },
    {
      title: "Age",
      fields: [
        count("age_17_under", "17 and under"),
        count("age_18_25", "18–25"),
        count("age_26_40", "26–40"),
        count("age_41_55", "41–55"),
        count("age_56_70", "56–70"),
        count("age_71_over", "71 and over"),
        count("age_unknown", "Unknown"),
      ],
    },
    {
      title: "Race and ethnicity",
      fields: [
        count("race_asian", "Asian"),
        count("race_african", "African"),
        count("race_african_american", "African American"),
        count("race_black", "Black"),
        count("race_hispanic", "Hispanic/Latino-a"),
        count("race_middle_eastern", "Middle Eastern"),
        count("race_native_american", "Native American"),
        count("race_white", "White"),
        count("race_other", "Other"),
      ],
    },
    {
      title: "Disability",
      fields: [
        count("disability_hearing", "Hearing"),
        count("disability_mobility", "Mobility"),
        count("disability_sight", "Sight"),
        count("disability_other", "Other"),
      ],
    },
    {
      title: "Officers",
      fields: [
        count("officers_ruling_elder_count", "Ruling elders"),
        count("officers_deacon_count", "Deacons"),
      ],
    },
    {
      title: "Baptisms",
      fields: [
        count("baptisms_children", "Children"),
        count("baptisms_adults", "Adults"),
      ],
    },
    {
      title: "Church school / youth",
      fields: [
        count("youth_4_under", "4 and under"),
        count("youth_k_5", "Kindergarten–5th grade"),
        count("youth_6_8", "6th–8th grade"),
        count("youth_9_12", "9th–12th grade"),
      ],
    },
    {
      title: "Worship and giving units",
      fields: [
        count("avg_weekly_worship_attendance", "Average weekly worship attendance"),
        count("potential_giving_units", "Potential giving units"),
      ],
    },
    {
      title: "Receipts",
      fields: [
        currency("receipts_contributions", "Contributions"),
        currency("receipts_capital_building_funds", "Capital/building funds"),
        currency(
          "receipts_investment_endowment_income",
          "Investment and endowment income",
        ),
        currency("receipts_bequests", "Bequests"),
        currency("receipts_other_income", "Other income"),
        currency("receipts_subsidy_or_aid", "Subsidy or aid received"),
      ],
    },
    {
      title: "Expenditures",
      fields: [
        currency("exp_local_program", "Local program"),
        currency("exp_local_mission", "Local mission"),
        currency("exp_capital", "Capital"),
        currency("exp_investment", "Investment"),
        currency("exp_per_capita_apportionment", "Per-capita apportionment"),
        currency("exp_validated_mission_pcusa", "Validated mission, PC(USA)"),
        currency(
          "exp_ga_theological_education_fund",
          "GA Theological Education Fund",
        ),
        currency("exp_other_mission", "Other mission"),
      ],
    },
    {
      title: "Budget",
      fields: [
        currency("budgeted_income", "Budgeted income (next year)"),
        currency("budgeted_expense", "Budgeted expense (next year)"),
      ],
    },
  ],
};

/** Every field key declared for `formVersionKey`, flattened in display order. */
export function sasrFieldKeys(formVersionKey: string): string[] {
  const groups = SASR_FIELD_GROUPS[formVersionKey] ?? [];
  return groups.flatMap((g) => g.fields.map((f) => f.key));
}
