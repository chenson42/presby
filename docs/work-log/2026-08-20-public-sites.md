# Public Organization Websites (P3) — Work Log

> **Slug:** `2026-08-20-public-sites`
> **Surface:** public (`(public)/site/[slug]`), plus a small platform-side
> data/admin surface to track which orgs have a site
> **Permission(s):** TBD by Phase 1 — likely reuses `tickets.file`/the
> ticket-worker flow for content changes, no new tenant permission expected
> **Flag(s):** TBD by Phase 1
> **Estimated complexity:** large — new GitHub-org-level infrastructure
> (a shared component/rendering package, per-org content repos, CI-driven
> staging, OIDC-authenticated ingest), not just application code
> **Pipeline mode:** Full, run with agents

---

## Context carried forward

This pipeline formalizes an architecture reached through direct
back-and-forth with the user (not pre-decided by an agent) — read this
section as binding design direction, not a proposal Phase 1 should
re-litigate from scratch. Phase 1's job is to turn this into concrete user
verbs, flows, and named gaps — not to second-guess the shape.

**Why now.** `docs/product/functionality-map.md`'s own "presby: NOT built"
line has named "sites" since the start of this session. The support-ticket
pipeline (`docs/work-log/2026-08-20-support-tickets.md`, shipped) was
explicitly designed around `change_class` including `content`/`config`/
`theme` — categories that only make sense once something like a public site
exists for a ticket to be *about*. This pipeline is that missing piece,
and it is meant to close the loop: a ticket asking for a site change is
resolved by a platform operator pairing with Claude Code to edit and
commit real content, per the user's own framing earlier this session
("most would be worked in combo by a platform worker and Claude Code").

**The locked architecture, in full:**

**Three kinds of repo, one GitHub org:**
1. **`presby`** (existing, this repo) — unchanged. Stays synthetic-only
   forever, per the standing "No Real Data" invariant — real per-org site
   content must never enter this repo's history.
2. **`presby-site-kit`** (new repo) — the shared Next.js rendering shell
   plus a *fixed, allowlisted* MDX component library (a hero section, a
   staff list, a group-based photo gallery, a contact form, an event list
   — exact set is Phase 1/3's to enumerate) plus a reusable GitHub Actions
   workflow (validation + normalization + staging). Versioned; content
   repos pin a version, the same way any app depends on a library.
3. **`site-<slug>`** (new, one per congregation, created on demand) —
   content only: MDX pages, front-matter, images. No app code, no
   framework, nothing that runs. This is where real congregation data
   lives — names, photos, addresses — explicitly outside `presby`'s own
   repo and outside its "No Real Data" invariant's scope.

**Runtime: `presby` itself is the single server for every org's public
site.** One route, `(public)/site/[slug]/page.tsx`. No per-org deployment,
no per-org Vercel Project — this was chosen specifically over one-Vercel-
project-per-org after working through the operational cost of hundreds of
independently-managed deployments, and over classic "micro-frontend"
JS-bundle-federation after identifying that letting an org's repo ship
code the platform executes at runtime would blow through the exact
guardrail the user asked for.

**Content reaches the platform by staging, not by the platform fetching
from GitHub at request/render time:**
- Each content repo's inherited CI (from `site-kit`) validates on push to
  `main`: front-matter schema, the component allowlist, image constraints.
  Fast, visible feedback on the PR/commit itself.
- CI then normalizes the content into structured-but-unrendered form
  (parsed MDX AST + validated front-matter + an image manifest) —
  deliberately **not** pre-rendered HTML. Keeping the render step
  centralized in whatever `site-kit` version is currently running inside
  `presby` means a renderer bug-fix or new component benefits every org's
  site immediately, without requiring hundreds of repos to re-run CI.
- CI pushes that bundle to a platform-owned ingest endpoint, authenticated
  via **GitHub Actions OIDC** (a short-lived token scoped to the specific
  repo/workflow run, verified server-side against its claims) — not a
  long-lived secret stored in hundreds of repos.
- The platform stores the staged bundle in the **existing tenant-scoped
  blob adapter** (`src/lib/storage/blob-store.ts`, already proven on org
  logos and ticket attachments) rather than a new storage subsystem.
- **The ingest call itself is also the revalidation trigger** — it stages
  the content AND fires on-demand ISR for that org's affected paths in one
  action. No separate webhook plumbing. The platform never calls out to
  GitHub at request time at all — no rate limits, no read credentials to
  manage across many repos, no dependency on GitHub's uptime for serving
  traffic.
- A ticket is "done" only when CI passes *and* ingest succeeds — both
  externally observable facts, never an inference from a page looking
  right.

**Guardrails are structural, not just CI policy.** Content is data the
platform's renderer interprets, never code it executes. If content
somehow referenced a component outside the allowlist, there is no code
path by which it becomes running code — the renderer simply doesn't know
it. CI is the fast-feedback layer; the renderer is the real backstop.

**Personalization rides the existing brand system (P0.5) for free.** A
site's colors/logo/type pairing come from the org's already-existing
brand tokens — no second styling system, no new mechanism. "Feels
personal" comes from real prose plus the org's own established brand, not
from letting content authors (or the AI worker) write arbitrary CSS/JS.

**Provisioning a new congregation's site is meant to be scriptable**: create
`site-<slug>` from the `site-kit` template, record the repo reference
against the organization in presby's own DB (a small addition, not a new
subsystem), done — no per-repo secret setup needed since the OIDC trust
and CI inheritance are org-wide. This is itself a natural `config`-class
ticket once the mechanism exists.

**Explicitly not decided yet, genuinely Phase 1/2/3's job:**
- The exact allowlisted component set (beyond the illustrative list above).
- The exact ingest endpoint contract (request/response shape, how
  `organization_id` is resolved from the OIDC token's claims, error
  handling for a rejected/malformed bundle).
- What platform-side DB shape tracks "this org has a site, here's its
  repo" — likely a small addition to `organizations` or a sibling table,
  not decided here.
- Whether the public site route needs its own new permission, or whether
  visibility is purely a function of `organizations.platform_status` (a
  public/anonymous route, so likely no permission at all — this needs
  Phase 1's actual reasoning, not an assumption carried in from this
  section).
- The provisioning automation's actual implementation (Vercel API/GitHub
  API scripting) — real, but likely a Phase 3/4 concern once the rendering
  path itself is proven for one manually-created content repo.
- Image handling specifics (where images actually live — checked into the
  content repo alongside MDX, or uploaded separately through the existing
  blob adapter — Phase 1 should treat this as open, not assume the
  "checked into git" instinct extends to binary assets without weighing
  repo-size implications at hundreds of orgs).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-20 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Both Open Questions from Phase 1, resolved directly by the user (2026-08-20)

1. **The DECISION-041/§14 conflict** — corrected. DECISION-041 now
   carries an appended correction (append-only, not edited in place):
   the routing/security contract stands, the `site_pages`/
   `site_sections` DB-composition data model is superseded.
   `docs/schema-design.md` §14 is marked superseded at its own header,
   kept for historical context only. Phase 2 does not need to write
   this correction itself — it's done.
2. **"P4 — the church's site editor" is dead.** Confirmed by the user:
   the ticket loop is the editor. No self-service in-browser editing
   surface gets built, in this pipeline or later. Editing a site is a
   git commit, made by an operator pairing with Claude Code, exactly
   like any other `content`/`config`/`theme`-class ticket. Phase 2/3
   should design with this as settled, not provisional.

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> A sound, already-negotiated architecture (git content, CI staging,
> OIDC ingest, one platform renderer) that this pass makes concrete —
> but it collides, unreconciled, with an *earlier* locked decision
> (DECISION-041 / `docs/schema-design.md` §14's DB-composition
> `sites`/`site_pages`/`site_sections` model) that Phase 2/3 must
> explicitly supersede rather than silently ignore, and it leaves a
> real unauthenticated write path (the contact form) genuinely open.

## Prior art checked

`../westervillelions` is the closest real analog — a live public
church site, not an MDX pipeline, but its *content shape* is exactly
what a v1 allowlist needs: a hero band, a leadership grid, and —
load-bearing — a `/donate` page that **links out to a third-party
processor (Zeffy)** rather than collecting card data itself, live
proof that "giving stays out of PCI scope via link-out/embed" is
already the right shape, not a hypothesis. `../synod-portal`'s public
`(public)/learn` confirms the anonymous route-group shape but is
hand-authored, no ingest precedent. Neither `../fpcw-directory` nor
`../psvonline-portal` own a public-site concept. None of the four
repos have prior art for the ingest contract or the git-content-repo
shape — this part is genuinely new ground for the whole project
family.

## A structural finding — not a defect in what the user negotiated, a gap in sequencing

`docs/decisions.md` DECISION-041 (2026-08-18) already resolved the
*route and security contract* for public sites: `/site/<slug>` under a
new `(public)` group, custom-domain canonicalization, and — critically
— reads go only through "the narrow SECURITY DEFINER published-content
reader," `getPlatformDb()` forbidden, no `dangerouslySetInnerHTML`.
`docs/schema-design.md` §14's sketch under that same decision is a
**live DB composition engine** — `sites`/`site_pages`/`site_sections`
tables, an implied in-browser editor (`docs/STATE.md`'s own queue
names "P4 the church's site editor" as the very next pipeline after
this one).

The architecture locked this session is a *different* mechanism for
the same problem — content in git, staged by CI, rendered from a
parsed MDX bundle in the blob adapter, not rows in `site_pages`. The
*routing/security* half of DECISION-041 transfers over unchanged and
should be reused, not re-litigated — "sealed sections never restyled"
maps cleanly onto "the allowlisted component set accepts only fixed
props, never arbitrary CSS/JS," arguably a *stronger* version of the
same guarantee. But the *data-model* half is superseded outright, and
nothing on record says so yet. Left unaddressed, a future reader could
reasonably start from §14's sketch and build the wrong tables.
**Recommendation for Phase 2/3, not decided here**: an appended
correction to DECISION-041, the same append-only shape DECISION-072
already models — routing contract stands, composition-engine data
model superseded by git+CI+blob-staged-bundle, `sites` narrows to a
small provisioning/status table.

**A genuine roadmap fork this raises, for the user, not Phase 2/3 to
guess:** does "P4 the church's site editor" still exist? Under the
DB-composition model it meant a browser WYSIWYG editor writing SQL
rows. Under the now-locked git+CI model, "editing your site" is a git
commit, and support-tickets' own Flow 3 already closed the door on any
autonomous AI-attributed write path. Is P4 dead, superseded by "the
ticket loop is the editor," or does it survive in a different form
(e.g. a self-service surface that opens a PR via the GitHub API,
still human-reviewed)?

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Content-repo committer (platform operator + Claude Code, per support-tickets' closure) | Edits MDX/front-matter/images in `site-<slug>`, opens/merges a PR | per ticket |
| GitHub Actions CI (machine actor, OIDC) | Validates, normalizes, requests a token, POSTs the bundle to the ingest endpoint | automatic, every push to `main` |
| Platform operator | Provisions a new congregation's site; observes ingest/CI health | one-time / on demand |
| Anonymous visitor | Browses the site; submits the contact form; clicks a donate link | on demand, unauthenticated |

## Flows

**Flow A — Provision a site:** create `site-<slug>` from the `site-kit`
template, record the repo reference + `status: provisioning` against
the org. Not reachable at `/site/<slug>` until content is staged (404,
same as never-provisioned).

**Flow B — Content change via ticket** (closes the loop with
support-tickets' `content`/`config`/`theme` categories): a ticket is
"done" only when CI passes *and* ingest succeeds, already named as the
bar. **Gap**: nothing wires a CI failure back into the ticket thread
itself — an operator who doesn't separately check the repo's Actions
tab has no signal inside presby that a merge didn't ship.

**Flow C — CI ingest** (the load-bearing machine flow): push → CI
validates → normalizes to a structured bundle → requests a short-lived
OIDC token scoped to that repo/run → POSTs to the ingest endpoint →
platform verifies the token, resolves `organization_id` from the
`repository` claim, checks idempotency by commit SHA, stores via the
blob adapter, fires on-demand ISR. **Gap**: no alerting path named if
ingest starts silently failing for an org while CI itself stays green
— CI only knows its own POST succeeded, not that presby is degraded.

**Flow D — Anonymous browse:** resolve org → read the live staged
bundle → render through `site-kit`'s fixed components with the org's
brand tokens. **Needs a deliberate, uniform answer** for
never-had-a-site / provisioning / suspended — see Gap 5.

**Flow E — Contact form submission:** the one genuinely new
unauthenticated write path in this entire feature. **Has no home
anywhere in the locked architecture** — see Gap 3, the single
highest-value gap in this review.

## Permissions & Flags

- **No new tenant permission for viewing `/site/<slug>`** — fully
  anonymous, gated by a status check (does this org have a live site),
  never `organizations.platformStatus` (that distinguishes tenant/
  non-tenant for the *private* portal deep-link case and has no
  bearing here).
- **Recommend a new platform flag**, `sites.public_render`, a rollback
  switch for the render path itself — this is the platform's newest
  attack surface (externally-authored, structurally-guardrailed-but-
  not-fully-trusted content), worth a kill switch that doesn't need a
  deploy.
- **The ingest endpoint's auth is not session-based at all** — machine-
  to-machine OIDC, the first route in the tree with a wholly different
  auth model. Flag for the architect: confirm it isn't accidentally
  exempt from `check:audit`'s scan path if it lives as a route handler
  rather than a Server Action.
- **Recommend an audit event for successful ingest**
  (`SITE_CONTENT_INGESTED`) despite the actor being a machine —
  `auditEvents.actorUserId` is already nullable with a free-text
  fallback, fits with no schema change. A content mutation with
  immediate public-internet visibility is exactly the audit trail's
  job, in spirit if not letter of Rule 7.

## Gaps the Request Didn't Address

1. **`StaffList`/`EventList` read as live-data-bound in the
   illustrative names, but content repos have no live DB access at
   all under this architecture** — they're static MDX. v1's allowlist
   should be named explicitly as *static/content-authored only*, with
   "pulls from presby's real roll/roster/events" deferred to the
   already-queued "P7 data-bound blocks."
2. **Concrete v1 component allowlist**: `Hero`, `ServiceTimes`,
   `AddressMap` (fixed-template embed, never a raw caller-supplied
   `src`), `StaffList`/gallery (recommend one underlying component
   with an optional bio field, not two), `EventList` (static),
   `SermonEmbed` (restricted to an allowlisted domain set — YouTube/
   Vimeo/SoundCloud/Spotify — extracts an ID, never passes through an
   arbitrary iframe `src`, which would be a live code-injection surface
   inside the "content is data, never code" guarantee), `ContactForm`
   (needs its own design, see Gap 3), `DonateLink` (v1: link-out only,
   mirroring westervillelions' real Zeffy precedent — an *embedded*
   widget is a different trust boundary, deferred), and base MDX prose.
3. **The `ContactForm` submission path is the single highest-value gap
   in this review.** It can't reuse `congregation_feedback` (requires
   an active membership per DECISION-070) and shouldn't become a
   ticket (ticket filing is deliberately role-gated — an anonymous
   stranger filing one would defeat that gate). Needs: a destination,
   IP-based rate limiting (no person to key on), and bot mitigation (no
   CAPTCHA vendor is pre-approved per DECISION-048's dependency
   discipline — even a honeypot field is a real decision). Treat as its
   own small flow, not an allowlist afterthought.
4. **A CI failure has no visible echo in the ticket that asked for the
   change** (Flow B) — at minimum a documented manual step, possibly a
   future webhook back into the ticket thread.
5. **The unpublished/nonexistent/suspended response needs a
   deliberate, uniform answer** — the same enumeration-safety instinct
   DECISION-040 already applied to `/o/<slug>` (byte-identical across
   states) transfers directly: "this congregation's site was
   suspended" shouldn't be distinguishable from "never had one" to a
   random prober.
6. **Platform-side DB shape — concrete recommendation**: a small
   sibling table, shaped like `organization_brands`
   (FORCE RLS, tenant-readable via `withOrgContext()`, admin-writable
   via `getPlatformDb()`), **not** like `organizations` itself —
   DECISION-049 already ruled a bare public grant specifically wrong
   for exactly this shape of data ("readable by any caller with no org
   context, an enumeration oracle"), and a site's status is exactly
   the kind of "is this org a paying tenant" signal DECISION-040 said
   must stay hidden. The public read path never reads this table with
   a bare grant — a narrow SECURITY DEFINER function gated on
   `status = 'live'`, mirroring DECISION-041's contract, returns
   nothing (same as 404) for every other status.
7. **Ingest idempotency**: dedupe on commit SHA — a repeat SHA returns
   200 "already current," skips re-staging/re-revalidating, mirroring
   the blob adapter's own content-hash dedup one level up.
8. **Image handling — concrete recommendation**: use the blob adapter,
   referenced by key, **not** checked into the content repo's git
   history. The failure mode isn't one large file, it's *frequent
   small text edits plus occasional binary replacements retained
   forever* — exactly git's worst case at "hundreds of orgs, multiple
   years" scale, paid on every future clone/checkout. The real cost,
   named honestly: a two-step authoring workflow (upload, then
   reference by key) is worse UX than dropping a file next to content
   — reducing that friction is a Phase 3 implementation detail, but
   the storage decision itself should lock now.
9. **`presby-site-kit` needs its own explicit "No Real Data"
   statement — it will not inherit presby's by proximity.** CLAUDE.md's
   invariant is textually scoped to "this repository." Recommend
   stating it explicitly at repo creation, while `site-<slug>` repos
   are the deliberate, explicit exception — stated so a future session
   doesn't mistakenly block a real congregation from using real
   content.
10. No new leak vector found from the small sites table itself. One
    procedural echo: an ingest-rejection message could in principle
    quote a fragment of offending content back — same "don't paste
    raw content into anything landing in presby's own history"
    mitigation as the ticket-body PII concern already named.

## Out of Scope (confirmed)

No autonomous AI-worker actor anywhere (confirmed consistent with
support-tickets' own closure — commits go through the operator's own
GitHub identity via ordinary git/gh workflow, no independent machine
write authority). The self-service in-browser editor (DECISION-041/
§14's implied "P4") — genuinely unclear whether it still exists in any
form, flagged as an open question, not assumed either way. The
provisioning automation's actual implementation (already named as
Phase 3/4 scope). Multi-language content, a sermon archive, an
embedded donate widget, any per-page CSS/JS.

## Open Questions

1. **Does "P4 the church's site editor" still exist, in what form?** A
   real roadmap fork, not a Phase 2/3 detail — see the structural
   finding above.
2. **Does staged content need a preview step before going live**, or is
   "CI passes + ingest succeeds = live immediately" the intended v1
   behavior? A git PR reviews MDX source, not the rendered page — a
   volunteer congregation's real public site going live with no
   rendered preview is a named, not assumed-away, risk.
3. **Are `site-<slug>` repos private or public GitHub repos?** Changes
   the sensitivity of Gap 6/10 above (a private repo's status leaking
   is more sensitive than a public one's) — not stated anywhere in the
   locked architecture.

## Handoff

**Next: architect (Phase 2).** Carry forward, in priority order: (1)
the DECISION-041/§14 reconciliation — write it down, don't infer it;
(2) the small `sites`-sibling-table shape (FORCE RLS,
`organization_brands`-style, not `organizations`-style); (3)
`presby-site-kit` becomes presby's first cross-repo dependency —
squarely the architect's own dependency charter; (4) the `ContactForm`
path needs its own small design, not folded into the allowlist; (5)
confirm the ingest endpoint's non-session auth model doesn't fall
outside `check:audit`'s scan path. Open Questions 1–3 are for the
user, before Phase 2 designs anything that assumes an answer either
way.

*Recorded by the orchestrator from the read-only analyst agent's
report.*

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

## Edge Cases & Risks

- [Thing that could fail or that needs special handling]

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
