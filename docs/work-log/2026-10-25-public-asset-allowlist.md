# Public site asset route serves only publicly referenced images (F289) — Work Log

> **Slug:** `2026-10-25-public-asset-allowlist`
> **Surface:** (public) `/site/[slug]/assets/[key]` (and custom hosts)
> **Permission(s):** none
> **Flag(s):** none
> **Estimated complexity:** small–medium
> **Pipeline mode:** Bug-fix variant (may need a SECURITY DEFINER predicate → architect not skipped)
> **Numbers (pre-assigned 2026-10-25):** F289 (assigned by careers Phase 2); DECISION-277; migration 0072; dev port 3600. Must land before the first giving statement is issued (January).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (+ addendum: shared audience shape); Gaps 1–16 | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Complete; R1–R9; DECISION-277; fail-closed default kept; bundle JSON private | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | Complete; full design (migration 0072, definer, route, 23 call sites); departures recorded; operator question: directory flags vs roster photo | Design complete, implementers named | 2026-10-25 |
| 4 — Implementation | database-admin (Batch 1: 0072) then full-stack-developer (Batch 2: adapter, route, call sites, e2e) | Batch 1 complete (0072, D5 snapshot PASS, section 72 24/24, 7 mechanisms failing-first). Batch 2 complete 2026-10-26: adapter `audience` + `resolvePublic`, the route on the door, 23 call-site literals pinned by a source scan, 3 toggle strings, U1-U5 + D1 + D2 adapter half + D4 + E1; unit 9054 passed, touched DB suites green, e2e dev lane and production-build lane green, 360px checked; 1 design miss (a merged fixture's `ON CONFLICT` target) fixed via the patch | Batch 1 + Batch 2 green | 2026-10-26 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst), bug-fix variant (brief)

Work-log: `docs/work-log/2026-10-25-public-asset-allowlist.md`. Numbers: F289, DECISION-277, migration 0076 if needed, port 3600. I read the code in the worktree at main `2a25584`.

## VERDICT

READY WITH NOTES. The bug is real and the fix preserves intended behavior. Phase 2 (architect) is required. The notes below are Phase 2 and Phase 3 inputs, and two of them need an operator ruling (Open Questions 1 and 2).

## ONE-LINE TAKE

> The public asset route should serve a blob only if a public page actually references it as an image, and every other key (a statement PDF, a ticket screenshot, a content bundle, an unlisted person's photo) should get the same neutral 404 as a key that doesn't exist.

## Confirmed from code

**The route today.** `src/app/(public)/site/[slug]/assets/[key]/route.ts` does three things:
- It resolves the site with `resolveSiteOrganization(key)` (slug or verified host, flag on, site live).
- It calls `getBlobStore().resolve({organizationId, key})`, which selects `blob_assets` by `id` and `organization_id` only. Nothing checks content type or whether anything references the key.
- On a hit it returns the bytes with the stored `Content-Type` and `Cache-Control: public, max-age=31536000, immutable`.

**Key shape and error handling.** `[key]` is a raw uuid, not validated by the route. A non-uuid key makes Postgres throw, and the route catches it, logs `console.error` and returns 404. Misses are `{error:"Not found"}` with 404 and no `Cache-Control`.

**The entire set of public asset URL builders.** `urls.asset()` (`src/lib/site-urls.ts`) has exactly four call sites, plus one hand-built URL:

| Key class | Where the URL is built | Source of the key |
|---|---|---|
| Bundle images | `render-site-page.tsx:313`, `imageUrl(manifestKey)` | the stored bundle's `imageKeys` map, written by `/api/sites/ingest` from keys the server itself created |
| Brand mark | `render-site-page.tsx:95` (`resolveLogoUrl`), and `sites.ts:837` (`getPublishedSiteBrand`, the `/signin` logo via `slugSitePath`) | `organization_brands.mark_asset_key` |
| Staff and officer photos | `staff-directory.tsx:96` | `p.photo_key` from `presby_public_staff_roster` (0041/0042) |
| Committee member photos | `committee-directory.tsx:153` | `p.photo_key` from `presby_public_committee_roster` (0042) |

So the public site needs exactly four key classes. Nothing else needs this route:
- **Fonts** come from `next/font/google`, not blobs.
- **The content bundle JSON** is read server-side by `hydratePublishedSite` and never URL-addressed.
- **The wordmark** (`wordmark_asset_key`) has no public consumer today. The admin action comments call it "reserved for slice d".
- **The presbytery fallback** page builds no asset URLs.
- **Org-portal pages** inline the mark as a `data:` URI (`read-org-brand.ts:170`). Nothing authenticated depends on this route.

**The other consumers of `blob_assets` keys** (none may be reachable here):

| Consumer | Content type | Own serving path |
|---|---|---|
| `giving_statements.blob_asset_id` | `application/pdf` (tier 2 financial) | `/o/<slug>/giving/statements/[id]/download` and the admin twin; the key never reaches a client |
| `ticket_messages.attachment_asset_key` | PNG, JPEG, WEBP or PDF | `/o/<slug>/tickets/[id]/attachments/[key]` and `/admin/tickets/[id]/attachments/[key]` |
| `organization_sites.content_bundle_key` | `application/json` | server-side hydrate only |
| `people.photo_key` | image | inlined as `data:` by `resolvePhotoSrc` in the member directory |

Nothing in `src` currently writes `people.photo_key`. A repo-wide grep found only reads and the public roster functions. So roster photos on the public site are forward-looking, and today the first customer's site depends only on bundle images and the mark.

**Correction to the Source note.** It says statement keys never reach a client, which is true, and calls the bug "not exploitable today". It is nearly exploitable for tickets:
- A ticket attachment key is in the URL of the authenticated attachment route, so every ticket participant and platform admin holds it.
- The same key works unauthenticated at `/site/<slug>/assets/<key>` whenever the org has a live site.
- Any participant can therefore mint a permanent, unrevocable, year-cached public link to a support screenshot. Screenshots can show other people's data.
- This is also why an `image/*`-only rule is not enough. Ticket screenshots are images, so the reference allowlist is the real control and the type filter is belt and braces.

**Dedup.** `store()` dedups on `(organization_id, content_hash)`. Byte-identical content shares one row and one key across consumers. If an image is both a ticket attachment and a published bundle image, serving it publicly discloses nothing new. The allowlist must still be by reference, never by "this row was once public".

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Anonymous visitor | views a public page (platform host or custom host); the browser fetches its images, the logo and roster photos | every page view, CDN- and browser-cached |
| Anonymous visitor / prober | requests an arbitrary `/assets/<uuid>` | adversarial, continuous |
| Admin / member | none. This is a server-side closure of an over-broad read | n/a |

There is no new UI, copy or interaction. User-visible impact for legitimate pages is none.

## Flows

**Flow 1, legitimate image.** Entry: a public page at `/site/<slug>/...` or the custom-host path `/...`. Step: the HTML references `urls.asset(key)`. Step: the route resolves the org and checks that the key is publicly referenced. Outcome: 200 with bytes, `image/*`, and the cache header.
- Failure: a DB blip gives a neutral 404. The image is broken but the page is not (existing behavior, kept).

**Flow 2, key not publicly referenced.** Entry: a direct request for a statement PDF, a ticket attachment, a bundle JSON, an unlisted person's photo, or an unreferenced or nonexistent uuid.
- Outcome: one neutral 404, byte-identical for all of them (see Gaps).

**Flow 3, republish or un-publish.** A page is republished and an old image is dropped from the bundle, or a person is un-listed. Outcome: the old key returns the neutral 404 from then on. Copies already in shared caches, browsers and archives persist (see Gap 3).

## Permissions & Flags

- **Permission(s):** none. This is a public, session-free route, so the `FEATURES` axis is not involved.
- **Flag(s):** existing `sites.public_render` stays the only gate. No new flag, per the operator's "no new platform flags pre-live" rule. Rollback is a revert. A migration that only adds a function or column is harmless to leave in place.
- **Audit:** no mutation, so no `audit_events` row. Denied requests may be logged server-side. The key is an opaque uuid, so that is safe. Never log SQL or error text (existing house rule).

## Gaps the Request Didn't Address

1. **Image-type filter alone is insufficient.** Ticket attachments can be PNG, JPEG or WEBP. Reference-allowlist first, then require the blob's `content_type` to be in `image/png|jpeg|webp` as a second independent check. Also send `X-Content-Type-Options: nosniff`.

2. **The neutral 404 is an oracle risk, and it has two sub-requirements.**
   - *Same body, status and headers on every miss.* The misses are: not public, no such uuid, wrong org, site not live, flag off, DB error, malformed key. Today the body is `{error:"Not found"}` with no `Cache-Control`. Keep that body byte-for-byte for every miss, including the site-level miss, and add `Cache-Control: no-store` to all of them so a shared cache cannot hold a stale 404 against a key that later becomes referenced.
   - *Same work and timing.* The predicate must run before any bytes are fetched, so a private blob is never read. "Private but exists" and "doesn't exist" then take the identical code path, which also kills today's timing difference.

3. **Cache semantics.** `public, max-age=31536000, immutable` stays correct for bundle images and the brand mark. The key is the row's own uuid, the bytes never change, and the content was public by design. A key later dropped from the bundle or replaced as the mark stays in CDN and browser caches. That is no worse than any scraped website image and is acceptable. It is not right for person photos. A roster photo is personal data tied to a revocable opt-in (`public_listed`, `ends_on`). The 2026-08-27 staff-directory work-log already told admins that un-listing "cannot retract existing caches", but a one-year immutable TTL makes that worse than it needs to be. Recommend a per-class header: immutable for bundle images and marks, and a short public TTL (hours, or at most a day) for roster photos. Phase 2 and Phase 3 decide the exact numbers. Deploy cannot purge keys that were already fetched. There are none of concern today, but record this as an accepted residual.

4. **Malformed keys.** Validate `[key]` as a uuid at the top of the route and return the neutral 404 without touching the DB. Today a junk key triggers a Postgres error and a `console.error`, which gives a prober a free log-noise lever. The failure microcopy must not distinguish this case.

5. **Person photos and `hide_photo`.** The two anonymous roster functions (0041/0042) return `p.photo_key` without consulting `person_privacy.hide_photo`, which the member directory honors (`directory.ts:480`). The new predicate and the roster functions must agree exactly. If the predicate is stricter than the page, listed people get broken images. If it is looser, it leaks. Whatever the operator rules (Open Question 2), the predicate and both roster functions change together, in one migration. The predicate should mirror the roster definitions exactly:
   - staff positions and officer terms: `public_listed` and `ends_on is null`
   - committee memberships: `public_listed`, `ends_on is null`, and the group's `membership_source = 'managed'`
   - the org: `active`, with a `live` site

6. **The bundle's `imageKeys` is where the predicate is hard.**
   - *Approach A: parse at request time.* The key must be tested against `imageKeys` values inside a bundle blob of up to 10MB. Parsing it per image request is wasteful on cold cache, whether done in TypeScript or in a definer (`convert_from(bytes,'UTF8')::jsonb`).
   - *Approach B: materialize the allowed set* (a `uuid[]` or a table) at ingest. It is cheap per request and needs a backfill for every live site, including the first customer's. It must stay in lockstep with `content_bundle_key` (a trigger on `organization_sites` is more robust than relying on `recordSiteIngest`).
   - *Fixtures constrain the choice.* The e2e fixtures (`e2e/support/custom-hosts.ts` `insertBundle`, `e2e/public-sites.spec.ts`) and `scripts/seed-dev.sql` write `content_bundle_key` directly and bypass `recordSiteIngest`. A design that derives from the bundle at read time survives them, and a materialized one does not unless trigger-maintained. Hand this trade to Phase 2.

7. **The `imageUrl` fallback.** In `render-site-page.tsx:313` it is `urls.asset(site.imageKeys[manifestKey] ?? manifestKey)`. A manifest key missing from the map is emitted as a raw blob key, so an MDX author can name any uuid. After the fix such a URL just 404s, which is harmless, but the fallback is dead and misleading. Recommend dropping it so a missing image renders as no image, and note that the allowlist, not the renderer, is the control.

8. **Republish race.** A visitor holding old HTML who lazily loads an image whose key was dropped in a republish gets a 404 until reload. Pages are `force-dynamic`, so there is no server-cached stale HTML. Unchanged images keep the same key through content-hash dedup. Record this as an accepted residual rather than keeping the previous bundle's keys alive.

9. **Existing e2e fixtures will break and must be updated.** `serving.spec.ts:230,235,271,295`, `headers.spec.ts:70` and `lockdown.spec.ts:292` fetch `insertImage()` blobs that no bundle references (`insertBundle` writes `imageKeys: {}`). They must reference the image from the bundle or the tests turn into 404 assertions. `e2e/support/*` is on the Rule 16 shared-file list, so the orchestrator should own that edit at integration. A worktree implementer shouldn't edit it unilaterally.

10. **Not exposed by the route after the fix, confirmed, but pin them:** the wordmark (unless Open Question 3 says otherwise), `blob_assets` of other orgs (the existing `organization_id` guard stays), and rows that are `merged_into_id` targets (the roster functions don't special-case merges, so the predicate mirrors them).

## Adversarial pass

- **Redirect targets:** none. The route never redirects (R6), and that is kept.
- **State-machine shortcuts:** a key from an earlier publish is no longer served after republish (Flow 3).
- **Enumeration:** covered by Gap 2. Cross-org keys 404 as before (the `organization_id` filter stays). An unpublished or flag-off site collapses to the same 404 as today.
- **Input boundaries:** server-side uuid check (Gap 4). Case and encoding variants of a uuid must resolve to the same answer as the canonical form, with no second path.
- **Custom host:** the predicate keys on the `organizationId` the resolver returned, never on the request host or slug, so slug mode and host mode cannot diverge (R3).
- **Self-targeting:** not applicable.
- **Caller of the predicate:** if it is a `SECURITY DEFINER` function taking `(organization_id, key)`, it is granted to `presby_app`, which is the app's own connection. It returns a boolean only, and has the same defense-in-depth `active` and `live` checks as the other anonymous functions.

## Behavior to preserve

- All existing resolution and flag gates, the 404 body, no session read, and no redirect.
- `Content-Type` from the stored (sniffed) type, and the immutable header for bundle images and marks.
- Identical behavior on a platform host (`/site/<slug>/assets/<k>`) and a custom host (`/assets/<k>`).
- The `/signin` branded logo (platform host, mark key), which must keep working for any org whose mark is set.

## Regression tests, failing first

Write these against the current route so they fail before the fix.

**Route unit test** (`route.test.ts`, with a mocked predicate or definer):
- A statement-PDF key returns 404, the body equals the generic miss body, and `resolve` is never called.
- A ticket-attachment key (PNG content type) returns 404.
- A private roster-photo key (not listed, ended, or hidden per the ruling) returns 404.
- The JSON bundle key returns 404.
- A malformed key returns 404 and writes no `console.error`.
- A key that is public but whose blob is not an image type returns 404.
- A bundle image and the brand mark return 200 with the immutable header.
- A roster photo returns 200 with its (shorter) cache header.
- Every miss response is byte-identical, with `Cache-Control: no-store`.
- The predicate throwing returns 404.

**DB-backed test** (`*.db.test.ts`, serial, per `docs/testing.md`), one seeded blob per class, asserting the predicate:
- bundle image: true; mark: true
- listed current staff, officer and committee photos: true
- ended or unlisted roster photo: false (and `hide_photo` per the ruling)
- statement PDF, ticket attachment, bundle JSON, unreferenced image: false
- cross-org key: false
- a republish that drops an image: the old key flips to false

**RLS script** (`scripts/test-rls.sql`, run as `presby_app`):
- the predicate returns no rows for a foreign org and never reads outside the given org, if it is a definer function.

**e2e** (existing public-sites and custom-domains specs):
- On the platform host and on a custom host (canonical and alias), a bundle image and the mark return 200.
- On both, a statement-PDF-shaped blob, a ticket-attachment blob, a bundle-JSON blob and a random uuid each return an identical 404.
- The rendered home page's images actually load (checking natural size, not just a 200 on the HTML).
- Update the `insertImage` fixtures (Gap 9).
- Include the 360px viewport pass for a live page with a logo and images.

**Copy-truthfulness:** no strings change. Any comment or doc that says the route "resolves any blob key for the org" (e.g. the `render-site-page.tsx` header and `sites.ts:213`) becomes false and must be rewritten.

## Out of Scope (confirm with user)

- Photo upload and management UI.
- Purging CDN or archive copies of anything fetched before the fix.
- Authenticated or signed asset URLs.
- Serving the wordmark publicly.
- Re-keying existing blobs.
- The rename of the `presby_*` function prefix.

## Open Questions

1. **Operator ruling on cache lifetime for roster photos** (Gap 3). Keep immutable for all four classes (simplest, and consistent with the earlier "cannot retract" disclosure), or shorten for people. My recommendation is to shorten for people.
2. **Operator ruling on `hide_photo`.** Should a person who set `hide_photo` in the member directory still have their photo published when an admin opts them into the public listing? My recommendation is no, so the photo is dropped from both the roster functions and the predicate in the same migration. If the answer is "public_listed wins", record that as a DECISION so it stops being an accident.
3. **Wordmark:** allow in the predicate now (the architect's proposed shape) or only when it is first rendered? My recommendation is to allow only the mark until a page renders the wordmark, which is least privilege.
4. **Approach A or B** for the bundle image set (Gap 6) is a Phase 2 call, but note the cost of backfilling the first customer's live site in B.

## Phase 2 recommendation

Yes, Phase 2 is needed. Reasons:
- A `SECURITY DEFINER` predicate in an anonymous path, with migration 0076 (and the roster function changes if Open Question 2 goes the recommended way). It has to be hand-written DDL, with RLS and grant checks.
- The materialize-versus-derive choice affects fixtures, ingest and the proxy-adjacent public path.
- The cross-cutting invariants it touches: Isolation Is a Database Property, "A Custom Host Is a Key, Not an Identity", and DECISION-040's neutral-404 rule.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-25 |

**Handoff:** architect, Phase 2. Resolve Open Questions 1–3 with the operator, rule on Approach A versus B (Gap 6), and carry Gaps 1–9 into the Phase 3 design verbatim. The orchestrator owns the `e2e/support/custom-hosts.ts` edit (Rule 16).

Files read (all absolute, under `/Users/cshenso/git/presby-platform/presby-assets/`):
- `src/app/(public)/site/[slug]/assets/[key]/route.ts`
- `src/app/(public)/site/[slug]/assets/[key]/route.test.ts`
- `src/lib/storage/blob-store.ts`
- `src/lib/sites.ts`
- `src/lib/site-urls.ts`
- `src/app/(public)/site/[slug]/render-site-page.tsx`
- `src/app/(public)/site/[slug]/staff-directory.tsx`
- `src/app/(public)/site/[slug]/committee-directory.tsx`
- `src/app/api/sites/ingest/route.ts`
- `drizzle/0041_presby_public_staff_directory.sql`
- `drizzle/0042_presby_public_directory_primitives.sql`
- `e2e/support/custom-hosts.ts`
- `e2e/public-sites.spec.ts`

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The rulings below are binding on Phase 3. Five of them depart from DECISION-270 or the Phase 1 addendum, and each says why.

1. The bundle JSON is `private`.
2. The column keeps `DEFAULT 'private'` permanently.
3. `public_site` implies an image type, by CHECK.
4. The roster-photo branch calls the roster functions instead of copying their conditions.
5. Replaced marks in the history table stay `private`.

## Placement

- **Directory placement:** no new directory or module.
  - `resolvePublic()` and the `BlobAudience` type go in `src/lib/storage/blob-store.ts`, which stays the only file that touches `blob_assets` (DECISION-030).
  - A small pure uuid-key validator goes in `src/lib/storage/` (for example `blob-key.ts`). The route and `resolvePublic()` both use it.
  - The route stays at `src/app/(public)/site/[slug]/assets/[key]/route.ts`.
  - DDL goes in `drizzle/0072_presby_blob_audience.sql`. It is hand-written and unreleased until it is applied to production, so it can be corrected in place until then.
  - Drizzle declarations:
    - `audience` goes in `src/lib/db/domain/assets.ts`.
    - `asset_audience` goes in `support.ts` and `giving.ts`, with their FKs staying DDL-only as today.
    - The FK strings in `scripts/check-schema-parity.ts` (rows near :139 and :155) are updated.
- **Server vs Client split:** server only. No `'use client'`, no UI, no strings visible to users.
- **Dependencies:** none.
- **Route group:** `(public)/site/[slug]` (brandable). `check:brand-scope` and `check:proxy-imports` are unaffected, and the proxy is not touched.

## Invariants Touched

- **Isolation Is a Database Property.**
  - The audience split is enforced by the database: a CHECK, an immutability trigger, and composite FKs with a constant `'private'` column.
  - The new definer derives everything from the org id the resolver returned. It re-checks `active` and `live`, and is granted to `presby_app` only.
  - I read the live `development` catalog, not just `drizzle/`:
    - `blob_assets`, `ticket_messages` and `giving_statements` are `relforcerowsecurity = t`.
    - `presby_app` holds only SELECT and INSERT on `blob_assets`. `presby_platform` holds SELECT, INSERT, UPDATE and DELETE; `neondb_owner` holds everything.
    - The only trigger is `blob_assets_giving_statement_guard`: BEFORE UPDATE, no WHEN clause.
    - There are five FKs into `blob_assets`, all `(…, organization_id) → (id, organization_id)` and NO ACTION/NO ACTION.
    - Both roster functions are `prosecdef = t`, with `search_path=public, pg_temp` (from 0048) and EXECUTE granted to `presby_app` only.
    - This matches the migration text, so no grant drift (F38) was found.
  - The immutability trigger is needed because `presby_platform` and the owner hold UPDATE and only a trigger binds them.
- **A Custom Host Is a Key, Not an Identity / DECISION-040.**
  - The route keys on the `organizationId` from `resolveSiteOrganization()` and never on the request host.
  - Every key miss makes the same reads: one flag read, one site definer, one asset definer.
  - The 404 is byte-identical and `no-store`. The route never redirects (R6).
- **Permissions vs Flags.**
  - Nothing to merge: there is no `FEATURES.*` key, and `sites.public_render` stays the only gate.
  - No new flag (operator rule: no new platform flags before go-live).
- **The Brand Is a Cascade Override.** Untouched. The mark stays logo-as-content on the two brandable trees and inlined as `data:` in the org portal.
- **Never Hard-Delete.** No delete path is added. Careers' DECISION-263 already rejected a delete or non-deduping path on `blob_assets`, and this pipeline keeps that.
- **Composite Tenant Keys.** Strengthened: the two private-consumer FKs widen to three columns.

## Notes

### R1. Migration 0072: shape and order (one transaction, one file)

1. **Add the column.** `alter table blob_assets add column audience text not null default 'private'`.
   - A constant default changes metadata only. It does not rewrite the table and fires no trigger, so the 0056 guard is never reached.
   - Every existing row starts `private`. This is Gap 11's fail-closed inversion of DECISION-270's fail-open backfill, and I adopt it.
2. **Add the vocabulary CHECK.** `blob_assets_audience_allowed check (audience in ('public_site','private'))`.
   - It is a named CHECK, widened by drop-and-re-add, the same way `content_type_allowed` was widened in 0019/0020.
   - Not a Postgres enum: values can't be removed, and `ADD VALUE` has transaction-block restrictions.
   - Careers no longer needs an extension. DECISION-263 keeps applicant files out of `blob_assets`, so the "erasable class" is moot. Any future class needs its own decision.
3. **Pre-flip assertion.** The migration **raises** if any flip candidate (step 4) is also referenced by `ticket_messages.attachment_asset_key`, `giving_statements.blob_asset_id` or `people.photo_key`.
   - Under the old cross-consumer dedup, one row could be both a ticket screenshot and a bundle image.
   - Production and development both have 0 such rows today (orchestrator counts plus my development read: 0 tickets, 0 statements, 0 photos).
   - Failing loudly is better than shipping split logic nobody needs.
   - The assertion also guarantees the 0056 guard cannot fire during the flip.
4. **Flip proven-public rows to `public_site`,** image content types only:
   - every current `organization_brands.mark_asset_key`;
   - every `imageKeys` value inside every `organization_sites.content_bundle_key` bundle, **whatever the site's status**. A suspended site that is reinstated must still have its images. Parse with `convert_from(bytes,'UTF8')::jsonb -> 'imageKeys'`, same-org only.

   These stay `private`:
   - the bundle JSON itself (see R2);
   - wordmarks (operator ruling);
   - `organization_brand_history` marks (development has 3);
   - orphans, superseded bundles and their images.

   A future "restore previous brand" must re-`store()` the old bytes as `public_site`, not repoint at the historical key. Record this on DECISION-059's restore note.
5. **`blob_assets_public_site_is_image check (audience = 'private' or content_type in ('image/png','image/jpeg','image/webp'))`.** This makes Tier 1's type test a database property. The route's type test stays as a second check. Widening `public_site` to PDFs (for example bulletins) would need a deliberate CHECK change.
6. **Dedup key.**
   - Drop `blob_assets_org_hash_key`.
   - Add `blob_assets_org_audience_hash_key unique (organization_id, audience, content_hash)`.
7. **FK target.**
   - Add `blob_assets_id_org_audience_key unique (id, organization_id, audience)`.
   - **Keep `blob_assets_id_org_key`.** The brand and site FKs reference it.
8. **Re-key the private consumers.** The constant column is named **`asset_audience`** on every private consumer, and treasury's receipt table in 0073 follows the same name:
   - `ticket_messages add column asset_audience text not null default 'private' constraint ticket_messages_asset_audience_private check (asset_audience = 'private')`
   - Drop `ticket_messages_attachment_fk` and re-add it **with the same name** as `(attachment_asset_key, organization_id, asset_audience) → blob_assets (id, organization_id, audience)`. MATCH SIMPLE is the default and keeps a null attachment unchecked.
   - Do the same on `giving_statements`, keeping the name **`giving_statements_blob_fk`** and **NO ACTION on both delete and update** (`confdeltype = 'a'`, `confupdtype = 'a'`), so a referenced PDF stays undeletable on every connection (F44).
   - `ADD COLUMN … DEFAULT` and `ADD CONSTRAINT` fire neither `giving_statements_freeze` (BEFORE UPDATE) nor the insert guard.
   - The existing `giving_statements (organization_id, blob_asset_id)` index still serves the RI check.
   - Update `scripts/giving/test-rls-46.sql` 46o. It pins the column arrays exactly (`['blob_asset_id','organization_id']` / `['id','organization_id']`) and becomes the 3-column form.
9. **Immutability trigger, created after the flip.** `blob_assets_audience_immutable`, `before update of audience … when (old.audience is distinct from new.audience)`, raises `check_violation`.
   - It is a plain plpgsql trigger function with EXECUTE revoked from public, `presby_app` and `presby_platform` (0056 §7 style).
   - It and the 0056 guard are independent BEFORE UPDATE triggers. Either can raise, and they don't interact.
10. **Roster functions, `hide_photo` wins.** `create or replace` both `presby_public_staff_roster(text,text,boolean)` and `presby_public_committee_roster(text,text,boolean)` with the same signatures and return types.
    - Each `people p` join gains `left join person_privacy pp on pp.person_id = p.id and pp.organization_id = p.organization_id`.
    - Project `case when coalesce(pp.hide_photo, false) then null else p.photo_key end as photo_key`.
    - The person stays listed; only the photo is withheld. No other condition changes: no `directory_hidden`, no merge handling.
    - **Restate `set search_path = public, pg_temp` explicitly.** `create or replace` replaces `proconfig`, so 0048's hardening would be lost silently. Restate the revoke and grant too.
11. **Index.** `people_org_photo_key_idx on people (organization_id, photo_key) where photo_key is not null`. It is empty in every environment today and serves R3's exclusion.
12. **The asset definer (R3).**

### R2. The bundle JSON is `private` (departs from Gap 11/15 and DECISION-270)

- **Reason 1: only a server-side reader uses it.** `hydratePublishedSite` reads it and nothing addresses it by URL, so least privilege says `private`. R1 step 5's CHECK would forbid `public_site` JSON anyway.
- **Reason 2, the decisive one: deploy-window safety.**
  - `hydratePublishedSite` (`src/lib/sites.ts:416`) returns `not_found` for the **whole site** if the bundle row doesn't resolve.
  - If the bundle were `public_site` and new code read it with `public_site`, then a bundle ingested by old code during the window (so defaulted `private`) would take the site dark.
  - With the bundle `private` on both sides, the worst case is broken images, not a dark site.
- **Effect on callers:** ingest `:239` passes `private`, and the bundle read in `sites.ts` passes `private`. `organization_sites.content_bundle_key` stays unpinned. Pinning a public consumer protects nothing security-relevant, because a wrong pin fails closed.

### R3. `presby_public_site_asset(p_org uuid, p_key uuid) returns table (content_type text, bytes bytea, cache_class text)`

- `language sql stable security definer set search_path = public, pg_temp`; revoked from public, granted to `presby_app` only.
- Every check is in one statement and returns zero rows for every miss:
  - **Gates:** the org is `active`; its site is `live`; `b.organization_id = p_org`; the content type is one of the three image types.
  - **Roster branch:**
    - If `p_key::text` is the `photo_key` of **any** person in `p_org`, the key is governed by listing alone.
    - It is served only if it appears in `presby_public_staff_roster(slug)` or `presby_public_committee_roster(slug)` output, with the slug read from `organizations`. Serve with class `roster`, whatever the row's audience.
    - The predicate **calls the roster functions** instead of restating their conditions. The page and the predicate therefore cannot drift (Gap 5), and the `hide_photo` change in R1 step 10 reaches both through a single edit.
  - **Site branch (Tier 1):** otherwise, served only if `audience = 'public_site'`. Class `site`.
- **Why the exclusion matters.** A future photo writer that wrongly stores a photo as `public_site` cannot leak an unlisted person's photo. That is what makes deferring the `people.photo_key` FK safe.
- **DECISION-040:** no TypeScript-level pre-check of photo status. The route makes one call per key, whatever the key is.
- **Bytes** are read only for the one row returned. A private row and a nonexistent uuid take the same path (Gap 2).
- **`test-rls.sql`** (Rule 16; orchestrator at integration):
  - foreign-org key: zero rows;
  - unlisted, ended or `hide_photo` photo: zero rows;
  - `presby_app` cannot call the trigger function;
  - `presby_platform` UPDATE of `audience` is refused.

### R4. `people.photo_key` gets no FK in 0072

- It is `text`. An FK would mean converting it to `uuid`, which rewrites `people` and changes the roster functions' return types (drop and recreate).
- Nothing writes it today, and production and development have 0 rows.
- R3's exclusion covers the risk in the meantime.
- **Tracked follow-up (TODO):** the first photo-upload pipeline converts `photo_key` to `uuid`, adds `(photo_key, organization_id, asset_audience) → blob_assets(id, organization_id, audience)` pinned to `private`, and stores photos as `private`.

### R5. The deploy window: keep `DEFAULT 'private'` permanently (departs from Gap 14's "final state no default")

- DECISION-270's "no default" applies to `store()`, and it stands. The explicit choice lives in TypeScript.
- At the database level, a default that fails closed is not a hazard. Dropping it would:
  - break every upload if the code is rolled back after the drop (Phase 1 said "rollback is a revert");
  - add a second production step;
  - break the private fixtures that insert directly with no benefit (`e2e/support/giving-fixture.ts`, `src/lib/testing/giving-fixture.ts`, `scripts/giving/test-rls-46-issue.sql` all stay unchanged).
- A public-intent insert that forgets `audience` shows up as a 404, which e2e catches.
- **What old code can do in the window (0072 applied, new code not yet promoted):**
  - Its ingest stores images as `private`, so they show as broken images. This heals on the next re-ingest, because new rows get new `public_site` keys.
  - A logo upload can point the mark at a `private` row.
  - Its dedup lookup ignores audience, so a ticket upload byte-identical to a `public_site` image fails on the new FK. That is rare and fails loudly.
  - Statements are not affected: `GIVING_STATEMENTS_ENABLED` is off.
- **Runbook (Phase 3 writes it, deployment-engineer runs it):**
  - No site-repo push and no logo upload between applying 0072 and promoting the code.
  - **Post-deploy verification query:** every current mark and every `imageKeys` value of every bundle resolves to a `public_site` image row (expected: 1 mark, and 1 live bundle's images in production). Also check `curl -I` on one image of the live site, and its `x-vercel-cache` header.

### R6. `store()` / `resolve()` / `resolvePublic()` contracts

```ts
export type BlobAudience = "public_site" | "private";
interface StoreInput   { organizationId: string; bytes: Buffer; contentType: string; audience: BlobAudience } // required, no default
interface ResolveInput { organizationId: string; key: string; audience: BlobAudience }                    // required; filters audience = $
// resolveMeta(input: ResolveInput) — same contract
resolvePublic(input: { organizationId: string; key: string }):
  Promise<{ bytes: Buffer; contentType: "image/png" | "image/jpeg" | "image/webp"; cacheClass: "site" | "roster" } | null>
```

- `store()`:
  - dedups within `(organizationId, audience, hash)`;
  - throws `BlobValidationError` for `public_site` with a non-image type, before the CHECK would;
  - may return `audience` in `BlobRef`.
- `resolve()` and `resolveMeta()` match only the audience the caller names. A `private` caller can never read a `public_site` row, and the reverse holds too (Gap 16 and F298).
- `resolvePublic()` has no audience parameter. Its contract is R3's definer.
  - It returns `null` for a key that is not a uuid, without querying, so a future caller can't trigger Postgres cast errors.
  - Like `resolve()`, it does not catch DB errors; the route owns the catch.

**Call-site audiences.** The audience must be a **string literal** at each call site, so the source scan can read it.

`store()`:

| Call site | Audience |
|---|---|
| `tickets/actions.ts:108` | `private` |
| `admin/tickets/upload-attachment-action.ts:52` | `private` |
| `lib/giving/statements.ts:641` | `private` |
| `admin/organizations/[id]/actions.ts:288` | `public_site` |
| `lib/tenant-branding.ts:347` | `public_site` |
| ingest `:212` | `public_site` |
| ingest `:239` | **`private`** |

`resolve()`:

| Call site | Audience |
|---|---|
| Both ticket attachment routes | `private` |
| Both statement download routes | `private` |
| `person-avatar.tsx:44` | `private` |
| `sites.ts:416` (bundle) | `private` |
| `(org)/o/[slug]/admin/branding/page.tsx:113` | `public_site` |
| `admin/organizations/[id]/page.tsx:192` | `public_site` |
| `lib/brand/read-org-brand.ts:213` | `public_site` |
| The public route | `resolvePublic()` only |

`resolveMeta()`: all five ticket calls (`admin/tickets/[id]/page.tsx:129`, `admin/tickets/actions.ts:347`, `lib/tickets.ts:193/459/549`) pass `private`.

**Source-scan pin.** One unit test enumerates every non-test `getBlobStore().store(` / `.resolve(` / `.resolveMeta(` / `.resolvePublic(` call in `src/` against a checked-in `{file → audience}` table.
- An unlisted or changed call site fails the test. This catches the wrong-constant case that type checking cannot.
- The same test asserts `blob_assets`/`blobAssets` is imported only by `blob-store.ts` (DECISION-030).

**Catalog test** (DB-backed). Every FK whose `confrelid = 'blob_assets'::regclass` is either:
- on the public-reference allowlist (`organization_brands` mark and wordmark, `organization_sites` bundle), or
- includes an `asset_audience` column constrained to `'private'`.

This makes the rule mechanical for treasury 0073 and every later private consumer.

### R7. The public route

Order: validate the key, then the site, then the asset.

1. **Key validation.** `[key]` must match the hyphenated 36-character uuid form, case-insensitive, and is then lowercased, so a case variant gives the canonical answer with no second path. Anything else gets the neutral 404 with **no read and no `console.error`**.
2. **`resolveSiteOrganization(siteKey)`.** Unchanged.
3. **`resolvePublic()`.** Wrapped in try/catch. The log is `{ mode, slug, key }` only, never the error text.

**Responses:**

- **Neutral 404:** one module-level helper builds a fresh response each time.
  - Body: `{"error":"Not found"}`, status 404, with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
  - The same helper serves every miss: malformed key, site miss, flag off, read failure, not public, nonexistent, foreign org.
- **200:** stored `Content-Type` (one of the three image types) and `X-Content-Type-Options: nosniff`. `nosniff` is already global in `next.config.ts:86`; it is set on the route as well so the unit test can pin it.
  - `site` class: `Cache-Control: public, max-age=31536000, immutable`, unchanged.
  - `roster` class: **`Cache-Control: private, max-age=86400`**. That is the operator's "about a day". `private` stops shared and downstream caches from keeping a person's photo after they are un-listed, and there is no `s-maxage`.

**What Vercel's CDN holds.** Per Vercel's CDN-cache docs, a function response is stored at Vercel's edge only with `s-maxage` or a CDN-targeted header.
- So today's `max-age`-only header was held by browsers and any downstream cache, not by Vercel's edge. This answers F297's "must be checked" item as a statement from the docs; the runbook's `x-vercel-cache` check confirms it.
- Accepted residual: copies already in browsers or archives cannot be purged. No private-consumer row exists in production, so there is nothing of concern.

**Smaller items:**
- Drop the `?? manifestKey` fallback in `render-site-page.tsx:313` (Gap 7).
- Rewrite every comment that says "resolves any blob key for the org": the route header, the `sites.ts:213` doc, and the `blob-store.ts` header (copy truthfulness).

### R8. Tier 1 corrections to the Phase 1 test list (Phase 3 must apply them)

- **"Republish drops an image → old key false" and "unreferenced image → false" are Tier 2 properties.**
  - Under Tier 1, a `public_site` image stays fetchable after republish. Only orphans left by the backfill are dark.
  - Reword these tests, or move them to the Tier 2 follow-up. A test that asserts Tier 2 would fail against a correct Tier 1 build.
- **Gap 9 under Tier 1.** The fixtures need `audience = 'public_site'` on images. They do **not** need the bundle to reference them.
  - `e2e/support/custom-hosts.ts` (`:356`, `:371`): images become `public_site`; the bundle insert stays default `private`. This is a Rule 16 shared file, so the orchestrator applies it as an integration patch, which the implementer drafts in the work-log.
  - `e2e/public-sites.spec.ts:227` (the bundle) needs no change.
- **`scripts/seed-dev.sql` needs no edit.** It writes no `blob_assets` rows; grep finds only a comment at `:938`.
- **Additional tests:**
  - A migration test on a pre-0072 snapshot with an issued statement: 0072 applies, and the statement PDF stays immutable and undeletable.
  - Step 3's assertion raises on a seeded cross-referenced row.
  - The roster functions return `photo_key` null for a `hide_photo` person who is still listed, and the predicate agrees.

### R9. Production sequencing

1. 0072 is applied and then the code is promoted, in **one release**, followed by the R5 verification.
2. Only after that can `GIVING_STATEMENTS_ENABLED` be set. Before January.
3. Treasury 0073 has a hard dependency: its receipt FK targets `blob_assets_id_org_audience_key`.
4. Careers 0075 depends on 0072 only for migration ordering (DECISION-263).

### Tracked follow-ups (TODO lines at integration)

1. **Tier 2 (takedown by reference).** Require that a key is currently referenced by the live bundle's `imageKeys` or the mark.
2. **The `people.photo_key` uuid conversion and FK,** with the first photo writer (R4).
3. **Brand restore must re-store bytes** (R1 step 4).
4. **Optional, performance only:** add `s-maxage` to the `site` class. This conflicts with Tier 2 takedown, so decide it together with Tier 2.

### Proposed DECISION-277

**DECISION-277 — `blob_assets.audience` (fail-closed); the public asset route serves a `public_site` image, or the photo of a person currently listed, through one definer; private consumers pin `'private'` by composite FK.**

**Status:** Resolved (architect, Phase 2) · **Date:** 2026-10-25 · **Feature:** `2026-10-25-public-asset-allowlist` (F289; F297/F298; migration 0072)

- **Column.**
  - `audience text not null default 'private'`, CHECK `in ('public_site','private')`, immutable by trigger. The default is permanent and fails closed. `store()` takes `audience` as a required argument with no default.
  - CHECK: `public_site` implies an image type.
  - Dedup key: `(organization_id, audience, content_hash)`.
- **Backfill.** Inverts DECISION-270's direction. Everything starts `private`; current marks and the `imageKeys` of every current bundle flip to `public_site`. The bundle JSON, wordmarks, historical marks and orphans stay `private`. The migration raises if a flip candidate is also referenced by a private consumer.
- **Private consumers.** `ticket_messages` and `giving_statements` (and, from 0073, receipts) carry `asset_audience = 'private'` in a composite FK to `(id, organization_id, audience)`. FK names and NO ACTION semantics are kept. A catalog test enforces the rule for every FK into `blob_assets`.
- **Serving.**
  - `resolvePublic()` → `presby_public_site_asset(org, key)`. Image types only.
  - A key that is any person's `photo_key` is served only while the roster functions list it, under `private, max-age=86400`.
  - Otherwise a key is served only if it is `public_site`, under `public, max-age=31536000, immutable`.
  - Every miss gets one `no-store` 404. The key is validated as a uuid before any read.
  - `hide_photo` withholds the photo from both roster functions (operator ruling).
- **Accepted residuals.**
  - Tier 1 has no takedown: a `public_site` image stays fetchable after it drops out of a bundle (Tier 2 is a follow-up).
  - Copies already in browsers or archives cannot be purged.
  - Old code running between the migration and promotion can produce `private` images, which a re-ingest heals.
- **Revisit if** a non-image class needs public serving, a photo writer ships (add the `photo_key` FK), or takedown is required (Tier 2).

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete; DECISION-277 proposed; rulings R1–R9; F289/F297/F298 disposed (Tier 2, photo-key FK, brand-restore re-store tracked as follow-ups) | Approved with suggestions | 2026-10-25 |

**Handoff:** tech-lead, Phase 3.
- Carry R1–R9 into the Carry-forward table one by one, including the five departures from DECISION-270 and the addendum (R1 step 4 history marks, R2, R3, R5, R1 step 5).
- Write the R5 runbook and verification query.
- Draft the Rule 16 integration patches for the orchestrator: `e2e/support/custom-hosts.ts`, `scripts/test-rls.sql`, and the `docs/TODO.md` lines. `scripts/seed-dev.sql` needs none.
- Name the implementer. I recommend database-admin for 0072, then api-developer for the adapter, route and call sites, or full-stack-developer if you keep it as one batch.

Everything I read was read-only, under `/Users/cshenso/git/presby-platform/presby-assets/` unless noted:
- `docs/work-log/2026-10-25-public-asset-allowlist.md`
- `src/lib/storage/blob-store.ts`
- `src/app/(public)/site/[slug]/assets/[key]/route.ts`
- `src/lib/sites.ts` (lines 405–430 and 573–658)
- `src/app/api/sites/ingest/route.ts`
- `drizzle/0016_presby_brand_storage.sql`, `0019_presby_ticket_support.sql`, `0020_presby_public_sites.sql`, `0041_presby_public_staff_directory.sql`, `0042_presby_public_directory_primitives.sql`, `0048_presby_security_b.sql`, `0056_presby_giving_statements.sql`
- `scripts/giving/test-rls-46.sql` (46o)
- `scripts/check-schema-parity.ts`
- `next.config.ts`
- `/Users/cshenso/git/presby-platform/presby-treasury/docs/work-log/2026-10-25-treasury.md` (DECISION-270)
- `/Users/cshenso/git/presby-platform/presby-careers/docs/work-log/2026-10-25-careers.md` (DECISION-263)
- The live `development` catalog, read-only, via `pg_class`, `pg_policies`, `aclexplode`, `pg_trigger`, `pg_constraint` and `pg_proc`
- Vercel's CDN-cache documentation

---

# Phase 3 — Technical Design (tech-lead)

**Date:** 2026-10-25 · **Classification:** Feature (migration, `SECURITY DEFINER` function, new route behavior), bug-fix variant of Phase 3 in name only: this is a full design. **Numbers:** F289 (F297/F298 are treasury's, closed here), DECISION-277, migration 0072, dev port **3600**. Read against the live tree at `2a25584` in `/Users/cshenso/git/presby-platform/presby-assets`.

## Summary

The public asset route (`/site/<slug>/assets/<key>`, and `/assets/<key>` on a church's own domain) serves any `blob_assets` row of the organization by uuid, with a one-year immutable cache header. Statement PDFs (tier 2), ticket screenshots, content bundles and people photos are all reachable that way by anyone holding the uuid, and a ticket participant holds the uuid of every attachment. We close it as a database property, in four moves. (1) `blob_assets.audience` (`public_site` | `private`, default `private`, immutable by trigger) splits the table; every current mark and every image named in a bundle's `imageKeys` is flipped to `public_site` by 0072, everything else starts and stays `private`. (2) The private consumers (`ticket_messages`, `giving_statements`) carry a constant `asset_audience = 'private'` inside a three-column composite FK, so a private consumer physically cannot reference a public row, and treasury's 0073 follows the same rule. (3) One anonymous `SECURITY DEFINER` function, `presby_public_site_asset(org, key)`, is the only door the public route uses: it serves a `public_site` image, or the photo of a person the roster functions currently list (never both rules for one key), otherwise zero rows. (4) The route validates the key as a uuid, calls the definer, and answers every miss with one byte-identical `no-store` 404; roster photos get `private, max-age=86400`, site images and marks keep the year-long immutable header. The operator's rulings are built in: `hide_photo` wins (both roster functions withhold the photo), roster photos cache about a day, the wordmark stays private. Tier 1 only: there is no takedown of a `public_site` image (tracked follow-up).

## Feasibility check (live tree, before naming the implementers)

| Check | Result |
|---|---|
| Function signatures are valid SQL | `presby_public_site_asset(p_org uuid, p_key uuid)` has no defaults. The two roster functions keep their exact signatures (`(text, text default null, boolean default null)`), so `create or replace` is legal and no `drop function` is needed; the return row types are unchanged. |
| `ALTER`/`DROP` against columns or tables other code depends on | Dropped objects: constraint `blob_assets_org_hash_key` (grep: referenced only by `assets.ts:81`, which this design changes; no function body, no `ON CONFLICT (organization_id, content_hash)` anywhere in `src`, `scripts`, `e2e`), and the constraints `ticket_messages_attachment_fk` and `giving_statements_blob_fk` (re-added under the same names; referenced by `giving-statements.db.test.ts:425,451` by name only, `giving.schema.test.ts:162-171` reads the **0056 text**, which stays unchanged, `test-rls-46.sql` 46o, `check-schema-parity.ts`). The only `SECURITY DEFINER` bodies that touch `blob_assets` are `presby_giving_guard_statement_insert` (reads `id`, `organization_id`, `content_type`, `content_hash`) and `presby_giving_guard_statement_blob` (reads `giving_statements`); neither names a dropped object, and a new column breaks neither. |
| New CHECKs/triggers vs `scripts/seed-dev.sql` and fixture files | `seed-dev.sql` and `seed-dev-giving.sql` write no `blob_assets` row (grep: one comment at `seed-dev.sql:938`). Raw writers: `e2e/support/custom-hosts.ts` (images need `public_site`; bundle stays default `private`, R8), `e2e/support/giving-fixture.ts:358` and `src/lib/testing/giving-fixture.ts:353` (statement PDF and bundle: default `private`, unchanged), `scripts/giving/test-rls-46-issue.sql` (PDF: default `private`, unchanged), `e2e/public-sites.spec.ts:227` (bundle: default `private`, unchanged). None is refused by `blob_assets_public_site_is_image` because only the image fixtures set `public_site`. |
| New FKs: which column carries the tenant id | All three composite FKs are `(…, organization_id, asset_audience) → blob_assets (id, organization_id, audience)`; `organization_id` is the tenant column on both sides. `blob_assets (id, organization_id, audience)` gets its own unique key (the FK target); `blob_assets_id_org_key` stays because the brand and site FKs reference it. |
| Roster function access from a definer | The roster functions are `revoke … from public; grant … to presby_app`. The new definer is owned by the migration owner, which keeps EXECUTE on them; same mechanism the roster functions already use against FORCE-RLS tables (0041). |
| Migration must run in one transaction | No `begin`/`commit` in the file (0057 and 0047 carry their own and need no `-1`; 0072 does not, so `-1` is **mandatory** and the file stays atomic under the drizzle migrator too). Idempotent so a failed unwrapped run can be repeated. |
| Journal | `drizzle/meta/_journal.json` is a Rule 16 shared file; the entry is staged below as an integration patch. No test reads the journal. |

## Permissions & Flags

- Permission keys: none. The route is session-free and public. No `FEATURES.*` change; no role binding.
- Flags: none new (operator rule: no new platform flags before go-live). `sites.public_render` stays the only gate, read by `resolveSiteOrganization()` as today. Rollback is a code revert (see Runbook).
- **Observation, not a change (Edge Case 19):** the roster-photo branch calls the roster functions, which do not read `sites.public_staff_directory` / `sites.public_committee_directory`. A listed person's photo is therefore fetchable by its exact uuid while the directory block is switched off, although nothing on any page links to it. The roster functions have never read those flags; the listing bit is the consent. Accepted by tech-lead as consistent with 0041/0042; flagged to the operator in the handoff because "flag off" could be read as "nothing public".
- Audit: none. No mutation; denied requests are logged server-side only on a read failure (`{ mode, slug, key }`, never error text). The migration itself is provisioning (no audit row, per 0057 precedent).

## API Contract

### `GET /site/[slug]/assets/[key]` (and `/assets/[key]` on a church's own host, rewritten by the proxy)

Route file unchanged: `src/app/(public)/site/[slug]/assets/[key]/route.ts`. Behavior, in this order:

1. `parseBlobKey(key)` (new, `src/lib/storage/blob-key.ts`). Not a hyphenated 36-character uuid (case-insensitive) → neutral 404. **No read, no `console.error`.** Otherwise lowercased, so a case variant gets the canonical answer on the one path.
2. `resolveSiteOrganization(siteKey)`. Unchanged; any `kind !== "ok"` → neutral 404.
3. `getBlobStore().resolvePublic({ organizationId, key })` in `try/catch`. A throw logs `console.error("[site-assets] public asset read failed; treating as not found", { mode, slug, key })` and returns the neutral 404. `null` → neutral 404.
4. Hit → 200 with the stored `Content-Type` (one of png/jpeg/webp), `X-Content-Type-Options: nosniff`, and by class:
   - `site`: `Cache-Control: public, max-age=31536000, immutable` (unchanged for bundle images and marks).
   - `roster`: `Cache-Control: private, max-age=86400`. `private` keeps shared caches from holding a person's photo after they are un-listed; no `s-maxage`.

**Neutral 404** (one module-level `notFound()` that builds a fresh response each time, used by every miss: malformed key, site miss, flag off, read failure, not public, nonexistent, foreign org, wrong type): status 404, `Content-Type: application/json`, body exactly `{"error":"Not found"}`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Built with `new NextResponse(JSON.stringify(...), { status, headers })`, not `NextResponse.json`, so the header set is explicit and test-pinnable.

Never redirects (R6, kept), reads no session, sets no cookie.

### Adapter (`src/lib/storage/blob-store.ts`, R6 verbatim plus implementation notes)

```ts
export type BlobAudience = "public_site" | "private";
export type PublicImageType = "image/png" | "image/jpeg" | "image/webp";
interface StoreInput   { organizationId: string; bytes: Buffer; contentType: string; audience: BlobAudience } // required, no default
interface ResolveInput { organizationId: string; key: string; audience: BlobAudience }                      // required; filters audience = $
// BlobRef gains `audience: BlobAudience`
resolvePublic(input: { organizationId: string; key: string }):
  Promise<{ bytes: Buffer; contentType: PublicImageType; cacheClass: "site" | "roster" } | null>
```

- `store()`: dedup lookup is `(organization_id, audience, content_hash)`; the insert writes `audience`; `public_site` with a non-image type throws `BlobValidationError` **before** the CHECK would (message in Copy).
- `resolve()` / `resolveMeta()`: `where id = $ and organization_id = $ and audience = $`. A `private` caller never reads a `public_site` row and the reverse holds.
- `resolvePublic()`:
  - `parseBlobKey(key)`; `null` → return `null` without querying.
  - One statement through `db` (the `presby_app` connection) with **no org GUC**, exactly like `getPublishedSite()`: ``db.execute(sql`select content_type, bytes, cache_class from presby_public_site_asset(${organizationId}::uuid, ${canonical}::uuid)`)``, rows read as `(result as unknown as { rows?: Row[] }).rows`.
  - Second, independent type check in TypeScript: `content_type` must be one of the three image types and `cache_class` one of `site | roster`, else return `null` (belt and braces, Phase 1 Gap 1).
  - `Buffer.from(row.bytes)` so a `Uint8Array` from the driver becomes a `Buffer`.
  - **Does not catch** DB errors (the route owns the catch, like `resolve()`).
- Update the header comment (copy truthfulness): the module is still the only file that queries `blob_assets` (DECISION-030); `resolvePublic()` reaches it through a definer function, which is a stricter form of the same rule.

### Uuid key validator (`src/lib/storage/blob-key.ts`, pure, no `server-only`, safe for tests and the route)

```ts
const BLOB_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseBlobKey(raw: string): string | null { return BLOB_KEY.test(raw) ? raw.toLowerCase() : null; }
```
Any hex version/variant digit is accepted (fixtures use `e2e93001-0000-4000-8000-…`); ASCII only; `$` without the `m` flag does not match before a trailing newline in JS, so `"<uuid>\n"` is rejected (pinned by U1).

### Every call site and its audience literal (R6 tables, verified against the live tree by grep)

The audience is a **string literal in the call's own object literal** at every site (the source scan reads it).

| Method | File:line (live tree) | Literal |
|---|---|---|
| `store` | `src/app/(org)/o/[slug]/tickets/actions.ts:108` | `"private"` |
| `store` | `src/app/(admin)/admin/tickets/upload-attachment-action.ts:52` | `"private"` |
| `store` | `src/lib/giving/statements.ts:641` | `"private"` |
| `store` | `src/app/(admin)/admin/organizations/[id]/actions.ts:288` (logo) | `"public_site"` |
| `store` | `src/lib/tenant-branding.ts:347` (logo) | `"public_site"` |
| `store` | `src/app/api/sites/ingest/route.ts:212` (images) | `"public_site"` |
| `store` | `src/app/api/sites/ingest/route.ts:239` (bundle JSON) | **`"private"`** (R2) |
| `resolve` | `src/app/(org)/o/[slug]/tickets/[id]/attachments/[key]/route.ts:60`, `src/app/(admin)/admin/tickets/[id]/attachments/[key]/route.ts:40` | `"private"` |
| `resolve` | `src/app/(org)/o/[slug]/giving/statements/[statementId]/download/route.ts:73`, `src/app/(org)/o/[slug]/admin/giving/statements/[statementId]/download/route.ts:42` | `"private"` |
| `resolve` | `src/app/(org)/o/[slug]/directory/person-avatar.tsx:44` | `"private"` |
| `resolve` | `src/lib/sites.ts:416` (bundle, `hydratePublishedSite`) | `"private"` |
| `resolve` | `src/app/(org)/o/[slug]/admin/branding/page.tsx:113`, `src/app/(admin)/admin/organizations/[id]/page.tsx:192`, `src/lib/brand/read-org-brand.ts:213` (marks) | `"public_site"` |
| `resolveMeta` | `src/app/(admin)/admin/tickets/[id]/page.tsx:129`, `src/app/(admin)/admin/tickets/actions.ts:347`, `src/lib/tickets.ts:193`, `:459`, `:549` | `"private"` |
| `resolvePublic` | `src/app/(public)/site/[slug]/assets/[key]/route.ts` | none (the definer is the contract) |

The grep found exactly these 7 + 11 + 5 + 1 sites; none is missing from the architect's R6 tables.

**Forward entries (coordinator instruction, recorded in the scan table, not yet in the tree):** `src/lib/reimbursement/receipts.ts` (treasury Increment 1, migration 0073, after F289): `store` audience `"private"`, `resolve` audience `"private"`. Careers uses no `blob_assets` (DECISION-263): no careers rows.

### Other source changes

- `src/app/(public)/site/[slug]/render-site-page.tsx:312`: `imageUrl` drops `?? manifestKey`. A manifest key with no entry in `site.imageKeys` returns `urls.asset(MISSING_IMAGE_KEY)` where `MISSING_IMAGE_KEY = "00000000-0000-0000-0000-000000000000"` (a constant that never exists, so it always gets the neutral 404). **Why not "no image":** `presby-site-kit@4.0.0` types `imageUrl` as `(key) => string` and its Hero renders `<img src={imageUrl}>` whenever the author named an image; returning `""` or `undefined` is outside the contract and untestable here. Result is the same broken image as today for an author's typo, but no author-chosen uuid ever reaches the route. A site-kit change to render nothing is a tracked follow-up (TODO). The allowlist, not the renderer, is the control.
- Comment rewrites (Copy section lists them).

## Data Model

**Migration `drizzle/0072_presby_blob_audience.sql`**, one transaction (`psql -1`), hand-written, idempotent. Steps in **R1's exact order**; SQL below is the binding shape (names, order, clauses), the implementer may adjust formatting and comments.

```sql
-- 1. column (constant default: metadata only, no rewrite, fires no trigger, so the 0056 blob guard is never reached)
alter table blob_assets add column if not exists audience text not null default 'private';

-- 2. closed vocabulary (named CHECK, widened later by drop-and-re-add like content_type_allowed; not an enum)
alter table blob_assets drop constraint if exists blob_assets_audience_allowed;
alter table blob_assets add constraint blob_assets_audience_allowed check (audience in ('public_site','private'));

-- 3 + 4. candidate set, pre-flip assertion, flip. Session temp table, no ON COMMIT clause (the file runs under -1;
--        an ON COMMIT DROP table would vanish under autocommit); dropped explicitly at the end of step 4.
drop table if exists _blob_audience_flip;
create temp table _blob_audience_flip (organization_id uuid not null, id uuid not null, primary key (organization_id, id));

insert into _blob_audience_flip (organization_id, id)          -- every current mark, same org, image types only
select b.organization_id, b.id
  from organization_brands ob
  join blob_assets b on b.id = ob.mark_asset_key and b.organization_id = ob.organization_id
 where b.content_type in ('image/png','image/jpeg','image/webp')
on conflict do nothing;

do $$                                                          -- every imageKeys value of every bundle, WHATEVER the site's status (R1.4)
declare r record; v_keys jsonb;
begin
  for r in
    select s.organization_id, b.bytes
      from organization_sites s
      join blob_assets b on b.id = s.content_bundle_key and b.organization_id = s.organization_id
     where b.content_type = 'application/json'
  loop
    begin
      v_keys := convert_from(r.bytes, 'UTF8')::jsonb -> 'imageKeys';
    exception when others then
      raise notice '0072: the bundle of organization % is not parseable JSON; its images stay private (the site is dark anyway: hydratePublishedSite returns not_found)', r.organization_id;
      continue;
    end;
    if jsonb_typeof(v_keys) is distinct from 'object' then continue; end if;
    insert into _blob_audience_flip (organization_id, id)
    select r.organization_id, b.id
      from jsonb_each_text(v_keys) k
      join blob_assets b on b.organization_id = r.organization_id
                        and b.id = (case when k.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then k.value::uuid end)  -- CASE: the cast must not run before the shape test
     where b.content_type in ('image/png','image/jpeg','image/webp')
    on conflict do nothing;
  end loop;
end $$;

do $$                                                          -- R1.3: fail loudly, never ship split logic nobody needs
declare v_bad integer;
begin
  select count(*) into v_bad from _blob_audience_flip f
   where exists (select 1 from ticket_messages t where t.organization_id = f.organization_id and t.attachment_asset_key = f.id)
      or exists (select 1 from giving_statements g where g.organization_id = f.organization_id and g.blob_asset_id = f.id)
      or exists (select 1 from people p where p.organization_id = f.organization_id and lower(p.photo_key) = f.id::text);
  if v_bad > 0 then
    raise exception '0072: % blob(s) are both published (a mark or a bundle image) and used by a private consumer (a ticket attachment, a contribution statement or a person photo); resolve that before applying (docs/work-log/2026-10-25-public-asset-allowlist.md, R1 step 3)', v_bad
      using errcode = 'check_violation';
  end if;
end $$;

drop trigger if exists blob_assets_audience_immutable on blob_assets;   -- re-run safety: the flip must be able to heal a re-run
do $$ declare v_n integer; begin
  update blob_assets b set audience = 'public_site'
    from _blob_audience_flip f
   where b.id = f.id and b.organization_id = f.organization_id and b.audience <> 'public_site';
  get diagnostics v_n = row_count;
  raise notice '0072: flipped % blob(s) to public_site', v_n;
end $$;
drop table _blob_audience_flip;

-- 5. a public_site row is an image, as a database property (after the flip, so the flip is image-only by construction)
alter table blob_assets drop constraint if exists blob_assets_public_site_is_image;
alter table blob_assets add constraint blob_assets_public_site_is_image
  check (audience = 'private' or content_type in ('image/png','image/jpeg','image/webp'));

-- 6. dedup is per audience (F298)
alter table blob_assets drop constraint if exists blob_assets_org_hash_key;
alter table blob_assets drop constraint if exists blob_assets_org_audience_hash_key;
alter table blob_assets add constraint blob_assets_org_audience_hash_key unique (organization_id, audience, content_hash);

-- 7. the FK target. Added through the 0016 `if not exists (select 1 from pg_constraint …)` pattern, never dropped:
--    on a re-run the FKs below already depend on it. blob_assets_id_org_key STAYS (brand and site FKs reference it).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'blob_assets_id_org_audience_key') then
    alter table blob_assets add constraint blob_assets_id_org_audience_key unique (id, organization_id, audience);
  end if;
end $$;

-- 8. re-key the two private consumers: constant column, same constraint names, NO ACTION on both sides (F44)
alter table ticket_messages add column if not exists asset_audience text not null default 'private';
alter table ticket_messages drop constraint if exists ticket_messages_asset_audience_private;
alter table ticket_messages add constraint ticket_messages_asset_audience_private check (asset_audience = 'private');
alter table ticket_messages drop constraint if exists ticket_messages_attachment_fk;
alter table ticket_messages add constraint ticket_messages_attachment_fk
  foreign key (attachment_asset_key, organization_id, asset_audience)
  references blob_assets (id, organization_id, audience);                 -- MATCH SIMPLE: a null attachment stays unchecked

alter table giving_statements add column if not exists asset_audience text not null default 'private';
alter table giving_statements drop constraint if exists giving_statements_asset_audience_private;
alter table giving_statements add constraint giving_statements_asset_audience_private check (asset_audience = 'private');
alter table giving_statements drop constraint if exists giving_statements_blob_fk;
alter table giving_statements add constraint giving_statements_blob_fk
  foreign key (blob_asset_id, organization_id, asset_audience)
  references blob_assets (id, organization_id, audience) on delete no action on update no action;
```

Steps 9-12 then follow, in this order:

```sql
-- 9. audience is immutable, on every connection (presby_platform and the owner hold UPDATE; only a trigger binds them).
--    Created AFTER the flip. SECURITY INVOKER: it reads no relation (DEFINER would be cargo cult, DECISION-121 precedent);
--    EXECUTE revoked as 0056 section 7 does. Independent of the 0056 blob guard; either may raise.
create or replace function presby_blob_assets_audience_immutable() returns trigger
language plpgsql set search_path = public, pg_temp
as $$ begin
  raise exception 'blob_assets %: audience is immutable (% to %)', old.id, old.audience, new.audience using errcode = 'check_violation';
end $$;
revoke all on function presby_blob_assets_audience_immutable() from public, presby_app, presby_platform;
drop trigger if exists blob_assets_audience_immutable on blob_assets;
create trigger blob_assets_audience_immutable before update of audience on blob_assets
  for each row when (old.audience is distinct from new.audience)
  execute function presby_blob_assets_audience_immutable();

-- 10. roster functions: hide_photo wins (operator ruling). Full bodies are 0042's with ONLY these changes, per branch of the union:
--       left join person_privacy pp on pp.person_id = p.id and pp.organization_id = p.organization_id
--       case when coalesce(pp.hide_photo, false) then null else p.photo_key end as photo_key
--     and the header changes `set search_path = public` to `set search_path = public, pg_temp`. create or replace REPLACES proconfig,
--     so the pin must be restated (0048); revoke and grant are restated too (create or replace keeps the ACL; restating is belt and braces).
--     The person stays listed; only the photo is withheld. No other condition changes (no directory_hidden, no merge handling).
create or replace function presby_public_staff_roster(p_slug text, p_kind text default null, p_has_priority boolean default null)
returns table (kind text, role_raw text, department text, display_name text, photo_key text)
language sql stable security definer set search_path = public, pg_temp as $$ …0042 body with the two changes… $$;
revoke all on function presby_public_staff_roster(text, text, boolean) from public;
grant execute on function presby_public_staff_roster(text, text, boolean) to presby_app;
create or replace function presby_public_committee_roster(p_slug text, p_committee text default null, p_has_priority boolean default null)
returns table (group_name text, group_role text, display_name text, photo_key text)
language sql stable security definer set search_path = public, pg_temp as $$ …0042 body with the same two changes… $$;
revoke all on function presby_public_committee_roster(text, text, boolean) from public;
grant execute on function presby_public_committee_roster(text, text, boolean) to presby_app;
-- (comment on function … updated: "photo_key is null for a person whose person_privacy.hide_photo is set")

-- 11. serves the definer's exclusion check. DEPARTURE from R1.11 (see Carry-forward): lower(photo_key), because the check compares
--     lower(photo_key) to the canonical lowercase key, and a plain-column index could not serve that.
create index if not exists people_org_photo_key_idx on people (organization_id, lower(photo_key)) where photo_key is not null;

-- 12. the one door the public route uses
create or replace function presby_public_site_asset(p_org uuid, p_key uuid)
returns table (content_type text, bytes bytea, cache_class text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select b.content_type, b.bytes, case when ph.is_photo then 'roster' else 'site' end
    from organizations o
    join organization_sites s on s.organization_id = o.id
    join blob_assets b on b.organization_id = o.id and b.id = p_key
   cross join lateral (
         select exists (select 1 from people pe
                         where pe.organization_id = o.id and pe.photo_key is not null
                           and lower(pe.photo_key) = p_key::text) as is_photo) ph
   where o.id = p_org
     and o.status = 'active'
     and s.status = 'live'
     and b.content_type in ('image/png','image/jpeg','image/webp')
     and case
           when ph.is_photo then exists (            -- a key that is ANY person's photo is governed by listing ALONE
                  select 1 from (select r.photo_key from presby_public_staff_roster(o.slug) r
                                 union all
                                 select r.photo_key from presby_public_committee_roster(o.slug) r) x
                   where x.photo_key is not null and lower(x.photo_key) = p_key::text)
           else b.audience = 'public_site'
         end;
$$;
revoke all on function presby_public_site_asset(uuid, uuid) from public;
grant execute on function presby_public_site_asset(uuid, uuid) to presby_app;
comment on function … ; comment on column blob_assets.audience is '…';
```

Notes the implementer must keep: every column in the definer is qualified (the `RETURNS TABLE` names `content_type`, `bytes` shadow nothing in a SQL body, but qualify anyway); the `CASE` keeps the roster call off the hot path (only a photo key pays for it); `s.status` is safe because `organization_sites` has one row per organization; the definer takes **only** the org id the resolver returned and the key, never a slug from the request (the slug is read from `organizations`). `people.photo_key` gets **no FK** (R4).

**Drizzle declarations** (schema.ts parity, `npm run check:schema-parity`):
- `src/lib/db/domain/assets.ts`: `audience: text("audience").notNull().default("private")`; replace `unique("blob_assets_org_hash_key")` with `unique("blob_assets_org_audience_hash_key").on(organizationId, audience, contentHash)`; add `unique("blob_assets_id_org_audience_key").on(id, organizationId, audience)`; add `check("blob_assets_audience_allowed", …)` and `check("blob_assets_public_site_is_image", …)`; keep `blob_assets_id_org_key`; header comment records the audience rule.
- `src/lib/db/domain/support.ts` (`ticketMessages`) and `giving.ts` (`givingStatements`): `assetAudience: text("asset_audience").notNull().default("private")` plus the `check(…_asset_audience_private…)`. The FKs stay DDL-only (the existing cycle reason, `assets.ts:63-78`); update the comment at `giving.ts:859` to the 3-column form.
- `scripts/check-schema-parity.ts`, the two allowlist rows (the signature sorts by **local** column name, so `asset_audience` comes first):
  - `ticket_messages`: `fk: "(asset_audience,attachment_asset_key,organization_id) -> blob_assets(audience,id,organization_id)"`
  - `giving_statements`: `fk: "(asset_audience,blob_asset_id,organization_id) -> blob_assets(audience,id,organization_id)"`
  - The three brand/site rows are unchanged. Update both `reason` strings; the header comment "(3 rows)" is already wrong and is corrected to "(5 rows)".
- `scripts/giving/test-rls-46.sql` 46o (`:1337-1345`): the two arrays become `array['blob_asset_id','organization_id','asset_audience']` and `array['id','organization_id','audience']` (conkey/confkey order = the FK's declaration order above); label gains "three-column". `confdeltype = 'a' and confupdtype = 'a'` stays and is the F44 pin. 46t (`:1715`) is unchanged and still correct.

## Component / Page Plan

No page or component is created. Files:

**Batch 1 (database-admin) — create:** `drizzle/0072_presby_blob_audience.sql`; `scripts/assets/test-rls-72.sql`; `scripts/assets/test-0072-migration.sh`, `scripts/assets/0072-preimage.sql`, `scripts/assets/0072-postimage.sql`, `scripts/assets/0072-crossref.sql` (snapshot harness); `src/lib/db/domain/blob-audience.schema.test.ts` (static, U7); `src/lib/storage/blob-audience.db.test.ts` (D2); `src/lib/db/domain/public-roster-photo.db.test.ts` (D3). **Modify:** `src/lib/db/domain/{assets,support,giving}.ts`, `scripts/check-schema-parity.ts`, `scripts/giving/test-rls-46.sql`, `src/lib/db/domain/giving.schema.test.ts` (add a parallel assertion that reads 0072; the 0056 assertions stay).

**Batch 2 (full-stack-developer) — create:** `src/lib/storage/blob-key.ts`, `blob-key.test.ts` (U1), `blob-store-public.test.ts` (U2), `audience-callsites.test.ts` (U4), `public-asset.db.test.ts` (D1); `src/app/(public)/site/[slug]/assets/[key]/route.db.test.ts` (D4); `e2e/custom-domains/assets.spec.ts` (E1); `scripts/assets/integration/*.patch` (the staged Rule 16 patches below). **Modify:** `src/lib/storage/blob-store.ts` and `blob-store.test.ts`; the route and `route.test.ts` (rewrite); all 23 call-site files in the table above; `render-site-page.tsx` and `[[...path]]/page.test.tsx:389-408`; `docs/deployment.md` (the runbook below); the three public-listing toggles (Copy) and their tests; every test that mocks `@/lib/storage/blob-store` and asserts call arguments (found by grep; known: the two statement download `route.test.ts` `:176`/`:161`, `person-avatar.test.tsx:65`, `directory-grid.test.tsx:137`, `sites-resolve-site.test.ts:343`, `tenant-branding.test.ts`, `ingest/route.test.ts`, both ticket action tests, `read-org-brand.test.ts`, branding and organization page tests).

### Staged Rule 16 integration patches (the orchestrator applies at integration; the implementer commits them under `scripts/assets/integration/` and applies them to the working tree for local and QA runs without committing the shared files)

**P1 — `e2e/support/custom-hosts.ts`.** `insertBundle` is **unchanged** (the bundle stays default `private`, R8). `insertImage` stores `public_site`; four helpers are added; `World`/`buildWorld` are untouched (so the other four custom-domain specs see no new rows).

```ts
export type BlobAudience = "public_site" | "private";
// 1x1 (existing PNG), 2x2 and 3x3 solid-colour PNGs: valid, CRC-checked, byte-distinct so dedup never merges them.
const PNG_ONE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
export const PNG_HERO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGOokteuktdmgFAAFroDEeT5vQgAAAAASUVORK5CYII=", "base64");
export const PNG_MARK = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAEElEQVR4nGOQj6qCIAYsLAB9EAiMe72hyQAAAABJRU5ErkJggg==", "base64");

export async function insertBlob(
  sql: Sql, orgId: string,
  o: { contentType: "image/png" | "application/pdf" | "application/json"; bytes: Buffer; audience: BlobAudience },
): Promise<string> {
  const hash = createHash("sha256").update(o.bytes).digest("hex");
  const rows = (await sql`
    insert into blob_assets (organization_id, content_hash, content_type, byte_size, bytes, audience)
    values (${orgId}::uuid, ${hash}, ${o.contentType}, ${o.bytes.byteLength}, decode(${o.bytes.toString("hex")}, 'hex'), ${o.audience})
    returning id`) as { id: string }[];
  return rows[0]!.id;
}

/** The fixture image a published site references: public_site (what ingest and the logo actions store). */
export async function insertImage(sql: Sql, orgId: string): Promise<string> {
  return insertBlob(sql, orgId, { contentType: "image/png", bytes: PNG_ONE, audience: "public_site" });
}

/** A new private bundle blob whose imageKeys maps "hero-img" to imageId, with the home hero naming it; the site is pointed at it. */
export async function restageBundleWithHero(sql: Sql, org: SiteOrg, bundle: { pages: unknown[] }, imageId: string): Promise<void> {
  const pages = structuredClone(bundle.pages) as Array<{ path: string; mdxAst: { blocks: Array<{ type: string; props: Record<string, unknown> }> } }>;
  const hero = pages.find((p) => p.path === "/")!.mdxAst.blocks.find((b) => b.type === "hero")!;
  hero.props.image = "hero-img";
  hero.props.imageAlt = "";
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, pages, imageKeys: { "hero-img": imageId } }), "utf-8");
  const blobId = await insertBlob(sql, org.orgId, { contentType: "application/json", bytes, audience: "private" });
  await withDbRetry("restage bundle", () => sql`update organization_sites set content_bundle_key = ${blobId}::uuid where organization_id = ${org.orgId}::uuid`);
}

/** Points the org's brand mark at a blob (the brand row must exist: call setBrand first). */
export async function setMark(sql: Sql, orgId: string, markId: string): Promise<void> {
  await withDbRetry("set mark", () => sql`update organization_brands set mark_asset_key = ${markId}::uuid where organization_id = ${orgId}::uuid`);
}
```
`removeSiteOrg` already deletes `organization_brands`, `organization_sites`, then `blob_assets` for the org, in that order, so the new rows need no new teardown.

**P2 — `scripts/test-rls.sql`**, one block appended after section 64:
```
-- ===========================================================================
-- APPENDED SECTION - pipeline/public-asset-allowlist (integration).
-- 72. Public asset audience (drizzle/0072_presby_blob_audience.sql). Its own
--     file, as 46, 47 and 59-64 above; \ir resolves relative to this script.
--     It needs the test helpers and scripts/seed-dev.sql's Alder Creek
--     fixture (no seed change), so it is never run against production.
-- ===========================================================================
\ir assets/test-rls-72.sql
```
**P3 — `drizzle/meta/_journal.json`**: append `{ "idx": <next>, "version": "7", "when": <greater than the last entry>, "tag": "0072_presby_blob_audience", "breakpoints": true }` at integration (other pipelines own 0065-0071, so `idx` is whatever is next then).

**P4 — `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/product/functionality-map.md`**: lines and text below (Follow-ups, DECISION-277). `scripts/seed-dev.sql`: **no change** (R8, verified).

## Implementation Order

Two implementers, sequential. **Rationale for the split:** the migration is the highest-consequence artifact (it rewrites constraints on two shipped tables, one of which guards tax documents, and flips production rows), and its proof (snapshot run, RLS section, FK shapes) is database-administration work that should be red-green before any application code depends on it. Batch 1 leaves the tree compiling (the new Drizzle columns have defaults, so `store()` still type-checks), so Batch 2 starts from a green tree against a migrated pipeline branch.

**Batch 1 — database-admin** (pipeline Neon branch per Rule 16; `.env.local` in the worktree points at it)
1. Write the red tests first and capture the red run against the pre-0072 branch: U7, D2, D3, `test-rls-72.sql`, and the snapshot harness scripts.
2. Write `0072`, the three Drizzle declarations, the parity rows, the 46o edit.
3. Snapshot-migration run (D5) on a scratch Neon branch **before** touching the pipeline branch; then apply to the pipeline branch with `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0072_presby_blob_audience.sql`.
4. Green: D2, D3, U7, `giving.schema.test.ts`, `giving-statements.db.test.ts` (unchanged and must still pass), `test-rls-72.sql` and `test-rls-46.sql` as `presby_app`, `npm run check:schema-parity`, `npm run typecheck`, `npm run check`.
5. Record: the flip NOTICE count on the pipeline branch and the snapshot run's counts in the Phase 4 section.

**Batch 2 — full-stack-developer** (starts only after Batch 1 reports green)
1. Write the red tests and capture the red run against the pre-fix code on the migrated branch: U1, U2, U3, U4, U5, D1, D4, E1 (E1's private-class assertions fail because the old route still serves them).
2. `blob-key.ts`; `blob-store.ts` (contract, `resolvePublic`, header); all call sites (literals); update the existing tests that assert call arguments.
3. The route rewrite; `render-site-page.tsx`; comment rewrites; the three toggle strings and their tests.
4. Stage the P1-P3 patches; apply locally; run E1 and the six changed existing specs on port **3600** (`E2E_BASE_URL=http://localhost:3600`, own `next dev -p 3600`, stopped by PID); 360px pass in a browser.
5. `docs/deployment.md` runbook; `npm run check`, typecheck, build, unit and DB suites (serial).

Release notes, TODO reconciliation, the functionality-map line (Rule 14) and the decision entry land at ship. `docs/architecture.md`: **no change** (Rule 15: no new subsystem, data flow or runtime shape; a column and a serving rule).

## Test Plan (failing first)

Every test below must be seen red before its fix and green after; Phase 4 sections record both runs. "Red because" says why the test cannot pass on the current tree.

### Unit (no database)

| ID | File | Pins | Red because |
|---|---|---|---|
| U1 | `src/lib/storage/blob-key.test.ts` | canonical lowercase out; uppercase in → lowercase out; rejects 35/37 chars, no hyphens, braces, `urn:uuid:`, leading/trailing space, trailing `\n`, empty, `../`, percent forms, non-hex, non-ASCII digits; accepts the nil uuid and `e2e93001-0000-4000-8000-…` | module absent |
| U2 | `src/lib/storage/blob-store-public.test.ts` (mocks `@/lib/db`) | `resolvePublic`: malformed key → `null` and `db.execute` never called; passes `(organizationId, canonicalKey)`; maps a row to `{bytes: Buffer, contentType, cacheClass}`; a `Uint8Array` becomes a `Buffer`; **a row with a non-image content type or an unknown `cache_class` → `null`** (second independent check); zero rows → `null`; a thrown driver error propagates (not swallowed) | method absent |
| U3 | `…/assets/[key]/route.test.ts` (rewritten; mocks `resolveSiteOrganization`, and a blob-store whose **only** method is `resolvePublic`, so any other call is a `TypeError`) | see matrix below | route calls `resolve`, serves a PDF, no `no-store` |
| U4 | `src/lib/storage/audience-callsites.test.ts` | source scan (design below) | no `audience` anywhere |
| U5 | `…/[[...path]]/page.test.tsx` (modified `:389-408`) | an unmapped manifest key yields `/site/alder-creek/assets/00000000-0000-0000-0000-000000000000`, never a URL containing the manifest key; a mapped one is unchanged | fallback is `?? manifestKey` |
| U6 | existing call-site tests | each updated `toHaveBeenCalledWith` includes `audience`; `ingest/route.test.ts` asserts images → `public_site`, bundle → `private`, in that order | args lack `audience` |
| U7 | `src/lib/db/domain/blob-audience.schema.test.ts` (static, reads the SQL text) | order of markers: `add column if not exists audience` < `blob_assets_audience_allowed` < `raise exception` (assertion) < `update blob_assets` (flip) < `blob_assets_public_site_is_image` < `blob_assets_org_audience_hash_key` < `blob_assets_id_org_audience_key` < `ticket_messages_attachment_fk` < `giving_statements_blob_fk` < `create trigger blob_assets_audience_immutable` < the two roster `create or replace` < `people_org_photo_key_idx` < `presby_public_site_asset`; each roster block contains `set search_path = public, pg_temp`, `revoke all on function`, `grant execute on function … to presby_app` and `hide_photo`; no top-level `begin;`/`commit;`; `giving_statements_blob_fk` says `on delete no action on update no action`; `assets.ts` declares `audience` and the new unique keys | file absent |

**U3 matrix** (one table-driven test over the misses plus targeted cases):
- Every miss returns the **same status, body bytes and full header set** (compared header by header, not just status): malformed key (several shapes), `resolveSiteOrganization` `not_found` (slug mode and host mode), `resolvePublic` → `null` (the PDF, ticket-screenshot, bundle-JSON, private-photo and unlisted-photo cases are all "definer says zero rows" at this layer), and a throw.
- Malformed key: neither `resolveSiteOrganization` nor `resolvePublic` is called, and `console.error` is not called.
- Site miss: `resolvePublic` not called.
- Throw: `console.error` called exactly once, its argument object has exactly the keys `mode`, `slug`, `key`, and the serialized call does not match `/select|Failed query|params:|simulated/i`.
- Uppercase uuid → `resolvePublic` receives the lowercase form; the response equals the canonical-case response.
- `site` class → 200, `Content-Type` as stored, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, exact bytes.
- `roster` class → 200, `Cache-Control` exactly `private, max-age=86400`, and it contains neither `immutable` nor `s-maxage` nor `public`.
- Host mode and a non-null `redirectHost`: 200, no `Location` header (R6 kept).
- No session read: `@/auth` and `next/headers` are mocked to throw if touched.

**U4 design** (TypeScript compiler API; `typescript` is already a devDependency): walk every non-test file under `src/` (exclude `*.test.ts(x)`, `src/lib/testing/`); for every `CallExpression` whose callee is `getBlobStore().<method>`, read the first argument's object literal and require `audience: "public_site" | "private"` as a **string literal** for `store`, `resolve`, `resolveMeta`, and no `audience` for `resolvePublic`. Also require that the count of `getBlobStore(` call expressions in each file equals the count of matched method calls (this catches `const s = getBlobStore()` aliasing). Compare against a checked-in table `{ file → ["store:private", …] }` in source order: an unlisted file, a missing site, or a changed literal fails. **The table is the only thing a later pipeline edits; the test logic never changes.** It has two parts: `ACTIVE` (every file that exists today: the scan fails on any difference, in either direction) and `FORWARD` (documented rows for files that land later, each with a one-line `since` note naming its pipeline). A `FORWARD` file that does not exist yet is skipped; once it exists it is held to its row exactly as an `ACTIVE` file is, and a test line fails if a `FORWARD` file exists but has no matching call (a stale row). When its pipeline merges, the row moves from `FORWARD` to `ACTIVE` by editing the table. Forward entry in 0072: `src/lib/reimbursement/receipts.ts` (treasury Increment 1, migration 0073, DECISION-270): `["store:private", "resolve:private"]`, since `treasury-inc1`. **Careers adds no rows**: DECISION-263 keeps applicant files out of `blob_assets`, so careers never calls `getBlobStore()`. The catalog test in D2 plays the same role on the database side (a treasury receipt FK without the constant fails it), so the two together make the rule mechanical for 0073.

Second assertion: `blobAssets` / `blob_assets` is **imported** (module specifier ending `db/domain/assets`) only by `src/lib/storage/blob-store.ts` and the barrel `src/lib/db/domain/index.ts`, and no non-test file outside `blob-store.ts` and `src/lib/testing/` contains raw SQL `from|join|into|update blob_assets` (DECISION-030).

### Database-backed (serial, `describe.skipIf(!hasDb)`, per `docs/testing.md`)

**D1 `src/lib/storage/public-asset.db.test.ts`** — the predicate through the real `resolvePublic` on the `presby_app` connection, seeded on the owner connection (fixture org with `deletable_until`, live site; people/memberships/staff/officer/committee rows with `fixtureDeletableUntil`, random ids, torn down in `afterAll` with confirming SELECTs). Expected result in brackets:
- `public_site` image [served, `site`]; the mark (`public_site`) [`site`]; a `public_site` image **no bundle references** [served: Tier 1 — this documents R8, and its name says "Tier 1"].
- `private` image [none]; ticket-attachment-shaped `private` image referenced by a real `ticket_messages` row [none]; statement-PDF-shaped `private` PDF referenced by a real `giving_statements` row [none]; bundle JSON [none]; wordmark (`private`) [none]; a `private` image that is a historical `organization_brand_history` mark [none].
- Roster photos (stored `private`): listed current staff [served, `roster`], listed current officer [`roster`], listed current committee member of a `managed` group [`roster`]; `ends_on` set [none]; `public_listed = false` [none]; committee member of a derived (`session`) group [none]; **listed but `person_privacy.hide_photo`** [none]; a listed person's photo that is mistakenly stored `public_site` [served only while listed; after un-listing: none]; an **unlisted person's photo stored `public_site`** [none — the exclusion]; one blob that is the photo of two people, one listed and one not [served while either is listed]; a listed person who is `merged_into_id`-linked [same as the roster function returns, asserted by comparing]; a photo whose `photo_key` text is stored uppercase [same answer as lowercase].
- Gates: foreign-org key [none]; org `inactive` [none]; site `suspended` / `provisioning` [none]; no row [none]; PDF-typed `public_site` impossible (D2).
- **Parity property:** for every person in the matrix, `resolvePublic(photo)` is non-null **iff** the photo key is in `presby_public_staff_roster ∪ presby_public_committee_roster` output (compared in the same transaction), so the page and the predicate cannot drift (Gap 5).
- `resolvePublic` with a malformed key returns `null` without error; the definer is not callable by `presby_platform` (privilege error).
- Bytes: the returned `bytes` is a `Buffer` equal to the stored bytes.

**D2 `src/lib/storage/blob-audience.db.test.ts`** — adapter contract and constraints:
- `store(public_site)` and `store(private)` of identical bytes → two rows, two keys (F298); a second `store` of the same pair → same key (dedup preserved per audience).
- `resolve`/`resolveMeta` with the wrong audience → `null`, both directions.
- `store(public_site, "application/pdf")` and `store(public_site, "application/json")` throw `BlobValidationError`; the raw owner `insert … audience 'public_site', 'application/json'` is refused by `blob_assets_public_site_is_image`; `audience = 'other'` is refused by `blob_assets_audience_allowed`.
- **Immutability, on every connection:** `update blob_assets set audience = …` through the platform connection (`getPlatformDb()`) and through the owner both raise `check_violation` (message `audience is immutable`); an update that does not change `audience` (e.g. `bytes`) is not blocked by this trigger; `presby_app` update is `insufficient_privilege`; `presby_app` has no EXECUTE on the trigger function.
- `ticket_messages` / `giving_statements`: an insert pointing `attachment_asset_key` / `blob_asset_id` at a `public_site` row fails with `foreign_key_violation` (the database, not the adapter); pointing at a `private` row succeeds; `asset_audience = 'public_site'` is refused by its CHECK.
- **F44 preserved:** `delete from blob_assets` of a statement's PDF still raises `giving_statements_blob_fk` (the existing `giving-statements.db.test.ts:425,451` keep passing unchanged); `confdeltype = 'a'`, `confupdtype = 'a'`; an `update` of the statement PDF's bytes is still refused by `blob_assets_giving_statement_guard`.
- Catalog test: every FK with `confrelid = 'blob_assets'::regclass` is either in the public-reference allowlist (`organization_brands_mark_asset_fk`, the wordmark FK, `organization_sites_content_bundle_fk`; look the real names up in the catalog, do not guess) or its `conkey` includes an `asset_audience` column that has a CHECK `= 'private'`. A new private consumer that forgets the constant fails here.
- `audience` column default is still `'private'` (`information_schema`), NOT NULL.
- Unique keys present with the right column lists; `blob_assets_org_hash_key` gone; `blob_assets_id_org_key` present.

**D3 `src/lib/db/domain/public-roster-photo.db.test.ts`** — both roster functions on the `presby_app` connection: a listed person with `hide_photo` is still returned with `photo_key` null (name, role present); the same person without it has the key; a person with no `person_privacy` row has the key; both functions keep `proconfig` `search_path=public, pg_temp`, `prosecdef`, and an ACL of owner plus `presby_app` only; signature and result column list unchanged.

**D4 `…/assets/[key]/route.db.test.ts`** — the real route, real `resolveSiteOrganization`, real definer, flag on (captured and restored), `next/headers` faked for the host: `site` image 200 with the immutable header and `nosniff`; a listed roster photo 200 with exactly `private, max-age=86400`; after un-listing the same request is the neutral 404; the 404 for a private image, a statement PDF, the bundle JSON, an unlisted photo, a foreign-org key and a random uuid are **byte-identical** (status, body, headers); slug mode and host mode agree; flag off → the same 404.

**D5 migration on a snapshot — `scripts/assets/test-0072-migration.sh <scratch-database-url>`** (runs against an empty scratch Neon database, never the pipeline branch; the script refuses a URL whose database name does not begin `scratch_` or whose host is the production endpoint):
1. Apply every `drizzle/00NN_*.sql` with `NN < 72` in order (`-1`, `ON_ERROR_STOP`), then `scripts/seed-dev.sql` and `scripts/giving/seed-dev-giving.sql`.
2. `0072-preimage.sql` (owner, committed): a live-site org with a parseable bundle whose `imageKeys` names two images, a mark, a wordmark, a historical `organization_brand_history` mark, an orphan image, a ticket message with an image attachment, a garbage-JSON bundle on a second org (to exercise the notice path), and **one issued contribution statement** by setting the section-46 harness GUCs, `\ir ../giving/test-rls-46-issue.sql`, and committing (the harness issues exactly as the app path does; if it cannot be committed for lack of an actor fixture, stop and report, do not substitute a hand-built statement row). Record `md5(bytes)`, `content_hash`, `id` of the statement PDF.
3. Apply `0072` with `psql -1`. Assert (`0072-postimage.sql`): audiences per class (mark and the two bundle images `public_site`; bundle JSON, wordmark, historical mark, orphan, ticket image, statement PDF all `private`); flip NOTICE count matches; the statement PDF row is byte-identical (md5), `private`, and `delete`/`update bytes`/`update audience` are each refused by `giving_statements_blob_fk` / `blob_assets_giving_statement_guard` / `blob_assets_audience_immutable`; both consumer FKs are three-column with `confdeltype`/`confupdtype` `a`; the roster functions are `search_path=public, pg_temp` with the ACL intact; an insert **without** `audience` (what old code does) lands `private` and a ticket message may reference it.
4. **Re-apply `0072`**: succeeds and flips nothing new (idempotent); then insert a new `private` image that is the current mark of an org and re-apply: it is flipped (heal), and the statement PDF is untouched.
5. **Cross-reference refusal (`0072-crossref.sql`)**: on a second scratch database taken from step 2's state (before 0072), make one ticket attachment point at a bundle-referenced image; `psql -1 -f 0072` exits non-zero with the message `are both published … and used by a private consumer`, and a following `select` shows `audience` column absent or all rows unchanged (the transaction rolled back). This also proves the owner connection **sees** `ticket_messages`/`people` under FORCE RLS (the F26 hazard: a silent zero would pass an assertion that cannot see).

### RLS script — `scripts/assets/test-rls-72.sql` (as `presby_app`; Alder Creek is `provisioning`, so live-site positives live in D1, per the section-61 convention)
Catalog: `blob_assets` has RLS enabled and forced; `presby_app` holds SELECT and INSERT and **not** UPDATE/DELETE on it; the three audience CHECKs exist and are validated; the trigger exists and is enabled; the immutability function and the definer are pinned `search_path=public, pg_temp`; EXECUTE on the definer is `presby_app` + owner only (no PUBLIC); EXECUTE on the trigger function is nobody; the catalog FK test (every FK into `blob_assets` is allowlisted or carries `asset_audience`). Behavior: `presby_app` UPDATE of `blob_assets.audience` is `insufficient_privilege`; for Alder Creek (provisioning) the definer returns **zero rows** for a blob the block inserts under its org context (the gate), for a foreign org id with Alder's key, and for the nil uuid; with Bramble's org id and Alder's key, zero rows. (`presby_platform` UPDATE refusal is in D2: a script run as `presby_app` cannot become that role.) Every writing block ends in `rollback`.

### e2e — `e2e/custom-domains/assets.spec.ts` (new; builds its own `buildWorld`, so it cannot disturb the other specs)
- **Flags:** `sites.public_render` only, set ON through `setPublicRenderFlag` in `beforeAll` and restored (verified by SELECT) in `afterAll`, exactly as `serving.spec.ts:56-63`. Per-org `org_portal.domains` ON is set by `createSiteOrg`. **No key is added to `scripts/ci/e2e-baseline-flags.sql`** (the spec sets what it needs).
- `beforeAll` (owner SQL via the P1 helpers): ONE: `insertBlob(PNG_HERO, public_site)` referenced by `restageBundleWithHero`; `setBrand` + `setMark(PNG_MARK, public_site)`; a `private` PNG (ticket-screenshot-shaped) and a `private` PDF (statement-shaped). WALK (pending domain, so its slug URL renders on the platform host instead of handing off): the same hero image and mark.
- On the **custom host** (canonical `www.church-one.invalid` and alias `church-one.invalid`) and the **platform host** (`localhost`, `/site/<walk-slug>/assets/<key>`): hero image 200 `image/png`, `cache-control: public, max-age=31536000, immutable`, `x-content-type-options` exactly `nosniff` (not a duplicated `nosniff, nosniff`: if the global header in `next.config.ts:86` merges with the route's, drop the route-level one and re-point U3 at the config; the e2e is the authority); mark 200; alias: no `Location`.
- The **miss matrix** on both hosts, each compared with a random uuid's response for status, body and every header: the private PNG, the private PDF, the bundle JSON (`org.blobId`), another org's image id, an unmapped random uuid, a malformed key (`not-a-uuid`), an uppercase-hex variant of the hero key **must be 200** (same answer as canonical). All misses: 404, `{"error":"Not found"}`, `cache-control: no-store`.
- Flag off (`setPublicRenderFlag(false)`, in `try/finally`): the hero key is the same neutral 404; flag restored: 200 again.
- **Browser, natural size:** `page.goto` the custom host home page and the WALK platform page, wait for `load`, and assert that every `img[src*="/assets/"]` has `complete` and `naturalWidth > 0` and that there is at least one hero and one logo image (a 200 on the HTML proves nothing; three earlier bugs here were phone-only).
- **360px:** the same two pages at `{ width: 360, height: 800 }`: images loaded, and each image's bounding box ends within 360px (no sideways overflow caused by an image).
- Existing specs that change **behavior-adjacent assertions** (blast radius, all read from the live tree): `e2e/custom-domains/serving.spec.ts:230,235,271,295`, `headers.spec.ts:70`, `lockdown.spec.ts:292` fetch `world.oneImageId` / `twoImageId`; they pass only because P1 makes `insertImage` `public_site`. Their assertions (`image/png`, the immutable header, foreign-org 404 equal to a nil-uuid 404, no `Location`, HSTS, no `Set-Cookie`) are otherwise unchanged. `public-sites.spec.ts` (Alder Creek, no images, `imageKeys: {}`) and `branded-signin.spec.ts` (sets `mark_asset_key = null`) need no change. A spec that passes only on a branch with hand-set flags is a defect: all six depend on `sites.public_render`, which each already sets and restores.

## Runbook (R5; deployment-engineer runs it; Batch 2 writes it into `docs/deployment.md` as "Pre-deploy runbook: 0072")

Applies in **one release**, in this order, followed by the verification; `GIVING_STATEMENTS_ENABLED` stays unset until it is complete (R9).

0. **Preconditions.** Production has `giving_statements`, `ticket_messages`, `person_privacy`, `organization_sites` and both roster functions: `select to_regclass('giving_statements'), to_regclass('ticket_messages'), to_regclass('person_privacy'), to_regclass('organization_sites'), to_regprocedure('presby_public_staff_roster(text,text,boolean)'), to_regprocedure('presby_public_committee_roster(text,text,boolean)')` all non-null. Re-read the counts that justify the flip set (the orchestrator's 2026-10-25 read was blobs 107 / images 82 / json 25 / pdf 0; tickets with attachment 0; statements 0; people with `photo_key` 0; marks 1; wordmarks 0; sites with bundle 1, live 1) and compute the expected flip: `|marks ∪ imageKeys values|`, i.e. the V1 query below before the migration (it returns the same rows with `public_ok = 0`). Any non-zero ticket, statement or photo count that overlaps the flip set will make the migration raise by design.
1. **Snapshot** the Neon `production` branch (`pre-0072-<date>`).
2. **No site-repo push, no logo upload, no ticket attachment between steps 3 and 4.**
3. **Apply:** `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0072_presby_blob_audience.sql`. `-1` is mandatory (the file has no transaction of its own and a temp table). Record the `flipped N blob(s) to public_site` NOTICE: expected `N = 1 mark + the live bundle's distinct images` (less one if the mark is also a bundle image).
4. **Promote the code** (merge; Vercel builds). Old code and the new schema coexist briefly: old `store()` inserts omit `audience` and land `private`; old ingest therefore stores `private` images (broken images until the next ingest); a logo uploaded by old code is a `private` mark; old dedup ignores audience, so a ticket upload byte-identical to a `public_site` image fails the new FK (rare, loud). If a site-repo push did happen in the window, push a **new commit** (a repeat of the same sha short-circuits ingest as `already_current`). A logo uploaded in the window is re-uploaded after step 4. Statements cannot be affected (`GIVING_STATEMENTS_ENABLED` is off).
5. **Verify** (all six; the V1 query is the post-deploy check the architect asked for):

```sql
-- V1: every current mark and every imageKeys value of every bundle resolves to a public_site image row.
-- Expect: kind='mark' expected=1 public_ok=1 dangling=0; kind='bundle_image' expected=N public_ok=N dangling=0.
with marks as (
  select ob.organization_id, ob.mark_asset_key as id, 'mark' as kind
    from organization_brands ob where ob.mark_asset_key is not null),
bundles as (
  select s.organization_id, convert_from(b.bytes, 'UTF8')::jsonb as j
    from organization_sites s
    join blob_assets b on b.id = s.content_bundle_key and b.organization_id = s.organization_id
   where b.content_type = 'application/json'),
imgs as (
  select bu.organization_id, k.value::uuid as id, 'bundle_image' as kind
    from bundles bu, jsonb_each_text(bu.j -> 'imageKeys') k),
want as (select * from marks union select * from imgs)
select w.kind, count(*) as expected,
       count(*) filter (where b.audience = 'public_site' and b.content_type in ('image/png','image/jpeg','image/webp')) as public_ok,
       count(*) filter (where b.id is null) as dangling
  from want w left join blob_assets b on b.id = w.id and b.organization_id = w.organization_id
 group by w.kind;
```
   - V2: `select audience, content_type, count(*) from blob_assets group by 1, 2 order by 1, 2;` — `public_site` rows are images only and total the flip NOTICE count; every `application/json` row is `private`.
   - V3: `select conname, convalidated, confdeltype, confupdtype, pg_get_constraintdef(oid) from pg_constraint where conname in ('ticket_messages_attachment_fk','giving_statements_blob_fk')` — three columns each, `a`/`a`, validated.
   - V4: `select proname, prosecdef, proconfig, proacl from pg_proc where proname in ('presby_public_site_asset','presby_public_staff_roster','presby_public_committee_roster')` — definer, `search_path=public, pg_temp`, ACL owner + `presby_app`.
   - V5: on the live site: `curl -sI https://<platform-host>/site/<slug>/assets/<an imageKeys value>` → 200, `cache-control: public, max-age=31536000, immutable`, `x-content-type-options: nosniff`; **record the `x-vercel-cache` header** (this answers F297's "must be checked"; the Vercel docs say a function response is edge-cached only with `s-maxage`, so expect no HIT). `curl -s` of the bundle JSON's own id, of a random uuid and of `not-a-uuid` → identical `404`, `{"error":"Not found"}`, `cache-control: no-store`.
   - V6: the live home page on a phone viewport: logo and images load (natural size > 0).
6. **Rollback:** revert the code and redeploy. The schema is additive and compatible with old code, so no schema rollback is needed (fix forward). A code revert restores the old route, i.e. the original bug, not an outage. If the migration itself fails it rolls back whole (`-1`); the pre-flip assertion naming the cross-referenced rows is the only designed failure.

## Carry-forward

| Phase 1 gap / Phase 2 ruling / operator ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| Op. ruling: `hide_photo` wins | Data Model step 10 (both roster functions); definer calls them; D1, D3; Copy (the three toggles) |
| Op. ruling: roster photos ~1 day, bundle images and marks stay immutable | API Contract step 4 (`private, max-age=86400` vs unchanged); U3, D4, E1 |
| Op. ruling: wordmark private; mark only | Step 4 flip set is marks only; wordmark stays `private`; D1 "wordmark" case. TODO: flip it with the first page that renders it |
| Op. ruling: migration 0072 | Data Model; filename `0072_presby_blob_audience.sql` |
| OQ4 Tier 1 now, Tier 2 a follow-up | *Deferred* — operator default 2026-10-25 (Follow-ups 1). D1 names its Tier-1 case |
| OQ5 production counts | Runbook step 0 re-reads them; V1/V2 check them after |
| Gap 1 type filter is not enough; `nosniff` | Definer type test + CHECK (step 5) + TypeScript second check (U2) + `nosniff` (U3, E1) |
| Gap 2 one neutral 404, same work and timing | `notFound()` helper, `no-store`; U3 matrix, D4, E1. Timing equality: **unverified** (no timing test; structurally one definer call per well-formed key; DECISION-040 byte-identity is what the tests pin) |
| Gap 3 per-class cache; deploy cannot purge | API Contract step 4; residual recorded in DECISION-277 |
| Gap 4 malformed keys | `parseBlobKey`; U1, U3 (no read, no `console.error`), E1 |
| Gap 5 predicate and roster agree exactly | Definer calls the roster functions (R3); D1 parity property |
| Gap 6 bundle `imageKeys` | Superseded by the addendum: Tier 1 (audience), flip reads `imageKeys` once, in the migration |
| Gap 7 drop the `?? manifestKey` fallback | Other source changes (nil-uuid constant, not "no image"; site-kit contract); U5; TODO for site-kit |
| Gap 8 republish race | Accepted residual (Phase 1); Tier 1 makes it smaller (a dropped image stays fetchable) |
| Gap 9 fixtures break | R8 form: P1 makes images `public_site`; the bundle needs no reference; six existing specs listed |
| Gap 10 wordmark, foreign org, merged targets pinned | D1 (wordmark, foreign org, merged parity) |
| Gap 11 fail-closed backfill | Step 1 default + step 4 proven-public flip |
| Gap 12 statement guard vs backfill | Constant default fires no trigger; flip touches only unreferenced rows (assertion); trigger created after; D5 |
| Gap 13 re-keying shipped tables; keep NO ACTION; add a test | Step 8, 46o edit, parity rows; D2 F44 tests; D5 |
| Gap 14 deploy window; "no default" | Architect R5 **departure**: default kept permanently (see below); Runbook steps 2-4 |
| Gap 15 every `store()` passes `audience`; pin per caller | Call-site table; required type; U4 source scan |
| Coordinator: treasury's `src/lib/reimbursement/receipts.ts` forward rows; careers none; scan extensible by table edit only | Call-site table "Forward entries"; U4 `ACTIVE`/`FORWARD` table design |
| Gap 16 `resolve`/`resolvePublic` audience contract | Adapter contract; D2 both directions; U2 |
| R1 steps 1-12 | Data Model, in R1's order; U7 pins the order |
| R2 bundle JSON is `private` (**departure** from Gap 11/15, DECISION-270) | Ingest `:239` and `sites.ts:416` literals; D5 bundle stays private; U4 |
| R3 definer, roster branch, class | Data Model step 12; D1, D4; `test-rls-72.sql` |
| R4 `people.photo_key` gets no FK | *Deferred* — architect (Follow-ups 2); definer exclusion covers it; D1 "unlisted photo stored `public_site`" |
| R5 default kept; window; runbook | Runbook; D5 step 3 old-code insert |
| R6 contracts; literals; source scan; catalog test | API Contract; U4; D2 catalog test; RLS script |
| R7 route order, helper, classes, Vercel CDN | API Contract; Runbook V5 records `x-vercel-cache` |
| R8 Tier 1 corrections | Test Plan: no republish-drops-image test; "unreferenced `public_site` image is served" is asserted as Tier 1; fixtures per P1; migration and cross-reference tests (D5); `hide_photo` parity |
| R9 sequencing; 0073 depends on `blob_assets_id_org_audience_key`; careers 0075 orders only | Runbook preamble; step 7 constraint named `blob_assets_id_org_audience_key` exactly (treasury's receipt FK targets it) |
| Departures (five) | (1) bundle JSON private: R2 row. (2) default kept: R5 row. (3) `public_site` implies image: step 5 CHECK. (4) roster branch calls the roster functions: step 12. (5) replaced marks stay private: flip set excludes history; D1/D5 |
| Tech-lead departures from architect text (new, for the record) | (a) **index** is on `lower(photo_key)`, not `photo_key` (R1.11): the exclusion compares `lower(photo_key)` to the canonical key, and an index on the plain column cannot serve that; harmless since the table is empty everywhere. (b) the audience trigger function is SECURITY INVOKER with the pin restated (R1.9 said "plain plpgsql", consistent). (c) the unmapped-image URL is a nil-uuid constant rather than "no image" (Gap 7), because of the site-kit contract. |
| F289 | Closed by this design. F297 (`x-vercel-cache` must be checked): Runbook V5. F298 (dedup across consumers): step 6, D2 |
| Follow-ups 1-4 (Tier 2; photo_key uuid+FK; brand restore must re-store; optional `s-maxage`) | *Deferred* — architect and operator; TODO lines below |
| Phase 1 "Behavior to preserve" | 404 body, no session, no redirect, `Content-Type`, immutable header for `site`, `/signin` logo (flipped mark is `public_site`); U3, E1; `branded-signin.spec.ts` unchanged |
| Phase 1 Out of Scope | All confirmed as out of scope below |
| Phase 1 copy-truthfulness: comments saying the route "resolves any blob key" | Copy, Neighbours |

## Edge Cases & Risks

1. **Malformed or case-variant key** — one answer, no read: U1, U3, E1 (uppercase hero key is 200).
2. **Site-level and key-level misses are indistinguishable** — status, body, every header: U3 matrix, D4, E1.
3. **DB error during the read** — neutral 404, one `console.error({mode, slug, key})`, no error text: U3.
4. **Dedup across audiences (F298)** — two rows, and a private upload never silently resolves to the public row: D2.
5. **The migration meets an issued statement** — PDF bytes immutable, undeletable; the constant-default `ADD COLUMN` fires no trigger: D5 steps 2-3, D2 F44 tests.
6. **Pre-flip assertion** — raises on a bundle image that is also a ticket attachment, a statement PDF or a photo: D5 step 5. The error is the only designed failure and names the count.
7. **Unparseable bundle in the migration** — notice and skip, never an abort: D5 (garbage-JSON org).
8. **`public_site` JSON or PDF** — impossible at the adapter and at the CHECK: D2.
9. **Listed person with `hide_photo`** — still listed, no photo, asset 404: D1, D3.
10. **One blob, two people (one listed)** — served while any holder is listed: D1.
11. **A future photo writer stores a photo as `public_site`** — an unlisted person's photo still 404s; a listed person's is `roster` class (1-day private cache), not `site`: D1.
12. **Merged person** — the definer mirrors the roster functions exactly, because it calls them: D1 parity property.
13. **Suspended site, inactive org, flag off** — same 404: D1 (suspended, provisioning, inactive), D4 and E1 (flag).
14. **Custom host and alias** — keyed on the resolver's `organizationId`, never on the request host; alias does not redirect assets: U3, E1.
15. **`X-Content-Type-Options` doubled** by the global header plus the route's — E1 asserts the exact value; the resolution rule is written in the e2e section. (Unverified until E1 runs.)
16. **Migration re-run** — idempotent; re-run heals a `private` current mark; never touches a statement PDF: D5 step 4.
17. **Concurrent `store()` of identical bytes** — the check-then-insert race and its unique-violation outcome pre-date this change and are unchanged. *Unverified.*
18. **Old code in the deploy window** — covered by the runbook and exercised by D5's insert without `audience`. The same-sha short-circuit means a repeat push does not heal; the runbook says push a new commit.
19. **Directory flags do not gate a listed person's photo** (see Permissions & Flags). *Unverified by test; accepted as consistent with the roster functions, escalated to the operator in the handoff.*
20. **Very large image (up to the 10MB cap) held in memory per request** — unchanged from today. *Unverified.*
21. **A `HEAD` request** — Next derives it from `GET`; not separately tested. *Unverified.*
22. **Typecheck fallout** — new non-null columns on `ticketMessages`/`givingStatements`/`blobAssets` have defaults, so inserts compile; test fixtures that build a *full* selected row object may need the new field. Found by `npm run typecheck`, not by design.
23. **Vercel edge caching of the `site` class** — expected not to be held at the edge (no `s-maxage`); confirmed or refuted by V5, not assumed.

## Copy

No visible page text, button, dialog, toast or email is added. The strings that change or appear, with the four checks recorded one line per group:

| # | String | Where | Residuals | Source of truth | Audience | Neighbours |
|---|---|---|---|---|---|---|
| C1 | The 404 body `{"error":"Not found"}` (unchanged) | route | Denies nothing | Not a claim about a state; a literal | Anonymous visitors and probers; no instruction | Identical to today's string; `serving.spec.ts:240` compares it across states and stays true |
| C2 | Three public-listing toggle dialogs, "on" branch, **changed**: `This makes ${personName}'s name, role, and photo (if one is on file and they haven't hidden it) visible to anyone visiting the public website — including search engines and archival crawlers.` | `src/app/(org)/o/[slug]/admin/staff/public-listing-toggle.tsx:124`, `…/officers/public-listing-toggle.tsx:113`, `…/groups/public-listing-toggle.tsx:137` | Denies no residual: it still says search engines and archives (the cached-copy residual), and does not say a photo can be recalled | "photo (if one is on file)" = `people.photo_key is not null`; "hasn't hidden it" = `person_privacy.hide_photo` read by both roster functions (`left join person_privacy pp on pp.person_id = p.id and pp.organization_id = p.organization_id`). It does **not** claim the photo is shown, only the conditions under which it can be | The org admin holding the staff/officer/group listing permission that renders the toggle; the string makes no promise and gives no instruction. (`hide_photo` is the member's own directory privacy; the admin is told it exists, not asked to change it.) | **Stale because of this feature:** exactly these three strings (grep `if one is on file`). Their test files are modify targets. The "off" branch (`This stops serving … It does not retract anything already cached or indexed elsewhere …`) stays true (residual: copies in caches and archives) and is **not** modified |
| C3 | `BlobValidationError` for a bad public image: `blob-store: audience "public_site" requires an image content type (png, jpeg or webp); got "<contentType>"` | `blob-store.ts` `store()` | Does not mention takedown or cache | Argument `contentType` | Reaches `fileError` in the two logo actions and the ingest 422 only if a caller skipped its own image sniff; both sniff first, so unreachable in practice; whoever sees it is the platform operator or the site repo's CI log. It carries no instruction | The existing sibling message `blob-store: content type "…" is not one of …` has the same shape and prefix; not stale |
| C4 | Log line `[site-assets] public asset read failed; treating as not found` + `{ mode, slug, key }` | route | n/a | Operator log | Platform operators reading logs | Replaces `[site-assets] blob resolve failed; treating as not found`; no other file greps it (`route.test.ts` is rewritten) |
| C5 | Migration messages: the `check_violation` text in the pre-flip assertion; the `0072: flipped N blob(s) to public_site` and `…not parseable JSON; its images stay private…` notices; the trigger's `blob_assets %: audience is immutable (% to %)` | `0072` | n/a | The temp table, the update row count, the bundle parse | The person applying the migration (owner) who can resolve a cross-reference; the trigger text is seen by a DBA only | New; 46o's labels updated in place |
| C6 | Release note (below) | `docs/release-notes/vX.Y.md` | Names all three residuals (no takedown, copies in caches and archives, the brief old-code window is internal and omitted without denying) | Counts: "no photos are stored today" = production `people.photo_key` count 0 (2026-10-25); "about a day" = `private, max-age=86400`; "hide my photo" = `person_privacy.hide_photo` | Org administrators and platform operators who read release notes | Existing statement-directory release note says un-listing "cannot retract existing caches": still true, and this note repeats it |
| C7 | Code comments that become false (maintainer-facing) | `render-site-page.tsx:57-60` ("that route is generic (resolves any blob key for the org …)") and `:187-194` ("falls back to the manifestKey itself, which the asset route then fails to resolve as a blob id"); `sites.ts:210-216` ("resolves `[key]` as a literal `blob_assets.id` via `getBlobStore().resolve()`"); the route header (`route.ts:7-37`: "PURELY PUBLIC, CONTENT-ADDRESSED", its own `resolve()` call, "mirrors DECISION-049's logo-asset reasoning"); `route.test.ts:1-16`; `blob-store.ts:1-50` ("Every caller goes through store()/resolve()", "people.photo_key stays untouched"); `assets.ts:19-23, 36-45`; `giving.ts:859`; `check-schema-parity.ts:101, 139-158`; `page.test.tsx:401-403` | Each rewrite states the Tier-1 truth (no takedown) | Read from the migration and route | Maintainers | Listed above; `sites.ts:819` ("reusing the SAME public asset route that already serves it anonymously") stays true |

**Release-note draft (final wording is the `/release-notes` skill's):**
> **Safer public website images.** A congregation's public website now serves only the images the site itself publishes (page images and the logo) and the photos of people who are currently listed on a public staff, officer or committee list. Any other stored file now answers "not found", the same as a file that does not exist. This closes a gap in which a file belonging to a congregation, such as a support-ticket screenshot or a contribution statement, could have been fetched by anyone who knew its exact link while the website was live. No such file is known to have been exposed. People who have chosen to hide their photo in the directory no longer have it shown on public lists, even when they are listed. Photos on public lists are now kept by browsers for about a day instead of a year, so an un-listed person's photo stops showing sooner; copies already saved by browsers, search engines or web archives cannot be recalled, and an image removed from a website can still be fetched by its exact link until a follow-up change. No action is needed and no website needs re-publishing. No photos are stored in the platform today.

## Follow-ups (TODO lines for the orchestrator to land at integration, Rule 10)

- [ ] F289 Tier 2 — takedown by reference: serve a `public_site` image only while the live bundle's `imageKeys` or the mark names it; decide `s-maxage` on the `site` class with it (they conflict) — `docs/work-log/2026-10-25-public-asset-allowlist.md` DECISION-277
- [ ] `people.photo_key` → `uuid` + composite FK `(photo_key, organization_id, asset_audience) → blob_assets(id, organization_id, audience)` pinned to `private`, with the first photo writer (which stores photos as `private`) — same work-log, R4
- [ ] Brand restore must re-`store()` the old bytes as `public_site`, not repoint at a historical key; note it on DECISION-059's restore text — same work-log, R1.4
- [ ] When the first page renders the wordmark: `store(public_site)` it and add it to the public set (operator ruling: mark only until then) — same work-log
- [ ] presby-site-kit: let `imageUrl` return `undefined` so an unmapped image key renders no `<img>` (today a nil-uuid URL renders a broken image) — same work-log, Gap 7
- [ ] Operator question: should a listed person's photo be fetchable while `sites.public_staff_directory` / `sites.public_committee_directory` is off? (Today yes by exact uuid; the roster functions never read those flags.) — same work-log, Edge Case 19
- Done line at ship: `F289 closed; F297/F298 closed (migration 0072, v…)`.

## DECISION-277 (final text, for `docs/decisions.md`, newest first)

**DECISION-277 — `blob_assets.audience` (fail-closed); the public asset route serves a `public_site` image, or the photo of a person currently listed, through one definer; private consumers pin `'private'` by composite FK.**

**Status:** Resolved (architect, Phase 2; tech-lead, Phase 3) · **Date:** 2026-10-25 · **Feature:** `2026-10-25-public-asset-allowlist` (F289; F297/F298; migration 0072)

- **Column.** `audience text not null default 'private'`, CHECK `in ('public_site','private')`, immutable by trigger on every connection. The default is permanent and fails closed; `store()` takes `audience` as a required argument with no default (departs from DECISION-270's and Gap 14's "no default" at the database level only). CHECK: `public_site` implies png/jpeg/webp. Dedup key `(organization_id, audience, content_hash)`; FK target `(id, organization_id, audience)`; `blob_assets_id_org_key` stays.
- **Backfill.** Inverts DECISION-270's direction. Everything starts `private`; current marks and the `imageKeys` of every current bundle (whatever the site's status) flip to `public_site`. The bundle JSON, wordmarks, historical marks and orphans stay `private`. The migration raises if a flip candidate is also referenced by a ticket attachment, a statement PDF or a person photo, and skips (with a notice) a bundle that is not parseable JSON.
- **Private consumers.** `ticket_messages` and `giving_statements` (and, from 0073, receipts) carry `asset_audience = 'private'` in a three-column composite FK to `(id, organization_id, audience)`. Constraint names and NO ACTION on delete and update are kept (F44). A catalog test requires every FK into `blob_assets` to be on the public-reference allowlist or to carry that constant.
- **Serving.** `resolvePublic()` → `presby_public_site_asset(org, key)`, granted to `presby_app` only. Image types only. A key that is **any** person's `photo_key` is served only while `presby_public_staff_roster` / `presby_public_committee_roster` list it, under `private, max-age=86400`; otherwise a key is served only if it is `public_site`, under `public, max-age=31536000, immutable`. Every miss is one byte-identical `no-store` 404; the key is validated as a uuid before any read. `hide_photo` withholds the photo from both roster functions (operator ruling) and so from the asset door.
- **Implementation.** The audience is a string literal at every `store`/`resolve`/`resolveMeta` call, pinned by a TypeScript-AST source scan against a checked-in table. The exclusion check indexes `lower(photo_key)`. An unmapped site image key renders as a constant never-existing uuid, because the site-kit contract has no "no image".
- **Accepted residuals.** Tier 1 has no takedown: a `public_site` image stays fetchable by its uuid after it drops out of a bundle (Tier 2 is a follow-up). Copies already in browsers, search engines or archives cannot be purged. Old code running between the migration and promotion can produce `private` images, which a re-ingest (a new commit) heals. A listed person's photo is fetchable by its exact uuid while the directory flag is off. `people.photo_key` has no FK until a photo writer ships.
- **Revisit if** a non-image class needs public serving, a photo writer ships (add the `photo_key` FK), or takedown is required (Tier 2).

## Out of Scope (explicit non-goals; confirm with the user)

Photo upload or management UI; purging CDN, browser or archive copies of anything fetched before the fix; authenticated or signed asset URLs; serving the wordmark publicly; re-keying or re-hashing existing blobs; the `presby_*` prefix rename; Tier 2 takedown; the `people.photo_key` FK; `s-maxage` on the `site` class; a site-kit change so an unmapped key renders nothing; gating the roster-photo branch on the directory flags; any change to the member-directory photo path (`person-avatar.tsx` only gains `audience: "private"`).

## Implementer

**Batch 1: database-admin** (migration 0072, Drizzle declarations, parity rows, 46o, RLS section 72, snapshot harness, D2/D3/U7).
**Batch 2: full-stack-developer** (adapter, validator, route, every call site, renderer, the three copy strings, unit/DB/e2e tests, staged Rule 16 patches, the runbook text). Full-stack rather than api-developer because the batch spans server code, three client-component strings and e2e, and splitting it would add handoffs without adding a specialist's judgment. Port **3600**. Batch 2 starts only after Batch 1 reports green on the migrated pipeline branch.

**Handoff notes:**
- The orchestrator applies P1-P4 at integration (and `scripts/test-rls.sql` is re-run on the merged `development` branch after the merge, Rule 16). Migration order: 0072 must sort before treasury 0073 and careers 0075; treasury's receipt FK targets `blob_assets_id_org_audience_key`, so the constraint name is fixed.
- Operator question for the record: Edge Case 19 (directory flags do not gate a listed person's photo).
- No new F-number claimed; the orchestrator may assign one to Edge Case 19.

---

# Phase 4 — Implementation

## Batch 1 — database-admin (migration 0072), 2026-10-25

**Migration mode: hand-written.** `drizzle/0072_presby_blob_audience.sql`, applied to the pipeline Neon branch only (`pipeline-asset-allowlist`, endpoint `ep-dry-dream`; never development or production) with `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0072_presby_blob_audience.sql`. `_journal.json` entry `{ idx: 72, tag: 0072_presby_blob_audience }` is applied in the working tree but **not committed** (Rule 16; see "Shared files").

### Files Created

- `drizzle/0072_presby_blob_audience.sql`: R1 steps 1-12 in order, plus comments. Corrections to the design text are listed below.
- `scripts/assets/test-rls-72.sql`: RLS section 72, 24 assertions, run as `presby_app`.
- `scripts/assets/test-0072-migration.sh`, `0072-preimage.sql`, `0072-preimage-issue.sql`, `0072-crossref.sql`, `0072-postimage.sql`: the D5 snapshot harness.
- `src/lib/db/domain/blob-audience.schema.test.ts`: U7, static. Pins step order, idempotence markers, consumer FKs, function hardening, Drizzle mirrors, and the `people.organization_id` regression.
- `src/lib/storage/blob-audience.db.test.ts`: D2, the database half (22 tests).
- `src/lib/db/domain/public-roster-photo.db.test.ts`: D3 (8 tests). Includes one positive through the door as `presby_app`, which proves the definer reaches both roster helpers (0046 B-M1 rule).
- `docs/work-log/public-asset-allowlist.integration.patch`: the Rule 16 shared-file diff plus prose amendments for the orchestrator.

### Files Modified

- `src/lib/db/domain/assets.ts`:
  - adds `audience` (not null, default `'private'`);
  - adds `blob_assets_id_org_audience_key` and `blob_assets_org_audience_hash_key`, replacing `blob_assets_org_hash_key`;
  - adds the `blob_assets_audience_allowed` and `blob_assets_public_site_is_image` CHECKs;
  - updates the header and the dedup comment (Copy C7).
- `src/lib/db/domain/support.ts` (`ticketMessages`) and `src/lib/db/domain/giving.ts` (`givingStatements`): add `assetAudience` (not null, default `'private'`) and the `*_asset_audience_private` CHECK. The FKs stay DDL-only, and their comments now give the three-column form (the comment at `giving.ts:859` included).
- `scripts/check-schema-parity.ts`: the two rows carry the design's exact signatures, the header says "(5 rows)", and the `reason` strings are rewritten. The `assets.ts:63-78` references now point to `:87-101`, here and in `imports.ts` and `returns.ts`.
- `scripts/giving/test-rls-46.sql`: 46o arrays now take the three-column form, and the label is updated.
- `src/lib/db/domain/giving.schema.test.ts`: reads 0072 as well. It adds a parallel 0072 assertion and moves `BLOB_FK_SIGNATURE` to the three-column string. The 0056 assertions are unchanged.

### Schema Changes

- `blob_assets.audience text not null default 'private'`:
  - CHECK `in ('public_site','private')`;
  - CHECK `audience = 'private' or content_type in (png, jpeg, webp)`;
  - unique `(organization_id, audience, content_hash)` replaces `(organization_id, content_hash)`;
  - unique `(id, organization_id, audience)` is the FK target;
  - `blob_assets_id_org_key` kept;
  - trigger `blob_assets_audience_immutable` (BEFORE UPDATE OF audience, WHEN changed, SECURITY INVOKER function, EXECUTE owner-only).
- `ticket_messages.asset_audience` and `giving_statements.asset_audience`: `text not null default 'private'`, with a CHECK `= 'private'`. Both FKs keep their names and are re-keyed three-column to `blob_assets (id, organization_id, audience)`. `giving_statements_blob_fk` is NO ACTION on delete and update.
- `presby_public_staff_roster` / `presby_public_committee_roster`:
  - same signatures and result rows;
  - `hide_photo` withholds the photo; the person stays listed;
  - `search_path = public, pg_temp`, revoke and grant restated.
- `people_photo_key_lower_idx on people (lower(photo_key)) where photo_key is not null`.
- `presby_public_site_asset(p_org uuid, p_key uuid) returns table (content_type text, bytes bytea, cache_class text)`: SECURITY DEFINER, pinned, EXECUTE owner + `presby_app` only.
- `people.photo_key` FK: none (R4).

### Audit Events

None. This is a provisioning migration, per the 0057 precedent.

### Design claims found wrong (loop-back candidates for tech-lead)

1. **`people.organization_id` does not exist** (D1: `people` is global). The design used it in four places: the pre-flip assertion, both roster joins, the door's photo test, and the index `people (organization_id, lower(photo_key))`. The D5 snapshot run failed with `column p.organization_id does not exist`. The corrections preserve intent:
   - A photo is matched on the globally unique key alone, which is stricter.
   - The index is renamed `people_photo_key_lower_idx on people (lower(photo_key))`.
   - The U7 regression is "never reads people.organization_id".
   - Proposed F-number: the orchestrator assigns one.
2. **The `person_privacy` join scope needs a ruling.** `person_privacy`'s primary key is `person_id` alone, so a person has at most one privacy row, tagged with the org it was set in.
   - I join on `person_id` alone. A hidden photo is then withheld on every org's public list, including one other than where the flag was set. This fails closed and keeps the release-note sentence "People who have chosen to hide their photo … no longer have it shown on public lists" true for a person on two orgs' lists.
   - D3 pins this ("a photo hidden at ANOTHER org …").
   - The alternative mirrors the member directory: `pp.organization_id = o.id` (`directory.ts` scopes to the viewing org). It is a one-line change in three joins, but it would publish such a person's photo at the other org.
3. **P3 "`idx: <next>`".** The journal's rule is `idx` equals the migration's number (0058 is absent, so idx 58 is absent too). The entry is `idx: 72`, with `when` = 0064's value + 8 days, so 0065-0071 can sort before it.
4. **D2 says "presby_platform UPDATE of audience is refused" through `set role`.** That cannot be built: `presby_platform` is NOLOGIN, and `neondb_owner`'s membership has `set_option = f`. So no session can act as `presby_platform`. It is proven structurally instead:
   - it holds UPDATE, so the trigger is its only barrier;
   - the trigger fires in origin mode (`'O'`);
   - it is not the owner;
   - it has no SET on `session_replication_role`.

   Similarly, D5's "set the GUCs and `\ir` the issue harness" as `presby_app` cannot run under `set role`. The statement is issued on a real `presby_app` login to the scratch database, so the harness takes two URLs.
5. **D2's adapter cases belong to Batch 2.** These are: `store()` dedup per audience, `resolve`/`resolveMeta` refusing the other audience, and `BlobValidationError`. They test code Batch 2 writes. Batch 1's D2 proves the database half of each:
   - two rows per audience; dedup within an audience;
   - the CHECKs;
   - the FK refusal.

### Red, then green

**Red (pre-0072 branch):**
- U7, D2 and D3 together: 24 failed, 4 passed. The 4 that passed are pre-existing invariants: the PDF delete refusal, the two roster-hardening checks, and the `hide_photo` toggle.
- U7 failed on the absent file.
- `test-rls-72.sql` stopped at 72a, line 62.

**D5 snapshot** (`scripts/assets/test-0072-migration.sh`, scratch database `scratch_0072` on the pipeline branch's compute, dropped afterwards). PASS:
1. 64 migrations from empty via `drizzle-kit migrate`, then `seed-dev.sql`.
2. Pre-image: 11 classes plus one statement issued and committed as `presby_app`.
3. Cross-reference: refused with `0072: 1 blob(s) are both published …`, rolled back whole (no `audience` column, ticket message gone).
4. First apply: `flipped 3`. The Bramblewood garbage bundle produced a notice, not an abort.
5. Postimage: all classes correct. The statement PDF's md5 and content_hash are unchanged. DELETE, UPDATE of bytes and UPDATE of audience are each refused by the named mechanism. Both FKs are three-column with action `a`/`a`. An old-code insert lands `private`.
6. Re-apply: `flipped 0`.
7. Heal: an old-code private mark gives `flipped 1`, for 4 public rows.

**Pipeline branch:**
- Expected flip computed beforehand: 84 (marks plus `imageKeys` images, 0 dangling).
- Apply 1 flipped 84.
- Apply 2 (whole file) flipped 0, exit 0.
- Blob count (111) and the `id||content_hash` fingerprint are identical before, after apply 1 and after apply 2.
- Result: 84 `public_site` (79 jpeg, 2 png, 3 webp) and 27 `private` (26 JSON, 1 png).
- Re-applied twice more after the `person_privacy` join change: exit 0, `flipped 0` both times, and the `id||content_hash||audience` fingerprint over 111 rows is identical before and after each. Both roster bodies read `left join person_privacy pp on pp.person_id = p.id` with no `pp.organization_id`.
- Final D5 on the final file: PASS (47 pass lines). Scratch databases dropped (0 `scratch%` databases remain).

**Failing-first, per mechanism** (each removed on the pipeline branch, observed red, restored, observed green):

| Mechanism removed | Red where |
|---|---|
| `blob_assets_audience_immutable` disabled | `test-rls-72.sql:86` (72a); D2: owner immutability, `presby_platform` pin, statement-PDF audience |
| `presby_public_site_asset` granted to PUBLIC | `test-rls-72.sql:93` (72a ACL) |
| `ticket_messages_asset_audience_private` dropped | `test-rls-72.sql:74` (72a CHECKs), 72b catalog rule line 19; D2 "constant cannot be set", "catalog rule" |
| Roster functions reverted to the 0042 bodies | D3: staff/officer, `p_kind`, committee, door-as-`presby_app` (4 red) |
| Staff roster re-created without `set search_path` | `test-rls-72.sql:93`; D3 hardening (`proconfig` was empty) |
| Staff roster `person_privacy` join scoped to the listing org (the claim-2 alternative) | D3 "a photo hidden at ANOTHER org …" (1 red, 7 green) |
| Pre-flip assertion block removed | D5 step 5 red. 0072 still failed, at step 8's FK validation (the backstop), but without the designed refusal |

**Green:**
- U7, D2, D3, `giving.schema.test.ts` and `giving-statements.db.test.ts`: 102/102.
- `test-rls-72.sql` as `presby_app`: 24/24.
- Full `scripts/test-rls.sql` as `presby_app` on a fresh scratch database, built in CI's order (migrate through 0072 with the local journal, `check:schema-parity` 0 failing, `db:seed`, `seed-dev.sql`, helpers): exit 0, 1273 passes, including 24 in section 72 and the three-column 46o.
- On the shared pipeline branch the full file stops at `test-rls.sql:217`, the documented pre-existing drift (an untracked third presbytery membership; the file's own comment says so). It is unrelated to 0072.
- `npm run check:schema-parity` (pipeline branch): 0 failing.
- `npm run typecheck`: clean. `npm run lint`: clean. `npm run check`: 8/8.
- Full `npm run test:db` (667 files, serial, 2426 s): 11342 passed, 1 skipped, 5 failed. All 5 failures hard-code `http://localhost:3000` against this worktree's `.env.local` `NEXT_PUBLIC_APP_URL=http://localhost:3600`, and none touches 0072:
  - `src/proxy.test.ts:435`
  - `src/lib/auth/safe-callback.test.ts:239`
  - `src/app/(member)/feedback/actions.test.ts:516`
  - `src/app/(org)/o/[slug]/tickets/actions.test.ts:333`
  - `src/lib/onboarding/issue.db.test.ts:303`

  The four unit files pass 146/146 without `.env.local`. They are pre-existing worktree artifacts (port 3600 is Rule 16's per-pipeline port).
- Final re-run after the D3 two-org fixture fix: D3 8/8.

### Shared files (Rule 16)

- `scripts/test-rls.sql`: P2 applied verbatim, uncommitted.
- `drizzle/meta/_journal.json`: P3 applied with the `idx: 72` correction, uncommitted.
- Both are reproducible from `docs/work-log/public-asset-allowlist.integration.patch`, which reverse-applies cleanly against the working tree.
- That file also carries: the DECISION-277 amendments (items 1, 2 and 4 above), one TODO line (`drizzle/0053:833` still cites `assets.ts:63-78`; it has shipped and is not edited), and the F-number request.
- P1 (`e2e/support/custom-hosts.ts`) and P4 are Batch 2's and the orchestrator's; untouched.

### Handoff to Batch 2 (full-stack-developer)

- **The pipeline branch is migrated.** Do not re-run 0072 except whole-file with `-1`; it is idempotent.
- **The door:** `select content_type, bytes, cache_class from presby_public_site_asset($org::uuid, $key::uuid)`.
  - Call it on `db` (`presby_app`) with no org GUC.
  - `cache_class` is `'site' | 'roster'`.
  - It returns zero rows for every miss.
  - A person's photo is matched on the key alone (global), and only while a roster lists it for that org.
- **Columns:** `blobAssets.audience`, `ticketMessages.assetAudience`, `givingStatements.assetAudience`. Never write the two `asset_audience` constants.
- **Until `store()` changes,** every insert lands `private`, so local ingest and logo uploads produce private rows. The old route still serves them through `resolve()`.
- **After the change:**
  - dedup must filter on `audience`; the unique key is `(organization_id, audience, content_hash)`, so `store(public_site)` of bytes already held as private creates a new row;
  - a `public_site` JSON or PDF insert is refused by `blob_assets_public_site_is_image`.
- **Write the adapter half of D2** (claim 5 above). D1 should add:
  - the "hidden at another org" case;
  - a stored-uppercase `photo_key`;
  - the parity property.
- **The R6 catalog test already exists** in D2 ("the catalog rule") and in 72b. U4 needs only its source-scan half.
- **Three unit tests fail under this worktree's `.env.local` and pass without it:** `src/proxy.test.ts`, `feedback/actions.test.ts` and `src/lib/auth/safe-callback.test.ts`. The cause is `NEXT_PUBLIC_APP_URL=http://localhost:3600`. They are pre-existing and their sources are untouched.

Strings added or changed: no user-facing strings. Migration and trigger messages are as in Copy C5 (`0072: % blob(s) are both published …`, `0072: flipped % blob(s) to public_site`, `0072: the bundle of organization % is not parseable JSON …`, `blob_assets %: audience is immutable (% to %)`). Maintainer comments in `assets.ts`, `support.ts`, `giving.ts` and `check-schema-parity.ts` are updated per C7.

## Batch 2 — full-stack-developer, 2026-10-26

Branch `pipeline/public-asset-allowlist`, merged `origin/main` at 0.44.0 first (0067 applied to the pipeline Neon branch `pipeline-asset-allowlist` so the merged code ran against a matching schema; 0072 re-applied whole, `flipped 0`, ACL intact, after two definer mutation experiments below). Commits: `e81287f` (the fix), `40fa74b` (the e2e spec), then the docs and this section.

### Files Created

- `src/lib/storage/blob-key.ts`: `parseBlobKey()`, the one uuid-shape gate (pure, no `server-only`).
- `src/lib/storage/blob-key.test.ts` (U1, 20), `blob-store-public.test.ts` (U2, 17), `audience-callsites.test.ts` (U4, 13), `public-asset.db.test.ts` (D1, 32).
- `src/app/(public)/site/[slug]/assets/[key]/route.db.test.ts` (D4, 5).
- `e2e/custom-domains/assets.spec.ts` (E1, 12).
- `docs/deployment.md`: new section "Public asset audience (0072)" with the pre-deploy runbook and the V1-V6 verification.
- `docs/work-log/public-asset-allowlist.integration.patch`: rewritten for the merged base; four diffs (journal, `test-rls.sql`, `e2e/support/custom-hosts.ts`, `e2e/support/public-calendar-fixture.ts`) plus the prose for the orchestrator.

### Files Modified

- `src/lib/storage/blob-store.ts`: `BlobAudience`, `PublicImageType`, `PublicAsset`; `audience` required on `StoreInput`/`ResolveInput`; `store()` dedups on `(org, audience, hash)`, writes and returns `audience`, throws `BlobValidationError` for a `public_site` non-image; `resolve()`/`resolveMeta()` match only the named audience; `resolvePublic()` (key validated, one `db.execute` of the definer on the `presby_app` connection with no GUC, a second type/class check, `Buffer.from`, errors propagate). Header rewritten.
- `src/app/(public)/site/[slug]/assets/[key]/route.ts`: rewritten (key, then site, then asset; one `notFound()` helper; per-class cache; log is `{ mode, slug, key }`).
- 18 call-site files, one audience literal per call (7 `store`, 11 `resolve`, 5 `resolveMeta` = 23 calls), plus the route's `resolvePublic`: see `audience-callsites.test.ts`'s `ACTIVE` table for the exact file-to-literal map.
- `render-site-page.tsx` (`MISSING_IMAGE_KEY`, comments), `sites.ts` (comment only), the three `public-listing-toggle.tsx` files and their tests.
- Tests that assert call arguments or insert through `store()`: both statement download route tests, `person-avatar.test.tsx`, `directory-grid.test.tsx`, `sites-resolve-site.test.ts`, `branding/page.test.tsx`, `tickets/actions.test.ts`, `organizations/[id]/actions.test.ts`, `upload-attachment-action.test.ts`, `ingest/route.test.ts` (images `public_site`, bundle `private`), `tenant-branding.test.ts` (a stored logo is `public_site`), `sites.test.ts`, `read-org-brand.test.ts`, `[[...path]]/page.test.tsx` (U5), `blob-store.test.ts` (adapter half of D2, +7).
- `scripts/public-calendar/seed-dev-bundle.sql`: `ON CONFLICT` target (see deviation 1).
- `playwright.config.ts`: `assets` joins the `prod-custom-hosts` testMatch.

### Endpoints and signatures

- `GET /site/[slug]/assets/[key]` (and `/assets/[key]` on a custom host): public, no session, gated by `sites.public_render` only (no permission, no new flag, no audit). 200 `site`: `public, max-age=31536000, immutable`; 200 `roster`: exactly `private, max-age=86400`; every miss: 404 `{"error":"Not found"}`, `no-store`, `nosniff`.
- `getBlobStore().store({ organizationId, bytes, contentType, audience })`, `.resolve({ organizationId, key, audience })`, `.resolveMeta(...)`, `.resolvePublic({ organizationId, key })`.
- No schema change in this batch, no new env var, no new `FEATURES` entry, no new flag.

### Deviations from the design

1. **`ON CONFLICT (organization_id, content_hash)` in a merged fixture.** The design's grep ("none in src, scripts, e2e") was true at `2a25584` and false at 0.44.0: the public-events-calendar pipeline added `e2e/support/public-calendar-fixture.ts` and `scripts/public-calendar/seed-dev-bundle.sql`, both with that target, which 0072 drops. `e2e/custom-domains/public-calendar.spec.ts` failed in `beforeAll` ("no unique or exclusion constraint matching the ON CONFLICT specification"). The seed script is fixed and committed; the e2e support file is a Rule 16 file and rides in the patch (diff 4). Needs an F-number (patch item 4). Any pipeline that merges after 0072 and uses that conflict target breaks the same way.
2. **E1's private-class assertions are ordered first** (a plain "not served" status check, then the byte-for-byte comparison), so the red run on the old route reads "private PNG must not be served, expected 404 received 200" instead of failing earlier on the missing `no-store` header.
3. **U4's exemption list is a named constant** (`EXEMPT_METHODS`, currently `resolvePublic`), per the orchestrator's S1 ruling: every other `getBlobStore().<method>(` call needs an audience literal, so a later adapter method (`findByContentHashes`, `resolveMany`) is a table edit. The scan also has a self-test block (it is not vacuous) and two DECISION-030 assertions (no non-test file but `blob-store.ts` imports `blobAssets` or holds raw `from|join|into|update blob_assets` SQL in a string literal).
4. **D2 adapter half lives in `blob-store.test.ts`** (the real-database adapter file) rather than `blob-audience.db.test.ts`; an out-of-vocabulary audience is refused by the database CHECK, not a new adapter error, because the only error strings allowed are in the Copy table.
5. **Toggle dialogs at 360px.** The three toggles sit in a `hidden sm:table-cell` cell, an existing design, so on a phone the dialog is not reachable from the roster at all. The check below forces the cell visible to see the dialog's own layout at 360px and also opens it naturally at 640px.
6. `playwright.config.ts` change (the `assets` spec joins the production lane): not in the design; a one-word testMatch edit.

### Red, then green

- **U1** module absent (suite failed to load) then 20/20. **U2** 17 failed (`resolvePublic is not a function`) then 17/17. **U3** 16 failed, 2 passed (the two site-miss cases) then 18/18. **U4** 2 failed, 11 passed (no audience anywhere) then 13/13. **U5** 1 failed (`/assets/missing`) then green. **Toggle copy** 3 failed (one per file) then green.
- **E1 on the unfixed route** (`next dev` at :3600): 3 failed, 9 passed; the three failures are "private PNG (ticket-attachment-shaped) must not be served: expected 404, received 200", on the canonical host, the alias and the platform host. After the fix: 12/12.
- **D1, D2 adapter half, D4** are green on first run after their own fixture bugs (a derived group needs `derived_from`; one `hostIs` ordering slip in D4), and their value was proven by mutating the definer on the pipeline branch (each restored from `pg_get_functiondef`, then 0072 re-applied whole with `flipped 0` and the ACL checked):
  - mutation 1 (a photo key served whenever it is anyone's photo): D1 11 failed, 21 passed (every unlisted, ended, hidden, derived-group, exclusion and parity case);
  - mutation 2 (a non-photo key served whatever its audience): D1 4 failed (private image, ticket image, wordmark, historical mark), 28 passed; D4's "every miss is byte-identical" failed on "private image (slug mode): status 200".
  The statement PDF and the bundle JSON stay unserved under mutation 2 because of the definer's image-type test: that is the intended belt-and-braces layer, not a gap in D1.

### Gates

- `npm run typecheck`: clean. `npm run lint`: clean (`--max-warnings=0`). `npm run build`: passes. `npm run check`: 8/8 (re-run `check:secrets` with the new files staged: passes). `npm run check:schema-parity`: 0 failing.
- `npm run test` (no `.env.local`): 596 files passed, 85 skipped; 9054 tests passed, 2578 skipped.
- DB-backed, serial, `.env.local`: D1 32, D2 `blob-store.test.ts` 14 and `blob-audience.db.test.ts` 22, D3 8, D4 5 (the four files together: 49), and the other touched suites (`ingest/route.test`, `read-org-brand.test`, `giving-statements.db.test`, `directory.test`, `serving.db.test`, `giving/statements.db.test`, `sites.test`, `sites-render-fail-closed.test`, `tenant-branding.test`, `giving.schema.test`, `blob-audience.schema.test`): 11 files, 350 tests, all passed. The full `npm run test:db` (about 40 minutes) was not re-run; Batch 1's full run is the baseline and this batch added no schema.
- **The five Batch 1 `test:db` failures are environmental, cause confirmed.** `src/proxy.test.ts:435`, `src/lib/auth/safe-callback.test.ts:239`, `(member)/feedback/actions.test.ts:516`, `tickets/actions.test.ts:333` and `onboarding/issue.db.test.ts:303` hard-code `http://localhost:3000` or the `localhost:3000` host, while this worktree's `.env.local` sets `NEXT_PUBLIC_APP_URL=http://localhost:3600`. Evidence: all five pass in the no-env unit run above; with `NEXT_PUBLIC_APP_URL=http://localhost:3000` exported over `.env.local`, `safe-callback`, `feedback/actions`, `issue.db` and `tickets/actions` pass; `proxy.test.ts:435` additionally needs the variable unset (its production branch expects `localhost:3000` NOT to be a platform host) and passes only in the no-env run. None touches this change.
- **e2e, own dev server at :3600** (`next dev -p 3600`, `E2E_BASE_URL`/`AUTH_URL` `http://localhost:3600`, `RATE_LIMIT_DISABLED`, `DOMAINS_*` fakes, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET`, `E2E_ALLOW_SHARED_DB`; stopped by PID):
  - `e2e/custom-domains/assets.spec.ts`: 12/12.
  - all of `e2e/custom-domains` (`--project=custom-hosts`): 115 passed, then the one failure (`public-calendar.spec.ts`, deviation 1) and its 7 dependants re-run after the fix: 8/8.
  - `branded-signin`, `public-sites`, `public-calendar`, `giving-statements`, `giving-public` (`--project=chromium`): 68/68.
  - **production-build lane** (`PW_PROD_BUILD=1 PW_PROD_PORT=3600`, `--project=prod-custom-hosts`: assets, headers, lockdown, serving): 76/76. `x-content-type-options` is a single `nosniff` on the production build as well as on dev (Edge Case 15 resolved: Next replaces the route-level value, it does not append).
- **Real-browser 360px.** E1's two browser tests run in Chromium: the custom host's home page and the WALK platform page, each with the hero image, the header logo and the footer logo (`complete` and `naturalWidth > 0`: 3, 2 and 3 px natural widths for the 3x3 mark and 2x2 hero), image right edges at 82/340/88px, `scrollWidth` at most 360 on both. Screenshot of the platform page read: logo and hero render, nothing overflows. The three toggle dialogs at 360px (cell forced visible, deviation 5) and at 640px (natural): the dialog is inside the viewport (x 22 to 337 of 360), the new sentence and "including search engines and archival crawlers" are present, both buttons are visible and inside it (the buttons measure about 35px tall, an existing size I did not change). Screenshots of staff at 360px and groups at 360px read.
- Throwaway helper specs used for the screenshots and the dialogs were deleted, and their fixture rows (a role, three people, a group, a staff position, an officer term) removed with a confirming SELECT; the pipeline branch has no `Toggletest` people left.

Strings added or changed: `src/app/(org)/o/[slug]/admin/staff/public-listing-toggle.tsx:124`, `.../officers/public-listing-toggle.tsx:113`, `.../groups/public-listing-toggle.tsx:137` (Copy C2, exactly: "This makes ${personName}'s name, role, and photo (if one is on file and they haven't hidden it) visible to anyone visiting the public website — including search engines and archival crawlers."); `src/lib/storage/blob-store.ts` `store()` (Copy C3); the route's `console.error` line (Copy C4: "[site-assets] public asset read failed; treating as not found"). Comment rewrites per C7 (route header, `render-site-page.tsx`, `sites.ts`, `blob-store.ts`). The runbook text in `docs/deployment.md` is documentation, not UI. No other string.

### For the next pipelines

- **site-ingest (`findByContentHashes` on this adapter):** add the method to `BlobStore` and `PostgresBlobStore`; it must take `audience` and filter on it (the dedup key is `(organization_id, audience, content_hash)`; a lookup that ignores audience is exactly F298). `audience-callsites.test.ts` already holds any `getBlobStore().findByContentHashes(` call to an `audience` literal by default; add its call sites to `ACTIVE`. If it ever must not carry one, name it in `EXEMPT_METHODS` with the reason. Ingest's `imageKeys` map must keep naming `public_site` images only (a `private` key in a bundle is a broken image, and `MISSING_IMAGE_KEY` is the nil uuid). A re-ingest of the same sha short-circuits as `already_current`: heal a private-image window with a new commit.
- **person-photos (rewrites the roster functions in 0078):** `create or replace` of `presby_public_staff_roster` and `presby_public_committee_roster` must restate `set search_path = public, pg_temp`, `revoke all ... from public` and `grant execute ... to presby_app` (0072 does, and `public-roster-photo.db.test.ts` pins the `proconfig` and ACL), and must keep `case when coalesce(pp.hide_photo, false) then null else p.photo_key end` joined on `person_privacy.person_id` alone (F340 ruling). The door `presby_public_site_asset()` CALLS the two roster functions and matches a photo on `lower(p.photo_key)` against the canonical key, so any change to their return type, to the case of `photo_key`, or to what `photo_key` holds (a `uuid` column after the FK follow-up) needs the door re-checked: run D1, especially the parity test ("for EVERY person in the matrix, the door serves the photo IFF a roster function lists the key"), the uppercase-`photo_key` case, and `public-roster-photo.db.test.ts`. A photo writer stores the photo `private` and adds the `(photo_key, organization_id, asset_audience) -> blob_assets(id, organization_id, audience)` FK pinned to `private` (the follow-up in the TODO lines). `person-avatar.tsx` resolves a photo with `audience: "private"`; `resolveMany`, if it appears, needs the same literal. A `private` photo is served publicly only while listed, as class `roster`, never `site`.
- **Any pipeline writing `blob_assets` with `ON CONFLICT`:** the target is `(organization_id, audience, content_hash)` since 0072.
- **Treasury (0073):** its receipt FK must carry `asset_audience` pinned to `private` against `blob_assets_id_org_audience_key`; the catalog test in `blob-audience.db.test.ts` fails otherwise. Move the `FORWARD` row for `src/lib/reimbursement/receipts.ts` to `ACTIVE` when it merges.

*Keep Phase 4 sections short: files, deviations from the design, gates with
counts, and anything the next phase must know. Leave out narration of how
the work went; git history already records it. Judgment output (analyst,
architect, qa) is still recorded verbatim.*

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

## Source

Found by the careers pipeline's Phase 1 (2026-10-25) and confirmed by its Phase 2 (F289): `/site/<key>/assets/[key]` resolves ANY `blob_assets` key in the org via `getBlobStore().resolve()` and serves it `public, max-age=31536000, immutable`. Consumers include brand marks (public by design), site images, ticket attachments, content bundles, giving statement PDFs (tier 2), and people photos (privacy-controlled). Not exploitable today (v4 UUID keys; statement keys never reach a client), but a key is a permanent, unrevocable bearer capability cached for a year. Architect's fix shape: serve a key only if it is publicly referenced (live bundle `imageKeys`, brand mark/wordmark, a currently public roster photo), `image/*` only, one definer predicate, one neutral 404. See /Users/cshenso/git/presby-platform/presby-careers/docs/work-log/2026-10-25-careers.md Phase 2 "F289 — is it live today?".

## Operator rulings (2026-10-25)

- **Open Question 2 — `hide_photo` wins:** a person who set "hide my photo" gets no photo on the public roster; the predicate and both roster functions (0041/0042) change together in 0072.
- **Open Question 1 — roster photos get a short public cache (about a day);** bundle images and the brand mark stay `public, max-age=31536000, immutable`.
- Open Question 3 (wordmark) proceeds on the analyst default: mark only until a page renders the wordmark.
- Migration is **0072** (renumbered; must sort before treasury 0073 and careers 0075).

---

# Phase 1 addendum (analyst), bug-fix variant: shared `blob_assets.audience` shape

**Provenance.** This addendum folds in input relayed by the coordinator from the treasury architect (treasury Phase 2, DECISION-270 and F297/F298). The ruling sets the shared shape for F289 that careers and treasury both depend on. I read it at `/Users/cshenso/git/presby-platform/presby-treasury/docs/work-log/2026-10-25-treasury.md` (DECISION-270, F297, F298, and the orchestrator's renumbering note).

Where this addendum conflicts with my earlier Phase 1 text, the addendum wins. Changes to my earlier text:
- Gap 6 is reshaped.
- Gap 5 is superseded.
- The numbers and complexity change.
- New Gaps 11–16 are added.

**Verdict is unchanged: READY WITH NOTES.** Phase 2 (architect) is required.

**Numbers now.** F289, DECISION-277, F297/F298, migration 0072. Treasury's two migrations follow as 0073 and 0074, and careers stays at 0075. 0072 must sort before treasury's 0073 and careers' 0075, and must be live in production before `GIVING_STATEMENTS_ENABLED`. Complexity is now medium: it adds a column, a trigger, a changed unique key, and re-keyed foreign keys on two shipped tables, and it touches every `store()` caller.

## The question asked: roster photos, `private` with an exception, or `public_site`?

**Recommendation: `private`, plus one narrow exception for currently-listed roster photos, inside the same definer predicate.**

The reasoning is about what each audience value means:
- **`public_site`** means the bytes are intrinsically published, and publication is not realistically revocable once cached. Bundle images and the brand mark qualify.
- **A person's photo** is personal data. Whether it is public is a revocable relationship (`public_listed`, `ends_on`, and `hide_photo` per Open Question 2), not a property of the bytes. If the photo were `public_site`, the audience column alone would make it a permanent public bearer capability the moment it was stored, even before anyone listed the person. That is the F289 bug again for exactly the data most likely to need retracting.
- **The backfill rule already says so.** DECISION-270 classes anything referenced by `people.photo_key` as `private`, so `private` is consistent with the ruling.

**What the exception costs.**
- The route can no longer say "`audience = 'public_site'`, full stop". It says "`public_site` image, or a `private` image that is the photo of a person currently publicly listed".
- The exception is a second branch in one `SECURITY DEFINER` predicate. It must be keyed to `people.photo_key` and nothing else, and must mirror the two roster functions' public-listing conditions exactly. Those are 0041/0042: staff, officer and committee listings, plus the `active` org and `live` site gates.
- A ticket, statement or receipt blob can never satisfy the exception. The one overlap is a ticket screenshot byte-identical to a listed person's photo, which dedups to one private row. That discloses nothing the photo doesn't already disclose.

**Alternative for Phase 2 to weigh: a publication copy.** Listing a person would store a `public_site` derivative with its own key. This keeps the route strictly `public_site`-only. But it needs a publish step, a photo-processing story and lifecycle cleanup that don't exist, and nothing writes `people.photo_key` yet. I don't recommend building that to close a bug.

**Do public staff directory photos keep working?**
- **Under the recommended design: yes.** They keep working through the exception.
- **If the architect drops the exception:** they would stop rendering, as broken images. That is only acceptable if production has zero photo-backed listed people.
- **Hard gate before Phase 3: get a production count.** Count `people.photo_key is not null`, joined to `blob_assets`, and separately the subset that is currently publicly listed. Nothing in `src` writes `photo_key` and `development` has zero photo blobs, so I expect zero. If it is non-zero, the exception must go live in the same deploy as the backfill. That is also F297's open "production needs a count" item.

## Changes to my earlier Gap 6 (the bundle-image allowlist)

The audience column changes the cost of the hardest part of my earlier design, so Phase 2 has a cheaper option than materializing or parsing the bundle:

- **Tier 1 (the floor in 0072).** The route serves a blob only if `audience = 'public_site'` and `content_type` is an image. The `public_site` set is exactly what ingest and the brand actions deliberately published. This needs no bundle parse, no materialized column, and no fixture rework beyond making the fixtures store `public_site` images. A plain `resolvePublic()` select under the trusted org context is enough for this branch. Only the roster-photo exception needs a definer, because anonymous callers must reach `people` and the roster tables only through narrow definers.
- **Tier 2 (adds takedown).** Also require that the key be currently referenced: the live bundle's `imageKeys` values, or the mark. This is what lets an operator retract a mistakenly published image by removing it from the repo. Without it, any `public_site` row stays fetchable by key indefinitely, and old marks and dropped bundle images stay reachable. That is a different property from F289's leak. It is real, but it is not the hazard class DECISION-270 closes.
- **My recommendation: ship Tier 1 in 0072 and track Tier 2 as an explicit follow-up** (a TODO line, not a silent omission), unless the operator wants takedown now. Treasury is waiting on 0072, and Tier 1 closes every private-consumer path as a database property. This overrides my earlier lean toward a full reference allowlist for bundle images; the architect's originally proposed shape was Tier 2. The roster-photo exception is reference-based by nature either way.

## New and amended gaps

11. **Backfill fail direction.** DECISION-270's "every other row becomes `public_site`" fails open: any blob with a consumer nobody listed (an import staging blob, a future consumer, an orphan) becomes publicly servable. Recommend inverting it:
    - Add the column as `NOT NULL DEFAULT 'private'`, so every existing row starts private.
    - Then flip to `public_site` only rows provably published:
      - `organization_brands.mark_asset_key` (and the wordmark, if Open Question 3 allows it)
      - each org's current `content_bundle_key` and the `imageKeys` values inside it
    - Orphans, replaced marks, superseded bundles and everything else stay private.
    - Net effect: nothing becomes more exposed than today, and the only newly dark rows are ones no public page references.

12. **The statement guard will break a naive backfill.** `blob_assets_giving_statement_guard` (0056 section 6e) raises on any `UPDATE` of a statement-referenced blob, on every connection. A migration that adds a nullable column and then runs `UPDATE ... SET audience = 'private'` would fail the moment a statement exists. Gap 11's shape avoids it: a constant `DEFAULT` on `ADD COLUMN` fires no trigger, and the `UPDATE`s only touch rows that no statement references. The audience-immutability trigger must be created after the backfill. This is a concrete Phase 2 and Phase 4 note.

13. **Re-keying shipped tables (fix forward).**
    - The existing composite FKs on `ticket_messages` (0019) and `giving_statements` (0056, NO ACTION) become `(id, organization_id, audience)` with a constant `'private'` column on the consumer.
    - `blob_assets` needs a matching `unique (id, organization_id, audience)`.
    - `blob_assets_org_hash_key` becomes `(organization_id, audience, content_hash)`.
    - `people.photo_key` is plain `text` with no FK at all today. Whether it gets the same treatment, with a uuid cast, is a Phase 2 call. It is not needed for the route.
    - Dropping and recreating the statement FK must keep the NO ACTION and undeletable-while-referenced semantics. Add a test.

14. **Deploy-window hazard.** The ordering "0072 before code" is mandated, but while old code is still serving, any `store()` insert will fail if the column is `NOT NULL` with no default. That affects site ingest, logo upload, ticket attachments and statement issuance. Tolerable options for Phase 3:
    - A short, flagged deploy window.
    - A transitional `DEFAULT 'private'` that is dropped in a follow-up migration. Old-code ingest during the window would produce private rows that the new route does not serve, so check ingest timing.
    Either way the final state is "no default". The `store()` signature is required with no default (DECISION-270).

15. **Every `store()` call site must pass `audience`.** Today's non-test callers:
    - `tickets/actions.ts:108` and `admin/tickets/upload-attachment-action.ts:52`: `private`
    - `lib/giving/statements.ts:641`: `private`
    - `admin/organizations/[id]/actions.ts:288` and `tenant-branding.ts:347` (the logo): `public_site`
    - `api/sites/ingest/route.ts:212` (images) and `:239` (the bundle JSON): `public_site`
    A type-level required argument catches omissions at compile time. Add one source-scan or unit test per caller that pins the audience it passes, since a wrong constant would compile.

16. **Dedup consequence.** After the audience-scoped key, a private upload byte-identical to a public image stores a second row rather than silently resolving to the public one (F298). Existing flows that relied on one row, such as re-uploading the same logo, are unaffected because they stay within `public_site`. `resolvePublic()` and `resolve()` both need an explicit audience contract so a `private` caller cannot accidentally read a `public_site` row it did not store, and the other way round. Phase 2 decides the signature.

**Gap 5, amended.** `hide_photo` (Open Question 2) still needs a ruling, and now it has a clear home. The roster functions and the roster-photo exception change together in 0072 or an adjacent migration, never one without the other. With the exception in the predicate, a ruling of "honor `hide_photo`" is a one-line addition in both places.

## Additions to the regression test list (failing first)

Everything in the earlier list stays. Additions:
- **DB-backed, audience.** A `ticket_messages`-referenced blob, a `giving_statements`-referenced PDF, a `people.photo_key`-referenced blob (not listed), and a `private`-audience image each return false from the public predicate or `resolvePublic()`. A `public_site` image, the mark, and a listed roster photo (via the exception) return true.
- **DB-backed, constraints.**
  - Updating `audience` is refused for any role, including the owner connection (the trigger).
  - A `private` consumer cannot reference a `public_site` row; the composite FK rejects it as a database property.
  - A private upload byte-identical to a `public_site` image yields two distinct rows.
  - A migration test on a seeded pre-0072 snapshot with a statement-referenced blob: it applies cleanly and statement bytes remain immutable.
- **Backfill assertions.** A ticket, statement or photo blob lands `private`. The current mark, bundle and bundle images land `public_site`. An orphan and a replaced mark land `private`.
- **e2e.** The earlier list stands (public images and mark return 200; statement, ticket, JSON and unlisted-photo keys return an identical 404, on the platform host and a custom host).

## Open questions, updated

1. **Cache lifetime for roster photos.** Unchanged, and my recommendation (short TTL for people) still applies. It is now a property of the exception branch, a natural place to hang the shorter header.
2. **`hide_photo`.** Unchanged. It now lives in the exception predicate and the two roster functions together.
3. **Wordmark.** Unchanged. If it is not allowed, do not flip it to `public_site` in the backfill, which keeps it private by default.
4. **Tier 1 or Tier 2** for bundle images (new, replaces the old Approach A/B question). My recommendation is Tier 1 now and Tier 2 as a tracked follow-up. The operator should confirm whether takedown of a mistakenly published image needs to ship in this release.
5. **Production counts before Phase 3** (new hard gate): blobs by consumer class, and any `people.photo_key` rows, so the backfill's expected row counts are written down and checked after the migration.

## Phase 2 notes for the architect

- 0072 has no default and a closed vocabulary (`public_site | private`). Careers may extend it later (an erasable class); keep it a CHECK that careers can widen without a rewrite.
- The audience immutability trigger, the unique-key change, the two FK re-keyings, and the guard interaction (Gap 12) are one migration, with ordering as above.
- The route's neutral 404, `no-store` on misses, uuid pre-validation, and the sniffing and `nosniff` hardening from my earlier Gaps 1, 2 and 4 are unchanged and independent of the audience work.
- `e2e/support/custom-hosts.ts` and `scripts/seed-dev.sql` store blobs directly and must set `audience = 'public_site'` on images and the bundle. That is a Rule 16 shared-file edit for the orchestrator at integration.

## Per-Phase Status row (revised)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (addendum folded in: treasury Phase 2 input via coordinator) | READY WITH NOTES | 2026-10-25 |

**Handoff:** architect, Phase 2. Open Questions 1–4 need the operator; production counts (Open Question 5) are a hard gate before Phase 3.

Files read for this addendum:
- `/Users/cshenso/git/presby-platform/presby-treasury/docs/work-log/2026-10-25-treasury.md`
- `/Users/cshenso/git/presby-platform/presby-assets/drizzle/0056_presby_giving_statements.sql`
- `/Users/cshenso/git/presby-platform/presby-assets/drizzle/0016_presby_brand_storage.sql`
- Every `store()` call site listed under Gap 15.

## Orchestrator: production counts (Open Question 5 hard gate), 2026-10-25, read-only

| Count | Production |
|---|---|
| blob_assets total / images / json / pdf | 107 / 82 / 25 / 0 |
| ticket_messages with attachment | 0 |
| giving_statements | 0 |
| people with photo_key | 0 |
| organization_brands marks / wordmarks | 1 / 0 |
| organization_sites with bundle / live | 1 / 1 |

No private-consumer row exists in production today: the backfill's private set is empty there, and the public set is the one mark, the one live bundle and its images (orphans and superseded bundles stay private under Gap 11). Open Question 4 proceeds on the analyst default: **Tier 1 in 0072; Tier 2 (takedown by reference) a tracked follow-up.**

## Orchestrator rulings on Phase 4 Batch 1 (2026-10-26)

- **Which privacy row hides a roster photo:** join `person_privacy` on `person_id` alone, as built. A photo hidden at any organization stays hidden on every organization's public roster. This is the operator's "hide_photo wins" ruling, and the person-photos pipeline (F333) designs against the same rule. The red test under the alternative stays.
- **`people.organization_id` does not exist (design defect):** registered as **F340**. Matching photos on the key alone and the index `people_photo_key_lower_idx on people (lower(photo_key))` are accepted.
- **Journal idx = 72** (idx equals the migration number) accepted; P3's `<next>` is corrected in the integration patch.
- **Directory toggles do not gate roster photos:** operator, 2026-10-26 — "nah. we can test that in the future." Edge Case 19 stays an accepted, deferred item; the TODO question line becomes a deferred line.
- **For Batch 2 (from the site-ingest pipeline, Phase 2 S1):** in `audience-callsites.test.ts`, treat every `getBlobStore().<method>(` call as requiring an audience literal, with a named exemption list (`resolvePublic`), so a later adapter method (the ingest pipeline's `findByContentHashes`, the photos pipeline's `resolveMany`) needs only a table edit, not a scan-logic change.
