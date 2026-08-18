# The Backbone, the Org Router, and Per-Org Websites — Work Log

> **Slug:** `2026-08-18-backbone-and-org-sites`
> **Surface:** mixed — public backbone, post-login router, per-org public sites, org portal shell
> **Permission(s):** TBD in Phase 3
> **Flag(s):** TBD in Phase 3
> **Estimated complexity:** large — this is a program, not a feature. Phase 1's
> first job is to decompose it into shippable pipelines.
> **Pipeline mode:** Full, run with agents (first agent-run pipeline in this repo)

---

## Operator brief (verbatim, 2026-08-18)

> "what we are calling presby for now is the main page of the backbone. it
> describes what this is and how to get onboarded and it provides a login. if you
> login from this page and you belong to multiple organizations and/or a super
> admin you would get a page with cards of the different orgs you can go into. if
> you are only a super admin you would go straight into the admin page. if you are
> a developer then you would have a card to go into the developer portal. then
> there are org specific pages that you can directly access. they should be
> fronted by a website and have the associated menu structure that could be
> different from org to org. we should be careful with the webpage because i want
> it to be super flexible (ie. ai builds it in and maintains code per org, but
> reuses shared constructs that need to be very well defined for the ai (claude
> code runnning on a cron process daily). lets stand this all up next and be very
> deliberate with architecture decisions (remember domains are going ot map to
> organization pages). also be very deliberate with ux choices. the agent should
> be pretty good at this point but we want this thing to be super modern and
> responsive and consistent."

## Decisions taken by the operator before Phase 1

These are settled inputs, not open questions:

| # | Decision | Rationale given |
|---|---|---|
| **S1** | **Site content lives in the database as ordered section rows against a shared block catalog.** The cron agent edits *data*, never per-org code. A need the catalog cannot express becomes a **new block type via the normal 6-phase pipeline**, available to every church. | A bad generated edit cannot break the build for every other congregation; revert is an UPDATE; RLS isolates it like any tenant row. It is invariant D8 (no custom fields — a new need becomes a feature for everyone) applied to websites. |
| **S2** | **A custom domain serves the public site only.** Member login links back to the backbone origin, where session, 2FA, org switcher and admin already work. | Avoids cross-origin session handoff across N domains and keeps the auth path — hardened earlier today — untouched. Accepted cost: visible origin change at sign-in. |
| **S3** | **The daily cron agent writes drafts only.** Nothing reaches a live church website unattended; a church admin publishes. | A congregation's public face is where an unreviewed AI edit does the most damage. Trust is the product. |
| **S4** | This design pass runs **with agents** — analyst and architect as independent read-only contexts. | Phase 1 gaps and Phase 2 invariant rulings should not be self-review on a design this size. |

### Taken after Phase 1, answering the analyst's open questions (2026-08-18)

| # | Decision | Closes |
|---|---|---|
| **S5** | **`users.is_platform_admin` is the developer-portal predicate.** No third axis, no new permission key. The chooser shows a Platform block (Admin + Developer) for those users. | OQ1 |
| **S6** | **The congregation owns its domain and CNAMEs to the platform.** TXT verification, daily re-check, T-30 drift alert, and **fail soft** — a lapsed domain serves the platform subdomain, never a 404. The platform takes on no registrar or renewal obligation. | OQ2, A9 |
| **S7** | **A presbytery's site carries a public directory of its non-tenant congregations**, and that block **permanently replaces** the idea of per-church sites for `unmanaged` orgs (G4). | OQ3 |
| **S8** | **The agent checks daily but proposes on an event** — staleness detected, new sermon, seasonal window, ticket filed — with one open proposal per page maximum. | OQ7 |

Still open, deferred to the pipeline that needs them: OQ4 (agent spend ceiling), OQ5 (giving link-out confirmation), OQ6 (events module pulled forward or authored calendar in v1).

### Revisions after the Phase 2 playback (2026-08-18, operator)

| # | Decision | Effect |
|---|---|---|
| **S9** | **S2 is OVERRIDDEN. A congregation's custom domain carries a real authenticated session.** Signing in from `firstpres.org` leaves you signed in *on that domain*, with a profile menu carrying the context switcher and a route to the platform admin surfaces. | Requires the primary/satellite pattern that Auth0 and Clerk document: per-origin session establishment, per-domain cookie + CSRF configuration, an N-origin callback allowlist — on NextAuth 5 beta. Operator accepted this cost explicitly after the alternative (round-trip to the backbone, same felt experience, no cross-origin work) was offered. **It destabilises the auth path and therefore gets its own pipeline and its own running-server e2e gate; it is not a P0 amendment.** |
| **S10** | **A card is granted by an active membership OR an active position** at that organization. | A ruling elder serving on a presbytery committee reaches the presbytery even though her membership is at her congregation — which is how PC(USA) service actually works. Widens P0's org-list query. **Stewardship still never grants a card**; position is a third relation, not a loophole for downward inheritance. |
| **S11** | **F4/F23 revised: an unauthorized org deep-link gets a humane, named access-denied with a path forward**, not a silent fallback and not an indistinguishable 404. | Researched: the modern pattern names the resource, hints at why when safe, and offers "request access." The enumeration objection applies weakly here because PC(USA) publishes the congregation list — the analyst said as much in A8. Architect to reconcile with its identical-404 ruling. |

### Gaps opened by the same playback

- **Staff is not modeled at all.** `officer_terms` covers ordained and elected office (ruling elder, deacon, clerk of session, moderator, treasurer, trustee); "staff" exists in the schema only as a visibility level and a data source. The church secretary, musician, custodian, preschool director, and a pastor's *employment* as distinct from ordination have no representation. Affects portal access, the website staff block (P7), and who can administer. **Needs its own pipeline.**
- **Administration at every level must be a first-class surface.** The inherited `(admin)` shell is platform operations — nine `admin.*` keys in a FROZEN file. A church administrator, a presbytery stated clerk, and a synod staffer are three distinct administrative experiences it was never designed for. Reshapes P1's scope.
- **The public site's own route was never named** — the architect ruled only that it must not live under `/o/<slug>`. Must be settled before P3.

## Ground truth at the start of this pipeline

- `presby_available_organizations(user_id)` already exists (SECURITY DEFINER) and
  returns `organization_id, person_id, name, organization_type, slug` — the org
  switcher's data source is built.
- `organizations.platform_status` — `managed` / `unmanaged` / `invited` (D9).
  Most congregations will never be tenants; a presbytery holds records about them.
- Two connections (`db` RLS-enforced, `getPlatformDb()` bypassing) and FORCE RLS
  on every tenant table.
- `src/proxy.ts` runs on the Edge and **cannot import `@/lib/db`** — any
  host→organization resolution has to respect that.
- Existing surfaces: `(auth)`, `(member)/home`, `(account)`, `(admin)/admin`,
  `(admin)/developer`, `access-pending`. No `(public)` group, no site framework.
- No sibling repo has done host-based tenant routing or a block content model —
  `../synod-portal` has a hand-written `(public)` layer, not a per-tenant one.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (agent) | Complete | READY WITH NOTES (scoped to P0) | 2026-08-18 |
| 2 — Architectural review | architect (agent) | Complete (revised) | Approved with suggestions — revised after operator playback | 2026-08-18 |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

*Recorded by the orchestrator from the analyst agent's returned section — the
judgment agents are read-only by grant (DECISION pending, see
`2026-08-18-agent-tool-restrictions`). Full output preserved; nothing summarized
away.*

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES** — but scoped: this verdict advances **P0 (the post-login router) only** to Phase 2. P1–P7 below are separate pipelines, each with its own work-log and its own Phase 1 when it comes due. Nothing in this program should go to the architect as one blob; that is how the block catalog and the menu model get decided by whoever happens to type first.

## ONE-LINE TAKE

> S1–S3 are the right three decisions and they carry the program; what the brief is missing is that "a website per church" is really six shippable things stacked on a permission system that does not exist yet, and that the daily-cron cadence and the review-surface ordering are backwards from what a church secretary can actually absorb.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Anonymous — backbone (`presby` origin) | Read what this is; find whether their church is already on it | one-time |
| Anonymous — backbone | Request onboarding for their congregation | one-time |
| Anonymous — backbone | Sign in | per session |
| Anonymous — **church public site** (custom domain) | Find service time and street address | on demand, highest-volume verb in the program |
| Anonymous — church public site | Get directions; check accessibility (ramp, hearing loop, restrooms) | on demand |
| Anonymous — church public site | Read "I'm new here"; decide whether to come | one-time, the conversion verb |
| Anonymous — church public site | Give; watch/listen to a sermon; check the calendar; contact the church | on demand |
| Anonymous — church public site | Click "Member sign-in" and cross to the backbone origin (S2) | occasional |
| Newly-authenticated, zero orgs | Read why they can't get in; find out who to ask | one-time |
| Authenticated, ≥2 orgs or platform rights | **Choose an organization** from a card page | per session |
| Authenticated, 1 org | Land directly in that org's portal; switch orgs later from the shell | per session |
| Platform admin | Land in `/admin`; return to the chooser | per session |
| Platform admin / developer | Open the developer portal | occasional |
| **Church admin (new persona — does not exist today)** | Review the agent's proposed page changes | weekly at best, monthly in reality |
| Church admin | Publish a proposed change | on demand |
| Church admin | Revert the site to how it looked before | rare, high-stakes |
| Church admin | Edit a page directly; reorder the menu; rename a nav label | occasional |
| Church admin | Attach and verify a custom domain | one-time |
| Church admin | Turn the agent off for their org | one-time, must exist |
| **Cron agent (a principal, not a user)** | Propose a draft edit; never publish | daily check, event-driven proposal |

**Pass 1 finding.** The brief is written almost entirely in the third person about the system ("there are org specific pages that you can directly access", "AI builds it in"). The only fully-specified human verb is *choose an org*. Every verb above the "church admin" divider I had to infer. The whole review-and-publish half of S3 — which is the trust story and therefore the product — has zero verbs in the brief.

## Flows

**Flow 1 — Post-login routing (P0).**
`/signin` → credentials/Google → session established → **`/` router** → destination.

Destination table. The brief gives four cases; the real matrix is nine, and six of them are unaddressed:

| Managed-org memberships | `is_platform_admin` | Destination |
|---|---|---|
| 0 | no | "Not connected to a congregation" page (**gap — see G1**) |
| 1 | no | Straight into `/o/<slug>` |
| ≥2 | no | Chooser |
| 0 | yes | `/admin` directly (brief's case) |
| ≥1 | yes | Chooser, with a separate Platform block for Admin + Developer |
| 0 managed, ≥1 **unmanaged/invited** membership | no | **Undefined today — `presby_available_organizations` does not filter on `platform_status`** (G2) |
| any, but 2FA required and unverified | any | `/totp?callbackUrl=<destination>` **before** the router renders (G3) |
| any, `isActive = false` | any | `/signin?error=deactivated` (already handled in `src/proxy.ts:36`) |
| any, deep-linked to `/o/<slug>/...` | any | Go straight there; the chooser is convenience, **never a gate** (A4) |

- Failure — user's membership was removed mid-session while they sit inside `/o/<slug>`: today `withOrgContext` throws a bare `Error` (`src/lib/authz.ts:57-62`), which surfaces as a 500/error boundary. Needs a typed error and an org-scoped `error.tsx` that says "Your access to First Presbyterian has ended" and returns to the chooser.
- Failure — `?next=` points at an org the user doesn't belong to: sanitize (helper exists at `src/lib/auth/safe-callback.ts`) **and** validate the slug against the user's own org list, or the router hands the user a 500 from `withOrgContext`.
- Failure — DB unreachable while resolving orgs: "We can't reach your congregations right now. Try again in a moment." Not a stack trace, and not a silent fallthrough to `/home` (which would look like access was revoked).

**Flow 2 — Anonymous visitor on a church's public site (P3/P5).**
Custom hostname → Edge resolves host → org → published page → render.

- Failure — hostname not verified / DNS lapsed: **fail soft.** Serve the platform subdomain content and alert the admin. A congregation's homepage must not 404 on a Sunday morning because a registrar renewal bounced.
- Failure — org has a site record but nothing published: serve a minimal courtesy page (name, address, service time, phone) rather than an empty shell. That data comes from `organizations` + settings, not from the block system.
- Failure — unknown hostname: identical response to "hostname exists but not live." No enumeration difference.

**Flow 3 — The secretary reviews the agent's work (P4/P6).**
Digest email → `/o/<slug>/site/proposals` → list in plain language ("Updated service times on *Visit*") → open one → **rendered** before/after of the affected section → Publish | Ask for a change | Discard.

- Failure — she disagrees but can't articulate the fix: "Ask for a change" must be a free-text note that becomes a ticket, not a dead end.
- Failure — she publishes and it looks wrong: "Restore this page to how it looked on [date]" — one action, whole page. See G7.
- Failure — nobody looks for a month: see G8. This is the *expected* path, not the edge case.

**Flow 4 — Onboarding a new congregation (P2).**
Backbone marketing page → "Is my church on presby?" (searches the public org tree — the tree is public per `docs/schema-design.md` §17) → not found → request form → creates/updates an org to `invited` + opens a ticket → human contact → `managed`, first admin provisioned.

- Failure — the church *is* in the tree but `unmanaged`: correct response is "First Presbyterian of Fable is in our records through Fable Presbytery, but isn't set up yet" — this is the actual sales moment and D9 makes it common.
- Failure — someone requests onboarding for a church they have no standing in: verification is a human step, and the form must not create anything that grants access.

## Permissions & Flags

**Permissions — the biggest structural finding in this section.**

There is no church-facing permission system in use. `src/lib/permissions.ts` is frozen and platform-only (nine `admin.*` keys). Every verb in the church-admin block above needs **tenant** permissions resolved by `presby_effective_permissions()`. Proposed new tenant keys, tier 1:

| Key | Meaning | Default roles |
|---|---|---|
| `site.view_drafts` | See proposals and previews | Church Administrator, Pastor, Clerk of Session |
| `site.edit` | Author/edit page content directly | Church Administrator, Pastor |
| `site.publish` | Make a draft live; revert | Church Administrator, Pastor |
| `site.settings` | Domains, theme tokens, agent on/off | Church Administrator only |

Note the F16 lesson applies directly: **every `managed` org must have at least one `site.publish` holder at creation, and the check must fail loudly.** An org with a site and no publisher can never satisfy S3 — the site is permanently frozen in draft and nobody will understand why.

Explicitly *not* granted by default: the Session group. Session governs; it does not do web edits, and granting the court a wildcard over public content is how you get eleven people who all think someone else is reviewing.

**"Developer" is not a concept and the brief assumes it is.** Today there are two unrelated platform predicates:
- `ADMIN_ROLE` / `FEATURES.ADMIN_DASHBOARD` — session claims, enforced at the Edge, gates `/admin` (`src/proxy.ts:16-21, 53`).
- `users.is_platform_admin` — read live from the DB, gates `/developer` (`src/app/(admin)/developer/guard.ts`).

The brief's "super admin" maps to the first; "developer" maps to the second. They are currently held by roughly the same people by accident, not by design. **Decide, don't ship both semantics.** My recommendation: `is_platform_admin` is the developer-portal predicate (D7 already says platform admin = boolean + separate connection), and no third axis is invented. If the operator actually wants a contractor who can read the schema but not touch user data, that is a distinct platform feature key (`platform.developer_portal`) and `guard.ts` changes — say so now, because it is one line now and a migration later.

**Flags.**
- `sites.public_renderer` — gates the whole public-site surface. Rollback: flag off → custom domains fall back to the platform subdomain courtesy page; no data change.
- `sites.custom_domains` — separable, because domains can fail independently of content.
- `sites.agent_proposals` — global kill switch for the cron agent, on top of the **per-org opt-in**, which is tenant state, not a flag (same distinction as `organization_settings.require_two_factor`, DECISION-003).
- The router (P0) does **not** get a flag. It's the login path; a half-routed login is worse than either state. Ship it whole or not at all.

## Gaps the Request Didn't Address

**G1 — The zero-org user has no page.** Today they land on `/home` and read "you haven't been granted any roles yet" — which is about *features*, not congregations, and is wrong for this program. `/access-pending` is likewise about a denied feature. A person who signs up from the backbone marketing page and has no membership needs: "You're signed in, but you're not connected to a congregation yet." Plus two doors — "Ask your church administrator to add you" and "Is your church not on presby? Get started." That page is the onboarding funnel; right now it's a dead end that reads like a bug.

**G2 — `presby_available_organizations` does not filter on `platform_status`.** It returns any org where the user has an active membership (`drizzle/0010_presby_resolver.sql:158-166`). Under D9 that includes `unmanaged` orgs, which have no portal to enter. The router must filter to `managed` (and decide about `invited` — my recommendation: `invited` orgs appear with an "In setup" badge and are enterable only by users holding `site.edit`, because onboarding *is* the work happening there). The inverse also needs stating so nobody "helpfully" fixes it: a presbytery staffer who stewards forty non-tenant congregations gets **one** card, for the presbytery. Cards are memberships, never stewardship. Stewardship reaching into the card list is downward inheritance through the back door.

**G3 — Per-congregation 2FA collides with multi-org.** `require_two_factor` is per-org (`organization_settings`), resolved at sign-in by `presby_two_factor_required()` and projected into the session as a single boolean. Today the Edge only enforces it under `/admin` (`src/proxy.ts:42-51`). Once an org portal reaches tier-2/tier-3 data, the gate must move to the org boundary — and a user with two orgs may be required at one and not the other. "Required" is therefore not a property of the session; it's a property of (session × org). The current claim cannot express that. This is a Phase 3 problem for P1 and it should be flagged to the architect now, because it may change the session shape.

**G4 — Unmanaged orgs and websites: the answer is no, and S3 already proves it.** A presbytery holds records about churches that are not tenants. Do those churches get websites? No, for three reasons, in increasing order of force:
1. Two hierarchies. A presbytery publishing a public site *as* a congregation it has no authority over is downward inheritance wearing a marketing hat. Absent an administrative commission, the presbytery has no voice in a congregation's public witness.
2. Nobody owns the content. Whose voice is "we believe"? Whose phone number gets the calls?
3. **S3 is unsatisfiable.** S3 requires a church admin to publish. An unmanaged org has no admin. The site could never go live. That settles it mechanically.

What *is* legitimate and valuable: a **congregation-directory block on the presbytery's own site** — name, address, service time, phone, a link to whatever website the church already has. That is data the presbytery already holds, published in the presbytery's own voice, at the presbytery's own domain. It is also the best onboarding funnel in the program. Recommend that block type land in the catalog and that per-church sites for unmanaged orgs be ruled out explicitly, in writing, so it doesn't get relitigated as a "quick win."

**G5 — "Menus differ per org" is the custom-fields problem relocated to navigation.** D8 exists because tenant-extensible structure becomes forty snowflakes nobody can reason about. A free-form list of label+URL rows is exactly that, and the cron agent will be the first thing to break on it. Recommendation:

- **Navigation is derived from pages, never authored separately.** `site_pages` carries `nav_label`, `nav_parent_id`, `nav_ordinal`, `nav_slot` (`primary | footer | utility | hidden`). The menu is a query. Nothing can appear in the menu that isn't a page; no page is silently orphaned.
- **Depth cap of two.** Top level plus one dropdown. Three-level menus fail on a 360px phone and fail a volunteer maintainer. Enforce it in the model.
- **Required pages per org type**, renameable and reorderable but not deletable. For a congregation: Home, Visit ("I'm new"), Worship (service times), Contact/Directions, Give. A church website without service times and a street address is the most common real-world failure in this entire category, and it must not be possible to produce one here.
- **Utility nav is platform-owned**, not per-org: "Member sign-in" (crossing to the backbone origin per S2), accessibility statement, privacy. Consistency is the product.
- `section_type` already carries an allowed `organization_type` list (`docs/schema-design.md` §14) — keep that, and extend the same pattern to required-page sets, so presbytery and synod sites differ structurally without a second engine.

**G6 — Theme is the other snowflake vector and S1 doesn't cover it.** `theme_tokens jsonb` in §14 is an open door. Constrain it to a fixed token set: a palette from a curated list, one of N type pairings, a logo, one accent. Not free CSS, not per-org stylesheets. A church that wants a genuinely bespoke layout gets a new block type through the six-phase pipeline — D8 applied to design, exactly as S1 applies it to content.

**G7 — "Revert" means something different to a secretary than to us.** To us it's an UPDATE on a section row (S1's rationale). To her it means *put the page back the way it was on Sunday*. Those diverge the moment two sections changed. Recommendation: model **page-version snapshots with a published pointer**. Publish = set `published_version_id`. Revert = set it to the previous one. One UPDATE, whole page, explainable in a sentence, and it survives the agent having touched three sections. Per-section undo is a power feature; whole-page restore is the one she will actually use, at 9pm, in a hurry.

**G8 — "The agent proposes ten changes and nobody looks for a month" is the expected path, and the brief has no answer.** Consequences: a pile of stale drafts, drafts conflicting with each other (agent edits the same section on day 3 and day 20), and — worst — a *live site that is unchanged* while time-bound content (Holy Week schedule, a closure notice) silently rots. Recommendations:
- **One open proposal per page, maximum.** The agent supersedes its own unreviewed draft rather than stacking. Ten pending items is a review that will never happen.
- **Escalating, then stopping.** Digest at day 3, again at day 10, then silence. Do not train a congregation to ignore your email. At day 30 the agent stops proposing for that org and opens a support ticket — a church that isn't reviewing needs a human, not more drafts.
- **Auto-expire drafts at 60 days**, so the queue can't become archaeology.
- **Date-bound blocks self-retire.** An announcement with an `ends_on` disappears from the live site with nobody acting. This removes most staleness without touching S3.
- **Bound blocks bypass the queue entirely.** Give every block type a `content_source: authored | bound`. A bound block renders live tenant data (service times from the events module, staff from `officer_terms`) and never enters the draft queue, because it isn't generated prose. S3's real subject is AI-written *language*; a data-bound render is not that. This is the single change that makes the whole publish loop survivable.

**G9 — S2 collides with draft preview.** S2 says the session lives on the backbone origin and the custom domain serves the public site only. Then the custom domain has no session — so `firstpres.org/visit?preview=1` cannot authenticate the viewer, and preview on the live domain is either broken or open. Resolution for v1: **preview only on the backbone origin**, at `/o/<slug>/site/preview/<page>`, rendered by the same renderer with a draft flag. Signed short-lived single-page preview tokens on the custom domain (so a pastor can look at it on his phone, or a non-admin can be shown a proposal) are a deliberate later feature with expiry, revocation, and `noindex`. Name the collision now; don't let Phase 3 discover it.

**G10 — What a congregation actually needs, split into content vs feature.** Being concrete because "flexible website" hides this:

*Content — block catalog, agent-authorable, no new modules:*
Hero with the church name, one sentence of identity, and **service times + street address above the fold** (the #1 job of a church website is answering when and where). "I'm new here": what to wear, where to park, what happens to my kids, how long it lasts, is there communion, will I be singled out — pastoral, specific, and the page nobody writes. Directions and a map. **Building accessibility**: ramp, hearing loop, accessible restrooms, large-print bulletins, gluten-free communion elements — PC(USA) congregations skew old and this is not a checkbox. Beliefs, and connectional identity ("we are part of Fable Presbytery, Synod of X, PC(USA)") — auto-populatable from `organizations.path`, cheap and correct. Missions and outreach. Small groups. **Weddings and funerals policy pages** — genuinely high-traffic, frequently searched, and almost always missing. Preschool/daycare, which for many congregations drives most of the traffic. News and the pastor's letter.

*Features — need real data or an integration, and here is what does not exist yet:*
- **Staff & officers list** → `officer_terms` exists. But this is the sharpest privacy edge in the program: the directory is tier 1 with per-field privacy (`src/lib/db/domain/privacy.ts`), and a public website is the widest possible audience. **Rule to set now: no person appears on a public site without an explicit per-person public-publication consent, distinct from directory visibility.** An elder who agreed to be in the members' directory has not agreed to be on the open internet with a photo. Do not derive public listings from directory flags.
- **Service times / calendar** → there is **no events module**. `src/lib/db/domain/` has org, people, roll, officers, groups, authz, privacy, reporting, person-ext — no events, no attendance. v1 calendar is authored text or an embed of whatever the church already uses. Do not promise a calendar block until events exist.
- **Giving** → no payments integration exists, and §14 already correctly marks giving a **sealed section** (PCI SAQ-A). v1 is a link-out/embed to Vanco, Tithe.ly, or PayPal. Do not build a payment page to fill a website block.
- **Sermons** → media hosting. v1 = embed block (YouTube, Vimeo, podcast RSS). Not our storage, not `bytea` — F13's lesson.
- **Contact / prayer request** → PII capture, therefore a sealed section: writes to a tenant table under RLS, emails a notification, needs spam protection (Turnstile is already referenced in the env inventory), and must tell the sender where the message goes. A prayer request arriving through a public form is potentially tier-3 pastoral content, which deserves a deliberate decision rather than a generic contact form.
- **Member/photo directory** → must never be a public block. Naming it so nobody adds it.

**G11 — The cron agent needs an identity, and the brief doesn't give it one.** It must be a service principal with its own tenant permission grant, its own audit provenance (§15 already anticipates `author_kind`), a per-org spend cap, and a per-org off switch. It must **not** run as a platform admin and must **not** use `getPlatformDb()`. Per STATE.md, the AI worker gets no tier-2 or tier-3 grant under any elevation — a site-building agent has no business anywhere near giving records or pastoral notes. That constraint should be written into the agent's grant, not left to prompt discipline.

**G12 — Empty states, on a brand-new install.** Chooser with one org: never renders (auto-forward) — fine, but verify the switcher is still discoverable in the shell. Chooser with zero orgs and platform admin: shows only the Platform block, and must not render an empty "Your organizations" heading. Site proposals list with nothing pending: "No proposed changes. Your site was last updated 3 days ago." — the useful information is the recency, not the absence. Public site with no published pages: the courtesy page from Flow 2, never an empty template.

**G13 — Mobile at 360px.** The chooser is a card grid — trivially fine. The two that will break: the two-level nav on a church site (see G5's depth cap), and the before/after proposal review, which cannot be side-by-side on a phone. Stacked with a clear "Before"/"After" label, and the secretary will absolutely be doing this on a phone.

**G14 — Audit story.** Security-sensitive mutations here: publishing (changes what the world sees), reverting, attaching or removing a domain, granting `site.publish`, and turning the agent on/off. All write to `audit_events` per Workflow Rule 7. Additionally, F18 applies: a **platform** action taken against a tenant's site must carry that tenant's `organization_id`, or the church can't see it in their own access log.

## Adversarial Pass (Pass 5)

| # | Vector | Finding |
|---|---|---|
| A1 | **Stale site is worse than none** | A church site advertising Christmas Eve in July is actively harmful — it tells a visitor the church may be closed. Mitigations: `content_reviewed_at` per page; a staleness badge in the admin; self-retiring date-bound blocks (G8). The agent's *first* daily job is detecting stale time-bound content, not writing new prose. |
| A2 | **An AI-written page about a funeral** | The scenario that should end the program if it happens. Enforce structurally, not by prompt: every block type carries `agent_authorable: true\|false`. Forbidden to the agent: anything touching death, illness, crisis, church discipline, doctrine, or a named living or deceased individual's circumstances. Memorial notices, prayer concerns, and pastoral letters are human-authored; the agent may place and format, never compose. No generated condolence prose, ever, under any flag. |
| A3 | **Prompt injection through tenant data** | The agent reads church-authored fields (announcements, tickets, feedback) to decide what to publish. Anyone who can type into a tenant field can attempt to steer it. Mitigation: the agent writes only typed block props validated server-side against the block's declared schema; the renderer escapes everything; **no `dangerouslySetInnerHTML` in the public renderer, ever**. An unbounded text prop is both a defacement vector and a layout breaker — cap lengths. |
| A4 | **State-machine shortcut past the chooser** | Deep-linking to `/o/<slug>/...` must work (bookmarks, emails) — so the chooser is convenience, never a gate. Consequence: **every org-scoped route enforces membership independently via `withOrgContext`.** Any route that assumes "they must have come through the chooser" is a hole. |
| A5 | **Router redirect target** | `?next=` must pass `sanitizeCallbackUrl` (`src/lib/auth/safe-callback.ts` — exists, use it) **and** be validated so its org slug is one the user actually belongs to. The v0.3 open-redirect precedent is exactly this class. |
| A6 | **Cross-org publish / domain hijack** | Hostnames are globally unique. Without DNS TXT verification, org A types in `firstpres.org` and denies it to the real owner — a denial-of-service against a congregation, delivered by us. `site_domains` needs a uniqueness constraint **and** a verification step. Publish, preview, and domain actions all scope to the acting org; a church admin at A must not reach B. |
| A7 | **Another church's draft leaks** | Four vectors, each needs a named answer: (a) preview on the custom domain — resolved by G9; (b) the public renderer runs unauthenticated with no org context, so it must read through a **narrow SECURITY DEFINER function returning published content only, keyed by verified hostname** — never `getPlatformDb()` with a WHERE clause, which is one bug away from serving everything (the F21/F26 lesson applied to the public surface); (c) `src/proxy.ts` cannot import `@/lib/db`, so host→org resolution needs a non-DB Edge path or must move into the RSC layer — this constrains the design and belongs in Phase 2; (d) crawlers — a draft must be `noindex`, and the platform subdomain must be `noindex` or canonicalised once a verified custom domain exists, or Google splits the church's SEO across two hostnames and picks the wrong one. |
| A8 | **Enumeration** | `firstpres.presby.app` for a not-live org must respond identically to one that doesn't exist. Org *existence* is public (the tree is published — §17), so 403 on `/o/<slug>` is acceptable; what must not differ is "exists, you're not a member" vs "exists, has no portal." |
| A9 | **A domain that lapses** | Decide ownership now (Open Question 2). Recommendation: **the church owns the registration and points a CNAME at us.** Store `verified_at`, re-verify daily, alert at T-30 on DNS or cert drift. And **fail soft** — a lapsed domain serves the platform subdomain, not a 404. If the platform registers domains on churches' behalf, we own a renewal obligation and a legal relationship for hundreds of small nonprofits; that is a business decision, not an implementation detail. |
| A10 | **A church leaves the platform** | Inevitable — churches close, merge, and are dismissed from the denomination (§18 marks this out of *schema* scope; it is squarely in *this* program's scope). Needs: a portable export of site content, a wind-down window during which the site still serves, clean DNS/cert release, and — invariant — **never a hard delete of a person**. The absence of an exit story is both a trust failure and a sales objection. |
| A11 | **Self-targeting** | A church admin revoking their own `site.publish` and stranding the org (G7's F16 problem in reverse). The last publisher at an org cannot remove themselves. |
| A12 | **Input boundaries** | Server-side validation of every block prop against its declared schema, on the write path, regardless of whether the writer is a human or the agent. The agent is not a trusted client. |

## Decomposition — Shippable Pipelines in Dependency Order

| # | Pipeline | One-line scope |
|---|---|---|
| **P0** | **Post-login router + org context** | The destination table above, the zero-org page, `platform_status` filtering, org-lost error handling, and a settled definition of "developer." |
| **P1** | Tenant permission catalog + org portal shell | First church-facing permission keys, `withOrgContext` wiring, org-scoped layout and switcher, per-org 2FA gate (G3). |
| **P2** | Backbone public site + onboarding | Marketing page, "is my church on presby," request-onboarding → `invited` org + ticket. |
| **P3** | Site data model + renderer (platform subdomain, hand-authored) | `sites`/`site_domains`/`site_pages`/`site_sections` + page versions, first 8–10 block types, nav-derived-from-pages, published-only read function, RLS. **No agent, no custom domain.** |
| **P4** | Church-facing site editor + publish/revert | The secretary's surface: page list, section editor, backbone-origin preview, publish, restore-to-version, staleness badges. |
| **P5** | Custom domains | TXT verification, cert issuance, Edge host→org resolution, fail-soft, noindex/canonical. |
| **P6** | The daily cron agent | Service principal, per-org opt-in, one-proposal-per-page, plain-language summaries, digests + escalation-to-ticket, spend cap, `agent_authorable` allowlist, audit. |
| **P7** | Data-bound blocks | Officers/staff (gated on public-publication consent), events/calendar (gated on an events module that does not exist), sermons, giving link. |

**P0 must be first**, for three reasons. It is the only piece that changes an existing, hardened surface (the login path), so it wants to land while that work is fresh. Everything downstream needs an answer to "which org am I in," and P0 is where that answer is defined. And it forces the developer/super-admin decision, which is ambiguous today and would otherwise be settled implicitly by whoever builds next — the worst way to settle it. It is also cheap: `presby_available_organizations` already exists, so P0 is mostly routing logic and one new page.

**P4 must precede P6, and this is not negotiable.** S3's entire safety story is that a human publishes. Ship the agent before the review surface and you get one of two outcomes: drafts nobody can act on, or someone quietly enables auto-publish to make it useful. The second is precisely what S3 exists to prevent. Build the secretary's tool first, use it by hand for a real site, *then* automate the proposals into it.

P3 should be split further at its own Phase 3 — it is the largest single piece here and "the block catalog" is really two decisions (the catalog contract, and the first ten blocks) that deserve separate scrutiny.

## Out of Scope (confirm with user)

- Per-church sites for `unmanaged` orgs — recommend ruling this out permanently (G4), replaced by a congregation-directory block on the presbytery site.
- Payment processing. Giving is a link-out in v1 (G10).
- Media hosting for sermons. Embeds only.
- The events/calendar module. Named as a dependency for P7, not built here.
- Multi-language sites. Real for some congregations; not v1.
- Per-org custom CSS or bespoke layouts. Covered by G6 — a new block type via the pipeline is the answer.
- Email/newsletter sending from the site.

## Open Questions

1. **Is "developer" the same person as `is_platform_admin`, or a separate persona?** Determines whether we add `platform.developer_portal` and change `developer/guard.ts`. One line now, a migration later.
2. **Domain ownership: church-registered with a CNAME (my recommendation), or platform-registered?** This is a business and liability question, not a technical one, and it changes P5's scope substantially.
3. **Does the presbytery site carry a public directory of its non-tenant congregations?** I recommend yes, and that it explicitly replaces the idea of sites for unmanaged orgs.
4. **What is the agent's monthly spend ceiling per org, and who pays it?** `../synod-portal` has an AI spend gate worth harvesting.
5. **Giving in v1: link-out confirmed?** If a real integration is wanted, that is its own program, not a block.
6. **Does the events module get pulled forward for service times and calendar, or is the calendar authored text in v1?** Authored text is the honest v1 answer, but it makes the most-visited block on a church site the one the agent can most easily get wrong.
7. **Cron cadence.** The brief says daily. A congregation's website has meaningful new content roughly weekly and structural content roughly never; a daily proposer against a monthly reviewer produces ~30 items nobody reads. Recommend the agent **checks daily but proposes on an event** — new sermon, staleness detected, seasonal window opened, ticket filed. Confirm that reframing before P6 is designed.

## Handoff

**Next agent: architect (Phase 2)**, scoped to **P0 only** — the post-login router and org context. Ask the architect to rule specifically on: (a) where the router lives relative to the existing `(member)`/`(admin)` route groups and whether `/` can serve both anonymous marketing and authenticated routing; (b) the Edge constraint in `src/proxy.ts` (no `@/lib/db`) as it applies to org resolution, since the same constraint returns with force in P5; (c) the session-shape implication of G3 (per-congregation 2FA in a multi-org session); and (d) a ruling on the developer/platform-admin predicate before any code is written.

P1–P7 each need their own work-log and their own Phase 1. Do not carry this section forward as though it covered them — it deliberately does not.

---

# Phase 2 — Architectural Review (architect)

*Recorded by the orchestrator from the architect agent's returned section — read-only by grant. Full output preserved.*

## Verdict

**Approved with suggestions** — scoped to P0.

The analyst's decomposition is right and P0 is the right first pipeline. I am not sending the shape back. I am ruling on the four open architectural questions, refining two of the analyst's recommendations, and adding two bounded items to P0's scope (a design-foundation minimum, and pulling the Edge 2FA gate for `/o/*` forward from P1). Four `DECISION-NNN` entries are proposed at the bottom.

Where I disagree with the analyst is named inline under **D1–D4**.

## Placement

### (a) Where the router lives — `/` splits three ways

**Ruling: `/` does not route. The routing decision gets its own route.**

`src/app/page.tsx` stays the anonymous backbone page and **must not redirect a signed-in user**. Three reasons, in increasing force:

1. A signed-in user is entitled to read their own product's front page. Bouncing them off it is hostile and makes "what is presby" unreachable to the people most likely to be asked.
2. P2 turns `/` into a real marketing page that wants to be static and eventually indexable. A per-user DB-reading redirect welds it to dynamic rendering forever.
3. P5 makes the *meaning of `/`* host-dependent (S2: a custom domain serves the church's public site at `/`). Encoding "authenticated routing" into the origin's `/` is exactly the shape that has to be unpicked when hosts start mattering.

Four routes, with exact paths:

| Path | File | Group | Job |
|---|---|---|---|
| `/launch` | `src/app/launch/page.tsx` | none (top-level, sibling to `access-pending`) | **Decide.** Zero UI on the happy path. Reads the session + org list, computes the destination, `redirect()`s. This is the single post-authentication landing target. |
| `/orgs` | `src/app/(member)/orgs/page.tsx` | `(member)` | **The chooser.** Always renders cards. Never auto-forwards. |
| `/no-organization` | `src/app/no-organization/page.tsx` | none (top-level, sibling to `access-pending`) | **G1.** The zero-org page. |
| `/o/[slug]` | `src/app/(org)/o/[slug]/page.tsx` | **`(org)` — new route group** | The org-scoped tree. P0 ships a minimal landing stub. |

**Why `/launch` and `/orgs` are separate routes and not one.** If `/orgs` auto-forwards a 1-org user, it is also auto-forwarding a 0-org platform admin to `/admin` — and that user can then *never reach the chooser to find the Developer card*, which is a direct contradiction of the operator brief ("if you are a developer then you would have a card"). Separating the decision from the surface resolves it: the chooser is always reachable ("Switch organization" in the shell, P1), and A4's "convenience, never a gate" becomes structurally true rather than a comment. It also means the destination matrix exists in exactly one file, unit-testable as a pure function, instead of smeared across `/signin`, the Google callback, and `/totp`.

`sanitizeCallbackUrl`'s fallback changes from `/home` to `/launch` (`src/lib/auth/safe-callback.ts:7-8`, plus its six tests and two e2e specs). **This is an `src/lib/auth/` change — CLAUDE.md's Phase 4 gate mandates a running-server e2e login smoke including an MFA-enrolled user before Phase 5 opens.** Flag it now so QA does not get handed a deferred advisory.

**What happens to `(member)/home`: it sits beside, unchanged in P0.**

I considered having the chooser absorb it and rejected it. `/home` carries the what's-new card and the daily feedback prompt (`src/app/(member)/home/page.tsx:45-62, 128-160`) — the feedback loop this repo just built, and which Workflow Rule 12 and the SessionStart hook depend on. Migrating those into the chooser is real work with zero P0 value and a live regression risk if it goes wrong. `/home` stays, remains reachable from `GlobalNav`, and P1 decides whether what's-new belongs in the org shell. Its "Your roles / Your features" sections are platform-shell debug output and should move to `/account` or be dropped — **P1, not P0**.

`/home` is not the post-login destination any more but is not deleted; the four remaining hardcoded references (`src/app/(account)/layout.tsx:27`, `src/app/access-pending/page.tsx:35`, `src/app/(admin)/developer/guard.ts:28`, `src/app/(admin)/admin/whats-new/actions.ts` `revalidatePath`) stay valid.

**D1 — refinement of the analyst.** `(member)/layout.tsx:13` hardcodes `redirect("/signin?callbackUrl=/home")`, so a deep link to an org route that slips past the proxy loses the deep link. Low severity (`proxy.ts:31-35` catches it first with the correct `callbackUrl`), but the `(org)` layout must not copy this bug.

### The `(org)` route group — new, and its contract

**Ruling: create `src/app/(org)/` now rather than parking `/o/` under `(member)` and moving it in P1.** A directory move is cheap, but the *contract* is what I am here to set, and it is different from `(member)`'s. Declaring it now means P1 extends a layout rather than inventing one.

**`(org)` contract** (belongs in CLAUDE.md's route-group rules):

> `(org)` — auth-only **and** org-scoped. Every page resolves its `[slug]` through `resolveOrgContext()` and reads exclusively through `withOrgContext()` on the RLS-enforced `db` connection. `getPlatformDb()` is forbidden in this subtree. No page may assume the user arrived via the chooser (A4). The Edge enforces authentication, active status, and 2FA for `/o/*`; it does **not** enforce membership.

### Slug vs id in the URL

**Ruling: the slug, `/o/<slug>/...`. Confirmed, and it is load-bearing rather than cosmetic.**

- The org tree is public information by design (`src/lib/db/domain/org.ts:16-19`, `docs/schema-design.md` §17), so a slug in a URL leaks nothing a UUID would hide.
- P5 needs the platform subdomain `<slug>.presby.app`. The slug is *already* going to be a public DNS label. Making the path segment the same token means one identifier, not two.
- The Edge can compare a path slug against a claim without a DB round-trip if we ever need it. A UUID cannot be a subdomain and is a worse cache key for P5's host→org map.

**Consequence, and P0 must pay it:** the moment a slug appears in a URL it is a contract. `organizations.slug` is currently `text not null unique` with no format constraint (`src/lib/db/domain/org.ts:34`). P0 adds, in a hand-written `drizzle/00XX_presby_*.sql`:

- `check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')` — DNS-label shaped, ≤63 chars. The four seed slugs (`northern-reach`, `alder-creek`, `bramblewood`, `quillhaven`) already conform, so this is free today and never again.
- A `comment on column` recording that **the slug is immutable**: renaming a congregation changes `organizations.name`, never `slug`. URL stability is therefore unaffected by a rename — which is the correct answer to "what happens when First Presbyterian renames," because the alternative (slug follows name) breaks every bookmark, every printed bulletin insert, and in P5 the DNS record.
- If a slug genuinely must change (merger, schism, typo at onboarding), the answer is a future `organization_slug_aliases` table serving 301s. **Not in P0.** Name it as the escape hatch so nobody solves it by making the slug mutable.

### (b) The Edge constraint — the Edge authenticates, the RSC layer authorizes

**Ruling: both layers act, with strictly different jobs, and the Edge one is not the gate.**

`src/proxy.ts` for `/o/*`:
- authenticated? (`proxy.ts:30-35`) — yes, already generic
- `isActive !== false`? (`proxy.ts:36-40`) — yes, already generic
- **2FA satisfied? — new, see (c)**
- then `NextResponse.next()`. **No membership check. No `PROTECTION_RULES` entry.**

This must be written into `proxy.ts` as a comment in the same voice as the existing fall-through block at `proxy.ts:67-79`, because the file's current shape actively invites the wrong fix: `PROTECTION_RULES` is a list of `(pattern, FEATURES.*)` pairs, and the obvious-looking move is to add `{ pattern: /^\/o\//, required: FEATURES.SOMETHING }`. That would be wrong twice — `FEATURES.*` is the **platform** axis and org membership is the **tenant** axis (`src/lib/authz.ts:8-22`), and it is unenforceable at the Edge regardless.

Authorization lives in `src/lib/authz.ts`, in a new function:

```
resolveOrgContext(userId: string, slug: string)
  → { organizationId, personId, name, organizationType, platformStatus } | null
```

**The resolution order is the security property and must not be inverted.** Resolve the slug *within the user's own membership set* (via the SECURITY DEFINER function, which is scoped by `p.user_id = p_user_id`). Do **not** look up `organizations` by slug and hand the resulting id to `withOrgContext` — that path resolves orgs the user has nothing to do with, and turns "not a member" into a 500 from `src/lib/authz.ts:63-68` instead of a 404. The existing function already returns `person_id` alongside `organization_id`, which is precisely the `(personId, organizationId)` pair `withOrgContext` needs; one call answers both.

`withOrgContext` remains the authoritative gate and re-checks membership inside the transaction (`src/lib/authz.ts:55-68`). That is not redundant — `resolveOrgContext` is a read outside the transaction, and the in-transaction check is what makes the check unsatisfiable by the context it authorizes.

**Does this paint P5 into a corner? No — it un-paints one.** In P0 the org identity comes from the path; in P5 from the host. The corner to avoid is baking "org context is a path segment" into the resolver. It is not: `resolveOrgContext` takes a **slug**, and the path segment is merely one way to produce one. P5's Edge does host→slug (a small, cacheable map — Edge Config, or an Edge-cached fetch to a route handler, neither of which imports `@/lib/db`) and rewrites to a slug-bearing path. Because P0 chose the slug, P5's map key and the platform subdomain label are the same string. A UUID in the URL would have forced host→uuid, which is a worse cache key and unreadable in logs.

**One boundary P3/P5 must not cross, and I am setting it now:** the public site tree does **not** live under `/o/<slug>`. `/o/` is the authenticated portal. The unauthenticated published-content renderer (A7b) gets its own segment and its own reader. Two different trust surfaces must not share a URL prefix, or the first `layout.tsx` that adds an auth check to `/o/` breaks every church's website, and the first one that removes it exposes drafts.

### (c) Session shape — defer, and here is why it is not a migration-shaped regret

**Ruling: `twoFactorRequired` stays a single boolean in P0. Defer per-org refinement to P1. And extend the Edge 2FA gate to `/o/*` in P0.**

The claim is already **most-restrictive-wins**: `presby_two_factor_required()` returns true if *any* org the user belongs to requires it (`drizzle/0013_presby_two_factor_policy.sql:44-49`, `src/lib/auth/local-login.ts:96-100`). So today's shape **over**-enforces, never under-enforces. A user required at church A and challenged on entering church B gets a redundant TOTP prompt — a UX papercut, not a security hole.

The second half of the argument is the one that settles it: **`twoFactorVerified` is legitimately session-level.** Completing TOTP proves possession of a factor; possession does not become unproven when you switch congregations. So the per-org question is only ever *whether to challenge*, never *whether verified*. Per-org refinement can therefore only ever make the system **less** strict. That is the safe direction to defer in.

If and when P1 wants it, the claim becomes **additive**, not replacing:

```
token.twoFactorRequiredOrgIds?: string[]   // orgs requiring it, from the same SECURITY DEFINER function
token.twoFactorRequired: boolean            // unchanged: users.two_factor_required || ids.length > 0
```

Cost to the Edge gate: a bounded string array in the session cookie, and — the real cost — **the Edge would then need slug→id to match a path segment against org ids**, which it cannot do without a DB. Two ways out, both cheap: carry slugs instead of ids in that claim, or keep the boolean at the Edge and refine per-org inside the `(org)` layout, which already has the resolved org. **This is a JWT claim addition. JWTs are re-minted on the next request, `projectJWTOntoSession` already defaults conservatively (`src/lib/auth/session-projection.ts:24` — missing → `true`), and no table changes.** No migration, no regret.

**D2 — I disagree with the analyst on timing.** Phase 1 puts the gate move in P1. I am pulling it into P0: `src/proxy.ts:42` becomes `pathname.startsWith("/admin") || pathname.startsWith("/o/")`. One line. Rationale: doing it in P1 creates a window in which a tier-2 org page could ship before the gate moves, and the conservative direction is free here. I verified the un-enrolled case is not a dead end — `src/app/(auth)/totp/page.tsx:26-30` redirects a user with no enrollment to `/account/2fa?callbackUrl=...`, so a member of a requiring congregation is walked into enrolment rather than stranded. That check is why this is safe to pull forward; it was not obvious.

### (d) Org list source — widen the function, filter in the caller, read per request

**I checked before ruling.** `presby_available_organizations` has exactly one consumer: `availableOrganizations()` at `src/lib/authz.ts:139-151`, and that TS function has **no callers anywhere in `src/`**. It is built and unwired. That makes changing it free *today* and never again.

**Ruling on the function: widen it and rename it, in one hand-written migration.**

```
drop function if exists presby_available_organizations(uuid);
create function presby_user_organizations(p_user_id uuid)
returns table (organization_id uuid, person_id uuid, name text,
               organization_type text, slug text,
               platform_status text, ended_on date)
```

Three changes, each with a reason:

1. **Return `platform_status`; do not filter on it inside the function.** The function's honest job is "where does this user belong." Filtering inside would make it lie, and would force a second function the moment a caller needs the unfiltered truth — which G1's zero-org page immediately does: "your only congregation is still being set up" is a *different message* from "you're not connected to a congregation," and only the unfiltered list can tell them apart. Policy belongs in TypeScript where it is unit-testable and shows up in a diff.
2. **Return `ended_on`; stop filtering `ended_on is null` inside.** This is what makes the analyst's org-lost microcopy possible without violating A8 — see the three-way response table below.
3. **Rename.** Once it returns ended and unmanaged memberships, "available" is false. Renaming a function nobody calls costs nothing; renaming it in six months costs a migration and a grep.

The security boundary is `where p.user_id = p_user_id and p.merged_into_id is null` (`drizzle/0010_presby_resolver.sql:163-164`). **Widening the columns must not touch that predicate** — it is the entire reason SECURITY DEFINER is safe here. Say so in the migration comment, in the voice of the existing one.

Two TS wrappers in `src/lib/authz.ts`, so the safe default is the short name:
- `availableOrganizations(userId)` — active + `managed` only. What the chooser renders.
- `userOrganizations(userId)` — everything. What `/no-organization` and the org-lost path read.

**The three-way response, which resolves A8 against the analyst's microcopy requirement:**

| `resolveOrgContext(user, slug)` finds | Response |
|---|---|
| an **active** membership at a `managed` org | enter |
| an **ended** membership at that org | "Your access to *Alder Creek Presbyterian Church* ended on 12 June 2026." Return to chooser. **No leak** — they already knew the org exists and that they were a member. |
| anything else — no such slug, org exists but no membership, membership at an `unmanaged` org | **404, identical in every case** |

That last row is A8 satisfied structurally rather than by careful 403 authorship: one response covers "doesn't exist," "exists, not a member," and "exists, no portal."

**On `invited` orgs — I refine the analyst rather than follow him.** Phase 1 recommends `invited` orgs appear with an "In setup" badge, enterable by holders of `site.edit`. `site.edit` does not exist until P1/P4. **In P0: `managed` only produces an enterable card.** An `invited`-only membership changes the *copy* on `/no-organization` ("Alder Creek is being set up — we'll email you when it's ready") but yields no card and no route. The `site.edit` refinement lands when there is a tenant permission to check. P0 must not acquire a dependency on a permission system that does not exist.

**Ruling on JWT vs per-request: read per request. Never cache the org list in the JWT.** Three reasons:

1. **Precedent already set, deliberately.** `src/app/(admin)/developer/guard.ts:15-16` reads `is_platform_admin` live rather than from the session, with the comment "so revoking platform admin takes effect immediately instead of at the next token refresh." Caching org membership in the JWT is the same mistake with a worse blast radius, and the analyst named mid-session membership loss as a real failure.
2. **It buys nothing on the gate path.** `withOrgContext` re-checks membership inside the transaction on every org-scoped read regardless (`src/lib/authz.ts:55-68`). A cached list could only ever be an optimistic pre-filter for the chooser, and the chooser is not a gate.
3. **Cookie budget.** `jwt()` already carries `roles` + `features` (`src/auth.ts:306-335`) and already hits the DB on every authenticated request (`src/auth.ts:284-287`) — the marginal SELECT is nothing. Org counts are unbounded in principle (a stated clerk, a presbytery staffer with several memberships), and the 4KB cookie is shared.

**Direct consequence, stated so nobody "optimizes" it back:** the Edge cannot pre-filter `/o/<slug>` by membership. That is correct, not a limitation.

### (e) The design system — a bounded minimum is a P0 dependency; the rest is a parallel pipeline

**I evaluated this rather than punting it, and the dependency question is easier than it looks: adopting shadcn properly costs zero new runtime dependencies.**

`class-variance-authority@0.7.1`, `clsx@2.1.1`, `tailwind-merge@3.6.0`, `@radix-ui/react-slot`, `react-dialog`, `react-dropdown-menu`, `react-label`, `react-switch`, and `lucide-react` are **already in `package.json`**. The shadcn CLI is an `npx` invocation that copies source files; it installs nothing. And `src/lib/utils.ts` with `cn()` — the prerequisite for every shadcn primitive — **does not exist**, despite both of its dependencies being installed. The current state is "we paid for the design system and never took delivery."

Against my own criteria: (1) not solved by an existing dependency — nothing here is a dependency at all; (2) maintained and Tailwind-v4-compatible; (3) Edge-irrelevant (render-layer only); (4) bundle impact ~0 for three token-driven components; (5) MIT throughout.

**Ruling — split into a hard minimum and a parallel track.**

**In P0 (blocking, small, and it is the chooser's own scope):**

1. `src/lib/utils.ts` exporting `cn()` (clsx + tailwind-merge). Not `server-only` — shared.
2. `components.json` — initialise shadcn, so future primitives are *generated* and my own Component Rule 2 ("don't hand-edit them, they're generated") becomes true rather than aspirational.
3. Exactly three generated primitives: **`button`, `card`, `badge`**. All three are server-safe (no `'use client'`), and `button` uses `@radix-ui/react-slot`, already present. This is precisely what the chooser needs and nothing more.
4. Expand `src/app/globals.css` from 6 tokens to the shadcn set (`--primary`, `--secondary`, `--destructive`, `--card`, `--popover`, `--ring`, `--radius`, plus the existing six), **keeping every current token name working** so no existing page changes appearance.

**Why the minimum is genuinely blocking and not deferrable.** Seven pages hand-roll `<table>`; eight hand-roll the same button classes (`src/app/page.tsx:36-37`, `(auth)/totp/page.tsx:57-58`, `(member)/home/page.tsx:112, 118`, and so on — the exact same string, copied). The chooser is the first genuinely new user-facing page in a program whose stated requirement is "super modern and responsive and consistent." Shipping the ninth copy of a hand-rolled button *while being asked for consistency* is the wrong call, and P3's entire block catalog will be built on top of whatever the org-facing surfaces look like when it starts.

**Parallel track — `P0.5 — Design foundation`, its own work-log and its own Phase 1.** Not a P0 blocker (migrating existing pages is a pure refactor with no functional content, and P0 should not carry it), and it **must land before P3**. Scope: migrate the 7 tables to a `Table` primitive and the 8 buttons to `Button`; add `input`/`select`/`dialog`/`sheet`/`tabs`; regenerate `src/components/ui/alert-dialog.tsx`, which is hand-written on `@radix-ui/react-dialog` rather than generated; decide dark-mode strategy; reconcile `docs/ui-standards.md` (562 lines of conventions with nothing enforcing them) against the primitives so the doc describes the code.

**Dependencies pre-approved for P0.5, so that pipeline does not have to come back to me:**

| Dep | Verdict | Note |
|---|---|---|
| `@radix-ui/react-alert-dialog` | **Approved** | Required to regenerate `alert-dialog.tsx` properly. MIT, ~5KB, already a Radix consumer, Workflow Rule 2 depends on this component being correct. |
| `tw-animate-css` | **Approved** | CSS-only, MIT, zero JS bundle. shadcn's Tailwind-v4 animation utilities. |
| `next-themes` | **Not approved yet — bring it to me with the dark-mode decision.** | Today dark mode is `prefers-color-scheme` only (`globals.css:14-24`). Adding a `.dark` class strategy is a behavior change and a client-side provider at the root; it deserves its own ruling, not a drive-by install. |

**P0 keeps `prefers-color-scheme` unchanged.** The token CSS must be structured so a `.dark` class can be added later without re-authoring.

### Server vs Client split

Everything in P0 is a **Server Component**. There is no `'use client'` in this pipeline.

- `/launch` — server; redirects.
- `/orgs` — server; the card grid is static markup. A filter/search would need a client island; with fewer than ten cards it is not warranted and is **out of scope**.
- `/no-organization`, `/o/[slug]` — server.
- `ui/button`, `ui/card`, `ui/badge` — all server-safe.
- The org switcher (P1) will want a client `DropdownMenu` island around a server-rendered `<Link>` list — `@radix-ui/react-dropdown-menu` is already installed. **Not P0.**

### Dependencies

**New runtime dependencies required by P0: none.** Confirmed against `package.json`. `components.json` is config, not a dependency; the shadcn CLI is `npx`-only. Two additions pre-approved for P0.5 (table above), one deferred.

## Invariants Touched

**Two Hierarchies Intersect Nowhere — respected, and P0 is where it could most easily be broken.**
Cards are memberships, never stewardship (G2). This is enforced *structurally*, not by review: `presby_user_organizations` joins `memberships`, a membership relation. **Nothing in P0 may join on `organizations.path` or `parent_id` to build a card list.** A presbytery staffer stewarding forty `unmanaged` congregations gets exactly one card — the presbytery's — because they hold exactly one membership. Stewardship reaching the card list would be downward inheritance through the back door, and it would arrive looking like a helpful feature. Write that sentence into the resolver's comment.

Second arm: `users.is_platform_admin` grants a **Platform block** (Admin + Developer), never an org card. A platform admin with zero memberships sees zero org cards. Platform-ness is not above the ecclesiastical axis and must not manufacture entries in it.

**S5 confirmed — no third axis.** `users.is_platform_admin` is the developer-portal predicate; `src/app/(admin)/developer/guard.ts` is unchanged; no `platform.developer_portal` key is created. This closes the analyst's OQ1.

**Isolation Is a Database Property — respected.**
The `(org)` subtree reads exclusively through `withOrgContext()` on the RLS-enforced `db` connection. **`getPlatformDb()` is forbidden anywhere under `src/app/(org)/`** — write that into the group's layout comment. Widening `presby_user_organizations` adds columns; it must not touch `where p.user_id = p_user_id and p.merged_into_id is null`, which is the entire reason SECURITY DEFINER is safe there.

**RLS enforces tenancy, not authorization — respected, and this is the one place P0 could get it wrong quietly.**
Slug→org-id resolution happens *inside the user's own membership set*. Looking up `organizations` by slug (that table is deliberately not tenant-isolated, so the lookup succeeds for every org on the platform) and handing the id to `withOrgContext` would produce a bare 500 from `src/lib/authz.ts:63-68` for every non-member and would put an unauthorized org id one refactor away from a `set_config`. Resolve first, then set context.

**The Edge gate — extended, not weakened.**
`proxy.ts` gains 2FA enforcement on `/o/*` (D2). It gains **no** membership check and **no** `PROTECTION_RULES` entry — `FEATURES.*` is the platform axis, org membership is the tenant axis, and mixing them at the Edge is unenforceable anyway. Add the prohibition as a comment in the same voice as the existing fall-through block at `proxy.ts:67-79`, which exists precisely because someone would otherwise "helpfully" add a catch-all.

**Permissions vs Flags — respected; P0 introduces neither.**
No new `FEATURES.*` key. No new tenant permission key (those are P1). **No flag on the router** — the analyst is right and I am endorsing it explicitly: a half-routed login is worse than either state, so it ships whole or not at all. `is_platform_admin` is neither a permission nor a flag; it is a column, per D7, and stays one.

**No Real Data — respected, with new fixture work required.**
`scripts/seed-dev.sql` currently has an `unmanaged` org (`quillhaven`, line 36) with **no person and no membership at it** — so G2's `platform_status` filter is untestable today, and so is the zero-org page. P0 must add, in the existing invented-name / `example.invalid` house style: (i) a user whose only membership is at the `unmanaged` org, (ii) a user with memberships at both `unmanaged` and `managed` orgs, (iii) a signed-in user with zero memberships. Without these the destination matrix cannot be verified in Phase 5.

**Composite Tenant Keys — respected.** `resolveOrgContext` returns `(person_id, organization_id)` from a single row, which is the composite shape the schema is built on. It must never assemble that pair from two queries.

**Never Hard-Delete a Person / The Roll Is the System of Record / The Court Is Not a Group — untouched.** P0 reads memberships and organizations; it writes nothing.

### CLAUDE.md changes required — yes, three, and one is a pre-existing gap

1. **Project Layout** gains `src/app/(org)/o/[slug]/` — org-scoped tree; slug is the URL identifier; `withOrgContext` only.
2. **Route-group rules** gain the `(org)` contract as quoted above.
3. **A `Post-Login Landing` section must be written.** It is referenced by the agent roster's `(member)` rule ("no 2FA gate — see CLAUDE.md → Post-Login Landing") **but does not exist in CLAUDE.md today** — I grepped. P0 is the pipeline that gives it content: the nine-case destination matrix, `/launch` as the single post-auth target, and the `/home` vs `/orgs` split. Closing this is in P0's scope, not the documentation review's.

## Notes for Phase 3

Things the tech-lead must honor, in rough implementation order.

1. **The destination matrix is a pure function.** `computeDestination(input) → string` in its own module, unit-tested across all nine rows, with `/launch/page.tsx` as a thin shell that gathers inputs and calls it. Do not inline the matrix into a page component; it is the highest-value test target in this pipeline and it will be edited by every subsequent P.

2. **Do not catch `redirect()`.** `next/navigation`'s `redirect()` throws `NEXT_REDIRECT`. `/launch` needs a try/catch around the **org-list fetch only** — a `try { orgs = await ... } catch { ... }` that wraps the redirect will swallow every successful route and produce a blank page. This has bitten many codebases; call it out in the design doc.

3. **DB-unreachable while resolving orgs.** Must not fail-open to a zero-card chooser (reads as "your access was revoked") and must not fall through to `/home` (same). `/launch` renders an explicit "We can't reach your congregations right now — try again in a moment" state with a retry, rather than redirecting. That means `/launch` is a page that *usually* redirects, not a page that *always* does.

4. **`?next=` / `callbackUrl` handling, and be clear which half is security.** `sanitizeCallbackUrl` (`src/lib/auth/safe-callback.ts`) stays a pure string function — **do not teach it about org slugs.** `/launch` sanitizes, then if the result is under `/o/`, extracts the slug and checks it against the resolved managed-org list; on mismatch it **falls through to the normal destination** rather than redirecting. Frame this correctly: it is UX, not security. The security is the independent 404 at `/o/<slug>` (A4). The v0.3 open-redirect class is handled by `sanitizeCallbackUrl` alone.

5. **`OrgAccessError`.** Replace the bare `throw new Error` at `src/lib/authz.ts:63-68` with an exported typed error, and add `src/app/(org)/o/[slug]/error.tsx`. Note the division of labour: the common case (bookmark, revoked access) is caught by `resolveOrgContext` returning null → the three-way response table above, so `error.tsx` only handles the genuine race where membership is removed *between* resolve and transaction. It should still say something human.

6. **De-duplicate by `organization_id`.** `people` is per-org, but nothing structurally prevents two active memberships for one person at one org, or two non-tombstoned person rows. Either would render two cards for one church and make `resolveOrgContext` non-deterministic. De-dup in the TS wrapper, deterministically (prefer the earliest `started_on`), and add a fixture row if you want it covered.

7. **Migration is hand-written.** `drop function presby_available_organizations(uuid)` + `create function presby_user_organizations(...)` + the `slug` CHECK + the column comment all live in `drizzle/00XX_presby_*.sql`. Drizzle Kit emits none of it. `drizzle/0013_presby_two_factor_policy.sql:49` contains a comment referencing `presby_available_organizations()` by name — update it in the same commit or it drifts on day one. Implementer for this slice: **database-admin**.

8. **Suggested implementer split.** database-admin (migration + seed fixtures) → api-developer (`resolveOrgContext`, `userOrganizations`, `computeDestination`, `proxy.ts`, `safe-callback` fallback) → ux-developer (shadcn init + three primitives + tokens, chooser, zero-org page, `/o/[slug]` stub, `error.tsx`). If the tech-lead judges this small enough for **full-stack-developer**, that is a reasonable call — but the migration slice should still be reviewed with a database-admin's eye, because the SECURITY DEFINER predicate is the security boundary.

9. **Phase 4 gate is stricter than usual here.** This touches `src/lib/auth/safe-callback.ts` and `src/proxy.ts`. CLAUDE.md requires a running-server e2e login smoke including an MFA-enrolled seeded user before Phase 5 opens, and QA must return **BLOCKED**, not PASS, if it is deferred. Existing specs asserting the `/home` landing (`e2e/admin-login.spec.ts:42`, `e2e/role-boundaries.spec.ts:25-31`) will need updating — update them deliberately rather than as a green-tests chore, since they encode the old contract.

10. **Out of P0, and I am naming them so they are not quietly absorbed:** the org switcher UI, the org portal shell/layout content, tenant permission keys, `invited`-org entry, migrating what's-new/feedback off `/home`, the per-org 2FA claim refinement, and the existing-page design migration (P0.5).

## Handoff

**Next agent: tech-lead (Phase 3)**, scoped to **P0 only**. OQ1 is closed (S5 confirmed). OQ2 and OQ3 are settled by S6/S7 and belong to P5 and P3 respectively. OQ4–OQ7 remain open and are not P0's business.

---

# Phase 2 Revision — Architectural Review (architect), 2026-08-18

*Scoped revision following the operator's Phase 2 playback (S9/S10/S11 + three opened gaps). Recorded by the orchestrator from the read-only architect agent. Nothing in the original Phase 2 section is deleted — this supersedes specific rulings by name.*

## Verdict

**Approved with suggestions** — P0 still advances, and I am **not** escalating the program back to Phase 1.

Three of the five items change my earlier rulings; two do not. The largest change is not the one the operator expected: **S10 does not require widening any query.** The schema already forces the relationship the operator wants — `officer_terms` and `role_grants` both carry a composite foreign key into `memberships`, so a position at an organization is *structurally impossible* without a membership row at that organization. The genuine defect S10 exposes is a missing integrity guard, not a missing union. That finding is at `drizzle/0008_presby_domain.sql:524` and `:546`.

**Escalation judgment.** The program does not go back to Phase 1. But S9 and both gaps are *new pipelines with no Phase 1 at all*, and each must get one before it reaches me again. Do not let "the architect already ruled on S9" become a substitute for the analyst's five passes on a cross-origin authentication feature — that would be the single worst process outcome available here.

## Item 1 — S9: a real authenticated session on a church-controlled domain

**Ruling: accepted, with the auth architecture rejected as framed and replaced.** This does not need a different auth library. It needs a different *shape* than the one S9 describes, and the replacement is both safer and cheaper than what the operator agreed to pay.

### What S9 assumes, and why it is wrong for this codebase

The Clerk/Auth0 pattern exists because in their world a satellite is **a different application**. In presby a custom domain is **not a different application**. It is `firstpres.org` CNAME'd at the same Vercel deployment; the church controls a DNS record and nothing else. Copying a pattern designed for N independent apps onto one app serving N Host headers imports the ceremony without the reason, and imports one thing that is actively dangerous: it teaches you to think of the church origin as *trusted infrastructure we operate*, when it is a **third-party-controlled name pointed at us**.

Two mechanical blockers on the literal reading:

1. **Cookies cannot span registrable domains.** `presby.app` and `firstpres.org` share no cookie jar; no `domain` attribute, no `sameSite` value, and no NextAuth option changes that. There is no "one session, N origins." There are only N sessions and a handoff.
2. **OAuth cannot be per-origin at this scale.** Google requires every redirect URI to be pre-registered. N custom domains is N console entries, added by hand, per congregation, forever.

NextAuth 5 beta.31 as configured is a single-origin JWT-cookie setup with `trustHost: true` and a shared Edge-safe config imported by `src/proxy.ts`. NextAuth v5 *does* support lazy per-request config, so per-host cookie naming is technically reachable — but reaching for it means threading N hostile hostnames through the exact module the last hardening pass just stabilised.

### The ruling: platform origin is the identity provider; the church origin is a relying party with its own narrow credential

- **`src/auth.ts` and `src/lib/auth/config.ts` are not modified.** NextAuth continues to serve exactly one origin. All credential entry, all OAuth, all TOTP, all lockout and rate-limit logic stay on `presby.app` and stay single-origin. The auth path hardened earlier today is not destabilised — which was the entire justification for S2, and it survives S2's override.
- **A church origin gets a second, purpose-built credential**: a signed, `__Host-`-prefixed, **org-scoped** session cookie minted by our own route handler on that host. It is not a NextAuth session and must never be one.
- **Sign-in from `firstpres.org` is a satellite-initiated round trip the user never sees as a detour**: satellite sets a nonce, redirects to the platform origin, the platform authenticates (or recognises an existing platform session), mints a single-use handoff token, redirects back, the satellite consumes it and sets its own cookie.
- **`trustHost: true` stops being config and becomes a security control.** Today it is bounded because we serve one hostname. Under S9, arbitrary attacker-chosen `Host` values reach the app by design. Host trust must become an **allowlist of verified hosts** (`site_domains.verified_at is not null`), riding the same Edge-cacheable host map P5 already needs. This is a P5 requirement I am adding now.

### The threat model

The church controls the DNS record. That yields exactly three capabilities:

**(T1) Re-point the CNAME after verification.** The hostname stays in our allowlist while traffic goes to hardware the church (or whoever bought the lapsed domain) controls. Any handoff token in flight is delivered to the attacker. This is the primary threat and it is why the token's *contents* matter more than its transport.

**(T2) Cookie tossing from a sibling host.** `mail.firstpres.org` — the church's webmail, a vendor, or an XSS on any host under that registrable domain — can `Set-Cookie` with `Domain=firstpres.org`, and the browser will send it to us. **Mitigation is mandatory: the satellite cookie uses the `__Host-` prefix** (Secure, `Path=/`, no `Domain` attribute), which browsers refuse to accept from a domain-scoped `Set-Cookie`. NextAuth's default `__Secure-authjs.session-token` does **not** carry this prefix — a second reason not to reuse it.

**(T3) Serve arbitrary content at the hostname**, including phishing that looks like us.

**The isolation boundary, stated as a rule:**

> A session minted on a third-party-controlled host is scoped to exactly one organization, carries no platform authority, and cannot be exchanged for a session on any other origin.

Concretely: `firstpres.org` can carry a session that reads First Presbyterian's member surfaces. It **cannot** carry `/admin`, **cannot** carry `/developer`, and **cannot** carry another congregation's portal. The profile menu's context switcher and its platform-admin route are **links that cross back to the platform origin**. The operator gets the header, the profile menu, the switcher, and the route to admin. What the operator does not get — and must not get — is platform authority *evaluated on a hostname a third party can take away*.

**What the handoff token must prove**, non-negotiable, all six:

1. **Issuer + integrity** — signed by the platform, with a key distinct from the NextAuth session secret. Compromise of one must not forge the other.
2. **Audience bound to the exact host and the org that host is verified for.** A token minted for `firstpres.org` is inert at `secondpres.org` and inert at `presby.app`. This neutralises T1: the attacker who steals a token in flight obtains, at most, the victim's access to the very church whose domain he already controls.
3. **Subject, auth time, and 2FA state (`amr`).** Carrying `twoFactorVerified` forward is what stops the satellite becoming a 2FA downgrade path. If the org requires 2FA, the challenge happens on the platform origin — which owns the TOTP secrets — *before* the token is minted.
4. **Single use**, with a server-side `jti` consumed atomically. Second presentation is not merely rejected — it is an audit event, because it is the signature of T1.
5. **TTL ≤ 60 seconds.** A handoff is a redirect, not a session.
6. **Non-transitivity, in writing.** There is no reverse token. Crossing from a satellite back to `presby.app` requires the platform cookie, which the church host never sees and cannot mint. Say this in the module header, because "just let the satellite mint a platform token, it's the same app" is the refactor that destroys the whole boundary and will look like a simplification.

Plus: every satellite mint writes an audit event carrying host, org, and user (Workflow Rule 7); per **F18** it carries the *tenant's* `organization_id` so the church sees it in their own access log.

### Prerequisite I am making blocking

`next-auth@5.0.0-beta.31` carries **GHSA-x445-f3h2-j279 — OAuth state/nonce/PKCE cookies not provider-bound** (already the top URGENT line in `docs/TODO.md`). Building a multi-origin token handoff on top of an auth library with an open advisory about *cookies not being bound to the thing that issued them* is indefensible. **The beta.32 bump ships before this pipeline starts.** Not a suggestion.

### Pipeline and P-ordering

**New pipeline: `P10 — Satellite sessions on custom domains`.** Depends on P5 (there are no verified hosts to trust before P5) and on the beta.32 bump. **Last in the program**, and correctly *not* a P0 amendment — P0 is unaffected in every particular. New work appends as **P8**, **P9**, **P10** rather than renumbering.

Phase 4 gate for P10: it touches auth by any reading, so the running-server e2e smoke with an MFA-enrolled user applies, and QA returns **BLOCKED**, not PASS, if deferred.

### Does S9 invalidate DECISION-034's "`/` stays anonymous"? No — it strengthens reason 3.

"`/` stays anonymous" was always a ruling about **routing**, not **rendering**: `/` must never redirect a signed-in user. A signed-in header on a church homepage is personalisation, not routing.

One rider is needed. A church homepage that reads a session server-side is dynamic forever, which is the wrong trade for the highest-volume anonymous page in the program. **Rider: the identity chip on any public `/` is a client island / Suspense-streamed slot fed by a route handler on that host — never a server-side session read in the page body.** Applies to the platform `/` too.

## Item 2 — S10: a card granted by membership OR position

**Ruling: my earlier ruling stands, and S10 requires no query change. The premise is already false in the schema, and the real defect is a missing integrity guard.**

```
-- drizzle/0008_presby_domain.sql:524
ALTER TABLE "officer_terms" ADD CONSTRAINT "officer_terms_person_fk"
  FOREIGN KEY ("person_id","organization_id")
  REFERENCES "public"."memberships"("person_id","organization_id")

-- drizzle/0008_presby_domain.sql:546
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_person_fk"
  FOREIGN KEY ("person_id","organization_id")
  REFERENCES "public"."memberships"("person_id","organization_id")
```

**A ruling elder cannot hold an `officer_terms` row at the presbytery without a `memberships` row at the presbytery. The insert is rejected by the database.** Same for a role grant. This is the composite-key invariant (F2) doing its job, and it means:

- `presby_available_organizations` **already returns the presbytery** for that elder. Read the join again: `join memberships m on m.person_id = p.id and m.ended_on is null`. There is **no filter on `current_roll`.** A membership row with `current_roll = null` — the presbytery-committee elder, the church secretary who worships elsewhere, the installed pastor's relationship with the congregation he serves — is returned today, unchanged.
- `withOrgContext` checks **the same predicate**. It is exactly consistent with the card query. There is no position-only user for it to reject, because the FK guarantees none can exist.

**The crux the operator named is real, but one case narrower than stated.** The FK constrains `(person_id, organization_id)`; it says nothing about `ended_on`. So this state is reachable:

> A membership row is ended (`ended_on` set) while an `officer_terms` row at the same org is still open.

That person keeps a seated, minuted office and loses their card and their portal — silently, on a date with no corresponding write. It is F29's shape (time passing, not a write) applied to office rather than roll. **This is the actual bug S10 is pointing at**, and the fix is an integrity guard:

> **An active officer term implies an active membership at the same organization.** Ending a membership while an open term or an open role grant exists at that org must fail loudly, naming the term. Do not auto-end the term — ending a term is a minuted act with an `end_reason`, and having the platform silently end one to satisfy a cache is precisely the class of quiet correction the roll invariant exists to forbid.

Enforced by trigger (a paper invariant here would be invisible), in a hand-written migration, with a `scripts/test-rls.sql` assertion. **Owner: database-admin. A small, real, P0-adjacent slice.**

**On stewardship, unchanged:** the card query joins `memberships` and must never join `organizations.path` or `parent_id`. Position does not become a loophole for downward inheritance because position *is anchored on membership* — there is no third relation to leak through. The sentence worth writing into the resolver's comment:

> **`memberships` is the universal relationship anchor.** Roll status is a *column on it*, not its meaning. Every org record about a person — position, role grant, note, tag — composite-keys through it.

**Consequence for chooser copy:** a card must not say "member of." The elder's presbytery card and the secretary's congregation card are relationships, not memberships-on-the-roll, and labelling them "member" is both wrong and, for a secretary who worships elsewhere, mildly insulting. Card copy is the org name and type.

**Net effect on P0: zero query change, one new trigger, one copy constraint.**

## Item 3 — S11: humane access denied

**Ruling: I revise. The operator and the analyst are right, and my identical-404 was over-broad by exactly one case.**

I collapsed four cases into two because I was protecting one thing: **`platform_status`**. PC(USA) publishes its congregations; PC(USA) does not publish *which congregations bought our software*. That reasoning was sound and still is.

What was **not** sound was collapsing "this slug is not an organization at all" into the same bucket. That distinction leaks only the public org tree — the same tree **P2 is explicitly building a public search over**. I was hiding, at a cost in humanity, information the program is about to publish on purpose.

**Revised response table, superseding the three-way table above:**

| `resolveOrgContext(user, slug)` finds | Response | Named? |
|---|---|---|
| active membership at a `managed` org | enter | — |
| **ended** membership at that org | "Your access to *Alder Creek Presbyterian Church* ended on 12 June 2026." Return to chooser. | Yes |
| slug resolves in the **public org tree**, no membership — **whatever the `platform_status`** | **403.** "You don't have access to *First Presbyterian Church of Fable*." Plus a path forward. **Byte-identical whether the org is `managed`, `invited`, or `unmanaged`.** | Yes |
| slug resolves to nothing in the public org tree | **404** | No |

**What stays indistinguishable:** row 3 covers `managed`, `invited`, and `unmanaged` with **one string**. The copy may not say "not set up yet," may not vary its wording, its status code, or its response time by platform status. That is analyst A8 satisfied precisely as A8 stated it.

**Implementation constraint:** the org name for the 403 comes from a **public-tree read** returning name and type only. It must not come from `presby_user_organizations` (which now returns `platform_status`).

**Does "request access" imply a data model? Yes — and P0 must not acquire it.** It needs a pending-request table, a notification target, a rate limit, and an audit trail. The notification target is the disqualifier: **there is no tenant permission catalog until P1**, so there is no way to answer "who at this congregation receives this request." P0's path forward is static copy, no button. `org_access_requests` belongs to P1. Adversarial note for its Phase 1: a Request Access button behind a **public** org list is a mass-notification vector against every congregation in the denomination.

## Item 4 — the public site route

**Ruling: `/site/<slug>/...` on the platform origin.** One segment, organization-type-neutral (presbyteries and synods get sites too, so `/church/` is wrong), unambiguous against `/o/`, readable in logs. It pairs teachably with the editor: **`/o/<slug>/site` edits what `/site/<slug>` serves.**

Route group: **`(public)`** — new, sibling to `(org)`. Contract:

> `(public)` — unauthenticated by definition. Reads **only** through the narrow SECURITY DEFINER published-content reader keyed by verified host/slug (A7b). `getPlatformDb()` is forbidden. No session read in the page body; identity is a client island. No `dangerouslySetInnerHTML`, ever (A3).

**Canonicalisation:**

| Address | Verified custom domain exists | No custom domain |
|---|---|---|
| `firstpres.org` | **Canonical.** 200, self-referencing canonical, indexable, in `sitemap.xml`. | n/a |
| `<slug>.presby.app` | **301 → the custom domain.** | **Canonical.** 200, self-canonical, indexable. |
| `presby.app/site/<slug>` | **Never canonical. Always `noindex`.** Internal rewrite target; a direct hit gets a 308. | Same. |

Two subtleties Phase 3 must not lose:

1. **The redirect is conditional on current verification — the S6 interlock.** S6 promises fail soft. When daily verification fails, `<slug>.presby.app` **stops redirecting**, serves directly, and becomes self-canonical for the duration. A canonical tag pointing at a domain that no longer resolves would de-index the congregation at exactly the moment their DNS broke — a registrar lapse on a Friday would cost them their search presence, delivered by us.
2. **Canonical always points at the host currently serving verified content.**

Drafts and previews are `noindex` unconditionally (G9). **This unblocks P3.**

## Item 5 — the two newly-opened gaps

### (a) Staff is not modeled

**Confirmed:** "staff" exists in this schema only as a visibility level and a data-source enum value. There is no employment model. `officer_terms` is ordination and election.

**Does its absence block P1 (portal access)? No — and the reason is Item 2's finding.** Employment is not the access predicate. The church secretary gets into the portal because she has a `memberships` row (roll may be null) and a `role_grants` row — and `role_grants` composite-keys through `memberships` too. The access spine is complete today. State this explicitly, because the tempting "fix" is to invent a parallel staff-based access axis, which would be a second tenancy relation competing with the one the whole schema is keyed on.

**Does its absence block P7 (website staff block)? Yes.** A staff block needs employment title, display order, photo, bio — none of which exist. And the shortcut is dangerous: **do not derive the public staff block from `officer_terms`.** That would put ruling elders' and deacons' names on the open internet by virtue of being elected — the consent violation G10 named.

**Ruling:** new domain module `src/lib/db/domain/staff.ts`, not an extension of `officers.ts`. Ordination is lifelong, service is termed, employment is neither, and a minister's terms of call is a third thing again. Compensation and terms of call are **tier 2**. New pipeline **P8 — Staff, employment, and terms of call**. Depends on P1, blocks P7, own Phase 1. **Does not block P0.**

### (b) Administration at every level

**Ruling: `src/lib/permissions.ts` stays FROZEN and `(admin)` stays platform-only. Tenant administration lives inside `(org)`, at `/o/<slug>/admin/...`.** Three reasons:

1. **Two hierarchies.** One shell whose access is decided by two incompatible axes — Edge `FEATURES.*` claims versus per-org per-date tenant permissions resolved in-transaction — is exactly the mixing DECISION-035 forbade, relocated into a route group. A church administrator in the platform admin shell is the "platform admin is above a national admin" error wearing a nav bar.
2. **The RLS contract differs.** `(org)` already mandates `withOrgContext()` and forbids `getPlatformDb()`.
3. **Reuse belongs at the component layer.** Extract the admin chrome — page header, table shell, section nav — into `src/components/shared/` as part of **P0.5**, and let both shells consume it. Identical look, different trust boundary.

**Are church / presbytery / synod three surfaces? No — one surface with capability-driven navigation.** Which sections render is a function of `(organization_type, resolved tenant permissions)`. Three route trees would triple the code and guarantee drift, and the schema already models org-type variation as *data*. **Rule: one `(org)` admin tree; never a directory per council type.**

**Does this reshape P1? Yes.** P1 keeps its scope (permission catalog, `withOrgContext` wiring, org layout + switcher, per-org 2FA). New pipeline **P9 — Tenant administration surface**, depends on P1, consumes P0.5's shared chrome, own Phase 1. "What does a stated clerk actually do on a Tuesday" is a Phase 1 question and I am not going to answer it from an architect's chair.

## Invariants Touched

- **Two Hierarchies Intersect Nowhere** — respected, now enforced in two more places: a satellite session carries no platform authority (Item 1); tenant administration never enters the platform shell (Item 5b). Position does not create downward inheritance because position anchors on membership (Item 2).
- **Composite Tenant Keys (F2)** — this revision is largely *powered by* F2. The composite FKs are what make S10 a non-event and what make "membership is the universal relationship anchor" true rather than aspirational.
- **Isolation Is a Database Property** — unchanged. `withOrgContext` is not weakened; I explicitly rejected the version of S10 that would have required relaxing it.
- **The Roll Is the System of Record** — protected by the Item 2 guard's *loud failure* design: ending a membership under an open term raises rather than silently ending the term.
- **No Real Data** — the Item 2 guard needs a fixture (ended membership + open term) in `scripts/seed-dev.sql` house style, or it is untestable in Phase 5.
- **Verify in a Browser** — flagged hard for P10: cookie prefix behaviour, cross-origin redirects, and Safari/iOS cookie policy are exactly the class of defect invisible to `tsc`, `next build`, and `curl`.

## Notes for Phase 3 (additions to the original ten)

11. **The Item 2 guard is a small P0-adjacent slice.** Trigger + `test-rls.sql` assertion + a seed fixture (ended membership, open term). Implementer: database-admin.
12. **The 403 reader is a separate, narrow function** returning organization name and type from the public tree. Do not satisfy it from `presby_user_organizations` — one careless prop-drill turns the humane 403 into the leak it was designed to avoid.
13. **P0 card copy carries no membership language.** Org name and type only.
14. **The `next-auth` beta.32 bump is a hard prerequisite for P10.** If it slips, P10 does not start.
15. **CLAUDE.md updates now number five**, not three: the original three, plus the `(public)` route-group contract, plus the `(org)` admin sub-tree note. Only the first three are P0's scope.
16. **Three new pipelines require their own Phase 1 before they reach me again** — P8, P9, P10. "The architect already ruled" is not a substitute for the analyst's five passes, least of all on cross-origin authentication.

## Handoff

**Next agent: tech-lead (Phase 3)**, scoped to **P0 only**, carrying both the original Phase 2 section and this revision.

What changed for P0 specifically:

1. **Item 2 adds one small database slice** (the membership/term integrity trigger + fixture). The org-list query is untouched.
2. **Item 3 replaces P0's miss-case response** — four cases, not three. No pending-request table.
3. **Item 4 names `/site/<slug>` and the `(public)` group** — unblocks P3, does not touch P0's code.
4. **Items 1 and 5 do not touch P0 at all.** P10, P8, P9 are new pipelines with dependencies stated.
