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
| 2 — Architectural review | architect | Pending | — | — |
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

## Operator rulings on Phase 1 questions (2026-10-26)

- **Q1 — Two purposes:** directory photo and website photo are designated separately, **but the website falls back to the directory photo** when no website photo is chosen (operator chose against the analyst's no-fallback default). Phase 2/3 must carry the consequences: a directory snapshot reaches the open web for any publicly listed person who has a directory photo and no website photo; the attestation and the listing gate must account for that (G3/G4).
- **Q2 — Scope:** per congregation (an org-scoped photo set; `people.photo_key` retired, written by no one).
- **Q3 — Who manages:** reuse `people.manage`.
- **Q4 — Minors:** adults only in Increment 1 (refuse under 18; null DOB with no child markers allowed; website use needs an audited staff attestation, not a recorded `photo_use` consent).
- **Q5 (priority, leadership page contact lines):** not yet asked; default: post-cutover priority, leadership page stays hand-authored.
