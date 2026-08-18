# 2FA: Kill the Duplicate Surface, Make the Requirement Per-Church — Work Log

> **Slug:** `2026-08-18-two-factor-policy`
> **Surface:** (admin) + auth path + schema
> **Permission(s):** new `FEATURES.ADMIN_TWO_FACTOR` (`admin.two_factor`)
> **Flag(s):** existing `auth.require_2fa` master switch, semantics preserved
> **Estimated complexity:** medium
> **Pipeline mode:** Full — auth-touching, so the Phase 4 gate requires a
> running-server e2e smoke including the MFA-enrolled fixture before Phase 5

> **Agent note:** operator instruction in effect not to spawn subagents; phases
> executed inline.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (inline) | Complete | READY WITH NOTES | 2026-08-18 |
| 2 — Architectural review | architect (inline) | Complete | Approved with suggestions | 2026-08-18 |
| 3 — Technical design | tech-lead (inline) | Complete | — | 2026-08-18 |
| 4 — Implementation | full-stack-developer (inline) | Complete | — | 2026-08-18 |
| 5 — Verification | qa (inline) | Complete | PASS | 2026-08-18 |
| 6 — Shipped vs intent | analyst (inline) | Complete | SHIP IT | 2026-08-18 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> `/admin/2fa` is a second copy of the self-enrolment page wearing an admin
> badge, and the 2FA requirement is a single install-wide switch when it needs to
> be a per-congregation one.

## Operator intent

> "2FA is def needed, however i want it to be super simple and maybe optional
> per church as i have had older people have issues with it."

Two separable problems, both in scope by operator decision:

1. **The duplicate surface.** `/admin/2fa` operates entirely on
   `session.user.id`: enrol yourself, regenerate your own recovery codes, reset
   your own enrolment. It duplicates `/account/2fa` — the admin nav even labels
   it "Your 2FA", which gives the game away. It also carries security finding M5:
   its four exported actions have no `hasFeature` gate.
2. **The requirement is install-wide.** `auth.require_2fa` is a row in
   `feature_flags`, and that table has no `organization_id`. One congregation
   cannot require 2FA while another does not.

## Correction to an earlier claim in this session

I previously told the operator there was **no way for an admin to reset another
user's 2FA**. That was wrong, and it was wrong because I had read `/admin/2fa`
and not `/admin/users/[id]`. `forceResetTwoFactor` and `setTwoFactorRequired`
already exist in `src/app/(admin)/admin/users/[id]/actions.ts`, both audited,
both gated by `requireAdminUsers()`. The recovery path for the stranded-member
case is built.

What this changes: `/admin/2fa` does not need to become reset tooling — that
exists. It becomes the thing that genuinely does not exist, the per-church
policy surface, and the duplicate self-enrolment goes away.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| platform admin | set whether a congregation requires 2FA | rare |
| platform admin | see which users are required but not enrolled | occasional |
| platform admin | reset a stranded member's 2FA (existing, `/admin/users/[id]`) | occasional |
| member | enrol / manage own 2FA (existing, `/account/2fa`) | once, then rare |

## Flows

**Flow 1 — a congregation turns 2FA on.** Platform admin opens `/admin/2fa` →
sees every organization with a requirement toggle → toggles a congregation on →
audit event written → members of that congregation are required to enrol at
their next sign-in.
- Failure: toggle fails → inline error, no partial state (single-row update).

**Flow 2 — an older member is stranded.** Member loses their phone → cannot
complete the TOTP challenge → admin opens `/admin/users/[id]` → Reset 2FA →
member enrols fresh on next sign-in.
- Already built; this pipeline only makes it findable by listing who is
  required-but-not-enrolled.

## Gaps the Request Didn't Address

- **A person can belong to more than one organization.** A minister is a member
  of the presbytery while serving a congregation. If the two disagree about 2FA,
  something must win. **Most-restrictive wins**: if any organization the user
  holds an active membership in requires 2FA, they are required. Chosen because
  the requirement is resolved at *sign-in*, before any organization has been
  selected — there is no "current org" to consult yet.
- **"Super simple" is not addressed by this pipeline.** TOTP remains the only
  factor, and TOTP is exactly what older members struggle with. The genuinely
  simple alternative — an emailed one-time code, which needs no new dependency
  because the durable email queue already exists — is a separate design. Recorded
  in `docs/TODO.md` rather than smuggled in here.
- **Trusted-device already exists** and is the biggest usability win for the
  population in question: a code once per device, not once per sign-in.

## Out of Scope

- Emailed OTP as an alternative second factor (see above).
- A church-facing settings page. No church-facing admin UI exists at all yet, so
  the toggle lives in the platform admin shell and moves later.

## Open Questions

None blocking.

---

# Phase 2 — Architectural Review (architect)

## Verdict

Approved with suggestions.

## Placement

- `/admin/2fa` route is **kept** and repurposed as the policy page; the
  self-enrolment page and its actions are deleted. Keeping the route means the
  admin nav entry, dashboard card, and e2e subpage walk all keep working with a
  label change rather than a removal.
- Server components throughout; one small client component for the toggle form.

## Invariants Touched

**1. Isolation is a database property.** Listing every organization from the
tenant connection returns **zero rows** — RLS filters to the org GUC, and no org
context is set on an admin page. This page therefore uses `getPlatformDb()`,
which is precisely what the second connection exists for. Any attempt to make
this work on `db` would mean weakening a policy.

**2. A trigger — or a function — that must see across orgs needs
`SECURITY DEFINER` (F26).** The sign-in-time lookup "does any organization this
user belongs to require 2FA?" runs on the RLS-enforced connection with no org
context. Read naively it returns zero rows *for exactly the case it guards* —
the F26 failure mode, repeated. It must be a `SECURITY DEFINER` function, the
same shape as the existing `presby_available_organizations(uuid)`.

**3. The Edge gate cannot reach the database.** `src/proxy.ts` decides the 2FA
redirect from session claims only. The per-church requirement must therefore be
resolved at sign-in and projected into the JWT — which is exactly where
`computeEffectiveTwoFactor` already sits. No proxy change.

**4. Permissions vs flags.** The per-church requirement is **tenant state**, not
an environment toggle, so it does not go in `feature_flags` (DECISION-003). It is
a typed column on `organization_settings` — org.ts already draws that line:
`organizations` is deliberately NOT tenant-isolated because the PC(USA) org tree
is public, and per-org configuration lives in settings. The existing
`auth.require_2fa` flag keeps its current meaning: an install-wide master switch
that can turn the whole thing off.

## Notes for Phase 3

- Fail-open semantics from DECISION-026 must survive: a DB error while resolving
  the org requirement must not newly *require* 2FA (that would strand users on a
  blip). Fall back to the user's own column, as the current code does.
- A typed column on `organization_settings`, not a key inside its `settings`
  jsonb. This one is read on the sign-in path, and a boolean that decides whether
  2FA is enforced should be constrained by the database rather than by whatever
  last wrote the blob.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Delete the duplicate self-enrolment surface; add a per-organization 2FA
requirement resolved at sign-in through a `SECURITY DEFINER` function; give the
freed `/admin/2fa` route to the policy UI.

## Permissions & Flags

- New permission key `FEATURES.ADMIN_TWO_FACTOR` = `admin.two_factor`, added to
  `FEATURE_CATALOG` and bound to the admin role by the seed.
- Flag `auth.require_2fa` unchanged.

## Data Model

```sql
alter table organization_settings
  add column require_two_factor boolean not null default false;

create or replace function presby_two_factor_required(p_user_id uuid)
returns boolean
language sql stable security definer as $$ ... $$;
```

`default false` matters: every existing congregation keeps today's behavior, and
2FA becomes opt-in per church exactly as asked.

## API Contract

- `setOrganizationTwoFactor({ organizationId, required })` — server action,
  gated on `ADMIN_TWO_FACTOR`, writes `AUDIT_ACTIONS.ORG_2FA_POLICY_CHANGED`,
  platform connection.

## Component / Page Plan

- Rewrite `src/app/(admin)/admin/2fa/page.tsx` — organization list with toggles,
  plus a "required but not enrolled" section linking to `/admin/users/[id]`.
- Rewrite `src/app/(admin)/admin/2fa/actions.ts` — one gated, audited action.
- Delete `totp-enroll-form.tsx` / `regenerate-codes-form.tsx` usage from the
  admin route (they belong to `/account/2fa` and stay there).

## Implementation Order

1. Migration + Drizzle column
2. `presby_two_factor_required` function
3. `computeEffectiveTwoFactor` extension + unit tests
4. Permission key + seed binding + audit key
5. Admin policy page + action
6. Legacy cleanup (dead `prepareEnrollment`, `PENDING_TTL_MINUTES`, nav labels)
7. `AUTH_TOTP_ENCRYPTION_KEY` graceful failure
8. e2e updates + full suite

## Edge Cases & Risks

- User with no `people` row (platform admin who is nobody's member): function
  returns false; their own column still governs.
- Existing JWTs keep the old claim until refresh — same known gap already
  documented for `forceResetTwoFactor`.
- Deleting the admin enrolment page while an admin has a *pending* enrolment
  started there: the pending row is keyed by user, and `/account/2fa` reads the
  same table, so the flow continues uninterrupted.

## Implementer

full-stack-developer (inline).

---

# Phase 4 — Implementation

## Files Created

- `drizzle/0013_presby_two_factor_policy.sql` — the column and the
  `SECURITY DEFINER` resolver (registered in `drizzle/meta/_journal.json`)
- `src/app/(admin)/admin/2fa/policy-toggle.tsx` — client island for one
  congregation's requirement

## Files Modified

- `src/lib/db/domain/org.ts` — `requireTwoFactor` on **organizationSettings**,
  not `organizations`. The file states its own rule: the org tree is public
  information and per-org configuration lives in settings. A typed column rather
  than a key in the `settings` jsonb, because it is read on the sign-in path and
  a boolean that decides whether 2FA is enforced belongs to the database.
- `src/lib/auth/local-login.ts` — `organizationRequiresTwoFactor()` +
  `computeEffectiveTwoFactor(raw, userId?)`
- `src/auth.ts` — passes the user id; comment records why the arm is a function
- `src/lib/permissions.ts` — `FEATURES.ADMIN_TWO_FACTOR` + catalog entry
- `src/lib/audit.ts` (+ `audit.test.ts` catalog) — `ORG_2FA_POLICY_CHANGED`
- `src/app/(admin)/admin/2fa/{page,actions}.tsx|ts` — **rewritten**: policy list
  and "required but not enrolled", replacing the duplicate self-enrolment
- `src/app/(admin)/admin/{layout,page}.tsx` — "Your 2FA" → "2FA policy"
- `src/app/(account)/account/2fa/actions.ts` — dead `prepareEnrollment` and the
  shadowing `PENDING_TTL_MINUTES` removed
- `src/lib/two-factor.ts` + `(account)/account/2fa/page.tsx` —
  `isTotpConfigured()` and a configuration notice instead of a runtime crash
- `scripts/seed-dev.sql` — a fixture user linked to a person, and
  `require_two_factor` true on Alder / false on Bramble
- `scripts/test-rls.sql` — three new assertions (below)
- `e2e/admin-login.spec.ts` — new label, plus a test that the policy page
  renders its table rather than the permission-denied card

## Schema Changes

`organization_settings.require_two_factor boolean not null default false`, and
`presby_two_factor_required(uuid)`. Applied via
`psql -f drizzle/0013_presby_two_factor_policy.sql`.

## Audit Events

`org.2fa_policy.changed` on every policy write, with the new value.

## Implementer Notes

The column landed on `organizations` first and was moved to
`organization_settings` before commit, on the file's own stated architecture.

Security finding M5 (four ungated exports on this route) is resolved by
deletion: the four actions are gone, and the one that replaced them is gated on
`ADMIN_TWO_FACTOR` with a regression test naming M5. The duplicated
recovery-codes helpers are likewise resolved by deletion rather than extraction
— there is now one implementation, so there is nothing to share.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-18
**Verified by:** qa (inline)

## Type Check / Lint / Build / Tripwires

`typecheck` PASS · `lint` PASS · `build` PASS · `check:audit` PASS ·
`check:sql-date` PASS

## Unit Tests

**434 passed, 0 failed** (was 424; +10). New coverage:
- 9 on `setOrganizationTwoFactorAction` — unauthenticated, ungated (**explicit
  M5 regression**), three malformed-UUID cases, no-row-returned, platform
  connection used, audit written, and the off direction
- 6 on the per-church arm of `computeEffectiveTwoFactor`

## The assertion that actually matters

Unit tests mock the database, so none of them prove the SQL is right — and the
failure mode here is silence. Verified against the real database as
`presby_app`, with **no org GUC set**:

```
select presby_two_factor_required(<user>)        →  t
select count(*) from memberships m
  join organization_settings s using (…)
 where s.require_two_factor                      →  0
```

The function sees the requirement; the equivalent naive join sees **nothing**.
Written as a Drizzle join, this feature would have silently protected nobody —
F26 exactly. Both are now permanent assertions in `scripts/test-rls.sql`, along
with one for a user linked to no person.

**Isolation suite: 39 assertions passing, 0 failures** (was 36), run as
`presby_app`.

## End-to-End Tests

**49 passed, 0 failed, 0 skipped** against a real dev server, including the
MFA-enrolled fixture — the Phase 4 auth gate. The new spec asserts the policy
page renders its Congregations table, because the permission-denied card shares
the same `h1` and a heading assertion alone would pass either way.

## Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct key? |
|---|---|---|---|
| `/admin/2fa` (page) | yes | yes | `FEATURES.ADMIN_TWO_FACTOR` |
| `setOrganizationTwoFactorAction` | yes | yes | `FEATURES.ADMIN_TWO_FACTOR` |

Verified by reading the bodies, not by inferring from green tests.

## Verdict

PASS

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP IT

## ONE-LINE TAKE

> Enrolment happens in one place, congregations opt into 2FA one at a time, and
> the arm that resolves it at sign-in is provably not the silent no-op that
> finding F26 warned it would be.

## Intent-vs-Shipped Diff

- Phase 1 said: delete the duplicate, make the requirement per-church. Shipped:
  both, plus the `AUTH_TOTP_ENCRYPTION_KEY` crash fix carried from the e2e
  pipeline, and a fixture-user link that the isolation suite needed. Verdict:
  matches.
- Phase 1 said the operator's "super simple" concern is **not** addressed by
  this work, and it still is not — TOTP remains the only factor. That was
  explicit in the plan, not discovered late.

## Edge Cases

- Empty state: both tables have one ("No organizations yet", "Nobody is required
  without being enrolled") — pass
- Failure microcopy: toast names the congregation and says members are asked at
  next sign-in — pass
- Permission gate: denial card instead of a crash, e2e-verified past it — pass
- Audit event: `org.2fa_policy.changed` with the new value — pass
- Mobile (360px): tables inherit the existing admin table styling used by
  `/admin/flags`; no new layout primitives — not separately verified

## Follow-Ups

- Emailed one-time code as an alternative factor for members who cannot manage
  TOTP — the operator's actual "super simple" ask → `docs/TODO.md`
- The policy toggle lives in the platform admin shell because no church-facing
  admin UI exists yet; it moves to the congregation's own settings when one does
  → `docs/TODO.md`
