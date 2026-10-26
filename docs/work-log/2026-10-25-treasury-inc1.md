# Treasury Increment 1: Reimbursements, request through paid — Work Log

> **Slug:** `2026-10-25-treasury-inc1` (parent: `2026-10-25-treasury`)
> **Surface:** (org) member reimbursement pages and receipts; (org) treasurer pages under `/admin/reimbursements`
> **Permission(s):** new tier-2 keys `reimbursement.request_for_others`, `reimbursement.view`, `reimbursement.pay`, `reimbursement.manage`. No `reimbursement.request` key (DECISION-269). Approval is a group seat checked live in a definer (DECISION-268).
> **Flag(s):** none. Per-org toggle `org_portal.reimbursement` (`flag: null`, `provisionedOn: false`). No platform flag and no `e2e-baseline-flags.sql` key.
> **Estimated complexity:** large
> **Pipeline mode:** Full (child of the multi-increment program in `2026-10-25-treasury`)
> **Numbers (pre-assigned, Rule 16):** migrations **0073** (schema, triggers, definers, RLS) and **0074** (permissions, template bindings, backfill); DECISION-267–271; F296–F301 (Phase 2); dev port **3590**. F289's migration **0072** (`2026-10-25-public-asset-allowlist`, DECISION-277) sorts first and 0073 depends on it.

Phase 1 (analyst) and Phase 2 (architect) for this increment are recorded verbatim in the parent log, `docs/work-log/2026-10-25-treasury.md`, which also holds the operator rulings. They are not copied here.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (parent log): R1–R15, Q1–Q14 | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Complete (parent log): DECISION-267–271, F296–F301 | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | Complete; implementer named per batch; nine items need a confirmation (see "Needs a confirmation"; two depart from a Phase 2 note). Amendment 2026-10-26 rules Batch 2a's Copy gaps (tiles, gate strings, withdraw/search) and residual 12; second amendment 2026-10-26 rules Batch 4's Copy gaps, X1 to X7, the queue's group filter and residual 13 | Design complete | 2026-10-25 |
| 4 — Implementation | database-admin, api-developer, ux-developer, full-stack-developer (Batches 1–7) | Batch 1a complete (database-admin): 0073 (minus the receipt FK), 0074, mirror, test-rls-73 (52), 83 new Vitest tests. **Batch 2a complete (api-developer)**: shared csv/session/keys, treasury team path + giving wrapper, catalog entry, tiles, off-warning, 12 audit keys, `src/lib/reimbursement/` (pure modules, three gates, requests, reads, config, pickers), member actions without receipts, the team.db fixture ruling applied; 285 new tests; three copy gaps reported (see the Batch 2a section). **Batch 3 complete (api-developer)**: `decisions.ts` (approve on the seat and override paths, send back / not approved), `notices.ts` + `notify.ts` (the four `person:role` notices; submit now tells approvers or pay holders), `approveRequestAction` / `returnRequestAction`, the Phase 3 amendment's Copy (tiles, `copy.ts`), ~115 new tests, decisions/notify/role-bundle DB suites; see the Batch 3 section. **Batch 4 complete (api-developer)**: `payments.ts` (record, reverse, waive, void, note; the `paid` and `closed` notices), `treasurer_list` reader, `csv-export.ts` + the export route (V4), the ten treasurer-tree actions and three team actions, residual-12 characterization, role-bundle payment half, 177 new tests, 168-file DB subset green; Copy gaps and one UI data gap reported (see the Batch 4 section). **Batch 5 complete (ux-developer)**: the member pages (list, new, edit, request, approve / send back, withdraw), the request form with the receipt slot bounded for Batch 2b, 88 + 29 + 15 new unit tests, 18 member e2e + 1 hydration spec green on :3590 and the hydration spec on the production lane :3591; see the Batch 5 section. **Batch 6 complete (ux-developer)**: the treasurer queue, request page, payment form, verb dialogs, settings and Treasury team pages, the C12 string edits and the no-chargeable-group sentence; 14 treasurer e2e + 3 hydration specs green on :3590 and :3591; see the Batch 6 section. **Batch 7 complete (full-stack-developer)**: the printed form (`print-model.ts`, `print.ts`, `GET /o/<slug>/reimbursements/<id>/print`, the Print the form button), `scripts/check-treasury-boundaries.mjs` (T1 to T5) wired into `npm run check` (nine tripwires), the additive `e2e/support/reimbursement-fixture.ts`, and the MFA deep-link, approval, CSV-bytes, role-bundle and toggle specs plus a print test and the Retire long-name check; see the Batch 7 section. **Batch 1b complete (database-admin)**: merged origin/main (0.46.1); 0073 corrected in place with `reimbursement_attachments_blob_fk` (three columns, private-pinned, NO ACTION) and the 0072 guard; test-rls-73 61 (73g new), test-rls-72 25, 9 new Vitest tests, integration patch re-cut (six hunks); see the Batch 1b section. Batch 2b pending (unblocked) | — | 2026-10-26 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 3 — Technical Design (tech-lead)

**Date:** 2026-10-25 · **Author:** tech-lead · **Live tree read:** worktree `presby-treasury` at `b903154` (v0.42.5), and the sibling worktrees `presby-assets` (F289 Phase 2, read in full) and `presby-parish`, `presby-careers` for number collisions. Nothing outside `docs/work-log/` was edited.

## Summary

Reimbursements let a member ask the congregation to pay them back (or pay a vendor) from a phone, let a chair or leader of the charged group approve it, and let the treasurer record the payment, with nothing deleted, nobody approving or paying their own request, and no ledger. The build is six tables in migration 0073 whose state machine, separation of duties and history are enforced by triggers that bind the owner connection too (F44); a closed family of `SECURITY DEFINER` functions that are the only door for `presby_app`; a `src/lib/reimbursement/` module that is the only TypeScript naming those tables; a widened `src/lib/treasury/team.ts` so the treasurer can name a second payer (F296); private receipts through F289's audience API, re-encoded by `sharp` and served only through their request; and two route trees (member, treasurer) behind one gate: toggle, then key or seat, with the Node-side 2FA check on every surface. Migration 0074 adds the keys, binds them to the `treasurer` template and backfills designation-minted treasurer copies. Notices carry no amounts and no free text. The increment ships in eight batches; Batch 2b (receipts) is blocked on F289 merging.

## Rulings made in Phase 3 (P3-n)

Each cites its evidence. P3-1, P3-2 and P3-19 depart from a Phase 2 note and are listed again under "Needs a confirmation".

| ID | Ruling | Evidence |
|---|---|---|
| **P3-1** | **The emailed link is a bare path, `<platform origin>/o/<slug>/reimbursements/<id>` (or `/admin/reimbursements/<id>` for a pay holder), not `/launch?next=…`.** The proxy sends a signed-out visitor to `/signin?callbackUrl=<pathname>` (path only, `src/proxy.ts:112-116`) and `/launch` itself redirects to `/signin?callbackUrl=/launch` (`src/app/launch/page.tsx:49`), so `next` is dropped on the first hop. A bare `/o/…` path survives sign-in and the `/totp` hop (`src/proxy.ts:150-153`), and the sign-in page honours a sanitized `callbackUrl` (`signin/page.tsx:51`). fpcw shipped the same shape (`reimbursement.md` line 244). Finding **F3a**. | proxy, launch and signin read |
| **P3-2** | **`reimbursement.request_for_others` is bound to the `treasurer` template (and backfilled), and a second template role `reimbursement_clerk` (that key only) is added.** With "no default binding" nobody could ever grant the key: `setRolePermissions()` and `assertPermissionSubset()` require the actor to hold every key delegated (DECISION-106/068), the founding administrator does not hold it, and no designation mints it. That is F138 again, and `ledger.approve` is the standing proof. Binding it to the treasurer keeps "no org-wide default" and lets the treasurer, through the treasury team page, set up and grant the narrow clerk role. Finding **F3b**. | `team.ts` header; `role-definitions.test.ts:910`; `authz.test.ts:682` |
| **P3-3** | **Every reimbursement page, action and route runs the Node-side 2FA check** (`assertTreasurySession`, the moved body of `assertGivingSession`), not only `admin/**`. It is a no-op for a requester or approver whose claim does not require 2FA. It closes the stale-claim window where a just-granted treasurer reaches treasurer-level data through the member route. `/reimbursements/[id]` also redirects a viewer who is only a treasury-key holder (not requester, beneficiary or seat) to the admin route. | `giving/access-pure.ts`; `proxy.ts:140-154` |
| **P3-4** | **Categories are one list per organization, required at submit when the org has any active category.** Phase 1 Flow 1 says "if that committee has any"; a per-group list doubles the settings UI for a lookup that a later ledger maps once. A retired category stays on old requests. | Phase 1 R10 |
| **P3-5** | **Saving is two definers.** `presby_reimbursement_save_draft` creates-or-finds by `(org, actor, client_key)`; `presby_reimbursement_update_request` edits by id with `p_expected_revision`. The save action calls the first, and if `created=false` calls the second. A double tap or a lost reply therefore never creates a second request. | DECISION-267 |
| **P3-6** | **Two deferred constraint triggers close the owner-path gaps:** (a) a request is `paid` if and only if it has a live (un-reversed) payment; (b) every status change in a transaction has a matching history event written in that transaction (`created_at = now()`). Together with the transition trigger they make "payment without status", "status without payment" and "transition without history" unrepresentable on any connection. | Phase 1 Pass 5 "State-machine shortcut"; F44 |
| **P3-7** | **The payment definer inserts the payment row and flips the request in one transaction; the reversal does the opposite.** The request trigger permits `approved→paid` only when a live payment exists and `paid→approved` only when none does; there is no GUC marker. | P3-6 |
| **P3-8** | **Revision rules.** `revision` starts at 1 and is incremented by trigger on any change to an editable column and on every receipt attach or detach, only while `draft` or `returned`. A submitted request is frozen, so the revision an approver saw cannot move except through return, edit and resubmit. | DECISION-267 |
| **P3-9** | **"Who approved this beforehand" is optional free text (max 80).** fpcw records a name and runs no workflow on it; a member picker would add a second directory oracle. Deferred: a picker. | Phase 1 Pass 1 step 5 |
| **P3-10** | **Money is integer cents end to end.** The client digit-entry control builds cents; a pasted decimal string is parsed strictly (`pastedAmountToCents`); the server accepts only an integer in range. The maximum is **10,000,000 cents ($100,000.00)**. Nothing is rounded. | Phase 1 Pass 5 "Input boundaries" |
| **P3-11** | **Requester notices are classified `person:role`.** A requester is often staff with only a work address; the notice names no person, amount or purpose. Approver, treasurer and requester notices use one purpose so a recipient gets the same address in all of them. | DECISION-271 asked for the reason |
| **P3-12** | **No count badge on the portal tile.** Tiles are permission-blind static data (DECISION-162); a count would need a per-viewer read. The "waiting for you" count appears on the reimbursements page header. | `tiles.ts` header |
| **P3-13** | **The print route renders the requester-visible projection for whoever prints, and reads the committed fonts by path from `src/lib/giving/statements/fonts/`** (pinned by a file-exists test, with a tracing key added in `next.config.ts`). Relocating the fonts to `src/lib/treasury/fonts/` is deferred as a TODO line. | `next.config.ts:209-220`; `render-pdf.ts` |
| **P3-14** | **Treasury team.** `src/lib/treasury/team.ts` holds the logic; `src/lib/giving/team.ts` becomes a wrapper with `surface: "giving"` that keeps its exported names and result kinds, so `team.db.test.ts` is unchanged. The actor gate is the matching manage key per surface (giving: `giving.manage`; reimbursement: `reimbursement.manage`), which realizes F296's "either key" across two entry points. `givingOnly` becomes "every key's module is in `TREASURY_MODULES`", and each surface lists only roles that carry at least one key of its own module, so the giving page never shows a clerk role. A new `admin/reimbursements/team` page uses new shared components; the giving team UI is not refactored. | F296 |
| **P3-15** | **The toggle is enforced in TypeScript only** (gate order: org type, toggle, then key or seat). The database does not read it. | giving precedent |
| **P3-16** | **CSV.** Includes the purpose column (a treasurer cannot reconcile without it), excludes the pre-approver name and any bank detail, cap **20,000 rows** (413, never truncated), formula guard, audited as a bulk tier-2 export. | DECISION-271 |
| **P3-17** | **Caps.** 5 live receipts per request; 4,000,000 bytes per file (the route accepts a body up to 4,200,000 bytes); 20 open drafts per user; 40 receipt uploads per user per hour (`checkRateLimit`); purpose 500, vendor 120, pre-approver 80, reasons and notes 300 (notes 500), reference 40, category 60 characters. | F299 |
| **P3-18** | **Expense date.** Not in the future (organization-local, `America/New_York` fallback, F132) and not more than 365 days back, checked when the date is first set or edited, not when an unchanged date is resubmitted. | Phase 1 Pass 4 item 8 |
| **P3-19** | **F289 adoption (supersedes parts of DECISION-270; DECISION-277).** The receipt FK is `(blob_key, organization_id, asset_audience) → blob_assets (id, organization_id, audience)` with `asset_audience text not null default 'private'` and a CHECK `= 'private'`; `store()` and `resolve()` take `audience: 'private'` as a string literal at each call site; 0073 requires 0072 applied first. Section "Receipts and the F289 audience API". | coordinator message; F289 Phase 2 R1 step 8, R6 |
| **P3-20** | **Audit rows are written in the same transaction as the transition,** by the `src/lib/reimbursement/` function that calls the write definer, through `insertAuditRow`. A source-scan test pins that every function that calls a write definer also calls `insertAuditRow`, because `check:audit` only looks at `actions.ts` files that call `db.` directly. | `audit-tx.ts`; `check-audit-coverage.mjs` |
| **P3-21** | **Duplicate-receipt flag.** The same `content_sha256` (hash of the bytes as received) on a live attachment of a different request in the org whose `first_submitted_at` is set, that was created earlier and is not `withdrawn` or `voided`. Seat approvers see a yes/no; `view` holders also get the other request's id. The requester never sees it. | DECISION-270 |
| **P3-22** | **Who may end a request.** Withdraw: the creator, or the beneficiary when that person has an account; allowed from `draft`, `submitted`, `returned`, `not_approved`, `approved`. Void: a `pay` holder, from `submitted`, `returned`, `approved`. Neither is possible from `paid`; the only way back from paid is a payment reversal. | DECISION-267 table |
| **P3-23** | **Treasurer notes are internal to the treasury team** (viewers with `view`). Anything the requester should read goes in a return reason. | Phase 1 Flow 4, "add a note to a paid request" |
| **P3-24** | **E2E fixture ids.** `e2e/support/reimbursement-fixture.ts` uses the prefixes `e2e96000-0000-4000-8000-` (people, roles, groups) and `e2e96001-0000-4000-8000-` (the per-run organization). Checked unused across all nine worktrees on 2026-10-25. The orchestrator must confirm the range (Rule 16). | grep of `e2e/` in all worktrees |

### New findings (provisional numbers; the orchestrator assigns F-numbers, none are left in 296–310 for this increment)

| ID | Finding |
|---|---|
| **F3a** | A signed-out click on `/launch?next=/o/<slug>/…` loses `next` at the proxy and again in `/launch`. DECISION-271's note ("each link goes to `/launch?next=…`") would deliver every signed-out approver to the chooser or the org home, not the request. Resolved by P3-1. The `?next=` row of the Post-Login Landing matrix is real but unreachable from a signed-out email link; the matrix needs no change. |
| **F3b** | `reimbursement.request_for_others` with no default binding is undeliverable (nobody can grant it). Resolved by P3-2. Generalizes: any new key that no designated role holds is un-grantable; `ledger.approve` is already such a key. |
| **F3c** | Existing assertions pin the treasurer bundle at exactly the three giving keys and will fail after 0074: `scripts/giving/test-rls-46.sql:1258`, `src/lib/onboarding/designation-parity.golden.json` (three blocks) and `designation-parity.db.test.ts`, and `e2e/invitation-existing-account.spec.ts:342`. They are modify targets, not new tests (see "E2E and test blast radius"). |

## Feasibility check (against the live tree)

| Check | Result |
|---|---|
| Function signatures: parameter defaults trail required ones | No defaulted parameters are used; every definer lists all parameters, actor claim last (the 0055 `p_recorded_by` and 0062 `p_decided_by` shape). |
| `ALTER`/`DROP` of anything other code may depend on | **None.** 0073 and 0074 create tables, triggers, functions, rows. The only existing objects touched are `permissions` (insert), `app_roles` and `app_role_permissions` (insert). Nothing existing is altered or dropped, so no `SECURITY DEFINER` body can lose a dependency. `presby_two_factor_required()` is not replaced: its arm B reads `permissions.requires_two_factor` generically (0055 §18). |
| New CHECKs and triggers against `scripts/seed-dev.sql` and fixtures | The six tables are new, so no existing row is validated. The sibling downward-guard triggers (`administrative_commissions`, `org_delegations`, `app_role_permissions`) are new triggers on existing tables: they fire only for `module = 'reimbursement'`, and no seed or fixture binds such a key to a commission role. `scripts/seed-dev.sql` is not edited (shared file); `scripts/treasury/seed-dev-treasury.sql` plus an `.integration.patch` follow the `person-emails` precedent. |
| New FKs: which column carries the tenant id | All are `(x, organization_id)` composites: `groups(id, organization_id)` (`groups_id_org_key`), `memberships(person_id, organization_id)` (`memberships_person_org_key`), the new tables' own `unique (id, organization_id)`, and `blob_assets(id, organization_id, audience)` (F289's `blob_assets_id_org_audience_key`). Single-column FKs exist only to `organizations(id)` (cascade) and `users(id)` (actor columns, which are not tenant-owned). |
| 0073 against F289 | **Hard dependency.** The receipt FK targets a unique key that exists only after 0072. `presby-assets` has no 0072 file yet (checked). Batch 1 is therefore split: 1a is everything except the receipt FK; 1b adds the FK once 0072 is on the branch (merge the F289 branch, or apply its file, on the pipeline's Neon branch). 0073 must fail loudly on a database without 0072: its first statement in the attachments section asserts the constraint exists and raises a named error otherwise. |
| Migration numbers | `drizzle/` stops at 0064 in this worktree; sibling worktrees hold 0065 (signin-invites), 0067 (events calendar), 0068 (parish). 0072, 0073, 0074 and careers' 0075 are the assigned numbers. Fixed-id template roles use 0000…001–006; 0074 adds `reimbursement_clerk` with a generated id and refers to templates by `key` with `organization_id is null`, so no new fixed id collides with parallel pipelines. |
| `presby_apply_treasurer` | Unchanged. It copies the template's keys at designation time (0059 §6b), so once 0074 binds the new keys, every later designation carries them with no function edit. Its returned `permission_keys` grows, which is why F3c matters. |
| Proxy and auth files | `src/proxy.ts`, `src/auth.ts`, `src/lib/authz.ts`, `src/lib/permissions.ts` are not touched. `app_role_permissions` and `permissions` are data-only changes. This is a full Feature, not Accelerated (migration, keys, routes, definers). |
| `sharp` | Present in the tree as Next's optional dependency; installed as a direct dependency (`npm install sharp@0.35.5 --save-exact`). Next externalizes it by default; whether the Vercel function bundles the native binary is **unverified** until the first preview build (Batch 2b gate). |
| `env` for the worktree | `.env.local` does not exist in `presby-treasury`. Batch 0 (orchestrator): Neon branch for the pipeline, `.env.local` pointing at it with `NEXT_PUBLIC_APP_URL=http://localhost:3590` (the upload route's Origin check and notice links both read it), port 3590. |

## Permissions & Flags

| Key | Tier | `requires_two_factor` | Template binding (0074) | Gate |
|---|---|---|---|---|
| `reimbursement.request_for_others` | 2 | no | `treasurer`; and the `reimbursement_clerk` template (that key only) | enter a request for another member |
| `reimbursement.view` | 2 | **yes** | `treasurer` | read every non-draft request, receipts, history, CSV |
| `reimbursement.pay` | 2 | **yes** | `treasurer` | record and reverse payments; waive a receipt; return an approved request; void; override-approve; notes |
| `reimbursement.manage` | 2 | **yes** | `treasurer` | chargeable groups, categories, the treasury team page |

- **No `reimbursement.request` key.** Who may file is `presby_reimbursement_may_file`: an active membership; an unmerged person linked to the acting user; and `current_roll is not null or engagement_status in ('regular','staff')`.
- **Approval is a seat, not a key.** An eligible approver is the live, unmerged person with an active membership, holding a `group_memberships` row on the request's group with `group_role in ('chair','leader')`, in date, on a group whose `membership_source = 'managed'`, who is not the creator, the beneficiary, or (resolved through `merged_into_id`) the same person as either.
- **Override** needs `reimbursement.pay`, a live finding that no eligible approver exists, and (P3 rule from Q6) at least one other `pay` holder, else the outcome is `needs_second_payer` and nothing changes.
- **Roles that must not carry any money key** (DECISION-078 test): `founding_administrator`, `stated_clerk`, `session_member`, `installed_pastor`. Pinned by a test that reads every template and every designation-minted role.
- **Downward guard (F301).** Sibling triggers `presby_reimbursement_guard_downward_role` (on `administrative_commissions`, `org_delegations`) and `presby_reimbursement_guard_role_binding` (on `app_role_permissions`) mirror 0055 §15 for `module = 'reimbursement'`. They are in 0073, before any key exists. `TREASURY_MODULES` (`src/lib/treasury/modules.ts`) is pinned to the set of modules that have such guards by a DB test.
- **Flags.** None. The toggle entry: key `org_portal.reimbursement`, category `giving`, `flag: null`, `provisionedOn: false`, `operatorEnabled: false`, `orgTypes: ["congregation","new_worshiping_community"]`. The tile `orgTypeScope` is set-equal to it (pinned by `org-feature-catalog.test.ts`).
- **Gate order (every surface):** signed in, then `assertTreasurySession`, then the four-way org miss, then org-type applicability, then the toggle (a missing row is off: HTTP 200 "isn't turned on", never a 404), then the key or seat. A request id the viewer cannot see and one that does not exist give the same response, including timing (one definer call either way).

## Data Model

All DDL is hand-written in `drizzle/0073_presby_reimbursements.sql` and `drizzle/0074_presby_reimbursement_permissions.sql`, idempotent as a whole file (create-if-not-exists, drop-then-add for CHECKs and triggers, `create or replace`, revoke-then-grant, `on conflict`), proven by applying each twice. The Drizzle mirror `src/lib/db/domain/reimbursement.ts` mirrors the six tables for types and the ER diagram; its `index.ts` line is added by the orchestrator at integration (Rule 16). `scripts/check-schema-parity.ts` rows are added for the six tables and the receipt FK.

### Common to all six tables

- `id uuid primary key default gen_random_uuid()`; `organization_id uuid not null references organizations(id) on delete cascade`; `unique (id, organization_id)`.
- `enable` + `force row level security`; one policy `tenant_isolation using/with check (organization_id = presby_current_org())`.
- Grants (after `revoke all … from presby_app, presby_platform, public`): `presby_app` gets **`select` only on the two config tables** and **nothing** on requests, attachments, payments, events. `presby_platform` gets nothing on any of them. No role is granted `delete`.
- A `before delete` guard (`presby_reimbursement_guard_delete`, `security definer`, `search_path = public, pg_temp`) refuses unless the parent `organizations` row is already gone (the org-teardown cascade, after `presby_guard_organizations_delete` has validated the org). No `deletable_until` column is needed: the e2e fixture organization is removed with one `delete from organizations`.
- Every actor column that names a login is `users(id)`; every column that names a person is a **composite** FK `(…_person_id, organization_id) → memberships(person_id, organization_id)`.

### Tables

**`reimbursement_chargeable_groups`**: `group_id uuid not null` with composite FK `(group_id, organization_id) → groups(id, organization_id)`; `created_by_user uuid not null → users`; `created_at timestamptz not null default now()`; `ended_at timestamptz`, `ended_by_user uuid → users`, CHECK `(ended_at is null) = (ended_by_user is null)`. Partial unique index `(organization_id, group_id) where ended_at is null`. Updates only set `ended_*` (guard). Any group of the org may be chargeable, including a derived one (Session, Diaconate): those have no chair or leader rows, so their requests take the override path (operator Q5).

**`reimbursement_categories`**: `name text not null` with CHECK `char_length(name) between 1 and 60 and name = btrim(name)`; `sort_order integer not null default 0`; `created_by_user`, `created_at`, `ended_at`, `ended_by_user` as above. Partial unique index `(organization_id, lower(name)) where ended_at is null`. A retired category stays on old requests; a rename is an `update of name` through the definer and is audited.

**`reimbursement_requests`**

| Column | Type / rule |
|---|---|
| `origin` | `text not null default 'app'`, CHECK in (`app`,`import`). The import door (R13): the CHECKs below admit null actors only for `import`, and the insert trigger lets `import` rows be born in any status. The owner-only importer is Track K and is not built. |
| `kind` | `text not null`, CHECK in (`reimburse`,`vendor`) |
| `status` | `text not null default 'draft'`, CHECK in (`draft`,`submitted`,`returned`,`not_approved`,`approved`,`paid`,`withdrawn`,`voided`) |
| `client_key` | `text`, CHECK `~ '^[A-Za-z0-9_-]{8,64}$'`; `origin = 'import' or client_key is not null`. `unique (organization_id, created_by_user, client_key)` |
| `created_by_user` | `uuid → users`; `created_by_person_id uuid` composite → memberships. Both not null unless `origin = 'import'` |
| `group_id` | `uuid not null`, composite → `groups(id, organization_id)` |
| `category_id` | `uuid`, composite → `reimbursement_categories(id, organization_id)` |
| `beneficiary_person_id` | `uuid`, composite → memberships (the payee when `kind = 'reimburse'`) |
| `vendor_name` | `text` (the payee when `kind = 'vendor'`), 1–120 |
| `amount_cents` | `integer`, CHECK null or between 1 and 10000000; `currency text not null default 'usd'` CHECK `= 'usd'` |
| `expense_date`, `purpose` (1–500), `pre_approved_by_name` (1–80, optional), `no_receipt_claimed boolean not null default false` | nullable while `draft` |
| `revision` | `integer not null default 1`, CHECK `>= 1` |
| `first_submitted_at`, `submitted_at` | `timestamptz` (first submission freezes kind, group, payee; `submitted_at` is the latest, used to sort) |
| approval in force | `approved_at timestamptz`, `approved_by_user uuid → users`, `approved_by_person_id uuid` (composite → memberships), `approval_path text` CHECK in (`seat`,`override`), `approved_revision integer` |
| receipt waiver | `receipt_waived_at`, `receipt_waived_by_user`, `receipt_waived_by_person_id` (composite), `receipt_waiver_note` (≤300) |
| `created_at`, `updated_at` | `timestamptz not null default now()`; `updated_at` set by the update trigger |

CHECKs: kind shape (`reimburse` ⇒ beneficiary not null and vendor null; `vendor` ⇒ beneficiary null and (vendor not null or `status = 'draft'`)); completeness (`status = 'draft'` or amount, expense_date and purpose all not null); approval columns all null or all not null, and `(approved_at is not null) = (status in ('approved','paid'))`; waiver columns all null or all not null, and only while `status in ('submitted','approved','paid')`; the actor-null rule for `import`.

Indexes: `(organization_id, status, approved_at) where status = 'approved'`; `(organization_id, status, submitted_at)`; `(organization_id, created_by_user, created_at desc)`; `(organization_id, beneficiary_person_id) where beneficiary_person_id is not null`; `(organization_id, group_id, status)`.

**`reimbursement_attachments`**: `request_id uuid not null` composite → requests; **`blob_key uuid not null`**; **`asset_audience text not null default 'private'`** with constraint `reimbursement_attachments_asset_audience_private check (asset_audience = 'private')`; FK **`reimbursement_attachments_blob_fk (blob_key, organization_id, asset_audience) → blob_assets (id, organization_id, audience)`**, `NO ACTION` on delete and update (a referenced receipt is undeletable on every connection, F44); `content_sha256 text not null` CHECK `~ '^[0-9a-f]{64}$'` (hash of the bytes **as received**, before re-encoding, for duplicate detection; never joined through `blob_assets`, DECISION-030); `content_type text not null` CHECK in (`image/jpeg`,`application/pdf`) (every accepted image is re-encoded to JPEG); `byte_size integer not null` CHECK `between 1 and 4000000` (stored size); `display_name text not null` (sanitized, 1–80, never a path); `created_by_user uuid not null`; `created_at`; `detached_at`, `detached_by_user` (both or neither). Partial unique `(request_id, content_sha256) where detached_at is null`; index `(organization_id, content_sha256) where detached_at is null`; index `(request_id) where detached_at is null`.

**`reimbursement_payments`** (insert-only; one row per payment and one per reversal, so a later ledger journal entry can composite-FK to `(id, organization_id)`)

| Column | Rule |
|---|---|
| `request_id` | composite → requests |
| `kind` | `payment` or `reversal` |
| `method` | `check`,`ach`,`cash`,`other` (payment rows only) |
| `reference` | ≤40; **required when `method = 'check'`** (the Lions lesson: an unmatchable payment) |
| `paid_on` | date (payment rows only): not in the future (org-local), not before the request's `expense_date` |
| `amount_cents` | snapshot, positive; a trigger checks it equals the request amount (payment) or the offset payment's amount (reversal) |
| `paid_by_user`, `paid_by_person_id` | who recorded it (composite → memberships) |
| `self_paid` | boolean, **derived by the trigger** (`payer ∈ {creator, beneficiary}` after merge resolution); the caller never supplies it |
| `note` | ≤300 |
| `offsets_payment_id`, `reason` | reversal rows only; composite self-FK `(offsets_payment_id, organization_id)`; `reason` required (≤300) |
| shape CHECK | `(kind='payment' and method is not null and paid_on is not null and offsets_payment_id is null and reason is null)` or `(kind='reversal' and offsets_payment_id is not null and reason is not null and method is null and reference is null and paid_on is null)` |

Partial unique index `(offsets_payment_id) where kind = 'reversal'` (one reversal per payment). No fund or account column now: "assign at pay time" is an additive column in Increment 5, and categories are never funds.

**`reimbursement_events`** (insert-only history): `request_id` composite; `kind` CHECK in (`created`,`submitted`,`resubmitted`,`approved`,`override_approved`,`returned`,`not_approved`,`withdrawn`,`voided`,`receipt_waived`,`payment_recorded`,`payment_reversed`,`note`,`imported`); `from_status`, `to_status`; `actor_user_id uuid → users`, `actor_person_id` (composite); `note text` (≤500); `request_revision integer not null`; `payment_id uuid` (composite → payments); `created_at timestamptz not null default now()`. Actors are null only for `kind = 'imported'`. Index `(request_id, created_at, id)`.

### Triggers (all `security definer`, `search_path = public, pg_temp`, fire on every connection)

| Trigger | Table | Enforces |
|---|---|---|
| `…_guard_delete` | all six | delete refused unless the org is gone |
| `…_request_insert_guard` | requests | born `draft`, revision 1, no approval or waiver columns (except `origin = 'import'`) |
| `…_request_update_guard` | requests | **the transition table** `draft→submitted\|withdrawn`; `submitted→approved\|returned\|not_approved\|withdrawn\|voided`; `returned→submitted\|withdrawn\|voided`; `not_approved→withdrawn`; `approved→paid\|returned\|withdrawn\|voided`; `paid→approved`; `withdrawn` and `voided` are terminal. Freeze: kind, group, beneficiary and vendor freeze once `first_submitted_at` is set; amount, date, purpose, category, pre-approver, no-receipt flag change only in `draft`/`returned` and bump `revision` by exactly 1; identity columns never change. `→submitted` stamps the timestamps and requires a live receipt or `no_receipt_claimed`. `→approved`: the approver's person (resolved through merges) and user are not the creator or beneficiary, `approved_revision = revision`, the path is set. A move out of `approved` other than to `paid` clears the approval and waiver columns. `→paid` requires a live payment; `paid→approved` requires none. Waiver columns are set once, only in `submitted`/`approved`. |
| `…_attachment_write_guard` | attachments | insert only while the request is `draft`/`returned`, at most 5 live per request; update only sets `detached_*`, same state rule; after either, bumps the request revision |
| `…_payment_write_guard` | payments | insert only; `payment` requires request `approved`, a live receipt or a waiver, **payer ≠ the approver in force**, no live payment already, derives `self_paid`; `reversal` requires request `paid` and an un-reversed offset payment; `update` always raises |
| `…_event_write_guard` | events | `update` always raises |
| `…_status_payment_consistent` | requests, payments | **deferred constraint trigger**: `status = 'paid'` if and only if a live payment exists |
| `…_status_has_event` | requests | **deferred constraint trigger**: a row inserted or whose status changed has an event with `to_status = new.status` and `created_at = now()` in the same transaction |
| `…_config_guard` | chargeable, categories | update may change only `ended_*` (chargeable) or `name`, `sort_order`, `ended_*` (categories) |
| `presby_reimbursement_guard_downward_role` / `_role_binding` | commissions, delegations, `app_role_permissions` | F301: a `module = 'reimbursement'` key never travels a commission or delegation |

**Named limit (DECISION-268):** the sole-pay-holder exception ("a requester may record payment on their own request only when they are the only effective `pay` holder") needs a count of holders, so it is a definer property (`needs_another_payer`), not a trigger property. The trigger derives and stamps `self_paid` but does not forbid it.

### Migration 0074

1. `permissions`: four rows, `on conflict (key) do update` (module `reimbursement`, tier 2, `requires_two_factor` true for `view`, `pay`, `manage`).
2. `treasurer` template (`organization_id is null and key = 'treasurer'`): bind all four keys, `on conflict do nothing`.
3. New template `reimbursement_clerk` (`role_kind 'custom'`, `is_protected false`, unscoped), generated id, `where not exists` on `(key, organization_id is null)`; bound to `request_for_others` only.
4. **Backfill (DECISION-269):** for each `app_roles` row with `organization_id is not null and key = 'treasurer' and role_kind = 'constitutional' and is_protected`, insert the four keys `on conflict do nothing`. This shape is minted only by `presby_apply_treasurer` (`adoptTemplate()` writes `custom`, unprotected roles), so it is the designation-minted discriminator; `grant_reason` is never used. Never a wildcard; never `founding_administrator`. `development` has 1 such copy; production needs a count (see questions).
5. A closing assertion block raises if the template does not carry the four keys, or if any role other than a designation-minted `treasurer` copy and the two templates carries a reimbursement key.

No `organization_feature_toggles` DDL: the toggle is a catalog entry in code and rows appear when an administrator flips it.

## API Contract

### Layer 1: the SQL doors (EXECUTE granted to `presby_app` only; each derives the org from `presby_current_org()` and includes an explicit `organization_id` predicate)

Conventions (the 0055/0062 shapes): the **bounded actor claim** `p_actor uuid` is a `users.id` bound server-side from the session, last in the list. An **identity** refusal (no live unmerged person with an active membership at the org, or a missing required key) raises `insufficient_privilege` with the single literal `reimbursement: not permitted`. **State** refusals return `outcome` from a closed list pinned to `src/lib/reimbursement/outcomes.ts` by a source-scan test (DECISION-188/198 style). A missing request and a forbidden one both return `not_found` (same path, same reads). Every write locks the request row `FOR UPDATE` first, and nothing else is locked ahead of it. Free text goes through `presby_reimbursement__clean_text` (NFC, control, bidi and zero-width characters removed, whitespace collapsed, trimmed); over-length is a field outcome, never a silent truncation.

| Definer | Caller must be | Parameters (before `p_actor`) | Returns / outcomes |
|---|---|---|---|
| `presby_reimbursement_save_draft` | may-file; `request_for_others` if the beneficiary is someone else | `client_key, kind, group_id, beneficiary_person_id, vendor_name, amount_cents, expense_date, purpose, category_id, pre_approved_by, no_receipt` | `(outcome, request_id, revision, created)`. `ok`, `not_eligible`, `too_many_drafts`, `kind_invalid`, `group_not_chargeable`, `beneficiary_unavailable`, `not_allowed_for_others`, `vendor_too_long`, `amount_out_of_range`, `date_out_of_range`, `purpose_too_long`, `pre_approved_too_long`, `category_unavailable`, `invalid_shape`. Creates or **finds** by `(org, actor, client_key)`; a found row is returned untouched. |
| `presby_reimbursement_update_request` | the creator | `request_id, expected_revision`, then the same field list minus `client_key` | `(outcome, revision)`: the field outcomes plus `not_found`, `not_editable`, `changed_since_viewed`. |
| `presby_reimbursement_submit` | the creator, may-file | `request_id, expected_revision` | `(outcome, route, notify_person_ids, group_name, revision)`. `ok`, `already_submitted` (TypeScript treats it as success), `not_found`, `not_eligible`, `incomplete` (+ `missing text[]`: `amount`,`date`,`purpose`,`payee`,`category`,`receipt`), `group_not_chargeable` (first submission only; a retired group keeps requests it already took), `changed_since_viewed`. `route` is `seat`, `treasurer` or `nobody`, computed live. |
| `presby_reimbursement_withdraw` | creator, or beneficiary with an account | `request_id, reason` | `ok`, `not_found`, `not_withdrawable`. |
| `presby_reimbursement_approve` | an eligible seat holder; or a `pay` holder when none exists | `request_id, expected_revision, path` (`seat`,`override`) | `(outcome, decided_on, notify_requester_person_id, notify_pay_person_ids)`. `ok`, `not_found`, `already_decided`, `changed_since_viewed`, `not_approvable`, `seat_holder_exists`, `needs_second_payer`. |
| `presby_reimbursement_return` | seat holder (from `submitted`); `pay` holder (from `submitted` when no eligible seat exists, and from `approved`) | `request_id, expected_revision, kind, reason` (`needs_info`→`returned`, `not_approved`→`not_approved`; from `approved` only `needs_info`) | `ok`, `not_found`, `already_decided`, `changed_since_viewed`, `not_returnable`, `reason_required`, `reason_too_long`, `kind_invalid`. |
| `presby_reimbursement_void` | `pay` | `request_id, reason` | `ok`, `not_found`, `not_voidable`, `reason_required`. |
| `presby_reimbursement_waive_receipt` | `pay` | `request_id, note` | `ok`, `not_found`, `not_waivable`, `receipt_present`. |
| `presby_reimbursement_record_payment` | `pay` | `request_id, method, reference, paid_on, note` | `ok`, `not_found`, `not_payable`, `receipt_missing`, `payer_is_approver`, `needs_another_payer`, `already_paid`, `method_invalid`, `reference_required`, `date_out_of_range`, `reference_too_long`. |
| `presby_reimbursement_reverse_payment` | `pay` | `request_id, reason` | `ok`, `not_found`, `not_reversible`, `reason_required`. |
| `presby_reimbursement_add_note` | `view` | `request_id, note` | `ok`, `not_found`, `note_required`, `note_too_long`. |
| `presby_reimbursement_receipt_preflight` | the creator | `request_id` | `(outcome, live_count)`: `ok`, `not_found`, `not_editable`, `too_many_receipts`. Called **before** `store()` so a refused upload never writes a blob. |
| `presby_reimbursement_attach_receipt` | the creator | `request_id, blob_key, content_sha256, content_type, byte_size, display_name` | `(outcome, attachment_id)`: `ok`, `not_found`, `not_editable`, `too_many_receipts`, `duplicate_in_request`. |
| `presby_reimbursement_detach_receipt` | the creator | `request_id, attachment_id` | `ok`, `not_found`, `not_editable`. |
| `presby_reimbursement_set_chargeable` | `manage` | `group_id, chargeable` | `ok`, `group_unavailable`, `unchanged`. |
| `presby_reimbursement_save_category` / `_end_category` | `manage` | `category_id (null = create), name, sort_order` / `category_id` | `ok`, `name_invalid`, `name_taken`, `not_found`. |

**Read doors** (same conventions; one internal viewer rule, `presby_reimbursement__viewer_relation(org, user, request)`, returns `creator`, `beneficiary`, `seat` or `treasury`, or null):

- A draft is visible to its creator only.
- From `submitted` on: the creator or the beneficiary (with an account); a **currently eligible** seat holder of the request's group (live, so a seat that ends mid-queue loses access at once); a holder of `reimbursement.view`.

| Read | Gate | Shape |
|---|---|---|
| `presby_reimbursement_may_file(p_actor)` | none | boolean |
| `presby_reimbursement_org_today()` | none | org-local date |
| `presby_reimbursement_my_requests(p_actor, limit, offset)` | none | creator or beneficiary rows: id, status, kind, payee label, amount, expense date, group name, purpose (first 80 characters), revision |
| `presby_reimbursement_waiting_for_me(p_actor)` | seat | submitted rows where the caller is an eligible approver; oldest first |
| `presby_reimbursement_counts(p_actor)` | none | one row: `waiting_for_me`; for `view` holders also `needs_treasurer`, `waiting_for_payment`, `in_progress` |
| `presby_reimbursement_treasurer_list(p_actor, tab, group, from, to, limit, offset)` | `view` | rows with actor names; `tab` in (`pay`,`override`,`progress`,`paid`,`all`) |
| `presby_reimbursement_detail(p_request_id, p_actor, p_level)` | viewer relation | one `jsonb`. `p_level = 'member'` (requester projection: no actor names, no payments, no duplicate flag for the creator, no notes) or `'treasury'` (requires `view`: actor names, payments and reversals, approval path, waiver, notes, duplicate request ids). A seat approver gets the member projection plus the yes/no duplicate flag and the entered-on-behalf flag. The shape is pinned by a zod schema and a golden test. |
| `presby_reimbursement_attachment_lookup(p_request_id, p_attachment_id, p_actor)` | viewer relation | zero rows or `(blob_key, content_type, display_name)` for a live attachment |
| `presby_reimbursement_export_rows(p_actor, from, to, status, limit)` | `view` | one row per request with its live payment; the caller passes `cap + 1` |
| `presby_reimbursement_settings(p_actor)` | `manage` | chargeable groups with current chair/leader counts, other groups, categories, pay-holder count |
| `presby_reimbursement_form_options(p_actor)` | may-file | active chargeable groups (id, name) and active categories (id, name), and whether the caller holds `request_for_others` |
| `presby_reimbursement_pay_holder_count()`, `presby_reimbursement_open_count()` | none (bare counts of `presby_current_org()`) | integers. Readable by an `org_features.manage` holder who holds no money key, which is what the Features page needs; they reveal a number and nothing else. |

Internal helpers (EXECUTE revoked from everyone, called only from the definers): `__clean_text`, `__local_date`, `__actor_persons`, `__actor_holds(org, user, key)` (the 0062 `presby_roll__actor_holds` shape), `__is_eligible_requester`, `__is_seat(org, person, group)`, `__key_holders(org, key)` (the 0060 holder-grants CTE for arms 1 and 2, parameterized by key; commission and delegation arms are absent by construction, F301), `__eligible_approvers`, `__viewer_relation`, `__resolve_person` (follows `merged_into_id`), `__log_event`.

### Layer 2: `src/lib/reimbursement/` (the only TypeScript naming `reimbursement_*` or `presby_reimbursement_*`, T2)

**Pure** (no `server-only`, no database; a `'use client'` file may import only these): `keys.ts` (`REIMBURSEMENT_KEYS`, `REIMBURSEMENT_TOGGLE_KEY`), `limits.ts` (every cap above), `states.ts` (statuses, the transition mirror, human labels), `outcomes.ts` (the closed lists), `amount-input.ts` (`digitsToCents`, `pastedAmountToCents`, `centsToInputText`), `text.ts` (`cleanText`, the TypeScript twin of `__clean_text`), `dates.ts` (floor and ceiling arithmetic on `YYYY-MM-DD` strings), `input.ts` (zod schemas for every action), `copy.ts` (every string in the Copy section), `notices.ts` (builders over `renderEmail`; imports no money or free-text identifier, T4), `csv-shape.ts` (header and row mapping), `print-model.ts` (what the PDF draws).

**Server-only:** `access.ts` (`loadReimbursementContext(viewer)` → `not_applicable` | `toggle_off{canManageFeatures}` | `ok{has:{view,pay,manage,requestForOthers}}`, one transaction, the `giving/access.ts` shape), `gate.ts` (`gateReimbursementPage`, `gateReimbursementAction`, `gateReimbursementRoute`; sign-in, `assertTreasurySession`, org resolve, context, the key needed), `requests.ts` (save, update, submit, withdraw), `decisions.ts` (approve, return), `payments.ts` (record, reverse, waive, void, note), `reads.ts` (lists, detail, counts, export rows, settings, form options), `config.ts` (chargeable groups and categories), `receipts.ts` (preflight, `store`, attach, detach, lookup, `resolve`; the only file in this module that calls the blob store), `pickers.ts` (beneficiary search: `request_for_others`, then `checkDirectoryView`, then `findDirectoryPersonIds` so a hidden person is never offered), `notify.ts` (recipients to `getPersonEmail(tx, id, "role")` to `insertQueueRowInTx`, then `attemptQueuedSend` after commit), `counts.ts` (exports `openRequestCount(tx)` for `org-feature-warnings.ts`, which may not name the function itself), `print.ts` (pdfkit), `csv-export.ts`, `audit.ts` (the in-transaction audit helper).

Every function that calls a write definer runs inside one `withOrgContext(personId, organizationId, tx => …)`: definer call, `insertAuditRow`, `insertQueueRowInTx` for notices, all committed together. `attemptQueuedSend` runs after commit and never throws. If `platformOrigin()` is null (a misconfigured production), no notice is written and the transition still commits; the in-app queue is the fallback.

### Layer 3: server actions (POST; co-located `actions.ts`; each begins `gateReimbursementAction`, takes the **slug**, never an organization id, and never trusts a client person id)

Member tree `src/app/(org)/o/[slug]/reimbursements/actions.ts`:

`saveRequestAction(slug, input) → {ok, requestId, revision} | field errors`; `submitRequestAction(slug, {requestId, expectedRevision}) → {ok, route, groupName} | …`; `withdrawRequestAction(slug, {requestId, reason?})`; `approveRequestAction(slug, {requestId, expectedRevision})`; `returnRequestAction(slug, {requestId, expectedRevision, kind, reason})`; `detachReceiptAction(slug, {requestId, attachmentId})`; `searchBeneficiariesAction(slug, {query})` (names only, at most 8).

Treasurer tree `src/app/(org)/o/[slug]/admin/reimbursements/actions.ts`:

`recordPaymentAction`, `reversePaymentAction`, `waiveReceiptAction`, `treasuryReturnAction`, `voidAction`, `overrideApproveAction`, `addNoteAction`, `setChargeableAction`, `saveCategoryAction`, `endCategoryAction`; and in `admin/reimbursements/team/actions.ts`: `grantTreasuryRoleAction`, `revokeTreasuryRoleAction`, `ensureTreasuryRoleAction` (wrappers over `treasury/team.ts` with `surface: "reimbursement"`, auditing `TENANT_ROLE_GRANTED`/`_REVOKED`/`ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE` with `path: "reimbursement_team"`).

Every action returns `{ ok: true, … }` or `{ ok: false, error, fieldErrors?, kind? }`, where `kind` is `two_factor_required` (with a `redirectTo`), `changed_since_viewed`, `already_decided` (with the date) or `not_found`. A database failure is its own message and never reads as "not allowed".

### Layer 4: route handlers

| Route | Method | Purpose and gate |
|---|---|---|
| `/o/[slug]/reimbursements/[id]/receipts` | POST | Upload one receipt. Order: `auth()` → `assertTreasurySession` → `resolveOrgContext` → toggle → `Origin` equals `platformOrigin()` (a missing or foreign Origin is 403) → rate limit → `Content-Length` precheck (≤ 4,200,000) → `receipt_preflight` → bounded stream read → exactly one file part → magic-byte sniff (png, jpeg, webp, pdf; content, not extension or declared type) → image: `sanitizeImage` / PDF: pass through → `store({…, audience: "private"})` → `attach_receipt` → `{ attachmentId, displayName, byteSize, contentType }`. Plain-word failures: `too_large`, `not_allowed`, `unreadable`, `too_many`, `duplicate`, `not_editable`, `rate_limited`, `two_factor_required`. |
| `/o/[slug]/reimbursements/[id]/receipts/[attachmentId]` | GET | Serve bytes. Same gate; then `attachment_lookup` (viewer relation); then `resolve({…, audience: "private"})`. Headers: `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Security-Policy: sandbox; default-src 'none'`, `Content-Disposition: attachment` for PDF and `inline` for images, a server-chosen filename. A missing, foreign or forbidden id gets one 404 shape. A view by someone other than the creator writes `REIMBURSEMENT_RECEIPT_VIEWED`. |
| `/o/[slug]/reimbursements/[id]/print` | GET | The requester-visible projection as a PDF (pdfkit; `Content-Disposition: attachment`; `no-store`). Any viewer of the request. |
| `/o/[slug]/admin/reimbursements/export` | GET | CSV, `view` + 2FA, filters `from`, `to`, `status`; 413 over 20,000 rows ("Narrow the date range"); audited inside the handler (`REIMBURSEMENT_EXPORTED`: row count and filters only). |

No GET mutates anything: approve, return and every treasurer verb are POST server actions, and the emailed link opens a read-only page. A test renders each page with write functions mocked and asserts none is called, and an e2e reloads a request twice as an approver and compares the event count.

## Receipts and the F289 audience API

Adopted from F289 Phase 2 (R1 step 8, R6, R9; **DECISION-277**), which supersedes these parts of DECISION-270:

| DECISION-270 said | Now (DECISION-277) |
|---|---|
| backfill other rows `public_site`, referenced rows `private` | everything starts `private`; only proven-public rows flip |
| composite FK with an unnamed constant `'private'` column | the column is named **`asset_audience`**, CHECK `= 'private'`, `default 'private'` kept permanently (fail-closed) |
| `store()` takes `audience`, no default | unchanged in TypeScript: **required, string literal at the call site**; the database default stays |
| `resolve()` adds nothing | `resolve()` and `resolveMeta()` also take a required audience and match only it |

- **Receipt FK:** `reimbursement_attachments_blob_fk (blob_key, organization_id, asset_audience) → blob_assets (id, organization_id, audience)`, `NO ACTION`, targeting `blob_assets_id_org_audience_key`. F289's catalog test (every FK into `blob_assets` is either an allowlisted public reference or includes an `asset_audience` pinned to `'private'`) passes for it by construction. A DB test of ours asserts the constraint name, the three columns and `confdeltype = 'a'`.
- **Dependency:** 0073 requires 0072. Its attachments section begins with a guard that raises `reimbursement 0073: apply 0072 (blob_assets audience) first` when `blob_assets_id_org_audience_key` is absent.
- **Call sites** (added to F289's checked-in `{file → audience}` source-scan table, a shared test file the orchestrator merges at integration):

| File | Call | Audience literal |
|---|---|---|
| `src/lib/reimbursement/receipts.ts` | `getBlobStore().store(` | `private` |
| `src/lib/reimbursement/receipts.ts` | `getBlobStore().resolve(` | `private` |

  Nothing else in this increment touches the blob store, and nothing imports `blob_assets`.
- **Dedup:** the store dedups within `(organization, audience, hash)`. Two requests holding the byte-identical re-encoded receipt share one `blob_assets` row and have two attachment rows; neither can read a `public_site` row, and a public image can never resolve a receipt (F298).
- **Sanitizer (`src/lib/storage/image-sanitize.ts`, the only importer of `sharp`, T5):** `sharp(input, { limitInputPixels: 64_000_000 }).rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 })`, never `.withMetadata()`. This applies EXIF orientation, drops EXIF (location data) and every other metadata segment, and neutralizes image/HTML polyglots. If the output exceeds 4,000,000 bytes, retry at quality 70, 60, 50, then refuse as `too_large`. A decode failure is `unreadable`. PDFs are **not** sanitized (accepted residual, DECISION-270): metadata and active content remain, mitigated by `attachment` disposition, the sandbox CSP and `nosniff`; nothing scans for malware (stated plainly in Edge Cases).
- **Client:** the receipt picker downsizes photos in a canvas (long edge 1800, JPEG 0.8) before upload for usability; the server step is the guarantee. The file input never sets `capture`.
- **Orphans:** `store()` and `attach_receipt` run in separate transactions, so an attach failure can leave an unreferenced private blob. No route reaches it. The `receipt_preflight` call before `store()` and the hourly rate limit bound it. Recorded residual.
- **Growth:** receipts in `bytea` grow the database (about 1 GB a year at fpcw scale, per Phase 2). A watch item; the adapter interface allows an object store later.

## Component / Page Plan

No `loading.tsx` on any `[id]` segment (a Suspense boundary would flush a 200 before `notFound()`, measured 2026-08-18). All pages are server components; each states which client islands it uses.

### Pages to create

| Path | Viewer | Notes |
|---|---|---|
| `src/app/(org)/o/[slug]/reimbursements/page.tsx` | any member | "Waiting for your approval" (if any), "Your requests", "New request"; "Treasurer view" link for `view`/`pay`/`manage` holders; states: not applicable, toggle off, ineligible to file (the list still renders), load error |
| `…/reimbursements/new/page.tsx` | may-file | the request form; client islands `request-form.tsx` (a `useForm` root inside `HydrationGate`), `receipt-picker.tsx`, `amount-field.tsx`, `beneficiary-picker.tsx` |
| `…/reimbursements/[id]/page.tsx` | viewer relation | read-only detail; `decision-panel.tsx` (client; `AlertDialog` for Approve, a `useForm` + `HydrationGate` dialog for Send back), `withdraw-dialog.tsx`; redirects a treasury-only viewer to the admin route (P3-3) |
| `…/reimbursements/[id]/edit/page.tsx` | creator, `draft`/`returned` | the same form component, prefilled, with the expected revision |
| `…/reimbursements/[id]/receipts/route.ts`, `…/[attachmentId]/route.ts`, `…/[id]/print/route.ts` | see API | |
| `src/app/(org)/o/[slug]/admin/reimbursements/page.tsx` | `view` | queue: tabs "Waiting for payment", "Needs treasurer approval", "In progress", "Paid", "All"; cards at 360 px, table above; banner when no one holds `pay` |
| `…/admin/reimbursements/[id]/page.tsx` | `view` | treasury detail; `payment-form.tsx` (`useForm` + `HydrationGate`), `treasury-dialogs.tsx` (reverse, void, send back, waive, override, note) |
| `…/admin/reimbursements/settings/page.tsx` | `manage` | chargeable groups, categories |
| `…/admin/reimbursements/team/page.tsx` | `manage` | the treasury team, over `src/components/treasury/team-panel.tsx` |
| `…/admin/reimbursements/export/route.ts` | `view` | CSV |

### Components and libraries to create

`src/components/treasury/team-panel.tsx` (shared by the new team page; the giving team UI is not refactored, a follow-up TODO line); `src/lib/treasury/{modules,keys,session,team}.ts`; `src/lib/csv.ts`; `src/lib/storage/{image-sanitize,upload-request}.ts`; `scripts/check-treasury-boundaries.mjs` (+ test); `e2e/support/reimbursement-fixture.ts`; `src/lib/testing/reimbursement-fixture.ts` (DB-test actors, in the `giving-fixture.ts` style); `scripts/treasury/{test-rls-73.sql,seed-dev-treasury.sql}` and the two `.integration.patch` files; the specs and tests listed below.

### Files to modify

| File | Change |
|---|---|
| `src/lib/giving/csv.ts` | import `csvTextCell`, `centsToDecimal`, the formula guard and CRLF join from `src/lib/csv.ts`, re-exporting the two names; keeps `CSV_HEADER`, row shape, `CSV_MAX_ROWS`, `exceedsCsvCap`. `csv.test.ts` is **unchanged** and must pass byte for byte. |
| `src/lib/giving/keys.ts`, `access-pure.ts` | `holdsPermissions` and the body of `assertGivingSession`/`givingTotpRedirectUrl` move to `src/lib/treasury/{keys,session}.ts`; the giving files re-export the old names (aliases), so every giving import and test is untouched. |
| `src/lib/giving/team.ts` | becomes the `surface: "giving"` wrapper over `treasury/team.ts` (P3-14); exported names and result kinds unchanged. |
| `src/app/(org)/o/[slug]/admin/giving/team/{actions.ts:54,142,team-list.tsx:107}` and `actions.test.ts:140` | "outside Giving" becomes "outside Giving and Reimbursements" (stale after the widening; see Copy check 4). |
| `src/lib/org-features.ts` | the `org_portal.reimbursement` catalog entry |
| `src/lib/org-portal/tiles.ts` | two tiles, `reimbursements` (operate) and `reimbursements-admin` (administer), `domain: "giving"`, `orgFeatureKey`, `orgTypeScope` set-equal to the entry |
| `src/lib/org-feature-warnings.ts` | the registry loader for the new key, over `reimbursement/counts.ts` |
| `src/lib/directory.ts` | one added export, `isDirectoryListedPerson(tx, organizationId, personId)`, built on the existing `directoryEligibilityWhereSql(false)`; no existing function changes (EC17) |
| `src/lib/audit.ts` | `AUDIT_ACTIONS` keys (below) |
| `src/lib/contact-methods/email-audience.ts` | four template keys, all `person:role` |
| `src/lib/db/domain/index.ts` | one export line (orchestrator, Rule 16) |
| `next.config.ts` | `outputFileTracingIncludes` key `/o/*/reimbursements/*/print` with the font and `pdfkit/js/data` globs (this is a shared file; the change is one key) |
| `package.json` / lockfile | `sharp` `0.35.5` direct dependency, exact |
| `package.json` scripts | `check:treasury-boundaries`, appended to `check` (nine tripwires). CLAUDE.md's "eight" → "nine" is the orchestrator's integration edit with approval. |
| `src/app/(admin)/admin/organizations/[id]/treasurer-designation-section.tsx` (~line 230) and `src/lib/onboarding/designation-holder-copy.ts` (lines 146, 270) | stale after the treasurer role gains keys (Copy check 4) |
| `scripts/giving/test-rls-46.sql:1258`, `src/lib/onboarding/designation-parity.golden.json`, `e2e/invitation-existing-account.spec.ts:342` | the treasurer bundle is now seven keys |
| `docs/TODO.md`, `docs/product/functionality-map.md`, `docs/release-notes/` | at ship, by the orchestrator and `/release-notes` (Rules 10, 14) |

### AUDIT_ACTIONS (all `tenant.reimbursement.*`, metadata ids and counts only, never an amount, purpose or name)

`REIMBURSEMENT_APPROVED` (`path`), `REIMBURSEMENT_OVERRIDE_APPROVED`, `REIMBURSEMENT_RETURNED` (`kind`, `byRole`), `REIMBURSEMENT_NOT_APPROVED`, `REIMBURSEMENT_VOIDED`, `REIMBURSEMENT_PAYMENT_RECORDED` (`method`, `selfPaid`), `REIMBURSEMENT_PAYMENT_REVERSED`, `REIMBURSEMENT_RECEIPT_WAIVED`, `REIMBURSEMENT_RECEIPT_VIEWED` (viewer is not the creator), `REIMBURSEMENT_EXPORTED` (row count, filters), `REIMBURSEMENT_CHARGEABLE_CHANGED`, `REIMBURSEMENT_CATEGORY_CHANGED`. Toggle changes use the existing `ORG_FEATURE_TOGGLED`; team grants reuse `TENANT_ROLE_GRANTED`/`_REVOKED`. **Not audited** (the events table is their record): submit, resubmit, withdraw, note, receipt attach and detach. Accepted by design; the tech-lead's call, listed for the QA audit.

## Implementation Order, batches and implementers

Order inside the increment: schema → keys and bindings → pure modules → definer wrappers and actions → UI → audit → notices → print and CSV → tripwire → e2e → release notes. **Batch 0 is not code.**

| Batch | Implementer | Scope | Depends on |
|---|---|---|---|
| **0** | orchestrator | Neon branch for the pipeline, worktree `.env.local` (`NEXT_PUBLIC_APP_URL=http://localhost:3590`, `RATE_LIMIT_DISABLED` per house practice), confirm the `e2e96` fixture range, new migration number for Increment 2 (0074 is taken) | nothing |
| **1a** | **database-admin** | 0073 without the receipt FK; 0074; Drizzle mirror; schema-parity rows; `scripts/treasury/test-rls-73.sql`, `seed-dev-treasury.sql`, the two integration patches; DB tests for triggers, definers, RLS, grants, replay | batch 0 |
| **1b** | database-admin | the attachments FK and its 0072 guard, the catalog assertions | the F289 migration file on the branch (a merge of that branch, or its 0072 applied to the Neon branch) |
| **2a** | **api-developer** | `src/lib/csv.ts` extraction; `src/lib/treasury/{modules,keys,session}.ts` with the giving re-exports; `treasury/team.ts` and the giving wrapper (with the new reimbursement-surface tests; giving's `team.db.test.ts` untouched); catalog entry; tile data; warning loader; audit keys; `reimbursement/{keys,limits,states,outcomes,amount-input,text,dates,input,copy}.ts`, `access.ts`, `gate.ts`, `requests.ts`, `reads.ts`, `config.ts`, `pickers.ts`; the member actions without receipts; unit and DB tests | 1a |
| **2b** | api-developer | **BLOCKED until F289 merges.** `npm install sharp@0.35.5 --save-exact`; `image-sanitize.ts`; `upload-request.ts`; `receipts.ts`; the two receipt routes; the F289 call-site rows; tests with synthetic image bytes (EXIF GPS fixtures built with `sharp` in the test, no real photo) | 1b, F289 merged |
| **3** | api-developer | `decisions.ts` (approve, return), `notify.ts`, `notices.ts`, the four `EMAIL_AUDIENCE` entries, `approveRequestAction`/`returnRequestAction`, role-bundle and seat-lifecycle DB tests | 2a |
| **4** | api-developer | `payments.ts`, treasurer reads, treasurer actions, `team/actions.ts`, `csv-export.ts` and the export route, backfill and bundle DB tests | 3 |
| **5** | **ux-developer** | member pages: list, `new`, `edit`, detail, `decision-panel`, `request-form`, `amount-field`, `beneficiary-picker`, `withdraw-dialog`; the receipt picker once 2b is merged (until then the form hides it behind a `receiptsAvailable` prop that is false in this batch only) | 2a, 3 |
| **6** | ux-developer | treasurer pages: queue, detail, payment form, dialogs, settings, team page and `team-panel`, the no-pay-holder banner, the Features-page off warning copy check, the designation-dialog and giving-team string edits | 4 |
| **7** | **full-stack-developer** | `print.ts` and the print route; `scripts/check-treasury-boundaries.mjs` and its test, wired into `check`; `e2e/support/reimbursement-fixture.ts`; the four e2e specs and the `e2e/hydration/` entry; the 360 px walk; verification that `npm run check`, typecheck, lint, build and the DB suite pass | 5, 6 |

Gates for every batch: tests written by the implementer; `npm run typecheck`, `npm run lint`, `npm run check` zero violations, `npm run build`; no native dialogs; no `console.log`; no `getPlatformDb()`; audit events for the mutations listed. Batch 2b adds: a preview build proving `sharp` loads on Vercel (unverified until then). Batch 7 adds: the MFA-enrolled e2e below, because the increment touches the sign-in path indirectly (deep link through `/signin` and `/totp`), even though it edits none of `src/auth.ts`, `src/proxy.ts`, `src/app/(auth)/`, `src/app/api/auth/` or `src/lib/auth/`.

## E2E and test blast radius

### Existing assertions this change alters (modify, do not just add)

| Existing | Why it changes |
|---|---|
| `scripts/giving/test-rls-46.sql:1258` ("the treasurer template carries exactly giving.view, giving.record, giving.manage") | 0074 binds four more keys. Update to the seven-key set; keep the intent (an exact list). |
| `src/lib/onboarding/designation-parity.golden.json` (three treasurer blocks) and `designation-parity.db.test.ts` | the SQL accept path now writes the extra keys; the golden is regenerated deliberately and reviewed key by key. |
| `e2e/invitation-existing-account.spec.ts:342` (`permissionKeys` exact array) | same, via `presby_accept_invitation`'s result. `accept.db.test.ts:203` uses `arrayContaining` and is unaffected. |
| `src/lib/org-feature-catalog.test.ts`, `src/lib/org-portal/tiles.test.ts`, any `page.test.tsx` that counts tiles or catalog entries | a new entry and two tiles; set-equality of `orgTypeScope` with `orgTypes` is the existing rule |
| `src/lib/contact-methods/email-audience.test.ts` | the registry gains four keys and the scan must find all four senders |
| `src/lib/giving/team.db.test.ts` | **must pass unchanged** (the wrapper) |
| `src/app/(org)/o/[slug]/admin/giving/team/actions.test.ts:140` | string pin on "outside Giving" |
| `src/app/(admin)/admin/organizations/[id]/treasurer-designation-section.test.tsx` and `designation-holder-copy*.test.ts` (+ golden) | the confirm-dialog and holder-copy strings in Copy check 4 |
| `src/lib/giving/csv.test.ts` | **must pass unchanged** (byte-exact) |
| `scripts/check-schema-parity.ts` | six new tables and the receipt FK |

### Flags each e2e spec depends on

No platform flag is needed by any new spec; each spec sets the **per-organization** toggle through its fixture. Exception: `reimbursement-toggle.spec.ts` drives the Features page, which `giving-admin.spec.ts` reaches by capturing and setting `org_portal.features` through `e2e/support/flags.ts`; it does the same and restores it. Nothing is added to `scripts/ci/e2e-baseline-flags.sql`. A spec that asserts the portal tile would depend on `org_portal.home_v2` (already in the baseline); the tile is asserted in a unit test instead, so no spec depends on it.

### New e2e specs (throwaway congregation `e2e-reimb-<stamp>`, deleted with one `delete from organizations`; the `mfa-enrolled` user holds treasurer keys, as in `giving-fixture.ts`; invented names; receipts are synthetic bytes)

1. **`reimbursement-member.spec.ts`**: a plain accepted-invitation member files a request from a 360 px viewport with a receipt (synthetic PNG), double-taps Send (one request), sees the group named in the outcome; edits a returned request and resubmits; withdraws; prints the form; visitor-engagement member is told they cannot file; toggle off shows "isn't turned on" with HTTP 200.
2. **`reimbursement-approval.spec.ts`**: a chair opens the emailed link signed out (path preserved through `/signin`), approves; stale revision shows the "changed" message; approve twice shows "already approved on <date>"; a non-seat member and a stranger get the same neutral 404 body; the requester who is also chair cannot approve their own; an approver GET twice changes nothing; MFA: a chair who is also a `view` holder is challenged and lands on the request after the real TOTP step.
3. **`reimbursement-treasurer.spec.ts`**: **MFA-enrolled treasurer deep link**: signed out → `/signin?callbackUrl=/o/<slug>/admin/reimbursements/<id>` → password → `/totp` with the real secret → lands on the request; records a payment (check number required); the approver cannot pay (explicit message before the form); reverses; CSV export (header exact, formula guard, audit row); void; override path with a second pay holder, and the `needs_second_payer` refusal with only one.
4. **`reimbursement-role-bundle.spec.ts`**: the **role-bundle test**: the treasurer is created by the real invitation accept (`presby_apply_treasurer`), holds only that role, completes every treasurer verb listed in Pass 1, **sets up the clerk role and grants the treasurer role to a second member through the treasury team page**, and that second member (an eligible payer) records the payment on a request the first approved by override. A parallel DB test covers the same by calling the definers.
5. **`reimbursement-toggle.spec.ts`**: Features page: turning Reimbursements on; turning it off with open requests shows the count dialog; off hides pages, nothing deleted; on restores.
6. **`e2e/hydration/reimbursement-form.spec.ts`**: both `useForm` roots inert before hydration (`HydrationGate`), in both lanes.

360 px (`test-results/reimbursement-360/` screenshots): the request form, the detail page with **Approve** and **Send back** reachable without horizontal scroll and at least 44 px tall, the treasurer queue as cards, **Record payment** reachable, settings and team pages.

## Edge Cases & Risks

Every claim names the test that pins it, or says **unverified**. File names are the planned ones; the implementer creates them. "db" = real Postgres on the pipeline's Neon branch, serial.

| # | Claim | Pinned by |
|---|---|---|
| EC1 | A double tap on Send creates one request | `requests.db.test.ts › save_draft twice with one client_key returns one id`; e2e `reimbursement-member › double tap` |
| EC2 | A second submit on a submitted request answers `already_submitted`, treated as success | `requests.db.test.ts › submit is idempotent` |
| EC3 | Amount is an integer 1..10,000,000; "1e5", "12.345", "-5", "$1,2", "٣" never produce a wrong amount; nothing rounds | `amount-input.test.ts › hostile strings`; `input.test.ts › amountCents integer only`; `reimbursement.db.test.ts › amount_out_of_range` |
| EC4 | After first submit, kind, group, payee freeze; after submit, amount and text freeze. A raw owner `UPDATE` is refused too | `reimbursement.db.test.ts › request freeze (owner connection)` |
| EC5 | Approve carries the revision it displayed; a returned-edited-resubmitted request makes the old approve answer `changed_since_viewed` | `decisions.db.test.ts › stale revision`; e2e `reimbursement-approval › changed since opened` |
| EC6 | Only the proposed transitions exist; every other pair raises on every connection; the TypeScript mirror equals the SQL | `reimbursement.db.test.ts › transition matrix (generated)`; `states.test.ts › mirror equals 0073` (parses the migration text) |
| EC7 | Creator, beneficiary and the same person after a merge cannot approve; an owner-connection approval by them raises | `decisions.db.test.ts › self approval incl. merged`; `reimbursement.db.test.ts › approve SoD trigger` |
| EC8 | The approver cannot record the payment, in the definer (`payer_is_approver`) and in the trigger | `payments.db.test.ts › approver cannot pay`; `reimbursement.db.test.ts › payer trigger` |
| EC9 | A requester may record payment on their own request only when they are the sole effective `pay` holder; the row is stamped `self_paid`; with another holder the outcome is `needs_another_payer` | `payments.db.test.ts › sole holder self pay` and `› two holders` |
| EC10 | Override approval with one `pay` holder returns `needs_second_payer` and changes nothing; with two it succeeds and stamps `approval_path = 'override'` | `decisions.db.test.ts › override needs a second payer` |
| EC11 | A seat that ends mid-queue loses the queue row and the right to approve at once | `decisions.db.test.ts › seat ended mid queue`; `reads.db.test.ts › waiting_for_me is live` |
| EC12 | A requester whose membership ended is not asked again: an approved request stays payable; a new draft is refused (`not_eligible`) | `payments.db.test.ts › requester left`; `requests.db.test.ts › not_eligible` |
| EC13 | Two people with the same user, or a merged person, are one person for separation of duties; display names follow `merged_into_id` | `reimbursement.db.test.ts › resolve_person`; `reads.db.test.ts › merged payee label` |
| EC14 | A retired group keeps its requests and resubmits succeed; a first submit to a group no longer chargeable is refused | `requests.db.test.ts › retired group` |
| EC15 | A creator who is not the beneficiary needs `request_for_others`; the "reimburse" payee is the beneficiary column, so on-behalf laundering has nowhere to hide | `requests.db.test.ts › not_allowed_for_others`; `reimbursement.db.test.ts › kind shape` |
| EC16 | A missing request id and a forbidden one give the same response and make the same reads, in the detail page, the receipt route and every action | `reads.db.test.ts › not_found is uniform`; `receipts.route.test.ts › 404 shape`; e2e `reimbursement-approval › neutral 404` |
| EC17 | A `directory_hidden` member is never offered as a beneficiary **and** cannot be named by a posted id: the action re-checks with `isDirectoryListedPerson` (a one-function addition to `src/lib/directory.ts` over the same eligibility predicate, not a copy) before the definer | `pickers.db.test.ts › hidden member by posted id` |
| EC18 | Upload accepts by content only, at most 5 live receipts and 4,000,000 bytes per file, one file part, same-origin POST only; a refused upload never writes a blob; an over-cap stream is aborted early | `upload-request.test.ts` (chunked stream; two parts; no `Origin`; foreign `Origin`); `receipts.db.test.ts › preflight before store (blob count unchanged)`; `image-sanitize.test.ts › polyglot refused` |
| EC19 | EXIF (including GPS) is removed, orientation is applied, output is JPEG; an over-limit image is refused plainly | `image-sanitize.test.ts` (GPS fixture generated in the test with `sharp`; no real photo) |
| EC20 | The receipt route answers with `nosniff`, `private, no-store`, a sandbox CSP, `attachment` for PDF and `inline` for images, a server-chosen filename; a detached or foreign attachment id is the same 404 | `receipts.route.test.ts`; `reads.db.test.ts › attachment_lookup` |
| EC21 | The duplicate-receipt flag follows P3-21 and is never shown to the requester | `reads.db.test.ts › duplicate flag audience` |
| EC22 | Notices contain no digit, no `$`, no name, no free text; a recipient with no deliverable address gets no row and no error; a null origin writes none and the transition still commits | `notices.test.ts` (full rendered subject, html, text); `notify.db.test.ts`; `check-treasury-boundaries.test.mjs › T4` |
| EC23 | A signed-out approver or treasurer reaches the request through sign-in (and `/totp`) | e2e `reimbursement-approval`, `reimbursement-treasurer › MFA deep link` |
| EC24 | No GET mutates | page unit tests with write functions mocked; e2e reload comparing event counts |
| EC25 | Every reimbursement page, action and route calls `assertTreasurySession` (stale 2FA claim); a treasury-only viewer on the member detail route is redirected to the admin route | `gate-coverage.test.ts` (source scan over both trees); `reimbursements/[id]/page.test.tsx` |
| EC26 | Toggle off: HTTP 200 "isn't turned on", actions refuse, nothing is deleted, turning it on restores; the off dialog shows the open count | e2e `reimbursement-toggle`; `org-feature-warnings.db.test.ts` |
| EC27 | A presbytery, synod or GA gets `not_applicable`; the catalog `orgTypes`, the tile scope and `TREASURER_DESIGNATION_ORG_TYPES` are equal | `org-feature-catalog.test.ts`, `tiles.test.ts` |
| EC28 | With no `pay` holder the queue says so, and a request with no approver and no payer is saved with route `nobody` and the matching message | `reads.db.test.ts › pay_holder_count`; `requests.db.test.ts › route nobody` |
| EC29 | The backfill is idempotent, touches only designation-minted treasurer copies (constitutional, protected, org-owned), never a custom role or `founding_administrator`, and the closing assertion fails if any other role carries a reimbursement key | `backfill.db.test.ts` (applies the 0074 statements twice) |
| EC30 | No role carrying a reimbursement key can be used by a commission or delegation, or be bound after the fact; `TREASURY_MODULES` equals the guarded modules | `reimbursement.db.test.ts › downward guards (per module in TREASURY_MODULES)` |
| EC31 | The treasurer can grant the treasurer role to a second person who then pays; the clerk role is grantable only because the treasurer holds `request_for_others`; a role with a non-treasury key is refused; the last `reimbursement.manage` holder cannot be ended on that surface; giving's behavior is unchanged | `treasury/team.db.test.ts`; `giving/team.db.test.ts` (unchanged); `role-bundle.db.test.ts`; e2e `reimbursement-role-bundle` |
| EC32 | A reversal is its own row, one per payment, both stay visible, the request returns to `approved`; a payment with no status flip (or a flip with no payment) fails at commit | `payments.db.test.ts › reversal`; `reimbursement.db.test.ts › status/payment consistency (deferred)` |
| EC33 | A status change with no history event fails at commit | `reimbursement.db.test.ts › status has event` |
| EC34 | No delete on any of the six tables, owner included, except the organization teardown cascade | `reimbursement.db.test.ts › delete guards`; e2e fixture teardown |
| EC35 | The expense date uses the org-local date: a UTC-evening request in `America/New_York` is not "future"; 366 days back is refused when set, an unchanged old date on resubmit is allowed | `dates.test.ts`; `requests.db.test.ts › date window` |
| EC36 | The import door: a `paid` row with null actors and a historical date is accepted from the owner connection; the same shape with `origin = 'app'` is refused | `reimbursement.db.test.ts › origin import shapes` |
| EC37 | Text fields: control, bidi and zero-width characters are removed, NFC applied, over-length is a named field outcome, never a truncation; the CSV formula guard holds; no HTML reaches the page, PDF or CSV | `text.test.ts`; `csv-shape.test.ts`; `print-model.test.ts` |
| EC38 | A vendor request needs a vendor name at submit and has no person payee | `requests.db.test.ts › vendor kind` |
| EC39 | A very long name, purpose or category does not cause horizontal scroll at 360 px | **unverified until** e2e `reimbursement-member › 360 px long values` (asserts `scrollWidth <= innerWidth`) |
| EC40 | Two approvers at once: one wins, the other gets `already_decided`; a withdraw racing a payment: one wins | `decisions.db.test.ts › concurrent approve (two connections)` |
| EC41 | 20 open drafts per user; 40 uploads per user per hour | `requests.db.test.ts › too_many_drafts`; `receipts.route.test.ts › rate limit` |
| EC42 | `sharp` loads in the Vercel function | **unverified** until the Batch 2b preview build; if it fails to load there, Batch 2b blocks (receipts do not ship without the sanitizer) and returns to Phase 2 |
| EC43 | The `check:audit` tripwire does not see audit rows written from `src/lib/`; every function calling a write definer also calls `insertAuditRow` | `audit-coverage.test.ts` (source scan) |
| EC44 | Print route: any viewer of the request, requester projection only, no payment details | `print.route.test.ts` |
| EC45 | `reimbursement.view`, `pay`, `manage` holders without enrolled 2FA are sent to `/totp` on every surface | e2e `reimbursement-treasurer › MFA deep link`; `session.test.ts` |

**Accepted residuals (`paper`, stated here so the Copy section cannot deny them):**

1. Nothing scans uploads for malware, and PDFs keep their metadata and any active content. Mitigation is how they are served only.
2. The approving seat does not require 2FA; the money control is the independent payer, whose keys do.
3. A founding administrator holds no money key but can grant roles and add group chairs. That is detectable (`GROUP_MEMBER_ADDED`, `tenant.role.granted`) and not prevented.
4. An organization cannot narrow who may file except by turning the feature off.
5. If an eligible approver exists but does not respond, the treasurer cannot override; the remedy is a second chair or leader on the group (`groups.manage`).
6. An on-behalf holder cannot name a member who is hidden from the directory.
7. A receipt that fails to attach after storing leaves an unreferenced private blob; receipts in `bytea` grow the database.
8. The sole-holder exception to "the requester does not pay" is a definer property and is visible (`self_paid`), not a database prohibition.
9. The toggle is enforced in TypeScript only.
10. Staff reimbursement under an accountable plan, vendor 1099 thresholds and vendor aggregation are not handled (R14); no string claims compliance.
11. Free text is plain text, cleaned of control characters; it is not scanned for sensitive content.
12. Ending a seven-key `treasurer` grant on one team page checks only that page's own manage key, so it can leave the other module's manage key with no holder when a different role keeps the first. Possible, audited (`tenant.role.revoked`), recoverable only through the platform operator, not prevented (Phase 3 amendment, ruling 4; confirmation item 9).

## Copy

Every user-facing string this increment adds or changes. Written here so the implementer needs no ruling; **an implementer who needs a string that is not in this section stops and asks.** All strings live in `src/lib/reimbursement/copy.ts` (pure), except the catalog entry, the warning and the neighbour edits, which sit where the table says. `{org}`, `{group}`, `{date}`, `{n}` are filled from the named source; user-typed text (purpose, reasons, names) is rendered as plain text, escaped. "Neutral" strings are identical for a missing and a forbidden request.

### C1. Features page: the toggle and the off-warning (viewer: an `org_features.manage` holder)

| String | Where |
|---|---|
| Name: `Reimbursements` | `ORG_FEATURE_CATALOG` |
| Description: `Lets members ask for reimbursement or a vendor payment, lets the chairs and leaders of a group approve it, and lets the treasurer record the payment. It doesn't send money. Turning this off hides every reimbursement page and deletes nothing.` | catalog |
| Off-dialog title: `Reimbursement requests are still open` | `org-feature-warnings.ts` |
| Off-dialog body: `{n} request is open (waiting for approval, for the requester, or for payment).` / `{n} requests are open (…same…).` then `Turning this off hides the pages and nothing is deleted. Turning it back on restores everything.` | same |
| Fallback title: `Reimbursement requests may still be open`; body: `We couldn't check how many requests are open just now. Turning this off hides the pages and nothing is deleted.` | same |

### C2. Member page `/o/<slug>/reimbursements`

| String | Condition |
|---|---|
| `Reimbursements` (H1); `Ask {org} to pay you back for something you bought for the church, or to pay a vendor.` | always |
| `New request`; `Treasurer view` | the first when `may_file`; the second when the viewer holds `view`, `pay` or `manage` |
| `Waiting for your approval ({n})`; `Your requests` | sections |
| `Nothing is waiting.`; `You haven't made a request yet.` | empty states |
| `Requests can be started by members, regular attenders and staff of {org}. If you think you should be able to, tell the church office.` | `may_file` is false |
| `Reimbursements aren't turned on for {org}.` + (if `canManageFeatures`) `You can turn them on under Features.` (link) / else `Ask an administrator who manages your organization's features to turn it on.` | toggle off (HTTP 200) |
| `Reimbursements aren't available for this kind of organization.` | not applicable |
| `We couldn't load your requests. Try again in a moment.` | read failed |
| Status labels (requester): `Draft`, `Waiting for approval`, `Sent back to you`, `Not approved`, `Approved, waiting for payment`, `Paid`, `Withdrawn`, `Closed`. Staff and approver lists say `Sent back` instead of `Sent back to you`. | `status` |

### C3. The request form (viewer: a member who may file)

| String | Notes |
|---|---|
| H1 `New reimbursement request` / `Edit your request` | create / edit |
| `What is this for?` with `Pay me back`, `Pay someone else back` (only when the viewer holds `request_for_others`), `Pay a vendor` | |
| `Charge to` (placeholder `Choose a group`); `Category` (placeholder `Choose a category`, shown only when the org has an active category) | |
| `Who are we paying back?` (search box, placeholder `Search by name`); no match: `No match.`; hint `Only people who appear in the directory can be chosen.` | |
| `Vendor name`; `Amount`; `Date of the expense`; `What was it for?`; `Who approved this before you spent it? (optional)` | |
| `Receipts`; button `Add a receipt or invoice`; hint `Photos and PDFs. Each file can be up to 4 MB, and you can add up to 5.`; checkbox `I can't attach a receipt`; hint under it `The treasurer decides whether that's okay before paying.` | |
| Buttons `Save draft`, `Send request`, `Cancel`; while saving `Saving…`, `Sending…` | |
| Field errors: `Enter an amount between $0.01 and $100,000.00.` · `Choose a date that isn't in the future or more than a year ago.` · `Tell us what this was for.` · `Use {max} characters or fewer.` · `Enter the vendor's name.` · `Choose a group to charge this to.` · `That group can't receive requests right now. Choose another.` · `Choose a category.` · `Choose who to pay back.` · `We couldn't use that person. Search again and pick someone from the list.` · `Add a receipt, or tick “I can't attach a receipt”.` · `You don't have permission to enter a request for someone else.` | server-supplied, next to the field |
| `We couldn't save that. Your entries are still here. Try again.` | database or network failure |
| `This request changed in another window. Reload to see the latest.` | `changed_since_viewed` on a save |
| `You have 20 unfinished drafts. Send or withdraw one first.` | `too_many_drafts` |
| `Draft saved.` | toast |
| After Send, route `seat`: `Sent to {group} for approval.` · route `treasurer`: `No one in {group} is able to approve this, so it was sent to the treasurer.` · route `nobody`: `No one in {group} is able to approve this, and no one can record payments yet. It's saved and waiting. Let your church office know.` | `submit` result |

### C4. Receipt upload and download (viewer: the requester; approvers and treasurer for downloads)

`{file}` is the name the person's own device gave the file, shown back to them only.

| String | `kind` |
|---|---|
| `{file} isn't a photo or PDF we can use.` | `not_allowed` |
| `{file} is larger than 4 MB. Try a photo of it, or a smaller scan.` | `too_large` |
| `{file} couldn't be read. Try a different photo.` | `unreadable` |
| `You've added the most receipts allowed (5).` | `too_many` |
| `That receipt is already on this request.` | `duplicate` |
| `Receipts can't be changed on this request now.` | `not_editable` |
| `Too many uploads just now. Wait a few minutes and try again.` | `rate_limited` |
| `Please confirm your two-factor code to continue.` | `two_factor_required` |
| `Remove` (button, with accessible name `Remove {file}`); `No receipt attached.`; `Receipt not available.` | |
| Receipt download 404 body: `Not found` | neutral |

### C5. Request detail (viewer: requester, beneficiary, approver, or treasury; `p_level` decides what appears)

| String | Shown to |
|---|---|
| Labels `Amount`, `Date of the expense`, `Charged to`, `Category`, `Pay to`, `Who approved it beforehand`, `What it was for`, `Receipts`, `History` | all |
| Banners: draft `This is a draft. Only you can see it.` · submitted `Waiting for approval.` (route `treasurer`: `Waiting for the treasurer to approve it.`; route `nobody`: `Waiting for approval. No one is able to approve it yet, so let the church office know.`) · returned `Sent back to you. Reason: {reason}` · not approved `Not approved. Reason: {reason}` · approved `Approved on {date}. Waiting for payment.` · paid `Paid on {date}.` · withdrawn `This request was withdrawn.` · closed `This request was closed. Ask the treasurer if you have questions.` | by status; requester wording. Approvers and treasury see `Sent back` / `Not approved` with the reason and no "to you". |
| `Someone entered this request on your behalf.` | the beneficiary |
| `Entered on someone's behalf.` | approvers, treasury |
| `A receipt on this request was also attached to an earlier request.` (treasury adds the link `View that request`) | approvers, treasury; never the requester |
| `The requester says they can't attach a receipt.`; `Receipt waived.` | approvers, treasury; requester sees `Receipt waived.` |
| History labels: `Started`, `Sent for approval`, `Sent again`, `Approved`, `Sent back`, `Not approved`, `Withdrawn`, `Closed`, `Paid`, `Payment corrected`; treasury only: `Approved by the treasurer`, `Receipt waived`, `Note`, `Imported`. A date after each; **no person's name** except to treasury. | |
| Buttons: `Edit draft`, `Edit and send again`, `Withdraw request`, `Print the form` | requester |
| `This request isn't available.` (page body and action error) | neutral |
| Back link `Back to reimbursements` | all |

### C6. Approve, send back, withdraw (viewer: an eligible approver; requester for withdraw)

| String | Notes |
|---|---|
| Button `Approve`; dialog `Approve this request?` body `{amount} to {payee}, charged to {group}. Once approved it goes to the treasurer for payment.` buttons `Approve` / `Cancel` | the amount appears here, in the app, never in email |
| Button `Send back`; dialog `Send this request back?` radio `Needs changes` (`The requester can fix it and send it again.`) / `Not approved` (`The request ends here unless the requester withdraws it.`); field `Reason (the requester will see this)`; buttons `Send back` / `Cancel` | reason required, ≤300 |
| Results: `Approved.` · `Sent back.` · `Marked not approved.` · field text `Give a reason.` (reason missing) · `This was already approved on {date}.` · `This was already sent back on {date}.` · `This request changed after you opened it. Review it again.` · `This request isn't available.` | `already_decided` carries the date of the deciding event, org-local, **no actor** to a non-treasurer |
| Withdraw dialog `Withdraw this request?` body `It will be closed. You can start a new one any time.` buttons `Withdraw` / `Keep it`; refusal `This request was already paid, so it can't be withdrawn. Ask the treasurer.` | |

### C7. Treasurer queue `/admin/reimbursements` (viewer: `view`)

| String | Notes |
|---|---|
| H1 `Reimbursement requests`; tabs `Waiting for payment`, `Needs treasurer approval`, `In progress`, `Paid`, `All`, each with a count | |
| Tab note on the second: `No one in the group is able to approve these, so they wait for a treasurer.` | the `override` tab is submitted rows with no eligible approver, computed live |
| Card/table fields: payee, amount, `Charged to`, `Approved {date}` / `Sent {date}`, status; `Entered on someone's behalf` badge | |
| `Nothing is waiting.` | empty |
| `No one can record payments yet. Your church office can ask PresbyPortal support to set up a treasurer.` | `pay_holder_count = 0` |
| `Export CSV`; `Narrow the date range: that export is more than 20,000 requests.` (413 body) | |
| Page states: `This page is for the people who handle reimbursements at {org}. If you think you should be one of them, ask your treasurer or another administrator there.` (forbidden); `Reimbursements aren't turned on for {org}.` + Features link/ask line as C2 (off); `We couldn't load the requests. Try again in a moment.` | |

### C8. Treasurer detail and verbs (viewer: `view`; verbs need `pay`)

| String | Notes |
|---|---|
| Buttons `Record payment`, `Reverse payment`, `Waive receipt`, `Send back to requester`, `Void request`, `Approve as treasurer`, `Add a note` | each only when the verb is available and the viewer holds `pay` (notes: `view`) |
| Payment form: `How was it paid?` (`Check`, `ACH`, `Cash`, `Other`); `Check number` (required for Check) / `Reference (optional)`; `Date paid`; `Note (optional)`; hint `PresbyPortal records the payment. It doesn't send money or ask for bank details.`; button `Record payment` | |
| Pre-form blocks: `A different person must record this payment.` (viewer approved it) · `Another person who can record payments should do this, because you entered this request or are being paid by it.` (self-pay while another holder exists) · `Add a receipt or waive it before paying.` · `This request isn't waiting for payment.` · `This payment was already recorded.` | |
| Reverse: `Reverse this payment?` body `The request goes back to “Approved, waiting for payment”. Both entries stay on record.` field `Reason` (required) | |
| Void: `Void this request?` body `It will be closed and can't be paid. Nothing is deleted.` field `Reason` (required) | |
| Send back: as C6 with kind fixed to `Needs changes` | |
| Waive: `Waive the receipt?` body `The request can be paid without one. This is recorded.` field `Note (optional)` | |
| Override: `Approve as treasurer?` body `No one in {group} is able to approve this. Once approved, a different person who can record payments must pay it.` | |
| Override refusals: `Someone in {group} can approve this, so it needs their approval.` · `This needs a second person who can record payments before you can approve it. Whoever approves can't also pay.` plus, only when the viewer also holds `manage`, ` Add one under Treasury team.` (a link) | |
| Note: field `Note` (internal) with hint `Only the treasury team can see notes.` | |
| Results: `Payment recorded.` · `Payment reversed.` · `Receipt waived.` · `Request voided.` · `Sent back.` · `Approved.` · `Note added.` · field errors `Enter a check number.` · `Choose a date that isn't in the future.` · `Give a reason.` | |
| Treasury detail extras: `Approved by` {name} `on {date}` (`as treasurer` for the override path); `Paid` rows with method, reference, date, recorder; `Marked as paid by the person who entered or is paid by the request.` (when `self_paid`) | |

### C9. Settings, team and permission descriptions (viewer: `manage`)

| String | Notes |
|---|---|
| H1 `Reimbursement settings`; sections `Groups that can receive requests`, `Categories` | |
| Group row: name, switch `Can receive requests`, note `{n} chair or leader can approve.` / `{n} chairs or leaders can approve.` or `No chair or leader right now: requests go to the treasurer.` (managed) / `No chair or leader: requests go to the treasurer.` (derived group) | counts from `settings` |
| Empty: `No group can receive requests yet. Choose at least one so people can make requests.` | |
| Categories: `Add a category` (field `Name`), `Rename`, `Retire`; hint `Retired categories stay on old requests.`; errors `Use 1 to 60 characters.` · `You already have a category with that name.` | |
| H1 `Treasury team`; intro `Who can handle reimbursements and giving at {org}. Anyone who can view, pay or manage requests signs in with two-factor authentication.`; sections `Who has a treasury role`, `Roles to set up`; buttons `Set up the Treasurer role`, `Set up the Reimbursement Clerk role`; clerk role description `Can enter requests on behalf of members who don't use the portal.`; errors `That role includes permissions outside Giving and Reimbursements. Grant it from Roles instead.` · `That would leave no one able to manage reimbursements. Give the role to someone else first.` · `You can't grant permissions you don't hold yourself: {keys}.` · `That person already has this role.` · `That person doesn't have a current membership here.` · `You don't have permission to manage the treasury team.` | |
| Permission descriptions (migration 0074, shown in Roles and in the platform revoke dialog): `reimbursement.request_for_others` `Enter a reimbursement request on behalf of another member`; `.view` `View every reimbursement request, receipt and history, and export them`; `.pay` `Record and reverse reimbursement payments, waive a receipt, send a request back, void it, or approve it when no one else can`; `.manage` `Choose which groups can receive reimbursement requests, manage categories and the treasury team` | |

### C10. Email (all `person:role`; subject, heading, body, button, footnote)

| Template key | Recipients | Subject = heading | Body | Button | 
|---|---|---|---|---|
| `reimbursement.notice.needs_approval` | the eligible approvers computed in the submit definer | `A reimbursement request needs your approval` | `A reimbursement request is waiting, and you are one of the people who can approve it.` | `Open the request` |
| `reimbursement.notice.needs_treasurer` | every effective `pay` holder | `A reimbursement request needs a treasurer's approval` | `No one in the group it is charged to is able to approve it, so it is waiting for someone who can.` | `Open the request` |
| `reimbursement.notice.ready_to_pay` | every effective `pay` holder except the approver | `A reimbursement request is ready to pay` | `An approved reimbursement request is waiting for payment.` | `Open the request` |
| `reimbursement.notice.requester_update` (variants) | the creator, unless the creator is the person acting (amended 2026-10-26, S6) | `Your reimbursement request was approved` / `…was sent back` / `…wasn't approved` / `…was paid` / `…was closed` | `It is now waiting for payment.` / `It needs a change before it can go on. Open it to see why.` / `Open it to see why.` / `A payment has been recorded for it.` / `Open it to see what happened.` | `Open the request` |

Footnote on all: `Sign in to see the details. This message doesn't include any.` No name, amount, purpose, group name or date appears in any subject, html or text (`notices.test.ts`).

### C11. Printed form

`Reimbursement request` (title), `{org}`, the C5 labels with values, the status line (C5 wording for the requester), receipt file names, `Printed from PresbyPortal.` No payment details and no history names.

### C12. Neighbour strings this increment makes stale (modify targets)

| File:line | Today | Becomes |
|---|---|---|
| `src/app/(admin)/admin/organizations/[id]/treasurer-designation-section.tsx:~229` (confirm dialog) | `…they will be able to view every gift and donor, record gifts, and manage the organization's giving settings, funds and giving team. Holding this access requires two-factor sign-in. …` | `…they will be able to view every gift and donor, record gifts, and manage the organization's giving settings, funds and giving team. Once the congregation turns on Reimbursements they can also view and record payments on reimbursement requests and choose which groups can receive them. Holding this access requires two-factor sign-in. …` |
| `src/lib/onboarding/designation-holder-copy.ts:270` (`treasurerLine`) | `Gift and donor records are not changed. This is recorded in the audit log.` | `Gift, donor and reimbursement records are not changed. This is recorded in the audit log.` |
| `…/admin/giving/team/actions.ts:54`, `:142`; `…/team-list.tsx:107`; test `actions.test.ts:140` | `…permissions outside Giving…` | `…permissions outside Giving and Reimbursements…` |
| `src/lib/onboarding/designation-holder-copy.ts:146` (`sectionLead`, "The treasurer changes the giving team from the organization's own Giving team page.") | unchanged: still true; if Giving is off at that org the page is unreachable (pre-existing, not made worse) | no edit |
| `docs/TODO.md` Track R line ("Stops at `approved`…"), `docs/product/functionality-map.md` | doc-level; the orchestrator updates at ship (Rules 10, 14) | |

### C13. Release-note lines (draft; `/release-notes` finalizes)

1. Members can now ask the congregation to pay them back, or to pay a vendor, from a phone, with photos or PDFs of receipts.
2. The chairs and leaders of a group approve its requests, and the treasurer records the payment. No one approves their own request, and the person who approves can't also record the payment. If a congregation has only one person who records payments, that person may record a payment on their own request; the record shows it.
3. Reimbursements are off until an administrator turns them on under Features. Turning them off hides the pages and deletes nothing.
4. Photos are re-saved without their hidden location data. PDFs are kept as they are, and PresbyPortal doesn't scan files for viruses.
5. Treasurers designated through PresbyPortal now also see and pay reimbursement requests and choose which groups can receive them; existing ones are updated automatically.
6. Not in this release: reminders for waiting approvals, importing earlier requests, and ledger entries.

### The four checks, one line per group

**C1.** *Residuals:* "nothing is deleted" is true (no delete path; EC34); it does not deny residual 9 (toggle enforced in TypeScript). *Source of truth:* the open count is `presby_reimbursement_open_count()` = status in (`submitted`, `returned`, `approved`) at the current org; drafts are excluded and the word "open" is used instead of "waiting". *Audience:* an `org_features.manage` holder, who can flip the switch; no instruction is given. *Neighbours:* `org-feature-warnings.ts` giving string untouched; Features list renders the catalog entry.

**C2.** *Residuals:* does not claim who can file beyond the predicate (residual 4: "members, regular attenders and staff" is exactly `may_file`). *Source of truth:* `presby_reimbursement_may_file` (active membership, linked unmerged person, roll or engagement `regular`/`staff`); list from `my_requests`; counts from `counts`. It does not read a person's parish or visitor follow-up state. *Audience:* the member; "tell the church office" asks nothing the member cannot do; the Features link renders only for `canManageFeatures`; "Treasurer view" only for key holders. *Neighbours:* grepped `src` and docs for "reimburs" and "expense": none live besides TODO and the map (C12).

**C3.** *Residuals:* "Only people who appear in the directory can be chosen" states residual 6 plainly. The receipt hint does not promise scanning. *Source of truth:* limits come from `limits.ts` (4 MB = 4,000,000 bytes, 5 files, $100,000.00, one year, 20 drafts); the route text `Sent to {group}` comes from `submit`'s `route` and `group_name`, computed from the eligible-approver query at the moment of sending; it claims no one has been notified (it does not say "notified") because an approver with no deliverable address gets in-app only. *Audience:* the member filing. "Let your church office know" is addressed to the member and asks only that. "The treasurer decides…" is a system statement about `pay`-holder waiver, true for the default role. *Neighbours:* none.

**C4.** *Residuals:* no string says files are safe or scanned. *Source:* error `kind` values come from the route's sniff, size and sanitizer outcomes and from `attach_receipt`; "4 MB" is `MAX_RECEIPT_BYTES`. *Audience:* the uploader; each instruction (try a photo, wait) is within their power. *Neighbours:* the ticket form's own "10 MB" claim is careers' F291, not touched.

**C5.** *Residuals:* the duplicate-receipt line names an "earlier request" only to approvers and treasury (P3-21); the page never says the approval is final (a treasurer can send it back). *Source:* every banner reads `status` plus the deciding event's org-local date from `detail`; `Waiting for the treasurer to approve it` reads the live eligible-approver query (not a stored flag), so it can change on reload; `Paid on {date}` reads the live payment's `paid_on`; names appear only at the `treasury` level. *Audience:* "Ask the treasurer" is shown to requester, beneficiary and approvers, who can; "let the church office know" same. *Neighbours:* none.

**C6.** *Residuals:* "Once approved it goes to the treasurer" does not claim payment is guaranteed; the dialog does not say who will pay. *Source:* amount, payee and group come from `detail` at the revision the approver is looking at; `already_decided` date from the deciding event. *Audience:* the eligible approver sees Approve and Send back (render gate: `viewer.canDecide` from `detail`; permission check: the definer's live seat test). The requester sees Withdraw only when `canWithdraw`. *Neighbours:* none.

**C7.** *Residuals:* the banner and the tab note state the "nobody holds pay" and "no approver" dead ends plainly. *Source:* `pay_holder_count()`; the override tab is computed live. *Audience:* `view` holders; the banner's instruction is addressed to the church office, not to the viewer. The forbidden page's "ask your treasurer or another administrator" mirrors giving's string and asks nothing the visitor cannot do. *Neighbours:* mirrors `giving-admin-states.tsx:54-76,118`.

**C8.** *Residuals:* "PresbyPortal records the payment. It doesn't send money or ask for bank details" is true by construction; `Marked as paid by the person who entered…` shows residual 8 rather than hiding it. *Source:* blocks come from the definer outcomes `payer_is_approver`, `needs_another_payer`, `receipt_missing`, `not_payable`, `already_paid`; the override refusal reads `seat_holder_exists` and `needs_second_payer`. *Audience:* the buttons render only for `pay`; the "Add one under Treasury team" link renders only when the viewer holds `manage` (the default `treasurer` role does); a `pay`-only custom role sees the sentence without the instruction, so no one is told to do what they cannot. *Neighbours:* none.

**C9.** *Residuals:* the group note says "requests go to the treasurer" for a group with no chair or leader, which is the override path and true only when a `pay` holder exists; the page does not claim more. Permission descriptions match the gates in the definer table (pinned by a test that parses the descriptions against `REIMBURSEMENT_KEYS`). *Source:* counts from `settings`: `group_role in ('chair','leader')`, in date, managed groups only. *Audience:* `manage` holders; the team page's instructions are to the treasurer, who holds the keys. *Neighbours:* C12 giving-team strings.

**C10.** *Residuals:* mail carries no amount, name, purpose, group or date (T4, EC22). *Source:* the recipient list is the definer's return value; `person:role` address from `getPersonEmail(tx, id, "role")`. The approvals email says "you are one of the people who can approve it": the list is the eligible-approver query at send time. *Audience:* approvers, pay holders, requesters, each told only to open the request. *Neighbours:* `email-audience.ts` comment ("No sender uses these yet") becomes stale and is edited with the four entries.

**C11.** *Residuals:* none denied. *Source:* the requester projection. *Audience:* anyone who can open the request. *Neighbours:* none.

**C12–C13.** *Residuals:* release line 2 states the sole-holder exception instead of denying it; line 4 states the no-scan residual; line 3 does not claim DB-level off. *Source:* line 5: the backfill touches designation-minted copies only (EC29), "existing ones are updated automatically" is limited to those; line 1: the 4 MB / 5-file limits are in C3. *Audience:* operators and members reading release notes. *Neighbours:* grepped; list in C12.

## Carry-forward

"Addressed" names the section of this Phase 3. "Deferred" names who accepted it; where nobody with authority has yet, the row says **proposed, not yet accepted** and the item is on the confirmation list.

### Phase 1 gaps

| Item | Addressed here, or deferred |
|---|---|
| R1 six increments | Parent log program map; this child is Increment 1; children `-inc2`…`-inc6` created |
| R2 "stops at approved" vs cutover | Payment recorded in this increment (operator ruling Q1): `record_payment`, `reverse_payment`, `reimbursement_payments` |
| R3 seats not expressible | Q5 ruling: `chair`/`leader` of a **managed** chargeable group; Session/Diaconate fall to override (Permissions & Flags; Data Model); the `deacons_moderator` mapping is an additive change inside `__is_seat` later, **deferred, operator Q5 ruling** |
| R4 single-treasurer deadlock | `needs_second_payer` before override; `needs_another_payer` on self-pay; sole-holder exception stamped (EC9, EC10) |
| R5 member baseline reaches visitors (F177) | No key; `may_file` predicate (Permissions & Flags) |
| R6 first-day wall | 0074 template binding + backfill + role-bundle DB and e2e tests (EC29, EC31) |
| R7 no treasurer yet | Banner (C7), `nobody` route message (C3), `pay_holder_count` (EC28) |
| R8 payment ledger-ready | Own insert-only table, method, reference, paid-on, snapshot, `unique (id, organization_id)`, no fund column (Data Model) |
| R9 explicit chargeable list | `reimbursement_chargeable_groups`; never inferred from group type or privacy |
| R10 categories | One managed list per organization, required when any active (P3-4) |
| R11 CSV writer | `src/lib/csv.ts` extraction; `giving/csv.test.ts` unchanged (Component / Page Plan) |
| R12 boundary tripwire | `check:treasury-boundaries` T1–T5 (Batch 7) |
| R13 Track K hook | `origin = 'import'` CHECK shapes and trigger exception; importer not built (EC36). **Deferred to Track K, operator Q9 default.** |
| R14 CPA questions | Not handled; no string claims compliance (residual 10). **Deferred: recorded for the CPA list; operator** |
| R15 no reminders | Age shown, sorted oldest first; reminders **deferred: proposed in Phase 1, not yet accepted** (confirmation list) |

### Phase 1 questions and operator rulings

| Item | Addressed / deferred |
|---|---|
| Q1 payment included; Q5 chair/leader; Q6 two pay holders; Q4 giving moves at cutover | Q1, Q5, Q6 built as ruled. Q4 affects Increment 2 only (`-inc2`). |
| Q3, Q7–Q14 on analyst defaults (operator) | Q7 self-pay: blocked unless sole holder, stamped (EC9). Q8 amended by Phase 2 (no key). Q9 history import: **deferred to Track K (operator default)**. Q10 pledges: Increment 3. Q11 org types: congregation and new worshiping community (EC27). Q12 amended by Phase 2 (4 MB). Q13 retention 7 years: nothing purges, no purge code. Q14 fiscal year: Increment 4. |
| Q2 ledger later | Increments 4–6 |

### Phase 1 Pass 4 (edge cases) and Pass 5 (adversarial)

| Item | Addressed |
|---|---|
| P4-1 2FA gate and deep link | P3-1, P3-3, EC23, EC45 |
| P4-2 audit | AUDIT_ACTIONS list; P3-20; EC43. Withdraw, submit, note, attach are event-only (tech-lead call, listed for QA). |
| P4-3 empty states | C2, C7, C9 |
| P4-4 failure microcopy and required approver messages | C3, C6 |
| P4-5 360 px, `capture=` tripwire | e2e 360 walk; T3 (global in `src/app`); receipt picker has no `capture` |
| P4-6 departing people | EC11, EC12, EC13 |
| P4-7 payee identity composite | Data Model (all person columns composite); vendor name column |
| P4-8 dates | P3-18; EC35 |
| P4-9 concurrency, committee frozen | EC14, EC40 |
| P4-10 notices | P3-11; C10; EC22 |
| P4-11 retention, erasure | No purge; an erasure request is answered by retaining the financial row (giving G13 precedent), stated in the release notes only if asked (no UI) |
| P4-12 duplicates | P3-21; EC21. The "similar amount and date" form warning is **deferred: proposed in Phase 1 as a Phase 3 option, not built, not yet accepted** |
| P4-13 fixtures | Synthetic bytes and invented names only; `check:secrets` runs on the fixtures |
| P4-14 hydration, no native dialogs | `HydrationGate` on both `useForm` roots; `AlertDialog`; hydration spec |
| P5 redirect target | P3-1; actions return fixed server targets; no client-supplied redirect |
| P5 approve via GET | API Contract note; EC24 |
| P5 state-machine shortcut | triggers (Data Model); EC4, EC6, EC32, EC33 |
| P5 self-approval; requester pays own | EC7, EC8, EC9 |
| P5 laundering | EC15 |
| P5 amount tampering, frozen records | EC3, EC4, EC5 |
| P5 attachments type/size; metadata; malware; PII | EC18, EC19; residual 1; receipts only through their request (EC20) |
| P5 enumeration | EC16, EC17 |
| P5 input boundaries | EC37 |
| P5 administrator self-targeting | residual 3 (`paper`, detectable) |
| Phase 6 walks (platform-designated treasurer, accepted-invitation member, chair from the email link incl. MFA) | e2e specs 3 and 4 cover the first and third in automation; the Phase 6 walk is still manual at 360 px on `development` |

### Phase 2 rulings

| Item | Addressed / deferred |
|---|---|
| DECISION-267 (six tables, definer reads, definer writes, transition by trigger, ledger-ready, idempotent submit, import door, 0073/0074 split) | Data Model, API Contract; P3-5…P3-8 refine it; DECISION draft below |
| DECISION-268 (seat in definer, SoD in database) | Permissions & Flags; triggers; EC7–EC11; the named limit stated in Data Model |
| DECISION-269 (no request key; keys; backfill; downward guard; delegation) | Permissions & Flags; 0074; P3-14; **P3-2 adds `request_for_others` to the treasurer template and a clerk template (departure; confirmation list)** |
| DECISION-270 (private receipts, sharp, 4 MB, upload route, residuals) | Receipts section; **partly superseded by DECISION-277 (P3-19)**: backfill direction, default retained, `asset_audience` naming, required `resolve` audience |
| DECISION-271 (shared CSV, T1–T5, notices) | `csv.ts`; Batch 7; C10. **Link format departs: P3-1** |
| F296 delegation widening | P3-14; `treasury/team.ts`; EC31 |
| F297 blob exposure | F289 pipeline (0072); 0073 requires it |
| F298 dedup across consumers | `(org, audience, hash)` key; Receipts section |
| F299 Vercel body cap | 4,000,000 bytes per file, 4,200,000 per request; upload is a route handler; `bodySizeLimit` untouched |
| F300 `group_role` has no CHECK | Seat test is exact-match fail-closed (`'chair'`, `'leader'`); a vocabulary CHECK is a groups-module follow-up. **Deferred: architect Phase 2 ruling** |
| F301 downward guard keyed to giving | Sibling triggers in 0073; generalization is a follow-up before the ledger. **Deferred: architect Phase 2 ruling** (TODO line) |
| Placement table, server/client split | Component / Page Plan; client islands each listed with a reason |
| `sharp` exact pin, one importing file | Batch 2b; T5 |
| No `loading.tsx` on `[id]` segments | Component / Page Plan |
| Invariants (Isolation, Composite Keys, Permissions vs Flags, Two Hierarchies, soft deletes, no wildcard, brand, proxy, browser) | Data Model; Permissions & Flags; none of `src/proxy.ts`, `src/auth.ts`, `src/lib/authz.ts`, `src/lib/permissions.ts` is edited |
| "Return to Phase 2 if": `presby_app` privileges on requests/attachments/payments/events; a `bodySizeLimit` change; `sharp` from more than one file | None is needed: the first two are absent by design, the third is T5 |
| `giving_funds` is the future ledger fund | No fund column or table here; categories are never funds. Increment 4 |
| CLAUDE.md "eight" → "nine" | **Deferred to the orchestrator at integration with the operator's approval (Phase 2)** |
| Orchestrator note: migrations 0073/0074, F289 first, no `request` key, 4 MB | Honored; numbers in the header |
| Coordinator input: F289 Phase 2 (DECISION-277, R1–R9) | P3-19; Receipts section; call-site table; Feasibility row "0073 against F289" |

### F289 Phase 2 items carried (R1–R9)

| R | Treasury's obligation | Where |
|---|---|---|
| R1 step 8 | receipt FK uses `asset_audience`, FK to `blob_assets_id_org_audience_key`, NO ACTION | Data Model; Receipts |
| R1 steps 4, 5 | nothing for treasury: receipts are always `private`; `public_site` implies an image by CHECK | Receipts |
| R5 | `DEFAULT 'private'` stays; 0073 never drops it | Receipts |
| R6 | `store`/`resolve` audience as a string literal; call sites added to the source-scan table | Receipts table |
| R6 catalog test | the receipt FK must pass it | EC for FK shape in `reimbursement.db.test.ts` |
| R9 | 0073 requires 0072 applied; production: 0072 and code in one release, then `GIVING_STATEMENTS_ENABLED`; treasury ships after | Feasibility; Batch 1b gate |
| R2, R3, R4, R7, R8 | public-asset internals; no treasury action | |

## Needs a confirmation (operator or architect)

1. **P3-2, architect/operator:** `request_for_others` bound to the `treasurer` template plus a `reimbursement_clerk` template. DECISION-269's table said "none". Without this nobody can grant the key (F3b). *Default taken:* bound.
2. **P3-1, architect:** the emailed link is a bare path, not `/launch?next=…` (F3a). *Default taken:* bare path.
3. **P3-4, operator:** one category list per organization (Phase 1 said per committee in one sentence, per organization in R10). *Default taken:* per organization.
4. **P3-9, P3-10, P3-18, operator:** the pre-approver is optional free text; the maximum amount is $100,000.00; the date window is one year. *Defaults taken.*
5. **R15 and the form's "similar request" warning:** reminders are deferred. *Default taken:* deferred; confirm.
6. **Production counts (Phase 2 asked):** designation-minted `treasurer` copies (the 0074 backfill count), baseline `member` grants, and blob referrers; read-only.
7. **Operator Q6 follow-up:** does the congregation have a second person who can hold the payment role? Not blocking; the software says plainly when it is missing.
8. **Rule 16, orchestrator:** the `e2e96` fixture prefixes (P3-24); F-numbers for F3a–F3c; a migration number for Increment 2; merge of F289's call-site rows into the shared source-scan test; the `.integration.patch` files for `seed-dev.sql` and `test-rls.sql`.
9. **Residual 12, operator:** a team-page revoke of the seven-key `treasurer` grant can leave the other module's manage key unheld; accepted by the tech-lead as a documented residual rather than blocked (Phase 3 amendment, ruling 4). *Default taken:* accepted.

## Proposed decision entries (for `docs/decisions.md` at integration, newest first)

**DECISION-271 — Treasury shares one CSV writer, one boundary tripwire, and person-addressed notices; the emailed link is a bare path.**
**Status:** Resolved (architect Phase 2; tech-lead Phase 3 detail) · **Date:** 2026-10-25 · **Feature:** `2026-10-25-treasury-inc1`
- `src/lib/csv.ts` (pure) holds `csvTextCell`, `centsToDecimal`, the formula guard, CRLF join and the row-cap check; `src/lib/giving/csv.ts` imports and re-exports them and keeps its own header, row shape and cap, so its byte-exact test is unchanged. The reimbursement export is a GET route gated on `view` (2FA), capped at 20,000 rows (413, never a truncated file), audited with a row count and filters only.
- `npm run check:treasury-boundaries` (T1 no owner connection under reimbursement, treasury or either route tree; T2 only `src/lib/reimbursement/` and the Drizzle mirror name `reimbursement_*` or `presby_reimbursement_*`; T3 no `capture` on any `type="file"` input in `src/app`; T4 a file that references a `reimbursement.notice.` template key names no money or free-text identifier (the namespace is distinct from the permission keys, which also start `reimbursement.`); T5 `sharp` imported at runtime by one file). Later ledger increments extend it.
- Four notice templates, all `person:role` (requester notices too: staff often have only a work address and the notice names no one and nothing). Addresses come only from `getPersonEmail(tx, id, "role")` inside the RLS transaction; no deliverable address means in-app only. Rows are written in the transition's transaction and sent after commit.
- **Link format (departs from the Phase 2 note):** `<platform origin>/o/<slug>/reimbursements/<id>` (`/admin/reimbursements/<id>` for pay holders), never `/launch?next=`, because the proxy and `/launch` both drop the query for a signed-out visitor (F3a).
- **Revisit if** the proxy preserves the query string on its sign-in redirect (then `/launch?next=` becomes viable), or a notice ever needs a field the tripwire forbids.

**DECISION-270 — Receipts are private blobs served only through their request; `sharp` re-encodes images; 4 MB; an upload route handler. Partly superseded by DECISION-277.**
**Status:** Resolved (architect Phase 2; amended by F289 Phase 2) · **Date:** 2026-10-25
- As in Phase 2: row id in the URL, never the blob key; gate order `auth()`, 2FA, org, toggle, viewer-check definer, `resolve()`; headers `nosniff`, `private, no-store`, sandbox CSP, `attachment` for PDF; one 404 shape; at most 5 files of 4,000,000 bytes (a request body up to 4,200,000); first cookie-authenticated POST route handler in the tenant tree, so same-origin check, one file part, `Content-Length` precheck and a streamed cap; duplicate detection on the `content_sha256` of the bytes as received.
- **Superseded by DECISION-277:** the audience backfill is fail-closed (everything starts `private`); the column default stays permanently; the constant column on a private consumer is named `asset_audience`; `resolve()` and `resolveMeta()` take a required audience; the receipt FK is `(blob_key, organization_id, asset_audience) → blob_assets (id, organization_id, audience)`.
- **Phase 3 additions:** `receipt_preflight` before `store()`; client canvas downscale is usability only; the server re-encode is the guarantee (`sharp`, `rotate()`, long edge 1800, JPEG 80/70/60/50, `limitInputPixels` 64,000,000, no metadata); PDFs pass through unsanitized; 40 uploads per user per hour.
- **Accepted residuals:** no malware scanning; PDF metadata and active content; an orphaned private blob when attach fails after store; `bytea` growth (about 1 GB a year at fpcw scale); `sharp` loading on Vercel is unverified until the first preview build.
- **Revisit if** an object store replaces `bytea`, a non-image class needs public serving, or the preview build cannot load `sharp`.

**DECISION-269 — Requesting is an eligibility check, not a key; the money keys, template bindings, backfill and delegation.**
**Status:** Resolved (architect Phase 2; amended by tech-lead Phase 3, P3-2/P3-14) · **Date:** 2026-10-25
- No `reimbursement.request` key. `presby_reimbursement_may_file` requires an active membership, an unmerged person linked to the acting user, and `current_roll is not null or engagement_status in ('regular','staff')`. The cost: an organization cannot narrow who files except by turning the feature off (named v1 limit).
- Keys: `request_for_others` (no 2FA), `view`, `pay`, `manage` (2FA each; `manage` because the chargeable list decides who approves). Bound to the `treasurer` template, including `request_for_others` **(amendment: otherwise un-grantable, F3b)**; a `reimbursement_clerk` template carries that key alone. None goes to `founding_administrator`, `stated_clerk`, `session_member` or `installed_pastor`.
- Backfill: org-owned `treasurer` roles with `role_kind = 'constitutional' and is_protected` (minted only by `presby_apply_treasurer`); never `grant_reason`; never a wildcard.
- Downward guard: sibling triggers for `module = 'reimbursement'` (F301); generalizing the guard is a follow-up before the ledger.
- Delegation (F296): `src/lib/treasury/team.ts` treats a role as delegable when every key's module is in `TREASURY_MODULES`; the actor gate is the surface's own manage key (giving: `giving.manage`; reimbursement: `reimbursement.manage`); `assertPermissionSubset()` unchanged; person-arm grants only; the last effective manage holder of the surface's key cannot be ended there. `src/lib/giving/team.ts` is a wrapper, its tests unchanged.
- **Revisit if** an organization needs to restrict who files, a second tier-2 module needs its own delegation rules, or the guard is generalized.

**DECISION-268 — Approval is a seat checked live in a definer, not a key; separation of duties is in the database.**
**Status:** Resolved (architect Phase 2; tech-lead Phase 3 detail) · **Date:** 2026-10-25
- One internal rule: an eligible approver is a live unmerged person with an active membership, holding a `chair` or `leader` row in date on a `managed` group, not the creator or beneficiary (merge-resolved). Re-derived on every approve and return, so a seat that ends mid-queue loses authority at once. Derived groups (Session, Diaconate) have no such rows and take the override path; a `deacons_moderator` mapping is an additive change inside the same function.
- Override: `reimbursement.pay`, no eligible approver at that moment, and at least one other `pay` holder (`needs_second_payer` otherwise); stamped `approval_path = 'override'`. A `pay` holder cannot override while an eligible approver exists.
- Triggers binding the owner too: on `→approved` the approver is not the creator or beneficiary; on a payment insert the payer is not the approver in force, and `self_paid` is derived.
- **Named limit:** "the requester may pay only as the sole pay holder" needs a holder count, so it is a definer property (`needs_another_payer`).
- Accepted: the seat has no `requires_two_factor`; the independent payer is the money control. `paper`.
- **Revisit if** a spending threshold or dual approval is wanted, or a Moderator seat is mapped.

**DECISION-267 — Reimbursements are one module with a state machine enforced in the database.**
**Status:** Resolved (architect Phase 2; tech-lead Phase 3 detail) · **Date:** 2026-10-25
- Six tables in 0073 (chargeable groups, categories, requests, attachments, payments, events); `presby_app` holds SELECT on the two config tables and nothing on the other four. All reads and writes go through `presby_reimbursement_*` definers: a bounded actor claim, one viewer rule (creator for drafts; creator or beneficiary, a live eligible approver of the group, or a `view` holder afterwards), `not_found` for missing and forbidden alike, a closed outcome list pinned to a TypeScript constant. Audit rows are written in the same transaction.
- Transition table by trigger on every connection; freeze rules; revision incremented only while `draft`/`returned`, approve bound to the revision seen. Two deferred constraint triggers: a request is `paid` iff a live payment exists; a status change has a same-transaction history event.
- Payments are insert-only; a reversal is its own row (one per payment) and returns the request to `approved`; no fund or account column until Increment 5. Saving is create-or-find by client key, then update by id with the expected revision. `origin = 'import'` admits null actors for Track K; the importer is not built.
- Migration 0073 depends on F289's 0072 (receipt FK). Migration 0074: keys, bindings, backfill.
- **Revisit if** partial payments, mileage or recurring expenses are wanted, or the ledger needs a column on the payment row.

## Implementer

Per batch (table above): **database-admin** (Batch 1a, 1b); **api-developer** (Batches 2a, 2b, 3, 4); **ux-developer** (Batches 5, 6); **full-stack-developer** (Batch 7: print, tripwire, e2e, verification). Dev port 3590. Return to Phase 2 if: a table needs a `presby_app` privilege; the body-size limit has to change; `sharp` is needed in a second file; or `sharp` cannot load on Vercel.

---

# Phase 4 — Implementation

*(Per batch; implementers fill in. Files created, files modified, schema changes, audit events, deviations, strings added or changed with file:line, gate counts.)*

## Batch 1a — database-admin (2026-10-25)

Built on `origin/main` at 0.43.0 (`2a25584`, fast-forward). Scope: 0073 without the receipt FK, 0074, the Drizzle mirror, the presby_app suite, the dev seed, the integration patch, DB tests. Batch 1b (the receipt FK and its 0072 guard) is marked in 0073 section 1d.

### Files Created

- `drizzle/0073_presby_reimbursements.sql` — six tables; RLS, grants; 18 internal helpers; the triggers (delete, insert, transition/freeze/revision, attachments, payments, events, config, two deferred constraint pairs); the F301 guards; the identity literal; 17 write and 13 read definers.
- `drizzle/0074_presby_reimbursement_permissions.sql` — four keys; treasurer template bindings; `reimbursement_clerk` template; backfill; closing assertions.
- `src/lib/db/domain/reimbursement.ts` — Drizzle mirror of the six tables (types only; presby_app cannot query four of them).
- `src/lib/testing/reimbursement-fixture.ts` — DB-test harness (orgs, members, seats, roles, blobs, presby_app calls, `pgError`).
- `src/lib/db/domain/reimbursement.schema.test.ts` (pure), `reimbursement.db.test.ts` (owner-path triggers), `reimbursement-definers.db.test.ts` (definers via presby_app), `reimbursement-permissions.db.test.ts` (0074).
- `scripts/treasury/test-rls-73.sql` — section 73, runs as presby_app.
- `scripts/treasury/seed-dev-treasury.sql` — Alder: keys on the treasurer role, toggle on, Tobias chair of Property Committee, Property Committee and Session chargeable, two categories. No people, users or memberships.
- `docs/work-log/treasury-inc1.integration.patch` — the four Rule 16 shared-file edits, as a `git apply`-able diff checked against HEAD: `src/lib/db/domain/index.ts` (export), `drizzle/meta/_journal.json` (idx 73, 74), `scripts/test-rls.sql` (`\ir treasury/test-rls-73.sql`, and the template-role count 6 to 7), `scripts/seed-dev.sql` (`\ir treasury/seed-dev-treasury.sql`). Applied locally to test, then reverted; none of the four is committed.

### Files Modified (F323 modify targets; not shared files)

- `scripts/giving/test-rls-46.sql` — 46j: six 2FA keys (was three) plus an assertion naming the three reimbursement ones; 46m: the treasurer template carries exactly seven keys.
- `src/lib/onboarding/designation-parity.golden.json` — regenerated with `WRITE_DESIGNATION_GOLDEN=1` under the DECISION-269/F322 ruling. Diff reviewed key by key: exactly the four reimbursement keys added to the three treasurer blocks (`tr-congregation`, `tr-new_worshiping_community`, `tr-f109-congregation`); nothing else moved. The HEAD golden failed those three scenarios against the new state first.
- `e2e/invitation-existing-account.spec.ts:342` — `permissionKeys` is the seven-key sorted list (`presby_apply_treasurer` sorts with `collate "C"`).

### Schema Changes

- Migration mode: **hand-written**. Applied with `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0073_presby_reimbursements.sql` then the same for 0074, against the `pipeline-treasury` Neon branch (owner, direct endpoint). Never against `$APP_DATABASE_URL`, development or production.
- Idempotency: each whole file applied twice in a row, both exit 0, row counts unchanged (0074: `4|9|1` permissions / reimbursement bindings / clerk template after apply 1 and after apply 2; 0073 re-applied after every in-place edit during the batch, final double apply recorded under Gates). `reimbursement-permissions.db.test.ts` also replays the whole 0074 text twice inside a rolled-back transaction with no count change.
- `_journal.json`: entries `{idx 73, tag 0073_presby_reimbursements}` and `{idx 74, tag 0074_presby_reimbursement_permissions}` are in the integration patch, not committed (Rule 16).
- Tables: `reimbursement_chargeable_groups`, `reimbursement_categories`, `reimbursement_requests`, `reimbursement_attachments`, `reimbursement_payments`, `reimbursement_events`. Every one: `unique (id, organization_id)`, composite FKs (groups `(id, org)`, memberships `(person_id, org)`, own tables `(id, org)`), single-column FKs only to `organizations` (cascade) and `users` (actors), FORCE RLS, one `tenant_isolation` policy. presby_app: SELECT on the two config tables, nothing on the other four; presby_platform: nothing; DELETE: nobody.
- `check:schema-parity` (run with the index export applied locally): 91 domain tables, 0 failing; the six new tables have no difference, so no allowlist row is needed in 1a. Batch 1b's receipt FK will need the architectural `extra_fk` row the other blob FKs carry.

### Deviations from the Phase 3 text (each named in the 0073 / 0074 headers)

- **D1** A `withdrawn` request may be incomplete (completeness and vendor-name CHECKs admit `draft` and `withdrawn`): "a discarded draft is withdrawn" (Phase 2).
- **D2** An eligible approver and an effective key holder must have an active login (`people.user_id` set, `users.is_active`). The design says "live, unmerged person". A chair who cannot sign in would make the route `seat` forever and block the override path. **Needs a ruling** (see loop-back list).
- **D3** A payment row admits a null payer only for an `origin = 'import'` request (trigger-enforced; the R13 door needs it for an imported paid row).
- **D4** Extra outcomes, each for a case the list did not name: submit `not_editable` (withdrawn or voided); withdraw, void, reverse `reason_too_long`; waive, record, note `note_too_long`; attach `invalid_shape`. Extra return columns, never fewer: submit `missing`; approve `current_status`; return `decided_on`, `current_status`, `notify_requester_person_id`; void `notify_requester_person_id`; record_payment `payment_id`, `self_paid`, `notify_requester_person_id`; reverse `payment_id`.
- **D5** A pay holder cannot waive the receipt on, or send back / mark not approved, a request they created or are paid by. Consequence: a sole pay holder paying their own request must attach a receipt.
- **D6** `needs_another_payer` counts a pay holder who could actually pay this request (not the actor, the approver in force, the creator or the beneficiary). `needs_second_payer` (override) counts any pay holder who is not the actor (Q6 as written).
- **D7** Until Batch 1b's FK, `attach_receipt` checks the blob exists at the acting org with the stated content type and byte size.
- **D8** 0074's closing assertion does not fail on an org-owned **custom** role carrying a key (an adopted clerk copy, or a role the treasurer delegated through the team page). The design's "any other role" would make 0074 fail on replay once the team page is used. It still fails on any protected or constitutional non-treasurer role, and on the six named office roles of any kind.
- **D9** `reimbursement_events.seq` (identity) orders history. Events in one transaction share `created_at = now()` (which the deferred check matches on), so `(created_at, id)` was random order; the index is `(request_id, created_at, seq)`.
- **Order in `record_payment`**: `payer_is_approver` and `needs_another_payer` are checked before `receipt_missing`, so a person who can never pay this request is told that rather than asked for a receipt.
- **Dates**: every "today" is org-local (`presby_reimbursement_org_today()`, America/New_York fallback). `treasurer_list` and `export_rows` filter `from`/`to` on the org-local date of `coalesce(submitted_at, created_at)`. That choice is mine; the design did not say which date.
- **History at member level**: `override_approved` is shown as `approved`; `note`, `receipt_waived` and `imported` are omitted; notes appear only on `returned` / `not_approved` events; no actor names.

### CHECKs and triggers restated in English (checked against Phase 3, not against the SQL)

- `kind_shape`: a pay-me-back request names exactly one person and no vendor. A vendor request names no person, and must name the vendor unless it is a draft or a discarded draft. Matches DECISION-268 plus D1.
- `complete_shape`: anything past a draft (other than a discarded draft) has an amount, a date and a purpose. Matches.
- `submission_shape`: the first and latest submission stamps are set together; a draft has neither; an app request that is neither draft nor withdrawn has been submitted. Matches.
- `approval_shape`: approval columns are all empty or all set (actors may be empty only on an import); the path is seat or override; an approval exists exactly while approved or paid. Matches.
- `waiver_shape`: waiver columns all empty or all set (actor empty only on an import); a waiver exists only while submitted, approved or paid. Matches.
- `payments_shape` / `check_reference`: a payment has a method and a date and offsets nothing; a reversal offsets a payment, has a reason, and has no method, reference or date; a check payment has a check number. Matches.
- `events_actor_shape`: every history row names who acted, except an import. Matches.
- Insert guard: an app request starts as a draft at revision 1 with nothing stamped; an import may start anywhere. Matches.
- Update guard: identity never changes. Kind, group and payee freeze at the first submission. Edits happen only while draft or returned, never in the same write as a status change, and each edit or receipt change moves the revision by exactly one. Status moves only along the listed arrows. Submit needs a receipt or the no-receipt claim and stamps its own times. Approve names an approver who is neither creator nor beneficiary (merges and logins included), on the current revision. Paid needs a live payment and leaving paid needs none. Leaving approved/paid clears the approval; leaving submitted/approved/paid clears the waiver. A waiver is set once, while submitted or approved. Matches P3-6..P3-8 and DECISION-268.
- Attachment guard: a receipt is added or detached only while draft or returned, at most five live, a detach changes nothing else and happens once, and either bumps the revision. Matches P3-17.
- Payment guard: insert only. A payment needs an approved request, a receipt or waiver, no live payment, the request's amount, a date between the expense and org-local today, and a payer who is not the approver; it stamps self_paid itself. A reversal needs a paid request and offsets one un-reversed payment of the same request for the same amount. Matches P3-7 and DECISION-268.
- Deferred: at commit a request is paid exactly when it has a live payment, and every insert or status change has a same-transaction event moving to that status. Matches P3-6.
- Delete guard: no row of the six is deleted while its organization exists. Matches EC34.

### Handoff for Batch 2a (api-developer): the SQL contract

Every public definer: `security definer`, `search_path = public, pg_temp`, EXECUTE to presby_app only, actor (`users.id`) last, no defaulted parameters. Identity refusal is SQLSTATE `42501` with the literal `reimbursement: not permitted`. Outcomes are listed in check order in each function's 0073 comment (section 7); `outcomes.ts` should be pinned to those comments.

- Writes: `save_draft(client_key, kind, group_id, beneficiary_person_id, vendor_name, amount_cents, expense_date, purpose, category_id, pre_approved_by, no_receipt, actor) -> (outcome, request_id, revision, created)`; `update_request(request_id, expected_revision, kind, group_id, beneficiary_person_id, vendor_name, amount_cents, expense_date, purpose, category_id, pre_approved_by, no_receipt, actor) -> (outcome, revision)`; `submit(request_id, expected_revision, actor) -> (outcome, route, notify_person_ids, group_name, revision, missing)`; `withdraw(request_id, reason, actor)`; `approve(request_id, expected_revision, path, actor) -> (outcome, decided_on, current_status, notify_requester_person_id, notify_pay_person_ids)`; `return(request_id, expected_revision, kind, reason, actor) -> (outcome, decided_on, current_status, notify_requester_person_id)`; `void(request_id, reason, actor) -> (outcome, notify_requester_person_id)`; `waive_receipt(request_id, note, actor)`; `record_payment(request_id, method, reference, paid_on, note, actor) -> (outcome, payment_id, self_paid, notify_requester_person_id)`; `reverse_payment(request_id, reason, actor) -> (outcome, payment_id)`; `add_note(request_id, note, actor)`; `receipt_preflight(request_id, actor) -> (outcome, live_count)`; `attach_receipt(request_id, blob_key, content_sha256, content_type, byte_size, display_name, actor) -> (outcome, attachment_id)`; `detach_receipt(request_id, attachment_id, actor)`; `set_chargeable(group_id, chargeable, actor)`; `save_category(category_id, name, sort_order, actor) -> (outcome, category_id)`; `end_category(category_id, actor)`.
- Reads: `may_file(actor) -> boolean`; `org_today() -> date`; `my_requests(actor, limit, offset)`; `waiting_for_me(actor)`; `counts(actor)`; `treasurer_list(actor, tab, group_id, from, to, limit, offset)` (with `total_count`; an unknown tab is SQLSTATE 22023); `detail(request_id, actor, level) -> jsonb` (null for missing or forbidden; the keys are camelCase: see `reimbursement-definers.db.test.ts` for the asserted shape, the zod schema and golden are 2a's); `attachment_lookup(request_id, attachment_id, actor) -> (blob_key, content_type, display_name, viewer_is_creator)`; `export_rows(actor, from, to, status, limit)` (clamped to 20,001); `settings(actor) -> jsonb`; `form_options(actor) -> jsonb` (`mayFile`, `groups`, `categories`, `canRequestForOthers`); `pay_holder_count()`; `open_count()`.
- The Neon driver returns `date` columns as strings; cast in SQL (`check:sql-date`).
- Write definers do NOT write audit rows (P3-20: `insertAuditRow` in the same transaction from TypeScript).
- Local apply: `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0073_presby_reimbursements.sql`, then 0074, then `scripts/treasury/seed-dev-treasury.sql`. On the pipeline branch all three are already applied.

### test-rls sections

- New: section 73 (`scripts/treasury/test-rls-73.sql`, 52 assertions): (a) structure, (b) closed tables and config isolation, (c) the identity literal across 28 calls, (d) the path as presby_app including SoD and the deferred checks, (e) isolation by the definers' org predicate (a person who is a member at Alder and at the presbytery), (f) F301 on the tenant connection.
- Touched: section 46 (46j, 46m), in `scripts/giving/test-rls-46.sql`; and, through the integration patch, DECISION-152's template-role count in `scripts/test-rls.sql` (6 to 7).
- Failing-first, each on the pipeline branch, then restored and green again:
  - M1 `no force row level security` on requests: fails at 73a "ENABLED and FORCED, expected 6, got 5".
  - M2 `grant select on reimbursement_payments to presby_app`: fails at 73a "NO privilege on requests, attachments, payments or events, expected 0, got 1".
  - M3 `revoke execute on presby_deny_reimbursement from presby_app`: fails at 73a; with section (c) run alone it fails with `wrong refusal "permission denied for function presby_deny_reimbursement"`.
  - M4 the delegation guard disabled: fails at 73a (10 expected, got 9); section (f) alone fails with "FAIL 73f - a reimbursement role travelled a delegation". The binding guard disabled: (f) fails with "a reimbursement key was bound to a delegated role".
  - M5 `my_requests` re-created without its `organization_id` predicate: fails at 73e "and is not in his list there, expected 0, got 1".
  - After `drizzle/0073` was re-applied whole: 52 passes, exit 0.

### Gates

- `npm run typecheck` exit 0; `npm run lint` exit 0 (repo-wide, `--max-warnings=0`); `npm run check` all eight tripwires passed.
- New Vitest: `reimbursement.schema.test.ts` 14/14 (pure); `reimbursement.db.test.ts` 26/26 (owner path, including the generated 56-pair transition matrix); `reimbursement-definers.db.test.ts` 36/36 (presby_app); `reimbursement-permissions.db.test.ts` 7/7. 83 new tests.
- `designation-parity.db.test.ts` 12/12 after the regeneration (3/12 failed against the HEAD golden first).
- Full `npm run test:db` (serial, 668 files): 11,374 passed, 1 skipped, **7 failed**:
  - 2 are mine: `src/lib/giving/team.db.test.ts` (loop-back 1).
  - 5 are environmental and not caused by this batch: `src/proxy.test.ts` (loopback), `src/lib/auth/safe-callback.test.ts` (absolute URL), `tickets/actions.test.ts` and `feedback/actions.test.ts` (absolute link), `src/lib/onboarding/issue.db.test.ts` (invite link). Each pins `localhost:3000`, and this worktree's `.env.local` sets `NEXT_PUBLIC_APP_URL=http://localhost:3590` (Batch 0). The four pure ones pass without `.env.local` (146/146) and fail with it (4 failed). Every parallel worktree on a non-3000 port will see the same.
- `scripts/treasury/test-rls-73.sql` as presby_app: **52 passes, exit 0**. `scripts/giving/test-rls-46.sql`: **264 passes, exit 0** (the HEAD version fails at 46j against the new state).
- Full `scripts/test-rls.sql` as presby_app with the integration patch applied locally: 1,293 passes, with every section reached (run from a temporary copy without the main file's `ON_ERROR_STOP`, deleted after). **3 failures, all inherited data drift on this branch, none touching 0073/0074**: (1) "presbytery: sees only its own members, expected 2, got 3" (the operator's demo-account membership at the Northern Reach, created 2026-10-14); (2) "2fa policy: definer function sees the requirement" (Alder's `organization_settings.require_two_factor` is false on this branch, `updated_at` 2026-08-19); (3) "exactly ONE org-owned role holds statistics.publish" (three `demo_everything` roles from 2026-10-14 and the `e2e_statistics_publish` fixture role). The one failure 0074 did cause, DECISION-152's template-role count (6 to 7, the clerk template), is fixed in the integration patch. If `development` carries the same drift, the post-merge re-run (Rule 16) shows the same three.
- Idempotency, final files: snapshot before, then 0073, 0073, 0074, 0074, all exit 0, identical every time: requests/events/payments/attachments/categories/chargeable `0/0/0/0/2/2`, 60 functions, 20 triggers, 6 policies, 133 constraints, 26 indexes, `4/9/1` catalog/bindings/clerk template, and the same md5 over every function's ACL.
- `check:schema-parity` (index export applied locally): 91 tables, 0 failing.
- Not run here: the e2e edit (`invitation-existing-account.spec.ts:342`); it needs a dev server and is Batch 7's lane. The change mirrors the regenerated golden, key for key.

### Loop-back candidates (for the orchestrator / tech-lead)

1. **`src/lib/giving/team.db.test.ts` cannot "pass unchanged" (design, P3-14 and the test blast radius table).** After 0074, 2 of its 24 tests fail: "creates the treasurer role from its template too" (`escalation_denied`) and "reactivates a deactivated role and reconciles ADDITIVELY" (key-set mismatch). Their actor holds exactly the three giving keys. Under the unchanged subset rule (DECISION-068/106), adopting a seven-key template is now correctly an escalation. Batch 2a's wrapper cannot make them pass without changing the subset rule. The fix is a test change (the fixture actor holds the template's keys), and that needs a ruling, since the design says the file stays unchanged. Not edited here.
2. **D2** (active login required for a seat and for a key holder): confirm, or rule that a login-less chair counts.
3. **D8** (0074 closing assertion scope): confirm.
4. **The date filter for `treasurer_list` and `export_rows`** (submitted date, org-local): confirm, or name another (expense date, paid date).
5. **Design text vs SQL on `presby_reimbursement_detail`'s shape**: the design leaves the jsonb keys to "a zod schema and a golden test" in 2a. The keys are now fixed by 0073 section 8g; 2a should pin them rather than rename them.

## Batch 2a — api-developer (2026-10-25)

Built on the pipeline branch after `git merge origin/main` (0.44.0, `7085100`). Four commits: `ec5ebe9` (refactor: shared csv/session/keys and the team path), `cd945d2` (test: the ruling-1 fixture amendment), `26de2f2` (feat: `src/lib/reimbursement/`, the member actions, audit keys, `isDirectoryListedPerson`), `b6f5ddb` (feat: catalog entry, tiles, off-warning). No schema, migration or Rule 16 shared-file change; the Batch 1a integration patch is untouched and still the orchestrator's. Receipt upload/serving is not built (Batch 2b, waits on F289's `store({audience})`); nothing in this batch touches the blob store or `blob_assets`.

### Files Created

- `src/lib/csv.ts` (+ test): `csvTextCell`, `centsToDecimal`, `joinCsvLines`, extracted byte for byte; `giving/csv.ts` re-exports the first two.
- `src/lib/treasury/`: `modules.ts` (`TREASURY_MODULES = ["giving","reimbursement"]`), `keys.ts` (`holdsPermissions`), `session.ts` (`assertTreasurySession`, `treasuryTotpRedirectUrl`), `db-util.ts`, `team.ts` (the surface-parameterized F138 path: `listTreasuryTeam`, `grantTreasuryRole`, `revokeTreasuryRole`, `ensureTreasuryRole`, `TEAM_SURFACES`), `session.test.ts`, `team.db.test.ts` (20).
- `src/lib/reimbursement/` pure: `keys.ts`, `limits.ts`, `states.ts`, `outcomes.ts`, `amount-input.ts`, `text.ts`, `dates.ts`, `input.ts`, `copy.ts`, `messages.ts` (outcome to Copy string), `action-result.ts`, `detail-shape.ts` (strict zod for `detail`, `form_options`, `settings`), `detail-shape.golden.json`.
- `src/lib/reimbursement/` server-only: `access.ts`, `gate.ts`, `requests.ts`, `reads.ts`, `config.ts`, `pickers.ts`, `counts.ts`, `audit.ts`, `db-util.ts`.
- `src/app/(org)/o/[slug]/reimbursements/actions.ts` (+ test).
- Tests beside the source: `amount-input`, `text`, `dates`, `states`, `outcomes`, `limits`, `keys`, `copy`, `input`, `messages`, `detail-shape`, `gate`, `audit-coverage`, `gate-coverage` (all pure); `requests.db`, `reads.db`, `config.db`, `text.db` (DB-backed); `src/lib/org-feature-warnings.reimbursement.test.ts`. `migration-text.ts` is test support (reads 0073/0074 text).

### Files Modified

- `src/lib/giving/{csv,access-pure,keys,team}.ts`: wrappers/aliases over the moved code; exported names and result kinds unchanged. `team.db.test.ts`: the two ruling-1 cases (see below).
- `src/lib/org-features.ts` (catalog entry `org_portal.reimbursement`), `src/lib/org-portal/tiles.ts` (two tiles), `src/components/org-portal/tile-icons.tsx` (two icons; a UI file, two imports and two map entries), `src/lib/org-feature-warnings.ts` (registry entry), `src/lib/audit.ts` (12 keys), `src/lib/directory.ts` (one added export, `isDirectoryListedPerson`, EC17), `src/lib/testing/reimbursement-fixture.ts` (`makeOrg({toggle})`, `setToggle`).
- Tests whose pinned lists grew: `audit.test.ts` (+2), `org-feature-catalog.test.ts`, `org-portal/tiles.test.ts` (24 tiles), `org-portal/visible-tiles.test.ts`, `tile-icons.test.tsx`.

### Orchestrator ruling 1 applied (team.db.test.ts)

`ensureGivingRole creates the treasurer role...` now gives the acting user all seven treasurer keys; `reactivates a deactivated role and reconciles ADDITIVELY` expects `skippedKeys` to include the four reimbursement keys (the actor holds none of them). Each case carries a note citing the ruling; the subset rule is unchanged. 24/24 pass. Before the fix the same two (and only those) failed against the wrapper.

### Audit events

Twelve `tenant.reimbursement.*` keys added to `AUDIT_ACTIONS` (`REIMBURSEMENT_APPROVED`, `_OVERRIDE_APPROVED`, `_RETURNED`, `_NOT_APPROVED`, `_VOIDED`, `_PAYMENT_RECORDED`, `_PAYMENT_REVERSED`, `_RECEIPT_WAIVED`, `_RECEIPT_VIEWED`, `_EXPORTED`, `_CHARGEABLE_CHANGED`, `_CATEGORY_CHANGED`). Written in this batch, in the same transaction as the change, by `config.ts` only: `CHARGEABLE_CHANGED { groupId, chargeable }` and `CATEGORY_CHANGED { categoryId, change: created|renamed|retired }`, both with `organizationId`, ids and tags only (never a category name). An unchanged answer writes no row; a failed audit insert rolls the change back (tested with an injected failure). Save, submit, withdraw write none (the events table is their record; `audit-coverage.test.ts` lists them as the classified unaudited set, and fails if a write definer is called that is in neither list).

### Deviations from the Phase 3 text

- **V1** Surface scoping in `treasury/team.ts` beyond the design: `grantTreasuryRole` answers `invalid_role` and `revokeTreasuryRole` answers `not_found` for a role carrying none of the surface's own-module keys. Without it a `reimbursement.manage` holder who also holds `giving.record` could hand out `giving_recorder` through the reimbursement gate, bypassing `giving.manage`. Tested by mutation (removing the check fails the test).
- **V2** Result kind `not_treasury_only` in `treasury/team.ts`; the giving wrapper maps it back to `not_giving_only` so the giving actions' switches are unchanged. The generic list returns `ownKeys`; the wrapper maps it to `givingKeys`.
- **V3** `treasury/db-util.ts` duplicates `rowsOf`/`errorChain` so the treasury layer does not import `giving/db-util` (`giving/team.ts` imports `treasury/team.ts`).
- **V4** `reads.ts` omits `treasurer_list` and `export_rows` (Batch 4: "treasurer reads"). The `detail` shape is pinned at both levels now.
- **V5** `searchBeneficiaries` does not search under two characters and returns an empty list (the design is silent on a minimum; `BENEFICIARY_QUERY_MIN` in `limits.ts`).
- **V6** `submitRequest` returns `notifyPersonIds` and does not send anything (notices are Batch 3, which adds the call inside the same transaction). For `already_submitted` it reports `route` from the live detail when the request is still waiting and `null` once it has moved on; `sentMessage(null, …)` reads as the `seat` sentence.
- **V7** `saveRequest` re-judges a posted beneficiary only when it differs from the stored one on an edit (the database applies its "as of now" checks to a changed value only), so a payee hidden after filing does not strand a returned request. The stored payee comes from the member-level `detail`.
- **V9** The action results nest their payload under `data` (`{ ok: true, data: { requestId, revision } }`), the house `ActionResult` / `GivingActionResult` shape, where the Phase 3 text sketches it flat (`{ ok, requestId, revision }`).
- **V8** The tiles and icons were added in 2a (the design lists tile data under 2a); the icon map lives in a UI file.

### Copy gaps (strings not in the Copy section; rule: stop and report)

1. **Tile descriptions (2).** Labels are Copy's own headings (`Reimbursements`, `Reimbursement requests`). The two descriptions are my proposals, marked `COPY GAP` in `tiles.ts`: member `Ask to be paid back for something you bought for the church, or to pay a vendor.`; treasurer `See every request, record payments, and choose which groups can receive requests.` Needs a ruling (tech-lead) before Batch 5/6 ship.
2. **Gate boilerplate.** Copy names no wording for signed out, no organization access, not permitted, or an access-check failure. `COPY.gate` reuses giving's `action-gate.ts` strings verbatim (`copy.test.ts` asserts each appears there). Not new wording, but it is reimbursement UI text nobody ruled on.
3. **No success string for withdraw**, none for the beneficiary search, and no UI string for a withdraw reason (the action accepts an optional reason, validated at 300 characters; the Copy section's dialog has no field). `invalid_shape` and `kind_invalid` (only a tampered post reaches them) read as `We couldn't save that. Your entries are still here. Try again.`

### Strings added or changed

All in `src/lib/reimbursement/copy.ts` (C2 to C9, pinned byte for byte by `copy.test.ts`; limits-derived numbers computed from `limits.ts`), the catalog entry (`org-features.ts`, C1), the off-warning (`org-feature-warnings.ts`, C1), and the two tile descriptions above. The C12 neighbour edits are Batch 6's by the batch table and are NOT made here, so these now read stale: `admin/giving/team/actions.ts:54,142` ("permissions outside Giving"), `team-list.tsx:107`, `actions.test.ts:140`. The giving team now delegates treasury-only roles, so that sentence is slightly wrong until Batch 6 edits it.

### Contract for the next batches

**Server actions** (`src/app/(org)/o/[slug]/reimbursements/actions.ts`, POST, take the **slug**; each runs `gateReimbursementAction(slug)` first: signed in, Node-side 2FA, four-way org miss, applicability, toggle; any member passes, who may file is the database's):

| Action | Input | Result |
|---|---|---|
| `saveRequestAction(slug, input)` | `{ clientKey (8-64 [A-Za-z0-9_-]), requestId?, expectedRevision?, kind: "reimburse"\|"vendor", groupId, beneficiaryPersonId?, vendorName?, amountCents? (int 1..10,000,000), expenseDate? (YYYY-MM-DD), purpose?, categoryId?, preApprovedBy?, noReceiptClaimed? }` | `{ ok: true, data: { requestId, revision } }` or `{ ok: false, error, fieldErrors?, kind? }` |
| `submitRequestAction(slug, input)` | `{ requestId, expectedRevision }` | `{ ok: true, data: { route: "seat"\|"treasurer"\|"nobody"\|null, groupName, message, revision } }` (`message` is the C3 sentence) |
| `withdrawRequestAction(slug, input)` | `{ requestId, reason? }` | `{ ok: true, data: undefined }` |
| `searchBeneficiariesAction(slug, input)` | `{ query }` (2-80 chars after cleaning) | `{ ok: true, data: { candidates: [{ personId, displayName }] } }` (at most 8; empty for a short query, no key, no directory, or a hidden member) |

Save semantics for the form: generate `clientKey` once per mounted form. No `requestId`: create-or-find (a double tap returns the same row, `revision` unchanged). A second Save from the same form passes `expectedRevision` (the one the previous result returned) and is an edit; a stale one gives `kind: "changed_since_viewed"`. An edit page passes `requestId` + `expectedRevision`. `fieldErrors` keys are the input names plus `receipts` (the "add a receipt or tick the box" message at submit) and `_form`. Failure `kind`: `two_factor_required` (with `redirectTo`), `changed_since_viewed`, `not_found` (the neutral `This request isn't available.`, for missing, forbidden and no-longer-editable alike). A database failure throws; the form shows `COPY.form.saveFailed`, never "not allowed".

**Page gate** (`gateReimbursementPage({ slug, path, anyOf? })` in `src/lib/reimbursement/gate.ts`): redirects signed-out to `/signin?callbackUrl=<path>` and a stale 2FA claim to `/totp?callbackUrl=<path>`, `notFound()` for an unknown slug; otherwise `{ ok: true, identity: { userId, personId, organizationId, organizationName, organizationType, slug, has: { requestForOthers, view, pay, manage } } }` or `{ ok: false, state }` with `state.kind` one of `org_forbidden{name,organizationType}`, `org_ended{name,endedOn}`, `not_applicable{name}`, `toggle_off{name,canManageFeatures}`, `forbidden{name}`, `load_error`. Omit `anyOf` for the member surface; pass `["view","pay","manage"]`-style lists for treasury pages. `gateReimbursementRoute({ request, slug, anyOf? })` is the route skin (307/403/404/503, never a 200 for a refusal).

**Readers** (`src/lib/reimbursement/reads.ts`, each takes `{ userId, personId, organizationId }`, the gate's identity): `getFormOptions`, `getOrgToday`, `listMyRequests({limit?,offset?})`, `listWaitingForMe`, `getCounts`, `getRequestDetail(identity, id, "member"|"treasury")` (`not_found` is ONE answer for missing, malformed and forbidden), `getSettings` (`reimbursement.manage`). `denied` means the database refused the caller's identity (no live person here, or a missing key). Detail fields are frozen as built and exported as types from `detail-shape.ts` (`MemberDetail`, `TreasuryDetail`, `FormOptions`, `ReimbursementSettings`); `viewer.relation` is `creator|beneficiary|seat|treasury` (a `treasury`-only viewer on the member detail route is redirected to the admin route, P3-3) and `viewer.canEdit/canWithdraw/canDecide` say what to offer. Timestamps are ISO strings, dates `YYYY-MM-DD`; format with `<FormattedDate>`.

**Library under the Batch 4 actions** (`config.ts`): `setChargeable(actor,{groupId,chargeable})`, `saveCategory(actor,{categoryId|null,name,sortOrder|null})`, `endCategory(actor,{categoryId})`, each audited in-transaction and returning `{kind:"ok"|"refused"|"denied"}`. **Team** (`treasury/team.ts`): the four functions take `surface: "reimbursement"`; Batch 4's `team/actions.ts` wraps them with `path: "reimbursement_team"`.

**For Batch 3:** `submitRequest` already returns `route` and `notifyPersonIds`; add the notice inside `withOrgContext` there. Add `decisions.ts` and the `approve`/`return` audit calls through `auditReimbursement` (the audit-coverage scan already lists those definers as audited and will fail if the call is missing). `outcomes.ts` already holds the approve/return lists, pinned to 0073.

### Gates

- `npm run typecheck` exit 0; `npm run lint` exit 0 (`--max-warnings=0`); `npm run check` all eight tripwires passed; `npm run build` exit 0 (run with `NEXT_PUBLIC_APP_URL=https://app.example.invalid`, `NEXT_PUBLIC_PLATFORM_HOSTS=app.example.invalid` because this worktree's `.env.local` is http on :3590).
- Unit suite without `DATABASE_URL` (CI shape): 611 files passed, 9,177 tests passed, 2,665 skipped (DB-gated).
- New tests: **285** (280 in new files: 188 pure, 92 DB-backed; +5 in existing files). DB-backed subset I touch, serial: `src/lib/giving`, `src/lib/treasury`, `src/lib/reimbursement`, `src/lib/db/domain/reimbursement*`, `org-feature-warnings.db`, `org-feature-categories`, `org-features`, `org-feature-catalog`, `designation-parity.db`, `directory*`, `org-portal`, `audit`, `public-calendar.db`: 96 files, 1,865 tests passed (1,851 on the first run plus `public-calendar.db` 14/14 after the 0067 note below).
- `scripts/treasury/test-rls-73.sql` as presby_app: 52 passes, exit 0.
- Failing-first (mutation) evidence: removing the surface-scope check in `team.ts` fails `refuses a treasury role with none of this surface's keys`; removing the audit call in `endCategory` fails `audit-coverage.test.ts`; before the ruling-1 fixture change the same two `giving/team.db.test.ts` cases failed against the wrapper.
- **0067 note:** `public-calendar.db.test.ts` failed on this Neon branch (`events.website_listed` missing) because `main` added `drizzle/0067_presby_public_events_calendar.sql` and the pipeline branch had not applied it. I applied it as the owner (`psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0067_…sql`) to the `pipeline-treasury` branch only; the suite then passed 14/14. Not applied anywhere else.
- No e2e is assigned to Batch 2a (the four specs and the hydration entry are Batch 7).

### Loop-back candidates and notes for the orchestrator / tech-lead

1. **Copy gaps 1 to 3 above** need a ruling (the tile descriptions block Batch 5/6 copy sign-off).
2. **Orphaned manage key (design residual, not a defect of this batch).** `revokeTreasuryRole` blocks ending the last holder of the SURFACE's own manage key, as designed (EC31). Ending a seven-key `treasurer` grant on the giving page can therefore leave `reimbursement.manage` with no holder if another `giving.manage` holder remains, and vice versa; the founding administrator cannot repair it (F138), only a platform re-designation. A stricter rule (block on any treasury manage key the role carries) needs one new sentence in Copy for the giving page. Left as designed; flagging for a ruling.
3. `giving/team/actions.ts` and `team-list.tsx` still say "outside Giving" (Batch 6 per the table); correct then.
4. The C12 string for `treasurer-designation-section.tsx` and `designation-holder-copy.ts` is likewise Batch 6.

## Batch 3 — api-developer (2026-10-26)

Built on the pipeline branch after `git merge origin/main` (0.44.1, `0f35f10`) and the Phase 3 amendment (`5ccf3ed`, re-read before this section was written). Two commits: `d9ff9d3` (the amendment's Copy: tiles and `copy.ts`) and `80f5c90` (decisions, notices, actions, tests). No schema, migration, permission, flag or proxy/auth change; the Rule 16 shared files are untouched (nothing was uncommitted in this worktree, and the Batch 1a integration patch is still the orchestrator's). No e2e is assigned to Batch 3 (the four specs are Batch 7).

### Files Created

- `src/lib/reimbursement/decisions.ts`: `approveRequest(actor, { requestId, expectedRevision, path: "seat" | "override" })` and `returnRequest(actor, { requestId, expectedRevision, kind: "needs_info" | "not_approved", reason })`. Each is ONE `withOrgContext`: the definer, then (on `ok`) the audit row through `auditReimbursement`, then the notices through `queueNotices`; the inline sends run after the commit and never throw.
- `src/lib/reimbursement/notices.ts` (pure): `NOTICE_TEMPLATE_KEYS`, `NoticeSpec`, `buildNotice(spec, link)`, `noticeLink(origin, slug, requestId, surface)`, `noticeSurface(spec)`. All five requester variants (`approved`, `sent_back`, `not_approved`, `paid`, `closed`) are built now; Batch 4 only has to call `paid` and `closed`.
- `src/lib/reimbursement/notify.ts` (server-only): `queueNotices(tx, { organizationId, requestId, batches })` and `sendQueuedNotices(ids)`.
- Tests: `notices.test.ts` (33), `decisions.db.test.ts` (34), `notify.db.test.ts` (9), `role-bundle.db.test.ts` (6).

### Files Modified

- `requests.ts`: `submitRequest` queues `needs_approval` (route `seat`) or `needs_treasurer` (route `treasurer`) in the submit transaction and sends after commit; `already_submitted` and route `nobody` queue nothing. Result shape unchanged except `notifyPersonIds` is `[]` for `already_submitted`.
- `input.ts` (`approveRequestSchema`, `returnRequestSchema`, `RETURN_KINDS`), `messages.ts` (`decisionRefusal`, `alreadyDecidedFailure`, `returnedMessage`), `dates.ts` (`formatCalendarDate`), `copy.ts` and `copy.test.ts` (amendment keys), `tiles.ts` and `tiles.test.ts` (amendment T1; the `COPY GAP` comment is gone).
- `src/app/(org)/o/[slug]/reimbursements/actions.ts`: `approveRequestAction`, `returnRequestAction`.
- `src/lib/contact-methods/email-audience.ts` (four `person:role` keys; the comment that said no sender uses `person:*` is updated) and `email-audience.test.ts`: the scan's `NAMED` map may now hold a LIST of keys for one call site (`built.templateKey` resolves to the four notice keys, so each is classified and each counts as used); the two pinned-classification tests now expect the four keys.
- `src/lib/testing/reimbursement-fixture.ts`: `email(personId, tag, opts)`, `queued(addresses)`; `cleanup()` deletes the queue rows it caused.
- `audit-coverage.test.ts`: expects `approveRequest` and `returnRequest` and five audited-definer functions.

### Audit events

`REIMBURSEMENT_APPROVED { requestId, path: "seat" }`, `REIMBURSEMENT_OVERRIDE_APPROVED { requestId, path: "override" }`, `REIMBURSEMENT_RETURNED { requestId, kind: "needs_info", byRole }`, `REIMBURSEMENT_NOT_APPROVED { requestId, kind: "not_approved", byRole }`, each with `organizationId`, in the decision's transaction (a failing audit insert rolls the decision, its history event and its notices back; tested). `byRole` is `seat` when the actor was an eligible approver of the group before the move, otherwise `treasurer` (read from the member detail's `viewer.canDecide` BEFORE the definer runs). No reason, name, amount or purpose in any row (asserted against the stored rows).

### Deviations from the Phase 3 text

- **W1** The `ready_to_pay` recipients are the approve definer's `notify_pay_person_ids` (every effective `pay` holder except the approver), as C10 says. That list does not exclude a pay holder who is also the requester or payee; such a person is told, and can pay only under the sole-holder exception (D6). Not changed: C10 names the recipients and the definer owns the list.
- **W2** Notice links need the organization slug. It is read inside the transaction (`select slug from organizations`) rather than passed from the gate, so `submitRequest`'s signature did not change and the link can never disagree with the organization the transition ran in.
- **W3** `queueNotices` dedupes by address inside one notice (two people sharing an inbox are told once per notice), which the design does not mention.
- **W4** Where a message states a date (`This was already approved on {date}.`) the server formats it from the digits (`formatCalendarDate`, "October 25, 2026"; no `Date`, locale or server zone, and `toLocale*` is banned). The failure also carries `decidedOn` (`YYYY-MM-DD`) so the UI may re-render it with `<FormattedDate>`. The format is mine; Copy only says `{date}`. `returned` and `not_approved` both read as "already sent back" and `approved` and `paid` as "already approved" because Copy has exactly those two sentences.
- **W5** `approveRequestAction` returns `{ ok: true, data: { message: "Approved." } }` rather than void, so the UI treats the three decisions alike (V9 wrapping).
- **W6** The `!already` guard in `submitRequest` is redundant with the definer (it returns an empty recipient list for `already_submitted`), so the EC2 notice test passes with the guard removed; the guard is kept as a second line and the test pins the observable fact (no second row, no second send).
- **Scope reading.** The brief said "approve, send back, waive/override paths". Built: approve on both paths and send back from both the seat and the treasurer (`pay`, including from `approved`), all in `decisions.ts`, tested at library level. NOT built, because the design puts them in Batch 4: the treasurer-tree actions (`overrideApproveAction`, `treasuryReturnAction`), the waive verb (`payments.ts`, `REIMBURSEMENT_RECEIPT_WAIVED`), void, payment and the `paid`/`closed` notices. If waive was meant for this batch, say so and it is a small addition to `payments.ts`.

### Copy

No string outside Copy and the amendment was needed. C6 results, C10 subjects, headings, bodies, button and footnote, and the amendment's T1 and T3 strings are used verbatim and pinned. Not used by this batch (UI's): `COPY.decision.withdrawn`, the search strings. The two override refusals (`seat_holder_exists`, `needs_second_payer`) take the neutral string in `decisionRefusal`; the treasurer tree maps them to C8 (they need the group name and whether the viewer holds `manage`).

### Contract for the next batches

**Server actions** (`src/app/(org)/o/[slug]/reimbursements/actions.ts`, POST; each runs `gateReimbursementAction(slug)` first; any member passes, the DEFINER decides who may):

| Action | Input | Result |
|---|---|---|
| `approveRequestAction(slug, input)` | `{ requestId, expectedRevision }`. Always the SEAT path; a posted `path`, person or organization is ignored (tested). | `{ ok: true, data: { message: "Approved." } }` |
| `returnRequestAction(slug, input)` | `{ requestId, expectedRevision, kind: "needs_info" \| "not_approved", reason }`. `reason` is required, cleaned, at most 300. | `{ ok: true, data: { message: "Sent back." \| "Marked not approved." } }` |

Failures: `{ ok: false, error, kind?, fieldErrors? }`. `kind: "already_decided"` adds `decidedOn` (`YYYY-MM-DD`, org-local) and `status` and never names a person; `kind: "changed_since_viewed"` (reload and review); `kind: "not_found"` is the one neutral `This request isn't available.` for missing, forbidden, not-yours and no-longer-decidable; a missing reason is `fieldErrors.reason` = `Give a reason.`; `two_factor_required` as before. A database failure throws. Both revalidate the member list and detail and the treasurer queue and detail paths.

**Library for Batch 4's treasurer tree** (`decisions.ts`): `approveRequest(actor, { requestId, expectedRevision, path: "override" })` returns `{ kind: "ok", path, decidedOn } | { kind: "already_decided", decidedOn, status } | { kind: "refused", outcome } | { kind: "denied" }` with `outcome` one of `not_found`, `not_approvable`, `changed_since_viewed`, `seat_holder_exists`, `needs_second_payer`; `returnRequest(actor, { …, kind: "needs_info", reason })` works for a `pay` holder from `submitted` (no eligible approver) and from `approved` (`needs_info` only; `not_approved` from approved is `kind_invalid`). `denied` is the identity refusal (override without `pay` is `denied`, tested). Batch 4's `payments.ts` should reuse `queueNotices` / `sendQueuedNotices` with `{ kind: "requester_update", variant: "paid" | "closed" }` and the same in-transaction pattern.

**Notices** (`reimbursement.notice.*`, all `person:role`): `needs_approval` (approvers; submit, route `seat`), `needs_treasurer` (pay holders other than the requester and payee; submit, route `treasurer`), `ready_to_pay` (pay holders other than the approver; approve), `requester_update` (the creator; approve, send back, not approved). Member link `<platform origin>/o/<slug>/reimbursements/<id>` for approvers and the requester; `<platform origin>/o/<slug>/admin/reimbursements/<id>` for `needs_treasurer` and `ready_to_pay`. A recipient with no deliverable address (none, or do-not-contact) gets no row and no error; a null `platformOrigin()` writes none and the transition commits.

**For Batch 5 (UI):** `viewer.canDecide` from the member detail says whether to render Approve and Send back; the dialogs call the two actions above; show `error` under the reason field when `fieldErrors.reason` is set; on `already_decided` show `error` (or render `decidedOn` with `<FormattedDate>` into the same Copy sentence). Withdraw has no reason field (amendment); use `COPY.decision.withdrawn` for its toast.

### Gates

- `npm run typecheck` exit 0; `npm run lint` exit 0 (`--max-warnings=0`); `npm run check` all eight tripwires passed.
- Unit suite without `DATABASE_URL` (CI shape): 612 files passed, 9,271 tests passed, 2,714 skipped (DB-gated).
- New or changed tests: about 115 (33 `notices`, 34 `decisions.db`, 9 `notify.db`, 6 `role-bundle.db`, +14 `actions`, +9 `messages`, +6 `input`, +2 `dates`, +1 `tiles`; `email-audience` and `copy` assertions extended, one `email-audience` case rewritten).
- DB-backed subset I touch, serial: `src/lib/{reimbursement,treasury,giving,contact-methods,org-portal,org-feature*,audit*}`, `src/lib/db/domain/reimbursement*`, `designation-parity.db`, the member actions test: 111 files, 2,132 tests passed, 1 skipped, 0 failed.
- `scripts/treasury/test-rls-73.sql` as presby_app: 52 passes, exit 0.
- Mutation evidence (each restored): removing the audit call from `approveRequest` fails `audit-coverage.test.ts › every function that calls an audited write definer calls auditReimbursement`; mapping every notice to the member surface fails `notices.test.ts › approvers and the requester go to the member route; pay holders to the treasury route` and `notify.db.test.ts › route treasurer`; the decisions DB suite pins separation of duties, the stale revision, the seat that ends mid-queue, two concurrent approvers (one wins), the override with one and two pay holders, and the audit-failure rollback (decision, history event and notices all roll back). The failing-first order for the pure modules was test, red (missing module/exports), then code.

### Loop-back candidates and notes

1. **Scope reading of "waive"** (see Deviations): confirm it is Batch 4's.
2. **W1**: a pay holder who is also the requester gets `ready_to_pay`. Harmless (they can pay only as the sole holder), but if undesirable the fix is in the approve definer's list, a Batch 1 edit.
3. **Test-environment note.** `decisions.db.test.ts` and `notify.db.test.ts` mock `@/lib/audit` (its `@/auth` import does not resolve under Vitest, as in `config.db.test.ts`) and `attemptQueuedSend`; the queue insert, `getPersonEmail` and the audit insert are real.

## Batch 4 — api-developer (2026-10-26)

Built on the pipeline branch (`git merge origin/main` said "Already up to date": origin/main is 0.44.1, `8602994`, already merged). Receipts are NOT in this batch (Batch 2b, waits on F289's `store({audience})`); nothing here touches the blob store, `blob_assets` or `sharp`, and the receipt requirement is enforced where Batch 1a put it, in the definers. No schema, migration, permission, flag, proxy or auth change; the Rule 16 shared files are untouched (the Batch 1a integration patch is unchanged and still the orchestrator's). No e2e is assigned to Batch 4 (the four specs and the hydration entry are Batch 7).

### Files Created

- `src/lib/reimbursement/payments.ts`: `recordPayment`, `reversePayment`, `waiveReceipt`, `voidRequest`, `addNote`. Each is ONE `withOrgContext`: the definer, then (on `ok`) the audit row through `auditReimbursement`, then the requester notice through `queueNotices`; the inline send runs after the commit and never throws. WHO MAY and the order of the definer's checks are untouched (who may pay, `payer_is_approver` and `needs_another_payer`, comes before `receipt_missing`).
- `src/lib/reimbursement/csv-export.ts`: `exportRequests(actor, filters)`: the `export_rows` read and its `REIMBURSEMENT_EXPORTED` audit in ONE transaction; `too_many` past the cap before anything is audited.
- Pure: `csv-shape.ts` (header, row, `buildRequestsCsv`, `exceedsCsvCap`), `queue-query.ts` (`parseQueueQuery`, `parseExportFilters`, `TREASURER_TABS`, `QUEUE_PAGE_SIZE`), `treasury-input.ts` (the ten treasurer-tree zod schemas), `treasury-messages.ts` (definer outcome to Copy, per verb).
- `src/app/(org)/o/[slug]/admin/reimbursements/actions.ts` (ten actions), `…/team/actions.ts` (three), `…/export/route.ts` (the CSV GET).
- Tests: `treasury-input.test.ts`, `treasury-messages.test.ts`, `csv-shape.test.ts`, `queue-query.test.ts` (pure, written and run RED first, then the modules); `payments.db.test.ts` (27), `treasurer-reads.db.test.ts` (12), `csv-export.db.test.ts` (9), `csv-export.cap.db.test.ts` (1); `admin/reimbursements/actions.test.ts` (41), `…/team/actions.test.ts` (21), `…/export/route.test.ts` (10).

### Files Modified

- `reads.ts`: `listTreasurerRequests(identity, {tab, groupId, from, to, page})` (the `treasurer_list` reader) and `getPayHolderCount(identity)` (over `counts.payHolderCount`).
- `action-result.ts`: one optional field, `suggestTeam?: true`, on the failure (see Contract).
- `copy.ts` / `copy.test.ts`: five answers the team actions need that C9 names no sentence for, REUSED verbatim from giving's team actions (`COPY.team.invalidRole`, `assignmentEnded`, `endFromRoles`, `templateUnavailable`, `ensureEscalation`); the test asserts each appears in `giving/team/actions.ts`. See Copy gaps.
- `keys.ts`: `TEAM_TEMPLATE_KEYS` (pure), pinned to `TEAM_SURFACES.reimbursement.templateKeys` by `team.db.test.ts`.
- Extended: `audit-coverage.test.ts` (the export, the "every audited definer has a caller" ratchet, the unaudited doors), `gate-coverage.test.ts` (the treasurer tree's three surfaces are found; every treasurer-tree gate call names its key), `role-bundle.db.test.ts` (+3), `treasury/team.db.test.ts` (+4: residual 12 and the template pin).

### Audit events

All twelve keys already existed. Written in Batch 4, in the same transaction as the change (a failing audit insert rolls the act back; tested for record, reverse, void and export):

| Act | Key | Metadata (ids and tags only) |
|---|---|---|
| record payment | `REIMBURSEMENT_PAYMENT_RECORDED` | `requestId`, `method`, `selfPaid` |
| reverse | `REIMBURSEMENT_PAYMENT_REVERSED` | `requestId`, `paymentId` |
| waive | `REIMBURSEMENT_RECEIPT_WAIVED` | `requestId` |
| void | `REIMBURSEMENT_VOIDED` | `requestId` |
| CSV export | `REIMBURSEMENT_EXPORTED` | `rowCount`, `from`, `to`, `status` (resource is the organization) |
| override approve, treasurer send back | `…_OVERRIDE_APPROVED`, `…_RETURNED` | Batch 3's `decisions.ts`, unchanged; the treasurer actions call it |

Every row also carries `organizationId`. No reference, reason, note, name, amount or purpose in any row (asserted against the stored rows). A refused export (413, denied) writes no row. Add-note writes none (the events table is its record; `audit-coverage.test.ts` classifies it). The team actions audit after the commit with `recordAudit()` and `path: "reimbursement_team"`, the giving team's shape, so `check:audit` finds them: `TENANT_ROLE_GRANTED`, `TENANT_ROLE_REVOKED`, `ROLE_DEFINITION_ADOPTED_FROM_TEMPLATE`.

### Notices (Batch 3's `queueNotices` / `sendQueuedNotices`)

`recordPayment` queues `requester_update` / `paid`; `voidRequest` queues `requester_update` / `closed`. Recipient: the creator (the definer's `notify_requester_person_id`). The `paid` and `closed` text and the no-leak assertions are Batch 3's `notices.test.ts`; `payments.db.test.ts` re-asserts on the stored row that no amount, reference, name, group or date is in the paid mail and no reason in the closed mail. Nothing is sent for a reversal (C10 has no such notice).

### Deviations from the Phase 3 text

- **X1** No notice to the creator when the creator is the person acting. A sole pay holder paying (or voiding) their own request is not emailed about their own click. C10 says "the creator"; this is a narrowing, tested (`payments.db.test.ts`). Batch 3's approve path does not need it (an approver cannot be the creator).
- **X2** The treasurer's send back is always "needs changes": `treasuryReturnSchema` has no `kind` field, so a posted `kind: "not_approved"` is dropped (C8: "Send back: as C6 with kind fixed to Needs changes"). Mutation-tested.
- **X3** `suggestTeam?: true` on the action failure. C8 says the override refusal `needs_second_payer` carries ` Add one under Treasury team.` as a link only for a viewer who holds `manage`. A server action returns text, not a link, so it returns the sentence without that suffix and `suggestTeam: true` for a manager; the UI appends `COPY.treasury.override.addOneUnderTeam` as a link. A `pay`-only viewer gets neither.
- **X4** The group name in `seat_holder_exists` ("Someone in {group} can approve this...") is read with the member-level detail after the refusal (one extra read, refusal path only). A `pay` holder with no `view` cannot read the request, so the sentence says "the group", as the member form does.
- **X5** The treasurer actions share one gate call per verb with the key it needs (`anyOf: ["pay" | "view" | "manage"]`), so the first refusal is the gate's `You don't have permission to do that.`, not the definer's; the definers still re-check (a `denied` result maps to the same string). The 2FA bounce target for an `anyOf` gate is `/admin/reimbursements` (2a's gate).
- **X6** `listTreasurerRequests` past the last page returns `{ items: [], total: 0 }` (the definer's `count(*) over ()` has no row to carry the count). The UI should not show "page 2 of 0"; it can clamp from page 1's `total`.
- **X7** Invalid query values are dropped, not errors (`parseQueueQuery`, `parseExportFilters`; the giving shape), and `status=draft` is dropped from the export. A malformed `from` therefore widens a CSV rather than failing it, and the audit row records the filter that was applied (null), so the record stays true. No Copy sentence exists for a rejected filter.
- **Scope reading.** Waive, void and add-note are in `payments.ts` as the brief and the file plan say. The treasurer-tree `overrideApproveAction` and `treasuryReturnAction` are thin over Batch 3's `approveRequest(path: "override")` and `returnRequest(kind: "needs_info")`; `decisions.ts` is not edited.

### Copy gaps (strings not in the Copy section or the amendment; rule: stop and report)

Nothing in Batch 4 was blocked, but these are reported for a ruling. Where a sentence was needed, the closest existing Copy string was used and is named.

1. **`note_required`** (an empty treasury note). No sentence. Used `COPY.form.saveFailed` ("We couldn't save that. Your entries are still here. Try again.") next to the note field. Suggest: `Write a note.`
2. **A payment dated before the expense date.** The definer's `date_out_of_range` covers both "in the future" and "before the expense". C8 has only `Choose a date that isn't in the future.`, which is untrue for the second case. Used it for both. Suggest: `Choose a date between the day of the expense and today.`
3. **A category that vanished** (`not_found` on rename or retire, a stale settings page). Used `COPY.form.saveFailed`.
4. **Tampered shape** (`method_invalid`, a bad group or category id): `COPY.form.saveFailed`, as the member schemas do.
5. **Team actions, five answers**: reused giving's module-neutral sentences verbatim (see Files Modified). **One is a real gap**: `ensureTreasuryRole` answering `not_treasury_only` (the org's role of that key already carries a key outside the treasury modules) uses `COPY.team.notTreasuryOnly` ("...Grant it from Roles instead."), which is slightly off for a set-up action; giving's equivalent is "That role already exists with permissions outside Giving. An administrator can fix it under Roles." and names a module, so it was not copied.
6. **Settings success messages**: C9 has none; the three settings actions return data only (`changed`, `categoryId`/`created`) and the UI needs no toast text unless Copy supplies one.
7. **`not_waivable`, `receipt_present`, `not_voidable`, `not_reversible`** are the neutral `This request isn't available.` (a deliberate EC16 reading), but a treasurer who hand-posts a stale request sees that for "you already waived it". The pages hide a verb the request cannot take, so this is reachable only from a stale tab.

### Contract for Batch 5 and 6 (UI)

**Treasurer-tree server actions** (`src/app/(org)/o/[slug]/admin/reimbursements/actions.ts`, POST, first argument the **slug**; each runs `gateReimbursementAction(slug, { anyOf: [key] })` first: sign-in, Node-side 2FA, four-way org miss, applicability, the toggle, the key read live). Result: `ReimbursementActionResult<T>` = `{ ok: true, data } | { ok: false, error, kind?, fieldErrors?, redirectTo?, decidedOn?, status?, suggestTeam? }`. `kind` is `two_factor_required` (with `redirectTo`), `changed_since_viewed`, `already_decided` (with `decidedOn` YYYY-MM-DD and `status`), or `not_found` (the neutral `This request isn't available.`). A database failure THROWS.

| Action | Key | Input | `data` on success |
|---|---|---|---|
| `recordPaymentAction` | pay | `{ requestId, method: "check"\|"ach"\|"cash"\|"other", reference?, paidOn: "YYYY-MM-DD", note? }` (a check needs `reference`; the payer is the signed-in user; never a person, payer or self-paid input) | `{ message: "Payment recorded.", selfPaid }` |
| `reversePaymentAction` | pay | `{ requestId, reason }` (required, <=300) | `{ message: "Payment reversed." }` |
| `waiveReceiptAction` | pay | `{ requestId, note? }` (<=300) | `{ message: "Receipt waived." }` |
| `treasuryReturnAction` | pay | `{ requestId, expectedRevision, reason }` (kind fixed to needs changes) | `{ message: "Sent back." }` |
| `voidAction` | pay | `{ requestId, reason }` | `{ message: "Request voided." }` |
| `overrideApproveAction` | pay | `{ requestId, expectedRevision }` (path fixed to override) | `{ message: "Approved." }` |
| `addNoteAction` | view | `{ requestId, note }` (required, <=500) | `{ message: "Note added." }` |
| `setChargeableAction` | manage | `{ groupId, chargeable: boolean }` | `{ changed }` |
| `saveCategoryAction` | manage | `{ categoryId?: null for create, name (1-60), sortOrder?: int\|null }` | `{ categoryId, created }` |
| `endCategoryAction` | manage | `{ categoryId }` | none |

Field errors are keyed by input name: `reference`, `paidOn`, `note`, `reason`, `name`, `groupId`. The pre-form blocks of C8 come back as `{ ok: false, error }` with no field (`payer_is_approver`, `needs_another_payer`, `receipt_missing`, `not_payable`, `already_paid`); the UI should ALSO decide which block to show BEFORE rendering the form, from the treasury detail's `treasuryViewer` (`isApprover`, `isRequesterSide`, `anotherPayerExists`) and `status` / `receiptWaived` / `receipts`, so the action's answer is the backstop. The override refusals: `error` is the C8 sentence; when `suggestTeam` is true append `COPY.treasury.override.addOneUnderTeam` as a link to `/o/<slug>/admin/reimbursements/team`.

**Team actions** (`…/admin/reimbursements/team/actions.ts`, key manage): `grantTreasuryRoleAction(slug, { roleId, personId })` -> `{ grantId }`; `revokeTreasuryRoleAction(slug, { grantId })`; `ensureTreasuryRoleAction(slug, { templateKey: "treasurer" | "reimbursement_clerk" })` -> `{ roleId, skippedKeys }`. Errors are Copy C9 (`COPY.team.*`). The page reads `listTreasuryTeam("reimbursement", personId, organizationId)` from `@/lib/treasury/team` (exists since 2a) and renders `COPY.team.setUpTreasurer` / `setUpClerk` for `missingTemplates`.

**Readers** (`reads.ts`, take the gate's `identity`): `listTreasurerRequests(identity, query)` with `query = parseQueueQuery(searchParams)` -> `{ kind: "ok", items: TreasurerListItem[], total } | { kind: "denied" }` (`denied` = no `view`; the page's gate already redirected/forbade, so it is a backstop). 50 per page (`QUEUE_PAGE_SIZE`); page past the end: empty, total 0 (X6). `getCounts` (2a) gives the tab counts for a `view` holder (`needsTreasurer`, `waitingForPayment`, `inProgress`; `paid` and `all` have no count). `getPayHolderCount(identity)` -> number for the "No one can record payments yet" banner. `getRequestDetail(identity, id, "treasury")` is the treasury detail (2a). `getSettings(identity)` is the settings page's read (2a).

**The CSV** (`GET /o/<slug>/admin/reimbursements/export?from&to&status`, key view): `Export CSV` is a plain link to this route with the queue's `from`/`to` (and `status` only for the paid/etc. tabs if the UI wants it). 413 body is `COPY.queue.exportTooLarge`, text/plain; show nothing special, the browser downloads or shows the text. The dates filter on the org-local date the request was last SUBMITTED, so the filter labels must say "submitted".

**Known UI gap for Batch 6 (not a defect here):** the queue's "Charged to" filter needs the list of groups, and no reader gives a `view`-only holder one. `getFormOptions` lists the chargeable groups only when the viewer may FILE; `getSettings` needs `manage`. Options: derive the filter from the distinct `groupId`/`groupName` of the unfiltered `all` tab, or add a read definer (a Batch 1 schema change, not mine). Needs a ruling before Batch 6 builds the filter.

### Gates

- `npm run typecheck` exit 0; `npm run lint` exit 0 (`--max-warnings=0`); `npm run check` all eight tripwires passed (including `check:audit`, `check:secrets` over the new fixtures, `check:hydration-gate`: no form was added); `npm run build` exit 0 (run with `NEXT_PUBLIC_APP_URL=https://app.example.invalid NEXT_PUBLIC_PLATFORM_HOSTS=app.example.invalid` because this worktree's `.env.local` is http on :3590); `/o/[slug]/admin/reimbursements/export` is in the route table.
- Unit suite without `DATABASE_URL` (CI shape): 619 files passed, 9,392 tests passed, 2,770 skipped (DB-gated). Batch 3 left it at 612 / 9,271 / 2,714: +7 files, +121 tests, +56 DB-gated.
- New or changed tests: **177** (121 pure: 16 `treasury-input`, 12 `treasury-messages`, 10 `csv-shape`, 6 `queue-query`, 41 treasurer `actions`, 21 `team/actions`, 10 export `route`, +1 `copy`, +3 `audit-coverage`, +1 `gate-coverage`; 56 DB-backed: 27 `payments.db`, 12 `treasurer-reads.db`, 9 `csv-export.db`, 1 `csv-export.cap.db`, +3 `role-bundle.db`, +4 `treasury/team.db`).
- DB-backed subset I touch, serial (`--no-file-parallelism`, `.env.local`): `src/lib/{reimbursement,treasury,giving,org-feature*,org-portal,contact-methods,audit*}`, `src/lib/db/domain/reimbursement*`, `designation-parity`, both admin trees' tests and the member actions test: **168 files, 2,813 tests passed, 1 skipped (pre-existing), 0 failed**, 756 s.
- `scripts/treasury/test-rls-73.sql` as presby_app: **52 passes, exit 0** (unchanged; no schema in this batch).
- Failing-first and mutation evidence (each restored, files byte-identical afterwards): the four pure modules and their tests were written test-first and run RED (`Cannot find module`) before the modules existed, then green. Mutations: removing the `auditReimbursement` call from `recordPayment` fails `audit-coverage.test.ts › every function that calls an audited write definer calls auditReimbursement`; deleting the cap test from `exportRequests` fails `audit-coverage.test.ts › the CSV export …` AND `csv-export.cap.db.test.ts` (`expected ok to equal too_many`); letting `treasuryReturnAction` read a posted `kind` fails `actions.test.ts › sends back for CHANGES only`. The DB suites pin: audit and notice rolled back with the payment, void and export when the audit insert fails; the approver told `payer_is_approver` BEFORE `receipt_missing`; the sole pay holder paying their own request (`self_paid`, audited, not emailed) versus `needs_another_payer` with a second holder; an approved request staying payable after the requester's membership ends; reversal as its own row and a second payment after it; the date filters on two organizations 25 hours apart.
- Residual 12 is pinned by `treasury/team.db.test.ts › residual 12`: ending the sole `treasurer` grant on the giving page leaves `reimbursement.manage` unheld (and the reverse), the grant ended and not deleted, `listTreasuryTeam("reimbursement")` forbidden for everyone left; and the within-surface guard still blocks the last holder. A future stricter rule changes these tests on purpose.
- Backfill and bundle: the 0074 backfill (EC29) is Batch 1a's `reimbursement-permissions.db.test.ts` (7, unchanged and green); the role bundle (EC31) is extended here with the payment half: the designation-minted treasurer cannot pay what they approved, the second payer they named does and the filer is told, and that treasurer, holding only that role, runs note, reverse, send back from approved, void, chargeable groups, categories and the export; the founding administrator can do none of it.
- No e2e is assigned to Batch 4.

### Loop-back candidates and notes

1. **Copy gaps 1, 2 and 5 above** (a note sentence; the paid-before-expense date sentence; the set-up-role `not_treasury_only` sentence) want a ruling before Batch 6 ships the forms; the rest are reuse of existing strings.
2. **The queue's group filter has no data source for a `view`-only holder** (Contract, "Known UI gap"). Needs a ruling: derive from the `all` tab, or a new read definer (Batch 1 schema work).
3. `treasurer_list`'s `total_count` is 0 for a page past the end (X6); not a defect, a UI note.
4. The five `test:db` failures expecting `localhost:3000` (the Batch 1a environmental note) were not part of this subset; unchanged.
5. `docs/work-log/treasury-inc1.integration.patch` is unchanged; nothing in this batch needs a shared-file edit. `docs/TODO.md`: the residual-12 line and the stale giving-team strings (C12, Batch 6) are still the orchestrator's / Batch 6's.


## Batch 5 — ux-developer (2026-10-26)

Built on `pipeline/treasury` at `3e8523f`. No schema, migration, permission, flag, proxy or auth change; the Rule 16 shared files are untouched (the e2e fixture is inline in the spec, as allowed). Receipt upload is NOT built (Batch 2b, F289's adapter); the form carries a bounded slot for it (below). `src/lib/reimbursement/` is unchanged: every string is an existing `COPY` key.

### Files Created (all under `src/app/(org)/o/[slug]/reimbursements/` unless noted)

- Pages: `page.tsx` (list), `new/page.tsx`, `[id]/page.tsx` (request), `[id]/edit/page.tsx`, `[id]/not-found.tsx` (the neutral 404, a client component only to read the slug). No `loading.tsx` anywhere in the tree.
- Server components: `reimbursement-states.tsx` (one renderer for every `ReimbursementGateState`, plus `ReimbursementLoadError` and `BackToReimbursements`; Batch 6 reuses them), `request-list.tsx` (cards, not tables), `request-detail.tsx`, `status-badge.tsx`, `date-sentence.tsx` (a Copy sentence with `<FormattedDate>` in it).
- Client: `request-form.tsx` (`useForm` root in `<HydrationGate>`), `amount-field.tsx`, `beneficiary-picker.tsx`, `decision-panel.tsx` (Approve `AlertDialog`), `send-back-dialog.tsx` (`Dialog`, `useForm` root in `<HydrationGate>`), `withdraw-dialog.tsx` (`AlertDialog`), `receipt-slot.tsx`.
- Pure: `request-form-model.ts` (values, `buildSavePayload`, `validateForDraft` / `validateForSend`, `mapServerFieldErrors`, `detailToFormValues`), `decision-feedback.ts`.
- Tests: `request-form-model.test.ts`, `amount-field.test.tsx`, `request-form.test.tsx`, `beneficiary-picker.test.tsx`, `decision-dialogs.test.tsx`, `pages.test.tsx`; `e2e/reimbursement-member.spec.ts`; `e2e/hydration/reimbursement-form.spec.ts`.

### Behaviour worth a reviewer's click

- **Form.** Pay me back / Pay someone else back (only with `request_for_others`) / Pay a vendor; group, category (only when the org has any), beneficiary search, vendor name, digit-entry amount, date (`max` = org-local today, no `min`: an unchanged old date must stay resubmittable, P3-18), purpose, pre-approver, receipts section. **Both buttons are `type="button"` and the form's own submit is swallowed, so Enter in a text box can never Send.** Send = save, then submit on the revision the save returned; a refused submit leaves the draft and a retry edits the same draft (`requestId` + `expectedRevision`). Idempotency: the page mints `clientKey`; a ref guards the tap itself. First Save draft on `/new` moves to the draft's `/edit` address (so a reload edits it); an unsaved-changes guard (the shared hook and dialog) covers Cancel and in-app links.
- **Entries survive a failed save** (the amendment's requirement): a thrown call, a refused field, a stale revision, a draft limit all leave every control as typed; `reset()` runs only after a successful save. Pinned by `request-form.test.tsx` (mutation-checked: adding `reset()` to the catch fails it) and by the e2e that drops the server action's POST.
- **Amount.** Typing 1, 2, 5, 0 reads $12.50; a paste goes through `pastedAmountToCents` only ("12.345", "1e5", "-5", a non-ASCII digit, over $100,000 are refused, field unchanged, amount error shown).
- **Beneficiary picker.** As ruled in amendment T3: under two characters nothing and no call; `No match.` only after a search ran; hidden polite `{n} people found.`; gate refusal shows the action's text; thrown call shows `We couldn't search just now. Try again.`; picked name replaces the box with `Change`; stale replies dropped by sequence number; Enter swallowed.
- **Request page.** H1 is the amount (a draft with no amount falls back to "Reimbursements"); status badge (text, 14px: `text-sm` overrides the badge's 12px); banner by status and audience ("Sent back to you" for creator and beneficiary, "Sent back" for approvers); flags by audience (the duplicate-receipt flag is null for the requester, so it cannot render for them); history in Copy's labels with no names; Edit / Edit and send again, Withdraw (when `viewer.canEdit` / `canWithdraw`); Approve / Send back (when `viewer.canDecide`). A viewer whose relation is `treasury` is redirected to `/o/<slug>/admin/reimbursements/<id>` (P3-3); that page is Batch 6, so until then the redirect lands on a 404. A missing id, a forbidden one, a malformed one and a refused identity are the same `notFound()`.
- **Decisions.** Approve states `{amount} to {payee}, charged to {group}…`; every decision carries the revision the page displayed; `changed_since_viewed`, `already_decided` and `not_found` toast the Copy sentence, close the dialog and `router.refresh()`; a thrown call keeps the dialog open. Send back: radio (Needs changes / Not approved), required reason (judged after cleaning, at most 300), reason kept through any failure. Withdraw has no reason field (T3).
- **Gate states** (200, never a 404): toggle off (with a `Features` link only when `canManageFeatures`), not applicable, load error, plus the (org) tree's own denied / ended pages. A member who may not file sees `cannotFile` and still sees the list; `/new` shows the same sentence instead of a form.

### The receipt slot (contract for Batch 2b)

`receipt-slot.tsx` is the one place 2b fills. `RECEIPTS_AVAILABLE = false`; the form renders `<ReceiptSlot>` (and the C3 hint `Photos and PDFs…`) only when it is true. Live now: the `Receipts` label, the `I can't attach a receipt` box with its hint, and the Send-time check (`Add a receipt, or tick “I can't attach a receipt”.`). **Until 2b, a request can be sent only with that box ticked** (design gap: submission needs a receipt or the claim, and the claim is the only one expressible). 2b should: replace the file body, flip the constant, keep `ReceiptSlotProps { slug, requestId | null, receipts, disabled, error?, ensureDraft(), onChange({ receipts, revision }) }`; call `ensureDraft()` before the first upload (it saves the form and returns `{ requestId, revision }`, idempotently); report the new `revision` after every attach and detach (each moves the revision by one, P3-8). **Gap in the documented upload route:** its response is `{ attachmentId, displayName, byteSize, contentType }` with no revision, so 2b must add `revision` to it (or re-read the detail); otherwise the next Save answers `changed_since_viewed`. No `capture` on the file input (T3). The detail page already links each receipt to `/o/<slug>/reimbursements/<id>/receipts/<attachmentId>` with a plain `<a>` (route handler, not a page) and shows `No receipt attached.` when empty; the `Remove` / `Receipt not available.` strings are the slot's.

### Copy

No string outside Copy or an existing shared component was added. Reused shared-component strings that are not in Copy: `Try again` (the load-error button, the giving and `LoadError` wording), `Features` (the link word inside C2's sentence), and the unsaved-changes dialog's `Discard unsaved changes?` / `Stay` / `Discard` (existing `UnsavedChangesDialog`). **Gaps to rule on:**

1. **No chargeable group.** Phase 1 Flow 6 had a request-form empty state ("No committee can receive requests yet…"); Phase 3 Copy has only the settings page's `noGroups` (for `manage` holders). With zero chargeable groups the member sees an empty `Charge to` select and, on Send, `Choose a group to charge this to.` A sentence for the member (and who to tell) is needed.
2. **Page heading of the request page.** Copy names none; the amount is the H1 (a draft with no amount shows `Reimbursements`).
3. `COPY.queue.sentOn` (`Sent {date}`) is reused on the waiting list's cards.

### Deviations from the Phase 3 text

- **U1** Both form buttons are `type="button"` (see above); the design said "Actions … `useFormStatus()`", which fits a `<form action>` form; this one is react-hook-form (the house pattern for the money forms) and posts through the actions directly.
- **U2** Draft with "Pay someone else back" and no person chosen is refused client-side (`Choose who to pay back.`): saved without a person it would come back as "Pay me back".
- **U3** The unsaved-changes guard on the form (ui-standards), not in the design.
- **U4** "Print the form" is not offered (the print route is Batch 7).

### Tests

- Unit (new): 88 in the route folder (`request-form-model` 14 incl. the model, `amount-field` 7, `request-form` 15, `beneficiary-picker` 8, `decision-dialogs` 14, `pages` 29, plus the model/amount counts above) — files 619 → 625, tests 9,393 → 9,478.
- E2E on my own dev server :3590: `e2e/reimbursement-member.spec.ts` 18/18 (blank Send, digit entry and paste, failed save keeps entries, double tap = one request, list cards, chair approves through the dialog, send back with reason then edit and resend, stale revision and late approve, neutral 404 for forbidden / missing / malformed / edit, GET twice changes nothing, withdraw, vendor and on-behalf with the directory search, cannot-file, toggle off at HTTP 200, long values at 360, 1280 walk, signed-out deep link through `/signin`). `e2e/hydration/reimbursement-form.spec.ts` 1/1 on :3590 and on the production lane (`PW_PROD_BUILD=1 PW_PROD_PORT=3591`). Negative control: with `<HydrationGate>` removed from `request-form.tsx` the hydration spec fails.
- Not run here: the MFA treasurer deep link and the treasurer / role-bundle / toggle-page specs (Batch 7), anything with a receipt (2b).

### Walk (real Chromium, recorded 2026-10-26; screenshots in gitignored `test-results/reimbursement-360/` and `reimbursement-1280/`)

360 × 740: list (empty, with rows, as approver), new form (blank, errors, filled, vendor, beneficiary search), request page as requester and approver (Approve and Send back at least 44 px tall, inside 360 px), both dialogs, toggle-off, long values (400-character unbroken purpose, 110-character vendor): `scrollWidth <= innerWidth` asserted on each, none scrolled sideways. 1280 × 900: list, new, edit draft, request as requester and approver, both dialogs, no sideways scroll. Observed and fine: the date input is the browser's native control; the footer tile nav shows the Reimbursements tile from Batch 2a. Not done: a real phone (iOS Safari) and a screen-reader pass.

### Gates

`npm run typecheck`, `npm run lint` (`--max-warnings=0`), `npm run check` (eight tripwires; `check:secrets` re-run after the commit), `npm run build` (with `NEXT_PUBLIC_APP_URL=https://app.example.invalid NEXT_PUBLIC_PLATFORM_HOSTS=app.example.invalid`) all exit 0; `/o/[slug]/reimbursements`, `/new`, `/[id]`, `/[id]/edit` in the route table. `npm run test` 625 files passed, 9,478 tests passed, 2,774 skipped (DB-gated). `gate-coverage.test.ts` (the source scan over both trees) passes with the five new pages.

### Loop-back candidates and notes

1. Copy gap 1 (no chargeable group) needs a ruling before Batch 7's walk.
2. The receipt route response needs a `revision` (above).
3. The `treasury`-relation redirect targets a Batch 6 page.
4. Rule 16: nothing needed. Batch 7 may lift the inline fixture in `e2e/reimbursement-member.spec.ts` into `e2e/support/reimbursement-fixture.ts` and extend the two specs.

## Batch 6 — ux-developer (2026-10-26)

Built on `pipeline/treasury` at `3d51b9a`. No schema, migration, permission, flag, proxy or auth change; no Rule 16 shared file touched (fixtures inline in the two new specs). Receipts stay Batch 2b: the treasurer page links receipts exactly as the member page does, and Waive works without uploads.

### Files Created
- Queue (`src/app/(org)/o/[slug]/admin/reimbursements/`): `page.tsx`, `queue-model.ts` (pure: hrefs from the PARSED query, export href, page count, X6 clamp test, empty sentence, group options), `queue-tabs.tsx`, `queue-filters.tsx` (GET form, no `useForm`), `queue-list.tsx`.
- Request page (`[id]/`): `page.tsx`, `not-found.tsx`, `treasury-detail.tsx`, `treasury-ui.ts` (pure: which payment block or form, which verbs), `payment-form.tsx` (`useForm` + `HydrationGate`), `reason-dialog.tsx` (one dialog for Reverse, Waive, Send back, Void, Add a note; `useForm` + `HydrationGate`), `override-dialog.tsx` (AlertDialog, X3 link), `treasury-verbs.tsx`.
- `settings/`: `page.tsx`, `chargeable-groups.tsx`, `categories-panel.tsx`, `add-category-form.tsx`, `rename-category-dialog.tsx`, `approver-note.ts`. `team/page.tsx`. `src/components/treasury/`: `team-panel.tsx`, `team-grant-list.tsx`, `team-grant-form.tsx`, `team-setup-buttons.tsx`.
- Shared with the member tree: `reimbursements/request-parts.tsx` (Field, banner, receipts field, history list, extracted from `request-detail.tsx`, behaviour unchanged).
- Tests: `queue-model.test.ts` (10), `[id]/treasury-ui.test.ts` (13), `pages.test.tsx` (35), `[id]/treasury-dialogs.test.tsx` (35), `settings/{settings-components.test.tsx (13), approver-note.test.ts (2)}`, `components/treasury/team-panel.test.tsx` (12), +2 in `copy.test.ts`, +1 in `request-form.test.tsx`, +1 pin in the designation-section test. `e2e/reimbursement-treasurer-ui.spec.ts` (14), `e2e/hydration/reimbursement-treasurer-forms.spec.ts` (2).

### Files Modified
- C12 (commit `9ca6ab1`): `giving/team/actions.ts:54,:142` and `team-list.tsx:107` ("outside Giving and Reimbursements", grant wording per amendment S2), the designation confirm dialog (`treasurer-designation-section.tsx`) and `designation-holder-copy.ts` `treasurerLine`; their tests and `e2e/designation-revoke.spec.ts:287`.
- Orchestrator ruling on Batch 5: `COPY.form.noChargeableGroup` and `request-form.tsx` (the sentence replaces the `Charge to` select, Send disabled, Save draft left available), with a unit test and an e2e.
- `reimbursement-states.tsx`: `loadErrorMessage` and `href` props (the treasurer pages say "requests", not "your requests", and go back to the queue).
- `copy.ts`: `COPY.team.panel` (see Copy gaps).

### Behaviour worth a reviewer's click
- **Queue.** Five link tabs with counts (`aria-current`, wrap on a phone, 44 px), the `Charged to` / `Submitted from` / `Submitted to` bar with the dates hint and the 2,000-request hint only when truncated, a selected group the list lacks stays selected as `This group`, per-tab empty sentences and the filtered one, `Export CSV` (the queue's dates, plus `status` only on the Waiting for payment and Paid tabs, never the group: the export route has none), the no-pay-holder banner, Settings and Treasury team links for a manage holder only. Everything is built from the parsed query (X7); a page past the last redirects to page 1 (X6, pinned in a page test and an e2e).
- **Request page.** Payment area decided from the detail before the form renders: approver block, requester-side block (only when another payer exists; the sole holder gets the form and the page shows the self-paid line afterwards), receipt block, not-waiting, already-paid. Verbs offered by `treasuryUi`; the definers still decide on every click. Send back has no radio and two bodies. Override: refusals stay inside the dialog; `needs_second_payer` for a manager appends the sentence, a real space, then the link to the team page (X3). History shows who did what (treasury only); notes show with the writer's name.
- **Settings.** Switches (disabled until hydrated, put back with the action's sentence on refusal, no success toast), approver notes, categories (Add, Rename dialog, Retire in one tap).
- **Team.** Holders by name, End in an AlertDialog, set-up buttons with the clerk's description, give-a-role form, last-manager refusal in Copy's words.
- **Closed:** the treasury-only redirect from the member route now lands on a real page (e2e).

### Copy
No Copy-section string was changed. Added from rulings: `COPY.form.noChargeableGroup` (orchestrator). **Gaps (rule: stop and report; used the closest existing string or the giving page's own, each marked in `copy.ts`):**
1. **Team page chrome**, `COPY.team.panel`. REUSED verbatim from the giving team page: `since`, `(group)`, `End this role`, `End {who}'s {role} role?`, `Keep the role`, `End role`, `{who} no longer has this role.`, `Setting up…`, `Role set up.`, `Role set up, without {keys} (you don't hold it yourself).`, `Give a role`, `Role`, `Person`, `Choose a role`, `Choose a person`, `Give role`, `Role given.`, `Nobody has a current membership here yet.`, and the "managed under Roles" note (as already amended by C12). ADAPTED (need a ruling): the end-dialog body (giving's says "the giving permissions above"; this page lists no keys, so: `They will lose this role's permissions right away. Anything they have already recorded stays. You can give the role again later.`), the plural set-up intro (`so they can't be given to anyone`, giving's plural says "so it can't"), and `There is no role to hand out yet. Set one up above, then come back.`
2. **No key badges** on the team list (Copy has no short label per reimbursement key); the role name only.
3. **Queue date column header / table.** Copy has no column headers (`Status`, a date header), so the queue is cards at every width (spread into columns from `md`) instead of "a table above": deviation U6 below.
4. **Back link** on the treasurer pages reuses `Back to reimbursements` (C5) pointing at the queue.
5. Shared-component strings reused: `Try again`, the pager's `Previous` / `Next` / `Page {n} of {m}`.
6. **Retire has no confirmation** (none in Copy); the same name can be added again and retired categories stay on old requests.

### Deviations from the Phase 3 text
- **U5** `treasury-dialogs.tsx` became `reason-dialog.tsx`, `override-dialog.tsx`, `treasury-verbs.tsx` and `payment-form.tsx` (one component per file).
- **U6** Cards at every width, not a table from `md` (gap 3).
- **U7** Two hydration specs by Batch 6 (Record payment, Add a category, Give a role). The design names only `reimbursement-form`; these are the Batch 6 `useForm` roots. The dialogs' forms mount after hydration and are pinned by unit tests and `check:hydration-gate`.
- **U8** `e2e/reimbursement-treasurer-ui.spec.ts` is the treasurer-UI slice (like Batch 5's member slice). Batch 7's four specs (MFA deep link through `/signin` and `/totp`, role bundle, CSV bytes, Features toggle) are untouched. Requests are seeded by calling the definers in one `DO` block, not hand-written rows.
- **U9** The C12 designation edits (dialog and `treasurerLine`) were done here because the design assigned them to Batch 6; they were not in the brief's list.

### Tests and gates
- `npm run typecheck`, `npm run lint` (`--max-warnings=0`), `npm run check` (eight tripwires, `check:secrets` re-run after the commit), `npm run build` (with the https `NEXT_PUBLIC_*` pair) all exit 0; the five treasurer routes are in the route table.
- `npm run test`: 632 files passed (625 before), 9,601 tests passed (9,478), 2,774 skipped (DB-gated), 0 failed. +123 tests.
- E2E on my own dev server :3590 (cleared `.next/dev`, started by hand, stopped by PID): `reimbursement-member` 18/18 and `hydration/reimbursement-form` 1/1 (after the shared-parts refactor and the form edit), `reimbursement-treasurer-ui` 14/14, `hydration/reimbursement-treasurer-forms` 2/2. Production lane :3591 (`PW_PROD_BUILD=1 PW_PROD_PORT=3591`): `reimbursement-form` and both treasurer hydration tests, 3/3.
- Negative controls (restored, files byte-identical): `<HydrationGate>` removed from `payment-form.tsx` fails the unit test, `check:hydration-gate` and the e2e hydration spec; removing the leading space before the X3 link fails its unit test. Not red-first: the new pure modules and tests were written together (no pre-existing code to fail against), so I claim mutation checks, not a red run.

### Walk (real Chromium, 2026-10-26; screenshots in gitignored `test-results/reimbursement-treasurer-360/` and `-1280/`)
360 x 740 with the MFA-enrolled treasurer: queue (Waiting for payment, Needs treasurer approval, All with a 400-character unbroken purpose and a 74-character vendor), request page no-receipt / payment form / paid / approver-cannot-pay / long values, dialogs (waive, reverse, send back, override refusal, team end), settings, categories, team, and the member form with no chargeable group; `scrollWidth <= innerWidth` asserted on each, tab buttons and verb buttons at least 44 px tall and inside 360 px. 1280 x 900: queue (all, override), paid request, long-value request, settings, team, no sideways scroll. I read the queue and no-receipt screenshots. Not done: a real phone (iOS Safari), a screen-reader pass, and the Chrome Next dev badge overlaps the page's lower-left corner only in dev.

### Loop-back candidates and notes
1. Rulings wanted on the Copy gaps above, chiefly the adapted end-dialog body.
2. Batch 7: lift the inline seeding (`DO`-block definer calls, the throwaway payer user) into `e2e/support/reimbursement-fixture.ts`; the MFA deep link, role-bundle, CSV bytes and toggle specs are still open.
3. `Export CSV` ignores the group filter (the route has none); the filter bar's group therefore narrows the list but not the file. Say so in the release note or add a group filter to the export.
4. The settings switch keeps a local override after a successful flip until a reload (the server data arrives with `router.refresh`); harmless, noted.
5. Receipt upload (Batch 2b) will fill `receipt-slot.tsx`; the treasurer page needs no change.

---

# Phase 5 — Verification (qa)

*(QA returns text; the orchestrator records it. Include the Feature-Gate Audit across both route trees, the Copy Truthfulness checks against the Copy section above, the MFA-enrolled e2e, and the 360 px walk.)*

---

# Phase 6 — Shipped vs Intent (analyst)

*(Manual walk at 360 px on `development` as the platform-designated treasurer, an accepted-invitation member, and a chair from the email link including an MFA-enrolled case. Not a seeded fixture.)*

## Orchestrator rulings and actions (2026-10-25, after Phase 3)

- **Numbers:** F3a / F3b / F3c = **F321 / F322 / F323**. Treasury **Inc 2 migration = 0076** (the void 0074 pre-assignment is released).
- **P3-2 / F322 accepted:** `reimbursement.request_for_others` is bound to the `treasurer` template, plus a `reimbursement_clerk` template carrying only that key (otherwise un-grantable under the subset rule). Reported to the operator.
- **P3-1 / F321 accepted:** emailed links are bare paths `/o/<slug>/reimbursements/<id>` (query strings are dropped for signed-out visitors).
- **Operator defaults stand** (reported): one category list per organization; pre-approver optional free text; max amount $100,000; expense-date window one year; reminders deferred.
- **Production counts (read-only):** designation-minted treasurer copies **1**; live baseline `member` grants **1**; congregations 1. Blob referrers: 0 tickets, 0 statements, 0 photos (F289 counts).
- **Fixture prefixes `e2e96000-…` / `e2e96001-…` confirmed.**
- **Sequencing:** Batch 1a may start; 1b (receipt FK verification) waits for F289's 0072 file; Batch 2b waits for F289 to merge. F289's source-scan table gains treasury's two `receipts.ts` call sites (`store`/`resolve`, literal `private`) — relayed to the F289 pipeline.
- **Worktree setup** (Neon branch, `.env.local` with `NEXT_PUBLIC_APP_URL=http://localhost:3590`) is done at Phase 4 kickoff.

## Orchestrator rulings on Phase 4 Batch 1a (2026-10-26)

1. **`src/lib/giving/team.db.test.ts` (2 of 24 fail after 0074):** the refusal is correct — taking the treasurer template now needs all seven keys, and "you can only hand out keys you hold" must not be weakened. The design's "must pass unchanged" is amended: Batch 2a updates the two cases' fixture so the acting user holds the full treasurer key set (or asserts the refusal where that is the intent), with a one-line note citing this ruling. No change to the rule.
2. **D2 (approvers and payment-role holders need an active login):** confirmed.
3. **D8 (0074's closing check ignores custom roles):** confirmed; the check covers the platform templates and designation-minted treasurer roles only, so it stays re-runnable after a treasurer edits their team.
4. **Date filter:** the treasurer list and CSV filter on the org-local date the request was submitted — accepted; Copy must say "submitted".
5. **Detail shape:** `presby_reimbursement_detail`'s fields are frozen as built; Batch 2a pins them.
6. **Environmental:** the five `test:db` failures expecting `localhost:3000` are caused by the worktree's `NEXT_PUBLIC_APP_URL` port (seen in F289 too); not a treasury defect. Tracked as a test-environment TODO at integration.

---

## Phase 3 — amendment (Copy gaps from Batch 2a)

**Date:** 2026-10-26 · **Author:** tech-lead · **Class:** Copy amendment inside the Treasury Inc 1 Feature plus one residual ruling; no schema, route, permission, flag or audit change · **Inputs:** Batch 2a's "Copy gaps" 1 to 3 and loop-back note 2 (this log), the live tree at `0f35f10` on `pipeline/treasury` (`src/lib/org-portal/tiles.ts`, `src/lib/reimbursement/{copy,gate,messages,pickers}.ts`, `src/app/(org)/o/[slug]/reimbursements/actions.ts`, `src/lib/giving/action-gate.ts`, `src/lib/treasury/team.ts`, `drizzle/0059` and `0060`). Nothing outside this work-log was edited. The Copy section's rule stands: an implementer who needs a string not in it stops for a ruling; this amendment is those rulings.

### Rulings at a glance

| # | Gap | Ruling |
|---|---|---|
| 1a | Member tile description | **Stands** as the implementer proposed |
| 1b | Treasurer tile description | **Changes**: it names its audience, because every member sees the tile |
| 2 | Gate boilerplate reused from giving | **Stands**; the five strings are now ruled Copy |
| 3a | Withdraw success | New: `Request withdrawn.` |
| 3b | Beneficiary search | No success string. Behaviour below 2 characters, the screen-reader count, the failure sentence and the chosen-person control are ruled |
| 3c | Withdraw reason | **No field in Increment 1**; no string; the action's optional `reason` stays and the UI never sends it |
| 3d | `invalid_shape` / `kind_invalid` | **Stands** (the save-failed sentence), with one UI condition |
| 4 | Orphaned manage key (loop-back note 2) | **Accepted as documented residual 12**; no stricter rule; no new sentence |

### What changes in code (small; batch owners named)

1. **Batch 3 (api-developer), `src/lib/org-portal/tiles.ts`:** replace the `reimbursements-admin` description with the string below; delete the `COPY GAP` comment block (`:431-433`); in `tiles.test.ts` add an exact-text assertion for both reimbursement descriptions (byte-pinned, as `copy.test.ts` pins the rest).
2. **Batch 3 (api-developer), `src/lib/reimbursement/copy.ts`:** add `decision.withdrawn`, `form.searchFound(n)`, `form.searchFailed`, `form.changeBeneficiary` and `form.changeBeneficiaryLabel` with the strings below, pinned in `copy.test.ts`. Batch 5 imports them and types none of them.
3. **Batch 4 (api-developer), `treasury/team.db.test.ts`:** one characterization case for residual 12 (below). No change to `team.ts`.
4. **Batch 5 (ux-developer):** the withdraw dialog has no reason field and calls `withdrawRequestAction(slug, { requestId })`; the request form keeps every entry when a save returns `ok: false` (pinned by a `request-form` test).

### The strings, exact, with the four checks (one paragraph per group)

**Group T1: the two portal tile descriptions (gap 1).**

| Tile | Label (Copy C2/C7 headings) | Description |
|---|---|---|
| `reimbursements` (`operate`) | Reimbursements | Ask to be paid back for something you bought for the church, or to pay a vendor. |
| `reimbursements-admin` (`administer`) | Reimbursement requests | For the people who handle reimbursements. See every request, record payments, and choose which groups can receive requests. |

**R.** Neither string says money is sent ("Ask to be paid back" is a request; C1 says the feature "doesn't send money") or that anyone may file (residual 4: an organization cannot narrow who may file). **S.** Neither asserts a state of a person, account, date or request; each describes its destination page (C2's lead, and the C7 queue plus C9 settings). **A.** Tiles are permission-blind (DECISION-162, `docs/decisions.md:340`: "Everyone who can see the portal sees Administration when it is shown"; `visible-tiles.ts` reads no permission), so the audience of both strings is every member of a congregation with the toggle on, including regular attenders who may not file and members who hold no treasury key. The member string mirrors C2's lead, which is also shown to everyone, and the page itself explains `cannotFile`. The treasurer string as proposed ("See every request, record payments...") promised a member what C7's forbidden page then denies; the ruled string says who the page is for, in C7's own phrase ("the people who handle reimbursements"), and promises nothing to the viewer. **N.** Grepped `src` for "paid back", "pay you back" and "reimburs": the only live strings outside the module are `tiles.ts`, `org-features.ts` (C1) and `org-feature-warnings.ts` (C1); none is stale. The `giving-admin` tile (`tiles.ts:414`, "Connect Stripe, record gifts, manage funds and donors, and issue year-end statements.") has the same permission-blind shape; out of scope, left unchanged.

**Group T2: the gate boilerplate (gap 2).** Ruled as Copy, `COPY.gate` (`copy.ts:422-428`):

| Key | String | Returned when |
|---|---|---|
| `signedOut` | You must be signed in to do that. | no session (`gate.ts:195`) |
| `noOrgAccess` | You don't have access to that organization. | `resolveOrgContext` is not `ok`, or `OrgAccessError` (`gate.ts:210`, `:221`, route `:305`, `:315`) |
| `notPermitted` | You don't have permission to do that. | no key held (`gate.ts:234`), or the definer's `denied` (`actions.ts:68`, `:91`, `:124`) |
| `accessCheckFailed` | We couldn't check your access just now. Try again in a moment. | any other error reading the gate (`gate.ts:222`, route 503) |
| `twoFactorRequired` | Please confirm your two-factor code to continue. | stale or missing 2FA claim (C4, already ruled) |

The toggle-off and not-applicable refusals in actions already reuse C2's `Reimbursements aren't turned on for {org}.` and `Reimbursements aren't available for this kind of organization.` (`gate.ts:226-229`); those are in Copy and stand.

**R.** Nothing here denies a residual or a Phase 2 ruling. **S.** Each string is returned for exactly the check beside it; `accessCheckFailed` is a read failure and a database blip is never reported as "not allowed" (the gate's own contract). `notPermitted` after a `denied` is true: the database refused the caller's identity (no live person here, or `may_file` false). `noOrgAccess` is one string for a missing slug, a forbidden organization and an ended membership, so an action cannot reveal which slugs are tenants (DECISION-040); the pages that name and date an ended membership are a different surface. **A.** Read by the member whose session lapsed, whose membership ended or who may not file; none instructs anything they cannot do; "Try again in a moment" appears only on the read failure. **N.** The same literals are the house gate strings in more than thirty `actions.ts` files (for example `giving/action-gate.ts:82-123`, `tickets/actions.ts:62-67`, `admin/features/actions.ts:29-34`); `copy.test.ts` asserts each appears in giving's file, so a rewording there fails this test and forces a deliberate choice. None is made stale.

**Group T3: withdraw, beneficiary search, the chosen person, shape failures (gap 3).**

| Where | String |
|---|---|
| Withdraw succeeded (toast; the dialog closes) `COPY.decision.withdrawn` | Request withdrawn. |
| Beneficiary search, fewer than 2 characters after cleaning | Nothing is shown and no request is made (the server already returns an empty list, `pickers.ts:43`). `No match.` is **never** shown for a query too short to search |
| Search ran, nothing came back (C3, unchanged) | No match. (with the standing hint "Only people who appear in the directory can be chosen."); `role="status"` |
| Search returned people | the list (at most 8), and a visually hidden polite status `COPY.form.searchFound(n)`: `1 person found.` / `{n} people found.` |
| Search failed: a gate refusal | the action's own `error` text (T2), shown under the box |
| Search failed: the call threw or the network dropped `COPY.form.searchFailed` | We couldn't search just now. Try again. |
| After a person is picked: the name replaces the search box, with a button `COPY.form.changeBeneficiary` (accessible name `COPY.form.changeBeneficiaryLabel`) | Change (accessible name: Change who we are paying back) |
| Withdraw reason | No field, no label, no string. The UI sends no `reason`; the action keeps accepting an optional one up to 300 characters, and its `reason_too_long` refusal is unreachable from the UI |
| `invalid_shape`, `kind_invalid` (save refusals, `messages.ts:32-33`) | We couldn't save that. Your entries are still here. Try again. (C3, unchanged) |

**R.** "Request withdrawn." claims a status only and does not say "deleted" (nothing is deleted, EC34; C5's banner and history say the same); "No match." with its hint states residual 6 (a hidden member cannot be named). Nothing claims the search is exhaustive or private. **S.** Withdrawn: the toast follows `{ ok: true }` from the withdraw definer (status moved to `withdrawn`, event written, same transaction); an already-withdrawn or already-moved request is `not_withdrawable` and answers the neutral "This request isn't available.", never the success toast (`actions.ts:125-130`, at `0f35f10`), so the toast is never shown for a no-op. "No match." is shown only for a search that ran (length at least `BENEFICIARY_QUERY_MIN`); an empty list also results from a caller without `request_for_others` or the directory view, but such a caller never sees the box (C3 shows "Pay someone else back" only to holders), and the hint explains the rest. The count is `candidates.length`. "Your entries are still here" is a UI guarantee, not a database fact: the request form must not reset on `ok: false`, pinned in Batch 5's `request-form` test. `invalid_shape` and `kind_invalid` arise only from a tampered post or a disagreement between the TypeScript schema and the definer (a defect); the sentence claims only that the save failed and that entries were kept, and "Try again" may not help in the defect case, which is accepted. **A.** The requester or beneficiary (withdraw), the member holding `request_for_others` (search, picked person). Every instruction (try again, retype, change) is within their power; "Let the church office know" is not used here. **N.** Toast precedent, deliberately plainer: `admin/filings/withdraw-dialog.tsx:74` ("{year} filing withdrawn.") and `admin/community/pending/decision-copy.ts:94` ("Proposal withdrawn. {name} is no longer waiting for the Session."); C6's other results are bare ("Approved.", "Sent back."), so no name or amount goes in a toast. C3's `We couldn't save that...` is for saving only and is not reused for search. No existing string is made stale.

### Ruling 4: the orphaned manage key (residual 12; operator confirmation requested)

**The case, restated.** `revokeTreasuryRole` blocks ending the last holder of **its own surface's** manage key (EC31, `team.ts:401-426`). A seven-key `treasurer` grant carries both modules' manage keys. If another role keeps one module's manage key (for example a custom role that holds `giving.manage`), ending the sole `treasurer` grant on that module's team page is allowed, and the other module's manage key (`reimbursement.manage`) is left with no holder; the reverse holds on the Reimbursements page. Nobody remaining can open that module's settings or team page.

**Ruling: accept as a documented residual, `paper`, and add no stricter rule.** Reasons:

1. **The stricter rule fails the audience check.** To block the case, the Giving page would have to say `That would leave no one able to manage reimbursements. Give the role to someone else first.` (C9's existing sentence, so no new Copy would be needed; the implementer's "one new sentence" is half right, because both modules' sentences already exist: the reverse is `That would leave no one able to manage giving. Give the role to someone else first.`, `giving/team/actions.ts:101`). But the person ending the grant is a `giving.manage` holder who, in exactly this case, does not hold the seven keys, so the subset rule (you can only hand out keys you hold) means they cannot follow the instruction. A sentence that tells the blocked viewer to do what they cannot is a Phase 3 defect.
2. **It fails toward keeping access.** A departed treasurer's money keys would stay live until a platform operator intervened, because the team page could not end them. Permitting the revoke fails toward removing access, which is the safer direction; the loss is configuration reach, which is recoverable.
3. **It couples two modules' guards** for a case that needs a custom role the congregation built on purpose; no member of the treasury team is stranded in the ordinary single-treasurer or two-treasurer setup.

**Residual 12 (added to the Accepted residuals list above):** the orphan state is possible, detectable and recoverable but not prevented. **Detection:** `tenant.role.revoked` is audited with the grant id on both team pages (`giving/team/actions.ts:108`). **Recovery (read, not run):** a platform operator ends the remaining `giving.manage` holders on `/admin/organizations/<id>` (DECISION-194: reason required, audited, never a grant held through a derived group), which empties the treasurer slot (`presby_giving_manage_holder_count` gates `has_holders`, `drizzle/0059:712`, `:1072`; `0060:148-215`), and then re-designates a treasurer, whose acceptance mints a fresh seven-key role (0074). If the remaining holder holds the key through a derived group, the platform path cannot end it and an engineer is needed. The founding administrator cannot repair it (F138). The end-to-end recovery is **unverified** (no test runs it).

**Pinned, so the residual is deliberate rather than accidental:** Batch 4 adds `treasury/team.db.test.ts › ending the sole treasurer grant on one surface leaves the other module's manage key unheld (residual 12)`, asserting the revoke succeeds and the key has zero holders; a future decision to add the stricter rule changes this test on purpose. **Copy guard:** the two last-manager sentences stay scoped to their own module and no release note or help text may say the treasury team can never be left without a manager. C13 line 5 and the rest are unaffected. **Not accepted by the operator yet:** listed as item 9 in "Needs a confirmation". **Rule 10 (orchestrator, shared file):** one line in `docs/TODO.md` at integration ("residual 12: a team-page revoke can orphan the other module's manage key; recover via platform"). **Draft decision (number pre-assigned by the orchestrator at integration):** *Ending a treasury grant is checked against its own module's manage key only; the cross-module orphan is accepted as residual 12 (fail toward removing access; the stricter sentence cannot be followed by the viewer it blocks).*

### Blast radius

Existing assertions this amendment alters: `src/lib/org-portal/tiles.test.ts` (descriptions are non-empty only, `:164-168`; add the exact-text pins); `copy.test.ts` (new keys). Nothing else asserts the old treasurer tile text. Existing e2e specs: none assert either tile description (the four reimbursement specs are Batch 7). Flags each affected spec depends on: the per-org toggle `org_portal.reimbursement` only, which Batch 7's specs set through `e2e/support/flags.ts` or the fixture's `setToggle`; nothing is added to `scripts/ci/e2e-baseline-flags.sql`.

### Carry-forward

| Item | Addressed or deferred |
|---|---|
| Copy gaps 1 to 3 (Batch 2a) | Groups T1 to T3 above; each closed |
| Loop-back note 2 (orphaned manage key) | Ruling 4: accepted as residual 12, **proposed, not yet accepted by the operator** (item 9) |
| Loop-back note 3 (giving team strings still say "outside Giving") | Unchanged: Batch 6 per C12 |
| Loop-back note 4 (`treasurer-designation-section.tsx`, `designation-holder-copy.ts`) | Unchanged: Batch 6 per C12 |
| DECISION-162 (tiles are permission-blind) | T1's treasurer string is written for that audience |
| DECISION-040 (neutral miss) | T2's `noOrgAccess` is one string for every non-ok resolve |
| Residuals 4, 6, 8 and 9 | Not denied by any string here (T1, T3) |
| F138 (founding administrator cannot repair treasury keys) | Stated in residual 12; unchanged |
| Anything deferred | Nothing new, except the operator's confirmation of residual 12 |

---

## Phase 3 — amendment (Copy gaps from Batch 4)

**Date:** 2026-10-26 · **Author:** tech-lead · **Class:** Copy amendment inside the Treasury Inc 1 Feature; no schema, migration, route, permission, flag or audit change · **Inputs:** Batch 4's "Copy gaps" 1 to 7, deviations X1 to X7, the "Known UI gap" (the queue's group filter) and loop-back notes 1 and 2 (this log), Phase 1 Flows 2 to 4 in the parent log (`docs/work-log/2026-10-25-treasury.md:167-186`), and the live tree at `8c8900a` on `pipeline/treasury` (`src/lib/reimbursement/{copy,treasury-messages,treasury-input,messages,reads}.ts`, `src/lib/treasury/team.ts`, `…/admin/reimbursements/{actions,team/actions}.ts`, `drizzle/0073` definers `waive_receipt`, `void`, `record_payment`, `reverse_payment`, `approve`, `return`, `save_category`, `end_category`, `treasurer_list`). Nothing outside this work-log was edited. The Copy section's rule stands: an implementer who needs a string not in it stops for a ruling; this amendment is those rulings. Every string below lives in `src/lib/reimbursement/copy.ts` and is byte-pinned in `copy.test.ts`; the UI batches import them and type none.

### Rulings at a glance

| # | Gap | Ruling | Applied by |
|---|---|---|---|
| 1 | `note_required` (empty treasury note) | New: `Write a note.` | Batch 4 follow-up |
| 2 | `date_out_of_range` (payment dated before the expense, or after today) | **Replaces** C8's `Choose a date that isn't in the future.`: `Choose a date between the day of the expense and today.` | Batch 4 follow-up |
| 3 | Set-up-role `not_treasury_only` | New: `That role already exists with permissions outside Giving and Reimbursements. An administrator can fix it under Roles.` Also fixes C9's grant sentence, which told the viewer to do what they cannot (3b) | Batch 4 follow-up; giving's twin in Batch 6 (C12) |
| 4 | Reuse of giving's five `COPY.team.*` strings | **Confirmed**, with the one exception in ruling 3 | none |
| 5 | The neutral `This request isn't available.` for state refusals | **Changes for the treasurer tree only**: six short sentences, each true for every cause its outcome can have. `not_found` and the whole member tree stay neutral | Batch 4 follow-up |
| 6 | X1 (no notice to an acting creator), X2 (treasurer send-back is always "needs changes") | **Both confirmed** against Phase 1; C10 and C8 are amended to say so; the send-back dialog has no radio and two body strings | Batch 4 follow-up (C10 text); Batch 6 (dialog) |
| 7 | Category that vanished (gap 3), tampered shape (gap 4), settings success text (gap 6) | New: `That category isn't in the list any more. Reload the page to see the current list.`; the other two **stand** (save-failed sentence; no success text) | Batch 4 follow-up; Batch 6 |
| 8 | The queue's "Charged to" filter (Known UI gap) | **Orchestrator ruling recorded**: derived from the groups present in the rows the viewer can already see; no definer, no schema. Feasibility finding: the definer clamps a page to 200 rows, so the derivation pages, bounded at 2,000 rows. Filter strings and empty states ruled | Batch 4 follow-up (the reader and strings); Batch 6 (the controls) |
| 9 | X3 to X7 | **Confirmed**; each gives the UI a condition (below) | Batch 6 |

**Batch 5 (member UI) is not touched by this amendment.** Every string below is on the treasurer, settings or team surface, and the member tree's refusals (`decisionRefusal`, `withdraw`) stay on the neutral answer.

### What changes in code (small; batch owners named)

1. **Batch 4 follow-up (api-developer, one commit, before Batch 6 starts):**
   - `copy.ts`: add `treasury.results.noteRequired`, `treasury.results.dateOutOfRange` (and delete `dateNotFuture`, `copy.ts:366`), `treasury.refusals.{notWaivable, receiptPresent, notVoidable, notReversible, notApprovable, notReturnable}`, `treasury.sendBack.{title, body, bodyApproved}`, `settings.categoryGone`, `team.ensureNotTreasuryOnly`, replace `team.notTreasuryOnly` (`copy.ts:407`) with the ruling 3 sentence, and replace `queue.nothingWaiting` (`copy.ts:291`) with `queue.empty.{pay, override, progress, paid, all, filtered}`, plus `queue.filter.{groupAll, groupSelected, submittedFrom, submittedTo, datesHint, apply, clear, groupsTruncated}`. Pin each in `copy.test.ts` (the member page's own `page.nothingWaiting`, `copy.ts:46`, is untouched).
   - `treasury-input.ts:58-59` (the `paidOn` schema uses the date sentence for an empty or impossible date too: the new sentence is true for those) and `:100` (`addNoteSchema.note` uses `COPY.form.saveFailed` for an empty note: becomes `noteRequired`).
   - `treasury-messages.ts`: `date_out_of_range` to `dateOutOfRange` (`:50`); `note_required` to `noteRequired` (`:93`); `waiveRefusal` and `reasonVerbRefusal` and `overrideRefusal` map the five state outcomes to `treasury.refusals.*` (their `not_found` stays neutral); a new `treasuryReturnRefusal(outcome)` maps `not_returnable` to the treasurer sentence and delegates every other outcome to `decisionRefusal`; `treasuryReturnAction` calls it (`admin/reimbursements/actions.ts`, where it now calls `decisionRefusal`); `categoryRefusal`'s `not_found` to `settings.categoryGone` (`:151`). The member tree's `messages.ts` is not edited.
   - `team/actions.ts:150` (the ensure action) returns `COPY.team.ensureNotTreasuryOnly`; `:71` (grant) keeps `COPY.team.notTreasuryOnly`, now the ruling 3 grant sentence.
   - `reads.ts`: `listTreasurerGroups(identity)` (ruling 8), with a DB test.
   - Tests altered (the blast radius): `treasury-messages.test.ts:52-53, 60, 66, 95, 105` (the EC16 "ONE neutral answer" cases become "`not_found` is neutral, each state outcome is its sentence"), `treasury-input.test.ts:42-43, 93`, `admin/reimbursements/actions.test.ts:186-194, 224, 273` (assert text, not only `kind`), `team/actions.test.ts:88, 156`, `copy.test.ts:336` and new pins. `payments.db.test.ts` asserts outcomes, not text, and is unchanged.
2. **Batch 6 (ux-developer):** the treasurer queue, detail, dialogs, settings and team pages consume the strings; the send-back dialog, the filter bar, the empty states, the X3 link and the X6 clamp (below); `giving/team/actions.ts:54` and `:142`, `team-list.tsx:107` and `giving/team/actions.test.ts:140` take the C12 edit with ruling 3's grant wording (`…outside Giving and Reimbursements. An administrator can grant it from Roles.`), so the two team pages say the same sentence.
3. **Batch 5:** nothing.

### The strings, exact, with the four checks (one paragraph per group)

**Group S1: the two form-field errors (gaps 1 and 2).**

| Where | String |
|---|---|
| Add a note, empty or whitespace only (field error beside `Note`; also the zod message) `COPY.treasury.results.noteRequired` | Write a note. |
| Record payment, `Date paid` empty, impossible, after today, or before the expense date (field error beside `Date paid`) `COPY.treasury.results.dateOutOfRange` | Choose a date between the day of the expense and today. |

**R.** Neither denies a residual or a Phase 2 ruling; the date sentence does not claim anything about when money moved, only which dates the record accepts. **S.** The note sentence is shown for `note_required` (the definer cleans the text and finds nothing, `presby_reimbursement__clean_text`) and for the same check in `addNoteSchema` before the library is called. The date sentence is shown for `date_out_of_range`, whose predicate is exactly `paid_on > presby_reimbursement__local_date(org, now()) or paid_on < expense_date` (`drizzle/0073:884`, `:2161`), so "between the day of the expense and today" is inclusive at both ends, and "today" is the organization's calendar day, not the viewer's browser's. The edge where a payer in another time zone sits across midnight from the organization is unverified. A blank or impossible date reaches the same sentence through the schema; the sentence is still an instruction that fixes it. **A.** Both are read by a `pay` holder (date) or a `view` holder (note), each of whom can edit the field. **N.** Neighbours grepped (`src`, `Choose a date`, `in the future`, `Write a note`, `note`): the live ones are `copy.ts:366` (`dateNotFuture`, the string this replaces), `treasury-input.ts:58-59`, `treasury-messages.ts:50`, `treasury-input.test.ts:42-43` (modify targets above), `copy.ts:102` (`fieldErrors.date`, the member expense date: "Choose a date that isn't in the future or more than a year ago.", a different field and still true), and `giving/gifts/actions.ts:59`, giving's own, not touched. The hint under `Note` (`Only the treasury team can see notes.`) stays true.

**Group S2: team actions (gaps 4 and 5).**

| Where | String |
|---|---|
| Set up the Treasurer or Reimbursement Clerk role, and the org's role of that key carries a key outside Giving and Reimbursements `COPY.team.ensureNotTreasuryOnly` | That role already exists with permissions outside Giving and Reimbursements. An administrator can fix it under Roles. |
| Grant a role that carries a key outside Giving and Reimbursements (C9, **amended**) `COPY.team.notTreasuryOnly` | That role includes permissions outside Giving and Reimbursements. An administrator can grant it from Roles. |
| The other five `COPY.team.*` reuses (`invalidRole`, `assignmentEnded`, `endFromRoles`, `templateUnavailable`, `ensureEscalation`) | Unchanged, as Batch 4 reused them |

**R.** Residual 12 and F138 are not denied: the strings say who can repair a role, and the founding administrator can (they hold `roles.manage`). **S.** Ensure's sentence is shown only for `not_treasury_only` from `ensureTreasuryRole`, which `team.ts:90` returns when the org's role of that key has at least one permission key and not all of them are in the treasury modules; "already exists" is true because the function found the role. Grant's sentence is shown for the same predicate on the chosen role (`team.ts:316`). **A.** The viewer holds `reimbursement.manage` (the default Treasurer). A Treasurer does not hold `roles.manage` or `role_grants.manage` and, by the subset rule, cannot hand out keys they lack, so C9's original "Grant it from Roles instead" told the viewer to do something they cannot (the finding behind the amendment). The Church Administrator role carries `roles.manage` (`drizzle/0032`, the founding-administrator set at `drizzle/0059:541`), so "An administrator can ..." names someone who can. This is the audience rule applied to C9, a Phase 3 string, and it is a Phase 3 defect fixed here rather than carried. **N.** `giving/team/actions.ts:54` ("...outside Giving. Grant it from Roles instead.") has the same defect and is amended in Batch 6 with C12; `giving/team/actions.ts:142` already has the ensure shape and gains only "and Reimbursements". `endFromRoles` ("That assignment can only be ended from Roles.") is a statement of where, not an instruction, so it stands.

**Group S3: state refusals in the treasurer tree (gap 7 of Batch 4, "does a treasurer deserve a more specific sentence").** Yes, in one sentence each, and only where the sentence is true for every cause the outcome has.

| Outcome (tree) | `COPY.treasury.refusals.*` | String |
|---|---|---|
| `not_waivable` (waive) | `notWaivable` | A receipt can't be waived on this request. Reload the page to see where it stands. |
| `receipt_present` (waive) | `receiptPresent` | This request already has a receipt, so there is nothing to waive. |
| `not_voidable` (void) | `notVoidable` | This request can't be voided. Reload the page to see where it stands. |
| `not_reversible` (reverse) | `notReversible` | This request has no payment that can be reversed. Reload the page to see where it stands. |
| `not_approvable` (approve as treasurer) | `notApprovable` | You can't approve this request as treasurer. Reload the page to see where it stands. |
| `not_returnable` (send back, treasurer tree) | `notReturnable` | You can't send this request back. Reload the page to see where it stands. |
| `not_found`, and every member-tree refusal | `COPY.detail.unavailable` | This request isn't available. (unchanged) |

**R.** None denies a residual; "can't ... on this request" names no cause, so it neither confirms nor denies the separation-of-duties checks (residuals 3 and 8). **S.** Each sentence is chosen by the definer's outcome and by nothing else. The causes were read in `drizzle/0073`: `not_waivable` is a status outside submitted and approved, or already waived, or the viewer created or is paid by the request (`:2088`); `not_voidable` is a status outside submitted, returned and approved (`:2043`); `not_reversible` is a status other than paid or no live payment (`:2233`); `not_approvable` on the treasurer's path is a status other than submitted, or the viewer created or is paid by it (`:1886`, `:1904`); `not_returnable` is a status outside submitted and approved, the viewer created or is paid by it, or a seat holder exists for a submitted request (`:1980-2002`). Because some outcomes mix a state cause with a conflict-of-interest cause, the sentences say "can't" and do not name a cause; this is why `not_waivable` is not worded "already waived". **A.** The viewer holds `pay`, who can reload; the pages hide a verb the request cannot take, so these appear from a stale tab, and "Reload the page" is something the viewer can do. When the cause is the viewer's own conflict, reloading shows no button, which completes the explanation without naming it. **Why this does not reopen EC16.** EC16 is "a missing request id and a forbidden one give the same response". `not_found` is still neutral and so is every member-tree refusal. A `pay` holder without `view` already learns a request's state from C8's pre-form blocks (`This request isn't waiting for payment.`, `This payment was already recorded.`), so the new sentences add no state a `pay` holder could not already read; recorded as a residual below. **N.** Neighbours: `treasury-messages.ts:11-19` (the header comment that defends the one-neutral-answer reading, modified), `messages.ts:120-127` (the member tree's twin, **unchanged**, and `decisionRefusal` keeps its comment), `treasury-messages.test.ts:52-53, 60, 95`.

**Residual 13 (added to the Accepted residuals list):** a `pay` holder who holds no `view` can learn, by posting a request id, that the id exists and is in a state the verb refuses (it already could through `record_payment`'s blocks). `paper`; the identity of the request, its amount and its people are not disclosed.

**Group S4: the treasurer's send back (X2) and the dialog (C8 "as C6 with kind fixed").**

| Where | String |
|---|---|
| Dialog title `COPY.treasury.sendBack.title` | Send this request back? |
| Body, request is submitted `…sendBack.body` | The requester can fix it and send it again. |
| Body, request is approved `…sendBack.bodyApproved` | The requester can fix it and send it again. It will need approval again. |
| Field | Reason (the requester will see this) |
| Buttons; result | Send back / Cancel; Sent back. |

There is no radio; "Needs changes" and "Not approved" do not appear, because the treasurer path is fixed to needs changes. **R.** The approved body states what Phase 1 Flow 3 says ("Return to requester. This clears the approval, and a fresh approval is required"). **S.** The body is chosen from the detail's `status` (`approved` or `submitted`) which is the status the definer acts on; a revision change is caught by `changed_since_viewed`. "send it again" is true because a `returned` request is editable and resubmittable by its creator. **A.** A `pay` holder. **N.** Reuses the C6 radio's own description (`The requester can fix it and send it again.`); no other string says the treasurer can also mark a request "not approved", and none may (X2).

**Group S5: the vanished category (gap 3), the tampered shape (gap 4), the settings success text (gap 6).**

| Where | String |
|---|---|
| Rename or retire a category that is gone or already retired (shown beside the row) `COPY.settings.categoryGone` | That category isn't in the list any more. Reload the page to see the current list. |
| Tampered shape (`method_invalid`, a bad group or category id, a bad number) | We couldn't save that. Your entries are still here. Try again. (stands, `COPY.form.saveFailed`) |
| Settings success | No toast text. The three settings actions return data, and the page shows the change in place; a toggle that fails shows `COPY.form.saveFailed` |

**R.** None. **S.** `not_found` from `save_category` is an id that is not a live category of this organization (`:2487`); from `end_category` it is the same (`found` is false when nothing changed, `:2530`), which includes a category already retired, so "isn't in the list any more" is true for each. **A.** A `manage` holder, who can reload. **N.** The save-failed sentence in this position (`treasury-messages.ts:151`) told the viewer to try again, which cannot work for a category that does not exist: the reason for the new sentence. `categoryNameTaken` and `categoryNameInvalid` stand.

**Group S6: X1 (no notice to an acting creator) and X2, confirmed against Phase 1.**

**X1: confirmed, narrowing C10.** Phase 1 Flow 3 says "the requester is told 'Paid'"; the purpose of the notice is to tell someone who is not at the screen. A creator who is also the person who just recorded the payment or voided the request (a sole pay holder, or a treasurer who entered a request for themselves) is at the screen and sees `Payment recorded.` or `Request voided.` plus, for payment, the `selfPaid` record. A second email about one's own click carries no information and costs a send. The cases that remain notified are the real ones: a creator who is not the actor, and a clerk who entered a request on behalf of a member (the creator is the clerk, not the beneficiary, as C10 already says). **Amendment to C10 (the `requester_update` row):** recipients read *the creator, unless the creator is the person acting*. It is `tested` (`payments.db.test.ts`) and costs no Copy. **Audience:** nobody sees a new string. **Neighbour:** `notices.ts` and `decisions.ts` need no edit (an approver cannot be the creator, and a treasurer cannot send back or override-approve their own request, D5).

**X2: confirmed.** Phase 1 Flow 3 names one treasurer return: "Wrong amount seen on the receipt: Return to requester. This clears the approval, and a fresh approval is required" (`docs/work-log/2026-10-25-treasury.md:183`), and the actor table says "return an approved request" (`:146`). Neither names a treasurer "not approved". The definer already forbids `not_approved` from `approved` (`kind_invalid`, `drizzle/0073:~2000`), so fixing the kind to needs changes also makes the form unable to produce a refusal. A treasurer who wants a request to end uses Void, which is its own verb with its own notice (`…was closed`). No Copy change beyond group S4.

**Group S7: the queue's filter and empty states (the Known UI gap; Batch 6 would have had to stop here).**

| Where | String |
|---|---|
| Group select label `COPY.queue.chargedTo` (exists) | Charged to |
| First option `queue.filter.groupAll` | All groups |
| The selected group when it is not among the listed groups and no row names it `queue.filter.groupSelected` | This group |
| Date fields `queue.filter.submittedFrom`, `submittedTo` | Submitted from · Submitted to |
| Hint under the date fields `queue.filter.datesHint` | Dates are the day each request was last submitted. |
| Buttons `queue.filter.apply`, `queue.filter.clear` | Filter · Clear |
| Hint under the group select, only when the list is cut off `queue.filter.groupsTruncated` | Only groups with one of the 2,000 most recent requests are listed. |
| Empty, by tab and with no filter set `queue.empty.*` | Waiting for payment: Nothing is waiting for payment. · Needs treasurer approval: Nothing needs a treasurer's approval. · In progress: Nothing is in progress. · Paid: Nothing has been paid yet. · All: No one has sent in a request yet. |
| Empty, any of group, from or to set `queue.empty.filtered` | No requests match those filters. |

**The derivation (orchestrator ruling, 2026-10-26; recorded as given).** The "Charged to" options are the distinct groups present in the rows the viewer can already see. No new definer, no schema change. **Feasibility finding against the live tree:** `presby_reimbursement_treasurer_list` clamps a page to 200 rows (`drizzle/0073:~2718`, `limit least(greatest(coalesce(p_limit, 50), 1), 200)`) and orders `all` newest first (the `pay` and `override`/`progress` order terms are null for `all`). A one-call derivation would therefore omit every group whose only requests are older than the 200th. The ruled shape is a pure-TypeScript reader, `listTreasurerGroups(identity)` in `reads.ts`: it calls the existing `treasurer_list(user, 'all', null, null, null, 200, offset)` from offset 0 by 200 until it has read `total_count` rows or 10 pages (2,000 rows), returns the distinct `{ id, name }` sorted by name, and `truncated: true` if `total_count` exceeded 2,000. It runs on the same `view` gate as the queue; a `denied` result is the queue's `denied`. A typical congregation is one call; an organization with more than 2,000 non-draft requests gets the `groupsTruncated` hint, not a wrong list. **Tradeoff, said out loud:** fine now because Increment 1 has no history import and a congregation files tens to low hundreds of requests a year; revisit with a distinct-groups definer (a Batch 1 schema change) if any organization exceeds 2,000, or if the queue page's latency shows the extra calls. The names are the groups' current names (the join in the definer), so a renamed group shows its new name.

**R.** "Submitted" and the datesHint state accepted ruling 4 of 2026-10-26 (the filter is on the org-local date last submitted), and the CSV uses the same dates, so the hint is true of the export too. The truncation hint states the limit rather than hiding it. **S.** *All groups*, the group list and `groupsTruncated` read the rows from `treasurer_list`; `groupSelected` is shown only for a `groupId` in the URL that the derived list does not contain and that no returned row names, so it claims nothing about the group; the dates hint is `coalesce(submitted_at, created_at)` converted to the org-local date (the definer), and a request that was sent back and sent again is filtered on its latest submission. An empty tab sentence is chosen by the tab and by whether any filter is set; "No one has sent in a request yet" is true because the `all` tab is every non-draft request (a draft is not "sent in", and the treasurer cannot see drafts). **A.** `view` holders; none of the strings instructs. **N.** `queue.nothingWaiting` ("Nothing is waiting.", `copy.ts:291`) is stale on Paid and All and under any filter (it is wrong to say nothing is "waiting" in a list of paid requests), so it is replaced; the member page's `page.nothingWaiting` (`copy.ts:46`) is about the member's own waiting list and stands. The card's `Sent {date}` (`copy.ts:289`) is the same date as the filter; the filter says "Submitted" because accepted ruling 4 says so, and the hint ties the two words together.

### Confirmed deviations (X3 to X7) and the conditions they put on Batch 6

- **X3 (`suggestTeam`):** confirmed. The UI appends `COPY.treasury.override.addOneUnderTeam` as a link to `/o/<slug>/admin/reimbursements/team`; the string begins with a space, which the UI renders as a space before the link text and does not trim away. A `pay`-only viewer gets the sentence alone, as C8 requires.
- **X4 (group name read after the refusal):** confirmed; `Someone in the group can approve this, so it needs their approval.` for a viewer who cannot read the request is true and discloses no name.
- **X5 (first refusal is the gate's `You don't have permission to do that.`):** confirmed; it is `COPY.gate.notPermitted` (ruled in the Batch 2a amendment, T2).
- **X6 (a page past the last page is empty with total 0):** confirmed. Batch 6 redirects a `page` above 1 whose items are empty to page 1 of the same filters; it never prints "page 2 of 0". Pinned by a `queue-page` test (to be written).
- **X7 (invalid query values are dropped):** confirmed. The condition: the filter bar and the `Export CSV` link are built from the **parsed** query (`parseQueueQuery`), never the raw one, so the page shows exactly the filter applied and a hand-typed bad date can only widen the view the viewer sees on screen. No sentence for a rejected filter is needed because the browser's date inputs cannot produce one.
- **Loop-back note 3, 4 and 5:** unchanged. Note 1 (gaps 1, 2, 5) and note 2 (the group filter) are closed by this amendment.

### Blast radius

Existing assertions altered: listed under "What changes in code", item 1 (tests). Existing e2e specs asserting any of these strings: none (the four reimbursement specs and the hydration entry are Batch 7, not yet written). **For Batch 7:** the treasurer spec asserts `Choose a date between the day of the expense and today.`, one of the six refusal sentences by posting a stale page, the empty-state sentence for a filtered queue, and `Write a note.`. Flags each affected spec depends on: the per-org toggle `org_portal.reimbursement` only, set through `e2e/support/flags.ts` or the fixture's `setToggle`; nothing goes into `scripts/ci/e2e-baseline-flags.sql`. Edge cases and the test that pins each: the bounded pagination reaches `truncated` at 2,001 rows (to be pinned by a `reads.db` case that seeds the cap through a lowered constant; the real 2,000 is unverified); `treasuryReturnAction` posting `kind: "not_approved"` is still dropped (`actions.test.ts › sends back for CHANGES only`, exists); a `pay`-only holder's refusal text (`actions.test.ts`, extended); the midnight/time-zone date edge is **unverified**.

### Carry-forward

| Item | Addressed or deferred |
|---|---|
| Batch 4 Copy gap 1 (`note_required`) | S1; closed |
| Gap 2 (payment before the expense date) | S1; closed |
| Gap 3 (category vanished) | S5; closed |
| Gap 4 (tampered shape) | S5; stands |
| Gap 5 (set-up-role `not_treasury_only`; reuse of giving's five) | S2; closed, reuse confirmed |
| Gap 6 (settings success text) | S5; none, stands |
| Gap 7 (neutral for state refusals) | S3; changed for the treasurer tree, neutral kept for `not_found` and the member tree; residual 13 |
| X1, X2 | S6; both confirmed, C10 amended |
| X3, X4, X5, X6, X7 | Confirmed above; conditions on Batch 6 |
| Known UI gap (group filter) | S7; orchestrator ruling recorded, bounded derivation, `groupsTruncated` |
| Orchestrator ruling 4 of 2026-10-26 ("submitted") | S7 labels and hint |
| Residuals 3, 8, 12, F138 | Not denied by any string here |
| C12 (giving team strings) | Batch 6, now also carrying the grant sentence fix (S2) |
| Anything deferred | The distinct-groups definer, if any organization passes 2,000 requests (tech-lead; no operator confirmation needed); Batch 7's assertions of these strings |

**Decision draft (number pre-assigned by the orchestrator at integration):** *The treasurer tree answers a refused verb with a short sentence that is true for every cause of that outcome; only a missing request and the whole member tree stay on the neutral answer. The queue's group filter is read from the requests the viewer can already see, bounded at 2,000.*

**Implementer:** per the table above, api-developer for Batches 3 and 4 and ux-developer for Batch 5. Status: Phase 3 amendment complete, 2026-10-26; one new item on the confirmation list.

## Phase 4 — Batch 4 follow-up

**Date:** 2026-10-26 · **Author:** api-developer · **Applies:** "Phase 3 — amendment (Copy gaps from Batch 4)", item 1 ("Batch 4 follow-up"). No schema, migration, route, permission, flag or audit change. Failing-first: the altered and new tests were written and run red before the code.

- `src/lib/reimbursement/copy.ts`: added `treasury.results.{noteRequired, dateOutOfRange}` (and deleted `dateNotFuture`), `treasury.refusals.{notWaivable, receiptPresent, notVoidable, notReversible, notApprovable, notReturnable}`, `treasury.sendBack.{title, body, bodyApproved}`, `settings.categoryGone`, `team.ensureNotTreasuryOnly`; replaced `team.notTreasuryOnly` with the ruling 3 grant sentence; replaced `queue.nothingWaiting` with `queue.empty.{pay, override, progress, paid, all, filtered}` and added `queue.filter.{groupAll, groupSelected, submittedFrom, submittedTo, datesHint, apply, clear, groupsTruncated}`. All byte-pinned in `copy.test.ts` (and `nothingWaiting` / `dateNotFuture` pinned absent). The member page's `page.nothingWaiting` is untouched.
- `treasury-input.ts`: `paidOn` uses `dateOutOfRange`; `addNoteSchema.note` uses `noteRequired`.
- `treasury-messages.ts`: `date_out_of_range` and `note_required` map to the new strings; `reasonVerbRefusal` (`not_voidable`, `not_reversible`), `waiveRefusal` (`not_waivable`, `receipt_present`) and `overrideRefusal` (`not_approvable`) map to `treasury.refusals.*` with `not_found` still `{ kind: "not_found" }` neutral; new `treasuryReturnRefusal(outcome)` (`not_returnable` to the treasurer sentence, everything else delegated to the member tree's `decisionRefusal`, which is unedited); `categoryRefusal`'s `not_found` to `settings.categoryGone`. Header comment rewritten to the amended reading of EC16.
- `admin/reimbursements/actions.ts`: `treasuryReturnAction` calls `treasuryReturnRefusal`. `team/actions.ts`: the ensure action returns `COPY.team.ensureNotTreasuryOnly`; grant keeps `COPY.team.notTreasuryOnly`. Giving's twin (`giving/team/actions.ts:54`, `:142`) untouched, Batch 6's.
- `reads.ts`: `listTreasurerGroups(identity, bounds?)` returns `{ kind: "ok", groups: {id, name}[], truncated } | { kind: "denied" }`. It pages `presby_reimbursement_treasurer_list(..., 'all', null, null, null, limit, offset)` in ONE `withOrgContext`, 200 rows a page, up to `GROUP_SCAN_MAX_ROWS = 2000` rows, stops early at `total_count`, sorts distinct groups by current name, and `truncated` is `total_count > maxRows`. Same `view` gate (`denied` as the queue). The optional `bounds {pageSize, maxRows}` exists so a test can lower the cap (pageSize is held to the definer's 200).
- Tests altered: `treasury-messages.test.ts`, `treasury-input.test.ts`, `copy.test.ts`, `admin/reimbursements/actions.test.ts` (void, waive, note, send back and override now assert text, and `not_found` stays neutral), `team/actions.test.ts`. New DB cases in `treasurer-reads.db.test.ts` (`listTreasurerGroups`: distinct and sorted, paged equals whole, the bound is hit and an exact bound is not truncated, `view` gate, no other-organization group). `payments.db.test.ts` unchanged.
- Gate: `tsc --noEmit` clean, `npm run lint` clean, `npm run check` (all eight tripwires) clean, `npm run test` 619 files passed / 96 skipped, 9393 tests passed / 2774 skipped; `treasurer-reads.db.test.ts` serial 16/16 against `pipeline-treasury`; `scripts/treasury/test-rls-73.sql` as presby_app: 52 pass notices, no failure.
- Unverified: the real 2,000 bound is exercised only through the lowered `bounds`, not by seeding 2,001 rows; the org-midnight time-zone edge of the payment date is still unverified (as the amendment says).
- **Handoff:** ux-developer, Batch 6. The strings and `listTreasurerGroups` are ready to consume; Batch 6 still owns the giving team-action wording (C12), the send-back dialog, the filter bar and empty states, X3, and the X6 clamp.

## Orchestrator rulings on Batch 5 (2026-10-26)

- **No chargeable group (Phase 1 Flow 6):** the request form shows, in place of the `Charge to` select, `No groups can be charged yet. Ask your treasurer to set them up.` and Send stays disabled. Copy checks: true for a member with zero chargeable groups (the read returns none); the treasurer (manage holder) is the one who sets chargeable groups; no residual denied. Applied by Batch 6's implementer as a small member-form edit with a test.
- **Request page heading:** the amount as the H1, with "Reimbursements" for an amountless draft — accepted.
- **Treasury-only viewer redirect** lands on Batch 6's detail page; Batch 6 closes the 404.

## Phase 3 — amendment (Copy gaps from Batch 6)

**Date:** 2026-10-26 · **Author:** tech-lead · **Class:** Copy amendment inside the Treasury Inc 1 Feature; no schema, migration, route, permission, flag or audit change · **Inputs:** the Batch 6 section ("Copy", deviations U5 to U9, "Loop-back candidates"), the two earlier Copy amendments, and the live tree on `pipeline/treasury` at `1bcb3c0` (`src/lib/reimbursement/copy.ts:474-504` the `team.panel` block; `src/components/treasury/{team-grant-list,team-setup-buttons,team-grant-form,team-panel}.tsx`; `src/lib/treasury/team.ts:170-280`; `…/admin/reimbursements/{queue-model.ts,page.tsx,export/route.ts,settings/categories-panel.tsx}`; `src/lib/reimbursement/csv-export.ts`; `drizzle/0073:2946-2985, 3130`; the giving team page for comparison). Nothing outside this work-log was edited. The Copy rule stands: strings below live in `src/lib/reimbursement/copy.ts`, are byte-pinned in `copy.test.ts`, and the UI types none.

### Rulings at a glance

| # | Question | Ruling | Applied by |
|---|---|---|---|
| 1 | Team page chrome reused from giving, and the three adapted strings | **Confirmed**, all three adapted strings stand as written. One reused string is **replaced** in how it is fed: `roleSetUpWithout` printed raw permission keys (`reimbursement.pay`) to a non-engineer; it now prints the labels in ruling 2 | Batch 6 follow-up |
| 2 | Short key labels on team rows | **Yes**: four reimbursement labels, plus the three giving labels so the set-up toast can name any key a Treasurer template can skip | Batch 6 follow-up |
| 3 | Confirmation for Retire | **Yes**, an `AlertDialog` (Retire is not undoable on the same row; re-adding the name makes a new category) | Batch 6 follow-up |
| 4 | CSV ignores the group filter | **Not added in Increment 1.** Say it on the page, in two short notes shown only when the file differs from the screen, and in the release note | Batch 6 follow-up (notes); release notes at ship |
| 5 | U5 to U9 | **All confirmed** | none |

All four code changes are one small **Batch 6 follow-up by ux-developer**, one commit, before Batch 7 starts (Batch 7's treasurer spec asserts these strings). It needs no api-developer or database-admin work.

### The strings, exact, with the four checks (one paragraph per group)

**Group T1: the team page chrome (`COPY.team.panel`).** The reused strings in the Batch 6 list are **confirmed verbatim** (`since`, `(group)`, `End this role`, `End {who}'s {role} role?`, `Keep the role`, `End role`, `{who} no longer has this role.`, `Setting up…`, `Role set up.`, `Give a role`, `Role`, `Person`, `Choose a role`, `Choose a person`, `Give role`, `Role given.`, `Nobody has a current membership here yet.`, and the "managed under Roles" note as amended by C12). The three adapted strings are **confirmed exactly as in `copy.ts`**:

| Where | String |
|---|---|
| End-role dialog body `COPY.team.panel.endBody` | They will lose this role's permissions right away. Anything they have already recorded stays. You can give the role again later. |
| Set-up intro, two or more roles missing `…setupIntroMany` | These roles aren't set up for your church yet, so they can't be given to anyone. |
| No role to give `…noRoleToGive` | There is no role to hand out yet. Set one up above, then come back. |
| Set-up toast naming skipped permissions (**changed**) `…roleSetUpWithout(labels, many)` | Role set up, without {labels} (you don't hold {them/it} yourself). where `{labels}` are the ruling 2 labels joined with `, `, never the raw keys |

*Residuals.* None denied. The dialog body says "this role's permissions", not "all access", so it does not deny that a person may hold the same key through another role or a group (the 0073 holder reads union them). *Source of truth.* `endBody`: ending a grant end-dates `role_assignments` and `presby_has_permission` reads live, so "right away" is what giving's own dialog already says and the same mechanism; "already recorded stays" is true because payments, notes and decisions are append-only events that name the person, not the grant; "give the role again later" is true except when the refusal in `COPY.team.lastManager` applies, which is shown instead of the dialog's promise at the time. `noRoleToGive`: shown when `team.assignableRoles` is empty. `assignableRoles` is the org's treasury-only roles of this module, and `missingTemplates` is every template with no assignable role (`team.ts:280`), so an empty list means both set-up buttons are rendered above; "Set one up above" is therefore true whenever the sentence shows, pinned by a `team-panel` test (empty roles renders both buttons and the sentence). `setupIntroMany` is shown when more than one template is missing. `roleSetUpWithout`: `skippedKeys` is the template keys the actor lacks (`team.ts:454`), so "you don't hold" is true of the viewer. *Audience.* All of it is read by a `manage` holder, the default Treasurer, who is the one who can set a role up, end a grant or give a role; `endBody` and the set-up toast give no instruction beyond "give the role again", which that viewer can do. *Neighbours.* Grepped `src` for `giving permissions above`, `so it can't`, `hand out`, `come back`: the giving twins at `giving/team/team-list.tsx:94`, `giving/team/grant-form.tsx:78` and `giving/team/setup-role-button.tsx:37` are giving's own and stay (the last one prints raw keys such as `giving.record` in its toast; a pre-existing wart on the giving page, **deferred**, tech-lead, proposed for `docs/TODO.md` by the orchestrator). `copy.ts:479` and `:502` carry `ADAPTED` comments that stay.

**Group T2: short key labels for team rows (`COPY.team.keyLabels`).** Each holder row shows the role's reimbursement keys as secondary badges under the role line, like giving's `View giving` / `Record gifts` / `Manage giving`, because a custom role (for example a Finance Committee role holding only `view`) cannot be told apart from a Treasurer by its name.

| Key | Label |
|---|---|
| `reimbursement.request_for_others` | Enter requests for others |
| `reimbursement.view` | View all requests |
| `reimbursement.pay` | Record payments |
| `reimbursement.manage` | Manage reimbursements |
| `giving.view` · `giving.record` · `giving.manage` (set-up toast only; the same words giving's page already uses) | View giving · Record gifts · Manage giving |

Rendered in the order above (view, then pay, then manage, with the clerk key first, as in C9), from `grant.ownKeys`; a key with no label is not rendered and is not shown raw. The `roleSetUpWithout` toast joins labels, in the same order, with `, `. *Residuals.* None denied; a badge is a label, not a full list: the exact meaning of each key is the permission description (C9) shown under Roles, and the badges do not claim a role holds *only* those capabilities. *Source of truth.* `grant.ownKeys` is "the role's keys in this surface's own module" (`team.ts:170`, read at `:213`), so a badge names a key the role carries now; the labels' wording is chosen to be true of the key's description (C9): `view` includes the export, `pay` includes the waive, send-back, void and override-approve, and "Record payments" is the key's main act and the C8 button's word (the three extra verbs are named in the permission description, not here). *Audience.* A `manage` holder; the labels instruct nothing. *Neighbours.* Grepped `src` for `View giving`, `Record gifts`, `Enter a reimbursement request`: giving's `KEY_WORDS` at `giving/team/team-list.tsx:24` (the same three giving words, unchanged), `giving/team/grant-form.tsx` (its role options), and C9's permission descriptions (longer sentences, not edited). Giving's list stays unchanged.

**Group T3: Retire a category asks first (`COPY.settings.retireDialog`).** Retire is soft (`ended_at`, never deleted; `end_category`, `drizzle/0073:2525`), but on the page it cannot be undone as the same row: adding the name again makes a new category. Two categories with one name would then appear in any tally by category. One tap, 44 px away from Rename on a phone, with no feedback, is a mis-tap away from that. An `AlertDialog`, opened by the existing `Retire` button (still labelled `Retire {name}` to a screen reader), disabled until hydrated.

| Where | String |
|---|---|
| Title `retireDialog.title(name)` | Retire {name}? |
| Body `retireDialog.body` | People can no longer choose it on a request, and a draft that uses it will need another category. Requests already sent in keep it. You can add a category with the same name again later. |
| Cancel `retireDialog.keep` | Keep the category |
| Confirm `retireDialog.confirm` | Retire category |
| Success | No toast (ruling S5 of the Batch 4 amendment stands: the row leaves the list on re-read); a refusal shows `COPY.settings.categoryGone` as now |

*Residuals.* None denied; the body says nothing about reports. *Source of truth.* "No longer choose it": the member form's options list only `ended_at is null` categories (`presby_reimbursement_form_options`, `drizzle/0073:3053`). "A draft that uses it will need another category": a save naming a retired category is refused `category_unavailable` (`:900`), which the form shows as `COPY.fieldErrors.category`; a draft that is sent in without being re-saved is **unverified** (the Batch 5 form pre-selects the draft's category, and I did not trace the submit definer's check on a retired id). "Already sent in keep it": the detail definer returns the category with `retired: true` (`:2814`), and the table comment (`:510`) says "a retired category stays on the requests that carry it". "Add a category with the same name again": the uniqueness index covers active rows only (`:155`, `where ended_at is null`). *Audience.* A `manage` holder; every action named (choose, add a category, keep) is one that holder has. *Neighbours.* `categories-panel.tsx:15-19` (the comment "Retire is one tap with no confirmation dialog": modify), the hint `Retired categories stay on old requests.` (`copy.ts:433`, still true, unchanged), `settings-components.test.tsx:138-146` and `e2e/reimbursement-treasurer-ui.spec.ts:678` (they click Retire and expect the row to go: both gain the confirm step), and the Batch 6 log line 1287 ("Retire has no confirmation": superseded by this ruling).

**Group T4: the CSV export covers more than the queue shows (decision on Batch 6 note 3).** *Ruling: do not add a group filter to the export in Increment 1.* The reasons, in order. (a) It is not cheap: `presby_reimbursement_export_rows` takes `(uuid, date, date, text, integer)` and returns no group id (`drizzle/0073:2946`), and group names are not unique in an organization (`groups` has no unique name), so a filter cannot be applied in TypeScript from the name column; it needs a new `p_group` parameter, which in an unreleased migration means an in-place edit of 0073 (the definer, its comment, the signature list in the grant assertion at `:3130`), a `DROP` of the old five-argument function on the pipeline Neon branch (otherwise an overload remains), then `scripts/treasury/test-rls-73.sql`, `reimbursement-definers.db.test.ts`, `csv-export.db.test.ts`, `csv-export.ts`, `parseExportFilters`, the route, the audit metadata and `audit-coverage.test.ts`: a database-admin and an api-developer batch and a re-QA of the schema, to add a convenience. (b) The export is the viewer's own `view` authority, so the unfiltered file discloses nothing the viewer cannot already see; the defect is expectation, not exposure. (c) The page can be made true with copy. **Revisit** if a congregation asks for a per-group file; the shape is then `?group=<uuid>` on the export route, parsed by `parseExportFilters`, passed as a sixth definer parameter, and recorded in the `REIMBURSEMENT_EXPORTED` metadata as `groupId` beside `from`, `to` and `status`. Recorded as a non-goal for the user to confirm.

The Batch 6 note covers only the group. Reading `exportHref` shows a second mismatch of the same kind: `status` is sent only on the two single-status tabs (Waiting for payment, Paid), so on Needs treasurer approval and In progress the file holds every sent-in request in the date range, not the tab's. The same two notes cover both. Shown under or beside the `Export CSV` button as muted `text-sm` text (wraps below the button at 360 px), `data-testid="export-note"`, each only when it applies, in this order, space-joined:

| Shown when | String `COPY.queue.exportNote.*` |
|---|---|
| a `Charged to` group is selected (any tab) `group` | The file covers every group, not only the one chosen under Charged to. |
| the tab is Needs treasurer approval or In progress `requests` | The file covers every request that has been sent in, not only this tab's. |

With no group selected on Waiting for payment, Paid or All, no note is shown (the file is what the tab shows, apart from pagination: the file is not paged). *Residuals.* None denied. *Source of truth.* The group note: `exportHref` never carries a group and `parseExportFilters` has none (`export/route.ts`; `queue-model.ts:36`). The requests note: `exportHref` sets `status` only for `pay` (approved) and `paid` (paid); the export's own filter is non-draft (`drizzle/0073:2975`), so "every request that has been sent in" is the definer's exact predicate ("sent in" excludes drafts, which a treasurer never sees on the All tab either). Dates continue to be carried and are explained by the existing `queue.filter.datesHint`; the notes do not repeat them. *Audience.* A `view` holder, who is the viewer who sees `Export CSV`; the notes instruct nothing. *Neighbours.* `queue-model.ts:30-35` (comment "so the file matches what the tab shows": **stale** for two of five tabs, modify), the Batch 6 section line 1274 (names the same mismatch for the group; superseded by this ruling) and loop-back note 3, `copy.ts:314-315` (`Export CSV`, `exportTooLarge`, unchanged).

**Release-note line (add to C13 as line 7, draft):** *The treasurer's Export CSV lists every group and, on the Needs treasurer approval and In progress tabs, every request that has been sent in, within the dates chosen on the page.*

### Confirmed deviations U5 to U9

- **U5 (one component per file):** confirmed; no design claim depended on `treasury-dialogs.tsx`.
- **U6 (cards at every width, spread into columns from `md`):** confirmed. C7 itself says "Card/table fields"; the design's own 360 px line says the queue is cards, and the table was an unstated preference. No column header strings are needed or added, which is the point: a table would have required Copy for them. The 1280 px walk (queue, override, paid, long values, no sideways scroll) is the evidence.
- **U7 (two hydration specs in Batch 6):** confirmed. They are additive new files under `e2e/hydration/`; the design's Batch 7 line "the `e2e/hydration/` entry" is **already met** by `reimbursement-form.spec.ts` (Batch 5) plus `reimbursement-treasurer-forms.spec.ts` (Batch 6), so Batch 7 owes no hydration spec unless it adds a `useForm` root.
- **U8 (treasurer-UI slice is its own spec; Batch 7's four specs untouched; requests seeded by the definers in a `DO` block):** confirmed, with the Batch 7 condition below that the seeding is lifted into the fixture.
- **U9 (C12 designation edits done in Batch 6):** confirmed; the design assigns them to Batch 6 (C12), so this is not a deviation from the design, only from the brief's list.

### What changes in code (Batch 6 follow-up, ux-developer, one commit)

1. `src/lib/reimbursement/copy.ts`: add `team.keyLabels` (seven keys), `settings.retireDialog.{title, body, keep, confirm}` and `queue.exportNote.{group, requests}`; pin each byte-exact in `copy.test.ts`. `roleSetUpWithout` is unchanged in shape; its *caller* passes labels.
2. `src/components/treasury/team-grant-list.tsx`: render `ownKeys` as `Badge variant="secondary"` in a `flex flex-wrap gap-2` row between the role line and the End button (wraps at 360 px); labels from `COPY.team.keyLabels`, unlabeled keys dropped. `team-setup-buttons.tsx`: map `skippedKeys` through the labels (unknown keys dropped) before `roleSetUpWithout`.
3. `…/admin/reimbursements/queue-model.ts`: a pure `exportNotes(query): string[]` (group when `groupId !== null`; requests when the tab is `override` or `progress`); `page.tsx` renders them beside the button; update the stale comment at `:30-35`.
4. `…/settings/categories-panel.tsx`: wrap Retire in the `AlertDialog` pattern `team-grant-list.tsx` already uses (`Keep the category` as `AlertDialogCancel`, `Retire category` as the action, trigger disabled until hydrated, the busy ref kept); the dialog title wraps with `[overflow-wrap:anywhere]` for a 60-character name; update the file comment.
5. Tests altered (the blast radius): `settings-components.test.tsx:138-146` (Retire now opens the dialog; cancel posts nothing; confirm posts and re-reads; the `categoryGone` toast case), `team-panel.test.tsx` (badges render in order, an unlabeled key is not rendered, the set-up toast prints labels not keys, the empty-roles case shows both buttons and `noRoleToGive`), `queue-model.test.ts` (`exportNotes` for each of the five tabs with and without a group), `pages.test.tsx` (the note renders only when it applies), `copy.test.ts`, and `e2e/reimbursement-treasurer-ui.spec.ts:678` (click the confirm in the dialog before expecting the row gone; assert the group note once a group is chosen). Flags: none new; the spec sets the per-organization toggle through its fixture as today.
6. Gates as for any batch: typecheck, lint, `npm run check`, build; a 360 px look at the team row with two badges and at the Retire dialog with a 60-character name; no `useForm` root is added, so `check:hydration-gate` is unchanged.

### What Batch 7 must still deliver (full-stack-developer, per the design's table; nothing here is changed by this amendment)

1. `src/lib/reimbursement/print.ts` and the print route `GET /o/<slug>/reimbursements/<id>/print` (pdfkit, `attachment`, `no-store`, requester-visible projection, Copy C11), with a unit test and a "no GET mutates" test; then the **`Print the form` button** (`COPY.detail.buttons.print`, `copy.ts:218`) in the member `request-detail.tsx`, which is not rendered yet (`request-detail.tsx:28`); that is a small member-tree edit and it needs a test.
2. `scripts/check-treasury-boundaries.mjs` and its test, wired into `npm run check` (so `check` then runs nine tripwires: update the count wherever it is stated).
3. `e2e/support/reimbursement-fixture.ts`: a **new additive file** (the Rule 16 shared-path rule: `e2e/support/*` is on the shared-file list, so nothing existing in `e2e/support/` is edited and nothing but this one file is staged there; person and organization ids use the confirmed prefixes `e2e96000-0000-4000-8000-` and `e2e96001-0000-4000-8000-`). Lift into it the inline `DO`-block definer calls and the throwaway second-payer user from `e2e/reimbursement-treasurer-ui.spec.ts` (U8); the Batch 5 and 6 specs may then import it, but a spec edit that only moves code is in scope and must keep both specs green. The throwaway organization is deleted with one `delete from organizations`.
4. The four specs the design lists, each on its own dev server per Rule 16 (`E2E_BASE_URL`, port in the `3100 + n` series pre-assigned, never 3000), flags set through `e2e/support/flags.ts` or the fixture's toggle, nothing added to `scripts/ci/e2e-baseline-flags.sql`:
   - **MFA deep-link spec** (`reimbursement-treasurer.spec.ts`): an MFA-enrolled treasurer opens `/o/<slug>/admin/reimbursements/<id>` signed out, passes `/signin` with `callbackUrl` preserved, then `/totp` with the real secret, and lands on the request; records a payment; the approver cannot pay (the message before the form); reverses; void; override with a second pay holder, and `needs_second_payer` with one. It asserts the strings ruled in the Batch 4 amendment (`Choose a date between the day of the expense and today.`, `Write a note.`, one of the six refusal sentences reached by posting from a stale page, the filtered empty state) and, from this amendment, the group export note.
   - **Role-bundle spec** (`reimbursement-role-bundle.spec.ts`): the treasurer is created by the real invitation accept (`presby_apply_treasurer`), holds only that role, completes every treasurer verb, sets up the clerk role and grants the treasurer role to a second member **through the treasury team page**, who records the payment on a request the first approved by override; plus the parallel DB test calling the definers. It should also assert a key badge on a team row.
   - **CSV bytes spec**: the header row exact, the formula guard on free-text cells, RFC 4180 quoting, `Content-Disposition` and `no-store`, the 413 body, and the `REIMBURSEMENT_EXPORTED` audit row (count and filters, never an amount, purpose or name); it requests the export with and without the dates and a status, and confirms a request for a group other than the one on screen is in the file (the T4 ruling made testable).
   - **Features-toggle spec** (`reimbursement-toggle.spec.ts`): turning Reimbursements on; off with open requests shows the count dialog; off hides the pages and deletes nothing; on restores. It captures and restores `org_portal.features` through `flags.ts`, as `giving-admin.spec.ts` does.
   - **Approval spec** (`reimbursement-approval.spec.ts`), also in the design's list of five and not yet written: the emailed-link flow, stale revision, double approve, neutral 404 for a non-seat member, the requester who is also chair, a GET twice changes nothing, and the MFA chair case. The orchestrator's list names four; the design lists five new specs plus `reimbursement-member.spec.ts` (done in Batch 5), so approval is Batch 7's too unless the orchestrator rules it elsewhere.
5. The 360 px walk for the screens Batch 7 adds or changes (print button, the team row badges and the Retire dialog if not walked in the follow-up), screenshots in the gitignored `test-results/reimbursement-360/`.
6. Receipts are still **Batch 2b** and blocked on F289 merging: the receipt-bearing steps of the member spec (a synthetic PNG at 360 px) wait for it; Batch 7 must not stub them.
7. Gates: typecheck, lint, `npm run check`, build, the DB suite serially; the MFA-enrolled e2e against a running dev server is a Phase 5 `PASS` precondition for this increment (CLAUDE.md Phase 4 gate), so a skipped e2e is `BLOCKED`, not `PASS`.

### Blast radius

Existing assertions altered: item 5 above. Existing e2e specs asserting these strings: only `e2e/reimbursement-treasurer-ui.spec.ts:678` (the one-tap Retire) among the existing ones. Flags: the per-organization toggle `org_portal.reimbursement` only. Edge cases and the test that pins each: the Retire dialog's cancel posting nothing and confirm posting once (`settings-components.test.tsx`, to be altered); a 60-character category name wrapping in the dialog at 360 px (to be walked; **unverified** until then); `noRoleToGive` showing only with both set-up buttons present (`team-panel.test.tsx`, to be added); the notes appearing only when they apply (`queue-model.test.ts`, to be added); a draft sent in without being re-saved after its category was retired (**unverified**).

### Carry-forward

| Item | Addressed or deferred |
|---|---|
| Batch 6 Copy gap 1 (team chrome, three adapted strings) | T1; confirmed; the toast fed from labels |
| Gap 2 (key badges) | T2; labels given |
| Gap 3 (queue columns), gap 4 (back link), gap 5 (shared strings) | Gap 3 by U6 (confirmed, no Copy); gaps 4 and 5 reuse confirmed as in the Batch 6 list |
| Gap 6 (Retire has no confirmation) | T3; superseded, dialog added |
| Loop-back note 3 (CSV ignores the group) | T4; no group filter in Increment 1; notes on the page and a release line; revisit shape recorded |
| Loop-back note 2 (fixture lift, four specs) | Batch 7 items 3 and 4 |
| Loop-back notes 4 and 5 | Stand, as the Batch 6 section records |
| U5 to U9 | Confirmed |
| Residuals 3, 8, 12, 13, F138 | Not denied by any string here |
| Deferred | A group-filtered export (tech-lead; operator may overrule: it is on the confirmation list); giving's raw-key set-up toast (`giving/team/setup-role-button.tsx:37`, tech-lead; proposed `docs/TODO.md` line for the orchestrator) |

**New items for the confirmation list:** (i) no group filter on the CSV in Increment 1, with the page notes instead; (ii) a confirmation dialog on Retire a category.

**Implementer:** Batch 6 follow-up, ux-developer; Batch 7, full-stack-developer. Status: Phase 3 amendment complete, 2026-10-26.

## Phase 4 — Batch 6 follow-up

**Date:** 2026-10-26 · **Author:** ux-developer · One commit, as the Phase 3 amendment (Copy gaps from Batch 6) lists. No schema, route, permission, flag or audit change. Giving's `setup-role-button.tsx` untouched (deferred to TODO).

- `copy.ts`: `team.keyLabels` (seven keys), `settings.retireDialog.{title,body,keep,confirm}`, `queue.exportNote.{group,requests}`; byte-pinned in `copy.test.ts`. `roleSetUpWithout` now takes labels.
- New pure `src/lib/reimbursement/key-labels.ts` (`keyLabelsFor`: label order, unlabeled keys dropped). `team-grant-list.tsx` renders secondary badges (`data-testid="team-keys"`, wraps at 360 px); `team-setup-buttons.tsx` maps skipped keys to labels.
- `queue-model.ts`: pure `exportNotes(query)`; stale `exportHref` comment fixed; `page.tsx` renders the notes under `Export CSV` (`data-testid="export-note"`).
- `categories-panel.tsx`: Retire is an `AlertDialog` (`retire-confirm` is the action); file comment updated.
- Tests: `copy.test.ts`, `team-panel.test.tsx` (badge order, unlabeled dropped, empty-roles case, toast labels), `queue-model.test.ts` (`exportNotes`), `pages.test.tsx` (note only when it applies), `settings-components.test.tsx` (cancel posts nothing, confirm posts once), `e2e/reimbursement-treasurer-ui.spec.ts` (confirm step, group note, badge assertion, two 360 px screenshots).
- Gates: typecheck, lint, `npm run check`, full unit suite green; `reimbursement-treasurer-ui` + `reimbursement-member` 32/32 on :3590 (one first-run flake at the Worship switch click-then-reload, line 653, passed on re-run; not touched by this change). 360 px looked at: team row with badges and the Retire dialog, no sideways scroll.
- Honest notes: the new tests were written with the code, not watched failing first. The 60-character category name wrap in the Retire dialog is **unverified** in a browser (title carries `[overflow-wrap:anywhere]`).
- Next: Batch 7 (full-stack-developer).

## Batch 7 — full-stack-developer (2026-10-26)

Built on `pipeline/treasury` at `070442d`; commits `9df121f` (print), `6a8007c` (tripwire), `f5a83e6` (fixture), `26ecc35`, `1688bd8`, `d82e794`, `560b558`, `e35381c` (the five specs), `b5a1f93` (member print test), `1895c0c` (Retire long name, Settings race), then the spec-hygiene commit and the work-log commit that records this section (`git log 070442d..HEAD`). No schema, migration, permission, flag, proxy or auth change; no audit key added (a print is a read of what the page shows, and the route's test asserts it writes none). The only string added to `copy.ts` is C11's own two (`print.title`, `print.footer`), byte-pinned; nothing outside Copy was needed.

### Files Created

- Print: `src/lib/reimbursement/print-model.ts` (pure; accepts only the member projection; the status line is `RequestBanner`'s sentence in the requester's words, compared sentence for sentence by a test that renders the component), `print.ts` (pdfkit, the statements' committed Noto Sans, deterministic bytes), `print-model.test.tsx`, `print.test.ts`, `src/app/(org)/o/[slug]/reimbursements/[id]/print/route.ts` and `route.test.ts` (the design names these `print-model.test.ts` / `print.route.test.ts`).
- Tripwire: `scripts/check-treasury-boundaries.mjs`, `scripts/check-treasury-boundaries.test.mjs` (72 tests).
- E2E: `e2e/support/reimbursement-fixture.ts` (the only file added under `e2e/support/`; nothing existing there is edited or staged) and the specs `e2e/reimbursement-treasurer.spec.ts` (9), `reimbursement-approval.spec.ts` (7), `reimbursement-csv.spec.ts` (6), `reimbursement-role-bundle.spec.ts` (9), `reimbursement-toggle.spec.ts` (5).

### Files Modified

- `request-detail.tsx` (member): the **Print the form** button, a plain `<a>` (never `<Link>`: the address is a route handler and a Link would prefetch it), offered to every viewer of the request, in the one actions row; `pages.test.tsx` gains the test.
- `next.config.ts`: one `outputFileTracingIncludes` key, `/o/*/reimbursements/*/print`, the fonts and `pdfkit/js/data` (the design lists it; **not** on the Rule 16 list, so edited in the branch; confirmed in the build: the route's `.nft.json` carries both fonts and 15 pdfkit data files, the same as the statements route). `FONT-SOURCE.txt` notes the second user.
- `package.json`: `check:treasury-boundaries`, appended to `check`. `docs/work-log/treasury-inc1.integration.patch`: a **fifth file**, `CLAUDE.md` ("eight" to "nine" tripwires in the Phase 4 gate and the command list, and the `check:treasury-boundaries` line); its hunk applies to HEAD on its own (`git apply --check`); the other four hunks still apply only to the Batch 1a tree and need the orchestrator's regeneration at integration, as before. CLAUDE.md itself is untouched.
- `copy.ts` / `copy.test.ts` (C11), `gate-coverage.test.ts` (the scan must find the print route).
- `e2e/reimbursement-member.spec.ts` and both `e2e/hydration/reimbursement-*.spec.ts`: their stale-organization sweep now matches the whole `e2e-reimb[a-z]*-<digits>` slug family, because the Batch 7 specs share their fixed person ids (a crashed run of one spec would otherwise make another's cleanup hit a foreign-key error). One line each.
- `e2e/reimbursement-treasurer-ui.spec.ts`: moved onto the fixture (the inline `DO`-block seeding, the throwaway second payer and the teardown now live in `reimbursement-fixture.ts`); one new test (the 60-character category name in the Retire dialog, closing the Batch 6 follow-up's "unverified"); and the Settings test's un-list and re-list now wait for the database before reloading (the one flake this spec had, first noted in the Batch 6 follow-up and hit once more in this batch's first full run). `e2e/reimbursement-member.spec.ts`: the "prints the form" test; the header comment no longer says printing waits for Batch 7.

### The tripwire (`npm run check:treasury-boundaries`)

T1 no `getPlatformDb` / `PLATFORM_DATABASE_URL` / `MIGRATE_DATABASE_URL` under `src/lib/reimbursement/`, `src/lib/treasury/`, `src/components/treasury/`, either route tree or any `src/app/api` path containing "reimbursement". T2 only `src/lib/reimbursement/`, the Drizzle mirror (`src/lib/db/domain/reimbursement*.ts`) and `src/lib/testing/` name a reimbursement table, a `presby_reimbursement_*` function or a Drizzle table identifier. T3 no `capture` attribute on a `type="file"` input anywhere in `src/` (the check parses a tag's own attributes, so `className="capture"` is not one). T4 a file that references a `reimbursement.notice.` key or imports the notices module names no amount, cents, formatter, currency, purpose, vendor, payee, expense-date or reason identifier (exception: the shared audience registry, by name). T5 `sharp` is imported at runtime only by `src/lib/storage/image-sanitize.ts`; a type-only import is erased and allowed. Each rule has a violating fixture and its legal neighbours, the real tree is asserted clean, and planting one violation per rule in the real file set is asserted to fail; a mutation of a real file (`getPlatformDb` appended to `payments.ts`) failed the CLI with exit 1 and the file was restored byte-identical. The test pass found a real hole in my first T4 pattern (it did not match `formatMoney`), fixed before commit.

**Design deviations, named.** (1) T5 is "at most one, at that path", not "exactly one": the file does not exist until Batch 2b, so "exactly" is not assertable now; when 2b lands, a test should assert the file imports it. (2) T1's zone also covers `src/components/treasury/` and `src/app/api` paths (a superset of the design's list). (3) T3 scans `src/`, not only `src/app` (a superset; the rule is global anyway). (4) `stripComments` is imported from `check-giving-boundaries.mjs` rather than copied.

### The printed form

`GET /o/<slug>/reimbursements/<id>/print` runs `gateReimbursementRoute` with no key (the member surface), then asks the database for the **member** level (a `treasury`-level object returned for that ask is refused whole, tested), so a treasury-key holder prints the same requester sheet and no payment, note, approver or history name can reach it. Every request miss (missing, forbidden, malformed, refused identity) is one 404 with the same body and headers; a database failure is a 503, an org-access error a 403; headers `application/pdf`, `attachment; filename="reimbursement-request-<id8>.pdf"`, `private, no-store`, `nosniff`. Content: C11 verbatim (title, organization, the C5 labels with values, the requester's status line, receipt file names or `No receipt attached.`, `Printed from PresbyPortal.`); dates print as `October 5, 2026` (no `toLocale*`); text is cleaned again and clamped to the database's own lengths, and pdfkit wraps an unbroken 500-character purpose (tested). I looked at the rendered page (pdftoppm): one page, no overflow.

### E2E

Throwaway congregations `e2e-reimb<tag>-<stamp>` (ids `e2e96000-` people, groups, roles; `e2e96001-` organizations, unique per run), removed with one `delete from organizations`; the role-bundle spec uses the invitation fixture's `e2e-invite-<stamp>` org so a real treasurer invitation can be seeded, and sweeps both families. Requests are seeded by calling the definers in a `DO` block. Specs run serially in one worker and never attach to :3000.

- **MFA deep link** (`reimbursement-treasurer`): signed out to `/o/<slug>/admin/reimbursements/<id>`; `/signin?callbackUrl=<exact path>`; password; `/totp` (still carrying the path, because the money key makes 2FA required); the real code; the request. A signed-in, unverified session is sent to `/totp` on the member address too (EC45). The rest runs in that context: payment (the check number, `Choose a date between the day of the expense and today.`), reverse, `Write a note.`, a verb posted from a page made stale behind its back refused with the S3 sentence `This request can't be voided. Reload the page to see where it stands.` inside the dialog with the typed reason kept, `No requests match those filters.`, both export notes, override refused with one payer (the X3 link to the team page) and allowed with two, `A different person must record this payment.`, void.
- **Approval**: the bare-path emailed link signed out through `/signin` to the request and Approve; a stale page (the request sent back, edited, sent again: **a revision moves with an edit, not with a status change**) is told it changed; the late approver is told it was already approved, with the date, and only one `approved` event exists; a non-seat member, a missing id and a malformed id are one 404 body, and a stranger gets the same answer for a real and a missing id; the requester who is also a chair has no Approve or Send back, and the definer answers `not_approvable` (pinned exactly; the helper rethrows anything but the definer's own refusal so a broken block cannot pass for a refusal); opening a request twice writes nothing; the MFA-enrolled chair who also holds `reimbursement.view` is challenged at `/totp`, lands on the **member** address (seat relation, not redirected to the admin page) and approves.
- **CSV bytes**: header exact, CRLF throughout including the last line, RFC 4180 quoting (`"Chairs, ""folding"" and tables"`), the formula guard on payee and purpose for `=`, `+`, `-`, `@`, decimal amounts, `text/csv; charset=utf-8`, `attachment`, `no-store`; no email, phone or bank column; the status, date and junk filters, each file audited with `{organizationId, rowCount, from, to, status}` and no amount, purpose, payee or name; T4 (with a group chosen on screen the downloaded file still holds the other group's request, via a real browser download); signed out is a 307 to `/signin` (the proxy drops the query string, F3a, so the way back is the unfiltered file); a `pay`-only holder is a 403 and writes no audit row; and the **413**: 20,001 `import`-origin paid requests inserted in one statement (the EC36 door) make the Copy sentence with no file and no audit row, and narrowing by status or date gets a whole file under the cap. That test took about 2.5 minutes on a cold Neon branch and about 10 seconds warm; teardown of the 20,001 rows can take half a minute, so the spec sets its own hook timeouts.
- **Role bundle**: the platform operator's `treasurer` invitation is accepted through the real sign-in and `/totp`; the person holds exactly one role (`treasurer`) and the four reimbursement keys come from it alone (asserted by SELECT); from that role the queue, waive, pay, reverse, note, send back, void, settings (list and un-list a group, add a category) and the form's "Pay someone else back" all work; the team page shows the four key badges on that row in Copy's words and order (`Enter requests for others`, `View all requests`, `Record payments`, `Manage reimbursements`), sets up the clerk role, and gives the Treasurer role to a second member, who signs in through the real form and challenge and records the payment on the request the first approved (`approval_path = override`, `paid_by_user` the second, `self_paid` false).
- **Toggle**: off by default, every page the honest state at HTTP 200 with the right next step per viewer and every route handler a 404; on from the Features page; off with two open requests asks first and names the count; Keep it on leaves it on; Turn it off hides everything and deletes nothing (requests, events, payments counted); back on restores the same counts; with nothing open it turns off with no question. The platform flag `org_portal.features` is captured and restored through `flags.ts` (restore verified by SELECT).
- **Print** (member spec): the button is at least 44 px and inside 360 px; clicking downloads a PDF whose extracted text holds the organization, labels, purpose and footer and neither "History" nor "Check number"; the headers; an approver may print; a non-seat member, a missing id and a malformed id get the one 404; signed out is sent to `/signin` with the print address; no event is written.

### Walk (real Chromium, 2026-10-26; screenshots in gitignored `test-results/reimbursement-360/` and `reimbursement-treasurer-360/`, kept by running with `PW_OUTPUT_DIR` elsewhere, since Playwright empties its output directory at the start of a run)

360 x 740: the member request page with **Print the form** under Withdraw (full width, 44 px or more, no sideways scroll); the approver's page (Approve and Send back at 44 px, reachable); the treasurer deep-link landing, payment form, paid page, stale-refusal dialog (banner above the kept reason), override refusal, approver-cannot-pay, queue with both export notes; the Treasury team page with the badges wrapping to two lines; the **Retire dialog with a 60-character unbroken name** (the title wraps inside the dialog, the dialog is inside the viewport, `scrollWidth <= clientWidth`; now verified); the Features page off and on and the off-warning; the toggle-off states. `scrollWidth <= innerWidth` asserted on each. I read the print-button, team-badges, retire-long-name, approver-landing and stale-refusal screenshots. **Observation, not a defect:** on an approver's page "Print the form" now sits above the fields and Approve below them, so the first control on a phone is Print; the design put the button in the member `request-detail.tsx` for every viewer and did not rule on order. Not done: a real phone (iOS Safari), a screen-reader pass.

### Findings for the tech-lead (nothing was changed for these)

1. **C1's off-dialog title is never shown.** Copy C1 says the Features-page off-dialog title is `Reimbursement requests are still open`. The shared Features list titles every off-dialog `Turn off {name}?` and draws only the warning's `description` (`features-list.tsx:159-160`); the warning's `title` has no consumer (giving's `Monthly gifts are still active` is the same). The shipped dialog is true and reads well (`Turn off Reimbursements?` / the count sentence), so this is a Copy-versus-component mismatch, not a false claim. `reimbursement-toggle.spec.ts` pins what ships. A ruling is needed: change C1, or have the shared component draw `title`.
2. **The proxy drops the query on the sign-in redirect** (F3a, known). A signed-out treasurer who follows a filtered CSV link returns to the unfiltered file. Noted in the CSV spec; no new finding.
3. **The 413 test is the slow one** and a crashed run of it leaves 20,001 rows whose sweep takes about half a minute in the next spec's `beforeAll`; each new spec raises its own hook timeout. If that becomes a nuisance, the 413 can move to its own file.
4. The printed form's status line is always the requester's wording (`Sent back to you`, not `Sent back`), even when an approver or the treasury prints it (C11: "C5 wording for the requester"). Intended; named so QA does not read it as an audience bug.

### Gates

- `npm run typecheck`, `npm run lint` (`--max-warnings=0`), `npm run check` (nine tripwires, including `check:treasury-boundaries`) exit 0. `NEXT_PUBLIC_APP_URL=https://app.example.invalid NEXT_PUBLIC_PLATFORM_HOSTS=app.example.invalid npm run build` exits 0; the route table has `/o/[slug]/reimbursements/[id]/print`.
- `npm run test`: 636 files passed, 9,721 tests passed, 2,774 skipped (DB-gated), 0 failed. This batch's new tests are 109 (print-model 18, print renderer 5, print route 12, boundaries 72, one pin each in `copy.test.ts` and `pages.test.tsx`) in four new files; the Batch 6 report said 632 files and 9,601 tests, and the Batch 6 follow-up commit that landed after it added the rest of the difference.
- DB-backed suites: none touched (no `src/` DB code, no migration). `scripts/treasury/test-rls-73.sql` as `presby_app`: exit 0, 52 passes, 0 failures.
- E2E on my own dev server :3590 (cleared `.next/dev`, started by hand with `RATE_LIMIT_DISABLED`, the `DOMAINS_*` fakes, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET` and `E2E_ALLOW_SHARED_DB`; stopped by PID): **one clean run, 74 passed in 9.2 minutes**: member 19, treasurer-UI 15, treasurer (the MFA deep link) 9, approval 7, CSV 6, toggle 5, role-bundle 9, the two hydration specs 3, and `totp-full-login` (the login-path smoke, 1). Production lane :3591 (`PW_PROD_BUILD=1 PW_PROD_PORT=3591`; Playwright builds and starts it): the three hydration tests, 3/3. Earlier runs, for honesty: the first full battery had one failure, the treasurer-UI Settings click-then-reload race (fixed, 15/15 after); one battery was killed by the tool's time limit part-way and left an organization that the three older specs' narrower stale-slug patterns did not sweep, so those patterns now cover the whole `e2e-reimb[a-z]*` family (`reimbursement-member`, both hydration specs).
- DB-backed `src/lib/reimbursement`, `src/lib/treasury` and `src/lib/db/domain/reimbursement*` serially: 38 files, 567 tests, green. A first run failed one file's **teardown** because I ran it while an e2e teardown was toggling the same `group_memberships_reject_derived` trigger (both disable it, delete, and re-enable it, and are not atomic against each other): **never run a DB suite and an e2e at once**. Its two leftover organizations and 19 users were removed by hand and the rerun was green.
- Negative controls (restored, `git status` clean after each): `getPlatformDb` appended to `payments.ts` fails `check:treasury-boundaries` (T1); the print route asking the database for the `treasury` level fails its test; a treasury-level field leaking into the print model fails its test. Not red-first: every file here is new (no pre-existing code to fail against), so I claim mutation checks, not a red run; the two spec fixes (the stale-revision helper and the Settings race) were found red by their own runs.

### What remains for Batch 2b (receipts), once F289 merges

Unchanged by this batch, and not stubbed: `sharp@0.35.5` exact; `src/lib/storage/image-sanitize.ts` (**the path T5 allows**; add a test that it is the one file importing `sharp`) and `upload-request.ts`; `receipts.ts`; the two receipt routes (each must call `gateReimbursementRoute`, which `gate-coverage.test.ts` then scans; the upload response must add `revision`, see Batch 5); `receipt-slot.tsx` (flip `RECEIPTS_AVAILABLE`; T3 forbids `capture`, and `check:hydration-gate` applies if it adds a `useForm`); the F289 call-site rows; the receipt-bearing steps this batch had to leave out: the member spec's synthetic-PNG request at 360 px (with the double tap), and a receipt on the print form (the model already prints file names; add one print test), on the CSV and on the treasurer pages; a `seedReceipt` helper in `reimbursement-fixture.ts` (`store()` then `attach_receipt`, additive); a preview build proving `sharp` loads on Vercel. Batch 1b (the attachments FK and its 0072 guard) is the database-admin's.

### Loop-back candidates and notes

1. Finding 1 above needs a ruling (C1 or the shared component).
2. `docs/TODO.md` (orchestrator): a line for the 413 spec's cost and, once 2b lands, "T5: assert the sharp file exists"; Release note C13 line 7 (the CSV covers every group) is unchanged.
3. Rule 16: the integration patch gained CLAUDE.md; the four older hunks need regenerating against the integrated tree.

## Orchestrator rulings on Batch 7 (2026-10-26)

- **C1 off-dialog title:** accept what ships — the shared Features page titles every off-dialog `Turn off {name}?` and shows the description; C1's separate title is withdrawn (giving has the same shape). The toggle spec pins what ships.
- **`next.config.ts` trace key:** confirmed (the design lists it; one key).
- **T5 "at most one" until Batch 2b:** accepted; Batch 2b tightens it to "exactly one".
- **Print above Approve on an approver's phone:** accepted.
- **F289 is on main (0.46.1, 2026-10-26, 0072 applied to production and development).** Batch 1b (receipt FK into `blob_assets` pinned `private`) and Batch 2b (receipts) are unblocked.

## Batch 1b — database-admin (2026-10-26)

Built on `pipeline/treasury` after merging `origin/main` at 0.46.1 (`49ea633`): merge commit `b62df0b` (two conflicts, `src/lib/org-features.ts` and `src/lib/org-feature-catalog.test.ts`, where main's `org_portal.parishes` entry and our `org_portal.reimbursement` entry were both kept; typecheck and the catalog test green before the merge commit). Batch 1b is commit `852e97d`. Scope: the receipt FK into `blob_assets` and its 0072 guard, F289's catalog assertions, the integration patch re-cut. No `src/lib/reimbursement/` code, no route, no permission or flag change.

### Neon branch (`pipeline-treasury`, host checked as `ep-plain-truth`, never `ep-flat-hat` or `ep-lingering-meadow`)

- 0068 and 0072 were **missing** and were applied, in number order, with `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1` (both files require `-1`). 0072 flipped 84 blobs to `public_site` (this branch's marks and bundle images). Before applying 0072 on a branch that already held 0073, I checked that 0072's pre-flip assertion could not be silently wrong for us: 0 `reimbursement_attachments` rows exist here, so none could be a flipped blob. 0072's assertion does not know about receipts; that is safe in every environment because 0073 always sorts after it.
- 0073 and 0074 were re-applied **in place** (no drop/re-create needed: the change is a drop-if-exists/add FK, an `if not exists` index, a `create or replace` of `attach_receipt` and a guard `DO` block). Snapshot (rows per table / functions / triggers / policies / constraints / indexes / FKs into blob_assets / 0074 catalog counts / md5 of function ACLs / md5 of function sources / md5 of constraint definitions) taken before and after each of: 0073, 0073, 0074, 0074. All exit 0. The first 0073 changed exactly constraints 133→134, indexes 26→27, blob FKs 5→6, and the function-source hash (`attach_receipt`); rows `0/0/0/0/2/2` and the ACL hash unchanged; **the second 0073 and both 0074 runs changed nothing**.
- Also applied, so the full suite can reach section 73: `scripts/install-test-helpers.sql`, `scripts/parishes/seed-dev-parishes.sql`, `scripts/public-calendar/seed-dev-public-calendar.sql` (idempotent dev fixtures main already expects; pipeline branch only).

### Files Modified (committed)

- `drizzle/0073_presby_reimbursements.sql` — section 1.0 (the guard), 1d (the FK and `reimbursement_attachments_blob_idx`), 7m (`attach_receipt` pre-check), the header's DEPENDENCY note, D7 reworded, D10 added, the table comment. The Batch 1a TODO is gone.
- `src/lib/db/domain/reimbursement.ts` — header and attachments block document the DDL-only FK; the new index is declared.
- `src/lib/db/domain/reimbursement.schema.test.ts` — `DDL_ONLY` exemption (one name); the FK text, drop-before-add, guard-before-first-table and pre-check pinned; the TODO test replaced (9 → 11 tests).
- `src/lib/db/domain/reimbursement.db.test.ts` — "the receipt FK into blob_assets (F289)", owner path (26 → 32 tests).
- `src/lib/db/domain/reimbursement-definers.db.test.ts` — public_site blob via the definer as presby_app (36 → 37).
- `src/lib/testing/reimbursement-fixture.ts` — `blob(org, contentType, audience = "private")`.
- `scripts/treasury/test-rls-73.sql` — 73a FK shape; new section **73g**.
- `scripts/assets/test-rls-72.sql` (72b) and `src/lib/storage/blob-audience.db.test.ts` (the R6 catalog rule) — F289's catalog tests name the third private consumer and now pin the **exact set** of six FKs into `blob_assets`, so a seventh is a deliberate edit, never a silent pass.
- `scripts/check-schema-parity.ts` — the `architectural` `extra_fk` row for `reimbursement_attachments`.
- `docs/work-log/treasury-inc1.integration.patch` — re-cut (below).

### The FK as built

```sql
alter table reimbursement_attachments add constraint reimbursement_attachments_blob_fk
  foreign key (blob_key, organization_id, asset_audience)
  references blob_assets (id, organization_id, audience) on delete no action on update no action;
create index if not exists reimbursement_attachments_blob_idx
  on reimbursement_attachments (organization_id, blob_key);
```

It targets `blob_assets_id_org_audience_key` (asserted by `conindid`), is validated, not deferrable, and all three columns are NOT NULL. In English: a receipt row can only name a blob that belongs to the same organization **and** is stored `private`. A `public_site` image (even the org's own), another organization's blob, and a key that names nothing are refused on every connection, the owner included. While any receipt row names a blob (live **or detached**, and receipt rows are never deleted), that blob cannot be deleted. Deleting the whole organization still works. That restatement matches Phase 3 ("Receipts and the F289 audience API") and F289 R1 step 8.

### Deviations (named; each in the 0073 header)

- **D10, the guard's position.** Phase 3 put the 0072 guard as "the first statement in the attachments section". 0073 has no transaction and is applied without `-1`, so a guard there would leave 1a–1c built on a database without 0072. It is the first statement of section 1 instead, and raises `reimbursement 0073: apply 0072 (blob_assets audience) first` (SQLSTATE 42704) before anything is created. Proven: inside a transaction never committed, `drop constraint blob_assets_id_org_audience_key cascade`, then the whole 0073 file. It raised at 0073:127, the probe table created just before it did not survive, and the snapshot was unchanged after.
- **D7 kept and tightened, not removed.** `attach_receipt` still pre-checks the blob, now including `audience = 'private'`, so the tenant path answers the named `invalid_shape` and never a raw 23503 from inside a definer. It is also the only place the content type and byte size are matched. Mutation check: with the audience line removed from the function, 73g's public_site case raised `23503 … reimbursement_attachments_blob_fk` as presby_app. The FK binds the definer path on its own, and the restore brought the source hash back.
- **The mirror declares no `foreignKey()`** (Batch 1a's TODO said one "lands with the FK"). DECISION-058 says `assets.ts` is imported by the storage adapter and nothing else; `giving_statements_blob_fk` is the precedent. So the FK is DDL-only, with the parity `extra_fk` row and the schema test's `DDL_ONLY` exemption. Phase 3's "schema-parity rows for … the receipt FK" asked for exactly this.
- **The new index** `(organization_id, blob_key)` is not in the Phase 3 text. Without it, every `blob_assets` delete (the org-teardown cascade) seq-scans attachments for the RI check. `giving_statements_blob_idx` is the precedent.

### test-rls sections

- **73a** + 1: the FK's name, columns, target key, NO ACTION both ways, validated.
- **73g** (new, 8 assertions, as presby_app): presby_app stores a `public_site` jpeg at Alder and a private jpeg at Bramblewood (under Bramblewood's context, then switches back). `attach_receipt` answers `invalid_shape` with a null id for the public_site blob, the foreign blob and a missing key. Preflight shows 0 attached. Then the same request takes Alder's own private jpeg of the same type and size (not vacuous), and preflight shows 1.
- **72b**: the non-vacuity count 2 → 3 (with the receipt FK) and an exact count of 6 FKs into `blob_assets`.
- **Failing-first, on this branch before 0073 was re-applied:** the whole file failed at 73a, `test-rls-73.sql:166 … expected 1, got 0` (no FK). 73g run alone failed at its public_site case, `expected 1, got 0`, meaning the old 0073 attached a public_site blob. The Vitest side had 6 failures: the catalog shape (`expected undefined`); the public_site, foreign-org/missing-key and NO ACTION delete cases (`expected a refusal`); the definer's public_site case (`outcome: 'ok'`); and F289's catalog rule (the exact-set check). The pure schema test, run against the HEAD text of 0073, had 4 failures. The CHECK test and the teardown test passed both ways, as expected: the CHECK predates 1b, and the teardown test is a regression guard for NO ACTION during the cascade.
- After the re-apply: **test-rls-73 61 passes** (52 before), exit 0; **test-rls-72 25 passes**, exit 0. Both run as presby_app.

### Integration patch (`docs/work-log/treasury-inc1.integration.patch`)

Re-cut from edits applied locally to the merged tree, then reverted. **All six hunks pass `git apply --check` against HEAD (`852e97d`) with no offset or fuzz.**
1. `drizzle/meta/_journal.json`: idx 73, 74 **after idx 72**. Each `idx` matches its file number and each `tag` its filename. The `when` values continue 0072's series (+1 day each).
2. `scripts/seed-dev.sql`: the treasury include after the parishes include.
3. `scripts/test-rls.sql`: DECISION-152's template count 6 → 7 (0068 added no template role; main still says six), and the section-73 include after section 72's.
4. `src/lib/db/domain/index.ts`: the export.
5. `CLAUDE.md`: Batch 7's hunk, unchanged.
6. **New: `src/lib/dev-docs.ts`**: the six tables under MODULES `T. Reimbursements`. Main's F283 test (`017e0b6`, arrived with this merge) classifies every exported table. It is not a Rule 16 file, but it must land with the export. Committing it alone would add a second red test on the branch; without it, applying the patch fails "every table is in MODULES". With the patch applied, `dev-docs.test.ts` plus the developer pages pass (16 files, 125 tests) and typecheck exits 0.

With the patch applied locally: `check:schema-parity` compared 91 tables with 8 differences, all allowlisted architectural rows, and 0 failing. With the new row removed it reports 1 failing, so the row is what closes it. The full `scripts/test-rls.sql` ran as presby_app from a temporary copy without its top-level `ON_ERROR_STOP` and reached "Section 73 complete": **1,451 passes, 3 failures**. These are the same three inherited data-drift assertions Batch 1a recorded on this branch (the Northern Reach demo membership, Alder's `require_two_factor`, and the extra `statistics.publish` roles). None involves 0072, 0073 or 0074.

### Gates

- `npm run typecheck` 0; `npm run lint` 0; `npm run check` 0 (nine tripwires).
- `npm run test`: 677 files passed, 102 skipped; 10,230 tests passed, 2,953 skipped, **1 failed**: `src/lib/dev-docs.test.ts` "sees the same tables in the exports as are declared in the schema files". It is the merge's semantic consequence described above. It is unavoidable on the branch while the `index.ts` export is held for integration (Rule 16), and green with the patch.
- DB suites, serial (`--no-file-parallelism`, no e2e running): `src/lib/reimbursement`, `src/lib/treasury`, `src/lib/db/domain/reimbursement*`, `src/lib/storage`, `src/lib/db/domain/blob-audience*`, `src/lib/giving/team.db.test.ts`, `designation-parity.db.test.ts`: **47 files, 749 tests, green.**
- Not run: e2e (no UI, route or fixture-shape change; receipts are not wired until 2b). The teardown path the e2e fixtures use is proven at the database level by the cascade test.
- Migration mode: **hand-written**, `drizzle/0073_presby_reimbursements.sql` corrected in place (unreleased). Local apply: `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0073_presby_reimbursements.sql`, then 0074, on a database that already has 0072. The `_journal.json` entries are in the integration patch, not committed (Rule 16).

### Handoff for Batch 2b (api-developer): receipts

- **Store, then attach.** Call `getBlobStore().store(…, "private")` with a string literal, never a variable (F289 R6). Then `presby_reimbursement_attach_receipt(request, blob_key, content_sha256, content_type, byte_size, display_name, actor)`. The blob must be **this organization's `private` row**, and `content_type` and `byte_size` must equal the **stored** row: the re-encoded JPEG's size, not the upload's. Anything else is `invalid_shape`. `content_sha256` is the hash of the bytes **as received** (the duplicate flag) and is not compared to `blob_assets.content_hash`.
- **A 23503 from attach is a bug, not an outcome.** The pre-check answers first, and audience is immutable (0072 trigger). Map it to the generic failure; do not word it for the member.
- **Dedup:** `store()` dedups within (org, audience, hash). Two requests with byte-identical re-encoded receipts share one blob and have two attachment rows. The same bytes attached twice to one request is `duplicate_in_request`. A public image with the same bytes is a different row and can never be returned for a receipt (F298).
- **Nothing may delete a referenced receipt blob**, even after a detach (NO ACTION, owner path included). An orphan-cleanup job, if one is ever written, may only touch `private` blobs that **no** row of any of the three private consumers names. The unreferenced blob left by a failed attach (the recorded residual) is the only deletable case.
- **Tests:** the fixture's `blob(org, type, audience)` creates either audience. For `seedReceipt` in `e2e/support/reimbursement-fixture.ts`, an SQL insert that omits `audience` lands `private`, which is correct. Org teardown (`delete from organizations`) works with receipts attached (proven).
- Still yours from Batch 7's list: tighten T5 to "exactly one" `sharp` importer; F289's source-scan rows for `receipts.ts` (`store` / `resolve`, literal `private`); the upload response's `revision`; the Vercel `sharp` preview build.

### Loop-back candidates and notes (orchestrator)

1. **The one red unit test on the branch** (`dev-docs.test.ts`, F283) clears only at integration. QA should run the unit suite with the integration patch applied, or record it as the known integration-held failure.
2. `docs/TODO.md` (orchestrator): close the "Batch 1b receipt FK" line suggested by the Batch 1a patch header. The patch header no longer carries suggested TODO lines.
3. The D10 guard position and the tightened D7 pre-check are departures from the Phase 3 text. Neither changes behaviour beyond the design's intent. Tech-lead to confirm.
