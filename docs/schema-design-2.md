# Schema design, round 2 — full-domain first pass

**Status:** DRAFT, three review rounds. Not implemented. No migrations written.
**Date:** 2026-09-24. Round 3 (§2b) reconciled the §3–§8 table shapes with the
decisions and with the built schema; the DDL pipeline starts from §2b's shapes.
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
| **D10** | Organization lifecycle is an **immutable event history** | `organized`, `received`, `merged`, `divided`, `dismissed`, `dissolved` — the vocabulary of G-3.0301(c) — are **dated, minuted events**, not values of a status column. Organizations are never deleted and historical identity is permanent; a dissolved slug is never reissued. Successor/predecessor relationships hang off the events. *(Rephrased after review round 2 — see the topology note below.)* | Without it, a presbytery cannot hold the history of a church that closed — 87 of PSV's ~172 congregations — and every trend report silently truncates to the survivors. Without the minute reference, a dissolution is unattributable, which is what review exists to prevent. |
| **D11** | Generated and imported returns have different **reconciliation** semantics | A generated return **must reconcile** against the roll (beginning balance + gains − losses = ending active). An imported historical return **records what was reported** and is never corrected to satisfy a current rule. Separate storage follows: typed and current-form for what we derive; form-versioned `payload jsonb` for what we archive. *(Rescoped after review round 2 so it no longer overlaps D21 — D11 is projection vs imported history; D21 is live vs submitted state.)* | Forcing both into one shape means either adding nullable columns retroactively on every form revision, or "fixing" a 1987 return to satisfy a rule written in 2024. |
| **D12** | Statistical form versioning | **A `sasr_form_version` reference table**, and every archive row names its version. Typed *reporting views* are built per version; the storage is the payload. | A single flat shape either loses old fields or accumulates them forever (F31). |
| **D13** | Import quarantine is first-class | **Unresolved rows land in a durable staging table with the raw payload, a reason, and a resolution workflow** — never an error log. Resolution can create a `dissolved` organization (D10). | F32. This is the difference between a 48%-failed import and a 100%-preserved one. |
| **D14** | Congregation name history | **Organizations carry dated name aliases** (`organization_name_history`), used for import matching and for rendering a historical report under the name in force that year. | Renames are routine over 41 years and `slug` immutability (the `(org)` contract) does not help matching on legacy names. |
| **D15** | Presbytery oversight ≠ congregation finance | **The presbytery's loan/insurance/property book is presbytery-owned data *about* a congregation** (`about_org_id`, the existing `congregation_oversight` pattern), entirely separate from Track E's congregation ledger. | PSV's `congregation_insurance` holds PILP balances, original loan amounts, mortgage grants and loan guarantees — the presbytery's own exposure, not the church's books. Conflating them would put a presbytery's risk register inside a tenant's ledger. |
| **D16** | Statistics may be submitted without an account | **A signed, expiring, single-`(org, year)` submission grant**, verified and attributable, feeding the existing `provenance` / `minute_reference` fields. | The operator wants clerks to submit online and "make it super easy"; requiring a full tenant account for an `unmanaged` congregation defeats D9's whole premise. |
| **D17** | Pastoral acts are first-class records, not roll side-effects | **`pastoral_acts`** (baptism, marriage, funeral, confirmation, ordination service) recorded in their own register, *referencing* roll actions where one results rather than being derived from them. | A baptism is a sacrament with its own register, officiant and minute reference. A wedding involves people who may not be members at all. A funeral is not the same fact as a roll removal, though it usually accompanies one. |
| **D18** | Care ministry is tier 3 and separately gated | **`care_*` tables at sensitivity tier 3**, above financial, with visibility never inherited from directory or staff permissions. | Invariant "No Role Carries a Wildcard" already puts pastoral notes above financial data. Care ministry is the largest concentration of tier-3 content in the product and the easiest to leak by accident. |

---

## 2a. Round-2 external review — accepted changes

An external review of this draft (2026-09-24) raised three structural points this
document had missed. All three are accepted; they become **D19–D23**. Two further
points are accepted as refinements, and one is only half-right — recorded below
because the distinction matters.

### Accepted: three concepts were implicit that should be schema

| # | Decision | Choice |
|---|---|---|
| **D19** | **Council affiliation is a third axis, with history — and it owns the truth** | Existence (D10), platform participation (`platform_status`, D9) and **council affiliation** are three axes, not two. A congregation's presbytery can change without the congregation changing — synod redistricting, boundary revision, transfer between presbyteries. **`organization_affiliations`** records `(organization_id, parent_org_id, relationship_type, effective_from, effective_to, reason, authority, minute_reference)`. **Affiliation history is authoritative; `organizations.parent_id` is derived.** |
| **D20** | **Publication is a first-class, immutable event that *references* an artifact** | The invariant "access flows up by publication" was stated but never modelled. **`publications`** is the *event*: `source_org_id`, `recipient_org_id`, `record_class`, `artifact_id`, `published_at`, `supersedes_id`, `authorized_by`, `minute_reference`, `withdrawn_at`. The artifact it points at is a separate, immutable record (for statistics, the D21 frozen submission). A recipient council reads **the artifact published to it**, never the source's live data. |
| **D21** | **A submitted return freezes; a generated one does not** | Three states, not two: `statistical_projection` (computed live from the roll, recomputable), `statistical_submission` (frozen attested snapshot at submission), `sasr_archive` (imported, immutable). |

**Why D19 matters more than it looks.** The 41-year archive is the proof: a
congregation's 1990 return may have been reported to a *different* presbytery than
the one holding it today. With only `parent_id`, the archive cannot say which
council received it, and `sasr_archive.organization_id` becomes quietly wrong for
any congregation whose presbytery changed. This was invisible from inside either the
organization module or the statistics module — exactly the class of defect the
full-domain pass exists to catch.

**D19's three database invariants.** Once the history table exists, `parent_id` and
the currently-effective affiliation row are *two representations of one fact* — and
the defect D19 fixes for 1990 would reappear at the present-day boundary the moment
they disagree. So:

1. **Effective ranges may not overlap** for the same child and relationship type.
2. **At most one affiliation is current** for a relationship that is singular.
3. **`organizations.parent_id`, if retained, is maintained *from* the current
   affiliation and is not independently editable.** Keep it only as a materialized
   convenience for tree traversal.

This project already has the precedent and the scar tissue for exactly this shape:
`memberships.current_roll` is a documented **cache** that drifts, with
`presby_roll_cache_drift()` and a daily reconcile to catch it (F29). `parent_id`
would be the same category of object — so either derive it strictly, or give it the
same drift detection. Do not let it become a second editable source of truth.

**Affiliation changes carry provenance.** A redistricting that changes forty years of
reporting attribution is a governing act, not a data edit — so `effective_from`,
`authority`, and a minute or governing-action reference, for the same reason D10's
lifecycle events carry them.

**Why D21 matters.** `roll_actions` is append-only *and correctable by void*. So the
roll can legitimately change after a return is filed, which means "what the roll
implies for 2026" and "what this congregation reported for 2026" diverge — and both
are true. The existing design carries `status: draft | session_approved | submitted`,
but a status flag does not freeze a payload. Submission must snapshot.

**D20 and D21 compose — but they are two entities, not one.** A second review pass
caught this document overstating the point. The artifact a congregation publishes to
its presbytery *is* the frozen submission; **publication references that artifact, it
does not absorb it.** They answer different questions:

- **The submission** answers *what exactly did this congregation report for 2026?* —
  and owns `form_version`, `report_year`, `attested_by`, the frozen `payload`. True
  regardless of where, or whether, it is ever published.
- **The publication** answers *when, by what authority, and to whom was that artifact
  delivered?* — and owns `recipient_org_id`, `published_at`, `supersedes_id`,
  `minute_reference`, `withdrawn_at`. None of which belongs to the artifact.

So `publications.artifact_id → statistical_submissions.id`, with `publications` kept
generic enough to reference other immutable record classes later. **The practical
payoff of keeping them separate:** one artifact can be published to more than one
recipient — or republished after a supersession — without being copied.

That composition is what makes the publication invariant enforceable rather than
aspirational: a presbytery holding a published artifact cannot accidentally be reading
a congregation's live tenant data.

### Accepted: two refinements

| # | Decision | Choice |
|---|---|---|
| **D22** | **Person merges are explicit, provenanced and auditable** | `people` is global (D1), so a wrong merge is a **cross-tenant disclosure**, not a data-quality nuisance: it joins one congregation's person to another's view. Therefore — no automatic merge on matching name or email, ever; `presby_match_person()` proposes, a human disposes; every merge records actor, date, rationale and the candidate set considered; and merges are auditable and reversible in effect. |
| **D23** | **Care-ministry grants are purpose-scoped and non-transitive** | Extending D18: a grant naming care access is purpose-specific, optionally time-limited, separately audited, **non-transitive**, and **excluded from platform-support and impersonation paths except as deliberate break-glass**. "Administrator" must not imply "can read bereavement notes." This is the same reasoning as the existing no-wildcard invariant, applied to the product's most sensitive surface. |

Also folded in: **D13** quarantine rows additionally record the import batch, source
file/worksheet/row identity, the original organization name, **the candidate matches
considered**, the resolving actor, date and rationale, and whether resolution mapped
to an alias or created a historical organization. **D14** becomes *typed* names with
validity ranges — `canonical`, `former_name`, `historical_name`, `abbreviation`,
`legacy_import_name` — so the importer has somewhere to keep a dirty matching string
without implying it was ever an official name.

Two items promoted out of "still open" into decisions: **per-member giving is never
visible to a parent council** (an invariant with a test, not a default), and **a
dissolved organization's slug is never reissued** (archival identity, not a UI
concern — folded into D10).

### Partly accepted: the "two hierarchies" heading

The review objects that "two hierarchies that intersect nowhere" overstates, since
the councils clearly do interact through publication, delegation and administrative
commission — and proposes "ecclesiastical standing never implies platform access."

**The proposed wording is better for a general audience, but the original claim is
not wrong**, and the difference is worth keeping straight. The invariant is about the
two **axes** — ecclesiastical standing versus platform administration — and those
genuinely do not intersect: a platform admin is not above a synod. Publication,
delegation and commission are movements *within* the ecclesiastical axis, not bridges
between the axes.

The misreading was invited by the presentation, not the claim: the overview figure
drew the publication arrow inside the same frame as the axis comparison. **Fix the
figure, keep the invariant.** `CLAUDE.md` names this invariant "Two Hierarchies
Intersect Nowhere," so renaming it is a change to a project invariant rather than a
heading tweak — not something to do casually, and not something this review settles.

*Resolved in round 2: the reviewer withdrew the objection, and observed that the
retained framing is the stronger one because it states something **testable** — no
platform role can acquire ecclesiastical authority merely by its position on the
platform. That sentence is now the property named in the CI gate above.*

### Accepted as a standing CI property, not a go-live gate

Before any congregation adopts the platform, prove as a **property** — not as a
collection of permission tests — that no presbytery-level role, *including platform
support roles operating through normal application paths*, can read an adopting
congregation's private tenant data except through published, delegated, commissioned
or explicitly stewarded record classes.

**And keep proving it.** Review round 2 is right that this belongs in CI rather than
in a launch checklist: any future permission change capable of violating the property
should fail automatically. That is this project's existing idiom — `check:audit`,
`check:brand-scope`, `check:sql-date`, `check:deps-drift`, `check:secrets` are all
tripwires that turn a review finding into a build failure. This property is more
load-bearing than any of them.

It also has a testable companion form, which came out of the heading discussion
below: **no platform role can acquire ecclesiastical authority merely by its position
on the platform.** That is assertable, not just assertable-sounding.

Related and already known: the inherited `ADMIN_ROLE` wildcard in
`src/lib/permissions.ts` is a live violation of the spirit of this gate. It is
bounded — platform shell only, and the tenant connection cannot bypass RLS — but it
should be closed before this gate can honestly be called met.

---

### Next step: D10, D19, D20 and D21 are designed together

Review round 2's closing recommendation, accepted: these four are coupled tightly
enough that designing them sequentially would produce four shapes that do not fit.
The dependency runs through them in one line —

> permanent organization identity (D10) → historical affiliation (D19) → global person
> with tenant membership (D1) → append-only roll → live statistical projection →
> frozen submitted artifact (D21) → immutable publication event (D20) → recipient sees
> only what was published

— so broad schema discovery is complete and the next pipeline is table-and-constraint
design across **D10 / D19 / D20 / D21 as one unit.** D22 and D23 are independent of
that unit and can run separately.

---

## 2b. Round-3 review — table shapes reconciled with the decisions and the built schema

A third pass (2026-09-24, `docs/reviews/2026-09-24-schema-design-round-3.md`) read
§3–§8 against §2/§2a **and against what is already built** in
`src/lib/db/domain/` and `drizzle/0038`. Verdict: the decisions hold; the table
shapes had not caught up with them, and three collided with existing tables. All
sixteen findings (R3.1–R3.16) are accepted. The sections below were **rewritten in
place** rather than annotated, so §3–§8 now show the round-3 shapes; the review file
keeps the before/after argument. What changed, by decision:

| # | Decision / finding | Change |
|---|---|---|
| **D10** | *(R3.1)* §3 still carried the pre-round-2 shape — editable `lifecycle_status`/`lifecycle_date`/`merged_into_org_id` on `organizations` and an events table with no topology. | Events table + **`organization_successions`** (N→1 and 1→N). `lifecycle_status` is a trigger-maintained cache with F29-style drift detection, or a view. `merged_into_org_id` and `organized_year` dropped. **Not** named after `people.merged_into_id`: a person merge is deduplication (follow the chain), a congregation merge is a polity event (do *not* follow it — that mis-attributes history). |
| **F35** *(new)* | *(R3.2)* The built `organizations` already has an unused `status text default 'active'`. | The D10 migration drops or repurposes it. Two status columns with one default is the second-source-of-truth hazard D19 names. |
| **D24** *(new)* | *(R3.3)* `pcusa_pin` already exists on tenant-scoped `organization_settings`; the importer, running as the presbytery, cannot read it. | **`organization_identifiers`** (`kind: pcusa_pin \| psvonline_congregation_id \| church360 \| legacy_import`), mirroring `person_identifiers`. `pcusa_pin` **moves** there. Gives the PSV port an idempotent org mapping (program doc, model conflict 1). |
| **F36** *(new)* | *(R3.4)* **Publication is already built.** `congregation_statistics` has frozen published rows, `supersedes_publication_id`, `published_at`, `minute_reference`, a freeze trigger and `presby_publish_sasr_snapshot()` (DECISION-118/120). D20/D21 designed a second mechanism and never said what happens to the first. | Option (a) adopted: `congregation_statistics` stays the presbytery's typed keyspace; its published rows become a **projection of a `publications` row** (`publication_id` not null for that provenance; the event columns move to `publications`). The migration **backfills** one publication per existing published row. The publish function writes return → publication → statistics row in one transaction. |
| **D19** | *(R3.4, rule)* Which presbytery receives a late filing after a redistricting? | **The presbytery of current membership at `published_at`** (the reviewing council, G-3.0107). The archive's attribution function is the same function, so 1990 and 2026 answer the same way. |
| **D21 → D25** *(new)* | *(R3.5)* The projection is a function, not a row; `statistical_submission` and `sasr_archive` differ only in provenance and owner. | **One table, `statistical_returns`**, `provenance: submitted \| imported`. D11's reconciliation rule applies at write time to `submitted` only. `sasr_reports` survives only as the congregation's working draft; `submitted` stops being a draft status and becomes the existence of a return row. **`sasr_form_versions.field_spec` is enforced by trigger** (keys ⊆ spec, types, bounds) — otherwise DECISION-118's allow-list property is lost. |
| **D19** | *(R3.6)* Column list lacked `relationship_type`/`authority`; invariants had no mechanisms. | Exclusion constraint on `daterange(effective_from, effective_to, '[)')` per `(organization_id, relationship_type)` — **needs `btree_gist`**, named in the migration (`path` was designed as `ltree` and built as `text`; extensions have slipped before). `parent_id` **and `path`** derived by trigger; direct `UPDATE ... parent_id` rejected outside the trigger's GUC; reparenting rebuilds the subtree's paths. Parent type must fit child type. A dissolution closes the open affiliation. |
| **D26** *(new)* | *(R3.7)* Lifecycle events and affiliations are acts of a council about an organization (G-3.0301(c)). | Both are **council-owned rows** in the `about_org_id` pattern: `organization_id` = the acting council, `subject_org_id` = the organization acted upon, FORCE RLS, ordinary tenant policy. Minute references and notes stay inside the council's records; the public tree exposes only `(child, parent, from, to)`. `platform_status` remains a platform-admin act — three axes, three write paths. |
| **D11** | *(R3.8)* `unique (organization_id, about_org_id, report_year)` on the archive breaks on an amended return or a merge year with two predecessors. | Dropped. Deduplication happens in D13's staging workflow where the candidate set is visible. |
| **F37** *(new)* | *(R3.9)* F33's matching key `(name, city, year)` had no home: `organization_profiles` does not exist for unmanaged congregations. | `organization_name_history` gains `name_type` (as §2a already said), `city`, `state`; index `(lower(name), lower(city))`. |
| **D16** | *(R3.10)* The grant row absorbed the submission (`submitted_payload`, attestation columns). | The grant is a **credential**; what it produces is a `statistical_returns` row (`provenance = 'submitted'`) plus an automatic `publications` row to the issuing presbytery. `token_hash unique`; one live grant per `(org, about, year)`. **Stated consequence:** a grant-submitted return for an `unmanaged` congregation is owned by the congregation, in a tenant nobody can enter; when it becomes `managed` it inherits its own filing history — D9's handover working as designed. |
| **F2** | *(R3.11)* Every `person_id` in §7/§8 was drawn bare. | All are composite `(person_id, organization_id) → memberships`. `officiant_person_id` cannot be (a minister of another presbytery has no membership here): **`officiant_name` required, composite `officiant_person_id` optional**, no global reference. `resulting_roll_action_id` is composite to `roll_actions`; a later void leaves the act pointing at the voided action, deliberately. |
| **D10** | *(R3.12)* Every tenant FK cascades on org delete, and 58 orgs were cascade-deleted from production on 2026-08-31. `revoke delete from presby_app` does not touch the owner path. | A `BEFORE DELETE` guard with an **explicit fixture exemption** — decision open in `docs/TODO.md`. "Never" that fixture cleanup violates monthly is not an invariant. |
| **D23** | *(R3.13)* Enforcement mechanism was implicit; anything flowing through `role_grants` is transitive by construction. | A separate **`care_grants`** table (grantee, purpose, expires, granted_by, minute_reference), never a catalog permission key; `care_*` tables readable only through SECURITY DEFINER functions that check the grant (the `presby_match_person()` "controlled read, not a policy" idiom) — so §17's two-named-policies rule stands. `care_assignments` does **not** reference the Diaconate group (Stephen ministers and pastors carry care loads). |
| **§9.1** | *(R3.14)* `about_org_id` is a paper invariant on five tables. | D19 makes it enforceable: `presby_org_affiliated(subject, council, as_of)` (SECURITY DEFINER) called from one trigger on every about-org table; one `test-rls.sql` section. |
| **F34** *(promoted)* | *(R3.15)* Cross-generation comparability, §10.1. | The normalising view exposes a field for a span **only if every form version in the span maps it**; otherwise the column is absent, so the query fails to compile rather than returning zeros. `field_spec` carries `comparable_to`. |
| **D13** | *(R3.16)* Staging shape. | `import_batches` (source, worksheet, form version, **column map** — F32's positional arrays only decode per tab) + `import_rows` (raw row, original name, city, candidates, resolution kind, resolver, rationale, resulting return). Presbytery-owned, FORCE RLS. |

**Migration order for the D10/D19/D20/D21 pipeline** (from the review's §D):
(1) `organization_identifiers`, move `pcusa_pin`, drop `organizations.status`;
(2) lifecycle events + successions + affiliations as council-owned rows, the
`parent_id`/`path` triggers, `btree_gist`, the delete guard, backfill one event and
one affiliation per existing org; (3) `presby_org_affiliated()` and the about-org
trigger on the five existing tables; (4) `sasr_form_versions` with its enforcing
trigger, `statistical_returns`; (5) `publications`, the `congregation_statistics`
retrofit with backfill, the rewritten publish function, `sasr_reports`' fate;
(6) submission grants — its own security review; (7) name history with city, D13
staging.

---

## 3. Section M — Organization lifecycle *(new — shape revised in round 3)*

Answers F30 / D10.

```
organizations                      (existing — extended)
  - status                          -- DROPPED (F35): unused since provisioning
                                    -- shipped; would otherwise sit beside the
                                    -- cache below with the same default
  + lifecycle_status   text not null default 'active'   -- CACHE, trigger-
        -- maintained from the events below, never written directly; drift
        -- check per F29. Vocabulary from G-3.0301(c):
        active | merged | divided | dismissed | dissolved
  + lifecycle_as_of    date         -- effective_on of the event that set it
  parent_id, path                   -- BOTH now derived from the current
                                    -- affiliation (D19 invariant 3); a direct
                                    -- UPDATE is rejected outside the trigger
  -- pcusa_pin: NOT here — see organization_identifiers (D24)
  -- no merged_into_org_id, no organized_year: both live in the events

organization_identifiers           (new)   D24 — mirrors person_identifiers
  organization_id, kind, value_normalized, is_verified, source
  -- kind: pcusa_pin | psvonline_congregation_id | church360 | legacy_import
  unique (kind, value_normalized) where is_verified

organization_lifecycle_events      (new)   D10 — the record; council-owned (D26)
  id, organization_id,              -- the ACTING council (the presbytery)
  subject_org_id,                   -- the organization acted upon
  event,                            -- organized | received | merged | divided
                                    -- | dismissed | dissolved
  effective_on, minute_reference,
  external_body,                    -- for dismissed / received: the other
                                    -- denomination or body
  recorded_by, recorded_at, notes
  unique (id, organization_id); FORCE RLS, tenant policy
  -- trigger: sets subject's lifecycle cache; on dissolved/merged/divided/
  -- dismissed, closes the subject's open affiliation on effective_on

organization_successions           (new)   D10 — the topology
  event_id, predecessor_org_id, successor_org_id
  -- merged:  N rows sharing a successor    divided: N rows sharing a predecessor
  -- CHECK predecessor <> successor; each must be the event's subject or a
  -- named successor. NOT a merge chain to follow — see §2b on D10.

organization_affiliations          (new)   D19 — the THIRD axis; council-owned
  id, organization_id,              -- the council with authority over the
                                    -- change (presbytery, synod, or GA)
  subject_org_id, parent_org_id,
  relationship_type,                -- member_congregation | member_presbytery
                                    -- | member_synod (singular each)
  effective_from, effective_to,     -- '[)'; null = current
  reason, minute_reference, recorded_by, recorded_at
  unique (id, organization_id); FORCE RLS, tenant policy
  exclude using gist (subject_org_id with =, relationship_type with =,
                      daterange(effective_from, effective_to, '[)') with &&)
                                    -- requires btree_gist: name it in the
                                    -- migration and check it exists
  -- trigger (SECURITY DEFINER, F26): maintains organizations.parent_id and
  -- path for the subject and its subtree; checks parent type fits child type
  -- public projection: a view of (subject, parent, from, to) only
```

**Why this is an event ledger and not a status column.** Review round 2 made the
decisive argument: these events have **topology**, and a single enum plus a single
`merged_into_org_id` cannot carry it.

| Event | Shape |
|---|---|
| `merged` | N organizations → 1 successor |
| `divided` | 1 organization → **N successors** |
| `dismissed` | organization → an external ecclesiastical body |
| `received` | an external body → an organization inside this system |

`divided` is the one that breaks a single merge target outright. So `lifecycle_status`
is a *derived* convenience for "what is this organization now"; the events are the
record, and successor/predecessor links hang off them. This round does not design that
relationship graph — it only declines to foreclose it.

**Existence vs affiliation — the polity distinction.** The external review was right
that these are separate axes, and the mapping needs care:

- `dissolved`, `merged`, `divided` — existence changes.
- **`dismissed` is also an existence change in our universe**, because in PC(USA)
  usage a congregation is dismissed *to another denomination*: it ceases to be a
  PC(USA) congregation. It survives as an institution; it leaves the data model's
  world.
- `received` — the mirror: received from another denomination.
- **Transfer between presbyteries is NOT a lifecycle event.** It is an affiliation
  change (D19), and the draft's original `transferred` state conflated the two. A
  congregation moved by synod redistricting has not changed what it is.

```
organization_name_history          (new)   D14 / F37
  organization_id, name_type,       -- canonical | former_name | historical_name
                                    -- | abbreviation | legacy_import_name
  name, city, state,                -- a name AT A PLACE is the matching unit (F33)
  effective_from, effective_to
  index (lower(name), lower(city))
```

Notes.

- **`lifecycle_status` and `platform_status` are orthogonal.** A `dissolved`
  congregation was very likely `unmanaged`; a `managed` tenant can dissolve. Two
  axes, two columns — the same discipline as `canAccessAdmin` vs `isPlatformAdmin`
  (DECISION-044). Affiliation is the third axis and has its own write path.
- **Three axes, three write paths (D26).** Lifecycle and affiliation are council
  acts, written by the presbytery (or synod/GA) in its own tenant context through
  `withOrgContext()`, with an audit row. `platform_status` is a platform-admin act
  through `getPlatformDb()`. Nothing writes `parent_id`, `path` or
  `lifecycle_status` directly.
- **`delete` revoked on `organizations` from `presby_app`, plus a `BEFORE DELETE`
  guard on the owner path.** Every tenant FK cascades on org delete and the owner
  connection has used that path for fixture cleanup (2026-08-31). The guard needs an
  explicit fixture exemption — open decision in `docs/TODO.md` (R3.12).
- **Do not "follow the chain" through `organization_successions`.** A merged
  congregation's 1987 return stays attributed to the predecessor; the successor
  has no history before its `organized`/`merged` event. This is the opposite of
  `people.merged_into_id`, and the different table shape is meant to make the
  different query obvious.
- A dissolved congregation keeps its `slug` forever — settled in §2a, folded into
  D10.

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

## 5. Section O — The SASR: projection, returns, publication *(revises Section J; shape revised in round 3)*

Answers F31 / D11 / D12 / D20 / D21 / D25 / F36. **The most consequential part of
this pass.** Four things, of which only two are new tables:

```
-- 1. The PROJECTION is a function, not a row (D21 → D25).
presby_sasr_projection(org, report_year)   -- computed live from roll_actions,
                                           -- person_demographics, officer_terms…
                                           -- recomputable, never stored as truth

sasr_reports                      (existing, unused — becomes the WORKING DRAFT)
  … status: draft | session_approved ONLY. `submitted` is no longer a status:
    it is the existence of a statistical_returns row. Keeps the immutable
    official_beginning_balance and §13's reconciliation rule.

-- 2. The ARTIFACT: one table, two provenances (D25 — was statistical_submission
--    + sasr_archive; they differ only in who wrote it and who owns it).
sasr_form_versions                (new, platform-wide reference, no RLS, seeded)
  key ('1984', '2014', '2022', '2024'), label,
  effective_first_year, effective_last_year,     -- ranges may not overlap
  field_spec jsonb                  -- per field: key, type, bounds, SASR line,
                                    -- comparable_to (F34)
  -- ENFORCED by trigger on statistical_returns: payload keys ⊆ spec, types
  -- match, counts non-negative and bounded. Otherwise DECISION-118's
  -- allow-list ("a field with no slot cannot smuggle through") is lost.

statistical_returns               (new — IMMUTABLE, append-only)
  id, organization_id,              -- OWNER: the congregation for submitted,
                                    -- the presbytery for imported
  about_org_id,                     -- the congregation; may be dissolved (D10)
  report_year, form_version_key,
  provenance,                       -- submitted | imported
  payload jsonb not null,           -- as-reported, in that version's field names
  reconciled boolean not null,      -- true only for submitted (D11 applies at
                                    -- write time); imported is never reconciled
  attested_by_name, attested_role, attested_at,    -- submitted
  source_ref, staging_row_id,                      -- imported (D13 provenance)
  created_at
  unique (id, organization_id); FORCE RLS
  -- NO unique on (about, year): a corrected submission is a new row and
  -- publications.supersedes_id says which is current (R3.8)
  -- trigger: presby_org_affiliated(about_org_id, organization_id, report_year)
  -- for imported rows (R3.14)

-- 3. The PUBLICATION EVENT (D20) — references the artifact, never absorbs it.
publications                      (new — IMMUTABLE; withdrawal is a column, not
                                   a delete)
  id, organization_id,              -- OWNER: the source council
  recipient_org_id,                 -- the presbytery of CURRENT membership at
                                    -- published_at (D19 rule, §2b)
  record_class,                     -- 'statistical_return' today; generic
  artifact_id,                      -- → statistical_returns (id, organization_id)
  published_at, supersedes_id, authorized_by, minute_reference, withdrawn_at
  unique (id, organization_id); FORCE RLS
  -- read by the recipient through a SECURITY DEFINER function that filters
  -- recipient_org_id = presby_current_org() — the presby_list_own_
  -- congregation_publications() shape, not a bespoke policy (§17)

-- 4. The presbytery's TYPED KEYSPACE (existing, retrofitted — F36).
congregation_statistics           (built, drizzle/0038)
  + publication_id                  -- not null when provenance =
                                    -- 'published_by_congregation'
  - supersedes_publication_id, published_at, minute_reference
                                    -- MOVE to publications; the migration
                                    -- BACKFILLS one publication per existing
                                    -- published row before dropping them
  -- keeps provenance, the freeze trigger, the partial unique index, and every
  -- consumer (rollup, per-capita basis-year): DECISION-120's "same
  -- (about_org, year) keyspace regardless of who wrote it" still holds
```

`presby_publish_sasr_snapshot()` is rewritten to write, in one transaction: the
`statistical_returns` row (from the draft, reconciled) → the `publications` row
(recipient derived from the current affiliation, never passed) → the typed
`congregation_statistics` projection. Its parameter list stays the allow-list;
the returns trigger is the second, independent check.

Notes.

- **An imported return is never reconciled.** §13's rule
  (`official_beginning_balance + gains − losses = ending_active`) applies at write
  time to `provenance = 'submitted'`. An imported 1987 row is a historical
  assertion; if it does not balance, that is a fact about 1987, not an error to
  correct. `reconciled` records which rule was applied.
- **`about_org_id` must legally reference a non-`active` organization.** This is
  the concrete reason D10 exists.
- Reporting reads **one table** through a normalising view keyed on
  `form_version_key`. Trend queries span 1984→present without the table growing a
  column.
- **F34 — cross-generation comparability, settled.** The normalising view exposes
  a field for a requested span **only if every form version in the span maps it**
  (`field_spec.comparable_to`); otherwise the column is absent, so "members aged
  56–70, 1984→2024" fails to compile rather than returning zeros.
- **Which presbytery receives a publication** is the affiliation current at
  `published_at` — the reviewing council (G-3.0107). The archive's attribution
  reads the affiliation as of the report year. Both go through
  `presby_org_affiliated()`, so a redistricting cannot make the live and archival
  answers disagree.

## 6. Section P — Submission without an account *(new)*

Answers D16.

```
statistics_submission_grants      (new — shape revised in round 3: the grant is a
                                   CREDENTIAL; what it produces is a return)
  id, organization_id,           -- the presbytery issuing it
  about_org_id,                  -- the congregation being asked
  report_year,
  token_hash unique,             -- never the token itself
  issued_to_name, issued_to_email,
  issued_by, issued_at, expires_at,
  submitted_at, return_id,       -- → statistical_returns; the attestation
                                 -- columns live on the return, not here
  revoked_at
  unique (organization_id, about_org_id, report_year)
    where revoked_at is null and submitted_at is null   -- one live grant
```

Notes.

- **Single-purpose, single-year, single-congregation, expiring.** The grant is not
  a login and grants no read access to anything else.
- **What a grant submission writes:** a `statistical_returns` row owned by the
  *congregation* (`provenance = 'submitted'`, attested, form-version-validated) and
  an automatic `publications` row to the issuing presbytery, `authorized_by` the
  attestation. For an `unmanaged` congregation that return sits in a tenant nobody
  can enter — deliberately. When the congregation becomes `managed`, it inherits
  its own filing history on day one and the presbytery's stewardship lapses. That
  is D9's handover working as designed.
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
-- Every person_id below is COMPOSITE (person_id, organization_id) → memberships
-- (F2). `people` is global; a bare reference would let a presbytery hold a
-- bereavement note about a congregation's member. (Round 3, R3.11.)

pastoral_acts                     -- the register (D17)
  organization_id, act_type,      -- baptism | marriage | funeral |
                                  -- confirmation | ordination_service
  occurred_on, location,
  officiant_name not null,        -- may be a minister of another presbytery,
  officiant_person_id,            -- who has no membership here — so the name
                                  -- is the record and the composite reference
                                  -- is optional. No global people reference.
  minute_reference,
  resulting_roll_action_id,       -- nullable; composite → roll_actions. A later
                                  -- void leaves the act pointing at the voided
                                  -- action, deliberately: the register entry
                                  -- stands, the roll correction is separate.
  register_number, notes

pastoral_act_participants         -- role-per-person, because a wedding has two
  pastoral_act_id, person_id,     -- person_id nullable: non-members marry here
  participant_name,               -- for the non-member case
  participant_role               -- baptizand | parent | sponsor | spouse |
                                 -- deceased | next_of_kin | witness

care_grants                       -- D23's mechanism (round 3, R3.13)
  organization_id, grantee_person_id, purpose,
  -- bereavement | hospital | crisis | general_care
  granted_by, granted_on, expires_on, minute_reference, revoked_at
  -- NEVER a permission-catalog key: anything flowing through role_grants is
  -- transitive by construction. care_* tables are readable only through
  -- SECURITY DEFINER functions that check this table — the "controlled read,
  -- not a policy" idiom — so §17's two-named-policies rule stands.

care_interactions                 -- tier 3 (D18)
  organization_id, person_id, occurred_on, interaction_type,
  -- visit | call | hospital | bereavement | crisis | prayer_request
  recorded_by, summary, follow_up_on, closed_at

care_assignments                  -- who is responsible for whom
  organization_id, person_id, caregiver_person_id,
  -- often a deacon, but NOT constrained to the derived Diaconate group:
  -- Stephen ministers and pastors carry care loads too (round 3)
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
- **Care ministry overlaps the diaconate presby already models but is not bounded
  by it.** The Diaconate group stays the derived roster it is; `care_assignments`
  does not FK to it (round 3 reversed the earlier suggestion — it over-constrained
  and would end an assignment with the term).
- **Tier 3, and the hardest privacy surface in the product.** A bereavement note is
  more sensitive than a giving record. Visibility is a `care_grants` row, never a
  consequence of holding `directory.view`, being staff, or holding any catalog
  permission. `check:audit` treats every `care_*` mutation as security-sensitive.
- Households already exist (`households`, `addresses`). This pass adds no household
  tables; it assumes the existing model and flags below that Church360's household
  semantics need a reconciliation pass.

---

## 9. Cross-cutting consequences

1. **`about_org_id` becomes a recognised pattern**, not a one-off. Presbytery-owned
   rows concerning another organization now appear in oversight, property, loan
   exposure, viability, returns, lifecycle events and affiliations. It deserves a
   documented convention alongside the composite-tenant-key rule — including that
   `about_org_id` is *not* a tenant FK and must not be confused for one. **Round 3
   gives it teeth:** `presby_org_affiliated(subject, council, as_of)` (SECURITY
   DEFINER, reads `organization_affiliations`) called from one trigger on every
   about-org table, `as_of` = the row's year for statistics and `now()` for
   oversight. It is paper on five built tables today (`presbytery.ts` says so).
2. **Two "permanent record" invariants now exist** — people and organizations.
   State them together — and state the one place they differ: a person merge is
   followed, a congregation merge is not (§3).
3. **Append-only appears four times**: `roll_actions`, `ledger_transactions`,
   `statistical_returns`, `publications`. One convention, one trigger pattern, one
   test shape.
3a. **Bare `person_id` is never legal on a tenant table.** Same rule as F2, restated
   because the §7/§8 sketches drew it bare four times. Composite to `memberships`,
   or a name column when the human has no membership here.
4. **Tier 3 grows substantially** (demographics, medical, pastoral notes, and now
   care interactions). Worth re-reading the tier model as a whole rather than
   adding to it.
5. **`payload jsonb` reappears.** Rule: jsonb is legitimate only for as-reported
   external data whose shape we do not control, **and only when a trigger validates
   it against a declared spec** — so it does not become an escape hatch that defeats
   D8's no-custom-fields decision. After round 3 exactly one table qualifies:
   `statistical_returns` (validated against `sasr_form_versions.field_spec`).
   `sasr_reports.payload` is the working draft's scratch and never leaves the
   congregation; the grant row carries no payload at all.

## 10. Open questions

1. ~~**Cross-generation SASR comparability** (§5).~~ **Settled as F34 (round 3):**
   the normalising view exposes a field for a span only if every form version in
   the span maps it; otherwise the column is absent and the query fails to compile.
2. ~~Does a dissolved congregation keep its slug forever?~~ **Settled: never
   reissued** — folded into D10 (§2a). Archival identity, not a UI concern.
3. **Church360 household semantics** vs presby's `households` — same concept?
   Needs a field-level pass before the import.
4. **Who may issue a submission grant** (§6) — presbytery staff only, or may a
   congregation's own clerk request one for themselves?
5. ~~Does PSV need per-member giving detail?~~ **Settled: per-member giving is never
   visible to a parent council** — promoted to an invariant with a test (§2a). PSV's
   archive carries congregation-level receipts, which is all a presbytery needs.
6. **Care ministry for `unmanaged` congregations** — stewarded by the presbytery
   (D9) would put a presbytery inside a congregation's tier-3 pastoral data. That
   seems clearly wrong and may be the first case where stewardship must be
   *partial*, not whole-record.
7. **The organization-deletion exemption** (round 3, R3.12). Fixture cleanup
   deletes organizations through the owner connection today; the D10 guard needs
   an explicit exemption (`platform_status = 'fixture'`, or `deletable_until`
   stamped at test provisioning). Tracked in `docs/TODO.md`; decide before the
   D10 migration.
8. **`sasr_reports`' fate** (round 3, R3.5). Survives as the congregation's working
   draft, or is dropped in favour of computing the projection on demand and
   freezing straight into `statistical_returns`. Decide in the DDL pipeline's
   Phase 3; either is consistent with D25.
