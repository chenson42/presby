# Founding administrator — a platform admin hands a newly created organization to its first real administrator through the product (DECISION-100/101/106 bootstrap gap) — Work Log

> **Slug:** `2026-09-28-founding-administrator`
> **Surface:** mixed — `(admin)` (`/admin/organizations/[id]`: the platform-side act of designating an organization's founding administrator) and `(org)` (the founding administrator's first session: adopt templates, grant roles); `src/lib/org-provisioning.ts`, `src/lib/authz.ts` (`assertPermissionSubset()`), `src/lib/db/domain/authz.ts`; likely a migration
> **Permission(s):** analyst to name — the platform act is `FEATURES.*` (admin shell, `src/lib/permissions.ts` is FROZEN: reuse an existing admin key or state the exception); the tenant side is whatever role the founding administrator receives (`role_grants.manage` + `roles.manage` at minimum — DECISION-106's subset check must have a first holder)
> **Flag(s):** analyst to decide — a flag is likely unnecessary (this is onboarding plumbing, not a member-visible rollout)
> **Estimated complexity:** large
> **Pipeline mode:** Full
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-28, wave 5 — "finish the presbytery portal so PSV can be onboarded, tested and deployed"):** worktree `../presby-wt-boot` on git branch `pipeline/founding-admin`; Neon branch `pipeline-founding-admin` (`br-empty-frost-ax4mo8q5`, forked from `development` at the v0.28.0 state — 0043–0053 applied). **Pre-assigned numbers:** migration `drizzle/0054_presby_founding_administrator.sql` if schema is needed; `DECISION-155`; findings `F107` onward; `test-rls.sql` §44 appended; journal idx 54. **Shared-file discipline:** `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts` and `drizzle/meta/_journal.json` are edited on this branch only as a clearly delimited block appended at the END of the file (one new section, one new export line, one new journal entry); `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*`, `docs/schema-design-2.md`, `docs/product/functionality-map.md` and `CLAUDE.md` are NOT edited on this branch — each phase returns its proposed lines in its section and the orchestrator applies them at integration (one PR at a time; `test-rls.sql` re-run on `development` after each merge; the pipeline's Neon branch is deleted at cleanup). `scripts/seed.ts`, `src/lib/org-portal/tiles.ts` and `src/lib/audit.ts` are high-collision: one clearly delimited addition each. **The from-scratch rule (DECISION-150):** any schema change must survive `npm run check:schema-parity` on a fresh database and the `docs/testing.md` from-empty recipe; the CI `db-tests` job skips until the operator adds the Neon secrets, so the implementer rehearses it locally. Every new SECURITY DEFINER function pins `search_path = public, pg_temp` (DECISION-148); every deny helper reachable from a tenant-path trigger grants EXECUTE to `presby_app, presby_platform` (0046 B-M1, re-learned as the increment-7 QA FAIL). Tests must mint their own fixture rows — a mandatory browser rehearsal on the pipeline branch consumes single-use seed rows (the withdraw pipeline's QA FAIL). Dev-server port `3400`; stop by PID; never `pkill -f`. `dotenv -e .env.local` does NOT override an already-exported `DATABASE_URL` — check `env | grep DATABASE_URL` first.
> **The gap (`docs/decisions.md` DECISION-100/101/106; `docs/TODO.md` "Template-adoption bootstrap for `congregation_stated_clerk`"; the 2026-09-27 presbytery-portal audit):** `createOrganization()` (`src/lib/org-provisioning.ts`) seeds exactly one role, `member` → `directory.view`, bound to the derived `active_membership` group. Nobody at a freshly created presbytery or congregation holds `role_grants.manage`, `roles.manage`, `credentials.manage` or `statistics.manage`, and `assertPermissionSubset()` (`src/lib/authz.ts`) is a strict subset check with no wildcard, so the org can never adopt a template carrying a permission nobody there holds. Every presbytery feature shipped in waves 2–4 (credentials, oversight, reports, submission grants, filings) is therefore inert for a real org: a platform admin has no product path to hand the org to its stated clerk. The dev fixture direct-grants everything, which is why nothing noticed.
> **Design authority:** Two Hierarchies (CLAUDE.md Key Invariants — a platform admin is not above a council; the platform may *designate* a founding administrator once, as an onboarding act, but must not hold standing ecclesiastical authority afterwards); DECISION-106 (the subset check is deliberate and stays); DECISION-078 (a permission key with no enforcement point is not seeded); `docs/schema-design-2.md` §2c's function-mediation rule if the act becomes a DEFINER function; `../psvonline-portal` for what a presbytery stated clerk expects to hold on day one.
> **User verbs (to refine):** a platform admin creates an organization and designates one person (by invitation email or an existing user) as its founding administrator; that person signs in and holds enough to adopt the constitutional templates (`presbytery_stated_clerk` / `congregation_stated_clerk`) and grant roles to others; the platform admin's designation is audited and is a one-time act (re-designation only while no tenant-held `role_grants.manage` exists, or never — analyst to rule); the org's own administrators can later revoke the founding grant like any other.
> **Constraints:** no wildcard role (Key Invariant: No Role Carries a Wildcard — the founding administrator gets a bounded constitutional template, not `*`); the platform predicate must not appear in any tenant authority check; the seed-dev fixture gains a loginable presbytery stated clerk with a real password so the flow is hand-testable (mirror `clerk.fixture@example.invalid`); an e2e smoke of the whole flow is required at Phase 4 if `src/lib/auth/` is touched (it should not be). Also in scope if the analyst agrees: `/admin/organizations/new`'s missing `parentOrganizationId`/`relationshipType` control is the sibling pipeline `2026-09-28-organization-parent-picker`, NOT this one — do not widen; but the founding-administrator control on the same form is this pipeline's.
> **Out of scope:** `presby_organize_congregation()` (lifecycle-UI pipeline); the trust-property tripwire; committees.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — gap confirmed on the live catalog and found deeper than a subset check (no in-app path ever sets `people.user_id`); twelve gaps; four open questions ruled by the orchestrator (existing users only; both write shapes; time-boxed bundle; lockout recovery) | READY WITH NOTES | 2026-09-28 |
| 2 — Architectural review | architect | Complete — `getPlatformDb()` transaction in `(admin)`, no DEFINER function; one org-owned unprotected `founding_administrator` role + the adopted office template; subset check inapplicable, not bypassed; `for update` gate doubling as recovery; 0054 = one partial unique index on `people.user_id`; F107–F111 (F111: the designation is the org's permanent permission ceiling); DECISION-155 proposed | Approved with suggestions | 2026-09-28 |
| 3 — Technical design | tech-lead | Complete — `src/lib/founding-administrator.ts` (9-variant result union, transaction order, error catches); `drizzle/0054` (one partial unique index on `people.user_id`, pre-flight duplicate probe); one server action + one admin-page section; `scripts/seed-dev.sql`/`test-rls.sql` §44 additions specified; three-batch implementation order (database-admin → api-developer → ux-developer) with explicit handoff contracts; DECISION-155/F107–F111 adopted verbatim | Design complete, implementer named | 2026-09-28 |
| 4 — Implementation | database-admin (Batch A) → api-developer (Batch B) → ux-developer (Batch C) | Batch A complete — `drizzle/0054` **NOT shipped**: the pre-flight duplicate probe against `development` returned a row (`router.dup@`, two live `people` rows), and the blocker is the committed `seed-dev.sql` de-duplication fixture itself, not data rot (F112 proposed; migration 54 / journal idx 54 released back to the pool). Shipped: `seed-dev.sql` `founding.fixture@example.invalid` (no `people` row), `test-rls.sql` §44 (17 assertions, 621→638), `docs/testing.md` row. **Batch B complete** — `src/lib/founding-administrator.ts` (plan function, the transaction, `countFoundingAdministratorHolders()`), `designateFoundingAdministratorAction` appended to `actions.ts`, `AUDIT_ACTIONS.ORG_FOUNDING_ADMINISTRATOR_DESIGNATED`, 27 DB-backed tests (including a genuine Postgres-level discovery: the `organizations` `for update` lock serializes against ANY concurrent writer touching an org's `app_roles` via the FK's implicit `FOR KEY SHARE`, which is why `race` cannot be forced through a normal writer) + 87 action-layer tests, failing-first evidence recorded for `person_elsewhere`/`membership_ended`/`has_holders`/the lock-generalizes discovery. **Batch C complete** — `founding-administrator-section.tsx` (email input, `AlertDialog` confirm naming the exact permission list + office template, sign-up-first hint, collapsed read-only state), `page.tsx` wired to `countFoundingAdministratorHolders()`/`foundingAdministratorPlan()` read fresh every render, section rendered first/prominent above "Current brand"; 18 component tests + 2 page tests, all passing; full 8-step browser rehearsal run via Playwright (no interactive browser available) with screenshots — **a real, load-bearing gap found and NOT worked around**: the founding-administrator bundle (`people.manage` but no `roll.propose`) cannot create a second person through any in-app path (the member wizard always requires `roll.propose` unless `rollAction.kind==="none"`, and that mode is reachable only via the staff-hire flow's `staff.manage`, itself unreachable per F111) — proposed as a new finding for Phase 2/3 to rule on before Phase 6 closes. Everything else in the 8-step rehearsal (create org → designate → sign in as designee → self-service Roles reachability → org-feature self-toggle → re-designation refused `has_holders` → 360px) confirmed working | Complete — Batches A–C + F118 fix pass (2026-10-05): `staff.manage` in the bundle and the `PERMISSION_LABELS` entry, plan-shape/audit/dialog tests, the eight-path unchanged-files test and `test-rls.sql` §44a edits A–E all verified present and green; rehearsal step 6 re-run on the staff-hire path, seven observations 7/7 PASS with SQL evidence; typecheck/lint/check clean, `npm test` 3412 passed, DB-backed suite 4326/4326, `test-rls.sql` 639 assertions pass (640 by the `grep -c pass` method), 0 failures | 2026-10-05 |
| 5 — Verification | qa | Complete — typecheck/lint/check clean; `npm test` 3412; DB-backed 4326/4326; `test-rls.sql` 639 pass / 0 fail after cleanup; e2e 121/129 with 3 merge-base spec-rot failures already fixed on `main`; F118 regression re-proven by mutation; gate audit clean; live-catalog probes name the refusing layers; rehearsal 8/8 + 7/7 with SQL evidence; one note (36px button) fixed by the orchestrator before Phase 6 | PASS | 2026-10-05 |
| 6 — Shipped vs intent | analyst | Complete — presbytery handover delivered end to end; congregation roll residual (F111/F118); designee-facing flag dependency wider than QA noted (seven `org_portal.*` flags seeded OFF); G10 empty state tracked; integrated as v0.29.0 | SHIP WITH NOTES | 2026-10-05 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-09-28.*

**Work-log:** `/Users/cshenso/git/presby-platform/presby-wt-boot/docs/work-log/2026-09-28-founding-administrator.md`
**Worktree:** `presby-wt-boot` on `pipeline/founding-admin`; Neon branch `pipeline-founding-admin` (read-only queries only, nothing created)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> A platform admin needs one product path to hand a freshly created (or already-existing-but-headless) organization to its first real tenant administrator — but this collides with two structural facts the codebase doesn't currently have an answer for: nobody can hold a tenant permission without first having a `people`+`memberships` row, and nothing in the app today ever sets `people.user_id` for a real (non-fixture) account, so this feature is not "add one escape hatch to `assertPermissionSubset()`" — it's "build the one in-app path that creates a real person-to-user link at all," with the subset-check bypass riding along on top of it.

## Confirming the gap on the live catalog

Read-only queries against `pipeline-founding-admin` (nothing created):

```
select proname, prosecdef from pg_proc
 where proname in ('presby_effective_permissions','presby_has_permission');
--  presby_has_permission        | f
--  presby_effective_permissions | t

select ar.key, arp.permission_key from app_roles ar
 join app_role_permissions arp on arp.role_id = ar.id
 where ar.organization_id is null order by ar.key;
--  congregation_stated_clerk | statistics.publish
--  presbytery_stated_clerk   | credentials.manage
--  presbytery_stated_clerk   | per_capita.manage
--  presbytery_stated_clerk   | statistics.manage
--  committee_chair           | directory.view
--  personnel_admin           | staff.manage
```

`createOrganization()` (`src/lib/org-provisioning.ts:225-243`, `baselineRoleSeedPlan()`) seeds exactly one `role_grants` row for a fresh org: group-arm, `member` → `directory.view`, bound to `active_membership`. No `role_grants` row is ever person-arm at creation time (`role_grants_person_fk` FK-blocks it — no `memberships` row exists yet for anyone). So for any freshly created org:

- `presby_effective_permissions()` for **any** person is empty, because no person has a `memberships` row yet — there is no "member of a freshly created org" to even ask the question about. The gap is one level more fundamental than "nobody holds enough permission" — nobody *exists* at the org yet, tenant-side.
- Once a first person *does* get a `memberships` row (by whatever mechanism), `assertPermissionSubset()` (`src/lib/authz.ts:197-232`) would compare their held keys (empty, or at most `directory.view` via the group arm if they're in `active_membership`) against `credentials.manage`/`per_capita.manage`/`statistics.manage` (presbytery) or `statistics.publish` (congregation) and refuse every one of them by name. `adoptTemplate()` (`src/lib/role-definitions.ts:768-858`) runs this same check on the *full* template permission set with no wildcard exemption — confirmed by reading the call site, not inferred.
- `scripts/seed-dev.sql:1228-1320` proves the only way this has ever worked in this codebase: a **raw SQL INSERT** into `app_roles`/`app_role_permissions`/`role_grants`, written directly by the seed script, never through `adoptTemplate()`/`grantRole()` — because those functions structurally cannot originate the first grant. The dev fixture is not exercising a working feature; it is standing in for the exact feature this pipeline needs to build.
- `createPerson()` (`src/lib/people.ts:269-`) itself requires `withOrgContext(actingPersonId, ...)`, which requires the **actor** to already have an active membership at the org (`assertOrgAccess`/`presby_membership_is_active`) — so even "create the founding administrator's own `people` row" cannot go through the existing tenant-side person-creation module. And no code path anywhere in `src/lib`/`src/app` (confirmed by grep) ever sets `people.user_id` outside of `scripts/seed-dev.sql`'s hand-written `UPDATE people SET user_id = ...` fixture statements. **This is the load-bearing finding**: there is no in-app primitive today that links a real `users` row to a `people` row, for anyone, ever.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`/admin/organizations/[id]` or `/new`) | Designates one person as an organization's founding administrator, naming either an existing platform user (by email/id) or (per the kickoff) inviting someone with no account | One-time per org, gated on "org currently has zero holders of the office/role-management permissions" (see Gap 6) |
| Admin | Views/confirms who currently holds founding-administrator-equivalent permissions at an org (so the gate above is legible, not just enforced silently) | On demand |
| Authenticated member (the designee, first session) | Signs in, lands at `/o/<slug>` (single enterable org, per the `/launch` matrix), navigates to `/o/<slug>/admin/roles/new`, adopts a constitutional template and/or grants roles to real people | One-time-ish (first session), but the roles UI itself is ordinary per-session admin work afterward |
| Authenticated member (existing org admin) | Later revokes the founding administrator's grant like any other role grant, via the existing `/o/<slug>/admin/roles` revoke action | On demand |

The kickoff correctly separates "platform admin" from "founding administrator's first session," but the request text under-specifies **which surface the invited-with-no-account person is on before they have a `users` row at all** — they are neither an anonymous visitor (they received a designation), nor a "newly-authenticated user with no roles" in the `/access-pending` sense (that surface is for someone who signed up but matches no org), nor an authenticated member. This is effectively a fifth, currently-nonexistent state — "invited, no account, no session" — and the request doesn't say what page/email/token represents it. Flagged fully in Gaps.

## Flows

**Flow 1 — Platform admin designates an EXISTING platform user as founding administrator:** entry `/admin/organizations/[id]` (or immediately after `/admin/organizations/new`'s create step) → admin enters the target's email or user id → server resolves it to a `users` row → server creates (or, per Flow 4 below, reuses) a `people` row **linked to that `users.id`** + a `memberships` row at the org + a `role_grants` row (constitutional template and/or a role-management bundle — see Gap 2) in one transaction → success: the org now shows one real holder of `role_grants.manage`/the office permission.
- Failure: no `users` row matches the given email (must say so without becoming a general email-existence oracle for a hostile requester — low risk here since the caller is already a vetted platform admin, but still deserves an explicit, humane message, not a raw DB error); the target already has a `people`/`memberships` row at this org (should this update their existing grant instead of erroring, or refuse and point the admin at the ordinary roles UI?); the org already has a live holder of the relevant permission (must be refused — see Gap 6); DB failure mid-transaction (must roll back atomically, matching `createOrganization()`'s own single-transaction shape — nothing named this as a requirement in the kickoff, so I am naming it here).

**Flow 2 — Platform admin invites a person with NO account yet:** entry same form, admin enters an email with no matching `users` row → **no mechanism for this exists anywhere in the codebase today** (no invitation-token table, no Resend-driven invite email, no signup-time auto-linking of a pending person record to a freshly created `users` row). Building this for real is an email-queue-integrated, token-expiring, signup-flow-touching feature in its own right — a materially different and larger scope than Flow 1.
- Failure: undefined, because the flow itself is undefined. See Open Questions — I recommend this be explicitly scoped OUT of this pipeline (ship "existing user only" first) rather than silently assumed as a sub-case of "large."

**Flow 3 — Founding administrator's first session:** entry `/launch` after sign-in → `computeDestination()`'s matrix gives them `/o/<slug>` (one enterable org, no admin/platform predicates) → they see `/o/<slug>/admin/roles`, holding whatever the platform's designation act bundled onto them → they click through to `/admin/roles/new`, pick a template (congregation/presbytery `stated_clerk`) if the bootstrap grant didn't already include the substantive office, and/or grant existing tenant roles to other people via `grant-role-form.tsx`.
- Failure: if the org's 2FA policy (`twoFactorRequired`) applies to this user and they haven't enrolled, the Edge gate on `/o/*` redirects them to `/totp` before any of this renders — this composes for free with the existing gate and needs no special-casing, but the request doesn't mention it, so I'm naming it as confirmed-handled rather than silently assumed. If the bootstrap grant gave them the office template but *not* `role_grants.manage`/`roles.manage`, they can see their own permissions but cannot grant anything to anyone else — a dead end. See Gap 2 — this is the single most load-bearing design question in the whole feature.

**Flow 4 — Retrofit on an already-existing org (the actual PSV/wave-5 case):** entry same platform admin surface, but the org already has real `people`/`memberships` rows (imported via some prior ingest) and simply has zero current holders of `role_grants.manage`/the office permission — e.g., every prior grant lapsed, or the org was created before this pipeline shipped. Here the correct act is **pick an existing person at this org and grant them the role**, not create a new person — a materially different write path from Flow 1/2 (no `people`/`memberships` insert at all, just a `role_grants` insert bypassing the subset check). The kickoff names this ("the org created before this ships — retrofit path for existing orgs") but the flow-shape difference (create-person vs. pick-existing-person) isn't spelled out, and given the wave-5 goal is explicitly "finish the presbytery portal so PSV can be onboarded," **this may be the primary real-world branch, not the zero-people branch** — worth confirming with the user before Phase 3 designs zero-people-org as the default case.
- Failure: same shape as Flow 1 (org already has a holder → refuse; chosen person has no active membership → refuse; DB failure → atomic rollback).

## Permissions & Flags

- **Platform-act permission:** reuse `FEATURES.ADMIN_ORGANIZATIONS` (already gates org creation and brand editing at `/admin/organizations/[id]`, `src/lib/permissions.ts:20`) — `src/lib/permissions.ts` is FROZEN, and this act is squarely "platform operator does something to `organizations`," the same shape as everything else already gated on this key. No new `FEATURES.*` key needed.
- **Default roles (platform side):** `admin` (wildcard) plus anyone holding `ADMIN_ORGANIZATIONS` — unchanged from the existing surface.
- **Tenant side:** not a `FEATURES.*` key at all — it's a `role_grants` write. Whether it's a single new bespoke role, an adopted copy of the constitutional office template, or a bundle of both is a Phase 3 call, but per DECISION-106/109 it must not be a wildcard, and per Gap 2 below it must be enough to actually operate the roles UI afterward, not just hold the office.
- **New `AUDIT_ACTIONS` key needed:** yes, for the designation act itself — it's security-sensitive (it originates access) and platform-actor, so it should follow the `org.*` platform-actor prefix convention already used by `ORG_CREATED`/`ORG_BRAND_SET`, not the `tenant.*` self-service prefix (`src/lib/audit.ts:104,181-193`). Revocation does **not** need a new key if the founding grant is an ordinary `role_grants` row — the existing `TENANT_ROLE_REVOKED` path already covers it once granted through the normal mechanism.
- **Flag:** agree with the kickoff's own guess — not needed. This is onboarding plumbing with no member-visible rollout risk, and a flag would only add a second way for the one path that unlocks an org to be silently off.

## Gaps the Request Didn't Address

- **G1 (central, technical):** The bootstrap grant cannot go through `grantRole()`/`adoptTemplate()` at all — both structurally require the actor to already hold what they're granting, which is exactly the property that is false for the very first grant at an org. It needs its own platform-mediated write path that bypasses `assertPermissionSubset()` by construction (no check, because there is no prior actor to check against) — the same shape `createOrganization()`'s `baselineRoleSeedPlan()` already uses for the group-arm `member` role. Phase 3 should not attempt to "loosen" the subset check generically; that would reopen the escalation hole DECISION-106 closed. A narrow, named, platform-only bypass is correct; a general one is not.
- **G2 (central, design):** If the platform grants **only** the substantive office (e.g., the presbytery template's `credentials.manage`/`statistics.manage`/`per_capita.manage`), the founding administrator can do their own job but can never grant anyone else anything — `adoptTemplate()`/`grantRole()` still require *them* to already hold whatever they hand out, and `roles.manage`/`role_grants.manage` aren't part of any office template (DECISION-106 deliberately kept `roles.manage` off `stated_clerk`). If the platform instead bundles `role_admin`-equivalent (`roles.manage`) onto the same person, that person can operate the roles UI but **still cannot adopt the office template themselves** — `adoptTemplate()` checks the template's own permission set, which `roles.manage` doesn't satisfy. The only way the founding administrator becomes self-sufficient is if the platform act directly seeds the org's own adopted copy of the applicable template **and** grants role-management, in the same transaction — mirroring `scripts/seed-dev.sql:1228-1240`'s exact mechanism. This is real "one person holds two capability categories" concentration, the same shape DECISION-103/108/109 flagged for fixture people — except here it's a genuine production onboarding need, not a fixture convenience. Worth an explicit architect ruling on whether this is acceptable as a *deliberately time-boxed* bootstrap state (the org's own admins are expected to separate the two roles onto different people once they have more than one person), rather than a permanent design.
- **G3:** No in-app code path sets `people.user_id`, ever, outside `scripts/seed-dev.sql`'s hand-written UPDATEs. This is not a small missing helper — it's the entire "link a real person record to a real account" primitive, and this pipeline is the first place it would be built for real. Phase 3 needs to design this as its own function, not assume it exists.
- **G4:** The "invite a person with no account" path (Flow 2) requires an invitation-token/email-queue/signup-linking system that has zero precedent anywhere in this codebase. Building it well is a meaningfully larger scope than "designate an existing user." Recommend descoping to existing-user-only for this pipeline unless the user explicitly wants the invite system built now (see Open Questions).
- **G5:** Flow 4 (retrofit on an org that already has real people/memberships — likely the actual PSV case) is a materially different write shape (pick-existing-person, no `people`/`memberships` insert) from Flow 1/2/3's create-a-person shape. The kickoff names the retrofit case but doesn't distinguish the two branches; Phase 3 needs both, and should confirm which one PSV actually needs before assuming "zero people" is the primary path.
- **G6:** One-time-ness / re-designation rule is left to "analyst to rule" — my recommendation: the platform act must be **blocked**, not merely warned, whenever the org already has any currently-effective holder of the office/role-management permission being granted (read-then-write in one transaction, same shape as `wouldZeroOutRolesManageHolders`'s existing lockout-guard pattern). This also gives the platform a legitimate, narrow **recovery path** for an org that later locks itself out (every `role_grants.manage` holder revoked/lapsed) — the same "holder count back to zero" condition that blocks a premature re-designation is exactly what should re-enable a rescue designation. This should be named as an intended behavior, not an accidental side effect.
- **G7 (Two Hierarchies):** confirm the design creates no platform-held `role_grants` row that lingers after the act — this must be a single write that hands off entirely, leaving nothing behind for the platform to stand on later. Nothing in the kickoff suggests otherwise, but it's worth stating as an explicit acceptance criterion given this is exactly the invariant DECISION-100/101/106 have all deferred past.
- **G8 (mechanism choice):** the kickoff poses "SECURITY DEFINER function under §2c vs. a `getPlatformDb()` write in `(admin)`" as open. Given `createOrganization()` and every action in `admin/organizations/[id]/actions.ts` already establish "the `(admin)` write path is `getPlatformDb()` throughout, never `withOrgContext()`" (that file's own header comment) for exactly this kind of platform-operator act with no tenant membership to verify, `getPlatformDb()` is the precedent-consistent answer; a new SECURITY DEFINER function would be a heavier, novel mechanism that arms 3/4 of the resolver needed only because they run *from inside* a tenant transaction. This act runs from `(admin)`, not from a tenant session, so I don't see the DEFINER-function need — but I'll let the architect confirm.
- **G9 (roll status):** the founding administrator's own `memberships` row needs a roll-action decision. A congregation's normal `createPerson()` path inserts a *pending* `roll_actions` row awaiting Session approval (`roll.propose`/`roll.approve`) — nonsensical for a founding administrator at an org with no Session yet (or, for a presbytery, no Session ever). This should mirror DECISION-129's `rollAction: { kind: "none" }` / `engagementStatus = "staff"` precedent rather than manufacture an unapprovable pending roll entry.
- **G10 (empty state):** the very first `/o/<slug>/admin/roles` view for a founding administrator — is the empty-roles-list copy actionable ("adopt a template to get started") or generic? And for org types with no matching template (`synod`/`general_assembly`/`new_worshiping_community` all have zero rows in `app_roles` where `organization_id is null` scoped to them) — what does that admin see when the template list is legitimately empty? Not addressed by the request, which only discusses presbytery/congregation.
- **G11 (failure microcopy / atomicity):** the designation act must be one transaction (person + membership + role_grant(s)) — a partial failure that creates a `people` row with no role must not be possible. Not stated as a requirement anywhere in the kickoff; naming it here so Phase 3 doesn't leave it to implementer discretion.
- **G12 (mobile):** `/admin/organizations/[id]` is an internal admin surface but still subject to "Verify in a Browser" at 360px — no reason to expect special difficulty, but not yet confirmed.

## Out of Scope (confirm with user)

- Flow 2 (invite a person with no account) — recommend deferring to a follow-on pipeline unless the user wants the email-invitation system built now; it is a different-sized feature than the rest of this work.
- `/admin/organizations/new`'s missing `parentOrganizationId`/`relationshipType` UI control — already correctly assigned to the sibling `2026-09-28-organization-parent-picker` pipeline per the kickoff; not widened here.
- `presby_organize_congregation()`, the trust-property tripwire, committees — already excluded by the kickoff.
- Building a tenant-facing "why do I have this role" explainer (an `explainPermission()`-style affordance) for the founding administrator — nice-to-have, not required for a working handoff.

## Open Questions

- Should this pipeline build the "invite a person with no account" path (Flow 2) at all, or ship "designate an existing platform user" first and track the invitation system as its own future pipeline? (G4)
- For the real PSV case (the wave-5 motivating example): does that org already have real `people`/`memberships` rows with nobody holding the office/role-management permissions (Flow 4, pick-existing-person), or is it genuinely a zero-people org needing a brand-new person created (Flow 1/3)? This determines which write path is actually load-bearing. (G5)
- Is it acceptable for the founding-administrator bootstrap grant to bundle both the substantive office template AND role-management permissions onto one person, as a deliberately time-boxed state, or must the design find a way to avoid that concentration even at bootstrap? (G2)
- Should the platform-mediated designation function also serve as the org's own lockout-recovery mechanism (re-usable whenever holder count returns to zero), or should recovery from a self-inflicted lockout be handled by support-ticket-mediated engineering intervention instead, as today? (G6)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-28 |
| 2 — Architectural review | architect | Pending | — | — |



### Orchestrator rulings on the open questions (2026-09-28; the operator is told and may override)

1. **G4 — existing platform users only this pipeline.** No invitation-token/email system is built here. The path for a person with no account is: they self-register (the existing sign-up → `/access-pending` surface), then the platform admin designates them by email. Phase 3 documents that two-step in the admin form copy. The invitation system is a follow-on `docs/TODO.md` line at integration.
2. **G5 — both write shapes ship.** PSV will be created fresh through `/admin/organizations/new` (zero people), so create-person-and-link is the primary branch; pick-an-existing-person-at-this-org is required for retrofit and for lockout recovery. Same transaction shape, two entry conditions.
3. **G2 — yes, a deliberately time-boxed bundle.** The designation seeds the org's own adopted copy of the applicable constitutional template AND grants role management to the designee in one transaction (the `seed-dev.sql:1228-1240` mechanism made product). Concentration is expected to be split by the org's own admins once they have more than one person; the architect confirms or amends.
4. **G6 — the act doubles as lockout recovery.** Blocked while the org has any currently-effective holder of the permissions being granted; re-enabled when the holder count returns to zero. Named behaviour, audited.
5. G8: `getPlatformDb()` in `(admin)` per the `createOrganization()` precedent is the presumption; the architect rules. G9: `rollAction: none` / staff-style membership per DECISION-129. G1–G12 are carried verbatim above.

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-09-28.*

*Read-only review, 2026-09-28. Worktree `/Users/cshenso/git/presby-platform/presby-wt-boot` on `pipeline/founding-admin`; Neon branch `pipeline-founding-admin` queried read-only as `presby_app` (`env | grep DATABASE_URL` empty before the run; nothing created, altered or dropped).*

## Verdict

**Approved with suggestions** — with one finding (F111) that Phase 3 must design around and that the operator should see before Phase 4 starts. The feature's *shape* is right and Phase 1 does not need to be re-run, so per CLAUDE.md Phase 2's loop-back rule I document the resolution and advance. But the load-bearing content of the bundle is larger and more consequential than Phase 1 knew, because the subset check makes the designation act set the organization's **permanent permission ceiling**.

## Placement

**Directory placement**

| Path | Status | Purpose |
|---|---|---|
| `/Users/cshenso/git/presby-platform/presby-wt-boot/src/lib/founding-administrator.ts` | new | The whole act. `getPlatformDb()` posture, one transaction, typed result union, header comment recording the connection choice. Sibling to `org-provisioning.ts`, not folded into it: that module owns "bring an organization into existence," this owns "hand it over" — a distinct act with its own gate, its own audit key and two entry conditions, and folding it in would roughly double that file and its result union. |
| `.../src/lib/founding-administrator.test.ts` | new | Written by the implementer (Phase 4 gate), not by QA. |
| `.../src/app/(admin)/admin/organizations/[id]/actions.ts` | modify | One appended server action. This file is already `"use server"`, already `FEATURES.ADMIN_ORGANIZATIONS`-gated on every export, already `getPlatformDb()`-only, and already carries the `UUID_RE` / `PolicyResult` conventions. |
| `.../src/app/(admin)/admin/organizations/[id]/founding-administrator-section.tsx` | new | The form. |
| `.../src/app/(admin)/admin/organizations/[id]/page.tsx` | modify | Server Component; computes the gate state and renders the section. |
| `.../src/lib/audit.ts` | modify | One key, one clearly delimited addition (high-collision file per the kickoff). |
| `.../src/lib/db/domain/people.ts` | modify | The matching `uniqueIndex(...).where(...)` for the 0054 index, so Drizzle's model and the DDL agree under `check:schema-parity`. |
| `.../drizzle/0054_presby_founding_administrator.sql` | new | One index and one comment. Nothing else. See "Schema" below. |
| `.../scripts/seed-dev.sql` | modify | One appended block: a loginable fixture user with **no `people` row anywhere** — the create-branch rehearsal needs one and none exists (all three existing `set user_id` fixtures are already linked). |
| `.../scripts/test-rls.sql` | modify | §44, appended. |

**Do NOT create `src/lib/onboarding/`.** One module is not a subdirectory. When the invitation system (the deferred Flow 2) lands, that is the second module and the directory can be created then, with both moved in one commit.

**`src/lib/permissions.ts` is untouched.** Reuse `FEATURES.ADMIN_ORGANIZATIONS` (`src/lib/permissions.ts:20`) — this act is "a platform operator does something to an `organizations` row," byte-for-byte the shape of every other export in the actions file it joins. No new `FEATURES.*` key, no exception to the freeze, and no new `permissions` catalog row either (the bundle carries existing keys only, so DECISION-078 is satisfied trivially).

**Server vs Client split**

- `page.tsx` stays a Server Component. It reads the org, runs the holder-count gate read, and passes `{ organizationId, organizationType, canDesignate, currentHolderCount }` as props. The gate is computed on the server on every render; it is never trusted from an earlier render (the discipline `roleHolderCount()` already states at `src/lib/role-definitions.ts:125`).
- `founding-administrator-section.tsx` is `'use client'` for exactly one reason: pending/error state on a single-input form (`useActionState`/`useTransition`), mirroring `profile-form.tsx`/`site-section.tsx` in the same directory.
- The confirm step is a shadcn `AlertDialog`, never `confirm()` (Workflow Rule 2). This act originates access and should not be a bare submit.
- No hand-rolled button/input class strings (Component Rule 5). No new shadcn primitive is expected; if one is, `npm run ui:add -- <name>`, never raw `shadcn add` (DECISION-048).
- `(admin)` is platform palette. Nothing here is brandable; `check:brand-scope` is unaffected.

**Dependencies:** none. Evaluated against all five criteria and nothing is needed — `drizzle-orm`, `node:crypto` and the existing shadcn primitives cover it.

## Invariants Touched

| Invariant | How this change respects it |
|---|---|
| **Two Hierarchies Intersect Nowhere** | Confirmed against the resolver's own text (`drizzle/0010_presby_resolver.sql:52-113`): all four arms join on `rg.person_id` / `rg.group_id`. `role_grants.granted_by` is never read by any arm, so recording the operator's `users.id` there is provenance only — the same role `organization_affiliations.recorded_by` plays in `createOrganization()`. The act writes **no** platform-held `role_grants` row, **no** platform-held `memberships` row, and introduces **no** platform predicate into any tenant authority check. The mechanical test for Phase 5: `src/lib/authz.ts`, `src/lib/role-definitions.ts`, `src/lib/role-grants.ts` and `drizzle/0010` are **unchanged by this pipeline**. A diff that touches any of them fails this review. After the act, the platform's standing capability at that org is exactly what it was before (brand / site / profile under `ADMIN_ORGANIZATIONS`). |
| **Isolation Is a Database Property** | The act runs entirely on `getPlatformDb()`, which authenticates as `neondb_owner` — `rolbypassrls = t`, verified on the branch. **The platform connection must never call `set_config('app.current_org_id', …)`.** A BYPASSRLS role carrying tenant context on a pooled connection is a new and bad precedent, and the only thing it would buy is satisfying `presby_effective_permissions()`'s anti-fishing guard (F107). Forbidden by name. |
| **No Role Carries a Wildcard** | The bundle is a closed, enumerated, per-item-justified tier-1 list plus the org-type's constitutional office template. Every tier-2 permission outside the office and **every** tier-3 permission (pastoral, demographic, medical, disabilities, children's roster) is excluded. Not `*`, and not `*` by enumeration either — 7–8 of 25 catalog keys. |
| **Permissions vs Flags** | Unchanged and correctly split. Platform side: `FEATURES.ADMIN_ORGANIZATIONS` (a permission). Tenant side: `role_grants` rows (permissions). **No flag.** I agree with Phase 1 and the kickoff: a flag here would only add a second way for the one path that unlocks an organization to be silently off. |
| **The Roll Is the System of Record** | The designee's membership is DECISION-129 staff-style: `engagementStatus: "staff"`, `currentRoll: null`, **no `roll_actions` row**. The platform must not fabricate a roll fact for a person it has never met, and a `pending` roll action at an org with no Session is unapprovable by construction. Consequence, named: `getDirectory()`/`findPersonMatches()` exclude `'staff'` rows by literal-string test, so the designee does not appear in the directory until the org's own people-manage holder enrolls them properly. That is correct, not a bug. |
| **Composite Tenant Keys** | Both composite FKs on `role_grants` are satisfied in-transaction given the write order below. No new FK, no new table. |
| **Never Hard-Delete a Person** | Untouched. The 0054 index's predicate excludes `merged_into_id is not null` precisely so the merge chain keeps working: the loser is tombstoned, the winner keeps the `user_id`. |
| **Extensibility Goes Through Support** | This is why `tickets.file` is in the bundle. An organization that cannot file a ticket cannot ask for anything, and CLAUDE.md says the ticket loop "cannot be built last." |
| **Verify in a Browser** | Mandatory rehearsal, spelled out under Ruling 10. |
| **No Real Data** | The seed fixture addition follows house style: invented name, `example.invalid`, the shared fixture password already documented in `docs/testing.md`. |

## Notes

### Ruling 1 — Mechanism: `getPlatformDb()` transaction in `(admin)`. Confirmed, with reasons the analyst did not have.

Phase 1's G8 presumption is correct, and the live catalog makes the case sharper than precedent alone.

**§2c's function-mediation rule does not apply.** I read it in full (`docs/schema-design-2.md:388-484`). It governs *cross-council* access to the three-axis organization tables (`organization_lifecycle_events`, `organization_affiliations`) — a synod that can reach neither Presbytery A's nor Presbytery B's RLS context. This act has no second council anywhere in it: it is platform → one organization, on `people` / `memberships` / `app_roles` / `app_role_permissions` / `role_grants`. A SECURITY DEFINER function would add a new trusted surface to solve a problem the owner connection does not have.

**The owner path is not merely acceptable here, it is the only honest one.** `withOrgContext(personId, orgId, fn)` verifies an *active membership* before trusting the org id. The precondition of this entire act is that no such person exists. Fabricating one to satisfy the gate is the phantom-membership violation that `.../admin/organizations/[id]/actions.ts:37-49` already names by name.

**Trigger audit — every trigger on every table this act writes, read off `pg_trigger` on the branch, not off `drizzle/`:**

| Table | Trigger | `prosecdef` | Behaviour on the owner path |
|---|---|---|---|
| `people` | `people_guard_delete` | **t** | BEFORE DELETE only. Inserts unaffected. **But it fires for `neondb_owner` too** — see the test-cleanup note in Ruling 10. |
| `memberships` | `memberships_guard_insert` | **t** | Fires. Refuses if the person holds a membership at *any* org. This makes the `person_elsewhere` refusal (F108) a **database property**, not a TypeScript courtesy. |
| `memberships` | `memberships_sync_derived_group` | f | Fires as `neondb_owner`. SECURITY INVOKER, but `neondb_owner` is BYPASSRLS, so its `select … from groups where derived_from = 'active_membership'` resolves correctly. Raises `foreign_key_violation` if the org has no `active_membership` group — reachable on the retrofit branch for any org predating the F16 seed. Map it to a named `provisioning_incomplete` result, never a 500. |
| `memberships` | `memberships_guard_end` | f | Not reached (no `ended_on` write). |
| `group_memberships` | `group_memberships_reject_derived` | f | The sync trigger inserts `source = 'derived'` into a `membership_source = 'derived'` group, so the reject predicate is false. Passes. |
| `role_grants` | `role_grants_needs_membership` | f | Fires. Refuses an open grant when the membership's `ended_on` is set — this is the `membership_ended` refusal, enforced by trigger. |
| `app_roles`, `app_role_permissions` | — | — | No triggers at all. |

**Grants (`aclexplode`, verified):** `neondb_owner` holds full DML on all seven tables. Nothing new is needed. One observation for the next security review, *not* this pipeline's to fix: a `presby_platform` role exists with `rolbypassrls = t` and a narrower, deliberately-shaped grant set, but `PLATFORM_DATABASE_URL` connects as `neondb_owner`. That is F38-class drift between a role's stated purpose and the connection that actually runs.

**Write order (binding).** `people` → `memberships` → `app_roles` → `app_role_permissions` → `role_grants`. One `platformDb.transaction()`, closing Phase 1's G11.

**Two small divergences from `createPerson()`, both deliberate, both to be documented in the new module's header:**
1. Use `.returning({ id: people.id })`, not `createPerson()`'s client-generated `randomUUID()`. That trick exists only because `people`'s RETURNING-side SELECT policy bites under `presby_app`; `neondb_owner` bypasses RLS, so the workaround is noise here.
2. A pre-check `select` for "does this user already have a person row, and where" **is** legal on this connection (it sees across orgs). Use it for the humane message, and still keep the `memberships_guard_insert` catch as the authoritative gate — the same pre-check-plus-catch shape `createOrganization()` uses for `slug_taken`, and the same `errorMessageChain()` walk (`src/lib/people.ts:218`) because Drizzle buries the driver message on `.cause`.

### Ruling 2 — Two Hierarchies: confirmed clean. See the invariants table above; the mechanical test is the "four files unchanged" rule.

### Ruling 3 — The bundle. **This is the substance of the review, and F111 changes it.**

Phase 1's G2 asked whether bundling office + role management on one person is acceptable. Tracing it further produced a finding neither Phase 1 nor any prior decision has named:

> **F111 — under `assertPermissionSubset()`, an organization's reachable permission set is permanently closed at whatever its first grant contained.**
>
> `createRole()` checks the full proposed set, `setRolePermissions()` checks the added delta, `adoptTemplate()` checks the full template set, and `grantRole()` checks the target role's full set. There is no path that adds a permission key nobody at the org already holds. Therefore **the designation act sets the organization's permanent ceiling**, and `adoptTemplate()` cannot raise it — which means adopting a template can only ever hand over a set the adopter already had.
>
> Measured on the branch: **19 of 25 catalog permissions are carried by no template at all.** The concrete casualty is `staff.manage` — `personnel_admin` is the org-type-neutral template DECISION-129 minted precisely so any org could self-serve it, and it is unreachable for every real organization, forever. `congregation_oversight.manage` — the permission the wave-5 presbytery oversight surface exists for — likewise has no template and never will (DECISION-119 refused a binding on DECISION-078 grounds).

Two consequences.

**(a) The bundle must be chosen on a principle, not assembled ad hoc**, because it is the ceiling. The principle:

> The founding-administrator bundle carries the org-type's constitutional office template, **plus exactly those tier-1 permissions that (i) no constitutional template carries, (ii) no constitutional template ever will — DECISION-110/115/119's own finding that no PC(USA) office is their keeper — and (iii) standing the organization up requires.**

Applying it, `foundingAdministratorPlan(organizationType)` — the direct sibling of `baselineRoleSeedPlan()`, same inline-plan shape, same file-local placement (DECISION-100's precedent) — returns:

*Office half, copied from the live template row inside the transaction so `drizzle/0037`/`0052` stay the single source of the office's permission set:*
- `presbytery` → `presbytery_stated_clerk` · `congregation` → `congregation_stated_clerk` · `synod` / `general_assembly` / `new_worshiping_community` → **none** (verified: no template is scoped to them). The act still succeeds for those types with the administration half alone; that is an `ok`-variant field, not a failure.

*Administration half — one role, permissions enumerated, each justified:*

| Key | Why it qualifies |
|---|---|
| `people.manage` | Nothing at all can happen without a person. Non-negotiable. |
| `roles.manage` | Define roles, adopt templates. |
| `role_grants.manage` | Assign them. Without it the office can work but can delegate nothing — Phase 1's Flow 3 dead end. |
| `groups.manage` | DECISION-110: no office is its keeper, so no template will ever carry it. Group-arm grants are impossible without it. |
| `officers.manage` | Seats the Session/diaconate, which is what makes the derived-group rosters — and therefore every group-arm grant — resolve to anybody (F3). |
| `org_features.manage` | `isOrgFeatureEnabled()` returns `row?.enabled ?? false` (`src/lib/org-features.ts:167`). Per-org toggles default **off**, so without this the portal is inert on day one. |
| `tickets.file` | "Extensibility Goes Through Support" is a Key Invariant and says the ticket loop cannot be built last. An org that cannot file a ticket cannot ask for anything. |
| `congregation_oversight.manage` | **Presbytery only.** Template-less by DECISION-119, and it is what the wave-5 oversight surface is for. The org-type branch is the `groupSeedPlan()`/`baselineRoleSeedPlan()` precedent exactly. |

Excluded, by name, so nobody adds them quietly later: `roll.propose` / `roll.approve` (the roll is the system of record and approval is a Session act — a founding administrator enrolls people as `staff`-kind anchors and the roll begins when the Session is seated); `branding.manage`, `events.manage`, `directory.view_hidden` (not required to stand an org up); every remaining tier-2 key; **every** tier-3 key. `directory.view` is deliberately absent — the designee gets it free through the baseline `member` group role, since `memberships_sync_derived_group` puts them in `active_membership`.

**(b) One role, not six, and a distinct key.** Mint `founding_administrator` (name "Founding Administrator"), **`role_kind: 'custom'`, `is_protected: false`** — and that last part is load-bearing, not incidental. `role-definitions.ts` refuses every mutation on a protected role, so seeding this as `constitutional`/`protected` (the shape `seed-dev.sql` uses for its fixtures) would make the bootstrap concentration **permanent and un-splittable** by the org that inherits it. Unprotected, the org's own admins deactivate it the day they split the capabilities, and the existing `wouldZeroOutRolesManageHolders` / `revokeRole()` lockout guards already stop them doing so into a lockout. The adopted office copy is likewise `custom`/unprotected, matching `adoptTemplate()`'s own product semantics.

Do **not** reuse the key `role_admin`: that is a decided single-purpose role (`roles.manage` alone, DECISION-106), and an org-owned role with the same key and a wider set would give one key two incompatible meanings. A distinct key also makes the bootstrap state *queryable* — "which orgs still have a live `founding_administrator` grant?" is answerable, which is the only thing that makes "deliberately time-boxed" more than a sentence in a decision log. And do **not** seed it as a template row: it would then appear in every org's adopt-a-template list. Inline TS plan, per `baselineRoleSeedPlan()`.

**(c) DECISION-106's subset check gets NO bypass — it is simply not on this path.** `assertPermissionSubset()` takes an `OrgTx` (a `presby_app` transaction) and an `actorPersonId`. The designation transaction has neither. The check is not bypassed; it is inapplicable, exactly as it is inapplicable to `createOrganization()`'s baseline `member` seed. **Binding instruction to Phase 3: do not add a bypass parameter to `assertPermissionSubset()`, `adoptTemplate()` or `grantRole()`, and do not reuse `adoptTemplate()`'s body through a platform entry point.** A boolean that disables a security check is the one flag that must never be set wrong, and I considered and rejected the alternative (exempting `adoptTemplate()` from the check) because `grantRole()` still checks, so the ceiling would simply reappear at the grant step while the escalation hole DECISION-068 closed would be reopened. Copy the template's permission set with a plain read-and-insert.

**(d) Follow-up, and it is not optional before PSV goes live.** F111 means every organization's ceiling is fixed at designation and `staff.manage` is unreachable for all of them. This pipeline **must not** paper over that by growing the bundle one permission at a time — that is precisely how `founding_administrator` becomes a wildcard by accretion, the drift DECISION-101/103/106 refused three times. It needs its own pipeline, and I recommend the orchestrator open a `docs/TODO.md` line at integration: *"Permission ceiling (F111): an org's reachable permission set is closed at its first grant; decide how a template's curated set may be adopted and granted without reopening DECISION-068's escalation hole."*

### Ruling 4 — The user→person link primitive: one input, three outcomes, no person picker.

The primitive lives in `src/lib/founding-administrator.ts`, **not** `src/lib/people.ts` — that file's stated shape is "one `withOrgContext()` transaction per export," and a platform-connection writer inside it would falsify its own header.

**The operator supplies one thing: the target's email.** The database chooses the branch, not the operator:

1. No `users` row → `no_such_user`. Not an enumeration risk: the caller is a vetted `ADMIN_ORGANIZATIONS` holder, and DECISION-040's uniform-response discipline is about anonymous and tenant probers. **Say so in the code comment**, so nobody later "hardens" these into one message and destroys the operator's ability to tell what went wrong.
2. `users` row, `is_active = false` → `user_inactive`. The proxy bounces deactivated accounts before `/launch`; designating one hands the org to nobody.
3. `users` row, no `people` row anywhere → **create-person-and-link** (the primary branch, PSV's case).
4. `users` row, `people` row with a live membership *at this org* → **pick-existing-person**; skip the `people`/`memberships` inserts entirely, write only the roles and grants.
5. `people` row at this org with `ended_on` set → `membership_ended`, naming the date. Enforced by `role_grants_needs_membership` regardless.
6. `people` row holding a membership at **another** org → `person_elsewhere`. **F108.** Refuse; do not create a second `people` row. Cross-org person linking is `presby_link_person()`'s domain and requires an evidence reason (transfer certificate, claim token) — none of which describes "a platform operator typed an email." `memberships_guard_insert` refuses it on the owner path too, so the refusal is a database property.

This removes the person-picker entirely, and with it the roster dump to the platform operator. It also makes Flows 1 and 4 one form, satisfying the orchestrator's ruling 2 ("same transaction shape, two entry conditions") more literally than a UI toggle would.

**Uniqueness (F110):** global, on `people.user_id`, partial. `people` is global by D1 and the column's own comment already asserts "One human, one login." — but only a non-unique `people_user_idx` exists (verified). `userOrganizations()` (`src/lib/authz.ts:341-352`) already carries a TypeScript de-duplication loop whose own comment says the only reachable duplicate is two live `people` rows sharing a `user_id`. That is a rendering workaround standing in for a missing constraint, on a column this pipeline is about to write for the first time in production.

### Ruling 5 — The gate and the recovery path.

**Condition.** Blocked while the org has ≥1 currently-effective holder of `roles.manage` **or** `role_grants.manage` — the administration half, not the office half. An org is headless exactly when nobody there can grant anything; the office half is adoptable by any `roles.manage` holder through the ordinary product path, so its presence says nothing. This also makes the block condition and the recovery condition the same sentence, which is what the orchestrator's ruling 4 asked for.

**Query.** The same CTE as `wouldZeroOutRolesManageHolders` (`src/lib/role-definitions.ts:171-203`) — person arm, plus group arm expanded through live `group_memberships` — keyed on `permission_key in ('roles.manage','role_grants.manage')`, no `excludeRoleId`, run on `platformDb`. The new module's comment must say it is a deliberate parallel implementation of that shape and point at it by `file:line`, the same discipline that helper's own comment already uses.

**It must NOT call `presby_effective_permissions()` (F107).** The function raises `insufficient_privilege` unless `presby_current_org()` equals the org argument (`drizzle/0010:44-49`), and the platform connection has no org context. Satisfying the guard by calling `set_config` on a BYPASSRLS pooled connection is forbidden — see the Isolation row above.

**Lock.** `select id from organizations where id = $1 for update` as the **first** statement of the transaction, before the holder-count read. This is a phantom-read problem, not a row-lock problem: when the count is zero there are no `role_grants` rows to lock, so locking the table being counted cannot serialize it. The `organizations` row is the natural serialization point, it always exists, contention is scoped to concurrent designations for that one org, and it introduces no new mechanism. (`pg_advisory_xact_lock` is an acceptable alternative if tech-lead finds contention with another writer, but it *is* a new mechanism and would need its own named comment.)

**Backstop.** `app_roles_org_key` is unique on `(organization_id, key)`, so a racing second designation fails with 23505. Catch it and map it to the same refusal, exactly as `createOrganization()` maps its `slug_taken` TOCTOU.

**F109 — recovery must reuse, not insert.** On the recovery path the org already has the `founding_administrator` row (and the adopted office copy) the *first* designation minted, possibly deactivated with its grants ended. A second insert collides with `app_roles_org_key`. Recovery must: reuse the existing role rows if present, clear `deactivated_at`, reconcile `app_role_permissions` to the plan, and insert fresh `role_grants`. Phase 1 named the recovery *condition* but not this consequence.

### Ruling 6 — Membership and person shape

`memberships`: `engagementStatus: "staff"`, `currentRoll: null`, `householdId: null`, no `roll_actions` row (DECISION-128/129). `people`: `firstName`, `lastName`, `userId` and nothing else — both name columns are NOT NULL, everything else is nullable. **Write no `contact_methods` and no `person_identifiers` row.** The operator typed an email into an admin form; that is not evidence of anything, and `person_identifiers_verified_unique_idx` is a landmine for a row nobody verified. The org's own `people.manage` holder fills the profile in — which they now can, because the bundle includes `people.manage`.

Name source for the created person: the `users.name` column, split on the last space (first/last), falling back to the email local-part when null. State the heuristic in a comment and let the org correct it; do not add name fields to the platform form.

### Ruling 7 — Placement: see the table above. `src/lib/permissions.ts` untouched, `FEATURES.ADMIN_ORGANIZATIONS` reused.

**One placement ruling the kickoff left open.** The kickoff puts a founding-administrator control on `/admin/organizations/new` in scope. It must **not** be folded into `createOrganization()`'s transaction: that function has a single purpose, a typed result union and a real test matrix, and bolting on an independently-failing concern doubles all three. If tech-lead wants the control on the create form, it is **two transactions and two audit events**, with honest partial-success copy ("The organization was created. The founding administrator could not be designated: …") — the E-c2 pattern `setOrganizationBrandAction` already established. My recommendation is simpler: the create action redirects to `/admin/organizations/<id>`, where the designation section renders first and prominently while the org has zero holders.

### Ruling 8 — Audit

`ORG_FOUNDING_ADMINISTRATOR_DESIGNATED: "org.founding_administrator.designated"` — correct under the `org.*`-platform-actor / `tenant.*`-self-service convention (`src/lib/audit.ts:151-155`), alongside `ORG_CREATED` and `ORG_BRAND_SET`. Metadata: `{ organizationId, personId, userId, mode: "created_person" | "existing_person", officeRoleKey | null, administrationRoleKey, permissionKeys, priorHolderCount }`. Ids, not names or emails.

**One key only.** Revocation rides the existing `TENANT_ROLE_REVOKED` — the founding grant is an ordinary `role_grants` row, which is the whole point. A *refused* designation writes nothing: Workflow Rule 7 audits mutations, and a refusal mutates nothing. `npm run check:audit` is satisfied by the new key.

### Ruling 9 — Schema: `drizzle/0054` is needed, and carries exactly one index.

```sql
create unique index if not exists people_user_id_unique_idx
  on people (user_id)
  where user_id is not null and merged_into_id is null;
```

…plus a `comment on index`. No table, no column, no function, no grant, no policy, no trigger.

The kickoff's prior was that 0054 should stay unused if the act is a pure data write. I am overriding that, narrowly, for one reason: **this pipeline builds the first in-app writer of `people.user_id`.** Until now the column was fixture-only, so "one human, one login" was paper by accident. Shipping a production writer without the constraint makes it paper by decision — and `authz.ts` already ships a de-duplication loop for exactly the duplicate this index forbids. The predicate excludes tombstoned rows so the `merged_into_id` chain is unaffected.

**Phase 4 must probe before writing it** (database-admin), against `development`, not just this branch:

```sql
select user_id, count(*) from people
 where user_id is not null and merged_into_id is null
 group by 1 having count(*) > 1;
```

The three `set user_id` fixtures in `scripts/seed-dev.sql` are distinct, so the fixture is clean. If any shipped environment returns rows, the index becomes a follow-up and this pipeline ships with the TypeScript check alone — name it, don't assume it.

DECISION-150's from-scratch rule applies: `npm run check:schema-parity` on a fresh database plus the `docs/testing.md` from-empty recipe, rehearsed locally (CI `db-tests` still skips). `src/lib/db/domain/people.ts` gains the matching `uniqueIndex(...).where(...)` in the same commit.

**`scripts/test-rls.sql` §44** should assert the *tenant-side* truth of what the platform wrote, since the write path itself has no RLS to exercise: as `presby_app` with the org context set, (i) `presby_has_permission(designee, org, 'roles.manage')` is true; (ii) a person at a *different* org sees none of it; (iii) `presby_app` still cannot insert an `app_roles` row whose `organization_id` differs from `presby_current_org()`; (iv) the new unique index rejects a second live `people` row with the same `user_id`.

### Ruling 10 — E2E and the browser rehearsal

`src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/` and `src/lib/auth/` are **not** touched, so CLAUDE.md's MFA-e2e Phase 4 gate does not fire. But this act creates the first real `people.user_id` link — the join a session resolves tenant identity through — so a browser rehearsal of the whole handoff is **mandatory and is a Phase 5 PASS condition**:

1. Create a fresh org through `/admin/organizations/new`.
2. Designate the new no-person fixture user by email at `/admin/organizations/<id>`.
3. Sign out; sign in **as the designee**.
4. `/launch` routes to `/o/<slug>` (single enterable org).
5. Reach `/o/<slug>/admin/roles` **by clicking, not by typing the URL** — `roles` is `category: "administer"` (DECISION-105), so confirm there is a nav path for a brand-new org. (Good news, verified: `visiblePortalTiles()` gates on the global `isFlagEnabled()` only, and the roles page checks `org_portal.roles` only — neither consults the per-org toggle, so the default-off toggle is not a second dead end here. Confirm `org_portal.roles` is seeded on.)
6. **Grant a role to a second person.** This is the non-negotiable step: it is the only one that proves the bundle is actually self-sufficient, and it is invisible to unit tests.
7. Return to `/admin/organizations/<id>` and confirm a second designation is now refused.
8. 360px viewport on the admin form (Phase 1 G12).

Two logistics notes. **The rehearsal consumes single-use seed rows** (the withdraw pipeline's QA FAIL) — hence the new seed fixture: a loginable user with **no `people` row anywhere**, because all three existing `set user_id` fixtures are already linked and would land on the pick-existing branch, never exercising the branch this feature is primarily for.

**Test cleanup, `people_guard_delete`.** That trigger is SECURITY DEFINER and fires for `neondb_owner` too (verified), so a test cannot delete a person the act created — the row carries no `deletable_until` and production person rows never should. The clean answer: the test reads back the returned `personId`, `update people set deletable_until = fixtureDeletableUntil() where id = …` on the platform connection, then deletes. **Do not** add a fixture-only parameter to the production function to make tests tidy.

### Findings for `docs/schema-design-2.md` §2m (orchestrator applies at integration)

- **F107** — `presby_effective_permissions()` raises unless `presby_current_org()` equals its org argument, so it is uncallable from the platform connection; the holder-count gate is a plain CTE on `platformDb`, and setting `app.current_org_id` on a BYPASSRLS pooled connection to satisfy the guard is forbidden.
- **F108** — a user whose `people` row holds a membership at another organization has no in-app link path; `memberships_guard_insert` refuses it on the owner path too, so the refusal is a database property and must surface as a named result, never a duplicate `people` row.
- **F109** — a recovery designation collides with `app_roles_org_key` on the roles the first designation minted; recovery must reuse-and-reactivate, not insert.
- **F110** — `people.user_id` carries only a non-unique index while the column's own comment asserts "one human, one login"; `userOrganizations()` already de-duplicates in TypeScript for exactly the duplicate a partial unique index would forbid.
- **F111** — under `assertPermissionSubset()` an organization's reachable permission set is permanently closed at its first grant; `adoptTemplate()` cannot widen it, 19 of 25 catalog permissions are carried by no template, and `staff.manage` (`personnel_admin`, minted org-type-neutral by DECISION-129 precisely so any org could self-serve it) is therefore unreachable for every real organization. The founding-administrator bundle is the org's permanent ceiling.

### Proposed DECISION-155

> **DECISION-155: The founding-administrator designation is a `getPlatformDb()` transaction in `(admin)`, not a SECURITY DEFINER function — §2c's function-mediation rule governs cross-*council* access and this act has no second council; it mints one org-owned, unprotected `founding_administrator` role carrying an enumerated tier-1 set (`people.manage`, `roles.manage`, `role_grants.manage`, `groups.manage`, `officers.manage`, `org_features.manage`, `tickets.file`, plus `congregation_oversight.manage` for a presbytery) alongside an adopted copy of the org-type's constitutional office template; DECISION-106's subset check is not bypassed but is inapplicable — `assertPermissionSubset()`, `adoptTemplate()` and `grantRole()` are unchanged by this pipeline; and F111 is recorded: the subset check closes an organization's reachable permission set at its first grant, so the designation is the org's permanent ceiling and raising it is its own future pipeline**
>
> **Status:** Resolved · **Date:** 2026-09-28 · **Feature:** `2026-09-28-founding-administrator` (Phase 2)
>
> Five rulings closing the bootstrap gap DECISION-100/101/106 each deferred in turn. **First, the mechanism.** `docs/schema-design-2.md` §2c's function-mediation rule was written for cross-council reach into the three-axis organization tables, where the acting council's session context is neither party's; this act is platform → one organization on `people`/`memberships`/`app_roles`/`app_role_permissions`/`role_grants`, with no second council in it, so a new SECURITY DEFINER surface would solve a problem the owner connection does not have. `getPlatformDb()` (authenticating as `neondb_owner`, `rolbypassrls = t`) is precedent-consistent with `createOrganization()` and with `(admin)/admin/organizations/[id]/actions.ts`'s own header, and it is the only honest choice: `withOrgContext()` requires an actor with an active membership, and the precondition of this act is that no such person exists — fabricating one is the phantom-membership violation that header already names. A live-catalog trigger audit (not a read of `drizzle/`) confirms the owner path is safe: `memberships_guard_insert` (SECURITY DEFINER) fires and turns "this person belongs to another organization" into a database refusal rather than a duplicate row; `memberships_sync_derived_group` (SECURITY INVOKER) resolves correctly because the owner bypasses RLS, and raises only for an organization predating the F16 group seed, which becomes a named `provisioning_incomplete` result; `role_grants_needs_membership` turns an ended relationship into a refusal; `app_roles`/`app_role_permissions` carry no triggers at all. **Second, Two Hierarchies.** The act leaves nothing behind for the platform to stand on: every `role_grants` row names the designee, `granted_by` is provenance the resolver's four arms never read, and no platform predicate enters any tenant authority check — the mechanical test being that `src/lib/authz.ts`, `src/lib/role-definitions.ts`, `src/lib/role-grants.ts` and `drizzle/0010` are unchanged by the pipeline. **Third, the bundle.** One org-owned role keyed `founding_administrator` — deliberately not `role_admin`, whose single-permission meaning DECISION-106 fixed, and deliberately a distinct key so "is this organization still in bootstrap?" stays queryable — carrying the enumerated tier-1 set above and nothing from tier 3 or (outside the office template) tier 2, minted `role_kind: 'custom'`/`is_protected: false` so the org's own admins can actually dissolve the concentration, which a protected role would make permanent. The office half is copied from the live template row so `drizzle/0037`/`0052` remain the single source of the office's permission set; synod, GA and NWC have no template and receive the administration half alone. DECISION-106's subset check is *not* given a platform-only bypass: it takes an `OrgTx` and an `actorPersonId`, and the designation transaction has neither, so it is inapplicable exactly as it is to `createOrganization()`'s baseline `member` seed — no bypass parameter is added to any security function, and the exempt-`adoptTemplate()` alternative was considered and rejected because `grantRole()` would still check (reinstating the ceiling one step later) while reopening DECISION-068's escalation hole. **Fourth, the gate.** Blocked while the organization has any currently-effective holder of `roles.manage` or `role_grants.manage`, re-enabled when that count returns to zero, which makes the block condition and the lockout-recovery condition one sentence; read and write in one transaction behind `select … from organizations where id = $1 for update`, because with a zero count there are no `role_grants` rows to lock and this is a phantom-read problem; the holder count is a plain CTE on the platform connection, never `presby_effective_permissions()`, which raises unless `presby_current_org()` matches — and the platform connection must never call `set_config('app.current_org_id', …)`. **Fifth, and the finding that outlives this pipeline (F111):** `assertPermissionSubset()` is checked by `createRole()`, `setRolePermissions()`, `adoptTemplate()` *and* `grantRole()`, so no path ever adds a permission key nobody at the organization already holds, and an organization's reachable permission set is therefore permanently closed at whatever its first grant contained. Measured on the live catalog, 19 of 25 permissions are carried by no template; the concrete casualty is `staff.manage`, whose `personnel_admin` template DECISION-129 minted org-type-neutral specifically so that any organization could self-serve it. The designation is consequently the organization's permanent ceiling. This pipeline does not paper over that by growing the bundle one permission at a time — that is precisely the accretion DECISION-101/103/106 refused three times — and instead records F111 and opens a follow-on pipeline to decide how a platform-curated template's set may be adopted *and granted* without reopening the escalation hole. One migration, `drizzle/0054_presby_founding_administrator.sql`, carrying exactly one partial unique index on `people.user_id` (F110): this pipeline is the first in-app writer of that column, `userOrganizations()` already de-duplicates in TypeScript for exactly the duplicate the index forbids, and shipping a production writer without it would convert a paper invariant from accident into decision. New audit key `ORG_FOUNDING_ADMINISTRATOR_DESIGNATED` (`"org.founding_administrator.designated"`) on the platform-actor axis; no new `FEATURES.*` key (`ADMIN_ORGANIZATIONS` is reused, `src/lib/permissions.ts` untouched), no new `permissions` row, no flag, no new dependency.



### Orchestrator rulings (2026-09-28)

All ten rulings accepted; the three binding items stand (no bypass parameter on any security function; the platform connection never sets `app.current_org_id`; `src/lib/authz.ts`, `src/lib/role-definitions.ts`, `src/lib/role-grants.ts` and `drizzle/0010` unchanged). On the three items left to the tech-lead: (1) the control lives on `/admin/organizations/[id]` only — the create action redirects there; no second transaction on the create form; (2) rehearsal step 6 is a scripted manual walk recorded with screenshots in Phase 4 and repeated by QA in Phase 5 — Playwright coverage of the handoff is a follow-up for the presbytery-e2e pipeline once this merges; (3) the created-person name heuristic is the architect's (`users.name` split on the last space, email local-part fallback), stated in a comment. **F111 does not block PSV go-live** — the ruled bundle carries every permission the wave-5 presbytery surfaces need — but a `docs/TODO.md` line opens at integration for its own pipeline. Migration `0054` is used (one partial unique index, F110), gated on the Phase 4 duplicate probe against `development`. DECISION-155 and F107–F111 adopted as proposed.

---

# Phase 3 — Technical Design (tech-lead)

*Worktree `/Users/cshenso/git/presby-platform/presby-wt-boot` on `pipeline/founding-admin`; Neon branch `pipeline-founding-admin` (`br-empty-frost-ax4mo8q5`), catalog read only, nothing created. `env | grep DATABASE_URL` confirmed empty before every query.*

## Summary

A platform admin can currently create an organization but has no product path to hand it to a real tenant administrator: `createOrganization()` seeds only a group-arm `member`/`directory.view` role, `assertPermissionSubset()` refuses every subsequent grant because nobody at a fresh org holds anything to grant from, and no in-app code path has ever set `people.user_id` for a real account. This pipeline builds `src/lib/founding-administrator.ts` — a single `getPlatformDb()` transaction, reachable from one new server action and one new section on `/admin/organizations/[id]`, that resolves a platform operator's typed email to a `users` row, links (or reuses) that account's `people` row at the target organization, and grants it an enumerated, unprotected `founding_administrator` role plus the org-type's constitutional office template. The act is the org's one-time (and self-inflicted-lockout-recovery) bootstrap: after it runs, every further grant flows through the ordinary tenant role-administration UI, and the platform holds nothing behind at the org beyond `granted_by` provenance. This closes DECISION-100/101/106's standing gap and is the load-bearing prerequisite for PSV's onboarding (wave 5).

## Permissions & Flags

- **Platform-act permission:** `FEATURES.ADMIN_ORGANIZATIONS` (`src/lib/permissions.ts:20`), reused. `src/lib/permissions.ts` stays untouched — no new `FEATURES.*` key, no exception to the freeze.
- **Default role bindings (platform side):** unchanged — `admin` (wildcard) plus anyone already holding `ADMIN_ORGANIZATIONS`, the same set that reaches every other action on this page.
- **Tenant side — new `app_roles` key, org-owned, not a `FEATURES.*` entry:** `founding_administrator` (name "Founding Administrator"), `role_kind: 'custom'`, `is_protected: false`. Minted inline per org inside the transaction, never seeded as a template (DECISION-155). No new `permissions` catalog row — every key the bundle carries already exists (verified against the live catalog in Phase 2).
- **Feature flag:** not needed. Onboarding plumbing, not a member-visible rollout (Phase 1, Phase 2 agree).
- **`FoundingAdministratorPlan` (the bundle, DECISION-155, F111):**

  | Key | Scope | Why |
  |---|---|---|
  | `people.manage` | all types | nothing can happen without a person |
  | `roles.manage` | all types | define/adopt roles |
  | `role_grants.manage` | all types | assign them — without it Phase 1's Flow 3 dead-ends |
  | `groups.manage` | all types | DECISION-110: no office is the keeper, so no template ever carries it |
  | `officers.manage` | all types | seats Session/diaconate, which is what makes group-arm grants resolve (F3) |
  | `org_features.manage` | all types | per-org feature toggles default OFF (`src/lib/org-features.ts:167`) |
  | `tickets.file` | all types | Extensibility Goes Through Support — an org that can't file a ticket can't ask for anything |
  | `congregation_oversight.manage` | presbytery only | template-less by DECISION-119; the wave-5 oversight surface needs it |

  Plus the office half, copied at write time from the live template row so `drizzle/0037`/`0052` stay the single source: `presbytery` → `presbytery_stated_clerk`; `congregation` → `congregation_stated_clerk`; `synod`/`general_assembly`/`new_worshiping_community` → none (the act still succeeds with the administration half alone — an `ok`-variant field, not a failure).

## API Contract

### `src/lib/founding-administrator.ts` (new)

Sibling to `org-provisioning.ts`, not folded into it — a distinct act, its own gate, its own audit key, its own result union. `getPlatformDb()` posture throughout; **never** `withOrgContext()` (Phase 2 Ruling 1: the precondition of this act is that no active membership exists to verify). Header comment records that connection choice and the two documented divergences from `createPerson()` (Ruling 1: `.returning()` instead of a client-generated id; the cross-org pre-check is legal on this connection).

```ts
export type FoundingAdministratorPlan = {
  administration: {
    key: "founding_administrator";
    name: "Founding Administrator";
    permissionKeys: string[]; // enumerated tier-1 set, +congregation_oversight.manage for presbytery
  };
  officeTemplateKey:
    | "presbytery_stated_clerk"
    | "congregation_stated_clerk"
    | null;
};

/**
 * The direct sibling of org-provisioning.ts's baselineRoleSeedPlan() /
 * groupSeedPlan() — same file-local, inline-conditional shape (DECISION-100's
 * precedent), same reason: this is a fixed, code-reviewed bundle, not a
 * tenant-configurable one. Exported (unlike its siblings) because it is also
 * the shape a future "preview what this grants" admin affordance and the
 * implementer's unit tests read directly, without re-deriving the plan from
 * the transaction's own side effects.
 */
export function foundingAdministratorPlan(
  organizationType: OrganizationType,
): FoundingAdministratorPlan {
  const base = [
    "people.manage",
    "roles.manage",
    "role_grants.manage",
    "groups.manage",
    "officers.manage",
    "org_features.manage",
    "tickets.file",
  ];
  return {
    administration: {
      key: "founding_administrator",
      name: "Founding Administrator",
      permissionKeys:
        organizationType === "presbytery"
          ? [...base, "congregation_oversight.manage"]
          : base,
    },
    officeTemplateKey:
      organizationType === "presbytery"
        ? "presbytery_stated_clerk"
        : organizationType === "congregation"
          ? "congregation_stated_clerk"
          : null,
  };
}

export type FoundingAdministratorResult =
  | {
      kind: "ok";
      mode: "created_person" | "existing_person";
      personId: string;
      userId: string;
      administrationRoleId: string;
      administrationRoleKey: "founding_administrator";
      officeRoleId: string | null;
      officeRoleKey: string | null;
      permissionKeys: string[]; // union of both halves, for audit metadata
      priorHolderCount: 0; // always 0 — the gate already proved it
    }
  | { kind: "no_such_user" }
  | { kind: "user_inactive" }
  | { kind: "person_elsewhere" }
  | { kind: "membership_ended"; endedOn: string }
  | { kind: "has_holders"; holderCount: number }
  | { kind: "provisioning_incomplete" }
  | { kind: "race" }
  | { kind: "db_error" };

export async function designateFoundingAdministrator(
  organizationId: string,
  email: string,
  operatorUserId: string,
): Promise<FoundingAdministratorResult>;
```

**Deliberate signature divergence from the task framing:** `organizationType` is *not* a parameter of `designateFoundingAdministrator()`. It is read fresh, inside the transaction, off the same `select … for update` row that serializes the gate (`organizations.organizationType`) — never trusted from an earlier render or a caller-supplied value, the same discipline `resolveOrganizationType()` (`src/lib/role-definitions.ts:233-243`) already applies. `foundingAdministratorPlan()` itself keeps `organizationType` as a plain parameter — that keeps it unit-testable without a transaction — but the orchestrating function computes it internally and calls the plan function with the row it just locked. One source of truth for "what type is this org," never two.

**Transaction — exact statement order (binding, Phase 2 Ruling 1/5):**

1. `select id, organization_type from organizations where id = $1 for update` — the serialization point. No `role_grants` rows exist to lock when the count is zero, so the `organizations` row is the phantom-read fix (Ruling 5). Row missing → this is a programmer error (the caller already resolved the org to render the page); throw, don't return a typed result.
2. **Holder-count CTE** — a parallel implementation of `wouldZeroOutRolesManageHolders` (`src/lib/role-definitions.ts:171-203`), keyed on `permission_key in ('roles.manage','role_grants.manage')`, **no** `excludeRoleId` (there is nothing to exclude — this is "does anyone at all currently hold either"), run on `platformDb`, person arm plus group arm expanded through live `group_memberships`. Comment points at that helper by `file:line`, per Ruling 5. `count > 0` → `{ kind: "has_holders", holderCount: count }`, transaction rolls back (nothing written).
3. **User lookup:** `select id, is_active from users where email = $1 limit 1` (`email` pre-normalized `.trim().toLowerCase()` by the action, matching `src/auth.ts:106`'s own convention). No row → `no_such_user`. `is_active = false` → `user_inactive`.
4. **Person lookup, across the whole database** (legal on this connection, Ruling 1 divergence 2): `select p.id as person_id, m.organization_id, m.ended_on from people p left join memberships m on m.person_id = p.id where p.user_id = $userId and p.merged_into_id is null`. Classify:
   - Zero `people` rows → **mode `created_person`.**
   - One `people` row, a membership row exists with `organization_id = $organizationId` and `ended_on is null` → **mode `existing_person`**, skip the `people`/`memberships` inserts entirely.
   - One `people` row, a membership row exists with `organization_id = $organizationId` and `ended_on is not null` → `{ kind: "membership_ended", endedOn }` (pre-check message; the authoritative refusal is `role_grants_needs_membership` if this pre-check is ever wrong, see below).
   - One `people` row, every membership row's `organization_id` differs from `$organizationId` → `{ kind: "person_elsewhere" }` (pre-check message; the authoritative refusal is `memberships_guard_insert`, F108).
   - One `people` row, **zero** membership rows anywhere — unreachable today (`createPerson()` and this function are the only two writers of a `people`+`memberships` pair, and both are atomic), handled defensively as **mode `existing_person`** rather than crashing, but not a primary path this pipeline tests against a live trigger (noted in Tests Owed).
5. **`people` insert** (mode `created_person` only): `.returning({ id: people.id })` — **not** `createPerson()`'s client-generated `randomUUID()` (Ruling 1 divergence 1: `neondb_owner` bypasses the RETURNING-side SELECT policy that trick exists for). Columns: `firstName`, `lastName` (from `users.name` split on the last space, email local-part fallback — Ruling 6/orchestrator ruling on naming), `userId`. No `contact_methods`, no `person_identifiers` row (Ruling 6 — an operator-typed email is not verified evidence).
6. **`memberships` insert** (modes `created_person` and the defensive zero-membership branch only — `existing_person`'s normal case skips this step): `engagementStatus: "staff"`, `currentRoll: null`, `householdId: null`. **No `roll_actions` row** (DECISION-128/129).
7. **`app_roles` — administration role, reuse-and-reactivate (F109):** `select id, deactivated_at from app_roles where organization_id = $organizationId and key = 'founding_administrator'`. Found → reuse `id`; if `deactivated_at is not null`, `update app_roles set deactivated_at = null where id = $id`. Not found → insert `{ organizationId, key: 'founding_administrator', name: 'Founding Administrator', roleKind: 'custom', isProtected: false }`.
8. **`app_roles` — office role**, only when `officeTemplateKey !== null`: read the live template row (`organizationId IS NULL`, `organizationTypeScope = $organizationType`, `key = officeTemplateKey`) and its `appRolePermissions`, matching `adoptTemplate()`'s own read (`src/lib/role-definitions.ts:85-108`). Then the same reuse-and-reactivate lookup as step 7, keyed on `(organizationId, key: officeTemplateKey)` — same row regardless of whether it was this pipeline or a later manual "adopt template" that created it, because `app_roles_org_key` is unique on `(organizationId, key)`. Insert new `{ organizationId, key: officeTemplateKey, name: template.name, roleKind: 'custom', isProtected: false }` if absent.
9. **`app_role_permissions` — additive-only reconcile:** for each role, `insert into app_role_permissions (role_id, permission_key) values (...) on conflict (role_id, permission_key) do nothing` for every key in that role's plan (administration keys for the administration role; the just-read template's keys for the office role). **Tech-lead ruling, not in Phase 2's text:** reconcile is additive-only, never subtractive. A recovery designation must restore at least the bundle's floor; it must not claw back a permission the org's own `roles.manage` holder deliberately added to either role after the first designation. (No new `DECISION-1xx` number is claimed here — this pipeline was pre-assigned only DECISION-155; the orchestrator may fold this ruling under it at integration, or assign the next sequential number, at its discretion.)
10. **`role_grants` insert(s)**, one per role from steps 7–8, person-arm (`personId`, never `groupId`), `grantedBy: operatorUserId` (provenance only — no resolver arm reads it, Phase 2's Invariants table), `grantReason: "founding administrator designation"`. `startsOn` left to its `defaultNow()`.
11. Return `{ kind: "ok", mode, personId, userId, administrationRoleId, administrationRoleKey: "founding_administrator", officeRoleId, officeRoleKey, permissionKeys: [...administration.permissionKeys, ...officePermissionKeys], priorHolderCount: 0 }`.

**Error catches, applied in this order, all via `errorMessageChain()` (copied into this module — `src/lib/people.ts:29-34`'s own shape; not imported, since `people.ts` is `withOrgContext()`-only and this module deliberately does not depend on it for a platform-connection helper):**

| Catch | Match | Maps to | SQLSTATE (context) |
|---|---|---|---|
| `memberships_guard_insert` | `/already exists elsewhere/` | `person_elsewhere` | `insufficient_privilege` (42501) — `presby_guard_membership_insert()`, `drizzle/0009_presby_rls.sql:164-182`. Same regex `src/lib/people.ts:447` already uses. |
| `role_grants_needs_membership` | `/cannot open a position at an organization where the membership ended on/` | `membership_ended` | `check_violation` (23514) — `presby_guard_position_needs_membership()`, `drizzle/0014_presby_org_router.sql:198-219`. The date is re-derived from the pre-check read, not parsed out of the message. |
| sync-trigger FK | `/has no derived group active_membership/` | `provisioning_incomplete` | `foreign_key_violation` (23503) — `presby_sync_derived_membership_group()`, `drizzle/0017_presby_membership_roster.sql:76-89`. Reachable only on the retrofit branch, for an org predating the F16 seed. |
| unique violation | `isUniqueViolation(err)` (`src/lib/db/errors.ts:28-46`, reused, not re-implemented) | `race` | `unique_violation` (23505) on `app_roles_org_key` — the `for update` lock should already serialize this for one org; this is the TOCTOU backstop, same posture as `createOrganization()`'s `slug_taken` catch. |
| anything else | — | `db_error` | Logged via `console.error` (matching `recordAudit()`'s own swallow-and-log posture) and returned typed, **not rethrown**. Deliberate, named divergence from `org-provisioning.ts`'s "unknown errors rethrow" convention: every sibling action on this page returns a `PolicyResult`, never lets an exception reach the client, and an admin who just typed an email will retry immediately — a typed "we couldn't complete that" beats an uncaught 500 for this specific, frequently-repeated admin operation. |

### Server action — `designateFoundingAdministratorAction` (appended to `src/app/(admin)/admin/organizations/[id]/actions.ts`)

Exact structural match to `setOrganizationBrandAction`/`setOrganizationProfileAction` in the same file (`auth()` → `hasFeature` → field validation → call the lib function → `recordAudit` → `revalidatePath` → return `PolicyResult`):

```ts
export type PolicyResult = { ok: true } | { ok: false; error: string }; // already exported, reused

export async function designateFoundingAdministratorAction(
  formData: FormData,
): Promise<PolicyResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  if (!UUID_RE.test(organizationId)) {
    return { ok: false, error: "Invalid organization." };
  }

  // zod: z.string().trim().toLowerCase().email().max(320)
  const parsed = designeeEmailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const result = await designateFoundingAdministrator(
    organizationId,
    parsed.data,
    session.user.id,
  );

  switch (result.kind) {
    case "no_such_user":
      return {
        ok: false,
        error:
          "No platform account exists for that email yet. Ask them to sign up first (they'll land on a page saying they have no organizations), then designate them here.",
      };
    case "user_inactive":
      return { ok: false, error: "That account has been deactivated." };
    case "person_elsewhere":
      return {
        ok: false,
        error:
          "That account is already linked to a person at a different organization. Cross-organization transfers go through the certificate/transfer process, not this designation.",
      };
    case "membership_ended":
      return {
        ok: false,
        error: `That person's relationship with this organization ended on ${result.endedOn}.`,
      };
    case "has_holders":
      return {
        ok: false,
        error:
          "This organization already has someone who can manage roles — designation is only available while nobody does (including as a lockout recovery).",
      };
    case "provisioning_incomplete":
      return {
        ok: false,
        error:
          "This organization is missing its baseline setup — contact an engineer before designating an administrator.",
      };
    case "race":
      return {
        ok: false,
        error: "Someone just designated a founding administrator for this organization — refresh the page.",
      };
    case "db_error":
      return {
        ok: false,
        error: "We couldn't complete that just now — try again in a moment.",
      };
    case "ok":
      await recordAudit({
        action: AUDIT_ACTIONS.ORG_FOUNDING_ADMINISTRATOR_DESIGNATED,
        resourceType: "organization",
        resourceId: organizationId,
        metadata: {
          organizationId,
          personId: result.personId,
          userId: result.userId,
          mode: result.mode,
          officeRoleKey: result.officeRoleKey,
          administrationRoleKey: result.administrationRoleKey,
          permissionKeys: result.permissionKeys,
          priorHolderCount: result.priorHolderCount,
        },
      });
      revalidatePath(`/admin/organizations/${organizationId}`);
      return { ok: true };
  }
}
```

A **refused** designation writes no audit row (Ruling 8 — Workflow Rule 7 audits mutations; a refusal mutates nothing). `email` is never logged in metadata — ids only, matching Ruling 8.

**Create-form redirect — no change needed.** `createOrganizationAction`'s client component already `router.push()`es to `/admin/organizations/<id>` on success (`src/app/(admin)/admin/organizations/new/create-organization-form.tsx:43-51`, confirmed read). The orchestrator's binding item 1 ("the control lives on `[id]` only — the create action redirects there") is **already true today**; this pipeline adds nothing to the create path. `createOrganization()`'s transaction is untouched.

## Data Model

**`drizzle/0054_presby_founding_administrator.sql` (new) — one partial unique index, nothing else:**

```sql
-- 0054: founding-administrator — the first in-app writer of people.user_id.
-- F110: "One human, one login" (people.user_id's own column comment) was
-- paper by accident until now (fixture-only writes). This pipeline makes it
-- a production write path, so it becomes paper by decision unless enforced.
-- userOrganizations() (src/lib/authz.ts:341-352) already de-duplicates in
-- TypeScript for exactly the duplicate this index forbids.
create unique index if not exists people_user_id_unique_idx
  on people (user_id)
  where user_id is not null and merged_into_id is null;

comment on index people_user_id_unique_idx is
  'One human, one login (F110). Excludes merged_into_id is not null so the '
  'merge chain keeps working: a tombstoned loser keeps its old user_id, the '
  'winner keeps its own.';
```

**Pre-flight duplicate probe (database-admin runs this against `development`, not just the pipeline branch, before writing the migration — Phase 2 Ruling 9):**

```sql
select user_id, count(*) from people
 where user_id is not null and merged_into_id is null
 group by 1 having count(*) > 1;
```

If `development` is clean (expected — the three `set user_id` fixtures in `scripts/seed-dev.sql` are distinct, confirmed by reading them), the migration ships as designed. If it returns rows, **name it and stop**: ship this pipeline with the TypeScript check alone (rely on the pre-check query at step 4 plus the trigger refusals), and open a separate follow-up to clean the duplicates before the index can land. Do not silently drop the migration from the pipeline without recording why.

**`src/lib/db/domain/people.ts` — matching Drizzle model, same file, same commit as the migration:**

```ts
uniqueIndex("people_user_id_unique_idx")
  .on(t.userId)
  .where(sql`user_id is not null and merged_into_id is null`),
```

Added to `people`'s `(t) => [...]` array (`src/lib/db/domain/people.ts:120-123`), alongside the existing non-unique `people_user_idx` — **do not remove `people_user_idx`**; it still serves plain lookups where the partial predicate doesn't apply (a merged row's `user_id` is still read by name in places). `uniqueIndex` and `sql` are already imported in this file (used by `memberships_one_active_roll_idx`, `src/lib/db/domain/people.ts:290-292`) — no new import.

**Parity expectations:** `npm run check:schema-parity` must pass on a fresh database after `npm run db:migrate` (51/51 → 52/52), and the `docs/testing.md` from-empty recipe is rehearsed locally by database-admin (CI `db-tests` still skips per the kickoff). No other schema change — no new table, no new column, no new function, no new trigger, no new grant, no new policy.

## Component / Page Plan

**`page.tsx` (modify, `src/app/(admin)/admin/organizations/[id]/page.tsx`)** — Server Component, unchanged shape (`auth()` → `hasFeature` gate → `notFound()` on a bad id → reads). Add, alongside the existing `org`/`brand`/`profileDetail` reads:

```ts
const holderCount = await countFoundingAdministratorHolders(platformDb, id);
// exported from src/lib/founding-administrator.ts — the SAME CTE the
// transaction's own gate runs, read-only, outside a transaction, for display
// only. Read fresh on every render (never cached), per Ruling 5/role-
// definitions.ts:120-124's own "never trusted from an earlier render" rule.
```

Passed to the new section as:

```tsx
<FoundingAdministratorSection
  organizationId={id}
  organizationType={org.organizationType}
  canDesignate={holderCount === 0}
  currentHolderCount={holderCount}
  officeTemplateName={
    foundingAdministratorPlan(org.organizationType).officeTemplateKey
      ? OFFICE_TEMPLATE_DISPLAY_NAMES[
          foundingAdministratorPlan(org.organizationType).officeTemplateKey!
        ]
      : null
  }
/>
```

Rendered **first and prominently**, above the existing "Current brand" section, while `canDesignate` is true — per the orchestrator's placement ruling ("the designation section renders first and prominently while the org has zero holders"). Once `canDesignate` is false, it collapses to a small read-only "Founding administrator: designated" line (no need to name the person — a platform operator does not need PII here, and naming them would be a second, unaudited disclosure surface) rather than disappearing entirely, so the gate is legible per Phase 1's G6 recommendation ("Views/confirms who currently holds founding-administrator-equivalent permissions").

**`founding-administrator-section.tsx` (new)** — `'use client'`, exact structural match to `neutralize-dialog.tsx` (confirm) crossed with `profile-form.tsx` (single-field form with `useActionState`):

```tsx
"use client";

interface FoundingAdministratorSectionProps {
  organizationId: string;
  organizationType: OrganizationType;
  canDesignate: boolean;
  currentHolderCount: number;
  officeTemplateName: string | null;
}

export function FoundingAdministratorSection({ ... }: FoundingAdministratorSectionProps) {
  const [email, setEmail] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, formAction, isPending] = useActionState(submit, null as PolicyResult | null);
  // ...
}
```

- **Single email `Input`**, no person picker (Phase 2 Ruling 4 — the database chooses the branch, the operator supplies one thing).
- **`AlertDialog` confirm**, triggered on submit intent rather than the raw `<form action>` firing immediately — the email is captured in local state, the dialog's `AlertDialogAction` calls the action with a hand-built `FormData` (mirroring `neutralize-dialog.tsx:36-51`'s `handleConfirm` shape), because this act originates access and must not be a bare submit (Phase 2, Workflow Rule 2). The dialog copy **names the exact permissions being granted** (per the task's own requirement) rather than a generic "Are you sure?":

  > **Designate `{email}` as {organizationName}'s founding administrator?**
  > They will be able to manage people, roles, role assignments, groups, officers, feature toggles, and support tickets{organizationType === "presbytery" ? ", and congregation oversight" : ""}{officeTemplateName ? `, plus the ${officeTemplateName} office (${officeTemplatePermissionSummary})` : ""}. This can only be done once — the organization's own administrators grant everyone after this through the ordinary Roles page.

- **A "sign up first, then designate" hint**, always visible under the input (not just on `no_such_user` error) per the task's requirement — matches the orchestrator's G4 ruling's two-step flow: *"Don't have their account yet? They sign up first — they'll land on a page saying they have no organizations — then you designate them here by the same email."*
- **Pending/error states**: inline banner (never toast-only), exact pattern from `profile-form.tsx:77-88`.
- **When `!canDesignate`:** render the collapsed read-only state described above instead of the form.
- No hand-rolled class strings (reuses `Button`, `Input`, `Label`, `AlertDialog*` from `src/components/ui/`). No new shadcn primitive needed.

## Seed Fixture (`scripts/seed-dev.sql`, appended block — database-admin, Batch A)

One new, sign-in-capable user with **no `people` row anywhere** — none of the three existing `set user_id` fixtures qualify (all already linked), and the primary rehearsal branch (`created_person`) needs one. Next free `f`-suffix id per the existing `e0000000-…-0000000f{2,3,4}` sequence is `f5` (confirmed unused in both `scripts/seed-dev.sql` and `scripts/test-rls.sql`):

```sql
-- ---------------------------------------------------------------------------
-- 2026-09-28: founding-administrator pipeline — a sign-in-capable platform
-- user with NO people row anywhere. Every existing `set user_id` fixture
-- (elder.fixture/f2, clerk.fixture/f3, presbytery.clerk.fixture/f4) is
-- already linked to a person, so none of them can exercise the
-- created_person branch this feature is primarily for — designating one of
-- them would always resolve to existing_person instead. Same reserved
-- .invalid domain, same shared fixture password (docs/testing.md), is_active
-- so it can sign in, two_factor_required false for the same no-TOTP-detour
-- reasoning as clerk.fixture/elder.fixture/presbytery.clerk.fixture above.
-- Deliberately NOT linked to any people row here or anywhere else in this
-- file — a browser rehearsal or a DB-backed test designates THIS user and
-- observes a real `people` row get created and linked, live.
-- ---------------------------------------------------------------------------
insert into users (id, email, name, email_verified, password, is_active, two_factor_required)
values ('e0000000-0000-0000-0000-0000000000f5', 'founding.fixture@example.invalid',
        'Founding Fixture', now(),
        '$2b$10$tHdp7RHkvStQGKE5A/BRTenWeJ/HUOeY3iA/MmCGXE2fUCS9wBzT2',
        true, false)
on conflict (id) do nothing;
```

Appended at the end of the file, directly ahead of the final `commit;`, same seam every recent pipeline's fixture block has landed at — per Workflow Rule 16's shared-file discipline. Add one row to `docs/testing.md`'s Accounts table alongside `clerk.fixture`/`elder.fixture` describing it as "no organization yet — designate as a founding administrator to exercise the create-person branch," which database-admin does in the same commit (a doc, not one of the orchestrator-only shared files).

## `scripts/test-rls.sql` §44 (database-admin, Batch A)

Per Phase 2 Ruling 9(i)–(iv), asserting the **tenant-side truth of what the platform wrote** (the write path itself is `getPlatformDb()` and has no RLS to exercise) — run as `presby_app` with the designee's org context set, using the section 35/40/41 idiom (`assert_eq`, named `raise notice 'pass ...'`/`raise exception 'FAIL ...'`, `begin;…rollback;` where nothing durable should survive):

1. **(i)** `presby_has_permission(<designee>, <org>, 'roles.manage')` returns `true` for a person the founding-administrator act actually granted it to (fixture-minted via direct SQL in this section, matching the shape `scripts/seed-dev.sql:1228-1240` already uses for the presbytery adopted-copy — §44 does not call `designateFoundingAdministrator()` itself, since that is a TypeScript/`neondb_owner` function outside this suite's reach, same "what this suite can and cannot prove" boundary section 41 states for `presby_withdraw_publication()`; the DB-backed test in `founding-administrator.test.ts` is what proves the TypeScript path end-to-end, §44 proves the tenant-side shape the write leaves behind).
2. **(ii)** A person at a **different** organization (e.g. `:BRAMBLE`) queries `presby_effective_permissions()`/`presby_has_permission()` for the designee's role and sees **none of it** — the composite tenant-key shape holding regardless of who minted the role.
3. **(iii)** `presby_app` still cannot insert an `app_roles` row whose `organization_id` differs from `presby_current_org()` — the ordinary RLS `WITH CHECK` already enforces this; §44 pins it explicitly for this new role key so a future refactor of `app_roles`'s policy is caught here too, not only by an unrelated section.
4. **(iv)** The new `people_user_id_unique_idx` (0054) rejects a second live `people` row sharing a `user_id` — insert two rows with the same `user_id` and `merged_into_id is null`, expect a unique-violation; then confirm a third row with the same `user_id` but `merged_into_id` set (tombstoned) is accepted, proving the merge chain still works (Phase 2's own point about the partial predicate).

**WHAT THIS SUITE CAN AND CANNOT PROVE** (section 34/35's own idiom, written into the section header): it proves the *shape* the write leaves behind is correctly tenant-isolated; it does **not** exercise `designateFoundingAdministrator()` itself, the holder-count gate, or the trigger-driven refusals (`person_elsewhere`/`membership_ended`/`provisioning_incomplete`) — those are `neondb_owner`-connection behaviors and belong in `src/lib/founding-administrator.test.ts` on `PLATFORM_DATABASE_URL`, the same split section 41 already documents for `presby_withdraw_publication()`.

## Tests Owed by the Implementers

**Batch B (api-developer), DB-backed, `src/lib/founding-administrator.test.ts` on `PLATFORM_DATABASE_URL`, `--no-file-parallelism`:**

- Every result variant against the **live triggers** on the branch database (not mocked): `ok` (`created_person` and `existing_person` modes, presbytery and congregation and one template-less type), `no_such_user`, `user_inactive`, `has_holders` (seed a holder first), `provisioning_incomplete` (an org with its `active_membership` group deliberately removed, or a hand-built org missing it), `db_error` (a genuinely unexpected failure path — e.g. a malformed input the action layer should have already caught, used only to prove the catch-all doesn't accidentally match a named case).
- **Failing-first, then passing**, named explicitly for: `person_elsewhere`, `membership_ended`, `has_holders`, `race`. Each test asserts the refusal *and* that nothing was written (a follow-up read confirms no new `people`/`app_roles`/`role_grants` row exists for `person_elsewhere`/`membership_ended`/`has_holders`; for `race`, the second of two concurrent calls sees `has_holders` or `race` and the org ends with exactly one `founding_administrator` role row, not two).
- **The 0054 index**, asserted directly: two inserts with the same `user_id` (not through the production function) collide; a `merged_into_id`-set third does not.
- **Recovery (F109):** designate → revoke the grant (via `role-grants.ts`'s `revokeRole()` or a direct `ends_on` update) → designate again → assert the *same* `app_roles.id` for `founding_administrator` is reused (not a second row), `deactivated_at` is null, and `app_role_permissions` still carries every plan key.
- **Cleanup (Ruling 10):** `people_guard_delete` fires for `neondb_owner` too. Every test reads back `personId`, runs `update people set deletable_until = fixtureDeletableUntil() where id = $personId` on the platform connection, then deletes — **never** a fixture-only parameter added to the production function.
- **The "four files unchanged" assertion (Phase 2 Two Hierarchies mechanical test):** a `git diff --name-only` check (or a CI-friendly Vitest that shells out to `git diff` against the merge-base) confirming `src/lib/authz.ts`, `src/lib/role-definitions.ts`, `src/lib/role-grants.ts` and `drizzle/0010_presby_resolver.sql` are byte-identical to `main`. Written as a **test**, not left to QA's manual read — cheap, mechanical, and the exact thing a careless future edit to this pipeline's own branch could violate without anyone noticing.

**Batch B, action tests (`src/app/(admin)/admin/organizations/[id]/actions.test.ts`, extended — file already exists per this directory's convention, confirm and extend rather than create):** auth/feature-gate rejection, zod email validation, the full result→copy switch (every branch above reachable through the action, not just the lib function), `recordAudit` called exactly once and only on `ok`, `revalidatePath` called.

**Batch C, component tests (`founding-administrator-section.test.tsx`):** form renders the hint unconditionally; `AlertDialog` copy names the actual permission list (parameterized by `organizationType`/`officeTemplateName`, not a hardcoded string); collapses to the read-only line when `canDesignate` is false; pending/error states.

## Browser Rehearsal (Phase 2 Ruling 10 — mandatory, Phase 5 PASS condition)

Port `3400`. Stop by PID, never `pkill -f`.

1. Create a fresh org through `/admin/organizations/new`.
2. Designate `founding.fixture@example.invalid` (the new no-person seed fixture) at `/admin/organizations/<id>`.
3. Sign out; sign in as `founding.fixture@example.invalid` (shared fixture password, `docs/testing.md`).
4. `/launch` routes to `/o/<slug>` — single enterable org.
5. **Pre-flight, before clicking:** confirm the `org_portal.roles` feature-flag row is `enabled = true` on this Neon branch (`/admin/flags`) — `scripts/seed.ts` seeds it **`false`** by default (`scripts/seed.ts:165-177`), and this pipeline does not flip it in code (a global flag flip is not this pipeline's to make — it is an operator/release act, and hard-coding a flag flip into a migration or seed script would be exactly the "flag substitutes for a permission" confusion DECISION-003 forbids). Then reach `/o/<slug>/admin/roles` **by clicking, not by typing the URL** (`roles` is `category: "administer"`, DECISION-105) — confirms the nav path exists for a brand-new org.
6. **Grant a role to a second person** — non-negotiable: the only step proving the bundle is self-sufficient, invisible to unit tests. Adopt the office template first if the organization type has one and the bundle didn't already include it as a *usable* grant (it did — the office role is granted directly, not merely adoptable — so this step exercises granting the `founding_administrator` role itself, or the office role, to a second seeded person).
7. Return to `/admin/organizations/<id>` and confirm a second designation attempt is refused (`has_holders` copy).
8. **360px viewport** on the admin form (Phase 1 G12) — both the collapsed and expanded states of the section.

Recorded with screenshots in Phase 4 (implementer notes) and repeated by QA in Phase 5 (orchestrator's binding item 2) — Playwright coverage of the full handoff is an explicit follow-up for the presbytery-e2e pipeline, not built here.

## Implementation Order — three batches, three implementers

**Batch A — database-admin:**
1. Run the pre-flight duplicate probe against `development`.
2. `drizzle/0054_presby_founding_administrator.sql` (index + comment).
3. `src/lib/db/domain/people.ts` — matching `uniqueIndex(...).where(...)`.
4. `npm run check:schema-parity` on a fresh database; rehearse the `docs/testing.md` from-empty recipe.
5. `scripts/test-rls.sql` §44.
6. `scripts/seed-dev.sql` — the `founding.fixture@example.invalid` block; one row added to `docs/testing.md`'s Accounts table.
7. **From-empty rehearsal**: confirm a fresh `db:migrate` + `db:seed` + `seed-dev.sql` database passes `check:schema-parity` and §44 cleanly, with the new fixture present.

*Hands to Batch B:* the index exists and is modeled in Drizzle; the fixture user exists in seed-dev.sql; §44 passes on the merged shape.

**Batch B — api-developer:**
1. `src/lib/founding-administrator.ts` — `foundingAdministratorPlan()`, `designateFoundingAdministrator()`, `countFoundingAdministratorHolders()` (the read-only gate query `page.tsx` also calls), the result union, the header comment.
2. `src/lib/founding-administrator.test.ts` — the full DB-backed matrix above, failing-first for the named refusals.
3. `src/lib/audit.ts` — `ORG_FOUNDING_ADMINISTRATOR_DESIGNATED: "org.founding_administrator.designated"`, one clearly delimited addition, alongside `ORG_CREATED`/`ORG_BRAND_SET`.
4. `src/app/(admin)/admin/organizations/[id]/actions.ts` — `designateFoundingAdministratorAction`, the zod email schema, `recordAudit` call, `revalidatePath`.
5. `actions.test.ts` extension.
6. The "four files unchanged" mechanical test.

*Hands to Batch C:* `designateFoundingAdministratorAction`'s signature and every `PolicyResult` copy string are final; `countFoundingAdministratorHolders()`'s signature is final for `page.tsx` to call.

**Batch C — ux-developer:**
1. `page.tsx` — the `countFoundingAdministratorHolders()` read, `foundingAdministratorPlan()` read for `officeTemplateName`, props wiring, placement (first, prominent, while `canDesignate`).
2. `founding-administrator-section.tsx` — form, `AlertDialog`, hint copy, collapsed state.
3. `founding-administrator-section.test.tsx`.
4. The browser rehearsal (all 8 steps), screenshots into the Phase 4 write-up.

## Edge Cases & Risks

- **Designating a platform admin themselves.** No special-casing — `is_platform_admin` is orthogonal to tenant membership (Two Hierarchies). A platform admin who is also a real person at a congregation goes through the identical `existing_person`/`created_person` branches as anyone else.
- **An org of type `synod`/`general_assembly`/`new_worshiping_community`.** No office template — the act still succeeds with the administration half alone (`officeRoleId: null`). The confirm-dialog copy and the collapsed-state copy must not reference an office that doesn't exist for these types (`officeTemplateName` is `null`, the sentence fragment referencing it is conditionally omitted).
- **An org predating the F16 group seed.** `memberships_sync_derived_group` raises `foreign_key_violation` → `provisioning_incomplete`. This is a deploy-time/data-integrity signal, not a user input error — the copy says so and points at an engineer, matching `createOrganization()`'s own `provisioning_incomplete` copy (`new/actions.ts:181-186`).
- **The user already a member elsewhere.** `person_elsewhere` (F108), refused by the database (`memberships_guard_insert`), not merely by the pre-check — even if the pre-check query is ever wrong (multiple memberships, a race), the trigger is authoritative.
- **Re-designation after lockout.** The gate condition and the recovery condition are the same sentence (Ruling 5) — `has_holders` blocks while any `roles.manage`/`role_grants.manage` holder is currently effective, and the same query returning zero re-enables it. F109's reuse-and-reactivate keeps this idempotent against `app_roles_org_key`.
- **Concurrent designations for the same org.** Serialized by the `for update` lock on `organizations`; the second transaction sees the first's committed holder count and returns `has_holders`. `race` is the TOCTOU backstop for the narrow window this lock doesn't cover (e.g., a retry racing a nearly-simultaneous first commit before the lock is acquired).
- **`people_guard_delete` and test cleanup.** SECURITY DEFINER, fires for `neondb_owner` too — a test cannot delete a person this function created without first stamping `deletableUntil`. No fixture-only parameter is added to `designateFoundingAdministrator()` to work around this (Ruling 10) — the test does the stamp-then-delete dance itself, the same pattern `src/lib/people.test.ts` already uses for `createPerson()`'s own rows.
- **The zero-membership defensive branch (step 4's last bullet).** Unreachable through any code path this codebase currently ships; handled without crashing, but not asserted against a live trigger in Batch B's primary matrix — a defensive branch, named as such, not a silent gap.
- **`org_portal.roles` seeded off.** Not a code bug this pipeline introduces or fixes — the flag must be verified/flipped on the pipeline branch and (separately, at release) for any real organization before this feature is reachable end-to-end. Named explicitly in the rehearsal's step 5 pre-flight so it is not mistaken for a broken nav path.
- **Mobile (360px).** The admin form and both section states (Phase 1 G12) — no reason to expect special difficulty (an internal `(admin)` surface, platform palette, standard form controls), confirmed by rehearsal step 8.

## E2E / Existing-Spec Blast Radius

No `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, or `src/lib/auth/` files are touched, so the mandatory MFA-e2e smoke gate does not fire. Existing Playwright specs that assert behavior on the surfaces this pipeline touches:

- Any e2e spec walking `/admin/organizations/[id]` (organization detail page rendering, brand form, profile form, service-times, site section) — this pipeline adds a **new** section above the existing ones; a spec asserting a fixed DOM order, a fixed heading sequence, or a snapshot of the page's full content could break from the insertion alone, independent of any logic change. QA must re-run these against the new page shape, not just add a new spec.
- Any e2e spec walking org creation end-to-end (`/admin/organizations/new` → redirect) — unaffected in behavior (confirmed no change to that action), but a spec that asserts what the destination page looks like immediately after creation will now see the new, prominent founding-administrator section as the first thing rendered — a likely **acceptable, expected** diff, but one QA should look for by name rather than let a snapshot silently re-baseline.
- No existing spec exercises `/o/<slug>/admin/roles`'s *reachability from a brand-new org* (that state has never existed in a walkable form before this pipeline), so there is no existing coverage to break there — only new coverage to add (the deferred Playwright follow-up named above).

## Out of Scope (confirmed, Phase 1/2/orchestrator)

- Flow 2 — inviting a person with no account (an invitation-token/email-queue/signup-linking system). Two-step workaround only: self-register, then designate by email.
- `/admin/organizations/new`'s `parentOrganizationId`/`relationshipType` UI control — the sibling `2026-09-28-organization-parent-picker` pipeline.
- `presby_organize_congregation()`, the trust-property tripwire, committees.
- A tenant-facing "why do I have this role" explainer for the founding administrator.
- Raising an organization's permission ceiling beyond the bundle (F111) — its own future pipeline.
- Playwright coverage of the full handoff (the presbytery-e2e pipeline).

## Findings & Decisions Adopted Verbatim

`DECISION-155` (mechanism, bundle, gate, F111) and `F107`–`F111` are adopted as proposed in Phase 2, unchanged. No new `DECISION-1xx` number is claimed by this phase; the additive-only permission-reconcile ruling above is offered as text the orchestrator may fold under DECISION-155 or number separately at integration.

## Housekeeping (Rules 10/14/15) — proposed lines for the orchestrator to apply at integration

- **`docs/TODO.md`:** close the existing line "Template-adoption bootstrap for `congregation_stated_clerk` (`…0004`)" (`docs/TODO.md:120`) — move to Done, dated, citing this work-log, since this pipeline is the resolution it was waiting on. **Open** a new line for F111: *"Permission ceiling (F111): an org's reachable permission set is closed at its first grant; decide how a template's curated set may be adopted and granted without reopening DECISION-068's escalation hole."* **Open** a second line for the deferred invitation system (Flow 2, G4): *"Founding-administrator invitation path for a person with no account yet — token/email-queue/signup-linking, deferred from `2026-09-28-founding-administrator`."* **Open** a third line for the deferred Playwright coverage of the full handoff.
- **`docs/product/functionality-map.md`:** the Index's `presby: authorization` line and the full-map Organizations bullet (`docs/product/functionality-map.md:121`) both gain a clause: organization detail page now includes designating a one-time founding administrator (email → existing platform user only, gated on zero current `roles.manage`/`role_grants.manage` holders, audited `ORG_FOUNDING_ADMINISTRATOR_DESIGNATED`).
- **`docs/architecture.md`:** one clause, likely under an "onboarding" mention if one exists, or a short new sentence near the organization-lifecycle description — not a new subsystem or a changed data flow, so this is a light touch per Rule 15's "stays useful only by staying stable": *"An organization's first real administrator is designated once by a platform operator (`src/lib/founding-administrator.ts`) — a platform-mediated write with no tenant-side authorization check to satisfy, since none can exist yet; every subsequent grant flows through the ordinary tenant role-administration path."*
- **Release note draft heading** (for `/release-notes` at Phase 6): "Feature: Founding administrator designation" — one paragraph on what it unblocks (PSV and every future presbytery/congregation onboarding), one sentence on the one-time/lockout-recovery gate, one sentence naming what is *not* included (invitation for a person with no account yet).

## Implementer

**Multiple, sequential — database-admin (Batch A) → api-developer (Batch B) → ux-developer (Batch C).** Each batch's "hands to" note above is the contract the next batch can build against without re-reading this whole document. No `full-stack-developer` collapse: the schema change is genuinely prerequisite to the lib module (the index changes what a DB-backed test can assert), and the lib module's exact `PolicyResult`/copy surface is genuinely prerequisite to the component — three real handoffs, not artificial ones.

---

# Phase 4 — Implementation

## Batch A — database-admin (2026-09-28)

**Worktree** `/Users/cshenso/git/presby-platform/presby-wt-boot` on `pipeline/founding-admin`.
**Neon branch** `pipeline-founding-admin` — confirmed from the database itself, not from the endpoint string: `select setting from pg_settings where name = 'neon.branch_id'` → `br-empty-frost-ax4mo8q5`. `env | grep DATABASE_URL` was empty before every command (0 matches); every invocation goes through `npx dotenv-cli -e .env.local`. `ALTER ROLE presby_app … PASSWORD` was never run, on any branch. `npm run db:push` was never run.

### HEADLINE: the pre-flight duplicate probe against `development` is NOT clean, so `drizzle/0054` is NOT shipped

Phase 2 Ruling 9 made the migration conditional on a probe against `development` and said, of a non-empty result, "name it, don't assume it." The result is non-empty.

```
$ (cd ../presby && npx dotenv-cli -e .env.local -- psql "$MIGRATE_DATABASE_URL" \
     -c "set default_transaction_read_only = on;" \
     -c "select current_setting('neon.branch_id'), current_user;" \
     -c "select user_id, count(*) from people
          where user_id is not null and merged_into_id is null
          group by 1 having count(*) > 1;")
SET
         branch         | current_user
------------------------+--------------
 br-super-dawn-axfi55p6 | neondb_owner

               user_id                | count
--------------------------------------+-------
 e0000000-0000-0000-0000-0000000000a6 |     2
```

One SELECT, inside `default_transaction_read_only = on`, on the owner connection (as `presby_app` the probe would be filtered by RLS and would have reported a false clean). Nothing was written to `development`.

The offending rows:

```
                  id                  | first_name |   last_name    | merged_into_id |                 orgs
--------------------------------------+------------+----------------+----------------+--------------------------------------
 c1000000-0000-0000-0000-000000000005 | Susanna    | Delacroix-Peel |                | 55555555-… (fernwood)
 c1000000-0000-0000-0000-000000000006 | Susanna    | Peel           |                | 55555555-… (fernwood)
 user e0000000-…-00a6 = router.dup@example.invalid, "Fixture Duplicate"
```

**This is not data rot on one branch, and it is not fixable by cleaning `development`.** The two rows are `scripts/seed-dev.sql:836-838` — a deliberate, committed fixture whose entire purpose is to *be* the duplicate that `userOrganizations()`'s TypeScript de-duplication loop collapses. That is the very loop F110 cites as "a rendering workaround standing in for a missing constraint." Phase 2's premise ("the three `set user_id` fixtures in `scripts/seed-dev.sql` are distinct, so the fixture is clean") read the three `UPDATE people SET user_id = …` statements and missed the *insert-time* `user_id` two hundred lines earlier — the exact "verify the premise against the live database, not the migration text" failure mode F38 records.

Three further facts, each measured rather than reasoned:

1. **Tombstoning one of the pair does not rescue the fixture.** `presby_user_organizations()` (read off `pg_get_functiondef`, not off `drizzle/`) already carries `and p.merged_into_id is null`. The index's partial predicate and the function's filter are the *same predicate*, so any row the index would permit is a row the de-duplication fixture no longer exercises. The index and the fixture are mutually exclusive by construction.
2. **The index would break every dev database and the documented from-empty recipe, not just `development`.** Proven on a scratch database (below): with `people_user_id_unique_idx` in place, `psql -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql` aborts at line 838 with `duplicate key value violates unique constraint "people_user_id_unique_idx"`, and because the file is one `begin;…commit;` the whole fixture rolls back.
3. **Landing the index is therefore a coordinated retirement**, not a one-line migration: the TS loop in `src/lib/authz.ts:341-352`, the fixture at `scripts/seed-dev.sql:820-838`, `scripts/test-rls.sql:535` (section 12's de-duplication assertion) and `src/lib/authz.test.ts:150,166` all move together — and three of those are Rule-16 shared, orchestrator-only files.

Per Ruling 9 and the Batch A instruction, the index is **stopped and recorded as a follow-up**. It is not silently dropped: §44 of `scripts/test-rls.sql` carries the deferral, its reason and its flip-instruction in the section body (44d/44e), and the proposed finding and TODO line are below for the orchestrator to apply at integration.

**Consequences for the rest of Batch A, stated so Batch B is not surprised:**

- No `drizzle/0054_presby_founding_administrator.sql`. Migration number 54 and journal `idx 54` remain **unclaimed** by this pipeline and are free for the follow-up or for a concurrent pipeline — the orchestrator should know 54 is back in the pool.
- No change to `src/lib/db/domain/people.ts`. Adding the `uniqueIndex(...).where(...)` without the DDL would make the Drizzle model assert a constraint the database does not have. Note that `check:schema-parity` would **not** have caught that lie: its own header declares index parity an explicit non-goal (`scripts/check-schema-parity.ts:38-43`, it compares table presence, column presence, nullability and FK shape only). The model stays honest by omission.
- `drizzle/meta/_journal.json`, `src/lib/db/domain/index.ts`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md` untouched, as instructed. No `src/lib/*.ts` touched at all.
- **Batch B must keep its duplicate defence in TypeScript.** Phase 3's step-4 pre-check query (`does this user already have a person row, and where`) is now the *only* thing standing between the first in-app writer of `people.user_id` and a second live duplicate. It was designed as a humane-message convenience with the index as the real gate; with the index deferred it is load-bearing. Batch B's DB-backed test "two inserts with the same `user_id` collide" cannot be written as designed — write it instead as "`designateFoundingAdministrator()` refuses (`person_elsewhere`) rather than creating a second live `people` row", which is the behaviour that actually protects the invariant now.

## Files Created

- none. (`drizzle/0054_presby_founding_administrator.sql` was specified by Phase 3 and is **not** created — see the headline above.)

## Files Modified

- `/Users/cshenso/git/presby-platform/presby-wt-boot/scripts/seed-dev.sql` — one clearly delimited block appended at the END, directly ahead of the final `commit;` (Rule 16). A sign-in-capable platform user `founding.fixture@example.invalid` (`e0000000-0000-0000-0000-0000000000f5`, "Fixture Founding Admin"), `is_active` true, `two_factor_required` false, the shared fixture password hash byte-identical to `clerk.fixture`/`presbytery.clerk.fixture`. **No `people` row, no `memberships` row, no `role_grants` row, anywhere** — that absence is the fixture, and the block's comment says so at length so a future pipeline does not "finish" it by linking a person.
- `/Users/cshenso/git/presby-platform/presby-wt-boot/scripts/test-rls.sql` — section 44 appended at the END as one delimited block (`-- APPENDED SECTION — pipeline/founding-admin`), including its own `\set` directives (inside the block rather than at the file's shared header seam, for the same Rule 16 reason). 17 new assertions; details below.
- `/Users/cshenso/git/presby-platform/presby-wt-boot/docs/testing.md` — one row in the Accounts table for `founding.fixture@example.invalid` plus a short paragraph noting that designating it *consumes* it (re-seed before rehearsing the handoff again). Phase 3's Batch A step 6; `docs/testing.md` is not one of the orchestrator-only shared files.

## Schema Changes

**None shipped.** No table, no column, no index, no function, no trigger, no policy, no grant.

**Migration mode: hand-written — and then withheld.** The designed artefact was a hand-written `drizzle/00XX_presby_*.sql` (never `db:push`, never `db:generate`: Drizzle Kit emits no partial unique index with a `where` predicate in this repo's hand-written lineage, and the journal/snapshot chain has been broken since `0009`–`0012`). The whole-file idempotency proof and the from-empty proof were both performed on a scratch database (below) and both passed — the migration is *correct*; it is *incompatible with the committed dev fixture*, which is why it is not shipped. `drizzle/meta/_journal.json` has 54 entries (`idx 0`–`53`) and is unchanged.

## Audit Events

None — Batch A writes no application code. `ORG_FOUNDING_ADMINISTRATOR_DESIGNATED` is Batch B's (`src/lib/audit.ts`, one delimited addition).

## Commands run, with outputs

All from `/Users/cshenso/git/presby-platform/presby-wt-boot`.

**1. Branch confirmation and the `development` probe** — see the headline above.

**2. Seed the pipeline branch and run the suite.**

```
$ npm run db:seed
seeded roles / seeded 11 features / seeded 40 feature flags
seeded 6 platform-wide group_types / bound all features to admin / done.

$ # scripts/seed-dev.sql is a from-empty script and is not re-runnable against an
$ # already-seeded database (it aborts on organizations_id_key at line 78), so the
$ # new fixture user's INSERT was applied on its own to this already-seeded branch.
$ # The whole file is exercised from empty in step 6.
INSERT 0 1

$ npx dotenv-cli -e .env.local -- psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
exit=0    638 passes
```

**621 before, 638 after** — the expected baseline exactly, plus 17. Baseline captured first on the same branch before §44 existed (`exit=0`, `621`).

**3. Static checks.**

```
$ npm run typecheck     # tsc --noEmit, clean
$ npm run lint          # eslint --max-warnings=0, clean
$ npm run check         # all five tripwires pass, including check:secrets on the new
                        # fixture email and bcrypt hash
```

**4. DB-backed Vitest** (`npm run test:db` = `dotenv -e .env.local -- vitest run --no-file-parallelism`).

```
 Test Files  293 passed (293)
      Tests  4262 passed (4262)
   Duration  426.99s
```

Run in full rather than filtered: Batch A changes no TypeScript, so the regression surface is "does one extra `users` row in the fixture break anything that counts rows" — which only the whole suite answers.

**5. `check:schema-parity` on a fresh database.**

```
[schema-parity] 67 domain tables compared — 6 differences, 6 allowlisted (0 of them unclosed drift), 0 failing
```

Zero failing, and **no new allowlist row** — `scripts/check-schema-parity.ts` is unmodified.

**6. From-empty rehearsal, on a scratch database inside the pipeline branch, then dropped.**

`create database scratch_founding` on `br-empty-frost-ax4mo8q5` (never against a shared branch's own database, and never `ALTER ROLE presby_app … PASSWORD` — the scratch database reuses the role's existing cluster-wide credentials, so the `docs/testing.md:238-254` password hazard is not touched):

```
$ npx dotenv-cli -e <scratch env> -- npx drizzle-kit migrate
[✓] migrations applied successfully!          # the committed journal, 0000–0053
$ … check-schema-parity.ts   → 67 tables, 0 failing
$ … scripts/seed.ts          → done.
$ psql -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql   → exit=0
$ psql -v ON_ERROR_STOP=1 -f scripts/install-test-helpers.sql
$ psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
exit=0    638 passes
$ select … from users where email = 'founding.fixture@example.invalid';
e0000000-…-00f5 | founding.fixture@example.invalid | is_active t | 2fa f | people_rows 0
$ drop database scratch_founding (force);
```

638 from empty, identical to the pipeline branch, with the fixture present and genuinely person-less. The scratch database is dropped; `pg_database` on the branch is back to `neondb`/`postgres`/`template0`/`template1`.

**7. Residue check on the pipeline branch after everything.**

```
stray_people = 0 | stray_roles = 0 | stray_index = 0
```

No `fa000000…`/`fb000000…` row, no `founding_administrator` role, no `people_user_id_unique_idx` survived any of the rehearsals. `git status` is exactly three modified files plus the untracked work-log.

## Failing-first evidence

Every §44 assertion was watched to fail before being allowed to pass. The mutants are scratch copies of the section; `scripts/test-rls.sql` itself was never left in a failing state.

| # | Mechanism under test | Mutation | Observed failure |
|---|---|---|---|
| 1 | §44b/(ii) — RLS on `people`/`app_roles`/`role_grants` is what isolates the designation | run §44 verbatim as `neondb_owner` instead of `presby_app` (F1: the owner bypasses every policy) | `ERROR: FAIL 44b (ii): bramblewood sees neither role the designation minted at alder — expected 0, got 2`, at the first isolation assertion (`scripts/test-rls.sql:8057`) |
| 2 | §44a/(i) — the person-arm grant is what carries `roles.manage` | delete the `:FA_GRANT` row from the `role_grants` insert | `ERROR: FAIL 44a (i): the designee holds roles.manage at their own org … — expected 1, got 0` (`scripts/test-rls.sql:8013`) |
| 3 | §44c/(iii) — the `app_roles` `WITH CHECK` is what refuses a cross-org insert | point the smuggled insert at `:ALDER` (its own org) instead of `:BRAMBLE`, so the insert *should* succeed | `ERROR: FAIL 44c (iii): alder minted a founding_administrator role for bramblewood` — i.e. the guard block is not vacuously passing on some unrelated error (`scripts/test-rls.sql:8097`) |
| 4 | §44e — the duplicate-inventory regression pin | plant a second duplicate `user_id` at fernwood inside the section's own transaction | `ERROR: FAIL 44e: router.dup@ is the ONLY duplicate user_id visible at fernwood … — expected 0, got 1` (`scripts/test-rls.sql:8173`) |

**And the index's own failing-first/passing pair**, run on the scratch database (migrations + `db:seed`, no `seed-dev.sql`), which is the only place the experiment is possible:

```
STEP 1 (FAILING-FIRST) insert two live people rows sharing one user_id  → INSERT 0 2, live_rows_sharing_one_user_id = 2
STEP 2 the 0054 pre-flight probe, on exactly that state
        → ERROR: 0054 pre-flight: 1 user_id value(s) carry more than one live
          people row; people_user_id_unique_idx cannot be created until they
          are resolved (F110)            [errcode check_violation]
STEP 3 tombstone the loser via merged_into_id (never a hard delete)     → UPDATE 1
STEP 4 probe → "pre-flight clean";  create unique index …               → CREATE INDEX
STEP 4b the SAME two statements a second time (idempotency)
        → NOTICE: relation "people_user_id_unique_idx" already exists, skipping
          CREATE INDEX / COMMENT                                        [second run, exit 0, no row-count change]
STEP 5 (NOW PASSING) a second LIVE row for that user_id
        → unique_violation, caught: "pass  people_user_id_unique_idx rejects a
          second LIVE people row for one user_id"
STEP 6 a TOMBSTONED row with the same user_id                           → INSERT 0 1 (merge chain intact)
```

So: `(iv)` fails before the index and passes after, and the pre-flight probe raises on a planted duplicate — both exactly as the task asked, both recorded, and neither shippable, because the seventh step is:

```
STEP 7 with the index in place, psql -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql
        → psql:scripts/seed-dev.sql:838: ERROR: duplicate key value violates
          unique constraint "people_user_id_unique_idx"
          DETAIL: Key (user_id)=(e0000000-0000-0000-0000-0000000000a6) already exists.
```

## `scripts/test-rls.sql` §44 — what was added

One appended block, 17 assertions, all green as `presby_app`, nothing durable written (every sub-block is `begin; … rollback;` and mints its own rows — Rule 16: a browser rehearsal consumes single-use seed rows, so a section that leaned on them would be green once and red forever).

- **§44a — (i), the designation's tenant-side shape.** Mints the `created_person` outcome by hand at Alder Creek: a `people` row linked to the new `founding.fixture` user, a DECISION-128/129 staff-style membership (`engagement_status 'staff'`, `current_roll null`, **no `roll_actions` row**), the seven-key administration role (`role_kind 'custom'`, `is_protected false`), an office copy whose permissions are **copied from the `congregation_stated_clerk` template row** rather than re-enumerated (so `drizzle/0037`/`0052` stay the single source), and two person-arm grants with `granted_by` deliberately NULL. Asserts: `roles.manage` resolves; all seven administration keys resolve; the office key `statistics.publish` resolves; **zero** tier-3 keys resolve; **zero** of the eleven keys Phase 2 excluded by name resolve (`roll.propose`/`roll.approve`, `branding.manage`, `events.manage`, `directory.view_hidden`, `credentials.manage`, `staff.manage`, `children.roster`, `ledger.approve`, `per_capita.manage`, `statistics.manage`); and `congregation_oversight.manage` does **not** resolve for a congregation. The NULL `granted_by` is load-bearing: the grant resolving anyway is what pins Phase 2's Two Hierarchies claim that the resolver's four arms never read it.
- **§44b — (ii), a different organization sees none of it.** Same transaction, one `set_config` away: Bramblewood sees neither role, neither grant, and cannot see the person at all; the designee holds nothing at Bramblewood; and asking `presby_has_permission(designee, :ALDER, …)` from Bramblewood's context raises `insufficient_privilege` rather than answering falsely — F107's anti-fishing guard, which is the same guard that makes the holder-count gate a plain CTE on `platformDb` instead of a call to `presby_effective_permissions()`.
- **§44c — (iii), `presby_app` cannot mint a `founding_administrator` role for another organization**, and (one table down, added because the composite anchor is the point) cannot attach a permission to another organization's role.
- **§44d — (iv), DEFERRED, with its reason in the section body.** A live demonstration that a second live `people` row sharing a `user_id` is currently **accepted** (`assert_eq(… , 2, '… people_user_id_unique_idx does not exist yet …')`). The comment states exactly what flips when the follow-up lands: replace the `assert_eq` with a `do $$ … exception when unique_violation …` block and (iv) becomes the positive assertion Ruling 9 asked for.
- **§44e — the blocker, pinned.** The suite cannot take a *global* inventory of duplicate `user_id`s — `people` is `FORCE ROW LEVEL SECURITY` and `presby_app` sees one organization at a time, so the cross-org probe is an owner query (run above, recorded here). What it pins instead, inside fernwood's context: `router.dup@` is the **only** `user_id` with more than one live `people` row, and it still has exactly two. The first assertion is a genuine regression tripwire on Batch B's new writer; the second is the mechanical gate on the follow-up — the day it reads 0, the fixture is retired and the index can land.

Section header carries the "WHAT THIS SUITE CAN AND CANNOT PROVE" block in sections 34/35/41's idiom: §44 proves the *shape* the platform write leaves behind; it does not and cannot exercise `designateFoundingAdministrator()`, the holder-count gate, or the trigger-driven refusals (`person_elsewhere`/`membership_ended`/`provisioning_incomplete`) — those are `neondb_owner`-connection behaviours and belong in `src/lib/founding-administrator.test.ts` on `PLATFORM_DATABASE_URL`, the same split section 41 already documents for `presby_withdraw_publication()`.

## Proposed for the orchestrator to apply at integration (not edited on this branch)

**Finding, for `docs/schema-design-2.md` §2m** (next free number in this pipeline's block after F107–F111):

> **F112** — the F110 index is blocked by a *fixture*, not by data rot, and the two cannot coexist. `scripts/seed-dev.sql:836-838` seeds two live `people` rows on one `user_id` (`router.dup@example.invalid`) for the sole purpose of being the duplicate `userOrganizations()`'s TypeScript loop de-duplicates — the loop F110 cites as the workaround the index would replace. Because `presby_user_organizations()` already filters `p.merged_into_id is null`, the index's partial predicate and the fixture's reason to exist are the same predicate: tombstoning one row does not preserve the fixture, it destroys it. Measured: with the index in place `scripts/seed-dev.sql` aborts at line 838, so the index would break every dev database and the documented from-empty recipe, not merely `development`. Landing it is a coordinated retirement of the loop (`src/lib/authz.ts:341-352`), its fixture, `scripts/test-rls.sql:535` and `src/lib/authz.test.ts:150,166` — three of which are Rule-16 shared files. Generalisation, and the reason this is a finding rather than a ticket: **a probe that a design gates itself on must be run against the fixture the constraint will have to survive, not only against the environment's current rows** — Phase 2 read the three `UPDATE people SET user_id` statements and did not see the insert-time `user_id` two hundred lines earlier, the same premise-vs-live-database gap F38 records.

**`docs/TODO.md` line:**

> One human, one login (F110/F112): `people.user_id` still carries only a non-unique index and the first in-app writer of the column now ships without one. Landing `people_user_id_unique_idx` requires retiring the `router.dup@` de-duplication fixture (`scripts/seed-dev.sql:836-838`), the TypeScript loop it proves (`src/lib/authz.ts:341-352`), `scripts/test-rls.sql:535` and `src/lib/authz.test.ts:150,166` in one pipeline — and flipping `scripts/test-rls.sql` §44d from its deferred negative to the positive assertion Phase 2 Ruling 9 (iv) specified. Migration number `0054` and journal `idx 54` are unclaimed and free for it.

**Also note for the orchestrator:** migration `0054` / journal `idx 54` were pre-assigned to this pipeline at kickoff and are **not used**. They are back in the pool for a concurrent or subsequent pipeline.

## The contract Batch B (api-developer) consumes

- **Fixture user** — `founding.fixture@example.invalid`, `users.id = e0000000-0000-0000-0000-0000000000f5`, name `Fixture Founding Admin`, password `e2e-fixture-only-not-a-secret` (the shared fixture password, `docs/testing.md`), `is_active = true`, `two_factor_required = false`, `email_verified` set. **Zero `people` rows, zero `memberships`, zero `role_grants`** — it is the only seeded account that can exercise the `created_person` branch. Designating it consumes it; re-seed from empty before rehearsing again. Under Phase 2 Ruling 6's name heuristic (`users.name` split on the last space) it yields `firstName = "Fixture"`, `lastName = "Founding Admin"` — worth an explicit test case, because the last-space split puts a two-word surname in `lastName`, which is the behaviour the comment promises.
- **Index name** — `people_user_id_unique_idx` **does not exist**. Do not write code, a test, or an error-mapping branch that assumes a `unique_violation` on `people.user_id`; there is none. The TypeScript pre-check and the `memberships_guard_insert` refusal are the whole defence (see the consequences list in the headline).
- **§44 fixture ids** — all minted and rolled back inside the section, so they are *reserved but never durable*. Batch B must not reuse them for anything persistent: `fa000000-0000-0000-0000-000000000001` designee person · `…-000000000002` `founding_administrator` role · `…-000000000003` office copy · `…-000000000004` administration grant · `…-000000000005` office grant · `…-00000000000a` / `…-00000000000b` the 44d duplicate pair. The `fb000000-…` prefix was used only on the now-dropped scratch database and is free.
- **Unchanged, as Phase 2's mechanical test requires** — `src/lib/authz.ts`, `src/lib/role-definitions.ts`, `src/lib/role-grants.ts` and `drizzle/0010_presby_resolver.sql` are byte-identical to `main` after Batch A. `git status` shows exactly `scripts/seed-dev.sql`, `scripts/test-rls.sql`, `docs/testing.md`.
- **Local apply command for the next implementer** — there is no migration to apply. On an existing branch database: `npm run db:seed`, then the one appended `insert into users …` block at the end of `scripts/seed-dev.sql` (the file as a whole is from-empty only). From empty: `npm run db:migrate` → `npm run check:schema-parity` → `npm run db:seed` → `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql` → `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/install-test-helpers.sql` → `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql` (expect **638**).
- **`test-rls.sql` sections touched** — §44 added (17 assertions). No existing section modified; §44e *reads* the section-12 fixture but changes nothing about it.

**Batch A complete; Batch B (api-developer) next.**

---

## Batch B — api-developer (2026-09-28)

**Worktree** `/Users/cshenso/git/presby-platform/presby-wt-boot` on `pipeline/founding-admin`.
**Neon branch** `pipeline-founding-admin` — confirmed from the database itself: `select current_setting('neon.branch_id', true), current_user` → `br-empty-frost-ax4mo8q5` / `presby_app`. `env | grep DATABASE_URL` was empty before every invocation; every command went through `dotenv-cli -e .env.local`. `ALTER ROLE presby_app … PASSWORD` was never run. `npm run db:push` was never run. No schema, seed, or `test-rls.sql`/`db/domain/index.ts` file was touched — Batch B is TypeScript-only, per the design.

### Files Created

- `/Users/cshenso/git/presby-platform/presby-wt-boot/src/lib/founding-administrator.ts` — `foundingAdministratorPlan()`, `deriveNameFromUser()`, `countFoundingAdministratorHolders()`, `designateFoundingAdministrator()`, the nine-variant `FoundingAdministratorResult` union, plus the private `foundingAdministratorHolderCount()`/`classifyPersonRows()`/`upsertAppRole()`/`permissionKeysForRole()`/`addPermissionsToRole()`/`errorMessageChain()` helpers.
- `/Users/cshenso/git/presby-platform/presby-wt-boot/src/lib/founding-administrator.test.ts` — DB-backed integration suite (27 tests) plus the standalone "four files unchanged" mechanical test.

### Files Modified

- `/Users/cshenso/git/presby-platform/presby-wt-boot/src/lib/audit.ts` — one delimited addition at the end of the `AUDIT_ACTIONS` object: `ORG_FOUNDING_ADMINISTRATOR_DESIGNATED: "org.founding_administrator.designated"`.
- `/Users/cshenso/git/presby-platform/presby-wt-boot/src/lib/audit.test.ts` — the matching `EXPECTED_ENTRIES` addition (the catalog snapshot/regression test Phase 3 asked for).
- `/Users/cshenso/git/presby-platform/presby-wt-boot/src/app/(admin)/admin/organizations/[id]/actions.ts` — `designateFoundingAdministratorAction` appended (zod email schema, the full result → copy switch, `recordAudit` on `ok` only, `revalidatePath`).
- `/Users/cshenso/git/presby-platform/presby-wt-boot/src/app/(admin)/admin/organizations/[id]/actions.test.ts` — extended (this directory's own convention: confirm-and-extend, not a new file): the mock for `@/lib/founding-administrator`, and three describe blocks (authorization, input validation, result mapping) totaling 17 new tests.

### Deviations from Phase 3's design, each named

1. **No unique-index catch.** Phase 3's error-catch table didn't need to name a `people_user_id_unique_idx` catch (it was never in that table to begin with — the index enforcement was meant to be silent, structural). Consistent with Batch A's headline, the module's header comment states explicitly that no such index exists and none should be added until F112's follow-up lands; the pre-check `select` in step 4 plus `memberships_guard_insert` are the whole defence.
2. **Name heuristic: first-space split, not last-space.** Phase 2 Ruling 6's prose says "split on the last space," but Batch A's own worked example for this pipeline's seed fixture (`"Fixture Founding Admin"` → `firstName: "Fixture"`, `lastName: "Founding Admin"`) only follows from a FIRST-space split. Implemented to match the worked example (the more specific, more recently verified source), with the discrepancy stated in `deriveNameFromUser()`'s own doc comment and pinned by a named regression test using that exact fixture name.
3. **Additive-only `app_role_permissions` reconcile** — Phase 3's own tech-lead ruling (step 9), not in Phase 2's text; implemented as `on conflict do nothing`, never a delta removal, exactly as specified. No new `DECISION-1xx` claimed; left for the orchestrator to fold under DECISION-155 or number separately.
4. **`membership_ended`'s trigger-backstop catch returns `endedOn: "unknown"`**, not a real date — Phase 3 itself said "the date is re-derived from the pre-check read, not parsed out of the message," but by the time this catch can fire, Postgres has already aborted the rest of the transaction (no further read is possible), and step 4's own classification already returns the real date for the primary case before any write is attempted. The action layer's copy branches on this literal (`"unknown"` → a dateless sentence; anything else → the dated sentence).

### The Genuine Discovery (recorded here, not just in code comments)

Attempting Batch A's own suggested test for `race` ("simulate the 23505 by pre-inserting the role row in a parallel transaction") surfaced a real Postgres mechanism neither Phase 2 nor Phase 3 named: `app_roles.organization_id` is a real foreign key to `organizations.id`, and Postgres takes an implicit `FOR KEY SHARE` lock on the **referenced** row for the duration of any transaction that inserts a referencing row. `FOR KEY SHARE` conflicts with `FOR UPDATE`. So **any** writer inserting into `app_roles`/`role_grants` for an organization — not only a second call to `designateFoundingAdministrator()` — blocks behind this function's own step-1 `organizations` lock until it resolves. Measured directly (see the test named "GENUINE DISCOVERY" in `founding-administrator.test.ts`): a raw, uncommitted transaction holding an `app_roles` insert for the target org blocked `designateFoundingAdministrator()` at its very first statement for the raw transaction's entire 1.5s lifetime, then proceeded immediately once it committed.

Consequence: the `isUniqueViolation()`/`race` catch **cannot be forced through any ordinary, FK-respecting write path** — by the time a competing writer's insert could even be attempted, this function's own transaction has already resolved one way or the other (typically `has_holders`, since the holder-count read also happens inside the same lock window). The catch stays in the code, unchanged, as the same kind of cheap, named backstop `createOrganization()`'s `slug_taken` catch already is for its own TOCTOU window — insurance against a future schema change (e.g. dropping the FK) that would reopen the window, not a path any current writer can exercise. Proposed as a finding for `docs/schema-design-2.md` §2m at integration:

> **F113 (proposed)** — a `for update` lock on a parent row serializes against ANY concurrent writer inserting a child row referencing it, not only against a second caller of the same function, because Postgres takes an implicit `FOR KEY SHARE` lock on the referenced row for the lifetime of the inserting transaction and `FOR KEY SHARE` conflicts with `FOR UPDATE`. Worth recording as a reusable pattern: a `select ... for update` on the parent is sufficient to fully serialize mutations on a child table's foreign-keyed rows, without locking the child table itself — the mechanism `designateFoundingAdministrator()`'s own gate relies on, discovered while trying (and failing, for this reason) to force its `app_roles_org_key` unique-violation backstop through genuine concurrency.

### Contract Batch C (ux-developer) consumes

**Server action** — `src/app/(admin)/admin/organizations/[id]/actions.ts`:

```ts
export async function designateFoundingAdministratorAction(
  formData: FormData, // fields: organizationId (uuid), email
): Promise<PolicyResult>; // { ok: true } | { ok: false; error: string }
```

Auth + feature gate: `auth()` then `hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)` — identical to every other export in this file. Email is `z.string().trim().toLowerCase().email().max(320)`.

**Result → copy** (every branch reachable through the action, exact strings — Batch C's confirm-dialog and inline error banner render these verbatim, they are not Batch C's to reword):

| `designateFoundingAdministrator()` result | Action's `PolicyResult` |
|---|---|
| `no_such_user` | `{ ok: false, error: "No platform account exists for that email yet. Ask them to sign up first (they'll land on a page saying they have no organizations), then designate them here." }` |
| `user_inactive` | `{ ok: false, error: "That account has been deactivated." }` |
| `person_elsewhere` | `{ ok: false, error: "That account is already linked to a person at a different organization. Cross-organization transfers go through the certificate/transfer process, not this designation." }` |
| `membership_ended` (`endedOn` a real date) | `` { ok: false, error: `That person's relationship with this organization ended on ${endedOn}.` } `` |
| `membership_ended` (`endedOn: "unknown"`) | `{ ok: false, error: "That person's relationship with this organization has ended." }` |
| `has_holders` | `{ ok: false, error: "This organization already has someone who can manage roles — designation is only available while nobody does (including as a lockout recovery)." }` |
| `provisioning_incomplete` | `{ ok: false, error: "This organization is missing its baseline setup — contact an engineer before designating an administrator." }` |
| `race` | `{ ok: false, error: "Someone just designated a founding administrator for this organization — refresh the page." }` |
| `db_error` | `{ ok: false, error: "We couldn't complete that just now — try again in a moment." }` |
| `ok` | `{ ok: true }` — `recordAudit(ORG_FOUNDING_ADMINISTRATOR_DESIGNATED)` fires first (ids only in metadata — `organizationId`, `personId`, `userId`, `mode`, `officeRoleKey`, `administrationRoleKey`, `permissionKeys`, `priorHolderCount` — never the email), then `revalidatePath('/admin/organizations/<id>')`. |

A refusal never calls `recordAudit` and never calls `revalidatePath` — confirmed by the action's own test suite (`mockRecordAudit`/`mockRevalidatePath` asserted `not.toHaveBeenCalled()` on every refusal branch).

**The page's gate props** — `page.tsx` (Batch C) computes and passes:

```ts
const holderCount = await countFoundingAdministratorHolders(platformDb, id);
// exported from src/lib/founding-administrator.ts — signature:
//   countFoundingAdministratorHolders(
//     platformDb: ReturnType<typeof getPlatformDb>,
//     organizationId: string,
//   ): Promise<number>
// Read fresh on every render (never cached) — same discipline
// role-definitions.ts's roleHolderCount() already states.

const plan = foundingAdministratorPlan(org.organizationType);
// plan.officeTemplateKey: "presbytery_stated_clerk" | "congregation_stated_clerk" | null
// plan.administration.permissionKeys: string[] — the exact list the confirm
// dialog must name (Phase 3's design: the dialog names the actual
// permissions being granted, not a generic "Are you sure?").
```

`canDesignate = holderCount === 0`. `officeTemplateName` is Batch C's own display-name mapping off `plan.officeTemplateKey` (not exported by this module — `foundingAdministratorPlan()` returns the key, not a human name; Phase 3's design named an `OFFICE_TEMPLATE_DISPLAY_NAMES` lookup as `page.tsx`'s own concern).

**Seed/`FEATURES` changes:** none. No new `FEATURES.*` key (`ADMIN_ORGANIZATIONS` reused). No new seed rows from this batch (Batch A already shipped `founding.fixture@example.invalid`). `org_portal.roles` remains seeded `false` by default (`scripts/seed.ts`) — Batch C's browser rehearsal must confirm/flip it on the pipeline branch per Phase 3's rehearsal step 5; not this batch's to change.

### Tests

**`src/lib/founding-administrator.test.ts`** (DB-backed, `--no-file-parallelism`, run against `PLATFORM_DATABASE_URL`/`DATABASE_URL` on the pipeline branch) — 27 tests, all passing:

- `foundingAdministratorPlan()` — congregation/presbytery/three template-less types, plus a sweep asserting no tier-3 or excluded tier-2 key ever appears (nested inside the DB-gated suite per this file's own header note: even these pure-function tests must be dynamically imported, since `./founding-administrator` transitively imports `@/lib/db`, whose module-scope pool construction throws immediately without `DATABASE_URL` — measured directly: the first draft of this file imported these functions at the top level and every test failed before running).
- `deriveNameFromUser()` — the pipeline's own worked example pinned exactly, plus middle-name, single-word, null, and blank-name cases.
- `ok — created_person` × 3 (congregation, presbytery, synod/template-less) — full permission-key assertions, `firstName`/`lastName` from the name heuristic, staff-style membership shape (`engagementStatus: "staff"`, `currentRoll: null`), `countFoundingAdministratorHolders()` 0→1.
- `ok — existing_person` — a pre-existing person+membership is reused, no duplicate membership row.
- `no_such_user` / `user_inactive`.
- `person_elsewhere` (F108) — **failing-first** (see below); also the explicit replacement for Batch A's deferred index test: asserts `designateFoundingAdministrator()` refuses rather than creating a second live `people` row for that `user_id`.
- `membership_ended` — **failing-first**.
- `has_holders` — **failing-first**.
- `provisioning_incomplete` — asserts the whole transaction rolled back (no orphan `people` row).
- `db_error` — a malformed `organizationId` reaching the DB directly (the action layer's own zod/UUID_RE checks would already have caught this; proves the catch-all doesn't accidentally swallow a real bug as a named case).
- `race` — two concurrent calls for the same org (measured: always resolves `has_holders` for the loser, given the lock — see the Genuine Discovery above) plus the dedicated **failing-first** lock-generalization test.
- `recovery (F109)` — designate → lapse the grants + deactivate the role directly → designate again: same `app_roles.id` reused, `deactivatedAt` cleared, every plan permission key still present (additive-only reconcile proven, not just asserted).
- "Two Hierarchies — four files unchanged" — `git diff --name-only main -- <the four files>` asserted empty; runs with no DB and no skip (confirmed passing standalone with `DATABASE_URL` unset).

**Failing-first evidence** (mutated, watched fail, reverted, watched pass — methodology mirrors Batch A's own mutant table):

| Branch | Mutation | Observed failure | Reverted, now passing |
|---|---|---|---|
| `person_elsewhere` | `classifyPersonRows()`'s "elsewhere" branch returns `existing_person` instead | `role_grants_person_fk` violation (23503) surfaces as `db_error` instead of `person_elsewhere` — `AssertionError: expected { kind: 'db_error' } to deeply equal { kind: 'person_elsewhere' }` | Yes |
| `membership_ended` | The classification's `membership_ended` branch short-circuited to `if (false && …)` | The trigger backstop still catches it, but with `endedOn: "unknown"` instead of the real pre-check date — `AssertionError: expected {"endedOn": "unknown", …} to deeply equal {"endedOn": "2020-06-15", …}` | Yes |
| `has_holders` | The holder-count gate short-circuited to `if (false && holderCount > 0)` | The mutant designation actually succeeds (`kind: "ok"`) instead of refusing — `AssertionError: expected {kind: 'ok', …} to deeply equal {kind: 'has_holders', holderCount: 1}` | Yes (the mutant's stray `people`/org rows were cleaned up manually before reverting) |
| "GENUINE DISCOVERY" (race generalization) | N/A — this test does not guard a refusal branch; it proves a Postgres locking property. First attempt (a different test, forcing the literal `isUniqueViolation()` catch) failed for the reason the Discovery itself explains — see above — and was replaced, not force-fixed, once the mechanism was understood. | The original design (hold a same-key conflicting row uncommitted, expect `race`) never produced `race` at any timeout tried (1s, 4s) — it always produced `ok`, which is what led to discovering the `FOR KEY SHARE`/`FOR UPDATE` interaction | Yes (rewritten as the passing discovery test) |

**`src/app/(admin)/admin/organizations/[id]/actions.test.ts`** (mocked, no DB) — 17 new tests: authorization (2), input validation (5, including email normalization), result mapping (10 — one `it.each` covering all eight refusal kinds plus the `ok` success path with exact `recordAudit` metadata and an explicit "email never appears in the audit payload" assertion).

### Commands Run, With Outputs

```
$ npm run typecheck                          # clean
$ npm run lint                               # clean (eslint --max-warnings=0)
$ npm run check                              # all five tripwires pass, incl. check:audit
$ npx dotenv-cli -e .env.local -- npx vitest run src/lib/founding-administrator.test.ts --no-file-parallelism
  Test Files  1 passed (1)   Tests  27 passed (27)
$ npx vitest run "src/app/(admin)/admin/organizations/[id]/actions.test.ts"
  Test Files  1 passed (1)   Tests  87 passed (87)
$ npx dotenv-cli -e .env.local -- npx vitest run --no-file-parallelism     # full DB-backed suite
  Test Files  294 passed (294)   Tests  4306 passed (4306)   Duration  457.80s
$ npm test                                   # CI mode, no DATABASE_URL
  Test Files  260 passed | 34 skipped (294)   Tests  3392 passed | 914 skipped (4306)
$ psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
  exit=0    638 passes, 0 failures
$ git diff --name-only main -- src/lib/authz.ts src/lib/role-definitions.ts src/lib/role-grants.ts drizzle/0010_presby_resolver.sql
  (empty)
```

One self-inflicted residue, found and fixed before the final `test-rls.sql` run: three scratch organizations (`race-manual-test-xyz`, `race-manual-test2-xyz`, `race-node-test-xyz`) created via raw `psql`/Node while diagnosing the Genuine Discovery above were left on the branch and caused an unrelated `test-rls.sql` section-7 coverage assertion to fail ("expected 18, got 15" — an organization-count check with no relation to §44). Deleted directly (each had no `deletable_until`, so the delete went through the same disable/enable-trigger bracket `founding-administrator.test.ts`'s own `afterAll` uses for `group_memberships_reject_derived`); confirmed clean and re-ran to 638/0.

**Final residue check on the pipeline branch:** zero stray organizations, zero stray users, zero `people` rows with `deletable_until` set. `founding.fixture@example.invalid` still has zero `people` rows (untouched — reserved for Batch C's browser rehearsal and QA's Phase 5 repeat of it, per Phase 2 Ruling 10 / Phase 3's Browser Rehearsal section). `git status` on the branch is exactly: `docs/testing.md`, `scripts/seed-dev.sql`, `scripts/test-rls.sql` (all Batch A's), `src/app/(admin)/admin/organizations/[id]/actions.ts` + `.test.ts`, `src/lib/audit.ts` + `.test.ts` (all Batch B's, modified), plus the new `src/lib/founding-administrator.ts` + `.test.ts` and this work-log (untracked).

### Proposed for the orchestrator to apply at integration (not edited on this branch)

- **F113** (above) for `docs/schema-design-2.md` §2m, immediately after F112.
- No `docs/TODO.md` changes proposed by this batch beyond what Batch A already proposed (F111/F112 follow-ups, the invitation-system deferral) — nothing new from Batch B's own work is deferred.

**Batch B complete; Batch C (ux-developer) next.**

---

### Orchestrator note (2026-09-28, after Batch B)

Batch B's proposed finding is numbered **F117** at integration (F113–F116 belong to the parallel presbytery-e2e pipeline; this pipeline's range F107–F112 is used). Its content — the FK-implied `FOR KEY SHARE` on the parent `organizations` row serialising every FK-respecting inserter behind the designation's `FOR UPDATE`, so the 23505 `race` arm is unreachable through a normal writer and stays as defence in depth — is otherwise adopted as written.

---

## Batch C — ux-developer (2026-09-28)

**Worktree** `/Users/cshenso/git/presby-platform/presby-wt-boot` on `pipeline/founding-admin`. **Neon branch** `pipeline-founding-admin` (`br-empty-frost-ax4mo8q5`, confirmed via `select current_setting('neon.branch_id', true)`). `env | grep DATABASE_URL` was empty before every command. `npm run db:push` was never run; `ALTER ROLE` was never run. Dev server ran on port **3400**, started with `PORT=3400 npm run dev` backgrounded to a log file, stopped by `kill "$(cat pidfile)"` — never `pkill -f`.

### Files Created

- `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.tsx` — the client form/confirm/collapsed-state component.
- `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.test.tsx` — 18 tests.
- `src/app/(admin)/admin/organizations/[id]/page.test.tsx` — new file for this directory (none existed before); 2 tests pinning the gate-prop wiring.

### Files Modified

- `src/app/(admin)/admin/organizations/[id]/page.tsx` — added the `countFoundingAdministratorHolders()`/`foundingAdministratorPlan()` reads (fresh every render, never cached), the local `OFFICE_TEMPLATE_DISPLAY_NAMES` map, and rendered `<FoundingAdministratorSection>` first, above "Current brand," unconditionally (it renders its own collapsed state internally when `canDesignate` is false — Phase 3's "rendered first and prominently … render no need to disappear" instruction, satisfied by the section owning both states rather than the page conditionally omitting it).

No other file was touched. `src/lib/**`, `scripts/`, `drizzle/`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/product/functionality-map.md` are untouched by this batch, confirmed by `git status --short` showing exactly the files Batch A/B/C together are expected to carry.

**`new/actions.ts` — confirmed, not modified.** Read `createOrganizationAction` and `create-organization-form.tsx` in full: the create form already `router.push()`es to `/admin/organizations/<id>` on `{ ok: true, organizationId }` (Phase 3's "API Contract" note that this was "already true today"). Nothing to change.

### Component / Page Design, As Built

- **Single email `Input`**, no person picker, per Phase 2 Ruling 4.
- **`AlertDialog`** (not a raw `<form>` submit, not `confirm()`) — opened by a plain `<Button>` (not `AlertDialogTrigger`, since the email must be captured and validated before the dialog can render its own copy), controlled via `open`/`onOpenChange`. The `AlertDialogAction`'s `onClick` builds a `FormData` by hand and calls `designateFoundingAdministratorAction` directly inside a `useTransition`, mirroring `neutralize-dialog.tsx`'s `handleConfirm` shape exactly.
- **Confirm-dialog copy** names the organization, the designee's email, and the *actual* permission list — computed from a `PERMISSION_LABELS` lookup table applied to the `administrationPermissionKeys` prop the page passes down (not imported from `@/lib/founding-administrator`, which transitively pulls `@/lib/db` into the module graph and would break in a client bundle — confirmed by Batch B's own header comment on the same issue for its DB-backed test file). The office-template clause is included only when `officeTemplateName` is non-null.
- **Hint** ("the person must sign up first, then designate by email") renders unconditionally under the input, not only on a `no_such_user` error, per the task's explicit requirement.
- **Every result variant's copy is rendered verbatim** — the component does not re-derive or re-word any `PolicyResult.error` string; it renders `result.error` (or a fixed "Founding administrator designated." success line) directly. This makes Batch B's result→copy table load-bearing at the UI layer without a second copy of it living in this file.
- **Collapsed read-only state** (`canDesignate: false`) names `currentHolderCount` with correct singular/plural ("one person" / "N people"), per the task's explicit requirement, and directs the operator to the org's own Roles page rather than repeating the form.
- **No hand-rolled class strings** — every interactive primitive is `Button`/`Input`/`Label`/`AlertDialog*` from `src/components/ui/`; no new shadcn primitive was needed (`npm run ui:add` was not invoked).
- `(admin)` stays platform palette; `check:brand-scope` passed unaffected.

### Tests

**`founding-administrator-section.test.tsx`** (18 tests, `./actions` and `sonner` mocked — same boundary `profile-form.test.tsx`'s own header documents): disabled/collapsed state naming the holder count (singular and plural); the form and hint render unconditionally when `canDesignate`; the "Designate" trigger is disabled until the email passes a client-side shape check; no native dialog (`alert`/`confirm`/`prompt`) is ever invoked; the confirm dialog names the actual permission list (parameterized by `organizationType`/`administrationPermissionKeys`/`officeTemplateName`, not a hardcoded string) including the presbytery-only `congregation_oversight.manage` clause and the template-less-org omission; **every one of the nine `PolicyResult` variants from Batch B's table** (`no_such_user`, `user_inactive`, `person_elsewhere`, `membership_ended` dated and undated, `has_holders`, `provisioning_incomplete`, `race`, `db_error`, `ok`) renders its exact copy inline and calls `toast.success`/`toast.error` correctly, with the submitted `FormData`'s `organizationId`/`email` asserted on every case.

**`page.test.tsx`** (2 tests, new file) — mocks `getPlatformDb()`'s two sequential `.select()` calls (org row, brand row — page.tsx's own unchanged order), `@/lib/founding-administrator`, and every child component; asserts `countFoundingAdministratorHolders()` is called with the org id and `foundingAdministratorPlan()` with the org's type, and that the resulting `canDesignate`/`currentHolderCount`/`administrationPermissionKeys`/`officeTemplateName` props reach `<FoundingAdministratorSection>` unmodified for both a zero-holder (office template present) and a holders-present (template-less `synod`) case.

Both files use the codebase's plain-DOM-assertion convention (no jest-dom matchers — `org-mark.test.tsx`'s own header explains why) and the `vi.hoisted()` mock pattern already established by `deactivate-role-dialog.test.tsx` and the tickets `[id]/page.test.tsx`.

### Commands Run, With Outputs

```
$ env | grep DATABASE_URL                     # empty
$ npm run typecheck                            # clean
$ npm run lint                                 # clean (eslint --max-warnings=0)
$ npm run check                                # all five tripwires pass, incl. check:brand-scope
$ npx vitest run "src/app/(admin)/admin/organizations/[id]/founding-administrator-section.test.tsx"
  Test Files  1 passed (1)   Tests  18 passed (18)
$ npx vitest run "src/app/(admin)/admin/organizations/[id]/page.test.tsx"
  Test Files  1 passed (1)   Tests  2 passed (2)
$ npm test                                     # CI mode, no DATABASE_URL
  Test Files  262 passed | 34 skipped (296)    Tests  3412 passed | 914 skipped (4326)
$ npx dotenv-cli -e .env.local -- npx vitest run --no-file-parallelism   # full DB-backed suite
  Test Files  296 passed (296)   Tests  4326 passed (4326)   Duration  455.67s
$ psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
  exit=0   639 passes, 0 failures   (re-run AFTER the browser rehearsal's cleanup — see below)
```

### The Browser Rehearsal — all 8 steps, Playwright (no interactive browser available in this environment)

Ran against the dev server on port 3400, driven with a throwaway Playwright script in the gitignored `scratch/` directory (deleted at the end of this batch — never committed). Screenshots were written to the session scratchpad; the notable ones are described inline below since the scratchpad is not part of the deliverable.

1. **Signed in as `admin@presby.invalid`, created a fresh presbytery** (`Boot Rehearsal Presbytery`, invented name, slug `boot-rehearsal-muls6ltt` — a branch DB, so no `e2e-`-prefix requirement applies) via `/admin/organizations/new`. Landed on `/admin/organizations/<id>` and confirmed the **Founding Administrator section renders first, above "Current brand,"** in its blue expanded state, naming the org's zero-holder status and offering the email input — matches the design screenshot-for-screenshot.
2. **Designated `founding.fixture@example.invalid`.** Typed the email, opened the confirm dialog — copy read *"Designate founding.fixture@example.invalid as Boot Rehearsal Presbytery's founding administrator? They will be able to manage people, roles, role assignments, groups, officers, feature toggles, support tickets, and congregation oversight, plus this organization's constitutional Presbytery Stated Clerk office. This can only be done once …"* — every permission key named, correctly presbytery-inflected, office template named. Confirmed → toast *"founding.fixture@example.invalid is now Boot Rehearsal Presbytery's founding administrator."* → section collapsed to the read-only line. **This consumes the fixture's no-`people`-row state** (see "State Left Behind" below).
3. **Signed out; signed in as `founding.fixture@example.invalid`** (shared fixture password). Landed at `/o/boot-rehearsal-muls6ltt` directly — one enterable org, no chooser, `/launch`'s matrix working as documented.
4. Confirmed `/launch` routing — the org portal home rendered with a full domain-tile grid (People & Membership, Worship & Events, Giving & Finance, Governance & Courts, Reports & Insights, Communications, **Administration**), greeting "Good evening, Fixture."
5. **Reached `/o/<slug>/admin/roles` by clicking**, not typing the URL: confirmed `org_portal.roles` was already `enabled = true` on this branch DB via `psql` before starting (recorded below), then clicked "Administration" in the top nav → `/o/<slug>/admin` (a real hub page showing four administer-category tiles: **Roles**, Tickets, Features, Branding, plus a Reports & Insights tile for Per-Capita/SASR/Imports — confirming `tickets.file`, `org_features.manage`, and the adopted `presbytery_stated_clerk` office's `per_capita.manage` are all independently reachable) → clicked "Roles" → `/o/<slug>/admin/roles`. **First click attempt used `waitForLoadState("networkidle")` immediately after `.click()` and appeared not to navigate** (a client-side Next.js transition can resolve "networkidle" before the route change commits) — re-run with `page.waitForURL(...)` confirmed the click does navigate correctly; recorded here so QA isn't puzzled by the same false negative.
6. **Grant a role to a second person — the non-negotiable self-sufficiency proof.** This is where the rehearsal surfaced a real, previously-undiscovered gap (full writeup below): **there is no in-app path for the founding administrator to create a second person at all.** The `/o/<slug>/admin/members/new` wizard was reached successfully (after first self-granting `org_features.manage`'s own proof point — see next paragraph), filled through all six steps (search → identity → contact → household "No household yet" → roll action "Profession of faith" → review), and **the final submit was refused**: *"You don't have permission to add members here."* Traced to `src/lib/people.ts`'s `createPerson()`: `roll.propose` is required whenever `rollAction.kind !== "none"`, the member wizard's own two offered kinds (`profession_of_faith`, `other_participant_enrolled`) are both `!== "none"`, and `roll.propose` is not in the founding-administrator bundle (Phase 2 Ruling 3 excluded it **by name**, reasoning that "a founding administrator enrolls people as staff-kind anchors" instead) — but the only code path that ever calls `createPerson()` with `rollAction.kind: "none"` is the staff-hire flow (`src/lib/staff.ts`), gated on `staff.manage`, which F111 already named as **permanently unreachable by any template or bundle** (no role anywhere in the catalog carries it, and `assertPermissionSubset()` means the founding administrator's own `roles.manage` cannot mint a role carrying a permission they don't already hold). **Net effect: a freshly designated founding administrator, exactly as the bundle is currently specified, cannot get any second person into their organization through the product at all** — not through the member wizard (needs `roll.propose`), not through staff hire (needs `staff.manage`), not through the roles-grant form (which only offers a dropdown of people who already exist — confirmed by inspecting it directly: with only the founding administrator's own person at the org, the "Person" dropdown on `/admin/roles`'s "Grant a role" form has exactly one option). This is a materially sharper consequence of F111 than its original framing ("the Staff directory feature is inert") — it means the bundle **cannot stand up a second real user at all**, which is the core promise DECISION-100/101/106 exist to close. **I did not attempt to work around this by editing `src/lib/**` (out of this batch's scope) or by hand-writing SQL to fake a second person through the UI's own flow** — that would hide the finding rather than surface it. Proposed as a new finding (next number after F117, for the orchestrator to assign) for Phase 2/3 to rule on: either add `roll.propose` to the bundle (it fits Phase 2 Ruling 3's own three-part test — no template carries it, none ever will, and per this discovery, standing up the org concretely *does* require it), or build a `people.manage`-gated (not `staff.manage`-gated) staff-kind-anchor creation surface matching what Ruling 3's own prose already promised but never built. **This should be treated as a Phase 5/6 loop-back candidate**, not silently absorbed.
   - As a partial, honest substitute for step 6's literal instruction, I demonstrated everything that **does** work: granted `org_features.manage` in practice by toggling on the org-level `members_create` feature via `/o/<slug>/admin/features` (the global `org_portal.members_create` flag was already `true` on this branch; the **per-org toggle** was off by default, exactly as Phase 2 Ruling 3 predicted — "Per-org toggles default off, so without this the portal is inert on day one" — and the founding administrator's own `org_features.manage` grant is what let them flip it themselves, with no platform intervention). This is a real, working, unassisted self-sufficiency proof, just not the specific "second person" one asked for.
7. **Second designation attempt refused.** Returned to `/admin/organizations/<id>` as the platform admin: confirmed the section now shows the collapsed read-only line *"This organization already has one person who can manage roles — a founding administrator has already been designated…"* — matches the `has_holders` gate copy exactly (verified by DB query: the org's `app_roles`/`app_role_permissions` rows show exactly the 8 administration keys + 3 office keys the plan specifies, both granted to "Fixture Founding Admin" by `admin@presby.invalid`).
8. **360px viewport pass**, both states: the collapsed line and the expanded form+dialog both render without horizontal overflow, the email input is full-width, the "Designate founding administrator" button meets the 44px touch-target minimum, and every existing section on the page (brand, profile, service times, site) continues to render correctly below it — no regression to the existing page shape from the new section's insertion.

**`org_portal.roles` on this branch:** confirmed `enabled = true` via `psql "$PLATFORM_DATABASE_URL" -c "select key, enabled from feature_flags where key = 'org_portal.roles'"` before starting step 5 — no flip was needed or performed.

### State Left Behind, and How QA Resets It

- **`founding.fixture@example.invalid` was consumed** during step 2 (a real `people` row was created and linked, per its designed single-use nature — Batch A's own seed comment: "Designating it consumes it, so re-run `scripts/seed-dev.sql` on a fresh database before rehearsing the handoff again"). **I then reversed this** as part of this batch's own cleanup (see next bullet), so the fixture is back to its pre-rehearsal, zero-`people`-rows state and QA can consume it fresh — confirmed by `select count(*) from people where user_id = 'e0000000-0000-0000-0000-0000000000f5'` returning `0` after cleanup. **QA does not need to re-run `seed-dev.sql`** for this reason alone, but should still expect to consume the fixture again if they repeat the walk themselves (there is still only one such fixture — a second one is the deferred-invitation-system pipeline's problem, not this one's).
- **Two rehearsal organizations were created** (`Boot Rehearsal Presbytery`, `Boot Rehearsal Mobile Congregation`) and **deleted** at the end of this batch, via the same `deletableUntil`-stamp-then-delete-inside-a-disable/enable-trigger-bracket pattern `founding-administrator.test.ts`'s own `afterAll` uses (Ruling 10) — run as a one-off script on the platform connection, never a fixture-only parameter added to production code. Confirmed by `select count(*) from organizations where slug like 'boot-rehearsal%'` returning `0`.
- **`scripts/test-rls.sql` was re-run after this cleanup, not before** — the first post-rehearsal run genuinely **FAILED** one assertion (`Ruling 7 (coverage, on a freshly seeded database): one OPEN canonical row per organization … expected 17, got 15`) because the two leftover rehearsal orgs shifted a global row count, the same residue class Batch B's own commands log names for its own scratch orgs. After cleanup, the full suite passes again: **639 passes, 0 failures, exit 0.** This is recorded here so nobody mistakes a future stray-org residue for a real regression in §44 or elsewhere — it is a global count assertion unrelated to this pipeline's own section.
- The dev server (port 3400) was stopped by PID before finishing. The gitignored `scratch/` directory (the rehearsal driver scripts and the cleanup script) was deleted; nothing under it was ever committed.
- **`git status --short` at the end of this batch** shows exactly: `docs/testing.md`, `scripts/seed-dev.sql`, `scripts/test-rls.sql` (Batch A's), `src/app/(admin)/admin/organizations/[id]/actions.ts` + `.test.ts`, `src/lib/audit.ts` + `.test.ts` (Batch B's), `src/lib/founding-administrator.ts` + `.test.ts` (Batch B's), `src/app/(admin)/admin/organizations/[id]/page.tsx` (Batch C's modification), plus the four new Batch C files and this work-log.

### Proposed for the Orchestrator to Apply at Integration (not edited on this branch)

- **A new finding** (next number after F117) for `docs/schema-design-2.md` §2m or a new subsection, capturing the "no second person is reachable" discovery above — its own paragraph, distinct from F111, because F111's own text ("the concrete casualty is `staff.manage`") undersold the consequence discovered here.
- **`docs/TODO.md`**: in addition to Batch A/B's proposed lines, add one more: *"Founding-administrator bundle cannot create a second person (no `roll.propose`, `staff.manage` unreachable per F111) — a freshly designated org's admin can manage roles/features/tickets for themselves but cannot onboard anyone else. Needs a Phase 2/3 ruling: add `roll.propose` to the bundle, or build a `people.manage`-gated staff-kind-anchor creation path. Discovered during the mandatory browser rehearsal, `2026-09-28-founding-administrator` Batch C."**
- This is flagged as a **candidate Phase 5 BLOCKED or Phase 6 NEEDS REWORK trigger** for QA/analyst to weigh — I did not decide this myself (that call belongs to Phase 5/6), but it would be dishonest to omit the possibility given the task explicitly called step 6 "the non-negotiable self-sufficiency proof" and it did not, in fact, succeed as specified.

### What a Reviewer Should Click Through

1. `/admin/organizations/new` → create any org → land on `/admin/organizations/<id>` and see the blue "Founding administrator" section rendered first, above "Current brand."
2. Type an email with no matching account → see the `no_such_user` copy, including the "sign up first" instruction, inline (not just a toast).
3. Type `founding.fixture@example.invalid` (after resetting it — see above) → open the confirm dialog → verify it names the organization, the email, every permission key, and the office template (if the org type has one).
4. Confirm → the section collapses to a read-only line naming the holder count.
5. Attempt a second designation on the same org → refused with the `has_holders` copy.
6. Resize to 360px and confirm both states render without overflow.
7. **Do not expect to be able to add a second person as the newly designated founding administrator** — this is the discovered gap above, not a QA setup mistake.

### New Copy Strings for a Fork's Branding Pass

All of `founding-administrator-section.tsx`'s user-facing strings are new: the section heading "Founding administrator," the headline sentence, the collapsed-state sentence, the email label, the "sign up first" hint, the `AlertDialog` title/description template, and the button labels ("Designate founding administrator" / "Yes, designate"). None of Batch B's `PolicyResult.error` strings were touched (Batch C renders them verbatim, per contract).

### UX Tradeoffs

- **No permission-summary API from `@/lib/founding-administrator`** — the client component keeps its own `PERMISSION_LABELS` lookup rather than importing the plan function, to avoid pulling `@/lib/db` into the client bundle. This is a small, deliberate duplication (permission keys ↔ human labels) that will drift silently if a future pipeline adds a key to the bundle without updating this file's lookup table (it currently falls back to rendering the raw key verbatim, which is ugly but never wrong). Named here for whoever touches the bundle next.
- **The confirm dialog does not enumerate the office template's own permission keys** (e.g., what `Presbytery Stated Clerk` itself grants) — only its name. Doing so would require either exporting the office template's permission set from `page.tsx` (a small addition) or a second DB read this batch didn't have contract permission to add. Left as a smaller, lower-stakes gap than the second-person one above.

**Batch C complete. Phase 4 complete. Phase 5 (qa) next.**

---

### Orchestrator note (2026-09-28, after Batch C)

Batch C's rehearsal step 6 (grant a role to a second person — the non-negotiable self-sufficiency proof) **failed for a design reason**: the bundle carries `people.manage` but every person-creation path requires either `roll.propose` (the member wizard) or `staff.manage` (the staff-hire path with `rollAction: none`), and Phase 2 Ruling 3 excluded both. Phase 2 itself assumed the founding administrator "enrols people as staff-kind anchors" — which needs the very permission F111 declared unreachable. Per the loop-back rule (return to the earliest phase where the failure originated) this is a **Phase 2 addendum**, not a Phase 4 fix; Phase 5 waits. Batch C's proposed finding is numbered **F118**.

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-05
**Verified by:** qa

*Recorded verbatim by the orchestrator, 2026-10-05.*

*Worktree `/Users/cshenso/git/presby-platform/presby-wt-boot`, branch `pipeline/founding-admin`, merge-base `4461a46`. Neon branch confirmed from the database itself: `select current_setting('neon.branch_id', true)` returned `br-empty-frost-ax4mo8q5` as both `neondb_owner` (`PLATFORM_DATABASE_URL`) and `presby_app` (`APP_DATABASE_URL`). `env | grep DATABASE_URL` was empty before every DB command (rc=1). `db:push` and `ALTER ROLE` were never run. Nothing was committed, pushed or stashed. No tracked file was edited. The only writes were throwaway scripts in the gitignored `scratch/` folder (deleted at the end) and a temporary byte-copy mutation of two untracked files for the regression check, restored and proven identical by `shasum`.*

**Scope check.** `git diff $(git merge-base HEAD main) --stat` shows 8 modified files and 697 insertions. `git status` adds the 6 new files, for 14 in total. There are no route handlers (no `route.ts` changed or added) and no migration (0054 was withheld, per Batch A).

## Type Check

`npm run typecheck` (tsc --noEmit): **PASS** (exit 0)
`npm run lint` (eslint --max-warnings=0): **PASS** (exit 0)
`npm run check`: **PASS** (exit 0). All five tripwires passed: check:audit ("Audit-coverage check passed."), check:sql-date, check:deps-drift, check:brand-scope, check:secrets.

## Unit Tests

**CI mode, `npm test` (no DATABASE_URL):** Test Files 262 passed, 34 skipped (296). Tests 3412 passed, 914 skipped (4326). Duration 13.65s. Exit 0.
- The 914 skips are the DB-gated `describe.skipIf(!hasDb)` suites, and every one of them runs in the DB-backed pass below. They are not unexercised.
- The "eight paths unchanged" mechanical test is not DB-gated. It ran and passed in CI mode (confirmed in verbose output).

**DB-backed, `npx dotenv-cli -e .env.local -- npx vitest run --no-file-parallelism`:**
Total: 4326 | Passed: 4326 | Failed: 0 | Skipped: 0 | Duration: 442.41s. Test Files 296/296. Exit 0.
Failures: none.

**`scripts/test-rls.sql`** (`psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql`, as `presby_app`, run AFTER rehearsal cleanup): **exit 0, 0 failures.**
- Counted two ways. `grep -c 'NOTICE:  pass'` gives **639**, which is the real assertion count. `grep -c pass` gives 640, because it also counts the closing banner line. `grep -cE 'FAIL|ERROR'` gives 0.
- Both F118 assertions are present as passes:
  - `test-rls.sql:8026` — "44a (i): every key of the administration half resolves … eight keys (8)"
  - `test-rls.sql:8036` — "44a (F118): the founding administrator anchors staff-kind people (staff.manage) but neither proposes nor approves a roll action (1)"
- This matches the fix pass's record exactly.

## End-to-End Tests

**Scope.** No auth-touching paths are in the diff (`src/auth.ts`, `(auth)/`, `api/auth/` and `src/lib/auth/` are untouched), so the stricter MFA gate does not apply. `RATE_LIMIT_DISABLED=true` is set in `.env.local`.

**Run.** `E2E_BASE_URL=http://localhost:3400 npx playwright test` against my dev server.
Total: 129 | Passed: 121 | Failed: 3 | Did not run: 5 (aborted by a `describe.serial` after the failure) | Duration: 2.8m.

Failures, all reproduced deterministically on an isolated re-run and **none caused by this diff**:
1. `e2e/post-login-routing.spec.ts:110` (case 4). Expects `heading "Wrenfield Presbyterian Church"` on `/o/e2e-alpha`. Routing assertions pass; only the content assertion fails.
2. `e2e/post-login-routing.spec.ts:166` (case 7). Expects text `/you're in/i`.
3. `e2e/public-sites.spec.ts:334` (case 2). Expects an h1 "Alder Creek — E2E Public Sites Test Content". Cases 3–7 then did not run.

**Why these are pre-existing.** Both specs are rotted at this branch's merge-base. `main` has already fixed them in `9957bc2` (presbytery-e2e pipeline): `git diff 4461a46 main -- e2e/post-login-routing.spec.ts e2e/public-sites.spec.ts` shows the "ROT FIX" switch to `getByTestId("greeting-band")` (the v2 portal home no longer renders the org-name `<h1>` or the old "you're in" text) and F114's site-kit v4 block-shape restage. This pipeline's diff touches no file under `(org)/o/[slug]/page.tsx`, `(member)`, `/launch` or `(public)/site`.

**Phase 3's named blast radius passed in full.** All 13 tests across `admin-organizations.spec.ts` and `admin-organizations-create.spec.ts` passed. That includes the `/admin/organizations/[id]` detail, brand, profile and service-times specs (now rendering below the new section) and "admin creates a congregation and lands on its detail page".

**Integration note.** Merge or rebase onto current `main` before integration so these three specs carry main's fix.

## Regression Tests Added

- `foundingAdministratorPlan()` plan-shape tests, `src/lib/founding-administrator.test.ts:254`, `:266`, `:274` (it.each over synod/GA/NWC), `:285`. Guards against F118: `staff.manage` missing from the bundle, and roll/tier-3 keys creeping in.
- Confirm dialog names "staff", never the raw key, `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.test.tsx:148` (assertions at `:168-169`). Guards against `PERMISSION_LABELS` drift (addendum observation 7).
- "Two Hierarchies — eight paths unchanged", `src/lib/founding-administrator.test.ts:54/83`. Guards the mechanical unchanged-files ruling.
- `person_elsewhere` (F108), `:645`; `membership_ended`, `:679`; `has_holders`, `:707`; recovery reuse-and-reactivate (F109), `:934`; lock-generalization discovery (F117), `:844`. These carry Batch B's failing-first evidence.
- `test-rls.sql` §44a assertions at `:8026` and `:8036` (Edits C and E).

**Regression discipline, re-confirmed by me rather than taken from the record:**
- I byte-copied `src/lib/founding-administrator.ts` and `founding-administrator-section.tsx` to the scratchpad, removed `"staff.manage",` from `base` and `"staff.manage": "staff",` from `PERMISSION_LABELS`, and ran the tests:
  - Plan tests: **5 failed | 1 passed | 21 skipped (27)** — congregation, presbytery, synod, general_assembly, new_worshiping_community.
  - Section tests: **1 failed | 17 passed (18)** — "names the actual permission list and the office template", `AssertionError: expected 'Founding administratorThis organizati…' not to match /staff\.manage/i`.
- I then restored both files from the copies. `shasum` matches the pre-mutation hashes ("RESTORED byte-identical"), and the section suite went back to 18/18. Both files are untracked, so the hash check is the restoration proof; `git status` for them is unchanged (`??`).
- For the earlier batches' refusal branches I am relying on Batch B's recorded mutant table.

**Non-blocking observations:**
- None of these test names carry the `— regression for [bug]` suffix the qa conventions ask for.
- `actions.test.ts:1227/1248` adds `staff.manage` to a **mocked** result's `permissionKeys`. That echoes the mock and guards nothing about the bundle. The real guards are the plan tests and §44a.

## Coverage on Critical Modules

Measured with `vitest run --coverage` (v8), scoped per module:
- `src/lib/founding-administrator.ts` (DB-backed run): **90.56% statements, 81.08% branches, 100% functions, 92.07% lines** (96/106, 60/74, 15/15, 93/101). Uncovered lines are in the catch block (`:650-672`): the `membership_ended` trigger backstop and the `race`/`isUniqueViolation` arm. Both are documented as unreachable through a normal writer (F117).
- `src/app/(admin)/admin/organizations/[id]/actions.ts`: **97.97% statements, 88.2% branches, 100% functions.**
- `founding-administrator-section.tsx`: **91.66% statements, 85.71% branches, 100% functions, 100% lines.**
- `[id]/page.tsx`: 74.19% statements. Its uncovered lines are pre-existing brand/logo paths, not the founding-administrator wiring, which `page.test.tsx` pins.
- `[id]` directory overall: 89.03% statements.
- `permissions.ts`, `two-factor.ts` and `flags.ts` are untouched by this pipeline. I did not re-measure them; that belongs to the test-coverage review.

## Feature-Gate Audit

Verified by reading the code, not inferred from green tests.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `designateFoundingAdministratorAction` (`"use server"`, `src/app/(admin)/admin/organizations/[id]/actions.ts`, appended block after `:674`) | yes — `const session = await auth(); if (!session?.user) return Unauthorized` | yes — `hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)`, then "Forbidden.", checked before any input parsing or DB call | `FEATURES.ADMIN_ORGANIZATIONS` |
| `GET /admin/organizations/[id]` (`page.tsx`, Server Component) | yes — `auth()` | yes — `hasFeature(session?.user?.features, FEATURES.ADMIN_ORGANIZATIONS)`, renders a permission-denied card otherwise. The gate inputs (`countFoundingAdministratorHolders()`, `foundingAdministratorPlan()`) are computed only after that check, the UUID check and `notFound()`, and are read fresh every render. `canDesignate = holderCount === 0` is display-only; the action's transaction re-checks the gate under `for update`. | `FEATURES.ADMIN_ORGANIZATIONS` |
| Route handlers (`src/app/api/**/route.ts`) | n/a | n/a | No route handlers added or changed |

The `proxy.ts` edge gate on `(admin)` complements the handler checks and is not relied on. `src/lib/permissions.ts` is unchanged. The action also normalizes and validates its inputs: `UUID_RE` on `organizationId` and zod `trim().toLowerCase().email().max(320)` on the email. On a refusal it writes no audit row and does not call `revalidatePath`.

**Schema/RLS audit (live catalog).** No migration shipped, but the act writes five tenant tables on `getPlatformDb()`.

Catalog facts:
- `neondb_owner` has `rolbypassrls = t`; `presby_app` has `f`.
- `people`, `memberships`, `app_roles`, `app_role_permissions`, `role_grants` and `group_memberships` all have `relrowsecurity = t` and `relforcerowsecurity = t`.
- Triggers, read from `pg_trigger`:

| Trigger | `prosecdef` | Enabled |
|---|---|---|
| `memberships_guard_insert` | t | O |
| `people_guard_delete` | t | O |
| `memberships_sync_derived_group` | f | O |
| `memberships_guard_end` | f | O |
| `role_grants_needs_membership` | f | O |
| `group_memberships_reject_derived` | f | O |

- Grants (`aclexplode`): `neondb_owner` holds full DML on `memberships`, `people`, `role_grants` and `app_roles`.

Probes:
- **A designee who already belongs to another org is refused by the `memberships_guard_insert` trigger (SECURITY DEFINER).** On the platform connection (`neondb_owner`, `app.current_org_id` empty), I tried `insert into memberships` for live person `c0000000-…0001` (member at `22222222-…`) into org `33333333-…`, inside a transaction I rolled back. It failed with `ERROR: 42501: memberships: person … already exists elsewhere; link through presby_claim_person()`, `CONTEXT: PL/pgSQL function presby_guard_membership_insert() line 11 at RAISE`. The function has `prosecdef = t` and `search_path=public, pg_temp`. The grant did not refuse it (the owner holds INSERT) and RLS did not refuse it (the role bypasses RLS); the trigger did. The person still has exactly 1 membership afterwards.
  - The UI-level counterpart was also confirmed live: designating the already-consumed fixture onto a second zero-holder org returned the `person_elsewhere` copy inline and left the form in place. That refusal comes from the TypeScript pre-check, with the trigger as the backstop.
- **`presby_app` cannot read another org's designation rows (RLS).** With the rehearsal presbytery `53c16244-…` designated and before cleanup:

| Context (as `presby_app`) | `app_roles` | `app_role_permissions` | `role_grants` | `memberships` | linked `people` |
|---|---|---|---|---|---|
| No context set | 0 | — | 0 | 0 | 0 |
| `app.current_org_id` = bramblewood | 0 | 0 | 0 | 0 | 0 |
| Own org (positive control) | 3 | — | 4 | 2 | 1 |

  The positive control shows the zeros are not vacuous; RLS is the filtering layer.
- **The platform connection never sets `app.current_org_id`.** `grep set_config|current_org` finds only a doc comment in `src/lib/founding-administrator.ts:268` stating the prohibition, and nothing in `getPlatformDb()` (`src/lib/db/index.ts:81-88`). The module never imports `withOrgContext`.
- **Unchanged-files test.** `git diff $(git merge-base HEAD main) --name-only` over `src/lib/authz.ts`, `src/lib/role-definitions.ts`, `src/lib/role-grants.ts`, `drizzle/0010*`, `src/lib/people.ts`, `src/lib/staff.ts`, `src/app/(org)/o/[slug]/admin/members` and `src/app/(org)/o/[slug]/admin/staff` returns **0 files**. There are no untracked files under those paths, and `main` has not touched them since the merge-base either (`git diff 4461a46 main` on the same paths is empty), so the in-repo test that diffs against `main` is sound today.

**Mandatory browser rehearsal.** Playwright-driven against the dev server on port 3400 (started backgrounded with a pidfile, stopped by PID). I used `waitForURL` after clicks, never `networkidle`.

Preconditions, checked with psql before starting:
- `org_portal.members_create = true`, `org_portal.roles = true`, `org_portal.staff = true`. No flip was needed.
- The fixture `founding.fixture@example.invalid` (`e0000000-…00f5`) had 0 `people` rows, `is_active t`, 2FA off.
- 15 orgs in total. 0 leftover `founding-admin-test%` orgs once the DB suite's `afterAll` had run.

| Step | Result | Evidence |
|---|---|---|
| 1. Create org through `/admin/organizations/new` | PASS | `QA5 Rehearsal Presbytery`, slug `qa5-rehearsal-6twevd`, id `53c16244-a5e6-4c29-8a92-410c5eaaf513`. Landed on the detail page. h2 order: `FOUNDING ADMINISTRATOR`, `CURRENT BRAND`, … — the section renders first. |
| 2. Designate the fixture | PASS | An unknown email first rendered the `no_such_user` "sign up first" copy inline. Then I designated the fixture through the real confirm dialog. After reload the section showed the collapsed line. The audit row `org.founding_administrator.designated` has `mode=created_person`, no `email` key, and `permissionKeys` with the 9 administration keys + 3 office keys. |
| 3–4. Sign in as the designee; `/launch` routing | PASS | Landed directly on `/o/qa5-rehearsal-6twevd` (single enterable org). |
| 5. Roles reached by clicking | PASS | Clicked "Administration", reaching `/o/…/admin`, then "Roles", reaching `/o/…/admin/roles`. |
| 6 / obs 1 | PASS | `org_portal.staff = true` (psql above) |
| 6 / obs 2 | PASS | The Staff tile is visible on the portal home; clicking it went to `/o/…/admin/staff`. |
| 6 / obs 3 | PASS | "Can't find them? Add a new person" is visible. I created "Qastaff Rehearsal"; the staff person select now lists `["Fixture Founding Admin","Qastaff Rehearsal"]`. |
| 6 / obs 4 (SQL) | PASS | Both people at the org have `engagement_status = staff` and `current_roll` null. `roll_actions` count is 0 for each, and 0 for the whole org. The second person has no user link. |
| 6 / obs 5 | PASS | Grant-person options: `["Fixture Founding Admin","Qastaff Rehearsal"]`. Roles offered: `["Founding Administrator","Member","Stated Clerk"]`. I granted Member to Qastaff and the grants list shows it. In SQL, `role_grants`: Fixture→`founding_administrator` (custom, unprotected), Fixture→`presbytery_stated_clerk` (custom, unprotected), Qastaff→`member`, all open. |
| 6 / obs 6 | PASS (refusal is the expected result) | As the designee I first turned on the per-org "Add & approve members" switch at `/o/…/admin/features` (`aria-checked` went false→true, using the designee's own `org_features.manage`). Then I took the member wizard through all six steps (roll kinds offered: "Profession of faith", "Enrolled as a participant"). Submitting produced the toast **"You don't have permission to add members here."** (screenshot). `Wizard Qaattempt` people rows: 0; `roll_actions` at the org: 0. |
| 6 / obs 7 | PASS | Dialog text: "…manage people, roles, role assignments, groups, officers, feature toggles, support tickets, **staff**, and congregation oversight, plus this organization's constitutional Presbytery Stated Clerk office…". Names staff: true; raw `staff.manage` present: false. On the congregation org the dialog omits oversight and names the Congregation Stated Clerk office. |
| 7. Re-designation refused | PASS | Back as the platform admin, the section reads "This organization already has one person who can manage roles — a founding administrator has already been designated. Grant or revoke roles from the organization's own Roles page instead." The designate form count is 0. The role-permission sets in SQL match the plan: `founding_administrator` has the 9 keys including `staff.manage` and `congregation_oversight.manage`; `presbytery_stated_clerk` has `credentials.manage`, `per_capita.manage`, `statistics.manage`. |
| 8. 360px | PASS with one note | Collapsed state: scrollWidth/clientWidth 360/360. Expanded state (second org, `qa5-rehearsal-m-…`): 360/360, full-width input, the dialog fits (311.6px wide), and every section below renders. **Note:** the "Designate founding administrator" button measures **36px tall**, not the ≥44px `docs/ui-standards.md:644` asks for on a primary action (`founding-administrator-section.tsx:197-199` has no `min-h-11`). Batch C's write-up claimed 44px. This is non-blocking and has no functional effect; I am handing it to Phase 6. |

**Cleanup.** I ran a one-off script on the platform connection inside a single transaction:
1. Stamped `deletable_until` on both `qa5-rehearsal%` orgs.
2. Ran `alter table group_memberships disable trigger group_memberships_reject_derived`.
3. Deleted the 2 orgs.
4. Re-enabled the trigger.
5. Stamped `deletable_until` on the 2 people (`people_guard_delete` fires for the owner too) and deleted them.

Afterwards:
- `select count(*) from organizations where slug like 'qa5-rehearsal%'` = **0**
- Fixture `people` rows = **0** (ready for the next consumer)
- Stray Qastaff/Wizard people = 0
- `group_memberships_reject_derived` has `tgenabled = O`
- Total orgs = 15

The dev server was stopped by `kill $(cat pidfile)`; nothing is listening on 3400 and no stray processes remain. `scratch/` is deleted. The audit row for the deleted org remains (append-only), as in the fix pass. `test-rls.sql` was run after all of this (results above).

## Verdict

**PASS**

Every required check is green or accounted for:
- Typecheck, lint and all five tripwires pass.
- CI unit tests: 3412 passed. DB-backed suite: 4326/4326 with 0 skipped.
- `test-rls.sql`: 639 real pass assertions, 0 failures, exit 0.
- Feature gates confirmed by reading the action body and the page.
- Live-catalog probes name the refusing layers: the `memberships_guard_insert` trigger for a person who belongs elsewhere, RLS for cross-org reads by `presby_app`.
- The eight-path unchanged-files test is empty against the merge-base and against current `main`.
- I re-ran the F118 regression evidence myself by mutation (5 plan failures and 1 dialog failure, then restored byte-identical).
- The mandatory rehearsal's eight steps and all seven addendum observations pass, with SQL evidence.

The three e2e failures are spec rot at the merge-base, already fixed on `main` in `9957bc2`, on surfaces this diff does not touch. They are not a regression; integration should land on current `main`.

**Residual weighed, as instructed:** a congregation's founding administrator still cannot enrol a roll member (`roll.propose`/`roll.approve` are unreachable under F111/F118). The rehearsal confirmed this from both sides: the member wizard refuses and 0 `roll_actions` were written. The presbytery handover itself is complete. The designee reached Roles, Staff, Features and Administration unaided, created a second person and delegated a role to them, and the bundle carries `congregation_oversight.manage` plus the presbytery office. PSV is not blocked. I classify this residual as a **Phase 6 SHIP WITH NOTES item, not a Phase 5 FAIL.**

**Notes for Phase 6:**
1. The F111/F118 congregation roll residual above.
2. `org_portal.staff` is seeded OFF in `scripts/seed.ts` but is the only person-creation path. It is ON on this branch; it must be ON before PSV onboarding.
3. The designate button is 36px tall, below the 44px touch-target standard (`founding-administrator-section.tsx:197`).
4. The second person created through the staff path cannot sign in; that needs the invitation system (Flow 2), and Phase 6 should not claim otherwise.
5. Regression test names lack the "— regression for" suffix, and the `actions.test.ts` `permissionKeys` assertion is a mock echo, not a bundle guard.
6. Merge onto current `main` (e2e rot fix, and main has advanced past the merge-base).

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete. Typecheck/lint/check clean. `npm test` 3412 passed (914 DB-gated skips, all run in the DB pass). DB-backed 4326/4326, 0 skipped. `test-rls.sql` 639 `NOTICE: pass` (640 by `grep -c pass`), 0 failures, run after cleanup. e2e 121/129: 3 pre-existing merge-base spec-rot failures already fixed on main `9957bc2`, 5 serial aborts, all 13 Phase-3 blast-radius specs green. F118 regression re-proven by mutation (5+1 fail, restored byte-identical). Gate audit clean (`ADMIN_ORGANIZATIONS`, no route handlers). Live probes: `memberships_guard_insert` (SECURITY DEFINER trigger) refuses a person who belongs elsewhere on the BYPASSRLS connection; RLS hides designation rows from another org's `presby_app` context; no `set_config` on the platform connection; eight protected paths unchanged. Rehearsal 8/8 steps and 7/7 observations with SQL evidence. Coverage: `founding-administrator.ts` 90.6% statements. Cleanup verified (0 qa5 orgs, fixture back to 0 people, trigger `O`). | PASS | 2026-10-05 |

### Handoff

**Next: analyst, Phase 6 (shipped vs intent).** Weigh the F111/F118 congregation-roll residual as SHIP WITH NOTES, plus notes 2–6 above. The fixture `founding.fixture@example.invalid` is back at 0 `people` rows and the branch is clean (15 orgs).

### Orchestrator note (2026-10-05, after Phase 5)

QA note 3 (the designate button at 36px, below the 44px touch-target floor in `docs/ui-standards.md`) is a one-token Polish defect inside this pipeline's own new file and was corrected by the orchestrator before Phase 6 rather than carried as a follow-up: `className="mt-4 min-h-[44px]"` on the trigger `<Button>` in `founding-administrator-section.tsx` (the exact form the standard prescribes for a primary action). The section's 18 unit tests re-run green; Batch C's "44px" claim in its step-8 write-up was wrong and stands corrected by QA's measurement. Notes 1, 2, 4, 5 and 6 are handed to Phase 6 as written.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-10-05
**Reviewed by:** analyst

*Recorded verbatim by the orchestrator, 2026-10-05. Read-only: the analyst read the code, the work-log in full and the three Phase 6 inputs; no edits, no queries.*

## VERDICT

**SHIP WITH NOTES.** Every note below becomes a tracked `docs/TODO.md` line. There is no code defect and no rework. The presbytery handover works end to end in code, and QA's rehearsal confirmed it. The notes are operational gaps, one residual and some small polish.

## ONE-LINE TAKE

> A platform admin can now hand a freshly created presbytery to its first real administrator in one audited step. That person can create a second (staff-kind) person and delegate roles unaided. A congregation still cannot enrol a single roll member, and a second person still cannot sign in.

## What's Working

- **The primary branch.** `src/lib/founding-administrator.ts` runs one `getPlatformDb()` transaction in the order Phase 2 bound it.
  - The lock on the organizations row comes first, then the holder-count gate, then the user and person lookup.
  - It then writes person, staff-style membership (no `roll_actions` row), the `founding_administrator` role, the office-template copy, and the grants.
  - There is no `set_config` call on the platform connection.
  - The unchanged-files test covers `authz.ts`, `role-definitions.ts`, `role-grants.ts`, `drizzle/0010`, and now also `people.ts`, `staff.ts` and the members and staff surfaces.
- **The gate is also the recovery path.** Designation is refused while anyone holds `roles.manage` or `role_grants.manage`, and re-enabled at zero holders. `upsertAppRole` reuses and reactivates existing roles (F109). Permission reconcile is additive-only, so recovery never claws back what the org later added.
- **Gate ordering limits enumeration.** `has_holders` is checked before the email lookup, so an org that already has a holder never reveals whether an email has an account.
- **Refusal copy is human and inline.** All nine result variants map to plain sentences, and the section renders them in a banner as well as a toast.
  - The confirm step is an `AlertDialog` that lists the permissions in plain words and names the office template.
  - The F118 `PERMISSION_LABELS` entry is present, so the dialog says "staff" and never `staff.manage`.
  - The sign-up-first hint sits under the email field.
  - The button now has `min-h-[44px]`.
- **Audit.** `org.founding_administrator.designated` is written only on success and records ids, mode, role keys, `permissionKeys` and `priorHolderCount`. It records no email. A refusal writes nothing, which is correct. A revocation rides the existing `TENANT_ROLE_REVOKED`.
- **Permissions and flags.** There is no new `FEATURES` key; `ADMIN_ORGANIZATIONS` gates the action and the action checks `auth()` and `hasFeature()`. There is no new flag. `permissions.ts` is untouched.
- **Fixtures and tests.** The `founding.fixture@example.invalid` seed user has no `people` row. `test-rls.sql` §44 is appended and delimited. `docs/testing.md` documents that the fixture is single-use. QA reports 90.6% statement coverage on the new module, and the F118 mutation re-proof showed 5 plan failures and 1 dialog failure.

## Intent-vs-Shipped Diff

- **Verbs and surface.** Phase 1 said a platform admin designates on `/admin/organizations/[id]` and the designee lands at `/o/<slug>`. Shipped: matches. The create-org action redirects to the detail page (`create-organization-form.tsx:51`), and the section renders first and prominently.
- **Flow 1 and Flow 4 (create vs retrofit).** Phase 1 said both shapes ship. Shipped as one email field; the database picks `created_person` or `existing_person`. Matches, and cleaner than a toggle.
- **Flow 2 (invite with no account).** Phase 1 said defer. Shipped: deferred, and the two-step copy ("sign up first, you'll land on a page saying you have no organizations") appears on the form. The `/no-organization` page is the only landing the new user sees. The invitation system has no TODO line yet, so it needs one (Follow-Up 6).
- **G1 (no bypass).** Shipped as "inapplicable, not bypassed". Matches.
- **G2 (bundle).** Phase 1 said a time-boxed bundle. Shipped: an unprotected, custom `founding_administrator` role plus the office copy. This is acceptable drift and an improvement. `staff.manage` was added by F118.
- **G3 (`people.user_id` link).** Phase 1 said no in-app link existed. Shipped: the link is built, but the F110 unique index (`0054`) was withheld (F112), because the committed `router.dup@` fixture is a duplicate that blocks it. Acceptable drift, because the `memberships_guard_insert` trigger plus the pre-check cover it. The follow-up is not yet a TODO line.
- **G4 and G5.** Existing users only, and both write shapes. Matches.
- **G6 (one-time gate and recovery).** Matches. The audit does not mark a recovery designation as such (see Edge Cases).
- **G7 (Two Hierarchies).** Matches, and is mechanically tested.
- **G8 (mechanism).** `getPlatformDb()`. Matches.
- **G9 (roll status).** Staff-style membership, no roll action. Matches.
- **G10 (empty state).** Phase 1 asked for actionable empty-roles copy and for what a designee at a synod, general assembly or new worshiping community sees when the template list is legitimately empty. **Silently missing.** No empty-state copy for that case in `role-catalog-list.tsx` or `roles-list.tsx`, and the work-log has no deferral of G10 after Phase 1. It does not affect PSV or a congregation. Tracked as Follow-Up 7.
- **G11 (atomicity).** One transaction. Matches.
- **G12 (360px).** Rehearsal step 8 passed on both section states. Matches.
- **The F118 outcome.** A designee can create a staff-kind second person and delegate a role. The member wizard still refuses with "You don't have permission to add members here" and writes 0 `roll_actions`. That refusal is the intended result, because `roll.propose` and `roll.approve` stay out of the bundle.
- **What the handover delivers, plainly.**
  - A presbytery handover is complete. The designee holds the stated-clerk office (credentials, per-capita, statistics) and `congregation_oversight.manage`. Together with roles, role assignments, groups, officers, feature toggles, tickets and staff, that covers every wave-5 surface. PSV is not blocked by permissions.
  - A congregation handover is not complete. The roll residual (F111/F118): no organization can ever hold `roll.propose` or `roll.approve`, so a congregation's administrator can stand it up, hire staff-kind anchors and delegate roles, but cannot enrol one member. That blocks the first congregation go-live and does not block PSV.
  - The staff-kind second person has no login, because Flow 2 is not built. The release must not claim a usable second sign-in.

## Edge Cases

- **Empty state: pass for the platform admin, with a gap for the designee.**
  - The platform section has helpful empty copy.
  - The collapsed state is accurate in count but wrong in cause. It says "a founding administrator has already been designated" for any org with a holder, including ones seeded or granted by other means. The wording should be "already has N people who can manage roles."
  - The tenant-side empty template list for synod, general assembly and new worshiping community orgs is not handled (G10).
- **Failure microcopy: pass.**
  - Every variant is inline and human.
  - On enumeration: `no_such_user`, `user_inactive`, and `person_elsewhere` (which does not name the other org) differ deliberately. The caller is an `ADMIN_ORGANIZATIONS` holder, `has_holders` is checked first, and the code comment records this. Posture accepted.
  - One small defect: the error banner uses `role="status"` where an error wants `role="alert"`.
  - The success banner is effectively dead, because revalidation swaps in the collapsed state. The toast carries the success message, which is fine.
- **Permission gate: pass.** `auth()` then `hasFeature(ADMIN_ORGANIZATIONS)` then UUID and zod validation. The holder gate is re-checked inside the transaction under `for update`, never trusted from the page.
- **Audit event: pass, with one gap.** There is no email in the metadata. `priorHolderCount` is hard-coded to 0 and there is no recovery marker, so a first designation and a lockout-recovery designation look identical in the log. Also, `recordAudit` runs after commit with swallow-and-log, so an audit failure leaves a designation with no audit row. That matches the existing platform-action pattern, so it is noted, not blocking.
- **Mobile (360px): pass.** QA and rehearsal step 8 confirmed it, and the 44px defect was fixed.
- **Permissions vs flags: pass in code, fail on operational documentation.**
  - The code adds no flag and no `FEATURES` key.
  - The handoff silently depends on tenant portal flags being on, and **`scripts/seed.ts` seeds them OFF**: `org_portal.roles`, `.staff`, `.features`, `.groups`, `.officers`, `.tickets` and `.home_v2`. `members_create` is also off and does not matter, because the member wizard is refused regardless.
  - QA's note 2 named only `org_portal.staff`. The real dependency is wider. With the seed defaults, the designee lands on "Role administration isn't turned on" instead of a working portal. The dev branch works only because those flags were turned on by hand.
  - No document a PSV onboarding operator will see records this. `docs/testing.md` documents the fixture only, and the section hint and confirm dialog say nothing about it.
  - The existing TODO sweep line is a different sweep: it flips placeholder flags to off, not the product flags the handoff needs on.
  - The tenant-side per-org toggles (`isOrgFeatureEnabled`, default off) are the designee's to flip through `org_features.manage`.

## Follow-Ups (SHIP WITH NOTES)

1. **Flag dependency.** Document it, or flip the defaults, before PSV onboarding. Weighs QA note 2, wider than it described.
2. **Congregation roll residual** (QA note 1; F111/F118).
3. **Second person has no login.** This is the same invitation system as Follow-Up 6 (QA note 4); say so in the release note.
4. **Test hygiene** (QA note 5). Rename the regression tests with the "— regression for" suffix. The `actions.test.ts` `permissionKeys` assertion echoes the mock and does not guard the bundle, so point it at `foundingAdministratorPlan()`.
5. **Merge onto current `main`** (QA note 6). The e2e spec rot was fixed in `9957bc2`, `main` has advanced past merge-base `4461a46`, and the unchanged-files test should be re-run after the merge. *(Done at integration, 2026-10-05 — orchestrator.)*
6. **No-account designee path.** Build the invitation system (Flow 2 / G4). No TODO line exists yet.
7. **G10 empty state.** Roles-page copy for a designee whose org type has no template, plus actionable first-visit copy.
8. **F112.** Land the `people.user_id` unique index once the `router.dup@` fixture is reworked.
9. **Polish items, one line.** Collapsed-state copy reads "N people who can manage roles"; the error banner needs `role="alert"`; audit metadata needs a recovery marker; `deriveNameFromUser` splits on the first space where Phase 2 Ruling 6 said last space ("Mary Ann Smith" becomes first "Mary", last "Ann Smith") — align it or record a decision.
10. **Housekeeping at integration** (all already proposed by earlier phases): close the TODO line "Template-adoption bootstrap for `congregation_stated_clerk`"; apply F107–F112 and F117–F118 with F111's example marked retired; apply DECISION-155 and its amendment; update the functionality map (Rule 14); release notes.

## Red Flags (if NEEDS REWORK)

None.

## Workflow Rules

- **Rule 12.** The header has no "Source — member feedback" block, so there is no originating feedback row. Nothing to mark `done`.
- **Rule 13.** This is platform-admin tooling that tenants never see. No `whats_new_entries` post is owed now. One is owed at first presbytery onboarding, after the flag defaults land: "your portal is ready: roles, staff, features" for the new administrator, not for the platform admin. Added to `docs/TODO.md` "Owed what's-new posts" at integration.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete — the presbytery handover is delivered end to end (every wave-5 surface reachable, audited, gate and recovery confirmed); a congregation cannot enrol a roll member (F111/F118 residual); the designee-facing flag dependency is wider than QA noted (roles, staff, features, groups, officers, tickets and home_v2 are all seeded OFF) and is documented nowhere an operator will see; G10 was silently missing and is now tracked. Rule 12: no feedback row. Rule 13: a what's-new post is owed at first presbytery onboarding, not now. | SHIP WITH NOTES | 2026-10-05 |

## Plain-English summary for the release-note reviewer

This release lets a PresbyPortal platform administrator hand a newly created presbytery to its first real administrator through the product. Previously there was no way to do it. The administrator enters the person's email, after the person has signed up. The product creates the person's record at that organization and gives them what they need to run it: managing people, roles, groups and officers, turning features on, filing support tickets, managing staff, overseeing congregations, and the stated clerk's duties. The act is logged without the email address. It can be done only once per organization, and again only if the organization ever loses everyone who can manage roles. After that, the new administrator can add a staff member and give roles to others without the platform's help. The release does not deliver three things. First, a congregation's administrator still cannot add members to the roll, because that permission is not available to any organization yet; it blocks the first congregation going live and does not block PSV. Second, the second person the administrator adds cannot sign in, because inviting a person who has no account is not built. Third, the portal screens the new administrator needs are switched off in the default setup, so the operator must turn them on before onboarding PSV.

### Orchestrator note (2026-10-05, closing the pipeline)

SHIP WITH NOTES accepted. Integrated as **v0.29.0**: feature commit, merge of `origin/main` (QA note 6 / follow-up 5), then the housekeeping commit applying DECISION-155 + amendment, `docs/schema-design-2.md` §2m (F107–F112, F117–F118; F111's worked example marked retired), the `docs/TODO.md` reconciliation (every follow-up above as a line in its named section; the "Template-adoption bootstrap" line closed), the functionality map, `docs/architecture.md`'s one clause, and `docs/release-notes/v0.29.md`. The `org_portal.*` seed-default question is the first item of the wave-5 go-live flag sweep.

---

# Phase 2 addendum — F118 (architect)

*Recorded verbatim by the orchestrator, 2026-09-28.*

*Read-only review, 2026-09-28. Worktree `/Users/cshenso/git/presby-platform/presby-wt-boot` on `pipeline/founding-admin`; Neon branch `pipeline-founding-admin` (`br-empty-frost-ax4mo8q5`) queried read-only (`env | grep DATABASE_URL` empty before the run; nothing created, altered or dropped). No files written.*

## Verdict

**Needs revision — scoped to a Phase 4 fix in this pipeline. Phase 1 and Phase 3 are not reopened, and no new pipeline is opened.**

The feature's shape is right and the Phase 3 design stands. What is wrong is one item in my own Ruling 3: the bundle excluded `staff.manage` on a criterion that F111 had already falsified two paragraphs earlier in the same ruling, and Ruling 3's own justification sentence for the exclusion of the roll keys ("a founding administrator enrols people as `staff`-kind anchors") names a path the bundle does not reach. Batch C is right that this is load-bearing and right not to have worked around it. The correction is one key, and it is mine, not the implementer's.

**The ruling: `staff.manage` joins the bundle. `roll.propose` does not. `roll.approve` does not. No change to `src/lib/people.ts`.**

## Placement

- **Directory placement:** unchanged. No new file, no new module, no new directory. The fix lands in files this pipeline already owns.
  - `/Users/cshenso/git/presby-platform/presby-wt-boot/src/lib/founding-administrator.ts` — one string added to the `base` array (currently `src/lib/founding-administrator.ts:120-126`), plus the plan function's doc comment recording F118 and the amended criterion (i).
  - `/Users/cshenso/git/presby-platform/presby-wt-boot/src/app/(admin)/admin/organizations/[id]/founding-administrator-section.tsx` — one entry in `PERMISSION_LABELS` (`:36-45`): `"staff.manage": "staff"`. Batch C's own named drift risk ("will drift silently if a future pipeline adds a key to the bundle without updating this file's lookup table") is being realised on the first try; the implementer should treat the lookup as part of the bundle definition, not as decoration.
  - `/Users/cshenso/git/presby-platform/presby-wt-boot/scripts/test-rls.sql` §44a — the assertion edits in item (5) below. Inside this pipeline's own appended §44 block, which the kickoff permits.
  - Tests: `src/lib/founding-administrator.test.ts` (plan shape: congregation 7→8 admin keys, presbytery 8→9), the action tests' audit-metadata `permissionKeys` expectation, and the section/page component tests' confirm-dialog copy expectation.
- **Server vs Client split:** unchanged. `page.tsx` stays a Server Component computing the gate fresh; the section stays `'use client'` for `useActionState` only; the confirm remains an `AlertDialog`.
- **Dependencies:** none. No new dependency, no new `FEATURES.*` key (`src/lib/permissions.ts` stays untouched and frozen), no new `permissions` catalog row (`staff.manage` is an existing tier-1 key — verified on the live catalog, so DECISION-078 is satisfied trivially), no new audit key, **no migration** (0054 remains released back to the pool per Batch A).
- **Implementer:** one pass, `full-stack-developer` — it spans `src/lib` and one client string and owns the rehearsal re-run, and splitting ~2 production lines across two agents is pure overhead.

## Invariants Touched

| Invariant | How the amended bundle respects it |
|---|---|
| **No Role Carries a Wildcard** | The bundle goes from 7→8 tier-1 keys for a congregation (9 for a presbytery), plus the office copy. Still an enumerated, per-item-justified list; still zero tier-3 keys; still no tier-2 key outside the office template. Measured post-amendment, a congregation's ceiling is 10 of 25 catalog keys (8 administration + `statistics.publish` from the office copy + `directory.view` free via the baseline `member` group role), a presbytery's 13 of 25. Not `*`, and not `*` by enumeration. |
| **The Roll Is the System of Record** | Strengthened, not weakened. The whole point of choosing `staff.manage` over `roll.propose` is that the staff-anchor path (`createStaffPersonAction()` pins `rollAction: { kind: "none" }` server-side, `src/app/(org)/o/[slug]/admin/staff/actions.ts:250-260`) writes **no `roll_actions` row** and sets `engagementStatus: 'staff'`. The platform-designated administrator still cannot originate a roll fact. The roll begins when the Session is seated. |
| **The Court Is Not a Group** | Preserved. Proposing and approving both stay off the founding administrator. |
| **Two Hierarchies Intersect Nowhere** | Untouched. The mechanical test still holds and is still binding: `src/lib/authz.ts`, `src/lib/role-definitions.ts`, `src/lib/role-grants.ts` and `drizzle/0010` unchanged by this pipeline. **I am extending that list for the fix**: `src/lib/people.ts`, `src/lib/staff.ts`, `src/app/(org)/o/[slug]/admin/members/**` and `src/app/(org)/o/[slug]/admin/staff/**` are also unchanged. A diff touching any of them fails this addendum. |
| **Permissions vs Flags** | Unchanged and correctly split — but with a newly-visible operational dependency, see the flag note under item (4). A flag never grants access; it can still make the only granted path dark. |
| **Isolation Is a Database Property** | Untouched. Still `getPlatformDb()`, still no `set_config('app.current_org_id', …)` on the BYPASSRLS connection. |

## Notes

### (1) Which permission joins the bundle, and the principle applied explicitly

The Ruling 3 principle as written: *the org-type's constitutional office template, plus exactly those tier-1 permissions that (i) no constitutional template carries, (ii) no constitutional template ever will, (iii) standing the organization up requires.*

**`staff.manage` — joins the bundle.**

- **(i) — the criterion as literally worded fails, and the criterion is what is wrong, not the conclusion.** Verified on the live catalog: `personnel_admin` (constitutional, protected, org-type-neutral, `organization_type_scope` null) carries `staff.manage`, and it is the only template that does. But criterion (i)'s *purpose* is "don't bundle what the ordinary template route already delivers," and F111 — which I wrote two paragraphs above the criterion, in the same ruling — proves that **"carried by a template" and "deliverable to an organization" are different facts**: `adoptTemplate()` runs `assertPermissionSubset()` over the template's full set, so a template can only ever hand an org a set the adopter already holds. A template carrying a key nobody at the org holds delivers nothing, ever. **Criterion (i) must therefore read "no constitutional template can *deliver* it,"** and under that reading `staff.manage` satisfies it — which is precisely what F111's own sentence ("`personnel_admin` … is unreachable for every real organization, forever") already asserted. I did not carry that conclusion into the criterion; that is the defect.
- **(ii)** satisfied under the amended reading: no template ever will deliver it while the subset check stands, and only the F111 follow-on pipeline can change that.
- **(iii)** satisfied, and this is the whole of F118. `staff.manage` + `people.manage` together are the **only** in-app path that creates a person without writing a roll fact — the "staff-kind anchor" path Ruling 3's own exclusion sentence named as the alternative and then made unreachable. Without it, standing the organization up terminates at exactly one person.

A second, self-correcting consequence worth stating: once the founding administrator holds `staff.manage`, `personnel_admin` becomes genuinely adoptable through the ordinary product path (its set is now a subset of what the adopter holds). The amendment closes F111's own named concrete casualty rather than routing around it.

**`roll.propose` — does not join the bundle.** Asked to argue the polity line, here it is, and it cuts against inclusion on both the polity and the mechanical axis:

- **(i)** satisfied (no template carries `roll.propose` — verified).
- **(ii) fails.** Unlike `groups.manage`, where DECISION-110 found affirmatively that no PC(USA) office is its keeper, `roll.propose` has an obvious and probably correct future keeper: recording roll actions is the clerk of session's clerical work, and a congregation clerk-of-session template carrying `roll.propose` is a plausible product decision belonging to DECISION-110/115/119's line. Putting it permanently in a bootstrap bundle pre-empts that decision and is exactly the one-key-at-a-time accretion Ruling 3(d) refused.
- **(iii) fails.** Standing the organization up means getting a second person in and being able to delegate. The staff-anchor path does that. Running the roll is *operating* the organization.
- **The polity answer to the question as posed:** a founding administrator *proposing* a roll action is not, by itself, a Session act — a proposal awaiting approval is the clerical half, and in the abstract "a pending proposal awaiting approval" would be acceptable. It is not acceptable **here**, because under F111 `roll.approve` is carried by no template and would not be in the bundle, so every proposal a founding administrator made would be **permanently pending and unapprovable by anyone, forever**. That converts the acceptable case into a fabricated roll fact nobody can ratify — the identical reasoning Ruling 6 used to refuse writing a `roll_actions` row for the designee's own membership ("a pending roll action at an org with no seated Session is unapprovable by construction"). Granting `roll.propose` without `roll.approve` is incoherent; granting both to one person is the Session's act performed unilaterally by a platform-designated individual, which "The Roll Is the System of Record" and "The Court Is Not a Group" both forbid. Neither variant survives.

**Named residual, and it is not small.** With `staff.manage` added, a *presbytery* handover is complete — every wave-5 surface (credentials, oversight, per-capita, statistics, filings, roles, features, tickets, staff) is reachable, so PSV is unblocked. A *congregation* handover is not: `roll.propose` and `roll.approve` remain unreachable at every organization under F111, so a congregation's founding administrator can stand the org up, hire staff-kind anchors and delegate roles, but **cannot enrol a single member on the roll** — the congregation product's flagship function. That is F111's residual, not a defect this fix should paper over, and it is a go-live prerequisite for the first congregation (not for PSV). It belongs in the F111 follow-on pipeline's scope line and should be weighed by Phase 6 as a `SHIP WITH NOTES` item.

### (2) F111's characterisation and the DECISION-155 enumerated set both change

**F111's text changes.** Its concrete example (`staff.manage` / `personnel_admin` unreachable forever) is retired by this amendment and must be replaced, or F111 will read as false the day the fix lands. The finding itself — an organization's reachable permission set is closed at its first grant — is unchanged and remains true.

**F118, for `docs/schema-design-2.md` §2m (its own paragraph, distinct from F111, as Batch C asked):**

> **F118 — the founding-administrator bundle, as originally ruled, could not create a second person, and the sharp form of F111 is that the roll is unreachable.** `createPerson()` (`src/lib/people.ts:307-313`, DECISION-128 ruling 1 / DECISION-129) requires `people.manage` unconditionally and `roll.propose` additionally whenever `rollAction.kind !== "none"`. The member wizard offers only roll-bearing kinds (`profession_of_faith`, `other_participant_enrolled`) and rejects `"none"` at runtime by design (`src/app/(org)/o/[slug]/admin/members/new/actions.ts:91`); the only `"none"` caller is the staff-hire surface's inline "add a new person" affordance, which pins `rollAction: { kind: "none" }` server-side and gates on `staff.manage` **and** `people.manage` (`src/app/(org)/o/[slug]/admin/staff/actions.ts:238-260`). DECISION-155's original bundle carried `people.manage` but neither `roll.propose` (excluded by name) nor `staff.manage` (excluded because a template carries it) — so a freshly designated organization could manage roles, feature toggles and tickets for itself and onboard nobody, the exact opposite of the bootstrap gap DECISION-100/101/106 exist to close. Found by the mandatory browser rehearsal (Phase 4 Batch C, step 6), invisible to 4326 passing unit tests and to `test-rls.sql` §44, both of which asserted the bundle matched its specification — which it did; the specification was wrong. **Two structural lessons.** First, F111 makes "a template carries key K" and "an organization can ever hold key K" different facts, so any bundle criterion phrased in terms of what a template *carries* is unsound; the criterion is what a template can *deliver*, and DECISION-155's criterion (i) is amended accordingly. Second, the resolution is `staff.manage`, not `roll.propose`: the staff-anchor path writes no `roll_actions` row and sets `engagement_status = 'staff'`, so the platform-designated administrator still cannot originate a roll fact, whereas `roll.propose` without `roll.approve` (carried by no template, therefore unreachable under F111) would manufacture permanently unapprovable pending roll actions — the same defect Ruling 6 refused for the designee's own membership — and `roll.propose` *with* `roll.approve` would let one platform-designated person perform the Session's act unilaterally. **Residual, named:** `roll.propose`/`roll.approve` remain unreachable at every organization, so a congregation's founding administrator can stand the organization up and delegate but cannot enrol a member on the roll. A presbytery handover is complete; a congregation handover is not, and closing it is the F111 pipeline's work, a prerequisite for the first congregation go-live and not for PSV.

**DECISION-155 amendment sentence** (to be appended to the decision entry at integration, not rewritten into it — the original reasoning should stay legible):

> **Amended 2026-09-28 (F118, Phase 2 addendum):** `staff.manage` joins the enumerated administration half — the bundle is `people.manage`, `roles.manage`, `role_grants.manage`, `groups.manage`, `officers.manage`, `org_features.manage`, `tickets.file`, `staff.manage`, plus `congregation_oversight.manage` for a presbytery — because the mandatory browser rehearsal proved that the original set could not create a second person at all: `createPerson()` requires `roll.propose` for every roll-bearing kind, the member wizard offers only roll-bearing kinds, and the sole `rollAction: { kind: "none" }` path is the staff-hire affordance gated on `staff.manage`, which this decision's own exclusion sentence ("a founding administrator enrols people as staff-kind anchors") assumed and did not grant. This decision's bundle criterion (i) is amended from "no constitutional template **carries** it" to "no constitutional template **can deliver** it," because F111 proves those are different facts — `personnel_admin` carries `staff.manage` and, while the subset check stands, can never hand it to an organization that does not already hold it; the amendment consequently also makes `personnel_admin` adoptable for the first time and retires F111's own worked example. `roll.propose` and `roll.approve` stay excluded and the exclusion is now load-bearing rather than incidental: `roll.approve` is carried by no template, so `roll.propose` alone would produce permanently unapprovable pending roll actions (the defect this decision's Ruling 6 already refused for the designee's own membership), and granting both to one person would be the Session's act performed unilaterally by a platform designee. The residual is recorded as F118: `roll.propose`/`roll.approve` remain unreachable at every organization under F111, so a presbytery handover is complete while a congregation's founding administrator cannot yet enrol a member on the roll — a go-live prerequisite for the first congregation, owned by the F111 follow-on pipeline. No migration, no new `FEATURES.*` key, no new `permissions` row, no new audit key, no new dependency.

### (3) No `src/lib/people.ts` change — correct, and it is a hard "no"

Confirmed: **nothing in `src/lib/people.ts` should change**, and I am making that binding.

The DECISION-128/129 gating split is right as it stands: `people.manage` unconditional, `roll.propose` conditional on a `roll_actions` row actually being written. Relaxing the `roll.propose` arm so a `people.manage`-only caller could write a roll action would silently widen **every existing organization's** capability to satisfy one bootstrap case — a real escalation on the system of record, reachable from the member wizard by anyone holding `people.manage` anywhere. Adding a bootstrap-only bypass parameter to `createPerson()` is the same forbidden shape as the subset-check bypass Ruling 3(c) refused: a boolean that disables a security check is the one flag that must never be set wrong. And the module is `withOrgContext()`-only by its own header; the founding administrator reaches it as an ordinary tenant actor through the staff surface, which is exactly how it should work.

The fix is a **data-plan change** (one key in one array), not a code-path change. That is the shape to insist on.

### (4) Rehearsal step 6, re-run: the surface and what QA must observe

**Surface: the staff-hire path, not the member wizard.** `/o/<slug>/admin/staff` → "Add a staff position" → the **"Can't find them? Add a new person"** affordance (`src/app/(org)/o/[slug]/admin/staff/add-staff-position-form.tsx:261-280`, visible only when `page.tsx` computes `canCreatePeople` from `hasPermission(..., "people.manage")` server-side). Creating the person is its own submit; starting a position is optional for the purpose of step 6.

Then the grant: `/o/<slug>/admin/roles` → "Grant a role". I verified the person dropdown's source — `getGrantFormOptions()` (`src/lib/role-grants.ts:~306-324`) scopes through `memberships` with `ended_on is null` and applies **no `engagement_status` filter**, so a staff-kind person does appear in the dropdown. This was the one way the fix could still have failed, and it does not. (It is also why the founding administrator, themself staff-kind, was the dropdown's single option in Batch C's run.)

**What QA must observe, in order:**

1. `org_portal.staff` is `enabled = true` on the rehearsal database — record the `psql` output, the same discipline Batch C used for `org_portal.roles`. **This is now an operational precondition, and it is a genuine finding of this addendum:** `scripts/seed.ts` seeds `org_portal.staff` **OFF** ("ships dark until the page lands" — that reasoning expired when the page shipped in wave 3). It is `true` on the dev branch, so the rehearsal will pass, but in an environment where it is off the founding administrator's only person-creation path is dark again and F118 recurs as a flag problem rather than a permission problem. Correctly split (a flag never grants access) and correctly *not* fixed inside this pipeline by widening the bundle. It needs either a seed-default flip or an onboarding-runbook line before PSV — see the TODO lines below. QA should not flip it silently; if it is off, record that and flip it via `/admin/flags` as a documented rehearsal step.
2. The **Staff** tile is visible on the portal home under People & Membership (`src/lib/org-portal/tiles.ts:251-268`, `flagKey: "org_portal.staff"`, no org-type restriction), reached **by clicking**, not by typing the URL — same discipline as step 5.
3. The "Can't find them? Add a new person" affordance renders — this is the visible proof that `staff.manage` *and* `people.manage` both resolve for the designee.
4. The person is created successfully, and the created row is a staff anchor, verified by SQL, not inferred from a green toast: `engagement_status = 'staff'`, `current_roll is null`, and `select count(*) from roll_actions where person_id = …` returns **0**.
5. `/o/<slug>/admin/roles` → the "Grant a role" Person dropdown now has **two** options; grant a role to the second person; the new grant appears in the grants list.
6. **The member wizard still refuses** — `/o/<slug>/admin/members/new`, filled through to submit, still returns *"You don't have permission to add members here."* This is now the **expected and correct** result, not the bug: it is the observable proof that `roll.propose` was not quietly added. Step 6's original failure becomes an assertion.
7. The confirm dialog on `/admin/organizations/<id>` names **staff** in its permission list (regression guard on Batch C's named `PERMISSION_LABELS` drift — a raw `staff.manage` rendered verbatim in the dialog is a FAIL, not a cosmetic nit).

**Logistics, inherited:** `founding.fixture@example.invalid` is single-use and Batch C reset it; QA consumes it again. Delete the rehearsal organizations before running `scripts/test-rls.sql`, or the global one-canonical-row-per-organization count assertion fails for residue reasons unrelated to this pipeline (Batch C's own note).

**Full self-sufficiency, stated honestly:** the second person created this way has no `users` link and cannot sign in. Step 6 proves "the organization can create people and delegate roles unaided," which is what it exists to prove. "A second person who can *log in*" still requires the deferred invitation system (Flow 2, G4) — unchanged scope, but it should not be claimed at Phase 6.

### (5) `scripts/test-rls.sql` §44a — the exact assertion edits

All inside this pipeline's own appended §44 block. Four edits plus one added assertion; §44 goes from 17 to 18 assertions and the suite total rises by one from whatever the current baseline run reports (639 after Batch C's cleanup).

**Edit A — the section comment (~line 7958).** `the seven-key administration half` → `the eight-key administration half (DECISION-155 as amended by F118 — staff.manage joins the bundle)`.

**Edit B — the seed insert (~line 7984).** Add the key:

```sql
  select :FA_ROLE, k from unnest(array[
    'people.manage', 'roles.manage', 'role_grants.manage', 'groups.manage',
    'officers.manage', 'org_features.manage', 'tickets.file',
    'staff.manage']) as k;
```

**Edit C — the "every key resolves" assertion (~lines 8016-8022).** Add `'staff.manage'` to the `unnest` array and change the expected count **7 → 8**; amend the message to `'44a (i): every key of the administration half resolves (DECISION-155''s enumerated tier-1 set, as amended by F118 — eight keys)'`.

**Edit D — the exclusion assertion (~lines 8038-8044).** **Remove `'staff.manage'`** from the excluded array (ten keys remain: `children.roster`, `ledger.approve`, `per_capita.manage`, `statistics.manage`, `roll.propose`, `roll.approve`, `branding.manage`, `events.manage`, `directory.view_hidden`, `credentials.manage`); expected stays `0`. Amend the comment above it so the record does not silently contradict itself: keep "the two roll keys Phase 2 excluded by name (the roll is the system of record; approval is a Session act)" and add — *"`staff.manage` was excluded by the original Ruling 3 and is now CARRIED (F118): it is the only person-creation path that writes no `roll_actions` row, and the bundle's own premise — 'a founding administrator enrols people as staff-kind anchors' — requires it."*

**Edit E — one new assertion, added immediately after Edit C's block**, pinning F118's substance as a single legible fact rather than leaving it implicit in two counts:

```sql
  -- F118: the founding administrator CAN anchor a staff-kind person (the only
  -- in-app person-creation path that writes no roll_actions row) and CANNOT
  -- touch the roll. Both halves in one assertion, because the pair is the
  -- ruling — either one alone would read as an arbitrary line.
  select assert_eq(
    (select count(*) from unnest(array[
       'staff.manage', 'roll.propose', 'roll.approve']) as k
      where presby_has_permission(:FA_PERSON, :ALDER, k)),
    1, '44a (F118): the founding administrator anchors staff-kind people (staff.manage) but neither proposes nor approves a roll action — the roll begins when the Session is seated');
```

§44b/44c/44d/44e are unaffected; no presbytery-bundle count is asserted anywhere in §44, so `congregation_oversight.manage`'s presbytery-only assertion needs no change.

### Proposed lines for the orchestrator to apply at integration (not edited on this branch)

- `docs/schema-design-2.md` §2m — **F118**, verbatim from item (2) above, as its own paragraph following F111; and amend F111's own text so its worked example (`staff.manage` / `personnel_admin` unreachable forever) is marked as retired by F118 rather than left standing as false.
- `docs/decisions.md` — the **DECISION-155 amendment sentence** from item (2), appended to the existing entry.
- `docs/TODO.md` — replace Batch C's proposed line with two:
  - *"Permission ceiling (F111/F118): `roll.propose` and `roll.approve` are carried by no template and are in no bundle, so no organization can ever enrol a member on the roll. Blocks the first congregation go-live; does not block PSV. Owned by the F111 ceiling pipeline."*
  - *"`org_portal.staff` is seeded OFF (`scripts/seed.ts`) but is the founding administrator's only person-creation path (F118). Decide: flip the seed default now that the page has shipped, or add it to the org-onboarding runbook. Either way it must be on before PSV onboarding."*

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review (addendum, F118) | architect | Complete — `staff.manage` joins the bundle (the bundle criterion (i) is amended from "carries" to "can deliver", the defect being mine); `roll.propose`/`roll.approve` stay excluded and the exclusion is now load-bearing (no `roll.approve` anywhere ⇒ permanently unapprovable proposals; both to one person ⇒ the Session's act performed unilaterally); `src/lib/people.ts` and the members/staff surfaces unchanged and now part of the mechanical "unchanged files" test; fix is one array entry + one `PERMISSION_LABELS` entry + tests + five `test-rls.sql` §44a edits + a rehearsal step-6 re-run on the staff-hire path; F118 and the DECISION-155 amendment drafted; residual named (a congregation still cannot run its roll) | Needs revision — scoped to Phase 4, no new pipeline, Phases 1 and 3 not reopened | 2026-09-28 |



### Orchestrator note (2026-09-28)

Addendum accepted and binding on a Phase 4 fix pass (full-stack-developer): `staff.manage` joins the bundle; `roll.propose`/`roll.approve` stay out; `src/lib/people.ts`, `src/lib/staff.ts` and the members/staff surfaces join the unchanged-files test; §44a edits A–E; the rehearsal step 6 re-run on the staff-hire path with the seven observations. The `org_portal.staff` seed default joins the wave-5 go-live flag sweep. F118 and the DECISION-155 amendment are adopted as drafted; F111's worked example is marked retired at integration.

---

# Phase 4 fix pass — F118 (full-stack-developer, 2026-10-05)

**Worktree** `/Users/cshenso/git/presby-platform/presby-wt-boot` on `pipeline/founding-admin`. **Neon branch** `pipeline-founding-admin`, confirmed from the database: `select current_setting('neon.branch_id', true)` -> `br-empty-frost-ax4mo8q5`. `env | grep DATABASE_URL` was empty before every command. `npm run db:push` and `ALTER ROLE` were never run. No migration. No commit, no push, no stash. Dev server on port **3400**, started with `PORT=3400 npm run dev` backgrounded to a log file with a pidfile, stopped by `kill "$(cat pidfile)"` (confirmed stopped; port 3400 empty afterwards).

## State found on arrival (verified, not redone)

A previous fix-pass session was stopped mid-way and had landed MORE than its hand-off listed. Every item below was read against the addendum text and confirmed present and correct:

- `src/lib/founding-administrator.ts` — `"staff.manage"` is the eighth entry of `foundingAdministratorPlan()`'s `base` array, with the F118 doc comment (criterion (i) amended to "can deliver"; roll keys stay out, residual named).
- `founding-administrator-section.tsx` — `"staff.manage": "staff"` in `PERMISSION_LABELS`.
- `scripts/test-rls.sql` §44a — **Edit A** (comment: "eight-key administration half ... F118"), **Edit B** (seed insert carries `staff.manage`), **Edit C** (every-key assertion: `staff.manage` in the unnest, expected **8**, amended message), **Edit D** (`staff.manage` removed from the exclusion array, ten keys remain, expected 0, amended comment recording that it is now CARRIED), **Edit E** (the new `44a (F118)` assertion: `staff.manage`, `roll.propose`, `roll.approve` -> count 1) — all present, text matches the addendum.
- **Tests, already updated on disk** (the hand-off said they had not landed; they had): `src/lib/founding-administrator.test.ts` plan-shape (`BASE` has 8 keys; congregation 8, presbytery 9 = base + `congregation_oversight.manage`, synod/GA/NWC 8; the exclusion list no longer names `staff.manage`); `actions.test.ts` audit-metadata `permissionKeys` includes `staff.manage`; `founding-administrator-section.test.tsx` `BASE_PROPS` carries `staff.manage` and the confirm-dialog test asserts `/staff/i` and `not /staff\.manage/i`; **the "unchanged files" test** in `founding-administrator.test.ts` (suite 1, `PROTECTED_FILES`) already lists all eight paths: `src/lib/authz.ts`, `role-definitions.ts`, `role-grants.ts`, `drizzle/0010_presby_resolver.sql`, `src/lib/people.ts`, `src/lib/staff.ts`, `src/app/(org)/o/[slug]/admin/members`, `src/app/(org)/o/[slug]/admin/staff`, via `git diff --name-only main -- ...`.
- `page.test.tsx` was reviewed: it mocks the plan keys as `["people.manage","roles.manage"]` and asserts prop pass-through only; it renders no dialog and names no bundle-specific key, so it has no F118-dependent expectation and needed no edit.

## Files Modified by this pass

**None in `src/`, `scripts/`, `drizzle/` or `e2e/`.** Everything the addendum asked of the code and tests was already on disk and was verified (above). This work-log is the only file this pass changed (the Phase 4/5 rows of the Per-Phase Status table plus this section).

## Failing-first evidence

The OLD test expectations could not be run as such (they had already been updated by the earlier session). The equivalent honest proof is a **mutation check**: temporarily revert the two production edits (remove `"staff.manage"` from `base`; remove the `PERMISSION_LABELS` entry), run the updated tests, restore from a byte-copy (`diff` confirmed identical afterwards).

```
$ npx dotenv-cli -e .env.local -- npx vitest run src/lib/founding-administrator.test.ts -t "foundingAdministratorPlan"
  x congregation: the base eight keys (F118 ...)
  x presbytery: base eight PLUS congregation_oversight.manage (9 total) ...
  x synod / general_assembly / new_worshiping_community: administration half only ...
  Tests  5 failed | 1 passed | 21 skipped (27)

$ npx vitest run ".../founding-administrator-section.test.tsx"
  x names the actual permission list and the office template
  AssertionError: expected 'Founding administratorThis organizati...' not to match /staff\.manage/i
  Tests  1 failed | 17 passed (18)
```

With the production edits restored, the same tests pass (full-suite counts below). The `test-rls.sql` side of failing-first is structural: Edit C's count of 8 and Edit E cannot pass unless the seed insert (Edit B) carries `staff.manage`, and the section ran green only after all five edits.

## Commands Run, With Outputs

```
$ env | grep DATABASE_URL                      # empty
$ npm run typecheck                            # clean
$ npm run lint                                 # clean (eslint --max-warnings=0)
$ npm run check                                # all tripwires pass (brand-scope, secrets & PII, dependency drift ...)
$ npm test                                     # CI mode, no DATABASE_URL
  Test Files  262 passed | 34 skipped (296)   Tests  3412 passed | 914 skipped (4326)
$ npx dotenv-cli -e .env.local -- npx vitest run --no-file-parallelism   # full DB-backed suite, run AFTER rehearsal cleanup
  Test Files  296 passed (296)   Tests  4326 passed (4326)   Duration  462.06s
$ psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql      # as presby_app, AFTER rehearsal cleanup
  exit=0   639 "NOTICE:  pass" lines, 0 failures
$ git diff main --name-only -- <the eight protected paths>                  # 0 files
```

**RLS count, stated precisely:** the earlier batches' "639" was `grep -c pass` over the output, which counts the closing banner line that contains the word "pass" as well as the real assertions (638 real: Batch A's 621 + 17). This run: 639 real `NOTICE:  pass` lines, `grep -c pass` = 640 — i.e. the baseline plus exactly the one new `44a (F118)` assertion, as the addendum predicted ("640" by the earlier counting method). Both new/changed §44a assertions appear as passes: `... eight keys (8)` and `44a (F118): ... (1)`.

## The Rehearsal — step 6 re-run on the staff-hire path (Playwright, no interactive browser; throwaway scripts in gitignored `scratch/`, deleted afterwards)

Organization created for it: `F118 Rehearsal Presbytery`, slug `f118-rehearsal-l3fa2p`, id `dffa612e-8bc1-44e0-9d28-8bd5675c7aba`, created by `admin@presby.invalid` through `/admin/organizations/new`, then `founding.fixture@example.invalid` designated through the real confirm dialog and signed in with the shared fixture password.

**Precondition (observation 1), recorded before anything else:**
```
select key, enabled from feature_flags where key in ('org_portal.staff','org_portal.roles','org_portal.members_create');
 org_portal.members_create | t
 org_portal.roles          | t
 org_portal.staff          | t
```
`org_portal.staff` was already ON; no flip was needed or performed, and none was done silently (re-checked after the rehearsal: still `t`). Fixture precondition: `select count(*) from people where user_id = 'e0000000-0000-0000-0000-0000000000f5'` -> 0; no leftover `boot-rehearsal%` or rehearsal orgs.

| # | Observation | Result | Evidence |
|---|---|---|---|
| 1 | `org_portal.staff = enabled = true` on the rehearsal DB | PASS | `psql` output above |
| 2 | The Staff tile is visible on the portal home and is reached BY CLICKING | PASS | Tile (link "Staff") visible on `/o/f118-rehearsal-l3fa2p`; click navigated to `/o/f118-rehearsal-l3fa2p/admin/staff` (`waitForURL`, not `networkidle`) |
| 3 | "Can't find them? Add a new person" renders | PASS | button visible on the staff page for the designee (both `staff.manage` and `people.manage` resolve) |
| 4 | Created person is a staff anchor, verified by SQL | PASS | see below |
| 5 | Roles page Person dropdown has TWO options; a role is granted to the second person; the grant appears | PASS | dropdown options `["Fixture Founding Admin","Staffer Rehearsal"]`; role options `["Founding Administrator","Member","Stated Clerk"]`; granted `Member` to Staffer Rehearsal; the page lists the new grant; SQL below |
| 6 | Member wizard still refuses at submit (the expected, correct result) | PASS | `/o/<slug>/admin/members/new` filled through all six steps (name search, identity, contact, "No household yet", roll action "Enrolled as a participant", review) -> submit -> *"You don't have permission to add members here."*; `people` rows named Wizard Attempt = 0; `roll_actions` at the org = 0 |
| 7 | The confirm dialog on `/admin/organizations/<id>` names **staff** | PASS | dialog text: *"... manage people, roles, role assignments, groups, officers, feature toggles, support tickets, staff, and congregation oversight, plus this organization's constitutional Presbytery Stated Clerk office ..."*; names staff: true; raw `staff.manage` present: false |

Observation 4 SQL (`people` joined to `memberships` at the org):
```
 first_name |   last_name    | engagement_status | current_roll | roll_actions
 Fixture    | Founding Admin | staff             |              |            0
 Staffer    | Rehearsal      | staff             |              |            0
```
Observation 5 SQL (`role_grants` at the org):
```
 Fixture | founding_administrator  | t
 Fixture | presbytery_stated_clerk | t
 Staffer | member                  | t
```

**Two honest notes on the rehearsal mechanics.** (a) The member-wizard step first returned *"Member management isn't turned on for F118 Rehearsal Presbytery yet"*: the per-org `members_create` feature toggle is off by default (Phase 2 Ruling 3 predicted this), so as the founding administrator I turned it on myself at `/o/<slug>/admin/features` (the org's own `org_features.manage` — no platform intervention, no SQL), and only then ran observation 6. Without that step observation 6 would not have exercised the permission check at all; it is a necessary precondition of the "refusal is the proof" reading and QA should repeat it. (b) The second person created through the staff path has no `users` link and cannot sign in, as the addendum said; step 6 proves "the organization can create people and delegate roles unaided", not "a second person who can log in" (deferred invitation system, Flow 2/G4).

## State Left Behind

- Rehearsal organization **deleted** with the `deletable_until` stamp then delete inside the `group_memberships_reject_derived` disable/enable bracket (the `founding-administrator.test.ts` `afterAll` pattern), followed by deleting its two `people` rows (both stamped first, because `people_guard_delete` fires for the owner too). After: `organizations like 'f118-rehearsal-%'` = 0; `people where user_id = 'e0000000-0000-0000-0000-0000000000f5'` = 0 (fixture back to zero `people` rows, ready for QA to consume); stray `Staffer`/`Wizard` people = 0; trigger `group_memberships_reject_derived` `tgenabled = O` (re-enabled); 15 organizations remain in total.
- Audit rows the designation wrote for the deleted organization (append-only) were not removed and were not queried (no `audit_log` relation by that name on this branch; I did not hunt for the real table). They carry no uniqueness constraint that `test-rls.sql` counts — the suite ran green with them in place.
- `test-rls.sql` ran AFTER the cleanup (the residue lesson from Batch C): 639 passes, 0 failures.
- Dev server on 3400 stopped by PID; `scratch/` deleted (scripts, screenshots, log, pidfile). Nothing under it was ever tracked.
- The per-org `members_create` toggle was flipped on only inside the deleted rehearsal org; nothing global changed. `org_portal.staff` untouched.
- `git status --short` is exactly Batch A/B/C's set plus this work-log: `docs/testing.md`, `scripts/seed-dev.sql`, `scripts/test-rls.sql`, `src/app/(admin)/admin/organizations/[id]/{actions.ts,actions.test.ts,page.tsx}`, `src/lib/audit.ts`, `src/lib/audit.test.ts` (modified); `docs/work-log/2026-09-28-founding-administrator.md`, `founding-administrator-section.tsx` + `.test.tsx`, `page.test.tsx`, `src/lib/founding-administrator.ts` + `.test.ts` (new).

## Deviations / Open Issues

- **`git diff main` is noisy, but the protected-file check is clean.** `main` in this checkout has advanced past the branch's merge-base (`4461a46`), so an unscoped `git diff main --stat` shows other pipelines' files (e2e support, statistics, presbytery). The mechanical test and the explicit `git diff main --name-only -- <eight paths>` are path-scoped and return nothing. Integration should rebase/merge onto the new `main` first; if `main` itself has since touched one of the eight protected paths, the mechanical test would then fail for a reason that is not this pipeline's.
- The earlier session's hand-off underreported what was on disk (tests and the unchanged-files extension had landed). Nothing was missing; it is recorded so QA does not look for a diff in those files that is not there.
- Nothing else failed and no design problem surfaced: step 6 works on the staff-hire path exactly as the addendum predicted.

## Proposed for the Orchestrator to Apply at Integration (carried forward, unchanged, not edited on this branch)

- `docs/schema-design-2.md` §2m — **F118**, verbatim from the Phase 2 addendum item (2), as its own paragraph after F111; amend F111's worked example (`staff.manage` / `personnel_admin`) as retired by F118.
- `docs/decisions.md` — the DECISION-155 amendment sentence from the addendum, appended to the entry.
- `docs/TODO.md` — the two lines in the addendum's "Proposed lines" (the `roll.propose`/`roll.approve` ceiling residual blocking the first congregation go-live; `org_portal.staff` seeded OFF in `scripts/seed.ts` but the founding administrator's only person-creation path, must be ON before PSV onboarding). Add to the wave-5 go-live flag sweep.
- `docs/testing.md` suite-count wording, if it states an `test-rls.sql` total: 639 real assertions (640 by the `grep -c pass` method).
- Rehearsal logistics for QA: the per-org `members_create` toggle must be turned on (by the founding administrator, at `/o/<slug>/admin/features`) before observation 6 means anything.

**Phase 4 fix pass complete. Phase 5 (qa) next.**

---
