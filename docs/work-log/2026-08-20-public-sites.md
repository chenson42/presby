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
| 1 — Functional refinement | analyst | In progress | — | — |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

[READY FOR DESIGN | READY WITH NOTES | NEEDS REWORK | NOT YET]

## ONE-LINE TAKE

> [The feature in one honest sentence.]

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| [admin / member / anonymous] | [verb] | [on demand / per session / one-time] |

## Flows

**Flow 1 — [name]:** [entry → step → step → outcome]
- Failure: [what the user sees if a step goes wrong]

**Flow 2 — [name]:** [...]

## Permissions & Flags

- **Permission(s):** [new `FEATURES.KEY`, or existing key reused]
- **Default roles:** [list]
- **Flag(s):** [new key + rollout plan, or "not needed"]

## Gaps the Request Didn't Address

- [Gap, why it matters, suggested resolution]

## Out of Scope (confirm with user)

- [Thing the request implies but isn't in scope]

## Open Questions

- [Question for the user]

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
