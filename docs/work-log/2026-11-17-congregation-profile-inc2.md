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
| 4 — Implementation | api-developer (B5, B7), ux-developer (B6, B8), full-stack-developer (B9) | B5, B6 complete (2026-11-18); B7 to B9 pending | — | 2026-11-18 |
| 5 — Verification | qa | Pending | — | — |
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

**Handoff.** B5 and B6 are done (2026-11-18). Next: **api-developer** (B7, reports) and **ux-developer** (B8, report pages and help), then **full-stack-developer** (B9).

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
- [ ] Help diff covered: every labels string is on screen, every claim walked at 360px, every committed image opened

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
- Help pages read as their reader (each page named in Help impact): [pass | fail | no help impact]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
