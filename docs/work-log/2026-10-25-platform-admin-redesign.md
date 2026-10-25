# Platform admin redesign: dashboard, navigation, organization workspace — Work Log

> **Slug:** `2026-10-25-platform-admin-redesign`
> **Surface:** (admin) — the platform operator's console
> **Permission(s):** TBD in Phase 1/3 (platform axis only; `src/lib/permissions.ts` is frozen)
> **Flag(s):** none expected (operator: no new platform flags pre-live)
> **Estimated complexity:** large
> **Pipeline mode:** Full
> **Numbers (pre-assigned 2026-10-25, Rule 16):** migration 0070 if needed; DECISION-251–256; F274–F281; dev port 3530.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; two tiers; 4 increments; G1–G24, Q1–Q14 | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Complete; R1–R10; DECISION-251–255 proposed; F274–F281 mapped; no migration for reads; no new dependency | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | Increment 1 complete (see `-inc1`); Increments 2–4 pending, one child each | Design complete (Inc 1) | 2026-10-25 |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

**Slug:** `2026-10-25-platform-admin-redesign` · Worktree `/Users/cshenso/git/presby-platform/presby-padmin` (main at 0.42.3)
**Date:** 2026-10-25 · **Read-only review.** Nothing was written. The orchestrator records this section.

**Operator quotes recorded (verbatim):**

1. 2026-10-25, original request: "on the organization setup is there a setup screen for features that can be turned on/off. also can you choose the base organization type? i feel like the platform admin screen needs an overall design pass and a dashboard. there are a buch of stuff in the left hand menu. some might not be needed and others are more important. kinda central to everything is organization management. dashboard is going to be pretty important as well. the screen is all about managing the platform."
2. 2026-10-25, first addition: "when managing it is almost like you will need org specific management and platform wide management screens and dashboards"
3. 2026-10-25, second addition: "the same thought and care with the ux should be used as with the org portal. same ux principals"

---

## VERDICT

**READY WITH NOTES.** The shape is clear and buildable. It is a three-or-four-increment program, not one pipeline. The notes are 14 open questions, each with a safe default, and 24 gaps that Phase 2 and 3 must carry forward. The most consequential are:

- G3: the platform tier must never show tenant-derived data.
- G8: the organization type is permanent and the create form can silently save the wrong one.
- G12: the toggles an operator sees must show effective state, not just the stored row.
- G16: `/admin` currently has no `loading.tsx`, no `error.tsx`, and no calm failure state on most pages.

## ONE-LINE TAKE

> The platform console becomes two tiers built on the org portal's UX principles. Tier 1 is a platform-wide dashboard plus a short, grouped, permission-filtered nav. Tier 2 is one workspace per organization, reached from the org list, showing only platform-axis facts about how that organization is set up. Creation gains a type explainer and a safe starting-features step.

---

## Answers to the operator's two literal questions (verified in code)

**1. "Is there a setup screen for features that can be turned on/off at organization setup?"** No.

- `/admin/organizations/new` (`create-organization-form.tsx`) asks for name, slug, type, parent, minute reference, and platform status. Nothing else.
- `createOrganization()` silently writes one enabled toggle row for each catalog entry with `provisionedOn: true`. Today that is only `org_portal.calendar` (`org-provisioning.ts:~490`). The operator is never shown this.
- After creation, features live in three disconnected places:
  - The congregation's own `/o/<slug>/admin/features`. It is self-service and needs `org_features.manage`.
  - Two operator-only toggles, `org_portal.domains` and `org_portal.mail_domain` (`operatorEnabled: true`). They sit inside the Domains section of `/admin/organizations/[id]`, and the church never sees them.
  - Global flags at `/admin/flags`.
- No screen shows an operator "what is on for this organization".

**2. "Can you choose the base organization type?"** Yes, at creation only. The form has a five-way select: General Assembly, Synod, Presbytery, Congregation, New Worshiping Community. I grepped `src` and `drizzle` and found no code path that changes `organization_type` after insert. Phase 2 must confirm this, but if it holds, the choice is **permanent**.

The type decides all of the following:

- the allowed parent type
- the founding-administrator plan and office template
- which derived groups are seeded
- the seeded event types
- whether the treasurer and giving apply
- which feature categories are offered
- whether `presby_*` function arms treat it as a congregation

The form warns that the slug is permanent. It does not warn that the type is.

---

## Verified current state

| Area | What exists | Evidence |
|---|---|---|
| Nav | A flat array of 13 links. Not permission-filtered. No active state or `aria-current`. `<nav>` has no `aria-label`. Links are `py-2 text-sm`, about 36px tall, with no focus-ring offset classes. Feedback is missing. Design system and Release notes are in it. At under 768px the whole sidebar stacks above the content, so about 13 links sit before the page. `<main>` is `p-8`, which leaves about 296px of content at 360px. | `layout.tsx` |
| Hub | `/admin` is a domain-sectioned tile grid (`ADMIN_TILES`, DECISION-123). Tiles are hidden when the viewer lacks the key. The `support_operator` acceptance case (2 tiles) is pinned in `page.test.tsx`. | `tiles.ts`, `page.tsx` |
| Dead tile | The Organizations tile text says only "Set a congregation's brand colour…". Sites, Giving health, Domains, and Feedback have either no tile or no nav entry. Sites was an acknowledged gap. | `tiles.ts` header |
| Org list | A council tree with filters. It has a good calm failure state and `min-h-11` controls. Its page copy is stale ("Set a congregation's brand colour…"). | `organizations/page.tsx` |
| Org detail | A single long page. Stacking order: founding administrator, treasurer, invitations, ingest health, affiliation, brand, profile, service times, site, domains (the domains section holds the two operator toggles). About 12 sequential reads per render. | `[id]/page.tsx` |
| Gate | `ADMIN_ORGANIZATIONS` gates organizations, new, detail, revoke, designation, toggles, Sites, Giving health, and Domains. Its catalog name and description still read "Manage organization branding". `permissions.ts` is frozen. | `permissions.ts:52` |
| Per-org features | `ORG_FEATURE_CATALOG` has 6 entries. The effective state is **global flag, then org type applicability, then category (if the axis flag is on), then toggle row, then the viewer's permission**. A stored `enabled: true` is not "live". | `org-features.ts` |

---

## User Verbs

Surfaces: **Admin** (the `(admin)` console) is the only surface this redesign changes directly. Its viewers differ by session `features`:

- The full operator holds `ADMIN_ROLE`.
- The support operator holds `ADMIN_DASHBOARD`, `ADMIN_TICKETS`, and `ADMIN_FEEDBACK`.
- Other partial holders hold some `admin.*` keys.
- The Developer portal viewer additionally has `is_platform_admin`. That predicate is separate (DECISION-044).

The **newly-authenticated** and **member** surfaces are touched only through the person that creation produces: the invited founding administrator who lands in `/o/<slug>`. See the Phase 6 walk below.

### Tier 1 — platform-wide

| Verb | Cadence |
|---|---|
| Scan what needs me today (dashboard "Needs attention") | per session |
| Find an organization by name | many times a day |
| Jump from a dashboard card or a platform list straight to the right place (failed emails, dead letters, domains needing attention, new tickets) | per alert |
| Triage tickets and feedback (counts on the dashboard, work in the existing queues) | daily |
| Review the audit trail of operator-authority changes | daily or weekly |
| Retry failed email, requeue dead letters, flip a global flag, set 2FA policy | on demand |
| Create an organization | per onboarding |

### Tier 2 — one organization

| Verb | Cadence |
|---|---|
| Open an organization from the list, a card, or a deep link | many times a day |
| See at a glance how far along its setup is and what is stuck | per visit |
| Invite or re-invite the founding administrator and treasurer; revoke a holder (recovery) | per onboarding or incident |
| See which features are on, effective or not, and who set them | on demand |
| Flip the operator-held toggles (website domain, mail domain) | on demand |
| Set brand, profile, service times; provision the site; connect domains | per onboarding |
| See this organization's recent platform-side activity | on demand |
| Move to a sibling organization or back to the list without losing filters | per visit |

### Creation

| Verb | Cadence |
|---|---|
| Choose type, see what that type gets, confirm that type and slug are permanent, create | per onboarding |
| (If ruled in) choose starting features | per onboarding |

---

## The two tiers, made explicit

### Tier definitions

- **Tier 1: Platform.**
  - Routes: `/admin`, plus the cross-organization lists (`/admin/organizations`, `/admin/organizations/domains`, `/admin/sites`, `/admin/giving`, `/admin/tickets`, `/admin/feedback`, `/admin/email-queue`, `/admin/users`, `/admin/2fa`, `/admin/flags`, `/admin/audit`).
  - Question answered: "is the platform healthy, and where do I need to act?"
- **Tier 2: Organization workspace.**
  - Routes: `/admin/organizations/[id]` and sub-routes. It stays under `/admin/organizations/[id]`, not a new route group, so the existing gate, UUID check, and deep links keep working.
  - Question answered: "is this organization set up, and what is stuck?"

### How the operator's org view differs from the congregation's `/o/<slug>/admin`

| | Platform workspace (`/admin/organizations/[id]`) | Congregation admin (`/o/<slug>/admin`) |
|---|---|---|
| Who | A holder of `FEATURES.ADMIN_ORGANIZATIONS`. No membership in the organization. | A member holding org permissions, verified by `withOrgContext` |
| Connection | `getPlatformDb()` and owner-only or platform read functions | RLS-enforced tenant connection |
| Authority | Platform position confers nothing inside the congregation (Two Hierarchies, DECISION-183/194). | Authority comes from the organization's own roles |
| Data | **Platform-axis facts only.** Identity, type, parent and affiliation history (the public org tree), platform status, lifecycle, brand, public profile, site and domain state, feature-toggle state, designation-slot holders as display name and count (DECISION-195), invitation status, giving-notice health as counts, audit rows about this organization. | People, roll, households, giving amounts and donors, events, groups, statistics, tickets' content, all roles and grants |
| Actions | Recovery and provisioning: invite, revoke the two slots, brand, site, domains, the two operator toggles | Everything the congregation runs itself, including its self-service feature toggles |
| Feature toggles | Sees state of all. Sets only `operatorEnabled` ones. | Sets all self-service ones. Never sees the operator-only ones. |

Rules that follow, and that Phase 2 and 3 must carry:

1. **No link from the workspace into `/o/<slug>/**`.** A non-member operator would hit the four-way miss "access denied naming the organization" (DECISION-040). A "view as the congregation" button is a trap and implies authority that does not exist. The public site link `/site/<slug>` is fine.
2. **A persistent one-line scope note** at the top of the workspace (see Copy), so nobody mistakes it for the congregation's admin.
3. **Nothing on either tier may be derived from tenant records.** There is one pre-existing exception: `/admin/2fa` shows `member_count` per organization and lists stranded accounts with emails. See G3.

### Navigation between tiers (recommendation)

- **Keep the platform left nav on every `/admin/**` page**, including inside a workspace, with Organizations highlighted. Swapping the left nav inside a workspace would give two nav models, and on a phone that is confusing.
- **Add an org context bar at the top of `<main>` on workspace routes:**
  - a breadcrumb "Organizations › {Name}"
  - the type chip, the platform-status badge, and a lifecycle badge when it is not active
  - the scope note
  - a `ButtonGroup` section nav of real links
- **Sections** (each its own URL, so a deep link works and the browser back button works, as with `CommunityNav` and `directory-nav`):
  - Overview
  - People and access
  - Features
  - Public presence
  - Brand and profile
  - Health
- **Back link:** a plain `Link` with `ArrowLeft` and `?from=`. The receiving page accepts only values starting `/admin` and otherwise falls back to `/admin/organizations`, per `ui-standards`. The org list passes its current filters so "Back to organizations" returns to the filtered view.
- **Cross-links both ways:**
  - Each platform list row links to the relevant workspace section. Examples: a Giving-health row goes to Health, a Domains row goes to Public presence, and a ticket row goes to the org Overview.
  - Each workspace section links back to the platform list. Example: "All domains".
  - Both filters are unverified. `/admin/organizations/domains` and `/admin/tickets` have no org filter today, so "filtered to this organization" needs a small `?org=` parameter added to existing pages. See G11.
- **Org switcher:** defer. For a console with dozens of organizations, a find-an-organization box on the dashboard and the context bar ("Find another organization", a GET to `/admin/organizations?q=`) is enough for v1. See Q9.

---

## Flows

**Flow 1 — Open the console (entry: avatar menu "Platform admin", or the `/launch` redirect for a canAccessAdmin-only user with 0 organizations).**
- Steps: the layout runs the sign-in and 2FA checks (unchanged) → the nav renders only the groups the viewer's `features` allow → the dashboard renders per-card.
- Success: the viewer sees "Needs attention", then "Organizations at a glance", "Platform health", and "Recent operator changes". Each card shows only if the viewer holds the key for its destination.
- Failure:
  - If one card's read fails, that card says "We can't load this right now. Try again.", with a link to retry. The other cards still render. This is never shown as zero or as an all-clear.
  - If the viewer holds `ADMIN_DASHBOARD` and no other key, the existing honest empty state stays: "You don't have access to any admin tools yet."

**Flow 2 — Act on an alert (entry: a dashboard card).**
- Steps: the whole card is the link (like `DestinationCard`) → it lands on the existing queue or workspace section, pre-filtered.
- Success: the viewer is on the exact list or section with the problem.
- Failure: the destination's own calm error state.

**Flow 3 — Find and open an organization (entry: dashboard find box, org list, or any deep link).**
- Steps: GET `/admin/organizations?q=` → the tree filters → open → Overview.
- Success: the workspace Overview.
- Failure:
  - If the list read fails, the existing inline retry state stays.
  - A malformed id gives 404. A non-holder gets the inline gate message before any id parsing, so ids cannot be probed.

**Flow 4 — Set up an organization (entry: workspace Overview setup checklist).**
- Steps: each checklist row shows a state and one next action. Examples: "First administrator: no invitation yet → Invite", "Brand: default palette → Set brand", "Site: not provisioned → Provision".
- Success: rows move to Done as the existing actions complete.
- Failure: a failed checklist read shows "can't load" for that row, never "Not started".

**Flow 5 — Create an organization (entry: "New organization" in the page action bar).**
- Steps:
  1. Name, slug, type.
  2. A "what this type gets" panel updates from the shared plan functions.
  3. Parent, minute reference, status.
  4. A confirm line: "The type and the slug can't be changed after you create this."
  5. Create.
  6. Land on the new workspace Overview with the setup checklist.
- Success: the organization exists with its derived groups, seeded event types, and default toggles.
- Failure: the existing human-copy errors (`slug_taken`, `invalid_parent`, and so on) are kept. One new failure: if the starting-features step is ruled in and one toggle write fails, the whole creation rolls back in one transaction. A half-set-up organization must not exist.

**Flow 6 — Feature state (entry: workspace → Features).**
- Steps: the page lists every catalog entry applicable to the type. For each it shows effective state, the reason when not effective, and who last changed it. The two operator toggles are controls. The self-service ones are read-only with the line "The congregation turns this on at Features."
- Failure: a failed read says "We couldn't load this organization's feature settings. Reload to try again." It never shows "all off".

**Flow 7 — Toggle an operator-held feature.** This is unchanged. It goes through `setOperatorOrgToggle` with an audit row carrying `via: "platform"`.

### Phase 6 walk required (CLAUDE: changes what a newly-created account can reach)

Because Increment 3 changes what a freshly created organization starts with, Phase 6 must walk it **as the person the path creates**, not a seeded fixture, on `development` at 360px.

1. Operator creates an organization.
2. Operator invites the founding administrator.
3. The invitee accepts.
4. Land on `/launch`.
5. `/o/<slug>`.
6. `/o/<slug>/admin`.
7. `/o/<slug>/admin/features`.

For each page, list what the person sees. If starting features are ruled in, verify the page for each pre-enabled feature actually renders for them.

---

## Permissions & Flags

- **Permission(s): no new key.** `permissions.ts` is frozen and `FEATURES.*` stays the platform axis. Every nav item and card maps to an existing key:

| Nav item or card | Key |
|---|---|
| Dashboard | `ADMIN_DASHBOARD` (the door) |
| Organizations, workspace, New, Sites, Giving health, Domains, "waiting for a first administrator", invitations | `ADMIN_ORGANIZATIONS` |
| Users, locked accounts | `ADMIN_USERS` |
| 2FA policy | `ADMIN_TWO_FACTOR` |
| Feature flags | `ADMIN_FLAGS` |
| Tickets | `ADMIN_TICKETS` |
| Feedback | `ADMIN_FEEDBACK` |
| Email queue | `ADMIN_EMAIL_QUEUE` |
| Audit log, "Recent operator changes" | `ADMIN_AUDIT` |
| What's new | `ADMIN_WHATS_NEW` |
| Release notes | `ADMIN_RELEASE_NOTES` |

- **Hiding is not authorization.** Every destination re-checks its own key, as DECISION-123 verified. This must stay true for new sub-routes, and each one runs the permission gate **before** UUID parsing and `notFound()`.
- **Design system and Release notes pages.** Neither calls `hasFeature`. They are reachable by anyone holding `ADMIN_DASHBOARD`, including a support operator. The pages are static and harmless, but the nav must not imply a gate that is not there. See G17.
- **Default roles:** `admin` (wildcard, the known violation) sees everything. `support_operator` sees the Support group only. Partial holders see a matching subset. The existing `page.test.tsx` acceptance case ("support operator sees exactly 2 tiles") must be re-pinned as "sees exactly the support cards and nav items".
- **Predicates stay separate (DECISION-044).** The nav and dashboard use only `features` (`canAccessAdmin`). The Developer portal stays `isPlatformAdmin`-gated and stays in the avatar menu. Do not add a Developer link to the left nav.
- **Flags: none.** This follows the operator's pre-live rule: no new platform flags. The rollback plan is revert the PR. Increment 1 carries no schema, so a revert is clean. If 0070 is added in Increment 2, it is additive (a read function only), so a revert leaves it unused.
- **Per-org toggles in the workspace.** Display always follows the full effective chain (G12). The operator never gets write access to a self-service toggle unless Q3 is ruled otherwise.

---

## Dashboard content proposal (Tier 1)

The page uses the org portal home's zone structure: `GreetingBand` (compact), an action bar with "New organization" top-right and a labeled "Find an organization" GET box, then the zones below.

**Hard rule (DECISION candidate):** the platform dashboard may show counts of platform-axis objects only: organizations, accounts, invitations, queue rows, tickets and feedback as counts, domains, sites, flags, and audit rows. It must never show counts or content derived from tenant records, namely people, roll, gifts, events, or attendance. Every card is counts, ages, and links. No names beyond public `organizations.name`, no addresses, no amounts, no ticket or feedback bodies.

| # | Card | What it counts | Source | Axis | Gate |
|---|---|---|---|---|---|
| 1 | **Waiting for a first administrator** | Active organizations with platform status managed or invited, with zero current holders of the founding-administrator slot. Split three ways: no invitation yet, invitation pending, invitation expired. | `account_invitations` (platform SELECT) plus grants. **Reuse the holder-count definition from 0060, never reimplement.** | Platform (standing, counts) | `ADMIN_ORGANIZATIONS` |
| 2 | **Invitations** | Pending, expired-unaccepted, and blocked | `account_invitations` | Platform | `ADMIN_ORGANIZATIONS` |
| 3 | **Tickets** | New count, oldest age, unassigned count | `tickets` via `getPlatformDb()` | Platform support loop | `ADMIN_TICKETS` |
| 4 | **Feedback** | `status = 'new'` count | `feedback` | Platform | `ADMIN_FEEDBACK` |
| 5 | **Email** | Failed count; queued items older than N minutes | `email_queue` (counts only, no addresses) | Platform | `ADMIN_EMAIL_QUEUE` |
| 6 | **Giving notices** | Waiting, dead letters, connections not active | `listIngestHealth()` and `listDeadLetters()` (no amounts, donors, or event bodies, by construction) | Platform | `ADMIN_ORGANIZATIONS` |
| 7 | **Domains** | Count with state "attention" | The existing "needs attention" predicate in `platform-read.ts`. Add a shared count function. | Platform | `ADMIN_ORGANIZATIONS` |
| 8 | **Sites** | Provisioning and suspended | `listSitesForAdmin` | Platform | `ADMIN_ORGANIZATIONS` |
| 9 | **Two-factor** | Required-but-not-enrolled accounts | The `/admin/2fa` predicate, **extracted to one shared function** | Platform (accounts; see G3) | `ADMIN_TWO_FACTOR` |
| 10 | **Accounts** | Locked now | `users.lockedUntil` | Platform | `ADMIN_USERS` |
| 11 | **Organizations at a glance** | Counts by type and by platform status; lifecycle not active; still on the default palette. Each links into the filtered tree. | `organizations`, `organization_brands` | Public org tree | `ADMIN_ORGANIZATIONS` |
| 12 | **Recent operator changes** | The last N rows from a closed list of actions: founding-admin and treasurer revokes, `invitation.created` with `selfAddressed`, `invitation.accepted` with `inviterIsInvitee`, platform role assign or remove, flag toggles, 2FA force-reset or TOTP reset, deactivations. Show action label, organization name, actor, and time. **Never** the verbatim revoke reason. | `audit_events` | Platform | `ADMIN_AUDIT` |

- **Card 12 matters beyond convenience.** DECISION-194's accepted residual (revoke, then self-addressed invite, then accept) is "detected by audit and not prevented". Today nothing surfaces it. This card gives that detective control a place to be seen.
- **Optional, later:** "Feature adoption" (per catalog entry, how many applicable organizations have it on) from `organization_feature_toggles`. It is platform-axis, and it supports the pre-live rule "turn giving on only where wanted".
- **Excluded on purpose:**
  - Overdue reviews. That is repo and process data, not platform operation. It belongs to the engineer's session hook.
  - Members per organization, giving totals, anything per person.
  - Per-organization email health. `email_queue` has no organization column, so it can't be attributed (unverified beyond the schema read).
- **State rules per card:**
  - Zero shows a calm all-clear: "Nothing waiting."
  - A failed read shows "We can't load this right now." plus a Try again link.
  - Zero is never shown on a failure.
  - Each card is an independent async server component that catches its own errors, with a `Suspense` skeleton, so a slow count doesn't block the page.
  - Show an "as of" time with `FormattedDate`.
  - A card the viewer lacks the key for is omitted, not shown as forbidden.
- **No `loading.tsx` on `/organizations/[id]/**`** (it calls `notFound()`; see the (org) contract). `/admin` itself always renders, so a `loading.tsx` is fine there.

---

## Navigation information architecture

Replace the flat 13-link list with grouped, permission-filtered, labelled sections. A group with zero visible items is omitted. Items show an active state (`aria-current="page"`), at least 44px touch height, and a ring with offset.

| Group | Items | Notes |
|---|---|---|
| (top) | **Dashboard** | |
| **Organizations** | **Organizations** (the tree, with "New organization" inside it); **Domains**; **Sites**; **Giving health** | Domains, Sites, and Giving health are cross-organization health lists. They stay as nav items but sit under one group heading, so Organizations visibly "owns" them. Domains is today reachable only by a button on the org list. |
| **Support** | **Tickets**; **Feedback** (add; it is missing from the nav today); **Email queue** | |
| **People and access** | **Users**; **2FA policy**; **Audit log** | |
| **Platform** | **Feature flags** | The group has one item today. Q5 asks whether to merge it into "People and access" and rename the group "Access and settings". |
| **Content** | **What's new** | |
| (footer) | **Reference:** Release notes; Design system | Demoted. Design system was already dropped from the tile grid by an explicit operator decision (the Phase 1 Q5 recorded in `tiles.ts`); it is reachable by URL. Release notes is "what shipped" and is read occasionally. |

- **Removed from primary nav:** Design system, Release notes, and the separate "Dashboard" and "Audit Log" capitalisation oddities.
- **Not added:** the Developer portal. See Permissions.
- **At 360px:** the nav collapses to a single "Menu" button above the content that opens the list. Do **not** use `<details>/<summary>`: a disclosure on iOS was one of the three phone-only bugs this project has already had. Use a Radix Dialog or Sheet, or a plain button controlling a conditionally rendered list, and test on a phone viewport. Sign-out stays in the nav footer but becomes a 44px target.
- **Layout padding:** change `p-8` on `<main>` to `p-4 sm:p-8`. `ui-standards` names `p-8` as the layout's contract, so this is a layout change that needs a note.
- **Global header:** the org portal has the avatar menu and org switcher. `/admin` has only "← PresbyPortal". Whether to add the shared avatar menu to the admin shell is Q10.
- **Regression to keep:** `layout.test.tsx` pins the "← PresbyPortal" link to `/home`.

---

## Organization workspace (Tier 2) — what is shown, read-only versus settable

| Section | Shows | Operator can set |
|---|---|---|
| **Overview** (the org-level dashboard) | Identity header (name, immutable slug, type, platform status, lifecycle, parent linked to its workspace, created date). **Setup checklist** with a state and one action per row. Platform-axis health signals for this organization. A short recent-activity list from `audit_events` for this organization. | Nothing here beyond actions linked from rows |
| **People and access** | Founding-administrator and treasurer slots as display name and count (DECISION-195). Invitations (status, dates, resend counts). "Self-designated" stamp. | Invite, resend, revoke an invitation, revoke a holder with a reason (DECISION-194). All unchanged. |
| **Features** | Every catalog entry that applies to this type, with **effective state and reason** (G12), and who last changed it as a **label** (not an email). If the category axis is on, which ministry areas the congregation chose. | Only the two `operatorEnabled` toggles. Self-service toggles read-only (default; Q3). |
| **Public presence** | Site status and last ingest. Domains and their states. The mail-domain toggle. | Provision site, domain controls, the toggles above |
| **Brand and profile** | Current brand preview, the profile, service times | Set brand, neutralize, profile, service times (unchanged) |
| **Health** | Giving-notice counts and dead letters for this organization. Domain check outcomes. | Requeue, as today |

- **Affiliation history:** the current `AffiliationSection` stays, linked from Overview. It is read-only today. The "no in-product way to give an existing headless organization its first parent" gap (TODO.md:471) stays out of scope.
- **Platform status, lifecycle, and type:** read-only in the workspace. No edit path exists today and none is added here.
- **Checklist row states:** "Not started", "Waiting on {display name}" or "Waiting on an invitation", "Done". A read that fails shows "We can't load this."
- **Performance:** today's detail page runs about 12 sequential reads. Splitting into section routes means each route loads only its own data. Phase 3 should also parallelise reads inside a section.

---

## Feature setup at creation — options

| Option | What the operator does | Consistency with `operatorEnabled` and self-service | Risk |
|---|---|---|---|
| **A. Status quo plus visibility** | Nothing at creation. The catalog's `provisionedOn` defaults still apply. The post-create checklist and the Features section show what is on. | Fully consistent. | Operators still can't preview what a type gets. |
| **B. "Starting features" preview, operator toggles only** | At creation, show the applicable features for the chosen type with their default state. The two operator-held ones can be set; the rest are read-only: "{Name} can turn this on at Features". | Consistent. The operator controls only what the catalog says is the operator's. | Low. |
| **C. Operator sets self-service toggles at creation as initial values** | A checklist of self-service features to start on. Written as toggle rows with `updatedBy` null, audited as `via: platform` and `phase: creation`, in the creation transaction. The congregation can change them after. | Defensible as "initial value, then handed over". It is a one-time seed, not an override. It has to be recorded as such so the audit never reads as the operator flipping a church's setting later. | Real. Some features carry legal or financial weight. **Giving must stay off at creation** (needs a treasurer and a Stripe connection). A pre-enabled toggle with a global flag off is not live, so the preview would mislead (G12). It changes what the first administrator can reach, so the Phase 6 walk is mandatory. |

**Recommendation and safe default: A in Increment 2, B in Increment 3. C only if the operator rules yes (Q3).** If C is ruled in, exclude giving and any `operatorEnabled`/inapplicable key; reject them server-side regardless of the form.

### Organization type — what to add

- An inline "What this type gets" panel built from the **existing plan functions**, not hand-written copy. Candidates: `foundingAdministratorPlan`, `treasurerDesignationApplies`, `offeredCategories`, `RELATIONSHIP_BY_CHILD_TYPE`, `eventTypeSeedPlan`. The copy then can't drift from what is actually created.
- A confirm line naming the type and slug as permanent.
- **`HydrationGate` on the create form (G8).** `create-organization-form.tsx` has no `HydrationGate`, and TODO.md:185 already records "a parent picked before hydration silently becomes a root-org create (F124 class)". With a permanent type this matters more: a `<select>` controlled by `useState` can revert to its default on hydration, and the form then creates a Congregation the operator meant to be a Presbytery. Because `check:hydration-gate` only detects `useForm`, it will not catch this.
- **Nothing here lets an operator correct a wrong type afterwards** (Q4). Safe default: no, and say it in the confirm line.

---

## UX principles carried over from the org portal

These are requirements on the platform console, not suggestions. Each names the org-portal precedent and, where I spot-checked, where `/admin` currently falls short.

| # | Principle | Org-portal precedent | `/admin` today (spot-check at code level) |
|---|---|---|---|
| U1 | **Calm failure copy with a recovery action.** "We couldn't load X right now. Try again in a moment." plus a 44px Try again. Never a stack trace, never blame. | `FeaturesLoadError`, `OrganizationsUnavailable` ("This is on our end, not yours") | **Violated.** `users`, `flags`, `email-queue`, `feedback`, `tickets`, `sites`, `audit`, `2fa`, and `whats-new` pages have no `try/catch`, and `(admin)` has **no `error.tsx` or `loading.tsx` at all** (I searched the tree). A database blip shows Next's default error. **Good models:** `organizations/page.tsx` and `giving/page.tsx`. |
| U2 | **A failed read is never rendered as "none" or all-clear.** | Designation holders and invitations render "can't load" for `null`; `/launch` renders rather than redirects. | Mostly held on the org pages. Violated by omission elsewhere. The dashboard must follow it per card. |
| U3 | **Degraded states, not walls.** Show what the viewer can have; omit what they can't. | The org hub never pre-filters on permission and lets the destination answer. The platform axis deliberately differs: DECISION-123 hides what is not held, and each destination answers. | `/admin` tiles hide correctly. Nine pages hand-copy a forbidden sentence, and the wording differs. The Organizations page says "You don't have permission to manage organization branding", which is stale now that the key gates much more. Replace with **one shared forbidden state**. |
| U4 | **Empty states say what happened and what to do next, with a CTA when the viewer can act.** A search that matched nobody is told apart from a genuinely empty list. | `CommunityEmptyState` | **Violated.** `/admin/flags` shows "No flags yet. Add some in `scripts/seed.ts` or via SQL." in a gray table row, which is developer language and not an empty state per `ui-standards`. The users search has no zero-results state. |
| U5 | **Section navigation by `ButtonGroup` of real links.** GET navigations, server components, back button works, horizontal scroll at 360px. | `CommunityNav`, `directory-nav` | The workspace section nav and the Organizations sub-views use it. The 13-link stack does not. |
| U6 | **Whole-card destinations with visible affordances.** The card is the link; a title, chevron, or button shows it is clickable. Hover never the only affordance. | `DestinationCard`, `TileGrid` (`Button variant="tile"`) | Tiles comply. Dashboard cards must reuse these primitives. |
| U7 | **44px targets, single column at 360px, no fixed widths.** | `min-h-11` throughout org pages | **Violated on `users`:** `Input className="w-72"` (288px) plus a Search button overflows 296px of content; `size="sm"` buttons are about 32px; the role `<select>` is `text-xs py-1`; a five-column table has no horizontal-scroll wrapper. The nav links are about 36px. The org list and giving pages comply. |
| U8 | **`HydrationGate` on every form root**, and on any `useState`-controlled select that writes data. | DECISION-159 | **Violated:** the create form (G8). Unfixed since TODO.md:185. |
| U9 | **Tokens only, never palette literals; status paired with text or an icon.** | Checklist in `ui-standards` | **43 palette-literal occurrences across 16 files** under `(admin)/admin` (for example `bg-amber-500/15 text-amber-700`, `bg-yellow-100`, `text-red-300`). The feedback page's own comment says "semantic status tokens don't exist yet". The dashboard needs an attention treatment; use existing tokens (`destructive`, `muted`, `secondary`) plus an icon and text, and do **not** add a token without architect review, because the token contract is closed (`contract.ts`). |
| U10 | **Page header, action bar, back link, `?from=`.** `<h1>` at `title`, `dense` description, text-labeled buttons before icon-only ones, plain `Link` with `ArrowLeft`. | `ui-standards` | Mostly held. The workspace uses a bare "← Back to organizations" with no `?from=`. |
| U11 | **Plain language.** Say what happened and what to do next, in words the reader uses. | `ui-standards` Accessibility | Partly held. "tenant" appears in the platform-status help text ("Managed: a real tenant"). Reword (see Copy). The users page prints "yes/no" for Active. |
| U12 | **Loading skeletons only on segments that always render.** | (org) contract: no `loading.tsx` on a segment that redirects or 404s | The `[id]` workspace calls `notFound()`: **no `loading.tsx` there**. Use per-card `Suspense` on the dashboard. |
| U13 | **Dates through `FormattedDate`.** | CLAUDE invariant | Held in the pages I read. |

### Shared-component reuse expectation

- **Reuse, don't copy:** `DomainTileSections`, `DestinationCard`, `TileGrid`, `GreetingBand`, `ButtonGroup`, `Pagination`, `FormattedDate`, `HydrationGate`, `Button`/`Badge`/`Card`/`Table`.
- **Anything with no platform-specific concept goes in `src/components/shared/`**, not an admin-only copy. Expected new shared pieces:
  - a load-error block, generalising `OrganizationsUnavailable` and the repeated `Features*`/`Roles*` blocks
  - a shared empty state
  - a shared forbidden state
  - a count/attention card
  - a section-nav wrapper over `ButtonGroup`
  - a responsive collapsing-nav primitive
- **Admin-specific composition** (for example the dashboard zones and the workspace context bar) needs a home. A `src/components/admin-portal/` directory, parallel to `org-portal/`, is a new subdirectory and an architect decision. See Q-ARCH below.
- **Single source of truth for definitions:** any count that already exists on a page (2FA stranded accounts, domains needing attention, giving-health summary) is extracted to one function used by both the page and the dashboard card. A card and its destination must never disagree.

---

## Gaps the Request Didn't Address

### Pass 4 — Edge cases

**G1. Dashboard degraded and empty states.** Specified above: per-card isolation; zero versus failure; a viewer with only the door key. Without these, a database blip reads as "all clear" or as revoked access, the exact lie `OrganizationsUnavailable` was written to prevent.

**G2. 2FA gate.** The layout redirects to `/totp` for an enrolled-required user who hasn't verified. Keep that unchanged. A user mid-enrolment (required, not enrolled) is pushed to `/totp` and never sees the dashboard. Nothing in this pipeline touches `src/auth.ts` or `src/proxy.ts`, so the "running-server e2e with an MFA-enrolled user" gate is not triggered. That holds only while the layout change leaves the redirect logic alone. If Phase 3 touches it, the gate applies.

**G3. Two Hierarchies on the platform tier.**
- New cards and the workspace may show only platform-axis data (rule above).
- There is a **pre-existing exception**: `/admin/2fa` reads a per-organization **active member count** and lists stranded accounts' emails (via membership joins). This is the one cross-axis count already on a platform page.
- Default: leave it in place, do not extend it, record it as a known exception, and extract the stranded-account predicate to one shared function. Q8 asks the operator whether to remove the member count.
- A reviewer must reject any card that quietly adds a roll or giving figure.

**G4. Audit.**
- No new security-sensitive mutation in Increment 1. Navigation and dashboard are reads.
- Increment 3 adds writes if starting features are ruled in. Those must audit in the same transaction as creation, using `ORG_FEATURE_TOGGLED` with `via: "platform"` and `phase: "creation"`. The existing creation audit row alone would hide that a feature was pre-enabled.
- Any new `actions.ts` mutation must reference an `AUDIT_ACTIONS` key (`check:audit`).

**G5. Empty state on a brand-new install.** Zero organizations: the dashboard says what to do ("No organizations yet. Create the first one.", with the button). Zero tickets, feedback, and domains each get a quiet all-clear. The org tree's empty state exists; the workspace has no org to be empty.

**G6. Stale page copy.** The org list description ("Set a congregation's brand colour…"), the Organizations tile description, and the `ADMIN_ORGANIZATIONS` catalog entry ("Manage organization branding") all under-describe what the key now gates. `permissions.ts` is frozen, so correcting the catalog text needs an explicit architect ruling (a copy-only change to a frozen file). Q12.

**G7. Mobile (360px).** The sidebar stack, `p-8`, and `users` page are real problems today (U7). The create form and the org tree must be verified at 360px in a browser, not only by build. The workspace `ButtonGroup` scrolls horizontally, as `CommunityNav` does.

**G8. Create form: permanent type, no pre-hydration protection.** See above. In addition, the form defaults to "Congregation" with no explanation of the consequences of each choice. Fix: `HydrationGate`, the "what this type gets" panel, the permanence line.

**G9. Dashboard and workspace failure copy.** Specified above, with the reads isolated so the page doesn't take the console down.

**G10. Creation transactionality.** If starting features are ruled in, the creation transaction writes the org, groups, settings, toggles, event types, and (new) starting toggles together. A "half-provisioned" org cannot exist (the existing code comment says so). Phase 3 must keep this property.

**G11. No org filters on tickets and domains.** Neither `/admin/tickets` (filters: status, area, priority) nor `/admin/organizations/domains` accepts an organization filter. The workspace's "this organization's tickets/domains" links need a small `?org=<uuid>` parameter on each, validated as a UUID and ignored otherwise. This is new input on existing pages and falls under Pass 5.

**G12. Effective versus stored toggle state.** A toggle row of `enabled: true` is not "live". The effective chain is global flag, then org-type applicability, then the category axis (when `org_portal.feature_categories` is on), then the row, then the viewer's permission. Showing the raw row would tell an operator a feature is on for a church that cannot reach it. The Features section must compute effective state without a per-viewer permission step, and say why when it is not effective, for example "On, but not available yet" (global flag off) or "Not available for presbyteries". The operator must never see a plain "On" that isn't. This resolver logic exists inside `org-features.ts` today and runs under a tenant context; the platform read is new. Architect should rule on whether it is a platform-side reader module or a function (possible 0070).

**G13. "Who last changed it".** `updated_by` is a user id, and the congregation's own tool shows the editor's email. The platform view must show a label only ("set at creation", "changed by the congregation", "changed by the platform"), never another person's email (DECISION-195 shows names only, and only for designation holders).

**G14. "Waiting for a first administrator" is a definition, not just a count.** Which statuses count (managed and invited; not unmanaged, which is stewarded by a parent), which lifecycles (active only), and what "holder" means (the derived-group arm is excluded from revoke but included in the count; the 0060 SQL count is canonical). If a single owner-only function is needed to compute this across organizations without an N+1, that is the likely reason for migration 0070. Architect to decide. Q6.

**G15. Dashboard performance.** About ten counts per load. Each uses an indexed or simple aggregate, runs in parallel, and is isolated. No per-organization loop. A cross-organization card that needs one query per organization is a Phase 2 reject.

**G16. No `loading.tsx` or `error.tsx` anywhere in `(admin)`.** The Next default error page is the failure state for the console today. Add `error.tsx` (calm copy, Try again) at the `(admin)/admin` segment, and `loading.tsx` only on segments that always render. Not on `[id]`.

**G17. Reachability mismatch.** Design system and Release notes pages have no gate of their own (see Permissions). When demoted to the footer, either gate them with their intended keys or accept and document that any door holder can read them.

**G18. Active-state and landmarks.** The nav has no `aria-current` and no `aria-label`. Add them. The mobile menu must trap focus and return it on close (Radix does).

**G19. Per-org 2FA policy in the workspace.** `/admin/2fa` toggles `require_two_factor` per congregation. The org workspace Overview should show the current policy and link to the toggle, because it is part of "is this organization set up". It is not moved.

**G20. Naming of the console's own surfaces.** "Platform admin", "Platform operator", and "Admin" are all used. Pick one for user-visible copy. Suggested: "Platform admin" (the avatar menu already says it).

**G21. Shared status treatment.** See U9. Without a semantic-status approach the dashboard will either add palette literals or look inert. Needs an architect or tech-lead decision using existing tokens only.

**G22. Version and release surface.** The console shows no running version. A "Release notes" footer link plus the version string would help an operator confirm what's deployed. Cheap; optional.

**G23. Docs to update at ship (Rules 14, 15).** `docs/product/functionality-map.md` Admin section and Index entry (the dashboard, workspace, and nav change materially). `docs/architecture.md` only if a new subsystem is introduced, which this is not. Rule 13 what's-new advisory: not required for internal admin tooling.

**G24. `?from=` and the org list filters.** For "Back to organizations" to restore filters, the workspace link carries the current query. `?from=` must be validated server-side (starts with `/admin`, no scheme or host).

### Pass 5 — Adversarial

| Surface | Concern | Finding |
|---|---|---|
| `?from=` and `?org=` | Open redirect or injection via a user-controlled path | `from` is accepted only if it starts with `/admin` (and not `//`, not a scheme); otherwise the default. `org` is a UUID or ignored. **Gap to close in design (G11, G24).** |
| Section sub-routes | A later URL reached directly skips the gate | Each sub-route must run the permission check first, then the UUID check, then the read. The current detail page does this; the new routes must too, so a non-holder can never probe ids. **Confirm.** |
| Existence | 404 versus 403 | The org tree is public, so organization existence is not a secret. The gate-before-id order still prevents a non-holder from using the console as an oracle. No change. |
| Dashboard links | Static internal paths | No user-controlled hrefs. The only parameterised ones are org ids from the database. |
| Cards | Information via counts | Counts of platform-axis objects only (rule above). Reject any card that adds tenant-derived counts. Ticket and feedback bodies and titles never appear on the dashboard (feedback is rendered as plain text elsewhere because it is hostile content). |
| Audit card | Leaking the verbatim revoke reason or metadata ids | Show the action label, organization name, actor, and time only. **Gap to close in design.** |
| Starting features (if ruled in) | A hand-built POST enables giving, an operator-only key, or a key that doesn't apply to the type | The server validates every key against the catalog, `orgTypes`, `operatorEnabled`, and the creation allow-list, with the same `invalid_key` for an unknown key and a not-applicable key. Never trust the form. |
| Create form | Overlong name, Unicode edge cases, empty fields | Existing server-side validation stays authoritative. The new fields are re-validated server-side. |
| Self-targeting | The operator acts against their own account | Designation to one's own email is permitted, stamped, and audited (DECISION-183). The workspace continues to show "Self-designated". The dashboard "Recent operator changes" card is where the accepted residual (revoke, then self-invite, then accept) becomes visible. It is still not prevented. |
| Developer portal | The nav accidentally exposing it to `canAccessAdmin`-only users | Keep it out of the left nav. |
| Brand | The workspace renders an organization's brand | Only as a bounded preview swatch and the logo on a neutral plate. `(admin)` stays platform palette and renders no `<BrandTokens>` (`check:brand-scope`). |

---

## Out of Scope (confirm with user)

- Any tenant-data view for the platform tier (rolls, members, giving amounts, tickets' content).
- Changing an existing organization's type, platform status, or parent. (The first-parent gap at TODO.md:471 stays tracked.)
- Platform-side control of congregations' self-service feature toggles (default; Q3).
- A new platform flag or permission key.
- Impersonation or "enter as" access into `/o/<slug>`.
- An org switcher beyond a search box (Q9).
- Moving the Developer portal into the nav.
- Overdue-review reminders.
- Rewriting the individual list pages beyond the shared states, tokens, and 360px fixes in the sweep increment.

---

## Open Questions (each with a safe default)

| # | Question | Safe default |
|---|---|---|
| Q1 | Increment order and whether to split at all | Three feature increments plus a sweep; see below |
| Q2 | Is the tile grid retired from `/admin`, with the nav as the only index? | Yes, retire the grid. The dashboard replaces it. Keep `ADMIN_TILES` only if something else uses it. |
| Q3 | May the operator pre-set self-service toggles at creation (Option C)? | No. Show, don't set (Option B). Giving never. |
| Q4 | Should there be any way to correct a wrongly typed organization? | No. State permanence in the confirm line. Out of scope. |
| Q5 | Merge "Feature flags" into "People and access" and rename the group "Access and settings"? | Yes. A one-item group is noise. |
| Q6 | Which organizations count as "waiting for a first administrator"? | Active lifecycle, platform status managed or invited, zero current holders. Unmanaged excluded. |
| Q7 | Show the "Recent operator changes" audit card? | Yes, to the `ADMIN_AUDIT` holder. |
| Q8 | Keep the per-organization member count on `/admin/2fa`? | Keep as is, record as a known exception, don't extend. |
| Q9 | Add an organization switcher to the workspace? | Defer. Breadcrumb, back link with filters, and a find box. |
| Q10 | Put the shared avatar menu on the admin shell? | Yes, if cheap, so identity and sign-out match the org portal. Otherwise keep the footer sign-out as a 44px target. |
| Q11 | Where do Release notes and Design system live? | Footer "Reference" group. |
| Q12 | May `permissions.ts`'s `ADMIN_ORGANIZATIONS` name and description be corrected (copy only, frozen file)? | Architect rules. If no, leave as is and note it. |
| Q13 | Should the dashboard be behind a flag? | No (pre-live rule). Rollback is a revert. |
| Q14 | New shared components in `src/components/shared/` and a new `src/components/admin-portal/` directory? | Shared where generic; `admin-portal/` for admin-only composition. Architect decides the directory. |

**Q-ARCH for Phase 2:** possible migration 0070 for a cross-organization read function (G12, G14), the `admin-portal` component directory (Q14), the semantic-status treatment (G21), and the `permissions.ts` copy change (Q12). The bounded-query rule (G15) also needs a ruling.

---

## Copy for key states

(Phase 3 owns final wording; these set the register: plain, calm, say what to do next, no "tenant".)

- **Dashboard all-clear:** "Nothing needs attention right now."
- **Dashboard card failure:** "We can't load this right now." plus a "Try again" link.
- **Dashboard door-only:** "You don't have access to any admin tools yet. Contact a platform administrator to request the features you need." (existing)
- **No organizations yet:** "No organizations yet. Create the first one." with a "New organization" button.
- **First administrator card:** "{N} organizations are waiting for a first administrator." Sub-lines: "{a} with no invitation yet", "{b} invited, not accepted", "{c} invitation expired".
- **Workspace scope note:** "This is the platform's view of {Name}. It shows how {Name} is set up on PresbyPortal, not its members, records or gifts."
- **Features, self-service row:** "The congregation turns this on at Features." (Shown to the operator as read-only.)
- **Features, not effective:** "Turned on, but not available yet" (platform-wide switch off); "Not available for presbyteries" (type does not apply).
- **Features load failure:** "We couldn't load this organization's feature settings. Reload to try again."
- **Create form permanence line:** "The type and the slug can't be changed after you create this organization."
- **Platform status help (replacing "a real tenant"):** "Managed: using PresbyPortal for its own records. Unmanaged: listed in the hierarchy; its records are kept by its parent council. Invited: being onboarded."
- **Forbidden (one shared state):** "Your account doesn't include {area}. Ask a platform administrator if you need it."
- **Checklist rows:** "First administrator: no invitation yet" with "Invite"; "Waiting on an invitation"; "Brand: still on the default palette" with "Set brand".
- **Audit card row:** "{Action label} · {Organization} · {actor} · {time}" (no reasons or metadata).

---

## Recommended increment split

The parent work-log keeps the shared Phase 1 and 2 and a table linking one child per increment (`...-inc1` and so on), per CLAUDE.md.

| Inc | Scope | Schema | Pipeline |
|---|---|---|---|
| **1. Platform tier shell** | Grouped, permission-filtered nav with active state, phone menu, Feedback added, Design system and Release notes demoted; layout `p-4 sm:p-8`; `error.tsx` and `loading.tsx` at the admin segment; the shared load-error, forbidden and empty components; the dashboard v1 from **existing reads only** (cards 3 to 11, with the 2FA and domains predicates extracted to one function each); the tile grid retired | none | **Full** (new cross-organization reads in an isolation-sensitive area; the pre-existing exception G3 needs review). Not Accelerated: ambiguity defaults to Full. |
| **2. Organization tier** | Workspace context bar, section routes, Overview and setup checklist, Features view with effective state (G12), per-organization health, `?org=` filters on tickets and domains, org list badges, dashboard cards 1, 2 and 12 that need the "first administrator" definition | **Possibly 0070** (read function, additive) | Full |
| **3. Creation** | Type explainer from the plan functions, permanence line, `HydrationGate` fix, post-create landing on the checklist, starting features per Q3 (default: Option B) | none expected for B; none for C either (uses the existing toggle table) | Full, with the **Phase 6 founding-administrator walk at 360px** |
| **4. Sweep** | Existing platform list pages brought to the standards: palette literals to tokens, calm failure and empty states, `users` at 360px, labeled search | none | Polish-class pieces; one pipeline |

Rationale: Increment 1 delivers the "dashboard that matters" with no schema risk and unblocks everything else. Increment 2 is the organization centre the operator named. Increment 3 answers the two literal questions. Increment 4 can ship late without blocking the rest.

**Numbering suggestion** (pre-assigned DECISION-251 to 256, F274 to F281, migration 0070 if needed). Candidates for decisions:
- 251: the two-tier model and the platform-axis-only rule.
- 252: nav information architecture.
- 253: dashboard card definitions (G14).
- 254: workspace scope and effective-state display (G12).
- 255: feature setup at creation.
- 256: the shared-component and UX-principle reuse rule.

Findings to claim from F274 to F281: G3, G8, G11, G12, G13, G14, G16, G17. The orchestrator assigns the actual F-numbers.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-25 |

## Handoff

**Next agent: architect (Phase 2).** Please rule on:

1. Whether Tier 1 and Tier 2 live as specified (workspace under `/admin/organizations/[id]/**`, keep the left nav).
2. A new `src/components/admin-portal/` directory, plus which components go to `src/components/shared/` (the shared-component expectation above).
3. Migration 0070 versus existing reads for G12 and G14.
4. The semantic-status treatment under the closed token contract (G21).
5. A copy-only change to the frozen `permissions.ts` (Q12).
6. Whether the layout-level padding change needs a `docs/ui-standards.md` note.

Phase 2 should also re-check that no step touches `src/auth.ts`, `src/proxy.ts`, or `src/lib/authz.ts`. If one does, the MFA-enrolled e2e gate applies.

**Files read (all under `/Users/cshenso/git/presby-platform/presby-padmin`):** `docs/work-log/2026-10-25-platform-admin-redesign.md`, `docs/work-log/_template.md`, `docs/ui-standards.md`, `docs/product/functionality-map.md`, `src/app/(admin)/admin/{layout,page,visible-tiles,tiles}`, `.../organizations/{page,new/*,[id]/page}`, `.../{giving,sites,2fa,users,email-queue,flags,tickets}/page.tsx`, `src/lib/{org-features,org-provisioning,permissions,audit,domains/toggles,domains/platform-read,admin/giving-ingest-health}.ts`, `src/components/shared/{button-group,tile-grid,destination-card,greeting-band,organizations-unavailable}.tsx`, and the org-portal pages `(org)/o/[slug]/admin/{layout,page,admin-hub-states,community/*,features/*}`.

---

# Phase 2 — Architectural Review (architect)

**Date:** 2026-10-25 · **Read-only review.** Nothing was written. The orchestrator records this section.
**Worktree:** `/Users/cshenso/git/presby-platform/presby-padmin` at `4c837c6`. `main` (`77be511`) differs from the worktree only in docs, scripts and e2e support files: `git diff --stat 4c837c6 main -- src` is empty, so every source file below reads the same on `main`.
**Live catalog read:** the Neon branch that the main checkout's `.env.local` `PLATFORM_DATABASE_URL` points at (database `neondb`). The worktree has no `.env.local` yet. I read:
- `pg_roles`: `neondb_owner` and `presby_platform` have `rolbypassrls=t`; `presby_app` has `f`.
- `relforcerowsecurity` on 19 tables.
- `proacl` on the 0060 holder functions: `neondb_owner=X` only.
- the triggers on `organizations`, and the grants on it.
- the unique indexes on `account_invitations`.

### Verdict

**Approved with suggestions.**

The two-tier shape, the four-increment split and the operator rulings are structurally sound. No new dependency is needed. No migration is needed for reads. Nothing in Increments 1 to 3 has to touch `src/auth.ts`, `src/proxy.ts` or `src/lib/authz.ts`.

Phase 1 got two things wrong, and I correct them here rather than loop back, because neither changes the feature's shape:
- **The `loading.tsx` rule (R1c).** A `loading.tsx` at `(admin)/admin` is *not* safe.
- **G17.** `/admin/docs` *is* gated, at the proxy.

---

### Placement

**Directory placement**

| What | Where | Ruling |
|---|---|---|
| Workspace section routes | `src/app/(admin)/admin/organizations/[id]/{page.tsx (Overview), access/, features/, presence/, brand/, health/}` (Phase 3 names the final slugs) | Approved. These are real routes under the existing tree, not a new route group. |
| Existing workspace section components (`founding-administrator-section.tsx`, `domains-section.tsx`, ...) | Stay in `[id]/` | They are feature-specific (Component Rule 3). Do not move them to `admin-portal/`. |
| Workspace gate helper `requireWorkspaceOrg(params)` and `revalidateWorkspace(id)` | `src/app/(admin)/admin/organizations/[id]/workspace.ts` (co-located) | New. See R1. |
| Nav registry | `src/lib/admin-portal/nav.ts`, which **replaces** `src/lib/admin-portal/tiles.ts` | Same constraints as DECISION-123's registry: pure synchronous data, no `hasFeature` or session or query. Filtering happens in a co-located helper next to the layout. Delete `ADMIN_TILES` and `src/app/(admin)/admin/{visible-tiles,tile-icons}.ts`. `domain-tile-sections.test.tsx` uses `ADMIN_DOMAIN_*` as a fixture and needs a local fixture instead. `DomainTileSections` stays, because `(org)` still uses it. |
| Dashboard card readers | `src/lib/admin-portal/dashboard/*.ts` (new subdirectory, `server-only`) | This is the scanned boundary for the platform-axis rule (R7). |
| The 2FA stranded-account predicate | `src/lib/admin/two-factor-stranded.ts` (one function, used by both `/admin/2fa` and card 9) | It is the recorded exception, and it sits **outside** the scanned directory on purpose (R7). |
| Giving counts | Stay in `src/lib/admin/giving-ingest-health.ts` (add a count function there if needed) | `check:giving-boundaries` B6 names this exact file as the only one allowed to name the three owner-only giving functions. Do not move it into `admin-portal/`. |
| Platform-side feature-state reader (G12) | `src/lib/admin-portal/org-feature-state.ts` | See R3. |
| Pure effective-state resolver | `src/lib/org-features-effective.ts` (pure: no `server-only`, no db) | Shared by the tenant path and the platform path (R3). |
| `?from=` validator | `src/lib/admin-portal/back-href.ts` (pure) | **Not** under `src/lib/auth/`, because putting it there would trigger the MFA gate (R9). |
| Admin-only composition | **New `src/components/admin-portal/`**, parallel to `src/components/org-portal/` and to the existing `src/lib/admin-portal/` | Approved (Q14). The name was settled in DECISION-123: "platform-portal" was rejected as an overloaded term. |
| Generic UI | `src/components/shared/` | See R2 for the component-by-component split. |

**Server vs Client split**

*Server components:*
- the admin layout and the nav shell, which computes the visible groups from `session.user.features`
- the dashboard page and every card, each an async server component
- `CountCard`, `LoadError`, `EmptyState`, `AdminForbidden`
- `WorkspaceContextBar`
- the workspace section nav, which is `ButtonGroup` with `active` passed from the page (each page knows its own section, so no `usePathname` is needed)
- every section page
- the dashboard "Find an organization" box, as a plain `<form method="get" action="/admin/organizations">`

A card's "Try again" is a plain `Link` to the same URL, not `reset()`. That follows `OrganizationsUnavailable`'s reasoning.

*Client components (`'use client'`):*
- `AdminNavLinks`: a leaf that only reads `usePathname()` for `aria-current="page"`. It receives plain `{href,label,group}` data and no functions.
- `AdminMobileMenu`: the Sheet below 768px.
- `AvatarMenu`: already a client component, reused unchanged.
- `(admin)/admin/error.tsx`: client by framework requirement.
- In Increment 3, the create form. It is already client, and it gains `HydrationGate`.

*The Increment 3 "what this type gets" panel:* `foundingAdministratorPlan` and `treasurerDesignationApplies` import `server-only`. Compute the panel for all five types on the server, in `new/page.tsx`, as a plain serializable table. The client form only selects a row by the chosen type. It never imports the plan modules.

**Dependencies: no new npm dependency.**
- **Phone menu.** Use `npm run ui:add -- sheet`. The generated Sheet uses `@radix-ui/react-dialog`, which is already installed (`package.json:52`), so the wrapper should report no unvetted package. If it does report one, stop and return here for an addendum.
- **No `<details>/<summary>`.** That is a known iOS defect.
- **No raw `npx shadcn add`** (DECISION-048).
- Everything else uses packages already installed: `lucide-react` icons, `Badge`, `Card`, `Button`, `ButtonGroup`, `DestinationCard`, `GreetingBand`, `FormattedDate`, `HydrationGate`.

---

### Invariants Touched

- **Isolation Is a Database Property.**
  - Every new read runs on `getPlatformDb()`, which is `neondb_owner` with `rolbypassrls=t`. That is correct for `(admin)`.
  - The tenant connection is untouched. Nothing new calls `withOrgContext`.
  - The platform reader for G12 may reuse `categoryEnabledInTx` by passing the platform tx as `OrgTx`. `src/lib/domains/toggles.ts` already sets that precedent.
  - Only `import type` from `src/lib/authz.ts` is allowed. That file is not edited.
- **Two Hierarchies Intersect Nowhere.**
  - The workspace shows only platform-axis facts.
  - Nothing under `(admin)/admin/**` links into `/o/<slug>` (R8). The public `/site/<slug>` link goes through `SiteUrls`.
  - The admin shell mounts `AvatarMenu`, not `GlobalNav`, so it has no `OrgSwitcher` and no `/o/` link in its chrome.
  - Card 12 surfaces DECISION-194's accepted residual and does not change it. It stays `paper` and detective, not preventive.
- **Permissions vs Flags.**
  - No new key and no new flag. Rollback is a revert.
  - Nav, cards and workspace panels are hidden unless the viewer holds the destination's key. Every destination re-checks its own key.
  - The workspace's sub-panels check their **own** keys inside a page gated by `ADMIN_ORGANIZATIONS` (R7c).
  - `/admin/docs` gains a page-level `ADMIN_RELEASE_NOTES` check. The proxy already enforces it at `src/proxy.ts:42`, and `proxy.ts` itself is not edited.
- **`permissions.ts` is FROZEN.** Q12's copy-only change is permitted within narrow bounds (R5).
- **The Brand Is a Cascade Override.**
  - `(admin)` stays in the platform palette, and `src/components/admin-portal/` renders no `<BrandTokens>`.
  - The workspace Brand section keeps the existing bounded `BrandPreviewSwatch` and the logo on a neutral plate.
  - `check:brand-scope` is unchanged.
  - The token contract stays closed (R4).
- **The Proxy Does Not Reach the Database.** Untouched. No new `PROTECTION_RULES` entry; pages own per-feature checks.
- **Organization type and slug are permanent.** **This is `paper`, not `database`.** I verified it on the live catalog:
  - `organizations` has triggers only for `guard_insert`, `guard_reparent` (`BEFORE UPDATE OF parent_id, path`) and `guard_delete`. Nothing guards `UPDATE OF organization_type` or `slug`.
  - `presby_app` holds only SELECT, so the tenant path cannot change either.
  - The owner path can, and the repo itself does: `e2e/designation-revoke.spec.ts:307` runs `update organizations set organization_type = 'presbytery'`.
  - So Increment 3's permanence line is truthful only at product level ("there is no way in PresbyPortal to change it"). See suggestion S3.
- **Verify in a Browser / HydrationGate.** The create form's missing `HydrationGate` (TODO.md:185, F124 class) is a live defect with a permanent consequence. See S2.

---

### Notes

#### Rulings on the handoff items

**R1. Tier 1 / Tier 2 placement: approved, with these structural rules.**

a. **The platform left nav persists inside the workspace,** with Organizations active. The context bar sits at the top of `<main>` on workspace routes only.

b. **No data-reading `layout.tsx` at `[id]`.**
- Layouts and pages render concurrently. A gate in a layout does not stop the page's reads, and the (org) contract already keeps auth checks in the page.
- Every section `page.tsx` calls `requireWorkspaceOrg(params)` as its first await. The helper runs in this fixed order:
  1. `auth()` and `hasFeature(ADMIN_ORGANIZATIONS)`, returning `{kind:"forbidden"}` *before* any id parsing;
  2. the `UUID_RE` check, then `notFound()`;
  3. one `cache()`-wrapped `organizations` read, then `notFound()`.
- It returns the org row the context bar needs.
- A source-scan test pins two things: every `page.tsx` under `organizations/[id]/**` calls `requireWorkspaceOrg(`, and none of them imports `getPlatformDb` before that call. Approximate the second by requiring that no page under `[id]/**` calls `getPlatformDb()` directly; section reads go through modules.

c. **Correction to Phase 1 G16/U12: no `loading.tsx` anywhere under `(admin)/admin/`. That includes `/admin` itself.**
- A `loading.tsx` wraps its own page **and every descendant route** in a Suspense boundary.
- At `(admin)/admin/loading.tsx` that boundary covers the four routes that call `notFound()`: `organizations/[id]`, `users/[id]`, `tickets/[id]` and `whats-new/[id]`. Their 404s would go out as HTTP 200. That is the same failure the (org) contract measured on 2026-08-18.
- Loading feedback for the dashboard comes from per-card `<Suspense>` inside `page.tsx`, which affects no other route.
- `(admin)/admin/error.tsx` is approved: it catches descendants and does not intercept `notFound()`. Its rules:
  - calm copy and a 44px Try again
  - never render `error.message` (it can carry values); log the error class only, as the `errorClass()` precedent in `designation-holders.ts` does
- **Pin it:** the R1b source-scan test also asserts that no `loading.tsx` exists under `src/app/(admin)/admin/**`.

d. **`error.tsx` does not catch its own segment's layout.** The new layout's live `readIsPlatformAdmin()` (for `AvatarMenu`) throws on a DB error, and that read must be wrapped in `try/catch` and degrade to `false`. A DB blip must not take down the whole console shell. The session read and the two redirects stay exactly as they are.

e. **Section routes are real URLs.** Back and deep links work. `ButtonGroup` scrolls horizontally at 360px.
- `/admin/organizations/[id]` stays the Overview, so existing deep links still land.
- Section links carry the received `?from=` forward, following the multi-level chain rule in `ui-standards`.
- `back-href.ts` accepts only `/admin` exactly, or values starting `/admin/` or `/admin?`. It rejects `//`, any backslash or control character, and anything longer than 2048 characters. Anything rejected falls back to `/admin/organizations`.
- `?org=` on `/admin/tickets` and `/admin/organizations/domains` is validated with `UUID_RE` and otherwise ignored, never echoed back.

f. **`revalidatePath` after the split.** `[id]/actions.ts` calls `revalidatePath(\`/admin/organizations/${id}\`)` about 15 times. After the split, that refreshes only the Overview. Route every one of them through `revalidateWorkspace(id)` so that a mutation made from one section never leaves a sibling section stale. Phase 3 lists the call sites.

**R2. Component placement.** Rule of thumb: anything carrying copy or a concept specific to the platform axis goes in `admin-portal/`.

| Component | Home | Reason |
|---|---|---|
| `LoadError` (calm failure plus Try again link, props: title, body, retryHref) | `shared/load-error.tsx` | Generic. `OrganizationsUnavailable` may be re-expressed on top of it only if its strings stay byte-identical (`/launch`, `/home` and `/no-organization` depend on them). Do not migrate the `(org)` `Features*`/`Roles*` blocks in this pipeline. |
| `EmptyState` (what happened, what to do, optional CTA; distinguishes "no matches" from "none") | `shared/empty-state.tsx` | Generic. `CommunityEmptyState` may adopt it later; not in this pipeline. |
| **Forbidden state** | **`admin-portal/admin-forbidden.tsx`**, **not** `shared/` | Its copy ("Ask a platform administrator") belongs to the platform axis. More importantly, a "shared forbidden" in reach of `(org)` invites someone to use it where DECISION-040 requires copy that is byte-identical across `managed`, `invited` and `unmanaged`. Keeping it admin-only removes that hazard by construction. |
| `CountCard` (whole-card link, title, count, sub-lines, `as of`, states ok, zero-all-clear and error; no gating and no reads) | `shared/count-card.tsx` | Generic presentation. It composes the `DestinationCard` affordance (U6). Gating and reading belong to the caller. |
| Section-nav wrapper | **None. Use `ButtonGroup` directly.** | `ButtonGroup` already is the GET-link segmented nav (`shared/button-group.tsx`). A wrapper adds nothing. |
| Collapsing nav | `components/ui/sheet.tsx` (generated) plus `admin-portal/admin-mobile-menu.tsx` | Build the primitive with `ui:add`, and do the composition in `admin-portal/`. A generic "collapsing-nav primitive" in `shared/` has one consumer today, so don't build it yet. |
| `AdminNav` (server shell) and `AdminNavLinks` (client leaf) | `admin-portal/` | Uses the platform nav registry. |
| `AdminHeader` (mounts `AvatarMenu` and "← PresbyPortal") | `admin-portal/` | Reuses `shared/avatar-menu.tsx` unchanged. **Not `GlobalNav`**, because its `OrgSwitcher` would put `/o/` links in admin chrome and add a tenant org-list read to every admin render. |
| `WorkspaceContextBar` (breadcrumb, type chip, platform-status and lifecycle badges, scope note, section nav) | `admin-portal/` | Workspace-only. |
| Dashboard card components (async readers bound to `CountCard`) | Co-located: `src/app/(admin)/admin/_dashboard/` | Only `/admin` uses them. |

**Sign-out.** The admin shell gets one sign-out path: `AvatarMenu`'s `signOutAction`, which lands on `/` as today. The layout's inline `signOut` server action is removed. Phase 3 should grep `e2e/` for the old "Sign out (email)" button. `layout.test.tsx`'s "← PresbyPortal → `/home`" regression stays.

**R3. Migration 0070 is not needed for G12 or G14. Both are read-only compositions of existing definitions on the platform connection.**

*G12 (effective feature state):*
- Extract the effective-state decision into a pure `resolveEffectiveOrgFeature({entry, flagOn, organizationType, categoryAxisOn, categoryEnabled, toggleEnabled}) → {effective, reason}` in `src/lib/org-features-effective.ts`. The order is flag, then type applicability, then category (only when the axis is on), then the row. The viewer-permission step is deliberately absent. The `reason` values are `"flag_off" | "type_not_applicable" | "category_off" | "off" | "on"`.
- `src/lib/admin-portal/org-feature-state.ts` gathers its inputs in bounded reads:
  - `isFlagEnabled` once per distinct non-null `entry.flag`, outside any transaction;
  - the axis flag once;
  - one `organizations` read;
  - one `organization_feature_toggles` read for the org;
  - one `categoryEnabledInTx` per distinct category, cached.
- The tenant path (`orgFeatureEnabledInTx`) may keep its short-circuit reads. It must either route its decision through the same pure function, or be pinned by a **parity test** over the full truth table of flag, type, axis, category and row. The operator's view and the church's reality must not be able to drift.
- **G13 label.** Derive it from the latest `tenant.org_feature.toggled` audit row for (org, key): `metadata.via = "platform"` reads "changed by the platform", otherwise "changed by the congregation". `updated_by = null` with no audit row reads "set when the organization was created". **Never** join `users` or `people` for the label, and never show an email.
- One bounded query covers all keys. The volume is small; `audit_events` has no org index, and that is acceptable at current scale. Phase 3 notes it.

*G14 ("waiting for a first administrator"):*
- One statement over `organizations where lifecycle_status = 'active' and platform_status in ('managed','invited')`, calling the 0060 owner-only `presby_founding_administrator_holder_count(o.id)` in the select list.
- Verified live: it is `SECURITY DEFINER`, its ACL is `neondb_owner=X` only, and the platform connection is `neondb_owner`. So this reuses the canonical definition and reimplements nothing.
- The invitation split takes one further statement: the open `founding_administrator` row per candidate org. `account_invitations_open_designation_uq` guarantees at most one per org. Its status goes through `deriveInvitationStatus()` (`src/lib/onboarding/status.ts`), never a SQL re-derivation.
- That makes two round trips with no N+1. Per-org function evaluation inside one statement is acceptable at dozens to low hundreds of organizations.
- If that ever needs to be set-based, the follow-up is a definer function defined **by composition over `presby_founding_administrator_holder_grants`**. It must not be a second holder definition.

*Migration 0070* is therefore left for S3 (Increment 3, optional). If S3 is declined, 0070 goes unused.

**R4. Semantic status treatment (G21).** The contract does not need to be reopened. `--success`, `--warning` and `--info` (plus their `-foreground` pairs) are already classified `platform` with `reserved: true` (`src/lib/brand/contract.ts:251-285`). They are reserved, not missing.
- **Increments 1 to 3: existing tokens only, and every status carries an icon plus text** (`ui-standards` lines 665 and 672):
  - **failure or blocked:** `text-destructive` with `CircleAlert` and a label, or `Badge variant="destructive"`;
  - **needs attention but not failed:** `text-foreground` on `border-border`, with `TriangleAlert` and the count in the title;
  - **all-clear:** `text-muted-foreground` with `CircleCheck` and "Nothing waiting."
  - No palette literals in any new file.
- **Increment 4: land the reserved semantic slice.** That means:
  - declare the six tokens in `globals.css` for both schemes;
  - drop `reserved`;
  - add contrast proofs to `contract.test.ts` in both schemes;
  - add `success`, `warning` and `info` variants to `Badge`, as a header-commented divergence on the primitive (Component Rule 5);
  - convert the 43 palette-literal occurrences across 16 files.
- That slice changes a contract file and a primitive, so it is **not** Polish-class. Increment 4 needs a short Phase 2 addendum for it.

**R5. Q12, the copy change to frozen `permissions.ts`: permitted, within these bounds.**
- Change only the `name` and `description` strings of the `FEATURES.ADMIN_ORGANIZATIONS` entry (`src/lib/permissions.ts:52-55`).
- Leave the key string, the `FEATURES` map, array order and the entry's category untouched. Add no entry.
- "Frozen" protects the platform axis from church-facing keys and key churn. Correcting a stale description of an existing platform key is within the file's own purpose.
- **Verified side effects:**
  - `scripts/seed.ts:97-98` inserts `features` with `onConflictDoNothing()`, so deployed `features` rows keep the old text.
  - No UI reads `features.name` or `features.description`. The only display consumer is `src/lib/dev-docs.ts:332`, which reads the TS constant.
  - So there is no seed change and no data migration. Say so in a code comment.
- `src/auth.ts` imports `FEATURE_CATALOG` but reads only keys, so this is not an auth-path change.

**R6. Layout padding: approved, and it needs a `ui-standards` note.**
- Change `<main>` to `p-4 sm:p-8` in the same commit that updates `docs/ui-standards.md` line 69 ("injects `p-8`") and checklist line 706.
- The "never add a second padding layer" rule is unchanged.
- The grid becomes single-column below `md`, with the Sheet menu button. That is verified at 360px in a browser.

**R7. Dashboard isolation, and the platform-axis-only rule as a testable property.**

a. **Per-card isolation:**
- Each card is an async server component inside its own `<Suspense fallback={<CountCardSkeleton/>}>`. It is mounted **only if** the viewer holds the key, so a reader never runs for a non-holder.
- Each reader returns `{kind:"ok", ...numbers, asOf} | {kind:"error"}`. It catches its own errors and logs the error class only. It never throws to the page, and an error is never rendered as zero.
- No `unstable_cache` or `"use cache"` on platform readers, because a cached all-clear is the U2 lie. React `cache()` within one render is fine.
- **Bounded:** each card issues one statement, or two at most (G14). Counts from the same table are combined with `count(*) filter (where ...)`, and lists are LIMITed (audit card ≤ 10). No reader loops queries in JS.
- The owner `Pool` uses the default `max` of 10, so aim for no more than about 8 platform statements per dashboard render. Concurrent operators queue; they do not fail.

b. **Enforced property: a source-scan test, `src/lib/admin-portal/dashboard/boundaries.test.ts`, modelled on `src/lib/onboarding/boundaries.test.ts`.** It strips comments, then checks every non-test file in `src/lib/admin-portal/dashboard/`:
1. Imports from `@/lib/db/domain/*` and `@/lib/db/schema` are limited to an **allow-list** of tables: `organizations`, `organizationBrands`, `organizationSettings` (the `require_two_factor` column only), `accountInvitations`, `auditEvents`, `emailQueue`, `tickets`, `feedback`, `users`, `organizationDomains`, the site table, `featureFlags`, `organizationFeatureToggles`, `organizationFeatureCategories`.
2. Every `from`/`join` identifier in raw `sql` text is in the same allow-list.
3. The only `presby_*` function named is `presby_founding_administrator_holder_count`.
4. The only `@/lib/*` module imports are `admin/giving-ingest-health`, `admin/two-factor-stranded`, `domains/platform-read`, `sites` (the admin list), `onboarding/status`, `flags`, `db` and `permissions`.

It is an allow-list, not a deny-list, so a new tenant table is forbidden by default. The test's header names the one exception. Readers for tickets and feedback return numbers and dates only; a unit test asserts the shape.

c. **Workspace sub-panels need their own keys.** The workspace page is gated by `ADMIN_ORGANIZATIONS`, but these panels each check their own key and are omitted otherwise:
- this organization's audit activity: `ADMIN_AUDIT`
- ticket count or links: `ADMIN_TICKETS`
- 2FA policy and its link: `ADMIN_TWO_FACTOR`

Cross-links to platform lists are shown only to holders of the destination's key.

d. **The 2FA exception (Q8 and card 9).**
- Both `/admin/2fa`'s stranded list and card 9 resolve "required" through `people` and `memberships` (`2fa/page.tsx:78-100`). Both tables are FORCE RLS tenant tables.
- That predicate, plus the page's `member_count`, is the whole recorded exception.
- The stranded predicate moves to `src/lib/admin/two-factor-stranded.ts` and returns `{count}` for the card and `{rows}` for the page. Card 9 shows the count only, with no emails.
- **`member_count` stays a page-local query in `2fa/page.tsx` and is never extracted or exported.** That is how "never extend it" is enforced.
- If the operator reads card 9 as extending the exception, the safe fallback is to drop card 9. Phase 3 should name this explicitly in the Copy and Carry-forward tables.

**R8. `getPlatformDb` and Two Hierarchies.**
- `getPlatformDb()` is legitimate across `(admin)/admin/**` and the new `src/lib/admin-portal/**` readers. It stays forbidden in `(org)`, `(invite)` and `src/lib/giving/**`, enforced by the existing scans.
- **No link into `/o/<slug>` from `(admin)/admin/**` or `src/components/admin-portal/**`.** Pin it in the R1b test: no `"/o/` or `` `/o/${ `` literal in those trees. The public site link goes through `SiteUrls`.
- **Audit card (12):**
  - select explicit columns plus explicit JSON paths: `action`, `actor_email`, `created_at`, `metadata->>'organizationId'` (or `resource_id`, whichever the action writes; Phase 3 verifies each action in the closed list), `(metadata->>'selfAddressed')::boolean` and `(metadata->>'inviterIsInvitee')::boolean`;
  - **never select `metadata` whole**, so the revoke reason cannot reach the component;
  - the organization name comes from `organizations`;
  - `actor_email` is allowed, because the same `ADMIN_AUDIT` holder already sees it on `/admin/audit`. The card shows no more than its destination.
- Designation holders stay display-name only (DECISION-195), through the existing `listDesignationHolders`.

**R9. MFA e2e gate: not triggered, with conditions.**
- No increment needs to edit `src/auth.ts`, `src/proxy.ts`, `src/lib/authz.ts`, `src/lib/auth/**`, `src/app/(auth)/**` or `src/app/api/auth/**`. Importing `cachedAuth`, `signOutAction` and authz *types* is not an edit.
- The gate applies the moment Phase 3 or 4 proposes any of these:
  - a new `PROTECTION_RULES` entry;
  - a helper placed under `src/lib/auth/`;
  - a change to the layout's two redirects.
- Because Increment 1 rewrites the file holding the defense-in-depth `/totp` redirect, **Increment 1's Phase 4 adds unit tests pinning both redirects** (`/signin?callbackUrl=/admin` and `/totp?callbackUrl=/admin` for required-and-unverified). **Increment 1's Phase 5 runs the existing `e2e/admin-login.spec.ts` and `e2e/totp-full-login.spec.ts`** as regression, on its own port (3530, Rule 16).

**R10. Increment split and number carriage: approved as proposed, with S1 and S2 as optional reorders.**

| Inc | Carries | Migration | Notes |
|---|---|---|---|
| **1. Platform shell** | DECISION-251, 252, 253, 255; F274, F276, F281 | none | Full pipeline. R9 regression e2e. `/admin/docs` page-level gate. The `permissions.ts` copy change (R5). Retire the tile grid and re-pin `page.test.tsx` as "a support operator sees exactly the Support cards and nav items". |
| **2. Organization tier** | DECISION-254; F277, F278, F279, F280 | **none** (R3) | Full. Phase 3 must budget for e2e churn: `designation-revoke`, `admin-organizations`, `giving-admin` and `custom-domains/*` all drive the single detail page today. |
| **3. Creation** | DECISION-256 (tech-lead: Option B and the type panel); F275 | **0070 only if S3 is adopted** | Full, with the Phase 6 founding-administrator walk at 360px. |
| **4. Sweep** | Implements the second stage of DECISION-255 | none | Polish, **except** the semantic-token slice, which needs a short Phase 2 addendum (R4). |

**Proposed decisions** (architectural; the orchestrator records them; text follows):
- **DECISION-251:** The platform console has two tiers in the existing `(admin)/admin` tree.
  - The organization workspace is real section routes under `/admin/organizations/[id]/**`, under a persistent platform nav.
  - Every section page runs gate, then UUID, then read through one helper. There is no data-reading `[id]` layout.
  - No `loading.tsx` exists under `(admin)/admin/**`, because a parent `loading.tsx` turns every descendant `notFound()` into HTTP 200.
  - No proxy rule is added, and nothing in the console links into `/o/<slug>`.
- **DECISION-252:** The platform tier shows only platform-axis data.
  - Dashboard readers live in `src/lib/admin-portal/dashboard/`, held to an allow-listed set of tables, functions and modules by a source-scan test.
  - The 2FA required-not-enrolled predicate (through `people`/`memberships`) is the single recorded exception, in one module that returns accounts, never member counts. `/admin/2fa`'s `member_count` stays page-local and is never extracted.
  - Workspace sub-panels are gated by their destination's key.
- **DECISION-253:** `src/components/admin-portal/` is the home for admin-only composition, parallel to `org-portal/`.
  - Generic pieces (`LoadError`, `EmptyState`, `CountCard`) go in `shared/`. The forbidden state is admin-only.
  - `src/lib/admin-portal/nav.ts` replaces `ADMIN_TILES` under DECISION-123's pure-registry constraints.
  - The admin shell mounts `AvatarMenu`, not `GlobalNav`, and has one sign-out path.
  - A copy-only correction to `ADMIN_ORGANIZATIONS`'s name and description in frozen `permissions.ts` is permitted, with key, map and order unchanged.
- **DECISION-254:** G12 and G14 need no migration.
  - Effective feature state comes from a pure resolver shared with the tenant path, enforced by a parity test, and computed platform-side without a viewer-permission step. The "who changed it" label comes from audit `via`, never from a user join.
  - "Waiting for a first administrator" calls the 0060 owner-only holder count in one statement and derives invitation status with `deriveInvitationStatus()`.
  - Any future set-based function must compose `presby_founding_administrator_holder_grants`.
- **DECISION-255:** Status treatment is staged.
  - Increments 1 to 3 use only the existing `destructive`, `foreground`, `muted` and `border` tokens, always with an icon and text.
  - Increment 4 lands the already-reserved `--success`, `--warning` and `--info` platform slice, with contrast proofs and `Badge` variants, under a Phase 2 addendum.
  - No new token name is introduced.
- **DECISION-256:** left to tech-lead (Increment 3 creation design, Option B).

**Proposed F-number mapping** (eight numbers for Phase 1's eight gaps, with my corrections folded in):

| F | Finding |
|---|---|
| F274 | G16, corrected: no admin `error.tsx` exists today; a `loading.tsx` at `(admin)/admin` would 200 the four `notFound()` routes. |
| F275 | G8: the create form has no `HydrationGate`, and type/slug permanence is `paper` (no `UPDATE` guard; `e2e/designation-revoke.spec.ts:307` rewrites the type). |
| F276 | G3: the 2FA stranded predicate and `member_count` are tenant-derived (the recorded exception). |
| F277 | G12: stored versus effective toggle state. |
| F278 | G13: the "who changed it" label must not join users or people. |
| F279 | G14: the waiting-for-a-first-administrator definition. |
| F280 | G11 and G24: the `?org=` and `?from=` input validation. |
| F281 | G17, corrected: `/admin/docs` is proxy-gated by `ADMIN_RELEASE_NOTES` (`src/proxy.ts:42`) but has no page check; `/admin/design-system` has no key and stays door-level, documented as such. |

#### Suggestions (Phase 3 may decline with a stated reason)
- **S1. Move card 12 to Increment 1.** It depends on nothing in G14, and it is the only place DECISION-194's accepted residual becomes visible.
- **S2. Ship the create form's `HydrationGate` as a standalone bug-fix now,** if Increment 3 is more than about two weeks out. It is a live F124-class defect whose wrong outcome is permanent, and TODO.md:185 has carried it for a while.
- **S3. Increment 3: back the permanence copy with 0070.** Add a `BEFORE UPDATE OF organization_type, slug` guard trigger on `organizations` that refuses changes, with a fixture exemption mirroring `deletable_until` so the e2e at `designation-revoke.spec.ts:307` still runs. This turns "can't be changed" from `paper` into `trigger`. It is the only thing a trigger can bind on the owner connection (DECISION-146/F44).
  - If S3 is declined, `/developer` lists the invariant as `paper`, and neither the release note nor the copy may imply database enforcement.
  - Q4 ("no correction path") is unaffected either way. A future correction would then be an explicit migration, which is the right friction.
- **S4. Keep `src/lib/admin/` and `src/lib/admin-portal/` as they are for now.** Do not consolidate them in this pipeline: B6 pins `giving-ingest-health.ts`'s path. Record it as a documentation-review item.
- **S5. If the optional "Feature adoption" card is ever added,** it must count *effective* state through the R3 resolver, or label itself "turned on (stored)". It must never show a bare "on".

#### Notes for Phase 3 (must honor)
- Every new `actions.ts` mutation references an `AUDIT_ACTIONS` key (`check:audit`). Increment 1 and 2 add no mutations. The existing toggle and holder writes are unchanged.
- **Copy-truthfulness:**
  - the permanence line is product-level only (R-Invariants, S3);
  - the scope note must not claim the platform cannot see members, because the 2FA exception exists. "It shows how {Name} is set up on PresbyPortal" is fine; avoid "never sees".
- Use "Platform admin" in all user-visible copy (G20). It matches `AvatarMenu`.
- Phase 3's Carry-forward table must list R1 to R10, S1 to S5, and every G that Phase 1 left with a default.

---

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete; R1–R10; DECISION-251–255 proposed (256 to tech-lead); F274–F281 mapped; no migration for reads (0070 reserved for optional S3); no new dependency | Approved with suggestions | 2026-10-25 |

### Handoff

**Next agent: tech-lead (Phase 3), for Increment 1 first.**
- Create the parent/child structure per CLAUDE.md: `2026-10-25-platform-admin-redesign-inc1` … `-inc4`, with Phase 1 and Phase 2 kept in this parent.
- Design Increment 1 against R1 to R2, R4 to R7 and R9. Carry R3 and R8 into the Increment 2 design.
- Rule on S1 to S5 explicitly.

**Files read**
- Worktree root: `/Users/cshenso/git/presby-platform/presby-padmin/`
  - `docs/work-log/2026-10-25-platform-admin-redesign.md`
  - `docs/ui-standards.md` (lines 69, 87–119, 222–296, 665–706)
- `/Users/cshenso/git/presby-platform/presby-padmin/src/app/(admin)/admin/`
  - `layout.tsx`, `page.tsx`, `visible-tiles.ts`
  - `layout.test.tsx` and `page.test.tsx` (test names only)
  - `2fa/page.tsx`
  - `organizations/page.tsx`
  - `organizations/[id]/page.tsx`
  - `organizations/[id]/actions.ts` (`revalidatePath` sites)
  - the `notFound()` users under this tree (located by grep)
- `/Users/cshenso/git/presby-platform/presby-padmin/src/lib/`
  - `admin-portal/tiles.ts`, `admin/giving-ingest-health.ts`
  - `db/index.ts`, `db/schema.ts` (`audit_events`)
  - `org-features.ts`, `org-feature-categories.ts`, `domains/toggles.ts`
  - `onboarding/designation-holders.ts`, `onboarding/status.ts`, `onboarding/boundaries.test.ts`
  - `onboarding/founding-administrator.ts` and `onboarding/treasurer-designation.ts` (imports only)
  - `permissions.ts`, `platform-admin.ts`, `brand/contract.ts`
- `/Users/cshenso/git/presby-platform/presby-padmin/src/components/shared/`
  - `avatar-menu.tsx`, `button-group.tsx`, `organizations-unavailable.tsx`, `global-nav.tsx` (imports)
- `/Users/cshenso/git/presby-platform/presby-padmin/src/proxy.ts` (lines 30–60)
- `/Users/cshenso/git/presby-platform/presby-padmin/scripts/check-giving-boundaries.mjs` (rule header)
- `/Users/cshenso/git/presby-platform/presby-padmin/scripts/seed.ts` (lines 91–100)
- `/Users/cshenso/git/presby-platform/presby-padmin/drizzle/0059_presby_account_invitations.sql` and `/Users/cshenso/git/presby-platform/presby-padmin/drizzle/0060_presby_designation_revoke.sql` (function bodies and ACLs)
- `/Users/cshenso/git/presby-platform/presby-padmin/e2e/designation-revoke.spec.ts:307`
- On `main`: `docs/decisions.md` (format), plus `git log` and `git diff --stat` against the worktree base.

---

# Phases 3–6 — carried by one child work-log per shipped increment

Per CLAUDE.md Per-Feature Tracking, this parent keeps the shared Phase 1 and Phase 2 above (verbatim) and the operator's rulings below. Phase 3 (design), Phase 4 (implementation), Phase 5 (verification) and Phase 6 (shipped vs intent) are recorded in the child for the increment they belong to. Judgment-agent text (analyst, architect, qa) stays verbatim in the child it belongs to.

| Increment | Scope | Child work-log | Phase 3 | Phase 4–6 | Migration |
|---|---|---|---|---|---|
| 1. Platform shell | Grouped permission-filtered nav, header with the shared avatar menu, error boundary, shared load-error / empty / count-card / admin-forbidden, the dashboard v1 (cards from existing reads, plus recent operator changes), tile grid retired, `/admin/docs` page gate, `permissions.ts` copy | `2026-10-25-platform-admin-redesign-inc1.md` | Complete 2026-10-25 | Pending | none |
| 2. Organization tier | Workspace context bar and section routes, Overview and setup checklist, Features view with effective state, per-organization health, `?org=` filters, first-administrator and invitation dashboard cards | `2026-10-25-platform-admin-redesign-inc2.md` | Pending | Pending | none (R3) |
| 3. Creation | Type explainer, permanence line, create-form `HydrationGate` (see Inc 1 ruling S2), starting-features preview (Option B), post-create landing | `2026-10-25-platform-admin-redesign-inc3.md` | Pending | Pending | 0070 only if S3 is adopted |
| 4. Sweep | Existing list pages brought to the standards; semantic status tokens (needs a Phase 2 addendum) | `2026-10-25-platform-admin-redesign-inc4.md` | Pending | Pending | none |

Numbers carried (R10): Increment 1 — DECISION-251, 252, 253, 255; F274, F276, F281. Increment 2 — DECISION-254; F277–F280. Increment 3 — DECISION-256, F275. Increment 4 — second stage of DECISION-255.

## Operator request (2026-10-25, verbatim)

> on the organization setup is there a setup screen for features that can be turned on/off.  also can you choose the base organization type?  i feel like the platform admin screen needs an overall design pass and a dashboard.  there are a buch of stuff in the left hand menu.  some might not be needed and others are more important.  kinda central to everything is organization management.  dashboard is going to be pretty important as well.  the screen is all about managing the platform.

## Operator rulings on Phase 1 (2026-10-25)

- **Q2: retire the tile grid** — `/admin` becomes the dashboard; the grouped nav is the index.
- **Q3: Option B — show, don't set.** Creation previews what the type gets and the default state; the operator sets only `operatorEnabled` toggles. Giving never pre-enabled.
- **Q8: keep `/admin/2fa`'s member count as a recorded known exception; never extend it.**
- **Q10: yes — the shared avatar menu on the admin shell**, same as the org portal.
- Q1, Q4–Q7, Q9, Q11–Q14 proceed on the analyst's defaults (Q12 and Q14 are architect rulings).
- Operator UX requirement (recorded in Phase 1): same UX principles and care as the org portal.
