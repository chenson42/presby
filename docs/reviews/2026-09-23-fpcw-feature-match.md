# FPCW Replacement — Feature Match & Program Plan

**Created** 2026-09-23 · **Updated** 2026-09-24 with operator answers 1–13.

**Sources:** `~/git/fpcw-directory` @ `e988e83` (releases v2.15.00–v2.15.52,
2026-09-01 → 2026-09-19) · `~/git/westervillelions` (ledger prior art).

> `CLAUDE.md`'s prior-art table points at `../fpcw-directory` and
> `../westervillelions`. Both now live at `~/git/<repo>`, not beside `presby`
> under `~/git/presby-platform/`. **Stale paths, worth correcting.**

---

## 1. What this is

presby will **replace fpcw-directory for FPCW**, and become FPCW's **system of
record for members and finance** (today: Church360). There is **no deadline** —
the operator's instruction is to build it right.

That combination is the single most important framing in this document. A
replacement under deadline would port fpcw's schema column-for-column and defer
presby's own debt. With no deadline and a system-of-record obligation, the right
move is the opposite: **fix the foundation, design rather than port, and let
presby's multitenant generality win wherever it disagrees with fpcw's
single-tenant shape.**

## 2. Confirmed scope

| Area | In scope | Notes |
|---|---|---|
| **Directory** | ✅ | presby is **ahead** of fpcw here |
| **Groups** | ✅ | incl. **on-call scheduling** — a real used feature, not a footnote |
| **Reimbursement** | ✅ | ~6,700 lines, 3 tables + 4 enums. Part of Finance |
| **Finance / giving** | ✅ | presby becomes SoR. **presby has nothing today** |
| **Calendar / meetings / rooms** | ✅ | the Google Calendar ask |
| **Google Groups sync** | ✅ | the Google Groups ask |
| **white-binder** (Android kiosk) | ✅ | **last item before go-live** |
| **Google Drive** | ⚠️ link-only | fpcw has **no Drive API client** — see §4 |
| **Public website** | ✅ in progress | `site-fpcw`, recreating `westervillefirstpresbyterian.org` |
| **Youth** | ✅ | ~8,400 lines, 5 tables — its own track |
| **Mailchimp sync** | ✅ | ~2,300 lines, 2 tables |
| **MAP** | ❌ | already retired by fpcw itself (v2.15.22 / v2.15.25) |
| worship · insights · photo-uploads · talents | ✅ *"quick followups"* | ⚠️ **worship is 12 tables / ~7,400 lines — that does not look quick from here.** Size it before committing to that classification (§9 Q1) |

**Deferred by operator decision:** production go-live, Google OAuth for sign-in,
Resend email (answers 3–4). Not on the near-term path.

## 3. Where presby actually stands

### Ahead of fpcw

- **Directory**: `person_privacy` + the three-tier model beats fpcw's boolean
  `hideEmail`/`hidePhone` flags.
- **Contact model**: `contact_methods(kind, subtype, isPrimary)` beats fpcw's
  denormalized `email`/`emails`/`emailWork`/`phoneMobile`/`phoneWork`.
- **Group core**: composite tenant keys, the `source` discipline,
  trigger-materialized derived Session/Diaconate rosters (F3), `officerTermId`
  1:1 mapping (F22). **Do not give any of this up for parity.**
- **Public site**: site-kit + `site-fpcw` already doing visual-parity work.
- **`opening_balance` roll action already exists** — exactly the migration-safe
  kind an import needs. Vocabulary present, no surface produces it yet.

### Behind fpcw

fpcw has **78 tables** (not 63 — an earlier count here missed the multi-line
`pgTable(\n "name",` form). The gaps:

| presby | Missing |
|---|---|
| `groups` | `slug`, `parentGroupId`, `isActive`, `isPrivate`, `resources`, Google columns, role-sync toggles, `allowsGuests`, `updatedAt`, `createdById` |
| `group_types` | the capability flags that *drive behavior*: `autoCreateGoogleGroup`, `supportsOnCallRotation`, `tracksAttendance`, `requiresBackgroundCheck`, `sortOrder` |
| — | `group_meeting_schedules`, `group_guests`, `group_sync_jobs`, `group_on_call_shifts`, `rooms`, `event_types` |
| `events` | **16 columns vs fpcw's 43** — `groupId`, `roomId`, `eventTypeId`, and all Google sync state |
| finance | **everything.** `/admin/giving` is an inert placeholder: *"no data read, no mutation"* |
| org sites | **no custom-domain support** — see §5 |

**`groups.meetsWhen` is free text.** It cannot drive a calendar. Hardest
structural blocker for Google Calendar.

## 4. Design decisions already settled

Recorded here so they don't get re-litigated.

1. **Google auth: OAuth admin-consent, NOT service-account domain-wide
   delegation** (answer 10 — "follow industry standards"). fpcw pastes a private
   key into `app_settings`; correct single-tenant, an **anti-pattern**
   multitenant — presby would hold a key that can impersonate any user in a
   customer's domain, not revocable by them. Instead: presby is one Google Cloud
   OAuth app; each congregation's Workspace admin grants domain-wide consent;
   presby stores a **per-org refresh token**. Client secret → env (platform).
   Refresh tokens → encrypted tenant table (org-level). Matches the operator's
   own split exactly, and is a survivable secret rather than a catastrophic one.
   *Consequence: sensitive scopes require Google app verification — real lead
   time, start early.*
2. **Drive: link-only.** fpcw has **no Drive API client at all** —
   `googleDriveFolderId`/`autoCreateDriveFolder`/`driveFolderTemplate` are stored
   and displayed but never called; FPCW uses Drive directly (answer 7). So: a
   per-group Drive link field, values carried across at import. **No Drive API,
   no Drive scope, no auto-creation.** One fewer integration.
3. **Role addresses: generalized** (answer 11). fpcw's two hardcoded toggles
   (`includePastorInGoogleSync`, `includeAdminAsstInGoogleSync`) become "which
   roles' addresses join this group's mail," driven by `role_grants`. fpcw
   hardcoded them because it has no permission resolver; presby has one.
4. **No general importer** (answer 13). Onboarding imports are ad-hoc via Claude
   Code, per congregation. This also dissolves the **No Real Data** tension:
   one-off scripts are *operational*, not product, so they live in
   `private/`/`scratch/`, not the repo.
5. **Visual parity yes, layout parity no.** See §6.
6. **Design, don't port.** fpcw's schema is a requirements document. Its
   `isActive` boolean is the odd one out in a model that is dated and
   append-only everywhere else; its `recurrencePattern` duplicates
   `src/lib/events/recurrence.ts`; its `group_guests` cap of 25 is an arbitrary
   product number to re-decide, not inherit.
7. **Brand vocabulary gets extended, not worked around** (answer 5 — "we'll want
   flexibility"). B1 proceeds: open `contract.ts`'s partition for the card,
   popover, border, muted and radius roles. Architect-led, since the closed
   partition is an enforced invariant, not a convention.
8. **FPCW is light-only** (answer 6). **No work needed** —
   `organization_brands.light_only` already exists (`drizzle/0023_presby_brand_light_only.sql`,
   `src/lib/db/domain/org.ts:208`). Set the flag and FPCW never renders dark.
   Dark mode as a per-congregation operator choice stays a separate TODO item.
9. **Custom domain is required at cutover, day one** (answer 2). Track F is a
   **hard blocker**, not a later nicety. See §5a.
10. **Cutover at the calendar-year boundary** (answer 3 — FPCW's fiscal year ends
    then). That is a **January 1** switch, which makes §5b's contribution-statement
    constraint a scheduling fact rather than a caution.
11. **Giving runs through Vanco** (answer 4), not Church360 alone. So Track E needs
    a **Vanco integration** — at minimum importing settled transactions into the
    ledger, possibly hosted-payment handoff. Vanco is a real third-party
    integration to scope, with its own credentials (platform- or org-level per
    §4.1's split) and its own reconciliation semantics. **Not just a ledger.**
12. **Screenshot reference runs locally** (answer 7). fpcw-directory ships a
    `docker-compose.yml` with Postgres 16, so B3 diffs against a local instance —
    production is never touched.
13. **Hard cutover, and deferral means non-use.** *Operator, 2026-09-24: "if I
    deferred func then it is func that isn't used."*

    This is the structural decision the rest of the plan hangs on, so it is worth
    stating precisely. fpcw-directory **goes dark at the cutover** — it is not
    kept alive to serve anything. Therefore anything scheduled **after** the
    cutover is, by definition, **functionality FPCW does not use today**: it is
    new presby product, not replacement parity.

    Why this matters beyond scheduling: had any deferred feature been in real use,
    keeping fpcw-directory alive for it would mean **two systems holding one
    congregation's data with divergent truth.** Once presby is the member system of
    record, fpcw-directory's `members` table is frozen — and every deferred feature
    reads members (`worship_role_assignments.memberId`, `event_signups.memberId`,
    `member_talents.memberId`, and `payment_requests`' three member FKs plus
    `committeeGroupId`). That is the dual-Google-sync hazard (⚠️ 1) generalised to
    all member data. The operator's rule removes the hazard entirely rather than
    managing it, which is why it is the right rule.

    **The pre-cutover list is therefore the definition of "what FPCW uses."** A
    feature can only move across that line by changing that claim.

## 5. Newly discovered blockers

### ⚠️ 5a. Custom domains for org sites — not on the plan, and required

FPCW uses **two domains**: `fpcw.us` (Workspace, email, Google groups) and
`westervillefirstpresbyterian.org` (public website — `site-fpcw`'s recreation
target, 78 WordPress images sourced from it).

`organization_sites` is `(organizationId, repo, status, lastIngestedCommitSha,
lastIngestedAt, contentBundleKey, updatedBy, …)` — **no custom-domain column.**
Sites are reachable only at `/site/<slug>`. CLAUDE.md's P5 describes a *platform
subdomain label* (`fpcw.presbyportal.org`), which is still not a customer apex
domain. FPCW will not accept their site moving to `presbyportal.org/site/fpcw`.

**The architectural wrinkle:** resolving host → org needs a database lookup, and
**`src/proxy.ts` is Edge and cannot reach the database** (a named invariant). So
host resolution must live somewhere other than the Edge gate — a route handler,
an Edge Config map, or Vercel rewrites. Architect question; expensive to discover
late.

### ⚠️ 5b. Finance is a program, not a track

presby has **zero** financial tables. Becoming FPCW's finance SoR means building
the domain from scratch — and it carries a **hard compliance requirement**:
year-end contribution statements meeting IRS substantiation rules (Pub 1771 —
written acknowledgment for gifts ≥ $250 with the "no goods or services"
language). Non-negotiable, annual January deadline.

**Strong prior art exists.** `~/git/westervillelions` has ~26 `ledger_*` tables:
funds, transactions, categories, donors, budgets + approvals, bank accounts +
lines, reconciliation sessions + matches, filings, audit log, settings — plus
**`ledger_acknowledgments` and `ledger_letter_templates`** (contribution
statements, already solved once) and **`ledger_reimbursements`** (a second
reimbursement reference alongside fpcw's `payment_requests`).

It also carries **`google_group_sync_log`** — a *second* Google Groups sync
implementation to compare against fpcw's before designing presby's.

**Therefore: cut over at a fiscal-year boundary.** A mid-year finance cutover
splits one year's contribution statements across two systems and hands FPCW's
treasurer a reconciliation problem.

### ⚠️ 5c. Live production credentials in an abandoned account

`presbyportal.org` is attached to **both** Vercel projects (`presby` and legacy
`presby-portal`) inside `community-collective`, the account with impaired access.
`presby` has **zero env vars**; the live site returns 200 with real content — so
**legacy `presby-portal` is what's actually serving**, holding valid `presby_app`
credentials for the live production database. `docs/STATE.md`'s account of
resetting those on `presby` does not match what is deployed.

DNS is at GoDaddy (`ns07/ns08.domaincontrol.com`), independent of Vercel.

**Sequencing: stand up the new project → repoint DNS → then rotate the Neon
password.** Rotating first takes `presbyportal.org` down. Since the site is
currently only a demo, rotation looks safe rather than disruptive.

Also: Neon project `presby-portal` (`silent-cloud-95940340`, ~39 MB) is legacy
**but holds data to port** (answer 2). Do not delete.

## 6. Look and feel

fpcw-directory is **shadcn/ui on Tailwind v4 with the same token names as
presby** (`--primary`, `--card`, `--muted`, `--border`, `--radius`, sidebar and
chart tokens). Its brand is a hand-written ramp off the logo — `#60a7a1`, sage
green/teal — which is exactly what `src/lib/brand/generate.ts` produces. So
FPCW's identity is reachable by **configuring an org brand**, not rewriting
components.

**Three blockers, all in `src/lib/brand/contract.ts`:**

| Policy | Tokens |
|---|---|
| brandable | `--primary`, `--primary-foreground`, `--ring`, `--brand-raw`, `--brand-raw-foreground`, `--font-heading`, `--font-body` |
| bounded | `--accent`, `--accent-foreground`, `--background`, `--foreground` |
| **platform** (not brandable) | `--card`, `--card-foreground`, `--border`, `--input`, `--muted`, `--muted-foreground`, `--secondary`, `--popover`, `--radius`, every semantic colour |

1. **Card/border/muted/secondary/popover/`--radius` are platform-only.** Matching
   fpcw there is a **contract change**, and the partition is deliberately closed
   (*"unlisted is not brandable… a test fails when one appears"*). `docs/TODO.md`
   already names this: *"The brand role vocabulary cannot express the card and
   popover surfaces."*
2. **`--font-heading`/`--font-body` are declared brandable but nothing consumes
   them** (also in TODO) — typography parity is currently **inert**. fpcw uses
   **Geist**, not one of the four curated pairings.
3. **Most of the portal is deliberately un-brandable** (DECISION-047): only
   `(org)` and `(public)/site/<slug>`. fpcw is single-tenant so *every* page there
   is teal, including sign-in. **presby's `/signin` will look like PresbyPortal —
   a designed refusal, not a gap**: a branded 403 tells a prober that an org is a
   configured tenant.

**Scope call: visual parity yes, layout parity no.** Same colour, type and
component feel; navigation free to grow past fpcw-directory's shape. Chasing
layout parity would cap presby's IA at the app it replaces, contradicting
"functionally much richer."

## 7. The plan

**Two lines divide this plan**, both operator decisions:

- **A presbytery-first go-live** may precede FPCW entirely — `psvonline-portal`'s
  functionality, which the Presbytery of Scioto Valley is now asking for. It needs
  almost none of the FPCW program. See §7.0.
- **The cutover line** (§4.13): everything below it is functionality FPCW does not
  use, and is therefore new product rather than parity.

### Pre-cutover — what FPCW uses

Track 0 (hygiene) · A (groups & calendar) · B (visual parity) · C (directory) ·
D (Google Workspace) · **R (reimbursement)** · F (custom domains, hard blocker) ·
G (youth) · H (mailchimp) · I (kiosk, last)

### Post-cutover — new product

Finance program: ledger · Vanco · giving · contribution statements · budgets ·
reconciliation. Then worship · insights · photo-uploads · talents.

Because finance lands after the cutover, **the system-of-record transition is two
events, not one**: members at the FPCW cutover, finance whenever the ledger ships.
The January-1 fiscal-boundary constraint therefore binds the **finance** cutover
only — which frees the member cutover to happen whenever it is ready, and
dissolves the contribution-statement collision (FPCW issues that year's statements
from Church360/Vanco, as it does today).

### 7.0 Track P — presbytery-first *(possible first go-live)*

`~/git/psvonline-portal` (29 tables, ~27k lines, v0.3.16, last touched
2026-08-11) deploys as the **`presby-portal` Vercel project and the legacy
`presby-portal` Neon database** — the ~39 MB project of answer 2, holding PSV's
real prototype data.

**The gap is almost entirely UI, not schema.** An earlier draft of this document
understated presby's presbytery schema; corrected here.

presby already has:

- **`congregation_oversight`** — `organizationId` (the presbytery holding the
  record) **+ `aboutOrgId`** (the congregation it concerns). This is exactly the
  right pattern: presbytery-**owned** rows *about* another org, which satisfies
  *"access flows up by publication, never down by inheritance"* without the
  presbytery reading into a congregation's own tenant data. It already carries
  `viabilityScore`, `redevelopmentNotes`, `buildingsNotes`, `insuranceCarrier`,
  `insuranceExpiresOn`, `latitude`, `longitude`.
- **`congregation_statistics` — the full SASR**, ~70 columns: gains/losses,
  demographics (gender, age, race, disability), officer counts, baptisms, youth
  bands, average worship attendance, receipts, expenses, budget. **With
  `provenance`, `supersedesPublicationId`, `publishedAt`, `minuteReference`** —
  the publication and supersession model is already designed.
- `per_capita_rates`, `per_capita_records`, `organization_service_times`,
  `organization_profiles`.
- **Real** (not placeholder) routes: members, officers, groups, staff,
  **credentials**, roles, events, features, branding.

Every presbytery-facing route is nonetheless an **inert placeholder**:
`/admin/oversight`, `/admin/reports`, `/admin/committees`, `/admin/insights`.

**Genuine schema gaps vs psvonline:**

| Gap | Note |
|---|---|
| Congregation profile fields | `pcusaPin`, `standardName`/`officialName`, address, county, phone/email/website, `yearOrganized`, `congregationType`, `status`. `organizations` carries only id/slug/name/type/parent |
| Multi-property buildings detail | psvonline's `congregation_buildings` is 26 columns per property (appraised value, square footage, addition years). presby has a single `buildingsNotes` text field — a real gap **if** PSV tracks properties per church |
| Presbytery committees | `committees`, `committee_assignments`, `appointments`. presby has groups + officer terms, but `/admin/committees` is a stub *(= Increment 1)* |

Covered without new schema: services (`organization_service_times`), credentials
(`/admin/credentials` is real), ideas (feedback/tickets), per capita.

| | Work |
|---|---|
| P1 | Congregation profile fields + buildings detail *(scope depends on §9 Q3)* |
| P2 | Presbytery committees + assignments + appointments *(= Increment 1)* |
| P3 | Make `/admin/oversight` real over existing `congregation_oversight` |
| P4 | Statistical publication over the existing SASR model *(= Increment 4a)* |
| P5 | Presbytery dashboard / rollups *(= Increment 4b)* |
| P6 | Reports + per-capita surfaces *(= Increment 5)* |
| P7 | Port PSV's prototype data from the legacy Neon project |

**Roughly 4–6 pipelines**, and mostly ux/api work over schema that already exists
rather than new tables. Increments 1/4a/4b/5 are already named in `docs/TODO.md`
as "ready to build."

### ⚠️ Two model conflicts to resolve before P1

1. **psvonline's congregations are reference rows, not tenants.** Its
   `congregations` table is org-scoped (`organizationId`) and separate from
   `organizations` — the presbytery owns ~N congregation rows. presby's model makes
   each congregation **its own tenant organization**, with the presbytery holding
   `aboutOrgId` rows concerning it. The port is therefore a **model translation,
   not a data move**, and it forces a decision: does every PSV congregation get
   provisioned as an organization (presby's model, ~80 orgs nobody logs into
   initially), or do congregations stay reference rows under PSV's org (simpler,
   but diverges from the hierarchy and breaks the path for a congregation to
   become a real tenant later)? `congregation_oversight.aboutOrgId` implies the
   former.
2. **psvonline's `people` is org-scoped; presby's `people` is GLOBAL.** A person
   is a person regardless of which church is looking. So porting PSV's people
   risks **duplicating individuals who are also FPCW members** — a pastor can
   plausibly exist in both datasets. P7 must run through
   `presby_match_person()` / `matchPerson()`, not a straight insert.

**Why this is a strong candidate to go first:** it needs **none** of Track D
(Google), E (finance — psvonline tracks per capita with plain amount-paid columns,
not double-entry), F (custom domains — the org portal lives at `/o/<slug>` on the
platform host; only public *websites* need custom domains), G, H or I. It is
Track 0 + Track P, with B and C as polish. And it exercises multitenancy, RLS and
the org hierarchy against a real tenant **before** FPCW's system of record depends
on them.

### Track 0 — Foundation hygiene · *do first, gates Track A*

| | Work |
|---|---|
| 0a | **`security` review** (overdue) — lands before any credential-storage design |
| 0b | **`code` review** (overdue) — home for the defects below |
| 0c | Close **DECISION-060** (`group_memberships.officer_term_id` has **no FK at all**, `groups.ts:113` — the exact F2 gap) + **`group_types` unique constraint on `(organization_id, key)`** (`groups.ts:40` is a plain index; `sites.test.ts` already relies on `.onConflictDoNothing()` against it) |
| 0d | `drizzle/0033` widened DELETE-branch trigger blocking a live org's cascade-delete |

**Why 0c gates Track A:** Google Groups sync reads `group_memberships` to compute
desired membership. A missing composite FK there stops being a latent smell the
moment it becomes *a real person receiving another congregation's mail.*

### Track A — Groups & calendar schema · *database-admin*

| | Work |
|---|---|
| A1 | `groups`: hierarchy (composite FK + cycle guard), activation, privacy, guests-allowed, Google columns, Drive **link** field |
| A2 | **`group_meeting_schedules`** — retires `meetsWhen`; **reuse `src/lib/events/recurrence.ts`** |
| A3 | `group_guests`, `group_sync_jobs` |
| A4 | **`group_on_call_shifts`** + `group_types.supportsOnCallRotation` + rotation logic |
| A5 | `rooms`, `event_types`, `events.groupId/roomId/eventTypeId` + sync-state columns |

No Google dependency. No Workspace needed to test.

### Track B — Visual parity · *parallel, independent*

| | Work |
|---|---|
| B1 | Extend the brand role vocabulary to card/popover/border/muted + `--radius`. **Architect-led — a `contract.ts` change** |
| B2 | Make `--font-heading`/`--font-body` load-bearing; add a Geist-class pairing |
| B3 | Configure FPCW's brand (`#60a7a1`); screenshot-diff `(org)` at 360px + desktop, both schemes |
| B4 | Record the DECISION-047 consequence so the un-branded sign-in is a known trade |

### Track C — Directory quick wins · *any time, small*

- **C1** work-vs-personal email precedence. Model is ready; needs a **per-org
  work-email-domain config** (`fpcw.us`), mirroring fpcw's v2.15.34.
- **C2** member's groups on their directory profile.
- **C3** groups search (fpcw's is 28 lines).

### Track D — Google Workspace · *gated on Track A + §4.1*

| | Work | Depends on |
|---|---|---|
| D1 | OAuth app + admin-consent flow + per-org encrypted refresh tokens | 0a |
| D2 | Google Groups sync — job queue, `skipReason`, **domain guard**, **adopt-not-create** | A1–A3, D1 |
| D3 | Calendar meeting invitations — RRULE on a secondary calendar, per-row sync state | A2, A5, D1 |

Developed against a **test Workspace domain** (needs creating — answer 9), never
`fpcw.us`. ⚠️ **The domain guard ships with D2, not at cutover.**

### Track E — Finance & reimbursement · *the largest program*

| | Work |
|---|---|
| E1 | Fund-accounting core, designed against `westervillelions`' `ledger_*` prior art |
| E2 | **Vanco integration** — settled-transaction import into the ledger, and its credentials/reconciliation semantics (answer 4) |
| E3 | Giving / contributions recording (what Vanco doesn't originate: cash, check, stock) |
| E4 | **Contribution statements** (`ledger_acknowledgments` + `ledger_letter_templates` precedent) — IRS Pub 1771 |
| E5 | **Treasury half of reimbursement** — the `approved → paid` transition, the treasurer-only `paymentInfo`, and disbursement recording. See Track R for the pre-cutover half |
| E6 | Budgets, bank reconciliation |

Needs its own Phase 1. **Compare fpcw's `payment_requests` against
`~/git/westervillelions`' `ledger_reimbursements` before designing E5** — two
references, pick deliberately.

Because finance is post-cutover, FPCW continues issuing contribution statements
from Church360/Vanco for the cutover year, exactly as it does today. No statement
collision, and **the import need not carry gift-level history** — only what the
member record requires.

### Track R — Reimbursement, request through approval · *pre-cutover*

**Necessary for cutover** (operator), **but not the full treasury functionality.**
fpcw's lifecycle is `draft → submitted → approved → paid` (+ `returned`, `void`),
and the treasury seam is precisely `approved → paid`. Track R stops at `approved`.

| | Work |
|---|---|
| R1 | Request creation, incl. **on-behalf-of**; `payeeMemberId` / `requestedByMemberId` / `createdOnBehalfByMemberId` |
| R2 | Committee approval routing + pre-approving-elder capture; `returned` (`needs_info` / `denied`) and `void` |
| R3 | Attachments + receipt images, PDF request output |
| R4 | Append-only request event log (`payment_request_events`) |

**Why this works without a ledger:** fpcw runs a complete reimbursement system
with **no ledger at all** — `budgetCategory` is free text, not a ledger reference.
So Track R is genuinely independent of Track E.

Two design notes for forward compatibility:

- **Keep `paid` in the status enum from day one** even though nothing transitions
  to it. `approved` is a legitimate terminal state for now — the treasurer writes
  the cheque outside presby, as they do today. Shipping the enum complete avoids
  an enum migration mid-flight when E5 lands.
- **Do not build `paymentInfo` pre-cutover.** It is the treasurer-only field fpcw
  deliberately excludes from every list query (their Phase 2 Ruling 4). Not
  building it is strictly safer than building it unused, and it belongs with E5.
- Design `budgetCategory` so it can later *reference* a ledger budget line without
  rewriting history.

### Track F — Custom domains · ⚠️ *hard blocker, required day one of cutover*

- **F1** Per-org custom domain for public sites, with host→org resolution that
  respects the Edge-cannot-reach-the-database invariant. **Architect-led.**
- **F2** Programmatic Vercel domain attachment + TLS per tenant.

### Track G — Youth · *its own track*

- **G1** Youth registrations, families, check-in (`youth_registrations`,
  `youth_families`, `youth_checkins`, `youth_registration_history`,
  `youth_settings` — ~8,400 lines). Overlaps presby's existing children's-ministry
  work (`src/lib/children.ts`) — **reconcile the two before designing**, don't
  build a parallel model.

### Track H — Mailchimp sync

- **H1** Member → Mailchimp audience sync (`mailchimp_sync_log`,
  `mailchimp_sync_progress`, ~2,300 lines). Interacts with `person_privacy` and
  `contact_methods.doNotContact` — an opt-out must be honored *outbound*, which is
  a privacy-invariant question, not just an API call.

### Track I — white-binder kiosk

- **I1** Android kiosk parity (`kiosk_devices`, `kiosk_guests`,
  `kiosk_pairing_codes`, ~3,200 lines). **Last before go-live** (answer 6).

### Track J — Quick followups *(operator-classified)*

- worship (⚠️ 12 tables / ~7,400 lines — verify this is really quick), insights,
  photo-uploads, talents.

### Track K — Cutover · *January 1*

- **K1** Inventory FPCW's live Workspace as the reconciliation baseline *(near
  cutover — a snapshot now goes stale)*.
- **K2** The **three-source** import: **Church360** (members, finance),
  **Vanco** (settled giving history), **fpcw-directory** (groups, memberships,
  officer/staff terms, reimbursement, on-call, Google group mappings, Drive
  links), joined on `church360Id`. Every member gets an honest
  **`opening_balance`** roll action, never a fabricated `profession_of_faith`.
  Script lives in `private/`, not the repo. **Scope depends on the E4 statement
  decision above.**
- **K3** The switch — disable fpcw-directory's sync, flip the handover, reconcile
  against K1. **At the calendar-year boundary** (§4.10).

### Deferred by operator decision

Production go-live · Google OAuth sign-in · Resend (answers 3–4). The new Vercel
project stands up when convenient; **the Neon credential rotation (§5c) is a
security item, not a go-live item.**

## 8. Dependency spine

```
0c ─> A1 ─> A3,A4 ──┐
      A2 ─> A5 ──────┼─> D2/D3 ──┐
0a ─> D1 ────────────┘            │
                                  ├─> K3  (January 1)
E1 ─> E2 ─> E3 ─> E4 ────────────┤
      E5, E6                      │
F1 ─> F2  (hard blocker) ────────┤
G1, H1, I1, J ───────────────────┘
                          K1,K2 ┘  (near cutover)

B1..B4   independent  ────────────────
C1..C3   independent  ────────────────
```

**Reviews (0a/0b) run after planning is complete** (answer 8), before
implementation starts — D1's credential design should not precede the security
review.

**Immediate next:** finish planning → `security` + `code` reviews → schema-defect
pipeline (0c) → A2 and B1 in parallel.

## 9. Open questions

**Presbytery-first (blocks Track P)**

1. **Is presbytery-first the decision, or still under consideration?** The operator
   said PSV "might even go live before fpcw." Formally sequencing P ahead of the
   FPCW tracks changes what gets built next.
2. **Are PSV's congregations provisioned as tenant organizations, or kept as
   reference rows under PSV's org?** See §7.0's model conflict 1. Decides P1's
   shape and the size of the provisioning story.
3. **Does PSV track per-property building detail** (appraised value, square
   footage, addition years — psvonline's 26-column `congregation_buildings`), or is
   `congregation_oversight.buildingsNotes` sufficient? Largest single driver of
   P1's size.
4. **Does PSV need a public website?** If yes, Track F (custom domains) becomes a
   presbytery-first blocker too, not just an FPCW one.
5. **Do PSV committees need Google Groups mailing lists?** If yes, part of Track D
   moves ahead of the FPCW work.
6. **Who are PSV's users** — presbytery staff only, or congregation clerks
   submitting statistics? The latter means congregations must be real tenants with
   real logins (see Q2), which is a much larger onboarding story.

**FPCW**

7. **Youth vs children's ministry** — presby already has `src/lib/children.ts` and
   a children's-ministry increment plan. Is FPCW's youth module the same need at a
   different age band, or genuinely separate? Decides whether Track G extends
   existing work or is new.
8. **Vanco integration depth** — settled-transaction import only, or hosted payment
   pages / recurring-gift management? Sets E2's size. *Low urgency: post-cutover.*

### Resolved by the cutover rule (§4.13)

- *Is worship really a "quick followup"?* — **Moot.** Worship is post-cutover,
  therefore not functionality FPCW uses. No scoping risk.
- *The contribution-statement collision* — **Dissolved.** Finance is post-cutover,
  so FPCW issues statements from Church360/Vanco as it does today, and the import
  need not carry gift-level history.
- *Reimbursement in or out* — **In, pre-cutover**, request through approval only;
  the treasury half (`approved → paid`, `paymentInfo`) goes with Track E.

### Answered and settled

Vercel/account (1–2) · OAuth + Resend deferred (3–4) · reimbursement, groups
on-call, youth, mailchimp in scope (5, 1) · white-binder last (6) · Drive
link-only (7) · `fpcw.us` admin access (8) · test domains needed; two-domain
setup (9) · industry-standard credential split (10) · generalize role addresses
(11) · Church360→presby SoR (12) · no general importer (13) · custom domain
required day one (2) · calendar-year cutover (3) · Vanco (4) · extend the brand
vocabulary (5) · light-only, already supported (6) · local screenshot reference
(7) · reviews after planning (8) · commit the work (10).
