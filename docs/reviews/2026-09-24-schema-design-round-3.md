# Schema design, round 3 — final review before table design

**Date:** 2026-09-24 · **Reviewer:** Claude Fable 5.1 (model switched for this
pass) · **Subject:** `docs/schema-design-2.md` (D10–D23, §3–§8 table shapes) read
against the *built* schema in `src/lib/db/domain/` and `drizzle/0038`.
**Status:** findings for the operator; nothing here is applied.

**Verdict: the decisions (D10–D23) hold. The table shapes in §3–§8 do not yet
match the decisions in §2/§2a, and three of them collide with tables that already
exist.** The DDL pipeline for D10/D19/D20/D21 should start from the corrected
shapes below, not from §3–§6 as written. Findings are numbered R3.1… so the
operator can promote the ones they accept to F34+ without renumbering.

The single most important thing this review adds: **the built
`congregation_statistics` table already implements publication** (frozen rows,
supersession chain, minute reference, a SECURITY DEFINER publish function that
walks `parent_id` — DECISION-118/120). D20 and D21 design a second mechanism for
the same fact and the document never says what happens to the first one. That
has to be decided before a single `create table` is written (R3.4).

---

## A. Defects — the shape contradicts the decision or the built schema

### R3.1 — §3 still shows the pre-round-2 D10 shape

D10 (§2, rephrased after round 2) says lifecycle is an **immutable event history
with topology**; `lifecycle_status` is a derived convenience; successor and
predecessor links hang off the events; `divided` is 1→N. §3 then adds to
`organizations`:

```
lifecycle_status, lifecycle_date, lifecycle_minute_reference, merged_into_org_id
```

as ordinary editable columns, and `organization_lifecycle_events` with no
successor structure at all. `merged_into_org_id` cannot express `divided`, and
the doc's own topology table says so. This is the same "two representations of
one fact" hazard D19 spells out for `parent_id`, one section earlier.

**Corrected shape.**

```
organization_lifecycle_events            -- the record
  id, organization_id (the ACTING council — see R3.7), subject_org_id,
  event  (organized|received|merged|divided|dismissed|dissolved),
  effective_on, minute_reference, external_body text (for dismissed/received),
  recorded_by, recorded_at, notes
  unique (id, organization_id)

organization_successions                 -- the topology
  event_id, predecessor_org_id, successor_org_id
  -- merged:  N rows, same successor      divided: N rows, same predecessor
  -- CHECK predecessor <> successor; both must be subject or successor of event
```

On `organizations` keep at most `lifecycle_status` + `lifecycle_as_of` as a
**trigger-maintained cache** with the same drift-check discipline as
`memberships.current_roll` (F29) — or expose it as a view and keep nothing.
Drop `merged_into_org_id` and `organized_year` (the latter is the `organized`
event's year; storing it twice invites disagreement).

**Also: do not name it after `people.merged_into_id`.** The doc says the mirror is
deliberate "so the follow-the-merge-chain query is learned once." The two facts
are different in kind. A person merge is *deduplication* — two rows were one
human, and following the chain is correct. A congregation merge is a *polity
event* — two real churches became a third, and following the chain would
attribute First Church's 1987 return to the successor, which is exactly the
mis-attribution D19 exists to prevent. Same word, opposite query semantics.

### R3.2 — `organizations` would carry two status columns

The built table already has `status text not null default 'active'`
(`src/lib/db/domain/org.ts:53`). Nothing writes it — `org-provisioning.ts` never
sets it — and nothing reads it. §3 adds `lifecycle_status`, also defaulting
`'active'`. The D10 migration must **drop or repurpose `status`** in the same
step. Two columns with the same default and overlapping meaning is the "second
editable source of truth" the document warns about.

### R3.3 — `pcusa_pin` already exists, on the wrong table for the new use

`organization_settings.pcusa_pin` is built (`org.ts:106`). §3 adds `pcusa_pin` to
`organizations`. This must be a **move**, not a duplicate — and the move is
justified: `organization_settings` is FORCE-RLS tenant state, so a presbytery
resolving an imported 1994 row by PIN (F33's matching key) cannot read the
congregation's settings row from its own context. The PIN is published in the GA
Minutes; it is public identity, and belongs on the public structural table with
`unique where not null`.

Better still, generalize once: an **`organization_identifiers`** table mirroring
`person_identifiers` (`kind: pcusa_pin | psvonline_congregation_id | church360 |
legacy_import`, `value_normalized`, partial unique on verified kinds). The PSV
port is a model translation (program doc §"Two model conflicts"): every
`psvonline.congregations.id` needs a durable mapping to an `organizations.id` or
the import cannot be re-run idempotently. That mapping has no home today.

### R3.4 — D20/D21 versus the built publication mechanism

`congregation_statistics` (built, `presbytery.ts`) already has: rows with
`provenance = 'published_by_congregation'` living at the presbytery, a
`congregation_statistics_freeze` trigger, `supersedes_publication_id`,
`published_at`, `minute_reference`, and `presby_publish_sasr_snapshot()` which
derives the recipient by walking one `parent_id` link (DECISION-118). That *is*
a publication event fused with its artifact — the thing §2a says must be two
entities.

The design must pick one of:

- **(a) Keep `congregation_statistics` as the presbytery's typed keyspace, make
  published rows a projection of a publication.** Add `publication_id` (not null
  when `provenance = 'published_by_congregation'`); move `supersedes_publication_id`,
  `published_at`, `minute_reference` to `publications`; the publish function
  writes artifact → publication → statistics row in one transaction. Every
  existing consumer (rollup, per-capita basis-year lookup) keeps working.
  DECISION-120's argument ("every consumer needs the same `(about_org, year)`
  keyspace regardless of who wrote a row") still holds and is the reason to
  prefer this.
- **(b) Retire the published provenance** and have the presbytery read through
  `publications → artifact`. Cleaner on paper; breaks the keyspace argument and
  every 4a/4b consumer.

Recommend (a). Either way, the migration that introduces `publications` must
**backfill** one publication row per existing published statistics row, or the
history the freeze trigger has been protecting becomes orphaned.

**A rule the doc must state either way:** under D19, *which* presbytery receives
a publication? `parent_id` at `published_at` is what the built function does. A
late filing (February 2027 for report year 2026, after a January redistricting)
lands at the new presbytery under that rule, while the archive attributes 2026
to the old one. Polity answer: the report goes to the presbytery of *current*
membership (it is the reviewing council, G-3.0107). State it, and make the
archive's attribution rule the same function.

### R3.5 — D21's "three states" are not three tables

`statistical_projection` is "computed live from the roll, recomputable" — that is
a function (`presby_roll_as_of()` and friends), not a row. The built
`sasr_reports` (`reporting.ts`, unused) is a *stored* projection with a mutable
`payload` and `$onUpdate`, plus `status: draft | session_approved | submitted`.
Under D21 it is either the congregation's **working draft** that freezes into a
submission, or it is dead. Say which. If it survives as the draft, `submitted`
stops being a status on the draft and becomes the existence of a submission row.

**Then notice that `statistical_submissions` and `sasr_archive` are one table.**
D11 says they have different *reconciliation* semantics — true, but that is a
rule applied at write time, not a storage shape. Both are: an immutable,
form-versioned, as-reported artifact about one congregation for one year, owned
by one council. They differ only in provenance and in who owns them:

```
statistical_returns                      -- one table, two provenances
  id, organization_id (OWNER: the congregation for submitted, the presbytery
      for imported), about_org_id, report_year, form_version_key,
  provenance (submitted | imported),
  payload jsonb not null,
  reconciled boolean not null,           -- true only for submitted; imported never
  attested_by_name, attested_role, attested_at,   -- submitted
  source_ref, staging_row_id,                     -- imported (D13 provenance)
  created_at
  unique (id, organization_id)
  -- NO unique on (about, year): a corrected submission is a new row, and
  -- publications.supersedes_id says which one is current. See R3.8.
```

`publications.artifact_id` then references one table for both. The union view
§5 asks for becomes unnecessary; the normalising view over `form_version_key`
is still needed (§10.1).

**The payload versus allow-list tension has to be resolved explicitly.**
DECISION-118 made the publish function's *parameter list* the allow-list ("a
field with no parameter slot cannot smuggle through"). A `payload jsonb`
artifact loses that unless `sasr_form_versions.field_spec` is enforced by a
trigger (keys ⊆ spec, value types match, counts non-negative and bounded). If
`field_spec` is documentation, the F26 argument is gone. Make the trigger part of
the D12 design, and keep the typed `congregation_statistics` row as the
materialization that consumers actually query.

### R3.6 — D19's shape is missing what its own invariants require

§3's `organization_affiliations` column list omits `relationship_type` (named in
the D19 text) and `authority`. The three invariants need concrete mechanisms:

1. Non-overlap: `EXCLUDE USING gist (organization_id WITH =, relationship_type
   WITH =, daterange(effective_from, effective_to, '[)') WITH &&)`. This needs
   the **`btree_gist` extension** — name it in the migration and check it
   exists. Worth saying out loud because §A designed `path` as `ltree` and the
   built column is `text` with a slug-derived string (`deriveOrgPath`, roots
   only); extension adoption has quietly slipped once already.
2. Singular-current: implied by 1 with `effective_to is null` as the open bound.
3. `parent_id` derived: an `AFTER INSERT OR UPDATE` trigger on affiliations sets
   `organizations.parent_id` **and `path`**; a `BEFORE UPDATE OF parent_id` trigger
   on `organizations` rejects the write unless a GUC the affiliation trigger sets
   is present. `path` today is only derived for parentless orgs — reparenting
   (D19's whole point) needs a recursive rebuild of the subtree's paths.

Two more checks the shape needs: parent type must fit child type (congregation
and NWC → presbytery, presbytery → synod, synod → GA), and a dissolution event
should close the open affiliation on `effective_on` — the archive still
resolves "presbytery as of 1990" from the closed range.

### R3.7 — Lifecycle events and affiliations are council acts, so they are council-owned rows

Both tables are drawn as `organizations`-style structural tables with no owner.
But every one of these is an act *of a council about an organization*
(G-3.0301(c): the presbytery organizes, receives, merges, dismisses, dissolves —
and synod/GA redistrict). That is exactly the `about_org_id` pattern §9.1 asks
to make a convention: `organization_id` = the acting council, `subject_org_id`
= the organization acted upon, FORCE RLS, ordinary tenant policy. Then:

- PSV records the 87 dissolutions in its own tenant context, through
  `withOrgContext()`, with an audit row — no `getPlatformDb()` needed.
- `minute_reference`, `reason` and `notes` (which can say *why* a church was
  dissolved) stay inside the presbytery's records instead of on a table with a
  bare public `select` grant. The public tree needs only `(child, parent,
  from, to)` — expose that as a view or via the derived `parent_id` cache.
- `platform_status` changes stay a platform-admin act through `getPlatformDb()`
  — the three axes stay three write paths.

### R3.8 — `sasr_archive.unique (organization_id, about_org_id, report_year)`

Two real cases break it: an amended historical return (PSV's spreadsheet has
overlapping tab years), and a congregation whose two predecessors both reported
in the merge year. Drop the unique; if de-duplication matters at import, do it in
the D13 staging workflow where the candidate set is visible.

### R3.9 — F33's matching key has nowhere to live

F33: matching needs `(name, city, year)`. §3's `organization_name_history` (which
is also stale — §2a made it typed with `name_type`, §3 has no type column)
carries no city, and city lives today on `organization_profiles`, which is
congregation-editable and **does not exist for unmanaged congregations**
(DECISION-120 ruling 3 made that point for lat/long). Put `city` and `state` on
the name-history row — a name *at a place* is the matching unit — and index
`(lower(name), lower(city))`.

### R3.10 — D16's grant row absorbs the submission

`statistics_submission_grants.submitted_payload / attested_by_name /
attested_role / minute_reference` duplicate the artifact D21 defines. The grant
is a **credential**; what it produces is a `statistical_returns` row
(`provenance = 'submitted'`) plus an automatic `publications` row to the issuing
presbytery. Keep `submitted_at` and `return_id` on the grant as the link; move
the rest. Constraints the shape needs: `token_hash unique`; one live grant per
target — `unique (organization_id, about_org_id, report_year) where revoked_at is
null and submitted_at is null`.

State the ownership consequence, because it is correct and non-obvious: a
grant-submitted return for an `unmanaged` congregation is **owned by the
congregation** (`organization_id` = the congregation) in a tenant nobody can
enter. When that congregation becomes `managed`, it inherits its own filing
history on day one, and the presbytery's stewardship lapses (D9). That is the
handover working as designed; the doc should claim it.

### R3.11 — §7 and §8 person references must be composite (F2)

`giving_donors.person_id`, `pastoral_act_participants.person_id`,
`care_interactions.person_id`, `care_assignments.person_id / caregiver_person_id`
are all drawn bare. Under D1 `people` is global, so a bare reference lets a
presbytery hold a donor or a bereavement note about a congregation's member. All
of them are `(person_id, organization_id) → memberships` composite FKs, nullable
where the doc says nullable. The doc already knows this rule; the shapes just
don't show it, and §9.5 warns that `payload jsonb` reappearing needs a stated
rule — bare `person_id` reappearing needs the same.

`pastoral_acts.officiant_person_id` is the hard case: "may be a minister of
another presbytery" means no membership here, so a composite FK is impossible and
a bare global reference is the F2 violation. Precedent: `transfer_certificates.
issuingPersonId → people` is the one sanctioned global reference and it is
minimal-disclosure by design. Recommend `officiant_name text not null` plus an
optional composite `officiant_person_id` for the member case, and no global
reference.

`pastoral_acts.resulting_roll_action_id` → composite to `roll_actions (id,
organization_id)`. If the action is later voided the act keeps pointing at it;
say that is acceptable (the register entry stands, the roll correction is
separate) so nobody "fixes" it with a cascade.

### R3.12 — "Never delete an organization" versus every `on delete cascade`

Every tenant FK is `references organizations(id) on delete cascade`, and on
2026-08-31 the operator cascade-deleted 58 fixture/leaked orgs from production
through the owner connection, disabling four immutability triggers to do it.
`revoke delete on organizations from presby_app` does not touch that path.
Decide the exemption explicitly rather than by convention: a
`BEFORE DELETE` trigger that rejects unless the org is a fixture (a
`platform_status = 'fixture'` value, or a `deletable_until` set at test
provisioning) — because the DB-backed test suite's leak (`docs/TODO.md`) is a
real, recurring need for deletion, and "never" that is violated monthly is not
an invariant.

---

## B. Design decisions the document leaves implicit

### R3.13 — How D23's care grants are enforced at the database

D23 says non-transitive, purpose-scoped, excluded from support and impersonation.
`presby_effective_permissions()` has four arms and role templates; a care
permission that flows through `role_grants` is transitive by construction
(anyone who can grant the role grants the access). The mechanism the doc does
not name: a separate **`care_grants`** table (`grantee_person_id`, `purpose`,
`expires_on`, `granted_by`, `minute_reference`), *not* a permission key in the
catalog, and `care_*` tables readable only through SECURITY DEFINER functions
that check the grant — the "controlled read, not a policy" idiom
`presby_match_person()` established. That keeps §17's rule (only two named
bespoke cross-org policies) intact; a bespoke RLS policy that checks grants would
be RLS doing authorization, which the invariants forbid. `check:audit` should
treat every `care_*` mutation as security-sensitive.

Also drop the §8 suggestion that `care_assignments` reference the derived
Diaconate group. Stephen ministers and pastors carry care loads without being
deacons; constraining the caregiver to a group membership over-constrains, and
the assignment would have to end when the term ends. Composite person FK, no
group constraint.

### R3.14 — Give `about_org_id` teeth now that affiliation history exists

`presbytery.ts` says the `about_org_id` relationship is "validated at the
application layer … the DB does not enforce that relationship itself" — a paper
invariant on five tables and growing (§9.1). D19 makes it enforceable: a
SECURITY DEFINER `presby_org_affiliated(subject, council, as_of)` reading
`organization_affiliations`, called from a trigger on every about-org table
(`as_of` = the row's year for statistics, `now()` for oversight). One convention,
one trigger, one test in `test-rls.sql`.

### R3.15 — `sasr_form_versions` and cross-generation queries (§10.1)

Platform-wide reference, no RLS, seeded by migration. `field_spec` needs its own
documented schema (field key, type, bounds, which SASR line it maps to, and a
`comparable_to` link to the equivalent field in adjacent versions). Answer to
§10.1: the normalising view exposes a field for a year span **only if every
version in the span has a mapping for it**; otherwise the column is absent, not
null — a query that asks for 56–70 across 1984→2024 fails to compile rather than
silently returning zeros. Promote to F34.

### R3.16 — D13 staging shape

Two tables, not one: `import_batches` (source file, worksheet, form version,
**column map** — F32 says the positional arrays only decode against per-tab
column orders) and `import_rows` (batch, row number, `raw_row jsonb`, original
org name, city, `candidate_org_ids uuid[]`, resolution kind
`matched_alias | created_historical_org | rejected`, resolved org, resolving
actor, date, rationale, resulting `statistical_returns.id`). Owned by the
presbytery, FORCE RLS.

---

## C. Cross-checks that passed

- D10's vocabulary against G-3.0301(c): correct, and `received`/`dismissed` as
  denomination-boundary events is the right reading.
- D15 (presbytery risk book ≠ congregation ledger): consistent with the built
  `congregation_oversight` ownership and DECISION-120.
- D18 tier placement and the no-wildcard invariant: consistent; `member_care_admin`
  and `children_ministry_admin` already model the "roster ≠ medical" split
  D18 wants (DECISION-111).
- D22: consistent with `presby_match_person()`'s propose-don't-dispose shape;
  needs only a `person_merges` provenance table, independent of this unit as the
  doc says.
- Per-member giving never visible to a parent council: expressible as a test
  today (no cross-org policy exists on any giving table because no giving table
  exists); keep it as a `test-rls.sql` section from the first Track E migration.
- §9.5's jsonb rule ("as-reported external data whose shape we do not control")
  is the right rule and, with R3.5, is satisfied by exactly one table.

---

## D. Recommended order for the DDL pipeline

1. `organization_identifiers`; move `pcusa_pin`; drop `organizations.status`
   (R3.2, R3.3).
2. `organization_lifecycle_events` + `organization_successions` +
   `organization_affiliations` as council-owned rows (R3.1, R3.6, R3.7), the
   `parent_id`/`path` derivation triggers, `btree_gist`, the delete guard (R3.12),
   backfill one `organized`-or-`received` event and one affiliation per existing
   org from `parent_id`.
3. `presby_org_affiliated()` and the about-org trigger on the five existing
   tables (R3.14).
4. `sasr_form_versions` with the enforcing trigger; `statistical_returns` (R3.5,
   R3.15).
5. `publications`; retrofit `congregation_statistics` per R3.4(a) with backfill;
   rewrite `presby_publish_sasr_snapshot()` to write return → publication →
   statistics row; decide `sasr_reports`' fate.
6. `statistics_submission_grants` (R3.10) — its own security review, as §6 says.
7. `organization_name_history` with city (R3.9); D13 staging (R3.16).
