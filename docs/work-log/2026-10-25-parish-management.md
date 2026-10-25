# Parish (deacon-district) management — fpcw Track C — Work Log

> **Slug:** `2026-10-25-parish-management`
> **Surface:** (org) admin
> **Permission(s):** TBD in Phase 1/3
> **Flag(s):** none expected (operator: per-org toggles, not new platform flags, pre-live)
> **Estimated complexity:** medium
> **Pipeline mode:** Full
> **Numbers (pre-assigned 2026-10-25, Rule 16):** migration 0068; DECISION-242–245; F258–F265; dev port 3510

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; G1–G15; seat shape to architect | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Complete; seat via resolver (DECISION-242), DB archive guard (243), placement + single count (244), overwrite+audit + lock order (245); R1 seat-key guards, R2 revoke DELETE; F258–F264 | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | Complete; migration 0068 designed in order; `src/lib/parishes.ts` is the only writer; explicit-button picker (F261); S1 declined; F265 raised; staged files and pre-ship reads listed; CLAUDE.md sentence awaits operator approval | Design complete, implementer named | 2026-10-25 |
| 4 — Implementation | database-admin (Batch A), then full-stack-developer (Batches B, C) | Batch A complete: 0068 hand-written, applied twice (idempotent), rollback rehearsed, journal idx 68; test-rls-68 64/64 as presby_app; parishes.db.test.ts 25/25; staged seed + two integration patches. Batches B, C pending | Batch A done | 2026-10-25 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

Parish (deacon-district) management, fpcw Track C. Work-log: `/Users/cshenso/git/presby-platform/presby-parish/docs/work-log/2026-10-25-parish-management.md`. This is a read-only review. I wrote no files.

## VERDICT

**READY WITH NOTES.** The feature shape is sound and the prior art is detailed. Four findings change the scope and go to the architect and tech-lead as inputs:

1. No code can create a district today (G1).
2. `org_units` has no "archived" state (G2).
3. The Board of Deacons Moderator seat has no representation (G3).
4. A founding administrator cannot reach the existing Parishes tab (G4).

Each has a safe default in Open Questions, so nothing here needs the operator before Phase 2.

## ONE-LINE TAKE

> Give a congregation's Board of Deacons Moderator (or its administrator) a way to define districts, put every household in one, find the households with no deacon, and empty an archived district in one confirmed action. Authority follows a dated, recorded seat rather than a grant to a person.

## What the code and docs say today

- `households.org_unit_id` and `officer_terms.org_unit_id` exist, with composite foreign keys (`src/lib/db/domain/people.ts:192,206`, `officers.ts:140,189`).
- **No application code writes `org_units` at all.** Only `scripts/seed-dev.sql:1002` inserts into it. No code writes `households.org_unit_id` after creation either.
- `officers.ts:400` and the Add-officer-term form require a district for a deacon term and list districts from that table. On a real install that list is empty, so a deacon term cannot be recorded.
- `org_units` has no status or archive column. It has `id, organization_id, unit_type (parish|campus|district), name, created_at`. "Archived district" needs a new column, so migration 0068 is real.
- The only reader is `getParishRoster()` (`src/lib/directory.ts:1115`), gated on `directory.view_hidden`. It counts only households passing the directory privacy predicate, and it lists every `org_unit`, including campuses.
- Officer offices include `moderator`, but it is board-less and deliberately unmapped to any group. DECISION-079 treats it as a Session presiding label. The diaconate is a derived group whose rows are always `group_role = 'member'` and trigger-owned (`drizzle/0062`). Nothing says "Moderator of the Board of Deacons".
- The founding administrator's key set (`presby_founding_administrator_permission_keys`, `drizzle/0059:541`) has `people.manage`, `officers.manage` and `groups.manage`. It does **not** have `directory.view_hidden`.
- `insertAuditRow(tx, …)` (`src/lib/audit-tx.ts`) writes an audit row inside the state-changing transaction. That is the right primitive for "every move audited". `audit_events` carries no org column, so `organizationId` goes in metadata.
- Per-org toggles are toggle-only (`flag: null`), as `org_portal.calendar` is. That matches the operator rule.
- fpcw's own record of the production backlog: 323 of 507 households had no parish, and most of the tail were non-members with no status tag. The Unassigned view has to be a triage list, not a handful.

## Pass 1 — User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Admin (`officers.manage`) | **Create** a district; **rename** it; **archive** it; **restore** an archived one | Setup, then occasionally |
| Admin (`officers.manage`) | **Record** a Board of Deacons Moderator seat (and a co-moderator) with start and end dates, from Officers | When the Board elects |
| Seat holder (Moderator or co-moderator) or admin (`people.manage`) | **Open** the Parishes surface; **read** a district's households | Weekly or more |
| Same | **Choose** a district for one household; **change** or **clear** it (move) | On demand, in bursts |
| Same | **Open** the Unassigned view; **hide** or **show** population groups; **assign** from the row; **Undo** within a short window | Backlog sessions |
| Same | **Pick** a successor and **confirm** "move all households" out of an archived district | Rare (deacon rotates off) |
| Ordinary deacon, member, other roles | **Read** the existing roster only (unchanged). **No move verbs** | n/a |
| Anonymous, no-roles user | None. Nothing on `/`, `/access-pending` | n/a |

The request says "the Moderator" without naming a surface. Every verb above is in the `(org)` tree and none is platform-admin. A platform admin gets nothing here without holding the seat or a tenant permission through an invitation (Two Hierarchies).

## Pass 2 — Flow Audit

**F1. Define districts.** Entry is the admin hub or Officers, behind the toggle and `officers.manage`.
- Steps: Parishes → "Add district" → name → Save. Rename is inline. Archive opens a confirmation that states the household count and whether a deacon term is still open. Restore is one tap.
- Success: the district appears in the list and in the Add-officer-term picker.
- Failure: a duplicate name (case-insensitive, trimmed) gives an inline field error. A save failure gives "We couldn't save that. Nothing was changed." Zero districts shows the empty state below.

**F2. Record the seat.** Entry is Officers → Add officer term.
- Steps: person → office "Moderator of the Board of Deacons" → start date, with an optional minute reference. A co-moderator is a second concurrent term. The record form must say that the seat gives authority over district assignment (G3, G11).
- Success: authority starts on the start date and ends when the term ends.
- Failure: the existing officer-term errors, for example an overlapping term for the same person and office.

**F3. Assign or move one household.**
- Entry: a district page row (Move) or an Unassigned row (picker). Both are reachable at 360px.
- Steps: choose a destination from active districts only, current one excluded. It commits on selection (single move, G12), with a toast and a 10-second Undo. The write carries the district the viewer saw as the expected current value.
- Success: the row leaves the list, counts fall, and the audit row is written in the same transaction.
- Failure, no authority: a calm refusal that does not vary with whether the household exists.
- Failure, state changed: "someone else just moved this household" plus a refresh.
- Failure, other: "Nothing was changed."
- Selecting the current district is a quiet no-op: no write, no audit row.

**F4. Work the Unassigned backlog.**
- Entry: the Parishes tab, a leading "No deacon yet" card with a count (hidden at zero), then the Unassigned page.
- Steps: population toggles with live counts, in order (G8). One card per household, with living people and a connection badge each. Assign from the row, then Undo.
- Success: the list shrinks. At zero it says "Every household has a deacon."
- Failure: a load failure gives a retry panel. Each row has an in-flight state. A refused or failed row shows an inline error and the row stays.

**F5. Empty an archived district.**
- Entry: an archived district's page, which shows a notice and the count.
- Steps: "Move all N households to…" → pick an active district → AlertDialog (title, effect line, who the successor deacon is or "no deacon yet", "can't be moved back into an archived district") → Confirm.
- Success: one transaction. A toast gives the count moved and the count skipped, with no names.
- Failure: rolled back. "Could not move the households. Nothing was changed." More than 100 households shows a message and no picker (G9).

## Pass 3 — Permissions and Flags

- **Move and read authority:** an active Moderator-seat term held by the viewer (G3), or an administrator holding `people.manage`. It is read live from the database on every request, never a session claim. A seat that ends stops working on the next request. A seat that starts later does nothing until its start date. The end-date boundary must match the Session seat rule, so Phase 3 pins one definition.
- **District define, rename, archive, restore:** `officers.manage`. It is held by the founding administrator, and it is the key for deacon terms, which districts exist to scope. No new permission key, which matches fpcw's ruling. A new key would force edits to `presby_founding_administrator_permission_keys`, its pinned-equal test and a backfill. A permission key is also a different mechanism from the seat, and the request says authority is the seat.
- **Read of names under privacy:** the seat does not widen what a viewer may see. See G6.
- **Flag:** no platform flag (operator rule). Add one per-org toggle, `org_portal.parishes` (suggested key), toggle-only with `flag: null`, `orgTypes: ["congregation"]`. Presbyteries and synods have no Board of Deacons. `provisionedOn: false`. Rollback is turning the toggle off. That hides the new surfaces and refuses the actions; data are untouched. The existing roster read stays on its current gate.
- **Gate order:** auth → org membership (`resolveOrgContext`) → toggle → authority → district scope → household state.

## Pass 4 — Gaps the Request Didn't Address

**G1. There is no way to create a district.** This is a prerequisite, not a nice-to-have. A deacon term needs a district, a household needs a district, and the table has no writer. Resolution: district create, rename, archive and restore are in scope.

**G2. "Archived district" does not exist in the schema.** Migration 0068 adds `org_units.archived_at` (nullable, with the usual comment).
- It also needs a unique case-insensitive active name per org.
- The move must refuse an archived target at the database level (a trigger, or a check in the move function). An app-only check races against a concurrent archive.
- Every existing reader that lists `org_units` must be updated. `officers.ts:400` and the officer form must not offer archived districts for a new deacon term. `getParishRoster` must show them as archived or exclude them.

**G3. The seat has no representation, and this is the central design question.** The architect decides the shape (see Operator Questions 1 and 2). Functional requirements I need honored:
- The seat is dated and minutable. It allows two or more concurrent holders, as the fpcw Moderator and co-moderator do. It shows in the officer roster as "Moderator of the Board of Deacons".
- It is **not** a grant to a named person. The request is explicit.
- It must not grant Session or diaconate membership.
- **No existing officer row may silently gain authority.** Whatever shape is chosen, existing `moderator` terms (the Session presiding label, DECISION-079) must not become district authority by migration or by reinterpretation. That would be privilege escalation by data.
- Recording a seat is an authority grant. It is a new member of the same family as DECISION-205 (Session approver), so it needs the same statement and copy (G11).

**G4. First-day wall.**
- A founding administrator has no `directory.view_hidden`, and the existing Parishes page demands it. Today the new congregation's administrator cannot open the Parishes tab at all.
- A Moderator who is not an administrator likewise holds no `directory.view_hidden`, and the existing roster page demands it.
- Resolution: the new surfaces gate on the seat or `people.manage`, not `view_hidden`. The existing `getParishRoster()` gate widens so these viewers can reach the page, or the new district page replaces it.

**G5. Counts disagree.**
- `getParishRoster()` counts only directory-eligible households (the privacy predicate). The management surfaces, the bulk-move dialog ("N households") and the archived-district notice will count all households in the district.
- Two different "household counts" for one district is the exact defect fpcw's Phase 2 warned about.
- Resolution: one definition, used by the roster, the district page, the dialog and the Unassigned card. The roster must then change or be relabeled.

**G6. Privacy of names.**
- The Unassigned list shows people. Members hidden from the directory (`directory_hidden`, `hide_*`) are sensitive.
- The Community readers precedent (`people.manage` sees hidden people because it can already edit them) applies to the admin tier.
- It does not automatically apply to a Moderator-seat holder.
- Default: show household name, a count, and the connection badge to everyone with authority. A seat holder sees person names only where the directory would show them, or where they also hold `directory.view_hidden`. A hidden person appears as "Private" with their badge.
- The household name still identifies the row. Show no contact detail, birthday, photo or address on these surfaces.

**G7. District types.** `unit_type` is `parish | campus | district`. The roster lists all of them. Management and move targets must cover `district` and `parish` units only. A `campus` is multi-site, not deacon care. New districts are created as `district`.

**G8. Who counts as unassigned.**
- A household with no district and at least one living person with a **current** membership at this organization. "Living" means no date of death and not merged. "Current" means the membership has no `ended_on`.
- Households with no such person are not listed or counted, but can be assigned from their household page.
- The bulk move is the opposite: it moves **all** households in the archived district, including those that the Unassigned list would never show. Say this in Phase 3.
- Four exclusive household buckets, first match wins, using the existing `deriveConnection` vocabulary:
  1. **Members**: any person whose roll is active, baptized or affiliate.
  2. **Participants** (community non-members): any person on the `other_participant` roll.
  3. **Visitors**.
  4. **Others** (listed or staff).
- All four are shown by default. Hide state lives in the URL (`?hide=`), is allowlist-parsed, and is not persisted.

**G9. The 100-household cap.**
- The request caps the bulk move at 100. A district with more than 100 is a trap for a large congregation: no picker, and a long manual slog.
- Default: refuse with a message to move in smaller groups. Do not truncate silently.
- Track a follow-up for the moderator who actually hits it.
- The server must enforce 1 to 100 distinct ids, archived source, active target different from source, and the same org. "Admin" is not exempt from the archived-source rule.

**G10. History of a household's district.**
- Overwrite `households.org_unit_id` and keep the history in `audit_events`. Each row records household, from, to, actor and, for a bulk move, a batch id. There is no dated district-history table and no "as of" query.
- This is a deliberate trade against the roll's append-only posture. District is operational care routing, not a constitutional fact, so no report replays it. Record it as a decision.
- Residual: an org admin cannot read this history in-app. `audit_events` is platform-viewable today. Do not promise a history view in copy.

**G11. Self-recorded authority.**
- A founding administrator can record themselves as Moderator, and the platform admin chain (revoke, self-addressed designation, seat) exists as in DECISION-205.
- Treat it the same way. The audit row carries `selfRecorded`. It is stated as `paper` in CLAUDE.md's Two Hierarchies section and the decision.
- The seat record's help text says plainly what the seat confers.
- Release-note and in-app copy must not claim "only the Moderator can move households". Administrators can too, and the self-record path is admitted.

**G12. Confirmation model.**
- A single move commits on selection with an Undo toast. A bulk move uses a confirmation dialog.
- Undo after a bulk move would be unreliable, so there is none.
- Undo of an assignment out of or into an archived district is refused with a truthful message.
- Undo is a clear-to-unassigned write with the just-assigned district as the expected value. Clearing is not a delete.
- This is a deviation to confirm (Open Question 6).

**G13. Concurrency.**
- Every single move carries the expected current district and uses a conditional update. A mismatch gives a "just moved by someone else" answer, not a silent overwrite.
- The bulk move sorts ids before locking so two concurrent runs cannot deadlock.
- An id no longer in the archived district is skipped and counted. The response carries counts only, never ids or names.
- Archive racing a move into that district is closed at the database (G2).

**G14. Audit.** Every mutation writes `audit_events` in the same transaction (`insertAuditRow`). Candidate new `AUDIT_ACTIONS` keys: household district changed; district created, renamed, archived, restored; bulk move. A bulk move writes one row per household plus one batch row with the count. A move that changes nothing writes nothing. A failed audit insert fails the change. `check:audit` applies.

**G15. Also at the edges.**
- **2FA mid-enrolment:** the `/o/*` proxy already redirects an unenrolled, 2FA-required user to `/totp`, and server actions re-check authority regardless. The e2e must include an MFA-enrolled seat holder.
- **Failure microcopy:** a database failure on the district page or Unassigned list must not read as "no districts" or "everyone has a deacon". It shows a load-error panel with retry, as the directory pages do.
- **Mobile (360px):** row cards, not tables. Pickers full width, 44px targets, wrapping toggle pills, stacked dialog buttons. District create and rename are `useForm` roots, so `HydrationGate` applies (`check:hydration-gate`). The bulk-move confirm gets the same treatment.
- **New-install empty states:** see Copy.
- **Existing surface changes:** the per-parish detail page this feature adds fulfils the TODO item at line 380 (per-parish roster), which the Parishes tab currently renders as dead-end panels. The Parishes roster should link to the new district page, and `DeaconCard` and the archived-district display must handle an archived district.

## Pass 5 — Adversarial Pass

| Surface | What the user can manipulate | Finding |
|---|---|---|
| Redirect or `from` / `next` params | Any back-link parameter | Gap if built. Recommend **no** user-controlled return parameter: use fixed back links. If one exists, it must be a same-origin path validated against an allowlist (`/o/<slug>/directory…`), never a raw `callbackUrl`. |
| `?hide=`, `?view=` | Arbitrary strings | Allowlist-parse. Unknown values fall back to the default, never to a query branch. |
| Ids in URL and body | Non-uuid, other-org uuid, duplicate, 10,000 ids | `isUuid` before any query. An other-org district or household is indistinguishable from a nonexistent one (RLS plus composite keys). Dedupe the ids and enforce the 100 cap server-side. Over the cap is a 400, never a truncation. |
| Direct URL to the Unassigned page or district page | Skipping the nav tab | Authority and toggle are checked in the page and again in every action. The nav is a convenience, not the gate (the existing `DirectoryNav` pattern). |
| Scope-before-state | Probing households or districts | The authority check and the district-scope check run before the household's current state is read. A non-authorized caller gets the same refusal whether the household exists, is assigned or is not. A skipped id in a bulk response is a bare count. |
| Cross-org | A seat in org A, an id from org B | Authority is per-org, derived from `officer_terms.organization_id`. RLS and the composite foreign keys backstop. No `getPlatformDb()` in this tree. |
| Enumeration | "Archived" vs "not found" vs "not yours" | Existing-but-unreachable and nonexistent districts give the same refusal. Archived-in-scope may say "archived", because the viewer already holds the list. |
| State-machine shortcuts | Move into an archived district; bulk-move out of an active one; unarchive then move; same source and target | Server enforces: active target only, for every tier. Bulk source must be archived. Target must differ. All checked server-side, not by the picker. |
| Self-targeting | Moderator moves own household; moderator ends own seat; admin records self as Moderator | A moderator moving their own household is allowed (no carve-out, ruling kept). Ending or recording a seat is an `officers.manage` act, audited. Self-recording is permitted, stamped and stated as `paper` (G11). |
| Seat staleness | Seat ended or not yet started | Live check each request. A future-dated seat has no authority. A tab left open after the seat ends fails on the next write with a truthful refusal. |
| Input boundaries | Empty, 5,000-character, zero-width or combining-character names; names differing only in case | Server-side validation: trim, NFC-normalize, strip control and zero-width characters, 1–80 chars, case-insensitive uniqueness among active districts. Names render with `break-words`. |
| Concurrency | Double-click; two moderators on one household | Expected-district conditional update. Second writer gets the conflict answer. One audit row, not two. |
| Authority via officer data | A pre-existing `moderator` term, a deacon term, an ended seat | None may confer authority unless it is the new seat shape (G3). An ordinary deacon gets no move verb. |
| Platform admin | Platform role as authority | Confers nothing. Only a held seat or a tenant permission does (Two Hierarchies). |

## Copy for key states

Every string below is subject to Phase 3 checking against the accepted residuals (G11).

- **No districts (admin):** "No districts yet. Add your first district to start assigning households." with an **Add district** button.
- **No districts (seat holder, not admin):** "No districts have been set up yet. Ask your congregation's administrator to add them."
- **Seat unfilled (admin callout):** "No one holds the Moderator seat for the Board of Deacons. Record it in Officers so the Moderator can assign households." with a link.
- **District with no households:** "No households in this district yet."
- **Unassigned empty:** "Every household has a deacon." with a link back to Parishes.
- **Unassigned header:** "No deacon yet" plus counts per group. Toggles read "Members (27)", "Participants (34)", "Visitors (51)", "Others (208)". Hidden groups keep a count.
- **No permission (move, create or archive):** "You don't have permission to do that." Do not name which role could.
- **Conflict:** "This household was just moved by someone else. We've refreshed the list."
- **Network or server failure:** "Could not move the household. Nothing was changed."
- **Load failure:** "We couldn't load the households. Try again." Never "No households".
- **Archive confirm:** "Archive {name}? {N} households are still in it, so they'll show here as needing a new district. You can restore it later." If a deacon term is open: "{Name} is still listed as this district's Deacon. End that term in Officers if they have stepped down."
- **Restore:** "Restore {name}?"
- **Archived district notice:** "This district is archived." Plus, for those who can move: "Move households one at a time, or all at once below."
- **Bulk dialog title:** "Move N households to {destination}?" Body: "All N households in {source} will move to {destination}. {Deacon name} is that district's Deacon. / This district has no deacon yet. They can't be moved back into an archived district." Buttons: Cancel and "Move N households".
- **Bulk success:** "Moved N households to {destination}." Append " M had already been moved by someone else and were left alone." when M > 0. Counts only.
- **Bulk over cap:** "This district has more than 100 households, so move them in smaller groups with Move."
- **Undo toast:** "Assigned to {district}." with **Undo**, for 10 seconds.
- **Seat record help text:** "The Moderator seat lets its holder assign households to districts. Record it only for the person the Board has chosen."
- **Toggle off:** the existing flag-off style panel, naming the congregation and saying nothing about why.

## Out of Scope (confirm with user)

- Per-person (as opposed to per-household) district assignment. `memberships.org_unit_id` exists and nothing reads it; leave it unused.
- Bulk assignment of unassigned households (a selection model plus partial-failure handling on the privacy-sensitive list). Row-level assign plus the bucket filter makes the backlog tractable.
- An ordinary deacon "claiming" an unassigned household into their own district (fpcw allowed this). The request names only the Moderator seat.
- Google Group sync and meeting-invitation follow-through. fpcw had these; presby has no equivalent for districts.
- Automatic reassignment when a deacon term ends, and any district-history view or as-of report.
- Hard delete of a district. Archive and restore only.
- Campuses (`unit_type = 'campus'`), and anything for presbyteries and synods.
- fpcw data import mapping (Track K, review item 4). This feature writes the model the import will target. It does not decide how archived fpcw parishes come across.

## Open Questions

Each has a safe default the pipeline proceeds on unless the operator says otherwise.

1. **Seat shape (architect to decide).** The default is a new, board-specific office recorded in `officer_terms`, so dates and co-moderators come for free. It would not map to any derived group, and it would add to `OFFICER_OFFICES` and the CHECK, with the source-scan tests that pin them. Alternatives to reject: reusing `moderator` (it is the Session presiding label and existing rows would silently gain authority), a person-level role grant (the request says not a grant to a named person), and `group_role` on the derived diaconate (trigger-owned, always `member`).
2. **Must the Moderator also hold an active deacon term?** Default: no. The seat is its own record.
3. **Admin tier.** Default: `people.manage` moves households and `officers.manage` defines districts. Both are in the founding administrator's set. No new permission key.
4. **Can the Moderator define districts?** Default: no. They assign and move. Administrators define.
5. **Unarchive.** Default: include Restore (audited, one tap) so an archive mistake is reversible and nothing is deleted.
6. **Undo on single moves, commit on selection.** Default: yes, with a 10-second Undo on a single assign or move. No Undo on a bulk move.
7. **Same name for two districts, or a district named like a campus.** Default: unique case-insensitive among active districts.
8. **Over-100 districts.** Default: refuse with the message above, and add a TODO follow-up.
9. **Hidden people on the Unassigned list for a seat holder who is not an administrator.** Default: show the household name and connection badge, mask names of directory-hidden people as "Private".
10. **Which `unit_type` values are manageable.** Default: `district` and `parish`. New districts are created as `district`.
11. **Where the toggle lives.** Default: `org_portal.parishes`, toggle-only, off by default, `orgTypes` limited to congregations. fpcw's Pasture-style cutover would turn it on per org.

## Handoff

For the architect:
- Rule on the seat shape (Q1), where district management lives (a member-side `directory/parishes/*` subtree versus `admin/…`), and the archived-target enforcement at the database.
- Confirm the single definition of "household count" (G5) and the audit action keys.
- Note that the founding-administrator permission function and its pinned-equal test are untouched under the default (no new permission key).
- Phase 6 will require the walk as the person this creates: a founding administrator on `development` at 360px, creating a district, recording the seat, and moving a household. A seeded fixture will not do.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-25 |

**Next agent:** architect (Phase 2).

Files read, for the orchestrator's reference:
- `/Users/cshenso/git/presby-platform/presby-parish/docs/work-log/2026-10-25-parish-management.md`
- `/Users/cshenso/git/presby-platform/presby-parish/docs/TODO.md` (lines 52, 380)
- `/Users/cshenso/git/presby-platform/presby-parish/docs/reviews/2026-10-22-fpcw-parity.md`
- `/Users/cshenso/git/presby-platform/presby-parish/src/lib/directory.ts`, `officers.ts`, `community-labels.ts`, `audit-tx.ts`, `org-features.ts`, `authz.ts`
- `/Users/cshenso/git/presby-platform/presby-parish/drizzle/0010_presby_resolver.sql`, `0025_presby_deacon_linkage.sql`, `0059_presby_account_invitations.sql`, `0062_presby_session_approval.sql`
- `/Users/cshenso/git/fpcw-directory/docs/modules/groups/parish-moderator-management.md` and `parish-bulk-move.md`

I did not open fpcw's `src/` files (`parish-authority.ts`, `parish-assignment.ts`, `unassigned-households.ts`, `(dashboard)/parishes/`) or its DECISION-179/180/181 entries. I relied on the two module docs, which summarize them.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.**

The feature shape from Phase 1 holds. My rulings are below. Three of them change an analyst default, and Phase 3 must design to the rulings rather than the defaults:

- **Seat authority goes through the resolver.** It uses a new seat-only key, `parishes.assign`. It is not a separate predicate and does not reuse an admin key.
- **Every write locks in one order.** `org_units` rows are locked first, sorted by id, then `households` rows, sorted by id.
- **The bulk move takes no household ids.** The request names the source, the target and the count the user saw.

Two items are required (R) and the rest are suggestions (S). The required ones are the seat-key guards and the DELETE revoke on `org_units`.

## Placement

**Directory placement.** Everything lives in one subtree: `src/app/(org)/o/[slug]/directory/parishes/`. This includes defining districts. Nothing goes under `admin/`.
- `directory/parishes/page.tsx` (existing) becomes the district list. Holders of `officers.manage` see add, rename, archive and restore there. One list of districts, one reader and one gate helper.
- `directory/parishes/[orgUnitId]/page.tsx` is the district page. It has Move, and for an archived district it has "Move all". This closes TODO line 380.
- `directory/parishes/unassigned/page.tsx` is the triage list.
- Each route gets its own `actions.ts`, marked `'use server'`.
- The admin hub and the Officers page link into this subtree; they hold no second copy.
- Why not `admin/`: the main user (the seat holder) is not an administrator. `admin/` is only a URL prefix with no auth of its own. Splitting the feature would create two district lists, and that is the G5 problem again.

**New library module: `src/lib/parishes.ts`.** It is the only code that writes `org_units` and `households.org_unit_id`. It holds:
- `getParishAuthority(tx, personId, orgId)`. It returns `{ canDefine, canMove, canReadRoster, seesHiddenNames }` and is the single place these questions are answered.
- The single household-count definition.
- Create, rename, archive and restore of districts.
- Single move, Undo and bulk move.
- The Unassigned query, with its four buckets built from the existing `deriveConnection` vocabulary. No second copy of that vocabulary.

`getParishRoster()` stays in `directory.ts`, but it calls `parishes.ts` for its gate and its counts. Don't grow `directory.ts`; it is already 1,191 lines and on the code-review hotspot list.

**Server vs client split.** Pages are Server Components. Client islands are limited to these:
- **Row picker for move and assign.** Use the existing `DropdownMenu` primitive, or a native `<select>` plus an explicit Assign button. **A native `<select>` that commits on `onChange` is ruled out (F261).** In Chrome and Firefox on Windows, arrow keys on a closed select fire `change` once per keypress. A keyboard user would commit several moves and write several audit rows. A control that commits on selection must also be unusable until the page hydrates. Use `HydrationGate` or `useHydrated()`, the same reasoning as DECISION-159, even though `check:hydration-gate` only scans `useForm` roots.
- **Undo toast.** `sonner`, already a dependency.
- **District create and rename.** `useForm` roots, so each needs `<HydrationGate>`.
- **Archive, restore and bulk-move confirmations.** `AlertDialog`.
- **Population toggles (`?hide=`).** Server-rendered `<Link>`s through `ButtonGroup`. No client state.

**Dependencies.** None new. `DropdownMenu`, `AlertDialog`, `sonner`, `ButtonGroup` and native `<select>` all exist. Don't add a shadcn `select` or `command`; that would bring a new Radix package and run into DECISION-048.

**Inherited gates.** The subtree also sits behind two existing platform flags, `org_portal.directory` and `org_portal.directory_v2`. Both are on in `development`. Phase 3 must confirm they are on in production before this ships. TODO line 236 also asks for an e2e spec before `directory_v2` is turned on in any real environment. This pipeline's e2e can count toward that.

## Invariants Touched

**The Court Is Not a Group (Q1, the seat shape). Ruling: DECISION-242.**
- **New office.** Add `deacons_moderator` to `officer_terms`, labelled "Moderator of the Board of Deacons". It is added to `OFFICER_OFFICES` and to the `officer_terms_office_allowed` CHECK, and the source-scan tests stay pinned.
- **New derived group.** `presby_sync_derived_group()` gets one more CASE arm: `deacons_moderator` maps to a new derived group, also `derived_from = 'deacons_moderator'`. The group is named "Board of Deacons Moderator", has group type `roster` (not `court`, because it is a seat, not a court) and is protected. It is seeded by `groupSeedPlan()` for congregations, and 0068 backfills it with the 0062 §6 idiom.
- **New baseline role.** A constitutional, protected role `deacons_moderator` carries exactly one new tier-1 key, `parishes.assign`. It is granted through the group arm to that group. It goes into `baselineRoleSeedPlan("congregation")`, which widens `boundToDerivedFrom` to include `'deacons_moderator'`. 0068 backfills it with the 0062 §7 idiom: the role key decides, the `grant_reason` text never does, and an existing role is never modified.
- **Why the resolver and not a dedicated predicate:**
  - The resolver's group arm already applies the half-open `[starts_on, ends_on)` rule. That is the same rule as `officer_terms_no_overlap` and the Session seat. So the end-date boundary Phase 1 asked for matches the Session one by construction, not by a second copy of date logic.
  - Authority stays visible to `explainPermission()` and the /developer "why can Jane" panel.
  - It is read live on every call, through `presby_has_permission`.
  - It is exactly the DECISION-202 pattern. A separate `officer_terms` predicate would be a second authority evaluator that can drift.
- **Not a grant to a named person.** The grant goes to the group the seat fills, never to a person.
- **No change to existing seats.** It is not the diaconate, so no Session or diaconate membership comes with it. `moderator` is untouched (DECISION-079). No existing row gains authority, because no row holds the new office string. An empty group grants nothing, so the backfill provisions and does not grant (the 0052 note 5 and 0062 §7 reasoning).
- **The seat need not be a deacon.** No database coupling to a deacon term (Q2 default kept).
- **Congregations only.** Phase 3 makes the officer form refuse the office before the trigger's missing-group error can fire.

**No Role Carries a Wildcard / seat-only key. Required (R1), F260.** Today `grantRole()` refuses nothing based on the role. A person holding both `role_grants.manage` and `parishes.assign` could grant the seat role, or a custom role carrying the key, directly to a person. That would turn the seat into a person grant. 0068 closes this in the database, modelled on `app_role_permissions_giving_guard` (0055):
1. A `BEFORE INSERT OR UPDATE` guard on `app_role_permissions` lets `parishes.assign` sit only on an org-owned, protected role whose key is `deacons_moderator`.
2. A guard on `role_grants` lets a role carrying `parishes.assign` be granted only through the group arm, to that organization's `derived_from = 'deacons_moderator'` group.
3. The same refusal applies on `administrative_commissions.role_id` and `org_delegations.role_id`.

`role-definitions.ts` and `role-grants.ts` return a typed refusal before the database is reached, and the key is hidden from the custom-role editor. The same gap exists today for `session_member` / `roll.approve`. That fix is out of scope here and goes to `docs/TODO.md`.

**Permissions vs Flags.**
- **Read and move:** `parishes.assign` OR `people.manage`, both checked inside the mutating transaction. Having two keys for one capability follows DECISION-204.
- **Define, rename, archive, restore:** `officers.manage`.
- **Toggle:** `org_portal.parishes`. It is a per-org toggle, toggle-only (`flag: null`), `orgTypes: ["congregation"]`, `provisionedOn: false`. No platform flag (operator rule).
- `presby_founding_administrator_permission_keys` and its pinned-equal test are **untouched**.
- `src/lib/permissions.ts` (frozen) is untouched. The new key enters the tenant `permissions` table by migration.
- **G4 is resolved.** When the toggle is on, `canReadRoster` is `directory.view_hidden` OR any of the three keys above. `DirectoryNav`'s Parishes tab uses `canReadRoster`. With the toggle off, today's behaviour is unchanged.

**Two Hierarchies.**
- No platform predicate appears in any check.
- **Accepted residual.** A founding administrator can record themselves in the seat. Because they already hold `people.manage`, this gains them nothing over their admin tier. Recording is stamped `selfRecorded`.
- **F264.** `officers.ts:284` stamps `selfRecorded` for Session offices only. Phase 3 introduces `AUTHORITY_OFFICES` (Session offices plus `deacons_moderator`) and uses it for both the stamp and the roster badge.
- **CLAUDE.md edit at integration.** The orchestrator adds one sentence to Two Hierarchies, next to the DECISION-205 sentence. It says that recording the Board of Deacons Moderator seat confers `parishes.assign`, that self-recording is permitted and stamped, and that this is `paper`.

**All deletes are soft / organization permanence. Required (R2), F258.** The live catalog on `development` shows `presby_app` and `presby_platform` hold `DELETE` on `org_units`. 0068 revokes it from both (the 0063 precedent). A district is archived, never deleted.
- `scripts/test-rls.sql:1150` deletes an `org_units` row as `presby_app` (F262). Rewrite that block to roll back instead.
- Suggested: an owner-path `BEFORE DELETE` guard that allows the cascade during fixture teardown (the `presby_org_domains_guard_delete` idiom).
- Clearing `households.org_unit_id` is a write, not a delete.

**Composite Tenant Keys.** No new tables. The guard trigger looks up by `(new.org_unit_id, new.organization_id)`. The existing composite FKs remain the backstop against cross-org writes.

**Isolation Is a Database Property.** Read on `development` (2026-10-25): `org_units`, `households`, `officer_terms`, `groups`, `group_memberships`, `app_roles` and `role_grants` are all `relforcerowsecurity = t` with `tenant_isolation` policies. No new SECURITY DEFINER function is needed (see DECISION-243).

**Verify in a Browser.** The 360px walk Phase 1 required stands. It must include the row picker driven by keyboard on a desktop browser (F261).

## Notes

**Proposed DECISION-242. The Board of Deacons Moderator is a dated seat recorded in `officer_terms`, and its authority flows through the resolver.**
- The office `deacons_moderator` fills a derived `roster` group, also `deacons_moderator`.
- A baseline protected role `deacons_moderator` carrying only `parishes.assign` is bound to that group.
- `parishes.assign` is seat-only, enforced in the database on every resolver arm: direct and commission/delegation grants are refused, and group grants are allowed only to the seat group.
- The admin tier moves households with `people.manage` and defines districts with `officers.manage`. No change to the founding-administrator key set.
- `moderator` is unchanged (DECISION-079).
- Self-recording is permitted and stamped (the DECISION-205 family), and is `paper`.
- Rejected: reusing `moderator`, because existing rows would gain authority from data alone. Rejected: a person grant, because the request rules it out. Rejected: a `group_role` on the diaconate, which is owned by a trigger and always `member`. Rejected: a dedicated `officer_terms` predicate, which would be a second evaluator of dated authority.

**Proposed DECISION-243. District lifecycle and archive enforcement are database properties. Moves are conditional updates under RLS, not a definer function.** Migration 0068:
1. **Stop-block preconditions.** Before any change, report counts only for: rows violating the new `unit_type` CHECK, duplicate active names, and households or open deacon terms pointing at a `campus`.
2. **New column.** `org_units.archived_at timestamptz null`, with a comment. The actor goes in the audit row, not a column.
3. **`unit_type` CHECK, F259.** `org_units_unit_type_check in ('parish','campus','district')`, validated. Today the vocabulary exists only as a comment.
4. **Active-name uniqueness.** A unique partial index on `org_units (organization_id, lower(name)) where archived_at is null`. Names are stored already normalized: trimmed, NFC, control and zero-width characters stripped, 1–80 characters. A restore that collides with an active name maps to a typed error.
5. **Index, F263.** `households (organization_id, org_unit_id)`. No such index exists today.
6. **Guard trigger `presby_guard_org_unit_target()`**, invoker, `search_path` pinned:
   - It fires `BEFORE INSERT OR UPDATE OF org_unit_id` on `households`, and on `officer_terms` for a term that is open (`ends_on is null or ends_on > current_date`).
   - It refuses only when `org_unit_id` is **newly** set, so ending a term or archiving a district never fails.
   - It reads the target with `SELECT … FOR SHARE`, by `new.organization_id`.
   - It refuses an archived target or a `campus` target, and fails closed on a missing row.
   - It raises with a named constraint so the library can tell the cases apart.
   - `FOR SHARE` is what closes the archive race. The FK check only takes `FOR KEY SHARE`, which does not conflict with the archive's UPDATE.
7. **Revoke `DELETE`** (R2).
8. **Office vocabulary, derived group, seat role, the new key and the seat-key guards** (DECISION-242).

**Why no SECURITY DEFINER move function.** Everything stays inside one organization. Tenancy is enforced by RLS and the archive/campus rules by the trigger; authorization is checked in the app inside the same transaction, as for every other `people.manage` mutation. Revoking table-level `UPDATE` on `households` to force a definer would break every other household edit, and it is not proportionate.

**Accepted consequence.** `households.org_unit_id` now means "deacon district" only. A future campus dimension needs its own column (TODO).

**Proposed DECISION-244. Placement, one household count, and name masking.**
- **Placement.** `directory/parishes/*` and `src/lib/parishes.ts`, as above.
- **G5: the single count.** "Households in a district" means every `households` row whose `org_unit_id` is that district. That is the set a bulk move touches, so the dialog's N equals the rows the transaction writes. The roster, district page, archived notice and dialog all use one helper. `getParishRoster()` drops its directory-eligible count. The Unassigned count is a different, separately labelled population (G8), also defined once.
- **G6: masking.** It is computed server-side in `parishes.ts`, never on the client. The `directory_hidden` test comes from the predicate `directory.ts` already uses; export it rather than re-implementing it. A viewer without `people.manage` and without `directory.view_hidden` sees such a person as "Private". Deceased and merged people are excluded. No contact detail, photo, birthday or address appears on these pages.
- **Return links.** No user-controlled return parameter. Fixed back links only.

**Proposed DECISION-245. District assignment is overwritten and audited, not kept as dated history. Concurrency rules and audit keys.**
- **G10, concur.** District is care routing, not a constitutional fact, so no report replays it. History lives in `audit_events`, which has no retention sweep today. Copy promises no history view.
- **Lock order, every writer.** `org_units` rows first (`FOR SHARE`, sorted by id), then `households` rows (`FOR UPDATE`, sorted by id).
  - A single move locks its target district explicitly before its UPDATE.
  - Otherwise this deadlock is possible: a move holding the household waits for the district behind a queued archive, the archive waits on a bulk move's share lock, and the bulk move waits for the household.
  - A deadlock or serialization error maps to "Nothing was changed".
- **Single move and Undo.**
  - `UPDATE … WHERE id = $h AND org_unit_id IS NOT DISTINCT FROM $expected`. Zero rows means a conflict.
  - Moving to the current district is a no-op with no audit row.
  - Undo is the same call with `expected = just-assigned` and `target = previous`. If the previous district is now archived, the trigger refuses truthfully.
- **Bulk move (S, preferred).** The request body is `{ sourceOrgUnitId, targetOrgUnitId, expectedCount }`. **It carries no household ids.**
  - An archived source can only shrink, and the trigger enforces that. So the current set is the set the user saw, minus moves made since.
  - `moved` is the current set and `skipped` is `expectedCount - moved`.
  - If the current set is larger than `expectedCount` (a restore and re-archive happened in between), refuse with a conflict.
  - Refuse with no picker when the count exceeds 100.
  - The server rechecks: source archived, target active, target is not the source, same organization. No tier is exempt.
  - This removes the id-list attack surface: duplicate ids, 10,000 ids, ids from another organization.
- **Audit keys.** All written with `insertAuditRow(tx, …)` in the same transaction. `organizationId` goes in metadata. No household or person names.

  | Key | `resourceType` | Written when |
  |---|---|---|
  | `tenant.district.created` | `org_unit` | district created |
  | `tenant.district.renamed` | `org_unit` | district renamed; metadata `{from, to}`, district names only |
  | `tenant.district.archived` | `org_unit` | district archived |
  | `tenant.district.restored` | `org_unit` | district restored |
  | `tenant.household.district_changed` | `household` | any assignment change; metadata `{fromOrgUnitId, toOrgUnitId, undo?, batchId?}` |
  | `tenant.household.district_bulk_moved` | `org_unit` (the source) | once per bulk move; metadata `{batchId, toOrgUnitId, movedCount, skippedCount}` |

  - Recording the seat reuses `tenant.officer_term.started` / `.ended`, with `selfRecorded` (F264).
  - A no-op writes nothing. A failed audit insert fails the change. `check:audit` applies to every `actions.ts`.

**Findings raised in this phase (from the F258–F265 block):**
- **F258.** `presby_app` and `presby_platform` hold `DELETE` on `org_units`, which violates "all deletes are soft". Fixed by R2.
- **F259.** No CHECK on `org_units.unit_type`; the vocabulary is only a comment. Fixed in 0068.
- **F260.** `grantRole()` and `setRolePermissions()` let a holder of a seat-derived key grant it to a person directly. Closed for `parishes.assign` (R1). The same open path for `session_member` / `roll.approve` goes to TODO.
- **F261.** A native `<select>` that commits on change fires once per arrow key on Windows desktop browsers. Ruled out for the row picker.
- **F262.** `scripts/test-rls.sql:1150` deletes `org_units` as `presby_app`. It breaks under R2 and must be rewritten.
- **F263.** No index on `households (organization_id, org_unit_id)`. Added in 0068.
- **F264.** The `selfRecorded` stamp and badge cover Session offices only. Widen to `AUTHORITY_OFFICES`.
- F265 is unused and left for Phase 3 onward.

**Suggestions for Phase 3 (S):**
1. Relabel the existing `moderator` office "Moderator of Session" so it is not confused with the new seat. Copy-check it against DECISION-079 and existing strings.
2. Cases for `scripts/test-rls.sql`, added at integration (Rule 16), run as `presby_app`:
   - archived target refused;
   - campus target refused;
   - new open deacon term in an archived district refused;
   - closing an existing term there succeeds;
   - each seat-key guard refuses on the person, commission and delegation arms;
   - a cross-org seat grants nothing;
   - a seat term grants `parishes.assign` from its start date, and loses it on its end date;
   - `DELETE` on `org_units` is refused.
3. Seed fixture (`scripts/seed-dev.sql`): one seat holder who is not an administrator and has no `directory.view_hidden`, plus at least one archived district holding households. The e2e includes an MFA-enrolled seat holder (G15). This is not an auth-touching change under the Phase 4 gate definition.
4. Phase 3 pins the date semantics the seat inherits from the resolver: `current_date` on the database server, half-open end. Copy saying a seat "ends on" a date must match that.
5. `deriveDeaconsByOrgUnit` / `DeaconCard`: decide how an archived district is shown. Recommendation: keep showing the open deacon, labelled "archived district".

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 2 — Architectural review | architect | Complete; Q1 seat routed through the resolver (DECISION-242); DB-level archive guard (DECISION-243); placement and single count (DECISION-244); overwrite + audit and concurrency (DECISION-245); R1 seat-key guards, R2 revoke `DELETE`; F258–F264 | Approved with suggestions | 2026-10-25 |

**Handoff:** next is **tech-lead (Phase 3)**. Design to DECISIONS 242–245 and to R1 and R2, which are required. The S items are Phase 3's to accept or decline with a note. Recommended implementer split: **database-admin** for 0068 and the `test-rls.sql`/seed changes, then **full-stack-developer** for `src/lib/parishes.ts`, the actions and the pages. No route-group change and no new dependency.

**Files read** (paths in the `presby-parish` worktree unless noted):
- `/Users/cshenso/git/presby-platform/presby-parish/docs/work-log/2026-10-25-parish-management.md`
- `/Users/cshenso/git/presby-platform/presby-parish/docs/decisions.md` (DECISION-078, 079, 202–205, 229)
- `/Users/cshenso/git/presby-platform/presby-parish/docs/TODO.md` (lines 52, 236, 380)
- `/Users/cshenso/git/presby-platform/presby-parish/src/lib/db/domain/officers.ts`, `groups.ts`, `org.ts`
- `/Users/cshenso/git/presby-platform/presby-parish/src/lib/authz.ts`, `directory.ts`, `officers.ts`, `officer-offices.ts`, `org-provisioning.ts`, `role-grants.ts`, `role-definitions.ts`, `org-features.ts`, `audit.ts`, `audit-tx.ts`
- `/Users/cshenso/git/presby-platform/presby-parish/src/lib/onboarding/founding-administrator.ts`
- `/Users/cshenso/git/presby-platform/presby-parish/drizzle/0010_presby_resolver.sql`, `0017_presby_membership_roster.sql`, `0055_presby_giving.sql` (role-binding guard), `0059_presby_account_invitations.sql`, `0062_presby_session_approval.sql`
- `/Users/cshenso/git/presby-platform/presby-parish/src/app/(org)/o/[slug]/directory/parishes/page.tsx`, `directory/directory-nav.tsx`, `admin/layout.tsx`, `admin/officers/add-officer-term-form.tsx`
- `/Users/cshenso/git/presby-platform/presby-parish/scripts/test-rls.sql` (lines 1082–1155)
- `/Users/cshenso/git/presby-platform/presby-parish/docs/ui-standards.md` (Select patterns, HydrationGate)
- **Live catalog**, read-only, on the `development` branch through `/Users/cshenso/git/presby-platform/presby/.env.local`, because the parish worktree has no `.env.local` yet: `pg_class` RLS flags, `pg_policies`, `aclexplode(relacl)`, `pg_trigger`, `pg_constraint`, `pg_index`, `pg_roles.rolbypassrls`, `feature_flags`. No writes.

---

# Phase 3 — Technical Design (tech-lead)

**Date:** 2026-10-25 · **Designed to:** DECISION-242 to 245 (proposed text finalised at the end of this section), required R1 and R2, F258 to F264 (plus F265 raised here) · **Numbers:** migration 0068, dev port 3510 · **Live tree read:** `ce661d7` (`main`), worktree `presby-parish`.

## Summary

Give a congregation a way to define deacon districts, put every household in one, and find the households that are in none. The Moderator of the Board of Deacons does the assigning, and the authority comes from a dated seat recorded in Officers, not from a grant to a named person. A new office, `deacons_moderator`, fills a new derived `roster` group. A protected baseline role of the same key carries one seat-only permission, `parishes.assign`, so the existing resolver answers "may this person assign households" with its half-open date rule and its `explainPermission()` provenance. Administrators with `people.manage` can assign too, and `officers.manage` defines districts. Migration 0068 adds `org_units.archived_at`, a `unit_type` vocabulary CHECK, an active-name unique index, a household index, a trigger that refuses a move into an archived or campus district (with `FOR SHARE`, which is what closes the archive race), the seat-only key and its guards on every grant path, the new office and group and role, and the `DELETE` revoke on `org_units`. One library module, `src/lib/parishes.ts`, is the only writer of `org_units` and `households.org_unit_id`. Pages and actions live under `directory/parishes/*`. The feature is off until a per-org toggle, `org_portal.parishes`, is turned on.

### Phase 3 rulings on Phase 1 and Phase 2 open items

| # | Ruling | Why |
|---|---|---|
| P3-1 | A row picker is a native `<select>` plus an explicit **Move** or **Assign** button. It does not commit on selection. This amends analyst Q6/G12 ("commit on selection"); the 10-second Undo stays. | F261: arrow keys on a closed select fire `change` per keypress on Windows desktop browsers. An uncontrolled select read by a ref on click, inside `HydrationGate`, has no F116/F124 divergence either. |
| P3-2 | `getParishRoster()` **moves** out of `directory.ts` into `parishes.ts` (as `getParishesOverview`). `directory.ts` exports two leaf helpers, `deriveDeaconsByOrgUnit` and the `directory_hidden` SQL expression, and imports nothing from `parishes.ts`. | Phase 2 said the roster stays in `directory.ts` and calls `parishes.ts`. `parishes.ts` must also import from `directory.ts` (the hidden predicate, the deacon derivation), which would be a cycle. Moving the roster keeps the architect's intent (one gate, one count, `directory.ts` does not grow; it shrinks). Architect to note on the record. |
| P3-3 | `getParishAuthority` returns five booleans, not four: `canDefine`, `canMove`, `canListHouseholds`, `canReadRoster`, `seesHiddenNames`. `canListHouseholds` is `canMove \|\| directory.view_hidden`. | A viewer who holds only `officers.manage` (a custom role) needs the district counts to manage districts, but is not given household rows. Least privilege. |
| P3-4 | **S1 declined** (relabel `moderator` as "Moderator of Session"). | `OFFICE_LABELS` is also the source of the **public** site's staff directory text (`src/lib/sites.ts:1778`, "one place" ruling). A relabel would change a public string on a customer site that is mid-cutover. The new label already contains "Board of Deacons", so the two cannot be confused in the dropdown. Tracked in TODO. |
| P3-5 | **Copy correction to Phase 1.** "No deacon yet" and "Every household has a deacon" are replaced by "No district yet" and "Every household is in a district". | The Unassigned query reads `households.org_unit_id`. It does not read deacon terms, so a household in a district whose deacon seat is vacant also has no deacon. The Phase 1 strings overclaimed (Copy check 2). No F-number assigned (F265 is used below); the orchestrator may assign F266. |
| P3-6 | 0068 adds a `org_units_name_shape` CHECK (trimmed, NFC-normalized, 1 to 80 characters). | The library normalizes; the database keeps what the unique index relies on. Control and zero-width stripping stays application-level. |
| P3-7 | The role/permission/grant backfill is a `DO` loop of separate statements, not the 0062 data-modifying CTE. | A `BEFORE INSERT` guard on `app_role_permissions` reads the new `app_roles` row. Inside one CTE statement the sibling insert is invisible to it, so the guard would refuse the backfill. |
| P3-8 | The seat-only key set is one SQL function, `presby_seat_key_group(text)`, mapping a key to the derived group that may carry it. Only `parishes.assign` is in it. | One place for the guards to read, and the F260 follow-up (`roll.approve` on `session_member`) is a one-row extension later. It is **not** added now: existing templates and the dev fixture put `roll.approve` on other roles (F190). |
| P3-9 | **F265 (new).** `deriveDeaconsByOrgUnit` uses `ot.ends_on is null`, so a deacon whose term has a future end date is dropped, and a term that has not started yet is counted. Everything else (resolver, `presby_officer_roster`, the new guard, the archive dialog) uses `starts_on <= current_date and (ends_on is null or ends_on > current_date)`. It is corrected to the half-open rule. | Two definitions of "the district's Deacon" is the G5 defect in miniature. The archive dialog and the bulk dialog both name the deacon from this function. |
| P3-10 | The Parishes **count** changes for existing viewers: it is now every household in the district, not only those with a directory-visible member. Stated in the release note. | G5/DECISION-244. The old count could not equal the number of rows a bulk move writes. |
| P3-11 | A household with no living, current person and no district is not reachable from any surface in this pipeline (not listed in Unassigned by G8, and the household detail page returns not-found for a household with no visible member). This declines the analyst's "can be assigned from their household page". **Operator to confirm** (low impact; such households are dormant). | Building a household-page control would not reach them either. |

## Permissions & Flags

- **New permission key:** `parishes.assign` (module `parishes`, tier 1, `requires_two_factor` default false). **Seat-only:** it can sit only on the protected constitutional role `deacons_moderator`, and that role can be granted only through the group arm to the derived group `deacons_moderator`.
- **Bindings:**
  - Role `deacons_moderator` ("Moderator of the Board of Deacons", `role_kind = 'constitutional'`, `is_protected = true`) carries exactly `parishes.assign`.
  - A group-arm `role_grants` row binds it to the derived group `deacons_moderator` ("Board of Deacons Moderator", group type `roster`, protected, derived).
  - Seeded by `groupSeedPlan()` and `baselineRoleSeedPlan("congregation")` for new congregations; backfilled by 0068 for existing ones. No other bindings.
- **Existing keys used:**
  - `people.manage` (founding administrator) moves households. `officers.manage` defines, renames, archives and restores districts. `directory.view_hidden` widens read as today.
  - `presby_founding_administrator_permission_keys` and its pinned-equal test are **untouched**. `src/lib/permissions.ts` (frozen) is untouched.
- **Authority matrix** (one query, `getParishAuthority(tx, personId, orgId)`):

  | Boolean | Definition |
  |---|---|
  | `canDefine` | `officers.manage` |
  | `canMove` | `parishes.assign` or `people.manage` |
  | `canListHouseholds` | `canMove` or `directory.view_hidden` |
  | `canReadRoster` | `canListHouseholds` or `canDefine` |
  | `seesHiddenNames` | `people.manage` or `directory.view_hidden` |

  With the toggle off, `canReadRoster` and `seesHiddenNames` equal `directory.view_hidden` and the other three are false: today's behavior.
- **Flags:**
  - **No new platform flag** (operator rule).
  - One **per-org toggle**, `ORG_FEATURE_CATALOG` key `org_portal.parishes`: name "Parish management", category `people`, `flag: null`, `provisionedOn: false`, `orgTypes: ["congregation"]`, `operatorEnabled: false` (a congregation's `org_features.manage` holder turns it on; the founding administrator holds that key). `flag: null` means call sites skip the platform step.
  - **Inherited platform flags** the whole `directory/*` subtree already sits behind: `org_portal.directory` and `org_portal.directory_v2` (see the pre-ship item).
- **Gate order**, every page and every action: auth, `resolveOrgContext` and `assertOrgAccess`, platform directory flags (pages only), the `org_portal.parishes` toggle, authority, ids validated and scoped, household or district state last. Toggle and authority are checked inside the same `withOrgContext` transaction as the write, every call, never from a session claim.
- **Action refusal oracle:** an action returns the same "You don't have permission to do that." whether the toggle is off or authority is missing. A page shows "isn't turned on" to a member who deep-links while the toggle is off. That is an org setting visible to any org member, and is accepted.
- **Platform admin:** confers nothing. The e2e proves a platform-admin fixture with no seat is refused, then is allowed the request after a seat is recorded.

## API Contract

### Library: `src/lib/parishes-pure.ts` (no `server-only`; the client and the tests import it)

`PARISHES_FEATURE_KEY`, `PARISH_ASSIGN_KEY`, `SEAT_ONLY_PERMISSION_KEYS = ["parishes.assign"]` (pinned equal to `presby_seat_key_group` by a source-scan test), `MANAGEABLE_UNIT_TYPES = ["district","parish"]`, `BULK_MOVE_MAX = 100`, `DISTRICT_NAME_MAX = 80`, `UNASSIGNED_PAGE_SIZE = 25`, `UNDO_WINDOW_MS = 10_000`, `UNASSIGNED_GROUPS = ["members","participants","visitors","others"]`.

- `normalizeDistrictName(raw): {ok:true,name} | {ok:false,reason:"empty"|"too_long"}`: trim, NFC, strip control and zero-width characters (U+0000 to U+001F, U+007F to U+009F, U+200B to U+200D, U+2060, U+FEFF), collapse inner whitespace runs, length 1 to 80 after cleaning.
- `parseHide(raw): Set<UnassignedGroup>`: allowlist parse of `?hide=a,b`; unknown tokens ignored.
- `bucketForConnections(connections: Connection[]): UnassignedGroup`: first match wins (any `member`, else any `participant`, else any `visitor`, else `others`).

### Library: `src/lib/parishes.ts` (`server-only`; the ONLY writer of `org_units` and `households.org_unit_id`)

Every exported function opens one `withOrgContext` transaction, reads `isCategoryAxisOn()` before it, and runs the toggle (`orgFeatureEnabledInTx`) then `getParishAuthority` first inside it. Every mutator writes its audit row(s) with `insertAuditRow` in the same transaction. Throws are reserved for genuine failure (`OrgAccessError`, a database failure); every expected outcome is a typed result.

```ts
type ParishAuthority = { canDefine; canMove; canListHouseholds; canReadRoster; seesHiddenNames: boolean };
getParishAuthority(tx, personId, organizationId): Promise<ParishAuthority>      // ONE query, four keys
canReadParishRoster(personId, organizationId): Promise<boolean>               // for the Parishes tab
```

| Function | Returns (`kind`) | Notes |
|---|---|---|
| `getParishesOverview(personId, orgId)` | `ok{managed, authority, districts[], archived[], unassignedCount, seatFilled}` · `forbidden` | Replaces `getParishRoster`. `managed=false` (toggle off): gate is `directory.view_hidden` alone, read-only, no links. Lists `district` and `parish` units only. `unassignedCount` is the Unassigned definition below. `seatFilled`: an open `deacons_moderator` term as of `current_date` whose holder has an active membership. Only computed for `canDefine`. |
| `getDistrictPage(personId, orgId, orgUnitId, {page})` | `ok{district, authority, households[], total, activeTargets[]}` · `off` · `forbidden` · `not_found` | `not_found` for a bad uuid, another org's id, a nonexistent id, or a campus. Households in the district, name-ordered, 25 per page, masked. |
| `getUnassignedPage(personId, orgId, {hide, page})` | `ok{counts{members,participants,visitors,others}, households[], totalShown, activeTargets[], authority}` · `off` · `forbidden` | Counts are over all four groups regardless of `hide`. |
| `defineDistrict(personId, orgId, actor, {name})` | `ok{orgUnitId}` · `off` · `forbidden` · `invalid_input{reason}` · `name_taken` | Creates `unit_type = 'district'`. |
| `renameDistrict(..., {orgUnitId, name})` | as above plus `not_found` · `wrong_state` | Active manageable units only. |
| `archiveDistrict(..., {orgUnitId})` | `ok{householdCount, openDeaconName}` · `off` · `forbidden` · `not_found` · `wrong_state` | `update ... set archived_at = now() where archived_at is null`. |
| `restoreDistrict(..., {orgUnitId})` | `ok` · ... · `wrong_state` · `name_taken` | Collision on the active-name index maps to `name_taken`. |
| `moveHousehold(..., {householdId, expectedOrgUnitId: string\|null, targetOrgUnitId: string\|null, undo?})` | `ok{changed, fromName, toName, fromOrgUnitId, toOrgUnitId}` · `off` · `forbidden` · `not_found` · `conflict` · `target_unavailable{reason:"archived"\|"campus"}` | See concurrency below. `target = null` clears. |
| `bulkMoveHouseholds(..., {sourceOrgUnitId, targetOrgUnitId, expectedCount})` | `ok{moved, skipped, toName}` · `off` · `forbidden` · `not_found` · `source_not_archived` · `same_unit` · `target_unavailable` · `too_many` · `count_changed` | **No household ids in the request.** |

**Concurrency and ordering (DECISION-245).**

- *Lock order, every writer:* `org_units` rows first (`FOR SHARE`, sorted by id), then `households` rows (`FOR UPDATE`, sorted by id).
- *Single move:*
  1. Validate the uuids.
  2. Lock the target district `FOR SHARE`, scoped to the org.
  3. `update households set org_unit_id = $target where id = $h and organization_id = $org and org_unit_id is not distinct from $expected returning`.
  4. Zero rows: read the current value. If it already equals `$target`, return `ok{changed:false}` with no audit row (this also makes a double-click a quiet no-op). Otherwise `conflict`.
  5. The trigger refuses an archived or campus target. The library maps it by constraint name (`org_unit_target_archived`, `org_unit_target_campus`) to `target_unavailable`, and a missing target to `not_found`.
  6. Audit row `tenant.household.district_changed` only when a row changed.
- *Undo* is the same function with `expected = just-assigned`, `target = previous`, `undo: true`. It is refused by the same trigger if the previous district has been archived since.
- *Bulk:*
  1. Lock source and target `FOR SHARE`, sorted by id, then lock the source's households `FOR UPDATE`, sorted by id.
  2. Check the source is archived, the target is active, same org, source differs from target, and the current count is at most 100.
  3. If the current count exceeds `expectedCount`, return `count_changed` (a restore and re-archive happened in between).
  4. `moved = current count`, `skipped = expectedCount - moved`. One `UPDATE`, one `district_changed` row per household, one `district_bulk_moved` row. A bulk that moves zero writes nothing.
  5. The 101-row audit insert is one multi-row insert (`insertAuditRows`, a new batch variant beside `insertAuditRow` in `audit-tx.ts`).
- A deadlock (`40P01`) or serialization failure (`40001`) maps to the "Nothing was changed" outcome. Unverified under load; pinned only for the ordering, see Edge Cases.

**Single household count (DECISION-244).** One helper, `countHouseholdsByUnit(tx, orgId, unitIds?)`: `select org_unit_id, count(*) from households where organization_id = $org and org_unit_id is not null [and org_unit_id = any($ids)] group by org_unit_id`. It feeds the overview badges, the district page header, the archive dialog, the bulk dialog and `expectedCount`. Nothing else counts households per district.

**Unassigned definition (G8).**

- *Households:* `households.org_unit_id is null` and at least one person with a current membership at this org (`memberships.ended_on is null`), not deceased (`people.date_of_death is null`) and not merged (`people.merged_into_id is null`).
- *Buckets:* each such person's connection is `deriveConnection({endedOn, endedReason, currentRoll, engagementStatus})` from `community-labels.ts` (no second copy of the vocabulary). `bucketForConnections` then assigns the household to exactly one bucket.
- *Compute:* in TypeScript over one query that returns one row per (household, person); counts come from the full set, the page slice from the `hide`-filtered set. Order: household name, then id.
- *Masking:* server-side in `parishes.ts`, never on the client. `seesHiddenNames` false and `coalesce(pp.directory_hidden, false)` true gives the display name "Private" with the connection badge kept. The hidden expression is exported from `directory.ts` (the same fragment `directoryEligibilityWhereSql` uses; a source-scan test forbids a second literal). **No contact, birthday, photo or address column is selected anywhere on these surfaces** (source-scan pinned).

### Server actions (each route's own `actions.ts`, `'use server'`, `auth()` directly, `resolveActingIdentity(slug)` from a shared non-action helper `directory/parishes/acting-identity.ts`)

All return `ActionResult<T>`; `organizationId` is never client input. Each action revalidates `/o/${slug}/directory/parishes` (layout scope) after a change.

| File | Action | Input | Calls |
|---|---|---|---|
| `directory/parishes/actions.ts` | `defineDistrictAction(slug, {name})`, `renameDistrictAction(slug, {orgUnitId, name})`, `archiveDistrictAction(slug, {orgUnitId})`, `restoreDistrictAction(slug, {orgUnitId})` | validated by a shared zod schema in `parishes-pure.ts` | `defineDistrict`, `renameDistrict`, `archiveDistrict`, `restoreDistrict` |
| `directory/parishes/[orgUnitId]/actions.ts` | `moveHouseholdAction(slug, {householdId, expectedOrgUnitId, targetOrgUnitId, undo?})`, `bulkMoveAction(slug, {sourceOrgUnitId, targetOrgUnitId, expectedCount})` | `isUuid` before any call; `expectedCount` an integer 1 to 100 | `moveHousehold`, `bulkMoveHouseholds` |
| `directory/parishes/unassigned/actions.ts` | `assignHouseholdAction(slug, {householdId, expectedOrgUnitId, targetOrgUnitId, undo?})` (same schema as `moveHouseholdAction`; a first assignment passes `expectedOrgUnitId: null`, and Undo passes the assigned district as expected and `null` as target) | same schema | `moveHousehold` |

Error mapping is one `describeParishFailure(result)` function with an exhaustive switch (a new kind without copy is a type error), copy in the Copy table.

### Other library edits

- `officers.ts`: `requiredDerivedGroup` maps `deacons_moderator` to the `deacons_moderator` group. `listOfficerRoster` adds the office to its `all_offices` list, extends `selfRecorded` to `isAuthorityOffice`, and returns `orgUnitArchived`. `getOfficerFormOptions` lists only `archived_at is null` units of `district`/`parish` type and returns `parishesEnabled`. `startOfficerTerm` refuses an archived or campus district with a new result `district_unavailable` (the trigger is the backstop). `OfficersResult` gains that kind; `describeOfficersFailure` gains its copy.
- `officer-offices.ts`: `OFFICER_OFFICES` adds `deacons_moderator` (after `deacon`); `OFFICE_LABELS.deacons_moderator`; `AUTHORITY_OFFICES = [...SESSION_OFFICES, "deacons_moderator"]` and `isAuthorityOffice()` (F264). `SESSION_OFFICES` and `PASTOR_OFFICES` unchanged.
- `role-grants.ts`: `grantRole` returns a new kind `seat_only_role` for any role carrying a seat-only key, whatever the grantee (the one legitimate group-arm grant is made by provisioning and the backfill, never by `grantRole`). `role-definitions.ts`: `createRole`, `setRolePermissions` and `adoptTemplate` return `seat_only_key` for a proposed set containing one; `listPermissionCatalog()` omits seat-only keys (both callers are editors). The role actions map both kinds to copy.
- `org-provisioning.ts`: `groupSeedPlan` adds `Board of Deacons Moderator` (`roster`, `deacons_moderator`) for congregations; `baselineRoleSeedPlan` adds `deacons_moderator` bound to it; the return-type unions widen.
- `groups.ts`: `DerivedFromKey` adds `deacons_moderator` (the Automatic rosters list shows it, linked to Officers).
- `org-features.ts`: the catalog entry above.
- `directory.ts`: remove `getParishRoster` and its types; export `deriveDeaconsByOrgUnit` and the hidden expression; F265 predicate fix.
- `audit.ts` and `audit.test.ts`: six keys. `audit-tx.ts`: `insertAuditRows(tx, rows[])`.

| Key | Value | `resourceType` | Metadata (no names of households or people) |
|---|---|---|---|
| `DISTRICT_CREATED` | `tenant.district.created` | `org_unit` | `{organizationId, name}` |
| `DISTRICT_RENAMED` | `tenant.district.renamed` | `org_unit` | `{organizationId, from, to}` (district names) |
| `DISTRICT_ARCHIVED` | `tenant.district.archived` | `org_unit` | `{organizationId, householdCount, hadOpenDeacon}` |
| `DISTRICT_RESTORED` | `tenant.district.restored` | `org_unit` | `{organizationId}` |
| `HOUSEHOLD_DISTRICT_CHANGED` | `tenant.household.district_changed` | `household` | `{organizationId, fromOrgUnitId, toOrgUnitId, viaSeat, undo?, batchId?}` (`viaSeat`: the actor holds `parishes.assign`; additive to the Phase 2 list) |
| `HOUSEHOLD_DISTRICT_BULK_MOVED` | `tenant.household.district_bulk_moved` | `org_unit` (the source) | `{organizationId, batchId, toOrgUnitId, movedCount, skippedCount}` |

Recording or ending the seat reuses `tenant.officer_term.started` and `.ended`; their metadata already carries `selfRecorded`.

## Data Model

### Migration `drizzle/0068_presby_parishes.sql`

Hand-written, idempotent (applied twice on the Neon branch before Batch A closes), owner-applied: `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0068_presby_parishes.sql`. The `_journal.json` entry is added at integration (Rule 16). Strict order inside the file:

1. **Preconditions (stop-blocks, counts only, never a name).** Each raises `check_violation` with the count.
   - `org_units` rows whose `unit_type` is outside `('parish','campus','district')`.
   - Rows violating the name shape (`name <> btrim(name)`, not NFC-normalized, or length outside 1 to 80).
   - `(organization_id, lower(name))` groups with more than one row (all pre-existing rows are active).
   - `households` pointing at a `campus`, and open deacon terms (`ends_on is null or ends_on > current_date`) pointing at a `campus`.
   - Any congregation exists and the global group type `roster` is missing.
   - Not a stop-block: an org-owned `app_roles` row with key `deacons_moderator` that is not constitutional and protected. The backfill skips that org and `raise notice`s the count (0052 note 5: a tenant-held role is never modified).
2. **`org_units`.** `add column if not exists archived_at timestamptz`. Drop-then-add `org_units_unit_type_check` (`unit_type in ('parish','campus','district')`) and `org_units_name_shape` (`name = btrim(name) and name is nfc normalized and char_length(name) between 1 and 80`; database-admin confirms `show server_version_num >= 130000` on the branch). `create unique index if not exists org_units_active_name_idx on org_units (organization_id, lower(name)) where archived_at is null`. Column and constraint comments.
3. **`households` index (F263).** `create index if not exists households_org_unit_idx on households (organization_id, org_unit_id)`.
4. **Permission catalog.** `insert into permissions (key, module, description, sensitivity_tier) values ('parishes.assign', 'parishes', 'Assign households to deacon districts (held through the Moderator of the Board of Deacons seat)', 1) on conflict (key) do nothing`.
5. **Seat-key map.** `presby_seat_key_group(p_key text) returns text language sql immutable security definer set search_path = public, pg_temp`: `parishes.assign` to `'deacons_moderator'`, else `null`. `revoke all ... from public, presby_app, presby_platform`.
6. **Org-unit target guard (F259, DECISION-243).** `presby_guard_org_unit_target()`, **invoker**, `set search_path = public, pg_temp`:
   - `BEFORE INSERT OR UPDATE OF org_unit_id` on `households` (trigger `households_org_unit_target_guard`).
   - `BEFORE INSERT OR UPDATE OF org_unit_id, ends_on` on `officer_terms` (trigger `officer_terms_org_unit_target_guard`).
   - Logic:
     - Return `new` when `new.org_unit_id is null`.
     - `officer_terms` branch: return `new` unless the new row is open (`new.ends_on is null or new.ends_on > current_date`); on `UPDATE`, also return `new` if the old row was open and `org_unit_id` is unchanged. This is what lets a term be ended, shortened or left alone in an archived district while refusing a new or re-opened one.
     - `households` branch: on `UPDATE`, return `new` if `org_unit_id` is unchanged.
     - Then `select unit_type, archived_at into v from org_units where id = new.org_unit_id and organization_id = new.organization_id for share`. Not found raises `foreign_key_violation` with `constraint = 'org_unit_target_missing'`. `archived_at is not null` raises `check_violation` with `constraint = 'org_unit_target_archived'`. `unit_type = 'campus'` raises `check_violation` with `constraint = 'org_unit_target_campus'`.
   - `FOR SHARE` is the point: the composite FK check takes only `FOR KEY SHARE`, which an archive's `UPDATE` does not conflict with. `revoke all ... from public, presby_app, presby_platform`.
7. **Seat-only guards (R1, F260).** All `SECURITY DEFINER`, `set search_path = public, pg_temp`, explicit predicates (the role belongs to a different org than a commission or delegation row, and `app_role_permissions` is tenant-RLS'd, F26). Modelled on `app_role_permissions_giving_guard` and `presby_giving_guard_downward_role` (0055); 0055 is not edited.
   - *Binding:* `BEFORE INSERT OR UPDATE` on `app_role_permissions`. If `presby_seat_key_group(new.permission_key)` is not null, the role must be org-owned, `is_protected`, `role_kind = 'constitutional'`, and its `key` must equal that group key. Otherwise `insufficient_privilege`.
   - *Grant:* `BEFORE INSERT OR UPDATE OF role_id, person_id, group_id` on `role_grants`. If the role carries a seat-only key, `group_id` must be non-null and name a group of `new.organization_id` with `derived_from` equal to that key's group. A person-arm grant, or a group arm to any other group, is refused. Ending a grant (`ends_on`) is not blocked.
   - *Commission and delegation:* `BEFORE INSERT OR UPDATE OF role_id` on `administrative_commissions` and `org_delegations`. A role carrying any seat-only key is refused.
8. **Vocabulary and derived group (DECISION-242).**
   - `create or replace function presby_sync_derived_group()` is 0062's body plus the arm `when 'deacons_moderator' then 'deacons_moderator'`. The signature, language, security mode and missing-group error text are unchanged; the `-> 'session'` arms are untouched.
   - Drop-then-add `officer_terms_office_allowed` in the exact textual shape `officer-offices.test.ts` regex-reads: `check (office in ('ruling_elder', 'installed_pastor', 'co_pastor', 'associate_pastor', 'deacon', 'deacons_moderator', 'clerk_of_session', 'moderator', 'treasurer', 'trustee'))`.
   - Backfill the derived group: `insert into groups (organization_id, group_type_id, name, membership_source, derived_from, is_protected) select o.id, gt.id, 'Board of Deacons Moderator', 'derived', 'deacons_moderator', true from organizations o join group_types gt on gt.key = 'roster' where o.organization_type = 'congregation' on conflict (organization_id, derived_from) do nothing`.
   - No existing term holds the new office, so no re-materialising touch is needed and no existing row gains authority.
9. **Baseline role backfill (0062 section 7 idiom, P3-7).** A `DO` loop over congregations that have the group and no org-owned `deacons_moderator` role: insert the role (`'Moderator of the Board of Deacons'`, constitutional, protected), then its single permission, then the group-arm `role_grants` row (`starts_on = current_date`, `granted_by null`, informational `grant_reason`). Separate statements, so the section-7 guards see each other's rows. The role KEY is the discriminator, never `grant_reason`. An empty group grants nothing, so this provisions and does not grant.
10. **Privileges (R2, F258).** `revoke delete on org_units from presby_app; revoke delete on org_units from presby_platform;`. Owner-path guard `presby_org_units_guard_delete()` (`BEFORE DELETE`, invoker, the `presby_org_domains_guard_delete` idiom): allowed only when the parent `organizations` row is already gone (the fixture-teardown cascade), otherwise `insufficient_privilege` "districts are permanent; archive them instead".
11. **Comments** on the column, constraints, index, functions and triggers, including the accepted consequence: `households.org_unit_id` now means "deacon district" only, and a future campus dimension needs its own column.

**Rollback (documented in the file header, rehearsed on the branch):** drop the six triggers and four guard functions, drop `presby_seat_key_group`, drop the two new constraints and the index, re-add the 0062 office CHECK, restore the 0062 `presby_sync_derived_group` body, `grant delete on org_units to presby_app`, `delete` the `parishes.assign` permission row only after removing its role. Data (groups, roles, `archived_at`) is left in place.

**Drizzle mirrors (Batch A, `check:schema-parity` covers columns, nullability and FKs only):**
- `src/lib/db/domain/org.ts` `orgUnits`: `archivedAt` timestamp (nullable), the two CHECKs, the partial unique index on `(organization_id, lower(name))`.
- `src/lib/db/domain/people.ts` `households`: `households_org_unit_idx`.
- `src/lib/db/domain/officers.ts`: the widened `officer_terms_office_allowed` check and the comment block.

No new table, so `src/lib/db/domain/index.ts` is untouched. No new foreign key: both guard lookups use `(org_unit_id, organization_id)`, the tenant column on `households` and `officer_terms`; the seat guards use `new.organization_id` on `role_grants` and the role's own `organization_id`.

## Component / Page Plan

All under `src/app/(org)/o/[slug]/directory/parishes/` unless stated. Server Components by default; client islands are marked.

**Create**
- `acting-identity.ts` (shared helper for the three `actions.ts`, not itself `'use server'`).
- `parishes-states.tsx`: `ParishesOff` (toggle off), `ParishesForbidden`, `ParishesLoadError`, `NoDistrictsPanel`, `SeatCallout`.
- `add-district-form.tsx` (**client**, `useForm` + `HydrationGate`) and `district-card-controls.tsx` (**client**: Rename `Dialog` with a gated `useForm`, Archive `AlertDialog`, Restore button).
- `[orgUnitId]/page.tsx`, `[orgUnitId]/actions.ts`, `[orgUnitId]/archived-notice.tsx`, `[orgUnitId]/bulk-move.tsx` (**client**: step 1 `Dialog` with a native select and Continue, step 2 `AlertDialog` confirm).
- `household-row.tsx` (Server: name, masked person lines with `CONNECTION_LABELS` badges, `break-words`) and `row-assign.tsx` (**client**: `HydrationGate` fieldset around a native `<select>` read by a ref, plus the Move/Assign button; `sonner` toast with an Undo action for 10 seconds; per-row in-flight and inline error; **no `onChange` handler anywhere**, source-scan pinned).
- `unassigned/page.tsx`, `unassigned/actions.ts`, `unassigned/group-toggles.tsx` (Server: links, `?hide=`), reuses `components/shared/pagination.tsx`.

**Modify**
- `parishes/page.tsx` (existing): becomes the managed overview. `parish-roster.tsx` (one component, two modes: legacy read-only and managed with links, archived badge, controls). Its two stale header comments are rewritten.
- `directory/page.tsx` (two `DirectoryNav` calls) and `directory/parishes/page.tsx`: `showParishes = canViewHidden || await canReadParishRoster(...)`; `directory-nav.tsx` prop `canViewHidden` becomes `showParishes`. One extra short transaction on Directory loads for a viewer without `directory.view_hidden` (unverified impact).
- `admin/officers/page.tsx` (explainer sentence, section C7), `add-officer-term-form.tsx` (helper and self notes for the new office, the no-districts strings, `parishesEnabled`), `officer-roster.tsx` (`Self-recorded` badge via `isAuthorityOffice`; archived label in the District column), `office-labels.ts` (re-export).
- Roles actions that call `grantRole`, `createRole`, `setRolePermissions`, `adoptTemplate` (grep `admin/roles/**/actions.ts`): map the two new kinds.
- Library and schema files listed under Other library edits.

**Not created:** no tile (the Directory tile and the Parishes tab are the entry), no `admin/` route, no new dependency, no shadcn `select`/`command`.

## Implementation Order

Phase 4 prerequisites the orchestrator owns (Rule 16), before Batch A: a Neon branch for this pipeline and an `.env.local` in the `presby-parish` worktree pointing at it (none exists); a person-id range for `e2e/support/parish-fixture.ts`; the dev server and every Playwright run on `E2E_BASE_URL=http://localhost:3510`, stopped by PID.

| Batch | Implementer | Content | Gate |
|---|---|---|---|
| **A** | **database-admin** | Migration 0068 in the order above; the three Drizzle mirrors; `src/lib/db/domain/parishes.db.test.ts`; staged `scripts/parishes/test-rls-68.sql`, `scripts/parishes/seed-dev-parishes.sql`, `scripts/parishes/test-rls.sql.integration.patch` | Applies twice cleanly; rollback rehearsed; db test green; `test-rls-68.sql` green as `presby_app`; `check:schema-parity` green; `npm run typecheck` |
| **B** | **full-stack-developer** | `parishes-pure.ts`, `parishes.ts`, `directory.ts` edits (F265), `officers.ts`, `officer-offices.ts`, `org-provisioning.ts`, `groups.ts`, `org-features.ts`, `role-grants.ts`, `role-definitions.ts`, `audit.ts` and `audit-tx.ts`; their tests; pinned existing tests updated | Library tests green (DB-backed, serial); `npm run check` zero violations; typecheck |
| **C** | **full-stack-developer** | Pages, actions, components, nav, Officers UI, roles action mapping; component and action tests; `e2e/parishes.spec.ts`, `e2e/hydration/parishes-controls.spec.ts`, `e2e/support/parish-fixture.ts`; the 360px and keyboard walk; `admin-organizations-create.spec.ts` updated | Unit green; build passes; e2e green on :3510 including the MFA seat holder; `npm run check`; no `console.log`, no native dialogs |

Within each batch: schema, then `FEATURE_CATALOG` entry and seed binding, then routes and actions, then UI, then audit events, then release notes. Release notes (`docs/release-notes/v0.43.0.md`, `package.json` to 0.43.0) are written by tech-lead after Phase 6 SHIP IT.

Then Phase 5 (qa), Phase 6 (analyst, with the founding-administrator walk at 360px on `development` that Phase 1 required: create a district, record the seat, move a household).

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here, or deferred (who accepted) |
|---|---|
| G1 no way to create a district | `defineDistrict`/`renameDistrict`/`archiveDistrict`/`restoreDistrict`; Add district form; Q5 Restore included. |
| G2 no archived state | 0068 `archived_at`, active-name index, target guard with `FOR SHARE`. Readers updated: `getOfficerFormOptions`, `startOfficerTerm`, overview, roster archived label. |
| G3 seat has no representation; no existing row may gain authority | DECISION-242 (office, derived group, baseline role, seat-only key). Test: rows holding `moderator`, `deacon`, an ended seat and a future seat grant nothing. |
| G4 first-day wall | `canReadRoster` and the nav `showParishes`; new surfaces gate on seat or `people.manage`, not `view_hidden`. |
| G5 counts disagree | `countHouseholdsByUnit`, one definition (P3-10). |
| G6 privacy of names | Server-side masking, `seesHiddenNames`, "Private", no contact fields. |
| G7 district types | `MANAGEABLE_UNIT_TYPES`; new units are `district`; trigger refuses `campus`. |
| G8 who counts as unassigned | Query and four buckets above. **Deferred, tech-lead, operator to confirm:** a household with no living current person is unreachable (P3-11). |
| G9 100 cap | `BULK_MOVE_MAX`, server `too_many`, UI message instead of the picker. TODO follow-up for a moderator who hits it. |
| G10 overwrite plus audit; no history view promised | DECISION-245. Copy promises no history view; the release note says plainly that congregations cannot read it yet. |
| G11 self-recorded authority, stated as `paper` | `AUTHORITY_OFFICES`, helper and self notes, CLAUDE.md sentence (operator approval, below). No string says "only the Moderator". |
| G12 confirmation model | Amended by P3-1 (explicit button); bulk has a confirm dialog and no Undo; Undo into an archived district is refused truthfully. |
| G13 concurrency | Expected-value conditional update; lock order; bulk by `{source, target, expectedCount}`. |
| G14 audit | Six keys, `insertAuditRow(s)` in the transaction; `check:audit` is vacuous on lib-delegating `actions.ts`, so `parishes-boundaries.test.ts` pins that every exported mutator in `parishes.ts` writes an `AUDIT_ACTIONS` row. |
| G15 2FA, load errors, 360px, empty states, existing-surface changes | e2e with the MFA-enrolled fixture; load-error panels; 360px specs; empty states in Copy; TODO line 380 closed by the district page. |
| Q1 to Q4, Q7 to Q11 | As the analyst defaults, amended by the architect: new office (Q1), no deacon coupling (Q2), admin tier `people.manage`/`officers.manage` (Q3), moderator cannot define (Q4), unique among active names (Q7), refuse over 100 plus TODO (Q8), mask (Q9), `district`+`parish` (Q10), `org_portal.parishes` (Q11). Q5 Restore included. Q6 amended (P3-1). |
| Phase 1 handoff: Phase 6 walk | Recorded under Implementation Order. |
| Phase 2 placement (everything under `directory/parishes/*`, nothing in `admin/`) | Followed. Deviation P3-2 (roster moves into `parishes.ts`) noted for the architect. |
| Phase 2 server/client split, F261 | Row picker, Undo, forms, dialogs as specified; toggles are server-rendered links. |
| Phase 2 inherited gates (`org_portal.directory`, `directory_v2`) and TODO line 236 | Pre-ship item below; this e2e satisfies TODO line 236. |
| DECISION-242 and R1 | Migration steps 5 to 9; typed refusals in `role-grants.ts`/`role-definitions.ts`. The `session_member`/`roll.approve` hole (F260) is **deferred** to a TODO line (architect). |
| DECISION-243 and R2 | Migration steps 2 to 3, 6, 10. F262 test-rls rewrite staged as a patch. |
| DECISION-244 | `parishes.ts`, `countHouseholdsByUnit`, masking, no return parameter (fixed back links only). |
| DECISION-245 | Concurrency section and the six audit keys. |
| F258 to F264 | F258/F262 migration step 10 and patch; F259 step 2; F260 step 7; F261 P3-1; F263 step 3; F264 `AUTHORITY_OFFICES`. |
| S1 | **Declined** (P3-4), reason recorded; TODO line. |
| S2 test-rls cases | `scripts/parishes/test-rls-68.sql`, staged (below). |
| S3 seed fixture | `scripts/parishes/seed-dev-parishes.sql`, staged (below). |
| S4 date semantics | `current_date` on the database server (UTC on Neon), half-open end; Copy never states a time. Pinned by the boundary tests. |
| S5 archived district and `DeaconCard` | Accepted as the recommendation: the open deacon keeps showing. The district page and overview carry the "Archived" label; a household card elsewhere shows the deacon of record until the household is moved. |
| CLAUDE.md sentence | Drafted below; **operator approval needed**; orchestrator adds at integration. |

## Edge Cases & Risks

Test tags: **DB** `src/lib/db/domain/parishes.db.test.ts`; **RLS** `scripts/parishes/test-rls-68.sql` (as `presby_app`); **LIB** `src/lib/parishes.test.ts`; **PURE** `src/lib/parishes-pure.test.ts`; **BND** `src/lib/parishes-boundaries.test.ts` (source scans); **ACT** the three `actions.test.ts`; **CMP** component tests; **E2E** `e2e/parishes.spec.ts`; **HYD** `e2e/hydration/parishes-controls.spec.ts`.

### Authority and the seat

- A seat grants nothing before its start date, grants on its start date, and stops on its end date (half-open, `current_date` on the database server): DB, RLS.
- A pre-existing `moderator` term, a `deacon` term, an ended seat and a future seat each leave `parishes.assign` out of `presby_effective_permissions`: DB, RLS.
- A seat in organization A grants nothing in B: RLS.
- `parishes.assign` cannot be bound to a custom, unprotected or template role, granted to a person, granted to any group but the seat group, or put on a commission or delegation role: DB, RLS, plus the typed refusals in `role-grants.test.ts` and `role-definitions.test.ts`.
- A seat holder whose membership has ended: `withOrgContext` throws `OrgAccessError`, which the existing error boundary handles, and the seat callout does not count that holder as filling the seat: LIB.
- A platform admin with no seat is refused; after a seat is recorded, the next request is allowed (read live): E2E.
- Self-recorded seat: audit metadata stamped, roster badge shown, the form shows the self note: `officers.test.ts`, `officer-roster.test.tsx`, CMP. The chain (revoke, self-addressed designation, seat) is `paper`, not prevented.
- A seat that ends mid-session fails the next write with the same refusal copy as any missing authority: LIB.
- The time-of-day boundary: a seat ending "today" in an Eastern evening ends at UTC midnight. Copy states dates only. Pinned for the database rule by RLS; the Eastern-evening reading is **unverified** in a browser.

### Moves

- Target archived, campus, in another organization, or nonexistent: archived and campus give `target_unavailable`; another organization's id and a nonexistent id give the same `not_found`: LIB, DB.
- Expected-value mismatch gives `conflict`; moving to the current district is a quiet no-op with no audit row; a double submit writes exactly one audit row: LIB (concurrent calls).
- Undo restores the previous value; Undo when the previous district has since been archived is refused with the truthful message; Undo of a clear returns the household to its district: LIB, CMP.
- A failed audit insert rolls the move back (`org_unit_id` unchanged): LIB (audit writer forced to throw).
- Archive racing a move into the district: whichever commits first wins and the other is refused or waits; no household ends up in an archived district through the move path: DB (two connections; **unverified under production load**).
- Lock-order deadlock between a single move, a bulk move and an archive: ordering is pinned by a source-scan of the lock statements in BND; a deadlock itself is **unverified** and maps to "Nothing was changed".
- Closing an existing deacon term in an archived district succeeds; a new or re-opened one is refused: DB, RLS.

### Bulk

- Over 100 gives `too_many` with no write and no truncation; the UI shows the message and no picker: LIB, CMP.
- `moved < expectedCount` reports `skipped`; `current > expectedCount` gives `count_changed`; a source that is not archived, a target that is archived, and source equal to target are each refused; a zero-row bulk writes no audit row: LIB.
- One audit row per household plus one batch row, all with one `batchId`, in one transaction: LIB.
- The bulk response and the toast carry counts only, never ids or names: ACT.

### Reads and privacy

- A directory-hidden person is "Private" to a seat holder without `people.manage` or `view_hidden`, named to one with either: LIB.
- No contact, birthday, photo or address column is selected on these surfaces: BND.
- Bucket precedence (member over participant over visitor over other), exclusive buckets, counts unaffected by `?hide=`, unknown `?hide=` tokens ignored: PURE, LIB.
- An empty list, a load failure and a hidden-everything state are three different panels and a database failure never reads as "no districts" or "no households": page tests.
- Unassigned performance at roughly 500 households: **unverified** (LIB runs a 600-household fixture without a timing assertion).

### Names and lifecycle

- Names are trimmed, NFC-normalized, stripped of control and zero-width characters, 1 to 80 characters, unique case-insensitively among active districts. Restoring into a taken name gives `name_taken`: PURE, LIB, DB (index and CHECK).
- A 5,000-character name is refused before the database; a very long district name wraps at 360px (`break-words`): PURE, and E2E at 360px with an 80-character name asserts no horizontal overflow.
- Rename or archive of an already-archived district, and restore of an active one, give `wrong_state`: LIB.

### UI and platform

- A native select never commits: arrow keys on the focused closed select change nothing and write nothing: E2E (keyboard), plus BND (no `onChange` in `row-assign.tsx`).
- Every control is inoperable until hydration: `check:hydration-gate` (the `useForm` roots), HYD (row picker, add-district, rename, bulk trigger, held JS chunks), persisted state asserted.
- 360px: row cards not tables, picker full width, 44px targets, wrapping toggle pills, stacked dialog buttons: E2E at 360px for the overview, district, Unassigned and both dialogs.
- Toggle off hides every new surface and refuses every action; the legacy roster read is unchanged; data is untouched: page tests, ACT.
- Feature-categories axis (`org_portal.feature_categories` on with `people` disabled) turns the toggle off through `orgFeatureEnabledInTx`: **unverified** here; inherited behavior pinned by the existing `org-features` tests.
- `DELETE` on `org_units` is refused for `presby_app` and `presby_platform`, and on the owner path except in the fixture-teardown cascade: DB, RLS.
- The F265 predicate fix: a deacon with a future end date shows, a term not yet started does not: `directory.test.ts`.

### E2E blast radius: existing specs and tests this change alters

| Existing | Change | Action |
|---|---|---|
| `e2e/admin-organizations-create.spec.ts:111` | Asserts a new congregation has exactly `Active Membership`, `Board of Deacons`, `Session`. It now also has `Board of Deacons Moderator`. | Update the expected list (sorted). No flag dependency. |
| `src/lib/officer-offices.test.ts` | Pins `OFFICER_OFFICES` to the `officer_terms_office_allowed` CHECK and `SESSION_OFFICES` to the CASE arms **in 0062**. 0068 re-creates both. | Re-point the CHECK pin and the CASE pin at 0068 (the CASE pin also asserts the new `deacons_moderator` arm). |
| `src/lib/org-provisioning.test.ts` | `groupSeedPlan` and `baselineRoleSeedPlan` shapes. | Update. |
| `src/lib/directory.test.ts` (DB-backed, `getParishRoster`) | The function moves and its count semantics change; the deacon derivation changes (F265). | Move those cases to `parishes.test.ts`; keep the derivation cases. |
| `directory/parishes/page.test.tsx`, `parish-roster.test.tsx`, `directory/page.test.tsx` | Gate, copy and nav prop change. | Update. |
| `add-officer-term-form.test.tsx:111-121`, `admin/officers/page.test.tsx`, `officer-roster.test.tsx`, `officers.test.ts`, `groups.test.ts`, `groups-list.test.tsx`, `my-groups.test.ts`, `audit.test.ts` | Strings, a new office, a fourth derived group, six audit keys. | Update. |
| `scripts/test-rls.sql:1150` and the count assertions at roughly `:1094` and the section 2 table counts | `DELETE` is revoked; the seed adds rows. | Staged patch (below). |
| `invitations.db.test.ts`, `designation-parity.db.test.ts` and `designation-parity.golden.json` | **Unverified.** They may snapshot a congregation made by `createOrganization()`, which now gains one group, one role, one permission and one grant. | Implementer greps `createOrganization(` and "Board of Deacons" in DB-backed tests at Batch B and fixes any snapshot. |
| `person-emails.spec.ts`, `portal-home-cards.spec.ts`, `portal-footer-sitemap.spec.ts` | They touch the directory and its flags. Grep finds no assertion on the Parishes tab. | Unaffected. |

**Flags each new or changed e2e spec depends on (set through `e2e/support/flags.ts`; none is added to `scripts/ci/e2e-baseline-flags.sql`):**
- `e2e/parishes.spec.ts`: `org_portal.directory`, `org_portal.directory_v2`, `org_portal.officers` (captured, set on, restored by SELECT-verified writes). The per-org toggle `org_portal.parishes` is a fixture row at the spec-owned congregation. `org_portal.feature_categories` is not touched.
- `e2e/hydration/parishes-controls.spec.ts`: `org_portal.directory`, `org_portal.directory_v2`, plus the toggle row.
- `e2e/admin-organizations-create.spec.ts`: no new flag.

**Fixture shape (follows `giving-fixture.ts` and `domains-ui-fixture.ts`):**
- `e2e/support/parish-fixture.ts` (new file) builds a throwaway congregation `e2e-parish-<stamp>` stamped `deletable_until`, with a membership for the `mfa-enrolled` user.
- It swaps that user between "administrator" (`people.manage`, `officers.manage`), "seat holder" (a real `deacons_moderator` term, no admin keys, no `view_hidden`) and "none", all read live.
- It seeds districts (one archived with households), a directory-hidden person, and a visitor household.
- It exports `sweepStaleParishFixtures(sql)`. The one-line call-in belongs in `e2e/support/global-setup.ts` (a Rule 16 shared file) and is staged as `scripts/parishes/global-setup.integration.patch`. Without it a lost teardown leaves a membership that changes the `mfa-enrolled` user's post-login landing for later specs (the custom-domains lesson).

**Risks.** (1) The migration replaces `presby_sync_derived_group()` and `officer_terms_office_allowed`. Phase 4 re-runs the feasibility check against the merged tree first: if any migration between 0064 and 0068 redefines either, rebase 0068's body on the newest definition. (2) Any migration landing between now and integration could take 0065 to 0067; none is applied in this worktree's neighbors today. (3) The Parishes count change (P3-10) is user-visible and is in the release note.

## Copy

Every string below is written here, not in Phase 4. An implementer who needs a string not listed stops for a ruling. `{x}` is a placeholder; plurals follow "1 household" / "N households".

**C1 Overview (managed mode)**
- Section heading "Districts". Button "Add district" (`canDefine` only).
- Empty, `canDefine`: "No districts yet. Add your first district to start assigning households."
- Empty, not `canDefine`: "No districts have been set up yet. Ask your congregation's administrator to add them."
- Card: "{name}"; "Deacon: {Person}" or "Deacon: Vacant"; badge "{N} households"; badge "Archived"; link "View households" (`canListHouseholds` only). Section heading "Archived districts".
- No-district card (hidden at zero; `canListHouseholds`): heading "No district yet"; "{N} households aren't in a district."; link "Review households".
- Seat callout (`canDefine` only, when no open seat): "No one is recorded in the Moderator seat for the Board of Deacons. Record it in Officers so the Moderator can assign households." (link text "Record it in Officers").
- Add district: label "District name"; help "Up to 80 characters."; button "Add district" / "Adding…"; toast "District added."; errors "Enter a name for the district.", "Use 80 characters or fewer.", "A district with that name already exists.", "We couldn't save that. Nothing was changed."
- Toggle-off legacy roster keeps "{org} has no districts or parishes set up yet." (unchanged).

**C2 Lifecycle**
- Rename: title "Rename district"; label "District name"; buttons "Cancel", "Save name"; toast "District renamed."; same field errors.
- Archive: title "Archive {name}?"; body "{N} households are still in it. They stay there until they are moved to another district. No households can be moved into an archived district. You can restore it later." (0: "No households are in it. You can restore it later."; 1: "1 household is still in it. It stays there until it is moved to another district. ..."); with an open deacon add "{Person} is still recorded as this district's Deacon. End that term in Officers if they have stepped down."; buttons "Cancel", "Archive district"; toast "{name} archived."
- Restore: button "Restore"; toast "{name} restored."; collision "Another district already uses that name. Rename that one first, or leave this one archived."
- State changed: "This district was just changed by someone else. We've refreshed the list."
- Refusal: "You don't have permission to do that."

**C3 District page**
- Back link "Back to Parishes". "Deacon: {Person}" / "Deacon: Vacant". "{N} households".
- Archived notice: "This district is archived. No households can be moved into it." plus, for `canMove` with N greater than 0, " Move households out one at a time, or all at once below."; with N equal to 0, " It has no households."
- Empty active district: "No households in this district yet." Household with no current person: "No one current is listed."
- Load failure: "We couldn't load the households. Try again." with a "Try again" link. Toggle off: "Parish management isn't turned on for {name} yet." No permission to list: "You don't have permission to view households by district. If you think this is a mistake, ask an administrator at {name}."

**C4 Row move and assign**
- Label "Move to" (district page) or "Assign to" (Unassigned). Placeholder option "Choose a district…". District page only: option "Remove from district". Buttons "Move" or "Assign"; in flight "Moving…" or "Assigning…".
- Toasts (each with **Undo**, 10 seconds): "Moved to {district}.", "Assigned to {district}.", "Removed from {district}." Undo results: "Undone.", "Can't undo: this household has been moved since.", "Can't undo: {district} is archived.", "Could not undo. Nothing was changed."
- Inline errors: "Choose a district first.", "This household was just moved by someone else. We've refreshed the list.", "That district was just archived. Choose another.", "You don't have permission to do that.", "We couldn't find that household. We've refreshed the list.", "Could not move the household. Nothing was changed."

**C5 Bulk move**
- Trigger "Move all {N} households to…". Step 1 dialog: title "Move {N} households", "Choose where {source}'s households should go.", label "Move to", buttons "Cancel", "Continue".
- Confirm: title "Move {N} households to {destination}?"; body "All {N} households in {source} will move to {destination}. {Person} is recorded as {destination}'s Deacon." or "No deacon is recorded for {destination} yet." then "{source} is archived, so households can't be moved back into it. This can't be undone in one step; households can be moved again one at a time."; buttons "Cancel", "Move {N} households".
- Success: "Moved {M} households to {destination}." plus " {K} had already been moved by someone else and were left alone." when K is above 0; M of 0: "No households were left to move."
- Instead of the trigger when N is above 100: "This district has more than 100 households, so move them in smaller groups with Move."
- Errors: "The households in this district changed while you were looking. We've refreshed the page. Check the count and try again.", "Only an archived district can be emptied this way.", "That district was just archived. Choose another.", "Could not move the households. Nothing was changed."

**C6 Unassigned page**
- Heading "Households with no district". Intro "Households with at least one living, current person that aren't in any district yet."
- Pills "Members ({n})", "Participants ({n})", "Visitors ({n})", "Others ({n})"; accessible names "Hide Members (27)" / "Show Members (27)". Hint "A household appears under the first group that fits: Members, then Participants, then Visitors, then Others. Others are households where everyone is only listed or on staff."
- All hidden: "Every group is hidden. Show a group to see its households." Zero: "Every household is in a district." with link "Back to Parishes".
- No active districts to assign to: "There are no districts to assign to yet." plus, for `canDefine`, link "Add a district"; otherwise "Ask your congregation's administrator to add them."
- Masked person: "Private".

**C7 Officers**
- Label: "Moderator of the Board of Deacons" (`moderator` stays "Moderator").
- Helper when this office is chosen: "The Moderator of the Board of Deacons can assign households to districts when Parish management is turned on and they have a PresbyPortal account. Administrators can assign households too. Record this only for the person the Board has chosen."
- Self note: "You're recording yourself as Moderator of the Board of Deacons. That's allowed, and the record will show it as self-recorded."
- Page explainer (replaces `admin/officers/page.tsx:163-166`): "This records who holds the office. Apart from seating the Session (see above) and the Moderator of the Board of Deacons, who can assign households to districts, recording someone here does not change what they can do in the app. Other access is granted under Administration → Roles."
- No districts, toggle on: "No districts exist at this organization yet. Add districts on the Parishes page, then record the deacon term." (link "Parishes page"). Toggle off: "Districts aren't turned on for this congregation yet. An administrator can turn on Parish management under Features."
- Archived district chosen: "That district is archived. Choose an active district." Roster District column: "{name} (archived)".

**C8 Role refusals:** "This role is held through the Moderator of the Board of Deacons seat, so it can't be granted here." and "That permission is held through a recorded seat and can't be added to a role."

**C9 Toggle:** name "Parish management"; description "Deacon districts for this congregation: set them up, put households in them, and let the Moderator of the Board of Deacons (once recorded as an officer) assign households. Administrators can assign too. Turning this off hides the pages and refuses changes; nothing already assigned is removed." Off panel: "Parish management isn't turned on for {name} yet."

**C10 Release-note lines (for the `/release-notes` skill):** "Congregations can set up deacon districts, put each household in one, and see which households aren't in a district yet." · "The Moderator of the Board of Deacons, once recorded under Officers, can assign households to districts. Administrators can too." · "It is off until Parish management is turned on under Features." · "The household count on the Parishes tab now counts every household in a district, not only those shown in the directory." · "A history of each move is kept, but congregations cannot read it in the app yet."

### The four checks, one line per group

| Group | Residuals | Source of truth | Audience | Neighbours made stale (file:line) |
|---|---|---|---|---|
| C1 | Nothing says only the Moderator can assign; the callout says "so the Moderator can assign", not "only". No Phase 2 ruling denied. | District, deacon, count: `org_units`, `deriveDeaconsByOrgUnit` (open term, F265), `countHouseholdsByUnit`. "No district yet": `households.org_unit_id is null` plus a living current person. Seat callout: open `deacons_moderator` term plus an active membership as of `current_date`. | Callout and Add: `canDefine` (`officers.manage`) can record a seat and add districts. Empty-state "ask an administrator": administrators hold `officers.manage`. | `parish-roster.tsx:40` kept for toggle-off; `parish-roster.tsx:1-35` and `parishes/page.tsx:15-37` doc comments rewritten (dead-end panels, `view_hidden` alone). |
| C2 | Archive copy does not claim households "need" a district or that anyone can move them; Undo of archive is Restore. | Count from the single helper; deacon from `deriveDeaconsByOrgUnit`; collision from the unique index. | Archive and Restore: `canDefine`. "End that term in Officers": `officers.manage`, same holder. No instruction to move households (that needs `canMove`). | none |
| C3 | Archived notice does not deny that administrators can move. | `archived_at`, count helper. | Move-out sentence is shown only to `canMove`. "Ask an administrator" in the forbidden panel: administrators grant `people.manage`. | `parish-roster.tsx` panels become links: header comment rewritten. |
| C4 | "Undo" never claims a history exists; no bulk Undo promised. | Names (`fromName`, `toName`) come from the result read inside the transaction. | `canMove` only (the control is not rendered otherwise; the action refuses regardless). | none |
| C5 | "can't be undone in one step; households can be moved again one at a time" is true (no bulk Undo, single moves allowed). | N from the count helper, equal to the rows written; M and K from the transaction; deacon from `deriveDeaconsByOrgUnit`, worded "is recorded as". | `canMove`; the archived source and trigger rules are enforced server-side. | none |
| C6 | Does not claim these are all districtless households (G8 definition is stated in the intro). | Intro and hint match the G8 query and `deriveConnection` precedence. "Private": `directory_hidden` and `seesHiddenNames`. | Add link: `canDefine`; otherwise "ask an administrator". | none |
| C7 | "Administrators can assign households too" states the `paper` admin tier; self note states self-recording is allowed (DECISION-205 family). | Toggle row, resolver (`parishes.assign`), `people.manage`. | Form audience is `officers.manage`; "an administrator can turn on" is `org_features.manage`, held by the founding administrator. | `admin/officers/page.tsx:163-166` (modified above); `add-officer-term-form.tsx:235-237` (modified above); `officer-roster.tsx:103` and `:129` District column (archived label); `session-note.tsx` unchanged and still true; `officers/actions.ts:142` still true for the new office; `groups-list.tsx` "Automatic rosters" copy still true and now lists the fourth group; `tiles.ts:254` still true; `statistics-submit-form.tsx:26` is a different vocabulary and is unchanged (S1 declined). |
| C8 | n/a | Role carries a seat-only key (database rule). | `role_grants.manage` and `roles.manage` holders; no instruction given. | none |
| C9 | Off panel says nothing about why. Description does not promise a history view or deny the admin tier. | Toggle row. | Any member (off panel); `org_features.manage` (description). | `org-features.ts` catalog is the only list; `directory-states.tsx:25-31` ("isn't available for {name} yet") is the directory flag, a different subject, unchanged. |
| C10 | States the count change and the unreadable history; does not deny the `paper` admin tier. | As above. | Release-note readers. | `docs/product/functionality-map.md` (ship time); `docs/TODO.md:52` and `:380` closed. |

## Staged for integration (Rule 16: never edited mid-pipeline)

- `scripts/parishes/test-rls-68.sql`: run as `presby_app`, standalone with `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/parishes/test-rls-68.sql` after `install-test-helpers.sql` and `seed-dev.sql`; at integration a `\ir parishes/test-rls-68.sql` line is appended. Cases (S2): archived target refused; campus target refused; missing target refused; new open deacon term in an archived district refused, closing one succeeds, re-opening refused; each seat-key guard refuses on the binding, person-grant, wrong-group, commission and delegation arms (the commission and delegation arms need a parent-council fixture, owner-inserted under rollback); a cross-org seat grants nothing; a seat term grants `parishes.assign` from its start date and loses it on its end date; `DELETE` on `org_units` refused as `presby_app`; `FOR SHARE` lookup works as `presby_app` under RLS; a `moderator`/`deacon` term and a future seat grant nothing. Writes end in `rollback`.
- `scripts/parishes/seed-dev-parishes.sql` (standalone, idempotent; integrated into `seed-dev.sql`): Alder Creek gains the `Board of Deacons Moderator` group, the `deacons_moderator` role with its key and its group grant, one seat holder who is **not** an administrator and holds no `directory.view_hidden` (Wren Thackeray, linked to a new fixture user `moderator.fixture@example.invalid`), one more district `East District` with two new households that is archived **after** they are assigned (the guard refuses assigning into an archived district), and one unassigned visitor household. `seed-dev.sql` inserts rows directly after the migrations, so the 0068 backfill never reaches the fixture org; the seed must carry its own rows.
- `scripts/parishes/test-rls.sql.integration.patch`: the F262 rewrite of the cross-org district block at `test-rls.sql:1124-1151` (one transaction that sets the org to Bramblewood, inserts the fixture district, switches the org to Alder, asserts the foreign-key refusal inside a savepoint, and rolls everything back, so nothing is deleted), and every count assertion the seed perturbs. Database-admin enumerates those deltas by running the full `test-rls.sql` before and after the seed addition; the patch carries only them.
- `scripts/parishes/global-setup.integration.patch`: the `sweepStaleParishFixtures` call-in.
- `drizzle/meta/_journal.json`: entry for 0068, at integration.
- `docs/decisions.md` DECISION-242 to 245 (below), `docs/STATE.md`, `docs/TODO.md`, `docs/schema-design-2.md` findings F258 to F265, `docs/reviews/log.md`.
- **CLAUDE.md, Two Hierarchies Intersect Nowhere. Operator approval needed.** Proposed sentence, to follow the DECISION-205 sentence: "Recording the Board of Deacons Moderator seat (`officer_terms.office = 'deacons_moderator'`) confers `parishes.assign` through the derived `deacons_moderator` group and nothing else; the key is seat-only, refused on a person grant, a commission or a delegation by trigger (DECISION-242). A founding administrator may record themselves in it; that is permitted, stamped `selfRecorded`, and `paper`."
- **TODO lines to add:** the over-100 bulk move; F260 for `session_member`/`roll.approve`; a campus dimension needs its own column; district history is unreadable in-app (audit viewer is platform-only); S1 relabel decision (public site string); household rows link to the household page; households with no living current person are unreachable; `memberships.org_unit_id` is unused and unguarded; Google Group sync and meeting follow-through (fpcw) have no presby equivalent. `docs/TODO.md:52` and `:380` move to Done at ship.

## Pre-ship items (orchestrator runs these read-only against production; this agent does not connect to production)

Run all of it before the 0068 production apply and again before turning the toggle on for any real congregation.

```sql
-- 1. Inherited gates: both must be enabled (TODO line 179 inferred this, never read)
select key, enabled from feature_flags
 where key in ('org_portal.directory','org_portal.directory_v2','org_portal.officers');

-- 2. Stop-block counts (0068 section 1); every column should be 0
select
  (select count(*) from org_units where unit_type not in ('parish','campus','district')) as bad_type,
  (select count(*) from org_units where name <> btrim(name) or char_length(name) not between 1 and 80
                                      or name is not nfc normalized) as bad_name,
  (select count(*) from (select organization_id, lower(name) from org_units
                          group by 1, 2 having count(*) > 1) d) as dup_names,
  (select count(*) from households h join org_units u
     on u.id = h.org_unit_id and u.organization_id = h.organization_id
   where u.unit_type = 'campus') as households_at_campus,
  (select count(*) from officer_terms ot join org_units u
     on u.id = ot.org_unit_id and u.organization_id = ot.organization_id
   where u.unit_type = 'campus' and (ot.ends_on is null or ot.ends_on > current_date)) as terms_at_campus;

-- 3. Backfill sizing and collisions
select (select count(*) from organizations where organization_type = 'congregation') as congregations,
       (select count(*) from groups where derived_from = 'deacons_moderator') as seat_groups,
       (select count(*) from app_roles where key = 'deacons_moderator') as seat_roles,
       (select count(*) from permissions where key = 'parishes.assign') as seat_key;
select count(*) as group_type_roster from group_types where key = 'roster';

-- 4. Sizing for the Unassigned page
select (select count(*) from org_units) as units,
       (select count(*) from households) as households,
       (select count(*) from households where org_unit_id is null) as households_without_district;

-- 5. Server version for IS NORMALIZED (needs >= 130000)
show server_version_num;
```

After the toggle is on for the first congregation: its founding administrator exists (a seat is not required to start; administrators can assign), and the seat is recorded under Officers once the Board names its Moderator.

## Out of Scope (for the user to confirm)

Per-person district assignment (`memberships.org_unit_id` stays unused); bulk assignment of unassigned households (row-level assign plus the bucket filter); an ordinary deacon claiming a household; Google Group sync and meeting follow-through; automatic reassignment when a deacon term ends; any district-history view or as-of report; hard delete of a district; campuses and anything for presbyteries or synods; the Track K fpcw import mapping; a household-page assign control (P3-11); linking a household row to its household page; relabeling `moderator` (P3-4); closing the F260 hole for `session_member`/`roll.approve`; a notification to a newly recorded Moderator.

## Feasibility check against the live tree (`ce661d7`)

- **SQL signatures valid:** `presby_seat_key_group(text)` takes one required parameter; the five trigger functions take none; no defaults precede a required parameter.
- **ALTER/DROP dependencies:**
  - `officer_terms_office_allowed` is referenced by name only in tests and comments; no function body references it.
  - `presby_sync_derived_group()` keeps its signature (caller: one trigger); the latest definition is 0062's, and 0063/0064 do not redefine it.
  - `revoke delete on org_units`: no application code deletes `org_units` (grep of `src/`), no `SECURITY DEFINER` body in `drizzle/` deletes from it, and the organization-delete cascade runs as the owner, which no grant binds.
- **New CHECKs and triggers against fixtures:**
  - `scripts/seed-dev.sql:1002` (`North District`, `South District`, type `district`), `scripts/test-rls.sql:1128` (`Bramblewood Fixture District`), `officers.test.ts:289,324` and `directory.test.ts:491-514` all pass the type vocabulary, the name shape and the active-name index.
  - The seed's households and deacon terms point at active districts; its closed deacon term is unaffected by the target guard.
  - The one fixture the revoke breaks is `test-rls.sql:1150`, handled by the staged patch.
- **Foreign keys:** none added. The guard looks up `(org_unit_id, organization_id)`, the tenant column on both `households` and `officer_terms`. The seat guards compare `new.organization_id` with the group's organization and the role's own organization.
- **CTE trap:** avoided (P3-7).
- **Invoker `FOR SHARE` as `presby_app`:** needs `UPDATE` on `org_units`, which `presby_app` holds; RLS applies and `new.organization_id` equals the GUC organization on every legitimate path. Asserted in `test-rls-68.sql`.
- **A Phase 4 that starts after another pipeline merges** re-runs this check (Risks, item 1).

## Final decision texts (the orchestrator writes `docs/decisions.md` at integration; date 2026-10-25, status Resolved by the Phase 3 design, pending the CLAUDE.md approval)

**DECISION-242: The Board of Deacons Moderator is a dated seat recorded in `officer_terms`, and its authority flows through the resolver.**
- Rule: the office `deacons_moderator` fills a derived `roster` group of the same key. A protected baseline role `deacons_moderator` carrying only `parishes.assign` is bound to that group. `parishes.assign` is seat-only, enforced in the database on every resolver arm (`presby_seat_key_group`, triggers on `app_role_permissions`, `role_grants`, `administrative_commissions`, `org_delegations`). Administrators move households with `people.manage` and define districts with `officers.manage`; the founding-administrator key set is unchanged. `moderator` is unchanged (DECISION-079). Self-recording is permitted, stamped `selfRecorded` and `paper`.
- Rejected: reusing `moderator` (existing rows would gain authority from data alone); a person grant (the request rules it out); a `group_role` on the diaconate (trigger-owned, always `member`); a dedicated `officer_terms` predicate (a second evaluator of dated authority).
- Revisit if a second seat-derived permission is added: extend `presby_seat_key_group` (and close F260 for `roll.approve`).

**DECISION-243: District lifecycle and archive enforcement are database properties. Moves are conditional updates under RLS, not a definer function.**
- Rule: `org_units.archived_at`, a validated `unit_type` CHECK and name-shape CHECK, a unique active-name index, a household index, and a guard trigger on `households` and open `officer_terms` that refuses a newly set archived, campus or missing district with `FOR SHARE` (the composite FK takes only `FOR KEY SHARE`, which an archive does not conflict with). `DELETE` on `org_units` is revoked from `presby_app` and `presby_platform` and guarded on the owner path. No `SECURITY DEFINER` move function: everything stays inside one organization, RLS enforces tenancy, and authorization is checked in the application inside the same transaction.
- Consequence: `households.org_unit_id` now means "deacon district" only; a campus dimension needs its own column.

**DECISION-244: Placement, one household count, name masking.**
- Rule: everything under `directory/parishes/*` and `src/lib/parishes.ts`, which alone writes `org_units` and `households.org_unit_id` and now also owns the roster read (moved from `directory.ts` to avoid an import cycle). "Households in a district" is every `households` row with that `org_unit_id`; the roster, district page, archive dialog, bulk dialog and `expectedCount` all use one helper. Masking is server-side, using the exported `directory_hidden` expression; `people.manage` and `directory.view_hidden` see hidden names, others see "Private". No contact, birthday, photo or address on these surfaces. No user-controlled return parameter.
- Consequence: the roster count changes for existing viewers (release note).

**DECISION-245: District assignment is overwritten and audited, not kept as dated history. Concurrency, lock order and audit keys.**
- Rule: care routing is not a constitutional fact, so history lives in `audit_events` (six keys, no names, written in the same transaction), and no history view is promised. Every writer locks `org_units` rows first (`FOR SHARE`, by id) and then `households` rows (`FOR UPDATE`, by id). A single move is `UPDATE ... WHERE org_unit_id IS NOT DISTINCT FROM expected`; zero rows is a conflict unless the household is already at the target. Undo is the same call. A bulk move is `{source, target, expectedCount}` with no household ids; the source must be archived, the target active, the cap is 100, and the response carries counts only. The row picker commits on an explicit button, never on selection (F261).
- Revisit if a moderator hits the 100 cap, or if congregations need to read the history.

## Implementer

**database-admin** for Batch A (0068, the three Drizzle mirrors, `parishes.db.test.ts`, and the staged `scripts/parishes/*` files); then **full-stack-developer** for Batches B and C (library, actions, pages, components, e2e). Neither batch is auth-touching under the Phase 4 definition (`src/auth.ts`, `src/proxy.ts`, `(auth)`, `api/auth`, `lib/auth` are untouched), but the e2e still signs in the MFA-enrolled fixture as the seat holder because Phase 1 G15 asks for it.

---

# Phase 4 — Implementation

## Phase 4 — Batch A (database-admin)

**Date:** 2026-10-25 · **Branch:** `pipeline/parish-management`, Neon branch `pipeline-parish-management` (never `development` or production) · **Base:** `ce661d7`.

### Files Created

- `drizzle/0068_presby_parishes.sql`: the migration, sections 1 to 11 in the design's order.
- `src/lib/db/domain/parishes.db.test.ts`: owner-path and two-connection proofs (25 tests).
- `scripts/parishes/test-rls-68.sql`: section 68, run as `presby_app` (64 assertions).
- `scripts/parishes/seed-dev-parishes.sql`: the dev fixture (standalone, idempotent).
- `scripts/parishes/test-rls.sql.integration.patch`: the F262 rewrite, the two count bumps and the `\ir parishes/test-rls-68.sql` line.
- `scripts/parishes/seed-dev.sql.integration.patch`: the one `\ir parishes/seed-dev-parishes.sql` line.

### Files Modified

- `src/lib/db/domain/org.ts`: `orgUnits.archivedAt`, the two CHECKs, `org_units_active_name_idx` (partial, `lower(name)`), and a NOT EXPRESSIBLE comment for the revoke and the two triggers.
- `src/lib/db/domain/people.ts`: `households_org_unit_idx` and a comment on the target guard.
- `src/lib/db/domain/officers.ts`: the widened `officer_terms_office_allowed` and its comments.
- `drizzle/meta/_journal.json`: `{ idx: 68, tag: "0068_presby_parishes" }`. The orchestrator asked for it in Batch A; the design had put it at integration. Every `.sql` on disk has an entry and every `idx` equals its file number.
- `src/lib/officer-offices.ts`, `src/lib/officers.ts`: vocabulary sync only (see deviation 5).
- `src/lib/officer-offices.test.ts`: re-pointed at 0068 (see Tests).
- `src/lib/db/domain/session-approval.db.test.ts`: pins that read 0062 as current now read it as history (see Tests).

### Schema Changes

- **Mode: hand-written.** The file is `drizzle/0068_presby_parishes.sql`, applied with `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0068_presby_parishes.sql`. `db:generate` is broken repo-wide.
- **Stop-blocks (counts only), measured on the branch before the first apply:** bad `unit_type` 0, bad name 0, case-duplicate names 0, households at a campus 0, open terms at a campus 0, office outside the vocabulary 0. The `roster` group type is present. Congregations 9, existing seat groups 0, seat roles 0, `parishes.assign` 0. `server_version_num` is 180006 (`IS NFC NORMALIZED` needs at least 130000).
- **Idempotence, proven on the final text.** The whole file was applied twice. Both runs exited 0 with no errors, and a 12-table row-count snapshot is identical before the first and after each run. The first-ever apply added 9 seat groups, 9 roles, 9 bindings, 9 grants (one of each per congregation) and 1 permission. The final re-applies changed nothing. `parishes.db.test.ts` also re-applies the whole file in a rolled-back transaction on every run and asserts no row change.
- **Catalog re-read after apply:**
  - `org_units`, `households` and `officer_terms` are `relforcerowsecurity = t`.
  - `org_units` ACL: `presby_app` and `presby_platform` hold INSERT, SELECT and UPDATE, with no DELETE.
  - The three CHECKs are `convalidated`.
  - Both indexes exist as designed.
  - The 8 triggers are `BEFORE` and enabled (`O`).
  - The seat map and 4 seat guards are `SECURITY DEFINER`. The target and delete guards are invoker. All six guards plus the map have `search_path=public, pg_temp`, owner `neondb_owner`, and `proacl {neondb_owner=X}`, so neither `presby_app` nor `presby_platform` can execute them.
  - All 9 seat roles are org-owned, protected and constitutional. All 9 groups are `roster`, derived and protected. No seat grant is person-arm, and every seat grant has `starts_on = current_date`.
- **Rollback, rehearsed** inside a transaction that was then rolled back. Every trigger and function is dropped, the CHECKs and index are dropped, the 0062 sync body is restored, and DELETE is granted back. The office CHECK was correctly left widened because a seat term exists. Afterwards the branch was unchanged (8 triggers, no DELETE).
- **For the next implementer:**
  - `org_units.archived_at` (null means active).
  - Constraint names and codes the library maps:

    | Constraint | Code | Meaning |
    |---|---|---|
    | `org_unit_target_archived` | 23514 | target district is archived |
    | `org_unit_target_campus` | 23514 | target is a campus |
    | `org_unit_target_missing` | 23503 | target missing, including another org's id |
    | `org_units_active_name_idx` | 23505 | name taken among active districts |
    | `org_units_name_shape` | 23514 | stored name not normalized |
    | `org_units_unit_type_check` | 23514 | unit type outside the vocabulary |
    | `seat_key_binding` | 42501 | seat-only key on the wrong role |
    | `seat_role_shape` | 42501 | seat role re-keyed, unprotected or made custom |
    | `seat_key_grant` | 42501 | seat role granted other than to its group |
    | `seat_key_downward` | 42501 | seat role on a commission or delegation |

    An owner-path DELETE raises `org_units_permanent` (42501). A `presby_app` DELETE gets "permission denied for table org_units".
  - The exact refusal literals are pinned in `parishes.db.test.ts` ("what src/lib/parishes.ts maps").
  - Seat role key `deacons_moderator`, group `derived_from = 'deacons_moderator'`, permission `parishes.assign` (module `parishes`, tier 1).

### Audit Events

- None in Batch A. A migration backfill has no actor. The six `AUDIT_ACTIONS` keys are Batch B.

### Implementer Notes

**Deviations from the design** (each strengthens it or follows the operator's rules; none weakens a ruling):

1. **Two seat-guard additions beyond step 7.** The design's step 7 left two bypasses of R1 open:
   - **Binding guard, reverse order.** It also refuses the key on a role that has *ever* been granted on another arm: a person grant, a non-seat group, a commission or a delegation. Without this, a tenant could make a seat-shaped role at an org with no seat role, grant it to a person, and then bind the key. "Ever", not "currently", follows 0055's "any reference" reasoning: re-opening an ended grant by moving `ends_on` does not fire the `role_id` trigger.
   - **New `app_roles_seat_role_guard` / `presby_guard_seat_role_shape()`**, `BEFORE UPDATE OF key, organization_id, role_kind, is_protected`. Without it, the seat role could be unprotected or made custom and then edited. The application only ever updates `deactivated_at`, which the guard does not watch.
   - The result is 8 triggers and 6 guard functions (the design said 6 and 4). The header's rollback lists all of them.
2. **The group checks also require `membership_source = 'derived'`.** `groups_derived_check` allows a *managed* group to carry `derived_from`, so the derived_from value alone does not identify the seat group.
3. **Section 1's duplicate-name stop-block counts only active rows once `archived_at` exists** (dynamic SQL, since the column may not exist yet). Without this, re-applying 0068 on a database where an archived district shares its name with an active one would stop, and the index allows exactly that. It was found while writing the DB test, which pins it with a regression test proven failing-first.
4. **Rollback, steps 4 and 6.** Step 4 narrows the office CHECK only when no `deacons_moderator` term exists. Step 6 no longer deletes the permission row (all deletes are soft).
5. **The TS vocabulary sync landed in Batch A, not Batch B:**
   - `OFFICER_OFFICES` gains `deacons_moderator` after `deacon`.
   - `OFFICE_LABELS.deacons_moderator` = "Moderator of the Board of Deacons" (design C7).
   - `listOfficerRoster()`'s `all_offices` list gains the office.
   - `requiredDerivedGroup()` maps the office to its group, so a presbytery gets the typed `invalid_office_for_org`, not the trigger's raw error.
   - Why here: re-pointing `officer-offices.test.ts` at 0068 cannot pass without the vocabulary, and adding the office without the `requiredDerivedGroup` arm would ship a raw-error path.
   - Side effect: the office already appears in the Add-officer-term dropdown, without Batch C's helper copy, until Batch C lands.
   - Batch B should not redo these. `AUTHORITY_OFFICES`, `selfRecorded`, `getOfficerFormOptions`, `district_unavailable` and the rest of the officers.ts list remain Batch B's.
6. **The F262 patch splits the old F2 assertion in two.** Since 0068, an *open* deacon term naming another org's district is refused first by the target guard (`org_unit_target_missing`, the same `foreign_key_violation`). The old block would therefore still pass without proving the FK. The patch keeps the open-term case (guard or FK) and adds a *closed* term, which the guard skips, so `officer_terms_org_unit_fk` must refuse it by name.
7. **The seed replays 0068's seat provisioning for every congregation**, not only Alder Creek. On a database built from empty, the backfill runs before `seed-dev.sql` creates any organization. Replaying it here makes CI and `development` count the same.
8. **The seed's two opening balances are dated 2021 and 2023.** `test-rls.sql` section 10 asserts that nobody is on Alder Creek's roll before 2010.
9. **Not staged here:** `scripts/parishes/global-setup.integration.patch`. It calls `sweepStaleParishFixtures` from `e2e/support/parish-fixture.ts`, which is Batch C's file. Batch C stages it.

**Branch hygiene (pipeline branch only, both rows created by this batch's own runs minutes earlier):**
- The pre-patch suite's line-1150 delete was refused (R2, as intended), leaving `Bramblewood Fixture District` (`a2000000-...-00ff`) behind. I removed it as owner, with `org_units_guard_delete` disabled inside one transaction, so the patched suite can re-insert it.
- After moving the seed's opening-balance dates, I re-dated the two approved `roll_actions` rows already on the branch, with `roll_actions_freeze` disabled inside one transaction.
- Both triggers were confirmed re-enabled (`O`).

**Tests:**
- **`scripts/parishes/test-rls-68.sql` as `presby_app`:** exit 0, 64 passes. Sections:
  - (a) shape and ACL;
  - (b) vocabulary, name shape, active-name index, archived-name reuse, restore collision, DELETE refused;
  - (c) household target guard: archived, campus, missing and cross-org targets are refused; clear and unrelated edits pass; `FOR SHARE` works under RLS;
  - (d) deacon-term guard: a new open term is refused, a historical term records, shorten and end pass, re-open is refused;
  - (e) every seat arm: binding, person, wrong group, re-point, shape, commission, delegation, grant-then-bind, bind-then-grant, presbytery; each with positive controls;
  - (f) the resolver: seat holder yes; deacon, pastor, moderator and ended seat no; future seat boundary at start date (yes) and end date (no, half-open); cross-org no;
  - (g) isolation.
- **Failing-first, section 68.** Each mechanism was removed on the branch, the section re-run with stop off, then the mechanism restored by re-applying 0068 (back to 64/64). First behavioural failure for each:

  | Mechanism removed | Assertion that failed |
  |---|---|
  | `households_org_unit_target_guard` | "FAIL 68c - a household moved into an archived district" |
  | `officer_terms_org_unit_target_guard` | "FAIL 68d - a new open deacon term was recorded in an archived district" |
  | binding guard | "FAIL 68e - parishes.assign was bound to a custom role" and "...a role already granted to a person" |
  | shape guard | "FAIL 68e - the seat role was unprotected" |
  | grant guard | "FAIL 68e - the seat role was granted to a person" and "bind-then-grant to a person succeeded" |
  | commission guard | "FAIL 68e - a commission was pointed at the seat role" |
  | delegation guard | "FAIL 68e - a delegation carried the seat role" |
  | DELETE grant restored | "FAIL 68a: R2/F258 - neither presby_app nor presby_platform holds DELETE" (the 68b delete is still refused, because the BEFORE DELETE guard also fires on the `presby_app` path) |
  | `org_units_unit_type_check` dropped | "FAIL 68b - a unit_type outside the vocabulary was accepted" |
  | `org_units_name_shape` dropped | "FAIL 68b - a mis-shaped name was accepted" |
  | `org_units_active_name_idx` dropped | "FAIL 68b - a case-only duplicate of an active name was accepted" |
  | 0062's CASE body (no new arm) | "FAIL 68f: it confers parishes.assign on its start date — expected 1, got 0" |

  Each trigger removal also failed "68a: all eight 0068 triggers exist and are enabled".
- **Full `scripts/test-rls.sql`, patched, with the seed:**
  - Baseline before 0068: 1240 passes and three pre-existing drift failures. The same three were reported in the 0061 work-log: line 217 "presbytery: sees only its own members", line 516 "2fa policy: definer function sees the requirement with no org GUC set", and line 7927 "DECISION-152 ... statistics.publish".
  - After 0068 with the unpatched file: one new failure, line 1150 "permission denied for table org_units". This is F262, failing-first for R2.
  - After 0068, the seed and the patch: **1305 passes** (1240 + 64 + the new closed-term F2 assertion) and **the same three pre-existing failures, no new one**.
  - The unmodified file with its own `ON_ERROR_STOP` still halts at line 217 on this branch, before and after 0068. A whole-file green run needs a clean `development` seed.
- **`src/lib/db/domain/parishes.db.test.ts`**, 25 tests:
  - Owner-path delete refusal with its literal.
  - The fixture-teardown cascade (districts, an archived district, households and a deacon term).
  - The target and seat guards firing on the owner connection.
  - **The archive race on two connections in both orders.** Archive first: the move waits on the row lock and is then refused. Move first: the archive waits, and both stand.
  - The whole-file re-apply with no row change, and the active-only re-apply regression.
  - The backfill shape, run twice, giving a presbytery nothing and skipping a tenant-made `deacons_moderator` role untouched.
  - No existing row gaining authority.
  - All six stop-blocks with their count messages, plus a positive control.
  - Seat-term materialisation and its end propagating, and the presbytery refusal literal.
  - The codes, constraint names and literals the library will map, as `presby_app`. The refusals are the designed literals, never "permission denied for function".
- **Failing-first, DB test:**
  - `for share` removed from the guard: "AssertionError: the move never waited on the archive's row lock". The move then committed into the archived district, which is the race 0068 closes.
  - `org_units_guard_delete` disabled: "expected undefined to be '42501'".
  - Section 1 reverted to count every row: the re-apply test raised "0068: % organization(s) have two org_units whose names differ only in case".
- **`src/lib/officer-offices.test.ts`, re-pointed:**
  - The pins now read the *newest* migration that defines the CHECK and the CASE, found by scanning `drizzle/` (renumber-safe), and assert it is the parishes migration.
  - A new test pins the whole CASE map. `deacons_moderator` comes directly after `deacon`, and `moderator` keeps its label (S1 declined).
  - Before the vocabulary sync, the re-pointed CHECK pin failed (`deacons_moderator` absent from `OFFICER_OFFICES`). Now 13 of 13 pass.
- **`session-approval.db.test.ts`:**
  - The fixture congregation gains the seat group, as `groupSeedPlan()` will.
  - The CASE test expects `deacons_moderator -> deacons_moderator`.
  - The 0062-text pin now compares against the 0062-era vocabulary, with the new office excluded.
  - 49 of 49 pass.
- **Gates:**
  - `npm run typecheck` passes.
  - `npm run lint` passes.
  - `npm run check`: 8 of 8 tripwires pass.
  - Plain `npm test`: 542 files and 8325 tests pass, 78 files skipped, 0 failed.
  - `check:schema-parity`: 85 tables, 0 failing.
  - `npm run test:db` (the whole suite, serial, against the pipeline branch): 620 of 620 files and 10791 tests pass, 1 skipped, in 34 minutes. That includes `parishes.db.test.ts`, `session-approval.db.test.ts`, `officers.test.ts` and `directory.test.ts`. The final renumber-safe `parishes.db.test.ts`, re-run alone, passes 25 of 25.
  - No `par-*` fixture organization or person remains on the branch after teardown.

**For the orchestrator at integration:**
- `git apply scripts/parishes/test-rls.sql.integration.patch scripts/parishes/seed-dev.sql.integration.patch`. Both pass `git apply --check` on `ce661d7`.
- Re-run `scripts/test-rls.sql` as `presby_app` on merged `development`.
- The journal entry is already in.
- If 0068 is renumbered: `officer-offices.test.ts` and `parishes.db.test.ts` find the file by name. The `drizzle/0068` mentions in comments, the work-log and the patch text would need a find-and-replace. `test-rls-68.sql` keeps its name, like the other section files.
- 0068 depends on nothing in 0065 to 0067. If a migration landing first redefines `presby_sync_derived_group()` or `officer_terms_office_allowed`, rebase sections 8a and 8b on it. Neither is redefined on `main` today.

**Local apply for anyone rebuilding the branch:**
1. `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0068_presby_parishes.sql`
2. `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/parishes/seed-dev-parishes.sql`
3. `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/parishes/test-rls-68.sql`

**Next:** Batch B (full-stack-developer).
- Batch B owns the existing DB-backed tests that build a congregation through `createOrganization()`. Once `groupSeedPlan()` and `baselineRoleSeedPlan()` gain the seat, those tests need updating. Batch A changed only the one fixture that pins the vocabulary (`session-approval.db.test.ts`).
- The seat role is protected, constitutional and keyed `deacons_moderator`. `role-grants.ts` and `role-definitions.ts` should refuse before the database does; the database refusals above are the backstop.

Strings added or changed:
- `src/lib/officer-offices.ts`, `OFFICE_LABELS.deacons_moderator`: "Moderator of the Board of Deacons" (design C7).
- No other user-facing string. The migration's `raise exception` texts are database refusals, mapped by Batch B, never shown verbatim.

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS / FAIL

## Unit Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [test name — error — file:line]

## End-to-End Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [...]

## Regression Tests Added

- [test name — file:line — guards against: brief description]

## Coverage on Critical Modules

- `src/lib/permissions.ts`: X%
- `src/lib/two-factor.ts`: X%
- `src/lib/flags.ts`: X%

## Feature-Gate Audit

*(Mandatory — see qa agent. Verified by reading route/action bodies, not by inferring from green tests. Write "no protected routes touched" if none.)*

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| [method + path, or action name] | yes / no | yes / no | `FEATURES.X` or n/a |

## Copy Truthfulness

*(Every run whose diff adds or changes a user-facing string; write "no strings changed" otherwise. Report a defect as `copy truthfulness: FAIL` with file:line and the viewer's role.)*

- [ ] Every added or changed string is in the design's Copy table
- [ ] The query behind each claim about a person, account, date or state was opened, and what it does not read was named
- [ ] Each instruction was traced to the role that sees it, and that role can do it (render gate and permission check)
- [ ] Older strings about the same subject were grepped for and none is made false

## Verdict

[PASS | FAIL | BLOCKED — name the unmet prerequisite]

*(Auth-touching diffs: PASS requires e2e against a real dev server with an MFA-enrolled seeded user; deferred e2e = BLOCKED.)*

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Audit event: [pass | fail | not applicable]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]

## Operator rulings on Phase 3 (2026-10-25)

- **CLAUDE.md Two Hierarchies sentence: approved** as drafted; the orchestrator lands it at integration.
- **P3-11 dormant households: accepted** with a TODO line.
- **S1 relabel of `moderator`: declined for now** (public staff-directory string); TODO line.
