# Schema design, round 2 — full-domain first pass

**Status:** DRAFT for review. Not implemented. No migrations written.
**Date:** 2026-09-24.
**Extends** `docs/schema-design.md` (Sections A–L, decisions D1–D9, findings
F1–F29). Conventions, invariants and RLS rules there apply unchanged and are not
repeated. New decisions continue at **D10**; new findings at **F30**.

## 0a. The Book of Order is a design authority

**Standing instruction (operator, 2026-09-24): reference the Book of Order when
building the data model, not only when a polity question surfaces.**

This is not ceremony. Where the *Form of Government* already names a concept, its
vocabulary and its enumerations are better than anything we would infer — they are
what a clerk of session and a presbytery stated clerk already use, and they are what
an auditor will check against. Two concrete cases in this round:

- **D10's lifecycle states were inferred from import errors, then found verbatim in
  the polity.** G-3.0301(c) makes the presbytery responsible for *"organizing,
  receiving, merging, dismissing, and dissolving congregations in consultation with
  their members."* That is the enum. The draft had invented `transferred`, had
  omitted `received` and `divided`, and — more importantly — had no
  `minute_reference`, when every one of these is a presbytery act taken *in
  consultation* and *subject to review*. Corrected in §3.
- **Stewardability is enumerated, not a matter of taste** (§6). G-3.0107 / G-3.0108
  put session minutes, rolls and registers under annual presbytery review;
  G-3.0204(b) enumerates the registers themselves. Care-ministry notes are none of
  those.

**Rule going forward:** before naming a status, a role, a register or a lifecycle,
check whether the Book of Order names it. If it does, use its word. If we diverge,
say so and say why.

Citations verified 2026-09-24 against PC(USA) published sources and presbytery
clerk-of-session handbooks. Sections referenced so far: G-1.0401–G-1.0404
(membership rolls), G-2.0404 (terms of service), G-3.0107 / G-3.0108 (records and
review), G-3.0204(b) (session registers), G-3.0301(c) (congregational lifecycle).

---

## 0. Why this document exists

The operator's instruction: *"I'd like to design/implement the schema across all
the functionality (at least a first pass). I think the design will be better if we
take into account the full design."*

That is the right instinct and this document is the argument for it. Three of the
findings below are only visible when the whole domain is in view — the SASR archive
problem (F31) cannot be seen from inside the presbytery module, and the
organization-lifecycle gap (F30) cannot be seen from inside the statistics module.
Incremental growth is how `group_memberships.officer_term_id` ended up with no
foreign key at all.

**Scope of this pass:** presbytery oversight · the SASR as both archive and
projection · statistics submission by non-users · finance (ledger, budget,
giving) · congregation management (pastoral acts, households, care ministry).

**Out of scope:** DDL detail, indexes, RLS policy text. Those come after the
shape is agreed.

---

## 1. What the legacy PSV import actually taught us

`psvonline-portal`'s production database (Neon `presby-portal`,
`silent-cloud-95940340`) holds 41 years of real presbytery data **and a 2,312-row
import-error table.** Reading the errors before designing changed four decisions.

The source was a multi-tab spreadsheet — tabs `1983-2013`, `2014-2021`,
`2022-2023`, `2024`, `contributions-2024/2025/2026`, `INSURANCE`,
`PROPERTY REIMAGINED` — plus a clergy PDF.

### F30 — Roughly half the statistical history failed to import, and it is not a matcher bug

2,515 rows landed in `congregation_membership`; **2,312 failed.** Every failure is
one error type: the congregation name could not be resolved
(`NOT_FOUND` / `CHURCH_NOT_FOUND`).

The decisive measurement: of **99 distinct unmatched names, only 12 correspond to a
congregation that exists in PSV today.** City was present on 2,196 of the 2,312
rows, so the matcher was not starved of data.

**Those rows are the statistical history of ~87 congregations that have closed,
merged, been dissolved, or been dismissed to another denomination.** PSV has 85
congregations now; its 41-year history involves roughly 172.

**Consequence: `organizations` has no lifecycle.** `platform_status` says whether
an org is a *tenant* (`managed` / `unmanaged` / `invited`, D9). It does not say
whether the org still *exists*. `people` has `merged_into_id` and a revoked
`delete` because "PC(USA) records are permanent" (invariant 7) — **organizations
have no equivalent, and a dissolved congregation is equally permanent record.**

### F31 — The SASR form drifts, so a wide typed table cannot hold the archive

`congregation_membership` has 78 columns and carries **two complete generations of
age bands** simultaneously:

- `age_17_under, age_18_to_25, age_26_to_40, age_41_to_55, age_56_to_70, age_71_over`
- `age_25_under, age_26_to_45, age_46_to_55, age_56_to_65, age_65_over`

Same pattern in gains (`gains_confirmation`, `gains_youth_professions`,
`gains_adult_professions`, `gains_adult_under_17`, `gains_adult_over_18`,
`gains_reaffirmation`, `gains_transfer_in`, `gains_other`) and baptisms. The
spreadsheet's **year-range tabs are the form generations.**

presby's built `congregation_statistics` carries exactly **one** generation — the
current one. There is nowhere to put 1984's age bands.

Note that `docs/schema-design.md` §13 got this right and the implementation lost
it: the designed `sasr_reports` had **`payload jsonb`** alongside its typed
columns. The built table is wide-typed with no payload.

### F32 — An import that cannot resolve a reference must quarantine the row, never drop it

The prototype's history survives *only* because `import_errors` retained
`raw_row_json`. That was luck in the shape of good instinct. Had the importer
merely logged and discarded, 41 years of a presbytery's statistical record would be
gone.

`raw_row_json` is a positional **array** on 2,202 of the rows and an object on 110
— recoverable, but only against per-tab column orders, which differ by form
generation (F31).

### F33 — Bare congregation short-names are inherently ambiguous

The single most common unmatched name accounted for **500 rows** on its own: a
generic short name shared by many congregations, unresolvable without city.
Presbyteries write short names in spreadsheets; matching needs
`(name, city, year)` at minimum, and needs to tolerate a name that was correct
*in that year* and is not now.

---

## 2. New decisions

| # | Decision | Choice | If we change it |
|---|---|---|---|
| **D10** | Organization lifecycle | **Organizations get a lifecycle independent of `platform_status`, named from G-3.0301(c)**: `organized`, `received`, `merged`, `divided`, `dismissed`, `dissolved` — plus `active` as the steady state. Each carries an effective date **and a `minute_reference`**, because each is a presbytery act taken *in consultation with the members* and *subject to review*. Plus `merged_into_org_id`. `delete` revoked on `organizations`, mirroring `people`. | Without it, a presbytery cannot hold the history of a church that closed — 87 of PSV's ~172 congregations. Deleting or omitting them silently truncates every trend report. Without the minute reference, a dissolution is unattributable, which is exactly what review exists to prevent. |
| **D11** | SASR is two things | **Separate the archive from the projection.** `sasr_reports` (presby-generated, typed, current form, reconciles against the roll) is distinct from `sasr_archive` (imported, immutable, form-versioned, `payload jsonb`). | Forcing both into one wide table means adding nullable columns retroactively every time the denomination revises the form — for years you cannot re-derive. |
| **D12** | Statistical form versioning | **A `sasr_form_version` reference table**, and every archive row names its version. Typed *reporting views* are built per version; the storage is the payload. | A single flat shape either loses old fields or accumulates them forever (F31). |
| **D13** | Import quarantine is first-class | **Unresolved rows land in a durable staging table with the raw payload, a reason, and a resolution workflow** — never an error log. Resolution can create a `dissolved` organization (D10). | F32. This is the difference between a 48%-failed import and a 100%-preserved one. |
| **D14** | Congregation name history | **Organizations carry dated name aliases** (`organization_name_history`), used for import matching and for rendering a historical report under the name in force that year. | Renames are routine over 41 years and `slug` immutability (the `(org)` contract) does not help matching on legacy names. |
| **D15** | Presbytery oversight ≠ congregation finance | **The presbytery's loan/insurance/property book is presbytery-owned data *about* a congregation** (`about_org_id`, the existing `congregation_oversight` pattern), entirely separate from Track E's congregation ledger. | PSV's `congregation_insurance` holds PILP balances, original loan amounts, mortgage grants and loan guarantees — the presbytery's own exposure, not the church's books. Conflating them would put a presbytery's risk register inside a tenant's ledger. |
| **D16** | Statistics may be submitted without an account | **A signed, expiring, single-`(org, year)` submission grant**, verified and attributable, feeding the existing `provenance` / `minute_reference` fields. | The operator wants clerks to submit online and "make it super easy"; requiring a full tenant account for an `unmanaged` congregation defeats D9's whole premise. |
| **D17** | Pastoral acts are first-class records, not roll side-effects | **`pastoral_acts`** (baptism, marriage, funeral, confirmation, ordination service) recorded in their own register, *referencing* roll actions where one results rather than being derived from them. | A baptism is a sacrament with its own register, officiant and minute reference. A wedding involves people who may not be members at all. A funeral is not the same fact as a roll removal, though it usually accompanies one. |
| **D18** | Care ministry is tier 3 and separately gated | **`care_*` tables at sensitivity tier 3**, above financial, with visibility never inherited from directory or staff permissions. | Invariant "No Role Carries a Wildcard" already puts pastoral notes above financial data. Care ministry is the largest concentration of tier-3 content in the product and the easiest to leak by accident. |

---

## 3. Section M — Organization lifecycle *(new)*

Answers F30 / D10.

```
organizations                      (existing — extended)
  + lifecycle_status   text not null default 'active'
        -- vocabulary from G-3.0301(c):
        active | organized | received | merged | divided | dismissed | dissolved
  + lifecycle_date     date          -- effective date of the current status
  + lifecycle_minute_reference text  -- the presbytery act. G-3.0301(c) requires
                                     -- consultation; review requires attribution
  + merged_into_org_id uuid          -- set when lifecycle_status = 'merged'
  + pcusa_pin          text          -- the denomination's own identifier
  + organized_year     integer

organization_lifecycle_events      (new — the history, not just current state)
  organization_id, event, effective_on, minute_reference, recorded_by, notes

organization_name_history          (new)   D14
  organization_id, name, official_name, effective_from, effective_to
```

Notes.

- **`lifecycle_status` and `platform_status` are orthogonal.** A `dissolved`
  congregation was very likely `unmanaged`; a `managed` tenant can dissolve. Two
  axes, two columns — the same discipline as `canAccessAdmin` vs `isPlatformAdmin`
  (DECISION-044).
- `delete` revoked on `organizations`, matching `people`.
- `merged_into_org_id` mirrors `people.merged_into_id` deliberately, so the
  "follow the merge chain" query shape is learned once.
- **Open:** does a dissolved congregation keep its `slug`? It must, for historical
  report URLs — which argues the slug reservation is permanent, not released on
  dissolution.

## 4. Section N — Presbytery oversight *(new)*

Answers D15. Extends the existing `congregation_oversight` (`organization_id` +
`about_org_id`) pattern rather than replacing it.

```
congregation_property             -- per-property, replaces `buildingsNotes`
  organization_id, about_org_id, property_type, name, address…,
  year_built, addition_years[], square_footage, appraised_value, assessed_year,
  is_primary, photo_asset_id,
  roof_condition, plumbing_condition, hvac_condition, boiler_condition,
  has_sprinklers, has_fire_alarm, has_security_system, notes

presbytery_loan_exposure          -- the presbytery's OWN risk book (D15)
  organization_id, about_org_id, year,
  pilp_balance, original_loan, mortgage_grants, loan_guarantee,
  insurance_carrier, policy_number, policy_expiry_date,
  has_recent_claims, interested_in_pool, notes

congregation_viability            -- dated assessment, not a current-state row
  organization_id, about_org_id, assessed_on,
  viability_score, land_for_development_score, development_notes,
  has_pastor, pastor_type, notes
```

Notes.

- PSV's data justifies the property detail: 82 building rows carrying real
  condition assessments. `congregation_oversight.buildingsNotes` cannot express
  "two properties, one with a failing boiler."
- PSV had **both** `congregation_viability` and an empty `congregation_property`
  with overlapping columns — prototype churn. Do not port both.
- **Viability is dated, not current.** A viability score is an assessment made on a
  date by a committee; overwriting it destroys the trend that justifies an
  administrative commission.
- `ministry_credentials` in PSV is **empty** — built, never used. presby's
  `/admin/credentials` is already real. Do not port.

## 5. Section O — The SASR, archive and projection *(revises Section J)*

Answers F31 / D11 / D12. **The most consequential part of this pass.**

```
sasr_form_versions                (new, platform-wide reference)
  key (e.g. '1984', '2014', '2022', '2024'), label,
  effective_first_year, effective_last_year, field_spec jsonb

sasr_archive                      (new — imported history, IMMUTABLE)
  organization_id,               -- the presbytery holding the archive
  about_org_id,                  -- the congregation, possibly `dissolved` (D10)
  report_year,
  form_version_key,
  payload jsonb not null,        -- as-reported, in that year's field names
  source_ref text,               -- which tab / file / page it came from
  imported_from_staging_id,      -- provenance back to D13
  unique (organization_id, about_org_id, report_year)

sasr_reports                      (existing design, §13 — presby-GENERATED)
  … unchanged, keeps `payload jsonb`, the immutable
    official_beginning_balance and the reconciliation rule
```

Notes.

- **The archive is not a projection and must never be reconciled.** §13's rule
  (`official_beginning_balance + gains − losses = ending_active`) applies to what
  presby generates from its own roll. An imported 1987 row is a historical
  assertion; if it does not balance, that is a fact about 1987, not an error to
  correct.
- **`about_org_id` must legally reference a non-`active` organization.** This is
  the concrete reason D10 exists.
- Reporting reads a **union view** over archive + generated, normalised through
  `sasr_form_versions.field_spec`. Trend queries then span 1984→present without
  either table growing a column.
- **Open (F34?):** cross-generation comparability. 1984's age bands do not map onto
  2024's. A trend chart over "members aged 56–70" is *not* computable across the
  boundary and the schema should make that impossible to ask naively rather than
  quietly wrong. Suggest the normalising view expose only fields valid for the
  requested span.

## 6. Section P — Submission without an account *(new)*

Answers D16.

```
statistics_submission_grants      (new)
  organization_id,               -- the presbytery issuing it
  about_org_id,                  -- the congregation being asked
  report_year,
  token_hash,                    -- never the token itself
  issued_to_name, issued_to_email,
  issued_by, issued_at, expires_at,
  submitted_at, submitted_payload jsonb,
  attested_by_name, attested_role, minute_reference,
  revoked_at
```

Notes.

- **Single-purpose, single-year, single-congregation, expiring.** The grant is not
  a login and grants no read access to anything else.
- Verification is *attestation*, not authentication: the submitter names
  themselves and their office (clerk of session, moderator), and that flows into
  the existing `provenance` / `minute_reference` fields. This matches how the paper
  process actually works.
- Store `token_hash`, following the `password_reset_tokens` precedent; the
  plaintext exists only in the emailed link.
- Rate-limit issuance and submission. An unauthenticated write endpoint scoped by a
  guessable `(org, year)` is exactly the surface `check:secrets` and the security
  review should look at hardest.
- **This is architecturally novel for presby** — every other write path is
  auth-gated — so it wants its own security review pass, not a bolt-on.

## 7. Section Q — Finance: ledger, budget, giving *(new, POST-CUTOVER)*

Design now (per the operator's full-design instruction); build after the FPCW
cutover. Prior art: `~/git/westervillelions`' ~26 `ledger_*` tables, which already
solve acknowledgments, letter templates and reimbursements.

```
ledger_funds            -- PC(USA) restriction matters: unrestricted /
                           temporarily restricted / permanently restricted
ledger_accounts         -- chart of accounts
ledger_categories
ledger_transactions     -- APPEND-ONLY; corrected by reversing entry, never update
ledger_transaction_lines-- debit/credit lines; the balance constraint lives here
ledger_budgets / _budget_lines / _budget_approvals
ledger_bank_accounts / _bank_lines
ledger_reconciliation_sessions / _matches
giving_donors           -- may reference a person, may not (anonymous, estate, org)
giving_gifts            -- date, fund, amount, method, Vanco reference
giving_pledges
giving_statements / _statement_lines   -- IRS Pub 1771
vanco_settlements       -- imported settled batches, reconciled to giving_gifts
```

Notes.

- **Append-only, like the roll.** A posted transaction is corrected by a reversing
  entry. This is the same invariant as `roll_actions` and for the same reason.
- **Fund restriction is not a category.** PC(USA) congregations hold permanently
  restricted funds; spending one on operations is a real breach, so restriction
  belongs on the fund with a constraint, not in a free-text label.
- **Giving is tier 2** and must never widen through the directory. A donor row
  that references a person must not make giving visible to `directory.view`.
- **`giving_donors` may not reference a person at all** — anonymous gifts, estates,
  and other organizations give. Do not make `person_id` required.
- Statements are **generated artifacts with a retention obligation**; once issued,
  the issued document is the record, not a re-render of mutable data.
- Vanco is one settlement source among several (cash, cheque, stock). Model
  `giving_gifts` as the truth and `vanco_settlements` as an import that reconciles
  to it — not the reverse.

## 8. Section R — Congregation management: pastoral acts and care *(new)*

Answers D17 / D18.

```
pastoral_acts                     -- the register (D17)
  organization_id, act_type,      -- baptism | marriage | funeral |
                                  -- confirmation | ordination_service
  occurred_on, location,
  officiant_person_id,            -- may be a minister of another presbytery
  minute_reference,
  resulting_roll_action_id,       -- nullable: a baptism usually produces one
  register_number, notes

pastoral_act_participants         -- role-per-person, because a wedding has two
  pastoral_act_id, person_id,     -- person_id nullable: non-members marry here
  participant_name,               -- for the non-member case
  participant_role               -- baptizand | parent | sponsor | spouse |
                                 -- deceased | next_of_kin | witness

care_interactions                 -- tier 3 (D18)
  organization_id, person_id, occurred_on, interaction_type,
  -- visit | call | hospital | bereavement | crisis | prayer_request
  recorded_by, summary, follow_up_on, closed_at

care_assignments                  -- who is responsible for whom
  organization_id, person_id, caregiver_person_id,
  -- typically a deacon: the diaconate roster is already derived from officer_terms
  started_on, ended_on, notes
```

Notes.

- **A pastoral act is not a roll action.** A funeral and a `death` roll removal are
  two facts that usually co-occur; a wedding may involve no members at all; a
  baptism of an infant creates a *baptized member* but the sacrament is the
  register entry. Hence `resulting_roll_action_id` is a nullable reference, not a
  derivation.
- `participant_name` exists for the same reason
  `person_relationships.related_name` does — the other party is not always in the
  system.
- **Care ministry maps onto the diaconate presby already models.** `care_assignments`
  should reference the derived Diaconate group rather than inventing a parallel
  roster (invariant "The Court Is Not a Group").
- **Tier 3, and the hardest privacy surface in the product.** A bereavement note is
  more sensitive than a giving record. Visibility must be an explicit grant, never
  a consequence of holding `directory.view` or being staff.
- Households already exist (`households`, `addresses`). This pass adds no household
  tables; it assumes the existing model and flags below that Church360's household
  semantics need a reconciliation pass.

---

## 9. Cross-cutting consequences

1. **`about_org_id` becomes a recognised pattern**, not a one-off. Presbytery-owned
   rows concerning another organization now appear in oversight, property, loan
   exposure, viability and the SASR archive. It deserves a documented convention
   alongside the composite-tenant-key rule — including that `about_org_id` is
   *not* a tenant FK and must not be confused for one.
2. **Two "permanent record" invariants now exist** — people and organizations.
   State them together.
3. **Append-only appears three times**: `roll_actions`, `ledger_transactions`,
   `sasr_archive`. One convention, one trigger pattern, one test shape.
4. **Tier 3 grows substantially** (demographics, medical, pastoral notes, and now
   care interactions). Worth re-reading the tier model as a whole rather than
   adding to it.
5. **`payload jsonb` reappears** (sasr_archive, sasr_reports, submission grants).
   Needs a stated rule on when jsonb is legitimate — here: as-reported external
   data whose shape we do not control — so it does not become an escape hatch that
   defeats D8's no-custom-fields decision.

## 10. Open questions

1. **Cross-generation SASR comparability** (§5). Should the normalising view refuse
   a query spanning a form-version boundary for fields that do not map?
2. **Does a dissolved congregation keep its slug forever?** (§3)
3. **Church360 household semantics** vs presby's `households` — same concept?
   Needs a field-level pass before the import.
4. **Who may issue a submission grant** (§6) — presbytery staff only, or may a
   congregation's own clerk request one for themselves?
5. **Does PSV need per-member giving detail**, or only congregation-level receipts?
   PSV's archive has congregation-level receipts; per-member giving is a
   congregation concern. Affects whether Section Q's `giving_*` tables are
   presbytery-visible at all *(they should not be)*.
6. **Care ministry for `unmanaged` congregations** — stewarded by the presbytery
   (D9) would put a presbytery inside a congregation's tier-3 pastoral data. That
   seems clearly wrong and may be the first case where stewardship must be
   *partial*, not whole-record.
