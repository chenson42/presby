# Site ingest over the request-size limit — Work Log

> **Slug:** `2026-10-26-site-ingest-size`
> **Surface:** public site ingest (`POST /api/sites/ingest`) + `presby-site-kit` ingest workflow
> **Permission(s):** existing (OIDC-authenticated repo identity)
> **Flag(s):** not needed (no new platform flags pre-live)
> **Estimated complexity:** medium
> **Pipeline mode:** Bug-fix variant
> **Numbers (pre-assigned):** F324 (the defect); DECISION-279 if a decision results; migration 0077 if any schema; dev port 3610
> **Worktree:** `/Users/cshenso/git/presby-platform/presby-ingest`, branch `pipeline/site-ingest-size`, from `main` 21beebc (0.44.0)
> **Symptom (2026-10-26):** `site-fpcw` run 40251133138 — `Ingest failed with status 413: Request Entity Too Large` / `FUNCTION_PAYLOAD_TOO_LARGE`. The built bundle is 37,794,098 bytes (14 pages, 81 images); Vercel caps a function request body at 4.5 MB. Production already holds 107 FPCW `blob_assets` (28 MB) from an August load. Every earlier `site-fpcw` run failed too; `site-pasturechurch` only succeeds because its placeholder bundle is tiny.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; Gaps 1–14; Open Questions 1–4 | READY WITH NOTES | 2026-10-26 |
| 2 — Architectural review | architect | Complete; R1–R14, S1–S3; DECISION-279 proposed; no migration (0077 unused) | Approved with suggestions | 2026-10-26 |
| 3 — Technical design | tech-lead | Complete; Batch A (site-kit) ready now, Batch B (presby) gated on F289 Batch 2 | Design complete, implementers named | 2026-10-26 |
| 4 — Implementation | full-stack-developer (Batch A, site-kit); api-developer (Batch B, presby) | Batch A complete (site-kit `ad109b1`, 235 tests green, not pushed); Batch B complete (presby `96784a7` + `7ef67b6`; BR-1 green with the real client; not pushed) | Batch A + Batch B green | 2026-10-26 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst), bug-fix variant (brief)

Work-log: `docs/work-log/2026-10-26-site-ingest-size.md`. Read at main `21beebc` in `/Users/cshenso/git/presby-platform/presby-ingest`. I also read the F289 worktree `/Users/cshenso/git/presby-platform/presby-assets` (Phases 1–3 plus its uncommitted Batch 1 files) and `/Users/cshenso/git/presby-platform/presby-site-kit`. I opened no production or development connection. I quote no site-fpcw content. Only file sizes and counts from that repo appear here.

## VERDICT

**READY WITH NOTES.** The bug is real and it is purely a transport problem. Nothing about what the ingest stores or publishes is wrong; the whole bundle just can't fit in one request. Phase 2 (architect) is required: the fix adds endpoints and a wire protocol, and it collides with F289 in three files. Two items need an operator or coordinator ruling before Phase 3 (Open Questions 1 and 2).

## ONE-LINE TAKE

> A church's site repo can't publish because the CI job sends every image, base64-encoded, in one 37.8 MB request against a 4.5 MB platform cap. The fix is to send only the images the server doesn't already hold, in small content-hash-verified pieces, and then commit a small manifest-and-pages request that flips the live site only after every image is confirmed present.

## Confirmed from code

**The bug.**
- `site-kit/.github/workflows/ingest.yml` reads the whole `bundle.json` and sends it in one `fetch(url, { body })`.
- `build-bundle.mjs` `buildImages()` base64-embeds every file under `images/` into `bundle.images[].bytesBase64`.
- The 413 comes from the Vercel platform before any route code runs. No `maxDuration` or route config can raise it. I found no body-size setting in `next.config.ts` or `vercel.json`.
- Sizes from the site-fpcw checkout, counts and bytes only:

| Measure | Value |
|---|---|
| Images | 81 (80 JPEG, 1 PNG), 28,318,225 raw bytes |
| Base64 of those images | about 37.76 MB |
| Content | 14 files, 38,230 bytes total, largest 5,789 |
| Bundle total | 37,794,098 (matches the work-log header) |

- The images are 99.9% of the payload. **The pages are about 38 KB and are never the problem.**
- No single image is over 4.5 MB. The largest is 1,430,225 bytes (about 1.9 MB base64). A per-image request fits with margin, and the 4.5 MB per-image limit is not a live constraint today.
- **Still unbounded:** the server accepts a blob up to 10 MB (`MAX_BYTE_SIZE`, mirrored by the DB CHECK), so a 4.5–10 MB image is storable but can't be sent in one request. The design needs a stated policy for it. No file in site-fpcw triggers it.
- Duplicate `manifestKey` check: there are none in fpcw. Today `buildImages()` uses `path.basename(file, ext)`, so `a.jpg` and `a.png` would silently overwrite each other in `imageKeys`. That is a latent gap in the same code.

**Keying today.**
- The manifest key is the file's basename without extension.
- Server-side, `store()` computes sha256 of the bytes and dedups on `(organization_id, content_hash)` (unique `blob_assets_org_hash_key`). It returns the row's own uuid as the `key`. The key is deliberately not the hash.
- The route builds `imageKeys: { manifestKey -> blob uuid }` and stores it inside a JSON blob together with the pages.
- That JSON blob (`application/json`) is stored as a `blob_assets` row, and `organization_sites.content_bundle_key` is pointed at it.
- The renderer resolves `imageUrl(manifestKey)` through `site.imageKeys`.
- The client sends no hash. A re-ingest therefore re-uploads every byte, and the server dedups only after receiving and hashing it. Dedup saves storage and does nothing for the wire.

**Mapping.** A bundle image becomes one `blob_assets` row, or reuses an existing one by hash. Two manifest keys with identical bytes share one blob. The bundle JSON becomes one more row per distinct publish. Production already holds 25 such JSON rows, and nothing garbage-collects them (all deletes are soft, and `delete` isn't granted).

**Atomicity today.**
- The route runs the OIDC check, then the `sites.public_render` flag (503), then org lookup by repo (404), then the `last_ingested_commit_sha == claims.sha` short-circuit (`already_current`), and only then parses the body.
- It then stores each image in its own transaction, stores the bundle JSON, and runs **one** `UPDATE organization_sites` (`recordSiteIngest`). That update sets `content_bundle_key`, `last_ingested_commit_sha` and `last_ingested_at`. The audit row and the revalidation come after.
- Readers see the old site until the single UPDATE. A page can't reference a not-yet-stored image, because `imageKeys` is built from the keys `store()` just returned.
- Failure mid-way leaves orphan image rows and possibly an orphan bundle JSON. It never leaves a half-published site.
- Because the commit sha is written last, a re-run of the same sha is safe. That sha-last property is the thing a multi-request design must not lose.
- Two small existing non-atomic gaps, both survivable: the UPDATE and the audit write are separate statements, and the revalidation runs after both.

**Concurrency today.** There is no `concurrency:` group in `ingest.yml`, and the server can't order shas. Two overlapping runs are each internally safe, but the later arrival wins even if it carries the older commit. Today's window is seconds. A multi-request publish makes it minutes.

**OIDC.**
- `verifyGithubActionsOidcToken` checks the signature (RS256 hardcoded), `exp`, issuer, audience, owner, `ref == refs/heads/main`, `event_name`, and the `job_workflow_ref` prefix. It returns `repository` and `sha` from the verified payload only.
- It is stateless. Each request needs its own valid token, and nothing in the code links one request to the next.
- The JWKS is cached per instance for 1 hour.
- `core.getIDToken()` can be called again in the same job to get a fresh token, with the same `sha` claim.
- A GitHub OIDC token lives only minutes, which I'm stating from general knowledge. The `exp` value in a real run is unverified, so Phase 3 should measure it, or simply re-fetch a token per request, which makes the lifetime irrelevant.

**Existing tests.** `ingest/route.test.ts` is a DB-backed integration test with 8 `describe` blocks covering 401, 404, 422 malformed, 422 sniff, 200 happy path, idempotency and suspended status. No test pins request size or wire shape beyond the happy path. `site-kit/test/build-bundle.test.ts` pins the bundle builder.

**Rollout coupling.** site-fpcw (and site-pasturechurch) call `ingest.yml@main` in the site-kit repo. A change merged to site-kit `main` takes effect on every site's next push, with no per-site pin, while the platform side only changes when the operator promotes a release. The two repos will not deploy together.

## F289 coordination (public-asset allowlist, migration 0072)

F289 is in Phase 4. Batch 1 is the uncommitted migration, Batch 2 is unbuilt, and the `docs/work-log` copy is current at Phase 3. It does change the ingest's blob writes, and this fix must be built on top of it, not around it:

1. **Audience.** `store()` gains a required `audience`. The image store at `route.ts:212` becomes `"public_site"`, and the bundle JSON store at `:239` becomes `"private"`. The audience must be a string literal at each call site.
2. **Dedup key.** It becomes `(organization_id, audience, content_hash)`. Any "which of these hashes do we already hold" check this fix adds must ask for `public_site`, or it will report an image present that a bundle can't use.
3. **A source-scan test** (`audience-callsites.test.ts`) lists every non-test `getBlobStore().store/resolve` call in `src/` against a checked-in `{file → audience}` table. Every new route file this fix adds that calls the store needs a row, and the plan, upload and commit paths must carry the right literal.
4. **DECISION-030** keeps `blob_assets` queries inside `blob-store.ts`. A "which hashes exist" lookup therefore needs a new method on the adapter. That is the same file F289 rewrites, so the two pipelines will collide there.
5. **Files both pipelines edit:** `ingest/route.ts`, `ingest/route.test.ts` (F289 lists it among its mock-asserting tests) and `blob-store.ts`. Under Rule 16 the integration is serialized.
6. **Production facts F289 records** (its 2026-10-25 read-only measurement): 107 blobs (82 images, 25 JSON), one site holding a bundle, one brand mark. That matches this log's "107 FPCW blobs (28 MB)".
   - 82 is 81 bundle images plus the mark.
   - The deployment doc says `fpcw`'s `last_ingested_commit_sha` is a scratch placeholder, so the August load wrote a placeholder sha and bundle.
   - 0072 flips every image named by a current bundle's `imageKeys` to `public_site`.
   - So if the repo's 81 images are byte-identical to the August ones, they will already exist as `public_site` rows, and a content-hash plan would report zero missing. The first real publish would then be a single small commit request and would not need to upload 28 MB.
   - **That is unverified**, and I can't verify it from this seat. The operator can compare `content_hash` values read-only. If the images differ, the first publish uploads everything once.
   - If 0072 has not been applied when the fix ships, the existing rows have no audience column yet. Order matters; see Open Question 2.
7. **Old code against the new schema.** F289 itself notes that old ingest code inserts omit `audience` and land `private`, and a re-ingest heals that. This fix must not be the "old code" in that window.

## User Verbs

The ingest has no human on the keyboard. Its actor is a machine caller, CI authenticated as a repo identity, which is none of the four surfaces. A fifth surface should be written into the design: the **GitHub Actions run log**, which is the only UI the operator sees.

| Surface | Verb | Cadence |
|---|---|---|
| Site-repo editor (operator or congregation staff) | Pushes content or an image to `main` | Per edit, in bursts |
| Same person, in GitHub | Reads the run log; re-runs a failed run | On failure |
| CI (OIDC repo identity) | Asks which images are missing; uploads them; commits | Once per push |
| Anonymous visitor | Reads the site and sees the new images | After a publish |
| Platform admin | `/admin/organizations/<id>` shows site status and last commit sha | Occasional |

## Flows

**Flow 1 — Publish (the new normal).** The push to main triggers the workflow. The build step reads the pages and images and computes a sha256 and size for each image. A plan request sends the manifest of hashes and sizes only, and the server answers either `already_current` or the list of missing hashes. The client uploads the missing images in batches, each request carrying a fresh OIDC token and staying under a stated byte ceiling. A commit request sends the pages plus the manifest (`manifestKey → {sha256, contentType}`). The server confirms every hash is present as a `public_site` image in that org, derives `imageKeys` itself, stores the bundle, runs `recordSiteIngest`, audits and revalidates, then answers `ingested`.
- Failure: every step writes a human line in the run log that names the image (by manifest key) and the step, for example "image `<key>`: upload rejected, not a PNG, JPEG or WEBP". An HTTP 413 must never reach the operator again.

**Flow 2 — Retry after a partial failure.** The operator re-runs the failed job. The plan request now reports fewer missing hashes, because the earlier uploads are already stored. It converges.
- Failure: the site is unchanged until commit, so visitors never see a half-site.

**Flow 3 — A push that changes no images.** The plan returns an empty missing list and the run goes straight to commit, a small request. A push whose sha was already ingested returns `already_current` from the plan step, and the client skips everything.

**Flow 4 — An image too big for one request.** The client checks sizes before sending anything and fails the run early with a line naming the file and the limit. The server independently rejects anything outside what it accepts.

**Flow 5 — Two pushes close together.** See Gap 5.

**Flow 6 — A small site (the tiny placeholder bundle).** It must still publish, whichever side deploys first. See Open Question 1.

## Permissions & Flags

- **Permission(s):** none. Authorization is the OIDC repo identity: the signature plus all the claim checks, and `repository` resolving to exactly one `organization_sites` row. No `FEATURES.*` key applies (Permissions vs Flags still holds; this route never used `hasFeature`).
- **Default roles:** n/a.
- **Flag(s):** `sites.public_render` stays the gate, and **every** new endpoint or phase must return the existing 503, not only the commit. No new flag (per the operator rule against new platform flags before go-live). Rollback is a revert in site-kit `main` (a one-line workflow change), plus the server keeping the old single-POST shape working.

## What the fix must preserve

1. The OIDC repo-identity check, on every request. Never take an org or sha from the body.
2. The `sites.public_render` 503, on every request.
3. The 404 when the verified repo has no `organization_sites` row, and the idempotent `already_current` short-circuit. It should fire at the plan step so a repeat push uploads nothing.
4. **Commit-sha bookkeeping written last.** `last_ingested_commit_sha` must be set only at the end of a successful commit. This is what makes a retry safe.
5. All-or-nothing publication: the new bundle becomes live in the single `recordSiteIngest` UPDATE, and only after every referenced image is confirmed present.
6. Magic-byte sniffing of each image (never trust the declared type), and the existing PNG, JPEG and WEBP allowlist.
7. The `SITE_CONTENT_INGESTED` audit event, written once per publish with a null actor and the same metadata fields (`repo`, `commitSha`, `pageCount`, `imageCount`), and the `revalidatePath` calls.
8. Suspended sites stay suspended after a publish (`recordSiteIngest`).
9. The reserved-path validation of pages.
10. F289's audience literals (images `public_site`, bundle `private`).

## Candidate fix shapes

| # | Shape | Preserves | Cost and risk |
|---|---|---|---|
| A | **Content-addressed plan, then upload only what's missing in size-bounded requests, then a small commit.** Stateless on the server; `blob_assets` is the staging area. | All of the above; a repeat push with unchanged images is one tiny request. | A new wire protocol (3 request kinds), a new adapter method, and new routes or a discriminator. No schema change expected (so no migration 0077). Does not by itself handle an image above the wire cap. |
| A1 | A, with raw binary request bodies, one image per request. | Same. | No base64 inflation, so 1.43 MB is 1.43 MB; the cap is hit only at about 4.4 MB. Simplest server parse; about 81 requests on a cold start. |
| A2 | A, with base64-in-JSON batches under about 3 MB of raw bytes. | Same. | Fewer requests (about 10), but a 33% inflation budget to manage, and one failed image fails a batch. |
| B | Direct-to-storage with signed URLs. | — | Blobs live in Postgres bytea (DECISION-030). There is no object store, so this means a new store and a new dependency, which is out of proportion for a bug fix. **Not recommended.** |
| C | Compression. | — | The images are already JPEG, so gzip gains nothing. Server-side re-encoding (a new image dependency) changes the bytes and breaks hash identity. Client-side downscaling in CI changes the content the congregation chose. **Not recommended** as the fix. A resize step could be an optional later helper. |
| D | A staging table plus a multipart session. | — | A new table and a session lifecycle with a janitor, to solve what hash-addressing already solves statelessly. Heavier and unneeded. |

I side with A (A1 or A2 is a design call for Phase 3). On the oversize case: reject an image above the wire cap with a clear client-side message ("image `<key>` is N MB; the limit is about 4 MB; resize it"), and record chunked upload as a tracked follow-up, since no real image comes near it.

## Gaps the Request Didn't Address

1. **Order and compatibility with F289 (and the migration) is undecided.** Both pipelines edit the same three files. Resolve which merges first. My recommendation: F289 lands first, and this fix is built on the `store({audience})` and `resolve` signatures from the start. Otherwise the second to merge reworks the first. The new endpoints must also be added to F289's source-scan table.
2. **Mixed-version rollout.** The site-kit workflow is `@main` and takes effect immediately for every site, while the platform deploys when the operator promotes. If site-kit ships first, new clients hit a server that doesn't have the new endpoints. If the server ships first, old clients keep working (assuming the old single-POST shape stays). Either keep the legacy POST working indefinitely and have the client use it for small bundles, or document "server first, then site-kit". The tiny bundle (site-pasturechurch) must keep publishing in every ordering.
3. **The server-derived `imageKeys` is a new trust boundary.** The commit request must resolve each declared hash to a `public_site` image in the caller's org itself. A page that references a manifest key with no image should fail with a clear message. The client must never supply blob uuids.
4. **Upload integrity.** The server must recompute the sha256 of the uploaded bytes and reject a mismatch with the declared hash; it must not trust the declared hash for the dedup lookup. Sniff the magic bytes on each upload as today.
5. **Concurrent pushes.** Add a `concurrency` group keyed on the repository to `ingest.yml`. Decide whether an older sha can overwrite a newer one. The server can't order shas, so the workflow-level group is the practical guard, and the remaining residual should be written down.
6. **Orphans.** A failed or abandoned publish leaves image rows that no bundle references, and `public_site` images have no takedown (F289 Tier 1). Today's failure mid-loop already leaves the same orphans, so this is not a new class, but it becomes more frequent. All deletes are soft, so no garbage collection is possible now. Record it as an accepted residual and a tracked follow-up.
7. **Token lifetime across many requests.** Fetch a fresh OIDC token per request, or measure `exp`. Do not assume one token spans a 2–5 minute upload.
8. **Wire-size ceiling.** State a per-request ceiling with margin under 4.5 MB (including JSON, headers and base64 inflation). Include a client test that fails if any request exceeds it.
9. **Failure microcopy.** Today the run log shows a raw HTTP status plus body. The new client should print what failed (which image, which step), not only the status.
10. **A masked failure behind the 413.** Every run since August failed at the size cap before reaching auth, flag or org lookup. When the cap is fixed, the first real run may surface a second, separate failure (a missing repo variable, an unprovisioned `organization_sites` row for the repo, the flag off). The deployment doc says the first real fpcw ingest publishes the whole migrated site and needs the operator's explicit go. Phase 5/6 verification therefore needs a dev-side end-to-end with a bundle over 4.5 MB, plus the operator's go before the production run.
11. **Duplicate or colliding manifest keys.** Make the client fail on two files that resolve to the same manifest key, so one doesn't silently overwrite the other.
12. **The audit trail.** The commit stays the only audit write (one event per publish). Consider adding uploaded-versus-reused counts to the metadata so an operator can see what a publish actually did.
13. **Request-level bounds.** Cap the count of manifest entries and the size of a plan request, and reject an empty or oversized manifest. Validation is server-side, never by trusting the client's own check.
14. **Memory and time.** Today the route parses a 37 MB body and runs 82 sequential transactions in one invocation, with no `maxDuration` set. The new per-request work is small, so no setting should be needed. Leave the default and say so in the design.

## Edge cases the request didn't mention

- **2FA gate:** not applicable (machine caller, no session).
- **Audit:** addressed in Gap 12. This is a content publish by a repo identity and not a role, permission, flag or 2FA change, but the existing event stays.
- **Empty state:** a first ingest for an org with no blobs: the plan lists every hash as missing, and the flow still works. An empty `images` array is allowed today and should remain valid.
- **Failure microcopy / DB down:** each phase must answer a clean error, not a stack trace. The client must treat a non-OK response from any phase as a failed run with a readable line.
- **Mobile 360px:** not applicable to the ingest. The visitor-facing check is whether the published images render, which is a Phase 5 browser step.

## Adversarial pass

- **Redirect targets:** none in this flow.
- **State-machine shortcut:** a caller can hit the commit request without the plan or upload. The commit must therefore be self-validating (Gap 3) and never rely on "the plan was called". With a stateless design this is safe by construction.
- **Pre-upload of arbitrary bytes by a hostile workflow:** `job_workflow_ref` limits the caller to site-kit's own workflow, and `site_kit_ref` is a workflow input defaulting to `main`. That is the existing trust model and I'm not changing it. The image allowlist, sniff and size cap on the upload path bound what a compromised content repo can store in its own org.
- **Enumeration:** the plan only answers about the caller's own org, derived from the verified repo claim, so it can't be used to probe other orgs' blobs. The existing 404 wording stays specific, because the caller is GitHub's trusted CI.
- **Input boundaries:** all validation server-side (count, size, hash format as 64 hex characters, content type, manifest key length). Add an overlong or Unicode manifest-key case.
- **Replay:** a captured valid token plus a different body is possible today and remains. The token authenticates repo and sha, not body content. Nothing in this design widens that.
- **Self-targeting:** not applicable.

## Out of Scope (confirm with user)

- Chunking a single image over the wire cap (no real image needs it).
- A takedown or garbage collection of unreferenced `public_site` blobs (F289 already tracks the takedown).
- Server-side image re-encoding or resizing.
- Replacing Postgres blob storage with an object store.
- Any change to how pages or `site-kit` blocks render.

## Open Questions

1. **Compatibility.** Keep the legacy single-POST accepted indefinitely, with the client using it for small bundles, or switch every site to the staged protocol and document "server first"? My recommendation: keep legacy, so neither repo's deploy order can break a site.
2. **Order with F289 and migration 0072.** Does this fix wait for F289 to merge and be applied, or is it written against F289's `store()` signature in parallel? My recommendation is the latter, merged after F289. The coordinator needs to say.
3. **Operator read-only check** (cheap and valuable): compare the `content_hash` values of the 81 files in the site-fpcw `images/` directory against production's fpcw `blob_assets`. If they match, the first publish will upload nothing, and the design can promise "first publish is one small request".
4. **Oversize policy.** Confirm "fail the run early with a clear message above the cap" is acceptable until a real image needs chunking.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; Gaps 1–14; Open Questions 1–4 | READY WITH NOTES | 2026-10-26 |

(Date per the work-log header. The system date here reads 2026-10-25.)

## Handoff

Next agent: **architect** (Phase 2). Please rule on: whether the protocol is one route with a phase discriminator or several routes (the proxy already passes all `/api/*`); the placement of the new "which hashes exist" lookup in `blob-store.ts` (DECISION-030); and the `audience-callsites` scan entries for any new route file that calls the store. The ordering against F289 (Gap 1) and the mixed-version rollout (Gap 2) are inputs to the architect, but Open Question 2 needs the coordinator's ruling first. Phase 3 should pin the client's per-request byte ceiling with a test and carry Gaps 3–14 into its Edge Cases table, each citing the test that pins it.

Files read (all absolute):
- `/Users/cshenso/git/presby-platform/presby-ingest/src/app/api/sites/ingest/route.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/app/api/sites/ingest/route.test.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/sites-ingest-auth.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/storage/blob-store.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/sites.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/db/domain/assets.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/docs/deployment.md`
- `/Users/cshenso/git/presby-platform/presby-site-kit/.github/workflows/ingest.yml`
- `/Users/cshenso/git/presby-platform/presby-site-kit/scripts/build-bundle.mjs`
- `/Users/cshenso/git/presby-platform/presby-assets/docs/work-log/2026-10-25-public-asset-allowlist.md`
- `/Users/cshenso/git/presby-platform/presby-assets/drizzle/0072_presby_blob_audience.sql`
- `/Users/cshenso/git/presby-platform/site-fpcw/.github/workflows/` (workflow call shape and file sizes only)

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.**

The staged, content-addressed transport (Phase 1 shape A) fits the starter's structure. It needs:
- no schema change, so migration 0077 is not used;
- no new dependency in either repository;
- no change to the proxy;
- no change to `docs/architecture.md`.

The suggestions are listed under Notes. Phase 3 must carry R1–R14 forward.

Code was read at `presby-ingest` 35df45d (`main` 21beebc), F289's `presby-assets` at 225de07 plus its uncommitted Batch 1, and `presby-site-kit` at 8ca982a. As instructed, I opened no database connection. Step 5 of my review process (reading the live catalog) applies to changes in schema, RLS or grants. This pipeline makes none: the new lookup is an organization-scoped SELECT on `blob_assets` through `presby_app`, which `resolve()` and `store()` already run. The coverage that replaces the catalog read is a DB-backed test of the new method under `presby_app` on this pipeline's Neon branch, after 0072 is applied (R13).

## Placement

- **Routes: three separate routes, not one route with a phase field.** Each is POST, at a fixed path with no dynamic segment, under the existing endpoint:
  - `src/app/api/sites/ingest/plan/route.ts`: a JSON manifest goes up; the server answers `already_current`, or the list of hashes it is missing.
  - `src/app/api/sites/ingest/images/route.ts`: the raw bytes of one image per request. The declared sha256 and the manifest key travel in request headers, never in the path.
  - `src/app/api/sites/ingest/commit/route.ts`: JSON with the pages plus `images: [{ manifestKey, sha256 }]`.
  - `src/app/api/sites/ingest/route.ts`: the legacy single POST stays (orchestrator ruling OQ1). Its request body does not change.

  Why separate routes:
  - The upload body is binary and the other two are JSON. One handler would have to branch on the body type.
  - Each route gets its own small validator, its own size limit and its own test file.
  - Vercel's logs show which step failed.
  - **The client builds all three URLs from the `presby_ingest_url` input it already has** (it appends `/plan`, `/images`, `/commit`). No site repository needs a new variable.
  - Next allows a `route.ts` in a folder and more `route.ts` files in its subfolders.

- **Shared server module: `src/lib/sites-ingest.ts`** (`server-only`). It is a flat file next to `sites-ingest-auth.ts`, not a new folder, and is not a new top-level module. It holds:
  - **`authorizeIngest(req)`**, the gate every request passes through, in the existing order: OIDC check, then the 503 when `sites.public_render` is off, then the 404 when no site is provisioned for the repo, then `already_current` when the commit sha is already ingested. It returns `{ org, claims }` or a ready-made response. **All four routes call it, the legacy route included.**
  - **The page validator** (the reserved-path checks), moved out of the legacy route so the legacy route and commit validate pages the same way.
  - **`storeSiteImage(org, bytes)`**: magic-byte sniff, then `store({ audience: "public_site" })`. Used by legacy and upload.
  - **`publishSiteBundle({ org, claims, pages, imageKeys, imageCount, transport })`**, the tail end of a publish: store the bundle with `audience: "private"`, then `recordSiteIngest`, then the audit row, then `revalidatePath`. **Used by both legacy and commit, so the two ways of publishing cannot drift apart.**

  Because of this, **the routes call no `getBlobStore()` method directly.** Every audience literal lives in `src/lib/sites-ingest.ts`.

- **Lookup placement: a new method on the blob adapter in `src/lib/storage/blob-store.ts`** (DECISION-030):
  ```ts
  findByContentHashes(input: {
    organizationId: string;
    audience: BlobAudience;                 // required; a string literal at the call site
    contentHashes: readonly string[];       // each /^[0-9a-f]{64}$/, de-duplicated, length 1..MAX
  }): Promise<Map<string, BlobRef>>         // keyed by lowercase hex hash; absent = not held
  ```
  - It runs inside `withTrustedOrgContext`, with `where organization_id = $ and audience = $ and content_hash = any($)`.
  - It never selects `bytes`.
  - It throws `BlobValidationError` for a malformed or over-limit hash list. The route checks the same things first; this is a second guard.
  - 0072's `blob_assets_org_audience_hash_key (organization_id, audience, content_hash)` already provides the index it needs, so **no migration**.

- **How it builds on F289:**
  - The method uses F289's `BlobAudience` and `BlobRef` types (R6).
  - Its `audience` argument follows F289's rule: required, and a string literal at the call site.
  - F289's source scan (`audience-callsites.test.ts`, U4) needs two edits when this pipeline merges:
    - **(a)** Add `findByContentHashes` to the scan's list of methods that must carry an audience.
    - **(b)** Remove the table row for `src/app/api/sites/ingest/route.ts`, which will have no calls left, and add a row for `src/lib/sites-ingest.ts`. That row lists its calls in source order: `store:public_site`, `findByContentHashes:public_site`, `store:private` (the order is fixed when the file is written).

  Edit (a) changes the scan's logic once. That is justified because the adapter itself gained a method. See suggestion S1 for a way to avoid even that.

- **Server vs Client split:** no React. Route handlers only. `'use client'` does not apply.

- **Dependencies:** none, in either repository.
  - presby: sha256 comes from `node:crypto`; the sniff reuses `sniff.ts`.
  - presby-site-kit: no `@actions/core` dependency. The token getter is passed in from `actions/github-script` (R10).

## Invariants Touched

- **Proxy and the custom-host lockdown: no change, confirmed by reading `src/proxy.ts:58–100`.**
  - On a platform host, the `/api/*` pass-through at `:100` covers the three new paths.
  - On a custom host, the first branch sends every path except the four exact cron paths to `/site/<host>/…`. That gives the same neutral 404 for `/api/sites/ingest/*`.
  - `CRON_PATHS` and `check:proxy-imports` are untouched.
  - **One constraint this rests on:** the proxy's matcher skips any path that ends in `.png`, `.jpg` and similar (F151), so such a path never reaches the custom-host branch.
    - The new routes must be **fixed paths with no dynamic segment.** The hash and the manifest key go in headers or the body, never in the path.
    - Otherwise `/api/sites/ingest/images/<key>.jpg` would bypass the proxy and answer on a church's domain.
- **The proxy does not reach the database:** unaffected. The proxy is not edited.
- **A custom host is a key, not an identity:** unaffected. The ingest is a platform-host-only machine route.
- **Permissions vs flags:**
  - No `FEATURES.*` key is involved.
  - Authorization is the OIDC repository identity, verified **on every request** by the shared gate. Organization and sha come only from the verified claims, never the body (DECISION-087).
  - `sites.public_render` returns 503 on every step.
- **DECISION-030:** the one new `blob_assets` read is in `blob-store.ts`. F289's second U4 check (raw SQL on `blob_assets` appears nowhere else) stays satisfied.
- **F289 / DECISION-277 audiences:**
  - Images: `store` with `public_site`, and the lookup asks for `public_site`.
  - Bundle JSON: `store` with `private`.
  - All three are literals in `sites-ingest.ts`.
  - A hash held only as `private`, or only by another organization, counts as missing. Asking only for `public_site` is what prevents publishing a bundle the public asset route cannot serve.
- **Isolation / RLS:** the lookup filters `organization_id` and runs with the trusted organization setting on the RLS-enforced connection, the same way the other three methods do. RLS and grants are unchanged.
- **Audit:**
  - `SITE_CONTENT_INGESTED` is written once per publish, on both the legacy and commit paths, through the shared publish function. Actor and the existing fields (`repo`, `commitSha`, `pageCount`, `imageCount`) are unchanged, with `imageCount` counted as manifest entries on both paths.
  - Add `transport: "legacy" | "staged"` as a metadata field.
  - Uploads write no audit row. Uploading only stages content inside the caller's own organization; nothing is published until commit. That matches today, where each image store is unaudited.
  - `check:audit` does not scan route files (DECISION-084), so the route tests must assert the audit row.
- **Never hard-delete:** a failed or abandoned run leaves image rows that no bundle uses, and nothing is collected. This is an accepted residual (Notes).
- **No Real Data:**
  - Fixtures in both repositories are synthetic generated bytes (a valid PNG or JPEG header plus filler).
  - presby-site-kit is public (MIT, `private: false`).
  - No site-fpcw file, name or image enters either repository, the work-log or any commit message. Counts only, as Phase 1 did.
- **`docs/architecture.md` (Rule 15): no change.** §8 says content is converted and "handed to the platform". This change is below that level: no new subsystem, no change to how data flows into storage, no change to runtime shape.

## Notes

**Rulings Phase 3 must honor**

- **R1 — Who decides how images are keyed.**
  - The client never sends, and never receives, a blob uuid.
  - Commit maps each `{ manifestKey, sha256 }` through `findByContentHashes(public_site)` and builds `imageKeys` itself.
  - Any hash that is not held fails the commit with a 422 that names the manifest keys.
  - Content type comes from the stored row. Even so, require it to be one of the three image types, as a second check.
  - Plan and upload responses carry hashes only. **A test asserts that no plan, upload or commit response contains a uuid-shaped string.** An uploaded-but-uncommitted `public_site` image can only be fetched by its uuid, so never disclosing that uuid is what keeps those rows unreachable.
- **R2 — Upload integrity.**
  - The server computes sha256 of the received bytes itself and rejects a mismatch with the declared hash (422).
  - It sniffs magic bytes and passes the sniffed type to `store()`.
  - It never hands the declared hash or declared type to the store.
  - `store()`'s de-duplication uses the hash the server computed.
- **R3 — Request size limits.**
  - Use one app-enforced limit, `4,000,000` bytes per request body (about 11% under Vercel's 4.5 MB cap). It applies to all four routes, the legacy route included.
  - The server checks `Content-Length` and the number of bytes actually read, and answers over-limit bodies with the JSON error format, status 413.
  - **This makes the app's own limit the binding one.** A local dev server, which has no platform cap, then behaves the same as production, so tests can exercise the limit, and an operator never again sees Vercel's plain-text 413.
  - The client has the same constant, pinned by a test in presby-site-kit.
  - Images between 4,000,000 bytes and the 10 MB store cap fail the run early, on the client, with a line naming the image and the limit (OQ4). Chunked upload is a tracked follow-up.
  - Also cap the number of manifest entries (Phase 3 picks the value; about 2,000 is enough), manifest-key length and allowed characters, and the hash format. All checked on the server.
- **R4 — `already_current` on every step.** It comes from the shared gate, so a re-run of an already-ingested sha writes nothing on any route. The client treats it as success and stops.
- **R5 — The stored bundle keeps its current format** (`{ schemaVersion: 1, pages, imageKeys }`), so the renderer, `hydratePublishedSite` and F289's public route do not change. The commit request is a new wire format on a new route; its version field is separate from the stored bundle's.
- **R6 — When the commit sha is written, and that publishing is all-or-nothing.**
  - `recordSiteIngest` stays a single UPDATE.
  - It runs only after every hash is confirmed held and the bundle JSON is stored.
  - Plan and upload never write `organization_sites`.
- **R7 — Duplicate hashes.** The client uploads each distinct hash once.
  - FPCW has two byte-identical files.
  - F289 Edge Case 17 notes that two simultaneous `store()` calls for identical bytes can race and hit a unique-key violation. Parallel uploads of the same hash would trigger it.
  - Commit maps both manifest keys to one blob.
  - Test both on each side.
- **R8 — Manifest-key collisions** (`a.jpg` and `a.png` both becoming key `a`) fail in `build-bundle.mjs` with a readable line, for both transports.
- **R9 — No `maxDuration` and no runtime override.** Each request handles at most one image or one manifest lookup. Leave the default and state it in the design (Gap 14).
- **R10 — Where the site-kit client lives.**
  - The client goes in **`presby-site-kit/scripts/ingest.mjs`**, an ES module next to `build-bundle.mjs`. Its main function, `runIngest({ getToken, fetch, log, fail, ... })`, has everything passed in.
  - `ingest.yml` keeps `actions/github-script@v7`. The inline script shrinks to: load `.site-kit/scripts/ingest.mjs` and call it with `getToken: () => core.getIDToken(audience)`. That keeps GitHub's own token call and adds no dependency.
  - `build-bundle.mjs` gains a manifest output (file path, `manifestKey`, sha256, byte size and sniffed type for each image; no base64). The legacy bundle can still be produced from it.
  - **Choosing the transport** (OQ1): if the serialized legacy bundle is at most 4,000,000 bytes, use legacy; otherwise use staged.
  - **Fresh OIDC token for every request**: plan, each upload, commit. The test checks that `getToken` is called exactly as many times as `fetch`.
  - Error lines name the step and the manifest key.
  - If the staged plan URL returns a 404 whose body is not the JSON error format, the line reads "the platform does not support staged ingest yet". That covers a site-kit release that reaches `main` before the server does.
- **R11 — Concurrency.**
  - Add `concurrency: { group: presby-site-ingest-${{ github.repository }}, cancel-in-progress: false }` at **job level** in `ingest.yml`. Inside a called workflow, `github.repository` is the calling site's repository.
  - Runs for one repository are then strictly serialized, and GitHub collapses pending runs to the newest.
  - `cancel-in-progress: false` is deliberate. It avoids a cancelled run's in-flight commit landing after its successor's.
- **R12 — Where the tests go.**
  - **presby:**
    - A DB-backed test of `findByContentHashes`: it asks for the right audience, rejects other organizations, and never selects bytes.
    - A unit test for `sites-ingest.ts`: validators, limits, and a table-driven gate test across all four handlers showing the same 401 / 503 / 404 / `already_current` order.
    - A DB-backed `route.test.ts` next to each new route.
    - One DB-backed run in-process through plan, upload and commit with synthetic images that total more than 4.5 MB. It asserts every request is within the limit and that the published `imageKeys` resolve through `resolvePublic`.
    - The F289 U4 table edits.
  - **presby-site-kit:**
    - `test/ingest.test.ts`, with `// @vitest-environment node` because the default environment is jsdom, using a fake `fetch` and token getter.
    - An extended `test/build-bundle.test.ts` (manifest output, collisions).
  - **Do not add any test-only JWKS or token override to production code.** A local end-to-end run with the real client against `next dev` is therefore not available. The coverage that stands in for it is the in-process run above.
- **R13 — Build order against F289** (OQ2).
  - The presby-site-kit work has no dependency on F289 and can start now.
  - The server work in Phase 4 builds on F289 once F289 Batch 2 is committed. Merge F289's branch into `pipeline/site-ingest-size`. Use no rebase across worktrees and never `git stash`.
  - This pipeline's Neon branch needs 0072 applied before its DB-backed tests run.
  - The merge to `main` is serialized after F289 (Rule 16).
- **R14 — Release and rollout order.**
  1. Apply 0072 to production, then promote F289 (its runbook).
  2. Promote this pipeline's server. The new routes sit unused and the legacy route is unchanged.
  3. Merge the presby-site-kit change to `main`. That takes effect for every site immediately; bump presby-site-kit's minor version and note that only the workflow and scripts changed.
  4. Run FPCW's first real ingest only with the operator's explicit go (Gap 10).

  Notes on the order:
  - site-pasturechurch stays on the legacy path no matter the order.
  - Rollback is a revert on presby-site-kit `main`. Large bundles then go back to failing, as today; small ones are unaffected.
  - The workflow file comes from `@main`, but the scripts come from `inputs.site_kit_ref`. A site that pins `site_kit_ref` to a tag older than this release is unsupported. The workflow should fail with a readable line if `ingest.mjs` is missing.
  - `docs/deployment.md` records the order and the rollback.

**Accepted residuals** (record in the decision and `docs/TODO.md` at integration)

- **Uploaded but never published images.** A failed or abandoned run leaves `public_site` rows that no bundle uses. They can only be fetched by uuid, which no ingest response discloses. Nothing collects them, and they have no takedown until F289's Tier 2. The class already exists (the legacy route can fail partway through its loop); it becomes more frequent.
- **Re-running an old run.** Manually re-running an older failed run after a newer run succeeded republishes the older content. The server cannot order commit shas, and the concurrency group only serializes runs; it does not order them.
- **The upload path may first run in production well after release.**
  - Production has no preview deployments (`docs/deployment.md:50–57`), so the only real test against Vercel's cap is production itself.
  - If OQ3 holds, FPCW's first run is plan plus commit only.
  - **One caveat on OQ3:** the 80 hashes are present, but 0072 marks rows `public_site` only when the current bundle's `imageKeys` names them. Any of the 80 not named there stays `private`, and the plan will correctly report it missing.
  - So Phase 3 copy and release notes must not promise "the first publish uploads nothing".

**Suggestions** (not blocking)

- **S1:** Route through the orchestrator to F289's Batch 2. Have U4 treat every `getBlobStore().<method>` call as needing an audience literal, except a named list of exemptions (`resolvePublic`). A later method then needs only a table edit, which matches U4's own stated rule that "the test logic never changes".
- **S2:** Give the upload request a `Content-Type: application/octet-stream` header. The server ignores the client's type entirely; the sniff decides.
- **S3:** An optional `ingest.yml` input, `transport: auto | staged | legacy` (default `auto`), would let the operator deliberately prove the staged upload path on site-pasturechurch with a one-off change to its calling workflow. That closes the third residual on the operator's schedule. Phase 3's call.

**Proposed DECISION-279** (orchestrator records it):

> **DECISION-279: Site ingest gains a staged, content-addressed transport. The legacy single POST stays.**
> - Three fixed-path routes, `POST /api/sites/ingest/{plan,images,commit}`, share one gate (OIDC, then flag 503, then repo 404, then `already_current`) and one publish function (private bundle store, `recordSiteIngest`, audit, revalidate) with the legacy route. The client picks legacy only when the whole bundle is at most 4,000,000 bytes.
> - The server keeps no session state; `blob_assets` is the staging area.
> - Commit builds `imageKeys` on the server from sha256s held as `public_site` in the caller's organization, through a new `BlobStore.findByContentHashes({ organizationId, audience, contentHashes })` (DECISION-030; audience a literal per DECISION-277). The client never sends or receives a blob uuid.
> - The server recomputes the hash and sniffs every upload.
> - One app-enforced 4,000,000-byte limit per request makes the platform's 4.5 MB cap unreachable and testable locally.
> - No schema change, no dependency, no proxy change; fixed paths only, because the matcher's extension exclusion (F151) would otherwise expose a dynamic `*.jpg` segment on custom hosts.
> - The presby-site-kit client is a tested ES module (`scripts/ingest.mjs`) with its token getter passed in. It fetches a fresh OIDC token per request, and runs are serialized per repository by a job-level concurrency group.
> - Rollout: server first, then presby-site-kit `main`.
> - Accepted residuals: images uploaded but never published (no takedown until F289 Tier 2); re-running an older run republishes older content.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete; R1–R14, S1–S3; DECISION-279 proposed; no migration (0077 unused) | Approved with suggestions | 2026-10-26 |

(The date follows the work-log header; the system date here reads 2026-10-25.)

## Handoff

The next agent is **tech-lead** (Phase 3). Points to carry:
- Carry R1–R14 and Phase 1 Gaps 3–14 into the Carry-forward and Edge Cases tables, each with the test that pins it.
- Fix the wire contract, keeping header names, error format and limit identical in both repositories.
- Settle the manifest entry cap and whether uploads run one at a time or a few in parallel. If parallel, the client must still upload each distinct hash once (R7).
- Rule on S3.
- Name the implementers. I suggest api-developer for presby and full-stack-developer for presby-site-kit, with the site-kit part able to start now.
- Route S1 to the F289 coordinator before F289's Batch 2 writes U4.

Files read:
- `/Users/cshenso/git/presby-platform/presby-ingest/docs/work-log/2026-10-26-site-ingest-size.md`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/app/api/sites/ingest/route.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/app/api/sites/ingest/route.test.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/storage/blob-store.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/sites-ingest-auth.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/sites.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/db/domain/assets.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/proxy.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/domains/cron-passthrough.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/docs/architecture.md`
- `/Users/cshenso/git/presby-platform/presby-ingest/docs/deployment.md`
- `/Users/cshenso/git/presby-platform/presby-ingest/docs/decisions.md`
- `/Users/cshenso/git/presby-platform/presby-ingest/docs/schema-design-2.md`
- `/Users/cshenso/git/presby-platform/presby-assets/docs/work-log/2026-10-25-public-asset-allowlist.md`
- `/Users/cshenso/git/presby-platform/presby-site-kit/.github/workflows/ingest.yml`
- `/Users/cshenso/git/presby-platform/presby-site-kit/scripts/build-bundle.mjs`
- `/Users/cshenso/git/presby-platform/presby-site-kit/package.json`
- `/Users/cshenso/git/presby-platform/presby-site-kit/vitest.config.*`
- `/Users/cshenso/git/presby-platform/site-fpcw/.github/workflows/` (calling workflow only)
- `/Users/cshenso/git/presby-platform/site-pasturechurch/.github/workflows/deploy.yml` (calling workflow only)

---

# Phase 3 — Technical Design (tech-lead), bug-fix variant

Read against the live trees on 2026-10-25: presby `pipeline/site-ingest-size` at `1f545d5` (main `21beebc`, 0.44.0), `presby-site-kit` `main` at `8ca982a` (v4.0.0, tags through `v4.0.0`), and F289 (`presby-assets`, `pipeline/public-asset-allowlist` at `225de07` plus its uncommitted Batch 1). Phases 1 and 2 and the four orchestrator rulings above are carried in full. No database was opened. No site-fpcw or site-pasturechurch content is quoted; counts only.

## Root cause

**Symptom.** `site-fpcw` run 40251133138: `Ingest failed with status 413: Request Entity Too Large` / `FUNCTION_PAYLOAD_TOO_LARGE`.

**Cause.** The ingest transport is one request that carries the whole site. `build-bundle.mjs` `buildImages()` base64-embeds every file under `images/` into `bundle.images[].bytesBase64`, and `ingest.yml` sends `bundle.json` in a single `fetch`. Base64 inflates 28,318,225 bytes of images to about 37.76 MB, and Vercel refuses any function request body over 4.5 MB **before route code runs**, so no setting in the route can raise the cap. The stored shape, the sniff, the dedup and the publish are all correct; only the transport is wrong.

**Why nothing caught it.**
1. The risk was named and parked. `docs/work-log/2026-08-20-public-sites.md` Phase 3 (line 1237) listed "Vercel request-body size limits on ingest" as flagged for a pre-deploy check "once real site-kit content exists"; Phase 6 follow-up 2 (line 3074) says it was "never tracked". Nothing in `docs/TODO.md` carried it, so no owner ran the check.
2. Every ingest test sends an 8-byte PNG (`route.test.ts` `PNG_MAGIC_BYTES`). No test sent a body near any limit, so the happy path proved nothing about size.
3. The cap exists only on the Vercel platform. `next dev` and an in-process handler call have no cap, and this project has no preview deployments (`docs/deployment.md:50-57`), so production was the first place the cap could bite. The August load of FPCW's images was a scratch load (the deployment doc calls `last_ingested_commit_sha` a scratch placeholder), not a CI run, so no successful CI run had ever carried them.
4. Masking: every earlier `site-fpcw` run failed too, but earlier causes are inferred (missing repository variables), not known (the logs have expired).

**What the fix changes.** The transport, and nothing the visitor sees. Images travel one per request, content-addressed, only the ones the platform does not hold; the commit request carries pages plus `{manifestKey, sha256}` and the server derives every blob key itself. The stored bundle (`{ schemaVersion: 1, pages, imageKeys }`), the renderer, `recordSiteIngest` and the audit event are unchanged.

## Summary

Add a staged, content-addressed transport beside the legacy single POST (DECISION-279, orchestrator ruling OQ1: legacy stays). Three fixed-path routes under `/api/sites/ingest` (`/plan`, `/images`, `/commit`) share one gate and one publish function with the legacy route, through a new `src/lib/sites-ingest.ts`; one new adapter method, `BlobStore.findByContentHashes`, answers "which of these hashes does this org hold as `public_site` images". The `presby-site-kit` client becomes a tested ES module (`scripts/ingest.mjs`) that sends the legacy request when the whole bundle fits under 4,000,000 bytes and the staged sequence otherwise, with a fresh OIDC token per request, readable run-log lines, retries, and a per-repository concurrency group. One app-enforced limit of 4,000,000 bytes per request body makes Vercel's 4.5 MB cap unreachable and testable on a local server. No schema change, no dependency in either repository, no proxy change, no flag.

## Permissions & Flags

- **Permission key(s):** none. Authorization is the OIDC repository identity, verified on every request; organization and commit sha come only from verified claims (DECISION-087). No `FEATURES.*` key, no `hasFeature`.
- **Default role bindings:** n/a.
- **Feature flag(s):** not needed (operator rule: no new platform flags before go-live). The existing `sites.public_render` stays the gate and returns 503 on **every** route, plan and upload included. The existing route suite sets `sites.public_render` on for its run and restores the original value; the new route tests do the same through the shared harness. No `e2e-baseline-flags.sql` key is needed (see e2e blast radius).
- **Rollback:** a revert on `presby-site-kit` `main` (large bundles then fail as today; small ones are unaffected). The server routes stay harmless when unused.

## API Contract

**This section is the wire contract. It is pinned identically in both repositories**: each repository holds a constants block with exactly these literals and a test that asserts them literally (presby `SI-4`/`SI-9`, site-kit `KI-1`), and the Phase 5 bridge run (`BR-1`) drives the real client against the real handlers so the two cannot drift unseen. There is no shared package; the work-log text is the specification.

### Constants

| Name | Value | Notes |
|---|---|---|
| `MAX_REQUEST_BYTES` | `4000000` | Per request **body**, all four routes. A body of exactly 4,000,000 bytes is accepted; 4,000,001 is refused. About 11% under Vercel's 4.5 MB. Decimal MB throughout (1 MB = 1,000,000). |
| `MAX_MANIFEST_ENTRIES` | `2000` | Max `images` entries in a plan, a commit and a legacy bundle. |
| `MAX_IMAGE_BYTES` | `4000000` | An image is one request body, so it equals `MAX_REQUEST_BYTES`. Between 4,000,000 and the store's 10,485,760 fails early on the client (OQ4). |
| `PROTOCOL` | `1` | Header `x-presby-ingest-protocol: 1` on `/plan`, `/images`, `/commit`. Not sent on the legacy POST. Missing or any other value: 422 `unsupported_protocol`. |
| Hash header | `x-presby-sha256: <64 lowercase hex>` | On `/images` only. Uppercase, short or long: 422 `invalid_request`. |
| Manifest key | 1 to 200 UTF-16 code units, no U+0000 to U+001F and no U+007F | The same rule on both sides. Everything else (spaces, Unicode, `.`) is allowed because today's keys are bare file names. `__proto__` is allowed and must survive (the server builds `imageKeys` with `Object.fromEntries`). |
| Hash in a body | `^[0-9a-f]{64}$` | Lowercase only. |
| Image size in a plan | integer 1 to 4000000 | |
| Paths | `{base}/plan`, `{base}/images`, `{base}/commit` | `base` is `presby_ingest_url` with trailing `/` removed. The legacy POST goes to `base`. Fixed paths, no dynamic segment (the proxy matcher excludes any path ending in an image extension, F151). |
| Token | `authorization: Bearer <fresh GitHub OIDC token>` | A new `getIDToken` per request, retries included. |
| Request timeout | 120 s per attempt (client) | |
| Attempts | 3 per request, sleeps 1 s then 3 s (client) | Retry on a thrown fetch or any HTTP status 500 or above. Never on 4xx. |

### Common server behavior (all four routes, in this order)

1. `authorizeIngest(req)`: verify the OIDC token (401) -> `sites.public_render` (503) -> resolve the organization by the verified repository (404) -> if the verified `sha` equals `last_ingested_commit_sha`, answer `200 already_current` and stop (R4). Nothing is written before this passes, and the body is not read until it does.
2. Protocol header check (staged routes only).
3. Bounded body read (`MAX_REQUEST_BYTES`): refuse on a declared `Content-Length` above the limit without reading; otherwise count the bytes actually read and stop at the limit. Over limit: 413 `request_too_large`.
4. Route logic. Any uncaught throw becomes a JSON 500 (`server_error`, no stack, one `console.error` that carries no request content).

**Error body (every non-2xx, all four routes, additive for legacy):**

```json
{ "status": "error", "code": "<code>", "error": "<human text>" }
```

Closed code set: `unauthorized` 401 · `site_not_provisioned` 404 · `ingest_disabled` 503 · `request_too_large` 413 · `invalid_json` 422 · `invalid_request` 422 · `unsupported_protocol` 422 · `hash_mismatch` 422 · `not_an_image` 422 · `images_not_uploaded` 422 · `reserved_page` 422 · `image_rejected` 422 · `server_error` 500. A client recognizes "our format" as a parseable JSON object whose `status` is the string `"error"`.

### `POST {base}/plan`

Request: `content-type: application/json`, the common headers, body `{ "images": [ { "sha256": "<hex>", "size": <int> } ] }`. `images` may be empty. Entries must be distinct by `sha256` (a repeat is 422 `invalid_request`). `size` is validated (1 to 4000000) and not otherwise used by the server; the server never trusts it for anything.

Response 200: `{ "status": "planned", "missing": [ "<hex>", ... ] }`, in request order; `missing` is every hash **not held by this organization as a `public_site` image**. A hash held only as `private`, or only by another organization, is missing. Or `200 already_current` from the gate. Writes nothing (R6).

### `POST {base}/images`

Request: `content-type: application/octet-stream` (ignored by the server; the sniff decides, S2), the common headers, `x-presby-sha256`, body = the raw bytes of **one** image. Server: gate -> bounded read -> empty body is 422 `invalid_request` -> compute sha256 itself; a mismatch with the header is 422 `hash_mismatch` -> sniff magic bytes; not PNG, JPEG or WEBP is 422 `not_an_image` -> `store({ audience: "public_site", contentType: <sniffed> })` through `storeSiteImage`.

Response 200: `{ "status": "stored", "sha256": "<hex>", "byteSize": <int>, "contentType": "image/png|image/jpeg|image/webp" }`, or `already_current`. No uuid anywhere (R1). Writes no audit row (staging inside the caller's own organization; nothing is published). Re-uploading held bytes is a 200 and adds no row (the adapter dedups on `(organization_id, audience, content_hash)`).

### `POST {base}/commit`

Request: `content-type: application/json`, the common headers, body:

```json
{ "schemaVersion": 1,
  "pages":  [ { "path": "/", "frontMatter": {}, "mdxAst": {} } ],
  "images": [ { "manifestKey": "<key>", "sha256": "<hex>" } ] }
```

`schemaVersion` is the **stored bundle's** page-shape version (same meaning as the legacy bundle's); the **wire** version is the header. `pages` non-empty and validated exactly as today (shared validator, reserved paths included). `images` may be empty; each `manifestKey` unique within the request, two keys may share a `sha256` (R7).

Server: gate -> protocol -> bounded read -> validate -> `findHeldSiteImages(org, distinct hashes)` (`findByContentHashes`, `public_site`) -> any entry whose hash is not returned, or whose returned `contentType` is not one of the three image types, is 422 `images_not_uploaded` naming up to 20 manifest keys -> build `imageKeys` with `Object.fromEntries` -> `publishSiteBundle(... transport: "staged")`.

Response 200: **identical to the legacy success body** `{ "status": "ingested", "organizationSlug", "commitSha", "pageCount" }`, or `already_current`. No uuid in any response (R1).

### `POST {base}` (legacy, unchanged request)

Body `{ "bundle": { schemaVersion: 1, pages, images: [ { manifestKey, contentType, bytesBase64 } ] } }` and the success body are unchanged. Changes: it goes through `authorizeIngest` and `publishSiteBundle`, reads its body under `MAX_REQUEST_BYTES` (413 above), refuses more than `MAX_MANIFEST_ENTRIES` images (422 `invalid_request`), and errors gain `code`. The audit metadata gains `transport: "legacy"`.

### Client behavior (pinned; `presby-site-kit/scripts/ingest.mjs`)

1. Build the manifest (hash and size every image, sniff, collision check). Fail early on any local problem (oversize, empty, not an image, collision, over 2,000 entries, commit body over the limit). **Nothing is sent** in those cases.
2. Choose the transport: `legacy` when the exact serialized legacy body is at most 4,000,000 bytes, otherwise `staged`. The workflow input `transport` (`auto` default, `staged`, `legacy`) can force either (S3).
3. Staged: de-duplicate by hash (R7); `POST /plan`; upload each missing hash **one at a time**, in manifest-key order, to `/images`; `POST /commit`. `already_current` from any step is success and stops.
4. `fail` becomes a thrown `IngestFailure` (a refinement of R10's `fail` callback: stopping after a callback is awkward to test); the loader maps it to `core.setFailed`.
5. Redirects are not followed (`redirect: "manual"`): `PRESBY_INGEST_URL` pointing at the apex host would drop the `Authorization` header across a cross-origin redirect and surface as a misleading 401.

### Decisions made here

- **Sequential uploads, not bounded-parallel.** The cold start is 80 requests of at most 1.43 MB each; at about a second apiece that is a couple of minutes inside a job limit measured in hours. Parallelism would add failure ordering, a fan-in of GitHub token requests (rate limit unknown), a heavier database connection burst, and the identical-bytes race of F289 Edge Case 17, to save wall-clock nobody is waiting on. A first failure stops the run and names exactly one image. **Revisit if** a site routinely uploads more than about 500 images in one run or a run exceeds five minutes; the change is local to the upload loop, and the server is already safe against concurrent identical uploads (below).
- **The server is robust to the race anyway.** `storeSiteImage` retries `store()` once when it throws a Postgres unique violation (`23505`, read from `err.code` or `err.cause.code`), because the second attempt's dedup SELECT finds the row. That closes F289 Edge Case 17 for this path regardless of client concurrency (`SI-6`, `UP-10`).
- **S3: adopted.** `ingest.yml` gains `transport` (string, default `auto`). It lets the operator deliberately prove the staged path on a live site by a one-line change to a calling workflow, on the operator's schedule. **Honest limit:** `site-pasturechurch` has zero images (`images/` is empty), so forcing staged there proves auth, the plan and the commit on the real Vercel stack but **not an upload**. Proving an upload in production needs at least one image in some site repo; the first FPCW run is that proof if any image is missing. See the runbook.
- **No aggregate storage quota.** A compromised content repo can already call the legacy route repeatedly; the staged routes do not change that class. Per-request, per-entry and per-image bounds are enforced; a per-organization byte budget is a follow-up if one is ever wanted (tracked at integration).
- **A page that references an image key the commit does not declare is not validated, in either transport.** Phase 1 Gap 3 mentioned it; Phase 2 R1 narrowed the ruling to the hash path. The server cannot know which block props are image references, and the renderer already degrades to "no image" for an unknown key. Unchanged behavior, listed under Out of Scope for the user to confirm.
- **Token per request; no cache.** If GitHub throttles `getIDToken` on a cold 80-image run (unverified), the mitigation is a token reuse window below the token's `exp`, with an injectable clock. Not built; the first FPCW run is the evidence.

## Data Model

No schema changes required. Migration 0077 is not used. The new lookup reads `blob_assets` through the RLS-enforced `presby_app` connection and is served by the unique index `blob_assets_org_audience_hash_key (organization_id, audience, content_hash)` that F289's 0072 creates (`BD-5` asserts the index exists on the pipeline's branch, so a branch without 0072 fails loudly instead of scanning).

## Component / Page Plan

No pages, no components. Route handlers and libraries only.

### presby (`/Users/cshenso/git/presby-platform/presby-ingest`)

**Create**

- `src/lib/sites-ingest.ts` (`server-only`): the constants above; `authorizeIngest(req)`; `readBoundedBody(req)`; `errorResponse(status, code, error)` and the handler wrapper (JSON 500); `validatePages` (moved, text unchanged); `validateManifestKey`/`validateSha256`; `storeSiteImage(org, bytes)` (sniff -> `store({ audience: "public_site" })`, one retry on `23505`); `findHeldSiteImages(org, hashes)` (the only caller of `findByContentHashes`; short-circuits an empty list); `publishSiteBundle({ org, claims, pages, imageKeys, imageCount, transport })` (`store({ audience: "private" })` -> `recordSiteIngest` -> `recordAudit` -> `revalidatePath`). **Source order of the three store calls is fixed: `storeSiteImage`, then `findHeldSiteImages`, then `publishSiteBundle`**, because F289's call-site table lists calls in source order. No route calls `getBlobStore()` (`SI-13`).
- `src/app/api/sites/ingest/plan/route.ts`, `images/route.ts`, `commit/route.ts`, each with a `route.test.ts` beside it.
- `src/app/api/sites/ingest/staged-flow.test.ts` (in-process, DB-backed).
- `src/lib/storage/blob-store-find.test.ts` (mocked `@/lib/db`) and `src/lib/storage/blob-store-find.db.test.ts` (real `presby_app`).
- `src/lib/testing/site-ingest-harness.ts`: the RSA keypair, JWKS stub, token signer, fixture orgs and flag flip now inlined in `route.test.ts`, extracted once so the four route tests and the flow test share it. It calls no store method, so F289's scan ignores it.

**Modify**

- `src/app/api/sites/ingest/route.ts`: thin: gate, bounded read, `validateBundle` (kept here; legacy-only), per-image `storeSiteImage`, `publishSiteBundle(... "legacy")`. Rewrite the header comment (lines 16-48: it describes one POST bundle and the response contract; add the staged routes and the `code` field).
- `src/app/api/sites/ingest/route.test.ts`: the whole existing suite stays and must pass **unchanged** except (a) the audit `toEqual` at `:752` gains `transport: "legacy"`, and (b) it imports the harness. New cases `LG-2` to `LG-7`.
- `src/lib/storage/blob-store.ts`: `findByContentHashes` on the `BlobStore` interface and `PostgresBlobStore`; header comment. (After F289 Batch 2 merges into this branch; the types come from F289.)
- `src/proxy.test.ts` (platformPaths at `:342`): add the three paths. `e2e/custom-domains/lockdown.spec.ts` (`PLATFORM_PATHS` at `:87`, POST list at `:150`): add the three paths.
- `src/lib/storage/audience-callsites.test.ts` (F289's file; see below).
- `docs/product/functionality-map.md:100` (Ingest line): at ship time.
- `docs/deployment.md`: the staged-ingest paragraph and the rollout order, **at integration** (F289 Batch 2 also edits this file).
- `package.json` version and `docs/release-notes/`: after Phase 6, via `/release-notes`.

### presby-site-kit (`/Users/cshenso/git/presby-platform/presby-site-kit`; work in a **new worktree**, see Implementation Order)

**Create**

- `scripts/ingest.mjs`: `runIngest({ repoRoot, ingestUrl, getToken, fetch, log, sleep, transport })` returning `{ outcome, transport, uploaded, reused }` or throwing `IngestFailure`; `runFromGithubScript({ core, repoRoot, ingestUrl, audience, transport })` (wires `core.getIDToken`, maps failures to `core.setFailed`); the constants block; `formatBytes`.
- `test/ingest.test.ts` (`// @vitest-environment node`; the package default is jsdom), `test/ingest-workflow.test.ts`.

**Modify**

- `scripts/build-bundle.mjs`: `buildManifest(repoRoot)` (pages plus `images: [{ manifestKey, contentType, sha256, size, file }]`, sorted by `manifestKey`, no base64), a client-side sniff, `legacyBodyBytes(pages, images)` (exact size without building the 37 MB string), the collision check in **both** `buildBundle` and `buildManifest` (R8), and a `--manifest` CLI flag. **The default CLI output is unchanged**: `node build-bundle.mjs <root> <out>` still writes the legacy bundle (the FPCW integration step in `docs/TODO.md:237` depends on it). Update the header comment.
- `.github/workflows/ingest.yml`: add input `transport`; job-level `concurrency: { group: presby-site-ingest-${{ github.repository }}, cancel-in-progress: false }` and `timeout-minutes: 30`; drop the `Build content bundle` step; the `github-script` step shrinks to the loader (existence guard, dynamic `import()` of `.site-kit/scripts/ingest.mjs`, `runFromGithubScript`). Header and input descriptions rewritten (Copy `W`).
- `test/build-bundle.test.ts`: manifest, collision, `legacyBodyBytes`, CLI cases.
- `README.md`: a "Publishing a site (ingest)" section.
- `package.json` and `package-lock.json`: `4.0.0` -> `4.1.0`. `dist/` is tracked but no `src/` file changes, so no rebuild. Commit `feat: v4.1.0 -- ...`; the operator tags `v4.1.0` after merge.

### Neighbours (existing strings and docs this change makes stale)

| Where | What it says | Action |
|---|---|---|
| `src/app/api/sites/ingest/route.ts:16-48` | Header: a single POST of "a normalized content bundle", response contract without `code` | Modify (above) |
| `.github/workflows/ingest.yml:3-14, 20, 28` (site-kit) | "Builds the JSON bundle ... and POSTs it"; `site_kit_ref` "to pull build-bundle.mjs from" | Modify (Copy `W`) |
| `scripts/build-bundle.mjs:1-7` (site-kit) | "the JSON shape POST /api/sites/ingest expects" | Modify: still true for legacy; add the manifest sentence |
| `site-pasturechurch/README.md:17-19` | "builds a JSON bundle ... and POSTs the bundle to presby's POST /api/sites/ingest" | **Operator's repo.** Suggested wording: "sends the site to presby's `/api/sites/ingest`, in one request or, for a large site, in steps." Not edited by this pipeline |
| `docs/product/functionality-map.md:100` | Ingest line: "bundle validation + per-image magic-byte sniffing" | Modify at ship time |
| `docs/deployment.md:225-227` (the `site-fpcw` carries neither variable) and `:888-895`; `docs/TODO.md:100` | `site-fpcw` has no `PRESBY_INGEST_URL`/`PRESBY_OIDC_AUDIENCE` | **Possibly already stale.** Run 40251133138 reached the platform edge and got a platform 413, which needs a non-empty ingest URL. The orchestrator should confirm with the operator and reconcile at integration. This design does not assert either way |
| `docs/TODO.md:237` | `node ../presby-site-kit/scripts/build-bundle.mjs <repo> <out>` | Still true (default CLI unchanged) |
| `docs/architecture.md` | no mention of ingest transport | No change (Rule 15) |

## F289 coordination

F289 is Phase 4 (Batch 1 running, Batch 2 not started). This pipeline builds on F289's `store({ audience })` / `resolve` / `BlobAudience` / `BlobRef` and merges **after** it (orchestrator ruling OQ2; 0072 applied to production first).

**Exact `audience-callsites.test.ts` edits when this pipeline merges** (F289's U4 design: an `ACTIVE` table of existing files, a `FORWARD` table of documented future rows):

1. **Remove** the `ACTIVE` row `src/app/api/sites/ingest/route.ts: ["store:public_site", "store:private"]` (the legacy route no longer calls the store).
2. **Add** `src/lib/sites-ingest.ts: ["store:public_site", "findByContentHashes:public_site", "store:private"]` (move it from `FORWARD` to `ACTIVE` if S1(2) below was adopted; otherwise add it to `ACTIVE`).
3. **Method list (only if S1(1) was not adopted):** add `findByContentHashes` to the set of methods the scan requires an `audience` string literal for. Its argument is `{ organizationId, audience, contentHashes }`, so the existing "first argument's object literal" reader works unchanged.
4. **No rows** for `plan/route.ts`, `images/route.ts`, `commit/route.ts`: they call no store method (`SI-13` pins that they do not import `getBlobStore`). F289's second U4 check (the count of `getBlobStore(` call expressions equals the count of matched calls) holds because `sites-ingest.ts` has exactly three calls.
5. `src/lib/storage/blob-store.ts` is the file F289 rewrites and this pipeline extends; the merge is F289 first, then this branch merges F289's branch (no rebase across worktrees, no `git stash`) and adds only the new method and its types.
6. F289 Batch 2 also edits `ingest/route.ts` (two audience literals) and `ingest/route.test.ts`. This pipeline's rewrite of both wins at merge; the literals F289 adds are already in `sites-ingest.ts`.

**S1, as a recommendation for the orchestrator to hand to F289's Batch 2** (before it writes U4, so the scan never has to change logic again):

> (1) Make U4 require an `audience` string literal on **every** `getBlobStore().<method>` call whose first argument is an object literal, except a named `EXEMPT` list (`["resolvePublic"]`, which takes no audience because its definer is the contract). Do not enumerate `store`, `resolve`, `resolveMeta`. A later adapter method (this pipeline's `findByContentHashes`, treasury's, anyone's) then needs a table edit and nothing else, which is U4's own stated rule ("the test logic never changes").
> (2) Add a `FORWARD` row now: `src/lib/sites-ingest.ts: ["store:public_site", "findByContentHashes:public_site", "store:private"]`, `since: site-ingest-size`. A `FORWARD` file that does not exist is skipped, so this costs F289 nothing and means this pipeline's merge edits only the `ACTIVE` table.
> (3) The literal order in that row is the source order of `src/lib/sites-ingest.ts`, which this design fixes: `storeSiteImage`, `findHeldSiteImages`, `publishSiteBundle`.

## Implementation Order

Rule 16 values for this pipeline: dev server port **3610** (`E2E_BASE_URL=http://localhost:3610`), one Neon branch (its `.env.local` in the presby worktree), no migration number, no new `F`-number beyond F324, DECISION-279 only.

**Batch A: presby-site-kit client (full-stack-developer). Starts now; no dependency on F289.**

0. `git -C /Users/cshenso/git/presby-platform/presby-site-kit worktree add /Users/cshenso/git/presby-platform/presby-site-kit-ingest -b pipeline/site-ingest-size origin/main`, then `npm ci` there. **Do not switch branches in the main site-kit checkout**: other work reads `../presby-site-kit/scripts/build-bundle.mjs` from it.
1. Red tests first (`KB-*`, `KI-*`, `KW-*`) and capture the red run.
2. `build-bundle.mjs`: manifest, sniff, `legacyBodyBytes`, collisions (both transports), `--manifest`.
3. `ingest.mjs`: constants, `runIngest`, `runFromGithubScript`.
4. `ingest.yml`; `actionlint .github/workflows/ingest.yml` must be clean (`/opt/homebrew/bin/actionlint` is installed).
5. README section; version `4.1.0`.
6. Gate: `npm test`, `npm run typecheck`, `actionlint`. Site-kit has **no CI**, so the implementer's reported counts and QA's rerun are the only gate. **Commit on the branch; do not merge to `main`.** The merge is rollout step 3.

**Batch B: presby server (api-developer). Starts when F289 Batch 2 is committed on `pipeline/public-asset-allowlist` and Batch A is green.**

- **B0 (feasibility re-run against the live tree, mandatory):** merge F289's branch into `pipeline/site-ingest-size` (merge, no rebase, no stash); confirm `BlobAudience`, `StoreInput.audience`, `BlobRef.audience` and U4 exist; apply 0072 to this pipeline's Neon branch; re-grep every `getBlobStore` caller. If F289's shapes differ from this design, stop and return to Phase 3.
- B1: red tests for `BS-*`, `BD-*`; `findByContentHashes`.
- B2: characterization first: the existing `route.test.ts` is green as-is (apart from the `:752` metadata), then extract `sites-ingest.ts` (`authorizeIngest`, `readBoundedBody`, `validatePages`, `storeSiteImage`, `publishSiteBundle`) and re-point the legacy route; `SI-*`, `LG-*`.
- B3: the three routes with `PL-*`, `UP-*`, `CM-*`.
- B4: `SF-*` (the over-4.5 MB flow).
- B5: `BR-*`, the bridge run (below).
- B6: `PX-*`, `CS-*`; the `check` suite; `npm run test:db`.
- B7: write the integration patch for the shared files into `docs/work-log/site-ingest-size.integration.patch` (Rule 16): DECISION-279 (with the implementation addendum below), the `docs/TODO.md` lines, `docs/deployment.md`, the functionality-map line. The orchestrator applies it at integration.
- Audit events: `SITE_CONTENT_INGESTED` keeps its single write per publish (both transports) through `publishSiteBundle`, with `transport` added; uploads write none.
- Release notes: tech-lead after Phase 6 SHIP IT.

**The bridge run (`BR-1`, not committed).** `scratch/` is gitignored and hard-blocked from commits, which is the right place. A vitest file there stubs the JWKS `fetch` (as `route.test.ts` does), builds a fake `fetch(url, init)` that turns every client request into `new Request(url, init)` and calls the real `POST` handler for that path with a real signed token, and imports the **real** `/Users/cshenso/git/presby-platform/presby-site-kit-ingest/scripts/ingest.mjs`. It runs: (a) a small synthetic site -> legacy; (b) a synthetic site of about 6 MB of images (over the legacy limit) -> staged; (c) the same sha again -> `already_current`; (d) a new sha, same images -> zero uploads; (e) a forced failure after three uploads, then a re-run that converges. It uses synthetic generated bytes only. The pasted output goes in Phase 4. This replaces the local real-client run Phase 2 found unavailable (no test-only JWKS override in production code).

## Rollout runbook (R14)

Order is fixed: **the server before the client.** The legacy POST keeps every ordering safe for small sites.

0. **Before anything:** 0072 applied to production by F289's runbook; F289 merged and promoted. This pipeline never merges before that.
1. **Promote this pipeline's server** (`/pre-push`, `/merge-pr`, one at a time after F289). The new routes sit unused. Verify with an unauthenticated `POST` to each of `/api/sites/ingest/plan`, `/images`, `/commit` on the production platform host: each answers **401 with the JSON error body** (`code: unauthorized`). A 404 means the route did not deploy. The legacy path is unchanged apart from the 4,000,000-byte limit and the added `code`.
2. **Read-only prediction for FPCW (operator or orchestrator; counts only).** After 0072, count `blob_assets` rows for the `fpcw` organization with `audience = 'public_site'`, and compare the 80 distinct hashes of `site-fpcw/images/` against that set. Hashes present as `private` only are reported missing by the plan, so the first FPCW publish is **not guaranteed to upload nothing**; it uploads exactly the ones not held as site images. No release note or log line may say otherwise.
3. **Merge the site-kit branch to `main`** (the one commit, `feat: v4.1.0 -- ...`; the operator tags `v4.1.0`). This takes effect for every site's next push. `site-pasturechurch` (no images, tiny bundle) stays on the legacy request in `auto` mode, so its next push is the first production exercise of the new client's legacy path.
4. **Optional, recommended, operator's call (S3):** in `site-pasturechurch`'s `deploy.yml` add `transport: staged` under `with:`, push, read the log (expect: Built, "Staged ingest was requested", "This site has no images to send.", Publishing, Published), then remove it. It publishes identical content and proves OIDC, the three routes and Vercel's real behavior; it does **not** prove an upload (zero images). It is a live customer's repository, so it needs the operator's go.
5. **FPCW's first real ingest.** Operator go: given (the orchestrator relayed "lets put it on now" for the calendar page, 2026-10-26); the preconditions in `docs/TODO.md:237` still apply (`sites.public_render` on in production, both repository variables present and correct, `organization_sites.repo` equals the repository, `org_portal.public_calendar` as that line orders). Push to `site-fpcw` `main`. Expected log shape, with the numbers filled in from step 2:

   ```
   Built 14 page(s) and 81 image(s): 80 distinct, 28.3 MB.
   The site is 37.8 MB as one request, over the 4.0 MB limit, so images are sent one at a time.
   Checking which of the 80 distinct image(s) the platform still needs.
   <R> already on the platform; <M> to upload.        (or "All 80 image(s) are already on the platform; nothing to upload.")
   Uploaded 1 of <M>: "<key>" (<size>).               (one line per image, only if M > 0)
   Publishing 14 page(s) and 81 image reference(s).
   Published commit <sha7> to "<slug>" (14 page(s)).
   Sent <M> new image(s); <R> already on the platform.
   ```

   Then verify at 360 px and 1280 px that `/site/<slug>` pages show their images, and that `/admin/organizations/<id>` shows the new commit and time.
6. **A masked second failure is expected to be possible** (Gap 10): the 413 has hidden everything after it. The client prints a hint for each (variable mismatch -> 401; unprovisioned repository -> 404; switched off -> 503). Fix the named cause and re-run the job; every step is safe to repeat, and a repeat of an already-ingested sha reports so.
7. **Rollback.** Client: revert the one site-kit commit on `main`. Server: revert the presby release; a staged client then gets a non-JSON 404 on `/plan` and prints "the platform does not support staged ingest yet" (small sites unaffected). Neither needs a database action.
8. **Unverified until production:** the plan and commit on Vercel's real stack, `getIDToken` behavior across 80 calls, the timing of one upload on a cold function, and the actual `exp` of a GitHub OIDC token (irrelevant by design, because every request mints a new one). The first FPCW run is the evidence for the first three; the bridge run is the pre-production proxy.

## Feasibility check (against the live tree)

- **Signatures:** `findByContentHashes(input: { organizationId: string; audience: BlobAudience; contentHashes: readonly string[] }): Promise<Map<string, BlobRef>>` has no defaults and is valid TypeScript. `BlobAudience` and `BlobRef` exist only in F289's uncommitted tree today (`blob-store.ts` on this branch has neither), so **B0 re-runs this check after the merge**.
- **`BlobStore` implementers and fakes:** `PostgresBlobStore` is the only `implements BlobStore` (`blob-store.ts:151`); no test declares a `BlobStore`-typed fake (grepped), so adding a method breaks no typecheck.
- **ALTER/DROP, CHECK, trigger, FK, SECURITY DEFINER:** none in this design. `scripts/seed-dev.sql` is untouched. The new SELECT uses `organization_id` as the tenant column and the existing `withTrustedOrgContext`.
- **`ingest/route.ts` imports:** `sniffTicketAttachmentContentType`, `reservedSitePath`, `slugSitePath`, `resolveOrganizationByRepo`, `recordSiteIngest`, `recordAudit` all remain importable from `src/lib/` modules (`sites-ingest.ts` is in `src/lib/`, not importing from `src/app/`).
- **Proxy:** `src/proxy.ts:190` matcher excludes `.svg|.png|.jpg|.jpeg|.gif|.webp` suffixes only; `/api/sites/ingest/images` ends in `images`, so it is not excluded (`PX-2`).
- **Next route layout:** `route.ts` in `ingest/` plus `route.ts` in `ingest/plan/` etc. is legal.
- **Site-kit:** Node 20 (the workflow's `setup-node`) has global `fetch`, `AbortSignal.timeout` and `crypto`; `github-script@v7` is async-function-bodied, so `await import()` and `return` are legal. `tsconfig.test.json` includes `scripts` with `allowJs` and no `checkJs`, so the `.mjs` files are not type-checked and tests import them through a cast, as `build-bundle.test.ts` already does.

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| Gap 1 order with F289 | F289 coordination; Batch B0; merge after F289 (orchestrator OQ2) |
| Gap 2 mixed-version rollout | Legacy kept (OQ1); runbook order; client rule "legacy when it fits"; E12 message for a platform without staged routes |
| Gap 3 server-derived `imageKeys` | API Contract `/commit`; Edge Cases R1/G3. **The second half (a page referencing an undeclared key) is *deferred*: unchanged in both transports; pending the user's confirmation under Out of Scope** |
| Gap 4 upload integrity | `/images` (server hash, sniff); `UP-3`, `UP-4`, `SI-6` |
| Gap 5 concurrent pushes | Job concurrency group; residual (re-running an old run) accepted by the architect in Phase 2 |
| Gap 6 orphans | *Deferred, accepted by the architect in Phase 2* as a residual; follow-up line at integration (`docs/TODO.md`) |
| Gap 7 token lifetime | Fresh token per request; `KI-3`, `KI-14`, `KI-17`, `KI-26` |
| Gap 8 wire ceiling and client test | Constants; `KI-1`, `KI-3`, `KI-9`, `KI-12`; server `SI-1`, `SI-2` |
| Gap 9 failure microcopy | Copy `L`, `E`, `H`; `KI-13` to `KI-16`, `KI-25` |
| Gap 10 masked failures | Hints `H`; redirect line; runbook step 6; `SF` and `BR` |
| Gap 11 duplicate keys | R8 below |
| Gap 12 audit trail | `transport` in the audit metadata (architect); uploaded/reused counts are in the run log (client-side, where the operator reads); the server is stateless and cannot count uploads, so server-side counts are *deferred* (tech-lead; the audit row stays one per publish) |
| Gap 13 request bounds | Constants; `SI-4`, `PL-7`, `LG-5`, `CM-6`, `CM-7` |
| Gap 14 memory and time | R9 below |
| OQ1 legacy kept | Done |
| OQ2 merge after F289 | Done (B0) |
| OQ3 hashes present | Measured by the orchestrator (80 of 80 present among 82). The architect's caveat (only rows named by the current bundle become `public_site`) is respected: no "uploads nothing" promise anywhere (Copy residual line) |
| OQ4 oversize fails early | `E1`; `KI-8`, `KI-9` |
| R1 who keys images | `/commit`; `CM-2`, `CM-4`, `PL-10`, `UP-9`, `CM-12`, `SF-5` |
| R2 upload integrity | `UP-3`, `UP-4`, `UP-8`, `SI-6` |
| R3 one 4,000,000 limit, all four routes | Constants; `SI-1`, `SI-2`, `LG-2` to `LG-4`, `PL-11`, `UP-6`, `CM-11`, `KI-1` |
| R4 `already_current` everywhere | `SI-3`, `PL-1`, `UP-1`, `CM-1`, `KI-6`, `KI-7` |
| R5 stored bundle format unchanged | `CM-2`, `SF-5` |
| R6 sha last; all-or-nothing | `CM-4`, `PL-9`, `UP-9`, `CM-10` |
| R7 duplicate hashes | `KI-4`, `CM-3`, `LG-7`, `UP-10` |
| R8 manifest-key collisions | `KB-2` (both transports) |
| R9 no `maxDuration` | `SI-12` (source scan: none of the four route files exports `maxDuration` or `runtime`). Timing is *unverified* until production |
| R10 client in `ingest.mjs`, token getter passed in, `404` message | `KI-26`, `KI-15`, `KW-2`; `fail` refined to a thrown `IngestFailure` |
| R11 concurrency group | `KW-1` |
| R12 test placement | Test plan below |
| R13 build order against F289 | Batch B0; `BD-5` |
| R14 release order | Runbook |
| S1 | Recommendation above, for the orchestrator to hand to F289 Batch 2 |
| S2 octet-stream, server ignores | `UP-8` |
| S3 `transport` input | Adopted; `KW-3`, `KI-18` |
| Accepted residual: orphan `public_site` images | Phase 2; carried into the decision text and release note |
| Accepted residual: re-running an old run republishes old content | Phase 2; carried into the release note |
| Accepted residual: the upload path may first run in production well after release | Phase 2; runbook steps 4, 5 and 8 |

## Test plan

Files and cases. A test that needs the database is `describe.skipIf(!hasDb)` like the existing suite and runs under `npm run test:db`. All fixtures are synthetic: valid magic bytes plus deterministic filler, orgs with `deletable_until`. Nothing from site-fpcw.

**presby**

- `src/lib/sites-ingest.test.ts` (mocks the adapter, `@/lib/sites`, flags, audit): `SI-1` declared `Content-Length` 4,000,001 -> 413 `request_too_large`, stream never pulled · `SI-2` no length, streamed 4,000,001 -> 413 and reader cancelled; exactly 4,000,000 -> bytes returned · `SI-3` the same 401 -> 503 -> 404 -> `already_current` order through all four POST handlers (table-driven), body untouched on each early exit, every error has `code` · `SI-4` manifest validators: hash case/length/charset, size 0/1/4,000,000/4,000,001, duplicate hash, 2,000 ok / 2,001 refused, empty list ok, key rules (empty, 200 ok, 201 refused, control char, DEL, `__proto__`, spaces and non-ASCII accepted) · `SI-5` the page validator's messages for the reserved set equal today's text · `SI-6` `storeSiteImage`: PNG/JPEG/WEBP accepted, PDF and garbage refused, the sniffed type (not a declared one) reaches `store`, the literal is `public_site`, `23505` (on `err.code` and on `err.cause.code`) retried once, a second failure propagates, `BlobValidationError` becomes `image_rejected` · `SI-7` `publishSiteBundle`: store(`private`) -> `recordSiteIngest` -> `recordAudit` -> `revalidatePath` in that order; audit metadata keys exactly `repo, commitSha, pageCount, imageCount, transport`; a `__proto__` manifest key is an own property in the stored JSON · `SI-8` `errorResponse` emits only the closed code set and the three-field body · `SI-9` missing, `2` and `01` protocol header -> 422 `unsupported_protocol` on the three staged handlers · `SI-10` an uncaught throw -> JSON 500 `server_error`, no stack in the body, one `console.error` without request content · `SI-11` a held ref whose `contentType` is not an image is treated as not held · `SI-12` none of the four route files exports `maxDuration` or `runtime` · `SI-13` plan/images/commit import no `getBlobStore` and make no store call.
- `src/lib/storage/blob-store-find.test.ts` (mocked `@/lib/db`): `BS-1` the select projection has no `bytes` · `BS-2` the filter is `organization_id`, `audience`, hash list · `BS-3` empty, malformed, duplicate or over-2,000 list -> `BlobValidationError` before any query · `BS-4` rows map to a `Map` keyed by lowercase hash.
- `src/lib/storage/blob-store-find.db.test.ts` (real `presby_app`, after 0072): `BD-1` a held `public_site` hash is found, an unknown one absent · `BD-2` a hash held only as `private` is absent for `public_site` and present for `private` · `BD-3` identical bytes held by another organization are absent · `BD-4` 2,000 hashes in one call · `BD-5` the index `blob_assets_org_audience_hash_key` exists.
- `src/app/api/sites/ingest/route.test.ts` (legacy): `LG-1` the whole current suite green, audit metadata with `transport: "legacy"` · `LG-2` a body of 4,000,001 bytes with a valid token -> 413 `request_too_large` · `LG-3` the same oversize body with no/bad token -> 401, not 413 · `LG-4` a body of exactly 4,000,000 bytes passes the size gate (and fails validation, not size) · `LG-5` 2,001 images -> 422 `invalid_request` · `LG-6` error bodies carry `code` · `LG-7` two keys, identical bytes -> one blob row, two `imageKeys`.
- `plan/route.test.ts`: `PL-1` gate cases (401, 503, 404, `already_current`) · `PL-2` empty organization -> every hash missing · `PL-3` partial · `PL-4` private-only hash -> missing · `PL-5` another organization's bytes -> missing · `PL-6` empty `images` -> `missing: []` · `PL-7` 422s: bad hash, bad size, duplicate, 2,001 · `PL-8` protocol header · `PL-9` writes nothing: blob row count and the `organization_sites` row unchanged · `PL-10` no uuid-shaped string in the body · `PL-11` 413.
- `images/route.test.ts`: `UP-1` gate · `UP-2` stores a `public_site` row, body `{status, sha256, byteSize, contentType}` · `UP-3` hash mismatch -> 422 and no row · `UP-4` not-an-image, PDF bytes, empty body -> 422 and no row · `UP-5` header missing / uppercase / short -> 422 · `UP-6` 413 by declared length and by streamed count · `UP-7` re-upload -> 200, still one row · `UP-8` declared `content-type` ignored (a `text/plain` header with PNG bytes stores a PNG; an `image/png` header with GIF bytes is refused) · `UP-9` no uuid in the body, no `organization_sites` write, no audit row · `UP-10` two concurrent identical uploads -> both 200, one row.
- `commit/route.test.ts`: `CM-1` gate · `CM-2` happy path: success body equals the legacy shape; the stored bundle is private `{schemaVersion:1,pages,imageKeys}`; every `imageKeys` value resolves through the adapter as `public_site`; audit metadata with `transport: "staged"`; both revalidations · `CM-3` two keys, one hash -> one blob, two keys · `CM-4` a missing hash -> 422 `images_not_uploaded` naming the keys, no bundle row, `last_ingested_commit_sha` and `content_bundle_key` unchanged; upload it, then the same commit succeeds with the same sha · `CM-5` hash held only as `private`, or only by another organization -> 422 · `CM-6` duplicate `manifestKey` -> 422 · `CM-7` key rules · `CM-8` reserved page (`/give`, `/robots.txt`) -> 422 `reserved_page` with today's text · `CM-9` empty `images` ok, empty `pages` refused · `CM-10` a suspended site stays suspended · `CM-11` 413 and protocol · `CM-12` no uuid in any response body.
- `staged-flow.test.ts` (in-process, real DB, real signed tokens, a fresh token per request): `SF-1` synthetic images totalling more than 4.5 MB (so the legacy body would exceed it, asserted by arithmetic) published by plan -> uploads -> commit, **asserting every request body is at most 4,000,000 bytes** · `SF-2` a new sha with the same images -> the plan reports zero missing, commit only · `SF-3` the same sha again -> `already_current` at the plan, no writes · `SF-4` upload some, commit refused, upload the rest, commit succeeds · `SF-5` every published `imageKeys` value resolves through `resolvePublic` to the original bytes.
- Proxy: `PX-1` `src/proxy.test.ts` platformPaths gains the three paths and still rewrite them to bundle-path space · `PX-2` none of the three paths is excluded by `config.matcher` (the F151 extension rule) · `PX-3` `e2e/custom-domains/lockdown.spec.ts` gains the three paths in `PLATFORM_PATHS` and in the POST list (neutral 404, no cookie).
- `CS-1` `audience-callsites.test.ts` edits above, and it passes.
- `BR-1` the bridge run (uncommitted, output recorded).

**presby-site-kit**

- `test/build-bundle.test.ts`: `KB-1` `buildManifest`: hash, size, type, sorted keys, no base64 · `KB-2` collision (`a.jpg` + `a.png`; the same basename in two folders) throws a message naming both relative paths, in `buildBundle` and in `buildManifest` · `KB-3` non-image files ignored, extension case-insensitive · `KB-4` bytes that are not an image, and an empty file, are errors · `KB-5` existing cases unchanged; `legacyBodyBytes` equals `Buffer.byteLength(JSON.stringify(buildBundle(...)))` exactly, including a key needing JSON escaping · `KB-6` CLI: default output unchanged, `--manifest` writes the manifest · `KB-7` two files with identical bytes -> two entries, one hash.
- `test/ingest.test.ts` (fake `fetch`, fake `getToken`, injected `sleep`): `KI-1` the contract literals (4000000, 2000, header names, protocol `1`, the three paths, the key rule) · `KI-2` a small site sends **one** request to the base URL in the legacy shape, at most 4,000,000 bytes · `KI-3` a large site sends plan, uploads, commit in order; **every request body at most 4,000,000 bytes**; exact headers and paths; `getToken` calls equal `fetch` calls · `KI-4` two keys with identical bytes upload once and commit both keys · `KI-5` nothing missing -> no upload, line `L4b` · `KI-6` plan `already_current` -> stop, success, `L8` · `KI-7` `already_current` from an upload or the commit -> stop, success · `KI-8` an image of 4,000,001 bytes -> `E1`, zero fetch calls · `KI-9` an image of exactly 4,000,000 bytes is uploaded with a body of exactly 4,000,000 · `KI-10` empty and non-image files -> `E2`/`E3`, zero fetches · `KI-11` 2,001 entries -> `E5`, 2,000 ok · `KI-12` pages over the limit -> `E6`, zero fetches · `KI-13` server rejections print step, image key, status, server text and hint (401, JSON 404, 503, 422 `hash_mismatch`, 422 `images_not_uploaded`) · `KI-14` retries: a thrown fetch twice then success continues; three 5xx -> failure with `E9`; 4xx never retried; sleeps are 1000 then 3000; `getToken` calls equal `fetch` calls · `KI-15` a non-JSON 404 on `/plan` -> `E12`; a JSON 404 -> the provisioning hint, not `E12` · `KI-16` a plain-text platform 413 or HTML body -> `E13` with the trimmed text · `KI-17` `getToken` throws -> `E11`, zero fetches · `KI-18` `transport`: `staged` forces staged on a small site (`L2c`), `legacy` on an oversize one -> `E7`, an unknown value -> `E8` · `KI-19` a 200 with an unknown body -> `E13`, with the "may or may not have been published" wording for the commit and legacy only · `KI-20` convergence against a fake platform: interrupt after three uploads, re-run uploads only the rest, a third run reports `L8` · `KI-21` a lost commit response retried -> `already_current` -> success · `KI-22` URL building: trailing slashes stripped, the three paths · `KI-23` never more than one request in flight · `KI-24` a 3xx -> `E14` (no follow) · `KI-25` every success-path line equals the Copy table text · `KI-26` `runFromGithubScript` with a fake `core`: `getIDToken(audience)` per request, `IngestFailure` -> `setFailed(message)` without throwing, an unexpected error -> `setFailed` with `E16` · `KI-27` upload order follows manifest-key order.
- `test/ingest-workflow.test.ts`: `KW-1` `ingest.yml` has job-level `concurrency` with group `presby-site-ingest-${{ github.repository }}` and `cancel-in-progress: false`, and `timeout-minutes` · `KW-2` the loader guards a missing `.site-kit/scripts/ingest.mjs` with `E15`'s text and no longer references `bundle.json` · `KW-3` input `transport` exists with default `auto` · `KW-4` `actionlint` exits 0 (skipped with a printed notice when the binary is absent).

## Edge Cases & Risks

Each claim cites the test that pins it, or says unverified.

| # | Claim | Pinned by |
|---|---|---|
| G3 | The server resolves every declared hash itself; a hash that is not held (or only private, or another organization's) refuses the whole commit with the manifest keys named; the client never sends or receives a uuid | `CM-2`, `CM-4`, `CM-5`, `SI-11` |
| G3b | A page referencing a key the commit does not declare is not validated, in either transport | Unverified by a test by design (Out of Scope; unchanged behavior) |
| G4 / R2 | The server recomputes the hash, refuses a mismatch, sniffs, stores the sniffed type, ignores the declared type | `UP-3`, `UP-4`, `UP-8`, `SI-6` |
| G5 / R11 | Runs for one repository are serialized, older pending runs collapse to the newest, a running run is never cancelled. **Residual:** re-running an old failed run after a newer success republishes the old content | `KW-1`; residual accepted in Phase 2 |
| G6 | An abandoned publish leaves `public_site` rows no bundle uses; they can be fetched only by uuid, which no response discloses; nothing collects them | `PL-10`, `UP-9`, `CM-12` pin the non-disclosure; the residual itself is unverifiable by test and accepted in Phase 2 |
| G7 | Every request carries its own freshly minted token; a failed token request stops the run readably | `KI-3`, `KI-14`, `KI-17`, `KI-26` |
| G8 / R3 | No request body exceeds 4,000,000 bytes from the client; the server refuses more (by declared length and by counted bytes) on all four routes, authenticated callers only | `KI-3`, `KI-9`, `KI-12`, `SI-1`, `SI-2`, `LG-2` to `LG-4`, `UP-6`, `PL-11`, `CM-11`. **Unverified:** how undici/Vercel treat an unread oversize body on a real socket (the in-process tests cannot show it); the platform cap stays behind this limit either way |
| G9 | Every failure prints the step, the image key where there is one, the status, the server's text and a next step | `KI-13` to `KI-16`, `KI-25` |
| G10 | A previously masked failure (variables, provisioning, switched-off flag, redirect) prints a named cause | `KI-13`, `KI-24`; runbook step 6 |
| G11 / R8 | Two images that would share a manifest key fail the build with both paths named, in both transports | `KB-2` |
| G12 | One audit row per publish with `transport`; uploaded and reused counts are in the run log only | `SI-7`, `CM-2`, `LG-1`, `KI-25` |
| G13 | Server-side bounds: 2,000 entries (plan, commit, legacy), key length and characters, hash format, size range, protocol | `SI-4`, `PL-7`, `LG-5`, `CM-6`, `CM-7`, `SI-9` |
| G14 / R9 | Each request does at most one image or one lookup of up to 2,000 hashes; no `maxDuration`, no runtime override | `SI-12`; timing **unverified** until the first production run |
| R1 | No plan, upload or commit response contains a uuid-shaped string | `PL-10`, `UP-9`, `CM-12`, `SF-5` |
| R4 | `already_current` on every step; a re-run of an ingested sha writes nothing | `SI-3`, `PL-1`, `UP-1`, `CM-1`, `SF-3`, `KI-6`, `KI-7` |
| R5 | The stored bundle is `{ schemaVersion: 1, pages, imageKeys }` and private; the renderer is untouched | `CM-2`, `SF-5` |
| R6 | `last_ingested_commit_sha` is written once, last; plan and upload never touch `organization_sites`; a refused commit changes nothing and the retry succeeds | `PL-9`, `UP-9`, `CM-4`, `SF-4` |
| R7 | Each distinct hash is uploaded once; two keys may share a blob | `KI-4`, `CM-3`, `LG-7`, `UP-10` |
| R10 | The client takes its token getter from the caller; a platform without staged routes is named, not mistaken for a missing site | `KI-26`, `KI-15` |
| Race | Two identical concurrent uploads cannot fail with a unique violation | `SI-6`, `UP-10` |
| Large `Content-Length` lie | A client that declares a small length and sends more is stopped at the counted limit | `SI-2`. **Unverified:** whether the Request implementation lets a test declare a false length |
| Proxy | The three paths are fixed, not excluded by the matcher, and answer the neutral 404 on a custom host | `PX-1` to `PX-3` |
| Suspended site | A publish to a suspended site stays suspended on both transports | `CM-10`, existing `route.test.ts` suspended block |
| Empty state | A site with zero images publishes by either transport | `PL-6`, `CM-9`, `KI-5`, the legacy empty-images case |
| Legacy dead branch | The legacy route's "is not valid base64" branch cannot fire (Node's `Buffer.from(..., "base64")` does not throw); unchanged | Unverified; not touched |
| 360 px | Not applicable to the ingest. The visitor-facing image check is a Phase 5 browser step after the first FPCW publish | Phase 5 |
| Site-kit has no CI | Nothing runs the site-kit tests on merge | Implementer's reported counts and QA's rerun are the gate |

**e2e blast radius.** Existing specs that assert behavior near this change: `e2e/custom-domains/lockdown.spec.ts` (`/api/sites/ingest` on a custom host answers the neutral 404; `:87`, `:150`) and `src/proxy.test.ts:342`. Their assertions are **not altered** by this change; they are **extended** with the three new paths (`PX-1`, `PX-3`). No other spec calls the ingest route (grepped `e2e/` and `src/`). **Feature flags those specs depend on:** none beyond what they already set; `lockdown.spec.ts` needs no `sites.public_render` flag because the custom-host branch answers before any flag is read. No key is added to `scripts/ci/e2e-baseline-flags.sql`. The DB-backed route tests set `sites.public_render` themselves through the harness and restore it.

## Copy

Run-log lines are what the **site repository's GitHub Actions log** shows. **Audience for all client strings:** a person with access to that repository's Actions tab (the operator, or congregation staff the operator has added): they can re-run a job, edit repository variables if they are an admin of the repository, and replace image files. They are not platform administrators. "Contact PresbyPortal support" is the path they have.

### Success-path lines (`L`)

| ID | String | Source of truth |
|---|---|---|
| L1 | `Built {P} page(s) and {N} image(s): {D} distinct, {S}.` (with no images: `Built {P} page(s) and 0 image(s).`) | `buildManifest`: files under `content/` and `images/`; `D` = distinct sha256; `S` = sum of file sizes |
| L2a | `Sending the site as one request ({B} of the 4.0 MB allowed).` | `legacyBodyBytes`, exact |
| L2b | `The site is {B} as one request, over the 4.0 MB limit, so images are sent one at a time.` | `legacyBodyBytes` against the constant |
| L2c | `Staged ingest was requested, so images are sent one at a time.` | the `transport` input |
| L3 | `Checking which of the {D} distinct image(s) the platform still needs.` (with `D` = 0: `Checking whether the platform already has this commit.`) | the plan request |
| L4a | `{R} already on the platform; {M} to upload.` | the plan response's `missing` against the request |
| L4b | `All {D} image(s) are already on the platform; nothing to upload.` | same |
| L4c | `This site has no images to send.` | `D` = 0 |
| L5 | `Uploaded {i} of {M}: "{key}" ({size}).` | printed after the upload's 200; `key` is the first manifest key with that hash |
| L6 | `Publishing {P} page(s) and {N} image reference(s).` | the commit request being sent |
| L7 | `Published commit {sha7} to "{slug}" ({pageCount} page(s)).` | the 200 `ingested` body (`commitSha`, `organizationSlug`, `pageCount`) |
| L8 | `The platform has already ingested commit {sha7}; nothing to do.` | the 200 `already_current` body |
| L9 | `Sent {U} new image(s); {R} already on the platform.` | client counts of this run's uploads and the plan |

Units: `formatBytes` prints `N bytes` under 1,000, `X.X KB` under 1,000,000, otherwise `X.X MB` (decimal, to match 4,000,000).

### Failure lines (`E`) and hints (`H`)

Every `E1` to `E8` is raised before any request and ends `Nothing was sent.`, which is true because the checks run before the first `fetch`.

| ID | String |
|---|---|
| E1 | `Image "{path}" is {bytes} bytes; the limit is 4,000,000 bytes (about 4 MB). Make the image smaller, then push again. Nothing was sent.` |
| E2 | `Image "{path}" is empty. Remove it or replace it, then push again. Nothing was sent.` |
| E3 | `Image "{path}" is not a PNG, JPEG or WEBP file, whatever its name says. Replace or remove it, then push again. Nothing was sent.` |
| E4 | `Images "{pathA}" and "{pathB}" would both be called "{key}". Give each image a different file name (the part before the extension), then push again. Nothing was sent.` |
| E5 | `This site has {N} images; at most 2,000 can be published at once. Remove some, then push again. Nothing was sent.` |
| E6 | `The page content is {bytes} bytes; one request is limited to 4,000,000 bytes. Shorten or remove some pages, then push again. Nothing was sent.` |
| E7 | `Transport "legacy" was requested, but the site is {B} as one request and the limit is 4.0 MB. Use transport "auto" or "staged". Nothing was sent.` |
| E8 | `Unknown transport "{value}". Use "auto", "staged" or "legacy". Nothing was sent.` |
| E9 | `Step "{step}"{ for image "{key}"}: the platform answered {status}: {server text}` then the hint on the next line |
| E10 | `Step "{step}"{ for image "{key}"}: could not reach the platform ({cause}) after 3 attempts. Re-run this job; if it keeps failing, contact PresbyPortal support.` |
| E11 | `Step "{step}": GitHub did not issue an identity token ({cause}). Re-run this job.` |
| E12 | `The platform does not support staged ingest yet (the "plan" step answered 404 without the usual error format). This large site cannot be published until the platform is updated; small sites are not affected. Re-run this job after the update, or contact PresbyPortal support.` |
| E13 | `Step "{step}": the platform sent a reply this tool does not understand ({status}): {first 200 characters}. ` then, for plan and upload, `Nothing was published.`; for commit and the legacy request, `The site may or may not have been published; re-run this job, which will say so if it was.` |
| E14 | `Step "{step}": the platform redirected this request to {origin}. Set the PRESBY_INGEST_URL repository variable to that address (ending in /api/sites/ingest), then re-run this job.` |
| E15 | `presby-site-kit ref "{ref}" has no scripts/ingest.mjs, so this site cannot publish with it. Set site_kit_ref to "main" (or to v4.1.0 or later), then re-run this job.` |
| E16 | `Unexpected error in the ingest tool: {message}. Re-run this job; if it keeps failing, contact PresbyPortal support.` |
| E17 | `Image "{path}" has a name the platform cannot accept ("{key}"): image names must be 1 to 200 characters with no control characters. Rename the file, then push again. Nothing was sent.` (added by Batch A, recorded here by Batch B: the staged path only, raised before any request; the rule it states is the one the server enforces on `/commit`, `SI-4`/`CM-7`) |
| E18 | `Could not read the site: {message} Nothing was sent.` (added by Batch A, recorded here by Batch B: wraps the page-reading errors, "no .json files" and malformed JSON, which used to surface as a raw stack in the build step) |

| ID | Shown after | Hint |
|---|---|---|
| H401 | status 401 | `The platform did not accept this job's identity. A common cause is a repository variable (PRESBY_INGEST_URL or PRESBY_OIDC_AUDIENCE) that does not match the platform's.` |
| H404 | status 404 in our format | `The platform has no site set up for this repository. Contact PresbyPortal support to have it set up.` |
| H503 | status 503 in our format | `The platform is not accepting site updates right now. Re-run this job later; if it keeps failing, contact PresbyPortal support.` |
| H413 | status 413 in our format | `The platform refused the request as too large. This should not happen; contact PresbyPortal support.` |
| H422a | code `hash_mismatch` | `The platform received different bytes than were sent. Re-run this job.` |
| H422b | code `not_an_image` | `The platform does not recognize this file as a PNG, JPEG or WEBP. Replace the image.` |
| H422c | code `images_not_uploaded` | `Re-run this job; the upload step will send them again.` |
| H5xx | status 500 or above | `Re-run this job; if it keeps failing, contact PresbyPortal support.` |
| H422d | any other 422 | (the server text stands alone) |

### Server error text (`S`; the `error` field, read by the same audience in the log)

Unchanged and kept verbatim: every existing 401 text, `No site is provisioned for this repository.`, `Site ingest is currently disabled.`, `Request body is not valid JSON.`, and the legacy `bundle.*` shape messages and image messages. New:

| ID | Code | String |
|---|---|---|
| S1 | `request_too_large` | `Request body is larger than 4,000,000 bytes.` |
| S2 | `unsupported_protocol` | `Unsupported ingest protocol. Send the header x-presby-ingest-protocol: 1.` |
| S3 | `invalid_request` | `images must be an array of at most 2000 entries.` · `images[{i}] needs a lowercase 64-character sha256 and a size from 1 to 4000000.` · `images[{i}] repeats an earlier sha256.` · `images[{i}] needs a manifestKey of 1 to 200 characters with no control characters, and a lowercase 64-character sha256.` · `images[{i}] repeats the manifestKey "{key}".` · `pages must be a non-empty array.` · `Malformed entry in pages.` · `bundle.images has more than 2000 entries.` (legacy) · `x-presby-sha256 must be a lowercase 64-character hex sha256.` · `The image body is empty.` |
| S4 | `hash_mismatch` | `The bytes received do not match x-presby-sha256.` |
| S5 | `not_an_image` | `The uploaded file is not a PNG, JPEG, or WEBP.` |
| S6 | `images_not_uploaded` | `These images are not available to this site yet: "{key}", "{key}" (and {k} more). Upload them, then commit again.` (up to 20 keys, then the count) |
| S7 | `image_rejected` | `Image: {BlobValidationError message}` (staged); the legacy text `Image "{key}": {message}` is unchanged |
| S8 | `server_error` | `The platform hit an unexpected error. Try again.` |

### Workflow strings (`W`)

- `presby_ingest_url`: `Full URL of presby's POST /api/sites/ingest endpoint. A large site also uses its /plan, /images and /commit paths.`
- `site_kit_ref`: `presby-site-kit ref to pull the ingest scripts from. Defaults to main.`
- `transport`: `auto (default): send the site as one request when it fits the 4.0 MB limit, otherwise image by image. staged or legacy forces one or the other.`

### Release-note lines (draft; written for the operator, final text via `/release-notes` after Phase 6)

> **Value:** A church website with many photos can be published again; before this, the publish failed with a "request too large" error.
> - Photos are now sent one at a time, and only the ones the platform does not already have. Smaller sites publish as before.
> - If a publish stops partway, running it again picks up where it left off. Photos already sent stay on the platform; they do not appear on the website until a later publish uses them.
> - When several updates are pushed close together, they are published one at a time, and only the newest of the waiting ones is published.
> - A photo larger than 4 MB (4,000,000 bytes) cannot be published yet. The publish stops before sending anything and names the photo.
> - Running an older, failed publish again after a newer one has succeeded puts the older content back. Re-run only the latest.

### The four checks, one line per group

- **L (success lines).** *Residuals:* none denies a residual; L4a/L4b describe this run's plan and do **not** promise a first publish uploads nothing (the architect's caveat), and L9 reports what was actually sent. *Source of truth:* each count comes from the manifest, the plan response or the commit response as listed; "already on the platform" means held as a `public_site` image in this organization by sha256 (the only thing the plan reads), and L8 says "ingested", not "published", because `already_current` reads only `last_ingested_commit_sha` (a suspended site is ingested but not shown). *Audience:* informational, no instruction. *Neighbours:* the legacy log line `presby ingest responded {status}: {body}` and `Ingest failed with status ...` (`ingest.yml:80-83`) are removed, not made stale; `docs/deployment.md` has no copy of them.
- **E / H (failures).** *Residuals:* E1 does not deny that the 4 MB limit is a known gap (it says it "can't be sent" by saying the limit); no line says a failed publish leaves nothing behind (E-lines for the staged path never claim that; "Nothing was sent" appears only on checks that precede the first request). *Source of truth:* E1 to E8 rest on local file reads; E9/E13 quote the server's reply; H503 deliberately avoids "switched off" because `isFlagEnabled` returns `false` on a database error as well as on a flag that is off, so the platform text "disabled" may mean "could not read"; E13's second wording exists because after a commit whose reply was lost the site may have been published. *Audience:* every instruction is something a repository collaborator can do (re-run, replace an image, rename a file, set a repository variable if they administer the repository, contact support); none says "ask your administrator". *Neighbours:* `docs/deployment.md:888-895` and `docs/TODO.md:100` describe the earlier failures as an inference about missing variables; E14/H401 do not contradict them and the open staleness question is listed under Neighbours.
- **S (server text).** *Residuals:* none. *Source of truth:* S6 says "not available to this site yet" because `findByContentHashes(public_site)` cannot tell "never uploaded" from "held only as private" or "held by another organization"; the stronger "not uploaded" is not claimed. *Audience:* the same log reader; instructions are written to the client ("Upload them, then commit again"), and H422c translates them for the person. *Neighbours:* the existing legacy messages stay verbatim (their tests pin them).
- **W (workflow).** *Residuals:* none. *Source of truth:* the descriptions state the default and the 4.0 MB rule, both constants. *Audience:* the maintainer of a site's calling workflow, who can set the input. *Neighbours:* `ingest.yml:20` and `:28` are the two stale descriptions, modified here.
- **Release notes.** *Residuals:* the orphan-photos residual, the old-run residual and the 4 MB limit are each stated, not denied. *Source of truth:* "only the ones the platform does not already have" is the plan's behavior (`PL-3`); "newest of the waiting ones" is GitHub's concurrency behavior as the architect recorded it (`KW-1` pins the configuration, not GitHub's behavior; GitHub's documented collapse of pending runs is relied on). *Audience:* the operator; every action named (re-run only the latest) is theirs. *Neighbours:* `docs/release-notes/v0.44.md` mentions no ingest; nothing stale.

## Out of Scope (confirm with the user)

- Chunked upload of a single image over 4,000,000 bytes (OQ4; no real image is near it; tracked follow-up).
- Garbage collection or takedown of unreferenced `public_site` images (F289 Tier 2).
- A per-organization storage budget (the legacy route already allowed repeated calls).
- Validating that page content references only declared image keys (Gap 3b).
- Server-side image re-encoding or resizing; an object store; a staging table.
- Ordering commit shas on the server (the concurrency group serializes; it does not order).
- Token reuse across requests (only if GitHub throttles; the first FPCW run is the evidence).
- Any change to how pages or site-kit blocks render.

## Proposed implementation addendum to DECISION-279 (the orchestrator records it at integration)

> **Implementation rulings (tech-lead, Phase 3).** (1) Uploads are sequential, one image per request; revisit above about 500 images per run or five minutes. (2) The wire is pinned: `MAX_REQUEST_BYTES` 4,000,000 on all four routes, `MAX_MANIFEST_ENTRIES` 2,000, protocol header `x-presby-ingest-protocol: 1`, hash header `x-presby-sha256`, error body `{status, code, error}` with a closed code set; legacy gains `code` and `transport: "legacy"` only. (3) `storeSiteImage` retries once on a unique violation, so identical concurrent uploads are safe. (4) `imageKeys` is built with `Object.fromEntries` so a `__proto__` key is data. (5) The client throws `IngestFailure` rather than taking a `fail` callback; it mints a token per request, retries three times on a thrown fetch or a 5xx, and does not follow redirects. (6) S3 adopted: workflow input `transport` (`auto|staged|legacy`). (7) Accepted: no aggregate storage quota; page-to-image reference validation is not done in either transport. (8) Residuals as in Phase 2: unpublished `public_site` images; re-running an old run republishes old content; the upload path may first run in production at FPCW's first ingest.

## Implementer

- **Batch A, `presby-site-kit`: full-stack-developer.** Starts now. Branch `pipeline/site-ingest-size` in a new worktree `/Users/cshenso/git/presby-platform/presby-site-kit-ingest`; does not merge to `main`.
- **Batch B, presby: api-developer.** Starts when F289 Batch 2 is committed and Batch A is green. All server code and tests; no UI.
- **Integration:** orchestrator (shared files, DECISION-279, TODO, STATE, `docs/deployment.md`, merge order after F289).

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — Technical design | tech-lead | Complete; Batch A ready now, Batch B gated on F289 Batch 2 | Design complete, implementers named | 2026-10-26 |

(Date per the work-log header. The system date here reads 2026-10-25.)

## Handoff

Next: **full-stack-developer for Batch A** immediately. For the orchestrator, before F289 Batch 2 writes U4: hand it S1 (recommendation above). Items needing the user: confirm Out of Scope (especially the page-to-image reference check and no storage quota); the optional S3 run on `site-pasturechurch`; and whether `docs/deployment.md:225-227` and `docs/TODO.md:100` are still true given run 40251133138 reached the platform. Phase 5 must include the bridge output (`BR-1`), the 360 px image check after the first FPCW publish, and, because this design adds no auth-path file (`src/auth.ts`, `src/proxy.ts`, `src/app/(auth)/`, `src/lib/auth/` are untouched), no MFA login e2e is required; the `lockdown.spec.ts` rerun on port 3610 is.

---

# Phase 4 — Implementation

## Batch A — presby-site-kit client (full-stack-developer), 2026-10-25

Worktree `/Users/cshenso/git/presby-platform/presby-site-kit-ingest`, branch `fix/staged-ingest` (the name the orchestrator gave; the design said `pipeline/site-ingest-size`), from site-kit `main` 8ca982a. One commit, **not pushed, not merged**: `ad109b1` `feat: v4.1.0 -- staged ingest: a site over the 4.0 MB request limit now publishes, image by image` (the design names a `feat:` commit, so no `Caught-By`/`Discovered-In` trailers; `Work-Log:` and the attribution lines are present). The main site-kit checkout was not touched. Site-kit has no commit hooks and no CI (`.git/hooks` holds only samples); conventional prefixes are its only convention.

### Files Created (site-kit)

- `scripts/ingest.mjs` — the client: the wire-contract constants block, `runIngest`, `runFromGithubScript`, `IngestFailure`, `formatBytes`, `validateManifestKey`. No dependency, no `@actions/core`.
- `test/ingest.test.ts` (`// @vitest-environment node`, 54 tests: KI-1 to KI-27 against an in-memory fake platform), `test/ingest-workflow.test.ts` (5: KW-1 to KW-4 plus one description check), `test/ingest-fixtures.ts` (synthetic generated image bytes: a magic header plus xorshift filler; no real data).

### Files Modified (site-kit)

- `scripts/build-bundle.mjs` — `BuildError`, `sniffImageType`, `buildManifest`, `legacyBundleFromManifest`, `legacyBodyBytes` (exact), collision check in `buildImages` (so `buildBundle` and `buildManifest` both fail), `--manifest`. The default CLI output is byte-identical to before.
- `.github/workflows/ingest.yml` — job-level `concurrency` (`presby-site-ingest-${{ github.repository }}`, `cancel-in-progress: false`), `timeout-minutes: 30`, `transport` input (default `auto`), the `Build content bundle` step removed, the github-script step shrunk to the loader with the E15 guard, descriptions per Copy `W`.
- `test/build-bundle.test.ts` — +13 tests (KB-1 to KB-7); the existing 5 are unchanged.
- `README.md` — "Publishing a site (ingest)" section. `package.json` 4.0.0 to 4.1.0; `package-lock.json` root version set to 4.1.0 (see deviation 5). `dist/` unchanged (no `src/` change).

### Gates (site-kit)

| Gate | Result |
|---|---|
| Red run first (new tests, no implementation) | `build-bundle.test.ts` 11 failed / 7 passed; `ingest.test.ts` failed to import (`scripts/ingest.mjs` absent) |
| `npm test` | **22 files, 235 tests, all passed** (was 20 files, 163 tests; +72 new: 13 in `build-bundle.test.ts`, 54 in `ingest.test.ts`, 5 in `ingest-workflow.test.ts`) |
| `npm run typecheck` | clean |
| `npm run build` | clean; `git status` shows no `dist/` change |
| `actionlint .github/workflows/ingest.yml` | exit 0, no output (also run by KW-4) |
| Mutation check | changing the legacy/staged boundary `<=` to `<` fails the boundary test (KI-2, exact 4,000,000 vs 4,000,001 bytes) |
| Real-fetch check (scratchpad, uncommitted) | the real client with the real Node `fetch` against a local `http` server implementing the contract: 3 x 1.8 MB images, plan, 3 uploads, commit; max body 1,800,000; tokens `t1..t5`, one per request |
| Loader check (scratchpad, uncommitted) | `await import(pathToFileURL(...).href)` inside an `AsyncFunction` (github-script's shape) resolves `ingest.mjs` on Node 20 |

Not run: the bridge run (`BR-1`, needs Batch B handlers).

### Implementer Notes — deviations from the design

1. **Branch name** `fix/staged-ingest`, per the orchestrator's instruction.
2. **Two failure lines are not in the Copy table** and need adding (QA copy-truthfulness will find them): **E17** (staged path only, before any request) `Image "{path}" has a name the platform cannot accept ("{key}"): image names must be 1 to 200 characters with no control characters. Rename the file, then push again. Nothing was sent.` — the design pins the manifest-key rule on both sides but gave no client line for violating it; **E18** `Could not read the site: {message} Nothing was sent.` — wraps `buildPages` errors (no `.json` files, malformed JSON) that previously surfaced as a raw stack in the build step.
3. **Step name for the legacy request is `ingest`** (`Step "ingest": the platform answered ...`); the design named steps `plan`, `upload`, `commit` only.
4. **Fallback texts**: an empty reply body prints `(no text)` in E13; a redirect with no `Location` header prints "another address" in E14.
5. **`package-lock.json` was at `3.5.0`, not `4.0.0`** as the design assumed (it had drifted behind `package.json`). Set both root entries to `4.1.0`; nothing else in the lock changed.
6. **E1 prints the repository-relative path** (`images/huge.png`) and the raw byte count (`4000001 bytes`, no thousands separator). E6's `{bytes}` is the whole commit body (pages plus the image list), not pages alone.
7. **`buildImages` now sorts by relative path**, so the legacy `images` array order is deterministic. Previously it followed directory order. A manifest-key quirk is deliberately preserved: `path.basename(file, ext)` strips only the lower-cased extension, so `Hero.PNG` still gets key `Hero.PNG` (pinned by KB-3's comment); changing it would silently break content that references the old key.
8. **`legacy` request `contentType` is now the sniffed type**, not the extension's (a `.png` file whose bytes are JPEG is sent as `image/jpeg`; before, as `image/png`). The server sniffs anyway; this removes a disagreement.
9. **503 is retried** like any 5xx (design: "any HTTP status 500 or above"), so a switched-off flag costs three requests and about 4 seconds of sleeps before H503 prints. Left as designed.
10. **`runFromGithubScript` also accepts optional `fetch` and `sleep`** (passed to `runIngest`), so the loader entry point is testable without a network.
11. **L9 is printed after every successful staged commit**, including `Sent 0 new image(s); 0 already on the platform.` for a site with no images.
12. **Attribution trailers** use the session's `Co-Authored-By: Claude Sonnet 5.5` line, not the "Opus 5.5" wording in the task message; the `Claude-Session` URL is the same.

No design claim proved wrong except deviation 5 (the lock version). One design statement is **unverified until a real run**: github-script's real wrapper behaves like the `AsyncFunction` stand-in used in the loader check.

### What Batch B (the presby server) must match

The client is written against exactly this; every item is asserted in `test/ingest.test.ts`.

- **Headers, all lower-case on the wire:** `/plan`, `/images`, `/commit` send `x-presby-ingest-protocol: 1`; the legacy POST sends none. `/images` sends `x-presby-sha256: <64 lowercase hex>` and `content-type: application/octet-stream`; the others send `content-type: application/json`. Every request has `authorization: Bearer <fresh token>`. `redirect: "manual"` — a 3xx is a client failure, never followed.
- **Plan** request body: `{ "images": [ { "sha256", "size" } ] }`, one entry per **distinct** hash, ordered by the first manifest key carrying it; `images` may be `[]` (a site with no images still plans, so `already_current` can be detected). Response `{ "status": "planned", "missing": [...] }`. **The client rejects (E13) any `missing` entry that is not a hash it sent**, and any non-array.
- **Upload** response must be `{ "status": "stored", "sha256": "<the same hash>" , ... }`. **The client checks `sha256` equals the one it sent**; `byteSize` and `contentType` are not read. One image per request, sequential, each distinct hash once, in manifest-key order.
- **Commit** request body, key order `schemaVersion, pages, images`: `{ "schemaVersion": 1, "pages": [ { path, frontMatter, mdxAst: { blocks } } ], "images": [ { "manifestKey", "sha256" } ] }`, images in manifest-key order (code-unit order), two keys may share a hash, `images` may be `[]`. Success response must carry a string `commitSha`, a string `organizationSlug` and a numeric `pageCount`, or the client reports E13 ("may or may not have been published").
- **`already_current`** (`{ status: "already_current", organizationSlug, commitSha }`) at any of the four routes is success; a missing `commitSha` prints `(unknown)`.
- **Error bodies** `{ "status": "error", "code", "error" }`. The client picks its hint from the HTTP status (401, 404, 503, 413, 5xx) and, for 422 only, from `code` (`hash_mismatch`, `not_an_image`, `images_not_uploaded`). **A 404 on `/plan` that is not parseable JSON with a string `status` is read as "this platform has no staged ingest" (E12)**, so the real "no site is provisioned" 404 must keep the JSON format on `/plan`.
- **Legacy request** (unchanged shape): `{ "bundle": { "schemaVersion": 1, "pages": [...], "images": [ { manifestKey, contentType, bytesBase64 } ] } }`, images in manifest-key order, `contentType` the sniffed type, body at most 4,000,000 bytes exactly (client-computed, boundary tested at 4,000,000 / 4,000,001). The legacy route needs no client-visible change except the optional `code` field on errors.
- **Limits the client enforces before sending** (server must still enforce its own): body 4,000,000 (accepted at exactly 4,000,000), 2,000 manifest entries in every mode, image size 1 to 4,000,000, manifest key 1 to 200 UTF-16 units with no U+0000 to U+001F or U+007F (staged only; a `__proto__` key is legal and must survive).
- **Retries:** 5xx (including 503) and thrown fetches are retried, three attempts, a fresh token each time, sleeps 1 s then 3 s; so a commit whose reply was lost is retried, and the server must answer the retry `already_current` (the sha is written last).
- **Wire-literal test:** `KI-1` in `test/ingest.test.ts` is the site-kit half of the literal contract test; presby's `SI-4`/`SI-9` must assert the same literals.

### Audit Events

None from this batch (client only). Server audit is Batch B.

### Schema Changes

None.

## Batch B — presby server (api-developer), 2026-10-25

Worktree `/Users/cshenso/git/presby-platform/presby-ingest`, branch `pipeline/site-ingest-size`, Neon branch `pipeline-site-ingest-size` (host `ep-nameless-cloud`; 0072 applied to it, never to development or production), port 3610. Nothing pushed.

### Commits (all carry `Work-Log: 2026-10-26-site-ingest-size` and the attribution lines)

| Commit | Subject |
|---|---|
| `5fbb90f` | `Merge branch 'pipeline/public-asset-allowlist' into pipeline/site-ingest-size` (B0; F289 at `83ea135`; merge, no rebase, no stash) |
| `96784a7` | `feat(storage): findByContentHashes, the per-audience 'which hashes do we hold' lookup` (BS-1..4 red first, BD-1..5) |
| `7ef67b6` | `fix(sites): site ingest publishes a site over the request-size limit, staged and content-addressed` (`Caught-By: agent-review`, `Discovered-In: production`) |
| (this section and the patch) | `docs(work-log): site ingest size Phase 4 Batch B` |

### B0 — the feasibility re-run against the merged tree (mandatory; passed, no return to Phase 3)

- `BlobAudience`, `BlobRef.audience`, `StoreInput.audience`, `ResolveInput.audience`, `PublicImageType` exist in `blob-store.ts`; `audience-callsites.test.ts` (U4) exists and, per the S1 ruling, already holds any `getBlobStore().<method>(` call to an `audience` literal by default, with `resolvePublic` the one named exemption. Its self-test even carried a `findByContentHashes` case. So `findByContentHashes` needed no change to the scan logic: only the `ACTIVE` table edit below.
- 0072 applied to this Neon branch with `psql -1 -v ON_ERROR_STOP=1`; the `audience` column and `blob_assets_org_audience_hash_key` verified present afterwards (`BD-5` asserts the index on every run).
- Re-grepped every `getBlobStore` caller through U4's own scan: no new caller outside `sites-ingest.ts`; the three store calls there are exactly the table row.
- Characterization first: the existing `route.test.ts` (27 cases) and the storage suites ran green on the merged tree before any edit (145 tests in 7 files).
- F289's four Rule 16 files (`drizzle/meta/_journal.json`, `e2e/support/custom-hosts.ts`, `e2e/support/public-calendar-fixture.ts`, `scripts/test-rls.sql`) were applied from F289's `public-asset-allowlist.integration.patch` into the working tree so the e2e lane runs, and are **uncommitted**; every commit used explicit paths. Their `ON CONFLICT (organization_id, audience, content_hash)` fix is what lets `e2e/custom-domains/public-calendar.spec.ts` run. This pipeline writes no `ON CONFLICT` on `blob_assets`.

### Files Created

- `src/lib/sites-ingest.ts` (`server-only`): the wire constants; `INGEST_ERROR_CODES` and `errorResponse`; `handleIngest` (JSON 500, one `console.error` carrying only the error's name and Postgres code, because Drizzle's text quotes bound values); `authorizeIngest` (401, 503, 404, `already_current`, in the legacy order); `requireProtocol`; `readBoundedBody` and `readJsonBody`; `validateSha256`, `validateManifestKey`, `validatePages` (moved from the legacy route, caller-named field), `validatePlanImages`, `validateCommitBody`; `describeMissingKeys`; `storeSiteImage` (sniff, `store` as `public_site`, one retry on `23505`); `findHeldSiteImages` (the only caller of `findByContentHashes`); `publishSiteBundle` (private bundle, `recordSiteIngest`, audit with `transport`, revalidate). Source order of the three store calls is `storeSiteImage`, `findHeldSiteImages`, `publishSiteBundle`.
- `src/app/api/sites/ingest/plan/route.ts`, `images/route.ts`, `commit/route.ts`: thin handlers over the module (`export const POST = handleIngest(...)`). None imports the blob adapter.
- Tests: `src/lib/sites-ingest.test.ts` (78), `plan/route.test.ts` (23), `images/route.test.ts` (21), `commit/route.test.ts` (22), `staged-flow.test.ts` (6), `src/lib/storage/blob-store-find.test.ts` (14), `blob-store-find.db.test.ts` (5), and the shared `src/lib/testing/site-ingest-harness.ts` (token signer and JWKS stub, synthetic image generator, flag flip, fixture orgs with a provisioned site, teardown).
- `docs/work-log/site-ingest-size.integration.patch`: the Rule 16 patch (below). Uncommitted scratch, never to be committed: `scratch/bridge/br1.test.ts` and `scratch/bridge/vitest.config.ts` (gitignored).

### Files Modified

- `src/app/api/sites/ingest/route.ts` (legacy): thin; gate, bounded read, `validateBundle` (kept here), per-image `storeSiteImage`, `publishSiteBundle(... "legacy")`; header comment rewritten for the four routes and `code`. `imageKeys` is built with `Object.fromEntries` (a `__proto__` key is data; before, `imageKeys["__proto__"] = ...` was a silent no-op). The unreachable "is not valid base64" branch is kept as it was.
- `src/lib/storage/blob-store.ts`: `findByContentHashes` on `BlobStore` and `PostgresBlobStore`, `MAX_FIND_HASHES`, header comment.
- `src/app/api/sites/ingest/route.test.ts`: plumbing moved to the harness; every existing case unchanged; audit `toEqual` gains `transport: "legacy"`; new cases LG-2..LG-8 (9 tests).
- `src/lib/storage/audience-callsites.test.ts`: the `ACTIVE` row for `src/app/api/sites/ingest/route.ts` removed; `src/lib/sites-ingest.ts: ["store:public_site", "findByContentHashes:public_site", "store:private"]` added. No change to the scan's logic.
- `src/proxy.test.ts`: PX-1 (the three paths join `platformPaths`) and PX-2 (the matcher matches all four ingest paths; a hypothetical `/images/hero.jpg` would not, which is why the paths are fixed). `e2e/custom-domains/lockdown.spec.ts`: PX-3 (the three paths in `PLATFORM_PATHS` and in the POST list). `src/proxy.ts` is untouched.
- `docs/work-log/2026-10-26-site-ingest-size.md`: E17 and E18 added to the Copy table (Batch A's two strings); this section; status rows.

### API contract (as built; the wire is the Phase 3 "API Contract" unchanged)

| Method + path | Gate | Request | Success |
|---|---|---|---|
| `POST /api/sites/ingest` (legacy) | OIDC, `sites.public_render`, repo site, `already_current` | `{ bundle: { schemaVersion: 1, pages, images: [{ manifestKey, contentType, bytesBase64 }] } }`, at most 4,000,000 bytes and 2,000 images | `200 { status: "ingested", organizationSlug, commitSha, pageCount }` |
| `POST /api/sites/ingest/plan` | same + `x-presby-ingest-protocol: 1` | `{ images: [{ sha256, size }] }` | `200 { status: "planned", missing: [hex...] }` |
| `POST /api/sites/ingest/images` | same + `x-presby-sha256: <hex>` | the raw bytes of one image | `200 { status: "stored", sha256, byteSize, contentType }` |
| `POST /api/sites/ingest/commit` | same + protocol header | `{ schemaVersion: 1, pages, images: [{ manifestKey, sha256 }] }` | the legacy success body |

Any of the four answers `200 { status: "already_current", organizationSlug, commitSha }` from the gate. Errors on all four: `{ status: "error", code, error }` over the closed set (`unauthorized` 401, `site_not_provisioned` 404, `ingest_disabled` 503, `request_too_large` 413, `invalid_json` / `invalid_request` / `unsupported_protocol` / `hash_mismatch` / `not_an_image` / `images_not_uploaded` / `reserved_page` / `image_rejected` 422, `server_error` 500). Authorization is the OIDC repository identity only (no `FEATURES.*`, no session); the flag `sites.public_render` is checked on every route. No new `FEATURES` key, no flag, no seed change, no migration, no new dependency.

Adapter: `BlobStore.findByContentHashes({ organizationId, audience: BlobAudience, contentHashes: readonly string[] }): Promise<Map<string, BlobRef>>` (1..2,000 distinct lowercase 64-hex digests, else `BlobValidationError` before any query; never selects `bytes`).

### Audit Events

`SITE_CONTENT_INGESTED` is written once per publish by `publishSiteBundle`, on both transports, with metadata exactly `{ repo, commitSha, pageCount, imageCount, transport }` (`transport` is `"legacy"` or `"staged"`; `imageCount` is the number of manifest entries on both). Pinned by `CM-2`, `LG-1` and `LG-7`. Plan and upload write none, and `UP-9` and `PL-9` assert it. `check:audit` does not scan route files (DECISION-084), so the route tests are the coverage.

### Schema Changes

None. 0072 was applied to this pipeline's Neon branch only so the DB-backed tests can run.

### Gates

| Gate | Result |
|---|---|
| Failing-first | `BS-*` and `BD-1..4` red (`findByContentHashes is not a function`: 18 failed) before the adapter method; the new legacy cases `LG-2`, `LG-4..LG-8` run against the **pre-change** route (restored from `HEAD` for the run, then put back): 8 failed, 1 passed (`LG-3`, which the old route already satisfied) before the fix. `SI-*`, `PL-*`, `UP-*`, `CM-*` and `SF-*` test routes that did not exist, so they were authored with the code and are red by absence. |
| `npm run typecheck` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run build` | passes; `.next/server/app/api/sites/ingest/{commit,images,plan,route}` all emitted |
| `npm run check` | all eight tripwires pass (audit, sql-date, deps-drift, brand-scope, secrets, hydration-gate, giving-boundaries, proxy-imports) |
| Unit suite (`npx vitest run`, no database) | 598 files passed, 90 skipped; 9,147 tests passed, 2,664 skipped (DB-backed suites skip without the env) |
| DB-backed, serial (`dotenv -e .env.local -- vitest run --no-file-parallelism`) over `src/app/api/sites`, `src/lib/storage`, `src/lib/sites*`, `src/lib/tenant-branding`, `src/lib/brand/read-org-brand`, `src/lib/testing`, `src/app/(public)/site` | 42 files, **831 tests, all passed** |
| New tests in this batch | 179: 14 `BS` + 5 `BD` + 78 `SI` + 23 `PL` + 21 `UP` + 22 `CM` + 6 `SF` + 9 `LG` + 1 `PX-2` (PX-1, PX-3 and the audience table extend existing cases) |
| e2e, own dev server on :3610 (`E2E_BASE_URL`/`AUTH_URL` `http://localhost:3610`, `RATE_LIMIT_DISABLED`, `DOMAINS_*` fakes, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET`, `E2E_ALLOW_SHARED_DB`) | `custom-hosts` project: `lockdown.spec.ts`, `assets.spec.ts`, `serving.spec.ts`, `public-calendar.spec.ts`: **76 passed**; `chromium` project `public-sites.spec.ts`: **7 passed**. Server stopped by PID (21630). No auth-path file was touched, so no MFA login e2e is required (Phase 3 handoff). |

Not run: the full `npm run test:db` (about 40 minutes; F289's Batch 1 full run is the baseline and this batch adds no schema); `scripts/test-rls.sql` (no schema change); the `prod-build` e2e lane. `src/proxy.test.ts` has one environment-sensitive case (`treats loopback as the platform outside a production deployment`) that fails when the file is run under `dotenv -e .env.local` and passes in the plain unit lane; `src/proxy.ts` and everything it imports are unchanged by this pipeline, so it is not caused by it (not investigated further).

### BR-1 — the bridge run (real site-kit client, real handlers, in process)

`scratch/bridge/br1.test.ts` (gitignored; run with `dotenv -e .env.local -- vitest run --config scratch/bridge/vitest.config.ts --no-file-parallelism`). It imports the **real** `/Users/cshenso/git/presby-platform/presby-site-kit-ingest/scripts/ingest.mjs` (v4.1.0, `ad109b1`) by `file://` URL, injects a `fetch` that turns each client request into `new Request(url, init)` and calls the real `POST` for that path with a real RS256 token minted per request (the JWKS `fetch` is stubbed, as in `route.test.ts`), against real Postgres. Synthetic bytes only. **5 passed.** Pasted output (the client's own log lines; `requests:` is `path:body-bytes`):

```
--- (a) small site ---
Built 2 page(s) and 2 image(s): 2 distinct, 50.0 KB.
Sending the site as one request (67.1 KB of the 4.0 MB allowed).
Published commit sha-sma to "br1-small-<stamp>" (2 page(s)).
requests: /:67075            tokens minted: 1

--- (b) 6 MB site, staged ---
Built 2 page(s) and 5 image(s): 5 distinct, 6.0 MB.
The site is 8.0 MB as one request, over the 4.0 MB limit, so images are sent one at a time.
Checking which of the 5 distinct image(s) the platform still needs.
0 already on the platform; 5 to upload.
Uploaded 1 of 5: "photo-1" (1.2 MB).   ... through   Uploaded 5 of 5: "photo-5" (1.2 MB).
Publishing 2 page(s) and 5 image reference(s).
Published commit sha-big to "br1-big-<stamp>" (2 page(s)).
Sent 5 new image(s); 0 already on the platform.
requests: /plan:477  /images:1200000 x5  /commit:779            tokens minted: 7

--- (c) same sha again ---
Checking which of the 5 distinct image(s) the platform still needs.
The platform has already ingested commit sha-big; nothing to do.
requests: /plan:477            tokens minted: 1

--- (d) new sha, same images ---
All 5 image(s) are already on the platform; nothing to upload.
Publishing 2 page(s) and 5 image reference(s).
Published commit sha-big to "br1-big-<stamp>" (2 page(s)).
Sent 0 new image(s); 5 already on the platform.
requests: /plan:477  /commit:779            tokens minted: 2

--- (e1) forced failure at the 4th upload (the 4th image request and its retries answered 500) ---
0 already on the platform; 5 to upload.
Uploaded 1 of 5: "pic-1" (1.2 MB).  Uploaded 2 of 5: "pic-2" (1.2 MB).  Uploaded 3 of 5: "pic-3" (1.2 MB).
requests: /plan  /images x6 (3 stored, then the 4th and its 2 retries)   tokens minted: 7
  -> the client threw IngestFailure; organization_sites unchanged (no sha, no bundle key); 3 public_site rows held

--- (e2) the re-run ---
3 already on the platform; 2 to upload.
Uploaded 1 of 2: "pic-4" (1.2 MB).  Uploaded 2 of 2: "pic-5" (1.2 MB).
Publishing 2 page(s) and 5 image reference(s).
Published commit sha-res to "br1-resume-<stamp>" (2 page(s)).
Sent 2 new image(s); 3 already on the platform.
requests: /plan:477  /images:1200000 x2  /commit:769            tokens minted: 4
(third run: already_current)
```

Asserted in the run: legacy for the small site; staged for the 6 MB site (the legacy body would be about 8.0 MB, over 4.5 MB); **every request body at most 4,000,000 bytes**; a token minted per request (`tokens == requests`); the five published `imageKeys` resolve through `resolvePublic` to the original bytes; the failed run leaves the site unchanged and the re-run uploads only what is missing. Every item in Batch A's "What Batch B must match" list held against the real handlers, with no change to either side.

### Rule 16 patch (not committed to the shared files; the patch file is committed)

`docs/work-log/site-ingest-size.integration.patch` (applies cleanly with `git apply --check` against this branch's HEAD): DECISION-279 final text with the implementation addendum (`docs/decisions.md`), two operator lines under Deployment and a "Site ingest follow-ups" Backlog subsection (`docs/TODO.md`: chunked upload, orphan `public_site` images, a storage budget, page-to-image reference validation, the sequential-upload and token-reuse revisit, server-side sha ordering, the pasturechurch README wording), the "Site ingest: the staged transport" section with the rollout order, rollback and unverified list (`docs/deployment.md`), and the Ingest line (`docs/product/functionality-map.md:100`). The edits were made in the working tree, captured with `git diff`, and the four files reverted, so none is on the branch.

### Implementer Notes — deviations and findings

1. **Two server strings are not in the Copy table** (QA copy-truthfulness will find them): `Unsupported schemaVersion.` (the commit body's `schemaVersion` is not 1; the legacy route says `Unsupported bundle.schemaVersion.` and S3 lists nothing for commit) and `Malformed request body.` (a plan or commit body that is not a JSON object; the same text the legacy route already has). Both are `invalid_request`, 422, read by the same log audience.
2. **`/images` checks the hash header before reading the body** (the design listed gate, bounded read, empty body, hash). The only observable difference is a request with both a malformed header and an oversize body, which now answers 422 `invalid_request` instead of 413. It avoids reading up to 4 MB for a request that is already refused.
3. **`handleIngest` logs `{ name, code }` only.** The design said "one `console.error` that carries no request content"; Drizzle's error message includes the failing statement and its bound values (image bytes), so even `err.message` is not safe to log. Cost: less to debug with; the stack stays in Vercel's own function logs.
4. **Extra exports** beyond the design's list: `requireProtocol`, `readJsonBody`, `describeMissingKeys`, `sha256Hex`, `INGEST_ERROR_CODES`, `IngestOrg`/`IngestGate`/`StoreSiteImageResult` types. `validateCommitBody` returns `{ pages, images }` and `validatePlanImages` returns `{ images }`.
5. **The legacy route builds `imageKeys` with `Object.fromEntries`** (design: staged only). One consequence: a legacy bundle with a `__proto__` manifest key now publishes that key as data (`LG-8`), where before the assignment was a silent no-op. Duplicate manifest keys in a legacy bundle still resolve last-wins, as before.
6. **A byte-identical bundle is deduplicated.** `SF-2` first asserted a new bundle row after a re-commit of the same pages and images; the bundle JSON is identical bytes, so `store()` returns the existing private row (correct, and the sha bookkeeping still advances). The test now asserts no new image row instead. Worth knowing for the operator: two publishes of identical content share one bundle blob.
7. **The grep for `ON CONFLICT` on `blob_assets` was repeated** on the merged tree: this pipeline adds none; the only ones are the two F289 already fixed (one in a Rule 16 file, applied locally and uncommitted).
8. **The unauthenticated-413 policy holds.** A body over the limit with no or a bad token is 401, because the gate runs before the body is read (`LG-3`, `PL-11`, `UP-6`, `CM-11`). That also means the limit is not an unauthenticated resource lever.
9. **Unverified, as the design said:** how undici and Vercel treat an unread oversize body on a real socket (in-process calls cannot show it; `SI-2` covers the counted path and a lying `Content-Length`); the timing of one upload on a cold function; `getIDToken` across about 80 calls. The first `site-fpcw` run is the evidence.
10. **Attribution trailers** use the `Claude Opus 5.5` line the task specified (Batch A used the session's Sonnet line).

### Handoff

Next agent: **qa** (Phase 5), then **analyst** (Phase 6). QA should: re-run the gate list above (typecheck, lint, build, `npm run check`, unit suite, the DB-backed set serially on this branch's Neon branch, the `custom-hosts` lockdown/assets/serving/calendar specs and `public-sites.spec.ts` on its own port); re-run `BR-1` (the file is in `scratch/bridge/`; the command is above; it needs `site-kit-ingest` at `ad109b1` and 0072 on the Neon branch) and read its output; confirm the failing-first claims (`LG-2`/`LG-4..8` against the old route); run the copy-truthfulness check on the Copy table including E17 and E18, the two server strings in deviation 1, and the Rule 16 patch's deployment text (it states the rollout order and what is unverified); run site-kit's own gate (`npm test` 235, `typecheck`, `actionlint`) since it has no CI; and confirm `git status` shows exactly the four F289 Rule 16 files uncommitted and nothing under `scratch/` tracked. The orchestrator applies the integration patch (`git apply --3way`), renumbers DECISION-279 if it was taken, and merges after F289 with 0072 applied to production.

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

## Orchestrator rulings on Phase 1 open questions (2026-10-26)

1. **Compatibility (OQ1):** keep the legacy single-POST accepted indefinitely; the client uses it when the whole bundle fits under the per-request ceiling. Neither repo's deploy order may break a site.
2. **Order with F289 (OQ2):** build in parallel against F289's `store({audience})` / `resolve` signatures from the F289 Phase 3 design; this pipeline merges **after** F289 (and 0072 is applied to production first). New store call sites get rows in F289's `audience-callsites` table.
3. **Hash check (OQ3), measured by the orchestrator, read-only:** the 81 files in `site-fpcw/images/` hash to 80 distinct sha256 values (two files are byte-identical), and **all 80 are already present** among production's 82 distinct FPCW image hashes in `blob_assets`. A content-addressed plan for FPCW's first real publish therefore reports zero missing images: one plan request and one small commit request.
4. **Oversize (OQ4):** accepted — fail the run early, client-side, naming the image and the limit; chunked upload is a tracked follow-up.

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-26
**Verified by:** qa
**Trees:** presby `/Users/cshenso/git/presby-platform/presby-ingest` at `41eea22` (pipeline branch `pipeline/site-ingest-size`; F289's four Rule 16 files still uncommitted, as instructed). Neon `pipeline-site-ingest-size` (`ep-nameless-cloud`). Every connection-string variable was checked by host match only; none was printed. presby-site-kit `/Users/cshenso/git/presby-platform/presby-site-kit-ingest` at `ad109b1` (v4.1.0).

**Scope run:**
- **Full:** typecheck, lint, `npm run check`, `npm run build`, the unit suite, and all of site-kit's gates.
- **DB-backed (serial):** the ingest, storage, sites, tenant-branding, read-org-brand and testing suites, and the public site tree.
- **e2e on my own server at :3610:**
  - custom-hosts project: `lockdown`, `assets`, `serving`, `public-calendar`.
  - chromium: `public-sites.spec.ts`.
- **Global flags:** reset to the CI baseline with `scripts/ci/e2e-reset-flags.sql` (`pipeline_branch=1`) before the e2e run.

**Not re-run:**
- The full `test:db`. This pipeline's own diff (`5fbb90f..41eea22`) touches no migration, no `src/lib/db/`, no `authz.ts` and no shared e2e fixture. 0072 and the `src/lib/db` changes arrived with F289's merge, and F289's QA covers them.
- `scripts/test-rls.sql` (no schema change here).
- The prod-build lane and the full chromium suite: no layout, proxy, auth or `e2e/support` change in this diff. The PR's CI covers them.
- The 360 px check. No UI changed. Phase 3 placed the visitor-side image check at runbook step 5, after the first FPCW publish in production. It is still owed there.

## Type Check

`npm run typecheck`: **PASS**. Also clean:
- `npm run lint` (`--max-warnings=0`).
- `npm run check`: all eight tripwires pass.
- `npm run build`: passes, and `/api/sites/ingest`, `/plan`, `/images`, `/commit` are all emitted as dynamic routes.

site-kit:
- `npm run typecheck` clean.
- `npm run build` clean, with no `dist/` change (`git status` clean afterwards).
- `actionlint .github/workflows/ingest.yml` exits 0.

## Unit Tests

| Suite | Files | Tests | Result | Time |
|---|---|---|---|---|
| presby unit (`npm run test`, no DB) | 598 passed, 90 skipped | 9,147 passed, 2,664 skipped, 0 failed | pass | 29.9 s |
| presby DB-backed (`dotenv … vitest run --no-file-parallelism` over the set above) | 42 passed | 831 passed, **0 skipped**, 0 failed | pass | 86.0 s |
| presby-site-kit `npm test` | 22 passed | 235 passed, 0 skipped | pass | 1.8 s |

- The 90 files skipped in the unit lane are the DB-backed suites, which skip without the env. The ingest, storage and sites ones ran green in the DB lane above, with no skips.

**BR-1 (the implementer's bridge run, re-run as-is):** `scratch/bridge/br1.test.ts`, 5 of 5 passed.

**QA's own bridge** (scratch copy only, now deleted): the real client `ingest.mjs@ad109b1` against the real handlers `@41eea22` and real Postgres, with synthetic images and a freshly signed token per request. 8 of 8 passed. Real client log lines are quoted where they matter.

| Case | Result |
|---|---|
| Q1: small site | Legacy, one request of 53,559 bytes, 1 token |
| Q2: 8.0 MB site, 5 files with 4 distinct, over a **real socket** (real `fetch` into a local HTTP server wrapping the handlers) | Staged: `/plan:384`, `/images:1600000` ×4 (the duplicate sent once), `/commit:635`. 6 tokens for 6 requests. Every body ≤ 4,000,000. `dup` and `p1` share one blob. Every `imageKeys` value resolves through `resolvePublic` to the original bytes |
| Q3: same sha | `The platform has already ingested commit …; nothing to do.` One `/plan`, and the blob row count is unchanged |
| Q4: new sha, same images, with the commit reply lost twice (502) | `All 4 image(s) are already on the platform; nothing to upload.` Plan, then commit ×3 (two retries), published once |
| Q5: forced failure at the 3rd upload | `Step "upload" for image "r2": the platform answered 500: …`. `last_ingested_commit_sha` and `content_bundle_key` stay null. The re-run prints `2 already on the platform; 2 to upload.` and publishes. A third run answers `already_current` |
| Q6: exact boundary across both repos | A 4,000,000-byte image is accepted by the real `/images` (body exactly 4,000,000). A 4,000,001-byte image gets E1 from the client, with 0 requests and 0 tokens |
| Q7: a 4,000,001-byte body with a **valid** token over a real socket | 413 `{"status":"error","code":"request_too_large",…}` on all four routes |
| Q8: suspended site | See Copy Truthfulness: the log says "Published", the site stays `suspended` |

- Every response in Q1–Q7 was scanned for a uuid-shaped string. None was found.

## End-to-End Tests

Own dev server on :3610 (`E2E_BASE_URL`/`AUTH_URL` `http://localhost:3610`):
- Env: `RATE_LIMIT_DISABLED=true`, the `DOMAINS_*` fakes, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET`, `E2E_ALLOW_SHARED_DB=true`.
- The server was stopped by PID (64390/64410), and port 3610 is confirmed free.

| Run | Total | Passed | Failed | Skipped | Time |
|---|---|---|---|---|---|
| `--project=custom-hosts` lockdown, assets, serving, public-calendar | 76 | 76 | 0 | 0 | 2.0 m |
| `--project=chromium` `e2e/public-sites.spec.ts` | 7 | 7 | 0 | 0 | 12.4 s |

Real-server probes (curl against :3610):
- Unauthenticated `POST` to `/api/sites/ingest`, `/plan`, `/images` and `/commit` each answers `401`, `content-type: application/json`, `{"status":"error","code":"unauthorized",…}`, with no `Set-Cookie` and no uuid. This is runbook step 1 confirmed.
- A 5 MB unauthenticated body to `/images` answers 401, not 413.
- `GET /plan` answers 405.
- `POST /api/sites/ingest/nope` (a stand-in for a rolled-back server) answers an HTML 404 that does not parse as the error format. That confirms the rollback claim that the client prints E12.

## Regression Tests Added

Failing-first was reproduced independently in a `git archive` scratch copy: the HEAD tree with `src/app/api/sites/ingest/route.ts` restored from `5fbb90f`.

- **Legacy cases against the pre-fix route:** 9 failed, 27 passed. That is LG-2 ×2, LG-4, LG-5, LG-6 ×2, LG-7, LG-8, plus the audit-metadata case (`transport`). LG-3 passed, as the implementer reported. This matches the Phase 4 claim.
  - **LG-7 is a characterization, not a regression guard.** Before the fix it failed only on the new `transport` metadata, because the dedup it describes already held.
- `src/app/api/sites/ingest/route.test.ts:797`, LG-2: a body over 4,000,000 bytes is a JSON 413. Guards against the plain-text platform 413 reappearing as an unreadable failure.
- `src/app/api/sites/ingest/route.test.ts:815`, LG-3: an oversize body without a valid token is 401. Guards against the limit becoming an unauthenticated lever.
- `src/app/api/sites/ingest/staged-flow.test.ts:150`, SF-1: a site over 4.5 MB publishes with every request ≤ 4,000,000. Guards the defect itself, as a property.
- `src/app/api/sites/ingest/commit/route.test.ts:230`, CM-4: a missing hash refuses the whole commit and changes nothing. Guards sha-last and all-or-nothing publishing.
- `src/app/api/sites/ingest/plan/route.test.ts:231` (PL-10), `images/route.test.ts:266` (UP-9), `commit/route.test.ts:374` (CM-12): no uuid in any response.
- site-kit `test/ingest.test.ts:321` (KI-2 boundary), `:369` and `:932` (KI-3: every body ≤ limit, one token per fetch), `:622` (KI-9 exact image).

Mutation checks. Every mutation below was caught:

| Repo | Mutation | Caught by |
|---|---|---|
| site-kit | legacy/staged boundary `<=` → `<` | KI-2 |
| site-kit | token cached once per run | KI-3 ×2, KI-14 ×2, KI-26 |
| site-kit | image limit `>` → `>=` | KI-9 |
| site-kit | `MAX_REQUEST_BYTES` → 4,500,000 | KI-1, KI-2, KI-12 |
| site-kit | `redirect: "follow"` | KI-3, KI-24 |
| presby | counted body limit `>` → `>=` | SI-2 |
| presby | plan/commit lookup audience `public_site` → `private` | 3 unit cases (incl. SI-13 and the audience-callsites table), plus 8 DB cases (PL-3, PL-4, CM-2, CM-3, CM-4, CM-5, CM-7, CM-12) |

The tests guard the property, not one literal line.

## Coverage on Critical Modules

Not re-measured. This diff does not touch `src/lib/permissions.ts`, `src/lib/two-factor.ts` or `src/lib/flags.ts`.

## Feature-Gate Audit

These routes have no session and no `FEATURES.*` key by design: authorization is the GitHub OIDC repository identity (DECISION-087). The audit was done by reading each handler body. Each one's first statement is `authorizeIngest(req)`, which runs in this order:

1. OIDC verification → 401, code `unauthorized`. The verifier only returns status 401.
2. `sites.public_render` off → 503, code `ingest_disabled`.
3. `resolveOrganizationByRepo` with no match → 404, code `site_not_provisioned`, as JSON.
4. Verified `sha` equals `last_ingested_commit_sha` → 200 `already_current`.

The body is never read before the gate passes. The organization and sha come only from the verified claims.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `POST /api/sites/ingest` (legacy) | n/a: OIDC via `authorizeIngest`, first statement | n/a | n/a; flag `sites.public_render` 503 |
| `POST /api/sites/ingest/plan` | n/a: OIDC via `authorizeIngest`, first statement | n/a | n/a; flag 503; then `x-presby-ingest-protocol: 1` |
| `POST /api/sites/ingest/images` | n/a: OIDC via `authorizeIngest`, first statement | n/a | n/a; flag 503; protocol header; server-side sha256 and sniff |
| `POST /api/sites/ingest/commit` | n/a: OIDC via `authorizeIngest`, first statement | n/a | n/a; flag 503; protocol header; server-derived `imageKeys` |

- **Gate tests:**
  - SI-3 covers the order table-driven across all four handlers.
  - PL-1, UP-1 and CM-1 cover it against real Postgres.
  - On the real server, an unauthenticated POST answers 401 JSON on every route.
- **404 stays JSON on `/plan`:** `site_not_provisioned` is sent through `errorResponse`. So a JSON 404 gives the provisioning hint, not E12 (KI-15).
- **Custom host:** `/api/sites/ingest/{plan,images,commit}` get the neutral 404 with no cookie (`lockdown.spec.ts:152`, passed). `src/proxy.ts` is untouched. PX-2 pins that none of the fixed paths falls under the F151 extension exclusion.
- **Schema/RLS:** this pipeline makes no schema change. Live-catalog probe of `blob_assets` on the pipeline branch:
  - `relrowsecurity` and `relforcerowsecurity` are both `t`.
  - The policy is `tenant_isolation` (ALL).
  - `blob_assets_org_audience_hash_key` is present.
  - `presby_app` holds `INSERT,SELECT` only.
  - The new lookup runs on `presby_app` inside `withTrustedOrgContext` with an explicit `organization_id` filter. BD-3 (cross-org absent) runs against real `presby_app`.

## Copy Truthfulness

- [x] Every added or changed string is in the design's Copy table. **Three exceptions:**
  - `Unsupported schemaVersion.` at `src/lib/sites-ingest.ts:366` is new and not in S3.
  - `Malformed request body.` at `:318` and `:364` reuses the legacy text on `/plan` and `/commit`, but S3 does not list it there.
  - Both are true. They need S3 rows (doc-only), as implementer deviation 1 already flagged.
  - The README section "Publishing a site (ingest)" has no Copy rows. It is true apart from "exactly as before": per deviations 7 and 8, the legacy body now carries the sniffed `contentType` and a sorted image order. Non-blocking.
- [x] The query behind each claim was opened. **One defect, below.** Checked and true:
  - L4a/L4b/L9 "already on the platform": `findByContentHashes(public_site, org)`. It does not read other organizations or `private` rows, and the copy only claims usable-as-site-image.
  - L8 "ingested": reads `last_ingested_commit_sha` only.
  - E13's "Nothing was published" for plan and upload: neither writes `organization_sites`.
  - H503 "not accepting": correctly avoids "switched off".
- [x] Each instruction is traceable to the reader. The audience is a site repository collaborator: re-run, replace or rename a file, set repository variables (repository admins), contact support. Nothing points them at a platform-admin action.
- [x] Older strings checked:
  - The old `presby ingest responded …` and `Ingest failed with status …` lines are removed. KW-2 pins that `bundle.json` is gone.
  - `docs/deployment.md` and `docs/TODO.md` staleness is already queued as an operator item in the Rule 16 patch.
  - The release-note draft does **not** promise the first publish uploads nothing. The patch's `docs/deployment.md` step 2 says "do not promise it uploads nothing".

**copy truthfulness: FAIL (one defect)**

- **L7 on a suspended site.**
  - Where: `presby-site-kit-ingest/scripts/ingest.mjs:252`; Copy table L7 at `docs/work-log/2026-10-26-site-ingest-size.md:873`.
  - Viewer: a site repository collaborator reading the GitHub Actions log.
  - What it says: `Published commit {sha7} to "{slug}" ({pageCount} page(s)).`
  - What it reads: only the 200 `ingested` body. That body carries no site status.
  - What actually happens: `recordSiteIngest` (`src/lib/sites.ts:1486`) keeps a `suspended` site `suspended`, so nothing is published to visitors.
  - Reproduced with the real client in QA bridge case Q8. The log printed `Published commit q8-1792 to "qabr-susp-…" (1 page(s)).`, and the row afterwards was `status: suspended`.
  - The design applied exactly this reasoning to L8 ("ingested", not "published", because a suspended site is ingested but not shown) but not to L7.
  - The fix is a wording ruling plus a client change. The existing exact-text cases (`test/ingest.test.ts:317`, `:435`, `:464`, under KI-2 and KI-25) must be updated so they fail on the old text.

**Release-note draft wording** (required edit at `/release-notes`, non-blocking for Phase 5):
- `docs/work-log/2026-10-26-site-ingest-size.md:939` says the site "can be published **again**".
- No CI run of a large site ever published. Every `site-fpcw` run failed, and the August load was a scratch load.
- Use "can now be published".

**DECISION-279 draft** (`docs/work-log/site-ingest-size.integration.patch:79`, non-blocking):
- It says "an unauthenticated caller sees a 401, not a 413".
- That holds up to Vercel's 4.5 MB cap. Above it, the platform's plain-text 413 answers before any route code runs.
- Suggest "the app's own 413 is answered only to an authenticated caller".

## Verdict

**FAIL**: copy truthfulness, one defect (L7 says "Published" for a suspended site). Every technical check is green:
- typecheck, lint, the eight tripwires and the build;
- unit suite, the scoped DB lane and site-kit's 235 tests;
- BR-1, plus QA's extended bridge over a real socket;
- e2e, 83 of 83;
- failing-first reproduced, with mutations caught on both sides;
- gate audit clean, no uuid in any response.

This is not auth-touching: `src/auth.ts`, `src/proxy.ts`, `src/app/(auth)/`, `src/app/api/auth/` and `src/lib/auth/` are untouched. So the MFA login e2e does not apply.

The defect is in a design-authored string (Copy L7), so the loop-back goes to **Phase 3 (tech-lead)** for the L7 wording first. Then to **Phase 4 Batch A (full-stack-developer)** to change `scripts/ingest.mjs:252` and the exact-text assertions at `test/ingest.test.ts:317`, `:435` and `:464`. The same pass should add the two missing S3 rows.

The re-verification is narrow:
- site-kit `npm test`, typecheck and actionlint;
- one BR-1 re-run;
- the copy check on the new L7.

The presby server needs no change unless tech-lead decides the success body should carry the site status.

**Non-blocking notes:**
1. Commit `7ef67b6` carries `Caught-By: agent-review`. The defect surfaced when a real `site-fpcw` CI run hit the production platform, and no agent chose to run a check. By CLAUDE.md's rule that reads as `Caught-By: production`. The commit is unpushed, so it can still be reworded.
2. Q4 shows that a commit whose reply is lost after `recordSiteIngest` is retried and reported as success. If the lost reply hid an audit-write failure, the publish has no audit row. This is the existing "UPDATE and audit are separate statements" gap from Phase 1, now reachable through retries. Record it under residuals.
3. Sites whose legacy body is between 4.0 and 4.5 MB and still run a pre-v4.1.0 client would get a 413 after the server deploys. No real site is in that band (pasturechurch is tiny, FPCW is 37.8 MB). Worth one line in the rollout note.

**Housekeeping:**
- Both worktrees are as found. presby shows only F289's four Rule 16 files modified, and nothing under `scratch/` is tracked. site-kit is clean.
- My bridge fixtures were torn down (0 `qabr-`/`br1-` organizations remain).
- The scratch copies `presby-pre` and `sk-mut`, the copied `.env.local` among them, were deleted by literal path. What remains under the scratchpad are tracked `.env.example` templates from earlier sessions' archives, with no secrets.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete. All gates green: presby 9,147 unit, 831 DB, 83 e2e; site-kit 235; BR-1 5/5 and QA bridge 8/8; failing-first and mutations reproduced; gate audit clean. One copy-truthfulness defect (L7 "Published" on a suspended site). Two S3 rows missing | FAIL | 2026-10-26 |

## Handoff

The next agent is **tech-lead** (Phase 3 loop-back, Copy table only):
- rule on the L7 wording for a suspended site, for example "Sent commit {sha7} to "{slug}" ({n} page(s)); the platform has ingested it.", or have the server report the site status;
- add S3 rows for `Unsupported schemaVersion.` and `Malformed request body.` (plan/commit).

Then **full-stack-developer** (Phase 4 Batch A):
- change `/Users/cshenso/git/presby-platform/presby-site-kit-ingest/scripts/ingest.mjs:252`;
- update the exact-text assertions at `/Users/cshenso/git/presby-platform/presby-site-kit-ingest/test/ingest.test.ts:317`, `:435` and `:464` so they fail on the old text.

Then back to **qa** for the narrow re-run above. The release-note "again" edit and the DECISION-279 qualifier go to the orchestrator at integration and `/release-notes`.

Files read or run (absolute paths):
- `/Users/cshenso/git/presby-platform/presby-ingest/docs/work-log/2026-10-26-site-ingest-size.md`
- `/Users/cshenso/git/presby-platform/presby-ingest/docs/work-log/site-ingest-size.integration.patch`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/sites-ingest.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/app/api/sites/ingest/route.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/app/api/sites/ingest/plan/route.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/app/api/sites/ingest/images/route.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/app/api/sites/ingest/commit/route.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/storage/blob-store.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/sites.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/src/lib/testing/site-ingest-harness.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/scratch/bridge/br1.test.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/e2e/custom-domains/lockdown.spec.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/playwright.config.ts`
- `/Users/cshenso/git/presby-platform/presby-ingest/scripts/ci/e2e-reset-flags.sql`
- `/Users/cshenso/git/presby-platform/presby-site-kit-ingest/scripts/ingest.mjs`
- `/Users/cshenso/git/presby-platform/presby-site-kit-ingest/scripts/build-bundle.mjs`
- `/Users/cshenso/git/presby-platform/presby-site-kit-ingest/.github/workflows/ingest.yml`
- `/Users/cshenso/git/presby-platform/presby-site-kit-ingest/README.md`
- `/Users/cshenso/git/presby-platform/presby-site-kit-ingest/test/ingest.test.ts`

Run logs are under `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/logs/`.

## Orchestrator rulings on Phase 5 run 1 (2026-10-26)

- **L7 (copy truthfulness defect):** the client prints, on a 200 `ingested` body: `Sent commit {sha7} to "{slug}" ({pageCount} page(s)); the platform has ingested it.` — it claims ingestion, which the body proves, and never "published", which a suspended site is not. No server change. The exact-text assertions at site-kit `test/ingest.test.ts:317`, `:435`, `:464` change so they fail on the old "Published commit…" text.
- **S3 rows added:** `Unsupported schemaVersion.` (commit; a bundle schema version other than 1) and `Malformed request body.` (plan and commit, as on the legacy route) — both true as worded; no code change.
- **Release note:** say the site "can now be published", not "again".
- **DECISION-279:** "the app's own 413 is answered only to an authenticated caller" (above Vercel's 4.5 MB cap the platform answers first).
- **Residual recorded:** a commit whose reply is lost after `recordSiteIngest` is retried and reported as success; if the lost reply hid an audit-write failure, that publish has no audit row (the existing separate-statement gap from Phase 1, now reachable via retries).
- **Rollout note:** a site whose legacy body is 4.0–4.5 MB on a pre-v4.1.0 client would get a 413 after the server deploys; no real site is in that band.
- **`7ef67b6` trailer** reads `Caught-By: agent-review`; by CLAUDE.md the defect surfaced on a real production CI run (`Caught-By: production`). Left as is (rewriting mid-branch history across a merge is riskier than the stats error); noted for the retrospective.

## Phase 4 — L7 fix (2026-10-26)

Applied in the site-kit worktree on `fix/staged-ingest` as `ea9e78a` (on top of `ad109b1`; not pushed, not merged).

- `scripts/ingest.mjs:252` now prints `Sent commit {sha7} to "{slug}" ({pageCount} page(s)); the platform has ingested it.` No README line quoted the old text.
- Red: the three exact-text assertions (`test/ingest.test.ts:317`, `:435`, `:464`) were changed first and failed against the old string (3 failed, 232 passed).
- Green: after the one-line change, `npm test` 235/235, `npm run typecheck` and `npm run build` clean, `actionlint .github/workflows/ingest.yml` clean. `dist/` is tracked but unchanged (the script is not part of the build output).
- Commit trailers: `Caught-By: agent-review`, `Discovered-In: Phase-5`.
