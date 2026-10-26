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
| 5 — Verification | qa | Pending | — | — |
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
