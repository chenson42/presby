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
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
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

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

## Summary

[One paragraph: what we're building and why.]

## Permissions & Flags

- Permission key(s): `area.action`
- Default role bindings: [list]
- Feature flag(s): [key, or "not needed"]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]

## Implementation Order

1. Schema (if any) → `npm run db:push` on a Neon branch
2. `FEATURE_CATALOG` entry + seed binding
3. Route handlers / server actions
4. UI
5. Audit events for security-sensitive paths
6. Release notes entry

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| [gap or ruling] | [section, or deferred + who accepted] |

## Edge Cases & Risks

- [Thing that could fail or that needs special handling; each claim cites the test that pins it or says "unverified"]

## Copy

- [Every user-facing string, checked against the accepted residuals: copy may not deny a residual the record admits]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Applied via: `npm run db:push` / `npm run db:generate`

## Audit Events

- [Action key written when the security-sensitive mutation fires]

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

Strings added or changed: [file:line each, or "none"]

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

## Orchestrator rulings on Phase 1 open questions (2026-10-26)

1. **Compatibility (OQ1):** keep the legacy single-POST accepted indefinitely; the client uses it when the whole bundle fits under the per-request ceiling. Neither repo's deploy order may break a site.
2. **Order with F289 (OQ2):** build in parallel against F289's `store({audience})` / `resolve` signatures from the F289 Phase 3 design; this pipeline merges **after** F289 (and 0072 is applied to production first). New store call sites get rows in F289's `audience-callsites` table.
3. **Hash check (OQ3), measured by the orchestrator, read-only:** the 81 files in `site-fpcw/images/` hash to 80 distinct sha256 values (two files are byte-identical), and **all 80 are already present** among production's 82 distinct FPCW image hashes in `blob_assets`. A content-addressed plan for FPCW's first real publish therefore reports zero missing images: one plan request and one small commit request.
4. **Oversize (OQ4):** accepted — fail the run early, client-side, naming the image and the limit; chunked upload is a tracked follow-up.
