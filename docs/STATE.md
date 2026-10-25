# Where the project stands

**Read this first.** Then `docs/schema-design.md` for rationale and the
findings log, and the newest file in `docs/work-log/`.

Updated 2026-10-25 (v0.42.3, session handling hardening, is live as of its 2026-10-25 deploy; v0.42.4, the provider-email check, is integrated on its branch; retro workflow-efficiency is merged to `main` with no version bump).

---

## RESUME HERE — 2026-10-25: v0.42.4 (sign-in provider email check, F231) is integrated; v0.42.3 is live; five other pipelines are open

`pipeline/google-email-verified` (worktree `presby-gauth`, no migration) is merged up to `main` (`77be511`: 0.42.3 plus PR #52 workflow-efficiency)
and integrated as **v0.42.4**, F231 **closed in code and tests**. `evaluateSignIn()` now refuses every non-credentials sign-in unless the provider
asserted `email_verified === true`, before any user lookup, so an unverified claim can neither link to an existing account nor create one (and the
`INITIAL_ADMIN_EMAILS` bootstrap is unreachable through it). DECISION-246 amends DECISION-015 point 2 and fulfils the `evaluateSignIn()` clause of
DECISION-187. QA PASS, Phase 6 SHIP WITH NOTES. **The limit:** no real Google exchange has happened anywhere (Google is configured in no environment,
production `accounts` has 0 rows); the claim's arrival rests on `src/auth.sign-in.test.ts` and a tripwire on the installed `@auth/core`. The
`Invitations Increment 3: Google` TODO line now carries the first-exchange check. **Community Increment 2b's Phase 4 is unblocked on this fix**
(it was blocked on 0.42.3 and F231). Next: `/pre-push`, then `/merge-pr`, then deploy.

`pipeline/session-update-hardening` (worktree `presby-sess`, Neon `pipeline-session-update`, no migration) is merged up to `main` (`ce661d7`,
the 2026-10-24 retrospective's agent edits) and integrated as **v0.42.3**, a security patch with neutral wording. The server now accepts that
the second sign-in factor is complete only from its own verification screens (TOTP and recovery code); other requests to change a session's
state are refused, and the session-update path reads nothing from the request. DECISION-230, F237 (`docs/schema-design-2.md` §2y), one
CLAUDE.md sentence under *The Proxy Does Not Reach the Database* (operator-approved). QA PASS, Phase 6 SHIP WITH NOTES; the notes are
`docs/TODO.md` lines. **Operator ruling 2026-10-25: existing sessions are not rotated** (two active production accounts, both the operator's).
The release note, commit titles and PR stay neutral until deploy.

**Deployed 2026-10-25.** Still owed: the production sign-in smoke (an MFA-enrolled account signs in, enters a code and reaches its destination;
the grant relies on async context reaching the jwt callback, proven on `next start`, not yet on Vercel) and the sibling hand-off
(`/downstream-sync` and a neutral heads-up to repos seeded from the same starter). Both are TODO lines. The held test-coverage review
(`docs/reviews/2026-10-24-test-coverage.md`, finding C-1) is now committed and logged.

**Retro workflow-efficiency** (`pipeline/retro-workflow-efficiency`, worktree `presby-wf`) is merged up to `main` at 0.42.3 and integrated:
DECISION-231, F239 (`docs/schema-design-2.md` §2z), TODO lines for its residuals and follow-ups, and the briefings backlog (13 entries, marker
`decision=224`). QA run 2 PASS, Phase 6 SHIP WITH NOTES. Tooling and docs only, so no version bump and no release note. Next: `/pre-push`, then
`/merge-pr`. Heads-up: the new push gate refuses one command that commits and pushes, so commit and push stay two separate calls.

**Open pipelines (each has its own worktree and Neon branch; numbers are pre-assigned in the work-log headers):**

| Pipeline | Worktree | Phase | Numbers | Next |
|---|---|---|---|---|
| Community Increment 2b, sign-in invitations (`pipeline/signin-invites`, `docs/work-log/2026-10-22-founding-admin-directory.md` in `../presby-2b`) | `presby-2b` | Phase 3 amendment 2 done | migration 0065; DECISION-207/208, 225-228; F186/187, F192-F199, F230-F233 | Phase 4 is unblocked once 0.42.4 merges (0.42.3 is live; F231 is fixed on `pipeline/google-email-verified`) |
| F231, refuse an unverified Google email claim (`2026-10-25-google-email-verified`) | `presby-gauth` | Integrated on its branch as **0.42.4** (Phase 6 SHIP WITH NOTES) | DECISION-246; F231; no migration; port 3520 | `/pre-push`, `/merge-pr`, deploy, then remove the worktree |
| Retro workflow-efficiency (`2026-10-25-retro-workflow-efficiency`, promoted to a full Feature by QA run 1) | `presby-wf` | Integrated on its branch (Phase 6 SHIP WITH NOTES) | DECISION-231; F239; no migration; port 3480 | `/pre-push`, `/merge-pr`, then remove the worktree |
| Community Increment 3a, visitor follow-ups, and 3b (`2026-10-22-founding-admin-directory-inc3`) | `presby-inc3` | Phase 3 (3a) running | migration 0066; DECISION-232-237, 247-250; F240-F249, F266-F273; port 3490 | Phase 3, then Phase 4 |
| Public events calendar, events Increment 4 (`2026-10-25-public-events-calendar`) | `presby-cal` | Phase 3 done | migration 0067; DECISION-238-241; F250-F257; port 3500 | Phase 4 queued |
| Parish (deacon-district) management (`2026-10-25-parish-management`) | `presby-parish` | Phase 3 done | migration 0068; DECISION-242-245; F258-F265; port 3510 | Phase 4 queued |

**Next free numbers:** DECISION-**251**, F**274**, migration **0070**. F234-F236 and F238 were returned unused. Integration of these branches is
serialized one PR at a time through `/merge-pr` (Workflow Rule 16); `docs/schema-design-2.md` §2y (0.42.3) and §2z (retro workflow-efficiency) are
taken, so the next findings subsection is `2aa`.

**Not forgotten:** the F166 bug-fix pipeline, the operator questions in `docs/TODO.md`, and the overdue periodic reviews.

---

## Previous handoff — 2026-10-24 (later): v0.41.0, v0.42.0 and v0.42.1 are live; zod 4 is integrated at v0.42.2

**Live in production:** v0.41.0 (Community Increment 2), v0.42.0 (several email addresses per person) and v0.42.1 (the invitation screens say
who has to accept; PR #48).

`pipeline/zod-4` (worktree `presby-zod`, Neon `pipeline-zod-4`, no migration) is merged up to `main` at v0.42.1 and integrated as **v0.42.2**,
a security patch: zod 3 to 4.6.7 closes high advisory GHSA-mrhx-c7xc-m3w5 and the `scripts/ci/audit-prod.mjs` exception is gone
(`ACCEPTED = []`, expiry mechanism kept). Ids go through `z.guid()` (shipped role ids and fixtures are not RFC 9562, F225); the `zod/v3`
subpath is rejected (F226); 16 golden files pin every message a user can see; a guard test bans `.uuid()` and the subpaths. No
user-visible change except on hand-built requests. DECISION-223/224, F225-F229 (`docs/schema-design-2.md` §2x). QA PASS, Phase 6 SHIP WITH
NOTES; the three notes are `docs/TODO.md` lines. **No production action**; after merge confirm CI's `audit-prod` job is green on `main`.

**Next:** merge this PR through `/merge-pr` and check `npm ls zod` shows one copy; then the open items below (Community Increment 2b on migration `0065`, the F166 bug-fix pipeline, overdue reviews).

---

## Previous handoff — 2026-10-24 (earlier): v0.41.0 is live; person emails is integrated at v0.42.0

**v0.41.0 (Community Increment 2) is live in production as of 2026-10-24 UTC.** `0062` was applied, then the code deployed, then `0063`, with a
Neon snapshot taken first. The full `scripts/test-rls.sql` on `development` ran 1193 passes with three pre-existing data-drift failures.
Increment 2b (sign-in invitations) has not started; it now takes migration **0065**, not 0064.

`pipeline/person-emails` (worktree `presby-emails`, Neon `pipeline-person-emails`) is merged up to `main` at v0.41.0 and integrated as
**v0.42.0**: a person can hold up to 10 labelled email addresses with one Main and a per-address "Don't send mail to this address" flag;
removal is soft (`created_at`, `ended_at`, `DELETE` revoked, immutable value, one active Main as a database property; the `contact_methods`
arm of F176 closed); removing the Main promotes the oldest remaining address, audited; the four 0059 reader sites ignore ended addresses
(F211); the member directory shows the Main plus an open staff member's Work address and search matches only what a card shows (F212);
`src/lib/contact-methods/` is the single writer, the `presby_person_email` credential reader and a closed registry of every send template
key; the platform invitation screen warns when the address is on a signed-in person. Migration `0064`, DECISION-215–219, F210–F217
(`docs/schema-design-2.md` §2w). QA PASS (run 2), Phase 6 SHIP WITH NOTES; every note is a `docs/TODO.md` line. Two CLAUDE.md edits are
for operator review in the diff (a Project Layout line for `src/lib/contact-methods/` and one sentence under Permissions vs Flags: a contact
email authenticates nothing).

**What is and is not true of it.** Giving statement notices stay on the donor record (operator, 2026-10-23: "keep giving on the donor record
for now"); the personal-address fallback is a TODO. A staff member who is only a staff anchor shows no Work address to members (told to the
operator, no change asked). The wizard's duplicate match uses the search-step address only (F215 and `person_identifiers` stay open).

**Deploy order: apply `0064` BEFORE the code** (snapshot first; runbook in `docs/deployment.md` -> "Person emails"). Owed before release: the
ER2a check on `development` (diff `pg_get_functiondef` of `presby_preview_invitation` and `presby_accept_invitation` against the branch
before `0064` runs there), then `0064`, the person-emails seed and `scripts/test-rls.sql` as `presby_app` on merged `development` (section 64
is new), and the Phase 6 what's-new advisory (member-visible: the directory can show a staff Work address, search matches only what a card
shows).

**Next:** merge this PR through `/merge-pr`, apply `0064`, then the owed invite-copy polish (TODO), Community Increment 2b (migration 0065,
which reads addresses through `presby_person_email`), then 3; then the list in the handoffs below.

---

## Previous handoff — 2026-10-23 (night): Community Increment 2 is integrated at v0.41.0 (now live)

`pipeline/session-approval` (worktree `presby-fadir`, Neon `pipeline-session-approval`) is merged up to `main` (v0.40.0, workflow
efficiency) and integrated as **v0.41.0**, **Community Increment 2**: a congregation's Session can approve, deny and bulk-approve
proposed members from Pending approvals, a clerk can see the queue and withdraw a mistake, and every "can't act yet" state is told
in six states (`terms_not_started` added after QA run 1). Approve, deny and withdraw go through two `SECURITY DEFINER` functions;
`presby_app` lost UPDATE and DELETE on `roll_actions` (P5 closed, the `roll_actions` part of F176 closed; the owner path is
trigger-only). The baseline `session_member` role carries `roll.approve` only; installed pastors, co-pastors and associate pastors
count as Session members (DECISION-206, operator confirmed). Migrations `0062` and `0063`, DECISION-202–206, F179–F185 and
F188–F191 (`docs/schema-design-2.md` §2v). QA PASS (run 3), Phase 6 SHIP WITH NOTES; every note is a `docs/TODO.md` line. One
CLAUDE.md sentence (Two Hierarchies) records the self-recorded, self-approved Session member as `paper`: read it in the diff.

**What is and is not true of it.** An elder recorded on the Session still needs a PresbyPortal account to approve; Increment 2b
(sign-in invitations, migration `0065`) delivers that, and until then the queue banner says so. F182 stays an open `paper`
residual; F177 and F176 (other tables) stay open. The what's-new entry is held until 2b ships.

**Deploy order: apply `0062`, deploy the code, then apply `0063`** (snapshot first; pre-flight counts and the duplicate-pending
case are in `docs/deployment.md` → "Session approval (Community Increment 2)"). Not done here, owed before release: the manual
bootstrap walk on `development` at 360px (ship condition 10), re-running `scripts/test-rls.sql` as `presby_app` on merged
`development` with both migrations applied (expect the four pre-existing failures; section 62 = 53, section 61 = 34), and the
pipeline-branch cleanup (role passwords, two global flags, 25 expired fixture rows).

**Next:** merge this PR through `/merge-pr`, apply the migrations in the order above, then Community Increment 2b, then 3; then the
list in the handoffs below (F166 bug-fix pipeline, fpcw parity tracks, overdue reviews).

---

## Previous handoff — 2026-10-23 (late): the portal site-map footer is integrated at v0.40.0 (merged to main, PR #44)

`pipeline/portal-sitemap-footer` (worktree `presby-nav`, no schema change, no migration) is merged up to `main` at v0.39.2 and
integrated as **v0.40.0**. The portal nav and the footer now render one pure structure (`buildPortalMenu()` in
`src/lib/org-portal/portal-menu.ts`, loaded by `getPortalMenu()`); the footer is a wrapping site-map grid with plain-text column
headings; "People & Membership" is "Community" everywhere (the `people` key is unchanged); and Administration appears in both
places only when `org_portal.admin_hub` is on **and** at least one administer tile is visible, as a heading plus one
"Administration overview" link in the footer. DECISION-220–222. QA PASS, Phase 6 SHIP WITH NOTES; every note is a `docs/TODO.md`
line (a "can administer" signal, the Members tile versus its toggle, the category axis, and two test-robustness items). The
what's-new entry is drafted in the work-log for publishing at `/admin/whats-new`. The footer itself still sits behind
`org_portal.chrome_v3`; the rename and the Administration rule show wherever the nav, home page and Features page already render. The Community block below predates the
v0.39.x merges: Increment 1 and the two patch releases are on `main`; its "PR pending" and next-step list otherwise still stand.

**Next:** merge this PR through `/merge-pr`, then resume the list below (Community Increment 2, the F166 bug-fix pipeline, the
fpcw parity tracks).

---

## Previous handoff — 2026-10-23: Community Increment 1 integrated at v0.39.0; Increments 2, 2b and 3 designed

**2026-10-23.** v0.38.0 (designation-holder revoke, PR #38, migration `0060`, accepted residual F170) is merged; `0060` keeps the count signatures, so it can be applied to production before or after its code. `pipeline/founding-admin-directory`
(worktree `presby-fadir`, Neon `pipeline-founding-admin-directory`) is integrated for its PR as **v0.39.0**, **Community
Increment 1**: the admin Members section is now **Community** at `/o/<slug>/admin/community` (the old URL redirects, platform
hosts only); a founding administrator or clerk can open it (the page degrades instead of showing "forbidden", F172), add a
visitor with `people.manage` alone, enrol and remove participants **on record with no approval** (undo covers participant
entries only), and propose member entries; `createPerson()` writes `resulting_roll` (F173 closed); migration `0061`,
DECISION-197–201, F172–F178 (`docs/schema-design-2.md` §2u; `docs/work-log/2026-10-22-founding-admin-directory.md`). QA PASS (run 2),
Phase 6 SHIP WITH NOTES, every note a `docs/TODO.md` line. **Deploy order: code first, then apply `0061`** (the new CHECK refuses
what the old `createPerson()` writes). The clerk template now carries `roll.propose` and `directory.view`; the F111/F118 ceiling is
half closed.

**What is and is not true of it.** Member entries can be proposed, but **no role carries `roll.approve`**, so nobody can approve or
withdraw them, and a waiting proposal blocks enrolling or removing that person (F183, accepted; the release note says so).
Increment 2 closes it. **Open residuals:** P5 (`presby_app` can insert a pending roll row and UPDATE it to approved; only the
approved-at-insert half is a database property until 0063), F177 (visitors are in `active_membership`; harmless until a visitor
can sign in), F176 (hard-delete paths remain). "Participants on record" is a decision (DECISION-198): a participant takes effect
when recorded, because participants are not members.

**Designed, not built (same work-log):** Increment 2 (Session approval, pending queue, withdrawal; migrations 0062 and 0063,
DECISION-202–206, F179–F185 and F188–F191), Increment 2b (elder and member sign-in invitations; migration 0065 after person emails took 0064, DECISION-207–208,
F186–F187 and F192–F199, closes F177 by acknowledgement), Increment 3 (visitor follow-ups; scoping note only, starts at F200 and
DECISION-209). Increment 2 needs the operator to confirm the pastors-as-Session-approvers ruling (DECISION-206) and to read its
copy. Increment 2 adds one CLAUDE.md sentence (self-recorded, self-approved Session members) for the operator to review in that diff.

**CI:** the `db` and `e2e` workflows got their Neon secrets on 2026-10-23 and their first runs failed; diagnosing them is a
`docs/TODO.md` line. Until they are green the CI signal is still not whole.

**Production clean-up, 2026-10-22 (out-of-band, operator-instructed, snapshots first; no audit rows; open TODO):** the 68
`.invalid` test accounts deactivated and stripped; the August synthetic people, roll, households and districts purged (the
operator's first test congregation has a clean roster); that congregation's baseline member grant was deleted by the purge and
restored (the cause of F172). Only the operator's two real accounts are active.

**Next, in order (operator, 2026-10-22: all Community work first):**
1. Merge Increment 1 (`/merge-pr`), deploy the code, then apply `0061` to production (snapshot first). Re-run
   `scripts/test-rls.sql` as `presby_app` on merged `development`.
2. Community Increment 2 (Phase 4 starts after Increment 1 merges), then 2b, then 3.
3. The F166 bug-fix pipeline (recovery codes vanish after first 2FA enrolment), before anyone other than the operator is invited.
4. The pre-cutover fpcw parity tracks (careers — Track L, event sign-ups, public events calendar, parish management, account
   migration, event import traps; `docs/reviews/2026-10-22-fpcw-parity.md`).
5. Operator items in `docs/TODO.md` → Deployment: audit backfill question, purge-rehearsal branch deletion, Resend secret
   rotation, the soft-delete fixture exemption, old `blob_assets`; overdue test-coverage and retrospective reviews.

---

## Previous handoff — 2026-10-21: production is on v0.35.0; review polish is integrated at v0.36.0, PR pending; invitations in Phase 5

**2026-10-21.** Production runs v0.35.0 (custom domains for the web, merged and deployed; the operator is working through the
production test checklist). `pipeline/review-polish` (worktree `presby-polish`) is integrated for its PR to `main`: the operator's
four production-review notes, namely Google's own sign-in button (DECISION-190), one box per digit on `/totp` and `/account/2fa`
with a recovery-code toggle and `HydrationGate` rule H3 (DECISION-192), every outbound email as a `RenderedEmail` built by the pure
`renderEmail()` (DECISION-191; closes F161, F162, F165), and `/admin/organizations` as a filterable council tree (DECISION-193 holds
the implementation rulings; findings F160–F165, `docs/schema-design-2.md` §2r; `docs/work-log/2026-10-21-review-polish.md`; Phase 6
SHIP WITH NOTES, every note a `docs/TODO.md` line). No migration, no permission, flag or dependency change.

**In flight:** `pipeline/invitations` (worktree `presby-invites`, migration `0059`, DECISION-183–189, F153–F159 and F166–F168) is in
Phase 5. It merges **second** and adapts `account_invitation` to `renderEmail` at its integration (the brand makes anything else a
compile error); expect a text conflict in `src/lib/email/queue.ts`. Apply `0059` to production by hand (`psql -1`, snapshot first)
before that merge deploys. `scripts/test-rls.sql` on `development` currently fails at line 127 (Alder Creek has 10 memberships, 9
expected, from a demo-account membership added 2026-10-14); fix the row or the count at that integration.

**Open operator questions:** the email button contrast (6.84:1 against a 7:1 target: keep the brand blue or switch to navy); the
"test organization" flag's semantics (its own pipeline); removing the `/signin` `npm run db:seed` hint; whether Google's official
white button is the "pops" the operator meant. The review-polish checklist steps (Google button states, real-phone code autofill,
Gmail and Apple Mail dark mode, the Vercel `RESEND_FROM_EMAIL` value) go onto the production test checklist.

**Next, in order:** merge review polish (v0.36.0); finish invitations (QA → Phase 6 → integration → v0.37.0); the F166 bug-fix
pipeline (first-enrolment `/account/2fa` hides the recovery codes); then the items under the previous handoff below.

---

## Previous handoff — 2026-10-20: production is on v0.34.0; Track F Increment 1 (web custom domains) is integrated at v0.35.0, PR pending

**2026-10-20.** Production runs v0.34.0 (online giving, merged and deployed). `pipeline/custom-domains` (worktree
`presby-domains`) is integrated for its PR to `main`: a congregation proves a domain with a TXT record and its public site is
served there (migration `0057`, DECISION-176–182, F146–F152, `docs/work-log/2026-10-19-custom-domains.md`; Phase 6 SHIP WITH
NOTES, every note a `docs/TODO.md` line; CLAUDE.md gained two invariants, "The Proxy Does Not Reach the Database" and "A Custom
Host Is a Key, Not an Identity", and `check:proxy-imports` is the eighth tripwire). **What is and is not true of it:** it is the
mechanism, not the cutover. `DOMAINS_PROVIDER` is unset in production, so a claim can be proven but cannot reach `live`
("Connecting is temporarily unavailable"); nothing has been run against the real hosting provider, real Cloudflare or real DNS;
the legacy-URL redirect map is unbuilt; church email domains are Increment 2 and unbuilt (the pipeline stays open for it, Batch 2a
first, with the RLS-anchored `mail_domain.*` reader as its precondition). Do not point any real A/CNAME at Vercel before the
acceptance pass.

**Before and at merge** (`docs/deployment.md` → "Pre-deploy runbook: 0057"): confirm production is at `0056`; Neon snapshot; apply
`0057` to production **without `psql -1`** (the file has its own `begin`/`commit`) and *before* the merge deploys; on `development`
apply `0057` twice and the seed, then run `scripts/test-rls.sql` as `presby_app`; set `NEXT_PUBLIC_PLATFORM_HOSTS` (build time) and an
https `NEXT_PUBLIC_APP_URL` in Production before the merge build; list the `presby` project's domains; leave `DOMAINS_PROVIDER`
unset; then the platform-host regression smoke.

**Next, in order** (the operator picks the pace):
1. The Vercel project-scoped token and Production env (`VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`,
   `DOMAINS_PROVIDER=vercel`), then the real-domain acceptance pass on an operator-owned throwaway domain (`docs/TODO.md`, Track F).
2. F111, the permission-ceiling pipeline (the first congregation's founding administrator is what delivers `domains.manage`).
3. The documentation work still open in `docs/TODO.md`, and the legacy-URL redirect map before the first cutover.
4. Production sign-in and the first customer's manual setup, as before; Increment 2 (mail) when Q13 and Q4 are decided.

---

## Previous handoff — 2026-10-19: the online-giving pipeline is integrated at v0.34.0; PR pending

**2026-10-19.** `pipeline/online-giving` (worktree `presby-giving`) is integrated and ready for its PR to `main`:
online giving through per-congregation Stripe Connect, the treasurer's gift desk, the member self-view, itemized payouts, and frozen
year-end PDF statements (migrations `0055`/`0056`, DECISION-168–175, F138–F145, `docs/work-log/2026-10-15-online-giving.md`;
Phase 6 SHIP WITH NOTES, every note a `docs/TODO.md` line). **What is and is not true of it:** verified against recorded and signed
Stripe fixtures only, never a real Stripe account; statements are refused in production until `GIVING_STATEMENTS_ENABLED=1` (CPA gate);
with no Stripe keys nothing takes money and every give surface says so; giving is a per-org toggle (congregations and NWCs, off by
default) with no platform flag, and `0055` deletes the old `org_portal.giving` flag row. `scripts/test-rls.sql` expected total on
`development` after the migrations and seed are applied: **927**. A `/give` page in an existing site bundle keeps rendering until that
org's giving goes live; going live replaces it (`docs/deployment.md` → pre-deploy runbook).

**Next, in order** (the operator picks the pace):
1. Merge the PR (`/merge-pr`), apply `0055`/`0056` to `development`, run `scripts/test-rls.sql` as `presby_app` (927), seed.
2. Bump Next.js to 16.3.8 or later (a high advisory, Image Optimization SSRF) before any production deploy.
3. Production deploy runbook through `0056` (`docs/deployment.md` → Migrations and the giving pre-deploy runbook; `0054` first).
4. Production sign-in: local login, Resend (configured) and Google OAuth, so the operator can sign in at all.
5. The operator's manual setup of the first customer at the platform URL (organization, founding administrator, site), before any custom domain.
6. Track F (custom domains, web then mail), which the first customer's own domain waits on.

Operator items that gate real money, none of them code: a Stripe test-mode Connect platform account and the smoke in
`docs/deployment.md`; the CPA review of the statement wording; Upstash and Turnstile; the enforced-CSP browser check; the privacy notice.

---

## Previous handoff — 2026-10-07: production migrated through 0053; Vercel access restored; nothing in flight

**2026-10-07.** The operator's Vercel access is restored. **Production (`br-wild-band-ax96gv09`) was migrated `0043`→`0053`** by
hand-applied `psql`, one transaction per file, after a Neon snapshot (`snap-orange-math-axbat01u`) and a full catalog diff; the
catalog now matches `development` exactly, `check:schema-parity` is 0 failing, every pre-existing row count is unchanged, and
`scripts/seed.ts` added the two flag rows production lacked. Procedure recorded in `docs/deployment.md` → Migrations. **Two
findings for the operator:** (1) production's `presby_app` password is a dev-style `dev-only-…` string — rotate it once the Vercel
env is yours to update (`docs/deployment.md` → Security); (2) production already has 36 of 40 flags ON, **including the four
"coming soon" placeholders** (`org_portal.giving`/`.worship`/`.committees`/`.communications`) and `org_portal.insights` — with two
real organizations in that database, flip those five OFF before anyone real signs in; the four OFF are the newest
(`org_portal.filings`, `statistics.submission_grants`, `org_portal.feature_categories`, `org_portal.statistical_publication`).

### 2026-10-05: wave 5's three pipelines are merged (v0.29.0, v0.30.0, v0.31.0); nothing is in flight

**All three wave-5 pipelines shipped on 2026-10-05, one PR at a time, each with a full six-phase run:** founding administrator **v0.29.0** (PR #23, DECISION-155 + F118 amendment, §2m F107–F112/F117–F118); the hydration gate **v0.30.0** (PR #24, DECISION-159, §2o F116/F121–F131 — every react-hook-form root is inoperable until hydrated, six tripwires, `npm run test:e2e:prod`); the parent council picker **v0.31.0** (PR #26, DECISION-158 — the relationship type is enforced server-side in `createOrganization()`). Every Phase 6 was SHIP WITH NOTES and every note is a `docs/TODO.md` line. **No worktrees, pipeline branches or pipeline Neon branches are open**; `development` carries no new migration (none of the three shipped one — `0054` is back in the pool) and `test-rls.sql` passes 639/0 there after each merge; the appended `founding.fixture` seed block is applied on `development`. **CI on `main` is green again** (the production-dependency audit had been red since 2026-09-28 on `fast-uri`/`dompurify`; fixed in PR #23 by a lockfile-only bump). GitHub-hosted runners were starved during this session — several jobs were cancelled at 15 minutes having run zero steps and passed on re-run; that is the runner pool, not the code (Rule 11).

**What PSV onboarding now has, end to end:** a platform admin creates PSV (`/admin/organizations/new`), creates its congregations *under* it with the parent picker, designates PSV's founding administrator by email, and that person reaches Roles, Staff, Features, Tickets, oversight, credentials, per-capita, statistics and filings unaided. **What still gates go-live** (all in `docs/TODO.md` → "Blocking a flag flip / go-live"): the seven `org_portal.*` flags the handoff depends on are seeded OFF (`scripts/seed.ts`) — flip the defaults or write the onboarding-runbook step; the production migration runbook (production is still pre-`0043`); the owed what's-new posts at first enablement. A congregation's founding administrator still cannot enrol a roll member (F111/F118 permission ceiling) — blocks the first congregation, not PSV.

**Next candidates** (the operator picks): the go-live flag sweep + production migration runbook (PSV); the F111 permission-ceiling pipeline (first congregation); F130 / the first-load JS budget on form routes (the ≈7 s disabled window on slow-3G); the F124 triage (pre-hydration picks on `useState` selects, incl. the new parent picker's submit); the invitation flow for a designee with no account; the overdue reviews — the release-slot pair (`test-coverage`, `retrospective`) is 47 days past its 14-day cadence and the three releases today make it due now; `downstream-sync` 96 days; `upstream-sync` never run.

---

### Earlier the same day — founding administrator v0.29.0 and the hydration gate v0.30.0 merged; parent picker in Phase 4

**Hydration gate** (`pipeline/select-hydration`, F116) shipped as **v0.30.0** (DECISION-159; §2o F116, F121–F130; SHIP WITH NOTES — every note is a `docs/TODO.md` line). Every react-hook-form root is inoperable until hydrated; `npm run check` has six tripwires; `npm run test:e2e:prod` is the production-build lane (port 3800). The go-live cost: a form on slow-3G is visibly disabled ≈7 s (the JS download) and edit forms are blank until then (F130). Its Neon branch is deleted; its worktree removed.

### Earlier the same day (founding administrator merged as v0.29.0; parent picker and select-hydration in flight)

**Founding administrator** (`pipeline/founding-admin`) shipped as **v0.29.0** (DECISION-155 + F118 amendment; §2m F107–F112, F117–F118; SHIP WITH NOTES — every note is a `docs/TODO.md` line). No migration; `0054` is back in the pool. The presbytery handover is complete end to end; the congregation roll residual (F111/F118) and the designee-facing `org_portal.*` seed defaults are the first items of the go-live flag sweep. `pipeline/org-parent-picker` (`../presby-wt-picker`, port 3500, Neon `pipeline-org-parent-picker`) is unblocked for Phase 4. `pipeline/select-hydration` (`../presby-wt-select`, port 3700 / prod lane 3800, Neon `pipeline-select-hydration`) was reclassified to **Feature** at Phase 2 (DECISION-159 proposed: `HydrationGate` on all 18 RHF form roots + a `PW_PROD_BUILD=1` production-build Playwright lane; F121–F127) and is in Phase 4. The previous handoff below is kept for its wave-5 detail; this block supersedes its "in flight" claims.

---

## Previous handoff — saved 2026-09-28 ~22:45 UTC for a session restart (wave 5: PRs #21, #22 merged at v0.28.2; three pipelines open, three agents were mid-flight)

**Pushed to `origin/main`, in order, since the 2026-09-24 stop:** `ac61c9d` fix(audit) ·
`5421fb4` fix(auth) the callback sanitizer (v0.24.2, security review §A) ·
`debc35c` feat(brand) Track B narrowed — heading/body font tokens load-bearing
(v0.25.0, DECISION-142/143/144) · `e5195c3` fix(e2e) greeting-band hook, post-login
matrix pinned, admin fixture guard · `6d7b7c8` fix(ui) org-switcher 44px floor
(v0.25.1) · **round-two hardening `fix(schema):` (v0.25.2)** — F54–F58 /
DECISION-141 as a correction in place to `drizzle/0043`–`0047`, ten Phase 3
rulings in all, QA re-verified on the live catalog (`test-rls.sql` 412 / exit 0 as
`presby_app`; DB-backed vitest 147/147 serial). **This is the last correction on
`0043`–`0047`.** One accepted residual, tracked: F59 (`congregation_statistics`'s
INSERT half — closing instrument is a raw column-list insert in
`src/lib/presbytery.ts`, `docs/TODO.md` Next Up).

**Production WAS migrated through `0053` on 2026-10-07** — see `docs/deployment.md` → Migrations for the exact
procedure (snapshot, catalog diff, hand-apply with `psql`, verify, seed). (Historical note, kept for the record: deploys do not
migrate; `npm run db:migrate` / `psql "$MIGRATE_DATABASE_URL" -f …` against
production is a deliberate, separate operator step). `development` carries
`0043`–`0047` at the shipped state.

**Reviews run 2026-09-25:** security (§A app half fixed in v0.24.2; §B schema
punch-list in TODO), code, documentation, agent-instruction, dependencies. The
release-slot pair (`test-coverage`, `retrospective`) was in progress when this
block was written — check `docs/reviews/log.md` for whether both entries landed.

**In flight when this block was written** (each has its own work-log; the
work-log is the source of truth): `docs/work-log/2026-09-25-platform-radius.md`
(Polish — `--radius` 0.5rem → 0.625rem, one token + comment rewrite, 67 re-captured
before/after pairs + 13 sub-threshold; Phase 5 re-verification after a text-only
FAIL). Uncommitted in the tree for it: `src/app/globals.css` and the work-log.

**Wave 2 (2026-09-25 afternoon), Rule 16 for real this time — one worktree + one Neon branch per pipeline:**
`pipeline/security-schema-b` **merged** as PR #13 (`42ec0e9`, v0.25.5, `drizzle/0048`,
DECISION-146; `development` re-migrated 0043→0048 and `test-rls.sql` 476/exit 0 there;
every DEFINER function in `public` pins `pg_temp`, catalog-wide). `pipeline/submission-grants`
(`drizzle/0049`, DECISION-147, F80 — the platform's first unauthenticated write path,
SHIP WITH NOTES) **merged** as PR #14, v0.26.0; `development` re-migrated through 0049
and `test-rls.sql` re-run there (520). Flag `statistics.submission_grants` seeded OFF —
what's-new owed at first enablement. The lifecycle pipeline's **third** external round (F60–F64)
shipped as v0.25.4 (`afc2afb`) — F59 closed, pg_temp pinned, DECISION-148.
**CI on `main` is green again as of PR #15 (`338b1bb`, v0.26.1, 2026-09-26)** — red since
2026-08-26 on eight lint errors behind a Lint-first job that skipped Build/Tripwires/Audit/
Tests; fixed on their merits (DECISION-149: lint in `/pre-push` Step 3a and LAST in `ci.yml`),
plus a second regression it had hidden: `isFlagEnabled()` never failed closed and the naive
fix would have dropped 2FA enforcement on a DB blip (DECISION-026 corrected; the sign-in
flags read inline). `main` still has **no branch protection** (operator decision, TODO).
Wave 3's other pipeline, `pipeline/ci-db-tests`, **merged** as PR #16 (`f8c5dc0`, v0.26.2,
`drizzle/0050_presby_schema_parity.sql`, DECISION-150, F81–F83; `development` re-migrated
through 0050 with `install-test-helpers.sql` and `test-rls.sql` 520 there): Batch A found and fixed that the committed migrations did not reproduce
the live schema (four columns; a from-empty database had a broken permission resolver) and
that the isolation suite's `assert_eq()` helper existed in no committed file — a database
built from empty now migrates, seeds and passes 520 assertions for the first time; Batch B
shipped the `db.yml` job + the repo's first composite action + the `e2e.yml` repair; both
jobs **skip with a `::notice::` until the operator adds `NEON_API_KEY`/`NEON_PROJECT_ID`**
(`docs/deployment.md` has the two-step instruction). No worktrees or pipeline branches are
open; the three wave-2/3 Neon branches were deleted on 2026-09-27 with the wave-4 ones.

**Wave 4 (2026-09-26 evening), four pipelines under Rule 16, each in its own worktree + Neon branch:**
`pipeline/render-path` **merged** as PR #17 (`79399e9`, v0.26.3, DECISION-154; no schema change) — six
uncaught reads on the public-site path (not the three the flags pipeline named) now fail closed to the
same generic `not_found`, QA reproduced failing-first per spec file and re-ran the production-build probe
against an unreachable database; two SHIP-WITH-NOTES follow-ups in TODO (the contact-form insert; the
never-produced `reason: "absent"`). Each open pipeline's work-log is the source of truth:
`pipeline/group-types` **merged** as PR #18 (`91e3e61`, v0.26.4, `drizzle/0051`, DECISION-151, §2j F84–F86;
`group_types` is a pure global catalog — no `organization_id`, no RLS, `unique (key)`, `presby_app` SELECT-only;
`development` migrated through 0051 and `test-rls.sql` re-run there, 526). `pipeline/name-history` **merged** as
PR #19 (`1b25278`, v0.27.0, `drizzle/0053`, DECISION-153 + the F104 addendum amendment, §2l F100–F106; QA first pass
FAIL on two missing `grant execute` lines — the 0046 B-M1 hazard — fixed with failing-first both ways, second pass PASS;
Phase 6 SHIP WITH NOTES; `development` migrated through 0053, the new seed block applied there, suite 590).
`pipeline/withdraw` **merged** as PR #20 (`6689689`, v0.28.0, `drizzle/0052`, DECISION-152, §2k F90–F91): one DEFINER
council act `presby_withdraw_publication()`, the new `/o/<slug>/admin/filings` (flag `org_portal.filings`, seeded OFF —
**what's-new owed at first enablement**), the presbytery's per-congregation history, the congregation stated-clerk template
`…0004`; QA first pass FAIL on test fixtures only (the mandatory browser rehearsal withdrew the single seeded publication —
tests now mint their own chains), second pass PASS, Phase 6 SHIP WITH NOTES. `development` migrated through 0052 (applied
after 0053 — the two are independent; the journal carries 51, 52, 53 in order and a from-empty `db:migrate` applies all 54),
`db:seed` re-run there so the flag row exists (off), suite **621 / exit 0**. **No worktrees or pipeline branches are open.**
`test-rls.sql`'s appended sections sit in merge order (43, 42, 41) — numbers are pre-assigned per Rule 16, file order is not.
Every finished pipeline's Neon branch is deleted at cleanup (operator standing rule, 2026-09-27): only `production` and
`development` remain in the project.

**Wave 5 (2026-09-28), goal: a real presbytery (PSV) can be onboarded, tested and deployed.** The 2026-09-27
audit found every presbytery feature shipped behind an off flag but inert for a real org — a freshly created
organization has nobody who can grant its own first role (DECISION-100/101/106). Three Rule 16 pipelines started in
parallel, each with its own worktree, Neon branch and work-log (the work-log is the source of truth):
`../presby-wt-boot` / `pipeline/founding-admin` (`docs/work-log/2026-09-28-founding-administrator.md`; migration
`0054` reserved, DECISION-155, F107+; port 3400) — the deploy blocker; `pipeline/statistics-error-mapping` **merged** as PR #21 (`f2823ad`, v0.28.1; the reports form's year picker is
constrained per congregation and the trigger's refusal mapped to English; bug 2 rescoped to the two live callers — the
self-publish surface, Increment 4a, is its own future pipeline; no schema; suite 621 on `development`; Neon branch deleted); `pipeline/presbytery-e2e` **merged** as PR #22 (`c7b7a34`, v0.28.2, DECISION-157, §2n F113–F115): four new specs on
Playwright-owned fixtures only; suite 120/4/5 → 164/0/0; `e2e.yml` gains the `E2E_DATABASE_URL` line without which the
job could never have passed (F113); `public-sites.spec.ts:334` was site-kit v4 spec rot (F114). F116 — a pre-hydration
`<select>` revert on the statistics form — is a product finding tracked as a candidate bug-fix. No schema; suite 621 on
`development`; Neon branch deleted. **Founding administrator** (`../presby-wt-boot`, `pipeline/founding-admin`): Batches
A–C complete; NO migration (the `people.user_id` index was stopped by its pre-flight probe — a committed fixture duplicates
a `user_id`, F112); Batch C's mandatory rehearsal found the bundle could not create a second person (F118) → Phase 2
addendum: `staff.manage` joins the bundle, roll keys stay out; Phase 4 fix pass running, then QA, Phase 6, integrate as
v0.29.0 (DECISION-155 + amendment; F107–F112, F117–F118). `org_portal.staff` is seeded OFF but is the founding
administrator's only person-creation path — joins the go-live flag sweep. **Two more wave-5 pipelines opened
2026-09-28 night, Phases 1–3 read-only in parallel per Rule 16:** `../presby-wt-picker` / `pipeline/org-parent-picker`
(`docs/work-log/2026-09-28-organization-parent-picker.md`; the parent-council + relationship-type control on
`/admin/organizations/new`; DECISION-158 if any, F119+; port 3500; Neon `pipeline-org-parent-picker`
br-quiet-rain-axnzktt6; **Phase 4 only after `pipeline/founding-admin` merges** — shared files) and `../presby-wt-select` /
`pipeline/select-hydration` (`docs/work-log/2026-09-28-select-hydration-revert.md`; F116 — Phase 1 must first reproduce on
a production build under throttling, else NOT YET; DECISION-159 if any, F121+; port 3700; Neon `pipeline-select-hydration`
br-broad-haze-axdhzmif). Queued behind #1 (shares `org-provisioning.ts`): the
`/admin/organizations/new` parent-org/relationship-type picker. Closing the wave: the go-live flag sweep (placeholder
tiles off, real presbytery flags on for PSV), a production migration runbook (production is still pre-0043 —
operator step), and the what's-new entries owed at first enablement.

**Session-restart handoff (2026-09-28 night).** Three agents were running when the operator paused; each writes only to
its own pipeline's files, so nothing is lost, but their returns must be RECORDED by the next session before advancing:
1. `../presby-wt-boot` — the full-stack-developer "Phase 4 fix pass — F118" was **STOPPED by the orchestrator at
   shutdown** mid-way through a `test-rls.sql` run. What landed on disk: `staff.manage` in `foundingAdministratorPlan()`'s
   base array + the F118 doc comment (`src/lib/founding-administrator.ts`), `"staff.manage": "staff"` in
   `PERMISSION_LABELS`, and §44a edits A–E incl. the new `44a (F118)` assertion in `scripts/test-rls.sql`. What did NOT
   land: the test updates (plan shape 7→8 / 8→9, audit `permissionKeys`, dialog copy), the unchanged-files test
   extension, the rehearsal step-6 re-run on the staff-hire path, and the work-log subsection (Phase 4 status row still
   reads "Batch A complete…"; Phase 5 "Waiting"). Fixture `founding.fixture@example.invalid` has 0 `people` rows; no
   rehearsal orgs, no stamped rows, no scratch DBs on `br-empty-frost-ax4mo8q5`. **Resume by re-spawning a
   full-stack-developer fix pass with the addendum's items (1)/(3)/(5), telling it the code edits already exist** — it
   verifies them, adds the tests, runs failing-first where still possible, does the rehearsal, writes the subsection.
2. `../presby-wt-select` — analyst Phase 1 for F116 **returned and is recorded: READY WITH NOTES, and the bug is REAL
   in production** — 10/10 silent reversions on `next build && next start` under CPU ×4 + slow-3G, and the wrong
   congregation's statistics were PERSISTED with a "Statistics saved." toast and a consistent audit row. Mechanism: RHF
   uncontrolled `register()` on a native `<select>` reconciles `defaultValues` onto the DOM at hydration; the same shape
   is in 9+ other forms (person/org/household pickers in credentials, officers, groups, members, staff, per-capita
   payments). **Treat as a PSV go-live blocker for the statistics form.** Next: spawn **architect** Phase 2 to rule the
   fix scope (one form vs a shared `Controller`-based hydration-safe select) and where a production-build Playwright
   regression lives (`playwright.config.ts` only knows `npm run dev`; CDP throttling helpers do not exist yet).
   Also noted: `next build` in a worktree is flaky (`@vercel/turbopack-next … font` module-not-found) — use the
   documented external hardlinked scratch copy.
3. `../presby-wt-picker` — tech-lead Phase 3 **returned and is written into the work-log** (native `<select>`; eligible parents fetched server-side, type-only; `[id]` stacking: founding-admin → affiliation → brand). Phase 4 must NOT start until
   `pipeline/founding-admin` merges (shared `admin/organizations/new` + `[id]/page.tsx`); then merge main into the
   branch, spawn full-stack-developer.
Integration for each open pipeline: `w5-integrate.py boot|picker|select` in the scratchpad (inputs `<mode>-phase6.md`,
`<mode>-todo-notes.txt`, `<mode>-release.md`, `<mode>-map.txt`; boot's are staged), versions boot 0.29.0 → picker
0.30.0 → select patch; boot's DECISION-155 needs the F118 amendment appended and F111's worked example marked retired
(§2m F107–F112, F117–F118). Scratchpad (survives on disk):
`/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b08e6db7-b5b1-4a1b-b94f-75e0928bed80/scratchpad/`
(`record-phase.py`, `w5-integrate.py`, `make-wave5*.py`, staged inputs) and `../tasks/*.output` (agent transcripts).
Uncommitted work: `presby-wt-boot` (14 files — Batches A–C + fix pass; commit as `feat(admin):` once QA passes),
`presby-wt-picker` and `presby-wt-select` (work-logs only). No dev servers, no scratch databases; Neon branches
`pipeline-founding-admin`, `pipeline-org-parent-picker`, `pipeline-select-hydration` are live and are deleted at each
pipeline's cleanup. Wave-5 close-out after those merge: the go-live flag sweep (placeholder tiles off; `org_portal.staff`
+ the presbytery flags on for PSV), a production migration runbook (production is still pre-0043), the what's-new entries.

**Next, in order (the remaining candidates after wave 4):** the operator's
three decisions (Neon secrets → CI jobs run; branch protection; delete the three Neon
branches); then wave 4 under Rule 16 — code-review C-1/C-2/C-3, the test-coverage punch
items 7 and 10–17, D22/D23 design phases,
Track A/C/R — each in its own worktree +
Neon branch, integrated one PR at a time. The shared `development` branch is a proven hazard for concurrent DB-backed
suites (QA measured `organizations` moving 17 → 15 mid-run); use per-pipeline
branches.

**Operator actions outstanding:** Vercel Node 22 before 2026-10-01;
`NEON_API_KEY`/`NEON_PROJECT_ID` repository secrets (CI e2e has never run); FPCW
brand configuration (B3) and the `ui.branded_signin` parity sign-off; the real-PII
`organization_profiles` row on `development`; `org_portal.home_v2` on
`development` (two e2e reds until reset or e2e moves to an isolated branch).

---

## Where the project stands

The durable operational facts a fresh session needs, so they don't have to be
reconstructed from session-history prose (below). Detail lives in the linked
document; this is the summary.

- **Neon.** Production is the `presby` project's `production` branch
  (`polished-snow-90038485` / `br-wild-band-ax96gv09`). `development`
  (`br-super-dawn-axfi55p6`) is forked from it and is what `.env.local` points
  at for local work. **Production was migrated through `0053` on 2026-10-07**
  (snapshot `snap-orange-math-axbat01u` taken first; procedure in
  `docs/deployment.md`). The migration ledger is still ten rows on both
  branches, so the apply command stays the `psql` form. A Vercel deploy does not run migrations;
  `npm run db:migrate` (or `psql "$MIGRATE_DATABASE_URL" -f …` when the
  runner's ledger is incomplete, as it is on `development`) is a separate,
  deliberate step. Full detail: `docs/deployment.md`.
- **Vercel — an unresolved account/credentials risk.** The operator has lost
  reliable administrative access to the Vercel team that has held every
  presby deployment to date; the **legacy `presby-portal` project is what
  actually serves `www.presbyportal.org`**, and it holds valid `presby_app`
  production credentials inside that impaired-access team. Remediation order
  matters and is not yet executed: new Vercel project in a controlled team →
  set env vars there → repoint DNS → **only then** rotate the Neon
  `presby_app` password. Rotating first takes the live site down before the
  replacement is ready. Full detail, including the Node-22-by-2026-10-01
  deadline: `docs/deployment.md`.
- **Real PII sits in the shared `development` branch.** A real congregation's
  street address and phone number (`organization_profiles`, `fpcw`) are in
  the database, not the repository — `check:secrets` is silent and the No
  Real Data invariant's letter (scoped to the repo) holds, but it is real PII
  several agents and sessions can read. Needs an explicit operator call:
  scrub it, or record it as a deliberate, bounded exception. Tracked in
  `docs/TODO.md`.

---

## What this is

A multitenant platform for Presbyterian congregations, presbyteries, and synods.
Church management (rolls, officers, directory, giving, events), council
operations, per-tenant websites, and a support-ticket loop worked partly by AI.
Open source, so no real data ever enters the repo.

Seeded from `chenson42/claudecode-nextjs-starter`. Prior art lives in sibling
repos and is worth reading before designing anything: `../fpcw-directory`
(church portal, 69 tables, the kiosk app under `white-binder/`),
`../westervillelions` (fund accounting, 24 ledger tables; also
`docs/reviews/2026-08-12-pii-scrub.md`, the cautionary tale for real data in a
public repo), `../psvonline-portal` (presbytery, already org-scoped),
`../synod-portal` (public learn layer, AI spend gate).

**Named: PresbyPortal** (decided 2026-08-27, DECISION-126; domain
`presbyportal.org`). `/personalize-starter` is still deliberately un-run —
`presby` continues to thread through the database role, thirteen `presby_*` SQL
functions, and every migration filename, and `package.json` still carries the
starter's name. **This is now deliberate continuity, not an unresolved
placeholder**: renaming the DB role, the `presby_*` function prefix, and every
migration filename is a large, high-blast-radius mechanical effort (a live
Postgres role rename has session/connection implications; RLS policies and
`SECURITY DEFINER` functions reference the role by name) that deserves its own
scoped pipeline, not a piecemeal edit — tracked in `docs/TODO.md`. Public-facing
copy (the marketing home page, README, external docs) uses **PresbyPortal**
starting now; internal code identifiers do not change until that pipeline
runs.

---

## The five ideas everything rests on

1. **Global person, org-scoped membership.** `people` holds the human and their
   own data; `memberships` is the link carrying roll status. Decided on polity,
   not convenience: ministers of Word and Sacrament are members of the
   *presbytery* (G-2.0502) while ruling elders are members of the
   *congregation*, so one person's roll and service routinely sit at different
   organizations.

2. **The roll is event-sourced; everything else is a projection.**
   `roll_actions` records what the session did. The directory is a view of it,
   the annual statistical report (SASR) is a projection of it, per capita
   derives from it. The report asks for *changes over a year*, not a snapshot,
   which is why a status column cannot produce it and why every clerk hand-
   tallies it in January.

3. **The court is not a group.** Session and diaconate rosters materialize from
   `officer_terms` by trigger and reject direct writes. If staff could add
   someone, the court would be invalid and every action it minuted questionable.

4. **Access flows up by publication, never down by inheritance.** A presbytery
   gets nothing from inside a member congregation except the SASR it publishes.
   Two narrow exceptions, both time-boxed and minuted: an administrative
   commission, and a session-granted delegation.

5. **Isolation is a database property.** `presby_app` is `NOBYPASSRLS`; every
   tenant table is `FORCE ROW LEVEL SECURITY`. `users.is_platform_admin` decides
   which *pages* are reachable, never whether a query is filtered.

---

## Decisions

| # | Decision | Note |
|---|---|---|
| D1 | Global `people` + org-scoped `memberships` | Reversed twice mid-build; see idea 1 |
| D2 | Shared column contract, not one polymorphic table | Polymorphic loses FKs |
| D3 | Roll approval is a status on the action row | Meetings module deferred |
| D4 | Demographics per-person, tier 3; disability per-church opt-in | |
| D5 | Other-participants roll: staff enrol, session ratifies annually | |
| D6 | PC(USA) only | Polity vocabulary in seed data where cheap |
| D7 | Platform admin = boolean + separate DB connection | Break-glass deferred to Phase 5 |
| D8 | **No custom fields.** Tags only; everything else is a support ticket | Makes the ticket loop the sole extensibility path, so it cannot be built last |
| D9 | Most congregations will **not** be tenants | A presbytery's launch-day job is holding records about non-tenants. `organizations.platform_status`. Raises a live question: should Phase 2 partly precede Phase 1? |

Sensitivity tiers: **1** directory · **2** financial · **3** pastoral,
demographic, medical. Pastoral notes sit *above* financial; the AI worker gets no
grant on them under any elevation.

---

## Built and verified

63 domain tables (`docs/product/functionality-map.md` carries the current
count and per-area detail; the schema grows with nearly every pipeline).
`scripts/test-rls.sql` is the isolation suite and **must run as `presby_app`** —
running it as the owner proves nothing, because `neondb_owner` has
`rolbypassrls = t`.

- Org hierarchy, people/memberships/identity, rolls, officers, groups,
  authorization, privacy, statistical returns + publication
- RLS on every tenant table, plus bespoke policies for the global person tables
  and the genuine two-org reads (`administrative_commissions`, `org_delegations`,
  `transfer_certificates`)
- `presby_effective_permissions(person, org, as_of)` — four arms (direct, group,
  commission, delegation) with provenance
- Roll read path: `presby_roll_as_of`, `_counts_as_of`, `_changes`, plus a daily
  reconcile and a drift detector
- Officer registers: `presby_officer_roster(org, office, as_of)`, `_history`
- `/developer` — generated reference (index, per-table pages, per-module ERDs).
  Descriptions live in Postgres `COMMENT ON`, so they cannot drift. **But it is
  blind to functions, triggers and RLS policies** — for presby, the half carrying
  the invariants. Filed as P11.

---

## Findings worth remembering

Logged in `docs/schema-design.md` §17–19 and `docs/schema-design-2.md` §2a–§2g.
The ones that would have shipped:

- **F1** `force row level security` was missing. Postgres exempts the table
  owner, so with a shared role RLS is inert *and every naive test still passes*.
- **F21 → F26** A guard written to stop identity enumeration was itself defeated
  by RLS: not `SECURITY DEFINER`, so its "does this person exist elsewhere?"
  probe read zero rows for exactly the person it protected. **Caught only by
  running it.**
- **F22** The derived-group trigger destroyed officer history — a second,
  non-consecutive term rewrote the first term's end date.
- **F28** The neon-http driver cannot carry a transaction-scoped GUC at all, so
  the isolation model dictated the driver (WebSocket pool).
- **F29** The roll cache goes stale with the *passage of time*, not only on
  writes: future-dated actions take effect on a day with no corresponding write.
- **F44** `getPlatformDb()` connects as `neondb_owner`; a grant edit alone never
  binds it, only a trigger does. Generalized across two external post-merge
  review rounds (DECISION-140, DECISION-141) from mutation surfaces to creation
  surfaces.

Pattern: reading the schema found design problems; **running it found the
security problems**. Three UI bugs were also phone-only and invisible to
`curl` + `tsc` + `next build`.

---

## Where the work actually is

The schema was the whole project on 2026-08-17. Since then the platform grew a
front door, and the shape of the remaining work is a **program of numbered
pipelines**, decomposed by the analyst and recorded in
`docs/work-log/2026-08-18-backbone-and-org-sites.md`. See the RESUME HERE block
at the top of this file for exactly where things stand as of the latest session.

**Shipped**

- **P0 — post-login router and org context.** `/launch` computes the
  destination matrix and forwards; `/home` is the chooser and never
  auto-forwards; `/no-organization`; `/o/<slug>` under a new `(org)` group with
  an immutable, DNS-label-constrained slug. Named access-denied that is
  byte-identical across platform statuses. Header split into an avatar (identity)
  and an organization switcher (context), on Google's model.
- **The design system**, finally taken delivery of — `cn()`, `components.json`,
  five primitives, expanded tokens. Light mode fixed: it had **never** rendered
  for anyone.
- **P0.5 slice 0 + a1** — the brand token contract (`src/lib/brand/contract.ts`,
  zero imports, `LEGAL_PAIRS` carrying their own contrast floors) and the tooling
  (`ui:add`, `check:deps-drift`, `check:brand-scope`).
- **The D10/D19/D20/D21 schema unit** (organization lifecycle, affiliation
  history, statistical returns, publication) — see `docs/product/functionality-map.md`
  for current detail and the RESUME HERE block above for what's still mid-flight
  (round-two hardening).

**In flight / queued** — see the RESUME HERE block at the top of this file and
`docs/TODO.md` for the current, authoritative list; this section is not
duplicated here because it goes stale faster than either of those.

## What a new session must know

- **The decisions log** lives in `docs/decisions.md`, newest first, numbered.
- **Verification is deferred, not skipped** (DECISION-045) for the earliest
  foundation pipelines specifically — see `docs/TODO.md`'s **Verification
  debt** section for what remains.
- **`docs/testing.md`** has the fixture accounts and the hand-testing walkthrough,
  plus how to run the DB-backed automated suites.
- **The status line** (`scripts/statusline.mjs`) shows running agents with
  elapsed time. Liveness is an mtime heuristic with a 90-second window — an agent
  thinking quietly looks idle.
- **Do not trust a long-running dev server for a visual check.** One was observed
  serving a stale CSS chunk and never recompiling, even after a touch. Use a
  production build on a scratch port.

## Four defects that had shipped and nothing noticed

Worth carrying because they are all the same shape — code nothing had exercised:

- **`withOrgContext()` rejected every member.** It checks membership before
  setting the org GUC, and `memberships` is FORCE RLS keyed on that GUC. F26's
  third occurrence. Latent because nothing called it until a page did.
- **Light mode had never rendered.** `@theme` nested in a media query, which
  Tailwind v4 hoists.
- **The e2e suite reported success having run 6 of 48 specs.**
- **The focus ring was invisible at 1.00:1** — `--ring` and `--primary` are the
  same colour, and the ring is drawn flush against the fill. The fix is geometric
  (a 2px offset the contract carries as data), not a different colour.

## Running it

```bash
npm run dev                  # localhost:3000
# phone on the same wifi needs DEV_ALLOWED_ORIGINS set to the LAN IP,
# or Next blocks /_next/* and the page renders but never hydrates
psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql     # synthetic fixture
psql "$APP_DATABASE_URL"     -f scripts/test-rls.sql     # MUST be presby_app
npm run docs:erd             # refresh the diagrams in schema-design.md
```

Local sign-in: `dev@example.invalid` / `presby-dev-password`. Delete before any
deploy.

Four connection strings in `.env.local`, and the distinction matters:
`DATABASE_URL` (presby_app, RLS enforced — the app),
`PLATFORM_DATABASE_URL` (bypasses RLS — platform pages only),
`MIGRATE_DATABASE_URL` (owner, direct endpoint — DDL),
`APP_DATABASE_URL` (presby_app with login — tests).

---

## Session history (archive)

Historical session handoffs, superseded by the sections above and by
`docs/deployment.md`. Kept for provenance only — do not treat anything below
as current operational fact without checking it against the live sections
above first. Newest first, mirroring `docs/reviews/log.md`'s own convention
for carried-over history.

### 2026-09-24 — the DDL pipeline shipped, planning for round two

The "NEXT TASK" below is **done**: `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`
closed SHIP WITH NOTES after a full six-phase run (three Phase 3 loop-backs, one
Phase 5 loop-back — every one caught a real defect; read the work-log's Phase 2
rulings and the QA sections before touching any of these tables). Shipped:
`drizzle/0043`–`0047`, domain modules `lifecycle.ts` / `returns.ts` /
`publication.ts` (`reporting.ts` deleted), `createOrganization()` with a parent,
`test-rls.sql` 277 → 363 assertions, v0.24.0. Applied and proven on the
`development` Neon branch; **not yet applied to `production`** — that happens
with the deploy (`npm run db:migrate` there; on `development` the runner's ledger
is incomplete, so migrations were applied with `psql "$MIGRATE_DATABASE_URL"`).

**Next pipelines, in order of leverage (as understood at the time):** (1) the seven overdue periodic reviews —
`security` first, since it now has F38/F40/F46 and the `presby_platform` blanket
grant (`drizzle/0009:44`) waiting for it; (2) increment 6, submission grants, its
own work-log and security pass (Phase 2 Ruling 11 pre-placed the route group);
(3) increment 7, name history + D13 import staging; (4) the lifecycle-UI pipeline
(`presby_record_lifecycle_event()` / `presby_organize_congregation()`, the admin
form's missing parent control); (5) the publish UI (Increment 4a). D22 and D23
remain independent. The `docs/TODO.md` FPCW-program block has every follow-up.

**Checkpointed ahead of a session refresh.** No code was written this session
beyond a one-paragraph copy fix. What happened was **planning and schema design**,
and the artifacts are all committed — but the next step was deliberately *not*
started, so it is waiting.

#### THE NEXT TASK (as framed at the time — see RESUME HERE above for current status)

**Table-and-constraint design for D10 / D19 / D20 / D21, as a single unit.**

Read `docs/schema-design-2.md` first — **§2b, then §2a**. Review round 3
(2026-09-24, `docs/reviews/2026-09-24-schema-design-round-3.md`) found the §3–§6
table shapes stale against the decisions and colliding with three built tables —
`organizations.status`, `organization_settings.pcusa_pin`, and above all
`congregation_statistics`' **already-built** publication mechanism (DECISION-118/120),
which D20/D21 had silently duplicated. §3–§8 were rewritten in place; §2b carries
the change table (D24–D26, F34–F37) and the migration order the pipeline should
follow. Those four decisions are coupled tightly enough that designing them
sequentially would produce four shapes that do not fit:

> permanent organization identity (D10) → historical affiliation (D19) → global
> person + tenant membership (D1) → append-only roll → live statistical projection
> → frozen submitted artifact (D21) → immutable publication event (D20) → recipient
> reads the published artifact, not the source's live state

Broad schema discovery is **complete**. This is DDL, constraints, indexes and RLS
policy — not more shape-finding. D22 (person-merge provenance) and D23 (care
grants) are independent and can run separately.

#### What this session decided (all committed)

The whole session was driven by one reframing: **presby will replace
fpcw-directory for FPCW and become its system of record for members and finance,
with a presbytery go-live (PSV) first.**

- **`docs/reviews/2026-09-23-fpcw-feature-match.md`** — the replacement program.
  Eleven tracks, a dependency spine, confirmed scope, and the settled design
  decisions. Read this for the *program*; read `schema-design-2.md` for the
  *model*.
- **`docs/schema-design-2.md`** — full-domain schema round 2. Decisions **D10–D26**,
  findings **F30–F37**. Three review rounds; round 2's corrections are in §2a,
  round 3's (table shapes vs. decisions vs. built schema) in §2b.
- **`docs/deployment.md`** — rewritten. The previous draft's central claim was
  false (it described a `presby-production` Neon project that does not exist).

#### Standing instructions established this session

1. **The Book of Order is a design authority, not a lookup of last resort**
   (`schema-design-2.md` §0a). Before naming a status, role, register or
   lifecycle, check whether the polity names it; if we diverge, say why. This
   immediately corrected D10 — G-3.0301(c) states the lifecycle vocabulary
   verbatim.
2. **Hard cutover: "if I deferred func then it is func that isn't used."** So the
   pre-cutover track list *is* the definition of what FPCW uses, and anything
   post-cutover is new product rather than parity.
3. **Visual parity with fpcw yes, layout parity no** — layout parity would cap
   presby's IA at the app it replaces.

#### Open decisions waiting on the operator (as of this session)

Four, all in `docs/schema-design-2.md` §10 / the program doc:
Vanco integration depth · youth vs children's ministry · whether PSV needs Google
Groups for committees · whether PSV needs a public website (it wants one
eventually, not today).

#### Resolved: the two critical Next.js CVEs (v0.23.3)

`next` 16.3.0 → **16.3.6** (`eslint-config-next` to match), `sharp` → 0.35.4,
`js-yaml` → 4.3.2, `browserslist` → 4.29.1. Zero critical or high advisories
remain; the leftover moderates are dev-only (`vitest` 4.1.6 and the `drizzle-kit`
→ esbuild chain) and tracked in `docs/TODO.md`. Note for the next dependency pass:
`npm update` on `vitest` trips npm 10.8.2's `edgesOut` reify bug in this tree —
update packages one at a time.

#### Housekeeping done this session

`.claude/agents/` retuned for cost (opus on architect/qa/database-admin — two of
the three are read-only, so the spend is small; everything that writes volume
stays on sonnet). Agent `effort:` declared for the first time in this repo.

---

### 2026-08-31 — production push, Vercel/Neon split

**Checkpointed mid-launch, ahead of a restart.** First real production
push — a lot of infrastructure state changed that lives in Neon/Vercel, not
in this repo, so it would otherwise be invisible to a fresh session.

> **Note (2026-09-25):** the "Wrong DB credentials" fix described below —
> resetting `DATABASE_URL`/`APP_DATABASE_URL`/`PLATFORM_DATABASE_URL` on the
> `presby` Vercel project — did not stick or did not apply to what's actually
> serving traffic. `docs/deployment.md`'s 2026-09-24 rewrite found the `presby`
> Vercel project has **zero** environment variables, and that the **legacy
> `presby-portal` project** is what actually serves `www.presbyportal.org`.
> Treat `docs/deployment.md` as current; this block is kept for provenance only.

#### The real production database — correcting `docs/deployment.md`

`docs/deployment.md` (still untracked, not yet committed/corrected) was
written by an earlier session believing it had no access to "the dev
database's" Neon account, so it provisioned a brand-new, separate project
(`presby-production`, id `withered-bird-71608444`) as production. **That
belief was wrong and that project is not what's live.** The actual
production database is the **`presby` Neon project's `production` branch**
(id `polished-snow-90038485`, branch `br-wild-band-ax96gv09`) — the same
project this session's Neon MCP integration has always had access to.

#### Neon: dev/prod split done, production cleaned

- Created a `development` branch (`br-super-dawn-axfi55p6`) off
  `production`, in the `presby` project. **`.env.local` now points at
  `development`, not `production`** — local work no longer touches the live
  database directly.
- `production` had been used directly as the shared dev/test target for
  weeks, accumulating cruft. Cleaned it down to exactly two orgs:
  - `fpcw` (First Presbyterian Church of Westerville) — the real sponsor
    congregation.
  - `presbytery-of-scioto-valley` (Presbytery of Scioto Valley) — newly
    created; `fpcw` is now parented under it (real ecclesiastical
    geography — FPCW/Westerville OH is genuinely in Scioto Valley
    presbytery's bounds).
  - Removed: 48 leaked `vitest` test-fixture orgs (spanning 15+ spec
    files — see the new `docs/TODO.md` bug below) and 10 stale
    `seed-dev.sql`/e2e fixture orgs (`e2e-*`, `northern-reach`,
    `quillhaven`, `fernwood`, `marrowbone`, `alder-creek`, `bramblewood`).
  - The cascade deletes required temporarily disabling four immutability
    triggers one at a time, each with explicit sign-off:
    `group_memberships_reject_derived`, `roll_actions_freeze`,
    `groups_reject_derived_edit`, `congregation_statistics_freeze` — all
    confirmed re-enabled after. One leaked row was itself invariant-broken
    (`group_memberships.source = 'derived'` with `officer_term_id = null`,
    impossible through the normal materialization path).
  - Also had to explicitly delete `ticket_messages` rows before the org
    cascade — `ticket_messages_ticket_fk` is `NO ACTION`, not `CASCADE`,
    so it doesn't clean up on its own.
- New `docs/TODO.md` entry names the root cause: the DB-backed test suite
  writes directly into the shared branch and doesn't reliably tear down.
  Needs real per-test isolation or bulletproof teardown, not more
  hand-cleaning.

#### Vercel production — believed fixed at the time (see the 2026-09-25 note above)

The `presby` Vercel project (`community-collective/presby`) is linked and
`presbyportal.org`/`www.presbyportal.org` are live-aliased. Two real
production bugs found and fixed:

1. **Wrong DB credentials.** `DATABASE_URL` et al. were failing
   `password authentication failed for user 'presby_app'` in production
   runtime logs — almost every DB-backed route was 500ing, including the
   public `fpcw` site (confirmed via `vercel logs --level error`). Reset
   `DATABASE_URL`/`APP_DATABASE_URL`/`PLATFORM_DATABASE_URL` to the correct
   `production`-branch connection strings and added the previously-missing
   `MIGRATE_DATABASE_URL`. Redeployed and confirmed `/`, `/signin`, and
   `/site/fpcw` all return 200 with real content.
2. **`AUTH_URL`/`NEXT_PUBLIC_APP_URL` pointed at the apex domain**
   (`presbyportal.org`) while the site's canonical host is `www` — the apex
   308-redirects everything, including `/api/auth/*`, to `www`. That would
   have bounced the OAuth dance between hosts. Fixed both to
   `https://www.presbyportal.org`, redeployed, confirmed
   `/api/auth/providers` now reflects the `www` callback URL.

#### Blocked on the user, next up (as of this session)

1. **Google OAuth** — `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are not set in
   production, and there is no credentials-login fallback by design
   (`docs/deployment.md`'s own note). **Nobody can sign into production
   right now, including the operator.** Waiting on a Google Cloud Console
   OAuth client (redirect URI `https://www.presbyportal.org/api/auth/callback/google`)
   before this can be wired up and smoke-tested.
2. **Resend** — `RESEND_API_KEY` not set; email queue will back up
   (password reset/verification) once real users exist. Not launch-blocking
   for a browse-only demo.
3. **Real first content ingest for `site-fpcw`** — `organization_sites`'s
   `last_ingested_commit_sha` for `fpcw` is a scratch/test placeholder
   string, not a real git SHA. Production is also missing
   `SITES_INGEST_OIDC_AUDIENCE`/`GITHUB_SITES_ORG`, which the ingest
   endpoint needs to verify a GitHub Actions OIDC token from `site-fpcw`'s
   own repo — a real first ingest would fail auth today the same way the DB
   connection did.
4. **Church data import** — no import feature exists yet
   (`docs/TODO.md`'s "Presbytery Increment 5 — imports and reports" is an
   unscoped backlog item). Needs its own Phase 1 before any real roll data
   moves, or a carefully-invariant-respecting one-off script if that's
   preferred instead.

#### Also this session

- A local demo of `/site/fpcw` was run off the `development` branch via
  `npm run dev -- -p 3001` (LAN-reachable at `192.168.1.55:3001`). Server
  has since been stopped; nothing left running.

---

### 2026-08-24 — public-site testing, org-access bug fix, Westerville site recreation

Mid-session restart. Three things happened this session, in order, and the
third is **in flight, blocked on the user, not on Claude**.

#### 1. Public-site manual testing — shipped, verified live

Set up a local, browsable instance of the P3 public-site feature
(`/site/<slug>`) using a synthetic "Alder Creek Presbyterian Church" /
"Fixture Hollow" fixture staged in the **local dev database only** — no
migration, no seed script, no repo change. **Left staged on purpose**; do
not revert until the user says they're done testing.

Found and fixed three real defects in `presby-site-kit` (the external,
separately-versioned component-library repo — NOT this repo), each verified
against a real running server, not just unit tests:

- **v3.1.0–v3.1.1**: the package had never had any CSS at all. Wrote a real
  stylesheet (`src/styles.css`, plain CSS, brand-aware via
  `var(--primary)` etc., same DECISION-046 cascade-override model this repo
  already uses); fixed a CSS-Grid auto-placement bug in `Callout`.
- **v3.2.0**: every content-authored internal link (FeatureGrid cards,
  Hero/Callout CTAs, EventList entries, DonateLink) rendered as a raw
  bundle-relative path instead of being resolved through the `pageUrl`
  closure `Nav` already used — a "Worship" card 404'd against presby's own
  root instead of landing on `/site/<slug>/worship`. Also added the
  package's first `@media` breakpoints (it had none).
- **v3.3.0**: the "responsive" nav from v3.2.0 only stopped overflow, it
  didn't actually collapse — rebuilt `Nav` as the package's one client
  component with a real hamburger toggle (`aria-expanded`, closes on link
  click). Hit and fixed a real RSC boundary bug along the way (a closure
  prop can't cross into a client component — resolved nav hrefs
  server-side into plain data instead).

All three pushed and tagged in `presby-site-kit`. presby's own
`package.json`/`package-lock.json` were pinned to v3.3.0 at the time, later
bumped to v3.4.0 (below) and further since.

#### 2. Bug fix — org-access-denied pages had no link back to the public site

User report: from the member-login flow, landing on the access-denied /
relationship-ended pages under `/o/<slug>` had no link back to the public
site (only "Back to your organizations"). Confirmed real via code read; the
"no sign-out option" half of the same report was checked live and found to
be a false alarm.

Fixed: `OrgAccessDenied` / `OrgAccessEnded`
(`src/app/(org)/o/[slug]/org-states.tsx`) gained a `slug` prop and a second
"Visit the public site" button → `/site/<slug>`. Shared by seven pages, all
updated. Full pipeline followed (bug-fix variant), two new regression tests,
verified live via a real sign-in. Landed in a later commit.

#### 3. Westerville First Presbyterian site recreation — org provisioned, real photos migrated

User wanted to recreate the congregation's existing website on
presby "as verbatim as possible." Confirmed: authorized to use the real
content (their own church); Claude does not scrape the live site — content
came from a real WordPress `Tools → Export` XML the user supplied.

**presby-site-kit bumped to v3.4.0** — two real gaps found building against
this real site's actual content: `featureGrid`/`valuesGrid`/`ministryList`
items gained an optional `imageUrl`/`imageAlt`, and a new `gallery` block
(single-image auto-playing carousel with `prefers-reduced-motion` support,
site-kit's second client component after `Nav`).

**New private content repo pushed**: `github.com/chenson42/site-fpcw`
(confirmed `PRIVATE`), org slug `fpcw`. 14 pages migrated by hand from the WP
export, every block validated by actually rendering it through
`renderSiteBundle()`.

**Deliberately dropped or degraded, noted in `site-fpcw`'s own README**:
Gravity Forms (presby's own `<ContactForm>` covers this); per-department
`?subject=` query-param routing (inert until presby's contact form reads
one); Upcoming Events' live Google Calendar embed (thin page links out
instead); one image with no accompanying text.

**A real blocker turned up provisioning this: presby had no way anywhere to
create a new `organizations` row.** Built it properly through the full
pipeline — `docs/work-log/2026-08-24-admin-org-create.md`:
`/admin/organizations/new`, `src/lib/org-provisioning.ts`
(`createOrganization()`), `src/lib/reserved-slugs.ts`, F16 derived-group
seeding folded into the same transaction. Two real bugs found and fixed
building it, both tracked forward at the time.

**Using the shipped feature, the real organization now exists** in the dev
database at the time: First Presbyterian Church of Westerville, slug `fpcw`,
type `congregation`, platform status `managed`, with real profile data
entered (redacted from this file per the No Real Data invariant, now that
this repo is public — the dev database itself is not public and is
unaffected by this redaction).

**Still open at the end of this session** (see the sessions above for later
resolution status): the two GitHub repo variables `site-fpcw` needs for a
real ingest; confirming `sites.public_render` being on was intentional; the
`site-<slug>` content-repo visibility TODO line; the first real ingest
turning `/site/fpcw` from 404 to live.
