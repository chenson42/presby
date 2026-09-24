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
| E4 | **Contribution statements** (`ledger_acknowledgments` + `ledger_letter_templates` precedent) — IRS Pub 1771, **due each January**, which is also the cutover month (§4.10) |
| E5 | Reimbursement / payments out — committee approval routing, treasurer-only `paymentInfo`, attachments, PDF receipts, append-only event log |
| E6 | Budgets, bank reconciliation |

Needs its own Phase 1. **Compare fpcw's `payment_requests` against
`ledger_reimbursements` before designing E5** — two references, pick deliberately.

⚠️ **E4 and the cutover collide.** A January 1 switch means the first
contribution statements FPCW owes after cutover cover a year recorded in
Church360/Vanco, not presby. Either presby generates statements from **imported**
prior-year data (so H2 must import gift-level history, not just balances), or
FPCW issues that year's statements from the old system and presby's first
statement year is the *following* January. **Decide this before H2's scope is
fixed** — it changes what the import must carry.

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

1. **Is worship really a "quick followup"?** Classified as one (answer 1), but it
   is **12 tables and ~7,400 lines** — services, templates, role assignments,
   holidays, attendance, external participants. Worth confirming that FPCW uses
   only a small slice of it, because from the schema it reads like a track.
2. **The E4 / cutover statement collision** (§Track E). Does presby generate the
   first post-cutover contribution statements from imported prior-year gift
   history, or does FPCW issue that year's from the old system? **Decides whether
   K2 must import gift-level detail or only opening balances.**
3. **Vanco integration depth** — settled-transaction import only, or hosted
   payment pages / recurring-gift management too? Sets E2's size.
4. **Youth vs children's ministry** — presby already has `src/lib/children.ts`
   and a children's-ministry increment plan. Is FPCW's youth module the same
   need at a different age band, or genuinely separate? Determines whether G1
   extends existing work or is new.

### Answered and settled

Vercel/account (1–2) · OAuth + Resend deferred (3–4) · reimbursement, groups
on-call, youth, mailchimp in scope (5, 1) · white-binder last (6) · Drive
link-only (7) · `fpcw.us` admin access (8) · test domains needed; two-domain
setup (9) · industry-standard credential split (10) · generalize role addresses
(11) · Church360→presby SoR (12) · no general importer (13) · custom domain
required day one (2) · calendar-year cutover (3) · Vanco (4) · extend the brand
vocabulary (5) · light-only, already supported (6) · local screenshot reference
(7) · reviews after planning (8) · commit the work (10).
