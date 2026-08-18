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

### Branding — operator decisions, 2026-08-18 (foundational, not deferrable)

Every organization carries its own branding, and it **carries through both the public
website and the portal**. Not congregations only — presbyteries and synods too.

| # | Decision | Consequence |
|---|---|---|
| **S12** | **Full re-skin.** Branding reaches every surface of the website *and* the portal, not just chrome. | Every component becomes a theme surface. Contrast must hold per organization across the whole UI, not on a handful of accents. Switching context between two churches re-paints the interface — which is legible, and must not be disorienting. |
| **S13** | **A congregation supplies its real brand colour; the platform derives accessible ramps from it.** Their hex is an input to a token pipeline, never painted directly onto an interactive surface. | AA is guaranteed *by construction* rather than by hope. Slice B chose blue-600 over blue-500 because white-on-blue-500 is 3.7:1 — that guarantee cannot survive a raw colour picker, and this is how it survives instead. Requires a real ramp generator and a contrast validator. |
| **S14** | **Typography is a curated set of pairings**, not arbitrary fonts. | Real variety without webfont payload on rural connections or legibility roulette for the population that struggles most. |

**Where it lives.** `theme_tokens jsonb` in schema-design §14 sits on `sites` — the public
website. Branding that reaches the portal cannot live there, because the portal is not a site.
It belongs to the **organization**, alongside `organization_settings.require_two_factor`.

**What stays un-brandable.** §14 already established the principle for the website:
*"Sealed sections (giving, sign-in, any PII capture) may be placed but never restyled,
keeping donation forms in PCI SAQ-A scope and bounding what AI skinning can touch."*
That extends into the portal — and the platform admin shell stays neutral in every case,
because it is presby's surface, not a tenant's.

**Open, for that pipeline's Phase 1:** logos need a dark-mode variant or they vanish against a
dark header (and light mode has only worked since 2026-08-18); whether a platform/denominational
baseline exists that organizations override; and the ruling that a presbytery must **never**
inherit branding downward onto a congregation — visual identity is the congregation's own, on an
axis where access already flows up and not down.

**Blocks:** P1 (the org portal shell is the first branded surface) and P3 (the block catalog
inherits whatever the token contract says). **Does not block P0.**

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
| 3 — Technical design | tech-lead | Complete | Design complete (scoped to P0), implementers named | 2026-08-18 |
| 4 — Implementation | database-admin → ux-developer → api-developer → ux-developer (4 slices) | Complete — A (schema + fixtures), B (design foundation), C1 (server half), C2/C3 (pages, e2e, docs) | Typecheck, lint, 505 unit tests, 59 isolation assertions, 63 e2e, build all pass | 2026-08-18 |
| 5 — Verification | qa | Ready to start | — | — |
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

---

# Phase 3 — Technical Design (tech-lead), 2026-08-18

**Scope: P0 only** — the post-login router and org context. P0.5 and P1–P10 are
out. Carries both Phase 2 sections; **where they conflict the Revision wins**,
and the three places that happens are named inline (§Miss response, §Card copy,
§Item-2 trigger).

## Summary

Today every authenticated path lands on `/home`, a platform-shell page that
knows about roles and features and nothing about congregations. P0 replaces that
with a routing layer: `/launch` is the single post-authentication target and
holds the nine-case destination matrix as a pure function; `/orgs` is the card
chooser and never auto-forwards; `/no-organization` is the honest end of the
funnel for someone with no congregation; `/o/[slug]` opens the `(org)` tree
under a contract that every future org page inherits. Underneath, the
already-built-and-unwired `presby_available_organizations` is dropped and
recreated as `presby_user_organizations` — wider, filtering nothing, with policy
moved into two TypeScript wrappers — the slug becomes a checked, immutable URL
contract, and the missing integrity guard behind DECISION-039 lands as a pair of
triggers. shadcn is initialised at last (zero new runtime dependencies) so the
chooser is the first page built on primitives rather than the ninth copy of a
hand-rolled button. Nothing in P0 writes tenant data; the risk is concentrated
entirely in the login path, which is why the running-server e2e gate applies and
why the work lands in three separately revertible slices.

## Permissions & Flags

- **New `FEATURES.*` key(s): none.** `src/lib/permissions.ts` stays FROZEN and
  untouched. No `PROTECTION_RULES` entry for `/o/`.
- **New tenant permission keys: none.** The tenant catalog is P1. P0 must not
  acquire a dependency on a permission system that does not exist (Phase 2, (d),
  on `invited` orgs).
- **Default role bindings: none.**
- **Feature flag: not needed, and deliberately so.** A half-routed login is
  worse than either state — analyst and architect both said it, and I am
  endorsing it a third time so nobody adds one "for safety." Rollback is a
  revert of slice C, which is why slice C is one commit.
- **`users.is_platform_admin`** is neither a permission nor a flag; it is a
  column read live from the database (D7, S5, and the `developer/guard.ts`
  precedent). Never cached in the JWT.
- **Audit events: none in P0, deliberately.** See Edge Cases R7 — auditing the
  403 would hand any signed-in user a slug-guessing loop that writes rows into
  every congregation's access log.

### The predicate the matrix actually needs — a refinement, not a restatement

Phase 1's matrix has one column labelled `is_platform_admin`. **It is two
columns**, and conflating them ships a bug on day one:

| Predicate | Source | What it gates today |
|---|---|---|
| `canAccessAdmin` | session claims — `roles` includes `ADMIN_ROLE`, or `features` includes `FEATURES.ADMIN_DASHBOARD` (`src/proxy.ts:20, 53`) | whether the Edge lets you into `/admin` |
| `isPlatformAdmin` | `users.is_platform_admin`, read live (S5) | the Developer portal (`developer/guard.ts:22-28`) |

They are held by roughly the same people **by accident**. Nothing seeds
`is_platform_admin` — grep-verified: no writer exists in `scripts/`, `src/`, or
`e2e/`. So a routing rule that sends `is_platform_admin` holders to `/admin`
would send them to a page the Edge bounces to `/access-pending`, and a rule that
sends `canAccessAdmin` holders straight to `/admin` would make the Developer
card the operator asked for permanently unreachable for anyone who holds both.

Resolution, and it satisfies both sentences of the brief:

- **`canAccessAdmin && !isPlatformAdmin && 0 orgs` → `/admin`.** "If you are
  only a super admin you would go straight into the admin page."
- **`isPlatformAdmin` (any org count) → `/orgs`.** "If you are a developer then
  you would have a card." The chooser is the only place that card can live.

## API Contract

No HTTP routes and no server actions. P0's contract is five function signatures
and their exact return shapes. Implementers follow these literally.

### 1. `computeDestination` — the matrix, pure

**File:** `src/app/launch/destination.ts` (+ `destination.test.ts` beside it).

Colocated with its only consumer rather than in a new `src/lib/` subdirectory —
matches the `src/app/(member)/feedback/actions.test.ts` precedent and avoids
inventing a directory the architect did not rule on. It imports nothing: no
`server-only`, no `@/lib/db`, no `next/navigation`.

```ts
export interface DestinationInput {
  /** Managed + active organizations, de-duplicated by organization id. */
  enterableOrgs: ReadonlyArray<{ slug: string }>;
  /** users.is_platform_admin, read live from the database. */
  isPlatformAdmin: boolean;
  /** Would the Edge admit this user to /admin? roles∋ADMIN_ROLE || features∋ADMIN_DASHBOARD. */
  canAccessAdmin: boolean;
  /** Already passed through sanitizeCallbackUrl(). null when absent. */
  requestedPath: string | null;
}

export type DestinationReason =
  | "requested-path"
  | "single-org"
  | "platform-admin-only"
  | "chooser"
  | "no-organization";

export interface Destination {
  path: string;
  reason: DestinationReason;
}

export function computeDestination(input: DestinationInput): Destination;
```

Returning `{ path, reason }` rather than the architect's bare `string`: the
reason is what makes nine unit tests assert the *rule* that fired rather than a
string that two rules happen to share, and it costs nothing.

**Rules, in order. First match wins.**

1. `requestedPath` is non-null **and** its pathname is not `/launch` (loop
   guard) **and** — if it starts with `/o/` — its slug is in `enterableOrgs`
   → `{ path: requestedPath, reason: "requested-path" }`.
   A `/o/` path whose slug is *not* enterable falls through to rule 2; it is not
   an error. **This is UX, not security** (Note 4): the security is the
   independent resolve at `/o/<slug>`, and the open-redirect class is handled by
   `sanitizeCallbackUrl` alone.
2. `enterableOrgs.length === 1 && !canAccessAdmin && !isPlatformAdmin`
   → `{ path: "/o/" + slug, reason: "single-org" }`.
3. `enterableOrgs.length === 0 && !canAccessAdmin && !isPlatformAdmin`
   → `{ path: "/no-organization", reason: "no-organization" }`.
4. `enterableOrgs.length === 0 && canAccessAdmin && !isPlatformAdmin`
   → `{ path: "/admin", reason: "platform-admin-only" }`.
5. otherwise → `{ path: "/orgs", reason: "chooser" }`.

Slug extraction, exactly:

```ts
function orgSlugFromPath(path: string): string | null {
  const [pathname] = path.split(/[?#]/);
  const parts = pathname.split("/").filter(Boolean);   // "/o/alder-creek/x" → ["o","alder-creek","x"]
  return parts[0] === "o" && parts[1] ? parts[1] : null;
}
```

**Two rows of the matrix are deliberately absent from this function and must
stay absent:**

- *2FA required and unverified.* Handled by the Edge on the **destination**, not
  here. `/launch` is not 2FA-gated; `/admin` and `/o/*` are. So the chain is
  `/launch` → `redirect("/o/alder-creek")` → proxy → `/totp?callbackUrl=/o/alder-creek`
  → verify → `/o/alder-creek`. One mechanism, correct `callbackUrl`, zero code.
- *`isActive === false`.* Handled at `src/proxy.ts:36-40`, before `/launch`
  renders.

- *DB unreachable* is also not a `Destination`. It is handled in the page before
  this function is called, which is what keeps the function total.

### 2. `presby_user_organizations` wrappers — `src/lib/authz.ts`

```ts
export type OrganizationType =
  | "general_assembly" | "synod" | "presbytery"
  | "congregation" | "new_worshiping_community";

export type PlatformStatus = "managed" | "unmanaged" | "invited";

export interface UserOrganization {
  organizationId: string;
  personId: string;
  membershipId: string;
  name: string;
  organizationType: OrganizationType;
  slug: string;
  platformStatus: PlatformStatus;
  /** 'YYYY-MM-DD', or null when the relationship is current. */
  endedOn: string | null;
  /** ISO timestamp. Ordering input only; never rendered. */
  membershipCreatedAt: string;
}

/** Everything, unfiltered, de-duplicated by organizationId. */
export async function userOrganizations(userId: string): Promise<UserOrganization[]>;

/** What the chooser renders: endedOn === null && platformStatus === "managed". */
export async function availableOrganizations(userId: string): Promise<UserOrganization[]>;
```

- `endedOn` is a **string**, not a `Date`. `npm run check:sql-date` bans
  `sql<Date>`; raw-SQL dates arrive as `'YYYY-MM-DD'`. Format for display with
  the existing `FormattedDate` component (`mode="date"`), which already owns the
  timezone-safe rendering.
- **De-duplication (Note 6), deterministic.** The SQL orders
  `organization_type, name, (ended_on is not null), created_at, id`, so the
  wrapper de-dups by *taking the first row per `organizationId`* and nothing
  more. Note the tiebreaker is **not** `started_on` — `memberships` has no such
  column (verified: `src/lib/db/domain/people.ts:214-290`). Note also that
  `memberships_person_org_key` is unique on `(person_id, organization_id)`, so
  **the only reachable duplicate vector is two non-tombstoned `people` rows
  carrying the same `user_id`** — which is exactly what the dedup fixture seeds.
- `availableOrganizations` is defined as a filter over `userOrganizations`, one
  DB round trip, so the two can never disagree.
- Neither swallows errors. A DB failure propagates; the caller decides. (Note 3.)

### 3. `resolveOrgContext` — `src/lib/authz.ts`

```ts
export interface OrgContext {
  organizationId: string;
  personId: string;
  name: string;
  organizationType: OrganizationType;
  slug: string;
  platformStatus: PlatformStatus;
}

export type OrgResolution =
  | { kind: "ok"; org: OrgContext }
  | { kind: "ended"; name: string; endedOn: string }
  | { kind: "forbidden"; name: string; organizationType: OrganizationType }
  | { kind: "not-found" };

export async function resolveOrgContext(
  userId: string,
  slug: string,
): Promise<OrgResolution>;
```

**Algorithm. The order is the security property and must not be inverted.**

1. `const rows = await userOrganizations(userId)` — de-duplicated, ordered.
2. `const match = rows.find(r => r.slug === slug)`.
3. `match && match.endedOn !== null` → `"ended"`. **Checked before the
   `platform_status` test**, so an ended relationship at an `unmanaged` org is
   still named and dated — that discloses nothing about tenancy.
4. `match && match.platformStatus === "managed"` → `"ok"`.
5. `match` (i.e. active at an `invited` or `unmanaged` org) → `"forbidden"`,
   using the org name from `match`.
6. no `match` → `await publicOrgSummary(slug)`; found → `"forbidden"`, else
   `"not-found"`.

Never look `organizations` up by slug and hand the id to `withOrgContext` —
`organizations` is not tenant-isolated, so that lookup succeeds for every org on
the platform and turns "not a member" into a 500 from `src/lib/authz.ts:63-68`.
Resolve inside the membership set, then set context.

### 4. `publicOrgSummary` — `src/lib/authz.ts`

```ts
/** Public org tree only: name and type. Never platform_status. */
export async function publicOrgSummary(
  slug: string,
): Promise<{ name: string; organizationType: OrganizationType } | null>;
```

Plain Drizzle select on `organizations` through the **RLS-enforced `db`
connection with no org context** — legal because `organizations` carries a bare
`grant select ... to presby_app` and no policy (`drizzle/0009_presby_rls.sql:90-93`).
`getPlatformDb()` is forbidden. It selects `name` and `organizationType` and
**must not select `platformStatus`** — Revision Note 12: one careless prop-drill
turns the humane 403 into the leak it was designed to avoid. Add a
`scripts/test-rls.sql` assertion that `select count(*) from organizations` with
no GUC set returns the full tree, because that read is now load-bearing for a
user-facing page and would otherwise be verified by nothing.

### 5. Small server helpers

```ts
// src/lib/platform-admin.ts   — new file, `import "server-only"`
export async function readIsPlatformAdmin(userId: string): Promise<boolean>;

// src/lib/authz.ts — exercises the real gate without reading any tenant data
export async function assertOrgAccess(personId: string, organizationId: string): Promise<void>;

// src/lib/authz.ts — replaces the bare throw at src/lib/authz.ts:63-68
export class OrgAccessError extends Error {
  readonly personId: string;
  readonly organizationId: string;
}
```

`readIsPlatformAdmin` is the third copy of the same four-line select
(`developer/guard.ts:22-26`, `developer/schema.json/route.ts:30-35`); extracting
it now stops the fourth. Both existing call sites should adopt it — their
`redirect("/home")` targets stay as they are (Phase 2: the four hard-coded
`/home` references remain valid).

`assertOrgAccess` wraps `withOrgContext(personId, orgId, async () => {})`. The
`/o/[slug]` stub calls it and reads nothing else, so P0 proves the
in-transaction membership re-check and the `OrgAccessError` path end-to-end
while exposing zero tenant data.

## Data Model

One hand-written migration: **`drizzle/0014_presby_org_router.sql`**. Drizzle Kit
emits none of it. Add the matching `drizzle/meta/_journal.json` entry in the same
shape as `0013_presby_two_factor_policy`.

**Do not edit `drizzle/0013_presby_two_factor_policy.sql:49`.** The architect's
Note 7 asks for the stale `presby_available_organizations()` reference to be
corrected there; I am overruling that on mechanics — every hand-written
migration **is** in `_journal.json`, so `db:migrate` compares file hashes and an
edit to an applied file makes it look unapplied. Put the forwarding note in
0014's header instead ("supersedes the function named in 0013's comment"). The
docs that *do* get corrected are listed under Files to modify.

### 1. `organizations.slug` becomes a URL contract

```sql
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_slug_format') then
    alter table organizations
      add constraint organizations_slug_format
      check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$');
  end if;
end $$;

comment on column organizations.slug is
  'DNS-label-shaped public identifier, and the URL segment in /o/<slug>. IMMUTABLE: renaming a congregation changes name, never slug. The slug lives in bookmarks, in printed bulletin inserts, and (P5) in the platform subdomain label <slug>.presby.app, so a slug that follows the name breaks all three at once. If one genuinely must change - merger, schism, a typo at onboarding - the answer is a future organization_slug_aliases table serving 301s, not an UPDATE.';
```

All four seed slugs already conform, so this is free today and never again. The
constraint is **also declared in `src/lib/db/domain/org.ts`** with the identical
name, via Drizzle's `check()`, because CLAUDE.md requires `schema.ts` to match
what the migration does and a CHECK is expressible in Drizzle. After applying
0014, run `npm run db:push` and confirm it proposes **no** changes — that is the
proof the two agree.

### 2. The org-list function: dropped, widened, renamed

```sql
drop function if exists presby_available_organizations(uuid);

create function presby_user_organizations(p_user_id uuid)
returns table (
  organization_id       uuid,
  person_id             uuid,
  membership_id         uuid,
  name                  text,
  organization_type     text,
  slug                  text,
  platform_status       text,
  ended_on              date,
  membership_created_at timestamptz
)
language sql stable security definer as $$
  select o.id, p.id, m.id, o.name, o.organization_type::text, o.slug,
         o.platform_status, m.ended_on, m.created_at
    from people p
    join memberships m   on m.person_id = p.id
    join organizations o on o.id = m.organization_id
   where p.user_id = p_user_id
     and p.merged_into_id is null
   order by o.organization_type,
            o.name,
            (m.ended_on is not null),   -- current relationships first
            m.created_at,
            m.id;
$$;

revoke all on function presby_user_organizations(uuid) from public;
grant execute on function presby_user_organizations(uuid) to presby_app;
```

Three changes from the original, each with a reason to record in
`comment on function`:

1. **`ended_on is null` is gone from the WHERE.** It is now a returned column.
   That is what makes the named-and-dated "your access ended" response possible
   without a second query.
2. **`platform_status` is returned and not filtered.** Policy lives in the two
   TypeScript wrappers, where it is unit-testable and shows up in a diff.
3. **Renamed.** Once it returns ended and non-tenant relationships, "available"
   is a lie. Free today: one wrapper, zero call sites.

The `comment on function` must carry, in the voice of the existing one:

- **The security boundary is `p.user_id = p_user_id and p.merged_into_id is null`.
  Widening the columns must never touch that predicate** — it is the entire
  reason SECURITY DEFINER is safe here.
- **`memberships` is the universal relationship anchor.** Roll status is a
  *column on it*, not its meaning; there is deliberately no `current_roll`
  filter, which is why the presbytery-committee elder, the secretary who
  worships elsewhere, and the installed pastor all appear (DECISION-039).
- **Never join `organizations.path` or `parent_id` here.** A presbytery
  stewarding forty non-tenant congregations gets exactly one card. Stewardship
  in the card list is downward inheritance through the back door, and it would
  arrive looking like a helpful feature.
- The ORDER BY is a contract: the caller de-dups by taking the first row per
  `organization_id`.

### 3. The membership ↔ open-position integrity guard (Revision Item 2)

The FK constrains `(person_id, organization_id)` and says nothing about
`ended_on`, so a membership can end under a seated, minuted office — silently,
on a date with no corresponding write. Two triggers, because a guard enforceable
in one direction only is a paper invariant in the other (my addition to the
architect's single trigger; the reachable hole is simply reordering the writes).

```sql
-- Direction 1: ending a membership under an open position fails loudly.
create or replace function presby_guard_membership_end()
returns trigger language plpgsql as $$
declare v_what text;
begin
  select 'the ' || ot.office || ' term beginning ' || ot.starts_on into v_what
    from officer_terms ot
   where ot.person_id = new.person_id
     and ot.organization_id = new.organization_id
     and ot.starts_on <= new.ended_on
     and (ot.ends_on is null or ot.ends_on > new.ended_on)
   order by ot.starts_on limit 1;

  if v_what is null then
    select 'a role grant beginning ' || rg.starts_on into v_what
      from role_grants rg
     where rg.person_id = new.person_id
       and rg.organization_id = new.organization_id
       and rg.starts_on <= new.ended_on
       and (rg.ends_on is null or rg.ends_on > new.ended_on)
     order by rg.starts_on limit 1;
  end if;

  if v_what is not null then
    raise exception
      'memberships: cannot end this relationship on % - % is still open at this organization',
      new.ended_on, v_what
      using errcode = 'check_violation',
            hint = 'End the term first, with an end_reason and a minute reference. Ending a term is a minuted act; the platform will not do it silently to satisfy a cache.';
  end if;
  return new;
end $$;

drop trigger if exists memberships_guard_end on memberships;
create trigger memberships_guard_end
  before update of ended_on on memberships
  for each row
  when (new.ended_on is not null and old.ended_on is distinct from new.ended_on)
  execute function presby_guard_membership_end();

-- Direction 2: opening a position at an org whose membership already ended.
create or replace function presby_guard_position_needs_membership()
returns trigger language plpgsql as $$
declare v_ended date;
begin
  if new.person_id is null then return new; end if;   -- role_grants: group grant

  select m.ended_on into v_ended from memberships m
   where m.person_id = new.person_id
     and m.organization_id = new.organization_id;

  -- Only positions still OPEN when the membership ended are constrained.
  -- Importing twenty years of session history for someone who has since left is
  -- legitimate and must keep working: a term that closed before the membership
  -- did is history, not access.
  if v_ended is not null and (new.ends_on is null or new.ends_on > v_ended) then
    raise exception
      '%: cannot open a position at an organization where the membership ended on %',
      tg_table_name, v_ended
      using errcode = 'check_violation',
            hint = 'Restore the membership first, or record the position as already ended.';
  end if;
  return new;
end $$;

drop trigger if exists officer_terms_needs_membership on officer_terms;
create trigger officer_terms_needs_membership
  before insert or update of person_id, ends_on on officer_terms
  for each row execute function presby_guard_position_needs_membership();

drop trigger if exists role_grants_needs_membership on role_grants;
create trigger role_grants_needs_membership
  before insert or update of person_id, ends_on on role_grants
  for each row execute function presby_guard_position_needs_membership();
```

**Neither function is SECURITY DEFINER, and the migration comment must say
why** — otherwise the next reader adds it as cargo cult and the F26 boundary
stops being legible. Both read only rows *at the same organization* as the row
being written, and any write that reaches them already has that org's
`app.current_org_id` set, so RLS shows them exactly what they need. This is the
opposite case from `presby_guard_membership_insert`
(`drizzle/0009_presby_rls.sql:164`), which probes **across** orgs and therefore
must be DEFINER.

### 4. Seed fixtures — `scripts/seed-dev.sql`

**Do not add fixtures at Alder Creek or Bramblewood.** `scripts/test-rls.sql`
asserts exact counts there (`alder: sees own memberships` = 6, `bramblewood:
sees no alder memberships` = 0, and the roll/SASR sections). New rows in either
org turn a fixture addition into a suite-wide count edit, which is how a
deliberate change becomes a green-tests chore.

Two new organizations instead, so every assertion that sets a specific org GUC
is blind to them:

| id | name | slug | type | parent | platform_status |
|---|---|---|---|---|---|
| `55555555-…` | Fernwood Presbyterian Church | `fernwood` | congregation | Northern Reach | `managed` |
| `66666666-…` | Marrowbone Presbyterian Church | `marrowbone` | congregation | Northern Reach | `invited` |

Give neither an `organization_settings` row (or `require_two_factor = false`),
so section 11's assertions are untouched.

Then six `users` rows on `example.invalid`, all password-less like
`elder.fixture` (they cannot sign in; they exist for `test-rls.sql` and for
manual browser verification with a dev session):

| Fixture | Shape | Destination it proves |
|---|---|---|
| `router.none@` | user row, **no `people` row** | `/no-organization`, zero-rows branch |
| `router.unmanaged@` | person + membership at `quillhaven` only | `/no-organization`, "in our records through the presbytery" branch |
| `router.invited@` | person + membership at `marrowbone` | `/no-organization`, "being set up" branch |
| `router.mixed@` | one person, memberships at `fernwood` **and** `quillhaven` | one card, not two — `platform_status` filtering |
| `router.ended@` | person + **ended** membership at `fernwood` | `resolveOrgContext` → `"ended"` |
| `router.dup@` | **two** `people` rows sharing the `user_id`, each with a membership at `fernwood` | de-duplication (Note 6) — one card |

`router.mixed@`'s second membership trips the F21 guard
(`drizzle/0009_presby_rls.sql:164-187`); do it the way the file already does for
the pastor at line 114 —
`select set_config('app.person_claim_authorized', '<person-id>', true);` in the
same transaction. `router.dup@`'s two person rows each hold their *first*
membership, so the guard does not fire and no flag is needed.

The Item-3 guard fixture the architect asked for (ended membership + open term)
**cannot be seeded** — the triggers exist precisely to make that state
unreachable. The correct fixture is the *precondition*, and it already exists:
`c0000000-…-002` holds an active membership at Alder Creek and an open
`clerk_of_session` term (`scripts/seed-dev.sql:143-144`). The assertions attempt
the end and catch the raise.

### 5. Isolation-suite assertions — `scripts/test-rls.sql`

Six, appended as a new numbered section:

1. `presby_user_organizations` returns the unmanaged row for `router.unmanaged@`
   (the function filters nothing).
2. …and the ended row for `router.ended@` with a non-null `ended_on`.
3. …and **two rows for `router.dup@`, both at `fernwood`** — proving the dedup
   is genuinely the TypeScript wrapper's job and not accidentally free.
4. Ending `c0000000-…-002`'s Alder Creek membership **raises** (wrap in
   `do $$ … exception when check_violation then null; end $$` and raise a
   distinct error if the update succeeds).
5. Ending a membership with no open position **succeeds** — the positive
   control, without which assertion 4 could pass on a broken trigger that
   rejects everything.
6. `select count(*) from organizations` with **no** org GUC returns the whole
   tree — the `publicOrgSummary` read the 403 depends on.

Plus the mirror: inserting an open term at an org with an ended membership
raises; inserting an already-closed historical term at the same org succeeds.

## Component / Page Plan

### Pages to create

| Path | File | Group | Notes |
|---|---|---|---|
| `/launch` | `src/app/launch/page.tsx` | none | Decides. Usually redirects; renders only the DB-unreachable state. |
| `/orgs` | `src/app/(member)/orgs/page.tsx` | `(member)` | The chooser. Never auto-forwards. Gets `GlobalNav` from the existing layout. |
| `/no-organization` | `src/app/no-organization/page.tsx` | none | G1. |
| `/o/[slug]` | `src/app/(org)/o/[slug]/page.tsx` | `(org)` **new** | Stub + the four-way miss response. |
| — | `src/app/(org)/layout.tsx` | `(org)` | Chrome + the contract comment. **No auth logic** — see below. |
| — | `src/app/(org)/o/[slug]/error.tsx` | `(org)` | `"use client"` — mandatory, see R2. |
| — | `src/app/(org)/o/[slug]/not-found.tsx` | `(org)` | Rendered by `notFound()`. |

**`/launch/page.tsx`, structurally — this shape is the design, not a sketch:**

```tsx
const session = await cachedAuth();
if (!session?.user) redirect("/signin?callbackUrl=/launch");

const raw = sp.next ?? sp.callbackUrl ?? null;
let requestedPath = raw ? sanitizeCallbackUrl(raw) : null;
if (requestedPath?.split(/[?#]/)[0] === "/launch") requestedPath = null;   // loop guard

let orgs: UserOrganization[];
let isPlatformAdmin: boolean;
try {
  [orgs, isPlatformAdmin] = await Promise.all([
    userOrganizations(session.user.id),
    readIsPlatformAdmin(session.user.id),
  ]);
} catch (error) {
  return <LaunchUnavailable />;      // renders. Does NOT redirect.
}

const dest = computeDestination({ … });
redirect(dest.path);                 // OUTSIDE the try. Non-negotiable.
```

**Note 2, made structural rather than remembered.** `redirect()` throws
`NEXT_REDIRECT`; a try/catch around it swallows every successful route and
serves a blank page. The catch branch here `return`s JSX, so the redirect
physically cannot be moved inside the try without a type error. Say this in a
comment above the try.

**`LaunchUnavailable`** (Note 3): "We can't reach your congregations right now.
Try again in a moment." plus a `Button` linking back to `/launch` as the retry.
It must not fall through to a zero-card chooser or to `/home` — both read to the
user as "your access was revoked."

**`/orgs`** renders, in order:

1. **Your organizations** — a `Card` per `availableOrganizations()` entry: org
   name as the heading, an org-type `Badge`, the whole card a link to
   `/o/<slug>`. **No membership language** (Revision Note 13) — the elder's
   presbytery card and the secretary's congregation card are relationships, not
   roll status, and "Member of" is both wrong and, for someone who worships
   elsewhere, mildly insulting. Type labels: General Assembly / Synod /
   Presbytery / Congregation / New Worshiping Community.
   The whole section, heading included, is **omitted** when the list is empty
   (G12) — never an empty "Your organizations" heading.
2. **Platform** — rendered when `canAccessAdmin || isPlatformAdmin`. An "Admin"
   card → `/admin` when `canAccessAdmin`; a "Developer" card → `/developer` when
   `isPlatformAdmin`.
3. **Pending organizations notice** — a muted line per `invited` membership
   ("Marrowbone is being set up. We'll email you when it's ready."). No card, no
   link. Safe because the user is a member there.
4. If **all three** would be empty: a single card pointing at
   `/no-organization`. `/orgs` still never auto-forwards — Phase 2's rule is
   literal.
5. On DB error: the same `LaunchUnavailable` state, not an empty grid.

Grid: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`, single column at 360px (G13).

**`/no-organization`** reads `userOrganizations()` unfiltered and picks one
message:

| State | Copy |
|---|---|
| has ≥1 enterable org (arrived by URL) | "You have access to N organizations." + link to `/orgs`. No redirect. |
| ≥1 `invited` | "Marrowbone is being set up. We'll email you when it's ready." |
| only `unmanaged` | "Your congregation is in our records through its presbytery, but isn't set up on presby yet." |
| only ended | "Your access to Fernwood Presbyterian Church ended on 12 June 2026." |
| zero rows | "You're signed in, but you're not connected to a congregation yet." |

Plus two doors, both **static copy in P0**: "Ask your church administrator to
add you" (there is no request table — DECISION-040 puts `org_access_requests` in
P1) and "Is your church not on presby?" linking to `/` until P2 builds the
onboarding request. File the P2 replacement in `docs/TODO.md` in the same commit.

**`/o/[slug]/page.tsx`:**

```tsx
const session = await cachedAuth();
if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent("/o/" + slug)}`);

const resolved = await resolveOrgContext(session.user.id, slug);
switch (resolved.kind) {
  case "not-found": notFound();
  case "forbidden": return <OrgAccessDenied name={resolved.name} />;
  case "ended":     return <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} />;
  case "ok":        break;
}
await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);
return <OrgPortalStub org={resolved.org} />;
```

The auth check lives in the **page, not the layout** — deliberately, and this
resolves D1 rather than repeating it. `(member)/layout.tsx:13` hard-codes
`callbackUrl=/home` because a layout cannot see the pathname; the page has
`params.slug` and can build the correct deep link. So `(org)/layout.tsx` carries
chrome and the contract comment only, and the contract sentence "every page
resolves its `[slug]` through `resolveOrgContext()`" becomes literally true
instead of a layout's implicit promise.

`OrgAccessDenied` copy: "You don't have access to **{name}**." plus a path
forward ("If you should have access, ask an administrator at that organization
to add you.") and a link to `/orgs`. **One string, byte-identical for `managed`,
`invited`, and `unmanaged`** — no "not set up yet" variant, no status-dependent
wording, no status-dependent branch that could vary response time. That is
DECISION-040's whole point.

`OrgPortalStub`: name, type badge, "The organization portal lands in P1," link
back to `/orgs`. Reads no tenant data.

### Components to create

- `src/lib/utils.ts` — `cn()` (clsx + tailwind-merge). Not `server-only`.
- `components.json` — shadcn init: `"rsc": true`, `"tsx": true`,
  `"cssVariables": true`, css `src/app/globals.css`, aliases `@/components`,
  `@/components/ui`, `@/lib`, `@/lib/utils`.
- `src/components/ui/button.tsx`, `card.tsx`, `badge.tsx` — generated, exactly
  these three, all server-safe. If the CLI wants to install `tw-animate-css` or
  `next-themes`, **stop and hand-copy the three files instead** — DECISION-036
  pre-approves those two for P0.5 only, and "zero new runtime dependencies in
  P0" is a claim we should still be able to make at Phase 5. None of the three
  needs an animation utility; strip the import if it appears.
- Page-local components colocated with their routes: `LaunchUnavailable`,
  `OrgCard`, `PlatformBlock`, `PendingOrgsNotice`, `OrgAccessDenied`,
  `OrgAccessEnded`, `OrgPortalStub`.

### `globals.css` token expansion

Restructure to the Tailwind-v4 shadcn shape, which is also what makes a later
`.dark` class a pure addition rather than a re-authoring (DECISION-036):

```css
:root { --background: …; --foreground: …; --primary: …; --radius: 0.5rem; … }
@media (prefers-color-scheme: dark) { :root { … } }
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-accent: var(--accent);
  --color-primary: var(--primary);
  /* …the rest of the shadcn set… */
}
```

**Every one of the six existing token names keeps working and keeps its current
value** — `--color-background`, `--color-foreground`, `--color-muted`,
`--color-muted-foreground`, `--color-border` are unchanged, so no existing page
shifts. The one to watch is `--color-accent`: shadcn's `accent` is a subtle
hover background, not the current brand blue `hsl(217 91% 60%)`. Grep-verified
that **no component uses `accent` today** (`src/app/globals.css` defines it;
nothing consumes it), so it is safe to take shadcn's semantic and move the brand
blue to `--color-primary`. `src/app/(admin)/developer/developer.css` has its own
palette and is untouched. P0 keeps `prefers-color-scheme`; no `next-themes`.

### Files to modify

| File | Change |
|---|---|
| `src/lib/auth/safe-callback.ts` | fallback `/home` → `/launch`, both branches + the docblock |
| `src/lib/auth/safe-callback.test.ts` | six assertions `/home` → `/launch` |
| `src/app/(auth)/totp/actions.test.ts` | **delete.** It tests a private copy of the pre-extraction function still asserting the `/admin` fallback — already filed in `docs/TODO.md` as a stale replica, and leaving it while changing the real fallback makes it actively misleading. `safe-callback.test.ts` is the coverage. Close the TODO line in the same commit. |
| `src/app/(account)/account/2fa/totp-enroll-form.tsx:81` | `?? "/home"` → `?? "/launch"` |
| `src/proxy.ts:42` | `pathname.startsWith("/admin") \|\| pathname.startsWith("/o/")` + the comment block below |
| `src/proxy.ts:78` | fall-through comment lists the new auth-only routes |
| `src/lib/authz.ts` | `OrgAccessError`; the two wrappers; `resolveOrgContext`; `publicOrgSummary`; `assertOrgAccess` |
| `src/lib/db/domain/org.ts` | the `organizations_slug_format` check |
| `src/app/page.tsx:50-57` | signed-in "Go to home" → "Continue" → `/launch` |
| `src/components/shared/global-nav.tsx` | add an "Organizations" link → `/orgs` for every signed-in user, so the chooser is reachable without typing a URL |
| `scripts/seed-dev.sql`, `scripts/test-rls.sql` | fixtures + assertions above |
| `e2e/support/global-setup.ts:137` | `callbackUrl: ${baseURL}/home` → `/launch` (cosmetic — `maxRedirects: 0`) |
| `docs/product/functionality-map.md:17` | rename `presby_available_organizations()` → `presby_user_organizations()`; add the router surface (Workflow Rule 14, at ship time) |
| `docs/TODO.md` | close the stale-replica line; open the P2 onboarding-link and `forbidden()`-status lines |
| `CLAUDE.md` | Project Layout + new **Post-Login Landing** section (below) |
| `.claude/agents/architect.md` | one line in Route Group Rules: `(org)` → pointer to CLAUDE.md → Post-Login Landing |

Historical documents are **not** rewritten: `docs/release-notes/v0.8.md:90`
names the old function and correctly describes what shipped then.

### The `src/proxy.ts` comment — required, not optional

The file's shape actively invites the wrong fix. Write it in the voice of the
existing fall-through block at `proxy.ts:67-79`:

> `/o/*` gets authentication, active-status, and 2FA at the Edge and **nothing
> else**. Do **not** add a `PROTECTION_RULES` entry for it: `FEATURES.*` is the
> **platform** axis and org membership is the **tenant** axis
> (`src/lib/authz.ts:8-22`), and the Edge cannot reach the database to check
> membership anyway. Authorization is `resolveOrgContext()` + `withOrgContext()`
> in the RSC layer, per DECISION-035. Note `"/orgs".startsWith("/o/") === false`
> — the chooser is deliberately outside this gate.

### CLAUDE.md → Post-Login Landing (new section)

Referenced by `.claude/agents/architect.md:17` today and **does not exist**.
P0 gives it content, placed after Key Invariants:

- `/launch` is the single post-authentication target. `sanitizeCallbackUrl`
  falls back to it.
- The nine-row destination matrix, with the `canAccessAdmin` vs
  `isPlatformAdmin` split spelled out.
- `/` never redirects a signed-in user (DECISION-034).
- `/orgs` never auto-forwards; `/home` survives as the platform-shell page that
  carries what's-new and the feedback prompt, and is no longer a landing target.
- The `(org)` contract, verbatim from Phase 2: auth-only **and** org-scoped;
  every page resolves `[slug]` through `resolveOrgContext()` and reads through
  `withOrgContext()` on the RLS-enforced connection; **`getPlatformDb()` is
  forbidden in the subtree**; no page may assume the user came via the chooser;
  the Edge enforces auth, active status, and 2FA for `/o/*` and never membership.

## Implementation Order

**One work-log — this one. Three commits, in this order, each of which
typechecks, builds, and is revertible on its own.** That is my answer to the
sequencing question: splitting the *work-log* would break Phase 5/6 tracking for
a single pipeline, but splitting the *commits* is worth doing because it takes
the two inert pieces out of the blast radius of the one risky piece. If slice C
has to be reverted at 9pm, A and B stay.

### Slice A — schema and fixtures (`database-admin`)

`feat(db): widen the org-list function and guard membership against open positions`

1. `drizzle/0014_presby_org_router.sql` — slug CHECK + comment; drop/create
   `presby_user_organizations`; the two integrity triggers. Journal entry added.
2. `src/lib/db/domain/org.ts` — matching `check()`. Verify `npm run db:push`
   proposes nothing.
3. `scripts/seed-dev.sql` — the two orgs and six fixture users.
4. `scripts/test-rls.sql` — the new section. **Run it as `presby_app`**, not as
   the owner (F1), and paste the output into the Phase 4 notes.
5. `src/lib/authz.ts` — the wrappers, `UserOrganization`, `OrgAccessError`,
   `assertOrgAccess`, `resolveOrgContext`, `publicOrgSummary`. *(Server code in
   the database-admin's slice on purpose: it is the direct TypeScript face of
   the function being changed, and splitting it from the migration means whoever
   writes the wrapper has to re-derive the column contract. The api-developer
   consumes it and does not re-litigate it.)*

**Why this is independently shippable:** nothing calls any of it. The old
wrapper had zero call sites (architect verified); the new ones have zero until
slice C. Applied, it changes no user-visible behavior. Revert = a migration
recreating the old function.

### Slice B — design foundation (`ux-developer`)

`chore(ui): initialise shadcn and expand the token set`

`cn()`, `components.json`, `button`/`card`/`badge`, the `globals.css`
restructure. **Zero behavior change.** Verification is visual: load `/`,
`/signin`, `/home`, `/admin`, `/developer` in a browser at 360px and 1280px and
confirm nothing moved. Revert = delete four files and restore one.

### Slice C — the router (`api-developer`, then `ux-developer`)

`feat(auth): route post-login through /launch and the org chooser`

One commit, written by two agents, because a partial landing is the half-routed
login nobody wants. `Work-Log: 2026-08-18-backbone-and-org-sites`.

**C1 — api-developer:** `computeDestination` + its nine unit tests;
`readIsPlatformAdmin` (+ adopt it in `developer/guard.ts` and
`developer/schema.json/route.ts`); `proxy.ts` 2FA extension and both comments;
`safe-callback.ts` fallback + its tests; delete the stale replica; the
`OrgAccessError` swap at `src/lib/authz.ts:63-68`.

**C2 — ux-developer:** the four pages, `(org)/layout.tsx`, `error.tsx`,
`not-found.tsx`, all page-local components, the `page.tsx` and `GlobalNav`
links.

**C3 — either:** e2e fixtures and specs (below), CLAUDE.md, the architect agent
line, `docs/TODO.md`, `docs/product/functionality-map.md`.

**Not applicable from the template:** no `FEATURE_CATALOG` entry, no seed
binding, no audit events, no `check:audit` surface (P0 has no `actions.ts`).
Release notes at Phase 6 via `/release-notes`, with a `whats_new_entries`
entry — "where you land after signing in" is exactly the member-visible change
Workflow Rule 13 is asking about.

## Implementer

**`database-admin` (A) → `ux-developer` (B) → `api-developer` (C1) →
`ux-developer` (C2/C3) → `qa`.**

I am taking the architect's suggested split rather than collapsing to
`full-stack-developer`, and the reason is specific rather than a preference for
ceremony: P0 puts a change to the SECURITY DEFINER function that *is* the
cross-org read boundary, a change to the Edge auth path, and four new pages in
one pipeline. Handed to one agent, the migration is the piece that gets the
least attention — it is the least visible and the hardest to eyeball — and it is
also the only piece where a mistake is a data-isolation defect rather than a
routing annoyance. The slice boundaries here coincide with commit boundaries and
with agent expertise, so the handoff cost is a work-log read, not a mid-file
split.

The one place I diverge from the architect's suggestion is putting the
`src/lib/authz.ts` wrappers in the **database-admin's** slice rather than the
api-developer's: the column contract and the de-dup ordering are the same
decision expressed twice, and separating them is how the ORDER BY and the
"take the first row" rule drift apart.

If the operator wants fewer handoffs, B + C2 + C3 collapse into one
`full-stack-developer` invocation cleanly. Slice A stays with `database-admin`
either way.

## Edge Cases & Risks

**R1 — `redirect()` inside a try/catch.** The single most likely way to ship a
blank `/launch`. Mitigated structurally (the catch returns JSX) and by comment.

**R2 — `error.tsx` must be `"use client"`, contradicting Phase 2's "there is no
`'use client'` in this pipeline."** Next requires error boundaries to be client
components; this is a framework mandate, not a choice. Phase 2's sentence is
right about *pages* and wrong about the boundary. Second-order consequence the
design has to absorb: in production Next replaces the error message with a
digest, so `error.tsx` **cannot** render the org name. Its copy is generic —
"Your access to this organization has ended or was removed." + a link to
`/orgs`. The named-and-dated message comes from `resolveOrgContext`'s `"ended"`
branch, which is the common path; `error.tsx` only catches the genuine race
where membership disappears between the resolve and the transaction.

**R3 — the 403 is rendered at HTTP 200, and DECISION-040 says 403.** Next's
`forbidden()` is still behind `experimental.authInterrupts` (verified 2026-08-18,
canary-only), and enabling an experimental flag is an architect-scope config
change I am not taking inside P0. The property DECISION-040 actually protects —
**one response, byte-identical across `managed` / `invited` / `unmanaged`** — is
fully satisfied by the rendered page. `not-found` keeps a real 404 via
`notFound()`. Logged in `docs/TODO.md`: adopt `forbidden()` when it stabilises.

**R4 — the e2e fixtures have no organizations, so four of the nine rows are
unreachable in a browser.** `E2E_USERS` are platform users with no `people`
rows, and `scripts/seed-dev.sql`'s people have no passwords. Without new
fixtures the chooser, the single-org forward, the 403 and the 404 ship verified
by unit tests only — which is precisely the "returns 200 is not the same as
works" invariant. Required: a new `e2e/support/seed-orgs.ts`, provisioned by
`globalSetup` alongside `seed-users.ts`, owning four `e2e-`-prefixed orgs
(`e2e-presbytery` managed, `e2e-alpha` managed, `e2e-beta` managed, `e2e-gamma`
unmanaged) and linking three new fixture users: `org-single` (1 managed),
`org-multi` (`e2e-alpha` + `e2e-presbytery`), `org-unmanaged` (`e2e-gamma`
only), all `roleName: null`. Two mechanics the implementer must not rediscover:
it needs `E2E_PLATFORM_DATABASE_URL ?? PLATFORM_DATABASE_URL` (the existing
seeder's `DATABASE_URL` is `presby_app`, which has no INSERT on `organizations`
and is RLS-blocked on `people`/`memberships`), and `org-multi`'s second
membership must set `app.person_claim_authorized` inside a single statement —
issue the inserts as one `do $$ … $$` block, since the neon HTTP driver has no
multi-statement transaction. `organizations.path` is supplied explicitly, ltree
labels only (`e2e_presbytery.e2e_alpha`). Same `example.invalid` guard and
cleanup sweep as `seed-users.ts`.

**R5 — adding fixtures to Alder Creek or Bramblewood silently rewrites
`test-rls.sql`.** Mitigated by the two new orgs. Called out because the
tempting, cheapest move is to add a membership at Alder and then "fix" four
count assertions.

**R6 — editing `drizzle/0013` breaks `db:migrate`.** Every hand-written
migration is in `_journal.json`, so the migrator hashes it. The architect's
Note 7 asked for the stale comment to be corrected in place; do not. Forwarding
note in 0014's header instead.

**R7 — auditing the 403 would be a mass-notification vector.** F18 says a
platform action against a tenant carries that tenant's `organization_id`, so an
audited denial would let any signed-in user write rows into any congregation's
access log by looping over a **public** slug list. P0 writes no audit event on
the miss path. Carry this forward: P1's `org_access_requests` Phase 1 faces the
identical vector with a bigger payload, and the architect already flagged it.

**R8 — the requested-path branch is defensive and low-traffic, and its rules
must not be mistaken for the gate.** A signed-out deep link to `/o/alder-creek`
never touches `/launch` at all: the proxy sends `/signin?callbackUrl=/o/alder-creek`
and NextAuth redirects straight there. So rule 1 fires only when something
explicitly routes *through* `/launch` with a `next`. Its job is not to authorize
— `/o/<slug>` does that independently (A4) — it is to avoid dumping a user with
a stale bookmark on a 403 when the chooser is the kinder answer.

**R9 — `sanitizeCallbackUrl` must stay a pure string function** (Note 4). It
does not learn about org slugs, does not import anything, and returns `/launch`
for absent/invalid input. The slug check lives in `computeDestination`.

**R10 — `/launch` as the fallback creates a redirect loop if `/launch` itself is
ever reached with `?next=/launch`.** One line, easy to forget, invisible until
someone bookmarks it: drop `requestedPath` when its pathname is `/launch`. Unit
test it.

**R11 — MFA-enrolled users now meet the 2FA gate immediately after sign-in.**
The `mfa-admin` fixture (0 orgs, `canAccessAdmin`) previously landed on `/home`;
after P0 it routes to `/admin`, the Edge gates it, `/totp` sees no enrolment and
walks it to `/account/2fa`. That is correct and it is why DECISION-037 pulled
the gate forward — but it is a visible behavior change on the first screen after
sign-in for exactly the users the policy protects, and it must be asserted
deliberately, not discovered.

**R12 — the dedup rule is load-bearing and its input is a schema accident.**
Two `people` rows sharing a `user_id` is reachable (`people_user_idx` is not
unique) and produces two identical cards plus a non-deterministic
`resolveOrgContext`. The fixture and the `test-rls.sql` assertion exist so the
wrapper's `find`-first behavior is proven rather than assumed.

**R13 — the shadcn CLI may want to rewrite `globals.css` or install
`tw-animate-css`/`next-themes`.** Review its diff before accepting; hand-copy
the three components if it insists. DECISION-036 pre-approves those two deps for
**P0.5 only**.

### E2E blast radius — existing specs that encode the old `/home` contract

Per the 2026-07-11 retro: this is the list of *existing* assertions this change
alters, not just the new tests needed. Each is a deliberate contract update.

| Spec | Today | After P0 | Action |
|---|---|---|---|
| `e2e/member-home.spec.ts:24-32` | admin signs in → `/home` | → `/admin` (0 orgs, `canAccessAdmin`, not `isPlatformAdmin`) | **Rewrite** the assertion |
| `e2e/member-home.spec.ts:35-50` | signs in, asserts `GlobalNav` links on the landing page | lands on `/admin`, which has its own sidebar and no `GlobalNav` | **Add an explicit `page.goto("/home")`** before the assertions — otherwise it fails for a reason unrelated to what it tests |
| `e2e/member-home.spec.ts:53-65` | member signs in → `/home`, no Admin link | → `/no-organization` | **Rewrite** the landing assertion; `goto("/home")` for the nav assertion |
| `e2e/member-home.spec.ts:84-107` | mfa-admin signs in → `/home`, *then* `/admin` triggers the two-hop | signs in → `/admin` → `/totp` → `/account/2fa` immediately | **Rewrite.** This is R11 and it is the most interesting assertion in the file after P0 — keep the two-hop chain, drop the "2FA does not apply to `/home`" framing |
| `e2e/admin-login.spec.ts:42-44` | comment: "signing in without a callbackUrl redirects to `/home`" | stale | **Update the comment.** The test itself navigates explicitly and still passes |
| `e2e/member-home.spec.ts:13-21`, `role-boundaries.spec.ts:25-32` | unauthenticated `/home` → `/signin?callbackUrl=/home` | unchanged — `/home` survives | **No change.** Phase 2 Note 9 flagged `role-boundaries.spec.ts:25-31` as needing an update; it does not, because `/home` is not deleted. Correcting that here so nobody edits a passing spec |
| `e2e/whats-new.spec.ts:177`, `feedback.spec.ts`, `account-page.spec.ts` | navigate explicitly | unchanged | **No change** — verified by grep |
| `e2e/support/global-setup.ts:137` | posts `callbackUrl=${baseURL}/home` | cosmetic (`maxRedirects: 0`) | Update to `/launch` for honesty |

### New e2e specs — `e2e/post-login-routing.spec.ts`

Required before Phase 5 opens. P0 touches `src/lib/auth/safe-callback.ts` and
`src/proxy.ts`, so CLAUDE.md's Phase 4 gate applies in full and **QA returns
`BLOCKED`, not `PASS`, if any of this is deferred** — a deferred advisory is not
a green light.

*Mandatory (the auth-path smoke):*

1. `admin` signs in with no `callbackUrl` → lands on `/admin`.
2. `member` signs in → lands on `/no-organization`.
3. **`mfa-admin` signs in → `/admin` → `/totp` → `/account/2fa` with
   `callbackUrl=/admin`.** This is the MFA-enrolled leg the gate names.
4. Signed-out `/o/e2e-alpha` → `/signin?callbackUrl=%2Fo%2Fe2e-alpha`; sign in;
   land on `/o/e2e-alpha`. The deep link survives the round trip.
5. `/launch?next=https://evil.com/steal` → does not leave the origin.

*Required for the feature to count as verified in a browser:*

6. `org-single` signs in → auto-forwarded to `/o/e2e-alpha`.
7. `org-multi` signs in → `/orgs`, exactly two cards, no membership language,
   both links resolve.
8. `org-unmanaged` signs in → `/no-organization`, not `/orgs`.
9. `org-single` visits `/o/e2e-beta` → the access-denied page naming
   *e2e-beta*; visits `/o/e2e-gamma` (unmanaged) → **byte-identical** copy;
   visits `/o/no-such-slug` → 404.
10. `org-single` visits `/orgs` → renders, does not auto-forward (A4 made
    observable).

*Unit (vitest), not e2e:* all nine matrix rows against `computeDestination`,
plus the `/launch` loop guard and the `/o/`-slug-not-enterable fall-through.

## Out of Scope (confirm)

Named so they are not quietly absorbed, per Phase 2 Note 10 and Revision Note 15:

- The org switcher UI (dropdown) and the org portal shell's content — P1.
- Tenant permission keys, `presby_effective_permissions()` wiring, `invited`-org
  entry, `org_access_requests` / "Request access" as a button — P1.
- Migrating what's-new and the feedback prompt off `/home`; retiring `/home`'s
  "Your roles / Your features" debug sections — P1.
- Per-org 2FA claim refinement (`twoFactorRequiredOrgIds`) — P1, additive.
- The existing-page design migration, the 7 tables and 8 buttons,
  `alert-dialog.tsx` regeneration, dark-mode strategy, reconciling
  `docs/ui-standards.md` — **P0.5**, must land before P3.
- `organization_slug_aliases` and 301s — the named escape hatch, built only when
  a slug genuinely must change.
- Anything under `/site/<slug>`, the `(public)` group, custom domains, satellite
  sessions — P3/P5/P10.

## Handoff

**Next: `database-admin` (Phase 4, slice A).** Everything it needs is in
§Data Model — the migration is written out, the fixture table is explicit, and
the six assertions are enumerated. Two things it must not do: edit
`drizzle/0013`, and add fixtures at Alder Creek or Bramblewood.

Then `ux-developer` (slice B), `api-developer` (C1), `ux-developer` (C2/C3), and
`qa` — who should read §E2E blast radius before running anything, because four
currently-green specs are *supposed* to change and one of them (`member-home`
test 3) will fail for a reason that has nothing to do with what it asserts.

Open questions OQ4–OQ7 remain open and are not P0's business. S9's P10, the
staff model's P8, and tenant administration's P9 each need their own Phase 1
before they reach the architect again.

---

# Phase 4 — Implementation · Slice B (design foundation, ux-developer), 2026-08-18

Scope: DECISION-036 exactly — `cn()`, `components.json`, three server-safe
primitives, the `globals.css` token expansion. Nothing else. No `input`, no
`dialog`, no `table`; those are P0.5 and adding them here would erase the
boundary the decision exists to draw.

## Files Created

- `src/lib/utils.ts` — `cn()` (clsx + tailwind-merge). Deliberately **not**
  `server-only`: every primitive imports it and they render on both sides.
- `src/lib/utils.test.ts` — four cases: join, Tailwind conflict resolution,
  falsy/array/object flattening, empty call.
- `components.json` — shadcn init config. `"rsc": true`, `"tsx": true`,
  `"cssVariables": true`, css `src/app/globals.css`, aliases `@/components`,
  `@/components/ui`, `@/lib`, `@/lib/utils`. Written by hand rather than by
  `shadcn init` so the CLI could not rewrite `globals.css` or add a dependency
  as a side effect (R13).
- `src/components/ui/button.tsx`, `card.tsx`, `badge.tsx` — generated by
  `npx shadcn@latest add button card badge`. **None carries `'use client'`** —
  all three are server-safe as the design requires.
- `e2e/color-scheme.spec.ts` — regression for the colour-scheme bug found during
  visual verification (below). Two assertions: body background is
  `rgb(255, 255, 255)` under `colorScheme: "light"` and `rgb(15, 23, 41)` under
  `"dark"`.

## Files Modified

- `src/app/globals.css` — restructured to the Tailwind-v4 shadcn shape: raw
  tokens on `:root`, the dark set in `@media (prefers-color-scheme: dark)`,
  `@theme inline` mapping them onto `--color-*`, and an `@layer base` block for
  the default border colour and the html/body colours. Token set expanded to
  `card`, `popover`, `primary`, `secondary`, `destructive`, `input`, `ring`,
  `--radius` and every `*-foreground` pair.

## Schema Changes

None. This slice touches no database object.

## Audit Events

None. No mutation, no server action, no route handler. `npm run check:audit`
passes (nothing new to cover).

## Dependencies

**Zero installed. `package.json` and `package-lock.json` are byte-identical to
`HEAD`** (md5-verified before and after), and `node_modules` was restored with
`npm ci` after the CLI run — see the finding below for why that was necessary.

## Findings

### F-B1 — the current shadcn registry imports the `radix-ui` umbrella package

`npx shadcn@latest add button card badge` emitted
`import { Slot } from "radix-ui"` in `button.tsx` and `badge.tsx`, and the CLI
installed **`radix-ui@^1.6.7`** — the whole Radix umbrella, ~40 sub-packages in
the lockfile — into `package.json`. That is a new runtime dependency and P0's
"zero new runtime dependencies" claim would have been false at Phase 5.

Resolution, per the design's instruction to hand-correct rather than accept:
the import was rewritten to `import { Slot } from "@radix-ui/react-slot"`
(already a direct dependency, and the package exports both `Slot` and `Root`),
`Slot.Root` → `Slot`, and `package.json` / `package-lock.json` were reverted and
`npm ci` run so the installed tree matches the committed lockfile exactly.
Verified afterwards: `node_modules/radix-ui` absent,
`@radix-ui/react-slot@1.2.4` restored.

**This matters beyond P0.** Every future `shadcn add` will do the same thing.
P0.5 should decide once: either adopt `radix-ui` deliberately (one dependency
replacing the five `@radix-ui/react-*` entries) or keep rewriting the import on
each generation. The CLI did not ask for `tw-animate-css` or `next-themes`, and
none of the three components imports an animation utility, so those two remain
un-added as DECISION-036 requires.

### F-B2 — light mode has never worked; the token file rendered dark for everyone

**This is a real, shipped, user-visible bug that the restructure fixes**, and it
is the one place this slice is not pixel-neutral. Evidence, not inference:

The previous file nested a second `@theme` block inside
`@media (prefers-color-scheme: dark)`. Tailwind v4 hoists `@theme` out of the
media query into the theme layer, so the compiled stylesheet served by the dev
server contained exactly **one** unconditional `:root` block, carrying the dark
values:

```
--color-background: #0f1729;   /* one definition in the whole file */
--color-foreground: #f8fafc;
```

Screenshots confirm it: under the old file, `/` and `/signin` at 360px and
1280px are **byte-identical PNGs in `colorScheme: "light"` and
`colorScheme: "dark"`** — a light-preferring visitor got the dark palette.
Under the new file the dark renders are byte-identical to the old ones (nothing
changed for dark users) and the light renders are, at last, light.

I shipped the fix rather than preserving the bug: preserving it would mean
deliberately breaking the light tokens, and the tokens' obvious intent is the
behavior that now happens. `e2e/color-scheme.spec.ts` is the guard, and it was
confirmed **failing on the old file, passing on the new** before being kept.
Flagged for Phase 6 because it changes what light-mode users see across every
existing page — legibility spot-checked below.

## Implementer Notes

**Tokens.** All six previous names still resolve; `background`, `foreground`,
`muted`, `muted-foreground` and `border` keep their exact previous values.
`accent` takes shadcn's semantic (a subtle hover surface) as the design
directed, verified against a grep showing zero consumers.

**`--primary` is blue-600 `hsl(221 83% 53%)`, not the old accent's blue-500
`hsl(217 91% 60%)`** — a deliberate 7-point lightness change on a token nothing
consumes yet. White on blue-500 is 3.7:1, which fails WCAG AA for text, and the
default `Button` variant is `bg-primary text-primary-foreground`; blue-600 gives
5.2:1. The dark palette keeps blue-500 with a near-black foreground (4.5:1),
so the brand blue survives where it reads well. A fork's branding pass should
review this token first.

**Tailwind's radius scale is deliberately not remapped onto `--radius`.**
shadcn's stock `globals.css` redefines `--radius-sm/md/lg/xl`, which would
resize every existing `rounded-md` / `rounded-lg` on every page. `--radius` is
declared and available; the remap is a P0.5 call.

**The `@layer base` default border colour** (`*, ::after, ::before`) is required
because the generated `Card` writes a bare `border`. Verified inert today: a
grep over every `.tsx` and `.css` found no existing `border` without an explicit
colour class. shadcn's companion `outline-ring/50` base rule was **not** copied —
it would recolour default browser focus rings on elements that set no focus
style, which is a visual change with no consumer in this slice.

**`html, body` moved into `@layer base` and now reference the raw tokens.**
`@theme inline` does not emit `--color-*` custom properties (it inlines them
into utilities), so the old `background: var(--color-background)` rule would
have resolved to nothing. Same computed values, verified by screenshot.

**Note for whoever regenerates `alert-dialog.tsx` in P0.5:** it is the one
pre-existing `src/components/ui/` file and it is hand-written, uses template
literals instead of `cn()`, and predates `components.json`. Untouched here on
purpose — DECISION-036 assigns it to P0.5.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings=0`) | pass |
| `npx vitest run` | 36 files, 438 tests, all pass (4 new) |
| `npm run check` | audit-coverage pass, `sql<Date>` guard pass |
| `npm run build` | compiled successfully, 26 static pages |
| `npx playwright test e2e/color-scheme.spec.ts` | 2 passed; confirmed failing on the pre-change `globals.css` |

**Browser verification** (`npm run dev`, Chromium via Playwright, `.env.local`,
`RATE_LIMIT_DISABLED=true`), full-page screenshots at **360px and 1280px** in
**both colour schemes**, before and after the token change:

- `/` and `/signin` — the two routes reachable without a session. Dark renders
  **byte-identical** before vs after (md5-compared). Light renders differ, and
  only because of F-B2.
- Signed in as the e2e admin fixture: `/home`, `/admin/users`, `/account`.
  Light mode read as intended — white surfaces, dark navy text, dark-navy
  primary buttons, `border-border` hairlines visible, table rows and the
  feedback card legible at 360px with no overflow. `/developer` redirects for
  this fixture (nothing seeds `users.is_platform_admin`, exactly as the Phase 3
  design notes), so it was not visually reviewed — it carries its own palette in
  `developer.css` and imports none of these tokens.

## Handoff

**Next agent: `api-developer` (slice C1)** — `computeDestination` and its nine
unit tests, `readIsPlatformAdmin`, the `proxy.ts` 2FA extension, the
`safe-callback` fallback. Nothing in slice B blocks it; the primitives are
available at `@/components/ui/{button,card,badge}` and `cn()` at `@/lib/utils`
when C2 builds the chooser.

**What a reviewer should click through:** load `/` and `/signin` at 360px and
1280px with the OS in **light** mode — that is F-B2, and it is the only visible
change in this slice. Then switch the OS to dark and confirm those two pages
look exactly as they did before. Signed in, the same sweep over `/home`,
`/admin/users`, `/account`.

**New copy strings:** none. This slice renders no text.

**Follow-ups for P0.5** (not opened as TODO lines by me — tech-lead's call
whether they belong in the P0.5 pipeline doc): the `radix-ui` umbrella decision
(F-B1), the radius-scale remap, `alert-dialog.tsx` regeneration, and whether
`docs/ui-standards.md`'s hand-rolled button examples should now be rewritten
against `<Button>`.

---

# Phase 4 — Implementation · Slice A (schema and fixtures, database-admin), 2026-08-18

Scope: the design's Slice A minus `resolveOrgContext` / `publicOrgSummary` /
`assertOrgAccess` / `OrgAccessError`, which the orchestrator held back for a
later slice. What landed is the migration, the two org-list wrappers, the seed
fixtures, and the isolation-suite assertions.

## Files Created

- `drizzle/0014_presby_org_router.sql` — hand-written, registered as `idx: 14`
  in `drizzle/meta/_journal.json`. Three sections: the `organizations.slug`
  DNS-label CHECK plus the immutability `comment on column`; the drop of
  `presby_available_organizations(uuid)` and the create of
  `presby_user_organizations(uuid)`; the two DECISION-039 integrity triggers.
  Header carries the forwarding note for `drizzle/0013`'s now-stale reference to
  the old function name — 0013 itself is **not** edited, per the design's
  mechanical overrule of the architect's Note 7.
- `src/lib/authz.test.ts` — 12 unit tests over the two wrappers: column mapping,
  the `endedOn`-is-a-string contract, "filters nothing", de-duplication, the
  order-is-the-contract rule, error propagation, the `managed` + current filter,
  the one-card-per-steward case, and the single-round-trip guarantee.

## Files Modified

- `src/lib/authz.ts` — `OrganizationType`, `PlatformStatus`, `UserOrganization`,
  `userOrganizations()`, and `availableOrganizations()` rewritten as a filter
  over it. The old `availableOrganizations()` (untyped `Record<string, unknown>`
  rows, zero call sites) is gone.
- `src/lib/db/domain/org.ts` — the matching `check("organizations_slug_format")`
  and the immutability comment on `slug`.
- `scripts/seed-dev.sql` — the router fixture section (below), plus a line in
  the file-header summary.
- `scripts/test-rls.sql` — section 12, and six new `\set` variables.
- `docs/work-log/2026-08-18-backbone-and-org-sites.md` — this section and the
  status table.

## Schema Changes

- `organizations` — new CHECK `organizations_slug_format`
  (`slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'`); new `comment on column`
  recording that the slug is immutable. No columns added or dropped.
- Function `presby_available_organizations(uuid)` **dropped**; function
  `presby_user_organizations(uuid)` **created** — same security predicate,
  four more columns (`membership_id`, `platform_status`, `ended_on`,
  `membership_created_at`), no filtering, `set search_path = public`.
- Functions `presby_guard_membership_end()` and
  `presby_guard_position_needs_membership()` created, with triggers
  `memberships_guard_end` (BEFORE UPDATE OF `ended_on` on `memberships`),
  `officer_terms_needs_membership`, and `role_grants_needs_membership`.
- No new tables. Nothing in this slice writes tenant data.

**Migration mode: `db:generate`-equivalent — a hand-written, journaled,
versioned migration at `drizzle/0014_presby_org_router.sql`, not `db:push`.**
Drizzle Kit emits none of this (functions, triggers, comments, grants), so
`db:generate` had nothing to generate; the file is authored by hand and
registered in `_journal.json` exactly as `0009`–`0013` are. Every statement is
idempotent — `do $$ … if not exists … end $$` around the CHECK,
`drop function if exists`, `create or replace function`,
`drop trigger if exists` before each `create trigger`. Applied to the dev
database as the owner:

```
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0014_presby_org_router.sql
```

## Audit Events

None. This slice writes no tenant data and exposes no mutation surface; the
design's "no audit events in P0, deliberately" (Edge Cases R7) is unchanged by
it.

## Seed fixtures

Two organizations, deliberately **not** at Alder Creek or Bramblewood —
`scripts/test-rls.sql` asserts exact counts in both, and a row there would have
turned a fixture addition into a suite-wide count edit:

| id | name | slug | type | parent | platform_status |
|---|---|---|---|---|---|
| `55555555-…` | Fernwood Presbyterian Church | `fernwood` | congregation | Northern Reach | `managed` |
| `66666666-…` | Marrowbone Presbyterian Church | `marrowbone` | congregation | Northern Reach | `invited` |

Neither gets an `organization_settings` row, so section 11's 2FA assertions are
untouched. Six password-less `example.invalid` users, all with invented names:

| Fixture | Shape | Verified behavior |
|---|---|---|
| `router.none@` | user row, no `people` row | `userOrganizations` → `[]` |
| `router.unmanaged@` | membership at `quillhaven` only | all: `[quillhaven/unmanaged]`, enterable: `[]` |
| `router.invited@` | membership at `marrowbone` | all: `[marrowbone/invited]`, enterable: `[]` |
| `router.mixed@` | one person, `fernwood` + `quillhaven` | all: 2 rows, enterable: `[fernwood]` |
| `router.ended@` | membership at `fernwood`, `ended_on = 2026-03-31` | all: 1 row with the date, enterable: `[]` |
| `router.dup@` | **two** `people` rows on one `user_id`, each with a `fernwood` membership | function returns 2 rows, wrapper returns 1 |

`router.mixed@`'s second membership sets `app.person_claim_authorized` in the
same transaction, the way the file already does for the pastor (F21/F23).

One addition beyond the design's fixture list: an `app_roles` row at Fernwood
(`fernwood_directory`) granted to `router.mixed@`'s person, with no `ends_on`.
Without it, the DECISION-039 guard's **role-grant arm** has no precondition
anywhere in the fixture — Alder Creek's open `clerk_of_session` term exercises
only the officer-term arm, and half of each trigger would have shipped
unverified. The guarded state itself (ended membership under an open position)
remains unseedable by construction, exactly as the design says; the fixture is
the precondition and the suite attempts the end.

## Isolation suite

Run as `presby_app`, never as the owner (F1):

```
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
```

**39 assertions before, 54 after. All pass, none fail.** The pre-change suite
(`git show HEAD:scripts/test-rls.sql`) still reports its original 39 against the
migrated database, so the fixture additions regress nothing.

The fifteen new ones, in section 12:

- the pre-P0 function name is gone, not shadowed
- an `unmanaged` relationship is returned, not filtered
- an ended relationship is returned **with** its `ended_on`
- the mixed user gets both relationships, and exactly one is enterable
- duplicate person rows produce two rows for one organization (proving dedup is
  genuinely the wrapper's job and not accidentally free)
- current relationships sort first (the ORDER BY as contract)
- a user with no person row gets nothing
- every `platform_status` is readable from `organizations` with no org GUC set —
  the public-tree read the humane 403 will depend on
- ending a membership under an open **officer term** is rejected
- ending a membership under an open **role grant** is rejected
- **positive control:** a membership with no open position still ends normally
- opening a **term** where the membership has ended is rejected
- opening a **role grant** where the membership has ended is rejected
- a term that closed *before* the membership did still imports

## Implementer Notes

**Two places the design's stated expectations did not hold, both reported rather
than worked around.**

1. **`npm run db:push` cannot confirm "proposes no changes", and could not
   before this slice either.** The design asks for that as the proof that
   `org.ts` and the migration agree. Two independent reasons it does not work:
   push is interactive and refuses to run without a TTY, and — verified by
   stashing the `org.ts` change and re-running — it *already* proposes to
   re-add `memberships_person_org_key`, a constraint that demonstrably exists in
   the database. Separately, drizzle-kit renders check constraints
   table-qualified on the schema side (`"organizations"."slug" ~ '…'`) and
   Postgres renders them unqualified with a cast (`slug ~ '…'::text`), so **all
   three** checks in this schema — including the two pre-existing ones on
   `groups` and `role_grants` — read as drift on every push. Proof taken the way
   that does work: `drizzle-kit pull` into a scratch directory and a direct
   comparison of the two snapshots. The new declaration matches the house
   pattern exactly. Nothing here is caused by this slice, and nothing here is
   fixed by it; it is worth a TODO line in someone's slice.

2. **`ended_on` does not arrive as a string, and the timezone shift is real.**
   The design specifies `endedOn: string` ('YYYY-MM-DD'), and
   `scripts/check-sql-date.mjs` explains that the Neon driver returns raw-SQL
   dates as strings. That is true of computed expressions with no column OID; it
   is **not** true of a typed `date` column returned by a function. Probed
   against the real database: `ended_on` comes back as a JS `Date` at
   `2026-03-31T04:00:00.000Z` for a 31 March relationship — midnight *local*,
   which renders as the 30th for anyone west of the deployment, on a page whose
   entire job is to say "your access ended on the 31st". Fixed in SQL rather
   than in TypeScript: the wrapper selects `ended_on::text` and
   `to_json(membership_created_at) #>> '{}'`, so both arrive as strings by type
   rather than by driver behavior. `npm run check:sql-date` passes; there is no
   `sql<Date>` anywhere in the slice.

**Deliberate additions to the design's SQL:**

- `set search_path = public` on `presby_user_organizations`, matching the
  precedent set by `presby_two_factor_required` in 0013. A SECURITY DEFINER
  function with an unpinned search path is resolvable by the caller; the older
  0010 functions predate that precedent and are not touched here.
- The two guard functions carry `comment on function` bodies as well as the
  header prose, because a `\df+` reader never sees the migration file.

**Deliberate omission:** `docs/product/functionality-map.md:17` still names
`presby_available_organizations()`. Workflow Rule 14 puts that correction at
ship time, and the design lists it under slice C's C3; leaving it to C3 keeps
one file from being edited by two agents in one pipeline.

**On `db:migrate`:** the dev database's `drizzle.__drizzle_migrations` table
records only the first ten migrations — `0010`–`0013` were applied by hand with
`psql` and never journaled into it. `0014` was applied the same way. That is
pre-existing state on this branch, not something this slice introduced, but it
means `npm run db:migrate` is not the local apply command here and would fail
trying to re-run `0010`.

## Handoff

**Next agent: `api-developer` (slice C1)** — unchanged from slice B's handoff.

**What is now available:**

- `presby_user_organizations(p_user_id uuid)` returns
  `(organization_id, person_id, membership_id, name, organization_type, slug,
  platform_status, ended_on, membership_created_at)`, filters nothing, and is
  executable by `presby_app`. `presby_available_organizations` no longer exists.
- `import { availableOrganizations, userOrganizations, type UserOrganization,
  type OrganizationType, type PlatformStatus } from "@/lib/authz"`.
  `availableOrganizations()` is exactly `computeDestination`'s `enterableOrgs`
  input: current relationships at `managed` orgs, de-duplicated by
  organization id, each carrying a `slug`. Neither wrapper swallows a database
  error — `/launch`'s DB-unreachable state is the caller's job, as Phase 3 Note
  3 requires.
- `resolveOrgContext`, `publicOrgSummary`, `assertOrgAccess`, and
  `OrgAccessError` are **not** built. They remain exactly as specified in the
  Phase 3 API contract, §3–§5.
- A relationship is now guaranteed to outlive any open position at the same
  organization, in both directions, by trigger.
- Six new fixture users for manual browser verification with a dev session, and
  two fixture organizations (`fernwood` managed, `marrowbone` invited) whose
  slugs are safe to hard-code in `/o/<slug>` smoke checks.

**Local apply, in this order, from a checkout with `.env.local` populated:**

```
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0014_presby_org_router.sql
psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql   # fresh DB only — not idempotent
psql "$APP_DATABASE_URL"     -v ON_ERROR_STOP=1 -f scripts/test-rls.sql   # MUST be presby_app
```

On a database that already carries the fixture, re-running `seed-dev.sql` will
fail on duplicate keys; apply only the trailing `-- The post-login router
fixture (P0)` section. `npm run db:seed` is **unchanged** — no
`FEATURE_CATALOG` entry, no role binding, nothing platform-side in this slice.

---

# Phase 4 — Implementation · Slice C1 (the router, server half, api-developer), 2026-08-18

Scope: the design's C1 **plus** the four items slice A held back
(`resolveOrgContext`, `publicOrgSummary`, `assertOrgAccess`, `OrgAccessError`),
which the orchestrator reassigned here. No pages, no components — `/launch`,
`/orgs`, `/no-organization`, `/o/[slug]`, `error.tsx` and `not-found.tsx` are
C2's, and everything they need is exported.

## Files Created

- `src/app/launch/destination.ts` — `computeDestination()`, `DestinationInput`,
  `DestinationReason`, `Destination`. Imports nothing: no `server-only`, no
  `@/lib/db`, no `next/navigation`. Colocated with its only consumer, per the
  design.
- `src/app/launch/destination.test.ts` — 18 cases: the nine matrix rows, the
  `canAccessAdmin` × `isPlatformAdmin` grid (DECISION-044(1)), the requested-path
  branch, the `/launch` loop guard with and without a query string, the
  not-enterable-slug fall-through against both a chooser and a single-org
  outcome, and `/orgs` not being mistaken for an org path.
- `src/lib/platform-admin.ts` — `readIsPlatformAdmin(userId)`, the third copy of
  the same four-line select extracted so there is not a fourth.
- `src/proxy.test.ts` — 10 cases over the Edge gate: `/o/*` unauthenticated →
  `/signin` with the deep link, 2FA challenge on `/o/*`, a member with **no**
  role or feature admitted to `/o/*`, deactivation, `/admin` still gated,
  `/access-pending` still reached without the feature, and `/orgs` + `/launch`
  deliberately outside the 2FA gate. There was no proxy unit test before this;
  the file's one-line predicate change is the most security-adjacent edit in the
  slice and was otherwise coverable only by e2e.

## Files Modified

- `src/lib/authz.ts` — `OrgAccessError` (replacing the bare `throw new Error` in
  `withOrgContext`), `OrgContext`, `OrgResolution`, `resolveOrgContext()`,
  `publicOrgSummary()`, `assertOrgAccess()`.
- `src/lib/authz.test.ts` — 22 new cases beside slice A's 12: the four
  `resolveOrgContext` outcomes plus the ended-at-an-unmanaged-org ordering, the
  "forbidden carries nothing to tell the three cases apart" assertion, "does not
  read the public tree when a relationship exists" (the resolution order that
  *is* the security property), `publicOrgSummary`'s two outcomes, and the
  `OrgAccessError` / `set_config`-ordering behavior of `withOrgContext`.
- `src/lib/auth/safe-callback.ts` — fallback `/home` → `/launch`, both branches
  and the docblock, with the "stays a pure string function" rule written in.
- `src/lib/auth/safe-callback.test.ts` — the six `/home` assertions become
  `/launch`, plus three added (see Implementer Notes 1).
- `src/proxy.ts` — the 2FA gate becomes
  `pathname.startsWith("/admin") || pathname.startsWith("/o/")`, with the
  prescribed comment block above it and the fall-through comment extended to
  name `/launch`, `/orgs`, `/no-organization`, `/o/*`.
- `src/app/(admin)/developer/guard.ts`,
  `src/app/(admin)/developer/schema.json/route.ts` — both adopt
  `readIsPlatformAdmin`; their `redirect("/home")` / 403 targets are unchanged.
- `src/app/(account)/account/2fa/totp-enroll-form.tsx` — `?? "/home"` →
  `?? "/launch"` (see Implementer Notes 4).
- `docs/TODO.md` — the stale-replica line closed (Workflow Rule 10).

## Files Deleted

- `src/app/(auth)/totp/actions.test.ts` — the stale replica, per the design.

## Schema Changes

None. This slice reads; it writes nothing and adds no migration.

## Audit Events

None, deliberately — Edge Cases R7. Auditing the miss path would let any
signed-in user write rows into every congregation's access log by looping over a
**public** slug list, and per F18 those rows would carry the tenant's
`organization_id`. `npm run check:audit` passes (no `actions.ts` in the slice).

## Dependencies

None added.

## Implementer Notes

**Three places the design's instructions did not survive contact, reported
rather than worked around.**

1. **Deleting `(auth)/totp/actions.test.ts` as written would have silently
   dropped two attack-vector assertions.** The design says "`safe-callback.test.ts`
   is the coverage." It was not, quite: the replica asserted `javascript:` and
   `data:` URIs are rejected, and `safe-callback.test.ts` had no equivalent —
   its eight cases covered protocol-relative, absolute-http, bare-domain, null,
   undefined and empty only. Both assertions were moved onto the real function
   before the file was deleted, along with a new one pinning `/o/<slug>` passing
   through untouched (the "it does not learn about org slugs" rule, which
   nothing asserted). Net for that file: 8 cases → 11.

2. **`publicOrgSummary` needs no cast, and that is worth keeping.**
   `organizations.organization_type` is a `pgEnum`, so Drizzle already types the
   selected column as the five-value union — it is assignable to
   `OrganizationType` directly. The design's signature is met without an `as`,
   which matters here more than it usually would: an `as OrganizationType` on a
   row from this table is exactly the kind of widening that would let a later
   `select` grow a `platformStatus` field without the type system objecting.

3. **The design's slug parser passes a bare `/o/` through as a non-org path.**
   `orgSlugFromPath("/o/")` returns `null` (there is no second segment), so the
   requested-path branch honors it and `/launch?next=/o/` redirects to `/o/`,
   which is a 404 once C2 lands. Implemented as specified — the alternative
   (treating a slug-less `/o/` as non-enterable) would be a silent divergence
   from a written parser — and pinned with a test so the behavior is a decision
   rather than an accident.

**Other notes.**

4. `totp-enroll-form.tsx`'s `?? "/home"` was already unreachable: the page
   passes `sanitizeCallbackUrl(sp.callbackUrl)`, which is never nullish. Changed
   anyway because the design lists it, and because a dead default that reads
   `/home` is the next reader's wrong mental model of where sign-in lands.

5. `computeDestination` keeps the loop guard **inside the function** as well as
   in the design's `/launch` page sketch. R10 asks for it to be unit-tested, and
   a guard that lives only in the page is not. The function stays total: it is
   safe to hand it any sanitized path.

6. **`readIsPlatformAdmin` returns `me?.isPlatformAdmin === true`**, not
   `!!me?.isPlatformAdmin`. Same result today; the explicit comparison is the
   one that keeps returning `false` rather than `undefined` if the column type
   ever changes shape.

7. The four `/home` references the architect verified as still valid remain
   valid: `/home` is not deleted, and `developer/guard.ts` still redirects there.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings=0`) | pass |
| `npx vitest run` | 38 files, **486 tests**, all pass (was 450 at slice B + A; +48 written here, −12 deleted with the replica) |
| `npm run check` | audit-coverage pass, `sql<Date>` guard pass |
| `npm run build` | compiled successfully |

**Against the real database** (`psql "$APP_DATABASE_URL"`, i.e. as `presby_app`,
never the owner):

- `select name, organization_type from organizations where slug = 'quillhaven'`
  with **no org GUC set** returns the row, and `select count(*) from organizations`
  returns the whole tree (6). That is the exact read `publicOrgSummary` performs
  and the humane 403 depends on.
- `presby_user_organizations()` over the six `router.*` fixtures returns exactly
  the shapes the four `resolveOrgContext` outcomes need:
  `router.mixed@`/`fernwood` → `ok`, `router.ended@`/`fernwood` (`ended_on`
  `2026-03-31`) → `ended`, `router.unmanaged@`/`quillhaven` → `forbidden`,
  `router.dup@` → two rows for one organization, de-duplicated by the wrapper.

**Against the running dev server** (the Edge runtime, not the node build the
unit test exercises): unauthenticated `GET /o/fernwood`, `/orgs` and `/launch`
each return `307` to `/signin?callbackUrl=…` with the path preserved and
correctly encoded (`%2Fo%2Ffernwood`). The deep link survives the proxy, which
is the half of e2e case 4 that does not need a page to exist.

**Not run here, and it is a gate, not an oversight:** the running-server e2e
login smoke. Every landing assertion in `e2e/member-home.spec.ts` and the new
`e2e/post-login-routing.spec.ts` needs `/launch` to exist, and `/launch` is C2.
Slice C is one commit for exactly this reason — **C1 must not be committed or
deployed on its own**: `sanitizeCallbackUrl` now points every fallback at a
route that 404s until C2 lands.

## Handoff

**Next agent: `ux-developer` (slice C2)** — the four pages, `(org)/layout.tsx`,
`error.tsx`, `not-found.tsx`, the page-local components, and the `page.tsx` +
`GlobalNav` links. Then C3 (e2e fixtures and specs, CLAUDE.md's Post-Login
Landing section, the architect agent line, `docs/product/functionality-map.md`)
and `qa`.

**The contract C2 consumes.** No HTTP routes, no server actions; five function
signatures.

```ts
// src/app/launch/destination.ts — pure, imports nothing
computeDestination(input: {
  enterableOrgs: ReadonlyArray<{ slug: string }>;   // = availableOrganizations()
  isPlatformAdmin: boolean;                          // = readIsPlatformAdmin()
  canAccessAdmin: boolean;                           // session roles/features
  requestedPath: string | null;                      // already sanitized
}): { path: string; reason: "requested-path" | "single-org"
      | "platform-admin-only" | "chooser" | "no-organization" }

// src/lib/platform-admin.ts — "server-only"
readIsPlatformAdmin(userId: string): Promise<boolean>

// src/lib/authz.ts — "server-only"
resolveOrgContext(userId: string, slug: string): Promise<
  | { kind: "ok"; org: OrgContext }
  | { kind: "ended"; name: string; endedOn: string }        // endedOn is 'YYYY-MM-DD'
  | { kind: "forbidden"; name: string; organizationType: OrganizationType }
  | { kind: "not-found" }>

publicOrgSummary(slug: string):
  Promise<{ name: string; organizationType: OrganizationType } | null>

assertOrgAccess(personId: string, organizationId: string): Promise<void>  // throws OrgAccessError

// OrgContext = { organizationId, personId, name, organizationType, slug, platformStatus }
```

Auth + gate for each: all of them are called from a page that has already
established a session; the Edge guarantees authenticated + active + 2FA for
`/o/*` and **nothing else**. No `FEATURES.*` key gates any of this, and none may
be added (DECISION-035). `resolveOrgContext` is the org-scoped authorization;
`assertOrgAccess` is the in-transaction re-check and must be called by every
`(org)` page, including the ones that read no tenant data.

**Three things C2 must not undo:**

- `OrgAccessDenied` renders **one string** for `forbidden`, byte-identical
  across `managed` / `invited` / `unmanaged`. The resolution deliberately hands
  you no `platformStatus` to branch on; do not go and fetch one.
- `endedOn` is a `'YYYY-MM-DD'` **string**. Render it with `FormattedDate`
  (`mode="date"`); constructing a `Date` from it re-introduces the timezone bug
  slice A fixed in SQL.
- `error.tsx` cannot name the organization — Next replaces the message with a
  digest in production. The named, dated copy comes from the `ended` branch;
  `error.tsx` is the genuine race only.

**Seed / FEATURES changes: none.** `npm run db:seed` is unchanged, no
`FEATURE_CATALOG` entry, no role binding, no new flag.

**New copy strings in this slice:** none — it renders nothing. The
`OrgAccessError` message is developer-facing and never reaches a user.

---

# Phase 4 — Implementation · Slice C2/C3 (the pages, e2e, docs, ux-developer), 2026-08-18

Scope: the design's C2 (four pages, the `(org)` group, error and not-found
boundaries, page-local components, the `page.tsx` and `GlobalNav` links) and C3
(the e2e fixture helper and specs, CLAUDE.md, `docs/product/functionality-map.md`,
`docs/TODO.md`).

**Two defects were found and fixed that are outside a UX slice's usual
territory.** Both are written up under Findings, and both blocked the feature
rather than merely bruising it: `withOrgContext()`'s membership gate rejected
every member, and `<FormattedDate>` rendered a calendar date as the previous day.

## Files Created

**Pages and page-local components**

- `src/app/launch/page.tsx` — gathers session, `availableOrganizations()` and
  `readIsPlatformAdmin()`, calls `computeDestination()`, redirects. The try
  wraps the fetch only; the catch returns JSX, so the redirect physically
  cannot be moved inside it without a type error.
- `src/app/(member)/orgs/page.tsx` — the chooser, plus `destination-card.tsx`,
  `loading.tsx`, `error.tsx`.
- `src/app/no-organization/page.tsx` — the five-state zero-org funnel, plus
  `loading.tsx`.
- `src/app/(org)/layout.tsx` — chrome and the group contract, no auth logic.
- `src/app/(org)/o/[slug]/page.tsx`, `org-states.tsx` (`OrgAccessDenied`,
  `OrgAccessEnded`, `OrgPortalStub`), `error.tsx` (`"use client"`),
  `not-found.tsx`.

**Shared**

- `src/components/shared/organizations-unavailable.tsx` — the DB-unreachable
  state. Shared rather than page-local (the design said page-local) because
  three pages read the org list and three sentences for one condition is how
  copy drifts.
- `src/lib/org-display.ts` + `.test.ts` — the five organization-type labels, in
  one place, with a test that asserts none of them contains membership language.

**Server (see Findings F-C1)**

- `drizzle/0015_presby_membership_probe.sql` — `presby_membership_is_active()`,
  SECURITY DEFINER. Journaled as `idx: 15`.

**Tests**

- `e2e/support/seed-orgs.ts` — four `e2e-` organizations and four relationships.
- `e2e/post-login-routing.spec.ts` — 12 tests: the five mandatory auth-path
  smokes, the four browser-verification cases the design names, plus the ended
  relationship's date and the GlobalNav link.
- `src/lib/platform-admin.test.ts` — `sessionCanAccessAdmin`.

## Files Modified

- `src/lib/authz.ts` — the membership probe now goes through the definer
  function (F-C1); `isEnterableOrganization()` exported so the chooser and the
  router cannot drift.
- `src/lib/platform-admin.ts` — `sessionCanAccessAdmin()`, the session-claim
  half of the two platform predicates, extracted because three places must
  agree on it.
- `src/components/shared/formatted-date.tsx` + `.test.tsx` — the calendar-date
  branch (F-C2).
- `src/components/shared/global-nav.tsx` — an "Organizations" link for every
  signed-in user.
- `src/app/page.tsx` — the signed-in secondary button becomes "Continue" →
  `/launch`. Its hand-rolled classes are left alone: converting one of two
  adjacent buttons would leave the page half-migrated, and the migration is
  P0.5's.
- `src/lib/authz.test.ts` — the probe fixtures change shape; five cases added.
- `e2e/support/users.ts` — four organization fixtures, all `roleName: null`.
- `e2e/support/global-setup.ts` — calls `seedE2EOrgs()` on the **platform**
  connection; the cosmetic `callbackUrl` becomes `/launch`.
- `e2e/member-home.spec.ts` — four deliberate contract updates (below).
- `e2e/admin-login.spec.ts` — the stale `/home` comment.
- `scripts/test-rls.sql` — section 13, five assertions.
- `CLAUDE.md`, `docs/product/functionality-map.md`, `docs/TODO.md`.

## Schema Changes

One function, no tables, no columns: `presby_membership_is_active(uuid, uuid)`,
`stable security definer`, `set search_path = public`, EXECUTE granted to
`presby_app` alone. Applied with
`psql "$MIGRATE_DATABASE_URL" -f drizzle/0015_presby_membership_probe.sql`.
Rationale in the migration header and in Findings F-C1.

## Audit Events

None, and unchanged from the design's reasoning (Edge Cases R7): auditing the
miss path would let any signed-in user write rows into every congregation's
access log by looping over a public slug list, and per F18 those rows would
carry the tenant's `organization_id`. `npm run check:audit` passes — no
`actions.ts` in the slice, and P0 writes no tenant data at all.

## Dependencies

None added. `package.json` and `package-lock.json` are untouched.

## Findings

### F-C1 — `withOrgContext()` rejected every member. The tenant gate has never worked.

**Severity: this broke the happy path.** Every authenticated visit to
`/o/<slug>` by a genuine member landed on the error boundary. It was invisible
to `tsc`, to `next build`, and to the unit tests, and it surfaced on the first
screenshot.

`withOrgContext()` checks membership *before* setting `app.current_org_id` —
deliberately, so the check cannot be satisfied by the very context it
authorizes. That ordering is right. The query underneath it was not:

```sql
select 1 from memberships
 where person_id = $1 and organization_id = $2 and ended_on is null
```

`memberships` is FORCE RLS with policy `organization_id = presby_current_org()`,
and with no GUC set `presby_current_org()` is null. Measured as `presby_app`:

```
no GUC   -> 0 rows
with GUC -> 1 row
```

So the gate returned "no membership" for **every person at every organization**.
This is **F26 in its purest form** and the third time the shape has appeared in
this schema (the cross-org insert guard, `presby_two_factor_required`, now this):
a query that must see across or before org context, filtered by the RLS it
exists to complement, failing closed and looking correct.

It has been latent since the resolver landed, because `withOrgContext` had no
callers. P0 is the first consumer, and slice C2 is the first slice with a page.

**Fix:** the same one the schema already uses twice — a narrow SECURITY DEFINER
probe. `presby_membership_is_active(person, org)` takes both identifiers from
the caller and returns one boolean, so it confirms a pair the caller already
named and returns no row data; EXECUTE is `presby_app` only.

**Rejected alternative, and why it is worth recording:** setting the GUC first
and then checking would also work — the organization id is passed explicitly, so
RLS could not make a non-member's check pass. It was rejected because it inverts
the one ordering CLAUDE.md names as an invariant, and it leaves an unauthorized
organization id in a transaction-local GUC one careless early return away from
being used. The ordering was worth keeping.

**Coverage:** `scripts/test-rls.sql` section 13 pins the pair the way section 11
pins the 2FA function — the definer probe sees the relationship with no org GUC
set, and the naive query sees nothing at all, so weakening either is a red suite.
Plus four unit tests, one named as the regression.

**This is a database change made inside a UX slice.** It should get a
database-admin's eye in Phase 5 even though the isolation suite passes: the
design itself said the migration work wants that review, and this is migration
work.

### F-C2 — `<FormattedDate>` rendered a calendar date as the previous day

The C1 handoff says: *"`endedOn` is a `'YYYY-MM-DD'` string. Render it with
`FormattedDate` (`mode="date"`); constructing a `Date` from it re-introduces the
timezone bug slice A fixed in SQL."*

`FormattedDate` constructs a `Date` from it. Measured before the fix, in
`America/New_York`:

```
<FormattedDate value="2026-03-31" mode="date" />  ->  3/30/2026
```

`new Date("2026-03-31")` is parsed as **UTC** midnight per the ES spec, then
formatted locally. Slice A found and fixed this one layer down, casting
`ended_on::text` in SQL so the driver could not invent a midnight; the component
promptly invented one of its own. It would have landed on the single page in P0
whose entire job is to state a date correctly.

The fix distinguishes the two kinds of value the component takes, which it never
did before: an **instant** (Date, epoch, full ISO timestamp) happened at one
moment everywhere and *should* shift with the viewer — that is the component's
whole purpose. A **calendar date** has no time and no zone; 31 March is 31 March
in Anchorage and in Berlin, and shifting it is a bug. A `'YYYY-MM-DD'` string is
now parsed as local midnight, always formatted date-only, and carries the bare
date in `<time datetime>` rather than a fabricated UTC timestamp.

Written test-first: four cases added, confirmed failing on the old component,
and the suite passes under `TZ=America/New_York`, `Europe/Berlin` and
`Pacific/Auckland`. E2E test 11 asserts it end to end in a real browser in
`America/Los_Angeles` and `Pacific/Auckland`.

**This is a shared component with existing consumers.** `mode="datetime"` on a
timestamp is untouched; the only behavior change is for date-only strings, which
previously rendered wrong for most of the world.

### F-C3 — `loading.tsx` silently downgrades a redirect to 200 and a 404 to 200

The design and `docs/ui-standards.md` both ask for a `loading.tsx` on every
segment doing async work. Adding one to `/launch` and to `/o/[slug]` broke both:

```
with loading.tsx:     /launch -> 200          /o/no-such-slug -> 200
without:              /launch -> 307 /o/e2e-alpha   /o/no-such-slug -> 404
```

A `loading.tsx` opens a Suspense boundary, so Next flushes response headers
before the page resolves. `redirect()` then degrades to a client-side navigation
embedded in the RSC payload — a blank 200 to `curl`, to a link checker, and to
anything without JS — and `notFound()` renders the 404 page at HTTP 200, which
fails the DECISION-040 contract outright.

Removed from both. `/orgs` and `/no-organization` keep theirs: they always
render. The rule is now written into CLAUDE.md → Post-Login Landing, because the
next person to read the UI-standards checklist will otherwise add them back.

It also masked a second problem while it was there: the byte-identical
comparison of the two access-denied pages failed, because the skeleton was being
compared rather than the page.

### F-C4 — `on conflict do nothing` is not idempotent against a BEFORE INSERT trigger

`e2e/support/seed-orgs.ts` must be safe to re-run. The obvious form —
`insert ... on conflict (person_id, organization_id) do nothing` — worked once
and failed on the second run with *"person already exists elsewhere; link
through presby_claim_person()"*. `on conflict` is resolved **after** BEFORE
INSERT triggers have run, so the F21 guard fires even when the row is about to
be discarded. `insert ... select ... where not exists` produces no row at all
and keeps the trigger out of it. Worth knowing anywhere in this schema, not just
in a fixture.

### F-C5 — `organizations.path` is not `ltree`

The design and the seed file both describe `path` as ltree, and
`e2e/support/seed-orgs.ts` was written with a `::ltree` cast. The cast fails:
the extension is not installed (only `btree_gist` is) and
`src/lib/db/domain/org.ts` declares `path: text()`. The column is ltree-*shaped*
by convention only. Left in label form, with the discrepancy documented at the
fixture; nothing here needs the extension, but a future ancestor query would.

### F-C6 — sign-in is two soft navigations, and the existing specs waited for the first

`waitForURL(u => u.pathname !== "/signin")` now resolves at `/launch`, mid-flight,
because the sign-in action redirects to `/launch` and `/launch` redirects again —
both as client-visible navigations. Seven specs failed on this and none of them
failed for a real reason. The predicate now excludes `/launch` as well. A user
sees the same brief `/launch` in the address bar; that is inherent to having a
router page and is the price of the matrix living in one testable file.

## Implementer Notes

**Where the design was followed, deviated from, and why.**

1. **The chooser grid is `sm:grid-cols-2`, not `sm:grid-cols-2 lg:grid-cols-3`.**
   `/orgs` lives in `(member)`, whose layout constrains `<main>` to `max-w-2xl`
   (672px). Three columns there is 210px per card. Widening the layout would
   move `/home`, `/whats-new` and `/feedback`, which is P1's call, not a
   drive-by in the router's slice.

2. **`OrganizationsUnavailable` is in `src/components/shared/`, not page-local.**
   Three pages read the org list and all three need the same sentence.

3. **`isEnterableOrganization()` is exported from `authz.ts` — a small addition
   to the C1 contract.** `/orgs` reads the *unfiltered* list (it names the
   organizations still being set up), so without this it would carry its own
   inline copy of `availableOrganizations`' filter. The day the two drift is the
   day `/launch` forwards a single-organization user into an `/o/<slug>` the
   chooser refuses to show a card for.

4. **`sessionCanAccessAdmin()` is extracted for the same reason**, one level up:
   the Edge, `/launch` and `/orgs` must agree, and a disagreement sends a user
   to a page the Edge bounces to `/access-pending` — which reads as a broken
   login, not as a permissions problem. `src/proxy.ts` keeps its own inline copy
   because it cannot import a module that pulls `@/lib/db`; the two are pinned
   by tests on both sides.

5. **The loop guard lives in `computeDestination()` only**, not also in the page
   as the design's sketch had it. It is unit-tested there and the function is
   total; a second copy is a second thing to keep in step.

6. **A fifth e2e organization fixture was added: `org-ended`.** The design's
   fixture list has no ended relationship, so the one screen in P0 that renders
   a date would have shipped verified by unit test only — and that screen is
   exactly where F-C2 would have landed.

7. **`assertOrgAccess()` is called even though the stub reads nothing.** That is
   the design's instruction and it earned its keep immediately: it is what
   surfaced F-C1. A page that skips it because it has no data to read is the
   hole.

8. **Three things C1 asked me not to undo, all intact.** The `forbidden`
   response is one string, verified byte-identical between a `managed` and an
   `unmanaged` organization by an e2e assertion rather than by reading the
   source. `endedOn` is rendered through `FormattedDate` and never through
   `new Date`. `error.tsx` is `"use client"` and names no organization.

**Accessibility and UI states.** Every async surface has all four states.
Loading: skeletons on `/orgs` and `/no-organization`. Empty: `/orgs` renders a
designed empty state pointing at `/no-organization` and **omits the "Your
organizations" heading entirely** when there are no cards (G12) — a platform
admin with no congregations never sees an empty section. Error: caught in-page
as `OrganizationsUnavailable`, with `error.tsx` boundaries behind it. Cards are
`<Link>`-wrapped with a visible `focus-visible` ring on the link rather than the
card; buttons carry `min-h-11` for the 44px target; headings run h1 → h2 → h3
with `<main>` and `<nav>` landmarks; the card badge is text, not colour alone.
No native dialogs, no `console.log`, no `toLocale*` outside the primitive.

**Not done, and deliberately.** The design lists a one-line addition to
`.claude/agents/architect.md` pointing at the new CLAUDE.md section. That file is
agent configuration and was not in this slice's brief; the section it references
now exists, so the pointer resolves either way. Flagging it rather than editing
it.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings=0`) | pass |
| `npx vitest run` | 40 files, **505 tests**, all pass (was 486; +19) |
| `npm run check` | audit-coverage pass, `sql<Date>` guard pass |
| `npm run build` | compiled successfully; `/launch`, `/orgs`, `/no-organization`, `/o/[slug]` all present |
| `scripts/test-rls.sql` as `presby_app` | **59 assertions**, all pass (was 54; +5) |
| `npm run test:e2e` | **63 passed**, 0 failed, `.auth/` deleted first so every session was re-acquired |

**Browser verification** — Chromium, `npm run dev`, `.env.local` with
`RATE_LIMIT_DISABLED=true`. Full-page screenshots at **360px and 1280px** in
**both colour schemes**, signed in as five fixtures. Every row of the
destination matrix was walked, not inferred:

| Fixture | `/launch` lands on | Also checked |
|---|---|---|
| `admin` (0 orgs, canAccessAdmin) | `/admin` | `/orgs` → Platform block only, **no empty "Your organizations" heading** |
| `member` (0 orgs, 0 platform) | `/no-organization` | zero-rows copy + both doors |
| `org-single` (1 org) | `/o/e2e-alpha` | `/orgs` renders and does not auto-forward |
| `org-multi` (congregation + presbytery) | `/orgs` | two cards, both links open the stub; `/o/e2e-beta` and `/o/e2e-gamma` denied; `/o/nope` 404 |
| `org-unmanaged` (non-tenant only) | `/no-organization` | "in our records through its presbytery" |
| `org-ended` | `/no-organization` | named + dated; `/o/e2e-beta` ended page |

Light mode was checked as carefully as dark — it has only worked since slice B,
so these are the first new pages ever rendered in it. Surfaces are white, text
is dark navy, `border-border` hairlines are visible, the primary button is
blue-600 on white at 5.2:1, and the outline badge reads at 12px. At 360px
nothing overflows, the card grid collapses to one column, the two-line
access-denied heading wraps cleanly, and the global nav's four items fit without
wrapping.

The date was verified in two timezones on either side of UTC:
`America/Los_Angeles` and `Pacific/Auckland` both render **3/31/2026** for a
`2026-03-31` relationship, on both the ended page and `/no-organization`.

## Handoff

**Next agent: `qa` (Phase 5).** Read §E2E blast radius in Phase 3 first — four
previously-green specs were *supposed* to change, and one of them
(`member-home` test 3) needed an explicit `goto("/home")` for a reason unrelated
to what it asserts.

**What a reviewer should click through in a browser.** Sign in as each fixture
in `e2e/support/users.ts` (password in the same file; they are all on
`example.invalid`) and watch where you land — that is the feature. Specifically:

1. `e2e-org-multi@` → the chooser. Read the cards: **organization name and type
   only.** If a future change makes one say "member", that is DECISION-039
   broken.
2. From there, `/o/e2e-beta` and `/o/e2e-gamma`. One is a tenant and one is not.
   The two pages must be the same sentence. Then `/o/anything-else` → a real 404.
3. `e2e-org-ended@` → `/o/e2e-beta`. It should say **31 March 2026**. Change
   your machine's timezone to Los Angeles and reload; still the 31st.
4. `e2e-admin@` → straight to `/admin`; then `/orgs` by hand — it must show the
   Platform block with **no empty "Your organizations" heading above it**.
5. `e2e-member@` → `/no-organization`. This is the funnel; read it as someone
   who has just signed up and does not know why they cannot get in.
6. All of it at 360px, in light mode.

**New copy strings a fork's branding pass should review.** This slice is the
first in the program with real user-facing prose:

- *"Where would you like to go?"* / *"You can come back to this page at any
  time."* — the chooser.
- *"You don't have access to {organization}."* + *"If you should have access,
  ask an administrator at that organization to add you. They will need the email
  address you signed in with."* — **this one string must stay one string.**
- *"Your access to {organization} has ended"* / *"…ended on {date}."*
- *"You're not connected to a congregation yet"* and the four sibling states on
  `/no-organization`, plus the two doors: *"Ask your church administrator"* and
  *"Is your church not on presby?"*.
- *"We can't reach your congregations right now"* / *"This is on our end, not
  yours — nothing about your access has changed."*
- *"You're in. There is nothing here yet — the roll, the directory, and the
  officer register arrive with the organization portal."* — the stub, which
  should be replaced wholesale by P1.
- The five organization-type labels in `src/lib/org-display.ts`. These are Book
  of Order polity terms, not product vocabulary; a branding pass should not
  translate them casually.

**UX tradeoffs made.**

- **A visible `/launch` in the address bar for a beat.** The cost of the matrix
  being one testable file instead of being smeared across sign-in, the OAuth
  callback and `/totp`. It is a redirect, not a rendered page, so there is no
  flash of content.
- **No `loading.tsx` on `/launch` or `/o/[slug]`** (F-C3). A skeleton there costs
  a real 307 and a real 404. The status codes won.
- **The `/orgs` grid is two columns at most**, because the member layout is
  672px wide. Wider is P1's decision.
- **`/` keeps its hand-rolled buttons.** Migrating half a page is worse than
  migrating none; P0.5 owns it.
- **The access-denied page renders at HTTP 200** (DECISION-044(3)). Filed.

**Two things for QA to look at with more than usual care**, both because they
are outside the slice's nominal scope: `drizzle/0015_presby_membership_probe.sql`
wants a database-admin's eye on the SECURITY DEFINER decision, and
`src/components/shared/formatted-date.tsx` is a shared primitive with existing
consumers.
