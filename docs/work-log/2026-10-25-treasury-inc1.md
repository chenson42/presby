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
| 3 — Technical design | tech-lead | Complete; implementer named per batch; eight items need a confirmation (see "Needs a confirmation"; two depart from a Phase 2 note) | Design complete | 2026-10-25 |
| 4 — Implementation | database-admin, api-developer, ux-developer, full-stack-developer (Batches 1–7) | Batch 1a complete (database-admin): 0073 (minus the receipt FK), 0074, mirror, test-rls-73 (52), 83 new Vitest tests. **Batch 2a complete (api-developer)**: shared csv/session/keys, treasury team path + giving wrapper, catalog entry, tiles, off-warning, 12 audit keys, `src/lib/reimbursement/` (pure modules, three gates, requests, reads, config, pickers), member actions without receipts, the team.db fixture ruling applied; 285 new tests; three copy gaps reported (see the Batch 2a section). Batches 1b, 2b (waits on F289), 3–7 pending | — | 2026-10-25 |
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
| `reimbursement.notice.requester_update` (variants) | the creator | `Your reimbursement request was approved` / `…was sent back` / `…wasn't approved` / `…was paid` / `…was closed` | `It is now waiting for payment.` / `It needs a change before it can go on. Open it to see why.` / `Open it to see why.` / `A payment has been recorded for it.` / `Open it to see what happened.` | `Open the request` |

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
