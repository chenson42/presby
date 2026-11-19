# Presbytery committees and administrative commissions — Work Log

> **Slug:** `2026-11-19-presbytery-committees`
> **Surface:** (org) — the presbytery's portal (the `committees` placeholder route), presbytery branch; `/help`
> **Permission(s):** existing `groups.manage` (tier 1; settled Q2, confirmed in Phase 3); no new key
> **Flag(s):** existing global `org_portal.committees` (on in production); no new flag
> **Estimated complexity:** large
> **Pipeline mode:** Full (schema change likely: committee kind label, dated committee roles; migration 0090)
> **Source:** operator decisions A–G, 2026-11-17 (B: a committee is a group with a required / standing / ad hoc label plus dated roles — chair, vice chair, clerk, secretary, ex officio; administrative commissions are needed at go-live). Operator 2026-11-19: "start committees and take it to production".
> **Prior art:** `~/git/psvonline-portal` (committees); this repo's groups admin (`docs/work-log/2026-08-26-groups-admin.md`), the authorization schema's commissions and delegations, `docs/work-log/2026-08-26-presbytery-functionality.md` (DECISION-112, the deferred "Presbytery Increment 1")
> **Pre-assigned:** DECISION-352+, F456+, migration 0090 (0088 stays reserved for Learn 1b), dev port 3101, worktree `../presby-committees`, Neon branch `br-calm-rice-ax2zn9jw` (`pipeline/presbytery-committees`, endpoint ep-odd-hall-ax6wtzf0), e2e ids `00000000-0000-4090-8000-` (people), `-9000-` (roles), `-9001-` (organizations)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-11-19 |
| 2 — Architectural review | architect | Complete (R1–R6; DECISION-352–356 proposed; F456–F458) | Approved with suggestions | 2026-11-19 |
| 3 — Technical design | tech-lead | Complete (one design for both increments; T1–T17; DECISION-357–359 proposed; F459–F460; migration 0090; Inc 1 batches B1–B4, Inc 2 batches B5–B7; two child logs created) | Design complete | 2026-11-19 |
| 4 — Implementation | Inc 1: database-admin (B1), api-developer (B2), ux-developer (B3), full-stack-developer (B4); Inc 2: api-developer (B5), ux-developer (B6), full-stack-developer (B7) | Complete in both children | — | 2026-11-19 |
| 5 — Verification | qa | Complete in both children (Inc 1 runs 1–2 PASS; Inc 2 run 1 PASS) | PASS | 2026-11-19 |
| 6 — Shipped vs intent | analyst | Complete in both children (Inc 1 and Inc 2 SHIP WITH NOTES; parent closed) | SHIP WITH NOTES | 2026-11-19 |

## Children

Per CLAUDE.md "Per-Feature Tracking" (the Community and congregation-profile logs grew past 1,000 lines each). This parent keeps Phases 1 to 3 (the shared analyst and architect text verbatim, and the one design for both increments). Each child carries its own Phases 4 to 6 and a short Phase 3 pointer with its batch plan and gates.

| Increment | Work-log | Release | Scope |
|---|---|---|---|
| 1 — committees | `docs/work-log/2026-11-19-presbytery-committees-inc1.md` | 0.63.0 | Migration 0090 (all three tables, the role CHECK, the public-roster fix-forward); `src/lib/group-roles.ts`, the `groups.ts` additions and presbytery exclusion; the `src/lib/committees/` module; `gateCommitteesPage`; the committee list, page, forms and dialogs; the role titles on the public directory; the `presbytery-committees` help page and two help edits; the dev seed; the founding-administrator walk |
| 2 — administrative commission records | `docs/work-log/2026-11-19-presbytery-committees-inc2.md` | 0.64.0 | **No migration.** The commission record pages, member roster, end and remove controls; the help rewrite and the roles and privacy edits; the tile description |

**Numbers (pre-assigned, Rule 16):** migration 0090 (0088 stays reserved for Learn 1b); DECISION-352 to 356 (architect), **357 to 359 used by Phase 3**, 360 next; F456 to F458 (architect), **F459 and F460 used by Phase 3**, F461 next; dev port 3101 (`PW_PROD_PORT=3801` for the production hydration lane); e2e ids `00000000-0000-4090-8000-` (people), `-9000-` (roles), `-9001-` (organizations); dev-seed ids `b0900000-…`, `c0900000-…`, `d0900000-…`, `e0900000-…`; Neon branch `br-calm-rice-ax2zn9jw` (`pipeline/presbytery-committees`, endpoint ep-odd-hall-ax6wtzf0); worktree `../presby-committees`.

---

# Phase 1 — Functional Refinement (analyst)

*Work-log: `docs/work-log/2026-11-19-presbytery-committees.md`. Everything below was read in the worktree `/Users/cshenso/git/presby-platform/presby-committees`; nothing was written.*

## VERDICT

**READY WITH NOTES.** Nothing blocks design. The notes are rulings Phase 2 and 3 must carry (Gaps 1–6, 9 and 10). Open Question 1 changes the shape of the work if the operator answers it the other way. I took the default I recommend and flag it below.

DECISION-112 and TODO line 507 call this "mostly covered by the just-shipped groups feature; small additions only." That is true for committees. It is not true for commissions, and the placeholder route, the public site and two other features share the pieces being changed.

## ONE-LINE TAKE

> On the presbytery's Committees & Commissions page (today an inert "coming soon" stub), a clerk keeps the presbytery's committees (each labelled Required, Standing or Ad hoc), who serves on them in which dated role (chair, vice chair, clerk, secretary, ex officio, member), and a **record** of each administrative commission (what it was charged with, which congregation it concerns, when and by what minute, and who serves). The commission record gives its members no access to anything.

## What exists today (verified)

- **The placeholder** is `src/app/(org)/o/[slug]/admin/committees/page.tsx`, not a route at `/o/<slug>/committees`.
  - It checks the flag `org_portal.committees`, then that the org is a presbytery, then renders `ComingSoon`. It reads and writes nothing.
  - Its tile (`src/lib/org-portal/tiles.ts`, key `committees`, `comingSoon: true`) is presbytery-scoped.
  - `scripts/seed.ts:781` seeds the flag **on** ("GO-LIVE: false"). TODO line 300 says it is on in production, so the new page is live in production the moment it merges. I cannot read the production flag, so this must be confirmed (Question 6).
- **Committees are already groups.** `/o/<slug>/admin/groups` (flag `org_portal.groups`, key `groups.manage`, tier 1) creates `committee`, `small_group`, `choir` and `team` groups.
  - A member has a role of `chair`, `leader` or `member`, a start date and an end date. Ending a membership only sets `ends_on`, and nothing is deleted.
  - The detail page already shows current and ended members with dates.
  - `groups.manage` gates reads as well as writes. Nothing in the schema carries a Required / Standing / Ad hoc label or a "dissolved" state.
  - There is no deleting or archiving a group (DECISION-110 ruling 5).
- **The roles `chair` and `leader` carry authority elsewhere.** `group_role in ('chair','leader')` appears in `drizzle/0073_presby_reimbursements.sql:683` (a group's chairs and leaders approve requests) and `drizzle/0085_presby_worship.sql:679` (the worship team seat). Both are congregation features. The four new roles must carry no authority in those functions.
- **Group membership can itself be a grant.** `role_grants.group_id` can bind a role to a committee, so adding someone to that committee gives them the role. `group_role` grants nothing (groups-admin Phase 1). The audit comment in `src/lib/audit.ts:237-244` calls adding someone to such a group "a de facto access change."
- **A person must hold a current membership at the presbytery** to be added to a presbytery group. The add-member code enforces this (F21 shape), and the composite foreign key on `group_memberships` forces it.
- **The downward-access table is already built and has no writer in the app.** `administrative_commissions` has the columns `parent_org_id`, `target_org_id` (not null), `scope`, `role_id` (nullable), `group_id`, `starts_on`, `ends_on` and `minute_reference`. No file under `src/` writes it; it is written only by migrations, seeds and fixtures. The resolver's commission arm (`drizzle/0010`, arm 3) inner-joins `app_roles` on `role_id`, so a row with no role grants nothing. The giving, seat-key and reimbursement guards (0055, 0068, 0073) are all keyed on `role_id`.
- **The downward arm is not operational today.** `withOrgContext()` asks `presby_membership_is_active(person, org)` before anything else, so a presbytery-only member cannot enter a congregation's context at all. `docs/schema-design-2.md` F139 says "Not reachable today because `withOrgContext()` needs an active membership at the target."
- **The public committee directory** reads `presby_public_committee_roster()` (`drizzle/0042`), behind the flag `sites.public_committee_directory` (seeded off) and a per-membership `public_listed` opt-in.
  - It requires `ends_on is null`. It does not check that the person still has a presbytery membership, and it does not check `date_of_death` (the worship function checks both).
  - `src/lib/sites.ts:1831-1838` and `committee-directory.tsx:56` type the role as exactly `chair | leader | member`. A new role would render with no title.
- **A presbytery's own record about a congregation** has a precedent. The `oversight_*` tables are owned by the presbytery, with `about_org_id` a plain foreign key to the congregation. The application validates it against `readRoster()` (`src/lib/presbytery-reports/roster.ts`: this presbytery's current member congregations). The congregation sees none of it.
- **Prior art.** The psvonline prototype has committees with `committee_type` (committee / commission / board / task_force), `scope` (required / standing / ad_hoc), purpose, formed and dissolved dates, and assignments with the six roles. Its commission type means a standing judicial body, not a cross-congregation grant. See Gap 3.
- **Dev seed.** `scripts/seed-dev.sql:670` has one `administrative_commissions` row **with** a role. It is a fixture and I could not check production, so do not assume production has zero rows (Gap 12).

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Authenticated presbytery member holding `groups.manage` (the clerk or founding administrator) | **Open** Committees & Commissions from the portal tile; **create** a committee (name, Required / Standing / Ad hoc, purpose, when it meets) | Setup, then rare |
| Same | **Appoint** a person from the presbytery's records to a committee with a role and start date, and optionally a planned end date | Per meeting or election |
| Same | **Change** someone's role (member to vice chair to chair) with an effective date | Per officer election |
| Same | **End** a term; **dissolve** an ad hoc committee | Annual; rare |
| Same | **Record** an administrative commission: title, charge, optional congregation, date appointed, minute reference, members and roles; **end** it when it reports (Increment 2) | Rare, but needed at go-live |
| Same | **Choose** whether a committee member is shown on the public site (existing toggle, now with new role titles) | Per member |
| Presbytery member without `groups.manage` | **See** an honest "you don't have permission" state | n/a |
| Anonymous visitor | **Read** the public committee list only for members who were opted in, with the flag on, and only the committee name, role title, name and photo | n/a |
| Congregation members and administrators | **No verb, no visibility.** They do not see the presbytery's commission record about their congregation (Gap 4). | n/a |
| Platform admin (`/admin`) | **No verb.** No platform surface is added. | n/a |
| Operator (not a feature) | The one-time import of real data, in a Claude Code session | One-time |

All of it is the authenticated-member surface at `/o/<presbytery-slug>/admin/committees/...`, presbytery type only.

## Flows

**Flow 1 — Create a committee.** Tile → `/admin/committees` (list, grouped Required / Standing / Ad hoc, each row showing the chair and member count) → "New committee" → name, label, purpose, meets-when → save → the new committee's page.
- Failure: a duplicate name (case-insensitive) is refused with the existing committee named, because the public site merges committees of the same name (Gap 8). Overlong text is refused at the form and again on the server.

**Flow 2 — Appoint a member.** Committee page → "Add a member" → choose a person, role and start date (optionally a planned end date) → save → the roster shows them in role order.
- Failure: the person already holds an open seat on this committee, so the message names them and the committee (existing `overlap`). A person who is not a presbytery record: "No one available to add. People serve on a committee from the presbytery's own records. Add them under Community first." with a link, never a bare empty list (the DECISION-116 precedent; Gap 1).

**Flow 3 — Change a role.** Roster row → "Change role" → new role and effective date → one action ends the old stint the day before and opens the new one. History keeps both dated rows.
- Failure: the effective date before the current stint began is refused in words. If a second Chair would result, the message says so (Open Question 3).

**Flow 4 — End a term or dissolve.** "End term" with a date, and "Dissolve committee" with a date. Dissolving ends every open seat on that date, labels the committee "Dissolved <date>", and moves it from the default list to a "Dissolved" section. It is never a delete.
- Failure: a date before a start date is refused ("The end date can't be before the start date.", existing wording).

**Flow 5 — Record an administrative commission (Increment 2).** `/admin/committees` → "Administrative commissions" section → "Record a commission" → title, charge in general terms, optional congregation (from the presbytery's own member congregations), appointed on, minute reference → add members with roles and dates → save → the commission page. "End commission" with a date and an optional "reported on" minute reference.
- Failure: a congregation that is not one of this presbytery's members gets one neutral refusal, the same wording as a congregation that does not exist. A save failure keeps the form's contents.
- Not a flow: nothing here opens the congregation's portal to anyone (Gap 2).

**Flow 6 — Person not yet recorded.** A ruling elder from a congregation, or any non-roll person, gets a presbytery-side record through Community (`people.manage`, with the toggle "Community: add people and record roll actions" on). The presbytery has no Session, so only the participant or visitor kinds are available there. Then the clerk returns to the committee.
- Failure: if the Community toggle is off at the presbytery, the empty state says where to turn it on. I did not walk this for a presbytery org; Phase 5 and 6 must (Gap 1).

**Flow 7 — Public listing (existing, changed).** The toggle on a member row works as today. With the flag on and the member opted in, the public list shows the role title for all six roles (Gap 7).

**Flow 8 — Empty and gated states.**
- Flag off: "isn't turned on yet."
- Not a presbytery: the existing not-available state.
- No `groups.manage`: the permission-denied state.
- A brand-new presbytery: the empty state offers "Create your first committee" with the button, not a bare "No committees."

## Permissions & Flags

- **Permission(s): reuse `groups.manage` (tier 1) for committees and, in v1, for commissions. No new key.**
  - The presbytery founding-administrator bundle already carries it (`founding-administrator.ts`, base list), so the person the invitation path creates can run the whole demo with no bundle change, no backfill, no new two-factor consequence and no new "known violation" in CLAUDE.md.
  - Under `assertPermissionSubset()` a new key held by nobody at the presbytery can never be granted, so any new key would have to join that bundle (the `domains.manage` / careers / oversight precedent). That costs a migration function change, a backfill, an `invitations.db.test.ts` pin and a heavier Phase 6 walk.
  - The commission record is a fact written in the presbytery's own books and grants nothing, so its blast radius is the same as the oversight records'.
  - If the operator wants commissions restricted to the stated clerk, that is the case for a second key (Open Question 2).
- **Default roles:** none new. The presbytery founding administrator holds `groups.manage` through the bundle. Do not bind it to the stated-clerk template (DECISION-078 / DECISION-110 ruling 2: no office is the constitutional keeper of committee rosters).
- **Reading:** `groups.manage` holders only in v1 (Open Question 4).
- **Flag:** reuse the existing global `org_portal.committees`. The oversight precedent is a global flag and no per-org toggle, and the memory rule is no new global flag before go-live.
  - This pipeline graduates the flag: remove `comingSoon` from the tile and change the seed comment, as `oversight`, `reports` and `insights` did.
  - Rollback is flipping the flag off. Data stays, and the page says "isn't turned on yet."
  - `org_portal.groups` is a separate flag and the committees area must not depend on it.
- **Flag vs permission:** both are asked, in that order (flag, org type, permission), as the placeholder does. A flag never grants and a permission never stages.

## Gaps the Request Didn't Address

1. **What a "person on a committee" is.** The rule is already uniform and I recommend keeping it. A committee member is a person with a **current membership at the presbytery**, and the committee reads only presbytery-owned data.
   - Teaching elders are members of the presbytery by polity, so they are already there.
   - A ruling elder from a congregation is not, and gets a presbytery-side **non-roll record** (participant or visitor) made through Community. The committee never reaches into the congregation's tenant. Pointing a presbytery group at a person's congregation membership would be exactly the crossing the F21 guard forbids.
   - If that elder is already a person at a **managed** congregation, the presbytery cannot link to the existing record (F21 allows linking only for a person with no membership anywhere, or via a claimed certificate). It makes its own record, so the same human may exist twice. That duplicate is an accepted residual, and `presby_match_person` plus `merged_into_id` is how it gets cleaned up later. For the first presbytery customer almost every congregation is unmanaged, so this is mostly theoretical.
   - Two things to carry:
     - Adding a ruling elder takes two steps in two admin areas (Community, then Committees), and the Community toggle is off by default. The guided empty state in Flow 2 is mandatory.
     - A roster cannot say which congregation an elder comes from. The prototype's committee page does not either. This is deferred, not forgotten.
2. **A commission in v1 is a record, not a grant.** My recommendation, and why:
   - **The product need is tracking.** The placeholder's own words are "administrative-commission tracking." A presbytery needs to know who was appointed, concerning what, when, by what minute, and whether it has reported.
   - **Granting access cannot work today.** The members would need a membership at the congregation just to enter it, and an unmanaged congregation (the majority) has no portal at all. Making it work means new cross-tenant design: how a commission member gets a congregation-side membership, the congregation's own access log, and what happens to the Session whose powers are being assumed. That is its own pipeline.
   - **A record cannot be mistaken for a grant if nothing writes a role.** Nothing in this pipeline may write `administrative_commissions`, `org_delegations` or any `role_id`. Pin it with a source-scan boundary test and an RLS case.
   - **Copy must not oversell it.** Every screen and help line says the record gives no access to the congregation's PresbyPortal. That is true only while nothing writes a role, so the claim and the boundary test must ship together.
3. **"Commission" means two things in the polity.** The operator's label (required / standing / ad hoc) describes committees, and psvonline's `commission` type is a *standing body with a commission's status*, such as a judicial commission. An *administrative commission* is appointed to carry out a task, often concerning one congregation but not always (for example, one to examine or install someone).
   - **The congregation must be optional.** The existing downward table requires a target, so reusing it for the record is a poor fit.
   - **Use the full words "Administrative commission" on every screen.** A standing commission such as a judicial one is a committee labelled Required (Open Question 7).
   - Whether the record is a new presbytery-owned table (my recommendation, the oversight precedent) or a use of the existing table is the architect's call. I am naming the functional requirement only: congregation optional and validated against the presbytery's own roster, no role, no grant.
4. **Who sees a commission record.** The existing table's policy (`commission_visible_to_both`) lets the target congregation read rows about it. For the record I recommend no. The congregation sees nothing in v1, as with the oversight records. Congregations will not like that in time, so name it as a deliberate v1 position, not an oversight.
5. **A commission's charge can be sensitive.** A charge about a named matter is the kind of text a presbytery handles in executive session.
   - Keep it short and bounded (about 500 characters) with helper copy: "Describe the charge in general terms. Don't record confidential details here."
   - It must never appear in audit metadata (platform-readable), a CSV, a log, an error message, the public site or the platform `/admin` pages.
   - The later export pipeline (decision E) must decide explicitly whether commissions enter an export. Say that in the Phase 3 carry-forward.
6. **Dated roles are not what the shipped model expresses.**
   - Today a person holds one open row per committee, and a role change means end-then-add as two separate screens. Flow 3 needs one atomic "change role" action. Phase 3 must say whether a person may hold two offices at once (clerk and secretary). My default is one role at a time. That is why the overlap check stays.
   - A **planned end date** ("term ends Dec 31") is not offered today, because the add form has no end field. Rosters, the audit and the public function must all treat `ends_on` in the future as still current. See Gap 7.
7. **The public directory silently degrades.**
   - It types the role as three values, so a Clerk or Secretary would show with no title. Extend the type and the label map, and pin it with a test that fails if a role has no label.
   - The function drops anyone whose `ends_on` is set, even in the future. Once planned end dates exist, a current member vanishes from the site early.
   - It keeps showing a person whose presbytery membership has ended or who has died, once they were opted in. The worship function already checks both.
   - Fixing these is a fix-forward of a `SECURITY DEFINER` function, so the 0090 migration is not optional. It only matters once the flag is on and someone is listed.
   - A commission's members must **not** be publicly listable. If the commission's roster is built on groups, the existing "Public listing" toggle must not appear for them and the public function must exclude them by kind, not by UI hiding.
8. **Committee names must be unique** (case-insensitive, among active committees). The public site keys on the lowercased name, and two committees with one name merge under one heading (`sites.ts:1827-1829` records this as an accepted edge case).
9. **A committee cannot be retired today.** There is no archive or dissolve, so ad hoc committees would pile up forever. A dissolved state and a dissolved date are functionally required (Flow 4). The schema shape is not mine.
10. **Existing committee groups have no label.** Dev has two (a seeded "Property Committee" and "Commission on Alder Creek"), and production may have some. Show them as "Not yet labelled" and prompt the clerk. Do not backfill a guess; "Required" is a polity claim the clerk makes.
11. **Chair is a title here and a seat elsewhere.**
    - The Roles screen has a "Committee Chair" role template that **does** grant permissions, while a committee's "Chair" grants nothing.
    - Copy must say plainly: "Chair, vice chair, clerk, secretary and ex officio are titles. They don't give anyone access."
    - The roster must also show when a committee **carries a role** ("Members of this committee also hold the X role"), because adding a person to it is then an access change. Today the UI does not show this, and the audit event does not distinguish it.
12. **Production state is unknown for three things:** the three flag states in Question 6, whether `administrative_commissions` has real rows, and whether `groups.manage` is held by the person demoing. Assert nothing about them in design; read them on `development` and the production dashboard.
13. **Ex officio does not follow an office.** A "Stated Clerk, ex officio" seat is entered by hand. The presbytery-offices pipeline (decision C) will decide any link. Say so in help.
14. **A person who leaves the presbytery stays on the roster.** Ending a membership does not end committee seats (and the participant copy's `holds_position` refusal names offices, roles and staff positions, not groups). Show "No longer connected to this presbytery" on the roster row, which is a Phase 3 decision. This is also why the public function needs the Gap 7 fix.
15. **The audit story.** `GROUP_CREATED`, `GROUP_UPDATED`, `GROUP_MEMBER_ADDED` and `GROUP_MEMBER_ENDED` already exist and are written by `admin/groups/actions.ts`. The presbytery audit log (decision G) is a later pipeline that will read these events, so they must be right now.
    - Add or extend: committee label change, dissolve, role change (one event, not two), and commission recorded, updated and ended.
    - Write them in the same transaction (the person-photos / oversight pattern). Metadata carries ids, role and dates, never free text.
    - The `check:audit` tripwire covers `actions.ts` files, so the audit properties need their own test, as oversight's `audit-coverage.test.ts` did.

## Adversarial Pass

- **Redirect targets.** There is no `callbackUrl` or `next` on any of these pages. Back-links are static paths built from the validated slug, and a test should pin that none is added. The page's own sign-in redirect uses an encoded fixed path, as the placeholder does.
- **State-machine shortcuts.** Deep URLs (a committee id, a commission id, the add and change forms) must pass flag, then org type, then permission, in that order, with no step skippable by typing a later URL. Denial happens inside each reader's transaction, not by hiding a button.
- **Wrong kind of group.** A `small_group`, `choir` or `team` id, or a derived Session / Diaconate group id typed into a committee URL must answer the same neutral not-found as a nonexistent id. The groups admin already 404s derived ids, so reuse that. A congregation's worship-team group is not reachable here, but the same rule covers it.
- **IDOR and enumeration.**
  - A committee, commission, membership or person id from another presbytery returns the byte-identical not-found as a nonexistent one (DECISION-040). Non-UUID ids 404 before any read (F446).
  - A commission's `aboutOrgId` is validated server-side against this presbytery's current member congregations (`readRoster`), not by the form's `<select>`. A congregation of another presbytery, a non-congregation org and a nonexistent id all return one wording.
- **The downward-grant table.**
  - Nothing in this pipeline may write `administrative_commissions`, `org_delegations` or any `role_id`. Pin this with a source-scan test (the oversight `boundaries.test.ts` shape) and an RLS case.
  - A reading of the DDL only, for the architect to confirm: that table's policy is a single `using` clause for both parties and `presby_app` holds `insert`/`update`, and nothing in the database checks that the parent is the target's real parent council or that the target consented. It grants nothing today only because the membership gate stops the downward arm. This pipeline stays clear of it, and a later "commission grants access" feature would be the creation form that needs the heaviest review.
- **Input boundaries (server-side).**
  - Empty form, overlong name (200, existing), purpose (2000) and meets-when (200).
  - A role or label outside its closed list is rejected on the server (the form's `<select>` is not the gate).
  - Unicode and control characters in names and free text.
  - Dates: an end before the start, an absurdly far-future date, and a start date later than today (allowed for a planned appointment, shown as "Starts <date>").
  - A minute reference over 200 characters.
- **Self-targeting.** A `groups.manage` holder may appoint themselves chair or end their own seat. That is acceptable only while roles grant nothing. If the committee carries a bound role, adding oneself is a self-grant. That path is pre-existing and audited, and the roster showing "this committee carries the X role" (Gap 11) is what makes it visible.
- **Chair and role conflicts.** Two open Chairs, or a Vice Chair with no Chair, are legal polity in some committees (co-chairs). Do not block. Open Question 3.
- **Public leakage.** The public function returns only the committee name, role title, name and photo. The kind label, dissolved state and any commission data must never be added to it, and a test should pin the column list.

## Edge Cases the Request Didn't Mention

- **Empty state.** A new presbytery sees "Create your first committee" with the button and a line about starting with Required committees. Empty commissions section: "No administrative commissions are recorded." Empty roster: "No one serves on this committee yet" with "Add a member."
- **Failure microcopy.** A database or network failure gives a section-level "We couldn't load this. Try again." and the rest of the page stays. A failed save keeps the form's contents. No stack trace and no raw error code.
- **Mobile at 360px.**
  - Rosters and lists are cards below `sm` and tables above (the reports pattern). Role and dates must not be the first things hidden; the existing groups roster hides them below `sm`, which is wrong for the field this feature is about.
  - Forms are full pages, not long dialogs. Tap targets are 44px.
  - `HydrationGate` on every `useForm` root (`check:hydration-gate`), no native dialogs (AlertDialog for destructive confirms), and no `loading.tsx` under `admin/**`.
- **2FA gate.** The proxy pushes a mid-enrolment user on `/o/*` to `/totp`, so the pages need no special handling. No new key means no new two-factor consequence. Phase 3 should confirm `groups.manage` is not flagged (it is not among the keys 0080 flags).
- **Roll and history.** This touches no roll data. A role change keeps both rows, so "who chaired in 2025" is answerable.
- **Per-capita, SASR and reports.** Unaffected.

## Out of Scope (confirm with user)

- Granting any downward access: a role, a `role_id`, an `org_delegations` row, or a congregation-side membership for a commission member. See Gap 2.
- Presbytery offices (moderator, vice-moderator, stated clerk with dated terms), mission giving, the directory-export permission, worship times, and the presbytery audit log are separate pipelines. This work only keeps its own audit events clean for the last one.
- A starter list of the polity-required presbytery bodies. I would not hard-code section numbers; the repo has been burned by an unverified Book of Order cite before (`schema-design-2.md`). The clerk applies the "Required" label, and the real data comes in by the one-time import.
- Term limits, class rotation, automatic expiry reminders, vacancy reports and committee reports on the dashboard.
- A read-only view for presbytery members who are not managers, and a "my committees" view on a person's page (Open Question 4).
- Which congregation a ruling elder comes from on the roster (Gap 1).
- The data import itself, and any committee data in a CSV export.
- What's-new entries. The operator's standing rule is drafts in work-logs only; no entry is published or listed as a to-do.

## Increments

I recommend two back-to-back increments, each its own work-log under this parent, with the Phase 1–2 shared. This is the congregation-profile precedent (0.61.0 and 0.62.0), with one migration, **0090**, holding every table and function change so Increment 2 needs no schema.

| | Increment 1 — committees (0.63.0) | Increment 2 — administrative commissions as records (0.64.0) |
|---|---|---|
| Migration | 0090, whole schema: the label, the dissolved state, the role vocabulary, the commission record, the public-roster fix-forward | none |
| Pages | Committee list, committee and roster pages, new/edit, add member, change role, end term, dissolve; the tile graduates | Commissions section, record form, commission page, end commission |
| Also | Role titles on the public directory; the help page; the dev seed | A help edit; the boundary and RLS pins |
| Why split | The committees half is clean and demoable alone | It carries the one real security question (Gap 2), which deserves its own QA focus |

If time forces a cut, cut in this order: planned end dates (Gap 6), then Dissolve, then the "carries a role" note. **Do not cut** Change role, the guided empty states, the role titles on the public site, or the commission record itself, because the operator said commissions are needed at go-live.

**What the demo needs.** A presbytery founding administrator, on a phone, can do all of this in a few taps:
1. Open the tile and see committees grouped Required / Standing / Ad hoc, each showing its chair.
2. Open a committee and see the current roster in role order, with dates and a visible history.
3. Add a member, change a role, and end a term.
4. Open the commission section and see a commission with its congregation, charge, minute reference and members.
5. See one clear sentence that none of it gives access to a congregation.

The dev seed needs a few invented committees across all three labels and one invented commission. Per the operator, the real data arrives by the one-time import, so no migration or app code may carry real names.

## Help impact

Workflow Rule 17 applies: this adds a page a non-operator can reach and changes who can do what and the strings a page quotes.

- **Add** a published page `presbytery-committees` ("Committees and commissions").
  - **What you need:** `groups.manage`; the presbytery's own records for anyone you add; the "Community: add people and record roll actions" toggle on, if you are adding a ruling elder who is not yet recorded.
  - **Covers `tile:committees`.** Remove that entry from `src/lib/help/coverage-allowlist.ts` and decrement the pinned count in `coverage.test.ts` (and the "12 entries" sentence in that file's header) in the same diff.
  - **Its `labels`** carry every string on screen: the three labels, the six roles, the buttons, the empty and denied states, and the commission wording. It states plainly that the titles give no access and that a commission record gives no access to a congregation.
  - It says that ex officio is entered by hand, and that the congregation does not see the record.
- **Retire** the planned placeholder `presbytery-tools` ("Presbytery committees and commissions"). Write the new page with `replaces: ["presbytery-tools"]`; its `today` sentence "There is no committees-and-commissions module" is the `limitationUntil`-style claim this change falsifies and must be gone.
  - **Orchestrator action:** TODO line 29 (the Track P umbrella) carries `[help:presbytery-tools]`. That line stays open for the other presbytery work, so move the token to a live page or remove it in the same commit, and run `grep -n "\[help:" docs/TODO.md` at integration. `check:help` fails until the token and the slug agree.
  - If Increment 1 ships before commissions, Phase 3 must word the page's commissions line in present tense so it passes the banned-phrase check, and Increment 2 rewrites it.
- **Edit** `roles-who-can-do-what`: its `groups.manage` description (around line 56, "create and manage groups, and record staff positions") is incomplete once the key also covers the presbytery's committees and commission records.
- **Check, and edit if they enumerate it:**
  - `why-cant-i-see-this`, for any "isn't turned on yet" or permission wording about this tile.
  - `privacy-policy`, if it lists what a council records about a person. Committee roles and commission appointments are never public, and public listing stays per-member opt-in.
  - `adding-people`, for the presbytery path to a participant record.
  - `turning-features-on-and-off` needs no edit (the Community row already says "Any organization"), and `congregation-records` is unaffected unless Phase 3 cross-links to it.
- **Phase 6** reads each of these as its reader at 360px, and `verifiedIn` moves only by that walk.
- **Rule 10 and 14 housekeeping at ship, for the orchestrator:**
  - TODO line 507 moves to Done.
  - `committees` leaves the go-live placeholder-sweep list in TODO line 300 and the "flip the whole block" comment in `scripts/seed.ts`.
  - The functionality-map line for presbytery changes.

## Open Questions

Each has a default I took so the pipeline does not wait, as the congregation-profile pipeline did. Each is reversible with a small change. The first is the only one that changes the shape of the work.

1. **Is a commission a record or a grant?** Default: **a record only** (Gap 2). Confirm that the first presbytery wants to *track* commissions and does not need one to open a congregation's portal at go-live.
2. **Does a commission need its own permission key**, so only the stated clerk can record one? Default: no, `groups.manage` covers both. A new key would join the founding-administrator bundle and cost a migration function change, a backfill and a larger Phase 6 walk.
3. **Co-chairs and two offices.** Default: more than one Chair is allowed (no block, no warning beyond a visible duplicate), and one person holds one role on a committee at a time.
4. **Who may read committees?** Default: `groups.manage` holders only. A read-only view for presbytery members (and a "my committees" view) is a named fast follow, not v1.
5. **The commission's congregation is optional.** Default: optional, because administrative commissions are not always tied to one congregation. A standing judicial-type body is a committee labelled Required, and the word "commission" on screen always means an administrative commission. Confirm that wording works for the first presbytery.
6. **Production state to read before design.** Does `org_portal.committees` stay on (the page goes live on merge; rollback is turning it off)? What are `org_portal.groups` and `sites.public_committee_directory` set to? Does the production presbytery's founding administrator hold `groups.manage`? Does `administrative_commissions` hold any rows? The orchestrator can read these directly; they do not need the operator.
7. **Naming in the UI.** Default: the tile keeps "Committees & Commissions," the section is "Administrative commissions," and the label values are "Required," "Standing" and "Ad hoc."

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-11-19 |

## Handoff

Next agent: **architect** (Phase 2). Please rule on:

1. **Where the committee label and the dissolved state live** (columns on the shared `groups` table versus a presbytery-only side table), given that `groups` is shared with every org type and its derived-edit triggers.
2. **The commission record's home:** a new presbytery-owned table following the oversight precedent (my recommendation, congregation optional, no role column) versus a use of `administrative_commissions`. Confirm that **nothing here writes** `administrative_commissions`, `org_delegations` or a `role_id`, and say whether that table's policy gap needs its own TODO line. Say also whether a commission's members are a managed group or a roster inside the record, and how they are made un-listable on the public site (Gap 7).
3. **The role vocabulary:** whether `group_role` gets a CHECK constraint (after reading production values), that `chair` and `leader` keep their worship and reimbursement semantics, and that the four new values carry none.
4. **The public-roster fix-forward in 0090:** future-dated `ends_on`, active-membership and death checks, and a committee-kind exclusion for commissions.
5. **The module and boundary plan:** sole writers, a `boundaries.test.ts` that pins them (no `getPlatformDb()`, no write to the two downward tables, audit in the same transaction), and the route placement under the existing `admin/committees` with no `loading.tsx`.
6. **Gaps 6, 8, 9 and 10** (one atomic role change, name uniqueness, dissolve, unlabelled legacy rows) and **Gap 14** (a person who left the presbytery).

Pre-assigned numbers stay: DECISION-352+, F456+, migration **0090**, dev port 3101, Neon branch `br-calm-rice-ax2zn9jw`. Phase 6 will need to walk as the person the presbytery's founding-administrator invitation path creates, on `development` at 360px (the page and every state above), because that path is how a real user holds `groups.manage`.

Files read (all in `/Users/cshenso/git/presby-platform/presby-committees` unless noted):
- `docs/work-log/2026-11-19-presbytery-committees.md`, `docs/work-log/_template.md`, `docs/work-log/2026-08-26-presbytery-functionality.md`, `docs/work-log/2026-11-17-congregation-profile.md`
- `src/app/(org)/o/[slug]/admin/committees/page.tsx`, `src/lib/org-portal/tiles.ts`, `scripts/seed.ts`, `scripts/seed-dev.sql`
- `src/lib/groups.ts`, `src/lib/db/domain/groups.ts`, `src/lib/db/domain/authz.ts`, `src/lib/sites.ts`, `src/app/(public)/site/[slug]/committee-directory.tsx`
- `drizzle/0010_presby_resolver.sql`, `0009`, `0014`, `0015`, `0042`, `0050`, `0055`, `0073`, `0085`, `0089`
- `docs/schema-design.md`, `docs/schema-design-2.md`, `docs/TODO.md`, `src/lib/help/registry.ts`, `src/lib/help/coverage-allowlist.ts`, `src/content/help/*`
- `src/lib/onboarding/founding-administrator.ts`, `src/lib/oversight/contract.ts`, `src/lib/presbytery-reports/roster.ts`, `src/lib/audit.ts`
- `/Users/cshenso/git/psvonline-portal/src/lib/db/schema.ts` and `src/app/(app)/committees/` (shapes only; no real names carried over)

---

## Orchestrator rulings on the Phase 1 open questions (2026-11-19)

The analyst's defaults are taken; each is reversible.

- **Q1:** an administrative commission is a **record only** in this pipeline. Nothing writes `administrative_commissions`, `org_delegations` or a `role_id`.
- **Q2:** no new key; `groups.manage` covers committees and commission records.
- **Q3:** co-chairs are allowed; a person holds one role per committee at a time.
- **Q4:** only `groups.manage` holders read in v1.
- **Q5:** a commission's congregation is optional; screens say "Administrative commission".
- **Q7:** the tile keeps "Committees & Commissions"; the labels are Required / Standing / Ad hoc.
- **Increments:** two, under this parent (Inc 1 committees 0.63.0; Inc 2 commission records 0.64.0), one migration 0090.
- **Q6, production read-only probe:**
  - Flags: `org_portal.committees` ON, `org_portal.groups` ON, `org_portal.oversight` ON, `sites.public_committee_directory` ON.
  - `administrative_commissions` 0 rows; `org_delegations` 0 rows.
  - Groups exist only of types court (4) and roster (10), with no committee groups.
  - `group_memberships` 10 rows, all `member`; `public_listed` 0.

---

# Phase 2 — Architectural Review (architect)
## Phase 2: Architectural Review (architect)

*Read in the worktree `/Users/cshenso/git/presby-platform/presby-committees`. I read the live catalog on the pipeline's Neon branch (`br-calm-rice-ax2zn9jw`, endpoint ep-odd-hall-ax6wtzf0): `pg_class.relforcerowsecurity`, `aclexplode(relacl)`, `pg_policies`, `pg_trigger`, `pg_constraint` and `pg_proc`. I wrote nothing.*

## Verdict

**Approved with suggestions.**

Phase 1 has the right shape. The rulings below settle the six handoff items. Two of them change what the analyst assumed:

- **R3: a commission's members are not a group.** They are a roster inside the record, so nothing can grant through them or list them publicly, by construction.
- **R1: at a presbytery, committee-type groups leave `/admin/groups`.** Otherwise two writers would apply different rules to the same rows.

The live catalog turned up one grant drift (F456). This pipeline records it but does not fix it.

## Placement

- **Directory placement.** Add a new module `src/lib/committees/`. Do not extend `src/lib/groups.ts`, which is already 1,168 lines and shared by the groups admin, worship and provisioning. Layout follows the oversight module:
  - **Pure files, with no runtime imports so client components can use them:**
    - `contract.ts`: the kind and role vocabularies, labels, length limits, the flag key, the permission key constant and the commission role vocabulary.
    - `validate.ts`: server-side input validation.
    - `copy.ts`: holds the two no-access sentences.
    - `derive.ts`: roster ordering, the current/history split on half-open dates, and the "Starts <date>" and "No longer connected" states.
  - **`reads.ts`:** one reader per section. Each runs in its own `withOrgContext()` transaction and checks `groups.manage` and the presbytery org type inside that transaction.
  - **`store.ts`:** the only writer of the new tables (R2, R3). Audit goes through `src/lib/audit-tx.ts` in the same transaction.
  - **`action-gate.ts`:** checks flag, then org type, then permission, in that order.
  - **Tests:** `boundaries.test.ts` and `audit-coverage.test.ts`.
  - **`src/components/committees/`:** roster cards and table, plus the role and kind badges, shared by the committee and commission pages.
  - **`src/lib/group-roles.ts` (new, pure, no imports):** the one closed `group_role` vocabulary (seven values) and its labels. `groups.ts`, `committees/contract.ts`, `sites.ts`, `committee-directory.tsx` and the groups admin's label map all import from it.
- **Route tree** under the existing `src/app/(org)/o/[slug]/admin/committees/`:
  - **Increment 1 pages:**
    - `page.tsx`: the list, grouped Required / Standing / Ad hoc / Not yet labelled, with a Dissolved section.
    - `new/page.tsx`, `[committeeId]/page.tsx` and `[committeeId]/edit/page.tsx`.
    - `[committeeId]/members/new/page.tsx` and `[committeeId]/members/[membershipId]/role/page.tsx`.
  - **Increment 2 pages:** `commissions/new/page.tsx`, `commissions/[commissionId]/page.tsx`, plus its `edit` and member sub-pages.
  - **Path resolution:** Next resolves the static segments `new` and `commissions` before `[committeeId]`. Any id that is not a UUID gets a 404 before any read (F446).
  - **Server actions:** one co-located `actions.ts` per segment that needs one, marked `'use server'`. Each calls `store.ts` and never `db` directly.
  - **No `loading.tsx` anywhere under `admin/**`** (DECISION-251; `shell-boundaries.test.ts` already pins this). Use per-section `Suspense` instead.
- **Server vs client split.**
  - Every page is a Server Component.
  - `'use client'` is only for:
    - the forms: create/edit committee, add member, change role, and the Increment 2 record and member forms. Each `useForm` root renders `HydrationGate`.
    - the `AlertDialog` confirms: end term, dissolve, end commission.
    - the public-listing toggle.
  - If the committees page reuses the toggle, move it out of `admin/groups/` into `src/components/committees/` (or `shared/`) and pass its server action in as a prop. **The committees route tree must not import any file from `admin/groups/`**, because that would tie it to the separate `org_portal.groups` flag. The boundaries test pins this.
- **Dependencies:** none. Everything needed is already present: Drizzle, Radix through the `ui/` primitives, `lucide-react` and `HydrationGate`.

## Invariants Touched

- **Isolation Is a Database Property.**
  - The new tables (R2, R3) are `ENABLE` + `FORCE`, with `tenant_isolation` on `organization_id = presby_current_org()` for both `using` and `with check`.
  - `presby_app` gets `SELECT`, `INSERT` and column-limited `UPDATE`, with **no `DELETE`**. `presby_platform` gets nothing (the 0089 precedent).
  - The 39.5 FORCE catch-all in `scripts/test-rls.sql` fails closed if either step is missed.
  - Because the policy is organization-only, not the "visible to both" shape on `administrative_commissions`, the congregation a commission record is about can **never** read it. That is enforced by the database.
- **Two Hierarchies Intersect Nowhere.**
  - A commission record is a fact in the presbytery's own books. Nothing in this pipeline writes `administrative_commissions`, `org_delegations`, `role_grants` or any `role_id`.
  - The resolver's commission arm (0010 arm 3) joins `administrative_commissions → groups → group_memberships`. Commission members live in a non-group table (R3), so that arm cannot see them even if someone later writes a commission row by hand.
  - The "no access" copy is true by construction, not merely because nothing writes yet.
- **The Court Is Not a Group.** Unaffected. Committees are `managed` groups. The committees store refuses a derived group, and `groups_reject_derived_edit` and `group_memberships_reject_derived` stay as they are.
- **Composite Tenant Keys.**
  - Every new table has `unique (id, organization_id)`.
  - `committee_details (group_id, organization_id)` references `groups (id, organization_id)`.
  - `commission_record_members (commission_record_id, organization_id)` references `commission_records`.
  - `(person_id, organization_id)` references `memberships (person_id, organization_id)`, the same shape as `group_memberships_person_fk`.
- **Permissions vs Flags.** Phase 3 must keep the order flag (`org_portal.committees`), then org type, then permission (`groups.manage`) on every page, reader and action. Readers check inside their own transaction. No new key, no new flag. **0090 must not re-create `presby_founding_administrator_permission_keys()`**: no key changes, and re-creating it would expose the F362 integration hazard.
- **No Role Carries a Wildcard / tiers.** `groups.manage` (tier 1) now also reads a commission's charge, and that text may touch pastoral matters. **Accepted residual, `paper`.** It is bounded by the 500-character limit, the "general terms" helper copy, and keeping the charge out of audit metadata, logs, CSV, the public site and `/admin`. A second key was declined by the settled Q2. The later export pipeline (decision E) must decide whether commissions enter an export.
- **Never Hard-Delete.** Nothing in the new tables can be deleted (no grant). Dissolving a committee, ending a commission and ending a seat set dates only (the operator's all-deletes-are-soft rule).
- **(org) contract.** `getPlatformDb()` is forbidden in `src/lib/committees/`, the route tree and `src/components/committees/`, and the boundaries test pins it. There is no `callbackUrl` or `next` parameter. Back-links are static paths built from the slug.
- **Brand scope.** `(org)` is brandable. No new emitter, no `*-brand` utility outside the two layouts. `check:brand-scope` is unchanged.
- **No CLAUDE.md change is required.** The orchestrator should add `src/lib/committees/` and `src/components/committees/` to Project Layout at ship (the other modules' precedent).

## Notes

### R1: module ownership, and keeping the shared groups admin, worship and reimbursement unaffected (DECISION-352)

1. **`src/lib/groups.ts` stays the only writer of `groups` and `group_memberships`** in application code (with provisioning for derived groups).
   - The committees store writes committee groups and seats **only through `groups.ts`'s exported `*InTx` primitives**, the worship precedent.
   - Changes to those primitives are additive and opt-in: a caller-supplied allowed-role set and an optional `endsOn`.
   - **The groups admin's and worship's existing behaviour must not change.** Their existing tests passing unmodified is the pin.
   - The committees store does its own interval-overlap check (R5) before calling the shared primitive. It does not change the shared `ends_on is null` check those callers rely on.
2. **At a presbytery, committee-type groups belong to the committees surface.**
   - In `groups.ts`, `listGroups`, `getGroup`, `getGroupFormOptions`, `addGroupMember`, `endGroupMembership`, `updateGroup` and `createGroup` exclude or refuse (`invalid_target`) a `committee`-type group when the organization is a presbytery.
   - The `/admin/groups` list at a presbytery shows one line pointing to Committees & Commissions instead.
   - Congregations keep committees in `/admin/groups` exactly as today.
   - Rollback is the flag: with `org_portal.committees` off, a presbytery's committees cannot be edited, and the data stays. Production has zero committee groups (Q6), so nothing in use moves.
   - Why: otherwise two surfaces write the same rows with different rules (dissolve, planned end dates, interval overlap, atomic role change, six roles against three). On top of that, `GROUP_ROLE_LABELS[entry.groupRole]` in `admin/groups/[groupId]/page.tsx:200` renders blank for any new role (F458).
3. **Seat semantics are untouched.**
   - `presby_reimbursement__is_seat` (0073:683) and `presby_worship_leads_team` (0085:679) match `group_role in ('chair','leader')` exactly and fail closed, so the four new values carry nothing.
   - Both features return `not_applicable` at a presbytery (reimbursement EC27; worship `orgTypeAdmitted`).
   - Pin it with a DB test: a `vice_chair`, `clerk`, `secretary` or `ex_officio` row on a chargeable group or worship team returns false from both functions.
   - The committees store refuses any org that is not a presbytery and any group that is not a committee, so the new values never reach a congregation's group through the application.

### R2: where the label and the dissolved state live (DECISION-353)

1. **A 1:1 side table, not columns on the shared `groups` table.**
   - Working name `committee_details`; the database-admin may rename it, but the shape below is the ruling.
   - Columns: `organization_id`, `group_id` (`unique`), `kind text null check (kind in ('required','standing','ad_hoc'))`, `dissolved_on date null`, `dissolved_by_user`, `dissolved_at`, and created/updated stamps.
   - `groups` is shared by every org type and carries the derived-edit and derived-pair triggers.
   - Columns there would need a new trigger on `groups` to tie `kind` to the committee type, because a CHECK cannot read `group_types`. That trigger would fire on every worship and provisioning write.
   - A side table keeps the shared table, its triggers and its Drizzle file unchanged.
2. **A guard trigger on the side table only** (SECURITY INVOKER) refuses:
   - a group that is not `managed` or not of type `committee`;
   - an organization that is not a presbytery;
   - any change to `group_id` or `organization_id`.
   - **Dissolution is one-way**, like oversight's one-way removal. The dissolve dialog says so.
3. **Not yet labelled** means no row, or `kind is null`. There is **no backfill** (Gap 10).
4. **Dissolve runs in one transaction:**
   - takes the R5 advisory lock;
   - sets `dissolved_on`;
   - ends every open or planned seat at the dissolve date through the `groups.ts` primitive;
   - writes one audit row.
   - If the committee carries a role grant, the dialog says that dissolving ends everyone's access through it. The grant resolves to nobody once the seats end.
   - No member may be added to a dissolved committee. That is enforced by the store alone (`paper`, bounded by R1's sole-writer pin). The public function excludes dissolved committees at the database layer anyway (R4).

### R3: the commission record's home (DECISION-355)

1. **New presbytery-owned tables**, working names `commission_records` and `commission_record_members`. **Not `administrative_commissions`**: that table requires a target, carries `role_id`, sits in the resolver, and is visible to the target.
   - **`commission_records` columns:** `organization_id` (the presbytery), `about_org_id uuid null references organizations(id)`, `title` (≤200), `charge` (≤500), `appointed_on`, `minute_reference` (≤200), `ended_on`, `ended_minute_reference` (≤200), and stamps.
   - **There is no `role_id` and no `group_id` column.**
   - **About-org check:** use 0045's `presby_check_about_org_affiliated('about_org_id','')` **with `WHEN (new.about_org_id is not null)`**. Without the `WHEN`, a null congregation is refused, because the function passes the null to `presby_org_affiliated`.
   - The application also validates against `readRoster()` and returns one neutral wording for every miss (DECISION-040).
2. **Members are rows in `commission_record_members`, not `group_memberships`.**
   - Columns: a role from a closed CHECK (Phase 3 picks it, defaulting to the committee six), `starts_on`, `ends_on`, and **no `public_listed` column at all**.
   - Because no `groups` row exists:
     - `role_grants.group_id` cannot bind one (the `/admin/roles` group picker lists every group at the org);
     - `administrative_commissions.group_id` cannot point at one (its FK targets `groups`);
     - the resolver, `presby_public_committee_roster`, and the reimbursement and worship seat functions cannot see one.
   - So a commission's members are unlistable and ungrantable by construction (Gap 7).
   - Ending a commission ends its open member rows in the same transaction.
3. **Confirmed: nothing in this pipeline writes `administrative_commissions`, `org_delegations`, `role_grants` or a `role_id`.**
   - `boundaries.test.ts` pins that no file under `src/lib/committees/`, the route tree or `src/components/committees/` names `administrative_commissions`, `administrativeCommissions`, `org_delegations`, `orgDelegations`, `role_grants`, `roleGrants`, `roleId` or `getPlatformDb`. It needs a failing sample for each rule.
   - It also pins that no file outside `src/lib/committees/` names the new tables, with three allowed exceptions: the domain schema file, `dev-docs.ts`, and the ERD.
   - Add an RLS case in the pipeline-local suite: from the congregation's context, reading a commission record about it returns zero rows.
4. **F456, the downward tables' write model.** Phase 1 asked whether that table's policy gap needs its own TODO line: **yes**. What the live catalog shows:
   - On the pipeline branch, `presby_app` and `presby_platform` hold **DELETE** on `administrative_commissions`, `org_delegations` and `transfer_certificates`, all granted by `neondb_owner`. `drizzle/0009:338` states `select, insert, update` only. I could not trace where the DELETE came from in `drizzle/` or `scripts/`: the grant history drifted, F38-shape.
   - Both downward policies are `FOR ALL` with `USING` only. `WITH CHECK` therefore equals `USING`, so a **target-side** context can insert, update or delete rows naming itself. The FK check bypasses RLS, so such a row can name any group of the parent organization.
   - The rows are inert today: no `src/` writer, the membership gate F139 records, and 0 rows in production.
   - **Do not fix it in 0090.** Revoking would break `scripts/giving/test-rls-46.sql` (46k), `scripts/parishes/test-rls-68.sql` (68e) and `scripts/treasury/test-rls-73.sql` (73f), which write these tables as `presby_app` to prove the guards.
   - **Ruling:** a TODO line carrying F456. Any future "commission grants access" or delegation pipeline must ship, together, a SECURITY DEFINER writer, the revoke of direct DML, a WITH CHECK that stops the target side writing, a check that the parent really is the target's council, and the three suites rewritten to call the definer.
   - The orchestrator should confirm the DELETE grants on production (read-only `aclexplode`) and record what it finds in the F456 entry.

### R4: the public-roster fix-forward in 0090 (DECISION-356; F457)

1. `create or replace presby_public_committee_roster(text, text, boolean)` with an **identical signature and return columns**.
   - Carry the **0078 body** exactly, including the `presby_person_public_photo` lateral. The live body on the branch matches it (md5 `08030577…`).
   - `presby_public_site_asset()` calls this function, so the asset door narrows with it. That is the intended direction: an unlisted member's photo stops being served.
2. Add the following to the `where` clause:
   - `gm.starts_on <= current_date`. Today a future-start, opted-in member is listed early; this is a live gap even before planned end dates exist.
   - `(gm.ends_on is null or gm.ends_on > current_date)`.
   - An active membership at the organization (`memberships.ended_on is null`).
   - `p.date_of_death is null` and `p.merged_into_id is null`.
   - `not exists` (a `committee_details` row for the group with `dissolved_on <= current_date`).
3. **No commission clause is needed.** R3 makes commission members structurally absent.
4. The projection stays name, role title, display name and photo. **A test pins the column list.** The kind label, dissolved state and commission data never enter it.
5. `sites.ts:1831-1838` and `committee-directory.tsx` take the seven-value type from `src/lib/group-roles.ts`. A test fails if any CHECK value lacks a label.
6. **Accepted residual:** `current_date` is the UTC day, so listing can flip up to a day early or late around midnight, local time. `paper`.
7. **Observation for Phase 3, not a finding:** the function lists every `managed` group type a member was opted into (choirs and teams too), not only committees. That is existing, consented behaviour. Leave it unless the analyst objects.

### R5: role vocabulary, dates and atomic change (DECISION-354)

1. **`group_role` gets a closed CHECK:** `('chair','leader','member','vice_chair','clerk','secretary','ex_officio')`.
   - Production values are all `member` (Q6). The pipeline branch has `chair` and `member`.
   - 0090's guard section refuses, with a clear message, if any row falls outside the list.
   - The groups admin keeps offering `GROUP_ROLES` (chair, leader, member). The committees surface offers six: chair, vice chair, clerk, secretary, ex officio, member. **No `leader`.**
   - A legacy `leader` row renders read-only as "Leader", and changing its role offers the six.
   - A unit test pins: the union of the two offer sets equals the CHECK; the seat vocabulary `{chair, leader}` and the four new values have no overlap.
2. **Half-open dates, as the resolver, reimbursement and worship already use them.** `ends_on` is the first day not serving (`ends_on > as_of` means serving).
   - **Change role:** in one transaction, set the old row's `ends_on` and the new row's `starts_on` both to the effective date. **Not "the day before".** Under this codebase's convention, the day before leaves a one-day gap in which the person holds nothing.
   - Phase 3 words the date fields so the copy matches the convention.
   - One audit row, not two.
3. **Overlap** for committee seats is interval overlap (`starts_on < other.ends_on or other.ends_on is null`, and the reverse), because planned end dates exist. Settled Q3: one role per person per committee at a time; co-chairs allowed.
4. **Name uniqueness (Gap 8)** is checked in the application: case-insensitive, trimmed, among non-dissolved committee groups at the organization.
   - It is serialized by a transaction-scoped advisory lock keyed on the organization (the `oversight/store.ts` and `worship/store.ts` pattern).
   - There is no database index, because the predicate needs the group type, which lives in another table. `paper`. The consequence of a miss is the public-site heading merge Phase 1 already accepted.

### R6: Gap 14 and the rest

1. **A person who has left the presbytery or died keeps their seat rows.** No trigger ends them; history is the record.
   - The roster derives "No longer connected to this presbytery" from `memberships.ended_on`, and a death state from `date_of_death`.
   - The public function excludes both people (R4).
2. **Audit:**
   - New keys under a `committee.` prefix: `created`, `updated`, `labelled`, `dissolved`, `member_added`, `member_role_changed`, `member_ended`.
   - New keys under a `commission_record.` prefix: `recorded`, `updated`, `member_added`, `member_ended`, `ended`.
   - The existing `group.*` events stay with the groups admin, so the later presbytery audit log (decision G) can filter without resolving group types.
   - `committee.member_added` carries `grantsRole: true` and the role ids when the committee carries a role grant (Gap 11, the de facto access change).
   - Metadata is ids, role, kind and dates only, never a name, title, charge or minute text.
   - Every row is written in the mutation's own transaction through `audit-tx.ts`, and `audit-coverage.test.ts` pins this. `check:audit` does not see `store.ts`.
3. **Wrong kind of group:** a `small_group`, `choir`, `team`, derived, or other organization's id in a committee URL returns the same neutral not-found as an id that does not exist. The reader filters type `committee`, `managed` and the current organization in one query.

### Migration 0090, structure for the database-admin

0090 is one file covering both increments. Hand-written, idempotent, applied with `-1`, and proven by applying it twice. Sections:

0. **Guards:** refuse if any `group_role` is outside the seven, or if `presby_person_public_photo` is absent (0078).
1. The `group_role` CHECK.
2. `committee_details`: table, keys, guard trigger.
3. `commission_records` and `commission_record_members`: tables, keys, CHECKs, the about-org trigger with `WHEN`, a one-way guard on ending.
4. RLS and grants, as in Invariants above.
5. The `presby_public_committee_roster` fix-forward.
6. Comments.

**Independence and timing:**
- 0090 is independent of 0088 (Learn 1b) and must apply in either order. The orchestrator sets journal order at integration.
- Deploy 0090 **before** the 0.63.0 code. Old code against the new schema is harmless: it only ever writes chair, leader or member, and nothing old names the new tables.
- **0090 ships to production with Increment 1, so Increment 2 cannot correct it in place afterwards** (DECISION-298). Phase 3 must design the commission tables completely before Increment 1's Phase 4 starts. If Increment 2 later needs schema, it asks the orchestrator for a new migration number.
- RLS cases go in a pipeline-local `scripts/committees/test-rls-90.sql`. `scripts/test-rls.sql` and `scripts/seed-dev.sql` are Rule 16 shared files, edited only by the orchestrator at integration.
- The dev seed's presbytery committee fixture is the group the dev `administrative_commissions` row points at. After 0.63.0 it appears as an unlabelled committee. Phase 3 decides whether the seed adds a label; it must not delete or re-point the row, because 46k and 68e rely on it.
- `dev-docs.ts` needs a classification entry for each new table, and `npm run docs:erd` reruns.

### Proposed decisions (for the orchestrator to record in `docs/decisions.md`)

- **DECISION-352:** Presbytery committees and commission records live in a new `src/lib/committees/` module. `groups.ts` stays the only application writer of `groups` and `group_memberships`; the committees store reaches them only through its `*InTx` primitives, extended additively. At a presbytery, `committee`-type groups belong to Committees & Commissions and leave `/admin/groups`; congregations are unchanged.
- **DECISION-353:** A committee's kind label and dissolved state live in a 1:1 side table with a composite FK to `groups`, guarded so it attaches only to a managed committee group at a presbytery. They are not columns on the shared `groups` table. A missing label means "Not yet labelled", with no backfill. Dissolution is one-way and ends every seat in the same transaction.
- **DECISION-354:** `group_memberships.group_role` is a closed seven-value CHECK. The four new titles (vice chair, clerk, secretary, ex officio) carry no authority; the seat predicates in 0073 and 0085 stay exact-match on `('chair','leader')`. Committee seats use half-open dates; a role change ends the old row and starts the new one on the same effective date, in one transaction with one audit row.
- **DECISION-355:** In v1 an administrative commission is a presbytery-owned **record** (`commission_records`, `commission_record_members`): no `role_id`, no `group_id`, an optional congregation validated by the 0045 trigger under `WHEN not null`, visible to the presbytery only. Its members are not groups, so nothing can grant through them and nothing can list them publicly. Nothing writes `administrative_commissions`, `org_delegations` or a `role_id`; a source scan and an RLS case pin it. Downward access is a future pipeline, gated on closing F456.
- **DECISION-356:** 0090 fix-forwards `presby_public_committee_roster` with the 0078 signature and photo lateral unchanged. It adds checks on start date, end date (null or future), active membership, death, merge and dissolution. The projection's column list is pinned by test.

### Findings (for `docs/schema-design-2.md`)

- **F456 (open, tracked, not fixed here):** two problems on the downward tables.
  - **Grant drift:** `presby_app` and `presby_platform` hold DELETE on `administrative_commissions`, `org_delegations` and `transfer_certificates` against 0009's stated `select, insert, update`. The source is untraced; production is to be confirmed.
  - **Policy:** both downward policies are `FOR ALL` with no `WITH CHECK`, so the target side can write rows naming itself.
  - Inert today. It must close before any application writer of the downward tables ships (R3.4).
- **F457 (closed by 0090):** the public committee roster checks neither `starts_on` nor active membership, death or merge, and its `ends_on is null` check hides planned end dates early.
- **F458 (closed by R1 and R5):** the groups admin's three-value role label map renders a blank title for any other `group_role`. A presbytery's committees leave that surface, and the label source becomes the total seven-value map in `src/lib/group-roles.ts`.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-11-19 |

## Handoff

Next agent: **tech-lead** (Phase 3). The design must cover:
- R1–R6, including the full 0090 data model for both increments before Increment 1's Phase 4 starts;
- the `groups.ts` primitive extensions, with no behaviour change for the groups admin or worship;
- the presbytery exclusion in `/admin/groups`;
- the half-open date wording in the Copy section;
- the commission member role vocabulary;
- the dev-seed change.

The orchestrator should:
- record DECISION-352 to 356;
- record F456, F457 and F458;
- add a TODO line for F456;
- confirm F456's DELETE grants on production with a read-only `aclexplode` query before recording it.

Files read: `/Users/cshenso/git/presby-platform/presby-committees/docs/work-log/2026-11-19-presbytery-committees.md`, `docs/work-log/_template.md`, `src/lib/db/domain/groups.ts`, `src/lib/db/domain/authz.ts`, `src/lib/groups.ts`, `src/lib/role-grants.ts`, `src/lib/sites.ts`, `src/lib/oversight/boundaries.test.ts`, `src/lib/audit-tx.ts`, `src/lib/reimbursement/config.db.test.ts`, `src/lib/db/domain/reimbursement.db.test.ts`, `src/app/(org)/o/[slug]/admin/committees/page.tsx`, `src/app/(org)/o/[slug]/admin/groups/**`, `drizzle/0009`, `0010`, `0045`, `0050`, `0072`, `0073`, `0078`, `0085`, `0089`, `scripts/giving/test-rls-46.sql`, `scripts/parishes/test-rls-68.sql`, `scripts/treasury/test-rls-73.sql`, `scripts/test-rls.sql` (section 39.5), `docs/schema-design-2.md` (F139, F260).

---

## Orchestrator note on F456 (2026-11-19)

Production confirms the drift, from a read-only `aclexplode` query. `presby_app` and `presby_platform` each hold DELETE, INSERT, SELECT and UPDATE on all three downward tables:

- `administrative_commissions`
- `org_delegations`
- `transfer_certificates`

This is the same as the pipeline branch, and production holds 0 rows in the first two. Per R3.4 the issue is recorded and tracked, not fixed here.

---


# Phase 3 — Technical Design (tech-lead)

*Written 2026-11-19 in `/Users/cshenso/git/presby-platform/presby-committees` (branch `pipeline/presbytery-committees`, base `origin/main` at `21fa4b68`, 0.62.0). The design lives once, here. The two increments' implementation records live in the child logs (see "Children"). Every claim about the live tree below was read from it on 2026-11-19; the catalog facts (grants, triggers, role values, function bodies) were read read-only from the pipeline's Neon branch `br-calm-rice-ax2zn9jw`. The feasibility results are in "Feasibility check".*

## Summary

On the presbytery's Committees & Commissions page (today an inert "coming soon" stub), staff holding the existing key `groups.manage` keep the presbytery's **committees** (each labelled Required, Standing or Ad hoc, or "Not yet labelled"), **who serves** on each in one of six dated titles (chair, vice chair, clerk, secretary, ex officio, member), and, from Increment 2, a **record of each administrative commission** (title, charge in general terms, an optional member congregation, when and by what minute it was appointed, who serves, when it ended). Committees are `managed` groups; a new 1:1 side table carries the label and the dissolved state; a commission record is a presbytery-owned table pair that is **not a group and carries no role**, so it cannot grant, and cannot be listed publicly, by construction. One hand-written migration, **0090**, holds all of it for both increments, because it ships to production with Increment 1 and cannot then be corrected in place (DECISION-298). Increment 1 (0.63.0) ships the migration, the committees pages, the role titles on the public committee directory, the help page and the dev seed. Increment 2 (0.64.0) ships the commission record pages and rewrites the help wording; it adds **no migration**. New code lives in `src/lib/committees/`, `src/components/committees/` and the existing `src/app/(org)/o/[slug]/admin/committees/` tree; it reads and writes through `withOrgContext()` on the RLS-enforced connection, audits every write in its own transaction, and adds no flag, no permission key, no dependency and no route handler.

**No loop-back to Phase 1 or Phase 2 is needed.** Three Phase 3 rulings refine or add to the architect's text without touching an invariant (T7 the commission's congregation resolver, T9 two extra audit keys, T11 the in-transaction role-grant reader); they are named in "Carry-forward" so the architect can see them if the orchestrator wants the courtesy.

## Design rulings made in this phase

DECISION numbers are proposed for the orchestrator to record (pre-assigned 352 to 356 are the architect's; 357 to 359 used here, 360 is next free). Settled Q1 to Q7 are not reopened.

| # | Ruling | Why | Reversal cost |
|---|---|---|---|
| T1 | **One design for both increments; 0090 holds every table and function change.** Sections 0 to 7 are specified below, complete, so Increment 1's Phase 4 can start. | R: "0090 ships to production with Increment 1." | n/a |
| T2 | **Every end-like date is the first day the thing no longer applies** (half-open, as the resolver, reimbursement and worship read them). The UI never says "Last day". The fields are "Ends on" (a term), "Dissolved on" (a committee), "Ended on" (a commission), each with a one-line helper that says so; every list says "Ends {date}" / "Ended {date}". | `ends_on > as_of` means serving. A field called "Last day" would store a day one too late and silently keep someone serving a day longer; "Ends on" with the helper is true to the column. | Low (copy only). |
| T3 | **A role change is one atomic action** with one effective date `E`: the old seat's `ends_on` and the new seat's `starts_on` are both `E` (no gap, no overlap); the new seat inherits the old seat's planned `ends_on` if it has one; one audit row. **The seat's public listing is carried forward** in the same transaction (the new row is `public_listed` exactly when the old one was, attributed to the acting user through `setManagedMembershipPublicListedInTx`), so a listed person is not dropped from the public list by a role change; the role title on the public site changes with it. `E` must be `>= old.starts_on` (a same-day correction leaves a zero-length old row, which history shows) and `< old.ends_on` when the old seat has a planned end. A stale form (the seat's role is no longer the one the form was opened on) is refused as `stale`. | R5.2; Phase 1 Flow 3. "The day before" (Phase 1's wording) leaves a one-day gap under the half-open convention (architect). | Low. |
| T4 | **Seat overlap is interval overlap**, checked in the committees store under a transaction advisory lock keyed on the committee, and it ignores zero-length rows (`ends_on = starts_on`, which served no day). A person holds one seat per committee at a time (Q3); co-chairs are allowed. To keep the shared primitive's `ends_on is null` check from refusing a legitimate back-dated row, the primitive gains an `overlap: "caller"` option that skips only that check (T10). | R5.3 and Phase 1 Gap 6. | Low. |
| T5 | **Dissolve** takes a date that is not in the future and not before the start of any seat that has already begun. It ends every open or planned-end seat at that date; a seat that has not started yet is ended **zero-length at its own start** (so nothing is deleted and nothing is left open). One transaction, the seat lock, one audit row with the count. One-way (the guard freezes the details row). A mistaken dissolve is an operator data fix; the dialog says it cannot be undone from the page. | R2.4 and DECISION-353. Future dates are refused so "dissolved" never needs a second, planned state. | Medium (a "reopen" would be a new migration and action). |
| T6 | **Commission member roles are the same six titles as committees** (chair, vice chair, clerk, secretary, ex officio, member), a closed CHECK of six on the new table (no `leader`, which is the legacy seat word). | Justified under "Commission role vocabulary" below. | One forward migration to widen the CHECK. |
| T7 | **A commission's congregation is resolved with `resolveMemberCongregation()`** (this presbytery's `parent_id`, type `congregation`, **no lifecycle filter**), not `readRoster()` as R3 wrote. Neutral refusal text is unchanged. *This refines Phase 2 R3 without changing an invariant.* | `readRoster()` returns only `lifecycle_status = 'active'`; an administrative commission is the record most likely to concern a congregation that is closing or closed, and oversight's R9/F453 already set the precedent that a still-affiliated closed congregation stays reachable. Both the DB trigger and `parent_id` still fence it to this presbytery. | Low. |
| T8 | **Commission members: one open seat per person per commission is a database fact** (partial unique index), interval overlap for planned ends is the app's; a **live-parent guard** (the 0089 building guard shape, `FOR SHARE`) refuses a new member of a removed commission always, and of an ended commission unless the connection is the owner (history import and seed). **A commission record has a one-way removal pair** (`removed_at`/`removed_by`) for a record entered by mistake; its members do not (a mistaken member is ended on the day it started). | The all-deletes-are-soft rule needs one way out for a wrong or duplicate record, and 0090 cannot gain columns later. The removal UI is cut-able (Increment 2, cut order below); the columns are inert if cut. | Low. |
| T9 | **Public listing of a committee member** is offered on "Serving now" rows through a committees-owned action. Two audit keys are added to R6's list: `committee.member_listed` and `committee.member_unlisted`, written **in the same transaction** (the existing `group_membership.listed_publicly` events are written after commit by `recordAudit()` and stay with the groups admin). **Public display order is not offered at a presbytery** (deferred, TODO). | R1 forbids the committees tree importing `admin/groups/`; a disclosure fact must be audited in-transaction (the oversight rule). Display order is presentation-only and unused (production lists 0 members). | Low. |
| T10 | **`groups.ts` changes are additive and opt-in** (details under "Modified outside the module"): `addManagedGroupSeatInTx`, `setManagedMembershipPublicListedInTx`, and the presbytery exclusion in the **gated** functions only (`listGroups`, `getGroup`, `getGroupFormOptions`, `createGroup`, `updateGroup`, `addGroupMember`, `endGroupMembership`, `setGroupMembershipPublicListed`, `setGroupMembershipPublicDisplayOrder`). The `*InTx` primitives stay unrestricted because the committees store and worship call them after their own gates. `createGroup` of a committee type at a presbytery returns `invalid_input` with a sentence (C10), not a bare `invalid_target`, so a hand-built form is told where committees went. The existing `groups.test.ts`, `groups.primitives.db.test.ts` and the worship store tests pass **unmodified**. | R1. | Low. |
| T11 | **"This committee carries a role" is read through `src/lib/role-grants.ts`**, a new exported in-transaction reader `readGroupRoleGrantsInTx(tx, organizationId, groupId, asOf)` that checks no permission (its callers have gated). It returns `{ carriedRoles: Array<{ id: string; name: string }> }`. | R3.3 bars the committees tree from naming `role_grants`/`roleId`; `role-grants.ts` already owns every read of that table, and `listGrants` needs `role_grants.manage`, which a `groups.manage` holder may not have. | Low. |
| T12 | **0090 does not change `permissions.description` of `groups.manage`.** It stays "Create and edit managed groups (committees, small groups, choirs, teams) and manage their rosters". The Roles screen therefore does not mention commission records (accepted residual; a TODO line proposes a later data fix once 0.64.0 has shipped). | Rewording it in 0090 would claim commission records in 0.63.0, before they exist (the Copy truthfulness rule). | Low. |
| T13 | **A new page gate, `gateCommitteesPage`**, joins `gateReportPage`, `gateInsightsPage` and `gateOversightPage` over the private `gatePresbyteryPage` core in `src/lib/presbytery-reports/gate.ts` (`COMMITTEES_FLAG = "org_portal.committees"` joins the closed flag union). Order: signed in, Node-side second-factor recheck (`assertOrgSession`, which the placeholder lacked), the four-way org miss and `assertOrgAccess`, the flag, the organization type. The key is checked by each reader inside its own transaction. | The oversight precedent (DECISION-347). | Low. |
| T14 | **"Not yet labelled" is no row, or a row with `kind is null`.** A details row is created lazily (by create, by labelling, or by dissolve). Every save of the committee form requires a kind, so editing an unlabelled committee labels it. No backfill. | R2.3, Gap 10. | Low. |
| T15 | **Time.** Derivations (serving, starting later, past, dissolved) use the **organization's local calendar day** (`orgTimeZoneInTx`, as oversight's `readTodayInOrg`), injected into the pure functions. A server action's backstop validates against the server's UTC day (the oversight `serverEnv()` precedent, at most a few hours lenient); the public function uses `current_date` (UTC; R4.6, accepted). | Oversight precedent. | Low. |
| T16 | **Seed.** A pipeline-local `scripts/committees/seed-dev-committees.sql` (the oversight precedent), plus integration patches for the Rule 16 shared files. The legacy "Commission on Alder Creek" committee-type group stays **unlabelled** (it demonstrates the "Not yet labelled" state and keeps 46k and 68e untouched). | Rule 16; architect "Migration 0090" notes. | Low. |
| T17 | **Seat history is protected by the application, not by a grant.** `presby_app` holds `DELETE` on `groups` and `group_memberships` (read from the live catalog); `groups.ts` has no delete and the new tables have none. Filed as **F459**, tracked, not fixed here (revoking would break fixture teardown and three RLS suites that delete group rows). | Operator rule: all deletes are soft. | n/a |

**Proposed decisions (orchestrator records; the architect's 352 to 356 are in Phase 2).**

- **DECISION-357 — Committee seat dates and the atomic role change (T2 to T5).** All end-like dates are the first day the thing no longer applies and the copy says so; a role change is one transaction with one effective date for both rows and one audit row; seat overlap is interval overlap excluding zero-length rows, serialized by an advisory lock per committee; dissolve takes a non-future date and ends every seat (a not-yet-started seat zero-length); dissolution is one-way.
- **DECISION-358 — Commission record shape (T6 to T8, T12).** Commission member roles are the six committee titles under their own CHECK; the congregation is optional, resolved by `resolveMemberCongregation()` and fenced by the 0045 trigger under `WHEN (about_org_id is not null)`; one open seat per person per commission is a unique index; a live-parent guard serializes member inserts against ending and removal; a record has a one-way removal pair; no `group_id`, `role_id` or `public_listed` column exists on either table. The `groups.manage` description is left unchanged until Increment 2 has shipped.
- **DECISION-359 — The committees module's seams into shared code (T9 to T11, T13).** The committees store reaches `groups`/`group_memberships` only through `groups.ts` exports (`addManagedGroupSeatInTx`, `endManagedGroupMemberInTx`, `insertManagedGroupInTx`, `updateManagedGroupInTx`, `setManagedMembershipPublicListedInTx`) and role grants only through `role-grants.ts#readGroupRoleGrantsInTx`; the committees pages are gated by `gateCommitteesPage`; public-listing changes audit in the mutation's own transaction as `committee.member_listed|unlisted`; public display order is not offered at a presbytery.

**New findings (orchestrator records in `docs/schema-design-2.md`; the architect's F456 to F458 are in Phase 2).**

- **F459 (open, tracked, not fixed here).** `presby_app` and `presby_platform` hold `DELETE` on `groups` and `group_memberships` (live catalog, 2026-11-19). `groups.ts` never deletes and the new tables grant none, so committee and seat history is soft **by convention, not by grant**: a stray `delete from group_memberships` would erase "who chaired in 2025". Revoking needs the fixture teardowns (`e2e/support/*-fixture.ts`, `scripts/*/test-rls-*.sql`) rewritten first. Same family as F456's grant drift on the downward tables.
- **F460 (open, tracked, not fixed here).** A `committee`-type group at a presbytery can be the roster of an `administrative_commissions` row (the dev fixture "Commission on Alder Creek" is one; production holds 0 rows). The committees surface can end that group's seats (End term, Dissolve), which silently ends the resolver's commission-arm access for it. Inert while nothing writes `administrative_commissions` and production has none. Any future "commission grants access" pipeline must ship, with F456's list, either an exclusion of such groups from the committees surface or a roster that is not a committee group.

## Permissions & Flags

- **Permission:** the existing **`groups.manage`** (tier 1, no two-factor flag, `requires_two_factor = f`; live catalog) covers committees and commission records (Q2). **No new key, no `FEATURES.*` entry, no change to `src/lib/permissions.ts`, no change to `presby_founding_administrator_permission_keys()`** (0090 must not re-create it: F362 hazard, architect Invariants). The presbytery founding-administrator bundle already carries it (read from the live function: `people.manage, roles.manage, role_grants.manage, groups.manage, officers.manage, org_features.manage, tickets.file, staff.manage, domains.manage, careers.manage, careers.applicants, congregation_oversight.manage, congregation_oversight.finance`). No default role binding is added (do not bind it to the stated-clerk template: DECISION-078, DECISION-110 ruling 2).
- **Two-factor:** `groups.manage` is not among the flagged keys, so the feature adds no two-factor consequence; the Node-side recheck in `gateCommitteesPage` is for the reachable `/o/*` session claim, not a new requirement. (Confirmed in the live catalog: `requires_two_factor = f`.)
- **Flag:** the existing global **`org_portal.committees`** (seeded on; **on in production**, Phase 1 Q6 read). No new flag, no per-org toggle (operator: no new global flag pre-live). This pipeline graduates it: `comingSoon: true` leaves the tile, and the seed comment in `scripts/seed.ts` and TODO line 300 lose `committees` (orchestrator at integration). **Rollback is the flag**: off means the page says "isn't turned on for {name} yet", data stays, and a presbytery's committees cannot be edited at all (they have left `/admin/groups`, R1; production has zero committee groups). `org_portal.groups` is a separate flag and the committees tree must not depend on it.
- **Order, on every page, reader and action:** flag, then organization type, then `groups.manage` (flag never grants, permission never stages). Pages: `gateCommitteesPage`. Readers and writers repeat the org-type and key checks **inside their own transaction**.
- **E2E flags (named per spec):** every new committees spec sets `org_portal.committees` through `e2e/support/flags.ts` (`captureFlags` then `setFlag`, restored in `afterAll`); the groups-exclusion spec also sets `org_portal.groups`. **Nothing is added to `scripts/ci/e2e-baseline-flags.sql`** (no spec asserts a flag it cannot set; `org_portal.committees` is not in the baseline file today and the specs set it). The public committee directory (`sites.public_committee_directory`, on in production) is covered by DB and unit tests, not an e2e spec (no flag needed).
- **Production state read 2026-11-19 (Phase 1 Q6, orchestrator):** `org_portal.committees`, `org_portal.groups`, `org_portal.oversight`, `sites.public_committee_directory` all ON; `administrative_commissions` and `org_delegations` 0 rows; groups only of type court (4) and roster (10); `group_memberships` 10 rows, all `member`, `public_listed` 0. So the page goes live on the 0.63.0 deploy, and the public-roster fix-forward changes nothing visible today.

## Feasibility check (against the live tree, 2026-11-19)

- **Function signatures.** Two new invoker trigger functions with no parameters (they read `TG_ARGV`), one new invoker trigger function for the committee details guard, and one `create or replace presby_public_committee_roster(text, text default null, boolean default null)` with the **identical signature and return columns** of 0078 (`group_name, group_role, display_name, photo_key`). Parameter defaults already trail every required parameter. `presby_check_about_org_affiliated()` is declared with no arguments (it reads `TG_ARGV`); the call `presby_check_about_org_affiliated('about_org_id', '')` is the 0089 shape. Valid.
- **ALTER/DROP.** One `ALTER TABLE group_memberships ADD CONSTRAINT group_memberships_group_role_check CHECK (...)`, nothing dropped. **Live values:** the pipeline branch holds `chair` (1) and `member` (132); production holds only `member` (Q6). Every Drizzle and SQL caller of `group_role` uses chair, leader or member (grepped `src`, `e2e`, `scripts`; the only other literals are the validation-rejection tests `"boss"` and `"president"`, which never reach the database). Every derived-row insert (0009, 0017, 0062, 0066, 0068) writes `'member'` (read from each file). **No `SECURITY DEFINER` body references anything 0090 alters** except `presby_public_committee_roster`, which 0090 itself re-creates, and `presby_public_site_asset`, which calls it by name with one argument (still valid). `presby_reimbursement__is_seat` and `presby_worship_leads_team` match `group_role in ('chair','leader')` and are untouched.
- **New CHECKs and triggers against fixtures.** All three new tables are new and empty. The group-role CHECK cannot refuse any fixture (above); `scripts/seed-dev.sql` inserts `group_memberships` rows with the column default (`member`). The `committee_details` guard refuses a non-presbytery or non-committee group: the dev seed's presbytery committee-type group is `b0000000-…-000005` ("Commission on Alder Creek", managed, at the Northern Reach); no seed or fixture inserts a `committee_details` row yet, so nothing existing is refused. `scripts/giving/test-rls-46.sql` (46k) and `scripts/parishes/test-rls-68.sql` (68e) write `administrative_commissions` as `presby_app` and are **not touched** (0090 neither revokes nor re-points; F456/F460).
- **New FKs and the tenant column.** Every new table carries `organization_id` (the presbytery) on both sides of every FK: `committee_details (group_id, organization_id)` to `groups (id, organization_id)` (`groups_id_org_key`); `commission_record_members (commission_record_id, organization_id)` to `commission_records (id, organization_id)` (declared in the same file); `commission_record_members (person_id, organization_id)` to `memberships (person_id, organization_id)` (`memberships_person_org_key`, the shape of `group_memberships_person_fk`). `commission_records.about_org_id` is a plain FK to `organizations(id)` (the structural-table exception, as on `congregation_oversight`), fenced by the 0045 trigger. Section 0 refuses without the three target constraints.
- **Pins this change moves** (all found by grep; all in the implementer's batch):
  - `src/lib/db/domain/blob-audience.schema.test.ts`, `public-roster-photo.db.test.ts` and `src/lib/storage/public-asset.db.test.ts` read the committee roster function; their fixtures insert `group_memberships` rows that must now satisfy `starts_on <= current_date`, an active membership, no death and no dissolved details row. Run them first (B1) and edit fixtures only to satisfy the new predicates.
  - `scripts/person-photos/test-rls-78.sql:791`, `scripts/assets/test-rls-72.sql:223` and `scripts/test-rls.sql:5575` (properties of the function: definer, grants, row counts): unchanged signature and grants, so they pass unless a count includes a now-excluded row; run them as `presby_app`.
  - `src/app/(org)/o/[slug]/admin/committees/page.test.tsx` (the placeholder's test) is **replaced**; `src/app/(public)/site/[slug]/committee-directory.test.tsx` gains the four new titles; `src/lib/org-portal/tiles.test.ts` and `visible-tiles.test.ts` assert the tile key, scope and category (unchanged by dropping `comingSoon`; verify in B3).
  - `src/lib/help/coverage-allowlist.ts` and `coverage.test.ts:41,203` (pin 12 to 11; `tile:committees` leaves both lists); `src/lib/help/registry.ts` (delete the `presbytery-tools` entry; `slug-history.ts` already keeps its slug and `replaces` covers it).
  - `src/lib/audit.test.ts` pins the `AUDIT_ACTIONS` object by exact listing: append the new keys there (in B2 for Increment 1's, in the Increment 2 batch for its own).
- **Re-run before Phase 4 starts.** `origin/main` is still `21fa4b68` (fetched 2026-11-19); no open `pipeline/*` branch changes `groups.ts`, `drizzle/`, `help/registry.ts` or `audit.ts` against it. Learn 1b holds 0088 and is independent of 0090. **If `main` moves before B1 starts, B1 re-runs this check (grep `drizzle/`, `groups.ts`, the function body md5) before writing DDL**, and the orchestrator sets `_journal.json` order at integration.
- **Rule 16 shared files, none edited mid-pipeline:** `domain/index.ts`, `drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/dev-docs.ts`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/schema-design-2.md`, and existing `e2e/support/*`. They change by **integration patches** under `scripts/committees/` (`domain-index.ts.integration.patch`, `_journal.json.integration.patch`, `test-rls.sql.integration.patch`, `seed-dev.sql.integration.patch`, `dev-docs.ts.integration.patch`), exactly as `scripts/oversight/` did; code imports `@/lib/db/domain/committees` directly until then. `e2e/support/*` gets **new files only**. (`src/lib/db/domain/groups.ts` is not on the Rule 16 list and gains the role CHECK in B1.)
- **Dependencies:** none new.

## Data Model

One migration: **`drizzle/0090_presby_committees.sql`**, hand-written (`db:generate` is broken, per every migration since 0012), idempotent, applied twice as proof, **unreleased until applied to production** (so correctable in place until Increment 1 ships). Drizzle mirror: `src/lib/db/domain/committees.ts` (three tables and the guard-code constants the store maps). Apply (owner, direct endpoint, `-1` mandatory because the file has no transaction of its own): `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0090_presby_committees.sql`.

**Header.** Same shape as 0089: what the file does and does not do (no permission change, no bundle change, no audit row, no toggle row, no existing table dropped, no DELETE grant, **does not touch `administrative_commissions`, `org_delegations`, `role_grants` or any `role_id`**), the apply line, the order and dependencies (needs 0045, 0072, 0078; independent of 0088), the deploy order (this file **before** the 0.63.0 code; old code against the new schema is harmless because it only ever writes chair, leader or member and names none of the new tables), the idempotence proof, and the residuals (F456, F459, F460, the public-function UTC day, name uniqueness `paper`).

**File sections** (the architect's structure, numbered 0 to 6, plus a closing block 7):

### 0. Guards

A `do` block that raises `object_not_in_prerequisite_state` with the missing name when any of these is absent: `presby_person_public_photo(uuid, uuid)` (0078), `presby_check_about_org_affiliated()` (0045), constraints `groups_id_org_key`, `memberships_person_org_key`, `memberships_id_org_key`. It also raises, with the **distinct offending values** (role values are not personal data) and a count, if any `group_memberships.group_role` is outside the seven: "0090: N group_memberships row(s) hold a group_role outside the seven allowed values (…); correct them before applying".

### 1. The `group_role` CHECK (DECISION-354)

```sql
alter table group_memberships drop constraint if exists group_memberships_group_role_check;
alter table group_memberships add constraint group_memberships_group_role_check
  check (group_role in ('chair','leader','member','vice_chair','clerk','secretary','ex_officio'));
```

Mirror it in `src/lib/db/domain/groups.ts` (`check("group_memberships_group_role_check", …)`, and fix the stale `// chair | leader | member` comment). The three seat-predicate functions are unchanged.

### 2. `committee_details` (DECISION-353)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | |
| `organization_id` | `uuid not null references organizations (id) on delete cascade` | the presbytery; reachable only through the guarded fixture teardown |
| `group_id` | `uuid not null` | the committee group |
| `kind` | `text` | `check (kind is null or kind in ('required','standing','ad_hoc'))` named `committee_details_kind_check`; null is "Not yet labelled" |
| `dissolved_on` | `date` | `check (dissolved_on is null or dissolved_on >= date '1900-01-01')` |
| `dissolved_by` | `uuid references users (id)` | |
| `dissolved_at` | `timestamptz` | |
| `created_at` / `created_by` | `timestamptz not null default now()` / `uuid not null references users (id)` | |
| `updated_at` / `updated_by` | same shape | |

Constraints: `committee_details_id_org_key unique (id, organization_id)`; `committee_details_group_key unique (group_id)` (the 1:1); `committee_details_group_fk foreign key (group_id, organization_id) references groups (id, organization_id)`; `committee_details_dissolved_trio check ((dissolved_on is null) = (dissolved_by is null) and (dissolved_on is null) = (dissolved_at is null))`. Index: `committee_details_org_idx (organization_id)`.

**Trigger function `presby_committee_details_guard()`**, plpgsql, **SECURITY INVOKER**, `set search_path = public, pg_temp`, binds **every connection including the owner** (F44), `revoke all … from public, presby_app, presby_platform`. Owner test copied from 0078 `:205` / 0089 (`c.relowner = (select r.oid from pg_roles r where r.rolname = current_user)`):

- **INSERT** (all connections): the group must exist in the row's organization, be `membership_source = 'managed'`, and be of type `committee` (`join group_types gt on gt.id = g.group_type_id where gt.key = 'committee'`), and the organization must be `organization_type = 'presbytery'`; otherwise `raise exception … using errcode = 'check_violation', constraint = 'committee_details_target'` (the group/type/organization reads are RLS-safe for `presby_app`: `groups` is tenant-scoped to the row's own organization, `group_types` and `organizations` are `select`-granted). **Non-owner INSERT**: `dissolved_on`/`dissolved_by`/`dissolved_at` must be null (a new committee starts active; `constraint = 'committee_details_insert_dissolved'`) and `created_at := clock_timestamp()`. The owner may insert a dissolved row (the seed and the operator's import).
- **UPDATE:** `group_id`, `organization_id`, `id`, `created_at` and `created_by` cannot change (`constraint = 'committee_details_immutable'`); and **once `old.dissolved_on is not null` the row is frozen**: any change to any column raises `constraint = 'committee_details_dissolved_final'` (dissolution is one-way, DECISION-353).

Trigger `committee_details_guard before insert or update … for each row`.

**Grants/RLS** in section 4.

### 3. `commission_records` and `commission_record_members` (DECISION-355)

**`commission_records`** (the presbytery's own record of an administrative commission; **no `role_id`, no `group_id`, no `public_listed`**):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | |
| `organization_id` | `uuid not null references organizations (id) on delete cascade` | the presbytery |
| `about_org_id` | `uuid references organizations (id)` | **nullable**: the member congregation it concerns, if any |
| `title` | `text not null` | `check (char_length(btrim(title)) between 1 and 200)` `commission_records_title_length` |
| `charge` | `text` | `check (charge is null or char_length(charge) <= 500)` `commission_records_charge_length`; **never in audit metadata, a CSV, a log, an error, the public site or `/admin`** |
| `appointed_on` | `date not null` | `check (appointed_on >= date '1900-01-01')` `commission_records_appointed_floor` |
| `minute_reference` | `text` | `check (… <= 200)` `commission_records_minute_length` |
| `ended_on` | `date` | `check (ended_on is null or ended_on >= appointed_on)` `commission_records_ended_after_appointed` |
| `ended_minute_reference` | `text` | `check (… <= 200)`; `check (ended_minute_reference is null or ended_on is not null)` `commission_records_ended_minute_needs_end` |
| `ended_by` / `ended_at` | `uuid references users (id)` / `timestamptz` | `check ((ended_on is null) = (ended_by is null) and (ended_on is null) = (ended_at is null))` `commission_records_ended_trio` |
| `removed_at` / `removed_by` | `timestamptz` / `uuid references users (id)` | `check ((removed_at is null) = (removed_by is null))` `commission_records_removed_pair` |
| `row_version` | `integer not null default 1` | optimistic check on edit (the charge is sensitive; last-write-wins is the worst case) |
| `created_at` / `created_by` / `updated_at` / `updated_by` | as above | |

Constraints: `commission_records_id_org_key unique (id, organization_id)`. Indexes: `commission_records_org_idx (organization_id, appointed_on desc) where removed_at is null`; `commission_records_about_idx (organization_id, about_org_id) where about_org_id is not null` (an FK column index, B-L6).

**`commission_record_members`**:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | |
| `organization_id` | `uuid not null references organizations (id) on delete cascade` | |
| `commission_record_id` | `uuid not null` | |
| `person_id` | `uuid not null` | |
| `role` | `text not null default 'member'` | `check (role in ('chair','vice_chair','clerk','secretary','ex_officio','member'))` `commission_record_members_role_check` (**six; no `leader`**, T6) |
| `starts_on` | `date not null` | `check (starts_on >= date '1900-01-01')` |
| `ends_on` | `date` | `check (ends_on is null or ends_on >= starts_on)` `commission_record_members_end_after_start` |
| `created_at` / `created_by` / `updated_at` / `updated_by` | as above | |

Constraints: `unique (id, organization_id)`; `commission_record_members_record_fk foreign key (commission_record_id, organization_id) references commission_records (id, organization_id)`; `commission_record_members_person_fk foreign key (person_id, organization_id) references memberships (person_id, organization_id)`. Indexes: `commission_record_members_record_idx (organization_id, commission_record_id, starts_on)`; **unique** `commission_record_members_one_open_idx (commission_record_id, person_id) where ends_on is null` (T8).

**Triggers and functions** (all **SECURITY INVOKER**, `set search_path = public, pg_temp`, `revoke all … from public, presby_app, presby_platform`, bind the owner path too):

- **About-org (0045, reused):** `create trigger commission_records_about_org before insert or update on commission_records for each row when (new.about_org_id is not null) execute function presby_check_about_org_affiliated('about_org_id', '')`. **The `WHEN` is mandatory** (architect): without it a null congregation is refused, because the function passes the null to `presby_org_affiliated`. As of the current date (the present-tense question 0045 assigns to oversight); an update that does not move `about_org_id` passes (R9).
- **`presby_commission_guard_write()`** (the 0089 `presby_oversight_guard_write` shape; `TG_ARGV[0]` is the immutable-column list; same owner test): non-owner INSERT refuses `removed_*` and `ended_*` set (`constraint = 'commission_guard_insert_closed'`) and stamps `created_at := clock_timestamp()`; UPDATE refuses any change to a row whose `old.removed_at is not null` (`commission_removal_final`), refuses clearing or changing `ended_on`, `ended_by`, `ended_at` once `old.ended_on is not null` (`commission_ended_final`), and refuses a change to a listed immutable column (`commission_guard_immutable`). Attached as `commission_records_guard_write` with `'id,organization_id,created_at,created_by'` and as `commission_record_members_guard_write` with `'id,organization_id,commission_record_id,person_id,created_at,created_by'` (the members table has no removal or end pair, so its guard only stamps and protects immutables; the function reads the closed-state columns through `to_jsonb(new) ->> 'removed_at'` and never as `new.removed_at`, so one function serves both tables, where 0089's references the column directly because every one of its tables has it).
- **`presby_commission_live_guard()`**: before insert on `commission_record_members`, `select removed_at, ended_on from commission_records where id = new.commission_record_id and organization_id = new.organization_id for share`: a removed record raises `constraint = 'commission_record_closed'` for **every** connection; an ended record raises the same for a non-owner (the owner may insert history). `FOR SHARE` conflicts with the end and removal UPDATEs' row lock, so an add and an end serialize at the database (the 0089 building guard). A missing record is left to the composite FK to report.

### 4. RLS and grants

For all three tables: `alter table … enable row level security; alter table … force row level security;` one policy `tenant_isolation` (drop-then-create) `using (organization_id = presby_current_org()) with check (organization_id = presby_current_org())` (organization-only, **not** the "visible to both" shape of `administrative_commissions`, so the congregation a commission is about can never read it, by the database). `revoke all on … from presby_app, presby_platform;` then `grant select, insert on … to presby_app;` and **column-limited UPDATE, no DELETE, nothing for `presby_platform`:**

| Table | `presby_app` UPDATE columns |
|---|---|
| `committee_details` | `kind, dissolved_on, dissolved_by, dissolved_at, updated_at, updated_by` |
| `commission_records` | `about_org_id, title, charge, appointed_on, minute_reference, ended_on, ended_minute_reference, ended_by, ended_at, removed_at, removed_by, row_version, updated_at, updated_by` |
| `commission_record_members` | `role, starts_on, ends_on, updated_at, updated_by` |

### 5. The public roster fix-forward (DECISION-356, F457)

`create or replace function presby_public_committee_roster(p_slug text, p_committee text default null, p_has_priority boolean default null)` with the **0078 body carried exactly** (md5 of the live body `08030577…`, read by the architect; **B1 re-reads and compares before writing**) and these additions to the `where` clause. The full intended body:

```sql
create or replace function presby_public_committee_roster(
  p_slug text, p_committee text default null, p_has_priority boolean default null)
returns table (group_name text, group_role text, display_name text, photo_key text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select g.name as group_name, gm.group_role,
         coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name as display_name,
         ph.image_key::text as photo_key
    from group_memberships gm
    join groups g on g.id = gm.group_id and g.organization_id = gm.organization_id
    join organizations o on o.id = gm.organization_id
    join organization_sites s on s.organization_id = o.id
    join people p on p.id = gm.person_id
    join memberships m on m.person_id = gm.person_id and m.organization_id = gm.organization_id
    left join lateral presby_person_public_photo(o.id, p.id) ph on true
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live'
     and g.membership_source = 'managed'
     and gm.public_listed
     and gm.starts_on <= current_date
     and (gm.ends_on is null or gm.ends_on > current_date)
     and m.ended_on is null
     and p.date_of_death is null
     and p.merged_into_id is null
     and not exists (select 1 from committee_details cd
                      where cd.group_id = g.id and cd.organization_id = g.organization_id
                        and cd.dissolved_on is not null and cd.dissolved_on <= current_date)
     and (p_committee is null or lower(trim(g.name)) = lower(trim(p_committee)))
     and (p_has_priority is not true or gm.public_display_order is not null)
   order by g.name, coalesce(gm.public_display_order, 2147483647), display_name;
$$;
revoke all on function presby_public_committee_roster(text, text, boolean) from public;
grant execute on function presby_public_committee_roster(text, text, boolean) to presby_app;
```

`presby_public_site_asset()` calls this function with one argument and narrows with it (an unlisted member's photo stops being served; the intended direction). **No commission clause is needed**: commission members are structurally absent (no group row). The projection stays name, role title, display name and photo; **a test pins the column list** (D2 and test-rls-90 read `pg_get_function_result`). The kind label, dissolved state and any commission data never enter it. Observation, not changed: the function lists every `managed` group type a member was opted into (choirs and teams too), existing consented behaviour.

### 6. Comments

Table and column comments stating "the presbytery's own record, never the congregation's"; on `commission_records`: "NOT a grant: no role_id, no group_id (drizzle/0090, DECISION-355)", and that `charge` is tier-1-readable by `groups.manage` and never copied to audit, CSV or logs; on `committee_details.kind` ("null = Not yet labelled; no backfill"); on `group_memberships.group_role` (the seven values; **vice_chair, clerk, secretary and ex_officio are titles that carry no authority; the seat predicates in 0073 and 0085 stay exact-match on ('chair','leader')**); on each trigger function; and a restated comment on `presby_public_committee_roster` (the new predicates, the UTC day residual, "a commission member can never appear here").

### 7. Closing assertions

A `do` block that raises if: any of the three tables lacks `relrowsecurity` or `relforcerowsecurity`; fewer than three `tenant_isolation` policies; `presby_app` holds DELETE or TRUNCATE on any of the three; `presby_platform` holds any privilege on any of the three; `group_memberships_group_role_check` is missing; either commission table has a column named `role_id`, `group_id` or `public_listed` (`information_schema.columns`, the "no grant, by construction" fact); the three guard functions are not all SECURITY INVOKER with `search_path` pinned; any of the guard, about-org or live-guard triggers is missing or disabled; `presby_public_committee_roster` is not SECURITY DEFINER with `search_path` pinned or its result columns are not exactly `group_name, group_role, display_name, photo_key`; and the migration **never names `presby_founding_administrator_permission_keys`**: a `contract.test.ts` source scan of the file pins that (so the F362 integration hazard cannot reach this migration), and the block deliberately asserts no key list (a hard-coded one would break the day another pipeline's keys merge first).

### Seed and test files (integration patches, Rule 16)

- **`scripts/committees/test-rls-90.sql`** (the worship/oversight precedent: its own world built in `pg_temp.t90_world()`, every block ends in rollback; standalone as `presby_app`; one `\ir committees/test-rls-90.sql` line appended to `test-rls.sql` at integration). Sections: (a) structure (FORCE on three; one policy each; guard functions invoker with `search_path` pinned and owner-only EXECUTE; triggers enabled; the role CHECK; the three tables have no `role_id`/`group_id`/`public_listed` column where they must not); (b) grants by `aclexplode` (no DELETE/TRUNCATE for `presby_app`, nothing for `presby_platform`, exact UPDATE column lists); (c) role vocabulary (all seven insert; `'boss'` refused; **`presby_reimbursement__is_seat` and `presby_worship_leads_team` return false for a `vice_chair`, `clerk`, `secretary` and `ex_officio` row** on a chargeable group and on a worship team, and true for `chair` and `leader`, the architect's pin, built from the 73 and 85 worlds); (d) isolation (a second presbytery reads zero rows from all three and its writes are rejected; **the managed congregation a commission record is about, and its administrator, read zero rows**; a congregation's session reads zero; the platform role reads none); (e) composite keys (a `committee_details` row naming another organization's group, a commission member naming a person with no membership at the presbytery, and a member naming another presbytery's commission are each rejected by their FK); (f) the details guard (a derived Session group, a `choir`, a congregation's committee group are each refused; `group_id`/`organization_id` immutable; non-owner insert with `dissolved_on` set refused; owner insert allowed; a dissolved row frozen, kind included); (g) commission rules (null congregation accepted by the `WHEN`; never-affiliated and departed congregations refused on insert, an unrelated edit allowed; `ended_*` and `removed_*` one-way; non-owner insert of a closed record refused; a member of a removed record refused for every connection, of an ended record refused for non-owners and allowed for the owner; a concurrent add and end serialize through `FOR SHARE`; one open seat per person; the date and length CHECKs at their limits: title 200/201, charge 500/501, minute 200/201, dates 1899-12-31/1900-01-01; `ended_on` before `appointed_on`; `'leader'` refused as a commission role); (h) the public function, seven scenarios (a planned-end member is still listed before the end; a future-start member is not listed; an ended seat is not; an ended presbytery membership is not; a death is not; a dissolved committee is not; a commission member is structurally absent), the **column list** equals the four, and `presby_public_site_asset()` returns nothing for an unlisted member's photo key; (i) the **commission arm cannot see commission-record members** (the resolver, `presby_effective_permissions`, returns nothing for a person whose only link is a `commission_record_members` row, even for a congregation target); (j) the existing row `administrative_commissions` of the dev seed is **unchanged** by 0090 (count and `group_id`). Every mechanism is proven failing-first.
- **`scripts/committees/seed-dev-committees.sql`** (invented fixtures only; runs as the owner after `seed-dev.sql`; idempotent: `where not exists` on fixed ids; ids in `b0900000-…` for groups and details, `c0900000-…` for people, `e0900000-…` for users and roles, `d0900000-…` for commission rows; grepped free). At the Northern Reach (`1111…`): **Required** "Committee on Ministry" (chair, vice chair, clerk, two members, one ex officio) and "Nominating Committee"; **Standing** "Finance Committee" (with one planned end, one planned start and one ended seat, so every roster section shows) and "Mission Committee"; **Ad hoc** "Camp Property Study Group"; one **Dissolved** ad hoc committee "Spring Retreat Planning Group" (with past seats); the existing "Commission on Alder Creek" group left **unlabelled**; one member opted into public listing (for the public-function walk); one seat for a person whose presbytery membership has ended and one for a person with a date of death (the two status badges). **Commissions (rows exist from 0090; Increment 2 shows them):** one active commission about Alder Creek with a chair, a clerk and a member and a minute reference; one ended commission about no congregation with an `ended_minute_reference`. **Accounts:** a fixture "committees clerk" (a presbytery member holding a new adopted role with only `groups.manage`, no two-factor key, so it never forces TOTP on a walk) at `committees.clerk@example.invalid`, and a fixture presbytery member with no role at `committees.plain@example.invalid` (the denied state), both with the shared fixture password in `docs/testing.md`. B1 first checks whether an existing seeded presbytery account already holds `groups.manage` and reuses it if so. **No real name, address, email or number** (`example.invalid`, 555).
- **Integration patches** (B1 writes them; the orchestrator applies them): `_journal.json.integration.patch` (idx 90, `"tag": "0090_presby_committees"`, `when` greater than the 0089 entry's `1793825100000`), `domain-index.ts.integration.patch` (`export * from "./committees"`), `dev-docs.ts.integration.patch` (`committee_details`, `commission_records`, `commission_record_members` classified `"W. Presbytery committees"`; then `npm run docs:erd`), `test-rls.sql.integration.patch`, `seed-dev.sql.integration.patch`.
- **`scripts/committees/test-0090-migration.sh`** (D6, the `test-0089-migration.sh` template): 0090 applied twice from the real prior chain leaves identical function bodies, constraint definitions, trigger lists and row counts; **0090 without 0078 (and without 0045) is refused whole by its first statements**; the guard refuses a seeded row with a role outside the seven; the committee-roster function body before and after differs only by the additions above.

## Commission member role vocabulary (T6)

**Chosen: the same six titles as committees: chair, vice chair, clerk, secretary, ex officio, member. A closed CHECK of exactly those six on `commission_record_members.role`; no `leader`.**

Why:

1. **The first customer's own prototype uses one vocabulary for every body**, including the thing it calls a "commission" (Phase 1, prior art: `psvonline-portal` assignments carry the same six roles whatever the body type). Staff entering the real data by the one-time import will map one list, not two.
2. **One label map, one test, one roster component, one sentence.** `src/lib/group-roles.ts` carries the labels; the roster component, the "titles give no access" sentence and the role field's helper text serve both record kinds. A second vocabulary would double each, for a record that carries no behaviour.
3. **`leader` stays out** because it is the legacy seat word (it carries seat semantics in 0073 and 0085 for congregations); keeping it out of both new vocabularies means the legacy value only ever renders read-only on a pre-existing group.
4. **A CHECK of exactly six, not a superset**, so there is no value without a label (the F458 failure shape) and the unit test "the commission CHECK equals the committee offer set" is a plain equality.
5. **What I am not asserting:** whether this presbytery calls a commission's presiding member "Chair" or "Moderator". The record is titles only. **Operator question (non-blocking, default taken): "Chair".** If the answer is "Moderator", the cost is one forward migration widening this CHECK, one label and one test; the choice is reversible and does not touch committees.

## Module and file plan

Worktree root `/Users/cshenso/git/presby-platform/presby-committees`. **I = Increment 1, II = Increment 2.** A file with both marks is created in I and extended in II.

### `src/lib/group-roles.ts` (new, pure, **no imports**; R1)

The one closed `group_role` vocabulary (DECISION-354) and its labels: `GROUP_ROLE_VALUES` (the seven, equal to the 0090 CHECK, pinned by `contract.test.ts` parsing the migration), `GroupRoleValue`, `GROUP_ROLE_LABELS: Record<GroupRoleValue, string>` (Chair, Leader, Member, Vice chair, Clerk, Secretary, Ex officio), `GROUP_ADMIN_ROLES` (`chair, leader, member`: what `/admin/groups` offers, unchanged), `COMMITTEE_ROLES` (`chair, vice_chair, clerk, secretary, ex_officio, member`: what committees and commissions offer, in this display order), `SEAT_ROLES` (`chair, leader`: the roles 0073 and 0085 read as seats) and `TITLE_ONLY_ROLES` (`vice_chair, clerk, secretary, ex_officio`), `groupRoleSortRank(role)` (chair 0, leader 1, vice chair 2, clerk 3, secretary 4, ex officio 5, member 6). Imported by `groups.ts`, `committees/contract.ts`, `sites.ts`, `committee-directory.tsx` and `admin/groups/group-type-labels.ts` (whose `GROUP_ROLE_LABELS` becomes a re-export of the total map: **F458 closed**).

### `src/lib/committees/` (R-placement; the oversight module's shape)

| File | Server? | Contents |
|---|---|---|
| `contract.ts` (I, II) | pure, no runtime imports | `COMMITTEES_FLAG`, `GROUPS_MANAGE_KEY`; `COMMITTEE_KINDS` (`required`, `standing`, `ad_hoc` with labels Required, Standing, Ad hoc); `LIMITS` (`nameMax` 200, `purposeMax` 2000, `meetsWhenMax` 200, **II:** `titleMax` 200, `chargeMax` 500, `minuteMax` 200, `dateFloor` `1900-01-01`, `startAheadYears` 5, `endAheadYears` 10); the closed `CHANGED_FIELDS` an audit row may carry; `CommitteesViewer`, `CommitteesCtx`, `Outcome`, `Refusal`, `Written` types. A client form may import it. |
| `validate.ts` (I, II) | pure | one zod schema and one `parse*` per form, taking the form's **string** values (the same object `zodResolver` validated; the action re-parses it): `committeeSchema`, `seatSchema` (add), `changeRoleSchema`, `endSeatSchema`, `dissolveSchema`; **II:** `commissionSchema`, `commissionMemberSchema`, `endCommissionSchema`. `today` is **injected**, never read from the clock inside a rule. Helpers `parseDate`, `addYears(iso, n)`, `cleanLine`. |
| `copy.ts` (I, II) | pure | every user-visible string the module produces; the Copy section is its source (refusal messages, labels, states, toast text, validator messages, the two no-access sentences). One file so the copy check has one place to read. |
| `derive.ts` (I, II) | pure | `classifySeat(seat, today)` (`serving`, `planned`, `past`; a zero-length seat is `past`), `orderSeats` (role rank, then name), `splitRoster`, `chairNames`, `seatDatesText` (the "Since / Starts / Ends / Ended" lines), `groupCommittees` (sections by kind, Not yet labelled, Dissolved), `personStatus` (`connected`, `deceased`), `seatsOverlap(a, b)` (interval overlap ignoring zero-length rows), `addYears`. |
| `store.ts` (I, II) | `server-only` | **the only writer of the three new tables.** Every function is one `withOrgContext()` transaction (the actor must be an active member of the presbytery) that repeats the whole check, cheapest and least informative first: (1) `groups.manage` through `holdsPermissions` (live; RLS is tenancy only) → `forbidden`; (2) the organization is a presbytery → `forbidden`; (3) the committee (or commission) resolves to this organization, type `committee`, `managed` → `not_found`; (4) the seat row belongs to that committee → `not_found`; (5) the committee is not dissolved → `committee_dissolved`; (6) the staleness check → `stale`; the two advisory locks, `committee_names:{organizationId}` (create, rename) and `committee_seats:{organizationId}:{committeeId}` (add, change role, end, dissolve), are `pg_advisory_xact_lock(hashtextextended(key, 0))` taken **before any row lock** (the oversight and worship pattern); then writes, then `insertAuditRow(tx, …)` in the **same** transaction. Writes to `groups`/`group_memberships` go **only** through `@/lib/groups` exports (T10). |
| `reads.ts` (I, II) | `server-only` | one reader per section and form-default, each its own `withOrgContext` transaction and its own key and org-type check; `{ kind: "ok", data } \| { kind: "forbidden" } \| { kind: "not_found" }`. Names `groups`, `group_memberships`, `group_types`, `memberships`, `people` and the three new tables for **reads** only. |
| `action-gate.ts` (I, II) | `server-only` | `resolveCommitteesActor(slug, ids)`: `assertOrgSession(await auth())` first, then `resolveOrgContext`, then a UUID check on every id (the oversight `action-gate.ts` shape), plus `serverEnv()` and the `finish()` helper that revalidates paths. |
| `boundaries.test.ts` (I, II) | test | U5. |
| `audit-coverage.test.ts` (I, II) | test | U6. |

### Modified outside the module

| File | Change (I unless marked) |
|---|---|
| `src/lib/groups.ts` | **Additive** (T10, R1). (a) Export `addManagedGroupSeatInTx(tx, organizationId, input: { groupId, personId, groupRole, startsOn, endsOn? }, options: { allowedRoles: readonly GroupRoleValue[]; overlap: "open_row" \| "caller" })`: the body of the private `addManagedGroupRosterRowInTx` with three opt-in parameters. A role outside `allowedRoles` **throws** (a call-shape defect, like `addGroupMember`'s role check); `endsOn`, if given, may not be before `startsOn` (`invalid_input`, "The end date can't be before the start date."); `overlap: "caller"` skips only the `ends_on is null` open-row check (the caller has checked intervals under its lock); `"open_row"` is today's behaviour and the default of the two existing callers, which are untouched. (b) Export `setManagedMembershipPublicListedInTx(tx, organizationId, actingUserId, { groupMembershipId, publicListed })`: the managed-row lookup and update of `setGroupMembershipPublicListed`, with **no permission check and no audit**; `setGroupMembershipPublicListed` is refactored to call it with identical behaviour. (c) The **presbytery exclusion** in the nine gated functions only (list above): a private `isPresbyteryCommitteeSql(groupAlias)` fragment (`exists (select 1 from organizations o join group_types gt on gt.id = <g>.group_type_id where o.id = <g>.organization_id and o.organization_type = 'presbytery' and gt.key = 'committee')`) is added to the `listGroups` and `getGroup` queries; `getGroupFormOptions` omits the `committee` type at a presbytery; `updateGroup`, `addGroupMember`, `endGroupMembership`, `setGroupMembershipPublicListed` and `setGroupMembershipPublicDisplayOrder` return `invalid_target` for such a group or for a membership of one; `createGroup` returns `invalid_input` with the C10 sentence for the committee type at a presbytery. **The `*InTx` primitives are not restricted** (the committees store and worship gate on their own keys first). `GroupRosterEntry.groupRole` widens to `GroupRoleValue` (type only); `GROUP_ROLES` and `isGroupRole` stay at three. The **existing `groups.test.ts`, `groups.primitives.db.test.ts` and the worship store tests pass unmodified** (the pin); new cases go in a new file `groups.committees.db.test.ts` (D5). |
| `src/lib/role-grants.ts` | New export `readGroupRoleGrantsInTx(tx, organizationId, groupId, asOf)` (T11): the group's effective grants (`rg.group_id = $group`, `starts_on <= asOf`, `ends_on is null or > asOf`) joined to the role name; **no permission check, no audit**; returns `{ carriedRoles: Array<{ id: string; name: string }> }`. A test in `role-grants` pins that an ended grant and a person-principal grant are not returned. |
| `src/lib/presbytery-reports/gate.ts` + `contract.ts` (+ `gate.test.ts`) | `COMMITTEES_FLAG` joins `PresbyteryPageFlag`; add `gateCommitteesPage` over `gatePresbyteryPage` (T13); update the header comment. |
| `src/lib/audit.ts` (+ `audit.test.ts`) | Append the committee keys in an APPENDED block (below); **II:** the commission keys. |
| `src/lib/db/domain/committees.ts` (I, new) and `src/lib/db/domain/groups.ts` | the Drizzle mirror of the three tables and their guard-code constants; the role CHECK on `groupMemberships`. `export *` and `dev-docs.ts` ship as integration patches. |
| `src/lib/sites.ts:1831-1838` | `PublicCommitteeRosterEntry.groupRole` and `PublicCommitteeRosterRow.group_role` take `GroupRoleValue` (R4.5). |
| `src/app/(public)/site/[slug]/committee-directory.tsx:56` (+ test) | the label map becomes `Record<GroupRoleValue, string \| undefined>`: Chair, Leader, Vice chair, Clerk, Secretary, Ex officio; **Member renders no title** (as today). A unit test fails if any value in `GROUP_ROLE_VALUES` has no entry. Owned by **B2** with the `sites.ts` type, so each batch typechecks. |
| `src/lib/org-portal/tiles.ts:551-562` | drop `comingSoon: true`; description per C11 (I; II rewrites it). |
| `src/app/(org)/o/[slug]/admin/groups/page.tsx`, `groups-list.tsx`, `groups-list.test.tsx`, `page.test.tsx` | at a presbytery: the one-line pointer and the empty-state change (C10), driven by `resolved.org.organizationType` (no change to `listGroups`' return type). Congregations are byte-for-byte unchanged. |
| `src/app/(org)/o/[slug]/admin/groups/group-type-labels.ts` | `GROUP_ROLE_LABELS` re-exported from `@/lib/group-roles` (total map). |
| `src/lib/help/registry.ts`, `coverage-allowlist.ts`, `coverage.test.ts`, `slug-history.ts` | the new page; delete the `presbytery-tools` entry (`replaces`); remove the `tile:committees` allowlist entry; `ALLOWLIST_PIN` 12 to 11 and the file's "12 entries" sentence, adding "the presbytery committees page, docs/work-log/2026-11-19-presbytery-committees.md, covers `tile:committees`"; `tile:committees` leaves the "still lists" array at `coverage.test.ts:203`. |
| `src/content/help/` | the new page; edits to `roles-who-can-do-what.md`, `why-cant-i-see-this.md`, `privacy-policy.md` (C12, C13). |
| `docs/deployment.md` | a "Pre-deploy runbook: 0090" section (Deploy checklist below). |

**Routes** under `src/app/(org)/o/[slug]/admin/committees/` (**no `route.ts` and no `loading.tsx` anywhere beneath it**; the existing `page.test.tsx` is replaced):

| Path | Page | Co-located `actions.ts` |
|---|---|---|
| `page.tsx` (list) | I: committees by kind, Dissolved on request; **II:** the Administrative commissions section | none |
| `new/` | I: `page.tsx` (the form is `components/committees/committee-form.tsx`, shared with edit) | `actions.ts` (`createCommitteeAction`) |
| `[committeeId]/` | I: roster, carries-role note, actions | `actions.ts` (update, dissolve, add seat, change role, end seat, set listed) |
| `[committeeId]/edit/` | I: `page.tsx` | (uses the above) |
| `[committeeId]/members/new/` | I: `page.tsx` | (uses the above) |
| `[committeeId]/members/[membershipId]/role/` | I: `page.tsx` | (uses the above) |
| `commissions/new/` | **II** `page.tsx` | `commissions/actions.ts` |
| `commissions/[commissionId]/` | **II** record, roster, end and remove controls | `commissions/[commissionId]/actions.ts` |
| `commissions/[commissionId]/edit/`, `…/members/new/` | **II** | (uses the above) |

Next resolves the static segments `new` and `commissions` before `[committeeId]`, so the id `commissions` is never read as a committee id. Every id segment (`committeeId`, `membershipId`, `commissionId`) is parsed with `isUuid` (`src/lib/is-uuid.ts`) and **404s before any read** (F446). Every `page.tsx` calls `gateCommitteesPage`; every `actions.ts` calls `resolveCommitteesActor(` first. **No `callbackUrl` or `next` is ever read**: back-links are static paths built from the validated slug; the sign-in redirect carries the page's own fixed path.

**Components** `src/components/committees/` (new; server unless marked): `committees-list.tsx` (sections; cards below `sm`, a table at `sm` and above), `committee-card.tsx`, `kind-badge.tsx`, `role-badge.tsx`, `roster.tsx` + `seat-card.tsx` (cards below `sm`, a table at `sm` and above; **role and dates are never the first things hidden**), `carries-role-note.tsx`, `titles-note.tsx` (the C3 sentence), `committee-states.tsx` (forbidden, load error, section error, the empty states), `form-page-frame.tsx`, `unlabelled-prompt.tsx`; **client:** `end-term-dialog.tsx` and `dissolve-dialog.tsx` (AlertDialog with a plain controlled date input, no `useForm`, the oversight `retire-dialog` precedent), `public-listing-toggle.tsx` (a **copy** of the groups admin's control with its server action passed in as a prop; the committees tree imports nothing from `admin/groups/`), `date-field.tsx`. **Forms** (client, `react-hook-form` + `zodResolver`, each root inside `<HydrationGate>`, each with `useUnsavedChangesGuard`): `committee-form.tsx`, `add-member-form.tsx`, `change-role-form.tsx`; **II:** `commission-form.tsx`, `commission-member-form.tsx` (and `end-commission-dialog.tsx`, `remove-record-dialog.tsx`, no `useForm`). I count **three** `useForm` roots in Increment 1 and **two** more in Increment 2 for `check:hydration-gate`.

## API Contract

All mutations are Server Actions in `actions.ts` files marked `"use server"`. They take **plain objects of strings** (the form's values), never `FormData`. Common body, in this order (the oversight `action-gate.ts`): `assertOrgSession(await auth())` (a signed-out caller and a stale second factor get the same refusal string; `kind` tells a form which), `resolveOrgContext(userId, slug)` (not `ok` is "You don't have access to that organization."), a UUID check on every id (a malformed id is the one `not_found` string, before any SQL), the pure parse (an invalid result returns before any transaction opens), the `store.ts` call, then `revalidatePath` of the list and the committee page. **`organizationId` is never a parameter**: it comes from the resolution. Every action returns `ActionResult<{ id: string; unchanged?: boolean }>`; a refusal is `{ ok: false, error, kind, field? }` with **one fixed `copy.ts` string per refusal kind**, never raw database text; a thrown database error is caught in `store.ts` and returned as `save_failed`. `check:audit` sees no `db.` call in an `actions.ts` (the writes live in `store.ts`), so `audit-coverage.test.ts` and the DB tests stand in for the tripwire (the oversight and person-photos precedent).

**Refusal kinds** (the `copy.ts` table, C9, is the strings): `unauthenticated`, `two_factor_required`, `forbidden`, `not_found`, `invalid` (carries `field` and message), `duplicate_name` (carries the existing committee's name), `overlap` (carries the person's name and the committee's name), `not_a_member`, `committee_dissolved`, `already_ended`, `already_dissolved`, `same_role`, `date_before_start` (carries the date), `stale`, `save_failed`; **II:** `commission_ended`, `congregation_not_found`.

### Increment 1 actions (all key `groups.manage`)

| Action | Inputs (string values) | Store behaviour | Audit action and metadata |
|---|---|---|---|
| `createCommitteeAction(slug, v)` | `name, kind, purpose, meetsWhen` | advisory lock `committee_names:{org}`, then the case-insensitive trimmed duplicate check among **non-dissolved** committee groups (`duplicate_name` names the existing one), then `insertManagedGroupInTx` (the committee group type id resolved by key `committee`) and the details row (`kind`) | `COMMITTEE_CREATED` `{ organizationId, committeeId, kind }` |
| `updateCommitteeAction(slug, v)` | `committeeId, name, kind, purpose, meetsWhen` | the name lock and duplicate check **excluding itself**; `updateManagedGroupInTx` for name, purpose, meets-when; upsert of `kind` into `committee_details` (`on conflict (group_id) do update … where dissolved_on is null`); a dissolved committee is `committee_dissolved`; **no change writes nothing and audits nothing** (`unchanged: true`) | `COMMITTEE_UPDATED` `{ …, committeeId, changed: ("name" \| "purpose" \| "meetsWhen")[] }` when a field changed; `COMMITTEE_LABELLED` `{ …, committeeId, kind, previousKind: string \| null }` when the kind changed (a save can write both rows) |
| `dissolveCommitteeAction(slug, v)` | `committeeId, dissolvedOn` | seat lock; refuses a future date or one before the start of a seat that has begun (`date_before_start`); sets `dissolved_on/by/at`; ends every seat with `ends_on is null or > dissolvedOn` at `dissolvedOn` (a seat with `starts_on > dissolvedOn` is ended **at its own start**, zero-length) through `endManagedGroupMemberInTx`; counts them; `already_dissolved` if set | `COMMITTEE_DISSOLVED` `{ …, committeeId, dissolvedOn, seatsEnded: number, carriesRole: boolean }` |
| `addCommitteeSeatAction(slug, v)` | `committeeId, personId, role, startsOn, endsOn` | seat lock; the person must hold a **current** membership at this presbytery (`not_a_member`); `role` in `COMMITTEE_ROLES`; `startsOn` within the floor and `startAheadYears`; `endsOn` (if any) after `startsOn` and within `endAheadYears`; the **interval overlap check** (`overlap`); then `addManagedGroupSeatInTx(…, { allowedRoles: COMMITTEE_ROLES, overlap: "caller" })`; reads `readGroupRoleGrantsInTx` for the audit's `grantsRole` | `COMMITTEE_MEMBER_ADDED` `{ …, committeeId, membershipId, personId, role, startsOn, endsOn: string \| null, grantsRole: boolean, roleIds?: string[] }` (`roleIds` only when `grantsRole`) |
| `changeCommitteeSeatRoleAction(slug, v)` | `committeeId, membershipId, expectedRole, newRole, effectiveOn` | seat lock; the seat belongs to the committee (`not_found`); its role equals `expectedRole` and it is not ended (`stale`, `already_ended`); `newRole` in `COMMITTEE_ROLES` and different (`same_role`); `effectiveOn` per T3; **in one transaction** `endManagedGroupMemberInTx` (old `ends_on = effectiveOn`) then `addManagedGroupSeatInTx` (new row, `starts_on = effectiveOn`, `ends_on` = the old planned end or null, `overlap: "caller"`); the old seat's `public_listed` is carried to the new row (above); a legacy `leader` row is changeable and offers the six | `COMMITTEE_MEMBER_ROLE_CHANGED` `{ …, committeeId, membershipId, newMembershipId, personId, fromRole, toRole, effectiveOn, grantsRole: boolean, publicListed: boolean }` (**one** row; `publicListed` is the carried listing) |
| `endCommitteeSeatAction(slug, v)` | `committeeId, membershipId, endsOn` | seat lock; the seat is not already ended (`already_ended`); `endsOn >= starts_on` (the existing wording on a miss) and within `endAheadYears`; a seat that has not started is ended **at its own start** (the "Cancel planned term" path ignores the field); `endManagedGroupMemberInTx` | `COMMITTEE_MEMBER_ENDED` `{ …, committeeId, membershipId, personId, role, endsOn, cancelled: boolean }` |
| `setCommitteeSeatPublicListedAction(slug, v)` | `committeeId, membershipId, publicListed: boolean` | the seat is in this committee and serving now (`not_found` otherwise); `setManagedMembershipPublicListedInTx` | `COMMITTEE_MEMBER_LISTED` / `COMMITTEE_MEMBER_UNLISTED` `{ …, committeeId, membershipId, personId }` |

### Increment 2 actions (all key `groups.manage`; `commissionId` always resolved under this organization and not removed, else `not_found`)

| Action | Inputs | Store behaviour | Audit |
|---|---|---|---|
| `recordCommissionAction(slug, v)` | `title, charge, aboutOrgId, appointedOn, minuteReference` | `aboutOrgId` empty is null; otherwise `resolveMemberCongregation` or **one** neutral `congregation_not_found` for a congregation of another presbytery, a non-congregation and a nonexistent id (T7); the 0045 trigger is the database's second answer (its refusal maps to the same string) | `COMMISSION_RECORD_RECORDED` `{ organizationId, commissionId, aboutOrgId: string \| null }` |
| `updateCommissionAction(slug, v)` | the same plus `commissionId, expectedVersion` | row lock, `row_version` compare (`stale`), diff; **no change writes nothing**; an ended record's title, charge, minute and congregation may still be corrected (the guard freezes only the end and removal fields) | `COMMISSION_RECORD_UPDATED` `{ …, commissionId, changed: ("title" \| "charge" \| "congregation" \| "appointedOn" \| "minuteReference")[] }` |
| `addCommissionMemberAction(slug, v)` | `commissionId, personId, role, startsOn, endsOn` | the person holds a current membership (`not_a_member`); role in `COMMITTEE_ROLES`; the same date rules and **interval overlap** (`overlap`; the unique index is the database's backstop for an open seat); `commission_ended` if the record has ended (the live guard is the database's) | `COMMISSION_RECORD_MEMBER_ADDED` `{ …, commissionId, memberId, personId, role, startsOn, endsOn }` |
| `endCommissionMemberAction(slug, v)` | `commissionId, memberId, endsOn` | as `endCommitteeSeatAction` | `COMMISSION_RECORD_MEMBER_ENDED` `{ …, commissionId, memberId, personId, role, endsOn, cancelled }` |
| `endCommissionAction(slug, v)` | `commissionId, endedOn, endedMinuteReference` | `endedOn` not in the future and not before `appointed_on` or any begun member's start; sets `ended_*`; ends every open or longer member at `endedOn` (a not-yet-started member ends zero-length at its own start); `already_ended` | `COMMISSION_RECORD_ENDED` `{ …, commissionId, endedOn, membersEnded: number }` |
| `removeCommissionRecordAction(slug, v)` | `commissionId` | one UPDATE of the removal pair; `not_found` if already removed (the cut-able control) | `COMMISSION_RECORD_REMOVED` `{ …, commissionId }` |

**Audit keys (Increment 1: nine).** Appended to `AUDIT_ACTIONS` in `src/lib/audit.ts`, all `tenant.*`, written by `insertAuditRow` (`src/lib/audit-tx.ts`) **inside the mutation's own transaction** so a failed audit insert undoes the change (never `recordAudit()`, which opens its own connection and swallows its failure): `COMMITTEE_CREATED` `tenant.committee.created`, `COMMITTEE_UPDATED` `tenant.committee.updated`, `COMMITTEE_LABELLED` `tenant.committee.labelled`, `COMMITTEE_DISSOLVED` `tenant.committee.dissolved`, `COMMITTEE_MEMBER_ADDED` `tenant.committee.member_added`, `COMMITTEE_MEMBER_ROLE_CHANGED` `tenant.committee.member_role_changed`, `COMMITTEE_MEMBER_ENDED` `tenant.committee.member_ended`, and the two T9 keys `COMMITTEE_MEMBER_LISTED` / `COMMITTEE_MEMBER_UNLISTED` `tenant.committee.member_listed|unlisted`. `resourceType` `committee` with `resourceId` the committee's group id, except member events (`committee_member`, the membership id). **Increment 2 adds six:** `COMMISSION_RECORD_RECORDED|UPDATED|MEMBER_ADDED|MEMBER_ENDED|ENDED|REMOVED` `tenant.commission_record.recorded|updated|member_added|member_ended|ended|removed`, `resourceType` `commission_record`. The existing `group.*` and `group_membership.*` events stay with the groups admin, so the later presbytery audit log (decision G) can filter by prefix without resolving group types.

**Audit metadata is ids, closed enumerations, booleans, counts, dates and field NAMES only: never a committee name, purpose, meets-when text, commission title, charge or minute text, or a person's name,** because `audit_events` is platform-readable. `changed` is a subset of `CHANGED_FIELDS` in `contract.ts` (typed, so a value cannot be passed). `audit-coverage.test.ts` (U6) pins that every `store.ts` write function calls `insertAuditRow` in its transaction, the metadata key set per action equals the allowlist above, and a run with sentinel strings in every free-text field finds none of them in any audit row.

**Reads** (`reads.ts`; each its own `withOrgContext` transaction; an `OrgAccessError` is rethrown to `[slug]/error.tsx`; any other throw is caught by the page and renders a section load error):

| Reader | Returns |
|---|---|
| `readCommitteeList(viewer, { showDissolved })` | `forbidden` without the key (checked first, in the transaction); otherwise the committees at this organization: id, name, meets-when, kind (null = not labelled), dissolved date, the names of the chairs **serving today**, the count serving today; the dissolved ones only when asked, and always the dissolved **count**; the organization-local `today`. **A fixed number of queries (three) regardless of how many committees** (D4's counting wrapper). **II:** the commissions list (title, congregation name, appointed, ended, serving count) from `readCommissionList` in the same page, its own transaction. |
| `readCommittee(viewer, committeeId)` | one committee (a `small_group`, `choir`, `team`, derived, another organization's or a nonexistent id is `not_found`, one query filters type `committee`, `managed` and the organization), every seat with the person's display name, role, dates, `publicListed`, `personStatus` (`connected` from `memberships.ended_on`, `deceased` from `people.date_of_death`), and `carriedRoles` (T11); `today`. |
| `readCommitteeFormDefaults(viewer, committeeId?)` | the edit defaults (name, kind, purpose, meets-when) or `not_found`; a dissolved committee is `committee_dissolved` (the page renders the C4 state). |
| `readSeatFormOptions(viewer, committeeId)` | the people with a **current** membership at this presbytery (the F21 shape), each flagged `alreadyServes` when a seat is serving or planned; the committee name; `carriedRoles`; `today`. Zero eligible people is the guided empty state, never a bare empty select. |
| `readSeat(viewer, committeeId, membershipId)` | one seat under this committee (role, dates, person name) or `not_found`, for the change-role page and the dialogs. |
| **II** `readCommission(viewer, commissionId)`, `readCommissionFormOptions(viewer)` | the record, the roster, the congregation's name and whether it is still a member (`parent_id`), and the form's congregation choices from `listMemberCongregations` (no lifecycle filter, T7). |

Congregation-facing: **nothing.** No reader answers a congregation's session, and the tables' policy is organization-only.

## Component / Page Plan

**Every page's order of work:** `gateCommitteesPage` (signed in, `assertOrgSession`, the four-way org miss, `assertOrgAccess`, `org_portal.committees`, presbytery type; a `ReportGateState` renders through `committee-gate-state.tsx`, the sibling of `oversight-gate-state.tsx`) → `isUuid` on every id segment (else `notFound()`) → the section readers, computed **before the return with `Promise.all`** (never nested async components) → render. A reader's `forbidden` renders `CommitteesForbidden`; `not_found` renders `notFound()`; a section whose reader throws renders its own load error with a "Try again" link and the rest stays up; **no section reads a zero where "not recorded" is the truth**.

**The list** (`page.tsx`). h1 "Committees & Commissions", the presbytery's name, the "New committee" button, then sections in the order Required, Standing, Ad hoc, Not yet labelled (a section with no committee is omitted; the unlabelled one carries its prompt), then a "Show dissolved committees ({n})" link (`?show=dissolved`, a plain query parameter read as a fixed enum, never a redirect) and, when shown, the Dissolved section. Each committee is a card below `sm` (name as the link with `min-h-11`, kind badge, "Chair: …" or "No chair serving", "{n} serving", "Meets …") and a table row at `sm` and above (Name, Chair, Serving, Meets). A brand-new presbytery sees the guided empty state with "Create your first committee", never a bare "No committees". **II:** below it, the "Administrative commissions" section (cards and table by the same rules; its own empty state and "Record a commission").

**The committee page** (`[committeeId]/page.tsx`). Back link "Back to committees" (a static path from the validated slug), h1 the committee's name, badges (kind or "Not yet labelled"; "Dissolved {date}"), meets-when, purpose. For an active committee: "Edit committee", "Add a member", "Dissolve committee". The carries-role note (T11) when `carriedRoles` is not empty, then the titles note, then the roster in three sections: **Serving now** (the public-listing switch is shown here only), **Starting later**, **Past members** (omitted when empty). A seat is a card below `sm` and a table row at `sm` and above, with **role badge, name, dates and status badges always visible**; the row's actions are "Change role" (a link to the role page), the end control (the `end-term-dialog`: "End term", "Change end date" or "Cancel planned term", chosen by the seat's state) and the switch. A dissolved committee shows the dissolved note and no write control.

**Forms are full pages, never long dialogs.** Shared rules (U9): `HydrationGate` on every root; `useUnsavedChangesGuard`; dates are native `type="date"`; every control is `min-h-11` (44px); the submit is `min-h-11` and disabled while submitting; selects use the existing `SELECT_CLASSES`; a failed save keeps the form's contents and shows the refusal in a toast, a field error shows under its field with the field's own message; no native dialogs (AlertDialog for the destructive confirms). On success a create form `router.push`es to the committee page (a path built from validated props); an edit form returns to the committee page. **Date display:** a date-only value (`YYYY-MM-DD`) renders through `FormattedDate` / `src/lib/format-date.ts`, never `new Date("YYYY-MM-DD")` (the timezone-safe-dates lesson).

**360px.** Names wrap (`break-words`/`[overflow-wrap:anywhere]`, no truncation, no sideways scroll: a 200-character committee name and a 120-character person name are the e2e cases); the roster never hides role or dates below `sm` (the groups admin does, which is wrong for the field this feature is about); the dissolve and end dialogs are `max-w` bounded with stacked full-width buttons below `sm`. Badges use the existing `Badge` variants only (no new colour); dark-mode contrast is **unverified until the Phase 6 walk**.

**The groups admin at a presbytery** (T10, C10): one pointer line above the list; the type select lacks "Committee"; the empty state says "No groups yet".

## Implementation Order

### Increment 1 (0.63.0) — branch `pipeline/presbytery-committees`, dev port **3101** (pre-assigned, Rule 16); the production hydration lane sets `PW_PROD_PORT=3801` (the `playwright.config.ts` variable; 3800 is the shared default and this pipeline does not use it, so two pipelines never collide)

| Batch | Implementer | Work | Exit gate |
|---|---|---|---|
| **B1** | **database-admin** | `drizzle/0090_presby_committees.sql` (sections 0 to 7), `src/lib/db/domain/committees.ts`, the role CHECK in `domain/groups.ts`, `committees.schema.test.ts` (D1), `committees.db.test.ts` (D2: constraints, guards, RLS-visible behaviour on **both** connections, F44), `scripts/committees/test-rls-90.sql`, `test-0090-migration.sh` (D6), `seed-dev-committees.sql`, the five integration patches, and the pins listed in the Feasibility check (the three public-roster DB tests and the three RLS scripts run first; fixtures edited only to satisfy the new predicates). **Re-runs the Feasibility check first if `main` moved.** Applied to the pipeline Neon branch `br-calm-rice-ax2zn9jw`. | 0090 applied twice with identical digest; `test-rls-90.sql` and the patched `test-rls.sql` pass as `presby_app`; every mechanism proven failing-first; the three public-roster DB tests, `groups.test.ts` and `groups.primitives.db.test.ts` green; `npm run typecheck` |
| **B2** | **api-developer** | `src/lib/group-roles.ts`; the `groups.ts` additions and presbytery exclusion; `role-grants.ts#readGroupRoleGrantsInTx`; `committees/` `contract`, `validate`, `copy` (**Increment 1 strings from Copy only**), `derive`, `store`, `reads`, `action-gate`; `gateCommitteesPage`; the nine audit keys and `audit.test.ts`; `sites.ts` and `committee-directory.tsx` label map and test; the `actions.ts` files; `boundaries.test.ts` (U5, **including the downward-table and `admin/groups` rules from day one**), `audit-coverage.test.ts` (U6), `store.db.test.ts` (D3), `reads.db.test.ts` (D4), `groups.committees.db.test.ts` (D5), U1 to U4, U7, U11 | `npm run check` zero; the DB files above; **failing-first** for the audit-in-transaction rollback, the atomic role change (one row, same date, no gap) and the concurrency cases; the existing groups and worship suites green and unmodified |
| **B3** | **ux-developer** | the list, committee page, every form page and component, the three forms' tests (U8, U9), the tile (`comingSoon` removed, C11 description), the groups admin pointer and empty-state change, **the help page and the help edits written from the screens at 360px**, registry, allowlist and pin (12 to 11). **First, walk Community at a presbytery** (the participant and visitor path) and word the "person not yet recorded" help paragraph from what is on screen. | typecheck, build, `check:hydration-gate`, `check:help`, a 360px walk of every page and every state in a real browser, light and dark |
| **B4** | **full-stack-developer** | `e2e/support/committees-fixture.ts` (**new file only**), `committees-roster.spec.ts`, `committees-gates.spec.ts`, `hydration/committees-forms.spec.ts`, `docs/deployment.md` "Pre-deploy runbook: 0090", then run the founding-administrator walk for real | own server on 3101 (`E2E_BASE_URL`); the new specs green; production hydration lane green |

Order: B1 merges to the pipeline branch before B2 (B2 imports the Drizzle mirror); B2 before B3 (B3 imports `reads`, `copy`, `contract`); B4 starts when B3's pages exist.

### Increment 2 (0.64.0) — same branch after 0.63.0 is released, port 3101 (**no migration**; if the design later needs one, ask the orchestrator for a new number, never edit 0090)

| Batch | Implementer | Work | Exit gate |
|---|---|---|---|
| **B5** | **api-developer** | commission `contract`/`validate`/`copy`/`derive` additions, `store.ts` and `reads.ts` commission functions, the six audit keys and `audit.test.ts`, the three `actions.ts` files, `boundaries.test.ts` and `audit-coverage.test.ts` extensions, `store.db.test.ts` and `reads.db.test.ts` commission cases (incl. the congregation resolver: another presbytery's, a non-congregation and a nonexistent id give **byte-identical** answers) | `npm run check` zero; failing-first for the audit rollback, the live-guard race (add versus end) and the interval overlap |
| **B6** | **ux-developer** | the commissions section, record form, commission page, member form, end-commission and remove dialogs, the tile description, **the help rewrite** (C13 II) and the privacy and roles edits, 360px walk of every state, light and dark | typecheck, build, `check:hydration-gate`, `check:help`, 360px walk |
| **B7** | **full-stack-developer** | fixture additions, `committees-commissions.spec.ts`, `hydration/commissions-forms.spec.ts`, the regression of the Increment 1 specs, the founding-administrator walk for the commissions half | own server on 3101; specs green; production hydration lane green |

**Cut order if time forces it (Increment 2, then Increment 1; Phase 1 plus T8):** Increment 2: the "Remove this record" control, then `endCommissionMember` role display polish. Increment 1: planned end dates, then Dissolve, then the carries-role note. **Never cut** Change role, the guided empty states, the role titles on the public site, or the commission record itself.

## Deploy checklist (both increments; the orchestrator and operator run it; recorded in the child logs)

1. **0090 to production before the 0.63.0 code deploys.** (New code against the old schema fails on the missing tables and the role CHECK; old code against the new schema is harmless.) Migration connection per the existing `prod-migration-connection` practice (the endpoint-host swap); `psql -1`. Runbook text goes in `docs/deployment.md`.
2. **Before applying (read-only, record only the numbers):** `select group_role, count(*) from group_memberships group by 1` (2026-11-19: all `member`; the guard refuses anything outside the seven); `count(*) from group_memberships where public_listed` (0 on 2026-11-19, so the public-roster fix-forward changes nothing visible; if not 0, the release note must not say "nothing changes on the public site"); the md5 of the live `presby_public_committee_roster` body (must equal the 0078 body B1 carried).
3. **After applying:** apply it a second time and confirm a no-op (the closing assertions pass); no backfill notice exists in this file.
4. **Operator:** `org_portal.committees` stays **on** (it is, in production): **the page goes live with the 0.63.0 deploy**, so deploy it when the operator is ready to demo; rollback is flipping the flag off. Confirm `org_portal.groups` is on. `sites.public_committee_directory` is on in production and unchanged (a Rule 17 event only if the operator flips it).
5. **Phase 6 walk** on `development` at 360px as **the person the presbytery's founding-administrator invitation path creates** (that is how a real user holds `groups.manage`) and as a presbytery member with no key.
6. **Increment 2** deploys code only (no migration).

## Copy

Every user-visible string the feature adds or changes. **An implementer who needs a string that is not here stops for a ruling.** `{name}` is a person's, committee's or presbytery's name as stored (React text, never HTML); `{date}` is a date-only value through `FormattedDate`. Strings marked **(II)** ship in Increment 2.

**Accepted residuals no string may deny** (the Phase 1 and Phase 2 record, plus this phase): (1) a committee can carry a role, so adding someone is an access change (audited with `grantsRole`); (2) a founding administrator can appoint themselves to a committee (`paper`); (3) the person list is the presbytery's own records, so a ruling elder may exist twice (Gap 1, `presby_match_person` cleans up later) and a roster cannot say which congregation an elder comes from; (4) a person who has left the presbytery keeps their seat until someone ends it (R6.1); (5) ex officio is entered by hand and does not follow an office (Gap 13); (6) the public committee list switches on and off by the **UTC** day, so up to a day early or late (R4.6); (7) public listing's own caveat (turning it off is not a retraction; the existing copy); (8) committee-name uniqueness is checked by the application, not the database (`paper`; a miss merges headings on the public site); (9) dissolution is one-way and a mistaken one needs an operator data fix; (10) **II:** anyone with `groups.manage` at the presbytery reads a commission's charge (Phase 2's accepted tier-1 residual) and the presbytery's own audit shows no read; (11) `groups.manage`'s description on the Roles screen does not mention commission records (T12); (12) committee and seat history is protected by the application, not by a database grant (F459); (13) F456 and F460 on the downward tables are tracked, not fixed. **Nothing below says "everyone", "nothing is kept", "no one else can see", or "this can never happen".**

### C1. Whole-page states (`/o/<slug>/admin/committees/**`) — viewers: any signed-in person who reaches the URL

| String | Where |
|---|---|
| "Committees & Commissions isn't turned on for {name} yet." | flag off (the existing `PlaceholderFlagOff`, area "Committees & Commissions") |
| "Committees & Commissions isn't available for {name} — this isn't the kind of organization this tool is built for." | not a presbytery (the existing `PlaceholderNotAvailable`) |
| the byte-identical org denial and the ended notice | `OrgAccessDenied`, `OrgAccessEnded` (existing; DECISION-040) |
| "You don't have permission to manage committees at {name}. If you think this is a mistake, ask your presbytery's administrator." | a presbytery member without `groups.manage` (`CommitteesForbidden`; h1 "Committees & Commissions") |
| "We couldn't load committees right now. Try again in a moment." with a "Try again" link | a reader threw (`CommitteesLoadError`) |
| "We couldn't load this. Try again." with a "Try again" link | one section's reader threw (the rest of the page stays) |

1. *Residuals:* none denied. 2. *Source:* the flag is `isFlagEnabled("org_portal.committees")` and the type is the resolved organization's; the key is `presby_has_permission(…, 'groups.manage')` inside the reader's own transaction. 3. *Audience:* "ask your presbytery's administrator" is read by a presbytery member who holds an active relationship but not `groups.manage`; the presbytery's founding administrator holds `role_grants.manage` and can grant it (bundle read from the live function), so the instruction is actionable. "isn't turned on … yet" is the existing global-flag phrase; the help page says who turns it on. 4. *Neighbours (grepped 2026-11-19 for committee, commission):* `admin/committees/page.tsx:17,19` (the placeholder and its "planned but not yet built" description: **deleted with the page body**); the existing flag-off and not-available components are reused unchanged.

### C2. The list

| String | Where |
|---|---|
| h1 "Committees & Commissions"; subtitle "{presbytery name}" | page head |
| "The committees of {name}, and who serves on each." | intro (I) |
| **II:** "The committees of {name}, who serves on each, and the administrative commissions it has recorded." | intro (II) |
| "New committee" | button |
| "Required committees", "Standing committees", "Ad hoc committees", "Not yet labelled" | section headings |
| "No label has been chosen for these committees yet. Open each one and choose Required, Standing or Ad hoc." | under "Not yet labelled" |
| Kind badge values "Required", "Standing", "Ad hoc" | badges |
| Table head "Name", "Chair", "Serving", "Meets" | at `sm` and above |
| "Chair: {names}" (several: "Chair: {a}, {b}"), or "No chair serving" | row and card |
| "{n} serving" | row and card (n = 1 reads "1 serving") |
| "Meets {meetsWhen}" | row and card, only when set |
| "Show dissolved committees ({n})" / "Hide dissolved committees"; heading "Dissolved committees"; row meta "Dissolved {date}" | the Dissolved section |
| Empty (no committee of any kind): "No committees yet" / "Start with the committees your presbytery is required to have, then add standing and ad hoc ones as you need them." / button "Create your first committee" | guided empty state |

1. *Residuals:* none denied. 2. *Source:* "Chair" and "{n} serving" are the seats whose `starts_on <= today < ends_on` (or `ends_on` null) with **today = the organization's local date** (`readCommitteeList`; `reads.db.test.ts` pins a seat that ends today and one that starts tomorrow); "No chair serving" is the absence of such a `chair` seat (so a committee whose only chair's term has ended says it); "Not yet labelled" is no details row or `kind is null`; "Dissolved {date}" is `dissolved_on` with `dissolved_on <= today` always true (T5). The Not-yet-labelled note says only that no label **has been chosen**, not that the committee predates labels (an imported committee also has none). "required to have" is the clerk's own label, not a polity citation. 3. *Audience:* presbytery staff holding `groups.manage`, who can create, label and open committees. 4. *Neighbours:* `tiles.ts:554` (modified, C11); `groups-list.tsx:35` "No committees or groups yet" (modified at a presbytery, C10); `src/app/page.tsx:192` ("committees and groups", marketing, true); `what-presbyportal-does.md:11` (true).

### C3. The committee page

| String | Where |
|---|---|
| "Back to committees" | back link |
| "Meets {meetsWhen}"; the purpose text | under the heading |
| "Edit committee", "Add a member", "Dissolve committee" | actions (an active committee) |
| "This committee was dissolved on {date}. Its roster is kept here as history." | a dissolved committee (no write control is shown) |
| Titles note: "Chair, vice chair, clerk, secretary and ex officio are titles. A title doesn't give anyone access." | above the roster |
| Carries note, one role: "Everyone serving on this committee also holds the {role} role, so adding someone here gives them that role's access." Several: "Everyone serving on this committee also holds these roles: {a}, {b}. Adding someone here gives them their access." | only when `carriedRoles` is not empty |
| "Serving now", "Starting later", "Past members" | roster headings |
| "No one serves on this committee yet." / button "Add a member" | empty roster |
| Role badges: "Chair", "Leader", "Vice chair", "Clerk", "Secretary", "Ex officio", "Member" | seat |
| "Since {date}"; "Starts {date}"; "Ends {date}" (a planned end, on a serving seat); "Started {date}" and "Ended {date}" (past); "Ended the day it started" (a zero-length seat) | seat dates |
| "No longer connected to this presbytery" | badge, when the person's membership here has ended |
| "Recorded as deceased" | badge, when the person has a date of death |
| "Change role" | link (per seat; sr-only " for {name}") |
| "End term" (a serving seat without a planned end); "Change end date" (a serving seat with one); "Cancel planned term" (a seat that has not started) | the end control |
| Public listing: badge "Public"; the switch's accessible name "List {name} publicly on {committee}'s public roster, currently on|off"; dialog titles "List {name} publicly on {committee}'s roster?" / "Stop listing {name} publicly on {committee}'s roster?"; the consent text `listingConsentCopy({name})`; the off text "This stops serving {name}'s listing going forward. It does not retract anything already cached or indexed elsewhere (search engines, web archives) — turning this off is not a full retraction."; buttons "Yes, list publicly", "Yes, stop listing", "Cancel"; toasts "{name} is now listed publicly on {committee}'s roster." / "{name} is no longer listed publicly on {committee}'s roster." | the switch (**copied from the groups admin's control, strings unchanged**) |

1. *Residuals:* the titles note says titles give no access and **does not** say membership gives none (residual 1); the carries note states the residual in words; the off-listing text keeps the "not a full retraction" caveat (residual 7); the "No longer connected" badge states residual 4 as a fact. 2. *Source:* "Since/Starts/Ends/Ended" are `starts_on`/`ends_on` classified by `classifySeat` against the local day (half-open: `ends_on` today is **Ended**; `derive.test.ts` pins the boundary); the carries note is `readGroupRoleGrantsInTx` for **grants effective today** to this group (a person grant, an ended grant or a grant to another group is not counted); "No longer connected" is `memberships.ended_on is not null` for that person at **this** presbytery (it does not say the person has left every organization); "Recorded as deceased" is `people.date_of_death is not null`; "Public" is `group_memberships.public_listed`. The public toast says "is now listed publicly", which is true only where `sites.public_committee_directory` is on and the site has a committee block: **pre-existing wording, unchanged, not made worse** (the help page says where a listing appears). 3. *Audience:* `groups.manage` holders, who can edit, add, end and dissolve; the carries note names roles but gives **no instruction** because the reader may lack `role_grants.manage`. 4. *Neighbours:* `admin/groups/[groupId]/page.tsx:200` (`GROUP_ROLE_LABELS[…]`: a congregation's roster; unchanged for three roles, total after F458); the groups toggle strings (`public-listing-toggle.tsx`) are copied byte for byte, not edited; `committee-directory.tsx:56` (modified, C11).

### C4. Create and edit a committee

| String | Where |
|---|---|
| Page titles "New committee" and "Edit {name}"; back link "Back to committees" (create) or "Back to {name}" (edit) | |
| Fields: "Committee name"; "Kind" with the first option "Choose one" then "Required", "Standing", "Ad hoc"; "Purpose (optional)"; "When it meets (optional)" | form |
| Kind helper: "Required: a committee your presbytery has to have. Standing: ongoing from year to year. Ad hoc: formed for one task." | under Kind |
| Buttons "Create committee" / "Save changes"; "Cancel" | form |
| Toasts "Committee created." / "Committee saved." | on success |
| Errors: "Name is required."; "Name must be 200 characters or fewer."; "Choose Required, Standing or Ad hoc."; "Purpose must be 2000 characters or fewer."; "When it meets must be 200 characters or fewer." | fields |
| `A committee named "{existing}" already exists. Choose a different name.` | `duplicate_name` (names the **stored** name of the existing one) |
| "This committee was dissolved. A dissolved committee is kept as history and isn't edited here." | the edit page for a dissolved committee (no form) |
| Unsaved-changes guard text: the existing `useUnsavedChangesGuard` copy | |

1. *Residuals:* none denied (name uniqueness is stated as a refusal, not a guarantee). 2. *Source:* the duplicate sentence names the existing committee found by the case-insensitive trimmed comparison among **non-dissolved** committee groups at this organization (`store.db.test.ts` pins that a dissolved committee's name is reusable and that the sentence quotes the stored spelling). 3. *Audience:* `groups.manage` holders. 4. *Neighbours:* `admin/groups/new-group-form.tsx:127` placeholder "e.g. Property Committee" and `:67` "No group types are available yet. Contact support before creating a committee or group." (reviewed: true for congregations; at a presbytery the type select still offers small group, choir and team, so the second never shows).

### C5. Add a member

| String | Where |
|---|---|
| Title "Add a member to {committee}"; back link "Back to {committee}" | |
| The titles note (C3) | under the title |
| The carries warning: "This committee carries the {role} role. Adding someone here also gives them that role's access." (several: "…carries these roles: {a}, {b}. Adding someone here also gives them their access.") | only when it carries |
| Fields: "Person" (first option "Choose a person"; an option already serving reads "{name} (already serves)" and is disabled); "Role" (Chair, Vice chair, Clerk, Secretary, Ex officio, Member); "Starts on"; "Ends on (optional)" | form |
| Role helper: "Ex officio means serving because of another office. It is entered by hand and doesn't change if that office changes hands." | under Role |
| Starts helper: "The first day they serve. A later date plans an appointment ahead of time." Ends helper: "The first day they are no longer on the committee. Leave it empty if the term has no set end." | under the dates |
| Person helper: "Don't see them? People serve on a committee from the presbytery's own records, so add them under Community first. If you don't see Community, ask your presbytery's administrator." | under Person |
| Buttons "Add to committee", "Cancel"; toast "Added to the committee." | |
| Empty: "No one is available to add" / "People serve on a committee from the presbytery's own records, so add them under Community first. If Community is off for {presbytery}, turn on "Community: add people and record roll actions" under Features. If you don't see Community or Features, ask your presbytery's administrator." | when `readSeatFormOptions` returns no eligible person |
| Errors: "Choose a person."; "Choose a role."; "Choose a start date."; "That date isn't valid."; "The start date can't be more than 5 years ahead."; "The end date has to be after the start date."; "The end date can't be more than 10 years ahead." | fields |
| `{personName} already serves on {committee} during those dates. Use "Change role", or end that term first.` | `overlap` |
| "That person is no longer connected to this presbytery, so they can't be added." | `not_a_member` |
| "This committee has been dissolved, so no one can be added." | `committee_dissolved` |

1. *Residuals:* the helper says the list is the presbytery's own records (residual 3) and that ex officio is by hand (residual 5); the carries warning states residual 1. 2. *Source:* the people list is `memberships.ended_on is null` at this organization (the F21 shape); "(already serves)" is a seat that is serving or planned on this committee; the overlap sentence is the interval check's result and its names are the stored person and committee names. "Community: add people and record roll actions" is the live toggle label (`turning-features-on-and-off.md:32`). 3. *Audience:* `groups.manage` holders. "Add them under Community" needs `people.manage` and the Community toggle, which the presbytery's founding administrator holds and can turn on; a clerk holding only `groups.manage` is told to ask the administrator, which is why the sentence names both. "Features" is the org-features page the toggle lives on. 4. *Neighbours:* `adding-people.md:6` ("Turn on 'Community: add people and record roll actions'": a congregation page, unchanged, true); `first-day-as-administrator.md:34` (`"Groups": committees, small groups, choirs and teams.`: a congregation page; reviewed, unchanged).

### C6. Change a role

| String | Where |
|---|---|
| Title "Change {name}'s role"; subtitle "Now {Role}, since {date}." (a planned end adds " It ends {date}.") | |
| Fields "New role" (the six, without the current role; a legacy Leader row still offers the six), "Effective on" | |
| Helper: "The new role starts on this date and the old role ends the same day, so there is no gap. Both stay in the history." A planned end adds: "The new role keeps the same end date, {date}." A listed person adds: "{name} is listed on the public website, and the new role title will show there." | under Effective on |
| Buttons "Change role", "Cancel"; toast "Role changed." | |
| Errors: "Choose a different role."; "The effective date can't be before {date}, when this role began."; "The effective date has to be before this term ends on {date}."; "The date can't be more than 5 years ahead." | fields |
| "This seat was changed by someone else after you opened it. Reload the page, then try again." | `stale` |
| "That term has already ended." | `already_ended` |

1. *Residuals:* none denied. 2. *Source:* "no gap" is the store setting the old `ends_on` and the new `starts_on` to the same value in one transaction (`store.db.test.ts` pins both values and that a role at no instant is held twice or not at all); "Both stay in the history" is the old row kept with its end date; the listed-person sentence is the old seat's `public_listed` (the store carries it; D3 pins that the public function then returns the new title) and, like the public toast, is true where the public committee list is on. 3. *Audience:* `groups.manage` holders. 4. *Neighbours:* Phase 1 Flow 3's "ends the old stint the day before" is **superseded** (T3), nowhere in a live string.

### C7. End a term (dialog)

| String | Where |
|---|---|
| Title "End {name}'s term?"; with a planned end "Change when {name}'s term ends"; for a seat that has not started "Cancel {name}'s planned term?" | |
| Body: "Their name stays in the history of this committee, with its dates." With a carried role: "Ending the term also ends the access that comes from belonging to this committee." | |
| Field "Ends on" (default today); helper "The first day they are no longer on the committee. To record their last day of service, enter the day after it." (no field for a planned-start seat) | |
| Buttons "End term", "Save end date", "Cancel planned term"; the dismiss button "Go back" | |
| Toasts "Term ended.", "End date saved.", "Planned term cancelled." | |
| Errors: "The end date can't be before the start date." (the existing wording); "The end date can't be more than 10 years ahead." | |

1. *Residuals:* the access sentence is conditional on the carries read (residual 1 stated, not denied). 2. *Source:* "ends the access that comes from belonging" is the resolver's group arm reading `group_memberships` dates (`presby_effective_permissions` arm 2: `ends_on > as_of`); it does **not** claim the person loses a role they hold another way. 3. *Audience:* `groups.manage` holders. 4. *Neighbours:* `admin/groups/end-group-membership-dialog.tsx` (the congregation's; its strings are untouched).

### C8. Dissolve (dialog)

| String | Where |
|---|---|
| Title "Dissolve {committee}?" | |
| Body: "This ends every term on the committee on the date you choose and moves it to "Dissolved committees". No one can be added afterwards, and it can't be undone from this page. The roster is kept as history." With a carried role: "This committee carries the {role} role. Dissolving it ends the access that comes from belonging to it." | |
| Field "Dissolved on" (default today); helper "The first day the committee no longer exists. Everyone's term ends on this date. It can't be in the future." | |
| Buttons "Dissolve committee", "Go back"; toast "Committee dissolved." | |
| Errors: "The dissolve date can't be in the future."; "A member started on {date}. The dissolve date can't be before that." | |

1. *Residuals:* "can't be undone from this page" states residual 9 and **does not claim** it cannot be undone at all; the carries sentence is residual 1 stated. 2. *Source:* "No one can be added afterwards" is `committee_dissolved` from the store (the sole writer; `paper` at the database, pinned by `store.db.test.ts` and `boundaries.test.ts`) and the frozen details row; "moves it to Dissolved" is the list's partition on `dissolved_on`; the member-start sentence's date is the latest `starts_on` among seats that have begun. 3. *Audience:* `groups.manage` holders. 4. *Neighbours:* none (no live string speaks of dissolving a group).

### C9. Refusals and toasts (the fixed strings; one per refusal kind, never database text)

| Kind | String |
|---|---|
| `unauthenticated`, `two_factor_required` | "You must be signed in to do that." |
| `forbidden` (action) | "You don't have permission to manage committees here." |
| org not resolvable | "You don't have access to that organization." |
| `not_found` (committee, seat, person, id malformed, wrong type, another presbytery's: **identical**) | "That committee could not be found." |
| `not_found` (a seat or member specifically) | "That member could not be found." |
| `already_dissolved` | "This committee has already been dissolved." |
| `save_failed` | "We couldn't save that. Nothing was changed. Try again." |

The other kinds' strings live where they are used and are **the** strings for those kinds: `duplicate_name` (C4), `overlap`, `not_a_member`, `committee_dissolved` (C5), `same_role`, `date_before_start`, `stale`, `already_ended` (C6, C7, C8); **II:** `commission_ended` and `congregation_not_found` (C15). `copy.test.ts` (U3) fails if any `Refusal` kind has no string.

1. *Residuals:* none. 2. *Source:* the strings are fixed per kind; the two `not_found` strings differ only by the object the form named, never by whether it exists elsewhere (DECISION-040; `store.db.test.ts` pins byte-identity for a committee of another presbytery, a `choir`, a derived Session group and a nonexistent UUID). 3. *Audience:* the acting `groups.manage` holder. 4. *Neighbours:* `admin/groups/actions.ts` reuses "You must be signed in to do that." and "You don't have access to that organization." (the same wording, deliberately).

### C10. The groups admin at a presbytery (T10; a congregation sees none of this)

| String | Where |
|---|---|
| "Committees of {name} are kept under Committees & Commissions." with "Committees & Commissions" linking to `/o/{slug}/admin/committees` | one line above the groups list, **only when the organization is a presbytery** |
| "No groups yet" / "Add your first one to get started." | the groups empty state at a presbytery (replaces "No committees or groups yet", which would be false there) |
| "Committees at a presbytery are kept under Committees & Commissions." | `createGroup` for the committee type at a presbytery (only a hand-built request can reach it: the type select omits "Committee") |

1. *Residuals:* none. 2. *Source:* the organization type is `resolved.org.organizationType`; "kept under" is true because the exclusion in `listGroups`/`getGroup` is in SQL (U10/D5 pin that a presbytery committee never appears there). 3. *Audience:* `groups.manage` holders at a presbytery, who also hold the committees key, so the link works (when `org_portal.committees` is off the target page says so honestly, and the data stays). 4. *Neighbours (modify):* `groups-list.tsx:35` (the empty heading), `groups-states.tsx:23` ("Committee and group administration isn't turned on for {name} yet": reviewed, left: it speaks about the **groups** flag, true on the groups page); `new-group-form.tsx:67,127` (reviewed, left, above).

### C11. The tile and the public site's role titles

| String | Where |
|---|---|
| Tile label "Committees & Commissions" (unchanged, Q7); description **I:** "The presbytery's committees and who serves on them." **II:** "The presbytery's committees, who serves on them, and the administrative commissions it has recorded." | `tiles.ts:551-562`; the "Coming soon" pill leaves the tile grid and the portal footer |
| The public committee list's role titles: "Chair", "Leader", "Vice chair", "Clerk", "Secretary", "Ex officio"; a Member shows no title (unchanged) | `committee-directory.tsx` |

1. *Residuals:* none denied. 2. *Source:* the tile description says only what the shipped increment does (the label keeps "Commissions" because Q7 settled it; Increment 1's description does not claim them). The titles are `group_role` as `presby_public_committee_roster()` projects it. 3. *Audience:* presbytery staff (tile); the public (titles). 4. *Neighbours:* `tiles.ts:554` (modified), `portal-footer.tsx:153` and `tile-grid.tsx:123` render "Coming soon" from `comingSoon` (the flag leaves the tile: pinned by `tiles.test.ts`), `coverage-allowlist.ts:29` (deleted).

### C12. The help page `src/content/help/presbytery-committees.md` (published in Increment 1, replaces the planned placeholder `presbytery-tools`)

**Registry entry** (`registry.ts`): `slug: "presbytery-committees"`, `title: "Committees and commissions"`, `summary: "Keep a presbytery's committees and who serves on them, with dated titles."` (II: "…and its record of administrative commissions."), `order: 90`, `status: "published"`, `audience: "administrator"`, `needs: { who: "Presbytery staff with the permission to create and edit managed groups and manage their rosters. A presbytery's Founding Administrator has it from the first day.", appliesTo: "presbyteries" }`, `covers: ["tile:committees"]`, `replaces: ["presbytery-tools"]`, `anchors: ["who-can-use-it", "the-list", "adding-a-member", "titles-give-no-access", "dates-when-a-term-ends", "dissolving-a-committee", "administrative-commissions", "if-something-looks-wrong"]` (each must match a heading, rule H4), `verifiedIn: "0.62.0"` (the checker needs a version no greater than `package.json`; **the `/release-notes` commit sets it to the release only after Phase 6 has walked the page**, Workflow Rule 17), no `requires`, no `limitationUntil`, **no screenshots** (text only; recorded so Phase 6 does not look for one).

**`labels`** (each is a string on a screen; `check:help` confirms): "Committees & Commissions", "Governance & Courts", "New committee", "Create your first committee", "Create committee", "Edit committee", "Add a member", "Add to committee", "Change role", "End term", "Change end date", "Cancel planned term", "Dissolve committee", "Dissolved committees", "Show dissolved committees", "Required", "Standing", "Ad hoc", "Not yet labelled", "Serving now", "Starting later", "Past members", "Ends on", "Starts on", "Effective on", "Dissolved on", "No longer connected to this presbytery", "Recorded as deceased", "Public", "Community", "Features", "Try again". Each label must also appear in the page text (rule H10), so the draft below says each one.

**Page text, Increment 1** (the full draft; B3 walks the screens and corrects any string that differs, and Community at a presbytery for the paragraph marked †):

> Where "Committees & Commissions" is turned on, a presbytery keeps its committees here: what each one is for, who serves on it and in which role, and for how long. This page is for the presbytery's staff. It does not change anything a congregation has recorded.
>
> Open your presbytery's page, then choose "Committees & Commissions" under "Governance & Courts".
>
> ## Who can use it
>
> You need the permission described as "Create and edit managed groups (committees, small groups, choirs, teams) and manage their rosters". A presbytery's Founding Administrator has it from the first day. To give it to someone else, create a role that includes it under "Roles" and give the role to them. See [Roles: who can do what](/help/roles-who-can-do-what). Without it, the page says "You don't have permission to manage committees at" and your presbytery's name. If the page says "Committees & Commissions isn't turned on", the PresbyPortal team switches it on for the whole platform: {{contactAdmin}}
>
> ## The list
>
> Committees are grouped as "Required committees", "Standing committees" and "Ad hoc committees". Each shows its chair, how many people serve now, and when it meets. A committee with no label yet is under "Not yet labelled": open it, choose "Edit committee", and choose "Required", "Standing" or "Ad hoc". The label is the presbytery's own; PresbyPortal does not decide which committees are required.
>
> ## Starting a committee
>
> Choose "Create your first committee" if there are none yet, or "New committee". Give it a name, choose its kind, and add a purpose and when it meets if you like. Two active committees cannot have the same name, ignoring capital letters. Choose "Create committee".
>
> ## Adding a member
>
> Open the committee and choose "Add a member". Choose the person, the role, and the day they start under "Starts on". If the term has a set end, add it under "Ends on (optional)". Then choose "Add to committee". A later start date plans an appointment ahead of time: the person shows under "Starting later" until that day.
>
> The people you can choose are the presbytery's own records. † A ruling elder from a congregation, or anyone not yet recorded, has to be added under "Community" first, as a participant or visitor; if "Community" is off, turn on "Community: add people and record roll actions" under "Features". See [Adding people and recording members](/help/adding-people). The presbytery's record and the congregation's own record of the same person are separate, so the same person can appear twice.
>
> The roles are "Chair", "Vice chair", "Clerk", "Secretary", "Ex officio" and "Member". More than one person can be chair. A person holds one role on a committee at a time. "Ex officio" is entered by hand: it does not change when the office behind it changes hands.
>
> ## Titles give no access
>
> Chair, vice chair, clerk, secretary and ex officio are titles. A title does not give anyone access to anything. The one exception is a role given to a whole committee: if the committee carries a role, the page says "Everyone serving on this committee also holds the" role, because adding someone then gives them that access. Roles are given under "Roles".
>
> ## Dates: when a term ends
>
> "Ends on" is the first day a person is no longer on the committee, not their last day of service. To record that someone served through 31 December, enter 1 January. A term that ends on a day after today shows "Ends" and that date, and the person stays under "Serving now" until then.
>
> ## Changing a role
>
> Choose "Change role" on a person's row, choose the new role, and choose the day it starts under "Effective on". The old role ends the same day, so there is no gap, and both stay in the history under "Past members".
>
> ## Ending a term
>
> Choose "End term" on a row, choose the date, and confirm. The person moves to "Past members" with their dates. A term that has a planned end shows "Change end date" instead, and a term that has not started shows "Cancel planned term". Nothing is deleted.
>
> A person who has left the presbytery stays on the roster until you end their term. Their row says "No longer connected to this presbytery". A person recorded as deceased shows "Recorded as deceased".
>
> ## Dissolving a committee
>
> Choose "Dissolve committee" and choose the date under "Dissolved on". It cannot be after today. Every term on the committee ends on that date, and the committee moves to "Dissolved committees" (choose "Show dissolved committees"). No one can be added to it afterwards, and the page offers no way to undo it. Its roster stays as history.
>
> ## Showing a member on your public website
>
> On a row under "Serving now", the switch lists the person on your website's committee list, where your website has one, and a person who is listed shows a "Public" badge. Turning it on shows a confirmation that explains the name and role become visible to anyone visiting the website, including search engines. The website shows the person's name and role title, and a photo if one has been chosen for the website, and only while their term is under way: a term that has not started or has ended is not shown, and neither is a person who has left the presbytery or has died. The listing changes at midnight in universal time, so it can lag or lead the date by up to a day. Turning a listing off stops it from now on and does not recall anything a search engine or web archive already kept.
>
> ## Administrative commissions
>
> This page keeps committees. It does not keep administrative commissions, so record those in your own minutes.
>
> ## If something looks wrong
>
> - A page that says "You don't have permission to manage committees at": you do not hold the permission above. Ask your presbytery's administrator.
> - A committee under "Not yet labelled": it has no label yet. Open it and choose one.
> - A name that is refused as already in use: another active committee has that name. Choose a different one, or dissolve the other.
> - A section that fails to load has a "Try again" link, and the rest of the page still works.

Banned phrases (H8) checked against the draft above: none (the draft says "later start date" and "after today", not "in the future"; there is no "planned", "coming soon", "will be able to" or "next release"). `npm run check:help` is the gate.

1. *Residuals:* the page states residuals 3, 5, 6, 7, 9 and the carries exception in words; it does not say "no one can see"; it says a listing "does not recall" cached copies. 2. *Source:* each claim about behaviour is a C2 to C8 claim already sourced; "Two active committees cannot have the same name" is the application check (it says "active", which is what the check scopes to); "the PresbyPortal team switches it on for the whole platform" is the global flag (as the congregation-records page says of its own). 3. *Audience:* presbytery staff; "ask your presbytery's administrator" and "Roles" are reachable by the Founding Administrator; "{{contactAdmin}}" is the existing help token. 4. *Neighbours (grepped):* `registry.ts:1165-1172` the `presbytery-tools` placeholder (**deleted**; its `today` sentence "There is no committees-and-commissions module" is the claim this change falsifies); `slug-history.ts:31` keeps the slug through `replaces`; `coverage-allowlist.ts:29` (deleted); `presbytery-reports.md` and `congregation-records.md` make no committee claim (reviewed); `turning-features-on-and-off.md` needs no edit (the global flag is not on its table).

**TODO line 29 and the `[help:presbytery-tools]` token (orchestrator, at integration, in the same commit that deletes the registry entry).** The planned placeholder's token sits on the open Track P umbrella line. That line **stays open** (offices, mission giving, worship times and the audit log are other pipelines). The new page is `published` with no `requires`, so it needs **no token**. **Ruling: remove `[help:presbytery-tools]` from line 29.** (H12 fails a planned entry whose token is absent, and passes a token that no entry uses, so deleting the entry and the token in one commit is correct in either order; deleting only the token while the entry stands would fail `check:help`.) Then run `grep -n "\[help:" docs/TODO.md` and read each remaining open token against what has merged.

### C13. Edits to other help pages

| Page | Edit |
|---|---|
| `roles-who-can-do-what.md` | in "What a Founding Administrator can and cannot do", the bullet "create and manage groups, and record staff positions;" becomes "create and manage groups, and record staff positions. At a presbytery this also covers its committees: see [Committees and commissions](/help/presbytery-committees);". In "A presbytery's Founding Administrator": a sentence "It can also keep the presbytery's committees and who serves on them, where "Committees & Commissions" is turned on, using the permission described as "Create and edit managed groups (committees, small groups, choirs, teams) and manage their rosters". See [Committees and commissions](/help/presbytery-committees)." **II:** "…and the presbytery's record of administrative commissions." (the Roles-screen description itself is unchanged: residual 11; the page says nothing about it). |
| `why-cant-i-see-this.md` | under "The page says it "isn't turned on"", a new line: "A presbytery page named "Committees & Commissions" or "Congregation Oversight" is switched on by the PresbyPortal team for the whole platform, not in "Features". {{contactAdmin}}" (the existing line "an administrator can turn it on in "Features"" is true of toggles and false of these two global switches; the sentence adds the exception). `labels` gain "Committees & Commissions" and "Congregation Oversight". |
| `privacy-policy.md` | one bullet under what an organization may keep, after "officers and their terms, and groups": "- committees, with who serves on them and in which role. A person appears on a public website only if the organization chose to list them". **II:** "…and, for a presbytery, its own notes about administrative commissions, which are never published". |
| `adding-people.md`, `first-day-as-administrator.md`, `what-presbyportal-does.md`, `turning-features-on-and-off.md`, `presbytery-reports.md`, `congregation-records.md` | **reviewed, no edit** (congregation pages, or true unchanged): recorded so Phase 6 does not look for one. |

1. *Residuals:* the privacy bullet says a person appears publicly only if the organization chose to list them (the opt-in is per member; no denial of residual 7). 2. *Source:* the `why-cant-i-see-this` claim is the two flags' definition (`org_portal.committees` and `org_portal.oversight` are global `feature_flags` rows, not organization toggles; `scripts/seed.ts`). 3. *Audience:* everyone who reads a "not turned on" page. 4. *Neighbours:* `why-cant-i-see-this.md:40-41` (modified); `congregation-records.md` (the same global-flag sentence, true).

### C14. Increment 1 release-note lines (written for non-engineers; the `/release-notes` skill places them)

- "Presbyteries can now keep their committees on the Committees & Commissions page: each committee's purpose, whether it is Required, Standing or Ad hoc, and who serves on it as chair, vice chair, clerk, secretary, ex officio or member, with dates."
- "A person's role can change on a set day without a gap, and a term can be given an end date ahead of time. A committee that is finished can be dissolved; its history stays."
- "These titles do not give anyone access by themselves."
- "The public committee list on a congregation's or presbytery's website now shows Vice chair, Clerk, Secretary and Ex officio titles, and it leaves out anyone whose term has not started or has ended, anyone who has left the organization, and anyone recorded as deceased, near the day it happens. [Only if the deploy-day count is 0:] Nobody was listed there yet, so no listing changes today."
- "At a presbytery, committees are kept on this page instead of under Groups."
- "Administrative commissions are not part of this page."
- "Every change is recorded in the audit trail. Looking at a committee is not."

1. *Residuals:* the third line states residual 1's other half; the last line states that reads are not audited. 2. *Source:* the "Nobody was listed" sentence is conditional on the **deploy-day count** of `public_listed` rows, not the 2026-11-19 read; "near the day it happens" states residual 6 without naming the UTC rule. 3. *Audience:* administrators and the operator. 4. *Neighbours:* `docs/release-notes/v0.62.md` makes no committee claim.

### C15. Increment 2 strings (commissions; **II**)

| String | Where |
|---|---|
| Section heading "Administrative commissions"; intro "The presbytery's own record of the administrative commissions it has appointed. A record gives no one access to a congregation's PresbyPortal, and the congregation does not see it." | the list section |
| Button "Record a commission" | |
| Empty: "No administrative commissions are recorded." / button "Record a commission" | |
| Row: the title as the link; "About {congregation}" or "No congregation recorded"; "Appointed {date}"; badge "Active" or "Ended {date}"; "{n} serving" | card and table (columns Title, Congregation, Appointed, Status, Serving) |
| "Show ended commissions ({n})" / "Hide ended commissions" | `?show=ended` |
| Commission page: back link "Back to committees"; h1 the title; "About {congregation}" (a congregation that has left the presbytery: "About {congregation} (no longer a member of this presbytery)"); "Charge"; "Appointed {date}"; "Minute: {reference}" or "No minute recorded"; ended: "Ended {date}" and "Reported in: {reference}"; **the no-access sentence:** "This record gives no one access to {congregation}'s PresbyPortal, and {congregation} does not see it." (no congregation: "This record gives no one access to any congregation's PresbyPortal.") | |
| Roster headings "Serving now", "Starting later", "Past members" and the C3 role badges, date lines, status badges; the titles note (C3) | the same `roster` component |
| Actions "Edit commission", "Add a member", "End commission", "Remove this record" | commission page |
| Record form: "Record a commission" / "Edit commission"; fields "Title", "Charge (optional)", "Congregation (optional)" (first option "No congregation"), "Appointed on", "Minute reference (optional)"; charge helper "Describe the charge in general terms. Don't record confidential details here. Anyone who can manage committees at this presbytery can read it."; minute helper "For example, the meeting date and item."; buttons "Record commission" / "Save changes"; toasts "Commission recorded." / "Commission saved." | |
| Errors: "Title is required."; "Title must be 200 characters or fewer."; "Charge must be 500 characters or fewer."; "Minute reference must be 200 characters or fewer."; "Choose the date it was appointed."; "That date isn't valid." | fields |
| "That congregation could not be found among {presbytery}'s member congregations." | `congregation_not_found` (one wording for another presbytery's, a non-congregation and a nonexistent id) |
| "This record was changed by someone else after you opened it. Reload the page, then make your change again." | `stale` |
| Member form: title "Add a member to {title}"; the person, role and date fields and helpers of C5; buttons "Add to commission", "Cancel"; toast "Added to the commission."; overlap "{personName} already serves on this commission during those dates. End that term first."; "This commission has ended, so no one can be added." | |
| End a member's term: the C7 dialog with "End {name}'s term on this commission?" | |
| End dialog: title "End this commission?"; body "This ends every member's term on the date you choose and records that the commission has ended. The record is kept, and it can't be reopened from this page."; fields "Ended on" (helper "The first day the commission no longer exists. Every member's term ends on this date. It can't be in the future.") and "Minute reference for its report (optional)"; buttons "End commission", "Go back"; toast "Commission ended."; errors "The end date can't be in the future."; "The end date can't be before {date}, when it was appointed."; "A member started on {date}. The end date can't be before that."; "This commission has already ended." | |
| Remove dialog: title "Remove this record?"; body "Use this only for a record entered by mistake. It will no longer be listed here, and this page can't bring it back. To record that a commission finished, end it instead."; buttons "Remove record", "Go back"; toast "Record removed." | |
| Help `presbytery-committees` **rewrites** the "Administrative commissions" section (below), adds labels ("Administrative commissions", "Record a commission", "Record commission", "Edit commission", "End commission", "Remove this record", "Charge", "Appointed on", "Minute reference (optional)", "Congregation (optional)", "No congregation"), and changes the registry `summary` and the C2 intro. **Every added label must be said in the page text (H10):** B6 adds a field-by-field sentence to the draft below (for example, `Fill in "Title", "Charge (optional)", "Congregation (optional)" (or choose "No congregation"), "Appointed on" and "Minute reference (optional)", then choose "Record commission".`) or drops the label | help |

> ## Administrative commissions
>
> An administrative commission is a body the presbytery appoints to carry out a task, often about one congregation. This page keeps the presbytery's own record of each one: its title, what it was charged with, which congregation it concerns, when it was appointed and by what minute, and who serves on it. Choose "Record a commission" under "Administrative commissions".
>
> **A record gives no one access.** It does not open a congregation's PresbyPortal to the commission's members, it does not change what any congregation can see, and the congregation does not see the record. It is the presbytery's note. Members serve in the same six roles as a committee, and the same rules for dates apply: "Ends on" is the first day a person is no longer on it.
>
> The charge is for general terms (up to 500 characters). Do not record confidential details. Anyone who can manage committees at your presbytery can read it, and PresbyPortal does not record who has read it. It is never copied into the audit trail.
>
> Choose "End commission" when it has reported: every member's term ends on the date you choose and the record moves under "Show ended commissions". Choose "Remove this record" only for one entered by mistake; the page offers no way to undo it. Recording, changing, ending and removing a commission are recorded in the audit trail; the title, charge and minute are not copied into it.

1. *Residuals:* residual 10 is **stated** twice (charge helper, help); the no-access sentence says "gives no one access" and "does not see it", true by construction (no role or group column; organization-only policy) and **not** "no one at the presbytery can see it". 2. *Source:* "gives no one access" rests on `commission_records` having no `role_id`/`group_id` (the 0090 closing assertion) and on `boundaries.test.ts` forbidding any write of the downward tables; "{congregation} does not see it" rests on the `tenant_isolation` policy (`test-rls-90.sql` (d) reads zero rows as the congregation's session and administrator); "no longer a member" is `organizations.parent_id` not equal to this presbytery; "{n} serving" is the C2 rule on `commission_record_members`. 3. *Audience:* `groups.manage` holders, who can record, edit, end and remove. 4. *Neighbours (grepped 2026-11-19, "commission"):** `tiles.ts:554` (modified, C11), `registry.ts:1166-1171` (deleted in I), `dev-docs.ts:516` ("The only downward paths are an administrative commission and a congregation-granted delegation": true and unchanged; this feature adds neither), `admin/committees/page.tsx:19` (deleted in I). **II also edits:** `roles-who-can-do-what.md` and `privacy-policy.md` (C13), the C2 intro and the C11 tile description.

### C16. Increment 2 release-note lines

- "Presbyteries can now record their administrative commissions on the Committees & Commissions page: the title, what it was charged with in general terms, the congregation it concerns if any, when and by what minute it was appointed, who serves on it, and when it ended."
- "This is the presbytery's own record. It gives no one access to a congregation's PresbyPortal, and the congregation does not see it."
- "Anyone who can manage committees at the presbytery can read a commission's charge, so keep it to general terms."
- "Every change is recorded in the audit trail without the title, charge or minute. Looking at a record is not."

1. *Residuals:* line 3 states residual 10; line 4 states the unaudited read. 2. *Source:* as C15. 3. *Audience:* administrators and the operator. 4. *Neighbours:* the 0.63.0 line "Administrative commissions are not part of this page" (superseded in `v0.63.md` history only).

## Test plan

DB-backed tests run serially against the pipeline Neon branch (`npx dotenv -e .env.local -- vitest run --no-file-parallelism <file>`, `docs/testing.md`). **Every mechanism is proven failing-first** (the implementer shows the test red against a deliberately broken guard, then green), the standing practice for guards.

**Unit (no database).**

| ID | File | Pins |
|---|---|---|
| U1 | `src/lib/committees/validate.test.ts` | every schema's boundaries: name 0/1/200/201; purpose 2000/2001; meets-when 200/201; a kind outside the three; a role outside `COMMITTEE_ROLES` (including `leader`); dates at the floor (`1899-12-31`, `1900-01-01`), start `today+5y` and `+1 day`, end `today+10y` and `+1 day`, end equal to and before start, a change-role effective date before the seat's start and on or after its planned end, a dissolve date today and tomorrow; control characters and unicode in names; `today` is **injected** (no fake timers); **II:** title 0/1/200/201, charge 500/501, minute 200/201, appointed-on bounds |
| U2 | `derive.test.ts` | **half-open boundaries:** `ends_on = today` is past, `starts_on = today` is serving, `ends_on = tomorrow` is serving and labelled "Ends", `starts_on = tomorrow` is "Starting later"; a zero-length seat is past ("Ended the day it started"); role order (chair, leader, vice chair, clerk, secretary, ex officio, member, then name); co-chairs both listed; `chairNames`; `seatsOverlap` (adjacent `[a,b)`/`[b,c)` do not overlap, contained and open-ended do, **zero-length rows are ignored**); `groupCommittees` sections and the Dissolved partition; `personStatus` |
| U3 | `copy.test.ts` | every message `validate.ts` and `store.ts` can return exists in `copy.ts`; every `Refusal` kind has a string; **no date-field string contains "Last day"**; no string contains "the day before"; the titles note and the two no-access sentences equal the Copy section byte for byte; the two `not_found` strings are the only ones that differ by object; no string says "everyone can", "no one else can see" or "nothing is kept" |
| U4 | `contract.test.ts` | `COMMITTEE_KINDS`, `COMMITTEE_ROLES` (also as the commission CHECK, six), `GROUP_ROLE_VALUES` (seven) and every limit equal the CHECK lists and `char_length` bounds **parsed out of `drizzle/0090_presby_committees.sql`** (a list changed in one place fails) |
| U5 | `boundaries.test.ts` | R3.3's rules, each with a **failing sample**: no owner connection (`getPlatformDb`, `PLATFORM_DATABASE_URL`, `MIGRATE_DATABASE_URL`) in `src/lib/committees/`, the route tree or `src/components/committees/`; **none of `administrative_commissions`, `administrativeCommissions`, `org_delegations`, `orgDelegations`, `role_grants`, `roleGrants`, `roleId`, `role_id` in those three** (so nothing writes the downward tables or a role); the three new table names (SQL and Drizzle) appear **only** in `store.ts`, `reads.ts`, `db/domain/committees.ts`, `dev-docs.ts` and the ERD; `store.ts` is the only writer of the three tables, and **nothing in the module inserts, updates or deletes `groups`/`group_memberships`** (no `.insert(`, `.update(`, `.delete(` of `groups`, `groupMemberships` and no raw `insert into|update|delete from` of them: writes go through `@/lib/groups`); no `delete` of any new table; no `recordAudit` in the module; no `route.ts` and no `loading.tsx` under the route tree; **no import from `admin/groups/` or `org_portal.groups`** by the committees tree or components; every `page.tsx` calls `gateCommitteesPage`; every `actions.ts` calls `resolveCommitteesActor(` first and `action-gate.ts` runs `assertOrgSession` before `resolveOrgContext`; no `callbackUrl`/`next` read; no `type="number"`; no `sharp` or `getBlobStore`; the commission tables in the Drizzle mirror have no `role_id`, `group_id` or `public_listed` column |
| U6 | `audit-coverage.test.ts` | each store write function calls `insertAuditRow` in its transaction (once; `updateCommittee` may write two); the metadata key set per action equals the allowlist in the API Contract; sentinel strings in every free-text field (committee name, purpose, meets-when; **II:** title, charge, minute) appear in **no** audit row |
| U7 | `presbytery-reports/gate.test.ts` additions | `gateCommitteesPage` runs signed-in, `assertOrgSession`, the four-way org miss, `assertOrgAccess`, `org_portal.committees`, type, in that order; flag off and wrong type give their own states |
| U8 | page tests (list, committee, forms) | gate before any read; a non-UUID segment 404s before any reader is called; `forbidden` renders `CommitteesForbidden`; one section's rejection leaves the others rendered; an `OrgAccessError` is rethrown; `?show` is read as a fixed enum |
| U9 | form tests | each root inside `HydrationGate`; the C4 to C6 messages on the right field; a failed save keeps the values; dates are `type="date"`; an "(already serves)" option is disabled; the guided empty state replaces the form when no one is eligible; the carries warning shows only when it carries |
| U10 | `admin/groups` page and list tests | the one-line pointer and "No groups yet" render only for a presbytery; a congregation's page is unchanged |
| U11 | `group-roles.test.ts`, `committee-directory.test.tsx` | the union of `GROUP_ADMIN_ROLES` and `COMMITTEE_ROLES` equals `GROUP_ROLE_VALUES`; `SEAT_ROLES` and `TITLE_ONLY_ROLES` are disjoint; every value has a label and a sort rank; the public directory renders all seven (Member with no title) |
| U12 | help | `npm run check:help`, `coverage.test.ts` (pin 11, `tile:committees` covered), and the Copy section's labels all on screen |

**DB (serial).**

| ID | File | Pins |
|---|---|---|
| D1 | `src/lib/db/domain/committees.schema.test.ts` | the Drizzle mirror equals the migration's columns, nullability and constraint names (`getTableConfig` against `information_schema`); the group-role CHECK is mirrored; the commission tables have no `role_id`/`group_id`/`public_listed` |
| D2 | `src/lib/db/domain/committees.db.test.ts` | on **both** connections (`presby_app` and the owner, F44): every CHECK boundary; the details guard (wrong type, derived, congregation, immutable ids, frozen after dissolve, non-owner dissolved insert refused, owner allowed); the commission guards (one-way end and removal, immutables, the `WHEN` null congregation, about-org refusal and the unrelated-edit pass); the live guard **serializes** an add against an end in two connections; the one-open-seat unique; `presby_app` has no DELETE or TRUNCATE (by `aclexplode`); the fixture teardown cascade deletes a presbytery and everything under it; **the public function's seven scenarios, its four-column list and the asset door** |
| D3 | `src/lib/committees/store.db.test.ts` | every store function: a missing key writes nothing and audits nothing; success writes the expected audit row(s) **in the same transaction** (an injected audit failure leaves the data unchanged); an unchanged edit writes and audits nothing; **`not_found` is byte-identical** for another presbytery's committee, a `choir`, a derived Session group, a congregation's committee group and a nonexistent UUID; the **atomic role change** (old `ends_on` and new `starts_on` equal, planned end preserved, one audit row, a stale form refused, a legacy `leader` row changeable, a role never held twice or zero at the effective instant; **the public listing carried to the new row**); dissolve (every seat ended, a not-started seat zero-length, future date and early date refused, no seat left open, one audit row with the count, later add refused); the interval overlap (a back-dated seat accepted next to an open one; zero-length ignored); **concurrency:** two simultaneous creates of one name end with one row and one `duplicate_name`; two simultaneous adds of one person end with one seat; a dissolve racing an add leaves **no open seat on a dissolved committee**; a change-role racing an end term ends consistent; **II:** commission cases (the congregation resolver's three misses give one byte-identical answer; a closing congregation is accepted; `stale`; the member add racing an end refused by the live guard; `endCommission` ends every member) |
| D4 | `src/lib/committees/reads.db.test.ts` | each reader returns `forbidden` for a person without `groups.manage` (and no data), inside its own transaction; the list's chairs and serving count use the **organization's local day** (Kiritimati versus Pago Pago at the same instant, as oversight's D4); the list uses a **fixed three queries** for 2 and for 30 committees (counting wrapper); wrong-kind ids are `not_found`; `personStatus`; `carriedRoles` (an ended grant, a person grant and another group's grant are excluded); `readSeatFormOptions` flags `alreadyServes` and excludes ended memberships |
| D5 | `src/lib/groups.committees.db.test.ts` | the presbytery exclusion in all nine gated functions and that a **congregation's committee behaves exactly as before**; `addManagedGroupSeatInTx` (role outside `allowedRoles` throws, `endsOn` before `startsOn` refused, `overlap: "caller"` skips only the open-row check, the default is unchanged); `setManagedMembershipPublicListedInTx` parity with the public wrapper; `readGroupRoleGrantsInTx`. **The existing `groups.test.ts`, `groups.primitives.db.test.ts` and the worship store tests pass unmodified.** |
| D6 | `scripts/committees/test-0090-migration.sh` | 0090 applied twice leaves identical function bodies, constraint definitions, trigger lists and counts; 0090 without 0078 or 0045 is refused whole; the role guard refuses an out-of-range seeded row |
| R | `scripts/committees/test-rls-90.sql` | sections (a) to (j) in the Data Model section; the patched `test-rls.sql` exits 0 from empty |

**E2E (Playwright).** Own server per run: `E2E_BASE_URL=http://localhost:3101` (`PW_PROD_PORT=3801` for the production hydration lane), started by the runner and stopped by PID (never `pkill -f next`); **a run that attached to :3000 is discarded** (Rule 16). New fixture `e2e/support/committees-fixture.ts` (a **NEW** file, modelled on `oversight-fixture.ts`: a throwaway presbytery A with a managed and an unmanaged member congregation, a second throwaway presbytery B with one committee for the cross-presbytery cases, a `choir` group and a derived group at A and a committee group at the managed congregation for the wrong-kind cases, a founding administrator minted through the real definer `presby_apply_founding_administrator` and MFA enrolled, a custom role holding **only** `groups.manage` (no two-factor key) for the clerk, a member with no role, a congregation administrator (Increment 2), and presbytery-side people with memberships including one whose membership has ended and one with a date of death; all `.invalid`, invented names). **Ids** (grepped free in `e2e/`, `scripts/`, `src/`: `4090`, `c0900000`, `b0900000`, `e0900000` appear nowhere): people `00000000-0000-4090-8000-`, roles `00000000-0000-4090-9000-`, organizations `00000000-0000-4090-9001-` (unique per run, because `audit_events` is append-only and keeps a run's rows). Teardown, as the owner: commission members, records, `committee_details`, the fixture's `group_memberships` and managed `groups`, the affiliations, then the congregations, then the presbyteries (the cascade is verified in B1's first hour; the fallback is deleting the affiliation rows first).

| Spec | Flags it sets (via `flags.ts`) | Covers |
|---|---|---|
| `committees-roster.spec.ts` (new, I) | `org_portal.committees` | the founder (a real invitation-path administrator): tile, the guided empty state, create, a duplicate name refused naming the existing one, add members (a later start shows under "Starting later"), **change role** (one history, no gap), end term, change end date, cancel a planned term, dissolve and "Show dissolved committees"; the **carries-role note** (the fixture binds a role to the committee group) on the page and in the add form; the clerk (`groups.manage` only) does the same with no two-factor prompt; a member with no role sees `CommitteesForbidden`; a direct hit on `/members/new` as that member writes nothing; **404 with a byte-identical body** for a non-UUID, another presbytery's committee, a `choir`, a derived group and a nonexistent id; audit rows exist and carry **no sentinel text**; the public-listing switch writes `committee.member_listed` and the public function then returns the member; a 200-character committee name and a 120-character person name at **360px with no sideways scroll** (`scrollWidth <= clientWidth`); every control `min-h-11`; the back link and **no `callbackUrl`** |
| `committees-gates.spec.ts` (new, I) | `org_portal.committees`, `org_portal.groups` | flag off says "isn't turned on for {name} yet"; a congregation reaching `/admin/committees` gets the not-available state; the groups admin at the presbytery shows the pointer, its type select lacks "Committee", and a committee id typed into `/admin/groups/<id>` is a 404; **the congregation's groups admin is unchanged** (the Committee type still offered) |
| `hydration/committees-forms.spec.ts` (new, I) | none | held JS chunks: the new-committee and add-member forms' inputs are not operable before hydration (production lane `PW_PROD_BUILD=1`, `PW_PROD_PORT=3801`) |
| `committees-commissions.spec.ts`, `hydration/commissions-forms.spec.ts` (new, **II**) | `org_portal.committees` | record a commission about a member congregation and about none; add members; end a member; end the commission (members ended); remove a record; a congregation of another presbytery, a non-congregation and a nonexistent id give **one** refusal sentence; the no-access sentence on the page; **the congregation's own administrator cannot reach the record** (the byte-identical org denial at the presbytery path; the fixture also reads the tables as the congregation's context and gets zero rows); audit rows carry no title, charge or minute; 360px; the commission form's inputs are not operable before hydration |

### E2E blast radius: existing specs this change alters

- **Specs that assert behaviour this change alters: none found.** Grepped `e2e/` for `admin/committees`, `Committees & Commissions` and `org_portal.committees`: **no match**. `e2e/presbytery-dashboard.spec.ts:155-169` and `e2e/portal-footer-sitemap.spec.ts:116` assert the "Coming soon" pill for the **Insights** and **Communications** tiles, not this one (reviewed, unchanged). `e2e/*reimbursement*` specs create `committee` groups at **congregations**; the presbytery exclusion does not touch a congregation (D5 pins that).
- **Specs that read the public committee roster:** none in `e2e/`; `public-roster-photo.db.test.ts` and `public-asset.db.test.ts` are the DB-side readers (Feasibility pins).
- **Unit and DB tests changed in place:** `admin/committees/page.test.tsx` (replaced), `committee-directory.test.tsx`, `admin/groups/page.test.tsx` and `groups-list.test.tsx`, `tiles.test.ts` and `visible-tiles.test.ts` (verify only), `src/lib/help/coverage.test.ts`, `src/lib/audit.test.ts`, `presbytery-reports/gate.test.ts`, the three public-roster DB tests' fixtures.

## Carry-forward

**Phase 1 gaps 1 to 15, the adversarial pass, the edge cases, the out-of-scope list, Open Questions 1 to 7, the orchestrator rulings, Phase 2 R1 to R6, DECISION-352 to 356, F456 to F458 and the orchestrator's F456 note.**

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| Gap 1 a person on a committee is a current presbytery member; ruling elders need a non-roll record; duplicate record; two admin areas; roster can't say which congregation | C5 (person helper and guided empty state, both naming Community and the Features toggle); `readSeatFormOptions`; residual 3 in "Copy"; the "which congregation" limit is **deferred** (Phase 1 Out of Scope; operator accepted); Flow 6 walked by B3 and Phase 6 (a presbytery's Community path was never walked: B3 walks it first) |
| Gap 2 a commission is a record, not a grant | Data Model section 3 (no `role_id`, no `group_id`); closing assertion; `boundaries.test.ts` U5 (no write or name of the downward tables); `test-rls-90.sql` (i), (j); C15 no-access sentence ships with the boundary test (Increment 2); residuals 13 |
| Gap 3 "commission" means two things; congregation optional | C2/C15 say "Administrative commission" in full; `about_org_id` nullable with the `WHEN`; a standing judicial-type body is a committee labelled Required (Q7) |
| Gap 4 who sees a commission record | the organization-only policy (the congregation reads zero rows; `test-rls-90.sql` (d)); stated in C15 as the deliberate v1 position |
| Gap 5 a commission's charge is sensitive | 500-character limit, helper copy (C15), never in audit (U6), CSV, logs, errors, the public site or `/admin` (U5/U6; no such surface exists); tier-1 residual 10 accepted by the architect; **the later export pipeline (decision E) must decide whether commissions enter an export** (recorded here, **deferred** to that pipeline; operator accepted the sequencing) |
| Gap 6 dated roles: one open row; planned end dates; one atomic change | T3 to T5; `addManagedGroupSeatInTx` with `endsOn`; the interval overlap; one audit row; "Ends"/"Starts" labels; planned ends are treated as still current by `classifySeat`, the roster, the audit and the public function (R4) |
| Gap 7 the public directory degrades | 0090 section 5 (starts, ends, active membership, death, merge, dissolved); `sites.ts` and `committee-directory.tsx` take `GroupRoleValue`; U11 fails if a role lacks a label; the commission members are structurally absent (no group row); the column list is pinned (D2, test-rls-90 (h)) |
| Gap 8 committee names unique | T14/API Contract (`createCommitteeAction` lock and check, case-insensitive trimmed, non-dissolved); `paper` at the database (R5.4; residual 8); D3 concurrency case |
| Gap 9 dissolve | T5; `dissolveCommitteeAction`; C8; the details guard freezes the row; D2/D3 |
| Gap 10 existing committee groups have no label | T14; "Not yet labelled" section and note (C2); no backfill; the legacy dev group stays unlabelled in the seed (T16) |
| Gap 11 chair is a title here and a seat elsewhere; show when a committee carries a role | C3 titles note and carries note; `readGroupRoleGrantsInTx` (T11); `grantsRole` in `committee.member_added` and `member_role_changed` audit; the add form's warning (C5); `test-rls-90.sql` (c) pins the seat predicates ignore the four titles |
| Gap 12 production state unknown | Phase 1 Q6 read by the orchestrator (recorded in "Permissions & Flags"); deploy-day re-reads in the Deploy checklist |
| Gap 13 ex officio does not follow an office | the Role helper (C5) and the help page say it is entered by hand; **deferred** to the presbytery-offices pipeline (decision C; operator accepted) |
| Gap 14 a person who leaves the presbytery stays on the roster | R6.1: no trigger ends seats; "No longer connected to this presbytery" and "Recorded as deceased" badges derived from `memberships.ended_on`/`people.date_of_death` (C3, D4); the public function excludes both (0090 section 5) |
| Gap 15 the audit story | eight-plus-one `committee.*` and six `commission_record.*` keys, in the mutation's transaction, ids/enums/dates only; `audit-coverage.test.ts` stands in for `check:audit` (which does not see `store.ts`); the existing `group.*` events stay with the groups admin; the presbytery audit log (decision G) is a later pipeline |
| Adversarial: redirects, state-machine shortcuts, wrong kind of group, IDOR/enumeration, input boundaries, the downward-grant table, self-targeting, chair and role conflicts, public leakage | no `callbackUrl`/`next` (U5); every deep URL runs `gateCommitteesPage` then a reader-side key check (U8, D4); one `not_found` per object class (C9, D3, e2e 404s); `isUuid` before any read (F446); commission congregation validated server-side with one neutral wording (T7, D3); nothing writes the downward tables (U5, test-rls-90 (i)(j)); a self-appointment is allowed and shown by the carries note (residual 2); co-chairs allowed, no warning (Q3); the public function's column list is pinned |
| Phase 1 edge cases: empty states, failure microcopy, 360px, 2FA gate, roll untouched | C2, C3, C5 empty states; C1 section errors; "Component / Page Plan" 360px rules and the e2e overflow checks; `groups.manage` is not two-factor-flagged (live catalog) so the gate adds no consequence; this feature reads no roll, per-capita or SASR data |
| Phase 1 Out of Scope | repeated under "Out of Scope" below |
| Phase 1 Help impact | C12 (new page, replaces the placeholder), C13 (three edits), the allowlist and pin, the TODO token ruling; the five pages named by the analyst are each dispositioned |
| Q1 record only; Q2 no new key; Q3 co-chairs, one role per person; Q4 `groups.manage` reads; Q5 congregation optional; Q7 naming and labels | all honoured as ruled; Q5's "Administrative commission" wording is in C15; Q7 in C2/C11 |
| Q6 production probe | recorded in "Permissions & Flags"; re-read at deploy (Deploy checklist 2) |
| Increments: two, one migration 0090 | the whole design; Increment 2 adds no migration |
| R1 module ownership; `groups.ts` sole writer through `*InTx`; additive opt-in; presbytery exclusion; seat semantics untouched | T10; "Modified outside the module"; D5; `test-rls-90.sql` (c); existing suites unmodified |
| R2 / DECISION-353 the label and dissolved state in a 1:1 side table with a guard; one-way dissolution; Not yet labelled; one-transaction dissolve | Data Model section 2; T5, T14; `dissolveCommitteeAction`; **the dissolve transaction takes the seat lock, sets the date, ends seats through the groups primitive and writes one audit row** |
| R3 / DECISION-355 commission record tables; members are not groups; nothing writes the downward tables; boundaries; the RLS case in the pipeline-local suite | Data Model section 3 and 4; U5; `test-rls-90.sql` (d), (i), (j); **T7 refines the congregation resolver** (the architect's `readRoster()` becomes `resolveMemberCongregation()`; same fence, no lifecycle filter) |
| R3.4 / F456 the downward tables' write model; orchestrator's production `aclexplode` confirmation | **not fixed here** (the architect's ruling; 46k, 68e, 73f rely on direct writes); carried as a TODO line by the orchestrator; **F460 adds** that a committee group can be a downward roster |
| R4 / DECISION-356 / F457 public-roster fix-forward | Data Model section 5 (the full body); D2, `test-rls-90.sql` (h); `sites.ts` and `committee-directory.tsx` |
| R5 / DECISION-354 role vocabulary, half-open dates, atomic change, interval overlap, name uniqueness | T2 to T4, T6; `group-roles.ts`; Data Model section 1; C3 to C8 wording; U4, U11 |
| R6 Gap 14, audit keys, wrong kind of group | as Gap 14, Gap 15 and the adversarial row |
| Migration 0090 structure (sections 0 to 6; idempotent; applied twice; independent of 0088; deploy before 0.63.0; cannot be corrected after Increment 1; pipeline-local RLS file; the dev seed's committee fixture must not be deleted or re-pointed; `dev-docs.ts` and the ERD) | Data Model (sections 0 to 7); Deploy checklist; T16 and the seed bullet (the `b…05` group and its `administrative_commissions` row are untouched, and a test pins it, test-rls-90 (j)); the `dev-docs.ts` integration patch and `npm run docs:erd` at integration |
| F458 the groups admin's label map renders blank for a new role | closed by `group-roles.ts` (a total map, U11) and the presbytery exclusion |
| Phase 2 "no CLAUDE.md change"; orchestrator adds the layout lines at ship | orchestrator at integration: add `src/lib/committees/`, `src/components/committees/` and `src/lib/group-roles.ts` to Project Layout |
| **New:** T7, T9, T11 (refinements of R3 and R6 that do not touch an invariant); DECISION-357 to 359; F459, F460 | filed above; the orchestrator records them; **the architect is offered the three refinements for awareness, not for a ruling** |

## Edge Cases & Risks

Each claim cites the test that will pin it, or says *unverified*.

- **Two clerks create the same committee name at once.** The advisory lock serializes them; the loser is `duplicate_name` naming the existing one. D3 (concurrent creates). The database has no index (needs the group type from another table): **`paper`**, the consequence of a miss being the public-site heading merge Phase 1 accepted.
- **Two clerks add the same person to one committee, or change a role while another ends the term.** The committee's seat lock serializes them; the second gets `overlap` or `stale`/`already_ended`. D3.
- **A role change must never leave a gap or a double.** One transaction, both rows on the same date. D3 asserts the person holds exactly one role at the instants just before, at and after the effective date.
- **A back-dated role change or a zero-length row.** Allowed down to the seat's start; the history shows "Ended the day it started". U2, D3.
- **Dissolve racing an add.** The seat lock orders them; the add is refused as dissolved, or the seat is ended by the dissolve. D3 asserts no open seat on a dissolved committee. At the database this is `paper` (R2.4) bounded by `boundaries.test.ts` (the store is the sole writer).
- **Dissolving a committee that is some downward commission's roster, or that carries a role.** The carries sentence appears in the dialog (C8); a downward roster is F460 (inert, tracked). *Unverified* beyond the dev fixture.
- **An id from another presbytery, a `choir`, a derived group, a congregation's committee or a non-UUID.** All answer the one `not_found`; the non-UUID before any SQL. D3, U8, `committees-roster.spec.ts`.
- **A viewer without `groups.manage`.** `CommitteesForbidden` from the reader's own transaction; a direct `/members/new` hit writes nothing. D4, U8, the e2e. A viewer in a congregation gets the not-available state.
- **The audit insert fails.** The change rolls back with it. D3 (injected failure).
- **A person leaves the presbytery or dies while seated.** The seat stays, with a badge; the public function stops listing them. D4, D2 (seven scenarios).
- **A planned end date.** The seat stays "Serving now" with "Ends {date}" until the date; the public list keeps it until `ends_on`. U2, D2.
- **The UTC versus local day.** The app derives "today" from the organization's zone; the public function uses UTC; a listing can flip up to a day early or late (residual 6). U2/D4 pin the local-day side; the public side is `paper`.
- **Name collisions between a congregation's and the presbytery's committees on a shared public site.** None: the public function is per organization slug. *Unverified* beyond `presby_public_committee_roster`'s `o.slug` filter.
- **A very long committee or person name wraps at 360px.** Pinned by `committees-roster.spec.ts` once written; **unverified** until B4 runs it. Dark-mode badge contrast is **unverified** until the Phase 6 walk.
- **Browser back after dissolve.** The edit page of a dissolved committee renders the C4 state, not the form. `committees-roster.spec.ts`.
- **A hand-built `createGroup` of the Committee type at a presbytery.** Refused with the C10 sentence, nothing written. D5.
- **The groups admin's old committee at a presbytery** (production has none; dev has one). Unreachable there (404), reachable under Committees as "Not yet labelled". D5, e2e.
- **Commission: a congregation that leaves the presbytery after the record.** The record keeps its row; the page says "(no longer a member of this presbytery)"; an edit that does not move `about_org_id` still saves (R9). D2 (trigger), D4.
- **Commission: ending while a member is being added.** The live guard (`FOR SHARE`) serializes them; the add is refused as ended. D2, D3.
- **Commission: a stale edit.** `row_version` mismatch is `stale`; the form keeps its values. D3, U9.
- **The deploy order.** New code against an unmigrated database fails on the missing tables; the runbook puts 0090 first. Pre-deploy runbook text; **unverified until the deploy.**
- **The public-roster fix-forward touching other organizations' sites.** It applies to every organization's committee list. Production has 0 listed members (2026-11-19), so nothing changes today; the deploy-day count decides the release-note sentence. D2, Deploy checklist 2.
- **A deploy-day finding.** If a `group_role` outside the seven exists, the guard refuses and rolls the file back: stop and tell the operator.

## Out of Scope (explicit non-goals; the operator confirms)

- Granting any downward access: a role, a `role_id`, an `org_delegations` row, a commission-as-group, or a congregation-side membership for a commission member (Gap 2; F456, F460).
- Presbytery offices (moderator, vice-moderator, stated clerk with dated terms), mission giving, the directory-export permission, worship times and the presbytery audit log (separate pipelines; this work keeps its own audit events clean for the last one).
- A starter list of polity-required presbytery bodies and any Book of Order citation.
- Term limits, class rotation, reminders on expiring terms, vacancy reports, committee reports on the dashboard, any CSV or export of committees or commissions (decision E decides).
- A read-only view for presbytery members who are not managers and a "my committees" page (Q4; a named fast follow).
- Which congregation a ruling elder comes from on the roster (Gap 1).
- **Public display order** for committee members at a presbytery (the groups admin has it; the committees page does not offer it: T9; a TODO line).
- Reopening a dissolved committee or a committee or commission renamed after dissolution; editing a seat's start date or role in place (use change role, end, and add); a role change on a commission member (end and add instead).
- A link between an ex officio seat and an office (decision C).
- Changing the Roles screen's description of `groups.manage` (T12; a TODO line after 0.64.0).
- The data import itself and any committee data in an export.
- Fixing F456, F459 or F460.
- What's-new entries (the operator's standing rule: drafts stay in work-logs; none is written or listed as a to-do).

## Help impact

Per C12, C13 and C15: **adds** `presbytery-committees` (Increment 1; `published`, no `requires`, no token, no screenshots; `replaces: ["presbytery-tools"]`); **edits** `roles-who-can-do-what` (I and II), `why-cant-i-see-this` (I), `privacy-policy` (I and II); **reviewed, no edit** `adding-people`, `first-day-as-administrator`, `what-presbyportal-does`, `turning-features-on-and-off`, `presbytery-reports`, `congregation-records`; **removes** the `presbytery-tools` registry entry and the `tile:committees` allowlist entry and lowers the pin to 11. **Increment 1's page says in the present tense that it keeps committees and not administrative commissions** (C12); Increment 2 rewrites that section (C15). **The TODO line 29 token is removed** in the integration commit (C12). **`verifiedIn`** is set to a version no greater than `package.json` by B3 and to the release by the `/release-notes` commit only after Phase 6 walks the page. Phase 6 reads each named page against the shipped build; a page that contradicts it is NEEDS REWORK (Rule 17). The release notes and the functionality map (Rules 13, 14) are written after Phase 6 SHIP IT through `/release-notes` (0.63.0, then 0.64.0), and TODO line 507 moves to Done at Increment 2.

## Phase 6 handoff (what the analyst must walk)

1. **As the person the presbytery's founding-administrator invitation path creates**, on `development` at 360px: the tile, every state of the list (empty, mixed kinds, Not yet labelled, dissolved), create, add member, change role, end term, change end date, cancel planned term, dissolve, the carries note, the groups admin pointer.
2. **As a presbytery member with no key:** the denied state on the list and on a deep link.
3. **Community at a presbytery** (the participant path) for the help paragraph, and the guided empty states.
4. **The public site** (`sites.public_committee_directory` is on in production): a listed member with a new role title, and that a member whose term has ended is gone.
5. **Increment 2:** the commissions section and page as above, the no-access sentence, a commission about a congregation and about none, end and remove, and that the congregation's own administrator cannot see it.
6. The named help pages read as their reader against the shipped build.

## Implementer

**Increment 1:** database-admin (B1), api-developer (B2), ux-developer (B3), full-stack-developer (B4). **Increment 2:** api-developer (B5), ux-developer (B6), full-stack-developer (B7). The orchestrator applies the integration patches, records DECISION-357 to 359 and F459 and F460, adds the CLAUDE.md layout lines, and removes the TODO token.

**Operator rulings needed:** none to proceed. Four things are the operator's to see in the completion report, each reversible by a small change before the release that ships it: (1) commission members use the **same six titles** as committees, with the presiding member called "Chair" (the alternative "Moderator" is one forward migration); (2) the commission record carries a **"Remove this record"** control for entries made by mistake (cut-able); (3) **dissolving a committee is one-way** and a mistaken dissolve needs a data fix, as the architect ruled; (4) **public display order** is not offered for a presbytery's committee members. One production fact to know: the page goes live on the 0.63.0 deploy because `org_portal.committees` is already on.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — Technical design | tech-lead | Complete (one design for both increments; T1–T17; DECISION-357–359 proposed; F459–F460; migration 0090; Inc 1 batches B1–B4, Inc 2 batches B5–B7; two child logs created) | Design complete | 2026-11-19 |

## Handoff

Next agent: **database-admin** (Increment 1, Batch B1, in `docs/work-log/2026-11-19-presbytery-committees-inc1.md`), after the orchestrator records DECISION-357 to 359 and numbers F459 and F460 in `docs/decisions.md`, `docs/TODO.md` and `docs/schema-design-2.md` (Rule 16 shared files; DECISION-352 to 356 and F456 to F458 are the architect's and are recorded at the same time).

The implementer reads, in this order: this Phase 3 in full (Data Model, Module and file plan, API Contract, **Copy**), then its child log's batch table. A string not in Copy stops for a ruling. Pre-assigned numbers: migration 0090, DECISION-352 to 356 (357 to 359 used here, 360 next), F456 to F458 (459 and 460 used here, 461 next), dev port 3101, e2e ids `00000000-0000-4090-…`, Neon branch `br-calm-rice-ax2zn9jw`, worktree `../presby-committees`.

Orchestrator, at integration (Rule 16 and the architect's list): the five `scripts/committees/*.integration.patch` files; DECISION-352 to 359; F456 to F460 (F456's TODO line gains F460's sentence); a TODO line each for public display order at a presbytery, the Roles-screen description (after 0.64.0), and F459; the two release notes; `docs/product/functionality-map.md` (Rule 14); CLAUDE.md Project Layout lines for `src/lib/committees/`, `src/components/committees/` and `src/lib/group-roles.ts`; remove `[help:presbytery-tools]` from TODO line 29 and `committees` from the line 300 placeholder-sweep list and the `scripts/seed.ts` comment (the flag graduates); TODO line 507 to Done at Increment 2.

Files read for this phase, all in `/Users/cshenso/git/presby-platform/presby-committees`: this log; `docs/work-log/_template.md`, `2026-11-17-congregation-profile.md` (Phase 3), `-inc1.md`, `-inc2.md`; `src/lib/groups.ts`, `src/lib/role-grants.ts`, `src/lib/db/domain/groups.ts`, `src/lib/oversight/{contract,store,action-gate,boundaries.test}.ts`, `src/lib/presbytery-reports/{gate,roster}.ts`, `src/lib/presbytery.ts`, `src/lib/audit.ts`, `src/lib/audit-tx.ts`, `src/lib/org-portal/{permission-check,tiles}.ts`, `src/lib/help/{registry,checks,coverage-allowlist,coverage.test,slug-history}.ts`, `src/lib/sites.ts`, `src/app/(public)/site/[slug]/committee-directory.tsx`, `src/app/(org)/o/[slug]/admin/{committees,groups,oversight}/**`, `src/components/org-portal/coming-soon.tsx`, `src/content/help/*`; `drizzle/{0009,0017,0045,0078,0085,0089}`; `scripts/{seed-dev.sql,seed.ts,oversight/*,ci/e2e-baseline-flags.sql}`; `e2e/support/{oversight-fixture,flags}.ts`; `playwright.config.ts`; `docs/TODO.md` (lines 29, 300, 507); and, read-only on the pipeline Neon branch `br-calm-rice-ax2zn9jw`, `pg_trigger`, `pg_constraint`, `aclexplode(relacl)`, `pg_proc` bodies (`presby_effective_permissions`, `presby_reimbursement__is_seat`, `presby_membership_is_active`), the `permissions` rows and the live founding-administrator bundle.

---

# Phases 4 to 6

Recorded in the child logs, one per shipped increment (see "Children" at the top): `docs/work-log/2026-11-19-presbytery-committees-inc1.md` and `docs/work-log/2026-11-19-presbytery-committees-inc2.md`. The analyst's Phase 6 verdict for each increment is recorded in its own child; the parent closes when both have shipped.
