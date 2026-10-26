# Person and household photos, Increment 1: staff-managed photos for adults — Work Log

> **Slug:** `2026-10-26-person-photos-inc1`
> **Parent:** `2026-10-26-person-photos` (Phase 1, the operator rulings and Phase 2 live there, verbatim)
> **Surface:** mixed — (org) Community person page (new `edit/photos` subroute), (org) directory, (public) staff and committee rosters on the site
> **Permission(s):** existing `people.manage` (tier 1). No new key.
> **Flag(s):** no platform flag. One per-org toggle, `org_portal.person_photos` (self-service, provisioned off).
> **Estimated complexity:** large
> **Pipeline mode:** Full
> **Numbers:** migration 0078 (0079 is the later retirement release); DECISION-285–289 (289 is this document's); F330–F332 (Phase 2) and F333–F337 (this document); dev port 3620.
> **Worktree:** `/Users/cshenso/git/presby-platform/presby-photos`, branch `pipeline/person-photos`, from `main` 21beebc (0.44.0)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | See parent (shared) | READY WITH NOTES | 2026-10-26 |
| 2 — Architectural review | architect | See parent (shared) | Approved with suggestions | 2026-10-26 |
| 3 — Technical design | tech-lead | Complete; designed against the F289 0072 **draft** (`presby-assets` worktree, unmerged); three Phase 2 rulings corrected (R3 invoker to definer, R2 Drizzle declaration, R5 dead join); F333–F337 raised; open rulings O1–O4 | Design complete | 2026-10-26 |
| 4 — Implementation | database-admin, then api-developer, then ux-developer | Batch 1 (database-admin) complete: 0078 hand-written, applied twice on `ep-sweet-scene` (idempotent), R12 recorded (no drift), re-diff vs merged 0072 clean; RLS 78 = 82 passes, RLS 72 = 24, D4 PASS, F331 rewrites green; F338 raised (standalone branch fails one dev-docs test until the integration patch is applied); F338 ruled by the orchestrator (the barrel line and the dev-docs entry are committed on the branch). Batch 2 (api-developer) complete: sharp 0.35.5 installed, image pipeline, store, reader, consequences, copy, four server actions, `resolveMany`, directory swap to `photoThumbKey`, catalog toggle, audit keys and the off-warning; 644 unit files / 9718 tests, 63 DB-backed files / 1351 tests, RLS 78 = 82 and RLS 72 = 24, `npm run check` 8/8, build and typecheck and lint clean. Batch 3 (ux-developer) complete: photos page, upload island with client downscale, designate and remove dialogs, edit-page link, three listing-dialog rewrites, UI copy, unit, e2e and hydration specs, browser walk at 360 and 1280 px; QA next | Batch 3 done | 2026-10-26 |
| 5 — Verification | qa | Run 1 FAIL (a)(b)(c); run 2 FAIL: (a)(b)(c) fixed, new (d) remove dialog "will leave the public website" for an unlisted person | FAIL (run 2) | 2026-10-26 |
| 3 — amendment (Phase 5 run 1 copy rulings) | tech-lead | Complete: rulings R-a (withheld-aware consequences; snapshot carries `minor`, `directoryWithheld`, `websiteWithheld`), R-b (new "Clear for website" control and dialog variant), R-c (count distinct photos); tests T1-T11 named; implementer full-stack-developer; no schema, route, flag or permission change. See the amendment at the end of this log | Design complete; back to Phase 4 | 2026-10-26 |
| 4 — Phase 5 run 1 fix (copy) | full-stack-developer | Complete: snapshot carries `minor`/`directoryWithheld`/`websiteWithheld`; every R-a/R-b/R-c string verbatim; "Clear for website" control and `clear` dialog variant; `countChosenPhotos` (distinct); T1-T11 failing-first; gates green; back to Phase 5 (scoped re-run) | Ready for QA | 2026-10-26 |
| 3 — ruling on fix-pass deviation | tech-lead | Complete: `websiteIsWithheld` helper (adds `directoryWithheld`) confirmed, no reachable-data change; under-18 checkbox accepted with a TODO candidate; no code change. See the last section of this log | Confirmed; back to Phase 5 (scoped re-run) | 2026-10-26 |
| 3 — amendment (Phase 5 run 2) | tech-lead | Complete: (d) ruled (`remove` for an unlisted person reuses `removeIsWebsiteWithheld`; `removeIsWebsite` hedged to "can no longer show it"); `websiteStops` kept; QA note 1 routed through the website-withheld answer; effect-verb sweep also changed `removeIsFallback`, `websiteNotListed` and one status line; tests T12-T19; implementer full-stack-developer; no schema, route, flag, permission or e2e change. See the last section of this log | Design complete; back to Phase 4 | 2026-10-26 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Staff who hold `people.manage` can attach up to ten photos to an adult's record in their own congregation, mark one as the **directory** photo and one as the **website** photo, and remove any of them. The photos belong to the membership (the congregation's relationship with the person), never to the global `people` row, so two congregations that share a person each keep their own set. The directory shows a small 160 px thumbnail of the directory photo; the public staff and committee lists show the website photo, or, when none is chosen, the directory photo **only if the person who chose it also attested it for the website** (Q6 default, adopted; the orchestrator is confirming with the operator). Everything is gated by one per-org toggle that also withholds photos from the public site when off. A photo is withheld on every surface, by SQL, when the person has hidden their photo, appears to be under 18, is a merged tombstone, or the toggle is off. Photos are stored `private` under F289's audience model and reach the open web only through F289's single asset door while a roster function lists them. `people.photo_key` is retired (held null by CHECK now, dropped in 0079 a release later). Increment 1 is the smallest slice that gets the first customer's headshots out of hand-written site files and into one managed place; the site works at cutover without it (Phase 1).

## Feasibility check (live tree, before naming the implementers)

Read against `main` 21beebc in this worktree, and against the F289 0072 draft (`/Users/cshenso/git/presby-platform/presby-assets/drizzle/0072_presby_blob_audience.sql`, 465 lines, **uncommitted in that worktree and still correctable in place**). No database was read; R12's catalog questions stay with database-admin.

**Passed, with the evidence:**

- **Function signatures.** No new function has parameter defaults. The two rewritten roster functions keep `(text, text default null, boolean default null)` and their `returns table` column lists (0072 lines 286-297 and 346-356); the door keeps `(uuid, uuid)` (0072 line 422).
- **What the retired column feeds (the `SECURITY DEFINER` body check).** `grep -rn "photo_key" drizzle/*.sql` across this tree, F289's, and every other pipeline's worktree finds stored function bodies that read `people.photo_key` in exactly three places: `presby_public_staff_roster` and `presby_public_committee_roster` (0042 lines 66-139, re-created in 0072 section 10) and `presby_public_site_asset` (0072 section 12). 0078 replaces all three, so after 0078 **no stored body references the column**, and 0079's `DROP COLUMN` cannot break a caller silently. 0072's pre-flip assertion (section 3) and `people_photo_key_lower_idx` (section 11) are a one-shot `do` block and an index; neither is a stored body. 0048 only does `alter function ... set search_path`. `treasury`, `careers`, `parish`, `ingest`, `2b`, `inc3` and `devportal` add no `photo_key` reader.
- **Application readers.** `src/lib/directory.ts:245,481,570` (select and map), `src/lib/sites.ts:1686,1794,1835,1880` (roster rows; these read the roster function's `photo_key` output, not the column, and keep working because 0078 keeps the output column and type), `src/lib/db/domain/people.ts:80-81` (Drizzle declaration), comments at `sites.ts:1645`, `initials.ts:4`, `blob-store.ts:14`, `assets.ts:24`. Nothing writes the column. `scripts/seed-dev.sql` and every `e2e/support/*` fixture contain no `photo_key`, so the new CHECK contradicts no shipped fixture.
- **New FKs, tenant column on both sides.** `person_photos (person_id, organization_id) -> memberships (person_id, organization_id)`: both sides carry the tenant id as the second column; target is `memberships_person_org_key` (`drizzle/0008:94`, declared `people.ts:283`). `person_photos (image_asset_key|thumb_asset_key, organization_id, asset_audience) -> blob_assets (id, organization_id, audience)`: target is F289's `blob_assets_id_org_audience_key` (0072 section 7, guarded add, name fixed for treasury's FK). `person_photo_designations (photo_id, organization_id, person_id) -> person_photos (id, organization_id, person_id)`: target is the new `person_photos_id_org_person_key`. Every FK is composite and every one leads or ends with the tenant column on both sides.
- **New CHECKs and triggers against fixtures.** `people_photo_key_retired` (`photo_key is null and photo_updated_at is null`): no fixture or seed sets either column. The two guard triggers fire only on the new tables.
- **`sharp`.** Already resolved at 0.35.5 in `package-lock.json:12549` (optional dependency of `next@16.4.2`) and present in the main checkout's `node_modules`. `npm install sharp@0.35.5` keeps one copy.

**Failed (design corrections to Phase 2, all in this document; none needs a loop-back):**

1. **R3 cannot be `SECURITY INVOKER` (F333).** `presby_app` reads `person_privacy` under RLS, which shows only the current organization's rows, but `person_privacy`'s primary key is `person_id` alone and 0072 deliberately joins it on `person_id` alone so a photo hidden at one organization stays hidden on every organization's public list (0072 section 10, and F289 Phase 4 note 2). An invoker function called from the photos page would therefore say "shown" for a person whose photo the public roster withholds. R3 as ruled would drift from the public site in exactly the way it exists to prevent. Fix: the core is `SECURITY DEFINER` with EXECUTE for the owner only, and the page calls a thin definer wrapper that derives the organization from `presby_current_org()`. Details under Data Model.
2. **R2's conditional about the Drizzle declaration resolves to "keep it" (F334).** `scripts/check-schema-parity.ts` compares column presence in both directions (header, lines 36-40). Removing `photoKey`/`photoUpdatedAt` from `people.ts` between 0078 and 0079 would report `extra_column` and fail CI's db job. The declaration stays, marked RETIRED, until 0079 removes the column and the declaration together. No TypeScript reads it (a source scan pins that).
3. **R5's "carry over 0072's bodies verbatim, including the `person_privacy` join" keeps a dead join.** R3 now owns `hide_photo`, so the roster functions' `left join person_privacy` would read nothing and would mislead the next reader into thinking privacy is applied there. 0078 drops that one join (and nothing else) from the two bodies; the D2 matrix proves `hide_photo` still wins.

**Dependency on an unmerged draft.** Every statement about the roster functions and the door is "0072's text as drafted". Phase 4 Batch 1 step 0 re-diffs 0078's function bodies against the merged 0072 before writing a line.

## Permissions & Flags

- **Permission:** `people.manage` (tier 1), checked inside the same transaction as the write, by `presby_has_permission(actor, org, 'people.manage')`. No new `FEATURES` key, no catalog or seed change, no role binding change. Whoever holds `people.manage` today can manage photos once the toggle is on. Listing on the website stays a separate gate under `staff.manage`, `officers.manage` and `groups.manage`; a photo reaches the open web only when both gates are satisfied, by possibly different people.
- **Per-org toggle:** `org_portal.person_photos` in `ORG_FEATURE_CATALOG`: `category: "people"`, `flag: null`, `provisionedOn: false`, `orgTypes: null`, `operatorEnabled: false`. Self-service: an `org_features.manage` holder turns it on at `/o/<slug>/admin/features`. `createOrganization()` writes no row; 0078 backfills none. A missing row is off.
- **Check order on every surface:** toggle, then permission, then the target (member of this org, adult, under the cap). The toggle is composed in SQL by `presby_person_photos_enabled(org)`, the one definition used by the roster path, the directory path and the photos page; a test pins its literals to the catalog entry and compares it with `orgFeatureEnabledInTx` over the axis x category x toggle matrix.
- **What off means (R8):** the photos page shows its own "not turned on" state; the edit-page link is hidden; actions answer `feature_off`; directory surfaces show initials; the roster functions return no photo and the door answers its neutral 404. Data is kept and turning it back on restores everything.
- **Platform flags the new and changed specs depend on:** none of the new feature. See the e2e section for the existing flags the specs set themselves. Nothing is added to `scripts/ci/e2e-baseline-flags.sql`.
- **Audit:** four new `AUDIT_ACTIONS` keys, written in-transaction by `store.ts` (below).

## API Contract

No route handler is added. The public path is F289's one door and the directory inlines thumbnails as `data:` URIs, so there is no new enumerable route (DECISION-040).

### Server actions — `src/app/(org)/o/[slug]/admin/community/[id]/edit/photos/actions.ts`

Same plumbing as `edit/guardians/actions.ts`: `auth()`, `resolveOrgContext()` re-run in every body, the actor's person and organization never taken from the client, the real checks in `src/lib/person-photos/store.ts`. The file contains no `db.*` call; `check:audit` therefore passes without checking anything, and DB tests stand in (D1).

```ts
addPersonPhotoAction(slug: string, personId: string, formData: FormData):
  Promise<ActionResult<{ photoId: string; usedForDirectory: boolean }>>   // field "photo": the file
designatePersonPhotoAction(slug: string, personId: string,
  input: { photoId: string; purpose: "directory" | "website"; attested: boolean }): Promise<ActionResult>
undesignatePersonPhotoAction(slug: string, personId: string, purpose: "directory" | "website"): Promise<ActionResult>
removePersonPhotoAction(slug: string, personId: string, photoId: string): Promise<ActionResult>
```

Each returns `{ ok: false, error }` with a fixed string from `copy.ts` (Copy C6), keyed by a `PhotoRefusal` kind. Success calls `revalidatePath` for the photos page, the edit page, and `/o/<slug>/directory`. `ids` are UUID-validated before any SQL (`parseBlobKey`-style regex, `UUID_RE` in `directory.ts` is the precedent). `purpose` is validated against the closed pair. `attested` must be a boolean `true` for `website`.

### Library — `src/lib/person-photos/` (modelled on `src/lib/contact-methods/`)

| File | Role |
|---|---|
| `limits.ts` | Pure constants shared with the client island: `PHOTO_CAP_PER_PERSON = 10`, `UPLOAD_MAX_BYTES = 1_000_000` (server refusal, under the framework's 1 MiB), `CLIENT_TARGET_BYTES = 900_000`, `CLIENT_MAX_EDGE = 1600`, `MASTER_MAX_EDGE = 1200`, `MASTER_MAX_BYTES = 400_000`, `THUMB_EDGE = 160`, `MAX_INPUT_PIXELS = 16_000_000`, `MAX_INPUT_EDGE = 6000`. |
| `image.ts` | `import "server-only"`. **The only file that imports `sharp`** (source-scan pinned). `processPhoto(bytes: Buffer): Promise<{ kind: "ok"; master: Buffer; thumb: Buffer; width: number; height: number } \| { kind: "refused"; reason: ImageRefusal }>`. Pure bytes in, bytes out, no database, no filename. |
| `store.ts` | `import "server-only"`. **The only writer** of both tables and the only `getBlobStore().store(` caller in the feature (both literal `audience: "private"`). Exports `addPhoto`, `removePhoto`, `designatePhoto`, `undesignatePhoto`. |
| `reader.ts` | `import "server-only"`. The admin photo set, the effective-state answers, the listing lookup and the toggle-off warning count. The only other importer of the two tables. |
| `consequences.ts` | Pure. Turns a snapshot of the person's state plus an intended action into the list of consequence sentences a dialog shows (R3's six consequences). Table-driven test. |
| `copy.ts` | Pure. Every user-facing string, so the copy-truthfulness check has one place to read, and an exhaustiveness test over `PhotoRefusal`. Importable by the client island. |
| `types.ts` | Pure. `Purpose`, `PhotoRefusal`, `Withheld`, `PhotoSetView`. |

```ts
interface PhotoCtx { organizationId: string; actorPersonId: string; actor: { userId: string; email: string | null } }

addPhoto(ctx, personId: string, file: Buffer):
  Promise<{ kind: "ok"; photoId: string; usedForDirectory: boolean } | { kind: "refused"; reason: PhotoRefusal }>
removePhoto(ctx, personId, photoId):      Promise<{ kind: "ok" } | { kind: "refused"; reason: PhotoRefusal }>
designatePhoto(ctx, personId, { photoId, purpose, attested }): same
undesignatePhoto(ctx, personId, purpose): same   // no active designation: ok, nothing written, no audit row

type PhotoRefusal = "feature_off" | "forbidden" | "not_found" | "minor" | "cap_reached" | "duplicate"
  | "unsupported_type" | "animated" | "too_many_pixels" | "too_large" | "unreadable" | "empty"
  | "already_removed" | "attestation_required" | "save_failed";
```

**`addPhoto` order (R7):**
1. `withOrgContext` short transaction: toggle, `people.manage`, the target is a membership of this org, not a minor (`presby_photo_subject_is_minor`), fewer than ten non-removed photos. Refuses here, before any decode, so an unauthorized caller cannot spend `sharp`'s CPU.
2. `processPhoto` (outside any transaction).
3. Two `getBlobStore().store({ organizationId, bytes, contentType, audience: "private" })` calls, each its own transaction (`store()` owns its transaction; DECISION-030).
4. Final `withOrgContext` transaction: `pg_advisory_xact_lock(hashtextextended('person_photos:'||org||':'||person, 0))`; repeat every check of step 1 (permission and toggle can change in seconds); insert the `person_photos` row; if the person has no active directory designation, insert one (never a website one); write the audit rows. Unique violation on the partial index maps to `duplicate`; any other error maps to `save_failed` and logs a fixed line with no content.
5. **Accepted residual:** if step 4 fails, step 3's two private blobs are left unreferenced and unservable, as on the logo path (R7).

**`designatePhoto`:** one transaction under the same advisory lock: toggle, permission, the photo belongs to `(photoId, org, personId)` and is not removed, adult re-check (a date of birth can change between add and designate), `attested === true` for `website`. Ends the active row for that purpose (`ended_at`, `ended_by`), then inserts the new one. Re-designating the same photo with a changed attestation takes the same path (end, insert).

**`removePhoto`:** one transaction under the lock: ends every active designation of the photo, then sets `removed_at`, `removed_by`. Double removal returns `already_removed`.

**Audit (R10).** New keys in `src/lib/audit.ts`, appended with the documentation block the file's convention requires: `PERSON_PHOTO_ADDED: "tenant.person_photo.added"`, `PERSON_PHOTO_REMOVED: "tenant.person_photo.removed"`, `PERSON_PHOTO_DESIGNATED: "tenant.person_photo.designated"`, `PERSON_PHOTO_UNDESIGNATED: "tenant.person_photo.undesignated"`. `resourceType: "person"`, `resourceId: personId`, written with `insertAuditRow(tx, …)` from `@/lib/audit-tx` in the mutation's transaction, so a failed audit insert undoes the change.

| Key | Metadata (ids, booleans and purposes only; never bytes, hash, filename, dimensions or a name) |
|---|---|
| `added` | `{ organizationId, personId, photoId, autoDirectory }` |
| `designated` | `{ organizationId, personId, photoId, purpose, attested, replacedPhotoId \| null, via: "designate" \| "add" }` |
| `undesignated` | `{ organizationId, personId, photoId, purpose, via: "undesignate" \| "remove" }` |
| `removed` | `{ organizationId, personId, photoId, endedPurposes: Purpose[] }` |

Add writes `added` and, when it auto-designates, a `designated` row with `via: "add"`. Remove writes one `undesignated` row per ended designation (`via: "remove"`) and then `removed`: the website designation is the sensitive disclosure act, and an investigator should not have to read `endedPurposes` to learn when one ended. (Additive to R10.)

### Blob adapter additions — `src/lib/storage/blob-store.ts` (F332; edited after F289 merges, so serialized behind it and behind the ingest pipeline's `findByContentHashes`)

```ts
resolveMany(input: { organizationId: string; keys: string[]; audience: BlobAudience }):
  Promise<Map<string, ResolvedBlob>>   // one transaction, one query: id = any($keys) and organization_id = $org and audience = $aud
```
Keys are validated with `parseBlobKey` (F289's `blob-key.ts`), de-duplicated, capped at 100 (more throws `BlobValidationError`), missing keys are simply absent from the map, a driver error propagates (the caller decides). `blob_assets` is still queried nowhere but this file.

### SQL surface added by 0078 (the contract the TypeScript relies on)

| Function | Kind | Executable by | Returns | Caller |
|---|---|---|---|---|
| `presby_person_photos_enabled(p_org uuid) boolean` | invoker, stable | `presby_app`, owner | the toggle composed as `orgFeatureEnabledInTx` composes it | R3 core, directory function, tests |
| `presby_photo_subject_is_minor(p_org uuid, p_person uuid) boolean` | invoker, stable | `presby_app`, owner | R4's predicate | R3 core, directory function, `store.ts` |
| `presby_person_public_photo(p_org uuid, p_person uuid)` | **definer**, stable | **owner only** | `(image_key uuid, source text, withheld text)`; zero rows when no eligible designation | the two roster functions, the status wrapper |
| `presby_person_public_photo_status(p_person uuid)` | definer, stable | `presby_app`, owner | same shape, organization from `presby_current_org()`; zero rows when no org context | `reader.ts` |
| `presby_person_directory_photo(p_org uuid, p_person uuid)` | invoker, stable | `presby_app`, owner | `(thumb_key uuid, image_key uuid, photo_id uuid, withheld text)`; zero rows when no active directory designation | `directory.ts`, `reader.ts` |

`withheld` is one of `toggle_off`, `minor`, `merged`, `hide_photo` (public) or `toggle_off`, `minor`, `hide_photo` (directory), in that priority. `source` is `website` or `directory_attested`.

## Data Model

One migration file, `drizzle/0078_presby_person_photos.sql`, applied with `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f …` (`-1` mandatory; the file has no transaction of its own). Idempotent: `create table if not exists`, `drop constraint if exists` then add, `create or replace`, drop-then-create for triggers and policies, revoke-then-grant. Hand-written, as every domain migration. Written against 0072's final text.

**0. Guard** (first statement): a `do` block that raises `0078 requires 0072` unless `blob_assets_id_org_audience_key` exists in `pg_constraint`.

**1. `person_photos`** — the set; rows are never updated except to remove.

```sql
create table if not exists person_photos (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  person_id        uuid not null,
  image_asset_key  uuid not null,                 -- the master: <= 1200 px, no forced crop, <= 400 KB
  thumb_asset_key  uuid not null,                 -- 160 x 160 WebP, top-biased crop
  asset_audience   text not null default 'private',
  width            integer not null,              -- of the master
  height           integer not null,
  created_at       timestamptz not null default now(),
  created_by       uuid not null references users (id),
  removed_at       timestamptz,
  removed_by       uuid references users (id),
  constraint person_photos_id_org_key        unique (id, organization_id),
  constraint person_photos_id_org_person_key unique (id, organization_id, person_id),
  constraint person_photos_audience_private  check (asset_audience = 'private'),
  constraint person_photos_distinct_assets   check (image_asset_key <> thumb_asset_key),
  constraint person_photos_dimensions        check (width between 1 and 2000 and height between 1 and 2000),
  constraint person_photos_removal_pair      check ((removed_at is null) = (removed_by is null)),
  constraint person_photos_person_fk foreign key (person_id, organization_id)
    references memberships (person_id, organization_id),
  constraint person_photos_image_fk foreign key (image_asset_key, organization_id, asset_audience)
    references blob_assets (id, organization_id, audience),
  constraint person_photos_thumb_fk foreign key (thumb_asset_key, organization_id, asset_audience)
    references blob_assets (id, organization_id, audience)
);
create unique index if not exists person_photos_active_image_idx on person_photos (organization_id, person_id, image_asset_key) where removed_at is null;
create index if not exists person_photos_image_key_idx on person_photos (organization_id, image_asset_key);   -- the door
create index if not exists person_photos_thumb_key_idx on person_photos (organization_id, thumb_asset_key);   -- the door
```
All three FKs are NO ACTION (a referenced blob stays undeletable on every connection, F44). A photo pointing at org B's blob, at a `public_site` blob, or at another person's membership is unrepresentable.

**2. `person_photo_designations`** — end-dated history, not a pointer.

```sql
create table if not exists person_photo_designations (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  person_id          uuid not null,
  photo_id           uuid not null,
  purpose            text not null,
  public_attested_at timestamptz,
  public_attested_by uuid references users (id),
  designated_at      timestamptz not null default now(),
  designated_by      uuid not null references users (id),
  ended_at           timestamptz,
  ended_by           uuid references users (id),
  constraint person_photo_designations_id_org_key unique (id, organization_id),
  constraint person_photo_designations_purpose    check (purpose in ('directory','website')),
  constraint person_photo_designations_attest_pair check ((public_attested_at is null) = (public_attested_by is null)),
  constraint person_photo_designations_website_attested check (purpose <> 'website' or public_attested_at is not null),
  constraint person_photo_designations_end_pair   check ((ended_at is null) = (ended_by is null)),
  constraint person_photo_designations_photo_fk foreign key (photo_id, organization_id, person_id)
    references person_photos (id, organization_id, person_id)
);
create unique index if not exists person_photo_designations_active_idx on person_photo_designations (organization_id, person_id, purpose) where ended_at is null;
create index if not exists person_photo_designations_photo_idx on person_photo_designations (organization_id, photo_id);
```
The partial unique index is the operator's "at most one active designation per purpose per person per congregation", enforced by the database. The directory SQL therefore cannot fan out rows.

**3. RLS, grants, triggers.** Both tables `enable` and `force row level security`; policy `tenant_isolation using (organization_id = presby_current_org()) with check (same)` (the 0049 form). `revoke all … from presby_app, presby_platform`; `grant select, insert to presby_app`; `grant update (removed_at, removed_by)` on `person_photos` and `grant update (ended_at, ended_by)` on the designations to `presby_app`; **no DELETE grant and `presby_platform` gets nothing**. Two `BEFORE INSERT OR UPDATE` guard functions (plain plpgsql, `set search_path = public, pg_temp`, `revoke all … from public, presby_app, presby_platform`, owner test copied from 0064's `presby_contact_methods_guard_write`):
- `person_photos`: on UPDATE, every column except `removed_at`/`removed_by` is immutable and those two may only go from null to a value, together; on INSERT by a non-owner, `removed_*` must be null and `created_at := clock_timestamp()`.
- `person_photo_designations`: on UPDATE, only `ended_at`/`ended_by` null to value; on INSERT by a non-owner, `ended_*` null and `designated_at := clock_timestamp()`; on INSERT by anyone, the referenced photo must exist in the same org and be unremoved (closes the remove-versus-designate race at the database).
The triggers bind the owner connection too (F44). **No DELETE guard trigger**, a deliberate residual copied from 0049 and 0064: it would also block the owner-path fixture teardown, and `presby_app` has no DELETE grant at all.

**4. Retire `people.photo_key`.** `alter table people add constraint people_photo_key_retired check (photo_key is null and photo_updated_at is null) not valid;` then `validate constraint` in the same file (0067's pattern). "Written by no one" now holds on every connection. 0079 drops both columns and `people_photo_key_lower_idx`.

**5. The five functions** (table above). Bodies, exactly:

```sql
create or replace function presby_person_photos_enabled(p_org uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce((select t.enabled from organization_feature_toggles t
                    where t.organization_id = p_org and t.feature_key = 'org_portal.person_photos'), false)
     and (not coalesce((select f.enabled from feature_flags f where f.key = 'org_portal.feature_categories'), false)
          or coalesce((select c.enabled from organization_feature_categories c
                        where c.organization_id = p_org and c.category = 'people'), true));
$$;   -- literals pinned to the catalog entry by person-photos-toggle.test.ts; orgTypes is null, so no allow-list

create or replace function presby_photo_subject_is_minor(p_org uuid, p_person uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce((select (not pe.birth_year_only and pe.date_of_birth is not null
                           and pe.date_of_birth > current_date - interval '18 years')
                        or (pe.birth_year_only and pe.date_of_birth is not null
                           and extract(year from pe.date_of_birth) > extract(year from current_date) - 19)
                     from people pe where pe.id = p_person), false)
      or coalesce((select m.household_role = 'child' from memberships m
                    where m.person_id = p_person and m.organization_id = p_org), false);
$$;   -- DOB arithmetic is children.ts:282's; null DOB with no child marker is an adult (operator ruling Q4)

create or replace function presby_person_public_photo(p_org uuid, p_person uuid)
returns table (image_key uuid, source text, withheld text)
language sql stable security definer set search_path = public, pg_temp as $$
  with c as (
    select ph.image_asset_key as image_key,
           case d.purpose when 'website' then 'website' else 'directory_attested' end as source
      from person_photo_designations d
      join person_photos ph on ph.id = d.photo_id and ph.organization_id = d.organization_id and ph.person_id = d.person_id
     where d.organization_id = p_org and d.person_id = p_person
       and d.ended_at is null and ph.removed_at is null
       and (d.purpose = 'website' or d.public_attested_at is not null)
     order by (d.purpose = 'website') desc
     limit 1)
  select case when w.withheld is null then c.image_key end, c.source, w.withheld
    from c
    left join lateral (select case
        when not presby_person_photos_enabled(p_org)             then 'toggle_off'
        when presby_photo_subject_is_minor(p_org, p_person)       then 'minor'
        when exists (select 1 from people pe where pe.id = p_person and pe.merged_into_id is not null) then 'merged'
        when exists (select 1 from person_privacy pp where pp.person_id = p_person and pp.hide_photo)    then 'hide_photo'
      end as withheld) w on true;
$$;   -- hide_photo joined on person_id ALONE, as 0072 does: the stricter, cross-org rule

create or replace function presby_person_public_photo_status(p_person uuid)
returns table (image_key uuid, source text, withheld text)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.image_key, r.source, r.withheld
    from presby_person_public_photo(presby_current_org(), p_person) r
   where presby_current_org() is not null;
$$;
-- presby_person_directory_photo: same shape as the core but invoker, purpose = 'directory', no attestation
-- filter, hide_photo scoped to (person_id AND organization_id) exactly as directory.ts scopes it, no 'merged'
-- reason (the directory's eligibility already excludes tombstones), and it returns the THUMBNAIL key.
```
`revoke all on function … from public, presby_app, presby_platform;` for all five, then `grant execute … to presby_app` for the four that presby_app calls (not `presby_person_public_photo`). The owner calls the invoker helpers from inside the definer, with RLS bypassed as the existing roster functions already assume (R12 confirms).

**6. Roster functions and the door.** `create or replace` all three from **0072's final text**, changing only:
- both roster functions: `photo_key` stays `text`; the column becomes `ph.image_key::text` through `left join lateral presby_person_public_photo(o.id, p.id) ph on true` in every branch; the `left join person_privacy pp` is removed (correction 3); `set search_path = public, pg_temp`, `revoke … from public`, `grant execute … to presby_app` restated (`create or replace` resets `proconfig`); comments rewritten.
- the door: `is_photo` becomes `exists (select 1 from person_photos ph where ph.organization_id = p_org and p_key in (ph.image_asset_key, ph.thumb_asset_key))` (removed photos included, so a removed photo never falls into the `site` branch); the roster branch is unchanged, so a thumbnail key (never returned by a roster function) always gets the neutral 404; the `people.photo_key` branch is deleted.

**7. Comments** on both tables, the `asset_audience` columns, the five functions, and `people.photo_key` (`RETIRED: held null by people_photo_key_retired; dropped in 0079`).

**Drizzle declarations:** `src/lib/db/domain/person-photos.ts` (new, one file per module): `personPhotos`, `personPhotoDesignations` with `foreignKey({ name: … })` for the five composite FKs and `check()` for the CHECKs it can express (the triggers, partial uniques and RLS stay SQL-only, as elsewhere). The `index.ts` export is a Rule 16 integration edit (patch P1). `people.ts` keeps `photoKey`/`photoUpdatedAt` with a `RETIRED` comment (F334).

**Storage budget (DECISION-030 watch).** Per photo: master 150-400 KB, thumbnail about 8 KB, so at most about 4 MB per person at the cap of ten. The first customer's harvest is about 18 people, one to three photos each: roughly 5-15 MB. **Revisit DECISION-030** (move bytes out of Postgres) when person-photo bytes exceed 100 MB platform-wide or 10% of database size, whichever comes first; `select sum(b.byte_size) from blob_assets b join person_photos p on b.id in (p.image_asset_key, p.thumb_asset_key)` goes into the retrospective. The production database size was not read (no database connections in this phase), so the 100 MB / 10% figures are design-time judgement, **unverified**.

## Component / Page Plan

**Pages (create)** — `src/app/(org)/o/[slug]/admin/community/[id]/edit/photos/`
- `page.tsx` — server component, a subroute like `edit/guardians`: `cachedAuth` → `resolveOrgContext` → `assertOrgAccess` → toggle (off: `PhotosOff`) → `readPhotoSet` (permission is checked inside it; forbidden: `MembersForbidden heading="Photos"`; not found: `notFound()`; error: `MembersLoadError heading="Photos"`). Reads `searchParams.view` (a photo id) to render one master as a "view larger" panel. **No `loading.tsx`** (the page calls `notFound()`; CLAUDE.md → the `(org)` contract).
- `actions.ts` — the four actions above.
- `photo-states.tsx` — `PhotosOff`.
- `where-photos-show.tsx` — server component: the two "where it shows" lines and the listing line from `PhotoSetView`.
- `photo-grid.tsx` — server component: tiles (thumbnail inlined, chips, "View larger" link) with the client controls below per tile.
- `upload-island.tsx` — `'use client'`, wrapped in `<HydrationGate>` whether or not it uses `useForm` (an upload posted before hydration would skip the downscale). A file input with `accept="image/jpeg,image/png,image/webp,image/heic,image/heif"` and **no `capture` attribute** (so a phone offers both camera and library). States: idle, preparing, uploading, error. Wraps the action call in try/catch and maps any rejection, including the framework's 413, to fixed copy.
- `downscale.ts` — client helper, feature-specific so it lives here (Component Rule 3). `createImageBitmap(file, { resizeWidth: 1600, resizeQuality: "medium" })` first, so a 48 MP camera original is never decoded at full size (iOS Safari canvas-area limit), then draws to a canvas with long edge at most 1600 on a white background (flattens transparency), `toBlob("image/jpeg", q)` stepping `q` from 0.9 down to 0.5, then the long edge to 1200, until at most 900 KB. Returns a `Blob` with a fixed name `photo.jpg` (the original filename never leaves the browser). **No `URL.createObjectURL` and no `blob:` image**: `next.config.ts`'s CSP is `img-src 'self' data:` (F336); the island shows no local preview, only the server's result after refresh. If `createImageBitmap` rejects (a browser that cannot decode the file, for example HEIC off Apple platforms), show the "convert to JPEG" message.
- `designate-dialog.tsx` — `'use client'`, `Dialog`. Two variants (directory, website) sharing one component. Native `<input type="checkbox" className="size-4 rounded border-input">` for the attestation, the existing `branding-form.tsx:311` idiom. **No checkbox primitive is added.** The website variant disables its confirm button until the box is ticked; the directory variant's box starts unticked.
- `confirm-dialogs.tsx` — `'use client'`, `AlertDialog` for remove and un-designate (the `public-listing-toggle.tsx` idiom).

**Components (move and modify)**
- Move `src/app/(org)/o/[slug]/directory/person-avatar.tsx` and its test to `src/components/org-portal/` (it gains a third caller; used only in `(org)`). Replace `resolvePhotoSrc(org, key)` with `resolvePhotoSrcs(org, keys): Promise<(string | null)[]>`: one `resolveMany` call, aligned output, a read failure logs the fixed line `[person-photos] thumbnail read failed; showing initials` and returns all nulls (a photo outage must not take the directory down; the page's own query still fails loudly).
- `src/lib/directory.ts`: `DirectoryRow.photo_key` becomes `photo_thumb_key`; `queryDirectoryRows` selects `dph.thumb_key::text as photo_thumb_key` through `left join lateral presby_person_directory_photo(m.organization_id, m.person_id) dph on true` and drops its own `hide_photo` CASE (the function owns it, org-scoped as today). `DirectoryEntry.photoKey` is renamed `photoThumbKey` so nobody mistakes a thumbnail key for a master. The count and find-person queries do not join it.

**Files to modify** (each with its reason)
- `src/lib/org-features.ts` — the catalog entry (Copy C1).
- `src/lib/org-feature-warnings.ts` — a registry entry for the new key (Copy C1b); it calls `countPhotoDesignations` from `reader.ts` so the warning module never imports the tables.
- `src/lib/audit.ts` — four keys and the documentation block.
- `src/lib/db/domain/people.ts` — the RETIRED comment (F334).
- `src/app/(org)/o/[slug]/admin/community/[id]/edit/page.tsx` — the "Photos" link, rendered when the toggle is on (the page is already `people.manage`-gated by `getPersonForEdit`), as an independent awaited call like the guardians link.
- `directory-grid.tsx`, `person-card.tsx`, `[personId]/page.tsx`, `households/[householdId]/page.tsx`, `src/components/org-portal/deacon-card.tsx` — import path, `resolvePhotoSrcs`, rename.
- `admin/staff/public-listing-toggle.tsx:124`, `admin/officers/public-listing-toggle.tsx:113`, `admin/groups/public-listing-toggle.tsx:137` and their tests — Copy C8.
- Comments that become false: `sites.ts:1645`, `initials.ts:4`, `blob-store.ts:14` (F289 rewrites it first), `assets.ts:24` (same), `directory.ts:22,112`, `person-avatar.tsx` header (Copy C10).
- `src/lib/storage/audience-callsites.test.ts` (F289's) — the table rows below.
- `package.json` / `package-lock.json` — `sharp@0.35.5` into `dependencies`.
- `docs/deployment.md` — "Pre-deploy runbook: 0078" (below). `CLAUDE.md` Project Layout, `docs/product/functionality-map.md` and the TODO lines are Rule 16/14 integration edits.

**Table rows for F289's `audience-callsites` test:** `src/lib/person-photos/store.ts: ["store:private", "store:private"]`; `src/lib/person-photos/reader.ts: ["resolveMany:private"]`; `src/components/org-portal/person-avatar.tsx: ["resolveMany:private"]`; the old `directory/person-avatar.tsx: resolve:private` row is removed with the file; `resolveMany` is added to the scanner's method list.

## Implementation Order

**Step 0 — orchestrator, before Phase 4.** F289 merges to `main`; 0072 is on this pipeline's Neon branch; `main` is merged into `pipeline/person-photos`; the dev port is 3620 (never 3000) and every Playwright/`next dev` run sets `E2E_BASE_URL`.

**Batch 1 — database-admin (the migration is the highest-consequence artifact; red before any application code depends on it).**
- 0. Run R12's six queries on the Neon branch and record them: `memberships_person_org_key` is a unique constraint; `blob_assets_id_org_audience_key` exists; `presby_app` holds no UPDATE/DELETE on `people` beyond 0009; the two roster functions' `proconfig` and ACL match 0072; the owner reads FORCE-RLS tables inside definers; 0 rows have `photo_key`. Re-diff the three function bodies against the merged 0072.
- 1. `src/lib/db/domain/person-photos.ts` and its schema test (failing first), the `people.ts` comment.
- 2. `drizzle/0078_presby_person_photos.sql`; `scripts/person-photos/test-rls-78.sql`; `scripts/person-photos/test-0078-migration.sh` (D4).
- 3. The F331 rewrites (every F289 test that writes `people.photo_key`; found by `grep -rn "photo_key" src scripts e2e` on the merged tree; known: `public-roster-photo.db.test.ts:63,187-196`, F289's D1 `public-asset.db.test.ts`, D4 `route.db.test.ts`, `scripts/assets/test-rls-72.sql` photo seeding; `test-rls-72.sql` 72a stays until 0079) to seed `person_photos` plus designations. Their assertions must keep passing.
- 4. Stage the Rule 16 patches P1-P3 under `scripts/person-photos/integration/` and apply them to the working tree for local and QA runs without committing the shared files (F289's pattern).
- Gate: RLS script clean as `presby_app`; D4 clean; `npm run db:migrate` equivalent on an empty scratch database is clean; `npm run check`.

**Batch 2 — api-developer (server side, plus the directory wiring so the tree is functional).**
- `deployment-engineer` first confirms `npm install sharp@0.35.5` leaves one copy in the lockfile and that `next build` traces the linux binaries.
- `limits.ts`, `types.ts`, `image.ts` and U1 first (red), then `store.ts`, `reader.ts`, `consequences.ts`, the audit keys, the catalog entry and warning, `resolveMany`, the `directory.ts` change and rename, the `person-avatar` move and `resolvePhotoSrcs`, `actions.ts`, and U2-U8, U11-U13, D1-D3.
- The user-facing strings belonging to refusals live in `copy.ts` (Copy C6); UI strings are added in Batch 3.
- Gate: unit and DB suites green; typecheck; `npm run check`; D1 proves every audit row.

**Batch 3 — ux-developer (admin UI, copy, e2e).**
- The photos page and its components, the edit-page link, the three listing dialogs, `copy.ts` UI sections, component tests, `e2e/support/person-photos-fixture.ts` (a new file; no existing `e2e/support/*` file is edited), `e2e/person-photos.spec.ts`, `e2e/hydration/person-photos-upload.spec.ts`.
- Verification on port 3620 at 360 px; the real-device checks (iPhone, 48 MP HEIC from the camera and a 12 MP JPEG from the library) are a manual Phase 5 item and are **unverified in CI**.
- Gate: component and e2e suites green; no native dialogs; `npm run check` (including `check:hydration-gate`).

**Batch 4 — release housekeeping (tech-lead and orchestrator).** Release notes through `/release-notes`, the functionality-map line, the TODO lines, the runbook, and the DECISION-285..289 entries.

Dependencies between batches are strict: Batch 2 starts from a green Batch 1 tree against a migrated Neon branch (Batch 1 leaves the tree compiling, because the new Drizzle tables have defaults and nothing references them yet).

## Rule 16 integration patches

Staged by the implementers as patches under `scripts/person-photos/integration/` (so a parallel branch never edits a shared file mid-pipeline); the orchestrator applies them at integration, serialized behind `/merge-pr`, then re-runs `scripts/test-rls.sql` against the merged `development` branch.

- **P1 `src/lib/db/domain/index.ts`:** `export * from "./person-photos";`
- **P2 `drizzle/meta/_journal.json`:** an entry `{ "idx": 78, "version": "7", "when": <greater than the last entry>, "tag": "0078_presby_person_photos", "breakpoints": true }`. The journal rule is that `idx` equals the migration number. The 0079 entry is added with the retirement release.
- **P3 `scripts/test-rls.sql`:** after the last appended section, `\ir person-photos/test-rls-78.sql` with the standard banner. `scripts/seed-dev.sql`: **no change** (no fixture seeds a photo; the toggle row is created by tests).
- **P4 `docs/TODO.md`** (Rule 10), newest first:
  - `- [ ] **F330 (pre-existing) — Server Actions accept 1 MB; nothing configures a higher limit.** The logo forms say "up to 2 MB" (\`tenant-branding.ts:97\`, \`(admin)/admin/organizations/[id]/actions.ts:89\`) and the ticket forms "up to 10MB" (\`file-ticket-form.tsx:29,253\` and both reply forms, also above Vercel's 4.5 MB). Files between 1 MB and the stated cap probably fail with the framework's 413 instead of the friendly copy. Confirmed from \`next@16.4.2 action-handler.js:513\`; not reproduced at runtime. Own bug-fix pipeline. — person-photos Phase 2`
  - `- [ ] **0079 — drop \`people.photo_key\`, \`people.photo_updated_at\` and \`people_photo_key_lower_idx\`** in the release after person-photos Increment 1 is live in production (never the same release: old code selects the columns by name). Update \`scripts/assets/test-rls-72.sql\` 72a, remove the Drizzle declaration (F334), and note in the file header that 0072 must not be re-run after it. Needs 0072 applied first. — person-photos-inc1, R2`
  - Close F289's follow-up "\`people.photo_key\` → \`uuid\` + composite FK …": **superseded** by the retirement (DECISION-285); mark done with "not built: replaced by org-scoped \`person_photos\`".
  - Rewrite the \`docs/TODO.md:497\` line ("Photo-specific wiring for \`people.photo_key\` is still open") as done by this increment, and the \`:386\` line's "photo/headshot management" clause as done for upload and display (vCard and export remain open).
  - `- [ ] **DECISION-030 revisit watch — person-photo bytes in Postgres.** Revisit when person-photo bytes exceed 100 MB platform-wide or 10% of database size; add the \`sum(byte_size)\` query to each retrospective. — person-photos-inc1`
  - `- [ ] **Person photos Increment 2 (bulk harvest) and Increment 3 (minors with consent, \`household_photos\`); member self-service profile and privacy page (first \`hide_photo\` writer).** — person-photos parent`
  - `- [ ] **Operator (Q5): move the leadership and committee pages of the first customer's site onto the live rosters (G12)** — decide whether losing the email and phone lines is acceptable, turn on the org's staff and committee directory flags, check real portraits at 360 px. — person-photos parent`
- **P5 `docs/decisions.md`:** DECISION-285 to 288 (final text from Phase 2, amended below) and DECISION-289 (below), newest first.
- **P6 `CLAUDE.md` Project Layout:** `src/lib/person-photos/ — org-scoped person photos (DECISION-285..289): image.ts the only sharp importer; store.ts the only writer of person_photos/person_photo_designations`.
- **P7 `docs/product/functionality-map.md`** (Rule 14): the Directory area and the public-sites line at `:21` and `:103` both say photo upload is unwired; both change at ship.
- **Observed, not ours to fix:** `docs/architecture.md:23` says "a member can hide their own phone number, address, or photo from other members"; no self-service writer for any `hide_*` exists yet (Phase 1 G14). A one-line docs correction for the orchestrator or the next documentation review.

## Deploy order (the runbook Batch 4 writes into `docs/deployment.md`)

1. **0072 and its code ship first**, in one release, per F289's own runbook. This pipeline cannot be applied anywhere before that.
2. **Apply 0078** to production (owner, direct endpoint, `psql -1`) **before** promoting the Increment 1 code. Old code against the new schema is harmless: it never writes a photo, the directory still selects `people.photo_key` (which exists and is null), the roster functions return no photo, the door's `person_photos` exclusion matches nothing, and the toggle is off everywhere.
3. **Promote the Increment 1 code.** The toggle is off for every congregation. An operator then turns `org_portal.person_photos` on for the pilot congregation (self-service: its `org_features.manage` holder, or the operator acting as one), at which point the harvest begins.
4. **0079 is a later release**, after the Increment 1 code has been live: dropping the column during the deploy window would break old code's directory query.
5. **Never re-apply 0072 after 0078.** 0072's `create or replace` of the roster functions and the door would silently put their `people.photo_key` bodies back (photos would vanish from the public site and fail closed). If 0072 must be re-run, re-run 0078 straight after (F335). The 0078 file header says so, and D4 proves the order.
6. Rollback: turn the toggle off (instant, every surface). A schema rollback is not offered: the tables are additive and nothing reads `photo_key`.

## Carry-forward

"Pinned by" names a test in the Test Plan. *deferred* names who accepted it.

| Phase 1 gap / Phase 2 ruling | Addressed here, or *deferred* |
|---|---|
| **G1** photo column global, blob per-org | Data Model: org-scoped tables keyed to the membership; `people.photo_key` retired. Pinned by R78b/R78c, D1 (cross-org). |
| **G2** coupling to F289 (private, FK pin, door, roster restate, call-site table) | Data Model sections 1, 6; API (`store.ts` literals); callsite rows; F331 rewrites. Pinned by R78c/R78e, U6, D5. |
| **G3** two designations, no fallback | **Superseded by the operator's Q1 ruling** (fallback adopted) and Phase 2 R3's attestation guard; one active per purpose by partial unique; website never defaulted. Pinned by R78c, D2 matrix. |
| **G4** consent matrix | Data Model (R3 core) and Copy C2. `hide_photo` shown to the manager with a note; `directory_hidden` unaffected; merged withheld. Pinned by D2, D3, U11. Attestation checkbox audited. |
| **G5** minors | Refused at add and at designate, withheld at read (R4), null DOB adult (accepted residual, Q4). Pinned by D1, D2 (vs `children.ts` DOB cases), D3. |
| **G6** who may upload of whom | Staff only; the authorization is the permission on the person inside the acting org, never a client id. Pinned by U8, D1. |
| **G7** image pipeline, limits, derivatives | `image.ts`, `limits.ts`, `downscale.ts`; thumbnails inline; framing kept. Pinned by U1, U9, E1. |
| **G8** storage growth, no erase path | Cap of ten, byte ceilings, Storage budget, accepted residual named in Copy C5 and the runbook; DECISION-030 watch TODO. Pinned by D1 (cap), U4 (copy states the residual). |
| **G9** removal stops serving; stale caches | Server-side immediate via the double filter; content-addressed keys are the cache key; data URIs have no cache; honest dialog copy. Pinned by D1, D2, E2. |
| **G10** merged, ended, deceased | `merged` withheld in the core; ended membership: directory excludes (existing), public by roster rules; photos kept. Pinned by D2. |
| **G11** household photos | *Deferred* to Increment 3 (`household_photos`); architect confirmed the slice in Phase 2; **operator confirmation of the out-of-scope list is open ruling O1**. |
| **G12** public-site integration | *Deferred* to ship time and the operator (Q5, open O2). Batch 4 puts it in the TODO lines. |
| **G13** the harvest | Manual per person, photos side by side with designation chips. Bulk is Increment 2. Pinned by E1. |
| **G14** self-service blocked | *Deferred* to its own pipeline (analyst Phase 1; architect Phase 2). |
| **G15** sequencing | *Deferred* to the operator (open O2). |
| **G16** stale copy | Copy C8 (the three listing dialogs) and the grep result in Copy C10: no directory or Community empty state mentions photos. Pinned by U4 and the three toggle tests. |
| **G17** alt text, 360 px, HydrationGate, no native dialogs | Component Plan; `check:hydration-gate`; 44 px targets. Pinned by U10, E1, E3. |
| Adversarial: redirect targets | None added; actions return results. Pinned by U8. |
| Adversarial: designate another person's, another org's or a removed photo; a website photo for a minor | Unrepresentable by FK and the designation insert guard; refused by `store.ts`. Pinned by R78c, D1. |
| Adversarial: enumeration | No new route; `data:` URIs; thumbnails never served by the door. Pinned by R78e (thumbnail key), U2 (no route file). |
| Adversarial: input boundaries | `image.ts` refusals. Pinned by U1. |
| Adversarial: self-targeting and the listing separation | Listing is read, never written, by this feature. Pinned by U2 (scan: no write to listing tables), D1. |
| Adversarial: cross-tenant | Pinned by R78b, D1. |
| Adversarial: dedup oracle | The only "already there" answer is within the same person (partial unique); copy says so. Pinned by D1. |
| Adversarial: 2FA mid-enrolment | Proxy redirects before any `(org)` route; no change. |
| Adversarial: failure microcopy | Copy C6; `save_failed`. Pinned by U8. |
| **R1** two tables | Data Model 1-3. Pinned by R78a-d. |
| **R2** retire `photo_key` | Data Model 4; Drizzle declaration kept until 0079 (**F334**, a Phase 3 correction); 0079 is its own later release (TODO P4). Pinned by R78d, U2 (no TS reads it). |
| **R3** one SQL definition of the public photo | Data Model 5, **corrected from invoker to definer core plus wrapper (F333)**. Six consequences: Copy C4/C5 and `consequences.ts`. Pinned by D2, U3. |
| **R4** minors, write and read | `presby_photo_subject_is_minor`; used by add, designate, the core and the directory function. Pinned by D1, D2, D3. |
| **R5** roster and door move in 0078 | Data Model 6 (dead join dropped, correction 3). Pinned by R78e, D2, D5. |
| **R6** `sharp` | Dependency step, `image.ts`. Pinned by U1, U2. |
| **R7** transport, authorize before decode | API (`addPhoto` order), `downscale.ts`. Pinned by U1, U9, U10, D1 (an unauthorized caller reaches no decode: `processPhoto` is not called), manual device check. |
| **R8** per-org toggle gates every surface | Permissions & Flags; `presby_person_photos_enabled`. Pinned by T1 (`person-photos-toggle.db.test.ts`), U7, D2. |
| **R9** directory reads, `resolveMany` | Component Plan; blob adapter. Pinned by U5, D3, E4 (payload measurement). |
| **R10** audit | API Contract table; plus `undesignated via remove` rows. Pinned by D1. |
| **R11** RLS script and test plan | Test Plan R78a-g plus the additions. |
| **R12** live catalog | Batch 1 step 0, recorded in Phase 4. |
| **F330** (pre-existing) | TODO line P4; out of scope. |
| **F331** | Batch 1 step 3, with the known list. |
| **F332** | `resolveMany`, U5. |
| **Q6** fallback consent | Adopted as the Phase 2 default: the fallback serves a directory photo only if its designation carries the attestation. The orchestrator is confirming with the operator; if it changes, only R3's `where` clause and the dialog copy change. |
| **Operator Q1-Q4** | Q1 fallback with attestation (above); Q2 per congregation; Q3 `people.manage`; Q4 adults only, null DOB allowed, audited attestation. Q5 is open (O2). |
| **DECISION-285-288** | Final text amended below. |
| F289's open question "listed photo fetchable while `sites.public_staff_directory` is off?" | Unchanged here. This feature adds the toggle gate only; the platform flags still do not gate the door. Left to F289's follow-up (operator). |
| **Phase 5 run 1 copy FAIL** (a), (b), (c) and the `directory_hidden` note | Addressed in "Phase 3 — amendment (Phase 5 run 1 copy rulings)" at the end of this log; the adapter double-submit race (Batch 2 deviation 7) is a TODO candidate recorded in that amendment's carry-forward. |

## Edge Cases & Risks

Each claim cites the test that pins it or says *unverified*.

| # | Case | Handling | Pinned by |
|---|---|---|---|
| 1 | **Re-applying 0072 after 0078** puts the old function bodies back (**F335**) | Header warning, runbook step 5; sequence test 0072, 0078, 0072, 0078 ends with 0078's bodies | D4 |
| 2 | **CSP `img-src` has no `blob:`** (**F336**): a client downscale through `URL.createObjectURL` + `<img>` would be refused wherever the CSP is enforced and report noise elsewhere | `downscale.ts` uses `createImageBitmap` only; no local preview | U9 (source scan: no `createObjectURL`, no `FileReader` data URL of the original) |
| 3 | **Fixture teardown order** (**F337**): `removeSiteOrg` deletes `blob_assets` last, but `person_photos` and designations reference them (NO ACTION) | The photo fixture deletes designations, photos, then their blobs, by id, before any shared teardown; confirmed by SELECT. The owner path keeps DELETE (no delete trigger) | E-fixture self-check in E1 `afterAll`; D1 `afterAll` |
| 4 | Two simultaneous adds of the same file | Advisory lock serializes; the second hits the partial unique and answers `duplicate` | D1 |
| 5 | Designate and remove racing | Lock; plus the designation insert guard refusing a removed photo | D1, R78c |
| 6 | Stale page: the photo was removed by someone else | `already_removed`, message, page refresh | U8, D1 |
| 7 | Toggle turned off mid-session | `feature_off` from every action | D1 |
| 8 | `people.manage` revoked between authorization and the final transaction | The final transaction repeats the check | D1 |
| 9 | A person becomes a minor after a photo was designated | Withheld by SQL at read, on the directory, the public roster and the door, with no one acting | D2, D3 |
| 10 | Null date of birth and no child marker is treated as an adult | Accepted residual (operator, Q4); the copy never claims "adults only" | U4 |
| 11 | Byte-identical photo for two people in one org shares blobs; one is listed | Removing one reference leaves the other; the shared key is served while either is listed (R5's stated residual: the bytes are the same image) | D1, D2 |
| 12 | `hide_photo` set at org A, person also at org B | Public: withheld everywhere (person-id join); directory: scoped to the viewing org, as today | D2, D3 |
| 13 | Merged tombstone | Withheld (`merged`) | D2 |
| 14 | Membership ended | Directory excludes (existing eligibility); public by the roster's open-term rules; photos kept | D2 |
| 15 | A thumbnail key requested at the door | Neutral 404, same as any miss | R78e |
| 16 | A photo stored `public_site` by a buggy writer | Unrepresentable: FK pins `private` and CHECK. The door's exclusion remains as defence in depth | R78c |
| 17 | `org` fixture deletion | `on delete cascade` from organizations removes both tables' rows before the NO ACTION FKs are checked at statement end | R78d |
| 18 | Audit insert fails | The mutation rolls back | D1 |
| 19 | Browser caches a removed website photo | Up to a day (`private, max-age=86400`); stated in the dialogs and the toggle description | U4; the cache header is F289's (its D4) |
| 20 | 25 thumbnails inline at 360 px | About 8 KB each, about 270 KB of base64; measured, with a budget of 500 KB of document for 25 cards. Over budget: stream through an authenticated route with a DECISION-040 neutral 404 (a new design) | E4 |
| 21 | Photos page weight: up to 10 thumbnails plus one master (about 530 KB base64) | Master only for the website card and `?view=` | E1 (measures document size) |
| 22 | Very long display name at 360 px | Wraps; no horizontal scroll | E1 (long-name fixture) |
| 23 | `current_date` in the minor test is the database's zone, not the org's | At most a one-day error on an 18th birthday, same as `children.ts` | D2 (the test pins the equality with `children.ts`) |
| 24 | HEIC or a 48 MP camera original on iOS Safari; a browser that cannot decode | `createImageBitmap` with `resizeWidth` bounds memory; fixed message otherwise | *Unverified in CI.* Manual Phase 5 device check |
| 25 | The framework's 413 shape on an oversized body | Any rejection maps to fixed copy | U10; real 413 *unverified* until the e2e posts an oversized body |
| 26 | `sharp` binary absent on Vercel | Same Next-managed optional dependency the framework uses for `/_next/image` | *Unverified until a preview deploy*; deployment-engineer gate |
| 27 | A very large photo set makes the unpaged `getDirectory()` slow (one function call per row) | One index probe per row when no designation exists (the function starts from the designation lookup); revisit if an unpaged call exceeds about 2,000 rows | D3 asserts the zero-photo path issues one statement; scale *unverified* |
| 28 | Photos link unreachable where `org_portal.members_create` is off (the edit page needs it); the photos URL itself works | Accepted: Community editing and photos are the same audience | U10 (link only when toggle on) |
| 29 | A people.manage holder spends `sharp` CPU repeatedly | Bounded by the 1 MB body, the 16 MP cap and the ten-photo cap; no per-actor rate limit | *Unverified*; accepted residual |
| 30 | The status wrapper returns a reason (for example "minor") to any connection holding the org context | Only `reader.ts` calls it, behind `people.manage`; a member cannot reach it from the application | R78g (ACL), U2 (scan: only `reader.ts` mentions it) |

## Test Plan (failing first)

Each item is written red before the code it covers. DB-backed suites are serial and `describe.skipIf(!hasDb)` per `docs/testing.md`.

**RLS script — `scripts/person-photos/test-rls-78.sql` (run as `presby_app`; every writing block ends in `rollback`)**
- **R78a catalog:** both tables enabled and forced RLS, grants exactly as specified, the partial uniques and CHECKs present and validated, triggers enabled, `search_path` pins on all functions, ACLs (`presby_person_public_photo` not executable by `presby_app`; the status wrapper is), `presby_platform` holds nothing.
- **R78b isolation:** org B sees zero org A rows; its insert with org A's id is refused by WITH CHECK.
- **R78c unrepresentable:** a designation on another person's photo (FK), a photo on org B's blob (FK), on a `public_site` blob (FK and CHECK), a second active designation for a purpose (unique), a website designation without attestation (CHECK), a designation of a removed photo (guard).
- **R78d soft delete:** DELETE refused for `presby_app`; UPDATE of an immutable column refused for `presby_app` (column grant) and the owner (trigger); un-removing and un-ending refused; writing `people.photo_key` refused on the owner connection (CHECK); deleting a fixture organization (the `deletable_until` window) removes both tables' rows and succeeds.
- **R78e matrix** through both roster functions and the door: served, a listed adult's website designation and a listed adult's attested directory designation with no website one; null/404, an unattested directory photo only, `hide_photo`, a minor by DOB, by birth year only and by `household_role = 'child'`, a merged person, a removed photo, an ended designation, the toggle off, an unlisted person, a thumbnail key, a foreign org's key; org A's designation never appears in org B's roster.
- **R78f** F289's FK catalog test passes unchanged with the two new FKs.
- **R78g** function privileges.

**Unit (no database)**
- **U1 `image.test.ts`:** a JPEG with GPS comes out with none and no ICC; an EXIF-rotated input is upright; a Display-P3 input comes out sRGB with no profile; a transparent PNG is flattened on white; the master's long edge is at most 1200, never enlarged, a 5:7 portrait keeps its framing; the master is at most 400 KB (quality stepping); the thumbnail is 160 x 160 WebP, top-biased; refused with their own kinds: animated WebP, a PNG pixel bomb (refused from metadata before decode), a polyglot, HEIC, SVG, a zero-byte file, a PDF, a format that disagrees with the sniff, over 16 MP, over 6000 px.
- **U2 `scan.test.ts`:** `sharp` is imported only by `image.ts`; the two tables are imported only by `store.ts`, `reader.ts`, `person-photos.ts` and the domain index; `getBlobStore().store(` appears only in `store.ts`, with the literal `"private"`; no TypeScript reads `people.photoKey` outside its declaration; no new route handler under the feature; no `getPlatformDb` in the feature; `presby_person_public_photo_status` is named only in `reader.ts`; the feature does not write `staff_positions`, `officer_terms` or `group_memberships`; `actions.ts` contains no `db.`.
- **U3 `consequences.test.ts`:** table-driven over R3's six consequences and the combinations (listed or not, website designation present or not, attested or not, replacing or first).
- **U4 `copy.test.ts`:** exhaustive map over `PhotoRefusal`; every string is non-empty, contains no emoji and no raw error text; the remove and website-removal strings carry the residual sentences; the toggle description carries "up to a day"; nothing says "adults only".
- **U5 `blob-store-many.test.ts` (mocks `@/lib/db`):** one statement, keys validated and de-duplicated, cap of 100, missing keys absent, driver error propagates.
- **U6 `audience-callsites.test.ts`:** the table rows above.
- **U7 `org-feature-catalog.test.ts` (edit):** the toggle-only list gains `org_portal.person_photos`; the entry is people category, provisioned off, self-service, unscoped.
- **U8 `actions.test.ts`:** unauthenticated, no org access, each refusal kind maps to its string, success revalidates, ids are validated, `attested` must be `true` for `website`, no redirect target anywhere.
- **U9 `downscale.test.ts`:** dimension math, quality stepping, the white flatten, the fixed output name, the HEIC/undecodable message, the source scan from edge case 2.
- **U10 component tests:** upload island (disabled until hydrated, progress states, any rejection maps to fixed copy, 44 px targets), designate dialog (website confirm disabled until ticked, directory box starts unticked), remove and un-designate dialogs (consequence lines), tile chips, page states (off, forbidden, error, empty, minor notice), the edit-page link only when the toggle is on.
- **U11 `reader-derive.test.ts`:** the page status lines from the snapshot, including the unattested remedy line.
- **U12 `org-feature-warnings` (edit):** no warning at zero designations, the count wording, the generic fallback.
- **U13 `person-photos-toggle.test.ts`:** reads the migration text and pins the key, the category literal `'people'`, the flag key and the absence of an allow-list to the catalog entry.

**Database-backed**
- **D1 `store.db.test.ts`:** each of the four mutations writes its audit row(s) with exactly the documented metadata keys and no others; a failing audit insert rolls the change back; add auto-designates the directory slot only when empty and never the website; the cap of ten; minor refused on add and on designate (including a DOB corrected between the two); permission, toggle and membership refusals leave no blob call (a spy on `processPhoto` proves an unauthorized caller reaches no decode); a cross-org person id is `not_found`; concurrency cases 4 and 5; removal ends designations and writes `undesignated via remove`; shared blobs survive one removal; teardown confirmed by SELECT.
- **D2 `public-photo.db.test.ts`:** the R3/R5 matrix again through `presby_person_public_photo_status`, and the **parity property**: for every person in the matrix the status wrapper's image key equals the roster function's `photo_key`, so the page and the public site cannot drift; the toggle SQL against `orgFeatureEnabledInTx` over the axis x category x toggle matrix; the minor predicate against `children.ts`'s roster on DOB cases.
- **D3 `directory.test.ts` (edit):** a directory designation returns its thumbnail key; a website-only photo shows none; `hide_photo` (org-scoped), minor, removed, ended and toggle-off each return null; the old vacuous "hide_photo nulls only the photo key" test now seeds a photo first.
- **D4 `scripts/person-photos/test-0078-migration.sh <scratch-url>`** (refuses a URL whose database name does not begin `scratch_`): apply migrations through 0072, then 0078 twice; the sequence 0072, 0078, 0072, 0078; the retirement CHECK refuses a non-null `photo_key`; roster functions keep `proconfig` and ACL.
- **D5** the F331 rewrites (listed under Batch 1).

**End-to-end** (own server on port 3620, `E2E_BASE_URL` set; each spec captures and restores what it sets through `e2e/support/flags.ts`)
- **E1 `e2e/person-photos.spec.ts`**, as a `people.manage` holder (the existing `e2e_community_clerk` at e2e-alpha) at 360 x 800: toggle on; upload a synthetic JPEG generated by the spec; it becomes the directory photo; designate it for the website with the attestation; the long-name fixture wraps; remove through the dialog; no horizontal scroll; every interactive target at least 44 px; no native dialog.
- **E2** as an anonymous visitor on a custom host (the existing `custom-hosts.ts` world) at 360 px: the roster photo loads at natural size greater than zero; after removal a fresh request is the neutral 404.
- **E3 `e2e/hydration/person-photos-upload.spec.ts`:** holding the JS chunks leaves the upload input disabled (both lanes).
- **E4** the member directory at 360 px: a photo's `img` loads; 25 inlined thumbnails keep the document within the 500 KB budget (measured and recorded; the revisit trigger is edge case 20).
- **Flags the new and changed specs depend on (all set and restored by the spec):** `org_portal.members_create` and its alpha toggle row (via `community-fixture`), `org_portal.directory` and `org_portal.directory_v2` (as `person-emails.spec.ts` does), `org_portal.feature_categories` (captured and set false as `public-calendar.spec.ts` does), `sites.public_render` and `sites.public_staff_directory` (E2), plus the per-org toggle `org_portal.person_photos`, which the fixture inserts and deletes. **No key is added to `scripts/ci/e2e-baseline-flags.sql`.**
- **Blast radius on existing specs.** Read against the live tree: no existing spec asserts a directory photo, an avatar image, a roster photo, or the three listing dialogs' text (`grep -rn "if one is on file\|visible to anyone\|Yes, list publicly\|Stop listing" e2e` finds nothing). The specs that render pages this change touches stay green because the new link and thumbnails appear only with the toggle on, and no fixture turns it on: `person-emails.spec.ts` and `hydration/person-emails-editor.spec.ts` (edit page), `portal-home-cards.spec.ts`, `community-redirect.spec.ts`, `portal-footer-sitemap.spec.ts`, `branded-signin.spec.ts` (directory routes), `public-sites.spec.ts` and the custom-domain specs (rosters return `photo_key` null as before). F289's own `e2e/custom-domains/assets.spec.ts` seeds no person photo (read from its work-log), so F331 does not touch it. The existing unit/DB tests this change alters: `org-feature-catalog.test.ts` (toggle-only list), `directory.test.ts:760,790,794` (`photoKey` rename and the vacuous hide test), the `DirectoryEntry` `photoKey` fixtures renamed to `photoThumbKey` (`directory-grid.test.tsx:125`, `members-list.test.tsx:20`, `person-card.test.tsx`, `directory/page.test.tsx`, `directory-list.test.tsx`, `[personId]/page.test.tsx`, `households/[householdId]/page.test.tsx`; the roster-side `photoKey` in `staff-directory`, `committee-directory` and `sites` tests is a different type and does not change), `person-avatar.test.tsx` (moves), the three listing-toggle test files, and F289's `public-roster-photo.db.test.ts`.

## Copy

Every user-facing string the feature adds or changes. Strings live in `src/lib/person-photos/copy.ts`; `{first}` is the person's preferred or first name, `{name}` the display name, `{org}` the organization name. **An implementer who needs a string that is not here stops for a ruling.**

### The four checks, one line per group

| Group | Residuals | Source of truth | Audience | Neighbours |
|---|---|---|---|---|
| **C1** toggle name, description, off-warning | Names the cached-copy residual ("up to a day") and denies none: it says "nothing is deleted", which is true (`blob_assets` has no delete path); it does not promise erasure | Off hides everything: R8, `presby_person_photos_enabled` inside the core and the directory function. "A day" is F289's `private, max-age=86400`. The count: `countPhotoDesignations` = active designations on non-removed photos, worded "chosen for", not "shown" | The `org_features.manage` holder on `/o/<slug>/admin/features`; no instruction beyond the switch they are already using | Other catalog descriptions only; nothing stale |
| **C2** photos page status lines | `hide_photo` has no member-facing writer today, so "has hidden their photo" describes a stored setting without claiming the person can change it; null date of birth is an adult (never claims all are) | Directory lines: `presby_person_directory_photo`. Website lines: `presby_person_public_photo_status` (the **same** function the public roster uses). Listing line: open `public_listed` rows in `staff_positions`, `officer_terms`, managed `group_memberships`, read by `reader.ts`; it does **not** read site status or the platform `sites.*` flags, so it says "listed", never "showing now" | A `people.manage` holder (the page gate). The unattested line names two remedies, both performed by that same holder in the designate dialog. The not-listed line says listing is "set separately … by whoever manages those", an instruction to nobody | Grep: only the three listing dialogs mention photos (C8) |
| **C3** upload island | "Stored without location information" is true of the stored result only (`image.ts` strips; U1 pins); it does not say the original file is unchanged | The refusal kinds from `PhotoRefusal`; the cap from `limits.ts`; "appears to be under 18" from `presby_photo_subject_is_minor` (which includes birth-year-only ambiguity, hence "appears") | `people.manage` holder | None |
| **C4** designate dialogs | The website dialog states that search engines and archives may keep copies and removal cannot recall them (the standing residual). The directory dialog's fallback sentence is conditional and never says the photo "will" appear unless the box is ticked and the person is listed | Attestation recorded as `public_attested_at/by`; the "listed" sentence from the listing read; "no website photo chosen" from the active website designation | `people.manage` holder, who performs both actions | The F289 listing dialogs (C8) are rewritten to agree |
| **C5** remove and un-designate dialogs | States that the file stays in storage and cannot be erased from here (G8), and that browsers can keep a copy up to a day | `consequences.ts` reads the live designation state; "stays in storage" is the absence of any `blob_assets` delete path | `people.manage` holder; no instruction | None |
| **C6** action errors and toasts | Generic; no claim about a person except "under 18" ("appears") | The refusal kind returned by `store.ts` | `people.manage` holder (or, for forbidden, anyone who posts) | Existing generic strings reused verbatim: "You must be signed in to do that.", "You don't have access to that organization.", "You don't have permission to do that here." |
| **C7** edit-page link | None | Rendered only with the toggle on, on a page already gated by `people.manage` | `people.manage` holder | Siblings: "Guardians", "Pastoral notes, demographics, …" |
| **C8** three listing dialogs (changed) | Keeps "including search engines and archival crawlers", the cached-copy residual; adds that a photo "may" be shown | R3: website photo, else an attested directory photo, unless hidden; "may" because the toggle, a minor or a merge also withhold it | The `staff.manage`, `officers.manage` or `groups.manage` holder who sees the toggle, who may **not** hold `people.manage`: the string gives **no instruction** for that reason | These three strings are the only photo copy in the live tree (grep below) |

### C1 — toggle and warning

- Name: `Photos of people`
- Description: `Lets your team add photos to people's records, choose the photo members see in the directory, and choose the photo shown on your public website for people listed there. Turning this off hides every photo, including on your public website. Nothing is deleted, and turning it back on restores them. Browsers that already saved a photo can keep showing it for up to a day.`
- Off-warning title: `Photos of people will be hidden`
- Off-warning body, `{n}` photos chosen: `{n} photo is currently chosen for the directory or the website.` / `{n} photos are currently chosen for the directory or the website.` followed by ` Turning this off hides {it|them} everywhere, including on your public website. Nothing is deleted, and turning it back on restores {it|them}. Browsers that already saved a photo can keep showing it for up to a day.` Zero designations: no warning.
- Warning fallback (count unreadable): title as above; body `Turning this off hides every photo of a person, including on your public website. Nothing is deleted. Browsers that already saved a photo can keep showing it for up to a day.`

### C2 — photos page

- Heading `Photos`; subheading `{name} · {org}`; link `Back to edit person` (reused from guardians).
- Off: `Photos of people aren't turned on for {org}. Someone who manages your organization's features can turn them on.`
- Forbidden and load error: the existing `MembersForbidden` and `MembersLoadError` with `heading="Photos"`.
- Section heading: `Where photos show`.
- Directory lines: shown `Directory: members see the photo marked "Directory" below.`; none `Directory: no photo chosen, so members see initials.`; hide `Directory: not shown, because {first} has hidden their photo.`; minor `Directory: not shown. {first} appears to be under 18, and photos of children aren't used yet.`
- Website lines: website `Website: the photo marked "Website" below.`; fallback `Website: the directory photo, because it was cleared for the website.`; none `Website: no photo chosen, so the website shows none.`; unattested `Website: none. The directory photo isn't cleared for the website. Choose a website photo, or clear the directory photo for the website.`; hide `Website: not shown, because {first} has hidden their photo.`; minor as above with "Website:"; merged `Website: not shown, because this record was merged into another.`
- Listing line, listed: `{first} is listed on your public website ({staff, officer or committee member}). Photos appear there only while the person is listed and the website is published.` Not listed: `{first} isn't listed on your public website, so no photo shows there. Listing is set separately, under Staff, Officers or Groups, by whoever manages those.`
- Counter: `{count} of 10 photos`. Empty: `No photos yet` / `Add the first photo below.`
- Under-18 notice (add disabled): `{first} appears to be under 18. Photos of children can't be added yet, and any existing photos are not shown.`
- Tile: alt `{name}, photo {n}`; chips `Directory`, `Website`, `Directory, cleared for website`; buttons `Use in directory`, `Stop using in directory`, `Use on website`, `Stop using on website`, `Remove`; link `View larger`; panel link `Back to all photos`.

### C3 — upload island

- Label `Add a photo`; button `Choose a photo`; helper `Pick a picture or take one with your camera. JPEG, PNG or WebP. It is resized here and stored without location information.`
- Progress `Getting the picture ready…`, `Uploading…`. Success toast `Photo added.` or `Photo added. It's now {first}'s directory photo.`

### C6 — refusals (one per `PhotoRefusal`)

`feature_off` `Photos of people aren't turned on for this organization.` · `forbidden` `You don't have permission to do that here.` · `not_found` `That person could not be found.` · `minor` `{first} appears to be under 18. Photos of children can't be added yet.` · `cap_reached` `{first} already has 10 photos. Remove one to add another.` · `duplicate` `That picture is already in {first}'s photos.` · `unsupported_type` `That file isn't a JPEG, PNG or WebP picture. If it's an iPhone photo, pick it from your photo library or convert it to JPEG first.` · `animated` `Animated pictures aren't supported. Choose a still picture.` · `too_many_pixels` `That picture is too large to process. Try a smaller one.` · `too_large` `That picture is too big to upload. Try a smaller one.` · `unreadable` `We couldn't read that picture. Try a different file.` · `empty` `That file is empty.` · `already_removed` `That photo was already removed.` · `attestation_required` `Tick the box to confirm you have their permission.` · `save_failed` `We couldn't save that photo. Nothing was changed. Try again.` Client-side rejection (413 or network): `That picture couldn't be uploaded. Check your connection, or try a smaller picture.` Reused: `You must be signed in to do that.`, `You don't have access to that organization.`

### C4 — designate dialogs

- Directory: title `Use this photo in the directory?`; body `Members who can see {name} in the directory will see this photo instead of their initials.`; checkbox `I have {first}'s permission to also use this photo on the public website if they are listed there and no website photo is chosen.` (unticked by default); confirm `Use in directory`; cancel `Cancel`. Consequence lines from `consequences.ts` (examples): ticked and listed with no website photo `Because {first} is listed on the public website and has no website photo, this photo will also appear there.`; replacing an attested directory photo with an unticked one while listed and no website photo `The website is using the current directory photo. After this it will show no photo for {first}.`; ticked but not listed or a website photo exists `This photo will be used on the website only if {first} is listed and has no website photo.`
- Website: title `Use this photo on the public website?`; body `Anyone on the internet can see a photo on the public website. Search engines and web archives may keep copies, and removing the photo later can't recall them.`; required checkbox `I have {first}'s permission to show this photo on the public website.`; confirm `Use on website` (disabled until ticked). Listing line: listed `{first} is listed, so this photo will appear on the website.`; not listed `{first} isn't listed on the public website yet, so this photo won't appear until they are.` Replacing: `This replaces the current website photo.`

### C5 — remove and un-designate

- Un-designate directory: title `Stop using this photo in the directory?`; body `{first}'s initials will show in the directory instead.` plus, when it is the attested fallback in use on the website, `The website is also using this photo, because it was cleared for the website. After this, the website will show no photo.`; confirm `Stop using`.
- Un-designate website: title `Stop using this photo on the public website?`; body `The website will no longer use this photo.` plus `If {first} is listed, the website will use their directory photo instead, because it was cleared for the website.` or `The website will show no photo for {first}.`, then `Browsers that already saved it can keep showing it for up to a day, and copies kept by search engines or web archives can't be recalled.`; confirm `Stop using`.
- Remove: title `Remove this photo?`; body `It will no longer be used anywhere. The image file stays in storage and can't be erased from here.` plus as they apply `It is {first}'s directory photo, so the directory will show initials.` / `It is also their website photo, so it will leave the public website.` / `It is also being used on the public website because it was cleared for it.`, and when any website use applies `Browsers that already saved it can keep showing it for up to a day.`; confirm `Remove photo`.

### C7 and C8

- Edit-page link text: `Photos`.
- Listing dialogs, "on" branch, replacing `…name, role, and photo (if one is on file[ and they haven't hidden it]) visible to anyone visiting the public website — including search engines and archival crawlers.` in `staff/public-listing-toggle.tsx:124`, `officers/public-listing-toggle.tsx:113`, `groups/public-listing-toggle.tsx:137` (F289 will already have rewritten the parenthetical; the merged text is the baseline): `This makes {personName}'s name and role visible to anyone visiting the public website, including search engines and archival crawlers. A photo may be shown too, if a website photo has been chosen for them (or a directory photo cleared for the website) and they haven't hidden their photo.` The "off" branch is unchanged and stays true.

### C9 — release-note draft (final wording is the `/release-notes` skill's)

> **Photos of people.** A congregation can now turn on "Photos of people". Staff who manage people can add up to ten photos to an adult's record, choose the photo members see in the directory, and choose the photo shown on the public website for people who are listed there. A directory photo can also appear on the public website when the person who chose it confirms that the person agreed and no separate website photo is chosen. Photos are resized when they are added and are stored without location information. Photos of people who appear to be under 18, and photos of people who have hidden their photo, are not shown anywhere. Turning the setting off hides every photo, including on the public website; browsers that already saved a photo can keep showing it for up to a day, and copies kept by search engines or web archives cannot be recalled. Removing a photo stops it being shown but does not erase the stored file. Photos of children, family photos and self-service upload are not part of this release.

### C10 — neighbours (the grep of the live tree, and the modify targets it produced)

Grep for `photo|headshot|picture` in `src` found user-facing copy only in the three listing dialogs (C8); the directory empty states (`directory-grid.tsx` "No one is listed in … directory yet."), the Community empty states and the households grid mention no photo and stay true. Comments and docs made false and therefore modify targets: `src/lib/sites.ts:1645` ("`blob_assets.id`-shaped key (`people.photo_key`)" becomes the roster function's output), `src/lib/initials.ts:4` ("presby has no image upload and `people.photo_key` is a CONGREGATION's photo of …"), `src/lib/storage/blob-store.ts:14-15` and `src/lib/db/domain/assets.ts:24-25` ("`people.photo_key` stays untouched"; F289 rewrites these first), `src/lib/directory.ts:22,112` ("`hide_photo` null their own column"; "Nulled per `person_privacy.hide_photo`"), `person-avatar.tsx` header (resolves `people.photo_key`), `docs/TODO.md:386,497`, `docs/product/functionality-map.md:21,103`, and the 0072 comments that say the roster serves `photo_key` (superseded, not edited, since 0072 is F289's).

## Decisions (final text; the orchestrator records them in `docs/decisions.md`, newest first)

DECISION-285 to 288 are Phase 2's text with these amendments: **285** adds "the Drizzle declaration of the two retired columns stays until 0079 because `check:schema-parity` compares columns in both directions (F334)"; **286** names a definer core with an owner-only grant plus a wrapper deriving the organization from `presby_current_org()`, not an invoker (F333), and says the roster functions no longer join `person_privacy`; **287** and **288** stand as written.

- **DECISION-289: Person-photo rules live in five SQL functions, one definition per question, and every surface calls them.**
  - **Context.** Whether a photo shows is decided in four places (the directory, the public roster, the door, the admin page's status lines) by five facts (toggle, minor, merge, `hide_photo`, designation and attestation). Each reading its own SQL would drift, and the public one reads rows the app role cannot see.
  - **Decision.** `presby_person_photos_enabled` (the toggle, pinned to the catalog entry and compared with `orgFeatureEnabledInTx`), `presby_photo_subject_is_minor` (children.ts's DOB arithmetic), `presby_person_directory_photo` (invoker, RLS-scoped, `hide_photo` scoped to the viewing org as the directory has always done), `presby_person_public_photo` (definer, owner-only; `hide_photo` joined on person alone, the stricter cross-org rule 0072 chose) and its wrapper `presby_person_public_photo_status` (definer; organization from `presby_current_org()`). The roster functions, the directory query and the photos page call these and compute nothing themselves. A parity test compares the wrapper with the roster output for every person in the matrix.
  - **Alternatives rejected.** An invoker core (cannot see another organization's `hide_photo`; the page would disagree with the public site). Computing the answer in TypeScript for the page (a second definition). Granting the core to `presby_app` with an organization parameter (an oracle for any person's website photo key).
  - **Consequences.** Per-row function calls in the directory; one index probe per row when no photo is designated. `resolveMany` replaces per-card transactions. The directory entry field is `photoThumbKey`. A client downscale to at most 900 KB is mandatory, and the island never creates a `blob:` URL (the CSP).
  - **Revisit if** unpaged directory reads exceed about 2,000 rows, or the 500 KB document budget for 25 thumbnails is exceeded (then stream through an authenticated route with a DECISION-040 neutral 404).

## Findings (F333-F339)

- **F333.** Phase 2 R3's `SECURITY INVOKER` cannot see another organization's `person_privacy` row; the page would disagree with the public roster for a person who hid their photo elsewhere. Fixed in this design (definer core plus wrapper).
- **F334.** `check:schema-parity` compares columns both ways, so the Drizzle declaration of the retired columns must stay until 0079.
- **F335.** Re-applying 0072 after 0078 silently restores the old roster and door bodies. Header, runbook and test D4.
- **F336.** The CSP has no `blob:` in `img-src`; the client downscale must use `createImageBitmap`.
- **F337.** `removeSiteOrg` (F289's e2e helper) deletes `blob_assets` last, but photo rows reference them with NO ACTION; the photo fixture removes its own rows first.
- F338, F339: unused.

## Out of Scope (explicit non-goals; the operator confirms the list, O1)

- Member self-service upload, a `hide_photo` or privacy page, parent or guardian upload (its own pipeline, and the first writer of `hide_photo`).
- Photos of anyone under 18, and `photo_use` / `minor_photo` consent recording.
- Household photos (`household_photos`, Increment 3).
- Bulk or name-matched harvest (Increment 2, only if the volume warrants).
- Face detection or automatic crop beyond the top-biased 160 px thumbnail.
- Photos on the admin Community list rows.
- Erasing blob bytes; the cloud-storage adapter.
- Changing F289's ruling that directory flags do not gate photo fetch, or its open question about the platform `sites.*` flags.
- The content-repo swap of the first customer's leadership and committee pages (G12; operator, Q5).
- Contact lines on the public roster.
- A per-actor upload rate limit (edge case 29).

## Open rulings (for the orchestrator and operator)

- **O1.** Confirm the Out of Scope list above (Phase 1 asked; only Q1-Q4 are recorded as ruled), in particular that household photos wait for Increment 3.
- **O2.** Q5: priority relative to the January 1 cutover, and whether the leadership page loses its email and phone lines. Default: post-cutover, leadership page stays hand-authored.
- **O3.** Q6 (in flight): attested-only fallback. Only R3's `where` clause and the dialog copy change if the operator rules otherwise.
- **O4.** The DECISION-030 revisit thresholds (100 MB or 10% of database size) are judgement, not measured. Say if the operator wants different numbers.
- No person-id range is needed: the fixture reuses `community-fixture.ts` people (swept by name) and adds only photo rows. If Phase 4 finds it needs its own people it stops and asks for a range under Rule 16.

## Implementer

Three sequential batches, each ending in a green tree: **database-admin** (Batch 1: 0078, RLS script, schema, F331 rewrites, migration test), then **api-developer** (Batch 2: image pipeline, store, reader, actions, `resolveMany`, directory wiring, catalog and audit), then **ux-developer** (Batch 3: the photos page, islands, dialogs, copy, e2e). Release housekeeping is Batch 4 (tech-lead and orchestrator). `deployment-engineer` confirms the `sharp` install and build trace before Batch 2 starts.

---

# Phase 4 — Implementation

## Batch 1 — database-admin (2026-10-26)

Branch `pipeline/person-photos`, `origin/main` merged at 49ea633 (0.46.1, F289). Neon branch `pipeline-person-photos` (`ep-sweet-scene`) only. 0068 and 0072 were already on the branch; 0072 was re-applied whole (`psql -1`, exit 0, flipped 0) so the live bodies are main's text.

### Step 0 — R12 catalog (owner, `ep-sweet-scene`, after 0072)

| R12 question | Query | Result |
|---|---|---|
| `memberships_person_org_key` is a unique constraint | `pg_constraint where conname = …` | `contype u`, `UNIQUE (person_id, organization_id)` |
| `blob_assets_id_org_audience_key` exists | same | `contype u`, `UNIQUE (id, organization_id, audience)` |
| `presby_app` holds no UPDATE/DELETE on `people` beyond 0009 (F38) | `aclexplode(relacl)` + `pg_attribute.attacl` | `presby_app` SELECT, INSERT, UPDATE; no DELETE; no column ACLs. 0009 states exactly that (blanket grant at :128, `revoke delete on people from presby_app` at :376). `presby_platform` S/I/U/D is 0009:44's blanket grant. **No drift.** |
| Roster functions' `proconfig` and ACL match 0072 | `pg_proc` | both rosters and the door: `prosecdef t`, `{"search_path=public, pg_temp"}`, `{neondb_owner=X, presby_app=X}`, owner `neondb_owner` |
| The owner reads FORCE-RLS tables inside definers | `pg_roles`, `pg_class` | `neondb_owner` `rolbypassrls t` and owns every table read (people, person_privacy, memberships, staff_positions, officer_terms, group_memberships, organization_feature_toggles/categories, blob_assets, organization_sites: all FORCE RLS) |
| 0 rows have `people.photo_key` | `count(*) filter …` | 0 `photo_key`, 0 `photo_updated_at`, of 688 people |

Extra premises checked: no `pg_default_acl` for `neondb_owner` (new tables get no implicit grants); `presby_app` can SELECT every table the invoker helpers read, including `feature_flags`; `memberships.household_role` is unconstrained text; no application path deletes `memberships`.

### Step 0 — re-diff against 0072 as merged

The design was written against the 0072 draft. Merged 0072 (`1f61f62`) agrees with every assumption 0078 depends on: the roster signatures and result rows are unchanged; `person_privacy` is joined on `person_id` alone; the door's photo test is `lower(pe.photo_key) = p_key::text` on global `people` (F340: no `people.organization_id`); and the index is `people_photo_key_lower_idx`. 0078's design used no `people.organization_id`, so there is no F340-class defect. A mechanical diff of 0078's three bodies against merged 0072 shows **only** the designed changes:
- staff roster: 8 lines (the photo column and the join, in both branches);
- committee roster: 4 lines;
- door: 3 lines (the `is_photo` subquery).

The inner alias in the door is `pph`, because merged 0072 already uses `ph` for the lateral.

### Files created

- `drizzle/0078_presby_person_photos.sql` — sections 0–7 as designed.
- `src/lib/db/domain/person-photos.ts` — `personPhotos`, `personPhotoDesignations`, `PERSON_PHOTO_PURPOSES`.
- `src/lib/db/domain/person-photos.schema.test.ts` — 20 tests (names mirrored, purpose list, grants, function split, restated hardening, no `photo_key` reader, hide_photo scoping, toggle literals).
- `src/lib/db/domain/person-photos.db.test.ts` — 14 tests on the owner path (guards bind the owner; the FK behind the guard; retirement CHECK; membership NO ACTION; org-delete cascade).
- `scripts/person-photos/test-rls-78.sql` — sections 78a–g, 82 passes as `presby_app`.
- `scripts/person-photos/test-0078-migration.sh` — D4 (8 steps).
- `src/lib/testing/person-photo-fixture.ts` — `seedPersonPhoto`, `setPersonPhotosToggle`, `removeSeededPersonPhoto` (owner path; exempt from the blob scan as `src/lib/testing/`).
- `docs/work-log/person-photos-inc1.integration.patch` — Rule 16 diffs (below).

### Files modified

- `src/lib/db/domain/people.ts` — the RETIRED comment on `photoKey`/`photoUpdatedAt` (F334).
- `src/lib/db/domain/assets.ts` — the header no longer says `photo_key` "stays untouched"; it now names person photos as a private consumer.
- `scripts/check-schema-parity.ts` — two `architectural` allowlist rows for the DDL-only blob FKs.
- F331: `src/lib/db/domain/public-roster-photo.db.test.ts`, `src/lib/storage/public-asset.db.test.ts`, `src/app/(public)/site/[slug]/assets/[key]/route.db.test.ts` (below).

### Schema changes

- New tables: `person_photos` and `person_photo_designations`.
- New CHECK: `people_photo_key_retired`.
- Five functions: `presby_person_photos_enabled`, `presby_photo_subject_is_minor`, `presby_person_public_photo` (definer, owner-only), `presby_person_public_photo_status` (definer), `presby_person_directory_photo`.
- Two guard trigger functions.
- `presby_public_staff_roster`, `presby_public_committee_roster` and `presby_public_site_asset` are replaced, with the same signatures.
- **Mode: hand-written** (`drizzle/0078_presby_person_photos.sql`), applied with `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0078_presby_person_photos.sql` to `ep-sweet-scene` only.
- **Idempotence, whole file applied twice:** both runs exit 0. Counts before / after apply 1 / after apply 2 (people, blobs, memberships): 688/111/50 each time. The new functions went 0 to 7, then stayed 7.
- On the scratch database (D4 step 4), the second whole-file apply ran with photo rows present. The catalog fingerprint `fd85faf3…` was identical, the photo rows were byte-identical (md5), and counts were 1/2/2/19.
- **Journal entry:** idx 78, `0078_presby_person_photos`, when `1788655973186`. It is in the integration patch, not committed (Rule 16). D4 step 8 ran drizzle-kit migrate with exactly that entry.

### Deviations from the design (each with its reason)

1. **The two blob FKs are DDL-only.** The design said `foreignKey()` for five composite FKs. DECISION-058 and F289's `audience-callsites.test.ts` fail any import of `blobAssets` outside `blob-store.ts`, so `person_photos_image_fk` and `_thumb_fk` follow the ticket and statement precedent: declared in SQL, allowlisted in parity, and noted in the file header. The other three composite FKs are in Drizzle.
2. **Guard refusals use `check_violation`.** The design copied 0064, which used `insufficient_privilege`. The column-grant refusal is `insufficient_privilege`, so the RLS script can tell which mechanism fired.
3. **The designation guard reads the photo `FOR SHARE`.** That lock conflicts with the removal UPDATE, so remove-versus-designate serializes at the database and not only under `store.ts`'s advisory lock. The design's residual (a designation left active on a removed photo) is still inert by the readers' double filter.
4. **`presby_person_directory_photo` body.** The design gave it as prose; it is written to that prose. Keys are null when withheld. `photo_id` is kept, so the page can mark the chip.
5. **The R78e roster/door matrix runs on a live site in a DB test.** As `presby_app`, Alder Creek's site is `provisioning` and `presby_app` cannot write `organization_sites` (F289 hit the same limit). So the SQL script asks the same definer core through the status wrapper. The live-site cases (thumbnail never served, the Q6 fallback, ended and removed, toggle off, a minor at read time) are a new describe block in `public-roster-photo.db.test.ts`. D2 (wrapper vs roster parity, toggle vs `orgFeatureEnabledInTx`) stays Batch 2's: the catalog entry does not exist yet.
6. **`src/lib/dev-docs.ts` is coupled to the barrel line (F338, below).** Its two MODULES lines are in the integration patch as diff 4.

### F331 rewrites

Every test that wrote `people.photo_key` now seeds `person_photos` and a website designation, with the toggle on. Under 0078 all three files had failed in `beforeAll` with `23514 people_photo_key_retired`.

Every original property still holds, except two 0072 cases that are now **unrepresentable**. Those are asserted as such, not dropped:
- "photo stored `public_site`": the FK refuses it (`23503 person_photos_image_fk`);
- "`photo_key` stored uppercase": the key columns are `uuid`, and the roster emits lowercase.

Counts:
- `public-roster-photo` 13 (8 kept plus 5 live-site 0078 cases);
- `public-asset` 33 (32 kept or reshaped, plus a merged-tombstone case);
- `route` 5.

Photo content type in the fixtures is now `image/jpeg` (the master's real type).

`scripts/assets/test-rls-72.sql` needed no change. It seeds no photo, and 72a's index check still holds until 0079. It passes 24 under 0078.

### Failing-first evidence

The `test-rls-78.sql` failure lines are below. Each mechanism was broken on the owner connection, the suite was run as `presby_app`, and then the mechanism was restored.

**Catalog layer:**
- `no force` → 78a :67 (2 → 1);
- policy dropped → 78a :71;
- table UPDATE or DELETE granted → 78a :89 (14 → 13);
- either guard disabled → 78a :147;
- website_attested dropped, or retirement CHECK dropped → 78a :119 (9 → 8);
- active_idx dropped → 78a :127;
- image_fk or person_fk dropped → 78a :140;
- core granted to `presby_app` → 78g :179;
- wrapper or core made invoker, or `search_path` reset → 78g :166.

**Behaviour layer** (catalog blocks stripped):
- policy dropped → 78b WITH CHECK;
- table UPDATE → 78d (the guard message escapes the column-grant handler);
- DELETE granted → "FAIL 78d - presby_app deleted a designation";
- photo guard off → "FAIL 78d - a removed photo was restored";
- designation guard off → 78b RLS;
- website_attested → "FAIL 78c - an unattested website designation";
- active_idx → "FAIL 78c - a second active directory designation";
- image_fk → "FAIL 78c - …another org's blob";
- person_fk → "FAIL 78c - …not a member of this org";
- retirement CHECK → "FAIL 78d - people.photo_key was written";
- core granted → "FAIL 78e - presby_app called the owner-only core directly";
- wrapper invoker → `permission denied for function presby_person_public_photo`.

**Function bodies:**
- toggle forced true → 78e "toggle OFF … toggle_off";
- minor forced false → 78e "a minor by date of birth";
- hide_photo org-scoped in the core → 78e "hide_photo set at another org" (F333).

**F335:** re-applying 0072 on top of 0078 fails 78g (3 bodies read `photo_key`). Re-applying 0078 makes it green.

FORCE, the core's definer bit and the `search_path` pin change nothing for `presby_app`: their callers are definers and `neondb_owner` is BYPASSRLS. Their proof is the catalog assertion.

**Owner suite:** with both guards disabled, 10 of 14 fail; with the retirement CHECK dropped, 1 fails. Everything was restored, then all green.

**D4 PASS** (`scratch_0078` on `ep-sweet-scene`, dropped after):
1. The refusal without 0072 rolled back whole.
2. FP1 was stable across apply 2 with data present.
3. Both RLS suites passed (82 and 24).
4. The retirement CHECK refused the owner.
5. 0072 then 0078 restored FP1.
6. The drizzle-kit runner with the idx-78 entry left FP1.

### Gates

- `typecheck` 0 errors.
- `lint` clean.
- `npm run check` 8/8 passed.
- `check:schema-parity` with the barrel line applied: 87 tables, 9 differences, 9 allowlisted, 0 failing.
- **Unit suite** with the integration patch applied: 635 files and 9530 tests passed, 2696 skipped. **Without the patch, exactly one test fails:** `dev-docs.test.ts` "sees the same tables in the exports as are declared" (F338).
- **DB-backed, serial**, 22 files and 647 tests passed: the 5 new or rewritten files, plus `blob-audience.db`, `serving.db`, `statements.db`, `giving-statements.db`, `directory`, `sites`, `staff`, `officers`, `groups`, `people`, `people-update`, `children`, `fixture-deletable`, `admin/staff/actions`, `blob-store`, `org-features` and `blob-audience.schema`.
- `test-rls-78.sql` 82 passes and `test-rls-72.sql` 24 passes, both as `presby_app`.

### Findings

- **F338 (process/tooling, low).** F283's `dev-docs.test.ts` requires every declared `pgTable` to be re-exported from the barrel. Rule 16 keeps the barrel line off a pipeline branch until integration. So a pipeline that adds a domain table cannot have a green standalone branch.
  - This pipeline is the first since F283 to add a table.
  - Workaround here: the patch carries the barrel and `dev-docs.ts` together, and gates and QA run with it applied (the design's sanctioned mode).
  - Recommend the orchestrator either (a) let a pipeline commit its own barrel line and MODULES entry (they are append-only one-liners), or (b) give `dev-docs.test.ts` a pending-integration list.
  - **Until then, QA must apply `docs/work-log/person-photos-inc1.integration.patch` before the unit suite.**
- F339 unused.

### For the orchestrator (integration)

- Apply `docs/work-log/person-photos-inc1.integration.patch` (journal, test-rls.sql include, barrel, dev-docs). Then run `npm run docs:erd`.
- Section 78 needs the `org_portal.feature_categories` `feature_flags` row (`scripts/seed.ts`). It asserts the row exists rather than silently no-op'ing.
- TODO-line candidate: F338 (above). P4's lines stand as designed.

### Handoff to Batch 2 (api-developer)

- **The SQL contract is live on `ep-sweet-scene`** exactly as the design's table:
  - `presby_person_photos_enabled(org)`, `presby_photo_subject_is_minor(org, person)` and `presby_person_directory_photo(org, person)` are invokers, EXECUTE for `presby_app`. The directory function returns `(thumb_key, image_key, photo_id, withheld)`. Keys are null when withheld (`toggle_off` | `minor` | `hide_photo`), and there are zero rows when there is no active directory designation.
  - `presby_person_public_photo_status(person)` is a definer, EXECUTE for `presby_app`, and the only door to the core. It returns `(image_key, source, withheld)`, with `source` one of `website` | `directory_attested`, and `withheld` one of `toggle_off` | `minor` | `merged` | `hide_photo`. It returns zero rows without an org context.
  - The core `presby_person_public_photo` is owner-only: calling it from `presby_app` is `42501`.
- **Refusal shapes `store.ts` must map:**
  - both guards raise `23514` (`check_violation`) with fixed messages;
  - a second active designation for a purpose is `23505 person_photo_designations_active_idx`;
  - a duplicate active image for the person is `23505 person_photos_active_image_idx` (`duplicate`);
  - designating a removed photo is `23514` "…is removed, or is not this person's photo in this organization" (`already_removed` or `not_found`);
  - website without attestation is `23514 person_photo_designations_website_attested`.
  - Order inside designate: **end the old row, then insert**, or the partial unique fires.
  - Remove: end the designations, then set `removed_at` and `removed_by` **together** (removal_pair).
- `created_at` and `designated_at` are stamped by the guards on `presby_app`: do not pass them.
- Blobs: `store({ audience: "private" })` only. A `public_site` blob cannot be referenced (FK). The FK also requires both blobs to be in the same org.
- Tests: `src/lib/testing/person-photo-fixture.ts` seeds photos on the owner path for DB tests (`seedPersonPhoto`, `setPersonPhotosToggle`, `removeSeededPersonPhoto`).
- Comments in Batch 2's files that 0078 made false (Copy C10): `sites.ts:1645`, `initials.ts:4`, `blob-store.ts:14`, `directory.ts:22,112`, the `person-avatar.tsx` header. `people.ts` and `assets.ts` are done.
- `sharp`: deployment-engineer confirms one copy, then `npm install sharp@0.35.5`, as designed.
- Apply locally: `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0078_presby_person_photos.sql` (pipeline branch only). No seed change.

Strings added or changed: none user-facing (SQL error messages and comments only).

## Batch 2 — api-developer (2026-10-26)

Branch `pipeline/person-photos`; `origin/main` merged at c1cc35a (0.46.2) before any edit; Neon `pipeline-person-photos` (`ep-sweet-scene`, 0078 applied); no `git stash`; every commit staged by explicit path.

### Commits

| Commit | What |
|---|---|
| `e2605a5` | `build(deps)`: `sharp` 0.35.5 as an explicit dependency |
| `98060a6` | `chore(schema)`: the barrel line, the two dev-docs lines, `docs:erd` (F338 ruling); the integration patch loses those hunks |
| `17ec613` | `feat(storage)`: `BlobStore.resolveMany` and its unit test (U5) |
| `712b7a8` | `feat(directory)`: the `directory.ts` swap to `photoThumbKey`, the `person-avatar` move and `resolvePhotoSrcs`, the directory tests (D3) |
| `ccae2cb` | `feat(photos)`: `src/lib/person-photos/*`, the four audit keys, the catalog entry, the off-warning |
| `949c2ce` | `feat(photos)`: the four server actions and their test (U8) |

### sharp (the install check, done by me)

`npm install sharp@0.35.5 --save-exact` leaves **one** copy: `node_modules/sharp` at 0.35.5 in the lockfile, the version Next 16.4.2 already resolved as its optional image dependency. `package.json` carries `"sharp": "0.35.5"`, byte-identical to the treasury worktree's uncommitted line, so the two branches merge without a conflict. The install flipped four lockfile entries from `optional` to required (`sharp`, `@img/colour`, `detect-libc`, `semver`): the expected consequence of making it a direct dependency, and the only lockfile change beyond the one `dependencies` line. **Unverified:** that the linux binaries are traced into a Vercel function. No page or route imports `store.ts` yet (Batch 3 imports the actions), so `next build` cannot trace `sharp` today; the check belongs after Batch 3 on a preview deploy (deployment-engineer gate, edge case 26).

### What was built

- **`image.ts`** (the only `sharp` importer; `scan.test.ts` fails on any other). Order is the security property: size (`empty`, `too_large` over 1,000,000 bytes), our own magic-byte sniff (JPEG, PNG, WebP; a PDF, SVG, HEIC or text is `unsupported_type`), an APNG `acTL` chunk scan, then the header via `metadata()` (format must agree with the sniff, an animated WebP is `animated`, over 16 MP or any side over 6000 px is `too_many_pixels`), all before a pixel is decoded. Then auto-orient, sRGB with no profile retained, flatten on white, no metadata block (EXIF including GPS, XMP, IPTC, ICC), always re-encoded (a polyglot's trailing payload does not survive). Master: JPEG, long edge at most 1200, never enlarged, no forced crop, at most 400,000 bytes (quality 85 down to 46, then edge 1000, 800, 640). Thumbnail: 160 x 160 WebP, `position: "top"`. Pure bytes in, bytes out.
- **`store.ts`** (the only writer of both tables and the only `getBlobStore().store(` caller; both calls pass the literal `audience: "private"`). Check order on every mutation: toggle, `people.manage`, membership of this org (and the photo, for designate and remove), adult (add and designate only), cap of ten (add only). `addPhoto` authorizes and checks the target in a short transaction **before** `processPhoto`; stores the two private blobs; then one final transaction under `pg_advisory_xact_lock(hashtextextended('person_photos:'||org||':'||person, 0))` repeats every check, inserts, auto-designates the directory slot only when empty (never the website), and writes the audit rows in the same transaction. `designatePhoto` ends the old row then inserts; `removePhoto` ends every active designation (one `undesignated via remove` each), then sets `removed_at`/`removed_by` together, then writes `removed`.
- **`reader.ts`** (with `store.ts` the only importer of the two tables): `readPhotoSet(ctx, personId, { viewPhotoId })`, `personPhotosEnabled(ctx)`, `countPhotoDesignations(tx)`. Visibility is asked of SQL only: `presby_person_directory_photo()` and the `presby_person_public_photo_status()` wrapper (named nowhere else in `src/`). One `resolveMany` call for every thumbnail plus the one `?view=` master.
- **`consequences.ts`**, **`copy.ts`**, **`status-lines.ts`**, **`limits.ts`**, **`types.ts`**: pure.
- **`directory.ts`**: the row query left-joins `presby_person_directory_photo(m.organization_id, m.person_id)` laterally and selects `dph.thumb_key::text as photo_thumb_key`; its own `hide_photo` CASE is gone (the function owns it, scoped to the viewing org, as the directory always scoped it). The lateral join is a new optional argument of `directoryFromWhereSql`, so the count and find-person queries do not carry it. `DirectoryEntry.photoKey` is now `photoThumbKey`.
- **`person-avatar`** moved to `src/components/org-portal/` (a third caller). `resolvePhotoSrcs(org, keys)`: one `resolveMany` per 100 distinct keys, output aligned with `keys`, a read failure logs `[person-photos] thumbnail read failed; showing initials` and returns all nulls.
- **Catalog toggle** `org_portal.person_photos` (people, flag null, provisioned off, self-service, unscoped), its Features-page off-warning (`org-feature-warnings.ts`: a registry entry calling `countPhotoDesignations`; zero designations, no warning; count unreadable, the generic fallback), four audit keys.
- **Comments made false by 0078**, rewritten: `sites.ts` (roster entry), `initials.ts`, `blob-store.ts` header, `directory.ts` header and field, `person-avatar` header. `people.ts` and `assets.ts` were Batch 1's.

### Server-action signatures (`src/app/(org)/o/[slug]/admin/community/[id]/edit/photos/actions.ts`)

```ts
addPersonPhotoAction(slug: string, personId: string, formData: FormData):
  Promise<ActionResult<{ photoId: string; usedForDirectory: boolean }>>     // field "photo"
designatePersonPhotoAction(slug: string, personId: string,
  input: { photoId: string; purpose: "directory" | "website"; attested: boolean }): Promise<ActionResult>
undesignatePersonPhotoAction(slug: string, personId: string, purpose: "directory" | "website"): Promise<ActionResult>
removePersonPhotoAction(slug: string, personId: string, photoId: string): Promise<ActionResult>
```

Gate on all four: `auth()` then `resolveOrgContext()` (signed out: "You must be signed in to do that."; no org access: "You don't have access to that organization."), then everything in `store.ts` (toggle, `people.manage`, ...). Failure is `{ ok: false, error }` with one fixed string per `PhotoRefusal` kind; success revalidates `/o/<slug>/admin/community/<id>/edit/photos`, `.../edit` and `/o/<slug>/directory`. No redirect anywhere, no `db.` call in the file (both pinned by `actions.test.ts` and `scan.test.ts`).

### Contract Batch 3 (ux-developer) consumes

- **Page data:** `readPhotoSet({ organizationId, actorPersonId }, personId, { viewPhotoId })` returns `{ kind: "ok", set } | { kind: "feature_off" } | { kind: "forbidden" } | { kind: "not_found" }`. Map `forbidden` to `MembersForbidden heading="Photos"`, `not_found` to `notFound()`, a thrown error to `MembersLoadError heading="Photos"`, `feature_off` to `PhotosOff`. `personPhotosEnabled(ctx)` is the toggle on its own (for the edit-page link, and for the page's own off state before `readPhotoSet` when it wants it). Pass `searchParams.view` straight through as `viewPhotoId` (junk, another person's id or a removed photo's id is ignored by the reader).
- **`PhotoSetView`** (`types.ts`): `personId`, `displayName`, `firstName`, `organizationName`, `photos[]` (`id`, `thumbSrc` data URI or null, `width`, `height`, `createdAt`, `isDirectory`, `isWebsite`, `directoryAttested`), `count`, `isMinor` (disable the add control and show the under-18 notice), `directory`, `website`, `listings`, **`lines`** (`directory`, `website`, `listing`: the three "Where photos show" sentences, already chosen from the SQL answers; `directory` and `website` are `null` only when the toggle is off, which the page never reaches), **`state`** (the `PhotoStateSnapshot` the dialogs need), `viewed` (`{ photoId, src }` master as a data URI or null).
- **Dialog sentences:** `consequencesFor(set.state, intent)` from `consequences.ts` (pure, importable by a client component; `copy.ts` imports only types) returns the ordered consequence sentences for `{ kind: "designate_directory", photoId, attested }`, `"designate_website"`, `"undesignate_directory"`, `"undesignate_website"`, `"remove"`. The checkbox in the directory dialog should recompute with its current `attested` value on each tick. Titles, confirm and cancel labels, the two checkbox labels, headings, chips, counter, the under-18 notice, the empty state, the upload helper and progress strings are Batch 3's (Copy C2, C3, C4, C5, C7, C8); `copy.ts` already holds C1, C6, the three status-line groups, and the consequence sentences.
- **Client constants:** `limits.ts` (`CLIENT_TARGET_BYTES` 900,000, `CLIENT_MAX_EDGE` 1600, `MASTER_MAX_EDGE`, `UPLOAD_MAX_BYTES`, `PHOTO_CAP_PER_PERSON`). A client-side rejection (the framework's 413, a dropped connection) maps to `UPLOAD_REJECTED_COPY` in `copy.ts`.
- **Directory components** already take `photoThumbKey`; `DeaconCard`, `PersonCard`, the grid and both detail pages import `@/components/org-portal/person-avatar`.
- **Catalog key** `org_portal.person_photos`; its name, description and the off-warning copy are already in `org-features.ts` and `copy.ts`.
- **Test support:** `src/lib/testing/person-photo-fixture.ts` (Batch 1; owner path, DB tests). The e2e fixture is a new file and must remove designations, photos and their blobs, by id, before any shared teardown (F337).

### Deviations from the design (each with its reason)

1. **`sharp` is pinned exact (`0.35.5`), not `^0.35.5`.** The design said `sharp@0.35.5`; treasury added that exact spec, and an exact pin cannot split the two lockfiles.
2. **`status-lines.ts` is an added pure file.** The design names `reader-derive.test.ts` (U11) but no file for the derivation; putting it in `reader.ts` would have made the test need a database.
3. **A refusal carries an optional `first`** (`Refused.first`, set only for `minor`, `cap_reached` and `duplicate`). Copy C6 puts `{first}` in those three strings and the action must not make a second read to fetch the name; they all arise after the membership is found, so it is always there. If it were missing the action falls back to the `save_failed` string, never a blank name.
4. **`{staff, officer or committee member}` in the listing line** is rendered as `staff`, `officer`, `committee member`, in that fixed order, joined with commas and "and" (`staff and committee member`). The design gives a placeholder, not a rule; **flag for the Phase 5 copy-truthfulness check.**
5. **An invalid `purpose` posted to an action returns the `save_failed` string**, and a missing or non-file `photo` field returns the `empty` string. Both are forged-request paths the design does not word; both strings are the design's.
6. **Re-designating exactly what is already active** (same photo, same attestation) succeeds and writes nothing and no audit row. The design is silent; the same-photo-changed-attestation path is end-then-insert as designed.
7. **`store()` race handled, found by D1.** Two simultaneous adds of the same bytes both missed `blob-store.ts`'s check-then-insert dedup and one hit `23505` on `blob_assets`'s content-hash unique, which surfaced as `save_failed` (a double-clicked upload). `store.ts` retries each `store()` once on `23505`; the second attempt finds the winner's row. `blob-store.ts` itself is unchanged, so the logo and ticket paths have the same latent race for a simultaneous double submit; **a follow-up for the orchestrator** (it is the adapter's, not this feature's).
8. **Audit rows written in one transaction share `created_at`** (the column default is `now()`), so their relative order in `audit_events` is not observable. The design's "one `undesignated` row per ended designation, then `removed`" is therefore kept as a *set* (tests are order-insensitive), and `removed.endedPurposes` still carries the same facts. Not worth a change to `audit-tx.ts` (a shared file); noted for the Phase 5 audit read.
9. **`resolvePhotoSrcs` chunks at 100** (`RESOLVE_CHUNK`, a local literal pinned to `RESOLVE_MANY_MAX` by `blob-store-many.test.ts`) instead of making one call: an unpaged read of more than 100 photos must not silently show no photo at all (`resolveMany` throws over 100). Normal pages are one call.
10. **`readPhotoSet` also returns `feature_off`**, so the page does not have to check the toggle in a separate transaction first.
11. **Not done, by design:** `docs/deployment.md` runbook and the Rule 16 and 14 edits (Batch 4); no UI, no e2e, no `e2e/support/*` change (Batch 3).

### Failing-first evidence

- `image.test.ts` was written before `image.ts` (module not found), then mutated: removing the flatten, the orientation, the header caps, the top bias, the metadata strip, the animated-WebP check and the APNG check each fails a named test. **Not catchable:** the sniff-versus-sharp format agreement check is defence in depth; libvips chooses its loader from the same magic bytes, so the two agree by construction (the test accepts `unsupported_type` or `unreadable` for a lying file).
- `store.db.test.ts`: dropping the final-transaction repeat of the gate fails the toggle-revoked and permission-revoked tests; dropping the adult check from designate fails the corrected-DOB test; dropping the `removed` audit row fails the remove test. The concurrency test first failed for real (deviation 7).
- `scan.test.ts`: a temp file importing `sharp`, naming the table, writing it, and naming the wrapper each fail their test; the temp files were removed.
- The `.next` cache was stale and the first `next build` failed resolving a Google font module; `rm -rf .next` and a rebuild passed. A cache problem, not code.

### Gates

- `typecheck` 0 errors; `lint` clean; `npm run build` passes (after the cache clear above); `npm run check` 8/8 passed (re-run after commit, since `check:secrets` scans tracked files); `check:schema-parity` 87 tables, 9 differences, 9 allowlisted, 0 failing, with the barrel committed.
- **Unit suite (no database):** 644 files and 9,718 tests passed, 91 files and 2,759 tests skipped (DB-backed). This is **without** the integration patch.
- **DB-backed, serial:** 63 files, 1,351 tests passed: `store.db` 26, `public-photo.db` 23, `directory.test` 105 (8 of them new), the Batch 1 files (`person-photos.db`, `public-roster-photo.db`, `public-asset.db`, `route.db`, `blob-audience.db`) and the existing blob-store, org-features, sites, staff, officers, groups, people, children, community and contact-methods suites. New unit files: `image` 22, `consequences` 32, `reader-derive` 19, `copy` plus `person-photos-toggle` 35, `scan` 16, `actions` 46, `blob-store-many` 10, `org-feature-warnings.photos` 7.
- `scripts/person-photos/test-rls-78.sql` 82 passes and `scripts/assets/test-rls-72.sql` 24 passes, both as `presby_app`.
- `git apply --check docs/work-log/person-photos-inc1.integration.patch` is clean (journal and `test-rls.sql` hunks only).

### Findings and observations

- No new F-number allocated (F339 stays unused). Deviations 7 and 8 above are the two items for the orchestrator.
- The HEIC, 48 MP and 413 behaviour of the real client are Batch 3's and Phase 5's manual device check (unverified in CI).

### Handoff

Next: **ux-developer, Batch 3** (the photos page and its components, the edit-page link, the three listing dialogs, `copy.ts` UI sections, component tests, `e2e/support/person-photos-fixture.ts`, `e2e/person-photos.spec.ts`, `e2e/hydration/person-photos-upload.spec.ts`; port 3620). The server side needs no further change unless Batch 3 finds a gap.

## Batch 3 — ux-developer (2026-10-26)

Branch `pipeline/person-photos`; `origin/main` (0.46.3) merged first (two conflicts, both mine to resolve: the `blob-store.ts` header sentence and the `audience-callsites.test.ts` table, where the ingest pipeline's `sites-ingest.ts` row and the photo rows now both stand). No `git stash`; every commit staged by explicit path.

### Commits

| Commit | What |
|---|---|
| `b68cab6` | merge of `origin/main` |
| `6c662dd` | `feat(photos)`: the page, island, dialogs, edit link, listing dialogs, UI copy and their unit tests |
| (next) | `test(photos)`: fixture, E1/E2/E3/E4 specs |
| (next) | this section |

### What was built (`src/app/(org)/o/[slug]/admin/community/[id]/edit/photos/`)

`page.tsx` (one `readPhotoSet` call carries the gate; off, forbidden, error, not-found and data states; `?view=` passes straight through; no `loading.tsx`, pinned by a test), `photo-states.tsx` (`PhotosOff`), `where-photos-show.tsx`, `photo-grid.tsx` (server tiles), `tile-controls.tsx` (client buttons inside a `HydrationGate`, group labelled with the tile's alt text), `designate-dialog.tsx` (`Dialog`, native checkbox, directory box unticked and recomputing the consequence line, website confirm disabled until ticked), `confirm-dialogs.tsx` (`AlertDialog` for stop-using and remove, body from `consequencesFor`), `upload-island.tsx` (`HydrationGate`, no `capture`, any rejection mapped to the fixed string) and `downscale.ts` (`createImageBitmap`, canvas, white flatten, quality then edge stepping to at most 900 KB, fixed name `photo.jpg`, no `blob:`/`createObjectURL`, source-scanned). The edit page gains the "Photos" link when the toggle is on (read after `getPersonForEdit` says `ok`; a failed read hides the link). `copy.ts` gains `PAGE_COPY`, `UPLOAD_COPY`, `DESIGNATE_COPY`, `CONFIRM_COPY`, `EDIT_LINK_COPY` and `listingConsentCopy` (C8, used by all three listing dialogs).

### Deviations from the design (each with its reason)

1. **No success toast for designate, un-designate or remove.** Copy has no string for them; the page re-renders with the new chips and status lines, and refusals toast the server string. Not invented. **For Phase 5/6:** add strings if a toast is wanted.
2. **No `loading.tsx`, and no separate "Photos" section heading.** The h1 is "Photos"; only the counter row sits above the tiles (the design lists no section heading beyond "Where photos show").
3. **Downscale decodes files up to 1.5 MB unscaled and larger ones with `resizeWidth: 1600`.** `resizeWidth` alone would enlarge a small picture; a file under 1.5 MB cannot be a camera original. Unverified on a real 48 MP iPhone HEIC (manual Phase 5 item, as designed).
4. **The public-roster spec lives in `e2e/custom-domains/person-photos-roster.spec.ts`**, not `e2e/person-photos.spec.ts`: a custom host needs the `custom-hosts` project's `*.invalid` resolver. It is in the dev lane only (the prod `prod-custom-hosts` match list is unchanged; the hydration spec is in the prod lane).
5. **E4's measured baseline** (25 inlined thumbnails of about 3 KB each): the document is 254,996 bytes. Real portrait thumbnails are about 8 KB, which projects to roughly 420 KB, still under 500 KB but close to the DECISION-289 revisit trigger.
6. **Directory empty states untouched**: Copy C10 found them photo-free and true.
7. Listing-line wording deviation from Batch 2 (`staff and committee member` joined by commas and "and") is unchanged; still flagged for the Phase 5 copy check.

### Failing-first evidence

The three listing-dialog tests were rewritten to the new C8 sentence first and failed against the old text before `listingConsentCopy` replaced it (the old wording promised a photo "if one is on file"). The component and page tests were written with the components; mutation checks were not run on them.

### Gates

- `typecheck` 0 errors; `lint` clean; `npm run build` passes (cleared `.next` first); `npm run check` 8/8 (re-run after commit for `check:secrets`).
- Unit (no database): 652 files / 9,886 tests passed, 96 skipped. DB-backed (`dotenv -e .env.local`, serial) over `src/lib/storage`, `src/lib/person-photos`, `directory.test.ts` and the admin tree: 2,766 passed.
- Dev server on :3620: `person-photos.spec.ts` (2 admin viewports, toggle-off, E4) and `person-photos-roster.spec.ts` (platform host, custom host) pass; the existing community, community-approval, public-sites, person-emails, portal-footer-sitemap and portal-home-cards specs plus three hydration specs: 65 passed. Prod lane on :3621: `person-photos-upload` and `person-emails-editor` hydration specs pass.

### The browser walk (Chromium, 360 x 800 and 1280 x 900, synthetic noise images)

Uploaded a 5 MB JPEG with EXIF orientation 6, a copyright and a GPS block, and a 9.5 MB PNG: both posted under 1 MB; the stored masters have no EXIF, no orientation tag, no ICC, no "Exif" bytes, are at most 1200 px and the rotated source is stored upright (portrait). Designated one for the website through the attestation dialog (confirm disabled until ticked) and the other for the directory with the attestation (chip "Directory, cleared for website"); the member directory shows that photo's thumbnail (src equals the stored thumbnail bytes); removing it returns the directory to initials and ends its designations. A synthetic listed staff member's website photo loads (natural width above zero) at 360 px on `/site/<slug>` and on a custom host, is served `image/jpeg` with the public door's headers, and after removal a fresh request is the neutral 404 and the page has no image. No horizontal scroll, every control at least 44 px, dialogs inside the viewport, no native dialog.

### Findings and observations

- The Next dev overlay showed "1 Issue" on the edit page: a hydration mismatch inside `EditMemberPage`'s existing cards (an `<h2>` card), not in the photos link or page; pre-existing and not investigated. Suggest a TODO.
- The synthetic person is listed nowhere, so the walk's listing line read "isn't listed"; the listed path is covered by the roster spec and unit tests.
- `image/heic` is in the `accept` list as designed; whether a given browser can decode it is the manual device check.

### Handoff

Next: **qa, Phase 5.** Review: the Phase 5 copy-truthfulness check (Copy C2 to C5, C8, the listing-line deviation), the real-device HEIC and 48 MP check, and the missing success toasts (deviation 1).

---

# Phase 5 — Verification (qa)

*Pending.*

---

# Phase 6 — Shipped vs Intent (analyst)

*Pending. Walk it as a `people.manage` holder in a fresh organization at 360 px, and as an anonymous visitor on a custom host at 360 px. What's-new advisory (Rule 13) applies.*

---

## Phase 5 — Verification (qa)

**Verdict: FAIL.** The cause is copy truthfulness only. Every mechanical gate, all three suites, both e2e lanes, the feature-gate audit, the live-catalog audit and every mutation check passed. Three user-facing strings say things that are not true: two dialogs promise a photo "will appear" on the website when the page above them says it won't, a remedy names an action the page has no control for, and the off-warning counts designations as photos.

**Date:** 2026-10-26
**Verified by:** qa
**Tree:** `pipeline/person-photos` @ 9a90c28, worktree `/Users/cshenso/git/presby-platform/presby-photos`, Neon `pipeline-person-photos` (`ep-sweet-scene`). The worktree is clean after the run. The 0078 catalog fingerprint was `c926b4a3…` before and after the mutation work.

**Scope run (everything requested, in full):**
- Typecheck, lint, `npm run build`, `npm run check`, `check:schema-parity`.
- The full unit suite and the full serial DB-backed suite.
- RLS 78 and RLS 72 as presby_app, and the full integrated `test-rls.sql` in a scratch copy.
- D4 on a scratch database.
- Full chromium and custom-hosts e2e on my own server at :3620, and the prod lane on :3621.
- Database and TypeScript mutation checks.
- A live-catalog probe and a browser walk at 360 and 1280 px.
- Global flags were reset to the CI baseline (`scripts/ci/e2e-reset-flags.sql`, `pipeline_branch=1`) before the e2e run.

**Not run:**
- Coverage measurement.
- The real-iPhone check (48 MP HEIC, 12 MP library JPEG; edge case 24). I have no device; the operator still owes this check.
- The Vercel linux `sharp` trace (edge case 26, deployment-engineer). Locally, the photos page's `.nft.json` traces `@img/sharp-darwin-arm64` and libvips.

## Type Check

`npm run typecheck`: PASS. Lint PASS. `npm run build` PASS (cleared `.next` first). `npm run check` 8/8 PASS. `check:schema-parity`: 87 tables, 9 differences, 9 allowlisted, 0 failing.

## Unit Tests

- **Unit suite:** 9,886 tests passed, 0 failed, 29.8 s. 652 files passed; 96 DB-backed files skipped here and run below.
- **Full serial DB-backed suite (`npm run test:db`):** 12,725 passed, 5 failed, 1 skipped, 2,764 s.
  - All 5 failures are environmental. Each asserts a `localhost:3000` origin, and `.env.local` sets `NEXT_PUBLIC_APP_URL` to a different localhost origin:
    - `src/proxy.test.ts:535`
    - `src/lib/auth/safe-callback.test.ts:239`
    - `src/lib/onboarding/issue.db.test.ts:303`
    - `src/app/(member)/feedback/actions.test.ts:516`
    - `src/app/(org)/o/[slug]/tickets/actions.test.ts:333`
  - Confirmed by cause: re-run with the origin set to `localhost:3000`, four pass. `proxy.test.ts` passes with the origin unset, as CI has it. The diff touches none of these files.
  - The 1 skip is `render-pdf.test.ts:152`, the pre-existing `STATEMENT_SAMPLE_DIR` opt-in.
- **RLS, run as presby_app (`rolbypassrls = f`):**
  - `test-rls-78.sql`: 82/82.
  - `test-rls-72.sql`: 24/24.
  - Full `scripts/test-rls.sql` (integration patch applied in a scratch copy, `ON_ERROR_STOP` off): 1,470 passes. The only failures are the three known drift lines, :219, :518 and :7953. Sections 78 (82) and 72 (24) run complete inside it.
- **D4 (`test-0078-migration.sh`):** PASS on `scratch_0078_qa`, FP1 `fd85faf3…`, which matches Batch 1. All 8 steps passed, including F335 and the drizzle-kit runner. The scratch database was dropped afterwards.

## End-to-End Tests

- **Dev lane (:3620, my own server, `AUTH_URL` and `E2E_BASE_URL` set to :3620):** 612/612 passed, `--project=chromium --project=custom-hosts`, 23.7 min, 0 skipped, 0 retries. It covers all four photo specs.
- **E4 measurement:** a 234,076-byte document for 25 inlined thumbnails, inside the 500 KB budget.
- **Prod lane (`test:e2e:prod`, `PW_PROD_PORT=3621`):** 95/95 passed (prod-build plus prod-custom-hosts), including `hydration/person-photos-upload.spec.ts`.
- Both servers were stopped by PID.

**Browser walk** (a scratch Playwright script against its own fixture org with a live site, a listed staff person and a live custom host `qa-photos.invalid`; synthetic images only; identical results at 360 and 1280 px):

- **Uploads:**
  - A 4.9 MB noise JPEG with EXIF orientation 6, a copyright string and a GPS IFD went over the wire as 636 KB.
  - A 4.0 MB 4000×3000 PNG went over the wire as 872 KB.
  - Toasts read "Photo added. It's now Qawalk's directory photo." and "Photo added."
- **Stored masters:** JPEG, `private`. One is 800×1200 (the rotated source, stored upright); the other is 1200×900. Both have no EXIF, ICC or XMP block, no `Exif\0` marker and no copyright bytes. Thumbnails are 160×160 WebP with no metadata.
- **Website designation:** confirm stays disabled until the box is ticked. Afterwards the chips read "Directory" and "Website".
- **Directory:** the `img` is `data:image/webp`, byte-identical to the stored thumbnail, natural width 160.
- **Public roster on the custom host:** the image loads at natural width 1200.
- **Platform slug page:** 307 to `https://qa-photos.invalid/` with `no-store`. This is the designed hand-off to a live custom host. The platform roster render itself is covered by `person-photos-roster.spec.ts`, which passed.
- **Asset door, before removal:**
  - The asset returns 200 `image/jpeg`, `private, max-age=86400`, `nosniff`.
  - The thumbnail key returns the neutral 404 `{"error":"Not found"}` with `no-store`.
- **Remove through the AlertDialog:**
  - Both hosts then return the neutral 404.
  - The roster shows the name with no image.
  - Removing the directory photo returns the directory to initials.
- **Layout:** no horizontal scroll and no native dialogs. The only target under 44 px is the pre-existing "Back to portal" link (20 px, (org) chrome, not in this diff).

## Regression Tests Added

This is a feature, not a bug fix. Instead of trusting the implementers' failing-first notes, I re-checked the property each test guards by breaking it myself.

**Database mutations:** each was applied to `ep-sweet-scene`, the tests were run, then 0078 was re-applied whole (with explicit constraint re-adds where `create table if not exists` cannot restore them). The fingerprint was verified restored after every one.

| Mutation | Caught by |
|---|---|
| Image FK loses its audience pin (2-column) | 78a; with catalog blocks stripped, 78c "a photo pointed at a public_site blob" |
| Thumbnail FK loses its pin | 78a catalog assertion only (no behavioural probe; acceptable, see note) |
| `person_photos_audience_private` dropped | 78c "declared itself public_site" |
| Membership FK dropped | 78c; `person-photos.db.test.ts:166` |
| Designation photo FK dropped | Behaviour is held by the guard; `person-photos.db.test.ts:142` (guard disabled) catches the FK |
| `active_idx` dropped | 78c "a second active directory designation" |
| Website attestation CHECK dropped | 78c "an unattested website designation" |
| Removal not one-way / ending not one-way | 78d; `person-photos.db.test.ts:108` |
| Owner exempted from the photo guard | 8 owner-path tests fail (the refusing layer on `neondb_owner` is the trigger) |
| Retired `people.photo_key` CHECK dropped | 78a; `person-photos.db.test.ts:158` |
| Minor predicate forced false | 78e; `public-roster-photo.db.test.ts:320`; the directory and D2 tests |
| `hide_photo` ignored (core; directory function) | 78e; `public-roster-photo.db.test.ts:158`; `directory.test.ts` |
| `hide_photo` scoped to the org in the core (F333) | 78e "set at another org" |
| Toggle forced on | 78e; the D2 27-combination matrix (`public-photo.db.test.ts:355`); `public-roster-photo.db.test.ts:306` |
| Door serves any photo key | `public-roster-photo.db.test.ts:257` (thumbnail) and 19 others |
| Q6 fallback without attestation | 78e; `public-roster-photo.db.test.ts:262` |

Two mutations survived, and they are equivalent rather than gaps: the door's `is_photo` ignoring thumbnails, and ignoring removed photos. Either way the key falls to the `site` branch, which requires `public_site`, and the FK plus CHECK pin every photo blob `private`. The defence-in-depth clause is therefore untested by design, which is fine while the pin holds.

**TypeScript mutations** (in a `git archive` scratch copy, since deleted by literal path):

| Mutation | Caught by |
|---|---|
| `sharp` imported by `reader.ts`, by `import()` in `blob-store.ts`, or by `require` in an (org) file | `scan.test.ts:55` |
| `withMetadata`, `keepExif`, `keepIccProfile`, or `keepMetadata` on the thumbnail | `image.test.ts:53` / :70 / :81 |
| Pixel-count cap removed; header caps removed; edge cap removed | `image.test.ts:240` / :249 |
| Byte ceiling removed in `image.ts`; in the action | `image.test.ts:203`; `actions.test.ts` |
| Sniff accepts anything; pages check removed; `autoOrient` removed | `image.test.ts:207` / :215 / :70 |
| Attestation check loosened to truthy | 3 `actions.test.ts` cases |
| Decode before authorization | `store.db.test.ts:292` and 4 more |
| Final transaction does not repeat the gate | edge-case 7 and 8 tests |
| Audit failure swallowed | `store.db.test.ts:588`, :600 |
| Designate skips the adult re-check | `store.db.test.ts:396` |

Every mutation was killed.

## Coverage on Critical Modules

Not measured. The diff touches none of `permissions.ts`, `two-factor.ts` or `flags.ts`.

## Feature-Gate Audit

Checked by reading each action and page body. These are tenant-axis gates: `people.manage` through `presby_has_permission(actor, org, …)` inside the mutation's own `withOrgContext` transaction, toggle first. The platform `FEATURES.*` catalog does not apply.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `addPersonPhotoAction` | yes (+ `resolveOrgContext`, re-run in body) | n/a: toggle, then `people.manage`, then membership, adult and cap, in `store.ts` `gate()` before decode and again under the lock | n/a (`people.manage`, correct per Q3) |
| `designatePersonPhotoAction` | yes | n/a: same gate in one transaction, plus photo ownership and the adult re-check | n/a |
| `undesignatePersonPhotoAction` | yes | n/a: same gate | n/a |
| `removePersonPhotoAction` | yes | n/a: same gate plus photo ownership | n/a |
| GET `/o/[slug]/admin/community/[id]/edit/photos` | yes (`cachedAuth`, `resolveOrgContext`, `assertOrgAccess`) | n/a: `readPhotoSet` checks toggle, `people.manage` and membership in one transaction | n/a |
| Edit-page "Photos" link | yes | rendered only when `getPersonForEdit` returns ok (`people.manage`) and the toggle is on | n/a |

No route handler was added (`scan.test.ts`). The public door's route is unchanged; its SQL changed and is covered by the schema audit below.

**Schema/RLS audit (live catalog, `ep-sweet-scene`):**
- **RLS and policy:** both tables have `relrowsecurity` and `relforcerowsecurity` on, owner `neondb_owner`. Each has one `tenant_isolation` ALL policy, USING and WITH CHECK on `presby_current_org()`.
- **Grants:** `aclexplode` shows presby_app holds SELECT and INSERT only. Column UPDATE is limited to `removed_at`/`removed_by` and `ended_at`/`ended_by`. There is no DELETE, and presby_platform has nothing.
- **Triggers:** both guards are BEFORE INSERT OR UPDATE and enabled.
- **Constraints:** all 4 composite FKs are NO ACTION and validated. The CHECKs are validated, including `people_photo_key_retired`.
- **Functions:**
  - All 7 new functions pin `search_path`.
  - `presby_person_public_photo` is a definer with `{neondb_owner=X}` only.
  - The status wrapper is a definer executable by presby_app.
  - The rosters and door keep definer status, `proconfig` and ACL.
  - No stored body reads `people.photo_key`, and 0 rows carry it.
- **Which layer refuses (proven on the connection that matters):**
  - On presby_app: DELETE is refused by the grant; immutable-column UPDATE by the column grant; WITH CHECK by RLS (78b, 78d).
  - On the owner connection: the trigger refuses. The owner-exemption mutation shows the grant cannot.

## Copy Truthfulness

- [ ] Every added or changed string is in the design's Copy table. All are verbatim, so the defects below trace to the design text and its wiring.
- [x] The query behind each claim was opened, and what it does not read was named.
- [ ] Each instruction was traced to the role that sees it, and that role can do it. Item (b) fails.
- [x] Older strings about the same subject were grepped for. Only the three listing dialogs mentioned photos, and their C8 rewrite is true: it is hedged with "may" and gives no instruction to a viewer who may not hold `people.manage`.

**copy truthfulness: FAIL**

**(a) The dialogs promise "will appear" while the page says the photo is withheld.**
- **Viewer:** a `people.manage` holder.
- **Where:**
  - `/Users/cshenso/git/presby-platform/presby-photos/src/lib/person-photos/consequences.ts:68` and `:57`, rendering `copy.ts:149` ("{first} is listed, so this photo will appear on the website.") and `copy.ts:142` ("…this photo will also appear there.").
  - The directory dialog body, `copy.ts:219` ("…will see this photo instead of their initials.").
- **What it does not read:** the snapshot built at `reader.ts:256-261` carries `listed`, `website` and `directory` only. It carries no `withheld` (`hide_photo`, merged), and no site status or `sites.*` flags.
- **Reproduced in the walk at both widths:** with `hide_photo` set, the page reads "Website: not shown, because Qawalk has hidden their photo." while the "Use on website" dialog on the same page reads "Qawalk is listed, so this photo will appear on the website."
- **Also reachable today:** "will appear" for a listed person whose organisation has no published site. The page's own listing line hedges this correctly ("only while … the website is published").
- **Fix:** pass the SQL `withheld` answers into the snapshot and suppress or condition these lines. Hedge or condition "will appear" the same way the listing line does. Add an exact-text test that fails on the old text.

**(b) The unattested remedy names an action with no control.**
- **Viewer:** a `people.manage` holder.
- **Where:** `copy.ts:108-109` ("…or clear the directory photo for the website.").
- **What the page offers:** the tile for the current directory photo shows only "Stop using in directory / Use on website / Remove" (`tile-controls.tsx:55-62`, observed after removal). The directory designate dialog, the only place the attestation can be ticked, is unreachable for that photo.
- **Contradicts the design:** C2 claims "both performed … in the designate dialog". The only path is stop-using then re-choosing, which passes through an initials state the copy never mentions.
- **Fix:** offer the dialog for the current directory photo (the store already handles a changed attestation as end-then-insert), or reword the instruction.

**(c) The off-warning counts designations as photos.**
- **Viewer:** the `org_features.manage` holder at `/admin/features`.
- **Where:** `org-feature-warnings.ts:64-66` uses `countPhotoDesignations` (`reader.ts:74-87`) and renders `copy.ts:79` ("{n} photos are currently chosen…").
- **Effect:** one headshot used for both the directory and the website, the natural case G3 names, reads as "2 photos". Count distinct photos, or say "photo choices".

**Note (lower, fold into the same ruling):** `copy.ts:98` ("Directory: members see the photo…") is chosen from `presby_person_directory_photo`, which does not read `directory_hidden` or membership status. The photos page stays reachable for a `directory_hidden` or ended member, for whom it is false.

**Passed:**
- C1 description, C3, C5, C6, C7 and C8.
- Batch 2's listing-line join: it reads the roster functions' own predicates and rendered "(staff)" correctly.
- Deviation 1, no success toast for designate, un-designate or remove: no string claims one, and the page re-renders its chips and status lines. This is UX for Phase 6, not a copy defect.

## Verdict

**FAIL — copy truthfulness only.** Items (a) and (b) trace to Copy C2/C4 claims in the design and to wiring; item (c) to the C1 count source. The strings are design-owned (the design says "an implementer who needs a string that is not here stops for a ruling"), so this goes to tech-lead first.

**Observations, not failures:**
1. The shared scratchpad's `qa/` directory was in concurrent use by another QA agent: a treasury dev server writing to the same `dev.log`, and the same `walk/` name. I checked that my evidence logs came from this tree, by content and counts, and moved my walk to `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa-photos-p5/`. The orchestrator may want per-agent scratch names.
2. Batch 2's deviation 7 (the adapter's double-submit dedup race affects the logo and ticket paths too) still needs a TODO line.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete. Every gate green:<br>• typecheck, lint, build, check 8/8, parity 0 failing<br>• unit 9,886/9,886<br>• test:db 12,725 passed; 5 failures environmental by cause (localhost:3000 origin), 1 pre-existing opt-in skip<br>• RLS 78 82/82, RLS 72 24/24; full test-rls 1,470 passes with only the 3 known drift lines<br>• D4 PASS<br>• e2e dev 612/612, prod 95/95 (flags reset to the CI baseline first)<br>• 20 DB and 16 TS mutations all killed or shown equivalent; live-catalog probe clean; feature-gate audit clean; walk at 360/1280 clean<br>FAILED on copy truthfulness: (a) "will appear" dialogs ignore withheld state, (b) the unattested remedy has no control, (c) the off-warning counts designations as photos. Real-device HEIC and the Vercel linux `sharp` trace are still unverified | FAIL | 2026-10-26 |

**Handoff:**
1. **tech-lead (Phase 3, brief):** rule the replacement strings for C4's "will appear" lines and the directory dialog body under withheld states, C2's unattested remedy (control or wording), C1's count noun, and the C2 `directory_hidden` note.
2. **ux-developer (Phase 4):**
   - Pass the SQL `withheld` answers into `PhotoStateSnapshot` and `consequencesFor`.
   - Make the attestation reachable for the current directory photo.
   - Count distinct photos in the warning.
   - Add exact-text tests that fail on the old strings.
3. Then back to qa for a scoped re-run: copy, consequences, the photos page specs and the walk.

---

## Phase 3 — amendment (Phase 5 run 1 copy rulings)

**Author:** tech-lead, 2026-10-26. **Trigger:** Phase 5 run 1, FAIL on copy truthfulness only (items (a), (b), (c) and the `copy.ts:98` note). **Class:** a Phase 3 copy defect: every string QA cited is the design's own Copy text, so the fix is a ruling here, not an implementer judgment. **Phase 2 skip:** no new dependency, table, route, action, flag, permission or schema change; nothing here touches an invariant, so no architect pass. **Implementer:** **full-stack-developer** (judged, not the default `ux-developer`): the change spans a server read (`reader.ts`, the snapshot and the count), pure copy and consequence files, and two client components, and it is small and coupled (one snapshot type feeds all of them). Splitting it between ux-developer and api-developer would add a handoff on a type both sides edit.

### Root cause (one paragraph)

The design's consequence sentences were written as promises ("will appear") but computed from a snapshot that carries only `listed`, `website` and `directory`; SQL's withheld answers (`hide_photo`, `merged`, under 18) were read by `reader.ts` for the page's status lines and never reached the dialogs. Separately: (b) C2's unattested line named a remedy the page had no control for, because the current directory photo's tile offers only stop, use-on-website and remove; (c) C1's count source counts designation rows, and one photo can carry two. The Phase 3 Copy check 2 ("source of truth") was recorded as passed for C4 on the strength of the listing read alone; it is reopened here and the claim is reworded to what the queries establish.

### Feasibility check (live tree, 0df93af)

- No migration. The data the snapshot needs is already read in `reader.ts` (`dirRow.withheld`, `webRow.withheld`, `minorRow.minor`). **One limit the design must respect:** `presby_person_public_photo_status()` and `presby_person_directory_photo()` start from the designation (`from c ...`), so with **no** active designation they return **zero rows** and `withheld` is unknown, not null-because-fine. `hide_photo` and `merged` are therefore known to the page only when a designation exists; the **under-18 answer is always known** (`presby_photo_subject_is_minor`, already read as `isMinor`). The design therefore may not say "nothing withholds it" for a person with no designation. Every "can appear" sentence below carries the "unless something withholds it" tail for that reason. Adding a withheld-without-designation read would be a new SQL function (an in-place 0078 correction), which this ruling declines: the hedge is true in every state and costs no schema work.
- `PhotoStateSnapshot` is a type-only export used by `reader.ts`, `consequences.ts`, `tile-controls.tsx`, `designate-dialog.tsx`, `confirm-dialogs.tsx` and their tests. Adding fields is a compile-visible change; the implementer lets `tsc` list every fixture that needs the new fields.
- The store already handles a changed attestation on the **same** photo as end-then-insert (Batch 2 deviation 6); no store change. The implementer confirms with an existing `store.db.test.ts` case or adds one (see T8).
- `src/auth.ts`, the proxy, `authz.ts`, the permission catalog and every flag seed are untouched. No new `FEATURES` key, no flag. The org toggle `org_portal.person_photos` is unchanged.

### Rulings

**Rule applied to every string below (new, and retroactive to C1 to C8):** a sentence about what a surface *will* show is allowed only where the query behind it establishes it; where the snapshot cannot establish it, the sentence says *can*, names the condition, and ends with the unless-clause. Re-checked against every C-string; the retroactive hits are R-a5, R-a6 and R-a7 below, and nothing else in C1 to C8 changes (the C8 listing-dialog text already says "may").

#### R-a. Dialogs ignoring withheld states (QA (a))

**R-a1. Data the snapshot must carry.** `PhotoStateSnapshot` (in `consequences.ts`) gains three fields; the reader fills them from answers it already holds:

```ts
/** presby_photo_subject_is_minor: ALWAYS known (the one withheld reason that needs no designation). */
minor: boolean;
/** presby_person_directory_photo().withheld when it reported hide_photo (scoped to this org); else null.
 *  null means "none reported", NOT "none applies": with no directory designation the function returns no row. */
directoryWithheld: "hide_photo" | null;
/** presby_person_public_photo_status().withheld when it reported hide_photo or merged; else null. Same caveat. */
websiteWithheld: "hide_photo" | "merged" | null;
```

`reader.ts` sets `minor: isMinor`, `directoryWithheld: dirRow?.withheld === "hide_photo" ? "hide_photo" : null`, `websiteWithheld: webRow?.withheld` mapped likewise for `hide_photo` and `merged` (`minor` and `toggle_off` never go in these two fields: minor is the `minor` field, and the toggle is off only on a page that does not render). `consequencesFor` still reads no database.

**R-a2. The derivation.** `directoryPhotoServesWebsite` gains the withheld conditions: `attested && website === null && listed && !minor && websiteWithheld === null`. Where it is false because of withholding, the dialogs say nothing about the website falling back (they must not claim the fallback is in use).

**R-a3. Exact strings (`CONSEQUENCE_COPY` in `copy.ts`, replacing the old ones; `{first}` is the first name).** The cell of "who sees it": a `people.manage` holder on the photos page.

| Key | Replacement (verbatim) | Replaces |
|---|---|---|
| `directoryAlsoOnWebsite(first)` | `Because {first} is listed on the public website and has no website photo, this photo can also appear there while the website is published, unless something withholds it, such as {first} hiding their photo or appearing to be under 18.` | `copy.ts:142` |
| `websiteListed(first)` | `{first} is listed, so this photo can appear on the website while the website is published, unless something withholds it, such as {first} hiding their photo or appearing to be under 18.` | `copy.ts:149` |
| `minorBlocked(first)` (new) | `{first} appears to be under 18, so a photo of {first} can't be chosen for the directory or the website yet.` | new |
| `directoryHidden(first)` (new) | `{first} has hidden their photo, so the directory won't show this photo while that is so.` | new |
| `websiteHidden(first)` (new) | `{first} has hidden their photo, so the website won't show this photo while that is so.` | new |
| `websiteMerged` (new) | `This record was merged into another, so the website won't show this photo.` | new |
| `removeIsWebsiteWithheld` (new) | `It is also their website photo, which the website isn't showing at the moment.` | used instead of `removeIsWebsite` when `minor` or `websiteWithheld` is set |

`directoryWebsiteConditional`, `directoryWebsiteWillStop`, `websiteNotListed`, `websiteReplaces`, `directoryAlsoOnWebsiteEnds`, `websiteStops`, `websiteFallsBack`, `websiteShowsNone`, `websiteCaches`, `removeBase`, `removeIsFallback`, `removeIsWebsite` (when nothing is withheld) and `removeCaches` are **unchanged and stay true**: each is either "only if", a statement of what the designation is, or a "will show no photo" claim that holds whether or not the site is published.

**R-a4. Which sentences each intent returns** (the whole of `consequencesFor`, so the implementer cannot choose differently):

- `designate_directory`:
  - `state.minor` -> `[minorBlocked]` and nothing else.
  - else: `directoryHidden` first if `directoryWithheld`; then, if `attested`: `websiteHidden` or `websiteMerged` (by `websiteWithheld`) if set, else (`listed && website === null`) `directoryAlsoOnWebsite`, else `directoryWebsiteConditional`; if **not** attested and `directoryPhotoServesWebsite`: `directoryWebsiteWillStop`.
- `designate_website`:
  - `state.minor` -> `[minorBlocked]`.
  - else `websiteHidden` or `websiteMerged` if `websiteWithheld`, else `websiteListed` if `listed`, else `websiteNotListed`; then `websiteReplaces` if another website photo is active (unchanged).
- `undesignate_directory`: `directoryInitials`, then `directoryAlsoOnWebsiteEnds` if `directoryPhotoServesWebsite` (now withheld-aware).
- `undesignate_website`: `websiteStops`; then `websiteFallsBack` only if `directory.attested && !minor && websiteWithheld === null`, else `websiteShowsNone`; then `websiteCaches`.
- `remove`: `removeBase`; `removeIsDirectory` if the directory photo; if the website photo: `removeIsWebsiteWithheld` when `minor || websiteWithheld !== null`, else `removeIsWebsite`; `removeIsFallback` if it is the serving fallback; `removeCaches` if website photo or fallback (unchanged rule: a browser may hold a copy served before the withholding).

**R-a5. The directory dialog body (`DESIGNATE_COPY.directory.body`, `copy.ts:219`)**, now `body(name, first)`: `Members who can see {name} in the directory will see this photo instead of their initials, unless {first} has hidden their photo or appears to be under 18.` (true for `hide_photo`, minor, `directory_hidden` and ended members alike: "members who can see {name}" is empty for the last two; the `DesignateDialog` call site passes `state.first`).

**R-a6. Retroactive: the two other "directory will show" strings (found by the neighbours grep; not cited by QA but false for a `directory_hidden` or ended member, the same defect as `copy.ts:98`).**
- `directoryInitials(first)` (`copy.ts:154`): `Wherever {first} appears in the directory, their initials will show instead.`
- `removeIsDirectory(first)` (`copy.ts:166`): `It is {first}'s directory photo, so wherever {first} appears in the directory it will show initials instead.`

**R-a7. The QA note on `copy.ts:98` and `:99` (a directory line false for `directory_hidden` or ended members).** Ruled as wording, **not** data: `presby_person_directory_photo` reads neither `directory_hidden` nor membership status, and the directory's eligibility predicate (`directoryEligibilityWhereSql`, roll status, tombstone, ended, deceased) is the directory's, not this feature's; reading it here would be a second copy of a privacy predicate (the risk `directory.ts` itself names). So the lines become conditional on who can see the person:
- `DIRECTORY_LINES.shown(first)`: `Directory: members who can see {first} in the directory see the photo marked "Directory" below.`
- `DIRECTORY_LINES.none(first)`: `Directory: no photo chosen, so members who can see {first} in the directory see initials.`
`hide` and `minor` lines are unchanged ("not shown" is true in every state). Both become functions of `first` (they are strings today, so `statusLines` and the e2e and page tests that name them change).

**R-a8. Behaviour that follows from the strings.** The designate dialogs (directory, website and the new clear dialog of R-b) disable their **confirm** button when `state.minor` (the store refuses a minor; the sentence says so before the click, so the refusal toast `minor` ("...can't be added yet") is reachable only by a stale page or a forged request, and keeps its C6 wording; **neighbour noted**: that string says "added" where the act would be "chosen"; accepted, because the disabled button removes the honest path to it). Nothing else about the dialogs changes.

**Copy checks (one line per group).**
- *Residuals:* the website dialog body (`DESIGNATE_COPY.website.body`, search engines and archives keep copies) is unchanged and the new `clear` body repeats it; no sentence denies the cached-copy residual; `removeCaches` and `websiteCaches` are kept for every case where a browser may hold a copy.
- *Source of truth:* "can appear ... while the website is published" is the roster functions' own gate (the listing line already says it); **not read** by the snapshot: site status and the platform `sites.*` flags, so no sentence says "will appear"; `minor` from `presby_photo_subject_is_minor`, `directoryWithheld` from `presby_person_directory_photo`, `websiteWithheld` from `presby_person_public_photo_status`; the last two are known only when a designation exists, so the unless-clause stays in the hedge.
- *Audience:* every string here is shown to a `people.manage` holder on the photos page, who can perform the one instruction it gives (none of the dialog sentences instruct).
- *Neighbours:* grep of `will appear|will also appear|will see|will show|will leave|members see` across `src` and `e2e`: modify targets are `copy.ts:98,99,142,149,154,166,219`; unrelated hits (giving, whats-new, calendar) are not about photos and stay. The C8 listing dialogs already say "may", unchanged.

#### R-b. The unattested remedy has no control (QA (b))

**Ruling: make the dialog reachable (a new button on the current directory photo's tile); do not reword.** Reasons: the two other ways to word it ("stop using it, then choose it again and tick the box") pass through an initials state the copy never mentions and make a consent step a two-click chore; the store already supports it; and consent clearing is the one thing this feature exists to make deliberate. The cost is one button, one dialog variant and four strings.

**R-b1. The control.** On the tile that is the current directory photo **and is not attested** and the person is not a minor, `TileControls` renders a fourth button, label **`Clear for website`** (`PAGE_COPY.clearForWebsite`), above "Use on website". It opens the existing `DesignateDialog` in a third variant `clear`: `purpose: "directory"`, `attested: true`, the same photo. Other tiles, attested tiles and minors never show it. `TileControls` gains `directoryAttested: boolean` (from `PhotoTileView.directoryAttested`, already read) and reads `state.minor`. **Withdrawing a clearance without losing the directory photo is not added** (see Out of scope and the carry-forward): today it is stop-then-choose-unticked, and the dialogs say what happens at each step.

**R-b2. Exact strings (`DESIGNATE_COPY.clear`, plus the button label):**

| Key | Text (verbatim) |
|---|---|
| `PAGE_COPY.clearForWebsite` | `Clear for website` |
| `DESIGNATE_COPY.clear.title` | `Clear this photo for the website?` |
| `DESIGNATE_COPY.clear.body(first)` | `This is {first}'s directory photo. Clearing it lets the public website use it too when {first} is listed and no website photo is chosen. Anyone on the internet can see a photo on the public website. Search engines and web archives may keep copies, and removing the photo later can't recall them.` |
| `DESIGNATE_COPY.clear.checkbox` | the existing `DESIGNATE_COPY.directory.checkbox(first)`, verbatim: `I have {first}'s permission to also use this photo on the public website if they are listed there and no website photo is chosen.` |
| `DESIGNATE_COPY.clear.confirm` | `Clear for website` (disabled until the box is ticked, and when `state.minor`) |

The consequence sentences under the box are `consequencesFor(state, { kind: "designate_directory", photoId, attested: ticked })`, as for the directory variant. Because the box starts unticked and the confirm needs it ticked, an unticked confirm cannot occur (it would be a no-op).

**R-b3. The remedy line (`WEBSITE_LINES.unattested`, `copy.ts:108-109`), verbatim:** `Website: none. The directory photo isn't cleared for the website. Choose a website photo, or choose "Clear for website" on the photo marked "Directory".`

**R-b4. Under 18.** `statusLines` and `websiteLine` gain the person's `minor` flag. When the answer would be the unattested remedy and `minor` is true, the line is `WEBSITE_LINES.minor(first)` instead (a remedy that cannot be performed is not offered). The existing precedence (an SQL withheld answer wins over the remedy) is kept. `hide_photo` with no designation is not known to the page, so the remedy line may appear for a person who has hidden their photo; that is true (the photo is not cleared) and promises no photo, and is accepted.

**Copy checks.** *Residuals:* the `clear` body names the search-engine residual. *Source of truth:* "This is {first}'s directory photo" is the active, non-removed directory designation (`PhotoTileView.isDirectory`, unattested = `!directoryAttested`); the conditional "when listed and no website photo" is R3 itself, not a claim about the current state. *Audience:* the `people.manage` holder who sees the page also sees and can press "Clear for website" (the same gate as the three existing buttons; `HydrationGate` as theirs). *Neighbours:* the only string naming the remedy is `copy.ts:108-109`; `reader-derive.test.ts:55` asserts the old words and is a modify target.

#### R-c. The off-warning counts designations, not photos (QA (c))

**Ruling: count distinct photos; the strings do not change.** One headshot chosen for the directory and cleared for, or chosen for, the website is one photo, and "1 photo is currently chosen for the directory or the website" is true. Reworking the noun ("photo choices") would make the warning describe the table instead of what the church knows.

- `reader.ts:74` `countPhotoDesignations(tx)` is renamed **`countChosenPhotos(tx)`** and counts `count(distinct person_photo_designations.photo_id)` over the same join and filter (`ended_at is null`, `removed_at is null`) in the transaction's organization. Importers to update: `src/lib/org-feature-warnings.ts:5,32,65`, `src/lib/org-feature-warnings.photos.test.ts:6,18`, `src/lib/person-photos/public-photo.db.test.ts:337,342` (and its title), and any `scan.test.ts` name reference.
- `offWarningCopy(count)` and `OFF_WARNING_FALLBACK` (`copy.ts:73-84`) are unchanged: the singular and plural forms already exist ("{n} photo is ..." / "{n} photos are ..."), now fed the right number. The doc comments at `reader.ts:64-73` and `org-feature-warnings.ts:30-33` say "active designations on live photos" and become "distinct photos with an active designation".

**Copy checks.** *Residuals:* unchanged (cached-copy sentence, "nothing is deleted"). *Source of truth:* the distinct `photo_id` of active designations on non-removed photos in this organization, worded "chosen for", never "shown" (a hidden or under-18 photo is still chosen). *Audience:* the `org_features.manage` holder at `/admin/features`; the string instructs nothing. *Neighbours:* `org-features.ts:207` (the toggle's description) says "choose the photo members see in the directory"; true, unchanged.

### Tests the implementer adds (each fails on the current strings or code; written red first)

| # | File | Exact assertion |
|---|---|---|
| T1 | `consequences.test.ts` | A table of `(state, intent) -> toEqual([...exact sentences])` taking the sentences from R-a4 literally, covering: listed and no website photo, ticked (the new `directoryAlsoOnWebsite` text), `websiteListed` text, `minor` (each of the three designate intents returns `[minorBlocked(first)]` on designate and the removal and un-designate rows are unchanged for minor except `removeIsWebsiteWithheld` and `websiteShowsNone`), `directoryWithheld: "hide_photo"`, `websiteWithheld: "hide_photo"` and `"merged"`. The existing rows that assert the old text ("will also appear", `consequences.test.ts:46` and the like) are updated to the new text. |
| T2 | `consequences.test.ts` | A property test over the full product of `{listed, website, directory (none, unattested, attested), minor, directoryWithheld, websiteWithheld} x {all five intents}`: no returned sentence matches `/will (also )?appear/`; and no returned sentence matches `/will (also )?(appear|use|leave|fall back)/` when `minor` or `websiteWithheld !== null` or `directoryWithheld !== null`, except the three "show no photo" sentences. Plus `directoryPhotoServesWebsite` is `false` for every withheld combination (extending the mirror test at `consequences.test.ts:215`). |
| T3 | `copy.test.ts` | Exact equality of every string in R-a3, R-a5, R-a6, R-a7, R-b2, R-b3, with the **verbatim old strings asserted absent** (`copy.ts:98,99,108-109,142,149,154,166,219` as of 0df93af). |
| T4 | `reader-derive.test.ts` | Replace `:55`'s `toContain("clear the directory photo for the website")` with: `WEBSITE_LINES.unattested` contains `PAGE_COPY.clearForWebsite` as `"Clear for website"` (couples the remedy to the control's label); `statusLines` with `minor: true` and `unattestedDirectoryOnly: true` returns `WEBSITE_LINES.minor(first)`; the SQL-withheld-wins test at `:51-53` stays. |
| T5 | a new DB-backed case in `public-photo.db.test.ts` (or the reader's DB suite) | Fixture rows: (i) a listed adult with a website designation and `person_privacy.hide_photo`: `readPhotoSet(...).set.state` has `websiteWithheld: "hide_photo"` and `directoryWithheld: null` (no directory designation); (ii) with a directory designation too: both `"hide_photo"`; (iii) a merged tombstone with a website designation: `websiteWithheld: "merged"`; (iv) a minor with **no** designation: `state.minor === true` and both withheld fields `null` (pins the zero-row limit stated in the feasibility check). |
| T6 | `designate-dialog.test.tsx` | The directory body renders exactly R-a5; with `state.minor` the confirm button is disabled and the only consequence sentence is `minorBlocked`; with `websiteWithheld: "hide_photo"` and a listed person the website dialog shows `websiteHidden` and **not** `websiteListed`; the `clear` variant: title, body, checkbox verbatim, confirm disabled until ticked, disabled when minor, and on click `designatePersonPhotoAction` is called with `{ photoId, purpose: "directory", attested: true }`. |
| T7 | `photo-grid.test.tsx` | The "Clear for website" button is present exactly on a current directory tile with `directoryAttested: false`; absent on an attested directory tile, on a non-directory tile, and when `state.minor`. The buttons' accessible names for the other tiles are unchanged. |
| T8 | `store.db.test.ts` | Confirm (add only if absent) that designating the same photo for the directory with `attested: true` over an unattested active designation ends the old row and inserts a new one carrying `public_attested_at/by`, one `audit_events` row, and that the active-designation count for the person stays one. |
| T9 | `org-feature-warnings.photos.test.ts` and a DB case | Unit: the mock is renamed `countChosenPhotos`; the existing singular and plural strings stay. DB: one photo with an active directory **and** an active website designation (attested) yields `countChosenPhotos(tx) === 1` (the old function returns 2), and the rendered title and description for that count are `"1 photo is currently chosen for the directory or the website. Turning this off hides it everywhere, ..."`. A second case: two photos, one of them doubly designated, returns 2. |
| T10 | e2e (`e2e/person-photos.spec.ts`) | Existing assertions on changed strings are updated: `:160` and `:290` become `Directory: no photo chosen, so members who can see {first} in the directory see initials.`; `:178` becomes `Directory: members who can see {first} in the directory see the photo marked "Directory" below.`; `:282` becomes `It is {first}'s directory photo, so wherever {first} appears in the directory it will show initials instead.` New flow: an unattested directory photo for a person with no website photo shows the new remedy line; click "Clear for website", tick the box, confirm; the page then shows `Website: the directory photo, because it was cleared for the website.` and the tile's chip reads `Directory, cleared for website`; at 360 and 1280 px, the dialog fits and its buttons are at least 44 px. |
| T11 | e2e (`e2e/hydration/person-photos-upload.spec.ts:92-100`) | The `seedPhoto` directory photo is unattested, so its tile now has a fourth button: add `Clear for website` to the list of controls asserted disabled before hydration (and enabled after). |

**e2e blast radius, named (existing specs this change alters):** `e2e/person-photos.spec.ts:160,178,282,290` (strings), `e2e/hydration/person-photos-upload.spec.ts:92-100` (a new control on the tile), and the unit specs `consequences.test.ts`, `copy.test.ts`, `reader-derive.test.ts`, `designate-dialog.test.tsx`, `photo-grid.test.tsx`, `page.test.tsx:85` (the directory line string), `org-feature-warnings.photos.test.ts`, `public-photo.db.test.ts:337-342`. **Feature flags these specs depend on:** none new. Every spec above sets `org_portal.person_photos` for its organization through the existing photo fixture and `e2e/support/flags.ts`; no platform flag is read, none is added to `scripts/ci/e2e-baseline-flags.sql`.

### Implementation order

1. `types.ts` and `consequences.ts` (snapshot fields, the derivation, the intent table): T1, T2 red first.
2. `copy.ts` (every string in R-a, R-b, R-c): T3, T4 red first.
3. `reader.ts` (fill the three fields, rename the count, `statusLines` minor input) and `org-feature-warnings.ts`: T5, T9 red first.
4. `tile-controls.tsx`, `designate-dialog.tsx` (third variant, disabled-on-minor, `body(name, first)`): T6, T7.
5. e2e updates and the new flow: T10, T11.
6. Release notes: the C9 draft needs no change (it says photos are not shown for under-18 or hidden photos and mentions no "will appear"); add one clause only if the orchestrator wants the new button announced: "A directory photo that was not cleared for the website can be cleared later from the photo's own buttons."

No audit-event change: the clear action is the existing designate action (`person_photo.designated`, with its attestation fields). No schema, no new route, no server-action signature change.

### Edge cases

| Case | Handling | Pinned by |
|---|---|---|
| Person has no designation and has hidden their photo | The dialog cannot know (SQL returns no row); it shows the hedged "can appear ... unless something withholds it" sentence, true in that state | T1, T5(iv) |
| Person is under 18 with existing photos | Designate dialogs show `minorBlocked` and a disabled confirm; un-designate and remove stay available (Batch 2: never refused for a minor) | T1, T6 |
| `directory_hidden` or ended member | Directory lines and the two retroactive strings are conditional on who can see the person | T3, T10 |
| Stale page: the directory photo was cleared by someone else, then "Clear for website" is clicked | The action re-designates the same photo as attested; idempotent (Batch 2 deviation 6: same photo and same attestation writes nothing); the page refreshes | T8 |
| Photo removed by someone else, then cleared | `already_removed`, existing message | existing U8 |
| Two simultaneous clears | Advisory lock serializes; the second is the same-state no-op | T8 |
| "Clear for website" label at 360 px | Full-width, min-h-11, like its siblings; no horizontal scroll | T10 (claim *unverified* until it runs) |
| Consent withdrawn by the person | No dedicated control; today stop-then-choose-unticked | *deferred*, see carry-forward |

### Out of scope (the operator confirms)

A control to **withdraw** a website clearance without stopping the directory photo; reading site publication status or the `sites.*` flags into the dialogs; reading directory eligibility (`directory_hidden`, roll status) into the page; a new SQL function returning withheld reasons when no designation exists; success toasts for designate, un-designate and remove (QA: UX for Phase 6, not a copy defect).

### Carry-forward (this amendment)

| Item | Addressed here, or *deferred* |
|---|---|
| QA (a): "will appear" ignores withheld, hide_photo, merged, unpublished site | R-a1 to R-a5, T1, T2, T5, T6. Unpublished site and `sites.*` flags: the sentences say "while the website is published" and are not claimed as read (Out of scope). |
| QA (b): remedy with no control | R-b1 to R-b4, T4, T6, T7, T10, T11. |
| QA (c): count of designations | R-c, T9. |
| QA note: `copy.ts:98` false for `directory_hidden` or ended | R-a7 (wording, not data), T3, T10. |
| QA observation 1: shared scratchpad name collisions between parallel QA agents | *Deferred* to the orchestrator (per-agent scratch names); not a design item. |
| QA observation 2 / Batch 2 deviation 7: the adapter's double-submit dedup race (`blob-store.ts` check-then-insert; a simultaneous double submit surfaces `23505` as a generic failure) also affects the **logo** and **ticket** attachment paths | **TODO candidate for `docs/TODO.md`** (not edited here, Rule 16 shared file): "Blob adapter `store()` check-then-insert races on a simultaneous double submit; person photos retry once on `23505` (`store.ts`), logo and ticket paths do not. Fix once in `blob-store.ts` (insert ... on conflict, or retry inside the adapter) and drop the per-caller retry. Found by D1 (Batch 2 deviation 7), re-raised by Phase 5 run 1." Owner: orchestrator at integration; accepted by: none yet (needs the operator to place it). |
| TODO candidate (new): withdraw a website clearance without losing the directory photo | **Deferred** to a follow-up increment; accepted by: none yet (operator to confirm Out of scope). Consent withdrawal today is stop-then-choose-unticked, and the C5 dialogs say what happens at each step. |
| Phase 1 G4 (consent matrix), G9 (honest dialog copy), G16 (stale copy), G17 (360 px, native dialogs) | Re-opened and addressed above; every other Phase 1 gap and Phase 2 ruling is unchanged from the Carry-forward table in this document, and none of R-a, R-b, R-c touches it (no schema, flag, route or permission change). |
| Proposed decision text, for the orchestrator to number at integration (the pre-assigned 285-289 are spent) | "Consequence sentences state only what the snapshot's queries establish: they say *can* with a named unless-clause where a withheld reason is unknowable without a designation, and `PhotoStateSnapshot` carries `minor`, `directoryWithheld` and `websiteWithheld`. The remedy on the page must name a control the page has. The off-warning counts distinct photos." |
| Findings for the orchestrator to number | (1) the design's Copy check 2 passed C4 on the listing read alone while the snapshot lacked withheld; (2) the public-photo and directory functions start from the designation, so withheld is invisible without one (a documented limit, not a defect); (3) C1's count source counted rows, not photos. |

### Per-Phase Status row (recorded in the table at the top)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — amendment (Phase 5 run 1 copy rulings) | tech-lead | Complete: rulings R-a (withheld-aware consequences, snapshot carries `minor`, `directoryWithheld`, `websiteWithheld`), R-b (new "Clear for website" control and dialog variant), R-c (count distinct photos); 11 tests T1-T11 named; implementer full-stack-developer; no schema, route, flag or permission change | Design complete; back to Phase 4 | 2026-10-26 |

---

## Phase 4 — Phase 5 run 1 fix (copy)

**Author:** full-stack-developer, 2026-10-26. **Trigger:** Phase 5 run 1 FAIL on copy truthfulness (a), (b), (c) and the `copy.ts:98` note; spec is the Phase 3 amendment above. **Tree:** `pipeline/person-photos`, worktree `presby-photos`, Neon `pipeline-person-photos`. No schema, route, action signature, flag, permission or audit change.

### Operator ruling recorded

The amendment's deferred carry-forward item "a control to **withdraw** a website clearance without losing the directory photo" (marked "accepted by: none yet, operator to confirm Out of scope") is **closed as out of scope**. Operator, 2026-10-26: "no. we don't need to worry about that right now." Not built; consent withdrawal remains stop-then-choose-unticked, which the dialogs describe at each step. No TODO line is owed for it.

### Changes

- `src/lib/person-photos/consequences.ts`: `PhotoStateSnapshot` gains `minor`, `directoryWithheld`, `websiteWithheld`. `consequencesFor` follows R-a4 exactly (minor returns `[minorBlocked]` for both designate intents; `directoryHidden`, `websiteHidden`/`websiteMerged`; `removeIsWebsiteWithheld`; `websiteFallsBack` only when nothing withholds). `directoryPhotoServesWebsite` gains the withheld conditions.
- `src/lib/person-photos/copy.ts`: every replacement string of R-a3, R-a5, R-a6, R-a7, R-b2, R-b3 verbatim; `DIRECTORY_LINES.shown/none` are now functions of `first`; `DESIGNATE_COPY.directory.body(name, first)`; `DESIGNATE_COPY.clear`; `PAGE_COPY.clearForWebsite`. Header comment records the "can ... unless something withholds it" rule.
- `src/lib/person-photos/status-lines.ts`: `websiteLine`/`statusLines` take `minor`; the unattested remedy becomes the under-18 line for a minor (R-b4).
- `src/lib/person-photos/reader.ts`: fills the three snapshot fields from answers already read (no new query); `countPhotoDesignations` renamed `countChosenPhotos`, now `count(distinct photo_id)`. `src/lib/org-feature-warnings.ts` updated; strings unchanged.
- `tile-controls.tsx`: "Clear for website" button (current directory photo, not attested, not minor), above "Use on website". `designate-dialog.tsx`: third variant via a `clear` prop (purpose stays `"directory"`, confirm needs the box); every variant's confirm is disabled when `state.minor` (R-a8). `photo-grid.tsx` passes `directoryAttested`.

### Deviation to confirm (no string involved)

R-a2 gives `directoryPhotoServesWebsite` as `attested && website === null && listed && !minor && websiteWithheld === null`. T2 requires it to be false for **every** withheld combination, including `directoryWithheld`. `hide_photo` is person-level, so a directory `hide_photo` withholds the website photo too. I added `directoryWithheld === null` to that predicate, to the `websiteFallsBack` condition and to the `removeIsWebsiteWithheld` condition (via one helper, `websiteIsWithheld`). In reachable data it changes nothing (a website designation or attested directory photo would also have returned `websiteWithheld`); it only makes T2 true over the full product.

Also: T8 needed no new test. `store.db.test.ts` ("the same photo with a changed attestation takes the same path (end, insert)") already asserts the old row ends, a new attested row is the only active one and the audit row carries `attested: true`; it passes.

### Failing-first evidence

Tests were written and run against the unchanged source first. Output kept in the scratchpad `photos-fix/` (`red-all.txt`, `red-db.txt`).

| Test | Red against old code |
|---|---|
| T1, T2 `consequences.test.ts` | 34 failed (new snapshot fields absent; old "will also appear" text; T2 product found `will appear`) |
| T3 `copy.test.ts` | 8 failed (old strings present, new keys absent) |
| T4 `reader-derive.test.ts` | suite failed to load (`DIRECTORY_LINES.shown` not a function) |
| T6 `designate-dialog.test.tsx`, `confirm-dialogs.test.tsx` | 10 + 2 failed |
| T7 `photo-grid.test.tsx` | 3 failed (no "Clear for website" button) |
| T9 unit `org-feature-warnings.photos.test.ts` | 4 failed (mock renamed to `countChosenPhotos`) |
| T5, T9 DB `public-photo.db.test.ts` | by mutation of `reader.ts` (count back to `count()`, withheld fields forced null): 3 failed (T5 snapshot case; both count cases). `reader.ts` restored from a copy; no `git stash` used |
| T10, T11 e2e | inherently red on the old tree: the "Clear for website" button and the new strings did not exist. Not run against the old tree |

Totals for the red run of the unit files: 7 files failed, 61 tests failed, 172 passed. All green after the fix.

### Commands and results (all in the worktree)

- `npm run typecheck`: pass. `npm run lint`: pass (0 warnings). `npm run check`: all eight tripwires pass.
- `rm -rf .next && npm run build`: pass.
- `npm test`: 652 files passed, 96 skipped; 9,936 tests passed.
- DB-backed, serial (`npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/person-photos src/lib/db/domain/person-photos.db.test.ts src/lib/db/domain/public-roster-photo.db.test.ts "src/app/(org)/o/[slug]/admin/community" src/lib/org-feature src/lib/storage"`): 62 files, 1,135 tests passed. `public-photo.db.test.ts` and `store.db.test.ts` alone: 51 passed.
- Own dev server on :3620 (`AUTH_URL`/`E2E_BASE_URL` :3620, `RATE_LIMIT_DISABLED=true`, `E2E_ALLOW_SHARED_DB=true`, `CRON_SECRET` and the domains fakes for global setup), chromium project: `e2e/person-photos.spec.ts` (360 px and 1280 px upload flow with the new step 4b, E4, toggle-off) and `e2e/hydration/person-photos-upload.spec.ts`: 5 passed.
- Prod lane, `PW_PROD_BUILD=1 PW_PROD_PORT=3621`, `--project=prod-build e2e/hydration/person-photos-upload.spec.ts`: 1 passed (the hydration spec gained the fourth control).
- Servers stopped by PID; :3620 and :3621 confirmed free. The full e2e suite and the custom-hosts roster spec were not re-run (unchanged files, QA's scoped re-run).
- 360 px walk (scratch spec, deleted, never committed; screenshots in `scratchpad/photos-fix/`): `hidden-page-360.png`, `hidden-dialog-360.png` (website dialog says the website won't show it, no "can appear"), `minor-page-360.png`, `minor-dialog-360.png` (blocked sentence, confirm disabled), `clear-page-360.png` (remedy line names the button; four buttons), `clear-dialog-360.png` (fits the viewport, confirm above cancel, 44 px). No horizontal overflow in any state.

### Notes for QA

- Observed, not changed: under 18, the directory dialog still shows the permission checkbox above the blocked sentence (the confirm is disabled, so nothing can be recorded).
- `docs/TODO.md`, `docs/decisions.md` and the other Rule 16 files were not touched; the amendment's proposed decision text and the double-submit TODO candidate remain for the orchestrator.
- Handoff: qa, scoped Phase 5 re-run (copy, consequences, photos page specs, the 360 walk).

---

## Phase 3 — ruling on fix-pass deviation

**Author:** tech-lead, 2026-10-26. **Trigger:** the implementer's "Deviation to confirm" and "Notes for QA" in the Phase 4 fix pass (commit 72f32c1). Read against the live tree (consequences.ts, reader.ts:265-266, `drizzle/0078_presby_person_photos.sql:381-404`, `designate-dialog.tsx:76-134`). No string, schema, route, flag or permission is touched by either ruling.

### Ruling 1: `directoryWithheld === null` added to the website-withheld predicate. CONFIRMED.

R-a2 omitted it; the omission was mine, and T2 (every withheld combination, `directoryWithheld` included) is the correct requirement. The implementer's `websiteIsWithheld(state)` helper (`minor || websiteWithheld !== null || directoryWithheld !== null`) is now the single predicate behind `directoryPhotoServesWebsite`, the `websiteFallsBack` branch of `undesignate_website`, and the `removeIsWebsiteWithheld` branch of `remove`. Verified:

- **Why it is right, not only harmless.** `hide_photo` is person-level. The website core (`presby_person_public_photo`, 0078:403) joins `person_privacy` on `person_id` alone; the directory function scopes it to the organization. So any `hide_photo` the directory answer reports is also one the website core would report, and the website is withheld too. The helper says so in its comment.
- **Reachable data is unchanged, as the implementer says.** The core returns a row (with `withheld`) whenever a candidate exists: a website designation or an attested directory designation (0078:386-396). Every place the helper matters (attested directory, no website photo; or a website photo present) has such a candidate, so `websiteWithheld` would already be `hide_photo`. The extra term only matters in the product T2 enumerates, and there it is the right answer (fail closed). It also covers a stale read where the two SQL calls straddle a `hide_photo` change.
- **The three consumers read correctly.** `undesignate_website` falls back only when `directory.attested && !websiteIsWithheld`, otherwise "will show no photo", which is true. `remove` uses `removeIsWebsiteWithheld` whenever the website is withheld for any reason, which is true. No sentence is added or removed; R-a3's strings and R-a4's table are otherwise followed.
- **Amendment text superseded.** R-a2 and the `undesignate_website` and `remove` lines of R-a4 read, from here on, "... `!minor && websiteWithheld === null && directoryWithheld === null`" (the `websiteIsWithheld` helper). The implementation is the spec; no code change.

T8: agreed that the existing `store.db.test.ts` case covers it; no new test owed.

### Ruling 2: the under-18 directory dialog still shows the permission checkbox above the blocked sentence. ACCEPTED, as a tracked follow-up, not a change to this pass.

Reasons: (a) nothing can be recorded: the confirm is disabled by `state.minor` (`designate-dialog.tsx:134`), and the store refuses a minor, so no false record or consent can result; (b) the blocked sentence ("... appears to be under 18, so a photo of {first} can't be chosen for the directory or the website yet.") is in the dialog and says why, so no string is untrue (copy check 1 holds: no residual is denied); (c) the checkbox text is a statement of a permission the user would be giving, which is not false for an under-18 subject; it is only pointless; (d) QA's scoped re-run is next on this tree, and a source change now would invalidate the verification already prepared for one cosmetic improvement.

The honest improvement is to not render the checkbox (and the disabled confirm's affordance) when `state.minor`, so a tick box never invites a step that cannot work. It adds no string and is about three lines plus one test in `designate-dialog.test.tsx`. **Carry-forward, tracked:** TODO candidate for the orchestrator to land at integration (Rule 10): "Photos designate dialogs: hide the permission checkbox when the person appears to be under 18 (the blocked sentence stays; confirm is already disabled). `designate-dialog.tsx`. Raised by tech-lead 2026-10-26, accepted by tech-lead; operator to confirm priority." If QA's re-run or the operator treats the dead-end tick box as a defect rather than polish, it returns to the implementer as a three-line change with no Phase 3 re-entry.

### Carry-forward (this ruling)

| Item | Where addressed |
|---|---|
| Implementer deviation: `directoryWithheld` in the website-withheld predicate | Confirmed (Ruling 1) |
| Under-18 dialog shows checkbox above the blocked sentence | Accepted by tech-lead; TODO candidate above; operator to confirm priority |
| Withdraw-clearance control | Closed out of scope by the operator, 2026-10-26 (recorded in the Phase 4 fix section) |
| Double-submit TODO candidate (Phase 4 fix section) | Unchanged; orchestrator at integration |

### Per-Phase Status row (recorded in the table at the top)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — ruling on fix-pass deviation | tech-lead | Complete: `websiteIsWithheld` helper confirmed (covers `directoryWithheld`; no reachable-data change; T2 satisfied); under-18 checkbox accepted with a TODO candidate; no code change | Confirmed; back to Phase 5 (scoped re-run) | 2026-10-26 |

---

## Phase 5 — Verification (qa), run 2

**Verdict: FAIL.** Copy truthfulness is the only failure, and it is one sentence. Everything run 1 asked for is fixed and verified. All 19 ruled strings are verbatim, the new exact-text tests fail on 9a90c28, and the walk at both widths confirms the fixes. Every gate, suite and e2e lane I ran is green. The failing sentence predates run 1: the remove dialog tells an admin a photo "will leave the public website" for a person the page itself says is not listed there. I passed C5 in run 1 and missed it then.

**Date:** 2026-10-26
**Verified by:** qa
**Tree:**
- Code verified at `pipeline/person-photos` @ 0684ace, worktree `/Users/cshenso/git/presby-platform/presby-photos`, Neon `pipeline-person-photos`.
- HEAD has since moved to 0eca1ec, a tech-lead ruling that touches only the work-log (`git diff --stat 0684ace..HEAD`: 1 file, the work-log). The worktree is clean after the run.

**Scope (`git diff 9a90c28..HEAD --stat`):** 20 files, all under person photos:
- `copy.ts`, `consequences.ts`, `status-lines.ts`, `reader.ts`
- `org-feature-warnings.ts`
- three photo components
- their tests and two e2e specs
- the work-log

It touches no migration, `authz.ts`, `src/lib/db/`, `src/proxy.ts`, `src/auth.ts`, layout, `e2e/support/`, shared component, route or server action. So no full DB or e2e suite was owed.

**Ran:**
- typecheck, lint, `npm run build` (after `rm -rf .next`), `npm run check`
- the unit suite
- the person-photos DB tests, serially
- independent failing-first checks: HEAD's tests against 9a90c28's source, plus mutations of HEAD
- e2e on my own server at :3620: the chromium photo specs and the custom-hosts roster spec
- the prod lane on :3621
- a browser walk at 360 and 1280 px

Global flags were reset to the CI baseline before the e2e run (`scripts/ci/e2e-reset-flags.sql`, `-v pipeline_branch=1`; COMMIT, 10 baseline keys).

**Not re-run (run 1's results stand):**
- the full `test:db`
- RLS 78/72 and the full `test-rls.sql`
- D4
- the full chromium and custom-hosts e2e suites
- the full prod lane
- the DB mutation set and the live-catalog probe

**Still open, not blocking this verdict:**
1. The real-iPhone HEIC check (48 MP HEIC, 12 MP library JPEG; edge case 24). The operator owes this.
2. The Vercel linux `sharp` trace (edge case 26). Due at the PR preview, deployment-engineer.

## Type Check

- `npm run typecheck`: PASS
- `npm run lint`: PASS (0 warnings)
- `rm -rf .next && npm run build`: PASS
- `npm run check`: 8 of 8 tripwires pass.

## Unit Tests

- **Unit suite:** 9,936 passed, 0 failed, 37.1 s. 652 files passed; the 96 skipped files are the DB-backed set, which skips without env, the same as run 1. No other skips.
- **Person-photos DB tests**, serial (`--no-file-parallelism`; `src/lib/person-photos`, `person-photos.db.test.ts`, `public-roster-photo.db.test.ts`, `src/lib/org-feature-warnings*`): 12 files, 253 passed, 0 failed, 0 skipped.

## End-to-End Tests

| Lane | Specs | Result |
|---|---|---|
| Dev (:3620, my server, `AUTH_URL` and `E2E_BASE_URL` on :3620), `--project=chromium` | `e2e/person-photos.spec.ts` (360 and desktop, including the new step 4b "Clear for website" flow; E4; toggle-off) and `e2e/hydration/person-photos-upload.spec.ts` | 5/5 passed, 1.5 min. E4 document 236,260 bytes |
| Dev, `--project=custom-hosts` | `e2e/custom-domains/person-photos-roster.spec.ts` | 2/2 passed, 14.4 s |
| Prod (`PW_PROD_BUILD=1`, `PW_PROD_PORT=3621`), `--project=prod-build` | `e2e/hydration/person-photos-upload.spec.ts` (the fourth control is disabled before hydration) | 1/1 passed, 28.3 s |

There were no skips and no retries. I stopped the dev server by PID (99591 and its child 99610) and confirmed :3620 free. Playwright owned and stopped the :3621 server, and the port is free.

**Browser walk** (a scratch script against its own fixture org with a live site and a live custom host `qa-photos-r2.invalid`; synthetic images; text identical at 360 and 1280 px; no horizontal overflow; no native dialogs; every dialog fits the viewport; fixture fully torn down, leftover 0/0/0; flags restored):

- **Unattested directory photo, listed person:**
  - The remedy line names the button, and the tile carries "Stop using in directory / Clear for website / Use on website / Remove".
  - The "Clear for website" confirm is disabled until the box is ticked. Ticked, the dialog shows the hedged "can also appear … unless something withholds it" sentence.
  - After confirming, the page reads "Website: the directory photo, because it was cleared for the website." and the chip reads "Directory, cleared for website". The button is gone.
  - The custom-host roster then serves the photo: the `img` src carries the image key and the image loads.
- **The same photo also chosen for the website:** the database holds 2 designation rows on 1 distinct photo. The Features page off-warning reads "1 photo is currently chosen for the directory or the website. Turning this off hides it everywhere…". I pressed "Keep it on" and the toggle stayed on.
- **Hidden photo (listed, website photo, `hide_photo`):**
  - The page reads "Website: not shown, because Hidwalk has hidden their photo."
  - The website dialog shows `websiteHidden` and not `websiteListed`. The ticked directory dialog shows `websiteHidden`.
  - Remove shows `removeIsWebsiteWithheld`. Stop-using shows `websiteShowsNone`.
- **Minor (age 9, existing unattested directory photo):**
  - Both lines are the under-18 lines, and the remedy is suppressed (R-b4).
  - The directory tile has no "Clear for website".
  - Both designate dialogs show only `minorBlocked`, and the confirm stays disabled even after ticking.
- **Unlisted person with a website photo:** this is the defect below.

## Regression Tests Added

This is a fix pass under a feature, so I confirmed failing-first independently instead of taking the implementer's word for it.

**HEAD's tests against 9a90c28's source** (a `git archive` scratch copy, since deleted):
- 7 of 11 files failed; 61 tests failed, 172 passed. This matches the implementer's 61.
- `consequences.test.ts`: 34 failed. `copy.test.ts`: 8 failed, including "the old strings are gone".
- `designate-dialog.test.tsx`: 10 failed. `confirm-dialogs.test.tsx`: 2. `photo-grid.test.tsx`: 3.
- `org-feature-warnings.photos.test.ts`: 4 failed. `reader-derive.test.ts` fails to load.
- `page.test.tsx` passes on both trees. Its change is fixture shape only.

**DB tests (T5, T9), by mutating `reader.ts`** in a scratch copy of HEAD (since deleted), running `public-photo.db.test.ts` each time:

| Mutation | Killed by |
|---|---|
| `countDistinct` → `count(*)` | 2 failed: the DISTINCT count case and "one photo chosen for both … is ONE photo" (T9) |
| `minor: false` | T5 snapshot case |
| `directoryWithheld: null` | T5 |
| `websiteWithheld: null` | T5 |

**Two TypeScript mutations:**

| Mutation | Killed by |
|---|---|
| Drop `directoryWithheld` from `websiteIsWithheld` | 2 T2 tests |
| Drop `!state.minor` from the "Clear for website" render gate | `photo-grid.test.tsx` "absent when the person appears to be under 18" |

Every mutation was killed. T8 needs no new test: the existing `store.db.test.ts` case for a changed attestation passed in the DB run.

**Gap:** no test covers `remove` of a website photo for an unlisted person. The `consequences.test.ts:189-200` rows that expect `removeIsWebsite` all use `listed: true`. This is the test the FAIL below needs.

## Coverage on Critical Modules

Not measured. The diff touches none of `permissions.ts`, `two-factor.ts` or `flags.ts`.

## Feature-Gate Audit

No protected route or server action was added or changed. `actions.ts` and every `route.ts` are absent from the diff.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| "Clear for website" (new control) → existing `designatePersonPhotoAction` `{ purpose: "directory", attested: true }` | yes (unchanged since run 1's audit) | n/a: tenant axis, `people.manage` plus toggle, membership and the adult re-check in `store.ts` `gate()` | n/a |
| Features page off-warning (count source renamed `countChosenPhotos`) | yes (unchanged) | n/a: `org_features.manage`, unchanged | n/a |

**Render gate vs permission:**
- The button appears only on a page `readPhotoSet` has gated on `people.manage`, which is the same check the action makes.
- It is hidden for a minor, where the store would refuse.
- It sits inside the same `HydrationGate` as its siblings, and the prod-lane hydration spec proves it is disabled before hydration.
- A merged record is not refused by the store, so the instruction is performable there too. The result reads "not shown, because merged", which is true.

## Copy Truthfulness

- [x] Every added or changed string is in the design's Copy table. I checked all 19 programmatically against the amendment's R-a3, R-a5, R-a6, R-a7, R-b2 and R-b3 text: 19 of 19 are verbatim. The diff has no inline `.tsx` strings and no release-note or email lines.
- [x] The query behind each claim was opened, and what it does not read was named:
  - `presby_person_public_photo` reads `hide_photo` on `person_id` alone and returns rows only for a website or attested directory candidate.
  - `presby_person_directory_photo` scopes `hide_photo` to the org and returns rows only with a directory designation.
  - Neither reads site publication, `sites.*`, `directory_hidden` or listing.
  - Listing comes from `listingsOf` (`reader.ts:97`).
- [x] Each instruction was traced to the role that sees it, and that role can do it. The `WEBSITE_LINES.unattested` remedy now names a control the `people.manage` viewer has (above). The off-warning instructs nothing.
- [ ] Older strings about the same subject were grepped for, and none is made false. **One is false in a reachable state** (below).

**copy truthfulness: FAIL**

**(d) The remove dialog says an unlisted person's website photo "will leave the public website".**
- **Viewer:** a `people.manage` holder on `/o/<slug>/admin/community/<id>/edit/photos`.
- **Where:** `/Users/cshenso/git/presby-platform/presby-photos/src/lib/person-photos/consequences.ts:136` chooses `copy.ts:182` ("It is also their website photo, so it will leave the public website.") whenever `isWebsite && !websiteIsWithheld(state)`. It never reads `state.listed`, which the snapshot carries.
- **Reached by normal use:** choosing a website photo for an unlisted person is an ordinary flow. The website dialog's `websiteNotListed` sentence exists for exactly that case.
- **Reproduced at 360 and 1280:**
  - The page reads "Unlisted isn't listed on your public website, so no photo shows there."
  - The Remove dialog on that same page reads "It is also their website photo, so it will leave the public website."
  - That is the same contradiction class as run 1's (a), in the opposite direction: it over-states exposure rather than promising it.
- **Same sentence, publication state:** it is also untrue for a listed person whose organization has no published site. The snapshot does not read publication, which the amendment's own rule calls for hedging.
- **Likely fix (tech-lead's call, because R-a4's `remove` row is design text):** use the existing `removeIsWebsiteWithheld` ("…which the website isn't showing at the moment.") when `!state.listed` as well. It is true for an unlisted person, and no new string is needed. Hedge or condition the listed case for publication.
- **Test owed:** a `consequences.test.ts` row (`listed: false`, website photo, remove) and a `confirm-dialogs.test.tsx` case asserting `removeIsWebsite` is absent. Both fail on 0684ace.
- **Neighbour, same subject:** `websiteStops` (`copy.ts:172`, "The website will no longer use this photo.") is reached in the same unlisted state. It reads as the page's selection model ("Website: the photo marked "Website" below."), so I do not cite it as false. Rule on it in the same pass.

**Run 1's items, verified fixed:**
- **(a)** No sentence says "will appear" in any state: T2 covers the full product, and the walk confirms it. Withheld states show `directoryHidden`, `websiteHidden`/`websiteMerged`, `minorBlocked` and `removeIsWebsiteWithheld`. The directory dialog body carries the unless-clause.
- **(b)** The remedy line names "Clear for website", and the control exists on exactly the unattested, non-minor directory tile. It works end to end, through to the website roster.
- **(c)** The off-warning counts distinct photos: one photo used twice reads 1.
- **`copy.ts:98` note:** the directory lines and both retroactive strings are now conditional on "members who can see {first} in the directory".

**Notes (not failures):**
1. **The clear dialog does not use the withheld helper.** Take a listed person with an unattested directory photo who has hidden their photo at this org. Ticked, the "Clear for website" dialog shows `directoryHidden` and then the hedged `directoryAlsoOnWebsite` ("can also appear … unless something withholds it, such as {first} hiding their photo"). That is true, and it is what R-a4 specifies. But the page knows the website is withheld: an org-scoped `hide_photo` implies the website core's person-wide one. Tech-lead's Ruling 1 says every place the helper matters has a candidate row. The `designate_directory` attested branch (`consequences.ts:92-99`) is not one of its consumers, and it could use `websiteIsWithheld(state)` to say `websiteHidden` instead. The page also still shows the unattested remedy line in this state. That is accepted under R-b4 and still true (the photo is not cleared), but here `hide_photo` is known through the directory row, contrary to R-b4's premise.
2. **Under-18 checkbox:** the checkbox shows above `minorBlocked` with the confirm disabled. I observed it at both widths. Tech-lead Ruling 2 accepted it as a TODO candidate. It is not false, and I agree it is polish.
3. **Touch targets:**
   - Dialog buttons measured 42 px only at the instant of opening, during the zoom-in animation. Settled, they are 44 px or more, and the e2e polls this and passes.
   - Two targets are pre-existing and not in this diff: the Features page AlertDialog's "Keep it on" and "Turn it off" buttons (34 px measured mid-animation, about 36 px settled, `features-list.tsx`), and the dialog close icon (about 16 px, shared primitive).

## Verdict

**FAIL: copy truthfulness, item (d) only.** The fix is one predicate in `consequences.ts:136` plus a test row. Because the sentence choice is R-a4 design text, it goes to tech-lead for a brief ruling, then to full-stack-developer.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification, run 2 (scoped) | qa | Complete:<br>• typecheck, lint, build, check 8/8<br>• unit 9,936/9,936; person-photos DB 253/253 serial<br>• e2e dev 5/5 chromium + 2/2 custom-hosts; prod 1/1; flags reset to the CI baseline first<br>• failing-first confirmed independently: 61 red on 9a90c28; 4 DB and 2 TS mutations killed<br>• 19/19 strings verbatim; run 1 (a), (b), (c) and the `copy.ts:98` note fixed; walk at 360/1280 clean (Clear for website reaches the roster; warning reads 1)<br>FAILED on copy truthfulness (d): `removeIsWebsite` ("will leave the public website") is shown for an unlisted person (`consequences.ts:136`, `copy.ts:182`). Still open: real-iPhone HEIC (operator), Vercel linux `sharp` trace (PR preview) | FAIL | 2026-10-26 |

**Handoff:**
1. **tech-lead (Phase 3, brief):** rule the `remove` row of R-a4 for `!listed`. The existing `removeIsWebsiteWithheld` text fits. Decide whether to hedge `removeIsWebsite` for publication, and rule on `websiteStops` in the same state. Optionally route the `designate_directory` attested branch through `websiteIsWithheld` (note 1).
2. **full-stack-developer (Phase 4):** the predicate change, plus the `consequences.test.ts` and `confirm-dialogs.test.tsx` rows, written red first against 0684ace.
3. **qa:** a scoped re-run covering the consequences unit files, `confirm-dialogs`, and the remove-dialog walk for an unlisted person at 360 and 1280. Nothing else needs re-running unless the fix widens.

My evidence (logs, the walk script, `results.json` and screenshots) is in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa-photos-r2/`. The scratch source copies there have been deleted, including the copied `.env.local`.

---

## Phase 3 — amendment (Phase 5 run 2)

**Author:** tech-lead, 2026-10-26. **Trigger:** Phase 5 run 2, FAIL on copy truthfulness item (d) only, plus QA note 1 and the `websiteStops` question. **Class:** a Phase 3 copy defect; the failing sentence is the design's own R-a4 `remove` row, so the fix is a ruling here. **Phase 2 skip:** no dependency, table, route, action, flag, permission or schema change; no architect pass. **Implementer:** **full-stack-developer** (same reasons as the run 1 amendment: one snapshot type, pure copy and consequence files, one status-lines file, and tests on both sides; splitting adds a handoff). Read against the live tree at c225091 (`consequences.ts`, `copy.ts`, `status-lines.ts`, `reader.ts`, `0078_presby_person_photos.sql:381-470`).

### Root cause

R-a4 routed `remove` of the website photo to `removeIsWebsite` ("so it will leave the public website") whenever nothing in `websiteIsWithheld` applied. That predicate covers SQL's withheld answers. It does not cover the two gates the SQL core does not apply: **listing** (the core `presby_person_public_photo` returns the website designation whether or not the person is on a public list; listing is applied by the roster functions) and **publication** (never read). The snapshot carries `listed`, so the first was a defect of the design's own derivation; the second is the "will vs can" rule of run 1 applied to a sentence that run missed. My run 1 sweep grepped for "will appear" and "will see"; this one is by effect verb, below.

### The convention that makes the sweep decidable

Two kinds of verb, and the rule for each (applies to every string in this feature, retroactively):

- **Selection verbs** (use, uses, using, chosen, marked, replaces): describe which photo the designation rows pick. True from the snapshot in every state, including unlisted and unpublished, and consistent with the page's own status lines ("Website: the photo marked "Website" below." is shown to an unlisted person too, beside the listing line). Allowed without a hedge.
- **Effect verbs** (show, appear, leave, be seen, "on the public website" as a place): say what a visitor will see. Allowed only (i) as a negative ("won't show", "will show no photo"), which is true whether or not the site is published, listed or withheld; (ii) hedged with "can" and the unless-clause; or (iii) as "can no longer show", true in every state. A positive, unhedged effect claim is a defect.

### Effect-verb sweep (every consequence, status, listing and dialog sentence; states: listed L / unlisted U, site published P / not N, withheld W (hide, merged, minor), plus a directory-hidden or ended member D)

Grep: `will|leave|stop|show|appear|on the (public )?website|used on` over `copy.ts`, `status-lines.ts` and the five photo `.tsx` files (51 hits in `copy.ts`; the `.tsx` files carry no inline sentences, only the copy imports).

| Sentence (`copy.ts` line, c225091) | Claim kind | Verdict across L/U x P/N x W x D | Disposition |
|---|---|---|---|
| `directoryAlsoOnWebsite` :149 | effect, hedged "can ... while published, unless something withholds it" | true everywhere | keep |
| `directoryWebsiteWillStop` :151 | "is using" selection; "will show no photo" negative | true everywhere (reached only L, attested, no website photo, not W) | keep |
| `directoryWebsiteConditional` :153 | "will be used ... only if" necessary condition | true everywhere | keep |
| `websiteListed` :156 | effect, hedged | true everywhere | keep |
| `websiteNotListed` :158 | "won't appear until they are": negative, but implies listing is sufficient (publication, `hide_photo` with no designation, unknown) | not false; the implicature is | **change (R-d4)** |
| `websiteReplaces` :160 | selection | true | keep |
| `minorBlocked`, `directoryHidden`, `websiteHidden`, `websiteMerged` | negative | true | keep |
| `directoryInitials` :168 | "initials will show instead": true wherever the person appears (no photo after un-designating) | true, D included | keep |
| `directoryAlsoOnWebsiteEnds` :169 | "is also using" selection; "will show no photo" negative | true everywhere | keep |
| `websiteStops` :172 | selection ("will no longer use") | true in every state: the designation ends. It reads as the page's own "Website: the photo marked "Website" below." | **keep (ruling R-d3)** |
| `websiteFallsBack` :173 | "If {first} is listed, ... will use": conditional on L, selection | true everywhere | keep |
| `websiteShowsNone` :175 | negative | true everywhere | keep |
| `websiteCaches` :176 | "can keep showing"; copies "can't be recalled" | hedged; residual preserved | keep |
| `removeBase` :179 | "will no longer be used anywhere" selection | true | keep |
| `removeIsDirectory` :180 | "wherever it appears in the directory it will show initials" | conditional on appearing, true incl. D | keep |
| **`removeIsWebsite` :182** | **positive effect: "will leave the public website"** | **false for U, false for N, false for W (already routed away)** | **change (R-d1, R-d2)** |
| `removeIsWebsiteWithheld` :183 | negative: "isn't showing at the moment" | true for U and for W | keep; now also used for U |
| **`removeIsFallback` :184** | **"being used on the public website": a place; false for N** | untrue when the site is not published | **change (R-d5)** |
| `removeCaches` :185 | "can keep showing" | hedged | keep |
| `DIRECTORY_LINES.*`, `WEBSITE_LINES.*` | selection or negative; `unattested` is a remedy line | true (see R-d6 for one remedy state) | keep |
| `listingLine` :136 | "Photos appear there only while listed and the website is published": necessary condition | true | keep |
| `DESIGNATE_COPY.*` bodies | "Anyone on the internet can see a photo on the public website" is a general fact about the site; directory body carries the unless-clause | true | keep |
| `offWarningCopy` :80 | "Turning this off hides it everywhere": hides what was shown, negative on the result | true | keep |
| `listingConsentCopy` :276 | "A photo may be shown too" | hedged | keep |
| `PAGE_COPY.minorNotice`, `UPLOAD_COPY.*` | not effect claims about visitors | true | keep |

Sentences changed by this amendment: `removeIsWebsite`, `removeIsFallback`, `websiteNotListed`; one status line is re-routed (R-d6, no new string). **No other string changes.**

### Rulings

#### R-d1. The `remove` row of R-a4 for an unlisted person

**Reuse `removeIsWebsiteWithheld`** ("It is also their website photo, which the website isn't showing at the moment.") when the person is not listed. It is true for U (the roster functions list only people on an open public list), true under W, and needs no new string. The predicate in `consequencesFor` `remove`: `isWebsite` chooses `removeIsWebsiteWithheld` when `websiteIsWithheld(state) || !state.listed`, else `removeIsWebsite`. (Implementer: name the combined predicate `websiteNotShowing(state)` beside `websiteIsWithheld`, with a comment that listing is a roster-function gate the SQL core does not apply and publication is not read.) The key name `removeIsWebsiteWithheld` is kept (renaming churns tests for no gain).

R-a4's `remove` line now reads, in full: `removeBase`; `removeIsDirectory` if the directory photo; if the website photo, `removeIsWebsiteWithheld` when `websiteIsWithheld(state) || !state.listed`, else `removeIsWebsite`; `removeIsFallback` if the serving fallback; `removeCaches` if website photo or fallback.

#### R-d2. `removeIsWebsite` is hedged for publication (verbatim)

The listed, unwithheld case remains reachable with an unpublished site, which the snapshot does not read, so the positive "will leave" cannot stand. Replace `copy.ts:182`:

`It is also their website photo, so the public website can no longer show it.`

True in every state (published, unpublished, listed). It stays honest next to `removeCaches` ("Browsers that already saved it can keep showing it for up to a day.").

#### R-d3. `websiteStops` (`copy.ts:172`): keep, unchanged

"The website will no longer use this photo." is a selection claim: after the click the website designation is ended and the SQL core cannot pick it. It is true for an unlisted person, an unpublished site and a withheld person, and it is the same selection model the page already shows ("Website: the photo marked "Website" below." appears for an unlisted person too, with the listing line beside it). In the unlisted state the dialog reads "will no longer use this photo. The website will show no photo for {first}." followed by `websiteCaches`; each sentence is true. No change, no test row beyond the exact-string pin that already exists.

#### R-d4. `websiteNotListed` (`copy.ts:158`): drop the promise (verbatim)

Replace with:

`{first} isn't listed on the public website, so this photo won't appear there while that is so.`

Same "while that is so" pattern as `directoryHidden`: a negative with no implication that listing is sufficient (publication and a `hide_photo` with no designation are unknown to the page). Drops "yet", which implied a pending listing.

#### R-d5. `removeIsFallback` (`copy.ts:184`): selection wording (verbatim)

"Being used on the public website" names a place and is untrue for an unpublished site. Replace with:

`It is also the photo the public website uses for them, because it was cleared for the website.`

(Selection verb, true in every state in which `directoryPhotoServesWebsite` holds; `removeCaches` still follows.)

#### R-d6. QA note 1: route the attested branch through the website-withheld answer; one related status line

`hide_photo` is person-level (Ruling 1 of the fix-pass deviation): any `hide_photo` the directory answer reports is also one the website core would report. So a known `directoryWithheld` must say the website won't show it, instead of the hedged "can also appear ... such as hiding their photo", which is true but tells the operator less than the page knows.

- `designate_directory`, attested branch: `if (state.websiteWithheld !== null || state.directoryWithheld !== null) lines.push(websiteWithheldLine(state))`, else the existing listed / conditional choice. Output for a listed person with a hidden photo and no website photo: `[directoryHidden, websiteHidden]`.
- `designate_website` (same defect, same state): the withheld branch tests `state.websiteWithheld !== null || state.directoryWithheld !== null` the same way. Output for that state: `[websiteHidden]`.
- `websiteWithheldLine(state)`: `websiteMerged` when `state.websiteWithheld === "merged"`, else `websiteHidden(first)` (the call sites above guarantee a hide reason is known). Priority matches SQL (merged before hide_photo): merged plus `directoryWithheld` gives `[directoryHidden, websiteMerged]` on the attested directory branch.
- Status line (no new string): in the unattested-remedy state, `hide_photo` is known through the directory row though the website core returns no row (no candidate), so `WEBSITE_LINES.unattested` would be shown to a person who has hidden their photo. R-b4's premise ("not known to the page") does not hold there. `websiteLine(first, status, minor, directoryHidden = false)` gains a fourth parameter; in the `unattestedDirectoryOnly` branch the order is minor, then `directoryHidden` giving `WEBSITE_LINES.hide(first)`, then `WEBSITE_LINES.unattested`. `statusLines` passes `input.directory.withheld === "hide_photo"`. R-b4's last sentence is superseded for this state; it still applies to a person with no designation at all (there the page cannot know, and the remedy line is true).

### Copy checks (one line per group)

- *Residuals:* `removeCaches` and `websiteCaches` are untouched and still follow every website-photo removal or stop; the search-engine and archive residual sentence in the website and clear dialog bodies is unchanged; no changed string denies a residual or a Phase 2 ruling.
- *Source of truth:* "isn't showing at the moment" (R-d1) for `!listed` rests on `state.listed` (`listingsOf`, open staff, officer and committee lists) and on the roster functions listing only those people; publication, `sites.*` and unwithheld-without-designation are not read, so no changed sentence claims a visible result: "can no longer show it" (R-d2), "won't appear there while that is so" (R-d4), "the photo the public website uses for them" (R-d5, a selection claim from `directoryPhotoServesWebsite`). `websiteHidden` in the attested and website branches rests on `directoryWithheld` from `presby_person_directory_photo` plus the person-level scope of `hide_photo` in the core (0078:403).
- *Audience:* every string is shown to a `people.manage` holder on the photos page; none instructs (the R-d6 status line removes an instruction, the Clear-for-website remedy, for a state where it could not produce a photo).
- *Neighbours:* grep `will leave|removeIsWebsite|removeIsFallback|websiteNotListed|used on the public|won't appear until|isn't listed on the public website yet` across `src`, `e2e` and `docs/release-notes`: modify targets are `copy.ts:158-159, 182, 184`, `consequences.ts:110, 136-137`, and the tests at `consequences.test.ts:41, 115, 127, 193, 199, 205, 300-309`, `copy.test.ts:228`, `confirm-dialogs.test.tsx:57, 64, 95`, `designate-dialog.test.tsx:153`. No hit in `e2e/` and none in the release-notes draft (C9 mentions no "will leave" or "will appear"). The `v0.18` hit is an unrelated Children roster line.

### Tests (failing-first, against c225091)

| # | File | Assertion | Red today because |
|---|---|---|---|
| T12 | `consequences.test.ts` | `remove` the website photo, `listed: false`, nothing withheld, no directory photo: `[removeBase, removeIsWebsiteWithheld, removeCaches]` (exact sentences, with the new literal for the withheld key kept as at `:41`). Also the directory-and-website photo, unlisted: `[removeBase, removeIsDirectory, removeIsWebsiteWithheld, removeCaches]`. | currently returns `removeIsWebsite` |
| T13 | `consequences.test.ts` | `remove`, `listed: true`, nothing withheld: `[removeBase, removeIsWebsite, removeCaches]` where the sentence is the literal R-d2 text (not the constant); fallback row (`:205`) asserts the literal R-d5 text. | new strings absent |
| T14 | `consequences.test.ts` | State with `directoryWithheld: "hide_photo"`, `websiteWithheld: null`, `listed: true`, no website photo, unattested directory photo: `designate_directory` attested gives `[directoryHidden, websiteHidden]`; `designate_website` gives `[websiteHidden]`; with `websiteWithheld: "merged"` as well, attested directory gives `[directoryHidden, websiteMerged]`. | currently returns `directoryAlsoOnWebsite` and `websiteListed` |
| T15 | `consequences.test.ts` (extends T2's product) | Add three properties over the full product: (i) no `remove` result contains the old `removeIsWebsite` text "so it will leave the public website" anywhere; (ii) when `!listed` or any withheld field is set, no `remove` result contains `C.removeIsWebsite`; (iii) when `directoryWithheld !== null`, no `designate_*` result matches `/can (also )?appear/`. | (ii) and (iii) found by the product on today's code |
| T16 | `copy.test.ts` | Exact equality of the three new strings (R-d2, R-d4, R-d5) and the **verbatim old strings asserted absent**: `It is also their website photo, so it will leave the public website.`, `It is also being used on the public website because it was cleared for it.`, `isn't listed on the public website yet, so this photo won't appear until they are.` Also pin `websiteStops` unchanged. | old strings present |
| T17 | `confirm-dialogs.test.tsx` | Remove dialog for a website photo, `listed: false`: shows `removeIsWebsiteWithheld` and `queryByText(removeIsWebsite)` is null (the case QA named; fails on 0684ace). Remove dialog for a website photo, `listed: true`: shows the literal R-d2 sentence. | old sentence rendered |
| T18 | `designate-dialog.test.tsx` | The clear variant, ticked, for a listed person whose snapshot has `directoryWithheld: "hide_photo"` and an unattested directory photo: the dialog shows `directoryHidden` and `websiteHidden` and does **not** show `directoryAlsoOnWebsite`. The website variant in the same state shows `websiteHidden` and not `websiteListed`. The existing case at `:153` keeps passing with the new `websiteNotListed` text. | old sentences rendered |
| T19 | `reader-derive.test.ts` | `statusLines` with `unattestedDirectoryOnly: true`, `directory.withheld: "hide_photo"`, `website.withheld: null`, `minor: false` returns `WEBSITE_LINES.hide(first)`; with `minor: true` returns `WEBSITE_LINES.minor(first)`; with neither returns `WEBSITE_LINES.unattested` (unchanged). | currently returns `unattested` |

**e2e blast radius:** none. No `e2e/` file asserts any changed string (grep above); `e2e/person-photos.spec.ts:282` pins `removeIsDirectory`, which is unchanged. No new or changed e2e spec, so no feature flag and nothing for `e2e/support/flags.ts` or `e2e-baseline-flags.sql`. QA's re-run is the scoped unit set plus the remove-dialog walk for an unlisted person and for a listed person with a hidden photo (clear dialog), at 360 and 1280 px.

### Edge cases

| Case | Handling | Pinned by |
|---|---|---|
| Unlisted person, website photo, remove | `removeIsWebsiteWithheld` (true) | T12, T17 |
| Listed person, site unpublished, remove | "can no longer show it", true | T13 (the sentence is state-independent; publication is not read, so no test can pin "unpublished" and none is claimed) |
| Listed, hidden photo, no designation, designate website | the page cannot know (no SQL row); hedged `websiteListed` stays, true | existing T1 row |
| Listed, hidden photo known through an unattested directory photo, clear dialog | `[directoryHidden, websiteHidden]` | T14, T18 |
| Hidden photo, unattested directory only, status line | `Website: not shown, because {first} has hidden their photo.` | T19 |
| Under-18 and any of the above | `minor` precedence unchanged | existing T1 rows |
| Label and dialog fit at 360 px | no layout change; strings are of similar length (R-d2 is shorter than the old one; R-d5 is two words longer) | QA walk; claim *unverified* until it runs |

### Out of scope

Reading site publication or the `sites.*` flags into the snapshot (the hedges make it unnecessary; still an accepted Out of scope from the run 1 amendment); a withheld-without-designation SQL read; the under-18 checkbox (Ruling 2 of the fix-pass deviation: stays a tracked polish item).

### Carry-forward (this amendment)

| Item | Addressed here, or *deferred* |
|---|---|
| QA (d): `removeIsWebsite` false for an unlisted person and for an unpublished site | R-d1, R-d2, T12, T13, T15, T17 |
| QA: rule on `websiteStops` in the unlisted state | R-d3 (kept; the sweep table gives the reason) |
| QA note 1: attested directory branch through the website-withheld answer | R-d6, T14, T18, T19 |
| QA note 2: under-18 checkbox | *Deferred*; already accepted by tech-lead (fix-pass ruling 2) as a TODO candidate, operator to confirm priority |
| QA note 3: pre-existing touch targets (Features page AlertDialog buttons, dialog close icon) | *Deferred*; not in this diff; **TODO candidate for the orchestrator** (Rule 10): "Features page AlertDialog buttons (`features-list.tsx`, about 36 px) and the shared dialog close icon (about 16 px) are under 44 px. Raised by QA 2026-10-26; owner tech-lead to place; operator to confirm." |
| Run 1 amendment, fix-pass ruling and Phase 1/2 carry-forward | Unchanged; nothing here touches schema, flag, route, permission or audit |
| Proposed decision text addition (orchestrator numbers it with the run 1 text) | "Consequence sentences use selection verbs (use, chosen, marked) freely and effect verbs (show, appear, leave) only as a negative, hedged with 'can ... unless something withholds it', or as 'can no longer show'. Listing and publication are not part of the SQL core's answer: a sentence that depends on them says so or does not claim it." |
| Finding for the orchestrator to number | The run 1 amendment's C5 copy check passed `removeIsWebsite` on the SQL withheld answers alone; listing (a roster-function gate, `listed` already in the snapshot) and publication (unread) were never checked. The sweep was by phrase ("will appear"), not by effect verb against the state grid. This amendment re-swept by verb against listed/unlisted x published/unpublished x withheld x directory-hidden. |

### Implementation order

1. `copy.ts` (R-d2, R-d4, R-d5 verbatim): T16 red first.
2. `consequences.ts` (`websiteNotShowing`, the `remove` predicate, the withheld routing in both designate branches, `websiteWithheldLine`): T12-T15 red first.
3. `status-lines.ts` (R-d6 fourth parameter, `statusLines` call): T19.
4. Component tests T17, T18 (no component source change expected; `designate-dialog.tsx` and `confirm-dialogs.tsx` read the sentences from `consequencesFor`).
5. Gates: typecheck, lint, `npm run check`, the unit suite, the photo DB subset serially; no e2e source change, so e2e is QA's scoped walk only.

### Per-Phase Status row (recorded in the table at the top)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — amendment (Phase 5 run 2) | tech-lead | Complete: (d) ruled (`remove` for an unlisted person reuses `removeIsWebsiteWithheld`; `removeIsWebsite` hedged to "can no longer show it"); `websiteStops` kept; QA note 1 routed through the website-withheld answer; effect-verb sweep changed two further strings (`removeIsFallback`, `websiteNotListed`) and one status line; tests T12-T19; implementer full-stack-developer; no schema, route, flag, permission or e2e change | Design complete; back to Phase 4 | 2026-10-26 |
