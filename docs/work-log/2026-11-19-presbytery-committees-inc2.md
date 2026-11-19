# Presbytery committees Increment 2 — administrative commission records — Work Log

> **Slug:** `2026-11-19-presbytery-committees-inc2`
> **Surface:** (org) — the presbytery's Committees & Commissions pages (`/o/<presbytery-slug>/admin/committees/commissions/...`), presbytery type only; `/help`
> **Permission(s):** existing `groups.manage` (tier 1), settled Q2. No new key. A commission record gives its members **no access** to anything; nothing in this increment writes `administrative_commissions`, `org_delegations`, `role_grants` or a `role_id`.
> **Flag(s):** none new. Rides the existing global `org_portal.committees`.
> **Estimated complexity:** medium
> **Pipeline mode:** Full (**no schema change in this increment**; 0090 shipped in Increment 1 and holds the commission tables)
> **Release:** 0.64.0 (`package.json` bump and `docs/release-notes/v0.64.md` after Phase 6 SHIP IT, through `/release-notes`)
> **Parent:** `docs/work-log/2026-11-19-presbytery-committees.md` (Phases 1 to 3: the analyst's brief and the orchestrator rulings Q1 to Q7, the architect's R1 to R6 and DECISION-352 to 356, and the one Phase 3 design for both increments). **Do not restate or summarize them here.**
> **Numbers (pre-assigned, Rule 16):** migration 0090 (applied in Increment 1; **this increment adds no schema, and if the design later needs one it asks the orchestrator for a new number and never edits 0090**); DECISION-352 to 356 (architect), 357 to 359 used by Phase 3, 360 next; F456 to F458 (architect), F459 and F460 used by Phase 3, F461 next; dev port 3101 (`PW_PROD_PORT=3801` for the production hydration lane); e2e ids `00000000-0000-4090-8000-` (people), `-9000-` (roles), `-9001-` (organizations); Neon branch `br-calm-rice-ax2zn9jw`; worktree `../presby-committees`, branch `pipeline/presbytery-committees` (a fresh branch from `main` after 0.63.0 is released)
> **Source:** operator decisions A–G, 2026-11-17 ("administrative commissions are needed at go-live"); operator 2026-11-19: "start committees and take it to production"

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (parent) | READY WITH NOTES | 2026-11-19 |
| 2 — Architectural review | architect | Complete (parent; R1–R6) | Approved with suggestions | 2026-11-19 |
| 3 — Technical design | tech-lead | Complete (parent; this log carries the increment slice below) | Design complete | 2026-11-19 |
| 4 — Implementation | api-developer (B5), ux-developer (B6), full-stack-developer (B7) | **Complete** (B5, B6, B7; 2026-11-19) | Ready for Phase 5 | 2026-11-19 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 and Phase 2

See the parent log. Recorded there verbatim; not copied.

# Phase 3 — Technical Design (tech-lead): the Increment 2 slice

The design is in the parent's Phase 3. Sections an implementer of this increment reads: "Design rulings" (T6 to T8, T12), "Commission member role vocabulary", "Data Model" section 3 (the tables already exist), "Module and file plan" (the **II** marks), "API Contract" (Increment 2 actions and the six audit keys), "Component / Page Plan", "Implementation Order — Increment 2", "Copy" C15 and C16, "Test plan" (the **II** rows), "Carry-forward" (Gaps 2 to 5), "Edge Cases & Risks" (the commission items).

**Scope.** The commission record: the Administrative commissions section on the list, the record form (title, charge, optional congregation, appointed on, minute reference), the commission page with its member roster (add and end a member, the six titles), "End commission" (every member ended on the date), "Remove this record" (the cut-able control), the neutral congregation refusal, the six `commission_record.*` audit keys, the help rewrite of the "Administrative commissions" section and the roles and privacy edits, the tile description. **No schema change.** Cut order if time forces it (parent): "Remove this record" first. Never cut the record itself.

**Preconditions to confirm before B5 starts:** 0.63.0 is released and 0090 is applied in production; `main` is checked for new migrations, new `group_role` values and changes to `groups.ts`, `store.ts` seams or `role-grants.ts` (parent "Feasibility check": a design whose Phase 4 starts after another pipeline has merged re-runs it against the live tree first).

## Batches

| Batch | Implementer | Work | Exit gate |
|---|---|---|---|
| **B5** | api-developer | commission additions to `contract`, `validate`, `copy` (**C15 strings only**), `derive`; `store.ts` and `reads.ts` commission functions; the six audit keys and `audit.test.ts`; the `actions.ts` files under `commissions/`; `boundaries.test.ts` and `audit-coverage.test.ts` extensions; `store.db.test.ts` and `reads.db.test.ts` commission cases, including the congregation resolver (another presbytery's, a non-congregation and a nonexistent id give **byte-identical** answers; a closing congregation is accepted) | `npm run check` zero; failing-first for the audit rollback, the live-guard race (add versus end) and the interval overlap |
| **B6** | ux-developer | the commissions section, record form, commission page, member form, end-commission and remove dialogs, the tile description, **the help rewrite (C15) and the roles and privacy edits (C13)**, a 360px walk of every state, light and dark | typecheck, build, `check:hydration-gate`, `check:help`, a 360px walk |
| **B7** | full-stack-developer | fixture additions (`committees-fixture.ts` is this pipeline's own file), `committees-commissions.spec.ts`, `hydration/commissions-forms.spec.ts`, the regression of the Increment 1 specs, the founding-administrator walk for the commissions half | own server on 3101; specs green; production hydration lane green |

Order: B5 before B6 (B6 imports `reads`, `copy`, `contract`); B7 starts when B6's pages exist.

## Gates (every batch)

Same as Increment 1 (parent "Implementation Order", this child's sibling): `npm run check` zero; typecheck, lint and build; no native dialogs; no `console.log`; audit rows in the mutation's own transaction; `HydrationGate` on every form root; a 360px walk; implementer-written tests; no `git stash`, no `pkill -f next`; shared files only by integration patch; **nothing writes `administrative_commissions`, `org_delegations`, `role_grants` or a `role_id`**; a string not in Copy stops for a ruling.

## Increment-specific notes

**Handoff.** Next agent: **api-developer** (B5), after Increment 1 ships and its release is recorded.

- **Deploy:** code only, no migration. The commission tables already exist in production from 0090.
- **The no-access sentence ships with its boundary test** (parent Gap 2): C15's "This record gives no one access to {congregation}'s PresbyPortal, and {congregation} does not see it." is true only while nothing writes a role and the policy is organization-only; `boundaries.test.ts` and `test-rls-90.sql` (d), (i), (j) pin both.
- **Phase 6 walks:** the commissions section and page at 360px as the person the invitation path creates; a commission about a congregation and about none; end and remove; the congregation's own administrator cannot reach the record; the help page's rewritten section and the two edited pages read as their reader.
- **Release notes:** the C16 lines through `/release-notes` after SHIP IT; the functionality-map line (Rule 14); TODO line 507 moves to Done (Rule 10); a TODO line proposing the later `groups.manage` description update (T12).
- **Operator question (non-blocking, default taken):** commission members use the same six titles as committees, with the presiding member called "Chair"; "Moderator" would be one forward migration (parent T6).

---

# Phase 4 — Implementation

## B5 — api-developer (2026-11-19)

Scope as the batch table states it: the commission additions to `contract`, `validate`, `copy` (**C15 strings the module produces**), `derive`; the commission functions of `store.ts` and `reads.ts`; the six audit keys and `audit.test.ts`; the `actions.ts` files under `commissions/`; the `boundaries.test.ts` and `audit-coverage.test.ts` extensions; the `store.db.test.ts` and `reads.db.test.ts` commission cases. **No page, component, tile, help page or Rule 16 shared file is touched, and no migration** (0090 was not changed). Worked in `/Users/cshenso/git/presby-platform/presby-committees` on `pipeline/presbytery-committees-inc2`, against the pipeline's own Neon branch only.

**The hard rule holds and is pinned three ways.** Nothing here writes `administrative_commissions`, `org_delegations`, `role_grants` or a `role_id`: (1) `boundaries.test.ts` scans every spelling in the module, the route tree and the components (and a new rule scans the real tree a second time with a case-insensitive pattern); (2) a new boundary rule bars every `*Commission*` function of `store.ts` from naming any groups primitive, `group_memberships`, `groups` or a `group_id`, so a commission member can never become a group seat; (3) the DB tests snapshot the three downward-side counts and every committee table before and after `recordCommission` and `addCommissionMember` and find them unchanged.

### Files Created

- `src/app/(org)/o/[slug]/admin/committees/commissions/actions.ts` (+ `actions.test.ts`, 17 cases): `recordCommissionAction`.
- `src/app/(org)/o/[slug]/admin/committees/commissions/[commissionId]/actions.ts`: `updateCommissionAction`, `addCommissionMemberAction`, `endCommissionMemberAction`, `endCommissionAction`, `removeCommissionRecordAction`.

### Files Modified

- `src/lib/committees/contract.ts`: `LIMITS` gains `titleMax` 200, `chargeMax` 500, `minuteMax` 200; `COMMISSION_CHANGED_FIELDS` (`title`, `charge`, `congregation`, `appointedOn`, `minuteReference`) and `CommissionChangedField`; `Refusal` gains `commission_ended` and `congregation_not_found`; `RefusalDetail` gains `subject?: "commission"` and `presbyteryName?`; `ActionData.membersEnded`; the `CommissionFormRead<T>` reader type.
- `src/lib/committees/validate.ts`: `parseCommission`, `parseExpectedVersion`, `parseCommissionMember` (the committee seat parse, same rules and messages: C15 says "the person, role and date fields and helpers of C5"), `parseEndCommission`, and the thin zod wrappers `commissionSchema()`, `commissionMemberSchema` (= `seatSchema`), `endCommissionSchema(env, record?)`.
- `src/lib/committees/copy.ts`: C15's validation messages (`VALIDATION.titleRequired` and the five after it), the refusal strings (`REFUSAL.commission_ended`, `COMMISSION_REFUSAL`), `commissionNoAccess(congregation | null)`, `commissionAboutLine(congregation | null, stillMember)`, and five toasts. `refusalMessage` selects the commission wording for `stale`, `overlap`, `already_ended` and `date_before_start` when `detail.subject === "commission"`, and builds `congregation_not_found` from `detail.presbyteryName`.
- `src/lib/committees/derive.ts`: `groupCommissions` (active newest-appointed first; ended most-recently-ended first; total order).
- `src/lib/committees/store.ts`: `recordCommission`, `updateCommission`, `addCommissionMember`, `endCommissionMember`, `endCommission`, `removeCommissionRecord`; the shared `currentMemberName` (the person check `addCommitteeSeat` used inline, now shared; behaviour identical, covered by the unchanged D3 `not_a_member` case).
- `src/lib/committees/reads.ts`: `readCommissionList`, `readCommission`, `readCommissionFormOptions`, `readCommissionMemberFormOptions`.
- `src/lib/committees/action-gate.ts`: `finishCommission` (the commission twin of `finish`: revalidates the list and `/commissions/<id>`).
- `src/lib/audit.ts` + `audit.test.ts`: the six `tenant.commission_record.*` keys in a second APPENDED block (metadata allowlist in the comment).
- Tests: `validate.test.ts` (27 to 43), `derive.test.ts`, `copy.test.ts`, `contract.test.ts`, `audit-coverage.test.ts`, `boundaries.test.ts`, `store.db.test.ts` (49 to 86), `reads.db.test.ts` (18 to 34).

### API contract (the next agent, B6, consumes this)

No route handler. Every mutation is a Server Action taking `(slug, values)` where `values` is a **plain object of strings** (never `FormData`) and the ids travel inside it; `organizationId` is never a parameter. All return `CommitteesActionResult` (`{ ok: true, data?: { id, unchanged?, membersEnded?, cancelled? } } | { ok: false, error, field?, kind? }`); `error` is always one fixed `copy.ts` string. **Gate, the same one as Increment 1** (`resolveCommitteesActor`, so G1 holds): `assertOrgSession(await auth())` (a stale second factor gets the signed-out string), `resolveOrgContext`, **`org_portal.committees`** (off: the page's own flag-off sentence), `isUuid` on every id named to the gate (`not_found` string before any SQL), the pure parse, then the store, which re-checks **`groups.manage`** and the presbytery type in its own transaction and writes ONE audit row in the same transaction. No new key, no flag, no `FEATURES` entry.

| Action (file) | Values | Store behaviour | Audit key and metadata (ids, enums, booleans, counts, dates, field NAMES only) |
|---|---|---|---|
| `recordCommissionAction(slug, v)` (`commissions/actions.ts`) | `title, charge, aboutOrgId, appointedOn, minuteReference` (`aboutOrgId` empty is "No congregation") | named congregation resolved by `resolveMemberCongregation` (this presbytery's child, type congregation, **no lifecycle filter**); every miss is `congregation_not_found` | `COMMISSION_RECORD_RECORDED` `{ organizationId, commissionId, aboutOrgId: string \| null }` |
| `updateCommissionAction(slug, v)` (`[commissionId]/actions.ts`) | the same five + `commissionId, expectedVersion` (the reader's `rowVersion`, a number or digits) | row `FOR UPDATE`, `row_version` compare (`stale`), diff; nothing changed writes and audits nothing (`unchanged: true`); an ended record may still be corrected; the congregation is resolved **only when the edit moves it** (a congregation that has left stays named through an unrelated edit) | `COMMISSION_RECORD_UPDATED` `{ …, commissionId, changed: ("title" \| "charge" \| "congregation" \| "appointedOn" \| "minuteReference")[] }` |
| `addCommissionMemberAction(slug, v)` | `commissionId, personId, role, startsOn, endsOn` | current membership (`not_a_member`), the six titles, the committee date rules, **interval overlap** under the record's members lock, `commission_ended` | `COMMISSION_RECORD_MEMBER_ADDED` `{ …, commissionId, memberId, personId, role, startsOn, endsOn: string \| null }` |
| `endCommissionMemberAction(slug, v)` | `commissionId, memberId, endsOn` (empty allowed for a term that has not started) | as `endCommitteeSeat`: half-open, cancel-planned ends at its own start, same date again is `unchanged` | `COMMISSION_RECORD_MEMBER_ENDED` `{ …, commissionId, memberId, personId, role, endsOn, cancelled }`; returns `data.cancelled` |
| `endCommissionAction(slug, v)` | `commissionId, endedOn, endedMinuteReference` | record locked `FOR UPDATE`, roster read after; not future, not before the appointment, not before the start of any begun member; ends every member (not-yet-started ones zero-length at their own start); one-way | `COMMISSION_RECORD_ENDED` `{ …, commissionId, endedOn, membersEnded }`; returns `data.membersEnded` |
| `removeCommissionRecordAction(slug, v)` | `commissionId` | one UPDATE of the removal pair (soft, one-way); a removed or foreign record is `not_found` | `COMMISSION_RECORD_REMOVED` `{ …, commissionId }` |

All six write `resourceType` `commission_record` and `resourceId` the record's id (a member event names its member in `memberId`). **Refusal kinds a commission form can read from `result.kind`:** `unauthenticated`, `two_factor_required`, `forbidden`, `not_found`, `seat_not_found` (a member), `invalid` (with `field`), `overlap`, `not_a_member`, `stale`, `already_ended`, `date_before_start`, `commission_ended`, `congregation_not_found`, `save_failed`. A client toasts `result.error` and puts an `invalid` message under `result.field` (`title`, `charge`, `appointedOn`, `minuteReference`, `personId`, `role`, `startsOn`, `endsOn`, `endedOn`, `endedMinuteReference`). A missing or unusable `expectedVersion` is refused as tampered (`REFUSAL.save_failed`, kind `invalid`); the form always carries it.

**Form validation.** `commissionSchema()` (fields `title, charge, aboutOrgId, appointedOn, minuteReference`: the congregation id is **not** validated client-side, so a bad one reaches the store and gets the one neutral answer), `commissionMemberSchema(env)` (fields `personId, role, startsOn, endsOn`), `endCommissionSchema(env, { appointedOn })` (fields `endedOn, endedMinuteReference`; pass the record's `appointedOn` so the form agrees with the store). The member-term end dialog uses the existing `endSeatSchema(env, { startsOn })`. `env` is `{ today }` from the reader's `today`.

**Readers** (`reads.ts`; each its own `withOrgContext` transaction; the key then the presbytery type are checked first, inside it; `{ kind: "ok", data } | { kind: "forbidden" } | { kind: "not_found" }`):

| Reader | Returns |
|---|---|
| `readCommissionList(viewer, { showEnded? }, now?)` | `{ today, commissions: [{ id, title, aboutOrgId, congregationName, appointedOn, endedOn, servingCount }], endedCount, showEnded }` in **five queries whatever the count**; **never carries a charge**; removed records never listed; ended ones only when asked, their count always |
| `readCommission(viewer, commissionId, now?)` | `{ today, commission: { id, title, charge, aboutOrgId, congregationName, congregationIsMember, appointedOn, minuteReference, endedOn, endedMinuteReference, rowVersion }, members: [{ memberId, personId, displayName, role, startsOn, endsOn, connected, deceased }] }`; a removed, foreign, wrong-kind, nonexistent or malformed id is the one `not_found`. `congregationIsMember` false (with a name) is "(no longer a member of this presbytery)"; the members split with `splitRoster(members, today)` |
| `readCommissionFormOptions(viewer, now?)` | `{ today, congregations: [{ id, name }] }`: this presbytery's member congregations, **no lifecycle filter** (a closing one is choosable); the first option, "No congregation", is the form's. An edit form for a record whose congregation has left will not find it in this list: show the stored `congregationName` from `readCommission` |
| `readCommissionMemberFormOptions(viewer, commissionId, now?)` | `{ commissionTitle, people: [{ personId, displayName, alreadyServes }], today }`, or `{ kind: "commission_ended" }` (the page renders that state, not a form) |

**Strings the module produces** are all in `copy.ts` (C15): `commissionNoAccess(name | null)` and `commissionAboutLine(name | null, stillMember)` (the two sentences U3 pins byte for byte), `TOAST.commissionRecorded | commissionSaved | commissionMemberAdded | commissionEnded | recordRemoved` (a member term end reuses `TOAST.termEnded`, `endDateSaved`, `plannedCancelled`), `VALIDATION.*`, `refusalMessage(reason, detail)`. The commission pages' own chrome (headings, buttons, field labels, helpers, empty states, dialog titles) is B6's, in `ui-copy.ts`, from C15. `derive.ts#groupCommissions` and the existing `splitRoster`, `seatDatesText`, `chairNames` and `personStatus` serve the pages.

No seed, `FEATURES`, flag or dependency change.

### Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`) | clean |
| `npm run check` (all ten tripwires, new files staged so `check:secrets` sees them) | 10/10 passed |
| New and changed unit tests (no database) | 696 passed, 0 failed across `src/lib/committees`, `src/lib/audit.test.ts`, the committees routes and `presbytery-reports` (committees-only count 270 across 15 files). New in B5: validate +16, derive +2, copy +3, contract +2, boundaries +6, audit-coverage +2, commission actions 17 |
| Full unit suite, no DB credentials (`npx vitest run`) | 938 files passed, 165 skipped, **0 failed**; 15,508 tests passed, 4,486 skipped |
| **DB suites, serial, pipeline Neon branch** (`npx dotenv -e .env.local -- vitest run --no-file-parallelism` over the six committees DB files) | **204 passed, 0 failed** (558 s): `committees.db` 28, `committees.schema` 26, `store.db` **86** (49 + 37 new), `reads.db` **34** (18 + 16 new), `seat-semantics.db` 5, `groups.committees.db` 25. The 49 and 18 Increment 1 cases pass (no existing case edited; `store.db.test.ts` gained the `@/lib/presbytery` stand-in the oversight suite uses, and its `beforeEach` resets it) |
| `scripts/committees/test-rls-90.sql` as presby_app | exit 0, 120 passes (unchanged: B5 adds no DDL) |
| Fixture hygiene | 0 organizations left from the two suites; `commission_records` 2 and `commission_record_members` 5 are the dev seed's rows, as before |

**Failing-first** (each break applied, the targeted tests run and shown red, then restored and shown green; `store.ts` restored from a copy and verified `cmp`-identical, sha-256 `4fa873a1…` before and after each, no mutation text left):

| Mechanism | Break | Red |
|---|---|---|
| **Audit rollback** (the audit is in the mutation's own transaction) | `audit()` made best-effort (the insert wrapped in a swallowing `try/catch`) | `fail_before` and `fail_after` each failed on the first write: `recordCommission: expected { kind: 'ok' } to deeply equal { kind: 'refused', reason: 'save_failed' }`; the non-vacuity control stayed green. Restored: 3 passed |
| **Interval overlap** | the `seatsOverlap` check in `addCommissionMember` disabled (`if (false && …)`) | the dated-terms case failed: `expected { kind: 'ok' } to match { kind: 'refused', reason: 'overlap' }`. The open-term cases and the two-adds race stay green by design: the database's one-open-seat index is their backstop, which is why the interval test uses **dated** terms. Restored: 6 passed |
| **Live-guard race (add versus end)** | the live-parent guard disabled on the pipeline branch (`alter table commission_record_members disable trigger commission_record_members_live_guard`; trigger state `D`) | the deterministic race failed: the add returned `{ kind: 'ok' }` and wrote a member on an ended commission. Trigger re-enabled (`tgenabled` `O`, identical to before); concurrency block green (6) |
| Congregation resolver (extra) | a malformed id answers `not_found` instead of `congregation_not_found` | both resolver cases failed (byte-identity broken). Restored, `cmp`-identical |

The live-guard test is deterministic rather than a loop of races: an owner-connection transaction holds the end of the record UNCOMMITTED, the store's add reads the record as active and blocks inside the guard's `FOR SHARE`, the end then commits, and the add must come back `commission_ended` with no member written. A looped add-versus-end race (six iterations, no member left serving on an ended commission) and an add-versus-remove race run beside it.

### Implementer Notes

Deviations and rulings needed (none touches an invariant; strings first, as the Gates require):

1. **Two `actions.ts` files, not three.** The design's Routes table lists `commissions/actions.ts` (record) and `commissions/[commissionId]/actions.ts` (the rest); the B5 batch row says "three". I followed the Routes table. Splitting the five record actions across two files would add a file for nothing.
2. **Resolved by ruling 1 (see "B5 rulings"): a commission that is not found.** C15 has no string for "that commission could not be found", and `REFUSAL.not_found` reads "That committee could not be found." I reused the existing kind and string (so every miss stays one answer: removed, another presbytery's, a committee's group id, a congregation's id, nonexistent, malformed) rather than invent one. A member miss uses `seat_not_found` ("That member could not be found."), which fits. If the tech-lead wants "That commission could not be found.", it is one new kind or a `subject` branch in `refusalMessage` and one line in `copy.test.ts`; B6 should not word a commission page's not-found state until that is ruled.
3. **Resolved by ruling 2 (see "B5 rulings"): editing the appointment to a date after an end that has already been recorded.** The database CHECK forbids it and C15 has no sentence; the store returns `invalid` on `appointedOn` with the existing "That date isn't valid." Reachable only by editing an ENDED record's appointed-on past its end.
4. **Resolved by ruling 3 (see "B5 rulings"): no upper bound on "Appointed on".** C15 words none (the committee start date's "5 years ahead" string says "start date"). A mistyped far-future appointment would make the record un-endable (the end can't be in the future) until that date. I enforce only the database's 1900 floor. If a bound is wanted it needs a string.
5. **`RefusalDetail.subject: "commission"`** is how the same kinds (`stale`, `overlap`, `already_ended`, `date_before_start`) carry C15's wording without new kinds; `copy.test.ts` pins that each differs from the committee wording and that the default is unchanged.
6. **One reader beyond the design's two:** `readCommissionMemberFormOptions` (and the `CommissionFormRead` type). The add-member page needs the people list with `alreadyServes` and the ended-record state; `readCommissionFormOptions` is the record form's (congregations), as designed.
7. **Locking, deliberately asymmetric.** Add and end-a-member take the record's members advisory lock (`commission_members:{org}:{commission}`); **ending or removing the record does not**, so an add racing an end is settled by the database's live-parent guard (the T8 claim the test pins) and not hidden by an app lock. `endCommission` locks the record `FOR UPDATE` first and reads the roster after, so a member added a moment earlier is ended with the rest; `endCommissionMember` reads the record `FOR SHARE`, so it cannot interleave with the end of the record. No cycle exists (the advisory lock is never taken after a row lock).
8. **The congregation id is audited and stored in its canonical lower-case form** (the resolved id), and an edit compares it lower-cased, so an upper-case id in a form is not read as a change.
9. **Member and congregation-less edge:** an unrelated edit of a record whose congregation has left the presbytery passes (R9; the resolver runs only when the edit moves the congregation), pinned in `store.db.test.ts`.
10. **`boundaries.test.ts`'s `exportedFunctions` helper now also ends a function body at a top-level `interface` or `type`.** Otherwise `readCommissionList`'s body ran into `CommissionSqlRow`'s field names and the new "only the record reader names the charge" rule flagged it. Every existing rule still passes.
11. **Failure-path logging unchanged:** a trigger refusal (the 0045 about-org check, SQLSTATE 42501) is the same `congregation_not_found` answer, writes nothing and logs nothing; any other database error logs one fixed line (the SQLSTATE) and returns `save_failed`.

### B5 rulings (orchestrator, applied in this branch after the first B5 commit)

Three orchestrator-ruled additions to C15 (the strings are quoted exactly; `copy.test.ts` pins them byte for byte):

| # | Ruling | String | Where |
|---|---|---|---|
| 1 | A commission that cannot be found | "That commission could not be found." | `COMMISSION_REFUSAL.notFound`, next to the committee's `REFUSAL.not_found`. The kind stays `not_found` and carries `detail.subject = "commission"`; every commission miss (removed, another presbytery's, a committee's or congregation's id, nonexistent, malformed, the removal guard) is that one answer, and a commission action's malformed id gets it from the gate (`resolveCommitteesActor(slug, ids, { subject: "commission" })`). A member miss is still `seat_not_found` |
| 2 | An appointment after a recorded end | "The appointed date can't be after the end date." | `VALIDATION.appointedAfterEnd`. The store no longer pre-checks it: the database CHECK `commission_records_ended_after_appointed` is mapped in `outcomeFor` to `{ kind: "invalid", field: "appointedOn" }`, so the refusal is the database's and is not logged |
| 3 | An appointment after today | "The appointed date can't be after today." | `VALIDATION.appointedFuture`. `parseCommission(values, env)` and `commissionSchema(env)` now take `{ today }` (**a signature change for B6**: the form passes the reader's `today`); the action uses the server's UTC day; `recordCommission` and `updateCommission` re-check against the organization's local day. On update the rule applies when the appointment is being moved, so an unrelated edit is never held to it |

**Failing-first.** The tests were written and shown red before the change (unit: 7 failed across `copy`, `validate`, `action-gate` and the commission actions; DB: 5 failed in `store.db.test.ts`: the future appointment on record, on update, the ended-record appointment, the removed-record and the wrong-target `not_found` answers), then green after it. `parseCommission` callers in the tests pass `{ today }`.

**Gates after the rulings.** `tsc`, lint and `npm run check` (10/10) clean; committees and related unit tests 698 passed; full unit suite 938 files passed, 0 failed (15,510 tests); `store.db` (now 88: 86 + 2 new) and `reads.db` (34) run serially against the pipeline branch: **122 passed**. The other four DB files, `test-rls-90.sql` and the DDL are untouched by the rulings.

**Handoff to B6 (ux-developer).** Import `reads`, `copy`, `contract`, `derive`, `validate` as above. Pages call `gateCommitteesPage`, then `isUuid` on `commissionId` and `memberId` segments (404 before any read), then the readers with `Promise.all`; a reader's `forbidden` renders `CommitteesForbidden`, `not_found` renders `notFound()` (rulings 2 above pending for the wording of a commission miss), a throw renders the section load error, an `OrgAccessError` is rethrown. The list page adds `?show=ended` read as a fixed enum. The no-access sentence is `commissionNoAccess(congregationName | null)` and the page must show it (it is true by construction while nothing writes a role and the policy is organization-only; `boundaries.test.ts` and `test-rls-90.sql` (d), (i), (j) pin both). Forms: `HydrationGate` on `commission-form.tsx` and `commission-member-form.tsx` (two `useForm` roots), `end-commission-dialog.tsx` and `remove-record-dialog.tsx` are plain controlled AlertDialogs; the form carries `rowVersion` as `expectedVersion`.

---

## B6 — ux-developer (2026-11-19)

Scope as the batch table: the commissions section, record form, commission page, member form, end-commission and remove dialogs, the tile description, the help rewrite (C15) and the roles and privacy edits (C13). No `loading.tsx`, no `route.ts`, no schema or server-module change, no Rule 16 shared file.

### Files Created

- Pages under `src/app/(org)/o/[slug]/admin/committees/commissions/`: `new/page.tsx`, `[commissionId]/page.tsx`, `[commissionId]/edit/page.tsx`, `[commissionId]/members/new/page.tsx`, `pages.test.tsx` (31). Each: `gateCommitteesPage`, `isUuid` before any read, reader outcomes as in Increment 1; `not_found` is `notFound()`.
- Components (`src/components/committees/`): `commissions-section.tsx` (cards below `sm`, table above), `commission-form.tsx` and `commission-member-form.tsx` (the two `useForm` roots, each in `HydrationGate` with the unsaved-changes guard), `end-commission-dialog.tsx`, `remove-record-dialog.tsx` (plain controlled AlertDialogs); tests `commission-views.test.tsx` (7), `commission-forms.test.tsx` (21).

### Files Modified

- `admin/committees/page.tsx`: the commissions section below the committees; `?show=` is a fixed enum (`dissolved`, `ended`, both, or nothing: any other value, in any combination, is no request); the commissions reader fails on its own (section error with "Try again") and the committees stay up; each toggle link keeps the other's state.
- `roster.tsx` now exports `RosterView` (renderActions prop) with `Roster` as the committee wrapper; `seat-card.tsx` takes an `actions` node. Behaviour of the committee page is unchanged (its tests pass untouched). `end-term-dialog.tsx` gains an optional `commissionId` (ends a member term through `endCommissionMemberAction`, worded for a commission). `committee-card.tsx` exports `LINK_CLASSES`; `committees-list.tsx` takes an optional `toggleHref`.
- `ui-copy.ts`: C2 II intro; `COMMISSIONS`, `COMMISSION_MEMBER`, `END_COMMISSION`, `REMOVE_RECORD`. `tiles.ts` (C11 II description) and its test.
- Existing tests: `pages.test.tsx` (commission readers mocked, new intro), `committee-forms.test.tsx` and `committee-views.test.tsx` (mock the commission member action, which `EndTermDialog` now imports), `ui-copy.test.ts` (+5), `tiles.test.ts`.
- Help: `presbytery-committees.md` (the "Administrative commissions" section rewritten, one intro sentence, one troubleshooting bullet), `registry.ts` (summary, 13 added labels; `verifiedIn` left at 0.63.0: Phase 6 walks it), `roles-who-can-do-what.md` (the bullet and the founding-administrator sentence), `privacy-policy.md` (the commissions clause, never published).

### Gates

| Gate | Result |
|---|---|
| `tsc --noEmit`, `npm run lint` | clean |
| `npm run check` (new files staged) | 10/10, including `check:hydration-gate` (two new roots) and `check:help` (34 entries, 31 published) |
| `npm run build` | passes |
| Full unit suite, no DB credentials | 941 files passed, 0 failed; 15,574 tests |
| Tap targets | measured in a real browser on every page and dialog at 360px: nothing of this feature under 44px; the only smaller elements are the platform shell's "PresbyPortal"/"Back to portal" links and sonner's close button |
| Horizontal scroll | `scrollWidth == clientWidth` on every page at 360px and 1280px, a 170-character commission title included |

### Browser walk (own server on 3101, stopped by PID 95728 and its wrapper 95710; Chromium; invented data)

Signed in as `committees.clerk@example.invalid` (`groups.manage` only). 360px light and dark, 1280px light and dark (the mutating walk ran at 360px light; the others read-only):
list with the commissions section and "Show ended commissions (1)"; the ended list; record form and its field errors; record with a congregation and a 170-character title; commission page (empty roster, then one member, then a planned clerk): charge, the no-access sentence, About line, four actions; add-member form and errors, the "(already serves)" option; end-term dialog; edit form and "The appointed date can't be after today."; end dialog (the date-before-appointment refusal stays in the dialog under the field); the two seeded records (active about a congregation, ended about none with "Reported in"); add member to an ended record; remove dialog, removal, and the removed id then answering the not-found page. Not walked in a browser: the empty-list state of the commissions section (the dev branch always has seed records; unit-tested), the stale-edit toast and the neutral congregation refusal (unit-tested; the latter needs a hand-built id). Walk residue on the pipeline branch: one removed record ("Walk Commission xxx...") with two members.

### Implementer Notes (deviations and strings for a ruling)

1. **C7 and C5 reused "for a commission", not word for word (needs a ruling).** C15 says "the helpers of C5" and "the C7 dialog" but those say "committee". Shipped with "commission": the Person helper ("People serve on a commission from the presbytery's own records..."), the Ends-on helper ("...no longer on the commission..."), the add-form empty body, and the member-term end dialog body ("Their name stays in the history of this commission, with its dates.") and helper. All in `COMMISSION_MEMBER`, pinned and checked to contain no "committee".
2. **One string not in Copy:** the select option for a record whose congregation has left the presbytery, "{name} (no longer a member of this presbytery)" (`COMMISSIONS.leftOption`), so an unrelated edit keeps the stored congregation selected (the reader's own contract).
3. **No empty-roster string for a commission** (C3's says "committee"): an active commission with no members shows the roster area empty under the actions, whose "Add a member" button is the next step. A ruling can add one.
4. **"Remove this record" shows on an ended record too** (the store allows it; "Edit commission" also stays). End, add and the member end controls are active-only.
5. **The list's commissions "Congregation" cell** says "About {name}" always (the list reader carries no still-a-member flag); the commission page says the "(no longer a member...)" form.
6. **The empty state shows one "Record a commission"** (the header button is hidden then), so there are never two identically named links.
7. **Help (Rule 17):** claims were written from the screens; one troubleshooting bullet speaks of a commission page that "no longer opens" because a missing record is the platform's 404 page, not a string. "planned" avoided (H8).

### B6 rulings (orchestrator, applied after the first B6 commit)

1. Accepted: the C5 and C7 helpers worded with "commission" (`COMMISSION_MEMBER`).
2. Accepted: "{name} (no longer a member of this presbytery)" (`COMMISSIONS.leftOption`).
3. Added: an empty-roster state for an ACTIVE commission with no one serving or starting later: "No one serves on this commission yet." (`COMMISSIONS.emptyRoster`), in the same guided box and place as the committee page's, above its "Add a member" button. An ended commission with no members shows nothing extra. Pinned in `ui-copy.test.ts` and `commissions/pages.test.tsx`. The help page does not quote it, so no registry label was added.

**Handoff to B7.** Selectors: fields by label ("Title", "Charge (optional)", "Congregation (optional)", "Appointed on", "Minute reference (optional)", "Ended on", "Minute reference for its report (optional)"); buttons "Record commission", "Add to commission", "End commission" (the trigger and the dialog's confirm share the name: scope to the `alertdialog`), "Remove this record" / "Remove record"; member controls "End term for {name}" (a card and a table row: scope by viewport). Both pages of a commission render the member roster twice (card and table, CSS shows one).

## B7 — full-stack-developer (2026-11-19)

Scope as the batch table: the fixture additions, the commissions spec, the hydration spec for both lanes, the regression of the Increment 1 specs, and the founding-administrator walk for the commissions half. **No source file under `src/`, no migration and no Rule 16 shared file was touched, and no defect was found in B5 or B6's code** (every failure while writing was the spec's or fixture's own; below).

### Files Created

- `e2e/committees-commissions.spec.ts` (16 tests, serial, tag `k`). Founder (minted by `presby_apply_founding_administrator`, MFA enrolled, bundle only) throughout tests 1 to 7, which **are the founding-administrator walk for the commissions half**, scripted at 360px: (1) the section and its guided empty state; (2) record: title required, an appointment after today refused under the field with nothing written, a save lands on the commission page with charge, About line, "Minute:", the no-access sentence (byte for byte, with and without a congregation), the list never shows the charge; (3) edit: carried values, a save, audit `changed` is the field names `charge` and `title`, a **stale** form is the C15 toast and writes nothing; (4) members: the person-required refusal, add Chair, a planned start, a dated term and a second planned start, "(already serves)" is a disabled option, end a term (a date before the start refused in the dialog, Go back writes nothing), cancel a planned term (zero-length), change an end date, no native dialog, three `member_ended` rows; (5) end the commission: a future date and a date before the appointment refused in the dialog, Go back writes nothing, a valid end with a minute ends only the members still running (`membersEnded` 2: the one serving and the one not yet started; the two already over untouched), "Reported in:", no End, Add or End-term control, Edit and Remove stay, the add-member URL says "This commission has ended, so no one can be added." with no form, "Show ended commissions (1)"; (6) remove: Go back writes nothing, a removal lists nothing, the page and an `/edit` answer 404, one audit row; (7) the **neutral congregation refusal**: four forged ids (another presbytery's congregation, a non-congregation, a nonexistent id, a malformed one) each give the one sentence under the field and write nothing, and no name of the other presbytery or its congregation appears. (8) the clerk (`groups.manage` only, no second factor) records one with no `/totp` and the audit names the clerk. (9) the **keyless member**: the C1 sentence on all five commission pages, nothing leaks, nothing written. (10) the **congregation's own administrator** gets the org denial at the presbytery's list and the record, and nothing of the record on the congregation's own paths or portal. (11) **not-found**: twelve misses (malformed, another presbytery's, another presbytery's committee, a real committee, a choir, a congregation's id, a removed and a nonexistent record, and the deeper `/edit` and `/members/new` pages) all 404 with one identical body that names none of them; a commission id typed into the committee page is 404. (12) **flag off**: every commission page says it isn't turned on and shows nothing of the records. (13) **audit**: all six `tenant.commission_record.*` keys present; every metadata key is in the allowlist; no title, charge, minute, end-minute sentinel, congregation or person name in any row; the `tenant.committee.*` stream carries nothing about commissions. (14) **nothing downward**: `administrative_commissions`, `org_delegations` and `role_grants` counts across the fixture equal the baseline taken before the first write, and neither member table has a `role_id`, `group_id` or `public_listed` column. (15) **360px**: a 200-character title, 498-character charge, 198-character minute and 120-character person name on the list, the commission page, edit, add and record forms: no sideways scroll, every control 44px (`smallControls`, which skips Radix's aria-hidden switch input since 98729e07; kept), no `callbackUrl` or `next` link, a "Back to committees" link, role and dates visible; the three dialogs (End term, End commission, Remove this record) open inside the viewport with every button 44px (layout sizes). (16) **1280px**: the commissions list is a table (Title, Congregation, Appointed, Status, Serving) and the roster is a table, no sideways scroll.
- `e2e/hydration/commissions-forms.spec.ts` (3 tests): scripts held, every control in the gate disabled, release, non-default values, the **persisted row** asserted. The record form, the **edit** form (the same `useForm` root in edit mode, carried values kept) and the add-member form. The end-commission and remove dialogs are plain controlled dialogs with no form root and cannot open before hydration, so there is nothing to hold; the spec header says so.

### Files Modified

- `e2e/support/committees-fixture.ts` (this pipeline's own file): `congOther` (a congregation of the second presbytery, in setup, teardown and `orgIds`: the "another presbytery's congregation" case); `seedCommission`, `seedCommissionMember`, `commissionsByTitle`, `commissionById`, `commissionMembers`, `commissionAudit`, `downwardCounts`; and **`removeCommissionRecords`**, called by the teardown and the sweep. `commission_records.about_org_id` is a plain FK with no cascade (organizations are permanent), so a record about a fixture congregation blocked its owner delete on the first full run (`commission_records_about_org_id_fkey`); the fixture now deletes the fixture councils' records, members first, before their councils. The `smallControls` aria-hidden skip (98729e07) is untouched.
- `e2e/committees-roster.spec.ts`: test 1 asserted the tile description of Increment 1; B6 changed it (C11 II) to "The presbytery's committees, who serves on them, and the administrative commissions it has recorded." The assertion now reads the shipped sentence. That was the only Increment 1 spec the commission work invalidated.

### Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`) | clean |
| `npm run check` (new files staged so `check:secrets` sees them) | exit 0, all ten tripwires |
| New specs, own dev server on **3101** (`E2E_BASE_URL=http://localhost:3101`, `E2E_ALLOW_SHARED_DB=true`, CRON_SECRET, RATE_LIMIT_DISABLED, the domains fakes) | `committees-commissions` **16/16** (2.2 min), `hydration/commissions-forms` **3/3** |
| Regression, same server: `committees-roster` **16/16** (after the one assertion above), `committees-gates` **5/5**, `hydration/committees-forms` **3/3** | **24 passed**. Both were also green together with the new specs in one 43-test run (27 passed plus the roster failure above, which then fixed to 16/16) |
| Production hydration lane (`PW_PROD_BUILD=1 PW_PROD_PORT=3801`, `--project=prod-build`, no `E2E_BASE_URL`; Playwright built and served and stopped it; the dev server was stopped first because both use `.next`) | `commissions-forms` **3/3** and `committees-forms` **3/3**: **6 passed** (1.4 min) |
| **Failing-first** | two source sabotages, both restored from a copy (`cmp`-identical; sha-256 `618ca415...` for the form file; `git status` shows no `src/` change): (a) `<HydrationGate>` removed from `commission-member-form.tsx`: the hydration add-member test failed on `aria-busy` (`element(s) not found`); (b) the no-access sentence not rendered on the commission page: spec test 2 failed at `getByText(NO_ACCESS_ALDER)` and test 3 onward did not run. Both green again after the restore |
| Fixture hygiene | after every run: 0 `e2e-cmt%` organizations, 0 fixture users, 0 fixture people; `org_portal.committees` true (as before) |
| Servers | the dev server was PIDs 2049 (wrapper) and 2070 (listener), stopped by PID; the production server was Playwright's and is gone; nothing touched :3000; nothing listens on 3101 or 3801 |

### Implementer Notes

1. **Deviation from a spec line: "members (add/plan/end)" are all driven through the page** (four adds, three ends), none seeded, except the long-text case of test 15, which seeds its record and members as the owner because it is about layout.
2. **The fixture's first full run exposed the FK-without-cascade teardown problem** (above), which is a fixture fix and no product concern: a record about a congregation never needs deleting.
3. **Not covered here, by design:** the closing-congregation acceptance, the interval overlap and the add-versus-end race are B5's DB tests (deterministic there, not in a browser); dark mode and the real invitation walk are Phase 6's, as in Increment 1.
4. **Strings added: none.**

**Handoff.** Next agent: **qa** (Phase 5).

## Phase 4 completion summary (Increment 2)

| Batch | Implementer | Commit | Delivered |
|---|---|---|---|
| B5 | api-developer | (B5 commits) | commission contract, validate, copy, derive; `store.ts` and `reads.ts` commission functions; six audit keys; the six actions; boundaries and audit-coverage extensions; DB cases (store 88, reads 34); B5 rulings 1 to 3 |
| B6 | ux-developer | `32ae877b`, `c9536ac6` | the commissions section, record, commission, edit and member pages, the four forms and dialogs, the tile description, the help rewrite and the roles and privacy edits, 360px browser walk; B6 rulings 1 to 3 |
| B7 | full-stack-developer | (this commit) | the fixture additions, `committees-commissions` (16), `hydration/commissions-forms` (3), the one regression assertion, both hydration lanes, the commissions walk |

**What exists and is tested:** commission records end to end: the pages, forms, dialogs, the server layer, the six audit keys, the help, 16 + 3 new e2e tests and 24 regression e2e tests, and the production hydration lane. No schema change in this increment (0090 is untouched).

**Gates at the end of Phase 4:** `npx tsc --noEmit`, `npm run lint` and `npm run check` clean; `npm run build` passes (B6, and the production lane's build in B7); unit tests: full suite 941 files, 0 failed (B6); DB suites: `store.db` 88 and `reads.db` 34 and the four Increment 1 files green on the pipeline branch (B5); `test-rls-90.sql` unchanged (no DDL); e2e as the B7 gate table.

**What QA should run** (own server on port 3101, `E2E_BASE_URL=http://localhost:3101 E2E_ALLOW_SHARED_DB=true CRON_SECRET=giving-e2e-cron-secret RATE_LIMIT_DISABLED=true DOMAINS_ALLOW_RESERVED_TLDS=1 DOMAINS_PROVIDER=fake DOMAINS_DNS_PROVIDER=fake DOMAINS_FAKE_STATE_FILE=.tmp/domains-fake-state.json`; stop by PID; never :3000):
1. `npx tsc --noEmit`, `npm run lint`, `npm run check`, `npm run build`.
2. `npx vitest run` (no DB credentials), then the six committees DB files serially against the pipeline branch (`npx dotenv -e .env.local -- vitest run --no-file-parallelism` over `committees.db`, `committees.schema`, `store.db`, `reads.db`, `seat-semantics.db`, `groups.committees.db`); `scripts/committees/test-rls-90.sql` as `presby_app`.
3. `npx playwright test e2e/committees-commissions.spec.ts e2e/committees-roster.spec.ts e2e/committees-gates.spec.ts e2e/hydration/commissions-forms.spec.ts e2e/hydration/committees-forms.spec.ts --project=chromium` (43 tests).
4. Production hydration lane, with the dev server stopped (both use `.next`) and no `E2E_BASE_URL`: `PW_PROD_BUILD=1 PW_PROD_PORT=3801 npx playwright test e2e/hydration/commissions-forms.spec.ts e2e/hydration/committees-forms.spec.ts --project=prod-build` (6 tests).
5. The copy-truthfulness check on the help diff (`presbytery-committees.md`, `roles-who-can-do-what.md`, the privacy clause) and the C15 strings against the screens; a 360px look at the commission page, light and dark (the specs run light only).
6. Failing-first is recorded above for the new specs; confirm the `tenant.commission_record.*` rows and the hard-rule test (14) by reading, not by re-sabotaging.

**Open for the orchestrator at integration (not done here; Rule 16):** the Increment 2 TODO reconciliation (line 507 to Done, the `groups.manage` description follow-up of T12), the functionality-map line (Rule 14), the C16 release-note lines through `/release-notes`, `verifiedIn` on the help page at the release walk, and the 0.64.0 `package.json` bump after Phase 6 SHIP IT. No shared file was edited in this batch.

---

# Phase 5 — Verification (qa)

Pending.

---

# Phase 6 — Shipped vs Intent (analyst)

Pending.
