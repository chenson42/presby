# Revoke founding administrator / treasurer from the admin org page — Work Log

> **Slug:** `2026-10-22-designation-revoke`
> **Surface:** (admin) — `/admin/organizations/<id>`
> **Permission(s):** TBD in Phase 1/3 (the founding-administrator and treasurer sections' existing gates are the starting point)
> **Flag(s):** not needed (operator rule: no new global flags before go-live)
> **Estimated complexity:** small–medium
> **Pipeline mode:** Full
> **Source:** operator request 2026-10-22: "i think the admin form should also have a revoke for both treasurer and founding admin". Context: production FPCW's founding-administrator slot was held by a dev-seed grant to a fixture account; the section offered no way out but "use the org's Roles page", which nobody real could reach.
> **Pre-assigned numbers (Rule 16):** DECISION-194–196 · F169–F171 · migration 0060 (if any) · worktree `presby-revoke` · Neon branch `pipeline-designation-revoke` (`br-misty-paper-axrm9q7u`)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-22 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-22 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementers named (database-admin, then full-stack-developer) | 2026-10-22 |
| 4 — Implementation | database-admin (Batch A), then full-stack-developer (Batch B) | Complete — Batch A (0060 applied to `pipeline-designation-revoke`) and Batch B (library, action, UI, tests, e2e, browser check) | — | 2026-10-22 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded by the orchestrator from the analyst's returned text (the analyst is read-only); bullets condensed for layout, every finding, gap, question and recommendation kept.*

## VERDICT

**READY WITH NOTES** — the request is sound and the production incident proves the gap is real, but it is not "add a Revoke button". Three rulings must be fixed first, and the architect should treat them as Phase 2 inputs: (1) whether and how far a platform role may *remove* tenant authority, (2) how to stop revoke from becoming a takeover path when combined with self-designation, and (3) whether the section may now *name* holders (it reverses an existing "count, never names" ruling for the treasurer).

## ONE-LINE TAKE

> Let a platform admin end the current holder(s) of the founding-administrator or treasurer slot from `/admin/organizations/<id>`, naming who holds it, with a required reason and an audit row — but ending a grant is the opposite of acquiring authority only in isolation; combined with self-designation (DECISION-183) it is a takeover path unless Phase 2 closes it.

## What I confirmed in the worktree

- **Revoking a pending/expired invitation already exists** (`revokeInvitationAction`, `revokeAllInvitationsAction`; Resend and Revoke are on the open row). The new thing is revoking an **accepted / pre-existing holder** — which has no platform-side path today.
- **Both sections only show a count once >0.** The treasurer section explicitly says "a count, NEVER names"; the founding-administrator section names nobody. The operator could not tell the slot was held by a fixture.
- **What a designation actually is:** ordinary `role_grants` rows. `presby_apply_founding_administrator` writes up to **two** person-arm grants for one person — the `founding_administrator` bundle role **and** the stated-clerk office role — reason `'founding administrator designation'`; `presby_apply_treasurer` writes one, reason `'treasurer designation'`. Nothing marks these apart from any other grant except that reason string — and the motivating dev-seed grant did not carry it.
- **Org-side `revokeRole()`** ends a grant with `ends_on = current_date` (never deletes) and refuses with `self_lockout_blocked` when that would leave no `role_grants.manage` holder. No platform path exists.
- **The two holder counts are asymmetric.** `presby_founding_administrator_holder_count` is lifted verbatim: it counts the group arm through open `group_memberships` with **no `memberships` join and no `starts_on` check on the group side**; `presby_giving_manage_holder_count` is membership-aware and excludes merged people. Both owner-only SECURITY DEFINER.
- **`role_grants_needs_membership` (drizzle/0014) fires on `update of person_id, ends_on`** and rejects an `ends_on` later than the person's membership end — so setting `ends_on = current_date` on a grant whose holder's membership has already ended raises `check_violation`.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Admin (platform operator) | **See who holds** founding administrator (per person: display name, since when, provenance — via invitation / other, via role / via group) | On demand, every page render |
| Admin | **See who holds** treasurer — same (**subject to Q3**) | On demand |
| Admin | **Revoke** a founding-administrator holder → confirm dialog → reason → confirm | Rare (recovery) |
| Admin | **Revoke** a treasurer holder — same | Rare |
| Admin | then **invite** a replacement via the existing form (reappears at count 0) | Follow-on |
| Admin | **Revoke an open invitation** | Already exists — unchanged |
| Revoked holder (member) | **Notices** access gone: org nav loses entries; optionally an email (Q6) | Passive |
| Anonymous / no-roles / authenticated member | — nothing here changes their surfaces | n/a |

## Flows

**Flow 1 — Revoke founding administrator (the FPCW case)**
1. Entry: `/admin/organizations/<id>`, founding-administrator section.
2. The section lists current holders instead of the "already designated" sentence: per row — display name, granted-on date, provenance (via invitation / other), and, for a group-arm row, the group name with a live member count (no member names). Each row: **Revoke** (≥44px).
3. Revoke → `AlertDialog` (Rule 2) naming the org, the person, exactly **which roles** will end (and that those roles also carry other permissions), that if this is the last holder **nobody can manage roles until a replacement is invited**, and a **required Reason** field.
4. Confirm → server, one transaction, audited.
5. Success: toast; section re-renders. Count now 0 → invite form appears (existing recovery copy already describes this). Holders remain → list shortens.
- Failure — stale (someone already ended it / count changed): "That access has already been removed. Refreshing the list." and reload.
- Failure — reason missing/too long: inline field error, dialog stays open.
- Failure — DB down: existing `DB_ERROR_COPY`, nothing half-written.
- Failure — the membership-ended trigger (G3): must never surface as a raw constraint error — needs a designed outcome.

**Flow 2 — Revoke treasurer** — same as Flow 1 on the treasurer section, for `giving.manage` holders. Confirm names what ends (view every gift and donor, record gifts, giving settings/funds/team) and states plainly that donor/gift data stays and the platform operator does not gain access to it. Treasurer revoke never touches `giving_recorder` (minted, not granted — F138).

**Flow 3 — Revoke when the holder is the operator themself (self-designated)** — row stamps "Self-designated" (existing `selfDesignated` flag). Allowed; revoking your own access is not escalation.

**Flow 4 — The revoke-then-invite recovery loop** — revoke → count 0 → existing invite form (email + name for FA). Inviting the revoking operator's **own** address in that window is the sensitive case (G2).

**Flow 5 — A group-arm or "ghost" holder blocks the slot** — section reports N>0 and today offers no way out; the new list must show exactly the rows the count counts (G1), each revocable or explained.

## Permissions & Flags

- **Permission:** reuse `FEATURES.ADMIN_ORGANIZATIONS` (the platform-shell gate every action in this file already uses). This is the platform axis (`FEATURES.*`); the tenant axis/resolver is untouched — no new `FEATURES` key, no tenant catalog key, and no platform role mapped into the tenant resolver. The architect should rule whether revoke instead needs the stricter live `users.is_platform_admin` predicate (DECISION-044) given it is more consequential than invite; I lean "same gate", since the proxy already enforces admin + 2FA on `/admin`.
- **Default roles:** platform-shell admins only. No tenant role gets it.
- **Flag:** not needed. Operator rule: no new global flags before go-live; this is an admin recovery tool with no member-facing rollout. Rollback = code revert; no data migration required for correctness. A per-org toggle is not meaningful here either.

## Does a platform role *removing* authority violate "Two Hierarchies Intersect Nowhere"?

**Finding: consistent with the invariant's letter, but a downward write by a platform role, and it needs explicit limits.**

- The invariant forbids a platform role **acquiring** ecclesiastical authority "merely by its position." Ending a grant acquires nothing — the platform admin ends up with fewer rights over the org's data than before.
- But the invariant's purpose is that the **congregation's own authority over itself** (who holds office, who administers the roster) is decided by the congregation's session and administrators. A platform-initiated removal overrides that. The only precedent for a downward platform write is the platform-run accept path (DECISION-183) — which is a *grant* the invitee accepts. This is defensible as **recovery, not governance**, and reversible (the congregation can re-grant through its own Roles page).
- **The real hazard:** self-designation (DECISION-183, the operator's own ruling) is safe today because it is gated by "nobody holds the slot". **A revoke button lets a platform admin open that gate at will against a congregation that has live, real administrators:** revoke every holder → invite own address → accept → now holds the congregation's top administrative role, via a path every step of which is individually authorised. The invariant's own testable form — "acquires authority merely by position" — fails on the chain, because the position is what let the operator clear the slot.

**Recommended limits for the architect to weigh (any one narrows the path; together they close it):**
1. **Reason required** (minimum length, audited verbatim). A record, not a control.
2. **Mechanically block the revoke→self-designate chain:** refuse a self-addressed invitation for that org and purpose if the same actor revoked any holder there in the last 30 days (or require a second platform admin to send it). Recommended: the refusal — cheap, testable, does not depend on anyone's honesty.
3. **Notify surviving holders** (if any remain after the revoke — they are the congregation's own voice) — Q6.
4. **Narrow what is revocable** — Q2. The tightest option (only grants carrying the designation reason strings, plus holders who cannot act) would **not have covered the FPCW fixture grant**; draw the line there only if the operator accepts that the dev-seed case still needs SQL.
5. Frame the UI as recovery: copy says "use the organization's own Roles page when one of its administrators is available".

## Gaps the Request Didn't Address

- **G1 — The list must be generated from the same rows the count counts, and the revoke unit is the person, not the grant row.** *(proposed F169)* The FA count includes the group arm, and the group arm does not join `memberships` — a holder who left the congregation still counts. A group holder cannot be removed by ending the person's grants; the group's grant must be ended instead. The FA designation writes two grants, and the stated-clerk office role also carries `role_grants.manage`, so ending only the `founding_administrator` grant leaves the count >0. **The revoke ends every effective grant that contributes to the holder count for that person, in one transaction**; the confirm lists which role names. A new owner-only SQL function returns the contributing grants and the count becomes derived from it (or is pinned equal by test, as DECISION-183 did for the counts). If the list and the count drift, the operator sees "1 person holds this" and no row to act on. The count's lifted-verbatim group-arm asymmetry needs a ruling: fixing it changes the existing gate (0059's comments reserved that for a separate ruling). Minimum viable: **list what the count counts**, asymmetry included.
- **G2 — Revoke-then-self-invite takeover chain** *(proposed F170)* (invariant section above). Needs a mechanical block (limit 2), not only a policy sentence.
- **G3 — The membership-ended trigger blocks ending a ghost holder's grant.** *(proposed F171)* `role_grants_needs_membership` fires on `update of ends_on` and raises when `ends_on` > the membership end date — so a holder whose membership already ended **cannot be end-dated to today**. Ghost holders are the people most likely to occupy a stuck slot. Architect should rule: end-date to the membership end date (a retroactive `ends_on`, which the resolver already reads as ended), or another way. Must not surface as an unhandled constraint error.
- **G4 — Constitutional office grants may be materialized from `officer_terms`.** The stated-clerk office role is bound to an office; if such a grant is trigger-materialized, ending it may be reverted or refused, and a platform admin must never end an officer term ("The Court Is Not a Group" forbids a platform write to that table). Phase 2 must verify and scope revoke to direct role grants only; an office-materialized holder should render as "held through an officer term — the congregation's own clerk removes this" with no Revoke.
- **G5 — Holder list reverses an existing privacy ruling for the treasurer** (Q3). Tier-1 directory data (a name) vs tier-2 financial data — but the "who handles the money" sentence in the treasurer section was a deliberate choice.
- **G6 — `role_grants` has no ended-by / ended-reason column**, so the org's own Roles page will show an ended grant with no explanation. Options: migration 0060 adding `ended_by`/`ended_reason` to `role_grants`; audit only; notify surviving holders. Recommend at least the notification; a column is a bigger decision (a migration touching the tenant table, RLS, the guard) — let the architect size it.
- **G7 — Concurrency.** Revoke vs an open invitation being accepted: `presby_accept_invitation` locks org → invitation → user → person; the revoke must take the org-row lock first, in the same order. Revoke vs the org's own `revokeRole()` and double-submit: the second call must be a clean "already removed", not an error and not a double audit row. An open invitation that was blocked as `has_holders` becomes acceptable again after a revoke — decide whether the revoke cancels open invitations or leaves them (lean: leave them; the operator can already revoke them).
- **G8 — Last-holder lockout vs recovery.** The org-side path refuses to remove the last `role_grants.manage` holder (`self_lockout_blocked`) — rightly. The platform path **must be allowed to reach zero** (zero is the point of recovery and the invite form is the next step); confirm copy says so in plain words. If the org has other holders besides the one being revoked, the dialog links to the org's Roles page as the preferred route.
- **G9 — Audit** (Rule 7): `organizationId`, the revoked `personId` (no name/email), role keys and grant ids ended, the reason, `holderCountBefore/After`, arm (person/group), self-revoke flag; in the same transaction (`check:audit` requires an `AUDIT_ACTIONS` key per mutation). New keys, following the `org.founding_administrator.designated` platform-acts-on-tenant precedent, not tenant-axis `tenant.role.revoked`.
- **G10 — The out-of-band SQL end done today has no audit row.** Recommend the orchestrator record the date, org and fixture grant in the work-log; consider a backfilled audit row.
- **G11 — Defense in depth:** the server re-derives everything from the grant ids + `organizationId` — the grant must belong to the org in the form, be currently effective, and contribute to this section's holder count; never trust a client-submitted role or person. Any other grant, by any id, is refused — so the new function never becomes a general platform "end any grant" tool.
- **G12 — Mobile/empty state:** a holder row at 360px needs name, provenance and a 44px Revoke without horizontal scroll; a new org with zero holders shows the existing invite form unchanged; a very long group name wraps.
- **G13 — Session claims.** `/admin` already requires the admin to have passed 2FA. The revoked holder's live session keeps stale feature claims until the next request, but org access is read through the resolver per request, so it ends immediately. Confirm no session claim retains the old role.

## Adversarial Pass

| Check | Finding |
|---|---|
| Redirect targets | None — the action returns a result and revalidates the same page. Confirm no `next` is accepted. |
| State-machine shortcuts | A direct POST bypasses the client dialog/reason — reason requirement and "belongs to this section" check must be server-side. **Gap (G11).** |
| Enumeration | Admin-only page; 404 vs 403 not an issue. A forged org id for a non-existent org returns the same neutral error as a wrong grant id. |
| Input boundaries | Reason: trim, min length, max length (suggest 500), Unicode-safe, stored as data, never interpolated into mail/HTML unescaped. Grant ids validated as UUIDs. |
| Self-targeting | Revoking oneself: allowed, stamped. The dangerous variant is the self-invite chain (G2). |
| Takeover chain | **Revoke → self-invite → self-accept is currently unobstructed** — see the invariant section. |
| IDOR | A grant id from another org must be refused — re-derive org from the row and compare with the submitted `organizationId`. |
| Race with accept / org-side revoke | G7. |
| Mail abuse | Notification mail goes through the existing queue and sender registry (DECISION-182); the reason text is not sent to the revoked person unredacted unless the operator rules so (Q6). |

## Edge cases the request didn't mention

- **Brand-new install** — zero holders, zero invitations: the invite form, unchanged.
- **Presbytery** — no treasurer section and no treasurer revoke; a presbytery FA revoke additionally ends `congregation_oversight.manage` (via the bundle), and the confirm says so.
- **Holder is also an elder / session member / committee member** — ending the designation grants must not touch those unrelated roles.
- **Treasurer slot held through a custom role, not `treasurer`** — the unit is "grants contributing to the count", not "role key = treasurer"; ending that custom grant removes whatever else the custom role carries, and the confirm lists those names.
- **Merged person** — excluded by the treasurer count but not the FA count; list and count must agree (G1).
- **Failure microcopy** — everything above gets human copy, no constraint names, no stack traces.

## Out of Scope (confirm with user)

- Removing any grant other than those counted for these two slots — no general platform "end any role grant".
- Editing or ending officer terms.
- Reinstating a revoked grant (recovery is a fresh invitation).
- Bulk revoke across organizations.
- Changing how the holder counts are computed (beyond what G1 needs), or the 90-day redaction sweep.
- Any change to who the org's own administrators can revoke.
- A what's-new entry (Rule 13) — internal admin tooling.

## Open Questions

- **Q1 — Platform authority (the main ruling).** May a platform admin remove tenant authority at all? Analyst: yes, with the limits above (reason, chain block, notification). Confirm — it is a downward write by a platform role.
- **Q2 — Scope of what is revocable.** **Option A (recommended):** any effective grant that counts toward the slot, including dev-seed and ghost holders — the only option that would have fixed FPCW. **Option B:** only grants created by the designation flow, plus holders who can no longer act — narrower and safer, but would not have covered the incident.
- **Q3 — May the sections name the holder?** FA never had a rule against it; the treasurer section explicitly chose counts only. Recommend display name only, never email, for both — you cannot responsibly revoke an unnamed person, and the confirm must name them. Alternative: initials + provenance + date.
- **Q4 — The takeover chain.** Is refusing a self-addressed invitation for 30 days after the same actor's revoke at that org acceptable, or do you prefer a second platform admin?
- **Q5 — Revoke-all or one at a time?** Recommend one person at a time (the designation's two grants for one person go together).
- **Q6 — Notification.** Do the revoked person and any surviving holders get an email? Does the revoked person see the reason? Recommend: surviving holders get a notice; the revoked person gets a neutral one without the reason. This is the part most likely to grow scope — could move to a follow-up, with the audit row and the surviving-holder notice as the minimum.
- **Q7 — Org-side visibility (G6).** Audit-only acceptable, or should the org's Roles page show who ended the grant and why (migration 0060)?
- **Q8 — Open invitations at revoke time.** Leave them or cancel them? Recommend leave.

## Notes for Phase 2 / Phase 3

- Proposed number use (orchestrator to confirm): **DECISION-194** platform removal of tenant authority + limits + self-designation block; **DECISION-195** holder visibility (Q3); **DECISION-196** revoke mechanics (owner-only SQL function, lock order, membership-ended trigger handling, list/count single-sourcing). **F169** = G1, **F170** = G2, **F171** = G3. Migration **0060** only if a new SQL function or the G6 columns are needed.
- Pattern to reuse: the platform path is an owner-only SECURITY DEFINER function like the 0059 helpers — org lock first, derive from rows, audit in the same transaction — not ad-hoc `getPlatformDb()` updates scattered through `actions.ts`.
- Tests Phase 4 must carry: list = count over the group arm, a ghost holder, a merged person and a two-grant person; the trigger case (G3); the officer-term case (G4); the self-invite refusal; a cross-org grant id refused; double submit; a revoke racing an accept; audit metadata; a source scan that nothing but the new function writes `role_grants.ends_on` from the platform side.
- UI: reuse `AlertDialog`; hydration gating applies to the reason field (DECISION-159); verify at 360px in a browser.

## Handoff

Next: **architect** (Phase 2), inputs Q1–Q8, G1–G13 and the invariant analysis. Q1, Q2 and Q4 block the design — put them to the operator before or alongside Phase 2. The architect must rule on G3 (membership-ended trigger), G4 (officer-term grants), the `FEATURES.ADMIN_ORGANIZATIONS` vs live `is_platform_admin` gate, and whether migration 0060 is needed.

Files read (all under the `presby-revoke` worktree): `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.tsx`, `treasurer-designation-section.tsx`, `actions.ts`, `page.tsx`; `drizzle/0059_presby_account_invitations.sql`; `drizzle/0014_presby_org_router.sql`; `src/lib/role-grants.ts`; `src/lib/db/domain/authz.ts`; `src/lib/audit.ts`; `docs/decisions.md` (DECISION-183–189); `docs/work-log/2026-10-22-designation-revoke.md`.

### Orchestrator note (G10)

The out-of-band SQL end happened on 2026-10-22 at about 14:19 UTC, after snapshot `snap-super-shape-axjz7h59`. It ended, on production, the two `dev-seed:`-reasoned role grants at the operator's first test congregation: a portal-admin grant to the fixture person linked to the seeded admin account, and the baseline member group grant. In the same transaction the 68 `.invalid` test accounts were deactivated and stripped of platform roles, 2FA and platform-admin. The orchestrator ran it on the operator's instruction ("lets clean up all test accounts"). No audit row was written; whether to backfill one is an open question for the operator.


### Operator rulings on the Phase 1 open questions (2026-10-22)

Asked by the orchestrator, answered by the operator in-session:

- **Q1 (may a platform admin remove tenant authority):** yes, implied by the rulings below.
- **Q4 / G2 (revoke → self-invite takeover chain):** **"No block, audit only"**. The operator declined both the 30-day self-invite refusal and the second-admin rule. The control is a required reason plus the audit row. The analyst's limit 2 is **not** adopted. Phase 2 should record this as an accepted residual in the DECISION, not as a gap left open by mistake.
- **Q2 (scope):** **Option A**. Revoke may end any effective grant that counts toward the slot, including dev-seed and ghost holders.
- **Q3 (naming):** **display name only**, never email, for both sections. This reverses the treasurer section's count-only rule.
- **Q6 (notification):** **audit row only in this pipeline.** Emails to the revoked person and to any surviving holders go to `docs/TODO.md` as a follow-up at integration.
- **Q5, Q7, Q8:** not put to the operator. The analyst's recommendations stand as defaults: one person at a time, with the designation's grants for that person ended together; audit-only org-side visibility (no migration for G6 columns); open invitations are left alone at revoke time.

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator from the architect's returned text (the architect is read-only).*



## Verdict

**Approved with suggestions.** The feature shape is sound and fits the existing structure without adding a module or a dependency. All the rulings Phase 3 must honor are below. One of them narrows the operator's Option A (D6: grants held through a derived group cannot be revoked). Please show that one to the operator before Phase 3 freezes the design. If they want it widened, it is a one-predicate change and nothing else in this design moves.

## Placement

- **Migration: `drizzle/0060_presby_designation_revoke.sql`. It is needed.** It does not edit 0059 in place, because 0059 has shipped (v0.37.0 is live), so this is a fix-forward. It is idempotent (`create or replace`, revoke-then-grant), applied with `psql -1`, and its journal entry is added by the orchestrator at integration (Rule 16). It contains:
  1. `presby_founding_administrator_holder_grants(p_org uuid)` and `presby_giving_manage_holder_grants(p_org uuid)`. These are set-returning functions with one row per pair of (contributing grant, holder person): `grant_id, role_id, role_key, role_name, arm ('person'|'group'), subject_person_id, group_id, group_membership_source, holder_person_id, grant_starts_on, grant_reason`. Each function's predicates copy its existing count's CTE word for word.
  2. Both existing counts are redefined as `select count(distinct holder_person_id)::int from presby_…_holder_grants(p_org)`. The count is **derived from** the list, not pinned beside it. Their callers (issue.ts, `presby_apply_*`, `presby_accept_invitation`) keep their signatures.
  3. `presby_revoke_designation_holder(p_org uuid, p_slot text, p_subject_kind text, p_subject_id uuid, p_expected_grant_ids uuid[])`. This is the only platform-side writer of `role_grants.ends_on`. Its mechanics are in DECISION-196.
  4. All three new functions are `SECURITY DEFINER`, `set search_path = public, pg_temp`, and have EXECUTE revoked from `public, presby_app, presby_platform`, so only the owner can run them (the 0059 §5 precedent: a cross-org list is an oracle). There are no table, column or grant changes, and **no G6 columns** (the operator's default is audit-only).
- **Server library: `src/lib/onboarding/designation-holders.ts`.** It holds `listDesignationHolders(platformDb, orgId, slot)` and `revokeDesignationHolder(...)`. It uses the platform connection only, and writes its audit row with `insertAuditRow(tx, …)` from `@/lib/audit-tx` inside the same transaction as the function call (the issue.ts precedent). It sits beside `issue.ts` because it is the inverse of the designation. It must **not** go into `src/lib/role-grants.ts`, which is the tenant (`presby_app`, `withOrgContext`) module. Putting the owner connection there would blur the one connection boundary that file now makes obvious.
- **Actions: in the existing `src/app/(admin)/admin/organizations/[id]/actions.ts`.** These are `revokeFoundingAdministratorHolderAction` and `revokeTreasurerHolderAction`, or one action that takes a slot literal. Each follows the file's established chain: `auth()` → `hasFeature(ADMIN_ORGANIZATIONS)` → validation → library call → `revalidatePath`. The section comment says "NO `db.*` CALL IN THIS FILE", and that keeps holding.
- **Server vs client split.** `page.tsx` (a Server Component) loads both holder lists through the library and passes only plain props: display name, granted-on date, provenance, role names, group name with a holder count, grant ids, and `selfDesignated`. It never passes an email. Both sections are already `'use client'`. The new co-located client components are `designation-holder-list.tsx` (shared by the two sections) and `revoke-holder-dialog.tsx` (shadcn `AlertDialog` + `Textarea`, both already in `src/components/ui/`; Rule 2). If the reason field uses `useForm`, it renders `<HydrationGate>` (DECISION-159; `check:hydration-gate` enforces this). Nothing goes into `src/components/shared/` because only this page uses these components.
- **Dependencies: none.**

## Invariants Touched

- **Two Hierarchies Intersect Nowhere.** This is a downward write by a platform role. It is consistent with the invariant's wording (ending a grant acquires nothing), but combined with self-designation it is not consistent with the invariant's purpose. It is held to recovery by DECISION-194's limits. The revoke-then-self-invite chain is an **accepted residual by operator ruling** (see DECISION-194). Because CLAUDE.md currently says "the platform role itself confers nothing", it **needs one more sentence**, or it would deny a residual the technical record admits (the lesson from the 0.25.2 release note). Proposed text, to be added after the DECISION-183 sentence:
  > A platform admin may also end the current holders of an organization's founding-administrator or treasurer slot from `/admin/organizations/<id>`, as lockout recovery (DECISION-194). It never ends a grant held through a derived group and never touches an officer term, and it requires a reason and writes an audit row. **Accepted residual:** a revoke followed by a self-addressed designation lets the platform role clear a slot and then hold it. That chain is detected by audit (`org.*.revoked`, then `invitation.created` with `selfAddressed`) and is not prevented (operator ruling 2026-10-22). This is `paper`.

  The orchestrator makes this edit at integration, and the operator reviews the diff. `docs/architecture.md:100` also says "nothing about the designation lets the platform act inside the organization afterwards". That statement is now reversed, so Rule 15 applies: update it at Phase 6.
- **The Court Is Not a Group.** Officer terms materialize `group_memberships` only: session and diaconate through `officer_terms_sync_derived` (0009), and `active_membership` from memberships (0017). **They never materialize `role_grants`.** The revoke function writes `role_grants` and nothing else: no `officer_terms`, no `group_memberships`, no `memberships`, no `account_invitations`. Revoking grants held through a derived group is out (D6).
- **Isolation Is a Database Property.** The owner connection is used only in the (admin) tree and the new library. I checked the live catalog on `pipeline-designation-revoke`. `role_grants`, `memberships`, `group_memberships`, `groups`, `app_roles` and `app_role_permissions` are all `relforcerowsecurity = t`, with a single `tenant_isolation` policy on `role_grants`. `neondb_owner` has `rolbypassrls = t`, so the non-definer `presby_guard_position_needs_membership` trigger **does** see `memberships` when it runs inside the owner's definer function. G3 is therefore a real path, not one that RLS silently blinds.
- **DECISION-039 guards (0014).** These are unchanged. G3 is solved by staying inside them (D4), not by loosening them.
- **Permissions vs Flags.** `FEATURES.ADMIN_ORGANIZATIONS` only (D2). There is no flag (operator rule), no tenant catalog key, and nothing goes into the resolver or a session claim. G13 is confirmed: the JWT carries platform `roles`/`features` and `twoFactorRequired` only, and tenant access is resolved on every request, so a revoked holder loses access on their next request. A stale `twoFactorRequired` after a treasurer revoke only fails stricter, which is harmless.
- **The Brand Is a Cascade Override.** (admin) stays in the platform palette, and no brand components are imported. Phase 4 uses the `Button`/`AlertDialog`/`Textarea` primitives and no hand-rolled class strings (`check:brand-scope` C2).
- **The Proxy Does Not Reach the Database / auth paths.** Untouched. This pipeline does **not** trigger Phase 4's auth-path e2e gate.
- **Never Hard-Delete a Person / roll.** Untouched. Grants are end-dated and never deleted.

## Notes: the rulings Phase 3 must honor

**D1 (G1 / F169): single source, with the asymmetry kept.**
- The list functions are the source and the counts are derived from them, so a drift between "1 person holds this" and "no row to act on" cannot be expressed.
- **The founding-administrator count's asymmetry is kept word for word** in this pipeline: a group arm with no `gm.starts_on` check, no membership join, and no merged-person exclusion. Changing it would move a shipped gate, and 0059 deliberately reserved that for a separate ruling (`docs/TODO.md:210`).
- Keeping it has a benefit here. It is exactly what makes ghost holders *visible* on the founding-administrator list, and therefore revocable. A membership-aware count would hide them while their grants stayed open, and those grants would come back to life if the membership were restored.
- Please amend TODO line 210 to say this: whoever later rules on the asymmetry should pair it with "ghost grants are ended, not hidden".
- The existing DB test that pins the founding-administrator count must pass **unchanged** against the derived body. That is the proof the refactor preserves behaviour.

**D2 (gate): `FEATURES.ADMIN_ORGANIZATIONS`, not live `is_platform_admin`.**
- Granting (invite plus self-designate) is the more consequential half of the chain, and it already sits at this gate. Gating the inverse operation higher would be incoherent.
- DECISION-044's `isPlatformAdmin` exists to gate the Developer portal and to route. Bringing it into one admin action would create a third, ad-hoc authorization pattern in a file where every action uses one.
- The proxy already enforces admin + 2FA on `/admin`. A demoted admin keeps a stale claim until their token refreshes. That is the same exposure the invite action already has, and is not new.

**D3 (G4): office-role grants.** These are not materialized. The stated-clerk grant written by `presby_apply_founding_administrator` is a direct person-arm grant and can be revoked.
- I checked the live templates: `congregation_stated_clerk` carries `{statistics.publish}` and `presbytery_stated_clerk` carries `{credentials.manage, per_capita.manage, statistics.manage}`. **Neither carries `roles.manage` or `role_grants.manage`.** The analyst's premise that ending only the founding-administrator grant leaves the count above 0 is therefore false for the designation's office role as templated.
- An org-local role can still carry the key; one org-scoped `stated_clerk` role on the branch carries `role_grants.manage`. The "contributing grants" rule handles that generically.
- To honor the operator's Q5 default ("the designation's grants for that person ended together"), a person-subject revoke on the founding-administrator slot **also ends the companion office grant**. That is defined by both conditions together: role key in (`congregation_stated_clerk`, `presbytery_stated_clerk`) **and** `grant_reason = 'founding administrator designation'`, effective, same person, same org. The confirm dialog lists it separately as "assigned with the designation". It never affects the count.

**D4 (G3 / F171): ending a ghost holder's grant.**
- For a person-arm grant, set `ends_on := least(current_date, m.ended_on)`. The membership row always exists because of `role_grants_person_fk`. Group-arm grants get `current_date`; the trigger returns early when `person_id` is null.
- **No change to 0014.** The trigger's own hint is "record the position as already ended". The clamp does exactly that, and it keeps both directions of DECISION-039 intact.
- It is truthful about effect. After a membership ends, `resolveOrgContext()` returns `ended` and `withOrgContext()` never runs for that person at that org. So the grant conferred nothing after `ended_on`.
- No `ends_on >= starts_on` CHECK exists (I verified this in the live `pg_constraint`), so the degenerate case of a grant that started after the membership ended still writes and never raises.
- The audit row records `appliedEndsOn` per grant plus `clampedToMembershipEnd`.
- **How reachable it is, stated honestly:** person-arm ghosts are blocked by the DECISION-039 guards and can only exist through data written around them (the branch has 0). *Group-arm* ghosts are reachable today, because nothing ends a managed `group_memberships` row when a membership ends. Only `active_membership` is synced. Those ghosts go through D6, not D4.
- The G3 test fixture has to disable `memberships_guard_end` inside a rolled-back transaction. The owner may do this as table owner.

**D5 (G7 and G11): revoke function mechanics.**
- (a) Validate `p_slot ∈ {founding_administrator, treasurer}` and `p_subject_kind ∈ {person, group}`. The treasurer slot outside `congregation`/`new_worshiping_community` returns `not_applicable`, mirroring `presby_apply_treasurer`.
- (b) Lock the **organization row `for update` first**, the same first lock as accept step 2 and as issue.ts `lockOrganization`. Revoke takes no invitation, users or people lock, so the global order org → invitation → users → person holds, and revoke serializes against accept and issue on the org row.
- (c) Derive the contributing set for (slot, subject) from the list function, plus the companion grant from D3. Then lock those rows with `select … from role_grants where id = any(set) and <effective> for update`. Under READ COMMITTED, the re-check drops a row the org-side `revokeRole()` ended concurrently. The org side never takes the org lock, so there is no deadlock cycle.
- (d) If the set after locking is empty, return **`already_removed`**: no write and no audit row. This covers double submit and the org-side race.
- (e) If the set after locking differs from `p_expected_grant_ids` (compared as sets), return **`changed`**: no write, and the UI refreshes. This rule means the operator can never end a grant the dialog did not name.
- (f) If the subject contributes nothing, or belongs to another org, return **`not_a_holder`**. A forged org id returns `no_organization`. The UI shows one neutral copy for both.
- (g) Otherwise, update `ends_on` and return `revoked` with the ended grant ids, role keys, the applied `ends_on` values, `holder_count_before`/`after` computed under the lock, and the ids of open invitations for the slot. Those invitations are **left open**, per the Q8 default.
- The client supplies only the org id, the slot, the subject id and the grant ids it displayed. The actor comes only from `auth()`. The reason is validated in TypeScript: trimmed, 10–500 characters (this length is my recommendation), rejecting control characters, stored as data and never interpolated.
- The platform path **may reach zero**. That is the point (G8), and it never calls the org-side `self_lockout_blocked` logic.
- One residual race is acceptable: a concurrent org-side `grantRole()` takes no org lock, so `holder_count_after` can be stale by one legitimate congregation grant.

**D6 (narrows Option A; please show the operator): grants held through a derived group are not revocable.**
- The list shows each group as its own subject row: group name plus the number of holder people the list function attributes to it, with no member names.
- For a **managed** group, Revoke ends that group's contributing grants. The confirm says every counted member loses the roles. A person who also holds through a group sees "will still hold this through <group>".
- For a **derived** group (`membership_source = 'derived'`: session, diaconate, active_membership), the row is shown with no Revoke and the text "held through <group>; the congregation's own officers change this".
- Why: (1) a derived group's members are, by construction, live officers or members at the org who can use the Roles page themselves, so this is never a lockout case. (2) The platform ending the Session's role grant is the platform reconfiguring the court's powers, which is governance, not recovery.
- Every recovery case the operator chose Option A for is still covered: dev-seed person grants, ghost person grants, and managed-group grants.

**D7 (audit keys).** Add `ORG_FOUNDING_ADMINISTRATOR_REVOKED: "org.founding_administrator.revoked"` and `ORG_TREASURER_REVOKED: "org.treasurer.revoked"`. They follow the `org.*.designated` precedent for a platform acting on a tenant. They do not reuse `tenant.role.revoked` (the tenant self-service axis) or `invitation.*`.
- Metadata: `organizationId, slot, arm, personId | groupId, grantIds, roleKeys, appliedEndsOn, clampedToMembershipEnd, companionGrantIds, reason, holderCountBefore, holderCountAfter, reachedZero, selfRevoke, openInvitationIds`.
- **No name and no email** in the metadata.
- A row is written only on `revoked`, in the same transaction as the function call.
- The existing `invitation.created.selfAddressed` and `invitation.accepted.inviterIsInvitee` fields are enough to reconstruct the accepted-residual chain. No addition is required.

**D8 (DECISION-195 territory): visibility.**
- Display name only, for both sections. It is read from `people`, and the library never selects any contact or email column. This reverses the treasurer section's "a count, NEVER names" comment, which must be rewritten to cite DECISION-195.
- Each row gets a 44px Revoke button and wraps at 360px with no horizontal scroll. With zero holders, the section shows the existing invite form unchanged.

**Tests Phase 4 must carry** (the implementer writes them; QA runs them):
- **List/count equality** over these fixtures: a group arm with an ended membership, a future-dated group membership, a merged person (counted by founding administrator, not by treasurer), a founding-administrator holder with the companion grant, and a person holding through both arms.
- **The existing founding-administrator count pin**, unchanged.
- **Each revoke outcome**: revoked, already_removed (double submit writes exactly one audit row), changed, not_a_holder (including a cross-org subject), a derived group refused, and the G3 clamp.
- **A revoke racing an accept**, on two connections: one blocks on the org lock, and the end state is consistent.
- **A revoke racing the org-side `revokeRole()`.**
- **Audit metadata**, asserting the absence of name and email.
- **Source scans:**
  - `designation-holders.ts` is imported only from (admin). Extend boundaries S4 rule 2.
  - There is no `update role_grants` or `.update(roleGrants)` under `src/lib/onboarding/` or `src/app/(admin)/`.
  - `role-grants.ts` never imports `getPlatformDb`.
  - The revoke function body writes only `role_grants`.
- **ACL in `scripts/test-rls.sql`** (at integration): `presby_app` is denied EXECUTE on all three new functions.

**Edge cases for Phase 3 to note:**
- A future-dated grant (`starts_on > current_date`) is not a holder, is not listed and is not ended, so it can refill the slot later. Leave it out of scope and mention it in the confirm copy only if cheap.
- A presbytery founding-administrator revoke also removes `congregation_oversight.manage` through the bundle, and the confirm names it.

**Observations, not blocking; for `docs/TODO.md` at integration:**
- **Grant drift (F38-shaped):** in the live ACL, `presby_app` and `presby_platform` both hold **DELETE** on `role_grants`, yet no production code deletes from it. `revokeRole()` says the row is the trail, and FK cascades do not need the privilege. This needs a number assigned outside F169–F171 and a hardening item: revoke DELETE, or document why it is held.
- **G10:** if the operator wants a backfilled audit row for the 2026-10-22 out-of-band end at the operator's first test congregation, it should **not** use the new `org.*.revoked` keys. Those keys assert a reasoned revoke through the function. It should be a one-off row marked as out-of-band.

## Proposed decisions and findings (for the orchestrator to record)

- **DECISION-194: a platform admin may end tenant authority, as recovery only.**
  - **Scope:** the current holders of the founding-administrator and treasurer slots at `/admin/organizations/<id>`. Any effective contributing grant can be revoked (Option A), except a grant held through a derived group and never an officer term.
  - **Gate:** `FEATURES.ADMIN_ORGANIZATIONS` (not `is_platform_admin`; consistent with DECISION-044). No flag.
  - **Controls:** a required reason of 10–500 characters and an `org.*.revoked` audit row in the same transaction.
  - **Accepted residual (operator ruling, 2026-10-22, "No block, audit only"):** revoke, then a self-addressed invitation, then self-acceptance lets the platform role clear a slot and then hold it. The analyst's 30-day refusal and the second-admin rule were both declined. The chain is detected by audit and not prevented, and is marked `paper`.
  - **Documentation:** add the CLAUDE.md Two Hierarchies sentence, and correct `docs/architecture.md:100`.
- **DECISION-195: holder visibility.** Both sections list holders by display name only, never email. This reverses the treasurer section's count-only ruling. Group subjects show the group name and holder count, with no member names. Derived-group rows are shown, with no Revoke.
- **DECISION-196: revoke mechanics (migration 0060).**
  - Two owner-only list functions are the single source, and the counts are derived from them. The founding-administrator count's asymmetry is kept word for word (TODO:210 stays open).
  - One owner-only revoke function:
    - takes the org lock first and then row locks;
    - re-filters effectiveness under the lock;
    - compares against the grant ids the client displayed;
    - returns idempotent outcomes (`revoked | already_removed | changed | not_a_holder | not_applicable | no_organization`).
  - G3 is handled by clamping `ends_on` to the membership end, with no 0014 change.
  - The founding-administrator companion office grant is ended with the person.
  - Open invitations are left open.
  - The code lives in `src/lib/onboarding/designation-holders.ts`, using the platform connection only and imported only from (admin). `role-grants.ts` stays tenant-only.
- **F169 (G1):** the holder list and the holder count could drift, so the operator sees a count with no row to act on. Closed by deriving the count from the list.
- **F170 (G2):** the revoke, self-invite, self-accept takeover chain. **Accepted residual** by operator ruling; this is deliberate, not a gap left open by mistake.
- **F171 (G3):** `role_grants_needs_membership` rejects ending a ghost's grant to today. Closed by the membership-end clamp. Person-arm ghosts are reachable only by data written around the DECISION-039 guards; group-arm ghosts are reachable today and are handled by the group subject.

## Per-Phase Status row

| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-22 |

## Handoff

Next: **tech-lead** (Phase 3). The inputs are D1–D8, DECISION-194–196, F169–F171, and migration `0060_presby_designation_revoke.sql` (0058 stays reserved for custom-domains). Before the design is frozen, please show D6 (the derived-group narrowing of Option A) to the operator. If they widen it, only the eligibility predicate changes. My recommendation for the implementer: **database-admin** for 0060 and its DB tests, then **full-stack-developer** for the library, actions and UI. That split matches the invitations pipeline.

Files read, all in `/Users/cshenso/git/presby-platform/presby-revoke/`:
- `docs/work-log/2026-10-22-designation-revoke.md`
- `drizzle/0059_presby_account_invitations.sql`
- `drizzle/0014_presby_org_router.sql`
- `drizzle/0009_presby_rls.sql`
- `drizzle/0010_presby_resolver.sql`
- `src/app/(admin)/admin/organizations/[id]/actions.ts`
- `src/app/(admin)/admin/organizations/[id]/page.tsx`
- `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.tsx`
- `src/app/(admin)/admin/organizations/[id]/treasurer-designation-section.tsx`
- `src/lib/onboarding/issue.ts`
- `src/lib/onboarding/boundaries.test.ts`
- `src/lib/role-grants.ts`
- `src/lib/db/domain/authz.ts`
- `src/lib/audit.ts`
- `src/lib/authz.ts`
- `src/auth.ts`
- `docs/decisions.md` (DECISION-183–193)
- `docs/architecture.md`
- `docs/TODO.md`

I also ran read-only catalog queries (`default_transaction_read_only = on`) against branch `pipeline-designation-revoke` (endpoint `ep-small-king-axwxwcgr`): `pg_class` RLS flags, `pg_policies`, `aclexplode` on `role_grants` and the function ACLs, `pg_trigger`, `pg_constraint`, `pg_roles.rolbypassrls`, and the role/template permission rows. I wrote no files.

---

### Operator ruling on Phase 2's D6 (2026-10-22)

- **D6 accepted:** grants held through a derived group (session, diaconate, active_membership) are listed with no Revoke button. Option A otherwise stands as ruled.

---

# Phase 3 — Technical Design (tech-lead)

*Written directly by tech-lead, 2026-10-22, against the live `presby-revoke` tree. Inputs: Phase 1 (READY WITH NOTES), the operator rulings block, Phase 2 (Approved with suggestions, D1–D8) and the operator's D6 acceptance. Shared files (`docs/decisions.md`, `docs/TODO.md`, `docs/STATE.md`, `CLAUDE.md`, `drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`) are untouched (Rule 16); everything the orchestrator must place at integration is in "Integration hand-off" below.*

## Summary

A platform admin can end the current holders of an organization's founding-administrator or treasurer slot from `/admin/organizations/<id>`, as lockout recovery. Both sections stop saying "someone already holds this" and instead list the holders by display name only (never email), each row carrying a 44px Revoke button that opens an `AlertDialog` naming the person, the roles that end, what else those roles carry, whether this leaves the slot empty, and a required reason (10–500 characters). The server-side effect is one owner-only `SECURITY DEFINER` function (migration 0060) that is the only platform-side writer of `role_grants.ends_on`: it takes the organization-row lock first, re-derives the contributing grants under row locks, refuses anything the dialog did not name, clamps the end date to the membership end for departed holders (so `role_grants_needs_membership` never fires), and returns an idempotent outcome. The holder counts that gate invitations are re-derived from two new owner-only list functions, so "N people hold this" and "N rows to act on" cannot drift (F169). Grants held through a derived group (session, diaconate, active membership) are listed with no Revoke (D6, accepted by the operator). The revoke-then-self-invite chain is an accepted residual by operator ruling (F170): required reason plus audit, no block. No flag, no new `FEATURES` key, no schema change to any table, no new dependency. Audit rows only; email notifications are a TODO follow-up (Q6).

## Permissions & Flags

- **Permission:** reuse `FEATURES.ADMIN_ORGANIZATIONS` (D2). Same chain as every other action in `actions.ts`: `auth()` → `hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)` → validate → library → `revalidatePath`. No new `FEATURES` key, no tenant catalog key, nothing in the resolver or a session claim. Not `is_platform_admin` (DECISION-044 stays scoped to the Developer portal and routing).
- **Default role bindings:** none new; the existing holders of `ADMIN_ORGANIZATIONS` (platform admins) only.
- **Feature flag:** not needed (operator rule: no new global flags pre-live; a per-org toggle is meaningless for an admin recovery tool). Rollback = code revert; migration 0060 is additive and idempotent (the redefined counts are behaviour-identical, proven by the unchanged pin test).
- **Credential mechanism:** not involved.

## API Contract

One server action, in `src/app/(admin)/admin/organizations/[id]/actions.ts`, following the file's `FormData` convention. The file keeps its "NO `db.*` CALL IN THIS FILE" rule: the action calls the library only.

```ts
export type RevokeHolderActionResult =
  | { ok: true; reachedZero: boolean }
  | { ok: false; error: string; field?: "reason"; refresh?: boolean };

export async function revokeDesignationHolderAction(
  formData: FormData,
): Promise<RevokeHolderActionResult>;
```

FormData fields: `organizationId` (uuid), `slot` (`founding_administrator` | `treasurer`), `subjectKind` (`person` | `group`), `subjectId` (uuid), `expectedGrantId` (repeated, 1–20 distinct uuids: exactly the ids the dialog displayed, contributing plus companion), `reason`.

Server chain, in order:
1. `auth()` → `{ ok:false, error:"Unauthorized." }`; `hasFeature(...)` → `"Forbidden."`.
2. Validate with the file's existing `z`/`UUID_RE` idiom: three uuids, `slot` and `subjectKind` literals, `expectedGrantId` list. Any failure: `"Invalid request."` (one neutral string; never echoes the input).
3. Reason (`reasonSchema`, exported from the library's pure sibling so tests share it): `trim()`, then length counted in code points (`Array.from(s).length`) 10–500, rejecting C0/C1 control characters other than `\n` and `\t`. Errors carry `field: "reason"` (copy below). The reason is stored as data and never interpolated into mail, HTML or SQL (it travels as a bound parameter in `audit_events.metadata` only).
4. `revokeDesignationHolder({ organizationId, slot, subjectKind, subjectId, expectedGrantIds, reason, actor: { userId: session.user.id, email: session.user.email ?? null } })`. The actor comes only from `auth()`; no `next`/redirect field is accepted.
5. Map the result to copy (table in "Copy"); `revalidatePath(`/admin/organizations/${organizationId}`)` on `revoked`, `already_removed`, `changed`, `not_a_holder` (all of which leave the list needing a re-read), with `refresh: true` on the three non-`revoked` ones.

### Library (`src/lib/onboarding/designation-holders.ts`, `import "server-only"`, platform connection only)

```ts
export type DesignationSlot = "founding_administrator" | "treasurer";

export async function listDesignationHolders(
  platformDb: PlatformDb, organizationId: string, slot: DesignationSlot,
): Promise<{ holderPeopleCount: number; rows: HolderRow[] }>;

export type RevokeDesignationHolderResult =
  | { kind: "revoked"; reachedZero: boolean }
  | { kind: "already_removed" } | { kind: "changed" } | { kind: "not_a_holder" }
  | { kind: "derived_group_refused" } | { kind: "not_applicable" }
  | { kind: "no_organization" } | { kind: "invalid_input"; field: "reason" } | { kind: "db_error" };

export async function revokeDesignationHolder(input: {
  organizationId: string; slot: DesignationSlot; subjectKind: "person" | "group";
  subjectId: string; expectedGrantIds: string[]; reason: string; actor: InvitationActor;
}): Promise<RevokeDesignationHolderResult>;
```

- `listDesignationHolders` does four reads on the platform connection, none of them N+1: (1) the slot's list function; (2) for the founding-administrator slot, one lateral query `unnest(person_ids) cross join lateral presby_founding_administrator_companion_grants(org, person_id)`; (3) `people` for the **person-arm subject ids only** (`preferredName ?? firstName` + `lastName`, the `credentials.ts displayNameOf` convention; the select names no contact or email column, and group members are never name-resolved); (4) `app_role_permissions` ⋈ `permissions` for the roles involved, to give the dialog real sentences (`permissions.description`). `holderPeopleCount` is `count(distinct holder_person_id)` of read (1), so `canDesignate = holderPeopleCount === 0` and the displayed count come from the same read as the rows. A failed read throws, exactly as the count reads did (the page error boundary shows; it never renders an empty all-clear and never offers the invite form on a read failure).
- `revokeDesignationHolder` runs one `getPlatformDb().transaction`: `select * from presby_revoke_designation_holder(...)`, and only on `revoked` calls `insertAuditRow(tx, …)` from `@/lib/audit-tx` (the `issue.ts` precedent, so the function's writes and the audit row commit or roll back together; a failed audit insert undoes the revoke). A caught error logs `errorClass(err)` only and returns `db_error`. `uuid[]` is passed as a text literal `{id,id}` cast `::uuid[]` after every id has passed the uuid regex (drizzle's `sql` expands a JS array into a `($1,$2)` record, which is not an array; there is no existing `uuid[]` precedent in `src`). Dates come back from the driver as `YYYY-MM-DD` strings: never `sql<Date>` (`check:sql-date`).
- `selfRevoke` for the audit row = exists `people.user_id = actor.userId` among the function's `revoked_holder_person_ids`.

### Plain props (`src/lib/onboarding/designation-holder-types.ts`, pure types, no imports; client-safe)

```ts
export type HolderRow = {
  key: string;                      // `${subjectKind}:${subjectId}`
  subjectKind: "person" | "group";
  subjectId: string;
  displayName: string;              // person: display name; group: the group's name
  holderPeopleCount: number;        // person: 1; group: people attributed to it (no names)
  since: string;                    // YYYY-MM-DD, earliest contributing grant start
  provenance: "designation" | "other";   // grant_reason is the slot's designation string
  roleNames: string[];              // contributing roles
  companionRoleNames: string[];     // FA person rows only: assigned with the designation
  permissions: { key: string; description: string }[];  // across contributing + companion roles
  grantIds: string[];               // contributing + companion = the dialog's expected set
  alsoThroughGroupNames: string[];  // person rows: other groups the same person holds through
  leavesNoHolders: boolean;         // true when ending this row would take the slot to zero people
  revocable: boolean;               // false for a derived group
  derivedGroupName: string | null;  // set when revocable is false
};
```

`leavesNoHolders` is computed in TS from the same list read: distinct `holder_person_id` among list rows whose `grant_id` is not in this row's contributing ids, `=== 0`. Never an email, never a member name of a group.

## Data Model

**No table, column or index changes. No `schema.ts` change** (so `check-schema-parity` and `db:push` are untouched). One new migration of functions only: `drizzle/0060_presby_designation_revoke.sql` (0058 stays reserved for custom-domains; the journal entry is the orchestrator's at integration). Hand-written, idempotent (`create or replace`, then revoke-then-grant), applied with `psql -1`, and a fix-forward on 0059 (v0.37.0 is shipped). Header comment states the same re-apply instruction 0059 does.

All five new functions: `SECURITY DEFINER`, `set search_path = public, pg_temp`, owned by the migrating owner, and `revoke all … from public, presby_app, presby_platform` (owner only; a cross-org list is an oracle, the 0059 §5 precedent). No `grant execute` anywhere in 0060.

### 0060 §1 — list functions (the single source; D1)

```
presby_founding_administrator_holder_grants(p_org uuid)
presby_giving_manage_holder_grants(p_org uuid)
  returns table (
    grant_id uuid, role_id uuid, role_key text, role_name text,
    arm text,                      -- 'person' | 'group'
    subject_person_id uuid,        -- set when arm = 'person'
    group_id uuid, group_name text, group_membership_source text,  -- set when arm = 'group'
    holder_person_id uuid,         -- the person this row attributes the grant to
    grant_starts_on date, grant_reason text)
  language sql stable security definer
```

One row per (contributing grant, holder person). A person-arm grant yields one row (`holder_person_id = subject_person_id`); a group-arm grant yields one row per attributed member. Each function's predicates are the 0059 count's predicates word for word, with one mechanical change: the permission test is `exists (select 1 from app_role_permissions … )` instead of a join, so a role carrying both keys yields one row, not two (set-equal; `count(distinct)` was already hiding that duplication).

- **Founding administrator** (0059:466-485 lifted): effective grant (`starts_on <= current_date`, `ends_on is null or ends_on > current_date`) of a role carrying `roles.manage` or `role_grants.manage`; group arm through `group_memberships gm` with `gm.group_id = rg.group_id and gm.organization_id = p_org and gm.ends_on is null`. **The asymmetry is kept deliberately** (D1): no `gm.starts_on` check, no `memberships` join, no merged-person exclusion. That is what makes ghost holders visible and therefore revocable. A group grant with no attributable member yields no row (it contributes no holder, as it did not before).
- **Treasurer** (0059:498-525 lifted): `giving.manage`; person arm and group arm (`gm.starts_on <= current_date`, open `gm.ends_on`), then restricted to holders who are non-merged people (`merged_into_id is null`) with an open `memberships` row at `p_org` (`ended_on is null`). Membership-aware, as before. Consequence, stated honestly: a person-arm `giving.manage` grant whose holder's membership ended is not counted, not listed and not revocable here (list = count by construction); it is a latent grant that revives if the membership is restored (TODO line below).
- Join `groups` with `and g.organization_id = p_org` and `app_roles r on r.id = rg.role_id`. Qualify every column (the OUT-column names collide with table column names; if `language sql` objects, rename the OUT columns, not the body).

### 0060 §2 — counts derived from the lists (D1, F169)

`presby_founding_administrator_holder_count(p_org uuid)` and `presby_giving_manage_holder_count(p_org uuid)` are redefined (`create or replace`, same signature, still `returns integer … language sql stable security definer`) as `select count(distinct holder_person_id)::int from presby_…_holder_grants(p_org)`. The two list functions are created first in the file (a `language sql` body is validated at `create`). Callers (`issue.ts`, `presby_apply_founding_administrator`, `presby_apply_treasurer`, `presby_accept_invitation`, the two TS `count*` wrappers) are untouched. **Proof of identical behaviour:** `invitations.db.test.ts`'s "SQL holder counts across holder shapes pin the lifted asymmetry" test passes with no edit, plus the new equality fixtures below.

### 0060 §3 — companion grants (founding administrator only; D3)

`presby_founding_administrator_companion_grants(p_org uuid, p_person_id uuid) returns table (grant_id uuid, role_id uuid, role_key text, role_name text, grant_starts_on date)`: the person-arm effective grants at `p_org` for `p_person_id` whose `grant_reason = 'founding administrator designation'` and whose role (org-scoped, `app_roles.organization_id = p_org`) has `key in ('congregation_stated_clerk', 'presbytery_stated_clerk')`, **and whose `grant_id` is not already in `presby_founding_administrator_holder_grants(p_org)`** (so a custom clerk role that carries `role_grants.manage` is a contributing grant, never also a companion; the sets are disjoint). A fifth function rather than a column on the list because a companion never counts: putting it in the list would make a person who holds only a companion grant a phantom holder. Used by both the revoke function and the library's read (2), so there is exactly one definition.

### 0060 §4 — the revoke function (D5, D4, D6; DECISION-196)

```
presby_revoke_designation_holder(
  p_org uuid, p_slot text, p_subject_kind text, p_subject_id uuid, p_expected_grant_ids uuid[])
returns table (
  outcome text,
  grant_ids uuid[],               -- every grant ended: contributing + companion, ordered by id
  role_keys text[],               -- parallel to grant_ids
  applied_ends_on date[],         -- parallel to grant_ids
  clamped_to_membership_end boolean,
  companion_grant_ids uuid[],     -- the subset of grant_ids that are companions
  revoked_holder_person_ids uuid[],
  holder_count_before integer, holder_count_after integer,
  open_invitation_ids uuid[])
language plpgsql security definer
```
For every outcome other than `revoked` all columns after `outcome` are null. `#variable_conflict use_column`, as in the 0059 apply helpers. Steps, in this order:

1. **Programmer errors raise** (`invalid_parameter_value`): `p_slot` not in `founding_administrator | treasurer`, `p_subject_kind` not in `person | group`, or `p_expected_grant_ids` null/empty. These are bugs, not outcomes (the action validates first).
2. **Org lock first:** `select organization_type from organizations where id = p_org for update`. No row → `no_organization` (also what a forged org id gets). This is the same first lock as `presby_accept_invitation` step 2 and `issue.ts lockOrganization`; revoke takes no invitation, users or people lock, so the global order org → invitation → users → person holds and revoke serializes against accept and issue on the org row.
3. Treasurer slot at an org type outside `congregation`/`new_worshiping_community` → `not_applicable` (mirrors `presby_apply_treasurer`).
4. **Derive** (after the lock, so a fresh snapshot): `v_contrib` = the slot list function's `grant_id`s where (`person`: `arm='person' and subject_person_id = p_subject_id`; `group`: `arm='group' and group_id = p_subject_id`); `v_companion` = for slot FA and kind person, the companion function's ids; `v_all = v_contrib ∪ v_companion`.
5. `v_all` empty → **`already_removed`** if any `p_expected_grant_ids` element is a `role_grants` row **at `p_org`** with `ends_on is not null and ends_on <= current_date` (it was ended after the dialog rendered: double submit, or the org-side `revokeRole()`); otherwise **`not_a_holder`** (never held, wrong subject, or a grant id from another org: the same neutral outcome, no oracle).
6. **D6 as a database property, not paper:** kind `group` and any contributing row has `group_membership_source = 'derived'` → **`derived_group_refused`** (new outcome; Phase 2 listed it only as a test case). The UI never offers the button, but a forged POST is refused by the function itself, so the function can never reconfigure the Session's, Diaconate's or `active_membership` roster powers.
7. **Lock and re-filter:** `select array_agg(id order by id) into v_locked from (select id from role_grants where id = any(v_all) and organization_id = p_org and starts_on <= current_date and (ends_on is null or ends_on > current_date) for update) s`. Under READ COMMITTED the `FOR UPDATE` re-evaluates the effectiveness predicate on a row a concurrent org-side `revokeRole()` just ended and drops it. The org side never takes the org lock, so there is no cycle.
8. `v_locked` null/empty → **`already_removed`** (no write).
9. **Compare as sets:** `v_locked` ≠ distinct-sorted `p_expected_grant_ids` → **`changed`** (no write). The operator can never end a grant the dialog did not name; in particular the companion grant must have been displayed.
10. `holder_count_before := presby_{founding_administrator|giving_manage}_holder_count(p_org)`; `revoked_holder_person_ids` := distinct `holder_person_id` of the list rows for `v_contrib`, captured before the update.
11. **Write (the only platform-side writer of `role_grants.ends_on`, and the only write the function makes):**
    ```sql
    update role_grants rg
       set ends_on = least(current_date, m.ended_on)       -- NULL ignored by least()
      from memberships m
     where rg.id = any(v_locked) and rg.person_id is not null
       and m.person_id = rg.person_id and m.organization_id = rg.organization_id
    returning rg.id, rg.ends_on;
    update role_grants set ends_on = current_date
     where id = any(v_locked) and person_id is null returning id, ends_on;   -- group arm
    ```
    **D4 / F171:** for a person-arm grant the end date is clamped to the membership end. `role_grants_needs_membership` raises only when `ends_on is null or ends_on > membership.ended_on`; `least(current_date, ended_on)` is never greater, so the trigger cannot fire and 0014 is not touched (the trigger's own hint is "record the position as already ended"). It is truthful: after a membership ends `resolveOrgContext()` returns `ended`, so the grant conferred nothing past `ended_on`. `role_grants_person_fk` guarantees the `memberships` row exists, so the join never drops a grant. No `ends_on >= starts_on` CHECK exists, so a grant that started after the membership ended still writes (verified in the live `pg_constraint`). `clamped_to_membership_end` = any applied date < `current_date`.
12. `holder_count_after` re-read (a separate statement, so it sees the update; "may reach zero" is the point, G8: the function never calls the org-side `self_lockout_blocked` logic). One residual race is accepted: an org-side `grantRole()` takes no org lock, so `holder_count_after` can be stale by one legitimate congregation grant.
13. `open_invitation_ids` = this slot's open invitations at `p_org` (all of `accepted_at`, `revoked_at`, `superseded_at`, `blocked_at` null). **Left open** (Q8 default); ids are reported for audit only.
14. Return `revoked`.

The function body writes `role_grants` and nothing else (no `officer_terms`, `group_memberships`, `memberships`, `account_invitations`, `audit_events`); a test scans `pg_get_functiondef` to keep that true. Audit stays in the TS transaction.

## Component / Page Plan

- **Pages to create:** none.
- **Files to create**
  - `drizzle/0060_presby_designation_revoke.sql` — §1–§4 above.
  - `src/lib/onboarding/designation-holders.ts` — library above (server-only, platform connection, imported only from (admin)).
  - `src/lib/onboarding/designation-holder-types.ts` — `HolderRow`, `DesignationSlot`, `RevokeHolderActionResult` (pure, no imports; the client components import types from here, never from the server-only library).
  - `src/lib/onboarding/designation-holder-copy.ts` — pure copy: every outcome string, the dialog sentences as functions of `HolderRow`, the reason-schema messages, and `formatSince("YYYY-MM-DD")` (string split, never `new Date("YYYY-MM-DD")`: `e2e/timezone-safe-dates.spec.ts` is the precedent). Exports `reasonSchema` (zod) used by the action.
  - `src/app/(admin)/admin/organizations/[id]/designation-holder-list.tsx` — client; shared by both sections; the `<ul>` of rows. Row: `flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`, name `break-words`, Revoke `Button variant="outline" className="min-h-11 w-full sm:w-auto"`. Group rows render `{group} (group): {n} people hold this through the group`; derived rows render the explanatory sentence in place of the button.
  - `src/app/(admin)/admin/organizations/[id]/revoke-holder-dialog.tsx` — client; controlled `AlertDialog` + `Textarea` + `useTransition`; plain controlled state, **not `useForm`** (so `check:hydration-gate` does not apply; the textarea mounts only when the dialog opens, which requires hydration, so there is no pre-hydration input to lose; the sections it sits in keep their existing `<HydrationGate>`). `AlertDialogAction` calls `event.preventDefault()` and runs the action (the `send-invitation-dialog.tsx` idiom), staying open on a field error; `refresh`-type results close it and toast. Reason is cleared whenever the dialog opens. No native dialogs (Rule 2).
  - Test files: see Test Plan.
  - `scripts/designation-revoke/test-rls-60.sql` — staged ACL suite (the `scripts/invitations/test-rls-59.sql` precedent: a per-pipeline file the orchestrator includes with one `\ir` line, so `scripts/test-rls.sql` is not edited mid-pipeline).
  - `e2e/designation-revoke.spec.ts`.
- **Files to modify**
  - `src/lib/audit.ts` — two keys (below) and a one-line correction of the 2026-09-28 comment ("revocation rides the existing TENANT_ROLE_REVOKED path": true for the tenant's own revoke, no longer the only path).
  - `src/app/(admin)/admin/organizations/[id]/actions.ts` — `revokeDesignationHolderAction` (+ its reason mapping) beside the invitation actions; reuses `DB_ERROR_COPY` and `UUID_RE`.
  - `.../founding-administrator-section.tsx` — new props `holders: HolderRow[]`, `holderPeopleCount` (replacing `currentHolderCount`); the `!canDesignate` branch renders the lead sentence + `<DesignationHolderList>` + the existing `{list}` (invitation history). `PERMISSION_LABELS`/`summarizePermissions` stay (still used by the invite confirm).
  - `.../treasurer-designation-section.tsx` — same; **rewrite the "a count, NEVER names" prop comment and the header comment to cite DECISION-195** (Phase 2 requirement).
  - `.../page.tsx` — replace the two `count*` reads with `listDesignationHolders(platformDb, id, slot)` (treasurer only when `treasurerApplies`), derive `canDesignate`/count from it, pass `holders`. Drop the now-unused `countFoundingAdministratorHolders`/`countGivingManageHolders` imports from the page (the exports stay: `issue.ts`/accept use the SQL counts). Remove the "a count, never names" comment.
  - `src/lib/onboarding/boundaries.test.ts` — extend S4 (below).
  - `src/lib/db/domain/invitations.db.test.ts` — add the five new signatures to `DEFINER_FUNCTIONS` (none to `APP_EXECUTABLE`) so the ACL, owner and `search_path` assertions cover them. The count-pin test is **not** edited.
  - `src/lib/audit.test.ts` — `EXPECTED_ENTRIES` (typed `Record<keyof typeof AUDIT_ACTIONS, string>`; adding a key without this fails typecheck and the catalog test by design).
- **Do not touch** `src/lib/role-grants.ts` (tenant module; it never imports `getPlatformDb`, a new scan asserts it), `src/lib/permissions.ts`, `src/proxy.ts`, the resolver, any `schema.ts`.

### Audit keys (D7)

`ORG_FOUNDING_ADMINISTRATOR_REVOKED: "org.founding_administrator.revoked"`, `ORG_TREASURER_REVOKED: "org.treasurer.revoked"` (the `org.*.designated` precedent: a platform act against a tenant; `resourceType: "organization"`, `resourceId` = the org id). Written only on `revoked`, in the function's transaction. Metadata, ids/counts/dates/free-text-reason only: `organizationId, slot, arm, personId | groupId, grantIds, roleKeys, appliedEndsOn, clampedToMembershipEnd, companionGrantIds, reason, holderCountBefore, holderCountAfter, reachedZero, selfRevoke, openInvitationIds`. **No name, no email.** Chain reconstruction for the accepted residual uses the existing `invitation.created.selfAddressed` and `invitation.accepted.inviterIsInvitee`; no addition needed.

## Implementation Order

1. **database-admin, Batch A:** `0060` → apply to the `pipeline-designation-revoke` Neon branch with `psql -1` **twice** (idempotence) → `invitations.db.test.ts` (unchanged pin passes; ACL list extended) → `designation-revoke.db.test.ts` → `scripts/designation-revoke/test-rls-60.sql` run as `presby_app`. Gate: all green before Batch B starts, because Batch B's library calls these signatures.
2. **full-stack-developer, Batch B:** audit keys + `audit.test.ts` → pure types/copy/`reasonSchema` → library (+ unit and DB tests) → action (+ tests) → `revoke-holder-dialog` and `designation-holder-list` (+ tests) → the two sections and `page.tsx` (update their existing tests) → `boundaries.test.ts` → `e2e/designation-revoke.spec.ts` → browser verification at 360px (and 1280px) with the dev server → `npm run typecheck`, `lint`, `test`, `check`, `build`.
3. No `FEATURE_CATALOG`/seed step (no permission key, no flag).
4. **Phase 6 housekeeping (tech-lead, after SHIP IT):** `/release-notes` entry (propose **v0.38.0**, a minor: new admin capability; the orchestrator confirms the number against whatever custom-domains ships first) + `package.json` bump; `docs/product/functionality-map.md` (the two sections now list and revoke holders); `docs/architecture.md:100` (Rule 15: the sentence "nothing about the designation lets the platform act inside the organization afterwards" is reversed; update it); the CLAUDE.md Two Hierarchies sentence below. **The release note must not deny the accepted residual** (the revoke-then-self-invite chain): the 0.25.2 lesson is in CLAUDE.md. No what's-new entry (Rule 13: internal admin tooling).

## Test Plan

**Implementer writes, QA runs (Phase 5 re-runs each).** Database tests run serially per `docs/testing.md` against the pipeline branch only, using `src/lib/testing/invitation-fixture.ts` (`makeOrg`, `makePerson`, `enroll`).

*Batch A, `src/lib/db/domain/designation-revoke.db.test.ts`:*
- **List = count equality (F169)** for both slots over: a group arm with an ended membership; a future-dated group membership (FA lists it, treasurer does not); a merged person (FA counts and lists it, treasurer does not); an FA holder with the companion grant (companion absent from the list and the count, present in the companion function); a person holding through both arms (one holder, two rows); a group grant with no members (no row); a role carrying both manage keys (one row, not two). Assert `count = count(distinct holder_person_id)` of the list for every fixture state.
- **Unchanged pin:** `invitations.db.test.ts`'s count pin passes with no edit.
- **Each outcome:** `revoked` (person; managed group); `already_removed` (second identical call; plus a grant ended by the org-side path between render and submit), asserting exactly **no** write on the second call; `changed` (an expected id missing; an extra contributing grant appeared; the companion omitted from the expected set); `not_a_holder` (a person who holds nothing; a **cross-org** subject; a grant id from another org: all the same outcome); `derived_group_refused` for each of session, diaconate and `active_membership`, asserting no grant row changed; `not_applicable` (treasurer at a presbytery); `no_organization` (random uuid). Programmer errors raise (bad slot/kind, empty expected list).
- **G3 clamp:** a ghost holder (person-arm grant, membership ended in the past, built inside a transaction that does `alter table memberships disable trigger memberships_guard_end` and rolls back; the owner may do this as table owner): revoke succeeds, `ends_on = membership.ended_on`, `clamped_to_membership_end = true`, the grant is no longer a holder, no `check_violation`. A normal holder gets `ends_on = current_date`, `clamped = false`. A grant that started after the membership ended still writes.
- **Two grants, one person:** FA person with bundle + companion: both ended together; `companion_grant_ids` names the office grant; an unrelated session-member role and group membership of the same person are untouched; the person's treasurer grant is untouched.
- **Zero is reachable** (no `self_lockout_blocked`): revoking the last holder returns `holder_count_after = 0`; the invitation gate (`presby_apply_*` no longer `has_holders`) then opens.
- **Open invitations left open:** an open invitation survives a revoke and its id is reported.
- **Races, two connections:** (a) revoke vs `presby_accept_invitation` on the same org: one blocks on the org-row lock, end state consistent (the accepted holder is not touched by a revoke of another subject; the revoke of the same subject after accept sees the new grants and, with a stale expected set, returns `changed`); (b) revoke vs concurrent org-side `UPDATE role_grants set ends_on` on one of two grants: `already_removed` or `changed`, never a double write, never a deadlock.
- **ACL and shape:** all five new functions `SECURITY DEFINER`, `search_path = public, pg_temp`, owner-only (`presby_app`, `presby_platform`, `public` hold no EXECUTE); the revoke function's `pg_get_functiondef` mentions no `update`/`insert`/`delete` target other than `role_grants`.

*`scripts/designation-revoke/test-rls-60.sql` (as `presby_app`):* `has_function_privilege` false and a rolled-back call fails with `permission denied` for all five functions and for both redefined counts; `role_grants` still isolates by org. Orchestrator adds `\ir designation-revoke/test-rls-60.sql` at integration and re-runs `scripts/test-rls.sql` on `development`.

*Batch B:*
- **Library unit/DB (`designation-holders.test.ts`, `designation-holders.db.test.ts`):** list rows for each fixture (person row, both-arm person with `alsoThroughGroupNames`, managed group row, derived group row `revocable:false`, `leavesNoHolders`); **no name or email of any group member appears anywhere in the returned object** (serialize and assert); the select names no contact column (source scan of the file); `revoked` writes exactly one audit row with the right key per slot, in the same transaction (a forced audit-insert failure rolls the `ends_on` back); double submit writes one row; `already_removed`/`changed`/refusals write none; metadata contains `reason`, grant ids, role keys, applied dates, counts and `selfRevoke`, and the **absence of name and email** (assert against the fixture person's name and address strings); `selfRevoke` true when the subject person's `user_id` is the actor.
- **Action (`actions.test.ts`, extended):** `Unauthorized.` with no session; `Forbidden.` without `ADMIN_ORGANIZATIONS`; invalid uuid/slot/kind/expected-list → `Invalid request.`; reason too short / too long / control character / whitespace-only → `field: "reason"` with the copy; code-point counting (a 500-emoji reason passes, 501 fails); each library result maps to its copy and `refresh` flag; `revalidatePath` only on the four re-read outcomes; no `db.*`; no redirect/`next` input; the actor is taken from the session even if the form carries a `userId`.
- **Components:** `revoke-holder-dialog.test.tsx` (dialog is an `AlertDialog`; reason required, field error inline with the dialog still open; `leavesNoHolders` sentence; companion line; "will still hold this through" line; group wording; treasurer wording says donor/gift data stays and the platform gains no access; refresh outcomes close and toast; pending state disables both buttons; no native `confirm`). `designation-holder-list.test.tsx` (name only, no email, no member names; derived row has no button and the officers sentence; Revoke has `min-h-11`; very long group name carries `break-words`). Section tests updated: with holders → lead sentence + list + invitation history; zero holders → the unchanged invite form; open invitation + zero holders unchanged.
- **Page (`page.test.tsx`):** props are now `holders` + `holderPeopleCount`; the existing test titled "…the COUNT only (no names are ever passed)" is rewritten to assert the new contract (names yes, emails never, group member names never) rather than deleted; treasurer list read only when `treasurerApplies`; a failed list read throws (no empty all-clear, no invite form).
- **Source scans (`boundaries.test.ts`):** `designation-holders.ts` is imported only from `src/app/(admin)/` (extends S4 rule 2) and itself holds `getPlatformDb`, never the tenant `db`; no `update role_grants`, `.update(roleGrants)` or `ends_on` write under `src/lib/onboarding/` outside the SQL-calling library, and none under `src/app/(admin)/`; `src/lib/role-grants.ts` never imports `getPlatformDb`; the pure `designation-holder-types.ts`/`-copy.ts` import nothing from `@/lib/db` or `server-only` (they are client-safe).
- **`audit.test.ts`:** the two new strings.
- **Existing-spec blast radius (current specs this change alters, found by grep of `e2e/` and `src/`):**
  - `e2e/invitation-existing-account.spec.ts:275-278` asserts `section.getByText("Self-designated")` and `getByText("Accepted", {exact:false}).first()` on the founding-administrator section **after acceptance**, i.e. exactly when the section now also renders a holder row. Playwright strict mode fails on two `Self-designated` matches. **Design rule: a holder row never contains the literal text "Self-designated"** (it is an invitation fact, shown on the invitation history row; grants do not carry it, so Phase 1's stamp on the holder row is dropped and recorded in DECISION-196). The row's provenance strings are "Designated through an invitation" / "Granted another way" and avoid the word "Accepted".
  - `e2e/admin-organizations.spec.ts` blocks "treasurer invitation" (595-) and "founding administrator invitation" (922-): both use throwaway orgs asserted to start with **zero holders** (`holders` length 0 / `grants: 0`), so they render the unchanged invite form; no edit expected, but the implementer runs them as the guard.
  - `src/app/(admin)/admin/organizations/[id]/page.test.tsx:198-310` (count mocks and the exact prop-key set), `founding-administrator-section.test.tsx:255` area and `treasurer-designation-section.test.tsx` (the read-only "already has … who can manage" branch), `actions.test.ts` (new tests only; the existing `has_holders` copy at `actions.ts:726-727` is unchanged), `audit.test.ts` (catalog), `boundaries.test.ts` (extended). Expected, deliberate edits; the implementer names each in Phase 4 notes.
  - No other spec reads the holder sentence (grep for "already has", "already been designated", "who can manage" across `e2e/` and `src/app/(admin)` is clean beyond the files above).
- **e2e (`e2e/designation-revoke.spec.ts`, throwaway org via `setupInviteOrg`, grants seeded with `platformSql()`):** operator sees the holder by display name and no email; Revoke opens the `alertdialog` naming the org, the person and the roles; reason too short shows the inline error and the dialog stays; a valid reason ends the grants (DB: `ends_on = current_date`, unrelated grants intact), shows the success copy, the invite form reappears at zero, and exactly one `org.founding_administrator.revoked` audit row exists with no name/email in its metadata; a second tab submitting the same revoke gets the `already_removed` copy; the treasurer variant on a congregation; a presbytery shows no treasurer section; a derived-group holder row has no button. A second test at a 360x740 viewport asserts `scrollWidth <= clientWidth` on the section and the Revoke button's height >= 44.
- **Manual (Phase 4 gate, not optional):** the dev server, a phone viewport (360px) and desktop; open and cancel the dialog, submit, the long-group-name wrap, the zero-holder state; screenshots named in the Phase 4 notes. This pipeline does **not** touch `src/auth.ts`, `src/proxy.ts`, `(auth)`, `api/auth` or `lib/auth`, so the MFA-enrolled login e2e gate does not apply.

## Copy

All strings live in `designation-holder-copy.ts` (pure, one place). `{name}` is the display name; "slot" wording differs by slot as shown; none include an email, a constraint name or a stack trace.

**Section lead (replaces the read-only sentence):**
- Founding administrator: "{N} {person|people} can manage roles at this organization. When one of its administrators is available, the organization's own Roles page is the better place to change this. End access here to recover from a lockout or a mistaken grant."
- Treasurer: "{N} {person|people} can manage giving at this organization. The treasurer changes the giving team from the organization's own Giving team page. End access here to recover from a lockout or a mistaken grant. Gift and donor records stay as they are, and the platform operator gains no access to them."
- Row: name; "Since {d Mon yyyy}"; provenance "Designated through an invitation" or "Granted another way"; "Roles: {role names}"; person with other routes: "Also holds this through {group names}."; group: "{Group} (group). {n} {person|people} hold this through the group." Derived group (no button): "{Group}. {n} {people} hold this through {group}; the congregation's own officers change this."
- Button: "Revoke" (aria-label "Revoke access for {name}" / "…for the {group} group").

**Confirm dialog.** Title: "End {name}'s access?" (group: "End access for the {group} group?"). Body, in order, each sentence only when it applies:
1. FA: "This ends {name}'s access to manage roles at {org}." Treasurer: "This ends {name}'s access to manage giving at {org}."
2. "These roles end today: {role names}. They carry: {permission descriptions}." (a `<ul>`, `max-h-48 overflow-y-auto`). Presbytery bundle: the descriptions include congregation oversight, so it is named.
3. Companion: "{role} was assigned together with the designation and ends with it."
4. Group: "{n} {people} hold this access through the {group} group. All of them lose it, unless they hold it another way. The group and its members are not changed."
5. `alsoThroughGroupNames`: "{name} will still hold this access through {groups}."
6. `leavesNoHolders`: "{name} is the only person who has this access. Nobody will be able to manage {roles|giving} until you invite a replacement." Otherwise: "Others can still manage {roles|giving} here. If one of them is available, use the organization's own {Roles|Giving team} page instead."
7. Treasurer: "Gift and donor records are not changed, and ending this gives the platform operator no access to them."
8. Always: "This is recorded in the audit log with your reason. You can't undo it here; the organization can grant access again from its own Roles page, or you can invite a replacement."
- Field: label "Reason (kept in the audit log)"; helper "10 to 500 characters. Don't include passwords or personal details."
- Buttons: "Cancel" / "Yes, end access" (destructive); pending: "Ending…".

**Outcomes** (action `error`/toast; `refresh` ones also close the dialog and re-read the list):

| Outcome | Copy | Style |
|---|---|---|
| `revoked` | "Access ended for {name}." (group: "Access ended for the {group} group.") + when `reachedZero`: " Nobody holds this now. Invite a replacement below." | success toast + inline `role="status"` |
| `already_removed` | "That access has already been removed. The list has been refreshed." | info toast, `refresh` |
| `changed` | "This access changed while you were looking. The list has been refreshed. Review it and try again." | info toast, `refresh` |
| `not_a_holder`, `no_organization` | "We couldn't find that access to remove at this organization. The list has been refreshed." (one string for both: no oracle) | info toast, `refresh` |
| `derived_group_refused` | "That group's roster comes from the organization's own officers, so it can't be changed here. The congregation's own officers change it." | inline alert |
| `not_applicable` | "Treasurer access doesn't apply to this type of organization." | inline alert |
| reason empty/short | "Add a reason of at least 10 characters." | field error |
| reason long | "Keep the reason to 500 characters or fewer." | field error |
| reason control chars | "The reason can't contain control characters." | field error |
| no session / no permission | "Unauthorized." / "Forbidden." | inline alert |
| malformed ids | "Invalid request." | inline alert |
| `db_error` | existing `DB_ERROR_COPY` ("We couldn't complete that just now — try again in a moment.") | inline alert; nothing half-written (single transaction) |

## Edge Cases & Risks

- **Redefined counts gate accept and issue.** Highest-risk part of 0060 because the invitation gates now read through the list. Mitigations: unchanged pin test, the equality fixtures, the existing `accept.db.test.ts`, `issue.db.test.ts`, `designation-parity.db.test.ts` run unchanged, and a double `psql -1` apply.
- **Ghost holders.** FA person-arm ghosts (data written around the DECISION-039 guards) are revoked through the clamp. FA group-arm ghosts (a left member still in a managed group; nothing ends managed `group_memberships` on membership end) are revoked by ending the *group's* grant, which affects every member of that group: the dialog says so (point 4). Treasurer ghosts are invisible by the count's own membership-awareness (residual above; a TODO line).
- **Derived-group holders are listed but not revocable** (D6, accepted). If every holder is through a derived group the section can show N>0 with no Revoke; the row text says why. Deliberate: those people are live officers/members who can use the Roles page, so it is never a lockout.
- **Future-dated grants** (`starts_on > current_date`) are not holders, are not listed and are not ended; one can refill the slot later. Out of scope; not mentioned in the dialog (not cheap to say honestly).
- **Revoked holder's session.** Org access is resolved per request, so it ends on the next request; the JWT carries platform roles/features and `twoFactorRequired` only. A stale `twoFactorRequired` after a treasurer revoke only fails stricter (G13, confirmed by the architect). No session claim to refresh.
- **Open invitations survive** a revoke and may become acceptable again; the operator already has Revoke/Revoke-all on them (Q8 default).
- **Notifications:** none (operator ruling). The revoked person and any surviving holders get no mail: TODO follow-up.
- **`holder_count_after` can be stale by one** concurrent tenant-side grant (no org lock on that path). Accepted.
- **`uuid[]` binding** via text literal after regex validation; **date columns** are strings; **`language sql` OUT-column name collisions**: qualify columns.
- **The accepted residual (F170):** revoke → self-addressed invitation → self-accept lets the platform role clear and then hold a slot. Operator ruling "No block, audit only"; not a gap left open by mistake. It is `paper`.
- **Reason is free text in the audit log.** Helper copy warns against personal details; it is stored verbatim by ruling, so it is shown to nobody but audit readers.
- **Native dialogs:** none (`AlertDialog`). **console.log:** none; the library logs `errorClass` via `console.error` only, as `issue.ts` does.

## Out of Scope (user to confirm)

- Any general platform "end any grant" tool; any grant not counted for these two slots (the function refuses by construction).
- Ending officer terms or touching `group_memberships`/`memberships`; changing a derived group's roster or its grants (D6).
- Reinstating a revoked grant (recovery is a new invitation or the org's own Roles page).
- Bulk revoke across organizations; revoke-all within one organization (one person or one group at a time, Q5).
- Emails to the revoked person or surviving holders (Q6, TODO).
- Org-side visibility of who ended a grant and why (no `ended_by`/`ended_reason` columns; Q7 audit-only).
- Changing the founding-administrator count's asymmetry (TODO:210 stays open, amended).
- Ending treasurer person-arm grants whose holder's membership has already ended (invisible to the count).
- Cancelling open invitations at revoke time (Q8); a second-admin rule or a self-invite block (operator declined).
- A what's-new entry; a backfilled audit row for the out-of-band 2026-10-22 SQL end (operator's call; if wanted it is a one-off row marked out-of-band, **not** an `org.*.revoked` key).

## Implementer

**Two batches, as the architect recommends (the invitations-pipeline split):**
1. **database-admin** — migration `0060_presby_designation_revoke.sql`, `designation-revoke.db.test.ts`, the `invitations.db.test.ts` `DEFINER_FUNCTIONS` addition, `scripts/designation-revoke/test-rls-60.sql`. Gate: second `psql -1` apply is a no-op; existing pin test green unchanged; all DB tests green on the pipeline branch only.
2. **full-stack-developer** — audit keys and `audit.test.ts`, pure types/copy, library and its tests, the action and its tests, both components, the two sections, `page.tsx`, `boundaries.test.ts`, the e2e spec, the 360px/desktop browser verification, and the Phase 4 gate (`typecheck`, `lint`, `test`, `check`, `build`).

Not api-developer/ux-developer separately: the server and client halves are small and share one type contract.

### Design decisions taken in Phase 3 that Phase 2 left open (all recorded in DECISION-196)

1. A fifth function (`…companion_grants`) instead of a companion column on the list, so a companion can never count as a holder.
2. A sixth outcome `derived_group_refused`, so D6 is enforced by the database and not only by the UI.
3. One action with a `slot` literal, not two.
4. The page derives `canDesignate` and the displayed count from the same list read the rows come from (no second count query to drift).
5. The holder row never says "Self-designated" (existing e2e strict-mode match); provenance comes from `grant_reason`.
6. `uuid[]` crosses the driver as a validated text literal.
7. Staged ACL assets in `scripts/designation-revoke/` rather than editing `scripts/test-rls.sql`.

## Integration hand-off (orchestrator places these; none written by tech-lead)

### `docs/decisions.md` (newest first, above DECISION-193)

**DECISION-196 — Designation-holder revoke mechanics: owner-only list functions are the single source for the holder counts, one owner-only revoke function with idempotent outcomes, the membership-end clamp, and a platform-connection library imported only from (admin).**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-designation-revoke` (Phase 2 architect D1/D3/D4/D5/D6; Phase 3 tech-lead)

- **(a) Single source (F169).** `presby_founding_administrator_holder_grants(org)` and `presby_giving_manage_holder_grants(org)` return one row per (contributing grant, holder person); the two existing counts are redefined as `count(distinct holder_person_id)` over them, same signatures. The founding-administrator asymmetry (group arm with no date window, no membership join, merged people counted) is **kept word for word**: it is what makes ghost holders visible and therefore revocable, and changing the gate stays the separate ruling `docs/TODO.md` already tracks, now paired with "ghost grants are ended, not hidden".
- **(b) One revoke function** `presby_revoke_designation_holder(org, slot, subject_kind, subject_id, expected_grant_ids)`, owner-only, the only platform-side writer of `role_grants.ends_on`. Order: organization-row `FOR UPDATE` first (the accept/issue order), derive, `FOR UPDATE` the contributing grants re-filtering effectiveness, compare as sets against the ids the dialog displayed. Outcomes: `revoked | already_removed | changed | not_a_holder | derived_group_refused | not_applicable | no_organization`. Zero holders is reachable (recovery); the org-side `self_lockout_blocked` rule is not applied. Open invitations are left open. It writes `role_grants` and nothing else; the audit row is written by the library in the same transaction.
- **(c) Companion grant.** A person revoke on the founding-administrator slot also ends the stated-clerk office grant carrying the designation reason (`…companion_grants`, a separate function so a companion never counts as a holder); the dialog names it.
- **(d) Derived groups refused in the database** (session, diaconate, `active_membership`), not only hidden in the UI: ending their role grants would be the platform reconfiguring the court's powers (governance), not recovery, and their members are live officers or members who can use the Roles page.
- **(e) G3 / F171.** A person-arm grant's end date is `least(current_date, membership.ended_on)`. `role_grants_needs_membership` (0014) is untouched; the clamp is its own hint ("record the position as already ended").
- **(f) Code.** `src/lib/onboarding/designation-holders.ts` (platform connection only, imported only from (admin)); `src/lib/role-grants.ts` stays the tenant module. One server action with a `slot` literal. The page derives the count from the list read. The holder row never carries "Self-designated" (an invitation fact; an existing e2e asserts the literal once). Dates cross the driver as strings; `uuid[]` as a regex-validated text literal.
- **Consequences:** a treasurer person-arm grant for someone whose membership ended is not counted, listed or revocable (list = count by construction). Tests: list = count equality over the holder shapes, every outcome, the clamp, two-connection races, the ACL.

**DECISION-195 — Holder visibility: both designation sections list holders by display name only; group subjects show the group name and a count; derived-group rows are shown with no Revoke.**

**Status:** Resolved (reverses the treasurer section's count-only ruling, DECISION-155's shape) · **Date:** 2026-10-22 · **Feature:** `2026-10-22-designation-revoke` (Phase 1 Q3, operator-ruled "display name only"; Phase 2 D8)

You cannot responsibly revoke an unnamed person, and the confirm must name them. A name is tier-1 directory data; the library selects no contact or email column and resolves names for person-arm subjects only, never for the members of a group. The treasurer section's "a count, NEVER names" comment is rewritten to cite this decision. Naming the holder gives the platform operator no access to anything tier 2 or 3.

**DECISION-194 — A platform admin may end tenant authority, as recovery only: the current holders of the founding-administrator and treasurer slots, behind `FEATURES.ADMIN_ORGANIZATIONS`, with a required reason and an audit row; the revoke-then-self-invite chain is an accepted residual.**

**Status:** Resolved · **Date:** 2026-10-22 · **Feature:** `2026-10-22-designation-revoke` (Phase 1 Q1/Q2/Q4, operator rulings; Phase 2 D2/D6)

- **Scope (Option A, narrowed by D6).** Any effective grant that counts toward the slot, including dev-seed and ghost holders, at `/admin/organizations/<id>`. Never a grant held through a derived group, never an officer term.
- **Gate.** `FEATURES.ADMIN_ORGANIZATIONS` (D2), not the live `is_platform_admin`: the more consequential half of the chain (invite plus self-designate, DECISION-183) already sits at this gate. No flag (operator rule).
- **Controls.** Reason 10–500 characters, an `org.founding_administrator.revoked` / `org.treasurer.revoked` row in the same transaction. Ids and counts only in the metadata; the reason is stored verbatim.
- **Accepted residual (operator ruling 2026-10-22, "No block, audit only").** Revoke, then a self-addressed invitation, then self-acceptance lets the platform role clear a slot and then hold it. The analyst's 30-day refusal and the second-admin rule were both declined. The chain is detected by audit (`org.*.revoked`, then `invitation.created` with `selfAddressed`, then `invitation.accepted` with `inviterIsInvitee`) and not prevented. `paper`.
- **Documentation.** Add the CLAUDE.md Two Hierarchies sentence (Phase 2 proposed text, reviewed by the operator in the diff) and correct `docs/architecture.md:100` at Phase 6.
- Notifications to the revoked person and surviving holders are a tracked follow-up, not part of this decision.

### `docs/schema-design-2.md` (new lettered review-round subsection after 2s, titled "Designation revoke — findings (F169–F171)")

**F169 — the holder list and the holder count could drift.** The count gating invitations and the list an operator acts on were two independent expressions of "who holds this slot", and the founding-administrator count counts people (group arm, ended memberships, merged people) that a naive list would omit; the operator would read "1 person holds this" and have no row to act on. **Closed (0060):** list functions are the source and both counts are `count(distinct holder_person_id)` over them; the unchanged pin test and list = count fixtures hold the line.

**F170 — revoke, then self-invite, then self-accept clears and then holds a slot.** Every step is individually authorized (DECISION-183 self-designation is safe only while nobody holds the slot; revoke opens that gate at will). **Accepted residual by operator ruling ("No block, audit only", 2026-10-22):** detected by audit (`org.*.revoked`, `invitation.created.selfAddressed`, `invitation.accepted.inviterIsInvitee`), not prevented; `paper` in `/developer`. Deliberate, not a gap left open by mistake.

**F171 — `role_grants_needs_membership` refuses to end a departed holder's grant to today.** It raises when `ends_on > memberships.ended_on`, so a ghost holder (membership already ended) could not be end-dated to `current_date`: the people most likely to occupy a stuck slot were the ones the tool could not remove. **Closed (0060):** the person-arm end date is `least(current_date, ended_on)`, which the guard accepts; 0014 untouched. Reachability: person-arm ghosts exist only through data written around the DECISION-039 guards; group-arm ghosts are reachable today and are handled as group subjects.

### `CLAUDE.md` (Key Invariants → Two Hierarchies Intersect Nowhere, after the DECISION-183 sentence; the operator reviews the diff)

Phase 2's proposed text, adopted unchanged:

> A platform admin may also end the current holders of an organization's founding-administrator or treasurer slot from `/admin/organizations/<id>`, as lockout recovery (DECISION-194). It never ends a grant held through a derived group and never touches an officer term, and it requires a reason and writes an audit row. **Accepted residual:** a revoke followed by a self-addressed designation lets the platform role clear a slot and then hold it. That chain is detected by audit (`org.*.revoked`, then `invitation.created` with `selfAddressed`) and is not prevented (operator ruling 2026-10-22). This is `paper`.

### `docs/TODO.md` lines to add or amend at integration

- **Amend line 210** (founding-administrator holder-count asymmetry): add "whoever rules on it pairs it with 'ghost grants are ended, not hidden'; 0060 keeps the asymmetry word for word so ghost holders stay visible and revocable (DECISION-196)."
- **Add:** emails on a platform revoke: the revoked person (neutral, no reason) and any surviving holders (Q6, operator deferred).
- **Add:** grant drift (F38-shaped): `presby_app` and `presby_platform` both hold DELETE on `role_grants` though no production code deletes from it; revoke it or document why (number assigned outside F169–F171).
- **Add:** a treasurer person-arm `giving.manage` grant whose holder's membership has ended is invisible to the count and the revoke list and would revive if the membership were restored; decide whether to end such grants when a membership ends.
- **Add:** ask the operator whether to backfill an audit row for the 2026-10-22 out-of-band SQL end (G10); if yes, a one-off row marked out-of-band, not an `org.*.revoked` key.
- **Move to Done at ship (Rule 10):** this pipeline's own line, with the date.

### Per-Phase Status row (set in the table above)

| 3 — Technical design | tech-lead | Complete | Design complete; implementers named | 2026-10-22 |

### Handoff

Next: **database-admin** (Phase 4 Batch A: `0060` + DB tests + staged RLS file), then **full-stack-developer** (Batch B: audit keys, library, action, UI, e2e, browser verification). Orchestrator, before Batch B: confirm migration 0060 applied to the `pipeline-designation-revoke` branch. Parallel-pipeline note: 0058 is reserved for custom-domains; the `drizzle/meta/_journal.json` entry for 0060, the `\ir designation-revoke/test-rls-60.sql` line and the decision/TODO/schema-design text above are integration-time edits.

Files read (all under the `presby-revoke` worktree): `docs/work-log/2026-10-22-designation-revoke.md`, `drizzle/0059_presby_account_invitations.sql` (counts 459-526, apply helpers 583-715), `drizzle/0014_presby_org_router.sql` (guards 190-240), `src/lib/db/domain/{authz,groups,people}.ts`, `src/lib/onboarding/{issue,founding-administrator,treasurer-designation,boundaries.test,labels}.ts`, `src/lib/{audit,audit-tx,audit.test,credentials}.ts`, `src/lib/db/domain/invitations.db.test.ts`, `scripts/invitations/test-rls-59.sql`, `src/app/(admin)/admin/organizations/[id]/{actions,page,founding-administrator-section,treasurer-designation-section,revoke-all-invitations,send-invitation-dialog}.tsx|ts`, `e2e/admin-organizations.spec.ts`, `e2e/invitation-existing-account.spec.ts`, `docs/decisions.md` (format), `docs/TODO.md:210`.

---

# Phase 4 — Implementation

## Batch A — database-admin (2026-10-22)

*Written directly by database-admin, against the `presby-revoke` worktree and the `pipeline-designation-revoke` Neon branch (endpoint `ep-small-king-axwxwcgr`) only. No Rule 16 shared file was touched: `drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md` and `CLAUDE.md` are unchanged.*

### Files created

- `drizzle/0060_presby_designation_revoke.sql`: functions only, in dependency order. §1 `presby_founding_administrator_holder_grants(uuid)` and `presby_giving_manage_holder_grants(uuid)` (the single source, one row per contributing grant and holder person). §2 the two 0059 counts redefined as `count(distinct holder_person_id)` over the lists, with the same signatures. §3 `presby_founding_administrator_companion_grants(uuid, uuid)`. §4 `presby_revoke_designation_holder(uuid, text, text, uuid, uuid[])`. All are `SECURITY DEFINER` with `set search_path = public, pg_temp`. `revoke all … from public, presby_app, presby_platform` is restated for all six (four new functions and the two redefined counts), and there is no `grant execute` anywhere in the file. Every function has a `comment on function`.
- `src/lib/db/domain/designation-revoke.db.test.ts`: 21 tests, on the owner connection (the 0060 functions are owner-only) plus the `presby_app` connection for the refusals. Uses `createInvitationFixture` (orgs and people stamped `deletable_until` at insert).
- `scripts/designation-revoke/test-rls-60.sql`: staged ACL and isolation section with 19 assertions, run as `presby_app`. It names only the synthetic seed-dev orgs (Alder Creek, Northern Reach).

### Files modified

- `src/lib/db/domain/invitations.db.test.ts`: the four new signatures added to `DEFINER_FUNCTIONS` (none added to `APP_EXECUTABLE`), so the existing ACL, owner and `search_path` assertions cover them. **The count-pin test is not edited.**

### Schema changes

- No table, column, index, policy, trigger or table grant changes, and no `schema.ts` or Drizzle domain-file change. Six function definitions: four new, two redefined (`create or replace`, same signature, owner and ACL preserved).
- **Migration mode: hand-written.** Applied with `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0060_presby_designation_revoke.sql` against `pipeline-designation-revoke` (owner, direct endpoint).
- **Idempotence proof (whole file, twice):** first apply exit 0. Fingerprint taken: every 0060 function's `md5(pg_get_functiondef)`, `prosecdef`, owner, `proconfig`, `proacl` and comment md5; `role_grants` row count and ended count (23 / 0); and the sum of both counts over every organization. Second apply of the whole file exit 0. Re-fingerprint `diff`: **identical**. No row-count change.
- **Behaviour-preservation proof, on the live branch:** the 0059 count bodies, run inline, against the derived 0060 counts for every organization on the branch: 15 orgs, **0 founding-administrator mismatches, 0 treasurer mismatches** (totals 6 / 1).
- **`_journal.json`:** not edited (Rule 16). The orchestrator adds `{ idx: 60, tag: "0060_presby_designation_revoke" }` at integration.

### Test results

| Gate | Result |
|---|---|
| Second `psql -1` apply is a no-op | PASS (whole-file fingerprint identical; see above) |
| `invitations.db.test.ts`, count pin unchanged | PASS: 66/66. Baseline before 0060 was 66/66 (145 s); after 0060, 66/66 on the re-run (see the full-suite note) |
| `designation-revoke.db.test.ts` | PASS: 21/21, on the first run (62 s), in the full suite, and in the re-run |
| `scripts/designation-revoke/test-rls-60.sql` as `presby_app` | PASS: 19/19 assertions, exit 0 |
| `npm run typecheck` | PASS |
| `eslint` on the two touched test files | clean |
| `npm run check:secrets` (new files intent-added) | PASS |
| Full DB suite `npm run test:db` (serial) | 9225 passed, 24 failed, 53 skipped, across 560 files (4640 s). **Every failure passed on a re-run; see the note below.** |

**Full-suite note (infrastructure, not 0060).** The 24 failures in 10 files break down as 17 `Test timed out in 20000ms`, 2 `Hook timed out in 30000ms`, connection drops (`Connection terminated unexpectedly` ×5, `read ECONNRESET` ×1), and the leak canary (`fixture-deletable.test.ts`). The canary was reporting rows left behind by the dropped-connection teardowns plus one row of mine (next paragraph). Re-running the 11 files serially: 9 pass outright, including `invitations.db.test.ts` 66/66 and `designation-revoke.db.test.ts` 21/21. `children.test.ts` passes 24/24 with `--testTimeout=60000`. `org-features.test.ts` passes 29/29 alone with `--testTimeout=90000`, and failed a *different* set of tests on each slower run, which is the signature of a flake. None of `children`, `org-features`, `events`, `staff`, `giving*` or `domains/service` reads a holder count or a 0060 function. QA should expect the same latency-driven timeouts on this branch.

**Fixture rows removed (sanctioned `deletable_until` teardown, pipeline branch only).** (1) My mutation run M4 (below) failed mid-race, so its `afterAll` left one fixture org (`dr-db-…`), its person and two `.invalid` users. I removed them on the owner connection the way the fixture's own `cleanup()` does. (2) The full-suite canary then reported 5 stamped people and 4 stamped orgs still inside their window: one person from (1), whose membership had cascaded away with the org so my first query missed her, and four `giving-db-test-*` orgs with their four people from the dropped-connection `giving.db.test.ts` run. I removed them with the canary's own remedy (stamped rows with `deletable_until > now()` only). The canary is now 5/5 green. Nothing outside a `deletable_until` window was deleted.

**Failing-first proofs (each mechanism broken in a scratch copy of 0060, the targeted test run, then 0060 re-applied; final `pg_get_functiondef` md5 matches the original fingerprint):**

| Mutation | Test that failed |
|---|---|
| M1: clamp removed (`set ends_on = current_date` on the person arm) | "a ghost holder …": the real `role_grants_needs_membership` raised (`Failed query`), so the revoke is not `revoked` |
| M2: D6 check removed (`if false then`) | "derived_group_refused for session, diaconate and active_membership": expected `derived_group_refused`, got `revoked` |
| M3: effectiveness re-filter removed from the `FOR UPDATE` lock | "revoke vs a concurrent org-side end of one grant": `expected 'revoked' to be 'changed'` |
| M4: org-row `FOR UPDATE` removed | both "WAITS" race tests: `expected true to be false` (the other side did not block) |
| ACL: `grant execute on presby_revoke_designation_holder to presby_app` | `test-rls-60.sql` line 62: `FAIL 60a: presby_app may EXECUTE none of the six (owner only) — expected 0, got 1` (grant revoked again, suite green, `proacl` back to `{neondb_owner=X/neondb_owner}`) |

### What the DB suite covers (Phase 3 Test Plan, Batch A)

- **F169 list = count**, both slots, built up step by step on one org with `count(distinct holder_person_id) = count` asserted after every step. Fixtures: a role carrying both manage keys (one row); a managed group with an open member, a member whose group row ended, a future-dated member (founding administrator lists them, treasurer does not), and a member whose *membership* ended (founding administrator lists them, treasurer does not), so the asymmetry is pinned as **listed**, not only counted; a person through both arms (two rows, one holder); a member-less group grant (no row); a merged person (founding administrator yes, treasurer no); a future-dated grant (not a holder). Companion: the real `presby_accept_invitation` designation gives the companion absent from the list and count but present in the companion function. A clerk role given `role_grants.manage` becomes contributing and stops being a companion (disjoint).
- **Outcomes:** `revoked` (person: exact row incl. `applied_ends_on = [today]`, `clamped = false`, counts 2→1; managed group: group and its members unchanged); `already_removed` (double submit, with the second call writing nothing; org-side end before submit); `changed` (a displayed id missing; a contributing grant appeared since; the companion not displayed; expected ids compared as a set, so order and duplicates are irrelevant); `not_a_holder` (holds nothing; cross-org subject; another org's grant id, even an *ended* one, never reads as `already_removed`); `derived_group_refused` (session, diaconate, `active_membership`; no grant changes); `not_applicable` (treasurer at a presbytery); `no_organization`; programmer errors raise `22023` (unknown slot, unknown kind, null, empty, null element).
- **F171 clamp** through the real guard, inside a rolled-back transaction with `memberships_guard_end` disabled to build the ghost. A positive control proves the guard refuses ending to today. Both grants, including one that started *after* the membership ended, end on the membership end date with `clamped = true` and count 1→0. Afterwards the rollback is verified.
- **Two grants, one person:** bundle and companion end together, `companion_grant_ids` names the office grant and `role_keys` maps correctly. The same person's managed-group role, group membership and treasurer grant are untouched.
- **Zero reachable**, after which a fresh designation accepts (the gate reopened). **Open invitations left open:** the founding-administrator invitation is reported and still open; the treasurer one is not reported.
- **Races (two connections):** revoke holds the org lock, accept waits, then accepts (it would otherwise have read `has_holders`); accept holds the org lock, revoke waits, then returns `changed` with a stale set (it would otherwise have read `not_a_holder`); an org-side row-locked end of one of two grants gives `changed` with no double write, and of the only grant gives `already_removed` (the step-8 path). No deadlock.
- **ACL and shape:** all six functions definer, owner `neondb_owner`, `search_path` pinned, no EXECUTE for `presby_app`, `presby_platform` or PUBLIC; every one refused through `presby_app`. The revoke body's write targets (comments stripped) are exactly `{role_grants}`; the list, count and companion bodies are `STABLE` and write nothing.

### Deviations from the Phase 3 design (all narrowings; flag any you disagree with)

1. **A companion grant alone never makes a subject revocable.** Phase 3 step 5 tested `v_all` (contributing ∪ companion) for emptiness. That would let a person who no longer holds the slot, but still holds the designation's stated-clerk grant, have that grant ended by the platform, which is exactly the "general end-any-grant path" Phase 1 G11 and the Out-of-Scope list forbid. Step 5 tests the **contributing** set instead, and the companion is derived only after a subject is confirmed a holder. Covered by "a companion grant alone never makes a subject revocable".
2. **`already_removed` (step 5) also requires the ended displayed grant to belong to the subject** (`person_id` / `group_id` = `p_subject_id`), not just to `p_org`. This is tighter and does not change the neutral copy.
3. **Extra programmer-error raises:** a null `p_org` or `p_subject_id`, and a null element inside `p_expected_grant_ids`.
4. **The treasurer list joins `groups` with a `left join`** (the person arm has no group). The founding-administrator group arm uses an inner join; both are non-filtering because `role_grants_group_fk` is composite. Both lists use `union` (not `union all`), so a holder with two open rows in one group is one row, as the design's "one row per (contributing grant, holder person)" requires.
5. **Companion exclusion uses `rg.id not in (select grant_id from …holder_grants)`** rather than `not exists`. This is set-equal, and safe because `grant_id` is never null.
6. **A defensive raise** after the write if the ended ids differ from the locked ids (`internal_error`). It is unreachable while `role_grants_person_fk` holds, but it refuses rather than report a partial revoke.
7. **Function count.** Phase 3 says "all five new functions" and "add the five new signatures to `DEFINER_FUNCTIONS`", but its own §1–§4 define **four** new functions (two lists, the companion, the revoke) plus the **two redefined** counts. `DEFINER_FUNCTIONS` gains the four new signatures (the two counts were already listed). `test-rls-60.sql` and the DB suite's ACL test cover all six, which pins that `create or replace` kept the counts owner-only. `test-rls-60.sql` also adds a cross-org write probe on `role_grants` (0 rows ended from another org's context).

### Handoff to Batch B (full-stack-developer)

- **Callable now, on `getPlatformDb()` only:** `select * from presby_founding_administrator_holder_grants($org)` / `presby_giving_manage_holder_grants($org)` return columns `grant_id, role_id, role_key, role_name, arm, subject_person_id, group_id, group_name, group_membership_source, holder_person_id, grant_starts_on, grant_reason`. `presby_founding_administrator_companion_grants($org, $person)` returns `grant_id, role_id, role_key, role_name, grant_starts_on`. `presby_revoke_designation_holder($org, $slot, $kind, $subject, $ids::uuid[])` returns one row: `outcome, grant_ids, role_keys, applied_ends_on, clamped_to_membership_end, companion_grant_ids, revoked_holder_person_ids, holder_count_before, holder_count_after, open_invitation_ids` (all null except `outcome` unless `revoked`). Pass `uuid[]` as a regex-validated `{id,id}` text literal cast `::uuid[]`. Dates come back as `YYYY-MM-DD` strings when cast `::text` (the tests do this); never `sql<Date>`.
- **Expected set = contributing ∪ companion**, exactly as the dialog displays it. Omitting the companion yields `changed`.
- **Local apply:** `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0060_presby_designation_revoke.sql` (already applied to `pipeline-designation-revoke`). No seed change.
- **Integration (orchestrator):** the `_journal.json` entry above; `\ir designation-revoke/test-rls-60.sql` at the end of `scripts/test-rls.sql`, then re-run on `development` after 0060 is applied there.
- **Not done here (Batch B or the orchestrator):** audit keys, the library, the action, the UI, the e2e spec, and the decision, TODO and schema-design text.

## Batch B — full-stack-developer (2026-10-22)

*Written directly by full-stack-developer, in the `presby-revoke` worktree against the `pipeline-designation-revoke` Neon branch only. No Rule 16 shared file was touched: `drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `src/lib/db/domain/index.ts` and `CLAUDE.md` are unchanged. No push.*

### Files created

- `src/lib/onboarding/designation-holder-types.ts`: pure, **no imports** (client-safe): `DesignationSlot`, `HolderSubjectKind`, `HolderActor`, `HolderRow`, `RevokeHolderActionResult`.
- `src/lib/onboarding/designation-holder-copy.ts`: pure copy (every string in Phase 3 "Copy"), `reasonSchema` (zod, trimmed, 10 to 500 code points, no C0/C1 control characters except tab and newline), `parseReason`, `formatSince` (string split, never a `Date`), the dialog sentences as functions of `HolderRow`.
- `src/lib/onboarding/designation-holder-rows.ts`: pure assembly of `HolderRow[]` from the SQL rows (see departure 1).
- `src/lib/onboarding/designation-holders.ts`: `server-only`, platform connection only. `listDesignationHolders` (four reads: list function, companion lateral, person-arm names, role permissions) and `revokeDesignationHolder` (one transaction: the SQL function, then on `revoked` only `insertAuditRow(tx, ...)`).
- `src/app/(admin)/admin/organizations/[id]/designation-holder-list.tsx` and `revoke-holder-dialog.tsx` (client; `AlertDialog` + `Textarea`, plain controlled state, not `useForm`).
- `src/app/(admin)/admin/organizations/[id]/holder-row.fixture.ts`: test-support `HolderRow` builders.
- Tests: `designation-holder-copy.test.ts`, `designation-holder-rows.test.ts`, `designation-holders.db.test.ts` (16 tests, real Postgres), `designation-holder-list.test.tsx`, `revoke-holder-dialog.test.tsx`, and `e2e/designation-revoke.spec.ts` (8 tests).

### Files modified

- `src/lib/audit.ts`: `ORG_FOUNDING_ADMINISTRATOR_REVOKED` and `ORG_TREASURER_REVOKED`, plus the correction of the 2026-09-28 "revocation rides TENANT_ROLE_REVOKED" comment. `src/lib/audit.test.ts`: both strings in `EXPECTED_ENTRIES`.
- `actions.ts`: the single `revokeDesignationHolderAction` (still no `db.*` call, no `recordAudit`). `actions.test.ts`: 33 new tests.
- `founding-administrator-section.tsx` / `treasurer-designation-section.tsx`: `currentHolderCount` replaced by `holderPeopleCount` + `holders`; the `!canDesignate` branch renders the lead sentence, the list and the invitation history; a `role="status"` revoke notice is held in section state so it survives the row going away. The treasurer "a count, NEVER names" comment is rewritten to cite DECISION-195. Their tests rewritten for the holders state (the zero-holder invite form and open-invitation states pinned unchanged).
- `page.tsx`: the two `count*` reads replaced by `listDesignationHolders` (treasurer only when `treasurerApplies`); `canDesignate` and the count come from the same read; a failed read throws. `page.test.tsx`: mocks re-pointed, the "COUNT only (no names)" test rewritten to the new contract (names yes, emails never, group member names never) plus failed-read and single-read tests.
- `src/lib/onboarding/boundaries.test.ts`: new S4 block (scan 6).

### Schema changes

None in Batch B (0060 was Batch A's). No `schema.ts` change.

### Audit events

`org.founding_administrator.revoked` and `org.treasurer.revoked`: written only on `revoked`, in the revoke's own transaction; metadata `organizationId, slot, arm, personId | groupId, grantIds, roleKeys, appliedEndsOn, clampedToMembershipEnd, companionGrantIds, reason, holderCountBefore, holderCountAfter, reachedZero, selfRevoke, openInvitationIds`; no name, no email (asserted in the DB test and the e2e spec).

### Action signature and gate

`revokeDesignationHolderAction(formData): Promise<RevokeHolderActionResult>`, `auth()` then `hasFeature(ADMIN_ORGANIZATIONS)` (`Unauthorized.` / `Forbidden.`), then validation (`Invalid request.`), reason (`field: "reason"`), then the library. No flag, no new `FEATURES` key, no new env var.

### Test and gate results

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` (`--max-warnings=0`) | PASS (one unused eslint-disable and one `sql<Date>` mention in a comment, both found by the gates and fixed) |
| `npm run check`, all eight tripwires | PASS: audit, sql-date, deps-drift, brand-scope, secrets, hydration-gate, giving-boundaries, proxy-imports |
| `npm run test` (unit) | PASS: 496 files passed, 69 skipped; 7370 tests passed, 2055 skipped |
| DB tests, serial (`designation-holders`, `designation-revoke`, `invitations`, `issue`, `accept`, `designation-parity`, `audit`) | PASS: 213 tests in the first run, which also had one `afterAll` hook failure in `issue.db.test.ts` coinciding with a Neon DNS drop (ENOTFOUND, the same infrastructure signature Batch A recorded); `issue.db.test.ts` re-run alone 50/50. The `fixture-deletable` leak canary is green (5/5) |
| `npm run build` | PASS, in the hardlinked scratch copy (see departure 4) |
| `e2e/designation-revoke.spec.ts`, real dev server | PASS 8/8 (three runs on final-shape code; the last after the final CSS tweak) |
| Existing-spec blast radius, same dev server: `admin-organizations.spec.ts`, `invitation-existing-account.spec.ts`, `invitation-new-account.spec.ts` | PASS 29/29. This includes the strict-mode "Self-designated" / "Accepted" assertions after acceptance, which is exactly when a holder row now also renders, so the wording rule held |

Environmental note: two e2e runs were lost to network drops (`NeonDbError: fetch failed` / `getaddrinfo ENOTFOUND` on the Neon host, and a transient server-component serialization error that is just the DNS error surfacing). They were re-run after DNS stabilised; every failure in them was a connection failure, none an assertion.

### Browser verification (not just a 200)

Real Chromium, real dev server (Turbopack), signed in as the admin fixture, throwaway congregation, both a person holder and a managed group with a 78-character name (screenshots read, not just taken):

- **360 x 740 (phone):** the section shows the lead sentence, a person row ("Alderic Fennimore", "Since 1 Jan 2020 · Granted another way", "Roles: Portal Administrator", "Also holds this through <the long group name>") and a group row ("<long name> (group)", "1 person holds this through the group."), each with a full-width Revoke button. Nothing scrolls sideways (asserted: section and page `scrollWidth <= clientWidth`; Revoke buttons >= 44 px). The dialog fits the phone, scrolls internally, and its Yes/Cancel buttons are >= 44 px and reachable. Typing "short" and confirming shows the inline red "Add a reason of at least 10 characters." under the textarea with the dialog still open.
- **1280 x 900 (desktop):** rows lay out side by side with Revoke at the right; the dialog is centred with the permission list, the "will still hold this access through ..." sentence, the "Others can still manage roles here" sentence and the reason field.
- **A defect found by looking, fixed:** on the phone the dialog's text and bullet list were centre-aligned (the shadcn `AlertDialogHeader` default below `sm`), which read badly with bullets. Fixed with `text-left` / `place-items-start` on the header and body; re-screenshotted, left-aligned and correct. The page-level state machine (open, too-short reason, valid reason, success notice, form reappears, second-tab "already removed") is exercised by the e2e spec.

### Implementer notes: departures from the Phase 3 design (all narrowings or splits; flag any you disagree with)

1. **`designation-holder-rows.ts` added** (a pure sibling): the row assembly (grouping, `leavesNoHolders`, `alsoThroughGroupNames`, provenance) lives in a pure file so it is unit-tested without a database or a `server-only` mock; the library only does the four reads and calls it. The `HolderGrantRow` / `CompanionGrantRow` shapes are exported from there.
2. **`HolderActor` type** in the types file instead of importing `InvitationActor` from `issue.ts`: the S4 rule-2 scan forbids any non-(admin) importer of `issue.ts`, and the library sits in `src/lib/onboarding/`. The shape is identical.
3. **No `DB_ERROR_COPY` in the copy file.** The action file's own constant is reused, as designed; the copy file documents that.
4. **Build and e2e ran in a scratch copy.** `next dev` and `next build` inside this worktree fail on `Can't resolve '@vercel/turbopack-next/internal/font/google/font'` (the known `turbopack.root`-spans-sibling-worktrees flake, `docs/testing.md`, `docs/TODO.md`); every page 500s. I followed the documented recipe: a copy at `/private/tmp/presby-revoke-e2e/app` (rsync of this worktree, hardlinked `node_modules`, same `.env.local` and Neon branch), re-synced before each run. The tested code is byte-identical to this worktree's.
5. **The e2e spec seeds roles and grants with raw SQL** (`app_roles`, `role_grants` on the owner connection) rather than through the designation flow, to exercise Option A (a dev-seed-style grant with "Granted another way" provenance). The designation-shaped path (bundle plus companion) is covered by the DB suite through the real `presby_accept_invitation`.
6. **Revoke dialog is one `AlertDialog` per row**, each with its own open state (the body mounts with the dialog content, so the reason and errors reset on every open), rather than one shared dialog.
7. **`no_organization`** returns `refresh: true` with the shared not-found copy but does not call `revalidatePath` (the design lists the four re-read outcomes as the only revalidating ones); the dialog also calls `router.refresh()` on any `refresh` result.

### Observations for the orchestrator (nothing edited)

- `scripts/designation-revoke/test-rls-60.sql` still needs its one `\ir` line at integration, as Batch A recorded.
- Retrospective-worthy: the `Turbopack font` worktree flake cost a full e2e cycle again; the self-host-fonts TODO would remove it.
- A treasurer person-arm grant whose holder's membership ended is, by the count's own membership-awareness, not listed and not revocable (Phase 3 residual, already a TODO line).

### Handoff

Next: **qa** (Phase 5). To check in a browser: `/admin/organizations/<id>` for a congregation with a seeded holder: the holder list, the Revoke dialog (reason required, inline error, dialog stays), a successful revoke (notice, invite form returns), the treasurer variant, a derived-group row with no button, 360 px. Not an auth-touching change (`src/auth.ts`, `src/proxy.ts`, `(auth)`, `api/auth`, `lib/auth` untouched), so the MFA-login e2e gate does not apply.

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
