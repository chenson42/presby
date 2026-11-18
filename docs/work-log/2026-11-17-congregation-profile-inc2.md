# Congregation profile Increment 2 — photos and reports — Work Log

> **Slug:** `2026-11-17-congregation-profile-inc2`
> **Surface:** (org) — the presbytery's per-congregation pages (`/o/<presbytery-slug>/admin/oversight/...`), presbytery type only; `/help`
> **Permission(s):** `congregation_oversight.manage` (existing, tier 1) and the new `congregation_oversight.finance` (tier 2, two-factor; in the presbytery founding-administrator bundle, DECISION-345). Never `FEATURES.*`.
> **Flag(s):** none new. Rides the existing global `org_portal.oversight`; the reports ride `org_portal.reports`.
> **Estimated complexity:** large
> **Pipeline mode:** Full (no schema change in this increment; 0089 shipped in Increment 1)
> **Release:** 0.62.0 (`package.json` bump and `docs/release-notes/v0.62.md` after Phase 6 SHIP IT, through `/release-notes`)
> **Parent:** `docs/work-log/2026-11-17-congregation-profile.md` (Phases 1 to 3: the analyst's brief and the orchestrator rulings, the architect's R1 to R10 and DECISION-344 to 348, and the one Phase 3 design for both increments). **Do not restate or summarize them here.**
> **Numbers (pre-assigned, Rule 16):** migration 0089 (applied in Increment 1; this increment adds no schema); DECISION-344 to 352 (349 to 351 used by Phase 3); F450 to F455 used, F456+ free; dev port 3102 (3103 for the production hydration lane); e2e ids `00000000-0000-4089-8000-` (people), `-9000-` (roles), `-9001-` (organizations); Neon branch `br-spring-bonus-axifozcw` (`pipeline-congregation-profile`); worktree `../presby-profile`, branch `pipeline/congregation-profile-inc2`
> **Source:** operator decisions A to G, 2026-11-17 ("take congregation profiles all the way to the end (pushed to production)")

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (parent) | READY WITH NOTES | 2026-11-17 |
| 2 — Architectural review | architect | Complete (parent; R1–R10) | Approved with suggestions | 2026-11-17 |
| 3 — Technical design | tech-lead | Complete (parent; this log carries the increment slice below) | Design complete | 2026-11-17 |
| 4 — Implementation | api-developer (B5, B7), ux-developer (B6, B8), full-stack-developer (B9) | Complete (B5 to B9, 2026-11-18) | — | 2026-11-18 |
| 5 — Verification | qa | Complete (run 2; run 1 FAIL above it) | PASS | 2026-11-18 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-11-18 |

---

# Phase 1 and Phase 2

See the parent log. Recorded there verbatim; not copied.

# Phase 3 — Technical Design (tech-lead): the Increment 2 slice

The design is in the parent's Phase 3. Sections an implementer of this increment reads: "Design rulings" (T10), "Module and file plan", "API Contract" (photo audit keys), "Implementation Order — Increment 2", "Copy" C14 to C16, "Test plan" (E2E rows for photos and reports), "Carry-forward" (R6, R7), "Edge Cases & Risks" (photo and CSV items).

**Scope.** The `storage/image/` extraction (a `refactor:` commit first, DECISION-346), building photos (upload, view, cover, caption, remove) and the Buildings and Insurance-and-loans reports with CSV and export audit (DECISION-348); two help edits and the privacy sentence. **No schema change:** the photo table shipped in 0089. Cut order if time forces it: reports before photos.

## Batches

| Batch | Implementer | Work | Exit gate |
|---|---|---|---|
| **B5** | api-developer | **Opens with a `refactor:` commit** (R6): `person-photos/image.ts` to `storage/image/photo.ts`; the image limits and `ImageRefusal` to `storage/image/limits.ts`; `src/app/(org)/o/[slug]/admin/community/[id]/edit/photos/downscale.ts` to `storage/image/downscale.ts` (test moves unchanged; the person-photo island's import is repointed); `processPhoto` gains a **required** `{ thumbnail: "top" \| "centre" }`, person photos pass `"top"` (output unchanged byte for byte: run `image.test.ts` before and after); `SHARP_FILES` updated in `scripts/check-treasury-boundaries.mjs`, `image-sanitize.test.ts` and `person-photos/scan.test.ts`. Then `photo-store.ts`, `photo-reads.ts`, the photo copy, the four audit keys, `photos/actions.ts`, tests (upload order: authorization, flag, type, building resolution and cap all before any decode; cap recounted under `for update`) | person-photo suites green and byte-identical; refusal order unit-tested for the new caller; `audience-callsites.test.ts` rows moved FORWARD to ACTIVE |
| **B6** | ux-developer | photos page, grid (two columns at 360px, 44px targets), `?view=<photoId>` master, the upload island (imports the moved `downscale.ts`; no `capture` attribute, no `blob:` URL), the photos block on the building detail, the cover on the record page's building cards | 360px walk; `check:treasury-boundaries` clean |
| **B7** | api-developer | `REPORT_KEYS`/`REPORTS` gain `buildings` and `insurance_and_loans` (`contract.ts`); `src/lib/presbytery-reports/buildings.ts`, `insurance-loans.ts`, `src/lib/oversight/report-rows.ts`, the two CSV builders and headers, the two `export/route.ts` files, tests (`contract.test.ts`, `boundaries.test.ts` "six", `readers.db.test.ts`, `csv.test.ts`) | `npm run check` zero |
| **B8** | ux-developer | the two report pages and views, `HUB_COPY` cards, two help edits plus the privacy sentence and the `presbytery-tools` count, registry labels | 360px walk of both reports; a CSV opened |
| **B9** | full-stack-developer | `oversight-photos.spec.ts`, `oversight-reports.spec.ts` (generated image only), the seed patch additions (generated solid-colour image bytes), regression of the touched specs, the prod hydration lane for the upload island | specs green on 3102/3103 |

## Gates (every batch)

- Same gates as Increment 1 (see its log): `npm run check` zero, typecheck/lint/build, `HydrationGate`, 360px in a real browser, implementer-written tests, no stash, no `pkill -f next`, shared files via integration patches.
- **No real data:** fixtures and screenshots use generated images only; a real building is real data. The Phase 6 phone-photo upload uses a non-identifying picture that is never committed.
- Residuals the copy must not deny: orphaned blob after a failed final transaction; `bytea` growth (about 4 MB per building at the cap); "removed from view, not erased".

## Increment-specific notes

**Handoff.** B5 to B9 are done (2026-11-18). Next: **qa** (Phase 5).

- Starts after 0.61.0 is released (back to back, same branch).
- **Phase 6 walk:** a real phone-photo upload on a deployed environment at 360px; both reports and a CSV opened; the help pages read as their reader.
- **Release notes:** the C16 lines; functionality map and TODO reconciliation.

---

# Phase 4 — Implementation

## B5 (api-developer, 2026-11-18): the `storage/image/` extraction and the photo server side

Branch `pipeline/congregation-profile-inc2`, worktree `/Users/cshenso/git/presby-platform/presby-profile`. Two code commits: `refactor(storage)` (the extraction) then `feat(oversight)` (the photo store, reads, actions, audit keys, copy, tests). Neither touches a Rule 16 shared file; **no integration patch is needed from B5.**

### Files Created

- `src/lib/storage/image/limits.ts`: the image limits (`UPLOAD_MAX_BYTES`, `CLIENT_TARGET_BYTES`, `CLIENT_MAX_EDGE`, `MASTER_MAX_EDGE`, `MASTER_MAX_BYTES`, `THUMB_EDGE`, `MAX_INPUT_PIXELS`, `MAX_INPUT_EDGE`) and `ImageRefusal`. No imports; the client island reads it.
- `src/lib/oversight/photo-store.ts`: the only writer of `oversight_building_photos`; the only `getBlobStore().store(` caller in the module.
- `src/lib/oversight/photo-reads.ts`: the readers and the one photo `resolveMany` (`audience: "private"`).
- `src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/buildings/[buildingId]/photos/actions.ts`: the four Server Actions.
- Tests: `src/lib/oversight/photo-store.unit.test.ts`, `src/lib/oversight/photo-store.db.test.ts`, `.../photos/actions.test.ts`.

### Files Modified

- Moved by `git mv` (history kept): `person-photos/image.ts` to `storage/image/photo.ts`; `person-photos/image.test.ts` to `storage/image/photo.test.ts` (a one-line wrapper passes `{ thumbnail: "top" }`, so every moved assertion is unchanged); `.../community/[id]/edit/photos/downscale.ts` and `downscale.test.ts` to `storage/image/` (the test unchanged apart from its `limits` import).
- `storage/image/photo.ts`: `processPhoto(bytes, { thumbnail: "top" | "centre" })` (required, no default); new export `preflightPhoto(bytes)` (steps 1 to 3 of the order, no decode; `processPhoto` runs exactly it).
- Repointed: `person-photos/store.ts` (passes `"top"`), `store.db.test.ts` (mock path), `types.ts` (imports `ImageRefusal`; the literal list in `PhotoRefusal` is kept because `copy.test.ts` parses it, with a compile-time guard that `ImageRefusal` is a subset), `limits.ts` (now only `PHOTO_CAP_PER_PERSON`), `scan.test.ts`; the person-photo island and its test, `actions.ts` and `actions.test.ts` under `community/[id]/edit/photos/`; `image-sanitize.ts` (comment), `image-sanitize.test.ts`.
- `SHARP_FILES` is now `["src/lib/storage/image-sanitize.ts", "src/lib/storage/image/photo.ts"]` (sorted: `-` sorts before `/`) in `scripts/check-treasury-boundaries.mjs`, its `.test.mjs` (the destructuring order flipped), `image-sanitize.test.ts` and `scan.test.ts`.
- `src/lib/audit.ts` (four keys, appended block) and `audit.test.ts`.
- `src/lib/oversight/`: `contract.ts` (`LIMITS.photoCap = 10`, `PhotoRefusal`, `PhotoOutcome`, `PhotoWritten`, `PhotoActionData`, `PhotoActionResult`), `copy.ts` (C14), `validate.ts` (`parseCaption`, `captionSchema`), `derive.ts` (`pickCover`), `reads.ts` (`readUnder` exported), `action-gate.ts` (`finishPhoto`), and the tests `boundaries`, `audit-coverage`, `copy`, `validate`, `derive`.
- `src/lib/storage/audience-callsites.test.ts`: two ACTIVE rows (`photo-reads.ts` `["resolveMany:private"]`, `photo-store.ts` `["store:private", "store:private"]`). The FORWARD table was empty in the tree (Increment 1 added no FORWARD rows), so the rows were added to ACTIVE directly.

### Schema Changes

None. The photo table shipped in 0089; `presby_app` may update only `caption`, `is_cover` and the removal pair on it, which is all this code does.

### Audit Events

All `tenant.oversight_photo.*`, `resourceType` `oversight_photo`, `resourceId` the photo id, written with `insertAuditRow(tx, ...)` in the write's own transaction. Metadata is ids and booleans only (never a caption, hash, dimension or filename).

| Key | Metadata beyond `organizationId`, `aboutOrgId` |
|---|---|
| `OVERSIGHT_PHOTO_ADDED` `tenant.oversight_photo.added` | `buildingId`, `photoId`, `cover` |
| `OVERSIGHT_PHOTO_REMOVED` `...removed` | `buildingId`, `photoId` |
| `OVERSIGHT_PHOTO_COVER_SET` `...cover_set` | `buildingId`, `photoId`, `previousCoverPhotoId` (null when no photo carried the mark) |
| `OVERSIGHT_PHOTO_CAPTION_SET` `...caption_set` | `buildingId`, `photoId` |

A same-caption save and a make-cover on the marked cover write and audit nothing.

### Implementer Notes

**Deviations and decisions the next phases need.**

1. **`preflightPhoto` is an addition to the pipeline.** The design's order puts "type" before "building resolution", but `processPhoto` folds size, sniff and APNG into the decode call. Rather than copy the sniff, `photo.ts` exports `preflightPhoto` (no decode) and `processPhoto` calls it, so the two cannot disagree. It is in the `feat` commit, not the `refactor` commit; person-photo output is unchanged (below).
2. **Order as built** (`photo-store.ts` header; pinned by `photo-store.unit.test.ts` and a source-order rule in `boundaries.test.ts`): manage key, `org_portal.oversight`, type, congregation, building, cap, then decode, then the two blobs, then one transaction that repeats all of it with the building row locked `for update` before the cap recount. Before the store, the action refuses a signed-out or second-factor-stale caller, an unresolvable slug, a malformed id (`not_found`), and a missing, empty (`empty`) or over-1,000,000-byte (`too_large`) file by its `File` handle without reading the bytes.
3. **Toggle off is worded `not_found`** ("That record could not be found."): C14 has no string for it and the surface does not exist with the toggle off. Say so to QA; if a different sentence is wanted it is one line in `PHOTO_REFUSAL`.
4. **Cover is derived on read.** A photo carries the mark (`is_cover`) when it was the building's first, or when staff chose it. If the marked cover is removed, no photo is promoted (that would be an unaudited write, or a second audit row per remove); instead `pickCover` shows the oldest live photo as the cover. `readBuildingPhotos` marks exactly one tile `isCover` either way, so the UI never shows a building with photos and no cover, and the "Make this the cover" button hides on that tile as C14 says. Choosing a photo then writes the mark.
5. **`photo-reads.ts` imports `readUnder` from `reads.ts`** (now exported), so a photo read has the same key, congregation, row order as every other reader.
6. **Covers are 160 px thumbnails** (the design: thumbnails in the grid, covers on the record page). If B6 wants a larger building-page cover, `readBuildingPhotos` can carry the master for the cover too; say so before B6 starts it, it is a small change here.
7. **The accepted residuals are unchanged** and are in the `photo-store.ts` header: an orphaned blob when the final transaction fails; `bytea` growth about 4 MB per building at the cap; removal hides, the file stays. A failed pre-check leaves nothing stored (no blob is written before step 7).
8. **Attribution.** The commits end with `Co-Authored-By: Claude Sonnet 5.5`, not `Claude Opus 5.5` as the kickoff asked: the harness's attribution reminder names the model that wrote them.

### Contract B6 consumes

**Server Actions** (`"use server"`, in `src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/buildings/[buildingId]/photos/actions.ts`). Gate for all four: `assertOrgSession(await auth())` (signed in, second-factor recheck), `resolveOrgContext(userId, slug)`, a UUID check on every id, then `photo-store.ts` re-checks `congregation_oversight.manage` (tier 1, live), the global `org_portal.oversight` toggle (upload only), the congregation, the building and the photo inside its own transaction. Never `FEATURES.*`. `organizationId` is never a parameter.

```ts
addBuildingPhotoAction(slug: string, aboutOrgId: string, buildingId: string, formData: FormData): Promise<PhotoActionResult>
//  formData: ONE field named "photo" (a File). The island downscales to <= 900 KB first (downscaleToJpeg).
setPhotoCaptionAction(slug, aboutOrgId, buildingId, photoId, values: { caption: string }): Promise<PhotoActionResult>
//  values is CaptionValues; an empty or whitespace caption clears it. Validate on the client with captionSchema().
setPhotoCoverAction(slug, aboutOrgId, buildingId, photoId): Promise<PhotoActionResult>
removePhotoAction(slug, aboutOrgId, buildingId, photoId): Promise<PhotoActionResult>
```

```ts
// from "@/lib/oversight/contract"
type PhotoActionResult =
  | { ok: true; data: { id: string; unchanged?: true; cover?: boolean } }   // cover: set by add only
  | { ok: false; error: string; field?: string; kind?: PhotoRefusal | Refusal | "invalid" | "unauthenticated" | "two_factor_required" };
// error is always one fixed C14 / REFUSAL string, safe to toast. field is "caption" when a caption fails its rule.
// unchanged: true means nothing was written (same caption, already the cover): toast nothing or "No changes to save.".
type PhotoRefusal = ImageRefusal | "forbidden" | "not_found" | "building_removed" | "duplicate" | "cap_reached" | "already_removed" | "save_failed";
```

Success revalidates `/o/<slug>/admin/oversight/<aboutOrgId>`, `.../buildings/<buildingId>` and `.../buildings/<buildingId>/photos`; the client still calls `router.refresh()` as the other forms do. No action redirects.

**Reads** (`src/lib/oversight/photo-reads.ts`, all `congregation_oversight.manage`, each its own transaction, each `OversightRead<T>` = `{ kind: "ok", data } | { kind: "forbidden" } | { kind: "not_found" }`; an `OrgAccessError` propagates to `[slug]/error.tsx`). Call with `viewer = { personId: resolved.org.personId, organizationId: resolved.org.organizationId }`.

```ts
readBuildingPhotos(viewer, aboutOrgId, buildingId, { viewPhotoId?: string | null }): OversightRead<BuildingPhotosView>
// BuildingPhotosView = { buildingId, buildingName, photos: PhotoTileView[] /* oldest first */, count, cap /* 10 */, atCap,
//                        viewed: PhotoViewedView | null }
// PhotoTileView  = { id, caption: string | null, isCover /* exactly one true when count > 0 */, thumbSrc: string | null /* data: URI, 160 px WebP */, width, height }
// PhotoViewedView = { id, caption, src /* data: URI, JPEG master <= 1,200 px */, width, height }
// viewed is non-null only when viewPhotoId is a LIVE photo of THIS building (pass the raw ?view= value; isUuid it first if you like, a bad one is ignored).
readBuildingCovers(viewer, aboutOrgId): OversightRead<Record<buildingId, BuildingCoverView>>
// the record page's building cards; a building with no photo is ABSENT from the record.
readBuildingPhotoSummary(viewer, aboutOrgId, buildingId): OversightRead<BuildingCoverView | null>
// the building page's Photos block; data null = no photos ("Add a photo"), not_found = no such live building.
// BuildingCoverView = { buildingId, photoId, caption: string | null, thumbSrc: string | null, count }
```

`thumbSrc` is `null` if its blob could not be read (one fixed log line): render the tile without the picture, never an error. Gate order for the page, as everywhere in the tree: `gateOversightPage`, `isUuid` on `aboutOrgId`, `buildingId`, `view`, then the reader; `forbidden` renders `OversightForbidden`/the Locked card, `not_found` is `notFound()`.

**Copy constants** (`src/lib/oversight/copy.ts`; the UI imports them and writes no sentence of its own):

- `PHOTO_COPY`: `blockHeading` "Photos", `addPhoto` "Add a photo", `allPhotos(n)`, `pageTitle(buildingName)`, `backToBuilding(buildingName)`, `viewLarger(caption | null)` (the tile's accessible name), `editCaption`, `captionLabel` "Caption (optional)", `makeCover`, `removePhoto`, `backToAll`, `uploadFailed` (the island's own rejection string), `removeDialog` `{ title, body, confirm, cancel }`.
- `PHOTO_REFUSAL`: one string per `PhotoRefusal` (`photoRefusalMessage(reason)`). A server refusal arrives as the action's `error`; the island's own client-side failures (`DownscaleError`) keep the strings the person-photo island already gives them, and `PHOTO_COPY.uploadFailed` covers a thrown network error.
- `TOAST.photoAdded`, `captionSaved`, `coverChanged`, `photoRemoved`; `VALIDATION.captionTooLong`; `LIMITS.captionMax` (200), `LIMITS.photoCap` (10).
- Client-safe imports for the island: `@/lib/storage/image/downscale` (`downscaleToJpeg`, `DownscaleError`), `@/lib/storage/image/limits` (pure).

**What B6 must still do (not in B5):** the photos page, grid, `?view=` master, the upload island (no `capture` attribute, no `blob:` URL; `check:treasury-boundaries` T3 and the downscale test scan for both), the photos block on the building page and the covers on the record page's building cards, the help edits stay B8.

### Gates and counts (2026-11-18, pipeline Neon branch)

- `npm run typecheck`: clean. `eslint` on the touched trees: clean. `npm run check`: all ten tripwires pass (zero violations). `npm run build`: exit 0.
- `npx vitest run` (whole suite, no DB env): 916 files passed, 160 skipped; 15,020 tests passed, 4,281 skipped.
- **Person photos, byte for byte.** sha256 of master and thumbnail for four generated pictures compared before the extraction, after it, and after `preflightPhoto` landed: identical (the PNG case is refused `too_large` before and after, as it was). `storage/image/photo.test.ts` (24 tests, the moved `image.test.ts`) and the DB-backed suites, re-run after the last `photo.ts` change: `npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/person-photos src/lib/storage` (22 files, 484 tests) pass.
- `photo-store.db.test.ts`: 27 tests, serial, pass (143 s). `photo-store.unit.test.ts`: 30 tests. `photos/actions.test.ts`: 41 tests.
- **Failing-first (mechanisms shown red against a deliberate break, then restored):** the type check moved after the building lookup (5 red); the final transaction not locking (3 red in the unit file, 2 red in the DB file); the toggle before the key (12 red); the cap not recounted (3 red); the decode before the pre-check (12 red); the lock removed from the DB races (cover and first-upload races red). `boundaries.test.ts` carries a failing sample for each new rule.
- `scripts/check-treasury-boundaries.test.mjs` (98 tests) and `scan.test.ts` pass with the new `SHARP_FILES`.

### Strings added or changed

`src/lib/oversight/copy.ts`: `VALIDATION.captionTooLong`; `TOAST.photoAdded`, `captionSaved`, `coverChanged`, `photoRemoved`; `PHOTO_REFUSAL` (13 kinds; 10 are C14, 3 are existing `REFUSAL` strings); `PHOTO_COPY`. All are the C14 strings verbatim; no wording outside C14. No help page or registry change in B5 (B8's).

*Keep Phase 4 sections short: files, deviations from the design, gates with counts, and anything the next phase must know. Leave out narration of how the work went; git history already records it. Judgment output (analyst, architect, qa) is still recorded verbatim.*

## B6 (ux-developer, 2026-11-18): the building photos UI

One code commit (`feat(oversight)`); no Rule 16 shared file touched, **no integration patch needed from B6**. No schema, no new route handler, no `loading.tsx`, no help edit (B8's).

### Files Created

- `src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/buildings/[buildingId]/photos/page.tsx` (+ `page.test.tsx`): the photos page. Order: `gateOversightPage`, `isUuid` on every segment (`openRecord`), the either-key front door, then `readBuildingPhotos`. `?view=` is passed to the reader only when it is a UUID. `forbidden` is the Locked page, `not_found` is `notFound()`, a thrown read is `OversightLoadError`. At the cap the upload is replaced by `PHOTO_REFUSAL.cap_reached`.
- `src/components/oversight/`: `photo-thumb.tsx` (a `thumbSrc` of null renders a neutral plate of the same size, never an error), `photo-grid.tsx` (two columns at 360px, three from `sm:`; each tile a link named `PHOTO_COPY.viewLarger(caption)`, `min-h-11`), `photo-viewed.tsx` (the master, caption, controls, back link), `photos-block.tsx` (the building page's block), `photo-controls.tsx` (client: caption form, make cover, remove AlertDialog) and `photo-upload-island.tsx` (client), with `photo-controls.test.tsx` and `photo-upload-island.test.tsx`.

### Files Modified

- Building page: a `PhotosBlock` between Details and Appraisals; its read is its own section state, so a failed photo read leaves the page up with the section's own load error. Record page: `readBuildingCovers` joins the `Promise.all`; the covers are decoration, so a failed or refused read just shows the cards without a picture. `BuildingsSection` takes an optional `covers` map and `BuildingCard` an optional `cover`.
- `record-pages.test.tsx`: mocks `photo-reads`; four new cases (block with none, block with a cover whose thumbnail is null, failed photo read, cover on the card and the failed cover read).

### Implementer Notes

1. **Island.** `photo-upload-island.tsx` imports `@/lib/storage/image/downscale` and `/limits`' consumers only; a file input with no `capture` and no `blob:` URL; `HydrationGate`, no `<form>`; the file is posted under the one field `photo`; a `DownscaleError` of `too_big` shows `PHOTO_REFUSAL.too_large`, any other client failure `PHOTO_REFUSAL.unsupported_type` (the person-photo island's mapping), a rejected call `PHOTO_COPY.uploadFailed`; a server refusal is the action's own `error`. No sentence is written in the components apart from the three listed below.
2. **Words not in C14, for the fork branding pass and QA's copy check:** the caption form's submit "Save caption" / "Saving…" (the module's existing "Saving…"), the upload button reads "Saving…" while it works (no C14 string for progress), and the larger view's accessible fallback "Photo" for an uncaptioned master's `alt`. "Cancel" is `PHOTO_COPY.removeDialog.cancel`.
3. **No "Cover" label on a tile.** C14 names none, so the grid does not mark the cover in words; the cover is visible on the record page and building page and is the one photo without "Make this the cover" in the larger view. If a label is wanted it is one string in `PHOTO_COPY` and one badge in `photo-grid.tsx`.
4. **Contract gaps: none.** The B5 contract was sufficient as written. One observation: a photos page for a RETIRED building still renders (the reader allows it); nothing in C14 says otherwise.
5. Prettier was run at `--print-width 140` (the repo's de facto width) on the new files.

### Gates (2026-11-18)

- `npm run typecheck` clean; `eslint` on the oversight trees clean; `npm run check` zero (all ten tripwires, including `check:treasury-boundaries` and `check:hydration-gate`); `npm run build` exit 0.
- Vitest, oversight trees: 331 passed, 78 skipped (DB-backed). New: page test 11, upload island 6, controls 6, record-pages +4.
- **360px walk** (a temporary Playwright spec on the e2e oversight fixture, own server on 3102, not committed; flag `org_portal.oversight` switched on for the walk and read back OFF afterwards; fixture removed by its own teardown): the building page's Photos block with none and with photos; the empty photos page; three generated JPEG uploads through the real downscale and server pipeline; the two-column grid (tiles 150px at x=24 and x=186, third wraps); the larger view; a 201-character caption refused under the field, then a 200-character-plus wrapped caption saved with "Caption saved."; make cover (button disappears, DB shows the new `is_cover`); the cover on the record page's building card and the block on the building page; the remove AlertDialog (Cancel keeps it, confirm removes, URL drops `?view=`, DB live count 2); a duplicate refused with the C14 string; filling to ten (eight more generated uploads) shows the cap sentence and no Add button. **No sideways scroll and every control at least 44px at every step** (including the dialog buttons, measured after its animation settled). The sr-only file input is 1px by design and excluded from the measurement, as in the person-photo precedent.
- Screenshots were of generated noise images only; none committed.

## B7 (api-developer, 2026-11-18): the Buildings and Insurance-and-loans reports, server side

One `feat(reports)` commit. No Rule 16 shared file touched, **no integration patch needed from B7**. No schema, no new permission, no flag, no audit key (the two exports reuse `PRESBYTERY_REPORT_EXPORTED` with `report: "buildings" | "insurance_and_loans"`, DECISION-348). The pages and views are B8's.

### Files Created

- `src/lib/oversight/report-facts.ts`: types only; the facts the two reports read. No street address, policy number, lender, note or photo exists in any of them.
- `src/lib/oversight/report-rows.ts` (`server-only`): `readBuildingsReportFacts(tx, org, aboutOrgIds)` (2 queries) and `readInsuranceLoansReportFacts(tx, org, aboutOrgIds)` (4 queries). The only place the six tables are named for a report. The caller checks the key; each statement names its columns.
- `src/lib/presbytery-reports/oversight-derive.ts` (pure): `deriveBuildings`, `deriveInsuranceLoans`; `oversight-derive.test.ts` (14 tests).
- `src/lib/presbytery-reports/buildings.ts` and `insurance-loans.ts`: the readers (below).
- `src/app/(org)/o/[slug]/admin/reports/buildings/export/route.ts` and `.../insurance-and-loans/export/route.ts`.

### Files Modified

- `contract.ts`: `REPORT_KEYS`/`REPORTS` gain the two entries; new `DASHBOARD_REPORT_KEYS` (below).
- `csv.ts`: `BUILDINGS_HEADER`, `INSURANCE_LOANS_HEADER`, `buildBuildingsCsv`, `buildInsuranceLoansCsv` (BOM, CRLF, `csvTextCell`, `csvIntegerCell`, `centsToDecimal`).
- `copy.ts` and `reports-hub.tsx`: the two `HUB_COPY.cards` entries (C15, verbatim) and their cases in the hub's `cardText` switch. **Forced by the registry:** `cardText` is an exhaustive switch over `ReportKey`, so the tree does not typecheck without them. B8 owns everything else on the hub.
- `dashboard.ts`: the "no key held is forbidden" rule now reads `DASHBOARD_REPORT_KEYS` (the four with a card), not every report key. **Regression caught and fixed:** with six keys a finance-only holder would have passed the old `Object.values(held).some(Boolean)` and reached the keyless roster count the rule exists to protect (DECISION-342). Failing-first test in `dashboard.test.ts`.
- Tests, in place: `contract.test.ts`, `boundaries.test.ts` (six exports, six routes), `routes.test.ts` (six routes), `csv.test.ts`, `readers.db.test.ts`, `dashboard.test.ts`, `src/lib/oversight/boundaries.test.ts` (one rule: `report-rows.ts` names no street address, policy number, lender, phone, caption or `notes` column), plus four tests that iterated every `REPORTS` entry and now iterate the four dashboard reports: `copy.test.ts`, `dashboard-views.test.tsx`, `help-page.test.ts`, and the hub's `page.test.tsx` (now six cards and six keys).

### Implementer Notes

1. **Interim allowance in `boundaries.test.ts`.** `PAGES_PENDING = ["buildings", "insurance-and-loans"]` lets the "each segment has a page.tsx" and `pages` count assertions hold with only the two export routes in the tree. **B8 deletes that constant in its own commit**, which makes both assertions strict for all six.
2. **Retired buildings are not in the Buildings report** (no column says "retired", so a sold or demolished building would read as a building in use). A congregation whose only buildings are retired shows the same empty line as one with none, so the page's "None recorded" is slightly loose for it; if a different line ("None in use") is wanted it is a copy ruling, the data is `withoutBuildings` per row (the list's `buildingsInUseLabel` has the three-state precedent). The roster is `roster.ts` (active lifecycle only), as C15 says.
3. **`guarantee` is the one free-text column in either file**, by R7 ("carrier, lender and guarantee go through the text guard"), though C15 also says "any free-text note" is never in a file: the two statements disagree and R7 is the architect's ruling, so the file carries the loans' guarantee text (formula-guarded and quoted) and **no lender**, which R7 names but the C15 headers do not include. Several open loans join their guarantee texts with `"; "` in one cell. Flag to the analyst for Phase 6: the copy must not say "no notes" about the guarantee column.
4. **CSV cells.** Tri-states are `Yes` / `No` / empty (a file never says "Not recorded"); closed values are labels (`Education building`, `Good`), not stored keys; a recorded zero is `0.00`, a figure not recorded is empty; a congregation with no building is one line of name, city and county; `balance_unrecorded_loans` is the count of open loans without a balance (the other two sums carry `originalUnrecorded` and `grantsUnrecorded` on the row for the page, not in the file, as C15 specifies).
5. **Insurance-and-loans reads the organization's local date** (`today`), so B8 can say "Expired" in words from `expiry` without a clock. `getInsuranceLoans`/`exportInsuranceLoans` take an optional `now` (tests only).
6. **Not delivered, and why:** `BUILDINGS_COPY` and `INSURANCE_LOANS_COPY` (page titles, column labels, the roster note): page copy is B8's with the views. The CSV needs none of them.
7. **Hub card links 404 until B8.** The two cards are live and link to `/o/<slug>/admin/reports/buildings` and `.../insurance-and-loans`, which have no `page.tsx` until B8. Not shipped from this branch state.
8. **B9 note:** `e2e/presbytery-report-exports.spec.ts` asserts four locked cards and four report links (`:60-80`); the hub now has six. Not edited (B9's).

### Contract B8 consumes

```ts
// src/lib/presbytery-reports/buildings.ts          gate: key congregation_oversight.manage, inside the transaction
getBuildingsReport(viewer: ReportViewer): Promise<ReportRead<BuildingsData>>            // ReportRead = { kind: "ok", data } | { kind: "forbidden" }
exportBuildingsReport(viewer: ReportViewer): Promise<ReportExport>                      // ok { csv, rowCount, filenameBase: "buildings" } | forbidden
// src/lib/presbytery-reports/insurance-loans.ts    gate: key congregation_oversight.finance, inside the transaction
getInsuranceLoans(viewer: ReportViewer, now?: Date): Promise<ReportRead<InsuranceLoansData>>
exportInsuranceLoans(viewer: ReportViewer, now?: Date): Promise<ReportExport>           // filenameBase "insurance-and-loans"
```

Pages follow the viability page exactly: `gateReportPage({ slug, path })`, then `runReportRead(() => getBuildingsReport(identity))` (`identity` is a `ReportViewer`), `forbidden` renders `ReportsSectionForbidden` (`section="congregation oversight"` for Buildings; for Insurance and loans the finance phrase is `reportByKey("insurance_and_loans").permissionPhrase`, "manage congregation property finances"), the export button is `<ExportButton href={`${path}/export`} label={FRAME_COPY.exportCsv} />`. **No query parameter on either page or export** (the exports ignore the query; pinned in `routes.test.ts`).

```ts
// from "@/lib/presbytery-reports/oversight-derive"
interface BuildingsData { rosterCount: number; rows: BuildingsRow[]; withoutBuildings: number; buildingCount: number }
// rows: roster order (name, id); inside a congregation the primary first, then by building name. One row per building in use,
// or exactly ONE row with building: null for a congregation with none (the page's "None recorded").
interface BuildingsRow { organizationId: string; name: string; city: string | null; county: string | null; building: BuildingReportItem | null }
// BuildingReportItem (from "@/lib/oversight/report-facts" BuildingReportFact):
//   { id, aboutOrgId, name, buildingType: BuildingType, yearBuilt, firstAdditionYear, secondAdditionYear, squareFeet: number | null,
//     roofCondition, plumbingCondition, hvacCondition, boilerCondition: Condition | null,
//     hasSprinklers, hasFireAlarm, hasSecuritySystem: boolean | null /* null = not recorded */, isPrimary: boolean }
// Render with formatBuildingType / formatCondition / formatTriState / formatInteger from "@/lib/oversight/derive" (Not recorded for null).

interface InsuranceLoansData { today: string /* org-local YYYY-MM-DD */; rosterCount: number; rows: InsuranceLoansRow[]; totals: InsuranceLoansTotals }
interface InsuranceLoansRow {
  organizationId; name;
  insurance: { policyYear, carrier: string | null, policyExpiresOn: string | null, expiry: "none" | "current" | "expired",
               recentClaims: boolean | null, poolInterest: boolean | null } | null;   // the NEWEST live policy year; null = none recorded
  openLoans: number;                                                                   // open, live loans only
  originalCents, balanceCents, grantsCents: number | null;                             // sums of the RECORDED figures; null = none recorded (never $0)
  originalUnrecorded, balanceUnrecorded, grantsUnrecorded: number;                     // "{n} not recorded" beside the figure
  guarantees: string[];                                                                // trimmed, non-empty, in the order recorded
  appraisedCents: number | null;                                                       // sum of each in-use building's newest appraisal; null = none
  buildingsWithoutAppraisal: number;                                                   // in-use buildings with no appraisal
}
interface InsuranceLoansTotals { openLoans; originalCents, balanceCents, grantsCents, appraisedCents: number | null;
                                 originalUnrecorded, balanceUnrecorded, grantsUnrecorded, buildingsWithoutAppraisal: number }
// Money: formatMoney(cents) from "@/lib/oversight/derive". A congregation with no records still has a row (insurance null, openLoans 0).
```

**Export routes** (plain `GET`, no body, no parameters), gate = `gateReportRoute` (session, second-factor recheck, four-way org miss, `org_portal.reports`, presbytery type), then the key in the transaction: `GET /o/<slug>/admin/reports/buildings/export` and `GET /o/<slug>/admin/reports/insurance-and-loans/export`. Status: 200 CSV (`<filenameBase>-<slug>-<date>.csv`, BOM, `no-store`), 307 signed-out or second factor, 404 no such org, 403 (one body for no relationship, ended, flag off, wrong type, missing key), 503 failure (including a failed audit insert: no file). The audit row is `tenant.presbytery_report.exported` with `{ organizationId, report, rowCount }`, written in the read's transaction.

**CSV headers** (exact): buildings `congregation,city,county,building,building_type,year_built,first_addition_year,second_addition_year,square_feet,roof_condition,plumbing_condition,hvac_condition,boiler_condition,sprinklers,fire_alarm,security_system,primary`; insurance and loans `congregation,carrier,policy_year,policy_expires_on,recent_claims,pool_interest,open_loans,original_amount,balance,balance_unrecorded_loans,grants,guarantee,appraised_value,buildings_without_appraisal`.

**Copy keys that exist for B8:** `HUB_COPY.cards.buildings` and `.insurance_and_loans` (`{ description, source }`); registry titles "Buildings" / "Insurance and loans" and the lock phrases are `REPORTS` entries (`reportByKey("buildings" | "insurance_and_loans")`); `FRAME_COPY.exportCsv`/`back`/`loadError`/`retry`; `ROUTE_COPY` for the routes. **To be added by B8:** `BUILDINGS_COPY`, `INSURANCE_LOANS_COPY` (C15), and note `copy.test.ts`'s "no string mentions two-factor" rule (F445) was written when no report key forced it: the finance key does, so any new two-factor sentence needs the test narrowed for that report only. Also B8 updates `help-page.test.ts` (`startsWith(... four reports ...)`).

### Gates and counts (2026-11-18, pipeline Neon branch)

- `npm run typecheck` clean. `eslint` on `presbytery-reports`, `oversight`, the reports route tree and the components: clean. `npm run check`: all ten tripwires pass. `npm run build`: exit 0.
- `npx vitest run` (whole suite, no DB env): 921 files passed, 160 skipped; 15,154 tests passed, 4,299 skipped.
- `readers.db.test.ts` (serial, `npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/presbytery-reports/readers.db.test.ts`): 48 tests pass (18 new: the key gate for both, a finance-only and a manage-only viewer, another presbytery, a moved-away and a no-longer-active congregation, removed and retired buildings, a removed newer policy year, paid-off and removed loans, an appraisal of a retired or removed building, sentinels for street address, policy number, notes and lender absent from page and file, page-equals-file, the audit row, a failed audit insert). The hub test now covers six keys.
- **Failing-first (each mechanism shown red against a deliberate break, then restored):** retired filter dropped (5 red); loans' removed filter dropped (4 red); newest policy year taken as the oldest (3 red); Buildings key check removed (2 red); Insurance key check removed (2 red); the Insurance export's audit call removed (2 red); the dashboard's key rule reverted to every key (1 red). `csv.test.ts` and `oversight/boundaries.test.ts` carry their own failing samples.

### Strings added or changed

Only the two `HUB_COPY.cards` entries, verbatim from C15. No help page or registry change (B8's).

---

## B8 (ux-developer, 2026-11-18): the two report pages, views, hub, cover badge and help

One commit (`feat(reports)`: code, help and this section). No Rule 16 shared file touched, **no integration patch needed from B8**. No schema, no route handler, no flag, no `loading.tsx`.

### Files Created

- Pages: `reports/buildings/page.tsx`, `reports/insurance-and-loans/page.tsx` (the viability page's shape: `gateReportPage`, `runReportRead`, forbidden, load error, `ExportButton` only when the roster is non-empty; the finance page's lock names "congregation property finances").
- Views: `src/components/presbytery-reports/buildings-view.tsx`, `insurance-loans-view.tsx` (cards below `sm`, a table above; the insurance table has a "Total" footer and the cards a "Total" card).
- Tests: `oversight-report-pages.test.tsx` (gate, forbidden, empty, failed read, data, links), `oversight-report-views.test.tsx` (both strings, `{n} not recorded`, no `$0`, Expired in words), `photo-grid.test.tsx`; additions to `copy.test.ts`, `oversight-derive.test.ts`, `readers.db.test.ts` (retired count; 49 tests pass, serial).

### Files Modified and rulings applied

- **(a)** `report-rows.ts` runs a third query (live, retired, grouped count); `BuildingsReportFacts.retiredCounts`; `BuildingsRow.buildingsRetired`. The congregation with no building in use reads "None in use" when that count is above 0, "Not recorded" otherwise; "None recorded" appears nowhere in the new copy (test).
- **(b)** `fileNote` on both pages: Buildings "The CSV file leaves out street addresses and notes."; Insurance "...leaves out street addresses, policy numbers, lenders and notes. It does include each loan's guarantee." Help says the same.
- **(c)** Not needed: no report copy mentions two-factor, so the F445 ban in `copy.test.ts` is **unchanged** for all six. The help page says, truthfully, that the finance permission asks its holder to set up two-factor sign-in.
- **(d)** `PHOTO_COPY.coverBadge` "Cover": a `Badge` beside the tile link (the link's accessible name is unchanged). B6's "Save caption" and "Saving…" ratified as `PHOTO_COPY.saveCaption` and `saving` (components now import them).
- `BUILDINGS_COPY`, `INSURANCE_LOANS_COPY` in `presbytery-reports/copy.ts` (import-free; equality with oversight `STATE` pinned). `PAGES_PENDING` deleted; `help-page.test.ts` says six reports.
- Help: `presbytery-reports.md` (lead, table rows, "Buildings" and "Insurance and loans" sections, what each CSV carries, who can see each), `congregation-records.md` ("Photos" section, "Reports from these records"), `privacy-policy.md` (building photos bullet: private, never published, removed from view not erased), `presbytery-tools` `today` (six reports), registry labels and anchors. `verifiedIn` untouched. The tile description in `tiles.ts` said "four reports"; now "six".
- 44px fix: the report frame's help link and the hub's help link were 17px; both are now `min-h-11`.

### Implementer Notes

1. **Two-factor, for QA:** the finance page itself says nothing about two-factor; only the help page does.
2. **Pre-existing, not fixed (out of B8's scope):** the hub's Congregation Statistics and Per-Capita year links ("‹ 2024", "2026 ›") are 20px tall (`reports/page.tsx`). Flag for a follow-up.
3. The Buildings cards repeat the congregation heading on each building's card (one card per row, as the other reports).
4. "Not recorded" for every blank figure on the cards is noisy for a congregation with no insurance; kept for honesty (never a blank that could be read as zero).
5. Copy strings new in B8 for the branding pass: both `fileNote`s, `inUseNote` ("Only buildings in use are listed. A building that has been retired is not."), `newestNote`, `count`, `total`, `helpLink` pair.

### Gates (2026-11-18)

- typecheck, eslint (`src`, `e2e`), `npm run check` (all ten, including `check:help`: 34 entries, 30 published) zero; `npm run build` exit 0; `npx vitest run`: 924 files passed, 160 skipped; 15,183 tests passed, 4,300 skipped.
- **360px walk** (temporary Playwright spec on the oversight fixture, own dev server on 3102 stopped by PID, spec deleted, not committed): hub (six cards; a manage-only holder sees the finance page's permission refusal), Buildings (cards: two buildings, "None in use" for a congregation with only a retired building), Insurance and loans (Expired, "1 not recorded", Total card, no `$0`), both CSVs downloaded and read (BOM, CRLF, headers exact, no street address, policy number or lender sentinel; Birch's single empty row), the photos page with exactly one "Cover" badge, the four help pages loaded with no sideways scroll. No sideways scroll anywhere; every control at least 44px apart from the sr-only file input (1px by design) and the pre-existing year links in note 2. A desktop (1024px) table screenshot was taken for both. Flags `org_portal.oversight` and `org_portal.reports` were switched on for the walk and restored by the fixture. Images were generated solids; none committed.
- "Not recorded" (never ever recorded) is covered by the DB and view tests, not the browser: the e2e fixture has no congregation with no building at all beside one with a retired one.

## B9 (full-stack-developer, 2026-11-18): the browser tests and the seed

Branch `pipeline/congregation-profile-inc2`. No application code touched; **no integration patch needed from B9** (`e2e/support/oversight-fixture.ts` is unchanged: the helpers the new specs need live in the spec files). No schema, flag, route or env var.

### Files Created

- `e2e/oversight-photos.spec.ts` (12 cases, serial, 360px): the building page's "Add a photo"; an upload of a generated, EXIF- and GPS-bearing JPEG through the real island (wire size under 1,000,000 bytes, master stored `private`, JPEG, no EXIF, the first photo carries the cover mark, audit row ids and a boolean only); two more uploads and the grid (two columns, the third wraps, tiles at least 44px, one "Cover" badge); a wrong-type file, a corrupt picture and a duplicate refused with their fixed strings and nothing written (rows and audit unchanged); the larger view and its controls; a 201-character caption refused under the field, 200 unbroken characters wrapping with no sideways scroll, a short caption saved, an unchanged save writing no audit row; make cover (badge moves, previous cover in the audit row, a repeat writes nothing, the cover on the record page's card and the building page's block); remove through the AlertDialog (Cancel changes nothing, confirm hides the photo, the row stays, 44px dialog buttons inside the viewport, no native dialog); a finance-only holder sees the Locked state with and without `?view=` and no picture; another presbytery's congregation, another congregation's building, a removed building, a non-UUID and a nonexistent building are the same 404, and a `?view=` that is another building's photo, a removed photo or a non-UUID shows no larger picture; the cap at ten (a stale page's eleventh is refused with the C14 sentence, a fresh page shows the sentence and no Add button); photo audit rows carry ids and booleans only.
- `e2e/oversight-reports.spec.ts` (7 cases, serial): the hub per viewer (the clerk opens Buildings and Viability, the finance-only holder opens Insurance and loans, the rest Locked with the reason); Buildings at 360px (cards, facts, "Not recorded" for a congregation with no building ever, then "None in use" once it has only a retired building, no street address or note on the page, 44px, no sideways scroll) and as a table at 1100px; Insurance and loans at 360px ("Expired" in words, "1 not recorded", the guarantee, a Total card, no `$0`, no policy number or lender); the wrong key (a permission line, no export link, no data; each export the one 403, nothing audited); the Buildings CSV downloaded from the page (BOM, CRLF, exact header, exact rows, none of the five sentinels) and the Insurance and loans CSV (exact header and rows, guarantee present, no sentinel); the export audit rows (`{ organizationId, report, rowCount }` and nothing else, no name or amount).
- `e2e/hydration/oversight-photos.spec.ts` (2 cases): the upload island is inert until hydration (a forced click and a file set before it write no row and no audit row), then a picture is stored as the cover; the larger view's three controls are inert until hydration (a pre-hydration Remove opens nothing), then Remove opens the dialog and Cancel changes nothing, a caption typed after the gate opened is the one saved, and make cover moves the mark. Failing-first: the island's `HydrationGate` swapped for a `div` turns the first case red; restored.

### Files Modified

- `e2e/presbytery-report-exports.spec.ts`: six segments; the clerk (four keys, no finance key) sees five links and one Locked card with the finance reason; the no-key member sees six Locked cards and no link; Buildings and Insurance and loans pages load, the clerk's Insurance page is a permission line and its export a 403 while Buildings exports 200; six exports 403 for the no-key member and six 307 signed out; the 360px loop covers six pages.
- `scripts/oversight/seed-dev-oversight.sql` (not a Rule 16 file): two photos of the Alder Creek Sanctuary, GENERATED solid-colour images (a 320x240 JPEG master and a 160x160 WebP thumbnail each, about 700 and 120 bytes), private audience, the first the cover with a caption, blobs `bb890000-...-0001` to `-0004`, photos `b0890000-...-0007` and `-0008`; idempotent (`where not exists`). Applied twice to the pipeline branch (2 photos, 4 blobs, 1 cover after both), and `scripts/oversight/test-rls-89.sql` re-run as `presby_app` against that branch with the seed present: passes. The Education Wing has no photo, so its page shows "Add a photo".

### Implementer Notes

1. **Pre-existing hub 360px finding not retested:** the hub's year links (B8 note 2) are not in any of these specs' controls scans; the Buildings and Insurance pages' scans are clean.
2. The fixture helpers `seedAppraisal`, `seedInsurance` and `seedLoan` author their rows as the fixture's `both` user, so the reports spec enrols `both` (it is not a viewer there).
3. A spec race caught and fixed in the photos spec itself: re-opening "Edit caption" before the refreshed view arrived saved the older caption back (a legitimate change, so a third audit row); the spec now waits for the refreshed caption and the field's value first. This was the test's, not the app's.
4. The "Not recorded" state of the Buildings report is covered here in the browser (it was DB- and view-tested only in B8): Birch has no building ever, then only a retired one.

### Gates and counts (2026-11-18, pipeline Neon branch)

- `npm run typecheck`, `eslint e2e`, `npm run check` (all ten): zero.
- Dev lane, own server on 3102 (stopped by PID), `--project=chromium --workers=1`, `E2E_ALLOW_SHARED_DB=true`: `oversight-photos` 12 passed, `oversight-reports` 7 passed, `presbytery-report-exports` 8 passed, `hydration/oversight-photos` 2 passed, `hydration/oversight-forms` 2 passed. Regression of the Increment 1 specs: `oversight-records` 9, `oversight-finance` 8, `oversight-founder` 4, `presbytery-oversight` 9, `presbytery-reports` 10: 40 passed.
- Production lane: `PW_PROD_BUILD=1 PW_PROD_PORT=3103 npm run test:e2e:prod -- e2e/hydration/oversight-photos.spec.ts e2e/hydration/oversight-forms.spec.ts --workers=1`: 4 passed (the two oversight hydration files, scoped; the rest of the lane is untouched by this increment).
- Flags left at the CI baseline (read back: `org_portal.oversight` off, `org_portal.reports` on); no `e2e-ovs` organizations left behind; no server left running on 3102 or 3103.
- Every picture is a generated solid colour; no real photograph, and none committed.

### Handoff

Next: **qa** (Phase 5). In the browser: nothing further for B5 to B8's walks; Phase 6's real phone-photo upload on a deployed environment is still the analyst's input.

---


## Orchestrator rulings on Phase 4 copy (recorded after QA run 1)

Given to B8 at hand-off and recorded here so the off-table strings have a source:

- **(a)** The Buildings report lists buildings in use. A congregation with none uses the oversight list's three-state wording: "None in use" when every recorded building is retired, "Not recorded" when none was ever recorded. This supersedes C15's "None recorded".
- **(b)** The Insurance-and-loans file carries each loan's guarantee (R7). The page, help and release note say what the files leave out (street address, policy number, lender, notes) and that the guarantee is included. C16's second line is amended to match.
- **(c)** F445's ban on two-factor wording in report copy may narrow for the finance report. B8 kept it for all six; only the help mentions two-factor.
- **(d)** The cover tile carries a "Cover" badge in words.
- **Ratified as shipped:**
  - `PHOTO_COPY.coverBadge` "Cover", `saveCaption` "Save caption", `saving` "Saving…", and the alt fallback "Photo".
  - `BUILDINGS_COPY.inUseNote`, `.fileNote`, `.count` and `.helpLink`.
  - `INSURANCE_LOANS_COPY.newestNote`, `.fileNote` and `.helpLink`.
  - The photo tile is a link rather than a button; the help matches.
- **Cover rule (QA run 1 item 1):** the design and help win. A new photo takes the cover mark only when the building has no live photo. After the cover is removed, the oldest remaining photo shows as the cover until someone chooses another, and a later upload does not take it.


## Fix pass after QA run 1

Branch `pipeline/congregation-profile-inc2`, from HEAD 879df20b. Commits: `fe261887` (test, item 2), `93d2eeb4` (fix, item 1 with its DB test), `9d7cb67d` (test, item 1 browser step).

**Item 1: the cover rule.**
- Cause: `photo-store.ts` took `const cover = marked === undefined`, so any upload took the mark while no live photo carried it. After the marked cover was removed, the next upload became the cover.
- Fix: the final locked transaction now looks for any live photo of the building and a new photo takes the mark only when there is none (`const cover = anyLive === undefined`). The cap recount and the `for update` lock are unchanged, so two simultaneous first uploads still end with one cover.
- DB test (`photo-store.db.test.ts`, "the cover rule — regression for an upload taking the cover after the marked cover was removed..."): first-ever upload is marked; remove the marked cover and nothing is promoted; a later upload is not marked; the oldest photo left is the one `readBuildingPhotos` and `readBuildingCovers` show as the cover; the `added` audit rows read `cover: true, false, false`; removing every photo and uploading again marks it.
  - **Red (test written first, source unfixed):** `expected [ false, true ] to deeply equal [ false, false ]` at the new photo's `is_cover`.
  - **Green (fix in):** the whole file, 28 tests, serial.
- Browser step (`e2e/oversight-photos.spec.ts`, same name, on a building of its own so the later tests' counts are untouched): two uploads through the island, remove the marked cover through the AlertDialog, the oldest one left carries the "Cover" badge, upload a third, the new tile has no badge, no row is marked, and the `added` rows read `true, false, false`.
  - **Red:** `photo-store.ts` put back to the pre-fix version under a running server on 3102; `expected [false, true] to equal [false, false]` at the spec's `is_cover` assertion.
  - **Green:** fix restored, then the whole spec: 13 passed (12 before plus this).
- Help: `congregation-records.md:32` ("The first photo you add is the cover") and `:39` ("If you remove the cover, the oldest photo left shows as the cover until you choose another") are now true against the build; not edited.

**Item 2: the hub help link.** `page.test.tsx`, in the reports-hub describe: "the help link under the cards is a 44px target..." asserts the link's `href` and `min-h-11` in its class, in the style of `views.test.tsx`. **Red:** with `inline-flex min-h-11 items-center` removed from `reports-hub.tsx:108`, `expected 'text-primary underline-offset-4 hover…' to match /min-h-11/`. **Green:** the class restored; the file's 36 tests pass.

**Verification.** `npm run typecheck`, `npm run lint` (zero warnings) and `npm run check` (all tripwires, exit 0) clean. Serial run of `src/lib/oversight`, `src/components/oversight` and the reports `page.test.tsx` with `.env.local`: passed (14 files, 303 tests, the DB-backed ones included). `oversight-photos.spec.ts` on its own server at 3102 with the stated env: 13 passed; the server was stopped by PID and nothing listens on 3102. Flags read back at the baseline (`org_portal.oversight` off, `org_portal.reports` on). Every picture is a generated solid colour. Nothing is left reverted in the tree.

### Handoff

Next: **qa** (Phase 5, run 2).

---

# Phase 5 — Verification (qa)

**Date:** 2026-11-18
**Verified by:** qa
**Tree:** `pipeline/congregation-profile-inc2` at `11a3fff7`, in `/Users/cshenso/git/presby-platform/presby-profile`, diffed against `e77658f9` (0.61.0).

- I did not modify the tree or use `git stash`, and `git status` was clean at the end. Env vars were checked by presence and length only, never printed.
- All my code experiments ran in a `git archive HEAD` copy outside the tree (`.../scratchpad/qa6/red/`, with `node_modules` and `.env.local` symlinked).
- I wrote to the database only through the fixtures' own setup and teardown. Afterwards: 0 `e2e-ovs*` organizations, and the branch's photo count is back to the seeded 2.

## Type Check

- `npm run typecheck`: **PASS**.
- `npm run lint` (`--max-warnings=0`): **PASS**.
- `npm run check`: **PASS**, all ten tripwires. Help check: 34 entries, 30 published, 30 content files, 7 images.
- `next build`: **PASS**, run inside the production lane (compiled, TypeScript, 86 static pages).

## Unit Tests

- **Full unit suite with no database:** 924 files passed, 160 skipped. 15,183 tests passed, 4,300 skipped, **0 failed**, 349s. Every skip is gated on the database and ran in the next item.
- **Whole DB-backed suite** on a fresh `scratch_qa6_db`, in CI's order, serially (migrate, schema-parity, seed, `seed-dev.sql`, `db-baseline.sql`, test helpers, then vitest):
  - 1,083 of 1,084 files passed. 19,481 tests passed, 1 skipped (the sample test), **1 failed**. 113 minutes. The scratch database was dropped.
  - It includes `photo-store.db.test.ts`, `readers.db.test.ts`, every person-photo DB suite and `src/lib/storage/*` (including `blob-audience.db.test.ts`).
  - **The one failure is a timeout, not a regression.** `src/lib/org-features.test.ts:532` hit its 20s limit. The diff does not touch that file, and my e2e lanes were loading the same Neon compute at the time. Re-run once on its own: 29 of 29 passed. It also passed in Increment 1 run 2.
- **Isolation suites, all as `presby_app` (`rolbypassrls = f`):**
  - Full `scripts/test-rls.sql` on a fresh `scratch_qa6_rls`: exit 0, 2,158 passes, "Section 89 (congregation records) complete". Dropped afterwards.
    - Run 1 of this job failed at `db:migrate` with no message. It had been started at the same moment as the DB suite's migrate on the same compute. Re-run on its own, it passed, so it is a harness collision, not a product failure.
  - `scripts/oversight/test-rls-89.sql` from fresh: 172 passes.
  - `scripts/oversight/test-rls-89.sql` on the pipeline branch, with the seeded photos present: 172 passes.
- **Person-photo output is byte-identical (DECISION-346).**
  - I ran the old `person-photos/image.ts` (from `e77658f9`) and the new `storage/image/photo.ts` with `{ thumbnail: "top" }` on the same 12 generated inputs.
  - Inputs: a JPEG with EXIF, GPS and orientation 6; a portrait; a PNG with alpha; a WebP; a tiny image; a large solid image; a q100 image that forces the quality steps; an empty file; text; a truncated JPEG; a PNG over the pixel cap; and a WebP.
  - Result: **12 of 12 identical** (sha256 of master and thumbnail, dimensions, refusal kind). `"centre"` changes only the thumbnail, never the master.
- **EXIF is stripped:** every output master has no EXIF, ICC, XMP or IPTC. The orientation-6 input came out rotated (600x400 became 400x600).
- **`sharp` importers:** `SHARP_FILES` is exactly `image-sanitize.ts` and `storage/image/photo.ts`. `check:treasury-boundaries` and `scan.test.ts` are green.

## End-to-End Tests

**Flag state.** Before e2e I reset the global flags to the CI baseline (`scripts/ci/e2e-reset-flags.sql`, `pipeline_branch=1`, 38 seeded flags).

- The 9 flags that are on were already the baseline, so the reset changed nothing.
- After every lane I read them back: the same 9. **The branch is left at the CI baseline.**

**Dev lane.** Own server on 3102 with the brief's environment; `E2E_BASE_URL=http://localhost:3102`, `E2E_ALLOW_SHARED_DB=true`, `--project=chromium`, one worker. Stopped by PID; 3102 confirmed free.

- **83 of 83 passed**, 8.8 minutes, no skips or retries.
- By spec:

| Spec | Passed |
|---|---|
| `oversight-photos` | 12 |
| `oversight-reports` | 7 |
| `hydration/oversight-photos` | 2 |
| `presbytery-report-exports` | 8 |
| `oversight-records` | 9 |
| `oversight-finance` | 8 |
| `oversight-founder` | 4 |
| `presbytery-oversight` | 9 |
| `hydration/oversight-forms` | 2 |
| `presbytery-reports` | 10 |
| `presbytery-dashboard` | 7 |
| `person-photos` | 5 |
| `totp-full-login` | 1 |

**Map lane** (`PW_MAP=1`, its own server on 3102): **10 of 10 passed**.

**Production lane** (`PW_PROD_BUILD=1 PW_PROD_PORT=3103`, `E2E_BASE_URL` unset, both projects): **119 of 119 passed**, 6.7 minutes. This includes `hydration/oversight-photos` (2), `hydration/oversight-forms` (2) and `hydration/person-photos-upload` (1). 3103 is free afterwards.

**Auth-touching gate.** The diff touches no auth file. `totp-full-login` passed, and the MFA-enrolled holder in my walk signed in through `/totp` with a real code.

**Full chromium suite: not run.** The diff touches no proxy, auth file, layout, `e2e/support` file, `playwright.config.ts` or `src/components/shared`/`ui` file, so the rest relies on the PR's CI.

**My own 360px walk.** This was a walk spec in the scratch copy only, against 3102, on the oversight fixture, with generated images. Screenshots are in the scratch `qa6/walk/` folder.

- *Photos:*
  - Three uploads put the cover on photo 1. The grid is two columns with no sideways scroll.
  - The larger view shows "Edit caption", "Remove photo" and "Back to all photos", and no "Make this the cover" on the cover.
  - The caption form shows "Caption (optional)", "Save caption" and "Cancel".
  - The dialog reads "Remove this photo? It will no longer be listed here. The picture file itself stays in storage and can't be erased from here." with "Cancel" and "Remove photo".
  - At ten photos the cap sentence shows, there is no Add button, and no control is under 44px.
- *Reports, as an MFA holder of both keys:*
  - Hub help link 44px.
  - Buildings: "1 building in 1 congregation", "None in use" for the congregation whose only building is retired, "Primary", and "Not recorded" for each blank.
  - Insurance and loans: "Expired", "Total", the guarantee, and no `$0`.
  - Both pages have no sideways scroll and no small controls.
  - Both CSVs: 200, BOM, CRLF, exact headers, `'=Generated Nave` and `'=SUM(1) …` guarded, `50000.00` and `1234567.89`, and none of the note, policy-number or lender sentinels.
  - One audit row per export: `{ organizationId, report, rowCount }`.
- *Help:* `/help/congregation-records`, `/help/presbytery-reports`, `/help/privacy-policy` and `/help/planned/presbytery-tools` all return 200 with no sideways scroll, in light and dark.

Failures: none in e2e.

## Regression Tests Added

I showed each mechanism red myself in the scratch copy, then restored it to green.

| Fix or mechanism | Test | Red on the break | Green on HEAD |
|---|---|---|---|
| **B7 dashboard key regression** (`DASHBOARD_REPORT_KEYS`) | `src/lib/presbytery-reports/dashboard.test.ts`, "holding only the two oversight reports' keys … — regression for the finance-only viewer reaching the roster count" | 1 red with `dashboard.ts:112` reverted to `Object.values(held).some(Boolean)` | 23 of 23 |
| Upload order: type after the building | `photo-store.unit.test.ts` + `oversight/boundaries.test.ts` | 5 red | 63 of 63 |
| Final write without the row lock | same | 3 red | yes |
| Decode before the pre-check | same | 12 red | yes |
| Cap not recounted under the lock | same | 3 red | yes |
| CSV guard removed (guarantee / carrier / building name) | `csv.test.ts` | 7 / 6 / 7 red | 58 of 58 |
| CSV header renamed; balance written as raw cents | `csv.test.ts` | 1 / 2 red | yes |
| B8 report-frame help link at 44px | `e2e/oversight-reports.spec.ts:159, :217` (`smallControls`, which would have caught the 17px link) | not re-shown by me | passed |
| B9 island `HydrationGate` | `e2e/hydration/oversight-photos.spec.ts` | the implementer reports red when swapped for a `div`; not re-shown by me | passed in both lanes |

**Missing (named gap):** B8 also fixed the **hub's** help link (`src/app/(org)/o/[slug]/admin/reports/reports-hub.tsx:108`, 17px to `min-h-11`), and no test pins it. The hub is not in any `smallControls` scan, because of the pre-existing 20px year links, and `reports/page.test.tsx` makes no assertion on its class.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% (Increment 1 run 1)
- `src/lib/two-factor.ts`: 91.11% (Increment 1 run 1)
- `src/lib/flags.ts`: 100% (Increment 1 run 1)

The diff touches none of the three, so these are not re-measured.

## Feature-Gate Audit

These are `(org)` tenant surfaces, so there is no `FEATURES.*`. I checked sign-in plus the Node-side second-factor recheck, then the tenant key inside the transaction. I read the bodies, not just the test results.

| Route or action | Signed in + 2FA recheck | Tenant key check present | Correct key |
|---|---|---|---|
| Page `…/buildings/[buildingId]/photos/page.tsx` | yes (`gateOversightPage`) | yes. `openRecord` checks UUIDs, then the either-key front door, then `readBuildingPhotos` via `readUnder`, which checks the key, the congregation and the live building. `?view=` is honoured only for a live photo of this building | manage |
| Building page Photos block; record-page covers | unchanged gate | yes (`readBuildingPhotoSummary`; `readBuildingCovers` only `if (manage)`) | manage |
| `addBuildingPhotoAction` | yes (`resolveOversightActor`: `assertOrgSession`, then `resolveOrgContext`, then UUIDs) | yes. Order: key, then `org_portal.oversight`, then `preflightPhoto`, congregation, live building, cap, then decode, then blobs, then one transaction repeating all of it under `for update` | manage |
| `setPhotoCaptionAction`, `setPhotoCoverAction`, `removePhotoAction` | yes | yes (`gate()`, then building `for update`, then `lockPhoto`) | manage |
| Page `reports/buildings/page.tsx` | yes (`gateReportPage`) | yes, `holdsPermissions` inside `readBuildingsReport`'s transaction | `congregation_oversight.manage` |
| Page `reports/insurance-and-loans/page.tsx` | yes | yes, the first statement in the transaction | `congregation_oversight.finance` |
| `GET …/reports/buildings/export` | yes (`gateReportRoute`: 307 when signed out or second factor needed, four-way miss, flag, type) | yes; CSV and audit row (`auditReportExport(tx, …)`) in the read's transaction | manage |
| `GET …/reports/insurance-and-loans/export` | yes | yes, same shape | finance |
| Dashboard (`dashboard.ts:112`) | unchanged | the "no key, forbidden" rule now reads the four dashboard keys | n/a |

Other checks:

- No `loading.tsx` added; no `route.ts` under `oversight/**`.
- No `console.log` and no native dialogs. Only two fixed `console.error` lines: the SQLSTATE-only line and the "photo read failed" line.
- Observation, as in Increment 1: the caption, cover and remove actions do not read `org_portal.oversight`. Upload does. The permission is enforced on all four.

**Schema/RLS (no schema change in this increment), probed on the live branch catalog:**

- `oversight_building_photos` is `relrowsecurity` and `relforcerowsecurity` true.
- `aclexplode`: `presby_app` holds INSERT and SELECT, plus UPDATE on 4 columns only. No DELETE.
- CHECK `asset_audience = 'private'` is in place.
- Both photo blobs of every live photo are `private` and owned by the presbytery (2 of 2, 0 offenders).
- `presby_public_site_asset()` filters on audience, and test-rls-89 (h) passes as `presby_app`.
- **Blobs are private:** confirmed at the database by catalog and row probe, and in the e2e (`oversight-photos` checks the stored master's audience).

## Copy Truthfulness

- [ ] **Every added or changed string is in the design's Copy table.** The C14 and C15 strings are verbatim. These are off the table, and none is false, but no ratification is recorded anywhere except B8's own phrase "rulings applied (a) to (d)":
  - `PHOTO_COPY.coverBadge` "Cover", `saveCaption` "Save caption", `saving` "Saving…".
  - The alt fallback "Photo" (`photo-viewed.tsx:23,27`).
  - `BUILDINGS_COPY.inUseNote`, `.fileNote`, `.count`, `.helpLink`.
  - `INSURANCE_LOANS_COPY.newestNote`, `.fileNote`, `.helpLink`.
  - "None in use" on the Buildings report, where C15 says "None recorded".
  - The tile is a link where C14 says a button; the help matches the build.
- [x] **The query behind each claim was opened.** One defect:
  - **copy truthfulness: FAIL.** `src/content/help/congregation-records.md:32` says "The first photo you add is the cover". `:39` says "If you remove the cover, the oldest photo left shows as the cover until you choose another". Both are false, and so is Phase 1's "The first photo is the cover" (parent log `:106`).
  - The cause is `src/lib/oversight/photo-store.ts:290-295`, `const cover = marked === undefined`: any upload takes the mark while no live photo carries it.
  - After the marked cover is removed, the oldest remaining photo shows as the cover (by `pickCover`), with no row marked. The next upload then takes the mark, and the cover silently jumps to the **newest** photo. There is no "Make this the cover" and no `cover_set` audit row, only `added` with `cover: true`.
  - **Shown in the database:** a probe case in the scratch copy of `photo-store.db.test.ts`, on the branch. The cover before the upload was photo 2, and after it photo 3. The record page's card follows.
  - **Shown in the browser at 360px:** grid `2*,3` became `2,3,4*`, and the rows read `removed, live, live, live+mark` (screenshots `p4`, `p5`).
  - No test covers this sequence.
  - Viewer: holders of `congregation_oversight.manage`. The rule is the implementer's (B5 note 4), not the design's.
  - Every other claim holds:
    - private and never published (catalog, test-rls-89 h);
    - "without its location or camera details" (byte probe, e2e);
    - the cap of 10 and the cap sentence;
    - duplicates refused;
    - the audit trail carries no caption (e2e and DB metadata keys);
    - "1 building in 1 congregation" (roster minus `withoutBuildings`);
    - "None in use" / "Not recorded" (the retired count query);
    - newest policy year (live-year unique index, `distinct on … desc`);
    - "Expired" against the organization's local date;
    - appraised value from in-use buildings only;
    - CSV contents (the walk's downloads).
- [x] **Each instruction was traced to its role.**
  - "Add a photo", "Edit caption", "Make this the cover" and "Remove photo" are rendered only after `readBuildingPhotos` passes the manage key. Each action re-checks manage. The help's Photos section names that permission.
  - The finance report's help says its holder is asked to set up two-factor. The key is `requires_two_factor` (Increment 1 catalog).
  - The finance page itself says nothing about two-factor (F445 holds).
- [x] **Older strings about the same subject were grepped.**
  - No user-facing "four reports" remains outside the dashboard. The dashboard's text is correctly kept (C15 note 4): `copy.ts:306` stays true, and a finance-only holder is forbidden there.
  - The tile description and the registry summary now say six.
  - The `person-photos` copy is untouched.
  - The privacy policy's retention section does not contradict "removed from view, not erased".
  - **Residuals are not denied anywhere:**
    - the orphaned blob after a failed final transaction is not mentioned, and nothing claims a failed save stores nothing;
    - bytea growth is not mentioned and not denied;
    - "removed from view, not erased" is in the help (`:39`), the privacy bullet (`privacy-policy.md:40`) and the dialog.
- [x] **Help diff covered.**
  - Every new `labels` string for both pages was seen on screen at 360px in the walk or the specs: Photos, Add a photo, Cover, Edit caption, Caption (optional), Save caption, Make this the cover, Remove photo, Remove this photo?, Cancel, Back to all photos, the cap sentence, Buildings, Insurance and loans, None in use, Not recorded, Primary, Carrier, Policy year, Guarantee, Expired, Total, Export CSV.
  - All four pages were walked at 360px, light and dark.
  - No image under `src/content/help/images/` changed, so there were no pixels to read. My walk screenshots show only fixture names and generated colours.

## Verdict

**FAIL**

1. **copy truthfulness: FAIL, behaviour defect behind it.**
   - Where: `src/lib/oversight/photo-store.ts:290-295`, against `src/content/help/congregation-records.md:32` and `:39` and Phase 1 `:106`. Viewer: manage holders.
   - Symptom: after the cover is removed, the next upload becomes the cover.
   - Owner: **api-developer (B5)**.
   - The likely fix, which matches the design and the help, is that a new photo takes the mark only when the building has no live photo.
   - It needs a failing-first DB test: remove the cover, add a photo, and the oldest remaining photo is still the cover, with the `added` row's `cover: false`. Ideally an e2e step too.
   - If the team would rather keep the current rule, that is a tech-lead copy ruling (Phase 3), and both help sentences and the Phase 1 statement change instead.
2. **Missing regression test.** B8's 44px fix to the hub help link (`reports-hub.tsx:108`) has no test. Owner: **ux-developer (B8)**. A unit assertion on its class, as `views.test.tsx:37` does for the export button, would do; red on the old class string.

Everything else passed:

- typecheck, lint, build, all ten tripwires;
- the unit suite;
- the whole DB-backed suite (the one timeout is unrelated and passed on re-run);
- full `test-rls.sql` and `test-rls-89` (fresh and branch);
- the dev lane (83), map (10) and production (119) lanes;
- byte-identity 12 of 12;
- EXIF stripping;
- the refusal order and lock;
- private blobs;
- the export audit row in the read's transaction;
- CSV guard, money and headers;
- no address, policy number, lender or note in either CSV;
- the B7 failing-first test;
- the gate audit.

**For tech-lead and the orchestrator (not counted as failures):**

- Ratify and record the off-table strings listed above (B8's rulings (a) to (d) have no recorded source).
- **Release notes:** C16's second line, "The files leave out street addresses, policy numbers and notes", would deny the guarantee column (`oversight_loans.guarantee_note`) that the Insurance-and-loans file carries. The page (`fileNote`) and the help both say "It does include each loan's guarantee", and the release note must say so too.
- Pre-existing, not this pipeline's: the hub's year links are 20px (`reports/page.tsx`, B8 note 2); "Back to portal" is 20px.
- B6 note 4: a retired building's photos page still renders and allows uploads. Nothing in C14 says otherwise.
- The commits carry `Co-Authored-By: Claude Sonnet 5.5` (B5 note 8).

**Run scope:**

- **Ran:**
  - typecheck, lint, `npm run check`, build;
  - the full unit suite;
  - the whole DB-backed suite on a fresh database, in CI order, serially;
  - full `test-rls.sql` and `test-rls-89` on a fresh database, and `test-rls-89` on the branch, as `presby_app`;
  - the dev lane (13 specs);
  - the map lane;
  - the full production lane;
  - a 360px walk of photos, both reports, both CSVs and four help pages.
- **Not re-run:**
  - the full chromium suite (relies on the PR's CI);
  - critical-module coverage (untouched);
  - e2e red-first for B8's frame link and B9's hydration gate (relies on the implementers' reports).

---

**Per-Phase Status row**

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete (run 1) | FAIL | 2026-11-18 |

**Handoff:**

- **api-developer** for item 1: the cover rule in `photo-store.ts`, with a failing-first DB test. If they want to keep the current behaviour, they go to **tech-lead** for a copy ruling instead.
- **ux-developer** for item 2: the hub help-link test.
- Then QA run 2 re-runs `photo-store.db.test.ts`, `photo-store.unit.test.ts`, `oversight-photos.spec.ts` (dev and 360px), the hub page test, `npm run check`, and the help walk of `congregation-records`.

Logs, scripts, the byte-comparison script, the probe and the walk screenshots are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/2313dcc4-4a86-43c8-9bfc-694f433ec0be/scratchpad/qa6/`.

---

## Run 2 (qa)

**Date:** 2026-11-18
**Verified by:** qa
**Tree:** `pipeline/congregation-profile-inc2` at `04aacffb`, in `/Users/cshenso/git/presby-platform/presby-profile`. The fix pass is `879df20b..04aacffb`: `fe261887`, `93d2eeb4`, `9d7cb67d`, `04aacffb`.

- I did not modify the tree or use `git stash`. At the end `git status` was clean, HEAD was still `04aacffb` and the stash list was empty.
- Env vars were checked by presence and length only, never printed.
- Every red run and my walk ran in a `git archive 04aacffb` copy at `.../scratchpad/qa6r2/red/`, with `node_modules` and `.env.local` symlinked.
- I wrote to the database only through the fixtures' own setup and teardown. Afterwards there were 0 `e2e-ov*` organizations and 2 photo rows (the seeded 2).
- Disk was checked first: 527 GiB free.

**What the fix pass changed:**

- `src/lib/oversight/photo-store.ts:290-299`: the cover predicate is now "any live photo of the building", inside the existing locked transaction.
- `src/lib/oversight/photo-store.db.test.ts`: one new test.
- `e2e/oversight-photos.spec.ts`: one new test.
- `src/app/(org)/o/[slug]/admin/reports/page.test.tsx`: one new test.
- Plus the work-log.

**Trailers:** the `fix:` commit `93d2eeb4` carries `Caught-By: agent-review`, `Discovered-In: Phase-5` and `Work-Log:`. The `test:` and `docs:` commits carry `Work-Log:`.

## Type Check

- `npm run typecheck`: **PASS**.
- `npm run lint` (`--max-warnings=0`): **PASS**.
- `npm run check`: **PASS**, all ten tripwires. Help check: 34 registry entries, 30 published, 30 content files, 7 images.
- `next build`: **PASS**, run inside the production lane (compiled, TypeScript finished, 86 of 86 static pages).

## Unit Tests

- **Full unit suite with no database:** 924 files passed, 160 skipped. 15,184 tests passed, 4,301 skipped, **0 failed**, 45s, exit 0.
  - Against run 1 that is one more pass (the new hub test) and one more skip (the new DB test, which is gated on the database and ran in the next item).
- **DB-backed, serial, against the pipeline branch** (`dotenv -e .env.local -- vitest run src/lib/oversight src/lib/storage src/lib/person-photos --no-file-parallelism`):
  - **32 files passed, 737 tests passed, 0 skipped, 0 failed**, 632s.
  - The zero skip count means every database-gated describe ran. That covers `photo-store.db.test.ts` (28 tests, including the new cover-rule test and the CONCURRENCY tests at `:414`, `:428` and `:516`), `oversight/reads.db.test.ts`, `oversight/store.db.test.ts`, `storage/blob-audience`, `blob-store-find` and `public-asset` DB tests, `storage/blob-store.test.ts`, and the three `person-photos` DB suites.
  - **My judgement on scope:** I did not re-run the whole DB-backed suite on a fresh database.
    - The fix changes one predicate in `addPhoto`'s final locked transaction, and the rest of the diff is tests.
    - It touches no migration, no `src/lib/authz.ts`, nothing under `src/lib/db/` and no shared fixture (`e2e/support/` is unchanged).
    - Run 1's full DB suite on `11a3fff7` and its `test-rls.sql` / `test-rls-89` results still stand for everything else.
    - The one-cover guarantee under concurrency still rests on the unique partial index `oversight_building_photos_one_cover_idx` (`drizzle/0089…:580`, `where is_cover and removed_at is null`) and the `:428` concurrency test, which passed.

## End-to-End Tests

**Flag state.**

- Before e2e I reset the global flags to the CI baseline (`scripts/ci/e2e-reset-flags.sql`, `pipeline_branch=1`; "set 38 seeded flags to their seed values").
- The 9 flags that were on already matched the baseline, so the reset changed nothing.
- After both lanes I read them back: the same 9. **The branch is left at the CI baseline.**

**Dev lane.**

<!-- leak-ok: the fixed e2e fixture cron value CI and the e2e config already use, not a credential -->
- Own server: `next dev -p 3102`, started with `CRON_SECRET=giving-e2e-cron-secret RATE_LIMIT_DISABLED=true DOMAINS_ALLOW_RESERVED_TLDS=1 DOMAINS_PROVIDER=fake DOMAINS_DNS_PROVIDER=fake DOMAINS_FAKE_STATE_FILE=.tmp/domains-fake-state.json`.
- Run with `E2E_BASE_URL=http://localhost:3102`, `E2E_ALLOW_SHARED_DB=true`, `--project=chromium`, one worker.
- **49 of 49 passed**, 4.7 minutes, no failures, skips or retries.
- The server was stopped by PID (94386 and its `npx` parent 94368), and 3102 was confirmed free.

| Spec | Passed |
|---|---|
| `oversight-photos` | 13 (12 + the new cover-rule step at `:447`, 16.4s) |
| `oversight-reports` | 7 |
| `hydration/oversight-photos` | 2 |
| `presbytery-report-exports` | 8 |
| `oversight-records` | 9 |
| `presbytery-reports` | 10 |

**Production lane** (`PW_PROD_BUILD=1 PW_PROD_PORT=3103`, `E2E_BASE_URL` unset, `prod-build` and `prod-custom-hosts`):

- **119 of 119 passed**, 6.3 minutes, exit 0.
- That includes `hydration/oversight-photos` (2), `hydration/oversight-forms` (2) and `hydration/person-photos-upload` (1).
- 3103 is free afterwards, and no `next` server is left on 3102 or 3103.

**Auth-touching gate:** not applicable. Neither run 1's diff nor the fix pass touches an auth file, the proxy or a layout.

**Full chromium suite: not run.** The diff touches no proxy, auth file, layout, `e2e/support/`, `playwright.config.ts` or shared component, so the rest relies on the PR's CI.

**My own 360px walk** (scratch spec `e2e/qa-walk2.spec.ts`, scratch copy only, against 3102, fixture tag `qb`, generated solid-colour images only):

| Step | Grid (`*` = "Cover" badge) | Rows (`x` removed, `l` live, `*` marked) |
|---|---|---|
| A. 3 uploads | `1*,2,3` | marks `true,false,false` |
| B. remove the marked cover (1) through the AlertDialog | `2*,3` | `x,l,l`: nothing marked; 2 is the cover by derivation |
| C. upload 4 | `2*,3,4` (no sideways scroll) | `x,l,l,l`: **4 did not take the mark** (run 1's defect showed `2,3,4*` here) |
| D. open the derived cover (2) | "Make this the cover" not shown | — |
| E. open 4 | "Make this the cover" shown | — |
| F. record page | the building card shows a cover image | — |
| G. "Make this the cover" on 4 | `2,3,4*`, toast "Cover changed." | `x,l,l,l*` |
| H. remove all, upload 5 | `5*` | `x,x,x,x,l*` |
| I. `added` audit `cover` flags | — | `true,false,false,false,true` |
| J. small controls | none | sideways scroll 0 |

- Screenshots are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/2313dcc4-4a86-43c8-9bfc-694f433ec0be/scratchpad/qa6r2/walk/`. I read `c-after-upload-360.png`: the "Cover" badge is on the oldest live tile, the grid is two columns, and every picture is a generated colour.

**Help walk of `/help/congregation-records` at 360px:**

- 200 in light and dark, sideways scroll 0 in both. I read the dark full-page screenshot.
- The rendered Photos section matches `src/content/help/congregation-records.md:27-39` word for word.
- The cover sentences, read against the build:
  - `:32` "The first photo you add is the cover, and the grid marks it with the word 'Cover'" is **true**. It holds for the first-ever upload (step A) and for the first upload after every photo is removed (step H), and it is not taken by a later upload (step C).
  - `:36` "The button is not shown on the photo that already is the cover" is **true**, including for the derived cover (step D; `photo-reads.ts:157` sets `isCover` from `pickCover`).
  - `:39` "If you remove the cover, the oldest photo left shows as the cover until you choose another" is **true** (steps B to G).

Failures: none.

## Regression Tests Added

I showed each test red myself in the scratch copy, then restored the source and showed it green.

| Fix | Test | Red on the break (my run) | Green |
|---|---|---|---|
| **Item 1: the cover rule** (`93d2eeb4`) | `src/lib/oversight/photo-store.db.test.ts`, "the cover rule — regression for an upload taking the cover after the marked cover was removed: a new photo takes the mark only when the building has no live photo" | Pre-fix `photo-store.ts` from `879df20b` in the scratch copy, file run serially on the branch: **1 failed, 27 passed**, `expected [ false, true ] to deeply equal [ false, false ]` at `photo-store.db.test.ts:361:43` | 28 of 28 in the tree (inside the 737) |
| Item 1, nearby mutant (property check) | same test | A predicate counting every photo ever, removed ones included (`.where(inBuilding(...))`): **red at `:378`**, the "remove all, next upload is the cover" clause | — |
| Item 1, browser step (`9d7cb67d`) | `e2e/oversight-photos.spec.ts:447` | **Not re-shown red by me.** It needs a server running the pre-fix source, and the tree cannot be modified. This rests on the implementer's report (red `expected [false, true] to equal [false, false]` under the pre-fix file on 3102). | passed in the dev lane |
| **Item 2: hub help link at 44px** (`fe261887`) | `src/app/(org)/o/[slug]/admin/reports/page.test.tsx:450`, "the help link under the cards is a 44px target, so a thumb can hit it at 360px" | `reports-hub.tsx:108` className reverted to `"text-primary underline-offset-4 hover:underline"`, which is **byte-identical to the pre-B8 string at `e77658f9` line 104**: **1 failed, 35 passed**, `expected 'text-primary underline-offset-4 hover…' to match /min-h-11/` at `:454:28` | 36 of 36 |

**Property, not logic:**

- The DB test checks the property from both sides: a later upload does not take the mark, and an upload into a building with no live photo does.
- It also checks the two readers that show the cover (`readBuildingPhotos` and `readBuildingCovers`) and the audit metadata, so it would catch a bypass of the same kind, as the mutant showed.
- The item 2 test pins a class token, not a rendered size. That matches the `views.test.tsx` precedent the run 1 report asked for. The 44px result was also measured in run 1's walk.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% (Increment 1 run 1)
- `src/lib/two-factor.ts`: 91.11% (Increment 1 run 1)
- `src/lib/flags.ts`: 100% (Increment 1 run 1)

Neither the diff nor the fix pass touches these, so I did not re-measure them.

## Feature-Gate Audit

**The fix pass touches no protected route or action.** `photo-store.ts`'s change sits after `checkUpload(tx, …, true)` inside the final locked transaction, so the gate order is unchanged: key, flag, preflight, congregation, live building, cap, decode, blobs, then the locked re-check. Run 1's table stands unchanged for `04aacffb`.

## Copy Truthfulness

- [x] **Every added or changed string is in the design's Copy table.**
  - The fix pass adds or changes no user-facing string: the only changes under `src/` are one code predicate, a code comment and tests.
  - The run 1 off-table strings are now ratified in "Orchestrator rulings on Phase 4 copy": `coverBadge`, `saveCaption`, `saving`, the alt fallback "Photo", the `BUILDINGS_COPY` and `INSURANCE_LOANS_COPY` notes and help links, "None in use" per ruling (a), and the tile as a link.
- [x] **The query behind each claim was opened.**
  - The run 1 defect is **resolved**. `photo-store.ts:294-299` (`anyLive === undefined`) now matches `congregation-records.md:32` and `:39`, the cover rule ruling, and Phase 1's "The first photo is the cover" (parent log `:106`).
  - This was shown in the database (the DB test and my red run), in the browser at 360px (walk steps A to H) and in the audit metadata.
  - **copy truthfulness: PASS.**
- [x] **Each instruction was traced to its role.** No change since run 1. "Make this the cover" is offered on every live non-cover photo to manage holders (step E) and works (step G).
- [x] **Older strings about the same subject were grepped.** The fix makes no older string false. `derive.ts:183-187`'s doc comment ("the photo carrying the cover mark, else the oldest") is consistent.
- [x] **Help diff covered.**
  - The fix pass does not edit `src/content/help/` or `src/lib/help/`. `congregation-records` was walked at 360px in light and dark, with the cover sentences read against the build.
  - No image under `src/content/help/images/` changed, so there were no new pixels to read. My walk screenshots show only fixture names and generated colours.

## Verdict

**PASS**

1. **Item 1 (cover rule): resolved.** The fix matches the ruling. The DB regression test was shown red by me on the pre-fix source (`photo-store.db.test.ts:361`), it kills a nearby mutant (`:378`), and it is green on HEAD. The browser step passes, and the 360px walk shows the help's sentences are true.
2. **Item 2 (hub help-link test): resolved.** It was red on the exact pre-B8 class string (`page.test.tsx:454`) and is green on HEAD.

**Still to do at release (not counted as failures):**

- C16's second release-note line must say the Insurance-and-loans file includes each loan's guarantee (orchestrator ruling (b)). The release note does not exist yet, so Phase 6 or `/release-notes` should check it.
- Run 1's other notes stand:
  - the pre-existing 20px year links and "Back to portal";
  - a retired building's photos page still accepts uploads;
  - the caption, cover and remove actions do not read `org_portal.oversight`.

**Run scope:**

- **Ran on `04aacffb`:**
  - typecheck, lint, `npm run check`, build (in the production lane);
  - the full unit suite;
  - `src/lib/oversight`, `src/lib/storage` and `src/lib/person-photos` serially against the pipeline branch, DB-backed tests included;
  - the dev lane: the 6 named specs, 49 tests;
  - the full production lane, 119 tests;
  - the 360px cover walk and the `congregation-records` help walk in light and dark;
  - red runs for both items, plus one mutant.
- **Not re-run, resting on run 1 (`11a3fff7`):**
  - the whole DB-backed suite on a fresh database;
  - `test-rls.sql` and `test-rls-89`;
  - the map lane;
  - `oversight-finance`, `oversight-founder`, `presbytery-oversight`, `hydration/oversight-forms` (dev), `presbytery-dashboard`, `person-photos` and `totp-full-login` in the dev lane;
  - the byte-identity and EXIF probes;
  - the CSV walk.
  - All are untouched by the fix pass.
- **Not run at all:**
  - the full chromium suite (relies on the PR's CI);
  - critical-module coverage (untouched);
  - e2e red-first for `oversight-photos.spec.ts:447` (rests on the implementer's report).

---

**Per-Phase Status row**

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete (run 2) | PASS | 2026-11-18 |

**Handoff:** next is **analyst** (Phase 6, shipped vs intent). The analyst still needs to:

- do a real phone-photo upload on a deployed environment at 360px, with a non-identifying picture that is never committed;
- open both reports and a CSV;
- read `congregation-records`, `presbytery-reports`, `privacy-policy` and `planned/presbytery-tools` as their reader;
- check the C16 guarantee line in the release note.

Logs, the walk spec and the screenshots are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/2313dcc4-4a86-43c8-9bfc-694f433ec0be/scratchpad/qa6r2/`. The main logs are `item1-red.log`, `item1-mutant.log`, `item2-red.log`, `unit.log`, `db.log`, `e2e-dev.log`, `e2e-prod.log`, `walk.log` and `flag-reset.log`, plus `walk/*.png`.

---

# Phase 6 — Shipped vs Intent (analyst)

**Tree:** `/Users/cshenso/git/presby-platform/presby-profile`, `pipeline/congregation-profile-inc2` at `5ced0c2d` (release 0.62.0).
**Date:** 2026-11-18

## VERDICT

**SHIP WITH NOTES.** Nothing needs rework. Each note below is a tracked follow-up, and one is an operator check after deploy.

## ONE-LINE TAKE

> Presbytery staff holding the manage key can add, caption, cover and remove private building photos, and the right key holders can read and download two new reports. The reports leave out street addresses, policy numbers, lenders and notes, and say so, and the help pages match what shipped.

## How I walked it

- I ran my own dev server on port 3102 with the stated environment, against the pipeline Neon branch. It ran inside the worktree, so `.next` and `.tmp` were written there. Both are gitignored, and `git status` is clean at `5ced0c2d` with an empty stash list.
- I stopped the server by PID (98165 and 98182). Nothing is listening on 3102.
- Spec, config, source photo and screenshots are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/2313dcc4-4a86-43c8-9bfc-694f433ec0be/scratchpad/p6/`. Nothing is committed. Every image is generated, and the folder name is non-identifying.
- Flags:
  - `org_portal.oversight` was off at baseline, was switched on for the walk, and is read back **off**.
  - `org_portal.admin_hub` was switched on for one step and is back **off**.
  - `org_portal.reports` stayed **on**.
- I left 0 `e2e-ovs*` organizations behind, and the photo table is back to the seeded 2 rows.
- All pages were walked at 360 px with `isMobile` and touch. The sign-ins used the oversight fixture. The "both" holder was the **founding administrator minted through the real `presby_apply_founding_administrator` definer**, not a custom-role fixture. This increment changes no account-connection or role-grant path, so I did not re-walk an accepted-invitation founder. Increment 1's walk covered that.

## The people it serves

Every page below returned no sideways scroll at 360 px.

| Holder | What I saw |
|---|---|
| **Manage-only** (clerk, no second factor) | The congregation-oversight tile was on the portal home under "Governance & Courts".<br>The list showed a note that Insurance needs the finance permission.<br>The record page showed Profile, Assessment and Buildings open, and Insurance and Loans **Locked** with the permission named.<br>The building page showed "Photos – Add a photo", and "Appraisals" **Locked**.<br>The photos page was empty, then uploaded, then showed the grid with a "Cover" badge.<br>The larger view showed Edit caption, Remove photo and Back to all photos, with no "Make this the cover" on the cover.<br>The record card showed the cover thumbnail, and the building block showed the cover plus "All photos (n)".<br>Buildings report: 2 buildings in 1 congregation, then "Not recorded" for Birch, who has no building ever.<br>Buildings CSV: 200, BOM, CRLF, header exact.<br>Insurance report: the permission line. Its export returned **403**. |
| **Finance-only** (MFA through `/totp`) | The list hid Viability, city, county and buildings behind a note. It showed the "Insurance expires" column.<br>Profile, Assessment and Buildings were **Locked**. Insurance and Loans were open.<br>The building page, the photos page, and the photos page with `?view=<id>` were all **Locked**, with 0 images.<br>Insurance report: Expired in words, "$120,000 / 1 not recorded", the guarantee text, a Total card, and no `$0`.<br>Insurance CSV: header exact, BOM, CRLF. Buildings export returned **403**. |
| **Both** (founding administrator) | Everything above was open, including Appraisals on the building page.<br>Both reports and both CSVs worked.<br>The export audit rows read `{report, rowCount, organizationId}` only.<br>Both reports render as tables at 1100 px. |
| **Neither** (a member with no role) | The list, record, building, photos and hub all returned a refusal. The refusal was **byte-identical for the building and photos URLs**, so it does not reveal whether the building exists.<br>Hub: six Locked cards. Both report pages gave the permission line. Both exports returned **403**. |

### CSV contents (opened and read)

- **Buildings CSV:** the header is the C15 header. Alder's two buildings, then Birch as one row of name, city and county. None of the five sentinels appeared: street address, building note, policy number, lender, loan note.
- **Insurance-and-loans CSV:** the row reads `Alder Mutual,2023,2023-06-30,,,2,120000.00,,2,,Guaranteed by the session in 2019,500000.00,1`. The street address, building and loan notes, policy-number and lender sentinels are absent. **The guarantee is present**, as ruling (b) says.

## Real phone-photo upload, closest local equivalent

- **Test picture:** a generated 12-megapixel portrait scene of 4.7 MB. It has no real subject.
  - It was stored the way a phone stores it: landscape raw pixels 4032×3024, EXIF Orientation 6, camera make and model, and GPS tags.
  - Its upright view puts a red marker top-left, blue sky above, and green ground below.
- **Upload route:** through the real island at a 360 px mobile viewport with touch, as the manage-only clerk.
  - The file input has no `capture` attribute.
  - Its `accept` list is JPEG, PNG, WebP, HEIC and HEIF.
- **Stored master:** 900×1200, JPEG, `audience = private`, 55 KB.
  - **It is upright.** The aspect ratio is 0.7500, the same as the upright source.
  - The top-left pixel is red and the top is blue. I also read the larger view in a screenshot, and it shows red top-left, sky above and ground below.
  - **No location or camera data is stored.** It has no EXIF, ICC or XMP, and no `Exif`, camera make or model, or original filename bytes.
- **Stored thumbnail:** 160×160 WebP, private, no EXIF. The top is bluer and the bottom greener, so it is not rotated.
- **Audit:** one `tenant.oversight_photo.added` row with ids and a `cover: true` flag. No caption or filename is in it.
- **Photo controls the help describes:**
  - A non-image renamed `.jpg` gets "That file isn't a JPEG, PNG or WebP picture. If it's an iPhone photo, pick it from your photo library or convert it to JPEG first."
  - Re-adding the same picture gets "That picture is already in this building's photos."
  - A second photo stays unmarked. "Make this the cover" works, and "Cover changed." shows.
  - The remove dialog reads "Remove this photo? It will no longer be listed here. The picture file itself stays in storage and can't be erased from here." Its buttons are 44 px once the animation settles.
  - Cancel keeps the photo, and the building page then shows "All photos (2)".
- **What this does not prove:** my run was Chromium only. A real deployed-environment upload from an iPhone in Safari and an Android phone in Chrome **remains for the operator after deploy**. The downscale uses `createImageBitmap` with `imageOrientation: "from-image"` and `resizeWidth`. Safari and Chrome may differ in how those two options combine. Local Chromium came out upright with no distortion, but only a real phone settles Safari.

## Help pages read as their reader (360 px, against the build)

- **`congregation-records` — pass.**
  - The Photos section and "Reports from these records" were read in a rendered 360 px screenshot, with no sideways scroll.
  - Each claim matched the build:
    - the permission needed;
    - the grid links;
    - "Cover" on the first photo;
    - the 200-character caption label;
    - Make this the cover being hidden on the cover;
    - the remove dialog and Cancel;
    - the cap-10 sentence;
    - the duplicate refusal;
    - the iPhone hint;
    - "removed from view, not erased";
    - "oldest left shows as the cover" (QA run 2 walked this);
    - "stored privately … never published";
    - the audit trail without the caption.
  - The page is clear to a clerk who has never seen the feature.
- **`presbytery-reports` — pass.**
  - It now says six reports. Both table rows match the Permission column on the hub.
  - The Buildings and Insurance-and-loans sections match the pages. That covers "None in use" versus "Not recorded", Primary, Not recorded, Expired in words, "1 not recorded", Total, and the guarantee.
  - The CSV paragraphs match the files: Buildings "leaves out street addresses and notes". Insurance says it "includes each loan's guarantee" and leaves out street addresses, policy numbers, lenders and notes.
  - The two-factor sentence is true, and the finance page itself says nothing about two-factor.
  - The Administration path works with the admin hub on: "Per-Capita, SASR & Imports" is under "Reports & Insights" and opens the hub.
- **`privacy-policy` — pass.** The building-photos bullet is true.
  - It reads: "stored privately, never published, and removed from view, not erased, when staff remove them."
  - That matches the private audience I read at the database. The page loads at 360 px with no sideways scroll.
- **`planned/presbytery-tools` — pass.** The page says "read six reports", and the portal tile also says six.
- **`limitationUntil` and `[help:]` tokens:** none are involved, and none need removing.
- **`verifiedIn`:** I read the full text of congregation-records and the changed sections of the two others.
  - I recommend moving `congregation-records` to `0.62.0`.
  - I did not re-walk the unchanged map, per-capita and vacant-pulpit sections of `presbytery-reports`, or the rest of `privacy-policy`. I recommend leaving both at `0.60.0` unless the orchestrator accepts a section-level walk.

## What's Working

- **Gating.** Every key and flag gate behaved as Phase 1 intended. The neither-holder refusal does not reveal whether a building exists. The finance-only holder gets no picture, even with a direct `?view=` link.
- **Photos.** The photo pipeline is genuinely safe: orientation and metadata are handled and the blob is private. The failure strings are in plain words, and a failed upload does not show a stack trace.
- **Reports.** The reports are honest about what is missing: "Not recorded", "None in use" and "1 not recorded" replace any false zero. The page and help say what the file leaves out, including the guarantee exception.

## Intent-vs-Shipped Diff

- **Flow 4, photos.**
  - Phase 1 named the failure strings loosely.
  - Shipped: the person-photo strings, building-worded. Phase 3 and the rulings ratified them.
  - Verdict: acceptable drift.
- **Flow 4, "the first photo is the cover".** Matches, after QA's fix. Removing the cover leaves the oldest photo shown as the cover until someone chooses another, and I saw this match the help. Verdict: matches.
- **Flow 8, report contents.** Matches. Neither export has street addresses or policy numbers. Phase 1 said "free-text notes", and ruling (b) amended that to include the guarantee text. Verdict: acceptable drift, honestly disclosed on the page and in the help.
- **Gap 9, departed congregations.** The reports list active members only, and the page says so. Verdict: matches.
- **Empty state.** The photos page with no photos shows "All photos (0)" and an "Add a photo" button, with no sentence. The building block's "Add a photo" is fine. Verdict: acceptable, with a polish note.

## Edge Cases

- Empty state: pass. Birch shows "Not recorded", and a no-photo building shows "Add a photo". The photos page lacks an empty sentence (polish note).
- Failure microcopy: pass. Wrong-type, duplicate and cap refusals are plain words, and QA and B9 pinned the cap and server-failure paths.
- Permission gate: pass, enforced on pages, exports and direct URLs for all four holder types.
- Audit event: pass. Photo and export rows are written, and I saw one `added` row and the export rows.
- Mobile (360 px): pass. No sideways scroll anywhere. The upload island's own 1 px file input is by design. The hub's four year links are 20 px, and they are pre-existing.
- Help pages read as their reader: pass for all four.

## Rulings on QA's standing notes

1. **A retired building's photos page still accepts uploads.** Accepted as is. A retired building (sold or closed) is still a record whose history stays, and a photo from before the sale is plausible. Phase 1 and C14 are silent. It is noted as a decision follow-up, not a defect.
2. **The caption, cover and remove actions don't read `org_portal.oversight` (upload does).** Accepted. This is the same as the existing platform pattern in `docs/TODO.md:140`. The permission check holds on all four. I fold these actions into that TODO line.
3. **The pre-existing 20 px year links and "Back to portal".** Not this pipeline's. I re-measured the year links at 20 px, on the hub for the clerk, finance-only and neither holders. The shared `/admin` "Back to portal" link is already on `docs/TODO.md:137`. I add the hub year links to that line.

## Follow-Ups (each becomes a `docs/TODO.md` line, Rule 10)

1. **Operator, after deploy:** do a real phone-photo upload at 360 px on an iPhone (Safari) and an Android phone (Chrome), using any non-identifying picture and not committing it. Check that it lands upright with no location data, and that an iPhone HEIC picks up the iPhone hint if needed. This closes the planned deployed-environment upload. The operator must also switch `org_portal.oversight` on in production (an open line at `docs/TODO.md:141`).
2. **Fold into `docs/TODO.md:140`:** the caption, cover and remove photo actions also do not check the flag.
3. **Add to `docs/TODO.md:137`:** the reports hub's year links ("‹ 2024", "2026 ›") are 20 px. Also add the photos page's empty state, which has no sentence beside "All photos (0)". The Buildings cards repeat the congregation heading on each building, and "Not recorded" repeats down the cards, which is noisy but honest.
4. **Decision line (low priority):** should a retired building's photos page refuse uploads, or stay open for history? Currently it stays open.
5. **Move `verifiedIn`:** set `congregation-records` to `0.62.0`. `presbytery-reports`, `privacy-policy` and the planned page stay as they are unless the orchestrator accepts my section-level read.

## Housekeeping at SHIP

- **Rule 12.** The Source block records operator decisions, not a feedback row, so there is no row to mark `done`.
- **Rule 13.** No what's-new entry, per the operator's standing rule. Drafts stay in work-logs.
- **Rules 10, 14 and 15.**
  - Move the Increment 2 line (`docs/TODO.md:133`) to Done and add the follow-ups above.
  - Update the functionality map: six reports, building photos.
  - `docs/architecture.md` needs no update, because there is no new subsystem. The `src/lib/storage/image/` extraction is a Project Layout line in `CLAUDE.md`, which the Phase 3 handoff lists for integration.
- **Release.** `docs/release-notes/v0.62.md` and the `package.json` bump to 0.62.0 do not exist yet. They come through `/release-notes`.

## Draft member-facing release note (work-log only)

> **Photos and two new reports for a presbytery's congregation records (0.62.0)**
>
> - Staff who manage congregation oversight can now add photos to a building on a congregation's record. Choose a picture from your phone's photo library or camera, add a caption, and mark one as the cover. A building keeps up to 10. The picture is shrunk on your phone first and saved without its location or camera details. Photos are private to the presbytery's staff and are never published.
> - When you remove a photo, it is removed from view but not erased: the picture file stays in storage and can't be erased from here. Rarely, if a photo fails to save partway, a stray file can be left behind. It is not shown anywhere.
> - Two new reports join the four on the reports page. "Buildings" needs the permission to manage congregation oversight. "Insurance and loans" needs the permission to manage congregation property finances.
> - Each report has a spreadsheet download. The Insurance-and-loans file includes each loan's guarantee. Both files leave out street addresses, and the Insurance-and-loans file also leaves out policy numbers, lenders and notes. Downloads are recorded.

I read it against `docs/schema-design.md` residuals in the work-log: it does not deny a removed photo's file staying, nor a stray file after a failed save. It does not say "no notes" about the guarantee.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-11-18 |

## Handoff

Next: the **orchestrator**, for the Rule 10, 14 and 15 housekeeping (TODO, functionality map), the `/release-notes` entry for v0.62 with the draft above, the 0.62.0 bump, and the `verifiedIn` move. The deployed-environment phone-photo upload is for the operator after deploy.

---

