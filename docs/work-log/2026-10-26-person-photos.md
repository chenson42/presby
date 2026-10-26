# Person and household photos — Work Log

> **Slug:** `2026-10-26-person-photos`
> **Surface:** mixed — (org) directory/community/admin, (account) own profile, (public) staff and leadership on the site
> **Permission(s):** TBD in Phase 1
> **Flag(s):** not needed (per-org toggle if any; no new platform flags pre-live)
> **Estimated complexity:** large
> **Pipeline mode:** Full
> **Numbers (pre-assigned):** F330–F339; DECISION-285–289; migration 0078 (and 0079 if split); dev port 3620
> **Worktree:** `/Users/cshenso/git/presby-platform/presby-photos`, branch `pipeline/person-photos`, from `main` 21beebc (0.44.0)
> **Operator request (2026-10-26, verbatim):** "have you added picture support for the community and directory yet? i'm thinking we'll need to support multiple photos eventually. for example for staff and leadership we have headshots taken that all match for the website. they belong with the user's profile but we'll need to harvest the correct ones for the pictures and let someone designate which pictures they want to use for the directory. might even want to have photo support at the household level"

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; gaps G1–G17; operator questions Q1–Q5; hard dependency on F289 0072 merging before Phase 4 | READY WITH NOTES | 2026-10-26 |
| 2 — Architectural review | architect | Complete; R1–R12; DECISION-285–288 proposed; F330–F332; Q6 fallback consent (default attested-only); sharp approved | Approved with suggestions | 2026-10-26 |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Phase 1 — Functional Refinement (analyst), Person and household photos

Work-log: `docs/work-log/2026-10-26-person-photos.md`. Numbers: F330–F339, DECISION-285–289, migration 0078 (0079 if split), port 3620. I read the worktree at main `21beebc`, the in-flight F289 pipeline in `/Users/cshenso/git/presby-platform/presby-assets` (its Phase 1–3 and the 0072 draft), the prior-art app, and the sibling content repo. I cite no real names or filenames below. I edited no files.

## VERDICT

READY WITH NOTES. The feature is worth building, but its shape depends on four operator rulings (Q1–Q4). Q2 changes the data model, so it must be answered before Phase 2 rules on schema. Q1, Q3 and Q4 must be answered before Phase 3. Each question has a stated default, so Phase 2 can start in parallel.

There is also a hard dependency for the orchestrator. This branch is based on main without F289's migration 0072. The photo writer must use the audience, door and roster-function shapes F289 introduces. Phase 2 and 3 should design against the 0072 draft at `/Users/cshenso/git/presby-platform/presby-assets/drizzle/0072_presby_blob_audience.sql`. Phase 4 must not start until F289 is merged.

## ONE-LINE TAKE

> Let staff attach several photos to a person's record in their congregation, mark one for the member directory and one for the public website, and make removal stop serving. Do it for adults only, behind the F289 door. Everything else (self-service, minors, households, bulk harvest) depends on surfaces that do not exist yet.

## What exists today (grounding, confirmed from code)

- **Reading is built and writing is not.** The directory grid, the person page and the household member cards all render `people.photo_key` through `resolvePhotoSrc`. It inlines the photo as a `data:` URI and nulls it when `person_privacy.hide_photo` is set. Nothing in `src` writes `photo_key` or `photo_updated_at`.
- **`people` is global (D1).** It has no `organization_id`, so `photo_key` is a single value per human. The blob table is per-organization with composite keys. `resolvePhotoSrc` looks the key up under the viewing org only. A photo uploaded under one congregation therefore resolves to nothing, silently, under another. Any congregation holding a membership can update the global row (RLS `visible_via_membership`).
- **`hide_photo` has no writer.** `person_privacy` rows are never created. The "self-service privacy page" has no pipeline (TODO, DECISION-064). So "hide_photo wins" is a latent guard today, not a member-usable control.
- **There is no own-profile surface for the person record.** `(account)/account` edits only the login's display name (`users.name`). Self-upload has nowhere to live.
- **The `photo_use` and `minor_photo` consents have no UI and no reader.** The Children's ministry Increment B (consent workflow) is open in TODO.
- **Minors are not handled.** Nothing in `directory.ts` treats minors specially. The first photos in the member directory would put children's faces in front of every member.
- **Households are org-scoped** (they have `organization_id`). Photos at that level would be an org-scoped concept, unlike the person level.
- **The public site takes one photo.** `presby_public_staff_roster` and `presby_public_committee_roster` return `p.photo_key`. `StaffList` and `PersonCard` take a `photoUrl`. No site-kit change is needed.
- **The current site hand-authors its headshots.** The first customer's content repo has 18 headshots in hand-written `staffList` blocks on its leadership and committee pages. They are 117–608 KB, and at least two are 1286×1800 portraits. Several carry contact lines (email and phone) that the live roster can never project. The site works at cutover without any platform photo feature. The platform feature is about managing photos in one place, not about unblocking the site.
- **F289 builds the serving side.**
  - Photos are `private` blobs, served through one definer door only while the roster functions list the person.
  - The door's exclusion is keyed to `people.photo_key`.
  - Roster photos are cached `private, max-age=86400`.
  - `hide_photo` withholds the photo from the roster.
  - Directory flags do not gate the photo (operator ruling).
  - R4 says the first photo writer converts `photo_key` to uuid and adds a composite FK pinned `private`.
- **Prior art (`../fpcw-directory`):**
  - It has one photo per member with no designations.
  - It has a self-upload with a crop tool.
  - It has an admin mass-upload queue (`photos.manage`): filename fuzzy-matching with auto ≥0.90, review ≥0.60 and manual bands, then `pending → applied/deleted`.
  - Photos are resized to 400px with `sharp`.
  - The serving route enforces visibility, uses `private, max-age=86400` with a `?v=<updated_at>` cache key, and sends `no-store` on 404s. That cache key was added after a "my photo didn't stick" bug.
  - Multiple photos and designations are new to presby.
- **No image-processing dependency** is in `package.json`. Next 16 is the framework, and `serverActions.bodySizeLimit` is not configured. I believe the default is 1 MB, which would sit below the existing logo form's stated 2 MB cap. That is unverified at runtime and Phase 3 should confirm it.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Admin (org staff holding the manage permission) | Adds a photo to a person (file picker or phone camera) | On demand; about 18 in the first harvest |
| Admin | Sees all of a person's photos side by side and marks which one the directory shows | On demand |
| Admin | Marks which one the public website shows (a deliberate disclosure act) | On demand |
| Admin | Removes a photo (a confirm dialog, soft) | On demand |
| Authenticated member (`directory.view`) | Sees the designated directory photo, or initials | Every directory view |
| Anonymous visitor | Sees the designated website photo for a currently listed person | Every page view |
| Newly-authenticated user with no roles | None | n/a |
| Member (self) | Cannot upload or hide their own photo in this feature (no surface; see G14) | n/a |
| Parent | Cannot act for a child (no surface; minors blocked in Increment 1) | n/a |

## Flows

**Flow 1, harvest and designate (admin).**
- Entry: Community, then the person, then the existing person page (`admin/community/[id]`). The photos section lives there.
- Step 1: Add photo. Pick a file or take one on a phone. The client downsizes it. The server validates, strips metadata, normalizes and stores it as `private`.
- Step 2: The photo appears in the person's set. The first photo is offered as the directory photo.
- Step 3: "Use on the public website" is a separate, explicit action with a short disclosure line. It is only meaningful once the person is publicly listed (listing remains a separate toggle under `staff.manage`, `officers.manage` or `groups.manage`).
- Outcome: the directory shows the photo immediately. The website shows it at the next page view while the person is listed.
- Failure: wrong type, too large, too many pixels, a corrupt file, "this person is under 18" (Increment 1 refusal), too many photos, or a database blip. Each gets its own plain-language message, never a raw error, and nothing is half-saved.

**Flow 2, remove or replace.**
- The admin removes a photo through an AlertDialog (no native dialogs). Its designations clear, and the directory falls back to initials at once.
- The public site stops projecting it, and the F289 door then returns its neutral 404.
- Copies already in browsers live up to a day, which is the ruled roster TTL.
- Failure: if the photo is already removed (a double click or another admin got there first), the page says so rather than erroring.

**Flow 3, member views the directory.**
- Entry: `/o/<slug>/directory`, the person page, or the household page.
- The designated photo shows unless the person has `hide_photo` set or is hidden or ended. Otherwise initials show.
- Failure: a photo that can't be loaded renders initials, never a broken image. That graceful fallback already exists.

**Flow 4, visitor on the public site, including a church's own domain.**
- Entry: a page carrying the staff or committee live slot.
- A listed person with a website photo shows the photo. A listed person without one shows the existing no-photo rendering. The person's website photo never falls back to their directory photo (G3).
- Failure: a DB blip shows no photos but does not break the page (existing behavior, kept by F289).

**Flow 5, empty and brand-new install.**
- The person page says "No photos yet" with an Add photo button.
- The directory is unchanged, showing initials.
- The public roster is unchanged.

## Permissions & Flags

- **Permission.** Recommended default: reuse `people.manage`, tier 1 (it already gates person editing). The alternative is a new `people.photos` key so a communications volunteer can harvest headshots without address and phone edit access (see Q3). Both are tier 1: a photo is directory-level identity, not financial or pastoral.
- **Public listing stays a separate gate.** `staff.manage`, `officers.manage` and `groups.manage` toggle `public_listed`. A headshot reaches the open web only when both gates are satisfied, by two possibly different people. The UI must tell the admin which half is missing.
- **Default roles:** whichever roles hold `people.manage` today.
- **Flag.** Not a platform flag (operator rule). Recommend a per-org toggle in the existing `org_portal.*` family, named in Phase 3. Rollback with the toggle off hides the management UI and directory photos. It does not touch public serving, which stays governed by listing plus designation. Withdrawing a public photo means removing its website designation or unlisting the person.
- **Audit.**
  - Upload, designate and un-designate (per purpose), and remove all write `audit_events`. Website designation is the sensitive one, like the audited `public_listed` toggles.
  - Rows carry actor, person, photo id and purpose, and never bytes or filename.
  - The `check:audit` tripwire only scans `actions.ts` files. A write that lives in a `lib/` module needs a real-DB test of the audit row, as the 2026-08-27 pipeline did.

## Gaps the Request Didn't Address

**G1. `people.photo_key` cannot carry the cross-org case.** The photo column is global but the blob and consent are per-org.
- Two congregations sharing a person would overwrite each other's `photo_key`.
- Each would then show nothing, or initials, for that person.
- A recorded `photo_use` consent given to one congregation would be wrongly read as covering the other.
- The people.ts header gives the test: is the row about the person or the relationship? Which photo this congregation shows, and under what consent, is the relationship.
- **Recommendation:** an org-scoped photo table keyed to the membership, one set of photos and designations per congregation. `people.photo_key` is then written by no one and retired later.
- Product consequence for Q2: a person serving two bodies gets their photo uploaded once per body.

**G2. Coupling to F289 (build on it, not around it).**
- Store photos `private`, never `public_site`.
- Add the composite FK pinned `private`, per F289's R4 follow-up.
- The F289 door's "this key is a person's photo" exclusion and both roster functions read `people.photo_key`. Under G1 they must read the new designation in the same migration.
  - If that is forgotten, the safe failure is that public headshots 404.
  - If the new photos were ever stored `public_site`, the exclusion would no longer cover them and they would leak.
- The roster functions are `create or replace`d again. Restate `set search_path = public, pg_temp` and the revoke and grant, or 0072's hardening is silently lost.
- Add the new `store()` call site to F289's checked-in audience table, or its source-scan test fails.
- Keep `hide_photo` winning.
- The directory-flag ruling (the flags do not gate photo fetch) stands.

**G3. Two designations, and no fallback from website to directory.**
- A directory snapshot may not be meant for the open web, and `public_listed` is an admin opt-in, not the person's consent.
- Recommend no fallback from the website to the directory. A person with only a directory photo shows the existing no-photo rendering on the website.
- One photo may carry both designations, which is the natural case for a professional headshot.
- There is at most one active designation per purpose per person per congregation.
- Recommend the first photo defaults to the directory designation. The website designation is never defaulted.

**G4. Consent matrix across surfaces.**

| | Directory | Public site | Admin person page |
|---|---|---|---|
| `hide_photo` set | none | none (ruled) | shown to the manager with a note |
| `directory_hidden` | person excluded | unaffected (matches today's roster) | shown |
| Not publicly listed | n/a | not served | shown |
| Merged (tombstone) | excluded | see G10 | n/a |
| Membership ended | excluded | open-term rule | shown |

- `hide_photo` has no writer, so a member who objects today has only "ask staff", and staff removal is the only takedown. Copy must say so truthfully.
- Recommend a recorded `photo_use` consent is not required in Increment 1. Instead, designating a website photo requires an attestation checkbox ("I have this person's permission to show this photo on the public website"), and that attestation is audited. Linking it to the consents table waits for the consent UI.

**G5. Minors.**
- Children's photos would otherwise appear to every member on day one.
- Recommend a server-side refusal in Increment 1 to upload or designate for anyone under 18.
- Treat as a minor: a known DOB under 18, a birth-year-only value within 18 years, or a household role of child.
- A null DOB with no child markers is allowed. Staff headshots often have no DOB, and refusing them would block the harvest. This is an accepted, stated residual.
- Minors with `minor_photo` consent, and any public-site photo of a minor, wait for the consent workflow.

**G6. Who may upload of whom.**
- Staff only in Increment 1.
- There is no self-service surface, and parents have none either (G14).
- Server-side authorization is the permission check on the person within the acting org, never the client's person id.

**G7. Image pipeline.**
- Formats: PNG, JPEG, WEBP only, matching the blob CHECK. Reject SVG, animated GIF and HEIC with a plain message ("convert to JPEG").
- The server sniffs magic bytes (never the browser's MIME) and re-encodes, which strips EXIF and GPS and applies orientation first.
- Cap pixel count and dimensions before decoding, so a pixel bomb is refused.
- Never store or echo the original filename. It often contains a name.
- Size and platform limits.
  - Vercel caps request bodies at 4.5 MB, and the Next Server Action default is lower.
  - Downscaling in the browser before upload (to roughly 1200px on the long edge) solves both limits and metadata at once, but the server must still validate and re-encode because the client cannot be trusted.
  - Phase 3 must set the limit explicitly and write a 413-style human message.
- Derivatives. The directory inlines photos as base64 `data:` URIs.
  - A full-size photo on a 24-card page, or any multi-megabyte upload, would make pages tens of megabytes at 360px.
  - A small directory thumbnail is therefore a requirement, not polish. Whether it is inline or a streamed route is Phase 2's call.
  - Website photos should keep the editor's framing, with no square crop forced on a portrait.
  - Directory avatars crop from the top.
- This needs a server image library, and none is in `package.json`. That is the dependency decision for the architect. fpcw used `sharp`.

**G8. Storage growth and no erase path.**
- Bytes live in Postgres (DECISION-030 revisit trigger is "measurable share of database size").
- A per-person cap (suggest 10) and a per-photo byte ceiling bound growth.
- All deletes are soft. `blob_assets` has no delete path (F289 and careers DECISION-263 reaffirm that), so a mistakenly uploaded sensitive photo cannot be erased by any in-app action.
- Record this as an accepted residual with an operator-only runbook note. Serving stops on removal, but the bytes persist.
- Dedup (`organization, audience, hash`) means a byte-identical file shared by two people is one blob row with two references. Removing one reference never affects the other.

**G9. Removal must stop being served, and stale caches must not look like bugs.**
- Directory, public roster and the door all follow the designation, so removal is immediate server-side.
- Cached copies live up to a day (ruled).
- Use a version key on directory photo URLs and `no-store` on misses, from the fpcw lesson ("photo didn't stick").
- Say honestly in the removal dialog that copies already viewed can linger. The existing un-list dialog makes the same point.

**G10. Merged, ended and deceased people.**
- No merge writer exists in code, so this is a rule for the future merge pipeline.
- Photos follow the survivor, and a tombstone's designations are never served.
- 0072 chose not to special-case merges in the roster, so Phase 3 should assert the roster and the new designation agree.
- A person whose membership ended: directory excluded, public governed by the open-term rule, photos kept.

**G11. Household photos (Increment 3).**
- They are org-scoped, and a household is a different kind of subject from a person.
- Recommended rules:
  - They show only on household surfaces (card and detail header).
  - They never replace an individual's avatar, and a person with no photo never falls back to the household photo. Doing so would expose other faces, cropped, as one person's picture.
  - A family photo contains every member, so it is hidden if any current member has `hide_photo` or `directory_hidden`.
  - Any minor member blocks it until the consent workflow exists, and that is most real households.
  - They are never on the public site.
- "Which wins": neither does. They live on different surfaces.

**G12. Public-site integration (an external, ship-time step).**
- The first customer's leadership and committee pages are hand-authored. Moving them to the live roster is a content-repo change.
- It loses the email and phone lines on the leadership page, because the roster deliberately projects no contact fields. That is an operator decision (Q5).
- It needs the org's staff and committee directory flags (seeded off) turned on.
- It needs a 360px check of real portraits (5:7) in the kit's card boxes.
- It must happen at Phase 6, not be forgotten.

**G13. The harvest itself.**
- Increment 1 is manual per-person upload: about 18 headshots, no bulk tool.
- Expect near-duplicates and several variants of one person. The UI must show a person's photos side by side with their designation chips, so picking the right one is easy.
- The platform's own blob table already holds the website's images as `public_site` (82 images in production). A "pick from existing site images" shortcut would re-store bytes across the audience wall and is not Increment 1.
- A bulk upload with name matching (the fpcw pattern) is Increment 2, and only if more than a few dozen photos are really coming. Filenames are matched in memory and never stored.

**G14. Self-service is blocked by missing prerequisites.**
- No profile surface for the person record exists, no `hide_photo` writer exists, and F177 says to narrow the `active_membership` group before any member self-service sign-in.
- That is its own pipeline (member self-service profile and privacy page). It is also where `hide_photo` finally gets a writer.

**G15. Sequencing.**
- TODO Track J lists photo-uploads as post-cutover and "new product", and the website keeps its hand-authored headshots at cutover.
- Priority is the operator's call (Q5).

**G16. Stale copy.**
- F289's three public-listing dialogs say a photo "if one is on file and they haven't hidden it". Under designations that wording should change to "if a website photo has been chosen".
- Grep for it in Phase 3. It is a modify target for the copy-truthfulness check.
- Directory and Community empty-state strings about photos need the same pass.

**G17. Alt text, mobile, accessibility.**
- Alt text stays "<name>'s photo". Initials fallback is `aria-hidden` when a photo is present (existing).
- At 360px the photo section needs:
  - a camera-capable file input;
  - touch targets of at least 44px;
  - no horizontal scroll with several thumbnails.
- The form needs `HydrationGate` if it uses `useForm`.
- No `alert()` or `confirm()`.

## Adversarial pass

- **Redirect targets.** None introduced. The upload and designate actions return results, with no `next` parameter.
- **State-machine shortcuts.**
  - Designating a photo that belongs to another person or another org: the composite key must make that unrepresentable, not just checked.
  - Designating a removed photo, or designating a website photo for a minor, must be refused server-side.
  - Designating a website photo for a person who is not publicly listed is harmless (nothing is exposed until listed), and the UI says so.
- **Enumeration.** The F289 door already returns one neutral `no-store` 404 for every miss. If Phase 2 adds an authenticated directory photo route, it must give the same body, status and headers for non-member, hidden, ended and nonexistent, per DECISION-040. An inline `data:` URI avoids a new enumerable route.
- **Input boundaries.** Empty file, zero-byte, overlong or multi-part forgery, pixel bombs, polyglot files, animated images and HEIC are all validated server-side. The browser downscale is a convenience, never the control.
- **Self-targeting.** A staff member may attach a photo to their own record, which is fine. The rule that matters is the opposite one: a person cannot be made to appear publicly by someone who lacks the listing permission, because listing is a separate gate.
- **Cross-tenant.** An admin in org B must never alter the photo set seen in org A. This is why G1 matters, and the RLS script needs a test that the foreign org sees and changes nothing.
- **Dedup oracle.** The "file already exists" path must not tell a user that another person or org holds the same bytes. Within an org, dedup is invisible to the user.
- **2FA mid-enrolment.** The org routes sit behind the proxy's 2FA gate, so a user mid-enrolment is redirected to `/totp` before reaching this feature.
- **Failure microcopy.** DB or network down gives "We couldn't save that photo. Nothing was changed. Try again." and never a stack trace or raw database error.

## Out of Scope (confirm with user)

- Member self-service upload and a `hide_photo` or privacy page (its own pipeline).
- Parent or guardian upload, minors' photos, and `photo_use`/`minor_photo` consent recording.
- Household photos (Increment 3).
- Bulk or automatic name-matching harvest (Increment 2, only if volume warrants).
- Face detection or automatic crop beyond a top-biased avatar crop.
- Photos for admin list rows (Community lists).
- Erasing blob bytes, and the cloud-storage adapter.
- Changing the F289 directory-flags-don't-gate ruling.
- Org-level or event photo galleries.
- Contact lines on the public roster.

## Open Questions (for the operator, decision-shaped)

1. **Q1. Two purposes, no fallback.** A photo can be marked for the member directory and for the public website independently, and the website never falls back to the directory photo. A person with only a directory photo shows no photo on the website. Default: yes.
2. **Q2. Photos belong to each congregation, not to the person across congregations.** A person who serves two bodies has their photos set up in each. The alternative (one global photo) breaks as soon as a person is in two congregations (G1). Default: per congregation. **Needs an answer before Phase 2 rules on schema.**
3. **Q3. Who manages photos.** Reuse `people.manage` (simplest) or add a narrower `people.photos` permission so a communications volunteer can do headshots without address and phone access. Default: reuse `people.manage`.
4. **Q4. Minors.** In Increment 1, refuse any photo for a person under 18, with no exceptions, until a consent workflow exists. Confirm. Also confirm that a null date of birth with no child markers is allowed (staff headshots often have none), and that a website photo needs a staff attestation, audited, rather than a recorded `photo_use` consent. Default: yes to all three.
5. **Q5. Priority and the leadership page.** Track J called photo-uploads post-cutover. The website already shows its headshots by hand, so Increment 1 is a convenience, not a blocker, unless you want it before January 1. Separately, moving the leadership page to the live roster drops its email and phone lines. Keep that page hand-authored, or accept losing them?

## Proposed increment split

- **Increment 0 (prerequisite, not ours):** F289/0072 merged. Phase 4 starts after it.
- **Increment 1 (smallest worth shipping): staff-managed photos for adults.**
  - The org-scoped photo set.
  - Add and remove on the Community person page.
  - Directory designation, with a small thumbnail.
  - Website designation with attestation.
  - Roster functions and the F289 door read the new designation (migration 0078).
  - The `hide_photo` rule, adults only, audit, and a per-org toggle.
  - At ship, the content-repo swap for the leadership and committee pages (G12).
  - If the architect wants a smaller first slice, drop the directory designation. The model is unchanged and the directory read path stays as today (no thumbnail work, no weight risk).
- **Increment 2: bulk harvest.** Multi-file upload with name matching and a review queue (pending, applied, deleted), after the real volume is known. It could also add avatars to Community lists.
- **Increment 3: minors and households.** Guardian consent plus household photos, after the children's ministry consent workflow ships.
- **Separate pipeline: member self-service.** A profile and privacy page that supplies self-upload and the first `hide_photo` writer.

## Phase 2 notes for the architect

- Rule on the org-scoped photo table versus `people.photo_key` (Q2).
- Rule on the image-processing dependency. None exists today.
- Rule on the thumbnail strategy: derived at upload versus on read, and inline versus a route.
- Rule on the upload transport and body limit.
- Re-read F289's R3 and R4 and the 0072 draft before ruling. Extend the door's photo exclusion to the new table.
- The Rule 16 shared files are touched at integration only: `drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `docs/TODO.md`.
- Phase 6 should walk it as a `people.manage` holder in a fresh org at 360px, and as an anonymous visitor on a custom host at 360px.
- At SHIP IT, the what's-new advisory (Rule 13) applies, since this is member-visible.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; gaps G1–G17; operator questions Q1–Q5 (Q2 before Phase 2 schema, Q1/Q3/Q4 before Phase 3); hard dependency on F289 0072 merging before Phase 4 | READY WITH NOTES | 2026-10-26 |

**Handoff:** architect, Phase 2. Carry G1–G17 and the adversarial findings into the Phase 3 carry-forward table verbatim.

Files read (absolute):
- `/Users/cshenso/git/presby-platform/presby-photos/docs/work-log/2026-10-26-person-photos.md`
- `/Users/cshenso/git/presby-platform/presby-photos/docs/work-log/_template.md`
- `/Users/cshenso/git/presby-platform/presby-photos/docs/TODO.md`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/db/domain/people.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/db/domain/privacy.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/db/domain/assets.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/storage/blob-store.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/directory.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/app/(org)/o/[slug]/directory/person-avatar.tsx`
- `/Users/cshenso/git/presby-platform/presby-photos/src/app/(org)/o/[slug]/directory/households/[householdId]/page.tsx`
- `/Users/cshenso/git/presby-platform/presby-photos/src/app/(org)/o/[slug]/admin/community/[id]/edit/actions.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/app/(account)/account/profile-form.tsx`
- `/Users/cshenso/git/presby-platform/presby-photos/src/app/(public)/site/[slug]/staff-directory.tsx`
- `/Users/cshenso/git/presby-platform/presby-photos/src/app/(public)/site/[slug]/assets/[key]/route.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/drizzle/0009_presby_rls.sql`
- `/Users/cshenso/git/presby-platform/presby-photos/drizzle/0041_presby_public_staff_directory.sql`
- `/Users/cshenso/git/presby-platform/presby-assets/docs/work-log/2026-10-25-public-asset-allowlist.md`
- `/Users/cshenso/git/presby-platform/presby-assets/drizzle/0072_presby_blob_audience.sql`
- `/Users/cshenso/git/fpcw-directory/src/app/api/members/[id]/photo/route.ts`
- `/Users/cshenso/git/fpcw-directory/src/lib/members/photo.ts`
- `/Users/cshenso/git/fpcw-directory/src/lib/photo-uploads/matching.ts`
- `/Users/cshenso/git/fpcw-directory/docs/database-schema.md`
- The first customer's private content repo (`content/*.json` structure and image sizes only; no names recorded).

---

# Phase 2 — Architectural Review (architect), Person and household photos

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The feature shape is right, and Phase 1's Increment 1 holds. The rulings R1–R12 below are binding on Phase 3.

The operator's website-to-directory fallback is accepted, but I put one guard on it: **a directory photo reaches the open web only if its designation carries the website attestation** (R3). Without that guard, a later listing toggle by a different person under a different permission would publish an unattested snapshot. I've kept one decision-shaped confirmation for the operator (end of section). Phase 3 can proceed on the default.

Two departures from Phase 1, each with its reason:
- The per-org toggle **does** gate public serving (R8). Hiding only the management UI would leave website photos live with no in-app way to take them down.
- Minors are refused at **read** time as well as write time (R4). A refusal at upload goes stale as soon as someone corrects a date of birth.

I did **not** read the live database catalog, because this phase was told not to connect. Every catalog premise below comes from `drizzle/` text and the F289 Phase 2 catalog read of 2026-10-25. R12 lists what database-admin must confirm on the pipeline's Neon branch before 0078 is written.

## Placement

- **Directory placement**
  - `src/lib/db/domain/person-photos.ts` (new): Drizzle declarations for `person_photos` and `person_photo_designations`. The export from `src/lib/db/domain/index.ts` is a Rule 16 shared-file edit, done by the orchestrator at integration.
  - `src/lib/person-photos/` (new module, modelled on `src/lib/contact-methods/`):
    - `image.ts`: `import "server-only"`. **The only file that imports `sharp`**, pinned by a source-scan test like the giving Stripe one-importer rule. It sniffs, validates, auto-orients, strips metadata and makes the two derivatives. Pure bytes in, bytes out, no database.
    - `store.ts`: **the only writer** of both tables. Add, remove, designate and un-designate. Each mutation runs inside `withOrgContext`, checks the toggle and `people.manage` in the same transaction, and writes its audit row with `insertAuditRow` in that transaction. It makes the only `getBlobStore().store(` calls, and both use the literal `audience: "private"`.
    - `reader.ts`: the admin photo set, with each designation's state and the "effective on website" answer, which comes from the R3 SQL function.
    - `copy.ts`: every user-facing string, so the copy-truthfulness check has one place to read.
  - Pages: `src/app/(org)/o/[slug]/admin/community/[id]/edit/photos/`, a subroute like the existing `edit/guardians` and `edit/sensitive`, linked from the edit page under the same toggle-and-permission render gate. Files: `page.tsx`, `actions.ts`, the client islands, and the client downscale helper (feature-specific, so it lives here; Component Rule 3). **No `loading.tsx`**, because the page calls `notFound()` for an unknown person.
  - Suggestion: `resolvePhotoSrc` and `PersonAvatar` gain a third caller (the photos page), so move them from `directory/person-avatar.tsx` to `src/components/org-portal/person-avatar.tsx`. They are used only in `(org)`, so `org-portal/` is the right home, not `shared/`.
  - Migrations:
    - `drizzle/0078_presby_person_photos.sql`: tables, RLS, grants, triggers, the R3 function, the `people.photo_key` retirement CHECK, and the roster functions and door switched over. One file, applied with `psql -1`.
    - `drizzle/0079_…`: dropping the retired columns (R2). It ships in a release **after** Increment 1 is live, never in the same one.
  - RLS script: `scripts/person-photos/test-rls-78.sql`, run as `presby_app`, following the `scripts/domains/` and `scripts/giving/` layout. The orchestrator folds a pointer into `scripts/test-rls.sql` at integration (Rule 16).
  - `CLAUDE.md` → Project Layout gains a `src/lib/person-photos/` line at integration ("image.ts the only sharp importer; store.ts the only writer of person_photos/person_photo_designations").
- **Server vs Client split**
  - Server: the page, the photo grid (thumbnails inlined), the reader, store, image pipeline and actions.
  - `'use client'` only for:
    1. the upload island: a file input with camera capture, the canvas downscale, progress, and mapping any action rejection (including the framework's 413) to fixed copy. It is wrapped in `HydrationGate` whether or not it uses `useForm`, because an upload posted before hydration skips the downscale.
    2. the designate `Dialog`, which has the attestation checkbox. Use the existing native-checkbox idiom (`branding-form.tsx:311`, `fund-form.tsx:146`). **Do not add a checkbox primitive**: that would bring in an unvetted `@radix-ui/react-checkbox`.
    3. the remove and un-designate `AlertDialog`s.
- **Dependencies:** one. `sharp` moves from a transitive dependency to a direct one (R6). No UI package is added.

## Invariants Touched

- **Isolation Is a Database Property / Composite Tenant Keys.**
  - Both new tables are `FORCE ROW LEVEL SECURITY` with the standard `tenant_isolation` policy.
  - Every foreign key is composite, so a cross-person, cross-org or public blob reference cannot be represented at all (R1). That meets the adversarial pass's "unrepresentable, not just checked".
- **Two Hierarchies Intersect Nowhere / D1.**
  - Photos hang off `memberships (person_id, organization_id)`, the relationship, never off global `people`. A presbytery cannot see or change a congregation's photo set for a person they share. Neither can a platform admin, and the platform connection gets no grant.
- **Never Hard-Delete / all deletes are soft.**
  - `presby_app` gets no DELETE. Photos are removed by `removed_at` and designations end by `ended_at`. Both are one-way, and a trigger enforces that on every connection, including the owner (F44).
  - Bytes are never erased (blob_assets has no delete path; DECISION-263, F289). This is an accepted residual and needs a runbook note.
- **Permissions vs Flags.**
  - The checks run in the order toggle (`org_portal.person_photos`, no platform flag), then permission (`people.manage`).
  - Listing stays a separate gate under `staff.manage`, `officers.manage` and `groups.manage`.
  - The attestation is a recorded fact about a designation row, not a permission and not a credential.
- **The Brand Is a Cascade Override.** Untouched. The photos page sits in `(org)`, a brandable group. `check:brand-scope` and `check:proxy-imports` are unaffected, and `image.ts` must never enter the proxy's import graph (it is `server-only`).
- **DECISION-040 (enumeration).** No new serving route is added. Directory surfaces inline the thumbnail as a `data:` URI, and the public path stays F289's one door with its one neutral 404. Thumbnail keys never get a public serving branch (R5).
- **DECISION-030 (bytes in Postgres).** Photos are the first consumer with real volume. The revisit trigger ("measurable share of database size") is now live. Phase 3 must state the expected bytes per org (roughly 150–400 KB per photo, about 6–8 KB per thumbnail, at most 10 photos per person).
- **Paper vs database** (for `/developer`):
  - **database:** a photo blob is `private`; a website designation is attested; at most one active designation per purpose; the fallback needs an attestation; minors, `hide_photo` and toggle-off withhold the photo from the roster and the door.
  - **paper:** the write-time minor refusal (TypeScript), and "a null date of birth with no child markers is treated as an adult" (accepted, as the operator ruled).

## Notes

### R1. Schema: two org-scoped tables

**`person_photos`**
- Columns: `id`, `organization_id`, `person_id`, `image_asset_key uuid not null`, `thumb_asset_key uuid not null`, `asset_audience text not null default 'private'` with CHECK `= 'private'`, `width`, `height`, `created_at`, `created_by` (users), `removed_at`, `removed_by`.
- Keys and foreign keys:
  - `unique (id, organization_id)`.
  - `unique (id, organization_id, person_id)`, which is the designation FK target.
  - FK `(person_id, organization_id) → memberships (person_id, organization_id)` (`memberships_person_org_key`).
  - FK `(image_asset_key, organization_id, asset_audience) → blob_assets (id, organization_id, audience)`, and the same for `thumb_asset_key`. Both are NO ACTION, and both target F289's `blob_assets_id_org_audience_key`. This satisfies F289's FK catalog test as written.
- Indexes:
  - Partial unique `(organization_id, person_id, image_asset_key) where removed_at is null`. A byte-identical re-upload for the same person is refused with "already in their set". Within one org this reveals nothing about other people's photos (the dedup-oracle rule).
  - Indexes on `(organization_id, image_asset_key)` and `(organization_id, thumb_asset_key)` for the door's lookup.

**`person_photo_designations`**: end-dated history, not a current-state pointer.
- Columns: `id`, `organization_id`, `person_id`, `photo_id`, `purpose text check in ('directory','website')`, `public_attested_at`, `public_attested_by` (users), `designated_at`, `designated_by`, `ended_at`, `ended_by`.
- FK `(photo_id, organization_id, person_id) → person_photos (id, organization_id, person_id)`, so a designation cannot point at another person's or another org's photo.
- Partial unique `(organization_id, person_id, purpose) where ended_at is null`. That is the operator's "one active per purpose per person per org", enforced by the database.
- CHECK `purpose <> 'website' or public_attested_at is not null` (with `public_attested_by` paired the same way).
- Why a history table and not pointer columns:
  - Pointer columns on `memberships` would put photo writes on a core table that has triggers (F21).
  - A current-state table would need DELETE to un-designate, which breaks the soft-delete rule.
  - Who put which image on the web, and with what attestation, is worth keeping as data, not only in audit.
- Changing the attestation or the photo ends the old row and inserts a new one. Rows are immutable apart from the end and removal columns.

**Grants and triggers**
- `presby_app`: SELECT and INSERT; UPDATE only on `(removed_at, removed_by)` and `(ended_at, ended_by)` by column grant; no DELETE.
- `presby_platform`: nothing.
- A BEFORE UPDATE trigger on each table refuses any change except setting the end or removal pair from null, which is one-way. It is plain plpgsql with EXECUTE revoked from `public`, `presby_app` and `presby_platform` (0072 §9 style).

**Removal**
- `store.ts` ends a photo's active designations in the same transaction that sets `removed_at`.
- Every reader also filters `removed_at is null` and `ended_at is null`. A stale designation on a removed photo is therefore inert even if the lib order is ever wrong. That double filter is the control; the lib order is a convenience.

**Households (Increment 3)** get their own `household_photos` table when they come, because they are a different kind of subject. Do not add a polymorphic subject column now.

### R2. `people.photo_key` is retired, not converted

This **supersedes F289's R4 follow-up** (convert to uuid and add an FK). The orchestrator closes that TODO line at integration.

What reads it today:
- `src/lib/directory.ts:481` (directory, household and person rows)
- the two roster functions and `presby_public_site_asset` (0072)
- 0072's pre-flip assertion and `people_photo_key_lower_idx`
- comments in `sites.ts:1645`, `initials.ts:4`, `blob-store.ts:14` and `assets.ts:24`
- F289's tests (F331)

Nothing writes it, and 0 rows carry a value in every environment.

The plan:
- **0078** adds `people_photo_key_retired check (photo_key is null and photo_updated_at is null)`. "Written by no one" then holds on every connection. It is validated immediately, because no row has a value.
- 0078 also moves every reader off the column: directory SQL, the roster functions and the door.
- Remove `photoKey`/`photoUpdatedAt` from the Drizzle `people` declaration if `scripts/check-schema-parity.ts` tolerates a database column that Drizzle doesn't declare. Otherwise keep the declaration, marked RETIRED. Either way, no TypeScript reads it.
- **0079** drops both columns and `people_photo_key_lower_idx`, and updates `test-rls-72.sql` 72a. It ships only after the Increment 1 code is live. Old code selects `people` columns by name, so dropping the column during the deploy window would break the directory. 0079 must also come after 0072 is applied to production, because 0072's re-run safety reads the column.
- Each designated photo has its own content-addressed blob key, which is the cache-busting key fpcw needed (G9). No `photo_updated_at` equivalent is needed, and `data:` URIs have no cache at all.

### R3. The effective website photo: one SQL definition

- **Function:** `presby_person_public_photo(p_org uuid, p_person uuid) returns uuid`, `language sql stable`, SECURITY INVOKER, `set search_path = public, pg_temp`.
- **What it returns:** the image key of
  - the active, non-removed **website** designation; or, if there is none,
  - the active, non-removed **directory** designation, **only if `public_attested_at is not null`**;
  - and null if any of these holds: `person_privacy.hide_photo` is set (joined on `person_id` alone, as in 0072, so the stricter rule applies across orgs), the R4 minor predicate is true, or the R8 toggle is off.
- **Who calls it:**
  - Inside the two roster functions it runs with the definer's (owner's) rights.
  - The admin reader calls it as `presby_app` under RLS, so the photos page's "On the website: this photo / via the directory photo / none, because…" status uses the **same** definition the public site uses. That makes page-versus-public drift impossible in the same way F289's "the door calls the roster" did.
  - Granting it to `presby_app` reveals nothing beyond what RLS already shows, because under RLS it returns null for any org other than the current one.
- **Consequences the copy must carry** (G3, G4 and G16 with the fallback):
  1. Designating or replacing the directory photo can change the website photo. Its dialog says so whenever the person is listed and has no website designation.
  2. Un-designating a website photo can bring in the attested directory photo. The dialog names which photo will show.
  3. Removing a photo that is serving both purposes says "also their website photo".
  4. The directory-designate dialog offers the attestation as an unchecked checkbox ("They're OK with this photo appearing on the public website if they're listed and no website photo is chosen"). The website-designate dialog requires it.
  5. F289's three listing dialogs change to "their website photo, or their directory photo if it was cleared for the website, will appear". Phase 3 greps them.
  6. A listed person whose directory photo isn't cleared shows "Their directory photo isn't cleared for the website" on the photos page, with both remedies named.
- **Direction:** the fallback is one-way. The directory shows only a directory designation and never falls back to the website photo.

### R4. Minors: refuse at write, and fail closed at read

- **One predicate in SQL:** `presby_photo_subject_is_minor(p_org uuid, p_person uuid) returns boolean`, invoker, granted to `presby_app`. True when any of these holds:
  - `date_of_birth > current_date - interval '18 years'` with `birth_year_only` false;
  - `birth_year_only` with a birth year greater than `extract(year from current_date) - 19` (could be under 18, so treat as a minor);
  - the membership's `household_role = 'child'` in that org.
- A null date of birth with no child marker counts as an adult (operator ruling Q4, an accepted residual). This matches `children.ts:282`'s date arithmetic, so the two definitions agree on the DOB case.
- **Where it is used:**
  - `store.ts` calls it inside the transaction on add **and** on designate, because a date of birth can change between those steps.
  - R3 and the directory query use it on **read**: a person who turns out to be a minor shows no photo anywhere without anyone acting.
- Minors with consent wait for Increment 3.

### R5. Roster functions and the F289 door move in 0078

- **Roster functions.** `create or replace` both `presby_public_staff_roster(text,text,boolean)` and `presby_public_committee_roster(text,text,boolean)`:
  - Keep the **same signatures and return types**. `photo_key` stays `text` and is projected as `presby_person_public_photo(o.id, p.id)::text`. Changing the type would force drop-and-recreate on functions the door calls.
  - Carry over 0072's bodies verbatim (including the `person_privacy` join, which the helper now subsumes), apart from the photo column.
  - **Restate** `set search_path = public, pg_temp`, `revoke all … from public` and `grant execute … to presby_app`. `create or replace` resets `proconfig`.
  - `sites.ts` callers do not change. Only comments need updating, for copy truthfulness.
- **The door.** `create or replace presby_public_site_asset(uuid, uuid)` with the same signature:
  - `is_photo` becomes `exists (select 1 from person_photos ph where ph.organization_id = p_org and p_key in (ph.image_asset_key, ph.thumb_asset_key))`. That counts removed photos as well, so a removed photo never falls into the site branch.
  - The roster branch is unchanged: it is served only while a roster function returns the key.
  - A thumbnail key is a photo but is never returned by a roster function, so it always gets the neutral 404.
  - The `people.photo_key` branch is deleted.
  - With the R1 FK pin, photo blobs cannot be `public_site`, so the exclusion is now defence in depth rather than the only guard. Keep it anyway, because it routes a key to the right branch.
- **Ordering.** 0078 is written against 0072's **final** text. If F289 corrects 0072 in place before it ships, 0078's function bodies must be re-diffed. Phase 4 must not start before F289 merges (analyst's hard dependency, confirmed).
- **Cross-org accepted residual.** Blob dedup is per (org, audience, hash), so two people in one org with byte-identical photos share a blob. If one of them is listed, the shared key is served. The bytes are the same image, so nothing undisclosed leaks. State it.

### R6. Image dependency: `sharp`, already in the tree

- **Evaluation against the criteria:**
  1. Nothing in `package.json` decodes images.
  2. sharp 0.35.5 is already installed as `next@16.4.2`'s optional dependency (`^0.35.5`). The lockfile already carries the `@img/sharp-linux-x64` and libvips binaries, and Next externalizes it by default (it is in `server-external-packages.json`).
  3. It does not run on Edge. It runs only in the Node action runtime, and `image.ts` is `server-only`.
  4. It is server-only, so client bundle impact is zero. It adds roughly 8–10 MB of native libvips to the function, against Vercel's 250 MB limit.
  5. Licence: sharp is Apache-2.0; the prebuilt libvips is LGPL-3.0, dynamically linked and not redistributed by us, which is acceptable.
- **How to install:** `npm install sharp@0.35.5`, named explicitly (the npm `edgesOut` bug), into `dependencies`, at a version inside Next's range so the lock keeps **one** copy. deployment-engineer confirms the Vercel build log shows no second sharp.
- **Rejected alternatives:**
  - jimp: pure JS, slow and memory-heavy, with weak decompression-bomb guards.
  - Squoosh or jsquash wasm codecs: Squoosh is archived.
  - Client-side downscale only: the client is untrusted, so it cannot be the control for EXIF/GPS removal, pixel bombs or polyglots.
  - `/_next/image`: decodes on read, needs a URL-addressable source and caches publicly.
- **Pipeline:**
  - Authorize first (R7).
  - Sniff the magic bytes, reusing `src/lib/storage/sniff.ts`'s signatures, and require `sharp().metadata().format` to agree with the sniff.
  - Refuse: `pages > 1` (animated), more than 16 MP, or either side over 6000 px. Check these from metadata **before** decoding the pixels, with `limitInputPixels` set as a backstop and `failOn: 'error'`.
  - `.rotate()` to auto-orient. Never call `withMetadata`, so EXIF, GPS and ICC are dropped.
  - **Master:** at most 1200 px on the long edge (`fit: 'inside'`, no enlargement), no forced crop so a portrait keeps its framing. JPEG around q82, stepping down to stay under about 400 KB.
  - **Thumbnail:** 160 × 160, `fit: 'cover'`, `position: 'top'`, WebP. Target about 8 KB or less.
  - Unit tests: a JPEG carrying GPS comes out with no GPS; an EXIF-rotated input comes out upright; animated WebP, a PNG pixel bomb, a polyglot, HEIC, SVG and a zero-byte file are each refused with their own error kind.

### R7. Transport: a Server Action at the 1 MB default, with a mandatory client downscale

- **Confirmed from the framework source:** `next@16.4.2` `action-handler.js:513` has `defaultBodySizeLimit = '1 MB'`, and `next.config.ts` sets no `serverActions.bodySizeLimit`. So the analyst's belief holds (see F330 for what that means elsewhere).
- **The client** draws the chosen file onto a canvas:
  - It downscales to at most 1600 px on the long edge and encodes JPEG, stepping quality down until the result is ≤ 900 KB.
  - On iOS this also turns HEIC into JPEG for free. On a browser that cannot decode HEIC, show the fixed "convert to JPEG" message.
  - Any rejection of the action call, including the framework's 413, maps to fixed copy. A raw error is never shown.
- **The server** treats the downscale as a convenience: R6 re-validates and re-encodes everything.
- **Do not raise the global limit in this pipeline.** It would widen every action's pre-authentication body. A route handler is not needed either: Server Actions get Next's Origin check for free, and the repo's upload convention is actions.
- **Authorize before decoding.** Run auth, `resolveOrgContext`, the toggle, `people.manage`, "is the target a member of this org", "adult" and "under the cap" in a short transaction **before** `image.ts` runs, so an unauthorized caller cannot spend sharp's CPU. Then:
  1. `image.ts`;
  2. two `store({ audience: "private" })` calls, each in its own transaction;
  3. a final transaction that takes an advisory lock on (org, person), repeats the checks, inserts the photo row, auto-designates it for the directory if that slot is empty (never for the website), and writes the audit rows.
- **Accepted residual:** if step 3 fails, steps 2's private blobs are left unreferenced and unservable, the same as on the logo path.
- **Must-test:** on a real iPhone at 360 px, a 48 MP HEIC from the camera and a 12 MP JPEG from the library. iOS Safari limits canvas area, so the downscale must draw to the small target canvas, not decode to a full-size one.

### R8. Per-org toggle: `org_portal.person_photos`, gating every surface

- **Catalog entry:** `category: "people"`, `flag: null`, `provisionedOn: false`, `orgTypes: null`, `operatorEnabled: false` (self-service through `org_features.manage`).
- **Off means:** the photos page and its link are hidden; actions answer `feature_off`; directory surfaces show initials; and R3 returns null, so the roster shows no photos and the door returns 404. Data is kept, and turning the toggle back on restores everything.
- **The anonymous read composes the toggle in SQL** inside R3, with the category-axis flag, exactly as `presby_public_events_calendar` does (0067). A `*.db.test.ts` compares the SQL with `orgFeatureEnabledInTx` across the axis × category × toggle matrix and pins the literals to the catalog entry (the `public-calendar.test.ts` pattern).
- **Why I depart from Phase 1:** with the management UI hidden, nobody could remove a public photo. An "off" that keeps faces on the open web is not off.

### R9. Directory reads

- `queryDirectoryRows` swaps `p.photo_key` for the active, non-removed **directory** designation's `thumb_asset_key`. It keeps `hide_photo` winning, adds the R4 minor predicate, and is gated on the toggle.
- The grid, the household page and the person detail page all inline the **thumbnail**.
- Suggestion (F332): today every card's photo is resolved in its own transaction (`directory-grid.tsx:73`, 25 per page). That has never run, because no photo exists yet. Add `BlobStore.resolveMany({ organizationId, keys, audience: "private" })` as one query, and add it to F289's `audience-callsites` method list. The ingest pipeline is also editing `blob-store.ts` (`findByContentHashes`), so these merge one after the other.
- Phase 3 measures HTML plus flight size for 25 thumbnails at 360 px and records a revisit trigger, following the public-calendar precedent.

### R10. Audit

- **New `AUDIT_ACTIONS` keys:** `tenant.person_photo.added`, `.removed`, `.designated` (metadata: purpose, `attested`, the photo it replaced) and `.undesignated`.
- **Metadata always carries** organizationId, personId and photoId, and **never** bytes, hash, filename or dimensions.
- Rows are written in-transaction by `store.ts` via `insertAuditRow`. That is the DECISION-241 pattern, not `recordAudit`.
- `check:audit` scans only `actions.ts`, and these actions contain no `db.*` call, so it passes without checking anything. A DB-backed test per mutation must therefore assert the row and its metadata keys (2026-08-27 precedent). A source-scan test pins that `person_photos` and `person_photo_designations` are imported only by `store.ts` and `reader.ts` (plus `directory.ts`'s raw SQL by name).

### R11. RLS and test plan: `scripts/person-photos/test-rls-78.sql` (run as `presby_app`)

1. **Isolation:** org B sees zero rows of org A's photos or designations, and its INSERT with org A's id is refused by WITH CHECK.
2. **Unrepresentable states**, each refused:
   - a designation pointing at another person's photo (FK);
   - a photo pointing at org B's blob (FK);
   - a photo pointing at a `public_site` blob (FK plus the `asset_audience` CHECK);
   - a second active designation for the same purpose (unique);
   - a website designation without an attestation (CHECK).
3. **Soft-delete enforcement:**
   - DELETE is refused on both tables;
   - UPDATE of an immutable column is refused for `presby_app` (column grant) and for the owner (trigger);
   - clearing `removed_at` or `ended_at` is refused;
   - writing a non-null `people.photo_key` is refused on the owner connection (CHECK).
4. **The R3/R5 matrix** through `presby_public_staff_roster`, `presby_public_committee_roster` and the door:
   - **served:** a listed adult's website designation; a listed adult's attested directory designation when there is no website designation;
   - **null or 404:** an unattested directory photo only; `hide_photo` set; a minor by DOB, by birth year only, or by `household_role = 'child'`; a removed photo; an ended designation; the toggle off; an unlisted person; a thumbnail key; a foreign org's key;
   - org A's designation never appears in org B's roster for a person both share.
5. **Function privileges:** `presby_app` cannot execute the trigger functions, and `presby_platform` has no grant on the new tables.
6. **F289's FK catalog test** passes unchanged with the two new FKs.

Beyond the RLS script:
- **Unit tests:** R6's image tests; the one-importer scan for `sharp`; the two new `store:private` rows in F289's `audience-callsites` table for `src/lib/person-photos/store.ts`.
- **DB tests:** R10's audit tests; R8's toggle-matrix test; the R4 predicate checked against `children.ts` on DOB cases.
- **e2e on port 3620** (its own server, `E2E_BASE_URL` set):
  - as a `people.manage` holder in a fresh org at 360 px: upload, designate, remove;
  - as an anonymous visitor on a custom host at 360 px: the roster photo appears, then 404s after removal;
  - the hydration lane holds the upload island's chunks.

### R12. Live catalog: database-admin confirms before writing 0078

On the pipeline's Neon branch, **after** 0072 is applied:
- `memberships_person_org_key` exists, as a unique constraint (not only an index).
- `blob_assets_id_org_audience_key` exists.
- `presby_app` holds no UPDATE or DELETE on `people` beyond what 0009 states. This checks for grant drift (F38).
- The two roster functions' `proconfig` and ACL match 0072.
- The owner role reads `FORCE RLS` tables inside definers, as the existing roster functions already assume.
- 0 rows have `people.photo_key` set, so the CHECK validates.

Record the queries and their results in Phase 4.

### Increment slicing (confirmed, with two adjustments)

- **Increment 1:** R1–R11.
  - Do **not** drop the directory designation to make it smaller. Under the operator's fallback, the directory designation is the main way a photo reaches the website, so it is load-bearing.
  - Suggested Phase 4 batches:
    1. database-admin: 0078, the RLS script, schema tests, and the F331 rewrites of F289's tests.
    2. api-developer: `image.ts`, store, reader, actions, the `directory.ts` swap, `resolveMany`.
    3. ux-developer: the photos page, the islands, the dialogs, the G16 copy pass across the three listing dialogs and the directory empty states.
  - At ship: the G12 content-repo step stays an operator decision (Q5).
- **0079:** retire the columns, in the release after Increment 1.
- **Increment 2:** bulk harvest, if the volume justifies it.
- **Increment 3:** minors with consent, plus `household_photos`.
- **Separate pipeline:** self-service, which provides the first `hide_photo` writer.

### Findings (pre-assigned F330–F339)

- **F330, pre-existing, out of scope.** Server Actions accept 1 MB by default, and nothing configures a higher limit. Yet the logo forms say "up to 2 MB" (`tenant-branding.ts:97`, `(admin)/admin/organizations/[id]/actions.ts:89`) and the ticket forms say "up to 10MB" (`file-ticket-form.tsx:29,253` and both reply forms), which is also above Vercel's 4.5 MB. Files between 1 MB and the stated cap probably fail with the framework's 413 rather than the friendly copy. I confirmed this from the framework source but did not reproduce it at runtime. Recommend a separate bug-fix pipeline and a `docs/TODO.md` line at integration.
- **F331.** F289's tests seed `people.photo_key` (`src/lib/db/domain/public-roster-photo.db.test.ts:63`, the sections of `scripts/assets/test-rls-72.sql` that seed photos, and any D1 test that does the same). 0078's CHECK refuses that write. This pipeline rewrites them to seed `person_photos` plus designations. Their assertions must keep passing against 0078.
- **F332.** The directory resolves photos with one transaction per card. That is latent until the first photo exists. See R9.

### Proposed decisions (for the orchestrator to record, newest first)

- **DECISION-285: Person photos are an org-scoped set keyed to the membership, with end-dated designations; `people.photo_key` is retired.**
  - Covers the two tables of R1: composite FKs to `memberships`, and `asset_audience = 'private'` pinned into `blob_assets_id_org_audience_key`.
  - At most one active designation per purpose per person per org (partial unique). A website designation requires an attestation (CHECK).
  - No DELETE. Removal and ending are one-way, enforced by trigger on every connection.
  - `people.photo_key`/`photo_updated_at` are held null by CHECK in 0078 and dropped in 0079 after the release. This supersedes F289 R4's "convert to uuid and add an FK" follow-up.
  - Households get their own table later.
  - **Revisit if** a photo needs to be shared across orgs, or bytes need erasing.
- **DECISION-286: One SQL definition of a person's public photo.**
  - `presby_person_public_photo(org, person)` returns the website designation, otherwise an **attested** directory designation. It returns null for `hide_photo`, for a minor (`presby_photo_subject_is_minor`, read-time and fail-closed), or when the toggle is off.
  - Both roster functions project it with unchanged signatures. `search_path`, revoke and grant are restated.
  - The door treats any `person_photos` key (image or thumbnail, removed or not) as a photo, served only while a roster lists it.
  - The admin UI reads the same function. The directory never falls back to the website photo.
  - `org_portal.person_photos` (toggle-only, people category, provisioned off) gates the management UI, the directory and the public path. Its SQL composition is pinned against `orgFeatureEnabledInTx`.
- **DECISION-287: `sharp` becomes a direct dependency at Next's resolved version (0.35.5), imported only by `src/lib/person-photos/image.ts`.**
  - Derivatives are made at upload, never on read: a master of at most 1200 px with no forced crop, and a 160 px top-biased WebP thumbnail.
  - Sniff plus format agreement, pre-decode pixel and dimension caps, no animation, all metadata stripped.
  - Directory surfaces inline the thumbnail as a `data:` URI. No new route.
- **DECISION-288: Photo upload is a Server Action at the 1 MB default.**
  - A mandatory client downscale keeps the body at or under about 900 KB. The server never trusts it.
  - No global `bodySizeLimit` raise.
  - Authorization, toggle, membership, adult and cap checks all run before any decode.
  - Audit is written in-transaction by `store.ts`, and DB tests stand in for the `check:audit` blind spot.
- DECISION-289 is unused and stays reserved for Phase 3.

### Operator question (decision-shaped; Phase 3 proceeds on the default)

**Q6. Fallback consent.** When a person has no website photo, the website uses their directory photo **only if whoever chose that directory photo also ticked "OK for the public website"**. Default: yes, as R3.

The alternative is an unconditional fallback. A person's everyday directory snapshot would then appear on the open web as soon as anyone with a listing permission lists them, with no one ever confirming that photo is OK to publish.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete; rulings R1–R12; DECISION-285–288 proposed (289 reserved); F330–F332 raised; operator Q6 (fallback consent; default attested-only); live catalog not read (no-DB instruction), so R12 checks are assigned to database-admin; `sharp` approved as a direct dependency | Approved with suggestions | 2026-10-26 |

**Handoff:** tech-lead, Phase 3.
- Carry G1–G17, the adversarial findings and R1–R12 into the Carry-forward table one by one, including the two departures from Phase 1: the toggle gates public serving (R8), and minors are refused at read time (R4).
- Write the Copy table against R3's six consequences and the G16 grep.
- Name the batches.
- Draft the Rule 16 integration patches: `src/lib/db/domain/index.ts`, `drizzle/meta/_journal.json`, the `scripts/test-rls.sql` pointer, and the `docs/TODO.md` lines for F330, the 0079 retirement, closing F289 R4's follow-up, and the DECISION-030 revisit watch.
- Phase 4 may not start until F289 has merged and 0072 is on the pipeline's Neon branch.

Files read (absolute):
- `/Users/cshenso/git/presby-platform/presby-photos/docs/work-log/2026-10-26-person-photos.md`
- `/Users/cshenso/git/presby-platform/presby-photos/docs/work-log/_template.md`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/db/domain/people.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/db/domain/privacy.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/db/domain/assets.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/db/domain/org-features.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/org-features.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/directory.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/children.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/audit.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/storage/blob-store.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/lib/storage/sniff.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/app/(org)/o/[slug]/directory/person-avatar.tsx`
- `/Users/cshenso/git/presby-platform/presby-photos/src/app/(org)/o/[slug]/directory/directory-grid.tsx`
- `/Users/cshenso/git/presby-platform/presby-photos/src/app/(org)/o/[slug]/admin/community/[id]/edit/actions.ts`
- `/Users/cshenso/git/presby-platform/presby-photos/src/app/(org)/o/[slug]/tickets/file-ticket-form.tsx`
- `/Users/cshenso/git/presby-platform/presby-photos/scripts/check-audit-coverage.mjs`
- `/Users/cshenso/git/presby-platform/presby-photos/scripts/ui-add.mjs`
- `/Users/cshenso/git/presby-platform/presby-photos/drizzle/0067_presby_public_events_calendar.sql`
- `/Users/cshenso/git/presby-platform/presby-photos/docs/decisions.md` (head)
- `/Users/cshenso/git/presby-platform/presby-assets/docs/work-log/2026-10-25-public-asset-allowlist.md` (Phases 2–3)
- `/Users/cshenso/git/presby-platform/presby-assets/drizzle/0072_presby_blob_audience.sql`
- `/Users/cshenso/git/presby-platform/presby-assets/src/lib/db/domain/public-roster-photo.db.test.ts`
- `/Users/cshenso/git/presby-platform/presby-assets/scripts/assets/test-rls-72.sql`
- `/Users/cshenso/git/presby-platform/presby-ingest/docs/work-log/2026-10-26-site-ingest-size.md`
- `/Users/cshenso/git/presby-platform/presby/node_modules/next/dist/server/app-render/action-handler.js` (the 1 MB default)
- `/Users/cshenso/git/presby-platform/presby/package-lock.json` (sharp 0.35.5 and its linux binaries)

I edited no files, made no database connection and did not use `git stash`.

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

## Operator rulings on Phase 1 questions (2026-10-26)

- **Q1 — Two purposes:** directory photo and website photo are designated separately, **but the website falls back to the directory photo** when no website photo is chosen (operator chose against the analyst's no-fallback default). Phase 2/3 must carry the consequences: a directory snapshot reaches the open web for any publicly listed person who has a directory photo and no website photo; the attestation and the listing gate must account for that (G3/G4).
- **Q2 — Scope:** per congregation (an org-scoped photo set; `people.photo_key` retired, written by no one).
- **Q3 — Who manages:** reuse `people.manage`.
- **Q4 — Minors:** adults only in Increment 1 (refuse under 18; null DOB with no child markers allowed; website use needs an audited staff attestation, not a recorded `photo_use` consent).
- **Q5 (priority, leadership page contact lines):** not yet asked; default: post-cutover priority, leadership page stays hand-authored.
