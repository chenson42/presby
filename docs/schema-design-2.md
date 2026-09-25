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
  the polity.** G-3.0301(a) makes the presbytery responsible for *"organizing,
  receiving, merging, dismissing, and dissolving congregations in consultation with
  their members."* That is the enum. The draft had invented `transferred`, had
  omitted `received` and `divided`, and — more importantly — had no
  `minute_reference`, when every one of these is a presbytery act taken *in
  consultation* and *subject to review*. Corrected in §3. **Correction (Phase 2,
  2026-09-24, Ruling 10):** this citation was originally recorded as G-3.0301(c) and
  cross-checked as "correct" by round 3 — wrong twice. G-3.0301(c) is a different
  list (ordaining/receiving/dismissing/installing/removing/disciplining ministers
  of the Word and Sacrament), which separately supplies the polity basis for what
  happens to a dissolved congregation's roll — see §3's dissolution note.
- **Stewardability is enumerated, not a matter of taste** (§6). G-3.0108(a) puts
  session minutes, rolls and registers under annual presbytery review (**corrected
  from a conflated "G-3.0107 / G-3.0108" citation, Phase 2 Ruling 10.2** —
  G-3.0107 is *Records*, a related but distinct provision: it is what makes a
  ceased council's records the property of the next higher council, not what
  puts a live council's records under annual review); G-3.0204(b) enumerates the
  registers themselves. Care-ministry notes are none of
  those.

**Rule going forward:** before naming a status, a role, a register or a lifecycle,
check whether the Book of Order names it. If it does, use its word. If we diverge,
say so and say why.

Citations verified 2026-09-24 against PC(USA) published sources and presbytery
clerk-of-session handbooks. Sections referenced so far: G-1.0401–G-1.0404
(membership rolls), G-2.0404 (terms of service), G-3.0107 (records; property of
the next higher council on cessation), G-3.0108(a) (administrative review),
G-3.0204(b) (session registers), G-3.0301(a) (congregational lifecycle),
G-3.0301(c) (jurisdiction over members of dissolved congregations).

**Re-verified against the full 2023–2025 Book of Order text, not a summary
(Phase 2, 2026-09-24, Ruling 10, DECISION-138).** Two citations above were wrong
on first pass and cross-checked as "correct" a second time by round 3 —
G-3.0301(c) was cited for the lifecycle vocabulary (it is actually G-3.0301(a));
G-3.0107 was cited for the reviewing-council/annual-review rule (it is actually
G-3.0108(a) — G-3.0107 is *Records*, and its real contribution is "when a council
ceases to exist, its records shall become the property of the next higher
council," which is the polity basis for the recipient read-back in §5, not for
who reviews annually). Every occurrence below is corrected. Also verified:
`divided` is not in G-3.0301(a)'s congregational vocabulary — it is verbatim
polity for presbyteries (G-3.0403(c)) and synods (G-3.0502(d)) — and "new
worshiping community" is our vocabulary, not the Book of Order's; the nearest
constitutional language is G-3.0301(b)'s "new church developments … and other
non-congregational entities."

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
| **D10** | Organization lifecycle is an **immutable event history** | `organized`, `received`, `merged`, `divided`, `dismissed`, `dissolved` — the vocabulary of G-3.0301(a) — are **dated, minuted events**, not values of a status column. Organizations are never deleted and historical identity is permanent; a dissolved slug is never reissued. Successor/predecessor relationships hang off the events. *(Rephrased after review round 2 — see the topology note below.)* | Without it, a presbytery cannot hold the history of a church that closed — 87 of PSV's ~172 congregations — and every trend report silently truncates to the survivors. Without the minute reference, a dissolution is unattributable, which is what review exists to prevent. |
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
| **D20** | **Publication is a first-class, immutable event that *references* an artifact** | The invariant "access flows up by publication" was stated but never modelled. **`publications`** is the *event*: `source_org_id`, `recipient_org_id`, `record_class`, `artifact_id`, `published_at`, `supersedes_id`, `authorized_by`, `minute_reference`, `withdrawn_at`, **`withdrawn_by`, `withdrawn_minute_reference`** *(added after the round-2 external note on withdrawal provenance, §2a; built in Phase 4 batch C — tech-lead ruling C5, second Phase 3 amendment, 2026-09-24)*. The artifact it points at is a separate, immutable record (for statistics, the D21 frozen submission). A recipient council reads **the artifact published to it**, never the source's live data. Withdrawal is a set-once transition on the three `withdrawn_*` columns together, written only by a future `presby_withdraw_publication()` `SECURITY DEFINER` function in `presby_transfer_affiliation()`'s confused-deputy shape — never a free `UPDATE`. |
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
> frozen submitted artifact (D21) → immutable publication event (D20) → recipient reads
> the published artifact, not the source's live state

*(Chain ending reworded after a post-round-2 external note: "sees only what was
published" overstated it — delegated, commissioned and stewarded access exist by
design; the invariant is that a recipient never reads the source's live tenant
state. The same note asked that withdrawal keep publication's append-only
discipline: `publications` therefore carries set-once `withdrawn_at`,
`withdrawn_by`, `withdrawn_minute_reference`, written only by a future
`presby_withdraw_publication()` DEFINER function — the DECISION-135 affiliation-close
shape — never a free UPDATE.)*

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
| **F35** *(new; corrected after batch A, 2026-09-24 — see below)* | *(R3.2)* The built `organizations` already has a `status text default 'active'`. | ~~The D10 migration drops or repurposes it.~~ **Not unused, and not dropped.** Five shipped `SECURITY DEFINER` functions gate an *anonymous public read* on `o.status = 'active'` (`drizzle/0020`, `0021`, `0024`, `0041`, `0042`) — Postgres records no column dependency inside a function body, so the drop would have succeeded at migration time and failed every public site at request time. Kept, with its meaning restated below rather than left implicit; two status columns with one default remains a hazard only if `status` and `lifecycle_status` are ever asked the same question, which the restated meaning forecloses. |
| **D24** *(new)* | *(R3.3)* `pcusa_pin` already exists on tenant-scoped `organization_settings`; the importer, running as the presbytery, cannot read it. | **`organization_identifiers`** (`kind: pcusa_pin \| psvonline_congregation_id \| church360 \| legacy_import`), mirroring `person_identifiers`. `pcusa_pin` **moves** there. Gives the PSV port an idempotent org mapping (program doc, model conflict 1). |
| **F36** *(new)* | *(R3.4)* **Publication is already built.** `congregation_statistics` has frozen published rows, `supersedes_publication_id`, `published_at`, `minute_reference`, a freeze trigger and `presby_publish_sasr_snapshot()` (DECISION-118/120). D20/D21 designed a second mechanism and never said what happens to the first. | Option (a) adopted: `congregation_statistics` stays the presbytery's typed keyspace; its published rows become a **projection of a `publications` row** (`publication_id` not null for that provenance; the event columns move to `publications`). The migration **backfills** one publication per existing published row. The publish function writes return → publication → statistics row in one transaction. |
| **D19** | *(R3.4, rule)* Which presbytery receives a late filing after a redistricting? | **The presbytery of current membership at `published_at`**, recorded onto the `publications` row as `recipient_org_id` and never re-derived (the reviewing council, G-3.0108(a) — corrected from G-3.0107, Phase 2 Ruling 10; G-3.0107 governs a different fact, see D20/§5). The archive's attribution function is the same function, so 1990 and 2026 answer the same way. |
| **D21 → D25** *(new)* | *(R3.5)* The projection is a function, not a row; `statistical_submission` and `sasr_archive` differ only in provenance and owner. | **One table, `statistical_returns`**, `provenance: submitted \| imported`. D11's reconciliation rule applies at write time to `submitted` only. ~~`sasr_reports` survives only as the congregation's working draft~~ — **superseded, Phase 2 Ruling 6 / DECISION-137: `sasr_reports` is dropped outright** (zero rows on both production and development branches, zero application consumers, a shape already stale under D25). The working-draft need it nominally served becomes a tracked design question for the future publish-UI pipeline (`docs/TODO.md`), not inherited unmodified. `submitted` stops being a draft status and becomes the existence of a `statistical_returns` row. **`sasr_form_versions.field_spec` is enforced by trigger** (keys ⊆ spec, types, bounds) — otherwise DECISION-118's allow-list property is lost. |
| **D19** | *(R3.6)* Column list lacked `relationship_type`/`authority`; invariants had no mechanisms. | Exclusion constraint on `daterange(effective_from, effective_to, '[)')` per `(organization_id, relationship_type)` — **needs `btree_gist`**, named in the migration (`path` was designed as `ltree` and built as `text`; extensions have slipped before). `parent_id` **and `path`** derived by trigger; direct `UPDATE ... parent_id` rejected outside the trigger's GUC; reparenting rebuilds the subtree's paths. Parent type must fit child type. A dissolution closes the open affiliation. |
| **D26** *(new)* | *(R3.7)* Lifecycle events and affiliations are acts of a council about an organization (G-3.0301(a)). | Both are **council-owned rows** in the `about_org_id` pattern: `organization_id` = the acting council, `subject_org_id` = the organization acted upon, FORCE RLS, ordinary tenant policy. Minute references and notes stay inside the council's records; the public tree exposes only `(child, parent, from, to)`. `platform_status` remains a platform-admin act — three axes, three write paths. |
| **D11** | *(R3.8)* `unique (organization_id, about_org_id, report_year)` on the archive breaks on an amended return or a merge year with two predecessors. | Dropped. Deduplication happens in D13's staging workflow where the candidate set is visible. |
| **F37** *(new)* | *(R3.9)* F33's matching key `(name, city, year)` had no home: `organization_profiles` does not exist for unmanaged congregations. | `organization_name_history` gains `name_type` (as §2a already said), `city`, `state`; index `(lower(name), lower(city))`. |
| **D16** | *(R3.10)* The grant row absorbed the submission (`submitted_payload`, attestation columns). | The grant is a **credential**; what it produces is a `statistical_returns` row (`provenance = 'submitted'`) plus an automatic `publications` row to the issuing presbytery. `token_hash unique`; one live grant per `(org, about, year)`. **Stated consequence:** a grant-submitted return for an `unmanaged` congregation is owned by the congregation, in a tenant nobody can enter; when it becomes `managed` it inherits its own filing history — D9's handover working as designed. |
| **F2** | *(R3.11)* Every `person_id` in §7/§8 was drawn bare. | All are composite `(person_id, organization_id) → memberships`. `officiant_person_id` cannot be (a minister of another presbytery has no membership here): **`officiant_name` required, composite `officiant_person_id` optional**, no global reference. `resulting_roll_action_id` is composite to `roll_actions`; a later void leaves the act pointing at the voided action, deliberately. |
| **D10** | *(R3.12)* Every tenant FK cascades on org delete, and 58 orgs were cascade-deleted from production on 2026-08-31. `revoke delete from presby_app` does not touch the owner path. | A `BEFORE DELETE` guard with an **explicit fixture exemption** — decision open in `docs/TODO.md`. "Never" that fixture cleanup violates monthly is not an invariant. |
| **D23** | *(R3.13)* Enforcement mechanism was implicit; anything flowing through `role_grants` is transitive by construction. | A separate **`care_grants`** table (grantee, purpose, expires, granted_by, minute_reference), never a catalog permission key; `care_*` tables readable only through SECURITY DEFINER functions that check the grant (the `presby_match_person()` "controlled read, not a policy" idiom) — so §17's two-named-policies rule stands. `care_assignments` does **not** reference the Diaconate group (Stephen ministers and pastors carry care loads). |
| **§9.1** | *(R3.14)* `about_org_id` is a paper invariant on ~~five~~ **four** tables *(corrected after Phase 4 batch B, 2026-09-24 — see §2d Ruling B1; `per_capita_rates` never carried the pattern)*. | D19 makes it enforceable: `presby_org_affiliated(subject, council, as_of)` (SECURITY DEFINER) called from one trigger on every about-org table (`congregation_oversight`, `congregation_statistics`, `per_capita_records`, `appointments`); one `test-rls.sql` section. |
| **F34** *(promoted)* | *(R3.15)* Cross-generation comparability, §10.1. | The normalising view exposes a field for a span **only if every form version in the span maps it**; otherwise the column is absent, so the query fails to compile rather than returning zeros. `field_spec` carries `comparable_to`. |
| **D13** | *(R3.16)* Staging shape. | `import_batches` (source, worksheet, form version, **column map** — F32's positional arrays only decode per tab) + `import_rows` (raw row, original name, city, candidates, resolution kind, resolver, rationale, resulting return). Presbytery-owned, FORCE RLS. |

**Migration order for the D10/D19/D20/D21 pipeline** (from the review's §D):
(1) `organization_identifiers`, move `pcusa_pin`, drop `organizations.status`;
(2) lifecycle events + successions + affiliations as council-owned rows, the
`parent_id`/`path` triggers, `btree_gist`, the delete guard, backfill one event and
one affiliation per existing org; (3) `presby_org_affiliated()` and the about-org
trigger on the four existing tables *(corrected from "five," §2d Ruling B1)*; (4) `sasr_form_versions` with its enforcing
trigger, `statistical_returns`; (5) `publications`, the `congregation_statistics`
retrofit with backfill, the rewritten publish function, `sasr_reports`' fate
(**dropped, not kept — see the D21→D25 row above, Ruling 6**);
(6) submission grants — its own security review; (7) name history with city, D13
staging.

## 2c. Phase 2 architectural review — four new findings (F38–F41) and the function-mediation rule

*(2026-09-24, architect Phase 2, `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`,
DECISION-135/136. Continues the sequence after F37.)*

### F38 — `presby_app` already holds INSERT/UPDATE/DELETE on `organizations`, contradicting the design's own premise

§2b/§3 as first drafted assumed `organizations` grants `presby_app` `SELECT` only
(`drizzle/0009_presby_rls.sql:93`), so "nothing writes `parent_id`/`path`/
`lifecycle_status` directly" was treated as already true. Querying the live
development database instead: `presby_app` holds `SELECT, INSERT, UPDATE, DELETE`
on `organizations`, a table with `relrowsecurity = f`, `relforcerowsecurity = f`
and **no triggers at all**. Cause: `0009:93`'s grant is additive and never
revoked anything, and a separate blanket `grant ... on all tables ... to
presby_app` (genuinely required — `src/auth.ts:79` runs the NextAuth Drizzle
adapter on this same connection) swept `organizations` in alongside `users` and
`feature_flags`. `people` (`0009:376`) is the only table in the whole `drizzle/`
tree ever explicitly clawed back. No application path exploits this today, but
"the trigger must be `SECURITY DEFINER` for grant reasons" was a statement about
a migration file, not about the database, until increment 2 makes it true by an
explicit `revoke insert, update, delete on organizations from presby_app` and
`scripts/test-rls.sql` asserts the resulting grant shape directly.

### F39 — R3.4(a)'s `congregation_statistics` column-move breaks two shipped call sites

The retrofit as first drafted moved `minute_reference`, `published_at` and
`supersedes_publication_id` off `congregation_statistics` onto `publications`.
Two of the three break running code: `minute_reference` is written by
`setCongregationStatistics()` on `provenance = 'presbytery_entered'` rows
(`src/lib/presbytery.ts:637,664`) and is a **required** field on the live
presbytery-entry form (`statistics-schema.ts:22`) — a `presbytery_entered` row
has no `publications` row to hold it, and it is a different minute (the
presbytery's own data-entry minute) from the congregation's session minute
authorizing publication. `published_at` is ordered on at
`src/lib/presbytery.ts:522` and drives the provenance-coalescing rollup at
`:533-539`; moving it to `publications` (a table the presbytery cannot read —
`publications.organization_id` is the source congregation) would turn the
shipped rollup and the per-capita basis-year lookup into `SECURITY DEFINER`
joins for no gain. See Ruling 5 / DECISION-137 and the amended §5 below: only
`supersedes_publication_id` moves.

### F40 — a unique/EXCLUDE constraint on a FORCE-RLS table is a cross-tenant existence oracle

Unique and exclusion constraints are enforced against **all** rows, not the
RLS-visible subset. If `presby_app` keeps ordinary tenant DML on
`organization_affiliations`, any presbytery can probe
`insert (subject => <any org id>, parent => itself, from => …)` and learn from
the constraint-violation error whether that organization currently has an open
affiliation *anywhere* — a row it cannot see. This is DECISION-047's
enumeration-oracle class arriving through a constraint instead of a page.
Nobody had named this before Phase 2; it is what turns Ruling 1's DML revoke
from hygiene into a necessity (see §3 below).

### F41 — a bounded affiliation backfill blocks the import it is meant to protect

Backfilling the one production relationship (and every dev fixture) with
`effective_from = now()` or `created_at` asserts the relationship began on the
migration date. `presby_org_affiliated(subject, council, as_of => 1987)` then
answers **false** for the entire 41-year PSV archive — the about-org trigger
increment 3 installs would block the very import increment 7 exists to enable.
Fixed in §3 below: `effective_from` is nullable, and null means unbounded-below
("predates our records").

### The function-mediation rule (Ruling 1)

D26's council ownership of `organization_lifecycle_events` and
`organization_affiliations` is correct and stays — `reason`, `minute_reference`
and `notes` are genuinely the acting council's records, and a neutral
"registrar" owner would need either a synthetic tenant (a fourth axis the
platform does not otherwise have) or a world-readable table carrying the text
explaining why a church was dissolved. But council ownership under ordinary
`tenant_isolation` RLS makes D19's own headline scenario — a synod redistricting
a presbytery's congregation — structurally impossible: the synod's session
context is neither Presbytery A nor Presbytery B, so it can neither close A's
row nor open B's. The design already conceded this for reads
(`presby_org_affiliated()`, the public projection view); it now concedes it for
writes too, as a standing rule rather than a one-off:

> **Cross-council access to the three-axis organization tables
> (`organization_lifecycle_events`, `organization_affiliations`) is
> function-mediated, never policy-mediated.** `insert/update/delete` is revoked
> from `presby_app` on both; every cross-council read or write goes through a
> named `SECURITY DEFINER` function in the existing `presby_publish_sasr_
> snapshot()` / `presby_match_person()` idiom — never a third named cross-org
> RLS policy (`docs/schema-design.md` §17's two-named-policies rule,
> `person_links` / `transfer_certificates`, is unaffected; DECISION-112's
> refusal of a third stands).

The three new functions this rule requires — `presby_assert_council_authority()`,
`presby_apply_affiliation_to_org_tree()`, `presby_transfer_affiliation()` — are
specified in §3 below, alongside the existing `presby_org_affiliated()` and a new
`presby_affiliation_parent_as_of()`. `presby_list_published_returns_to_me()` is
the read counterpart for `publications`, specified in §5.

---

## 2d. Second Phase 3 loop-back — findings from Phase 4 batches B and C (F42–F45) and rulings

*(2026-09-24, tech-lead, second Phase 3 amendment,
`docs/work-log/2026-09-24-lifecycle-affiliation-returns.md` — "Amendment after
batches B and C." Batch A's own loop-back is folded in place above as inline
corrections rather than a numbered-findings section, since it was five discrete
buildability defects; batches B and C surfaced enough genuinely new findings to
warrant the same treatment §2c gave Phase 2's. None of the thirteen items ruled
on here required a Phase 4 loop-back — QA proceeded on the tree as built.)*

### F42 — `per_capita_rates` never carried the about-org pattern; the "five tables" count was wrong from round 3 forward

`per_capita_rates` (`organization_id, billing_year, basis_year, rate_per_member,
updated_by, updated_at`) is a presbytery's own rate schedule, not a row *about*
any particular congregation — it has no `about_org_id` and never did. The count
of five about-org tables traces to Phase 1's Gaps section naming it as one of
"four explicit plus one," carried forward uncorrected through Phase 2 and into
this document's own §9.1/R3.14 without being checked against the live schema —
documentation drift, not a design reversal. **The correct, now-authoritative
enumeration:** `congregation_oversight`, `congregation_statistics`,
`per_capita_records` (`about_org_id`), and `appointments` (`serving_org_id`).
§9.1, the R3.14 table row and the §2b migration-order line are corrected above
in place. `scripts/test-rls.sql` 33(a) asserts `per_capita_rates.about_org_id`'s
absence as a permanent regression guard.

### F43 — the about-org `as_of` instant is the row's whole year, tested at both endpoints; the gap is accepted

`presby_check_about_org_affiliated()` accepts a row if the about-org was
affiliated at **either** January 1 or December 31 of the row's year — a
deliberate under-approximation of "affiliated at some point during the year,"
chosen because a true range-overlap test against the recursive ancestry walk is
materially more machinery than the uncovered case (an affiliation that both
opens and closes inside one calendar year) is worth. **Accepted gap:** such a
year's row is refused by both the old and the new council. The fix, if it is
ever needed, is a range-overlap test inside `presby_org_affiliated()`, not a
schema change.

### F44 — `getPlatformDb()` connects as `neondb_owner`; grants do not constrain it, only triggers

`PLATFORM_DATABASE_URL` authenticates as `neondb_owner`, a member of both
`presby_platform` and `presby_app` who holds every privilege on every table by
**ownership**, independent of any `grant`/`revoke`. This does not weaken F38's
revoke or Ruling A5's grant-narrowing — both remain correct, both as the
statement that binds the day a real, non-owner `presby_platform` login role
exists, and as documentation of intent — but it means every claim in this
pipeline of the shape "X cannot happen because the grant forbids it" is false on
the `getPlatformDb()` connection today, and the only real backstop there is a
**trigger** (`presby_guard_organizations_delete()`, `presby_freeze_lifecycle_
event()`, `publications_freeze`, and their siblings). **Standing fact for every
future design that reasons about `getPlatformDb()`'s reach: reason from the
trigger layer, not the grant layer.** (A `CLAUDE.md` Key Invariants update
recording this platform-wide is proposed in `docs/TODO.md`, not made here —
Key Invariant edits are the documentation review's business, not a schema
pipeline's.)

### F45 — the `congregation_statistics` retrofit FK runs through `about_org_id`, not `organization_id`

The original Phase 3 Data Model specified `foreign key (publication_id,
organization_id) references publications (id, organization_id)`.
`congregation_statistics.organization_id` is the **recipient presbytery**;
`publications.organization_id` is the **source congregation** — different
organizations by construction (DECISION-120 meets D20) — so that FK would have
rejected the first row it was meant to protect. The column that actually equals
`publications.organization_id` is `congregation_statistics.about_org_id`:
`foreign key (publication_id, about_org_id) references publications (id,
organization_id)` is the corrected, adopted, and already-built shape. It
**preserves** F2's guarantee (a projection cannot claim a publication recorded
by a different congregation) rather than weakening it — only the column name in
the original spec was wrong, not the design's intent.

### Confirmations (no schema change; recorded so they are not re-litigated)

- **`statistical_returns_submitted_is_self` does not block the future D16 grant
  flow.** §5's own D16 row (R3.10) already establishes that a grant-submitted
  return is owned by, and about, the congregation named in the grant — the same
  shape self-publish produces. The CHECK constrains row self-consistency, not
  *who* authorized the write, so it constrains nothing D16 needs. Increment 6's
  security review should re-confirm against its actual write path when designed.
- **The publish function's form version is correctly hard-coded `'2024'`, not
  resolved from `p_report_year`** — its ~62-parameter allow-list *is* the 2024
  field set (increment 4's `DO`-block proves the 1:1 correspondence), and
  resolving by year would make every pre-2024 report year unpublishable given
  today's fail-closed placeholder specs. The future D13 import writes to
  `statistical_returns` directly (`provenance = 'imported'`), never through
  `presby_publish_sasr_snapshot()`, and cannot write a historical generation's
  payload until its placeholder `field_spec` is replaced with a real one — a
  data edit against `sasr_form_versions`, owed to increment 7.
- **`sasr_reports`'s removal from `drizzle/0009`'s `tenant_tables` array:** left
  untouched, correctly — the array is a historical record of what `0009` did,
  not re-executed. Re-applying `0009` *alone and out of order* after `0047`
  would fail on the missing table; a replay from zero is unaffected. Same
  replay-order hazard as F42's blanket-grant mechanism (F38's root cause is
  still unremoved, see `docs/TODO.md`).

### Open question carried forward, not closed here

**The increment-3/increment-5 as-of collision.** `congregation_statistics_
about_org` (increment 3) validates a projection against the affiliation *as of
the report year* (F30/F31's archival-attribution rule); `publications.
recipient_org_id` (increment 5/D19) is resolved *as of `published_at`* — current
membership, per G-3.0108(a)'s reviewing-council rule. A congregation
redistricted between the report year and the filing date collides with both
rules at once, and self-publish for that report year is refused with a named
`invalid_parameter_value` — safe (it fails loudly, before any row is written),
but the underlying polity question (should such a return route to the current
presbytery at all, or is it necessarily the former presbytery's business to
enter) is not resolved by this document. Verifying the deciding citation is the
architect's business (this role has no web access); until then the refusal
stands as built and is not widened speculatively. `docs/TODO.md` carries the
publish-UI copy obligation regardless of how the question resolves.

---

## 2e. Third Phase 3 loop-back — Phase 5 Finding 1 (F46)

*(2026-09-24, tech-lead, third Phase 3 amendment,
`docs/work-log/2026-09-24-lifecycle-affiliation-returns.md` — "Amendment after
Phase 5." Unlike §2d's batch B/C items, this loop-back originates in Phase 5
(QA), not Phase 4, and is the pipeline's one genuine Phase 3 design defect
rather than a documentation-drift confirmation.)*

### F46 — `organization_successions` was policy-mediated by omission, contradicting Phase 2 Ruling 1

QA demonstrated, in a rolled-back transaction, that a tenant with zero read
access to a lifecycle event (RLS-filtered to 0 rows under
`organization_lifecycle_events`' tenant policy) could still `INSERT` and
`DELETE` `organization_successions` rows naming that event's id. The table
carried `presby_app` grants of `SELECT, INSERT, DELETE`, no RLS, and no
`organization_id`, and the original Data Model justified this with "visibility
follows the parent `event_id`'s tenant policy via a join" — true, by accident,
for a SELECT that happens to join against the events table, and false for
every write, since a join cannot constrain what an INSERT is permitted to
name. Phase 2 Ruling 1 ("cross-council access to the three-axis tables is
function-mediated, never policy-mediated") was written for exactly this class
of table and was simply not applied to this third member of it — a Phase 3
oversight, not a Phase 4 deviation from a correct design.

**Fix, applied to `drizzle/0044` in place (not a new migration, matching the
convention `docs/TODO.md`/`docs/decisions.md` already use for this pipeline's
in-flight corrections):** `presby_app` narrowed to `SELECT` only; `presby_
platform` narrowed to `select, insert`, closing Ruling B5's still-open
`docs/TODO.md` item in the same stroke; a `SECURITY DEFINER` `BEFORE INSERT`
trigger asserts the named `event_id` exists and, when a tenant context is
set, belongs to `presby_current_org()` (DEFINER for the same F26 reason every
other cross-table checker in this migration is DEFINER — it must see across
the events table's own RLS to check it at all); the grant shape is pinned by
a new `scripts/test-rls.sql` 32-series assertion, closing the one coverage gap
QA named. The future `presby_record_lifecycle_event()` DEFINER function
(`docs/TODO.md`) becomes the table's sole tenant-side writer and needs no
grant of its own, since a `SECURITY DEFINER` function runs as table owner.

**Considered and rejected: `organization_id` + FORCE RLS**, the alternative
this table's two siblings use. `organization_lifecycle_events` and
`organization_affiliations` each have a recording party genuinely distinct
from the row's subject (the acting council; the recording council).
`organization_successions` does not — both organizations it names are the
parent event's own subject, never an actor — so an `organization_id` column
here would duplicate the event's, not record a new fact, and would need its
own trigger to keep the two from drifting apart. The DEFINER-trigger fix
keeps a single derivation of ownership (the event), the same principle
`organizations.parent_id`/`path` already rest on elsewhere in this migration.

Not reopened: whether the new trigger's rejection should share `organization_
lifecycle_events`' uniform-message discipline (F40/DECISION-040). `event_id`
is a random UUID, not a member of the small, enumerable set of known
organization ids `subject_org_id`/`parent_org_id` draw from, so distinguishing
"no such event" (the pre-existing FK violation) from "not your event" (the
new check) does not reopen an enumeration oracle in practice. Left as an
implementation choice, not a requirement.

---

## 2f. Fourth Phase 3 loop-back — external post-merge review (F47–F53)

*(2026-09-24, tech-lead, fourth Phase 3 amendment,
`docs/work-log/2026-09-24-lifecycle-affiliation-returns.md` — "Amendment
after external implementation review." `drizzle/0043`–`0047` are on `main`
but applied only to `development`, so this is a migration correction in
place, same files and numbers, matching the convention F46 established.)*

An external reviewer read the exported table shapes (constraints, grants,
RLS, trigger placement — function bodies were collapsed and could not be
verified) and returned five findings, confirmed real against the working
tree. **The review's own diagnosis needed one correction before its fixes
could be trusted: grant-narrowing alone does not bind `getPlatformDb()`
(F44) — every ruling below that closes a real hole does so with a trigger.**

### F47 — `organization_identifiers` has no write-authority model at all

`presby_app` held `select, insert, update, delete` with no RLS
(`drizzle/0043:76`) — a tenant connection could rewrite or erase another
organization's identifier, including `is_verified`, the column that gates
global uniqueness. Fix: `presby_app` narrowed to `SELECT`; a new `SECURITY
DEFINER` function `presby_set_organization_identifier()` (actor = self org or
a council with `presby_org_affiliated()` standing over the subject) becomes
the sole tenant-side writer; a new `BEFORE UPDATE OR DELETE` guard trigger,
gated on a new GUC (`presby.identifier_trigger_active` — not a reuse of the
affiliation GUC; unrelated table, unrelated transaction), closes the owner
path. `presby_platform` keeps its DML grant, same accepted-risk class as its
grants elsewhere in this pipeline. INSERT is left ungated beyond the grant
narrowing — bounded residual, named in `docs/TODO.md`, not solved here.

### F48 — `organization_successions` is missing a UNIQUE, but the cardinality trigger already resists the gaming the review worried about

`UNIQUE (event_id, predecessor_org_id, successor_org_id)` added — correct
data integrity regardless. But `presby_check_succession_cardinality()`
already counts `count(distinct …)`, so a duplicate edge cannot inflate
cardinality; and `presby_freeze_succession()` already blocks every UPDATE on
every connection, so the cardinality trigger's dead UPDATE-arm concern does
not need a fix — verified by reading the function bodies, which the
reviewer's own export could not do.

### F49 — `organization_affiliations`: four proposed CHECKs, three built, and the one table in the pipeline that never got F44's guard-trigger treatment

*(Ratified with one correction after the hardening pass, 2026-09-24, fifth
Phase 3 loop-back — see the work-log's "Ratification after the hardening
pass" note. The fourth CHECK below, `organization_affiliations_recorded_
has_from`, is refused, not built: `scripts/seed-dev.sql`'s Quillhaven row and
`scripts/test-rls.sql`'s F41 assertion both depend on a `'recorded'` row
carrying a null `effective_from` when the minuted act itself predates the
records — a minuted close can legitimately name a beginning nobody can date.
F41's "null means unbounded below" was never conditioned on `authority =
'backfill'`, and reworking it to be would have meant editing an assertion
this same pipeline's own QA proved. The invariant actually worth keeping —
"a null `minute_reference` appears only on a `'backfill'` row" — is a
different claim, already true, and needs no new CHECK. `test-rls.sql` pins
the CHECK's absence and the contradicting fixture row's existence, so the gap
reads as a ruling, not an oversight.)*

Row shape permitted: a `'recorded'` row with no `effective_from`; an empty
effective range (`effective_to = effective_from`, which `daterange()`
constructs without error); `closed_*` set while open or absent while closed;
`subject_org_id = parent_org_id`. Three of the four proposed CHECKs were
added — **the closed-shape CHECK deliberately excludes `closed_by`**, which
is permanently null on every close by design (Ruling A4); the reviewer's
literal "all four `closed_*` fields" would have broken every legitimate
close. The fourth, requiring `effective_from` on every `'recorded'` row, is
refused (see the correction note above). Separately: `drizzle/0044`
argued explicitly that this table's grant alone was the right instrument,
before F44 was even discovered later in the same migration file — that
argument no longer holds. A `BEFORE UPDATE OR DELETE` guard now gates on the
**reused** `presby.affiliation_trigger_active` GUC (same function, same
transaction as the `organizations` reparent guard already using it — moved
earlier in `presby_transfer_affiliation()` so it covers both). The DELETE arm
cannot be an unconditional freeze like `organization_successions`' — `subject_
org_id` is `ON DELETE CASCADE` specifically for fixture teardown — so
`presby_guard_organizations_delete()` now also sets the GUC once it has
validated `deletable_until`, pre-authorizing the cascade within the same
transaction without touching any of the 15+ existing teardown call sites.

### F50 — `statistical_returns` has no provenance-shape enforcement

`submitted, reconciled = false, attested_* = null` and `imported, reconciled
= true` were both legal rows. A `statistical_returns_provenance_shape` CHECK
closes it — added **after** `drizzle/0047`'s own backfill, whose INSERT must
first be corrected to supply synthetic `attested_by_name`/`attested_role`
placeholders (it currently leaves them null, which the new CHECK would
otherwise reject on the pipeline's own data). INSERT revoked from both roles;
submitted stays `presby_publish_sasr_snapshot()`-only, imported has no
application writer until D13's import function ships.

**Correction, ratified after the hardening pass (2026-09-24, fifth Phase 3
loop-back):** the built CHECK's `submitted` branch does not require
`attested_by_name`/`attested_role` non-null — only `attested_at`. The literal
spec above would have made every *live* publish impossible:
`presby_publish_sasr_snapshot()` writes both text columns NULL on purpose
(Ruling A4 — no `app.current_user_id` GUC exists, and accepting a
caller-supplied attester name is exactly the identity claim the function's
confused-deputy shape refuses), and the backfill's own synthetic placeholders
are honest only because those rows *are* reconstructions. Ratified as the
Ruling-A4-consistent shape, the same deviation already accepted for
`closed_by`. Tightening the two text columns to non-null is folded into the
existing `docs/TODO.md` line for the `app.current_user_id` GUC — it has no
separate line.

### F51 — `publications`: an outright CHECK bug, plus three missing integrity mechanisms

`publications_withdrawal_shape` read `withdrawn_at is not null or (withdrawn_
by is null and withdrawn_minute_reference is null)` — true when `withdrawn_at`
is set and the other two are anything, including both null, contradicting the
"move together" comment on the same column. Corrected to a symmetric
all-null-or-all-set CHECK (binds the owner connection too — CHECKs, unlike
RLS and unlike grants, are not something F44 exempts). INSERT revoked
(function-mediated). Supersession made a real chain: a `SECURITY DEFINER`
`BEFORE INSERT` trigger requires the predecessor to share `organization_id`,
`recipient_org_id`, `record_class` and (for `statistical_return`) the
artifact's `report_year`; a partial unique index on `supersedes_id` forbids
forks. The projection's recipient end is now proven by a second composite FK
(`publications (id, recipient_org_id)` ← `congregation_statistics
(publication_id, organization_id)`) alongside the existing source-end FK —
together the two pin both ends of the same `publications` row.

### F52 — Withdrawal semantics were half Option A, half Option B; ruled Option A throughout

`presby_list_published_returns_to_me()` filtered `withdrawn_at is null`
(Option B: revoke read authorization) while the `congregation_statistics`
projection was left untouched by withdrawal (Option A: retain as historical
record). Per this design's permanence philosophy and G-3.0107, ruled Option A
throughout: the filter is removed from the read function (withdrawn rows
return, with the column, for the caller to exclude); `congregation_
statistics` gains its own `withdrawn_at`, settable through exactly one
permitted transition on the existing freeze trigger (by-subtraction JSONB
comparison, the same technique the backfill already uses, rather than
hand-enumerating ~60 columns). The future `presby_withdraw_publication()`
(still deferred to the publish-UI pipeline) sets both columns together.

**Correction, ratified after the hardening pass (2026-09-24, fifth Phase 3
loop-back):** "no such consumer exists yet" was wrong. A live rollup consumer
of `congregation_statistics` already exists — `getCongregationStatisticsRollup()`
in `src/lib/presbytery.ts` — and does not filter `withdrawn_at is null`. It is
a no-op today (nothing can set the column outside the one permitted
transition, which nothing yet calls), so no behavior changes. Ruled: the
filter obligation is owned by the future `presby_withdraw_publication()`
pipeline, which is the first thing that can ever make the column non-null and
therefore the natural place to add the corresponding read-side filter in the
same change — not pulled forward into this hardening pass. `docs/TODO.md`'s
existing line is retargeted to name the function directly rather than a
hypothetical future consumer.

### F53 — `sasr_form_versions.field_spec` stays mutable forever, even once a return depends on it

Ruled now, not deferred — cheap, and the failure mode (silently redefining
the meaning of a frozen historical payload) is exactly this pipeline's
central concern applied to the one table it hadn't reached yet. A `SECURITY
DEFINER` `BEFORE UPDATE` trigger (DEFINER is load-bearing — an invoker-mode
version would silently see zero referencing rows under RLS for a tenant other
than the caller's own, the same F26 shape this pipeline has hit twice)
rejects a `field_spec` change once any `statistical_returns` row anywhere
references the key. Placeholder rows remain editable until first use.

**Not reopened:** whether `organization_identifiers` INSERT needs its own
guard (named residual, `docs/TODO.md`); whether the recipient read-back
should also expose `withdrawn_by`/`withdrawn_minute_reference` (left to the
future publish-UI pipeline, which has an actual consumer to design against).

---


## 2g. Sixth Phase 3 loop-back — second-round external post-merge review (F54–F58)

*(2026-09-24, tech-lead, sixth Phase 3 amendment,
`docs/work-log/2026-09-24-lifecycle-affiliation-returns.md` — "Amendment
after external review, round 2." Same migration-correction-in-place
convention F46 and F47–F53 established: `drizzle/0043`–`0047` are on `main`
but applied only to `development`.)*

The same external reviewer read the regenerated export after F47–F53 shipped
and returned two remaining database-contract blockers, two informational
items, and a withdrawal-decision confirmation. The reviewer's closing
sentence generalizes a rule this pipeline already applied once (F44/F49's
guard-trigger treatment of `organization_affiliations`' *mutation* surface)
to a case it hadn't yet reached: **"if an immutable record represents an
authorized act, creation must be guarded as strongly as mutation."** F54/F55
close that gap on the two remaining unguarded creation surfaces; F56 applies
the same GUC-gating pattern to a mutation the prior round left half-closed;
F57 is a documentation-only correction; F58 closes a previously-accepted
residual for consistency.

### F54 — `organization_lifecycle_events` and `organization_successions` are one immutable aggregate; INSERT was policy-mediated by omission on both

A `merged`/`divided` lifecycle event could be recorded and committed with
zero succession rows (the only cardinality check lived on
`organization_successions`' own insert/delete, never on the event); and,
independently, a later raw-owner `INSERT` of an additional succession edge
into an *already-valid* merge changed the act's meaning without violating
cardinality, since nothing gated `organization_successions`' `INSERT` beyond
the existing event-scope trigger's permissive null-actor branch. Fix: a new
transaction-local GUC, `presby.lifecycle_write_active`, gates `INSERT` on
both tables via one reused guard function and the **existing**
`presby_deny_lifecycle_change()` literal (same aggregate, same claim — the
Ruling 1/DECISION-139 reuse case, not the identifier table's no-reuse case);
armed only by the future `presby_record_lifecycle_event()`, so both tables'
`INSERT` are effectively closed until it ships. The zero-succession hole is
closed independently by extracting `presby_check_succession_cardinality()`'s
counting logic into a shared `presby_lifecycle_event_cardinality_check()`,
called from both a new `AFTER INSERT DEFERRABLE INITIALLY DEFERRED` trigger
on `organization_lifecycle_events` and the existing trigger on
`organization_successions`, so a zero-child merge/division is rejected at
commit regardless of which table's succession rows are missing.
`presby_check_succession_event()`'s null-actor permissive branch is kept, not
removed — once the GUC is the real gate, that branch is no longer "the thing
that lets an untethered insert through," only a legitimate actor-context
check for the sanctioned writer's own migration-time shape.

**Corrected 2026-09-25 (QA-1):** F54's original text, and `drizzle/0044`'s
matching comment, claimed this closed "a later, separate `INSERT` of a third
predecessor edge into an already-valid, already-committed `merged` event." It
did not: the marker was the boolean `'true'`, naming no act, so a later
transaction that re-armed it appended the third edge cleanly (measured on the
owner connection). The marker now carries the `organization_lifecycle_events.id`
being recorded and the guard compares `new.id` / `new.event_id` against it —
the transaction declares *which* act it is recording and may write only rows
belonging to it. The literal repro (re-arming to a settled event's *own* id) is
**not** closed and is a named, accepted, owner-connection-bounded residual of
the F44 class; see `drizzle/0044` section 12a and the
`presby_record_lifecycle_event()` line in `docs/TODO.md`.

### F55 — the return→publication→projection chain had no sanctioned-write GUC; a raw owner `INSERT` could manufacture an artifact `presby_publish_sasr_snapshot()` never touched

`statistical_returns` and `publications` hold no `INSERT` grant for either
application role (F50/F51), but a grant does not bind `neondb_owner` (F44),
and neither table's `CHECK`/FK layer proves *provenance*, only *shape*: a raw
owner `INSERT` satisfying every constraint is indistinguishable from
`presby_publish_sasr_snapshot()`'s own write. Fix: one GUC for the whole
atomic operation, `presby.publication_write_active` — not split per table,
and not split by provenance (`imported` shares it too, once D13's import
function ships) — armed once inside `presby_publish_sasr_snapshot()` before
its first insert, and once inside `drizzle/0047`'s backfill `DO` block before
its two inserts. A new guard function, `presby_guard_publication_write()`,
gates `INSERT` unconditionally on `statistical_returns`/`publications` and,
on `congregation_statistics`, only `WHEN (NEW.provenance =
'published_by_congregation')` — the `WHEN` clause is exactly how the guard
leaves the live `presbytery_entered`/`imported` tenant-DML path
(`setCongregationStatisticsAction`) untouched, since those two provenances
never reach the new trigger at all.

### F56 — the withdrawal pair's one permitted transition was independently reachable on each table; nothing coordinated the pair

`presby_freeze_publication()` and `presby_reject_published_statistics_write()`
each correctly permit exactly one transition and reject every other change —
but a raw owner connection could still perform *either half alone*, leaving
the publication withdrawn and its projection not, or vice versa. Fix: a new,
**not reused**, GUC (`presby.withdrawal_write_active` — a distinct future
function in a distinct transaction, the identifier table's no-reuse case)
added as a required conjunct to each function's one permitted-transition
branch. Nothing arms it today; the future `presby_withdraw_publication()`
arms it once and performs both tables' `UPDATE` together, which is the pair
F52 already committed both triggers to permitting.

**Corrected 2026-09-25 (QA-2):** the conjunct binds the *owner* connection,
not every connection. `presby_app` could `set_config()` the marker itself and,
holding whole-table `UPDATE` on `congregation_statistics`, write
`withdrawn_at` alone — measured on the tenant connection, not theorised. A
marker is not a privilege. The tenant half is closed by a column-level
`UPDATE` grant excluding `withdrawn_at` and `publication_id`
(`drizzle/0047` section 10); the trigger conjunct remains the owner-side
layer. See F59 below for why the symmetric `INSERT` narrowing is not built.

### F57 — attestation identity and `recorded_by`: documentation precision, no new mechanism

D21's "frozen attested submission" is corrected to say plainly that the
database proves a submission was attested **at a time**
(`statistical_returns.attested_at`), not **by whom** —
`attested_by_name`/`attested_role` stay excluded from the provenance-shape
CHECK (F50) because `presby_publish_sasr_snapshot()` has no acting-user
identity to draw one from. `organization_lifecycle_events.recorded_by` is
`NOT NULL` today with a caller-provided UUID as its only source, the same gap
under a different name. Both fold into the existing `docs/TODO.md` line for
the `app.current_user_id` GUC; the future `presby_record_lifecycle_event()`
must take `recorded_by` from that GUC once it exists, never as a parameter.

### F58 — `organization_identifiers` INSERT, an accepted residual from F47, closed for consistency

Not independently urgent (the reviewer names it non-blocking) but closed at
near-zero cost: `presby_set_organization_identifier()` already arms
`presby.identifier_trigger_active` at entry, before either its `INSERT` or
`UPDATE` branch, so widening `organization_identifiers_guard` from `BEFORE
UPDATE OR DELETE` to `BEFORE INSERT OR UPDATE OR DELETE` requires no change
to the guard function or the sanctioned writer. `createOrganization()` and
`scripts/seed-dev.sql` never touch this table; `drizzle/0043`'s own
`pcusa_pin` backfill runs, and completes, before the guard trigger exists
later in the same file, so migration ordering — not a GUC — protects it.

**Residual named, not fixed:** `presby_assert_council_authority()`'s standing
check validates organization-*type* compatibility (presbytery-over-
congregation, etc.), not actual `presby_org_affiliated()` standing, for
lifecycle events — unlike `presby_set_organization_identifier()`, which
checks the real relationship. Folded into the existing `docs/TODO.md` line
for `presby_record_lifecycle_event()`, the function that should close it.

### Ratification after hardening round two (2026-09-25, tech-lead, seventh Phase 3 loop-back)

Database-admin built F54–F58 in one pass as a migration correction in place
to `drizzle/0043`–`0047` (`docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`,
"Loop-back after external review, round 2 — COMPLETE"), plus two orchestrator
additions from the 2026-09-25 security review (B-M1, B-M2). Ratified as
built, with one factual correction to this section's own facts and the
canonical GUC/arming-site list recorded below so it is not re-derived per
table.

**Correction — the seed writes the publication chain.** F55's text above,
and DECISION-141, both said the zero-regression argument rested on no
fixture writing these tables. True of `organization_lifecycle_events`/
`organization_successions`; **false** of `statistical_returns`/
`publications`/`congregation_statistics`: `scripts/seed-dev.sql` inserts a
fixed-id row into each of the three (`:1374`/`:1386`/`:1399`), inside the
file's single transaction. Caught by running the seed, not by re-reading the
spec. The seed now arms `presby.publication_write_active` once, before those
three inserts — the third arming site, alongside the two named in F55.

**The three GUCs, canonical list (tables gated, arming sites, all
transaction-local via `set_config(…, true)`):**

| GUC | Tables gated | Armed at |
|---|---|---|
| `presby.lifecycle_write_active` | `organization_lifecycle_events`, `organization_successions` (one aggregate, one guard function) | Nowhere yet. The future `presby_record_lifecycle_event()` arms it at entry, before inserting the event row and its succession rows in one transaction — both tables' `INSERT` are closed on every connection until it ships. **Carries the event id as text, not `'true'`** (2026-09-25 / QA-1): the guard requires `new.id` (events) / `new.event_id` (successions) to equal the armed value, so the transaction declares *which* act it is recording. A backfill arms per event id; there is no `'*'` wildcard. |
| `presby.publication_write_active` | `statistical_returns`, `publications` (unconditional); `congregation_statistics` (`WHEN (new.provenance = 'published_by_congregation')` only — the live `presbytery_entered`/`imported` tenant-DML path never reaches the trigger) | Three sites: `presby_publish_sasr_snapshot()` (after validation, before its first insert); `drizzle/0047`'s backfill `DO` block (before PASS 1); `scripts/seed-dev.sql` (before its three publication-chain fixture inserts, `:1374`/`:1386`/`:1399`). The future D13 import function arms this same GUC, not a new one. |
| `presby.withdrawal_write_active` | `publications` (via `presby_freeze_publication()`), `congregation_statistics` (via `presby_reject_published_statistics_write()`) | Nowhere yet. The future `presby_withdraw_publication()` arms it once and performs both tables' `UPDATE` together — neither table's one permitted transition is reachable alone until it ships. **On the OWNER connection only** (2026-09-25 / QA-2): a GUC is a marker any role can `set_config()`, so on the tenant connection what closes each half is a grant — no `UPDATE` at all on `publications`, and a column-level `UPDATE` grant excluding `withdrawn_at`/`publication_id` on `congregation_statistics` (`drizzle/0047` section 10). |

**`publications`' literal discipline, stated once.** F40's uniform-rejection-
literal rule (one message per table) exists to stop a caller who does *not*
already hold a row from learning, via distinguishable errors, that it
exists — it applies to `organization_affiliations` (EXCLUDE),
`organization_identifiers`, and the new lifecycle/publication-chain creation
guards, all reachable by a caller supplying an *identifying tuple* rather
than a primary key. `presby_freeze_publication()` is a mutation surface
reached only by `UPDATE … WHERE id = old.id` — the caller already names the
row — so no existence oracle is at risk, and this function keeps its
pre-existing discipline of one literal per distinct refused reason. The new
sanctioned-writer rejection (F56) is a fifth such literal, in-function
rather than a shared helper (each of the five interpolates `old.id`, so
there is no single reusable "publications" string). `publications` now
carries five distinct messages through one function; this is correct, not a
regression from the one-literal-per-table convention, because that
convention was never about mutation surfaces the caller already keys into.

**Follow-on revoke (Finding 1), ratified as Ruling-1-consistent.** The
orchestrator's mid-task acceptance of revoking `presby_app`'s unused
`INSERT` grant on `organization_lifecycle_events` — and the resulting revoke
of `presby_deny_lifecycle_change()`'s and
`presby_lifecycle_event_cardinality_check()`'s `presby_app` EXECUTE grants,
since neither guard function remains reachable by `presby_app` once the
INSERT is gone — is ratified. It closes the one place in this family where
"a GUC is a marker, not a privilege" (Finding 2) had teeth against a tenant
connection, at no cost to any real caller. **The coupling this creates is
recorded at two durable locations**, not just this document: inline at both
revoke sites in `drizzle/0044` ("if a ruling ever re-grants INSERT, these two
EXECUTE grants must return in the same migration"), and in the work-log's
Handoff section. A future re-grant that misses either half is a Phase 4
defect this ratification pre-warns against.

**B-M1's final shape (nine revoked, one kept) and B-M2 (21 `SECURITY
DEFINER` functions gain `set search_path = public`, the three new
`INVOKER` guards deliberately excluded) are ratified as built.**
`presby_apply_affiliation_to_org_tree()` arming `presby.affiliation_trigger_active`
immediately before its first `UPDATE`, rather than as its opening statement,
is a strict improvement (a rejected call no longer leaves the marker armed
for the rest of the caller's transaction) and needed no separate ruling.

**Finding 1's residual — `presby_app` can still arm
`presby.publication_write_active` itself and insert a
`published_by_congregation` `congregation_statistics` row, since it holds
live `INSERT` on that table for the `presbytery_entered`/`imported`
provenances.** Accepted, not fixed, *as of this ratification* — this is
exactly the boundary Ruling 2 drew on purpose, the `WHEN` clause exists so
the guard never touches the live tenant write path, and the live tenant
write path is precisely where `presby_app`'s grant remains. The FK to
`publications` is what actually bounds a fabricated projection today (it
needs a real publication row, which the tenant connection cannot mint), not
the GUC — consistent with Finding 2's "a GUC is a marker, not a privilege"
framing, and named there for exactly this reason.

**Superseded below (2026-09-25, eighth Phase 3 loop-back): this residual is
closed, not merely narrowed.** The "no Phase 4 change follows" sentence that
stood here was wrong about the *reach* of the fix, not the diagnosis: closing
the residual does not require revoking the grant `setCongregationStatisticsAction`
depends on, because that action never sets `publication_id` — see "Correction
after QA's re-verification" below.

**Finding 4a — orphan fixture organizations become permanently undeletable
once `deletable_until` passes.** A `docs/TODO.md` line already tracks it
(the sweeper/wider-predicate/branch-per-pipeline options). Ruled: the guard
predicate does not change now. `presby_guard_organizations_delete()` is a
security-relevant trigger outside this pipeline's declared scope (no CHECK,
FK, or GUC in this ratification touches it), and any of the three options
named trades off differently against the same invariant this guard exists
to enforce (a fixture window is a *time-boxed* exemption from an otherwise
permanent-delete-refusing guard) — widening the predicate casually is how
that exemption quietly becomes permanent for the wrong rows. Finding 5 (two
pipelines must not share one Neon branch) points at the actual root cause
being operational, not schema-shaped, which favors the branch-per-pipeline
option over a guard change — but choosing among the three is its own
scoped Phase 1–3 decision, not a rider on this ratification.

### Correction after QA's re-verification (2026-09-25, tech-lead, eighth Phase 3 loop-back)

QA's re-verification of the round-two build (`docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`,
"Re-verification after hardening round two") passed every suite but escalated
two design claims to Phase 3 (full ruling in that work-log's "Ruling on
QA-1/QA-2 after hardening round two"). Summarized here so this section stays
the canonical record:

**QA-1 — `presby.lifecycle_write_active` (`drizzle/0044:1338`).** The claim
that the guard "stops the reviewer's exact repro" was false for a *later,
separate* transaction that re-arms the same boolean sentinel and appends to
an already-committed event — no live exposure (`presby_app` holds `SELECT`
only on both tables), but false as stated for the owner connection the
guard exists to bind. **Ruled:** the GUC now carries the specific event id,
not a boolean, and `presby_guard_lifecycle_write()` compares `new.id`
(events) / `new.event_id` (successions) against it, raising through the
existing `presby_deny_lifecycle_change()` literal. **Declined:** closing the
case where a later transaction re-arms the marker to a pre-existing event's
*own* id (indistinguishable from the legitimate case without a same-transaction
proof, which would require converting the guard to `SECURITY DEFINER` under
F26's discipline and a `xmin`/transaction-boundary idiom unprecedented in this
schema) — named as an accepted residual bounded to owner-level connections,
the same class F44 already accepts throughout this pipeline (a determined
owner can `alter table ... disable trigger` regardless of how tightly the
guard is scoped), and folded into the existing `docs/TODO.md` line for
`presby_record_lifecycle_event()`.

**QA-2 — the withdrawal pair's tenant reach (`drizzle/0047:323-326`,
`scripts/test-rls.sql:4728`/`:4737`).** The claim that the withdrawal
transition is "unreachable on every connection until the writer ships" was
false for `presby_app`: `drizzle/0038:280` granted it whole-table `UPDATE`
on `congregation_statistics`, never narrowed by F55/F56, and a GUC is
`set_config`-able by any role — `presby_app` can arm
`presby.withdrawal_write_active` itself and write `withdrawn_at`. **Ruled:**
`presby_app`'s `INSERT`/`UPDATE` on `congregation_statistics` are narrowed
to every column except `withdrawn_at` and `publication_id` (column-level
grant, not a further trigger — the fix Postgres actually offers for "this
role must never touch these two columns, regardless of what any trigger
permits"). `presby_platform` is untouched (F47 precedent). **Consequence:**
this also closes Finding 1's residual above, in full — revoking `INSERT` on
`publication_id` means a fabricated `published_by_congregation` row is
refused either by grant (column supplied) or by
`congregation_statistics_publication_shape`'s CHECK (column omitted,
defaults null), with no cost to `setCongregationStatisticsAction`, which
never sets `publication_id` on `INSERT` either. `congregation_statistics`'s
exposure on this branch is now structurally identical to its two sibling
tables in the F55 chain.

> **F59 — a column-level `INSERT` revoke is incompatible with Drizzle's
> insert builder, so the `INSERT` half of the ruling above was built,
> measured, and removed** (2026-09-25, database-admin, ninth Phase 4 pass;
> `drizzle/0047` section 10 carries the full record). Two facts, both
> measured on the `development` branch rather than reasoned from docs:
> (1) Postgres requires column-level `INSERT` privilege on **every column in
> the INSERT target list, including one whose value is the `DEFAULT`
> keyword** — a role granted `insert (a, b)` is refused
> `insert into t (a, b, c) values (1, 2, default)`; (2) drizzle-orm 0.45's
> `buildInsertQuery` emits **every** column of the table in the target list,
> filling unspecified ones with `default`, with no supported way to omit one.
> Together they mean a column-level `INSERT` revoke on *any* column of
> `congregation_statistics` breaks `setCongregationStatistics()`
> (`src/lib/presbytery.ts:663`) — the shipped, member-facing write path the
> same ruling required to keep working. Built first, then measured:
> `src/lib/presbytery.test.ts` went 5 red, two of them `permission denied for
> table congregation_statistics` on exactly that upsert. The `INSERT` half
> was removed; the `UPDATE` half (which closes the measured QA-2 defect,
> since Drizzle's `do update set` lists only the columns it assigns) shipped
> and costs the live path nothing (`presbytery.test.ts` 34/34). **Finding 1's
> `INSERT`-side residual therefore stands** where the seventh loop-back left
> it — accepted, and bounded, as before, by
> `congregation_statistics_publication_shape` plus the composite FK
> `congregation_statistics_publication_recipient_fk (publication_id,
> organization_id) -> publications (id, recipient_org_id)` — **not**
> `congregation_statistics_publication_fk`, which this paragraph and
> `drizzle/0047` §10 both named until QA's Phase 5 re-verification (Finding 1)
> caught the misattribution: that FK pins the row's *source* congregation
> (`about_org_id`), not which council may insert. The bound is also narrower
> than it reads: it forces the row to name a real publication already
> addressed to the inserting council, and nothing more — it does **not**
> constrain the row's content. QA demonstrated a fabricated row for report
> year 2024 inserting cleanly against a real 2025 publication, with an
> arbitrary `ending_active` and `minute_reference`; it did not collide with
> the genuine projection because `congregation_statistics_entered_unique_idx`
> is partial (`presbytery_entered`/`imported` only), and
> `congregation_statistics_freeze` then made it permanent. Stated honestly:
> the residual is that a recipient council on the tenant connection,
> self-arming `presby.publication_write_active`, can manufacture a permanent
> projection row for a year the congregation never published, bounded only to
> publications actually addressed to it. **Ruled** (tenth and final Phase 3
> loop-back on this pipeline, 2026-09-25): the deviation is accepted as
> built — the `UPDATE` half closes the measured QA-2 defect and the `INSERT`
> half is not buildable without breaking `setCongregationStatistics()`. The
> real instrument, if the residual is ever judged worth closing, is moving
> that one write off Drizzle's insert builder onto raw parameterised SQL
> naming only the columns it sets — an api-developer change in
> `src/lib/presbytery.ts`, not a migration — chosen over a `SECURITY DEFINER`
> function because it is the only tenant-connection Drizzle `insert()` target
> on this table today (`presby_publish_sasr_snapshot()` already runs
> `DEFINER` and is grant-exempt per F44; `scripts/seed-dev.sql` writes raw
> SQL), so this one call site alone would fully satisfy the general rule
> below with no new privilege-elevation surface. Tracked in `docs/TODO.md`,
> not built here. **General rule for this
> schema:** a column-level `INSERT` narrowing is only available on a table no
> tenant-connection Drizzle `insert()` targets; column-level `UPDATE` has no
> such constraint.

**QA-3** — a citation typo (`drizzle/0047:325` said "section 39"; the
probes are in `test-rls.sql` §35(d)) — corrected in place.

The canonical GUC table above (arming sites) is unchanged by this
correction: neither GUC's arming sites moved. What changed is what the two
GUCs' *tables* additionally require independent of the GUC — an id match
for `presby.lifecycle_write_active`'s two tables, and a column-level grant
boundary for `presby.withdrawal_write_active`'s `congregation_statistics`
half. Routed to database-admin as the ninth Phase 4 pass on this pipeline.

**Finding 4a — orphan fixture organizations become permanently undeletable
once `deletable_until` passes.** A `docs/TODO.md` line already tracks it
(the sweeper/wider-predicate/branch-per-pipeline options). Ruled: the guard
predicate does not change now. `presby_guard_organizations_delete()` is a
security-relevant trigger outside this pipeline's declared scope (no CHECK,
FK, or GUC in this ratification touches it), and any of the three options
named trades off differently against the same invariant this guard exists
to enforce (a fixture window is a *time-boxed* exemption from an otherwise
permanent-delete-refusing guard) — widening the predicate casually is how
that exemption quietly becomes permanent for the wrong rows. Finding 5 (two
pipelines must not share one Neon branch) points at the actual root cause
being operational, not schema-shaped, which favors the branch-per-pipeline
option over a guard change — but choosing among the three is its own
scoped Phase 1–3 decision, not a rider on this ratification.

---

## 3. Section M — Organization lifecycle *(new — shape revised in round 3)*

Answers F30 / D10.

```
organizations                      (existing — extended)
  status                            -- KEPT (F35, corrected after batch A,
                                    -- 2026-09-24 — see Implementer Notes in
                                    -- docs/work-log/2026-09-24-lifecycle-
                                    -- affiliation-returns.md). NOT dropped:
                                    -- five shipped SECURITY DEFINER functions
                                    -- (presby_published_site() and its
                                    -- 0024/0041/0042 siblings) gate an
                                    -- ANONYMOUS PUBLIC READ on
                                    -- `o.status = 'active'`, and Postgres
                                    -- records no column dependency inside a
                                    -- function body, so a DROP would have
                                    -- succeeded at migration time and failed
                                    -- every public site at request time.
                                    -- RESTATED MEANING, distinct from
                                    -- `lifecycle_status`: a platform-level
                                    -- public-site enablement switch, the
                                    -- fourth axis alongside platform_status
                                    -- (tenant participation), lifecycle_status
                                    -- (polity fact) and affiliation (council).
                                    -- No write path sets it to anything but
                                    -- its `'active'` default today — it is a
                                    -- future platform-admin "suspend this
                                    -- org's public site" switch, written only
                                    -- by getPlatformDb(), not yet built.
                                    -- DELIBERATELY NOT folded into
                                    -- lifecycle_status: a dissolved
                                    -- congregation's public historical site
                                    -- is a legitimate future feature (a
                                    -- memorial page), so tying site
                                    -- visibility to a polity lifecycle event
                                    -- would foreclose it. Column name and the
                                    -- five functions' text stay as `status`;
                                    -- renaming it is a separate, deliberately
                                    -- undone cosmetic change, not a design
                                    -- defect.
  + lifecycle_status   text not null default 'active'   -- CACHE, trigger-
        -- maintained from the events below, never written directly; drift
        -- check per F29. Vocabulary from G-3.0301(a) (corrected from (c),
        -- Phase 2 Ruling 10 — see §0a):
        active | merged | divided | dismissed | dissolved
  + deletable_until    timestamptz  -- null in normal operation. Test/fixture
        -- provisioning stamps this at INSERT (never at teardown); the
        -- BEFORE DELETE guard on organizations (owner connection only —
        -- RLS bypass does not bypass triggers) permits a delete only when
        -- deletable_until is not null and > now(). Settles §10 Q7 against
        -- `platform_status = 'fixture'` (would conflate D9's tenant-
        -- participation axis with a test-lifecycle concern).
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
  concurrence_reference,            -- nullable. G-3.0502(e): GA CONCURS in a
                                    -- synod's act on a presbytery; it is not
                                    -- a second event or a second actor
                                    -- (Ruling 8). Null except on a
                                    -- synod-on-presbytery act.
  external_body,                    -- for dismissed / received: the other
                                    -- denomination or body
  recorded_by, recorded_at, notes
  unique (id, organization_id); FORCE RLS, tenant policy
  CHECK (organization_id <> subject_org_id)
  -- trigger presby_assert_council_authority(organization_id, subject_org_id):
  -- the acting council must be EXACTLY one level above the subject —
  -- presbytery -> congregation/NWC (G-3.0301(a)), synod -> presbytery
  -- (G-3.0403(c)), GA -> synod (G-3.0502(d)). Same function used by
  -- organization_affiliations below (one function, not two copies).
  -- trigger: sets subject's lifecycle cache; on dissolved/merged/divided/
  -- dismissed, closes the subject's open affiliation on effective_on
  -- (calls presby_apply_affiliation_to_org_tree(), never derives inline)

organization_successions           (new)   D10 — the topology
  event_id, predecessor_org_id, successor_org_id
  -- merged:  N rows sharing a successor    divided: N rows sharing a predecessor
  -- CHECK predecessor <> successor; each must be the event's subject or a
  -- named successor. NOT a merge chain to follow — see §2b on D10.
  -- CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED (Ruling 8): cardinality
  -- cannot be checked row-by-row (a `merged` event's first predecessor row
  -- can't yet know a second is coming). Checked at commit: merged -> >=2
  -- predecessors/1 successor; divided -> 1 predecessor/>=2 successors;
  -- dissolved/dismissed/organized/received -> 0 succession rows.
  -- external_body required on the parent event for received/dismissed,
  -- null otherwise — enforced here since this is where the counterpart's
  -- shape is known.
  -- CORRECTED 2026-09-24 (Phase 3 amendment after Phase 5 Finding 1; F46
  -- below). No organization_id column, and none is added: this table has no
  -- recording party distinct from the parent event's own subject, so a
  -- second organization_id would duplicate the event's without recording a
  -- new fact. SELECT is open on every connection, ungated by RLS — the
  -- topology is public, the org tree already publishes it. Writes are
  -- function-mediated per Ruling 1, NOT "visibility follows the parent
  -- event_id's tenant policy via a join" (that sentence stood here through
  -- three revisions and was false for writes, which a join cannot
  -- constrain): presby_app is revoked to SELECT-only, presby_platform to
  -- select+insert, and a SECURITY DEFINER BEFORE INSERT trigger asserts the
  -- named event_id exists and, when a tenant context is set, belongs to
  -- presby_current_org(). The future presby_record_lifecycle_event() DEFINER
  -- function is the table's sole tenant-side writer.

organization_affiliations          (new)   D19 — the THIRD axis; council-owned
  id, organization_id,              -- the council that RECORDED the row.
                                    -- Ownership is PROVENANCE and never
                                    -- changes, even when a different
                                    -- council later closes it (Ruling 1) —
                                    -- re-owning it to the closer would
                                    -- rewrite who acted.
  subject_org_id, parent_org_id,
  relationship_type,                -- member_congregation | member_presbytery
                                    -- | member_synod | member_nwc
                                    -- (member_nwc added, Phase 2 Ruling 8/10:
                                    -- G-3.0301(b) enumerates "new church
                                    -- developments ... and other
                                    -- non-congregational entities"
                                    -- SEPARATELY from congregations;
                                    -- overloading member_congregation would
                                    -- make the presbytery's congregation
                                    -- count — a live per-capita and
                                    -- commissioner-parity number — wrong)
  effective_from, effective_to,     -- '[)'; effective_to null = current.
                                    -- effective_from NULLABLE — null means
                                    -- UNBOUNDED-BELOW ("predates our
                                    -- records"), not "now()" (F41). The
                                    -- EXCLUDE constraint below still treats
                                    -- a null lower bound as -infinity, so
                                    -- at most one such row per (subject,
                                    -- relationship_type) is still enforced.
  authority,                        -- 'recorded' | 'backfill'. CHECK:
                                    -- minute_reference may be null ONLY
                                    -- when authority = 'backfill' — an
                                    -- inferred relationship can never be
                                    -- mistaken for a minuted act
                                    -- (DECISION-136).
  reason, minute_reference, recorded_by, recorded_at,
  closed_by_org_id, closed_by, closed_on, closed_minute_reference
                                    -- all four NULLABLE, written ONLY by
                                    -- presby_transfer_affiliation() /
                                    -- the lifecycle trigger's close path —
                                    -- never by ordinary DML (see grant note
                                    -- below). Attributes a close performed
                                    -- by a DIFFERENT council than the one
                                    -- that opened the row, e.g. "Presbytery
                                    -- A recorded this; the Synod closed it
                                    -- 2027-01-01 per minute X." Same DEFINER-
                                    -- write-into-another-council's-space
                                    -- shape presby_publish_sasr_snapshot()
                                    -- already establishes.
  unique (id, organization_id); FORCE RLS, tenant policy
  -- GRANT: revoke insert, update, delete on organization_affiliations from
  -- presby_app (Ruling 1/F40) — select only, plus the public projection
  -- view. presby_transfer_affiliation() is the ONLY writer. Without this,
  -- the EXCLUDE constraint below is a cross-tenant existence oracle (F40):
  -- any presbytery could probe an insert naming another org as subject and
  -- learn from the constraint-violation error whether it already has an
  -- open affiliation it cannot see.
  exclude using gist (subject_org_id with =, relationship_type with =,
                      daterange(effective_from, effective_to, '[)') with &&)
                                    -- requires btree_gist: name it in the
                                    -- migration and check it exists
  -- trigger (SECURITY DEFINER, F26 + F38): calls
  -- presby_apply_affiliation_to_org_tree() to maintain organizations.
  -- parent_id and path for the subject and its subtree; calls
  -- presby_assert_council_authority() to check parent type fits child type
  -- public projection: a view of (subject, parent, from, to) only

-- Function list this section adds (specified fully in the work-log's Phase 3
-- API Contract, docs/work-log/2026-09-24-lifecycle-affiliation-returns.md):
--   presby_assert_council_authority(actor_org_id, subject_org_id)
--     -- SECURITY DEFINER, volatile (raises). One-level-above rule, shared by
--     -- both tables above.
--   presby_apply_affiliation_to_org_tree(subject_org_id, as_of)
--     -- SECURITY DEFINER, volatile. THE ONE place parent_id/path derivation
--     -- and subtree rebuild happens (Ruling 2.3) — deriveOrgPath() (src/lib/
--     -- org-provisioning.ts) handles roots only today and must not grow a
--     -- second, divergent tree-rebuild implementation.
--   presby_transfer_affiliation(subject_org_id, new_parent_org_id,
--     relationship_type, effective_on, reason, minute_reference)
--     -- SECURITY DEFINER, volatile. Accepts NO acting-council id (confused-
--     -- deputy form, drizzle/0038:376-380) — the actor is
--     -- presby_current_org(). Verifies standing from the AFFILIATION HISTORY
--     -- (never organizations.path/parent_id, the cache this same
--     -- transaction is about to rewrite). Closes the old row and opens the
--     -- new one atomically, then calls
--     -- presby_apply_affiliation_to_org_tree(). One uniform rejection
--     -- message (F40).
--   presby_org_affiliated(subject_org_id, council_org_id, as_of)
--     -- SECURITY DEFINER, stable. Existing name from R3.14, now also the
--     -- archive-attribution read.
--   presby_affiliation_parent_as_of(subject_org_id, as_of)
--     -- SECURITY DEFINER, stable. New companion — "who was this
--     -- organization's parent on this date," bounded to the public
--     -- projection columns.
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

**`divided` is our addition for congregations, not invented vocabulary (Phase 2
Ruling 10.3).** Verified against the full Book of Order text: "dividing" does not
appear in G-3.0301(a)'s congregational list. Congregations do divide in fact
(the 1→N argument above is why D10 has a topology table at all), so the value is
kept — but for a **presbytery**, `divided` is verbatim polity (G-3.0403(c):
*"organizing new presbyteries, dividing, uniting, or otherwise combining
presbyteries..."*), and for a **synod** likewise (G-3.0502(d)). The same enum
value is our scope extension at one level and literal polity at the next two —
exactly what Ruling 8's one-level-above `presby_assert_council_authority()` rule
encodes structurally: a synod dividing a presbytery and a presbytery dividing a
congregation are the same shape of act, one level apart.

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
- **What happens to a dissolved congregation's roll — the correct home for
  G-3.0301(c) (Phase 2 Ruling 10.1).** Every other citation in this section is
  G-3.0301(a); this is the one place (c) belongs. Verbatim: the presbytery is
  responsible for *"taking jurisdiction over the members of dissolved
  congregations and granting transfers of their membership to other
  congregations."* This is the polity basis for `roll_actions` continuing to
  answer "where is this person now" after `dissolved` fires on their
  congregation — out of scope to design here (D22/roll-transfer mechanics are
  untouched by this pipeline), but the citation belongs on the dissolution
  trigger's own comment so a future reader does not have to re-derive it.

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
- **`delete`, `insert` and `update` revoked on `organizations` from `presby_app`
  (Phase 2 Ruling 2/7 — F38), plus a `BEFORE DELETE` guard on the owner path.**
  This is not the no-op it looks like: the live database currently grants
  `presby_app` all four privileges on `organizations` (F38), so the revoke must
  actually be issued, not assumed from `drizzle/0009:93`'s `select`-only intent.
  Every tenant FK cascades on org delete and the owner connection
  (`getPlatformDb()`, `BYPASSRLS` but not trigger-exempt) has used that path for
  fixture cleanup (2026-08-31's 58-org cascade) — the guard must fire there, not
  just on the tenant connection. **§10 Q7 settled:** `deletable_until timestamptz`
  (added to `organizations` above), not `platform_status = 'fixture'` — the guard
  predicate is `deletable_until is not null and deletable_until > now()`. Fixture
  helpers (`makeOrg()` in `presbytery.test.ts`/`credentials.test.ts`, `platform.
  insert(organizations)` call sites generally) stamp `deletableUntil` **at
  insert**, not at teardown, so the ~15 existing disable/enable-trigger teardown
  blocks (`docs/TODO.md`) keep working unmodified.
- **Do not "follow the chain" through `organization_successions`.** A merged
  congregation's 1987 return stays attributed to the predecessor; the successor
  has no history before its `organized`/`merged` event. This is the opposite of
  `people.merged_into_id`, and the different table shape is meant to make the
  different query obvious.
- A dissolved congregation keeps its `slug` forever — settled in §2a, folded into
  D10.
- **Provisioning a hierarchical org: `createOrganization()` extended now, not
  deferred (Phase 2 Ruling 3).** `src/lib/org-provisioning.ts:159-288` gains
  optional `parentOrganizationId` / `relationshipType` / `effectiveFrom`, and
  inserts the `organizations` row **and** its initial `organization_affiliations`
  row in the same `platformDb.transaction()` — the affiliation row's
  `organization_id` is the parent council, `recorded_by` is the platform
  operator's user id. A presbytery-callable `presby_organize_congregation()` is
  **deferred** to the future lifecycle-UI pipeline (also where D13's import
  resolution needs it) — build it once, there, not twice; tracked in
  `docs/TODO.md`.
- **Direct `insert into organizations (..., parent_id, ...)` is rejected, never
  auto-resolved into an affiliation row (Phase 2 Ruling 3).** Auto-creation would
  have to invent the owning council, the effective date and the authority,
  minting minute-less rows — D19's "second source of truth" arriving through the
  back door. The `BEFORE INSERT` guard fires **only when `parent_id is not null`
  and the affiliation-trigger's transaction-local GUC is absent** — root-org
  inserts (the large majority of test fixtures) are unaffected. Five files carry
  a direct `parent_id` insert and need updating in the same migration's
  implementation order: `scripts/seed-dev.sql:30`, `scripts/test-rls.sql:1997`/
  `:2155`/`:2322`, `src/lib/credentials.test.ts:128`, `src/lib/presbytery.
  test.ts:122`.
- **The affiliation backfill's `effective_from` is unbounded-below
  (`authority = 'backfill'`), never `now()` (F41, DECISION-136).** A bounded
  lower bound makes `presby_org_affiliated(as_of => <report year>)` false for
  the entire pre-migration archive, which would make increment 3's about-org
  trigger block the very import increment 7 exists to enable. Increment 2's
  migration must assert backfill completeness — `select count(*) from
  organizations where parent_id is not null` equals the count of open
  affiliation rows created — **before** increment 3 creates the enforcing
  trigger (Phase 2 Notes item 3): `src/lib/presbytery.ts:143,169` and
  `src/lib/credentials.ts:522,710` currently answer "is X my member
  congregation" from `organizations.parentId` directly, and after increment 3
  the about-org trigger answers the same question from `presby_org_affiliated()`
  — if the two ever disagreed for even one row, a presbytery's own UI would
  offer a congregation the database then refuses.

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

sasr_reports                      DROPPED OUTRIGHT (Phase 2 Ruling 6,
                                   DECISION-137 — supersedes the round-3 "becomes
                                   the working draft" shape below the strike).
  ~~… status: draft | session_approved ONLY. `submitted` is no longer a status:
    it is the existence of a statistical_returns row. Keeps the immutable
    official_beginning_balance and §13's reconciliation rule.~~
  Zero rows on production AND development; zero application consumers
  (`src/lib/dev-docs.ts` reads it only as `/developer` schema reference); its
  shape (`status: draft | session_approved | submitted`, mutable `payload` with
  `$onUpdate`) is already stale under D25. Keeping a real table with no
  consumer and a known-wrong shape is the second-source-of-truth pattern this
  design refuses everywhere else. Removed from `drizzle/0009`'s `tenant_tables`
  array (`:72`) and from `src/lib/db/domain/reporting.ts`, which is deleted
  entirely (it contained nothing else).
  **What drops with it, said out loud:** the congregation loses any staging
  surface between computing the live projection and attesting/freezing it. That
  is a real need; it returns as a design question OWNED BY the future publish-UI
  pipeline, answered against D25's rules rather than inherited from this
  pre-round-2 shape — tracked in `docs/TODO.md`, not silently absorbed here.

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
                                    -- published_at (D19 rule, §2b), resolved
                                    -- via presby_affiliation_parent_as_of() —
                                    -- NEVER organizations.parent_id. Fixed at
                                    -- write time and never re-derived, so a
                                    -- later redistricting cannot change who
                                    -- received an already-published return.
  record_class,                     -- 'statistical_return' today; generic
  artifact_id,                      -- → statistical_returns (id, organization_id)
  published_at, supersedes_id, authorized_by, minute_reference, withdrawn_at
  unique (id, organization_id); FORCE RLS
  -- read by the recipient through presby_list_published_returns_to_me()
  -- (Phase 2 Ruling 5 — new, specified fully in the work-log's Phase 3 API
  -- Contract): SECURITY DEFINER, stable, filters internally on
  -- recipient_org_id = presby_current_org() and withdrawn_at is null, joins
  -- to statistical_returns. Mirrors presby_list_own_congregation_
  -- publications() (drizzle/0038:665-690) to the recipient side. Without it,
  -- D20's "a recipient council reads the artifact published to it" is
  -- unenforceable in the permissive direction — the presbytery cannot read a
  -- statistical_returns row the congregation owns. Filters on the
  -- PUBLICATION, not on live affiliation, on polity grounds: G-3.0107 makes a
  -- ceased council's records the property of the next higher council, so a
  -- presbytery must still be able to read a dissolved congregation's returns
  -- after dissolution — a read gated on a CURRENT affiliation would not
  -- permit that.

-- 4. The presbytery's TYPED KEYSPACE (existing, retrofitted — F36, NARROWED
--    by Phase 2 Ruling 5 / DECISION-137 against round 3's own R3.4(a)).
congregation_statistics           (built, drizzle/0038)
  + publication_id                  -- not null when provenance =
                                    -- 'published_by_congregation'
  - supersedes_publication_id       -- MOVES to publications.supersedes_id;
                                    -- the migration BACKFILLS one publication
                                    -- per existing published row before
                                    -- dropping this column. Grep finds no
                                    -- reader outside a comment
                                    -- (src/lib/presbytery.ts:55).
  -- published_at and minute_reference STAY (F39 — round 3's R3.4(a) was
  -- wrong to move these two; see §2b's D21→D25/D19 rows and §2c's F39):
  --   published_at is ordered on at src/lib/presbytery.ts:522 and drives the
  --   provenance-coalescing rollup at :533-539; moving it to `publications`
  --   (a table the PRESBYTERY CANNOT READ — publications.organization_id is
  --   the source congregation) would turn the shipped rollup and the
  --   per-capita basis-year lookup into SECURITY DEFINER joins for no gain.
  --   A projection is allowed to carry the event's facts — that is what a
  --   projection is — and unlike F29's current_roll this copy cannot drift:
  --   both rows are written by ONE DEFINER function in ONE transaction and
  --   neither is ever updated (congregation_statistics_freeze,
  --   drizzle/0038:286-296, already guarantees the second half). A
  --   test-rls.sql assertion proves every published row's published_at
  --   equals its publication's.
  --   minute_reference is written on provenance = 'presbytery_entered' rows
  --   by src/lib/presbytery.ts:637,664 and is a REQUIRED field on the live
  --   presbytery-entry form (statistics-schema.ts:22) — a presbytery_entered
  --   row has no publications row to hold it, and it is a DIFFERENT minute
  --   (the presbytery's own data-entry minute, vs. the congregation's
  --   session minute authorizing publication — `publications` gets its own
  --   minute_reference column). Collapsing them is the one-column-two-facts
  --   error this design refuses everywhere else.
  -- keeps provenance, the freeze trigger, the partial unique index, and every
  -- consumer (rollup, per-capita basis-year): DECISION-120's "same
  -- (about_org, year) keyspace regardless of who wrote it" still holds.
  -- presby_list_own_congregation_publications()'s return type (setof
  -- congregation_statistics) needs no drop/recreate — it follows the table —
  -- but any TypeScript reader of the dropped column breaks at compile time,
  -- which is the desired failure mode.
```

`presby_publish_sasr_snapshot()` is REWRITTEN (same name, same allow-list
parameter shape — its live callers, if any land before this pipeline, keep
working) to write, in one transaction: the `statistical_returns` row (from the
draft, reconciled) → the `publications` row (recipient resolved via
`presby_affiliation_parent_as_of()`, never `organizations.parent_id` and never
passed as a parameter) → the typed `congregation_statistics` projection. Its
parameter list stays the allow-list; the returns trigger is the second,
independent check. Full signature specified in the work-log's Phase 3 API
Contract.

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
  `published_at`, resolved by `presby_affiliation_parent_as_of()` — the
  reviewing council is G-3.0108(a) (Administrative Review; **corrected from
  G-3.0107, Phase 2 Ruling 10.2** — G-3.0107 is *Records*, and its real
  contribution to this design is the sentence quoted above the recipient-read
  function: a ceased council's records become the property of the next higher
  council, which is why the read filters on the recorded publication rather
  than on live affiliation). The archive's attribution reads the affiliation as
  of the report year via `presby_org_affiliated()`. Both go through the same
  affiliation-history functions, so a redistricting cannot make the live and
  archival answers disagree.

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
   oversight — tested at both calendar-year endpoints (Jan 1 and Dec 31), with
   an accepted gap for an affiliation that opens and closes inside one
   calendar year (§2d Ruling B2). It is paper on **four** built tables today
   (`presbytery.ts` says so) — `congregation_oversight`, `congregation_statistics`,
   `per_capita_records`, `appointments`; `per_capita_rates` never carried the
   pattern (corrected from "five," §2d Ruling B1).
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
   D8's no-custom-fields decision. Exactly one table qualifies: `statistical_returns`
   (validated against `sasr_form_versions.field_spec`). **`sasr_reports` is dropped
   outright (Phase 2 Ruling 6, DECISION-137, supersedes round 3's "working draft"
   framing) — there is no second `payload` column in this design.** The grant row
   carries no payload at all.

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
7. ~~**The organization-deletion exemption** (round 3, R3.12).~~ **Settled
   (Phase 2 Ruling 7, Phase 3): `deletable_until timestamptz`, stamped at test/
   fixture provisioning (not at teardown), guard predicate `deletable_until is
   not null and deletable_until > now()`.** Not `platform_status = 'fixture'` —
   that would conflate D9's tenant-participation axis with a test-lifecycle
   concern. See §3.
8. ~~**`sasr_reports`' fate** (round 3, R3.5).~~ **Settled (Phase 2 Ruling 6,
   DECISION-137): dropped outright**, not kept as a working draft — zero rows on
   production and development, zero consumers, a shape already stale under D25.
   The working-draft need it nominally served is a tracked design question for
   the future publish-UI pipeline (`docs/TODO.md`), not carried forward
   unmodified. See §5.
