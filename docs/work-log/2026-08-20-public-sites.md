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
| 2 — Architectural review | architect | Complete | Approved with suggestions — DECISION-081/082/083/084/085 | 2026-08-20 |
| 3 — Technical design | tech-lead | Complete | Design complete — split three-commit Implementation Order (database-admin → api-developer → ux-developer); DECISION-086/087/088/089 minted | 2026-08-20 |
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

**Approved with suggestions.** The locked architecture needs no
redesign. One of Phase 1's five priority items surfaced a genuine,
previously-unnoticed correctness gap — not in this pipeline's design,
but in the existing Edge gate — that Phase 4 must fix, not merely
suggest: **`src/proxy.ts` has no bypass for `/site/<slug>` and will
redirect every anonymous visitor to `/signin`, contradicting
DECISION-041's own contract.** Everything else confirms and sharpens
Phase 1's recommendations. Five decisions minted (081–085).

## Placement

- `src/lib/db/domain/sites.ts` — new domain module (`organization_sites`,
  `site_contact_messages`).
- `src/lib/sites.ts` — query-layer module, mirroring `directory.ts`/
  `role-grants.ts`/`tickets.ts`'s established shape.
- `src/app/api/sites/ingest/route.ts` — **not** `api/webhooks/`; that
  directory is scoped to third-party inbound webhooks, GitHub Actions
  OIDC from the platform's own CI is a different trust class.
- `(public)/site/[slug]/{page,layout}.tsx` — as DECISION-041 already
  specifies; `layout.tsx` is `check-brand-scope.mjs`'s already-
  allowlisted, currently-dormant second emitter (DECISION-047/056) —
  building it activates an existing allowance, not a new violation.
- Provisioning: a new section on `/admin/organizations/[id]/page.tsx`
  (reusing `FEATURES.ADMIN_ORGANIZATIONS`, matching how brand config
  already lives there) plus a new cross-org `/admin/sites` list page
  for ingest/CI health, same permission, no new `FEATURES` key.
- Server vs client split: Server Components throughout; the only
  client island is `ContactForm`'s submit interaction.
- Dependencies: **yes, one new dependency** — `presby-site-kit`, a
  pinned-tag git reference, evaluated and approved (DECISION-082).

## Invariants Touched

- **Isolation Is a Database Property** — both new tables FORCE RLS;
  public reads only through the existing DECISION-041/049 SECURITY
  DEFINER projection, never a bare grant.
- **Composite Tenant Keys** — `organization_sites` degenerate (PK =
  `organization_id`, matching `organization_brands`); `site_contact_
  messages` genuine composite.
- **No Role Carries a Wildcard** — no new `FEATURES.*` key;
  `ADMIN_ORGANIZATIONS` reused.
- **Permissions vs Flags** — `sites.public_render` is a bare
  `isFlagEnabled()` rollback switch, not a DECISION-026 auth-critical
  wrapper (this isn't an auth path; fail-closed-to-404 during a DB
  blip is the right direction here, unlike login).
- **The Edge Gate Cannot Reach the Database** — untouched in spirit,
  but `src/proxy.ts` needs an explicit new anonymous-bypass line
  before Phase 4 ships (DECISION-085) — without it the feature is
  broken for every anonymous visitor, not a hypothetical risk.
- **Brand-scope tripwire** — no new rule needed, just flipping
  `required: false → true` on the already-allowlisted second emitter
  once it renders for real.
- **No Real Data** — mitigated procedurally at `presby-site-kit`'s own
  creation (its own explicit statement, carried from Phase 1 Gap 9).

## Notes for Phase 3

1. Name the table `organization_sites`, not `sites` — avoids
   colliding with §14's now-superseded identifier.
2. Both new tables are platform-authorized-write / no-membership-
   caller tables — `getPlatformDb()` for provisioning (admin operator)
   and ingest (OIDC machine, both "verified, no membership" callers);
   the `blob-store.ts`-style trusted-org-context pattern for the
   anonymous `ContactForm` write, gated on "this org's site is live"
   in place of a membership check.
3. **`src/proxy.ts`'s `/site/*` bypass is mandatory, not optional —
   recommend it land in the same commit that creates
   `(public)/site/[slug]/`, so the route is never live-but-broken.**
4. The public brand read for the new layout is new code, not a reuse
   of `read-org-brand.ts` (which needs a `personId` an anonymous
   visitor doesn't have) — brand rides as a field of the same
   published-content projection the page body needs.
5. `ContactForm`'s read side (who inside the org sees messages) is
   left open — `tickets.file` is the plausible-but-undecided reuse
   candidate.
6. `presby-site-kit`'s own consumability (compiled output in the tag,
   vs. a build step) needs a concrete answer before Phase 4 can wire
   the dependency — named as real work, not assumed free.
7. **Pre-existing drift, not introduced here, but adjacent**:
   `src/lib/db/domain/assets.ts`'s Drizzle `check()` calls still
   declare the pre-widening `blob_assets` constraints (PNG/JPEG/WEBP,
   2MB) even though `drizzle/0019` already widened them for ticket
   attachments — a `db:push` would silently *revert* the wider
   constraint. Worth a one-line fix before this pipeline adds a third
   consumer on top of an already-inconsistent source of truth.

*Recorded by the orchestrator from the read-only architect agent's
report.*

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're building the platform's first public, unauthenticated content surface:
`/site/<slug>`, one Next.js render path inside `presby` itself serving every
congregation's public website from content staged by that congregation's own
`site-<slug>` GitHub repo. A GitHub Actions workflow (inherited from a new
`presby-site-kit` dependency) validates and normalizes MDX/front-matter/images
on push to `main`, then POSTs the structured bundle to a new OIDC-authenticated
ingest endpoint, which stores it in the existing blob adapter and fires
on-demand ISR. There is no in-browser editor and no live database composition
— editing a site is a git commit, closing the loop the support-tickets
pipeline opened with its `content`/`config`/`theme` ticket categories.
Two new tables (`organization_sites`, `site_contact_messages`), one narrow
SECURITY DEFINER read function, one small provisioning surface on
`/admin/organizations/[id]`, one new cross-org `/admin/sites` list, and a
mandatory fix to a real, pre-existing gap in `src/proxy.ts` (DECISION-085) that
would otherwise redirect every anonymous visitor to `/signin`.

## Permissions & Flags

- **No new tenant permission.** `/site/<slug>` is fully anonymous, gated on
  `organization_sites.status = 'live'`, never on a permission or on
  `organizations.platform_status` (Phase 1's own ruling, unchanged).
- **`tickets.file` is reused** for the new "Site messages" section on
  `/o/<slug>/tickets` (DECISION-089, below) — no new tenant permission minted.
- **Feature flags, two:**
  - `sites.public_render` (**new**, seeded **OFF**, same "ships dark until the
    page lands" posture as `org_portal.directory`/`org_portal.roles`/
    `org_portal.tickets`) — the whole-feature kill switch. Checked bare, no
    DECISION-026 fail-open wrapper: this is not an auth path, and
    fail-closed-to-404 during a DB blip or an operator-initiated rollback is
    the correct direction here (Phase 2's own ruling). Gates the render path
    (`(public)/site/[slug]/{page,layout}.tsx` and the asset route) and the
    ingest endpoint (a disabled feature should reject ingest too, not just
    hide the read path — an org's content shouldn't silently go "live" behind
    a flag that then flips on with stale-vs-fresh ambiguity). Does **not**
    gate `/admin/organizations`' provisioning UI or `/admin/sites` — an
    operator can provision and monitor sites while the public path stays off.
  - `ui.brand_theming` (**existing**, reused) — the public brand read
    (`getPublishedSite()`) checks it exactly as `read-org-brand.ts` does for
    `(org)`, so the same rollback lever covers both emission paths with one
    flip. Off → `brand: null` in the published-site projection → the public
    page renders on the platform default palette, not a missing page.
- **No new `FEATURES.*` key.** `/admin/organizations` provisioning reuses
  `FEATURES.ADMIN_ORGANIZATIONS`; `/admin/sites` reuses the same (Phase 2's
  ruling, both confirmed below).
- **The ingest endpoint's auth is GitHub Actions OIDC, not a session or a
  permission at all** — verified per-request against token claims (API
  Contract, below), never `hasFeature`/`hasPermission`.

## API Contract

### `POST /api/sites/ingest`

Route handler (**not** a Server Action, **not** under `api/webhooks/` —
DECISION-028's tree is scoped to third-party inbound webhooks; this is the
platform's own CI, a different trust class, per Phase 2's placement ruling).
Bypassed by `src/proxy.ts`'s existing unconditional `/api/*` rule — no proxy
change needed for this route itself, only for the page route (DECISION-085).

**Auth: GitHub Actions OIDC, verified inline with `node:crypto` — no new
dependency (DECISION-087).** `Authorization: Bearer <token>` header, where
`<token>` is a JWT minted by `https://token.actions.githubusercontent.com` via
the workflow's own `id-token: write` permission. Verification, in
`src/lib/sites-ingest-auth.ts`:

1. Fetch (and cache in-memory, ~1h TTL, mirroring `rate-limit.ts`'s plain
   module-level `Map` pattern) GitHub's JWKS from
   `https://token.actions.githubusercontent.com/.well-known/jwks`.
2. Decode the JWT header (base64url, unverified) to find `kid`; look up the
   matching JWK; `crypto.createPublicKey({ key: jwk, format: "jwk" })`;
   `crypto.verify("RSA-SHA256", `${headerB64}.${payloadB64}`, publicKey,
   signatureBuffer)` over the base64url-decoded signature. Reject on any
   verification failure, missing `kid`, or expired `exp`.
3. Check claims:
   - `iss === "https://token.actions.githubusercontent.com"`
   - `aud === process.env.SITES_INGEST_OIDC_AUDIENCE` (**new env var** — the
     audience string the workflow requests via `core.getIDToken(audience)`)
   - `repository_owner === process.env.GITHUB_SITES_ORG` (**new env var** —
     coarse sanity check that the repo lives in the platform's own GitHub org)
   - `ref === "refs/heads/main"` and, where present, `event_name === "push"`
     — rejects a token minted for a PR build or any non-`main` ref
   - `job_workflow_ref` starts with
     `"<GITHUB_SITES_ORG>/presby-site-kit/.github/workflows/"` — the token was
     minted by *site-kit's own* reusable workflow, not an arbitrary workflow a
     content repo could define itself. Prefix match, not an exact pin, so any
     tagged `site-kit` release's workflow is accepted without an ingest
     redeploy on every `site-kit` release.
4. **The commit SHA is read from the verified token's own `sha` claim, never
   from the request body** (DECISION-087) — closes a spoofing gap where a
   compromised or misconfigured build step could claim ingest for a commit the
   token was never minted for.

Returns `{ ok: true, claims: VerifiedOidcClaims }` or `{ ok: false, status:
401, error: string }`. `VerifiedOidcClaims` carries `repository: string` and
`sha: string` — the only two fields the route handler needs.

**Request body** (JSON — no multipart; a GitHub Actions workflow step can
`fetch()` this with a plain `Content-Type: application/json` body):

```ts
interface SitesIngestRequestBody {
  bundle: {
    schemaVersion: 1;
    pages: Array<{
      /** e.g. "/", "/about", "/staff" — site-kit's own routing inside the bundle. */
      path: string;
      /** Validated by site-kit's CI against its own schema; presby treats as opaque JSON. */
      frontMatter: Record<string, unknown>;
      /** Parsed MDX AST; opaque to presby, handed verbatim to renderSiteBundle(). */
      mdxAst: unknown;
    }>;
    images: Array<{
      /** Stable id referenced from inside frontMatter/mdxAst. */
      manifestKey: string;
      contentType: "image/png" | "image/jpeg" | "image/webp";
      bytesBase64: string;
    }>;
  };
}
```

**Response:**

```ts
type SitesIngestResponse =
  | { status: "ingested"; organizationSlug: string; commitSha: string; pageCount: number }
  | { status: "already_current"; organizationSlug: string; commitSha: string }
  | { status: "error"; error: string };
```

- `401` — OIDC verification failed (bad signature, expired, wrong `aud`/`iss`,
  wrong `ref`, wrong `job_workflow_ref` prefix).
- `404` — the token's `repository` claim resolves to no `organization_sites`
  row (site never provisioned). Safe to be specific here — the caller is
  GitHub's own trusted CI, not a public prober, so this isn't an enumeration
  concern the way `(public)/site/[slug]`'s own 404 is.
- `422` — malformed bundle: `schemaVersion !== 1`, `pages.length === 0`, an
  `images[].contentType` outside the three allowed values, or a base64 payload
  that decodes to 0 bytes or exceeds the blob adapter's existing 10MB cap
  (checked per-image via the same sniff the ticket-attachment path uses, plus
  the composed bundle JSON itself against the same cap — see Data Model's
  `blob_assets` widening).
- `200` — `"ingested"` (first-ever or content-changed ingest) or
  `"already_current"` (`commitSha` matches `last_ingested_commit_sha`,
  short-circuits before touching blob storage or ISR — DECISION with Gap 7's
  idempotency requirement).

**Ingest steps** (`src/lib/sites.ts`'s `recordSiteIngest()`, called from the
route handler after auth + idempotency check):

1. Verify OIDC (above); extract `repository`, `sha`.
2. `resolveOrganizationByRepo(repository)` → 404 if none.
3. If `sha === row.lastIngestedCommitSha` → return `"already_current"`
   immediately, no writes.
4. Validate the bundle shape (422 on failure, nothing written).
5. For each `images[]` entry: sniff magic bytes (reuse
   `sniffTicketAttachmentContentType`-style validation, not trust the
   declared `contentType`), `getBlobStore().store()` it (trusted-org-context,
   `organizationId` from step 2) — build a `manifestKey → blobKey` map.
6. Serialize `{ schemaVersion: 1, pages, imageKeys: manifestKeyToBlobKeyMap
   }` as one JSON document; `getBlobStore().store()` it with
   `contentType: "application/json"` (new, see Data Model) — this becomes
   `content_bundle_key`.
7. One `getPlatformDb()` transaction: update `organization_sites` — `status =
   'live'` (first successful ingest promotes `provisioning` → `live`
   automatically; ingest never sets `'suspended'`, only an admin action does),
   `last_ingested_commit_sha`, `last_ingested_at = now()`,
   `content_bundle_key`, `updated_by = null` (machine write).
8. `recordAudit({ action: AUDIT_ACTIONS.SITE_CONTENT_INGESTED, actor: null,
   resourceType: "organization", resourceId: organizationId, metadata: {
   repo: repository, commitSha: sha, pageCount: pages.length, imageCount:
   images.length } })` (DECISION-084 — outside `check:audit`'s scan scope by
   the existing four-precedent pattern; this is the fifth, a route handler,
   not an `actions.ts` file).
9. `revalidatePath(`/site/${slug}`, "layout")` plus a `revalidatePath` per
   page path (`/site/${slug}${page.path}`) — both, since a layout-level
   revalidate alone does not guarantee every already-cached leaf segment is
   torn down under partial prerendering.
10. Return `{ status: "ingested", organizationSlug: slug, commitSha: sha,
    pageCount: pages.length }`.

### Server-action / query-layer signatures — `src/lib/sites.ts`

```ts
// ── Public render path ──────────────────────────────────────────────────
export interface PublishedSiteBundlePage {
  path: string;
  frontMatter: Record<string, unknown>;
  mdxAst: unknown;
}
export interface PublishedSite {
  organizationId: string;
  organizationName: string;
  organizationType: string;
  brand: { tokens: BrandTokenSet; fontPairing: ResolvedTypePairing } | null;
  pages: PublishedSiteBundlePage[];
}
export type GetPublishedSiteResult =
  | { kind: "ok"; site: PublishedSite }
  // Collapses: never provisioned, suspended, nonexistent slug, org inactive,
  // flag off, AND a corrupt/unparseable bundle — all render the same 404
  // (Phase 1 Gap 5's enumeration-safety requirement, extended defensively).
  | { kind: "not_found" };
export async function getPublishedSite(slug: string): Promise<GetPublishedSiteResult>;

// Cheaper sibling for the asset route — skips the blob fetch + JSON.parse.
export async function resolvePublishedOrganization(
  slug: string,
): Promise<{ organizationId: string } | null>;

// ── Admin provisioning (getPlatformDb(), FEATURES.ADMIN_ORGANIZATIONS) ───
export interface SiteAdminDetail {
  organizationId: string;
  repo: string;
  status: "provisioning" | "live" | "suspended";
  lastIngestedCommitSha: string | null;
  lastIngestedAt: string | null;
  createdAt: string;
}
export async function getSiteAdminDetail(organizationId: string): Promise<SiteAdminDetail | null>;

export type ProvisionSiteResult =
  | { kind: "ok" }
  | { kind: "already_provisioned" }
  | { kind: "invalid_input"; error: string };
export async function provisionSite(
  organizationId: string,
  repo: string,
  actorUserId: string,
): Promise<ProvisionSiteResult>;

export type SetSiteStatusResult = { kind: "ok" } | { kind: "not_found" };
/** Admin-manual status flips only (suspend / reactivate). Ingest sets status
 * itself via recordSiteIngest() and never calls this. */
export async function setSiteStatus(
  organizationId: string,
  status: "live" | "suspended",
  actorUserId: string,
): Promise<SetSiteStatusResult>;

export interface SiteAdminListEntry {
  organizationId: string;
  organizationName: string;
  slug: string;
  repo: string;
  status: "provisioning" | "live" | "suspended";
  lastIngestedAt: string | null;
  createdAt: string;
}
export async function listSitesForAdmin(): Promise<SiteAdminListEntry[]>;

// ── Ingest-internal (getPlatformDb(), called only from the route handler) ─
export async function resolveOrganizationByRepo(repo: string): Promise<{
  organizationId: string; slug: string; lastIngestedCommitSha: string | null;
} | null>;
export async function recordSiteIngest(
  organizationId: string,
  input: { commitSha: string; contentBundleKey: string },
): Promise<void>;

// ── ContactForm (trusted-org-context write; DECISION-083/Phase 2 Note 2) ─
export type SubmitContactMessageResult =
  | { kind: "ok" }
  | { kind: "not_live" }
  | { kind: "invalid_input"; error: string };
export async function submitSiteContactMessage(
  slug: string,
  input: { name: string; email: string; body: string },
): Promise<SubmitContactMessageResult>;

// ── ContactForm read side (withOrgContext(), gated on tickets.file — DECISION-089) ─
export interface SiteContactMessageEntry {
  messageId: string; name: string; email: string; body: string;
  status: "new" | "read"; createdAt: string;
}
export type ListSiteContactMessagesResult =
  | { kind: "ok"; messages: SiteContactMessageEntry[] }
  | { kind: "forbidden" };
export async function listSiteContactMessages(
  viewerPersonId: string, organizationId: string,
): Promise<ListSiteContactMessagesResult>;

export type MarkSiteContactMessageReadResult =
  | { kind: "ok" } | { kind: "forbidden" } | { kind: "not_found" };
export async function markSiteContactMessageRead(
  actingPersonId: string, organizationId: string, messageId: string,
): Promise<MarkSiteContactMessageReadResult>;
```

`listSiteContactMessages`/`markSiteContactMessageRead` import and reuse
`hasTicketsFile` from `@/lib/tickets` — exactly the documented reason that
function is exported (`tickets.ts`'s own header: "the two attachment route
handlers need the same gate without going through one of this module's own
exported functions... re-deriving the `presby_has_permission` call in a
second file would be exactly the kind of hand-copied check `directory.ts`'s
own header warns eventually drifts"). This module is the third consumer of
that exact precedent.

### Server actions — call sites

- `src/app/(admin)/admin/organizations/[id]/actions.ts` (**extended**):
  `provisionSiteAction(formData)`, `setSiteStatusAction(formData)` — both
  return the file's own existing `PolicyResult` type (not `ActionResult`,
  for consistency within this file), `auth()` + `hasFeature(...,
  FEATURES.ADMIN_ORGANIZATIONS)` first, thin wrappers over `sites.ts`'s
  `provisionSite`/`setSiteStatus`, `recordAudit(SITE_PROVISIONED /
  SITE_STATUS_CHANGED)`, `revalidatePath`.
- `src/app/(org)/o/[slug]/tickets/actions.ts` (**extended**):
  `markSiteContactMessageReadAction(slug, messageId): Promise<ActionResult>`
  — same `resolveActingIdentity(slug)` helper this file already has, thin
  wrapper over `markSiteContactMessageRead`, `// audit-exempt: routine
  triage, matches dismissFeedbackAction's identical posture` (no new
  `AUDIT_ACTIONS` key — reading your own inbox is not security-sensitive).
- `src/app/(public)/site/[slug]/actions.ts` (**new**):
  `submitContactMessageAction(slug, formData): Promise<ActionResult>` — the
  one anonymous write action in the tree. Honeypot check first (a hidden
  `_hp` field; non-empty → fake `{ ok: true }`, no DB write, no rate-limit
  consumption), then `checkRateLimit(`site_contact:${slug}:${ip}`, { max: 5,
  windowSeconds: 3600 }, ...)` (mirrors `(password-reset)/actions.ts`'s
  IP-keyed precedent exactly, scoped per-site so one bad IP can't exhaust
  every congregation's shared budget at once), then
  `submitSiteContactMessage()`. **No audit event** — an anonymous low-stakes
  content submission is not a security-sensitive mutation, matching
  `replyToTicket`'s own "a reply is conversation, not a security-sensitive
  mutation" precedent.

## Data Model

### `organization_sites`

Per DECISION-081, with two additions beyond that decision's column list —
`created_at` (provisioning timestamp, drives `/admin/sites`' "provisioned
since" column) and `updated_at` (pairs with the already-decided
`updated_by`, matching `organization_brands`' own `updated_at`/`updated_by`
pairing — DECISION-081 named `updated_by` but not its timestamp companion,
an omission this design fills in rather than leaves silently absent).

```
organization_id       uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE  -- degenerate PK, one row per org
repo                  text NOT NULL UNIQUE  -- "org/site-<slug>"
status                text NOT NULL DEFAULT 'provisioning'  -- provisioning | live | suspended
last_ingested_commit_sha  text
last_ingested_at      timestamptz
content_bundle_key    uuid  -- composite-FK-by-convention -> blob_assets(id, organization_id);
                             -- NOT expressible as a Drizzle foreignKey() in src/lib/db/domain/sites.ts
                             -- for the identical reason organization_brands.mark_asset_key isn't
                             -- (assets.ts <-> org.ts/sites.ts import cycle, see assets.ts's own
                             -- comment) — enforced in the migration only.
updated_by             uuid REFERENCES users(id)  -- NULLABLE, unlike organization_brands.updated_by:
                                                    -- machine ingest writes (recordSiteIngest) have
                                                    -- no users.id to attribute; NULL there, set on
                                                    -- admin-initiated provision/status-change writes.
created_at             timestamptz NOT NULL DEFAULT now()
updated_at             timestamptz NOT NULL DEFAULT now()
```

### `site_contact_messages`

Genuine composite-key tenant table (DECISION-081), shaped like
`congregation_feedback`/`ticket_messages`.

```
id               uuid PRIMARY KEY DEFAULT gen_random_uuid()
organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
name             text NOT NULL   -- visitor-supplied
email            text NOT NULL   -- visitor-supplied, for a role-holder to reply out-of-band
body             text NOT NULL
status           text NOT NULL DEFAULT 'new'  -- new | read
created_at       timestamptz NOT NULL DEFAULT now()
```

`unique(id, organization_id)` declared even though nothing composite-FKs into
this table today — the Composite Tenant Keys invariant applies uniformly, and
`organization_brand_history`'s own precedent ("kept for consistency even
though nothing composite-FKs into this table today") is the exact shape to
follow.

### `blob_assets` — widened again (DECISION-088)

`ALLOWED_CONTENT_TYPES` / the DB CHECK gain `application/json` — the
normalized site bundle (front-matter + MDX AST + resolved image keys) is
structured JSON, not one of the four existing types (PNG/JPEG/WEBP/PDF). Same
union-of-consumer-needs reasoning as DECISION-073: the shared outer bound
widens; the ingest route's own bundle-shape validation (422 on a malformed
body) is the real per-feature gate, exactly as the ticket-attachment sniff is
for that consumer. The existing 10MB cap is unchanged and is generous for
text-shaped content (front-matter + MDX AST + an image-key map, images
themselves already stored as separate rows).

### `presby_published_site(p_slug text)` — the narrow SECURITY DEFINER reader

Mirrors `presby_membership_is_active`'s shape exactly (`security definer`,
`set search_path = public`, `revoke all from public`, `grant execute to
presby_app` — the anonymous page reads through the plain `db` connection,
which authenticates as `presby_app`, with **no** org GUC set, exactly the
F26 shape that pattern already solves). Collapses "never provisioned",
"suspended", "nonexistent slug", and "org not active" into the same zero-row
result — the caller (`getPublishedSite()`) cannot tell them apart, which is
the enumeration-safety property Phase 1 Gap 5 requires.

```sql
create or replace function presby_published_site(p_slug text)
returns table (
  organization_id           uuid,
  organization_name         text,
  organization_type         text,
  content_bundle_key        uuid,
  brand_seed_hex             text,
  brand_type_pairing         text,
  brand_token_version        integer
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.organization_type::text,
         s.content_bundle_key,
         b.seed_hex, b.type_pairing, b.brand_token_version
    from organizations o
    join organization_sites s on s.organization_id = o.id
    left join organization_brands b on b.organization_id = o.id
   where o.slug = p_slug
     and o.status = 'active'
     and s.status = 'live';
$$;

revoke all on function presby_published_site(text) from public;
grant execute on function presby_published_site(text) to presby_app;
```

`getPublishedSite()` calls this via `db.execute(sql\`select * from
presby_published_site(${slug})\`)`, checks `sites.public_render` and
`ui.brand_theming` (the latter only gates the `brand` field, not the whole
row), then — if a row came back — resolves `content_bundle_key` through
`getBlobStore().resolve()`, `JSON.parse()`s it, and returns the typed
`pages[]`. A JSON parse failure or a resolve-to-null (dangling key) both
degrade to `{ kind: "not_found" }`, never a 500 — a corrupted bundle should
read as "nothing here," not crash a public page.

### RLS / grants — `organization_sites`

FORCE RLS, standard `tenant_isolation` policy (mirrors
`0016`/`0019`'s loop exactly). **`presby_platform`: full
select/insert/update/delete** (both provisioning and ingest are
`getPlatformDb()` callers). **`presby_app`: no direct table grant.** The only
`presby_app` access to this table is through `presby_published_site()`'s
`EXECUTE` grant — there is no tenant-facing read of `organization_sites`
itself in this pipeline (no "P4 the church's site editor," confirmed dead),
so a forward-looking `SELECT` grant (the pattern `organization_brands` used,
anticipating slice d) is deliberately **not** added here; nothing in this
pipeline anticipates a near-term tenant-facing consumer the way brand's did.

### RLS / grants — `site_contact_messages`

FORCE RLS, standard `tenant_isolation` policy. **`presby_app`: select,
insert, update** — insert is the anonymous trusted-org-context write;
select/update back the `/o/<slug>/tickets` review section
(`withOrgContext()`, a real member). **`presby_platform`: no grant** —
unlike `tickets`/`congregation_feedback`, there is no platform-side triage
surface for contact messages in this design (Phase 3's own call, DECISION-089
below); granting `presby_platform` access it has no consumer for would be
exactly the kind of unused-privilege surface "No Role Carries a Wildcard"
warns against, applied at the grant layer rather than the permission layer.

### `src/lib/db/domain/assets.ts` — drift fix (Phase 2 Note 7) + widening

The Drizzle `check()` calls still declare the pre-`0019` values (PNG/JPEG/
WEBP, 2MB) even though `0019` already widened the live DB constraint to admit
PDF at 10MB. Fixed in the same commit as this pipeline's own widening, so the
file ends up correct in one pass rather than two:

```ts
check(
  "blob_assets_content_type_allowed",
  sql`${t.contentType} in ('image/png','image/jpeg','image/webp','application/pdf','application/json')`,
),
check(
  "blob_assets_byte_size_bounds",
  sql`${t.byteSize} > 0 and ${t.byteSize} <= 10485760`,
),
```

### `drizzle/0020_presby_public_sites.sql` — full migration

Hand-written, idempotent (`do $$ ... if not exists ...`), mirroring `0016`'s
degenerate-PK pattern for `organization_sites` and `0019`'s composite-FK
pattern for `site_contact_messages`, in this order:

1. `organization_sites` table + CHECK (`status in
   ('provisioning','live','suspended')`) + `unique(repo)`.
2. `site_contact_messages` table + CHECK (`status in ('new','read')`) +
   `unique(id, organization_id)`.
3. Composite FK: `organization_sites.content_bundle_key` →
   `blob_assets(id, organization_id)` (nullable column, `MATCH SIMPLE`
   leaves it unenforced until a key is set — identical shape to
   `organization_brands_mark_asset_fk`).
4. `presby_published_site(text)` function, `revoke`/`grant` as above.
5. FORCE RLS + `tenant_isolation` policy loop over
   `['organization_sites', 'site_contact_messages']` (mirrors `0016`/`0019`'s
   `do $$ declare t text; ... array[...] loop ... end loop; end $$;` block
   verbatim).
6. Grants section, exactly as specified above (asymmetric — `organization_sites`
   is `presby_platform`-only at the table level; `site_contact_messages` is
   `presby_app`-only; neither gets both).
7. `blob_assets` CHECK widening (`drop constraint if exists` / `add
   constraint`, same idempotent-by-construction shape `0019`'s own section 8
   already uses) — adds `application/json`.
8. `comment on table` / `comment on function` for both new tables and the
   new function, matching every prior migration's documentation discipline.

## Component / Page Plan

**Pages to create:**
- `src/app/(public)/site/[slug]/layout.tsx` — the second (currently dormant)
  `<BrandTokens>` emitter. Calls `getPublishedSite(slug)` (or a cheaper
  brand-only variant if this doubles the page's own call — accepted
  redundancy for v1, `cache()`-wrapped like `getOrgBrandForLayout`, so a
  second call in the same render pass costs nothing further), passes
  `site?.brand?.tokens ?? null`. No `<html>`/`<body>` — nests under the root
  layout exactly as `(org)/o/[slug]/layout.tsx` does. **No `loading.tsx`** on
  this segment or `page.tsx` (both can 404) — the CLAUDE.md rule against
  opening a Suspense boundary on a segment whose job may be to 404 applies
  here as directly as it does to `/o/<slug>`.
- `src/app/(public)/site/[slug]/page.tsx` — calls `getPublishedSite(slug)`;
  `not_found` → `notFound()` (Next's real 404, HTTP 404, uniform for every
  miss case per Phase 1 Gap 5). On `ok`, finds the page whose `path` matches
  the current sub-route (v1 ships a single top-level page per slug —
  sub-routing to `/site/<slug>/about` etc. is `[...path]` catch-all, out of
  scope for this pipeline's first slice per the task's own scoping; noted in
  Out of Scope) and calls `renderSiteBundle()` from `presby-site-kit`.
- `src/app/(public)/site/[slug]/assets/[key]/route.ts` — content-image
  serving. `resolvePublishedOrganization(slug)` (404 if none/off-flag),
  `getBlobStore().resolve({ organizationId, key })` (404 if null), returns
  bytes with `Content-Type` and `Cache-Control: public, max-age=31536000,
  immutable` (content-addressed, mirrors DECISION-049's logo-asset
  reasoning). No session read — purely public, content-addressed serving.
- `src/app/(admin)/admin/sites/page.tsx` — cross-org list, mirrors
  `admin/feedback/page.tsx`'s shape exactly: `auth()` +
  `hasFeature(FEATURES.ADMIN_ORGANIZATIONS)`, `listSitesForAdmin()`, a
  `<Table>` (org name, slug, repo, status badge, last ingested, provisioned
  since), empty state matching `admin/feedback`'s dashed-border pattern.

**Components to create:**
- `src/app/(admin)/admin/organizations/[id]/site-section.tsx` (or inline in
  `page.tsx`, implementer's call) — a third section on the existing brand
  detail page: "Site" heading, current `SiteAdminDetail` (repo, status,
  last ingested), a provision form (repo input) when unprovisioned, a
  suspend/reactivate control when provisioned — same section-on-one-page
  shape as brand's own "Current brand" / "Set brand" sections.
- `src/app/(public)/site/[slug]/contact-form.tsx` — `"use client"`, the one
  client island Phase 2 named. Name/email/body fields, a hidden honeypot
  input, calls `submitContactMessageAction` via a form action, toast on
  result (root `<Toaster>` already mounted).
- `src/app/(org)/o/[slug]/tickets/site-messages-list.tsx` — the third
  section on the existing tickets page: list of `new` `SiteContactMessageEntry`
  rows, a "mark read" control per row (mirrors `FeedbackReviewList`'s shape).

**Files to modify:**
- `src/proxy.ts` — DECISION-085's bypass (below).
- `src/lib/db/domain/assets.ts` — CHECK drift fix + widening.
- `src/lib/audit.ts` — four new `AUDIT_ACTIONS` keys (below).
- `src/app/(admin)/admin/organizations/[id]/actions.ts` — two new actions,
  plus a small addition to the **existing**
  `setOrganizationBrandAction`/`neutralizeOrganizationBrandAction`: after
  either transaction commits, if this org has `organization_sites.status =
  'live'`, also `revalidatePath(`/site/${slug}`, "layout")` — otherwise a
  live public site's colors go stale until the next ingest, since brand
  changes and site ingest are two independent write paths today that would
  otherwise never tell each other's cache to invalidate. Small, but real —
  named explicitly rather than left as a silent staleness bug.
- `src/app/(admin)/admin/organizations/[id]/page.tsx` — renders the new
  section.
- `src/app/(org)/o/[slug]/tickets/actions.ts`,
  `src/app/(org)/o/[slug]/tickets/page.tsx` — the new action and section.
- `scripts/seed.ts` — `sites.public_render` flag row, seeded `false`.
- `scripts/check-brand-scope.mjs` — flip `EMITTERS[1]`'s (`(public)/site/[slug]/layout.tsx`)
  `required: false → true`. Mechanically: this is what turns E2 live for
  that path — once the file exists AND is listed `required: true`, the
  tripwire fails any future edit that deletes `<BrandTokens>` from it,
  exactly as it already does for `(org)`. A one-line edit, not a new rule.
- `package.json` / `package-lock.json` — `presby-site-kit` git dependency
  (DECISION-082/086).

## `presby-site-kit` consumability & Phase 4 sequencing (DECISION-086)

**Compiled output checked into the tag, not a build step `presby`'s install
must run.** A git dependency's default `npm install` behavior runs a
`prepare` script if one exists — if `site-kit` relied on that to compile
itself, `presby`'s own `npm install` would invoke `site-kit`'s toolchain
(whatever TypeScript/bundler version `site-kit` pins) inside `presby`'s CI
environment, a second, uncontrolled toolchain dependency `presby`'s own
`npm run check`/build never asked for. Instead, `site-kit`'s own release
process (its CI, not `presby`'s) compiles and commits `dist/` before cutting
a tag — the same shape as consuming any pre-built npm-registry package,
applied to a pinned git tag instead of a registry version.

**Sequencing: `presby-site-kit` must exist as a real repo — even a stub —
before Phase 4's render-path commit, but its real component library does
not.** `presby`'s only integration point is one named import:

```ts
import { renderSiteBundle } from "presby-site-kit";

function renderSiteBundle(input: {
  pages: PublishedSiteBundlePage[];
  currentPath: string;
  brand: { tokens: BrandTokenSet; fontPairing: ResolvedTypePairing } | null;
  imageUrl: (manifestKey: string) => string; // presby hands site-kit a URL
                                              // builder (-> the content-
                                              // addressed asset route above),
                                              // never raw bytes or a data: URI
                                              // — site-kit never touches the
                                              // blob adapter directly.
}): React.ReactElement | null; // null -> presby's page.tsx calls notFound()
```

Faking this import inside `presby`'s own tree (a local module shadowing the
package name) is exactly the "shadowing a real package name is a resolution
trap" DECISION-048 already rejected for the `radix-ui` alias case. Instead:
create the real `presby-site-kit` repo now, with a minimal `renderSiteBundle`
stub (renders prose + a "content coming soon" placeholder, ignoring
`mdxAst`/component allowlisting entirely), tag it `v0.0.1-stub`, and point
`presby`'s `package.json` at that tag. Phase 4's ux-developer commit is real
and testable against it. A **later, out-of-scope pipeline** builds `site-kit`'s
actual MDX component library (`Hero`, `ServiceTimes`, `StaffList`, etc., per
Phase 1 Gap 2's allowlist) and cuts `v1.0.0`; `presby` bumps the pinned tag in
a small, isolated commit — no change to `presby`'s own `page.tsx`. Creating
the stub repo is scoped into ux-developer's Phase 4 commit below, since that
implementer is the one whose work is otherwise blocked on the import
resolving.

## `src/proxy.ts` fix — exact diff (DECISION-085)

Lands in the **same commit** as the public route tree
(`(public)/site/[slug]/{page,layout,assets/[key]/route}.tsx`) per Phase 2
Note 3 — assigned to **ux-developer**, not database-admin, despite the
task-level suggestion naming database-admin for it: Phase 2's binding
instruction ("recommend it land in the same commit that creates
`(public)/site/[slug]/`, so the route is never live-but-broken") controls,
and that route tree is ux-developer's own artifact. A tiny, isolated diff
within that commit, not a separate one:

```diff
   if (pathname.startsWith("/api/")) return NextResponse.next();
   if (pathname.startsWith("/account/verify-email/")) return NextResponse.next();
+  if (pathname === "/site" || pathname.startsWith("/site/")) return NextResponse.next();
   if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
```

Placed immediately after the existing `/account/verify-email/` prefix-bypass
line, before the `PUBLIC_PATHS` exact-match check — matching that line's own
shape (`startsWith`, not a `Set` entry, because the slug varies). No other
line in `proxy.ts` changes: `/site/*` never reaches `edgeAuth()`, the 2FA
gate, or `PROTECTION_RULES` — it is fully anonymous by construction, matching
DECISION-041's contract.

## Implementation Order

**Commit 1 — database-admin (schema):**
1. `src/lib/db/domain/sites.ts` — `organizationSites`, `siteContactMessages`
   Drizzle table definitions (mirroring `org.ts`'s `organizationBrands`/
   `support.ts`'s `tickets` shape).
2. `drizzle/0020_presby_public_sites.sql` — full migration as specified
   above, applied via `npm run db:push` on a Neon branch, then committed for
   `npm run db:migrate` in staging/prod.
3. `src/lib/db/domain/assets.ts` — drift fix + `application/json` widening,
   in the same commit since it's touching the same migration file's
   `blob_assets` section anyway.
4. `scripts/seed.ts` — `sites.public_render` flag row (`enabled: false`).

**Commit 2 — api-developer (server):**
1. `src/lib/sites.ts` — every function in the API Contract above.
2. `src/lib/sites-ingest-auth.ts` — OIDC verification (DECISION-087).
3. `src/app/api/sites/ingest/route.ts`.
4. `src/lib/audit.ts` — `SITE_CONTENT_INGESTED`, `SITE_PROVISIONED`,
   `SITE_STATUS_CHANGED` (three; a fourth, `SITE_CONTACT_MESSAGE_RECEIVED`,
   was considered and rejected — see Server actions' "no audit event"
   reasoning above).
5. `src/app/(admin)/admin/organizations/[id]/actions.ts` — `provisionSiteAction`,
   `setSiteStatusAction`, plus the brand-action `revalidatePath` addition.
6. `src/app/(org)/o/[slug]/tickets/actions.ts` — `markSiteContactMessageReadAction`.
7. `src/app/(public)/site/[slug]/actions.ts` — `submitContactMessageAction`.
8. New env vars documented: `SITES_INGEST_OIDC_AUDIENCE`, `GITHUB_SITES_ORG`.

**Commit 3 — ux-developer (client/render + the proxy fix):**
1. `src/proxy.ts` — DECISION-085's bypass, exact diff above.
2. `src/app/(public)/site/[slug]/layout.tsx`, `page.tsx`,
   `assets/[key]/route.ts`.
3. `src/app/(public)/site/[slug]/contact-form.tsx`.
4. `src/app/(admin)/admin/organizations/[id]/page.tsx` +
   `site-section.tsx`.
5. `src/app/(admin)/admin/sites/page.tsx`.
6. `src/app/(org)/o/[slug]/tickets/page.tsx` +
   `site-messages-list.tsx`.
7. `scripts/check-brand-scope.mjs` — flip `EMITTERS[1].required` to `true`.
8. Create the `presby-site-kit` repo (stub `renderSiteBundle`, `v0.0.1-stub`
   tag), wire `package.json`/`package-lock.json`.
9. Release notes entry (`docs/release-notes/`) and
   `docs/product/functionality-map.md` update, at ship time per Rule 14.

## Edge Cases & Risks

- **Corrupt or dangling `content_bundle_key`.** `getPublishedSite()` treats a
  failed blob resolve or a JSON parse failure identically to "not found" —
  never a 500. Covered above; called out again because it's the one place a
  malformed ingest could otherwise take down a live page.
- **Brand/site cache divergence.** Named above (`setOrganizationBrandAction`'s
  new `revalidatePath` addition) — without it, a brand change doesn't reach
  an already-live public site until the next content ingest.
- **TOCTOU on `ContactForm`'s status check.** `submitSiteContactMessage()`
  reads `status = 'live'` via `presby_published_site()` outside the write
  transaction; a site suspended in the seconds between page load and form
  submit could still accept one message. Accepted: the visitor only reached
  the form because the page itself was live moments earlier, `organization_id`
  is server-resolved from a public slug (never client-supplied), and the
  worst case is one message an operator can ignore — not a security bypass.
- **Vercel request-body size limits on ingest.** A large image set,
  base64-inflated (~33%) inside one JSON POST, could approach a serverless
  function's payload ceiling before it approaches the blob adapter's own
  10MB-per-blob cap. Not solved here — flagged for `deployment-engineer`'s
  pre-deploy check once real `site-kit` content exists; the per-image and
  per-bundle CHECK constraints are the correctness bound, not the transport
  bound.
- **`site-kit` component env vars.** Once `site-kit`'s real component
  library lands (a later pipeline), any component needing a third-party key
  (e.g. a maps provider for `AddressMap`) becomes a `presby` deploy-time env
  var, because `renderSiteBundle()` executes inside `presby`'s own server
  process. Not applicable to the `v0.0.1-stub` tag; named so it isn't
  rediscovered as a surprise later.
- **`organization_sites.repo` uniqueness vs. re-provisioning.** The `unique
  (repo)` constraint means a repo can never be attached to a second org even
  after being detached from the first — there is no "detach" operation in
  this design (only `suspended`, which keeps the row). Accepted for v1: a
  repo is provisioned once per its congregation's lifetime; a genuine
  transfer (merger, re-parenting) is out of scope, same posture as
  `organizations.slug`'s own immutability.
- **`resolveOrganizationByRepo` and case/format drift in `repository`
  claims.** GitHub's `repository` claim is always `owner/repo`, exact case as
  configured on GitHub — `organization_sites.repo` must be provisioned with
  the identical string (an admin-entry typo would 404 every ingest for that
  org until corrected). `provisionSiteAction` should validate the format
  (`^[\w.-]+/[\w.-]+$`) but cannot verify the repo actually exists without a
  GitHub API call this pipeline doesn't make — named as a real, minor
  provisioning-UX gap, not solved here.

**E2E blast radius — existing specs this change alters or could break, not
just new coverage this change needs:**
- `e2e/admin-organizations.spec.ts` — this pipeline adds a third section to
  the exact page this spec exercises (`/admin/organizations/[id]`). If this
  spec asserts on the page's full DOM structure or section count, the new
  "Site" section can break it even though nothing about brand behavior
  changed. Must be read and, if needed, extended — not just re-run.
- `e2e/post-login-routing.spec.ts` — exercises `src/proxy.ts`'s control flow
  most directly of any existing spec. The new `/site/*` bypass is an early
  return added before every existing rule; low risk by construction (it
  can't affect any path that doesn't start with `/site/`), but this is
  exactly the kind of proxy change the retro (2026-07-11) flagged as the
  shape of loop-back that isn't anticipated until it's run.
- `e2e/security-headers.spec.ts` — asserts on response headers across route
  classes; a new anonymous, unauthenticated route family is worth confirming
  still gets the platform's baseline headers (CSP report-only, etc.) even
  though `NextResponse.next()` should carry them through unchanged.
- `e2e/visual-parity.spec.ts` / `e2e/color-scheme.spec.ts` — brand-token
  screenshot/emission coverage. Neither currently visits `/site/<slug>`, but
  both encode assumptions about "the brand-scope tripwire has exactly one
  live emitter" that become false the moment `EMITTERS[1].required` flips to
  `true` — worth a read even if no assertion changes, since the fixture data
  these specs depend on doesn't yet include a `live` `organization_sites`
  row for any e2e org.

## Out of Scope (confirmed, carried from Phase 1/2 and narrowed further here)

No in-browser site editor, in any form (confirmed dead). No autonomous
AI-worker write path. Multi-page sub-routing beyond one top-level page per
slug (`/site/<slug>/about` etc.) — v1 ships a single page per site; a
`[...path]` catch-all is a natural, small follow-on once real multi-page
content exists, not built here. `presby-site-kit`'s real component library
and CI workflow content (front-matter schema, component allowlist
enforcement, image constraints) — that repo's own future pipeline. A GitHub
API call to verify a provisioned `repo` actually exists. CI-failure-to-ticket
echo (Phase 1 Gap 4) and a staged-preview-before-live step (Phase 1 Open
Question 2) — both real, both explicitly deferred by the user's own
resolution of Phase 1's open questions, not re-opened here. A platform-side
triage surface for `site_contact_messages` (DECISION-089 keeps this
tenant-only). Public logo/mark image serving on the site masthead — v1
carries brand *colors and fonts* only, per Note 4; a public-facing logo route
is a natural follow-on this design deliberately doesn't build, to avoid
inventing a second asset-serving route class in an already-large pipeline.

## Implementer

**Split, three commits, three implementers** — database-admin (schema) →
api-developer (server: query layer, ingest, actions, audit) → ux-developer
(client: render path, the `proxy.ts` fix, provisioning UI, the `site-kit`
stub repo). See Implementation Order above for the exact per-commit file
list; each commit is independently buildable and typecheckable in sequence.

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
