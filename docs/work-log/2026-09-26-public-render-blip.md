# The public congregation-site render path 500s on a database blip — three uncaught reads behind the fail-closed flag read — Work Log

> **Slug:** `2026-09-26-public-render-blip`
> **Surface:** `(public)/site/[slug]` (the anonymous public-site render path): `src/lib/sites.ts`, `src/lib/authz.ts` (`publicOrgSummary`), `src/app/(public)/site/[slug]/[[...path]]/page.tsx`
> **Permission(s):** none (public by design)
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-26, wave 4):** worktree `../presby-wt-render` on git branch `pipeline/render-path`; no Neon branch — no schema change; `.env.local` is a copy of `development`, used read-only; a live probe with an unreachable `DATABASE_URL` is the reproduction. **Pre-assigned numbers:** no migration; `DECISION-154` if a decision results. **Shared-file discipline:** `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts` and `drizzle/meta/_journal.json` are edited on this branch only as a clearly delimited block appended at the END of the file (one new section, one new export line, one new journal entry); `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*`, `docs/schema-design-2.md` and `CLAUDE.md` are NOT edited on this branch — each phase returns its proposed lines in its section and the orchestrator applies them at integration (one PR at a time; `test-rls.sql` re-run on `development` after each merge). **The from-scratch rule (DECISION-150):** any schema change must survive `npm run check:schema-parity` on a fresh database and the `docs/testing.md` from-empty recipe; the CI `db-tests` job skips until the operator adds the Neon secrets, so the implementer rehearses it locally. Every new SECURITY DEFINER function pins `search_path = public, pg_temp` (DECISION-148). Dev-server port `3400`; stop by PID; never `pkill -f`.
> **The bug (`docs/work-log/2026-09-26-flags-fail-closed.md` Phase 5 Finding 1 + Phase 6):** `getPublishedSite()`'s own docstring promised every non-`ok` outcome — including a DB blip — collapses to `{ kind: "not_found" }`, "never a 500." Only the flag read does. QA probed a live server with an unreachable `DATABASE_URL`: `/site/<slug>/sitemap.xml` now 404s (the flag read fails closed), but `/site/<slug>` still **500s** through three uncaught reads: `src/lib/sites.ts:356` (`db.execute` of `presby_published_site(…)`), `:362` (the blob resolve), and `src/lib/authz.ts:521` (`publicOrgSummary`, a bare `db.select` called ONLY from the `not_found` branch at `page.tsx:224` — the very branch the fail-closed flag read routes a blip into, so the flags fix created a path into a third unguarded read).
> **The fix:** wrap all three in the same fail-closed-to-`not_found` discipline, with the enumeration-safety constraint intact (DECISION-040/047: the 404 for "not a tenant", "not published", and "DB down" must be byte-identical and timing-indistinguishable — a DB blip must not become a new oracle); one `console.error` per failure naming the kind of failure and never the query text; restore `getPublishedSite()`'s docstring to its full claim once it is true; a regression test per read (mock each to throw → `not_found`, no throw) and a live-server probe with an unreachable DB as the acceptance criterion (`/site/<slug>` → 404 with the generic page). Consider whether `publicOrgSummary`'s `not_found`-branch call should be skipped entirely when the failure kind is a DB error (there is nothing to summarise), and say so.
> **Out of scope:** the `isLocalLoginEnabled()` log line and the `[local-login]` `err.message` guard (separate small items); the `org_features.category_axis` direction (next security review).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — bug confirmed live (even a nonexistent slug 500s during an outage); six uncaught reads, not three; the SQL and params print to the server log | READY WITH NOTES | 2026-09-26 |
| 2 — Architectural review | architect | Skipped by notation — bug-fix variant, no structural change | — | 2026-09-26 |
| 3 — Technical design | tech-lead | Complete — six-read wrap, `GetPublishedSiteResult.reason` shape ruled, log-line discipline specified, timeout deferred with reasoning | — | 2026-09-26 |
| 4 — Implementation | api-developer | Complete — all six reads wrapped, `reason` shape shipped, live-probe acceptance run, one named gap (sites.test.ts DB-backed cases untested by me — no Neon branch this pipeline) | — | 2026-09-26 |
| 5 — Verification | qa | Complete — failing-first reproduced independently for all five spec files; `sites.test.ts` gap closed (80/80 live); full DB suite 4168/4168 zero skips; production-build probe re-run: four uniform 404s, byte-identical bodies, leak-free log | PASS | 2026-09-26 |
| 6 — Shipped vs intent | analyst | Complete — shipped as v0.26.3; two follow-ups in TODO | SHIP WITH NOTES | 2026-09-26 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-09-26.*

**Work-log:** `docs/work-log/2026-09-26-public-render-blip.md` · **Worktree:** `/Users/cshenso/git/presby-platform/presby-wt-render` (branch `pipeline/render-path`) · **Pipeline mode:** Bug-fix variant (brief)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> The bug is real, confirmed live, and worse than the kickoff described: today *any* database blip 500s **every** `/site/<slug>` request — including a nonexistent slug — because the crash isn't in the "does this site exist" read, it's in the follow-up read the `not_found` branch always makes; and there are at least two more uncaught reads sharing the identical shape that the kickoff's "three reads" framing didn't name.

## Confirmation (live probe, dev server on :3400, `.env.local` copy pointed at an unreachable host, restored after)

Seeded live site used: `fpcw` (`organization_sites.status = 'live'`, `content_bundle_key` set); flags `sites.public_render`/`sites.public_staff_directory`/`sites.public_committee_directory` all `true` on the dev branch.

| Request | Code | Time | Notes |
|---|---|---|---|
| `GET /site/fpcw` | **500** | 2.87s | flag read fails closed correctly (`[flags] isFlagEnabled read failed; treating as disabled`), then `publicOrgSummary` (`authz.ts:521`) throws uncaught |
| `GET /site/fpcw/sitemap.xml` | 404 | 0.83s | fails closed correctly — flag-only path, no follow-up read |
| `GET /site/fpcw/assets/whatever` | 404 | 0.55s | fails closed correctly — `resolvePublishedOrganization` returns `null` because its **own flag check** fails closed before its own uncaught `db.execute` is ever reached in this all-DB-down scenario (see Gap 1 below for the case this masks) |
| `GET /site/not-a-slug` | **500** | 0.04s | same crash as `fpcw` — a slug that doesn't exist gets an identical 500, not a 404 |

Server log confirms the crash site exactly as named in the kickoff (`src/lib/authz.ts:521`, called from `page.tsx:224`) and also confirms a secrets/log concern:

```
⨯ Error: Failed query: select "name", "organization_type" from "organizations" where "organizations"."slug" = $1 limit $2
params: fpcw,1
    at async publicOrgSummary (src/lib/authz.ts:521:17)
    at async PublicSitePage (src/app/(public)/site/[slug]/[[...path]]/page.tsx:224:21)
```

The full SQL text and bound params print to the server console on every failure — exactly the pattern `isFlagEnabled`'s own doc comment (`src/lib/flags.ts:26-31`) warns against ("Never log the error object itself: Neon/Drizzle's message embeds the failed SQL text… the flag key is the only safe thing to emit here"). This is currently Next's own default uncaught-exception logger doing the printing, not application code — which matters for the fix (see Gaps).

A second, distinct crash also fired on every 500: `Error: Only plain objects… can be passed to Client Components from Server Components` — Next failing to serialize the raw driver error (a `WebSocket`/`ErrorEvent` instance) across the RSC boundary while rendering its own dev-mode error overlay. This is a symptom of letting the raw error escape uncaught, not a separate root cause, but confirm it disappears once the reads are wrapped, and note this probe ran under `next dev` (Turbopack) — the production error page a real visitor sees is not the same artifact as the dev overlay this log captured; the acceptance run belongs on `next build && next start` too, not only `next dev`.

The 2.87s-vs-0.04s gap tracks *cold vs. warm connection-failure state* across requests during one outage, not slug identity (both `fpcw` and `not-a-slug` hit the identical code path and both eventually 500) — so it isn't a per-tenant timing oracle by itself, but it does mean the very first visitor after an outage begins waits ~3s for what should be an instant, generic 404. Recommend a short, explicit, uniform timeout across all fixed reads rather than relying on the driver's default TCP/TLS negotiation timeout.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Anonymous visitor | Browses `/site/<slug>` (a congregation's public page) | on demand |
| Anonymous visitor / search crawler | Requests `/site/<slug>/sitemap.xml` | per crawl |
| Anonymous visitor (indirect, via `<img>`/logo tags the page emits) | Requests `/site/<slug>/assets/<key>` | per page load |

No new verb — this is a bug fix to an existing anonymous surface. No permission or role distinction applies; the surface is deliberately identity-blind by construction (`layout.tsx`'s own header: "FULLY ANONYMOUS BY CONSTRUCTION").

## Flows

**Flow 1 — Public site render (`page.tsx`):** entry `GET /site/<slug>[/…path]` → `getPublishedSite(slug)` → if `ok`, render the bundle; if `not_found`, a second read (`publicOrgSummary`) decides between a presbytery/synod fallback page and a hard 404.
- Intended failure (per `getPublishedSite`'s own docstring): every non-live reason — never provisioned, suspended, nonexistent slug, org inactive, flag off, **DB down** — collapses to the same generic 404.
- Actual failure today: the first four collapse correctly; DB-down does not — it 500s, and it does so *via the second read*, so it 500s even when the *first* read (the actual "does this site exist" question) degraded correctly closed.

**Flow 2 — Sitemap (`sitemap.xml/route.ts`):** entry `GET /site/<slug>/sitemap.xml` → `getPublishedSite(slug)` → `ok` renders XML, `not_found` returns a bare 404 response (no second read).
- Failure: correctly 404s on DB-down today, because this route has no `publicOrgSummary`-style follow-up call. Confirmed live.

**Flow 3 — Asset serving (`assets/[key]/route.ts`):** entry `GET /site/<slug>/assets/<key>` → `resolvePublishedOrganization(slug)` → if found, `getBlobStore().resolve(...)` → bytes or 404.
- Failure: this probe's total-DB-outage scenario happened to 404 correctly, but only because `resolvePublishedOrganization`'s own internal flag check failed closed *before* its own uncaught `db.execute` on line 446 was reached. A **partial** blip — flags table reachable, `organizations`/`presby_published_site()` or `blob_assets` specifically not — is not exercised by this probe and is not covered by any existing wrap. See Gap 1/2.

## Permissions & Flags

- **Permission(s):** none — this surface is intentionally identity-blind.
- **Flag(s):** existing `sites.public_render` (already fail-closed via `isFlagEnabled`), `sites.public_staff_directory`/`sites.public_committee_directory` (already fail-closed, confirmed by reading — see below). No new flag needed; this is a robustness fix to already-flagged behavior, not new functionality.

## Gaps the Request Didn't Address

1. **A fourth uncaught read, not named in the kickoff's "three reads": `resolvePublishedOrganization()`'s own `db.execute` (`src/lib/sites.ts:446`).** This is a *separate function* from `getPublishedSite()` running the identical `presby_published_site()` query, used at minimum by `assets/[key]/route.ts`. If the fix wraps `getPublishedSite()` alone, this sibling keeps throwing on a DB blip that reaches past its own flag check (e.g., flags table fine, `organizations` table not). Per `sites.ts`'s own header comment this function is also caller-shape 3's dependency (the anonymous `ContactForm` write trusts it to gate "this org's site is live") — a crash here doesn't just break asset loading, it can break the contact-form submit path too. Needs its own wrap in the same pass, or an explicit deferral with a name in `docs/TODO.md`.

2. **A fifth uncaught read: the assets route's own `getBlobStore().resolve()` call, independent of `getPublishedSite()`'s internal blob resolve.** `blob-store.ts`'s `resolve()` has no try/catch of its own by design (it "does not re-authorize; it trusts" — no stated failure-handling contract), so a blip that reaches specifically the `blob_assets` table (org lookup succeeds, blob table doesn't) 500s the asset route even after Gap 1 is fixed. Needs its own wrap at the call site, matching whatever discipline `getPublishedSite()`'s own blob-resolve fix adopts.

3. **A sixth, borderline candidate the kickoff didn't mention at all: `resolveLogoUrl()` in `page.tsx` (lines 86-98).** It calls `getPlatformDb()` directly for `organizationBrands.markAssetKey`, uncaught, and runs on the `ok` path *after* `getPublishedSite()` has already succeeded — but "succeeded a moment ago" doesn't guarantee "succeeds now" under a mid-request blip or pool exhaustion. Recommend tech-lead explicitly rule this in or out of scope rather than let it ship unaddressed by omission; it degrades trivially (same discipline every other optional field on this page already uses — `null` renders no logo).

4. **`publicOrgSummary` runs unconditionally on every `not_found`, including when the reason IS a DB error** — the kickoff already asked this question; I confirm it as a real design gap, not a hypothetical. Today `getPublishedSite()`'s return type cannot tell `page.tsx` *why* it got `not_found` (deliberately, per the existing Phase 1 Gap 5 enumeration-safety property upstream) — so the not_found branch always fires a second query against the same (possibly down) database, doubling both the failure surface and the latency for zero benefit when there's nothing to summarize. Fixing this needs `getPublishedSite()`'s result shape to grow a way to distinguish "confirmed absent" from "read failed" internally, while still emitting the *identical* observable outcome (`notFound()`) either way — this is an API-contract decision for Phase 3, not an implementation detail to bury in Phase 4.

5. **The safe log line needs to be specified, not just "wrap it."** A `try/catch` that itself does `console.error(err)` in the catch block reproduces today's leak — the fix must produce its own minimal line (which read failed + the slug, both non-secret) and must not let Next's own default uncaught-handler see the raw error at all. `isFlagEnabled`'s existing comment is the house style to match verbatim.

6. **The acceptance criterion should be re-run against `next build && next start`, not only `next dev`.** This probe's second crash (the RSC-serialization error) is dev-overlay-specific; confirm the production error page (generic, no stack) is what a real visitor gets, per this repo's own "Verify in a Browser" invariant and its distrust of `next build` passing as sufficient evidence.

## Adversarial Pass

- **Enumeration leaks (DECISION-040/047).** Today's accidental behavior — a nonexistent slug 500s exactly like a real live slug during a DB blip — is enumeration-safe only by coincidence (both fail identically badly). Once fixed, the byte-identical/timing-indistinguishable property must be re-verified across **five** cases, not the two or three an ad hoc check might cover: DB down + nonexistent slug, DB down + real live slug, DB up + nonexistent slug, DB up + suspended org, and flag off. Recommend the regression suite assert response-body equality across these, not just "returns `not_found`" — two independently-degrading code paths can both return the right shape while differing in wall-clock time if only one has a fast in-memory short-circuit.
- **State-machine shortcuts.** Not applicable — single anonymous GET, no multi-step flow to skip.
- **Redirect targets.** None on this surface — no `callbackUrl`/`next`/`redirect` parameter anywhere in these three routes.
- **Self-targeting.** Not applicable — no authenticated actor.
- **Input boundaries.** `slug` is a URL path segment already constrained by the DNS-label CHECK on `organizations.slug`; this fix introduces no new input.
- **What else on the anonymous path reads the DB uncaught, confirmed by reading each named file:**
  - `getPublicStaffRoster()` / `getPublicCommitteeRoster()` (`src/lib/sites.ts:1418-1489`, `:1551-1575`) — **already** fail closed: "ENTIRE BODY is one `try { … } catch { return []; }`," shipped as a same-day Phase 6 addendum on a prior pipeline, confirmed by reading the code, not just the comment. Positive precedent the current fix should match, not diverge from.
  - `getPublishedSiteBrand()` (`src/lib/sites.ts:478+`, backing `/signin` branding) — **already** fail closed, same "entire body is one try/catch" discipline, confirmed by reading.
  - `isFlagEnabled()` (`src/lib/flags.ts:19-38`) — **already** fails closed and confirmed live in this probe; its log-line discipline (key only, never the error object) is the pattern to imitate.
  - `PublicSiteLayout`'s own second `getPublishedSite()` call (`layout.tsz:55`) — inherits whatever fix lands in `getPublishedSite()` itself for free; no separate work needed, confirmed by reading (same function, not a sibling).
  - Net: the codebase already has the right pattern in three places (flags, staff roster, committee roster, brand lookup) and the wrong pattern in at least five (the three named in the kickoff, plus Gaps 1–2 above). The fix is "make the outliers match the house style," not a novel design.

## Out of Scope (confirm with user)

- `isLocalLoginEnabled()`'s log line and the `[local-login]` `err.message` guard (per kickoff, tracked separately).
- `org_features.category_axis` direction (next security review, per kickoff).
- Whether Gaps 1, 2, and 3 above ship in this same pass or get their own follow-up — my recommendation is **same pass** for Gaps 1–2 (identical shape of bug, trivially discoverable once someone reads `resolvePublishedOrganization`'s sibling `db.execute`, and one is a security-relevant path per `sites.ts`'s own caller-shape-3 note about the contact form) and **tech-lead's call** on Gap 3 (lower severity, narrower blast radius — a missing logo, not a 500).

## Open Questions

- Should the three-plus reads share one short, explicit connection/query timeout (recommend ~1–2s) rather than the driver's default TCP/TLS negotiation timeout, given the observed 2.9s cold-failure latency on the very first request of an outage?
- Confirm the `getPublishedSite()` result-type change needed to let `page.tsx` skip `publicOrgSummary` specifically on a DB-error reason (Gap 4) is acceptable design scope for this bug-fix pipeline, or should it be deferred with the current double-query behavior kept but at least made silent/fast?

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-26 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

**Handoff:** architect (Phase 2). Given this is a bug-fix touching no schema, no new dependency, and no directory structure change, Phase 2 may be a documented skip per the Bug-Fix Variant table — but the architect should still rule explicitly on whether widening scope to Gaps 1–2 (a second function, `resolvePublishedOrganization`, and a second call site, the assets route's own blob resolve) stays within "the same fix" or needs its own line item, since that's a placement/scope question, not a functional one. Tech-lead's Phase 3 should treat Gap 4 (whether `publicOrgSummary` should be reachable at all on a DB-error reason) as a real API-contract decision on `GetPublishedSiteResult`, not an implementation afterthought, and should specify the exact safe log-line shape per read before implementation starts.



### Orchestrator rulings (2026-09-26)

- **Scope widened to all six reads:** Gaps 1–2 (`resolvePublishedOrganization()`'s own `db.execute` at `sites.ts:446`; the assets route's own `getBlobStore().resolve()`) and Gap 3 (`resolveLogoUrl()`'s `getPlatformDb()` read — degrade to no logo) ship in this pass; the same class, the same house style (`getPublicStaffRoster()`'s "entire body is one try/catch").
- **Gap 4 is a Phase 3 design call:** `GetPublishedSiteResult` may grow an internal reason so `page.tsx` skips `publicOrgSummary` on a DB error while emitting the identical `notFound()` — the tech-lead rules the shape.
- **Timeouts:** tech-lead rules whether a short uniform query timeout is warranted; the observed 2.9 s first-failure latency is a cold-connection artefact, not a per-slug oracle.
- **Acceptance runs on `next build && next start`**, not only `next dev`.

---

# Phase 2 — Architectural Review (architect)

**Skipped by notation (bug-fix variant, 2026-09-26):** no schema, dependency, directory or route-group change; every edit is inside existing functions or their call sites, matching a pattern already present in three sibling functions. The scope widening to the sibling reads is a placement call the orchestrator made above.

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

`getPublishedSite()`'s own docstring already promises that every non-live
reason for a public congregation site — never provisioned, suspended,
nonexistent slug, org inactive, flag off, **DB down** — collapses to the
identical `{ kind: "not_found" }`, never a 500. That promise is true of
exactly one of its internal reads (the flag check, fixed in
`2026-09-26-flags-fail-closed`) and false of the other two, plus three
sibling reads elsewhere on the same anonymous surface that share the
identical shape of bug: `resolvePublishedOrganization()`'s own
`db.execute`, the assets route's own `getBlobStore().resolve()` call, and
`resolveLogoUrl()`'s `getPlatformDb()` read. Root cause is uniform across
all six: a bare `await` on a driver call with no `try/catch`, so a DB blip
throws Drizzle's own error — which embeds the failed SQL text and bound
params (confirmed live: `params: fpcw,1` printed to the server console) —
up through Next's default handler, which then also crashes attempting to
serialize a raw driver error object across the RSC boundary. The fix is not
a new mechanism; it is applying a pattern the codebase already has in three
other places on this exact surface (`getPublishedSiteBrand()`,
`getPublicStaffRoster()`, `getPublicCommitteeRoster()` — all "the entire
body is one `try { … } catch { return <safe empty value> }`") to the six
places that never got it, while closing one incidental gap the
flags-fail-closed fix created: `publicOrgSummary()` is now reachable, and
throws, specifically **on the DB-down path**, because the `not_found`
branch it feeds is the one every blip now routes into.

## Permissions & Flags

- Permission key(s): none — this surface is intentionally identity-blind
  (see the file's own header, and CLAUDE.md's `(org)`/`(public)` contract
  notes on anonymous public sites).
- Default role bindings: n/a.
- Feature flag(s): not needed. `sites.public_render`,
  `sites.public_staff_directory`, `sites.public_committee_directory`, and
  `ui.brand_theming` are all pre-existing and already read through the
  fail-closed `isFlagEnabled()`; this fix touches no flag definition, only
  the *reads that run after* a flag check passes.

## API Contract

No route signature changes. Every touched function keeps its existing
exported signature; only internal error handling changes. Listed for
completeness (all pre-existing):

- `getPublishedSite(slug: string): Promise<GetPublishedSiteResult>` —
  `src/lib/sites.ts:349`. Return type widens (see Data Model) but every
  existing caller matches on `result.kind === "ok" | "not_found"` only, so
  no caller needs to change.
- `resolvePublishedOrganization(slug: string): Promise<{ organizationId: string } | null>`
  — `src/lib/sites.ts:434` (unchanged signature).
- `publicOrgSummary(slug: string): Promise<{ name; organizationType } | null>`
  — `src/lib/authz.ts:518` (unchanged signature).
- `GET /site/[slug]/assets/[key]` — `src/app/(public)/site/[slug]/assets/[key]/route.ts`
  (unchanged request/response; only the failure path changes from 500 to
  404).
- `resolveLogoUrl(organizationId, slug): Promise<string | null>` —
  `src/app/(public)/site/[slug]/[[...path]]/page.tsx:86` (unchanged
  signature, module-private).

## Data Model

No schema changes required. One TypeScript-only shape change:

`GetPublishedSiteResult`'s `not_found` variant (`src/lib/sites.ts:261`)
gains an **internal-only, optional** discriminant so `page.tsx` can decide
whether calling `publicOrgSummary()` is worth doing at all, without ever
letting that discriminant leak into the rendered response:

```ts
export type GetPublishedSiteResult =
  | { kind: "ok"; site: PublishedSite }
  // Collapses: never provisioned, suspended, nonexistent slug, org inactive,
  // flag off, a corrupt/unparseable bundle, AND a DB read failure — all
  // render the same 404 (Phase 1 Gap 5's enumeration-safety requirement).
  // `reason` is a hint for the CALLER's own follow-up query cost, never a
  // value read to vary output — see the Edge Cases entry on why `page.tsx`
  // is forbidden from branching its RESPONSE on it.
  | { kind: "not_found"; reason?: "absent" | "read_failed" };
```

Ruling on Gap 4: **skip `publicOrgSummary()` when, and only when,
`reason === "read_failed"`.** Two things justify a hint field over the two
alternatives Phase 1 raised (leave it alone; or make `page.tsx` guess from
timing):

1. `reason` is populated by `getPublishedSite()` itself, which already knows
   exactly which of its own `try/catch` blocks fired (see Implementation
   Order below) — no new detection logic, no timing inference.
2. The enumeration-safety invariant is preserved *by construction*, not by
   caller discipline: `reason` only ever changes which query `page.tsx`
   issues, never what it returns. Both branches end at `notFound()` with the
   same JSX, same status code, same headers. A future engineer adding a
   sixth `not_found` cause cannot accidentally vary the response by reading
   `reason`, only by literally changing the returned JSX — which is exactly
   as reviewable as any other change to that branch.

`resolvePublishedOrganization()` gets the analogous internal signal it
already effectively has (it returns bare `null` for every miss, never
narrower) — no change needed there since it has no downstream
`publicOrgSummary()`-style follow-up to skip.

## Component / Page Plan

- Pages to create: none.
- Components to create: none.
- Files to modify:
  - `src/lib/sites.ts` — `getPublishedSite()` (wrap, set `reason`),
    `resolvePublishedOrganization()` (wrap), `GetPublishedSiteResult` type
    (add `reason`), restore the docstring above `getPublishedSite()` to its
    full original claim (drop the "It is NOT yet true of the two reads
    below…" caveat entirely — once shipped, that sentence is the bug, not
    documentation of it).
  - `src/lib/authz.ts` — `publicOrgSummary()` (wrap, return `null` on
    failure; no signature change, no doc-comment claim currently overstates
    this so nothing to restore, but add one sentence noting the fail-closed
    behavior for the next reader).
  - `src/app/(public)/site/[slug]/[[...path]]/page.tsx` — the `not_found`
    branch (skip `publicOrgSummary()` when `result.reason === "read_failed"`),
    `resolveLogoUrl()` (wrap at the call site, return `null` on failure).
  - `src/app/(public)/site/[slug]/assets/[key]/route.ts` — wrap the
    `getBlobStore().resolve()` call at this call site (this is a *second*,
    independent uncaught call from the one already fixed inside
    `getPublishedSite()` itself — Gap 2, confirmed by reading: `blob-store.ts`'s
    `resolve()` states no failure-handling contract of its own, "does not
    re-authorize; it trusts," so every caller owns its own wrap).
  - `src/lib/sites.test.ts` — new `describe` blocks per wrapped read (see
    Edge Cases & Risks / test list below).
  - `src/lib/authz.test.ts` (create if it does not already cover
    `publicOrgSummary` — check before assuming) — throw → `null` case.
  - `docs/TODO.md` / `docs/decisions.md` — proposed lines below, applied by
    the orchestrator at integration per Workflow Rule 16.

## Implementation Order

1. `src/lib/sites.ts`: widen `GetPublishedSiteResult` (`reason` field).
2. `src/lib/sites.ts`: wrap `getPublishedSite()` — the **entire body**
   becomes one `try { … } catch { … }`, matching `getPublicStaffRoster()`'s
   own documented convention exactly (its comment even names the earlier
   incident where this exact class of bug shipped unmade once already —
   read it before writing the new one). Every existing internal
   `return { kind: "not_found" }` in the body stays as-is (those are
   *confirmed-absent* outcomes reached without throwing — a missing row, a
   missing content-bundle key, a missing blob, unparseable JSON — and get
   `reason: "absent"`, or no reason at all, since `page.tsx` only special-
   cases `"read_failed"`). Only the outer `catch` sets
   `{ kind: "not_found", reason: "read_failed" }`, and logs:
   `console.error("[sites] getPublishedSite read failed; treating as not found", { slug })`.
   The two currently-unwrapped reads (`db.execute` at `:356`, the blob
   resolve at `:362`) are now inside that same try block — no per-read
   nested try/catch, one outer boundary, matching house style.
3. `src/lib/sites.ts`: wrap `resolvePublishedOrganization()` the same way —
   entire body in `try { … } catch { return null; }`, log:
   `console.error("[sites] resolvePublishedOrganization read failed; treating as not found", { slug })`.
4. `src/lib/authz.ts`: wrap `publicOrgSummary()` — entire body in
   `try { … } catch { return null; }`, log:
   `console.error("[authz] publicOrgSummary read failed; treating as not found", { slug })`.
   This is the fix for the crash Phase 1 actually reproduced live
   (`authz.ts:521`).
5. `page.tsx`: change the `not_found` branch to
   `const summary = result.reason === "read_failed" ? null : await publicOrgSummary(slug);`
   — preserves byte-identical output (both paths end at the same `notFound()`
   or the same `PresbyteryFallback`, since a DB-down `publicOrgSummary()` call
   would itself now return `null` per step 4 even if it *were* called; the
   skip is purely to avoid firing a second doomed query against a database
   that's already down, per Phase 1 Gap 4's own framing — "nothing to
   summarize").
6. `page.tsx`: wrap the `resolveLogoUrl()` call site (not the function body,
   since it's a short, local, already-narrow function) —
   `const logoUrl = await resolveLogoUrl(site.organizationId, slug).catch((err) => { console.error("[site-page] resolveLogoUrl read failed; rendering without a logo", { slug }); return null; });`
   at both call sites (`generateMetadata` and the page body — `:184` and
   `:239`). `OrgMark` and `buildPageMetadata` already treat `logoUrl: null`
   as "no logo" (Phase 1 Gap 3's own note — "same discipline every other
   optional field on this page already uses").
7. `assets/[key]/route.ts`: wrap the `getBlobStore().resolve()` call —
   `try { blob = await getBlobStore().resolve(...); } catch { console.error("[site-assets] blob resolve failed; treating as not found", { slug, key }); return NextResponse.json({ error: "Not found" }, { status: 404 }); }`.
   Log includes `key` (an opaque blob-row uuid, not a secret and not SQL —
   safe per the same standard `isFlagEnabled`'s comment sets).
8. Restore `getPublishedSite()`'s docstring to its full original claim (drop
   the caveat sentence — see Component/Page Plan).
9. Tests (implementer-authored, QA verifies only): one throwing-mock case
   per wrapped function (`getPublishedSite`, `resolvePublishedOrganization`,
   `publicOrgSummary`, the assets route, `resolveLogoUrl`'s call sites), plus
   the cross-case body-equality test and the live-server probe (see Edge
   Cases & Risks).
10. No release-notes entry — this is an invisible reliability fix on a path
    that already worked correctly except during a DB outage; no new
    member-visible behavior (Workflow Rule 13 does not apply). No
    `FEATURE_CATALOG`/flag/schema/audit steps — none apply to this fix.

## Edge Cases & Risks

- **Enumeration safety (DECISION-040/047) is the load-bearing property, not
  a nice-to-have.** The regression suite must assert **response body
  equality** (not just "returns 404") across the five cases Phase 1's
  adversarial pass named: (a) DB down + nonexistent slug, (b) DB down + real
  live slug, (c) DB up + nonexistent slug, (d) DB up + suspended org, (e)
  flag off. A test that only checks `status === 404` on each case
  independently would pass even if one path returned a different body or a
  measurably different latency profile — the actual property this bug
  threatened. Implement as a Playwright or integration test that fetches all
  five and diffs the HTML bodies pairwise (strip only genuinely
  non-deterministic bytes, if any — there should be none, since `notFound()`
  renders a static 404 page with no per-case content).
- **`reason` must never leak into anything user-visible or timing-visible
  beyond the one internal branch named in Data Model.** Code review (Phase
  5's feature-gate-equivalent check for this bug-fix) should grep every
  reference to `.reason` and confirm there is exactly one — the
  `page.tsx` conditional in Implementation Order step 5. If a second
  reference appears anywhere (metadata, headers, logging visible to the
  client, a future caller), that is a regression of the invariant this
  design exists to protect, not a stylistic nit.
- **Timeouts: leave the driver default, do not add a per-query
  `statement_timeout`.** Ruling: the observed ~2.9s cold-connection failure
  on the very first request of an outage is real and mildly unpleasant, but
  it is not a per-tenant or per-slug oracle by itself (Phase 1 already
  confirmed both `fpcw` and `not-a-slug` hit it identically — it's a
  property of *when* the request lands relative to the outage, not *which*
  slug is requested). Adding an explicit short timeout (Phase 1 floated
  ~1-2s) trades a real latency improvement for a new hand-tuned constant
  with its own failure mode: too short, and a slow-but-genuinely-live Neon
  cold-start on a legitimate low-traffic tenant starts returning false
  404s, which is a *worse* enumeration-safety outcome than a slow-but-
  correct one (a false negative on a real site is indistinguishable from
  the site never having existed, from the outside). The uniform-404
  *property* is what DECISION-040 requires; uniform *speed* is a UX
  nicety this bug-fix does not need to buy by introducing a new tunable.
  Revisit only if a future incident shows the 3s stall itself (not the
  eventual 404) is the user-facing complaint — that's a capacity/timeout
  design with its own Phase 1, not a rider on this fix.
- **The RSC-serialization crash Phase 1 saw twice is a symptom, not a
  second bug.** It disappears once no raw driver error escapes a Server
  Component uncaught (i.e., once all six reads are wrapped); no separate
  fix needed, but the acceptance run must confirm it's gone under `next dev`
  too, not just absent from the `next build && next start` production
  output (a production build swaps in the generic error page regardless,
  which would mask a lingering uncaught throw in dev without proving it's
  fixed).
- **Log-line discipline, per read, matching `isFlagEnabled`'s house style
  exactly** — the `key`-only precedent extended to `slug` (and `key` for the
  asset route, which is an opaque row id, not the failed SQL):
  - `console.error("[sites] getPublishedSite read failed; treating as not found", { slug })`
  - `console.error("[sites] resolvePublishedOrganization read failed; treating as not found", { slug })`
  - `console.error("[authz] publicOrgSummary read failed; treating as not found", { slug })`
  - `console.error("[site-assets] blob resolve failed; treating as not found", { slug, key })`
  - `console.error("[site-page] resolveLogoUrl read failed; rendering without a logo", { slug })`
  None pass the caught `err`, `err.message`, or any templated string built
  from either — that's exactly the leak Phase 1 caught live (`params:
  fpcw,1` printed by Next's own default handler when nothing caught the
  error first). Test assertion: mock `console.error`, assert it was called
  with a string containing no `select`, `Failed query`, or `params:`
  substring, on every wrapped path.
- **Scope confirmation (Gaps 1–3), per the orchestrator's ruling already
  recorded above this section:** all six reads ship in this one pass. No
  further scoping call for tech-lead to make here.
- **`resolvePublishedOrganization()`'s caller-shape-3 dependency**
  (`submitSiteContactMessage`, the anonymous contact-form write) inherits
  this fix for free — no separate wrap needed there, confirmed by reading:
  it calls `resolvePublishedOrganization()`, not `db.execute` directly.
- **e2e blast radius.** Existing specs that assert behavior on this surface
  and must still pass unchanged after this fix:
  - `e2e/visual-parity.spec.ts` and any `public-site*.spec.ts` /
    `site-render*.spec.ts` under `e2e/` — grep `e2e/` for `/site/` before
    implementation starts and list every matching spec file here in Phase 4
    notes; none of them should observe any behavior change on the DB-up
    path (only DB-down behavior changes, and only from 500 to 404).
  - Any existing unit test in `src/lib/sites.test.ts` that currently asserts
    `getPublishedSite()`'s *happy-path* return shape must keep passing
    unmodified — the `try/catch` wrap changes nothing about the `ok` return
    value.
  - No spec should currently assert a 500 anywhere on this surface (that
    would itself be evidence of a test asserting the bug); if one exists,
    it is invalid and must be corrected as part of this fix, named
    explicitly in Phase 4, not silently overwritten.

## Implementer

**api-developer.** Every touched file is server-only logic with no new UI
(`src/lib/sites.ts`, `src/lib/authz.ts`, one route handler, one
`page.tsx` server function's call sites) — no new component, no new client
interaction, matching the Phase 4 selection table's "route handlers, server
actions, server logic" row. `resolveLogoUrl`'s call sites live inside a
Server Component but the change is a `.catch()` wrapper on an existing
`await`, not a rendering change.

## Proposed `docs/decisions.md` entry (orchestrator applies at integration)

**DECISION-154 recommended: yes.** Text proposed:

> **DECISION-154: every anonymous read on the public-site render path
> (`(public)/site/[slug]`) fails closed to the identical generic `not_found`
> response — no exceptions, no per-read judgment call.** `getPublishedSite()`,
> `resolvePublishedOrganization()`, `publicOrgSummary()`, the asset route's
> blob resolve, and `resolveLogoUrl()` each independently learned this the
> hard way (`2026-09-26-public-render-blip`) after the flags-fail-closed fix
> (`2026-09-26-flags-fail-closed`) proved the pattern for one read and
> incidentally created a new crash path into a second. Any NEW read added
> to this surface in the future — a further sibling function, a future
> caller-shape-1 addition — inherits this as a hard requirement, not a
> style preference: wrap the entire body in one `try/catch`, log
> `[module] functionName read failed; treating as not found"` with only
> non-secret identifiers (never the caught error or its `.message`), and
> return the same shape a confirmed-absent case returns. This extends
> DECISION-040's enumeration-safety rule (byte-identical/timing-
> indistinguishable across "not a tenant," "not published," "flag off") to
> cover "database unreachable" as a fifth indistinguishable case rather than
> leaving each future contributor to rediscover it by causing an outage.

Reasoning for recommending yes over no: this is the *second* time this
project has shipped this exact class of bug on this exact surface (staff
roster, Phase 6 same-day addendum; now three-then-six reads here) — a
standing rule that's checkable by reading (grep every function under the
"caller shape 1: anonymous public read" header in `sites.ts`, confirm each
is one outer try/catch) costs one paragraph and prevents a third
recurrence. If the user judges this over-specified for a two-sentence
pattern already stated in `sites.ts`'s own header comment, the fallback is
folding this into the existing header comment instead of a numbered
decision — tech-lead's preference is the numbered decision, since the
header comment is what already existed and still let two of six reads
regress.

## Proposed `docs/TODO.md` line (orchestrator applies at integration)

Move any existing "public render path 500s on DB blip" tracking line to
Done, dated at Phase 6 close; no new backlog line — this fix, once shipped,
closes the gap completely (all six reads named in Phase 1, no deferred
scope).

---

# Phase 4 — Implementation

**Date:** 2026-09-26 · **Implementer:** api-developer

## Files Created

- `src/lib/sites-render-fail-closed.test.ts` — a pure-mock unit-test file
  (mocks `@/lib/db`, `@/lib/flags`, `@/lib/storage/blob-store` wholesale, same
  pattern `flags.test.ts`/`authz.test.ts` already use) covering
  `getPublishedSite()`'s and `resolvePublishedOrganization()`'s own
  throw→fail-closed behavior. Added because this pipeline's kickoff
  deliberately provisions no Neon branch and `.env.local` here is a
  read-only copy of `development` — the design doc's instruction to add
  throwing-mock cases to `sites.test.ts` (a real-Postgres integration suite,
  `describe.skipIf(!hasDb)`) is honored too (see below), but that suite
  needs `DATABASE_URL`/`PLATFORM_DATABASE_URL` and writes/restores real
  fixture rows, which I could not execute myself under this pipeline's
  constraints. This file runs under plain `npm test`, no DB, no secrets, and
  is what let me demonstrate the required failing-first cycle for
  `sites.ts` locally. Not a replacement for the `sites.test.ts` additions —
  the two are complementary, see Implementer Notes.

## Files Modified

- `src/lib/sites.ts`:
  - `GetPublishedSiteResult`'s `not_found` variant gains
    `reason?: "absent" | "read_failed"` (internal-only discriminant, one
    legal reference outside this file — see below).
  - `getPublishedSite()`: entire body now one `try { … } catch { … }`
    (matching `getPublicStaffRoster()`'s documented convention). The
    previously-uncaught `db.execute` (`presby_published_site()`) and the
    blob resolve are now inside the same try boundary. Every existing
    internal `return { kind: "not_found" }` (confirmed-absent: flag off, no
    row, no bundle key, missing blob, unparseable bundle) is unchanged, no
    `reason` added. Only the outer `catch` sets
    `{ kind: "not_found", reason: "read_failed" }` and logs
    `[sites] getPublishedSite read failed; treating as not found", { slug }`
    — never the caught error or its `.message`. Docstring restored to its
    full original claim (the "It is NOT yet true of the two reads below…"
    caveat is gone).
  - `resolvePublishedOrganization()`: same wrap, `catch { return null; }`,
    logs `[sites] resolvePublishedOrganization read failed; treating as not
    found", { slug }`.
- `src/lib/authz.ts` — `publicOrgSummary()`: entire body wrapped, `catch {
  return null; }`, logs `[authz] publicOrgSummary read failed; treating as
  not found", { slug }`. This is the fix for the crash Phase 1 actually
  reproduced live (`authz.ts:521`, called from the `not_found` branch every
  DB blip now routes into). Doc comment gained one paragraph noting the
  fail-closed behavior.
- `src/app/(public)/site/[slug]/[[...path]]/page.tsx`:
  - `not_found` branch: `const summary = result.reason === "read_failed" ?
    null : await publicOrgSummary(slug);` — skips the second doomed query
    when the first read already failed closed. This is the ONE legal
    reference to `.reason` outside `sites.ts`; grepped and confirmed (see
    Edge Cases below).
  - Both `resolveLogoUrl()` call sites (`generateMetadata` and the page
    body) wrapped with `.catch(() => { console.error(...); return null; })`
    — a mid-request blip on this optional read degrades to no logo, never a
    crash. `resolveLogoUrl()`'s own body is deliberately NOT wrapped (per
    design: short, local, two callers, each needs its own distinct log
    line) — its doc comment now says so explicitly.
- `src/app/(public)/site/[slug]/assets/[key]/route.ts` — the
  `getBlobStore().resolve()` call wrapped in its own `try/catch`
  (independent from the one already fixed inside `getPublishedSite()`);
  catch logs `[site-assets] blob resolve failed; treating as not found",
  { slug, key }` and returns the same 404 the "org not found" branch above
  it already returns. Header comment updated to note both functions this
  route calls now fail closed internally.
- `src/lib/sites.test.ts` — added throwing-mock (`vi.spyOn(db, "execute")`)
  cases for `getPublishedSite()` and `resolvePublishedOrganization()`,
  matching the file's own existing "a transient DB error degrades to []"
  precedent (`getPublicCommitteeRoster`'s test), plus a log-line assertion
  test. These run only when `DATABASE_URL`/`PLATFORM_DATABASE_URL` are set
  (the file's own `hasDb` skip-guard) — I could not execute them myself
  under this pipeline's "no Neon branch, `.env.local` read-only" constraint;
  they are written for CI's `db-tests` job / a future local run against a
  disposable branch. Typechecked clean; not independently failing-first
  verified by me (see Implementer Notes).
- `src/lib/authz.test.ts` — two new cases on the existing `publicOrgSummary`
  describe block: throw → resolves `null`, and the safe-log-line assertion
  (mirrors `flags.test.ts`'s own `isFlagEnabled` log-line test verbatim in
  spirit).
- `src/app/(public)/site/[slug]/[[...path]]/page.test.tsx` — new describe
  block for the `reason: "read_failed"` skip (asserts `publicOrgSummary` is
  NOT called on that reason, IS called when `reason` is absent or
  `"absent"`, and that the rendered `notFound()` outcome is byte-identical
  either way), plus two `resolveLogoUrl`-throws-mid-request cases (one for
  the page body's call site, one for `generateMetadata`'s).
- `src/app/(public)/site/[slug]/assets/[key]/route.test.ts` — one new case:
  `getBlobStore().resolve()` throwing still 404s, with the safe-log-line
  assertion.

## Schema Changes

None.

## Audit Events

Not applicable — no security-sensitive mutation on this surface (anonymous,
identity-blind reads only).

## Verification Run (this session)

- `npm run typecheck` — PASS (clean, 0 errors).
- `npm run lint` — PASS (`--max-warnings=0`, 0 warnings/errors).
- `npm run check` (audit / sql-date / deps-drift / brand-scope / secrets) —
  all five PASS.
- `npm test` — 256 files / 3332 tests passed, 32 files / 836 tests skipped
  (pre-existing skip pattern: DB-backed suites without `DATABASE_URL`, plus
  environment-gated specs unrelated to this change). No regressions.
- `e2e/` blast-radius check per Phase 3's own instruction: `grep -rl "/site/"
  e2e/` → `e2e/branded-signin.spec.ts`, `e2e/public-sites.spec.ts`. Neither
  asserts a 500 anywhere (`grep -n "500\|status" ` on both — no `500`
  match). No existing e2e spec required correction.
- `.reason` grep across all four touched production files → exactly one
  match, the `page.tsx` conditional named in Data Model. Confirmed.
- `layout.tsx`'s own second `getPublishedSite()` call → confirmed it
  references only `.kind`, never `.reason`; inherits the fix for free as
  designed, no edit needed.

### Failing-first evidence (per file, via `git stash push -- <file>` /
`git stash pop`, never touching the test files themselves)

| Fix file reverted | Test file run | Result before fix | Result after fix (restored) |
|---|---|---|---|
| `src/lib/authz.ts` | `src/lib/authz.test.ts` | 2 new tests FAIL (uncaught throw) | 44/44 PASS |
| `src/app/(public)/site/[slug]/[[...path]]/page.tsx` | `page.test.tsx` | 3 new tests FAIL | 32/32 PASS |
| `src/app/(public)/site/[slug]/assets/[key]/route.ts` | `route.test.ts` | 1 new test FAIL | 4/4 PASS |
| `src/lib/sites.ts` | `src/lib/sites-render-fail-closed.test.ts` | 6/7 new tests FAIL (the 7th, "flag off returns no reason," was already correct pre-fix and is a negative-control case) | 7/7 PASS |

`src/lib/sites.test.ts`'s own new throwing-mock cases were NOT independently
failing-first verified by me — see Implementer Notes for why, and note this
is a real gap I am naming rather than glossing over.

### Live-probe acceptance (production build, unreachable DB)

Per the task's exact recipe: `rsync -a --exclude .git --exclude .next
--exclude node_modules` of the worktree into a scratch directory under the
session scratchpad (outside the repo), `cp -al node_modules` (hardlinked,
avoiding Turbopack's symlink font-resolution issue), a scratch `.env.local`
with `DATABASE_URL`/`PLATFORM_DATABASE_URL`/`MIGRATE_DATABASE_URL`/
`APP_DATABASE_URL`/`DIRECT_DATABASE_URL` all pointed at
`postgres://…@localhost:59999/nonexistent` — confirmed via `lsof
-iTCP:59999` that nothing listens there before use (port 5432 was rejected
for this purpose: a real local Postgres was listening on it, which would
not reproduce "unreachable"). `npm run build` succeeded; `PORT=3400 npm run
start` served on the real listening PID (`lsof -iTCP:3400 -sTCP:LISTEN`,
not npm's own wrapper PID).

```
GET /site/fpcw                → 404  0.106s
GET /site/fpcw/sitemap.xml    → 404  0.033s
GET /site/fpcw/assets/x       → 404  0.005s
GET /site/not-a-slug          → 404  0.011s
```

All four 404, as required. `diff` on the two page bodies
(`/site/fpcw` vs. `/site/not-a-slug`) showed exactly one class of
difference: the requested slug itself, echoed back inside Next's own RSC
router-state payload (`"c":["","site","fpcw"]` vs. `"...,"not-a-slug"]"`) —
not a leak, since the client supplied that string in the request URL it
already knows. Normalizing that one substring (`sed s/fpcw/SLUG/`,
`sed s/not-a-slug/SLUG/`) on both bodies produced a byte-identical diff.
Response headers were identical apart from `Date`. The full server log
(`grep -iE "select |Failed query|params:"`) had zero matches — the leak
Phase 1 caught live (`params: fpcw,1`) does not reproduce.

The log DID show the fix firing, and something worth naming precisely: in
this TOTAL outage (the flags table is unreachable too), `isFlagEnabled()`
itself fails closed BEFORE `getPublishedSite()`'s or
`resolvePublishedOrganization()`'s own `db.execute` is ever reached — so
this specific live probe exercises `isFlagEnabled`'s pre-existing fail-closed
path and `publicOrgSummary()`'s NEW one, but never reaches
`getPublishedSite()`'s or `resolvePublishedOrganization()`'s own outer
`catch` (their internal `if (!(await isFlagEnabled(...))) return
{ kind: "not_found" }` branch returns first, with no `reason`, because
`isFlagEnabled` swallows its own error and returns `false` rather than
throwing). This is exactly the scenario Phase 1's own adversarial pass
flagged as unexercised by a total-outage probe ("A partial blip — flags
table reachable, `organizations`/`presby_published_site()` or `blob_assets`
specifically not — is not exercised by this probe"). The deeper two
`catch` blocks (`sites.ts`'s own `[sites] getPublishedSite read failed`/
`[sites] resolvePublishedOrganization read failed` log lines) are proven
ONLY by the mocked unit tests above (`sites-render-fail-closed.test.ts`,
`sites.test.ts`'s new cases), which hold `isFlagEnabled` healthy and fail
only the deeper read — this live probe cannot produce that partial
condition by construction (one DB connection, can't selectively break one
table via env vars alone). Full server log:

```
[flags] isFlagEnabled read failed; treating as disabled { key: 'sites.public_render' }
[authz] publicOrgSummary read failed; treating as not found { slug: 'fpcw' }
[flags] isFlagEnabled read failed; treating as disabled { key: 'sites.public_render' }
[flags] isFlagEnabled read failed; treating as disabled { key: 'sites.public_render' }
[flags] isFlagEnabled read failed; treating as disabled { key: 'sites.public_render' }
[authz] publicOrgSummary read failed; treating as not found { slug: 'not-a-slug' }
[flags] isFlagEnabled read failed; treating as disabled { key: 'sites.public_render' }
[authz] publicOrgSummary read failed; treating as not found { slug: 'fpcw' }
[flags] isFlagEnabled read failed; treating as disabled { key: 'sites.public_render' }
[authz] publicOrgSummary read failed; treating as not found { slug: 'not-a-slug' }
```

No RSC-serialization crash (the "Only plain objects… can be passed to
Client Components" error Phase 1 saw twice under `next dev`) appeared
anywhere in the log — consistent with Phase 3's prediction that it was a
symptom of the raw driver error escaping uncaught, not a second bug.

Server stopped by PID (`lsof -iTCP:3400 -sTCP:LISTEN`, then `kill <pid>`,
confirmed the port freed — never `pkill -f`). The scratch copy and all
temp probe files were deleted afterward
(`rm -rf` the scratch dir, `rm -f` the `/tmp` probe artifacts). The
worktree's own `.env.local` was never read for its values (only `grep -o
'^[A-Z_0-9]*='` to list variable NAMES) and never written to; `git status
--short` at the end of this session shows only the intended
modified/untracked files, confirming no accidental write leaked back into
the worktree or `development`.

## Implementer Notes

- **Deviation, named plainly: `src/lib/sites.test.ts`'s new DB-backed
  throwing-mock cases were written to spec but not executed by me.** This
  pipeline's kickoff explicitly provisions no Neon branch
  ("no Neon branch — no schema change") and instructs `.env.local` be
  treated read-only, with an unreachable-host scratch env as the
  reproduction technique — which is exactly what the live probe above uses,
  but running `sites.test.ts`'s real-Postgres integration suite would
  require a LIVE, reachable `development`-equivalent database to create and
  tear down fixture rows (`orgLive`, flag flips, etc.), which is a write I
  was told not to make against `development` and had no disposable branch
  to make instead. I compensated by writing a second, pure-mock test file
  (`sites-render-fail-closed.test.ts`) that exercises the IDENTICAL
  `try/catch` boundaries without any DB dependency, and used THAT file for
  the required failing-first demonstration. The `sites.test.ts` additions
  still typecheck cleanly and match the file's own established pattern
  exactly (`vi.spyOn(db, "execute").mockRejectedValueOnce(...)`,
  `getPublicCommitteeRoster`'s own precedent test one screen above where I
  added mine) — they are real, correct coverage, just not personally
  execution-verified by me. **QA: this is the one gap in my own
  failing-first evidence; if the `db-tests` CI job (or a local run against a
  disposable branch) is available to you, please run
  `dotenv -e .env.local -- vitest run src/lib/sites.test.ts` against a real
  branch and confirm both new cases pass — I could not do this step myself
  under this pipeline's constraints.**
- **`resolveLogoUrl()`'s own body stays unwrapped by design** (Phase 3's
  explicit ruling) — both call sites own the catch instead, so each can
  attach its own log line (`generateMetadata`'s vs. the page body's) without
  a shared wrapper hiding which call site actually failed. Confirmed both
  call sites' tests independently in `page.test.tsx`.
- **No timeout added** — Phase 3's ruling (leave the driver default) is
  unchanged code, nothing to implement. The live probe's fast responses
  (all four under 110ms) are an artifact of `localhost:59999` refusing the
  TCP connection immediately rather than the ~2.9s cold Neon TLS-negotiation
  timeout Phase 1 observed against a real remote host — this probe cannot
  reproduce that specific latency number, only the correctness property
  (uniform 404), which was the actual acceptance criterion.
- **No release-notes / `FEATURE_CATALOG` / flag / schema / audit changes** —
  per Phase 3 Implementation Order step 10, none apply to this fix.
- **`docs/TODO.md`/`docs/decisions.md` NOT edited by me** — per this
  pipeline's shared-file discipline; Phase 3's proposed `DECISION-154` text
  and TODO line are recorded above (Phase 3 section) for the orchestrator to
  apply at integration.

## Handoff

**Next: qa (Phase 5).** No UI surface was added or changed in a way a human
reviews visually (the anonymous 404 page is unchanged in appearance; the fix
is entirely failure-path plumbing), so there is no ux-developer step for
this pipeline — Phase 3 already named `api-developer` as the sole
implementer, and that holds. QA should: run the full suite (`npm test`),
confirm the `sites.test.ts` throwing-mock additions actually pass against a
live branch (the one gap named above), and re-run the live-probe recipe
independently if it wants a second confirmation of the acceptance criterion
rather than relying on the transcript in this section.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-26.*

**Date:** 2026-09-26
**Verified by:** qa
**Worktree:** `/Users/cshenso/git/presby-platform/presby-wt-render` (branch `pipeline/render-path`)
**Mode:** Bug-fix variant — failing-first reproduced independently by QA, not accepted from the Phase 4 transcript.

## Type Check

`npm run typecheck`: **PASS** (tsc --noEmit, 0 errors)
`npm run lint`: **PASS** (`--max-warnings=0`, 0 warnings)
`npm run check`: **PASS** — all five tripwires (audit / sql-date / deps-drift / brand-scope / secrets)

## Unit Tests

**Pure suite (`npm test`):** Total 4168 | Passed 3332 | Failed 0 | Skipped 836 (32 files, DB-gated) | 12.5s
**Full DB-backed suite (`npm run test:db`, live `development` branch, serial):** Total 4168 | **Passed 4168 | Failed 0 | Skipped 0** | 421s

The skip count in the pure run is entirely the pre-existing `describe.skipIf(!hasDb)` gating; I ran the whole thing again with `.env.local` and `--no-file-parallelism` and **zero specs skipped, zero failed**. There is no "6 of 48" hazard here.

Failures: none.

### The gap the implementer named — closed

`src/lib/sites.test.ts`'s three new DB-backed throwing-mock cases were never executed by the implementer. I ran them against the live `development` branch:

```
npx dotenv -e .env.local -- vitest run src/lib/sites.test.ts --no-file-parallelism
Test Files 1 passed (1) · Tests 80 passed (80) · 0 skipped
```

Verbose run confirms all three named cases actually executed (not silently absent):
- ✓ `sites.test.ts:518` — transient DB error → `{ kind: "not_found", reason: "read_failed" }`
- ✓ `sites.test.ts:530` — logs the slug, never the error
- ✓ `sites.test.ts:571` — `resolvePublishedOrganization` transient error → `null`

And I closed the implementer's second gap too: these three were **also** verified failing-first (see below), which the implementer could not do.

### Failing-first evidence — reproduced independently by QA

Method: `git stash push -- <production file>` → run the spec → `git stash pop` → `git status` confirms restoration. Test files were never touched. `git stash list` is empty at the end.

| Production file reverted | Spec run | Before fix | After fix |
|---|---|---|---|
| `src/lib/authz.ts` | `src/lib/authz.test.ts` | **2 failed** / 42 passed (`authz.test.ts:482`, `:492` — uncaught `Failed query: select "name", "organization_type" …  params: fpcw,1`) | **44/44 pass** |
| `src/lib/sites.ts` | `src/lib/sites-render-fail-closed.test.ts` | **6 failed** / 1 passed (the 1 pass is the flag-off negative control at `:134`) | **7/7 pass** |
| `src/lib/sites.ts` | `src/lib/sites.test.ts` (live DB) | **3 failed** / 77 passed (`:518`, `:530`, `:571`) | **80/80 pass** |
| `src/app/(public)/site/[slug]/[[...path]]/page.tsx` | `page.test.tsx` | **3 failed** / 29 passed (`:160`, `:386`, `:603`) | **32/32 pass** |
| `src/app/(public)/site/[slug]/assets/[key]/route.ts` | `route.test.ts` | **1 failed** / 3 passed (`:65`) | **4/4 pass** |

Every new test was watched red before the fix and green after, by me, on this machine. Nothing is taken on trust from the Phase 4 transcript.

## End-to-End Tests

**Not run.** Not required: the diff touches no auth file (confirmed below), so the stricter auth gate does not apply, and the acceptance criterion for this bug is a DB-down probe, which `e2e/` cannot express (globalSetup requires a reachable, seeded database). `grep -rl "/site/" e2e/` → `e2e/branded-signin.spec.ts`, `e2e/public-sites.spec.ts`; neither asserts a 500, and the DB-up behaviour of this surface is unchanged by construction (the diff adds only `catch` arms). The DB-up paths those specs cover are additionally covered by `sites.test.ts` against the real database, all 80 green. Recorded as a named limit, not a deferred advisory.

## Live Probe — re-run independently by QA (production build, unreachable DB)

Recipe executed exactly as specified: `rsync` of the worktree into the session scratchpad (outside the repo), `cp -al node_modules` (hardlinked — no symlink, so Turbopack font resolution is intact), scratch `.env.local` with `DATABASE_URL` / `DIRECT_DATABASE_URL` / `APP_DATABASE_URL` / `PLATFORM_DATABASE_URL` / `MIGRATE_DATABASE_URL` all at `postgres://…@localhost:59999/nonexistent` (port confirmed free via `lsof` beforehand), freshly generated throwaway `AUTH_SECRET`/`AUTH_TOTP_ENCRYPTION_KEY` (the worktree's real `.env.local` values were never read), `rm -rf .next && npm run build && PORT=3400 npm run start`.

```
GET /site/fpcw              → 404  0.122s   (warm repeat: 0.011s)
GET /site/fpcw/sitemap.xml  → 404  0.033s
GET /site/fpcw/assets/x     → 404  0.006s
GET /site/not-a-slug        → 404  0.012s   (warm repeat: 0.009s)
```

- **No 500 anywhere.** The Phase 1 reproduction (`/site/fpcw` and `/site/not-a-slug` both 500 through `authz.ts:521`) does not reproduce.
- **Body equality:** both page bodies are 13,602 bytes; after normalizing the echoed slug (`sed s/fpcw/SLUG/`, `sed s/not-a-slug/SLUG/`) `diff` reports **byte-identical**. The only pre-normalization difference is the slug inside Next's own RSC router-state payload — a string the client supplied in the request URL. Not an oracle.
- **Headers identical**, including status, CSP, `Cache-Control`, and `Vary` — only `Date` differs.
- **No leak:** `grep -inE "select |Failed query|params:|59999|⨯|Only plain objects"` over the full server log → **zero matches**. The `params: fpcw,1` leak Phase 1 caught live is gone, and the RSC-serialization crash ("Only plain objects…") does not appear, confirming Phase 3's prediction that it was a symptom of the uncaught throw.
- **Log lines are exactly the specified shape:**
  ```
  [flags] isFlagEnabled read failed; treating as disabled { key: 'sites.public_render' }
  [authz] publicOrgSummary read failed; treating as not found { slug: 'fpcw' }
  [authz] publicOrgSummary read failed; treating as not found { slug: 'not-a-slug' }
  ```
- **Limit I confirm independently, as the implementer named it:** in a *total* outage the flag read fails closed first, so `getPublishedSite()`'s and `resolvePublishedOrganization()`'s own outer `catch` blocks are never reached by this probe — no `[sites] … read failed` line appears in my log either. Those two catch blocks are proven by the mocked suite **and** by `sites.test.ts`'s three DB-backed cases running against a *real* Neon connection with `vi.spyOn(db, "execute")` failing only the deeper read — which is the partial-blip condition an env-var probe cannot construct. I consider that adequate: the deeper catches are exercised against the real driver and the real column contract, not only a self-agreeing mock.

Server stopped by the listening PID (`lsof -tiTCP:3400 -sTCP:LISTEN`, then `kill`; port confirmed freed — never `pkill -f`). Scratch copy deleted. `git status --short` and `git stash list` in the worktree afterwards are identical to the start state.

## Code Read — item 5 checks

| Check | Result |
|---|---|
| `.reason` references outside `sites.ts` | **Exactly one**: `page.tsx:254`. (`grep -rn "\.reason" src` also returns `roles/new/actions.ts:68,128`, `role-definitions.ts:495,813`, `rate-limit.ts:208`, `roll.ts:210,218` — all unrelated types, confirmed by reading their imports; none is a `GetPublishedSiteResult`.) `layout.tsx:56` and `sitemap.xml/route.ts:28` read only `.kind`, inheriting the fix, as designed. |
| `eslint-disable` added | None in the diff. |
| `console.log` in production paths | None in any touched file. `alert/confirm/prompt`: none. |
| Log line carries only `{ slug }` / `{ slug, key }` | Confirmed on all five. Stronger than specified: **no catch anywhere binds the error** — every arm is `catch {` or `.catch(() => …)`, so `err` is not in scope to be logged by accident. The only `catch (err: Error)` in the diff is in `page.test.tsx` capturing the `NOT_FOUND` message for the equality assertion. |
| `getPublishedSite()` docstring matches behaviour | **Yes.** The caveat sentence is gone; the restored claim ("never a 500", entire body one `try/catch`, only the outer catch sets `read_failed`) is literally true of the shipped body. |
| Enumeration safety by construction | `reason` changes only *which query is issued*, never the return. Asserted at `page.test.tsx:195` (both branches produce identical `NOT_FOUND`), and confirmed observationally by the byte-identical live bodies. |

## Feature-Gate Audit

**No protected routes touched.** This surface is anonymous by design (`(public)/site/[slug]`, "FULLY ANONYMOUS BY CONSTRUCTION"); the fix adds no route, no server action, and no new surface. No `hasFeature()` gate applies, and none was removed.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `GET /site/[slug]/assets/[key]` (modified) | n/a — anonymous by design | n/a | n/a — gated by `sites.public_render` flag inside `resolvePublishedOrganization()`, unchanged |
| `GET /site/[slug]/[[...path]]` (modified) | n/a — anonymous by design | n/a | n/a — gated by `sites.public_render`, unchanged |
| no new `"use server"` action | — | — | — |

**Auth gate:** the diff touches **no** auth file. `git diff --name-only main` plus untracked returns only the eight source files and the work-log; filtered against `^src/auth\.ts$|^src/app/\(auth\)/|^src/app/api/auth/|^src/lib/auth/` → empty. The stricter auth gate does not apply.

*(Note for the orchestrator: `git diff --name-only main...HEAD` is empty because **the branch carries no commits yet** — all work is uncommitted in the working tree. The real diff is `git diff main` + untracked. Nothing is wrong with the code; it means the `fix:` commit with its `Caught-By:` / `Discovered-In:` / `Work-Log:` trailers has yet to be written.)*

## Schema / RLS Audit

Not applicable — no migration, no DDL, no grant or policy change. I ran no DDL, no `ALTER ROLE`, and no `db:push` against `development`; the only writes were the DB-backed test suites' own fixture create/restore, which the task authorized.

## Regression Tests Added (by the implementer; verified by QA)

- `src/lib/sites-render-fail-closed.test.ts:56` — `presby_published_site()` read throws → `{ not_found, read_failed }` — guards the `sites.ts:356` crash.
- `src/lib/sites-render-fail-closed.test.ts:69` — same result for a real and a nonexistent slug — guards enumeration safety under a blip.
- `src/lib/sites-render-fail-closed.test.ts:82` — blob resolve throws → fail closed — guards the `sites.ts:362` crash.
- `src/lib/sites-render-fail-closed.test.ts:114`, `:151` — log line contains no `select` / `Failed query` / `params:` — guards the leak Phase 1 caught live.
- `src/lib/sites-render-fail-closed.test.ts:134` — flag off still yields a reason-less `not_found` (negative control; the only one green pre-fix).
- `src/lib/sites-render-fail-closed.test.ts:145` — `resolvePublishedOrganization` throws → `null` — guards Gap 1 (`sites.ts:446`).
- `src/lib/sites.test.ts:518`, `:530`, `:571` — the same three properties against a **real Postgres connection**, not a mock.
- `src/lib/authz.test.ts:482`, `:492` — `publicOrgSummary` throws → `null` + safe log — guards the `authz.ts:521` crash Phase 1 actually reproduced.
- `src/app/(public)/site/[slug]/[[...path]]/page.test.tsx:160`, `:173`, `:184`, `:195` — the `read_failed` skip, the two non-skip cases, and response equality across reasons — guards Gap 4 and the `reason`-must-not-vary-output invariant.
- `page.test.tsx:386`, `:603` — both `resolveLogoUrl` call sites degrade to `logoUrl: null` — guards Gap 3, separately per call site.
- `src/app/(public)/site/[slug]/assets/[key]/route.test.ts:65` — blob resolve throws → 404 + safe log — guards Gap 2.

All six reads named in Phase 1 have a test that I watched fail before the fix and pass after.

## Coverage on Critical Modules

| Module | Statements | Branches | Target | |
|---|---|---|---|---|
| `src/lib/permissions.ts` | **100%** | 100% | 100% | met |
| `src/lib/two-factor.ts` | **91.3%** | 100% | 90%+ | met |
| `src/lib/flags.ts` | **100%** | 100% | 100% | met |
| `src/lib/sites.ts` | **91.6%** (DB suite; 11.2% pure-only) | 81.8% | — | touched module, well covered |
| `src/lib/authz.ts` | **84.1%** | 76.7% | — | touched module |
| Overall (pure run) | 53.4% | 48.9% | 70% | below target, pre-existing and unchanged by this diff |

## Observations (not blocking; for Phase 6 / `docs/TODO.md`)

1. **`reason: "absent"` is declared but never produced.** `sites.ts:268` allows `"absent"`, yet no code path ever sets it — confirmed-absent returns omit `reason` entirely. Matches Phase 3's stated intent ("or no reason at all") and `page.test.tsx:184` covers the `"absent"` input defensively, so behaviour is correct; the union member is documentation rather than a reachable state. Worth a one-line comment or removal at some future touch.
2. **Two spillover call sites inherit the `publicOrgSummary` fix, both in the safe direction, neither tested for the new behaviour.** `authz.ts:495` (`resolveOrgContext`'s no-relationship path) now degrades a blip to `{ kind: "not-found" }` (404) instead of a 500 — consistent with DECISION-040's "the slug is nothing → 404", and it discloses strictly less. `global-nav.tsx:104` degrades to a missing org name. Both outside this bug's stated surface; flagged for the record so Phase 6 doesn't discover them as surprises.
3. **`submitSiteContactMessage` (`sites.ts:1238`) inherits the fix on its *resolve*, but its own `withTrustedOrgContext` insert remains uncaught** — a blip landing after the org resolves still throws out of the server action. The insert is a write, so it falls outside DECISION-154's "every anonymous **read**" wording; naming it so the next contributor doesn't assume the surface is uniformly wrapped.
4. **Test-naming convention:** the house suffix on this pipeline is the work-log path rather than "— regression for …". Several new cases (`sites-render-fail-closed.test.ts:69, :82, :134, :145, :151`; `page.test.tsx:173, :184, :195`) carry no regression marker at all. Readable and specific, so not a finding — but the standing convention says otherwise.
5. **The branch has no commits** (see Feature-Gate Audit note) — the `fix:` commit and its trailers are still outstanding at integration.

## Verdict

**PASS**

Every required check is green: typecheck, lint, all five tripwires, 4168/4168 tests with **zero skipped** against the live `development` branch, a QA-reproduced failing-first cycle for all five spec files (including the three DB-backed cases the implementer honestly flagged as unverified), a QA-reproduced production-build live probe showing four uniform 404s with byte-identical bodies and a leak-free log, exactly one `.reason` reference outside `sites.ts`, no `eslint-disable`, no `console.log`, no error object in any log line, and a docstring that is now true. No protected route or auth file was touched.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete — failing-first reproduced independently for all five spec files; the implementer's named `sites.test.ts` gap closed (80/80 against live `development`, and failing-first there too); full DB suite 4168/4168 with zero skips; live production-build probe re-run: four uniform 404s, byte-identical bodies, no SQL/params in the log | **PASS** | 2026-09-26 |

---

## Handoff

**Next: analyst (Phase 6).** The bug no longer manifests: `/site/<slug>` returns a generic 404 during a total database outage, byte-identical to a nonexistent slug, with no SQL or bound params on the server console. Phase 6 should confirm the user-facing outcome against Phase 1's description, and may want to rule on Observations 1–3 above (the unreachable `"absent"` variant, the two spillover call sites in `resolveOrgContext`/`global-nav`, and the still-unwrapped contact-message insert) as `SHIP WITH NOTES` follow-ups for `docs/TODO.md`. The orchestrator still owes the pipeline the `DECISION-154` entry, the TODO reconciliation, and the first commit on this branch (`fix:` with `Caught-By: agent-review`, `Discovered-In: Phase-5` of the flags pipeline, `Work-Log: 2026-09-26-public-render-blip`).



---

# Phase 6 — Shipped vs Intent (analyst)

*Recorded verbatim by the orchestrator, 2026-09-26.*

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> Every read Phase 1 actually reproduced live (and every sibling read it went looking for) now fails closed to the identical, leak-free, enumeration-safe 404 — confirmed by re-reading the diff line-for-line against the design doc, not just trusting QA's transcript — and the notes below are legitimate scope-boundary findings, not evidence the fix is incomplete.

## What's Working

- **The exact crash Phase 1 reproduced live is gone.** `src/lib/authz.ts`'s `publicOrgSummary()` — the function whose bare `db.select` printed `Failed query: select "name", "organization_type" from "organizations" where "organizations"."slug" = $1 limit $2` / `params: fpcw,1` to the console during Phase 1's probe — now wraps its entire body and returns `null` on any throw, logging only `{ slug }`. I read the diff directly; it matches Phase 3's Implementation Order step 4 verbatim, including the "never the caught error or its `.message`" discipline.
- **All six reads Phase 1 and the orchestrator's scope-widening named are wrapped, not just the three from the kickoff.** `getPublishedSite()`'s two previously-uncaught reads (`db.execute`, blob resolve), `resolvePublishedOrganization()`'s sibling `db.execute`, the assets route's own `getBlobStore().resolve()`, and both `resolveLogoUrl()` call sites all now degrade instead of throw. I confirmed each by reading the diff, not by re-deriving it from the work-log's own claims.
- **Enumeration safety (DECISION-040) is preserved by construction, not by caller discipline.** `reason: "read_failed"` has exactly one reference outside `sites.ts` — the `page.tsx` skip of the second doomed query — and both branches of that conditional still end at the identical `notFound()`. I grepped for `.reason` myself and got the same single hit QA reports (`page.tsx:254`).
- **The docstring lie is fixed.** `getPublishedSite()`'s comment no longer says "It is NOT yet true of the two reads below" — that sentence is gone, and the restored claim ("never a 500... ENTIRE BODY is one try/catch") is now literally true of the shipped body.
- **The log-leak Phase 1 caught is closed by construction, not just by test assertion.** Every catch arm in the diff is `catch {` or `.catch(() => ...)` — the caught error is never bound to a variable in any of the five new catch sites, so there is no code path that could accidentally log it later. This is stronger than "we tested the log line doesn't contain `select`" — the error object is structurally unreachable.
- **QA's verification is independently reproducible, not merely asserted.** I did not take the 4168/4168 and the live-probe transcript on faith; I re-read the actual diffs for `sites.ts`, `authz.ts`, `page.tsx`, and `route.ts` against Phase 3's Implementation Order and confirmed each matches, and I independently traced the two spillover call sites and the contact-form insert QA flagged as Observations 2–3.

## Intent-vs-Shipped Diff

- Phase 1 said: a public site visitor during a DB blip must see a generic 404, identical to a nonexistent slug, no 500, no SQL/params in the log. Shipped: confirmed live by QA on a production build (`next build && next start`) against an unreachable database — four requests (`fpcw`, `fpcw/sitemap.xml`, `fpcw/assets/x`, `not-a-slug`) all 404, page bodies byte-identical after normalizing the one client-supplied slug substring, headers identical apart from `Date`, zero `select|Failed query|params:` matches in the server log. **Matches.**
- Phase 1 said (Gap 4): `publicOrgSummary()` should arguably be skipped entirely on a DB-error `not_found` reason since there's nothing to summarize. Shipped: exactly that, via the internal `reason: "read_failed"` discriminant Phase 3 designed. **Matches**, and the design closes the gap by construction rather than by convention.
- Phase 1 said (Gaps 1–3): `resolvePublishedOrganization()`'s sibling read, the assets route's blob resolve, and `resolveLogoUrl()`'s call sites all needed the same treatment or an explicit deferral. Shipped: all three wrapped in this same pass, per the orchestrator's scope-widening ruling. **Matches — no deferral needed.**
- Phase 1 said: the DB-up behavior of `/site/<slug>` must be unchanged. Shipped: QA confirms the diff "adds only `catch` arms" and that no existing e2e spec (`branded-signin.spec.ts`, `public-sites.spec.ts`) asserts a 500 or otherwise depends on the changed code paths; the 80 DB-backed `sites.test.ts` cases pass live. **Matches**, though note this is asserted rather than exhaustively re-derived by me — I accept QA's grep-based confirmation as adequate given the diff shape (pure additive `try/catch`, no changed happy-path logic, confirmed by my own read of the diffs above).
- Phase 1's adversarial pass asked for uniform timing, not just uniform status, across five cases. Phase 3 explicitly ruled against adding a timeout (correctly, in my judgment — a hand-tuned timeout trades a real 3-second cold-start unpleasantness for a worse failure mode, a false-negative 404 on a genuinely slow-but-live tenant, which is a bigger enumeration-safety risk than a slow correct answer). **Acceptable drift**, reasoned explicitly rather than silently dropped, and Phase 1's own concern was about the *property* (no oracle), which QA's live probe confirms holds (`fpcw` and `not-a-slug` both fail identically, no slug-dependent branching in the fixed code).

## Edge Cases

- Empty state: not applicable — no new UI state, unchanged 404 page.
- Failure microcopy: **pass** — the rendered 404 is the existing generic not-found page, unchanged in appearance; the *only* change is that it now renders where a 500/stack-trace/dev-overlay used to render. No user-facing microcopy needed authoring since none changed.
- Permission gate: not applicable — this surface is intentionally identity-blind by design; no permission gate exists or should exist here.
- Audit event: not applicable — no security-sensitive mutation on this surface (anonymous reads only); correctly identified as such in both Phase 3 and Phase 4.
- Mobile (360px): not applicable — no visual/layout change; the 404 page's rendering is untouched.

## Ruling on QA's five observations

1. **`reason: "absent"` never produced — confirmed, accept as-is, no fix required before ship.** I grepped independently: the only occurrences of the string `"absent"` in `src/` are the type declaration (`sites.ts:268`) and one defensive test input (`page.test.tsx:185`); no production code path ever sets it. This is documentation of an intended-but-currently-empty union member, not a bug — `page.tsx` correctly treats "absent or missing `reason`" and `"absent"` identically, so there's no branch relying on a value that never arrives. Worth a one-line comment or removal at a future touch of this file; not worth reopening this pipeline for.
2. **The two spillover call sites (`resolveOrgContext()`, `global-nav.tsx`) — confirmed, both in the safe direction, correctly out of this bug's stated surface.** I read both. `resolveOrgContext()`'s no-relationship branch (`authz.ts:495`) now degrades a blip to `{ kind: "not-found" }` instead of a 500 — strictly safer, and consistent with DECISION-040's "the slug is nothing → 404" framing (it's `(org)`-tree access-denied logic, a different surface than the public site render path this pipeline scoped to). `global-nav.tsx:104` already had its own defensive `try/catch` around this call *before* this fix (`currentName = null` on throw), so it was already safe independent of `publicOrgSummary()`'s own new behavior — this fix makes it doubly safe, not newly safe. Neither needs a test added under this pipeline's stated surface; correctly flagged as "for the record," not as a defect.
3. **`submitSiteContactMessage`'s unwrapped insert — confirmed, real, correctly scoped out by wording, but not correctly scoped out by risk.** I read the function: `resolvePublishedOrganization()` inherits the fix, but the subsequent `withTrustedOrgContext(...).insert(...)` is a bare `await` with no catch. QA is right that DECISION-154's text says "every anonymous **read**," so this literally isn't a violation of what was decided — but a mid-request blip after the org resolves still throws an uncaught error out of a Server Action, and Next's default handling of that in production redacts the *client-facing* message but still calls its own console logger with the full error server-side — meaning the same `Failed query`/`params:` leak Phase 1 caught on the read path is still reachable on this write path, just via a form submit instead of a page load. This is a real, if narrower, instance of the same underlying problem class, on a path this pipeline's own Phase 1 named as "caller-shape 3" without flagging its own write. It should not block this ship — it's outside the diagnosed and fixed surface, and re-scoping now would reopen Phase 1 mid-pipeline — but it is not a cosmetic nit either.
4. **Test-naming convention — confirmed, accept as a style deviation, not a defect.** Several new test cases lack the house "— regression for …" suffix. Names are specific and readable; not worth a rework loop-back for a naming convention on files no reviewer will misread.
5. **No commits yet — acknowledged, not a Phase 6 finding.** This is squarely the orchestrator's remaining task (the `fix:` commit with `Caught-By:`/`Discovered-In:`/`Work-Log:` trailers), not a gap in the shipped code.

## Proposed `docs/TODO.md` lines (ready to paste at integration)

```
- [ ] `submitSiteContactMessage`'s trusted-org-context insert (src/lib/sites.ts:~1262) is the one write on the public-site anonymous surface that still throws uncaught on a mid-request DB blip — a Server Action error in this shape redacts the client response but still logs the full SQL/params server-side, the same leak class DECISION-154 fixed on the read side. Wrap it in the same fail-closed discipline (a `SubmitContactMessageResult` variant or a generic failure message) — follow-up from `2026-09-26-public-render-blip` Phase 6, Observation 3.
- [ ] `GetPublishedSiteResult`'s `reason: "absent"` union member is declared but never produced by any code path (confirmed by grep, `2026-09-26-public-render-blip` Phase 6) — either wire a real producer or remove the member at the next touch of `src/lib/sites.ts`.
```

Both are small, named, and independently actionable — appropriate for `SHIP WITH NOTES` rather than a blocking loop-back.

## Rule 13 (what's-new advisory)

**No.** This is a reliability fix on a failure path a real visitor only ever sees during a database outage; there is no new member-visible *feature* or behavior on the happy path, and the fix's entire value is invisible in normal operation (the page looked the same to a visitor whether the outage-path bug existed or not — the difference is a stack trace vs. a 404 during an incident). Matches Phase 3 Implementation Order step 10's own ruling; I concur.

## Rule 14 (functionality map)

**No.** No surface was added, materially changed, or removed — `/site/<slug>`'s described behavior (render the published site or 404) is identical before and after; only its failure-path implementation changed. The functionality map documents what the surface does, not its internal error handling.

## Rule 15 (architecture.md)

**No.** No new subsystem, no changed data flow shape, no changed deployment/runtime shape, and no reversal of a documented decision. This is an in-place hardening of six existing reads to match a pattern the codebase already used in three other places — exactly the kind of feature work Rule 15 says should *not* trigger an architecture.md edit.

## Draft 0.26.3 release-note paragraph (fix class, non-engineer audience)

> **Fixed:** a rare issue where, during a brief database connectivity blip, a congregation's public website could show a technical error page instead of the normal "page not found" message. This has been corrected — the site now always shows the same friendly not-found page in that situation, matching what visitors already saw for a mistyped web address.

## Follow-Ups (SHIP WITH NOTES)

- Wrap `submitSiteContactMessage`'s insert in the same fail-closed discipline (TODO line drafted above).
- Resolve or remove the never-produced `reason: "absent"` union member at a future touch of `src/lib/sites.ts` (TODO line drafted above).

## Red Flags (if NEEDS REWORK)

None — no red flags. Nothing here rises to a level that should reopen Phase 3 or 4.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete — re-read Phases 1–5 in full, independently re-verified the diff against Phase 3's Implementation Order line-by-line (all four production files), independently confirmed QA's five observations by reading the code myself rather than trusting the transcript, drafted two TODO lines and the 0.26.3 release-note paragraph | **SHIP WITH NOTES** | 2026-09-26 |

**Handoff:** orchestrator. Remaining integration tasks, in this pipeline's own stated order: (1) apply the `DECISION-154` entry as proposed in Phase 3 — I confirmed at Phase 6 that it still accurately describes what shipped, no edits needed; (2) apply the two `docs/TODO.md` lines drafted above (this pipeline closes clean — no open line to move to Done, since no pre-existing backlog entry named this bug); (3) write the first commit on `pipeline/render-path` (`fix:` prefix, `Caught-By: agent-review`, `Discovered-In: Phase-5` — this bug was discovered during the `2026-09-26-flags-fail-closed` pipeline's own Phase 5/6, not by an automated test or in production — `Work-Log: 2026-09-26-public-render-blip`); (4) no `feedback` row to mark (Rule 12 — this did not originate from in-app member feedback, confirmed by the work-log's Source block being absent); (5) no what's-new entry, no functionality-map edit, no architecture.md edit, per the rulings above. Pipeline closes at this SHIP WITH NOTES."}],"container":null,"stop_reason":"end_turn","stop_sequence":null,"stop_details":null,"usage":{"input_tokens":2,"cache_creation_input_tokens":841,"cache_read_input_tokens":78993,"output_tokens":5173,"output_tokens_details":{"thinking_tokens":0},"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":841},"inference_geo":"not_available","iterations":[{"input_tokens":2,"output_tokens":5173,"cache_read_input_tokens":78993,"cache_creation_input_tokens":841,"cache_creation":{"ephemeral_5m_input_tokens":841,"ephemeral_1h_input_tokens":0},"type":"message"}],"speed":"standard"},"diagnostics":null,"context_management":null},"apiBlockIndex":0,"requestId":"req_011CfScFaeVf5bpebLut5vcn","attributionAgent":"analyst","type":"assistant","uuid":"601637e8-b508-4e5d-ac87-b6adc9ed14d4","timestamp":"2026-09-26T19:33:33.851Z","effort":"high","perTurnEffort":null,"userType":"external","entrypoint":"cli","cwd":"/Users/cshenso/git/presby-platform/presby","sessionId":"b08e6db7-b5b1-4a1b-b94f-75e0928bed80","version":"2.1.273","gitBranch":"main","slug":"warm-honking-hartmanis"}

### Orchestrator closure (2026-09-26)

Shipped as v0.26.3 (`fix(sites):`). DECISION-154 recorded; the flags follow-up item (1) closed in `docs/TODO.md`; Phase 6 notes added there as open lines. No schema change, so `development` needed no migration; `test-rls.sql` unaffected.
