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
| 5 — Verification | qa | Complete (run 1) | FAIL | 2026-11-18 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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
- Help pages read as their reader (each page named in Help impact): [pass | fail | no help impact]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
