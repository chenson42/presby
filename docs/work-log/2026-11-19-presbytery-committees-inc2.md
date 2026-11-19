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
| 5 — Verification | qa | Complete (run 1; copy rulings recorded below) | PASS | 2026-11-19 |
| 6 — Shipped vs intent | analyst | Complete (Increment 2; closes the parent) | SHIP WITH NOTES | 2026-11-19 |

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

<!-- leak-ok: the e2e fixture cron value, a throwaway constant in e2e/giving, not a credential -->
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
**Verdict: PASS.** Every check you asked for ran green on the pipeline branch. Six findings are below; none is a defect in what ships. Two need a ruling (copy and the Phase 4 help record), one is a suggested hardening of the boundary test, and three are notes.

# Phase 5 — Verification (qa)

**Date:** 2026-11-19
**Verified by:** qa

**Where I worked.** Worktree `/Users/cshenso/git/presby-platform/presby-committees`, branch `pipeline/presbytery-committees-inc2` at `09060feb`. The Increment 2 diff is `98729e07..09060feb`: 55 files, no migration, nothing under `src/auth.ts`, `src/proxy.ts`, a layout, `e2e/support/` outside this pipeline's own fixture, `playwright.config.ts` or a shared component. So the auth gate does not apply.

**Database.** The pipeline Neon branch, endpoint `ep-odd-hall-ax6wtzf0`. I checked connections by role name only and printed no value: `DATABASE_URL` is `presby_app` (`rolbypassrls = f`) and `PLATFORM_DATABASE_URL` is `neondb_owner`. I never touched production or :3000. Disk was 42% used.

**Flag state.** Before the e2e run I reset global flags to the CI baseline with `scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1`. It set 38 seeded flags. Flags on afterwards: `auth.local_login`, `auth.require_2fa`, `org_portal.committees`, `org_portal.communications`, `org_portal.home_v2`, `org_portal.reports`, `platform.merged_home`, `sites.public_render`, `ui.brand_theming`. Same set after all runs.

**Scope run.**
- **In full:** typecheck, lint, `npm run check`, `npm run build`, and the whole unit suite.
- **DB:** the six committees files, serially.
- **RLS:** `test-rls-90.sql` as `presby_app`.
- **e2e:** the 43 tests the Phase 4 QA list names (dev lane), and the 6-test production hydration lane.
- **Not re-run:** the whole DB-backed set and the full e2e suite. The diff touches no migration, `authz.ts`, `src/lib/db/`, shared fixture, proxy, auth, layout or shared component. CI covers the rest.

## Type Check

`npx tsc --noEmit`: **PASS**. `npm run lint` (`--max-warnings=0`): **PASS**. `npm run check`: **PASS**, exit 0, all ten tripwires (Help check: 34 entries, 31 published, 31 content files, 7 images). `npm run build`: **PASS**; the four commission routes are in the route table.

## Unit Tests

- **Full suite, no DB credentials** (`npx vitest run`): 941 files passed, 165 skipped. 15,575 tests passed, 4,488 skipped, 0 failed (43.7 s).
  - The skips are DB-backed files only. In the committees-related set, the only skips are `store.db` (88), `reads.db` (34) and `seat-semantics.db` (5), which all ran in the DB pass below, plus the unrelated `help-contact/inbox.db` (5).
- **Committees DB suites, serial** (`npx dotenv -e .env.local -- vitest run --no-file-parallelism` over `committees.db`, `committees.schema`, `store.db`, `reads.db`, `seat-semantics.db`, `groups.committees.db`): 6 of 6 files, **206 of 206 tests passed** (523.7 s). That matches B5's 204 plus the 2 tests added by the rulings.
  - After the run, the triggers those tests switch off and on in teardown (`memberships_guard_end`, `group_memberships_reject_derived`), and `commission_record_members_live_guard` (switched off in B5's own failing-first run), are all `tgenabled = 'O'`.
  - 0 `e2e-cmt%` organizations are left.
- **`scripts/committees/test-rls-90.sql` as `presby_app`:** exit 0, **120 passes**, sections (a) to (j).

Failures: none.

## End-to-End Tests

**Dev lane, own server on :3101**, started with the env in the brief (`CRON_SECRET`, `RATE_LIMIT_DISABLED`, the domains fakes, `E2E_BASE_URL=http://localhost:3101`, `E2E_ALLOW_SHARED_DB=true`) and stopped by PID.

- **Run 1: discarded, an environment fault.** The `beforeAll` of `committees-commissions.spec.ts:103` timed out after 420 s at sign-in.
  - The dev log shows `/signin` re-requested in a loop, each request followed by "Compiled in 1ms". That is the HMR-hash reload loop `playwright.config.ts` warns about when `next dev` restarts over a warm `.next/dev`; my `npm run build` had just run.
  - 1 failed (the hook), 42 did not run. I interrupted Playwright with SIGINT so its teardown ran: 0 fixture organizations left, `org_portal.committees` restored.
- **Fix before run 2:** I removed `.next/dev`, a gitignored cache (`git check-ignore` confirmed), as the config does for its own lanes, and restarted the server.
- **Run 2: Total 43 | Passed 43 | Failed 0 | Skipped 0 | 5.5 min.**
  - `committees-commissions` 16, `committees-roster` 16, `committees-gates` 5, `hydration/commissions-forms` 3, `hydration/committees-forms` 3.
- **Production hydration lane** (`PW_PROD_BUILD=1 PW_PROD_PORT=3801`, `--project=prod-build`, `E2E_BASE_URL` unset, dev server stopped first): **Total 6 | Passed 6 | Failed 0 | 1.0 min.** Playwright built, served and stopped it.
- **Afterwards:** nothing listening on 3101 or 3801, `git status` clean, 0 fixture organizations.

## Regression Tests Added

I confirmed these by reading the tests and the Phase 4 failing-first record, as the QA list asked. I re-sabotaged nothing; I am read-only.

| Mechanism | Test | Failing-first |
|---|---|---|
| Audit is written in the mutation's own transaction | `store.db.test.ts` "injected audit failure" block, with a non-vacuity control at `:1674` | B5: red with `audit()` made best-effort |
| Interval overlap | `store.db.test.ts:1419`, dated terms | B5: red with `seatsOverlap` disabled |
| Live-parent guard (an add racing the end) | `store.db.test.ts:1752`, deterministic, uncommitted end held | B5: red with the trigger disabled; I confirmed it is enabled again |
| One neutral congregation refusal | `store.db.test.ts:1245` (six misses), `:1285` (the 0045 trigger path); e2e test 7 (four forged ids, one sentence, nothing written) | B5: resolver break went red |
| `HydrationGate` on the member form | `hydration/commissions-forms.spec.ts` | B7: red with the gate removed |
| The no-access sentence is shown | e2e test 2; `copy.test.ts:83-86` byte for byte | B7: red with the sentence not rendered |
| Rulings 1 to 3 (not-found wording, appointment after end, appointment after today) | `copy`, `validate`, `action-gate` and action tests; `store.db` | B5 rulings: 7 unit and 5 DB tests red first |
| Stale edit | `store.db.test.ts:1300`, `:1721` (two simultaneous edits) | Not separately sabotaged. Both tests assert `stale` directly, so removing the `rowVersion` compare fails them |
| Key and organization-type gate in the store | `store.db.test.ts:1154` (a member with no key; a congregation's clerk) | Not separately sabotaged. Every write asserts `forbidden` |
| Hard rule: nothing written downward | e2e test 14 (fixture-scoped counts of `administrative_commissions`, `org_delegations`, `role_grants` unchanged across all six actions driven through the UI); `store.db` snapshots for `recordCommission` and `addCommissionMember`; `boundaries.test.ts:459` (name scan) and `:443` (commission functions reach no groups primitive), each with failing samples | — |

**Not covered by a failing-first app test, by design:** removing the app's `commission_ended` check in `addCommissionMember`. The database live guard would refuse the same add with the same answer, so the property holds without it (defence in depth).

## Coverage on Critical Modules

- `permissions.ts`, `two-factor.ts`, `flags.ts`: not touched by this diff; not re-measured.
- `src/lib/committees` pure modules: `validate.ts` 100%, `derive.ts` 100%, `copy.ts` 96.8%, `ui-copy.ts` 97.2% statements (99.2% overall). `contract.ts` reports no executable statements.

## Feature-Gate Audit

No route handler is touched. Gates were read in the action bodies, `action-gate.ts`, `store.ts` and `reads.ts`, not inferred from green tests.

- **Pages, order:** session (`assertOrgSession` with the Node-side second-factor recheck), the four-way org resolution, then flag, then organization type (`gateCommitteesPage`, `gate.ts:108-151`), then `groups.manage` inside the reader's own transaction (`readUnder` calls `mayManage`, `reads.ts:249-257`, `:160-168`).
- **Actions, order:** session, org resolution, flag (`action-gate.ts`), `isUuid` on every id, parse, then the store's `gate()` (`store.ts:242-248`) inside the write's own transaction. `gate()` checks `groups.manage` first and the presbytery type second.
  - Both answer `forbidden` with one string, so the order is not observable from outside. It is the store's documented "cheapest, least informative first".
  - Every one of the six commission store functions calls `gate()` first (`store.ts:968, 1014, 1075, 1129, 1183, 1242`); `boundaries.test.ts:434` pins it.

| Route or action | auth() / session check | Permission check | Key |
|---|---|---|---|
| page `/o/[slug]/admin/committees` (commissions section) | yes, `gateCommitteesPage` (flag, type) | `readCommissionList` → `mayManage` | `groups.manage` |
| page `/commissions/new` | yes, `gateCommitteesPage` | `readCommissionFormOptions` → `mayManage` | `groups.manage` |
| page `/commissions/[commissionId]` | yes; `isUuid` before any read | `readCommission` → `mayManage` | `groups.manage` |
| page `/commissions/[commissionId]/edit` | yes; `isUuid` | `readCommission` and `readCommissionFormOptions` | `groups.manage` |
| page `/commissions/[commissionId]/members/new` | yes; `isUuid` | `readCommissionMemberFormOptions` | `groups.manage` |
| `recordCommissionAction` | yes, `resolveCommitteesActor` (flag) | `store.gate` | `groups.manage`, presbytery |
| `updateCommissionAction` | yes; `isUuid(commissionId)` | `store.gate` | `groups.manage`, presbytery |
| `addCommissionMemberAction` | yes; `isUuid` | `store.gate` | `groups.manage`, presbytery |
| `endCommissionMemberAction` | yes; `isUuid` ×2 | `store.gate` | `groups.manage`, presbytery |
| `endCommissionAction` | yes; `isUuid` | `store.gate` | `groups.manage`, presbytery |
| `removeCommissionRecordAction` | yes; `isUuid` | `store.gate` | `groups.manage`, presbytery |

`FEATURES.*` does not apply: this is the tenant axis, checked through `presby_has_permission` via `holdsPermissions`.

**Behavioural confirmation (e2e run 2):**
- The clerk (`groups.manage` only) records with no `/totp` (test 8).
- A keyless member gets the C1 sentence on all five pages and nothing is written (test 9).
- With the flag off, every page shows the flag-off state (test 12).
- Twelve misses answer one identical 404 (test 11).

## Schema/RLS Audit (live catalog, no DDL in this increment)

Probed on `presby_app` against the seed's records (three at the Northern Reach: one active about Alder Creek, one ended about none, one removed).

- **Congregation context** (`app.current_org_id` = Alder Creek, the congregation a record is about): `commission_records` 0 rows, `commission_record_members` 0 rows. `UPDATE commission_records … where about_org_id = Alder Creek` gives `UPDATE 0`; `UPDATE commission_record_members` gives `UPDATE 0`.
- **Control:** the presbytery's context reads 3. No context reads 0.
- **Refusing layer:** the RLS policy, not a grant or a trigger. Both tables are `relrowsecurity` and `relforcerowsecurity`, with one `tenant_isolation` `ALL` policy whose `USING` and `WITH CHECK` are both `organization_id = presby_current_org()`.
- **Grants (`aclexplode`):** `presby_app` holds SELECT and INSERT only on both commission tables; `presby_platform` holds nothing.
- **Triggers:** the four commission triggers are present and `O`.

**The hard rule:**
- Nothing in `src/lib/committees`, `src/components/committees` or the `admin/committees` route tree names `administrative_commissions`, `org_delegations`, `role_grants`, `roleGrants`, `roleId` or `role_id` outside two comments (`copy.ts:176`, `store.ts:96`).
- No owner connection appears there.
- The commission tables are named only in `store.ts`, `reads.ts`, `db/domain/committees.ts` and `dev-docs.ts`.
- `test-rls-90` (a) asserts no `role_id`, `group_id` or `public_listed` column, and (i) asserts the resolver cannot see a commission member.
- e2e test 14 shows the downward counts unchanged across the full flow.
- **A congregation cannot read a record about it:** proven at the database (above, and `test-rls-90` (d)) and in the browser (e2e test 10: the congregation's administrator gets the organization denial naming the presbytery, and the record's title appears nowhere on the congregation's paths).

**Neutral congregation refusal:**
- One sentence: "That congregation could not be found among {presbytery}'s member congregations."
- It covers another presbytery's congregation, a non-congregation child, a departed congregation, the presbytery itself, a nonexistent id, a malformed id (`store.db:1245`) and the 0045 trigger path (`:1285`).
- In the browser, four forged ids give one identical message, nothing is written, and neither name of the other presbytery appears (e2e test 7).

## Copy Truthfulness

- [x] **Every added or changed string is in the design's Copy table**, except the items below. All are truthful; they are recorded for a ruling, not as defects.
  1. **Charge helper differs from C15 by one word.** C15 says "…Don't record confidential details **here**. Anyone who can…". The build ships it without "here": `src/lib/committees/ui-copy.ts:179`, pinned to the shipped text at `ui-copy.test.ts:101` and `commission-forms.test.tsx:98`. No ruling covers it; B6 did not flag it. Either rule the shipped text in, or restore "here" (both pins change with it).
  2. **Help prose beyond the C15 draft.** C15 authorised a field-by-field sentence. These additions go further and none is ruled:
     - in the section: "'Appointed on' cannot be after today." (rests on ruling 3); the Community and "Add person" route; "and each commission's page says so"; "On a member's row, choose 'End term'…"; "Choose 'Edit commission'… A commission that has finished can still be corrected this way."; and the "Ended on" walk-through;
     - the intro sentence "It also keeps the presbytery's record of its administrative commissions.";
     - the troubleshooting bullet "A commission's page that no longer opens…" (B6 note 7; not covered by B6 rulings 1 to 3).

     Each was checked against the build (next item).
  3. **C13 II reworded.**
     - Privacy: C13 says "…and, for a presbytery, its own notes about administrative commissions, which are never published". The build says "A presbytery also keeps its own notes about administrative commissions, which are never published" (`privacy-policy.md:35`).
     - Roles: the bullet `roles-who-can-do-what.md:56` gained "and its record of administrative commissions" (C13 II named only the paragraph at `:75`).

     Both mean the same as C13 II. "Never published" holds: no public function or `(public)` route reads the commission tables.
- [x] **The query behind each claim was opened.**
  - "About {congregation}" and "(no longer a member…)": `readCommission` compares `organizations.parent_id` with the presbytery. It does not read the affiliation history; that is the design's own definition.
  - "{n} serving": the half-open rule on the organization's local day (`reads.ts`). It is shown only on active records.
  - "gives no one access" / "does not see it": the absent grant columns, plus the organization-only policy probed above.
  - "does not record who has read it": there is no read audit; true.
  - "never copied into the audit trail": e2e test 13 and the `store.db` sentinel test.
- [x] **Each instruction is doable by the role that sees it.** Every commission page and action requires `groups.manage` at a presbytery; the help's Needs block names that key.
  - The help's "use 'Add person' under 'Community'" depends on the Community toggle and `people.manage`. That was already ruled and stated in Increment 1, and the add-member empty state (`COMMISSION_MEMBER.emptyBody`) says how to turn it on.
- [x] **Older strings grepped; none is made false.**
  - The Increment 1 sentence "This page keeps committees. It does not keep administrative commissions…" is replaced.
  - `v0.63.md:42` ("Not yet: administrative commissions") is release history, as C16 expected.
  - `why-cant-i-see-this.md:43` and `dev-docs.ts` remain true.
- [x] **Help diff covered, by walking it.** My own server, 360px, light and dark, as `committees.clerk@example.invalid` (`groups.manage` only), on the dev seed: the list, `?show=ended`, the active and ended commission pages, edit, add member, add member on the ended record, record form, and the End commission, Remove and End term dialogs.
  - All 13 new registry `labels`, plus "Add a member", "End term" and "Hide ended commissions", are on screen.
  - No help images changed (0 files under `src/content/help/images/`).
  - **Process gap:** the Phase 4 record has no per-claim "page, fact, how verified" table (B6 says only that claims were written from the screens). I traced every claim myself, above. This needs a ruling on whether my walk stands in for it.

`copy truthfulness: PASS`. The items above are for a ruling.

## 360px

- No page scrolls sideways at 360px (`scrollWidth == clientWidth`), light or dark.
- Every control in `<main>` is 44px or taller, except the platform shell's "Back to portal" link, which is not this feature's.
- The End commission and Remove dialogs fit the viewport with 44px inputs and buttons once the open animation has settled. An early reading of 42px was the dialog's 95% zoom-in scale caught mid-animation; I re-measured by `offsetHeight`.
- Dark mode: badges, the no-access panel, the destructive "Remove this record" and the roster cards are all legible (screenshots read).
- The long-text cases (200-character title, 498-character charge, 198-character minute, 120-character person name) pass in e2e test 15.

## Findings

1. **Copy, needs a ruling:** the charge-helper wording (Copy item 1 above).
2. **Copy, needs a ruling:** the unruled help prose, the troubleshooting bullet and the C13 rewording (Copy items 2 and 3), and whether my walk stands in for the missing Phase 4 "page, fact, how verified" record.
3. **Suggested follow-up for tech-lead, not blocking: a stronger boundary test.** The hard-rule scan (`boundaries.test.ts:459`) matches names. A future `import { grantRole } from "@/lib/role-grants"` in `store.ts` would pass it.
   - Today the surface imports only `readGroupRoleGrantsInTx` from that file (`store.ts:27`, `reads.ts:7`).
   - e2e test 14 is the behavioural backstop across all six actions.
   - The fix: an import allowlist for `@/lib/role-grants` and any delegation module in the surface. That would turn the name list into the property.
4. **Accessibility, minor.** On the commission page the screen-reader-only `<dt>` "Appointed" (`[commissionId]/page.tsx:89`) sits before a `<dd>` that also starts "Appointed" (`:91`), so a screen reader hears "Appointed Appointed 9/14/2026". The "Congregation" `<dt>` before "About …" reads fine. Suggest a different `<dt>` word, or dropping the prefix inside the `<dd>`. A ruling is needed only if the word changes.
5. **Order, no action.** Actions check the key before the organization type; pages check flag, then type, then key. Both refusals are the same `forbidden` string, so the difference cannot be seen from outside.
6. **Environment, no action.** The first e2e run was lost to the dev-server reload loop after `npm run build`. I cleared the gitignored `.next/dev` and the rerun was clean (both runs reported above).

## Verdict

**PASS**

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete (tsc, lint, check 10/10, build; unit 15,575/0 failed; committees DB 206/206; test-rls-90 120; e2e 43/43 dev lane (run 1 lost to a reload-loop environment fault, rerun clean) + 6/6 prod hydration; gate, live-catalog and hard-rule audits; 360px light and dark; flags reset to the CI baseline; copy rulings open for tech-lead and orchestrator) | PASS | 2026-11-19 |

## Handoff

Next agent: **analyst (Phase 6).** Before or alongside it:
- **tech-lead or orchestrator** rules on findings 1 and 2, and decides whether to open a line for finding 3 (TODO) and finding 4 (one word).

Phase 6 should:
- read `/help/presbytery-committees` "Administrative commissions" and its troubleshooting bullet as its reader, plus the two edited lines in `roles-who-can-do-what.md` and `privacy-policy.md`;
- walk as the invitation-path founding administrator (not the clerk I walked as).

My walk's screenshots are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/2313dcc4-4a86-43c8-9bfc-694f433ec0be/scratchpad/walk/`.

Files read for the findings:
- `/Users/cshenso/git/presby-platform/presby-committees/src/lib/committees/ui-copy.ts`
- `/Users/cshenso/git/presby-platform/presby-committees/src/lib/committees/store.ts`
- `/Users/cshenso/git/presby-platform/presby-committees/src/lib/committees/reads.ts`
- `/Users/cshenso/git/presby-platform/presby-committees/src/lib/committees/action-gate.ts`
- `/Users/cshenso/git/presby-platform/presby-committees/src/lib/committees/boundaries.test.ts`
- `/Users/cshenso/git/presby-platform/presby-committees/src/app/(org)/o/[slug]/admin/committees/commissions/[commissionId]/page.tsx`
- `/Users/cshenso/git/presby-platform/presby-committees/src/content/help/presbytery-committees.md`
- `/Users/cshenso/git/presby-platform/presby-committees/src/content/help/privacy-policy.md`
- `/Users/cshenso/git/presby-platform/presby-committees/src/content/help/roles-who-can-do-what.md`
- `/Users/cshenso/git/presby-platform/presby-committees/scripts/committees/test-rls-90.sql`
- `/Users/cshenso/git/presby-platform/presby-committees/e2e/committees-commissions.spec.ts`

---

## Orchestrator rulings after QA run 1 (2026-11-19)

- **Finding 1:** the shipped charge helper is ruled in as it stands, without "here". C15 is amended to the shipped text.
- **Finding 2:** the help prose beyond the C15 draft, the troubleshooting bullet and the C13 rewordings are accepted. QA traced every claim against the build and walked the page at 360px in light and dark, and that walk stands in for the missing Phase 4 "page, fact, how verified" table. Phase 6 reads the same sections as their reader.
- **Finding 3:** filed as a TODO line, not fixed here. The import allowlist for `@/lib/role-grants` and any delegation module in the committees surface is still to do; e2e test 14 is the behavioural backstop today.
- **Finding 4:** filed as a TODO polish line. The repeated "Appointed" heard by a screen reader on the commission page is still open.
- **Findings 5 and 6:** no action.

---

# Phase 6 — Shipped vs Intent (analyst)

*Date: 2026-11-19. Tree: `/Users/cshenso/git/presby-platform/presby-committees`, branch `pipeline/presbytery-committees-inc2`, HEAD `f07af4bd`. I wrote no files to the repository, and `git status` is clean.*

**Environment**
- My own dev server ran on port 3102 with the env you gave. I stopped it by PID (listener 15568, wrapper 15551). Nothing listens on 3102, and I cleared `.next/dev`.
- It ran against the pipeline Neon branch (endpoint `ep-odd-hall-ax6wtzf0`). I never touched production or :3000.
- I flipped no flags. `org_portal.committees` was on and still is. `org_portal.groups`, `org_portal.oversight` and `sites.public_committee_directory` were off and still are.
- I made a throwaway presbytery with `setupCommitteesFixture`. The founding administrator was minted by the real definer `presby_apply_founding_administrator`, enrolled in two-factor sign-in, and signed in by password plus the real `/totp` challenge. She held only the minted bundle (`founding_administrator` and `presbytery_stated_clerk`).
- I removed the fixture afterwards. 0 `e2e-cmt` organizations, users or people remain.
- I drove everything with headless Chromium at 360px. My scripts and screenshots are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/2313dcc4-4a86-43c8-9bfc-694f433ec0be/scratchpad/p6c2/` (screenshots in `shots/`).
- I did not click through a real invitation email. This is the same basis as Increment 1: the definer is the single point both the invitation and designation paths write.

## VERDICT: SHIP WITH NOTES

Commission records deliver what Phase 1 promised and what operator decision B asked for. Every flow I walked matches its Phase 1 verb and its C15 string. The help section, its troubleshooting bullet and the two edited lines contradict nothing I saw on screen.

The notes are one real usability gap, one dark-mode contrast problem and some polish and housekeeping. None blocks 0.64.0, and each becomes a TODO line.

## ONE-LINE TAKE

> A presbytery's founding administrator can now keep a record of each administrative commission (title, charge in general terms, optional congregation, appointed date, minute, members and titles), end it, correct it or remove a mistaken one. The congregation sees nothing, no one is granted anything, and the audit trail carries ids and field names only.

## Walks

**Founding administrator (the person the definer creates), 360px.** Every page and state below had `scrollWidth == clientWidth`.

- **Tile.** The tile reads "The presbytery's committees, who serves on them, and the administrative commissions it has recorded." It opens the list.
- **Empty commissions section.**
  - The heading and the intro sentence are present: "A record gives no one access to a congregation's PresbyPortal, and the congregation does not see it."
  - The empty state reads "No administrative commissions are recorded." with one "Record a commission" button.
  - The list opens with a sensible guided state for committees as well, so a brand-new presbytery is not a dead end.
- **Record form.**
  - An empty submit gives "Title is required." under the field.
  - An appointed date in the future gives "The appointed date can't be after today."
  - The congregation select offers "No congregation" first, then only this presbytery's two member congregations.
  - Recording one about a congregation (with charge and minute) lands on its page with the toast "Commission recorded."
- **Commission page.**
  - It shows the Active badge, "About {congregation}", appointed date and minute, the charge, and the no-access sentence byte for byte: "This record gives no one access to {congregation}'s PresbyPortal, and {congregation} does not see it."
  - The four actions follow: Edit commission, Add a member, End commission, Remove this record. The titles note sits after them.
  - A commission about no congregation reads "No congregation recorded" and "This record gives no one access to any congregation's PresbyPortal."
  - The empty active roster says "No one serves on this commission yet." with the "Add a member" button.
- **Members.**
  - The role picker offers the six titles.
  - Adding with nothing chosen gives "Choose a person."
  - I added a Chair, a Clerk and a planned Member (starting in a week). They sat under "Serving now" and "Starting later", and each person already seated showed as a disabled "(already serves)" option.
  - Ending the Clerk's term with a date before their start was refused inside the dialog ("The end date can't be before the start date."). A valid date moved them to "Past members" with their dates.
  - A person with an ended presbytery membership is not offered.
- **Edit.** Values were carried. A title change saved with "Commission saved." Editing the minute on an **ended** commission also saved. That is exactly what the help says: "A commission that has finished can still be corrected this way."
- **End commission.**
  - The dialog refused a future date ("The end date can't be in the future.") and a date before the appointment ("The end date can't be before Oct 20, 2026, when it was appointed."), both under the field.
  - A valid end with a "reported in" minute gave "Commission ended."
  - Every member's term ended that day. The planned member was ended "the day it started". The audit row says `membersEnded: 2`.
  - The page then showed "Ended 11/19/2026", "Reported in: …", no End or Add controls, and Edit and Remove still present.
  - The add-member URL on an ended record shows "This commission has ended, so no one can be added."
- **List.** The default list hid the ended one. "Show ended commissions (1)" revealed it, with "Hide ended commissions" to return.
- **Remove.**
  - "Go back" wrote nothing.
  - "Remove record" gave "Record removed." and returned to the list.
  - The removed id and its `/edit` page answer 404.
- **Neutral refusal.**
  - I forged four congregation ids into the select: another presbytery's congregation, the presbytery itself, a nonexistent id and a malformed id.
  - Each gave the identical sentence "That congregation could not be found among {presbytery}'s member congregations." under the field. None wrote a row, and no name from the other presbytery appeared.
- **Dark mode, 360px.** I checked the list, the ended list, the record form, the add form, an active commission, an ended commission, and the End, Remove and End-term dialogs. Layout, badges and the no-access panel are legible. See note 2 for one contrast problem.
- **Tap targets.** No control of this feature is under 44px on any page or dialog. The shell's "Back to portal" link is excluded, as in earlier increments.

**The congregation's side (an administrator holding `groups.manage` at the congregation the first commission was about).**
- The congregation's portal shows no Governance tile and no record.
- `/o/<congregation>/admin/committees`, and the same path with a commission id appended, say "Committees & Commissions isn't available for {congregation} — this isn't the kind of organization this tool is built for."
- The presbytery's list, a commission page about their own congregation, and `/new` all give the organization denial naming the presbytery.
- A text search of every page for the record's title, charge, minute and member names found nothing.
- The database agrees. `administrative_commissions` and `org_delegations` counts are 0 across the fixture, and the presbytery's role-grant count never changed.

**A keyless presbytery member.**
- The tile is visible, as at Inc 1 (accepted).
- The list, `/new`, an active commission, an ended commission, `/edit` and `/members/new` each show the single sentence "You don't have permission to manage committees at {presbytery}. If you think this is a mistake, ask your presbytery's administrator." They show no record, no form and no control.
- An unknown but well-formed id gets the same denial, so the key check runs before any existence check. A malformed id gets 404.

**A clerk holding only `groups.manage`.** The list, commissions section and commission page work as the founder's do. This confirms no new key was needed (ruling Q2).

**Audit.** The walk wrote exactly one row per action: recorded (twice), member_added (three times), member_ended, updated, ended and removed. Their metadata holds only ids, role, dates, `changed` field names, `membersEnded` and `aboutOrgId`. I searched them for the titles, charge, minute text and every member's first name, and found none. Reads wrote no row.

## Help pages, read as their reader at 360px

All three pages return 200 with no sideways scroll.

- **`presbytery-committees`, "Administrative commissions" section.**
  - Every quoted label is on screen: "Record a commission", "Title", "Charge (optional)", "Congregation (optional)", "No congregation", "Appointed on", "Minute reference (optional)", "Record commission", "Add a member", "Add person", "End term", "Edit commission", "End commission", "Ended on", "Show ended commissions", "Remove this record".
  - Every behavioural claim matched the walk:
    - "Appointed on" cannot be after today.
    - The charge limit of 500, and "does not record who has read it" (my page views wrote no audit row).
    - End commission ends every member on the date and keeps the record.
    - An ended commission leaves the list and "Show ended commissions" restores it.
    - Remove has no undo.
    - The audit does not copy the title, charge or minute.
  - The intro sentence "It also keeps the presbytery's record of its administrative commissions" is true. The old "does not keep commissions" sentence is gone, and I found no `limitationUntil`.
  - Readability: the section is four long paragraphs, and the third and fourth each pack three to five actions. It is correct but dense on a phone (note 4).
- **Troubleshooting bullet.** "A commission's page that no longer opens: the record was removed, or the address is not one of this presbytery's commissions." This is true, but the page the reader then sees says "We couldn't find that organization… Organization links look like /o/alder-creek". The bullet is not contradicted, but it points the reader at a message that talks about something else (note 1).
- **`roles-who-can-do-what`.** The bullet at line 56 ("At a presbytery this also covers its committees and its record of administrative commissions") and the founding-administrator sentence at line 75 are true. The founder and the `groups.manage`-only clerk both do everything the page says. The Roles screen's permission description still does not mention commissions. That is already ruled (T12), with its TODO line at `docs/TODO.md:151`.
- **`privacy-policy`.** "A presbytery also keeps its own notes about administrative commissions, which are never published" is true. A grep found no public function, `(public)` route or `/admin` file that reads the commission tables. Only `store.ts`, `reads.ts`, the domain schema, `audit.ts`, `contract.ts` and `dev-docs.ts` name them.
- **`verifiedIn`.** The page footer still reads "Last checked against release 0.63.0." I have now walked the page against the 0.64.0 build, so the release commit may set `verifiedIn: "0.64.0"` on `presbytery-committees`. I did not re-walk `roles-who-can-do-what` or `privacy-policy` in full. I read only the two edited lines against the build, so those pages' `verifiedIn` should move only if the orchestrator accepts that partial read.

## Per-gap check against Phase 1

- **Gap 2 (a record, not a grant)**
  - Nothing writes `administrative_commissions`, `org_delegations`, `role_grants` or a `role_id`. The tables have no such columns, and the counts were unchanged across the whole walk.
  - QA verified the boundary test and `test-rls-90.sql`, and I confirmed them in the browser and the database.
- **Gap 3 (what a commission is)**
  - The congregation is optional, and "Administrative commission" is used on every screen.
  - Matches.
- **Gap 4 (who sees it)**
  - The congregation sees nothing, as a deliberate v1 position.
  - Matches.
- **Gap 5 (the charge is sensitive)**
  - The helper says "Describe the charge in general terms. Don't record confidential details. Anyone who can manage committees at this presbytery can read it." The charge is capped at 500 characters.
  - It appears on no list, in no audit row and on no public path. The residual (every `groups.manage` holder reads it, and reads are unaudited) is stated in the form, the help and the release lines.
  - Matches.
- **Gap 11 (titles are not roles)**
  - The titles note sits on every commission page and in the add form.
  - Matches.
- **Flow 5 failure path**
  - The neutral congregation refusal, the stale-edit toast and a form that keeps its contents on failure are all designed.
  - I walked the refusal. The stale toast is covered by QA's e2e test 3, which I did not re-run.
- **Gap 7 (a commission's members must never be publicly listable)**
  - The members table has no `public_listed` column and no group row. There is no toggle on a commission roster and no public path reads it.
  - Matches.
- **Adversarial pass**
  - There is no `callbackUrl` or `next` on any page. Only static back links exist.
  - The key is checked before existence. Wrong-kind ids and removed ids give the same 404.
  - A forged congregation id is refused with one sentence.
  - Server-side validation held: future appointment, end before start, end in the future.
  - Self-targeting is not an issue, because titles grant nothing.
- **Operator decision B, commissions at go-live.** The operator's need is a record of who was appointed, about what, when, by what minute, and whether it has reported. All of it is walkable in production the day 0.64.0 deploys, with no migration.

## Notes (each a TODO follow-up)

1. **A missing commission shows an "organization" 404.**
   - A removed, unknown or other-presbytery commission id (a keyed member's removed record, or a bookmarked link) lands on the platform page "We couldn't find that organization… Organization links look like /o/alder-creek".
   - B6 note 7 chose this, and the help bullet describes it honestly. But a clerk who removed a record, then follows an old link, is told about organizations.
   - Suggested fix: a commission-specific not-found for the commission routes, using the existing string "That commission could not be found." plus a "Back to committees" link, **without** a status or timing change.
2. **Dark mode: "Remove this record" and field errors use the `--destructive` text colour at low contrast.**
   - I measured the "Remove this record" label from a screenshot: text (179,43,30) on a (32,45,63) button is about **2.2:1**, below WCAG AA's 4.5:1 for text. The light-mode contrast is 6.4:1.
   - The cause is the platform token (`--destructive: hsl(5 71% 41%)` is the same in light and dark in `globals.css`). So this is platform-wide, not specific to this increment. The Inc 1 "Dissolve committee" trigger and field errors on dark very likely share it.
   - QA recorded it as legible. I would call it faint.
   - Suggested fix: a lighter destructive text colour for dark mode. This is a polish follow-up for the platform palette, and it needs the brand-contract classification check.
3. **Sentence-level accessibility on the commission page.** QA's finding 4 is confirmed and already filed as polish: a screen reader hears "Appointed Appointed 9/14/2026". The same pattern repeats for "Ended Ended …" on an ended record, so fix both.
4. **Help readability, polish.** The "Administrative commissions" section is four dense paragraphs. Splitting it into short steps (Record, Add members, End, Remove) would suit a phone reader. This is not a truthfulness issue.
5. **Not walked, and why.**
   - The guided empty state of the add-member form (zero eligible people) is covered only by unit and component tests. It needs a presbytery with no eligible person, which my fixture cannot make without damaging its data.
   - The flag-off and stale-edit states are covered by QA's e2e tests 12 and 3, which I did not re-run.
   - Anyone who goes live should confirm the empty-people state once in a real new presbytery.
6. **Boundary-test hardening (QA finding 3)** is already filed. An import allowlist for `@/lib/role-grants` and any delegation module in the committees surface is still owed. The behavioural backstop (the downward counts were unchanged throughout my walk) holds.
7. **Housekeeping at the release commit** (orchestrator, Rules 10, 13, 14 and 17):
   - set `presbytery-committees` `verifiedIn` to `0.64.0` and `package.json` to 0.64.0;
   - move `docs/TODO.md:526` (the Increment 2 line) to Done;
   - keep `docs/TODO.md:151` open (the `groups.manage` Roles-screen description, T12);
   - update the functionality-map line for the presbytery;
   - run `grep -n "\[help:" docs/TODO.md` and confirm no token names `presbytery-committees`;
   - Rule 13: the C16 lines are the draft what's-new text. Per the standing instruction, keep them in the work-log and do not publish.
8. **Carried residuals, not new:** F456, F459 and F460. Every `groups.manage` holder can read the charge, and reads are unaudited (tier-1, architect-accepted). Name uniqueness is `paper`. The Inc 1 notes 2 to 4 are tracked at `docs/TODO.md:133–135`.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete for Increment 2 (founder walk through the real definer at 360px, light and dark: record about a congregation and about none, add and end members, end the commission, edit an ended record, remove; the neutral refusal with four forged ids; a congregation administrator, a keyless member and a `groups.manage`-only clerk; audit rows and downward counts read from the database; help section, troubleshooting bullet, `roles-who-can-do-what` and `privacy-policy` read at 360px; fixture removed, server stopped by PID, flags untouched) | SHIP WITH NOTES | 2026-11-19 |

## Closing judgement for the parent pipeline (`2026-11-19-presbytery-committees`)

The parent pipeline can close. Operator decision B is delivered in full across two increments. A presbytery can keep its committees, each labelled Required, Standing or Ad hoc, with the six dated titles. It can also keep a record of each administrative commission, with members, an end and a mistaken-entry removal. Both rest on one migration (0090) that the second increment never touched. The hard property Phase 1 cared most about held through to the end: a commission record is the presbytery's note and not a grant. The tables carry no role or group column. The only policy is organization-scoped. A boundary test pins the no-write rule. In the walk, the congregation saw nothing and every downward count stayed at zero. The audit trail carries ids and field names but no free text. What remains is polish and tracked residuals: the "organization" 404 for a missing commission, the faint destructive text in dark mode, the unaudited charge reads and the F456/F459/F460 write-model debt. None of these gates a presbytery's go-live. Both increments shipped as SHIP WITH NOTES, which is the honest verdict. The parent log may now record both children as complete.

---


## What's-new draft (Rule 13; not published, per the operator's standing "no what's-new for now")

> **Administrative commission records.** Committees & Commissions now keeps your presbytery's record of each administrative commission: its charge, the congregation it concerns, when and by what minute it was appointed, who serves, and when it reported. A record gives no one access, and the congregation does not see it.
