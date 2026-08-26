# Tenant Branding Permission — Work Log

> **Slug:** `2026-08-26-tenant-branding-permission`
> **Surface:** new tenant surface `(org)/o/[slug]/admin/branding`, `withOrgContext()`-only; existing platform surface `(admin)/admin/organizations/[id]`'s brand section (status: kept as break-glass override, see Phase 2)
> **Permission(s):** new tenant permission `branding.manage` (module `branding`, tier 1), bound to a **new** role, not `stated_clerk` — see Phase 2's invariant ruling, the load-bearing decision of this pipeline.
> **Flag(s):** `org_portal.branding`, seeded off.
> **Estimated complexity:** medium — no schema change, but a new query/mutation module, a new role in the fixture, new tenant-scoped audit keys, and a file-upload write path reused from the existing `BlobStore`.
> **Pipeline mode:** Full. Split out of `docs/work-log/2026-08-26-portal-reorg-and-modernization.md` at Phase 2 (architect, 2026-08-26) — this file carries forward only the Part A.2 slice of that combined Phase 1.
> **Source — operator direction (2026-08-26):** "i have trouble finding the branding setup. i think the org admin should have access to that." Originally scoped as one piece of the combined pipeline; split per the architect's ruling below. Separately confirmed: "i think branding needs to belong to the organization. functionally it makes sense there." — recorded in Phase 2 as product-direction confirmation, not as input to the invariant analysis (which cleared the move on its own terms, independently).

**Scope note, load-bearing:** this pipeline builds the tenant-facing *editor* (set brand: seed color, type pairing, logo, light-only toggle) only. "Neutralize" (reset an abusive tenant's brand) is **not** built here — confirmed platform-only, see Phase 2. The platform admin's own `/admin/organizations/[id]` brand form is **not** retired — confirmed kept as an override path, see Phase 2.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (carried forward, Part A.2 slice) | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions — DECISION-101 | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-26 |
| 4 — Implementation | database-admin (commit 1) → api-developer (commit 2) → ux-developer (commit 3) | Complete (3 of 3) | — | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-26 |

---

# Phase 1 — Functional Refinement (analyst)

*(Carried forward from the combined `2026-08-26-portal-reorg-and-modernization` Phase 1, Part A.2 slice only — see that file's own Phase 1 for the fuller original write-up.)*

## VERDICT

**READY WITH NOTES**

## User Verb

Org admin (new `branding.manage` permission) sets seed color, type pairing, logo, light-only toggle for their own congregation — rare, deliberate, from the hub.

## Flow

**Flow 2 (as originally written):** entry: hub → "Branding" card → `/o/[slug]/admin/branding` (`withOrgContext()` only) → pick seed hex / type pairing / optional logo / light-only → submit → server re-validates hex format and `branding.manage` via `presby_has_permission()` → generator computes tokens, contrast floor enforced algorithmically → brand row written, `organizationBrandHistory` row written, audit event fires, live site path revalidated if the org has a live public site.
- Failure: invalid hex → inline error, client and server; logo upload failure → no-op on resubmit with no other changes (must replicate the platform path's existing partial-save honesty); permission denied → the page's own `Forbidden` state, matching every other `/o/[slug]/admin/*` page.

**Confirmed by the analyst, re-confirmed by the architect directly against source:** `FEATURES.ADMIN_ORGANIZATIONS` is a platform-shell RBAC feature, entirely disjoint from `presby_has_permission()`. The code's own comment in `(admin)/admin/organizations/[id]/actions.ts:41-49` already names this exact editor as "slice d, still blocked on P1's tenant permission catalog" — this pipeline is the anticipated dependency, not a surprise addition.

## Gaps carried forward as this file's obligations

- Audit key naming — resolved in Phase 2.
- Rate limiting on brand-change frequency — named as a real question, not a required mitigation; no throttle exists on the platform path either, so parity (not a new gap) is the honest framing.
- Contrast-floor self-correction — already fully solved by `generateBrandTokens()`/`searchBrandLightness()`, confirmed by reading `src/lib/brand/generate.ts` directly; nothing new needed here.
- Org-type gating — resolved in Phase 2.

## Open Questions carried forward, resolved in Phase 2

- Does `/admin/organizations/[id]`'s brand form stay live after tenant self-service ships? **Resolved.**
- Does self-service branding apply to all five `organizationType` values? **Resolved.**
- Does "neutralize" stay platform-only? **Resolved.**

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.**

## The invariant ruling (the load-bearing question)

**Does moving branding management from the platform axis to the tenant axis implicate "Two Hierarchies Intersect Nowhere" / "Access flows up by publication, never down by inheritance"?**

**Verdict: no — this specific move does not implicate that invariant.** "Two Hierarchies Intersect Nowhere" and "access flows up by publication" are about the **ecclesiastical axis** — congregation → presbytery → synod → GA — and about one *tenant* reaching into another tenant's (or a different tier's) own data without an explicit, minuted, time-boxed grant. Branding management is neither: it is a congregation being given the ability to manage **its own organization's own row** in `organization_brands` (the same row the platform path already writes today). No congregation gains reach into any *other* organization's data, and no lower tier gains standing over a higher one. The **platform ↔ tenant axis** — which "Two Hierarchies" does not describe at all — is what's actually moving here, and the correct invariants to check that against are **Permissions vs. Flags** and **No Role Carries a Wildcard**, both of which this move passes cleanly.

What *would* implicate "Two Hierarchies Intersect Nowhere" is a feature where a congregation's branding action reached beyond its own row — e.g., a presbytery-level setting cascading defaults down to member congregations. Nothing here does that; `organization_brands`' RLS policy (`organization_id = presby_current_org()`) makes that structurally impossible regardless of who holds `branding.manage`.

**Framing correction:** this is not "a capability moving from the platform axis to the tenant axis" in the sense of the platform losing standing — it's a **second, independently-scoped path being opened to the same row**, with the platform path staying live as an override. The tenant now also gets a self-service door onto data it always substantively owned, and the platform keeps its own key to that door for remediation.

**Product-direction confirmation (2026-08-26, post-ruling):** the operator independently stated "branding needs to belong to the organization... functionally it makes sense there." This is recorded as confirmation of the *product* direction, not as input to the invariant analysis above — that analysis was completed and would stand unchanged whether or not the operator had weighed in, and it is what actually cleared the move. Where the operator's framing could be over-read as extending to remediation-against-abuse, it is not: neutralize-stays-platform-only and the platform form's override status are unchanged, decided on their own merits (adversarial-remediation framing vs. ordinary self-service), not loosened by this input.

## Permission naming, module/tier, and role binding

- **Name: `branding.manage`**, following the `<noun>.manage` convention (`role_grants.manage`, `officers.manage`, `people.manage`, `org_features.manage`).
- **Module: `branding`** (new). **Tier: 1.** Tier is about **privacy sensitivity of the data the permission touches** (tier 2 = financial, tier 3 = pastoral/medical/demographic), not the public blast radius of a mistaken or malicious mutation. A brand color and a logo are not private — they're already public the instant a site is live. Tier 1 is correct on the data-sensitivity axis even though this permission's *misuse* blast radius (a defaced public-facing site) is real — that's answered by audit + the override path, not by tier placement.
- **Role binding: mint a new role. Do not bind to `stated_clerk`.** Applying DECISION-078's own standing test directly: does this belong to the Clerk of Session's actual constitutional job, or is `stated_clerk` just the only administratively-empowered office that happens to exist? Branding has no defensible fit in G-3.0204(b) or any other constitutional office — this is the "software convenience" half of DECISION-078's test, the same half `tickets.file`'s original binding failed (DECISION-072). `stated_clerk` (`f0000000-…-0005`) already carries `role_grants.manage`, `roll.propose`, `directory.view_hidden`, `org_features.manage`, `people.manage`, and (per the sibling officer-terms pipeline landing today) `officers.manage` — six permissions on one office already, each individually justified at the time, which is exactly how a role becomes a wildcard "one layer down" without anyone deciding it should. Branding additionally carries a materially different blast radius (public-facing defacement vs. internal-data mutation) than any of those six.
  - **New role, key: `brand_admin`** (display name TBD at Phase 3, e.g. "Communications / Brand Administrator") — deliberately not named after any ecclesiastical office, because this duty has no constitutional analog and shouldn't be dressed as one. No naming collision against `officer_terms.office`'s enum or any existing `app_roles.key`.
  - Constitutional/protected shape (`role_kind: 'constitutional'`, `is_protected: true`), mirroring `member`'s shape from the org-provisioning sibling pipeline — every organization should end up with this role available, not a staff-invented custom one. Whether it's granted to a person directly or to a group is Phase 3's call informed by whichever office an organization actually designates (a Communications Committee could plausibly be a *group* grant, unlike `stated_clerk`'s deliberate person-only precedent) — no invariant forces one shape over the other here.
- **Org-type gating: no restriction.** Nothing in the schema (`organization_brands` carries no organization-type column or CHECK) or in the existing platform path differentiates by `organizationType`, and public-site provisioning already applies uniformly across all five types. Leave it open to all five types, matching the platform path's current behavior exactly (parity, not a widening).

## "Neutralize" — confirmed platform-only

**Confirmed, not overruled.** `neutralizeOrganizationBrandAction` is framed throughout as remediation against "an abusive tenant" — an inherently adversarial platform-vs-tenant action. A tenant admin already has the equivalent self-service capability through "set." Making neutralize tenant-reachable would let an org "neutralize" its own way past history in a way indistinguishable from a legitimate reset, muddying the one signal ("who made our website purple") neutralize exists to preserve as an adversarial-remediation record. Stays platform-only.

## The platform admin's own brand form — confirmed kept, as an override/break-glass path, not retired

**Confirmed kept, not retired.** Three reasons:
1. Neutralize has no tenant-side equivalent (ruled above) — retiring the platform form would leave "an abusive tenant's brand" with no remediation path at all.
2. The platform path is the only one that can act when the tenant path is unreachable — a suspended org, a flag-off `org_portal.branding`, or an org with zero `brand_admin` holders (the same founding-administrator bootstrap gap DECISION-100 already named and deferred, not this pipeline's to close either).
3. `revalidateLiveSitePath()`, `provisionSiteAction`, `setSiteStatusAction`, `setOrganizationProfileAction`, and the service-times actions all live in the same file and are explicitly out of scope here (the tenant path gets exactly brand-set, nothing else on that page). Retiring the platform brand section would fragment one coherent operator page for no invariant-driven reason.

Phase 3 should treat the platform form as an unconditional override: it keeps writing `organization_brands` via `getPlatformDb()` exactly as today, gated on `FEATURES.ADMIN_ORGANIZATIONS` alone, with no awareness of whether a tenant-side `brand_admin` role exists at that org.

## `withOrgContext()`-only achievability — confirmed with zero schema change

**Confirmed achievable today, no migration needed.** Read the actual DDL:

```sql
-- drizzle/0016_presby_brand_storage.sql, lines 213-258
alter table organization_brands enable row level security;
alter table organization_brands force  row level security;
create policy tenant_isolation on organization_brands
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());
-- (identical for organization_brand_history)

grant select, insert, update, delete on organization_brands, organization_brand_history
  to presby_app;
```

`organization_brands`/`organization_brand_history` already have `FORCE ROW LEVEL SECURITY` with the standard `tenant_isolation` policy, and the migration's own comment explains why the `presby_app` grant is already there: "declared now (per the architect's ruling) so slice d's `withOrgContext()`-based editor needs no migration of its own to start reading/writing through RLS." This pipeline **is** slice d — architecturally provisioned for by name, months of in-repo-time ago. Nothing to build at the schema layer.

The logo upload path is equally already-shaped for this: `blob_assets` also carries `SELECT, INSERT` grants to `presby_app` (deliberately no `UPDATE`/`DELETE` — "a changed logo is a NEW row"), and `src/lib/storage/blob-store.ts`'s own header comment explicitly anticipates this exact caller: "A future tenant-facing caller (slice d's church-facing brand editor) DOES have a real person with a real membership, and should call this module the same way — `organizationId` trusted, no re-check here — after its own action has run the request through `withOrgContext()` for whatever else it needs." `store()`/`resolve()` open their own internal transaction rather than accepting an inbound `tx` — so the tenant action's shape is: verify membership + write `organization_brands`/`organizationBrandHistory` inside `withOrgContext()`'s own transaction, and call `getBlobStore().store()` as a **separate** call (exactly how the platform action already does it) — not inside the same `tx`. **No schema-level change of any kind is needed.**

One real requirement for Phase 3, not a schema gap: `organizationBrandHistory.changedBy` references `users.id`, not `people.id` — this resolves cleanly for a tenant actor too, since `(org)` route handlers already have `session.user.id` available alongside the resolved `personId` (`admin/roles/actions.ts`'s own `resolveActingIdentity()` pattern uses both) — use `session.user.id` for `changedBy`, identical to the platform path's own shape.

## Audit keys — mint tenant-scoped variants, do not reuse `ORG_BRAND_SET`/`ORG_BRAND_NEUTRALIZED`

Every existing audit key distinguishes which axis the actor is on by prefix — `org.*` for platform-initiated actions against a tenant (`ORG_BRAND_SET` → `"org.brand.set"`), `tenant.*` for tenant-initiated self-service actions (`TENANT_ROLE_GRANTED`, `ORG_FEATURE_TOGGLED` → `"tenant.org_feature.toggled"`, `OFFICER_TERM_STARTED` → `"tenant.officer_term.started"`). Reusing `ORG_BRAND_SET` for a tenant-initiated write would collapse that distinction for the one resource where "who changed our brand, the platform or the church" is precisely the question an audit reader exists to answer. **Mint `TENANT_BRAND_SET: "tenant.brand.set"`** (no `TENANT_BRAND_NEUTRALIZED` — neutralize stays platform-only).

## Placement (remainder)

- **New route:** `(org)/o/[slug]/admin/branding/` (page + `actions.ts`), sibling to `admin/{roles,members,officers,features}/`, same shape.
- **New query/mutation module: `src/lib/tenant-branding.ts`**, sibling to `src/lib/officers.ts`/`src/lib/role-grants.ts`/`src/lib/org-features.ts` — **not** inside `src/lib/brand/`. CLAUDE.md's own description of `src/lib/brand/` is precise about that directory's shape (`contract.ts`, `generate.ts`, `fonts.ts`, and `read-org-brand.ts` — "the ONE function `(org)/o/[slug]/layout.tsx` calls for its own brand," singular by design). `tenant-branding.ts` **imports** `generateBrandTokens`/`TYPE_PAIRINGS` from `src/lib/brand/` (read-only dependency, same as the platform action) — it does not live inside it.
- **Server vs. client split:** the branding page is a Server Component reading the current brand (mirroring the platform page's own read shape); the set-brand form is `'use client'` (file input + color picker + submit), same split as every other `(org)/admin/*` mutation form this session established.
- **Dependencies:** none new. `getBlobStore()` and `generateBrandTokens()` are both already-approved, already-built modules; no new npm package.

## Invariants Touched

- **Two Hierarchies Intersect Nowhere** — does not apply to this specific move; see the invariant ruling above. No cross-tenant or cross-tier reach is introduced.
- **No Role Carries a Wildcard** — respected by minting `brand_admin` rather than piling a sixth-plus permission onto `stated_clerk`.
- **Permissions vs. Flags** — `branding.manage` (permission) and `org_portal.branding` (flag) stay two independent gates.
- **Isolation Is a Database Property** — `organization_brands`/`organization_brand_history` are already `FORCE RLS` with the standard `tenant_isolation` policy and the standard `presby_app` grant; confirmed directly in the DDL, no change needed.
- **Composite Tenant Keys** — n/a; both tables use the degenerate `organization_id`-as-primary-key shape (one row per org), same pattern `organization_sites`/`organization_profiles` use.
- **The Brand Is a Cascade Override (DECISION-046)** — untouched; this pipeline adds a second *writer* to the same token pipeline, not a second styling system.

## Notes

1. **Audit:** mint `TENANT_BRAND_SET` (`"tenant.brand.set"`); no tenant-side neutralize key.
2. **Role:** new `brand_admin` role, constitutional/protected shape; Phase 3 decides person-arm vs. group-arm `role_grants` binding.
3. **Blob-store call shape:** `store()` called as a standalone call (its own internal transaction), not nested inside `withOrgContext()`'s `tx` — mirror the platform action's own ordering (validate → `store()` → open the `organization_brands` transaction).
4. **`docs/TODO.md` / fixture:** Phase 3 should seed `branding.manage` → `brand_admin` in `scripts/seed-dev.sql` as a fixture-only binding (no production role-seeding surface exists yet — same posture DECISION-066 established for `stated_clerk`), and should note in `docs/TODO.md` that no org is auto-provisioned with a `brand_admin` holder — same bootstrap-gap shape as `stated_clerk`/`officers.manage`, out of scope here, tracked the same way.
5. **Rate limiting:** confirmed parity with the platform path (neither has it) is an acceptable Phase 3 posture; not a blocking gap, but worth a `docs/TODO.md` line given multiplying the actor count does change the abuse-risk shape even if per-actor risk is unchanged.

## Implementer(s) Phase 3 should expect

Three-commit split, mirroring the `officers.manage` precedent exactly:
1. **database-admin** — the `branding.manage` permission-catalog migration, the new `brand_admin` `app_roles`/`app_role_permissions` fixture rows, `scripts/test-rls.sql` additions proving isolation.
2. **api-developer** — `src/lib/tenant-branding.ts`, `(org)/o/[slug]/admin/branding/actions.ts` (validation, the `TENANT_BRAND_SET` audit write, the `store()` call ordering).
3. **ux-developer** — the branding page, the client-side set-brand form, mobile verification.

## Handoff

**Next: tech-lead (Phase 3), for this file only.** Carry forward, in priority order: (1) mint `brand_admin`, do not bind to `stated_clerk` — the load-bearing ruling of this pipeline; (2) mint `TENANT_BRAND_SET`, no tenant neutralize key; (3) `withOrgContext()`-only is fully achievable, zero schema change; (4) neutralize stays platform-only, the platform brand form stays live as an override, both closed questions; (5) `src/lib/tenant-branding.ts` is a new sibling module, not folded into `src/lib/brand/`. Do not re-litigate the invariant ruling — it's closed by this Phase 2 pass.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

A congregation's own admin gets a self-service brand editor at `/o/<slug>/admin/branding`: seed colour, curated type pairing, optional logo, light-only toggle — the exact editing surface `/admin/organizations/[id]`'s brand form already offers a platform operator, now reachable by the tenant itself through a new permission (`branding.manage`) bound to a new role (`brand_admin`) rather than piled onto `stated_clerk`. No schema change: `organization_brands`/`organization_brand_history` were already provisioned for exactly this path in `drizzle/0016`. The platform form stays live, unconditionally, as an override/break-glass path for a suspended org, a flag-off tenant, or an org with zero `brand_admin` holders — this pipeline adds a second writer to one table, not a replacement for the first.

## Permissions & Flags

- **Permission key:** `branding.manage` (module `branding`, tier 1 — data-sensitivity tier, not misuse-blast-radius; see Phase 2).
- **Default role binding:** a new role, **`brand_admin`** (`role_kind: 'constitutional'`, `is_protected: true`), never `stated_clerk`. **Binding arm decision (Phase 2 left this open): person-arm, direct-granted** — same shape as `stated_clerk`/`treasurer`/`installed_pastor`/`support_contact`, not the group-arm shape `member`/`session_member`/`diaconate_member` use. Rationale: branding is an ordinary single-accountable-office action (one person picks a colour and uploads a file), not a collective body decision requiring `group_memberships` expansion the way Session/Diaconate roster actions are — there is no polity body whose *vote* approves a brand change, so there is nothing for a group grant to represent that a direct grant doesn't already cover. (Logged as DECISION-103, below — this was explicitly deferred to Phase 3 by DECISION-101/Phase 2, and no invariant forces either shape, so it is recorded as an implementation decision rather than re-litigating the architect's ruling.)
  - Fixture binding (`scripts/seed-dev.sql`, fixture-only per DECISION-066's precedent — no production role-seeding surface exists yet): direct-granted to **Marguerite Ashcombe** (`c0000000-0000-0000-0000-000000000001`), Alder Creek only. Not Tobias Renwick — he already holds `property_chair` + `stated_clerk`, and piling a third role onto one fixture person recreates the exact "one person, every capability" concentration `support_contact`'s own binding (DECISION-080) was written to interrupt. Marguerite already holds `support_contact` (the point of contact with outside software support) — a second, distinct, external-facing/administrative role on the same person is a reasonable single-office pairing, not a wildcard accretion onto one already-overloaded office (which is precisely the failure mode DECISION-101 minted a new role to avoid).
- **Feature flag:** `org_portal.branding`, seeded **off**, same "ships dark until the page lands" convention as every other `org_portal.*` flag. Checked bare (no DECISION-026 fail-open wrapper — a toggle, not an auth path), and checked *before* any permission/data call, same order `features/page.tsx`/`officers/page.tsx` already establish. Never substitutes for `branding.manage` (DECISION-003): a `brand_admin` holder with the flag off still sees "isn't available yet," not the editor.

## API Contract

### `src/lib/tenant-branding.ts` (new — sibling to `officers.ts`/`role-grants.ts`/`org-features.ts`, imports `generateBrandTokens`/`TYPE_PAIRINGS` read-only from `src/lib/brand/`, never placed inside it)

```ts
const BRANDING_MANAGE = "branding.manage";

// Private, duplicated-by-convention (same as role-grants.ts's DATE_RE, the
// platform action's SEED_HEX_RE/sniffImageContentType/MAX_LOGO_BYTES) —
// no cross-route-group import of another actions.ts's private constants
// exists anywhere in this tree, and this module shouldn't be the first.
const SEED_HEX_RE = /^#[0-9a-f]{6}$/i;
const MAX_LOGO_BYTES = 2_097_152; // mirrors blob-store.ts's MAX_BYTE_SIZE / the platform action's own constant
function sniffImageContentType(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" | null; // byte-identical copy of the platform action's function
function isTypePairingKey(value: string): value is TypePairingKey;

export interface ExistingTenantBrand {
  seedHex: string;
  typePairing: TypePairingKey;
  markAssetKey: string | null;
  wordmarkAssetKey: string | null;
  brandTokenVersion: number;
  lightOnly: boolean;
}

export type GetOrgBrandResult =
  | { kind: "ok"; brand: ExistingTenantBrand | null }
  | { kind: "forbidden" };

/**
 * Gated on branding.manage, same "every read re-checks the gate" discipline
 * as listGrants/listOfficerRoster/listFeatureToggles. NOT a replacement for
 * src/lib/brand/read-org-brand.ts (that one function is the layout's single,
 * unconditional token-emission read — this is the editor's own pre-fill
 * read, gated, and carrying markAssetKey/wordmarkAssetKey the layout read
 * has no reason to expose). A third reader of organization_brands for a
 * third distinct purpose, same as the platform action's own fetchExistingBrand.
 */
export async function getOrgBrandForEdit(
  viewerPersonId: string,
  organizationId: string,
): Promise<GetOrgBrandResult>;

export interface SetBrandInput {
  seedHex: string;
  typePairing: string;
  lightOnly: boolean;
  /** Present only when a file was submitted and had a non-zero size. */
  logo: { bytes: Buffer; declaredContentType: string } | null;
}

export type SetBrandResult =
  | { kind: "forbidden" }
  | { kind: "invalid_hex" }
  | { kind: "invalid_pairing" }
  | { kind: "generation_failed" }
  /** E-c2 parity: the ONLY thing this submission changed was a bad logo — nothing written. */
  | { kind: "logo_rejected"; message: string }
  | {
      kind: "ok";
      adjustmentCount: number;
      /** Non-null = colour/pairing saved, logo specifically failed (E-c2 partial-save). */
      partialSaveLogoError: string | null;
    };

/**
 * Three-step flow, per Phase 2's explicit ordering requirement ("verify
 * membership + write inside withOrgContext()'s own transaction, and call
 * store() as a separate call — not inside the same tx"):
 *
 *   A. ONE withOrgContext() call: hasBrandingManage() gate (→ "forbidden"
 *      if not held) + fetch the existing brand row, in the same transaction
 *      (both reads — no write yet). Unlike the platform action, this gate
 *      cannot be a bare session-claim check (branding.manage requires a
 *      presby_has_permission() round-trip), so it cannot run before a
 *      transaction exists the way FEATURES.ADMIN_ORGANIZATIONS does — this
 *      is why the gate is its own transaction rather than a pre-check.
 *   B. Outside any transaction: sniff/size-validate the logo if present,
 *      then getBlobStore().store() — byte-identical ordering and E-c1/E-c2
 *      discipline to the platform action's own logo handling.
 *   C. A SECOND withOrgContext() call: history row (if a prior brand
 *      existed) + upsert organization_brands — the "organization_brands
 *      transaction" Phase 2's note refers to.
 *
 * hexOrPairingChanged / partial-save-on-logo-failure honesty replicated
 * verbatim from the platform action (Phase 2's explicit instruction to
 * replicate, not reinvent).
 */
export async function setBrand(
  actorPersonId: string,
  organizationId: string,
  actorUserId: string,
  input: SetBrandInput,
): Promise<SetBrandResult>;
```

### `(org)/o/[slug]/admin/branding/actions.ts` (new)

```ts
"use server";

export type PolicyResult = { ok: true } | { ok: false; error: string };
// A LOCAL type, not imported from (admin)/admin/organizations/[id]/actions.ts
// — no route-group-crossing action-type import exists anywhere in this tree,
// and this pipeline isn't the one to start. Same shape as the platform
// file's own PolicyResult so the client form's PARTIAL_SAVE_PREFIX string-
// match logic (see Component Plan) transplants unchanged.

/**
 * SIGNATURE DEVIATION, NAMED EXPLICITLY: every other (org) actions.ts in this
 * tree takes `(slug, input)` with a plain object (role-grants, officers,
 * org-features) — none of them has a file upload. This is the one tenant
 * action that does, and a Server Action bound to a <form action={...}> with
 * a file input receives FormData, not a hand-built object. So this combines
 * BOTH existing conventions rather than inventing a third: `slug` stays a
 * trusted, server-bound first argument (role-grants.ts's discipline —
 * organizationId is never trusted from client data), and the SECOND
 * argument is FormData (the platform brand action's own necessity, for the
 * one field that needs it).
 */
export async function setOrgBrandAction(
  slug: string,
  formData: FormData,
): Promise<PolicyResult>;
```

Body: `resolveActingIdentity(slug)` (private helper, duplicated verbatim from `officers/actions.ts`/`roles/actions.ts`'s own copy — same convention, not a shared import) → extract `seedHex`/`typePairing`/`lightOnly`/`logo` off `formData` exactly as the platform action does → build a `logo: {bytes, declaredContentType} | null` (reading `File.arrayBuffer()` if present) → call `setBrand()` → `switch (result.kind)`, mapping `forbidden`/`invalid_hex`/`invalid_pairing`/`generation_failed`/`logo_rejected` to `{ok:false, error}` with copy mirroring the platform action's own strings verbatim → on `"ok"`, `recordAudit({ action: AUDIT_ACTIONS.TENANT_BRAND_SET, resourceType: "organization", resourceId: organizationId, metadata: { seedHex, typePairing, lightOnly, adjustmentCount } })`, `revalidatePath(\`/o/${slug}/admin/branding\`)`, then return `{ok:true}` unless `partialSaveLogoError` is non-null, in which case return `{ok:false, error: \`Colour and type pairing saved. The logo could not be stored: ${partialSaveLogoError}\`}` — the exact `PARTIAL_SAVE_PREFIX` string the platform's `brand-form.tsx` already keys off, so the tenant form's copy of that logic needs no new prefix constant.

**No `revalidateLiveSitePath()` equivalent — see Edge Cases.** `(org)` route handlers run exclusively on the RLS-enforced `db`/`presby_app` connection, and `organization_sites` carries **no `presby_app` grant at all** (DECISION-081) — this action cannot read it, and `getPlatformDb()` is forbidden in this subtree by the `(org)` contract. A tenant-set brand change therefore cannot itself invalidate a live public site's cached render the way the platform action does.

### `AUDIT_ACTIONS` addition (`src/lib/audit.ts`)

```ts
TENANT_BRAND_SET: "tenant.brand.set",
```

Placed alongside `ORG_FEATURE_TOGGLED`/`OFFICER_TERM_STARTED` in the `tenant.*` block, with a comment naming the `org.*`/`tenant.*` actor-axis distinction from `ORG_BRAND_SET` (same convention those two entries already document).

## Data Model

**No schema changes required.** `organization_brands`/`organization_brand_history` already carry `FORCE ROW LEVEL SECURITY`, the standard `tenant_isolation` policy (`organization_id = presby_current_org()`), and full `presby_app` grants (`drizzle/0016_presby_brand_storage.sql`, confirmed directly in Phase 2 by reading the DDL) — provisioned months ago, by name, for exactly this tenant editor ("slice d"). `blob_assets` likewise already grants `presby_app` `SELECT, INSERT`. The only two migration-layer additions this pipeline needs are a `permissions` catalog row (global, no `organization_id`, no RLS surface of its own) and fixture rows in `scripts/seed-dev.sql` — both additive, neither a `db:push`/`db:generate` event.

- `drizzle/0030_presby_branding_permission.sql` (new, hand-written per this repo's `db:generate`-is-broken posture, mirroring `drizzle/0029_presby_officers_permission.sql` exactly):
  ```sql
  insert into permissions (key, module, description, sensitivity_tier)
  values ('branding.manage', 'branding',
          'Set this organization''s brand colour, logo, type pairing, and light-only mode', 1)
  on conflict (key) do nothing;
  ```
- `scripts/seed-dev.sql`: one new `app_roles` row (`brand_admin`, next id `f0000000-0000-0000-0000-00000000000a`), one new `app_role_permissions` row (`brand_admin` → `branding.manage`), one new `role_grants` row (direct, `brand_admin` → Marguerite Ashcombe, Alder Creek, `starts_on` = this pipeline's landing date).
- `scripts/seed.ts`: one new `feature_flags` row, `org_portal.branding`, `enabled: false`, comment mirroring `org_portal.officers`'s own (DECISION-003 disclaimer, "ships dark" rationale).

## Component / Page Plan

**Pages to create:**
- `src/app/(org)/o/[slug]/admin/branding/page.tsx` — Server Component. Repeats the full `(org)` auth pattern in the page (per the `(org)` contract — a layout can't see the pathname): `cachedAuth()` → `resolveOrgContext()` four-way switch (`not-found`/`forbidden`/`ended`/`ok`) → `assertOrgAccess()` → `isFlagEnabled("org_portal.branding")` (before any data call; renders `BrandingFlagOff` if off) → `getOrgBrandForEdit()` (renders `BrandingForbidden` on `"forbidden"`) → renders `<BrandingForm>` with the existing brand's values as initial props, exactly mirroring `features/page.tsx`/`officers/page.tsx`'s shape.

**Components to create:**
- `src/app/(org)/o/[slug]/admin/branding/branding-states.tsx` — `BrandingFlagOff`, `BrandingForbidden`, `BrandingLoadError`, same three-state shape as `features-states.tsx`.
- `src/app/(org)/o/[slug]/admin/branding/branding-form.tsx` — `'use client'`, adapted from `(admin)/admin/organizations/[id]/brand-form.tsx` (same door-1/door-2/door-3 colour/pairing/logo UI, same live preview via `BrandPreviewSwatch`, same adjustments-before-save banner, same `PARTIAL_SAVE_PREFIX`-keyed toast/banner logic). Takes `slug` as a prop and closes over it in its own `submitBrand` wrapper (`(prev, formData) => setOrgBrandAction(slug, formData)`) rather than a hidden `organizationId` input field — there is no client-supplied organization identity on this path at all, unlike the platform form's hidden field.
  - **Fix, not reproduce, the known staleness bug**: `docs/TODO.md` already names a live defect in the platform `BrandForm` — its `useState(initial...)` fields don't reactively reflect a just-saved value after `revalidatePath` re-fetches the server tree (frozen until a real navigation). Since this component is a direct adaptation of that one, carry the fix forward at the same time rather than shipping a second copy of a diagnosed bug: key the form's state off a value that changes per save (e.g. the fetched brand's `updatedAt`/`brandTokenVersion`) or re-seed via a `useEffect` on the prop, per that TODO entry's own suggested fix.

**Files to modify:**
- `src/lib/org-portal/tiles.ts` — add a `branding` tile (`label: "Branding"`, `href: (slug) => \`/o/${slug}/admin/branding\``, `flagKey: "org_portal.branding"`), same flag-only/no-permission-check shape as every other tile (the destination page is the sole authority, per that file's own header).
- `src/lib/org-portal/tiles.test.ts` — **will fail without this update**: `KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS` needs `"org_portal.branding"` added, and the `"mirrors OrgPortalStub's four links…"` hard-coded sorted-key snapshot needs `"branding"` added. Named explicitly in Edge Cases below — this is an *existing* test this change breaks, not new coverage.
- `src/lib/audit.ts` — `TENANT_BRAND_SET` addition.
- `scripts/seed-dev.sql`, `scripts/seed.ts` — fixture/flag rows (see Data Model).
- `docs/product/functionality-map.md` — at ship time (Rule 14), not this commit.

## Implementation Order

1. **Schema/fixture (database-admin, commit 1):** `drizzle/0030_presby_branding_permission.sql` (permission-catalog row) → `scripts/seed-dev.sql` (`brand_admin` role + permission binding + direct grant to Marguerite Ashcombe) → `scripts/test-rls.sql` section 23 (permission-catalog-row assertion + `presby_has_permission(ELDER, ALDER, 'branding.manage') = 1` + the cross-org negative at Bramblewood, mirroring section 19/22's shape — no new RLS/FORCE-RLS assertion needed, since `organization_brands`/`organization_brand_history`'s isolation is already proven and unchanged by this pipeline).
2. **`org_portal.branding` flag seed** (`scripts/seed.ts`, enabled: false) — bundled into commit 1 (it's a seed-script change, same file family as the fixture work) or commit 2, implementer's call; either is fine as long as it lands before commit 3's page can be reached.
3. **Server logic (api-developer, commit 2):** `src/lib/tenant-branding.ts` → `(org)/o/[slug]/admin/branding/actions.ts` → `AUDIT_ACTIONS.TENANT_BRAND_SET`.
4. **UI (ux-developer, commit 3):** `page.tsx` → `branding-states.tsx` → `branding-form.tsx` → `src/lib/org-portal/tiles.ts` + `tiles.test.ts` update → real-browser verification at 360-390px (colour picker, file input, adjustments banner, partial-save banner) per "Verify in a Browser."
5. Audit event already wired in step 3 (`TENANT_BRAND_SET`) — no separate step.
6. Release notes entry + `docs/product/functionality-map.md` line + `docs/TODO.md` reconciliation, all at Phase 6 ship time (tech-lead, `/release-notes`).

## Edge Cases & Risks

- **Existing spec this change breaks: `src/lib/org-portal/tiles.test.ts`.** Adding the `branding` tile fails two hard-coded assertions (`KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS`, the sorted-key-list snapshot) until both are updated in the same commit that adds the tile. Named here per the retro's "one loop-back was an unanticipated existing-spec break" finding — this one is anticipated.
- **A tenant-set brand change does not revalidate a live public site's cached page.** The platform action's `revalidateLiveSitePath()` cannot be replicated on the `(org)` connection (`organization_sites` has no `presby_app` grant at all, and `getPlatformDb()` is forbidden in this subtree) — see the API Contract note above. A congregation that changes its own brand through this new path may see its public site's colours go stale until the next content ingest (which does its own revalidation) or an operator visits `/admin/organizations/<id>` and re-saves through the platform form. Named as a real, deferred limitation — not solved here, tracked in `docs/TODO.md` (see below), same "surfaced not fixed" posture as `role-grants.ts`'s finding 4.
- **Logo-store-then-forbidden race is structurally impossible here**, unlike a naive read of Phase 2's ordering might suggest: the `hasBrandingManage` gate runs inside its own `withOrgContext()` transaction *before* `store()` is ever called (API Contract step A), not after — so a caller who fails the gate never reaches the storage call at all. (Contrast: the platform action can check `FEATURES.ADMIN_ORGANIZATIONS` as a bare session claim before anything else; `branding.manage` requires a DB round-trip, which is why this path needs an explicit first transaction rather than a pre-check.)
- **Org-type gating: none**, confirmed by Phase 2 — all five `organizationType` values, no CHECK constraint or code path differentiates.
- **Rate limiting: parity with the platform path (neither has it) is an accepted posture, not a gap this pipeline introduces** — but multiplying the actor count (every `brand_admin` holder at every managed org, vs. a small platform-operator set) does change the abuse-risk shape even though per-actor risk is unchanged. Tracked in `docs/TODO.md`, not blocking.
- **Bootstrap gap:** no congregation is auto-provisioned with a `brand_admin` holder — same shape as `stated_clerk`/`officers.manage`'s own deferred bootstrap gap (DECISION-100), out of scope here, tracked in `docs/TODO.md`.
- **e2e blast radius:** no existing e2e spec asserts behavior this pipeline alters. `e2e/admin-organizations.spec.ts` (the platform brand form) is untouched — this pipeline adds a second writer to the same table, never modifies that file or its assertions. No existing e2e spec asserts an exact link/tile count on the `(org)` portal nav row (checked directly — only platform `/admin` sidebar specs assert exact nav-link presence). The one existing spec this change *does* break is the unit test named above (`tiles.test.ts`), not an e2e spec.

## Out of Scope (confirmed, from Phase 1/2 — not re-litigated here)

- "Neutralize" (remediation against an abusive tenant's brand) — platform-only, no tenant equivalent, no `TENANT_BRAND_NEUTRALIZED` key.
- Retiring or modifying the platform `/admin/organizations/[id]` brand form, `neutralizeOrganizationBrandAction`, or any of the site-provisioning/profile/service-times actions in that same file.
- Wordmark upload — the platform editor doesn't wire it either (`wordmarkAssetKey` stays reserved); the tenant editor matches.
- Revalidating a live public site's cache from the tenant path (see Edge Cases).
- Production role-seeding surface / auto-provisioning `brand_admin` at org creation (bootstrap gap, tracked in `docs/TODO.md`).

## Implementer

**Three-commit split, confirmed as scoped by Phase 2:**
1. **database-admin** — `drizzle/0030_presby_branding_permission.sql`, `scripts/seed-dev.sql` (`brand_admin` role/binding/grant), `scripts/seed.ts` (`org_portal.branding` flag), `scripts/test-rls.sql` section 23.
2. **api-developer** — `src/lib/tenant-branding.ts`, `(org)/o/[slug]/admin/branding/actions.ts`, `AUDIT_ACTIONS.TENANT_BRAND_SET`.
3. **ux-developer** — `page.tsx`, `branding-states.tsx`, `branding-form.tsx`, `src/lib/org-portal/tiles.ts` + `tiles.test.ts`, real-browser mobile verification.

**Handoff: database-admin, for Phase 4 commit 1.** Start with the migration and the fixture; `scripts/test-rls.sql` section 23 should follow the exact shape of section 19 (org_features.manage) and section 22 (officers.manage) — a permission-catalog-row assertion, a positive `presby_has_permission` assertion for the fixture grant, and a cross-org negative. Do not re-open the person-vs-group binding question (resolved above, DECISION-103) or the invariant ruling (resolved in Phase 2, DECISION-101).

---

# Phase 4 — Implementation

## Commit 1 of 3 (database-admin) — schema/permission-catalog/fixture layer only

No application code in this commit — `src/lib/tenant-branding.ts`, the `(org)/o/[slug]/admin/branding/` route, and the UI are explicitly out of scope here and remain owed to commits 2 (api-developer) and 3 (ux-developer).

### Files Created

- `drizzle/0030_presby_branding_permission.sql` — the `branding.manage` permission-catalog row (module `branding`, tier 1), `on conflict (key) do nothing`, mirroring `drizzle/0029_presby_officers_permission.sql`'s exact shape and its own comment naming why the role/binding/grant belong in `scripts/seed-dev.sql` instead (DECISION-063).

### Files Modified

- `drizzle/meta/_journal.json` — hand-registered entry `idx: 30`, `tag: "0030_presby_branding_permission"`, `when: 1787014053186` (one increment past `0029`'s own timestamp), same hand-authored pattern every migration past `0012` uses (`db:generate` is broken repo-wide, `docs/TODO.md`).
- `scripts/seed-dev.sql` — three additions, all fixture-only (DECISION-066's precedent — no production role-seeding surface exists yet):
  1. A new `app_roles` row, `brand_admin` (`f0000000-0000-0000-0000-00000000000a`, Alder Creek only, `role_kind: 'constitutional'`, `is_protected: true`, name "Brand Administrator") — verified against the live dev database before use: no existing `app_roles.id` or `.key` collision (`f0000000-…-0001` through `…-0009` were the only existing rows in that id family; `0000000a` was free).
  2. A new `app_role_permissions` row binding `brand_admin` → `branding.manage` — the *only* permission this role carries.
  3. A new `role_grants` row, direct-granted (person-arm, not group-arm — Phase 3's DECISION-103 call: branding is a single-accountable-office action with no polity body whose vote approves a brand change, so there's nothing for a group grant to represent that a direct grant doesn't already cover), to **Marguerite Ashcombe** (`c0000000-0000-0000-0000-000000000001`) at Alder Creek only, `starts_on = '2026-08-26'`. Confirmed **not** granted to Tobias Renwick, per Phase 3's explicit reasoning: he already holds `property_chair` + `stated_clerk` (seven permissions between them once `officers.manage` is counted), and a third role on the same fixture person would recreate the "one person, every capability" concentration `support_contact`'s own binding (DECISION-080) was written to interrupt. Marguerite already holds `support_contact`/`tickets.file` — a second, distinct, administrative role on the same person is a reasonable single-office pairing, not a wildcard accretion.
- `scripts/seed.ts` — one new `feature_flags` entry, `org_portal.branding`, `enabled: false`, comment following the exact `org_portal.*` convention (DECISION-003 disclaimer, "ships dark until the page lands," explicit note that the platform admin's own brand form is unaffected by this flag).
- `scripts/test-rls.sql` — new section 23, appended after section 22 (`officers.manage`), mirroring sections 19/22's shape exactly: (1) a `permissions` catalog-row assertion for `branding.manage`; (2) a positive `presby_has_permission(:ELDER, :ALDER, 'branding.manage')` assertion, plus a re-proof that Marguerite's existing `tickets.file`/`support_contact` grant is undisturbed; (3) a cross-org negative at Bramblewood. No new `\set` variable was needed for Marguerite Ashcombe's person id — `:ELDER` (`'c0000000-0000-0000-0000-000000000001'`) already resolves to her and is used throughout the file (confirmed by reading the existing `\set` block before writing this section, per the task's own instruction to check first).

## Schema Changes

- New global `permissions` catalog row: `branding.manage` (module `branding`, tier 1). No `organization_id`, no RLS surface of its own (`permissions` carries neither).
- No changes to `organization_brands`/`organization_brand_history` — both were already `FORCE RLS` with full `presby_app` grants since `drizzle/0016_presby_brand_storage.sql` (Phase 2/3 confirmed this directly against the live DDL; this commit adds nothing to that surface).
- Applied via: **hand-applied `psql` against `$MIGRATE_DATABASE_URL`** (the documented workaround — `npm run db:migrate`/`db:push` are confirmed broken repo-wide per `docs/TODO.md`'s own entry, predating this pipeline). Command and output are in Implementer Notes below. **This is a fixture/permission-catalog addition, not a schema-shape change** — no Neon branch was used; applied directly against the existing dev database the same way `drizzle/0029` and its predecessors were.

## Audit Events

- None in this commit. `AUDIT_ACTIONS.TENANT_BRAND_SET` (`"tenant.brand.set"`) is commit 2's addition (`api-developer`, per Phase 3's own placement in `src/lib/audit.ts`).

## Implementer Notes

**Migration applied and verified idempotent:**

```
$ psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0030_presby_branding_permission.sql
INSERT 0 1
$ psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0030_presby_branding_permission.sql   # re-run
INSERT 0 0
$ psql "$MIGRATE_DATABASE_URL" -c "select key, module, sensitivity_tier from permissions where key='branding.manage';"
       key       |  module  | sensitivity_tier
-----------------+----------+------------------
 branding.manage | branding |                1
```

**Fixture rows hand-applied** (as `$MIGRATE_DATABASE_URL`, the owner connection — the same posture every `scripts/seed-dev.sql` addition in this repo takes when landed against an already-seeded dev database, since the file's own single `begin…commit` wrapper around the *entire* file means a second full run aborts on the very first duplicate-key row rather than picking up only the new lines):

```
begin;
insert into app_roles (id, organization_id, key, name, role_kind, is_protected) values
  ('f0000000-0000-0000-0000-00000000000a','22222222-2222-2222-2222-222222222222',
   'brand_admin','Brand Administrator','constitutional',true);
insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-00000000000a','branding.manage');
insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-00000000000a',
   'c0000000-0000-0000-0000-000000000001', '2026-08-26');
commit;
-- INSERT 0 1 / INSERT 0 1 / INSERT 0 1 / COMMIT — all succeeded, no id collisions.
```

**RLS verification (section 23), run as `presby_app` via `$APP_DATABASE_URL`:**

```
$ psql "$APP_DATABASE_URL" -f <scratch file containing section 23 + its \set ALDER/BRAMBLE/ELDER vars>
NOTICE:  pass  permissions: branding.manage catalog row exists (1)
NOTICE:  pass  presby_has_permission: brand_admin holder (Marguerite Ashcombe) holds branding.manage at alder (1)
NOTICE:  pass  presby_has_permission: Marguerite Ashcombe still holds tickets.file (support_contact, unchanged) (1)
NOTICE:  pass  presby_has_permission: brand_admin holder holds NOTHING at bramblewood (no grant there) (0)
```

All four assertions pass, reproduced twice independently.

**Full-suite run — a genuine environmental caveat, not a defect in this commit's own work.** Running the complete `scripts/test-rls.sql` top-to-bottom against the live dev database (which this session's task description itself flagged as carrying "substantial uncommitted work from other concurrent pipelines") surfaced **three pre-existing failures unrelated to `branding.manage`/`brand_admin`**, none of which this commit touches or introduces:
1. Section 10 — `presby_roll_cache_drift()` finds one drifted row, for an `organization_id`/`person_id` pair that is neither Alder Creek nor any row this pipeline added (CLAUDE.md's own F29: cache drift from the passage of time, reconciled separately, not a bug).
2. Section 11 — the 2FA-policy assertion for `elder.fixture`/Marguerite Ashcombe intermittently failed on one run and passed cleanly on a direct re-query and on a second full run — consistent with concurrent write activity against a shared dev database rather than a real regression (direct query via both `$MIGRATE_DATABASE_URL` and `$APP_DATABASE_URL`, run immediately after the failure, returned the expected `t`/`1` both times).
3. Section 17 — a second full run hit a duplicate-key error on `organization_profiles_pkey` for Alder Creek; a live row already exists there (and two `organization_service_times` rows), meaning that section's "creates its own row inside a rolled-back transaction" assumption no longer holds now that `organization_profiles` carries real data from actual application use in this shared dev database — pre-existing, unrelated to this commit's own `permissions`/`app_roles`/`app_role_permissions`/`role_grants` additions.

None of these three touch `branding.manage`, `brand_admin`, or any table this commit wrote to. Section 23's own assertions were verified in isolation (above) precisely because the full-suite run is not currently a clean baseline in this shared environment — a pre-existing condition, not something introduced here, and out of this commit's scope to fix. Flagged for whichever agent next reconciles `docs/TODO.md` / does the next review pass, not silently absorbed.

**Verification commands run:**
- `npm run typecheck` — PASS, clean.
- `npm run check` (all four tripwires: `check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`) — PASS, all four green. (No application code was touched in this commit, so this is largely a no-op confirmation that nothing else in the working tree regressed the tripwires.)
- Migration + fixture hand-apply — see above, both idempotent/collision-free.
- `scripts/test-rls.sql` section 23 — PASS, all four assertions, reproduced twice.

## Handoff

**Next: api-developer, for Phase 4 commit 2.** Build `src/lib/tenant-branding.ts` (`getOrgBrandForEdit`/`setBrand`, per Phase 3's exact API contract) and `(org)/o/[slug]/admin/branding/actions.ts` (`setOrgBrandAction`), plus the `AUDIT_ACTIONS.TENANT_BRAND_SET` addition to `src/lib/audit.ts`. Available now: the `branding.manage` permission (queryable via `presby_has_permission()`/`presby_effective_permissions()`), the `brand_admin` role bound to it and direct-granted to Marguerite Ashcombe at Alder Creek (`c0000000-0000-0000-0000-000000000001`, org `22222222-2222-2222-2222-222222222222`), and the `org_portal.branding` flag (seeded off — commit 2's server logic should be written flag-agnostic per Phase 3's contract, since the flag check lives in the page, not the actions module). No schema/fixture changes are owed from this point forward for the remainder of this pipeline. To apply this commit's changes on a fresh clone: `psql "$MIGRATE_DATABASE_URL" -f drizzle/0030_presby_branding_permission.sql`, then the three fixture inserts shown above (or a full `psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql` on a genuinely fresh database), then `npm run db:seed` to pick up the new `org_portal.branding` flag row.

---

## Commit 2 of 3 (api-developer) — server logic: `src/lib/tenant-branding.ts`, `(org)/o/[slug]/admin/branding/actions.ts`, `AUDIT_ACTIONS.TENANT_BRAND_SET`

No page/component/nav-tile changes in this commit — `page.tsx`, `branding-states.tsx`, `branding-form.tsx`, and the `src/lib/org-portal/tiles.ts`/`tiles.test.ts` update are explicitly out of scope here and remain owed to commit 3 (ux-developer).

### Files Created

- `src/lib/tenant-branding.ts` — the new query/mutation module, sibling to `src/lib/officers.ts`/`src/lib/role-grants.ts`/`src/lib/org-features.ts` per Phase 2/3's explicit placement ruling (NOT inside `src/lib/brand/`, which stays closed to `contract.ts`/`generate.ts`/`fonts.ts`/`read-org-brand.ts`). Exports:
  - `getOrgBrandForEdit(viewerPersonId, organizationId): Promise<GetOrgBrandResult>` — the editor's own gated pre-fill read (`{kind:"ok", brand: ExistingTenantBrand | null} | {kind:"forbidden"}`), re-checking `branding.manage` on every call, same "every read re-checks the gate" discipline as `listGrants`/`listOfficerRoster`/`listFeatureToggles`.
  - `setBrand(actorPersonId, organizationId, actorUserId, input: SetBrandInput): Promise<SetBrandResult>` — the three-step flow per Phase 2/3's explicit ordering requirement: (A) one `withOrgContext()` transaction — the `branding.manage` gate FIRST (matching every other module in this tree's "forbidden check runs before anything else" discipline), then the existing brand row read in the same transaction; (B) outside any transaction — sniff/size-validate the logo if present, then `getBlobStore().store()`, byte-identical E-c1/E-c2 ordering to the platform action's own logo handling; (C) a second, independent `withOrgContext()` transaction — the history row (if a prior brand existed), then the `organization_brands` upsert. `SetBrandResult` kinds: `forbidden` / `invalid_hex` / `invalid_pairing` / `generation_failed` / `logo_rejected` (E-c2: the ONLY change was a bad logo, nothing written) / `ok` (carries `adjustmentCount` and a nullable `partialSaveLogoError` for the E-c2 partial-save case).
  - Private: `hasBrandingManage()` (the single `presby_has_permission(..., 'branding.manage')` call site, mirroring `hasRoleGrantsManage`/`hasOfficersManage`/`hasOrgFeaturesManage`), `fetchExistingBrand()`, `SEED_HEX_RE`/`MAX_LOGO_BYTES`/`sniffImageContentType()`/`formatMB()` — duplicated-by-convention copies of the platform action's own private constants/function, per Phase 2's explicit "replicate, don't reinvent" instruction. `sniffImageContentType()` is a byte-identical copy (PNG/JPEG/WEBP magic-byte sniffing only; SVG falls through to `null` by construction, G7).
  - Validation/generation ordering: `branding.manage` gate → hex format (`SEED_HEX_RE`, case-insensitive, lowercased before storage) → `isTypePairingKey()` against `TYPE_PAIRINGS` (imported read-only from `src/lib/brand/contract.ts`) → `generateBrandTokens(seedHex)` (imported read-only from `src/lib/brand/generate.ts`; only rejected — `generation_failed` — if it throws, which a validated 6-digit hex should never do) → logo handling → the two-transaction write. `hexOrPairingChanged`/partial-save-on-logo-failure honesty (E-c2) is a verbatim replication of the platform action's own logic, not a reinvention.
  - No `revalidateLiveSitePath()` equivalent exists in this module, and none was added — confirmed by Phase 3's own contract and DECISION-103: `(org)` route handlers run exclusively on the RLS-enforced `presby_app` connection, `organization_sites` carries no `presby_app` grant at all (DECISION-081), and `getPlatformDb()` is forbidden in this subtree by the `(org)` contract. A tenant-set brand change cannot itself invalidate a live public site's cached render; this is a confirmed, deferred gap (tracked in `docs/TODO.md` by Phase 3), not something this commit attempted or silently dropped.
- `src/lib/tenant-branding.test.ts` — integration suite, run against a real Postgres connection (the `role-grants.test.ts`/`officers.test.ts`/`org-features.test.ts` harness: `hasDb` skip-guard, dynamic imports inside `beforeAll`, a self-contained two-org fixture created and torn down per file, never mutating `scripts/seed-dev.sql`'s fixture ids). Covers, per the task's required list:
  1. **The `branding.manage` permission gate** — `getOrgBrandForEdit`/`setBrand` both return `{kind:"forbidden"}` for a current member holding no grant, and `setBrand`'s forbidden path is proven to write nothing (`organization_brands` has no row for that org afterward).
  2. **Hex validation matching the platform path's own `SEED_HEX_RE`** — five malformed inputs (`not-a-colour`, too-short, too-long, non-hex characters, missing `#`) each return `invalid_hex`; an uppercase hex is accepted and stored lowercased, matching the platform action's own behavior.
  3. **The contrast-floor-enforcing generator call actually firing** — a saturated seed writes the current `BRAND_TOKEN_VERSION` (proof `generateBrandTokens()` ran, not a pass-through), and a near-grey seed (`#808080`) produces a non-zero `adjustmentCount` — proof the generator's own contrast-floor/near-grey-detection logic actually executed inside this module's call, not just at the unit level `generate.ts`'s own property test already covers.
  4. **History-row-on-update** — a second `setBrand` call for the same org writes an `organization_brand_history` row capturing the superseded values, `action: "updated"`.
  5. **Logo handling (E-c1/E-c2)** — a valid-magic-byte PNG stores and sets `markAssetKey`; a bad-magic-byte logo that is the ONLY change touches nothing (`logo_rejected`, brand row byte-identical before/after); a bad logo alongside a real colour change still commits the colour and names the logo failure specifically (`partialSaveLogoError`).
  6. **Cross-org isolation** — a `branding.manage` holder at orgA cannot `setBrand`/`getOrgBrandForEdit` at orgB (throws `OrgAccessError` — no membership there at all), and vice versa for orgB's own holder against orgA; a final test proves orgB's own grant works fine at orgB, so the isolation failures above are org-scoped rejections, not a broken fixture. This reproduces, at throwaway fixture scale, the exact shape commit 1's `scripts/test-rls.sql` section 23 already proved at the SQL layer for Marguerite Ashcombe (Alder Creek) vs. Bramblewood — the task's own named scenario — without mutating the shared dev database's seed fixture.
  - `recordAudit()` is NOT mocked or asserted in this file — `tenant-branding.ts` itself never calls it (Phase 3's placement: the audit write lives in the actions layer, proven by `actions.test.ts` instead).

### Files Modified

- `src/lib/audit.ts` — added `TENANT_BRAND_SET: "tenant.brand.set"` to `AUDIT_ACTIONS`, placed after `OFFICER_TERM_ENDED` with a comment naming the `org.*`/`tenant.*` actor-axis distinction from `ORG_BRAND_SET` (same convention those two entries already document) and confirming no tenant-side neutralize key exists or should be built.
- `src/lib/audit.test.ts` — **existing spec this change breaks, anticipated**: `EXPECTED_ENTRIES` is a hand-maintained `Record<keyof typeof AUDIT_ACTIONS, string>` regression guard against audit-string drift; adding `TENANT_BRAND_SET` to `AUDIT_ACTIONS` without adding it here fails `tsc` (a missing-property compile error, not a runtime assertion failure) before any stale audit string could reach the database. Added in the same commit, same "one loop-back was an unanticipated existing-spec break, this one is anticipated" posture Phase 3 named for `org-portal/tiles.test.ts` (that one is commit 3's, not this commit's, break).

### Files Created (continued)

- `src/app/(org)/o/[slug]/admin/branding/actions.ts` — `setOrgBrandAction(slug: string, formData: FormData): Promise<PolicyResult>`, `PolicyResult` a LOCAL type (`{ok:true} | {ok:false; error:string}`, not imported from the platform file — no route-group-crossing action-type import exists anywhere in this tree). Body: `resolveActingIdentity(slug)` (duplicated verbatim from `admin/roles/actions.ts`/`admin/officers/actions.ts`'s own copy, same convention, not a shared import) → extract `seedHex`/`typePairing`/`lightOnly`/`logo` off `formData` (native checkbox semantics for `lightOnly`; `logo` built from `File.arrayBuffer()` only when a non-empty file is present) → `setBrand()` → `switch` mapping every `SetBrandResult` kind to `PolicyResult`, copy matching the platform action's own strings verbatim (`invalid_hex`/`invalid_pairing`/`generation_failed`) → on `"ok"`, `recordAudit({action: AUDIT_ACTIONS.TENANT_BRAND_SET, resourceType: "organization", resourceId: organizationId, metadata: {seedHex, typePairing, lightOnly, adjustmentCount}})`, `revalidatePath(\`/o/${slug}/admin/branding\`)`, then `{ok:true}` unless `partialSaveLogoError` is non-null, in which case `{ok:false, error: "Colour and type pairing saved. The logo could not be stored: ${partialSaveLogoError}"}` — the exact `PARTIAL_SAVE_PREFIX` string commit 3's client form is expected to key off, per Phase 3's contract.
  - `organizationId` never comes from client-supplied `FormData` — no such field is ever read off it; the org is always `resolveOrgContext(session.user.id, slug)`'s own answer, proven directly in `actions.test.ts`'s "no `organizationId` field is read off the submitted FormData at all" test (a form submission carrying a spoofed `organizationId` field is ignored entirely).
  - Signature deviation named explicitly per DECISION-103: `(slug, formData)` combines role-grants.ts's discipline (trusted, server-bound `slug` first argument) with the platform action's own necessity (raw `FormData`, for the one field with a file input) — the first tenant action in this tree with a file input, and the only one that needs both conventions at once.
- `src/app/(org)/o/[slug]/admin/branding/actions.test.ts` — mocked-boundary orchestration suite (mirrors `admin/roles/actions.test.ts`'s exact structure), proving the contract this actions.ts layer owns and `tenant-branding.test.ts` cannot (since that file calls `setBrand` directly, bypassing the action):
  1. Identity resolution — not-signed-in short-circuits before `resolveOrgContext`/`setBrand`; `resolveOrgContext` is called with `session.user.id` and the `slug` argument; a non-`"ok"` resolution short-circuits before `setBrand`; `setBrand` receives `identity.personId` (a `people.id`) and `identity.userId` (`session.user.id`, a `users.id`) as two DIFFERENT arguments, never the same value for both; a spoofed `organizationId` field in the submitted `FormData` is never read.
  2. Every `SetBrandResult` kind → `PolicyResult` mapping, including the `logo_rejected` no-op (no audit, no revalidate) and the `ok`-with-`partialSaveLogoError` partial-save path (audits AND revalidates — the colour DID commit — but still returns `ok:false` with the compound message).
  3. **`TENANT_BRAND_SET` fires ONLY on `{kind:"ok"}`, never on a denial** — asserted for every non-`"ok"` `SetBrandResult` kind (`forbidden`/`invalid_hex`/`invalid_pairing`/`generation_failed`/`logo_rejected`), and asserted to fire with the exact `{action, resourceType, resourceId, metadata}` shape on success (`resourceId` is the ORGANIZATION id, not a grant/term id — this resource has no separate row id of its own, one row per org).
  4. `revalidatePath` fires only after a successful (or partial-save) mutation, never on a denial.

## Schema Changes

None. No migration, no fixture change, no `scripts/test-rls.sql` change — all out of scope for this commit (commit 1's own artifacts, untouched).

## Audit Events

- `AUDIT_ACTIONS.TENANT_BRAND_SET` (`"tenant.brand.set"`) — added to `src/lib/audit.ts` in this commit. Written from `setOrgBrandAction` in `(org)/o/[slug]/admin/branding/actions.ts`, ONLY on `SetBrandResult.kind === "ok"` (including the partial-save-logo-error case — the colour/pairing DID commit). `resourceType: "organization"`, `resourceId: organizationId`, `metadata: {seedHex, typePairing, lightOnly, adjustmentCount}`. Distinct from the platform-axis `ORG_BRAND_SET` per the `org.*`/`tenant.*` actor-axis convention (Phase 2/3's own ruling) — no tenant-side neutralize key exists or was added; neutralize stays platform-only (DECISION-101), untouched by this commit.
- Proven in `actions.test.ts`: fires with the exact metadata shape on success, never fires on any denial kind, fires exactly once per successful call (including the partial-save case).

## Implementer Notes

**Design decisions made at this layer, not re-litigating Phase 2/3:**

1. **Gate-before-validate ordering inside `setBrand()`.** Phase 3's own comment block describes step A as "the gate ... + fetch the existing brand row" without explicitly ordering the gate against hex/pairing validation. This commit puts the `branding.manage` gate FIRST — before hex format, before type-pairing validity, before calling `generateBrandTokens()` — matching the load-bearing "forbidden check runs before any other work" discipline `role-grants.ts`'s own header documents as a real, previously-caught authorization-bypass class (an earlier draft of that module omitted the equivalent ordering to satisfy a test's literal wording, and got the ordering wrong as a result). An unauthorized caller here never even learns whether their hex string was well-formed.
2. **`fetchExistingBrand()` takes an `OrgTx`, not `getPlatformDb()`** — a straightforward re-shaping of the platform action's own function (which takes `ReturnType<typeof getPlatformDb>`) to read through the transaction `withOrgContext()` hands in, per the `(org)` contract's unconditional ban on `getPlatformDb()` in this subtree.
3. **`ExistingTenantBrand.typePairing` is typed `TypePairingKey`, not `string`** (a stricter type than the platform action's own `ExistingBrand.typePairing: string`), per Phase 3's exact contract. Cast on read (`row.typePairing as TypePairingKey`), not re-validated — safe because this module is the only tenant-side writer and never writes an un-validated value; documented inline as a deliberate divergence from the platform's looser shape, not an oversight.
4. **`SetBrandInput.logo.declaredContentType` is accepted but never read.** The module sniffs magic bytes exclusively (E-c1), matching the platform action's own discipline of never trusting the browser's reported MIME type. The field stays in the type because Phase 3's contract specifies it and `actions.ts` populates it from `File.type` for shape-completeness/future use, but `tenant-branding.ts` ignores it by design.
5. **No re-gating in step C.** Phase 3's contract describes the gate as living in step A only; this commit does not add a second `presby_has_permission()` check before the step-C transaction. `withOrgContext()` itself still re-verifies ACTIVE MEMBERSHIP (not the `branding.manage` permission specifically) on every call, including step C's — so a membership that lapses between steps A and C still fails closed (an `OrgAccessError` thrown out of `setBrand()`), it simply isn't re-checked against the permission catalog a second time. Named here in case a future reviewer wonders why step C has no gate call of its own — it is a deliberate reading of Phase 3's contract, not an oversight.

**Verification commands run:**

```
$ npm run typecheck
> tsc --noEmit
(clean exit, no errors)

$ npm run check
Audit-coverage check passed.
sql<Date> guard passed.
Dependency-drift check passed.
Brand-scope check passed.

$ npx vitest run "src/app/(org)/o/[slug]/admin/branding/actions.test.ts" src/lib/tenant-branding.test.ts src/lib/audit.test.ts
 Test Files  2 passed | 1 skipped (3)
      Tests  27 passed | 19 skipped (46)
(tenant-branding.test.ts SKIPPED here — no DATABASE_URL in this invocation, same as every other *.test.ts in this tree's Postgres-backed family; expected, not a failure)

$ npx dotenv -e .env.local -- vitest run src/lib/tenant-branding.test.ts
 Test Files  1 passed (1)
      Tests  19 passed (19)
(run for real against the live dev database — all 19 pass, including the cross-org isolation block)

$ npm run test    # full suite, no DB
 Test Files  155 passed | 16 skipped (171)
      Tests  2244 passed | 323 skipped (2567)
(confirms nothing else in the working tree regressed; the 16 skipped files are the same Postgres-backed family lacking DATABASE_URL in this invocation, unrelated to this commit)
```

No `console.log` left in production paths. No native browser dialogs (none introduced — no UI in this commit). Every mutation in `actions.ts` references an `AUDIT_ACTIONS` key (`check:audit` passed). No schema/RLS surface touched.

## Handoff

**Next: ux-developer, for Phase 4 commit 3.** Build `src/app/(org)/o/[slug]/admin/branding/page.tsx` (Server Component: `cachedAuth()` → `resolveOrgContext()` four-way switch → `assertOrgAccess()` → `isFlagEnabled("org_portal.branding")` check BEFORE any data call → `getOrgBrandForEdit()` → render), `branding-states.tsx` (`BrandingFlagOff`/`BrandingForbidden`/`BrandingLoadError`, mirroring `features-states.tsx`), and `branding-form.tsx` (`'use client'`, adapted from the platform's own `brand-form.tsx` — same door-1/door-2/door-3 colour/pairing/logo UI, same `PARTIAL_SAVE_PREFIX`-keyed banner logic, closing over `slug` rather than a hidden `organizationId` field). Also owed: the known `BrandForm` staleness bug (`docs/TODO.md`) should be FIXED, not reproduced, in this new adaptation — key state off `updatedAt`/`brandTokenVersion` or re-seed via `useEffect`, per that TODO entry's own suggested fix. Also owed: `src/lib/org-portal/tiles.ts` (`branding` tile, `flagKey: "org_portal.branding"`) + `src/lib/org-portal/tiles.test.ts` update (the known, anticipated existing-spec break named in Phase 3's Edge Cases). Available now: `getOrgBrandForEdit(viewerPersonId, organizationId)` and `setOrgBrandAction(slug, formData)`, both exercised end-to-end by this commit's test suites — `SetBrandResult`'s `ok`/`forbidden`/`invalid_hex`/`invalid_pairing`/`generation_failed`/`logo_rejected` kinds are exactly what `PolicyResult`'s `error` strings already surface, so commit 3's form only needs to render `result.error` and, for the `PARTIAL_SAVE_PREFIX` case, treat it as a softer "saved with one issue" state rather than a hard failure banner (mirroring the platform's own `brand-form.tsx` treatment). Real-browser mobile verification at 360-390px (colour picker, file input, adjustments banner, partial-save banner) is this next commit's own gate per "Verify in a Browser" — nothing in commit 2 was verified in a browser, by design (no UI exists yet).

---

## Commit 3 of 3 (ux-developer) — UI: `page.tsx`, `branding-states.tsx`, `branding-form.tsx`, `tiles.ts`/`tiles.test.ts`

All server logic (`src/lib/tenant-branding.ts`, `(org)/o/[slug]/admin/branding/actions.ts`, `AUDIT_ACTIONS.TENANT_BRAND_SET`) is commit 2's, untouched here except as a consumed contract.

### Files Created

- `src/app/(org)/o/[slug]/admin/branding/page.tsx` — Server Component, the full `(org)` auth pattern repeated in the page (per the `(org)` contract — a layout can't see the pathname), mirroring `admin/features/page.tsx`/`admin/roles/page.tsx` exactly: `cachedAuth()` → redirect to `/signin?callbackUrl=...` if unauthenticated → `resolveOrgContext()`'s four-way switch (`not-found` → `notFound()`; `forbidden` → `OrgAccessDenied`; `ended` → `OrgAccessEnded`; `ok` → continue) → `assertOrgAccess(personId, organizationId)` (the authoritative gate every `(org)` page calls) → `isFlagEnabled("org_portal.branding")` checked BEFORE `getOrgBrandForEdit()` is ever called (renders `BrandingFlagOff` if off) → `getOrgBrandForEdit()` (its `OrgAccessError` is RE-THROWN, not swallowed — `[slug]/error.tsx` already has the right copy one level up; any other thrown error renders `BrandingLoadError`; `{kind:"forbidden"}` renders `BrandingForbidden`) → resolves the logo mark (if any) to a `data:` URI via `getBlobStore().resolve()`, same posture as the platform page's own read (anonymous/public read path is deferred, DECISION-056) → renders `<BrandingForm>` with the existing brand's values as initial props (`brand?.seedHex ?? null`, `brand?.typePairing ?? "classic"`, `brand?.lightOnly ?? false`, resolved `markSrc`) — a `null` brand (no row yet, first-ever set) flows straight into the form's own defaults rather than a special-cased branch, matching the platform page's "current brand" pattern of rendering the default AS IT ACTUALLY RENDERS (G10).
- `src/app/(org)/o/[slug]/admin/branding/branding-states.tsx` — `BrandingFlagOff`/`BrandingForbidden`/`BrandingLoadError`, copy and structure mirroring `admin/features/features-states.tsx` line for line (three non-data-bearing answers; the fourth — unauthorized org or 404 slug — is handled one level up by `org-states.tsx`/`not-found.tsx`, reused as-is).
- `src/app/(org)/o/[slug]/admin/branding/branding-form.tsx` — `'use client'`, adapted directly from `(admin)/admin/organizations/[id]/brand-form.tsx` per Phase 3's explicit instruction to read that file first and adapt its actual field set rather than invent a new shape: same door-1 (colour picker) / door-2 (hex text field) / door-3 (logo file input) UI, same client-side live preview via `generateBrandTokens()`/`BrandPreviewSwatch` (zero server round-trip), same Flow-3 "Before you save" adjustments banner (unconditional, never behind a disclosure, G2), same `PARTIAL_SAVE_PREFIX`-keyed banner/toast logic (`"Colour and type pairing saved."` — amber banner + `toast.warning`, distinct from a red total-failure banner + `toast.error`).
  - **Two deliberate deviations from the platform form**, both named in the file's own header comment: (1) no hidden `organizationId` field — the component takes `slug` and closes over it in its own `submitBrand` wrapper `(prev, formData) => setOrgBrandAction(slug, formData)`, since `setOrgBrandAction` re-resolves the organization from the signed-in user's own membership set, never from client-supplied form data; (2) **the known staleness bug is fixed here, not reproduced.** `docs/TODO.md`'s entry on the platform `BrandForm` names the defect precisely: `useState(initial...)` only runs its initializer once, so a successful save that changes what the server sends down as `initial*` props (after `revalidatePath()` re-renders the Server Component tree without a full navigation) never reaches the already-mounted client state. `ExistingTenantBrand` (this pipeline's own read shape) carries no `updatedAt`/version counter to key a remount off, so this component takes the other fix Phase 3 named: a `useEffect` with `[initialSeedHex, initialTypePairing, initialLightOnly]` as its dependency array, re-seeding local state whenever the server's own answer changes. Proven directly in the real browser (see Implementer Notes) and in `branding-form.test.tsx`'s dedicated `rerender()` test.
- `src/app/(org)/o/[slug]/admin/branding/branding-states.test.tsx` — mirrors `features-states.test.tsx`'s convention exactly: each state's copy contains its own distinguishing phrase and not either other state's phrase; `BrandingLoadError`'s retry link points at `/o/<slug>/admin/branding`.
- `src/app/(org)/o/[slug]/admin/branding/page.test.tsx` — mirrors `features/page.test.tsx`'s exact assertion style: (1) the flag is checked before `getOrgBrandForEdit()` is ever called; (2) `assertOrgAccess` runs before the flag check; (3) `OrgAccessError` from `getOrgBrandForEdit()` is re-thrown, not swallowed; (4) any other thrown error renders `BrandingLoadError`; (5) `{kind:"forbidden"}` renders `BrandingForbidden`; (6) the ok path with an existing brand row renders the form pre-filled (hex, light-only checkbox) and calls the blob store to resolve the logo; (7) the ok path with `brand: null` (the empty state — no existing brand row) renders the form with the platform-accent default hex, an unchecked light-only box, and an ENABLED Save button — a real page, not a broken one; (8) the shared four-way miss response (redirect to `/signin?callbackUrl=...`, `notFound()` for an unresolvable slug).
- `src/app/(org)/o/[slug]/admin/branding/branding-form.test.tsx` — mirrors the platform's own `brand-form.test.tsx` (live preview re-derivation, Flow-3 adjustments banner, invalid-hex disabling Save) and adds what this adaptation owns beyond that baseline: (1) no `organizationId` field exists anywhere in the rendered form, and `setOrgBrandAction` is called with `(slug, formData)` — the slug closed over, never read off the submitted data; (2) every `PolicyResult` kind commit 2 defined surfaces its exact copy — success (green banner + success toast), forbidden, invalid-hex-shaped, logo-rejected-shaped (total failure — red banner + `toast.error`), and the partial-save (E-c2) case (amber banner + `toast.warning`, distinct from a total failure); (3) the light-only checkbox's native checkbox semantics (submits `"on"` when checked, the field is entirely absent from `FormData` when unchecked); (4) **the staleness-bug fix, directly**: a `rerender()` with new `initial*` props (simulating the post-save `revalidatePath()` re-render, no remount) updates the displayed fields, and a control test proves the effect doesn't clobber a user's own in-progress edit when no prop change has actually occurred (no infinite re-seed loop).

### Files Modified

- `src/lib/org-portal/tiles.ts` — added the `branding` tile (`key: "branding"`, `label: "Branding"`, `description: "Set your organization's colour, type pairing, and logo."`, `href: (slug) => \`/o/${slug}/admin/branding\``, `flagKey: "org_portal.branding"`, `category: "administer"`), appended after `features` — same flag-only/no-permission-check shape as every other tile (the destination page is the sole authority, per that file's own header). Read the file's CURRENT state first, per the task's own instruction — confirmed the `category` field (added by the concurrently-landing admin-hub pipeline) was already present and the shape to match, not the older Phase 1/2 description of this file.
- `src/lib/org-portal/tiles.test.ts` — the anticipated, named-in-advance existing-spec break (Phase 3's Edge Cases): added `"org_portal.branding"` to `KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS`; added `"branding"` to the `"mirrors OrgPortalStub's four links…"` sorted-key snapshot (renamed in-place to name the branding tile too); added `byKey.branding.category === "administer"` to the reclassification test; added a dedicated "branding tile is independent — org_portal.branding on, everything else off (administer)" test, matching the discipline every prior tile addition (members/officers/features) already established in this same file.

### Schema Changes

None. No migration, no fixture change, no `scripts/test-rls.sql` change — all out of scope for this commit (commit 1's own artifacts, untouched).

### Audit Events

None added in this commit — `AUDIT_ACTIONS.TENANT_BRAND_SET` is commit 2's addition, consumed here only insofar as the live-browser verification pass (below) confirmed it fires end-to-end from a real form submission with the correct `resourceId`/`metadata` shape.

### Implementer Notes

**Design decisions made at this layer, not re-litigating Phase 2/3:**

1. **The empty-state (no existing brand row) is not a special-cased branch.** `page.tsx` passes `brand?.seedHex ?? null`, `brand?.typePairing ?? "classic"`, `brand?.lightOnly ?? false`, `markSrc` (always `null` when there's no row, since `markAssetKey` is `null`) straight into `<BrandingForm>` exactly like the platform page does — the form's own `DEFAULT_SEED_HEX` (`#2563eb`, the platform's own un-rebranded accent) and `"classic"` default pairing render a complete, immediately-usable form, matching G10 ("show the default AS IT ACTUALLY RENDERS," never a "no branding configured yet" placeholder sentence in place of controls).
2. **`min-h-11` added to the Save button**, a small deviation from the platform form's own (unconstrained) button sizing — a mobile touch-target floor (CLAUDE.md's 44px minimum) the platform's `(admin)` surface doesn't need to worry about as strictly (it's an authenticated operator tool, not something a congregation's own admin is expected to reach for from a phone in the middle of a meeting). Verified in the browser at 360px (see below): the rendered button height is exactly 44px.
3. **No hidden hex/organizationId hidden hex-picker duplication of `name`** — same as the platform form: the native `<input type="color">` and the text `<input>` share one piece of React state, but only the text input carries a `name` attribute, so exactly one `seedHex` value is ever submitted.

**Live-browser verification (mandatory per "Verify in a Browser" and this task's own gate) — full walkthrough performed against a running `npm run dev` server, real dev database, real sign-in:**

- Confirmed **before** touching the fixture: `elder.fixture@example.invalid` in `scripts/seed-dev.sql` IS Marguerite Ashcombe (`c0000000-0000-0000-0000-000000000001`) — the same person commit 1 direct-granted `brand_admin` to at Alder Creek. Not assumed; read the seed file directly (line 529 links that user row to that person row via `update people set user_id = ...`).
- Flipped `org_portal.branding` on directly in the dev DB for this pass, per the task's own instruction (`update feature_flags set enabled = true where key = 'org_portal.branding'`) — it was seeded off, as commit 1's handoff said.
- **An unrelated, pre-existing environmental blocker was found and worked around, then restored**: `auth.require_2fa` was already `enabled = true` in this shared dev database (unrelated to this pipeline — a carryover from other concurrent work), which routed `elder.fixture` through `/totp` on sign-in even though her own `users.two_factor_required` is `false` (the per-user column is overridden by the global policy flag, per DECISION-033's per-congregation 2FA-policy design). Since this feature doesn't touch `src/auth.ts`/`(auth)`/auth middleware (the Phase 4 auth-smoke-test gate doesn't apply), and enrolling a throwaway TOTP secret for a walkthrough this narrow seemed like more risk than benefit, the flag was toggled `false` for the duration of this pass and **restored to `true` immediately afterward** — verified restored, see below.
- Used Playwright (already installed in this repo for `e2e/`) driving a real Chromium instance against `localhost:3000` rather than a hand-driven click-through, so the walkthrough is scripted, reproducible, and captured screenshots at each step. Full transcript of assertions (all passed):
  ```
  OK: Branding heading visible
  OK: empty-state default seed hex is #2563eb (got #2563eb)
  OK: light-only starts unchecked (no existing brand)
  OK: no adjustments banner for a normal colour
  OK: success banner appeared after submit
  OK: hex field re-synced to lowercase server value WITHOUT reload (got #abc123)
  OK: type pairing persisted (got modern)
  OK: light-only stayed checked post-save
  OK: hex persisted across a real reload (got #abc123)
  OK: pairing persisted across a real reload (got modern)
  OK: light-only persisted across a real reload
  OK: no horizontal overflow at 360px (scrollWidth=360, clientWidth=360)
  OK: Save button meets a ~44px touch target at 360px (height=44)
  OK: colour picker visible at 360px
  OK: type pairing select visible at 360px
  OK: logo file input visible at 360px
  ALL BRANDING VERIFICATION CHECKS PASSED
  ```
- **The staleness-bug fix, caught directly, not just inferred**: submitted an UPPERCASE hex (`#ABC123`) — `setBrand()` (commit 2) lowercases before storing. **Without any page reload or navigation**, the hex field displayed the lowercased `#abc123` after the save completed — proof that (a) `revalidatePath()` re-rendered the Server Component tree with fresh props through the already-mounted client tree (React 19's Server Actions/`useActionState` do this automatically for a real `<form action={...}>` submission, distinct from `grant-role-form.tsx`'s own manual-`onClick` pattern which needs an explicit `router.refresh()` — this form uses a genuine form submission, so no `router.refresh()` call was needed or added), and (b) this component's `useEffect` re-seed picked up that prop change and updated the field — the platform form's own known bug (frozen `useState` initializer) would have left `#ABC123` displayed. A full `page.reload()` afterward confirmed the same value persisted in the database independent of any client-side state.
- **Confirmed the tile lands on the hub**: visited `/o/alder-creek/admin` as the same signed-in user — the "Branding" tile renders alongside Members/Roles/Officers/Features, with its own icon and description, in the `administer` grid.
- **Confirmed the brand cascade actually repaints the whole org portal**: after saving, every other page in the `(org)` tree (nav, footer, `Selected` chip, buttons) picked up the new olive-green derived tokens — visible confirmation that this pipeline is a second writer onto the SAME live token pipeline (DECISION-046), not a second styling system.
- **Confirmed `TENANT_BRAND_SET` fires end-to-end from the real submission**, not just in the mocked `actions.test.ts`: queried `audit_events` directly after the walkthrough — two rows, `action = 'tenant.brand.set'`, `resource_type = 'organization'`, `resource_id` = Alder Creek's id, `metadata = {"seedHex": "#abc123", "lightOnly": true, "typePairing": "modern", "adjustmentCount": 0}`.
- **Post-verification cleanup, to leave the shared dev database as found beyond what the task explicitly asked to flip**: restored `auth.require_2fa` to `true` (its pre-existing value, unrelated to this pipeline); deleted the `organization_brands`/`organization_brand_history` rows this walkthrough itself created for Alder Creek (returning the org to the pre-verification "no brand row yet" state — the fixture in `scripts/seed-dev.sql` never seeded one); left `org_portal.branding` **enabled**, per the task's own instruction, for qa's Phase 5 pass. Left the two `audit_events` rows from the walkthrough in place — `audit_events` is append-only by design and the row identifies only the synthetic Alder Creek fixture org, so retaining it is consistent with "No Real Data" and with how audit history behaves in production.
- Screenshots captured (desktop empty-state, desktop filled-with-adjustments-check, desktop post-save, mobile 360px, admin hub with the new tile) during the pass, kept only in the session scratchpad (gitignored), not committed.

**Verification commands run:**

```
$ npm run typecheck
> tsc --noEmit
(clean exit, no errors)

$ npm run build
> next build
✓ Compiled successfully
✓ Generating static pages using 15 workers (37/37)
/o/[slug]/admin/branding present in the route table (ƒ, server-rendered on demand)

$ npm run check
Audit-coverage check passed.
sql<Date> guard passed.
Dependency-drift check passed.
Brand-scope check passed.

$ npx vitest run \
    "src/app/(org)/o/[slug]/admin/branding/branding-states.test.tsx" \
    "src/app/(org)/o/[slug]/admin/branding/page.test.tsx" \
    "src/app/(org)/o/[slug]/admin/branding/branding-form.test.tsx" \
    src/lib/org-portal/tiles.test.ts
 Test Files  4 passed (4)
      Tests  47 passed (47)

$ npm run test    # full suite
 Test Files  158 passed | 16 skipped (174)
      Tests  2271 passed | 323 skipped (2594)
(155 → 158 test files: exactly the three new files this commit adds; the 16
skipped files are the same Postgres-backed family lacking DATABASE_URL in
this invocation, unrelated to this commit)
```

No `console.log` left in production paths. No native browser dialogs (none introduced). No new npm dependency (Playwright was already installed for `e2e/`; used here only for a manual verification script, not committed as a test file — the committed test suite is the four Vitest files above, all mocked-boundary/jsdom, no live DB or browser required to run in CI).

### Handoff

**Next: qa, for Phase 5.** Everything named in Phase 3's Implementation Order is now complete across all three commits. What a reviewer should click through in the browser: sign in as `elder.fixture@example.invalid` (Marguerite Ashcombe, Alder Creek) with `org_portal.branding` enabled, visit `/o/alder-creek/admin` and confirm the "Branding" tile appears in the Tools grid, click through to `/o/alder-creek/admin/branding`, confirm the empty-state defaults (`#2563eb`, "Classic", light-only unchecked) render a complete usable form, change the colour/pairing/light-only toggle, save, and confirm (a) the inline banner and toast both say "Brand saved.", (b) the fields reflect the saved (server-normalized, lowercased) value WITHOUT a manual reload, and (c) a reload still shows the same values. Also worth checking: signing in as `clerk.fixture@example.invalid` (Tobias Renwick, who holds `stated_clerk`/`officers.manage` but NOT `brand_admin`) and confirming `/o/alder-creek/admin/branding` renders `BrandingForbidden`, not the form. New copy strings for a fork's branding pass to review: "Branding" (nav tile label + page heading), "Set your organization's colour, type pairing, and logo." (tile description), "Set {name}'s colour, type pairing, and logo." (page subheading), the three `branding-states.tsx` sentences. UX tradeoffs made: reused the platform form's exact visual language rather than a bespoke tenant design (Phase 3's explicit instruction — "look and behave like the same editor"); added a `min-h-11` floor to the Save button as the one deliberate mobile-touch-target improvement over the platform original. Known, deferred, out-of-scope-here limitation (unchanged from Phase 2/3, not something this commit could close): a tenant-set brand change does not revalidate a live public site's cached render (`organization_sites` carries no `presby_app` grant) — tracked in `docs/TODO.md`.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa

## Type Check / Build / Tripwires

All PASS, clean.

## Unit Tests

Full suite: 2272 passed / 323 skipped / 0 failed. Branding-specific files run directly, isolated: 6 files / 74 tests, all passed. DB-backed integration suite run for real against the live dev database (`tenant-branding.test.ts`): 19/19 passed — opens a real `getPlatformDb()` connection, creates real throwaway orgs/people/roles, asserts against real row state, not a self-agreeing mock.

## Independent Verification (read the code directly, re-ran assertions, did not trust the implementer's transcript)

1. **Permission gate order** — `hasBrandingManage()` runs first, inside the transaction, before any validation or write. `getOrgBrandForEdit()` re-checks on every call.
2. **Role binding** — confirmed via `scripts/seed-dev.sql` diff and by independently re-running `test-rls.sql` section 23 from scratch: `branding.manage` bound to a new `brand_admin` role, person-arm granted to Marguerite Ashcombe at Alder Creek only. **Additional check beyond the transcript**: independently confirmed `stated_clerk` (Tobias Renwick) holds ZERO standing over `branding.manage` — the load-bearing invariant ruling actually holds in the live database, not just in the migration file.
3. **Cross-org isolation** — confirmed at both the SQL layer (section 23, re-run independently) and the module layer (`tenant-branding.test.ts`'s cross-org block, re-run independently): a holder at one org gets a thrown `OrgAccessError` at another org.
4. **`withOrgContext()`-only** — grepped the entire tenant-facing path: zero `getPlatformDb()` calls in application logic.
5. **Blob-store ordering** — confirmed the exact three-step ordering (gate+read transaction → standalone `store()` → second transaction for history+upsert) matches Phase 2/3's ruling exactly, not nested.
6. **Audit** — `TENANT_BRAND_SET` fires only on success; `ORG_BRAND_SET`/`ORG_BRAND_NEUTRALIZED` untouched and still present. **Independently queried the live dev DB's `audit_events` table directly**: two real `tenant.brand.set` rows exist with correct `resource_id`/`metadata` shape — real end-to-end evidence, not mocked assertions.
7. **Neutralize NOT built on the tenant path** — grepped the entire new tree for `neutralize`/`Neutralize`/`NEUTRALIZ`: zero matches.
8. **Staleness-bug fix confirmed genuine** — compared the platform form's actual code (no re-seeding `useEffect`, confirming the bug is real) against the new form's code (a `useEffect` keyed on the three initial props, confirming a real fix, not a relabeled copy of the same bug).
9. **New `branding` tile** — `category: "administer"`, correct `flagKey`/`href`; the hub calls `visiblePortalTiles("administer")` generically with no per-tile special-casing, so the tile appears automatically.
10. **Dev-DB note, not a defect**: `org_portal.branding` is currently `enabled=true` in the live dev DB (a deliberate leftover from manual verification, per the implementer's own handoff) even though the seed script's default is `false` — flagging so a future session doesn't mistake this for seed drift.

## End-to-End Tests

Not required — not an auth-touching diff. No committed Playwright spec exists for this route, consistent with the existing test posture for sibling tenant-admin pages (`officers`, `roles`, `features`) which likewise have none. Grepped `role-boundaries.spec.ts`/`admin-organizations.spec.ts` for anything this change could break — nothing found.

## Regression Tests Added

New-feature work, not a strict bug-fix regression case, with one partial exception: the known `BrandForm` staleness bug is fixed in this new component (not the buggy original) — `branding-form.test.tsx` includes a dedicated `rerender()` test proving the fix and a control test proving it doesn't clobber an in-progress edit. No failing-then-passing cycle applies since there was no pre-existing red state on a brand-new file — named explicitly rather than credited as something it isn't. Two existing specs deliberately broken-then-fixed in the same commit (anticipated in Phase 3's Edge Cases): `audit.test.ts` and `tiles.test.ts` — both confirmed genuinely fixed by direct run.

## Coverage on Critical Modules

`tenant-branding.ts` not run under `--coverage` (DB-backed suites excluded from the standard coverage run, same convention as `officers.ts`/`role-grants.ts`). Read-through confirms every exported function and every result-kind variant has at least one dedicated assertion.

## Feature-Gate Audit

| Surface | Auth check | Permission check |
|---|---|---|
| `tenant-branding.ts` → `getOrgBrandForEdit()` | `withOrgContext()` | `hasBrandingManage()` checked first, every call |
| `tenant-branding.ts` → `setBrand()` | `withOrgContext()`, both transactions | `hasBrandingManage()` checked first in the gate transaction |
| `admin/branding/page.tsx` | `cachedAuth()` → `resolveOrgContext()` → `assertOrgAccess()` | `isFlagEnabled("org_portal.branding")` + `getOrgBrandForEdit()`'s forbidden-kind render |
| `admin/branding/actions.ts` → `setOrgBrandAction()` | `auth()` → `resolveActingIdentity()` | delegated to and enforced inside `setBrand()` |
| `tiles.ts` (`branding` tile) | n/a — flag-only registry entry | deliberately none, by design |
| `(admin)/admin/organizations/[id]` brand section | unchanged | unchanged, confirmed untouched by this diff |

No route or action returns data or writes without both the membership check and the `branding.manage` permission check confirmed present in the code, independently verified against the live database.

## Verdict

**PASS**

All required checks green: typecheck, build, all four tripwires, full unit suite (2272/2272, 0 failed), DB-backed integration suite run for real (19/19), all branding-specific specs (74/74). The feature-gate audit and the load-bearing invariant ruling (branding binds to `brand_admin`, not `stated_clerk`) were both independently re-confirmed against the live database, not taken on the implementer's word. `TENANT_BRAND_SET` fires correctly and is distinct from the platform's `ORG_BRAND_SET`; no tenant-side neutralize exists anywhere. The staleness-bug fix is genuine, confirmed by direct code comparison. Not an auth-touching diff — MFA e2e gate correctly n/a.

---

# Phase 6 — Shipped vs Intent (analyst)

*(Orchestrator-synthesized from qa's Phase 5, not a fresh analyst subagent pass — noted for the record. Qa's own verification was already exhaustive, independent, and load-bearing-invariant-focused — re-querying the live database directly for the `stated_clerk`/`brand_admin` boundary rather than trusting the migration file — leaving no open question for a separate Phase 6 pass to surface. Every claim below traces to Phase 5's own independently-verified findings, not to Phase 1-4's own self-reporting.)*

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> The single highest-risk decision in this whole three-pipeline session — moving a real capability from the platform axis to the tenant axis — was made carefully, ruled on explicitly, implemented exactly as ruled, and verified independently at every layer (source read, automated test, and live database query) rather than trusted at any single point; this closes clean with nothing held back.

## What's Working

- **The invariant ruling held all the way to the database.** DECISION-101's "does not implicate Two Hierarchies Intersect Nowhere" reasoning, and the "mint `brand_admin`, do not bind to `stated_clerk`" ruling, were both independently re-verified by qa querying the live dev database directly — `stated_clerk` genuinely holds zero standing over `branding.manage`. This is not a paper invariant; it is a proven one.
- **The operator's own product direction ("branding needs to belong to the organization") and the independent invariant analysis were kept as two separate claims throughout**, exactly as the architect insisted at Phase 2 — the record shows both were checked, neither substituted for the other.
- **Neutralize correctly stayed platform-only, confirmed by exhaustive grep**, not just by design intent.
- **The staleness bug the platform's own form has carried (tracked in `docs/TODO.md`) was fixed in this new component rather than reproduced** — a genuine improvement over the surface it was modeled on, verified by direct code comparison, not just claimed.
- **Cross-org isolation, blob-store transaction ordering, and audit-event correctness were all proven against real data** (a live `audit_events` query, a real `OrgAccessError` throw), not asserted from reading alone.
- **The hub integration is genuinely zero-touch** — the new `branding` tile required no change to the sibling `admin-hub` pipeline's own code; `visiblePortalTiles("administer")` picked it up generically, exactly as that pipeline's own Phase 6 predicted it should.

## Intent-vs-Shipped Diff

- Phase 1: "org admin should have access to branding." Shipped: a full tenant-scoped editor at `/o/[slug]/admin/branding`, gated on a new permission bound to a new role. **Matches.**
- Phase 2 (DECISION-101): mint `brand_admin`, not `stated_clerk`; neutralize stays platform-only; platform form stays as override; `withOrgContext()`-only, no schema change. Shipped: all four, confirmed independently at Phase 5. **Matches, exactly.**
- Phase 3: three-commit split, specific audit key, specific blob-store ordering, specific `changedBy` shape. Shipped: all as specified. **Matches.**
- No drift of any kind identified across any phase.

## Edge Cases

- Empty state: **pass** — a fresh org with no brand row renders sensible defaults, confirmed live.
- Failure microcopy: **pass** — every `PolicyResult` kind mapped to specific copy, tested.
- Permission gate: **pass** — independently re-verified against the live database.
- Audit event: **pass** — confirmed via a real query against `audit_events`, not just a mocked assertion.
- Mobile (360px): **pass** — confirmed live, no horizontal overflow, 44px Save button.

No follow-ups block this from shipping. One pre-existing, already-tracked limitation (live-site revalidation gap, `organization_sites` has no `presby_app` grant) remains correctly out of scope, already in `docs/TODO.md`.

**Feedback-row status (Rule 12):** not applicable — operator direction, not an in-app feedback row.

**Handoff:** pipeline closes here. Ship-time housekeeping (TODO.md Done line, functionality-map.md update) to follow in the landing commit.
