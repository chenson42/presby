# ACCESS_DENIED / ACCESS_GRANTED audit events — Work Log

> **Slug:** `2026-07-01-access-denied-audit`
> **Surface:** access-pending flow + admin role-assignment actions
> **Permission(s):** none — audit only
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Full (small — phases expected brief)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY FOR DESIGN | 2026-07-01 |
| 2 — Architectural review | architect | Complete | Approved | 2026-07-01 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-07-01 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-07-01 |
| 5 — Verification | qa | Complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-01 |

---

## Intent (harvest Tier 3 #23 code half, 2026-07-01)

sagacraft's lesson (`e4a0762`, "bug #16"): its audit catalog *documented*
signup denied/granted events but the callback never wrote them, so the most
valuable admin question — "who requested access and bounced?" — had no
answer. The starter has the same blind spot: a user bounced to
`/access-pending` leaves no trace.

**Requested change:** write an `ACCESS_DENIED` audit event when an
authenticated-but-unauthorized user is bounced to `/access-pending`, and an
`ACCESS_GRANTED` event when an admin's role assignment first gives a user
access. Use `recordAudit()` (shipped 2026-07-01).

Analyst attention — the hard part is WHERE the denied event can be written:
the bounce decision happens in `src/proxy.ts` (Edge runtime — cannot import
`@/lib/db` per the invariant). Options to weigh: (a) write it from the
`/access-pending` page's RSC render (a mutation-during-render smell — Next
may double-invoke; weigh against a fire-and-forget recordAudit), (b) a
server action invoked from a client effect on the page (clean but adds an
island), (c) accept a route-handler beacon. Also: dedup/noise control (a
user refreshing /access-pending shouldn't spam rows — consider
once-per-session or rate-limited writes); ACCESS_GRANTED is simpler (the
existing `assignRoleAction` already audits USER_ROLE_ASSIGNED — decide
whether a distinct ACCESS_GRANTED event is additive signal or duplication —
possibly the right call is ONLY adding ACCESS_DENIED and letting
role-assignment stand); the audit-exempt vs audited classification.

---

# Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

## VERDICT

READY FOR DESIGN

## ONE-LINE TAKE

> Write a single `ACCESS_DENIED` audit row from the `/access-pending` RSC render each time an authenticated user is bounced there; skip `ACCESS_GRANTED` because `USER_ROLE_ASSIGNED` already covers it; have the proxy pass the denied path as `?from=` so the event carries useful context.

## User Verbs

This is an infrastructure change — no new user action triggers it. The surfaces that observe the output:

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin | reads audit log; sees `access.denied` rows with `attemptedPath` metadata | on demand |
| System | writes `ACCESS_DENIED` row automatically when RSC renders | per page load of `/access-pending` |

There is no anonymous-visitor surface: the proxy already redirects unauthenticated requests to `/signin` before they can reach `/access-pending`.

## Flows

**Flow 1 — Bounce and audit:**
Authenticated user requests a protected route (e.g. `/admin/users`) → proxy checks features, finds the user lacks the required feature → proxy redirects to `/access-pending?from=%2Fadmin%2Fusers` → `/access-pending` RSC renders → `recordAudit(ACCESS_DENIED, { attemptedPath: "/admin/users" })` fires fire-and-forget → audit row written with actor (userId + email), IP, user-agent, and `attemptedPath` → user sees "Access pending" copy.
- Failure (DB down): `recordAudit` swallows the error with `console.error`; the page still renders; the user is never impacted. The bounce UX is silent-safe by design.
- Failure (missing `from` param): if the proxy somehow omits `?from=`, the audit row is written with `attemptedPath: null`; still useful for the "who was bounced" question.

**Flow 2 — Admin reads audit log (future — out of scope for this feature):**
The `ACCESS_DENIED` rows appear in the `audit_events` table. They are visible today via direct DB query. A future admin UI viewer (Backlog: "Audit log viewer under /admin/audit") will surface them. This feature only produces the rows.

## Placement Decision

Three options were weighed:

**Option A — RSC render (recommended).** Call `recordAudit()` directly inside the `access-pending` Page component during render.
- Double-invoke concern is RSC-irrelevant: React Strict Mode double-invokes only apply to client components (`useState`/`useEffect`). RSC render functions run once per request in both development and production. `/access-pending` is auth-gated (session required) so it is never statically pre-rendered or cached across users.
- `auth()` and `headers()` are available inside RSC, giving the audit write full actor + IP + user-agent context.
- `recordAudit()` already swallows all failures — it never throws, never blocks render.
- Semantic fit: this is "record that this render happened," which is a legitimate RSC concern, not a user-triggered mutation.
- Verdict: the mutation-during-render smell does not apply here. The write has no user-visible side effect, no return value, and no risk of state divergence.

**Option B — client effect + server action.** Adds a client island (`'use client'`) with `useEffect` that calls a server action.
- Adds network round-trip, client JS overhead, and a new island purely for a fire-and-forget write.
- The server action would re-call `auth()` to verify the actor — redundant when the RSC already has the session.
- Over-engineered for this feature size.

**Option C — route-handler beacon.** `/api/audit/access-denied` endpoint called from the client.
- The proxy already skips all `/api/` paths (`pathname.startsWith("/api/") → NextResponse.next()`), so no proxy interaction. But requires client JS and a fetch/sendBeacon call, plus a new route file.
- Over-engineered for this feature size.

**Recommendation: Option A (RSC render).** Proportionate to the feature.

## Permissions & Flags

- **Permission(s):** none — audit is system-internal; no FEATURES key controls it.
- **Flag(s):** not needed — no staged rollout required for an audit write.
- **New AUDIT_ACTIONS key to add:** `ACCESS_DENIED: "access.denied"` in `src/lib/audit.ts`. This is the only catalog change needed.

## Metadata: the `from` parameter

The proxy currently redirects to `/access-pending` with no context:
```
NextResponse.redirect(new URL("/access-pending", req.url))
```
The `pathname` of the denied request is available at the point of redirect. The proxy should add `?from=${encodeURIComponent(pathname)}` so the RSC can include `attemptedPath` in the audit metadata. This change is minimal (one line in `proxy.ts`) and follows the existing pattern used for `callbackUrl` on the `/signin` and `/totp` redirects.

## Noise Control Position

One `ACCESS_DENIED` row per page load is the right granularity. Each row answers: "this user hit the wall at this time, attempting this path." A user who refreshes `/access-pending` three times produces three rows — which is accurate signal (they tried three times). Refresh-spam by a stuck user is bounded in practice: they either get a role assigned or give up.

A per-user-per-day dedup would require a DB read before every write, adding latency for marginal benefit. The in-memory rate limiter (`src/lib/rate-limit.ts`) is not suitable here because it would live in the RSC render path, compounding the mutation-during-render concern without a clean abstraction. Defer noise-limiting to a follow-up if the audit log shows real spam in practice.

## ACCESS_GRANTED: skip it

`USER_ROLE_ASSIGNED` (written by `assignRoleAction` in `src/app/(admin)/admin/users/actions.ts`) already records the admin, the target user, and the role granted, with timestamp and IP. An `ACCESS_GRANTED` event would require detecting the specific transition from zero-roles to one-or-more-roles (a pre-check DB read), and its information would largely duplicate what `USER_ROLE_ASSIGNED` already answers. The audit question "when did this user get access?" is already answered by querying `USER_ROLE_ASSIGNED` for the user. Skip `ACCESS_GRANTED`.

## Gaps the Request Didn't Address

- **`?from=` is user-visible and user-manipulable (adversarial note).** A user can hand-craft `/access-pending?from=/some-fake-path` and inject a fake `attemptedPath` into their own audit record. This cannot grant access or escalate privileges — it only poisons their own audit row. Risk is low; document in code comments that `from` is advisory metadata, not a verified claim. No mitigation required beyond the comment.
- **The `/access-pending` page currently has no `searchParams` prop.** The RSC must be updated to accept `searchParams: { from?: string }` in its props signature. Straightforward, but the tech-lead should note it in Phase 3.
- **`check:audit` tripwire scope.** `recordAudit()` called from a page component (not an `actions.ts` file) is outside the tripwire's scan path. This is already established precedent (see `RATE_LIMIT_BLOCKED` and `EMAIL_QUEUE_PERMANENT_FAILURE` comments in `audit.ts`). The audit write is correct; the scan exclusion is intentional. Phase 4 implementer should add a matching comment in `access-pending/page.tsx`.

## Out of Scope (confirm with user)

- Admin UI viewer for `ACCESS_DENIED` events — already tracked in Backlog ("Audit log viewer under /admin/audit"). This feature produces rows; the viewer ships separately.
- Notifying the bounced user by email ("your access request has been received") — not requested, likely a different feature.
- Notifying admins by email when a new user hits `/access-pending` — not requested.

## Open Questions

- None. The placement, noise-control, and GRANTED decisions are taken above. The tech-lead can proceed to Phase 3 directly.

### What I Did

- Read `src/proxy.ts` to understand the bounce mechanics and confirm no `?from=` param is currently passed.
- Read `src/app/access-pending/page.tsx` to confirm it is a plain RSC with no props today.
- Read `src/lib/audit.ts` to confirm `recordAudit()` swallows failures, calls `auth()` and `headers()` internally, and has `import "server-only"` (RSC-safe, Edge-unsafe — consistent with the invariant).
- Read `src/app/(admin)/admin/users/actions.ts` to confirm `USER_ROLE_ASSIGNED` already covers the grant event.
- Weighed three placement options against Next 16 RSC semantics and the mutation-during-render concern. RSC wins on simplicity and proportionality.
- Confirmed `ACCESS_GRANTED` is duplication of existing coverage.

### Outputs

- `docs/work-log/2026-07-01-access-denied-audit.md` — Phase 1 section appended, status updated to Complete / READY FOR DESIGN
- `docs/TODO.md` — item moved from Backlog to In Flight

---

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** complete

### Summary

Approved. The analyst's placement recommendation (RSC render, Option A) is correct and is not in tension with the BUG-2 precedent — the two side effects belong to categorically different classes. The five rulings below advance to Phase 3 with no revision required.

### Rulings

**Ruling 1 — Placement: RSC render (Option A) is approved.**

The BUG-2 (fresh-recovery-codes) fix moved a side effect out of RSC render, but the reason was specific: Next.js 16 explicitly prohibits **cookie and header mutations** (`cookies().set()`, `cookies().delete()`, `headers().set()`) inside RSC render — these are browser-state writes that Next.js enforces must happen only inside Server Actions or Route Handlers. That prohibition does not apply to server-side DB writes. RSC render is specifically designed to perform server-side I/O — DB reads and DB writes — as a first-class concern. `recordAudit()` is a server-side DB write hidden behind `import "server-only"`. There is no Next.js 16 restriction that prevents it from being called during RSC render.

The double-invoke question: React Strict Mode's double-invocation applies only to client-component lifecycle hooks (`useState`, `useMemo`, `useReducer`, `useEffect`). Async RSC render functions are not subject to this behavior. In both development and production, the `/access-pending` page renders exactly once per request. Additionally, the page is auth-gated and never statically pre-rendered or cached across users.

**The divergence from BUG-2 is justified, not inconsistent.** BUG-2: a Next.js–prohibited browser-state mutation → must move to Server Action. This feature: a permitted server-side DB write → stays in RSC render. Option B (client effect + server action) and Option C (route-handler beacon) are over-engineered for a fire-and-forget write that already has a safe call site.

One obligation the tech-lead must carry forward: add a comment in `access-pending/page.tsx` at the `recordAudit()` call site explaining that this is a permitted server-side write (not a cookie/header mutation) and is outside the `check:audit` tripwire's scan scope (which covers only `src/app/**/actions.ts`). This follows the `RATE_LIMIT_BLOCKED` comment precedent in `src/lib/audit.ts`.

**Ruling 2 — Noise control: defer; one row per page load is correct.**

A pre-write dedup (DB read before every insert) adds latency for marginal benefit. The in-memory rate limiter (`src/lib/rate-limit.ts`) is process-local, not suitable for multi-instance deployments, and is designed for user-action rate limiting — importing it into an RSC render side effect creates an abstraction leak with no clean key-management story. Multiple rows per user per session carry real forensic signal (how many times did this user hit the wall before an admin noticed?). If spam volume becomes a real operational problem after the feature ships, the correct mitigation is a DB-side partial index or a WHERE NOT EXISTS guard — a future targeted decision. No noise control in this iteration.

**Ruling 3 — ACCESS_GRANTED: skip it (endorse analyst).**

`USER_ROLE_ASSIGNED` already records the admin actor, target user, role granted, timestamp, and IP. An `ACCESS_GRANTED` event would require a pre-check DB read (zero-roles → one-or-more-roles transition detection) and would produce a derived event duplicating the underlying fact. The audit question "when did this user get access?" is answered by querying `USER_ROLE_ASSIGNED` for the user. Skip `ACCESS_GRANTED`. One new key only.

**Ruling 4 — Metadata: `?from=` in proxy redirect; `attemptedPath` in audit metadata.**

The proxy change is load-bearing for the audit row's forensic value — a row that records "user X hit the wall" without "at which path" is materially less useful. The one-line change to `src/proxy.ts` line 59 follows the established pattern already used at lines 33 and 49 (`callbackUrl` for sign-in and TOTP redirects):

```typescript
// Before
return NextResponse.redirect(new URL("/access-pending", req.url));

// After
const dest = new URL("/access-pending", req.url);
dest.searchParams.set("from", pathname);
return NextResponse.redirect(dest);
```

The adversarial caveat (user can hand-craft `?from=/fake-path`) is correctly categorized as low-risk — it cannot grant access or escalate privileges. A code comment marking `from` as advisory metadata, not a verified claim, is sufficient mitigation.

The tech-lead must note that in Next.js 15/16 `searchParams` in page components is a `Promise` and must be awaited: `const { from } = await searchParams`. The `access-pending/page.tsx` currently has no props at all; the signature change to accept `{ searchParams: Promise<{ from?: string }> }` is the only structural change to the component signature.

**Ruling 5 — New AUDIT_ACTIONS key(s): one key, audited, comment required.**

Add one key to `AUDIT_ACTIONS` in `src/lib/audit.ts`:

```typescript
ACCESS_DENIED: "access.denied",
```

This is **audited, not audit-exempt**. `access.denied` is security telemetry — evidence that an authenticated user was turned away at the authorization gate. This is precisely the class of event the audit log exists to capture. The fact that it is written from a page component rather than an `actions.ts` file means `check:audit` will not see the call site (the tripwire scans only `src/app/**/actions.ts`). This is correct and intentional — the page IS the audit site. Add a comment in `audit.ts` mirroring the `RATE_LIMIT_BLOCKED` pattern:

```
// Access gate — written from src/app/access-pending/page.tsx during RSC
// render. The check:audit tripwire scans only src/app/**/actions.ts and
// will not see this write. That is intentional — the page component is
// the audit site, not an actions file.
```

**Ruling 6 — Edge invariant: confirmed, no risk.**

`src/proxy.ts` has no import of `@/lib/db`, `@/lib/audit`, or any module that carries `import "server-only"`. The proposed change to `proxy.ts` adds exactly one line: `dest.searchParams.set("from", pathname)` — it never calls `recordAudit()`. `recordAudit()` is called only from the `/access-pending` page component, which runs in the Node runtime. The `import "server-only"` guard in `audit.ts` provides a build-time bundler assertion that would hard-fail the build if `audit.ts` were ever imported from an Edge context. Zero risk of DB access leaking into Edge.

**No new dependencies.** `recordAudit()` and `AUDIT_ACTIONS` already exist in `src/lib/audit.ts`. No npm package additions.

**DECISION entry: not required.** The pattern of writing audit events from non-actions.ts call sites is already documented in `audit.ts` comments (`RATE_LIMIT_BLOCKED`, `EMAIL_QUEUE_PERMANENT_FAILURE`). No new convention is established by this feature; it extends an existing documented pattern to a new call site.

### What I Did

- Read `src/proxy.ts` — confirmed line 59 bare redirect; `pathname` available; no `?from=` today; established pattern at lines 33 and 49.
- Read `src/lib/audit.ts` — confirmed `import "server-only"` Edge guard; `import "@/lib/db"` node-only dependency; `recordAudit()` swallows all failures; existing comment pattern for non-actions.ts audit sites (`RATE_LIMIT_BLOCKED`, `EMAIL_QUEUE_PERMANENT_FAILURE`).
- Read `src/app/access-pending/page.tsx` — confirmed plain RSC, no props, no `searchParams`.
- Read `docs/work-log/2026-07-01-2fa-fresh-codes-rsc-cookie.md` — confirmed BUG-2's prohibition was specific to cookie/header browser-state mutations (Next.js 16 enforcement), not DB writes; the precedent is categorically inapplicable to `recordAudit()`.
- Read `docs/decisions.md` (full) — DECISION-023 is highest; no concurrent decision covers this pattern; no new DECISION entry warranted.
- Verified all six ruling dimensions from the brief.

### Outputs

- `docs/work-log/2026-07-01-access-denied-audit.md` — Phase 2 section appended; Per-Phase Status Phase 2 row updated to Complete / Approved / 2026-07-01
- `docs/TODO.md` — In Flight line updated to "Phase 2 complete, advancing to Phase 3"
- No `docs/decisions.md` entry (existing pattern, no new convention)

---

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

Three files change. One new AUDIT_ACTIONS key is added to `src/lib/audit.ts`. One line is added to `src/proxy.ts` to carry the denied path into the redirect. The `src/app/access-pending/page.tsx` RSC is updated to accept `searchParams`, await it, and call `recordAudit()` with `ACCESS_DENIED`. No new dependencies, no schema changes, no new permissions or flags — this feature only extends an established pattern to a new call site.

### What I Did

#### 1. `src/lib/audit.ts` — New key + comment

Add to `AUDIT_ACTIONS`, after the `EMAIL_QUEUE_PERMANENT_FAILURE` entry:

```typescript
// Access gate — written from src/app/access-pending/page.tsx during RSC
// render, not from an actions.ts file. The check:audit tripwire scans only
// src/app/**/actions.ts and will not see this write. That is intentional —
// the page component is the audit site. This follows the RATE_LIMIT_BLOCKED
// and EMAIL_QUEUE_PERMANENT_FAILURE precedents above.
ACCESS_DENIED: "access.denied",
```

The comment mirrors the `RATE_LIMIT_BLOCKED` and `EMAIL_QUEUE_PERMANENT_FAILURE` pattern exactly.

#### 2. `src/proxy.ts` — One-line `?from=` addition (~line 59)

The existing bare redirect:

```typescript
return NextResponse.redirect(new URL("/access-pending", req.url));
```

Becomes (two lines — dest extracted so the param can be set):

```typescript
const dest = new URL("/access-pending", req.url);
dest.searchParams.set("from", pathname);
return NextResponse.redirect(dest);
```

`pathname` is already in scope from `const { pathname } = req.nextUrl` at line 24. This mirrors the `callbackUrl` pattern used at lines 33 and 49. No other change to `proxy.ts`.

#### 3. `src/app/access-pending/page.tsx` — Props + audit call

The page currently takes no props. The updated signature:

```typescript
export default async function AccessPending({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  // Permitted server-side DB write during RSC render. This is NOT a cookie
  // or header mutation (which Next.js 16 prohibits in RSC). recordAudit()
  // performs a server-side DB insert — a first-class RSC I/O concern.
  // The check:audit tripwire scans only src/app/**/actions.ts; this call
  // site is intentionally outside that scope (see AUDIT_ACTIONS.ACCESS_DENIED
  // comment in src/lib/audit.ts).
  //
  // NOTE: `from` is advisory metadata sourced from the ?from= query param
  // set by src/proxy.ts. It is not a verified claim — a user could hand-craft
  // /access-pending?from=/fake-path. The only consequence is a misleading
  // attemptedPath value in their own audit row; no privilege escalation is
  // possible.
  await recordAudit({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    metadata: { attemptedPath: from ?? null },
  });
  // ... existing JSX unchanged
}
```

**`await` vs `void` ruling (see below).**

The `actor` field is omitted — `recordAudit()` calls `auth()` internally to resolve the signed-in user from the JWT. The page is auth-gated (proxy already confirmed a session exists before redirecting here), so the session is present and the actor is always resolved correctly. Passing an explicit `actor` override would require a redundant second `auth()` call in the page; omitting it is the correct pattern.

#### `await` vs `void` ruling

**Rule: `await` the call.**

On Vercel (and Next.js Serverless Functions generally), an un-awaited promise that is still pending when the RSC render function returns can be abandoned before it resolves — the function boundary is the lifetime boundary. `void recordAudit(...)` would start the DB insert but give the runtime no obligation to wait for it; under load or on a cold-start path, the INSERT may never complete.

`recordAudit()` is designed to swallow all failures — it never throws, and its `try/catch` guarantees it always resolves. Awaiting it does not risk hanging the render. The cost is the DB insert latency (a single INSERT on a pooled Neon connection: single-digit milliseconds in practice). That is the correct tradeoff: guaranteed audit write at negligible render cost, versus a probabilistic write that silently drops on Vercel's function-exit boundary.

**Use `await`. Do not use `void`.**

#### 4. Regression tests

**Unit tests (Vitest)**

`src/app/access-pending/page.tsx` is an RSC — mounting it in Vitest is not practical without a full Next.js test environment. The `recordAudit()` function itself is already covered by the audit-helper implementation. No new Vitest unit tests are required. The correct coverage vehicle for this RSC behavior is the e2e suite.

If the implementer wants a thin Vitest layer: the only testable unit is a hypothetical extracted helper such as `resolveAttemptedPath(from?: string): string | null` — but the logic (`from ?? null`) is too trivial to warrant extraction. Do not add a unit test for the sake of having one.

**E2E tests (Playwright) — extend `e2e/role-boundaries.spec.ts`**

Test 2 ("member navigating to /admin is redirected to /access-pending") already drives this exact path. Extend it to add a `?from=` URL assertion:

```typescript
// Test 2 — Member: /admin is blocked → /access-pending?from=%2Fadmin
test("member navigating to /admin is redirected to /access-pending with from param", async ({
  page,
}) => {
  test.skip(!HAVE_MEMBER, "SEED_MEMBER_EMAIL/PASSWORD not set");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/access-pending/);
  const url = new URL(page.url());
  expect(url.searchParams.get("from")).toBe("/admin");
});
```

This replaces or extends the existing Test 2 assertion. The `from` param check is cheap (pure URL assertion, no server round-trip), directly verifies the proxy change, and is meaningful: if the proxy line is missing or the param name changes, the test fails immediately.

**DB-row assertion (whether to add one)**

A DB-row assertion — querying `audit_events` after the page load and asserting a row with `action = "access.denied"` and `metadata.attemptedPath = "/admin"` — would be the highest-fidelity end-to-end check. It requires:

1. A direct DB connection in the test (Neon pooled URL via `process.env.DATABASE_URL`).
2. Cleanup between runs (or a unique identifier per test run to isolate the assertion).
3. The seeded member user's `id` to filter by actor.

The cost is non-trivial for a feature this small. The `from` URL assertion already verifies that the proxy passes the path, and `recordAudit()` is covered by its own design contract (swallows failures, tested at the helper level). The DB-row check is a nice-to-have, not a blocker. **Defer the DB-row assertion to the audit-log-viewer feature** — when the admin UI is built, the e2e for that feature will naturally drive and assert audit row creation. Do not add the DB assertion in this iteration.

### Phase 4 gate — e2e suite required

`src/proxy.ts` is not in the auth-touching file list (`src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/`, `src/lib/auth/`). However, `proxy.ts` IS the route gate — it enforces the auth + 2FA + feature-access rules for every protected request. A change to it can silently break the redirect paths that `role-boundaries.spec.ts` exercises. The full e2e suite (`npm run test:e2e`) against a live dev server is required before Phase 5 can begin. This is a stronger requirement than the auth-file list strictly mandates, but is correct given the blast radius of a broken proxy.

**Dev server conflict advisory for the implementer:** The feedback pipeline is currently in Phase 5 (qa), which may have a dev server running on port 3000. Before running `npm run test:e2e` for this feature:

1. Check `lsof -i :3000 -i :3100` — if port 3000 is occupied by the QA session's server, use `PORT=3100 npm run dev` and set `PLAYWRIGHT_BASE_URL=http://localhost:3100` (or the equivalent Playwright `baseURL` in the config) for this feature's test run.
2. The two pipelines test different things (feedback tests a new UI page; this tests proxy redirect + URL params) — they do not conflict on test content, only on port.
3. Alternatively, wait for the QA session on the feedback pipeline to complete before starting this feature's Phase 4 dev server.

### Outputs

- `docs/work-log/2026-07-01-access-denied-audit.md` — Phase 3 section appended; Per-Phase Status Phase 3 row updated to Complete
- `docs/TODO.md` — In Flight line updated

### Open questions / handoff notes

- **Implementer: full-stack-developer.** Three files, tightly coupled, ~30 lines total across all changes. Splitting between api-developer and ux-developer adds handoff overhead for a change this small.
- The four change points are fully specified above. The implementer has no design decisions to make — execute the spec.
- Dev server port conflict: check for the feedback QA's server on port 3000 before starting (see Phase 4 gate advisory above).
- The e2e `?from=` assertion should extend (not replace) Test 2 in `role-boundaries.spec.ts`, or be added as a new named test alongside it — whichever keeps the file readable.
- No `docs/decisions.md` entry required — the non-actions.ts audit-site pattern is already documented in `audit.ts` comments.

---

### Open Questions / Handoff Notes for Tech-Lead (Phase 3)

- `searchParams` is a `Promise` in Next.js 15/16 — the page signature is `{ searchParams: Promise<{ from?: string }> }` and the value must be awaited before use.
- Comment obligation at the `recordAudit()` call site in `access-pending/page.tsx`: explain permitted-RSC-write + check:audit scan exclusion (see Ruling 5 template above).
- The `?from=` value is advisory metadata, not a verified claim — add a code comment to that effect in the page component where `from` is read.
- The `access-pending/page.tsx` already has a "← Back to home" link (confirmed in source). No additional escape-route work needed for this feature (DECISION-012 follow-up already shipped).
- Implementer will be full-stack-developer (the entire change is small: one-line proxy edit, page props update, one `recordAudit()` call, one new AUDIT_ACTIONS key, one comment).

---

## Phase 4 — Implementation (full-stack) — 2026-07-01

**Owner:** full-stack-developer
**Status:** complete

### Summary

Implemented the `ACCESS_DENIED` audit event across four files: new key in the audit catalog, one-line proxy change to carry `?from=` in the access-pending redirect, updated RSC page to accept `searchParams`, await it, and call `recordAudit()`, and extended the e2e Test 2 to assert the `?from=` param is present. The AUDIT_ACTIONS catalog regression test in `src/lib/audit.test.ts` was updated to include the new key (the test is a guard for audit-string drift and required the update). All verification gates pass: 310/310 unit tests, lint clean, `check:audit` passed, production build succeeded, full e2e suite 30/30 green including the extended Test 2.

### What I Did

- Added `ACCESS_DENIED: "access.denied"` to `AUDIT_ACTIONS` in `src/lib/audit.ts` with the four-line comment following the `RATE_LIMIT_BLOCKED` / `EMAIL_QUEUE_PERMANENT_FAILURE` precedent.
- Updated `src/proxy.ts` (line 58-60): replaced the bare `NextResponse.redirect(new URL("/access-pending", req.url))` with a two-line form that extracts `dest` and sets `dest.searchParams.set("from", pathname)` before redirecting — mirroring the `callbackUrl` pattern at lines 33 and 49.
- Rewrote `src/app/access-pending/page.tsx`: function is now `async`, accepts `{ searchParams: Promise<{ from?: string }> }`, awaits `searchParams`, and calls `await recordAudit({ action: AUDIT_ACTIONS.ACCESS_DENIED, resourceType: "user", metadata: { attemptedPath: from ?? null } })` with all four required comments (permitted-RSC-write, not-cookie-mutation, tripwire-scope, from-is-advisory). Actor omitted — `recordAudit` resolves it from `auth()` internally.
- Extended Test 2 in `e2e/role-boundaries.spec.ts`: renamed test description to include "with from param", added URL-param assertion `expect(url.searchParams.get("from")).toBe("/admin")` after the existing `haveURL` check. Test 5 (feedback gate) is undisturbed.
- Updated `src/lib/audit.test.ts`: added `ACCESS_DENIED: "access.denied"` to `EXPECTED_ENTRIES` — the catalog regression guard requires all keys to be listed; the TypeScript type enforced this as a compile error without the addition.

### Outputs

- `src/lib/audit.ts` — additive: `ACCESS_DENIED: "access.denied"` key + comment block
- `src/proxy.ts` — one redirect line replaced with two-line `dest` + `searchParams.set("from", pathname)` form
- `src/app/access-pending/page.tsx` — async RSC, `searchParams` prop, `await recordAudit()` with four comments
- `e2e/role-boundaries.spec.ts` — Test 2 extended with `?from=` URL-param assertion (Test 5 untouched)
- `src/lib/audit.test.ts` — `ACCESS_DENIED` entry added to `EXPECTED_ENTRIES` catalog guard

### Verification results

| Check | Result |
|-------|--------|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass (0 warnings) |
| `npm run test` | Pass — 310/310 |
| `npm run check:audit` | Pass |
| `npm run build` | Pass — production build clean |
| `npm run test:e2e` (live dev server, port 3000) | **30/30 pass** — incl. Test 23 (extended Test 2: `?from=/admin` assert) |

### Open questions / handoff notes

- No open questions. Implementation is a direct execution of the Phase 3 spec with no deviations.
- One deviation in scope: `src/lib/audit.test.ts` also required updating (the catalog regression guard is typed as `Record<keyof typeof AUDIT_ACTIONS, string>` — TypeScript would not compile without the new key). This is additive and correct.
- **Next agent: qa (Phase 5).** The e2e suite was already run against a live dev server (30/30). The qa agent should confirm the full verification checklist and issue a PASS or BLOCKED verdict.

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. All shared checks and per-pipeline checks passed. The three-file implementation matches the Phase 3 spec exactly: `ACCESS_DENIED: "access.denied"` in `AUDIT_ACTIONS` with the required comment; `proxy.ts` confirmed to have had a bare redirect in HEAD (the `?from=` param is verifiably new); `access-pending/page.tsx` is `async`, awaits `searchParams`, calls `await recordAudit()` with all four required comments, correct metadata shape (`{ attemptedPath: from ?? null }`), and actor omitted; `recordAudit()` confirmed to swallow all errors (outer try/catch, `console.error` only); Test 5 (feedback gate) undisturbed; `EXPECTED_ENTRIES` in `audit.test.ts` updated with `ACCESS_DENIED`; e2e Test 23 asserts `?from=/admin` is present on the redirect URL.

### What I did

- Ran `npm run typecheck` — PASS.
- Ran `npm run lint` — PASS (0 warnings).
- Ran `npm run test` — PASS (310/310, 490 ms, including audit.test.ts catalog guard with `ACCESS_DENIED`).
- Ran `npm run check:audit` — PASS.
- Ran `npm run build` — PASS (21 routes).
- Ran full `npx playwright test` — PASS (30/30, 26.8 s), including:
  - Test 23: `role-boundaries.spec.ts` "member navigating to /admin is redirected to /access-pending with from param" — `?from=/admin` asserted on URL.
  - Test 26: `role-boundaries.spec.ts` "member navigating to /admin/feedback is redirected to /access-pending" — Test 5 confirmed undisturbed.
- Verified via `git diff HEAD -- src/proxy.ts` that HEAD had `return NextResponse.redirect(new URL("/access-pending", req.url))` — the bare form without `?from=`. The `dest.searchParams.set("from", pathname)` addition is confirmed new in the working tree.
- Read `src/app/access-pending/page.tsx` and confirmed:
  - Function is `async`.
  - `searchParams: Promise<{ from?: string }>` in signature.
  - `const { from } = await searchParams` — awaited.
  - `await recordAudit(...)` — awaited (not `void`), satisfying the Vercel function-boundary rationale in Phase 3.
  - All four required comments present: permitted-RSC-write, not-cookie-mutation, tripwire-scope exclusion, `from`-is-advisory.
  - `metadata: { attemptedPath: from ?? null }` — shape matches Phase 3 spec.
  - `actor` field omitted — `recordAudit` resolves it from `auth()` internally.
- Read `src/lib/audit.ts` and confirmed `recordAudit()` wraps everything in a `try/catch` that calls `console.error` and returns `void` — a DB outage cannot break the `/access-pending` render. The `import "server-only"` guard means the module cannot be imported from an Edge context (build-time bundler enforcement). `proxy.ts` does not import `audit.ts` — confirmed by reading `proxy.ts` imports (only `NextResponse`, `NextRequest`, `edgeAuth`, `ADMIN_ROLE`, `FEATURES`).
- Read `e2e/role-boundaries.spec.ts` Test 5 (lines 92–105): "member navigating to /admin/feedback is redirected to /access-pending" — no changes to this test; it is syntactically and semantically intact.
- Confirmed no `console.log`, native dialogs, or `toLocale*` introduced in the five pipeline files.
- Confirmed cross-pipeline file separation: Pipeline A files (`next.config.ts`, `e2e/security-headers.spec.ts`) and Pipeline B files (`src/lib/audit.ts`, `src/proxy.ts`, `src/app/access-pending/page.tsx`, `e2e/role-boundaries.spec.ts`, `src/lib/audit.test.ts`) have no overlap.

### Outputs

- `docs/work-log/2026-07-01-access-denied-audit.md` — Phase 5 section appended; Per-Phase Status row updated to Complete / PASS / 2026-07-01
- `docs/TODO.md` — In Flight line updated to Phase 5 complete, advancing to Phase 6

### Shared verification counts

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (0 warnings) |
| `npm run test` | PASS — 310/310 (490 ms) |
| `npm run check:audit` | PASS |
| `npm run build` | PASS — 21 routes |
| `npx playwright test` (30 tests) | PASS — 30/30 (26.8 s) |

### Feature-Gate Audit

No protected routes or server actions were added or changed by this pipeline. The audit write is a server-side I/O side effect inside an existing RSC. No `auth()` or `hasFeature()` gate check is needed — the feature adds telemetry, not an access-controlled endpoint.

### Regression tests added

- `e2e/role-boundaries.spec.ts` Test 23 — "member navigating to /admin is redirected to /access-pending with from param" (`url.searchParams.get("from") === "/admin"`) — guards against: proxy losing the `?from=` param on the access-pending redirect.
- `src/lib/audit.test.ts` EXPECTED_ENTRIES catalog guard — `ACCESS_DENIED: "access.denied"` entry — guards against: the audit action string being renamed or removed without updating consumers.

### Open questions / handoff notes

- Next agent: **analyst** (Phase 6). QA verdict is PASS; pipeline may advance.
- DB-row assertion (deferred in Phase 3 by design): the audit viewer e2e will cover this when the `/admin/audit` feature ships. No action needed now.
- No open questions. Implementation matches the Phase 3 spec. The `audit.test.ts` deviation (needed to satisfy the TypeScript catalog guard type) is additive and correct.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. Every piece of Phase 1 intent shipped cleanly: `ACCESS_DENIED: "access.denied"` in the audit catalog with the correct comment pattern; the proxy carries `?from=pathname` into the access-pending redirect; the RSC is `async`, correctly awaits `searchParams` as a Promise, calls `await recordAudit()` (not `void`) with `metadata: { attemptedPath: from ?? null }`, omits `actor` (resolved internally), and carries all four required comment obligations; `recordAudit()`'s outer try/catch guarantees the write never breaks the page; ACCESS_GRANTED is deliberately absent; Test 2 in `role-boundaries.spec.ts` now asserts `?from=/admin` on the redirect URL. The `USER_ACCOUNT_LOCKED` key visible in `audit.ts` is from the concurrent lockout implementer — confirmed expected and out of scope for this pipeline. No follow-ups required.

### What I did

Verified five shipped files against Phase 1 intent, Phase 2 rulings, and Phase 3 spec.

**`src/lib/audit.ts`:** `ACCESS_DENIED: "access.denied"` present (line 52) with four-line comment block following RATE_LIMIT_BLOCKED / EMAIL_QUEUE_PERMANENT_FAILURE pattern exactly. `USER_ACCOUNT_LOCKED` also present — concurrent lockout pipeline addition, not drift for this feature. `recordAudit()` outer try/catch confirmed — a DB failure calls `console.error` and returns `void`; the write never throws to the caller.

**`src/proxy.ts`:** Lines 59-61 — bare `NextResponse.redirect(new URL("/access-pending", req.url))` replaced with `const dest = new URL(...)` + `dest.searchParams.set("from", pathname)` + `return NextResponse.redirect(dest)`. Mirrors the `callbackUrl` pattern at lines 33 and 49. Phase 3 spec matched verbatim.

**`src/app/access-pending/page.tsx`:** Function is `async`. `searchParams: Promise<{ from?: string }>` in signature (correct for Next.js 15/16). `const { from } = await searchParams` — awaited. `await recordAudit({ action: AUDIT_ACTIONS.ACCESS_DENIED, resourceType: "user", metadata: { attemptedPath: from ?? null } })` — awaited (satisfies Vercel function-boundary rationale). `actor` omitted. All four required comments present in a single block (lines 10-21): permitted-RSC-write / not-cookie-mutation, check:audit tripwire exclusion, and `from`-is-advisory.

**`e2e/role-boundaries.spec.ts`:** Test 2 (lines 47-58, now under `test.describe("Member — /admin blocked")`) includes the `url.searchParams.get("from") === "/admin"` assertion after the existing `haveURL(/\/access-pending/)` check. Test 5 (lines 92-105) is undisturbed.

**`src/lib/audit.test.ts`:** `ACCESS_DENIED: "access.denied"` in `EXPECTED_ENTRIES` — catalog regression guard updated (TypeScript enforced this as a compile-time requirement).

**One behavioral note confirmed acceptable:** When an authenticated member visits `/access-pending` directly (no proxy redirect), the page renders and writes an ACCESS_DENIED row with `attemptedPath: null`. Phase 1 explicitly accepted this: "One ACCESS_DENIED row per page load is the right granularity." Not drift.

### Outputs

- `docs/work-log/2026-07-01-access-denied-audit.md` — Phase 6 section appended; Per-Phase Status row 6 updated to Complete / SHIP IT / 2026-07-01
- `docs/TODO.md` — In Flight line moved to Done

### Intent-vs-shipped diff

| Item | Phase 1 / Phase 3 said | Shipped | Verdict |
|---|---|---|---|
| `ACCESS_DENIED: "access.denied"` in AUDIT_ACTIONS | present with comment | present at audit.ts:52 with correct comment | matches |
| Comment follows RATE_LIMIT_BLOCKED precedent | 4-line comment block | 4-line comment, same pattern | matches |
| ACCESS_GRANTED skipped | key absent | key absent | matches |
| proxy.ts: `dest.searchParams.set("from", pathname)` | two-line dest + set form | present at proxy.ts:59-61 | matches |
| RSC `async`, `searchParams: Promise<{ from?: string }>` | required | present | matches |
| `await searchParams` | awaited | `const { from } = await searchParams` | matches |
| `await recordAudit(...)` (not `void`) | awaited | awaited | matches |
| `metadata: { attemptedPath: from ?? null }` | required shape | present | matches |
| `actor` omitted | omitted | omitted | matches |
| All four required comments in page.tsx | permitted-RSC-write, not-cookie-mutation, tripwire-scope, from-is-advisory | all four in one comment block (lines 10-21) | matches |
| recordAudit() never breaks the page | outer try/catch swallows | outer try/catch confirmed | matches |
| Test 2 `?from=` assertion | `url.searchParams.get("from") === "/admin"` | present in role-boundaries.spec.ts Test 2 | matches |
| audit.test.ts catalog guard updated | ACCESS_DENIED in EXPECTED_ENTRIES | present | matches |

### Edge cases

| Check | Result |
|---|---|
| Empty state (no `?from=` param) | `from ?? null` → `attemptedPath: null`; page renders normally — pass |
| Failure microcopy | page copy unchanged; DB failure is silent (try/catch) — pass |
| Permission gate | not applicable — audit is system-internal, no feature gate |
| Audit event | fires on every RSC render; confirmed write is awaited — pass |
| Mobile | page layout unchanged from before — pass |

### Open questions / handoff notes

None. Pipeline closed. DB-row assertion deferred to the audit-log-viewer feature by Phase 3 design decision — tracked in Backlog.
